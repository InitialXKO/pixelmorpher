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
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeToonFromSource, makeGradientMap } from './threejs-baker-sixpart';
import { dirsForLatitude, latitudePitchRad, medianCut, nearestPaletteIndex } from './threejs-baker';
import { rgbaToHexOrNull } from '../engine/utils';
import type { PixelGrid, DirectionIndex } from '../unified-types';
import type { ProcessedBone, ProcessedBoneDirection } from './skeleton-mapper';

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
}

export interface ManualBakeOptions {
  /** 全角度模式：额外纬度（度），如 [45,-45,90,-90]；基纬度 0 恒渲，|纬度|≥90 只渲一个朝向 */
  extraLatitudes?: number[];
  size?: number;
  paletteSize?: number;
  toonSteps?: number;
  /** 每部件相机 padding 系数，默认 1.25（与六部件一致） */
  partPadding?: number;
  onProgress?: (done: number, total: number, label: string) => void;
}

// ---- 静态网格数据（文件世界空间） ----

interface StaticMesh {
  info: ManualMeshInfo;
  /** 世界空间顶点位置（已应用骨骼绑定姿势 + 节点世界变换） */
  positions: Float32Array;
  uvs: Float32Array | null;
  index: Uint32Array | null;
  material: THREE.Material | THREE.Material[];
  groups: THREE.BufferGeometry['groups'];
}

async function loadModel(input: string | ArrayBuffer): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf =
    typeof input === 'string' ? await loader.loadAsync(input) : await loader.parseAsync(input, '');
  return gltf.scene;
}

/** 遍历模型，收集每网格的静态（世界空间）几何与清单信息 */
function collectStaticMeshes(model: THREE.Object3D): { statics: StaticMesh[]; hasBones: boolean } {
  model.updateMatrixWorld(true);
  let hasBones = false;
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) hasBones = true;
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
    if (sm.isSkinnedMesh && geo.getAttribute('skinIndex') && sm.skeleton) {
      // 绑定姿势：boneMatrix 蒙皮后再应用节点世界变换（与六部件静态烘焙同口径）
      sm.skeleton.update();
      const skinIndex = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
      const skinWeight = geo.getAttribute('skinWeight') as THREE.BufferAttribute;
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
    });
  });
  return { statics, hasBones };
}

/** 读取网格清单（对话框在手动模式下展示勾选） */
export async function listManualMeshes(input: string | ArrayBuffer): Promise<ManualCatalog> {
  const model = await loadModel(input);
  const { statics, hasBones } = collectStaticMeshes(model);
  return { meshes: statics.map((s) => s.info), hasBones };
}

// ---- 部件准备（归一化 + 取景 + 层级解析；无 GL，可单测） ----

/** 加载并收集静态网格数据（prepareManualParts 的输入；供测试与高级调用） */
export async function loadManualStatics(
  input: string | ArrayBuffer,
): Promise<{ statics: StaticMesh[]; hasBones: boolean }> {
  const model = await loadModel(input);
  return collectStaticMeshes(model);
}

export interface PreparedManualPartMesh {
  /** 归一化空间几何（position/uv/index 已就绪） */
  positions: Float32Array;
  uvs: Float32Array | null;
  index: Uint32Array | null;
  material: THREE.Material | THREE.Material[];
  groups: THREE.BufferGeometry['groups'];
}

export interface PreparedManualPart {
  spec: ManualPartSpec;
  meshes: PreparedManualPartMesh[];
  /** 枢轴（归一化空间） */
  pivotNorm: { x: number; y: number; z: number };
  /** 取景：球心（归一化空间）+ 相机半宽 */
  frameCenter: { x: number; y: number; z: number };
  half: number;
  /** 父部件在 specs 中的下标，无（挂根）为 -1 */
  parentSpecIndex: number;
}

export interface PreparedManual {
  parts: PreparedManualPart[];
  normalization: { center: { x: number; y: number; z: number }; scale: number };
  /** 根节点 joint3D（模型原点的归一化坐标） */
  rootJoint3D: { x: number; y: number; z: number };
}

export function prepareManualParts(
  statics: StaticMesh[],
  specs: ManualPartSpec[],
  partPadding = 1.25,
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

  const parts: PreparedManualPart[] = specs.map((spec, specIdx) => {
    const meshes: PreparedManualPartMesh[] = [];
    const box = new THREE.Box3();
    const worldBox = new THREE.Box3();
    for (const mi of spec.meshIndices) {
      const s = byMeshIndex.get(mi);
      if (!s) throw new Error(`手动拆分：找不到网格 ${mi}`);
      const positions = new Float32Array(s.positions.length);
      for (let i = 0; i < s.positions.length; i += 3) {
        const n = norm(s.positions[i], s.positions[i + 1], s.positions[i + 2]);
        positions[i] = n.x; positions[i + 1] = n.y; positions[i + 2] = n.z;
        tv.set(n.x, n.y, n.z);
        box.expandByPoint(tv);
        tv.set(s.positions[i], s.positions[i + 1], s.positions[i + 2]);
        worldBox.expandByPoint(tv);
      }
      meshes.push({
        positions,
        uvs: s.uvs,
        index: s.index,
        material: s.material,
        groups: s.groups,
      });
    }
    // 取景球（全部网格并集，归一化空间）
    const partSphere = box.getBoundingSphere(new THREE.Sphere());
    const half = Math.max(0.02, partSphere.radius * partPadding);
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
    // 父部件：从锚网格（枢轴网格，center/custom 时用首网格）沿场景图祖先链上溯，
    // 第一个属于其他部件的祖先网格所在的部件
    const anchorMesh =
      pivotSpec.mode === 'mesh' ? pivotSpec.meshIndex : spec.meshIndices[0];
    let parentSpecIndex = -1;
    let ancMesh = byMeshIndex.get(anchorMesh)?.info.parentMeshIndex ?? null;
    const seen = new Set<number>();
    while (ancMesh !== null && !seen.has(ancMesh)) {
      seen.add(ancMesh);
      const si = specIndexByMesh.get(ancMesh);
      if (si !== undefined && si !== specIdx) { parentSpecIndex = si; break; }
      ancMesh = byMeshIndex.get(ancMesh)?.info.parentMeshIndex ?? null;
    }
    return {
      spec,
      meshes,
      pivotNorm: norm(pivotWorld.x, pivotWorld.y, pivotWorld.z),
      frameCenter: { x: partSphere.center.x, y: partSphere.center.y, z: partSphere.center.z },
      half,
      parentSpecIndex,
    };
  });

  return {
    parts,
    normalization: { center: { x: center.x, y: center.y, z: center.z }, scale },
    rootJoint3D: norm(0, 0, 0),
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
): ProcessedBoneDirection | null {
  const W = size, H = size;
  let minX = W, maxX = -1, minY = H, maxY = -1, count = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (colorPixels[(y * W + x) * 4 + 3] > 8) {
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
      if (colorPixels[so + 3] <= 8) { crop[do_ + 3] = 0; continue; }
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
): Promise<Map<number, ProcessedBone>> {
  const size = options.size ?? 128;
  const paletteSize = options.paletteSize ?? 16;
  const toonSteps = options.toonSteps ?? 3;
  const partPadding = options.partPadding ?? 1.25;
  const onProgress = options.onProgress;
  if (specs.length === 0) throw new Error('手动拆分：至少勾选一个网格作为部件');
  if (typeof window === 'undefined') {
    throw new Error('bakeManualParts 仅支持浏览器环境(WebGL)');
  }

  const model = await loadModel(input);
  const { statics } = collectStaticMeshes(model);
  const prepared = prepareManualParts(statics, specs, partPadding);

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

    for (let pi = 0; pi < prepared.parts.length; pi++) {
      const part = prepared.parts[pi];
      const rotGroup = new THREE.Group();
      const disposables: Array<{ dispose(): void }> = [];
      for (const pm of part.meshes) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pm.positions, 3));
        if (pm.uvs) geo.setAttribute('uv', new THREE.BufferAttribute(pm.uvs, 2));
        if (pm.index) geo.setIndex(new THREE.BufferAttribute(pm.index, 1));
        geo.computeVertexNormals();
        const toonMat = Array.isArray(pm.material)
          ? pm.material.map((m) => makeToonFromSource(m, gradientMap))
          : makeToonFromSource(pm.material, gradientMap);
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
        const dir = buildDirection(colorPixels, size, ((d + 6) % 8), jx, jy, part.half, paletteSize);
        if (dir) {
          dir.latitude = lat;
          directions.push(dir);
        }
        onProgress?.(++done, total, `${part.spec.name} ${lat !== 0 ? `纬度 ${lat}° ` : ''}${d * 45}°`);
        await new Promise((r) => setTimeout(r, 0));
      }

      scene.remove(rotGroup);
      disposables.forEach((d) => d.dispose());

      result.set(pi + 1, {
        boneIndex: pi + 1,
        boneName: part.spec.name,
        parentIndex: part.parentSpecIndex >= 0 ? part.parentSpecIndex + 1 : 0,
        directions,
        joint3D: part.pivotNorm,
        bakeWidth: size,
        worldToPixels: (size / 2) / part.half,
      });
    }

    rt.dispose();
    gradientMap.dispose();
    return result;
  } finally {
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch { /* noop */ }
  }
}
