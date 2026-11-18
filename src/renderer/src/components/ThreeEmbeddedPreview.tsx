import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  createDefaultMaterial,
  createThreeSceneFromPreset,
  type ThreeCameraSpec,
  type ThreeMaterialSpec,
  type ThreeObjectNode,
  type ThreeSceneDocument,
} from '@shared/three-ir';
import { useStudioStore } from '@renderer/state/studio-store';

// ============================================================================
// PURE & HARDWARE-ACCELERATED THREE.JS RUNTIME ENGINE (SHARED BY STUDIO & EMBED)
// ============================================================================

export interface SphericalCameraRig {
  radius: number;
  theta: number; // horizontal azimuth (radians)
  phi: number; // polar angle from +Y (radians, clamped 0.08 .. PI - 0.08)
  target: { x: number; y: number; z: number };
  fov: number;
}

export interface ManagedThreeSceneState {
  scene: THREE.Scene;
  objectMap: Map<string, THREE.Object3D>;
  signatureMap: Map<string, string>;
  gridHelper: THREE.GridHelper | null;
  axesHelper: THREE.AxesHelper | null;
  selectionHelper: THREE.BoxHelper | null;
  selectedId: string | null;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createSeededRandom(seedStr: string): () => number {
  let s = hashSeed(seedStr) || 123456789;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createCameraRigFromSpec(spec: ThreeCameraSpec): SphericalCameraRig {
  const dx = spec.position.x - spec.target.x;
  const dy = spec.position.y - spec.target.y;
  const dz = spec.position.z - spec.target.z;
  const radius = Math.max(1.2, Math.hypot(dx, dy, dz));
  const theta = Math.atan2(dx, dz);
  const phi = clamp(Math.acos(clamp(dy / radius, -0.999, 0.999)), 0.08, Math.PI - 0.08);
  return {
    radius,
    theta,
    phi,
    target: { ...spec.target },
    fov: spec.fov || 48,
  };
}

export function orbitCameraRig(
  rig: SphericalCameraRig,
  deltaPxX: number,
  deltaPxY: number,
  sensitivity = 0.0075,
): SphericalCameraRig {
  return {
    ...rig,
    theta: rig.theta - deltaPxX * sensitivity,
    phi: clamp(rig.phi - deltaPxY * sensitivity, 0.08, Math.PI - 0.08),
  };
}

export function panCameraRig(
  rig: SphericalCameraRig,
  deltaPxX: number,
  deltaPxY: number,
): SphericalCameraRig {
  const sinPhi = Math.sin(rig.phi);
  const cosPhi = Math.cos(rig.phi);
  const sinTheta = Math.sin(rig.theta);
  const cosTheta = Math.cos(rig.theta);

  // Forward points from camera to target; compute local right & up vectors
  const forward = new THREE.Vector3(-sinPhi * sinTheta, -cosPhi, -sinPhi * cosTheta).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const panScale = rig.radius * 0.0016;
  const move = new THREE.Vector3()
    .addScaledVector(right, -deltaPxX * panScale)
    .addScaledVector(up, deltaPxY * panScale);

  return {
    ...rig,
    target: {
      x: Number((rig.target.x + move.x).toFixed(4)),
      y: Number((rig.target.y + move.y).toFixed(4)),
      z: Number((rig.target.z + move.z).toFixed(4)),
    },
  };
}

export function zoomCameraRig(rig: SphericalCameraRig, factor: number): SphericalCameraRig {
  return {
    ...rig,
    radius: clamp(rig.radius * factor, 1.2, 85),
  };
}

export function applyCameraRigToPerspective(
  camera: THREE.PerspectiveCamera,
  rig: SphericalCameraRig,
): void {
  const sinPhi = Math.sin(rig.phi);
  const cosPhi = Math.cos(rig.phi);
  const sinTheta = Math.sin(rig.theta);
  const cosTheta = Math.cos(rig.theta);

  const cx = rig.target.x + rig.radius * sinPhi * sinTheta;
  const cy = rig.target.y + rig.radius * cosPhi;
  const cz = rig.target.z + rig.radius * sinPhi * cosTheta;

  if (Math.abs(camera.fov - rig.fov) > 0.01) {
    camera.fov = rig.fov;
    camera.updateProjectionMatrix();
  }
  camera.position.set(cx, cy, cz);
  camera.lookAt(rig.target.x, rig.target.y, rig.target.z);
  camera.updateMatrixWorld();
}

export function createManagedThreeScene(): ManagedThreeSceneState {
  return {
    scene: new THREE.Scene(),
    objectMap: new Map(),
    signatureMap: new Map(),
    gridHelper: null,
    axesHelper: null,
    selectionHelper: null,
    selectedId: null,
  };
}

export function disposeThreeObjectTree(root: THREE.Object3D): void {
  root.traverse((child) => {
    const meshLike = child as THREE.Mesh;
    if (meshLike.geometry) {
      meshLike.geometry.dispose();
    }
    const mat = meshLike.material;
    if (Array.isArray(mat)) {
      for (const m of mat) m.dispose();
    } else if (mat && typeof (mat as THREE.Material).dispose === 'function') {
      (mat as THREE.Material).dispose();
    }
  });
}

export function disposeManagedThreeScene(managed: ManagedThreeSceneState): void {
  for (const obj of managed.objectMap.values()) {
    managed.scene.remove(obj);
    disposeThreeObjectTree(obj);
  }
  managed.objectMap.clear();
  managed.signatureMap.clear();

  if (managed.gridHelper) {
    managed.scene.remove(managed.gridHelper);
    disposeThreeObjectTree(managed.gridHelper);
    managed.gridHelper = null;
  }
  if (managed.axesHelper) {
    managed.scene.remove(managed.axesHelper);
    disposeThreeObjectTree(managed.axesHelper);
    managed.axesHelper = null;
  }
  if (managed.selectionHelper) {
    managed.scene.remove(managed.selectionHelper);
    disposeThreeObjectTree(managed.selectionHelper);
    managed.selectionHelper = null;
  }
}

function buildGeometryInstance(obj: ThreeObjectNode): THREE.BufferGeometry {
  switch (obj.geometry) {
    case 'sphere':
      return new THREE.SphereGeometry(0.85, 32, 32);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.8, 0.8, 1.4, 32);
    case 'cone':
      return new THREE.ConeGeometry(0.85, 1.6, 32);
    case 'torus':
      return new THREE.TorusGeometry(0.9, 0.28, 24, 64);
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(0.75, 0.24, 128, 24);
    case 'plane':
      return new THREE.PlaneGeometry(10, 10);
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(0.9, 1);
    case 'box':
    default:
      return new THREE.BoxGeometry(1.2, 1.2, 1.2);
  }
}

function buildMaterialInstance(spec: ThreeMaterialSpec, isPlane = false): THREE.Material {
  const side = isPlane ? THREE.DoubleSide : THREE.FrontSide;
  const transparent = spec.opacity < 1;
  if (spec.kind === 'basic') {
    return new THREE.MeshBasicMaterial({
      color: spec.color,
      wireframe: spec.wireframe,
      transparent,
      opacity: spec.opacity,
      side,
    });
  }
  if (spec.kind === 'toon') {
    return new THREE.MeshToonMaterial({
      color: spec.color,
      wireframe: spec.wireframe,
      transparent,
      opacity: spec.opacity,
      side,
    });
  }
  if (spec.kind === 'physical') {
    return new THREE.MeshPhysicalMaterial({
      color: spec.color,
      emissive: spec.emissive,
      emissiveIntensity: spec.emissiveIntensity,
      metalness: spec.metalness,
      roughness: spec.roughness,
      clearcoat: spec.clearcoat ?? 0.65,
      clearcoatRoughness: 0.14,
      wireframe: spec.wireframe,
      transparent,
      opacity: spec.opacity,
      side,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: spec.color,
    emissive: spec.emissive,
    emissiveIntensity: spec.emissiveIntensity,
    metalness: spec.metalness,
    roughness: spec.roughness,
    wireframe: spec.wireframe,
    transparent,
    opacity: spec.opacity,
    side,
  });
}

function updateMaterialInPlace(mat: THREE.Material, spec: ThreeMaterialSpec, isPlane = false): void {
  const side = isPlane ? THREE.DoubleSide : THREE.FrontSide;
  const transparent = spec.opacity < 1;
  const wasTransparent = mat.transparent;
  mat.transparent = transparent;
  mat.opacity = spec.opacity;
  mat.side = side;

  if (mat instanceof THREE.MeshBasicMaterial) {
    mat.color.set(spec.color);
    mat.wireframe = spec.wireframe;
  } else if (mat instanceof THREE.MeshToonMaterial) {
    mat.color.set(spec.color);
    mat.wireframe = spec.wireframe;
  } else if (mat instanceof THREE.MeshPhysicalMaterial) {
    mat.color.set(spec.color);
    mat.emissive.set(spec.emissive);
    mat.emissiveIntensity = spec.emissiveIntensity;
    mat.metalness = spec.metalness;
    mat.roughness = spec.roughness;
    mat.clearcoat = spec.clearcoat ?? 0.65;
    mat.wireframe = spec.wireframe;
  } else if (mat instanceof THREE.MeshStandardMaterial) {
    mat.color.set(spec.color);
    mat.emissive.set(spec.emissive);
    mat.emissiveIntensity = spec.emissiveIntensity;
    mat.metalness = spec.metalness;
    mat.roughness = spec.roughness;
    mat.wireframe = spec.wireframe;
  }

  if (wasTransparent !== transparent) {
    mat.needsUpdate = true;
  }
}

function computeStructuralSignature(obj: ThreeObjectNode, showLightGizmos: boolean): string {
  if (obj.nodeType === 'light') {
    return `light:${obj.light?.lightKind ?? 'point'}:gizmo:${showLightGizmos ? 1 : 0}`;
  }
  if (obj.geometry === 'particles') {
    return `particles:${obj.particleCount ?? 320}`;
  }
  return `mesh:${obj.geometry ?? 'box'}:mat:${obj.material?.kind ?? 'standard'}`;
}

function createThreeObjectForNode(obj: ThreeObjectNode, showLightGizmos: boolean): THREE.Object3D {
  if (obj.nodeType === 'light') {
    const l = obj.light ?? { lightKind: 'point', color: '#ffffff', intensity: 1.5 };
    const group = new THREE.Group();
    group.name = obj.name;
    group.userData.studioObjectId = obj.id;

    let lightObj: THREE.Light;
    if (l.lightKind === 'ambient') {
      lightObj = new THREE.AmbientLight(l.color, l.intensity);
    } else if (l.lightKind === 'directional') {
      const dl = new THREE.DirectionalLight(l.color, l.intensity);
      dl.castShadow = Boolean(l.castShadow);
      dl.shadow.mapSize.set(1024, 1024);
      dl.shadow.camera.near = 0.5;
      dl.shadow.camera.far = 35;
      dl.shadow.camera.left = -10;
      dl.shadow.camera.right = 10;
      dl.shadow.camera.top = 10;
      dl.shadow.camera.bottom = -10;
      lightObj = dl;
    } else if (l.lightKind === 'spot') {
      const sl = new THREE.SpotLight(
        l.color,
        l.intensity,
        l.distance ?? 24,
        degToRad(l.angleDeg ?? 38),
        0.35,
      );
      sl.castShadow = Boolean(l.castShadow);
      lightObj = sl;
    } else {
      const pl = new THREE.PointLight(l.color, l.intensity, l.distance ?? 20);
      pl.castShadow = Boolean(l.castShadow);
      lightObj = pl;
    }
    lightObj.userData.studioObjectId = obj.id;
    group.add(lightObj);

    if (showLightGizmos && l.lightKind !== 'ambient') {
      const gizmoGeo = new THREE.OctahedronGeometry(0.22, 0);
      const gizmoMat = new THREE.MeshBasicMaterial({
        color: l.color,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
      });
      const gizmoMesh = new THREE.Mesh(gizmoGeo, gizmoMat);
      gizmoMesh.name = `${obj.name}_Gizmo`;
      gizmoMesh.userData.studioObjectId = obj.id;
      gizmoMesh.userData.isLightGizmo = true;
      group.add(gizmoMesh);
    }

    return group;
  }

  if (obj.geometry === 'particles') {
    const count = clamp(obj.particleCount ?? 320, 16, 4000);
    const rand = createSeededRandom(obj.id);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      positions[i] = (rand() - 0.5) * 18;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const matSpec = obj.material ?? createDefaultMaterial({ kind: 'basic', color: '#e0f2fe' });
    const ptsMat = new THREE.PointsMaterial({
      color: matSpec.color,
      size: 0.085,
      transparent: matSpec.opacity < 1,
      opacity: matSpec.opacity,
      sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, ptsMat);
    pts.name = obj.name;
    pts.userData.studioObjectId = obj.id;
    return pts;
  }

  const matSpec = obj.material ?? createDefaultMaterial();
  const mesh = new THREE.Mesh(
    buildGeometryInstance(obj),
    buildMaterialInstance(matSpec, obj.geometry === 'plane'),
  );
  mesh.name = obj.name;
  mesh.userData.studioObjectId = obj.id;
  return mesh;
}

function updateThreeObjectProperties(obj3d: THREE.Object3D, node: ThreeObjectNode): void {
  obj3d.name = node.name;
  obj3d.visible = node.visible;
  obj3d.userData.studioObjectId = node.id;
  obj3d.userData.studioNode = node;

  obj3d.position.set(node.position.x, node.position.y, node.position.z);
  obj3d.rotation.set(
    degToRad(node.rotationDeg.x),
    degToRad(node.rotationDeg.y),
    degToRad(node.rotationDeg.z),
  );
  obj3d.scale.set(node.scale.x, node.scale.y, node.scale.z);

  if (node.nodeType === 'light' && node.light) {
    const l = node.light;
    for (const child of obj3d.children) {
      if (child instanceof THREE.Light) {
        child.color.set(l.color);
        child.intensity = l.intensity;
        if (child instanceof THREE.DirectionalLight || child instanceof THREE.SpotLight || child instanceof THREE.PointLight) {
          child.castShadow = Boolean(l.castShadow);
        }
        if (child instanceof THREE.PointLight || child instanceof THREE.SpotLight) {
          child.distance = l.distance ?? 20;
        }
        if (child instanceof THREE.SpotLight && l.angleDeg !== undefined) {
          child.angle = degToRad(l.angleDeg);
        }
      } else if (child instanceof THREE.Mesh && child.userData.isLightGizmo) {
        if (child.material instanceof THREE.MeshBasicMaterial) {
          child.material.color.set(l.color);
        }
      }
    }
  } else if (obj3d instanceof THREE.Points) {
    const matSpec = node.material ?? createDefaultMaterial({ kind: 'basic', color: '#e0f2fe' });
    if (obj3d.material instanceof THREE.PointsMaterial) {
      obj3d.material.color.set(matSpec.color);
      obj3d.material.opacity = matSpec.opacity;
      obj3d.material.transparent = matSpec.opacity < 1;
    }
  } else if (obj3d instanceof THREE.Mesh) {
    obj3d.castShadow = Boolean(node.castShadow);
    obj3d.receiveShadow = Boolean(node.receiveShadow);
    const matSpec = node.material ?? createDefaultMaterial();
    if (!Array.isArray(obj3d.material)) {
      updateMaterialInPlace(obj3d.material, matSpec, node.geometry === 'plane');
    }
  }
}

export function syncSceneDocumentToThree(
  managed: ManagedThreeSceneState,
  doc: ThreeSceneDocument,
  selectedObjectId: string | null = null,
  showLightGizmos = true,
): void {
  const { scene } = managed;

  // Environment background & fog
  scene.background = new THREE.Color(doc.environment.backgroundColor || '#0b1120');
  if (doc.environment.fogEnabled) {
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.set(doc.environment.fogColor || doc.environment.backgroundColor);
      scene.fog.near = doc.environment.fogNear;
      scene.fog.far = doc.environment.fogFar;
    } else {
      scene.fog = new THREE.Fog(
        doc.environment.fogColor || doc.environment.backgroundColor,
        doc.environment.fogNear,
        doc.environment.fogFar,
      );
    }
  } else {
    scene.fog = null;
  }

  // GridHelper
  if (doc.environment.showGrid) {
    if (!managed.gridHelper) {
      managed.gridHelper = new THREE.GridHelper(18, 18, 0x3b82f6, 0x1e293b);
      managed.gridHelper.position.y = 0;
      scene.add(managed.gridHelper);
    }
    managed.gridHelper.visible = true;
  } else if (managed.gridHelper) {
    managed.gridHelper.visible = false;
  }

  // AxesHelper
  if (doc.environment.showAxes) {
    if (!managed.axesHelper) {
      managed.axesHelper = new THREE.AxesHelper(3.2);
      managed.axesHelper.position.y = 0.01;
      scene.add(managed.axesHelper);
    }
    managed.axesHelper.visible = true;
  } else if (managed.axesHelper) {
    managed.axesHelper.visible = false;
  }

  // Remove stale objects
  const incomingIds = new Set(doc.objects.map((o) => o.id));
  for (const [existingId, existingObj] of managed.objectMap.entries()) {
    if (!incomingIds.has(existingId)) {
      scene.remove(existingObj);
      disposeThreeObjectTree(existingObj);
      managed.objectMap.delete(existingId);
      managed.signatureMap.delete(existingId);
    }
  }

  // Upsert live objects
  for (const node of doc.objects) {
    const nextSig = computeStructuralSignature(node, showLightGizmos);
    const prevSig = managed.signatureMap.get(node.id);
    let obj3d = managed.objectMap.get(node.id);

    if (obj3d && prevSig !== nextSig) {
      scene.remove(obj3d);
      disposeThreeObjectTree(obj3d);
      obj3d = undefined;
    }

    if (!obj3d) {
      obj3d = createThreeObjectForNode(node, showLightGizmos);
      managed.objectMap.set(node.id, obj3d);
      managed.signatureMap.set(node.id, nextSig);
      scene.add(obj3d);
    }

    updateThreeObjectProperties(obj3d, node);
  }

  // Selection BoxHelper
  managed.selectedId = selectedObjectId;
  const selectedThreeObj = selectedObjectId ? managed.objectMap.get(selectedObjectId) : undefined;
  const selectedNodeSpec = selectedObjectId ? doc.objects.find((o) => o.id === selectedObjectId) : undefined;
  const shouldShowBox = Boolean(
    selectedThreeObj &&
      selectedNodeSpec &&
      selectedNodeSpec.visible &&
      !(selectedNodeSpec.nodeType === 'light' && selectedNodeSpec.light?.lightKind === 'ambient'),
  );

  if (shouldShowBox && selectedThreeObj) {
    selectedThreeObj.updateMatrixWorld(true);
    if (!managed.selectionHelper) {
      managed.selectionHelper = new THREE.BoxHelper(selectedThreeObj, 0x38bdf8);
      scene.add(managed.selectionHelper);
    } else {
      managed.selectionHelper.setFromObject(selectedThreeObj);
    }
    managed.selectionHelper.visible = true;
  } else if (managed.selectionHelper) {
    managed.selectionHelper.visible = false;
  }
}

export function stepThreeSceneAnimations(
  managed: ManagedThreeSceneState,
  doc: ThreeSceneDocument,
  elapsedSec: number,
): void {
  for (const node of doc.objects) {
    if (!node.visible) continue;
    const obj3d = managed.objectMap.get(node.id);
    if (!obj3d) continue;

    const spd = node.animation.speed ?? 1;
    const baseRx = degToRad(node.rotationDeg.x);
    const baseRy = degToRad(node.rotationDeg.y);
    const baseRz = degToRad(node.rotationDeg.z);

    if (node.animation.kind === 'none' || spd === 0) {
      obj3d.position.set(node.position.x, node.position.y, node.position.z);
      obj3d.rotation.set(baseRx, baseRy, baseRz);
      obj3d.scale.set(node.scale.x, node.scale.y, node.scale.z);
      continue;
    }

    if (node.animation.kind === 'spin') {
      obj3d.rotation.set(baseRx, baseRy + elapsedSec * spd, baseRz);
    } else if (node.animation.kind === 'float') {
      const amp = node.animation.amplitude ?? 0.28;
      obj3d.position.set(
        node.position.x,
        node.position.y + Math.sin(elapsedSec * spd * 2) * amp,
        node.position.z,
      );
    } else if (node.animation.kind === 'pulse') {
      const factor = 1 + Math.sin(elapsedSec * spd * 2.5) * 0.12;
      obj3d.scale.set(node.scale.x * factor, node.scale.y * factor, node.scale.z * factor);
    } else if (node.animation.kind === 'orbit') {
      const radius = Math.max(1.5, Math.hypot(node.position.x, node.position.z));
      const baseAngle = Math.atan2(node.position.z, node.position.x);
      obj3d.position.set(
        Math.cos(baseAngle + elapsedSec * spd) * radius,
        node.position.y,
        Math.sin(baseAngle + elapsedSec * spd) * radius,
      );
    }
  }

  if (managed.selectionHelper && managed.selectionHelper.visible && managed.selectedId) {
    const sel = managed.objectMap.get(managed.selectedId);
    if (sel) {
      sel.updateMatrixWorld(true);
      managed.selectionHelper.setFromObject(sel);
    }
  }
}

export function raycastThreeSceneObject(
  managed: ManagedThreeSceneState,
  camera: THREE.PerspectiveCamera,
  ndcX: number,
  ndcY: number,
): string | null {
  camera.updateMatrixWorld();
  managed.scene.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 0.35 };
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  const targets = Array.from(managed.objectMap.values()).filter((o) => o.visible);
  const hits = raycaster.intersectObjects(targets, true);

  for (const hit of hits) {
    let cur: THREE.Object3D | null = hit.object;
    while (cur) {
      if (typeof cur.userData?.studioObjectId === 'string') {
        return cur.userData.studioObjectId;
      }
      cur = cur.parent;
    }
  }
  return null;
}

export function canCreateWebGLRenderer(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const gl =
      probe.getContext('webgl2') ||
      probe.getContext('webgl') ||
      probe.getContext('experimental-webgl');
    return Boolean(gl);
  } catch {
    return false;
  }
}

// ============================================================================
// GRACEFUL 2D-CANVAS PERSPECTIVE FALLBACK (ONLY FOR HEADLESS NO-WEBGL CI)
// ============================================================================

function projectPointTo2D(
  worldPos: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): { x: number; y: number; z: number; visible: boolean } {
  const v = worldPos.clone().project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * width,
    y: (-v.y * 0.5 + 0.5) * height,
    z: v.z,
    visible: v.z >= -1 && v.z <= 1,
  };
}

export function renderSoftwareFallback3D(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  doc: ThreeSceneDocument,
  managed: ManagedThreeSceneState,
  camera: THREE.PerspectiveCamera,
  selectedObjectId: string | null,
): Array<{ id: string; cx: number; cy: number; hitRadius: number }> {
  const hitRegions: Array<{ id: string; cx: number; cy: number; hitRadius: number }> = [];
  if (width <= 0 || height <= 0) return hitRegions;

  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  // Background fill
  ctx.fillStyle = doc.environment.backgroundColor || '#0b1120';
  ctx.fillRect(0, 0, width, height);

  // Subtle perspective ground grid
  if (doc.environment.showGrid) {
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.22)';
    ctx.lineWidth = 1;
    for (let g = -8; g <= 8; g += 2) {
      const a = projectPointTo2D(new THREE.Vector3(g, 0, -8), camera, width, height);
      const b = projectPointTo2D(new THREE.Vector3(g, 0, 8), camera, width, height);
      if (a.visible && b.visible) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      const c = projectPointTo2D(new THREE.Vector3(-8, 0, g), camera, width, height);
      const d = projectPointTo2D(new THREE.Vector3(8, 0, g), camera, width, height);
      if (c.visible && d.visible) {
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(d.x, d.y);
        ctx.stroke();
      }
    }
  }

  // Axes helper
  if (doc.environment.showAxes) {
    const origin = projectPointTo2D(new THREE.Vector3(0, 0, 0), camera, width, height);
    const axes: Array<{ end: THREE.Vector3; color: string }> = [
      { end: new THREE.Vector3(2.8, 0, 0), color: '#ef4444' },
      { end: new THREE.Vector3(0, 2.8, 0), color: '#22c55e' },
      { end: new THREE.Vector3(0, 0, 2.8), color: '#3b82f6' },
    ];
    for (const ax of axes) {
      const p = projectPointTo2D(ax.end, camera, width, height);
      if (origin.visible && p.visible) {
        ctx.strokeStyle = ax.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
  }

  // Depth-sort visible objects (back to front)
  const projectedItems = doc.objects
    .filter((o) => o.visible)
    .map((node) => {
      const liveObj = managed.objectMap.get(node.id);
      const pos = liveObj ? liveObj.position.clone() : new THREE.Vector3(node.position.x, node.position.y, node.position.z);
      const dist = camera.position.distanceTo(pos);
      const proj = projectPointTo2D(pos, camera, width, height);
      return { node, pos, dist, proj };
    })
    .filter((item) => item.proj.visible)
    .sort((a, b) => b.dist - a.dist);

  for (const { node, dist, proj } of projectedItems) {
    if (node.nodeType === 'light') {
      if (node.light?.lightKind === 'ambient') continue;
      const r = clamp((height * 0.22) / Math.max(1.5, dist), 6, 18);
      ctx.save();
      ctx.strokeStyle = node.light?.color ?? '#fde047';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      hitRegions.push({ id: node.id, cx: proj.x, cy: proj.y, hitRadius: r + 6 });
      continue;
    }

    if (node.geometry === 'particles') {
      ctx.save();
      ctx.fillStyle = node.material?.color ?? '#e0f2fe';
      const rand = createSeededRandom(node.id);
      for (let i = 0; i < 64; i++) {
        const px = (rand() - 0.5) * 14;
        const py = (rand() - 0.5) * 10;
        const pz = (rand() - 0.5) * 14;
        const sp = projectPointTo2D(new THREE.Vector3(px, py, pz), camera, width, height);
        if (sp.visible) {
          ctx.fillRect(sp.x, sp.y, 2, 2);
        }
      }
      ctx.restore();
      continue;
    }

    const avgScale = (Math.abs(node.scale.x) + Math.abs(node.scale.y) + Math.abs(node.scale.z)) / 3;
    const screenRadius = clamp(((height * 0.62) / Math.max(1.2, dist)) * avgScale, 12, height * 0.36);
    const mat = node.material ?? createDefaultMaterial();

    ctx.save();
    ctx.globalAlpha = clamp(mat.opacity, 0.1, 1);

    const grad = ctx.createRadialGradient(
      proj.x - screenRadius * 0.3,
      proj.y - screenRadius * 0.3,
      screenRadius * 0.12,
      proj.x,
      proj.y,
      screenRadius,
    );
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.28, mat.color);
    grad.addColorStop(1, '#0f172a');

    ctx.fillStyle = grad;
    ctx.strokeStyle = mat.emissive && mat.emissive !== '#000000' ? mat.emissive : mat.color;
    ctx.lineWidth = mat.wireframe ? 2 : 1.25;

    ctx.beginPath();
    if (node.geometry === 'box' || node.geometry === 'plane') {
      ctx.roundRect(proj.x - screenRadius * 0.85, proj.y - screenRadius * 0.85, screenRadius * 1.7, screenRadius * 1.7, 6);
    } else if (node.geometry === 'cone') {
      ctx.moveTo(proj.x, proj.y - screenRadius);
      ctx.lineTo(proj.x + screenRadius * 0.85, proj.y + screenRadius * 0.85);
      ctx.lineTo(proj.x - screenRadius * 0.85, proj.y + screenRadius * 0.85);
      ctx.closePath();
    } else {
      ctx.arc(proj.x, proj.y, screenRadius * 0.9, 0, Math.PI * 2);
    }

    if (!mat.wireframe) ctx.fill();
    ctx.stroke();

    if (selectedObjectId === node.id) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(
        proj.x - screenRadius - 5,
        proj.y - screenRadius - 5,
        (screenRadius + 5) * 2,
        (screenRadius + 5) * 2,
      );
    }
    ctx.restore();

    hitRegions.push({ id: node.id, cx: proj.x, cy: proj.y, hitRadius: screenRadius + 4 });
  }

  return hitRegions;
}

// ============================================================================
// EMBEDDED 2D-CANVAS 3D WIDGET (`ThreeEmbeddedPreview.tsx`)
// ============================================================================

export interface ThreeEmbeddedPreviewProps {
  sceneId?: string;
  nodeName?: string;
  width?: number;
  height?: number;
}

export const ThreeEmbeddedPreview: React.FC<ThreeEmbeddedPreviewProps> = ({
  sceneId,
  nodeName,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const project = useStudioStore((s) => s.project);
  const threeScenes = useStudioStore((s) => s.threeScenes);
  const activeThreeSceneId = useStudioStore((s) => s.activeThreeSceneId);
  const ensureActiveThreeScene = useStudioStore((s) => s.ensureActiveThreeScene);
  const openSplitMode = useStudioStore((s) => s.openSplitMode);

  const [renderBackend, setRenderBackend] = useState<'webgl' | 'software'>('webgl');

  const fallbackScene = useMemo(
    () => createThreeSceneFromPreset(project?.id ?? 'proj_embed', 'pbr-product-showcase', sceneId),
    [project?.id, sceneId],
  );

  const resolvedScene: ThreeSceneDocument = useMemo(() => {
    if (sceneId && threeScenes[sceneId]) return threeScenes[sceneId];
    if (activeThreeSceneId && threeScenes[activeThreeSceneId]) return threeScenes[activeThreeSceneId];
    const first = Object.values(threeScenes)[0];
    return first ?? fallbackScene;
  }, [sceneId, threeScenes, activeThreeSceneId, fallbackScene]);

  const sceneRef = useRef<ThreeSceneDocument>(resolvedScene);
  sceneRef.current = resolvedScene;

  const managedRef = useRef<ManagedThreeSceneState | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Sync live scene changes immediately into the embedded 3D scene
  useEffect(() => {
    if (!managedRef.current || !cameraRef.current) return;
    syncSceneDocumentToThree(managedRef.current, resolvedScene, null, false);
    const rig = createCameraRigFromSpec(resolvedScene.camera);
    applyCameraRigToPerspective(cameraRef.current, rig);
  }, [resolvedScene]);

  // Mount lightweight WebGLRenderer (or clean 2D fallback) + RAF loop
  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    const managed = createManagedThreeScene();
    managedRef.current = managed;

    const initW = Math.max(120, container.clientWidth || 320);
    const initH = Math.max(90, container.clientHeight || 220);
    const camera = new THREE.PerspectiveCamera(sceneRef.current.camera.fov || 48, initW / initH, 0.1, 200);
    cameraRef.current = camera;

    syncSceneDocumentToThree(managed, sceneRef.current, null, false);
    applyCameraRigToPerspective(camera, createCameraRigFromSpec(sceneRef.current.camera));

    let webglRenderer: THREE.WebGLRenderer | null = null;
    let fallbackCanvas: HTMLCanvasElement | null = null;
    let fallbackCtx: CanvasRenderingContext2D | null = null;

    if (canCreateWebGLRenderer()) {
      try {
        webglRenderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: 'low-power',
        });
        webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        webglRenderer.setSize(initW, initH, false);
        webglRenderer.shadowMap.enabled = true;
        webglRenderer.shadowMap.type = THREE.PCFShadowMap;
        webglRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        webglRenderer.toneMappingExposure = 1.08;
        webglRenderer.domElement.style.width = '100%';
        webglRenderer.domElement.style.height = '100%';
        webglRenderer.domElement.style.display = 'block';
        webglRenderer.domElement.style.pointerEvents = 'none';
        container.appendChild(webglRenderer.domElement);
        setRenderBackend('webgl');
      } catch {
        webglRenderer = null;
      }
    }

    if (!webglRenderer) {
      fallbackCanvas = document.createElement('canvas');
      fallbackCanvas.width = initW;
      fallbackCanvas.height = initH;
      fallbackCanvas.style.width = '100%';
      fallbackCanvas.style.height = '100%';
      fallbackCanvas.style.display = 'block';
      fallbackCanvas.style.pointerEvents = 'none';
      fallbackCtx = fallbackCanvas.getContext('2d');
      container.appendChild(fallbackCanvas);
      setRenderBackend('software');
    }

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (!rect) return;
            const w = Math.max(64, Math.floor(rect.width));
            const h = Math.max(64, Math.floor(rect.height));
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            if (webglRenderer) {
              webglRenderer.setSize(w, h, false);
            } else if (fallbackCanvas) {
              fallbackCanvas.width = w;
              fallbackCanvas.height = h;
            }
          })
        : null;
    resizeObserver?.observe(container);

    const startMs = performance.now();
    let rafId = 0;

    const tick = (nowMs: number) => {
      rafId = requestAnimationFrame(tick);
      const elapsedSec = (nowMs - startMs) * 0.001;
      stepThreeSceneAnimations(managed, sceneRef.current, elapsedSec);
      if (webglRenderer) {
        webglRenderer.render(managed.scene, camera);
      } else if (fallbackCtx && fallbackCanvas) {
        renderSoftwareFallback3D(
          fallbackCtx,
          fallbackCanvas.width,
          fallbackCanvas.height,
          sceneRef.current,
          managed,
          camera,
          null,
        );
      }
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      disposeManagedThreeScene(managed);
      managedRef.current = null;
      cameraRef.current = null;
      if (webglRenderer) {
        webglRenderer.dispose();
        webglRenderer.domElement.remove();
      }
      if (fallbackCanvas) {
        fallbackCanvas.remove();
      }
    };
  }, []);

  const handleOpenInThreeStudio = async (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (sceneId && threeScenes[sceneId]) {
      useStudioStore.setState({ activeThreeSceneId: sceneId });
    } else {
      await ensureActiveThreeScene();
    }
    openSplitMode('three-studio');
  };

  return (
    <div
      data-testid="three-embedded-preview"
      onDoubleClick={(e) => void handleOpenInThreeStudio(e)}
      title="Doppio clic per aprire questa scena nello Studio 3D Three.js"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 120,
        borderRadius: 'inherit',
        overflow: 'hidden',
        background: resolvedScene.environment.backgroundColor || '#0b1120',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Live Three.js Mount Stage */}
      <div
        ref={hostRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />

      {/* Top-Left Live Badge */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 8px',
          borderRadius: 6,
          background: 'rgba(15, 23, 42, 0.82)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(59, 130, 246, 0.38)',
          color: '#e2e8f0',
          fontSize: 10.5,
          fontWeight: 600,
          pointerEvents: 'none',
          maxWidth: 'calc(100% - 16px)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#10b981',
            boxShadow: '0 0 6px #10b981',
            flexShrink: 0,
          }}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {nodeName ? `${nodeName} • ` : ''}
          {resolvedScene.name} ({resolvedScene.objects.length} ogg • {renderBackend === 'webgl' ? 'WebGL' : '3D Canvas'})
        </span>
      </div>

      {/* Bottom-Right Action Button to Open Full 3D Studio */}
      <div
        style={{
          position: 'absolute',
          right: 8,
          bottom: 8,
          zIndex: 5,
          pointerEvents: 'auto',
        }}
      >
        <button
          type="button"
          data-testid="btn-edit-three-in-studio"
          className="studio-btn sm primary"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => void handleOpenInThreeStudio(e)}
          style={{
            height: 25,
            padding: '0 9px',
            fontSize: 11,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.45)',
          }}
        >
          <span>🧊 Modifica nello Studio 3D</span>
        </button>
      </div>
    </div>
  );
};
