// ============================================================
// PixelMorpher - 手动拆分烘焙（非人形 / 无骨骼绑定模型）
// 按网格拆分：每个被勾选的网格 = 一个部件（= 一个木偶节点）。
// - 枢轴 = 网格原点（场景图中的世界位置，模型作者的天然枢轴）
// - 父子层级 = 场景图中最近的被选网格祖先；无被选祖先的部件挂合成根节点
// - 有骨骼的模型也可走此模式：按绑定姿势静态烘焙（不做拓扑合并）
// 渲染与六部件颜色遍同制式：整模归一化（bbox 中心 + 包围球半径）、
// 部件独立取景、8 方向、精灵按 cameraHalf 归一化到全局像素空间。
// 产出与骨骼流同构的 Map<number, ProcessedBone>，直接走 mapBonesToNodes 导入。
// ============================================================

import * as THREE from 'three';
import { loadModelScene } from './load-model';
import { makeToonFromSource, makeGradientMap } from './threejs-baker-sixpart';
import { dirsForLatitude, latitudePitchRad, medianCut, nearestPaletteIndex } from './threejs-baker';
import { rgbaToHexOrNull } from '../engine/utils';
import type { PixelGrid, DirectionIndex } from '../unified-types';
import type { ProcessedBone, ProcessedBoneDirection, ProcessedBoneLayered, ProcessedBoneLayer } from './skeleton-mapper';

/** 手动烘焙结果：parts = 部件/组条目映射；layered 仅 bonePrefixSplit='layers' 时给出 */
export interface ManualBakeResult {
  parts: Map<number, ProcessedBone>;
  layered?: ProcessedBoneLayered[];
}

/** 骨骼 ID 材质：aBone（局部骨骼下标 + 1）→ RG 16 位直出（与 sixpart 图层 ID 遍同风格） */
function makeBoneIdMaterial16(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: `
      attribute float aBone;
      varying float vBone;
      void main() {
        vBone = aBone;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vBone;
      void main() {
        float v = vBone;
        gl_FragColor = vec4(mod(v, 256.0) / 255.0, floor(v / 256.0) / 255.0, 0.0, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

// ---- 网格清单（对话框勾选用） ----

export interface ManualMeshInfo {
  /** 稳定序号（场景遍历顺序） */
  meshIndex: number;
  /** 显示名：节点名 → 网格名 → mesh_N */
  name: string;
  /** 场景图路径（同名消歧用） */
  path: string;
  triCount: number;
  /** 枢轴（文件世界坐标） */
  pivot: { x: number; y: number; z: number };
  /** 最近的网格祖先（场景图）的 meshIndex，无则 null */
  parentMeshIndex: number | null;
}

export interface ManualCatalog {
  meshes: ManualMeshInfo[];
  hasBones: boolean;
}

export type ManualPivotSpec =
  /** 用某个网格的原点（不必属于本部件——可指连接点处的网格） */
  | { mode: 'mesh'; meshIndex: number }
  /** 部件包围盒中心（世界坐标） */
  | { mode: 'center' }
  /** 自定义枢轴（文件世界坐标） */
  | { mode: 'custom'; point: { x: number; y: number; z: number } };

export interface ManualPartSpec {
  /** 部件名（= 导入后的节点名） */
  name: string;
  /** 组成部件的网格（可多个：多网格合并为一个部件） */
  meshIndices: number[];
  /** 枢轴来源，缺省 = meshIndices[0] 的原点 */
  pivot?: ManualPivotSpec;
  /** 父部件覆盖（specs 数组下标）：-1 = 挂根；undefined = 自动解析（锚网格场景图祖先） */
  parentIndex?: number;
  /** 朝向调整（垂臂）：渲染前把部件绕枢轴按垂臂语义转到自然下垂，后代部件跟随 */
  droop?: boolean;
}

/** 骨骼名前缀词干：反复去掉尾部序号段（半角/全角数字 + 分隔符），如 右親指１→右親指、Arm_2→Arm、yb_0_1→yb */
export function boneNameStem(name: string): string {
  let s = name;
  for (;;) {
    const t = s.replace(/[\s._\-·]*[0-9０-９]+$/, '');
    if (t === s || t === '') break;
    s = t;
  }
  s = s.replace(/[\s._\-·]+$/, '');
  return s || name;
}

export interface ManualBakeOptions {
  /**
   * 按骨骼前缀拆分（部件内再按主导骨骼名的词干分组）：
   * 'none' 不拆；'parts' 前缀组成为独立部件（最大组留在原部件，其余组挂其下、
   * 枢轴取组主导骨骼关节）；'layers' 前缀组作原部件的分层（与六部件图层模式同构）。
   * 部件没有蒙皮骨骼数据时自动回落 'none'。
   */
  bonePrefixSplit?: 'none' | 'parts' | 'layers';
  /** PMX 导入的贴图文件表（zip 解包：路径→Blob）；仅 PMX 输入时用 */
  pmxTextures?: Map<string, Blob>;
  /** PMX 原味着色：开时颜色遍用参考版 NPR 着色（pmx-npr.ts），关时统一 toon 转换 */
  usePmxNpr?: boolean;
  /** 全角度模式：额外纬度（度），如 [45,-45,90,-90]；基纬度 0 恒渲，|纬度|≥90 只渲一个朝向 */
  extraLatitudes?: number[];
  size?: number;
  paletteSize?: number;
  toonSteps?: number;
  /** 每部件相机 padding 系数，默认 1.25（与六部件一致） */
  partPadding?: number;
  /** 未分配网格归入邻近部件（默认关 = 不烘焙、丢失）：按共享顶点投票归入相邻部件，无共享顶点时按包围盒中心最近归入 */
  absorbUnassigned?: boolean;
  onProgress?: (done: number, total: number, label: string) => void;
}

// ---- 静态网格数据（文件世界空间） ----

/** 模型骨骼表条目（文件世界空间，绑定姿势） */
export interface ManualModelBone {
  name: string;
  parentName: string | null;
  /** 关节世界坐标 */
  joint: { x: number; y: number; z: number };
}

interface StaticMesh {
  info: ManualMeshInfo;
  /** 世界空间顶点位置（已应用骨骼绑定姿势 + 节点世界变换） */
  positions: Float32Array;
  uvs: Float32Array | null;
  index: Uint32Array | null;
  material: THREE.Material | THREE.Material[];
  groups: THREE.BufferGeometry['groups'];
  /** 逐顶点主导骨骼（模型骨骼表下标，-1 = 无蒙皮）；仅蒙皮网格有 */
  vertBones?: Int32Array;
  /** 模型骨骼表（同模型的所有网格共享同一份） */
  boneTable?: ManualModelBone[];
}

async function loadModel(input: string | ArrayBuffer, pmxTextures?: Map<string, Blob>): Promise<THREE.Group> {
  return (await loadModelScene(input, pmxTextures)) as THREE.Group;
}

/** 遍历模型，收集每网格的静态（世界空间）几何与清单信息 */
function collectStaticMeshes(model: THREE.Object3D): { statics: StaticMesh[]; hasBones: boolean } {
  model.updateMatrixWorld(true);
  let hasBones = false;
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) hasBones = true;
  });
  // 模型骨骼表：名字 → 关节世界位/父骨骼名（骨骼前缀拆分的数据源）
  const boneTable: ManualModelBone[] = [];
  const boneObjToTableIdx = new Map<THREE.Object3D, number>();
  model.traverse((o) => {
    const b = o as THREE.Bone;
    if (!b.isBone) return;
    const wp = new THREE.Vector3();
    b.getWorldPosition(wp);
    let parentName: string | null = null;
    let anc: THREE.Object3D | null = b.parent;
    while (anc) {
      if ((anc as THREE.Bone).isBone) { parentName = anc.name || null; break; }
      anc = anc.parent;
    }
    boneObjToTableIdx.set(b, boneTable.length);
    boneTable.push({ name: b.name || `bone_${boneTable.length}`, parentName, joint: { x: wp.x, y: wp.y, z: wp.z } });
  });

  const statics: StaticMesh[] = [];
  const meshObjByIndex = new Map<number, THREE.Object3D>();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const meshIndex = statics.length;
    meshObjByIndex.set(meshIndex, mesh);

    const geo = mesh.geometry;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const vCount = posAttr.count;
    const positions = new Float32Array(vCount * 3);
    const v = new THREE.Vector3();
    const sm = mesh as THREE.SkinnedMesh;
    let vertBones: Int32Array | undefined;
    if (sm.isSkinnedMesh && geo.getAttribute('skinIndex') && sm.skeleton) {
      // 绑定姿势：boneMatrix 蒙皮后再应用节点世界变换（与六部件静态烘焙同口径）
      sm.skeleton.update();
      const skinIndex = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
      const skinWeight = geo.getAttribute('skinWeight') as THREE.BufferAttribute;
      // 逐顶点主导骨骼（最大权重）→ 模型骨骼表下标；骨骼前缀拆分用
      vertBones = new Int32Array(vCount).fill(-1);
      for (let i = 0; i < vCount; i++) {
        let bestW = 0;
        let bestJi = -1;
        for (let j = 0; j < 4; j++) {
          const w = skinWeight.getComponent(i, j);
          if (w > bestW) { bestW = w; bestJi = Math.round(skinIndex.getComponent(i, j)); }
        }
        if (bestJi >= 0) {
          const boneObj = sm.skeleton.bones[bestJi];
          const ti = boneObj ? boneObjToTableIdx.get(boneObj) : undefined;
          if (ti !== undefined) vertBones[i] = ti;
        }
      }
      const bm = sm.skeleton.boneMatrices;
      const m = new THREE.Matrix4();
      for (let i = 0; i < vCount; i++) {
        v.fromBufferAttribute(posAttr, i);
        let tx = 0, ty = 0, tz = 0;
        for (let j = 0; j < 4; j++) {
          const w = skinWeight.getComponent(i, j);
          if (w <= 0) continue;
          const ji = Math.round(skinIndex.getComponent(i, j));
          m.fromArray(bm, ji * 16);
          const e = m.elements;
          tx += (e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12]) * w;
          ty += (e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13]) * w;
          tz += (e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14]) * w;
        }
        v.set(tx, ty, tz).applyMatrix4(mesh.matrixWorld);
        positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
      }
    } else {
      for (let i = 0; i < vCount; i++) {
        v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
        positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
      }
    }
    const uvs = uvAttr
      ? new Float32Array(Array.from({ length: vCount * 2 }, (_, i) => uvAttr.array[i]))
      : null;
    const idxAttr = geo.getIndex();
    const index = idxAttr ? new Uint32Array(idxAttr.array) : null;
    const triCount = index ? index.length / 3 : Math.floor(vCount / 3);

    // 场景图路径（根到本节点的名称链）
    const pathNames: string[] = [];
    let p: THREE.Object3D | null = mesh;
    while (p && p !== model) {
      if (p.name) pathNames.unshift(p.name);
      p = p.parent;
    }
    // 最近的网格祖先
    let parentMeshIndex: number | null = null;
    let anc: THREE.Object3D | null = mesh.parent;
    while (anc && anc !== model) {
      for (const [mi, obj] of meshObjByIndex) {
        if (obj === anc) { parentMeshIndex = mi; break; }
      }
      if (parentMeshIndex !== null) break;
      anc = anc.parent;
    }
    const pivotV = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    statics.push({
      info: {
        meshIndex,
        name: mesh.name || geo.name || `mesh_${meshIndex}`,
        path: pathNames.join('/') || `mesh_${meshIndex}`,
        triCount,
        pivot: { x: pivotV.x, y: pivotV.y, z: pivotV.z },
        parentMeshIndex,
      },
      positions,
      uvs,
      index,
      material: mesh.material as THREE.Material | THREE.Material[],
      groups: geo.groups,
      vertBones,
      boneTable: vertBones ? boneTable : undefined,
    });
  });
  return { statics, hasBones };
}

/** 读取网格清单（对话框在手动模式下展示勾选） */
export async function listManualMeshes(input: string | ArrayBuffer, pmxTextures?: Map<string, Blob>): Promise<ManualCatalog> {
  const model = await loadModel(input, pmxTextures);
  const { statics, hasBones } = collectStaticMeshes(model);
  return { meshes: statics.map((s) => s.info), hasBones };
}

// ---- 部件准备（归一化 + 取景 + 层级解析；无 GL，可单测） ----

/** 加载并收集静态网格数据（prepareManualParts 的输入；供测试与高级调用） */
export async function loadManualStatics(
  input: string | ArrayBuffer,
  pmxTextures?: Map<string, Blob>,
): Promise<{ statics: StaticMesh[]; hasBones: boolean }> {
  const model = await loadModel(input, pmxTextures);
  return collectStaticMeshes(model);
}

export interface PreparedManualPartMesh {
  /** 归一化空间几何（position/uv/index 已就绪） */
  positions: Float32Array;
  uvs: Float32Array | null;
  index: Uint32Array | null;
  material: THREE.Material | THREE.Material[];
  groups: THREE.BufferGeometry['groups'];
  /** 逐顶点主导骨骼（部件骨骼表下标，-1 = 无）；仅蒙皮网格有 */
  vertBones?: Int32Array;
}

/** 部件骨骼表条目（归一化空间，关节已随部件几何一同做过朝向调整） */
export interface PreparedManualBone {
  name: string;
  parentName: string | null;
  jointNorm: { x: number; y: number; z: number };
  /** 本部件内引用到这根骨骼的顶点数 */
  vertexCount: number;
}

export interface PreparedManualPart {
  spec: ManualPartSpec;
  meshes: PreparedManualPartMesh[];
  /** 枢轴（归一化空间） */
  pivotNorm: { x: number; y: number; z: number };
  /** 本部件用到的骨骼（vertBones 的下标空间）；无蒙皮数据为空数组 */
  bones: PreparedManualBone[];
  /** 取景：球心（归一化空间）+ 相机半宽 */
  frameCenter: { x: number; y: number; z: number };
  half: number;
  /** 父部件在 specs 中的下标，无（挂根）为 -1 */
  parentSpecIndex: number;
  /** 实际施加的朝向调整角度（度）；0 = 未启用或已下垂跳过 */
  droopAngleDeg: number;
}

export interface PreparedManual {
  parts: PreparedManualPart[];
  normalization: { center: { x: number; y: number; z: number }; scale: number };
  /** 根节点 joint3D（模型原点的归一化坐标） */
  rootJoint3D: { x: number; y: number; z: number };
  /** 归入邻近部件的未分配网格（absorbUnassigned 开启时）；关闭或无未分配时为空 */
  absorbedMeshes: { meshIndex: number; partIndex: number }[];
}

/** 父部件解析（与 prepareManualParts 同一口径的纯函数版，供对话框层级预览复用）：
 * 锚网格 = 枢轴网格（pivot 缺省或 mode 非 mesh 时用首网格），沿 parentMeshIndex 链上溯，
 * 第一个属于其他部件的网格所在的部件下标；无则 -1（挂根）。未分配网格在链上跳过。 */
export function resolveManualParentIndices(
  meshes: ManualMeshInfo[],
  parts: { meshIndices: number[]; pivot?: ManualPivotSpec; parentIndex?: number }[],
): number[] {
  const parentByMesh = new Map(meshes.map((m) => [m.meshIndex, m.parentMeshIndex]));
  const specIndexByMesh = new Map<number, number>();
  parts.forEach((p, i) => {
    for (const mi of p.meshIndices) if (!specIndexByMesh.has(mi)) specIndexByMesh.set(mi, i);
  });
  return parts.map((part, idx) => {
    if (part.meshIndices.length === 0) return -1;
    // 手动指定父部件优先：-1 = 挂根；合法的他人下标直接采用；自指/越界回落自动解析
    if (part.parentIndex !== undefined) {
      if (part.parentIndex === -1) return -1;
      if (part.parentIndex >= 0 && part.parentIndex < parts.length && part.parentIndex !== idx) {
        return part.parentIndex;
      }
    }
    const pivot = part.pivot ?? { mode: 'mesh' as const, meshIndex: part.meshIndices[0] };
    const anchor = pivot.mode === 'mesh' ? pivot.meshIndex : part.meshIndices[0];
    let anc = parentByMesh.get(anchor) ?? null;
    const seen = new Set<number>();
    while (anc !== null && !seen.has(anc)) {
      seen.add(anc);
      const si = specIndexByMesh.get(anc);
      if (si !== undefined && si !== idx) return si;
      anc = parentByMesh.get(anc) ?? null;
    }
    return -1;
  });
}

export interface ManualMeshGroup {
  name: string;
  meshIndices: number[];
}

/** 一键分组草案：按场景图子树——每网格沿 parentMeshIndex 上溯到顶层网格祖先，同根同组 */
export function groupManualMeshesBySubtree(meshes: ManualMeshInfo[]): ManualMeshGroup[] {
  const byIndex = new Map(meshes.map((m) => [m.meshIndex, m]));
  const rootOf = (m: ManualMeshInfo): number => {
    let cur = m;
    const seen = new Set<number>();
    while (cur.parentMeshIndex !== null && byIndex.has(cur.parentMeshIndex) && !seen.has(cur.meshIndex)) {
      seen.add(cur.meshIndex);
      cur = byIndex.get(cur.parentMeshIndex)!;
    }
    return cur.meshIndex;
  };
  const groups = new Map<number, number[]>();
  for (const m of meshes) {
    const r = rootOf(m);
    const arr = groups.get(r) ?? [];
    arr.push(m.meshIndex);
    groups.set(r, arr);
  }
  return [...groups.entries()].map(([r, idxs]) => ({ name: byIndex.get(r)?.name ?? `mesh_${r}`, meshIndices: idxs }));
}

/** 网格名 → 词干：去掉尾部数字与分隔符（Arm_L_1 → Arm_L、Mesh.002 → Mesh） */
export function manualNameStem(name: string): string {
  const stem = name.replace(/\d+$/, '').replace(/[\s_\-.]+$/, '');
  return stem || name;
}

/** 一键分组草案：按名称词干分组（同词干同组，单例自成一组） */
export function groupManualMeshesByNamePrefix(meshes: ManualMeshInfo[]): ManualMeshGroup[] {
  const groups = new Map<string, number[]>();
  for (const m of meshes) {
    const stem = manualNameStem(m.name);
    const arr = groups.get(stem) ?? [];
    arr.push(m.meshIndex);
    groups.set(stem, arr);
  }
  return [...groups.entries()].map(([stem, idxs]) => ({ name: stem, meshIndices: idxs }));
}

export function prepareManualParts(
  statics: StaticMesh[],
  specs: ManualPartSpec[],
  partPadding = 1.25,
  absorbUnassigned = false,
): PreparedManual {
  // 整模归一化（与六部件同口径：全部静态顶点 bbox 中心 + 包围球半径）
  const fullBox = new THREE.Box3();
  const tv = new THREE.Vector3();
  for (const s of statics) {
    for (let i = 0; i < s.positions.length; i += 3) {
      tv.set(s.positions[i], s.positions[i + 1], s.positions[i + 2]);
      fullBox.expandByPoint(tv);
    }
  }
  const center = fullBox.getCenter(new THREE.Vector3());
  const sphere = fullBox.getBoundingSphere(new THREE.Sphere());
  const scale = sphere.radius > 1e-6 ? 1 / sphere.radius : 1;
  const norm = (x: number, y: number, z: number) => ({
    x: (x - center.x) * scale,
    y: (y - center.y) * scale,
    z: (z - center.z) * scale,
  });

  const byMeshIndex = new Map(statics.map((s) => [s.info.meshIndex, s]));
  // 网格 → 所属部件下标（一个网格至多属于一个部件，重复占用直接报错）
  const specIndexByMesh = new Map<number, number>();
  specs.forEach((sp, i) => {
    if (sp.meshIndices.length === 0) throw new Error(`手动拆分：部件「${sp.name}」没有网格`);
    for (const mi of sp.meshIndices) {
      if (specIndexByMesh.has(mi)) throw new Error(`手动拆分：网格 ${mi} 被多个部件占用`);
      specIndexByMesh.set(mi, i);
    }
  });

  // 未分配网格归入邻近部件（选项开启时）：共享顶点投票优先（同一顶点位置被哪个
  // 部件的网格共用得最多归哪个），无共享顶点时按包围盒中心距离最近归入。
  // 在父部件解析之前做，归入的网格按新归属参与层级解析。
  const absorbedMeshes: { meshIndex: number; partIndex: number }[] = [];
  if (absorbUnassigned) {
    const unassigned = statics.filter((s) => !specIndexByMesh.has(s.info.meshIndex));
    if (unassigned.length > 0 && specs.length > 0) {
      const keyOf = (x: number, y: number, z: number) =>
        `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
      const vertOwners = new Map<string, number[]>();
      for (const s of statics) {
        const seen = new Set<string>();
        for (let i = 0; i < s.positions.length; i += 3) {
          const k = keyOf(s.positions[i], s.positions[i + 1], s.positions[i + 2]);
          if (seen.has(k)) continue;
          seen.add(k);
          const arr = vertOwners.get(k);
          if (arr) arr.push(s.info.meshIndex);
          else vertOwners.set(k, [s.info.meshIndex]);
        }
      }
      const partCenters = specs.map((sp) => {
        const box = new THREE.Box3();
        for (const mi of sp.meshIndices) {
          const sm = byMeshIndex.get(mi);
          if (!sm) continue;
          for (let i = 0; i < sm.positions.length; i += 3) {
            tv.set(sm.positions[i], sm.positions[i + 1], sm.positions[i + 2]);
            box.expandByPoint(tv);
          }
        }
        return box.getCenter(new THREE.Vector3());
      });
      const effSpecs = specs.map((sp) => ({ ...sp, meshIndices: [...sp.meshIndices] }));
      for (const u of unassigned) {
        const votes = new Array<number>(specs.length).fill(0);
        const seen = new Set<string>();
        for (let i = 0; i < u.positions.length; i += 3) {
          const k = keyOf(u.positions[i], u.positions[i + 1], u.positions[i + 2]);
          if (seen.has(k)) continue;
          seen.add(k);
          for (const owner of vertOwners.get(k) ?? []) {
            if (owner === u.info.meshIndex) continue;
            const p = specIndexByMesh.get(owner);
            if (p !== undefined) votes[p]++;
          }
        }
        let winner = -1;
        let best = 0;
        for (let p = 0; p < votes.length; p++) {
          if (votes[p] > best) { best = votes[p]; winner = p; }
        }
        if (winner < 0) {
          const ub = new THREE.Box3();
          for (let i = 0; i < u.positions.length; i += 3) {
            tv.set(u.positions[i], u.positions[i + 1], u.positions[i + 2]);
            ub.expandByPoint(tv);
          }
          const uc = ub.getCenter(new THREE.Vector3());
          let bestD = Infinity;
          for (let p = 0; p < partCenters.length; p++) {
            const d = uc.distanceToSquared(partCenters[p]);
            if (d < bestD) { bestD = d; winner = p; }
          }
        }
        if (winner >= 0) {
          effSpecs[winner].meshIndices.push(u.info.meshIndex);
          specIndexByMesh.set(u.info.meshIndex, winner);
          absorbedMeshes.push({ meshIndex: u.info.meshIndex, partIndex: winner });
        }
      }
      specs = effSpecs;
    }
  }

  const parentIndices = resolveManualParentIndices(statics.map((s) => s.info), specs);

  // 第一遍：归一化顶点 + 枢轴解析（未做朝向调整）
  interface RawManualPart {
    meshes: PreparedManualPartMesh[];
    pivotNorm: { x: number; y: number; z: number };
    bones: PreparedManualBone[];
  }
  const rawParts: RawManualPart[] = specs.map((spec) => {
    const meshes: PreparedManualPartMesh[] = [];
    const worldBox = new THREE.Box3();
    // 部件骨骼表：本部件网格引用到的模型骨骼（首次出现序），vertBones 重映射到此表
    const partBones: PreparedManualBone[] = [];
    const localBoneOf = new Map<number, number>();
    for (const mi of spec.meshIndices) {
      const sm = byMeshIndex.get(mi);
      if (!sm) throw new Error(`手动拆分：找不到网格 ${mi}`);
      const positions = new Float32Array(sm.positions.length);
      for (let i = 0; i < sm.positions.length; i += 3) {
        const n = norm(sm.positions[i], sm.positions[i + 1], sm.positions[i + 2]);
        positions[i] = n.x; positions[i + 1] = n.y; positions[i + 2] = n.z;
        tv.set(sm.positions[i], sm.positions[i + 1], sm.positions[i + 2]);
        worldBox.expandByPoint(tv);
      }
      let localVertBones: Int32Array | undefined;
      if (sm.vertBones && sm.boneTable) {
        const table = sm.boneTable;
        localVertBones = new Int32Array(sm.vertBones.length);
        for (let vi = 0; vi < sm.vertBones.length; vi++) {
          const mb = sm.vertBones[vi];
          if (mb < 0) { localVertBones[vi] = -1; continue; }
          let li = localBoneOf.get(mb);
          if (li === undefined) {
            const info = table[mb];
            const jn = norm(info.joint.x, info.joint.y, info.joint.z);
            li = partBones.length;
            localBoneOf.set(mb, li);
            partBones.push({ name: info.name, parentName: info.parentName, jointNorm: jn, vertexCount: 0 });
          }
          localVertBones[vi] = li;
          partBones[li].vertexCount++;
        }
      }
      meshes.push({
        positions,
        uvs: sm.uvs,
        index: sm.index,
        material: sm.material,
        groups: sm.groups,
        vertBones: localVertBones,
      });
    }
    // 枢轴解析（世界坐标 → 归一化）
    const pivotSpec = spec.pivot ?? { mode: 'mesh' as const, meshIndex: spec.meshIndices[0] };
    let pivotWorld: { x: number; y: number; z: number };
    if (pivotSpec.mode === 'custom') {
      pivotWorld = pivotSpec.point;
    } else if (pivotSpec.mode === 'center') {
      const c = worldBox.getCenter(new THREE.Vector3());
      pivotWorld = { x: c.x, y: c.y, z: c.z };
    } else {
      const ps = byMeshIndex.get(pivotSpec.meshIndex);
      if (!ps) throw new Error(`手动拆分：找不到枢轴网格 ${pivotSpec.meshIndex}`);
      pivotWorld = ps.info.pivot;
    }
    return { meshes, pivotNorm: norm(pivotWorld.x, pivotWorld.y, pivotWorld.z), bones: partBones };
  });

  // 朝向调整（垂臂，与 sixpart droopArmPose 同语义）：按层级自上而下——先应用祖先
  // 部件的调整（几何与本部件枢轴一起跟随，如同骨骼先摆姿再拆分），再算本部件的调整：
  // 肢体方向 = 枢轴 → 最远顶点；目标 = 正下 + 按水平分量符号外张 5°；夹角 < 10° 跳过；
  // 绕本部件枢轴最短弧旋转（枢轴本身不动）。归一化空间为均匀缩放，方向即真实方向。
  interface DroopXf { q: THREE.Quaternion; px: number; py: number; pz: number }
  const applyDroopXf = (positions: Float32Array, xf: DroopXf) => {
    const v = new THREE.Vector3();
    for (let i = 0; i < positions.length; i += 3) {
      v.set(positions[i] - xf.px, positions[i + 1] - xf.py, positions[i + 2] - xf.pz).applyQuaternion(xf.q);
      positions[i] = v.x + xf.px; positions[i + 1] = v.y + xf.py; positions[i + 2] = v.z + xf.pz;
    }
  };
  const depthOf = (i: number): number => {
    let d = 0;
    let cur = parentIndices[i];
    const seen = new Set<number>();
    while (cur >= 0 && !seen.has(cur)) { seen.add(cur); d++; cur = parentIndices[cur]; }
    return d;
  };
  const topoOrder = specs.map((_, i) => i).sort((a, b) => depthOf(a) - depthOf(b));
  const seqOf: DroopXf[][] = specs.map(() => []);
  const droopAngles: number[] = specs.map(() => 0);
  const pv = new THREE.Vector3();
  for (const i of topoOrder) {
    const raw = rawParts[i];
    const seq = parentIndices[i] >= 0 ? seqOf[parentIndices[i]] : [];
    for (const xf of seq) {
      for (const m of raw.meshes) applyDroopXf(m.positions, xf);
      pv.set(raw.pivotNorm.x - xf.px, raw.pivotNorm.y - xf.py, raw.pivotNorm.z - xf.pz).applyQuaternion(xf.q);
      raw.pivotNorm = { x: pv.x + xf.px, y: pv.y + xf.py, z: pv.z + xf.pz };
    }
    let own: DroopXf | null = null;
    if (specs[i].droop) {
      let best = 0;
      let fx = 0, fy = 0, fz = 0;
      for (const m of raw.meshes) {
        const pos = m.positions;
        for (let j = 0; j < pos.length; j += 3) {
          const dx = pos[j] - raw.pivotNorm.x;
          const dy = pos[j + 1] - raw.pivotNorm.y;
          const dz = pos[j + 2] - raw.pivotNorm.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > best) { best = d2; fx = dx; fy = dy; fz = dz; }
        }
      }
      if (best > 1e-12) {
        const cur = new THREE.Vector3(fx, fy, fz).normalize();
        const tiltSign = cur.x > 0.05 ? 1 : cur.x < -0.05 ? -1 : 0;
        const target = new THREE.Vector3(0, -1, 0).applyAxisAngle(
          new THREE.Vector3(0, 0, 1),
          THREE.MathUtils.degToRad(5) * tiltSign,
        );
        const deg = THREE.MathUtils.radToDeg(cur.angleTo(target));
        if (deg >= 10) {
          own = {
            q: new THREE.Quaternion().setFromUnitVectors(cur, target),
            px: raw.pivotNorm.x, py: raw.pivotNorm.y, pz: raw.pivotNorm.z,
          };
          for (const m of raw.meshes) applyDroopXf(m.positions, own);
          droopAngles[i] = deg;
        }
      }
    }
    seqOf[i] = own ? [...seq, own] : seq;
  }

  // 第二遍：取景按调整后的最终几何算
  const parts: PreparedManualPart[] = specs.map((spec, specIdx) => {
    const raw = rawParts[specIdx];
    const box = new THREE.Box3();
    for (const m of raw.meshes) {
      for (let j = 0; j < m.positions.length; j += 3) {
        tv.set(m.positions[j], m.positions[j + 1], m.positions[j + 2]);
        box.expandByPoint(tv);
      }
    }
    const partSphere = box.getBoundingSphere(new THREE.Sphere());
    // 骨骼关节随本部件几何一同施加朝向调整序列（与顶点同变换，组枢轴才对得上）
    const bones = raw.bones.map((b) => {
      const p = { ...b.jointNorm };
      for (const xf of seqOf[specIdx]) {
        pv.set(p.x - xf.px, p.y - xf.py, p.z - xf.pz).applyQuaternion(xf.q);
        p.x = pv.x + xf.px; p.y = pv.y + xf.py; p.z = pv.z + xf.pz;
      }
      return { ...b, jointNorm: p };
    });
    return {
      spec,
      meshes: raw.meshes,
      pivotNorm: raw.pivotNorm,
      bones,
      frameCenter: { x: partSphere.center.x, y: partSphere.center.y, z: partSphere.center.z },
      half: Math.max(0.02, partSphere.radius * partPadding),
      parentSpecIndex: parentIndices[specIdx],
      droopAngleDeg: droopAngles[specIdx],
    };
  });

  return {
    parts,
    normalization: { center: { x: center.x, y: center.y, z: center.z }, scale },
    rootJoint3D: norm(0, 0, 0),
    absorbedMeshes,
  };
}

// ---- 单方向精灵构建（与 splitSixParts 尾段同制式） ----

function buildDirection(
  colorPixels: Uint8ClampedArray,
  size: number,
  displayDir: number,
  jx: number,
  jy: number,
  half: number,
  paletteSize: number,
  mask?: Uint8Array | null,
): ProcessedBoneDirection | null {
  const W = size, H = size;
  const opaque = (p: number): boolean =>
    colorPixels[p * 4 + 3] > 8 && (!mask || mask[p] === 1);
  let minX = W, maxX = -1, minY = H, maxY = -1, count = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (opaque(y * W + x)) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count === 0) return null;
  const pad = 2;
  let x0 = Math.max(0, Math.floor(minX - pad));
  let y0 = Math.max(0, Math.floor(minY - pad));
  let x1 = Math.min(W, Math.ceil(maxX + pad));
  let y1 = Math.min(H, Math.ceil(maxY + pad));
  // 确保枢轴在裁剪框内（plug 语义：枢轴是节点原点）
  x0 = Math.min(x0, Math.floor(jx));
  y0 = Math.min(y0, Math.floor(jy));
  x1 = Math.max(x1, Math.ceil(jx) + 1);
  y1 = Math.max(y1, Math.ceil(jy) + 1);
  const cw = x1 - x0, ch = y1 - y0;
  const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const so = ((y0 + y) * W + (x0 + x)) * 4;
      const do_ = (y * cw + x) * 4;
      if (!opaque((y0 + y) * W + (x0 + x))) { crop[do_ + 3] = 0; continue; }
      crop[do_] = colorPixels[so];
      crop[do_ + 1] = colorPixels[so + 1];
      crop[do_ + 2] = colorPixels[so + 2];
      crop[do_ + 3] = 255;
    }
  }
  const palette = medianCut(crop, paletteSize);
  // 尺寸归一化：按 cameraHalf 缩放到整模像素空间（全局 half ≡ 1）
  const cwN = Math.max(1, Math.round(cw * half));
  const chN = Math.max(1, Math.round(ch * half));
  const grid: PixelGrid = [];
  for (let y = 0; y < chN; y++) {
    const row: (string | null)[] = [];
    const sy = Math.min(ch - 1, Math.floor((y * ch) / chN));
    for (let x = 0; x < cwN; x++) {
      const sx = Math.min(cw - 1, Math.floor((x * cw) / cwN));
      const o = (sy * cw + sx) * 4;
      row.push(rgbaToHexOrNull(crop[o], crop[o + 1], crop[o + 2], crop[o + 3]));
    }
    grid.push(row);
  }
  if (palette.length > 0) {
    for (let y = 0; y < chN; y++) {
      for (let x = 0; x < cwN; x++) {
        const c = grid[y][x];
        if (!c) continue;
        const r = parseInt(c.slice(1, 3), 16);
        const gg = parseInt(c.slice(3, 5), 16);
        const b = parseInt(c.slice(5, 7), 16);
        const p = palette[nearestPaletteIndex(r, gg, b, palette)];
        grid[y][x] = '#' + p.map((v) => v.toString(16).padStart(2, '0')).join('');
      }
    }
  }
  return {
    direction: displayDir as DirectionIndex,
    grid,
    width: cwN,
    height: chN,
    cropX: x0,
    cropY: y0,
    jointX: jx,
    jointY: jy,
    plugX: (jx - x0) * half,
    plugY: (jy - y0) * half,
    cameraHalf: half,
    globalCameraHalf: 1.0,
  };
}

// ---- 手动拆分烘焙主函数 ----

export async function bakeManualParts(
  input: string | ArrayBuffer,
  specs: ManualPartSpec[],
  options: ManualBakeOptions = {},
): Promise<ManualBakeResult> {
  const size = options.size ?? 128;
  const paletteSize = options.paletteSize ?? 16;
  const toonSteps = options.toonSteps ?? 3;
  const partPadding = options.partPadding ?? 1.25;
  const onProgress = options.onProgress;
  if (specs.length === 0) throw new Error('手动拆分：至少勾选一个网格作为部件');
  if (typeof window === 'undefined') {
    throw new Error('bakeManualParts 仅支持浏览器环境(WebGL)');
  }

  const model = await loadModel(input, options.pmxTextures);
  const { statics } = collectStaticMeshes(model);
  const prepared = prepareManualParts(statics, specs, partPadding, options.absorbUnassigned ?? false);

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  try {
    const gradientMap = makeGradientMap(toonSteps);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
    dirLight.position.set(2, 3, 4);
    scene.add(dirLight);
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

    const result = new Map<number, ProcessedBone>();
    // 合成根（boneIndex 0）：模型原点，无精灵占位
    result.set(0, {
      boneIndex: 0,
      boneName: '根节点',
      parentIndex: null,
      directions: [],
      joint3D: prepared.rootJoint3D,
      bakeWidth: size,
    });

    const latitudes = [0, ...(options.extraLatitudes ?? [])];
    const frames: Array<{ lat: number; d: number }> = latitudes.flatMap((lat) =>
      dirsForLatitude(lat).map((d) => ({ lat, d })),
    );
    const total = prepared.parts.length * frames.length;
    let done = 0;
    const projV = new THREE.Vector3();

    const prefixSplitMode = options.bonePrefixSplit ?? 'none';
    const layeredParts: ProcessedBoneLayered[] = [];
    let nextGroupBoneIndex = prepared.parts.length + 1;

    for (let pi = 0; pi < prepared.parts.length; pi++) {
      const part = prepared.parts[pi];
      if (part.droopAngleDeg > 0) {
        console.info(`[bake-manual] ${part.spec.name} 朝向调整（垂臂）${part.droopAngleDeg.toFixed(0)}°`);
      }
      const rotGroup = new THREE.Group();
      const disposables: Array<{ dispose(): void }> = [];
      for (const pm of part.meshes) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pm.positions, 3));
        if (pm.uvs) geo.setAttribute('uv', new THREE.BufferAttribute(pm.uvs, 2));
        if (pm.index) geo.setIndex(new THREE.BufferAttribute(pm.index, 1));
        geo.computeVertexNormals();
        const toonMat = Array.isArray(pm.material)
          ? pm.material.map((m) => makeToonFromSource(m, gradientMap, options.usePmxNpr))
          : makeToonFromSource(pm.material, gradientMap, options.usePmxNpr);
        if (Array.isArray(toonMat)) {
          for (const g of pm.groups) geo.addGroup(g.start, g.count, g.materialIndex);
        }
        const mesh = new THREE.Mesh(geo, toonMat);
        mesh.frustumCulled = false;
        rotGroup.add(mesh);
        disposables.push(geo);
        (Array.isArray(toonMat) ? toonMat : [toonMat]).forEach((m) => disposables.push(m));
      }
      scene.add(rotGroup);

      const fc = part.frameCenter;
      const camera = new THREE.OrthographicCamera(-part.half, part.half, part.half, -part.half, 0.1, 20);
      camera.position.set(fc.x, fc.y + part.half * 0.25, fc.z + 4);
      camera.lookAt(fc.x, fc.y, fc.z);
      camera.updateMatrixWorld(true);

      // ---- 按骨骼前缀拆分（部件内按主导骨骼词干分组）----
      const splitMode = prefixSplitMode;
      interface StemGroup {
        stem: string;
        boneIdxs: number[];
        vertTotal: number;
        domBone: number;
        dirs: ProcessedBoneDirection[];
        pixelTotal: number;
      }
      let stemGroups: StemGroup[] = [];
      let baseGroupIdx = -1;
      let boneToGroup: Int32Array | null = null;
      const soupMeshes: THREE.Mesh[] = [];
      if (splitMode !== 'none' && part.bones.length > 0) {
        const byStem = new Map<string, StemGroup>();
        boneToGroup = new Int32Array(part.bones.length).fill(-1);
        part.bones.forEach((b, bi) => {
          const stem = boneNameStem(b.name);
          let g = byStem.get(stem);
          if (!g) {
            g = { stem, boneIdxs: [], vertTotal: 0, domBone: bi, dirs: [], pixelTotal: 0 };
            byStem.set(stem, g);
            stemGroups.push(g);
          }
          g.boneIdxs.push(bi);
          g.vertTotal += b.vertexCount;
          if (b.vertexCount > part.bones[g.domBone].vertexCount) g.domBone = bi;
          boneToGroup![bi] = stemGroups.indexOf(g);
        });
        if (stemGroups.length < 2) {
          stemGroups = [];
          boneToGroup = null;
        } else {
          baseGroupIdx = stemGroups.reduce((bi, g, gi) => (g.vertTotal > stemGroups[bi].vertTotal ? gi : bi), 0);
          // 骨骼 ID 遍几何：逐三角形展开（soup），aBone = 局部骨骼下标 + 1
          const idMat = makeBoneIdMaterial16();
          disposables.push(idMat);
          for (const pm of part.meshes) {
            if (!pm.vertBones) continue;
            const pos = pm.positions;
            const triCount = pm.index ? pm.index.length / 3 : pos.length / 9;
            const soupPos = new Float32Array(triCount * 9);
            const soupBone = new Float32Array(triCount * 3);
            for (let t = 0; t < triCount; t++) {
              for (let k = 0; k < 3; k++) {
                const vi = pm.index ? pm.index[t * 3 + k] : t * 3 + k;
                soupPos.set([pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]], (t * 3 + k) * 3);
                soupBone[t * 3 + k] = pm.vertBones[vi] >= 0 ? pm.vertBones[vi] + 1 : 0;
              }
            }
            const sgeo = new THREE.BufferGeometry();
            sgeo.setAttribute('position', new THREE.BufferAttribute(soupPos, 3));
            sgeo.setAttribute('aBone', new THREE.BufferAttribute(soupBone, 1));
            const smesh = new THREE.Mesh(sgeo, idMat);
            smesh.frustumCulled = false;
            smesh.visible = false;
            rotGroup.add(smesh);
            soupMeshes.push(smesh);
            disposables.push(sgeo);
          }
          if (soupMeshes.length === 0) {
            stemGroups = [];
            boneToGroup = null;
          }
        }
      }
      const splitActive = stemGroups.length >= 2 && boneToGroup !== null;
      const colorMeshes = rotGroup.children.filter((c) => !soupMeshes.includes(c as THREE.Mesh));

      const directions: ProcessedBoneDirection[] = [];
      rotGroup.rotation.order = 'YXZ';
      for (const { lat, d } of frames) {
        rotGroup.rotation.y = (d / 8) * Math.PI * 2;
        rotGroup.rotation.x = latitudePitchRad(lat);
        rotGroup.updateMatrixWorld(true);
        // 枢轴投影（整图 top-down 像素）
        projV.set(part.pivotNorm.x, part.pivotNorm.y, part.pivotNorm.z)
          .applyMatrix4(rotGroup.matrixWorld)
          .project(camera);
        const jx = ((projV.x + 1) / 2) * size;
        const jy = ((1 - projV.y) / 2) * size;

        renderer.setRenderTarget(rt);
        renderer.clear(true, true, false);
        renderer.render(scene, camera);
        const colorPixels = readFlipped();
        renderer.setRenderTarget(null);
        if (!splitActive) {
          const dir = buildDirection(colorPixels, size, ((d + 6) % 8), jx, jy, part.half, paletteSize);
          if (dir) {
            dir.latitude = lat;
            directions.push(dir);
          }
        } else {
          // 骨骼 ID 遍（同帧同变换）：颜色网格藏起、ID 汤网格显示
          for (const m of colorMeshes) m.visible = false;
          for (const m of soupMeshes) m.visible = true;
          renderer.setRenderTarget(rt);
          renderer.clear(true, true, false);
          renderer.render(scene, camera);
          const bonePixels = readFlipped();
          renderer.setRenderTarget(null);
          for (const m of soupMeshes) m.visible = false;
          for (const m of colorMeshes) m.visible = true;
          const npix = size * size;
          const masks = stemGroups.map(() => new Uint8Array(npix));
          for (let p = 0; p < npix; p++) {
            if (colorPixels[p * 4 + 3] <= 8) continue;
            const v = bonePixels[p * 4] | (bonePixels[p * 4 + 1] << 8);
            const lb = v - 1;
            const gi = lb >= 0 && boneToGroup![lb] >= 0 ? boneToGroup![lb] : baseGroupIdx;
            masks[gi][p] = 1;
            stemGroups[gi].pixelTotal++;
          }
          const dispDir = ((d + 6) % 8) as DirectionIndex;
          const baseDir = buildDirection(colorPixels, size, dispDir, jx, jy, part.half, paletteSize, masks[baseGroupIdx]);
          if (baseDir) {
            baseDir.latitude = lat;
            directions.push(baseDir);
          }
          stemGroups.forEach((g, gi) => {
            if (gi === baseGroupIdx) {
              if (baseDir) g.dirs.push(baseDir);
              return;
            }
            let gjx = jx, gjy = jy;
            if (splitMode === 'parts') {
              const jn = part.bones[g.domBone].jointNorm;
              projV.set(jn.x, jn.y, jn.z).applyMatrix4(rotGroup.matrixWorld).project(camera);
              gjx = ((projV.x + 1) / 2) * size;
              gjy = ((1 - projV.y) / 2) * size;
            }
            const gd = buildDirection(colorPixels, size, dispDir, gjx, gjy, part.half, paletteSize, masks[gi]);
            if (gd) {
              gd.latitude = lat;
              g.dirs.push(gd);
            }
          });
        }
        onProgress?.(++done, total, `${part.spec.name} ${lat !== 0 ? `纬度 ${lat}° ` : ''}${d * 45}°`);
        await new Promise((r) => setTimeout(r, 0));
      }

      scene.remove(rotGroup);
      disposables.forEach((d) => d.dispose());

      const worldToPixels = (size / 2) / part.half;
      const parentIndex = part.parentSpecIndex >= 0 ? part.parentSpecIndex + 1 : 0;
      result.set(pi + 1, {
        boneIndex: pi + 1,
        boneName: part.spec.name,
        parentIndex,
        directions,
        joint3D: part.pivotNorm,
        bakeWidth: size,
        worldToPixels,
      });
      if (splitActive && splitMode === 'parts') {
        // 甲：非基底组成为独立部件。先分配全部组条目下标，再按骨骼链定父
        const entryOfGroup = new Map<number, number>();
        stemGroups.forEach((g, gi) => {
          if (gi !== baseGroupIdx && g.dirs.length > 0) entryOfGroup.set(gi, nextGroupBoneIndex++);
        });
        stemGroups.forEach((g, gi) => {
          const entryIdx = entryOfGroup.get(gi);
          if (entryIdx === undefined) return;
          let parentEntry = pi + 1;
          const dom = part.bones[g.domBone];
          const seenNames = new Set<string>();
          let ancName = dom.parentName;
          while (ancName && !seenNames.has(ancName)) {
            seenNames.add(ancName);
            const ancBoneIdx = part.bones.findIndex((b) => b.name === ancName);
            if (ancBoneIdx < 0) break;
            const agi = boneToGroup![ancBoneIdx];
            if (agi === baseGroupIdx) { parentEntry = pi + 1; break; }
            const ancEntry = entryOfGroup.get(agi);
            if (ancEntry !== undefined) { parentEntry = ancEntry; break; }
            ancName = part.bones[ancBoneIdx].parentName;
          }
          result.set(entryIdx, {
            boneIndex: entryIdx,
            boneName: g.stem,
            parentIndex: parentEntry,
            directions: g.dirs,
            joint3D: part.bones[g.domBone].jointNorm,
            bakeWidth: size,
            worldToPixels,
          });
        });
      } else if (splitMode === 'layers') {
        const layers: ProcessedBoneLayer[] = [...stemGroups]
          .sort((a, b) => b.pixelTotal - a.pixelTotal)
          .filter((g) => g.dirs.length > 0)
          .map((g, li) => ({
            layerIndex: li,
            key: g.stem,
            label: g.stem,
            rank: li,
            pixelCount: g.pixelTotal,
            directions: g.dirs,
          }));
        // 分层条目的 directions 与装配口径一致：取像素最多层（基底）——流式构建时
        // 基底按顶点数选（供部件条目预览），这里按像素数对齐最终基底
        const baseLayer = layers[0];
        layeredParts.push({
          boneIndex: pi + 1,
          boneName: part.spec.name,
          parentIndex,
          directions: baseLayer ? baseLayer.directions : directions,
          joint3D: part.pivotNorm,
          bakeWidth: size,
          worldToPixels,
          layers,
        });
      }
    }

    rt.dispose();
    gradientMap.dispose();
    return { parts: result, layered: prefixSplitMode === 'layers' ? layeredParts : undefined };
  } finally {
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch { /* noop */ }
  }
}

// ---- 点选（乙案）纯助手：网格 ID 编解码 + 三视图取景 ----

/** 网格序号 → ID 色（RGB 三字节，值 = meshIndex + 1；0 保留为背景/未命中） */
export function encodeMeshIdColor(meshIndex: number): [number, number, number] {
  const v = meshIndex + 1;
  return [(v & 0xff) / 255, ((v >> 8) & 0xff) / 255, ((v >> 16) & 0xff) / 255];
}

/** ID 图像素字节 → 网格序号；背景（0）返回 null */
export function decodeMeshId(r: number, g: number, b: number): number | null {
  const v = r | (g << 8) | (b << 16);
  return v > 0 ? v - 1 : null;
}

/** 三视图/3D 预览取景：与 prepareManualParts 同口径（全模型包围盒中心 + 包围球半径） */
export function computeManualFraming(
  statics: { positions: Float32Array }[],
): { center: { x: number; y: number; z: number }; radius: number } {
  const box = new THREE.Box3();
  const tv = new THREE.Vector3();
  for (const s of statics) {
    for (let i = 0; i < s.positions.length; i += 3) {
      tv.set(s.positions[i], s.positions[i + 1], s.positions[i + 2]);
      box.expandByPoint(tv);
    }
  }
  if (box.isEmpty()) return { center: { x: 0, y: 0, z: 0 }, radius: 1 };
  const c = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  return { center: { x: c.x, y: c.y, z: c.z }, radius: Math.max(1e-6, sphere.radius) };
}
