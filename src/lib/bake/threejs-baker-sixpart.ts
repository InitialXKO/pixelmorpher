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
  /** 块内局部 bone ID（0,1,2…，见 partBoneMap） */
  idPixels: Uint8ClampedArray;
}

export interface SixPartBakeData {
  bones: BakedBoneInfo[];
  /** 48 组：6 部件 × 8 方向 */
  groups: SixPartGroup[];
  /** 部件 → 局部 ID → 全局 bone index */
  partBoneMap: Record<PartName, number[]>;
  width: number;
  height: number;
  normalization: { center: { x: number; y: number; z: number }; scale: number };
  merge: BoneMergeInfo;
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
function groupTrianglesByPart(
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
    // 跨部件三角形跳过（留给封盖填洞），不硬分到一侧
    if (parts.size !== 1) continue;
    let bestBone = -1;
    let bestVotes = 0;
    for (const [bi, n] of votes) {
      if (n > bestVotes) { bestVotes = n; bestBone = bi; }
    }
    if (bestBone < 0) continue;
    const part = boneToPart[bestBone];
    if (!part) continue; // 无归属的 bone（如未识别）跳过
    const pt = result.get(part)!;
    pt.tris.push([a, b, c]);
    pt.triBone.push(bestBone);
  }
  return result;
}

// ---- 边界检测与封盖 ----
interface BoundaryLoop {
  /** 有序顶点索引（原几何顶点序，闭环不重复首尾） */
  verts: number[];
}

/**
 * 找边界边（只被一个三角形使用的边），并连成环。
 */
function findBoundaryLoops(tris: number[][]): BoundaryLoop[] {
  const edgeCount = new Map<string, number>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (const [a, b, c] of tris) {
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const k = edgeKey(u, v);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }
  // 邻接表：顶点 → 相连的边界顶点
  const adj = new Map<number, number[]>();
  const addAdj = (u: number, v: number) => {
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u)!.push(v);
  };
  for (const [k, n] of edgeCount) {
    if (n !== 1) continue;
    const [a, b] = k.split('_').map(Number);
    addAdj(a, b);
    addAdj(b, a);
  }
  // 走环
  const visited = new Set<string>();
  const loops: BoundaryLoop[] = [];
  for (const [start] of adj) {
    for (const next of adj.get(start)!) {
      const ek = edgeKey(start, next);
      if (visited.has(ek)) continue;
      // 从 start→next 出发走环
      const loop = [start];
      let prev = start;
      let cur = next;
      visited.add(ek);
      while (cur !== start) {
        loop.push(cur);
        const nbs = adj.get(cur) ?? [];
        // 找下一个：排除 prev，优先未访问的边
        let nxt = -1;
        for (const nb of nbs) {
          if (nb === prev) continue;
          const k2 = edgeKey(cur, nb);
          if (!visited.has(k2)) { nxt = nb; visited.add(k2); break; }
        }
        if (nxt < 0) {
          // 死路：尝试走已访问的（环可能分叉，取任意未走过的）
          for (const nb of nbs) {
            if (nb === prev) continue;
            const k2 = edgeKey(cur, nb);
            if (!visited.has(k2)) { nxt = nb; visited.add(k2); break; }
          }
        }
        if (nxt < 0) break; // 非闭合，放弃此环
        prev = cur;
        cur = nxt;
        if (loop.length > 10000) break; // 防无限
      }
      if (cur === start && loop.length >= 3) {
        loops.push({ verts: loop });
      }
    }
  }
  return loops;
}

/**
 * 为部件几何加封盖（三角扇）。
 * - 每个边界环：质心为扇心，环顶点为扇边
 * - winding：按 Newell 法线与（环质心 - 部件质心）的点积决定，保证朝外
 * - 封盖顶点色 = baseColor（转 linear，钳制最低 0.08，避免纯黑）
 * - 封盖顶点的 bone ID 由 partBoneForCap(质心) 决定（用于块内 ID 图）
 */
function addCaps(
  positions: number[],
  uvs: number[] | null,
  colors: number[],
  indices: number[],
  loops: BoundaryLoop[],
  partCentroid: THREE.Vector3,
  baseColor: THREE.Color,
  partBoneForCap: (centroid: THREE.Vector3) => number,
  capVertBone: number[],
): void {
  const c = new THREE.Vector3();
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const outward = new THREE.Vector3();
  // 封盖色：baseColor 转 linear，避免纯黑
  const lc = baseColor.clone().convertSRGBToLinear();
  const cr = Math.max(lc.r, 0.08);
  const cg = Math.max(lc.g, 0.08);
  const cb = Math.max(lc.b, 0.08);

  for (const loop of loops) {
    const m = loop.verts.length;
    if (m < 3) continue;
    // 环质心
    c.set(0, 0, 0);
    for (const vi of loop.verts) {
      c.x += positions[vi * 3]; c.y += positions[vi * 3 + 1]; c.z += positions[vi * 3 + 2];
    }
    c.multiplyScalar(1 / m);
    // Newell 法线
    const n = new THREE.Vector3();
    for (let i = 0; i < m; i++) {
      const a = loop.verts[i];
      const b = loop.verts[(i + 1) % m];
      p0.set(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]);
      p1.set(positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]);
      n.x += (p0.y - p1.y) * (p0.z + p1.z);
      n.y += (p0.z - p1.z) * (p0.x + p1.x);
      n.z += (p0.x - p1.x) * (p0.y + p1.y);
    }
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    // 朝外方向 ≈ 环质心 - 部件质心
    outward.copy(c).sub(partCentroid);
    if (outward.lengthSq() < 1e-12) outward.set(0, 1, 0);
    outward.normalize();
    const flip = n.dot(outward) < 0;

    const centerIdx = positions.length / 3;
    positions.push(c.x, c.y, c.z);
    if (uvs) uvs.push(0.5, 0.5);
    colors.push(cr, cg, cb);
    capVertBone.push(partBoneForCap(c));

    for (let i = 0; i < m; i++) {
      const a = loop.verts[i];
      const b = loop.verts[(i + 1) % m];
      if (flip) indices.push(centerIdx, b, a);
      else indices.push(centerIdx, a, b);
    }
  }
}

// ---- 部件几何构建 ----
interface BuiltPart {
  part: PartName;
  /** 静态几何（模型空间，未归一化），含封盖 */
  geometry: THREE.BufferGeometry;
  /** 每顶点全局 bone index（封盖顶点已填） */
  vertBone: Int32Array;
  /** 每顶点 weight>0.2 的 bones（全局 index，ID 位掩码用；封盖为单元素） */
  vertBones: number[][];
  /** 部件内 bone 列表（全局 index，按首次出现序） */
  partBones: number[];
  /** 材质基色（封盖用） */
  baseColor: THREE.Color;
  /** 贴图（有则带上） */
  map: THREE.Texture | null;
}

/**
 * 从 baked meshes 构建单个部件的几何（含封盖）。
 */
function buildPartGeometry(
  bakedMeshes: BakedMesh[],
  part: PartName,
  boneToPart: (PartName | null)[],
  bones: THREE.Bone[],
): BuiltPart | null {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = []; // 顶点色：原顶点白，封盖用 baseColor
  const indices: number[] = [];
  const vertBone: number[] = [];
  const vertBones: number[][] = [];
  const hasUv: boolean[] = [];
  let baseColor = new THREE.Color(0xffffff);
  let map: THREE.Texture | null = null;
  let colorPicked = false;

  // 部件质心（封盖朝向用）：先收集再算
  const tmpCentroid = new THREE.Vector3();
  // 材质分组用：第一个封盖索引起始（-1 = 无封盖）
  let capIndexStart = -1;

  for (const bm of bakedMeshes) {
    const grouped = groupTrianglesByPart(bm, boneToPart);
    const pt = grouped.get(part)!;
    if (pt.tris.length === 0) continue;

    // 取材质基色（第一个非空）
    if (!colorPicked && bm.material) {
      const mt = bm.material as THREE.MeshStandardMaterial;
      if (mt && 'color' in mt && (mt as THREE.MeshStandardMaterial).color) {
        baseColor = ((mt as THREE.MeshStandardMaterial).color as THREE.Color).clone();
      }
      if (mt && 'map' in mt) {
        map = ((mt as THREE.MeshStandardMaterial).map as THREE.Texture | null) ?? null;
      }
      colorPicked = true;
    }

    const srcPos = bm.geometry.getAttribute('position') as THREE.BufferAttribute;
    const srcUv = bm.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const srcIndex = bm.geometry.getIndex();
    // 顶点重映射（去重）：原顶点序 → 新顶点序
    const remap = new Map<number, number>();
    const getNew = (vi: number): number => {
      let ni = remap.get(vi);
      if (ni === undefined) {
        ni = positions.length / 3;
        remap.set(vi, ni);
        positions.push(srcPos.getX(vi), srcPos.getY(vi), srcPos.getZ(vi));
        if (srcUv) uvs.push(srcUv.getX(vi), srcUv.getY(vi));
        hasUv.push(!!srcUv);
        colors.push(1, 1, 1);
        vertBone.push(bm.vertBone[vi]);
        vertBones.push(bm.vertBones[vi] ?? []);
      }
      return ni;
    };
    const localTris: number[][] = [];
    for (let ti = 0; ti < pt.tris.length; ti++) {
      const [a, b, c] = pt.tris[ti];
      const na = getNew(a), nb = getNew(b), nc = getNew(c);
      localTris.push([na, nb, nc]);
      indices.push(na, nb, nc);
    }
    // 封盖（在局部索引空间找边界环）
    const loops = findBoundaryLoops(localTris);
    if (loops.length > 0) {
      // 部件质心（当前已收集的顶点）
      tmpCentroid.set(0, 0, 0);
      const vc = positions.length / 3;
      for (let i = 0; i < vc; i++) {
        tmpCentroid.x += positions[i * 3];
        tmpCentroid.y += positions[i * 3 + 1];
        tmpCentroid.z += positions[i * 3 + 2];
      }
      tmpCentroid.multiplyScalar(1 / Math.max(vc, 1));
      const capVertBone: number[] = [];
      // 封盖 bone：取部件内出现最多的 bone（通常是根，如上臂）
      const boneFreq = new Map<number, number>();
      for (const vb of vertBone) {
        if (vb >= 0) boneFreq.set(vb, (boneFreq.get(vb) ?? 0) + 1);
      }
      let capBone = -1;
      let capBest = 0;
      for (const [bi, n] of boneFreq) {
        if (n > capBest) { capBest = n; capBone = bi; }
      }
      const useUv = hasUv.some(Boolean);
      if (capIndexStart < 0) capIndexStart = indices.length; // 记录第一个封盖起始
      addCaps(
        positions,
        useUv ? uvs : null,
        colors,
        indices,
        loops,
        tmpCentroid,
        baseColor,
        () => capBone,
        capVertBone,
      );
      // capVertBone 与新增顶点一一对应（addCaps 按序 push）
      for (const cb of capVertBone) {
        vertBone.push(cb);
        vertBones.push(cb >= 0 ? [cb] : []);
      }
    }
  }

  if (indices.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  // uv：只有全部顶点都有才加（混用会有问题，简单起见：有则加，无则不加）
  const useUv = hasUv.length > 0 && hasUv.every(Boolean) && uvs.length === (positions.length / 3) * 2;
  if (useUv) {
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(indices);
  // 材质分组：原几何（有纹理）vs 封盖（无纹理，纯顶点色）
  if (capIndexStart >= 0 && capIndexStart < indices.length) {
    geo.addGroup(0, capIndexStart, 0);
    geo.addGroup(capIndexStart, indices.length - capIndexStart, 1);
  }
  geo.computeVertexNormals();

  // 部件内 bone 列表：从拓扑 boneToPart 直接取，不从顶点扫
  // （3D 拆分完已知六件归属，顶点扫描是冗余且易错的）
  const partBones: number[] = [];
  for (let bi = 0; bi < boneToPart.length; bi++) {
    if (boneToPart[bi] === part) partBones.push(bi);
  }

  return {
    part,
    geometry: geo,
    vertBone: new Int32Array(vertBone),
    vertBones,
    partBones,
    baseColor,
    map,
  };
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
  /** 应用到顶点的四元数（null = 未旋转） */
  quaternion: THREE.Quaternion | null;
  /** 肩关节位置（模型空间） */
  shoulderPos: THREE.Vector3;
}

/**
 * 手臂下垂旋转：把臂部件几何绕肩关节转到自然垂下。
 *
 * - 当前臂方向 = 手腕 - 肩（归一化）
 * - 目标方向 = (0,-1,0)，左右各外张 5°（避免贴躯干）
 *   - 角色面朝 +Z 时 +X 为左（与 assignBoneToPart 一致）
 * - 夹角 < 10° 时跳过（已是垂臂姿态）
 *
 * 只旋转几何顶点；调用方需同步旋转对应 bone 的 bindPos（关节投影用）。
 */
export function droopArmPart(
  built: BuiltPart,
  part: 'armL' | 'armR',
  shoulderPos: THREE.Vector3,
  handPos: THREE.Vector3,
): ArmDroopResult {
  const result: ArmDroopResult = {
    rotated: false,
    angleDeg: 0,
    quaternion: null,
    shoulderPos: shoulderPos.clone(),
  };

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

  const quat = new THREE.Quaternion().setFromUnitVectors(cur, target);
  result.quaternion = quat;
  result.rotated = true;

  // 旋转全部顶点（绕肩关节）
  const pos = built.geometry.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.sub(shoulderPos).applyQuaternion(quat).add(shoulderPos);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  built.geometry.computeVertexNormals();
  built.geometry.computeBoundingBox();
  return result;
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

    // ---- 构建 6 部件 ----
    const parts = new Map<PartName, BuiltPart>();
    for (const p of ALL_PARTS) {
      const built = buildPartGeometry(bakedMeshes, p, boneToPart, bones);
      if (built) parts.set(p, built);
    }
    if (parts.size === 0) throw new Error('六部件拆分后没有可用几何');

    // ---- 手臂下垂：armL/armR 转成自然垂下姿态（非 T-pose） ----
    // 在归一化之前做，使 bbox/scale 按垂臂姿态计算；关节投影用旋转后的 bindPos。
    if (topology.cross !== null) {
      for (const ap of ['armL', 'armR'] as const) {
        const built = parts.get(ap);
        if (!built) continue;
        const shoulderIdx = findArmRoot(parentIndex, boneToPart, ap);
        const handIdx = ap === 'armL' ? topology.handL : topology.handR;
        if (shoulderIdx === null || handIdx === null) continue;
        const res = droopArmPart(built, ap, bindPos[shoulderIdx], bindPos[handIdx]);
        if (res.rotated && res.quaternion) {
          // 同步旋转该部件 bones 的 bindPos（关节投影/后续流程用）
          const q = res.quaternion;
          const s = res.shoulderPos;
          const v = new THREE.Vector3();
          for (let bi = 0; bi < bones.length; bi++) {
            if (boneToPart[bi] !== ap) continue;
            v.copy(bindPos[bi]).sub(s).applyQuaternion(q).add(s);
            bindPos[bi].copy(v);
          }
          // 同步拓扑输入的世界坐标（topoBones 已用于分析，此处仅保持一致性，无需重分析）
        }
        console.log(`[bake] ${ap} 臂原始夹角 ${res.angleDeg.toFixed(1)}°${res.rotated ? ' → 已转垂下' : '（跳过）'}`);
      }
    }

    // ---- 整模归一化（各部件同 scale） ----
    const fullBox = new THREE.Box3();
    for (const [, bp] of parts) {
      bp.geometry.computeBoundingBox();
      fullBox.union(bp.geometry.boundingBox!);
    }
    const center = fullBox.getCenter(new THREE.Vector3());
    const sphere = fullBox.getBoundingSphere(new THREE.Sphere());
    const scale = sphere.radius > 1e-6 ? 1 / sphere.radius : 1;

    // ---- bone 合并（复用整模逻辑，用于 2D 拆分） ----
    const vertexCounts = new Array<number>(bones.length).fill(0);
    for (const [, bp] of parts) {
      for (let i = 0; i < bp.vertBone.length; i++) {
        const bi = bp.vertBone[i];
        if (bi >= 0) vertexCounts[bi]++;
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
    const partBoneMap = {} as Record<PartName, number[]>;
    const total = parts.size * 8 * 2;
    let done = 0;

    // 部件内局部 ID → 全局 bone：用 partBones 顺序
    for (const [pname, bp] of parts) {
      partBoneMap[pname] = [...bp.partBones];

      // 归一化变换：整模 center/scale
      const partGroup = new THREE.Group();
      const toonMat = new THREE.MeshToonMaterial({
        color: new THREE.Color(0xffffff),
        map: bp.map ?? undefined,
        gradientMap,
        vertexColors: true,
      });
      // 封盖材质：无纹理，纯顶点色（避免纹理×封盖色）
      const capMat = new THREE.MeshToonMaterial({
        color: new THREE.Color(0xffffff),
        gradientMap,
        vertexColors: true,
      });
      const mesh = new THREE.Mesh(bp.geometry, [toonMat, capMat]);
      mesh.frustumCulled = false;
      // 应用归一化：geometry 是模型空间，移到 group 里做位移缩放
      const inner = new THREE.Group();
      inner.add(mesh);
      inner.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      // 注意：position 缩放要在 scale 之后——用 inner.scale + inner.position 组合：
      // world = scale * (pos - center) → inner.scale=scale, inner.position=-center*scale
      inner.scale.setScalar(scale);
      partGroup.add(inner);

      // 块内 ID 顶点色（局部索引位掩码；weight>0.2 的 bones 按位或，边界重叠）
      const idColors = new Float32Array(bp.vertBone.length * 3);
      const localIndex = new Map<number, number>();
      bp.partBones.forEach((gi, li) => localIndex.set(gi, li));
      for (let i = 0; i < bp.vertBone.length; i++) {
        let r = 0, g = 0, b = 0;
        const vbs = bp.vertBones[i] ?? [];
        // 兜底：vertBones 为空时用主导 bone
        const bones = vbs.length > 0 ? vbs : (bp.vertBone[i] >= 0 ? [bp.vertBone[i]] : []);
        for (const gi of bones) {
          const li = localIndex.get(gi);
          if (li === undefined || li < 0 || li > 23) continue;
          const [br, bg, bb] = encodeBoneId(li);
          r |= br; g |= bg; b |= bb;
        }
        idColors[i * 3] = r / 255; idColors[i * 3 + 1] = g / 255; idColors[i * 3 + 2] = b / 255;
      }
      const idGeo = new THREE.BufferGeometry();
      idGeo.setAttribute('position', bp.geometry.getAttribute('position'));
      idGeo.setIndex(bp.geometry.getIndex());
      idGeo.setAttribute('color', new THREE.BufferAttribute(idColors, 3));
      idGeo.computeVertexNormals();
      const idMat = new THREE.MeshBasicMaterial({ vertexColors: true });
      const idMesh = new THREE.Mesh(idGeo, idMat);
      idMesh.frustumCulled = false;
      const idInner = new THREE.Group();
      idInner.add(idMesh);
      idInner.position.copy(inner.position);
      idInner.scale.setScalar(scale);

      // 部件相机：紧贴部件 bbox（归一化空间）
      const pbox = new THREE.Box3();
      {
        const pa = bp.geometry.getAttribute('position') as THREE.BufferAttribute;
        const tv = new THREE.Vector3();
        for (let i = 0; i < pa.count; i++) {
          tv.fromBufferAttribute(pa, i);
          tv.sub(center).multiplyScalar(scale);
          pbox.expandByPoint(tv);
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

      // 关节投影（此部件的 bones，每方向）
      const projV = new THREE.Vector3();

      for (let d = 0; d < 8; d++) {
        const ang = (d / 8) * Math.PI * 2;
        partGroup.rotation.y = ang;
        partGroup.updateMatrixWorld(true);

        // 关节像素（用部件相机）
        for (const gi of bp.partBones) {
          projV.copy(normJoints[gi]).applyMatrix4(partGroup.matrixWorld).project(camera);
          boneInfos[gi].jointPixels.push({
            x: ((projV.x + 1) / 2) * size,
            y: ((1 - projV.y) / 2) * size,
          });
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

        // ID（同角度，不清 depth 也无妨，单遍无遮挡问题）
        scene.remove(partGroup);
        scene.add(idInner);
        idInner.rotation.y = ang;
        idInner.updateMatrixWorld(true);
        renderer.clear(true, true, false);
        renderer.render(scene, camera);
        const idPixels = readFlipped();
        onProgress?.(++done, total, `${SIX_PART_LABEL[pname]} ${d * 45}° ID`);
        await new Promise((r) => setTimeout(r, 0));

        groups.push({ part: pname, direction: ((d + 6) % 8), colorPixels, idPixels });
        renderer.setRenderTarget(null);
      }

      toonMat.dispose();
      capMat.dispose();
      idMat.dispose();
      idGeo.dispose();
    }

    rt.dispose();
    gradientMap.dispose();

    return {
      bones: boneInfos,
      groups,
      partBoneMap,
      width: size,
      height: size,
      normalization: { center: { x: center.x, y: center.y, z: center.z }, scale },
      merge,
    };
  } finally {
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch { /* noop */ }
  }
}
