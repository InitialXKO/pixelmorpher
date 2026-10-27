// ============================================================
// 线绘特效渲染器（Jeff 乙10）：蓝图像素节点专用——在输入像素格的
// 轮廓/中心/地面之上以闭式公式逐帧盖印线绘效果（不改原图，返回
// 新格）。五件：热力场焰 / 晶柱笼 / 虚空涡流 / 裂地劲波 / 御剑环阵。
// 时间口径与其它渲染器一致：elapsedSeconds(frame, frameRate)。
// ============================================================

import type { PixelGrid, ModifierParamValue } from '../../types';
import { modifierGuard, elapsedSeconds } from './shared';

type Params = Record<string, ModifierParamValue>;

function num(p: Params, k: string, d: number): number {
  const v = Number(p[k]);
  return Number.isFinite(v) ? v : d;
}
function str(p: Params, k: string, d: string): string {
  const v = p[k];
  return typeof v === 'string' && v ? v : d;
}
function cloneGrid(pixels: PixelGrid): PixelGrid {
  return pixels.map((row) => [...row]);
}
function stamp(out: PixelGrid, x: number, y: number, color: string, onlyEmpty: boolean): void {
  if (y < 0 || y >= out.length) return;
  const row = out[y]!;
  if (x < 0 || x >= row.length) return;
  if (onlyEmpty && row[x]) return;
  row[x] = color;
}
function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return [255, 255, 255];
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}
function mixHex(a: string, b: string, f: number): string {
  const ca = hexRgb(a), cb = hexRgb(b);
  const t = Math.max(0, Math.min(1, f));
  const v = ca.map((c, i) => Math.round(c + (cb[i]! - c) * t));
  return `#${v.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
function hash01(...nums: number[]): number {
  let s = 0;
  for (const n of nums) s += (n + 1) * 2654435761 % 4294967296;
  const x = Math.sin(s * 0.0000168079 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
/** 二维值噪声（格点哈希 + smoothstep 插值），任意实数坐标可采样 */
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const su = xf * xf * (3 - 2 * xf), sv = yf * yf * (3 - 2 * yf);
  const a = hash01(xi, yi, seed), b = hash01(xi + 1, yi, seed);
  const c = hash01(xi, yi + 1, seed), d = hash01(xi + 1, yi + 1, seed);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
function silhouette(pixels: PixelGrid, w: number, h: number) {
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !!pixels[y]![x];
  let count = 0, cx = 0, cy = 0, groundY = -1;
  const tops = new Array<number>(w).fill(-1);
  const boundary: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!pixels[y]![x]) continue;
      count++; cx += x; cy += y;
      if (tops[x] === -1) tops[x] = y;
      if (y > groundY) groundY = y;
      if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) boundary.push([x, y]);
    }
  }
  return { solid, count, cx: count ? cx / count : w / 2, cy: count ? cy / count : h / 2, groundY, tops, boundary };
}

/** 热力场焰：沿每列轮廓顶部向上升起噪声火舌（只盖空格） */
export function applyHeatFlame(
  pixels: PixelGrid, width: number, height: number,
  params: Params, currentFrame: number, frameRate: number, weight: number,
): PixelGrid {
  const grid = modifierGuard(pixels, weight);
  if (!grid) return pixels;
  const { w, h } = grid;
  const out = cloneGrid(pixels);
  const sil = silhouette(pixels, w, h);
  if (!sil.count) return out;
  const heightPx = Math.max(2, num(params, 'heightPx', 14));
  const speed = num(params, 'speed', 1.2);
  const seed = num(params, 'seed', 3);
  const hot = str(params, 'colorHot', '#fff3c4');
  const cool = str(params, 'colorCool', '#ff5a00');
  const t = elapsedSeconds(currentFrame, frameRate);
  for (let x = 0; x < w; x++) {
    const top = sil.tops[x]!;
    if (top < 0) continue;
    const n = vnoise(x * 0.33, t * speed * 2 + seed * 7.7, seed | 0);
    const fh = Math.max(1, Math.round(heightPx * (0.45 + 0.55 * n)));
    for (let k = 1; k <= fh; k++) {
      const y = top - k;
      if (y < 0) break;
      const sway = Math.round((vnoise(x * 0.2, t * speed * 2 + k * 0.35, (seed | 0) + 40) - 0.5) * k * 0.36);
      const heat = 1 - k / (fh + 1);
      stamp(out, x + sway, y, mixHex(cool, hot, Math.pow(heat, 1.35)), true);
    }
  }
  return out;
}

/** 晶柱笼：从轮廓锚点沿外法线长出锥形晶柱（呼吸脉动） */
export function applyCrystalCage(
  pixels: PixelGrid, width: number, height: number,
  params: Params, currentFrame: number, frameRate: number, weight: number,
): PixelGrid {
  const grid = modifierGuard(pixels, weight);
  if (!grid) return pixels;
  const { w, h } = grid;
  const out = cloneGrid(pixels);
  const sil = silhouette(pixels, w, h);
  if (!sil.boundary.length) return out;
  const count = Math.max(1, Math.min(16, Math.round(num(params, 'count', 6))));
  const lengthPx = Math.max(3, num(params, 'lengthPx', 16));
  const speed = num(params, 'speed', 0.8);
  const seed = num(params, 'seed', 5);
  const color = str(params, 'color', '#9fe8ff');
  const core = str(params, 'coreColor', '#ffffff');
  const t = elapsedSeconds(currentFrame, frameRate);
  const B = sil.boundary.length;
  for (let i = 0; i < count; i++) {
    const idx = Math.min(B - 1, Math.floor((i + hash01(seed, i, 7) * 0.6) * (B / count)));
    const [ax, ay] = sil.boundary[idx]!;
    let dx = ax - sil.cx, dy = ay - sil.cy;
    const dl = Math.hypot(dx, dy);
    if (dl < 0.5) { dx = 0; dy = -1; } else { dx /= dl; dy /= dl; }
    const pulse = 0.85 + 0.15 * Math.sin(t * speed * Math.PI * 2 + i * 1.7);
    const L = Math.max(2, Math.round(lengthPx * pulse));
    for (let s = 1; s <= L; s++) {
      const px = ax + dx * s, py = ay + dy * s;
      stamp(out, Math.round(px), Math.round(py), core, true);
      if (s < L * 0.7) {
        stamp(out, Math.round(px - dy), Math.round(py + dx), color, true);
        stamp(out, Math.round(px + dy), Math.round(py - dx), color, true);
      }
    }
  }
  return out;
}

/** 虚空涡流：绕中心的对数螺旋臂（旋转 + 抖动消散，只盖空格） */
export function applyVoidVortex(
  pixels: PixelGrid, width: number, height: number,
  params: Params, currentFrame: number, frameRate: number, weight: number,
): PixelGrid {
  const grid = modifierGuard(pixels, weight);
  if (!grid) return pixels;
  const { w, h } = grid;
  const out = cloneGrid(pixels);
  const arms = Math.max(1, Math.min(8, Math.round(num(params, 'arms', 3))));
  const speed = num(params, 'speed', 0.5);
  const seed = num(params, 'seed', 7);
  const color = str(params, 'color', '#b18cff');
  const deep = str(params, 'colorDeep', '#4a1e80');
  const t = elapsedSeconds(currentFrame, frameRate);
  const cx = w / 2, cy = h / 2;
  const R = num(params, 'radius', 0) > 0 ? num(params, 'radius', 0) : Math.min(w, h) * 0.72;
  const steps = 46;
  const tick = Math.floor(t * 8);
  for (let a = 0; a < arms; a++) {
    for (let j = 0; j < steps; j++) {
      const f = j / steps;
      if (hash01(seed, a, j, tick) > 1 - f * 0.75) continue;
      const ang = a * (Math.PI * 2 / arms) + f * 4.2 + t * speed * Math.PI * 2;
      const r = 2 + f * R;
      const x = Math.round(cx + Math.cos(ang) * r);
      const y = Math.round(cy + Math.sin(ang) * r * 0.8);
      stamp(out, x, y, mixHex(color, deep, f), true);
      if (f < 0.4) stamp(out, x + 1, y, mixHex(color, deep, f), true);
    }
  }
  return out;
}

/** 裂地劲波：自地面接触线周期性扩散的扁椭圆冲击环 + 早期裂纹 */
export function applyGroundWave(
  pixels: PixelGrid, width: number, height: number,
  params: Params, currentFrame: number, frameRate: number, weight: number,
): PixelGrid {
  const grid = modifierGuard(pixels, weight);
  if (!grid) return pixels;
  const { w, h } = grid;
  const out = cloneGrid(pixels);
  const sil = silhouette(pixels, w, h);
  if (!sil.count || sil.groundY < 0) return out;
  const speed = num(params, 'speed', 0.9);
  const seed = num(params, 'seed', 11);
  const color = str(params, 'color', '#d8c9a3');
  const deep = str(params, 'colorDeep', '#8a7648');
  const t = elapsedSeconds(currentFrame, frameRate);
  let bx = 0, bn = 0;
  for (let x = 0; x < w; x++) if (pixels[sil.groundY]![x]) { bx += x; bn++; }
  const cxB = bn ? bx / bn : w / 2;
  const gy = sil.groundY;
  for (let ring = 0; ring < 2; ring++) {
    const ph = (t * speed + ring * 0.5) % 1;
    const rx = 2 + ph * w * 0.52;
    const ry = Math.max(1, rx * 0.3);
    const pts = Math.max(12, Math.round(rx * 2.2));
    for (let vi = 0; vi < pts; vi++) {
      const th = (vi / pts) * Math.PI * 2;
      const x = Math.round(cxB + Math.cos(th) * rx);
      const y = Math.round(gy + Math.sin(th) * ry * 0.5);
      if (hash01(seed, ring, vi, Math.floor(t * 8)) > 1 - ph * 0.55) continue;
      const c = mixHex(color, deep, ph);
      if (y >= gy - 1) stamp(out, x, y, c, false);
      else stamp(out, x, y, c, true);
    }
    if (ph < 0.35) {
      for (let k = 0; k < 3; k++) {
        const d = 2 + k * 2 + Math.floor(ph * 8);
        stamp(out, Math.round(cxB - d), gy, deep, false);
        stamp(out, Math.round(cxB + d), gy, deep, false);
      }
    }
  }
  return out;
}

/** 御剑环阵：小剑沿椭圆轨道绕精灵飞行（剑身沿切线，只盖空格） */
export function applySwordRing(
  pixels: PixelGrid, width: number, height: number,
  params: Params, currentFrame: number, frameRate: number, weight: number,
): PixelGrid {
  const grid = modifierGuard(pixels, weight);
  if (!grid) return pixels;
  const { w, h } = grid;
  const out = cloneGrid(pixels);
  const count = Math.max(1, Math.min(12, Math.round(num(params, 'count', 5))));
  const speed = num(params, 'speed', 0.45);
  const color = str(params, 'color', '#d9ecff');
  const edge = str(params, 'colorEdge', '#5a7ea6');
  const t = elapsedSeconds(currentFrame, frameRate);
  const cx = w / 2, cy = h / 2;
  const orbitRX = (num(params, 'orbitRX', 130) / 100) * (w / 2);
  const orbitRY = (num(params, 'orbitRY', 62) / 100) * (h / 2);
  const L = Math.max(5, Math.round(Math.min(w, h) * 0.34));
  for (let i = 0; i < count; i++) {
    const ang = t * speed * Math.PI * 2 + i * (Math.PI * 2 / count);
    const px = cx + Math.cos(ang) * orbitRX;
    const py = cy + Math.sin(ang) * orbitRY;
    let tx = -Math.sin(ang) * orbitRX, ty = Math.cos(ang) * orbitRY;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const nx = -ty, ny = tx;
    for (let s = -Math.floor(L / 2); s <= Math.floor(L / 2); s++) {
      const bx = px + tx * s, by = py + ty * s;
      const isTip = Math.abs(s) >= Math.floor(L / 2) - 1;
      stamp(out, Math.round(bx), Math.round(by), color, true);
      if (!isTip) {
        stamp(out, Math.round(bx + nx), Math.round(by + ny), edge, true);
        stamp(out, Math.round(bx - nx), Math.round(by - ny), edge, true);
      }
      if (s === -Math.floor(L / 6)) {
        stamp(out, Math.round(bx + nx * 2), Math.round(by + ny * 2), edge, true);
        stamp(out, Math.round(bx - nx * 2), Math.round(by - ny * 2), edge, true);
      }
    }
  }
  return out;
}
