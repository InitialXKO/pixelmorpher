// ============================================================
// PixelMorpher - Inpainting Library
// ============================================================
// Provides Telea (2004) fast-marching inpainting for pixel art.
// No ML model required — pure algorithmic approach.

import type { PixelGrid, PixelColor } from './types';
import { subToPx, type Sprite } from './unified-types';
import { rgbToHex } from './engine/utils';

/**
 * Telea inpainting (A. Telea, "An Image Inpainting Technique Based on
 * the Fast Marching Method", 2004) for pixel art.
 *
 * 1. A fast-marching pass computes T(p) — the distance/arrival order
 *    from the known region into the masked region Ω — by solving the
 *    eikonal equation |∇T| = 1 with the upwind update, driven by a
 *    min-heap narrow band. Known pixels have T = 0.
 * 2. Ω pixels are painted in increasing T. Painting p gathers the
 *    already-known neighbours q (original or painted earlier) within
 *    `radius`, extrapolates each one to first order —
 *    I(q) + ∇I(q)·(p − q), with ∇I(q) differenced from q's known
 *    neighbourhood — and combines them with the paper's weights
 *    w = w_dir · w_dst · w_lev:
 *      w_dir = ((p−q)/|p−q|) · ∇T̂(p)  (front-direction alignment;
 *              neighbours with alignment ≤ 0 lie downstream of the
 *              front and do not contribute)
 *      w_dst = 1 / |p−q|²
 *      w_lev = 1 / (1 + |T(p) − T(q)|)
 *
 * Transparency in this pixel model is binary (null = transparent), so
 * there is no α channel to extrapolate: unmasked null pixels are
 * neither colour sources nor fill targets and block the marching
 * front. Masked pixels the front cannot reach (or with no usable
 * neighbour) fall back to null, as before.
 *
 * The runtime package carries a twin of this function (pxInpaint in
 * proc-runtime/pixel-src.ts) — the two are kept operation-identical
 * and probe-aligned pixel by pixel.
 *
 * @param pixels - The pixel grid to inpaint
 * @param mask - Set of "x,y" strings identifying pixels to inpaint
 * @param radius - Neighbourhood radius for the weighted extrapolation (default 3)
 * @returns New pixel grid with masked areas filled
 */
export function inpaintPixels(
  pixels: PixelGrid,
  mask: Set<string>,
  radius: number = 3
): PixelGrid {
  const height = pixels.length;
  const width = height > 0 ? pixels[0].length : 0;

  if (width === 0 || height === 0 || mask.size === 0) return pixels;

  // Deep copy pixels
  const result: PixelGrid = pixels.map(row => [...row]);

  const N = width * height;
  const at = (x: number, y: number) => y * width + x;

  // Pixel classes: KNOWN carries a colour and is not masked; OMEGA is
  // masked and must be painted; BLOCKED is an unmasked transparent
  // pixel — no colour to give, not a fill target, front cannot cross.
  const KNOWN = 0, OMEGA = 1, BLOCKED = 2;
  const cls = new Uint8Array(N);
  const chanR = new Float64Array(N);
  const chanG = new Float64Array(N);
  const chanB = new Float64Array(N);
  const hasColor = new Uint8Array(N);

  const inMask = new Uint8Array(N);
  for (const key of mask) {
    const comma = key.indexOf(',');
    if (comma < 0) continue;
    const x = Number(key.slice(0, comma));
    const y = Number(key.slice(comma + 1));
    if (
      Number.isFinite(x) && Number.isFinite(y) &&
      Number.isInteger(x) && Number.isInteger(y) &&
      x >= 0 && x < width && y >= 0 && y < height
    ) {
      inMask[at(x, y)] = 1;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = at(x, y);
      if (inMask[i]) { cls[i] = OMEGA; continue; }
      const c = pixels[y][x];
      if (c === null || c === '') { cls[i] = BLOCKED; continue; }
      cls[i] = KNOWN;
      chanR[i] = parseInt(c.slice(1, 3), 16);
      chanG[i] = parseInt(c.slice(3, 5), 16);
      chanB[i] = parseInt(c.slice(5, 7), 16);
      hasColor[i] = 1;
    }
  }

  // ---- Fast marching: T field + acceptance order ----
  const T = new Float64Array(N).fill(Infinity);
  const accepted = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (cls[i] === KNOWN) { T[i] = 0; accepted[i] = 1; }
  }

  // Upwind eikonal update from the accepted 4-neighbours:
  // solve (T − Th)² + (T − Tv)² = 1 where Th/Tv are the smallest
  // accepted T along each axis.
  function solveT(x: number, y: number): number {
    let th = Infinity;
    let tv = Infinity;
    if (x > 0 && accepted[at(x - 1, y)]) th = T[at(x - 1, y)];
    if (x < width - 1 && accepted[at(x + 1, y)]) th = Math.min(th, T[at(x + 1, y)]);
    if (y > 0 && accepted[at(x, y - 1)]) tv = T[at(x, y - 1)];
    if (y < height - 1 && accepted[at(x, y + 1)]) tv = Math.min(tv, T[at(x, y + 1)]);
    if (th === Infinity && tv === Infinity) return Infinity;
    if (th === Infinity) return tv + 1;
    if (tv === Infinity) return th + 1;
    const d = Math.abs(th - tv);
    if (d >= 1) return Math.min(th, tv) + 1;
    return (th + tv + Math.sqrt(2 - d * d)) / 2;
  }

  // Binary min-heap over (T, index), lazy deletion of stale entries.
  const heapT: number[] = [];
  const heapI: number[] = [];
  function heapPush(t: number, i: number): void {
    heapT.push(t);
    heapI.push(i);
    let c = heapT.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heapT[p] <= heapT[c]) break;
      const tt = heapT[p]; heapT[p] = heapT[c]; heapT[c] = tt;
      const ti = heapI[p]; heapI[p] = heapI[c]; heapI[c] = ti;
      c = p;
    }
  }
  function heapPop(): [number, number] {
    const topT = heapT[0];
    const topI = heapI[0];
    const lt = heapT.pop() as number;
    const li = heapI.pop() as number;
    if (heapT.length > 0) {
      heapT[0] = lt;
      heapI[0] = li;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < heapT.length && heapT[l] < heapT[m]) m = l;
        if (r < heapT.length && heapT[r] < heapT[m]) m = r;
        if (m === c) break;
        const tt = heapT[m]; heapT[m] = heapT[c]; heapT[c] = tt;
        const ti = heapI[m]; heapI[m] = heapI[c]; heapI[c] = ti;
        c = m;
      }
    }
    return [topT, topI];
  }

  function relax(x: number, y: number): void {
    const i = at(x, y);
    if (cls[i] !== OMEGA || accepted[i]) return;
    const t = solveT(x, y);
    if (t < T[i]) {
      T[i] = t;
      heapPush(t, i);
    }
  }

  // Unit gradient of T at (x, y), differenced from accepted neighbours
  // (per axis, the smaller-T side sets the direction).
  function gradT(x: number, y: number): [number, number] {
    const tp = T[at(x, y)];
    let gx = 0;
    let gy = 0;
    const tl = x > 0 && accepted[at(x - 1, y)] ? T[at(x - 1, y)] : Infinity;
    const tr = x < width - 1 && accepted[at(x + 1, y)] ? T[at(x + 1, y)] : Infinity;
    if (tl !== Infinity || tr !== Infinity) gx = tl <= tr ? tp - tl : -(tp - tr);
    const tu = y > 0 && accepted[at(x, y - 1)] ? T[at(x, y - 1)] : Infinity;
    const td = y < height - 1 && accepted[at(x, y + 1)] ? T[at(x, y + 1)] : Infinity;
    if (tu !== Infinity || td !== Infinity) gy = tu <= td ? tp - tu : -(tp - td);
    const len = Math.sqrt(gx * gx + gy * gy);
    if (len < 1e-12) return [0, 0];
    return [gx / len, gy / len];
  }

  // Gradient of one channel at (x, y) from its coloured neighbours
  // (central difference where possible, one-sided otherwise).
  function chanGrad(chan: Float64Array, x: number, y: number): [number, number] {
    const c = chan[at(x, y)];
    let gx = 0;
    let gy = 0;
    const hl = x > 0 && hasColor[at(x - 1, y)] ? chan[at(x - 1, y)] : NaN;
    const hr = x < width - 1 && hasColor[at(x + 1, y)] ? chan[at(x + 1, y)] : NaN;
    if (!Number.isNaN(hl) && !Number.isNaN(hr)) gx = (hr - hl) / 2;
    else if (!Number.isNaN(hr)) gx = hr - c;
    else if (!Number.isNaN(hl)) gx = c - hl;
    const hu = y > 0 && hasColor[at(x, y - 1)] ? chan[at(x, y - 1)] : NaN;
    const hd = y < height - 1 && hasColor[at(x, y + 1)] ? chan[at(x, y + 1)] : NaN;
    if (!Number.isNaN(hu) && !Number.isNaN(hd)) gy = (hd - hu) / 2;
    else if (!Number.isNaN(hd)) gy = hd - c;
    else if (!Number.isNaN(hu)) gy = c - hu;
    return [gx, gy];
  }

  // Paint Ω pixel (x, y) by Telea's weighted first-order extrapolation.
  function fillPixel(x: number, y: number): boolean {
    const [gtx, gty] = gradT(x, y);
    const tp = T[at(x, y)];
    const R = Math.ceil(radius);
    let sumR = 0, sumG = 0, sumB = 0, sumW = 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx === 0 && dy === 0) continue;
        const qx = x + dx, qy = y + dy;
        if (qx < 0 || qx >= width || qy < 0 || qy >= height) continue;
        const qi = at(qx, qy);
        if (!hasColor[qi]) continue;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        const dir = ((x - qx) * gtx + (y - qy) * gty) / dist;
        if (dir <= 0) continue;
        const w = dir * (1 / (dist * dist)) * (1 / (1 + Math.abs(tp - T[qi])));
        const [grx, gry] = chanGrad(chanR, qx, qy);
        const [ggx, ggy] = chanGrad(chanG, qx, qy);
        const [gbx, gby] = chanGrad(chanB, qx, qy);
        sumR += w * (chanR[qi] + grx * (x - qx) + gry * (y - qy));
        sumG += w * (chanG[qi] + ggx * (x - qx) + ggy * (y - qy));
        sumB += w * (chanB[qi] + gbx * (x - qx) + gby * (y - qy));
        sumW += w;
      }
    }
    if (sumW <= 0) return false;
    const hex = rgbToHex(sumR / sumW, sumG / sumW, sumB / sumW);
    const i = at(x, y);
    result[y][x] = hex;
    chanR[i] = parseInt(hex.slice(1, 3), 16);
    chanG[i] = parseInt(hex.slice(3, 5), 16);
    chanB[i] = parseInt(hex.slice(5, 7), 16);
    hasColor[i] = 1;
    return true;
  }

  // Seed the narrow band from the known region, then march: accept Ω
  // pixels in increasing T, paint each on acceptance, relax neighbours.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (cls[at(x, y)] !== OMEGA) continue;
      relax(x, y);
    }
  }
  const filled = new Uint8Array(N);
  while (heapT.length > 0) {
    const [t, i] = heapPop();
    if (accepted[i] || t !== T[i]) continue;
    accepted[i] = 1;
    const x = i % width;
    const y = (i / width) | 0;
    if (fillPixel(x, y)) filled[i] = 1;
    if (x > 0) relax(x - 1, y);
    if (x < width - 1) relax(x + 1, y);
    if (y > 0) relax(x, y - 1);
    if (y < height - 1) relax(x, y + 1);
  }

  // Ω pixels the front never reached (or with no usable neighbour)
  // stay transparent — the pre-Telea fallback for isolated regions.
  for (let i = 0; i < N; i++) {
    if (cls[i] === OMEGA && !filled[i]) {
      result[(i / width) | 0][i % width] = null;
    }
  }

  return result;
}

// ============================================================
// 画布掩码 → 新精灵（选区/SAM 提取的现行落点：全局精灵表）
// ============================================================
// Part 退役后，提取的产物是全局精灵表里的新精灵（addSprite +
// setSpritePixels）。采样与 plug 口径与画布选区提取（use-canvas-state
// 的 extractSelectionAsPart）逐式一致，保证同一掩码、同一画布在两条
// 提取路径（手动选区 / SAM 选区）下产出同一精灵：
//   - 精灵按入参顺序逐个试，画布点 (px,py) 映到精灵局部
//     (px-(画布宽/2-plugX), py-(画布高/2-plugY))，第一个非透明命中胜出；
//   - 结果裁到命中包围盒，pivot 取命中像素质心；
//   - plug 按选区提取同式回算（addSprite 缺省 plug 为中心，
//     defPivot 即该缺省值）。

export interface MaskExtractedSprite {
  width: number;
  height: number;
  pixels: PixelGrid;
  /** 新精灵 plug（像素单位，与 addSprite 的 opts.plugX/plugY 同口径） */
  plugX: number;
  plugY: number;
}

export function buildSpriteFromCanvasMask(
  sprites: readonly Sprite[],
  canvasWidth: number,
  canvasHeight: number,
  mask: ReadonlySet<string>,
): MaskExtractedSprite | null {
  if (mask.size === 0) return null;
  const offsetX = canvasWidth / 2;
  const offsetY = canvasHeight / 2;

  const selectedPixels: { x: number; y: number; color: string }[] = [];
  for (const key of mask) {
    const comma = key.indexOf(',');
    if (comma < 0) continue;
    const px = Number(key.slice(0, comma));
    const py = Number(key.slice(comma + 1));
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    for (const sprite of sprites) {
      const pivotX = sprite.plug ? subToPx(sprite.plug.x) : Math.floor(sprite.width / 2);
      const pivotY = sprite.plug ? subToPx(sprite.plug.y) : Math.floor(sprite.height / 2);
      const lx = px - (offsetX - pivotX);
      const ly = py - (offsetY - pivotY);
      if (lx < 0 || lx >= sprite.width || ly < 0 || ly >= sprite.height) continue;
      const color = sprite.data[ly]?.[lx];
      if (color !== null && color !== undefined) {
        selectedPixels.push({ x: px, y: py, color });
        break;
      }
    }
  }
  if (selectedPixels.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of selectedPixels) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const partW = maxX - minX + 1;
  const partH = maxY - minY + 1;

  const colorMap = new Map<string, string>();
  for (const p of selectedPixels) colorMap.set(`${p.x},${p.y}`, p.color);

  const pixels: PixelGrid = [];
  let sumX = 0, sumY = 0, count = 0;
  for (let y = 0; y < partH; y++) {
    const row: PixelColor[] = [];
    for (let x = 0; x < partW; x++) {
      const color = colorMap.get(`${minX + x},${minY + y}`);
      if (color) {
        row.push(color);
        sumX += x;
        sumY += y;
        count++;
      } else {
        row.push(null);
      }
    }
    pixels.push(row);
  }
  if (count === 0) return null;

  const pivotX = Math.round(sumX / count);
  const pivotY = Math.round(sumY / count);
  // addSprite 默认 plug 为中心（px）；选区提取算式里的 defPivot 即此默认值
  const defPivotX = Math.floor(partW / 2);
  const defPivotY = Math.floor(partH / 2);
  return {
    width: partW,
    height: partH,
    pixels,
    plugX: pivotX + (minX - Math.floor(canvasWidth / 2) + defPivotX - (defPivotX - pivotX)),
    plugY: pivotY + (minY - Math.floor(canvasHeight / 2) + defPivotY - (defPivotY - pivotY)),
  };
}

/**
 * Convert SAM mask (Float32Array) to a Set of "x,y" pixel coordinates.
 * Maps from normalized mask coordinates to canvas pixel coordinates.
 *
 * SAM returns masks at a reduced resolution (e.g., 256x256), so this
 * function scales the mask coordinates up to the target canvas size.
 * Pixels with values above the threshold are included in the selection.
 *
 * @param maskData - Raw Float32Array mask from SAM (values 0-1)
 * @param maskShape - [height, width] of the mask
 * @param canvasWidth - Target canvas width in pixels
 * @param canvasHeight - Target canvas height in pixels
 * @param threshold - Minimum mask value to include (default 0.5)
 * @returns Set of "x,y" coordinate strings for selected pixels
 */
export function samMaskToSelectionMask(
  maskData: Float32Array,
  maskShape: [number, number],
  canvasWidth: number,
  canvasHeight: number,
  threshold: number = 0.5
): Set<string> {
  const [maskH, maskW] = maskShape;
  const result = new Set<string>();

  for (let my = 0; my < maskH; my++) {
    for (let mx = 0; mx < maskW; mx++) {
      const value = maskData[my * maskW + mx];
      if (value >= threshold) {
        // Scale mask coordinates to canvas coordinates
        const cx = Math.floor((mx / maskW) * canvasWidth);
        const cy = Math.floor((my / maskH) * canvasHeight);
        if (cx >= 0 && cx < canvasWidth && cy >= 0 && cy < canvasHeight) {
          result.add(`${cx},${cy}`);
        }
      }
    }
  }

  return result;
}
