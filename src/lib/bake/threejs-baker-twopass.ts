// ============================================================
// PixelMorpher - three.js 双遍 ID 缓冲烘焙（按骨骼拆分）
// 每个方向渲染 2 遍：
//   pass 0: 正常 Z (LessEqual) → 前肢颜色 + ID
//   pass 1: 反转 Z (Greater)   → 后肢颜色 + ID（被遮挡部分）
// ID 图：每顶点按主导 bone（skinIndices 最大权重）染唯一色。
// 2D 端按 ID 拆 bone：像素 = pass0(ID==bone) ∪ pass1(ID==bone)，完整无洞。
// 仅浏览器环境可用(WebGL)。
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BakeOptions, BakeResult } from './threejs-baker';
import { medianCut, nearestPaletteIndex } from './threejs-baker';

export interface BakedBoneInfo {
  index: number;
  name: string;
  parentIndex: number | null;
  /** bind pose 世界坐标（模型空间，未归一化） */
  bindPos: { x: number; y: number; z: number };
  /** 8 方向关节在整图中的像素坐标（top-down） */
  jointPixels: Array<{ x: number; y: number }>;
}

export interface TwoPassGroup {
  direction: number;
  /** 0=前（LessEqualDepth），1=后（GreaterDepth） */
  pass: 0 | 1;
  colorPixels: Uint8ClampedArray;
  idPixels: Uint8ClampedArray;
}

export interface TwoPassBakeData {
  bones: BakedBoneInfo[];
  /** 16 组：8 方向 × 2 遍 */
  groups: TwoPassGroup[];
  width: number;
  height: number;
  normalization: { center: { x: number; y: number; z: number }; scale: number };
  /** bone 合并信息（粗粒度下有效 bone 数 < 全部 bone 数） */
  merge: BoneMergeInfo;
}

export interface TwoPassBakeOptions extends BakeOptions {
  onProgress?: (done: number, total: number, label: string) => void;
  /** 拆分粒度：coarse（默认，合并手指/脚趾/小 bone）| fine（一个 bone 一个节点，调试用） */
  granularity?: BoneGranularity;
  /** 小 bone 合并阈值（顶点数，粗粒度下 leaf bone 小于此值并入父 bone），默认 50 */
  smallBoneThreshold?: number;
  /** 手动合并：boneIndex → 目标 boneIndex（优先于自动规则） */
  manualMerges?: Map<number, number>;
  /** 手动取消合并：boneIndex 集合（强制保持独立，跳过自动规则） */
  manualUnmerges?: Set<number>;
  /**
   * 仅重渲 ID（改合并设置后用）：跳过 toon 颜色遍，复用 reuseBake 的颜色。
   * 颜色与合并无关，只需 ID 重新染色。8 遍代替 16 遍。
   */
  idOnly?: boolean;
  /** idOnly 时复用此前烘焙的颜色（同模型同尺寸） */
  reuseBake?: TwoPassBakeData;
}

/** 拆分粒度 */
export type BoneGranularity = 'coarse' | 'fine';

/** bone 合并信息：boneIndex → 有效 boneIndex（合并目标） */
export interface BoneMergeInfo {
  /** boneIndex → effectiveBoneIndex（未合并则为自身） */
  effectiveIndex: number[];
  /** 去重后的有效 bone 索引（即 ID 图中实际出现的） */
  effectiveBones: number[];
  /** 合并原因（调试用）：boneIndex → 说明 */
  reasons: Record<number, string>;
  /** 手动合并：boneIndex → 目标 boneIndex（用户指定，优先于自动规则） */
  manualMerges: Map<number, number>;
  /** 手动取消合并：boneIndex 集合（用户指定保持独立，跳过自动规则） */
  manualUnmerges: Set<number>;
}

const FINGER_TOE_RE = /finger|thumb|index|middle|ring|pinky|little|digit|toe/i;
const HAND_FOOT_RE = /hand|foot|wrist|ankle/i;

/**
 * 计算 bone 合并映射。
 * 粗粒度规则：
 *  1. 手指/脚趾 bone → 并入最近的手/脚祖先（找不到则并入直接父级）；
 *  2. 顶点数 < 阈值的 leaf bone → 并入父 bone（root 永不合并）。
 * 细粒度：恒等映射。
 * 手动覆盖（优先级最高）：
 *  - manualMerges：强制 boneIndex → 目标（先应用，自动规则跳过已手动指定的）；
 *  - manualUnmerges：强制保持独立（自动规则跳过）。
 * 传递闭包保证 A→B→C 时 A 最终到 C。
 */
export function computeBoneMerge(
  boneNames: string[],
  parentIndex: (number | null)[],
  vertexCounts: number[],
  granularity: BoneGranularity,
  smallThreshold: number,
  manualMerges?: Map<number, number>,
  manualUnmerges?: Set<number>,
): BoneMergeInfo {
  const n = boneNames.length;
  const effectiveIndex = Array.from({ length: n }, (_, i) => i);
  const reasons: Record<number, string> = {};
  const mm = manualMerges ?? new Map<number, number>();
  const mu = manualUnmerges ?? new Set<number>();
  if (granularity === 'fine') {
    // 细粒度下仍尊重手动合并（用户显式要求）
    const directTarget = Array.from({ length: n }, (_, i) => i);
    for (const [src, dst] of mm) {
      if (src < 0 || src >= n || dst < 0 || dst >= n || src === dst) continue;
      directTarget[src] = dst;
      reasons[src] = `手动并入 ${boneNames[dst]}`;
    }
    const resolveFine = (i: number): number => {
      let cur = i;
      const seen = new Set<number>([i]);
      while (directTarget[cur] !== cur) {
        cur = directTarget[cur];
        if (seen.has(cur)) break;
        seen.add(cur);
      }
      return cur;
    };
    for (let i = 0; i < n; i++) effectiveIndex[i] = resolveFine(i);
    const effectiveBones = [...new Set(effectiveIndex)].sort((a, b) => a - b);
    return { effectiveIndex, effectiveBones, reasons, manualMerges: mm, manualUnmerges: mu };
  }

  const directTarget = Array.from({ length: n }, (_, i) => i);
  // 手动合并优先：先应用，自动规则跳过已手动指定的 bone
  for (const [src, dst] of mm) {
    if (src < 0 || src >= n || dst < 0 || dst >= n || src === dst) continue;
    if (parentIndex[src] === null) continue; // root 永不合并
    directTarget[src] = dst;
    reasons[src] = `手动并入 ${boneNames[dst]}`;
  }
  const childrenOf = (i: number): number[] => {
    const out: number[] = [];
    for (let j = 0; j < n; j++) if (parentIndex[j] === i) out.push(j);
    return out;
  };
  const isRoot = (i: number): boolean => parentIndex[i] === null;

  // 规则 1：手指/脚趾 → 手/脚（跳过手动指定/手动取消的）
  for (let i = 0; i < n; i++) {
    if (isRoot(i)) continue;
    if (directTarget[i] !== i) continue; // 已手动合并
    if (mu.has(i)) continue; // 手动取消合并，保持独立
    if (!FINGER_TOE_RE.test(boneNames[i])) continue;
    // 向上找手/脚祖先（排除自己这种手指名）
    let p = parentIndex[i];
    let target: number | null = null;
    while (p !== null && p !== undefined) {
      if (HAND_FOOT_RE.test(boneNames[p]) && !FINGER_TOE_RE.test(boneNames[p])) {
        target = p;
        break;
      }
      p = parentIndex[p];
    }
    if (target === null) target = parentIndex[i]!;
    if (target !== i) {
      directTarget[i] = target;
      reasons[i] = `手指/脚趾并入 ${boneNames[target]}`;
    }
  }

  // 规则 2：小 leaf bone → 父 bone（自底向上一遍；用原始层级判 leaf）
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    // 深度大的先（叶子优先）
    let da = 0, db = 0;
    let pa = parentIndex[a], pb = parentIndex[b];
    while (pa !== null && pa !== undefined) { da++; pa = parentIndex[pa]; }
    while (pb !== null && pb !== undefined) { db++; pb = parentIndex[pb]; }
    return db - da;
  });
  for (const i of order) {
    if (directTarget[i] !== i) continue; // 已被规则 1/手动合并
    if (mu.has(i)) continue; // 手动取消合并，保持独立
    if (isRoot(i)) continue;
    if (childrenOf(i).length > 0) continue; // 非叶子
    if ((vertexCounts[i] ?? 0) >= smallThreshold) continue;
    const p = parentIndex[i]!;
    directTarget[i] = p;
    reasons[i] = `小 bone（${vertexCounts[i] ?? 0} 顶点 < ${smallThreshold}）并入 ${boneNames[p]}`;
  }

  // 传递闭包：effective[i] = directTarget 链的终点
  const resolve = (i: number): number => {
    let cur = i;
    const seen = new Set<number>([i]);
    while (directTarget[cur] !== cur) {
      cur = directTarget[cur];
      if (seen.has(cur)) break; // 防环（理论上不会发生，合并只向上）
      seen.add(cur);
    }
    return cur;
  };
  for (let i = 0; i < n; i++) effectiveIndex[i] = resolve(i);
  const effectiveBones = [...new Set(effectiveIndex)].sort((a, b) => a - b);
  return { effectiveIndex, effectiveBones, reasons, manualMerges: mm, manualUnmerges: mu };
}

/**
 * 统计每 bone 的主导顶点数（与 assignBoneVertexColors 同一判定逻辑）。
 * SkinnedMesh：skinIndices 最大权重；普通 Mesh：整 mesh 计入最近 bone。
 */
function countBoneVertices(
  model: THREE.Object3D,
  indexByBone: Map<THREE.Bone, number>,
  boneBindPos: THREE.Vector3[],
  boneCount: number,
): number[] {
  const counts = new Array<number>(boneCount).fill(0);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const sm = mesh as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh && geo.getAttribute('skinIndex')) {
      const skinIndex = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
      const skinWeight = geo.getAttribute('skinWeight') as THREE.BufferAttribute;
      const pos = geo.getAttribute('position');
      const skeleton = sm.skeleton;
      for (let v = 0; v < pos.count; v++) {
        let bestJ = 0;
        let bestW = -Infinity;
        for (let j = 0; j < 4; j++) {
          const w = skinWeight.getComponent(v, j);
          if (w > bestW) { bestW = w; bestJ = j; }
        }
        const jointIdx = Math.round(skinIndex.getComponent(v, bestJ));
        const bone = skeleton.bones[jointIdx];
        const gi = bone ? (indexByBone.get(bone) ?? -1) : -1;
        if (gi >= 0) counts[gi]++;
      }
    } else {
      geo.computeBoundingBox();
      const c = new THREE.Vector3();
      geo.boundingBox!.getCenter(c);
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < boneBindPos.length; i++) {
        const d = c.distanceToSquared(boneBindPos[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      const pos = geo.getAttribute('position');
      counts[best] += pos.count;
    }
  });
  return counts;
}

/** bone index → RGB（+1 偏移，0 保留给背景） */
export function encodeBoneId(index: number): [number, number, number] {
  const v = index + 1;
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
}

/** RGB → bone index（-1 = 背景/无效） */
export function decodeBoneId(r: number, g: number, b: number): number {
  return (r | (g << 8) | (b << 16)) - 1;
}

/** 收集场景中所有 Bone，建立全局索引 */
function collectBones(scene: THREE.Object3D): {
  bones: THREE.Bone[];
  indexByBone: Map<THREE.Bone, number>;
  parentIndex: (number | null)[];
} {
  const bones: THREE.Bone[] = [];
  const indexByBone = new Map<THREE.Bone, number>();
  scene.traverse((o) => {
    const b = o as THREE.Bone;
    if (b.isBone) {
      indexByBone.set(b, bones.length);
      bones.push(b);
    }
  });
  const parentIndex = bones.map((b) => {
    const p = b.parent as THREE.Bone | null;
    if (p && p.isBone && indexByBone.has(p)) return indexByBone.get(p)!;
    return null;
  });
  return { bones, indexByBone, parentIndex };
}

/**
 * 给 mesh 加逐顶点 bone ID 颜色属性（ID 图用）。
 * SkinnedMesh：按 skinIndices 最大权重的主导 bone。
 * 普通 Mesh：按质心找最近 bone，全顶点同色。
 * ID 颜色使用合并后的有效 bone 索引（effectiveIndex），不是原始 bone。
 */
function assignBoneVertexColors(
  mesh: THREE.Mesh,
  indexByBone: Map<THREE.Bone, number>,
  boneBindPos: THREE.Vector3[],
  effectiveIndex: number[],
): void {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const sm = mesh as THREE.SkinnedMesh;

  if (sm.isSkinnedMesh && geo.getAttribute('skinIndex')) {
    const skinIndex = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
    const skinWeight = geo.getAttribute('skinWeight') as THREE.BufferAttribute;
    const skeleton = sm.skeleton;
    for (let v = 0; v < pos.count; v++) {
      let bestJ = 0;
      let bestW = -Infinity;
      for (let j = 0; j < 4; j++) {
        const w = skinWeight.getComponent(v, j);
        if (w > bestW) { bestW = w; bestJ = j; }
      }
      const jointIdx = Math.round(skinIndex.getComponent(v, bestJ));
      const bone = skeleton.bones[jointIdx];
      const gi = bone ? (indexByBone.get(bone) ?? -1) : -1;
      // 用合并后的有效 bone 染 ID（手指等并入手/脚）
      const ei = gi >= 0 ? (effectiveIndex[gi] ?? gi) : -1;
      const [r, g, b] = ei >= 0 ? encodeBoneId(ei) : [0, 0, 0];
      colors[v * 3] = r / 255;
      colors[v * 3 + 1] = g / 255;
      colors[v * 3 + 2] = b / 255;
    }
  } else {
    // 非蒙皮 mesh：质心找最近 bone
    geo.computeBoundingBox();
    const c = new THREE.Vector3();
    geo.boundingBox!.getCenter(c);
    // 注意：此时 mesh 还没归一化，bindPos 也是模型空间，一致
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < boneBindPos.length; i++) {
      const d = c.distanceToSquared(boneBindPos[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    const ei = effectiveIndex[best] ?? best;
    const [r, g, b] = encodeBoneId(ei);
    for (let v = 0; v < pos.count; v++) {
      colors[v * 3] = r / 255;
      colors[v * 3 + 1] = g / 255;
      colors[v * 3 + 2] = b / 255;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** 卡通渐变贴图（复用 MVP 逻辑） */
function makeGradientMap(steps: number): THREE.DataTexture {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    data[i] = Math.round((i / (steps - 1)) * 255);
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** 换卡通材质（保留原贴图/基色），返回 mesh→toon 材质映射 */
function applyToonMaterials(root: THREE.Object3D, gradientMap: THREE.Texture): Map<THREE.Mesh, THREE.Material> {
  const map = new Map<THREE.Mesh, THREE.Material>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    const old = mesh.material as THREE.MeshStandardMaterial | undefined;
    const baseColor =
      old && 'color' in old && (old as THREE.MeshStandardMaterial).color
        ? ((old as THREE.MeshStandardMaterial).color as THREE.Color).clone()
        : new THREE.Color(0xffffff);
    const texMap =
      old && 'map' in old ? ((old as THREE.MeshStandardMaterial).map as THREE.Texture | null) : null;
    const tm = new THREE.MeshToonMaterial({
      color: baseColor,
      map: texMap ?? undefined,
      gradientMap,
    });
    map.set(mesh, tm);
    mesh.material = tm;
    if (old && old !== tm) old.dispose();
  });
  return map;
}

/** 轻量 bone 信息（解析用，不渲染） */
export interface ParsedBoneInfo {
  index: number;
  name: string;
  parentIndex: number | null;
  /** 主导顶点数（与 ID 染色同一判定逻辑） */
  vertexCount: number;
}

/**
 * 轻量解析模型骨骼（不创建 WebGL 上下文、不渲染）。
 * 用于烘焙前的骨骼合并 UI：显示 bone 树、顶点数、自动合并预览。
 */
export async function parseModelBones(
  input: string | ArrayBuffer,
): Promise<ParsedBoneInfo[]> {
  if (typeof window === 'undefined') {
    throw new Error('parseModelBones 仅支持浏览器环境');
  }
  const loader = new GLTFLoader();
  const gltf =
    typeof input === 'string' ? await loader.loadAsync(input) : await loader.parseAsync(input, '');
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  const { bones, indexByBone, parentIndex } = collectBones(model);
  if (bones.length === 0) throw new Error('模型中没有找到骨骼 (Bone)');

  const bindPos = bones.map((b) => {
    const v = new THREE.Vector3();
    b.getWorldPosition(v);
    return v;
  });
  const vertexCounts = countBoneVertices(model, indexByBone, bindPos, bones.length);

  return bones.map((b, i) => ({
    index: i,
    name: b.name || `bone_${i}`,
    parentIndex: parentIndex[i],
    vertexCount: vertexCounts[i] ?? 0,
  }));
}

/**
 * 双遍 ID 缓冲烘焙。
 * 每个方向 4 次渲染（前颜色/前ID/后颜色/后ID），共 8 方向 → 16 组。
 */
export async function bakeModelTwoPass(
  input: string | ArrayBuffer,
  options: TwoPassBakeOptions = {},
): Promise<TwoPassBakeData> {
  const size = options.size ?? 128;
  const toonSteps = options.toonSteps ?? 3;
  const onProgress = options.onProgress;
  const granularity: BoneGranularity = options.granularity ?? 'coarse';
  const smallBoneThreshold = options.smallBoneThreshold ?? 50;
  const manualMerges = options.manualMerges;
  const manualUnmerges = options.manualUnmerges;
  const idOnly = options.idOnly ?? false;
  const reuseBake = options.reuseBake;
  if (idOnly && !reuseBake) {
    throw new Error('idOnly 需要提供 reuseBake');
  }

  if (typeof window === 'undefined') {
    throw new Error('bakeModelTwoPass 仅支持浏览器环境(WebGL)');
  }

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.toneMapping = THREE.NoToneMapping;

  try {
    const loader = new GLTFLoader();
    const gltf =
      typeof input === 'string' ? await loader.loadAsync(input) : await loader.parseAsync(input, '');
    const model = gltf.scene;
    model.updateMatrixWorld(true);

    // ---- bones ----
    const { bones, indexByBone, parentIndex } = collectBones(model);
    if (bones.length === 0) throw new Error('模型中没有找到骨骼 (Bone)');

    let meshCount = 0;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        meshCount++;
        m.frustumCulled = false;
        const sm = o as THREE.SkinnedMesh;
        if (sm.isSkinnedMesh) sm.skeleton.update();
      }
    });
    if (meshCount === 0) throw new Error('模型中没有找到 Mesh');

    const bindPos = bones.map((b) => {
      const v = new THREE.Vector3();
      b.getWorldPosition(v);
      return v;
    });

    // ---- 逐顶点 bone ID 颜色（用合并后的有效 bone 染） ----
    const vertexCounts = countBoneVertices(model, indexByBone, bindPos, bones.length);
    const merge = computeBoneMerge(
      bones.map((b) => b.name || ''),
      parentIndex,
      vertexCounts,
      granularity,
      smallBoneThreshold,
      manualMerges,
      manualUnmerges,
    );
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) assignBoneVertexColors(m, indexByBone, bindPos, merge.effectiveIndex);
    });

    // ---- 归一化 ----
    const bbox = new THREE.Box3().setFromObject(model);
    const center = bbox.getCenter(new THREE.Vector3());
    const sphere = bbox.getBoundingSphere(new THREE.Sphere());
    const group = new THREE.Group();
    group.add(model);
    model.position.sub(center);
    const scale = sphere.radius > 1e-6 ? 1 / sphere.radius : 1;
    group.scale.setScalar(scale);
    group.updateMatrixWorld(true);

    const normJoints = bindPos.map((p) => new THREE.Vector3(
      (p.x - center.x) * scale,
      (p.y - center.y) * scale,
      (p.z - center.z) * scale,
    ));

    // ---- 材质 ----
    const gradientMap = makeGradientMap(toonSteps);
    const toonMats = applyToonMaterials(group, gradientMap);
    // toon 只写颜色不写 depth；depth 由 ID 遍统一写，避免同遍内 color/ID 的 depth 不一致
    // （Pass 1 若 toon 先写了后表面 depth，ID 再用 GreaterDepth 会全灭）
    toonMats.forEach((tm) => {
      tm.depthWrite = false;
    });
    const idMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });

    const setMaterials = (mode: 'toon' | 'id', depthFunc: THREE.DepthFunc) => {
      idMaterial.depthFunc = depthFunc;
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (mode === 'toon') {
          const tm = toonMats.get(m)!;
          tm.depthFunc = depthFunc;
          m.material = tm;
        } else {
          m.material = idMaterial;
        }
      });
    };

    // ---- 场景/相机 ----
    const scene = new THREE.Scene();
    scene.add(group);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
    dirLight.position.set(2, 3, 4);
    scene.add(dirLight);
    const frustum = 1.25;
    const camera = new THREE.OrthographicCamera(-frustum, frustum, frustum, -frustum, 0.1, 20);
    camera.position.set(0, 1.1, 4);
    camera.lookAt(0, 0, 0);

    const rt = new THREE.WebGLRenderTarget(size, size, { samples: 0, depthBuffer: true });
    const readBuffer = new Uint8Array(size * size * 4);
    const readFlipped = (): Uint8ClampedArray => {
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, readBuffer);
      const flipped = new Uint8ClampedArray(size * size * 4);
      const rowBytes = size * 4;
      for (let y = 0; y < size; y++) {
        const srcY = size - 1 - y;
        flipped.set(readBuffer.subarray(srcY * rowBytes, srcY * rowBytes + rowBytes), y * rowBytes);
      }
      return flipped;
    };

    const groups: TwoPassGroup[] = [];
    const jointPixels: Array<Array<{ x: number; y: number }>> = bones.map(() => []);
    const projV = new THREE.Vector3();
    const total = idOnly ? 8 : 16;
    let done = 0;

    for (let d = 0; d < 8; d++) {
      group.rotation.y = (d / 8) * Math.PI * 2;
      group.updateMatrixWorld(true);

      // 关节投影（整图像素，top-down）
      for (let bi = 0; bi < bones.length; bi++) {
        projV.copy(normJoints[bi]).applyMatrix4(group.matrixWorld).project(camera);
        jointPixels[bi].push({
          x: ((projV.x + 1) / 2) * size,
          y: ((1 - projV.y) / 2) * size,
        });
      }

      renderer.setRenderTarget(rt);
      renderer.clear(true, true, false);

      let colorFront: Uint8ClampedArray;
      let colorBack: Uint8ClampedArray;
      const useCachedColors = idOnly && reuseBake;
      if (useCachedColors) {
        // 仅重渲 ID：复用缓存颜色
        const rf = reuseBake!.groups.find((g) => g.direction === d && g.pass === 0);
        const rb = reuseBake!.groups.find((g) => g.direction === d && g.pass === 1);
        if (!rf || !rb) throw new Error(`reuseBake 缺少方向 ${d} 的颜色`);
        colorFront = rf.colorPixels;
        colorBack = rb.colorPixels;
      } else {
        // Pass 0 前：正常 Z
        setMaterials('toon', THREE.LessEqualDepth);
        renderer.render(scene, camera);
        colorFront = readFlipped();
        // Pass 1 颜色稍后渲（ID 前遍之后）
        colorBack = new Uint8ClampedArray(0); // 占位，下面覆盖
      }
      setMaterials('id', THREE.LessEqualDepth);
      renderer.render(scene, camera);
      const idFront = readFlipped();
      onProgress?.(++done, total, `方向 ${d * 45}° ${idOnly ? 'ID' : '前'}`);
      await new Promise((r) => setTimeout(r, 0)); // 让 UI 更新

      if (!useCachedColors) {
        // Pass 1 后：反转 Z（不清 depth！）
        setMaterials('toon', THREE.GreaterDepth);
        renderer.render(scene, camera);
        colorBack = readFlipped();
      }
      setMaterials('id', THREE.GreaterDepth);
      renderer.render(scene, camera);
      const idBack = readFlipped();
      onProgress?.(++done, total, `方向 ${d * 45}° ${idOnly ? 'ID后' : '后'}`);
      await new Promise((r) => setTimeout(r, 0));

      groups.push(
        { direction: d, pass: 0, colorPixels: colorFront, idPixels: idFront },
        { direction: d, pass: 1, colorPixels: colorBack, idPixels: idBack },
      );
      renderer.setRenderTarget(null);
    }

    // ---- 清理 ----
    rt.dispose();
    gradientMap.dispose();
    idMaterial.dispose();
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const tm = toonMats.get(mesh);
        if (tm) tm.dispose();
      }
    });

    return {
      bones: bones.map((b, i) => ({
        index: i,
        name: b.name || `bone_${i}`,
        parentIndex: parentIndex[i],
        bindPos: { x: bindPos[i].x, y: bindPos[i].y, z: bindPos[i].z },
        jointPixels: jointPixels[i],
      })),
      groups,
      width: size,
      height: size,
      normalization: {
        center: { x: center.x, y: center.y, z: center.z },
        scale,
      },
      merge,
    };
  } finally {
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch { /* noop */ }
  }
}

// ============================================================
// 单肢体独立重烘（备选 A）：只渲染指定 bone 的顶点，8 方向
// ============================================================

export interface BoneAnalysis {
  bones: THREE.Bone[];
  indexByBone: Map<THREE.Bone, number>;
  parentIndex: (number | null)[];
  bindPos: THREE.Vector3[];
  /** 每 mesh 每三角的主导 bone 全局索引 */
  meshTriBones: Array<{ mesh: THREE.Mesh; triBone: Int32Array; triCount: number }>;
  normalization: { center: THREE.Vector3; scale: number };
}

/** 分析模型：bone 注册 + 每三角主导 bone */
function analyzeTriangles(model: THREE.Object3D): {
  bones: THREE.Bone[];
  indexByBone: Map<THREE.Bone, number>;
  parentIndex: (number | null)[];
  bindPos: THREE.Vector3[];
  meshTriBones: Array<{ mesh: THREE.Mesh; triBone: Int32Array }>;
} {
  const { bones, indexByBone, parentIndex } = collectBones(model);
  model.updateMatrixWorld(true);
  const bindPos = bones.map((b) => {
    const v = new THREE.Vector3();
    b.getWorldPosition(v);
    return v;
  });

  const meshTriBones: Array<{ mesh: THREE.Mesh; triBone: Int32Array }> = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const sm = mesh as THREE.SkinnedMesh;
    const index = geo.getIndex();
    const pos = geo.getAttribute('position');
    const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);
    const triBone = new Int32Array(triCount).fill(-1);

    if (sm.isSkinnedMesh && geo.getAttribute('skinIndex')) {
      const skinIndex = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
      const skinWeight = geo.getAttribute('skinWeight') as THREE.BufferAttribute;
      const skeleton = sm.skeleton;
      for (let t = 0; t < triCount; t++) {
        const scores = new Map<number, number>();
        for (let k = 0; k < 3; k++) {
          const vi = index ? index.getX(t * 3 + k) : t * 3 + k;
          for (let j = 0; j < 4; j++) {
            const ji = Math.round(skinIndex.getComponent(vi, j));
            const w = skinWeight.getComponent(vi, j);
            const bone = skeleton.bones[ji];
            const gi = bone ? (indexByBone.get(bone) ?? -1) : -1;
            if (gi >= 0 && w > 0) scores.set(gi, (scores.get(gi) ?? 0) + w);
          }
        }
        let best = -1;
        let bestS = -1;
        for (const [gi, s] of scores) {
          if (s > bestS) { bestS = s; best = gi; }
        }
        triBone[t] = best;
      }
    } else {
      // 非蒙皮：整 mesh 归最近 bone
      geo.computeBoundingBox();
      const c = new THREE.Vector3();
      geo.boundingBox!.getCenter(c);
      c.applyMatrix4(mesh.matrixWorld);
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < bindPos.length; i++) {
        const d = c.distanceToSquared(bindPos[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      triBone.fill(best);
    }
    meshTriBones.push({ mesh, triBone });
  });

  return { bones, indexByBone, parentIndex, bindPos, meshTriBones };
}

/** 抽取某 bone 的三角（模型空间），返回顶点汤 + 包围盒 + 关节 */
function extractBoneTriangles(
  analysis: ReturnType<typeof analyzeTriangles>,
  /** 目标 bone（含后代）的索引集合 */
  boneIndices: Set<number>,
  /** 目标 bone 索引（关节用） */
  targetIndex: number,
): {
  positions: number[]; // 模型空间 xyz 平铺
  bbox: THREE.Box3;
  jointModel: THREE.Vector3;
  parentJointModel: THREE.Vector3 | null;
  count: number;
} | null {
  const positions: number[] = [];
  const bbox = new THREE.Box3();
  const v = new THREE.Vector3();

  for (const { mesh, triBone } of analysis.meshTriBones) {
    const geo = mesh.geometry;
    const index = geo.getIndex();
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const sm = mesh as unknown as THREE.SkinnedMesh;
    // 蒙皮感知：摆过姿态（握拳）后必须走 boneTransform 取 posed 顶点；
    // bind pose 下 boneTransform = 原始顶点，与直接拷贝一致
    const useSkinning = !!sm.isSkinnedMesh && !!sm.skeleton && !!geo.getAttribute('skinIndex');
    for (let t = 0; t < triBone.length; t++) {
      if (!boneIndices.has(triBone[t])) continue;
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(t * 3 + k) : t * 3 + k;
        if (useSkinning) {
          sm.boneTransform(vi, v); // mesh 局部（posed）
        } else {
          v.fromBufferAttribute(posAttr, vi);
        }
        // mesh 局部 → 模型空间
        v.applyMatrix4(mesh.matrixWorld);
        positions.push(v.x, v.y, v.z);
        bbox.expandByPoint(v);
      }
    }
  }

  if (positions.length === 0) return null;
  const jointModel = analysis.bindPos[targetIndex].clone();
  const parentIdx = analysis.parentIndex[targetIndex];
  const parentJointModel = parentIdx !== null && parentIdx !== undefined
    ? analysis.bindPos[parentIdx].clone()
    : null;
  return { positions, bbox, jointModel, parentJointModel, count: positions.length / 3 };
}

/** 收集 bone 子树（自身 + 所有后代）索引 */
function collectSubtreeIndices(
  parentIndex: (number | null)[],
  root: number,
): Set<number> {
  const set = new Set<number>([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < parentIndex.length; i++) {
      const p = parentIndex[i];
      if (p !== null && p !== undefined && set.has(p) && !set.has(i)) {
        set.add(i);
        changed = true;
      }
    }
  }
  return set;
}

/**
 * 肢体竖直摆放：主轴（远端方向）→ -Y（末端朝下），宽面 → ±Z（手心朝前）。
 * 返回旋转后的顶点 + 关节（模型空间）。
 */
function orientLimbVertical(
  positions: number[],
  jointModel: THREE.Vector3,
  parentJointModel: THREE.Vector3 | null,
): { positions: number[]; joint: THREE.Vector3 } {
  const n = positions.length / 3;
  // 质心
  const centroid = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    centroid.x += positions[i * 3];
    centroid.y += positions[i * 3 + 1];
    centroid.z += positions[i * 3 + 2];
  }
  centroid.multiplyScalar(1 / Math.max(n, 1));

  // 远端方向：质心 − 关节（肢体从关节向外延伸）
  // 若质心与关节几乎重合，用父关节反方向兜底
  let distal = centroid.clone().sub(jointModel);
  if (distal.lengthSq() < 1e-8 && parentJointModel) {
    distal = jointModel.clone().sub(parentJointModel);
  }
  if (distal.lengthSq() < 1e-8) distal.set(0, -1, 0);
  distal.normalize();

  // q1：远端 → -Y
  const q1 = new THREE.Quaternion().setFromUnitVectors(distal, new THREE.Vector3(0, -1, 0));
  const v = new THREE.Vector3();
  const rotated: number[] = new Array(positions.length);
  for (let i = 0; i < n; i++) {
    v.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).applyQuaternion(q1);
    rotated[i * 3] = v.x;
    rotated[i * 3 + 1] = v.y;
    rotated[i * 3 + 2] = v.z;
  }
  const joint = jointModel.clone().applyQuaternion(q1);

  // q2：XZ 平面宽轴 → X（扁平面朝 ±Z，手心朝前）
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = rotated[i * 3], z = rotated[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if ((maxZ - minZ) > (maxX - minX)) {
    const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    for (let i = 0; i < n; i++) {
      v.set(rotated[i * 3], rotated[i * 3 + 1], rotated[i * 3 + 2]).applyQuaternion(q2);
      rotated[i * 3] = v.x;
      rotated[i * 3 + 1] = v.y;
      rotated[i * 3 + 2] = v.z;
    }
    joint.applyQuaternion(q2);
  }

  return { positions: rotated, joint };
}

// ============================================================
// 手指检测与握拳（bakeSingleBone 用）
// 角度按关节类型（解剖学近似，非硬编码正确值，用户可调）：
//   四指 MCP 90° / PIP 100° / DIP 70°；拇指 MCP 屈曲 60° / IP 50° + 内收 35°
// 实际应用角度 = maxAngle * fingerCurl（0~1）
// ============================================================

export interface FingerChain {
  label: string;
  isThumb: boolean;
  /** 近端→远端（MCP→PIP→DIP；拇指 MCP→IP） */
  bones: THREE.Bone[];
}

export type FingerDetectStatus = 'auto' | 'manual' | 'missing';

export interface FingerDetectResult {
  fingers: FingerChain[];
  thumb: FingerChain | null;
  fingerStatus: FingerDetectStatus;
  thumbStatus: FingerDetectStatus;
}

const FINGER_MAX_DEG = [90, 100, 70]; // MCP, PIP, DIP（解剖学近似）
const THUMB_FLEX_DEG = [60, 50];     // MCP, IP
const THUMB_ADDUCT_DEG = 35;         // 拇指内收

const HAND_RE = /hand/i;
const WRIST_RE = /wrist/i;
const FINGER_RES = [/index/i, /middle/i, /ring/i, /pinky/i, /little/i, /finger/i, /digit[2-5]/i];
const THUMB_RES = [/thumb/i, /digit1/i];
const FINGER_ANY_RE = /finger|index|middle|ring|pinky|little|thumb|digit/i;

function getBoneChildren(b: THREE.Bone): THREE.Bone[] {
  return b.children.filter((c): c is THREE.Bone => (c as unknown as THREE.Bone).isBone === true);
}
function isFingerName(n: string): boolean {
  return FINGER_RES.some((re) => re.test(n));
}
function isThumbName(n: string): boolean {
  return THUMB_RES.some((re) => re.test(n));
}

/** 从根 bone 向下走单链（手指） */
function buildDownChain(root: THREE.Bone, acceptRe: RegExp): THREE.Bone[] {
  const chain = [root];
  let cur = root;
  for (let i = 0; i < 6; i++) {
    const kids = getBoneChildren(cur);
    if (kids.length === 0) break;
    let next = kids.find((k) => acceptRe.test(k.name || ''));
    if (!next && kids.length === 1) next = kids[0];
    if (!next) break;
    chain.push(next);
    cur = next;
  }
  return chain;
}

/** 从用户点击的 bone 重建整条手指链（向上走到 hand/hub，向下走到末端） */
function buildChainFromPicked(picked: THREE.Bone, hubs: THREE.Bone[]): THREE.Bone[] {
  const up: THREE.Bone[] = [];
  let cur = picked.parent;
  for (let i = 0; i < 6 && cur && (cur as unknown as THREE.Bone).isBone; i++) {
    const cb = cur as THREE.Bone;
    if (hubs.includes(cb)) break;
    const fingerKids = getBoneChildren(cb).filter((k) => FINGER_ANY_RE.test(k.name || ''));
    up.push(cb);
    if (fingerKids.length > 1) break; // 分叉 hub（手掌），停
    cur = cb.parent;
  }
  const down = buildDownChain(picked, FINGER_ANY_RE);
  return [...up.reverse(), ...down];
}

function autoFindRoots(
  allBones: THREE.Bone[],
  hubs: THREE.Bone[],
  thumb: boolean,
): THREE.Bone[] {
  const test = thumb ? isThumbName : (n: string) => isFingerName(n) && !isThumbName(n);
  const roots: THREE.Bone[] = [];
  const searchParents = hubs.length > 0 ? hubs : allBones;
  for (const hub of searchParents) {
    for (const k of getBoneChildren(hub)) {
      if (test(k.name || '')) roots.push(k);
    }
  }
  if (roots.length > 0) return roots;
  // 兜底：全局找最上层的手指 bone
  return allBones.filter((b) => {
    if (!test(b.name || '')) return false;
    const p = b.parent as THREE.Bone | null;
    return !(p && p.isBone && test(p.name || ''));
  });
}

/**
 * 检测手指/拇指 bone 链。
 * 优先级：手动指定 > 自动匹配 > missing。
 */
export function detectFingers(
  allBones: THREE.Bone[],
  spec: { thumbBoneName?: string; fingerBoneNames?: string[] } = {},
): FingerDetectResult {
  const res: FingerDetectResult = {
    fingers: [],
    thumb: null,
    fingerStatus: 'missing',
    thumbStatus: 'missing',
  };
  const byName = new Map(allBones.map((b) => [b.name, b]));
  const handBones = allBones.filter(
    (b) => HAND_RE.test(b.name || '') && !FINGER_ANY_RE.test(b.name || ''),
  );
  const hubs = handBones.length > 0 ? handBones : allBones.filter((b) => WRIST_RE.test(b.name || ''));

  // 拇指
  if (spec.thumbBoneName) {
    const b = byName.get(spec.thumbBoneName);
    if (b) {
      res.thumb = { label: b.name, isThumb: true, bones: buildChainFromPicked(b, hubs) };
      res.thumbStatus = 'manual';
    }
  } else {
    const roots = autoFindRoots(allBones, hubs, true);
    if (roots.length > 0) {
      res.thumb = { label: roots[0].name, isThumb: true, bones: buildDownChain(roots[0], FINGER_ANY_RE) };
      res.thumbStatus = 'auto';
    }
  }

  // 四指
  // 四指：手动指定 + 自动匹配合并（去重）
  const manualFingers: FingerChain[] = [];
  if (spec.fingerBoneNames && spec.fingerBoneNames.length > 0) {
    for (const nm of spec.fingerBoneNames) {
      const b = byName.get(nm);
      if (b) manualFingers.push({ label: b.name, isThumb: false, bones: buildChainFromPicked(b, hubs) });
    }
  }
  const autoFingers: FingerChain[] = [];
  for (const r of autoFindRoots(allBones, hubs, false)) {
    autoFingers.push({ label: r.name, isThumb: false, bones: buildDownChain(r, FINGER_ANY_RE) });
  }
  // 去重：自动链若与手动链有 bone 重叠则丢弃
  const manualBoneSet = new Set<THREE.Bone>();
  for (const f of manualFingers) for (const b of f.bones) manualBoneSet.add(b);
  for (const f of autoFingers) {
    if (!f.bones.some((b) => manualBoneSet.has(b))) manualFingers.push(f);
  }
  res.fingers = manualFingers.filter((f) => f.bones.length > 0);
  res.fingerStatus = res.fingers.length > 0
    ? (spec.fingerBoneNames && spec.fingerBoneNames.length > 0 ? 'manual' : 'auto')
    : 'missing';
  if (!res.thumb || res.thumb.bones.length === 0) {
    res.thumb = null;
    res.thumbStatus = 'missing';
  }
  return res;
}

/** bone 世界方向（→第一个 child） */
function boneDirWorld(bone: THREE.Bone): THREE.Vector3 | null {
  const kids = getBoneChildren(bone);
  if (kids.length === 0) return null;
  const p0 = bone.getWorldPosition(new THREE.Vector3());
  const p1 = kids[0].getWorldPosition(new THREE.Vector3());
  const d = p1.sub(p0);
  return d.lengthSq() > 1e-12 ? d.normalize() : null;
}

/** 手指链指尖世界位置（末节外延一节估算） */
function chainTipWorld(bones: THREE.Bone[]): THREE.Vector3 {
  const last = bones[bones.length - 1];
  const pLast = last.getWorldPosition(new THREE.Vector3());
  if (bones.length >= 2) {
    const pPrev = bones[bones.length - 2].getWorldPosition(new THREE.Vector3());
    const seg = pLast.clone().sub(pPrev);
    if (seg.lengthSq() > 1e-12) return pLast.clone().add(seg); // 外延一节
  }
  const d = boneDirWorld(last);
  if (d) return pLast.addScaledVector(d, 0.02);
  return pLast;
}

/** 点集拟合直线方向（最远两点） */
function fitLineDirection(points: THREE.Vector3[]): THREE.Vector3 | null {
  if (points.length < 2) return null;
  let maxD = 0;
  let a = points[0];
  let b = points[1];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = points[i].distanceToSquared(points[j]);
      if (d > maxD) { maxD = d; a = points[i]; b = points[j]; }
    }
  }
  if (maxD < 1e-10) return null;
  return new THREE.Vector3().subVectors(b, a).normalize();
}

/** 世界空间旋转某 bone（精确，不依赖父变换为单位阵） */
function applyWorldRotation(bone: THREE.Bone, axisWorld: THREE.Vector3, angleRad: number): void {
  const qOld = bone.getWorldQuaternion(new THREE.Quaternion());
  const qDelta = new THREE.Quaternion().setFromAxisAngle(axisWorld, angleRad);
  const qNew = qDelta.multiply(qOld);
  const parent = bone.parent;
  if (!parent) return;
  const qParInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(qParInv.multiply(qNew));
}

/** 单根手指屈曲（curl 0~1），符号经试探确定（指尖向掌心） */
function curlFingerChain(
  model: THREE.Object3D,
  bones: THREE.Bone[],
  knuckleAxis: THREE.Vector3,
  palmCenter: THREE.Vector3,
  curl: number,
  maxDeg: number[],
): void {
  if (bones.length === 0) return;
  const mcp = bones[0];
  const fdir0 = boneDirWorld(mcp);
  if (!fdir0) return;
  const axis0 = knuckleAxis.clone().addScaledVector(fdir0, -knuckleAxis.dot(fdir0));
  if (axis0.lengthSq() < 1e-6) return;
  axis0.normalize();

  // 试探：+12° 让指尖靠近掌心则符号为正
  const dBefore = chainTipWorld(bones).distanceTo(palmCenter);
  const probe = THREE.MathUtils.degToRad(12);
  applyWorldRotation(mcp, axis0, probe);
  model.updateMatrixWorld(true);
  const dAfter = chainTipWorld(bones).distanceTo(palmCenter);
  applyWorldRotation(mcp, axis0, -probe);
  model.updateMatrixWorld(true);
  const sign = dAfter < dBefore ? 1 : -1;

  for (let i = 0; i < bones.length && i < maxDeg.length; i++) {
    const b = bones[i];
    const d = boneDirWorld(b) ?? fdir0;
    const a = knuckleAxis.clone().addScaledVector(d, -knuckleAxis.dot(d));
    if (a.lengthSq() < 1e-6) continue;
    a.normalize();
    applyWorldRotation(b, a, sign * THREE.MathUtils.degToRad(maxDeg[i] * curl));
    model.updateMatrixWorld(true);
  }
}

/**
 * 按 fingerCurl 摆手指（握拳）。curl=0 时不做任何事。
 * 不抛错：找不到轴/手指时静默跳过。
 */
export function applyFingerCurl(
  model: THREE.Object3D,
  det: FingerDetectResult,
  curl: number,
): void {
  const c = THREE.MathUtils.clamp(curl, 0, 1);
  if (c <= 0) return;
  if (det.fingers.length === 0 && !det.thumb) return;
  model.updateMatrixWorld(true);

  // 指关节轴：四指 MCP 位置拟合直线
  const mcpPts: THREE.Vector3[] = [];
  for (const f of det.fingers) {
    if (f.bones.length > 0) mcpPts.push(f.bones[0].getWorldPosition(new THREE.Vector3()));
  }
  let knuckleAxis: THREE.Vector3 | null = null;
  if (mcpPts.length >= 2) {
    knuckleAxis = fitLineDirection(mcpPts);
  } else if (det.fingers.length > 0 && det.thumb) {
    // 兜底：手指×拇指叉乘
    const fdir = boneDirWorld(det.fingers[0].bones[0]);
    const tdir = det.thumb.bones.length > 0 ? boneDirWorld(det.thumb.bones[0]) : null;
    if (fdir && tdir) {
      const ax = new THREE.Vector3().crossVectors(fdir, tdir);
      if (ax.lengthSq() > 1e-6) knuckleAxis = ax.normalize();
    }
  }
  if (!knuckleAxis) return;

  const palmCenter = new THREE.Vector3();
  if (mcpPts.length > 0) {
    for (const p of mcpPts) palmCenter.add(p);
    palmCenter.multiplyScalar(1 / mcpPts.length);
  } else if (det.thumb && det.thumb.bones.length > 0) {
    det.thumb.bones[0].getWorldPosition(palmCenter);
  }

  // 掌法线（拇指内收轴）
  let palmNormal: THREE.Vector3 | null = null;
  if (det.fingers.length > 0) {
    const fdir = boneDirWorld(det.fingers[0].bones[0]);
    if (fdir) palmNormal = new THREE.Vector3().crossVectors(knuckleAxis, fdir).normalize();
  }

  for (const f of det.fingers) {
    curlFingerChain(model, f.bones, knuckleAxis, palmCenter, c, FINGER_MAX_DEG);
  }
  if (det.thumb && det.thumb.bones.length > 0) {
    const tb = det.thumb.bones;
    // 拇指先内收（向掌心），符号经试探确定
    if (palmNormal && palmNormal.lengthSq() > 0.5) {
      const d0 = chainTipWorld(tb).distanceTo(palmCenter);
      const probe = THREE.MathUtils.degToRad(10);
      applyWorldRotation(tb[0], palmNormal, probe);
      model.updateMatrixWorld(true);
      const d1 = chainTipWorld(tb).distanceTo(palmCenter);
      applyWorldRotation(tb[0], palmNormal, -probe);
      model.updateMatrixWorld(true);
      const sign = d1 < d0 ? 1 : -1;
      applyWorldRotation(tb[0], palmNormal, sign * THREE.MathUtils.degToRad(THUMB_ADDUCT_DEG * c));
      model.updateMatrixWorld(true);
    }
    curlFingerChain(model, tb, knuckleAxis, palmCenter, c, THUMB_FLEX_DEG);
  }
  model.updateMatrixWorld(true);
}

/** 旧版 extractBoneGeometry（保留供参考，单肢体重烘改用竖直流程） */
function extractBoneGeometry(
  analysis: ReturnType<typeof analyzeTriangles>,
  boneIndex: number,
  normalization: { center: THREE.Vector3; scale: number },
): { geometry: THREE.BufferGeometry; joint: THREE.Vector3; frustum: number } | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const bbox = new THREE.Box3();
  const v = new THREE.Vector3();

  for (const { mesh, triBone } of analysis.meshTriBones) {
    const geo = mesh.geometry;
    const index = geo.getIndex();
    const posAttr = geo.getAttribute('position');
    const norAttr = geo.getAttribute('normal');
    const uvAttr = geo.getAttribute('uv');
    for (let t = 0; t < triBone.length; t++) {
      if (triBone[t] !== boneIndex) continue;
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(t * 3 + k) : t * 3 + k;
        v.fromBufferAttribute(posAttr as THREE.BufferAttribute, vi);
        // 归一化：模型空间 → 归一化空间
        const nx = (v.x - normalization.center.x) * normalization.scale;
        const ny = (v.y - normalization.center.y) * normalization.scale;
        const nz = (v.z - normalization.center.z) * normalization.scale;
        positions.push(nx, ny, nz);
        bbox.expandByPoint(new THREE.Vector3(nx, ny, nz));
        if (norAttr) {
          normals.push(
            (norAttr as THREE.BufferAttribute).getX(vi),
            (norAttr as THREE.BufferAttribute).getY(vi),
            (norAttr as THREE.BufferAttribute).getZ(vi),
          );
        }
        if (uvAttr) {
          uvs.push(
            (uvAttr as THREE.BufferAttribute).getX(vi),
            (uvAttr as THREE.BufferAttribute).getY(vi),
          );
        }
      }
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  }
  if (uvs.length === (positions.length / 3) * 2) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }

  const size = new THREE.Vector3();
  bbox.getSize(size);
  const frustum = Math.max(size.x, size.y, Math.max(size.x, size.y) * 0.6, 0.35) * 1.5;

  // joint（归一化空间）
  const bp = analysis.bindPos[boneIndex];
  const joint = new THREE.Vector3(
    (bp.x - normalization.center.x) * normalization.scale,
    (bp.y - normalization.center.y) * normalization.scale,
    (bp.z - normalization.center.z) * normalization.scale,
  );
  return { geometry, joint, frustum };
}

/**
 * 单肢体独立重烘：只渲染指定 bone 的顶点，8 方向，关节居中。
 * 返回 BakeResult[8]（已量化），可直接替换该 bone 的方向图。
 */
/**
 * 准备 limb 几何（拆下竖直 + 归一化），供 bakeSingleBone / previewHandCurl 共用。
 * 返回归一化空间的静态几何 + 关节位置。调用方负责 dispose geometry。
 */
function prepareLimbGeometry(
  analysis: ReturnType<typeof analyzeTriangles>,
  boneIndex: number,
): { geometry: THREE.BufferGeometry; jointN: THREE.Vector3 } | null {
  const subtree = collectSubtreeIndices(analysis.parentIndex, boneIndex);
  const tri = extractBoneTriangles(analysis, subtree, boneIndex);
  if (!tri) return null;
  const oriented = orientLimbVertical(tri.positions, tri.jointModel, tri.parentJointModel);
  // 归一化：包围球直径 2，中心到原点
  const obbox = new THREE.Box3();
  const tv = new THREE.Vector3();
  for (let i = 0; i < oriented.positions.length / 3; i++) {
    tv.set(oriented.positions[i * 3], oriented.positions[i * 3 + 1], oriented.positions[i * 3 + 2]);
    obbox.expandByPoint(tv);
  }
  const ocenter = obbox.getCenter(new THREE.Vector3());
  const osphere = obbox.getBoundingSphere(new THREE.Sphere());
  const oscale = osphere.radius > 1e-6 ? 1 / osphere.radius : 1;
  const n = oriented.positions.length / 3;
  const normPos = new Float32Array(oriented.positions.length);
  for (let i = 0; i < n; i++) {
    normPos[i * 3] = (oriented.positions[i * 3] - ocenter.x) * oscale;
    normPos[i * 3 + 1] = (oriented.positions[i * 3 + 1] - ocenter.y) * oscale;
    normPos[i * 3 + 2] = (oriented.positions[i * 3 + 2] - ocenter.z) * oscale;
  }
  const jointN = oriented.joint.clone().sub(ocenter).multiplyScalar(oscale);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(normPos, 3));
  geometry.computeVertexNormals();
  return { geometry, jointN };
}

/** 在已加载的 model 上应用手指握拳（detect + pose），返回检测结果 */
export function poseFingersOnModel(
  model: THREE.Object3D,
  options: Pick<BakeOptions, 'fingerCurl' | 'thumbBoneName' | 'fingerBoneNames'>,
): FingerDetectResult | null {
  const curl = options.fingerCurl ?? 0;
  const allBones: THREE.Bone[] = [];
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) allBones.push(o as THREE.Bone);
  });
  const det = detectFingers(allBones, {
    thumbBoneName: options.thumbBoneName,
    fingerBoneNames: options.fingerBoneNames,
  });
  if (curl > 0) applyFingerCurl(model, det, curl);
  return det;
}

export async function bakeSingleBone(
  input: string | ArrayBuffer,
  boneName: string,
  options: BakeOptions = {},
): Promise<BakeResult[]> {
  const size = options.size ?? 64;
  const paletteSize = options.paletteSize ?? 16;
  const toonSteps = options.toonSteps ?? 3;

  if (typeof window === 'undefined') {
    throw new Error('bakeSingleBone 仅支持浏览器环境(WebGL)');
  }

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;

  try {
    const loader = new GLTFLoader();
    const gltf =
      typeof input === 'string' ? await loader.loadAsync(input) : await loader.parseAsync(input, '');
    const model = gltf.scene;
    model.updateMatrixWorld(true);

    // 手指握拳（bakeSingleBone 专属，主流程 C 不摆）：先摆姿态再分析
    poseFingersOnModel(model, options);

    const analysis = analyzeTriangles(model);
    const boneIndex = analysis.bones.findIndex((b) => (b.name || '') === boneName);
    if (boneIndex < 0) throw new Error(`找不到骨骼: ${boneName}`);

    // 拆下竖直：取 limb（含后代）三角 → 主轴朝下 → 宽面朝前 → 居中归一化
    // 子树语义：选手部 bone 会带上手指（握拳才有意义），选前臂会带上手
    const prepared = prepareLimbGeometry(analysis, boneIndex);
    if (!prepared) throw new Error(`骨骼 ${boneName} 没有三角形`);
    const { geometry, jointN } = prepared;

    const gradientMap = makeGradientMap(toonSteps);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap }),
    );
    mesh.frustumCulled = false;

    const group = new THREE.Group();
    group.add(mesh);

    const scene = new THREE.Scene();
    scene.add(group);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
    dirLight.position.set(2, 3, 4);
    scene.add(dirLight);

    // 相机：每方向看向关节（关节转到世界后的位置），frustum 包住归一化 limb（直径 2）
    const f = 2.4; // 直径 2 * 1.2 padding
    const camera = new THREE.OrthographicCamera(-f / 2, f / 2, f / 2, -f / 2, 0.1, 20);
    const viewDir = new THREE.Vector3(0, 1.1, 4).normalize();
    const jointWorld = new THREE.Vector3();

    const rt = new THREE.WebGLRenderTarget(size, size, { samples: 0, depthBuffer: true });
    const readBuffer = new Uint8Array(size * size * 4);
    const results: BakeResult[] = [];

    for (let d = 0; d < 8; d++) {
      const dt0 = performance.now();
      group.rotation.y = (d / 8) * Math.PI * 2;
      group.updateMatrixWorld(true);
      jointWorld.copy(jointN).applyMatrix4(group.matrixWorld);
      camera.position.copy(jointWorld).addScaledVector(viewDir, 4);
      camera.lookAt(jointWorld);

      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, readBuffer);
      renderer.setRenderTarget(null);

      const flipped = new Uint8ClampedArray(size * size * 4);
      const rowBytes = size * 4;
      for (let y = 0; y < size; y++) {
        const srcY = size - 1 - y;
        flipped.set(readBuffer.subarray(srcY * rowBytes, srcY * rowBytes + rowBytes), y * rowBytes);
      }

      const palette = medianCut(flipped, paletteSize);
      const colorSet = new Set<string>();
      if (palette.length > 0) {
        for (let i = 0; i < flipped.length; i += 4) {
          const a = flipped[i + 3];
          if (a <= 8) { flipped[i + 3] = 0; continue; }
          const idx = nearestPaletteIndex(flipped[i], flipped[i + 1], flipped[i + 2], palette);
          const p = palette[idx];
          flipped[i] = p[0]; flipped[i + 1] = p[1]; flipped[i + 2] = p[2]; flipped[i + 3] = 255;
          colorSet.add(`${p[0]},${p[1]},${p[2]}`);
        }
      }

      results.push({
        direction: d,
        pixels: flipped,
        width: size,
        height: size,
        colorCount: colorSet.size,
        elapsedMs: performance.now() - dt0,
      });
    }

    rt.dispose();
    gradientMap.dispose();
    geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    return results;
  } finally {
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch { /* noop */ }
  }
}

/** 仅检测手指/拇指（不摆姿态），供 UI 显示状态用 */
export async function inspectFingers(
  input: string | ArrayBuffer,
  spec: { thumbBoneName?: string; fingerBoneNames?: string[] } = {},
): Promise<FingerDetectResult> {
  if (typeof window === 'undefined') {
    throw new Error('inspectFingers 仅支持浏览器环境');
  }
  const loader = new GLTFLoader();
  const gltf =
    typeof input === 'string' ? await loader.loadAsync(input) : await loader.parseAsync(input, '');
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const allBones: THREE.Bone[] = [];
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) allBones.push(o as THREE.Bone);
  });
  return detectFingers(allBones, spec);
}

/**
 * 手部特写预览（单方向，快速）：找手 → 握拳 → 竖直 → 渲 1 张。
 * 找不到手指/拇指时返回 null（UI 显示"无手部"）。
 */
export async function previewHandCurl(
  input: string | ArrayBuffer,
  options: BakeOptions & { direction?: number } = {},
): Promise<BakeResult | null> {
  const size = 96;
  const toonSteps = options.toonSteps ?? 3;
  const direction = options.direction ?? 0;

  if (typeof window === 'undefined') {
    throw new Error('previewHandCurl 仅支持浏览器环境(WebGL)');
  }

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;

  try {
    const loader = new GLTFLoader();
    const gltf =
      typeof input === 'string' ? await loader.loadAsync(input) : await loader.parseAsync(input, '');
    const model = gltf.scene;
    model.updateMatrixWorld(true);

    const det = poseFingersOnModel(model, options);
    if (!det || (det.fingers.length === 0 && !det.thumb)) return null;

    const analysis = analyzeTriangles(model);
    // 手 bone：第一根手指 MCP 的父，或拇指 MCP 的父，或按名找 hand
    let handBone: THREE.Bone | null = null;
    const mcp0 = det.fingers[0]?.bones[0] ?? det.thumb?.bones[0];
    if (mcp0 && (mcp0.parent as THREE.Bone)?.isBone) {
      handBone = mcp0.parent as THREE.Bone;
    }
    if (!handBone) {
      handBone = analysis.bones.find((b) => HAND_RE.test(b.name || '')) ?? null;
    }
    if (!handBone) return null;
    const handIndex = analysis.bones.indexOf(handBone);
    if (handIndex < 0) return null;

    const prepared = prepareLimbGeometry(analysis, handIndex);
    if (!prepared) return null;
    const { geometry, jointN } = prepared;

    const gradientMap = makeGradientMap(toonSteps);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap }),
    );
    mesh.frustumCulled = false;
    const group = new THREE.Group();
    group.add(mesh);
    const scene = new THREE.Scene();
    scene.add(group);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
    dirLight.position.set(2, 3, 4);
    scene.add(dirLight);

    const f = 2.4;
    const camera = new THREE.OrthographicCamera(-f / 2, f / 2, f / 2, -f / 2, 0.1, 20);
    const viewDir = new THREE.Vector3(0, 1.1, 4).normalize();
    group.rotation.y = (direction / 8) * Math.PI * 2;
    group.updateMatrixWorld(true);
    const jointWorld = jointN.clone().applyMatrix4(group.matrixWorld);
    camera.position.copy(jointWorld).addScaledVector(viewDir, 4);
    camera.lookAt(jointWorld);

    const rt = new THREE.WebGLRenderTarget(size, size, { samples: 0, depthBuffer: true });
    const readBuffer = new Uint8Array(size * size * 4);
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, readBuffer);
    renderer.setRenderTarget(null);

    const flipped = new Uint8ClampedArray(size * size * 4);
    const rowBytes = size * 4;
    for (let y = 0; y < size; y++) {
      const srcY = size - 1 - y;
      flipped.set(readBuffer.subarray(srcY * rowBytes, srcY * rowBytes + rowBytes), y * rowBytes);
    }
    const palette = medianCut(flipped, options.paletteSize ?? 16);
    const colorSet = new Set<string>();
    if (palette.length > 0) {
      for (let i = 0; i < flipped.length; i += 4) {
        if (flipped[i + 3] <= 8) { flipped[i + 3] = 0; continue; }
        const pi = nearestPaletteIndex(flipped[i], flipped[i + 1], flipped[i + 2], palette);
        const c = palette[pi];
        flipped[i] = c[0]; flipped[i + 1] = c[1]; flipped[i + 2] = c[2]; flipped[i + 3] = 255;
        colorSet.add(`${c[0]},${c[1]},${c[2]}`);
      }
    }

    rt.dispose();
    gradientMap.dispose();
    geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    return {
      direction: direction as BakeResult['direction'],
      pixels: flipped,
      width: size,
      height: size,
      colorCount: colorSet.size,
      elapsedMs: 0,
    };
  } finally {
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch { /* noop */ }
  }
}
