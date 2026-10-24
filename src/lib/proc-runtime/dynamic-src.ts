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
  const dirRad = (params.directionDeg * Math.PI) / 180;
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
`;

/** 探针用：把 DYNAMIC_SRC 装成可调用对象 */
export function createDynamicRuntime(): {
  dynDeformAt: (params: never, t: number) => { sx: number; sy: number; amount: number };
  dynContour: (tile: never) => { x: number; y: number; nx: number; ny: number }[];
  dynSimulate: (inst: never, tile: never, frame: number, frameRate: number, layer: string, seedKey: string) => { x: number; y: number; size: number; alpha: number; color: string }[];
  dynFollowDelta: (now: never, lag: never, amount: number, rotate: boolean) => { dx: number; dy: number; da: number };
} {
  const factory = new Function(`${DYNAMIC_SRC}\nreturn { dynDeformAt, dynContour, dynSimulate, dynFollowDelta };`);
  return factory() as never;
}
