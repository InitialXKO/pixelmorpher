// ============================================================
// 程序化运行时模板：把运行时包打包成自包含 HTML。
// 运行时本体 = 渲染核心（mask 瓦片 + GPU instanced）+ 图求值器
// （eval-src：行为图实时求值 + 表演图采样曲线）。程序化预览（iframe）
// 与导出「程序化运行时包」共用此模板——预览所见即导出所得。
// 宿主接口：键盘 A/D/方向键移动、W 跳、表演触发键；自动行走可切。
// ============================================================
import type { ProcRuntimePackage } from './convert';
import { RUNTIME_EVAL_SRC } from './eval-src';
import { BAKE_SRC } from './bake-src';
import { DYNAMIC_SRC } from './dynamic-src';

export function buildRuntimeHtml(pkg: ProcRuntimePackage): string {
  const json = JSON.stringify(pkg).replace(/</g, '\\u003c');
  return TEMPLATE
    .split('/*__PACKAGE__*/').join(json)
    .split('/*__EVAL__*/').join(RUNTIME_EVAL_SRC)
    .split('/*__BAKE__*/').join(BAKE_SRC)
    .split('/*__DYNAMIC__*/').join(DYNAMIC_SRC);
}

const TEMPLATE = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>程序化像素角色运行时</title>
<style>
  html, body { margin: 0; height: 100%; background: #12122a; overflow: hidden; }
  canvas { display: block; image-rendering: pixelated; }
  #hud { position: fixed; top: 8px; left: 10px; color: #9a9ac0; font: 12px/1.5 system-ui, sans-serif; pointer-events: none; }
  #hud b { color: #e8e8ff; }
  #bar { position: fixed; top: 8px; right: 10px; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; font: 11px system-ui, sans-serif; }
  #bar .row { display: flex; gap: 4px; align-items: center; }
  #bar .lab { color: #6a6a9a; margin-right: 2px; }
  #bar button { background: #1a1a38; color: #b8b8e0; border: 1px solid #2e2e55; border-radius: 4px; padding: 3px 7px; cursor: pointer; font: 11px system-ui, sans-serif; }
  #bar button.on { background: #2c4a8a; color: #fff; border-color: #4a6fd4; }
  #warn { position: fixed; left: 10px; bottom: 8px; color: #c8a84a; font: 11px/1.5 system-ui, sans-serif; max-width: 60%; white-space: pre-wrap; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="hud"></div>
<div id="bar"></div>
<div id="warn"></div>
<script>
'use strict';
const EMBEDDED = /*__PACKAGE__*/;

// === PURE BEGIN ===
/** 线段距离（仅烘焙期用） */
function sdSegment(px, py, s) {
  const vx = s[2] - s[0], vy = s[3] - s[1];
  const wx = px - s[0], wy = py - s[1];
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy || 1)));
  const dx = wx - vx * t, dy = wy - vy * t;
  return Math.hypot(dx, dy);
}
function turtleToPoints(cmds, start = [0, 0], headingDeg = -90) {
  const pts = [[start[0], start[1]]];
  let [x, y] = start, h = (headingDeg * Math.PI) / 180;
  for (const [op, v] of cmds) {
    if (op === 'FD') { x += Math.cos(h) * v; y += Math.sin(h) * v; pts.push([x, y]); }
    else if (op === 'RT') h += (v * Math.PI) / 180;
    else if (op === 'LT') h -= (v * Math.PI) / 180;
    else throw new Error('turtle: 未知指令 ' + op);
  }
  return pts;
}
function pointsToSegments(points, pivot) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    segs.push([points[i][0] - pivot[0], points[i][1] - pivot[1], points[i + 1][0] - pivot[0], points[i + 1][1] - pivot[1]]);
  }
  return segs;
}
function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** 形状场（烘焙期）：{inside, d} */
function shapeField(shape, px, py) {
  const [w, h] = shape.size;
  if (shape.kind === 'poly') {
    const pts = shape.points, piv = shape.pivot || [0, 0];
    const rel = pts.map(([x, y]) => [x - piv[0], y - piv[1]]);
    let d = Infinity;
    for (let i = 0; i < rel.length; i++) {
      const a = rel[i], b = rel[(i + 1) % rel.length];
      d = Math.min(d, sdSegment(px, py, [a[0], a[1], b[0], b[1]]));
    }
    return { inside: pointInPolygon(px, py, rel), d };
  }
  if (shape.kind === 'ellipse') {
    const rx = Math.max(w / 2, 0.5), ry = Math.max(h / 2, 0.5);
    const q = Math.hypot(px / rx, py / ry);
    return { inside: q <= 1, d: Math.abs(q - 1) * Math.min(rx, ry) };
  }
  if (shape.kind === 'capsule') {
    const r = Math.min(w, h) / 2;
    const ax = Math.max(0, w / 2 - r), ay = Math.max(0, h / 2 - r);
    const cx = Math.max(-ax, Math.min(ax, px)), cy = Math.max(-ay, Math.min(ay, py));
    const d = Math.hypot(px - cx, py - cy) - r;
    return { inside: d <= 0, d: Math.abs(d) };
  }
  const r = Math.max(0, Math.min(1, shape.roundness ?? 0)) * Math.min(w, h) / 2;
  const qx = Math.abs(px) - (w / 2 - r), qy = Math.abs(py) - (h / 2 - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  const dOut = Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
  return { inside: dOut <= 0, d: Math.abs(dOut) };
}
/** pattern 层语言的 mask 原语（烘焙期） */
function maskHit(mask, ctx) {
  switch (mask.m) {
    case 'all': return true;
    case 'inside': return ctx.inside;
    case 'edge': return ctx.d <= mask.w;
    case 'band': return ctx.d > mask.w0 && ctx.d <= mask.w1;
    case 'bands': {
      const v = mask.axis === 'x' ? ctx.px : mask.axis === 'y' ? ctx.py : ctx.px + ctx.py * 0.35;
      const f = ((v / mask.f + (mask.ph ?? 0)) % 1 + 1) % 1;
      return f < (mask.duty ?? 0.5);
    }
    case 'checker': {
      const cx = Math.floor(ctx.px / mask.f), cy = Math.floor(ctx.py / mask.f);
      return ((cx + cy) % 2 + 2) % 2 === 0;
    }
    case 'noise': {
      const cx = Math.floor(ctx.px / mask.f), cy = Math.floor(ctx.py / mask.f);
      let hs = Math.sin(cx * 127.1 + cy * 311.7 + (mask.seed ?? 0) * 74.7) * 43758.5453;
      hs -= Math.floor(hs);
      return hs > (mask.gt ?? 0.72);
    }
    case 'gradLt': {
      const v = mask.axis === 'x' ? ctx.px01 : ctx.py01;
      return v < mask.t;
    }
    case 'facing': {
      if (ctx.d > (mask.w ?? 1.6)) return false;
      const deg = (Math.atan2(ctx.gy, ctx.gx) * 180) / Math.PI;
      const diff = Math.abs(((deg - mask.deg) % 360 + 540) % 360 - 180);
      return diff <= (mask.tol ?? 55);
    }
    default: throw new Error('pattern: 未知 mask 原语 ' + mask.m);
  }
}
/** bump 枚举公式（烘焙期）：以距离场为伪高度图，输出 0..1 明暗量。
 *  枚举的是公式目录本身——著者选形式，公式内部可以是连续的。 */
function bumpValue(form, ctx) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  switch (form) {
    case 'dome': return cl(ctx.h);                                   // 穹面：中心高
    case 'top': return cl(0.30 + 0.45 * ctx.h + 0.25 * ctx.gy);      // 顶光：高度 + 向下梯度
    case 'side': return cl(0.30 + 0.45 * ctx.h + 0.25 * ctx.gx);     // 侧光
    case 'edge': return cl(1 - ctx.h);                               // 缘光：边缘高
    default: throw new Error('bump: 未知形式 ' + form);
  }
}
/** 枚举形式目录（层语言一侧） */
const F = {
  lightFlat: (slot = 2) => [{ mask: { m: 'inside' }, slot }],
  lightGradY: (slots = [3, 2, 1]) => [
    { mask: { m: 'inside' }, slot: slots[2] },
    { mask: { m: 'gradLt', axis: 'y', t: 0.66 }, slot: slots[1] },
    { mask: { m: 'gradLt', axis: 'y', t: 0.33 }, slot: slots[0] },
  ],
  lightGradX: (slots = [1, 2, 3]) => [
    { mask: { m: 'inside' }, slot: slots[0] },
    { mask: { m: 'gradLt', axis: 'x', t: 0.66 }, slot: slots[2] },
    { mask: { m: 'gradLt', axis: 'x', t: 0.33 }, slot: slots[1] },
  ],
  outlineDark: (w = 1) => [{ mask: { m: 'edge', w }, slot: 0 }],
  rimBand: (deg, slot = 4, w = 1.8, tol = 60) => [{ mask: { m: 'facing', deg, tol, w }, slot }],
  glintFace: (deg = 45, tol = 65) => [{ mask: { m: 'facing', deg, tol, w: 99 }, slot: 0, ch: 'glint' }],
  stripes: (slot = 5, f = 3, ph = 0, duty = 0.5) => [{ mask: { m: 'bands', axis: 'd', f, ph, duty }, slot }],
  checker: (slot = 5, f = 3) => [{ mask: { m: 'checker', f }, slot }],
  speckle: (slot = 3, f = 2, seed = 1, gt = 0.72) => [{ mask: { m: 'noise', f, seed, gt }, slot }],
  scales: (slot = 1, f = 3) => [{ mask: { m: 'bands', axis: 'y', f, ph: 0, duty: 0.5 }, slot }],
  /** bump 形式层：公式输出按两阈值量化成 lo/mid/hi 三档 */
  bump: (form = 'dome', hi = 3, mid = 2, lo = 1) => [{ bumpForm: form, hi, mid, lo }],
};
/** shape + 层程序 → mask 瓦片（两遍：先算场与最大内切距离，再求层） */
function compileTile(shape, program) {
  const M = 2;
  const w = Math.ceil(shape.size[0]) + M * 2;
  const h = Math.ceil(shape.size[1]) + M * 2;
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const hasGlint = program.some((l) => l.ch === 'glint');
  const fields = new Array(w * h);
  let maxD = 0.0001;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const lx = i - cx, ly = j - cy;
      const f0 = shapeField(shape, lx, ly);
      const gx = shapeField(shape, lx + 1, ly).d - shapeField(shape, lx - 1, ly).d;
      const gy = shapeField(shape, lx, ly + 1).d - shapeField(shape, lx, ly - 1).d;
      fields[j * w + i] = { lx, ly, inside: f0.inside, d: f0.d, gx, gy };
      if (f0.inside) maxD = Math.max(maxD, f0.d);
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const f0 = fields[j * w + i];
      const o = (j * w + i) * 4;
      data[o + 3] = 255;
      const occ = f0.inside || f0.d <= 0.5;
      if (!occ) {
        data[o] = f0.d <= 1.5 ? 254 : 255;
        continue;
      }
      const ctx = {
        px: f0.lx, py: f0.ly,
        px01: shape.size[0] > 0 ? (f0.lx + shape.size[0] / 2) / shape.size[0] : 0.5,
        py01: shape.size[1] > 0 ? (f0.ly + shape.size[1] / 2) / shape.size[1] : 0.5,
        inside: f0.inside, d: f0.d, gx: f0.gx, gy: f0.gy,
        h: f0.inside ? f0.d / maxD : 0,
      };
      let slot = 2, g = hasGlint ? 0 : 255;
      for (const layer of program) {
        if (layer.bumpForm) {
          const v = bumpValue(layer.bumpForm, ctx);
          slot = v > 0.66 ? layer.hi : v > 0.33 ? layer.mid : layer.lo;
          continue;
        }
        if (!maskHit(layer.mask, ctx)) continue;
        if (layer.ch === 'glint') g = 255;
        else slot = layer.slot;
      }
      data[o] = slot;
      data[o + 1] = g;
    }
  }
  return { w, h, cx, cy, data };
}
function packAtlas(tiles, atlasW) {
  const placements = [];
  let x = 0, y = 0, shelfH = 0;
  for (const t of tiles) {
    if (x + t.w > atlasW) { x = 0; y += shelfH; shelfH = 0; }
    placements.push([x, y]);
    x += t.w;
    shelfH = Math.max(shelfH, t.h);
  }
  return { placements, height: y + shelfH };
}
const MIRROR_VARIANT = { 1: 7, 7: 1, 3: 5, 5: 3 };
const DIAGONAL_MAIN = { 1: 2, 3: 4, 5: 4, 7: 6 };
function mirrorParams(p) {
  const out = { ...p };
  if (p.pivot) out.pivot = [-p.pivot[0], p.pivot[1]];
  if (p.off) out.off = [-p.off[0], p.off[1]];
  if (p.angle !== undefined) out.angle = -p.angle;
  if (p.poly) out.poly = p.poly.map(([x, y]) => [-x, y]);
  return out;
}
function resolveVariantParams(part, variant) {
  if (part.variants && part.variants[variant]) return part.variants[variant];
  const mirror = MIRROR_VARIANT[variant];
  if (mirror !== undefined && part.variants && part.variants[mirror]) return part.variants[mirror];
  const main = DIAGONAL_MAIN[variant];
  if (main !== undefined) {
    if (part.variants && part.variants[main]) return part.variants[main];
    const m2 = MIRROR_VARIANT[main];
    if (m2 !== undefined && part.variants && part.variants[m2]) return part.variants[m2];
  }
  if (variant === 6 && part.variants && part.variants[2]) return part.variants[2];
  return {};
}
function variantMirrored(part, variant) {
  if (part.variants && part.variants[variant]) return false;
  const mirror = MIRROR_VARIANT[variant];
  if (mirror !== undefined && part.variants && part.variants[mirror]) return true;
  const main = DIAGONAL_MAIN[variant];
  if (main !== undefined) {
    if (part.variants && part.variants[main]) return false;
    const m2 = MIRROR_VARIANT[main];
    if (m2 !== undefined && part.variants && part.variants[m2]) return true;
  }
  if (variant === 6 && part.variants && part.variants[2]) return true;
  if (variant === 4) return true;
  return false;
}
function resolvePart(part, variantIndex, costume) {
  let p = { ...part.base, ...resolveVariantParams(part, variantIndex) };
  if (variantMirrored(part, variantIndex)) p = mirrorParams(p);
  if (costume && part.costumeKeys && part.costumeKeys.length > 0) {
    const c = costume[part.costumeKeys[0]];
    if (c === null) { p.size = [0.001, 0.001]; p.hidden = true; }
    else if (c) {
      if (c.pal) p.pal = c.pal;
      if (c.size) p.size = c.size;
      if (c.roundness !== undefined) p.roundness = c.roundness;
      if (c.surfaceGraph !== undefined) p.surfaceGraph = c.surfaceGraph;
      if (c.composite !== undefined) p.composite = c.composite;
      if (c.haloWidth !== undefined) p.haloWidth = c.haloWidth;
      if (c.baseSprite !== undefined) p.baseSprite = c.baseSprite;
    }
  }
  const shape = p.poly
    ? { kind: 'poly', size: p.size, points: p.poly, pivot: p.polyPivot || [0, 0] }
    : { kind: p.shapeKind || 'rect', size: p.size, roundness: p.roundness ?? 0 };
  return {
    params: p, shape,
    program: p.surface || [{ mask: { m: 'inside' }, slot: 2 }],
    graph: p.surfaceGraph || null,
    composite: p.composite || 'generate',
    halo: p.haloWidth || 0,
    baseSprite: p.baseSprite || null,
  };
}
/** overlay 档写出过滤（与主画布同口径：只留 bump 写出与 glint 通道） */
function filterGraphForOverlayRt(graph) {
  return { ...graph, writes: graph.writes.filter((w) => w.bump !== undefined || w.ch === 'glint') };
}
function filterLayersForOverlayRt(program) {
  return program.filter((l) => l.bumpForm !== undefined || l.ch === 'glint');
}
/** 瓦片烘焙：三档合成 + 轮廓外延（与主画布 buildParametricSprite 同口径）。
 * phase（动态表面 D1）：本瓦片的相位 0..1，静态部件恒 0。 */
function bakeResolvedTile(resolved, mirrored, phase) {
  const halo = resolved.halo || 0;
  const bs = resolved.baseSprite;
  if (resolved.composite !== 'generate' && bs && bs.w > 0 && bs.h > 0) {
    const solid = new Uint8Array(bs.w * bs.h);
    let cnt = 0;
    for (let y = 0; y < bs.h; y++) {
      for (let x = 0; x < bs.w; x++) {
        const c = bs.data[y] && bs.data[y][x];
        if (c !== null && c !== undefined && c !== '') {
          solid[y * bs.w + (mirrored ? bs.w - 1 - x : x)] = 1;
          cnt++;
        }
      }
    }
    if (cnt > 0) {
      const raster = {
        w: bs.w, h: bs.h,
        plugX: mirrored ? bs.w - 1 - bs.plug[0] : bs.plug[0],
        plugY: bs.plug[1], solid: solid,
      };
      const overlay = resolved.composite === 'overlay';
      const tile = resolved.graph
        ? compileTileDAGRaster(raster, overlay ? filterGraphForOverlayRt(resolved.graph) : resolved.graph, halo, phase || 0)
        : compileTileLayersRaster(raster, overlay ? filterLayersForOverlayRt(resolved.program) : resolved.program, halo);
      if (overlay && halo > 0) {
        const full = resolved.graph
          ? compileTileDAGRaster(raster, resolved.graph, halo, phase || 0)
          : compileTileLayersRaster(raster, resolved.program, halo);
        for (let q = 0; q < tile.w * tile.h; q++) {
          if (tile.data[q * 4] >= 128) tile.data[q * 4 + 2] = full.data[q * 4 + 2];
        }
      }
      return tile;
    }
  }
  return resolved.graph
    ? compileTileDAG(resolved.shape, resolved.graph, halo, phase || 0)
    : compileTileLayers(resolved.shape, resolved.program, halo);
}
/** 动态表面（D1）规格读取：与编辑器 surface-animation 同口径规范化 */
function surfaceAnimOfRt(resolved) {
  const a = resolved && resolved.graph ? resolved.graph.animation : undefined;
  if (!a) return null;
  const cycleSec = Number(a.cycleSec), frames = Math.round(Number(a.frames));
  if (!isFinite(cycleSec) || cycleSec <= 0 || !isFinite(frames)) return null;
  return {
    cycleSec: Math.min(120, Math.max(0.1, cycleSec)),
    frames: Math.min(60, Math.max(2, frames)),
  };
}
/** elapsed（秒）→ 当前步序号（0..frames-1），与编辑器 surfacePhaseAt 同口径 */
function surfaceStepAtRt(anim, elapsed) {
  const frac = (((elapsed || 0) / anim.cycleSec) % 1 + 1) % 1;
  return Math.min(anim.frames - 1, Math.floor(frac * anim.frames));
}
/** 置换段（D2）：本部件第一个启用置换的动态实例参数（与编辑器同口径） */
function displaceOfRt(part) {
  const list = dynListFor(part);
  for (let ii = 0; ii < list.length; ii++) {
    const p = list[ii].params;
    if (p && p.displaceEnabled && (p.displaceAmp || 0) > 0) return p;
  }
  return null;
}
/** 按置换源图重采样瓦片：源图在图像空间（x 右 y 下）定义，瓦片
 * 存储行序与图像行序上下相反，故两侧都经 (h-1-row) 换算对齐；
 * 场函数本身两端同源（dynDisplaceSrcMap）。源为 -1 处写空像素
 * （R=255，与 padTile 同编码）。 */
function displaceTileRt(tile, srcMap) {
  const w = tile.w, h = tile.h;
  const data = new Uint8Array(w * h * 4);
  for (let q = 0; q < w * h; q++) { data[q * 4] = 255; data[q * 4 + 3] = 255; }
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const sImg = srcMap[(h - 1 - row) * w + col];
      if (sImg < 0) continue;
      const sCol = sImg % w, sRow = h - 1 - Math.floor(sImg / w);
      const src = (sRow * w + sCol) * 4, dst = (row * w + col) * 4;
      data[dst] = tile.data[src]; data[dst + 1] = tile.data[src + 1];
      data[dst + 2] = tile.data[src + 2]; data[dst + 3] = tile.data[src + 3];
    }
  }
  return { w: w, h: h, cx: tile.cx, cy: tile.cy, data: data };
}
function parseHexRt(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function gridHashOf(g) {
  let h = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const c = g.data[y] && g.data[y][x];
    if (c) for (let q = 0; q < c.length; q++) h = (Math.imul(h, 31) + c.charCodeAt(q)) | 0;
  }
  return h;
}
/** 精灵部件的直贴图瓦片：R=2 占据（供轮廓/动态粒子），颜色走底图图集同格 */
/** 瓦片四周补空边（R=255 空像素）：发光场外扩边距超过瓦片自带边距时撑大瓦片 */
function padTile(tile, e) {
  const w = tile.w + e * 2, h = tile.h + e * 2;
  const data = new Uint8Array(w * h * 4);
  for (let q = 0; q < w * h; q++) { data[q * 4] = 255; data[q * 4 + 3] = 255; }
  for (let j = 0; j < tile.h; j++) {
    data.set(tile.data.subarray(j * tile.w * 4, (j + 1) * tile.w * 4), ((j + e) * w + e) * 4);
  }
  return { ...tile, w: w, h: h, cx: tile.cx + e, cy: tile.cy + e, data: data };
}
function spriteTileOf(sg, mirrored) {
  const M = 2;
  const w = sg.w + M * 2, h = sg.h + M * 2;
  const data = new Uint8Array(w * h * 4);
  for (let q = 0; q < w * h; q++) { data[q * 4] = 255; data[q * 4 + 3] = 255; }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const sx = mirrored ? sg.w - 1 - (i - M) : i - M;
      const sy = j - M;
      if (sx < 0 || sy < 0 || sx >= sg.w || sy >= sg.h) continue;
      const c = sg.data[sy] && sg.data[sy][sx];
      if (c === null || c === undefined || c === '') continue;
      data[(j * w + i) * 4] = 2;
    }
  }
  return {
    w: w, h: h,
    cx: M + (mirrored ? sg.w - 1 - sg.plug[0] : sg.plug[0]),
    cy: M + sg.plug[1],
    data: data,
  };
}
const DRAW_ORDER_MAIN = {
  0: ['cape', 'left_arm', 'left_leg', 'right_leg', 'right_arm', 'torso', 'head'],
  4: ['cape', 'left_arm', 'left_leg', 'right_leg', 'right_arm', 'torso', 'head'],
  2: ['cape', 'left_arm', 'left_leg', 'torso', 'head', 'right_leg', 'right_arm'],
  6: ['cape', 'right_arm', 'right_leg', 'torso', 'head', 'left_leg', 'left_arm'],
};
const DRAW_ORDER_MAP = { 0: 0, 1: 2, 2: 2, 3: 4, 4: 4, 5: 4, 6: 6, 7: 6 };
function sortParts(parts, v) {
  const order = DRAW_ORDER_MAIN[DRAW_ORDER_MAP[v]];
  const result = [];
  for (const layer of order) {
    const inLayer = parts.filter((p) => p.drawLayer === layer);
    inLayer.sort((a, b) => a.sortOrder - b.sortOrder);
    result.push(...inLayer);
  }
  return result;
}
/** 蓝图小求值器（运行时方言：time/const/curve/math/sin/transform；enabled 短路）
 *  graph = { nodes: [{id, type, enabled?, ...}] }；ctx = { u }（0..1 表演进度）
 *  返回 Map partKey -> { angle?, dx?, dy? } */
/** 追随增量曲线采样：[[u, v], ...] 线性插值、两端钳制；无曲线 = 0 */
function followSampleAt(points, u) {
  if (!points || points.length === 0) return 0;
  if (u <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (u <= points[i][0]) {
      const p0 = points[i - 1], p1 = points[i];
      const span = p1[0] - p0[0];
      const k = span > 0 ? (u - p0[0]) / span : 0;
      return p0[1] + (p1[1] - p0[1]) * k;
    }
  }
  return points[points.length - 1][1];
}
/** 表演包络权重：tSec 内淡入、duration-out 前淡出 */
function envelopeWeight(tSec, duration, envIn, envOut) {
  if (tSec < 0 || tSec > duration) return 0;
  const a = envIn > 0 ? Math.min(1, tSec / envIn) : 1;
  const b = envOut > 0 ? Math.min(1, (duration - tSec) / envOut) : 1;
  const s = Math.min(a, b);
  return s * s * (3 - 2 * s);
}
/** 表演合成：mode 'add' 加算 / 'override' 按权重接管（仅掩码部件） */
function composePerformance(pose, perf, bpOut, w) {
  if (w <= 0) return pose;
  const next = { ...pose };
  for (const key of perf.mask) {
    const rec = bpOut.get(key);
    if (!rec) continue;
    const cur = next[key] || { a: 0, dy: 0, rim: 0, glint: 0 };
    const m = { ...cur };
    if (rec.angle !== undefined) m.a = perf.mode === 'override' ? cur.a * (1 - w) + rec.angle * w : cur.a + rec.angle * w;
    if (rec.dy !== undefined) m.dy = perf.mode === 'override' ? cur.dy * (1 - w) + rec.dy * w : cur.dy + rec.dy * w;
    if (rec.dx !== undefined) m.dx = (cur.dx || 0) + rec.dx * w;
    next[key] = m;
  }
  return next;
}
/** 裁剪面合成：把锚点部件图空间的平面（相对锚点瓦片中心、x 右
 * y 下，保留 a·x+b·y+c >= 0 侧）按两位姿变换到本部件图空间。
 * el 只有 pos（瓦片中心世界位）与 rot；图空间坐标 g 与世界偏移
 * 的关系 g = M(rot)·offset、M(θ)=[[c,s],[s,−c]]（与片元同式，
 * M 对称且自逆）。锚点瓦片被镜像时其图空间 x 取反 → a 取反。 */
function clipPlaneForPart(clip, selfEl, anchorEl, anchorMirrored) {
  const a = anchorMirrored ? -clip.a : clip.a, b = clip.b, c0 = clip.c;
  const ca = Math.cos(anchorEl.rot), sa = Math.sin(anchorEl.rot);
  const vx = ca * a + sa * b, vy = sa * a - ca * b;
  const cb = Math.cos(selfEl.rot), sb = Math.sin(selfEl.rot);
  return [
    cb * vx + sb * vy,
    sb * vx - cb * vy,
    c0 + vx * (selfEl.pos[0] - anchorEl.pos[0]) + vy * (selfEl.pos[1] - anchorEl.pos[1]),
  ];
}
/** 刀光生成器（椭圆扇形状衰减；与主画布 slash-fan.ts 孪生，探针逐
 * 字节对拍）：外弧为界、内界随角向形状因子向尾部收尖，头部先展
 * 开、尾部后收走；返回 {w, h, data: RGBA} */
const SLASH_PALETTE_RT = ['#ffffff', '#fff8d6', '#ffeba1', '#ffd166', '#ffab2e', '#ff7a00', '#e8481f', '#b01a33'];
function slashHexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function slashSmooth01(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
function slashFanFrame(spec, p, mirrored) {
  const outW = Math.max(4, Math.round(spec.w)), outH = Math.max(4, Math.round(spec.h));
  const buf = new Uint8Array(outW * outH * 4);
  const palette = (spec.colors && spec.colors.length >= 2 ? spec.colors : SLASH_PALETTE_RT).map(slashHexRgb);
  const cx = spec.cx, cy = spec.cy;
  const rx = Math.max(2, spec.rx), ry = Math.max(2, spec.ry);
  const rotRad = spec.rotDeg * Math.PI / 180;
  const a0 = spec.a0Deg * Math.PI / 180;
  const sweep = Math.max(0.06, Math.min(5.8, spec.sweepDeg * Math.PI / 180));
  const thick = Math.max(0.04, Math.min(0.97, spec.thick));
  const gammaAng = Math.max(0.25, spec.gammaAng);
  const softRad = Math.max(0.01, spec.softRad);
  const TWO_PI = Math.PI * 2;
  const cosR = Math.cos(-rotRad), sinR = Math.sin(-rotRad);
  const head = 0.14 + 0.86 * slashSmooth01(p / 0.58);
  const tail = slashSmooth01((p - 0.44) / 0.56) * 1.06;
  if (head - tail >= 0.018) {
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const px = x + 0.5 - cx, py = y + 0.5 - cy;
        const lx = px * cosR - py * sinR, ly = px * sinR + py * cosR;
        const ex = lx / rx, ey = ly / ry;
        const rho = Math.sqrt(ex * ex + ey * ey);
        if (rho > 1.22) continue;
        const t = Math.atan2(ey, ex);
        let rel = t - a0;
        rel = ((rel % TWO_PI) + TWO_PI) % TWO_PI;
        if (rel > sweep) continue;
        const u = rel / sweep;
        if (u < tail || u > head) continue;
        const uNorm = (u - tail) / Math.max(0.001, head - tail);
        let A = Math.pow(Math.max(0, uNorm), gammaAng);
        A *= slashSmooth01(0.15 + 0.85 * uNorm);
        if (A < 0.004) continue;
        const inner = 1 - thick * A;
        const o = (y * outW + x) * 4;
        if (rho <= 1) {
          if (rho < inner - 0.015) continue;
          const s = (rho - inner) / Math.max(0.001, 1 - inner);
          if (s < 0) continue;
          const edge = slashSmooth01(s / softRad);
          if (edge < 0.02) continue;
          const radB = Math.pow(Math.min(1, s), 0.75);
          const angB = Math.pow(uNorm, 0.55);
          const bright = edge * (0.35 + 0.65 * radB) * (0.35 + 0.65 * angB);
          let colIdx = Math.floor((1 - s) * palette.length);
          colIdx += Math.floor((1 - uNorm) * 2.2);
          if (colIdx > palette.length - 1) colIdx = palette.length - 1;
          if (colIdx < 0) colIdx = 0;
          const rgb = palette[colIdx];
          const a8 = (bright * 255) | 0;
          if (a8 < 6) continue;
          buf[o] = rgb[0]; buf[o + 1] = rgb[1]; buf[o + 2] = rgb[2]; buf[o + 3] = a8;
        } else {
          const glow = slashSmooth01(1 - (rho - 1) / 0.28);
          if (glow < 0.04) continue;
          const g = glow * 0.24 * A;
          if (g < 0.02) continue;
          const rgb = palette[palette.length - 1];
          const a8 = (g * 255) | 0;
          buf[o] = rgb[0]; buf[o + 1] = rgb[1]; buf[o + 2] = rgb[2]; buf[o + 3] = a8;
        }
      }
    }
  }
  if (mirrored) {
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < (outW >> 1); x++) {
        const a = (y * outW + x) * 4, b = (y * outW + (outW - 1 - x)) * 4;
        for (let k = 0; k < 4; k++) { const tmp = buf[a + k]; buf[a + k] = buf[b + k]; buf[b + k] = tmp; }
      }
    }
  }
  return { w: outW, h: outH, data: buf };
}

/** 实例打包：58 float —— pos2 size2 rot1 pivotTile2 clipC1 tile4 misc4(family,seed,modes,composite) param4(rimI,glintI,phase,ghost) deform2 clipAB2 glowA/B/C 各4(rgb,强度)×3组 glowHz4+glowHz2(频率,相位)×3 glowSpace4(三组方向基准:0=精灵 1=世界,余位) glowStamp 每组4(形状,光晕,主方向,伸长)×3。裁剪面占 iRotTileC.w（c）与 iDeform.zw（a,b）——扩宽既有属性、不新增属性（守 16 属性上限） */
const INSTANCE_FLOATS = 58;
function packInstances(els) {
  const buf = new Float32Array(els.length * INSTANCE_FLOATS);
  els.forEach((el, i) => {
    const o = i * INSTANCE_FLOATS;
    buf[o] = el.pos[0]; buf[o + 1] = el.pos[1];
    buf[o + 2] = el.size[0]; buf[o + 3] = el.size[1];
    buf[o + 4] = el.rot;
    buf[o + 5] = el.tileCx; buf[o + 6] = el.tileCy;
    buf[o + 7] = el.clip ? el.clip[2] : 1;
    buf[o + 8] = el.tile[0]; buf[o + 9] = el.tile[1]; buf[o + 10] = el.tile[2]; buf[o + 11] = el.tile[3];
    buf[o + 12] = el.family; buf[o + 13] = el.seed;
    buf[o + 14] = el.modes[0] + el.modes[1] * 8 + el.modes[2] * 64 + el.modes[3] * 512;
    buf[o + 15] = el.composite || 0;
    buf[o + 16] = el.param[0]; buf[o + 17] = el.param[1]; buf[o + 18] = el.param[2]; buf[o + 19] = el.ghost ? 1 : 0;
    buf[o + 20] = el.deform ? el.deform[0] : 1;
    buf[o + 21] = el.deform ? el.deform[1] : 1;
    buf[o + 22] = el.clip ? el.clip[0] : 0;
    buf[o + 23] = el.clip ? el.clip[1] : 0;
    const gl = el.glow || [];
    for (let gi = 0; gi < 3; gi++) {
      const g = gl[gi];
      buf[o + 24 + gi * 4] = g ? g[0] : 0; buf[o + 25 + gi * 4] = g ? g[1] : 0;
      buf[o + 26 + gi * 4] = g ? g[2] : 0; buf[o + 27 + gi * 4] = g ? g[3] : 0;
      buf[o + 36 + gi * 2] = g ? g[4] : 0; buf[o + 37 + gi * 2] = g ? g[5] : 0;
      buf[o + 42 + gi] = el.glowSpace && el.glowSpace[gi] ? 1 : 0;
      const st = el.glowStamps && el.glowStamps[gi];
      buf[o + 46 + gi * 4] = st ? st[0] : 4; buf[o + 47 + gi * 4] = st ? st[1] : 0;
      buf[o + 48 + gi * 4] = st ? st[2] : 0; buf[o + 49 + gi * 4] = st ? st[3] : 0;
    }
  });
  return buf;
}
/** 发光场数据解码（包内 base64 字节 → Uint8Array） */
function decodeGlowData(b64) {
  let s = b64;
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** 部件在某服装集下的发光场：集内 __glow 优先，缺省用部件自带（默认集） */
function glowEntryOf(part, costume) {
  const map = costume && costume.__glow;
  return (map && map[part.key]) || part.glow || null;
}
// === PURE END ===
/*__EVAL__*/
/*__BAKE__*/
/*__DYNAMIC__*/

// ---------- 数据（来自运行时包） ----------
const PAL = EMBEDDED.palettes;
const PAL_NAMES = Object.keys(PAL);
const palIndex = (name) => Math.max(0, PAL_NAMES.indexOf(name));
const PARTS = EMBEDDED.parts;
const COSTUMES = EMBEDDED.costumes;
const BEHAVIOR_GRAPHS = (EMBEDDED.behavior && EMBEDDED.behavior.graphs) || {};
const PERFORMANCES = EMBEDDED.performances || [];
/** 工程帧率（包内字段）：粒子模拟的帧量化基数，与编辑器同口径；
 * 旧包无此字段时回落 60。时间本身走连续钟 elapsed，不重置。 */
const FRAME_RATE = EMBEDDED.frameRate || 60;
// 绘制顺序 v1：按部件 sortOrder（= 产品节点 zIndex）稳定排序
sortParts = function (parts) {
  return parts.slice().sort((a, b) => (a.sortOrder - b.sortOrder) || (a.key < b.key ? -1 : 1));
};
// 局部地面（角色原点坐标系）：所有部件最低点再下压 4px（运行时坐标 y 向上）。
// 世界地面固定在 y=0；角色原点世界高度 = -localGround（脚落地面）。
let localGround = -40;
for (const p of PARTS) {
  const low = p.base.pivot[1] + p.base.off[1] - p.base.size[1] / 2;
  localGround = Math.min(localGround, low - 4);
}

// ---------- 瓦片图集 ----------
const tileCache = new Map();
let atlasState = null;
function tileKeyOf(part, variant, costumeName, resolved) {
  let bsKey = '';
  const bs = resolved.baseSprite;
  if (bs) {
    let h = 0;
    for (let y = 0; y < bs.h; y++) for (let x = 0; x < bs.w; x++) {
      const c = bs.data[y] && bs.data[y][x];
      if (c) for (let q = 0; q < c.length; q++) h = (Math.imul(h, 31) + c.charCodeAt(q)) | 0;
    }
    bsKey = bs.w + 'x' + bs.h + '@' + bs.plug.join(',') + '#' + h;
  }
  return [part.key, variant, costumeName, JSON.stringify(resolved.shape),
    resolved.graph ? 'G' + JSON.stringify(resolved.graph) : JSON.stringify(resolved.program.map((l) => [l.mask ? l.mask.m : l.bumpForm, l.slot, l.ch])),
    resolved.composite, resolved.halo, bsKey].join('|');
}
function ensureAtlas(gl, variant, costumeName) {
  if (atlasState && atlasState.variant === variant && atlasState.costumeName === costumeName) return atlasState;
  const costume = COSTUMES[costumeName];
  const tiles = [], entries = [];
  const map = new Map();
  for (const part of PARTS) {
    const mirrored = variantMirrored(part, variant);
    const centry = costume ? costume[part.key] : undefined;
    const sgrid = costume && costume.__sprite ? costume.__sprite[part.key] : undefined;
    let resolved = null, tile = null, spriteGrid = null;
    if (centry === null && sgrid) {
      spriteGrid = sgrid; // 参数化槽位在该集回落精灵（与主画布同口径）
    } else if (part.spriteKind && !centry) {
      spriteGrid = sgrid || part.sprite || null;
      if (!spriteGrid) { map.set(part.key, null); continue; }
    } else {
      resolved = resolvePart(part, variant, costume);
      if (resolved.params.hidden) { map.set(part.key, null); continue; }
    }
    // 动态表面（D1）：带 animation 的图按 frames 步各烘一张瓦片，
    // 帧循环按 elapsed 选步（见 animFrames 组装与帧循环取瓦片处）
    let tileList = null, anim = null;
    if (spriteGrid) {
      resolved = { params: { ...part.base, off: [0, 0] }, composite: 'sprite', halo: 0, baseSprite: null };
      const key = [part.key, variant, costumeName, 'S', spriteGrid.w, spriteGrid.h, spriteGrid.plug.join(','), gridHashOf(spriteGrid), mirrored ? 'M' : ''].join('|');
      tile = tileCache.get(key);
      if (!tile) { tile = spriteTileOf(spriteGrid, mirrored); tileCache.set(key, tile); }
      tileList = [tile];
    } else {
      const key = tileKeyOf(part, variant, costumeName, resolved) + (mirrored ? '|M' : '');
      anim = surfaceAnimOfRt(resolved);
      if (anim) {
        tileList = [];
        for (let fi = 0; fi < anim.frames; fi++) {
          const fk = key + '|F' + fi;
          let ft = tileCache.get(fk);
          if (!ft) { ft = bakeResolvedTile(resolved, mirrored, fi / anim.frames); tileCache.set(fk, ft); }
          tileList.push(ft);
        }
        tile = tileList[0];
      } else {
        tile = tileCache.get(key);
        if (!tile) { tile = bakeResolvedTile(resolved, mirrored, 0); tileCache.set(key, tile); }
        tileList = [tile];
      }
    }
    // 发光场带外扩边距（辉光溢出包围盒）：超出瓦片自带边距的部分撑大瓦片
    const ge0 = glowEntryOf(part, costume);
    let tileExtra = 0;
    if (ge0) {
      const margin = ge0.space === 'tile' ? 0 : 2 + (resolved.halo || 0);
      tileExtra = Math.max(0, Math.max(ge0.padX || 0, ge0.padY || 0) - margin);
      if (tileExtra > 0) tileList = tileList.map((t) => padTile(t, tileExtra));
    }
    // 置换段（D2）：对（已垫边距的）瓦片按步进相位重采样出变体；
    // 与表面动画共享变体预算（表面步数 >4 时置换步数降为 4，否则 8）
    const disp = displaceOfRt(part);
    let dispSteps = 0, dispMaps = null;
    if (disp) {
      dispSteps = tileList.length > 4 ? 4 : 8;
      dispMaps = [];
      for (let di = 0; di < dispSteps; di++) {
        dispMaps.push(dynDisplaceSrcMap(disp, tileList[0].w, tileList[0].h, di / dispSteps));
      }
    }
    for (let fi = 0; fi < tileList.length; fi++) {
      const diMax = disp ? dispSteps : 1;
      for (let di = 0; di < diMax; di++) {
        const vt = di === 0 ? tileList[fi] : displaceTileRt(tileList[fi], dispMaps[di]);
        tiles.push(vt);
        const key2 = fi === 0 && di === 0 ? part.key
          : part.key + '#anim' + fi + (di > 0 ? 'd' + di : '');
        entries.push([key2, vt, resolved, mirrored, spriteGrid, ge0, tileExtra, anim,
          di > 0 ? dispMaps[di] : null,
          fi === 0 && di === 0 && disp
            ? { speed: disp.displaceSpeed || 0, phase: disp.displacePhase || 0, steps: dispSteps }
            : null]);
      }
    }
  }
  // 刀光帧瓦片：按当前朝向（锚点部件镜像与否）现生成 RGBA 帧，
  // 与部件瓦片同图集（底图纹理承载像素，特效通道 composite=4 直读）
  for (const perf of PERFORMANCES) {
    const sl = perf.slash;
    if (!sl) continue;
    const anchorPart = PARTS.find((p) => p.key === sl.anchor);
    const mir = anchorPart ? variantMirrored(anchorPart, variant) : false;
    const n = Math.max(2, Math.min(12, sl.frameCount || 6));
    for (let fi = 0; fi < n; fi++) {
      const fr = slashFanFrame(sl, n > 1 ? fi / (n - 1) : 0.5, mir);
      const M = 2;
      const tile = {
        w: fr.w + M * 2, h: fr.h + M * 2,
        cx: M + (mir ? fr.w - 1 - sl.cx : sl.cx), cy: M + sl.cy,
        data: new Uint8Array((fr.w + M * 2) * (fr.h + M * 2) * 4),
      };
      for (let q = 0; q < tile.w * tile.h; q++) { tile.data[q * 4] = 255; tile.data[q * 4 + 3] = 255; }
      tiles.push(tile);
      entries.push(['slash:' + perf.id + ':' + fi, tile, { composite: 'slashfx', params: { hidden: false } }, false, fr, null, 0]);
    }
  }
  const pack = packAtlas(tiles, 256);
  const height = pack.height;
  const slashTiles = {};
  const animFrameMap = {};
  const data = new Uint8Array(256 * height * 4);
  const baseData = new Uint8Array(256 * height * 4);
  const glowData = new Uint8Array(256 * height * 4);
  tiles.forEach((tile, i) => {
    const ax = pack.placements[i][0], ay = pack.placements[i][1];
    for (let j = 0; j < tile.h; j++) {
      data.set(tile.data.subarray(j * tile.w * 4, (j + 1) * tile.w * 4), ((ay + j) * 256 + ax) * 4);
    }
    // 底图（overlay 底色 / 精灵直贴图）：与档位瓦片同格对齐（镜像时列翻转）。
    // 行序须随瓦片族：精灵瓦片是产品行序（自上而下）→ 同序写入；
    // 参数化栅格瓦片是烘焙行序（自下而上）→ 翻转写入（维持既有对齐）。
    const resolved = entries[i][2], mirrored = entries[i][3];
    const bs = resolved.composite === 'overlay' ? resolved.baseSprite
      : resolved.composite === 'sprite' ? entries[i][4] : null;
    if (bs) {
      const M = 2 + (resolved.halo || 0) + (entries[i][6] || 0);
      const flipY = resolved.composite !== 'sprite';
      const wmB = entries[i][8];
      for (let j = 0; j < tile.h; j++) {
        for (let ii = 0; ii < tile.w; ii++) {
          // 置换变体：先经源图换到未置换瓦片坐标（与 displaceTileRt 同换算）
          let ei = ii, ej = j;
          if (wmB) {
            const sImg = wmB[(tile.h - 1 - j) * tile.w + ii];
            if (sImg < 0) continue;
            ei = sImg % tile.w; ej = tile.h - 1 - Math.floor(sImg / tile.w);
          }
          const sx = mirrored ? bs.w - 1 - (ei - M) : ei - M;
          const sy = flipY ? bs.h - 1 - (ej - M) : ej - M;
          if (sx < 0 || sy < 0 || sx >= bs.w || sy >= bs.h) continue;
          const c = bs.data[sy] && bs.data[sy][sx];
          const rgb = c ? parseHexRt(c) : null;
          if (!rgb) continue;
          const o = ((ay + j) * 256 + ax + ii) * 4;
          baseData[o] = rgb[0]; baseData[o + 1] = rgb[1]; baseData[o + 2] = rgb[2]; baseData[o + 3] = 255;
        }
      }
    }
    // 发光场：与瓦片同格对齐（R = 权重）。行序同底图口径（精灵瓦片
    // 同序、参数化栅格瓦片翻转），镜像列翻转；space=tile 的代表图与
    // 瓦片同尺寸（边距已含，M=0），space=sprite 的代表图是精灵原图。
    const ge = entries[i][5];
    if (ge) {
      const M = (ge.space === 'tile' ? 0 : 2 + (resolved.halo || 0)) + (entries[i][6] || 0);
      const gw = ge.w, gh = ge.h;
      const pX = ge.padX || 0, pY = ge.padY || 0;
      const gd = decodeGlowData(ge.data);
      const flipY = !entries[i][4];
      const wmG = entries[i][8];
      for (let j = 0; j < tile.h; j++) {
        for (let ii = 0; ii < tile.w; ii++) {
          let ei = ii, ej = j;
          if (wmG) {
            const sImg = wmG[(tile.h - 1 - j) * tile.w + ii];
            if (sImg < 0) continue;
            ei = sImg % tile.w; ej = tile.h - 1 - Math.floor(sImg / tile.w);
          }
          const u = ei - M, v = ej - M;
          const sx = mirrored ? gw - 1 - u - pX : u + pX;
          const sy = flipY ? gh - 1 - v - pY : v + pY;
          if (sx < 0 || sy < 0 || sx >= gw || sy >= gh) continue;
          const src3 = (sy * gw + sx) * 3;
          const v0 = gd[src3] || 0, v1 = gd[src3 + 1] || 0, v2 = gd[src3 + 2] || 0;
          if (!v0 && !v1 && !v2) continue;
          const o = ((ay + j) * 256 + ax + ii) * 4;
          glowData[o] = v0; glowData[o + 1] = v1; glowData[o + 2] = v2; glowData[o + 3] = 255;
        }
      }
    }
    if (resolved.composite === 'slashfx') {
      const fr = entries[i][4];
      for (let j = 0; j < fr.h; j++) {
        baseData.set(fr.data.subarray(j * fr.w * 4, (j + 1) * fr.w * 4), ((ay + 2 + j) * 256 + ax + 2) * 4);
      }
      const key = entries[i][0];
      const perfId = key.slice(6, key.lastIndexOf(':'));
      const fi = Number(key.slice(key.lastIndexOf(':') + 1));
      (slashTiles[perfId] = slashTiles[perfId] || [])[fi] = {
        tile: [ax, ay, tile.w, tile.h], tileCx: tile.cx, tileCy: tile.cy, size: [tile.w, tile.h],
      };
    }
    const ekey = entries[i][0];
    const animPos = ekey.indexOf('#anim');
    if (animPos >= 0) {
      // 变体瓦片（动态表面步 fi × 置换步 di）：不单独成条目，挂到
      // 部件条目的 animFrames（键 "fi,di"；步 0,0 即条目自身）
      const bk = ekey.slice(0, animPos);
      const rest = ekey.slice(animPos + 5);
      const dPos = rest.indexOf('d');
      const fi = dPos >= 0 ? Number(rest.slice(0, dPos)) : Number(rest);
      const di = dPos >= 0 ? Number(rest.slice(dPos + 1)) : 0;
      const rec = (animFrameMap[bk] = animFrameMap[bk] || {});
      rec[fi + ',' + di] = { tile: tile, place: [ax, ay] };
    } else {
      map.set(ekey, { tile: tile, place: [ax, ay], resolved: entries[i][2], glowStamps: ge && ge.stamps ? ge.stamps : null, anim: entries[i][7] || null, disp: entries[i][9] || null });
    }
  });
  for (const bk in animFrameMap) {
    const baseEntry = map.get(bk);
    if (baseEntry) baseEntry.animFrames = animFrameMap[bk];
  }
  if (atlasState && atlasState.tex) gl.deleteTexture(atlasState.tex);
  if (atlasState && atlasState.baseTex) gl.deleteTexture(atlasState.baseTex);
  if (atlasState && atlasState.glowTex) gl.deleteTexture(atlasState.glowTex);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const baseTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, baseTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, baseData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const glowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, glowTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, glowData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  atlasState = { variant: variant, costumeName: costumeName, tex: tex, baseTex: baseTex, glowTex: glowTex, map: map, slashTiles: slashTiles };
  return atlasState;
}

// ---------- WebGL ----------
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias: false });
if (!gl) throw new Error('WebGL2 不可用');
const VIEW_H = 180;
let lowW = 320;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  lowW = Math.max(1, Math.round(VIEW_H * (w / h)));
  canvas.width = lowW; canvas.height = VIEW_H;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
}
window.addEventListener('resize', resize); resize();
function compileShader(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(sh));
  return sh;
}
function makeProgram(vs, fs) {
  const pr = gl.createProgram();
  gl.attachShader(pr, compileShader(gl.VERTEX_SHADER, vs));
  gl.attachShader(pr, compileShader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('程序链接失败: ' + gl.getProgramInfoLog(pr));
  return pr;
}
const partProg = makeProgram(
\`#version 300 es
// 属性预算：WebGL 只保证 16 个顶点属性（location 0-15），18 个会编译失败。
// 故合并两对相邻字段（实例数据 55 float 的顺序与 packInstances 完全一致，
// 只改声明与绑定，不动写入）：iPos+iSize→vec4，iRot+iTileC→vec3。
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPosSize;
layout(location=2) in vec4 iRotTileC;
layout(location=3) in vec4 iTile;
layout(location=4) in vec4 iMisc;
layout(location=5) in vec4 iParam;
layout(location=6) in vec4 iDeform;
layout(location=7) in vec4 iGlowA;
layout(location=8) in vec4 iGlowB;
layout(location=9) in vec4 iGlowC;
layout(location=10) in vec4 iGlowHz;
layout(location=11) in vec2 iGlowHz2;
layout(location=12) in vec4 iGlowSpace;
layout(location=13) in vec4 iGlowStampA;
layout(location=14) in vec4 iGlowStampB;
layout(location=15) in vec4 iGlowStampC;
uniform vec2 uCam; uniform vec2 uViewHalf; uniform vec2 uRes;
out vec2 vCenterScreen; out float vRot; out vec4 vTile; out vec2 vTileC; out vec4 vMisc; out vec4 vParam; out vec2 vDeform;
out vec4 vGlowA; out vec4 vGlowB; out vec4 vGlowC; out vec4 vGlowHz; out vec2 vGlowHz2; out vec4 vGlowSpace;
out vec4 vGlowStampA; out vec4 vGlowStampB; out vec4 vGlowStampC; out vec3 vClip;
void main(){
  float c = cos(iRotTileC.x), s = sin(iRotTileC.x);
  vec2 local = aCorner * iPosSize.zw;
  vec2 woff = vec2(local.x * c + local.y * s, local.x * s - local.y * c);
  vec2 world = iPosSize.xy + woff;
  vCenterScreen = ((iPosSize.xy - uCam) / uViewHalf * 0.5 + 0.5) * uRes;
  vRot = iRotTileC.x; vTile = iTile; vTileC = iRotTileC.yz; vMisc = iMisc; vParam = iParam; vDeform = iDeform.xy;
  vClip = vec3(iDeform.z, iDeform.w, iRotTileC.w);
  vGlowA = iGlowA; vGlowB = iGlowB; vGlowC = iGlowC; vGlowHz = iGlowHz; vGlowHz2 = iGlowHz2; vGlowSpace = iGlowSpace;
  vGlowStampA = iGlowStampA; vGlowStampB = iGlowStampB; vGlowStampC = iGlowStampC;
  float z = 0.9 - float(gl_InstanceID) * 0.02;
  gl_Position = vec4((world - uCam) / uViewHalf, z, 1.0);
}\`,
\`#version 300 es
precision highp float;
uniform sampler2D uAtlas; uniform sampler2D uPal; uniform sampler2D uBase; uniform sampler2D uGlow; uniform float uTime;
in vec2 vCenterScreen; in float vRot; in vec4 vTile; in vec2 vTileC; in vec4 vMisc; in vec4 vParam; in vec2 vDeform;
in vec4 vGlowA; in vec4 vGlowB; in vec4 vGlowC; in vec4 vGlowHz; in vec2 vGlowHz2; in vec4 vGlowSpace;
in vec4 vGlowStampA; in vec4 vGlowStampB; in vec4 vGlowStampC; in vec3 vClip;
out vec4 oColor;
vec3 gF3 = vec3(0.0);
vec3 gK3 = vec3(0.0);
vec3 fetchGlow(ivec2 gg){
  ivec2 gtp = ivec2(vTile.xy) + ivec2(vTileC) + gg;
  if (gtp.x < int(vTile.x) || gtp.y < int(vTile.y) || gtp.x >= int(vTile.x + vTile.z) || gtp.y >= int(vTile.y + vTile.w)) return vec3(0.0);
  return texelFetch(uGlow, gtp, 0).rgb;
}
// 印章权重（与主画布 dynamic-patterns 的 glowStamp 解析形状同式）：
// st = (形状 0方 1圆 2星 3焰, 光晕, 主方向度, 伸长)；cosP/sinP 为主方向相位
float glowStampW(vec4 st, float cosP, float sinP, vec2 dxy){
  float halo = st.y; float reach = st.w;
  if (halo <= 0.0) return (dxy.x == 0.0 && dxy.y == 0.0) ? 1.0 : 0.0;
  if (st.x < 0.5) { float r = max(abs(dxy.x), abs(dxy.y)); return r <= halo ? 1.0 - r / (halo + 1.0) : 0.0; }
  if (st.x < 1.5) { float d = length(dxy); return d <= halo ? 1.0 - d / (halo + 1.0) : 0.0; }
  float lx = dxy.x * cosP + dxy.y * sinP;
  float ly = -dxy.x * sinP + dxy.y * cosP;
  if (st.x < 2.5) {
    float d = length(vec2(lx, ly));
    if (d <= 0.0) return 1.0;
    float axis = abs(cos(2.0 * atan(ly, lx)));
    float f = 0.45 + (reach - 0.45) * pow(axis, 1.5);
    float dEff = d / f;
    return dEff <= halo ? 1.0 - dEff / (halo + 1.0) : 0.0;
  }
  float dxs = ly < 0.0 ? lx * (1.0 + (-ly) * 0.3) : lx;
  float dys = ly < 0.0 ? ly / reach : ly * 1.7;
  float d = length(vec2(dxs, dys));
  return d <= halo ? 1.0 - d / (halo + 1.0) : 0.0;
}
// 一个发光通道在当前像素的权重：解析形状按选区掩码+印章现算（世界基准只
// 改印章主方向、选区始终贴精灵，与主画布同口径）；烘焙通道（形状 4）直用场
float glowChannelF(vec4 st, float world, int ch, ivec2 g){
  if (st.x > 3.5) { vec3 f = fetchGlow(g); return ch == 0 ? f.r : ch == 1 ? f.g : f.b; }
  float mainDeg = st.z - (world > 0.5 ? -vRot * 57.29577951308232 : 0.0);
  float phiDeg = (st.x > 1.5 && st.x < 2.5) ? mainDeg : mainDeg - 270.0;
  float phi = phiDeg * 0.017453292519943295;
  float cosP = cos(phi), sinP = sin(phi);
  float Rf = st.x > 1.5 ? ceil(st.y * st.w) + 1.0 : st.y;
  int Ri = int(Rf + 0.5);
  float f = 0.0;
  for (int dy = -29; dy <= 29; dy++) {
    if (dy > Ri || dy < -Ri) continue;
    for (int dx = -29; dx <= 29; dx++) {
      if (dx > Ri || dx < -Ri) continue;
      float w = glowStampW(st, cosP, sinP, vec2(float(dx), float(dy)));
      if (w <= 0.0) continue;
      vec3 m = fetchGlow(g - ivec2(dx, dy));
      float mv = ch == 0 ? m.r : ch == 1 ? m.g : m.b;
      if (mv > 0.5 && w > f) f = w;
    }
  }
  return f;
}
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
int tileRAt(ivec2 g){
  ivec2 tp = ivec2(vTile.xy) + ivec2(vTileC) + g;
  if (tp.x < int(vTile.x) || tp.y < int(vTile.y) || tp.x >= int(vTile.x + vTile.z) || tp.y >= int(vTile.y + vTile.w)) return 255;
  return int(texelFetch(uAtlas, tp, 0).r * 255.0 + 0.5);
}
float tileGAt(ivec2 g){
  ivec2 tp = ivec2(vTile.xy) + ivec2(vTileC) + g;
  if (tp.x < int(vTile.x) || tp.y < int(vTile.y) || tp.x >= int(vTile.x + vTile.z) || tp.y >= int(vTile.y + vTile.w)) return 0.0;
  return texelFetch(uAtlas, tp, 0).g;
}
float tileBAt(ivec2 g){
  ivec2 tp = ivec2(vTile.xy) + ivec2(vTileC) + g;
  if (tp.x < int(vTile.x) || tp.y < int(vTile.y) || tp.x >= int(vTile.x + vTile.z) || tp.y >= int(vTile.y + vTile.w)) return 0.0;
  return texelFetch(uAtlas, tp, 0).b;
}
vec3 applyGlowOne(vec3 col, float f, float k, vec3 rgb){
  if (k <= 0.0) return col;
  if (f >= 0.999) return mix(col, vec3(1.0), 0.35 * min(k, 1.0)) + rgb * (0.25 * k);
  return col + rgb * (k * 0.8);
}
vec3 applyGlow(vec3 col){
  col = applyGlowOne(col, gF3.r, gK3.r, vGlowA.rgb);
  col = applyGlowOne(col, gF3.g, gK3.g, vGlowB.rgb);
  col = applyGlowOne(col, gF3.b, gK3.b, vGlowC.rgb);
  return col;
}
void main(){
  float mp = vMisc.z;
  int lm = int(mod(mp, 8.0));
  int om = int(mod(mp / 8.0, 8.0));
  int rm = int(mod(mp / 64.0, 8.0));
  int gm = int(mp / 512.0);
  int family = int(vMisc.x + 0.5);
  vec2 d = gl_FragCoord.xy - vCenterScreen;
  float c = cos(vRot), s = sin(vRot);
  vec2 lup = vec2(d.x * c + d.y * s, -d.x * s + d.y * c);
  vec2 gfv = vec2(lup.x, -lup.y);
  // 裁剪面（本部件图空间，几何切：按未形变的本地坐标判，保留
  // vClip.x·x + vClip.y·y + vClip.z >= 0 侧；无裁剪时为 (0,0,1)）
  if (vClip.x * gfv.x + vClip.y * gfv.y + vClip.z < 0.0) discard;
  // 刀光特效通道（composite=4）：底图 RGBA 直出（带真 alpha）
  if (vMisc.w > 3.5) {
    ivec2 g0 = ivec2(floor(gfv + 0.5));
    ivec2 tpF = ivec2(vTile.xy) + ivec2(vTileC) + g0;
    if (tpF.x < int(vTile.x) || tpF.y < int(vTile.y) || tpF.x >= int(vTile.x + vTile.z) || tpF.y >= int(vTile.y + vTile.w)) discard;
    vec4 fc = texelFetch(uBase, tpF, 0);
    if (fc.a < 0.004) discard;
    oColor = fc;
    return;
  }
  if (vDeform.x != 1.0 || vDeform.y != 1.0) gfv = vec2(gfv.x / max(vDeform.x, 0.05), gfv.y / max(vDeform.y, 0.05));
  ivec2 g = ivec2(floor(gfv + 0.5));
  if (vGlowA.w > 0.0 || vGlowB.w > 0.0 || vGlowC.w > 0.0) {
    gF3 = vec3(
      vGlowA.w > 0.0 ? glowChannelF(vGlowStampA, vGlowSpace.x, 0, g) : 0.0,
      vGlowB.w > 0.0 ? glowChannelF(vGlowStampB, vGlowSpace.y, 1, g) : 0.0,
      vGlowC.w > 0.0 ? glowChannelF(vGlowStampC, vGlowSpace.z, 2, g) : 0.0);
  }
  gK3 = vec3(
    gF3.r * (0.5 + 0.5 * sin(6.2831853 * (vGlowHz.x * uTime + vGlowHz.y))) * vGlowA.w,
    gF3.g * (0.5 + 0.5 * sin(6.2831853 * (vGlowHz.z * uTime + vGlowHz.w))) * vGlowB.w,
    gF3.b * (0.5 + 0.5 * sin(6.2831853 * (vGlowHz2.x * uTime + vGlowHz2.y))) * vGlowC.w);
  int r0 = tileRAt(g);
  bool occ = r0 < 128;
  if (!occ) {
    if (r0 == 254) {
      bool nL = tileRAt(g + ivec2(-1, 0)) < 128, nR = tileRAt(g + ivec2(1, 0)) < 128;
      bool nT = tileRAt(g + ivec2(0, -1)) < 128, nB = tileRAt(g + ivec2(0, 1)) < 128;
      bool draw = false;
      if (om == 1) draw = nL || nR || nB || nT;
      else if (om == 3) draw = nR || nB;
      else if (om == 4) draw = nT;
      if (draw) { oColor = vec4(applyGlow(texelFetch(uPal, ivec2(0, family), 0).rgb), 1.0); return; }
    }
    int bb = int(tileBAt(g) * 255.0 + 0.5);
    if (bb > 0) {
      int bslot = (bb & 16) != 0 ? 4 : (bb & 15) - 1;
      oColor = vec4(applyGlow(texelFetch(uPal, ivec2(clamp(bslot, 0, 7), family), 0).rgb), 1.0);
      return;
    }
    {
      vec3 haloCol = vGlowA.rgb * (gK3.r * 0.8) + vGlowB.rgb * (gK3.g * 0.8) + vGlowC.rgb * (gK3.b * 0.8);
      if (dot(haloCol, vec3(1.0)) > 0.03) { oColor = vec4(haloCol, 1.0); return; }
    }
    discard;
  }
  if (vMisc.w > 2.5) {
    ivec2 tpD = ivec2(vTile.xy) + ivec2(vTileC) + g;
    vec4 baseC = texelFetch(uBase, tpD, 0);
    if (baseC.a < 0.5) discard;
    oColor = vec4(applyGlow(baseC.rgb), 1.0);
    return;
  }
  bool inL = !(tileRAt(g + ivec2(-1, 0)) < 128), inR = !(tileRAt(g + ivec2(1, 0)) < 128);
  bool inT = !(tileRAt(g + ivec2(0, -1)) < 128), inB = !(tileRAt(g + ivec2(0, 1)) < 128);
  int slot = r0;
  bool isLit = false, isDark = false;
  if (lm == 1) { isLit = inT; isDark = inB; }
  else if (lm == 2) { isLit = inT || inL; isDark = inB || inR; }
  else if (lm == 3) { isLit = inT || inR; isDark = inB || inL; }
  else if (lm == 4) { isLit = inB; isDark = inT; }
  else if (lm == 5) { isLit = inL || inR || inB || inT; isDark = !isLit; }
  else if (lm == 6) { isLit = true; }
  if (slot >= 1 && slot <= 3) { if (isDark) slot = 1; else if (isLit) slot = 3; }
  bool rimHit = false;
  if (rm == 1) rimHit = inT && inL;
  else if (rm == 2) rimHit = inT && inR;
  else if (rm == 3) rimHit = inL || inR;
  else if (rm == 4) rimHit = inB;
  else if (rm == 5) rimHit = inL || inR || inB || inT;
  else if (rm == 6) {
    float band = fract(uTime * 0.6 + vParam.z);
    float yN = float(g.y) / max(vTile.w - 4.0, 1.0) + 0.5;
    rimHit = (inL || inR || inB || inT) && abs(yN - band) < 0.12;
  }
  bool forcePal = false;
  if (rimHit && hash12(vec2(g) + vMisc.y) < vParam.x) { slot = 4; forcePal = true; }
  if (tileGAt(g) > 0.35) {
    bool gHit = false;
    if (gm == 1) gHit = inT && inR;
    else if (gm == 2) gHit = (inL || inR || inB || inT) && hash12(vec2(g) + floor(uTime * 8.0)) > 0.93;
    else if (gm == 3) {
      float along = (inL || inR) ? float(g.y) : float(g.x);
      gHit = (inL || inR || inB || inT) && fract(along * 0.25 - uTime * 1.5) < 0.18;
    }
    if (gHit && hash12(vec2(g) * 1.7 + vMisc.y) < vParam.y) { slot = 4; forcePal = true; }
  }
  if (om == 2 && (inL || inR || inB || inT)) { slot = 0; forcePal = true; }
  if (vParam.w > 0.5 && slot >= 1) slot = 1;
  if (vMisc.w > 1.5 && !forcePal) {
    ivec2 tp = ivec2(vTile.xy) + ivec2(vTileC) + g;
    vec4 baseC = texelFetch(uBase, tp, 0);
    if (baseC.a > 0.5) {
      float f = slot == 0 ? 0.55 : slot == 1 ? 0.78 : slot == 3 ? 1.22 : 1.0;
      oColor = vec4(applyGlow(baseC.rgb * f), 1.0);
      return;
    }
  }
  oColor = vec4(applyGlow(texelFetch(uPal, ivec2(slot, family), 0).rgb), 1.0);
}\`);
const palTex = gl.createTexture();
{
  const rgb = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
  const data = new Uint8Array(8 * PAL_NAMES.length * 4);
  PAL_NAMES.forEach((name, fi) => {
    PAL[name].forEach((hex, si) => {
      const c = rgb(hex);
      const o = (fi * 8 + si) * 4;
      data[o] = Math.round(c[0] * 255); data[o + 1] = Math.round(c[1] * 255); data[o + 2] = Math.round(c[2] * 255); data[o + 3] = 255;
    });
  });
  gl.bindTexture(gl.TEXTURE_2D, palTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 8, PAL_NAMES.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
}
const partVAO = gl.createVertexArray();
const quadBuf = gl.createBuffer();
const instBuf = gl.createBuffer();
{
  gl.bindVertexArray(partVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  const strides = [[1, 4, 0], [2, 4, 4], [3, 4, 8], [4, 4, 12], [5, 4, 16], [6, 4, 20], [7, 4, 24], [8, 4, 28], [9, 4, 32], [10, 4, 36], [11, 2, 40], [12, 4, 42], [13, 4, 46], [14, 4, 50], [15, 4, 54]];
  for (const sDef of strides) {
    gl.enableVertexAttribArray(sDef[0]);
    gl.vertexAttribPointer(sDef[0], sDef[1], gl.FLOAT, false, INSTANCE_FLOATS * 4, sDef[2] * 4);
    gl.vertexAttribDivisor(sDef[0], 1);
  }
  gl.bindVertexArray(null);
}
const solidProg = makeProgram(
\`#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aLocal;
layout(location=2) in vec4 aColor;
layout(location=3) in float aMode;
uniform vec2 uCam; uniform vec2 uViewHalf;
out vec2 vLocal; out vec4 vColor; out float vMode;
void main(){
  vLocal = aLocal; vColor = aColor; vMode = aMode;
  gl_Position = vec4((aPos - uCam) / uViewHalf, 0.99, 1.0);
}\`,
\`#version 300 es
precision highp float;
in vec2 vLocal; in vec4 vColor; in float vMode;
out vec4 oColor;
void main(){
  if (vMode > 0.5 && dot(vLocal, vLocal) > 1.0) discard;
  oColor = vColor;
}\`);
const solidVAO = gl.createVertexArray();
const solidBuf = gl.createBuffer();
{
  gl.bindVertexArray(solidVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, solidBuf);
  const layout = [[0, 2, 0], [1, 2, 2], [2, 4, 4], [3, 1, 8]];
  for (const lDef of layout) {
    gl.enableVertexAttribArray(lDef[0]);
    gl.vertexAttribPointer(lDef[0], lDef[1], gl.FLOAT, false, 9 * 4, lDef[2] * 4);
  }
  gl.bindVertexArray(null);
}
function buildScenery(charX, charY, onGround) {
  const verts = [];
  const quad = (cx, cy, w, h, color, mode) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
    const corners = [[x0, y0, -1, -1], [x1, y0, 1, -1], [x1, y1, 1, 1], [x0, y0, -1, -1], [x1, y1, 1, 1], [x0, y1, -1, 1]];
    for (const cn of corners) verts.push(cn[0], cn[1], cn[2], cn[3], color[0], color[1], color[2], color[3], mode);
  };
  const base = Math.floor(charX / 24) * 24;
  for (let i = -10; i <= 10; i++) {
    const gx = base + i * 24;
    const hh = 1.5 + (Math.abs(i * 7 + Math.floor(charX / 24)) % 3);
    quad(gx, hh / 2, 4, hh, [0.118, 0.118, 0.243, 1], 0);
  }
  quad(charX, -0.75, 4000, 1.5, [0.165, 0.165, 0.322, 1], 0);
  const shrink = onGround ? 1 : Math.max(0.5, 1 - charY / 50);
  quad(charX, 0.4, 20 * shrink, 5 * shrink, [0.031, 0.031, 0.078, 0.5 * shrink], 1);
  return new Float32Array(verts);
}

// ---------- 宿主输入与运行时状态 ----------
const char = { x: 0, y: 0, vy: 0, onGround: true, variant: 0, lockedVariant: false };
let currentCostume = (EMBEDDED.defaultCostume && COSTUMES[EMBEDDED.defaultCostume])
  ? EMBEDDED.defaultCostume
  : Object.keys(COSTUMES)[0] || '';
/** 动态模式解析（模板侧）：当前服装集的 __dynamic 优先，缺省用部件自带（默认集解析结果） */
function dynListFor(part) {
  const entry = COSTUMES[currentCostume];
  const map = entry && entry.__dynamic;
  return (map && map[part.key]) || part.dynamic || [];
}
const particleColorCache = new Map();
function particleRgb(hex) {
  let c = particleColorCache.get(hex);
  if (!c) {
    const rgb = parseHexRt(hex) || [255, 180, 107];
    c = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
    particleColorCache.set(hex, c);
  }
  return c;
}
function pushParticleQuad(verts, x, y, size, rgb, alpha) {
  const h = Math.max(0.5, size / 2);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  for (const cn of corners) {
    verts.push(x + cn[0] * h, y + cn[1] * h, cn[0], cn[1], rgb[0], rgb[1], rgb[2], alpha, 1);
  }
}
let elapsed = 0;
let autoWalk = false;
let autoDir = 1;
const behaviorState = new Map();
let prevBehaviorOutputs = new Map();
let phaseAcc = 0;
// 行为时钟纪元：与编辑器同一口径——时间线只有一个时钟，表演从 0 帧
// 起播时行为的 t/phase 也从 0 起。此前行为按页面打开后的墙钟自由跑，
// 按 T 时摆锤停在任意相位，与轨道永远对不齐（同步缺陷）。
let behaviorEpoch = 0;
const activePerfs = [];
const keys = Object.create(null);
function startPerf(perf) {
  if (activePerfs.some((a) => a.perf === perf)) return;
  activePerfs.push({ perf: perf, t: 0, snapTimer: 0, snaps: [] });
  emitRuntimeEvent('perfstart', { id: perf.id, name: perf.name });
  behaviorEpoch = elapsed;
  phaseAcc = 0;
  behaviorState.clear();
  prevBehaviorOutputs = new Map();
}
/** 停表演：按对象或 id/名/触发名匹配，移除后发 perfend（stopped: true）。
 *  循环表演没有自然结束，只能经此停下；状态机下一帧见表演 inactive 即回落。 */
function stopPerf(perfOrId) {
  for (let i = activePerfs.length - 1; i >= 0; i--) {
    const p = activePerfs[i].perf;
    if (p === perfOrId || p.id === perfOrId || p.name === perfOrId || p.trigger === perfOrId) {
      activePerfs.splice(i, 1);
      emitRuntimeEvent('perfend', { id: p.id, name: p.name, stopped: true });
    }
  }
}
function stopAllPerfs() {
  const ids = activePerfs.map((a) => a.perf);
  activePerfs.length = 0;
  for (const p of ids) emitRuntimeEvent('perfend', { id: p.id, name: p.name, stopped: true });
}
// ---------- 运行时状态机 ----------
// 只判身体状态：材料都在包内（宿主变量 + 表演清单）。世界判定（行为树）
// 不进包，归宿主。宿主可绕过状态机：setVar 直写变量（通用名存入变量表、
// 每帧并入 hostVars；保留名 t/phase/speed01/grounded 拒收），状态机每帧
// 读最终值跟随判定；意图（intent）是建议入口，不是唯一入口。
const SM = EMBEDDED.stateMachine || null;
const smStateById = new Map();
let smCurrent = null;
if (SM) {
  for (const s of SM.states || []) smStateById.set(s.id, s);
  smCurrent = SM.initial || (SM.states && SM.states[0] ? SM.states[0].id : null);
}
const runtimeEventCbs = [];
function emitRuntimeEvent(type, data) {
  const ev = Object.assign({ type: type, t: elapsed }, data || {});
  for (const cb of runtimeEventCbs) { try { cb(ev); } catch (err) { /* 宿主回调出错不拖垮渲染 */ } }
}
let lastHostVars = { moveX: 0, speed01: 0, grounded: 1 };
let hostMoveX = null;
// 宿主通用变量（setVar 写入）：每帧并入 hostVars 供状态机条件与行为图读。
// 只存数；保留名 t/phase/speed01/grounded 由模板逐帧计算，setVar 拒收，
// 并入时计算值也排在后面覆盖，外部写不进来、盖不住身体真相。
const hostCustomVars = {};
let prevOnGround = true;
function smCondOk(when, vars) {
  for (const c of when || []) {
    const v = vars[c.var];
    if (typeof v !== 'number') return false;
    if (c.op === 'lt' && !(v < c.value)) return false;
    if (c.op === 'lte' && !(v <= c.value)) return false;
    if (c.op === 'gt' && !(v > c.value)) return false;
    if (c.op === 'gte' && !(v >= c.value)) return false;
    if (c.op === 'eq' && v !== c.value) return false;
    if (c.op === 'neq' && v === c.value) return false;
  }
  return true;
}
function smSetState(to) {
  if (!SM || !to || to === smCurrent) return;
  const from = smCurrent;
  smCurrent = to;
  emitRuntimeEvent('statechange', { from: from, to: to });
  const st = smStateById.get(to);
  if (st && st.performanceId) {
    const perf = PERFORMANCES.find((p) => p.id === st.performanceId);
    if (perf) startPerf(perf);
  }
}
function smPickResident(vars) {
  // 回落是按信号重推常驻态，不是沿转移表走一步：表演结束时当前态就是表演态，
  // 若按 from 过滤，默认机唯一的 '*' 转移（→air，需 grounded=0）在地面上无候选，
  // 就会返回表演态本身、smSetState 因目标等于当前直接返回，从此卡死在表演态。
  // 故只看「目标是常驻态且条件成立」，按表顺序首个命中。作者机若要 from 敏感
  // 的回落，应把分区条件写进 when（信号分区），而不是依赖 from。
  for (const tr of SM.transitions || []) {
    const target = smStateById.get(tr.to);
    if (!target || target.performanceId) continue;
    if (smCondOk(tr.when, vars)) return tr.to;
  }
  // 表里没有任何常驻转移命中时，退回初始态（初始态本身是表演态时保持当前，
  // 避免在两个表演态之间横跳）
  const initial = smStateById.get(SM.initial);
  if (initial && !initial.performanceId) return SM.initial;
  return smCurrent;
}
function smUpdate(vars) {
  if (!SM || !smCurrent) return;
  const cur = smStateById.get(smCurrent);
  if (cur && cur.performanceId) {
    // 表演状态：表演播完（或循环表演被停）后按当前信号回落常驻状态
    if (!activePerfs.some((a) => a.perf.id === cur.performanceId)) smSetState(smPickResident(vars));
    return;
  }
  for (const tr of SM.transitions || []) {
    if (tr.from !== '*' && tr.from !== smCurrent) continue;
    if (tr.to === smCurrent) continue;
    const target = smStateById.get(tr.to);
    if (!target || target.performanceId) continue; // 表演状态只经意图进入
    if (smCondOk(tr.when, vars)) { smSetState(tr.to); break; }
  }
}
/** 表演统一入口：有对应状态先走状态机（状态变化与事件保持一致），否则直触发 */
function enterPerformance(perf) {
  if (SM) {
    const st = (SM.states || []).find((s) => s.performanceId === perf.id);
    if (st && st.id !== smCurrent) { smSetState(st.id); return; }
  }
  startPerf(perf);
}
// 宿主接口：意图进、事件出、变量可绕过直写
window.procRuntime = {
  intent: function (name) {
    if (name === 'jump') {
      if (char.onGround) { char.vy = JUMP_V; char.onGround = false; }
      return true;
    }
    const perf = PERFORMANCES.find((p) => p.id === name || p.name === name || p.trigger === name);
    if (perf) { enterPerformance(perf); return true; }
    return false;
  },
  setVar: function (name, value) {
    if (name === 'moveX') {
      hostMoveX = value === null || value === undefined ? null : Math.max(-1, Math.min(1, Number(value) || 0));
      return true;
    }
    if (name === 'autoWalk') { autoWalk = !!value; return true; }
    // 保留名是身体真相（逐帧由物理/输入算出），不接受外部写入
    if (name === 't' || name === 'phase' || name === 'speed01' || name === 'grounded') return false;
    // 通用变量：null/undefined = 删除（条件随之读不到、按缺失处理）；只存数
    if (value === null || value === undefined) { delete hostCustomVars[name]; return true; }
    const num = Number(value);
    if (Number.isNaN(num)) return false;
    hostCustomVars[name] = num;
    return true;
  },
  setMove: function (x) {
    hostMoveX = x === null || x === undefined ? null : Math.max(-1, Math.min(1, Number(x) || 0));
  },
  state: function () { return smCurrent; },
  onEvent: function (cb) { runtimeEventCbs.push(cb); },
  stop: function (nameOrId) { stopPerf(nameOrId); },
  stopAll: function () { stopAllPerfs(); },
};

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  const d = parseInt(e.key);
  if (d >= 1 && d <= 8) { char.variant = d - 1; char.lockedVariant = true; refreshBar(); }
  for (const perf of PERFORMANCES) if (perf.triggerKey === e.code) enterPerformance(perf);
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const MOVE_SPEED = 72, JUMP_V = 200, GRAVITY = 720;
function readMoveX() {
  if (hostMoveX !== null) return hostMoveX; // 宿主直写优先于键盘（绕过口）
  let ix = 0;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  if (ix === 0 && autoWalk) ix = autoDir;
  return ix;
}
function updateCharacter(dt, ix) {
  if (ix !== 0 && !char.lockedVariant) char.variant = ix > 0 ? 2 : 6;
  char.x += ix * MOVE_SPEED * dt;
  if (autoWalk && Math.abs(char.x) > 110) autoDir = char.x > 0 ? -1 : 1;
  if ((keys['KeyW'] || keys['ArrowUp']) && char.onGround) { char.vy = JUMP_V; char.onGround = false; }
  if (!char.onGround) {
    char.vy -= GRAVITY * dt; char.y += char.vy * dt;
    if (char.y <= 0) { char.y = 0; char.vy = 0; char.onGround = true; }
  }
}
function partCenter(params, an) {
  const c = Math.cos(an.a), s = Math.sin(an.a);
  const rx = params.off[0] * c - params.off[1] * s;
  const ry = params.off[0] * s + params.off[1] * c;
  return [char.x + params.pivot[0] + rx + (an.dx || 0), char.y - localGround + params.pivot[1] + ry + (an.dy || 0)];
}

// ---------- 控制条 ----------
const bar = document.getElementById('bar');
const barState = { dirs: [], costs: [] };
function mkRow(label) {
  const row = document.createElement('div'); row.className = 'row';
  const lab = document.createElement('span'); lab.className = 'lab'; lab.textContent = label;
  row.appendChild(lab); bar.appendChild(row); return row;
}
{
  const row = mkRow('方向');
  for (let i = 0; i < 8; i++) {
    const b = document.createElement('button');
    b.textContent = String(i + 1);
    b.onclick = () => { char.variant = i; char.lockedVariant = true; refreshBar(); };
    row.appendChild(b); barState.dirs.push(b);
  }
  const row2 = mkRow('服装');
  for (const key of Object.keys(COSTUMES)) {
    const b = document.createElement('button');
    b.textContent = COSTUMES[key].label || key;
    b.onclick = () => { currentCostume = key; refreshBar(); };
    b.dataset.key = key;
    row2.appendChild(b); barState.costs.push(b);
  }
  const row3 = mkRow('表演');
  for (const perf of PERFORMANCES) {
    const b = document.createElement('button');
    b.textContent = perf.triggerKey ? perf.name + ' (' + String(perf.triggerKey).replace('Key', '') + ')' : perf.name;
    b.onclick = () => enterPerformance(perf);
    row3.appendChild(b);
  }
  const aw = document.createElement('button');
  aw.textContent = '自动行走';
  aw.id = 'btnAuto';
  aw.onclick = () => { autoWalk = !autoWalk; aw.classList.toggle('on', autoWalk); };
  row3.appendChild(aw);
  const sp = document.createElement('button');
  sp.textContent = '停表演';
  sp.onclick = () => stopAllPerfs();
  row3.appendChild(sp);
}
function refreshBar() {
  barState.dirs.forEach((b, i) => b.classList.toggle('on', i === char.variant));
  barState.costs.forEach((b) => b.classList.toggle('on', b.dataset.key === currentCostume));
}
refreshBar();
document.getElementById('hud').innerHTML =
  '<b>' + EMBEDDED.characterName + '</b> · 程序化运行时<br>' +
  'A/D 或方向键移动 · W 跳跃 · 数字键锁方向 · 表演键见右上';
if (EMBEDDED.warnings && EMBEDDED.warnings.length) {
  document.getElementById('warn').textContent = '导出提示：\\n' + EMBEDDED.warnings.join('\\n');
}

// ---------- 主循环：输入 → 程序化姿态 → 表演合成 → 渲染 ----------
const uLoc = (pr, n) => gl.getUniformLocation(pr, n);
const partU = { cam: uLoc(partProg, 'uCam'), vh: uLoc(partProg, 'uViewHalf'), res: uLoc(partProg, 'uRes'), time: uLoc(partProg, 'uTime'), atlas: uLoc(partProg, 'uAtlas'), pal: uLoc(partProg, 'uPal'), base: uLoc(partProg, 'uBase'), glow: uLoc(partProg, 'uGlow') };
const solidU = { cam: uLoc(solidProg, 'uCam'), vh: uLoc(solidProg, 'uViewHalf') };
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; elapsed += dt;
  const ix = readMoveX();
  updateCharacter(dt, ix);
  if (char.onGround !== prevOnGround) {
    emitRuntimeEvent(char.onGround ? 'land' : 'takeoff', {});
    prevOnGround = char.onGround;
  }
  // 行为层：宿主喂 vars，逐部件行为图实时求值（时间基 = 60fps 帧；
  // phase 为步态相位帧：移动约 30/s、静止 4/s、腾空 18/s；
  // nodeRef 读哪帧由每张图的 follow 开关决定：'prev'（缺省）读上一帧
  // 输出（纯延迟一帧），'same' 读本帧第一遍的输出（无延迟））
  phaseAcc += dt * (char.onGround ? (ix !== 0 ? 30 : 4) : 18) / 60; // 圈/秒（1 圈 = 旧 60 相位帧）
  // 行为时钟 = 表演纪元起算的秒。图内时间一律秒（time 节点、
  // 周期参数、phase 圈数），全系统不再出现帧制时间。
  const behaviorT = elapsed - behaviorEpoch;
  // 宿主通用变量垫底、逐帧计算值在后覆盖：setVar 的变量状态机/行为图可读，
  // 但 t/phase/moveX/speed01/grounded 永远以本帧计算为准。
  const hostVars = Object.assign({}, hostCustomVars, {
    t: behaviorT, phase: phaseAcc, moveX: ix,
    speed01: ix !== 0 ? 1 : 0, grounded: char.onGround ? 1 : 0,
  });
  lastHostVars = hostVars;
  smUpdate(hostVars);
  let pose = {};
  for (const part of PARTS) pose[part.key] = { a: 0, dy: 0, rim: 0, glint: 0 };
  const behaviorOutputs = new Map();
  const runBehaviorPass = (nodeOutputsMap, onlySame) => {
    for (const key of Object.keys(BEHAVIOR_GRAPHS)) {
      const isSame = (BEHAVIOR_GRAPHS[key].follow || 'prev') === 'same';
      if (onlySame !== null && onlySame !== isSame) continue;
      const out = evalRuntimeGraph(BEHAVIOR_GRAPHS[key], {
        tSec: behaviorT, vars: hostVars, nodeState: behaviorState,
        nodeOutputs: nodeOutputsMap, statePrefix: key + ':',
      });
      const rec = out.get(key);
      if (rec) {
        pose[key] = { a: rec.angle, dx: rec.dx, dy: rec.dy, rim: 0, glint: 0 };
        behaviorOutputs.set(key, {
          rotation: -rec.angle * 180 / Math.PI, translateX: rec.dx, translateY: -rec.dy,
          scaleX: 1, scaleY: 1,
        });
      }
    }
  };
  // A 遍：全部图读上一帧输出（'prev' 图定稿、'same' 图作草稿）
  runBehaviorPass(prevBehaviorOutputs, null);
  // B 遍：'same' 图改读 A 遍草稿（本帧输出）重算
  if (Object.keys(BEHAVIOR_GRAPHS).some((k) => (BEHAVIOR_GRAPHS[k].follow || 'prev') === 'same')) {
    runBehaviorPass(new Map(behaviorOutputs), true);
  }
  prevBehaviorOutputs = behaviorOutputs;
  // 表演层：包络权重内合成到行为姿态之上
  for (let i = activePerfs.length - 1; i >= 0; i--) {
    const act = activePerfs[i];
    act.t += dt;
    // 循环表演（片段 loop）到尾回绕，不结束、不发 perfend
    if (act.perf.loop && act.t > act.perf.duration) act.t = act.t % act.perf.duration;
    const w = envelopeWeight(act.t, act.perf.duration, act.perf.envelope.in, act.perf.envelope.out);
    if (w > 0) {
      const bpOut = evalRuntimeGraph(act.perf.graph, { u: Math.min(1, act.t / act.perf.duration), tSec: act.t });
      pose = composePerformance(pose, act.perf, bpOut, w);
    }
    if (act.t > act.perf.duration) {
      activePerfs.splice(i, 1);
      emitRuntimeEvent('perfend', { id: act.perf.id, name: act.perf.name });
    }
  }
  const state = ensureAtlas(gl, char.variant, currentCostume);
  // 追随段进度：与「轨道」表演同一时间轴（全程窗 u ∈ 0..1，两端钳制）
  const tracksPerf = PERFORMANCES.find((p) => p.id === 'tracks');
  const followU = tracksPerf && tracksPerf.duration > 0
    ? Math.min(1, Math.max(0, elapsed / tracksPerf.duration)) : -1;
  const sorted = sortParts(PARTS, char.variant);
  const els = [];
  const elByKey = new Map();
  const dynAnchors = [];
  sorted.forEach((part, idx) => {
    const entry = state.map.get(part.key);
    if (!entry) return;
    let tile = entry.tile, place = entry.place;
    const resolved = entry.resolved;
    // 变体瓦片（动态表面 D1 × 置换 D2）：按 elapsed 算两维步号取变体
    if (entry.animFrames) {
      let fi = 0, di = 0;
      if (entry.anim) fi = surfaceStepAtRt(entry.anim, elapsed);
      if (entry.disp && entry.disp.steps > 1) {
        const fr = (((elapsed * entry.disp.speed + entry.disp.phase) % 1) + 1) % 1;
        di = Math.min(entry.disp.steps - 1, Math.floor(fr * entry.disp.steps));
      }
      const v = entry.animFrames[fi + ',' + di];
      if (v) { tile = v.tile; place = v.place; }
    }
    const p = resolved.params;
    const an0 = pose[part.key] || { a: 0, dy: 0, rim: 0, glint: 0 };
    const an = { a: an0.a + (p.restRot || 0), dx: an0.dx || 0, dy: an0.dy || 0, rim: an0.rim || 0, glint: an0.glint || 0 };
    const dynList = dynListFor(part);
    // 追随段：导出时烘好的增量曲线按轨道进度采样，叠进本部件位姿
    // （位置 + 角度；粒子锚点用同一 an/ctr，自动跟随）
    if (followU >= 0) {
      for (const inst of dynList) {
        const fc = inst.followCurve;
        if (!fc) continue;
        an.dx += followSampleAt(fc.dx, followU);
        an.dy += followSampleAt(fc.dy, followU);
        an.a += followSampleAt(fc.da, followU);
      }
    }
    const ctr = partCenter(p, an);
    // 动态模式：形变段逐帧求脉冲（多实例相乘）；合成/动态部件放大
    // 实例面片给足采样余量（片元按瓦片边界丢弃，多余面片无副作用）
    let dsx = 1, dsy = 1, hasDeform = false, spinRad = 0;
    for (const inst of dynList) {
      const d = dynDeformAt(inst.params, elapsed);
      dsx *= d.sx; dsy *= d.sy;
      if (inst.params.deformEnabled) hasDeform = true;
      // 自转段（D3）：原地自转（多实例求和）——只进 el.rot 与粒子
      // 锚点角，不进 partCenter（部件中心不被自转搬动）
      spinRad += dynSpinRadAt(inst.params, elapsed);
    }
    const rotA = an.a + spinRad;
    // 发光段：前 3 个启用实例各供一组参数（场在图集 RGB 三通道，导出时
    // 按选区预计算；第 4 个起在导出端已按各自所选组并入对应通道）
    const glowInsts = dynList.filter((x) => x.params.glowEnabled).slice(0, 3);
    const glowEl = glowInsts.map((x) => {
      const grgb = particleRgb(x.params.glowColor || '#7dd7ff');
      return [grgb[0], grgb[1], grgb[2], x.params.glowStrength || 0, x.params.glowHz || 0, x.params.glowPhase || 0];
    });
    const glowSpace = glowInsts.map((x) => (x.params.glowAngleSpace === 'world' ? 1 : 0));
    // 印章参数随图集条目走（导出端按服装集算好：解析形状=选区掩码+参数，片元重算）
    const glowStamps = entry.glowStamps ? entry.glowStamps.map((st) => (st ? [st.shape, st.halo, st.angleDeg, st.reach] : [4, 0, 0, 0])) : undefined;
    const comp = resolved.composite === 'overlay' ? 2 : resolved.composite === 'silhouette' ? 1 : resolved.composite === 'sprite' ? 3 : 0;
    const big = comp > 0 || dynList.length > 0;
    const el = {
      pos: [ctr[0], ctr[1]], size: big ? [tile.w * 3, tile.h * 3] : [tile.w, tile.h], rot: rotA,
      tileCx: tile.cx, tileCy: tile.cy,
      tile: [place[0], place[1], tile.w, tile.h],
      family: palIndex(p.pal), seed: (idx * 0.137) % 1,
      modes: [p.light, p.outline, p.rim, p.glint],
      param: [Math.min(1, (p.rimI || 0) + (an.rim || 0)), Math.min(1, (p.glintI || 0) + (an.glint || 0)), (idx * 0.137) % 1],
      ghost: false,
      composite: comp,
      deform: hasDeform ? [dsx, dsy] : undefined,
      glow: glowEl,
      glowSpace: glowSpace,
      glowStamps: glowStamps,
    };
    els.push(el);
    elByKey.set(part.key, el);
    if (dynList.length > 0) dynAnchors.push({ part: part, tile: tile, ctr: ctr, rot: rotA, dynList: dynList, dsx: dsx, dsy: dsy });
  });
  // 动态粒子：瓦片空间模拟（连续钟 elapsed × 包帧率量化帧，
  // 与编辑器同一帧基），发射点随形变缩放，位置经部件旋转落到
  // 世界（与片元采样同式）；绘制分身后/身前两遍夹住部件一遍。
  const backVerts = [], frontVerts = [];
  {
    const frameIdx = elapsed * FRAME_RATE;
    for (const a of dynAnchors) {
      const c = Math.cos(a.rot), s = Math.sin(a.rot);
      for (const inst of a.dynList) {
        for (const layer of ['back', 'front']) {
          const ps = dynSimulate(inst, a.tile, frameIdx, FRAME_RATE, layer, a.part.key);
          const target = layer === 'back' ? backVerts : frontVerts;
          for (const pt of ps) {
            const gx = pt.x * a.dsx, gy = pt.y * a.dsy;
            pushParticleQuad(target, a.ctr[0] + gx * c + gy * s, a.ctr[1] + gx * s - gy * c, pt.size, particleRgb(pt.color), pt.alpha);
          }
        }
      }
    }
  }
  // 裁剪面逐帧合成：锚点部件与本部件的当前位姿 → 本部件图空间
  // 平面（挂到 el 上，残影快照随后拷贝 el 时一并带走）
  for (const part of PARTS) {
    if (!part.clip) continue;
    const selfEl = elByKey.get(part.key);
    const anchorEl = elByKey.get(part.clip.by);
    if (!selfEl || !anchorEl) continue;
    const anchorPart = PARTS.find((p) => p.key === part.clip.by);
    selfEl.clip = clipPlaneForPart(part.clip, selfEl, anchorEl, anchorPart ? variantMirrored(anchorPart, char.variant) : false);
  }
  for (const act of activePerfs) {
    const ai = act.perf.afterimage;
    if (!ai) continue;
    const live = elByKey.get(ai.part);
    if (!live) continue;
    act.snapTimer += dt;
    if (act.snapTimer >= ai.interval) {
      act.snapTimer = 0;
      act.snaps.push({ el: Object.assign({}, live), born: elapsed });
      if (act.snaps.length > ai.count) act.snaps.shift();
    }
    const idx = els.indexOf(live);
    const ghosts = act.snaps
      .filter((s) => elapsed - s.born < ai.interval * ai.count * 1.8)
      .map((s) => Object.assign({}, s.el, { ghost: true }));
    els.splice(idx, 0, ...ghosts);
  }
  // 刀光：表演开始帧定格锚点部件位姿（位置+角度），其后不跟随；
  // 进度按表演本地时间走，帧图自图集刀光瓦片取（最后绘制、在最上层）
  for (const act of activePerfs) {
    const sl = act.perf.slash;
    if (!sl) continue;
    if (act.slashT !== undefined && act.t < act.slashT) act.slashSpawn = undefined;
    act.slashT = act.t;
    if (!act.slashSpawn) {
      const aEl = elByKey.get(sl.anchor);
      if (!aEl) continue;
      act.slashSpawn = { pos: [aEl.pos[0], aEl.pos[1]], rot: aEl.rot };
    }
    const dur = sl.durationSec > 0 ? sl.durationSec : (act.perf.duration || 0);
    if (!(dur > 0)) continue;
    const p = act.t / dur;
    if (p >= 1) continue;
    const frames = state.slashTiles ? state.slashTiles[act.perf.id] : null;
    if (!frames || !frames.length) continue;
    const ft = frames[Math.min(frames.length - 1, Math.floor(p * frames.length))];
    els.push({
      pos: [act.slashSpawn.pos[0], act.slashSpawn.pos[1]],
      size: [ft.size[0] * 3, ft.size[1] * 3], rot: act.slashSpawn.rot,
      tileCx: ft.tileCx, tileCy: ft.tileCy, tile: ft.tile,
      family: 0, seed: 0, modes: [0, 0, 0, 0], param: [0, 0, 0],
      ghost: false, composite: 4, deform: undefined, glow: [], glowSpace: [], glowStamps: undefined,
    });
  }
  const camX = char.x, camY = 52 + char.y * 0.35;
  gl.viewport(0, 0, lowW, VIEW_H);
  gl.clearColor(0.070, 0.070, 0.157, 1);
  gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(solidProg);
  gl.uniform2f(solidU.cam, camX, camY);
  gl.uniform2f(solidU.vh, lowW / 2, VIEW_H / 2);
  gl.bindVertexArray(solidVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, solidBuf);
  const sc = buildScenery(char.x, char.y, char.onGround);
  gl.bufferData(gl.ARRAY_BUFFER, sc, gl.DYNAMIC_DRAW);
  gl.drawArrays(gl.TRIANGLES, 0, sc.length / 9);
  if (backVerts.length) {
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(backVerts), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, backVerts.length / 9);
  }
  gl.disable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.useProgram(partProg);
  gl.uniform2f(partU.cam, camX, camY);
  gl.uniform2f(partU.vh, lowW / 2, VIEW_H / 2);
  gl.uniform2f(partU.res, lowW, VIEW_H);
  gl.uniform1f(partU.time, elapsed);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state.tex); gl.uniform1i(partU.atlas, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, palTex); gl.uniform1i(partU.pal, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, state.baseTex); gl.uniform1i(partU.base, 2);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, state.glowTex); gl.uniform1i(partU.glow, 3);
  gl.bindVertexArray(partVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, packInstances(els), gl.DYNAMIC_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, els.length);
  gl.bindVertexArray(null);
  if (frontVerts.length) {
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(solidProg);
    gl.uniform2f(solidU.cam, camX, camY);
    gl.uniform2f(solidU.vh, lowW / 2, VIEW_H / 2);
    gl.bindVertexArray(solidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, solidBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(frontVerts), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, frontVerts.length / 9);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
</body>
</html>`;
