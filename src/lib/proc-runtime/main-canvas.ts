// ============================================================
// 主画布参数化适配：把 ParametricAppearance 烘焙成产品 Sprite，
// 供 unified-render 的 resolveSprite 在「参数化优先」时回注。
// 烘焙与运行时包同源（bake-src：DAG 走 compileTileDAG、层程序
// 走 compileTileLayers）；着色是运行时片元的静态移植（t=0）：
// 占据暴露 → LIGHT 档位重映射、OUTLINE 外环/内描、RIM/GLINT
// 哈希门（种子 = 节点 id 哈希，确定性）。烘焙在运行时空间完成
// （与转换器同一套 y 翻转），最终像素网格再垂直翻回产品空间。
// 方向口径：东向为基，西半向（NW/W/SW = 3/4/5）走渲染器 mirror。
// ============================================================

import { pxToSub, subToPx, type ParametricAppearance, type PixelGrid, type Sprite } from '../unified-types';
import { createSurfaceBaker } from './bake-src';
import { PALETTES } from './palettes';
import { hashPixelGrid } from '../engine/render-cache';

let bakerSingleton: ReturnType<typeof createSurfaceBaker> | null = null;
function baker() {
  if (!bakerSingleton) bakerSingleton = createSurfaceBaker();
  return bakerSingleton;
}

/** 西半方向（渲染时镜像东向基图） */
export const PARAMETRIC_MIRROR_DIRECTIONS = new Set([3, 4, 5]);

export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 37.7;
}

/** 与转换器 appearanceToBase 同一翻转口径的运行时形状 */
function runtimeShape(app: ParametricAppearance) {
  if (app.shape.kind === 'poly') {
    return {
      kind: 'poly',
      size: app.shape.size,
      points: (app.shape.poly ?? []).map(([x, y]) => [x, -y] as [number, number]),
      pivot: app.shape.polyPivot
        ? ([app.shape.polyPivot[0], -app.shape.polyPivot[1]] as [number, number])
        : ([0, 0] as [number, number]),
    };
  }
  return { kind: app.shape.kind, size: app.shape.size, roundness: app.shape.roundness ?? 0 };
}

/** GLSL hash12 的 JS 移植 */
function hash12(x: number, y: number): number {
  let p3x = (x * 0.1031) % 1; if (p3x < 0) p3x += 1;
  let p3y = (y * 0.1031) % 1; if (p3y < 0) p3y += 1;
  let p3z = (x * 0.1031) % 1; if (p3z < 0) p3z += 1;
  const dot = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += dot; p3y += dot; p3z += dot;
  const r = ((p3x + p3y) * p3z) % 1;
  return r < 0 ? r + 1 : r;
}

const hexOf = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

interface Tile {
  w: number; h: number; cx: number; cy: number; data: Uint8Array;
}

/** 运行时片元的静态移植：档位瓦片 → 产品空间像素网格（已垂直翻转） */
export function shadeTileStatic(tile: Tile, app: ParametricAppearance, seed: number): PixelGrid {
  const pal = PALETTES[app.palette] ?? PALETTES.shirt;
  const { w, h } = tile;
  const R = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 255 : tile.data[(j * w + i) * 4]);
  const G = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : tile.data[(j * w + i) * 4 + 1]);
  const B = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : tile.data[(j * w + i) * 4 + 2]);
  const lm = app.light, om = app.outline, rm = app.rim, gm = app.glint;
  const rows: PixelGrid = [];
  for (let j = 0; j < h; j++) {
    const row: (string | null)[] = [];
    for (let i = 0; i < w; i++) {
      const r0 = R(i, j);
      if (r0 >= 128) {
        let color: string | null = null;
        if (r0 === 254) {
          const nL = R(i - 1, j) < 128, nR = R(i + 1, j) < 128;
          const nT = R(i, j - 1) < 128, nB = R(i, j + 1) < 128;
          let draw = false;
          if (om === 1) draw = nL || nR || nB || nT;
          else if (om === 3) draw = nR || nB;
          else if (om === 4) draw = nT;
          if (draw) color = hexOf(pal[0]);
        }
        if (!color) {
          const hb = B(i, j);
          if (hb > 0) color = hexOf(pal[(hb & 16) ? 4 : Math.max(0, Math.min(7, (hb & 15) - 1))]);
        }
        row.push(color);
        continue;
      }
      // 暴露侧（邻居为外）：与片元 in* 语义一致（in = 该侧非占据）
      const exL = R(i - 1, j) >= 128, exR = R(i + 1, j) >= 128;
      const exT = R(i, j - 1) >= 128, exB = R(i, j + 1) >= 128;
      const anyEx = exL || exR || exB || exT;
      let slot = r0;
      if (slot >= 1 && slot <= 3) {
        let isLit = false, isDark = false;
        if (lm === 1) { isLit = exT; isDark = exB; }
        else if (lm === 2) { isLit = exT || exL; isDark = exB || exR; }
        else if (lm === 3) { isLit = exT || exR; isDark = exB || exL; }
        else if (lm === 4) { isLit = exB; isDark = exT; }
        else if (lm === 5) { isLit = anyEx; isDark = !anyEx; }
        else if (lm === 6) { isLit = true; }
        if (isDark) slot = 1;
        else if (isLit) slot = 3;
      }
      const gx = i - tile.cx, gy = j - tile.cy;
      let rimHit = false;
      if (rm === 1) rimHit = exT && exL;
      else if (rm === 2) rimHit = exT && exR;
      else if (rm === 3) rimHit = exL || exR;
      else if (rm === 4) rimHit = exB;
      else if (rm === 5) rimHit = anyEx;
      else if (rm === 6) {
        const yN = gy / Math.max(h - 4, 1) + 0.5;
        rimHit = anyEx && Math.abs(yN) < 0.12;
      }
      if (rimHit && hash12(gx + seed, gy + seed) < app.rimI) slot = 4;
      if (G(i, j) > 89) {
        let gHit = false;
        if (gm === 1) gHit = exT && exR;
        else if (gm === 2) gHit = anyEx && hash12(gx, gy) > 0.93;
        else if (gm === 3) {
          const along = exL || exR ? gy : gx;
          const fr = (along * 0.25) % 1;
          gHit = anyEx && (fr < 0 ? fr + 1 : fr) < 0.18;
        }
        if (gHit && hash12(gx * 1.7 + seed, gy * 1.7 + seed) < app.glintI) slot = 4;
      }
      if (om === 2 && anyEx) slot = 0;
      row.push(hexOf(pal[Math.max(0, Math.min(7, slot))]));
    }
    rows.push(row);
  }
  rows.reverse(); // 运行时烘焙空间 → 产品空间（垂直翻回）
  return rows;
}

const spriteCache = new Map<string, Sprite>();

function cacheKey(app: ParametricAppearance): string {
  const g = app.surfaceGraph
    ? { ...app.surfaceGraph, ui: undefined }
    : undefined;
  return JSON.stringify({ ...app, surfaceGraph: g });
}

/** 轮廓外延宽度（0..8，烘焙边距 = 2 + 此值） */
function haloOf(app: ParametricAppearance): number {
  return Math.max(0, Math.min(8, Math.floor(app.haloWidth ?? 0)));
}

/** overlay 档：精灵原色按档位调亮调暗的系数（档位 2 = 不动） */
const OVERLAY_SLOT_FACTOR: Record<number, number> = { 0: 0.55, 1: 0.78, 2: 1.0, 3: 1.22 };

function scaleHex(hex: string, f: number): string {
  if (f === 1) return hex;
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * overlay 着色：精灵像素作底，档位只调亮度；描边环、内描、轮缘光、
 * 闪光出调色板色。暴露/枚举判定与 shadeTileStatic 逐项同口径（孪生
 * 实现，改一处须同步另一处）。瓦片来自栅格烘焙（边距 M=2，源图进场
 * 已垂直翻转），底像素按同一翻转取回，最终行序翻回产品空间——净
 * 效果 = 原图四周 pad 2px。
 */
export function shadeTileOverSprite(tile: Tile, base: Sprite, app: ParametricAppearance, seed: number): PixelGrid {
  const pal = PALETTES[app.palette] ?? PALETTES.shirt;
  const { w, h } = tile;
  const M = 2 + haloOf(app);
  const R = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 255 : tile.data[(j * w + i) * 4]);
  const G = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : tile.data[(j * w + i) * 4 + 1]);
  const B = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : tile.data[(j * w + i) * 4 + 2]);
  const basePx = (i: number, j: number): string | null => {
    const sx = i - M, syB = j - M;
    if (sx < 0 || syB < 0 || sx >= base.width || syB >= base.height) return null;
    return base.data[base.height - 1 - syB]?.[sx] ?? null;
  };
  const lm = app.light, om = app.outline, rm = app.rim, gm = app.glint;
  const rows: PixelGrid = [];
  for (let j = 0; j < h; j++) {
    const row: (string | null)[] = [];
    for (let i = 0; i < w; i++) {
      const r0 = R(i, j);
      if (r0 >= 128) {
        let color: string | null = null;
        if (r0 === 254) {
          const nL = R(i - 1, j) < 128, nR = R(i + 1, j) < 128;
          const nT = R(i, j - 1) < 128, nB = R(i, j + 1) < 128;
          let draw = false;
          if (om === 1) draw = nL || nR || nB || nT;
          else if (om === 3) draw = nR || nB;
          else if (om === 4) draw = nT;
          if (draw) color = hexOf(pal[0]);
        }
        if (!color) {
          const hb = B(i, j);
          if (hb > 0) color = hexOf(pal[(hb & 16) ? 4 : Math.max(0, Math.min(7, (hb & 15) - 1))]);
        }
        row.push(color);
        continue;
      }
      const exL = R(i - 1, j) >= 128, exR = R(i + 1, j) >= 128;
      const exT = R(i, j - 1) >= 128, exB = R(i, j + 1) >= 128;
      const anyEx = exL || exR || exB || exT;
      let slot = r0;
      if (slot >= 1 && slot <= 3) {
        let isLit = false, isDark = false;
        if (lm === 1) { isLit = exT; isDark = exB; }
        else if (lm === 2) { isLit = exT || exL; isDark = exB || exR; }
        else if (lm === 3) { isLit = exT || exR; isDark = exB || exL; }
        else if (lm === 4) { isLit = exB; isDark = exT; }
        else if (lm === 5) { isLit = anyEx; isDark = !anyEx; }
        else if (lm === 6) { isLit = true; }
        if (isDark) slot = 1;
        else if (isLit) slot = 3;
      }
      const gx = i - tile.cx, gy = j - tile.cy;
      let rimHit = false;
      if (rm === 1) rimHit = exT && exL;
      else if (rm === 2) rimHit = exT && exR;
      else if (rm === 3) rimHit = exL || exR;
      else if (rm === 4) rimHit = exB;
      else if (rm === 5) rimHit = anyEx;
      else if (rm === 6) {
        const yN = gy / Math.max(h - 4, 1) + 0.5;
        rimHit = anyEx && Math.abs(yN) < 0.12;
      }
      let forcePal = -1; // ≥0 时直接出调色板该档（覆盖亮度调制）
      if (rimHit && hash12(gx + seed, gy + seed) < app.rimI) forcePal = 4;
      if (G(i, j) > 89) {
        let gHit = false;
        if (gm === 1) gHit = exT && exR;
        else if (gm === 2) gHit = anyEx && hash12(gx, gy) > 0.93;
        else if (gm === 3) {
          const along = exL || exR ? gy : gx;
          const fr = (along * 0.25) % 1;
          gHit = anyEx && (fr < 0 ? fr + 1 : fr) < 0.18;
        }
        if (gHit && hash12(gx * 1.7 + seed, gy * 1.7 + seed) < app.glintI) forcePal = 4;
      }
      if (om === 2 && anyEx) forcePal = 0;
      if (forcePal >= 0) {
        row.push(hexOf(pal[Math.max(0, Math.min(7, forcePal))]));
        continue;
      }
      const bp = basePx(i, j);
      if (bp === null || bp === '') {
        row.push(hexOf(pal[Math.max(0, Math.min(7, slot))]));
      } else {
        row.push(scaleHex(bp, OVERLAY_SLOT_FACTOR[slot] ?? 1));
      }
    }
    rows.push(row);
  }
  rows.reverse();
  return rows;
}

/** overlay 档的写出过滤：只留 bump 写出与 glint 通道（图案写出忽略） */
function filterGraphForOverlay<T extends { writes: unknown[] }>(graph: T): T {
  return {
    ...graph,
    writes: graph.writes.filter((wr) => {
      const w = wr as { bump?: unknown; ch?: string };
      return w.bump !== undefined || w.ch === 'glint';
    }),
  };
}

/** 参数化外观 → 产品 Sprite（带缓存）；烘焙失败返回 null（回落精灵） */
export function buildParametricSprite(
  app: ParametricAppearance,
  seedKey: string,
  baseSprite?: Sprite,
): Sprite | null {
  const mode = app.composite ?? 'generate';
  if (mode !== 'generate' && baseSprite && baseSprite.width > 0 && baseSprite.height > 0) {
    return buildCompositeSprite(app, seedKey, baseSprite, mode);
  }
  return buildGenerateSprite(app, seedKey);
}

function buildGenerateSprite(app: ParametricAppearance, seedKey: string): Sprite | null {
  const key = `${cacheKey(app)}|${seedKey}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  try {
    const shape = runtimeShape(app);
    const tile = app.surfaceGraph
      ? baker().compileTileDAG(shape, app.surfaceGraph, haloOf(app))
      : baker().compileTileLayers(shape, app.surface, haloOf(app));
    const seed = seedFromString(seedKey);
    const data = shadeTileStatic(tile, app, seed);
    // plug：节点原点在瓦片中的位置（形状中心 − 运行时中心偏移），翻回产品空间
    const offRt: [number, number] = [app.centerOffset[0], -app.centerOffset[1]];
    const plugPx: [number, number] = [tile.cx - offRt[0], tile.h - (tile.cy - offRt[1])];
    const sprite: Sprite = {
      width: tile.w,
      height: tile.h,
      data,
      plug: { x: pxToSub(plugPx[0]), y: pxToSub(plugPx[1]) },
    };
    if (spriteCache.size > 96) spriteCache.clear();
    spriteCache.set(key, sprite);
    return sprite;
  } catch {
    return null;
  }
}

/** silhouette / overlay：以节点精灵为轮廓来源烘焙；无实心像素回落独立生成 */
function buildCompositeSprite(
  app: ParametricAppearance,
  seedKey: string,
  base: Sprite,
  mode: 'silhouette' | 'overlay',
): Sprite | null {
  const key = `${cacheKey(app)}|${seedKey}|C:${mode}|${hashPixelGrid(base.data)}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  try {
    const rw = base.width, rh = base.height;
    const solid = new Uint8Array(rw * rh);
    let solidCount = 0;
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const c = base.data[y]?.[x];
        if (c !== null && c !== undefined && c !== '') { solid[y * rw + x] = 1; solidCount++; }
      }
    }
    if (solidCount === 0) return buildGenerateSprite(app, seedKey);
    const plugPx: [number, number] = base.plug
      ? [subToPx(base.plug.x), subToPx(base.plug.y)]
      : [rw / 2, rh / 2];
    const raster = { w: rw, h: rh, plugX: plugPx[0], plugY: plugPx[1], solid };
    const halo = haloOf(app);
    const tile = app.surfaceGraph
      ? baker().compileTileDAGRaster(
          raster,
          mode === 'overlay' ? filterGraphForOverlay(app.surfaceGraph) : app.surfaceGraph,
          halo,
        )
      : baker().compileTileLayersRaster(
          raster,
          mode === 'overlay'
            ? app.surface.filter(
                (l) => (l as { bumpForm?: string }).bumpForm !== undefined || (l as { ch?: string }).ch === 'glint',
              )
            : app.surface,
          halo,
        );
    // overlay 档轮廓内过滤掉的图案写出，在轮廓外照常生效（外圈无底
    // 像素）：用未过滤程序再烘一遍，只把非占据像素的 B 通道（外延
    // 写出编码）并进来。
    if (mode === 'overlay' && halo > 0) {
      const full = app.surfaceGraph
        ? baker().compileTileDAGRaster(raster, app.surfaceGraph, halo)
        : baker().compileTileLayersRaster(raster, app.surface, halo);
      for (let p = 0; p < tile.w * tile.h; p++) {
        if (tile.data[p * 4]! >= 128) tile.data[p * 4 + 2] = full.data[p * 4 + 2]!;
      }
    }
    const seed = seedFromString(seedKey);
    const data = mode === 'overlay'
      ? shadeTileOverSprite(tile, base, app, seed)
      : shadeTileStatic(tile, app, seed);
    // 两次垂直翻转相消：产物 = 原图四周 pad (2+halo)px，plug 同步平移
    const sprite: Sprite = {
      width: tile.w,
      height: tile.h,
      data,
      plug: { x: pxToSub(plugPx[0] + 2 + halo), y: pxToSub(plugPx[1] + 2 + halo) },
    };
    if (spriteCache.size > 96) spriteCache.clear();
    spriteCache.set(key, sprite);
    return sprite;
  } catch {
    return null;
  }
}
