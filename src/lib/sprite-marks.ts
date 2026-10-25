// ============================================================
// 精灵标记解析层（研究线 research/sprite-marks，设计见
// spikes/sprite-marks/DESIGN.md）。全产品唯一解析口径：
// 消费端按 name 引用 Sprite.marks，找不到/种类不符返回
// undefined（消费端走自己的缺省，永不抛错）；同名取第一条。
// ============================================================

import type { PixelGrid, Sprite, SpriteMark } from './unified-types';
import { unpackMaskBits } from './dynamic-patterns';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 载入时规整标记表：丢弃无名/非法条目，数值钳制到合法域 */
export function normalizeSpriteMarks(marks: unknown): SpriteMark[] {
  if (!Array.isArray(marks)) return [];
  const out: SpriteMark[] = [];
  for (const m of marks as SpriteMark[]) {
    if (!m || typeof m !== 'object') continue;
    const name = typeof m.name === 'string' ? m.name.trim() : '';
    if (!name) continue;
    const id = typeof m.id === 'string' && m.id ? m.id : `mark_${out.length}`;
    switch (m.kind) {
      case 'point':
        if (Number.isFinite(m.x) && Number.isFinite(m.y)) {
          out.push({ id, name, kind: 'point', x: clamp01(m.x), y: clamp01(m.y) });
        }
        break;
      case 'value':
        if (Number.isFinite(m.value)) out.push({ id, name, kind: 'value', value: m.value });
        break;
      case 'direction':
        if (Number.isFinite(m.angleDeg)) {
          out.push({ id, name, kind: 'direction', angleDeg: ((m.angleDeg % 360) + 360) % 360 });
        }
        break;
      case 'vector':
        if ([m.x, m.y, m.dx, m.dy].every(Number.isFinite)) {
          out.push({ id, name, kind: 'vector', x: clamp01(m.x), y: clamp01(m.y), dx: m.dx, dy: m.dy });
        }
        break;
      case 'region':
        if (m.region && typeof m.region === 'object') out.push({ id, name, kind: 'region', region: m.region });
        break;
      default:
        break;
    }
  }
  return out;
}

/** 按名找标记（可限定种类）；同名取第一条 */
export function findMark<K extends SpriteMark['kind']>(
  sprite: Pick<Sprite, 'marks'> | undefined,
  name: string,
  kind?: K,
): Extract<SpriteMark, { kind: K }> | undefined {
  if (!sprite?.marks || !name) return undefined;
  for (const m of sprite.marks) {
    if (m.name === name && (kind === undefined || m.kind === kind)) {
      return m as Extract<SpriteMark, { kind: K }>;
    }
  }
  return undefined;
}

/** 点标记 → 精灵像素坐标（浮点，格心口径与 plug 一致：整数位 = 格左上） */
export function markPointPx(
  sprite: Pick<Sprite, 'marks' | 'width' | 'height'>,
  name: string,
): { x: number; y: number } | undefined {
  const m = findMark(sprite, name, 'point');
  if (!m) return undefined;
  return { x: m.x * sprite.width, y: m.y * sprite.height };
}

/** 值标记 → 标量 */
export function markValue(sprite: Pick<Sprite, 'marks'> | undefined, name: string): number | undefined {
  return findMark(sprite, name, 'value')?.value;
}

/** 方向标记 → 角度（度，精灵本地口径 0=东顺时针 90=南） */
export function markDirectionDeg(sprite: Pick<Sprite, 'marks'> | undefined, name: string): number | undefined {
  return findMark(sprite, name, 'direction')?.angleDeg;
}

/** 矢量标记 → 锚点像素坐标 + 分量（像素）+ 角度/长度 */
export function markVectorPx(
  sprite: Pick<Sprite, 'marks' | 'width' | 'height'>,
  name: string,
): { x: number; y: number; dx: number; dy: number; angleDeg: number; length: number } | undefined {
  const m = findMark(sprite, name, 'vector');
  if (!m) return undefined;
  const dx = m.dx * sprite.width;
  const dy = m.dy * sprite.height;
  return {
    x: m.x * sprite.width, y: m.y * sprite.height, dx, dy,
    angleDeg: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360,
    length: Math.hypot(dx, dy),
  };
}

function hexRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '');
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  return Number.isNaN(n) ? null : { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** 选区标记 → 逐格选中掩码（1 = 选中，与发光选区同形）。
 * grid = 精灵像素网格（(string|null)[][]，string 为 #rrggbb）。
 * 涂画：与 glowMaskCells 同对齐（左上对齐、越界丢弃）；
 * 取色：RGB 距离 ≤ 容差（与发光取色同口径）；几何：归一
 * 矩形/圆按格心判定。无此标记或空网格返回 null。 */
export function resolveRegionCells(
  sprite: Pick<Sprite, 'marks'>,
  name: string,
  grid: PixelGrid,
): Uint8Array | null {
  const m = findMark(sprite, name, 'region');
  if (!m) return null;
  const h = grid.length;
  const w = h > 0 ? grid[0].length : 0;
  if (!w || !h) return null;
  const cells = new Uint8Array(w * h);
  const spec = m.region;
  if (spec.by === 'painted') {
    const src = unpackMaskBits(spec.mask.bits, spec.mask.w * spec.mask.h);
    const mw = Math.min(w, spec.mask.w);
    const mh = Math.min(h, spec.mask.h);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (src[y * spec.mask.w + x]) cells[y * w + x] = 1;
      }
    }
    return cells;
  }
  if (spec.by === 'color') {
    const pick = hexRgb(spec.color);
    if (!pick) return cells;
    const tol = Math.max(0, Math.min(1, spec.tolerance || 0)) * 441.67;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = grid[y][x];
        if (!c) continue;
        const rgb = hexRgb(c);
        if (!rgb) continue;
        const d = Math.hypot(rgb.r - pick.r, rgb.g - pick.g, rgb.b - pick.b);
        if (tol <= 0 ? c.toLowerCase() === spec.color.toLowerCase() : d <= tol) cells[y * w + x] = 1;
      }
    }
    return cells;
  }
  if (spec.by === 'rect') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = (x + 0.5) / w, ny = (y + 0.5) / h;
        if (nx >= spec.x && nx < spec.x + spec.w && ny >= spec.y && ny < spec.y + spec.h) {
          cells[y * w + x] = 1;
        }
      }
    }
    return cells;
  }
  // circle
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5) / w, ny = (y + 0.5) / h;
      if (Math.hypot(nx - spec.cx, ny - spec.cy) <= spec.r) cells[y * w + x] = 1;
    }
  }
  return cells;
}
