'use client';

// ============================================================
// PixelMorpher - 3D 骨骼点击拾取器
// 加载 glTF → 按主导 bone 染 ID 色 → OrbitControls 旋转 → 点击射线拾取 bone
// 用于手动指定拇指/手指 bone（自动匹配失败时的 fallback）
// ============================================================

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface BonePicker3DProps {
  input: string | ArrayBuffer;
  /** 点击命中 bone 时回调（bone 名） */
  onPick: (boneName: string) => void;
  /** 高亮的 bone 名（染红） */
  highlightBone?: string | null;
  width?: number;
  height?: number;
}

interface PickMeshInfo {
  mesh: THREE.SkinnedMesh;
  vBone: Int32Array; // per-vertex 主导 bone（skeleton 内索引）
  bones: THREE.Bone[];
  colorAttr: THREE.BufferAttribute;
  baseColors: Float32Array; // 原始 ID 色（高亮恢复用）
}

function encodeBoneColor(idx: number): [number, number, number] {
  const v = idx + 1;
  return [((v & 0xff) / 255), (((v >> 8) & 0xff) / 255), (((v >> 16) & 0xff) / 255)];
}

export default function BonePicker3D({
  input,
  onPick,
  highlightBone,
  width = 300,
  height = 300,
}: BonePicker3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const pickInfosRef = useRef<PickMeshInfo[]>([]);

  // 高亮更新
  useEffect(() => {
    for (const info of pickInfosRef.current) {
      const hiIdx = highlightBone
        ? info.bones.findIndex((b) => (b.name || '') === highlightBone)
        : -1;
      const arr = info.colorAttr.array as Float32Array;
      for (let vi = 0; vi < info.vBone.length; vi++) {
        const o = vi * 3;
        if (info.vBone[vi] === hiIdx && hiIdx >= 0) {
          arr[o] = 1; arr[o + 1] = 0.1; arr[o + 2] = 0.1; // 红色高亮
        } else {
          arr[o] = info.baseColors[o];
          arr[o + 1] = info.baseColors[o + 1];
          arr[o + 2] = info.baseColors[o + 2];
        }
      }
      info.colorAttr.needsUpdate = true;
    }
  }, [highlightBone]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(1.2, 0.8, 2.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.2));

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pickMeshes: THREE.SkinnedMesh[] = [];
    pickInfosRef.current = [];

    const handleClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickMeshes, false);
      if (hits.length === 0) return;
      const h = hits[0];
      const vi = h.face?.a;
      if (vi === undefined || vi === null) return;
      const info = pickInfosRef.current.find((p) => p.mesh === h.object);
      if (!info) return;
      const bi = info.vBone[vi];
      const bone = info.bones[bi];
      if (bone?.name) onPickRef.current(bone.name);
    };
    renderer.domElement.addEventListener('click', handleClick);
    renderer.domElement.style.cursor = 'crosshair';

    let raf = 0;
    const animate = () => {
      if (disposed) return;
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };

    (async () => {
      try {
        const loader = new GLTFLoader();
        const gltf =
          typeof input === 'string'
            ? await loader.loadAsync(input)
            : await loader.parseAsync(input, '');
        if (disposed) return;
        const model = gltf.scene;
        model.updateMatrixWorld(true);

        // 归一化：包围球直径 2，中心到原点
        const bbox = new THREE.Box3().setFromObject(model);
        const center = bbox.getCenter(new THREE.Vector3());
        const sphere = bbox.getBoundingSphere(new THREE.Sphere());
        const scale = sphere.radius > 1e-6 ? 1 / sphere.radius : 1;

        const group = new THREE.Group();
        model.traverse((o) => {
          const m = o as THREE.SkinnedMesh;
          if (!m.isSkinnedMesh) return;
          const geo = m.geometry;
          const pos = geo.getAttribute('position') as THREE.BufferAttribute;
          const skinIndex = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
          const skinWeight = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
          if (!skinIndex || !skinWeight) return;

          const bones = m.skeleton.bones as THREE.Bone[];
          const vBone = new Int32Array(pos.count);
          for (let vi = 0; vi < pos.count; vi++) {
            let best = 0;
            let bestW = -1;
            for (let j = 0; j < 4; j++) {
              const bi = Math.round(skinIndex.getComponent(vi, j));
              const w = skinWeight.getComponent(vi, j);
              if (w > bestW) { bestW = w; best = bi; }
            }
            vBone[vi] = best;
          }

          // 顶点色：bone → ID 色；顶点先归一化
          const colors = new Float32Array(pos.count * 3);
          for (let vi = 0; vi < pos.count; vi++) {
            const [r, g, b] = encodeBoneColor(vBone[vi]);
            colors[vi * 3] = r;
            colors[vi * 3 + 1] = g;
            colors[vi * 3 + 2] = b;
            // 归一化顶点（直接改 clone 的几何）
          }
          const geo2 = geo.clone();
          const p2 = geo2.getAttribute('position') as THREE.BufferAttribute;
          const v = new THREE.Vector3();
          for (let vi = 0; vi < p2.count; vi++) {
            v.fromBufferAttribute(p2, vi)
              .applyMatrix4(m.matrixWorld)
              .sub(center)
              .multiplyScalar(scale);
            p2.setXYZ(vi, v.x, v.y, v.z);
          }
          geo2.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          geo2.computeVertexNormals();
          const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
          const pickMesh = new THREE.Mesh(geo2, mat) as unknown as THREE.SkinnedMesh;
          pickMesh.frustumCulled = false;
          // vBone 按原顶点顺序，geo.clone() 保持顶点顺序一致
          pickInfosRef.current.push({
            mesh: pickMesh,
            vBone,
            bones,
            colorAttr: geo2.getAttribute('color') as THREE.BufferAttribute,
            baseColors: colors.slice(),
          });
          pickMeshes.push(pickMesh);
          group.add(pickMesh);
        });
        scene.add(group);
        animate();
      } catch (e) {
        console.error('[BonePicker3D] 加载失败', e);
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('click', handleClick);
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch { /* noop */ }
      mount.removeChild(renderer.domElement);
      pickInfosRef.current = [];
    };
  }, [input, width, height]);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={mountRef}
        className="overflow-hidden rounded border border-[#2a2a4a]"
        style={{ width, height }}
      />
      <div className="text-[10px] text-gray-500">拖拽旋转 · 点击模型拾取骨骼</div>
    </div>
  );
}
