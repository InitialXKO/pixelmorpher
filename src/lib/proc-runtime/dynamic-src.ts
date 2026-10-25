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
function dynFollowDelta(now, lag, amount, rotate) {
  const k = Math.max(0, Math.min(1, amount));
  const raw = lag.a - now.a;
  const da = Math.atan2(Math.sin(raw), Math.cos(raw));
  return {
    dx: (lag.x - now.x) * k,
    dy: (lag.y - now.y) * k,
    da: rotate ? da * k : 0,
  };
}
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
function dynSimulate(inst, tile, frame, frameRate, layer, seedKey) {
  const params = inst.params;
  if (!params.emitEnabled || params.rate <= 0 || params.life <= 0) return [];
  const contour = dynContour(tile);
  const pts = dynSourcePoints(params, tile, contour);
  if (pts.length === 0) return [];
  const seedBase = dynSeedOf(seedKey + '|' + (inst.id || inst.slot));
  const lifeFrames = params.life * frameRate;
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
  const out = [];
  for (let b = lastBirth; b >= firstBirth; b--) {
    const amount = dynDeformAt(params, b / frameRate).amount;
    const rateNow = params.rate * (1 - params.linkToDeform + params.linkToDeform * amount);
    const expected = rateNow / frameRate;
    let n = Math.floor(expected);
    if (dynHash01(seedBase, b, 991) < expected - n) n++;
    const age = (frame - b) / frameRate;
    const lifeRatio = age / params.life;
    if (lifeRatio < 0 || lifeRatio >= 1) continue;
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
      const sway = params.turbulence * Math.sin(age * 3.1 + dynHash01(seedBase, b, k, 41) * Math.PI * 2) * Math.min(1, age);
      const px = sx + vx * age + sway * -vy * 0.14;
      const py = sy + vy * age - params.rise * age - 0.5 * params.buoy * age * age + sway * vx * 0.14;
      const size = params.sizeStart + (params.sizeEnd - params.sizeStart) * lifeRatio;
      const env = lifeRatio < 0.15 ? lifeRatio / 0.15 : 1 - (lifeRatio - 0.15) / 0.85;
      out.push({ x: px, y: py, size: size, alpha: Math.max(0, params.alpha * env), color: params.color });
      if (out.length >= cap) return out;
    }
  }
  return out;
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
// 程序化动画取值：与编辑器 engine/procedural.computeProceduralValue 逐值同源
// （噪声/弹簧/抖动公式逐行移植，探针逐值对拍）。
function dynProceduralValue(cfg, frame) {
  switch (cfg.type) {
    case 'noise': return dynProcFbm(frame * cfg.frequency, 0, cfg.octaves, cfg.seed) * cfg.amplitude;
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
      const t = frame / 60;
      return (cfg.restLength > 0 ? cfg.restLength : 1) * Math.exp(-gamma * t) * Math.cos(dampedOmega * t) + cfg.restLength;
    }
    case 'jitter': {
      const seed = Math.floor(frame * cfg.frequency * 100);
      const rng = dynProcSeededRandom(seed);
      if (cfg.smooth) return (dynProcNoise2D(frame * cfg.frequency, 0) * 2 - 1) * cfg.amount;
      return (rng() * 2 - 1) * cfg.amount;
    }
    default: return 0;
  }
}
`;

/** 探针用：把 DYNAMIC_SRC 装成可调用对象 */
export function createDynamicRuntime(): {
  dynDeformAt: (params: never, t: number) => { sx: number; sy: number; amount: number };
  dynContour: (tile: never) => { x: number; y: number; nx: number; ny: number }[];
  dynSimulate: (inst: never, tile: never, frame: number, frameRate: number, layer: string, seedKey: string) => { x: number; y: number; size: number; alpha: number; color: string }[];
  dynFollowDelta: (now: never, lag: never, amount: number, rotate: boolean) => { dx: number; dy: number; da: number };
  dynDisplaceSrcMap: (params: never, w: number, h: number, phase: number) => Int32Array;
  dynNoiseU: (u: number, v: number, period: number, seed: number) => number;
  dynSpinRadAt: (params: never, t: number) => number;
  dynArcPoints: (params: never, t: number, endX?: number, endY?: number, hasEnd?: boolean) => { main: [number, number, number][]; branches: [number, number, number][][]; dots: [number, number, number][]; alpha: number };
  dynProceduralValue: (cfg: never, frame: number) => number;
} {
  const factory = new Function(`${DYNAMIC_SRC}\nreturn { dynDeformAt, dynContour, dynSimulate, dynFollowDelta, dynDisplaceSrcMap, dynNoiseU, dynSpinRadAt, dynArcPoints, dynProceduralValue };`);
  return factory() as never;
}
