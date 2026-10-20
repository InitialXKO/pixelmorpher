// ============================================================
// PixelMorpher - three.js 六部件烘焙
// 3D 模型 → 6 大部件（头/躯干/左右臂/左右腿）→ 每部件 8 方向 ×（颜色+块内ID）
// 共 96 遍。分块独立渲染，无遮挡，无需双遍。
// 切割边界做几何封盖（三角扇，顶点色取环平均色）。
// 仅浏览器环境可用（WebGL）。
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  BakedBoneInfo,
  BoneMergeInfo,
  computeBoneMerge,
  computeTopologyMerge,
  encodeBoneId,
  type BoneGranularity,
} from './threejs-baker-twopass';
import type { BakeOptions } from './threejs-baker';
import {
  analyzeTopology,
  type PartName,
  type TopoBone,
  type TopologyResult,
} from './bone-topology';

export type SixPartName = 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR';
export const SIX_PARTS: SixPartName[] = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];
/** 全部件名（含尾巴/道具），拓扑驱动 */
export type { PartName } from './bone-topology';
/** 全部部件（含尾巴/道具） */
export const ALL_PARTS: PartName[] = [...SIX_PARTS, 'tail', 'props'];

export const SIX_PART_LABEL: Record<SixPartName, string> = {
  head: '头',
  torso: '躯干',
  armL: '左臂',
  armR: '右臂',
  legL: '左腿',
  legR: '右腿',
};
/** 全部件中文名 */
export const PART_LABEL: Record<PartName, string> = {
  ...SIX_PART_LABEL,
  tail: '尾巴',
  props: '道具',
};

// ---- bone 名 → 部件 ----
const HEAD_RE = /head|neck|skull|jaw|eye|ear|nose|mouth/i;
const TORSO_RE = /spine|hips|pelvis|shoulder|chest|waist|clavicle|torso|body/i;
const ARM_RE = /arm|forearm|elbow|hand|finger|thumb|wrist|palm/i;
const LEG_RE = /leg|thigh|shin|knee|foot|toe|ankle|calf/i;
const LEFT_RE = /left|_l\b|\bl_|[-_]l$/i;
const RIGHT_RE = /right|_r\b|\br_|[-_]r$/i;

/**
 * bone 名 → 六部件。返回 null 表示无法归属（调用方按 X 坐标 fallback）。
 */
export function assignBoneToPart(
  boneName: string,
  boneWorldX: number,
): SixPartName | null {
  const n = boneName;
  if (HEAD_RE.test(n) && !/spine/i.test(n)) return 'head';
  const isArm = ARM_RE.test(n);
  const isLeg = LEG_RE.test(n);
  if (isArm && !isLeg) {
    if (LEFT_RE.test(n)) return 'armL';
    if (RIGHT_RE.test(n)) return 'armR';
    // fallback：世界 X 符号（角色面朝 +Z 时 +X 为左）
    return boneWorldX >= 0 ? 'armL' : 'armR';
  }
  if (isLeg && !isArm) {
    if (LEFT_RE.test(n)) return 'legL';
    if (RIGHT_RE.test(n)) return 'legR';
    return boneWorldX >= 0 ? 'legL' : 'legR';
  }
  if (TORSO_RE.test(n)) return 'torso';
  return null;
}

// ---- 烘焙数据类型 ----
export interface SixPartGroup {
  part: PartName;
  direction: number;
  colorPixels: Uint8ClampedArray;
  /** 块内局部 bone ID（0,1,2…，见 partBoneMap）；单节点部件可省略（无需拆分） */
  idPixels?: Uint8ClampedArray;
  /** 相机半宽（归一化单位），用于跨部件尺寸归一化 */
  cameraHalf: number;
}

export interface SixPartBakeData {
  bones: BakedBoneInfo[];
  /** 48 组：6 部件 × 8 方向 */
  groups: SixPartGroup[];
  /** 部件 → 局部 ID → 全局 bone index */
  partBoneMap: Record<PartName, number[]>;
  /** 拓扑骨骼归属：boneIndex → PartName（2D split 用此过滤跨部件泄漏） */
  boneToPart: (PartName | null)[];
  width: number;
  height: number;
  normalization: { center: { x: number; y: number; z: number }; scale: number };
  merge: BoneMergeInfo;
  /** 整模相机半宽（归一化单位），用于全局统一尺度（可逆性：记录尺度差） */
  globalCameraHalf: number;
}

export interface SixPartBakeOptions extends BakeOptions {
  onProgress?: (done: number, total: number, label: string) => void;
  granularity?: BoneGranularity;
  smallBoneThreshold?: number;
  manualMerges?: Map<number, number>;
  manualUnmerges?: Set<number>;
  /** 每部件相机 padding 系数，默认 1.25 */
  partPadding?: number;
}

// ---- 内部：蒙皮烘焙为静态几何 ----
interface BakedMesh {
  geometry: THREE.BufferGeometry; // 静态，世界（模型）空间，已应用当前姿态
  material: THREE.Material | null; // 原材质（取色用）
  /** 每顶点主导 bone 的全局 index（-1=无） */
  vertBone: Int32Array;
  /** 每顶点 weight>0.2 的 bones（全局 index，用于 ID 位掩码重叠） */
  vertBones: number[][];
}

/**
 * 统计每 bone 的蒙皮权重和（遍历所有 SkinnedMesh）。
 * 非蒙皮 Mesh 若刚性挂在 bone 下，给该 bone 记 1（视为有效）。
 */
function computeBoneWeightSums(
  model: THREE.Object3D,
  bones: THREE.Bone[],
  indexByBone: Map<THREE.Bone, number>,
): number[] {
  const sums = new Array<number>(bones.length).fill(0);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const sm = mesh as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh && geo.getAttribute('skinIndex')) {
      const skinIndex = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
      const skinWeight = geo.getAttribute('skinWeight') as THREE.BufferAttribute;
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const skeleton = sm.skeleton;
      for (let v = 0; v < pos.count; v++) {
        for (let j = 0; j < 4; j++) {
          const w = skinWeight.getComponent(v, j);
          if (w <= 0) continue;
          const jointIdx = Math.round(skinIndex.getComponent(v, j));
          const bone = skeleton.bones[jointIdx];
          const gi = bone ? (indexByBone.get(bone) ?? -1) : -1;
          if (gi >= 0) sums[gi] += w;
        }
      }
    } else {
      // 刚性挂载：找最近 bone 祖先
      let p: THREE.Object3D | null = mesh.parent;
      while (p) {
        const b = p as THREE.Bone;
        if (b.isBone) {
          const gi = indexByBone.get(b);
          if (gi !== undefined) sums[gi] += 1;
          break;
        }
        p = p.parent;
      }
    }
  });
  return sums;
}

/**
 * 把 SkinnedMesh 的当前姿态烘焙为静态几何。
 * 返回每顶点的世界坐标 + 主导 bone。
 */
function bakeSkinnedMesh(
  mesh: THREE.Mesh,
  bones: THREE.Bone[],
  indexByBone: Map<THREE.Bone, number>,
): BakedMesh {
  const geo = mesh.geometry;
  const sm = mesh as THREE.SkinnedMesh;
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const index = geo.getIndex();
  const vCount = posAttr.count;

  const outPos = new Float32Array(vCount * 3);
  const vertBone = new Int32Array(vCount).fill(-1);
  const vertBones: number[][] = new Array(vCount);

  const v = new THREE.Vector3();
  if (sm.isSkinnedMesh && geo.getAttribute('skinIndex')) {
    const skinIndex = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
    const skinWeight = geo.getAttribute('skinWeight') as THREE.BufferAttribute;
    const skeleton = sm.skeleton;
    const bm = skeleton.boneMatrices; // Float32Array，每 bone 16 个 float
    const m = new THREE.Matrix4();
    const tv = new THREE.Vector3();
    for (let i = 0; i < vCount; i++) {
      v.fromBufferAttribute(posAttr, i);
      tv.set(0, 0, 0);
      let bestJ = -1;
      let bestW = -Infinity;
      for (let j = 0; j < 4; j++) {
        const w = skinWeight.getComponent(i, j);
        if (w <= 0) continue;
        const ji = Math.round(skinIndex.getComponent(i, j));
        const bone = skeleton.bones[ji];
        const gi = bone ? (indexByBone.get(bone) ?? -1) : -1;
        if (w > bestW) { bestW = w; bestJ = j; }
        if (gi < 0) continue;
        m.fromArray(bm, ji * 16);
        // boneMatrix 已含 bindMatrix，直接变换 bind pose 顶点
        const px = v.x, py = v.y, pz = v.z;
        const e = m.elements;
        const tx = e[0] * px + e[4] * py + e[8] * pz + e[12];
        const ty = e[1] * px + e[5] * py + e[9] * pz + e[13];
        const tz = e[2] * px + e[6] * py + e[10] * pz + e[14];
        tv.x += tx * w; tv.y += ty * w; tv.z += tz * w;
      }
      // mesh 的世界矩阵（model 在 group 里可能有变换，此处先取模型空间）
      outPos[i * 3] = tv.x; outPos[i * 3 + 1] = tv.y; outPos[i * 3 + 2] = tv.z;
      // 主导 bone（兼容旧逻辑：三角投票、封盖、顶点计数）
      if (bestJ >= 0) {
        const ji = Math.round(skinIndex.getComponent(i, bestJ));
        const bone = skeleton.bones[ji];
        vertBone[i] = bone ? (indexByBone.get(bone) ?? -1) : -1;
      }
      // weight>0.2 的全部 bones（ID 位掩码重叠用）
      const multi: number[] = [];
      for (let j = 0; j < 4; j++) {
        const w = skinWeight.getComponent(i, j);
        if (w <= 0.2) continue;
        const ji = Math.round(skinIndex.getComponent(i, j));
        const bone = skeleton.bones[ji];
        const gi = bone ? (indexByBone.get(bone) ?? -1) : -1;
        if (gi >= 0 && !multi.includes(gi)) multi.push(gi);
      }
      vertBones[i] = multi;
    }
  } else {
    // 非蒙皮：直接拷贝
    for (let i = 0; i < vCount; i++) {
      outPos[i * 3] = posAttr.getX(i);
      outPos[i * 3 + 1] = posAttr.getY(i);
      outPos[i * 3 + 2] = posAttr.getZ(i);
      vertBones[i] = [];
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  if (uvAttr) {
    const uv = new Float32Array(vCount * 2);
    for (let i = 0; i < vCount; i++) { uv[i * 2] = uvAttr.getX(i); uv[i * 2 + 1] = uvAttr.getY(i); }
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  if (index) {
    out.setIndex(index.clone());
  }
  // 法线稍后用 computeVertexNormals 重算（姿态变化后原法线不准）
  void normAttr;
  return { geometry: out, material: mesh.material as THREE.Material | null, vertBone, vertBones };
}

// ---- 部件拆分 ----
interface PartTriangles {
  /** 三角形顶点索引（原 baked 几何的顶点序） */
  tris: number[][];
  /** 三角形主导 bone（全局 index） */
  triBone: number[];
}

/**
 * 按部件分组三角形。返回 part → 三角形列表。
 * boneToPart: 全局 bone index → 部件名。
 */
export function groupTrianglesByPart(
  baked: BakedMesh,
  boneToPart: (PartName | null)[],
): Map<PartName, PartTriangles> {
  const geo = baked.geometry;
  const index = geo.getIndex();
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const triCount = index ? index.count / 3 : Math.floor(posAttr.count / 3);
  const result = new Map<PartName, PartTriangles>();
  for (const p of ALL_PARTS) result.set(p, { tris: [], triBone: [] });

  for (let t = 0; t < triCount; t++) {
    const a = index ? index.getX(t * 3) : t * 3;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    // 三角形主导 bone：三顶点投票（权重和最大）
    const votes = new Map<number, number>();
    const parts = new Set<PartName>();
    for (const vi of [a, b, c]) {
      const bi = baked.vertBone[vi];
      if (bi >= 0) {
        votes.set(bi, (votes.get(bi) ?? 0) + 1);
        const p = boneToPart[bi];
        if (p) parts.add(p);
      }
    }
    // 跨部件三角形不跳过：归入它涉及的每个部件——在交界破洞处由这块真实三角形本身遮挡，
    // 不再造封盖假面；像素归属在 2D 拆分时按 ID 掩码精确决定，不会双算
    if (parts.size === 0) continue;
    let bestBone = -1;
    let bestVotes = 0;
    for (const [bi, n] of votes) {
      if (n > bestVotes) { bestVotes = n; bestBone = bi; }
    }
    if (bestBone < 0) continue;
    for (const p of parts) {
      const pt = result.get(p)!;
      pt.tris.push([a, b, c]);
      pt.triBone.push(bestBone);
    }
  }
  return result;
}


// ---- 部件几何构建 ----
interface BuiltPartView {
  /** 数据源（整模静态几何；本视图与其它部件共享其属性数据，零复制） */
  source: BakedMesh;
  /** 本部件在此源几何上的三角形索引序列（原顶点序，本部件的「剔除」结果即这份视图） */
  index: number[];
}

interface BuiltPart {
  part: PartName;
  views: BuiltPartView[];
  /** 部件内 bone 列表（全局 index，按首次出现序） */
  partBones: number[];
}

/**
 * 构建单个部件的索引视图：不复制、不重拼几何——整模几何只有一份，
 * 每个部件只是它的一份索引（部件外的三角形不进本部件的索引，即被剔除）。
 * 跨部件三角形按 groupTrianglesByPart 的多归属同时出现在相关部件的视图里。
 */
export function buildPartGeometry(
  bakedMeshes: BakedMesh[],
  part: PartName,
  boneToPart: (PartName | null)[],
): BuiltPart | null {
  const views: BuiltPartView[] = [];
  for (const bm of bakedMeshes) {
    const grouped = groupTrianglesByPart(bm, boneToPart);
    const pt = grouped.get(part)!;
    if (pt.tris.length === 0) continue;
    const index: number[] = [];
    for (const [a, b, c] of pt.tris) index.push(a, b, c);
    views.push({ source: bm, index });
  }
  if (views.length === 0) return null;

  // 部件内 bone 列表：从拓扑 boneToPart 直接取，不从顶点扫
  // （3D 拆分完已知六件归属，顶点扫描是冗余且易错的）
  const partBones: number[] = [];
  for (let bi = 0; bi < boneToPart.length; bi++) {
    if (boneToPart[bi] === part) partBones.push(bi);
  }
  return { part, views, partBones };
}

/** 由索引视图生成渲染用几何：属性对象与源几何共享（不复制数据），只装本视图的索引。 */
function makeViewGeometry(view: BuiltPartView): THREE.BufferGeometry {
  const src = view.source.geometry;
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position');
  if (pos) g.setAttribute('position', pos);
  const nor = src.getAttribute('normal');
  if (nor) g.setAttribute('normal', nor);
  const uv = src.getAttribute('uv');
  if (uv) g.setAttribute('uv', uv);
  g.setIndex(view.index);
  return g;
}

/** 由源材质派生 toon 材质（保留源材质自己的 map/color） */
function makeToonFromSource(
  source: THREE.Material | null,
  gradientMap: THREE.DataTexture,
): THREE.MeshToonMaterial {
  const src = source as THREE.MeshStandardMaterial | null;
  return new THREE.MeshToonMaterial({
    color: src && 'color' in src && src.color ? (src.color as THREE.Color).clone() : new THREE.Color(0xffffff),
    ...(src && 'map' in src && src.map ? { map: src.map as THREE.Texture } : {}),
    gradientMap,
  });
}

// ---- 手臂下垂 ----

/**
 * 找臂链根（肩）：部件内 parent 不在本部件的 bone。
 * 肩按约定归躯干（见 boneToPart），所以臂部件的根即肩关节。
 */
function findArmRoot(
  parentIndex: (number | null)[],
  boneToPart: (PartName | null)[],
  part: 'armL' | 'armR',
): number | null {
  for (let i = 0; i < parentIndex.length; i++) {
    if (boneToPart[i] !== part) continue;
    const p = parentIndex[i];
    if (p === null || boneToPart[p] !== part) return i;
  }
  return null;
}

export interface ArmDroopResult {
  rotated: boolean;
  /** 臂原始方向与目标方向的夹角（度） */
  angleDeg: number;
}

/** 世界空间旋转某 bone（与 twopass 的 applyWorldRotation 同范式：由期望世界四元数反解局部四元数） */
function applyWorldQuaternion(bone: THREE.Bone, qDeltaWorld: THREE.Quaternion): void {
  const qOld = bone.getWorldQuaternion(new THREE.Quaternion());
  const qNew = qDeltaWorld.clone().multiply(qOld);
  const parent = bone.parent;
  if (!parent) return;
  const qParInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(qParInv.multiply(qNew));
}

/**
 * 手臂下垂：骨骼蒙皮动作——在蒙皮烘焙之前旋转肩骨（臂链根）的姿态，
 * 整臂由骨骼层级与蒙皮权重自然跟随变形，不动任何烘焙后顶点。
 *
 * - 当前臂方向 = 手 - 肩（归一化，bindPos 为摆姿前世界坐标）
 * - 目标方向 = (0,-1,0)，左右各外张 5°（避免贴躯干）
 *   - 角色面朝 +Z 时 +X 为左（与 assignBoneToPart 一致）
 * - 夹角 < 10° 时跳过（已是垂臂姿态）
 *
 * 调用方在两臂都处理后需 updateMatrixWorld 并重取 bindPos。
 */
export function droopArmPose(
  bones: THREE.Bone[],
  part: 'armL' | 'armR',
  shoulderIdx: number,
  handIdx: number,
  bindPos: THREE.Vector3[],
): ArmDroopResult {
  const result: ArmDroopResult = { rotated: false, angleDeg: 0 };
  const shoulderPos = bindPos[shoulderIdx];
  const handPos = bindPos[handIdx];
  if (!shoulderPos || !handPos) return result;

  const cur = new THREE.Vector3().subVectors(handPos, shoulderPos);
  if (cur.lengthSq() < 1e-12) return result;
  cur.normalize();

  // 目标：垂直向下 + 外张 5°
  // 绕 +Z 轴旋转：(0,-1,0) → (sinθ, -cosθ, 0)；左臂 +5°（+X），右臂 -5°
  const tilt = THREE.MathUtils.degToRad(5);
  const target = new THREE.Vector3(0, -1, 0).applyAxisAngle(
    new THREE.Vector3(0, 0, 1),
    part === 'armL' ? tilt : -tilt,
  );

  const angleDeg = THREE.MathUtils.radToDeg(cur.angleTo(target));
  result.angleDeg = angleDeg;
  if (angleDeg < 10) return result; // 已垂下，跳过

  const qDelta = new THREE.Quaternion().setFromUnitVectors(cur, target);
  applyWorldQuaternion(bones[shoulderIdx], qDelta);
  result.rotated = true;
  return result;
}

/**
 * 破洞填充（乙案）：部件轮廓**内部**的透明像素中、整模参考帧不透明处 = 被其他部位三角形遮挡的破洞。
 * 轮廓外透明（从帧四边可达）不填——那里背后是其他部位，填了等于把别的部件长进本部件。
 * 颜色取参考帧在该位置的真实颜色（遮挡者的颜色）；ID 不用遮挡者的，而是破洞所在骨骼的——
 * 从洞周边已有 ID 像素多源 BFS 扩散赋予，全图无 ID 源时用 fallbackMask（部件根骨骼）。
 * 返回填充像素数。
 */
export function fillOccludedHoles(
  colorPixels: Uint8ClampedArray,
  idPixels: Uint8ClampedArray | undefined,
  occlPixels: Uint8ClampedArray,
  size: number,
  fallbackMask: [number, number, number],
): number {
  const n = size * size;
  // 外部透明区：从帧四边 flood fill 可达的透明像素（部件轮廓之外，不算破洞，
  // 否则轮廓外背后其他部位的像素会被填进本部件）
  const outside = new Uint8Array(n);
  {
    const q: number[] = [];
    const seed = (i: number) => {
      if (!outside[i] && colorPixels[i * 4 + 3] === 0) { outside[i] = 1; q.push(i); }
    };
    for (let x = 0; x < size; x++) { seed(x); seed((size - 1) * size + x); }
    for (let y = 0; y < size; y++) { seed(y * size); seed(y * size + size - 1); }
    let h = 0;
    while (h < q.length) {
      const cur = q[h++];
      const cx = cur % size;
      if (cx > 0) seed(cur - 1);
      if (cx < size - 1) seed(cur + 1);
      if (cur - size >= 0) seed(cur - size);
      if (cur + size < n) seed(cur + size);
    }
  }
  const holes: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (colorPixels[o + 3] === 0 && !outside[i] && occlPixels[o + 3] > 0) {
      colorPixels[o] = occlPixels[o];
      colorPixels[o + 1] = occlPixels[o + 1];
      colorPixels[o + 2] = occlPixels[o + 2];
      colorPixels[o + 3] = occlPixels[o + 3];
      holes.push(i);
    }
  }
  if (holes.length === 0 || !idPixels) return holes.length;

  // 多源 BFS：从所有已有 ID 的像素出发，给洞像素赋最近源的掩码
  const assigned = new Uint8Array(n);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (idPixels[i * 4 + 3] > 0) { assigned[i] = 1; queue.push(i); }
  }
  const holeSet = new Set(holes);
  let head = 0;
  const spread = (from: number, to: number) => {
    if (to < 0 || to >= n || assigned[to]) return;
    if (!holeSet.has(to)) return;
    const fo = from * 4, to4 = to * 4;
    idPixels[to4] = idPixels[fo];
    idPixels[to4 + 1] = idPixels[fo + 1];
    idPixels[to4 + 2] = idPixels[fo + 2];
    idPixels[to4 + 3] = 255;
    assigned[to] = 1;
    queue.push(to);
  };
  while (head < queue.length) {
    const cur = queue[head++];
    const cx = cur % size;
    if (cx > 0) spread(cur, cur - 1);
    if (cx < size - 1) spread(cur, cur + 1);
    if (cur - size >= 0) spread(cur, cur - size);
    if (cur + size < n) spread(cur, cur + size);
  }
  // 仍未赋值（整图无 ID 源的极端情况）：回退掩码
  for (const i of holes) {
    if (assigned[i]) continue;
    const o = i * 4;
    idPixels[o] = fallbackMask[0];
    idPixels[o + 1] = fallbackMask[1];
    idPixels[o + 2] = fallbackMask[2];
    idPixels[o + 3] = 255;
  }
  return holes.length;
}

// ---- 卡通渐变 ----
function makeGradientMap(steps: number): THREE.DataTexture {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) data[i] = Math.round((i / (steps - 1)) * 255);
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** 拓扑分析用的轻量 bone 信息 */
export interface TopoParsedBone {
  index: number;
  name: string;
  parentIndex: number | null;
  worldPos: { x: number; y: number; z: number };
  weightSum: number;
}

/**
 * 轻量解析模型并做拓扑分析（不创建 WebGL 上下文、不渲染）。
 * 用于烘焙前的骨骼面板：显示拓扑结果（十字/髋部/手掌）+ 手动合并。
 */
export async function parseModelTopology(
  input: string | ArrayBuffer,
): Promise<{ bones: TopoParsedBone[]; topology: TopologyResult }> {
  if (typeof window === 'undefined') {
    throw new Error('parseModelTopology 仅支持浏览器环境');
  }
  const loader = new GLTFLoader();
  const gltf =
    typeof input === 'string' ? await loader.loadAsync(input) : await loader.parseAsync(input, '');
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  const bones: THREE.Bone[] = [];
  const indexByBone = new Map<THREE.Bone, number>();
  model.traverse((o) => {
    const b = o as THREE.Bone;
    if (b.isBone) { indexByBone.set(b, bones.length); bones.push(b); }
  });
  if (bones.length === 0) throw new Error('模型中没有找到骨骼 (Bone)');
  const parentIndex = bones.map((b) => {
    const p = b.parent as THREE.Bone | null;
    return p && p.isBone && indexByBone.has(p) ? indexByBone.get(p)! : null;
  });
  const bindPos = bones.map((b) => {
    const v = new THREE.Vector3();
    b.getWorldPosition(v);
    return v;
  });
  const weightSums = computeBoneWeightSums(model, bones, indexByBone);

  const topoBones: TopoBone[] = bones.map((b, i) => ({
    index: i,
    name: b.name || `bone_${i}`,
    parentIndex: parentIndex[i],
    worldPos: { x: bindPos[i].x, y: bindPos[i].y, z: bindPos[i].z },
    weightSum: weightSums[i],
  }));
  const topology = analyzeTopology(topoBones);
  return {
    bones: topoBones,
    topology,
  };
}

/**
 * 六部件烘焙。
 * 每部件独立场景：8 方向 ×（颜色 + 块内ID）= 96 遍。无双遍（无遮挡）。
 * 归一化用整模（各部件同 scale，保证拼装比例）。
 * 每部件相机独立取景（紧贴部件 bbox + padding）。
 */
export async function bakeSixParts(
  input: string | ArrayBuffer,
  options: SixPartBakeOptions = {},
): Promise<SixPartBakeData> {
  const size = options.size ?? 128;
  const toonSteps = options.toonSteps ?? 3;
  const onProgress = options.onProgress;
  const granularity: BoneGranularity = options.granularity ?? 'coarse';
  const smallBoneThreshold = options.smallBoneThreshold ?? 50;
  const manualMerges = options.manualMerges;
  const manualUnmerges = options.manualUnmerges;
  const partPadding = options.partPadding ?? 1.25;

  if (typeof window === 'undefined') {
    throw new Error('bakeSixParts 仅支持浏览器环境(WebGL)');
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
    const bones: THREE.Bone[] = [];
    const indexByBone = new Map<THREE.Bone, number>();
    model.traverse((o) => {
      const b = o as THREE.Bone;
      if (b.isBone) { indexByBone.set(b, bones.length); bones.push(b); }
    });
    if (bones.length === 0) throw new Error('模型中没有找到骨骼 (Bone)');
    const parentIndex = bones.map((b) => {
      const p = b.parent as THREE.Bone | null;
      return p && p.isBone && indexByBone.has(p) ? indexByBone.get(p)! : null;
    });
    const bindPos = bones.map((b) => {
      const v = new THREE.Vector3();
      b.getWorldPosition(v);
      return v;
    });

    // bone → 部件（拓扑驱动，失败时回退名字匹配）
    const weightSums = computeBoneWeightSums(model, bones, indexByBone);
    const topoBones: TopoBone[] = bones.map((b, i) => ({
      index: i,
      name: b.name || `bone_${i}`,
      parentIndex: parentIndex[i],
      worldPos: { x: bindPos[i].x, y: bindPos[i].y, z: bindPos[i].z },
      weightSum: weightSums[i],
    }));
    const topology: TopologyResult = analyzeTopology(topoBones);
    let boneToPart: (PartName | null)[];
    if (topology.cross !== null) {
      boneToPart = topology.boneToPart;
    } else {
      // 拓扑失败，回退名字匹配
      boneToPart = bones.map((b, i) => assignBoneToPart(b.name || '', bindPos[i].x));
    }

    // ---- 手臂下垂（骨骼姿态，提前到蒙皮烘焙之前）：转肩骨姿态，整臂由蒙皮自然变形 ----
    if (topology.cross !== null) {
      let anyDroop = false;
      for (const ap of ['armL', 'armR'] as const) {
        const shoulderIdx = findArmRoot(parentIndex, boneToPart, ap);
        const handIdx = ap === 'armL' ? topology.handL : topology.handR;
        if (shoulderIdx === null || handIdx === null) continue;
        const res = droopArmPose(bones, ap, shoulderIdx, handIdx, bindPos);
        if (res.rotated) anyDroop = true;
        console.log(`[bake] ${ap} 臂原始夹角 ${res.angleDeg.toFixed(1)}°${res.rotated ? ' → 已转垂下' : '（跳过）'}`);
      }
      if (anyDroop) {
        // 摆姿后重取关节世界位置（后续投影/拆分都读这份 bindPos）
        model.updateMatrixWorld(true);
        for (let bi = 0; bi < bones.length; bi++) bones[bi].getWorldPosition(bindPos[bi]);
      }
    }

    // ---- 蒙皮烘焙为静态 ----
    const bakedMeshes: BakedMesh[] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) sm.skeleton.update();
      bakedMeshes.push(bakeSkinnedMesh(m, bones, indexByBone));
    });
    if (bakedMeshes.length === 0) throw new Error('模型中没有找到 Mesh');

    // 法线：整模统一算一次（最终姿态），各部件索引视图共享
    for (const bm of bakedMeshes) bm.geometry.computeVertexNormals();

    // ---- 构建 6 部件（索引视图，不复制几何） ----
    const parts = new Map<PartName, BuiltPart>();
    for (const p of ALL_PARTS) {
      const built = buildPartGeometry(bakedMeshes, p, boneToPart);
      if (built) parts.set(p, built);
    }
    if (parts.size === 0) throw new Error('六部件拆分后没有可用几何');

    // ---- 整模归一化（各部件同 scale） ----
    const fullBox = new THREE.Box3();
    for (const bm of bakedMeshes) {
      bm.geometry.computeBoundingBox();
      fullBox.union(bm.geometry.boundingBox!);
    }
    const center = fullBox.getCenter(new THREE.Vector3());
    const sphere = fullBox.getBoundingSphere(new THREE.Sphere());
    const scale = sphere.radius > 1e-6 ? 1 / sphere.radius : 1;

    // ---- bone 合并（复用整模逻辑，用于 2D 拆分） ----
    const vertexCounts = new Array<number>(bones.length).fill(0);
    for (const [, bp] of parts) {
      for (const view of bp.views) {
        // 只统计被本部件视图实际引用的顶点
        for (const vi of new Set<number>(view.index)) {
          const bi = view.source.vertBone[vi];
          if (bi >= 0) vertexCounts[bi]++;
        }
      }
    }
    // 拓扑驱动默认合并（激进：只拆主关节），拓扑失败时回退名字匹配
    const merge = topology.cross !== null
      ? computeTopologyMerge(topology, bones.map((b) => b.name || ''), parentIndex, manualMerges, manualUnmerges)
      : computeBoneMerge(
          bones.map((b) => b.name || ''),
          parentIndex,
          vertexCounts,
          granularity,
          smallBoneThreshold,
          manualMerges,
          manualUnmerges,
        );

    // ---- BakedBoneInfo（含关节投影位） ----
    // 关节世界坐标（模型空间）→ 归一化 → 每部件每方向投影在渲染时算
    const normJoints = bindPos.map((p) =>
      new THREE.Vector3((p.x - center.x) * scale, (p.y - center.y) * scale, (p.z - center.z) * scale),
    );
    const boneInfos: BakedBoneInfo[] = bones.map((b, i) => ({
      index: i,
      name: b.name || `bone_${i}`,
      parentIndex: parentIndex[i],
      bindPos: { x: bindPos[i].x, y: bindPos[i].y, z: bindPos[i].z },
      jointPixels: [], // 六部件下按（部件，方向）投影，见 groups
      joint3D: { x: normJoints[i].x, y: normJoints[i].y, z: normJoints[i].z },
    }));

    // ---- 渲染 ----
    const gradientMap = makeGradientMap(toonSteps);
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

    const groups: SixPartGroup[] = [];
    // 整模参考组（遮挡破洞填充用）：与部件帧同相机渲整模，结构与 partGroup 同构
    const fullGroup = new THREE.Group();
    {
      const fullInner = new THREE.Group();
      for (const bm of bakedMeshes) {
        const mesh = new THREE.Mesh(bm.geometry, makeToonFromSource(bm.material, gradientMap));
        mesh.frustumCulled = false;
        fullInner.add(mesh);
      }
      fullInner.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      fullInner.scale.setScalar(scale);
      fullGroup.add(fullInner);
    }
    const partBoneMap = {} as Record<PartName, number[]>;
    // 单节点部件（合并后只剩一个有效骨骼）跳过 ID 遍：无需按骨骼拆分
    const partNeedsId = new Map<PartName, boolean>();
    for (const [pname, bp] of parts) {
      const effSet = new Set<number>();
      for (const gi of bp.partBones) {
        effSet.add(merge ? (merge.effectiveIndex[gi] ?? gi) : gi);
      }
      partNeedsId.set(pname, effSet.size > 1);
    }
    let total = 0;
    for (const pname of parts.keys()) {
      total += 8 * ((partNeedsId.get(pname) ? 2 : 1) + 1); // 颜色 + (ID) + 遮挡参考
    }
    let done = 0;

    // 部件内局部 ID → 全局 bone：用 partBones 顺序
    for (const [pname, bp] of parts) {
      partBoneMap[pname] = [...bp.partBones];

      // 归一化变换：整模 center/scale
      const partGroup = new THREE.Group();
      // 颜色遍：部件的每个索引视图用其源材质派生 toon 材质（各自的 map/color），不再全部件共用一份
      const inner = new THREE.Group();
      for (const view of bp.views) {
        const toonMat = makeToonFromSource(view.source.material, gradientMap);
        const mesh = new THREE.Mesh(makeViewGeometry(view), toonMat);
        mesh.frustumCulled = false;
        inner.add(mesh);
      }
      inner.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      // 注意：position 缩放要在 scale 之后——用 inner.scale + inner.position 组合：
      // world = scale * (pos - center) → inner.scale=scale, inner.position=-center*scale
      inner.scale.setScalar(scale);
      partGroup.add(inner);

      // 块内 ID：非索引几何 + DataTexture 位掩码 + flat shader（无插值）
      // 每个三角形 3 顶点 bone 集相同（取 3 顶点 vertBones 并集），三角形内部无插值，边界硬边
      // 部件的每个子几何各建一份 ID 几何/纹理（数据源为该子几何自己的 vertBones/vertBone）
      const localIndex = new Map<number, number>();
      bp.partBones.forEach((gi, li) => localIndex.set(gi, li));
      const idInner = new THREE.Group();
      for (const view of bp.views) {
        const srcPos = view.source.geometry.getAttribute('position') as THREE.BufferAttribute;
        const triCount = Math.floor(view.index.length / 3);
        if (triCount === 0) continue;
        const idPositions = new Float32Array(triCount * 9);
        const idTriIds = new Float32Array(triCount * 3);
        const idTexData = new Uint8Array(triCount * 4);
        for (let t = 0; t < triCount; t++) {
          // 三角形 bone 集：3 顶点 vertBones 并集 → 过滤非邻接 → 局部索引 → 按位或
          // 过滤：只保留与主 bone 邻接的（parent/child/self），防大腿含脚等跨级泄漏
          const triBones = new Set<number>();
          let primaryGi = -1;
          let primaryCount = 0;
          const boneCounts = new Map<number, number>();
          for (let k = 0; k < 3; k++) {
            const v = view.index[t * 3 + k];
            idPositions[(t * 3 + k) * 3] = srcPos.getX(v);
            idPositions[(t * 3 + k) * 3 + 1] = srcPos.getY(v);
            idPositions[(t * 3 + k) * 3 + 2] = srcPos.getZ(v);
            idTriIds[t * 3 + k] = t;
            const vbs = view.source.vertBones[v] ?? [];
            const bones = vbs.length > 0 ? vbs : (view.source.vertBone[v] >= 0 ? [view.source.vertBone[v]] : []);
            for (const gi of bones) {
              // 流程修正：ID 纹理只含本部件拓扑骨骼（防跨部件泄漏，如盆骨三角带大腿权重被分到腿部时，其 hips 权重不應出現在腿部 ID 图中）
              if (boneToPart[gi] !== pname) continue;
              triBones.add(gi);
              boneCounts.set(gi, (boneCounts.get(gi) ?? 0) + 1);
            }
          }
          // 主 bone = 出现最多的
          for (const [gi, n] of boneCounts) {
            if (n > primaryCount) { primaryCount = n; primaryGi = gi; }
          }
          // 邻接过滤
          const filtered = new Set<number>();
          if (primaryGi >= 0) {
            const pIdx = parentIndex[primaryGi];
            for (const gi of triBones) {
              if (gi === primaryGi || gi === pIdx || parentIndex[gi] === primaryGi) {
                filtered.add(gi);
              }
            }
            // 若过滤后为空（不应发生），回退到主 bone
            if (filtered.size === 0) filtered.add(primaryGi);
          }
          let r = 0, g = 0, b = 0;
          const seenLi = new Set<number>();
          for (const gi of filtered) {
            const li = localIndex.get(gi);
            if (li === undefined || li < 0 || li > 23 || seenLi.has(li)) continue;
            seenLi.add(li);
            const [br, bg, bb] = encodeBoneId(li);
            r |= br; g |= bg; b |= bb;
          }
          idTexData[t * 4] = r; idTexData[t * 4 + 1] = g;
          idTexData[t * 4 + 2] = b; idTexData[t * 4 + 3] = 255;
        }
        const idGeo = new THREE.BufferGeometry();
        idGeo.setAttribute('position', new THREE.BufferAttribute(idPositions, 3));
        idGeo.setAttribute('aTriId', new THREE.BufferAttribute(idTriIds, 1));
        // 一维排布宽度 = triCount，高面数部件会超 GPU 最大纹理尺寸（常见 8192/16384）→ 折成近方形二维
        const idTexW = Math.max(1, Math.ceil(Math.sqrt(triCount)));
        const idTexH = Math.max(1, Math.ceil(triCount / idTexW));
        const idTexFull = new Uint8Array(idTexW * idTexH * 4);
        idTexFull.set(idTexData);
        const idTex = new THREE.DataTexture(idTexFull, idTexW, idTexH, THREE.RGBAFormat, THREE.UnsignedByteType);
        idTex.minFilter = THREE.NearestFilter;
        idTex.magFilter = THREE.NearestFilter;
        idTex.needsUpdate = true;
        const idMat = new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          uniforms: { uIdTex: { value: idTex } },
          vertexShader: `
            in float aTriId;
            flat out int vTriId;
            void main() {
              vTriId = int(aTriId + 0.5);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            precision highp float;
            flat in int vTriId;
            uniform sampler2D uIdTex;
            out vec4 outColor;
            void main() {
              outColor = texelFetch(uIdTex, ivec2(vTriId % textureSize(uIdTex, 0).x, vTriId / textureSize(uIdTex, 0).x), 0);
            }
          `,
        });
        const idMesh = new THREE.Mesh(idGeo, idMat);
        idMesh.frustumCulled = false;
        idInner.add(idMesh);
      }
      idInner.position.copy(inner.position);
      idInner.scale.setScalar(scale);

      // 部件相机：紧贴部件 bbox（归一化空间）
      const pbox = new THREE.Box3();
      {
        const tv = new THREE.Vector3();
        for (const view of bp.views) {
          const pa = view.source.geometry.getAttribute('position') as THREE.BufferAttribute;
          for (const vi of new Set<number>(view.index)) {
            tv.fromBufferAttribute(pa, vi);
            tv.sub(center).multiplyScalar(scale);
            pbox.expandByPoint(tv);
          }
        }
      }
      const pcenter = pbox.getCenter(new THREE.Vector3());
      const psize = pbox.getSize(new THREE.Vector3());
      const half = Math.max(psize.x, psize.y) / 2 * partPadding;

      const scene = new THREE.Scene();
      scene.add(partGroup);
      scene.add(new THREE.AmbientLight(0xffffff, 0.9));
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
      dirLight.position.set(2, 3, 4);
      scene.add(dirLight);
      const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 20);
      camera.position.set(pcenter.x, pcenter.y + half * 0.25, pcenter.z + 4);
      camera.lookAt(pcenter);
      camera.updateMatrixWorld(true); // 必需：lookAt 不更新矩阵，首个方向（d=0/南向）的关节投影会用到过期的视图矩阵（首遍 render 后才被动更新，所以只有南向错）

      // 关节投影（此部件的 bones，每方向）
      const projV = new THREE.Vector3();

      for (let d = 0; d < 8; d++) {
        const ang = (d / 8) * Math.PI * 2;
        partGroup.rotation.y = ang;
        partGroup.updateMatrixWorld(true);

        // 关节像素（用部件相机），按规范方向索引
        for (const gi of bp.partBones) {
          projV.copy(normJoints[gi]).applyMatrix4(partGroup.matrixWorld).project(camera);
          boneInfos[gi].jointPixels[((d + 6) % 8)] = {
            x: ((projV.x + 1) / 2) * size,
            y: ((1 - projV.y) / 2) * size,
          };
        }

        renderer.setRenderTarget(rt);
        renderer.clear(true, true, false);

        // 颜色
        scene.remove(idInner);
        if (!scene.children.includes(partGroup)) scene.add(partGroup);
        renderer.render(scene, camera);
        const colorPixels = readFlipped();
        onProgress?.(++done, total, `${SIX_PART_LABEL[pname]} ${d * 45}° 颜色`);
        await new Promise((r) => setTimeout(r, 0));

        // ID：单节点部件跳过（无需拆分）
        let idPixels: Uint8ClampedArray | undefined;
        if (partNeedsId.get(pname)) {
          scene.remove(partGroup);
          scene.add(idInner);
          idInner.rotation.y = ang;
          idInner.updateMatrixWorld(true);
          renderer.clear(true, true, false);
          renderer.render(scene, camera);
          idPixels = readFlipped();
          onProgress?.(++done, total, `${SIX_PART_LABEL[pname]} ${d * 45}° ID`);
          await new Promise((r) => setTimeout(r, 0));
        }

        // 遮挡参考帧：同相机渲整模（找出被其他部位盖住的破洞）
        scene.remove(partGroup);
        scene.remove(idInner);
        if (!scene.children.includes(fullGroup)) scene.add(fullGroup);
        fullGroup.rotation.y = ang;
        fullGroup.updateMatrixWorld(true);
        renderer.clear(true, true, false);
        renderer.render(scene, camera);
        const occlPixels = readFlipped();
        onProgress?.(++done, total, `${SIX_PART_LABEL[pname]} ${d * 45}° 遮挡参考`);
        await new Promise((r) => setTimeout(r, 0));
        scene.remove(fullGroup);

        // 破洞填充：颜色取遮挡者的真实颜色；ID 取破洞所在骨骼的（由洞周边本部件 ID 扩散）
        {
          let fallbackMask: [number, number, number] = [0, 0, 0];
          if (idPixels) {
            let rootLi = 0;
            for (let li = 0; li < bp.partBones.length; li++) {
              const p = parentIndex[bp.partBones[li]];
              if (p === null || boneToPart[p] !== pname) { rootLi = li; break; }
            }
            fallbackMask = encodeBoneId(rootLi) as [number, number, number];
          }
          fillOccludedHoles(colorPixels, idPixels, occlPixels, size, fallbackMask);
        }

        groups.push({ part: pname, direction: ((d + 6) % 8), colorPixels, idPixels, cameraHalf: half });
        renderer.setRenderTarget(null);
      }

      // 清理本部件的颜色/ID 资源（视图几何与源几何共享属性数据，不在此释放）
      partGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.Material).dispose();
      });
      idInner.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.ShaderMaterial;
        (mat.uniforms.uIdTex.value as THREE.Texture).dispose();
        mat.dispose();
        m.geometry.dispose();
      });
    }

    fullGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) (m.material as THREE.Material).dispose();
    });
    rt.dispose();
    gradientMap.dispose();

    return {
      bones: boneInfos,
      groups,
      partBoneMap,
      boneToPart,
      width: size,
      height: size,
      normalization: { center: { x: center.x, y: center.y, z: center.z }, scale },
      merge,
      // 整模归一化到 [-1,1]，globalCameraHalf = 1.0（归一化单位）
      globalCameraHalf: 1.0,
    };
  } finally {
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch { /* noop */ }
  }
}
