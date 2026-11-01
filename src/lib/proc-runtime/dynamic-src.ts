// ============================================================
// 动态模式运行时源（单一源 JS 字符串）：注入运行时模板使用，
// 探针经 createDynamicRuntime() 加载校验。与产品侧
// dynamic-patterns.ts / dynamic-pattern-sim.ts 是孪生实现
// （同 eval-src 与 eval.ts 的关系），关键数值由探针 L 组对齐。
// 差异：模拟在瓦片空间跑（轮廓从瓦片 R 通道占据读，坐标 =
// 瓦片像素相对 (cx, cy)、y 向下）——模板里的瓦片已含镜像
// 几何，故无镜像翻转（产品侧画布是预翻转绘制才需要翻 x）。
// 种子与产品同源：seedKey（部件键）+ 实例 id；帧量化基数由
// 调用方传包帧率（EMBEDDED.frameRate），与编辑器同口径。
// ============================================================

export const DYNAMIC_SRC = `
function dynHash01(a, b, c, d) {
  let h = 2166136261;
  const mix = (n) => { if (n === undefined) return; h ^= (n | 0) + 0x9e3779b9; h = Math.imul(h ^ (h >>> 15), 16777619); };
  mix(a); mix(b); mix(c); mix(d);
  h ^= h >>> 13; h = Math.imul(h, 16777619); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function dynHash01N(...ns) {
  let h = 2166136261;
  for (let i = 0; i < ns.length; i++) { const n = ns[i]; h ^= (n | 0) + 0x9e3779b9; h = Math.imul(h ^ (h >>> 15), 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 16777619); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function dynSeedOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
function dynDeformAt(params, tSec) {
  if (!params.deformEnabled) return { sx: 1, sy: 1, amount: 0 };
  const p = (Math.sin(2 * Math.PI * (params.deformHz * tSec + params.deformPhase)) + 1) / 2;
  return {
    sx: 1 + (params.stretchX - 1) * p,
    sy: 1 + (params.squashY - 1) * p,
    amount: p,
  };
}
function dynNoiseU(u, v, period, seed) {
  const xi = Math.floor(u), yi = Math.floor(v);
  const xf = u - xi, yf = v - yi;
  const su = xf * xf * (3 - 2 * xf), sv = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period, x1 = (x0 + 1) % period;
  const a = dynHash01(x0, yi, seed), b = dynHash01(x1, yi, seed);
  const c = dynHash01(x0, yi + 1, seed), d = dynHash01(x1, yi + 1, seed);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
const DYN_DISPLACE_PERIOD = 8;
function dynDisplaceSrcMap(params, w, h, phase) {
  const out = new Int32Array(w * h);
  const amp = params.displaceEnabled ? Math.max(0, params.displaceAmp || 0) : 0;
  if (amp <= 0) {
    for (let i = 0; i < w * h; i++) out[i] = i;
    return out;
  }
  const f = Math.max(0.005, params.displaceFreq || 0.12);
  const rad = ((params.displaceDeg || 0) * Math.PI) / 180;
  const dirX = Math.cos(rad), dirY = Math.sin(rad);
  const K = DYN_DISPLACE_PERIOD;
  const ph = ((phase % 1) + 1) % 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x * dirX + y * dirY;
      const v = -x * dirY + y * dirX;
      const n1 = dynNoiseU(u * f + ph * K, v * f, K, 7717);
      const n2 = dynNoiseU(u * f * 1.7 + ph * K * 2, v * f * 1.7 + 13.31, K, 31337);
      const a = (n1 - 0.5) * 2 * amp;
      const b = (n2 - 0.5) * 2 * amp * 0.5;
      const dx = dirX * a - dirY * b;
      const dy = dirY * a + dirX * b;
      const sx = Math.round(x - dx), sy = Math.round(y - dy);
      out[y * w + x] = sx < 0 || sy < 0 || sx >= w || sy >= h ? -1 : sy * w + sx;
    }
  }
  return out;
}
function dynSpinRadAt(params, tSec) {
  if (!params.spinEnabled) return 0;
  return ((params.spinSpeedDeg || 0) * tSec + (params.spinPhaseDeg || 0)) * Math.PI / 180;
}
// 弧线段（D4 一期）孪生：与 dynamic-patterns.ts 的 arcPointsAt /
// arcDisplaceLine 逐点同式（点以 [x, y, w] 数组返回）
function dynArcDisplaceLine(x0, y0, x1, y1, disp, levels, seed, step, kStart) {
  let pts = [[x0, y0], [x1, y1]];
  let k = kStart;
  for (let lv = 0; lv < levels; lv++) {
    const next = [pts[0]];
    const decay = Math.pow(0.72, lv);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const segLen = Math.hypot(dx, dy) || 1;
      const off = (dynHash01(seed, step, k++) - 0.5) * segLen * disp * decay;
      next.push([(a[0] + b[0]) / 2 + (-dy / segLen) * off, (a[1] + b[1]) / 2 + (dx / segLen) * off]);
      next.push(b);
    }
    pts = next;
  }
  return { pts: pts, k: k };
}
function dynArcGrowFrac(p, tSec) {
  if (!(p.arcGrowHz > 0)) return 1;
  const ph = ((Math.max(0, tSec) * p.arcGrowHz) % 1 + 1) % 1;
  const f = Math.min(1, ph / 0.7);
  return f * f * (3 - 2 * f);
}
function dynArcClip(pts, frac) {
  if (frac >= 1 || pts.length < 2) return pts;
  if (frac <= 0) return pts.slice(0, 1);
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  let want = total * frac;
  const out = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (want >= seg) { out.push(b); want -= seg; continue; }
    const f = seg > 0 ? want / seg : 0;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    break;
  }
  return out;
}
function dynArcPoints(params, tSec, endX, endY, hasEnd) {
  const p = params;
  const step = p.arcFlicker > 0 ? Math.floor(Math.max(0, tSec) * p.arcFlicker) : 0;
  const dir = (p.arcDirDeg * Math.PI) / 180;
  const grow = dynArcGrowFrac(p, tSec);
  const alpha = p.arcFlicker > 0 ? 0.55 + 0.45 * dynHash01(p.arcSeed, step, 999) : 0.9;
  if (p.arcMode === 'vine') {
    const segLen = 6;
    const segs = Math.max(2, Math.round(p.arcLengthPx / segLen));
    const pts = [[0, 0, p.arcWidthPx]];
    let cx = 0, cy = 0, ang = dir;
    for (let i = 1; i <= segs; i++) {
      ang += (dynHash01(p.arcSeed, 0, 500 + i) - 0.5) * 0.55;
      cx += Math.cos(ang) * segLen; cy += Math.sin(ang) * segLen;
      pts.push([cx, cy, Math.max(0.15, p.arcWidthPx * (1 - 0.6 * (i / segs)))]);
    }
    const leaves = p.arcDetail > 0 ? p.arcDetail : 5;
    const dots = [];
    for (let j = 0; j < leaves; j++) {
      const s = 0.15 + 0.8 * ((j + 0.5) / leaves);
      const fi = s * segs;
      const i0 = Math.min(segs - 1, Math.floor(fi));
      const fr = fi - i0;
      const qx = pts[i0][0] + (pts[i0 + 1][0] - pts[i0][0]) * fr;
      const qy = pts[i0][1] + (pts[i0 + 1][1] - pts[i0][1]) * fr;
      const side = dynHash01(p.arcSeed, 0, 700 + j) < 0.5 ? -1 : 1;
      const off = 2 + 2.5 * dynHash01(p.arcSeed, 0, 720 + j);
      const nx = -(pts[i0 + 1][1] - pts[i0][1]), ny = pts[i0 + 1][0] - pts[i0][0];
      const nl = Math.hypot(nx, ny) || 1;
      if (s <= grow) dots.push([qx + (nx / nl) * off * side, qy + (ny / nl) * off * side, 1.5]);
    }
    return { main: dynArcClip(pts, grow), branches: [], dots: dots, alpha: alpha };
  }
  if (p.arcMode === 'stars') {
    const count = p.arcDetail > 0 ? p.arcDetail : 6;
    const raw = [];
    for (let i = 0; i < count; i++) {
      const rr = p.arcLengthPx * Math.sqrt(dynHash01(p.arcSeed, 0, 300 + i));
      const th = dynHash01(p.arcSeed, 0, 340 + i) * Math.PI * 2;
      raw.push([Math.cos(th) * rr, Math.sin(th) * rr, rr]);
    }
    const order = [0];
    const seen = new Set([0]);
    while (order.length < count) {
      const last = raw[order[order.length - 1]];
      let best = -1, bestD = Infinity;
      for (let i = 0; i < count; i++) {
        if (seen.has(i)) continue;
        const d = Math.hypot(raw[i][0] - last[0], raw[i][1] - last[1]);
        if (d < bestD) { bestD = d; best = i; }
      }
      order.push(best); seen.add(best);
    }
    const mainFull = order.map((i) => [raw[i][0], raw[i][1], Math.max(0.3, p.arcWidthPx * 0.7)]);
    const dots = order
      .filter((i) => raw[i][2] <= p.arcLengthPx * grow + 1e-6)
      .map((i) => [raw[i][0], raw[i][1], 1.3 + 1.1 * dynHash01(p.arcSeed, step, 380 + i)]);
    return { main: dynArcClip(mainFull, grow), branches: [], dots: dots, alpha: alpha };
  }
  if (p.arcMode === 'beam') {
    const ex = hasEnd ? endX : Math.cos(dir) * p.arcLengthPx;
    const ey = hasEnd ? endY : Math.sin(dir) * p.arcLengthPx;
    const len = Math.hypot(ex, ey) || 1;
    const ux = ex / len, uy = ey / len;
    const nx = -uy, ny = ux;
    const SEG = 6;
    const mainFull = [];
    for (let i = 0; i <= SEG; i++) {
      const sf = i / SEG;
      mainFull.push([ux * len * sf, uy * len * sf, Math.max(0.2, p.arcWidthPx * (2.6 - 1.5 * sf))]);
    }
    const drift = (dynHash01(p.arcSeed, step, 950) - 0.5) * 2.4;
    const branches = [];
    for (const sideSign of [-1, 1]) {
      const off = sideSign * p.arcWidthPx * 1.05 + drift * 0.4;
      const line = [];
      for (let i = 0; i <= SEG; i++) {
        const sf = 0.06 + 0.9 * (i / SEG);
        line.push([ux * len * sf + nx * off, uy * len * sf + ny * off, Math.max(0.15, p.arcWidthPx * 0.5)]);
      }
      branches.push(dynArcClip(line, grow));
    }
    const dots = [[0, 0, p.arcWidthPx * 2.2]];
    if (grow >= 0.9) {
      for (let j = 0; j < 4; j++) {
        const a = dynHash01(p.arcSeed, step, 960 + j) * Math.PI * 2;
        const rr = p.arcWidthPx * (0.8 + 1.6 * dynHash01(p.arcSeed, step, 970 + j));
        dots.push([ex + Math.cos(a) * rr, ey + Math.sin(a) * rr, 1.1 + dynHash01(p.arcSeed, step, 980 + j) * 1.3]);
      }
    }
    return { main: dynArcClip(mainFull, grow), branches: branches, dots: dots, alpha: alpha };
  }
  if (p.arcMode === 'glyph') {
    const R = Math.max(4, p.arcLengthPx);
    const rot = dir + (((p.arcGlyphSpinDeg ?? 12)) * tSec * Math.PI) / 180;
    const rc = Math.cos(rot), rs = Math.sin(rot);
    const rotPt = (x, y, w) => [x * rc - y * rs, x * rs + y * rc, w];
    const circle = (rad, n, w) => {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push(rotPt(Math.cos(a) * rad, Math.sin(a) * rad, w));
      }
      return pts;
    };
    const strokes = [];
    strokes.push(circle(R, 40, p.arcWidthPx));
    strokes.push(circle(R * 0.72, 32, Math.max(0.15, p.arcWidthPx * 0.7)));
    const starOrder = [0, 2, 4, 1, 3, 0];
    strokes.push(starOrder.map((vi) => {
      const a = -Math.PI / 2 + vi * (Math.PI * 2 / 5);
      return rotPt(Math.cos(a) * R * 0.72, Math.sin(a) * R * 0.72, Math.max(0.15, p.arcWidthPx * 0.8));
    }));
    const ticks = p.arcDetail > 0 ? p.arcDetail : 12;
    for (let j = 0; j < ticks; j++) {
      const a = (j / ticks) * Math.PI * 2;
      const w = Math.max(0.12, p.arcWidthPx * 0.6);
      strokes.push([rotPt(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88, w), rotPt(Math.cos(a) * R, Math.sin(a) * R, w)]);
    }
    const lens = strokes.map((ln) => {
      let L = 0;
      for (let i = 0; i + 1 < ln.length; i++) L += Math.hypot(ln[i + 1][0] - ln[i][0], ln[i + 1][1] - ln[i][1]);
      return L;
    });
    const total = lens.reduce((a, b) => a + b, 0);
    let budget = grow * total;
    const shown = [];
    for (let si = 0; si < strokes.length; si++) {
      if (budget <= 0) break;
      shown.push(dynArcClip(strokes[si], Math.min(1, budget / Math.max(0.0001, lens[si]))));
      budget -= lens[si];
    }
    const dots = [];
    const runes = 6;
    for (let j = 0; j < runes; j++) {
      if (grow < 0.5 + 0.5 * ((j + 0.5) / runes)) continue;
      const a = dynHash01(p.arcSeed, 0, 990 + j) * Math.PI * 2;
      const q = rotPt(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86, 0);
      dots.push([q[0], q[1], 1.3]);
    }
    return {
      main: shown.length ? shown[0] : [[0, 0, p.arcWidthPx]],
      branches: shown.slice(1),
      dots: dots, alpha: alpha,
    };
  }
  if (p.arcMode === 'stream') {
    const ex = hasEnd ? endX : Math.cos(dir) * p.arcLengthPx;
    const ey = hasEnd ? endY : Math.sin(dir) * p.arcLengthPx;
    const len = Math.hypot(ex, ey) || 1;
    const ux = ex / len, uy = ey / len;
    const nx = -uy, ny = ux;
    const bow = (dynHash01(p.arcSeed, 0, 960) - 0.5) * len * 0.18;
    const SEG = 12;
    const ptAt = (sf) => {
      const bend = Math.sin(sf * Math.PI) * bow;
      return [ux * len * sf + nx * bend, uy * len * sf + ny * bend];
    };
    const mainFull = [];
    for (let i = 0; i <= SEG; i++) {
      const sf = i / SEG;
      const q = ptAt(sf);
      mainFull.push([q[0], q[1], Math.max(0.15, p.arcWidthPx * (1 - 0.65 * sf))]);
    }
    const beads = p.arcDetail > 0 ? p.arcDetail : 6;
    const dots = [];
    for (let j = 0; j < beads; j++) {
      const sf = ((j / beads) + tSec * (p.arcFlowHz ?? 0.6)) % 1;
      if (sf > grow) continue;
      const q = ptAt(sf);
      dots.push([q[0], q[1], Math.max(0.5, p.arcWidthPx * (0.85 + 0.45 * Math.sin(sf * Math.PI)))]);
    }
    return { main: dynArcClip(mainFull, grow), branches: [], dots: dots, alpha: alpha };
  }
  if (p.arcMode === 'ring') {
    // 环带孪生（与 arcPointsAt 同式）：main = 圆心哨点；
    // branches[0] = 后半环（本地 y<0)、branches[1] = 前半环
    const R = Math.max(4, p.arcLengthPx) * grow;
    const tilt = Math.max(0.16, Math.min(1, p.arcTilt || 0.35));
    const cd = Math.cos(dir), sd = Math.sin(dir);
    const N = 28;
    const back = [];
    const front = [];
    for (let i = 0; i <= N; i++) {
      const a = Math.PI + (i / N) * Math.PI;
      const exx = Math.cos(a) * R, eyy = Math.sin(a) * R * tilt;
      back.push([exx * cd - eyy * sd, exx * sd + eyy * cd, p.arcWidthPx]);
    }
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI;
      const exx = Math.cos(a) * R, eyy = Math.sin(a) * R * tilt;
      front.push([exx * cd - eyy * sd, exx * sd + eyy * cd, p.arcWidthPx]);
    }
    const ringAlpha = p.arcGrowHz > 0 ? alpha * (1 - grow) : alpha;
    return { main: [[0, 0, p.arcWidthPx]], branches: [back, front], dots: [], alpha: ringAlpha };
  }
  if (p.arcMode === 'fan') {
    // 扇面孪生（与 arcPointsAt 同式）：main = 填充边界
    // [原点， 弦置换链 A→B, 原点]，w = 径向占比
    const half = ((p.arcFanDeg || 70) * Math.PI) / 360;
    const L = Math.max(4, p.arcLengthPx);
    const ax = Math.cos(dir - half) * L, ay = Math.sin(dir - half) * L;
    const bx = Math.cos(dir + half) * L, by = Math.sin(dir + half) * L;
    const chain = dynArcDisplaceLine(ax, ay, bx, by, p.arcDisplace * 2, 4, p.arcSeed, step, 0);
    const boundary = [[0, 0, 0]];
    for (const q of chain.pts) {
      boundary.push([q[0], q[1], Math.max(0, Math.min(1, Math.hypot(q[0], q[1]) / L))]);
    }
    boundary.push([0, 0, 0]);
    return { main: dynArcClip(boundary, grow), branches: [], dots: [], alpha: alpha };
  }
  const ex = hasEnd ? endX : Math.cos(dir) * p.arcLengthPx;
  const ey = hasEnd ? endY : Math.sin(dir) * p.arcLengthPx;
  const mainLen = Math.hypot(ex, ey);
  const disp = p.arcDisplace * 2;
  const main0 = dynArcDisplaceLine(0, 0, ex, ey, disp, 4, p.arcSeed, step, 0);
  const n = main0.pts.length;
  const mainFull = main0.pts.map((q, i) => [q[0], q[1], Math.max(0.15, p.arcWidthPx * (1 - 0.72 * (i / (n - 1))))]);
  const branches = [];
  let k = main0.k;
  for (let b = 0; b < p.arcBranches; b++) {
    const s = 0.25 + 0.55 * dynHash01(p.arcSeed, step, k++);
    if (s > grow) { k += 3; continue; }
    const fi = s * (n - 1);
    const i0 = Math.min(n - 2, Math.floor(fi));
    const fr = fi - i0;
    const bx = main0.pts[i0][0] + (main0.pts[i0 + 1][0] - main0.pts[i0][0]) * fr;
    const by = main0.pts[i0][1] + (main0.pts[i0 + 1][1] - main0.pts[i0][1]) * fr;
    const side = dynHash01(p.arcSeed, step, k++) < 0.5 ? -1 : 1;
    const bang = dir + (side * (24 + 22 * dynHash01(p.arcSeed, step, k++)) * Math.PI) / 180;
    const blen = mainLen * (1 - s) * (0.45 + 0.3 * dynHash01(p.arcSeed, step, k++));
    const bp = dynArcDisplaceLine(bx, by, bx + Math.cos(bang) * blen, by + Math.sin(bang) * blen, disp, 3, p.arcSeed, step, k);
    k = bp.k;
    const m = bp.pts.length;
    const branchFull = bp.pts.map((q, i) => [q[0], q[1], Math.max(0.1, p.arcWidthPx * 0.62 * (1 - 0.85 * (i / (m - 1))))]);
    branches.push(dynArcClip(branchFull, Math.min(1, (grow - s) / Math.max(0.01, 1 - s))));
  }
  return { main: dynArcClip(mainFull, grow), branches: branches, dots: [], alpha: alpha };
}
// 追随已由导出端烘成 followCurve，播放器不再现算增量（原追随增量函数已删）。
function dynOccAt(tile, x, y) {
  if (x < 0 || y < 0 || x >= tile.w || y >= tile.h) return false;
  return tile.data[(y * tile.w + x) * 4] < 128;
}
function dynContour(tile) {
  const pts = [];
  for (let y = 0; y < tile.h; y++) {
    for (let x = 0; x < tile.w; x++) {
      if (!dynOccAt(tile, x, y)) continue;
      const l = !dynOccAt(tile, x - 1, y), r = !dynOccAt(tile, x + 1, y);
      const u = !dynOccAt(tile, x, y - 1), d = !dynOccAt(tile, x, y + 1);
      if (!l && !r && !u && !d) continue;
      let nx = (r ? 1 : 0) - (l ? 1 : 0);
      let ny = (d ? 1 : 0) - (u ? 1 : 0);
      const len = Math.hypot(nx, ny);
      if (len === 0) { nx = 0; ny = -1; } else { nx /= len; ny /= len; }
      pts.push({ x: x, y: y, nx: nx, ny: ny });
    }
  }
  return pts;
}
function dynSourcePoints(params, tile, contour) {
  if (params.source === 'contour-top') {
    const f = contour.filter((p) => p.ny < -0.25);
    return f.length ? f : contour;
  }
  if (params.source === 'contour-bottom') {
    const f = contour.filter((p) => p.ny > 0.25);
    return f.length ? f : contour;
  }
  if (params.source === 'inside') {
    const pts = [];
    for (let y = 0; y < tile.h; y++) for (let x = 0; x < tile.w; x++) {
      if (dynOccAt(tile, x, y)) pts.push({ x: x, y: y, nx: 0, ny: -1 });
    }
    return pts;
  }
  if (params.source === 'plug') return [{ x: tile.cx - 0.5, y: tile.cy - 0.5, nx: 0, ny: -1 }];
  if (params.source === 'mark') {
    // 精灵标记点：瓦片像素位由 ensureAtlas 按瓦片几何算好挂
    // tile.marksN（名 → [x, y]）；缺失 → 回落 plug 点（同编辑器）
    const mp = tile.marksN && params.emitMark ? tile.marksN[params.emitMark] : undefined;
    if (mp) return [{ x: mp[0] - 0.5, y: mp[1] - 0.5, nx: 0, ny: -1 }];
    return [{ x: tile.cx - 0.5, y: tile.cy - 0.5, nx: 0, ny: -1 }];
  }
  return contour;
}
function dynHexRgbOf(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return [255, 180, 107];
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}
function dynRgbHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
// 与 dynamic-patterns.ts particleColorAt 逐值同式（探针 J 组对拍）
function dynParticleColorAt(params, lifeRatio) {
  if (!params.rampEnabled) return params.color;
  const f = Math.max(0, Math.min(1, lifeRatio));
  const pos = Math.max(0, Math.min(1, params.rampMidPos ?? 0.5));
  const a = dynHexRgbOf(params.rampFrom), mid = dynHexRgbOf(params.rampMid), b = dynHexRgbOf(params.rampTo);
  if (f <= pos) {
    const t = pos <= 0 ? 1 : f / pos;
    return dynRgbHex(a[0] + (mid[0] - a[0]) * t, a[1] + (mid[1] - a[1]) * t, a[2] + (mid[2] - a[2]) * t);
  }
  const t = pos >= 1 ? 1 : (f - pos) / (1 - pos);
  return dynRgbHex(mid[0] + (b[0] - mid[0]) * t, mid[1] + (b[1] - mid[1]) * t, mid[2] + (b[2] - mid[2]) * t);
}
const DYN_POST_RAMPS = {
  ember: ['#1a0500', '#7a1e00', '#ff5a00', '#ffa02a', '#fff3c4'],
  frost: ['#02101e', '#0e4a7a', '#2a9adf', '#9fdcff', '#ffffff'],
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f', '#e0f8d0'],
  dusk: ['#12041f', '#3c1160', '#7a2a9e', '#d76bd7', '#ffd7f4'],
  mono: ['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff'],
};
// 与 dynamic-patterns.ts postColorAt 逐值同式（探针 J 组对拍）
function dynPostColorAt(params, hex) {
  if (!params.postEnabled || !params.postTheme || params.postTheme === 'none') return hex;
  const ramp = DYN_POST_RAMPS[params.postTheme];
  if (!ramp) return hex;
  const rgb = dynHexRgbOf(hex);
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const pos = Math.max(0, Math.min(0.9999, lum)) * 4;
  const i = Math.floor(pos);
  const f = pos - i;
  const a = dynHexRgbOf(ramp[i]), c = dynHexRgbOf(ramp[Math.min(4, i + 1)]);
  return dynRgbHex(a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f);
}
// 与 dynamic-patterns.ts orbitPointsAt 逐点同式（探针 J 组对拍）
function dynOrbitPoints(params, tSec, worldAngleDeg) {
  if (!params.orbitEnabled || !(params.orbitCount > 0)) return [];
  const out = [];
  const counter = params.orbitAngleSpace !== 'sprite' ? (-(worldAngleDeg || 0) * Math.PI) / 180 : 0;
  const cc = Math.cos(counter), cs = Math.sin(counter);
  for (let i = 0; i < params.orbitCount; i++) {
    const ph = (params.orbitPhase || 0) + tSec * (params.orbitHz || 0) + i / params.orbitCount;
    const a = ph * Math.PI * 2;
    const ex = Math.cos(a) * params.orbitRadiusX;
    const ey = Math.sin(a) * params.orbitRadiusY;
    out.push({ x: ex * cc - ey * cs, y: ex * cs + ey * cc });
  }
  return out;
}
function dynBallisticAt(params, sx, sy, vx, vy, age) {
  const rise = params.rise, buoy = params.buoy;
  if (!params.groundEnabled) {
    return {
      x: sx + vx * age, y: sy + vy * age - rise * age - 0.5 * buoy * age * age,
      vx: vx, vy: vy - rise - buoy * age, segVx: vx, segVy: vy,
      rested: false, landAge: null, landX: 0,
    };
  }
  const GY = params.groundYPx ?? 0;
  let segT = 0;
  let x0 = sx, y0 = sy, vx0 = vx, vy0 = vy;
  let landAge = null, landX = 0;
  for (let seg = 0; seg < 16; seg++) {
    const tau = age - segT;
    const A = -0.5 * buoy, B = vy0 - rise, C = y0 - GY;
    let hitTau = null, hitVy = 0;
    if (Math.abs(C) <= 1e-9 && B > 0) {
      hitTau = 0; hitVy = B;
    } else if (Math.abs(A) < 1e-12) {
      if (B > 0) {
        const t = -C / B;
        if (t > 1e-6) { hitTau = t; hitVy = B; }
      }
    } else {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const r1 = (-B - sq) / (2 * A), r2 = (-B + sq) / (2 * A);
        const cand = [Math.min(r1, r2), Math.max(r1, r2)];
        for (let ci = 0; ci < 2; ci++) {
          const r = cand[ci];
          if (r <= 1e-6) continue;
          const d = B + 2 * A * r;
          if (d > 0) { hitTau = r; hitVy = d; break; }
        }
      }
    }
    if (hitTau === null || hitTau > tau) {
      return {
        x: x0 + vx0 * tau, y: y0 + vy0 * tau - rise * tau - 0.5 * buoy * tau * tau,
        vx: vx0, vy: vy0 - rise - buoy * tau, segVx: vx0, segVy: vy0,
        rested: false, landAge: landAge, landX: landX,
      };
    }
    const xImp = x0 + vx0 * hitTau;
    if (landAge === null) { landAge = segT + hitTau; landX = xImp; }
    const vyRef = -hitVy * (params.bounce ?? 0);
    if ((params.bounce ?? 0) <= 0 || Math.abs(vyRef) < (params.restVelPx ?? 0)) {
      return { x: xImp, y: GY, vx: 0, vy: 0, segVx: 0, segVy: 0, rested: true, landAge: landAge, landX: landX };
    }
    if (hitTau >= tau) {
      return {
        x: xImp, y: GY, vx: vx0 * 0.7, vy: vyRef - rise, segVx: vx0 * 0.7, segVy: vyRef,
        rested: false, landAge: landAge, landX: landX,
      };
    }
    segT += hitTau; x0 = xImp; y0 = GY; vx0 = vx0 * 0.7; vy0 = vyRef;
  }
  return { x: x0, y: y0, vx: 0, vy: 0, segVx: 0, segVy: 0, rested: true, landAge: landAge, landX: landX };
}
function dynSpinRot(params, age, seedBase, b, k, saltSign, saltPhase) {
  const sign = dynHash01(seedBase, b, k, saltSign) < 0.5 ? -1 : 1;
  return (params.particleSpinDeg ?? 0) * age * sign + dynHash01(seedBase, b, k, saltPhase) * 360;
}
function dynSimulate(inst, tile, frame, frameRate, layer, seedKey) {
  const params = inst.params;
  if (!params.emitEnabled || params.rate <= 0 || params.life <= 0) return [];
  const contour = dynContour(tile);
  const pts = dynSourcePoints(params, tile, contour);
  if (pts.length === 0) return [];
  const seedBase = dynSeedOf(seedKey + '|' + (inst.id || inst.slot));
  // 与产品侧 dynamic-pattern-sim.ts simulateDynamicParticles 逐式
  // 镜像（探针 verify-particle-twin-align 全网格对拍）：出生回放
  // 窗口前扩 extSec = 链/落地派生时程取大；弹道走 dynBallisticAt
  // （不含 sway），sway 只在主粒子绘制位置叠加（全龄相位、当前
  // 段发射参数取向）；链粒子无 sway/buoy、alpha 不走后期丢弃；
  // 落地派生按父首次落地事件整块派生（dynHash01N 变长哈希）。
  const extSec = Math.max(
    params.chainEnabled ? (params.chainLife ?? 0) : 0,
    params.landEmitEnabled ? (params.landEmitDuration ?? 0) : 0,
  );
  const lifeFrames = (params.life + extSec) * frameRate;
  const firstBirth = Math.max(0, Math.ceil(frame - lifeFrames));
  const lastBirth = Math.floor(frame);
  // 发射方向绑定：tile.marksDir（名 → 角度，图集期由精灵标记
  // 算好）命中时以标记角为准，未命中回落 directionDeg（同编辑器）
  const dirDeg = params.emitDirMark && tile.marksDir && tile.marksDir[params.emitDirMark] !== undefined
    ? tile.marksDir[params.emitDirMark]
    : params.directionDeg;
  const dirRad = (dirDeg * Math.PI) / 180;
  const dirX = Math.cos(dirRad), dirY = Math.sin(dirRad);
  const cap = params.layer === 'both'
    ? Math.max(1, Math.round(params.maxParticles * (layer === 'front' ? params.frontRatio : 1 - params.frontRatio)))
    : params.maxParticles;
  const envOf = (r) => (r < 0.15 ? r / 0.15 : 1 - (r - 0.15) / 0.85);
  const groundY = params.groundYPx ?? 0;
  const out = [];
  for (let b = lastBirth; b >= firstBirth; b--) {
    const tBirth = b / frameRate;
    const amount = dynDeformAt(params, tBirth).amount;
    const rateNow = params.rate * (1 - params.linkToDeform + params.linkToDeform * amount);
    const expected = rateNow / frameRate;
    let n = Math.floor(expected);
    if (dynHash01(seedBase, b, 991) < expected - n) n++;
    const age = (frame - b) / frameRate;
    const lifeRatio = age / params.life;
    const parentAlive = lifeRatio >= 0 && lifeRatio < 1;
    const chainAlive = !!params.chainEnabled && age >= params.life && age - params.life < (params.chainLife ?? 0);
    const mayLand = !!params.landEmitEnabled && !!params.groundEnabled;
    if (!parentAlive && !chainAlive && !mayLand) continue;
    for (let k = 0; k < n; k++) {
      if (params.layer !== 'both') {
        if (params.layer !== layer) continue;
      } else if ((dynHash01(seedBase, b, k, 777) < params.frontRatio) !== (layer === 'front')) {
        continue;
      }
      const pick = Math.floor(dynHash01(seedBase, b, k, 13) * pts.length) % pts.length;
      const pt = pts[pick];
      const jx = dynHash01(seedBase, b, k, 21) - 0.5;
      const jy = dynHash01(seedBase, b, k, 22) - 0.5;
      const sx = pt.x + 0.5 + jx - tile.cx;
      const sy = pt.y + 0.5 + jy - tile.cy;
      const spread = (dynHash01(seedBase, b, k, 31) - 0.5) * params.spreadDeg * Math.PI / 180;
      let vx = dirX * params.speed + pt.nx * params.speed * 0.5;
      let vy = dirY * params.speed + pt.ny * params.speed * 0.5;
      const cs = Math.cos(spread), sn = Math.sin(spread);
      const rvx = vx * cs - vy * sn, rvy = vx * sn + vy * cs;
      vx = rvx; vy = rvy;
      // 汇聚模式（与产品侧同式）
      let spawnX = sx, spawnY = sy;
      if (params.emitMode === 'gather') {
        const vlen0 = Math.hypot(vx, vy);
        if (vlen0 > 1e-6) {
          const off = (params.gatherRadius || 0) * (0.5 + 0.5 * dynHash01(seedBase, b, k, 51));
          spawnX += (vx / vlen0) * off;
          spawnY += (vy / vlen0) * off;
        }
        vx = -vx; vy = -vy;
      }
      const phi = dynHash01(seedBase, b, k, 41) * Math.PI * 2;
      // ---- 主粒子（cls 0）----
      let trajMain = null;
      if (params.groundEnabled && parentAlive) {
        trajMain = dynBallisticAt(params, spawnX, spawnY, vx, vy, age);
      }
      if (parentAlive) {
        let px, py, velX = vx, velY = vy;
        if (trajMain) {
          const sway = params.turbulence * Math.sin(age * 3.1 + phi) * Math.min(1, age);
          px = trajMain.x + sway * -trajMain.segVy * 0.14;
          py = trajMain.y + sway * trajMain.segVx * 0.14;
          velX = trajMain.segVx; velY = trajMain.segVy;
        } else {
          const sway = params.turbulence * Math.sin(age * 3.1 + phi) * Math.min(1, age);
          px = spawnX + vx * age + sway * -vy * 0.14;
          py = spawnY + vy * age - params.rise * age - 0.5 * params.buoy * age * age + sway * vx * 0.14;
        }
        const size = params.sizeStart + (params.sizeEnd - params.sizeStart) * lifeRatio;
        const env = envOf(lifeRatio);
        // 图案级全局后期（与产品侧同式）：抖动消散命中时整粒
        // （含其链/落地派生）一并跳过——continue 在 k 循环层
        let postAlpha = Math.max(0, params.alpha * env);
        if (params.postEnabled && params.postDither) {
          if (dynHash01(seedBase, b, k, 61) >= env) continue;
          postAlpha = params.alpha;
        } else if (params.postEnabled && params.postAlphaLevels >= 2) {
          const lv = params.postAlphaLevels;
          postAlpha = Math.round(postAlpha * lv) / lv;
        }
        const vlen = Math.hypot(velX, velY);
        out.push({
          x: px, y: py, size: size, alpha: postAlpha,
          color: dynPostColorAt(params, dynParticleColorAt(params, lifeRatio)),
          shape: params.particleShape || 'dot',
          dirX: vlen > 1e-6 ? velX / vlen : dirX,
          dirY: vlen > 1e-6 ? velY / vlen : dirY,
          cls: 0, rot: dynSpinRot(params, age, seedBase, b, k, 71, 72),
        });
        if (out.length >= cap) return out;
      }
      // ---- 死后链粒子（cls 1）：父死亡弹道状态派生，初速 =
      // 父死亡速度 ×0.6 再叠加上浮漂移（cvy 已含 −rise），其后
      // 匀速：无 sway、无 buoy、无后期 alpha 丢弃；颜色走
      // postColorAt(chainColor)、不走生命坡道 ----
      let evTraj = null;
      if (chainAlive) {
        evTraj = dynBallisticAt(params, spawnX, spawnY, vx, vy, params.life);
        const age2 = age - params.life;
        const ratio2 = age2 / (params.chainLife ?? 0);
        const cvx = evTraj.vx * 0.6;
        const cvy = evTraj.vy * 0.6 - params.rise;
        const env2 = envOf(ratio2);
        const cl = Math.hypot(cvx, cvy);
        out.push({
          x: evTraj.x + cvx * age2,
          y: evTraj.y + cvy * age2,
          size: params.sizeEnd * (params.chainSizeMul ?? 1) * (1 + 0.5 * ratio2),
          alpha: Math.max(0, params.alpha * env2),
          color: dynPostColorAt(params, params.chainColor ?? params.color),
          shape: 'puff',
          dirX: cl > 1e-6 ? cvx / cl : 0,
          dirY: cl > 1e-6 ? cvy / cl : -1,
          cls: 1, rot: dynSpinRot(params, age2, seedBase, b, k, 73, 74),
        });
        if (out.length >= cap) return out;
      }
      // ---- 落地派生粒子（cls 2）：父首次落地事件派生，只一代。
      // 落点取弹道口径（不含 sway）；出生帧窗 [tLand, tLand+
      // landEmitDuration)、逐帧计数哈希取整（盐 881）、逐粒哈希
      // （盐 883..886）全走变长 dynHash01N，与产品侧逐式一致 ----
      if (mayLand) {
        const lt = parentAlive ? trajMain : (evTraj ?? dynBallisticAt(params, spawnX, spawnY, vx, vy, params.life));
        if (lt && lt.landAge !== null) {
          const tLand = tBirth + lt.landAge;
          const tNow = frame / frameRate;
          const landLife = params.life * 0.5;
          if (tNow >= tLand && tNow < tLand + (params.landEmitDuration ?? 0) + landLife) {
            const fFrom = Math.max(Math.ceil(tLand * frameRate), Math.ceil((tNow - landLife) * frameRate));
            const fTo = Math.min(frame, Math.ceil((tLand + (params.landEmitDuration ?? 0)) * frameRate) - 1);
            for (let fL = fFrom; fL <= fTo; fL++) {
              const expectedL = (params.landEmitRate ?? 0) / frameRate;
              let nL = Math.floor(expectedL);
              if (dynHash01N(seedBase, b, k, fL, 881) < expectedL - nL) nL++;
              const ageL = tNow - fL / frameRate;
              if (ageL < 0 || ageL >= landLife) continue;
              for (let j = 0; j < nL; j++) {
                const vxL = (dynHash01N(seedBase, b, k, fL, j, 883) - 0.5) * 16;
                const vyL = -(params.landEmitRise ?? 0) * (0.7 + 0.6 * dynHash01N(seedBase, b, k, fL, j, 884));
                const ratioL = ageL / landLife;
                const envL = envOf(ratioL);
                const vl = Math.hypot(vxL, vyL);
                const lSign = dynHash01N(seedBase, b, k, fL, j, 885) < 0.5 ? -1 : 1;
                out.push({
                  x: lt.landX + vxL * ageL,
                  y: groundY + vyL * ageL - 0.5 * params.buoy * ageL * ageL,
                  size: params.sizeStart + (params.sizeEnd - params.sizeStart) * ratioL,
                  alpha: Math.max(0, params.alpha * envL),
                  color: dynPostColorAt(params, params.landEmitColor ?? params.color),
                  shape: 'dot',
                  dirX: vl > 1e-6 ? vxL / vl : 0,
                  dirY: vl > 1e-6 ? vyL / vl : -1,
                  cls: 2,
                  rot: (params.particleSpinDeg ?? 0) * ageL * lSign + dynHash01N(seedBase, b, k, fL, j, 886) * 360,
                });
                if (out.length >= cap) return out;
              }
            }
          }
        }
      }
    }
  }
  return out;
}
function dynSmoothstep01(a, b, x) {
  const f = Math.max(0, Math.min(1, (x - a) / Math.max(1e-6, b - a)));
  return f * f * (3 - 2 * f);
}
// 与 dynamic-patterns.ts fieldColorAt 逐值同式（探针 F 组对拍）
function dynFieldColorAt(edge, mid, core, heat) {
  const f = Math.max(0, Math.min(1, heat));
  const a = dynHexRgbOf(edge), m = dynHexRgbOf(mid), c = dynHexRgbOf(core);
  if (f <= 0.55) {
    const t = f / 0.55;
    return [a[0] + (m[0] - a[0]) * t, a[1] + (m[1] - a[1]) * t, a[2] + (m[2] - a[2]) * t];
  }
  const t = (f - 0.55) / 0.45;
  return [m[0] + (c[0] - m[0]) * t, m[1] + (c[1] - m[1]) * t, m[2] + (c[2] - m[2]) * t];
}
// 与 dynamic-patterns.ts blobFieldAt 逐格同式（探针 F 组对拍）
function dynBlobField(params, tSec, dsx, dsy) {
  if (!params.blobEnabled) return null;
  dsx = dsx === undefined ? 1 : dsx;
  dsy = dsy === undefined ? 1 : dsy;
  const R = Math.max(4, params.blobRadius);
  const pad = 2;
  const RX = Math.ceil(R * Math.max(0.05, dsx)), RY = Math.ceil(R * Math.max(0.05, dsy));
  const SW = 2 * (RX + pad) + 1, SH = 2 * (RY + pad) + 1;
  const heat = new Float32Array(SW * SH);
  const phase = ((tSec * params.blobHz) % 1 + 1) % 1;
  const K = DYN_DISPLACE_PERIOD;
  const theta = params.blobBurn * Math.sin(Math.PI * phase);
  const seeds = [];
  for (let i = 0; i < params.blobCount; i++) {
    const ang = dynHash01(params.blobSeed, 0, 100 + i) * Math.PI * 2;
    const rad = i === 0 ? 0 : R * 0.5 * Math.sqrt(dynHash01(params.blobSeed, 0, 110 + i));
    const wx = (dynNoiseU(phase * K + i * 3.7, i * 1.3, K, 7717) - 0.5) * R * 0.22;
    const wy = (dynNoiseU(phase * K + i * 2.9 + 40, i * 1.7, K, 31337) - 0.5) * R * 0.22;
    seeds.push({
      x: (Math.cos(ang) * rad + wx) * dsx,
      y: (Math.sin(ang) * rad + wy) * dsy,
      r: i === 0 ? R * 0.78 : R * (0.42 + 0.3 * dynHash01(params.blobSeed, 0, 120 + i)),
    });
  }
  for (let cy = 0; cy < SH; cy++) {
    for (let cx = 0; cx < SW; cx++) {
      const lx = cx - (RX + pad), ly = cy - (RY + pad);
      let raw = 0;
      for (const sd of seeds) {
        const d = Math.hypot(lx - sd.x, ly - sd.y);
        const v = 1 - d / sd.r;
        if (v > raw) raw = v;
      }
      heat[cy * SW + cx] = dynSmoothstep01(theta, theta + 0.38, Math.pow(Math.max(0, raw), 1.3));
    }
  }
  return { w: SW, h: SH, heat: heat, ox: RX + pad, oy: RY + pad };
}
// 与 dynamic-patterns.ts flameFieldAt 逐格同式（探针 F 组对拍）
function dynFlameField(params, tSec, dsx, dsy) {
  if (!params.flameEnabled) return null;
  dsx = dsx === undefined ? 1 : dsx;
  dsy = dsy === undefined ? 1 : dsy;
  const W = Math.max(4, Math.round(params.flameWidth * Math.max(0.05, dsx)));
  const H = Math.max(6, Math.round(params.flameHeight * Math.max(0.05, dsy)));
  const pad = 2;
  const w = W + 2 * pad + 1;
  const h = H + pad + 3;
  const ox = Math.floor(W / 2) + pad;
  const oy = H + pad;
  const heat = new Float32Array(w * h);
  const phase = ((tSec * params.flameHz) % 1 + 1) % 1;
  const K = DYN_DISPLACE_PERIOD;
  const f = 0.16;
  for (let cy = 0; cy < h; cy++) {
    const ly = cy - oy;
    if (ly > 1) continue;
    const rise = Math.max(0, Math.min(1, -ly / H));
    const widthMod = 0.82 + 0.36 * dynNoiseU(phase * K, rise * 3, K, 7717);
    const halfW = Math.max(1, (W / 2) * (1 - 0.5 * rise) * widthMod);
    for (let cx = 0; cx < w; cx++) {
      const lx = cx - ox;
      const inside = 1 - Math.abs(lx) / halfW;
      if (inside <= 0) continue;
      const n1 = dynNoiseU(-ly * f + phase * K, lx * f, K, 5511);
      const n2 = dynNoiseU(-ly * f * 2.1 + phase * K * 2, lx * f * 2.1 + 7.7, K, 9923);
      let hv = inside * (1 - rise * 0.9)
        + (n1 - 0.5) * (params.flameTurbulence ?? 0.55) * (0.35 + 0.65 * rise)
        + (n2 - 0.5) * (params.flameTurbulence ?? 0.55) * 0.35
        - rise * rise * 0.25;
      heat[cy * w + cx] = dynSmoothstep01(0.06, 0.62, hv);
    }
  }
  return { w: w, h: h, heat: heat, ox: ox, oy: oy };
}
// 与 dynamic-patterns.ts envSamplesAt 逐值同式（探针 H 组对拍）。
// quads: [x, y, size, line(0/1), dirX, dirY, alpha]；rings: [x, y, r, alpha]
function dynEnvSamples(params, tSec) {
  const quads = [];
  const rings = [];
  if (!params.envEnabled) return { quads: quads, rings: rings };
  const W = params.envWidth, H = params.envHeight, hz = params.envHz, seed = params.envSeed;
  const K = DYN_DISPLACE_PERIOD;
  const frac = (v) => v - Math.floor(v);
  for (let i = 0; i < params.envCount; i++) {
    if (params.envMode === 'drift') {
      const bx = (dynHash01(seed, i, 211) - 0.5) * W;
      const by = (dynHash01(seed, i, 212) - 0.5) * H;
      const ph = frac(tSec * hz + dynHash01(seed, i, 213));
      const ox = (dynNoiseU(ph * K + i * 2.3, i * 1.1, K, 4511) - 0.5) * W * 0.16;
      const oy = (dynNoiseU(ph * K + i * 1.9 + 31, i * 0.7, K, 9029) - 0.5) * H * 0.16;
      const tw = 0.25 + 0.75 * Math.sin(Math.PI * ph);
      quads.push([bx + ox, by + oy, params.envSize, 0, 1, 0, params.envAlpha * tw]);
    } else if (params.envMode === 'ripple') {
      const h = dynHash01(seed, i, 221);
      const cyc = Math.floor(tSec * hz + h);
      const ph = frac(tSec * hz + h);
      const x = (dynHash01(seed, i, 230 + cyc) - 0.5) * W * 0.9;
      const gy = H / 2 - 2 - dynHash01(seed, i, 240 + cyc) * 3;
      if (ph < 0.3) {
        const f = ph / 0.3;
        quads.push([x, -H / 2 + f * (gy + H / 2), params.envSize * 2.2, 1, 0, 1, params.envAlpha]);
      } else {
        const f = (ph - 0.3) / 0.7;
        rings.push([x, gy, 1.5 + f * params.envRadius, params.envAlpha * (1 - f) * 0.9]);
      }
    } else {
      const h1 = dynHash01(seed, i, 201);
      const ph = frac(tSec * hz + h1);
      const x = (h1 - 0.5) * W + (dynHash01(seed, i, 202) - 0.5) * 4;
      const fade = Math.pow(Math.sin(Math.PI * Math.min(1, ph)), 0.7);
      quads.push([x, -H / 2 + ph * H, params.envSize * 2.4, 1, 0, 1, params.envAlpha * fade]);
    }
  }
  return { quads: quads, rings: rings };
}
function dynProcSeededRandom(seed) {
  let s = seed | 0;
  return () => { s = (s * 1664525 + 1013904223) | 0; return (s >>> 0) / 4294967295; };
}
function dynProcNoise2D(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const smooth = (t) => t * t * (3 - 2 * t);
  const sfx = smooth(fx), sfy = smooth(fy);
  const hash = (a, b) => { let h = a * 374761393 + b * 668265263; h = (h ^ (h >> 13)) * 1274126177; return (h ^ (h >> 16)) / 2147483648; };
  const nx0 = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * sfx;
  const nx1 = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * sfx;
  return nx0 + (nx1 - nx0) * sfy;
}
function dynProcFbm(x, y, octaves, seed) {
  let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * dynProcNoise2D(x * frequency + seed, y * frequency + seed * 0.7);
    maxValue += amplitude; amplitude *= 0.5; frequency *= 2;
  }
  return value / maxValue;
}
// 公式求值：与编辑器 engine/formula.ts 逐行同构的递归下降小解析器
// （不用 eval / Function）。变量 f/F/p 由 dynProceduralValue 按条目
// 帧范围算好传入；长度上限 200、括号/调用嵌套上限 32；解析错误
// （未知标识符/函数、括号不配对等）或非有限结果一律回 0。
var DYN_FML_UNARY = { sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sqrt: Math.sqrt, exp: Math.exp, log: Math.log, floor: Math.floor, ceil: Math.ceil, round: Math.round };
var DYN_FML_BINARY = { pow: Math.pow, min: Math.min, max: Math.max };
function dynFmlHas(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function dynFmlErr(st, msg) { return new Error('第 ' + (st.pos + 1) + ' 个字符处：' + msg); }
function dynFmlSkipWs(st) { while (st.pos < st.src.length) { const c = st.src.charCodeAt(st.pos); if (c === 32 || c === 9 || c === 10 || c === 13) st.pos++; else break; } }
function dynFmlPeek(st) { dynFmlSkipWs(st); return st.pos < st.src.length ? st.src[st.pos] : ''; }
function dynFmlExpr(st) {
  let v = dynFmlTerm(st);
  for (;;) {
    const c = dynFmlPeek(st);
    if (c === '+') { st.pos++; v = v + dynFmlTerm(st); }
    else if (c === '-') { st.pos++; v = v - dynFmlTerm(st); }
    else return v;
  }
}
function dynFmlTerm(st) {
  let v = dynFmlUnary(st);
  for (;;) {
    const c = dynFmlPeek(st);
    if (c === '*') { st.pos++; v = v * dynFmlUnary(st); }
    else if (c === '/') { st.pos++; v = v / dynFmlUnary(st); }
    else if (c === '%') { st.pos++; v = v % dynFmlUnary(st); }
    else return v;
  }
}
function dynFmlUnary(st) {
  if (dynFmlPeek(st) === '-') { st.pos++; return -dynFmlUnary(st); }
  return dynFmlPower(st);
}
function dynFmlPower(st) {
  const base = dynFmlPrimary(st);
  if (dynFmlPeek(st) === '^') { st.pos++; return Math.pow(base, dynFmlUnary(st)); }
  return base;
}
function dynFmlPrimary(st) {
  const c = dynFmlPeek(st);
  if (c === '') throw dynFmlErr(st, '表达式不完整');
  if (c === ')' || c === ',') throw dynFmlErr(st, '这里缺一个数或子表达式');
  if (c === '(') {
    st.pos++;
    st.depth++;
    if (st.depth > 32) throw dynFmlErr(st, '嵌套超过 32 层上限');
    const v = dynFmlExpr(st);
    if (dynFmlPeek(st) !== ')') throw dynFmlErr(st, '括号不配对，缺「)」');
    st.pos++;
    st.depth--;
    return v;
  }
  const code = st.src.charCodeAt(st.pos);
  if ((code >= 48 && code <= 57) || c === '.') {
    const start = st.pos;
    let dot = false;
    let digit = false;
    while (st.pos < st.src.length) {
      const d = st.src[st.pos];
      if (d >= '0' && d <= '9') { digit = true; st.pos++; }
      else if (d === '.') { if (dot) break; dot = true; st.pos++; }
      else break;
    }
    if (!digit) throw dynFmlErr(st, '数字格式不对');
    return parseFloat(st.src.slice(start, st.pos));
  }
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || c === '_') {
    const start = st.pos;
    while (st.pos < st.src.length) {
      const d = st.src.charCodeAt(st.pos);
      if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57) || d === 95) st.pos++;
      else break;
    }
    const name = st.src.slice(start, st.pos);
    if (dynFmlPeek(st) === '(') {
      const unary = dynFmlHas(DYN_FML_UNARY, name) ? DYN_FML_UNARY[name] : undefined;
      const binary = dynFmlHas(DYN_FML_BINARY, name) ? DYN_FML_BINARY[name] : undefined;
      if (!unary && !binary) throw dynFmlErr(st, '未知函数「' + name + '」');
      st.pos++;
      st.depth++;
      if (st.depth > 32) throw dynFmlErr(st, '嵌套超过 32 层上限');
      const args = [dynFmlExpr(st)];
      while (dynFmlPeek(st) === ',') { st.pos++; args.push(dynFmlExpr(st)); }
      if (dynFmlPeek(st) !== ')') throw dynFmlErr(st, '括号不配对，缺「)」');
      st.pos++;
      st.depth--;
      const need = unary ? 1 : 2;
      if (args.length !== need) throw dynFmlErr(st, '函数「' + name + '」需要 ' + need + ' 个参数，实际 ' + args.length + ' 个');
      return unary ? unary(args[0]) : binary(args[0], args[1]);
    }
    if (name === 'f') return st.f;
    if (name === 'F') return st.F;
    if (name === 'p') return st.p;
    if (name === 'pi') return Math.PI;
    if (dynFmlHas(DYN_FML_UNARY, name) || dynFmlHas(DYN_FML_BINARY, name)) throw dynFmlErr(st, '函数「' + name + '」后面要带括号和参数');
    throw dynFmlErr(st, '未知变量「' + name + '」');
  }
  throw dynFmlErr(st, '无法识别的字符「' + c + '」');
}
function dynFormulaParse(src, f, F, p) {
  const st = { src: src, pos: 0, depth: 0, f: f, F: F, p: p };
  const v = dynFmlExpr(st);
  if (dynFmlPeek(st) !== '') throw dynFmlErr(st, '后面多出了无法识别的内容');
  return v;
}
function dynFormulaValue(expr, f, F, p) {
  if (typeof expr !== 'string' || expr.length > 200) return 0;
  try {
    const v = dynFormulaParse(expr, f, F, p);
    return Number.isFinite(v) ? v : 0;
  } catch (e) { return 0; }
}
// 程序化动画取值：与编辑器 engine/procedural.computeProceduralValue 逐值同源
// （噪声/弹簧/抖动公式逐行移植、公式类型经 dynFormulaValue 同规格求值，探针逐值对拍）。
function dynProceduralValue(cfg, frame, startFrame, endFrame) {
  switch (cfg.type) {
    case 'noise': return (dynProcFbm(frame * cfg.frequency, 0, cfg.octaves, cfg.seed) * 2 - 1) * cfg.amplitude;
    case 'wave': {
      const t = frame * cfg.frequency + (cfg.phase / 360);
      const phase = t * Math.PI * 2;
      switch (cfg.waveType) {
        case 'sine': return Math.sin(phase) * cfg.amplitude;
        case 'triangle': return (2 * Math.abs(2 * (t % 1 - 0.5)) - 1) * cfg.amplitude;
        case 'square': return (Math.sin(phase) >= 0 ? 1 : -1) * cfg.amplitude;
        case 'sawtooth': return (2 * (t % 1) - 1) * cfg.amplitude;
        default: return Math.sin(phase) * cfg.amplitude;
      }
    }
    case 'spring': {
      const omega = Math.sqrt(cfg.stiffness / cfg.mass);
      const gamma = cfg.damping / (2 * cfg.mass);
      const dampedOmega = Math.sqrt(Math.max(0, omega * omega - gamma * gamma));
      const lf = Math.max(0, frame - (startFrame || 0));
      return (cfg.restLength ?? 0) + (cfg.amplitude ?? 5) * Math.exp(-gamma * lf) * Math.cos(dampedOmega * lf);
    }
    case 'jitter': {
      const seed = Math.floor(frame * cfg.frequency * 100);
      const rng = dynProcSeededRandom(seed);
      if (cfg.smooth) return (dynProcNoise2D(frame * cfg.frequency, 0) * 2 - 1) * cfg.amount;
      return (rng() * 2 - 1) * cfg.amount;
    }
    case 'formula': {
      const sf = startFrame || 0;
      const ef = (endFrame === undefined || endFrame === null) ? sf : endFrame;
      const lf = Math.max(0, frame - sf);
      const p = ef > sf ? Math.min(1, Math.max(0, (frame - sf) / (ef - sf))) : 0;
      return dynFormulaValue(cfg.expression, lf, frame, p);
    }
    default: return 0;
  }
}
// 程序化增量沿部件树传播（与编辑器世界变换同构）：包内位姿是扁平的
// 角色空间绝对量，父部件的增量原本带不动子部件。这里按插头点做刚
// 体递推——info[key] = { px, py, dx, dy, rot, baseRot, cx, cy }：
// (px, py) 无程序化时的插头点（角色空间）、(dx, dy) 自身平移增量、
// rot 自身旋转增量（弧度）、baseRot 无程序化时的绘制角、(cx, cy)
// 自身增量已生效的部件中心。累计角 A 沿树相加；子部件插头由父级
// 最终插头 + 累计角刚体携带（绕父插头转），中心相对插头的偏移（自
// 身增量已含在 cx/cy 里）只再随累计角转；自身平移在自身一层以角色
// 轴叠加、不被祖先旋转——与编辑器把增量加在世界变换里、dx/dy 走
// 世界轴同义。父部件不在 info 里（未绘制）时链断、按根结算。祖先
// 无任何增量时逐值返回原中心/原角度（chainMoved 短路保持逐位）。
function dynPropagateProc(tree, info) {
  const out = {};
  const cache = {};
  const solve = (key, guard) => {
    if (cache[key]) return cache[key];
    const inf = info[key];
    if (!inf) return null;
    let res = null;
    const pk = tree ? tree[key] : null;
    const P = pk && pk !== key && info[pk] && guard < 64 ? solve(pk, guard + 1) : null;
    if (!P) {
      res = {
        pivX: inf.px + inf.dx, pivY: inf.py + inf.dy, a: inf.rot,
        chainMoved: inf.dx !== 0 || inf.dy !== 0 || inf.rot !== 0,
        cx: inf.cx, cy: inf.cy, rot: inf.baseRot + inf.rot,
      };
    } else {
      const pp = info[pk];
      const cA = Math.cos(P.a), sA = Math.sin(P.a);
      const rx = inf.px - pp.px, ry = inf.py - pp.py;
      const pivX = P.pivX + (rx * cA - ry * sA) + inf.dx;
      const pivY = P.pivY + (rx * sA + ry * cA) + inf.dy;
      const a = P.a + inf.rot;
      let cx = inf.cx, cy = inf.cy;
      if (P.chainMoved) {
        const ox = inf.cx - (inf.px + inf.dx), oy = inf.cy - (inf.py + inf.dy);
        cx = pivX + (ox * cA - oy * sA);
        cy = pivY + (ox * sA + oy * cA);
      }
      res = {
        pivX, pivY, a,
        chainMoved: P.chainMoved || inf.dx !== 0 || inf.dy !== 0 || inf.rot !== 0,
        cx, cy, rot: inf.baseRot + a,
      };
    }
    cache[key] = res;
    return res;
  };
  for (const key of Object.keys(info)) {
    const r = solve(key, 0);
    if (r) out[key] = { x: r.cx, y: r.cy, rot: r.rot };
  }
  return out;
}
// ---- 宿主后处理段孪生：与产品侧 host-fx.ts 的 applyHostFxToRgba /
// firstHostFxParams 逐式对应（探针 verify-host-fx 逐像素对拍）。
// 入参 data = RGBA 行优先（行 0 = 图顶）；包内实际应用在部件片元
// 着色器（runtime-template 的 uHostSide 侧车 + 同式 GLSL），本函
// 数是该数学的 JS 参照与模板侧解析/校验的共用实现。 ----
function dynHostFxSeedEff(seed) {
  return ((seed % 100000) + 100000) % 100000;
}
function dynHostFxRgbOf(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return [122, 79, 208];
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}
function dynHostFxFirst(list) {
  for (let i = 0; i < (list || []).length; i++) {
    const inst = list[i];
    const p = inst && inst.params;
    if (p && p.hostFxEnabled && p.hostFxMode && p.hostFxMode !== 'none') return inst;
  }
  return null;
}
function dynHostFxApply(src, w, h, p, tSec, seed) {
  const out = new Uint8ClampedArray(src);
  if (!p || !p.hostFxEnabled || !p.hostFxMode || p.hostFxMode === 'none' || w <= 0 || h <= 0) return out;
  const mode = p.hostFxMode;
  const strength = Math.max(0, Math.min(1, p.hostFxStrength || 0));
  const seedEff = dynHostFxSeedEff(seed);
  const hc = dynHostFxRgbOf(p.hostFxColor);
  const hr = hc[0], hg = hc[1], hb = hc[2];
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const pulse = (Math.sin(2 * Math.PI * ((p.hostFxHz || 0) * tSec + (p.hostFxPhase || 0))) + 1) / 2;
  const progRaw = (p.hostFxHz || 0) * tSec + (p.hostFxPhase || 0);
  const prog = ((progRaw % 1) + 1) % 1;
  if (mode === 'tint') {
    const hLum = (0.2126 * hr + 0.7152 * hg + 0.0722 * hb) / 255;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (src[o + 3] <= 0) continue;
      const lum = (0.2126 * src[o] + 0.7152 * src[o + 1] + 0.0722 * src[o + 2]) / 255;
      const k = hLum > 0.001 ? lum / hLum : 0;
      const tr = hLum > 0.001 ? clamp255(hr * k) : hr;
      const tg = hLum > 0.001 ? clamp255(hg * k) : hg;
      const tb = hLum > 0.001 ? clamp255(hb * k) : hb;
      out[o] = src[o] + (tr - src[o]) * strength;
      out[o + 1] = src[o + 1] + (tg - src[o + 1]) * strength;
      out[o + 2] = src[o + 2] + (tb - src[o + 2]) * strength;
    }
    return out;
  }
  if (mode === 'flash') {
    const k = pulse * strength;
    if (k <= 0) return out;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (src[o + 3] <= 0) continue;
      out[o] = src[o] + (255 - src[o]) * k;
      out[o + 1] = src[o + 1] + (255 - src[o + 1]) * k;
      out[o + 2] = src[o + 2] + (255 - src[o + 2]) * k;
    }
    return out;
  }
  if (mode === 'slice') {
    const bandH = 3;
    for (let y = 0; y < h; y++) {
      const band = Math.floor(y / bandH);
      const dir = dynHash01(band, seedEff, 913) < 0.5 ? -1 : 1;
      const off = Math.round(dir * (p.hostFxSlicePx || 0) * pulse);
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const clampX = (v) => (v < 0 ? 0 : v >= w ? w - 1 : v);
        const base = (y * w + clampX(x - off)) * 4;
        if (src[base + 3] <= 0) { out[o + 3] = 0; continue; }
        const rSrc = (y * w + clampX(x - off + 1)) * 4;
        const bSrc = (y * w + clampX(x - off - 1)) * 4;
        out[o] = src[rSrc];
        out[o + 1] = src[base + 1];
        out[o + 2] = src[bSrc + 2];
        out[o + 3] = src[base + 3];
      }
    }
    return out;
  }
  if (mode === 'rows') {
    for (let y = 0; y < h; y++) {
      if (y / h < prog) continue;
      for (let x = 0; x < w; x++) out[(y * w + x) * 4 + 3] = 0;
    }
    return out;
  }
  if (mode === 'dissolve') {
    const T = prog * (1 + strength);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (src[o + 3] <= 0) continue;
        const n = dynHash01(x, y, seedEff);
        if (n > T) { out[o + 3] = 0; continue; }
        if (T - n < 0.08) { out[o] = hr; out[o + 1] = hg; out[o + 2] = hb; }
      }
    }
    return out;
  }
  if (mode === 'creep') {
    const edgeY = Math.ceil((1 - prog) * h);
    for (let y = 0; y < h; y++) {
      if (y < edgeY) continue;
      const isEdge = y === edgeY;
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (src[o + 3] <= 0) continue;
        if (isEdge) {
          out[o] = hr + (255 - hr) * 0.45;
          out[o + 1] = hg + (255 - hg) * 0.45;
          out[o + 2] = hb + (255 - hb) * 0.45;
        } else {
          const n = dynHash01(x, y, seedEff);
          const shade = n < 1 / 3 ? 0.55 : n < 2 / 3 ? 0.8 : 1.05;
          out[o] = clamp255(hr * shade);
          out[o + 1] = clamp255(hg * shade);
          out[o + 2] = clamp255(hb * shade);
        }
      }
    }
    return out;
  }
  return out;
}
`;

/** 探针用：把 DYNAMIC_SRC 装成可调用对象 */
export function createDynamicRuntime(): {
  dynDeformAt: (params: never, t: number) => { sx: number; sy: number; amount: number };
  dynContour: (tile: never) => { x: number; y: number; nx: number; ny: number }[];
  dynSimulate: (inst: never, tile: never, frame: number, frameRate: number, layer: string, seedKey: string) => { x: number; y: number; size: number; alpha: number; color: string; shape: string; dirX: number; dirY: number; cls: number; rot: number }[];
  dynParticleColorAt: (params: never, lifeRatio: number) => string;
  dynPostColorAt: (params: never, hex: string) => string;
  dynFieldColorAt: (edge: string, mid: string, core: string, heat: number) => [number, number, number];
  dynEnvSamples: (params: never, tSec: number) => { quads: [number, number, number, number, number, number, number][]; rings: [number, number, number, number][] };
  dynBlobField: (params: never, tSec: number, dsx?: number, dsy?: number) => { w: number; h: number; heat: Float32Array; ox: number; oy: number } | null;
  dynFlameField: (params: never, tSec: number, dsx?: number, dsy?: number) => { w: number; h: number; heat: Float32Array; ox: number; oy: number } | null;
  dynOrbitPoints: (params: never, tSec: number, worldAngleDeg?: number) => { x: number; y: number }[];
  dynDisplaceSrcMap: (params: never, w: number, h: number, phase: number) => Int32Array;
  dynNoiseU: (u: number, v: number, period: number, seed: number) => number;
  dynSpinRadAt: (params: never, t: number) => number;
  dynArcPoints: (params: never, t: number, endX?: number, endY?: number, hasEnd?: boolean) => { main: [number, number, number][]; branches: [number, number, number][][]; dots: [number, number, number][]; alpha: number };
  dynProceduralValue: (cfg: never, frame: number, startFrame?: number, endFrame?: number) => number;
  dynPropagateProc: (tree: never, info: never) => Record<string, { x: number; y: number; rot: number }>;
  dynFormulaValue: (expression: string, f: number, F: number, p: number) => number;
  dynHostFxApply: (src: Uint8ClampedArray, w: number, h: number, params: never, tSec: number, seed: number) => Uint8ClampedArray;
  dynHostFxFirst: (list: never[]) => { id: string; params: never } | null;
} {
  const factory = new Function(`${DYNAMIC_SRC}\nreturn { dynDeformAt, dynContour, dynSimulate, dynDisplaceSrcMap, dynNoiseU, dynSpinRadAt, dynArcPoints, dynProceduralValue, dynPropagateProc, dynFormulaValue, dynParticleColorAt, dynOrbitPoints, dynPostColorAt, dynFieldColorAt, dynBlobField, dynFlameField, dynEnvSamples, dynHostFxApply, dynHostFxFirst };`);
  return factory() as never;
}
