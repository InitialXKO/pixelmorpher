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
  /** 破洞（边界环，模型空间）：全部视图的开口汇总 */
  rings: HoleRing[];
  /** 部件内 bone 列表（全局 index，按首次出现序） */
  partBones: number[];
}

/** 破洞（几何开口）：部件被剔出后在交界处留下的边界环 */
export interface HoleRing {
  /** 环顶点（模型空间，闭环不重复首尾） */
  points: THREE.Vector3[];
  /** 破洞所在骨骼（全局 index，环上三角形主 bone 众数） */
  bone: number;
}

/**
 * 从一个源网格的部件视图提取破洞（边界环）：洞是剔除产生的——整模本来没有洞，
 * 剔掉其他部位之后才在切口处张开。判定先过滤「发生过剔除」这个条件：
 * 一条边两侧的三角形分属保留（在本部件视图中）与被剔（不在视图中）两侧时，
 * 这条边才是洞的边界；模型固有开口（整模单边）没有被剔的一侧，不算洞。
 */
export function extractHoleRings(bm: BakedMesh, tris: number[][], triBone: number[]): HoleRing[] {
  const pos = bm.geometry.getAttribute('position') as THREE.BufferAttribute;
  const geo = bm.geometry;
  const index = geo.getIndex();
  const triCount = index ? index.count / 3 : Math.floor(pos.count / 3);
  const tkey = (a: number, b: number, c: number) => [a, b, c].sort((m, n) => m - n).join(',');
  const ekey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

  // 本部件视图的三角形 → 各自的 triBone（按无序顶点 key 对齐整模序号）
  const viewBone = new Map<string, number>();
  tris.forEach(([a, b, c], t) => viewBone.set(tkey(a, b, c), triBone[t]));

  // 整模每条边：统计两侧三角形中保留/被剔的分布
  interface EdgeSides { hasIn: boolean; hasOut: boolean; inBone: number }
  const edges = new Map<string, EdgeSides>();
  for (let t = 0; t < triCount; t++) {
    const a = index ? index.getX(t * 3) : t * 3;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const bone = viewBone.get(tkey(a, b, c));
    const isIn = bone !== undefined;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const k = ekey(u, v);
      let rec = edges.get(k);
      if (!rec) { rec = { hasIn: false, hasOut: false, inBone: -1 }; edges.set(k, rec); }
      if (isIn) { rec.hasIn = true; rec.inBone = bone as number; }
      else rec.hasOut = true;
    }
  }

  // 洞界边：两侧分属保留与被剔
  const adj = new Map<number, number[]>();
  const edgeBone = new Map<string, number>();
  const addAdj = (u: number, v: number) => {
    const arr = adj.get(u);
    if (arr) arr.push(v); else adj.set(u, [v]);
  };
  for (const [k, rec] of edges) {
    if (!rec.hasIn || !rec.hasOut) continue;
    const [u, v] = k.split('_').map(Number);
    addAdj(u, v);
    addAdj(v, u);
    edgeBone.set(k, rec.inBone);
  }

  const visited = new Set<number>();
  const rings: HoleRing[] = [];
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const ring: number[] = [];
    let cur = start;
    let prev = -1;
    while (true) {
      visited.add(cur);
      ring.push(cur);
      const nexts = (adj.get(cur) ?? []).filter((x) => x !== prev);
      if (nexts.length === 0) break;
      const nxt = nexts.find((x) => !visited.has(x)) ?? nexts[0];
      prev = cur;
      cur = nxt;
      if (cur === start || ring.length > 100000) break;
    }
    if (ring.length < 3) continue;
    const votes = new Map<number, number>();
    for (let i = 0; i < ring.length; i++) {
      const b = edgeBone.get(ekey(ring[i], ring[(i + 1) % ring.length]));
      if (b !== undefined && b >= 0) votes.set(b, (votes.get(b) ?? 0) + 1);
    }
    let bone = -1;
    let best = 0;
    for (const [b, n] of votes) if (n > best) { best = n; bone = b; }
    rings.push({
      points: ring.map((vi) => new THREE.Vector3().fromBufferAttribute(pos, vi)),
      bone,
    });
  }
  return rings;
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
  const rings: HoleRing[] = [];
  for (const bm of bakedMeshes) {
    const grouped = groupTrianglesByPart(bm, boneToPart);
    const pt = grouped.get(part)!;
    if (pt.tris.length === 0) continue;
    const index: number[] = [];
    for (const [a, b, c] of pt.tris) index.push(a, b, c);
    views.push({ source: bm, index });
    rings.push(...extractHoleRings(bm, pt.tris, pt.triBone));
  }
  if (views.length === 0) return null;

  // 部件内 bone 列表：从拓扑 boneToPart 直接取，不从顶点扫
  // （3D 拆分完已知六件归属，顶点扫描是冗余且易错的）
  const partBones: number[] = [];
  for (let bi = 0; bi < boneToPart.length; bi++) {
    if (boneToPart[bi] === part) partBones.push(bi);
  }
  return { part, views, rings, partBones };
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

/** 遮挡三角形：其他部位的三角形中，被剔除时因遮挡着本部件破洞而跳过剔除、留在本帧渲染的 */
export interface OccluderTri {
  meshIndex: number;
  /** 源网格内的三角形序号 */
  triIndex: number;
  /** 它遮挡的破洞所在骨骼（全局 index）——ID 遍用这个骨骼的 ID 色渲染它 */
  bone: number;
}

/** 投影到部件相机帧平面的破洞（环）：poly 为帧像素坐标，z 为 NDC 深度（越小越靠近相机） */
export interface HoleProj {
  poly: { x: number; y: number; z: number }[];
  bone: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

type Pt2 = { x: number; y: number };

function pointInPolygon(p: Pt2, poly: Pt2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsIntersect(p1: Pt2, p2: Pt2, p3: Pt2, p4: Pt2): Pt2 | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

function pointInTriangle(p: Pt2, a: Pt2, b: Pt2, c: Pt2): boolean {
  const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(d) < 1e-12) return false;
  const w1 = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / d;
  const w2 = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / d;
  const w3 = 1 - w1 - w2;
  return w1 >= -1e-9 && w2 >= -1e-9 && w3 >= -1e-9;
}

/** 三角形平面在 (x,y) 处的 NDC 深度（重心坐标插值） */
function triDepthAt(tri: { x: number; y: number; z: number }[], p: Pt2): number {
  const [a, b, c] = tri;
  const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(d) < 1e-12) return Math.min(a.z, b.z, c.z);
  const w1 = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / d;
  const w2 = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / d;
  return w1 * a.z + w2 * b.z + (1 - w1 - w2) * c.z;
}

/** 破洞（开口）在 (x,y) 处的深度近似：取最近环边在该点垂足处的插值深度 */
function holeDepthAt(hole: HoleProj, p: Pt2): number {
  let best = Infinity;
  let bestZ = Infinity;
  const poly = hole.poly;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    let t = len2 > 0 ? ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = p.x - (a.x + t * ex), dy = p.y - (a.y + t * ey);
    const d2 = dx * dx + dy * dy;
    if (d2 < best) { best = d2; bestZ = a.z + t * (b.z - a.z); }
  }
  return bestZ;
}

/**
 * 相机遮挡判定（逐三角形，剔除时的例外条件）：他部件三角形在本方向相机下
 * 是否盖住破洞且位于破洞前方。2D 重叠（顶点互含或边相交）取见证点，
 * 在见证点比较三角形深度与破洞深度，三角形更近才算遮挡。
 */
export function triangleOccludesHole(
  tri: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }, { x: number; y: number; z: number }],
  hole: HoleProj,
): boolean {
  // 包围盒粗筛
  let tMinX = Infinity, tMaxX = -Infinity, tMinY = Infinity, tMaxY = -Infinity;
  for (const v of tri) {
    if (v.x < tMinX) tMinX = v.x; if (v.x > tMaxX) tMaxX = v.x;
    if (v.y < tMinY) tMinY = v.y; if (v.y > tMaxY) tMaxY = v.y;
  }
  const hb = hole.bbox;
  if (tMaxX < hb.minX || tMinX > hb.maxX || tMaxY < hb.minY || tMinY > hb.maxY) return false;

  // 找见证点：三角顶点落在破洞内 / 破洞顶点落在三角内 / 边边相交
  let witness: Pt2 | null = null;
  for (const v of tri) if (pointInPolygon(v, hole.poly)) { witness = v; break; }
  if (!witness) {
    for (const v of hole.poly) if (pointInTriangle(v, tri[0], tri[1], tri[2])) { witness = v; break; }
  }
  if (!witness) {
    outer: for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3];
      for (let j = 0; j < hole.poly.length; j++) {
        const hit = segmentsIntersect(a, b, hole.poly[j], hole.poly[(j + 1) % hole.poly.length]);
        if (hit) { witness = hit; break outer; }
      }
    }
  }
  if (!witness) return false;
  return triDepthAt(tri, witness) < holeDepthAt(hole, witness) - 1e-4;
}

/** 遮挡者在 ID 遍的材质：整块输出破洞所在骨骼的 ID 色（与 ID 帧同一 RGB 掩码格式） */
function makeFlatIdMaterial(rgb: [number, number, number]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) } },
    vertexShader: `
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }
    `,
  });
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

    /** 源网格内一个三角形的三顶点序号 */
    const triVertsOf = (bm: BakedMesh, t: number): [number, number, number] => {
      const idx = bm.geometry.getIndex();
      return idx ? [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)] : [t * 3, t * 3 + 1, t * 3 + 2];
    };

    /**
     * 把本帧跳过剔除的遮挡者建成与 partGroup 同构的渲染组，随本部件同帧渲染：
     * 颜色组用遮挡者自己的材质；ID 组用破洞所在骨骼的 ID 色整块渲染。
     */
    const buildOccluderGroups = (
      occluders: OccluderTri[],
      localIndex: Map<number, number>,
    ): { colorGroup: THREE.Group; idGroup: THREE.Group } => {
      const wrap = (meshes: THREE.Mesh[]): THREE.Group => {
        const g = new THREE.Group();
        const inner = new THREE.Group();
        for (const m of meshes) inner.add(m);
        inner.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        inner.scale.setScalar(scale);
        g.add(inner);
        return g;
      };
      const colorIdx = new Map<number, number[]>();
      const idIdx = new Map<string, { mi: number; bone: number; idx: number[] }>();
      for (const occ of occluders) {
        const verts = triVertsOf(bakedMeshes[occ.meshIndex], occ.triIndex);
        let arr = colorIdx.get(occ.meshIndex);
        if (!arr) { arr = []; colorIdx.set(occ.meshIndex, arr); }
        arr.push(verts[0], verts[1], verts[2]);
        const k = `${occ.meshIndex}:${occ.bone}`;
        let rec = idIdx.get(k);
        if (!rec) { rec = { mi: occ.meshIndex, bone: occ.bone, idx: [] }; idIdx.set(k, rec); }
        rec.idx.push(verts[0], verts[1], verts[2]);
      }
      const colorMeshes: THREE.Mesh[] = [];
      for (const [mi, idx] of colorIdx) {
        const mesh = new THREE.Mesh(
          makeViewGeometry({ source: bakedMeshes[mi], index: idx }),
          makeToonFromSource(bakedMeshes[mi].material, gradientMap),
        );
        mesh.frustumCulled = false;
        colorMeshes.push(mesh);
      }
      const idMeshes: THREE.Mesh[] = [];
      for (const rec of idIdx.values()) {
        const li = localIndex.get(rec.bone);
        if (li === undefined) continue;
        const mesh = new THREE.Mesh(
          makeViewGeometry({ source: bakedMeshes[rec.mi], index: rec.idx }),
          makeFlatIdMaterial(encodeBoneId(li) as [number, number, number]),
        );
        mesh.frustumCulled = false;
        idMeshes.push(mesh);
      }
      return { colorGroup: wrap(colorMeshes), idGroup: wrap(idMeshes) };
    };
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
      total += 8 * (partNeedsId.get(pname) ? 2 : 1);
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

      // 本部件自己的三角形键集（剔除判定里不当作其他部位）
      const ownTriKeys = new Set<string>();
      for (const view of bp.views) {
        const mi = bakedMeshes.indexOf(view.source);
        for (let t = 0; t < view.index.length / 3; t++) ownTriKeys.add(`${mi}:${t}`);
      }

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

        // —— 本帧的剔除：其他部位的三角形逐个判定，遮挡着本部件破洞的跳过剔除、留在本帧渲染。
        // 破洞 = 部件切口的边界环（几何）；判定在本方向相机下逐三角形做（投影重叠 + 深度在前）。
        let occColorGroup: THREE.Group | null = null;
        let occIdGroup: THREE.Group | null = null;
        if (bp.rings.length > 0) {
          const upAxis = new THREE.Vector3(0, 1, 0);
          const tv = new THREE.Vector3();
          const projectPt = (p: THREE.Vector3) => {
            tv.copy(p).sub(center).multiplyScalar(scale).applyAxisAngle(upAxis, ang).project(camera);
            return { x: ((tv.x + 1) / 2) * size, y: ((1 - tv.y) / 2) * size, z: tv.z };
          };
          const holes: HoleProj[] = bp.rings.map((ring) => {
            const poly = ring.points.map((p) => projectPt(p));
            const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
            for (const q of poly) {
              if (q.x < bbox.minX) bbox.minX = q.x;
              if (q.x > bbox.maxX) bbox.maxX = q.x;
              if (q.y < bbox.minY) bbox.minY = q.y;
              if (q.y > bbox.maxY) bbox.maxY = q.y;
            }
            return { poly, bone: ring.bone, bbox };
          });
          const occluders: OccluderTri[] = [];
          const tmpV = new THREE.Vector3();
          bakedMeshes.forEach((bm, mi) => {
            const pa = bm.geometry.getAttribute('position') as THREE.BufferAttribute;
            const projected: { x: number; y: number; z: number }[] = new Array(pa.count);
            for (let vi = 0; vi < pa.count; vi++) {
              projected[vi] = projectPt(tmpV.fromBufferAttribute(pa, vi));
            }
            const triCount = Math.floor((bm.geometry.getIndex()?.count ?? pa.count) / 3);
            for (let t = 0; t < triCount; t++) {
              if (ownTriKeys.has(`${mi}:${t}`)) continue;
              const [a, b, c] = triVertsOf(bm, t);
              const tri = [projected[a], projected[b], projected[c]] as [
                { x: number; y: number; z: number },
                { x: number; y: number; z: number },
                { x: number; y: number; z: number },
              ];
              for (const hole of holes) {
                if (triangleOccludesHole(tri, hole)) {
                  occluders.push({ meshIndex: mi, triIndex: t, bone: hole.bone });
                  break;
                }
              }
            }
          });
          if (occluders.length > 0) {
            const built = buildOccluderGroups(occluders, localIndex);
            occColorGroup = built.colorGroup;
            occIdGroup = built.idGroup;
            occColorGroup.rotation.y = ang;
            occIdGroup.rotation.y = ang;
          }
        }

        renderer.setRenderTarget(rt);
        renderer.clear(true, true, false);

        // 颜色（本部件 + 跳过剔除的遮挡者，同帧一遍渲染）
        scene.remove(idInner);
        if (!scene.children.includes(partGroup)) scene.add(partGroup);
        if (occColorGroup) scene.add(occColorGroup);
        renderer.render(scene, camera);
        const colorPixels = readFlipped();
        onProgress?.(++done, total, `${SIX_PART_LABEL[pname]} ${d * 45}° 颜色`);
        await new Promise((r) => setTimeout(r, 0));
        if (occColorGroup) scene.remove(occColorGroup);

        // ID：单节点部件跳过（无需拆分）；遮挡者在 ID 里用破洞所在骨骼的 ID 色
        let idPixels: Uint8ClampedArray | undefined;
        if (partNeedsId.get(pname)) {
          scene.remove(partGroup);
          scene.add(idInner);
          idInner.rotation.y = ang;
          idInner.updateMatrixWorld(true);
          if (occIdGroup) scene.add(occIdGroup);
          renderer.clear(true, true, false);
          renderer.render(scene, camera);
          idPixels = readFlipped();
          onProgress?.(++done, total, `${SIX_PART_LABEL[pname]} ${d * 45}° ID`);
          await new Promise((r) => setTimeout(r, 0));
          if (occIdGroup) scene.remove(occIdGroup);
        }

        // 遮挡组释放：几何与源共享属性（同部件视图惯例），只 dispose 材质
        for (const g of [occColorGroup, occIdGroup]) {
          g?.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) (m.material as THREE.Material).dispose();
          });
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
