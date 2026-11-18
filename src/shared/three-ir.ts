import type { CodeSourceMapSpan } from './ui-ir';

/**
 * Shared Three.js 3D Scene IR, 4 Curated Presets, Object Factories,
 * and Deterministic Multi-Format Codegen (`three-ts` | `r3f-tsx` | `three-html`) with SourceMaps.
 */

export type ThreeGeometryKind =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'torusKnot'
  | 'plane'
  | 'icosahedron'
  | 'particles';

export type ThreeLightKind = 'ambient' | 'directional' | 'point' | 'spot';

export type ThreeMaterialKind = 'standard' | 'physical' | 'toon' | 'basic';

export type ThreeAnimationKind = 'none' | 'spin' | 'float' | 'pulse' | 'orbit';

export type ThreeCodeExportFormat = 'three-ts' | 'r3f-tsx' | 'three-html';

export type ThreePresetId =
  | 'pbr-product-showcase'
  | 'scifi-orbital-system'
  | 'cyberpunk-neon-grid'
  | 'studio-three-point-light';

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface ThreeMaterialSpec {
  kind: ThreeMaterialKind;
  color: string;
  emissive: string;
  emissiveIntensity: number;
  metalness: number; // 0..1
  roughness: number; // 0..1
  clearcoat?: number; // 0..1 for physical
  opacity: number; // 0..1
  wireframe: boolean;
}

export interface ThreeLightSpec {
  lightKind: ThreeLightKind;
  color: string;
  intensity: number;
  distance?: number;
  angleDeg?: number;
  castShadow?: boolean;
}

export interface ThreeAnimationSpec {
  kind: ThreeAnimationKind;
  speed: number;
  amplitude?: number;
}

export interface ThreeObjectNode {
  id: string;
  name: string;
  nodeType: 'mesh' | 'light';
  visible: boolean;
  position: Vec3Tuple;
  rotationDeg: Vec3Tuple;
  scale: Vec3Tuple;
  geometry?: ThreeGeometryKind;
  geometryArgs?: number[];
  particleCount?: number;
  material?: ThreeMaterialSpec;
  light?: ThreeLightSpec;
  animation: ThreeAnimationSpec;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface ThreeCameraSpec {
  fov: number;
  position: Vec3Tuple;
  target: Vec3Tuple;
}

export interface ThreeEnvironmentSpec {
  backgroundColor: string;
  showGrid: boolean;
  showAxes: boolean;
  fogEnabled: boolean;
  fogColor: string;
  fogNear: number;
  fogFar: number;
}

export interface ThreeSceneDocument {
  id: string;
  projectId: string;
  name: string;
  presetId: ThreePresetId;
  camera: ThreeCameraSpec;
  environment: ThreeEnvironmentSpec;
  objects: ThreeObjectNode[];
  updatedAt: number;
}

export interface ThreeScenePresetInfo {
  id: ThreePresetId;
  label: string;
  description: string;
}

export const THREE_SCENE_PRESETS: ThreeScenePresetInfo[] = [
  {
    id: 'pbr-product-showcase',
    label: 'Showcase Prodotto PBR',
    description: 'TorusKnot metallico Physical Clearcoat su pedana riflettente con luci studio',
  },
  {
    id: 'scifi-orbital-system',
    label: 'Sistema Orbitale Sci-Fi',
    description: 'Nucleo energetico emissivo, anelli orbitali, pianeta satellite e campo stellare',
  },
  {
    id: 'cyberpunk-neon-grid',
    label: 'Cyberpunk Neon Grid',
    description: 'Monoliti geometrici neon ciano/magenta con nebbia atmosferica e particelle',
  },
  {
    id: 'studio-three-point-light',
    label: 'Studio Illuminazione 3 Punti',
    description: 'Set fotografico Key + Fill + Rim light con sfera, cubo e cilindro di calibrazione PBR',
  },
];

let objSeq = 0;

export function createDefaultMaterial(overrides?: Partial<ThreeMaterialSpec>): ThreeMaterialSpec {
  return {
    kind: 'standard',
    color: '#3b82f6',
    emissive: '#000000',
    emissiveIntensity: 0,
    metalness: 0.35,
    roughness: 0.28,
    clearcoat: 0.5,
    opacity: 1,
    wireframe: false,
    ...overrides,
  };
}

export function createThreeMeshObject(
  geometry: ThreeGeometryKind,
  overrides?: Partial<ThreeObjectNode>,
): ThreeObjectNode {
  const id = overrides?.id ?? `obj3d_${++objSeq}_${Date.now().toString(36)}`;
  const defaultNames: Record<ThreeGeometryKind, string> = {
    box: 'CuboPBR',
    sphere: 'SferaPBR',
    cylinder: 'Cilindro',
    cone: 'Cono',
    torus: 'AnelloTorus',
    torusKnot: 'HeroTorusKnot',
    plane: 'PianoBase',
    icosahedron: 'CristalloIcosaedro',
    particles: 'CampoParticelleStelle',
  };
  const isPlane = geometry === 'plane';
  return {
    id,
    name: overrides?.name ?? defaultNames[geometry],
    nodeType: 'mesh',
    visible: overrides?.visible ?? true,
    position: overrides?.position ?? { x: 0, y: isPlane ? 0 : 1, z: 0 },
    rotationDeg: overrides?.rotationDeg ?? { x: isPlane ? -90 : 0, y: 0, z: 0 },
    scale: overrides?.scale ?? { x: 1, y: 1, z: 1 },
    geometry,
    particleCount: geometry === 'particles' ? (overrides?.particleCount ?? 320) : undefined,
    material: createDefaultMaterial(overrides?.material),
    animation: overrides?.animation ?? {
      kind: geometry === 'torusKnot' || geometry === 'icosahedron' ? 'spin' : 'none',
      speed: 1,
    },
    castShadow: overrides?.castShadow ?? !isPlane,
    receiveShadow: overrides?.receiveShadow ?? true,
  };
}

export function createThreeLightObject(
  lightKind: ThreeLightKind,
  overrides?: Partial<ThreeObjectNode>,
): ThreeObjectNode {
  const id = overrides?.id ?? `light3d_${++objSeq}_${Date.now().toString(36)}`;
  const labels: Record<ThreeLightKind, string> = {
    ambient: 'LuceAmbiente',
    directional: 'LuceDirezionaleKey',
    point: 'LucePointAccent',
    spot: 'LuceSpotRim',
  };
  return {
    id,
    name: overrides?.name ?? labels[lightKind],
    nodeType: 'light',
    visible: overrides?.visible ?? true,
    position:
      overrides?.position ??
      (lightKind === 'ambient'
        ? { x: 0, y: 4, z: 0 }
        : lightKind === 'directional'
          ? { x: 5, y: 8, z: 6 }
          : { x: -4, y: 4, z: 3 }),
    rotationDeg: overrides?.rotationDeg ?? { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    light: {
      lightKind,
      color: '#ffffff',
      intensity: lightKind === 'ambient' ? 0.65 : 1.8,
      castShadow: lightKind !== 'ambient',
      ...(overrides?.light ?? {}),
    },
    animation: overrides?.animation ?? { kind: 'none', speed: 1 },
  };
}

export function createThreeSceneFromPreset(
  projectId: string,
  presetId: ThreePresetId = 'pbr-product-showcase',
  sceneIdOverride?: string,
  nameOverride?: string,
): ThreeSceneDocument {
  const id = sceneIdOverride ?? `scene3d_${projectId.slice(-6)}`;

  if (presetId === 'scifi-orbital-system') {
    return {
      id,
      projectId,
      name: nameOverride ?? 'SciFiOrbitalScene',
      presetId,
      camera: { fov: 50, position: { x: 0, y: 4.5, z: 9.5 }, target: { x: 0, y: 0.8, z: 0 } },
      environment: {
        backgroundColor: '#050814',
        showGrid: true,
        showAxes: false,
        fogEnabled: true,
        fogColor: '#050814',
        fogNear: 8,
        fogFar: 28,
      },
      objects: [
        createThreeLightObject('ambient', { id: 'l_amb', light: { lightKind: 'ambient', color: '#93c5fd', intensity: 0.55 } }),
        createThreeLightObject('point', {
          id: 'l_core',
          name: 'CorePointLight',
          position: { x: 0, y: 1.2, z: 0 },
          light: { lightKind: 'point', color: '#60a5fa', intensity: 3.2, distance: 18 },
        }),
        createThreeMeshObject('icosahedron', {
          id: 'm_core',
          name: 'EnergyCore',
          position: { x: 0, y: 1.2, z: 0 },
          material: createDefaultMaterial({
            kind: 'physical',
            color: '#38bdf8',
            emissive: '#2563eb',
            emissiveIntensity: 0.85,
            metalness: 0.2,
            roughness: 0.12,
          }),
          animation: { kind: 'pulse', speed: 1.4 },
        }),
        createThreeMeshObject('torus', {
          id: 'm_ring',
          name: 'OrbitalRing',
          position: { x: 0, y: 1.2, z: 0 },
          rotationDeg: { x: 65, y: 15, z: 0 },
          scale: { x: 2.1, y: 2.1, z: 2.1 },
          material: createDefaultMaterial({ color: '#a78bfa', metalness: 0.8, roughness: 0.2 }),
          animation: { kind: 'spin', speed: 0.9 },
        }),
        createThreeMeshObject('sphere', {
          id: 'm_moon',
          name: 'SatelliteMoon',
          position: { x: 3.1, y: 1.4, z: 0 },
          scale: { x: 0.45, y: 0.45, z: 0.45 },
          material: createDefaultMaterial({ color: '#34d399', metalness: 0.4, roughness: 0.35 }),
          animation: { kind: 'orbit', speed: 1.1 },
        }),
        createThreeMeshObject('particles', {
          id: 'm_stars',
          name: 'StarfieldParticles',
          position: { x: 0, y: 2, z: 0 },
          particleCount: 420,
          material: createDefaultMaterial({ kind: 'basic', color: '#e0f2fe' }),
          animation: { kind: 'spin', speed: 0.12 },
        }),
      ],
      updatedAt: Date.now(),
    };
  }

  if (presetId === 'cyberpunk-neon-grid') {
    return {
      id,
      projectId,
      name: nameOverride ?? 'CyberpunkNeonScene',
      presetId,
      camera: { fov: 52, position: { x: 4.5, y: 3.6, z: 7.5 }, target: { x: 0, y: 1, z: 0 } },
      environment: {
        backgroundColor: '#090418',
        showGrid: true,
        showAxes: false,
        fogEnabled: true,
        fogColor: '#090418',
        fogNear: 6,
        fogFar: 22,
      },
      objects: [
        createThreeLightObject('ambient', { id: 'l_amb_cy', light: { lightKind: 'ambient', color: '#c084fc', intensity: 0.5 } }),
        createThreeLightObject('spot', {
          id: 'l_spot_cyan',
          name: 'NeonCyanSpot',
          position: { x: -4, y: 6, z: 4 },
          light: { lightKind: 'spot', color: '#22d3ee', intensity: 2.8, castShadow: true },
        }),
        createThreeLightObject('point', {
          id: 'l_pt_pink',
          name: 'NeonPinkPoint',
          position: { x: 4, y: 3, z: -2 },
          light: { lightKind: 'point', color: '#ec4899', intensity: 2.5 },
        }),
        createThreeMeshObject('box', {
          id: 'm_monolith',
          name: 'CyberMonolith',
          position: { x: -1.4, y: 1.3, z: 0 },
          scale: { x: 1, y: 2.6, z: 1 },
          material: createDefaultMaterial({
            color: '#0f172a',
            emissive: '#ec4899',
            emissiveIntensity: 0.45,
            metalness: 0.85,
            roughness: 0.15,
          }),
          animation: { kind: 'float', speed: 1.0 },
        }),
        createThreeMeshObject('torusKnot', {
          id: 'm_holo',
          name: 'HoloSynthKnot',
          position: { x: 1.4, y: 1.5, z: 0.4 },
          scale: { x: 0.75, y: 0.75, z: 0.75 },
          material: createDefaultMaterial({
            color: '#22d3ee',
            emissive: '#06b6d4',
            emissiveIntensity: 0.6,
            wireframe: true,
          }),
          animation: { kind: 'spin', speed: 1.3 },
        }),
      ],
      updatedAt: Date.now(),
    };
  }

  if (presetId === 'studio-three-point-light') {
    return {
      id,
      projectId,
      name: nameOverride ?? 'StudioLightingRig',
      presetId,
      camera: { fov: 45, position: { x: 0, y: 3.4, z: 7.8 }, target: { x: 0, y: 0.9, z: 0 } },
      environment: {
        backgroundColor: '#111827',
        showGrid: true,
        showAxes: true,
        fogEnabled: false,
        fogColor: '#111827',
        fogNear: 10,
        fogFar: 30,
      },
      objects: [
        createThreeLightObject('ambient', { id: 'l_fill', name: 'FillAmbient', light: { lightKind: 'ambient', color: '#cbd5e1', intensity: 0.45 } }),
        createThreeLightObject('directional', {
          id: 'l_key',
          name: 'KeyLightWarm',
          position: { x: 5, y: 7, z: 5 },
          light: { lightKind: 'directional', color: '#fffbeb', intensity: 2.2, castShadow: true },
        }),
        createThreeLightObject('spot', {
          id: 'l_rim',
          name: 'RimLightCool',
          position: { x: -5, y: 5, z: -4 },
          light: { lightKind: 'spot', color: '#60a5fa', intensity: 2.0 },
        }),
        createThreeMeshObject('sphere', {
          id: 'm_calib_sphere',
          name: 'ChromeSphere',
          position: { x: -1.8, y: 0.9, z: 0 },
          material: createDefaultMaterial({ color: '#f8fafc', metalness: 0.92, roughness: 0.08 }),
        }),
        createThreeMeshObject('box', {
          id: 'm_calib_box',
          name: 'MatteAccentCube',
          position: { x: 0, y: 0.8, z: 0 },
          rotationDeg: { x: 0, y: 28, z: 0 },
          material: createDefaultMaterial({ color: '#3b82f6', metalness: 0.15, roughness: 0.65 }),
          animation: { kind: 'spin', speed: 0.5 },
        }),
        createThreeMeshObject('cylinder', {
          id: 'm_calib_cyl',
          name: 'ToonPedestal',
          position: { x: 1.8, y: 0.9, z: 0 },
          material: createDefaultMaterial({ kind: 'toon', color: '#10b981' }),
        }),
      ],
      updatedAt: Date.now(),
    };
  }

  // Default: pbr-product-showcase
  return {
    id,
    projectId,
    name: nameOverride ?? 'HeroProductScene3D',
    presetId: 'pbr-product-showcase',
    camera: { fov: 48, position: { x: 3.8, y: 3.2, z: 6.4 }, target: { x: 0, y: 0.9, z: 0 } },
    environment: {
      backgroundColor: '#0b1120',
      showGrid: true,
      showAxes: true,
      fogEnabled: true,
      fogColor: '#0b1120',
      fogNear: 9,
      fogFar: 26,
    },
    objects: [
      createThreeLightObject('ambient', {
        id: 'light_ambient_main',
        name: 'AmbientSoftLight',
        light: { lightKind: 'ambient', color: '#dbeafe', intensity: 0.65 },
      }),
      createThreeLightObject('directional', {
        id: 'light_dir_key',
        name: 'StudioKeyLight',
        position: { x: 5, y: 8, z: 6 },
        light: { lightKind: 'directional', color: '#ffffff', intensity: 2.1, castShadow: true },
      }),
      createThreeLightObject('point', {
        id: 'light_point_rim',
        name: 'VioletRimLight',
        position: { x: -4, y: 3.5, z: -3 },
        light: { lightKind: 'point', color: '#8b5cf6', intensity: 2.4, distance: 16 },
      }),
      createThreeMeshObject('torusKnot', {
        id: 'mesh_hero_knot',
        name: 'HeroMesh',
        position: { x: 0, y: 1.35, z: 0 },
        scale: { x: 0.85, y: 0.85, z: 0.85 },
        material: createDefaultMaterial({
          kind: 'physical',
          color: '#3b82f6',
          emissive: '#1d4ed8',
          emissiveIntensity: 0.22,
          metalness: 0.72,
          roughness: 0.18,
          clearcoat: 0.85,
        }),
        animation: { kind: 'spin', speed: 1.0 },
      }),
      createThreeMeshObject('cylinder', {
        id: 'mesh_stage_pedestal',
        name: 'StagePedestal',
        position: { x: 0, y: 0.15, z: 0 },
        scale: { x: 2.4, y: 0.3, z: 2.4 },
        material: createDefaultMaterial({
          color: '#1e293b',
          metalness: 0.5,
          roughness: 0.35,
        }),
        animation: { kind: 'none', speed: 0 },
      }),
    ],
    updatedAt: Date.now(),
  };
}

function safeIdent(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, '');
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function degToRadStr(deg: number): string {
  return ((deg * Math.PI) / 180).toFixed(4);
}

function buildThreeGeometryCtor(obj: ThreeObjectNode): string {
  switch (obj.geometry) {
    case 'sphere':
      return 'new THREE.SphereGeometry(0.85, 32, 32)';
    case 'cylinder':
      return 'new THREE.CylinderGeometry(0.8, 0.8, 1.4, 32)';
    case 'cone':
      return 'new THREE.ConeGeometry(0.85, 1.6, 32)';
    case 'torus':
      return 'new THREE.TorusGeometry(0.9, 0.28, 24, 64)';
    case 'torusKnot':
      return 'new THREE.TorusKnotGeometry(0.75, 0.24, 128, 24)';
    case 'plane':
      return 'new THREE.PlaneGeometry(10, 10)';
    case 'icosahedron':
      return 'new THREE.IcosahedronGeometry(0.9, 1)';
    case 'box':
    default:
      return 'new THREE.BoxGeometry(1.2, 1.2, 1.2)';
  }
}

function buildThreeMaterialCtor(mat: ThreeMaterialSpec): string {
  if (mat.kind === 'basic') {
    return `new THREE.MeshBasicMaterial({ color: '${mat.color}', wireframe: ${mat.wireframe}, transparent: ${mat.opacity < 1}, opacity: ${mat.opacity} })`;
  }
  if (mat.kind === 'toon') {
    return `new THREE.MeshToonMaterial({ color: '${mat.color}', transparent: ${mat.opacity < 1}, opacity: ${mat.opacity} })`;
  }
  if (mat.kind === 'physical') {
    return `new THREE.MeshPhysicalMaterial({ color: '${mat.color}', emissive: '${mat.emissive}', emissiveIntensity: ${mat.emissiveIntensity}, metalness: ${mat.metalness}, roughness: ${mat.roughness}, clearcoat: ${mat.clearcoat ?? 0.6}, wireframe: ${mat.wireframe}, transparent: ${mat.opacity < 1}, opacity: ${mat.opacity} })`;
  }
  return `new THREE.MeshStandardMaterial({ color: '${mat.color}', emissive: '${mat.emissive}', emissiveIntensity: ${mat.emissiveIntensity}, metalness: ${mat.metalness}, roughness: ${mat.roughness}, wireframe: ${mat.wireframe}, transparent: ${mat.opacity < 1}, opacity: ${mat.opacity} })`;
}

export function compileThreeSceneToCode(
  scene: ThreeSceneDocument,
  format: ThreeCodeExportFormat = 'three-ts',
): {
  code: string;
  language: 'typescript' | 'tsx' | 'html';
  fileName: string;
  sourceMap: CodeSourceMapSpan[];
} {
  const lines: string[] = [];
  const sourceMap: CodeSourceMapSpan[] = [];
  const visibleObjects = scene.objects.filter((o) => o.visible);

  if (format === 'r3f-tsx') {
    const compName = safeIdent(scene.name, 'StudioThreeScene');
    lines.push(`import React, { useRef } from 'react';`);
    lines.push(`import { Canvas, useFrame } from '@react-three/fiber';`);
    lines.push(`import { OrbitControls, Grid } from '@react-three/drei';`);
    lines.push(`import type * as THREE from 'three';`);
    lines.push(``);
    lines.push(`export function ${compName}() {`);
    lines.push(`  return (`);
    lines.push(
      `    <Canvas shadows camera={{ fov: ${scene.camera.fov}, position: [${scene.camera.position.x}, ${scene.camera.position.y}, ${scene.camera.position.z}] }} style={{ background: '${scene.environment.backgroundColor}', width: '100%', height: '100%' }}>`,
    );
    if (scene.environment.fogEnabled) {
      lines.push(
        `      <fog attach="fog" args={['${scene.environment.fogColor}', ${scene.environment.fogNear}, ${scene.environment.fogFar}]} />`,
      );
    }
    if (scene.environment.showGrid) {
      lines.push(`      <Grid infiniteGrid fadeDistance={24} />`);
    }

    for (const obj of visibleObjects) {
      const startLine = lines.length + 1;
      if (obj.nodeType === 'light' && obj.light) {
        const l = obj.light;
        if (l.lightKind === 'ambient') {
          lines.push(`      <ambientLight name="${obj.name}" color="${l.color}" intensity={${l.intensity}} />`);
        } else if (l.lightKind === 'directional') {
          lines.push(
            `      <directionalLight name="${obj.name}" position={[${obj.position.x}, ${obj.position.y}, ${obj.position.z}]} color="${l.color}" intensity={${l.intensity}} castShadow={${Boolean(l.castShadow)}} />`,
          );
        } else if (l.lightKind === 'spot') {
          lines.push(
            `      <spotLight name="${obj.name}" position={[${obj.position.x}, ${obj.position.y}, ${obj.position.z}]} color="${l.color}" intensity={${l.intensity}} castShadow={${Boolean(l.castShadow)}} />`,
          );
        } else {
          lines.push(
            `      <pointLight name="${obj.name}" position={[${obj.position.x}, ${obj.position.y}, ${obj.position.z}]} color="${l.color}" intensity={${l.intensity}} />`,
          );
        }
      } else {
        const mat = obj.material ?? createDefaultMaterial();
        lines.push(
          `      <mesh name="${obj.name}" position={[${obj.position.x}, ${obj.position.y}, ${obj.position.z}]} rotation={[${degToRadStr(obj.rotationDeg.x)}, ${degToRadStr(obj.rotationDeg.y)}, ${degToRadStr(obj.rotationDeg.z)}]} scale={[${obj.scale.x}, ${obj.scale.y}, ${obj.scale.z}]} castShadow={${Boolean(obj.castShadow)}} receiveShadow={${Boolean(obj.receiveShadow)}}>`,
        );
        const geoTag =
          obj.geometry === 'sphere'
            ? '<sphereGeometry args={[0.85, 32, 32]} />'
            : obj.geometry === 'cylinder'
              ? '<cylinderGeometry args={[0.8, 0.8, 1.4, 32]} />'
              : obj.geometry === 'cone'
                ? '<coneGeometry args={[0.85, 1.6, 32]} />'
                : obj.geometry === 'torus'
                  ? '<torusGeometry args={[0.9, 0.28, 24, 64]} />'
                  : obj.geometry === 'torusKnot'
                    ? '<torusKnotGeometry args={[0.75, 0.24, 128, 24]} />'
                    : obj.geometry === 'plane'
                      ? '<planeGeometry args={[10, 10]} />'
                      : obj.geometry === 'icosahedron'
                        ? '<icosahedronGeometry args={[0.9, 1]} />'
                        : '<boxGeometry args={[1.2, 1.2, 1.2]} />';
        lines.push(`        ${geoTag}`);
        lines.push(
          `        <meshStandardMaterial color="${mat.color}" emissive="${mat.emissive}" emissiveIntensity={${mat.emissiveIntensity}} metalness={${mat.metalness}} roughness={${mat.roughness}} wireframe={${mat.wireframe}} />`,
        );
        lines.push(`      </mesh>`);
      }
      const endLine = lines.length;
      sourceMap.push({ canvasNodeId: obj.id, startLine, startCol: 7, endLine, endCol: 80 });
    }

    lines.push(`      <OrbitControls target={[${scene.camera.target.x}, ${scene.camera.target.y}, ${scene.camera.target.z}]} />`);
    lines.push(`    </Canvas>`);
    lines.push(`  );`);
    lines.push(`}`);

    return {
      code: lines.join('\n') + '\n',
      language: 'tsx',
      fileName: `${compName}.tsx`,
      sourceMap,
    };
  }

  // Build core imperative Three.js setup (reused by both `three-ts` and `three-html`)
  const emitImperativeBody = (typed: boolean, indentSpaces = 2) => {
    const pad = ' '.repeat(indentSpaces);
    lines.push(`${pad}const scene = new THREE.Scene();`);
    lines.push(`${pad}scene.background = new THREE.Color('${scene.environment.backgroundColor}');`);
    if (scene.environment.fogEnabled) {
      lines.push(
        `${pad}scene.fog = new THREE.Fog('${scene.environment.fogColor}', ${scene.environment.fogNear}, ${scene.environment.fogFar});`,
      );
    }
    lines.push(
      `${pad}const camera = new THREE.PerspectiveCamera(${scene.camera.fov}, container.clientWidth / Math.max(1, container.clientHeight), 0.1, 200);`,
    );
    lines.push(`${pad}camera.position.set(${scene.camera.position.x}, ${scene.camera.position.y}, ${scene.camera.position.z});`);
    lines.push(`${pad}camera.lookAt(${scene.camera.target.x}, ${scene.camera.target.y}, ${scene.camera.target.z});`);
    lines.push(``);
    lines.push(`${pad}const renderer = new THREE.WebGLRenderer({ antialias: true });`);
    lines.push(`${pad}renderer.setSize(container.clientWidth, container.clientHeight);`);
    lines.push(`${pad}renderer.shadowMap.enabled = true;`);
    lines.push(`${pad}container.appendChild(renderer.domElement);`);
    if (scene.environment.showGrid) {
      lines.push(`${pad}scene.add(new THREE.GridHelper(16, 16, 0x3b82f6, 0x1e293b));`);
    }
    lines.push(``);

    const animatedVars: Array<{ varName: string; obj: ThreeObjectNode }> = [];

    for (let idx = 0; idx < visibleObjects.length; idx++) {
      const obj = visibleObjects[idx];
      const varName = `${safeIdent(obj.name, 'node')}_${idx + 1}`;
      const startLine = lines.length + 1;

      if (obj.nodeType === 'light' && obj.light) {
        const l = obj.light;
        const ctor =
          l.lightKind === 'ambient'
            ? `new THREE.AmbientLight('${l.color}', ${l.intensity})`
            : l.lightKind === 'directional'
              ? `new THREE.DirectionalLight('${l.color}', ${l.intensity})`
              : l.lightKind === 'spot'
                ? `new THREE.SpotLight('${l.color}', ${l.intensity})`
                : `new THREE.PointLight('${l.color}', ${l.intensity}, ${l.distance ?? 20})`;
        lines.push(`${pad}// Light: ${obj.name}`);
        lines.push(`${pad}const ${varName} = ${ctor};`);
        if (l.lightKind !== 'ambient') {
          lines.push(`${pad}${varName}.position.set(${obj.position.x}, ${obj.position.y}, ${obj.position.z});`);
          if (l.castShadow) lines.push(`${pad}${varName}.castShadow = true;`);
        }
        lines.push(`${pad}scene.add(${varName});`);
      } else if (obj.geometry === 'particles') {
        const count = obj.particleCount ?? 300;
        const mat = obj.material ?? createDefaultMaterial({ color: '#e0f2fe' });
        lines.push(`${pad}// Particle Field: ${obj.name}`);
        lines.push(`${pad}const ${varName}Geo = new THREE.BufferGeometry();`);
        lines.push(`${pad}const ${varName}Pos = new Float32Array(${count * 3});`);
        lines.push(`${pad}for (let i = 0; i < ${count * 3}; i++) ${varName}Pos[i] = (Math.random() - 0.5) * 18;`);
        lines.push(`${pad}${varName}Geo.setAttribute('position', new THREE.BufferAttribute(${varName}Pos, 3));`);
        lines.push(`${pad}const ${varName} = new THREE.Points(${varName}Geo, new THREE.PointsMaterial({ color: '${mat.color}', size: 0.07 }));`);
        lines.push(`${pad}scene.add(${varName});`);
      } else {
        const mat = obj.material ?? createDefaultMaterial();
        lines.push(`${pad}// Mesh: ${obj.name}`);
        lines.push(`${pad}const ${varName} = new THREE.Mesh(${buildThreeGeometryCtor(obj)}, ${buildThreeMaterialCtor(mat)});`);
        lines.push(`${pad}${varName}.name = ${JSON.stringify(obj.name)};`);
        lines.push(`${pad}${varName}.position.set(${obj.position.x}, ${obj.position.y}, ${obj.position.z});`);
        lines.push(
          `${pad}${varName}.rotation.set(${degToRadStr(obj.rotationDeg.x)}, ${degToRadStr(obj.rotationDeg.y)}, ${degToRadStr(obj.rotationDeg.z)});`,
        );
        lines.push(`${pad}${varName}.scale.set(${obj.scale.x}, ${obj.scale.y}, ${obj.scale.z});`);
        if (obj.castShadow) lines.push(`${pad}${varName}.castShadow = true;`);
        if (obj.receiveShadow) lines.push(`${pad}${varName}.receiveShadow = true;`);
        lines.push(`${pad}scene.add(${varName});`);
      }

      const endLine = lines.length;
      sourceMap.push({
        canvasNodeId: obj.id,
        startLine,
        startCol: indentSpaces + 1,
        endLine,
        endCol: (lines[endLine - 1]?.length ?? 1) + 1,
      });
      lines.push(``);

      if (obj.animation.kind !== 'none') {
        animatedVars.push({ varName, obj });
      }
    }

    lines.push(`${pad}const clock = new THREE.Clock();`);
    lines.push(`${pad}let rafId${typed ? ': number' : ''} = 0;`);
    lines.push(`${pad}function animate() {`);
    lines.push(`${pad}  rafId = requestAnimationFrame(animate);`);
    lines.push(`${pad}  const t = clock.getElapsedTime();`);
    if (animatedVars.length === 0) {
      lines.push(`${pad}  void t;`);
    }
    for (const { varName, obj } of animatedVars) {
      const spd = obj.animation.speed || 1;
      if (obj.animation.kind === 'spin') {
        lines.push(`${pad}  ${varName}.rotation.y = t * ${spd.toFixed(2)};`);
      } else if (obj.animation.kind === 'float') {
        lines.push(`${pad}  ${varName}.position.y = ${obj.position.y} + Math.sin(t * ${(spd * 2).toFixed(2)}) * 0.28;`);
      } else if (obj.animation.kind === 'pulse') {
        lines.push(`${pad}  const s_${varName} = 1 + Math.sin(t * ${(spd * 2.5).toFixed(2)}) * 0.12;`);
        lines.push(`${pad}  ${varName}.scale.setScalar(s_${varName});`);
      } else if (obj.animation.kind === 'orbit') {
        const radius = Math.max(1.5, Math.hypot(obj.position.x, obj.position.z));
        lines.push(`${pad}  ${varName}.position.x = Math.cos(t * ${spd.toFixed(2)}) * ${radius.toFixed(2)};`);
        lines.push(`${pad}  ${varName}.position.z = Math.sin(t * ${spd.toFixed(2)}) * ${radius.toFixed(2)};`);
      }
    }
    lines.push(`${pad}  renderer.render(scene, camera);`);
    lines.push(`${pad}}`);
    lines.push(`${pad}animate();`);
  };

  if (format === 'three-html') {
    lines.push(`<!DOCTYPE html>`);
    lines.push(`<html lang="it">`);
    lines.push(`<head>`);
    lines.push(`  <meta charset="UTF-8" />`);
    lines.push(`  <title>${scene.name} — Three.js Scene</title>`);
    lines.push(`  <style>html, body, #three-root { margin: 0; width: 100%; height: 100%; overflow: hidden; }</style>`);
    lines.push(`</head>`);
    lines.push(`<body>`);
    lines.push(`  <div id="three-root"></div>`);
    lines.push(`  <script type="module">`);
    lines.push(`    import * as THREE from 'https://unpkg.com/three@0.174.0/build/three.module.js';`);
    lines.push(`    const container = document.getElementById('three-root');`);
    emitImperativeBody(false, 4);
    lines.push(`  </script>`);
    lines.push(`</body>`);
    lines.push(`</html>`);

    return {
      code: lines.join('\n') + '\n',
      language: 'html',
      fileName: `${safeIdent(scene.name, 'scene')}.three.html`,
      sourceMap,
    };
  }

  // Default: `three-ts`
  const fnName = `mount${safeIdent(scene.name, 'ThreeScene')}`;
  lines.push(`import * as THREE from 'three';`);
  lines.push(``);
  lines.push(`export function ${fnName}(container: HTMLElement): () => void {`);
  emitImperativeBody(true, 2);
  lines.push(`  return () => {`);
  lines.push(`    cancelAnimationFrame(rafId);`);
  lines.push(`    renderer.dispose();`);
  lines.push(`    container.innerHTML = '';`);
  lines.push(`  };`);
  lines.push(`}`);

  return {
    code: lines.join('\n') + '\n',
    language: 'typescript',
    fileName: `${safeIdent(scene.name, 'scene')}.three.ts`,
    sourceMap,
  };
}
