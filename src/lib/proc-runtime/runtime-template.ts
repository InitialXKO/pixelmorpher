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
import { PIXEL_SRC } from './pixel-src';

export function buildRuntimeHtml(pkg: ProcRuntimePackage): string {
  const json = JSON.stringify(pkg).replace(/</g, '\\u003c');
  return TEMPLATE
    .split('/*__PACKAGE__*/').join(json)
    .split('/*__EVAL__*/').join(RUNTIME_EVAL_SRC)
    .split('/*__BAKE__*/').join(BAKE_SRC)
    .split('/*__DYNAMIC__*/').join(DYNAMIC_SRC)
    .split('/*__PIXEL__*/').join(PIXEL_SRC);
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
      // 服装件派生字段全量覆盖（与编辑器整件换外观对齐）：此前只覆盖 7 项，
      // 图层程序/形状/光照/描边等被静默留在默认集（运行时完备性审计缺口 1）。
      // pivot/restRot 由节点位姿派生、各集相同，不在此列。
      for (const f of ['pal', 'size', 'shapeKind', 'roundness', 'poly', 'polyPivot', 'off', 'light', 'outline', 'rim', 'glint', 'rimI', 'glintI', 'surface', 'surfaceGraph', 'composite', 'haloWidth', 'baseSprite']) {
        if (c[f] !== undefined) p[f] = c[f];
      }
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
    if (p && p.displaceEnabled && (p.displaceAmp || 0) > 0) {
      // 置换方向绑定（sprite-marks）：displaceDirMark 命中包内
      // 精灵的 direction/vector 标记时以标记角为准（direction
      // 直取；vector 按精灵像素分量取 atan2，y 向下——与编辑器
      // markDirAngleDeg 同口径），未命中用 displaceDeg
      const dirSrc = part.sprite || (part.base && part.base.baseSprite) || null;
      if (p.displaceDirMark && dirSrc && Array.isArray(dirSrc.marks)) {
        for (const mk of dirSrc.marks) {
          if (!mk || mk.name !== p.displaceDirMark) continue;
          if (mk.kind === 'direction') return { ...p, displaceDeg: ((mk.angleDeg % 360) + 360) % 360 };
          if (mk.kind === 'vector') {
            const dx = mk.dx * dirSrc.w, dy = mk.dy * dirSrc.h;
            if (dx !== 0 || dy !== 0) {
              const a = (Math.atan2(dy, dx) * 180) / Math.PI;
              return { ...p, displaceDeg: ((a % 360) + 360) % 360 };
            }
          }
          break;
        }
      }
      return p;
    }
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
/** 堆叠层图 RGBA 缓存（part.stack.layers 网格 → RGBA；解析与 convert
 * 的 gridToRgba 同口径：按位切片取 RGB、alpha 恒 255） */
const stackLayerCache = new Map();
function stackLayerRgba(part) {
  let hit = stackLayerCache.get(part.key);
  if (hit) return hit;
  const layers = (part.stack.layers || []).map((lg) => {
    const rgba = new Uint8ClampedArray(lg.w * lg.h * 4);
    for (let y = 0; y < lg.h; y++) {
      const row = lg.data[y] || [];
      for (let x = 0; x < lg.w; x++) {
        const cell = row[x];
        if (!cell) continue;
        const o = (y * lg.w + x) * 4;
        rgba[o] = parseInt(cell.slice(1, 3), 16);
        rgba[o + 1] = parseInt(cell.slice(3, 5), 16);
        rgba[o + 2] = parseInt(cell.slice(5, 7), 16);
        rgba[o + 3] = 255;
      }
    }
    return { rgba: rgba, width: lg.w, height: lg.h };
  });
  stackLayerCache.set(part.key, layers);
  return layers;
}
/** 堆叠单帧栅格化（与编辑器 rasterizeStackOpsData 同口径：逐算子逆
 * 仿射最近采样 + source-over 合成；算子已按深度排序、坐标在显示图
 * （并集画布）空间，条目为 [层序, a, b, c, d, e, f]） */
function stackRasterizeFrame(ops, layerRgba, W, H) {
  const out = new Uint8ClampedArray(W * H * 4);
  for (const op of ops) {
    const src = layerRgba[op[0]];
    if (!src) continue;
    const a = op[1], b = op[2], c = op[3], d = op[4], e = op[5], f = op[6];
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-9) continue;
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    const corners = [[0, 0], [src.width, 0], [0, src.height], [src.width, src.height]];
    for (const [px, py] of corners) {
      const x = a * px + c * py + e, y = b * px + d * py + f;
      if (x < mnx) mnx = x; if (x > mxx) mxx = x;
      if (y < mny) mny = y; if (y > mxy) mxy = y;
    }
    const x0 = Math.max(0, Math.floor(mnx)), x1 = Math.min(W - 1, Math.ceil(mxx));
    const y0 = Math.max(0, Math.floor(mny)), y1 = Math.min(H - 1, Math.ceil(mxy));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - e, dy = y + 0.5 - f;
        const sx = Math.floor((d * dx - c * dy) / det);
        const sy = Math.floor((-b * dx + a * dy) / det);
        if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
        const so = (sy * src.width + sx) * 4;
        const sa = src.rgba[so + 3] / 255;
        if (sa <= 0) continue;
        const oo = (y * W + x) * 4;
        const da = out[oo + 3] / 255;
        const oa = sa + da * (1 - sa);
        if (oa <= 0) continue;
        for (let ch = 0; ch < 3; ch++) {
          out[oo + ch] = Math.round((src.rgba[so + ch] * sa + out[oo + ch] * da * (1 - sa)) / oa);
        }
        out[oo + 3] = Math.round(oa * 255);
      }
    }
  }
  return out;
}
/** 堆叠件的干净底图瓦片（从 part.sprite 网格按瓦片几何重建，与图集
 * 打包同格对齐）：动态改写图集后按它还原底图副图集 */
function stackCleanBase(part, tile) {
  const sg = part.sprite;
  const base = new Uint8Array(tile.w * tile.h * 4);
  if (!sg) return base;
  const ox = Math.round(tile.cx - sg.plug[0]), oy = Math.round(tile.cy - sg.plug[1]);
  for (let y = 0; y < sg.h; y++) {
    const row = sg.data[y] || [];
    for (let x = 0; x < sg.w; x++) {
      const c = row[x];
      if (!c) continue;
      const rgb = parseHexRt(c);
      if (!rgb) continue;
      const tx = x + ox, ty = y + oy;
      if (tx < 0 || ty < 0 || tx >= tile.w || ty >= tile.h) continue;
      const o = (ty * tile.w + tx) * 4;
      base[o] = rgb[0]; base[o + 1] = rgb[1]; base[o + 2] = rgb[2]; base[o + 3] = 255;
    }
  }
  return base;
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
    if (rec.scaleX !== undefined) m.sx = (cur.sx || 1) * (1 + (rec.scaleX - 1) * w);
    if (rec.scaleY !== undefined) m.sy = (cur.sy || 1) * (1 + (rec.scaleY - 1) * w);
    if (rec.fore !== undefined) m.fore = (cur.fore || 1) * (1 + (rec.fore - 1) * w);
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
 * 开、尾部后收走；返回 {w, h, plugX, plugY, data: RGBA}，其中
 * w/h/plug 为有效帧布局（锚点本地系：用户盒以锚点为中心 ∪ 扇形
 * 紧包围盒，cx/cy = 椭圆中心相对锚点的偏移，dir = 扫向，见
 * slash-fan.ts 文件头）——帧尺寸随几何长大、扇体不被裁 */
const SLASH_PALETTE_RT = ['#ffffff', '#fff8d6', '#ffeba1', '#ffd166', '#ffab2e', '#ff7a00', '#e8481f', '#b01a33'];
function slashHexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function slashSmooth01(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
function slashFrameLayout(spec) {
  const outW = Math.max(4, Math.round(spec.w));
  const outH = Math.max(4, Math.round(spec.h));
  const rx = Math.max(2, spec.rx), ry = Math.max(2, spec.ry);
  const rot = spec.rotDeg * Math.PI / 180;
  const a0 = spec.a0Deg * Math.PI / 180;
  const dirSign = spec.dir === -1 ? -1 : 1;
  const sweep = Math.max(0.06, Math.min(5.8, spec.sweepDeg * Math.PI / 180));
  const S = 1.22;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  let gx0 = 0, gy0 = 0, gx1 = 0, gy1 = 0;
  const eat = (t) => {
    const lx = S * rx * Math.cos(t), ly = S * ry * Math.sin(t);
    const x = lx * cr - ly * sr, y = lx * sr + ly * cr;
    if (x < gx0) gx0 = x;
    if (x > gx1) gx1 = x;
    if (y < gy0) gy0 = y;
    if (y > gy1) gy1 = y;
  };
  eat(a0);
  eat(a0 + dirSign * sweep);
  const TWO_PI = Math.PI * 2;
  const inRange = (t) => {
    let r = (dirSign * (t - a0)) % TWO_PI;
    if (r < 0) r += TWO_PI;
    return r <= sweep + 1e-12;
  };
  const tx = Math.atan2(-(ry * sr), rx * cr);
  if (inRange(tx)) eat(tx);
  if (inRange(tx + Math.PI)) eat(tx + Math.PI);
  const ty = Math.atan2(ry * cr, rx * sr);
  if (inRange(ty)) eat(ty);
  if (inRange(ty + Math.PI)) eat(ty + Math.PI);
  const ux0 = Math.min(-outW / 2, spec.cx + gx0), ux1 = Math.max(outW / 2, spec.cx + gx1);
  const uy0 = Math.min(-outH / 2, spec.cy + gy0), uy1 = Math.max(outH / 2, spec.cy + gy1);
  const ox = Math.floor(ux0), oy = Math.floor(uy0);
  return {
    w: Math.ceil(ux1) - ox,
    h: Math.ceil(uy1) - oy,
    plugX: -ox,
    plugY: -oy,
  };
}
function slashFanFrame(spec, p, mirrored) {
  const lay = slashFrameLayout(spec);
  const outW = lay.w, outH = lay.h;
  const buf = new Uint8Array(outW * outH * 4);
  const palette = (spec.colors && spec.colors.length >= 2 ? spec.colors : SLASH_PALETTE_RT).map(slashHexRgb);
  const cx = lay.plugX + spec.cx, cy = lay.plugY + spec.cy;
  const rx = Math.max(2, spec.rx), ry = Math.max(2, spec.ry);
  const rotRad = spec.rotDeg * Math.PI / 180;
  const a0 = spec.a0Deg * Math.PI / 180;
  const dirSign = spec.dir === -1 ? -1 : 1;
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
        let rel = dirSign * (t - a0);
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
  return { w: outW, h: outH, plugX: lay.plugX, plugY: lay.plugY, data: buf };
}

/** 实例打包：24 float —— pos2 size2 rot1 pivotTile2 clipC1 tile4 misc4(family,seed,modes,composite) param4(rimI,glintI,phase,ghost) deform2 clipAB2。裁剪面占 iRotTileC.w（c）与 iDeform.zw（a,b）。发光全套（34 float）已搬侧车数据纹理（packGlowSidecar），顶点属性只剩 7 个：Mesa 等上报上限低于规范保证的环境也能链上，varying 同步腾空。 */
const INSTANCE_FLOATS = 24;
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
  });
  return buf;
}
/** 发光侧车：每实例一行 9 个 RGBA32F 纹素 —— 0/1/2=三组发光(rgb,强度)，
 * 3=(频A,相A,频B,相B)，4=(频C,相C,0,0)，5=三组方向基准(xyz,0)，
 * 6/7/8=三组印章(形状,光晕,主方向,伸长)。片元按实例号 texelFetch。 */
const GLOW_TEXELS = 9;
function packGlowSidecar(els) {
  const buf = new Float32Array(els.length * GLOW_TEXELS * 4);
  els.forEach((el, i) => {
    const o = i * GLOW_TEXELS * 4;
    const gl = el.glow || [];
    for (let gi = 0; gi < 3; gi++) {
      const g = gl[gi];
      buf[o + gi * 4] = g ? g[0] : 0; buf[o + gi * 4 + 1] = g ? g[1] : 0;
      buf[o + gi * 4 + 2] = g ? g[2] : 0; buf[o + gi * 4 + 3] = g ? g[3] : 0;
      buf[o + 12 + gi * 2] = g ? g[4] : 0; buf[o + 13 + gi * 2] = g ? g[5] : 0;
      buf[o + 20 + gi] = el.glowSpace && el.glowSpace[gi] ? 1 : 0;
      const st = el.glowStamps && el.glowStamps[gi];
      buf[o + 24 + gi * 4] = st ? st[0] : 4; buf[o + 25 + gi * 4] = st ? st[1] : 0;
      buf[o + 26 + gi * 4] = st ? st[2] : 0; buf[o + 27 + gi * 4] = st ? st[3] : 0;
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
/*__PIXEL__*/

// ---------- 数据（来自运行时包） ----------
const PAL = EMBEDDED.palettes;
const PAL_NAMES = Object.keys(PAL);
const palIndex = (name) => Math.max(0, PAL_NAMES.indexOf(name));
const PARTS = EMBEDDED.parts;
const COSTUMES = EMBEDDED.costumes;
const BEHAVIOR_GRAPHS = (EMBEDDED.behavior && EMBEDDED.behavior.graphs) || {};
const PERFORMANCES = EMBEDDED.performances || [];
const SIM_CHAINS = EMBEDDED.chains || [];
const PKG_SIM_MODE = EMBEDDED.simMode || 'frame';
const PROCEDURAL = EMBEDDED.procedural || [];
const GLOBAL_GRAPH = EMBEDDED.globalGraph || null;
const globalGraphState = new Map();
/** 工程帧率（包内字段）：粒子模拟的帧量化基数，与编辑器同口径；
 * 旧包无此字段时回落 60。时间本身走连续钟 elapsed，不重置。 */
const FRAME_RATE = EMBEDDED.frameRate || 60;
// 绘制顺序：按部件 sortOrder（= 产品节点 zIndex）稳定排序
function sortParts(parts) {
  return parts.slice().sort((a, b) => (a.sortOrder - b.sortOrder) || (a.key < b.key ? -1 : 1));
}
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
/** 残影段（D5）运行时状态：部件 el 快照环（有界；换装/变体/
 * 时间倒流时清环）。与表演残影同机制，区别是它由动态实例
 * 驱动、对任何在演部件常开。 */
const trailState = { epoch: '', lastElapsed: -1, rings: new Map() };
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
  const osig = overrideSig();
  if (atlasState && atlasState.variant === variant && atlasState.costumeName === costumeName && atlasState.osig === osig) return atlasState;
  const costume = COSTUMES[costumeName];
  const tiles = [], entries = [];
  const map = new Map();
  for (const part of PARTS) {
    const mirrored = variantMirrored(part, variant);
    const centry = costume ? costume[part.key] : undefined;
    const sgrid = costume && costume.__sprite ? costume.__sprite[part.key] : undefined;
    let resolved = null, tile = null, spriteGrid = null;
    const altSpr = slotOverrides[part.key] ? (part.altSprites || {})[slotOverrides[part.key]] : undefined;
    if (centry === null && sgrid) {
      spriteGrid = sgrid; // 参数化槽位在该集回落精灵（与主画布同口径）
    } else if (part.spriteKind && !centry) {
      spriteGrid = sgrid || part.sprite || null;
      if (!spriteGrid) { map.set(part.key, null); continue; }
    } else {
      resolved = resolvePart(part, variant, costume);
      if (resolved.params.hidden) { map.set(part.key, null); continue; }
    }
    if (altSpr) {
      // 逐槽变体覆盖：精灵部件换图；参数化部件只换底图（外观仍属当前集）
      if (spriteGrid) spriteGrid = altSpr;
      else if (resolved) resolved.baseSprite = altSpr;
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
    // 精灵标记点（研究线 sprite-marks）：点/矢量标记按瓦片几何
    // 换算成瓦片像素位（名 → [x, y]），挂条目新下标 [10]
    // （[6] 已被 tileExtra 占用，勿复用——见 spikes/sprite-marks）；
    // 方向角（direction 标记直取、vector 标记按精灵像素分量取
    // atan2，y 向下屏幕口径，与编辑器 markDirAngleDeg 同口径）
    // 挂 [12]（名 → 角度）
    let marksPx = null;
    let marksDir = null;
    // 标记来源：精灵部件走 spriteGrid；参数化部件走代表图 baseSprite
    // （缺口 8：此前 baseSprite.marks 无人读，底图路径的发射点/弧线
    // 原点/发光选区标记全部失效）。两者标记都按各自精灵归一化，同一
    // 换算口径（瓦片内居中偏移 + 镜像翻 x）。
    const markSrc = spriteGrid || (resolved && resolved.baseSprite) || null;
    if (markSrc && Array.isArray(markSrc.marks) && tileList.length) {
      const t0 = tileList[0];
      const mx0 = (t0.w - markSrc.w) / 2, my0 = (t0.h - markSrc.h) / 2;
      marksPx = {};
      marksDir = {};
      for (const mk of markSrc.marks) {
        if (!mk || typeof mk.name !== 'string') continue;
        if ((mk.kind === 'point' || mk.kind === 'vector') && !(mk.name in marksPx)) {
          let px = mx0 + mk.x * markSrc.w;
          const py = my0 + mk.y * markSrc.h;
          if (mirrored) px = t0.w - 1 - px;
          marksPx[mk.name] = [px, py];
        }
        if (mk.kind === 'direction' && !(mk.name in marksDir)) {
          marksDir[mk.name] = ((mk.angleDeg % 360) + 360) % 360;
        }
        if (mk.kind === 'vector' && !(mk.name in marksDir)) {
          const dx = mk.dx * markSrc.w, dy = mk.dy * markSrc.h;
          if (dx !== 0 || dy !== 0) {
            const a = (Math.atan2(dy, dx) * 180) / Math.PI;
            marksDir[mk.name] = ((a % 360) + 360) % 360;
          }
        }
      }
      if (!Object.keys(marksPx).length) marksPx = null;
      if (!Object.keys(marksDir).length) marksDir = null;
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
            : null,
          marksPx,
          // [11] plugN：瓦片归一化插头位（cx/w, cy/h，y 向下存、
          // 消费端 (1-y) 翻成 y-up 中心偏移）。原误挂 [6]（那是
          // tileExtra 数字）已修复，见 spikes/sprite-marks 第六节
          [vt.cx / vt.w, vt.cy / vt.h],
          marksDir]);
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
        cx: M + (mir ? fr.w - 1 - fr.plugX : fr.plugX), cy: M + fr.plugY,
        data: new Uint8Array((fr.w + M * 2) * (fr.h + M * 2) * 4),
      };
      for (let q = 0; q < tile.w * tile.h; q++) { tile.data[q * 4] = 255; tile.data[q * 4 + 3] = 255; }
      tiles.push(tile);
      entries.push(['slash:' + perf.id + ':' + fi, tile, { composite: 'slashfx', params: { hidden: false } }, false, fr, null, 0]);
    }
  }
  // 团块/火焰场槽（乙8 改造）：跟随口径 = 范围/位置跟、形态不跟
  // （用户定案）——烘焙帧一缩放就是拉伸形态，故图集只预留定尺寸
  // 槽位（域上限 = 形变 2 倍时的场尺寸），每帧由场作业按当帧
  // 形变现算场（域参数乘 ds、特征参数自然）重传槽内区。槽位
  // 锚点固定（域上限时的插头位），小域场按锚点偏移写入。
  const fieldSlots = {};
  const FIELD_DS_CAP = 2;
  for (const part of PARTS) {
    const cmapF = costume && costume.__dynamic;
    const dlF = (cmapF && cmapF[part.key]) || part.dynamic || [];
    if (!dlF.length) continue;
    dlF.forEach((inst, ii) => {
      const pp = (inst && inst.params) || {};
      const kindsF = [];
      if (pp.blobEnabled) kindsF.push('blob');
      if (pp.flameEnabled) kindsF.push('flame');
      for (const kind of kindsF) {
        const probe = kind === 'blob' ? dynBlobField(pp, 0, FIELD_DS_CAP, FIELD_DS_CAP) : dynFlameField(pp, 0, FIELD_DS_CAP, FIELD_DS_CAP);
        if (!probe) continue;
        const M = 2;
        const tile = {
          w: probe.w + M * 2, h: probe.h + M * 2,
          cx: M + probe.ox, cy: M + probe.oy,
          data: new Uint8Array((probe.w + M * 2) * (probe.h + M * 2) * 4),
          slotOx: probe.ox, slotOy: probe.oy, innerW: probe.w, innerH: probe.h,
        };
        for (let q = 0; q < tile.w * tile.h; q++) { tile.data[q * 4] = 255; tile.data[q * 4 + 3] = 255; }
        tiles.push(tile);
        entries.push(['field:' + part.key + ':' + ii + ':' + kind + ':slot', tile, { composite: 'slashfx', params: { hidden: false } }, false, { w: 0, h: 0, data: new Uint8Array(0) }, null, 0]);
      }
    });
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
      if (key.startsWith('field:')) {
        const regF = key.slice(6, key.lastIndexOf(':'));
        fieldSlots[regF] = {
          tile: [ax, ay, tile.w, tile.h], tileCx: tile.cx, tileCy: tile.cy, size: [tile.w, tile.h],
          place: [ax, ay], slotOx: tile.slotOx, slotOy: tile.slotOy, innerW: tile.innerW, innerH: tile.innerH,
        };
      } else {
      const perfId = key.slice(6, key.lastIndexOf(':'));
      const fi = Number(key.slice(key.lastIndexOf(':') + 1));
      (slashTiles[perfId] = slashTiles[perfId] || [])[fi] = {
        tile: [ax, ay, tile.w, tile.h], tileCx: tile.cx, tileCy: tile.cy, size: [tile.w, tile.h],
      };
    }
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
      map.set(ekey, { tile: tile, place: [ax, ay], resolved: entries[i][2], glowStamps: ge && ge.stamps ? ge.stamps : null, anim: entries[i][7] || null, disp: entries[i][9] || null, plugN: entries[i][11] || null, marksN: entries[i][10] || null, marksDir: entries[i][12] || null, fam: entries[i][4] ? 1 : 0, spriteGrid: entries[i][4] || null, mirrored: entries[i][3], tileExtra: entries[i][6] || 0 });
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
  atlasState = { variant: variant, costumeName: costumeName, osig: osig, tex: tex, baseTex: baseTex, glowTex: glowTex, map: map, slashTiles: slashTiles, fieldSlots: fieldSlots };
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
// ---------- 视图缩放（鼠标滚轮，纯视图层） ----------
// viewZoom 缺省 1：可见世界尺寸 = (lowW, VIEW_H)，与无缩放时逐像素
// 一致。缩放只改「可见世界宽高」这一取景量：凡把 (lowW, VIEW_H) 当
// 取景半幅喂着色器/换算指针的地方改喂 (visW(), visH())；凡当缓冲
// 尺寸用的（viewport、uRes、渲染目标、抓帧、canvas 位图）一律不乘。
// 相机位置与跟随逻辑（camState/camTX/camTY/snap/平滑）不碰，缩放
// 围绕画面中心（相机中心）进行。
// 注意：部件片元着色器按屏幕像素 1:1 采样瓦片（像素锁定约定），
// 只改取景半幅时部件纹理不会放大、只会随锚点滑动并被四边形裁切
// ——部件采样间距必须同步除以倍率（partProg 的 uZoom），角色才
// 真正随视图缩放。此坑即上一版「改取景高、角色大小没变」的机理。
let viewZoom = 1;
const VIEW_ZOOM_MIN = 0.2, VIEW_ZOOM_MAX = 8;
function visW() { return lowW / viewZoom; }
function visH() { return VIEW_H / viewZoom; }
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  // deltaMode: 0=像素 1=行；统一近似成像素量后指数步进（与主画布
  // 遮罩层的滚轮手感同一路数），触控板细粒度滚动也平滑。
  const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
  const next = viewZoom * Math.exp(-d * 0.002);
  viewZoom = Math.min(VIEW_ZOOM_MAX, Math.max(VIEW_ZOOM_MIN, next));
}, { passive: false });
// 双击复位 1 倍，防缩丢
canvas.addEventListener('dblclick', () => { viewZoom = 1; });
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
// 属性预算：发光全套已搬侧车数据纹理（uGlowSide，片元按实例号取），
// 顶点属性只剩 7 个（location 0-6），varying 同步腾空——Mesa 等上报
// 上限低于规范保证的环境也能链上。实例数据顺序与 packInstances 一致。
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPosSize;
layout(location=2) in vec4 iRotTileC;
layout(location=3) in vec4 iTile;
layout(location=4) in vec4 iMisc;
layout(location=5) in vec4 iParam;
layout(location=6) in vec4 iDeform;
uniform vec2 uCam; uniform vec2 uViewHalf; uniform vec2 uRes;
out vec2 vCenterScreen; out float vRot; out vec4 vTile; out vec2 vTileC; out vec4 vMisc; out vec4 vParam; out vec2 vDeform;
out vec3 vClip; flat out int vInstId;
void main(){
  float c = cos(iRotTileC.x), s = sin(iRotTileC.x);
  vec2 local = aCorner * iPosSize.zw;
  vec2 woff = vec2(local.x * c + local.y * s, local.x * s - local.y * c);
  vec2 world = iPosSize.xy + woff;
  vCenterScreen = ((iPosSize.xy - uCam) / uViewHalf * 0.5 + 0.5) * uRes;
  vRot = iRotTileC.x; vTile = iTile; vTileC = iRotTileC.yz; vMisc = iMisc; vParam = iParam; vDeform = iDeform.xy;
  vClip = vec3(iDeform.z, iDeform.w, iRotTileC.w);
  vInstId = gl_InstanceID;
  float z = 0.9 - float(gl_InstanceID) * 0.02;
  gl_Position = vec4((world - uCam) / uViewHalf, z, 1.0);
}\`,
\`#version 300 es
precision highp float;
uniform sampler2D uAtlas; uniform sampler2D uPal; uniform sampler2D uBase; uniform sampler2D uGlow; uniform float uTime;
uniform float uZoom;
in vec2 vCenterScreen; in float vRot; in vec4 vTile; in vec2 vTileC; in vec4 vMisc; in vec4 vParam; in vec2 vDeform;
in vec3 vClip; flat in int vInstId;
uniform sampler2D uGlowSide;
// 发光数据（侧车纹理取回后存全局，主体逻辑沿用同名变量）
vec4 vGlowA; vec4 vGlowB; vec4 vGlowC; vec4 vGlowHz; vec2 vGlowHz2; vec4 vGlowSpace;
vec4 vGlowStampA; vec4 vGlowStampB; vec4 vGlowStampC;
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
  vGlowA = texelFetch(uGlowSide, ivec2(0, vInstId), 0);
  vGlowB = texelFetch(uGlowSide, ivec2(1, vInstId), 0);
  vGlowC = texelFetch(uGlowSide, ivec2(2, vInstId), 0);
  vGlowHz = texelFetch(uGlowSide, ivec2(3, vInstId), 0);
  vGlowHz2 = texelFetch(uGlowSide, ivec2(4, vInstId), 0).xy;
  vGlowSpace = texelFetch(uGlowSide, ivec2(5, vInstId), 0);
  vGlowStampA = texelFetch(uGlowSide, ivec2(6, vInstId), 0);
  vGlowStampB = texelFetch(uGlowSide, ivec2(7, vInstId), 0);
  vGlowStampC = texelFetch(uGlowSide, ivec2(8, vInstId), 0);
  float mp = vMisc.z;
  int lm = int(mod(mp, 8.0));
  int om = int(mod(mp / 8.0, 8.0));
  int rm = int(mod(mp / 64.0, 8.0));
  int gm = int(mp / 512.0);
  int family = int(vMisc.x + 0.5);
  // 部件纹理按屏幕像素 1:1 采样（本渲染器的像素锁定约定）：视图
  // 缩放时采样间距同步除以倍率，纹理随视图放大/缩小；uZoom=1 时恒等
  vec2 d = (gl_FragCoord.xy - vCenterScreen) / uZoom;
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
const glowSideTex = gl.createTexture();
{
  gl.bindTexture(gl.TEXTURE_2D, glowSideTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
  const strides = [[1, 4, 0], [2, 4, 4], [3, 4, 8], [4, 4, 12], [5, 4, 16], [6, 4, 20]];
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
const bgProg = makeProgram(
\`#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUv;
uniform vec2 uCam; uniform vec2 uViewHalf;
out vec2 vUv;
void main(){ vUv = aUv; gl_Position = vec4((aPos - uCam) / uViewHalf, 0.995, 1.0); }\`,
\`#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex;
out vec4 oColor;
void main(){ oColor = vec4(texture(uTex, vUv).rgb, 1.0); }\`);
const bgVAO = gl.createVertexArray();
const bgBuf = gl.createBuffer();
{
  gl.bindVertexArray(bgVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 4 * 4, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4 * 4, 2 * 4);
  gl.bindVertexArray(null);
}
const bgU = { cam: gl.getUniformLocation(bgProg, 'uCam'), vh: gl.getUniformLocation(bgProg, 'uViewHalf'), tex: gl.getUniformLocation(bgProg, 'uTex') };
function drawBackground(camX, camY) {
  // 背景图四边形：0.85 倍视差跟随、1.4 倍视口大小（留出视差边距）
  const cx = camX * 0.85, cy = camY * 0.85;
  const w = visW() * 1.4, h = visH() * 1.4;
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  const v = new Float32Array([
    x0, y0, 0, 0, x1, y0, 1, 0, x1, y1, 1, 1,
    x0, y0, 0, 0, x1, y1, 1, 1, x0, y1, 0, 1,
  ]);
  gl.useProgram(bgProg);
  gl.uniform2f(bgU.cam, camX, camY);
  gl.uniform2f(bgU.vh, visW() / 2, visH() / 2);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bgTex); gl.uniform1i(bgU.tex, 0);
  gl.bindVertexArray(bgVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf);
  gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  // 复位到场景（solid）绘制状态，调用方随后照常画 scenery
  gl.useProgram(solidProg);
  gl.uniform2f(solidU.cam, camX, camY);
  gl.uniform2f(solidU.vh, visW() / 2, visH() / 2);
  gl.bindVertexArray(solidVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, solidBuf);
}
function buildScenery(charX) {
  const verts = [];
  const quad = (cx, cy, w, h, color, mode) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
    const corners = [[x0, y0, -1, -1], [x1, y0, 1, -1], [x1, y1, 1, 1], [x0, y0, -1, -1], [x1, y1, 1, 1], [x0, y1, -1, 1]];
    for (const cn of corners) verts.push(cn[0], cn[1], cn[2], cn[3], color[0], color[1], color[2], color[3], mode);
  };
  if (!bgTex) {
    const base = Math.floor(charX / 24) * 24;
    for (let i = -10; i <= 10; i++) {
      const gx = base + i * 24;
      const hh = 1.5 + (Math.abs(i * 7 + Math.floor(charX / 24)) % 3);
      quad(gx, hh / 2, 4, hh, [0.118, 0.118, 0.243, 1], 0);
    }
    if (moveMode === 'side') quad(charX, -0.75, 4000, 1.5, [0.165, 0.165, 0.322, 1], 0);
  }
  // 场景实体（横版体块 / 俯视平面块同一画法）；顶边亮线 = 可站立面
  for (let i = 0; i < solids.length; i++) {
    const q = solids[i];
    const sel = sceneEdit && i === selSolid;
    if (sel) quad(q.x + q.w / 2, q.y + q.h / 2, q.w + 1.6, q.h + 1.6, [0.98, 0.75, 0.2, 0.55], 0);
    quad(q.x + q.w / 2, q.y + q.h / 2, q.w, q.h, sel ? [0.36, 0.33, 0.19, 1] : [0.22, 0.21, 0.38, 1], 0);
    quad(q.x + q.w / 2, q.y + q.h - 0.6, q.w, 1.2, [0.45, 0.43, 0.62, 1], 0);
  }
  // 接触阴影：落在脚下最高支撑面上（俯视时即平面点）
  const fy = charFeetY();
  let supY = fy;
  if (moveMode === 'side') {
    supY = 0;
    for (const q of solids) {
      const top = q.y + q.h;
      const overX = char.x + CHAR_HW > q.x && char.x - CHAR_HW < q.x + q.w;
      if (overX && top <= fy + 0.01 && top > supY) supY = top;
    }
  }
  const shrink = char.onGround ? 1 : Math.max(0.5, 1 - (fy - supY) / 50);
  quad(char.x, supY + 0.4, 20 * shrink, 5 * shrink, [0.031, 0.031, 0.078, 0.5 * shrink], 1);
  return new Float32Array(verts);
}

// ---------- 画布修改轨后处理（缺口 5-2） ----------
// 参数解析与编辑器 resolveCanvasModifierParams 同口径（键帧间数值
// 线性插值、非数值在中点跳变）；六种修改器逐个以全屏着色器通道施加
// （顺序 = 工程轨序 × 轨内序，片段轨接在工程轨之后）。
function fxResolveCanvasParams(track, modifier, frame) {
  const kfs = [...(track.keyframes || [])].sort((a, b) => a.frame - b.frame);
  if (kfs.length === 0) return modifier.params || {};
  let prevKf = kfs[0], nextKf = null;
  for (const kf of kfs) {
    if (kf.frame <= frame) prevKf = kf;
    if (kf.frame > frame && !nextKf) nextKf = kf;
  }
  if (!nextKf) return { ...(modifier.params || {}), ...(prevKf.params || {}) };
  const t = (frame - prevKf.frame) / (nextKf.frame - prevKf.frame);
  const result = { ...(modifier.params || {}) };
  for (const key of Object.keys(prevKf.params || {})) {
    const pv = prevKf.params[key], nv = (nextKf.params || {})[key];
    if (typeof pv === 'number' && typeof nv === 'number') result[key] = pv + (nv - pv) * t;
    else result[key] = t < 0.5 ? pv : nv;
  }
  return result;
}
function fxCollectCanvasMods(set, frame, out) {
  for (const track of (set && set.canvasTracks) || []) {
    if (!track.visible || !track.enabled) continue;
    for (const m of track.modifiers || []) {
      if (!m.enabled) continue;
      out.push({ type: m.type, params: fxResolveCanvasParams(track, m, frame) });
    }
  }
}
let postSys = null;
function ensurePostSys() {
  if (postSys && postSys.w === lowW && postSys.h === VIEW_H) return postSys;
  const mkRT = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lowW, VIEW_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex: tex, fbo: fbo };
  };
  const A = mkRT(), B = mkRT(), C = mkRT(), D = mkRT();
  const depthRb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, lowW, VIEW_H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, A.fbo);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const prog = makeProgram(
    '#version 300 es\\nvoid main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }',
    '#version 300 es\\nprecision highp float;\\n'
    + 'uniform sampler2D uTex; uniform sampler2D uAux; uniform vec2 uRes; uniform int uEffect;\\n'
    + 'uniform vec4 uP0; uniform vec4 uP1; uniform vec3 uColor; uniform vec3 uColor2;\\n'
    + 'out vec4 oColor;\\n'
    + 'void main(){\\n'
    + '  vec2 uv = gl_FragCoord.xy / uRes;\\n'
    + '  vec4 c = texture(uTex, uv);\\n'
    + '  if (uEffect == 0) { oColor = c; return; }\\n'
    + '  if (uEffect == 1) {\\n' // color_lut：uP0.x=预设号(1 retro 2 mono 3 night 4 warm 5 cool 6 invert)，uP0.y=强度
    + '    if (c.a == 0.0) { oColor = c; return; }\\n'
    + '    vec3 v = c.rgb * 255.0; vec3 n2 = v; int pr = int(uP0.x + 0.5);\\n'
    + '    if (pr == 1) { n2 = vec3(min(255.0, floor(v.r / 32.0 + 0.5) * 32.0 + 20.0), min(255.0, floor(v.g / 32.0 + 0.5) * 32.0 + 10.0), floor(v.b / 48.0 + 0.5) * 48.0); }\\n'
    + '    else if (pr == 2) { float g = floor(0.299 * v.r + 0.587 * v.g + 0.114 * v.b + 0.5); n2 = vec3(g); }\\n'
    + '    else if (pr == 3) { float lum = (0.299 * v.r + 0.587 * v.g + 0.114 * v.b) / 255.0; float b2 = min(1.0, lum * 1.5); n2 = vec3(floor(b2 * 50.0 + 0.5), floor(b2 * 255.0 + 0.5), floor(b2 * 50.0 + 0.5)); }\\n'
    + '    else if (pr == 4) { n2 = vec3(min(255.0, v.r + 25.0), v.g + 5.0, max(0.0, v.b - 15.0)); }\\n'
    + '    else if (pr == 5) { n2 = vec3(max(0.0, v.r - 15.0), v.g + 5.0, min(255.0, v.b + 25.0)); }\\n'
    + '    else if (pr == 6) { n2 = 255.0 - v; }\\n'
    + '    oColor = vec4(mix(c.rgb, n2 / 255.0, uP0.y), c.a); return;\\n'
    + '  }\\n'
    + '  if (uEffect == 2) {\\n' // scanlines：uP0.x=行距 uP0.y=不透明度 uP0.z=暗角开关 uP0.w=暗角强度，uColor=线色
    + '    vec3 rgb = c.rgb;\\n'
    + '    float row = floor(gl_FragCoord.y);\\n'
    + '    if (mod(row, max(1.0, uP0.x)) == 0.0 && c.a > 0.0) rgb = mix(rgb, uColor, uP0.y);\\n'
    + '    if (uP0.z > 0.5) { vec2 d = (gl_FragCoord.xy - uRes * 0.5) / length(uRes * 0.5); float dk = max(0.0, 1.0 - dot(d, d) * uP0.w * 2.0); rgb *= dk; }\\n'
    + '    oColor = vec4(rgb, c.a); return;\\n'
    + '  }\\n'
    + '  if (uEffect == 3) {\\n' // pixel_zoom：uP0.x=缩放；界外填 uColor（舞台底色）
    + '    vec2 zuv = (uv - 0.5) / uP0.x + 0.5;\\n'
    + '    if (zuv.x < 0.0 || zuv.x > 1.0 || zuv.y < 0.0 || zuv.y > 1.0) { oColor = vec4(uColor, 1.0); return; }\\n'
    + '    oColor = texture(uTex, zuv); return;\\n'
    + '  }\\n'
    + '  if (uEffect == 4) {\\n' // canvas_mask：uP0.x=形状(0圆 1星 2圆角矩形 3菱形) uP0.y=边距px uP0.z=羽化px
    + '    float mg = uP0.y; float w2 = uRes.x - mg * 2.0; float h2 = uRes.y - mg * 2.0;\\n'
    + '    if (w2 <= 0.0 || h2 <= 0.0) { oColor = c; return; }\\n'
    + '    vec2 np = (gl_FragCoord.xy - uRes * 0.5) / vec2(w2 * 0.5, h2 * 0.5);\\n'
    + '    float inside = 0.0; float edge = 0.0; int sh = int(uP0.x + 0.5);\\n'
    + '    if (sh == 0) { float d = length(np); inside = d <= 1.0 ? 1.0 : 0.0; edge = 1.0 - d; }\\n'
    + '    else if (sh == 1) { float ang = atan(np.y, np.x); float r = length(np); float sr = 0.4 + 0.6 * pow(abs(cos(2.5 * ang)), 2.0); inside = r <= sr ? 1.0 : 0.0; edge = sr - r; }\\n'
    + '    else if (sh == 3) { float d = abs(np.x) + abs(np.y); inside = d <= 1.0 ? 1.0 : 0.0; edge = 1.0 - d; }\\n'
    + '    else { float cr = 0.2; vec2 an2 = abs(np); if (an2.x <= 1.0 - cr && an2.y <= 1.0) { inside = 1.0; edge = min(1.0 - an2.x, 1.0 - an2.y); } else if (an2.x <= 1.0 && an2.y <= 1.0 - cr) { inside = 1.0; edge = min(1.0 - an2.x, 1.0 - an2.y); } else if (an2.x <= 1.0 && an2.y <= 1.0) { float cd = length(an2 - (1.0 - cr)); inside = cd <= cr ? 1.0 : 0.0; edge = cr - cd; } }\\n'
    + '    if (inside < 0.5) { oColor = vec4(c.rgb, 0.0); return; }\\n'
    + '    float a = c.a;\\n'
    + '    if (uP0.z > 0.0) a *= clamp(edge / (uP0.z / (w2 * 0.5)), 0.0, 1.0);\\n'
    + '    oColor = vec4(c.rgb, a); return;\\n'
    + '  }\\n'
    + '  if (uEffect == 5) { oColor = vec4(c.rgb + texture(uAux, uv).rgb * texture(uAux, uv).a, c.a); return; }\\n' // bloom 合成
    + '  if (uEffect == 6) {\\n' // outline：uAux=掩码；uP0.x=厚度px uP0.y=方向集(4/8) uP0.z=模式(0实色 1暗版 2渐变) uP1.xy=光向 uColor=描边色
    + '    if (texture(uAux, uv).r > 0.5) { oColor = c; return; }\\n'
    + '    vec2 tp = 1.0 / uRes; float th = max(1.0, uP0.x); bool hit = false; vec2 hd = vec2(0.0);\\n'
    + '    for (int k = 1; k <= 5 && !hit; k++) { if (float(k) > th) break;\\n'
    + '      for (int di = 0; di < 8; di++) { if (uP0.y < 7.5 && di >= 4) break;\\n'
    + '        vec2 dir = di == 0 ? vec2(-1.0, 0.0) : di == 1 ? vec2(1.0, 0.0) : di == 2 ? vec2(0.0, -1.0) : di == 3 ? vec2(0.0, 1.0) : di == 4 ? vec2(-1.0, -1.0) : di == 5 ? vec2(-1.0, 1.0) : di == 6 ? vec2(1.0, -1.0) : vec2(1.0, 1.0);\\n'
    + '        if (texture(uAux, uv + dir * float(k) * tp).r > 0.5) { hit = true; hd = dir; break; } } }\\n'
    + '    if (!hit) { oColor = c; return; }\\n'
    + '    vec3 oc = uColor;\\n'
    + '    if (uP0.z > 1.5) { float f = dot(normalize(hd), uP1.xy) * 0.5 + 0.5; oc = mix(uColor * 0.7, mix(uColor, vec3(1.0), 0.5), f); }\\n'
    + '    else if (uP0.z > 0.5) oc = uColor * 0.7;\\n'
    + '    oColor = vec4(oc, 1.0); return;\\n'
    + '  }\\n'
    + '  if (uEffect == 7) {\\n' // bloom 亮部提取：uP0.x=阈值，uColor=辉光色
    + '    float lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;\\n'
    + '    float f = lum >= uP0.x ? (lum - uP0.x) / max(0.001, 1.0 - uP0.x) : 0.0;\\n'
    + '    oColor = vec4(uColor, c.a * f * uP0.y); return;\\n'
    + '  }\\n'
    + '  if (uEffect == 8 || uEffect == 9) {\\n' // 盒式模糊（8 横 9 纵）：uP0.x=半径px
    + '    vec2 dir = uEffect == 8 ? vec2(1.0 / uRes.x, 0.0) : vec2(0.0, 1.0 / uRes.y);\\n'
    + '    float r = clamp(uP0.x, 0.0, 16.0); vec4 sum = vec4(0.0); float cnt = 0.0;\\n'
    + '    for (int i = -16; i <= 16; i++) { if (abs(float(i)) > r) continue; sum += texture(uTex, uv + dir * float(i)); cnt += 1.0; }\\n'
    + '    oColor = sum / max(1.0, cnt); return;\\n'
    + '  }\\n'
    + '  oColor = c;\\n'
    + '}\\n');
  const U = {};
  for (const n of ['uTex', 'uAux', 'uRes', 'uEffect', 'uP0', 'uP1', 'uColor', 'uColor2']) U[n] = gl.getUniformLocation(prog, n);
  const maskTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  postSys = { w: lowW, h: VIEW_H, A: A, B: B, C: C, D: D, prog: prog, U: U, maskTex: maskTex, vao: gl.createVertexArray() };
  return postSys;
}
/** 掩码栅格化（CPU，低清）：把各部件瓦片 alpha 按位姿印到覆盖视野的
 *  网格上，供描边通道采样（编辑器以全画布 alpha 为准；此处以部件
 *  瓦片为准，笔触/粒子不进掩码）。 */
function fxBuildMask(state, elByKey, camX, camY) {
  const sys = postSys;
  // mh 只取决于宽高比，缩放下不变，仍按基础量算（保 1 倍时逐值一致）
  const mw = 256, mh = Math.max(2, Math.round(256 * VIEW_H / lowW));
  const data = new Uint8Array(mw * mh * 4);
  const sx = mw / visW(), sy = mh / visH();
  for (const [key, el] of elByKey) {
    const entry = state.map.get(key);
    if (!entry || !entry.tile || !entry.tile.data) continue;
    const tile = entry.tile;
    const co = Math.cos(el.rot), si = Math.sin(el.rot);
    const dsx = el.deform ? el.deform[0] : 1, dsy = el.deform ? el.deform[1] : 1;
    for (let py = 0; py < tile.h; py++) {
      for (let px = 0; px < tile.w; px++) {
        if (tile.data[(py * tile.w + px) * 4 + 3] <= 8) continue;
        const gx = (px - tile.cx) * dsx, gy = (tile.cy - py) * dsy;
        const wx = el.pos[0] + co * gx + si * gy;
        const wy = el.pos[1] + si * gx - co * gy;
        const mx = Math.floor((wx - (camX - visW() / 2)) * sx);
        const my = Math.floor((wy - (camY - visH() / 2)) * sy);
        if (mx < 0 || my < 0 || mx >= mw || my >= mh) continue;
        data[(my * mw + mx) * 4] = 255;
        data[(my * mw + mx) * 4 + 3] = 255;
      }
    }
  }
  gl.bindTexture(gl.TEXTURE_2D, sys.maskTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, mw, mh, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
}
function fxRunPostChain(rawList, state, elByKey, camX, camY) {
  const sys = ensurePostSys();
  // 静态无效的修改器先滤掉（剩下全是空链时仍须把场景平贴到屏幕）
  const list = rawList.filter((m) => {
    const P = m.params || {};
    if (m.type === 'color_lut') {
      const presets = { retro: 1, monochrome: 2, nightvision: 3, warm: 4, cool: 5, invert: 6 };
      return (presets[String(P.preset || 'none')] || 0) !== 0 && Number(P.intensity ?? 1) !== 0;
    }
    if (m.type === 'pixel_zoom') return Number(P.scale || 1) !== 1;
    return true;
  });
  let src = sys.A;
  let needMask = list.some((m) => m.type === 'outline_emphasis');
  if (needMask) fxBuildMask(state, elByKey, camX, camY);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(sys.vao);
  const pass = (dst, effect, setup, auxTex) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fbo : null);
    gl.viewport(0, 0, lowW, VIEW_H);
    gl.useProgram(sys.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(sys.U.uTex, 0);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, auxTex || sys.C.tex);
    gl.uniform1i(sys.U.uAux, 4);
    gl.uniform2f(sys.U.uRes, lowW, VIEW_H);
    gl.uniform1i(sys.U.uEffect, effect);
    gl.uniform4f(sys.U.uP0, 0, 0, 0, 0);
    gl.uniform4f(sys.U.uP1, 0, 0, 0, 0);
    gl.uniform3f(sys.U.uColor, 0, 0, 0);
    gl.uniform3f(sys.U.uColor2, 0, 0, 0);
    if (setup) setup();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    if (dst) src = dst;
  };
  const other = () => (src === sys.A ? sys.B : sys.A);
  if (list.length === 0) { pass(null, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(null); return; }
  list.forEach((m, mi) => {
    const last = mi === list.length - 1;
    const dst = last ? null : other();
    const P = m.params || {};
    const n = (v, d) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? d : Number(v));
    if (m.type === 'color_lut') {
      const presets = { retro: 1, monochrome: 2, nightvision: 3, warm: 4, cool: 5, invert: 6 };
      const pr = presets[String(P.preset || 'none')] || 0;
      if (pr === 0 || n(P.intensity, 1) === 0) { if (!last) pass(dst, 0); return; }
      pass(dst, 1, () => { gl.uniform4f(sys.U.uP0, pr, n(P.intensity, 1), 0, 0); });
    } else if (m.type === 'scanlines') {
      const lc = fxHexRgb(P.lineColor || '#000000');
      pass(dst, 2, () => {
        gl.uniform4f(sys.U.uP0, n(P.lineSpacing, 2), n(P.lineOpacity, 0.3), P.vignette ? 1 : 0, n(P.vignetteIntensity, 0.3));
        gl.uniform3f(sys.U.uColor, lc[0], lc[1], lc[2]);
      });
    } else if (m.type === 'pixel_zoom') {
      const scale = n(P.scale, 1);
      if (scale === 1) { if (!last) pass(dst, 0); return; }
      const zoomSrc = src;
      gl.bindTexture(gl.TEXTURE_2D, zoomSrc.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, P.antiAlias && scale < 1 ? gl.LINEAR : gl.NEAREST);
      pass(dst, 3, () => {
        gl.uniform4f(sys.U.uP0, scale, 0, 0, 0);
        gl.uniform3f(sys.U.uColor, 0.070, 0.070, 0.157);
      });
      gl.bindTexture(gl.TEXTURE_2D, zoomSrc.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    } else if (m.type === 'canvas_mask') {
      const shapes = { circle: 0, star: 1, rounded_rect: 2, diamond: 3 };
      pass(dst, 4, () => {
        gl.uniform4f(sys.U.uP0, shapes[String(P.shape || 'circle')] ?? 0, n(P.margin, 0), n(P.feather, 0), 0);
      });
    } else if (m.type === 'bloom') {
      const bc = fxHexRgb(P.color || '#ffffff');
      // 亮部提取（色调先行与编辑器后着色等价：模糊只搬运 alpha 与
      // 均匀色调）；intensity 折进亮部 alpha（编辑器在着色时乘）。
      pass(sys.C, 7, () => {
        gl.uniform4f(sys.U.uP0, n(P.threshold, 0.7), n(P.intensity, 0.5), 0, 0);
        gl.uniform3f(sys.U.uColor, bc[0], bc[1], bc[2]);
      });
      const keepSrc = src;
      src = sys.C;
      pass(sys.D, 8, () => { gl.uniform4f(sys.U.uP0, n(P.radius, 3), 0, 0, 0); });
      pass(sys.C, 9, () => { gl.uniform4f(sys.U.uP0, n(P.radius, 3), 0, 0, 0); });
      src = keepSrc;
      pass(dst, 5, null, sys.C.tex);
    } else if (m.type === 'outline_emphasis') {
      const oc = fxHexRgb(P.color || '#000000');
      const modes = { solid: 0, darken: 1, gradient: 2 };
      const la = n(P.lightAngle, 315) * Math.PI / 180;
      pass(dst, 6, () => {
        gl.uniform4f(sys.U.uP0, n(P.thickness, 1), String(P.directions) === '4' ? 4 : 8, modes[String(P.outlineMode || 'solid')] ?? 0, 0);
        gl.uniform4f(sys.U.uP1, Math.cos(la), -Math.sin(la), 0, 0);
        gl.uniform3f(sys.U.uColor, oc[0], oc[1], oc[2]);
      }, sys.maskTex);
    } else {
      if (!last) pass(dst, 0);
    }
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindVertexArray(null);
}

// ---------- 宿主输入与运行时状态 ----------
const char = { x: 0, y: 0, py: 0, vy: 0, onGround: true, variant: 0, lockedVariant: false, wallDir: 0, ledge: null };
// 现场可调参数（控制条「手感」面板直改；宿主包 pkg.scene 可给初值）
const PHYS = { speed: 140, jumpV: 350, gravity: 720, camFollow: 10, camLockX: false, camLockY: false };
// 按键绑定（控制条「按键」面板可重绑；方向键恒为备用）
const KEYMAP = { left: 'KeyA', right: 'KeyD', jump: 'KeyW', down: 'KeyS' };
let rebindTarget = null; // {kind:'move', act} | {kind:'perf', perf}
// 移动模式：'side' 横版（重力+跳跃）/ 'top' 俯视（无重力平面移动驱动 8 方向）
let moveMode = 'side';
// 场景实体（AABB，左下角 x/y + 宽高，世界单位、y 向上）：包内 scene 优先，
// 否则用内置默认关卡（一块台阶、两块平台、一面可贴可抓的高块）。
let solids = (EMBEDDED.scene && Array.isArray(EMBEDDED.scene.solids) && EMBEDDED.scene.solids.length)
  ? EMBEDDED.scene.solids.map((q) => ({ x: +q.x || 0, y: +q.y || 0, w: Math.max(2, +q.w || 2), h: Math.max(2, +q.h || 2) }))
  : [
      { x: -40, y: 0, w: 30, h: 14 },
      { x: -108, y: 26, w: 52, h: 6 },
      { x: 34, y: 48, w: 56, h: 6 },
      { x: 116, y: 0, w: 12, h: 62 },
    ];
let sceneEdit = false, selSolid = -1, bgTex = null;
// 相机状态（平滑跟随；camSnap 时本帧直接对齐目标）
const camState = { x: 0, y: 52, snap: true };
// 输入录制/回放：帧级记录 {dt, ix, jump, down, trig, variant, locked, costume, aw}，
// 回放按记录 dt 与输入序列重演（模拟确定性重放；粒子随机仅影响观感）
const pendingTriggers = [];
const rec = { active: false, frames: [], start: null };
const replay = { active: false, idx: 0, frames: [], gif: false };
function charFeetY() { return moveMode === 'top' ? char.py : char.y; }
function charOriginY() { return charFeetY() - localGround; }
// ---- 链摆实时模拟（运行时，D6 乙路）：包内 chains 给定义（链节点
// 部件键 + 参数）。本遍位于表演合成之后、部件落位之前（pose 已
// 定稿）：以落位同一组装算各链关节世界位为参考，链根钉在参考
// 首点、各段段长逐帧现取（与编辑器/烘焙同口径），步进器与编辑
// 器 stepChainSim 同一份数学（孪生）：钉根 → 积分 → 距离约束迭
// 代。坐标为运行时系（y 向上），故重力项取负（编辑器系 y 向下、
// gravity 向下为正），风 x 同向；退化段向的兜底方向同理翻转。
// 解出关节经角增量 + 中心补差回写 pose（详见 runSimPass），落位
// 循环随后按新 pose 落位；钳制锚定遍在落位后跑，看到的是模拟
// 后位姿（编辑器同序：模拟先于钳制）。状态键 = 链根 nodeId（跨
// 表演同链延续，与锚定遍同口径）；录制/回放起点与 hardRelockTo
// 全清（与锚定遍同一生命周期）。步进定步长 = 包帧率，步数由
// 玩家时钟在 frame() 头决定（frame/wall/audio 三模式）。
const simStates = new Map();
let simSteppedElapsed = 0;
const PART_BY_KEY = new Map(PARTS.map((p) => [p.key, p]));
/** 落位循环同式的部件参数：与 ensureAtlas 的条目组装对齐——精灵
 * 回落分支用合成参数（base + off 清零），其余走 resolvePart；
 * hidden（该集无此件）返回 null（落位循环里该部件无条目）。 */
function simPartParams(part) {
  const costume = COSTUMES[currentCostume];
  const centry = costume ? costume[part.key] : undefined;
  const sgrid = costume && costume.__sprite ? costume.__sprite[part.key] : undefined;
  const spriteGrid = (centry === null && sgrid) ? sgrid
    : (part.spriteKind && !centry) ? (sgrid || part.sprite || null) : null;
  if (spriteGrid) return { ...part.base, off: [0, 0] };
  const resolved = resolvePart(part, char.variant, costume);
  return resolved.params.hidden ? null : resolved.params;
}
function simStepChain(st, pin, lengths, params) {
  const pts = st.pts;
  const n = pts.length;
  const dt = 1 / Math.max(1, FRAME_RATE);
  const keep = 1 - Math.max(0, Math.min(0.2, params.damping));
  const iters = Math.max(1, Math.min(24, Math.round(params.iterations)));
  pts[0].x = pin[0]; pts[0].y = pin[1]; pts[0].px = pin[0]; pts[0].py = pin[1];
  for (let i = 1; i < n; i++) {
    const p = pts[i];
    const vx = (p.x - p.px) * keep;
    const vy = (p.y - p.py) * keep;
    p.px = p.x; p.py = p.y;
    p.x += vx + params.windX * dt * dt;
    p.y += vy - params.gravity * dt * dt;
  }
  for (let it = 0; it < iters; it++) {
    pts[0].x = pin[0]; pts[0].y = pin[1];
    for (let i = 0; i + 1 < n; i++) {
      const a = pts[i], b = pts[i + 1];
      const want = lengths[i];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d < 1e-6) { dx = 0; dy = -1; d = 1; }
      const diff = (d - want) / d;
      if (i === 0) { b.x -= dx * diff; b.y -= dy * diff; }
      else { a.x += dx * diff * 0.5; a.y += dy * diff * 0.5; b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5; }
    }
  }
}
function simLocalAngleDeltas(solved, reference) {
  const n = solved.length;
  const w = [];
  for (let i = 0; i < n; i++) {
    if (i + 1 < n) {
      let d = Math.atan2(solved[i + 1][1] - solved[i][1], solved[i + 1][0] - solved[i][0])
        - Math.atan2(reference[i + 1][1] - reference[i][1], reference[i + 1][0] - reference[i][0]);
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      w.push(d);
    } else {
      w.push(n >= 2 ? w[i - 1] : 0);
    }
  }
  return w.map((d, i) => d - (i > 0 ? w[i - 1] : 0));
}
/** 模拟遍（落位前，pose 已定稿）：对每条 chain 按 chainNodeIds
 * 顺序取各部件 pose、以落位循环同一组装（an = pose + restRot、
 * partCenter）算世界关节位（遍内第一遍 partCenter 评估）；pin =
 * 首关节、逐帧段长 = 相邻关节距；孪生步进 steps 步（多步复用当
 * 帧 pin/段长，近似见时钟注释）；解出关节后逐部件回写 pose——
 * 先按 simLocalAngleDeltas 的本地角增量改 pose.a，再以改角后的
 * partCenter 复算中心（第二遍评估）、用 pose.dx/dy 补差使中心
 * 恰落到解出关节位。落位循环随后按新 pose 落位，钳制锚定遍看
 * 到的即模拟后位姿（编辑器同序：模拟先于钳制）。 */
function runSimPass(pose, steps) {
  if (!SIM_CHAINS.length || steps <= 0) return;
  for (const ch of SIM_CHAINS) {
    const items = [];
    let okAll = true;
    for (const k of ch.nodes) {
      const part = PART_BY_KEY.get(k);
      const p = part ? simPartParams(part) : null;
      if (!part || !p) { okAll = false; break; }
      const an0 = pose[k] || { a: 0, dy: 0 };
      const an = { a: (an0.a || 0) + (p.restRot || 0), dx: an0.dx || 0, dy: an0.dy || 0 };
      items.push({ key: k, p: p, ctr: partCenter(p, an) });
    }
    if (!okAll) { simStates.delete(ch.nodeId); continue; }
    const ref = items.map((it) => it.ctr);
    let st = simStates.get(ch.nodeId);
    const fresh = !st;
    if (fresh) {
      st = { pts: ref.map((q) => ({ x: q[0], y: q[1], px: q[0], py: q[1] })) };
      simStates.set(ch.nodeId, st);
    }
    // 播种帧不迈步（与批量求解第 0 帧只对齐钉点、编辑器会话片段
    // 起点初始化同口径）：本帧解出位即参考位、增量为 0，下帧起步进。
    const lengths = [];
    for (let i = 0; i + 1 < ref.length; i++) lengths.push(Math.hypot(ref[i + 1][0] - ref[i][0], ref[i + 1][1] - ref[i][1]));
    if (!fresh) for (let s = 0; s < steps; s++) simStepChain(st, ref[0], lengths, ch.params);
    const solved = st.pts.map((q) => [q.x, q.y]);
    const locals = simLocalAngleDeltas(solved, ref);
    for (let i = 0; i < items.length; i++) {
      const entry = pose[items[i].key] || (pose[items[i].key] = { a: 0, dy: 0, rim: 0, glint: 0 });
      if (locals[i]) entry.a = (entry.a || 0) + locals[i];
      const an1 = { a: (entry.a || 0) + (items[i].p.restRot || 0), dx: entry.dx || 0, dy: entry.dy || 0 };
      const c1 = partCenter(items[i].p, an1);
      entry.dx = (entry.dx || 0) + (solved[i][0] - c1[0]);
      entry.dy = (entry.dy || 0) + (solved[i][1] - c1[1]);
    }
  }
}
// ---------- 默认动作表演兜底（播放器内置） ----------
// 定位：包内没有作者自带的对应动作时，用现行姿态管线（pose 的
// a/dx/dy，与模拟遍同一回写口径：改角 → partCenter 复算 → dx/dy
// 补差到目标中心）合成最低限度的身体动作。作者内容优先
// （红线）：包内有走/跳语义的表演（name/trigger/id 命中），或已
// 识别的腿部部件挂了行为图（作者直接驱动腿），对应兜底整体不
// 介入。缺位判定只读包内静态数据，加载期定一次。
// 腿脚识别：convert 随包发 skeleton（部件键 → 节点名/父部件键），
// 按骨骼名（含中英日常见腿脚词）+ 父子链识别腿链，再按同父分组
// 成对反相（两足对位、四足对角）；旧包无 skeleton 时以部件键为
// 名、无父子（各自成单段链）。识别不到成对的腿 → 兜底整体不
// 生效并点名（console + 警告条）；不许靠几何硬猜骨骼。
// 动作机制（脚目标驱动，取代旧正弦开环摆腿）：每条腿链由「脚
// 目标点 + 两骨解析解算」驱动——行走分支撑段（脚钉在地面点、
// 世界系静止，滑步由构造消除）与摆动段（脚沿弧线快速前送）；
// 身体高度由支撑腿几何反推（分腿站位越开、身体越低，起伏自
// 然产生）；跳跃四段（下蹲脚钉地折膝 → 蹬伸过冲 → 滞空收/伸
// 腿 → 落地浅沉吸收）共用同一套脚目标与解算。
const FB_CROUCH_DUR = 0.20;   // 跳跃预备总时长（s）：下蹲 0.13 + 蹬伸 0.07（物理倒计时与起跳顺延共用）
const FB_EXT_U = 0.65;        // 蹬伸段在预备进度中的起点（0.13/0.20）
const FB_STANCE = 0.6;        // 步态周期中支撑段占比（摆动段 0.4）
const FB_SWING = 0.38;        // 步长推导用等效摆幅（rad）：stride = 2·腿长·sin(摆幅)
const FB_LEG_NAME = /leg|thigh|shin|calf|femur|foot|feet|toe|ankle|knee|paw|腿|脚|足|膝|踝|胫|股|ひざ|つま先/i;
const FB_NOT_LEG = /arm|wing|tail|ear|horn|手|腕|肘|肩|翼|耳|眼/i;
let FB = null;           // 懒构建（首帧 costume/variant 已定）
let fbCrouchT = 0;       // >0 = 跳跃预备倒计时（剩余秒，物理侧递减、到点给初速）
let fbPhase = 0;         // 步态相位（按实测位移推进，撞墙即停）
let fbWalkW = 0;         // 横版行走混合权重
let fbTopW = 0;          // 俯视行走混合权重
let fbTopVertW = 0;      // 俯视纵向（走廊驱动）混合权重：主导轴在横/纵间切换时平滑过渡，fbPhase 共用不重置
let fbPrevX = null, fbPrevPY = null;
// —— 脚目标驱动的状态 ——
let fbStage = 'none';    // 跳跃阶段：'none' | 'crouch' | 'air' | 'absorb'
let fbStageT = 0;        // 当前阶段已持续秒数
let fbAirTime = 0;       // 本次连续滞空秒数（坠落落地吸收的触发判据）
let fbAirRootFrom = 0;   // 离地瞬间的身体过冲量（滞空初期衰减回 0）
const fbPlants = new Map();     // 链序 → 支撑脚的世界 x（横版：下蹲/支撑/吸收共用）
const fbTopPlants = new Map();  // 链序 → 支撑脚的世界平面位 [x, y]（俯视）
const fbCorPlants = new Map();  // 链序 → 走廊支撑脚锚定的世界平面位 [x, y]（俯视纵向专用，与平面步态分表）
const fbCorSegPrev = new Map(); // 链序 → 走廊驱动上帧所处段（0 支撑 / 1 摆动，走廊专用）
const fbTipPrev = new Map();    // 链序 → 上帧解算出的脚尖关节本地位（目标连续性）
const fbSegPrev = new Map();    // 链序 → 上帧所处段（0 支撑 / 1 摆动）
const fbSwingFrom = new Map();  // 链序 → 本次摆动段起点脚位（本地）
const fbAirCur = new Map();     // 链序 → 滞空脚目标当前值（本地，向当帧目标趋近）
let fbTopDir = [1, 0];          // 俯视最近移动方向（单位矢量）
function fbDipMax() { return Math.max(3, Math.min(9, charBoxH() * 0.13)); }
function fbJointOf(prm) {
  const c = Math.cos(prm.restRot || 0), s = Math.sin(prm.restRot || 0);
  return [prm.pivot[0] + prm.off[0] * c - prm.off[1] * s, prm.pivot[1] + prm.off[0] * s + prm.off[1] * c];
}
function fbParamsOf(part) {
  // 与模拟遍/落位同一组装（simPartParams：精灵部件 {...base, off:0}、
  // 参数化部件走 resolvePart），保证 partCenter 复算与落位逐值一致
  return simPartParams(part);
}
/** 末节部件的脚底延伸（关节到精灵底边的距离）：2 节链的接触点
 * 按此沿末段方向续出（末节精灵沿腿线垂挂，接触点即其下端）。 */
function fbTipExtent(part) {
  if (!part) return 8;
  if (part.spriteKind && part.sprite) return Math.max(4, part.sprite.h - part.sprite.plug[1]);
  const sz = part.base && part.base.size;
  return Math.max(4, ((sz && sz[1]) || 12) * 0.55);
}
/** 链的静止目标点（本地）：3+ 节链 = 末关节（踝）；2 节链 = 脚底
 * 接触点（末关节沿末段方向续 tipExt）；1 节链 = 链根。 */
function fbRestTarget(J, tipExt) {
  const n = J.length;
  if (n === 2) {
    const dx = J[1][0] - J[0][0], dy = J[1][1] - J[0][1], d = Math.hypot(dx, dy) || 1;
    return [J[1][0] + (dx / d) * tipExt, J[1][1] + (dy / d) * tipExt];
  }
  return J[n - 1];
}
/** 链的有效段长和（根 → 目标点）：2 节链含脚底延伸段。 */
function fbSegSumEff(J, tipExt) {
  let s = 0;
  for (let i = 0; i + 1 < J.length; i++) s += Math.hypot(J[i + 1][0] - J[i][0], J[i + 1][1] - J[i][1]);
  return J.length === 2 ? s + tipExt : s;
}
/** 两骨解析解算：给定当帧静止关节 J（本地）、末节脚底延伸
 * tipExt、链根附加纵向偏移 rootOffY 与目标点 F（3+ 节链 = 踝关
 * 节目标，2 节链 = 脚底接触点目标），求各关节目标位 P、各部件
 * 绘制角增量 cumA 与解算目标点 tip。解算在点列 JJ 上进行（2 节
 * 链把接触点作虚拟链尖补入）：根→次节→链尖两骨解算（余弦定
 * 理，弯曲侧取静止姿态膝盖偏向侧、由静止叉积符号定死），中间
 * 关节按「尾段刚性旋转」跟随（次节→链尖在静止姿态下的相对构
 * 型整体旋转到解算方向，段长逐值不变、链尖精确落 F）。
 * footDelta = 末节（脚）部件的绘制角增量，null = 跟随末段方向。 */
function fbSolveChain(J, tipExt, rootOffY, F, footDelta) {
  const n = J.length;
  const R = [J[0][0], J[0][1] + rootOffY];
  if (n === 1) return { P: [R], cumA: [0], tip: R };
  let JJ = J;
  if (n === 2) JJ = [J[0], J[1], fbRestTarget(J, tipExt)];
  const m = JJ.length;
  const P = [R];
  const segD = [], segL = [];
  for (let i = 0; i + 1 < m; i++) {
    const dx = JJ[i + 1][0] - JJ[i][0], dy = JJ[i + 1][1] - JJ[i][1];
    segL.push(Math.hypot(dx, dy)); segD.push(Math.atan2(dy, dx));
  }
  const L1 = segL[0];
  const L2 = Math.hypot(JJ[m - 1][0] - JJ[1][0], JJ[m - 1][1] - JJ[1][1]);
  let tx = F[0] - R[0], ty = F[1] - R[1], d = Math.hypot(tx, ty);
  const maxD = (L1 + L2) * 0.999, minD = Math.abs(L1 - L2) * 1.001 + 1e-4;
  if (d > maxD) { tx *= maxD / d; ty *= maxD / d; d = maxD; }
  else if (d < minD && d > 1e-6) { tx *= minD / d; ty *= minD / d; d = minD; }
  const T = [R[0] + tx, R[1] + ty];
  const a1 = Math.atan2(ty, tx);
  const cosK = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * Math.max(d, 1e-6))));
  const restCross = (JJ[m - 1][0] - JJ[0][0]) * (JJ[1][1] - JJ[0][1]) - (JJ[m - 1][1] - JJ[0][1]) * (JJ[1][0] - JJ[0][0]);
  const ka = a1 + (restCross >= 0 ? 1 : -1) * Math.acos(cosK);
  const K = [R[0] + Math.cos(ka) * L1, R[1] + Math.sin(ka) * L1];
  P.push(K);
  const rot = Math.atan2(T[1] - K[1], T[0] - K[0]) - Math.atan2(JJ[m - 1][1] - JJ[1][1], JJ[m - 1][0] - JJ[1][0]);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let i = 2; i < m - 1; i++) {
    const vx = JJ[i][0] - JJ[1][0], vy = JJ[i][1] - JJ[1][1];
    P.push([K[0] + vx * cr - vy * sr, K[1] + vx * sr + vy * cr]);
  }
  P.push(T);
  const cumA = new Array(n).fill(0);
  const segDelta = [];
  for (let i = 0; i + 1 < m; i++) segDelta.push(Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]) - segD[i]);
  for (let i = 0; i < n - 1; i++) cumA[i] = segDelta[i];
  cumA[n - 1] = footDelta !== null && footDelta !== undefined ? footDelta : segDelta[m - 2];
  return { P, cumA, tip: T };
}
/** 俯视纵向走廊几何：链根 → 静止脚尖的轴线（单位矢量 + 全长
 * D）。脚尖口径与 fbRestTarget 一致：2 节链用已含延伸的 restT，
 * 3+ 节链沿末段方向续 tipExt。链太短（<2 关节或 D<2）返回 null，
 * 该链退回平面步态。 */
function fbCorridorGeom(rt) {
  const J = rt.J, n = J.length;
  if (n < 2) return null;
  let T;
  if (n === 2) T = rt.restT;
  else {
    const lx = J[n - 1][0] - J[n - 2][0], ly = J[n - 1][1] - J[n - 2][1];
    const ll = Math.hypot(lx, ly) || 1;
    T = [J[n - 1][0] + (lx / ll) * rt.tipExt, J[n - 1][1] + (ly / ll) * rt.tipExt];
  }
  const dx = T[0] - J[0][0], dy = T[1] - J[0][1];
  const D = Math.hypot(dx, dy);
  if (D < 2) return null;
  return { ux: dx / D, uy: dy / D, D };
}
/** 俯视纵向走廊驱动（正面/背面图专用，取代两骨解算）：膝盖朝
 * 画面外（纵深）弯，投影只表现为腿沿自身轴线伸缩——各关节到轴
 * 线的垂距恒等于静止值、沿轴距离按 k = q/D 同比例缩放（望远镜
 * 式伸缩），关节骑在走廊里做一维运动，膝盖从构造上不会左右
 * 弯。g = fbCorridorGeom 的走廊几何，q = 脚尖沿轴距离（由相位
 * 行程给出），B = 身体偏移（侧摆/微伏，全链与根共用）。返回
 * {P, cumA, tip} 与 fbSolveChain 同
 * 形状：各节角度由相邻关节实际位置导出，末节（脚）跟随末段方
 * 向（与小腿的静止相对角不变）。 */
function fbCorridorChain(J, tipExt, g, q, B) {
  const n = J.length;
  const R0 = J[0];
  if (n < 2 || !g) return { P: J.map((p) => [p[0] + B[0], p[1] + B[1]]), cumA: new Array(n).fill(0), tip: [R0[0] + B[0], R0[1] + B[1]] };
  const k = q / g.D;
  const P = [];
  for (let i = 0; i < n; i++) {
    const vx = J[i][0] - R0[0], vy = J[i][1] - R0[1];
    const t = vx * g.ux + vy * g.uy;               // 沿轴静止距离
    const px = vx - t * g.ux, py = vy - t * g.uy;  // 静止垂距向量（恒定）
    P.push([R0[0] + B[0] + t * k * g.ux + px, R0[1] + B[1] + t * k * g.uy + py]);
  }
  const tip = [R0[0] + B[0] + q * g.ux, R0[1] + B[1] + q * g.uy];
  // 角度导出：点列 [...关节, 脚尖] 与静止点列逐段比方向
  const RR = [...J];
  if (n === 2) RR.push(fbRestTarget(J, tipExt));
  else {
    const lx = J[n - 1][0] - J[n - 2][0], ly = J[n - 1][1] - J[n - 2][1];
    const ll = Math.hypot(lx, ly) || 1;
    RR.push([J[n - 1][0] + (lx / ll) * tipExt, J[n - 1][1] + (ly / ll) * tipExt]);
  }
  const PP = [...P, tip];
  const cumA = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    cumA[i] = Math.atan2(PP[i + 1][1] - PP[i][1], PP[i + 1][0] - PP[i][0])
            - Math.atan2(RR[i + 1][1] - RR[i][1], RR[i + 1][0] - RR[i][0]);
  }
  return { P, cumA, tip };
}
/** 解算结果回写 pose：与模拟遍/旧兜底同口径——先按当前条目测
 * 中心 refC，再叠角、复算中心、把中心按权重 w 补差到目标位。 */
function fbWriteChain(pose, keys, solved, w) {
  const { P, cumA } = solved;
  for (let i = 0; i < keys.length; i++) {
    const part = PART_BY_KEY.get(keys[i]);
    const prm = part ? fbParamsOf(part) : null;
    if (!prm) continue;
    const e = pose[keys[i]] || (pose[keys[i]] = { a: 0, dy: 0, rim: 0, glint: 0 });
    const refC = partCenter(prm, { a: (e.a || 0) + (prm.restRot || 0), dx: e.dx || 0, dy: e.dy || 0 });
    e.a = (e.a || 0) + cumA[i] * w;
    const c1 = partCenter(prm, { a: (e.a || 0) + (prm.restRot || 0), dx: e.dx || 0, dy: e.dy || 0 });
    const bx = refC[0] + (char.x + P[i][0] - refC[0]) * w;
    const by = refC[1] + (charOriginY() + P[i][1] - refC[1]) * w;
    e.dx = (e.dx || 0) + (bx - c1[0]);
    e.dy = (e.dy || 0) + (by - c1[1]);
  }
}
/** 横版脚段角度进程（脚跟落 → 全掌 → 脚尖蹬离 / 摆动收脚尖）：
 * f = 朝向符号（本地 +x 为正向时 +1），u = 链内周期相位。 */
function fbFootPitch(u, f) {
  if (u < FB_STANCE) {
    if (u < 0.15) return f * 0.14 * (1 - u / 0.15);            // 落地：脚尖略抬、渐落平
    if (u > 0.45) return -f * 0.30 * ((u - 0.45) / 0.15);      // 蹬离：脚跟抬起、脚尖压地
    return 0;                                                   // 全掌支撑
  }
  const s = (u - FB_STANCE) / (1 - FB_STANCE);
  return f * 0.12 * Math.sin(Math.PI * Math.min(1, s * 1.15)); // 摆动：收脚尖防绊、落前回平
}
function buildFallback() {
  const skel = new Map();
  for (const s of EMBEDDED.skeleton || []) skel.set(s.key, s);
  const nameOf = (key) => (skel.get(key) || {}).name || key;
  const parentOf = (key) => { const s = skel.get(key); return s ? s.parent : null; };
  const isLeg = (key) => { const nm = nameOf(key); return FB_LEG_NAME.test(nm) && !FB_NOT_LEG.test(nm); };
  // 静止关节（角色空间，根朝向口径）：识别校验与相位分组只读这一份；
  // 逐帧回写时按当前 variant 重取（镜像朝向参数不同），不复用此表。
  const restJ = new Map();
  for (const part of PARTS) {
    const prm = fbParamsOf(part);
    if (prm) restJ.set(part.key, fbJointOf(prm));
  }
  const legKeys = PARTS.map((p) => p.key).filter((k) => restJ.has(k) && isLeg(k));
  const legSet = new Set(legKeys);
  const legChildren = new Map();
  for (const k of legKeys) {
    const par = parentOf(k);
    if (par && legSet.has(par)) {
      if (!legChildren.has(par)) legChildren.set(par, []);
      legChildren.get(par).push(k);
    }
  }
  const allChains = [];
  for (const k of legKeys) {
    const par = parentOf(k);
    if (par && legSet.has(par)) continue; // 非链根
    const keys = [k];
    let cur = k;
    for (;;) {
      const kids = (legChildren.get(cur) || []).filter((c) => !keys.includes(c));
      if (!kids.length) break;
      kids.sort((a, b) => {
        const ja = restJ.get(a), jb = restJ.get(b), jc = restJ.get(cur);
        return Math.hypot(jb[0] - jc[0], jb[1] - jc[1]) - Math.hypot(ja[0] - jc[0], ja[1] - jc[1]);
      });
      cur = kids[0]; keys.push(cur);
    }
    let segLen = 0;
    for (let i = 0; i + 1 < keys.length; i++) segLen += Math.hypot(restJ.get(keys[i + 1])[0] - restJ.get(keys[i])[0], restJ.get(keys[i + 1])[1] - restJ.get(keys[i])[1]);
    const len = segLen + fbTipExtent(PART_BY_KEY.get(keys[keys.length - 1]));
    if (len < 8 || len > 500) continue;
    // 腿链须朝下长：链尖关节明显低于链根（运行时 y 向上，根−尖为
    // 正；单节链 segLen=0 恒过）。锚在链自身几何、不用父关节高
    // 低——父部件的静止关节位是其自身插头位（如骨盆部件 pivot
    // 在骨盆图中间一带），不是髋关节窝，腿根略高于它属正常骨
    // 骼，拿它当基准会把同挂骨盆的正经双腿双双误杀。
    if (restJ.get(k)[1] - restJ.get(keys[keys.length - 1])[1] < 0.25 * segLen) continue;
    allChains.push({ keys, len, phase: 0 });
  }
  // 配相位：全部腿链同属一步态组——配对不要求同父（真实人形
  // 骨骼双腿常分挂左右髋骨 hip_L/hip_R，同父成组会把分髋双腿
  // 各自落单丢弃、误报未识别）。两条按左右对位反相、四条及
  // 以上按对角（前 XOR 左），规则与原同父组内一致。
  const walkChains = [];
  if (allChains.length >= 2) {
    const g = [...allChains].sort((a, b) => restJ.get(a.keys[0])[0] - restJ.get(b.keys[0])[0]);
    const cx = g.reduce((s, c) => s + restJ.get(c.keys[0])[0], 0) / g.length;
    g.forEach((c, i) => {
      const nm = nameOf(c.keys[0]).toLowerCase();
      const leftBit = /_l$|_left|left|左/.test(nm) ? 0 : /_r$|_right|right|右/.test(nm) ? 1 : (i % 2);
      if (g.length === 2) c.phase = Math.PI * i; // 两足：按序直接对位反相
      else c.phase = Math.PI * (((restJ.get(c.keys[0])[0] < cx ? 1 : 0) + leftBit) % 2);
      walkChains.push(c);
    });
  }
  const legRole = new Map();
  for (const c of allChains) c.keys.forEach((k, d) => legRole.set(k, { depth: d, n: c.keys.length }));
  const perfHay = (p) => ((p.trigger || '') + ' ' + (p.name || '') + ' ' + (p.id || '')).toLowerCase();
  const walkPerf = PERFORMANCES.some((p) => /walk|run|move|行走|走路|奔跑|跑步|步行|移动/.test(perfHay(p)));
  const jumpPerf = PERFORMANCES.some((p) => /jump|跳|蹦/.test(perfHay(p)));
  const legGraphDriven = legKeys.some((k) => !!BEHAVIOR_GRAPHS[k]);
  const lens = (walkChains.length ? walkChains : allChains).map((c) => c.len);
  const fb = {
    chains: walkChains,
    legRole,
    legLen: lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 24,
    walkOk: walkChains.length >= 2 && !walkPerf && !legGraphDriven,
    jumpOk: walkChains.length >= 2 && !jumpPerf && !legGraphDriven,
  };
  if (walkChains.length < 2) {
    const msg = '播放器兜底动作：未识别到成对的腿部骨骼（按骨骼名/父子链匹配失败），行走/跳跃兜底均不生效';
    console.warn(msg);
    const wEl = document.getElementById('warn');
    if (wEl) wEl.textContent = (wEl.textContent ? wEl.textContent + '\\n' : '') + msg;
  }
  return fb;
}
function ensureFB() { if (!FB) FB = buildFallback(); return FB; }
/** 跳跃统一请求：兜底开启时先进入下蹲倒计时（updateCharacterSide
 * 里倒完才给初速），否则与旧行为一致立即起跳 */
function requestJump() {
  if (moveMode !== 'side' || !char.onGround || char.ledge) return;
  if (ensureFB().jumpOk) { if (fbCrouchT <= 0) fbCrouchT = FB_CROUCH_DUR; }
  else { char.vy = PHYS.jumpV; char.onGround = false; }
}
/** 兜底遍（表演合成后、模拟遍前）：脚目标驱动——跳跃四段、横版
 * 行走支撑/摆动分段、俯视平面步态，统一走两骨解算回写 pose */
function runFallbackPass(pose, dt) {
  const fb = ensureFB();
  if (fbPrevX === null) { fbPrevX = char.x; fbPrevPY = char.py; }
  const dxF = char.x - fbPrevX, dyF = char.py - fbPrevPY;
  fbPrevX = char.x; fbPrevPY = char.py;
  const side = moveMode === 'side';
  // —— 各链当帧静止几何（当前 variant 口径，本地）：关节列 J、末节
  // 脚底延伸 tipExt、静止目标点 restT（踝/接触点）、有效段长和 ——
  const chainRT = [];
  if (fb.walkOk || fb.jumpOk) {
    for (const chain of fb.chains) {
      const J = [];
      let ok = true;
      for (const k of chain.keys) {
        const part = PART_BY_KEY.get(k);
        const prm = part ? fbParamsOf(part) : null;
        if (!prm) { ok = false; break; }
        J.push(fbJointOf(prm));
      }
      if (!ok) { chainRT.push(null); continue; }
      const tipExt = fbTipExtent(PART_BY_KEY.get(chain.keys[chain.keys.length - 1]));
      chainRT.push({ J, tipExt, restT: fbRestTarget(J, tipExt), segSum: fbSegSumEff(J, tipExt) });
    }
  }
  const tipPrevOf = (ci) => fbTipPrev.get(ci) || chainRT[ci].restT;
  // ================= 横版：跳跃阶段机 =================
  let bodyOff = 0;      // 本帧身体纵向偏移（负 = 下沉，正 = 蹬伸过冲；根与非腿部件共用）
  let jumpW = false;    // 本帧腿链由跳跃段拥有（权重 1）
  if (side && fb.jumpOk) {
    if (!char.onGround && !char.ledge) fbAirTime += dt; else if (fbStage !== 'air') fbAirTime = 0;
    // 进下蹲：物理侧刚置倒计时（requestJump / 按住跳）且当前不在下蹲段
    if (fbCrouchT > 0 && fbStage !== 'crouch') {
      fbStage = 'crouch'; fbStageT = 0;
      fb.chains.forEach((chain, ci) => {
        if (!chainRT[ci]) return;
        fbPlants.set(ci, char.x + tipPrevOf(ci)[0]); // 脚钉在当前世界位
        fbSegPrev.set(ci, 0);
      });
    }
    if (fbStage === 'crouch') {
      if (fbCrouchT <= 0) {
        if (!char.onGround && char.vy > 0) {
          // 离地：进滞空，脚目标从离地位连续接管、过冲量带入衰减
          fbStage = 'air'; fbStageT = 0; fbAirRootFrom = Math.max(0, bodyOff);
          fb.chains.forEach((chain, ci) => {
            if (!chainRT[ci]) return;
            fbAirCur.set(ci, [...tipPrevOf(ci)]);
          });
        } else fbStage = 'none'; // 下蹲中走下台阶被物理取消等
      }
    } else if (fbStage === 'air') {
      fbStageT += dt;
      if (char.onGround) {
        fbStage = 'absorb'; fbStageT = 0;
        fb.chains.forEach((chain, ci) => {
          if (!chainRT[ci]) return;
          fbPlants.set(ci, char.x + tipPrevOf(ci)[0]); // 脚钉在落点
          fbSegPrev.set(ci, 0);
        });
      }
    } else if (fbStage === 'absorb') {
      fbStageT += dt;
      if (fbStageT >= 0.18) { fbStage = 'none'; fbStageT = 0; }
    }
    // 坠落落地（未走跳跃序，如走下台阶跌落）：同样给一次吸收
    if (fbStage === 'none' && char.onGround && fbAirTime > 0.05) {
      fbStage = 'absorb'; fbStageT = 0; fbAirTime = 0;
      fb.chains.forEach((chain, ci) => {
        if (!chainRT[ci]) return;
        fbPlants.set(ci, char.x + chainRT[ci].restT[0]); // 脚在身体正下方的静止位落点
        fbSegPrev.set(ci, 0);
      });
    }
    if (fbStage === 'crouch') {
      // u：预备总进度；<FB_EXT_U 下蹲（缓出压满旧深度公式），其后蹬伸（缓入冲过静止高）
      const u = Math.max(0, Math.min(1, 1 - fbCrouchT / FB_CROUCH_DUR));
      const dipM = fbDipMax();
      if (u < FB_EXT_U) { const q = u / FB_EXT_U; bodyOff = -dipM * (1 - (1 - q) * (1 - q)); }
      else {
        const q = (u - FB_EXT_U) / (1 - FB_EXT_U);
        let over = Math.max(1.5, Math.min(4, dipM * 0.45));
        // 过冲不得把腿拉出可达域（静止近直腿的角色余量小）：按各链
        // 几何钳——根升 over 后根→目标距须 ≤ 两骨全伸长的 0.999
        fb.chains.forEach((chain, ci) => {
          const rt = chainRT[ci]; if (!rt) return;
          const J = rt.J, n = J.length;
          const Fx = (fbPlants.has(ci) ? fbPlants.get(ci) : char.x + rt.restT[0]) - char.x;
          const hx = Fx - J[0][0], drop = J[0][1] - rt.restT[1];
          let maxD;
          if (n === 2) maxD = rt.segSum * 0.999;
          else {
            const L1 = Math.hypot(J[1][0] - J[0][0], J[1][1] - J[0][1]);
            const L2 = Math.hypot(J[n - 1][0] - J[1][0], J[n - 1][1] - J[1][1]);
            maxD = (L1 + L2) * 0.999;
          }
          const room = Math.sqrt(Math.max(0, maxD * maxD - hx * hx)) - drop;
          if (room < over) over = Math.max(0, room);
        });
        bodyOff = -dipM + (dipM + over) * q * q;
      }
      jumpW = true;
    } else if (fbStage === 'air') {
      bodyOff = fbAirRootFrom * Math.max(0, 1 - fbStageT / 0.08); // 过冲在滞空初期衰减
      jumpW = true;
    } else if (fbStage === 'absorb') {
      const dipA = fbDipMax() * 0.6;
      if (fbStageT < 0.06) { const q = fbStageT / 0.06; bodyOff = -dipA * (1 - (1 - q) * (1 - q)); }
      else { const q = Math.max(0, Math.min(1, (fbStageT - 0.06) / 0.12)); bodyOff = -dipA * (1 - q * q * (3 - 2 * q)); }
      jumpW = true;
    }
  } else if (!side) { fbStage = 'none'; fbAirTime = 0; }
  // ================= 横版：腿链目标与解算 =================
  if (side && (fb.walkOk || fb.jumpOk)) {
    const movingSide = char.onGround && Math.abs(dxF) > 1e-6 && fbStage === 'none';
    fbWalkW += ((fb.walkOk && movingSide ? 1 : 0) - fbWalkW) * Math.min(1, dt / 0.12);
    // 步长：公式值与「几何可达」取小——直腿角色步子迈不开时缩步
    // 提频（支撑行程 = 0.6·周期距离，须 ≤ 链在下沉预算内的可达横距；
    // 距与下沉都以目标点（踝/接触点）与有效段长量）
    let stride = Math.max(10, 2 * fb.legLen * Math.sin(FB_SWING));
    for (const rt of chainRT) {
      if (!rt || rt.segSum < 1e-6) continue;
      const drop = rt.J[0][1] - rt.restT[1];
      const budget = Math.max(2, Math.min(8, rt.segSum * 0.08));
      const hCap = Math.sqrt(Math.max(9, rt.segSum * rt.segSum - Math.pow(Math.max(0, drop - budget), 2)));
      stride = Math.min(stride, Math.max(10, hCap / 0.6));
    }
    const cycDist = 2 * stride;              // 一个步态周期（相位 2π）的行进距离
    const frontReach = 0.3 * cycDist;        // 落脚点在链根前方的横距（沿朝向，见下）
    const lift = Math.max(2, Math.min(8, cycDist * 0.12)); // 摆动段脚尖抬高峰值
    // 步态在朝向空间定义：faceF = 当前 variant 本地帧里「前方」的 x
    // 符号（镜像朝向 5..7 本地前方为 −x）。相位按沿朝向的行进量
    // dxF·faceF 推进、摆动落点取链根 + faceF·frontReach——左右行走
    // 互为镜像、周期顺序一致（支撑后扫、摆动前送）；若按带符号世界
    // 位移推进，左行时 u 逆行且落点落到行进后方（曾实测只有右行对）。
    const faceF = (char.variant >= 5 && char.variant <= 7) ? -1 : 1;
    if (fbStage === 'none' && fb.walkOk && char.onGround && !char.ledge) fbPhase += Math.PI * dxF * faceF / stride;
    let sink = 0; // 支撑几何反推的身体下沉（行走时）
    const solvedList = [];
    fb.chains.forEach((chain, ci) => {
      const rt = chainRT[ci];
      if (!rt) { solvedList.push(null); return; }
      const { J, restT } = rt;
      const n = J.length;
      let F = null, footDelta = null, w = 0;
      if (jumpW) {
        w = 1;
        if (fbStage === 'air') {
          // 滞空：上升收脚（目标点向身体收拢上提）、下落伸腿（近全伸
          // 下探），目标逐帧趋近防跳变
          const rel = [restT[0] - J[0][0], restT[1] - J[0][1]];
          const want = char.vy > -20
            ? [J[0][0] + rel[0] * 0.55, J[0][1] + rel[1] * 0.55 + rt.segSum * 0.20]
            : [J[0][0] + rel[0] * 0.90, J[0][1] + rel[1] * 1.02];
          const cur = fbAirCur.get(ci) || [...restT];
          const kk = Math.min(1, dt / 0.09);
          cur[0] += (want[0] - cur[0]) * kk; cur[1] += (want[1] - cur[1]) * kk;
          fbAirCur.set(ci, cur);
          F = [...cur];
          footDelta = null; // 脚跟随末段
        } else {
          // 下蹲 / 蹬伸 / 吸收：脚钉在记录的世界位，本地目标随身体移动反算
          if (!fbPlants.has(ci)) fbPlants.set(ci, char.x + restT[0]);
          F = [fbPlants.get(ci) - char.x, restT[1]];
          footDelta = n >= 3 ? 0 : null; // 3+ 节脚掌平贴；2 节脚跟随接触段
        }
      } else if (fbWalkW > 0.003) {
        w = fbWalkW;
        let u = ((fbPhase + chain.phase) / (2 * Math.PI)) % 1;
        if (u < 0) u += 1;
        const seg = u < FB_STANCE ? 0 : 1;
        if (seg === 0) {
          if (fbSegPrev.get(ci) !== 0 || !fbPlants.has(ci)) fbPlants.set(ci, char.x + tipPrevOf(ci)[0]); // 就地落脚
          F = [fbPlants.get(ci) - char.x, restT[1]];
          // 几何下沉：脚钉地且腿长固定 → 脚横移越远、根须越低
          if (rt.segSum > 1e-6) {
            const horiz = Math.min(Math.abs(F[0] - J[0][0]), rt.segSum * 0.95);
            const dropNeed = (J[0][1] - restT[1]) - Math.sqrt(Math.max(rt.segSum * rt.segSum - horiz * horiz, Math.pow(rt.segSum * 0.3, 2)));
            if (dropNeed > sink) sink = dropNeed;
          }
        } else {
          if (fbSegPrev.get(ci) !== 1 || !fbSwingFrom.has(ci)) fbSwingFrom.set(ci, [...tipPrevOf(ci)]);
          const from = fbSwingFrom.get(ci);
          const s = (u - FB_STANCE) / (1 - FB_STANCE);
          const sm = s * s * (3 - 2 * s);
          F = [from[0] + (J[0][0] + faceF * frontReach - from[0]) * sm, restT[1] + lift * 4 * s * (1 - s)];
        }
        fbSegPrev.set(ci, seg);
        footDelta = n >= 3 ? fbFootPitch(u, faceF) : null;
        solvedList.push({ chain, rt, F, footDelta, w, walk: true });
        return;
      }
      if (F) solvedList.push({ chain, rt, F, footDelta, w, walk: false });
      else solvedList.push(null);
    });
    // 身体偏移落笔：跳跃段用 bodyOff；行走用几何 sink（×权重）——
    // 非腿部件 dy 叠加；腿链根偏移在解算时注入（同一数值）
    const bodyNow = jumpW ? bodyOff : -Math.min(12, Math.max(0, sink)) * fbWalkW;
    if (Math.abs(bodyNow) > 0.01 && (jumpW || fbWalkW > 0.003)) {
      for (const part of PARTS) {
        if (fb.legRole.has(part.key)) continue;
        const e = pose[part.key] || (pose[part.key] = { a: 0, dy: 0, rim: 0, glint: 0 });
        e.dy = (e.dy || 0) + bodyNow;
      }
    }
    for (const s of solvedList) {
      if (!s) continue;
      const solved = fbSolveChain(s.rt.J, s.rt.tipExt, s.walk ? bodyNow : bodyOff, s.F, s.footDelta);
      fbWriteChain(pose, s.chain.keys, solved, s.w);
      fbTipPrev.set(fb.chains.indexOf(s.chain), solved.tip);
    }
  }
  // ================= 俯视步态：横向平面步态 / 纵向走廊驱动 =================
  // 横向占优（出侧面图）：平面脚目标步态（脚目标 + 两骨解算），
  // 追加六定版逐字沿用（stride 段与平面落点/钉点均未改）。
  // 纵向占优（出正面/背面图）：膝盖朝画面外（纵深）弯，平面内解
  // 算只能让膝盖在画面内左右弹（青蛙式撇膝）——改走廊驱动：解
  // 算退场，各关节骑在「链根→静止脚尖」轴线上做一维伸缩（见
  // fbCorridorChain，垂距恒定、沿轴望远镜式缩放）。
  // 俯视步幅（用户裁定）：每步行进距离 = 腿长·sin(FB_SWING)
  // （侧视步长之半，用户角色 ≈44、周期 ≈88），各链可达钳制仍作
  // 上限取小。纵向移动速度亦为横向之半（updateCharacterTop 内
  // vy ×0.5），步幅半、速度半 → 纵向一个周期的时间与侧视一致。
  // 走廊行程改每步锚定（撤销 A = 0.03·D、收脚 0.04·D 的独立行
  // 程参数）：支撑段开步把脚锚在世界平面点、每帧取锚点的沿轴
  // 坐标，行程由锚定与步频自然决定；摆动预落点 = D + σ·半扫
  // 程，半扫程 = 0.3·cycTop·|cos(轴向, 行进方向)|（当帧真实几
  // 何的投影、非常数），中途收脚取扫程的 0.35 倍（派生份额）。
  // 步频全俯视共用一个口径：fbPhase 只按横向平面步态的周期距离
  // cycTop 推进（纵向走廊同速率，纵横混合期间亦然），不另设纵向
  // 周期距离——纵向曾自带 cycVert（按投影系数 κ=0.16 单独对齐、
  // 约 3.9 步/秒），与横向步频不一致，已撤销。
  // 主导轴切换：fbTopVertW 平滑过渡、两套解算结果按权重混合，
  // fbPhase 共用同一速率推进、从不重置。
  const movingTop = !side && (Math.abs(dxF) + Math.abs(dyF)) > 1e-6;
  fbTopW += ((fb.walkOk && movingTop ? 1 : 0) - fbTopW) * Math.min(1, dt / 0.12);
  if (!side && fb.walkOk && fbTopW > 0.003) {
    const dist = Math.hypot(dxF, dyF);
    if (dist > 1e-4) {
      const ix = dxF / dist, iy = dyF / dist;
      let nx = fbTopDir[0] * 0.6 + ix * 0.4, ny = fbTopDir[1] * 0.6 + iy * 0.4;
      const nl = Math.hypot(nx, ny) || 1;
      fbTopDir = [nx / nl, ny / nl];
    }
    // 步长（用户裁定 步幅 44）：公式步长 腿长·sin(FB_SWING)（侧视
    // 2·腿长·sin(FB_SWING) 之半），再按各链平面可达扫掠取小（全
    // 链共用最严的一条、步频一致，钳制只作上限不放大）：脚的扫掠线是过
    // 脚家位、沿行进方向的直线，链根到该线的垂直距离为 perp，支撑
    // 行程半程不得超过弦长 sqrt((0.98·段长和)² − perp²)（与侧视
    // hCap 同构：支撑脚钉住时根→脚距在行程两端最大）。旧口径
    // amp = 腿长×0.14（≤7px）是正弦时代的摆幅残留：周期距离只剩
    // 23px 上下、脚以 6 次/秒在链根旁碎步，且摆动落点取「链根 +
    // 方向·amp」——离链根仅数像素而腿长数十像素，解算只能把腿折
    // 成死结（实测 cumA 达 4~5 rad），落脚记录再把死结脚尖喂给支
    // 撑段，整腿塌在髋旁出不来（画面实测北向数帧内腿团消失）。
    let stride = Math.max(10, fb.legLen * Math.sin(FB_SWING));
    for (const rt of chainRT) {
      if (!rt || rt.segSum < 1e-6) continue;
      const relX = rt.restT[0] - rt.J[0][0], relY = rt.restT[1] - rt.J[0][1];
      const perp = Math.abs(relX * fbTopDir[1] - relY * fbTopDir[0]);
      const reach = 0.98 * rt.segSum;
      const half = Math.sqrt(Math.max(0, reach * reach - perp * perp));
      stride = Math.min(stride, Math.max(10, (2 * half) / FB_STANCE));
    }
    const cycTop = 2 * stride;                  // 周期距离（相位 2π 的行进距离）
    const stanceTravel = FB_STANCE * cycTop;    // 支撑行程：脚相对身体的后扫全程
    // —— 纵向走廊口径：各链走廊几何 ——
    const corGeoms = chainRT.map((rt) => (rt ? fbCorridorGeom(rt) : null));
    let dCnt = 0;
    for (const g of corGeoms) if (g) dCnt++;
    const vertNow = dCnt > 0 && Math.abs(fbTopDir[1]) >= Math.abs(fbTopDir[0]) ? 1 : 0;
    fbTopVertW += (vertNow - fbTopVertW) * Math.min(1, dt / 0.09);
    if (fbTopVertW > 0.98) { fbTopPlants.clear(); fbSwingFrom.clear(); } // 全纵向期间平面落点状态作废，回横向时就地重落脚
    if (fbTopVertW < 0.02) { fbCorPlants.clear(); fbCorSegPrev.clear(); } // 全横向期间走廊锚定状态作废，回纵向时就地重锚
    fbPhase += 2 * Math.PI * dist / cycTop;
    // 各链当帧相位/段（两套驱动共用）
    const us = [], segs = [];
    fb.chains.forEach((chain, ci) => {
      let u = ((fbPhase + chain.phase) / (2 * Math.PI)) % 1;
      if (u < 0) u += 1;
      us.push(u); segs.push(u < FB_STANCE ? 0 : 1);
    });
    // 身体侧摆/微伏（仅走廊模式）：侧摆朝支撑侧——各链根相对链根
    // 质心的横向（垂直行进方向）坐标按支撑 +1 / 摆动 −1 加权平均
    // 得侧倾 m∈[−1,1]，幅 1.5px；微伏一周期两下、幅 0.8px。偏移
    // B 全链共用并同值注入非腿部件（与侧视 bodyNow 同法）。
    let B = [0, 0];
    if (fbTopVertW > 0.003) {
      const latX = -fbTopDir[1], latY = fbTopDir[0];
      let cx = 0, cy = 0, cn = 0;
      fb.chains.forEach((chain, ci) => { const rt = chainRT[ci]; if (rt) { cx += rt.J[0][0]; cy += rt.J[0][1]; cn++; } });
      if (cn) { cx /= cn; cy /= cn; }
      let num = 0, den = 0;
      fb.chains.forEach((chain, ci) => {
        const rt = chainRT[ci]; if (!rt) return;
        const li = (rt.J[0][0] - cx) * latX + (rt.J[0][1] - cy) * latY;
        den += Math.abs(li);
        num += (segs[ci] === 0 ? 1 : -1) * li;
      });
      const m = den > 1e-6 ? num / den : 0;
      const wV = fbTopVertW;
      B = [latX * 1.5 * m * wV, latY * 1.5 * m * wV - 0.8 * (0.5 - 0.5 * Math.cos(2 * fbPhase)) * wV];
      if (Math.abs(B[0]) > 0.01 || Math.abs(B[1]) > 0.01) {
        for (const part of PARTS) {
          if (fb.legRole.has(part.key)) continue;
          const e = pose[part.key] || (pose[part.key] = { a: 0, dy: 0, rim: 0, glint: 0 });
          e.dx = (e.dx || 0) + B[0] * fbTopW;
          e.dy = (e.dy || 0) + B[1] * fbTopW;
        }
      }
    }
    fb.chains.forEach((chain, ci) => {
      const rt = chainRT[ci];
      if (!rt) return;
      const { J, restT } = rt;
      const u = us[ci];
      const seg = segs[ci];
      let solved = null;
      if (fbTopVertW < 0.999) {
        let F;
        if (seg === 0) {
          if (fbSegPrev.get(ci) !== 0 || !fbTopPlants.has(ci)) {
            const tp = tipPrevOf(ci);
            fbTopPlants.set(ci, [char.x + tp[0], charOriginY() + tp[1]]); // 就地落脚（世界平面位）
          }
          const p = fbTopPlants.get(ci);
          F = [p[0] - char.x, p[1] - charOriginY()];
        } else {
          if (fbSegPrev.get(ci) !== 1 || !fbSwingFrom.has(ci)) fbSwingFrom.set(ci, [...tipPrevOf(ci)]);
          const from = fbSwingFrom.get(ci);
          const s = (u - FB_STANCE) / (1 - FB_STANCE);
          const sm = s * s * (3 - 2 * s);
          // 摆动终点在脚家位沿行进方向前移半个支撑行程处：扫掠窗以
          // 「过家位、沿行进方向的直线」为轴（链根在该轴上的投影为
          // 窗心，与侧视窗以链根横坐标为心、落在 家位高度线上同构），
          // 脚全程围绕自己的家位前后扫，不再被拽向链根。
          const endX = restT[0] + fbTopDir[0] * (stanceTravel / 2), endY = restT[1] + fbTopDir[1] * (stanceTravel / 2);
          // 外弧方向：家位相对链根的横向分量（脚绕身体外侧回摆，不
          // 穿身体中心）；横向分量近零（脚在行进轴上）时退化为行进
          // 方向的垂直方向。
          let px = (restT[0] - J[0][0]) - ((restT[0] - J[0][0]) * fbTopDir[0] + (restT[1] - J[0][1]) * fbTopDir[1]) * fbTopDir[0];
          let py = (restT[1] - J[0][1]) - ((restT[0] - J[0][0]) * fbTopDir[0] + (restT[1] - J[0][1]) * fbTopDir[1]) * fbTopDir[1];
          const pl = Math.hypot(px, py);
          if (pl > 1e-6) { px /= pl; py /= pl; } else { px = -fbTopDir[1]; py = fbTopDir[0]; }
          const bow = stanceTravel * 0.18 * Math.sin(Math.PI * s);
          F = [from[0] + (endX - from[0]) * sm + px * bow,
               from[1] + (endY - from[1]) * sm + py * bow];
        }
        fbSegPrev.set(ci, seg);
        solved = fbSolveChain(J, rt.tipExt, 0, F, null);
      }
      if (fbTopVertW > 0.001 && corGeoms[ci]) {
        // 走廊每步锚定：支撑段开步时把脚锚在世界平面点（走廊专
        // 用表 fbCorPlants），每帧的沿轴坐标 q 取锚点在身体系位
        // 的沿轴分量——身体越过锚点时 q 单调扫过，行程由锚定与
        // 步频（共用 cycTop）自然决定，不设独立行程参数（旧
        // A = 0.03·D / 收脚 0.04·D 参数已撤销）。摆动段从旧锚坐
        // 标平滑过渡到预落点：预落沿轴坐标 = D + σ·半扫程（σ =
        // 行进方向在轴向上的投影符号，脚落在来向一侧、支撑段向
        // 另一侧扫过 D），半扫程 = 0.3·cycTop·|cos(轴向, 行进
        // 方向)|——0.3·cycTop 即半个支撑行程，投影取自当帧真实
        // 几何（轴向与平滑行进方向的夹角）；中途收脚（沿轴距离
        // 缩短 = 纵深屈膝的投影）取扫程的 0.35 倍（派生份额）。
        const g = corGeoms[ci];
        const dot = fbTopDir[0] * g.ux + fbTopDir[1] * g.uy;
        const sigma = dot < -0.05 ? -1 : 1;
        const halfSweep = 0.3 * cycTop * Math.abs(dot);
        const corPrev = fbCorSegPrev.get(ci);
        const anchorQ = () => {
          const p = fbCorPlants.get(ci);
          return (p[0] - char.x - J[0][0]) * g.ux + (p[1] - charOriginY() - J[0][1]) * g.uy;
        };
        let q;
        if (seg === 0) {
          if (corPrev !== 0 || !fbCorPlants.has(ci)) {
            const tp = tipPrevOf(ci);
            fbCorPlants.set(ci, [char.x + tp[0], charOriginY() + tp[1]]); // 就地锚定（世界平面位）
          }
          q = anchorQ();
        } else {
          if (corPrev !== 1 || !fbCorPlants.has(ci)) {
            const tp = tipPrevOf(ci);
            fbCorPlants.set(ci, [char.x + tp[0], charOriginY() + tp[1]]); // 无锚可依（走廊中途接合等）→ 就地锚定取当前坐标
          }
          const s = (u - FB_STANCE) / (1 - FB_STANCE);
          const sm = s * s * (3 - 2 * s);
          const qFrom = anchorQ();
          const qLand = g.D + sigma * halfSweep;
          q = qFrom + (qLand - qFrom) * sm - 0.35 * (2 * halfSweep) * Math.sin(Math.PI * s);
        }
        fbCorSegPrev.set(ci, seg);
        const cs = fbCorridorChain(J, rt.tipExt, g, q, B);
        if (solved) {
          const wV = fbTopVertW;
          solved = {
            P: cs.P.map((cp, i) => [solved.P[i][0] + (cp[0] - solved.P[i][0]) * wV, solved.P[i][1] + (cp[1] - solved.P[i][1]) * wV]),
            cumA: cs.cumA.map((ca, i) => solved.cumA[i] + (ca - solved.cumA[i]) * wV),
            tip: [solved.tip[0] + (cs.tip[0] - solved.tip[0]) * wV, solved.tip[1] + (cs.tip[1] - solved.tip[1]) * wV],
          };
        } else solved = cs;
      }
      if (solved) {
        fbWriteChain(pose, chain.keys, solved, fbTopW);
        fbTipPrev.set(ci, solved.tip);
      }
    });
  }
}
// ---- 钳制锚定（运行时，PR #55 裁决 3/5）：部件精灵上名为 anchor 的
// 点标记自动成为锚点（约定、UI 无感）；逐帧在表演求值后对全部场景
// 固体求值：侧视贴顶面冻结、俯视进区域冻结，锚点全位置不滑动，
// 整角色反向横移由 Δ 回写物理体承担（着地/抓边从回写后位置判定）。
// 硬优先级：部件序最靠前的生效锚独占 Δ。状态键 = 部件 key。
const anchorState = new Map();
function anchorPointWorld(a) {
  const c = Math.cos(a.rot), s = Math.sin(a.rot);
  const gx = a.local[0] * a.dsx, gy = a.local[1] * a.dsy;
  return [a.ctr[0] + gx * c + gy * s, a.ctr[1] + gx * s - gy * c];
}
function runAnchorPass(cands, els, anchorsByKey) {
  if (!cands.length) { if (anchorState.size) anchorState.clear(); return; }
  const alive = new Set();
  let delta = null;
  for (const cd of cands) {
    alive.add(cd.key);
    const p = anchorPointWorld(cd);
    let st = anchorState.get(cd.key);
    if (moveMode === 'top') {
      if (st && (p[0] < st.qx - 6 || p[0] > st.qx + st.qw + 6 || p[1] < st.qy - 6 || p[1] > st.qy + st.qh + 6)) { anchorState.delete(cd.key); st = null; }
      if (!st) {
        for (const q of solids) {
          if (p[0] >= q.x && p[0] <= q.x + q.w && p[1] >= q.y && p[1] <= q.y + q.h) {
            st = { x: p[0], y: p[1], qx: q.x, qy: q.y, qw: q.w, qh: q.h };
            anchorState.set(cd.key, st);
            break;
          }
        }
      }
    } else {
      if (st && (p[0] < st.qx - 2 || p[0] > st.qx + st.qw + 2 || p[1] > st.top + 10 || p[1] < st.top - 40)) { anchorState.delete(cd.key); st = null; }
      if (!st) {
        let best = null;
        for (const q of solids) {
          const top = q.y + q.h;
          if (p[0] >= q.x && p[0] <= q.x + q.w && p[1] <= top + 2 && p[1] >= top - 28) {
            if (!best || Math.abs(p[1] - top) < Math.abs(p[1] - best.top)) best = { top: top, qx: q.x, qw: q.w };
          }
        }
        if (best) { st = { x: p[0], y: best.top, top: best.top, qx: best.qx, qw: best.qw }; anchorState.set(cd.key, st); }
      }
    }
    if (st && !delta) {
      const dx = st.x - p[0], dy = st.y - p[1];
      if (dx !== 0 || dy !== 0) delta = [dx, dy];
    }
  }
  for (const k of Array.from(anchorState.keys())) if (!alive.has(k)) anchorState.delete(k);
  if (!delta) return;
  char.x += delta[0];
  if (moveMode === 'top') char.py += delta[1]; else char.y += delta[1];
  for (const el of els) { el.pos[0] += delta[0]; el.pos[1] += delta[1]; }
  for (const rec of anchorsByKey.values()) { rec.ctr[0] += delta[0]; rec.ctr[1] += delta[1]; }
}
function charBoxH() { return -localGround + 8; }
let currentCostume = (EMBEDDED.defaultCostume && COSTUMES[EMBEDDED.defaultCostume])
  ? EMBEDDED.defaultCostume
  : Object.keys(COSTUMES)[0] || '';
/** 逐槽变体覆盖（缺口 6）：片段状态轨在段表演期间写入；图集缓存键含其签名 */
let slotOverrides = {};
function overrideSig() {
  const ks = Object.keys(slotOverrides).sort();
  return ks.map((k) => k + '=' + slotOverrides[k]).join(',');
}
/** 动态模式解析（模板侧）：当前服装集的 __dynamic 优先，缺省用部件自带（默认集解析结果） */
function dynListFor(part) {
  const entry = COSTUMES[currentCostume];
  const map = entry && entry.__dynamic;
  return (map && map[part.key]) || part.dynamic || [];
}
/** 团块/火焰场逐帧栅格（乙8 改造）：按当帧形变现算场（域乘
 * ds、特征自然），颜色过图案级后期，写入槽内尺寸的 RGBA 缓冲
 * （锚点对齐槽位锚点，镜像时水平翻转）。ds 超过槽位上限钳制。 */
function fieldRasterFor(params, kind, tSec, dsx, dsy, mir, slot) {
  const cap = 2;
  const cdx = Math.max(0.05, Math.min(cap, dsx)), cdy = Math.max(0.05, Math.min(cap, dsy));
  const fld = kind === 'blob' ? dynBlobField(params, tSec, cdx, cdy) : dynFlameField(params, tSec, cdx, cdy);
  const buf = new Uint8Array(slot.innerW * slot.innerH * 4);
  if (!fld) return buf;
  const eHex = kind === 'blob' ? params.blobColorEdge : params.flameColorEdge;
  const mHex = kind === 'blob' ? params.blobColorMid : params.flameColorMid;
  const cHex = kind === 'blob' ? params.blobColorCore : params.flameColorCore;
  const segAlpha = kind === 'blob' ? (params.blobAlpha ?? 0.85) : (params.flameAlpha ?? 0.85);
  const offX = slot.slotOx - fld.ox, offY = slot.slotOy - fld.oy;
  for (let cy2 = 0; cy2 < fld.h; cy2++) {
    const ty = cy2 + offY;
    if (ty < 0 || ty >= slot.innerH) continue;
    for (let cx2 = 0; cx2 < fld.w; cx2++) {
      const scx = mir ? fld.w - 1 - cx2 : cx2;
      const hv = fld.heat[cy2 * fld.w + scx];
      if (hv <= 0.003) continue;
      const tx = cx2 + offX;
      if (tx < 0 || tx >= slot.innerW) continue;
      let rgb = dynFieldColorAt(eHex, mHex, cHex, hv);
      if (params.postEnabled && params.postTheme && params.postTheme !== 'none') {
        const hexS = '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
        const mapped = parseHexRt(dynPostColorAt(params, hexS));
        if (mapped) rgb = mapped;
      }
      const o = (ty * slot.innerW + tx) * 4;
      buf[o] = Math.round(rgb[0]); buf[o + 1] = Math.round(rgb[1]); buf[o + 2] = Math.round(rgb[2]);
      buf[o + 3] = Math.round(255 * Math.min(1, hv) * segAlpha);
    }
  }
  return buf;
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
// 粒子形状（Jeff 落地，与编辑器画布同族）：diamond = 四边形转 45°；
// star = 两张错开 45° 的小四边形叠成八角星；line = 沿运动方向拉长。
// (dirX, dirY) 已由调用方变换到世界空间。顶点第二组坐标（衰减口径）
// 保持原四边形坐标，柔边与 dot 一致。
function pushParticleQuadShaped(verts, x, y, size, rgb, alpha, shape, dirX, dirY) {
  if (!shape || shape === 'dot') { pushParticleQuad(verts, x, y, size, rgb, alpha); return; }
  const h = Math.max(0.5, size / 2);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  if (shape === 'diamond' || shape === 'star') {
    const c45 = Math.SQRT1_2;
    const emit = (hh, al) => {
      for (const cn of corners) {
        verts.push(x + (cn[0] - cn[1]) * c45 * hh, y + (cn[0] + cn[1]) * c45 * hh, cn[0], cn[1], rgb[0], rgb[1], rgb[2], al, 1);
      }
    };
    if (shape === 'diamond') { emit(h, alpha); return; }
    pushParticleQuad(verts, x, y, size * 0.78, rgb, alpha * 0.85);
    emit(h * 0.78, alpha * 0.85);
    return;
  }
  if (shape === 'line') {
    const L = h * 1.9, W = h * 0.5;
    const pxv = -dirY, pyv = dirX;
    for (const cn of corners) {
      verts.push(x + dirX * cn[0] * L + pxv * cn[1] * W, y + dirY * cn[0] * L + pyv * cn[1] * W, cn[0], cn[1], rgb[0], rgb[1], rgb[2], alpha, 1);
    }
    return;
  }
  pushParticleQuad(verts, x, y, size, rgb, alpha);
}
let elapsed = 0;
let autoWalk = false;
let foreOn = false; // 透视缩短开关（缺口 7）：默认关，与编辑器缺省一致
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
  const act0 = { perf: perf, t: 0, snapTimer: 0, snaps: [] };
  if (perf.stateFx) {
    act0.fxSnapshot = { costume: currentCostume, overrides: { ...slotOverrides } };
    act0.fxApplied = -1;
  }
  activePerfs.push(act0);
  emitRuntimeEvent('perfstart', { id: perf.id, name: perf.name });
  behaviorEpoch = elapsed;
  phaseAcc = 0;
  behaviorState.clear();
  prevBehaviorOutputs = new Map();
}
/** 停表演：按对象或 id/名/触发名匹配，移除后发 perfend（stopped: true）。
 *  循环表演没有自然结束，只能经此停下；状态机下一帧见表演 inactive 即回落。 */
function restoreFxSnapshot(act) {
  if (!act || !act.fxSnapshot) return;
  currentCostume = act.fxSnapshot.costume;
  slotOverrides = { ...act.fxSnapshot.overrides };
}
function stopPerf(perfOrId) {
  for (let i = activePerfs.length - 1; i >= 0; i--) {
    const p = activePerfs[i].perf;
    if (p === perfOrId || p.id === perfOrId || p.name === perfOrId || p.trigger === perfOrId) {
      restoreFxSnapshot(activePerfs[i]);
      activePerfs.splice(i, 1);
      emitRuntimeEvent('perfend', { id: p.id, name: p.name, stopped: true });
    }
  }
}
function stopAllPerfs() {
  const ids = activePerfs.map((a) => a.perf);
  for (const a of activePerfs) restoreFxSnapshot(a);
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
      requestJump();
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
    if (name === 't' || name === 'phase' || name === 'speed01' || name === 'grounded' || name === 'wall' || name === 'ledge') return false;
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
  if (rebindTarget) {
    e.preventDefault();
    if (e.code === 'Escape') { rebindTarget = null; refreshKeyPanel(); return; }
    if (rebindTarget.kind === 'move') KEYMAP[rebindTarget.act] = e.code;
    else if (rebindTarget.kind === 'perf') {
      rebindTarget.perf.triggerKey = e.code;
      const b = barState.perfBtns[rebindTarget.perf.id];
      if (b) b.textContent = rebindTarget.perf.name + ' (' + String(e.code).replace('Key', '') + ')';
    }
    rebindTarget = null; refreshKeyPanel();
    return;
  }
  keys[e.code] = true;
  const d = parseInt(e.key);
  if (d >= 1 && d <= 8) { char.variant = d - 1; char.lockedVariant = true; refreshBar(); }
  for (const perf of PERFORMANCES) if (perf.triggerKey === e.code) pendingTriggers.push(perf.id);
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
function keyHeld(code, alt) { return !!(keys[code] || (alt && keys[alt])); }
function readMoveX() {
  if (hostMoveX !== null) return hostMoveX; // 宿主直写优先于键盘（绕过口）
  let ix = 0;
  if (keyHeld(KEYMAP.left, 'ArrowLeft')) ix -= 1;
  if (keyHeld(KEYMAP.right, 'ArrowRight')) ix += 1;
  if (ix === 0 && autoWalk && moveMode === 'side') ix = autoDir;
  return ix;
}
function readMoveY() { // 俯视平面纵向（+1 = 向北/屏幕上）
  let iy = 0;
  if (keyHeld(KEYMAP.jump, 'ArrowUp')) iy += 1;
  if (keyHeld(KEYMAP.down, 'ArrowDown')) iy -= 1;
  return iy;
}
// 角色碰撞盒：脚底中心 x、半宽 HW、盒高 charBoxH（原点上方留头顶余量）
const CHAR_HW = 7;
function updateCharacterTop(dt, ix, iy) {
  const len = Math.hypot(ix, iy);
  if (len > 0) {
    // 纵向速度减半（用户裁定）：PHYS.speed 是横向速度（140，侧视与
    // 俯视横向同值）；俯视纵向分量 ×0.5（=70），斜向时仅纵向分量
    // 减半、横向分量不变。步幅同为侧视之半（见俯视步态 stride），
    // 步幅半、速度半 → 纵向一个步态周期的时间与侧视一致。
    const vx = ix / (len || 1) * PHYS.speed, vy = iy / (len || 1) * PHYS.speed * 0.5;
    // 逐轴解算：先 x 后 y，实体当平面障碍
    let nx = char.x + vx * dt;
    for (const q of solids) {
      if (nx + CHAR_HW > q.x && nx - CHAR_HW < q.x + q.w && char.py + CHAR_HW > q.y && char.py - CHAR_HW < q.y + q.h) {
        nx = vx > 0 ? q.x - CHAR_HW : q.x + q.w + CHAR_HW;
      }
    }
    char.x = nx;
    let ny = char.py + vy * dt;
    for (const q of solids) {
      if (char.x + CHAR_HW > q.x && char.x - CHAR_HW < q.x + q.w && ny + CHAR_HW > q.y && ny - CHAR_HW < q.y + q.h) {
        ny = vy > 0 ? q.y - CHAR_HW : q.y + q.h + CHAR_HW;
      }
    }
    char.py = ny;
    if (!char.lockedVariant) {
      char.variant = ((Math.round((Math.atan2(iy, ix) * 180 / Math.PI + 90) / 45) % 8) + 8) % 8;
    }
  }
  char.onGround = true; char.wallDir = 0; char.ledge = null;
}
function updateCharacterSide(dt, ix, jumpHeld, downHeld) {
  if (fbCrouchT > 0 && !char.onGround) fbCrouchT = 0; // 下蹲中离地（走下台阶等）→ 取消
  const H = charBoxH();
  // —— 抓边中：物理暂停，等爬上/落下 ——
  if (char.ledge) {
    const q = char.ledge.s, side = char.ledge.side; // side=+1 抓的是实体左缘（人在实体左侧）
    if (jumpHeld || keyHeld(KEYMAP.jump, 'ArrowUp')) {
      char.y = q.y + q.h; char.x = q.x + (side > 0 ? CHAR_HW + 1 : q.w - CHAR_HW - 1);
      char.vy = 0; char.onGround = true; char.ledge = null;
    } else if (downHeld || (side > 0 && ix < 0) || (side < 0 && ix > 0)) {
      char.ledge = null; char.vy = 0; char.onGround = false;
    }
    return;
  }
  if (ix !== 0 && !char.lockedVariant) char.variant = ix > 0 ? 2 : 6;
  // —— 水平：先走后堵（实体侧面） ——
  char.wallDir = 0;
  let nx = char.x + ix * PHYS.speed * dt;
  if (ix !== 0) {
    for (const q of solids) {
      const overlapY = char.y < q.y + q.h - 0.01 && char.y + H > q.y + 0.01;
      if (overlapY && nx + CHAR_HW > q.x && nx - CHAR_HW < q.x + q.w) {
        if (ix > 0 && char.x + CHAR_HW <= q.x + 0.01) { nx = q.x - CHAR_HW; char.wallDir = 1; }
        else if (ix < 0 && char.x - CHAR_HW >= q.x + q.w - 0.01) { nx = q.x + q.w + CHAR_HW; char.wallDir = -1; }
      }
    }
  }
  char.x = nx;
  if (autoWalk && Math.abs(char.x) > 110) autoDir = char.x > 0 ? -1 : 1;
  // —— 跳跃（兜底开启时先屈膝下蹲：倒计时到位才给初速，起跳时机顺延） ——
  if (fbCrouchT > 0) {
    fbCrouchT -= dt;
    if (fbCrouchT <= 0) { fbCrouchT = 0; char.vy = PHYS.jumpV; char.onGround = false; }
  } else if (jumpHeld && char.onGround) {
    if (ensureFB().jumpOk) fbCrouchT = FB_CROUCH_DUR;
    else { char.vy = PHYS.jumpV; char.onGround = false; }
  }
  // —— 垂直：重力积分后按跨越判定落地/顶头 ——
  const prevFeet = char.y, prevHead = char.y + H;
  if (!char.onGround) char.vy -= PHYS.gravity * dt;
  else if (!jumpHeld || char.vy <= 0) char.vy = 0;
  let ny = char.y + char.vy * dt;
  let landed = false;
  if (char.vy <= 0) {
    let best = 0; // 地面 y=0 恒为支撑
    for (const q of solids) {
      const top = q.y + q.h;
      const overX = char.x + CHAR_HW * 0.7 > q.x && char.x - CHAR_HW * 0.7 < q.x + q.w;
      if (overX && top <= prevFeet + 0.01 && top >= ny && top > best) best = top;
    }
    if (ny <= best) { ny = best; char.vy = 0; landed = true; }
  } else {
    for (const q of solids) {
      const overX = char.x + CHAR_HW * 0.7 > q.x && char.x - CHAR_HW * 0.7 < q.x + q.w;
      if (overX && q.y >= prevHead - 0.01 && q.y <= ny + H) { ny = q.y - H; char.vy = 0; }
    }
  }
  // 支撑复查：站在支撑面上（vy=0 且脚下 0.6 内有支撑）才算在地
  if (!landed && char.vy === 0) {
    let support = (ny <= 0.01) ? 0 : -Infinity;
    for (const q of solids) {
      const top = q.y + q.h;
      const overX = char.x + CHAR_HW * 0.7 > q.x && char.x - CHAR_HW * 0.7 < q.x + q.w;
      if (overX && top <= ny + 0.01 && top >= ny - 0.6 && top > support) support = top;
    }
    if (support > -Infinity) { ny = support; landed = true; }
  }
  char.y = ny;
  char.onGround = landed;
  // —— 贴墙滑落：空中触墙且朝墙推 → 下滑钳速，进状态机变量 wall ——
  if (!char.onGround && char.wallDir !== 0 && ix === char.wallDir && char.vy < -30) char.vy = -30;
  // —— 抓边：下落中手高（脚 + 盒高 - 6）跨过实体顶边且身体贴在实体侧缘外 ——
  if (!char.onGround && char.vy < 0) {
    const handPrev = prevFeet + H - 6, handNow = char.y + H - 6;
    for (const q of solids) {
      const top = q.y + q.h;
      if (handPrev > top && handNow <= top) {
        if (char.x + CHAR_HW >= q.x - 2 && char.x + CHAR_HW <= q.x + 5 && ix >= 0) {
          char.ledge = { s: q, side: 1 }; char.y = top - (H - 6); char.x = q.x - CHAR_HW; char.vy = 0; break;
        }
        if (char.x - CHAR_HW <= q.x + q.w + 2 && char.x - CHAR_HW >= q.x + q.w - 5 && ix <= 0) {
          char.ledge = { s: q, side: -1 }; char.y = top - (H - 6); char.x = q.x + q.w + CHAR_HW; char.vy = 0; break;
        }
      }
    }
  }
}
function updateCharacter(dt, inp) {
  if (moveMode === 'top') updateCharacterTop(dt, inp.ix, inp.iy);
  else updateCharacterSide(dt, inp.ix, inp.jump, inp.down);
}
function partCenter(params, an) {
  const c = Math.cos(an.a), s = Math.sin(an.a);
  const rx = params.off[0] * c - params.off[1] * s;
  const ry = params.off[0] * s + params.off[1] * c;
  return [char.x + params.pivot[0] + rx + (an.dx || 0), charOriginY() + params.pivot[1] + ry + (an.dy || 0)];
}

// ---------- 控制条 ----------
const bar = document.getElementById('bar');
const barState = { dirs: [], costs: [], perfBtns: {} };
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
    b.onclick = () => pendingTriggers.push(perf.id);
    barState.perfBtns[perf.id] = b;
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
  const fb = document.createElement('button');
  fb.textContent = '透视缩短';
  fb.onclick = () => { foreOn = !foreOn; fb.classList.toggle('on', foreOn); };
  row3.appendChild(fb);
}
function refreshBar() {
  barState.dirs.forEach((b, i) => b.classList.toggle('on', i === char.variant));
  barState.costs.forEach((b) => b.classList.toggle('on', b.dataset.key === currentCostume));
}
refreshBar();
document.getElementById('hud').innerHTML =
  '<b>' + EMBEDDED.characterName + '</b> · 程序化运行时<br>' +
  'A/D 或方向键移动 · W 跳跃 · 数字键锁方向 · 表演键见右上<br>控制条可切俯视、改手感、重绑键、编辑场景、录制回放/GIF';
if (EMBEDDED.warnings && EMBEDDED.warnings.length) {
  document.getElementById('warn').textContent = '导出提示：\\n' + EMBEDDED.warnings.join('\\n');
}


// ---------- 预览工具面板：模式 / 手感 / 按键 / 场景 / 录制 ----------
function mkPanelDiv() {
  const d = document.createElement('div');
  d.style.display = 'none'; d.style.padding = '4px 2px'; d.style.maxWidth = '560px';
  return d;
}
function mkBtn(label) { const b = document.createElement('button'); b.textContent = label; return b; }
const feelPanel = mkPanelDiv(), keyPanel = mkPanelDiv(), scenePanel = mkPanelDiv(), recPanel = mkPanelDiv();
{
  const row = mkRow('工具');
  const bMode = mkBtn('俯视模式');
  bMode.onclick = () => {
    if (moveMode === 'side') { moveMode = 'top'; char.py = char.y; char.ledge = null; char.wallDir = 0; }
    else { moveMode = 'side'; char.y = 0; char.vy = 0; char.onGround = true; }
    fbCrouchT = 0; // 模式切换取消进行中的兜底下蹲，避免往返后迟到起跳
    fbStage = 'none'; fbStageT = 0; fbAirTime = 0; // 脚目标状态一并清（植物点/段记录跨模式无意义）
    fbPlants.clear(); fbTopPlants.clear(); fbTipPrev.clear(); fbSegPrev.clear(); fbSwingFrom.clear(); fbAirCur.clear();
    camState.snap = true;
    bMode.classList.toggle('on', moveMode === 'top');
    bMode.textContent = moveMode === 'top' ? '横版模式' : '俯视模式';
  };
  row.appendChild(bMode);
  const panels = [[feelPanel, '手感'], [keyPanel, '按键'], [scenePanel, '场景'], [recPanel, '录制']];
  for (const [d, lab] of panels) {
    const b = mkBtn(lab);
    b.onclick = () => {
      const on = d.style.display === 'none';
      for (const [q] of panels) q.style.display = 'none';
      d.style.display = on ? 'block' : 'none';
      b.classList.toggle('on', on);
    };
    row.appendChild(b);
    bar.appendChild(d);
  }
}
// 手感：滑杆直改 PHYS（走速/跳速/重力/相机跟随率）+ 相机横纵锁定
{
  const defs = [
    ['speed', '移动速度', 20, 220, 1], ['jumpV', '跳跃初速', 50, 420, 1],
    ['gravity', '重力', 100, 2400, 10], ['camFollow', '相机跟随率', 0.5, 24, 0.5],
  ];
  for (const [k, lab, mn, mx, st] of defs) {
    const line = document.createElement('div');
    const name = document.createElement('span'); name.className = 'lab'; name.textContent = lab;
    const rng = document.createElement('input');
    rng.type = 'range'; rng.min = String(mn); rng.max = String(mx); rng.step = String(st); rng.value = String(PHYS[k]);
    const val = document.createElement('span'); val.className = 'lab'; val.textContent = String(PHYS[k]);
    rng.oninput = () => { PHYS[k] = parseFloat(rng.value); val.textContent = rng.value; };
    line.appendChild(name); line.appendChild(rng); line.appendChild(val);
    feelPanel.appendChild(line);
  }
  for (const [k, lab] of [['camLockX', '锁相机横向'], ['camLockY', '锁相机纵向']]) {
    const b = mkBtn(lab);
    b.onclick = () => { PHYS[k] = !PHYS[k]; b.classList.toggle('on', PHYS[k]); };
    feelPanel.appendChild(b);
  }
}
// 按键：移动键与表演触发键都可重绑（点一项 → 按新键）
function refreshKeyPanel() {
  keyPanel.innerHTML = '';
  const hint = document.createElement('div');
  hint.className = 'lab';
  hint.textContent = rebindTarget ? '按下新键完成重绑（Esc 取消）…' : '点击一项再按新键重绑；方向键恒为备用。';
  keyPanel.appendChild(hint);
  const acts = [['left', '左移'], ['right', '右移'], ['jump', '跳跃/上'], ['down', '下']];
  for (const [act, lab] of acts) {
    const b = mkBtn(lab + '：' + String(KEYMAP[act]).replace('Key', ''));
    b.onclick = () => { rebindTarget = { kind: 'move', act }; refreshKeyPanel(); };
    keyPanel.appendChild(b);
  }
  for (const perf of PERFORMANCES) {
    const b = mkBtn(perf.name + '：' + (perf.triggerKey ? String(perf.triggerKey).replace('Key', '') : '未绑'));
    b.onclick = () => { rebindTarget = { kind: 'perf', perf }; refreshKeyPanel(); };
    keyPanel.appendChild(b);
  }
}
refreshKeyPanel();
// 场景：增删实体、背景图；拖拽在画布上完成（编辑开关打开后）
const sceneInfo = document.createElement('div');
sceneInfo.className = 'lab';
function refreshScenePanel() {
  const q = solids[selSolid];
  sceneInfo.textContent = q
    ? '选中块 ' + (selSolid + 1) + '：x ' + Math.round(q.x) + '、y ' + Math.round(q.y) + '、' + Math.round(q.w) + '×' + Math.round(q.h) + '（拖动移动、拖右上角改大小）'
    : '未选中块：在画布上点一个块选中。';
}
{
  const bEdit = mkBtn('编辑场景');
  bEdit.onclick = () => { sceneEdit = !sceneEdit; if (!sceneEdit) selSolid = -1; bEdit.classList.toggle('on', sceneEdit); refreshScenePanel(); };
  scenePanel.appendChild(bEdit);
  const bAdd = mkBtn('添加块');
  bAdd.onclick = () => {
    solids.push({ x: Math.round(camState.x - 15), y: moveMode === 'top' ? Math.round(camState.y - 3) : 0, w: 30, h: 6 });
    selSolid = solids.length - 1; sceneEdit = true; bEdit.classList.add('on'); refreshScenePanel();
  };
  scenePanel.appendChild(bAdd);
  const bDel = mkBtn('删除选中');
  bDel.onclick = () => { if (selSolid >= 0) { solids.splice(selSolid, 1); selSolid = -1; refreshScenePanel(); } };
  scenePanel.appendChild(bDel);
  const bgInput = document.createElement('input');
  bgInput.type = 'file'; bgInput.accept = 'image/*'; bgInput.style.display = 'none';
  bgInput.onchange = () => {
    const f = bgInput.files && bgInput.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      bgTex = t;
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  };
  scenePanel.appendChild(bgInput);
  const bBg = mkBtn('背景图…');
  bBg.onclick = () => bgInput.click();
  scenePanel.appendChild(bBg);
  const bBgOff = mkBtn('清除背景');
  bBgOff.onclick = () => { if (bgTex) { gl.deleteTexture(bgTex); bgTex = null; } };
  scenePanel.appendChild(bBgOff);
  scenePanel.appendChild(sceneInfo);
  refreshScenePanel();
}
// 场景拖拽：屏幕 → 世界（相机中心 + 视口一半）
function screenToWorld(e) {
  const r = canvas.getBoundingClientRect();
  return [
    camState.x + ((e.clientX - r.left) / r.width - 0.5) * visW(),
    camState.y + (0.5 - (e.clientY - r.top) / r.height) * visH(),
  ];
}
let sceneDrag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!sceneEdit) return;
  const [wx, wy] = screenToWorld(e);
  selSolid = -1;
  for (let i = solids.length - 1; i >= 0; i--) {
    const q = solids[i];
    if (wx >= q.x && wx <= q.x + q.w && wy >= q.y && wy <= q.y + q.h) {
      selSolid = i;
      const corner = Math.hypot(wx - (q.x + q.w), wy - (q.y + q.h)) < 7;
      sceneDrag = { mode: corner ? 'resize' : 'move', dx: wx - q.x, dy: wy - q.y };
      break;
    }
  }
  refreshScenePanel();
});
canvas.addEventListener('pointermove', (e) => {
  if (!sceneDrag || selSolid < 0 || !solids[selSolid]) return;
  const [wx, wy] = screenToWorld(e);
  const q = solids[selSolid];
  if (sceneDrag.mode === 'move') { q.x = Math.round(wx - sceneDrag.dx); q.y = Math.round(wy - sceneDrag.dy); }
  else { q.w = Math.max(4, Math.round(wx - q.x)); q.h = Math.max(4, Math.round(wy - q.y)); }
  refreshScenePanel();
});
window.addEventListener('pointerup', () => { sceneDrag = null; });
// ---------- 录制 / 回放 / GIF ----------
function snapshotChar() {
  return { x: char.x, y: char.y, py: char.py, variant: char.variant, locked: char.lockedVariant, costume: currentCostume, aw: autoWalk };
}
function restoreChar(sn) {
  char.x = sn.x; char.y = sn.y; char.py = sn.py; char.vy = 0;
  char.ledge = null; char.wallDir = 0;
  char.variant = sn.variant; char.lockedVariant = sn.locked;
  currentCostume = sn.costume; autoWalk = sn.aw;
  char.onGround = moveMode === 'top' ? true : sn.y <= 0.01;
  camState.snap = true; refreshBar();
}
function startRecording() {
  if (replay.active) endReplay();
  stopAllPerfs(); behaviorEpoch = elapsed;
  rec.frames = []; rec.start = snapshotChar(); rec.active = true;
  anchorState.clear(); // 录制起点即锚定状态重置点（回放同口径重演）
  simStates.clear(); // 模拟状态同生命周期：录制起点全清
  refreshRecPanel();
}
function startReplay(withGif) {
  anchorState.clear();
  simStates.clear();
  if (!rec.frames.length || !rec.start) return;
  rec.active = false;
  restoreChar(rec.start);
  stopAllPerfs(); behaviorEpoch = elapsed;
  replay.frames = rec.frames; replay.idx = 0; replay.gif = !!withGif; replay.active = true;
  gifFrames.length = 0; gifAcc = 0;
  refreshRecPanel();
}
function endReplay() {
  const wasGif = replay.gif;
  replay.active = false; replay.gif = false;
  if (wasGif && gifFrames.length) { try { downloadGif(); } catch (err) { /* 编码失败不打断预览 */ } }
  gifFrames.length = 0;
  refreshRecPanel();
}
const recInfo = document.createElement('span');
recInfo.className = 'lab';
let recBtn = null, replayBtns = [];
function refreshRecPanel() {
  recInfo.textContent = rec.active
    ? '录制中 · ' + rec.frames.length + ' 帧'
    : replay.active ? '回放中 · ' + replay.idx + '/' + replay.frames.length
    : rec.frames.length ? '已录 ' + rec.frames.length + ' 帧（可回放）' : '未录制';
  if (recBtn) { recBtn.textContent = rec.active ? '停止录制' : '开始录制'; recBtn.classList.toggle('on', rec.active); }
  for (const b of replayBtns) b.disabled = !rec.frames.length || rec.active;
}
{
  recBtn = mkBtn('开始录制');
  recBtn.onclick = () => { if (rec.active) { rec.active = false; refreshRecPanel(); } else startRecording(); };
  recPanel.appendChild(recBtn);
  const bPlay = mkBtn('回放');
  bPlay.onclick = () => startReplay(false);
  recPanel.appendChild(bPlay); replayBtns.push(bPlay);
  const bGif = mkBtn('回放并导出 GIF');
  bGif.onclick = () => startReplay(true);
  recPanel.appendChild(bGif); replayBtns.push(bGif);
  const bStop = mkBtn('停止回放');
  bStop.onclick = () => { if (replay.active) endReplay(); };
  recPanel.appendChild(bStop);
  recPanel.appendChild(recInfo);
  refreshRecPanel();
}
// GIF：回放时按 30fps 节拍从帧缓冲抓帧（回放结束编码下载）
const gifFrames = [];
let gifAcc = 0;
const gifSrc = document.createElement('canvas');
const gifDst = document.createElement('canvas');
function gifCaptureFrame(dt) {
  gifAcc += dt;
  if (gifAcc < 1 / 30) return;
  const delay = Math.max(2, Math.round(gifAcc * 100));
  gifAcc = 0;
  const px = new Uint8Array(lowW * VIEW_H * 4);
  gl.readPixels(0, 0, lowW, VIEW_H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const flipped = new Uint8ClampedArray(px.length);
  const stride = lowW * 4;
  for (let y = 0; y < VIEW_H; y++) flipped.set(px.subarray((VIEW_H - 1 - y) * stride, (VIEW_H - y) * stride), y * stride);
  gifSrc.width = lowW; gifSrc.height = VIEW_H;
  gifSrc.getContext('2d').putImageData(new ImageData(flipped, lowW, VIEW_H), 0, 0);
  const W = Math.min(320, lowW), H = Math.max(1, Math.round(VIEW_H * W / lowW));
  gifDst.width = W; gifDst.height = H;
  const cx2 = gifDst.getContext('2d');
  cx2.imageSmoothingEnabled = false;
  cx2.drawImage(gifSrc, 0, 0, W, H);
  gifFrames.push({ data: cx2.getImageData(0, 0, W, H).data, w: W, h: H, delay });
}
function gifLzw(idx) {
  const out = [];
  let bitBuf = 0, bitCnt = 0;
  let dict = new Map(), freeEnt = 258, nBits = 9, maxCode = 511;
  const emit = (code) => {
    bitBuf |= code << bitCnt; bitCnt += nBits;
    while (bitCnt >= 8) { out.push(bitBuf & 255); bitBuf >>= 8; bitCnt -= 8; }
  };
  const resetDict = () => { dict = new Map(); freeEnt = 258; nBits = 9; maxCode = 511; };
  emit(256);
  let entKey = String(idx[0]);
  for (let i = 1; i < idx.length; i++) {
    const c = idx[i], comb = entKey + ',' + c;
    if (dict.has(comb)) { entKey = comb; continue; }
    emit(entKey.indexOf(',') >= 0 ? dict.get(entKey) : parseInt(entKey, 10));
    if (freeEnt < 4096) {
      dict.set(comb, freeEnt++);
      if (freeEnt > maxCode && freeEnt < 4096) { nBits++; maxCode = (1 << nBits) - 1; }
    } else {
      emit(256); resetDict();
    }
    entKey = String(c);
  }
  emit(entKey.indexOf(',') >= 0 ? dict.get(entKey) : parseInt(entKey, 10));
  emit(257);
  if (bitCnt > 0) out.push(bitBuf & 255);
  return out;
}
function downloadGif() {
  const W = gifFrames[0].w, H = gifFrames[0].h;
  // 调色板：全帧抽样统计 5-5-5 颜色频次取前 256，LUT 就近映射
  const hist = new Map();
  for (const f of gifFrames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 64) {
      const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      hist.set(k, (hist.get(k) || 0) + 1);
    }
  }
  const keys = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map((e) => e[0]);
  while (keys.length < 256) keys.push(0);
  const pal = keys.map((k) => [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4]);
  const lut = new Int16Array(32768).fill(-1);
  const palIndex = (r, g, b) => {
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = lut[k];
    if (hit >= 0) return hit;
    let best = 0, bd = Infinity;
    for (let i = 0; i < 256; i++) {
      const dr = pal[i][0] - r, dg = pal[i][1] - g, db = pal[i][2] - b;
      const dd = dr * dr + dg * dg + db * db;
      if (dd < bd) { bd = dd; best = i; }
    }
    lut[k] = best; return best;
  };
  const bytes = [];
  const pushStr = (t) => { for (let i = 0; i < t.length; i++) bytes.push(t.charCodeAt(i) & 255); };
  const push16 = (v) => { bytes.push(v & 255, (v >> 8) & 255); };
  pushStr('GIF89a'); push16(W); push16(H); bytes.push(0xF7, 0, 0);
  for (const c of pal) bytes.push(c[0], c[1], c[2]);
  pushStr('!\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00');
  for (const f of gifFrames) {
    bytes.push(0x21, 0xF9, 4, 0); push16(Math.max(2, f.delay)); bytes.push(0, 0);
    bytes.push(0x2C); push16(0); push16(0); push16(W); push16(H); bytes.push(0);
    const d = f.data, idx = new Uint8Array(W * H);
    for (let j = 0, q = 0; q < d.length; q += 4, j++) idx[j] = palIndex(d[q], d[q + 1], d[q + 2]);
    const comp = gifLzw(idx);
    bytes.push(8);
    for (let i = 0; i < comp.length; i += 255) {
      const chunk = comp.slice(i, i + 255);
      bytes.push(chunk.length);
      for (const b of chunk) bytes.push(b);
    }
    bytes.push(0);
  }
  bytes.push(0x3B);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/gif' }));
  a.download = (EMBEDDED.characterName || 'preview') + '.gif';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- 主循环：输入 → 程序化姿态 → 表演合成 → 渲染 ----------
const uLoc = (pr, n) => gl.getUniformLocation(pr, n);
const partU = { cam: uLoc(partProg, 'uCam'), vh: uLoc(partProg, 'uViewHalf'), res: uLoc(partProg, 'uRes'), time: uLoc(partProg, 'uTime'), zoom: uLoc(partProg, 'uZoom'), atlas: uLoc(partProg, 'uAtlas'), pal: uLoc(partProg, 'uPal'), base: uLoc(partProg, 'uBase'), glow: uLoc(partProg, 'uGlow'), glowSide: uLoc(partProg, 'uGlowSide') };
const solidU = { cam: uLoc(solidProg, 'uCam'), vh: uLoc(solidProg, 'uViewHalf') };
let last = performance.now();
// ---------- 画布级特效（缺口 5）：特效轨 + 笔触 ----------
// 与编辑器同语义：特效轨取 ≤ 当前帧的最近键（不插值）、笔触自其帧起
// 常驻。编辑器画布坐标 → 运行时世界坐标：画布中心 = 角色原点、
// x 同向、y 翻转（世界 y 向上）。全部走 solid 顶点（mode 0 方块 /
// mode 1 圆点），与粒子同路绘制（普通混合；编辑器的 lighter/overlay
// 等混合模式在此路下不区分，已知会近似）。
const FX = EMBEDDED.fx || null;
const FXW = FX && FX.canvas ? FX.canvas.w : 512;
const FXH = FX && FX.canvas ? FX.canvas.h : 512;
function fxHexRgb(hex) {
  const n = parseInt(String(hex || '#ffffff').replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function fxQuad(verts, cx, cy, w, h, rgb, a, mode) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  const cs = [[x0, y0, -1, -1], [x1, y0, 1, -1], [x1, y1, 1, 1], [x0, y0, -1, -1], [x1, y1, 1, 1], [x0, y1, -1, 1]];
  for (const cn of cs) verts.push(cn[0], cn[1], cn[2], cn[3], rgb[0], rgb[1], rgb[2], a, mode);
}
function fxSeg(verts, w0, w1, wdt, rgb, a) {
  const dx = w1[0] - w0[0], dy = w1[1] - w0[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * wdt / 2, ny = dx / len * wdt / 2;
  const cs = [
    [w0[0] + nx, w0[1] + ny, -1, -1], [w1[0] + nx, w1[1] + ny, 1, -1],
    [w1[0] - nx, w1[1] - ny, 1, 1], [w0[0] + nx, w0[1] + ny, -1, -1],
    [w1[0] - nx, w1[1] - ny, 1, 1], [w0[0] - nx, w0[1] - ny, -1, 1],
  ];
  for (const cn of cs) verts.push(cn[0], cn[1], cn[2], cn[3], rgb[0], rgb[1], rgb[2], a, 0);
}
function fxW2(px, py) { return [char.x + (px - FXW / 2), charFeetY() + (FXH / 2 - py)]; }
function fxRenderSet(set, frame, verts, occAt) {
  if (!set) return;
  const num = (v, d) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? d : Number(v));
  for (const tr of set.effectTracks || []) {
    if (!tr.visible) continue;
    let kf = null;
    for (const k of tr.keyframes || []) if (k.frame <= frame && (!kf || k.frame > kf.frame)) kf = k;
    if (!kf) continue;
    const P = kf.params || {};
    if (tr.type === 'glow') {
      const radius = num(P.radius, 3), inten = num(P.intensity, 0.5), rgb = fxHexRgb(P.color || '#ffff00');
      const step = Math.max(1, Math.floor(radius / 2));
      for (let ring = radius * 4; ring >= 1; ring -= step) {
        const t = ring / (radius * 4);
        fxQuad(verts, char.x, char.y, ring * 16, ring * 16, rgb, inten * 0.15 * (1 - t), 1);
      }
    } else if (tr.type === 'particle') {
      const rate = num(P.rate, 10), speed = num(P.speed, 2), life = Math.max(1, num(P.life, 10));
      const grav = num(P.gravity, 0.5), rgb = fxHexRgb(P.color || '#ff8800');
      const seed = dynSeedOf(tr.id);
      for (let birth = Math.max(0, frame - life + 1); birth <= frame; birth++) {
        const rng = dynProcSeededRandom(seed + birth * 7919);
        for (let i = 0; i < rate; i++) {
          const age = frame - birth;
          const ang = rng() * Math.PI * 2;
          const sv = speed * (0.5 + rng() * 0.5);
          const sizeVar = 1 + Math.floor(rng() * 3);
          const wx = char.x + Math.cos(ang) * sv * age;
          const wy = char.y - (Math.sin(ang) * sv * age + 0.5 * grav * age * age);
          const alpha = Math.max(0, 1 - age / life) * 0.6;
          if (alpha > 0) fxQuad(verts, wx, wy, sizeVar, sizeVar, rgb, alpha, 0);
        }
      }
    } else if (tr.type === 'afterimage') {
      const count = num(P.count, 3), opacity = num(P.opacity, 0.3), spacing = num(P.spacing, 5);
      for (let i = 1; i <= count; i++) fxQuad(verts, char.x - i * spacing, char.y, FXW, FXH, [128 / 255, 0, 1], opacity * 0.015, 0);
    } else if (tr.type === 'pixel_displace') {
      const inten = num(P.intensity, 2), freq = num(P.frequency, 0.1);
      for (let y = 0; y < FXH; y += 4) {
        const dx = Math.sin((y * freq + frame * freq * Math.PI * 2) * Math.PI * 2) * inten;
        const w = fxW2(FXW / 2 + dx, y);
        fxQuad(verts, w[0], w[1], FXW, 1, [100 / 255, 1, 200 / 255], 0.01, 0);
      }
    } else if (tr.type === 'motion_blur') {
      const length = num(P.length, 5), decay = num(P.decay, 0.5);
      for (let i = 1; i <= length; i++) {
        const a = Math.pow(1 - i / length, (1 - decay) * 4 + 1) * 0.1;
        fxQuad(verts, char.x - i, char.y, FXW, FXH, [200 / 255, 200 / 255, 1], a * 0.1, 0);
      }
    }
  }
  for (const st of set.motionBlurStrokes || []) {
    if (st.frame > frame || !st.points || st.points.length < 2) continue;
    const inten = st.intensity || 0, white = [1, 1, 1];
    const steps = Math.max(1, Math.floor(inten));
    const dots = (pt, dirX, dirY, f) => {
      for (let s2 = 1; s2 <= steps; s2++) {
        const w = fxW2(pt.x + dirX * s2 * 2, pt.y + dirY * s2 * 2);
        fxQuad(verts, w[0], w[1], 2, 2, white, (1 - s2 / steps) * f * (inten / 10), 0);
      }
    };
    if (st.brushType === 'linear') {
      for (let i = 0; i + 1 < st.points.length; i++) {
        const p1 = st.points[i], p2 = st.points[i + 1];
        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
        if (len < 0.01) continue;
        dots(p1, dx / len, dy / len, 0.4);
        fxSeg(verts, fxW2(p1.x, p1.y), fxW2(p2.x, p2.y), 2, white, 0.3 * (inten / 10) * 0.5);
      }
    } else if (st.brushType === 'radial') {
      let cx = 0, cy = 0;
      for (const pt of st.points) { cx += pt.x; cy += pt.y; }
      cx /= st.points.length; cy /= st.points.length;
      for (const pt of st.points) {
        const dx = pt.x - cx, dy = pt.y - cy, d = Math.hypot(dx, dy);
        if (d < 0.01) continue;
        dots(pt, dx / d, dy / d, 0.35);
      }
    } else if (st.brushType === 'directional') {
      const rad = (st.direction || 0) * Math.PI / 180;
      for (const pt of st.points) dots(pt, Math.cos(rad), Math.sin(rad), 0.35);
    }
  }
  for (const st of set.effectStrokes || []) {
    if (st.frame > frame || !st.points || st.points.length === 0) continue;
    const rgb = fxHexRgb(st.color || '#ffffff'), inten = st.intensity || 0;
    if (st.type === 'glow_brush') {
      for (const pt of st.points) {
        const w = fxW2(pt.x, pt.y);
        fxQuad(verts, w[0], w[1], (st.radius || 3) * 2, (st.radius || 3) * 2, rgb, inten * 0.3, 1);
      }
    } else if (st.type === 'particle_brush') {
      const density = st.density ?? 10, spread = st.spread ?? 5;
      for (let i = 0; i < st.points.length; i++) {
        const pt = st.points[i];
        const rng = dynProcSeededRandom(dynSeedOf(st.id + i.toString()));
        for (let d = 0; d < density; d++) {
          const ox = (rng() - 0.5) * spread * 2, oy = (rng() - 0.5) * spread * 2;
          const size = rng() > 0.5 ? 2 : 1;
          const alpha = inten * (0.5 + rng() * 0.5);
          const w = fxW2(pt.x + ox, pt.y + oy);
          fxQuad(verts, w[0], w[1], size, size, rgb, alpha, 0);
        }
      }
    } else if (st.type === 'afterimage_brush' && occAt) {
      if (st.points.length < 2) continue;
      const spread = st.spread ?? 5;
      const f0 = st.points[0], l0 = st.points[st.points.length - 1];
      let dirX = l0.x - f0.x, dirY = l0.y - f0.y;
      const len = Math.hypot(dirX, dirY);
      if (len > 0.01) { dirX /= len; dirY /= len; } else { dirX = -1; dirY = 0; }
      const copies = Math.max(1, Math.floor(spread));
      for (let c = 1; c <= copies; c++) {
        const alpha = inten * (1 - c / (copies + 1)) * 0.5;
        for (const pt of st.points) {
          const src = fxW2(pt.x, pt.y);
          if (!occAt(src[0], src[1])) continue;
          const dst = fxW2(pt.x + dirX * c * 2, pt.y + dirY * c * 2);
          fxQuad(verts, dst[0], dst[1], 1, 1, rgb, alpha, 0);
        }
      }
    }
  }
}

let recPendingFrame = null;
function frame(now) {
  // ---------- 玩家时钟（D6 乙路裁决 6）：时钟只有一个入口——本
  // 函数头的 dt 与随后的 elapsed += dt，下游全部时间从 elapsed
  // 派生。三模式（包字段 simMode，缺省 frame）：
  // frame：dt 恒 = 1/FRAME_RATE，每 rAF tick 恰走一包帧（帧为定
  // 义、秒为帧率换算）。
  // wall：保持现行墙钟 dt（含 0.05 钳制）；模拟步数按累加器补
  // 步（见模拟遍调用处）。
  // audio：宿主经 window.__simHost = { audioPositionMs } 注入音
  // 轨实际位置回调（缺失时回退 wall 并以 wallClock 路径运行）；
  // dt 以 frame 步进为基底恒 1/FRAME_RATE，漂移纠正与重锁在
  // elapsed += dt 后按帧位对齐（见下）。
  const audioHost = (PKG_SIM_MODE === 'audio' && window.__simHost && typeof window.__simHost.audioPositionMs === 'function')
    ? window.__simHost : null;
  const wallClock = PKG_SIM_MODE === 'wall' || (PKG_SIM_MODE === 'audio' && !audioHost);
  let dt = wallClock ? Math.min(0.05, (now - last) / 1000) : 1 / FRAME_RATE;
  last = now;
  // 本帧输入：回放时取记录帧（dt/方向/跳/触发/位姿快照），否则实时读键
  let inp, trigNow;
  if (replay.active) {
    const rf = replay.frames[replay.idx];
    if (!rf) {
      endReplay();
      inp = { ix: readMoveX(), iy: readMoveY(), jump: keyHeld(KEYMAP.jump, 'ArrowUp'), down: keyHeld(KEYMAP.down, 'ArrowDown') };
      trigNow = pendingTriggers.splice(0);
    } else {
      replay.idx++;
      dt = rf.dt;
      inp = { ix: rf.ix, iy: rf.iy || 0, jump: rf.jump, down: rf.down };
      trigNow = rf.trig.slice();
      char.variant = rf.variant; char.lockedVariant = rf.locked;
      if (rf.costume && COSTUMES[rf.costume] && rf.costume !== currentCostume) { currentCostume = rf.costume; refreshBar(); }
      autoWalk = !!rf.aw;
    }
  } else {
    inp = { ix: readMoveX(), iy: readMoveY(), jump: keyHeld(KEYMAP.jump, 'ArrowUp'), down: keyHeld(KEYMAP.down, 'ArrowDown') };
    trigNow = pendingTriggers.splice(0);
  }
  elapsed += dt;
  // audio 对齐：目标帧位 = 音轨位置换算帧，drift = 目标 − 当前帧
  // 位（elapsed*FRAME_RATE）。|drift| > 4 → hardRelockTo(round(目
  // 标))；|drift| ≤ 4 → 本 tick 模拟步数在 frame 基底 1 步上 ±1
  // 纠正（无死区，亚帧漂移由帧位取整自然吸收）。步数在此定，
  // 模拟遍调用处消费；重锁在此处做，下游本帧即按新帧位求值。
  let audioSimSteps = -1;
  if (audioHost) {
    const target = audioHost.audioPositionMs() / 1000 * FRAME_RATE;
    const drift = target - elapsed * FRAME_RATE;
    if (Math.abs(drift) > 4) { hardRelockTo(Math.round(target)); audioSimSteps = 1; }
    else audioSimSteps = 1 + (drift >= 1 ? 1 : drift <= -1 ? -1 : 0);
    simSteppedElapsed = elapsed;
  }
  const ix = inp.ix;
  for (const id of trigNow) { const pf = PERFORMANCES.find((q) => q.id === id); if (pf) enterPerformance(pf); }
  updateCharacter(dt, inp);
  if (rec.active && !replay.active) {
    recPendingFrame = { dt, ix: inp.ix, iy: inp.iy, jump: inp.jump, down: inp.down, trig: trigNow.slice() };
  }
  if (char.onGround !== prevOnGround) {
    emitRuntimeEvent(char.onGround ? 'land' : 'takeoff', {});
    prevOnGround = char.onGround;
  }
  // 行为层：宿主喂 vars，逐部件行为图实时求值（时间基 = 60fps 帧；
  // phase 为步态相位帧：移动约 30/s、静止 4/s、腾空 18/s；
  // nodeRef 读哪帧由每张图的 follow 开关决定：'prev'（缺省）读上一帧
  // 输出（纯延迟一帧），'same' 读本帧第一遍的输出（无延迟））
  phaseAcc += dt * (char.onGround ? ((ix !== 0 || inp.iy !== 0) ? 30 : 4) : 18) / 60; // 圈/秒（1 圈 = 旧 60 相位帧）
  // 行为时钟 = 表演纪元起算的秒。图内时间一律秒（time 节点、
  // 周期参数、phase 圈数），全系统不再出现帧制时间。
  const behaviorT = elapsed - behaviorEpoch;
  // 宿主通用变量垫底、逐帧计算值在后覆盖：setVar 的变量状态机/行为图可读，
  // 但 t/phase/moveX/speed01/grounded 永远以本帧计算为准。
  const hostVars = Object.assign({}, hostCustomVars, {
    t: behaviorT, phase: phaseAcc, moveX: ix,
    speed01: (ix !== 0 || inp.iy !== 0) ? 1 : 0, grounded: char.onGround ? 1 : 0,
    wall: (!char.onGround && char.wallDir !== 0) ? 1 : 0, ledge: char.ledge ? 1 : 0,
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
        pose[key] = { a: rec.angle, dx: rec.dx, dy: rec.dy, rim: 0, glint: 0, sx: rec.scaleX ?? 1, sy: rec.scaleY ?? 1 };
        behaviorOutputs.set(key, {
          rotation: -rec.angle * 180 / Math.PI, translateX: rec.dx, translateY: -rec.dy,
          scaleX: rec.scaleX ?? 1, scaleY: rec.scaleY ?? 1,
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
  const stackPick = new Map();
  for (let i = activePerfs.length - 1; i >= 0; i--) {
    const act = activePerfs[i];
    act.t += dt;
    // 循环表演（片段 loop）到尾回绕，不结束、不发 perfend
    if (act.perf.loop && act.t > act.perf.duration) act.t = act.t % act.perf.duration;
    const w = envelopeWeight(act.t, act.perf.duration, act.perf.envelope.in, act.perf.envelope.out);
    if (w > 0) {
      const bpOut = evalRuntimeGraph(act.perf.graph, { u: Math.min(1, act.t / act.perf.duration), tSec: act.t });
      pose = composePerformance(pose, act.perf, bpOut, w);
      // 堆叠层变换选帧：带 stackFrames 的表演里取权重最大者（同权取
      // 最近触发），帧号按表演本地进度对齐烘焙采样格
      const sf = act.perf.stackFrames;
      if (sf) {
        const u = Math.min(1, act.t / act.perf.duration);
        for (const sk of Object.keys(sf)) {
          const prev = stackPick.get(sk);
          if (prev && prev.w >= w) continue;
          const frames = sf[sk].frames;
          const idx = Math.max(0, Math.min(frames.length - 1, Math.round(u * (frames.length - 1))));
          stackPick.set(sk, { w: w, ops: frames[idx], costume: sf[sk].costume });
        }
      }
    }
    // 片段状态轨（缺口 6）：段表演期间按本地时间累计应用状态键——
    // 从开始时的快照出发，逐键叠加（整覆服装集 + 逐槽变体增删），
    // 索引推进时才重算；表演结束恢复快照（见 restoreFxSnapshot）。
    if (act.perf.stateFx && act.fxSnapshot) {
      let idx = -1;
      for (let k = 0; k < act.perf.stateFx.length; k++) {
        if (act.perf.stateFx[k].t <= act.t) idx = k; else break;
      }
      if (idx !== act.fxApplied) {
        act.fxApplied = idx;
        let cs = act.fxSnapshot.costume;
        const ov = { ...act.fxSnapshot.overrides };
        for (let k = 0; k <= idx; k++) {
          const e = act.perf.stateFx[k];
          if (e.costume) cs = e.costume;
          if (e.slots) {
            for (const sk of Object.keys(e.slots)) {
              if (e.slots[sk] === null) delete ov[sk]; else ov[sk] = e.slots[sk];
            }
          }
        }
        currentCostume = cs;
        slotOverrides = ov;
      }
    }
    if (act.t > act.perf.duration) {
      restoreFxSnapshot(act);
      activePerfs.splice(i, 1);
      emitRuntimeEvent('perfend', { id: act.perf.id, name: act.perf.name });
    }
  }
  // 兜底动作遍：表演合成后、模拟遍前（模拟链以兜底后位姿为参考）
  runFallbackPass(pose, dt);
  // 链摆实时模拟遍：pose 定稿后、落位之前（回写 pose，见
  // runSimPass）。步数：audio 已在帧头定；frame/wall 按累加器——
  // 应步数 = round((elapsed − 上次已步进 elapsed) * FRAME_RATE)
  // 钳 0..4，余量留在累加器（simSteppedElapsed 只按已步进量推
  // 进）；一 tick 内多步时除第一步外复用当帧 pin/段长步进（pose
  // 每 tick 只求值一次的近似，点名）。
  if (SIM_CHAINS.length) {
    let simSteps;
    if (audioSimSteps >= 0) simSteps = audioSimSteps;
    else {
      simSteps = Math.max(0, Math.min(4, Math.round((elapsed - simSteppedElapsed) * FRAME_RATE)));
      simSteppedElapsed += simSteps / FRAME_RATE;
    }
    runSimPass(pose, simSteps);
  }
  const state = ensureAtlas(gl, char.variant, currentCostume);
  // 追随段进度：与「轨道」表演同一时间轴（全程窗 u ∈ 0..1，两端钳制）
  const tracksPerf = PERFORMANCES.find((p) => p.id === 'tracks');
  const followU = tracksPerf && tracksPerf.duration > 0
    ? Math.min(1, Math.max(0, elapsed / tracksPerf.duration)) : -1;
  const sorted = sortParts(PARTS, char.variant);
  const els = [];
  const elByKey = new Map();
  const skinJobs = [];
  const fieldJobs = [];
  const stackJobs = [];
  const pixelJobs = [];
  const partAnchorsByKey = new Map();
  const dynAnchors = [];
  const clampCands = [];
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
    // 像素链作业收集：带 pixelGraph 的精灵部件（置换变体瓦片由
    // 干净瓦片在 CPU 烘出、链不跟，v1 边界——有 disp 时整件跳过）
    if (part.pixelGraph && entry.spriteGrid && !entry.disp) {
      pixelJobs.push({ part: part, grid: entry.spriteGrid, mirrored: entry.mirrored, place: place, tileExtra: entry.tileExtra || 0 });
    }
    const p = resolved.params;
    const an0 = pose[part.key] || { a: 0, dy: 0, rim: 0, glint: 0 };
    const an = { a: an0.a + (p.restRot || 0), dx: an0.dx || 0, dy: an0.dy || 0, rim: an0.rim || 0, glint: an0.glint || 0, sx: an0.sx || 1, sy: an0.sy || 1 };
    // 堆叠层变换：主导表演有烘焙帧、当前服装集与烘焙口径一致、当前
    // 朝向未镜像时，本部件本帧逐层真合成（fore 不再叠加，算子已含
    // 真几何）；否则回落静止合成图
    const stackSel = (part.stack && !variantMirrored(part, char.variant)) ? stackPick.get(part.key) : undefined;
    const stackDrive = (stackSel && stackSel.costume === currentCostume) ? stackSel : undefined;
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
        // 锚定版沿轴缩放（甲）：乘进 sy 通道（与透视缩短同为沿轴倍乘）
        if (fc.ds) an.sy *= followSampleAt(fc.ds, followU);
      }
    }
    // 程序化动画（缺口 2）：与编辑器同口径叠加到位姿——平移 px、旋转
    // 度→弧度、缩放以 (1 + v/10) 相乘（编辑器是加到 uniform_scale 的
    // scale 参数上，无其他缩放修改器时等价；钳制与编辑器同为 ≥0.1）。
    let paScale = 1;
    if (PROCEDURAL.length > 0) {
      const fIdx = elapsed * FRAME_RATE;
      for (const pa of PROCEDURAL) {
        if (pa.slot !== part.key || fIdx < pa.startFrame || fIdx > pa.endFrame) continue;
        const v = dynProceduralValue(pa.cfg, fIdx);
        if (pa.target === 'translateX') an.dx += v;
        else if (pa.target === 'translateY') an.dy += v;
        else if (pa.target === 'rotation') an.a += v * Math.PI / 180;
        else if (pa.target === 'scale') paScale *= Math.max(0.1, 1 + v / 10);
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
    if (paScale !== 1) { dsx *= paScale; dsy *= paScale; hasDeform = true; }
    if (an.sx !== 1 || an.sy !== 1) { dsx *= an.sx; dsy *= an.sy; hasDeform = true; }
    // 透视缩短（缺口 7）：沿骨骼方向（局部 Y）乘烘焙因子，与编辑器
    // effStretch 同落点；开关关时因子不生效
    if (!stackDrive && foreOn && an.fore !== undefined && an.fore !== 1) { dsy *= an.fore; hasDeform = true; }
    const rotA = an.a + spinRad;
    // 发光段：前 3 个启用实例各供一组参数（场在图集 RGB 三通道，导出时
    // 按选区预计算；第 4 个起在导出端已按各自所选组并入对应通道）
    const glowInsts = dynList.filter((x) => x.params.glowEnabled).slice(0, 3);
    const glowEl = glowInsts.map((x) => {
      const grgb = particleRgb(dynPostColorAt(x.params, x.params.glowColor || '#7dd7ff'));
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
    // 团块/火焰场（乙8 改造）：槽位图元贴部件位姿；场内容由
    // 场作业逐帧按当帧形变现算重传（范围跟、形态不跟）
    if (state.fieldSlots) {
      const mirNow = variantMirrored(part, char.variant);
      dynList.forEach((inst, ii) => {
        const pp = (inst && inst.params) || {};
        const kindsR = [];
        if (pp.blobEnabled) kindsR.push('blob');
        if (pp.flameEnabled) kindsR.push('flame');
        for (const kind of kindsR) {
          const ft = state.fieldSlots[part.key + ':' + ii + ':' + kind];
          if (!ft) continue;
          els.push({
            pos: [el.pos[0], el.pos[1]], size: [ft.size[0] * 3, ft.size[1] * 3], rot: el.rot,
            tileCx: ft.tileCx, tileCy: ft.tileCy, tile: ft.tile,
            family: 0, seed: 0, modes: [0, 0, 0, 0], param: [0, 0, 0],
            ghost: false, composite: 4, deform: undefined, glow: [], glowSpace: [], glowStamps: undefined,
          });
          fieldJobs.push({ slot: ft, params: pp, kind: kind, dsx: dsx, dsy: dsy, mir: mirNow });
        }
      });
    }
    // 网格蒙皮（缺口 4）：收集变形活儿，循环后父子位姿齐了再执行
    if (part.skin && tile && place) {
      skinJobs.push({
        tile: tile, place: place, key: part.key, family: !!entry.fam,
        plugX: tile.cx + (variantMirrored(part, char.variant) ? -part.skin.plugOff[0] : part.skin.plugOff[0]),
        plugY: tile.cy + part.skin.plugOff[1],
      });
    }
    if (stackDrive && tile && place) {
      stackJobs.push({ part: part, tile: tile, place: place, ops: stackDrive.ops });
    }
    // 弧线段原点 = 插头：换成相对瓦片中心的偏移（粒子系以中心为原点）
    const plugC = entry.plugN
      ? [entry.plugN[0] * tile.w - tile.w / 2, (1 - entry.plugN[1]) * tile.h - tile.h / 2]
      : [0, 0];
    // 双锚点查表：全部部件的锚点信息（目标部件未必挂动态模式）
    partAnchorsByKey.set(part.key, { ctr: ctr, rot: rotA, plugC: plugC, dsx: dsx, dsy: dsy });
    // 钳制锚定候选：名为 anchor 的点标记（瓦片像素 → 部件中心系、y-up）
    if (entry.marksN && entry.marksN.anchor && tile) {
      clampCands.push({ key: part.key, ctr: ctr, rot: rotA, dsx: dsx, dsy: dsy,
        local: [entry.marksN.anchor[0] - tile.w / 2, tile.h / 2 - entry.marksN.anchor[1]] });
    }
    if (dynList.length > 0) {
      dynAnchors.push({ part: part, tile: tile, ctr: ctr, rot: rotA, dynList: dynList, dsx: dsx, dsy: dsy, plugC: plugC, marksN: entry.marksN || null, marksDir: entry.marksDir || null });
    }
  });
  // 钳制锚定遍：表演求值后、绘制前（Δ 回写物理 + 同步移本帧绘制位）
  runAnchorPass(clampCands, els, partAnchorsByKey);
  // 动态粒子：瓦片空间模拟（连续钟 elapsed × 包帧率量化帧，
  // 与编辑器同一帧基），发射点随形变缩放，位置经部件旋转落到
  // 世界（与片元采样同式）；绘制分身后/身前两遍夹住部件一遍。
  const backVerts = [], frontVerts = [];
  {
    const frameIdx = elapsed * FRAME_RATE;
    for (const a of dynAnchors) {
      const c = Math.cos(a.rot), s = Math.sin(a.rot);
      // 弧线段（D4 一期）：折线逐段拆 quad 条带进前层（宽线低透明
      // 作晕 + 细线本体）；点位以插头为原点，先平移到部件中心系，
      // 再经与粒子同一变换落到世界
      for (const inst of a.dynList) {
        const p = inst.params;
        if (!p.arcEnabled) continue;
        // 弧线原点：实例指定点标记时用标记位（相对瓦片中心、
        // y-up，与 plugC 同帧），否则插头位
        const orgC = (p.arcOriginMark && a.marksN && a.marksN[p.arcOriginMark])
          ? [a.marksN[p.arcOriginMark][0] - a.tile.w / 2, a.tile.h / 2 - a.marksN[p.arcOriginMark][1]]
          : a.plugC;
        // 双锚点（D4 二期）：目标部件插头的世界位 → 本部件本地终点
        let endX = 0, endY = 0, hasEnd = false;
        if (p.arcTarget && partAnchorsByKey.has(p.arcTarget)) {
          const ta = partAnchorsByKey.get(p.arcTarget);
          const tc = Math.cos(ta.rot), ts = Math.sin(ta.rot);
          const tgx = ta.plugC[0] * ta.dsx, tgy = ta.plugC[1] * ta.dsy;
          const wx = ta.ctr[0] + tgx * tc + tgy * ts;
          const wy = ta.ctr[1] + tgx * ts - tgy * tc;
          const rx = wx - a.ctr[0], ry = wy - a.ctr[1];
          // toWorld 的变换矩阵是自逆的（[[c,s],[s,−c]]），逆变换同式
          const lx = (rx * c + ry * s) / (a.dsx || 1), ly = (rx * s - ry * c) / (a.dsy || 1);
          endX = lx - orgC[0]; endY = ly - orgC[1];
          hasEnd = true;
        }
        const shape = dynArcPoints(p, elapsed, endX, endY, hasEnd);
        const rgb = particleRgb(dynPostColorAt(p, p.arcColor || '#bfe3ff'));
        const toWorld = (qx, qy) => {
          const gx = (orgC[0] + qx) * a.dsx, gy = (orgC[1] + qy) * a.dsy;
          return [a.ctr[0] + gx * c + gy * s, a.ctr[1] + gx * s - gy * c];
        };
        const pushSeg = (w0, w1, wdt, alpha) => {
          const dx = w1[0] - w0[0], dy = w1[1] - w0[1];
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len;
          const nx = -uy * wdt / 2, ny = ux * wdt / 2;
          const ex = ux * wdt * 0.3, ey = uy * wdt * 0.3;
          const cs = [
            [w0[0] - ex + nx, w0[1] - ey + ny], [w1[0] + ex + nx, w1[1] + ey + ny],
            [w1[0] + ex - nx, w1[1] + ey - ny], [w0[0] - ex - nx, w0[1] - ey - ny],
          ];
          const locals = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
          for (const oi of [0, 1, 2, 0, 2, 3]) {
            frontVerts.push(cs[oi][0], cs[oi][1], locals[oi][0], locals[oi][1], rgb[0], rgb[1], rgb[2], alpha, 0);
          }
        };
        for (const line of [shape.main].concat(shape.branches)) {
          for (let i = 0; i + 1 < line.length; i++) {
            const w0 = toWorld(line[i][0], line[i][1]);
            const w1 = toWorld(line[i + 1][0], line[i + 1][1]);
            pushSeg(w0, w1, line[i][2] * 2.6, shape.alpha * 0.22);
            pushSeg(w0, w1, line[i][2], shape.alpha);
          }
        }
        // 光点（藤蔓叶/星座星）：极短粗段近似圆点
        for (const d of shape.dots || []) {
          const w0 = toWorld(d[0] - 0.01, d[1]);
          const w1 = toWorld(d[0] + 0.01, d[1]);
          pushSeg(w0, w1, d[2] * 2, shape.alpha);
        }
      }
      for (const inst of a.dynList) {
        for (const layer of ['back', 'front']) {
          const ps = dynSimulate(inst, (a.marksN || a.marksDir) ? { ...a.tile, marksN: a.marksN, marksDir: a.marksDir } : a.tile, frameIdx, FRAME_RATE, layer, a.part.key);
          const target = layer === 'back' ? backVerts : frontVerts;
          for (const pt of ps) {
            const gx = pt.x * a.dsx, gy = pt.y * a.dsy;
            const wdx0 = (pt.dirX ?? 1) * c + (pt.dirY ?? 0) * s;
            const wdy0 = (pt.dirX ?? 1) * s - (pt.dirY ?? 0) * c;
            const wl = Math.hypot(wdx0, wdy0) || 1;
            pushParticleQuadShaped(target, a.ctr[0] + gx * c + gy * s, a.ctr[1] + gx * s - gy * c, pt.size, particleRgb(pt.color), pt.alpha, pt.shape, wdx0 / wl, wdy0 / wl);
          }
        }
        // 环绕光点（Jeff 落地）：身前层一次；world 基准时先用部件
        // 旋转的自逆变换把椭圆点预转回本地（变换矩阵 [[c,s],[s,−c]]
        // 自逆，预转与放置两次同变换相消，椭圆恒对世界）
        if (inst.params.orbitEnabled) {
          const opts = dynOrbitPoints(inst.params, frameIdx / FRAME_RATE, 0);
          const orgb = particleRgb(dynPostColorAt(inst.params, inst.params.orbitColor || '#aee6ff'));
          for (const q of opts) {
            let qx = q.x * a.dsx, qy = q.y * a.dsy;
            if (inst.params.orbitAngleSpace === 'world') {
              const rx = qx * c + qy * s, ry = qx * s - qy * c;
              qx = rx; qy = ry;
            }
            pushParticleQuad(frontVerts, a.ctr[0] + qx * c + qy * s, a.ctr[1] + qx * s - qy * c, inst.params.orbitSize || 3, orgb, 0.95);
          }
        }
        // 环境场（乙9）：区域样本（落/游/涟漪），样本绕插头成
        // 区域分布、不依附精灵轮廓；涟漪环以椭圆折线段绘制
        if (inst.params.envEnabled) {
          const env = dynEnvSamples(inst.params, frameIdx / FRAME_RATE);
          const ergb = particleRgb(dynPostColorAt(inst.params, inst.params.envColor || '#bcd8ff'));
          const toW = (lx, ly) => {
            const gx = lx * a.dsx, gy = ly * a.dsy;
            return [a.ctr[0] + gx * c + gy * s, a.ctr[1] + gx * s - gy * c];
          };
          for (const q of env.quads) {
            const wpt = toW(q[0], q[1]);
            const wdx = q[4] * c + q[5] * s, wdy = q[4] * s - q[5] * c;
            const wl = Math.hypot(wdx, wdy) || 1;
            pushParticleQuadShaped(frontVerts, wpt[0], wpt[1], q[2], ergb, q[6], q[3] === 1 ? 'line' : 'dot', wdx / wl, wdy / wl);
          }
          const pushEnvSeg = (w0, w1, alpha) => {
            const dx = w1[0] - w0[0], dy = w1[1] - w0[1];
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len * 0.5, ny = dx / len * 0.5;
            const cs = [
              [w0[0] + nx, w0[1] + ny], [w1[0] + nx, w1[1] + ny],
              [w1[0] - nx, w1[1] - ny], [w0[0] - nx, w0[1] - ny],
            ];
            const locals = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
            for (const oi of [0, 1, 2, 0, 2, 3]) {
              frontVerts.push(cs[oi][0], cs[oi][1], locals[oi][0], locals[oi][1], ergb[0], ergb[1], ergb[2], alpha, 0);
            }
          };
          for (const rg of env.rings) {
            if (rg[3] <= 0.004) continue;
            const N = 14;
            let prev = null;
            for (let vi = 0; vi <= N; vi++) {
              const th = (vi / N) * Math.PI * 2;
              const wpt = toW(rg[0] + Math.cos(th) * rg[2], rg[1] + Math.sin(th) * rg[2] * 0.38);
              if (prev) pushEnvSeg(prev, wpt, rg[3]);
              prev = wpt;
            }
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
  // ---- 像素链执行（先于蒙皮）：部件当前精灵网格逐帧过链，结果
  // 回写底图图集（RGB+A）+ 主图集 R 占据（2=实心、255=外部，与
  // spriteTileOf 同编码）。源网格取图集条目里的当帧精灵（服装集
  // 覆盖/变体替代已在条目里定格），镜像变体先翻成显示朝向——与
  // 编辑器喂 evaluateBlueprint 的显示网格同口径。链是 (源网格,
  // 帧) 的纯函数：每帧从干净源重算，两张图集的回写逐帧全量覆
  // 盖精灵矩形，不需要还原登记。断链输出空网格 = 精灵矩形清空
  // （编辑器 screen 空网格上屏同义）。
  if (pixelJobs.length > 0) {
    const pframe = elapsed * FRAME_RATE;
    if (!state.pixelState) state.pixelState = new Map();
    for (const job of pixelJobs) {
      const pg = job.part.pixelGraph;
      let srcGrid = job.grid.data;
      if (job.mirrored) srcGrid = srcGrid.map((row) => row.slice().reverse());
      let outGrid = null;
      try {
        outGrid = evalPixelChain(pg.nodes, pg.out, {
          pixels: srcGrid, frame: pframe, frameRate: FRAME_RATE,
          nodeState: state.pixelState, statePrefix: job.part.key,
        });
      } catch (e) { outGrid = null; }
      if (!outGrid) continue;
      const gw = job.grid.w, gh = job.grid.h;
      const baseBuf = new Uint8Array(gw * gh * 4);
      const occBuf = new Uint8Array(gw * gh * 4);
      for (let q = 0; q < gw * gh; q++) { occBuf[q * 4] = 255; occBuf[q * 4 + 3] = 255; }
      for (let yy = 0; yy < gh; yy++) {
        const orow = outGrid[yy] || [];
        for (let xx = 0; xx < gw; xx++) {
          const c = xx < orow.length ? orow[xx] : null;
          if (!c) continue;
          const rgb = parseHexRt(c);
          if (!rgb) continue;
          const o = (yy * gw + xx) * 4;
          baseBuf[o] = rgb[0]; baseBuf[o + 1] = rgb[1]; baseBuf[o + 2] = rgb[2]; baseBuf[o + 3] = 255;
          occBuf[o] = 2;
        }
      }
      const off = 2 + job.tileExtra;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, state.baseTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, job.place[0] + off, job.place[1] + off, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, baseBuf);
      gl.bindTexture(gl.TEXTURE_2D, state.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, job.place[0] + off, job.place[1] + off, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, occBuf);
    }
  }
  // ---- 网格蒙皮执行（缺口 4）：按子/父世界角差变形当前瓦片并回传
  // 图集（每帧从干净瓦片数据重算，不累积）。角的换算：运行时世界角
  // （y 向上、逆时针为正）→ 编辑器关节角（画布口径）取负；精灵族
  // 瓦片行序自顶向下与编辑器同空间直接用，参数化族行序自底向上再翻
  // 一次符号。发光/底图两张副图集不跟随变形（已知近似）。
  // 先把上一帧变形过的图集区域还原为干净瓦片（变形不累积、角回
  // 零即恢复原图），再执行本帧变形并登记。
  if (skinJobs.length > 0 || (state.skinDirty && state.skinDirty.size > 0)) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.tex);
    if (state.skinDirty) {
      for (const rec of state.skinDirty.values()) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, rec.place[0], rec.place[1], rec.tile.w, rec.tile.h, gl.RGBA, gl.UNSIGNED_BYTE, rec.tile.data);
      }
      state.skinDirty.clear();
    } else state.skinDirty = new Map();
  }
  for (const job of skinJobs) {
    const skinPart = PARTS.find((pp) => pp.key === job.key);
    const childEl = elByKey.get(job.key);
    const parentEl = skinPart ? elByKey.get(skinPart.skin.parent) : undefined;
    if (!skinPart || !childEl || !parentEl) continue;
    let dRot = childEl.rot - parentEl.rot;
    while (dRot > Math.PI) dRot -= Math.PI * 2;
    while (dRot < -Math.PI) dRot += Math.PI * 2;
    if (Math.abs(dRot) < 0.0002) continue;
    const tileAngle = job.family ? -dRot : dRot;
    const warped = skinWarpTile(job.tile.data, job.tile.w, job.tile.h, job.plugX, job.plugY, tileAngle, skinPart.skin.radius, skinPart.skin.curve);
    if (warped) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, job.place[0], job.place[1], job.tile.w, job.tile.h, gl.RGBA, gl.UNSIGNED_BYTE, warped);
      state.skinDirty.set(job.place[0] + ',' + job.place[1], { tile: job.tile, place: job.place });
    }
  }
  // ---- 团块/火焰场作业执行：逐帧栅格重传底图图集槽内区 ----
  if (fieldJobs.length > 0) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.baseTex);
    for (const job of fieldJobs) {
      const raster = fieldRasterFor(job.params, job.kind, elapsed, job.dsx, job.dsy, job.mir, job.slot);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, job.slot.place[0] + 2, job.slot.place[1] + 2, job.slot.innerW, job.slot.innerH, gl.RGBA, gl.UNSIGNED_BYTE, raster);
    }
  }
  // ---- 堆叠层变换执行：主导表演的烘焙算子逐帧栅格化进瓦片（掩码
  // 图集 + 底图图集同格回传，与网格蒙皮同一回传模式）；上一帧改过
  // 的区域先还原干净瓦片（不累积、无表演主导时即回落静止图） ----
  if (stackJobs.length > 0 || (state.stackDirty && state.stackDirty.size > 0)) {
    if (state.stackDirty) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, state.tex);
      for (const rec of state.stackDirty.values()) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, rec.place[0], rec.place[1], rec.tile.w, rec.tile.h, gl.RGBA, gl.UNSIGNED_BYTE, rec.mask);
      }
      gl.bindTexture(gl.TEXTURE_2D, state.baseTex);
      for (const rec of state.stackDirty.values()) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, rec.place[0], rec.place[1], rec.tile.w, rec.tile.h, gl.RGBA, gl.UNSIGNED_BYTE, rec.base);
      }
      state.stackDirty.clear();
    } else state.stackDirty = new Map();
  }
  for (const job of stackJobs) {
    const part = job.part;
    const sg = part.sprite;
    if (!sg) continue;
    const rgba = stackRasterizeFrame(job.ops, stackLayerRgba(part), sg.w, sg.h);
    const tile = job.tile;
    const ox = Math.round(tile.cx - sg.plug[0]), oy = Math.round(tile.cy - sg.plug[1]);
    const mask = new Uint8Array(tile.w * tile.h * 4);
    const base = new Uint8Array(tile.w * tile.h * 4);
    for (let q = 0; q < tile.w * tile.h; q++) { mask[q * 4] = 255; mask[q * 4 + 3] = 255; }
    let any = false;
    for (let y = 0; y < sg.h; y++) {
      for (let x = 0; x < sg.w; x++) {
        const so = (y * sg.w + x) * 4;
        if (rgba[so + 3] <= 0) continue;
        const tx = x + ox, ty = y + oy;
        if (tx < 0 || ty < 0 || tx >= tile.w || ty >= tile.h) continue;
        const to = (ty * tile.w + tx) * 4;
        mask[to] = 2; mask[to + 3] = 255;
        base[to] = rgba[so]; base[to + 1] = rgba[so + 1]; base[to + 2] = rgba[so + 2]; base[to + 3] = 255;
        any = true;
      }
    }
    if (!any) continue;
    const dkey = job.place[0] + ',' + job.place[1];
    if (!state.stackDirty.has(dkey)) {
      state.stackDirty.set(dkey, { tile: tile, place: job.place, mask: tile.data, base: stackCleanBase(part, tile) });
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, job.place[0], job.place[1], tile.w, tile.h, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    gl.bindTexture(gl.TEXTURE_2D, state.baseTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, job.place[0], job.place[1], tile.w, tile.h, gl.RGBA, gl.UNSIGNED_BYTE, base);
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
  // 残影段（D5）：动态实例驱动的部件快照环。快照在裁剪面与表演
  // 残影都处理完之后取（el 已定稿）；ghosts 排在活 el 之前，
  // 以残影色剪影绘制（ghost 标志，与表演残影同一渲染口径）。
  {
    const epoch = char.variant + '|' + currentCostume;
    if (trailState.epoch !== epoch || elapsed < trailState.lastElapsed - 0.01) {
      trailState.epoch = epoch;
      trailState.rings.clear();
    }
    trailState.lastElapsed = elapsed;
    for (const a of dynAnchors) {
      let tp = null;
      for (const x of a.dynList) { if (x.params && x.params.trailEnabled) { tp = x.params; break; } }
      if (!tp) continue;
      const live = elByKey.get(a.part.key);
      if (!live) continue;
      let ring = trailState.rings.get(a.part.key);
      if (!ring) { ring = { last: -1, snaps: [] }; trailState.rings.set(a.part.key, ring); }
      const interval = Math.max(0.02, tp.trailIntervalSec || 0.06);
      const count = Math.max(1, Math.min(6, Math.round(tp.trailCount || 3)));
      if (ring.last < 0 || elapsed - ring.last >= interval) {
        ring.last = elapsed;
        ring.snaps.push({ el: Object.assign({}, live), born: elapsed });
        if (ring.snaps.length > count) ring.snaps.shift();
      }
      const ghosts = ring.snaps
        .filter((s) => s.born < elapsed && elapsed - s.born < interval * count * 1.8)
        .map((s) => Object.assign({}, s.el, { ghost: true }));
      if (ghosts.length) els.splice(els.indexOf(live), 0, ...ghosts);
    }
  }
  // 画布级特效（缺口 5）：工程级按时间线帧（循环）、片段级按段表演
  // 本地帧换算的绝对帧；生成的顶点进 frontVerts，与场景一并受全局
  // 变换（编辑器同一层级）。afterimage 笔触的采样以部件瓦片 alpha
  // 近似编辑器的画布采样。
  {
    const occAt = (wx, wy) => {
      for (const [key, el] of elByKey) {
        const entry = state.map.get(key);
        if (!entry || !entry.tile || !entry.tile.data) continue;
        const tile = entry.tile;
        const dx = wx - el.pos[0], dy = wy - el.pos[1];
        const c = Math.cos(el.rot), s = Math.sin(el.rot);
        const gx = c * dx + s * dy, gy = s * dx - c * dy;
        const px = Math.round(gx + tile.cx), py = Math.round(tile.cy - gy);
        if (px < 0 || py < 0 || px >= tile.w || py >= tile.h) continue;
        if (tile.data[(py * tile.w + px) * 4 + 3] > 8) return true;
      }
      return false;
    };
    if (FX) {
      const total = Math.max(1, FX.totalFrames || 1);
      fxRenderSet(FX, Math.floor(elapsed * FRAME_RATE) % total, frontVerts, occAt);
    }
    for (const act of activePerfs) {
      if (act.perf.fx) fxRenderSet(act.perf.fx, (act.perf.fxStart || 0) + Math.floor(act.t * FRAME_RATE), frontVerts, occAt);
    }
  }
  // 全局变换（缺口 3）：与编辑器 applyGlobalTransformWrapper 同口径——
  // 整场绕中心平移/旋转/缩放。枢轴取角色原点（编辑器取画布中心，角色
  // 在编辑器画布中的位置不定，此为对应近似）；部件实例与粒子/弧线
  // 顶点一并变换，背景场景为模板自带、不在包内，不变换。
  if (GLOBAL_GRAPH) {
    const gout = evalRuntimeGraph(GLOBAL_GRAPH, {
      tSec: elapsed, vars: hostVars, nodeState: globalGraphState,
      nodeOutputs: new Map(), statePrefix: 'gl:',
    });
    const grec = gout.get('__global');
    if (grec) {
      const gtx = grec.dx || 0, gty = grec.dy || 0, grot = grec.angle || 0;
      const gsx = grec.scaleX ?? 1, gsy = grec.scaleY ?? 1;
      if (gtx !== 0 || gty !== 0 || grot !== 0 || gsx !== 1 || gsy !== 1) {
        const px = char.x, py = char.y;
        const gc = Math.cos(grot), gs = Math.sin(grot);
        const gPt = (x, y) => {
          const lx = (x - px) * gsx, ly = (y - py) * gsy;
          return [px + lx * gc - ly * gs + gtx, py + lx * gs + ly * gc + gty];
        };
        for (const el of els) {
          const np = gPt(el.pos[0], el.pos[1]);
          el.pos[0] = np[0]; el.pos[1] = np[1];
          el.rot += grot;
          el.size[0] *= gsx; el.size[1] *= gsy;
        }
        for (const verts of [backVerts, frontVerts]) {
          for (let i = 0; i + 1 < verts.length; i += 9) {
            const np = gPt(verts[i], verts[i + 1]);
            verts[i] = np[0]; verts[i + 1] = np[1];
          }
        }
      }
    }
  }
  // 相机：指数平滑跟随（速率 PHYS.camFollow），横/纵可锁定；俯视跟平面点
  const camTX = char.x;
  const camTY = moveMode === 'top' ? char.py : 52 + char.y * 0.35;
  if (camState.snap) { camState.x = camTX; camState.y = camTY; camState.snap = false; }
  const camK = 1 - Math.exp(-PHYS.camFollow * dt);
  if (!PHYS.camLockX) camState.x += (camTX - camState.x) * camK;
  if (!PHYS.camLockY) camState.y += (camTY - camState.y) * camK;
  const camX = camState.x, camY = camState.y;
  // 画布修改轨（缺口 5-2）：本帧生效的修改器链（工程轨 + 各活跃段
  // 表演的片段轨）；非空时场景改画进后处理目标，帧末跑全屏链。
  const postList = [];
  if (FX) {
    const total = Math.max(1, FX.totalFrames || 1);
    fxCollectCanvasMods(FX, Math.floor(elapsed * FRAME_RATE) % total, postList);
  }
  for (const act of activePerfs) {
    if (act.perf.fx) fxCollectCanvasMods(act.perf.fx, (act.perf.fxStart || 0) + Math.floor(act.t * FRAME_RATE), postList);
  }
  if (postList.length > 0) {
    const sys = ensurePostSys();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sys.A.fbo);
  }
  gl.viewport(0, 0, lowW, VIEW_H);
  gl.clearColor(0.070, 0.070, 0.157, 1);
  gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(solidProg);
  gl.uniform2f(solidU.cam, camX, camY);
  gl.uniform2f(solidU.vh, visW() / 2, visH() / 2);
  gl.bindVertexArray(solidVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, solidBuf);
  if (bgTex) drawBackground(camX, camY);
  const sc = buildScenery(camX);
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
  gl.uniform2f(partU.vh, visW() / 2, visH() / 2);
  gl.uniform2f(partU.res, lowW, VIEW_H);
  gl.uniform1f(partU.zoom, viewZoom);
  gl.uniform1f(partU.time, elapsed);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state.tex); gl.uniform1i(partU.atlas, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, palTex); gl.uniform1i(partU.pal, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, state.baseTex); gl.uniform1i(partU.base, 2);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, state.glowTex); gl.uniform1i(partU.glow, 3);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, glowSideTex); gl.uniform1i(partU.glowSide, 4);
  if (els.length > 0) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, GLOW_TEXELS, els.length, 0, gl.RGBA, gl.FLOAT, packGlowSidecar(els));
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
    gl.uniform2f(solidU.vh, visW() / 2, visH() / 2);
    gl.bindVertexArray(solidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, solidBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(frontVerts), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, frontVerts.length / 9);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
  if (postList.length > 0) fxRunPostChain(postList, state, elByKey, camX, camY);
  if (recPendingFrame) {
    recPendingFrame.variant = char.variant;
    recPendingFrame.locked = char.lockedVariant;
    recPendingFrame.costume = currentCostume;
    recPendingFrame.aw = autoWalk ? 1 : 0;
    rec.frames.push(recPendingFrame);
    recPendingFrame = null;
    refreshRecPanel();
  }
  if (replay.active && replay.gif) gifCaptureFrame(dt);
  requestAnimationFrame(frame);
}
// ---------- 硬重锁（D6 乙路，运行时语义已定）：清 sim 状态 +
// anchorState，把内部帧位设到 frameIndex（elapsed = 帧/帧率；
// 表演 act.t 等按现行表演时间口径保持不变），sim 状态在下一帧
// 模拟遍以 frameIndex 当帧 pose 零初速重建。理由：运行时 pose
// 不是帧的纯函数（物理 char 位置、状态机、输入都在环内），历史
// pose 无从重演，运行时能做的重锁只有现帧重建；编辑器侧 scrub
// 的快照顺演不受影响。audio 大漂移、宿主 seek 与重锁共用此
// 路径，window 上暴露供宿主调用。
function hardRelockTo(frameIndex) {
  if (frameIndex < 0) frameIndex = 0;
  simStates.clear();
  anchorState.clear();
  elapsed = frameIndex / FRAME_RATE;
  simSteppedElapsed = elapsed;
}
window.hardRelockTo = hardRelockTo;
requestAnimationFrame(frame);
</script>
</body>
</html>`;
