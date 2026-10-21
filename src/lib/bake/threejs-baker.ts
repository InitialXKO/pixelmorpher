// ============================================================
// PixelMorpher - three.js 烘焙器 (MVP)
// 3D 模型(glTF/GLB) → 8 方向像素精灵
// 链条: GLTFLoader 加载 → 正交相机 + 卡通材质 → 8 向离屏渲染 → 颜色量化
// 仅浏览器环境可用(WebGL)。
// ============================================================

import * as THREE from 'three';
import { loadModelScene } from './load-model';
import { makeNprFromSource } from './pmx-npr';

export interface BakeResult {
  /** 方向索引 0-7,对应角度 direction*45° */
  direction: number;
  /** RGBA 像素,行序自上而下 */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** 量化后不透明颜色数 */
  colorCount: number;
  /** 该方向耗时 ms */
  elapsedMs: number;
  /** 单肢体重烘专用：本图帧在整模归一化尺度下的等效 cameraHalf（替换回主烘焙数据时对齐尺度用） */
  cameraHalfGlobal?: number;
}

// ---- 全角度（多纬度）烘焙 ----
/** 全角度模式的额外纬度（度）：±45 各 8 方向，±90 只渲一个朝向（极点处 8 方位等价）。基纬度 0 恒有 */
export const FULL_ANGLE_LATITUDES: readonly number[] = [45, -45, 90, -90];
/** 某纬度要渲染的烘焙循环方向（0..7）；|纬度|≥90 只渲循环 0 */
export function dirsForLatitude(lat: number): number[] {
  return Math.abs(lat) >= 90 ? [0] : [0, 1, 2, 3, 4, 5, 6, 7];
}
/** 纬度 → 组俯仰角（弧度）：正纬度=自上方看（组 rotation.x=+弧度，order 'YXZ' 先俯仰后偏航） */
export function latitudePitchRad(lat: number): number {
  return (lat * Math.PI) / 180;
}

export interface BakeOptions {
  /** 全角度模式：额外纬度（度），如 [45,-45,90,-90]；基纬度 0 恒渲，|纬度|≥90 只渲一个朝向 */
  extraLatitudes?: number[];
  /** PMX 导入的贴图文件表（zip 解包：路径→Blob）；仅 PMX 输入时用 */
  pmxTextures?: Map<string, Blob>;
  /** PMX 原味着色：开时颜色遍用参考版 NPR 着色（材质按名分类套 toon ramp + rim
   *  预设，pmx-npr.ts），关（默认）时全走统一 toon 转换（共享 gradientMap，
   *  与 GLB 来源同一口径） */
  usePmxNpr?: boolean;
  /** 渲染分辨率,默认 64 */
  size?: number;
  /** 调色板颜色数,默认 16 */
  paletteSize?: number;
  /** 卡通渐变级数,默认 3 */
  toonSteps?: number;
  /**
   * 手指卷曲 0~1（仅 bakeSingleBone）：0=保持原样，1=完全握拳。
   * 按关节类型给最大角度（MCP 90°/PIP 100°/DIP 70°，拇指分开处理），再乘以该值。
   */
  fingerCurl?: number;
  /** 手动指定的拇指 bone 名（优先于自动匹配） */
  thumbBoneName?: string;
  /** 手动指定的手指 bone 名列表（优先于自动匹配） */
  fingerBoneNames?: string[];
}

const DIRECTIONS = 8;

/** 3 级(默认)卡通渐变贴图 */
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

/** 把场景内所有 Mesh 换成卡通材质(保留原贴图与基色) */
function applyToonMaterials(root: THREE.Object3D, gradientMap: THREE.Texture, usePmxNpr?: boolean): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    // SkinnedMesh 的包围盒是 bind pose 的，关掉 frustum culling 防误裁
    mesh.frustumCulled = false;
    const old = mesh.material as THREE.MeshStandardMaterial | undefined;
    const baseColor =
      old && 'color' in old && (old as THREE.MeshStandardMaterial).color
        ? ((old as THREE.MeshStandardMaterial).color as THREE.Color).clone()
        : new THREE.Color(0xffffff);
    const map =
      old && 'map' in old ? ((old as THREE.MeshStandardMaterial).map as THREE.Texture | null) : null;
    const npr = usePmxNpr ? makeNprFromSource(old ?? null) : null;
    mesh.material =
      npr ??
      new THREE.MeshToonMaterial({
        color: baseColor,
        ...(map ? { map } : {}),
        ...(old && 'side' in old && old.side !== undefined ? { side: old.side } : {}),
        gradientMap,
      });
    // 旧材质释放(贴图保留,新材质在用)
    if (old && old !== mesh.material) old.dispose();
  });
}

/** 中位切分法:把不透明像素聚成 paletteSize 个颜色 */
export function medianCut(pixels: Uint8ClampedArray, paletteSize: number): Array<[number, number, number]> {
  interface Box { colors: Array<[number, number, number]>; }
  const opaque: Array<[number, number, number]> = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 8) opaque.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  }
  if (opaque.length === 0) return [];

  let boxes: Box[] = [{ colors: opaque }];
  while (boxes.length < paletteSize) {
    // 找颜色范围最大的盒子
    let bestIdx = -1;
    let bestRange = -1;
    let bestChannel = 0;
    for (let b = 0; b < boxes.length; b++) {
      const cs = boxes[b].colors;
      if (cs.length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        let mn = 255; let mx = 0;
        for (const c of cs) { if (c[ch] < mn) mn = c[ch]; if (c[ch] > mx) mx = c[ch]; }
        const range = mx - mn;
        if (range > bestRange) { bestRange = range; bestIdx = b; bestChannel = ch; }
      }
    }
    if (bestIdx < 0 || bestRange <= 0) break;
    const box = boxes[bestIdx];
    box.colors.sort((a, b2) => a[bestChannel] - b2[bestChannel]);
    const mid = Math.floor(box.colors.length / 2);
    const left = box.colors.slice(0, mid);
    const right = box.colors.slice(mid);
    if (left.length === 0 || right.length === 0) break;
    boxes[bestIdx] = { colors: left };
    boxes.push({ colors: right });
  }
  return boxes.map((box) => {
    const cs = box.colors;
    let r = 0; let g = 0; let b = 0;
    for (const c of cs) { r += c[0]; g += c[1]; b += c[2]; }
    const n = cs.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)] as [number, number, number];
  });
}

export function nearestPaletteIndex(
  r: number, g: number, b: number,
  palette: Array<[number, number, number]>,
): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = r - p[0]; const dg = g - p[1]; const db = b - p[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * 烘焙 3D 模型为 8 方向像素精灵。
 * @param input glTF/GLB 的 URL,或 ArrayBuffer(.glb)
 */
export async function bakeModelToSprites(
  input: string | ArrayBuffer,
  options: BakeOptions = {},
): Promise<BakeResult[]> {
  const size = options.size ?? 64;
  const paletteSize = options.paletteSize ?? 16;
  const toonSteps = options.toonSteps ?? 3;

  if (typeof window === 'undefined') {
    throw new Error('bakeModelToSprites 仅支持浏览器环境(WebGL)');
  }

  const t0 = performance.now();
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setClearColor(0x000000, 0);

  try {
    // ---- 加载 ----
    const model = await loadModelScene(input, options.pmxTextures);

    let meshCount = 0;
    let skinnedCount = 0;
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshCount++;
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
        skinnedCount++;
        // 确保骨骼矩阵更新（静态 T-pose 也要刷一次）
        (o as THREE.SkinnedMesh).skeleton.update();
      }
    });
    if (meshCount === 0) throw new Error('模型中没有找到 Mesh');

    // ---- 归一化:居中 + 缩放到包围球直径 2 ----
    const bbox = new THREE.Box3().setFromObject(model);
    const center = bbox.getCenter(new THREE.Vector3());
    const sphere = bbox.getBoundingSphere(new THREE.Sphere());
    const group = new THREE.Group();
    // 先把模型移到组里,再整体位移/缩放
    group.add(model);
    model.position.sub(center);
    const scale = sphere.radius > 1e-6 ? 1 / sphere.radius : 1;
    group.scale.setScalar(scale);

    // ---- 卡通材质 + 灯光 ----
    const gradientMap = makeGradientMap(toonSteps);
    applyToonMaterials(group, gradientMap, options.usePmxNpr);
    const scene = new THREE.Scene();
    scene.add(group);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
    dirLight.position.set(2, 3, 4);
    scene.add(dirLight);

    // ---- 正交相机(轻微俯视) ----
    const frustum = 1.25;
    const camera = new THREE.OrthographicCamera(
      -frustum, frustum, frustum, -frustum, 0.1, 20,
    );
    camera.position.set(0, 1.1, 4);
    camera.lookAt(0, 0, 0);

    // ---- 离屏渲染目标 ----
    const rt = new THREE.WebGLRenderTarget(size, size, { samples: 0, depthBuffer: true });
    const readBuffer = new Uint8Array(size * size * 4);

    const results: BakeResult[] = [];
    for (let d = 0; d < DIRECTIONS; d++) {
      const dt0 = performance.now();
      group.rotation.y = (d / DIRECTIONS) * Math.PI * 2;

      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, readBuffer);
      renderer.setRenderTarget(null);

      // readRenderTargetPixels 是 bottom-up,翻转成 top-down
      const flipped = new Uint8ClampedArray(size * size * 4);
      const rowBytes = size * 4;
      for (let y = 0; y < size; y++) {
        const srcY = size - 1 - y;
        flipped.set(readBuffer.subarray(srcY * rowBytes, srcY * rowBytes + rowBytes), y * rowBytes);
      }

      // ---- 颜色量化(中位切分) ----
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
        direction: ((d + 6) % 8),
        pixels: flipped,
        width: size,
        height: size,
        colorCount: colorSet.size,
        elapsedMs: performance.now() - dt0,
      });
    }

    // ---- 清理 ----
    rt.dispose();
    gradientMap.dispose();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const m = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });

    void t0;
    return results;
  } finally {
    renderer.dispose();
    // 释放 GL 上下文,避免多开泄漏
    try { renderer.forceContextLoss(); } catch { /* noop */ }
  }
}
