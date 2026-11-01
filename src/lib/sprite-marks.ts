// ============================================================
// 精灵标记解析层（研究线 research/sprite-marks，设计见
// spikes/sprite-marks/DESIGN.md）。全产品唯一解析口径：
// 消费端按 name 引用 Sprite.marks，找不到/种类不符返回
// undefined（消费端走自己的缺省，永不抛错）；同名取第一条。
// ============================================================

import type { PixelGrid, Sprite, SpriteMark } from './unified-types';
import { d4MapPoint, d4TransformGrid, resampleGridAffine, type D4Op } from './sprite-transform';
import { applyAffine, type Affine2D } from './engine/affine';

/** 位打包 base64 字母表（掩码/字节共用，与历史格式一致；
 * 本文件是 pack/unpack 的唯一实现，dynamic-patterns 转出） */
export const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 位打包掩码 → base64（行优先，每像素 1 位） */
export function packMaskBits(cells: Uint8Array): string {
  let out = '';
  for (let i = 0; i < cells.length; i += 6) {
    let v = 0;
    for (let k = 0; k < 6; k++) if (cells[i + k]) v |= 1 << (5 - k);
    out += B64_ALPHABET[v];
  }
  return out;
}

/** base64 → 位打包掩码（count = w*h，多余位丢弃） */
export function unpackMaskBits(bits: string, count: number): Uint8Array {
  const cells = new Uint8Array(count);
  for (let i = 0; i < bits.length; i++) {
    const v = B64_ALPHABET.indexOf(bits[i]);
    if (v < 0) continue;
    for (let k = 0; k < 6; k++) {
      const idx = i * 6 + k;
      if (idx < count && (v & (1 << (5 - k)))) cells[idx] = 1;
    }
  }
  return cells;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 新标记 id（时间戳 + 计数，单会话内不重复即可） */
let markIdCounter = 0;
export function newMarkId(): string {
  markIdCounter += 1;
  return `mark_${Date.now().toString(36)}_${markIdCounter}`;
}

/** 不重名的标记名：base 已占用时依次加序号（标记2、标记3…） */
export function uniqueMarkName(marks: readonly { name: string }[], base: string): string {
  if (!marks.some((m) => m.name === base)) return base;
  for (let i = 2; ; i++) {
    const cand = `${base}${i}`;
    if (!marks.some((m) => m.name === cand)) return cand;
  }
}

/** 拖拽两角（归一坐标）→ 矩形选区定义（自动排序、最小 1 格感） */
export function rectSpecFromCorners(
  x0: number, y0: number, x1: number, y1: number,
): { by: 'rect'; x: number; y: number; w: number; h: number } {
  const x = clamp01(Math.min(x0, x1));
  const y = clamp01(Math.min(y0, y1));
  return {
    by: 'rect', x, y,
    w: Math.max(0, clamp01(Math.max(x0, x1)) - x),
    h: Math.max(0, clamp01(Math.max(y0, y1)) - y),
  };
}

/** 逐格数组 → 涂画选区定义（位打包） */
export function paintedSpecFromCells(
  cells: Uint8Array, w: number, h: number,
): { by: 'painted'; mask: { w: number; h: number; bits: string } } {
  return { by: 'painted', mask: { w, h, bits: packMaskBits(cells) } };
}

/** 涂画选区定义 → 逐格数组（按目标网格尺寸对齐，越界丢弃） */
export function cellsFromPaintedSpec(
  spec: { mask: { w: number; h: number; bits: string } }, w: number, h: number,
): Uint8Array {
  const out = new Uint8Array(w * h);
  const src = unpackMaskBits(spec.mask.bits, spec.mask.w * spec.mask.h);
  const mw = Math.min(w, spec.mask.w);
  const mh = Math.min(h, spec.mask.h);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      if (src[y * spec.mask.w + x]) out[y * w + x] = 1;
    }
  }
  return out;
}

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

/** 方向绑定解析：direction 标记优先，其次 vector 标记的
 * 角度（分量按精灵宽高换像素后取 atan2，y 向下屏幕口径）。
 * 消费端（发射/置换方向）统一走此口径。 */
export function markDirAngleDeg(
  sprite: Pick<Sprite, 'marks' | 'width' | 'height'>,
  name: string,
): number | undefined {
  const d = findMark(sprite, name, 'direction');
  if (d) return d.angleDeg;
  const v = findMark(sprite, name, 'vector');
  if (!v) return undefined;
  const dx = v.dx * sprite.width;
  const dy = v.dy * sprite.height;
  if (dx === 0 && dy === 0) return undefined;
  return ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
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

// ============================================================
// 标记几何重映射（裁剪/变换/派生与 landmarks 同路，审计 F-32）
// 此前 resizeSprite/transformSprite 只重映射 landmarks、marks 原样
// 保留（裁掉边后坐标相对内容漂移）、deriveSpriteFrom 干脆不带 marks。
// 三个纯函数与既有先例同口径：裁剪平移同 convert 的 shiftMarks、
// D4 同 bone-axis-guard 的 rotateMark（补齐镜像的角度/分量换算）、
// 仿射同 affineTransformLandmarks 的几何。
// ============================================================

/**
 * 裁剪/改尺寸（内容按 cropOffset 平移、画布变 newW×newH）后的 marks：
 * 点/矢量/矩形按像素平移 + 新尺寸归一（与 landmarks 的 remapLm 同式）；
 * 涂画选区逐格平移重打包；圆形在各向异性改尺寸下不再是圆，按旧格心
 * 判定烘成涂画选区保逐格一致（同 convert shiftMarks）；取色/值/方向
 * 无位置坐标，不动。位置钳到 [0,1]（同 landmarks 的界外贴边）。
 */
export function remapMarksForCrop(
  marks: SpriteMark[] | undefined,
  oldW: number, oldH: number,
  cropOffsetX: number, cropOffsetY: number,
  newW: number, newH: number,
): SpriteMark[] | undefined {
  if (!marks) return undefined;
  return marks.map((m) => {
    switch (m.kind) {
      case 'point':
        return {
          ...m,
          x: clamp01((m.x * oldW + cropOffsetX) / newW),
          y: clamp01((m.y * oldH + cropOffsetY) / newH),
        };
      case 'vector':
        return {
          ...m,
          x: clamp01((m.x * oldW + cropOffsetX) / newW),
          y: clamp01((m.y * oldH + cropOffsetY) / newH),
          dx: (m.dx * oldW) / newW,
          dy: (m.dy * oldH) / newH,
        };
      case 'region': {
        const r = m.region;
        if (r.by === 'rect') {
          const x0 = Math.max(0, r.x * oldW + cropOffsetX);
          const y0 = Math.max(0, r.y * oldH + cropOffsetY);
          const x1 = Math.min(newW, (r.x + r.w) * oldW + cropOffsetX);
          const y1 = Math.min(newH, (r.y + r.h) * oldH + cropOffsetY);
          return {
            ...m,
            region: {
              by: 'rect' as const,
              x: x0 / newW, y: y0 / newH,
              w: Math.max(0, x1 - x0) / newW, h: Math.max(0, y1 - y0) / newH,
            },
          };
        }
        if (r.by === 'circle') {
          const cells = new Uint8Array(newW * newH);
          for (let y = 0; y < oldH; y++) {
            for (let x = 0; x < oldW; x++) {
              const nx = (x + 0.5) / oldW, ny = (y + 0.5) / oldH;
              if (Math.hypot(nx - r.cx, ny - r.cy) > r.r) continue;
              const tx = x + cropOffsetX, ty = y + cropOffsetY;
              if (tx >= 0 && ty >= 0 && tx < newW && ty < newH) cells[ty * newW + tx] = 1;
            }
          }
          return { ...m, region: paintedSpecFromCells(cells, newW, newH) };
        }
        if (r.by === 'painted') {
          const src = unpackMaskBits(r.mask.bits, r.mask.w * r.mask.h);
          const cells = new Uint8Array(newW * newH);
          for (let y = 0; y < r.mask.h; y++) {
            for (let x = 0; x < r.mask.w; x++) {
              if (!src[y * r.mask.w + x]) continue;
              const tx = x + cropOffsetX, ty = y + cropOffsetY;
              if (tx >= 0 && ty >= 0 && tx < newW && ty < newH) cells[ty * newW + tx] = 1;
            }
          }
          return { ...m, region: paintedSpecFromCells(cells, newW, newH) };
        }
        return m; // color 选区与几何无关
      }
      default:
        return m; // value / direction 无位置坐标
    }
  });
}

/** D4 置换下的 marks（与 rotateSpriteD4/transformSprite 的 D4 路同口径） */
export function transformMarksD4(
  marks: SpriteMark[] | undefined,
  op: D4Op,
  w: number, h: number,
): SpriteMark[] | undefined {
  if (!marks) return undefined;
  const dims = d4MapPoint(op, 0, 0, w, h);
  const mapPt = (nx: number, ny: number): { x: number; y: number } => {
    const p = d4MapPoint(op, nx * w, ny * h, w, h);
    return { x: p.x / dims.w, y: p.y / dims.h };
  };
  // 分量线性部分（像素空间作用后按新尺寸归一）
  const lin = (dx: number, dy: number): { x: number; y: number } => {
    const ax = dx * w, ay = dy * h;
    let r: { x: number; y: number };
    switch (op) {
      case 'rot90': r = { x: -ay, y: ax }; break;
      case 'rot270': r = { x: ay, y: -ax }; break;
      case 'rot180': r = { x: -ax, y: -ay }; break;
      case 'flipH': r = { x: -ax, y: ay }; break;
      case 'flipV': r = { x: ax, y: -ay }; break;
      case 'transpose': r = { x: ay, y: ax }; break;
      case 'antiTranspose': r = { x: -ay, y: -ax }; break;
    }
    return { x: r.x / dims.w, y: r.y / dims.h };
  };
  // 方向角（精灵本地视觉角，0=东、顺时针为正、Y 向下）：按反射/旋转
  // 的角度换算，与分量线性部分同构（逐 op 由单位向量映射验证）
  const mapAngle = (deg: number): number => {
    let out: number;
    switch (op) {
      case 'rot90': out = deg + 90; break;
      case 'rot180': out = deg + 180; break;
      case 'rot270': out = deg + 270; break;
      case 'flipH': out = 180 - deg; break;
      case 'flipV': out = -deg; break;
      case 'transpose': out = 90 - deg; break;
      case 'antiTranspose': out = 270 - deg; break;
    }
    return ((out % 360) + 360) % 360;
  };
  return marks.map((m) => {
    switch (m.kind) {
      case 'point': {
        const p = mapPt(m.x, m.y);
        return { ...m, x: p.x, y: p.y };
      }
      case 'vector': {
        const p = mapPt(m.x, m.y);
        const d = lin(m.dx, m.dy);
        return { ...m, x: p.x, y: p.y, dx: d.x, dy: d.y };
      }
      case 'direction':
        return { ...m, angleDeg: mapAngle(m.angleDeg) };
      case 'region': {
        const r = m.region;
        if (r.by === 'rect') {
          const a = mapPt(r.x, r.y);
          const b = mapPt(r.x + r.w, r.y + r.h);
          return {
            ...m,
            region: {
              by: 'rect' as const,
              x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
              w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
            },
          };
        }
        if (r.by === 'circle') {
          const c = mapPt(r.cx, r.cy);
          // r 是归一空间的距离（hypot 对轴交换/翻转不变），原样保留
          return { ...m, region: { by: 'circle' as const, cx: c.x, cy: c.y, r: r.r } };
        }
        if (r.by === 'painted') {
          const cells = cellsFromPaintedSpec(r, r.mask.w, r.mask.h);
          const grid: number[][] = [];
          for (let y = 0; y < r.mask.h; y++) grid.push(Array.from(cells.slice(y * r.mask.w, (y + 1) * r.mask.w)));
          const rotated = d4TransformGrid(grid, op, 0);
          const flat = new Uint8Array(rotated.length * (rotated[0]?.length ?? 0));
          rotated.forEach((row, y) => row.forEach((v, x) => { flat[y * row.length + x] = v; }));
          return { ...m, region: paintedSpecFromCells(flat, rotated[0]?.length ?? 0, rotated.length) };
        }
        return m; // color
      }
      default:
        return m; // value
    }
  });
}

/**
 * 任意仿射下的 marks（m 为源→目标矩阵，目标原点在 (minX,minY)，
 * 与 affineTransformLandmarks 同几何）：点/矢量锚点按点映射、贴边钳制；
 * 矢量分量与方向角按线性部分换算；矩形取四角包围盒（仿射下矩形不保
 * 矩形，包围盒是近似，注释明示）；圆/涂画先按旧格判定成格、再走与
 * heightmap 同一重采样（最近邻）烘成涂画选区。
 */
export function transformMarksAffine(
  marks: SpriteMark[] | undefined,
  mtx: Affine2D,
  minX: number, minY: number,
  newW: number, newH: number,
  oldW: number, oldH: number,
): SpriteMark[] | undefined {
  if (!marks) return undefined;
  const mapPt = (nx: number, ny: number): { x: number; y: number } => {
    const p = applyAffine(mtx, nx * oldW, ny * oldH);
    return { x: clamp01((p.x - minX) / newW), y: clamp01((p.y - minY) / newH) };
  };
  const linPx = (dxPx: number, dyPx: number): { x: number; y: number } => ({
    x: mtx.a * dxPx + mtx.c * dyPx,
    y: mtx.b * dxPx + mtx.d * dyPx,
  });
  const resampleCells = (cells: Uint8Array): { by: 'painted'; mask: { w: number; h: number; bits: string } } => {
    const grid: number[][] = [];
    for (let y = 0; y < oldH; y++) grid.push(Array.from(cells.slice(y * oldW, (y + 1) * oldW)));
    const out = resampleGridAffine(grid, mtx, minX, minY, newW, newH, 0);
    const flat = new Uint8Array(newW * newH);
    if (out) {
      out.forEach((row, y) => row.forEach((v, x) => { if (v >= 0.5) flat[y * newW + x] = 1; }));
    }
    return paintedSpecFromCells(flat, newW, newH);
  };
  return marks.map((mk) => {
    switch (mk.kind) {
      case 'point': {
        const p = mapPt(mk.x, mk.y);
        return { ...mk, x: p.x, y: p.y };
      }
      case 'vector': {
        const p = mapPt(mk.x, mk.y);
        const d = linPx(mk.dx * oldW, mk.dy * oldH);
        return { ...mk, x: p.x, y: p.y, dx: d.x / newW, dy: d.y / newH };
      }
      case 'direction': {
        const rad = (mk.angleDeg * Math.PI) / 180;
        const v = linPx(Math.cos(rad), Math.sin(rad));
        if (v.x === 0 && v.y === 0) return mk;
        const deg = ((Math.atan2(v.y, v.x) * 180) / Math.PI + 360) % 360;
        return { ...mk, angleDeg: deg };
      }
      case 'region': {
        const r = mk.region;
        if (r.by === 'rect') {
          const corners = [
            mapPt(r.x, r.y), mapPt(r.x + r.w, r.y),
            mapPt(r.x, r.y + r.h), mapPt(r.x + r.w, r.y + r.h),
          ];
          const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
          const x0 = Math.min(...xs), x1 = Math.max(...xs);
          const y0 = Math.min(...ys), y1 = Math.max(...ys);
          return { ...mk, region: { by: 'rect' as const, x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
        }
        if (r.by === 'circle') {
          const cells = new Uint8Array(oldW * oldH);
          for (let y = 0; y < oldH; y++) {
            for (let x = 0; x < oldW; x++) {
              const nx = (x + 0.5) / oldW, ny = (y + 0.5) / oldH;
              if (Math.hypot(nx - r.cx, ny - r.cy) <= r.r) cells[y * oldW + x] = 1;
            }
          }
          return { ...mk, region: resampleCells(cells) };
        }
        if (r.by === 'painted') {
          return { ...mk, region: resampleCells(cellsFromPaintedSpec(r, oldW, oldH)) };
        }
        return mk; // color
      }
      default:
        return mk; // value
    }
  });
}
