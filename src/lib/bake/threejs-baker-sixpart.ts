// ============================================================
// PixelMorpher - three.js 六部件烘焙
// 3D 模型 → 6 大部件（头/躯干/左右臂/左右腿）→ 每部件 8 方向 ×（颜色+块内ID）
// 共 96 遍。分块独立渲染，无遮挡，无需双遍。
// 切割边界做几何封盖（三角扇，顶点色取环平均色）。
// 仅浏览器环境可用（WebGL）。
// ============================================================

import * as THREE from 'three';
import { loadModelScene } from './load-model';
import { makeNprFromSource } from './pmx-npr';
import {
  BakedBoneInfo,
  BoneMergeInfo,
  boneMaskSet,
  computeBoneMerge,
  computeTopologyMerge,
  encodeBoneQuad,
  type BoneGranularity,
} from './threejs-baker-twopass';
import type { BakeOptions } from './threejs-baker';
import { dirsForLatitude, latitudePitchRad } from './threejs-baker';
import { sliceStack, type SliceStackResult } from './stack-slicer';
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
  // MMD 日文标准骨名（PMX 导入）：左/右前缀定侧；先于英文正则（手首/足首含「首」防误入 head）
  if (/腕|ひじ|手首|手捩|指/.test(n)) return n.startsWith('右') ? 'armR' : 'armL';
  if (/足|ひざ|つま先/.test(n)) {
    if (/ＩＫ|IK/.test(n)) return null; // IK 骨（足ＩＫ等）无蒙皮权重，归属由拓扑合并处理
    return n.startsWith('右') ? 'legR' : 'legL';
  }
  if (/頭|目|眼|髪|髮/.test(n) || (/首/.test(n) && !/手首/.test(n))) return 'head';
  if (/上半身|下半身|腰|胸|肩|センター/.test(n)) return 'torso';
  // VRoid / VRM 标准人形骨名（J_Bip_*；J_Sec_* 为头发/裙摆等次级骨）
  if (n.includes('J_Bip_') || n.startsWith('J_Sec_') || n.includes('J_Opt_')) {
    const side = /_L_/.test(n) ? 'L' : /_R_/.test(n) ? 'R' : 'C';
    if (/Shoulder/.test(n)) return 'torso'; // 锁骨归躯干（与英文 shoulder 的现有约定一致）
    if (/UpperArm|LowerArm|Forearm|Hand|Thumb|Index|Middle|Ring|Little/.test(n))
      return side === 'R' ? 'armR' : 'armL';
    if (/UpperLeg|LowerLeg|Foot|Toe/.test(n)) return side === 'R' ? 'legR' : 'legL';
    if (/Head|Neck|Eye/.test(n)) return 'head';
    if (/Hips|Spine|Chest|UpperChest/.test(n)) return 'torso';
    if (/Hair/.test(n)) return 'head'; // J_Sec 头发
    if (/Skirt|Bust/.test(n)) return 'torso'; // J_Sec 裙摆/胸部弹簧骨
    return null;
  }
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
  /** 视角纬度（度，undefined/0=基纬度） */
  latitude?: number;
  /** 本组（纬度,方向）下本部件各 bone 的关节像素（全局 bone index → 像素） */
  jointPixels?: Record<number, { x: number; y: number }>;
  colorPixels: Uint8ClampedArray;
  /** 块内局部 bone ID 低半（字节 0..3 = 局部 bone 0..31，见 partBoneMap）；单节点部件可省略（无需拆分） */
  idPixels?: Uint8ClampedArray;
  /** 块内局部 bone ID 高半（字节 4..7 = 局部 bone 32..63） */
  idPixelsHi?: Uint8ClampedArray;
  /** 图层 ID（R 通道 = 视图号+1，0=无图层像素）：图层模式（layerPass）才有，
   * 视图 = (网格 × 材质组)，拆分按（骨骼 × 图层）再分一次 */
  layerPixels?: Uint8ClampedArray;
  /** 相机半宽（归一化单位），用于跨部件尺寸归一化 */
  cameraHalf: number;
}

/** 部件堆叠切片产物（withStacks 开启时）：切片在角色空间完成，
 *  导入时由 stack-attach 按宿主节点静止帧变换到节点局部并挂上服装件 */
export interface PartStackSlice {
  /** 宿主骨骼（合并后 effective 下标）= 部件根骨骼 */
  rootBoneIndex: number;
  rootBoneName: string;
  sliced: SliceStackResult;
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
  /** 图层模式元数据：部件 → 视图（图层）清单（顺序 = layerPixels 里的层号-1）；
   * rank = 正面帧相机深度中位数定的画序（0 = 最远、先画） */
  partLayers?: Partial<Record<PartName, { key: string; label: string; rank: number }[]>>;
  /** 部件堆叠切片（withStacks 开启且部件有产出时才有） */
  partStacks?: Map<PartName, PartStackSlice>;
  /** 无归属三角形丢弃数（主导骨骼不属于任何部件；开启 absorbUnassigned 后为仍无法归入的孤立数） */
  droppedTriCount: number;
  /** 无归属三角形按邻近投票归入部件的数量（absorbUnassigned 关闭时为 0） */
  absorbedTriCount: number;
  /** 归入时权重集暂时改到邻近骨骼的三角形数量（使像素真正落入归入部件） */
  absorbedReweightedCount: number;
}

export interface SixPartBakeOptions extends BakeOptions {
  onProgress?: (done: number, total: number, label: string) => void;
  /** 图层模式：每部件每方向多渲一遍图层 ID（视图号），拆分产出分层精灵 */
  layerPass?: boolean;
  granularity?: BoneGranularity;
  smallBoneThreshold?: number;
  manualMerges?: Map<number, number>;
  manualUnmerges?: Set<number>;
  /** 每部件相机 padding 系数，默认 1.25 */
  partPadding?: number;
  /** 同时产出精灵堆叠切片（第二产线）：每部件一摞截面层图数据，
   *  导入时挂到部件根骨骼节点的服装件上（呈现走堆叠合成） */
  withStacks?: boolean;
  /** 堆叠层厚（全局像素），默认 size/128（512 时 4px） */
  stackLayerThicknessPx?: number;
  /** 只为这些部件产堆叠（缺省 = 全部六部件）；对话框按部件勾选时传入 */
  stackParts?: readonly SixPartName[];
}

// ---- 内部：蒙皮烘焙为静态几何 ----
interface BakedMesh {
  geometry: THREE.BufferGeometry; // 静态，世界（模型）空间，已应用当前姿态
  material: THREE.Material | null; // 原材质（取色用；多材质网格时为第一个，逐组材质看 materials/triMaterial）
  /** 网格的全部材质（单材质时长度 1）；PMX 等多材质网格的 mesh.material 是数组，
   * 曾被整体塞进 material 字段骗过 makeToonFromSource 的 'map' in 检查
   * （数组继承 Array.prototype.map），视图必须按 triMaterial 取单个材质 */
  materials: (THREE.Material | null)[];
  /** 每三角形（索引序，与 groupTrianglesByPart 的枚举一致）的材质下标（geometry.groups 派生，无组时全 0） */
  triMaterial: Int32Array;
  /** 每顶点主导 bone 的全局 index（-1=无） */
  vertBone: Int32Array;
  /** 每顶点 weight>阈值（BakeOptions.weightThreshold，默认 0.2）的 bones（全局 index，用于 ID 位掩码重叠） */
  vertBones: number[][];
}

/**
 * 统计每 bone 的蒙皮权重和（遍历所有 SkinnedMesh）。
 * 非蒙皮 Mesh 若刚性挂在 bone 下，给该 bone 记 1（视为有效）。
 */
export function computeBoneWeightSums(
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
 * 法线保留模型原始法线做同样的蒙皮混合（与整模双遍 three 着色器的口径一致）：
 * 原先整模 computeVertexNormals 重算会丢掉作者法线（PMX 脸部尤甚）、且两条
 * 烘焙线明暗口径不一致。姿态由骨骼矩阵驱动，蒙皮后的法线本身就是姿态正确的。
 */
export function bakeSkinnedMesh(
  mesh: THREE.Mesh,
  bones: THREE.Bone[],
  indexByBone: Map<THREE.Bone, number>,
  weightThreshold = 0.2,
): BakedMesh {
  const geo = mesh.geometry;
  const sm = mesh as THREE.SkinnedMesh;
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const index = geo.getIndex();
  const vCount = posAttr.count;

  const outPos = new Float32Array(vCount * 3);
  const outNorm = normAttr ? new Float32Array(vCount * 3) : null;
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
    const nv = new THREE.Vector3();
    for (let i = 0; i < vCount; i++) {
      v.fromBufferAttribute(posAttr, i);
      tv.set(0, 0, 0);
      nv.set(0, 0, 0);
      const nx = normAttr ? normAttr.getX(i) : 0;
      const ny = normAttr ? normAttr.getY(i) : 0;
      const nz = normAttr ? normAttr.getZ(i) : 0;
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
        // 法线：同一骨骼矩阵的上 3×3 混合（three 着色器蒙皮法线同口径）
        if (outNorm) {
          nv.x += (e[0] * nx + e[4] * ny + e[8] * nz) * w;
          nv.y += (e[1] * nx + e[5] * ny + e[9] * nz) * w;
          nv.z += (e[2] * nx + e[6] * ny + e[10] * nz) * w;
        }
      }
      if (outNorm) {
        const len = Math.hypot(nv.x, nv.y, nv.z);
        if (len > 1e-9) { nv.x /= len; nv.y /= len; nv.z /= len; }
        outNorm[i * 3] = nv.x; outNorm[i * 3 + 1] = nv.y; outNorm[i * 3 + 2] = nv.z;
      }
      // mesh 的世界矩阵（model 在 group 里可能有变换，此处先取模型空间）
      outPos[i * 3] = tv.x; outPos[i * 3 + 1] = tv.y; outPos[i * 3 + 2] = tv.z;
      // 主导 bone（兼容旧逻辑：三角投票、封盖、顶点计数）
      if (bestJ >= 0) {
        const ji = Math.round(skinIndex.getComponent(i, bestJ));
        const bone = skeleton.bones[ji];
        vertBone[i] = bone ? (indexByBone.get(bone) ?? -1) : -1;
      }
      // weight>阈值的全部 bones（ID 位掩码重叠用）
      const multi: number[] = [];
      for (let j = 0; j < 4; j++) {
        const w = skinWeight.getComponent(i, j);
        if (w <= weightThreshold) continue;
        const ji = Math.round(skinIndex.getComponent(i, j));
        const bone = skeleton.bones[ji];
        const gi = bone ? (indexByBone.get(bone) ?? -1) : -1;
        if (gi >= 0 && !multi.includes(gi)) multi.push(gi);
      }
      vertBones[i] = multi;
    }
  } else {
    // 非蒙皮：直接拷贝（法线同源拷贝，保持与位置一致的原始法线）
    for (let i = 0; i < vCount; i++) {
      outPos[i * 3] = posAttr.getX(i);
      outPos[i * 3 + 1] = posAttr.getY(i);
      outPos[i * 3 + 2] = posAttr.getZ(i);
      if (outNorm && normAttr) {
        outNorm[i * 3] = normAttr.getX(i);
        outNorm[i * 3 + 1] = normAttr.getY(i);
        outNorm[i * 3 + 2] = normAttr.getZ(i);
      }
      vertBones[i] = [];
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  if (outNorm) out.setAttribute('normal', new THREE.BufferAttribute(outNorm, 3));
  if (uvAttr) {
    const uv = new Float32Array(vCount * 2);
    for (let i = 0; i < vCount; i++) { uv[i * 2] = uvAttr.getX(i); uv[i * 2 + 1] = uvAttr.getY(i); }
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  if (index) {
    out.setIndex(index.clone());
  }
  const materials: (THREE.Material | null)[] = Array.isArray(mesh.material)
    ? [...mesh.material]
    : mesh.material ? [mesh.material] : [];
  const triCount = index ? index.count / 3 : Math.floor(posAttr.count / 3);
  const triMaterial = new Int32Array(triCount);
  for (const g of geo.groups) {
    const start = Math.floor(g.start / 3);
    const end = Math.min(triCount, Math.floor((g.start + g.count) / 3));
    for (let t = start; t < end; t++) triMaterial[t] = g.materialIndex ?? 0;
  }
  return { geometry: out, material: materials[0] ?? null, materials, triMaterial, vertBone, vertBones };
}

// ---- 部件拆分 ----
interface PartTriangles {
  /** 三角形顶点索引（原 baked 几何的顶点序） */
  tris: number[][];
  /** 三角形主导 bone（全局 index） */
  triBone: number[];
  /** 三角形在原几何中的序号（索引序，与 tris/triBone 平行；按材质拆视图用） */
  triOrd: number[];
}

/**
 * 按部件分组三角形。返回 part → 三角形列表。
 * boneToPart: 全局 bone index → 部件名。
 */
export function groupTrianglesByPart(
  baked: BakedMesh,
  boneToPart: (PartName | null)[],
  absorbUnassigned = false,
): { groups: Map<PartName, PartTriangles>; droppedTris: number; absorbedTris: number; reweightedTris: number } {
  const geo = baked.geometry;
  const index = geo.getIndex();
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const triCount = index ? index.count / 3 : Math.floor(posAttr.count / 3);
  const result = new Map<PartName, PartTriangles>();
  for (const p of ALL_PARTS) result.set(p, { tris: [], triBone: [], triOrd: [] });

  // 无归属三角形：三顶点的主导 bone 都不属于任何部件（或无主导 bone）
  const orphans: { tri: [number, number, number]; bestBone: number; ord: number }[] = [];
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
    let bestBone = -1;
    let bestVotes = 0;
    for (const [bi, n] of votes) {
      if (n > bestVotes) { bestVotes = n; bestBone = bi; }
    }
    // 跨部件三角形不跳过：归入它涉及的每个部件——在交界破洞处由这块真实三角形本身遮挡，
    // 不再造封盖假面；像素归属在 2D 拆分时按 ID 掩码精确决定，不会双算
    if (parts.size === 0 || bestBone < 0) {
      orphans.push({ tri: [a, b, c], bestBone, ord: t });
      continue;
    }
    for (const p of parts) {
      const pt = result.get(p)!;
      pt.tris.push([a, b, c]);
      pt.triBone.push(bestBone);
      pt.triOrd.push(t);
    }
  }

  // 归入邻近部件（选项开启时）：按共享顶点投票——孤儿的顶点被哪些部件的已归属
  // 三角形共用得最多，就归哪个部件；完全孤立（无共享顶点）仍丢弃并计入 droppedTris。
  // 归入的同时把孤儿顶点的权重集暂时改到邻近骨骼（本烘焙内有效，不回写模型）：
  // 邻近骨骼 = 获胜部件中与孤儿共享顶点的那些三角形里出现最多的该部件骨骼。
  // 不加这一步，孤儿即使进了部件视图，其 ID 掩码里也没有该部件的骨骼，
  // 拆分时像素仍无归属——加完之后掩码以邻近骨骼为归属，像素真正落入该部件。
  let absorbedTris = 0;
  let reweightedTris = 0;
  if (absorbUnassigned && orphans.length > 0) {
    const vertParts = new Map<number, Map<PartName, number>>();
    for (const p of ALL_PARTS) {
      for (const tri of result.get(p)!.tris) {
        for (const vi of tri) {
          let m = vertParts.get(vi);
          if (!m) { m = new Map(); vertParts.set(vi, m); }
          m.set(p, (m.get(p) ?? 0) + 1);
        }
      }
    }
    const remaining: typeof orphans = [];
    for (const o of orphans) {
      const votes = new Map<PartName, number>();
      for (const vi of o.tri) {
        const m = vertParts.get(vi);
        if (!m) continue;
        for (const [p, n] of m) votes.set(p, (votes.get(p) ?? 0) + n);
      }
      let winner: PartName | null = null;
      let best = 0;
      for (const p of ALL_PARTS) {
        const n = votes.get(p) ?? 0;
        if (n > best) { best = n; winner = p; }
      }
      if (winner) {
        const pt = result.get(winner)!;
        pt.tris.push(o.tri);
        pt.triBone.push(o.bestBone);
        pt.triOrd.push(o.ord);
        absorbedTris++;
        // 邻近骨骼：获胜部件里与孤儿共享顶点的三角形，其顶点骨骼集（含主导骨）
        // 中属于获胜部件的骨骼出现最多者
        const sharedVerts = new Set(o.tri);
        const boneCounts = new Map<number, number>();
        for (const tri of pt.tris) {
          if (!tri.some((vi) => sharedVerts.has(vi))) continue;
          for (const vi of tri) {
            const cand = new Set<number>(baked.vertBones[vi] ?? []);
            if (baked.vertBone[vi] >= 0) cand.add(baked.vertBone[vi]);
            for (const gi of cand) {
              if (boneToPart[gi] === winner) boneCounts.set(gi, (boneCounts.get(gi) ?? 0) + 1);
            }
          }
        }
        let neighborBone = -1;
        let bestCount = 0;
        for (const [gi, n] of boneCounts) {
          if (n > bestCount) { bestCount = n; neighborBone = gi; }
        }
        if (neighborBone >= 0) {
          for (const vi of o.tri) {
            if (!baked.vertBones[vi].includes(neighborBone)) baked.vertBones[vi].push(neighborBone);
          }
          reweightedTris++;
        }
      } else {
        remaining.push(o);
      }
    }
    return { groups: result, droppedTris: remaining.length, absorbedTris, reweightedTris };
  }
  return { groups: result, droppedTris: orphans.length, absorbedTris, reweightedTris };
}


// ---- 部件几何构建 ----
interface BuiltPartView {
  /** 数据源（整模静态几何；本视图与其它部件共享其属性数据，零复制） */
  source: BakedMesh;
  /** 本部件在此源几何上的三角形索引序列（原顶点序，本部件的「剔除」结果即这份视图） */
  index: number[];
  /** 本视图的单个源材质（视图按材质组拆分，多材质网格不再整组共用一份） */
  material: THREE.Material | null;
}

interface BuiltPart {
  part: PartName;
  views: BuiltPartView[];
  /** 部件内 bone 列表（全局 index，按首次出现序） */
  partBones: number[];
  /** 分组口径（全模型，各部件调用同值）：丢弃的无归属三角形数（开启归入后为仍无法归入的孤立数） */
  droppedTris?: number;
  /** 分组口径（全模型）：按邻近投票归入部件的无归属三角形数 */
  absorbedTris?: number;
  /** 分组口径（全模型）：归入时权重集暂时改到邻近骨骼的三角形数 */
  reweightedTris?: number;
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
  absorbUnassigned = false,
): BuiltPart | null {
  const views: BuiltPartView[] = [];
  let droppedTris = 0;
  let absorbedTris = 0;
  let reweightedTris = 0;
  for (const bm of bakedMeshes) {
    const grouped = groupTrianglesByPart(bm, boneToPart, absorbUnassigned);
    droppedTris += grouped.droppedTris;
    absorbedTris += grouped.absorbedTris;
    reweightedTris += grouped.reweightedTris;
    const pt = grouped.groups.get(part)!;
    if (pt.tris.length === 0) continue;
    // 按材质组拆视图：同一部件里不同材质的三角形各自成视图、用各自的源材质
    // （PMX 等多材质网格的 mesh.material 是数组，共用一份会把数组当单个材质用）
    const byMat = new Map<number, number[]>();
    pt.tris.forEach(([a, b, c], i) => {
      const mi = bm.triMaterial[pt.triOrd[i]] ?? 0;
      let arr = byMat.get(mi);
      if (!arr) { arr = []; byMat.set(mi, arr); }
      arr.push(a, b, c);
    });
    for (const [mi, index] of byMat) {
      views.push({ source: bm, index, material: bm.materials[mi] ?? bm.materials[0] ?? null });
    }
  }
  if (views.length === 0) return null;

  // 部件内 bone 列表：从拓扑 boneToPart 直接取，不从顶点扫
  // （3D 拆分完已知六件归属，顶点扫描是冗余且易错的）
  const partBones: number[] = [];
  for (let bi = 0; bi < boneToPart.length; bi++) {
    if (boneToPart[bi] === part) partBones.push(bi);
  }
  return { part, views, partBones, droppedTris, absorbedTris, reweightedTris };
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
export function makeToonFromSource(
  source: THREE.Material | null,
  gradientMap: THREE.DataTexture,
  usePmxNpr?: boolean,
): THREE.Material {
  // 防御：调用方误传材质数组时取第一个——数组继承 Array.prototype.map，
  // 'map' in 检查会把那个函数当贴图传进材质，渲染时在 three 的
  // refreshTransformUniform 里读 undefined.matrix.elements 崩掉（真机实测）
  if (Array.isArray(source)) source = source[0] ?? null;
  // PMX 原味着色（开关开）：走参考版 NPR 着色，不做 toon 转换
  if (usePmxNpr) {
    const npr = makeNprFromSource(source);
    if (npr) return npr;
  }
  const src = source as THREE.MeshStandardMaterial | null;
  return new THREE.MeshToonMaterial({
    color: src && 'color' in src && src.color ? (src.color as THREE.Color).clone() : new THREE.Color(0xffffff),
    ...(src && 'map' in src && src.map ? { map: src.map as THREE.Texture } : {}),
    // 继承源材质的面性：源模型双面（doubleSided）时压成单面会把绕向不齐的三角形
    //（如颈圈）从正面剔掉——几何在、轮廓标记也盖得住，却没有任何表面能填
    ...(src && 'side' in src && src.side !== undefined ? { side: src.side } : {}),
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

// ---- 卡通渐变 ----
export function makeGradientMap(steps: number): THREE.DataTexture {
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
  pmxTextures?: Map<string, Blob>,
): Promise<{ bones: TopoParsedBone[]; topology: TopologyResult }> {
  if (typeof window === 'undefined') {
    throw new Error('parseModelTopology 仅支持浏览器环境');
  }
  const model = await loadModelScene(input, pmxTextures);
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

// ---- 部件堆叠切片（第二产线）：部件几何在角色空间切片 ----
// 角色空间换算与 skeleton-mapper 的 joint3D→offset3D 同口径：
// 归一化坐标 (p − center)·scale 再 (x, −y, z)·(size/2) 到全局像素。
interface StackTexEntry { data: Uint8ClampedArray | null; w: number; h: number; r: number; g: number; b: number; a: number }

function buildPartStacks(
  bakedMeshes: BakedMesh[],
  parts: Map<PartName, BuiltPart>,
  parentIndex: readonly (number | null)[],
  bindPos: THREE.Vector3[],
  center: THREE.Vector3,
  normScale: number,
  size: number,
  boneNames: string[],
  effectiveIndex: readonly number[] | null,
  layerThicknessPx: number,
  onlyParts?: readonly SixPartName[],
): Map<PartName, PartStackSlice> {
  const K = size / 2; // 归一化单位 → 全局像素（globalCameraHalf = 1）
  const charOf = (x: number, y: number, z: number) => ({
    x: (x - center.x) * normScale * K,
    y: -(y - center.y) * normScale * K,
    z: (z - center.z) * normScale * K,
  });
  // 每源网格：换算后顶点位置（缓存） + 材质采样表（全局注册）
  const registry: StackTexEntry[] = [];
  const meshCtx = bakedMeshes.map((bm) => {
    const posAttr = bm.geometry.getAttribute('position') as THREE.BufferAttribute;
    const conv = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      const c = charOf(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      conv[i * 3] = c.x; conv[i * 3 + 1] = c.y; conv[i * 3 + 2] = c.z;
    }
    const matBase = registry.length;
    for (const mat of bm.materials) {
      const mm = mat as THREE.MeshBasicMaterial | null;
      let entry: StackTexEntry = { data: null, w: 0, h: 0, r: 1, g: 1, b: 1, a: 1 };
      if (mm) {
        if (mm.color) { entry.r = mm.color.r; entry.g = mm.color.g; entry.b = mm.color.b; }
        entry.a = mm.opacity ?? 1;
        const img = (mm.map as THREE.Texture | undefined)?.image as CanvasImageSource | undefined;
        if (img) {
          try {
            const w = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width || 0;
            const h = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height || 0;
            if (w > 0 && h > 0) {
              const cv = document.createElement('canvas');
              cv.width = w; cv.height = h;
              const g2 = cv.getContext('2d')!;
              g2.drawImage(img, 0, 0);
              entry = { ...entry, data: g2.getImageData(0, 0, w, h).data, w, h };
            }
          } catch { /* 贴图不可读时以材质色采样 */ }
        }
      }
      registry.push(entry);
    }
    return { bm, conv, matBase };
  });
  const sample = (mat: number, u: number, v: number): [number, number, number, number] => {
    const e = registry[mat] ?? registry[0]!;
    if (!e.data) return [e.r * 255, e.g * 255, e.b * 255, e.a * 255];
    const tx = Math.max(0, Math.min(e.w - 1, Math.floor(u * e.w)));
    const ty = Math.max(0, Math.min(e.h - 1, Math.floor(v * e.h)));
    const o = (ty * e.w + tx) * 4;
    return [e.data[o]! * e.r, e.data[o + 1]! * e.g, e.data[o + 2]! * e.b, e.data[o + 3]! * e.a];
  };

  const out = new Map<PartName, PartStackSlice>();
  for (const [pname, built] of parts) {
    if (onlyParts && !(onlyParts as readonly string[]).includes(pname)) continue;
    // 聚合部件几何（展开为逐三角顶点流）
    const posArr: number[] = [];
    const uvArr: number[] = [];
    const triMat: number[] = [];
    for (const view of built.views) {
      const mc = meshCtx.find((m) => m.bm === view.source)!;
      const uvAttr = view.source.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
      const mi = view.material ? view.source.materials.indexOf(view.material) : 0;
      const matId = mc.matBase + Math.max(0, mi);
      for (let t = 0; t + 2 < view.index.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = view.index[t + k]!;
          posArr.push(mc.conv[vi * 3]!, mc.conv[vi * 3 + 1]!, mc.conv[vi * 3 + 2]!);
          uvArr.push(uvAttr ? uvAttr.getX(vi) : 0, uvAttr ? uvAttr.getY(vi) : 0);
        }
        triMat.push(matId);
      }
    }
    const triCount = triMat.length;
    if (triCount === 0) continue;
    const tris = new Uint32Array(triCount * 3);
    for (let i = 0; i < tris.length; i++) tris[i] = i;
    // 部件帧：根 = 父不在部件内的骨骼；尖 = 根的部件内后代中离根最远的关节
    const partSet = new Set(built.partBones);
    let root = built.partBones.find((b) => !partSet.has(parentIndex[b] ?? -1)) ?? built.partBones[0]!;
    const childrenInPart = new Map<number, number[]>();
    for (const b of built.partBones) {
      const par = parentIndex[b] ?? -1;
      if (partSet.has(par)) {
        let arr = childrenInPart.get(par);
        if (!arr) { arr = []; childrenInPart.set(par, arr); }
        arr.push(b);
      }
    }
    const rootPos = charOf(bindPos[root]!.x, bindPos[root]!.y, bindPos[root]!.z);
    let tipPos = rootPos;
    {
      let best = -1;
      const stackWalk = [root];
      const seen = new Set([root]);
      while (stackWalk.length > 0) {
        const cur = stackWalk.pop()!;
        const cp = charOf(bindPos[cur]!.x, bindPos[cur]!.y, bindPos[cur]!.z);
        const d2 = (cp.x - rootPos.x) ** 2 + (cp.y - rootPos.y) ** 2 + (cp.z - rootPos.z) ** 2;
        if (d2 > best) { best = d2; tipPos = cp; }
        for (const ch of childrenInPart.get(cur) ?? []) {
          if (!seen.has(ch)) { seen.add(ch); stackWalk.push(ch); }
        }
      }
    }
    let axis = { x: tipPos.x - rootPos.x, y: tipPos.y - rootPos.y, z: tipPos.z - rootPos.z };
    if (pname === 'head' || Math.hypot(axis.x, axis.y, axis.z) < 1e-4) {
      axis = { x: 0, y: -1, z: 0 }; // 头：竖直轴（角色空间 y 向下，向上为 −y）
    }
    const axisLen = Math.hypot(axis.x, axis.y, axis.z) || 1;
    const uAxis = Math.abs(axis.x / axisLen) > 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    const sliced = sliceStack({
      positions: Float32Array.from(posArr),
      uvs: Float32Array.from(uvArr),
      tris,
      triMaterial: Int32Array.from(triMat),
      sample,
      pivot: rootPos,
      axis,
      uAxis,
      layerThickness: layerThicknessPx,
    });
    if (sliced.layers.length === 0 || sliced.filledPixels === 0) continue;
    out.set(pname, {
      rootBoneIndex: effectiveIndex ? (effectiveIndex[root] ?? root) : root,
      rootBoneName: boneNames[root] ?? `bone_${root}`,
      sliced,
    });
  }
  return out;
}

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

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, stencil: true });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.toneMapping = THREE.NoToneMapping;

  try {
    const model = await loadModelScene(input, options.pmxTextures);
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
      bakedMeshes.push(bakeSkinnedMesh(m, bones, indexByBone, options.weightThreshold ?? 0.2));
    });
    if (bakedMeshes.length === 0) throw new Error('模型中没有找到 Mesh');

    // 法线：bakeSkinnedMesh 已按原始法线蒙皮混合产出；只有源几何无法线时才几何重算兜底
    for (const bm of bakedMeshes) {
      if (!bm.geometry.getAttribute('normal')) bm.geometry.computeVertexNormals();
    }

    // ---- 构建 6 部件（索引视图，不复制几何） ----
    // 无归属三角形计数是分组口径（全模型，六次调用同值），取第一次构建的即可
    const triStats = { dropped: 0, absorbed: 0, reweighted: 0 };
    let triStatsTaken = false;
    const parts = new Map<PartName, BuiltPart>();
    for (const p of ALL_PARTS) {
      const built = buildPartGeometry(bakedMeshes, p, boneToPart, options.absorbUnassigned ?? false);
      if (built) {
        parts.set(p, built);
        if (!triStatsTaken) {
          triStats.dropped = built.droppedTris ?? 0;
          triStats.absorbed = built.absorbedTris ?? 0;
          triStats.reweighted = built.reweightedTris ?? 0;
          triStatsTaken = true;
        }
      }
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

    // ---- 部件堆叠切片（第二产线，可选） ----
    const partStacks = options.withStacks
      ? buildPartStacks(
          bakedMeshes, parts, parentIndex, bindPos, center, scale, size,
          bones.map((b) => b.name || ''), merge ? merge.effectiveIndex : null,
          options.stackLayerThicknessPx ?? size / 128,
          options.stackParts,
        )
      : undefined;

    // ---- 渲染 ----
    const gradientMap = makeGradientMap(toonSteps);
    const rt = new THREE.WebGLRenderTarget(size, size, { samples: 0, depthBuffer: true, stencilBuffer: true });
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
    const partLayersAcc: Partial<Record<PartName, { key: string; label: string; rank: number }[]>> = {};

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
    // 全角度：基纬度 0 + 额外纬度（±90 只渲循环 0）
    const latitudes = [0, ...(options.extraLatitudes ?? [])];
    const frames: Array<{ lat: number; d: number }> = latitudes.flatMap((lat) =>
      dirsForLatitude(lat).map((d) => ({ lat, d })),
    );
    let total = 0;
    for (const pname of parts.keys()) {
      total += frames.length * (partNeedsId.get(pname) ? 2 : 1);
    }
    let done = 0;

    // —— 破洞填充（最终方案）：
    // 1) 只用所渲染部件的外轮廓剔除其他部件：本部件双面渲进 stencil 得到填充轮廓（二维区域）；
    // 2) 候选 =「通过骨骼与本部件接通」的部件整体（不按骨骼挑三角形——挑骨骼会漏掉锁骨
    //    这类不主导任何三角形的接通骨骼）；归属按接通方向判定：每条接通关系有一条方向线
    //    （过接通关节、沿接通骨骼方向），候选片元的视线与哪条方向线最贴近——即那条方向线
    //    正经过这个断口——该片元就归哪个接通，不是本关系的片元丢弃。髋口的视线贴合大腿
    //    的方向线（线从髋口出去），手的片元视线贴合的是肩的方向线，归肩不归髋；
    // 3) 本部件正面最后画、只清深度，强制遮挡未剔除部分；单面渲染；
    // 4) 遮挡部件进 ID 遍，ID 改成本部件的：写该接通关系在本部件一侧的骨骼（同一部件对
    //    多条接通边时取第一条）。
    // 候选按接通部件构建、每部件只提交一遍，成本与洞数无关。
    /** 候选的方向判定门控（颜色/ID 共用同一组 uniform）：每条接通关系一条方向线
     * （过接通关节、沿接通骨骼方向的射线）；片元视线与哪条方向射线最贴近就归哪个接通，
     * 不是本关系的丢弃。uJoints/uDirs/uCount 按部件共享、每方向旋转更新 */
    interface DirShared {
      uJoints: { value: THREE.Vector3[] };
      uDirs: { value: THREE.Vector3[] };
      uCount: { value: number };
      uContour: { value: THREE.DataTexture };
      uRtSize: { value: number };
      /** ID 掩码渲染半区（0=低半 bone 0..31，1=高半 32..63），与部件 ID 材质共享同一对象 */
      uPass: { value: number };
    }
    const DIR_GATE_GLSL = `
      if (texture2D(uContour, gl_FragCoord.xy / uRtSize).r < 0.5) discard;
      vec3 rd = normalize(vPos - cameraPosition);
      float best = 1e9;
      int bestI = -1;
      for (int i = 0; i < 8; i++) {
        if (i >= uCount) break;
        vec3 w0 = cameraPosition - uJoints[i];
        float b = dot(rd, uDirs[i]);
        float d = dot(rd, w0);
        float e = dot(uDirs[i], w0);
        float denom = 1.0 - b * b;
        float dist;
        if (denom < 1e-8) {
          dist = length(w0 - rd * d);
        } else {
          float tLine = (e - b * d) / denom;
          if (tLine < 0.0) {
            // 方向有向：最近点落在关节之后时，距离取视线到关节点的距离
            float tRay = max(-d, 0.0);
            dist = length((cameraPosition + rd * tRay) - uJoints[i]);
          } else {
            float tRay = (b * e - d) / denom;
            dist = length((cameraPosition + rd * tRay) - (uJoints[i] + uDirs[i] * tLine));
          }
        }
        if (dist < best) { best = dist; bestI = i; }
      }
      if (bestI != uOwn) discard;
    `;
    const DIR_GATE_UNIFORMS_GLSL = `
      uniform vec3 uJoints[8];
      uniform vec3 uDirs[8];
      uniform int uCount;
      uniform int uOwn;
      uniform sampler2D uContour;
      uniform float uRtSize;
      varying vec3 vPos;
    `;
    const gateByDirection = (mat: THREE.Material, shared: DirShared, own: number): void => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uJoints = shared.uJoints;
        shader.uniforms.uDirs = shared.uDirs;
        shader.uniforms.uCount = shared.uCount;
        shader.uniforms.uContour = shared.uContour;
        shader.uniforms.uRtSize = shared.uRtSize;
        shader.uniforms.uOwn = { value: own };
        shader.vertexShader = ('varying vec3 vPos;\n' + shader.vertexShader).replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\n  vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
        shader.fragmentShader = (DIR_GATE_UNIFORMS_GLSL + shader.fragmentShader).replace(
          '#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\n' + DIR_GATE_GLSL,
        );
      };
      mat.customProgramCacheKey = () => 'dir-gate';
    };
    /** 遮挡者在 ID 遍的材质：整块输出本部件骨骼的 ID 色（与 ID 帧同一 RGB 掩码格式） */
    const makeCandIdMaterial = (
      lo: [number, number, number, number],
      hi: [number, number, number, number],
      shared: DirShared,
      own: number,
    ): THREE.ShaderMaterial => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColorLo: { value: new THREE.Vector4(lo[0] / 255, lo[1] / 255, lo[2] / 255, lo[3] / 255) },
          uColorHi: { value: new THREE.Vector4(hi[0] / 255, hi[1] / 255, hi[2] / 255, hi[3] / 255) },
          uPass: shared.uPass,
          uJoints: shared.uJoints,
          uDirs: shared.uDirs,
          uCount: shared.uCount,
          uContour: shared.uContour,
          uRtSize: shared.uRtSize,
          uOwn: { value: own },
        },
        vertexShader: `
          varying vec3 vPos;
          void main() {
            vPos = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec4 uColorLo;
          uniform vec4 uColorHi;
          uniform float uPass;
          uniform vec3 uJoints[8];
          uniform vec3 uDirs[8];
          uniform int uCount;
          uniform int uOwn;
          uniform sampler2D uContour;
          uniform float uRtSize;
          varying vec3 vPos;
          void main() {
            ${DIR_GATE_GLSL}
            gl_FragColor = uPass < 0.5 ? uColorLo : uColorHi;
          }
        `,
        side: THREE.DoubleSide,
      });
      return mat;
    };

    // 部件内局部 ID → 全局 bone：用 partBones 顺序
    for (const [pname, bp] of parts) {
      // 局部编号把合并后的有效骨骼排在最前：ID 掩码只有 64 位，原始骨骼
      // 超过 64 的部件（如塞尔凯特尾巴 174 骨）靠后段骨骼编不进掩码；
      // 有效骨骼（精灵的实际归属单位）占住低位后，原始集全 ≥64 的三角形
      // 兜底改按有效骨骼编码才落得进去（兜底逻辑在建 ID 纹理处）
      const effSet = new Set(merge.effectiveBones);
      bp.partBones.sort((a, b) => {
        const ea = effSet.has(a) ? 0 : 1;
        const eb = effSet.has(b) ? 0 : 1;
        return ea - eb;
      });
      partBoneMap[pname] = [...bp.partBones];

      // 归一化变换：整模 center/scale
      const partGroup = new THREE.Group();
      // 颜色遍：部件的每个索引视图用其源材质派生 toon 材质（各自的 map/color），不再全部件共用一份
      const inner = new THREE.Group();
      for (const view of bp.views) {
        const toonMat = makeToonFromSource(view.material, gradientMap, options.usePmxNpr);
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
      // ID 掩码渲染半区（0=低半/1=高半）：本部件全部 ID 材质共享同一 uniform 对象
      const idPassUniform = { value: 0 };
      const idInner = new THREE.Group();
      // 旋转必须挂在父组上（与颜色遍 partGroup>inner 同构：R·(T+S·p)）。
      // 若 idInner 单对象同时带 position/rotation/scale，three 组合为
      // T·R·S，与颜色遍差 (R-I)·T——旋转方向上 ID 帧整体平移、与颜色帧
      // 错位（90° 时达十余像素，拆分按颜色 alpha 跳过把整片像素刷掉）。
      const idPartGroup = new THREE.Group();
      idPartGroup.add(idInner);
      for (const view of bp.views) {
        const srcPos = view.source.geometry.getAttribute('position') as THREE.BufferAttribute;
        const triCount = Math.floor(view.index.length / 3);
        if (triCount === 0) continue;
        const idPositions = new Float32Array(triCount * 9);
        const idTriIds = new Float32Array(triCount * 3);
        // 每三角形 2 个 texel：低半（字节 0..3）+ 高半（字节 4..7）
        const idTexData = new Uint8Array(triCount * 2 * 4);
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
          const maskBytes = new Uint8Array(8);
          const seenLi = new Set<number>();
          for (const gi of filtered) {
            const li = localIndex.get(gi);
            if (li === undefined || seenLi.has(li)) continue;
            seenLi.add(li);
            boneMaskSet(maskBytes, li); // 64 位：局部编号 0..63 全部可编码
          }
          if (maskBytes.every((v) => v === 0) && filtered.size > 0) {
            // 掩码为空兜底：过滤集全是局部编号 ≥64 的骨骼（64 位仍装不下
            // 的极端部件）——这类三角形像素解码为空、从所有精灵消失。
            // 改按合并后的有效骨骼编码：像素仍归属到正确精灵（手/大臂），
            // 代价只是这些像素的 contrib 贡献锚粒度降到有效骨骼。
            const seenEff = new Set<number>();
            for (const gi of filtered) {
              const eff = merge.effectiveIndex[gi] ?? gi;
              if (seenEff.has(eff)) continue;
              seenEff.add(eff);
              const li = localIndex.get(eff);
              if (li === undefined) continue;
              boneMaskSet(maskBytes, li);
            }
          }
          idTexData.set(maskBytes.subarray(0, 4), t * 8);
          idTexData.set(maskBytes.subarray(4, 8), t * 8 + 4);
        }
        const idGeo = new THREE.BufferGeometry();
        idGeo.setAttribute('position', new THREE.BufferAttribute(idPositions, 3));
        idGeo.setAttribute('aTriId', new THREE.BufferAttribute(idTriIds, 1));
        // 一维排布宽度 = texel 数（每三角形 2 个），高面数部件会超 GPU 最大纹理尺寸（常见 8192/16384）→ 折成近方形二维
        const texelCount = triCount * 2;
        const idTexW = Math.max(1, Math.ceil(Math.sqrt(texelCount)));
        const idTexH = Math.max(1, Math.ceil(texelCount / idTexW));
        const idTexFull = new Uint8Array(idTexW * idTexH * 4);
        idTexFull.set(idTexData);
        const idTex = new THREE.DataTexture(idTexFull, idTexW, idTexH, THREE.RGBAFormat, THREE.UnsignedByteType);
        idTex.minFilter = THREE.NearestFilter;
        idTex.magFilter = THREE.NearestFilter;
        idTex.needsUpdate = true;
        const idMat = new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          uniforms: { uIdTex: { value: idTex }, uPass: idPassUniform },
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
            uniform float uPass;
            out vec4 outColor;
            void main() {
              int idx = vTriId * 2 + int(uPass + 0.5);
              outColor = texelFetch(uIdTex, ivec2(idx % textureSize(uIdTex, 0).x, idx / textureSize(uIdTex, 0).x), 0);
            }
          `,
          side: THREE.DoubleSide,
        });
        const idMesh = new THREE.Mesh(idGeo, idMat);
        idMesh.frustumCulled = false;
        idInner.add(idMesh);
      }
      idInner.position.copy(inner.position);
      idInner.scale.setScalar(scale);

      // 图层 ID 组（图层模式）：与 ID 组同构（组 > 内层同变换），每视图一张
      // 位置汤网格、aLayer = 视图号+1，片元直出层号到 R 通道
      const layerPartGroup = new THREE.Group();
      const layerInner = new THREE.Group();
      layerPartGroup.add(layerInner);
      const layerViewLabels: string[] = [];
      let layerMat: THREE.ShaderMaterial | null = null;
      let layerRanks: number[] | null = null;
      if (options.layerPass) {
        layerMat = new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          vertexShader: `
            in float aLayer;
            flat out float vLayer;
            void main() {
              vLayer = aLayer;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            precision highp float;
            flat in float vLayer;
            out vec4 outColor;
            void main() { outColor = vec4(vLayer / 255.0, 0.0, 0.0, 1.0); }
          `,
          side: THREE.DoubleSide,
        });
        bp.views.forEach((view, vi) => {
          const mi = view.source.materials.indexOf(view.material ?? null);
          layerViewLabels.push(view.material?.name || `材质${mi >= 0 ? mi + 1 : vi + 1}`);
          const srcPos = view.source.geometry.getAttribute('position') as THREE.BufferAttribute;
          const triCount = Math.floor(view.index.length / 3);
          const pos = new Float32Array(triCount * 9);
          const lay = new Float32Array(triCount * 3);
          for (let t = 0; t < triCount; t++) {
            for (let k = 0; k < 3; k++) {
              const v = view.index[t * 3 + k];
              pos[(t * 3 + k) * 3] = srcPos.getX(v);
              pos[(t * 3 + k) * 3 + 1] = srcPos.getY(v);
              pos[(t * 3 + k) * 3 + 2] = srcPos.getZ(v);
              lay[t * 3 + k] = vi + 1;
            }
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          g.setAttribute('aLayer', new THREE.BufferAttribute(lay, 1));
          const mesh = new THREE.Mesh(g, layerMat!);
          mesh.frustumCulled = false;
          layerInner.add(mesh);
        });
        layerInner.position.copy(inner.position);
        layerInner.scale.setScalar(scale);
      }

      // 外轮廓标记组：本部件双面渲进 stencil（不出颜色/深度）——候选的二维剔除区域
      const markMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      });
      const markGroup = new THREE.Group();
      {
        const mi = new THREE.Group();
        for (const view of bp.views) {
          const mesh = new THREE.Mesh(makeViewGeometry(view), markMat);
          mesh.renderOrder = -10;
          mesh.frustumCulled = false;
          mi.add(mesh);
        }
        mi.position.copy(inner.position);
        mi.scale.setScalar(scale);
        markGroup.add(mi);
      }
      // 候选组：每条跨部件骨骼边（一个接通关节）一组（颜色组 + ID 组），变换与 partGroup 一致
      interface CandSet { color: THREE.Group; id: THREE.Group; mats: THREE.Material[] }
      const conns: { q: PartName; bP: number; bQ: number; jointGi: number; dirBase: THREE.Vector3 }[] = [];
      for (let bi = 0; bi < boneToPart.length; bi++) {
        const pi = parentIndex[bi];
        if (pi == null) continue;
        const pParent = boneToPart[pi];
        const pChild = boneToPart[bi];
        if (!pParent || !pChild || pParent === pChild) continue;
        const bP = pParent === pname ? pi : bi;
        const bQ = pParent === pname ? bi : pi;
        const q = pParent === pname ? pChild : pParent;
        // 方向线：过接通关节（子骨骼原点 bi），沿接通骨骼朝对方部件内的方向——
        // bQ 是子骨骼时取它到其子关节；bQ 是父骨骼时取关节到 bQ 原点
        const childOfBQ = parentIndex.findIndex((p) => p === bQ);
        const farGi = bQ === bi ? (childOfBQ >= 0 ? childOfBQ : bP) : bQ;
        const dirBase = normJoints[farGi].clone().sub(normJoints[bi]).normalize();
        conns.push({ q, bP, bQ, jointGi: bi, dirBase });
      }
      // 填充轮廓资源：掩码读回 → CPU 洪泛（边缘可达的空像素=外，余者=轮廓内，
      // 对穿的断口如侧面肩口由此纳入轮廓）→ 轮廓纹理，候选门控采样它
      const maskPx = new Uint8Array(size * size * 4);
      const contourData = new Uint8Array(size * size);
      const contourOutside = new Uint8Array(size * size);
      const contourTex = new THREE.DataTexture(contourData, size, size, THREE.RedFormat);
      contourTex.minFilter = THREE.NearestFilter;
      contourTex.magFilter = THREE.NearestFilter;
      const buildContour = () => {
        contourOutside.fill(0);
        const stack: number[] = [];
        for (let x = 0; x < size; x++) { stack.push(x); stack.push((size - 1) * size + x); }
        for (let y = 0; y < size; y++) { stack.push(y * size); stack.push(y * size + size - 1); }
        while (stack.length) {
          const k = stack.pop()!;
          if (contourOutside[k] || maskPx[k * 4] > 0) continue;
          contourOutside[k] = 1;
          const x = k % size, y = (k / size) | 0;
          if (x > 0) stack.push(k - 1);
          if (x < size - 1) stack.push(k + 1);
          if (y > 0) stack.push(k - size);
          if (y < size - 1) stack.push(k + size);
        }
        for (let k = 0; k < size * size; k++) contourData[k] = contourOutside[k] ? 0 : 255;
        contourTex.needsUpdate = true;
      };
      // 方向判定共享 uniform（关节位置/方向线每方向旋转更新）
      const dirShared: DirShared = {
        uJoints: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
        uDirs: { value: Array.from({ length: 8 }, () => new THREE.Vector3(0, -1, 0)) },
        uCount: { value: Math.min(conns.length, 8) },
        uContour: { value: contourTex },
        uRtSize: { value: size },
        uPass: idPassUniform,
      };
      const candSets: CandSet[] = [];
      for (let ci = 0; ci < conns.length; ci++) {
        const { q, bP } = conns[ci];
        const qb = parts.get(q);
        if (!qb) continue;
        const views = qb.views;
        if (views.length === 0) continue;
        const li = localIndex.get(bP);
        if (li === undefined) continue;
        const mats: THREE.Material[] = [];
        const candIdMat = makeCandIdMaterial(encodeBoneQuad(li, 0), encodeBoneQuad(li, 1), dirShared, ci);
        mats.push(candIdMat);
        const colorInner = new THREE.Group();
        const idInnerG = new THREE.Group();
        for (const view of views) {
          const geo = makeViewGeometry(view);
          const tmat = makeToonFromSource(view.material, gradientMap, options.usePmxNpr);
          gateByDirection(tmat, dirShared, ci);
          mats.push(tmat);
          const cm = new THREE.Mesh(geo, tmat);
          cm.frustumCulled = false;
          colorInner.add(cm);
          const im = new THREE.Mesh(geo, candIdMat);
          im.frustumCulled = false;
          idInnerG.add(im);
        }
        const colorG = new THREE.Group();
        colorInner.position.copy(inner.position);
        colorInner.scale.setScalar(scale);
        colorG.add(colorInner);
        const idG = new THREE.Group();
        idInnerG.position.copy(inner.position);
        idInnerG.scale.setScalar(scale);
        idG.add(idInnerG);
        candSets.push({ color: colorG, id: idG, mats });
      }

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

      for (const { lat, d } of frames) {
        const ang = (d / 8) * Math.PI * 2;
        const pitch = latitudePitchRad(lat);
        // 俯仰+偏航（order YXZ：先俯仰后偏航，纬度相对观察者恒定）；四组同构设置
        for (const g of [partGroup, markGroup, idPartGroup]) {
          g.rotation.order = 'YXZ';
          g.rotation.y = ang;
          g.rotation.x = pitch;
        }
        partGroup.updateMatrixWorld(true);
        idPartGroup.updateMatrixWorld(true);
        for (const cs of candSets) {
          for (const g of [cs.color, cs.id]) {
            g.rotation.order = 'YXZ';
            g.rotation.y = ang;
            g.rotation.x = pitch;
          }
        }

        // 关节像素（用部件相机），按规范方向索引；bone 级只记基纬度，组上带本帧的
        const groupJoints: Record<number, { x: number; y: number }> = {};
        for (const gi of bp.partBones) {
          projV.copy(normJoints[gi]).applyMatrix4(partGroup.matrixWorld).project(camera);
          const jp = {
            x: ((projV.x + 1) / 2) * size,
            y: ((1 - projV.y) / 2) * size,
          };
          groupJoints[gi] = jp;
          if (lat === 0) boneInfos[gi].jointPixels[((d + 6) % 8)] = jp;
        }

        // 候选方向线（本方向）：关节位置与骨骼方向随 partGroup 同步旋转（纯旋转，点/向同变换）
        {
          const rotM = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, ang, 0, 'YXZ'));
          for (let i = 0; i < conns.length && i < 8; i++) {
            dirShared.uJoints.value[i].copy(normJoints[conns[i].jointGi]).applyMatrix4(rotM);
            dirShared.uDirs.value[i].copy(conns[i].dirBase).applyMatrix4(rotM);
          }
        }

        // 外轮廓掩码：本部件双面投影渲成白掩码读回，洪泛填充成轮廓纹理
        scene.remove(idPartGroup);
        scene.remove(partGroup);
        scene.add(markGroup);
        renderer.setRenderTarget(rt);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
        scene.remove(markGroup);
        renderer.readRenderTargetPixels(rt, 0, 0, size, size, maskPx);
        buildContour();
        // 颜色一遍，第一段：候选（填充轮廓内 + 方向线归属）
        for (const cs of candSets) scene.add(cs.color);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
        for (const cs of candSets) scene.remove(cs.color);
        // 第二段：只清深度，本部件正面在全新深度上画——对候选是无条件覆写（强制遮挡），
        // 本部件内部仍按深度自洽
        scene.add(partGroup);
        renderer.clear(false, true, false);
        renderer.autoClear = false;
        renderer.render(scene, camera);
        renderer.autoClear = true;
        const colorPixels = readFlipped();
        // [临时诊断] 躯干原始帧 ASCII（定位真机与 CPU 模拟的分岔点，定位后删）
        if (pname === 'torso') {
          const AW = 64, AH = 40;
          let opaque = 0;
          for (let i = 3; i < colorPixels.length; i += 4) if (colorPixels[i] > 8) opaque++;
          const rows: string[] = [];
          for (let ay = 0; ay < AH; ay++) {
            let row = '';
            const sy = Math.floor((ay / AH) * size);
            for (let ax = 0; ax < AW; ax++) {
              const sx = Math.floor((ax / AW) * size);
              row += colorPixels[(sy * size + sx) * 4 + 3] > 8 ? '#' : '.';
            }
            rows.push(row);
          }
          console.log(`[bake-debug] torso dir=${((d + 6) % 8)} opaque=${opaque}/${size * size}\n${rows.join('\n')}`);
        }
        onProgress?.(++done, total, `${SIX_PART_LABEL[pname]} ${lat !== 0 ? `纬度 ${lat}° ` : ''}${d * 45}° 颜色`);
        await new Promise((r) => setTimeout(r, 0));

        // ID 渲染：单节点部件跳过。64 位掩码分两半（低半 bone 0..31 /
        // 高半 32..63，uPass 切换），每半结构同颜色遍：候选先写「本部件
        // 骨骼」的 ID（共用本方向颜色遍已建好的填充轮廓纹理），再清深度
        // 由本部件自己的 ID 覆写其表面
        let idPixels: Uint8ClampedArray | undefined;
        let idPixelsHi: Uint8ClampedArray | undefined;
        if (partNeedsId.get(pname)) {
          for (const half of [0, 1] as const) {
            idPassUniform.value = half;
            scene.remove(partGroup);
            for (const cs of candSets) scene.add(cs.id);
            renderer.clear(true, true, true);
            renderer.render(scene, camera);
            for (const cs of candSets) scene.remove(cs.id);
            scene.add(idPartGroup);
            idPartGroup.updateMatrixWorld(true);
            renderer.clear(false, true, false);
            renderer.autoClear = false;
            renderer.render(scene, camera);
            renderer.autoClear = true;
            scene.remove(idPartGroup);
            if (half === 0) idPixels = readFlipped();
            else idPixelsHi = readFlipped();
          }
          onProgress?.(++done, total, `${SIX_PART_LABEL[pname]} ${lat !== 0 ? `纬度 ${lat}° ` : ''}${d * 45}° ID`);
          await new Promise((r) => setTimeout(r, 0));
        }

        // 图层 ID 渲染（图层模式）：单独渲图层组读回；正面帧顺带按相机
        // 深度中位数给本部件各视图定画序 rank（远→近）
        let layerPixels: Uint8ClampedArray | undefined;
        if (options.layerPass) {
          const hadPart = scene.children.includes(partGroup);
          if (hadPart) scene.remove(partGroup);
          layerPartGroup.rotation.order = 'YXZ';
          layerPartGroup.rotation.y = ang;
          layerPartGroup.rotation.x = pitch;
          scene.add(layerPartGroup);
          layerPartGroup.updateMatrixWorld(true);
          renderer.clear(true, true, true);
          renderer.render(scene, camera);
          scene.remove(layerPartGroup);
          if (hadPart) scene.add(partGroup);
          layerPixels = readFlipped();
          if (lat === 0 && d === 0 && !layerRanks) {
            const medians = layerInner.children.map((m) => {
              const pa = (m as THREE.Mesh).geometry.getAttribute('position');
              if (!pa || pa.count === 0) return Number.POSITIVE_INFINITY;
              const step = Math.max(1, Math.floor(pa.count / 200));
              const v = new THREE.Vector3();
              const zs: number[] = [];
              for (let i = 0; i < pa.count; i += step) {
                v.fromBufferAttribute(pa, i)
                  .applyMatrix4((m as THREE.Mesh).matrixWorld)
                  .applyMatrix4(camera.matrixWorldInverse);
                zs.push(v.z);
              }
              zs.sort((a, b) => a - b);
              return zs[Math.floor(zs.length / 2)];
            });
            // 视图空间 z 越小（越负）越远 → rank 0 先画
            const order = medians.map((_, i) => i).sort((a, b) => medians[a] - medians[b]);
            layerRanks = new Array<number>(medians.length).fill(0);
            order.forEach((vi, rank) => { layerRanks![vi] = rank; });
          }
          await new Promise((r) => setTimeout(r, 0));
        }

        groups.push({ part: pname, direction: ((d + 6) % 8), latitude: lat, jointPixels: groupJoints, colorPixels, idPixels, idPixelsHi, layerPixels, cameraHalf: half });
        renderer.setRenderTarget(null);
      }

      if (options.layerPass) {
        partLayersAcc[pname] = layerViewLabels.map((label, vi) => ({
          key: `${pname}|${vi}`,
          label,
          rank: layerRanks?.[vi] ?? vi,
        }));
      }

      // 清理本部件的颜色/ID 资源（视图几何与源几何共享属性数据，不在此释放）
      partGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.Material).dispose();
      });
      if (layerMat) {
        layerInner.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.geometry.dispose();
        });
        layerMat.dispose();
      }
      idInner.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.ShaderMaterial;
        (mat.uniforms.uIdTex.value as THREE.Texture).dispose();
        mat.dispose();
        m.geometry.dispose();
      });
      markMat.dispose();
      for (const cs of candSets) for (const m of cs.mats) m.dispose();
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
      partLayers: options.layerPass ? partLayersAcc : undefined,
      partStacks,
      merge,
      // 整模归一化到 [-1,1]，globalCameraHalf = 1.0（归一化单位）
      globalCameraHalf: 1.0,
      droppedTriCount: triStats.dropped,
      absorbedTriCount: triStats.absorbed,
      absorbedReweightedCount: triStats.reweighted,
    };
  } finally {
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch { /* noop */ }
  }
}
