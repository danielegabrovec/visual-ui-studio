import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createStarterDemoSheet } from '@shared/default-tokens';
import {
  compileThreeSceneToCode,
  createDefaultMaterial,
  createThreeLightObject,
  createThreeMeshObject,
  createThreeSceneFromPreset,
  THREE_SCENE_PRESETS,
  type ThreeGeometryKind,
  type ThreeLightKind,
  type ThreeSceneDocument,
} from '@shared/three-ir';
import { applyPatchOpsToSheet } from '@shared/ui-patch';
import {
  applyCameraRigToPerspective,
  createCameraRigFromSpec,
  createManagedThreeScene,
  disposeManagedThreeScene,
  orbitCameraRig,
  panCameraRig,
  raycastThreeSceneObject,
  stepThreeSceneAnimations,
  syncSceneDocumentToThree,
  zoomCameraRig,
} from '@renderer/components/ThreeEmbeddedPreview';

describe('Visual UI Studio v2.0 — Three.js 3D Studio, Presets, Codegen & Raycaster Engine', () => {
  const projectId = 'proj_three_test';

  it('provides all 4 curated 3D scene presets with valid camera, environment, lights, and meshes', () => {
    expect(THREE_SCENE_PRESETS.map((p) => p.id)).toEqual([
      'pbr-product-showcase',
      'scifi-orbital-system',
      'cyberpunk-neon-grid',
      'studio-three-point-light',
    ]);

    for (const preset of THREE_SCENE_PRESETS) {
      const scene = createThreeSceneFromPreset(projectId, preset.id, `scene_${preset.id}`);
      expect(scene.id).toBe(`scene_${preset.id}`);
      expect(scene.projectId).toBe(projectId);
      expect(scene.presetId).toBe(preset.id);
      expect(scene.camera.fov).toBeGreaterThanOrEqual(35);
      expect(scene.environment.backgroundColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(scene.objects.some((o) => o.nodeType === 'light')).toBe(true);
      expect(scene.objects.some((o) => o.nodeType === 'mesh')).toBe(true);
    }
  });

  it('supports complete ThreeSceneDocument CRUD across all 9 geometries, 4 light types, materials, visibility, duplicate, and delete', () => {
    let scene: ThreeSceneDocument = createThreeSceneFromPreset(
      projectId,
      'pbr-product-showcase',
      'scene_crud',
    );
    const initialCount = scene.objects.length;

    const allGeometries: ThreeGeometryKind[] = [
      'box',
      'sphere',
      'cylinder',
      'cone',
      'torus',
      'torusKnot',
      'plane',
      'icosahedron',
      'particles',
    ];
    for (const geo of allGeometries) {
      const mesh = createThreeMeshObject(geo, {
        name: `Added_${geo}`,
        material: createDefaultMaterial({
          kind: geo === 'torusKnot' ? 'physical' : geo === 'cylinder' ? 'toon' : 'standard',
          color: '#22d3ee',
          metalness: 0.75,
          roughness: 0.2,
          wireframe: geo === 'icosahedron',
        }),
      });
      expect(mesh.nodeType).toBe('mesh');
      expect(mesh.geometry).toBe(geo);
      if (geo === 'plane') {
        expect(mesh.rotationDeg.x).toBe(-90);
      }
      if (geo === 'particles') {
        expect(mesh.particleCount).toBeGreaterThan(0);
      }
      scene = { ...scene, objects: [...scene.objects, mesh] };
    }

    const allLights: ThreeLightKind[] = ['ambient', 'directional', 'point', 'spot'];
    for (const lk of allLights) {
      const light = createThreeLightObject(lk, { name: `Light_${lk}` });
      expect(light.nodeType).toBe('light');
      expect(light.light?.lightKind).toBe(lk);
      scene = { ...scene, objects: [...scene.objects, light] };
    }

    expect(scene.objects).toHaveLength(initialCount + allGeometries.length + allLights.length);

    // Update transform, PBR material & animation on an object
    const targetId = scene.objects.find((o) => o.name === 'Added_sphere')!.id;
    scene = {
      ...scene,
      objects: scene.objects.map((o) =>
        o.id === targetId
          ? {
              ...o,
              position: { x: 2.5, y: 1.8, z: -1.2 },
              rotationDeg: { x: 15, y: 45, z: 0 },
              scale: { x: 1.4, y: 1.4, z: 1.4 },
              material: createDefaultMaterial({
                kind: 'physical',
                color: '#ec4899',
                emissive: '#be185d',
                emissiveIntensity: 0.6,
                metalness: 0.9,
                roughness: 0.1,
                clearcoat: 0.95,
              }),
              animation: { kind: 'orbit', speed: 1.8 },
            }
          : o,
      ),
    };
    const updatedSphere = scene.objects.find((o) => o.id === targetId)!;
    expect(updatedSphere.position).toEqual({ x: 2.5, y: 1.8, z: -1.2 });
    expect(updatedSphere.material?.clearcoat).toBe(0.95);
    expect(updatedSphere.animation.kind).toBe('orbit');

    // Duplicate object
    const duplicated = {
      ...structuredClone(updatedSphere),
      id: 'dup_sphere_1',
      name: `${updatedSphere.name}_Copy`,
    };
    scene = { ...scene, objects: [...scene.objects, duplicated] };
    expect(scene.objects.some((o) => o.id === 'dup_sphere_1')).toBe(true);

    // Toggle visibility off -> excluded from emitted Three.js code & sourceMap
    scene = {
      ...scene,
      objects: scene.objects.map((o) => (o.id === 'dup_sphere_1' ? { ...o, visible: false } : o)),
    };
    const compiledAfterHide = compileThreeSceneToCode(scene, 'three-ts');
    expect(compiledAfterHide.code).not.toContain('Added_sphere_Copy');
    expect(compiledAfterHide.sourceMap.some((s) => s.canvasNodeId === 'dup_sphere_1')).toBe(false);

    // Delete object
    scene = { ...scene, objects: scene.objects.filter((o) => o.id !== 'dup_sphere_1') };
    expect(scene.objects.some((o) => o.id === 'dup_sphere_1')).toBe(false);
  });

  it('compiles ThreeSceneDocument to three-ts, r3f-tsx, and three-html with exact per-object SourceMap line spans', () => {
    const scene = createThreeSceneFromPreset(projectId, 'scifi-orbital-system', 'scene_codegen');
    const visibleObjects = scene.objects.filter((o) => o.visible);

    // 1. Vanilla Three.js TypeScript (`three-ts`)
    const tsOut = compileThreeSceneToCode(scene, 'three-ts');
    expect(tsOut.language).toBe('typescript');
    expect(tsOut.fileName).toBe('SciFiOrbitalScene.three.ts');
    expect(tsOut.code).toContain("import * as THREE from 'three';");
    expect(tsOut.code).toContain('export function mountSciFiOrbitalScene(container: HTMLElement)');
    expect(tsOut.code).toContain('new THREE.Points(');
    expect(tsOut.code).toContain('renderer.dispose();');
    expect(tsOut.sourceMap).toHaveLength(visibleObjects.length);

    const tsLines = tsOut.code.split('\n');
    for (const obj of visibleObjects) {
      const span = tsOut.sourceMap.find((s) => s.canvasNodeId === obj.id);
      expect(span).toBeDefined();
      expect(span!.startLine).toBeGreaterThanOrEqual(1);
      expect(span!.endLine).toBeGreaterThanOrEqual(span!.startLine);
      const snippet = tsLines.slice(span!.startLine - 1, span!.endLine).join('\n');
      expect(snippet).toContain(obj.name);
    }

    // 2. React Three Fiber TSX (`r3f-tsx`)
    const r3fOut = compileThreeSceneToCode(scene, 'r3f-tsx');
    expect(r3fOut.language).toBe('tsx');
    expect(r3fOut.fileName).toBe('SciFiOrbitalScene.tsx');
    expect(r3fOut.code).toContain("from '@react-three/fiber'");
    expect(r3fOut.code).toContain('<Canvas shadows');
    expect(r3fOut.code).toContain('<OrbitControls');
    expect(r3fOut.sourceMap).toHaveLength(visibleObjects.length);

    const r3fLines = r3fOut.code.split('\n');
    for (const obj of visibleObjects) {
      const span = r3fOut.sourceMap.find((s) => s.canvasNodeId === obj.id)!;
      const snippet = r3fLines.slice(span.startLine - 1, span.endLine).join('\n');
      expect(snippet).toContain(`name="${obj.name}"`);
    }

    // 3. Standalone HTML5 + Three.js ES Module (`three-html`)
    const htmlOut = compileThreeSceneToCode(scene, 'three-html');
    expect(htmlOut.language).toBe('html');
    expect(htmlOut.fileName).toBe('SciFiOrbitalScene.three.html');
    expect(htmlOut.code).toContain('<!DOCTYPE html>');
    expect(htmlOut.code).toContain('<script type="module">');
    expect(htmlOut.sourceMap).toHaveLength(visibleObjects.length);

    const htmlLines = htmlOut.code.split('\n');
    for (const obj of visibleObjects) {
      const span = htmlOut.sourceMap.find((s) => s.canvasNodeId === obj.id)!;
      const snippet = htmlLines.slice(span.startLine - 1, span.endLine).join('\n');
      expect(snippet).toContain(obj.name);
    }
  });

  it('embeds a <ThreeViewport> (controlType: three-viewport) into a 2D UISheetDocument cleanly', () => {
    const sheet = createStarterDemoSheet(projectId, 'sheet_embed_3d');
    const scene = createThreeSceneFromPreset(projectId, 'cyberpunk-neon-grid', 'scene_cyber_99');

    const { nextSheet, inverseOps } = applyPatchOpsToSheet(sheet, [
      {
        op: 'insert_node',
        parentId: sheet.rootIds[0],
        node: {
          id: 'nd_three_embed_1',
          kind: 'control',
          name: 'CyberViewport3D',
          semanticTag: 'div',
          layout: {
            mode: 'freeform',
            positioning: 'absolute',
            frame: { x: 96, y: 112, width: 480, height: 320 },
            width: { mode: 'fixed', value: 480 },
            height: { mode: 'fixed', value: 320 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
          content: {
            controlType: 'three-viewport',
            text: `Scena 3D: ${scene.name}`,
            threeSceneId: scene.id,
          },
        },
      },
    ]);

    const embedded = nextSheet.nodes.nd_three_embed_1;
    expect(embedded).toBeDefined();
    expect(embedded.content?.controlType).toBe('three-viewport');
    expect(embedded.content?.threeSceneId).toBe('scene_cyber_99');
    expect(embedded.layout.positioning).toBe('absolute');

    const undone = applyPatchOpsToSheet(nextSheet, inverseOps).nextSheet;
    expect(undone.nodes.nd_three_embed_1).toBeUndefined();
  });

  it('reconciles live THREE.Scene objects, steps animations, orbits/pans/zooms camera, and picks 3D meshes via THREE.Raycaster', () => {
    const doc = createThreeSceneFromPreset(projectId, 'pbr-product-showcase', 'scene_live_raycast');
    const managed = createManagedThreeScene();
    const camera = new THREE.PerspectiveCamera(doc.camera.fov, 16 / 9, 0.1, 200);

    // Camera spherical rig math: Orbit, Pan, Zoom
    let rig = createCameraRigFromSpec(doc.camera);
    const initialRadius = rig.radius;
    rig = zoomCameraRig(rig, 0.85);
    expect(rig.radius).toBeLessThan(initialRadius);
    const orbited = orbitCameraRig(rig, 40, -20);
    expect(orbited.theta).not.toBe(rig.theta);
    const panned = panCameraRig(orbited, 24, 16);
    expect(panned.target).not.toEqual(orbited.target);

    // Reset camera directly looking at HeroMesh (mesh_hero_knot at 0, 1.35, 0)
    const centeredRig = createCameraRigFromSpec({
      fov: 48,
      position: { x: 0, y: 1.35, z: 6.0 },
      target: { x: 0, y: 1.35, z: 0 },
    });
    applyCameraRigToPerspective(camera, centeredRig);

    syncSceneDocumentToThree(managed, doc, 'mesh_hero_knot', true);
    expect(managed.objectMap.size).toBe(doc.objects.length);
    expect(managed.gridHelper?.visible).toBe(true);
    expect(managed.axesHelper?.visible).toBe(true);
    expect(managed.selectionHelper?.visible).toBe(true);

    // Project a point on HeroMesh's torus-knot tube (world x=0.95, y=1.35, z=0) & raycast -> picks mesh_hero_knot
    const knotTubeNdc = new THREE.Vector3(0.95, 1.35, 0).project(camera);
    const pickedHero = raycastThreeSceneObject(managed, camera, knotTubeNdc.x, knotTubeNdc.y);
    expect(pickedHero).toBe('mesh_hero_knot');

    // Project StagePedestal center (world x=0, y=0.15, z=1.0) & raycast -> picks mesh_stage_pedestal
    const pedestalNdc = new THREE.Vector3(0, 0.15, 1.0).project(camera);
    const pickedPedestal = raycastThreeSceneObject(managed, camera, pedestalNdc.x, pedestalNdc.y);
    expect(pickedPedestal).toBe('mesh_stage_pedestal');

    // Raycast top-left corner empty sky (NDC -0.98, 0.98) -> null
    const pickedEmpty = raycastThreeSceneObject(managed, camera, -0.98, 0.98);
    expect(pickedEmpty).toBeNull();

    // Step animation loop -> HeroMesh ('spin') rotates around Y
    const heroObj = managed.objectMap.get('mesh_hero_knot')!;
    const rotBefore = heroObj.rotation.y;
    stepThreeSceneAnimations(managed, doc, 1.25);
    expect(heroObj.rotation.y).toBeGreaterThan(rotBefore);

    disposeManagedThreeScene(managed);
    expect(managed.objectMap.size).toBe(0);
  });
});
