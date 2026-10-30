// ============================================================
// PixelMorpher - Canvas Modifiers
// applyCanvasModifiers and all canvas-level modifier implementations
// ============================================================

import type {
  CanvasModifierTrack,
  CanvasModifierInstance,
  CanvasModifierType,
  CanvasModifierKeyframe,
  getCanvasModifierDef,
  ModifierParamValue,
} from '../types';
import { hexToRgb, darkenColor, lightenColor } from './color-utils';
import { acquireCanvas, releaseCanvas } from './canvas-pool';
import { boxBlurAlpha } from './effect-render';

// ============================================================
// V2.4: Canvas Modifier System
// ============================================================

/**
 * 数值参数读法（与运行时 fx 的 n() 同口径）：仅当参数缺失或非有限时
 * 才回缺省——0 是有效值，不许被缺省顶替（旧 `Number(p) || 缺省` 在
 * bloom 阈值/强度、扫描线透明度等处把 0 顶替掉，与运行时表现不一致）。
 */
function numParam(value: ModifierParamValue | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Get resolved params for a canvas modifier at the current frame,
 * interpolating between keyframes if necessary.
 *
 * 区间外保持端点帧（首帧之前取首关键帧、末帧之后取末关键帧）；
 * 旧实现首帧之前 prevKf 与 nextKf 是同一键、t = 负数/0 = -Infinity，
 * 数值参数算出 NaN 后污染整帧（LUT 出黑影、描边光角 NaN）。
 * 与运行时 fxResolveCanvasParams 同口径。
 */
export function resolveCanvasModifierParams(
  track: CanvasModifierTrack,
  modifier: CanvasModifierInstance,
  currentFrame: number,
): Record<string, ModifierParamValue> {
  const kfs = [...track.keyframes].sort((a, b) => a.frame - b.frame);
  if (kfs.length === 0) return modifier.params;

  const first = kfs[0];
  const last = kfs[kfs.length - 1];
  if (currentFrame <= first.frame) return { ...modifier.params, ...first.params };
  if (currentFrame >= last.frame) return { ...modifier.params, ...last.params };

  // Find surrounding keyframes（此处必有 nextKf：currentFrame < last.frame）
  let prevKf = first;
  let nextKf: typeof kfs[0] | null = null;
  for (const kf of kfs) {
    if (kf.frame <= currentFrame) prevKf = kf;
    if (kf.frame > currentFrame && !nextKf) nextKf = kf;
  }
  if (!nextKf) return { ...modifier.params, ...prevKf.params };

  // Interpolate numeric params（t 钳 [0,1] 并防非有限）
  let t = (currentFrame - prevKf.frame) / (nextKf.frame - prevKf.frame);
  if (!Number.isFinite(t)) t = 0;
  t = Math.min(1, Math.max(0, t));
  const result: Record<string, ModifierParamValue> = { ...modifier.params };
  for (const key of Object.keys(prevKf.params)) {
    const prevVal = prevKf.params[key];
    const nextVal = nextKf.params[key];
    if (typeof prevVal === 'number' && typeof nextVal === 'number') {
      const v = prevVal + (nextVal - prevVal) * t;
      result[key] = Number.isFinite(v) ? v : (Number.isFinite(prevVal) ? prevVal : nextVal);
    } else {
      // For non-numeric, use prev if t < 0.5, next otherwise
      result[key] = t < 0.5 ? prevVal : nextVal;
    }
  }
  return result;
}

/**
 * Apply outline emphasis canvas modifier using silhouette-dilation.
 *
 * Construction（与运行时 uEffect==6 同构）：轮廓 S = alpha>0 的像素集。
 * 对每个不在 S 中的像素 p，求其最近轮廓像素 n(p)；描边带 =
 * { p ∉ S 且 dist(p, n(p)) ≤ thickness }。距离按 directions 选度量：
 * '8' = 欧氏（圆盘）、'4' = 曼哈顿（菱形）——旧实现里该参数是盖印的
 * 射线方向集（4/8 条射线），现重新解释为膨胀度量，带的形状随之而变。
 *
 * 源像素以实心度量球盖印、每像素保留距离最小的候选（同距按源扫描序
 * 先到先得，确定性），由此得 n(p)。取色一律来自 n(p)：实色 = 描边色；
 * 变暗 = n(p) 逐通道 −80；渐变 = 外向向量 (p−n(p))/|p−n(p)| 与光向
 * 点积映射到 dark（描边色 ×0.3）/light（向白 0.5）两变体间插值。
 * 描边 alpha = n(p) 的 alpha。
 *
 * 合成只作用于带内（带外与轮廓内部逐值不变）：以当前像素为底、混合
 * 结果为源色，按描边 alpha 做 source-over；普通模式即源色 = 描边色。
 * 不再用整层 globalCompositeOperation 盖全图（旧构造描边层被内部盖印
 * 填满，混合会染整个精灵内部）。
 *
 * Parameters:
 * - thickness (1-5): 带宽（按所选度量取整级数）
 * - color (hex): Outline color
 * - directions ('4' | '8'): 膨胀度量（'4' 曼哈顿菱形 / '8' 欧氏圆盘）
 * - outlineMode ('solid' | 'darken' | 'gradient'): How to color the outline
 * - blendMode ('normal' | 'overlay' | 'multiply' | 'screen'): How to blend
 * - edgesOnly (boolean): 源只取与透明相邻（或出界）的轮廓像素
 */
function applyOutlineEmphasis(
  ctx: CanvasRenderingContext2D,
  modifier: CanvasModifierInstance,
  params: Record<string, ModifierParamValue>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const thickness = numParam(params.thickness, 1);
  const color = String(params.color) || '#000000';
  const euclid = String(params.directions) !== '4';
  const outlineMode = String(params.outlineMode) || 'solid';
  const blendMode = String(params.blendMode) || 'normal';
  const edgesOnly = Boolean(params.edgesOnly);
  const lightAngle = numParam(params.lightAngle, 315);

  // Read current canvas content
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const src = imageData.data;

  // Parse outline color + gradient variants（生成口径沿用 color-utils）
  const [outlineR, outlineG, outlineB] = hexToRgb(color);
  const [darkR, darkG, darkB] = hexToRgb(darkenColor(color, 0.3));
  const [lightR, lightG, lightB] = hexToRgb(lightenColor(color, 0.5));

  // Light direction（0° = right, 90° = down, 180° = left, 270° = up）
  const lightRad = (lightAngle * Math.PI) / 180;
  const ldx = Math.cos(lightRad);
  const ldy = Math.sin(lightRad);

  const pixelCount = canvasWidth * canvasHeight;
  // 带宽取整级数（与运行时 floor(uP0.x) 同口径）
  const R = Math.max(1, Math.floor(thickness));

  // 度量球内的全部整数偏移（不含原点）：'8' 取欧氏平方距离、'4' 取曼哈顿
  const offsets: { dx: number; dy: number; d: number }[] = [];
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (euclid) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= R * R) offsets.push({ dx, dy, d: d2 });
      } else {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d <= R) offsets.push({ dx, dy, d });
      }
    }
  }

  // n(p)：bestSrc = 最近轮廓像素下标，bestDist = 其度量距离（无候选为 -1）
  const bestDist = new Int32Array(pixelCount).fill(-1);
  const bestSrc = new Int32Array(pixelCount).fill(-1);

  // 源按扫描序遍历：同距先到先得（仅严格更小才替换），与运行时着色器
  // 按 (dy, dx) 升序遍历偏移的确定性口径一致。
  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const sIdx = y * canvasWidth + x;
      if (src[sIdx * 4 + 3] === 0) continue; // 不在轮廓 S 中

      if (edgesOnly) {
        // 源门控（意图沿用旧实现）：4 邻域有透明或出界才算边缘源
        const isEdge =
          y === 0 || src[((y - 1) * canvasWidth + x) * 4 + 3] === 0 ||
          y === canvasHeight - 1 || src[((y + 1) * canvasWidth + x) * 4 + 3] === 0 ||
          x === 0 || src[(y * canvasWidth + (x - 1)) * 4 + 3] === 0 ||
          x === canvasWidth - 1 || src[(y * canvasWidth + (x + 1)) * 4 + 3] === 0;
        if (!isEdge) continue;
      }

      for (const { dx, dy, d } of offsets) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || px >= canvasWidth || py < 0 || py >= canvasHeight) continue;
        const tIdx = py * canvasWidth + px;
        if (src[tIdx * 4 + 3] !== 0) continue; // 带只在轮廓外
        if (bestSrc[tIdx] === -1 || d < bestDist[tIdx]) {
          bestDist[tIdx] = d;
          bestSrc[tIdx] = sIdx;
        }
      }
    }
  }

  // 合成：只写带内像素
  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const tIdx = y * canvasWidth + x;
      const nIdx = bestSrc[tIdx];
      if (nIdx === -1) continue;

      const ni = nIdx * 4;
      const sa = src[ni + 3] / 255; // 描边 alpha = n(p) 的 alpha

      // 取色（来自 n(p)）
      let ocr: number, ocg: number, ocb: number;
      switch (outlineMode) {
        case 'darken': {
          ocr = Math.max(0, src[ni] - 80);
          ocg = Math.max(0, src[ni + 1] - 80);
          ocb = Math.max(0, src[ni + 2] - 80);
          break;
        }
        case 'gradient': {
          // 外向向量 (p − n(p)) 按欧氏长度归一（与度量选择无关）
          const vx = x - (nIdx % canvasWidth);
          const vy = y - Math.floor(nIdx / canvasWidth);
          const len = Math.sqrt(vx * vx + vy * vy) || 1;
          const t = ((vx / len) * ldx + (vy / len) * ldy + 1) / 2;
          ocr = Math.round(darkR + (lightR - darkR) * t);
          ocg = Math.round(darkG + (lightG - darkG) * t);
          ocb = Math.round(darkB + (lightB - darkB) * t);
          break;
        }
        case 'solid':
        default: {
          ocr = outlineR; ocg = outlineG; ocb = outlineB;
          break;
        }
      }

      // 混合（标准公式，0..255 浮点）后以描边 alpha 做 source-over
      const ti = tIdx * 4;
      const br = src[ti], bg = src[ti + 1], bb = src[ti + 2];
      const ba = src[ti + 3] / 255;
      let blr = ocr, blg = ocg, blb = ocb;
      if (blendMode === 'multiply') {
        blr = (br * ocr) / 255; blg = (bg * ocg) / 255; blb = (bb * ocb) / 255;
      } else if (blendMode === 'screen') {
        blr = 255 - ((255 - br) * (255 - ocr)) / 255;
        blg = 255 - ((255 - bg) * (255 - ocg)) / 255;
        blb = 255 - ((255 - bb) * (255 - ocb)) / 255;
      } else if (blendMode === 'overlay') {
        const ov = (b: number, o: number) => (b < 128 ? (2 * b * o) / 255 : 255 - (2 * (255 - b) * (255 - o)) / 255);
        blr = ov(br, ocr); blg = ov(bg, ocg); blb = ov(bb, ocb);
      }
      const outA = sa + ba * (1 - sa);
      if (outA <= 0) continue;
      src[ti] = Math.round((blr * sa + br * ba * (1 - sa)) / outA);
      src[ti + 1] = Math.round((blg * sa + bg * ba * (1 - sa)) / outA);
      src[ti + 2] = Math.round((blb * sa + bb * ba * (1 - sa)) / outA);
      src[ti + 3] = Math.round(outA * 255);
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Apply color LUT canvas modifier.
 */
function applyColorLut(
  ctx: CanvasRenderingContext2D,
  modifier: CanvasModifierInstance,
  params: Record<string, ModifierParamValue>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const preset = String(params.preset) || 'none';
  const intensity = numParam(params.intensity, 1);

  if (preset === 'none' || intensity === 0) return;

  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;

    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    let nr = r, ng = g, nb = b;

    switch (preset) {
      case 'retro': {
        // Reduce palette + warm yellow tint
        nr = Math.min(255, Math.round(r / 32) * 32 + 20);
        ng = Math.min(255, Math.round(g / 32) * 32 + 10);
        nb = Math.round(b / 48) * 48;
        break;
      }
      case 'monochrome': {
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        nr = gray;
        ng = gray;
        nb = gray;
        break;
      }
      case 'nightvision': {
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const boosted = Math.min(1, lum * 1.5);
        nr = Math.round(boosted * 50);
        ng = Math.round(boosted * 255);
        nb = Math.round(boosted * 50);
        break;
      }
      case 'warm': {
        nr = Math.min(255, r + 25);
        ng = g + 5;
        nb = Math.max(0, b - 15);
        break;
      }
      case 'cool': {
        nr = Math.max(0, r - 15);
        ng = g + 5;
        nb = Math.min(255, b + 25);
        break;
      }
      case 'invert': {
        nr = 255 - r;
        ng = 255 - g;
        nb = 255 - b;
        break;
      }
    }

    // Mix based on intensity
    data[i] = Math.round(r + (nr - r) * intensity);
    data[i + 1] = Math.round(g + (ng - g) * intensity);
    data[i + 2] = Math.round(b + (nb - b) * intensity);
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Apply pixel zoom canvas modifier.
 */
function applyPixelZoom(
  ctx: CanvasRenderingContext2D,
  modifier: CanvasModifierInstance,
  params: Record<string, ModifierParamValue>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const scale = numParam(params.scale, 1);
  const antiAlias = Boolean(params.antiAlias);

  if (scale === 1) return;

  // Get current canvas content
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = canvasWidth;
  srcCanvas.height = canvasHeight;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.drawImage(ctx.canvas, 0, 0);

  // Clear and redraw scaled
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const scaledW = canvasWidth * scale;
  const scaledH = canvasHeight * scale;

  ctx.save();
  ctx.imageSmoothingEnabled = antiAlias;

  // Center the result
  const offsetX = (canvasWidth - scaledW) / 2;
  const offsetY = (canvasHeight - scaledH) / 2;

  if (scale > 1) {
    // Scale up: pixel-sharp (nearest neighbor)
    ctx.imageSmoothingEnabled = false;

    // Draw scaled source to temp canvas first
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = scaledW;
    tempCanvas.height = scaledH;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.imageSmoothingEnabled = false;
    tempCtx.drawImage(srcCanvas, 0, 0, scaledW, scaledH);

    // Clip to canvas bounds and center
    const srcX = Math.max(0, -offsetX);
    const srcY = Math.max(0, -offsetY);
    const dstX = Math.max(0, offsetX);
    const dstY = Math.max(0, offsetY);
    const drawW = Math.min(canvasWidth, scaledW) ;
    const drawH = Math.min(canvasHeight, scaledH);

    ctx.drawImage(tempCanvas, srcX, srcY, drawW, drawH, dstX, dstY, drawW, drawH);
  } else {
    // Scale down
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = scaledW;
    tempCanvas.height = scaledH;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.imageSmoothingEnabled = antiAlias;
    tempCtx.drawImage(srcCanvas, 0, 0, scaledW, scaledH);

    ctx.drawImage(tempCanvas, 0, 0, scaledW, scaledH, offsetX, offsetY, scaledW, scaledH);
  }
  ctx.restore();
}

/**
 * Apply bloom canvas modifier.
 */
function applyBloom(
  ctx: CanvasRenderingContext2D,
  modifier: CanvasModifierInstance,
  params: Record<string, ModifierParamValue>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const threshold = numParam(params.threshold, 0.7);
  const radius = numParam(params.radius, 3);
  const intensity = numParam(params.intensity, 0.5);
  const color = String(params.color) || '#ffffff';

  // Extract bright pixels
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const brightData = new Uint8ClampedArray(imageData.data);

  for (let i = 0; i < brightData.length; i += 4) {
    const r = brightData[i];
    const g = brightData[i + 1];
    const b = brightData[i + 2];
    const a = brightData[i + 3];
    const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    if (brightness < threshold || a === 0) {
      brightData[i + 3] = 0; // Make dim pixels transparent
    } else {
      // Keep the bright pixel
      const factor = (brightness - threshold) / (1 - threshold);
      brightData[i + 3] = Math.round(a * factor);
    }
  }

  // Create bright canvas and blur
  const brightCanvas = document.createElement('canvas');
  brightCanvas.width = canvasWidth;
  brightCanvas.height = canvasHeight;
  const brightCtx = brightCanvas.getContext('2d')!;
  brightCtx.putImageData(new ImageData(brightData, canvasWidth, canvasHeight), 0, 0);

  // Blur the bright canvas
  const blurredData = boxBlurAlpha(brightCtx.getImageData(0, 0, canvasWidth, canvasHeight), radius);

  // Tint with bloom color
  const [cr, cg, cb] = hexToRgb(color);
  for (let i = 0; i < blurredData.data.length; i += 4) {
    const alpha = blurredData.data[i + 3];
    if (alpha > 0) {
      blurredData.data[i] = cr;
      blurredData.data[i + 1] = cg;
      blurredData.data[i + 2] = cb;
      blurredData.data[i + 3] = Math.round(alpha * intensity);
    }
  }

  const bloomCanvas = document.createElement('canvas');
  bloomCanvas.width = canvasWidth;
  bloomCanvas.height = canvasHeight;
  const bloomCtx = bloomCanvas.getContext('2d')!;
  bloomCtx.putImageData(blurredData, 0, 0);

  // Composite additively
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(bloomCanvas, 0, 0);
  ctx.restore();
}

/**
 * Apply scanlines canvas modifier.
 */
function applyScanlines(
  ctx: CanvasRenderingContext2D,
  modifier: CanvasModifierInstance,
  params: Record<string, ModifierParamValue>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const lineSpacing = numParam(params.lineSpacing, 2);
  const lineOpacity = numParam(params.lineOpacity, 0.3);
  const lineColor = String(params.lineColor) || '#000000';
  const vignette = Boolean(params.vignette);
  const vignetteIntensity = numParam(params.vignetteIntensity, 0.3);

  const [lr, lg, lb] = hexToRgb(lineColor);

  // Get current image data
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = imageData.data;

  // Apply scanlines
  for (let y = 0; y < canvasHeight; y++) {
    if (y % lineSpacing === 0) {
      for (let x = 0; x < canvasWidth; x++) {
        const i = (y * canvasWidth + x) * 4;
        if (data[i + 3] > 0) {
          data[i] = Math.round(data[i] * (1 - lineOpacity) + lr * lineOpacity);
          data[i + 1] = Math.round(data[i + 1] * (1 - lineOpacity) + lg * lineOpacity);
          data[i + 2] = Math.round(data[i + 2] * (1 - lineOpacity) + lb * lineOpacity);
        }
      }
    }
  }

  // Apply vignette
  if (vignette && vignetteIntensity > 0) {
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        const i = (y * canvasWidth + x) * 4;
        if (data[i + 3] === 0) continue;

        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
        const darken = Math.max(0, 1 - dist * dist * vignetteIntensity * 2);

        data[i] = Math.round(data[i] * darken);
        data[i + 1] = Math.round(data[i + 1] * darken);
        data[i + 2] = Math.round(data[i + 2] * darken);
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Apply canvas mask modifier.
 */
function applyCanvasMask(
  ctx: CanvasRenderingContext2D,
  modifier: CanvasModifierInstance,
  params: Record<string, ModifierParamValue>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const shape = String(params.shape) || 'circle';
  const margin = numParam(params.margin, 0);
  const feather = numParam(params.feather, 0);

  const w = canvasWidth - margin * 2;
  const h = canvasHeight - margin * 2;
  if (w <= 0 || h <= 0) return;

  // Get current image data
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = imageData.data;

  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const i = (y * canvasWidth + x) * 4;
      if (data[i + 3] === 0) continue;

      // Normalized position relative to center
      const nx = (x - cx) / (w / 2);
      const ny = (y - cy) / (h / 2);

      let insideMask = false;
      let edgeDistance = 0;

      switch (shape) {
        case 'circle': {
          const dist = Math.sqrt(nx * nx + ny * ny);
          insideMask = dist <= 1;
          edgeDistance = 1 - dist;
          break;
        }
        case 'star': {
          // 5-pointed star
          const angle = Math.atan2(ny, nx);
          const r = Math.sqrt(nx * nx + ny * ny);
          const starR = 0.4 + 0.6 * Math.pow(Math.abs(Math.cos(2.5 * angle)), 2);
          insideMask = r <= starR;
          edgeDistance = starR - r;
          break;
        }
        case 'rounded_rect': {
          const cornerR = 0.2;
          const absNx = Math.abs(nx);
          const absNy = Math.abs(ny);
          if (absNx <= 1 - cornerR && absNy <= 1) {
            insideMask = true;
            edgeDistance = Math.min(1 - absNx, 1 - absNy);
          } else if (absNx <= 1 && absNy <= 1 - cornerR) {
            insideMask = true;
            edgeDistance = Math.min(1 - absNx, 1 - absNy);
          } else if (absNx <= 1 && absNy <= 1) {
            const cdx = absNx - (1 - cornerR);
            const cdy = absNy - (1 - cornerR);
            const cdist = Math.sqrt(cdx * cdx + cdy * cdy);
            insideMask = cdist <= cornerR;
            edgeDistance = cornerR - cdist;
          }
          break;
        }
        case 'diamond': {
          const dist = Math.abs(nx) + Math.abs(ny);
          insideMask = dist <= 1;
          edgeDistance = 1 - dist;
          break;
        }
      }

      if (!insideMask) {
        // Clear pixel outside mask
        if (feather > 0) {
          // Feather: gradually reduce alpha
          data[i + 3] = 0;
        } else {
          data[i + 3] = 0;
        }
      } else if (feather > 0 && edgeDistance < feather / (w / 2)) {
        // Feather edge
        const alphaFactor = edgeDistance / (feather / (w / 2));
        data[i + 3] = Math.round(data[i + 3] * alphaFactor);
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Apply all canvas modifiers from visible+enabled tracks.
 * This is called AFTER all part rendering and effect track rendering.
 */
export function applyCanvasModifiers(
  ctx: CanvasRenderingContext2D,
  canvasModifierTracks: CanvasModifierTrack[],
  currentFrame: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  // Process tracks in order
  for (const track of canvasModifierTracks) {
    if (!track.visible || !track.enabled) continue;

    // Process each modifier in the track
    for (const modifier of track.modifiers) {
      if (!modifier.enabled) continue;

      // Resolve params (interpolate keyframes if any)
      const params = resolveCanvasModifierParams(track, modifier, currentFrame);

      switch (modifier.type) {
        case 'outline_emphasis':
          applyOutlineEmphasis(ctx, modifier, params, canvasWidth, canvasHeight);
          break;
        case 'color_lut':
          applyColorLut(ctx, modifier, params, canvasWidth, canvasHeight);
          break;
        case 'pixel_zoom':
          applyPixelZoom(ctx, modifier, params, canvasWidth, canvasHeight);
          break;
        case 'bloom':
          applyBloom(ctx, modifier, params, canvasWidth, canvasHeight);
          break;
        case 'scanlines':
          applyScanlines(ctx, modifier, params, canvasWidth, canvasHeight);
          break;
        case 'canvas_mask':
          applyCanvasMask(ctx, modifier, params, canvasWidth, canvasHeight);
          break;
      }
    }
  }
}
