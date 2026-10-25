// ============================================================
// PMX/GLB 场景 → Live2D 模型构建（2026-10-25）
// 与 3Dto2Dshape 的 build.ts 同分工：拆分（按部件×材质分组三角形）→
// 中立姿态投影几何 → 隔离贴图（渲染注入，构建器本身不碰 WebGL）→
// 骨骼姿态采样关键形族（头 AngleX/AngleY、上半身 BodyAngleX）→
// 组装 Live2dModel，交给 moc3.ts 的 buildMoc3/buildMoc3Archive 导出。
//
// v1 范围与边界（诚实口径）：
// - 参数只含骨骼可驱动的三族；眼睛/嘴的表情参数依赖 PMX morph，
//   本管线的 PMX 场景未接 morphAttributes，暂不生成（不会假造）。
// - 非蒙皮刚性网格（道具等）vertBone 为 -1，暂归 torso 组。
// - 绘制顺序按中立姿态的深度中位数（远→近），无动态顺序关键形。
// ============================================================

import * as THREE from 'three';
import { analyzeTopology, type TopoBone } from '../bake/bone-topology';
import {
  assignBoneToPart,
  bakeSkinnedMesh,
  computeBoneWeightSums,
  droopArmPose,
  makeGradientMap,
  makeToonFromSource,
  type PartName,
} from '../bake/threejs-baker-sixpart';
import type { Live2dDrawable, Live2dModel } from './model';
import type { FamilyKeyforms } from './keyforms';
import type { FaceParamId } from './types';
import { buildMoc3, packTextureAtlas } from './moc3';
import { createZip, type ZipEntry } from './zip';

type BakedMesh = ReturnType<typeof bakeSkinnedMesh>;

/** 隔离渲染请求：构建器给出几何（模型空间）+ 材质 + 投影矩阵，注入方回整视口 RGBA（top-down 行序） */
export interface Live2dRenderRequest {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** 模型空间 → 视口像素空间（x 右、y 下、原点左上） */
  groupMatrix: THREE.Matrix4;
  viewport: { width: number; height: number };
}
export type Live2dRenderFn = (
  req: Live2dRenderRequest,
) => { rgba: Uint8Array; width: number; height: number } | null;

export interface BuildLive2dOptions {
  modelName: string;
  /** 视口边长（正方形画布），默认 1024 */
  viewportSize?: number;
  usePmxNpr?: boolean;
  renderDrawable: Live2dRenderFn;
  onProgress?: (msg: string) => void;
}

interface DrawableWork {
  id: string;
  label: string;
  meshIndex: number;
  part: PartName;
  materialIndex: number;
  sourceMaterial: THREE.Material | null;
  /** 本图元三角形（源网格原始顶点索引，每 3 个一组） */
  tris: number[];
  compact: number[]; // compact 顶点 → 源顶点索引
  neutral: Float32Array; // compact 顶点的视口像素坐标 xy
  medianZ: number;
}

const PART_LABEL: Record<PartName, string> = {
  head: '头', torso: '躯干', armL: '左臂', armR: '右臂', legL: '左腿', legR: '右腿',
  tail: '尾', props: '道具',
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** 浏览器 PNG 编码（canvas），供 buildMoc3Archive 的 encodePng 注入 */
export async function encodePngWithCanvas(texture: { width: number; height: number; rgba: Uint8Array }): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = texture.width;
  canvas.height = texture.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 不可用，无法编码 PNG');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(texture.rgba), texture.width, texture.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 编码失败');
  return new Uint8Array(await blob.arrayBuffer());
}

// ---- 浏览器端隔离渲染（WebGL）：单图元渲染到整视口，行序翻成 top-down ----
let sharedRenderer: THREE.WebGLRenderer | null = null;
export function renderDrawableWebGL(req: Live2dRenderRequest): { rgba: Uint8Array; width: number; height: number } {
  const { width: V, height: H } = req.viewport;
  if (!sharedRenderer) {
    sharedRenderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  }
  const renderer = sharedRenderer;
  renderer.setSize(V, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.matrix.copy(req.groupMatrix);
  const mesh = new THREE.Mesh(req.geometry, req.material);
  mesh.frustumCulled = false;
  group.add(mesh);
  scene.add(group);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
  dirLight.position.set(2, 3, 4);
  scene.add(dirLight);
  // 视口像素空间：x 右、y 下（groupMatrix 已含 y 翻转），相机沿 -Z 看
  const camera = new THREE.OrthographicCamera(0, V, 0, H, 0.1, 4000);
  camera.position.set(0, 0, 2000);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const raw = new Uint8Array(V * H * 4);
  gl.readPixels(0, 0, V, H, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  // GL 行序自下而上 → 翻成 top-down
  const rgba = new Uint8Array(V * H * 4);
  const rowBytes = V * 4;
  for (let y = 0; y < H; y++) {
    rgba.set(raw.subarray((H - 1 - y) * rowBytes, (H - y) * rowBytes), y * rowBytes);
  }
  req.material.dispose();
  return { rgba, width: V, height: H };
}

/**
 * 组装可导入 Cubism/VTube Studio 的 zip（与 moc3.ts 的 buildMoc3Archive
 * 同布局，但 PNG 编码走 canvas 异步路径）：文件夹/ model.moc3 +
 * texture_00.png + <名>.model3.json。
 */
export async function buildLive2dArchive(model: Live2dModel): Promise<Uint8Array> {
  const atlasWidth = Math.min(8192, 2048 * (model.textureScale ?? 1));
  const packed = packTextureAtlas(model, atlasWidth);
  const modelWithAtlasUvs: Live2dModel = {
    ...model,
    drawables: model.drawables.map((drawable, index) => ({
      ...drawable,
      uvs: packed.uvs[index],
    })),
  };
  const { moc3 } = buildMoc3(modelWithAtlasUvs);
  const png = await encodePngWithCanvas(packed.atlas);
  const safeName =
    model.modelName.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'model';
  const manifest = {
    Version: 3,
    Name: model.modelName,
    FileReferences: {
      Moc: 'model.moc3',
      Textures: ['texture_00.png'],
    },
    Groups: [],
    HitAreas: [],
  };
  const entries: ZipEntry[] = [
    { name: `${safeName}/model.moc3`, data: moc3 },
    { name: `${safeName}/texture_00.png`, data: png },
    {
      name: `${safeName}/${safeName}.model3.json`,
      data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    },
  ];
  return createZip(entries);
}

export function buildLive2dModel(
  model: THREE.Object3D,
  options: BuildLive2dOptions,
): Live2dModel {
  const V = options.viewportSize ?? 1024;
  const onProgress = options.onProgress ?? (() => undefined);
  model.updateMatrixWorld(true);

  // ---- 骨骼与部件归属（与六部件烘焙同一口径） ----
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
  const bindPos = bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
  const weightSums = computeBoneWeightSums(model, bones, indexByBone);
  const topoBones: TopoBone[] = bones.map((b, i) => ({
    index: i,
    name: b.name || `bone_${i}`,
    parentIndex: parentIndex[i],
    worldPos: { x: bindPos[i].x, y: bindPos[i].y, z: bindPos[i].z },
    weightSum: weightSums[i],
  }));
  const topology = analyzeTopology(topoBones);
  const boneToPart: (PartName | null)[] = topology.cross !== null
    ? topology.boneToPart
    : bones.map((b, i) => assignBoneToPart(b.name || '', bindPos[i].x));
  const partOf = (gi: number): PartName => (gi >= 0 ? boneToPart[gi] : null) ?? 'torso';

  // ---- 手臂下垂（与六部件一致，Live2D 中立姿态不用 T 姿势） ----
  if (topology.cross !== null) {
    let anyDroop = false;
    for (const ap of ['armL', 'armR'] as const) {
      let shoulderIdx: number | null = null;
      for (let i = 0; i < parentIndex.length; i++) {
        if (boneToPart[i] !== ap) continue;
        const p = parentIndex[i];
        if (p === null || boneToPart[p] !== ap) { shoulderIdx = i; break; }
      }
      const handIdx = ap === 'armL' ? topology.handL : topology.handR;
      if (shoulderIdx === null || handIdx === null) continue;
      if (droopArmPose(bones, ap, shoulderIdx, handIdx, bindPos).rotated) anyDroop = true;
    }
    if (anyDroop) {
      model.updateMatrixWorld(true);
      for (let bi = 0; bi < bones.length; bi++) bones[bi].getWorldPosition(bindPos[bi]);
    }
  }

  // ---- 中立姿态静态烘焙 ----
  const meshes: THREE.Mesh[] = [];
  model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) meshes.push(m); });
  const bakeAll = (): BakedMesh[] => {
    model.updateMatrixWorld(true);
    for (const m of meshes) {
      const sm = m as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) sm.skeleton.update();
    }
    return meshes.map((m) => bakeSkinnedMesh(m, bones, indexByBone));
  };
  const baked = bakeAll();

  // ---- 全局投影（模型 bbox → 视口像素，y 翻转） ----
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const bm of baked) {
    const pos = bm.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const halfExtent = Math.max(maxX - minX, maxY - minY) / 2 || 1;
  const s = (V / 2) * 0.94 / halfExtent;
  const project = (x: number, y: number): [number, number] => [V / 2 + (x - cx) * s, V / 2 - (y - cy) * s];
  const groupMatrix = new THREE.Matrix4().set(
    s, 0, 0, V / 2 - cx * s,
    0, -s, 0, V / 2 + cy * s,
    0, 0, s, 0,
    0, 0, 0, 1,
  );

  // ---- 拆分：按（网格 × 材质组 × 部件）分组三角形 ----
  onProgress('拆分图元…');
  const works = new Map<string, DrawableWork & { triSet: number[] }>();
  meshes.forEach((mesh, mi) => {
    const bm = baked[mi];
    const geo = mesh.geometry;
    const index = geo.getIndex();
    const triCount = index ? Math.floor(index.count / 3) : Math.floor((geo.getAttribute('position')?.count ?? 0) / 3);
    const groups = geo.groups.length > 0
      ? geo.groups
      : [{ start: 0, count: triCount * 3, materialIndex: 0 }];
    const vertAt = (k: number) => (index ? index.getX(k) : k);
    for (const g of groups) {
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      const sourceMaterial = materials[g.materialIndex ?? 0] ?? materials[0] ?? null;
      const gEnd = Math.min(g.start + g.count, triCount * 3);
      for (let k = g.start; k + 2 < gEnd; k += 3) {
        const a = vertAt(k), b = vertAt(k + 1), c = vertAt(k + 2);
        // 主导骨骼：3 顶点 vertBone 多数（全 -1 时归 torso）
        const cand = [bm.vertBone[a] ?? -1, bm.vertBone[b] ?? -1, bm.vertBone[c] ?? -1].filter((v) => v >= 0);
        const dom = cand.length > 0 ? cand.sort((x, y) => cand.filter((v) => v === y).length - cand.filter((v) => v === x).length)[0] : -1;
        const part = partOf(dom);
        const key = `${mi}|${g.materialIndex ?? 0}|${part}`;
        let w = works.get(key);
        if (!w) {
          w = {
            id: `m${mi}_mat${g.materialIndex ?? 0}_${part}`,
            label: `${PART_LABEL[part]}·${sourceMaterial?.name || `材质${(g.materialIndex ?? 0) + 1}`}`,
            meshIndex: mi,
            part,
            materialIndex: g.materialIndex ?? 0,
            sourceMaterial,
            tris: [], triSet: [], compact: [], neutral: new Float32Array(0), medianZ: 0,
          };
          works.set(key, w);
        }
        w.triSet.push(a, b, c);
      }
    }
  });

  // 紧凑顶点表 + 中立坐标 + 深度中位数
  const workList = [...works.values()].filter((w) => w.triSet.length > 0);
  for (const w of workList) {
    const bm = baked[w.meshIndex];
    const pos = bm.geometry.getAttribute('position') as THREE.BufferAttribute;
    const remap = new Map<number, number>();
    const tris: number[] = [];
    const zs: number[] = [];
    for (const orig of w.triSet) {
      let ci = remap.get(orig);
      if (ci === undefined) {
        ci = remap.size;
        remap.set(orig, ci);
        w.compact.push(orig);
        zs.push(pos.getZ(orig));
      }
      tris.push(ci);
    }
    w.tris = tris;
    w.medianZ = median(zs);
    const neutral = new Float32Array(w.compact.length * 2);
    w.compact.forEach((orig, ci) => {
      const [px, py] = project(pos.getX(orig), pos.getY(orig));
      neutral[ci * 2] = px;
      neutral[ci * 2 + 1] = py;
    });
    w.neutral = neutral;
  }
  // 远→近排序 = 绘制顺序
  workList.sort((a, b) => a.medianZ - b.medianZ);

  // ---- 隔离贴图（注入渲染）+ UV（裁剪窗归一） ----
  onProgress('烘焙图元贴图…');
  const gradientMap = makeGradientMap(3);
  const drawables: Live2dDrawable[] = [];
  for (let di = 0; di < workList.length; di++) {
    const w = workList[di];
    const bm = baked[w.meshIndex];
    // 渲染几何：源几何的位置/uv + 本图元三角形（原始索引）
    const renderGeo = new THREE.BufferGeometry();
    renderGeo.setAttribute('position', bm.geometry.getAttribute('position'));
    const uvAttr = bm.geometry.getAttribute('uv');
    if (uvAttr) renderGeo.setAttribute('uv', uvAttr);
    const renderIndex = new Uint32Array(w.triSet);
    renderGeo.setIndex(new THREE.BufferAttribute(renderIndex, 1));
    const material = makeToonFromSource(w.sourceMaterial, gradientMap, options.usePmxNpr);
    const rendered = options.renderDrawable({
      geometry: renderGeo,
      material,
      groupMatrix,
      viewport: { width: V, height: V },
    });
    // 裁剪窗 = 中立坐标 bbox + 4px
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < w.compact.length; i++) {
      const px = w.neutral[i * 2], py = w.neutral[i * 2 + 1];
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    const cropX = Math.max(0, Math.floor(x0) - 4);
    const cropY = Math.max(0, Math.floor(y0) - 4);
    const cropW = Math.max(1, Math.min(V, Math.ceil(x1) + 4) - cropX);
    const cropH = Math.max(1, Math.min(V, Math.ceil(y1) + 4) - cropY);
    let texture: Live2dDrawable['texture'];
    if (rendered) {
      const rgba = new Uint8Array(cropW * cropH * 4);
      for (let y = 0; y < cropH; y++) {
        const srcRow = (cropY + y) * rendered.width + cropX;
        rgba.set(rendered.rgba.subarray(srcRow * 4, (srcRow + cropW) * 4), y * cropW * 4);
      }
      texture = { width: cropW, height: cropH, rgba };
    } else {
      texture = { width: 1, height: 1, rgba: new Uint8Array(4) };
    }
    const uvs = new Float32Array(w.compact.length * 2);
    for (let i = 0; i < w.compact.length; i++) {
      uvs[i * 2] = (w.neutral[i * 2] - cropX) / cropW;
      uvs[i * 2 + 1] = 1 - (w.neutral[i * 2 + 1] - cropY) / cropH;
    }
    drawables.push({
      id: w.id,
      label: w.label,
      meshId: w.id,
      leafIds: [w.id],
      vertexCount: w.compact.length,
      triangleCount: w.tris.length / 3,
      triangles: new Uint32Array(w.tris),
      meshVertexIndices: new Uint32Array(w.compact),
      neutralPositions: w.neutral,
      uvs,
      texture,
      renderOrder: di,
    });
  }

  // ---- 骨骼姿态采样 → 关键形族 ----
  onProgress('采样姿态关键形…');
  const totalVerts = workList.reduce((acc, w) => acc + w.compact.length, 0);
  const drawableOffsets: number[] = [];
  {
    let cur = 0;
    for (const w of workList) { drawableOffsets.push(cur); cur += w.compact.length * 2; }
  }
  const samplePositions = (bakedPose: BakedMesh[]): Float32Array => {
    const out = new Float32Array(totalVerts * 2);
    workList.forEach((w, wi) => {
      const pos = bakedPose[w.meshIndex].geometry.getAttribute('position') as THREE.BufferAttribute;
      const off = drawableOffsets[wi];
      w.compact.forEach((orig, ci) => {
        const [px, py] = project(pos.getX(orig), pos.getY(orig));
        out[off + ci * 2] = px;
        out[off + ci * 2 + 1] = py;
      });
    });
    return out;
  };
  const neutralFlat = samplePositions(baked);
  const findBone = (names: string[]): THREE.Bone | null => {
    for (const n of names) {
      const hit = bones.find((b) => b.name === n);
      if (hit) return hit;
    }
    return null;
  };
  const headBone = findBone(['頭']) ?? (topology.headRoot !== null ? bones[topology.headRoot] : null);
  const bodyBone = findBone(['上半身', '上半身2']);

  interface FamilySpec {
    id: FaceParamId; label: string; min: number; max: number; values: number[];
    bone: THREE.Bone | null;
    euler: (v: number) => THREE.Euler;
  }
  const specs: FamilySpec[] = [
    {
      id: 'ParamAngleX', label: '角度 X', min: -30, max: 30, values: [-30, 0, 30],
      bone: headBone, euler: (v) => new THREE.Euler(0, THREE.MathUtils.degToRad(v), 0),
    },
    {
      id: 'ParamAngleY', label: '角度 Y', min: -30, max: 30, values: [-30, 0, 30],
      bone: headBone, euler: (v) => new THREE.Euler(THREE.MathUtils.degToRad(v), 0, 0),
    },
    {
      id: 'ParamBodyAngleX', label: '身体角度 X', min: -10, max: 10, values: [-10, 0, 10],
      bone: bodyBone, euler: (v) => new THREE.Euler(0, THREE.MathUtils.degToRad(v), 0),
    },
  ];
  const params: Live2dModel['params'] = [];
  const families: Record<string, FamilyKeyforms> = {};
  for (const spec of specs) {
    if (!spec.bone) continue;
    const saved = spec.bone.quaternion.clone();
    const displacements: Float32Array[] = [];
    let maxDisp = 0;
    for (const v of spec.values) {
      spec.bone.quaternion.setFromEuler(spec.euler(v));
      const poseFlat = samplePositions(bakeAll());
      const disp = new Float32Array(totalVerts * 2);
      for (let i = 0; i < disp.length; i++) {
        disp[i] = poseFlat[i] - neutralFlat[i];
        if (Math.abs(disp[i]) > maxDisp) maxDisp = Math.abs(disp[i]);
      }
      displacements.push(disp);
    }
    spec.bone.quaternion.copy(saved);
    model.updateMatrixWorld(true);
    if (maxDisp < 0.5) continue; // 该参数驱动不了任何顶点，不生成（不假造）
    params.push({ id: spec.id, label: spec.label, min: spec.min, max: spec.max, default: 0 });
    families[spec.id] = { family: spec.id, default: 0, values: spec.values, displacements };
  }

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    modelName: options.modelName,
    viewport: { width: V, height: V },
    params,
    drawables,
    families,
    depthFamilies: {},
    neutralDepths: workList.map((w) => w.medianZ),
    order: drawables.map((d) => d.id),
    errorReport: { comboCount: 0, meanErrorPx: 0, maxErrorPx: 0, perCombo: [], worstDrawable: null },
    orderReport: { flips: [], samplesChecked: 0 },
  };
}
