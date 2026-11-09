// 机甲生成引擎（自 spikes/mecha-part-patterns 研究线移植，PR #88 落地）
// 工厂（owner/u/v 参数图）+ 面式着色渲染 finishRender + 部位 IR 生成器。
// 虚拟画布尺寸是实现细节：部位在本地坐标渲染、裁剪为精灵后进入产品数据模型，
// 画布本身不进任何产品数据。
// ---------- 工具 ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 974634239);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, seed: number) { // 值噪声（双层）
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const n = l(l(hash2(xi, yi, seed), hash2(xi + 1, yi, seed), s(xf)), l(hash2(xi, yi + 1, seed), hash2(xi + 1, yi + 1, seed), s(xf)), s(yf));
  return n * 0.65 + 0.35 * vnoise1(x * 2.7, y * 2.7, seed + 7);
}
function vnoise1(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(hash2(xi, yi, seed), hash2(xi + 1, yi, seed), s(xf)), l(hash2(xi, yi + 1, seed), hash2(xi + 1, yi + 1, seed), s(xf)), s(yf));
}
const crcTable = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
// ---------- 颜色：量化坡道 ----------
type RGB = [number, number, number];
interface Scheme { armor: RGB; armor2: RGB; frame: RGB; metal: RGB; chrome: RGB; accent: RGB; glow: RGB; decal: RGB; mark?: RGB }
const SCHEMES: Record<string, Scheme> = {
  white:  { armor: [198, 203, 214], armor2: [57, 90, 152], frame: [26, 28, 34], metal: [70, 74, 84], chrome: [205, 212, 224], accent: [64, 110, 224], glow: [150, 200, 255], decal: [42, 50, 66], mark: [196, 134, 70] },
  // 每套配色至少两种主色（ armor + armor2 色相/明度拉开，如敏捷
  // 白+蓝、动力服白+橙；旧 armor2 与 armor 同色系近值等于单色）
  olive:  { armor: [86, 92, 50], armor2: [148, 127, 83], frame: [35, 37, 32], metal: [80, 82, 84], chrome: [186, 190, 192], accent: [219, 130, 40], glow: [255, 198, 94], decal: [226, 224, 205] },
  desert: { armor: [130, 113, 81], armor2: [92, 96, 64], frame: [50, 44, 36], metal: [86, 84, 80], chrome: [192, 190, 182], accent: [209, 112, 36], glow: [255, 202, 102], decal: [238, 232, 214] },
  slate:  { armor: [75, 83, 95], armor2: [153, 161, 171], frame: [32, 36, 44], metal: [76, 80, 88], chrome: [178, 186, 196], accent: [235, 128, 44], glow: [255, 178, 86], decal: [224, 228, 232] },
  rust:   { armor: [118, 94, 66], armor2: [79, 99, 99], frame: [34, 28, 24], metal: [79, 75, 73], chrome: [176, 172, 166], accent: [223, 124, 38], glow: [255, 190, 98], decal: [230, 222, 204] },
};
// 亮度因子量化到 6 档、暗部略偏冷——像素画的坡道感
const RAMP_STEPS = [0.3, 0.45, 0.6, 0.76, 0.9, 1.0, 1.14, 1.3];
/** ramp 的有效倍率（阶梯量化结果）——盒子模式按它把站点读
 * 数归到最近的调子带，两处共用同一张阶梯表 */
export function rampQ(f: number): number {
  let q = RAMP_STEPS[0]; for (const s of RAMP_STEPS) if (f >= s - 0.06) q = s;
  return q;
}
function ramp(c: RGB, f: number): RGB {
  const q = rampQ(f);
  const cool = q < 0.8 ? 0.96 : 1;
  return [Math.min(255, c[0] * q * cool), Math.min(255, c[1] * q), Math.min(255, c[2] * q * (q < 0.8 ? 1.05 : 1))];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- 画布与参数图 ----------
const W = 380, H = 540;
type Kind = 'plate' | 'disc' | 'rod' | 'cyl' | 'sweep' | 'foot' | 'frame' | 'cable' | 'guard';
interface Inst { kind: Kind }
interface MechaCanvas { col: Uint8ClampedArray; owner: Int16Array; u: Float32Array; v: Float32Array; sil: Uint8Array; insts: Inst[] }
function newCanvas(): MechaCanvas {
  return { col: new Uint8ClampedArray(W * H * 4), owner: new Int16Array(W * H).fill(-1), u: new Float32Array(W * H), v: new Float32Array(W * H), sil: new Uint8Array(W * H), insts: [] };
}
type Pt = { x: number; y: number };
function fillShape(cv: MechaCanvas, id: number, test: (x: number, y: number) => [boolean, number, number]) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [hit, u, v] = test(x + 0.5, y + 0.5);
    if (hit) { const i = y * W + x; cv.owner[i] = id; cv.u[i] = u; cv.v[i] = v; }
  }
}
function markSil(cv: MechaCanvas, test: (x: number, y: number) => boolean) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (test(x + 0.5, y + 0.5)) cv.sil[y * W + x] = 1;
}
function segFrame(a: Pt, b: Pt) { const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy); return { ux: dx / len, uy: dy / len, px: -dy / len, py: dx / len, len }; }
// 段板：t0..t1 区间 + 缝 + 两端斜切（cutA/cutB 为端部削角量，单位 px 沿横向）
interface Bulge { f: number; b: number } // 前/后隆起幅度（d<0 为前侧）
const bumpAt = (t: number, c: number) => Math.exp(-(((t - c) / 0.3) ** 2));
type PlateShape = { cTF: number; cTB: number; cBF: number; cBB: number; step: number; stepPos: number };
function plateTest(a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap: number, cutA: number, cutB: number, bulge: Bulge = { f: 0, b: 0 }, shape?: PlateShape) {
  const f = segFrame(a, b);
  return (x: number, y: number): [boolean, number, number] => {
    const rx = x - a.x, ry = y - a.y;
    const t = (rx * f.ux + ry * f.uy) / f.len;
    if (t < t0 || t > t1) return [false, 0, 0];
    const d = rx * f.px + ry * f.py;
    const baseHW = (wA + (wB - wA) * t) / 2;
    const hwF = baseHW * (1 + bulge.f * bumpAt(t, 0.38));
    const hwB = baseHW * (1 + bulge.b * bumpAt(t, 0.34));
    const local = (t - t0) / (t1 - t0);
    const shrink = gap / f.len / (t1 - t0);
    if (local < shrink || local > 1 - shrink) return [false, 0, 0];
    // 斜切：靠近两端时，一侧可用半宽线性收窄（前后侧分别算）
    const cz = 0.16;
    let limF = hwF - gap * 0.35, limB = hwB - gap * 0.35;
    if (local < cz) { const k = 1 - local / cz; limB -= cutA * k; limF -= cutA * k * 0.25; }
    if (local > 1 - cz) { const k = 1 - (1 - local) / cz; limF -= cutB * k; limB -= cutB * k * 0.25; }
    // 块形（v14）：四角独立切角（切角区占板长 30%）+ 侧边台阶（中心线跳变）
    if (shape) {
      const cz2 = 0.3;
      if (local < cz2) { const k = 1 - local / cz2; limF -= shape.cTF * k; limB -= shape.cTB * k; }
      if (local > 1 - cz2) { const k = 1 - (1 - local) / cz2; limF -= shape.cBF * k; limB -= shape.cBB * k; }
    }
    let dC = 0;
    if (shape && shape.step !== 0) {
      const sp = shape.stepPos;
      dC = local >= sp ? shape.step : local > sp - 0.05 ? (shape.step * (local - (sp - 0.05))) / 0.05 : 0;
    }
    const dd = d - dC;
    const hit = dd < 0 ? -dd <= limF : dd <= limB;
    return [hit, dd < 0 ? dd / hwF : dd / hwB, local];
  };
}
function silQuad(a: Pt, b: Pt, wA: number, wB: number, grow = 0, bulge: Bulge = { f: 0, b: 0 }, prof?: (t: number) => number) {
  const f = segFrame(a, b);
  return (x: number, y: number) => {
    const rx = x - a.x, ry = y - a.y;
    const t = (rx * f.ux + ry * f.uy) / f.len;
    if (t < -0.02 || t > 1.02) return false;
    const d = rx * f.px + ry * f.py;
    const baseHW = ((wA + (wB - wA) * t) / 2) * (prof ? prof(Math.max(0, Math.min(1, t))) : 1);
    const hwF = baseHW * (1 + bulge.f * bumpAt(t, 0.38)) + grow;
    const hwB = baseHW * (1 + bulge.b * bumpAt(t, 0.34)) + grow;
    return d >= -hwF && d <= hwB;
  };
}
// 多边形局部场：取多边形自身坐标系（用户定）——u 沿第一条边、
// v 从该边朝形心，面板线/刻面/端带全部贴件自身方向走，不再用
// 世界包围盒（斜置的件横线也跟着斜，不许出现世界横线）
function polyFrame(pts: Pt[]) {
  const p0 = pts[0], p1 = pts[1] ?? pts[0];
  let ex = { x: p1.x - p0.x, y: p1.y - p0.y };
  const el = Math.hypot(ex.x, ex.y);
  const ctr = { x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.y, 0) / pts.length };
  if (el < 0.001) { // 第一条边退化：回退世界包围盒
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    return { p0: { x: Math.min(...xs), y: Math.min(...ys) }, ex: { x: 1, y: 0 }, ey: { x: 0, y: 1 }, aMin: 0, aMax: Math.max(...xs) - Math.min(...xs), bMin: 0, bMax: Math.max(...ys) - Math.min(...ys) };
  }
  ex = { x: ex.x / el, y: ex.y / el };
  let ey = { x: -ex.y, y: ex.x };
  if ((ctr.x - p0.x) * ey.x + (ctr.y - p0.y) * ey.y < 0) ey = { x: -ey.x, y: -ey.y };
  let aMin = 1e9, aMax = -1e9, bMin = 1e9, bMax = -1e9;
  for (const q of pts) {
    const a = (q.x - p0.x) * ex.x + (q.y - p0.y) * ex.y, b = (q.x - p0.x) * ey.x + (q.y - p0.y) * ey.y;
    if (a < aMin) aMin = a; if (a > aMax) aMax = a; if (b < bMin) bMin = b; if (b > bMax) bMax = b;
  }
  return { p0, ex, ey, aMin, aMax, bMin, bMax };
}
function polyTest(pts: Pt[]) { // 多边形（护板/趾块）：局部坐标取自身框
  const F = polyFrame(pts);
  return (x: number, y: number): [boolean, number, number] => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    const a = (x - F.p0.x) * F.ex.x + (y - F.p0.y) * F.ex.y, b = (x - F.p0.x) * F.ey.x + (y - F.p0.y) * F.ey.y;
    return [inside, ((a - F.aMin) / ((F.aMax - F.aMin) || 1)) * 2 - 1, (b - F.bMin) / ((F.bMax - F.bMin) || 1)];
  };
}
// 高光棱模式登记（多边形件）：polyTest 的 (u,v) 是件自身框——
// 刻线唇（v=lv 的线、唇在其下 0.017）与竖缝唇（u=su 的线、唇在
// 其前 0.034）都在自身框内换算端点（棱 pass 按 owner 裁剪）
// 异形楔拼块（模式库「异形楔拼块」条目本体）：板面在自身
// (u,v) 框内由一个偏心内点向四边节点放射贴合缝、整面拼成异
// 形楔——每条缝的端点都落在板边上、缝与缝在内点贴合相接，
// 与肩部楔拱同一构造；不是轴向网格线。密度 <0.7 少一条边缝、
// ≥1.3 多一个内点（楔数随之增减）
interface WedgeLayout { segs: [number, number, number, number][]; courses?: number[]; joints?: number[][]; altCourse?: number }
// 异形楔·无中心变体：横层排砌块——层线在中途折一下（不笔直），
// 层内竖缝逐层错开不对缝，整面拼成大小不一的砌块；没有汇聚
// 中心。altCourse 指定一层走第二色调（由调用方参数给）
function wedgeAshlar(id: number, density: number, altCourse = -1, bands?: { v0?: number; v1?: number; uL?: number; uR?: number }): WedgeLayout {
  const h = (k: number) => (((id * 40503 + k * 104729 + 29) >>> 0) % 1000) / 1000;
  const c1 = 0.3 + h(1) * 0.12, c2 = 0.62 + h(2) * 0.12;
  const courses = [0, c1, c2, 1];
  const segs: [number, number, number, number][] = [];
  for (const [ci, c] of [c1, c2].entries()) {
    const m = (h(3 + ci) - 0.5) * 0.8, off = (h(5 + ci) - 0.5) * 0.05;
    segs.push([-1, c, m, c + off], [m, c + off, 1, c]);
  }
  const j0 = (h(7) - 0.5) * 0.9;
  const j1 = j0 + (h(8) < 0.5 ? -0.5 : 0.5);
  const j2 = j0 + (h(9) < 0.5 ? 0.35 : -0.35);
  const joints = [[j0], [j1], [j2]];
  if (density < 0.7) joints[1] = [];
  for (let k = 0; k < 3; k++) for (const j of joints[k]) segs.push([j, courses[k], j, courses[k + 1]]);
  return { segs: bands ? applyBandKinks(segs, bands, h(11) < 0.5 ? -1 : 1) : segs, courses, joints, altCourse };
}
// 料厚带位置（自动）：料厚棱线登记时点就落在带与板面的分
// 界上——楔模式从该件自己的棱线登记直接读出棱线在自身框四
// 边上的份额，不需要调用方再传料厚边/带宽
function wedgeBandsAuto(A: Anchors, inst: number): { v0?: number; v1?: number; uL?: number; uR?: number } | undefined {
  const pts = A.polyPts?.get(inst);
  if (!pts) return undefined;
  const bands = (A.thickBands ?? []).filter((b) => b.inst === inst);
  if (!bands.length) return undefined;
  const F = polyFrame(pts);
  const toUV = (px: number, py: number): [number, number] => { const a = (px - F.p0.x) * F.ex.x + (py - F.p0.y) * F.ex.y, b = (px - F.p0.x) * F.ey.x + (py - F.p0.y) * F.ey.y; return [((a - F.aMin) / ((F.aMax - F.aMin) || 1)) * 2 - 1, (b - F.bMin) / ((F.bMax - F.bMin) || 1)]; };
  const sides: { v0?: number; v1?: number; uL?: number; uR?: number } = {};
  for (const r of bands) {
    const mx = r.pts.reduce((s2, q) => s2 + q.x, 0) / r.pts.length, my = r.pts.reduce((s2, q) => s2 + q.y, 0) / r.pts.length;
    const [ru, rv] = toUV(mx, my);
    const v01 = rv;
    if (v01 < 0.25 && sides.v0 === undefined) sides.v0 = Math.max(0.02, Math.min(0.5, v01));
    if (v01 > 0.75 && sides.v1 === undefined) sides.v1 = Math.max(0.02, Math.min(0.5, 1 - v01));
    if (ru > 0.5 && sides.uR === undefined) sides.uR = Math.max(0.02, Math.min(0.5, (1 - ru) / 2));
    if (ru < -0.5 && sides.uL === undefined) sides.uL = Math.max(0.02, Math.min(0.5, (ru + 1) / 2));
  }
  return Object.keys(sides).length ? sides : undefined;
}
// 缝遇料厚带折角（模式内容，两变体共用）：终点落在带边上的
// 缝，在与高光棱线的交点处折向、终点沿边移开
function applyBandKinks(segs: [number, number, number, number][], bands: { v0?: number; v1?: number; uL?: number; uR?: number }, shSign: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const [x1, y1, x2, y2] of segs) {
    const side = y2 === 0 ? 'v0' : y2 === 1 ? 'v1' : x2 === -1 ? 'uL' : x2 === 1 ? 'uR' : null;
    const f = side ? bands[side] : undefined;
    if (!side || f === undefined) { out.push([x1, y1, x2, y2]); continue; }
    let t: number;
    if (side === 'v0') t = (f - y1) / ((y2 - y1) || 1);
    else if (side === 'v1') t = ((1 - f) - y1) / ((y2 - y1) || 1);
    else if (side === 'uL') t = ((-1 + 2 * f) - x1) / ((x2 - x1) || 1);
    else t = ((1 - 2 * f) - x1) / ((x2 - x1) || 1);
    if (!(t > 0.05 && t < 0.98)) { out.push([x1, y1, x2, y2]); continue; }
    const kx = x1 + (x2 - x1) * t, ky = y1 + (y2 - y1) * t;
    const sh = 0.16 * shSign;
    const ex = side === 'v0' || side === 'v1' ? x2 + sh : x2;
    const ey = side === 'uL' || side === 'uR' ? y2 + sh * 0.6 : y2;
    out.push([x1, y1, kx, ky], [kx, ky, ex, ey]);
  }
  return out;
}
// 楔拱（模式）：互相贴合的异形楔绕盘拼成拱。给盘心、内半径
// 与各扇区的角度界 + 外轮廓链（自弧行程末端一侧列向起始侧），
// 生成器统一出楔形：内缘弧点由角度公式同点生成、相邻楔共用
// 界线，拼合无缝无叠；外轮廓随周边走势、是不规则的那一半
interface WedgeSectorDef { a0: number; a1: number; outer: [number, number][]; tint?: number }
function wedgeArch(c: [number, number], ri: number, sectors: WedgeSectorDef[]): { poly: [number, number][]; arc: [number, number][]; outer: [number, number][]; tint?: number }[] {
  const arcPt = (deg: number): [number, number] => { const t = (deg * Math.PI) / 180; return [c[0] + ri * Math.cos(t), c[1] + ri * Math.sin(t)]; };
  return sectors.map((s) => {
    const arc: [number, number][] = [];
    const span = s.a1 - s.a0, n = Math.max(1, Math.round(span / 50));
    for (let k = 0; k <= n; k++) arc.push(arcPt(s.a0 + (span * k) / n));
    return { poly: [...arc, ...s.outer], arc, outer: s.outer, tint: s.tint };
  });
}
function wedgeSegs(id: number, density: number, bands?: { v0?: number; v1?: number; uL?: number; uR?: number }): [number, number, number, number][] {
  const h = (k: number) => (((id * 40503 + k * 7919 + 17) >>> 0) % 1000) / 1000;
  const nu = (h(1) - 0.5) * 0.7, nv = 0.3 + h(2) * 0.4;
  const tu = (h(3) - 0.5) * 1.2, bu = (h(4) - 0.5) * 1.2;
  const lv = 0.22 + h(5) * 0.56, rv = 0.22 + h(6) * 0.56;
  const raw: [number, number, number, number][] = [[nu, nv, tu, 0], [nu, nv, bu, 1], [nu, nv, -1, lv], [nu, nv, 1, rv]];
  if (density < 0.7) raw.splice(2, 1);
  if (density >= 1.3) { const au = (h(7) - 0.5) * 1.0, av = 0.3 + h(8) * 0.4; raw.push([nu, nv, au, av], [au, av, tu, 0], [au, av, 1, rv]); }
  if (!bands) return raw;
  return applyBandKinks(raw, bands, h(9) < 0.5 ? -1 : 1);
}
function polyLip(A: Anchors, bid: number, pts: Pt[], lv: number) {
  const F = polyFrame(pts);
  // 薄件不登记唇棱：唇带要占件高的一大块，6-7px 的漆带会被整
  // 片提亮成荧光（躯干条纹实测）——薄件本来也不该带面板缝
  if (F.bMax - F.bMin < 14) return;
  const b = F.bMin + (lv + 0.017) * (F.bMax - F.bMin);
  const at = (a: number) => ({ x: F.p0.x + F.ex.x * a + F.ey.x * b, y: F.p0.y + F.ex.y * a + F.ey.y * b });
  (A.ridges ??= []).push({ inst: bid, pts: [at(F.aMin), at(F.aMax)], tone: 1.17, panel: true });
  (A.ridgeMode ??= new Set()).add(bid);
}
/** 料厚模式的登记口：棱线高光代登记给高光棱模式，带面登记
 * 给料厚模式自己——调用方只报几何与量，不许把 faceW 塞进棱
 * 线登记里绕过分层 */
export function regThickness(A: Anchors, inst: number, pts: Pt[], tone: number, band: { faceW: number; faceDx?: number; faceDy?: number; faceTone?: number; noThick?: boolean }, panel?: boolean) {
  (A.ridges ??= []).push({ inst, pts, tone, thick: true, ...(panel ? { panel: true } : {}) });
  (A.thickBands ??= []).push({ inst, pts, ...band });
}
/** 缝模式的登记口：沟一条折线 + 受光侧参照线（可选，只定
 * 沟内哪一侧的沟壁受光、本身不画）；w = 沟半宽 px（缺省
 * 0.9 发丝沟；环箍这类台阶沟报宽值）。缝的画法（沟底压暗 +
 * 受光沟壁在沟内给高光、缝外无亮带）只在缝 pass 一处 */
export function regSeam(A: Anchors, inst: number, pts: Pt[], lipPts?: Pt[], w?: number, lipAt?: number) {
  (A.seams ??= []).push({ inst, pts, ...(lipPts ? { lipPts } : {}), ...(w !== undefined ? { w } : {}), ...(lipAt !== undefined ? { lipAt } : {}) });
}
/** 缸筒/管的环带（箍）登记口：lineTest 圆柱的三道环（两端 +
 * 正中，与旧基色公式分区分位相同）登记给缝模式——箍是缝，
 * 不许在基色公式里压暗。参照线沿轴朝屏幕上方一端偏置定受
 * 光侧（沟的上壁受光）。登记过的件记入 A.seamedCyl，基色
 * pass 据此跳过公式压暗 */
export function regCylHoops(A: Anchors, inst: number, a: Pt, b: Pt, r: number) {
  const f = segFrame(a, b);
  const w = Math.max(0.9, Math.min(6, f.len * 0.05));
  const upSgn = f.uy < 0 ? 1 : -1;
  for (const t of [0.05, 0.5, 0.95]) {
    const cxp = a.x + f.ux * f.len * t, cyp = a.y + f.uy * f.len * t;
    const seg: Pt[] = [{ x: cxp - f.px * r * 0.98, y: cyp - f.py * r * 0.98 }, { x: cxp + f.px * r * 0.98, y: cyp + f.py * r * 0.98 }];
    const lip = seg.map(p => ({ x: p.x + f.ux * upSgn * (w + 1.5), y: p.y + f.uy * upSgn * (w + 1.5) }));
    regSeam(A, inst, seg, lip, w);
  }
  (A.seamedCyl ??= new Set()).add(inst);
}
/** 波纹管登记口：管道模式的波纹变体——波纹沟沿轴按 pitch 密排
 * 登记给缝模式（与箍同一条路：沟是缝、画法在缝 pass 一处）。
 * 沟比箍窄（台阶小），参照线同箍式定受光侧 */
export function regBellows(A: Anchors, inst: number, a: Pt, b: Pt, r: number, pitch: number) {
  const f = segFrame(a, b);
  const w = Math.max(0.7, Math.min(2.2, pitch * 0.22));
  const upSgn = f.uy < 0 ? 1 : -1;
  const n = Math.max(2, Math.floor(f.len / pitch));
  for (let k = 1; k < n; k++) {
    const t = k / n, cxp = a.x + f.ux * f.len * t, cyp = a.y + f.uy * f.len * t;
    const seg: Pt[] = [{ x: cxp - f.px * r * 0.98, y: cyp - f.py * r * 0.98 }, { x: cxp + f.px * r * 0.98, y: cyp + f.py * r * 0.98 }];
    const lip = seg.map(q => ({ x: q.x + f.ux * upSgn * (w + 1.2), y: q.y + f.uy * upSgn * (w + 1.2) }));
    regSeam(A, inst, seg, lip, w);
  }
  (A.seamedCyl ??= new Set()).add(inst);
}
function polySeamLip(A: Anchors, bid: number, pts: Pt[], su: number) {
  const F = polyFrame(pts);
  if (F.aMax - F.aMin < 14) return; // 同上：窄件不登记竖缝唇棱
  const a = F.aMin + (((su - 0.034) + 1) / 2) * (F.aMax - F.aMin);
  const at = (b: number) => ({ x: F.p0.x + F.ex.x * a + F.ey.x * b, y: F.p0.y + F.ex.y * a + F.ey.y * b });
  (A.ridges ??= []).push({ inst: bid, pts: [at(F.bMin), at(F.bMax)], tone: 1.15, panel: true });
  (A.ridgeMode ??= new Set()).add(bid);
}
function discTest(c: Pt, r: number, rot = 0) {
  return (x: number, y: number): [boolean, number, number] => {
    const dx = x - c.x, dy = y - c.y;
    const d = Math.hypot(dx, dy);
    // 12 边形刻面外形：平边在 0.966r、棱角在 r（scout/MBT 的盖帽不是正圆）；rot 转刻面取向（轮毂用）
    const seg = ((Math.atan2(dy, dx) + rot + Math.PI) % (Math.PI / 6));
    const fr = r * (Math.cos(Math.PI / 12) / Math.cos(seg - Math.PI / 12));
    return [d <= fr, dx / r, d / r];
  };
}
function lineTest(a: Pt, b: Pt, r: number) {
  const f = segFrame(a, b);
  return (x: number, y: number): [boolean, number, number] => {
    const rx = x - a.x, ry = y - a.y;
    const t = (rx * f.ux + ry * f.uy) / f.len;
    if (t < 0 || t > 1) return [false, 0, 0];
    const d = rx * f.px + ry * f.py;
    return [Math.abs(d) <= r, d / r, t];
  };
}
function bezier(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y };
}

// ---------- 3×5 点阵字（贴纸） ----------
const FONT: Record<string, string[]> = {
  A: ['010', '101', '111', '101', '101'], C: ['011', '100', '100', '100', '011'],
  U: ['101', '101', '101', '101', '111'], T: ['111', '010', '010', '010', '010'],
  I: ['111', '010', '010', '010', '111'], O: ['010', '101', '101', '101', '010'],
  N: ['101', '111', '111', '101', '101'], M: ['101', '111', '111', '101', '101'],
  '-': ['000', '000', '111', '000', '000'], '7': ['111', '001', '010', '010', '010'],
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '010', '010', '010', '010'],
  '2': ['110', '001', '010', '100', '111'], '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '110', '001', '110'],
  '6': ['011', '100', '110', '101', '010'], '8': ['010', '101', '010', '101', '010'],
  '9': ['010', '101', '011', '001', '110'], ' ': ['000', '000', '000', '000', '000'],
};

// ---------- 布局 ----------
interface LegSpec { /** 髋梁横轴（模式库「髋梁横轴」）：部件集附带梁精灵，支架腿组装配挂它 */ hipBeam?: boolean; /** 支架张开：足相对髋的水平偏移占腿全长比（模式库「支架腿组」，装配双骨解算消费） */ standSplay?: number; /** 支架够达：髋足距占腿全长比（同上） */ standReach?: number; topology: 'standard' | 'reverse'; scheme: Scheme; seed: number; bend: number; camo: boolean; wear?: number; frameHeavy?: boolean; shellMode?: boolean; wScale?: number; lift?: number; guardOff?: boolean; detail?: number; ankleShift?: number; cableTint?: RGB; decalKind?: 'num' | 'plate' | 'none'; coreScale?: number; footType?: 'blocks' | 'shoe' | 'claw' | 'pad' | 'wheel'; /** 膝盖块厚度系数（用户可调，默认 1） */ kneeScale?: number; /** 腓肠隆起系数（用户可调，默认 1） */ calfScale?: number; /** 胫骨凹面深度系数（用户可调，默认 1；0 = 前缘不凹） */ shinConcave?: number; /** 履带相位帧专用：皮带行程 px，圆盘 pass 按同心最大半径折算转角（其余画布不设、零影响） */ beltPhase?: number; /** 轮足相位帧专用：轮行程 px，毂盘按胎外径折算转角、胎环扇区随之移（仅轮足画布设） */ wheelPhase?: number; /** 高光棱模式开关（模式库「高光棱」条目）：默认开；关时棱线 pass 不画、面着色公式对登记件保持跳过（无第二实现） */ ridges?: boolean; /** 缝模式开关（模式库「缝」条目）：默认开；关时缝 pass 不画 */ seams?: boolean; /** 料厚比（模式库「料厚」条目）：件端料厚 = 件厚 × 此比，默认 0.32 */ thickRatio?: number; /** 异形楔拼块（模式库「异形楔拼块」条目）：板面拼块密度；板线网默认由本模式绘制（未设 = 密度 1），显式 0 时回旧轴向线网（选「面板线」条目即置 0） */ wedges?: number;
  /** 进气口模式参数（模式库「进气口」条目 fpass-intake，着色组合）：
   * topTone/topGrad=顶面朝向倍率与沿深轴落差、rim=腔内上影高占比、
   * pitch=叶片节距 px、peak=叶片亮峰位置、fall=横向落光、accentSlats=
   * 叶片用强调色（荚口变体；胸口为金属叶片）。装口面倍率是构造侧按
   * 站点斜向给的（登记 ftone），不在此 */
  intake?: { rim?: number; pitch?: number; peak?: number; fall?: number; accentSlats?: boolean; topTone?: number; topGrad?: number } }
interface Anchors {
  plateTint: Map<number, number>; panelLines: Map<number, number[]>;
  boltPts: Pt[]; ventId: number; guardId: number; stripeId: number;
  decalPos: Pt; numPos: Pt; numText: string; lightPts: Pt[];
  discs: { id: number; c: Pt; r: number; hv: number; hub?: boolean }[];
  chevrons: [Pt, Pt][];
  seamU: Map<number, number>; insignia: { pos: Pt; kind: number };
  stripeThigh: number; blockPlates: Set<number>;
  deviceFrame: { c: Pt; ux: number; uy: number; px: number; py: number } | null; chevDecal: boolean;
  shinIds: Set<number>; stripeSegs: { p1: Pt; p2: Pt; w?: number; ids?: Set<number> }[];
  panelDiag: Map<number, number>; panelTee: Map<number, number>; decalKind: string; toeFace: { x0: number; y0: number; x1: number; y1: number } | null; colorRole?: Map<number, string>;
  /** 进气口（立体绘制模式）：壳体实例在此登记，着色层单一 pass
   * 按「轮廓→框唇→腔体→百叶」配方在壳体自身像素上画 */
  intakes?: { id: number; cx: number; cy: number; w: number; h: number; face: 'front' | 'top' | 'side' | 'face'; ftone?: number; quad?: [Pt, Pt, Pt, Pt]; band?: boolean }[];
  /** 高光棱模式（模式库「高光棱」条目）：一切高光棱在此登记，
   * 着色层的高光棱 pass 逐条调用高光算子在件自身像素上画。
   * pts=棱线折线；tone=提亮倍率；登记过的件进 ridgeMode，其面
   * 着色公式内的旧棱线项跳过。开关在规格层（LegSpec.ridges） */
  ridges?: { inst: number; pts: Pt[]; tone: number; noThick?: boolean; panel?: boolean; thick?: boolean }[];
  /** 料厚模式（模式库「料厚」条目）：登记走 regThickness——它
   * 把棱线的高光代登记给高光棱模式（料厚模式调用高光棱模式），
   * 带面本身（棱线前侧 faceW 宽、faceTone 平色差）归本表、由
   * 料厚 pass 画。wedgeBandsAuto 与切面抑制都读本表 */
  thickBands?: { inst: number; pts: Pt[]; faceW: number; faceDx?: number; faceDy?: number; faceTone?: number; noThick?: boolean }[];
  /** 缝模式（模式库「缝」条目）：登记走 regSeam——一道沟 +
   * 受光侧参照线（lipPts，可选、只定侧不画）；缝 pass 在沟
   * 内给调子：沟底压暗、受光沟壁给高光（缝模式调用高光算
   * 子）、缝外无亮带。各处只登记缝，不许自己画沟。开关在
   * 规格层（LegSpec.seams） */
  seams?: { inst: number; pts: Pt[]; lipPts?: Pt[]; w?: number; lipAt?: number }[];
  /** 箍已登记给缝模式的 cyl 件（杆/罐）：基色 pass 对这些件
   * 不再用公式压暗环带——箍是缝、归缝模式画 */
  seamedCyl?: Set<number>;
  /** 球模式登记：整球（瞄具桅球等）——着色层按球面法线走三
   * 大面五调子配方（domePx），role 定基色 */
  balls?: { x: number; y: number; r: number; role?: string }[];
  wedgeSegs?: Map<number, WedgeLayout>;
  wedgePlates?: Set<number>;
  wedgeAshlar?: Map<number, number>;
  polyPts?: Map<number, Pt[]>;
  ridgeMode?: Set<number>;
  /** 轮足毂心 + 胎外径（圆盘 pass 按胎外径折算毂盘转角用；仅轮足布局登记） */
  wheelHubs?: { c: Pt; r: number }[];
}
function layout(cv: MechaCanvas, spec: LegSpec, pre?: { hip: Pt; knee: Pt; ankle: Pt; toeX: number }): Anchors {
  const rnd = mulberry32(spec.seed);
  const std = spec.topology === 'standard';
  const hip: Pt = pre?.hip ?? { x: 170, y: 44 };
  const knee: Pt = pre?.knee ?? (std ? { x: 236 + spec.bend, y: 248 } : { x: 112 + spec.bend, y: 244 });
  const ankle: Pt = pre?.ankle ?? { x: 178 + (std ? -1 : 1) * (spec.ankleShift ?? 10), y: 434 };
  const toeX = pre?.toeX ?? ankle.x + 100;
  const ws = spec.wScale ?? 1;
  const thigh = { a: hip, b: knee, wA: 110 * ws, wB: 84 * ws, bulge: { f: 0.16, b: 0.05 } };
  // 小腿去人形化（用户定）：腓肠（后隆起）夸张、前缘（胫骨侧）改凹
  // ——人腿是前直后胀的平滑曲线，机甲腿要前凹后凸的机械剖面；
  // 两者都是用户可调参数（calfScale / shinConcave，默认 1）
  const shin = { a: knee, b: ankle, wA: 100 * ws, wB: 64 * ws, bulge: { f: -0.38 * (spec.shinConcave ?? 1), b: 0.42 * (spec.calfScale ?? 1) } };
  // 腓肠表面相对默认（bulge.b = 0.42）的外移量：背侧附件（导轨/
  // 排气/挂盒/线缆）按它跟随，腓肠参数变化时不埋进也不飘离表面
  const calfDelta = (t: number) => ((shin.wA + (shin.wB - shin.wA) * t) / 2) * (shin.bulge.b - 0.42) * bumpAt(t, 0.34);
  // 剪影
  const segProf = (t: number) => (1 - 0.13 * Math.exp(-((t / 0.09) ** 2)) - 0.13 * Math.exp(-(((1 - t) / 0.09) ** 2))) * (t > 0.52 ? 0.95 : 1);
  for (const s of [thigh, shin]) markSil(cv, silQuad(s.a, s.b, s.wA, s.wB, 2, { f: s.bulge.f * 0.5, b: s.bulge.b * 0.5 }, segProf)); // 包络隆起减半：原隆起全量是过 claim（板面才是外表面）
  for (const [j, r] of [[hip, 36], [knee, 34], [ankle, 21]] as [Pt, number][]) markSil(cv, (x, y) => Math.hypot(x - j.x, y - j.y) <= r);
  markSil(cv, silQuad({ x: ankle.x - 8, y: 448 }, { x: toeX, y: 458 }, 38, 30, 2));
  // 切角块多边形（关节壳体/毂块/脚块共用）
  const blockPoly = (cx: number, cy: number, w: number, h: number, ang: number, cham: number): Pt[] => {
    const ca = Math.cos(ang), sa = Math.sin(ang), lx = w / 2, ly = h / 2, c = (Math.min(w, h) * cham) / 2;
    const raw: Pt[] = [
      { x: -lx + c, y: -ly }, { x: lx - c, y: -ly }, { x: lx, y: -ly + c }, { x: lx, y: ly - c },
      { x: lx - c, y: ly }, { x: -lx + c, y: ly }, { x: -lx, y: ly - c }, { x: -lx, y: -ly + c },
    ];
    return raw.map((q) => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
  };
  let id = 0;
  const A: Anchors = { plateTint: new Map(), panelLines: new Map(), boltPts: [], ventId: -1, guardId: -1, stripeId: -1, decalPos: { x: 0, y: 0 }, numPos: { x: 0, y: 0 }, numText: '', lightPts: [], discs: [], chevrons: [], seamU: new Map(), insignia: { pos: { x: 0, y: 0 }, kind: 0 }, stripeThigh: -1, blockPlates: new Set(), deviceFrame: null, chevDecal: true, shinIds: new Set(), stripeSegs: [], panelDiag: new Map(), panelTee: new Map(), decalKind: 'num', toeFace: null, colorRole: new Map() };
  const addPlate = (a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap: number, cutA: number, cutB: number, kind: Kind = 'plate', bulge: Bulge = { f: 0, b: 0 }, clipFn?: (x: number, y: number) => boolean) => {
    // 独立成廓：每块板绕自身中心微转 + 横移 + 出边，轮廓在接缝处出天然台阶
    const js = (spec.shellMode ? 0.4 : 1) * (kind === 'foot' ? 0.5 : 1);
    const jit = (rnd() - 0.5) * 6.4 * js, rot = (rnd() - 0.5) * 0.11 * js, proud = 1 + (0.02 + rnd() * 0.1) * js;
    const f0 = segFrame(a, b), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const rotPt = (p: Pt): Pt => {
      const dx = p.x - mx, dy = p.y - my;
      return { x: mx + dx * Math.cos(rot) - dy * Math.sin(rot) + f0.px * jit, y: my + dx * Math.sin(rot) + dy * Math.cos(rot) + f0.py * jit };
    };
    const a2 = rotPt(a), b2 = rotPt(b);
    // 逐块形状：四角切角量（3/10 近直角，其余大切角）+ 侧边台阶
    const hwAvg = (wA + wB) / 4, shScale = kind === 'foot' ? 0.5 : 1;
    const cham = () => (rnd() < 0.3 ? rnd() * 5 : (0.2 + rnd() * 0.8) * hwAvg * 0.9) * shScale;
    const shape: PlateShape = { cTF: cham(), cTB: cham(), cBF: cham(), cBB: cham(), step: rnd() < 0.4 ? (rnd() - 0.5) * 14 : 0, stepPos: 0.3 + rnd() * 0.4 };
    const wrapClip = (t: (x: number, y: number) => [boolean, number, number]) => clipFn ? (x: number, y: number): [boolean, number, number] => { const r = t(x, y); return r[0] && !clipFn(x, y) ? r : [false, 0, 0] as [boolean, number, number]; } : t;
    if (kind === 'plate') { // 板衬边：同形宽 ×1.05 的框垫片，属板组件
      cv.insts.push({ kind: 'frame' });
      fillShape(cv, id, wrapClip(plateTest(a2, b2, wA * proud * 1.05, wB * proud * 1.05, Math.max(0, t0 - 0.008), Math.min(1, t1 + 0.008), 0, cutA, cutB, bulge, shape))); id++;
    }
    cv.insts.push({ kind }); const myId = id;
    fillShape(cv, id, wrapClip(plateTest(a2, b2, wA * proud, wB * proud, t0, t1, gap, cutA, cutB, bulge, shape))); id++;
    A.plateTint.set(myId, [0.78, 0.9, 1.0, 1.1, 1.24][Math.floor(rnd() * 5)]);
    const lines: number[] = []; const dtl = spec.detail ?? 1;
    const n = dtl < 0.7 ? (rnd() < 0.55 ? 0 : 1) : dtl > 1.1 ? 2 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) lines.push(0.3 + rnd() * 0.45);
    A.panelLines.set(myId, lines);
    A.seamU.set(myId, -0.42 + rnd() * 0.84); // 竖向面板缝位置
    if ((spec as LegSpec).shellMode && rnd() < 0.45) A.blockPlates.add(myId); // 人形壳：色块板
    if (rnd() < 0.3) A.panelDiag.set(myId, (rnd() - 0.5) * 0.9); // 斜面板线（错位网络）
    if (rnd() < 0.35) A.panelTee.set(myId, -0.5 + rnd()); // T 型接头竖线位置
    // 高光棱模式登记（kind=plate）：折棱、刻线唇、竖缝唇全部改走
    // 模式 pass——采样点与 plateTest 的 (u,v) 场同式，保证棱贴面走
    if (kind === 'plate') {
      const fr = segFrame(a2, b2);
      const hwAt = (t: number, front: boolean) => {
        const baseHW = (wA * proud + (wB * proud - wA * proud) * t) / 2;
        return front ? baseHW * (1 + bulge.f * bumpAt(t, 0.38)) : baseHW * (1 + bulge.b * bumpAt(t, 0.34));
      };
      const ptAt = (t: number, dd: number): Pt => {
        const local = (t - t0) / (t1 - t0);
        let dC = 0;
        if (shape && shape.step !== 0) { const sp = shape.stepPos; dC = local >= sp ? shape.step : local > sp - 0.05 ? (shape.step * (local - (sp - 0.05))) / 0.05 : 0; }
        return { x: a2.x + fr.ux * t * fr.len + fr.px * (dd + dC), y: a2.y + fr.uy * t * fr.len + fr.py * (dd + dC) };
      };
      const lineAtU = (uu: number, l0: number, l1: number): Pt[] => {
        const pts: Pt[] = [];
        for (let k = 0; k <= 4; k++) { const local = l0 + (l1 - l0) * k / 4, t = t0 + local * (t1 - t0); pts.push(ptAt(t, uu * hwAt(t, uu < 0))); }
        return pts;
      };
      (A.ridgeMode ??= new Set()).add(myId);
      const h2 = (((myId * 40503 + 7) >>> 0) % 100) / 100, h3 = (((myId * 2246822519) >>> 0) % 100) / 100;
      if (h3 >= 0.3) (A.ridges ??= []).push({ inst: myId, pts: lineAtU(0.15 + h2 * 0.5, 0.05, 0.95), tone: 1.15 }); // 主折线亮棱
      const dg = A.panelDiag.get(myId) ?? 0;
      for (const lv of lines) { // 刻线下唇受光
        const tF = t0 + (lv + dg * -1 * 0.45 + 0.017) * (t1 - t0), tB = t0 + (lv + dg * 1 * 0.45 + 0.017) * (t1 - t0);
        (A.ridges ??= []).push({ inst: myId, pts: [ptAt(tF, -hwAt(tF, true) * 0.97), ptAt(tB, hwAt(tB, false) * 0.97)], tone: 1.17, panel: true });
      }
      const su = A.seamU.get(myId); // 竖缝前侧受光唇
      if (su !== undefined) (A.ridges ??= []).push({ inst: myId, pts: lineAtU(su - 0.034, 0.14, 0.86), tone: 1.15, panel: true });
    }
    // 铆钉点：沿板两侧缘（跟随抖动后的板框）
    const f = segFrame(a2, b2);
    for (const vv of [0.14, 0.5, 0.86]) for (const ss of [-0.8, 0.8]) {
      const t = t0 + (t1 - t0) * vv, hw = ((wA + (wB - wA) * t) / 2) * proud;
      A.boltPts.push({ x: a2.x + f.ux * f.len * t + f.px * hw * ss, y: a2.y + f.uy * f.len * t + f.py * hw * ss });
    }
    return myId;
  };
  // 1) 内框杆（垫底）：沿轴窄带 + 关节间连接杆
  // 内体：沿关节链的结构核，半径自定（髋 26→膝 23→踝 16，×coreScale），与包络参数无关
  {
    const coreR = (spec.coreScale ?? 1) * (spec.frameHeavy ? 1.12 : 1);
    const coreSegs: [Pt, Pt, number, number][] = [[hip, knee, 34, 30], [knee, ankle, 30, 21]]; // v29 等比放大（29/25.5/18），收分剖面不变
    cv.insts.push({ kind: 'frame' });
    fillShape(cv, id, (x, y) => {
      let best: [boolean, number, number] = [false, 0, 0];
      for (let si = 0; si < 2; si++) {
        const [a, b, ra, rb] = coreSegs[si];
        const ux = b.x - a.x, uy = b.y - a.y, len = Math.hypot(ux, uy) || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ux + (y - a.y) * uy) / (len * len)));
        const d = Math.hypot(x - (a.x + ux * t), y - (a.y + uy * t)), r = (ra + (rb - ra) * t) * coreR;
        if (d <= r) { const uu = d / r, vv = (si + t) / 2; if (!best[0] || uu < best[1]) best = [true, uu, vv]; }
      }
      return best;
    }); id++;
  }
  // 模式「关节内构衬底」（模式库 L1）：关节盘四周衬暗内构、凹口不
  // 露背景。在一切段板/足块/关节件之前画，只在盘缘外的缺口里露
  // 出。块表 = [相对盘心偏移, 宽, 高, 角]：壳块沿小腿轴、盘下块、
  // 前上延块（衬住压块后上方凹口——旧版此处只有小腿板衬边一角探
  // 进背景成孤立暗三角，衬满后同为暗框色、三角融进衬底）。
  // 踝/膝/髋三处均已执行（膝/髋衬块紧随踝表之后）
  {
    const aAng = Math.atan2(ankle.y - knee.y, ankle.x - knee.x);
    const clipGround = (poly: Pt[]) => { const t = polyTest(poly); return (x: number, y: number): [boolean, number, number] => (y <= 469 ? t(x, y) : [false, 0, 0]); };
    const BACKING: [number, number, number, number, number][] = [
      [-6, 4, 74, 64, aAng], [8, 25, 62, 18, 0.1], [40, -22, 64, 44, -0.40],
      [45, 3, 30, 16, 0], // 盘右缝：盘缘与压块套连带之间
      [13, 40, 34, 20, 0], // 中足底缝：跟块与趾1 之间、压块之下到地线
      [62, 13, 84, 14, 0], // 足前衬底上沿补条：垫到楔板/压块底边之下，封顶边一线缝
      [-6, 40, 26, 18, 0], // 踝下后缝：踝正下方偏后、跟块与足底之间（橄榄实测 2px）
      [90, 30, 112, 30, 0], // 足前衬底：整条垫满趾排上方——趾顶是逐级台阶（442/444/447）、楔板与压块底边是另一组斜线、旧块 70×27 带倾角盖不住两组线之间的三角与条带，趾与楔之间漏出整条透光缝（用户指）；整排一长条沉到最低趾顶之下、先画垫底，只在缝里露暗内构色
    ];
    for (const [dx, dy, w, h, ang] of BACKING) {
      cv.insts.push({ kind: 'frame' });
      fillShape(cv, id, clipGround(blockPoly(ankle.x + dx, ankle.y + dy, w, h, ang, 0.3))); id++;
    }
    // 膝/髋衬底（同模式补齐）：盘后楔区 + 沿两段背侧的衬块，弯腿时
    // 凹侧张开也不露背景；同为垫底先画，只在缺口里露暗内构色
    const tAng = Math.atan2(knee.y - hip.y, knee.x - hip.x);
    // 前楔下尖接缝衬垫（只有前楔块后必需）：小腿侧楔撤除后，
    // 前楔下尖与小腿板上端前角之间在前轮廓上夹出 1–3px 透光
    // 缝（变体门实测：洞在膝心相对 (+49, +47)——前楔外链下段
    // 与小腿板前角之间）——垫块沉在两板之下、只封缝不改轮廓
    {
      const sd = { x: ankle.x - knee.x, y: ankle.y - knee.y }; const ls = Math.hypot(sd.x, sd.y) || 1; sd.x /= ls; sd.y /= ls;
      const pfp = { x: sd.y, y: -sd.x }; if (pfp.x < 0) { pfp.x = -pfp.x; pfp.y = -pfp.y; }
      const pc = { x: knee.x + sd.x * 44 + pfp.x * 48 * ws, y: knee.y + sd.y * 44 + pfp.y * 48 * ws };
      cv.insts.push({ kind: 'frame' });
      fillShape(cv, id, clipGround(blockPoly(pc.x, pc.y, 36, 32, Math.atan2(sd.y, sd.x), 0.3))); id++;
    }
    const KNEE_BACKING: [number, number, number, number, number][] = [
      [-30, 0, 64, 72, aAng], [-34, -36, 56, 44, tAng], [-30, 38, 56, 42, aAng],
    ];
    for (const [dx, dy, w, h, ang] of KNEE_BACKING) {
      cv.insts.push({ kind: 'frame' });
      fillShape(cv, id, clipGround(blockPoly(knee.x + dx, knee.y + dy, w, h, ang, 0.3))); id++;
    }
    const HIP_BACKING: [number, number, number, number, number][] = [
      [-16, -14, 76, 60, tAng], [-38, 8, 56, 56, tAng],
    ];
    for (const [dx, dy, w, h, ang] of HIP_BACKING) {
      cv.insts.push({ kind: 'frame' });
      fillShape(cv, id, clipGround(blockPoly(hip.x + dx, hip.y + dy, w, h, ang, 0.3))); id++;
    }
    // 段背衬条（同模式）：小腿后侧板前缘与活塞杆之间有一条楔
    // 形空腔（正直画布 cy340 实测：板边 x149、杆 x161、中间
    // 11px 全空；变体门敏捷 281px、动力服同型）——沿段背侧垫
    // 暗内构长条，外界压在既有轮廓之内（板后缘/缆线更靠后），
    // 只封空腔不改剪影；大腿背侧同理垫一条（板缝小口袋）
    const backStrip = (s: { a: Pt; b: Pt }, t0: number, t1: number, dIn: number, dOut: number) => {
      const f = segFrame(s.a, s.b); const sgn = std ? 1 : -1;
      const B = (t: number, d: number): Pt => ({ x: s.a.x + f.ux * f.len * t + f.px * d * sgn, y: s.a.y + f.uy * f.len * t + f.py * d * sgn });
      cv.insts.push({ kind: 'frame' });
      fillShape(cv, id, clipGround([B(t0, dOut), B(t1, dOut), B(t1, dIn), B(t0, dIn)])); id++;
    };
    backStrip(shin, 0.40, 0.90, 16, 46);
    backStrip(thigh, 0.38, 0.72, 16, 48);
  }
  // 框梁（仅框主导族）：窄板挂在露出的框梁上，段侧缘带归框梁（按段规格定宽，与甲板同源）
  if (spec.frameHeavy) for (const sgm of [thigh, shin]) {
    cv.insts.push({ kind: 'frame' });
    fillShape(cv, id, plateTest(sgm.a, sgm.b, sgm.wA * 0.82, sgm.wB * 0.82, 0, 1, 0, 0, 0, sgm.bulge)); id++;
  }
  // （v29 删）中心脊线：髋→踝一根直杆斜穿弯曲关节，形态错误；垫底由沿关节链的分段结构核承担
  // 2) 线缆：髋后 → 膝后 → 踝后两段贝塞尔（采样点盖章）
  const backOf = (s: { a: Pt; b: Pt }, t: number, off: number): Pt => {
    const f = segFrame(s.a, s.b);
    const sgn = std ? 1 : -1;
    return { x: s.a.x + f.ux * f.len * t + f.px * off * sgn, y: s.a.y + f.uy * f.len * t + f.py * off * sgn };
  };
  const cablePts: Pt[] = [];
  const sag = (spec.seed % 4) * 3 + (spec.guardOff ? 3 : 0);
  for (let k = 0; k <= 22; k++) cablePts.push(bezier(backOf(thigh, 0.06, 40), backOf(thigh, 0.5, 52 + sag), backOf(thigh, 0.97, 36), k / 22));
  for (let k = 0; k <= 22; k++) cablePts.push(bezier(backOf(shin, 0.04, 40 + calfDelta(0.04)), backOf(shin, 0.5, 58 + sag * 0.8 + calfDelta(0.5)), backOf(shin, 0.96, 32 + calfDelta(0.96)), k / 22));
  cv.insts.push({ kind: 'cable' });
  fillShape(cv, id, (x, y) => { let m = 1e9; for (const p of cablePts) m = Math.min(m, Math.hypot(x - p.x, y - p.y)); return [m <= 5.5, 0, m / 5.5]; }); id++;
  for (const e of [cablePts[0], cablePts[cablePts.length - 1]]) { cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, discTest(e, 4.5)); id++; } // 线缆端头接头
  // 3) 段板：种子不等分 2–3 块，每块独立宽缩放/收分/切角/间隙
  const fw = spec.frameHeavy ? 0.68 : 1;
  const fg = spec.shellMode ? 1.4 : spec.frameHeavy ? 8.5 : 5;
  const segPlates = (seg: { a: Pt; b: Pt; wA: number; wB: number; bulge: Bulge }, clipFn?: (x: number, y: number) => boolean): number[] => {
    const n = spec.shellMode ? 2 : (rnd() < 0.35 ? 3 : 2);
    const cuts: number[] = [0.006];
    if (n === 2) cuts.push(0.3 + rnd() * 0.38);
    else { const c1 = 0.18 + rnd() * 0.2; cuts.push(c1, c1 + 0.24 + rnd() * 0.26); }
    cuts.push(0.996);
    const ids: number[] = [];
    for (let k = 0; k < n; k++) {
      const sA = (0.97 + rnd() * 0.28) * fw, sB = (0.97 + rnd() * 0.28) * fw; // 逐块独立宽与收分（v29 宽度分布整体上移，保形态扩）
      ids.push(addPlate(seg.a, seg.b, seg.wA * sA, seg.wB * sB, cuts[k], cuts[k + 1], fg * (0.6 + rnd() * 1.1), rnd() * 24, rnd() * 24, 'plate', seg.bulge, clipFn));
    }
    return ids;
  };
  const thighIds = segPlates(thigh);
  // 模式「膝上盖板」（模式库 L1）：段板组单板特例——只盖前侧的一
  // 条板，末端越过膝心续盖，填平末板切角在膝前上方留的凹口；后半
  // 不设（对照参考：膝后是暗的关节凹口）。参数：沿段 t 0.84→1.07、
  // 前缘贴大腿板前表面 +3、后缘收到轴线前 6
  {
    const CAP = { t0: 0.84, t1: 1.07, backIn: 6, proud: 3 };
    const frontOff = (t: number) => ((thigh.wA + (thigh.wB - thigh.wA) * t) / 2) * (1 + thigh.bulge.f * bumpAt(t, 0.38)) + CAP.proud;
    cv.insts.push({ kind: 'plate' }); const sid = id;
    const capPts = [
      backOf(thigh, CAP.t0, -frontOff(CAP.t0)), backOf(thigh, CAP.t1, -frontOff(CAP.t1)),
      backOf(thigh, CAP.t1, -CAP.backIn), backOf(thigh, CAP.t0, -CAP.backIn),
    ];
    fillShape(cv, id, polyTest(capPts)); id++;
    A.plateTint.set(sid, 1.0); A.panelLines.set(sid, [0.5]);
    polyLip(A, sid, capPts, 0.5);
  }
  A.stripeThigh = thighIds[0];
  A.ventId = thighIds[thighIds.length - 1];
  // 小腿板止于压块套靠指尖一侧的端边：套整体是斜的、该端是一条边，
  // 板角越过这条边就成了挂在边上的孤角。按套的局部坐标盒裁小腿板
  // （含衬边）——盒内其余位置本就被压块/连带盖住、裁掉不可见，
  // 只有越界的角被收回（套的几何与 §5 同一数据：D=50、主线 -0.40）
  const shinClip = (x: number, y: number): boolean => {
    const D = 50, HS = (spec.wScale ?? 1) >= 1.3 ? 1.12 : 1, LA = -0.40;
    const dx = Math.cos(LA), dy = Math.sin(LA), nx = -dy, ny = dx;
    const scx = ankle.x + dx * 0.62 * D, scy = ankle.y + dy * 0.62 * D;
    const u = dx * (x - scx) + dy * (y - scy), v = nx * (x - scx) + ny * (y - scy);
    const hl = 0.95 * D * HS / 2, ht = 0.58 * D / 2;
    return u > hl - 4 && u < hl + 30 && v > -ht - 18 && v < ht + 18;
  };
  // 活塞帮手提前定义：小腿活塞要在段板之前画（见下）
  const piston = (a: Pt, b: Pt, rC = 10, rR = 5.5) => {
    const mid = { x: a.x + (b.x - a.x) * 0.5, y: a.y + (b.y - a.y) * 0.5 };
    cv.insts.push({ kind: 'cyl' }); const pcId = id; fillShape(cv, id, lineTest(a, mid, rC)); id++;
    regCylHoops(A, pcId, a, mid, rC); // 缸筒环带是箍：登记给缝模式
    cv.insts.push({ kind: 'rod' }); fillShape(cv, id, lineTest(mid, b, rR)); id++;
    for (const e of [a, b]) { cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, discTest(e, rC * 0.9)); id++; }
  };
  const shinIds = segPlates(shin, shinClip);
  A.shinIds = new Set(shinIds);
  if (spec.shellMode) {
    const sf = segFrame(shin.a, shin.b); const sgn2 = std ? -1 : 1;
    const SP = (t: number, off: number): Pt => ({ x: shin.a.x + sf.ux * sf.len * t + sf.px * sgn2 * off, y: shin.a.y + sf.uy * sf.len * t + sf.py * sgn2 * off });
    A.stripeSegs = [{ p1: SP(0.08, 26), p2: SP(0.92, -14) }];
  }
  // 5) 脚：跟块/掌块/趾块（切角块组，与全图同一套块语言）
  const footBlock = (cx: number, cy: number, w: number, h: number, ang: number, cham = 0.38, seam?: number) => {
    cv.insts.push({ kind: 'foot' }); const bid = id;
    const bp = blockPoly(cx, cy, w, h, ang, cham);
    fillShape(cv, id, polyTest(bp)); id++;
    A.plateTint.set(bid, [0.9, 1.0, 1.08][Math.floor(rnd() * 3)]);
    A.panelLines.set(bid, [0.5]);
    polyLip(A, bid, bp, 0.5);
    if (seam !== undefined) { A.seamU.set(bid, seam); polySeamLip(A, bid, bp, seam); } // 趾帽竖缝
  };
  // 足（v29 四型，全由有厚度的块组成；底面标高 470，块顶分级下行、块间叠压相接）
  const ft = spec.footType ?? 'blocks';
  if (ft === 'claw') {
    // 分趾爪足：基座块 + 前趾两节 + 后趾两节（趾块带转角下探、远节贴地）
    footBlock(ankle.x, 446, 46, 24, 0.05);
    footBlock(ankle.x + 30, 452, 52, 19, 0.4);
    footBlock(ankle.x + 68, 463, 46, 14, 0.06, 0.5);
    footBlock(ankle.x - 29, 452, 46, 18, -0.4);
    footBlock(ankle.x - 60, 463, 40, 13, -0.06, 0.5);
  } else if (ft === 'pad') {
    // 宽掌垫足：宽平基座 + 前段块 + 跟块（低矮、掌面宽）
    footBlock((ankle.x + toeX) / 2 + 4, 460, toeX - ankle.x + 62, 20, 0.01, 0.3);
    footBlock(toeX - 8, 453, 56, 15, 0.02, 0.45);
    footBlock(ankle.x - 20, 455, 44, 16, 0.03);
  } else if (ft === 'wheel') {
    // 轮足（据生成参考）：踝毂整流罩 + 主轮（胎环+毂盘+毂盖）+ 后小轮
    // + 减震杆（小腿→两毂）+ 后稳定橇；轮底与足底同高（470）
    footBlock(ankle.x + 10, 416, 64, 34, 0.06); // 踝毂罩：跨踝关节
    footBlock(ankle.x + 24, 426, 46, 20, 0.45); // 毂臂：踝→主轮毂斜撑
    { cv.insts.push({ kind: 'disc' }); fillShape(cv, id, discTest(ankle, 13)); id++; }
    const hubM = { x: ankle.x + 34, y: 426 }, hubR = { x: ankle.x - 44, y: 440 };
    // 滚动相位：轮图样是 12 扇区旋转对称（有限群一圈只有 12 个等价位），
    // 转角按胎外径折算（行程/半径）；胎环扇区分带与毂盘刻面同相位转
    const spinM = (spec.wheelPhase ?? 0) / 44, spinR = (spec.wheelPhase ?? 0) / 30;
    const ringV = (x: number, y: number, c: Pt, spin: number) => {
      const a = Math.atan2(y - c.y, x - c.x) + spin;
      const sec = Math.floor((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 6));
      return sec % 2 === 0 ? 0.36 : 0.64;
    };
    (A.wheelHubs ??= []).push({ c: hubM, r: 44 }, { c: hubR, r: 30 });
    { cv.insts.push({ kind: 'frame' }); fillShape(cv, id, (x, y) => { const d = Math.hypot(x - hubM.x, y - hubM.y); return d >= 30 && d <= 44 ? [true, (d - 30) / 14, ringV(x, y, hubM, spinM)] : [false, 0, 0]; }); id++; } // 主轮胎环
    { cv.insts.push({ kind: 'disc' }); const did = id; fillShape(cv, id, discTest(hubM, 30, spinM)); A.discs.push({ id: did, c: hubM, r: 30, hv: A.discs.length % 3 }); id++; }
    { cv.insts.push({ kind: 'disc' }); const did = id; fillShape(cv, id, discTest(hubM, 15, spinM)); A.discs.push({ id: did, c: hubM, r: 15, hv: A.discs.length % 3 }); id++; }
    { cv.insts.push({ kind: 'frame' }); fillShape(cv, id, (x, y) => { const d = Math.hypot(x - hubR.x, y - hubR.y); return d >= 20 && d <= 30 ? [true, (d - 20) / 10, ringV(x, y, hubR, spinR)] : [false, 0, 0]; }); id++; } // 后轮胎环
    { cv.insts.push({ kind: 'disc' }); const did = id; fillShape(cv, id, discTest(hubR, 20, spinR)); A.discs.push({ id: did, c: hubR, r: 20, hv: A.discs.length % 3 }); id++; }
    { cv.insts.push({ kind: 'disc' }); const did = id; fillShape(cv, id, discTest(hubR, 9, spinR)); A.discs.push({ id: did, c: hubR, r: 9, hv: A.discs.length % 3 }); id++; }
    { cv.insts.push({ kind: 'rod' }); fillShape(cv, id, lineTest({ x: ankle.x - 2, y: 372 }, hubM, 4)); id++; } // 减震杆
    { cv.insts.push({ kind: 'rod' }); fillShape(cv, id, lineTest({ x: ankle.x - 8, y: 388 }, hubR, 3)); id++; }
    footBlock(ankle.x - 88, 466, 26, 8, 0.08); // 后稳定橇
  } else {
    // 重装/主战足型（blocks，据两张参考高清裁图提取）：跟块 + 两级长板
    // 趾（顶面逐级下行、底面共一线）+ 脚背斜板（自踝盘上方斜下前方、
    // 前端压住中趾板）。旧构造的问题：脚背是近水平的横条、趾段是
    // 一掌一趾两块短块——参考里是两级长板与真斜板。
    const heavy = (spec.wScale ?? 1) >= 1.3;
    if (ft === 'shoe') {
      { // 踝上整流罩：靴筒块（shoe 专用，敏捷鞋形另有其式）
        cv.insts.push({ kind: 'plate' }); const fid = id;
        const fp = blockPoly(ankle.x + 38, 427, 96, 30, 0.12, 0.35);
        fillShape(cv, id, polyTest(fp)); id++;
        A.plateTint.set(fid, 0.95); A.panelLines.set(fid, [0.5]);
        polyLip(A, fid, fp, 0.5);
      }
      { cv.insts.push({ kind: 'frame' }); fillShape(cv, id, polyTest(blockPoly((ankle.x + toeX) / 2 + 1, 466, toeX - ankle.x + 70, 12, 0, 0.3))); id++; } // 足底件
      footBlock(ankle.x - 24, 455, 64, 34, 0.04); // 跟块（顶 438）
      footBlock(ankle.x + 34, 457, 96, 26, -0.045, 0.3); // 鞋身块：微转，顶边略斜
      footBlock(toeX + 6, 461, 62, 18, 0.01, 0.55, 0.55); // 趾帽块：压鞋身前段，前上大切角
    } else {
      // —— 足（据重装/主战参考标注 ann/ann2 的读图）：
      // 主线：跟块顶边靠盘的陡升段 ─ 穿盘心 ─ 压块顶边，三者共
      // 线（LINE_ANG），压块顶边沿主线向前上行；压块套坐主线在
      // 盘对面的落点。压块是折板：主面沿主线 + 前端一条窄面陡
      // 折（单独一块亮面）。压块与接地趾之间是两块叠瓦楔板，顶
      // 棱向前下行约 27°、两块平行。接地趾是平顶块：顶面逐级下
      // 行、底面共线坐地。跟块顶边两段：浅段向后、靠盘陡升段即
      // 主线在盘后的一段
      const D = 50, GY = 470, HS = heavy ? 1.12 : 1;
      const LINE_ANG = -0.40; // 主线：向前上行
      const dir = { x: Math.cos(LINE_ANG), y: Math.sin(LINE_ANG) };
      const nrm = { x: -dir.y, y: dir.x }; // 主线下法线（指向压块内）
      // 块形：切口只开在与邻块冲突的角上（用户定：切口是为不和别的
      // 块冲突，不是到处乱切）——cuts 按角指定（ft 前上/fb 前下/bt
      // 后上/bb 后下，单位为块厚比），没邻块压的角保持完整方角；
      // 此前四角按随机量乱切、且短块上台阶与切口互撞出自交尖刺
      const jagPoly = (cx: number, cy: number, len: number, thick: number, ang: number, cuts: { ft?: number; fb?: number; bt?: number; bb?: number }): Pt[] => {
        const hl = len / 2, ht = thick / 2;
        const cFT = thick * (cuts.ft ?? 0), cFB = thick * (cuts.fb ?? 0), cBT = thick * (cuts.bt ?? 0), cBB = thick * (cuts.bb ?? 0);
        const raw: Pt[] = [
          { x: -hl, y: -ht + cBT }, { x: -hl + cBT, y: -ht },
          { x: hl - cFT, y: -ht }, { x: hl, y: -ht + cFT * 0.75 },
          { x: hl - cFB, y: ht }, { x: -hl + cBB, y: ht }, { x: -hl, y: ht - cBB },
        ];
        const loc = raw.filter((p, i) => i === 0 || p.x !== raw[i - 1].x || p.y !== raw[i - 1].y);
        const c = Math.cos(ang), s = Math.sin(ang);
        return loc.map(p => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }));
      };
      const blkF = (cx: number, cy: number, len: number, thick: number, ang: number, cuts: { ft?: number; fb?: number; bt?: number; bb?: number }, tint: number) => {
        cv.insts.push({ kind: 'foot' }); const bid = id;
        const pts = jagPoly(cx, cy, len, thick, ang, cuts);
        fillShape(cv, id, polyTest(pts)); id++;
        A.plateTint.set(bid, tint); A.panelLines.set(bid, [0.5]);
        polyLip(A, bid, pts, 0.5);
      };
      // 板类件（压块套/压块/折面）
      const blkP = (cx: number, cy: number, len: number, thick: number, ang: number, cuts: { ft?: number; fb?: number; bt?: number; bb?: number }, tint: number, panel = true) => {
        cv.insts.push({ kind: 'plate' }); const bid = id;
        const pts = jagPoly(cx, cy, len, thick, ang, cuts);
        fillShape(cv, id, polyTest(pts)); id++;
        A.plateTint.set(bid, tint); if (panel) A.panelLines.set(bid, [0.5]);
        if (panel) polyLip(A, bid, pts, 0.5);
      };
      // 接地趾：平顶块（顶平、底面坐 GY、逐级下行是标注读数）。
      // 后缘上端前倾是相邻趾块相抵的缝（标注读数）；前端斜面是趾帽
      // 折面（两参考每趾都有），不是装饰切口；
      // 其余角保持完整。此前借 jagPoly 出图、切口只剩 1–6px，图上
      // 就是矩形（四边形退化的一处）
      const toeG = (x0: number, len: number, thick: number, tint: number) => {
        const ch = thick * 0.38, rc = thick * 0.30, fi = thick * 0.14;
        cv.insts.push({ kind: 'foot' }); const bid = id;
        const tp = [
          { x: x0 + rc * 0.4, y: GY }, { x: x0 + len - fi, y: GY },
          { x: x0 + len, y: GY - thick + ch }, { x: x0 + len - ch, y: GY - thick },
          { x: x0 + rc, y: GY - thick }, { x: x0, y: GY - thick + rc },
        ];
        fillShape(cv, id, polyTest(tp)); id++;
        A.plateTint.set(bid, tint); A.panelLines.set(bid, [0.5]);
        polyLip(A, bid, tp, 0.5);
      };
      // 模式「叠瓦楔板」（模式库 L1·足型子构造，用户连定）：横排、
      // // 排列、楔形——两块大楔块坐在趾上、盘前成台阶（同盘径
      // 对齐实测：后板长约 1.3 盘径、根厚约 0.45 盘径，前板长约
      // 0.85 盘径；轮廓顶边坡度 0.25/0.35，板内亮面线约 0.5——
      // 旧版把整板做成 0.10 的薄片、又缩在压块下，用户连指「角
      // 度不对」「画小了」）。每块登记顶边为高光棱并带亮面
      // （faceW），斜面是整块亮面不是一条边线。叠瓦次序：前板
      // 先画、后板尖压前板根
      const wedge = (poly: Pt[], tint: number) => {
        cv.insts.push({ kind: 'foot' }); const bid = id;
        fillShape(cv, id, polyTest(poly)); id++;
        A.plateTint.set(bid, tint);
        return bid;
      };
      const ax = ankle.x, ay = ankle.y;
      // 大而陡（用户连纠「还是小了」「角度也不够」）：顶边坡度
      // 0.55（约 29°，与 ann2/亮簇实测的亮面线同族），根厚约
      // 0.55 盘径，板身压进趾体上部成包覆——平顶薄板无论放大
      // 都读成片，陡坡大块才读成楔
      // 前板（先画）：根抵压块下，尖落在趾3 顶面——趾3 抬高后
      // （顶 442）旧尖沉到趾3 顶线之下、被趾体切断（用户指
      // 「折断了」），且板底与趾3 后角之间漏背景；本版整板上
      // 提：顶边全程在趾3 顶线之上、尖恰落在顶面上，底边贴
      // 趾3 后角切角沉入趾体接住
      const wF = wedge([
        { x: ax + 92, y: ay - 17 }, { x: ax + 134, y: ay + 8 },
        { x: ax + 140, y: ay + 22 }, { x: ax + 84, y: ay + 15 },
      ], 1.05); // 底边一条直斜线（根 449→尖 456，压进趾体 2–13px）：凹口靠底线沉入趾体消除，不逐角跟切角走折线（用户指「底部是折线」——逐角贴合那版作废）
      // 后板（尖压前板根）：整板抬高（用户指「后板太低」）——根
      // 抵盘上、尖只压到前板体中部，不再探到趾面；尖面取「/」
      // ——上端在前、下端在后（用户定版：缝 // 不是 \\；显式多
      // 边形版曾把尖面写反成 \，已改正）
      const wB = wedge([
        { x: ax + 48, y: ay - 36 }, { x: ax + 114, y: ay + 2 },
        { x: ax + 105, y: ay + 12 }, { x: ax + 71, y: ay + 5 },
        { x: ax + 71, y: ay + 2 }, { x: ax + 40, y: ay + 2 },
      ], 0.94);
      // 两板顶边登记亮面（高光棱模式的 faceW 面带）
      for (const [bid, p0, p1] of [
        [wF, { x: ax + 92, y: ay - 17 }, { x: ax + 134, y: ay + 8 }],
        [wB, { x: ax + 48, y: ay - 36 }, { x: ax + 114, y: ay + 2 }],
      ] as const) {
        regThickness(A, bid, [p0, p1], 1.35, { faceW: 10, faceTone: 1.22 });
        (A.ridgeMode ??= new Set()).add(bid);
      }
      toeG(ankle.x + 0.52 * D, 0.98 * D * HS, 0.52 * D, 1.02);
      toeG(ankle.x + 1.44 * D, 0.86 * D * HS, 0.46 * D, 0.93);
      const toe3Front = ankle.x + 2.24 * D + 0.80 * D * HS;
      toeG(ankle.x + 2.24 * D, 0.80 * D * HS, 0.56 * D, 1.07); // 趾3 顶明显高于趾2（用户定）：厚 0.56D，顶 442（趾2 顶 447、趾1 顶 444）——前趾是全列最高块
      A.toeFace = { x0: Math.round(toe3Front - 0.17 * D), y0: Math.round(GY - 0.34 * D), x1: Math.round(toe3Front - 0.03 * D), y1: Math.round(GY - 0.06 * D) };
      // 跟块：楔块平坐地。顶边两段——靠盘陡升段沿主线（FT→BK），
      // 其后浅段（BK→RT）向后缓降；FT = 顶边触盘点
      const FT = { x: ankle.x - 0.15 * D, y: ankle.y + 0.1 * D };
      {
        const BK = { x: FT.x - dir.x * 0.42 * D, y: FT.y - dir.y * 0.42 * D };
        const RT = { x: BK.x - 0.95 * D * HS, y: BK.y + 0.10 * D };
        cv.insts.push({ kind: 'foot' }); const bid = id;
        fillShape(cv, id, polyTest([
          { x: FT.x - 6, y: FT.y + 9 }, { x: FT.x + 2, y: FT.y }, { x: BK.x + 3, y: BK.y - 2 },
          { x: RT.x + 8, y: RT.y + 2 }, { x: RT.x, y: RT.y + 6 }, { x: RT.x - 7, y: GY },
          { x: ankle.x - 0.05 * D, y: GY }, { x: FT.x - 3, y: FT.y + 17 },
        ])); id++;
        A.plateTint.set(bid, 0.95);
        A.boltPts.push({ x: (BK.x + RT.x) / 2, y: (BK.y + RT.y) / 2 + 12 }); // 跟块面上一颗栓（参考两张都有）
      }
      // 模式「压块总成」（模式库 L1·足型子构造）：一条主线
      // （LINE_ANG，标注定版）贯穿跟块陡升段—盘心—压块顶边；踝前
      // 小套环是主线在盘对面的落点（套心 = 盘心沿主线 0.62D）；
      // 压块顶边贴主线、自 0.98D 处向前上行、主面一块，前端料厚
      // 以高光棱表示（模式库「料厚」条目，非独立件）
      {
        const scx = ankle.x + dir.x * 0.62 * D, scy = ankle.y + dir.y * 0.62 * D;
        blkP(scx, scy, 0.95 * D * HS, 0.58 * D, LINE_ANG, { bt: 0.25, bb: 0.35, fb: 0.20 }, 1.02);
        A.boltPts.push({ x: scx, y: scy });
      }
      {
        const slabLen = 1.45 * D * HS, slabThick = 0.8 * D, slabRear = 0.98 * D;
        const mx = ankle.x + dir.x * (slabRear + slabLen / 2), my = ankle.y + dir.y * (slabRear + slabLen / 2);
        const slabCx = mx + nrm.x * slabThick / 2, slabCy = my + nrm.y * slabThick / 2;
        const slabId = id;
        blkP(slabCx, slabCy, slabLen, slabThick, LINE_ANG, { bb: 0.30, ft: 0.30, fb: 0.15 }, 0.95, false);
        A.boltPts.push({ x: mx - dir.x * slabLen * 0.14 + nrm.x * slabThick * 0.68, y: my - dir.y * slabLen * 0.14 + nrm.y * slabThick * 0.68 }); // 压块面低处一颗栓（参考两张都有）
        // 前端料厚以高光棱表示（用户定：厚度是画高光棱表示的、
        // 不是个块）：棱线离前端边一个料厚、与前端边平行，登记给
        // 着色层在压块自身像素上画——棱线提亮、线至边间平色差
        {
          const hl = slabLen / 2, ht = slabThick / 2, cA = Math.cos(LINE_ANG), sA = Math.sin(LINE_ANG);
          const rot = (lx: number, ly: number): Pt => ({ x: slabCx + lx * cA - ly * sA, y: slabCy + lx * sA + ly * cA });
          const fT0 = rot(hl, -ht + slabThick * 0.30 * 0.75), fB0 = rot(hl - slabThick * 0.15, ht);
          const w = slabThick * (spec.thickRatio ?? 0.32); // 料厚（模式库「料厚」条目参数）
          const rA = { x: fT0.x + (fB0.x - fT0.x) * 0.06 - dir.x * w, y: fT0.y + (fB0.y - fT0.y) * 0.06 - dir.y * w };
          const rB = { x: fT0.x + (fB0.x - fT0.x) * 0.94 - dir.x * w, y: fT0.y + (fB0.y - fT0.y) * 0.94 - dir.y * w };
          regThickness(A, slabId, [rA, rB], 1.30, { faceW: w, faceDx: dir.x, faceDy: dir.y, faceTone: 0.95 });
          (A.ridgeMode ??= new Set()).add(slabId);
        }
      }
    }
  }
  // 6) 胫骨套（前护板，多边形盾形，压在小腿前方——与后侧腓肠套
  // §7.5 前后成对）：坐标 = (沿轴 t, 离轴距离 off)；无护板族跳过
  if (!spec.guardOff) {
    const f = segFrame(shin.a, shin.b);
    const sgn = std ? -1 : 1; // front = -perp（标准型）
    const gS = 0.92 + rnd() * 0.25; // 护板比例逐腿不同（宽窄/突出量）
    const hwAt = (t: number) => ((shin.wA + (shin.wB - shin.wA) * t) / 2) * (1 + shin.bulge.f * bumpAt(t, 0.38)) * (spec.frameHeavy ? 0.8 : 1) * gS;
    const C = (t: number, off: number): Pt => ({
      x: shin.a.x + f.ux * f.len * t + f.px * sgn * off,
      y: shin.a.y + f.uy * f.len * t + f.py * sgn * off,
    });
    // 胫骨护板前缘改凹状（用户定）：顶唇与踝端外张、中段收进成
    // 凹槽——与小腿板面前凹（bulge.f 负）同向，剪影呈机械凹面
    // 胫骨套下缘贴合压块后上缘（用户定，看参考图两样本）：套的下
    // 缘沿压块顶边所在的主线（过踝盘心、-0.40）落下、与压块顶边
    // 共线搭接——落点 T1/T2 直接取主线上的点：T1 在压块顶边后角
    // （s=49=slabRear）、T2 在 s=95。前缘的直线段自九成高处开始
    // （用户定）：九成高是自踝向上量、C 参自膝向下数——即
    // C(0.10)，不是 C(0.9)（此前搞反：直线段起于膝下近处、一根
    // 直线落到 T2，T2 处是实角、贴合段不被折没）
    const dirG = { x: Math.cos(-0.40), y: Math.sin(-0.40) };
    const T1 = { x: ankle.x + dirG.x * 49, y: ankle.y + dirG.y * 49 };
    const T2 = { x: ankle.x + dirG.x * 95, y: ankle.y + dirG.y * 95 };
    const F0 = C(0.10, hwAt(0.10) * 0.93); // 前缘起点（九成高，见上）
    const pts = [
      C(0.02, hwAt(0.02) * 0.34), C(0.04, hwAt(0.04) * 1.06), F0,
      T2, T1, C(0.90, hwAt(0.90) * 0.24), C(0.5, hwAt(0.5) * 0.2), C(0.12, hwAt(0.12) * 0.22),
    ];
    cv.insts.push({ kind: 'guard' }); A.guardId = id; A.stripeId = id;
    fillShape(cv, id, polyTest(pts)); id++;
    // 胫骨套下缘料厚：走模式库「料厚」条目的注册做法（归高光棱
    // 执行，与压块前端同一套构造，不另发明）：棱线沿下缘内缩一
    // 个料厚 w = 件厚 × thickRatio、两端内收 0.06/0.94，线至下缘
    // 间是平色差带——套以这个「面」压在压块顶边上。此前一版用
    // 放大衬边冒充厚度，是跳过模式的自创，已删
    {
      const w = 0.8 * 50 * (spec.thickRatio ?? 0.32); // 件厚同压块尺度（0.8·D）
      const nx = 0.389, ny = 0.921; // 主线法向（指向压块一侧）
      const rA = { x: T1.x + (T2.x - T1.x) * 0.06 - nx * w, y: T1.y + (T2.y - T1.y) * 0.06 - ny * w };
      const rB = { x: T1.x + (T2.x - T1.x) * 0.94 - nx * w, y: T1.y + (T2.y - T1.y) * 0.94 - ny * w };
      regThickness(A, A.guardId, [rA, rB], 1.30, { faceW: w, faceDx: nx, faceDy: ny, faceTone: 0.95 });
      (A.ridgeMode ??= new Set()).add(A.guardId);
    }
    // 前缘料厚（用户定「前缘应该更厚」）：同一「料厚」构造沿前缘
    // （F0→T2）再登记一条——前缘是套的迎面，料厚带比下缘更宽：
    // 件厚按套的前后进深取 1.45·D（与压块长同尺度），w 随之更大
    {
      const w = 1.45 * 50 * (spec.thickRatio ?? 0.32);
      const fx = 0.894, fy = 0.442; // 前向（套内指向前缘）
      const rA = { x: F0.x + (T2.x - F0.x) * 0.06 - fx * w, y: F0.y + (T2.y - F0.y) * 0.06 - fy * w };
      const rB = { x: F0.x + (T2.x - F0.x) * 0.94 - fx * w, y: F0.y + (T2.y - F0.y) * 0.94 - fy * w };
      regThickness(A, A.guardId, [rA, rB], 1.30, { faceW: w, faceDx: fx, faceDy: fy, faceTone: 0.95 });
    }
    A.plateTint.set(A.guardId, 1.05);
    A.panelLines.set(A.guardId, [0.52, 0.79]);
    polyLip(A, A.guardId, pts, 0.52); polyLip(A, A.guardId, pts, 0.79);
    // 模式「套系连带」（模式库 L1·护板子构造，用户定）：护板下端
    // 到踝前压块套之间一条连带，贴小腿前表面下行、压住套的上
    // 缘——两套相连成一个套系，小腿前轮廓在连带处收进，凹轮廓
    // 由此形成（套心与压块总成同式：主线 -0.40、盘心沿主线 0.62·50）
    {
      const dirL = { x: Math.cos(-0.40), y: Math.sin(-0.40) }, nrmL = { x: -dirL.y, y: dirL.x };
      const sc = { x: ankle.x + dirL.x * 31, y: ankle.y + dirL.y * 31 };
      const band: Pt[] = [
        C(0.90, hwAt(0.90) * 0.34), C(0.995, hwAt(0.995) * 0.30),
        { x: sc.x + nrmL.x * 2 + dirL.x * 8, y: sc.y + nrmL.y * 2 + dirL.y * 8 },
        { x: sc.x - nrmL.x * 14, y: sc.y - nrmL.y * 14 },
      ];
      cv.insts.push({ kind: 'guard' });
      fillShape(cv, id, polyTest(band)); id++;
      A.plateTint.set(id - 1, 0.92);
    }
    A.decalPos = C(0.8, hwAt(0.8) * 0.44);
    { const df = segFrame(shin.a, shin.b); const dc = C(0.72, hwAt(0.72) * 0.6); A.deviceFrame = { c: dc, ux: df.ux, uy: df.uy, px: df.px, py: df.py }; }
    A.chevDecal = rnd() < 0.55;
    A.boltPts.push(C(0.12, hwAt(0.12) * 0.72), C(0.85, hwAt(0.85) * 0.42));
    // 三层叠人字纹（AA 式）：三个 ⌄ 上下叠，(t, off) 定义、渲染盖章
    // （顶端收进护板凹面前缘之内，不越界落到板面外）
    for (const t0 of [0.16, 0.32, 0.48]) {
      const apex = C(t0 + 0.07, hwAt(t0 + 0.07) * 0.6);
      A.chevrons.push([C(t0, hwAt(t0) * 0.26), apex], [apex, C(t0 + 0.14, hwAt(t0 + 0.14) * 0.26)]);
    }
  }
  // 6.5) 膝盖帽 + 杂物小盒（参考图的构件密度主要来自这类小件）
  {
    const f = segFrame(shin.a, shin.b); const sgn = std ? -1 : 1;
    // 膝盖帽已撤（用户定：膝盖只有前楔块——楔拱前扇区那块，见下方
    // 楔块段；帽与前楔同压盘面前缘、双块并存是残留，膝盖块系数
    // kneeScale 由前楔单独承载）
    // 大腿前小盒 + 小腿后挂盒
    const box = (cx: number, cy: number, w: number, h: number) => {
      cv.insts.push({ kind: 'plate' }); const bid = id;
      const cc = Math.min(w, h) * 0.24, x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
      fillShape(cv, id, polyTest([{ x: x0 + cc, y: y0 }, { x: x1 - cc, y: y0 }, { x: x1, y: y0 + cc }, { x: x1, y: y1 - cc }, { x: x1 - cc, y: y1 }, { x: x0 + cc, y: y1 }, { x: x0, y: y1 - cc }, { x: x0, y: y0 + cc }])); id++;
      A.plateTint.set(bid, 0.94); A.panelLines.set(bid, []);
    };
    const tf = segFrame(thigh.a, thigh.b); const tsgn = std ? -1 : 1;
    box(thigh.a.x + tf.ux * tf.len * 0.3 + tf.px * tsgn * 44, thigh.a.y + tf.uy * tf.len * 0.3 + tf.py * tsgn * 44, 26, 34);
    box(shin.a.x + f.ux * f.len * 0.62 - f.px * sgn * (52 + calfDelta(0.62)), shin.a.y + f.uy * f.len * 0.62 - f.py * sgn * (52 + calfDelta(0.62)), 24, 32); // 小腿后挂盒：随腓肠表面跟随
  }
  // 6.6) 中型构件一批：裙板 / 副油缸 / 膝连杆 / 排气管 / 背导轨 / 踝护板 / 提手
  {
    const tf = segFrame(thigh.a, thigh.b);
    const P = (t: number, off: number): Pt => ({ x: thigh.a.x + tf.ux * tf.len * t + tf.px * off, y: thigh.a.y + tf.uy * tf.len * t + tf.py * off });
    // 大腿后裙板（沿后侧另挂一块，向上张开）
    addPlate(P(0.0, 13), P(0.48, 13), 68, 54, 0.02, 0.98, 2.6, 4, 12);
    // 膝连杆：膝后一根粗杆跨接两段 + 两端销盘
    const l1 = backOf(thigh, 0.8, 27), l2 = backOf(shin, 0.15, 23);
    cv.insts.push({ kind: 'frame' }); fillShape(cv, id, lineTest(l1, l2, 7)); id++;
    for (const e of [l1, l2]) { cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, discTest(e, 8)); id++; }
    // 小腿背导轨（贴腓肠表面走：离轴距离随腓肠表面跟随）
    cv.insts.push({ kind: 'plate' }); const railId = id;
    fillShape(cv, id, lineTest(backOf(shin, 0.14, 58 + calfDelta(0.14)), backOf(shin, 0.88, 38 + calfDelta(0.88)), 4.5)); id++;
    A.plateTint.set(railId, 0.95); A.panelLines.set(railId, []);
    // 小腿排气管 ×3（膝后向上短管）
    for (let k = 0; k < 3; k++) {
      const base = backOf(shin, 0.1 + k * 0.055, 52 + calfDelta(0.1 + k * 0.055));
      const tip = { x: base.x - 3, y: base.y - 32 };
      cv.insts.push({ kind: 'cyl' }); const exId = id; fillShape(cv, id, lineTest(base, tip, 4.2)); id++;
      regCylHoops(A, exId, base, tip, 4.2); // 排气管环带同路（箍归缝模式）
    }
    // 踝前护板
    cv.insts.push({ kind: 'plate' }); const agId = id;
    const agPts = [{ x: ankle.x + 16, y: 402 }, { x: ankle.x + 36, y: 412 }, { x: ankle.x + 37, y: 442 }, { x: ankle.x + 25, y: 458 }, { x: ankle.x + 13, y: 434 }];
    fillShape(cv, id, polyTest(agPts)); id++;
    A.plateTint.set(agId, 1.0); A.panelLines.set(agId, [0.5]);
    polyLip(A, agId, agPts, 0.5);
    // 提手：大腿下板正面 Π 形（两脚 + 横杆，金属色）
    const hf = segFrame(thigh.a, thigh.b); const hsgn = std ? -1 : 1;
    const H = (t: number, off: number): Pt => ({ x: thigh.a.x + hf.ux * hf.len * t + hf.px * hsgn * off, y: thigh.a.y + hf.uy * hf.len * t + hf.py * hsgn * off });
    const h1 = H(0.66, 47), h2 = H(0.8, 47), h1b = H(0.66, 38), h2b = H(0.8, 38);
    cv.insts.push({ kind: 'cyl' }); const hd1 = id; fillShape(cv, id, lineTest(h1b, h1, 3)); id++;
    cv.insts.push({ kind: 'cyl' }); const hd2 = id; fillShape(cv, id, lineTest(h2b, h2, 3)); id++;
    cv.insts.push({ kind: 'cyl' }); const hd3 = id; fillShape(cv, id, lineTest(h1, h2, 3.4)); id++;
    regCylHoops(A, hd1, h1b, h1, 3); regCylHoops(A, hd2, h2b, h2, 3); regCylHoops(A, hd3, h1, h2, 3.4); // 提手管环带同路
  }
  // 7) 活塞：大腿后侧、小腿后侧（两参考样本一致：胫前是装甲
  // 面、活塞一律在腓肠侧）。小腿活塞自膝下画到踝盘、贴段板后
  // 缘走线；它上半截由紧随其后的腓肠套（§7.5 膝下板）盖住
  piston(backOf(thigh, 0.14, 44), backOf(thigh, 0.88, 40));
  piston(backOf(thigh, 0.24, 26), backOf(thigh, 0.62, 24), 6, 3.2); // 副油缸（贴板面、更细更短）
  piston(backOf(shin, 0.10, 36), backOf(shin, 1.0, 15), 8, 4.2); // 小腿主活塞：上端藏进腓肠套、下端落在踝盘上缘
  if (spec.guardOff && !spec.shellMode) piston(backOf(shin, 0.20, 30), backOf(shin, 0.84, 27), 6.5, 3.4); // 无护板族：后侧成对第二根
  // 7.5) 腓肠套（用户命名，即参考图里的「膝下板」）：小腿后侧上
  // 半的一块套板，自膝下挂到小腿中段——盖住活塞上半截与段板后
  // 半，活塞自它的下缘探出。与前侧胫骨套（§6 护板）前后成对
  if (!spec.shellMode) {
    const f7 = segFrame(shin.a, shin.b); const s7 = std ? 1 : -1;
    const hwB7 = (t: number) => ((shin.wA + (shin.wB - shin.wA) * t) / 2) * (1 + shin.bulge.b * Math.exp(-(((t - 0.34) / 0.3) ** 2)));
    const B7 = (t: number, off: number): Pt => ({ x: shin.a.x + f7.ux * f7.len * t + f7.px * s7 * off, y: shin.a.y + f7.uy * f7.len * t + f7.py * s7 * off });
    const calfPts = [
      B7(0.03, hwB7(0.03) + 5), B7(0.18, hwB7(0.18) + 7), B7(0.34, hwB7(0.34) + 7), B7(0.46, hwB7(0.46) + 3),
      B7(0.50, 14), B7(0.30, 8), B7(0.12, 10), B7(0.04, 16),
    ];
    cv.insts.push({ kind: 'plate' }); const calfId = id;
    fillShape(cv, id, polyTest(calfPts)); id++;
    A.plateTint.set(calfId, 1.02);
    A.panelLines.set(calfId, [0.55]);
    polyLip(A, calfId, calfPts, 0.55);
    A.boltPts.push(B7(0.14, hwB7(0.14) * 0.55), B7(0.40, hwB7(0.40) * 0.5));
  }
  // 8) 关节 = 块簇：沿段轴的壳体块 + 盖帽盘 + 切角毂块
  const segAng = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);
  const ja = (q: Pt, ang: number, dist: number): Pt => ({ x: q.x + Math.cos(ang) * dist, y: q.y + Math.sin(ang) * dist });
  const jointBlock = (c: Pt, ang: number, w: number, h: number) => {
    cv.insts.push({ kind: 'plate' }); const bid = id;
    fillShape(cv, id, polyTest(blockPoly(c.x, c.y, w, h, ang, 0.4))); id++;
    A.plateTint.set(bid, [0.85, 0.95, 1.05][Math.floor(rnd() * 3)]);
    A.panelLines.set(bid, []);
  };
  for (const [j, r] of [[hip, 41], [knee, 39], [ankle, 25]] as [Pt, number][]) {
    cv.insts.push({ kind: 'frame' }); fillShape(cv, id, discTest(j, r)); id++; // 关节法兰：盖帽垫圈（v29 半径改由盖帽派生，见下方半径表）
  }
  for (const [j, r] of [[hip, 37], [knee, 35], [ankle, 21]] as [Pt, number][]) {
    const cc = { x: j.x + (rnd() * 8 - 4), y: j.y + (rnd() * 6 - 3) }; // 盖帽偏心，不再正中靶心
    cv.insts.push({ kind: 'disc' }); fillShape(cv, id, discTest(cc, r)); A.discs.push({ id, c: cc, r, hv: A.discs.length % 3, hub: true }); id++;
  }
  // 壳体块画在盖帽之后：压住帽缘、关节成簇（v15 画在帽前被帽盖住，等于没加）
  jointBlock(ja(hip, segAng(hip, knee), 30), segAng(hip, knee), 64, 46);
  // 膝/踝的关节块向段内退（28→40、19→27）：参考图的关节是深色外露
  // 圆盘、装甲在盘缘处断开；旧位块体压住盘面大半，关节读不出来
  // 膝盖由楔模式画（楔拱生成器，与肩部同模式）：只拼前楔
  // 一块——楔界由两段轴向与各自前侧定，外链取两段在膝外截面
  // 点与前/后顶点，厚度随 kneeScale；旧矩形关节块三块已撤
  {
    const ks = spec.kneeScale ?? 1;
    const uTv = { x: hip.x - knee.x, y: hip.y - knee.y }; const lT = Math.hypot(uTv.x, uTv.y) || 1; uTv.x /= lT; uTv.y /= lT;
    const uSv = { x: ankle.x - knee.x, y: ankle.y - knee.y }; const lS = Math.hypot(uSv.x, uSv.y) || 1; uSv.x /= lS; uSv.y /= lS;
    const pf = (u: Pt) => { const p = { x: u.y, y: -u.x }; return p.x >= 0 ? p : { x: -p.x, y: -p.y }; }; // 前侧垂向（取 +x 一侧）
    const pfT = pf(uTv), pfS = pf(uSv);
    const P = (u: Pt, d: number, q: Pt, o: number): [number, number] => [knee.x + u.x * d + q.x * o, knee.y + u.y * d + q.y * o];
    const D = 58 * ks;
    const pTF = P(uTv, D, pfT, 42 * ws + 6);
    const pSF = P(uSv, D, pfS, 50 * ws + 6);
    const fb = { x: pfT.x + pfS.x, y: pfT.y + pfS.y }; const lfb = Math.hypot(fb.x, fb.y) || 1;
    const pF: [number, number] = [knee.x + (fb.x / lfb) * 66 * ks, knee.y + (fb.y / lfb) * 66 * ks];
    const ang = (p: [number, number]) => (Math.atan2(p[1] - knee.y, p[0] - knee.x) * 180) / Math.PI;
    // 膝盖只有前楔块（用户定）：楔拱只生成前扇区一块——大腿
    // 侧/小腿侧/后侧三块撤除，盘在其余三面外露（与参考的关
    // 节盘外露一致）；前楔仍由楔拱生成器出（与肩部同模式）
    const kw = wedgeArch([knee.x, knee.y], 40, [
      { a0: ang(pTF), a1: ang(pSF), outer: [pSF, pF, pTF], tint: 1.06 },
    ]);
    for (const w of kw) {
      cv.insts.push({ kind: 'plate' }); const wid = id;
      fillShape(cv, id, polyTest(w.poly.map(([x, y]) => ({ x, y })))); id++;
      A.plateTint.set(wid, w.tint ?? 1); A.panelLines.set(wid, []);
    }
  }
  jointBlock(ja(ankle, segAng(ankle, knee), 27), segAng(ankle, knee), 44, 32);
  jointBlock(ja(hip, segAng(hip, knee) - 0.6, 32), segAng(hip, knee) - 0.3, 36, 26);
  jointBlock(ja(hip, segAng(hip, knee) + 0.55, 32), segAng(hip, knee) + 0.3, 36, 25); // 髋前整流块
  // 毂块：盖帽中心的切角方块（块语言，不再画同心毂环/毂心变体）；
  // 膝/踝毂块缩小压暗成盘心螺栓（参考：盘面大面积深色外露）
  for (const [j, r] of [[hip, 37], [knee, 35], [ankle, 21]] as [Pt, number][]) {
    cv.insts.push({ kind: 'plate' }); const hid = id;
    const dc = A.discs.find((d) => Math.abs(d.c.x - j.x) < 12 && Math.abs(d.c.y - j.y) < 12)?.c ?? j;
    const isHip = r === 37;
    fillShape(cv, id, polyTest(blockPoly(dc.x, dc.y, r * (isHip ? 0.62 : 0.42), r * (isHip ? 0.62 : 0.42), 0.3, 0.45))); id++;
    A.plateTint.set(hid, isHip ? 1.1 : 0.8); A.panelLines.set(hid, []);
  }
  // 膝后波纹套（显形版）：画在盖帽之后、加粗后移，落在关节后凹口
  for (let k = 0; k < 5; k++) {
    const b1 = backOf(thigh, 0.94 + k * 0.015, 17 + k * 5), b2 = backOf(shin, 0.09 - k * 0.015, 17 + k * 5);
    cv.insts.push({ kind: 'frame' }); fillShape(cv, id, lineTest(b1, b2, 4.2)); id++;
  }
  // 贴纸编号锚点（大腿下板前缘）与信号灯
  {
    const f = segFrame(thigh.a, thigh.b); const sgn = std ? -1 : 1;
    A.numPos = { x: thigh.a.x + f.ux * f.len * 0.68 + f.px * sgn * 16, y: thigh.a.y + f.uy * f.len * 0.68 + f.py * sgn * 16 };
    A.decalKind = spec.decalKind ?? 'num';
    A.numText = A.decalKind === 'num' ? 'M-' + (10 + Math.floor(rnd() * 89)) : '';
    // 编号按板定位：在大腿首板（stripeThigh）的实际像素里找完整落点（整串字落在一块板内）
    if (A.numText) {
      const tw = A.numText.length * 8 - 2, th = 10;
      let found: Pt | null = null;
      for (let y = 56; y < 250 && !found; y += 2) for (let x = 96; x < 300 && !found; x += 2) {
        let ok = true;
        for (let yy = y; yy < y + th && ok; yy++) for (let xx = x; xx < x + tw && ok; xx++) if (cv.owner[yy * W + xx] !== A.stripeThigh) ok = false;
        if (ok) found = { x, y };
      }
      if (found) A.numPos = found;
    }
    A.insignia = { pos: { x: A.numPos.x + 4, y: A.numPos.y - 34 }, kind: Math.floor(rnd() * 4) };
    A.lightPts = [{ x: knee.x + (std ? 26 : -26), y: knee.y - 30 }, { x: hip.x - 30, y: hip.y + 34 }];
    if ((spec.detail ?? 1) > 1.1) { // 高细节族：小腿前三灯串（侦察式）
      const lf = segFrame(shin.a, shin.b); const lsgn = std ? -1 : 1;
      for (const lt of [0.3, 0.55, 0.8]) A.lightPts.push({ x: shin.a.x + lf.ux * lf.len * lt + lf.px * lsgn * 26, y: shin.a.y + lf.uy * lf.len * lt + lf.py * lsgn * 26 });
    }
  }
  // 剪影 = 包络 ∪ 全部部件：部件探出包络的部分同样成廓
  for (let i = 0; i < W * H; i++) if (cv.owner[i] >= 0) cv.sil[i] = 1;
  return A;
}

// 形态明暗剖面：u=-1 前缘 → +1 后缘，非对称分段（高光带偏前、背侧收暗）
function formProfile(u: number): number {
  const P: [number, number][] = [[-1, 0.72], [-0.78, 1.14], [-0.3, 1.0], [0.3, 0.85], [0.72, 0.67], [1, 0.53]];
  for (let k = 0; k < P.length - 1; k++) {
    const [x0, y0] = P[k], [x1, y1] = P[k + 1];
    if (u >= x0 && u <= x1) return y0 + (y1 - y0) * ((u - x0) / (x1 - x0));
  }
  return u < 0 ? P[0][1] : P[P.length - 1][1];
}
const quant = (f: number) => Math.round(f / 0.055) * 0.055; // 坡道量化：平坦色阶带


// ---------- IR（v1，定义见 IR.md） ----------
interface MechaIR {
  version: 1; archetype: 'humanoid' | 'walker' | 'beast';
  scheme: string; seed: number;
  style: { wear: number; camo: boolean; cableTint?: RGB; decalKind: 'num' | 'plate' | 'none'; lift: number };
  rig: { topology: 'standard' | 'reverse'; shellMode: boolean; wScale: number };
  canvas: { w: number; h: number; groundY: number };
  anchors: Record<string, Pt & { y: number }>;
  volumes: unknown[];
  parts: { id: string; pattern: string; anchors: string[]; params: Record<string, number | string | boolean> }[];
}
const FOOT_PATTERN = { blocks: 'footBlocks', shoe: 'footShoe', claw: 'footClaw', pad: 'footPad', wheel: 'footWheel' } as const;
const FOOT_TYPE = { footBlocks: 'blocks', footShoe: 'shoe', footClaw: 'claw', footPad: 'pad', footWheel: 'wheel' } as const;
function legIR(spec: LegSpec): MechaIR {
  const std = spec.topology === 'standard';
  const hip = { x: 170, y: 44 };
  const knee = std ? { x: 236 + spec.bend, y: 248 } : { x: 112 + spec.bend, y: 244 };
  const ankle = { x: 178 + (std ? -1 : 1) * (spec.ankleShift ?? 10), y: 434 };
  const toe = { x: ankle.x + 100, y: 470 };
  const ws = spec.wScale ?? 1;
  const schemeName = Object.entries(SCHEMES).find(([, v]) => v === spec.scheme)?.[0] ?? 'olive';
  const parts: MechaIR['parts'] = [
    { id: 'core', pattern: 'core', anchors: ['hip', 'knee', 'ankle'], params: { coreScale: spec.coreScale ?? 1 } },
  ];
  if (spec.frameHeavy) parts.push({ id: 'frameBeam', pattern: 'frameBeam', anchors: ['hip', 'knee', 'ankle'], params: {} });
  parts.push(
    { id: 'cables', pattern: 'cableRun', anchors: ['hip', 'knee', 'ankle'], params: {} },
    { id: 'thigh.plates', pattern: 'segPlates', anchors: ['hip', 'knee'], params: { wA: 110 * ws, wB: 84 * ws, bulgeF: 0.16, bulgeB: 0.05, shroudTo: 1.07 } },
    { id: 'shin.plates', pattern: 'segPlates', anchors: ['knee', 'ankle'], params: { wA: 100 * ws, wB: 64 * ws, bulgeF: -0.38 * (spec.shinConcave ?? 1), bulgeB: 0.42 * (spec.calfScale ?? 1) } },
    { id: 'foot', pattern: FOOT_PATTERN[spec.footType ?? 'blocks'], anchors: ['ankle', 'toe'], params: {} },
  );
  if (!spec.guardOff) parts.push({ id: 'guard', pattern: 'guard', anchors: ['knee', 'ankle'], params: {} });
  parts.push({ id: 'kneeCapBox', pattern: 'kneeCapBox', anchors: ['knee'], params: {} });
  if (spec.detail === undefined || spec.detail > 0) parts.push({ id: 'detailSet', pattern: 'detailSet', anchors: ['hip', 'knee', 'ankle'], params: { level: spec.detail ?? 1 } });
  parts.push(
    { id: 'pistons', pattern: 'pistonPair', anchors: ['hip', 'knee', 'ankle'], params: {} },
    { id: 'hip.joint', pattern: 'jointCluster', anchors: ['hip'], params: { r: 30 } },
    { id: 'knee.joint', pattern: 'jointCluster', anchors: ['knee'], params: { r: 28 } },
    { id: 'ankle.joint', pattern: 'jointCluster', anchors: ['ankle'], params: { r: 18 } },
    { id: 'bellows', pattern: 'bellows', anchors: ['knee'], params: {} },
    { id: 'decals', pattern: 'decals', anchors: [], params: { decalKind: spec.decalKind ?? 'num' } },
  );
  return {
    version: 1, archetype: 'humanoid', scheme: schemeName, seed: spec.seed,
    style: { wear: spec.wear ?? 1, camo: spec.camo, cableTint: spec.cableTint, decalKind: spec.decalKind ?? 'num', lift: spec.lift ?? 0 },
    rig: { topology: spec.topology, shellMode: spec.shellMode ?? false, wScale: ws },
    canvas: { w: W, h: H, groundY: 470 },
    anchors: { hip, knee, ankle, toe },
    volumes: [
      { kind: 'seg', a: 'hip', b: 'knee', wA: 110 * ws, wB: 84 * ws },
      { kind: 'seg', a: 'knee', b: 'ankle', wA: 100 * ws, wB: 64 * ws },
      { kind: 'disc', c: 'hip', r: 36 }, { kind: 'disc', c: 'knee', r: 34 }, { kind: 'disc', c: 'ankle', r: 21 },
    ],
    parts,
  };
}
function viewOf(ir: MechaIR): LegSpec {
  const part = (p: string) => ir.parts.find((q) => q.pattern === p);
  const foot = ir.parts.find((q) => q.id === 'foot');
  return {
    topology: ir.rig.topology, scheme: SCHEMES[ir.scheme], seed: ir.seed, bend: 0,
    camo: ir.style.camo, wear: ir.style.wear, frameHeavy: !!part('frameBeam'),
    shellMode: ir.rig.shellMode, wScale: ir.rig.wScale, lift: ir.style.lift,
    guardOff: !part('guard'), detail: (part('detailSet')?.params.level as number) ?? 0,
    cableTint: ir.style.cableTint, decalKind: ir.style.decalKind,
    coreScale: (part('core')?.params.coreScale as number) ?? 1,
    footType: FOOT_TYPE[(foot?.pattern ?? 'footBlocks') as keyof typeof FOOT_TYPE],
  };
}
function renderIR(ir: MechaIR) {
  const spec = viewOf(ir);
  const cv = newCanvas();
  const A = layout(cv, spec, { hip: ir.anchors.hip, knee: ir.anchors.knee, ankle: ir.anchors.ankle, toeX: ir.anchors.toe.x });
  return finishRender(cv, A, spec);
}

// ---------- 渲染 ----------
function render(spec: LegSpec) { return renderIR(legIR(spec)); }
function finishRender(cv: MechaCanvas, A: Anchors, spec: LegSpec) {
  const S = spec.scheme;
  const rnd = mulberry32(spec.seed + 99);
  const set = (i: number, c: RGB) => { cv.col[i * 4] = c[0]; cv.col[i * 4 + 1] = c[1]; cv.col[i * 4 + 2] = c[2]; cv.col[i * 4 + 3] = 255; };
  const get = (i: number): RGB => [cv.col[i * 4], cv.col[i * 4 + 1], cv.col[i * 4 + 2]];
  // 带料厚的件（登记过 faceW 料厚面的）：其面已由料厚构造定，
  // 不走钻石切割刻面（用户定）
  const thickInsts = new Set<number>();
  for (const b of A.thickBands ?? []) if (!b.noThick) thickInsts.add(b.inst);
  // 三大面五调子模式（着色模式）：给归一受光值 t（0 背光缘…
  // 1 光峰）与纵坐标 ny，按面与调子给倍率——三大面：亮面/灰
  // 面/暗面；五调子：高光（t 极高再提）、中间调（灰面本调）、
  // 明暗交界（t 中段的最暗带）、反光（暗侧下缘 rim 回光）、
  // 投影（归落影系统、不在此式）。倍率组 lv 是模式的参数面，
  // 各调用模式钉自己的组：半球/球用缺省组（DOME_LV），桶/管
  // 各钉其组——模式同一、变体靠参数（用户定的调用分层）
  interface ToneLevels { hi: number; lit: number; mid: number; term: number; dark: number; refl: number }
  const DOME_LV: ToneLevels = { hi: 1.5, lit: 1.22, mid: 1.02, term: 0.6, dark: 0.8, refl: 0.92 };
  // 五调子次序（用户立）：明暗分界是最暗调子——term 必须是
  // 本组的最低值，暗面在其上（受环境/反光托着）；反光只进
  // 暗带深处（t<0.30），不紧贴分界线（旧窗 t<0.475 会侵入
  // 分界带下段）。自投影就是暗面、不另成一调
  const TUBE_LV: ToneLevels = { hi: 1.32, lit: 1.18, mid: 1.0, term: 0.56, dark: 0.68, refl: 0.85 };
  const CYL_LV: ToneLevels = { hi: 1.3, lit: 1.1, mid: 0.85, term: 0.34, dark: 0.52, refl: 0.6 };
  const toneFacing = (t: number, ny: number, lv: ToneLevels = DOME_LV): number => {
    // 五调子之间柔和过渡（用户立）：不做台阶分带，按锚点分
    // 段插值——t=0 暗面 → 0.45 明暗分界（谷底、最暗）→ 0.65
    // 中间调 → 0.85 亮面 → 1 高光，相邻调子之间渐变衔接
    const A: [number, number][] = [[0, lv.dark], [0.45, lv.term], [0.65, lv.mid], [0.85, lv.lit], [1, lv.hi]];
    let f = lv.dark;
    for (let i = 1; i < A.length; i++) {
      if (t <= A[i][0]) {
        const [t0, v0] = A[i - 1], [t1, v1] = A[i];
        f = v0 + (v1 - v0) * ((t - t0) / Math.max(1e-6, t1 - t0));
        break;
      }
      f = lv.hi;
    }
    // 反光：暗区下缘的平滑隆起（钟形，峰在 t≈0.12，与分界
    // 谷底隔着一段暗面，不紧贴分界线）
    if (ny > 0.4) {
      const bell = Math.max(0, 1 - Math.abs(t - 0.12) / 0.18);
      const nyF = Math.min(1, (ny - 0.4) / 0.3);
      if (bell > 0) f = Math.max(f, lv.dark + (lv.refl - lv.dark) * bell * nyF);
    }
    return f;
  };
  // 盒子模式的倍率组：顶面是盒的亮面——其调子跨度由进气口条
  // 目参数持有（hi = topTone、lit = topTone − topGrad）；装口
  // 面/端面按朝向落在其余带上。散热盒（进气口盒）调用盒子模
  // 式、盒子模式调用三大面五调子（toneFacing + 本组）
  const BOX_LV: ToneLevels = { hi: spec.intake?.topTone ?? 1.42, lit: (spec.intake?.topTone ?? 1.42) - (spec.intake?.topGrad ?? 0.12), mid: 1.0, term: 0.62, dark: 0.78, refl: 0.9 };
  const BOX_BANDS = [{ lv: BOX_LV.hi, t: 0.97 }, { lv: BOX_LV.lit, t: 0.85 }, { lv: BOX_LV.mid, t: 0.65 }, { lv: BOX_LV.term, t: 0.45 }, { lv: BOX_LV.dark, t: 0.2 }]
    .map(b => ({ ...b, eff: rampQ(b.lv) }));
  // 基色 + 场着色（量化坡道）
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!cv.sil[i]) continue;
    const o = cv.owner[i], inst = o >= 0 ? cv.insts[o] : null;
    const u = cv.u[i], v = cv.v[i];
    if (!inst) { continue; } // 无主像素不画：透明合法、平填是缺陷（v29）
    const mottle = 0.94 + 0.11 * vnoise(x / 8, y / 8, spec.seed + 1);
    if (inst.kind === 'frame') { const band = Math.floor(v * 16) % 2 === 0 ? 1 : 0.93; set(i, ramp(mix(S.frame, S.metal, 0.28), 0.74 * mottle * band * (1.03 - 0.14 * Math.abs(u)))); } // 框件枪灰+分带
    else if (inst.kind === 'cable') set(i, ramp(spec.cableTint ? mix(S.frame, spec.cableTint, 0.55) : S.frame, (1.05 - 0.5 * v) * mottle));
    else if (inst.kind === 'plate' || inst.kind === 'guard' || inst.kind === 'foot') {
      const tint = A.plateTint.get(o) ?? 1;
      const uu = inst.kind === 'guard' ? -u : u; // 多边形护板的 u 是包围盒坐标，方向与段板相反
      // 面式着色：折线/面数/色调组全部按板种子（块间参数发散）
      const h1 = (((o * 2654435761) >>> 0) % 100) / 100, h2 = (((o * 40503 + 7) >>> 0) % 100) / 100;
      const h3 = (((o * 2246822519) >>> 0) % 100) / 100, h4 = (((o * 3266489917) >>> 0) % 100) / 100;
      const tMain = 0.93 + h3 * 0.1, tBev = 1.08 + h4 * 0.2;
      // 板面按钻石切割式切亮面（用户定）：以板心为心、向四角与四
      // 边中点放射折线，切成中心菱面 + 八个刻面，每面单一平色、
      // 迎光的前上刻面最亮、背下刻面收暗——刻面顶点全是板自身
      // 的角与边（真实特征），不是与板形无关的直带。约 3/10 板
      // 不切（素面块）；足块不切（尺寸太小、其面来自块形本身）
      let fz = tMain;
      if (inst.kind !== 'foot' && h3 >= 0.3 && !thickInsts.has(o)) {
        // 刻面间色阶必须拉开（首版相邻面只差 0.05–0.1、被量化与噪
        // 点吞掉，用户指「看不出切面」）：总落差约 0.65，前上最亮、
        // 后下最暗，相邻面差 0.08 起。中心菱面要小（用户定）：在
        // 归一化方空间（px 横、py 纵，均 -1..1）里取 |px|+|py|<0.30，
        // 刻面才有地方展开；扇区角也在方空间里算，折线才真正指向
        // 板的四角与四边中点
        const px = uu, py = (v - 0.5) * 2;
        if (Math.abs(px) + Math.abs(py) < 0.30) fz = tMain * 1.02; // 中心菱面
        else {
          const sec = ((Math.round(Math.atan2(py, px) / (Math.PI / 4)) % 8) + 8) % 8; // 0后 1后下 2下 3前下 4前 5前上 6上 7后上
          fz = [tMain * 0.74, tMain * 0.66, tMain * 0.8, tMain * 0.95, tMain * 1.18, tBev * 1.12, tMain * 1.08, tMain * 0.86][sec];
        }
      }
      if (spec.shellMode) fz = 1 + (fz - 1) * 0.75; // 人形壳面间对比略柔
      let f = fz * tint * (1 + (mottle - 1) * 0.35);
      if (v < 0.045) f *= 1.13; else if (v > 0.955) f *= 0.8; // 板端平带：上亮下暗
      f = quant(f);
      let base = (spec as LegSpec & { altTone?: boolean }).altTone === false ? S.armor : (o % 2 ? S.armor : S.armor2);
      if (A.blockPlates.has(o)) base = mix(base, S.accent, 0.38);
      // 大腿饰带：首板下缘双条强调色带
      if (o === A.stripeThigh && ((v > 0.8 && v < 0.845) || (v > 0.875 && v < 0.92))) { set(i, ramp(S.accent, 0.98)); continue; }
      if (inst.kind === 'foot') { base = S.armor2; f *= 0.85; }
      if (inst.kind === 'guard') { base = S.armor; f *= 1.04; } // 护板与段板分面（体积靠剖面本身）
      const cr = A.colorRole?.get(o); if (cr === 'armor') base = S.armor; else if (cr === 'armor2') base = S.armor2; else if (cr === 'accent') base = S.accent; else if (cr === 'mark') base = S.mark ?? S.accent; else if (cr === 'steel') base = S.metal;
      // 迷彩只上装甲底色：显式上漆的件（强调色/双色调色块）是
      // 漆面决定、不许被迷彩混色（躯干条纹曾被混成荧光黄——
      // 强调色块与迷彩同开时才发作，腿的饰带因 continue 躲过）
      if (spec.camo && !cr && vnoise(x / 58, y / 40, spec.seed + 3) > 0.62) base = mix(base, shade2(S.armor2, 0.8), 0.7);
      let c = ramp(base, f);
      // 板面拼缝：异形楔模式开启时，缝的几何由本模式在自身框
      // 内出（贴合楔缝、遇料厚带在棱处折角），画法登记给缝模
      // 式统一画（沟 + 沟内受光壁），不在此逐像素自画；未开启
      // 时走旧轴向线网（横线 + 斜度 + T 接头 + 竖缝），两条路
      // 互斥、无第二实现并存
      if (spec.wedges !== 0 && (A.wedgePlates?.has(o) ?? false)) {
        let lay = (A.wedgeSegs ??= new Map()).get(o);
        if (!lay) {
          const alt = A.wedgeAshlar?.get(o);
          const bands = wedgeBandsAuto(A, o);
          lay = alt !== undefined ? wedgeAshlar(o, spec.wedges ?? 1, alt, bands) : { segs: wedgeSegs(o, spec.wedges ?? 1, bands) };
          A.wedgeSegs.set(o, lay);
          // 楔缝登记给缝模式：自身框线段换算回画布坐标（与
          // polyTest 同一框），参照线沿 +v 偏置定受光侧
          const wPts = A.polyPts?.get(o);
          if (wPts && spec.seams !== false) {
            const F = polyFrame(wPts);
            const aSpan = (F.aMax - F.aMin) || 1, bSpan = (F.bMax - F.bMin) || 1;
            const toC = (su: number, sv: number): Pt => { const aa = F.aMin + (su + 1) / 2 * aSpan, bb = F.bMin + sv * bSpan; return { x: F.p0.x + F.ex.x * aa + F.ey.x * bb, y: F.p0.y + F.ex.y * aa + F.ey.y * bb }; };
            const wS = Math.max(0.9, Math.min(3, 0.02 * bSpan));
            for (const [x1, y1, x2, y2] of lay.segs) {
              const seg = [toC(x1, y1), toC(x2, y2)];
              // 受光壁起点 0.1：楔缝原画法的分界（沟心起小偏
              // 移即整侧受光），是本模式在板缝上的参数面
              regSeam(A, o, seg, seg.map(p => ({ x: p.x + F.ey.x * (wS + 1.5), y: p.y + F.ey.y * (wS + 1.5) })), wS, 0.1);
            }
          }
        }
        if (lay.courses && lay.joints) {
          // 无中心变体分块色：砌块逐块微差，指定层整层走第二色调
          let course = 0;
          while (course < 2 && v >= lay.courses[course + 1]) course++;
          let cell = 0;
          for (const j of lay.joints[course] ?? []) if (uu > j) cell++;
          const th = (((o * 31 + course * 7 + cell * 13) * 40503 + 11) >>> 0) % 100 / 100;
          const seamF = f * (0.93 + th * 0.11);
          const seamBase = lay.altCourse === course ? mix(base, S.armor2, 0.85) : base;
          c = ramp(seamBase, seamF);
        }
      } else {
        const dg = A.panelDiag.get(o);
        for (const lv of A.panelLines.get(o) ?? []) {
          const lvE = dg ? lv + dg * u * 0.45 : lv;
          if (Math.abs(v - lvE) < 0.011) c = ramp(base, f * 0.58);
          else if (Math.abs(v - lvE - 0.017) < 0.008 && !A.ridgeMode?.has(o)) c = ramp(base, f * 1.17); // 刻线下唇受光（登记件走模式 pass）
        }
        const tee = A.panelTee.get(o);
        if (tee !== undefined && Math.abs(u - tee) < 0.02 && v > 0.18 && v < 0.82) c = ramp(base, f * 0.58); // T 接头
        const su = A.seamU.get(o);
        if (su !== undefined && v > 0.12 && v < 0.88) {
          if (Math.abs(u - su) < 0.02) c = ramp(base, f * 0.58);
          else if (Math.abs(u - su + 0.034) < 0.009 && !A.ridgeMode?.has(o)) c = ramp(base, f * 1.15); // 竖缝前侧受光唇（登记件走模式 pass）
        }
      }
      // 警示纹在细节段按线段距离盖章（见下方 chevrons），此处不处理
      // 鞋底纹：脚底横向刻槽
      if (inst.kind === 'foot' && y > 470 && (x % 13) < 6) c = ramp(base, f * 0.5);
      if (inst.kind === 'foot' && v > 0.78) c = ramp(base, f * 0.68); // 鞋底带
      // 通风栅：大腿下板一块栅格
            if (o === A.ventId && u > -0.52 && u < 0.34 && v > 0.1 && v < 0.3) {
        const cyc = y % 12; // 凹槽：槽顶影 / 槽底 / 槽下唇受光
        if (cyc < 2) c = ramp(S.frame, 0.5);
        else if (cyc < 8) c = ramp(S.frame, 0.32);
        else if (cyc < 9) c = ramp(S.armor2, 1.05);
      }
      set(i, c);
    } else if (inst.kind === 'disc') {
      set(i, ramp(S.metal, 0.85 * mottle)); // 圆盘配方在调色拉伸后的专用 pass 按角度重绘
    } else if (inst.kind === 'cyl') {
      // 管模式：剖面受光值（峰在偏前 u=-0.3）走三大面五调子模
      // 式（CYL_LV 组）。箍（杆/罐的环带）已由生产者登记给缝模
      // 式、此地不再压暗；未登记的 cyl（喷口的径向分区、盘心
      // 环）保留分区压暗——那是它们自己的着色分区、不是箍
      const t = Math.max(0, 1 - Math.abs(u + 0.3)) ** 1.5;
      let f = toneFacing(t, u, CYL_LV);
      if (!(A.seamedCyl?.has(o)) && (v < 0.1 || (v > 0.45 && v < 0.55) || v > 0.9)) f *= 0.6;
      set(i, ramp(S.metal, quant(f * mottle)));
    } else if (inst.kind === 'sweep') {
      // 桶模式（椭圆扫掠的连接面）：底色按色角色，剖面受光值
      // （峰在偏前 u=-0.25）走三大面五调子模式（TUBE_LV 组）；
      // 环箍与板条纵缝是缝、归缝模式（解释器登记），不在此画
      const cr = A.colorRole?.get(o);
      const sb = cr === 'armor2' ? S.armor2 : cr === 'steel' ? S.metal : cr === 'accent' ? S.accent : S.armor;
      const t = Math.max(0, 1 - Math.abs(u + 0.25)) ** 1.5;
      set(i, ramp(sb, quant(toneFacing(t, u, TUBE_LV) * mottle)));
    } else if (inst.kind === 'rod') {
      // 拉杆五段横剖面：暗缘 / 肩 / 亮芯 / 肩 / 暗缘（参考铬杆的画法）
      const rp = u < -0.82 ? 0.3 : u < -0.48 ? 0.78 : u < -0.1 ? 1.34 : u < 0.32 ? 0.72 : u < 0.72 ? 0.44 : 0.27;
      set(i, ramp(S.chrome, quant(rp * mottle)));
    }
  }
  // 全局调色拉伸：暗更暗、亮更亮（拉开 std 与深暗部，细节盖章在其后保持 crisp）
  for (let i = 0; i < W * H; i++) {
    if (!cv.sil[i] || cv.col[i * 4 + 3] === 0) continue;
    for (let ch = 0; ch < 3; ch++) cv.col[i * 4 + ch] = Math.max(0, Math.min(255, (cv.col[i * 4 + ch] - 26) * 1.24 + 10));
  }
  // 分族明度抬升（逐族对参考明度带）
  { const lift = spec.lift ?? 0; if (lift) for (let i = 0; i < W * H; i++) { if (!cv.sil[i] || cv.col[i * 4 + 3] === 0) continue; for (let ch = 0; ch < 3; ch++) cv.col[i * 4 + ch] = Math.min(255, cv.col[i * 4 + ch] + lift); } }
  // 投影：光自前上、影向后下；owner 序号大者靠前，在身后部件上落影
  {
    const CAST = new Set(['plate', 'guard', 'foot', 'disc']);
    const offs: [number, number, number][] = [[-5, 6, 0.64], [-10, 12, 0.8], [-16, 20, 0.9]];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!cv.sil[i] || cv.col[i * 4 + 3] === 0) continue;
      const o = cv.owner[i];
      for (const [dx, dy, m] of offs) {
        const sx = x - dx, sy = y - dy;
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
        const so = cv.owner[sy * W + sx];
        if (so > o && CAST.has(cv.insts[so].kind)) { set(i, ramp(get(i), m)); break; }
      }
    }
  }
  // （v10 起刻槽/螺栓圈并入下方圆盘配方 pass）
  // 关节盖帽：整面按扇区平坦分面 + 毂（登记 hub 者：毂面 + 毂根缝）+ 帽缘收边
  // 履带相位：同心的一组盘（轮+毂）按最大半径折算同一转角，扇区随之转
  const beltSpin = new Map<string, number>();
  if (spec.beltPhase) {
    const maxR = new Map<string, number>();
    for (const d of A.discs) {
      const k = d.c.x.toFixed(1) + ',' + d.c.y.toFixed(1);
      maxR.set(k, Math.max(maxR.get(k) ?? 0, d.r));
    }
    for (const [k, r] of maxR) beltSpin.set(k, spec.beltPhase / r);
  }
  // 轮足相位：毂盘按登记的胎外径折算转角（不是毂盘自身半径——毂随胎转）
  const wheelSpin = new Map<string, number>();
  if (spec.wheelPhase && A.wheelHubs) {
    for (const h of A.wheelHubs) wheelSpin.set(h.c.x.toFixed(1) + ',' + h.c.y.toFixed(1), spec.wheelPhase / h.r);
  }
  for (const d of A.discs) {
    const x0 = Math.max(0, Math.floor(d.c.x - d.r)), x1 = Math.min(W - 1, Math.ceil(d.c.x + d.r));
    const y0 = Math.max(0, Math.floor(d.c.y - d.r)), y1 = Math.min(H - 1, Math.ceil(d.c.y + d.r));
    const spin = wheelSpin.get(d.c.x.toFixed(1) + ',' + d.c.y.toFixed(1)) ?? beltSpin.get(d.c.x.toFixed(1) + ',' + d.c.y.toFixed(1)) ?? 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (cv.owner[i] !== d.id) continue;
      const dx = (x - d.c.x) / d.r, dy = (y - d.c.y) / d.r;
      const rr = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) + spin;
      const fa = (Math.floor((ang + Math.PI) / (Math.PI / 6)) + 0.5) * (Math.PI / 6) - Math.PI;
      // 盘面改深枪灰 + 刻面对比收窄：参考的关节盘是近均匀的深色盘，
      // 旧配方顶面刻面过亮、外露后读成亮楔。登记了色角色的盘
      // （能量核/线圈环等）按角色底色走同一刻面明暗，不再一律枪灰
      const dcr = A.colorRole?.get(d.id);
      const dBase = dcr === 'accent' ? S.accent : dcr === 'armor' ? S.armor : dcr === 'armor2' ? S.armor2 : dcr === 'mark' ? (S.mark ?? S.accent) : dcr === 'steel' ? S.metal : mix(S.frame, S.metal, 0.35);
      let c = ramp(dBase, quant(0.72 + 0.22 * (0.45 * Math.cos(fa) - 0.89 * Math.sin(fa))));
      // 毂（关节盖帽登记 hub 者）：参考两样本的盘心都有独立毂
      // 结构（敏捷六角毂/重型环槽毂，共同点是毂面自成一面）：
      // 毂面提一档、毂根一道凹缝与盘面分开——旧配方整面一
      // 块刻面、无毂，装配里读成平黑大盘
      if (d.hub) { if (rr < 0.34) c = ramp(c, 1.17); else if (rr < 0.43) c = ramp(c, 0.66); }
      if (rr > 0.93) c = ramp(c, 0.78); // 帽缘收边
      set(i, c);
    }
  }
  // 标志图形盖章（菱/十字/三角/横杠，种子选一）
  {
    const { pos, kind } = A.insignia;
    const cx = Math.round(pos.x), cy = Math.round(pos.y);
    const colr = ramp(S.decal, 1.0);
    const put = (px: number, py: number) => { if (px >= 0 && px < W && py >= 0 && py < H && cv.sil[py * W + px]) set(py * W + px, colr); };
    if (kind === 0) { for (let dy = -8; dy <= 8; dy++) { const wdt = 8 - Math.abs(dy); for (let dx = -wdt; dx <= wdt; dx++) if (Math.abs(dx) > wdt - 2.4) put(cx + dx, cy + dy); } }
    else if (kind === 1) { for (let d = -8; d <= 8; d++) { put(cx + d, cy); put(cx + d, cy + 1); put(cx, cy + d); put(cx + 1, cy + d); } }
    else if (kind === 2) { for (let dy = 0; dy < 10; dy++) for (let dx = -dy / 2; dx <= dy / 2; dx++) if (Math.abs(dx) > dy / 2 - 1.6 || dy > 7.6) put(cx + Math.round(dx), cy + dy - 5); }
    else if (kind === 4) { // 徽章式（主战族对照）：橙环 + 实心星 + 浅心——不是空心星线框
      const colA = ramp(S.accent, 0.95);
      const putA = (px: number, py: number) => { if (px >= 0 && px < W && py >= 0 && py < H && cv.sil[py * W + px]) set(py * W + px, colA); };
      for (let dy = -11; dy <= 11; dy++) for (let dx = -11; dx <= 11; dx++) { const r = Math.hypot(dx, dy); const th = Math.atan2(dy, dx); const loc = Math.abs(((th / (Math.PI * 2) * 5) % 1 + 1.5) % 1 - 0.5) * 2; const R = 8.6 - 4.6 * loc; if (Math.abs(r - 11) < 1.3) putA(cx + dx, cy + dy); else if (r < R) putA(cx + dx, cy + dy); else if (r < 1.8) put(cx + dx, cy + dy); }
    }
    else { for (let r = 0; r < 3; r++) for (let dx = -8; dx <= 8; dx++) { put(cx + dx, cy - 6 + r * 6); put(cx + dx, cy - 5 + r * 6); } }
  }
  // 漆带（模式：沿线段在指定板面上漆强调色带；缺省落小腿壳板
  // shinIds、半宽 6.5——胫骨斜带与车体贯穿带共用此一画法，站点
  // 只登记线段、目标板与半宽）
  for (const seg of A.stripeSegs) {
    const { p1, p2 } = seg, ids = seg.ids ?? A.shinIds, hw = seg.w ?? 6.5;
    const x0 = Math.max(0, Math.floor(Math.min(p1.x, p2.x) - 10)), x1 = Math.min(W - 1, Math.ceil(Math.max(p1.x, p2.x) + 10));
    const y0 = Math.max(0, Math.floor(Math.min(p1.y, p2.y) - 10)), y1 = Math.min(H - 1, Math.ceil(Math.max(p1.y, p2.y) + 10));
    const dxs = p2.x - p1.x, dys = p2.y - p1.y, ll = Math.hypot(dxs, dys) || 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (!ids.has(cv.owner[i])) continue;
      const tt = Math.max(0, Math.min(1, ((x - p1.x) * dxs + (y - p1.y) * dys) / (ll * ll)));
      const m = Math.hypot(x - (p1.x + dxs * tt), y - (p1.y + dys * tt));
      if (m < hw) set(i, ramp(S.accent, 0.95));
    }
  }
  // 仪表窗（scout 式）：小腿板面凹框 + 强调色窗面 + 高光点
  if (A.deviceFrame) {
    const { c: dc, ux, uy, px, py } = A.deviceFrame; // 锚在护板下部（C(0.72, hw*0.6)），盖章在护板面上
    for (let y = Math.floor(dc.y - 20); y <= dc.y + 20; y++) for (let x = Math.floor(dc.x - 20); x <= dc.x + 20; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const i = y * W + x;
      if (!cv.sil[i]) continue;
      const rx = x - dc.x, ry = y - dc.y;
      const du = rx * ux + ry * uy, dv = rx * px + ry * py;
      if (Math.abs(du) > 11 || Math.abs(dv) > 8) continue;
      if (Math.abs(du) > 8.5 || Math.abs(dv) > 5.5) set(i, ramp(S.frame, 1.25));
      else if (dv < -2.5) set(i, ramp(S.accent, 0.72));
      else set(i, ramp(S.accent, 1.05));
      if (Math.abs(du + 3) < 1.4 && Math.abs(dv - 1) < 1.4) set(i, ramp(S.glow, 1.3));
    }
  }
  // 大腿双斜杠贴花（编号下方，两道短斜杠）
  {
    const cx = Math.round(A.numPos.x - 2), cy = Math.round(A.numPos.y + 13);
    for (let k = 0; k < 2; k++) for (let t = 0; t < 13; t++) {
      const bx = cx + k * 11 + Math.round(t * 0.55), by = cy + t;
      for (let wdt = 0; wdt < 3; wdt++) {
        const pxx = bx + wdt, pyy = by;
        if (pxx >= 0 && pxx < W && pyy >= 0 && pyy < H && cv.sil[pyy * W + pxx]) set(pyy * W + pxx, ramp(S.accent, 0.98));
      }
    }
  }
  // 警示箭头纹盖章：只落在护板上、距线段 <4.5px 处
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (cv.owner[i] !== A.stripeId) continue;
    let m = 1e9;
    for (const [p, q] of A.chevrons) {
      const f = segFrame(p, q);
      const rx = x - p.x, ry = y - p.y;
      const t = Math.max(0, Math.min(1, (rx * f.ux + ry * f.uy) / f.len));
      m = Math.min(m, Math.hypot(x - (p.x + f.ux * f.len * t), y - (p.y + f.uy * f.len * t)));
    }
    if (m < 3.4) set(i, A.chevDecal ? ramp(S.decal, 0.98) : ramp(S.accent, 1.02));
  }
  // 贴纸文字与编号
  const drawText = (anchor: Pt, text: string, scale: number, colr: RGB, center = false, clipId = -1) => {
    const wpx = text.length * 4 * scale - scale;
    let cx0 = Math.round(anchor.x - (center ? wpx / 2 : 0)), cy0 = Math.round(anchor.y);
    for (const ch of text) {
      const g = FONT[ch] ?? FONT[' '];
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (g[gy][gx] === '1')
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
          const px = cx0 + gx * scale + sx, py = cy0 + gy * scale + sy;
          if (px >= 0 && px < W && py >= 0 && py < H && cv.sil[py * W + px] && (clipId < 0 || cv.owner[py * W + px] === clipId)) set(py * W + px, colr);
        }
      cx0 += 4 * scale;
    }
  };
  drawText(A.decalPos, 'CAUTION', 2, ramp(S.decal, 1.0), true, A.guardId);
  drawText(A.numPos, A.numText, 2, ramp(S.decal, 0.95), false, A.stripeThigh);
  // 趾块前端面（主战式）：带框端面板 + 中心栓点，只落在足块像素上
  if (A.toeFace) {
    const F = A.toeFace;
    for (let y = F.y0; y <= F.y1; y++) for (let x = F.x0; x <= F.x1; x++) {
      const i = y * W + x;
      if (cv.owner[i] < 0 || cv.insts[cv.owner[i]].kind !== 'foot') continue;
      const edge = x === F.x0 || x === F.x1 || y === F.y0 || y === F.y1;
      const dot = Math.abs(x - (F.x0 + F.x1) / 2) <= 1 && Math.abs(y - (F.y0 + F.y1) / 2) <= 1;
      const c = get(i);
      if (edge || dot) set(i, [c[0] * 0.5, c[1] * 0.5, c[2] * 0.52]);
      else set(i, [c[0] * 1.16, c[1] * 1.16, c[2] * 1.14]);
    }
  }
  // 警示三角（CAUTION 上方）
  {
    const cx = Math.round(A.decalPos.x), cy = Math.round(A.decalPos.y) - 16;
    for (let dy = 0; dy < 9; dy++) for (let dx = -dy / 2; dx <= dy / 2; dx++) {
      const px = cx + Math.round(dx), py = cy + dy;
      if (px >= 0 && px < W && py >= 0 && py < H && cv.sil[py * W + px]) set(py * W + px, ramp(S.accent, 1.0));
    }
  }
  // 半球模式：栓头是一颗贴在面上的半球——按球面法线逐像素走
  // 三大面五调子模式（受光值 t 由法线·光向 (−0.5,−0.6,0.62)
  // 归一，光向与全图一致：高光落在左上）。栓调用本模式，不
  // 再用平色块+外置 glint 的旧印章
  const domePx = (cx: number, cy: number, r: number, base: RGB) => {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      const px = Math.round(cx) + dx, py = Math.round(cy) + dy;
      if (px < 0 || px >= W || py < 0 || py >= H || !cv.sil[py * W + px]) continue;
      const nx = dx / r, ny = dy / r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const s = nx * -0.5 + ny * -0.6 + nz * 0.62;
      set(py * W + px, ramp(base, toneFacing((s + 1) / 2, ny)));
    }
  };
  // 铆钉/栓：半球模式（r 1.6 的小半球，钢色——深框色表达不出
  // 亮面与高光，实测全团发黑）
  for (const p of A.boltPts) domePx(p.x, p.y, 1.6, S.metal);
  // 球模式：整球与半球同配方（球面法线场相同），差别在反光
  // 环更整圈、且球体自带轮廓——登记走 A.balls（如瞄具桅球）
  for (const b of A.balls ?? []) domePx(b.x, b.y, b.r, b.role === 'accent' ? S.accent : b.role === 'steel' ? S.metal : S.frame);
  // 信号灯：亮芯 + 光晕
  for (const p of A.lightPts) {
    const bx = Math.round(p.x), by = Math.round(p.y);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const px = bx + dx, py = by + dy, d = Math.abs(dx) + Math.abs(dy);
      if (px < 0 || px >= W || py < 0 || py >= H || !cv.sil[py * W + px]) continue;
      if (d === 0) set(py * W + px, [255, 240, 200]);
      else if (d <= 2) set(py * W + px, ramp(S.glow, 1.25));
    }
  }
  // 盘缘侧壁：每件四周 3px 厚度带——上沿受光面、下沿侧壁、前壁转暗、后壁微暗
  for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
    const i = y * W + x, o = cv.owner[i];
    if (o < 0 || !cv.sil[i]) continue;
    const k = cv.insts[o].kind;
    if (k !== 'plate' && k !== 'guard' && k !== 'foot' && k !== 'disc') continue;
    const cur = get(i);
    if (cv.owner[i + 3 * W] !== o) set(i, ramp(cur, 0.68));       // 下侧壁（最强）
    else if (cv.owner[i - 3 * W] !== o) set(i, ramp(cur, 1.13));  // 上沿受光
    else if (cv.owner[i + 3] !== o) set(i, ramp(cur, 0.8));       // 前壁
    else if (cv.owner[i - 3] !== o) set(i, ramp(cur, 0.88));      // 后壁
  }
  // 斜面带：横向边界上亮唇 + 下暗唇两行；纵向边界前亮后暗（剪影最外圈由描边收尾）
  // 豁免：桶面是单一曲面——段界是构造椭圆的弧、由桶面自身箍着色
  // 标记，不许在此压亮唇把整圈轮廓描出来
  for (let y = 2; y < H - 2; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, o = cv.owner[i];
    if (o < 0 || !cv.sil[i]) continue;
    if (cv.insts[o].kind === 'sweep') continue;
    const cur = get(i);
    if (cv.owner[i - W] !== o) set(i, ramp(cur, 1.24));
    else if (cv.owner[i + W] !== o) set(i, ramp(cur, 0.6));
    else if (cv.owner[i + W] === o && cv.owner[i + 2 * W] !== o) set(i, ramp(cur, 0.84));
    else if (cv.owner[i + 1] !== o) set(i, ramp(cur, 1.12));
    else if (cv.owner[i - 1] !== o) set(i, ramp(cur, 0.8));
  }
  // 高光算子（单一实现）：把一条折线按 tone 画在登记件自身像素
  // 上（tone>1 为高光、<1 为暗线）。高光棱模式与缝模式都只调
  // 它画线，不许别处再写一份线着色
  const toneLine = (inst: number, pts: Pt[], tone: number, rad = 0.9) => {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (cv.owner[i] !== inst) continue;
      let dMin = 1e9;
      for (let s = 0; s + 1 < pts.length; s++) {
        const ax = pts[s].x, ay = pts[s].y, bx = pts[s + 1].x, by = pts[s + 1].y;
        const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1;
        let tt = ((x - ax) * ex + (y - ay) * ey) / L2; tt = Math.max(0, Math.min(1, tt));
        const d = Math.hypot(x - (ax + ex * tt), y - (ay + ey * tt));
        if (d < dMin) dMin = d;
      }
      if (dMin <= rad) set(i, ramp(get(i), tone));
    }
  };
  // 缝模式（单一实现）：一道缝 = 一条沟，横截面分段给调子
  // ——沟底 ×0.55、背光侧沟壁同沟底、受光侧沟壁 ×1.2：高光
  // 渗透到缝里（亮在沟内），缝外不画任何亮带（用户立）。高
  // 光的施加与高光算子同式（对现色 ramp 乘倍率）；lipPts 只
  // 定哪一侧是受光侧、本身不画。不登记的件不走此路；
  // spec.seams=false 时整表不画
  for (const sm of spec.seams === false ? [] : A.seams ?? []) {
    const w = sm.w ?? 0.9;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (cv.owner[i] !== sm.inst) continue;
      let dBest = 1e9, dSign = 0;
      for (let s = 0; s + 1 < sm.pts.length; s++) {
        const ax = sm.pts[s].x, ay = sm.pts[s].y, bx = sm.pts[s + 1].x, by = sm.pts[s + 1].y;
        const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1;
        let tt = ((x - ax) * ex + (y - ay) * ey) / L2; tt = Math.max(0, Math.min(1, tt));
        const qx = ax + ex * tt, qy = ay + ey * tt;
        const d = Math.hypot(x - qx, y - qy);
        if (d >= dBest) continue;
        dBest = d;
        if (sm.lipPts) {
          // 受光侧符号：唇段中点相对沟段中点的方向定法线正向，
          // 像素在唇侧为正
          const svx = (sm.lipPts[s].x + sm.lipPts[s + 1].x - ax - bx) / 2, svy = (sm.lipPts[s].y + sm.lipPts[s + 1].y - ay - by) / 2;
          const nd = (-ey) * svx + ex * svy;
          dSign = ((x - qx) * -ey + (y - qy) * ex) * (nd < 0 ? -1 : 1);
        }
      }
      if (dBest > w) continue;
      set(i, ramp(get(i), sm.lipPts && dSign > w * (sm.lipAt ?? 0.4) ? 1.2 : 0.55));
    }
  }
  // 料厚模式的带面着色（本模式自己的操作）：棱线前侧 faceW 宽
  // 的带一档平色差。棱线的高光在登记时已由 regThickness 代登
  // 记给高光棱模式（料厚模式调用高光棱模式）；带面紧随它自己
  // 的棱线执行（按 pts 引用配对）——与旧融合实现的次序逐项
  // 一致，饱和处的高光恢复不被带面盖掉
  const bandShade = (b: { inst: number; pts: Pt[]; faceW: number; faceDx?: number; faceDy?: number; faceTone?: number }) => {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (cv.owner[i] !== b.inst) continue;
      let dMin = 1e9, qFace = -1;
      for (let s = 0; s + 1 < b.pts.length; s++) {
        const ax = b.pts[s].x, ay = b.pts[s].y, bx = b.pts[s + 1].x, by = b.pts[s + 1].y;
        const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1;
        let tt = ((x - ax) * ex + (y - ay) * ey) / L2; tt = Math.max(0, Math.min(1, tt));
        const d = Math.hypot(x - (ax + ex * tt), y - (ay + ey * tt));
        if (d < dMin) dMin = d;
        if (s === 0) qFace = (x - ax) * (b.faceDx ?? 0) + (y - ay) * (b.faceDy ?? 0);
      }
      if (dMin > 0.9 && qFace > 0.9 && qFace <= b.faceW) set(i, ramp(get(i), b.faceTone ?? 0.95));
    }
  };
  const bandOf = new Map<Pt[], (typeof A.thickBands)[number]>();
  for (const b of A.thickBands ?? []) bandOf.set(b.pts, b);
  // 高光棱模式（单一实现）：登记的棱线逐条调用高光算子，料厚
  // 带面紧随其棱线。不登记的件不走此路；spec.ridges=false 时
  // 整表不画（公式旧路对登记件仍跳过，不复活第二实现）
  for (const r of A.ridges ?? []) {
    if (spec.ridges === false) break;
    if (!(spec.wedges === 0 || !r.panel || !(A.wedgePlates?.has(r.inst) ?? false))) continue;
    toneLine(r.inst, r.pts, r.tone);
    const b = bandOf.get(r.pts);
    if (b) bandShade(b);
  }
  // 凹陷暗影：板压板处接缝下方落影（盖过棱线提亮）、第二行余影、关节盘窝影
  for (let y = 2; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, o = cv.owner[i];
    if (o < 0) continue;
    const kindOf = (n: number) => (n >= 0 ? cv.insts[n].kind : null);
    const up = cv.owner[i - W], up2 = cv.owner[i - 2 * W];
    const nearDisc = [up, cv.owner[i + W], cv.owner[i - 1], cv.owner[i + 1]].some((n) => kindOf(n) === 'disc') && cv.insts[o].kind !== 'disc';
    if (nearDisc) { set(i, ramp(get(i), 0.72)); continue; }
    const upKind = kindOf(up);
    if (up !== o && (upKind === 'plate' || upKind === 'guard' || upKind === 'foot')) set(i, ramp(get(i), 0.78));
    else if (up2 !== o && up === o && (kindOf(up2) === 'plate' || kindOf(up2) === 'guard')) set(i, ramp(get(i), 0.92));
  }
  // 进气口（散热盒）：模式的主体是着色组合，结构成立与否是它
  // 的检验。调用链：龙骨突总成（构造侧按散热口长出）→ 散热盒
  // → 盒子模式 → 三大面五调子。三个面不另画颜色——在板件着
  // 色链已给的像素上按面朝向取调子：顶面受光值沿深轴远高近
  // 低（落亮面→高光带），装口面按构造侧登记的 ftone（站点斜
  // 向的实测读数）归到最近的调子带，端面落中间调（本调）。
  // 读数的实测锚（四样本）：顶面 1.34–1.44、背光斜面
  // 0.54–0.78、正对面 1.00、端面基准 1.00。接合亮棱在构造时
  // 已登记给高光棱算子。口内是口的子模式：腔内上影 + 叶片渐
  // 变 + 近黑缝 + 横向落光
  const intakeIds = new Set((A.intakes ?? []).map(v => v.id)); // 同一口的各面互为内部（接合不算轮廓）
  for (const it of A.intakes ?? []) {
    const bx0 = Math.max(0, Math.floor(it.cx - it.w / 2 - 1)), bx1 = Math.min(W - 1, Math.ceil(it.cx + it.w / 2 + 1));
    const by0 = Math.max(0, Math.floor(it.cy - it.h / 2 - 1)), by1 = Math.min(H - 1, Math.ceil(it.cy + it.h / 2 + 1));
    const IP = spec.intake; // 模式库「进气口」着色条目参数（缺省 = 校准值）
    const hLoc = it.quad ? Math.hypot(it.quad[3].x - it.quad[0].x, it.quad[3].y - it.quad[0].y) : it.h; // 口的本地高（沿装口面左边）
    const shadowH = Math.max(1, Math.round(hLoc * (IP?.rim ?? 0.1))); // 口顶缘腔内上影高
    const zoneH = hLoc - shadowH, n = Math.max(2, Math.round(zoneH / (IP?.pitch ?? 7))), pitch = zoneH / n;
    const slatBase = IP?.accentSlats ? S.accent : S.metal; // 叶片材质：金属（胸口）/ 强调色（荚口变体）
    const slatDark = ramp(slatBase, 0.42), slatLight = ramp(slatBase, 1.04);
    const x0 = it.cx - it.w / 2, y0 = it.cy - it.h / 2;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      const i = y * W + x;
      if (cv.owner[i] !== it.id) continue;
      let dist = 9;
      const inside = it.face === 'front'
        ? (o: number) => o === it.id
        : (o: number) => intakeIds.has(o); // 面：与同口其他面相邻不算轮廓
      for (let d = 1; d <= 3; d++) {
        if (x - d < 0 || !inside(cv.owner[i - d])) { dist = Math.min(dist, d - 1); break; }
        if (x + d >= W || !inside(cv.owner[i + d])) { dist = Math.min(dist, d - 1); break; }
        if (y - d < 0 || !inside(cv.owner[i - d * W])) { dist = Math.min(dist, d - 1); break; }
        if (y + d >= H || !inside(cv.owner[i + d * W])) { dist = Math.min(dist, d - 1); break; }
      }
      // 外轮廓压暗只管口与装口面；顶/侧面的外缘是盒与承载面的接
      // 合（归高光棱/接缝），压暗会把 2-3px 的薄面整条吃掉
      if (dist === 0 && (it.face === 'front' || it.face === 'face')) { set(i, ramp(S.frame, 0.4)); continue; }
      // 本地框按登记的面四角取：u 沿顶边、v 沿左边——叶片与渐变
      // 跟着面自己的框走（斜面上的口，叶片就是斜的），不沿画布
      const q = it.quad;
      let lu = x - (it.cx - it.w / 2), lv = y - (it.cy - it.h / 2), wLoc = it.w, lbLoc = it.h;
      if (q) {
        // 平行四边形框的仿射坐标：rel = u·顶边 + v·左边（解 2x2 基
        // 逆，不是两次独立点积——两轴不正交时点积给的是垂距、行会
        // 歪）。lu/lv 换算回沿轴弧长
        const axx = q[1].x - q[0].x, axy = q[1].y - q[0].y, ayx = q[3].x - q[0].x, ayy = q[3].y - q[0].y;
        const la = Math.hypot(axx, axy) || 1, lb = Math.hypot(ayx, ayy) || 1;
        const det = axx * ayy - axy * ayx || 1;
        const rxq = x - q[0].x, ryq = y - q[0].y;
        lu = ((rxq * ayy - ryq * ayx) / det) * la; lv = ((axx * ryq - axy * rxq) / det) * lb; wLoc = la; lbLoc = lb;
      }
      if (it.face === 'top') { // 顶面（盒子模式）：受光值沿深轴（quad[3]→quad[0] 为远向）远高近低，落亮面→高光带
        let dv = 1 - Math.max(0, Math.min(1, ((x - x0) + (y - y0)) / Math.max(1, it.w + it.h)));
        if (q) {
          const dqx = q[0].x - q[3].x, dqy = q[0].y - q[3].y, ld2 = dqx * dqx + dqy * dqy || 1;
          dv = Math.max(0, Math.min(1, ((x - q[3].x) * dqx + (y - q[3].y) * dqy) / ld2));
        }
        set(i, ramp(get(i), toneFacing(0.75 + 0.22 * dv, 0, BOX_LV)));
      } else if (it.face === 'face') { // 装口面（盒子模式）：站点 ftone 按有效阶梯归到最近的调子带；框带底边上强调色（附属件模式③，band 登记的站点）
        if (it.band && lv > lbLoc * 0.84) set(i, ramp(mix(get(i), S.mark ?? S.accent, 0.88), 1));
        else {
          const fq = rampQ(it.ftone ?? 1);
          let bt = BOX_BANDS[2].t, bd = Infinity;
          for (const b of BOX_BANDS) { const d = Math.abs(b.eff - fq); if (d < bd) { bd = d; bt = b.t; } }
          set(i, ramp(get(i), toneFacing(bt, 0, BOX_LV)));
        }
      } else if (it.face === 'side') { // 端面（盒子模式）：落中间调 = 本调 1.0
        set(i, ramp(get(i), toneFacing(BOX_BANDS[2].t, 0, BOX_LV)));
      } else { // 口：腔内上影 + 叶片渐变 + 缝
        const ly = lv, u = lu / Math.max(1, wLoc); // u: 横向落光（实测栅面左亮右暗）
        const fall = 1 - (IP?.fall ?? 0.22) * Math.max(0, Math.min(1, u));
        let c: RGB;
        if (ly <= shadowH) c = ramp(S.frame, 0.48); // 腔内上影
        else {
          const yy = ly - shadowH - 1, ph = yy % pitch, zone = pitch * 0.76, peak = IP?.peak ?? 0.75; // 缝占节距 24%
          if (ph < zone) { // 叶片：上暗 → 下亮（亮峰在 peak 处）
            const t = ph / zone, g = t < peak ? t / peak : 1 - (t - peak) * 0.8;
            c = ramp(mix(slatDark, slatLight, g), fall);
          } else c = ramp(S.frame, 0.5 * fall + 0.12); // 缝（近黑）
        }
        set(i, c);
      }
    }
  }
  // 做旧一：啃边（剪影边缘高频噪声咬成内框色）
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!cv.sil[i]) continue;
    const edge = !cv.sil[i - 1] || !cv.sil[i + 1] || !cv.sil[i - W] || !cv.sil[i + W];
    if (edge && vnoise(x / 3.1, y / 3.1, spec.seed + 5) > 0.78) set(i, hash2(x, y, spec.seed + 31) > 0.45 ? ramp(mix(S.frame, S.chrome, 0.55), 1.05) : ramp(S.frame, 1.15));
  }
  // 做旧二：划痕（种子短线，只落在板上）
  for (let k = 0; k < 12; k++) {
    let px = 40 + rnd() * (W - 80), py = 40 + rnd() * (H - 120);
    const ang = rnd() * Math.PI, len = 8 + rnd() * 22;
    for (let s = 0; s < len; s++) {
      const x = Math.round(px + Math.cos(ang) * s), y = Math.round(py + Math.sin(ang) * s * 0.4);
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const i = y * W + x, o = cv.owner[i];
      if (o >= 0 && (cv.insts[o].kind === 'plate' || cv.insts[o].kind === 'guard')) set(i, ramp(mix(get(i), S.chrome, 0.45), 1.02));
    }
  }
  // 做旧二点五：磨损斑（锈色斑块 + 暗斑，强度按配色 wear）
  {
    const wear = spec.wear ?? 0;
    if (wear > 0) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!cv.sil[i]) continue;
      const n = vnoise(x / 13, y / 13, spec.seed + 21);
      if (n > 0.665) { const b = 0.55 * wear * Math.min(1, (n - 0.665) * 4); if (b > 0.02) set(i, mix(get(i), [146, 86, 48], b)); }
      else if (n < 0.3) set(i, ramp(get(i), 1 - 0.16 * wear));
    }
  }
  // 定向磨损：凸缘掉漆（边界偏置）+ 螺栓下锈流挂 + 螺栓旁刮痕
  {
    const wear = spec.wear ?? 0;
    if (wear > 0.05) {
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x, o = cv.owner[i];
        if (o < 0) continue;
        const k = cv.insts[o].kind;
        if (k !== 'plate' && k !== 'guard' && k !== 'foot' && k !== 'disc') continue;
        const edge = cv.owner[i - 1] !== o || cv.owner[i + 1] !== o || cv.owner[i - W] !== o || cv.owner[i + W] !== o;
        if (edge && hash2(x, y, spec.seed + 31) < 0.17 * wear + 0.03) set(i, mix(get(i), S.chrome, 0.5)); // 凸缘亮掉漆
      }
      const rustAmt = Math.min(1, wear * 1.2);
      for (const b of A.boltPts) { // 流挂：自螺栓向下渐淡
        const L = 6 + Math.floor(hash2(Math.round(b.x), Math.round(b.y), spec.seed + 41) * 15);
        for (let dy = 1; dy <= L; dy++) {
          const x = Math.round(b.x + (hash2(Math.round(b.x), dy, spec.seed + 43) - 0.5) * 2), y = Math.round(b.y) + dy;
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const i = y * W + x, o = cv.owner[i];
          if (o < 0 || cv.insts[o].kind !== 'plate') continue;
          set(i, mix(get(i), [146, 86, 48], 0.38 * rustAmt * (1 - dy / L)));
        }
      }
      for (const b of A.boltPts) { // 刮痕：螺栓旁短亮线
        if (hash2(Math.round(b.x), Math.round(b.y), spec.seed + 53) > 0.45) continue;
        const len = 9 + Math.floor(hash2(Math.round(b.y), Math.round(b.x), spec.seed + 59) * 8);
        for (let t = 0; t < len; t++) {
          const x = Math.round(b.x + 6 + t), y = Math.round(b.y + 3 + t * 0.3);
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const i = y * W + x, o = cv.owner[i];
          if (o < 0 || cv.insts[o].kind !== 'plate') continue;
          set(i, mix(get(i), S.chrome, 0.3));
        }
      }
    }
  }
  // 做旧三：底部积尘（越靠下越暗 + 斑驳）
  for (let y = Math.floor(H * 0.72); y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!cv.sil[i] || cv.col[i * 4 + 3] === 0) continue;
    const t = (y / H - 0.72) / 0.28;
    const f = 1 - 0.16 * t * (0.6 + 0.4 * vnoise(x / 6, y / 6, spec.seed + 9));
    set(i, ramp(get(i), f));
  }
  // （接地阴影已移除：它不是机甲的一部分，属于展示层，不进生成管线——2026-11-06 用户裁定）
  // 描边
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!cv.sil[i]) continue;
    if (!cv.sil[i - 1] || !cv.sil[i + 1] || !cv.sil[i - W] || !cv.sil[i + W]) { const c = get(i); set(i, [c[0] * 0.3, c[1] * 0.3, c[2] * 0.32]); }
  }
  // 末端清扫：中途各 pass 按剪影迭代可能给无主像素上过色，统一清回透明（只清剪影内）
  for (let i = 0; i < W * H; i++) {
    if (cv.sil[i] && cv.owner[i] < 0) cv.col[i * 4 + 3] = 0;
  }
  return cv;
}
function shade2(c: RGB, f: number): RGB { return [c[0] * f, c[1] * f, c[2] * f]; }


function srandF(s: number) { let a = (s * 2654435761) >>> 0; return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; }; }
/** 块形模式（模式库「块形·非四边形」条目 mpat-blockshape）：块的逐角
 * 切角分布——切角量 = 基础切角 × [varLo, varHi] 逐角独立抽（种子 =
 * 件号）、侧边台阶概率 stepP；chamFloor 是切角下限：调用点给再小的
 * cham 也不许把形状语言关掉（腰块 cham 0.18 时切角只剩短边约 1/11、
 * 块读作矩形——2026-11-06 v14 定版「参考的块基本上没有四边形」在
 * 产品块原语上的对应关口）。未设 = 分布同定版值、下限 0（旧行为）。 */
export interface BlockShapeParams { chamFloor: number; varLo: number; varHi: number; stepP: number }
export const BLOCK_SHAPE_DEFAULT: BlockShapeParams = { chamFloor: 0.3, varLo: 0.3, varHi: 1.8, stepP: 0.45 };
function blockPolyT(cx: number, cy: number, w: number, h: number, ang: number, cham = 0.36, seed = 0, bs?: BlockShapeParams): Pt[] {
  const ca = Math.cos(ang), sa = Math.sin(ang), lx = w / 2, ly = h / 2;
  const rnd = srandF(seed * 7919 + 13);
  const varLo = bs?.varLo ?? 0.3, varHi = bs?.varHi ?? 1.8;
  const base = (Math.min(w, h) * Math.max(cham, bs?.chamFloor ?? 0)) / 2;
  const c = [0, 1, 2, 3].map(() => Math.min(base * (varLo + rnd() * (varHi - varLo)), Math.min(w, h) * 0.46));
  const raw: Pt[] = [{ x: -lx + c[0], y: -ly }, { x: lx - c[1], y: -ly }, { x: lx, y: -ly + c[1] }, { x: lx, y: ly - c[2] }, { x: lx - c[2], y: ly }, { x: -lx + c[3], y: ly }, { x: -lx, y: ly - c[3] }, { x: -lx, y: -ly + c[0] }];
  if (rnd() < (bs?.stepP ?? 0.45) && w > 34 && h > 26) {
    const d = 2 + rnd() * 3, y0 = -ly + c[1] + (h - c[1] - c[2]) * (0.25 + rnd() * 0.3), len = (h - c[1] - c[2]) * 0.3;
    const pts: Pt[] = [raw[0], raw[1], raw[2], { x: lx, y: y0 }, { x: lx - d, y: y0 }, { x: lx - d, y: y0 + len }, { x: lx, y: y0 + len }, raw[3], raw[4], raw[5], raw[6], raw[7]];
    return pts.map((q) => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
  }
  return raw.map((q) => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
}
interface LayerTools { segPlate: (a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap?: number, kind?: Kind, faceW?: number) => number; A: Anchors; addBlock: (kind: Kind, cx: number, cy: number, w: number, h: number, ang?: number, cham?: number, bolts?: boolean) => number; addDisc: (kind: Kind, c: Pt, r: number) => number; jointDisc: (c: Pt, r: number, hub?: number) => void; addPoly: (pts: Pt[], bolts?: boolean) => number; addRaw: (kind: Kind, test: (x: number, y: number) => [boolean, number, number]) => number; rod: (a: Pt, b: Pt, r: number, bellows?: number) => number; grille: (cx: number, cy: number, w: number, h: number, depth?: [number, number], faceTone?: number, tilt?: number, share?: [number, number]) => void; intakeBox: (c: [Pt, Pt, Pt, Pt], depth?: [number, number], faceTone?: number, tilt?: number, share?: [number, number], band?: boolean) => void; box: (c: [Pt, Pt, Pt, Pt], depth?: [number, number], faceTone?: number, tilt?: number) => { faceId: number; sideId: number; botFace: [Pt, Pt]; botSide: [Pt, Pt] }; flatGrille: (cx: number, cy: number, w: number, h: number) => void; glacis: (cx: number, cy: number, w: number, h: number, slope: number) => number; portArray: (cx: number, cy: number, w: number, h: number, cols: number, rows: number) => void; nozzle: (a: Pt, b: Pt, r0: number, r1: number) => void; wing: (cx: number, cy: number, len: number, wRoot: number, wTip: number, ang: number) => number; finish: () => void }
function makeLayerTools(cv: MechaCanvas, seed: number, bs?: BlockShapeParams): LayerTools {
  const rnd = mulberry32(seed);
  let id = 0;
  const A: Anchors = { plateTint: new Map(), panelLines: new Map(), boltPts: [], ventId: -1, guardId: -1, stripeId: -1, decalPos: { x: 0, y: 0 }, numPos: { x: 0, y: 0 }, numText: '', lightPts: [], discs: [], chevrons: [], seamU: new Map(), insignia: { pos: { x: 0, y: 0 }, kind: 0 }, stripeThigh: -1, blockPlates: new Set(), deviceFrame: null, chevDecal: true, shinIds: new Set(), stripeSegs: [], panelDiag: new Map(), panelTee: new Map(), decalKind: 'num', toeFace: null, colorRole: new Map() };
  const tints = [0.78, 0.9, 1.0, 1.1, 1.24];
  const reg = (myId: number) => {
    A.plateTint.set(myId, tints[Math.floor(rnd() * 5)]);
    const lines: number[] = []; const n = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) lines.push(0.3 + rnd() * 0.45);
    A.panelLines.set(myId, lines);
    // 不登记自动竖缝（用户定）：随机位置的全高竖线与横线在板面
    // 上组成十字，那不是装甲板该有的缝——板的竖向分界只能来自
    // 构造（另一块板、T 型接头、显式登记的缝）
    if (rnd() < 0.3) A.panelDiag.set(myId, (rnd() - 0.5) * 0.9);
    if (rnd() < 0.35) A.panelTee.set(myId, 0.1 + rnd() * 0.8);
  };
  // 高光棱模式登记（多边形件）：reg 定的刻线/竖缝，其唇改走模式 pass
  const regPolyRidges = (myId: number, pts: Pt[]) => {
    for (const lv of A.panelLines.get(myId) ?? []) polyLip(A, myId, pts, lv);
    const su = A.seamU.get(myId); if (su !== undefined) polySeamLip(A, myId, pts, su);
  };
  const addBlock = (kind: Kind, cx: number, cy: number, w: number, h: number, ang = 0, cham = 0.36, bolts = false): number => {
    cv.insts.push({ kind }); const myId = id;
    const bp = blockPolyT(cx, cy, w, h, ang, cham, myId + 2000, bs);
    const t = polyTest(bp);
    fillShape(cv, id, t); id++;
    if (kind === 'cyl') {
      // 罐的横箍是缝：仅当 b 轴是圆柱的长轴（剖面 a 跨短边、
      // v 沿长轴——罐/桶的情形）时，v 分区（两端 + 正中，与旧
      // 公式同位）才是真箍，登记给缝模式、基色公式不再压暗。
      // a 轴更长的薄片（鳍片类）着色是沿长边的剖面渐变，其 v
      // 分区（跨厚方向）从来不是箍——不登记、公式照旧
      const F = polyFrame(bp);
      const spanB = F.bMax - F.bMin, spanA = F.aMax - F.aMin;
      if (spanB >= spanA * 0.6) {
        const wS = Math.max(0.9, Math.min(6, spanB * 0.05));
        const upSgnB = F.ey.y > 0 ? -1 : 1; // 参照线朝屏幕上方定受光侧（沟的上壁受光）
        for (const vC of [0.05, 0.5, 0.95]) {
          const bb = F.bMin + vC * spanB;
          const at = (aa: number, db = 0): Pt => ({ x: F.p0.x + F.ex.x * aa + F.ey.x * (bb + db), y: F.p0.y + F.ex.y * aa + F.ey.y * (bb + db) });
          regSeam(A, myId, [at(F.aMin + spanA * 0.03), at(F.aMax - spanA * 0.03)], [at(F.aMin + spanA * 0.03, upSgnB * (wS + 1.5)), at(F.aMax - spanA * 0.03, upSgnB * (wS + 1.5))], wS);
        }
        (A.seamedCyl ??= new Set()).add(myId);
      }
    }
    if (kind === 'plate') { reg(myId); regPolyRidges(myId, bp); (A.polyPts ??= new Map()).set(myId, bp); }
    if (bolts) for (const [bx, by] of [[cx - w / 2 + 6, cy - h / 2 + 6], [cx + w / 2 - 6, cy - h / 2 + 6], [cx - w / 2 + 6, cy + h / 2 - 6], [cx + w / 2 - 6, cy + h / 2 - 6]] as const) A.boltPts.push({ x: bx, y: by });
    return myId;
  };
  const addDisc = (kind: Kind, c: Pt, r: number): number => { cv.insts.push({ kind }); const myId = id; fillShape(cv, id, discTest(c, r)); id++; A.discs.push({ id: myId, c, r, hv: 0.5 }); return myId; };
  // 关节盘（模式：外盘 + 毂盘同心叠，毂比缺省 0.58——多足关节/
  // 履带轮/踝双盘此前各写一遍同一构造，现统一在此，站点只给
  // 圆心、半径与毂比）
  const jointDisc = (c: Pt, r: number, hub = 0.58): void => { addDisc('disc', c, r); addDisc('disc', c, r * hub); };
  // 进气口三面盒（正六面体式构造，两样本描线实测）：壳体轮廓 =
  // 正面 + 顶面 + 左侧面；深度 D 上-后向、约最小边 1/10。正面与外
  // 轮廓共用右/下边，顶面 = 上边沿 D 扫出，侧面 = 左（后）边沿 D
  // 扫出。c = [后上, 前上, 前下, 后下]（侧视左 = 后）
  const boxCore = (c0: [Pt, Pt, Pt, Pt], depth?: [number, number], faceTone = 1, tilt = 0, band = false, share?: [number, number]) => {
    // 入参四角 = 装口面本身（站点按面定位/定尺寸）；盒的另两面由
    // 深度向量 D 从面扫出：顶面 = 上边沿 D 扫出、侧面 = 左边沿 D
    // 扫出，三面共顶点、接合边重合（标注定案的构造）。D 在面自己
    // 的框里给分量 [fx, fy]（沿上边向量/左边向量的比例，朝后上）：
    // 凸盒两样本实测——重型 [0.92, 0.70]、荚 [0.51, 0.90]，长度比
    // 均 ≈1.1；浅口（嵌面格栅）用 [0.08, 0.08]（口框带剖面实测）
    const ccx = (c0[0].x + c0[1].x + c0[2].x + c0[3].x) / 4, ccy = (c0[0].y + c0[1].y + c0[2].y + c0[3].y) / 4;
    const csT = Math.cos(tilt), snT = Math.sin(tilt);
    const c = c0.map(q => ({ x: ccx + (q.x - ccx) * csT - (q.y - ccy) * snT, y: ccy + (q.x - ccx) * snT + (q.y - ccy) * csT })) as [Pt, Pt, Pt, Pt];
    const [fTL, fTR, fBR, fBL] = c;
    // D 锁在面自己的框里给分量 [fx, fy]（沿上边/左边向量）：盒是
    // 一个刚体，站点要斜就整体斜——面转多少、深度轴跟着转多少，
    // 不许面转了、深度轴留在世界方向（盒会被拧散）。凸盒标准分
    // 量 = 重型标注实测 [0.92, 0.70]（长度比 1.13）；浅口 [0.08,
    // 0.08]（口框带剖面实测）
    const [fx, fy] = depth ?? [0.08, 0.08];
    const D = { x: -(fx * (fTR.x - fTL.x) + fy * (fBL.x - fTL.x)), y: -(fx * (fTR.y - fTL.y) + fy * (fBL.y - fTL.y)) };
    const TL = { x: fTL.x + D.x, y: fTL.y + D.y }, TR = { x: fTR.x + D.x, y: fTR.y + D.y }, BL = { x: fBL.x + D.x, y: fBL.y + D.y };
    const reg = (id: number, pts: Pt[], face: 'front' | 'top' | 'side' | 'face') => {
      const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
      (A.intakes ??= []).push({ id, cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), face, ftone: face === 'face' ? faceTone : undefined, quad: pts as [Pt, Pt, Pt, Pt], band: face === 'face' ? band : undefined });
    };
    // 构造只做分区：装口面一整块（着色走板件链 + 朝向倍率），口是
    // 面上凹进的开口；顶/侧由 D 扫出。接合亮棱登记给高光棱算子
    const faceId = addPoly([fTL, fTR, fBR, fBL]);
    reg(faceId, [fTL, fTR, fBR, fBL], 'face');
    if (share) {
      // 口占面的比例是独立的量（标注实测：宽 0.91–0.93、高
      // 0.71–0.79，与进深无关）——在装口面的双线性框里按比例内缩
      const mu = (1 - share[0]) / 2, mv = (1 - share[1]) / 2;
      const bilerp = (u: number, v: number) => ({ x: (fTL.x * (1 - u) + fTR.x * u) * (1 - v) + (fBL.x * (1 - u) + fBR.x * u) * v, y: (fTL.y * (1 - u) + fTR.y * u) * (1 - v) + (fBL.y * (1 - u) + fBR.y * u) * v });
      const oTL = bilerp(mu, mv), oTR = bilerp(1 - mu, mv), oBR = bilerp(1 - mu, 1 - mv), oBL = bilerp(mu, 1 - mv);
      reg(addPoly([oTL, oTR, oBR, oBL]), [oTL, oTR, oBR, oBL], 'front');
    }
    const topId = addPoly([TL, TR, fTR, fTL]);
    reg(topId, [TL, TR, fTR, fTL], 'top');
    // 附属件·强调色小标（附属件模式②：盒的其他面挂小标——重型
    // 顶面三枚橙标）：深盒（|D| 超面宽 0.4）才在顶面排三枚短标，
    // 沿上边方向、居深向中段，色走强调色角色
    const dLen = Math.hypot(D.x, D.y), wLen = Math.hypot(fTR.x - fTL.x, fTR.y - fTL.y);
    if (dLen > wLen * 0.4) {
      for (const uu of [0.28, 0.5, 0.72]) {
        const bx = fTL.x + (fTR.x - fTL.x) * uu + D.x * 0.42, by = fTL.y + (fTR.y - fTL.y) * uu + D.y * 0.42;
        const exu = { x: (fTR.x - fTL.x) / wLen, y: (fTR.y - fTL.y) / wLen }, dnu = { x: D.x / dLen, y: D.y / dLen };
        const hl = wLen * 0.055, hw = dLen * 0.07;
        const dp = addPoly([
          { x: bx - exu.x * hl - dnu.x * hw, y: by - exu.y * hl - dnu.y * hw }, { x: bx + exu.x * hl - dnu.x * hw, y: by + exu.y * hl - dnu.y * hw },
          { x: bx + exu.x * hl + dnu.x * hw, y: by + exu.y * hl + dnu.y * hw }, { x: bx - exu.x * hl + dnu.x * hw, y: by - exu.y * hl + dnu.y * hw }]);
        (A.colorRole ??= new Map()).set(dp, 'mark');
      }
    }
    const sideId = addPoly([TL, fTL, fBL, BL]);
    reg(sideId, [TL, fTL, fBL, BL], 'side');
    (A.ridges ??= []).push(
      { inst: topId, pts: [fTL, fTR], tone: 1.3 }, { inst: faceId, pts: [fTL, fTR], tone: 1.18 },
      { inst: sideId, pts: [fTL, fBL], tone: 1.2 }, { inst: faceId, pts: [fTL, fBL], tone: 1.12 });
    return { faceId, topId, sideId, c, reg, botFace: [fBL, fBR] as [Pt, Pt], botSide: [BL, fBL] as [Pt, Pt] };
  };
  // 盒子模式（闭口）：三面构造 + 盒子着色登记、无口——裙盒等
  // 闭口盒调用它；散热盒 = 盒子模式 + 口子模式（intakeBox）
  const box = (c0: [Pt, Pt, Pt, Pt], depth?: [number, number], faceTone = 1, tilt = 0) => {
    const r = boxCore(c0, depth, faceTone, tilt, false);
    return { faceId: r.faceId, sideId: r.sideId, botFace: r.botFace, botSide: r.botSide };
  };
  const intakeBox = (c0: [Pt, Pt, Pt, Pt], depth?: [number, number], faceTone = 1, tilt = 0, share: [number, number] = [0.92, 0.75], band = false) => {
    boxCore(c0, depth, faceTone, tilt, band, share);
  };
  const grille = (cx: number, cy: number, w: number, h: number, depth?: [number, number], faceTone?: number, tilt?: number, share?: [number, number]) => { intakeBox([{ x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 }], depth, faceTone, tilt, share); };
  // 平口：承载面是平面时不起盒（校准的适用边界），只登记口面、
  // 走口的子模式（腔影 + 叶片）
  const flatGrille = (cx: number, cy: number, w: number, h: number) => {
    const pts = [{ x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 }];
    const id = addPoly(pts);
    (A.intakes ??= []).push({ id, cx, cy, w, h, face: 'front', quad: pts as [Pt, Pt, Pt, Pt] });
  };
  const glacis = (cx: number, cy: number, w: number, h: number, slope: number) => { const pts: Pt[] = [{ x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2 - slope, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 + slope * 0.62 }, { x: cx + w / 2, y: cy + h / 2 - 4 }, { x: cx + w / 2 - 5, y: cy + h / 2 }, { x: cx - w / 2 + 5, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 - 4 }]; return addPoly(pts); }; // 斜面箱：前上长斜面切角的箱体
  const portArray = (cx: number, cy: number, w: number, h: number, cols: number, rows: number) => { addBlock('plate', cx, cy, w, h, 0, 0.18); for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const px = cx - w / 2 + (c + 0.5) * (w / cols), py = cy - h / 2 + (r + 0.5) * (h / rows), rr = Math.min(w / cols, h / rows) * 0.3; addDisc('disc', { x: px, y: py }, rr); addDisc('frame', { x: px, y: py }, rr * 0.55); } }; // 管口阵列：底板 + 网格口（金属环+暗口）
  const nozzle = (a: Pt, b: Pt, r0: number, r1: number) => { const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len; addRaw('cyl', (x, y) => { const t = ((x - a.x) * ux + (y - a.y) * uy) / len; if (t < 0 || t > 1) return [false, 0, 0]; const px = a.x + ux * len * t, py = a.y + uy * len * t, d = Math.hypot(x - px, y - py), rr = r0 + (r1 - r0) * t * t; return [d <= rr, t, d / rr]; }); addDisc('frame', b, r1 * 0.58); }; // 钟形喷口：半径沿轴 t² 张开 + 暗口面
  const wing = (cx: number, cy: number, len: number, wRoot: number, wTip: number, ang: number) => { const c = Math.cos(ang), s = Math.sin(ang), loc: Pt[] = [{ x: -len / 2, y: -wRoot / 2 }, { x: len / 2, y: -wTip / 2 }, { x: len / 2 + wTip * 0.7, y: 0 }, { x: len / 2, y: wTip / 2 }, { x: -len / 2, y: wRoot / 2 }]; return addPoly(loc.map((p) => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }))); }; // 翼板：根宽尖细的薄板（厚度走全局边面组）
  const segPlate = (a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap = 2.5, kind: Kind = 'plate', faceW?: number): number => {
    const jit = (rnd() - 0.5) * 6, rot = (rnd() - 0.5) * 0.1, proud = 1.03 + rnd() * 0.09;
    const f0 = segFrame(a, b), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const rp = (p: Pt): Pt => { const dx = p.x - mx, dy = p.y - my; return { x: mx + dx * Math.cos(rot) - dy * Math.sin(rot) + f0.px * jit, y: my + dx * Math.sin(rot) + dy * Math.cos(rot) + f0.py * jit }; };
    const a2 = rp(a), b2 = rp(b), hw = (wA + wB) / 4;
    const cham = () => (rnd() < 0.3 ? rnd() * 5 : (0.2 + rnd() * 0.8) * hw * 0.9);
    const shape: PlateShape = { cTF: cham(), cTB: cham(), cBF: cham(), cBB: cham(), step: rnd() < 0.4 ? (rnd() - 0.5) * 14 : 0, stepPos: 0.3 + rnd() * 0.4 };
    if (kind === 'plate') { cv.insts.push({ kind: 'frame' }); fillShape(cv, id, plateTest(a2, b2, wA * proud * 1.05, wB * proud * 1.05, Math.max(0, t0 - 0.008), Math.min(1, t1 + 0.008), 0, 0, 0, { f: 0, b: 0 }, shape)); id++; }
    cv.insts.push({ kind }); const myId = id;
    fillShape(cv, id, plateTest(a2, b2, wA * proud, wB * proud, t0, t1, gap, 0, 0, { f: 0, b: 0 }, shape)); id++;
    reg(myId);
    // 高光棱模式登记（段板件）：折棱/刻线唇/竖缝唇走模式 pass，
    // 采样与 plateTest 的 (u,v) 场同式（本工具 bulge 恒 0）
    if (kind === 'plate' || kind === 'foot') {
      const fr = segFrame(a2, b2);
      const hwAt = (t: number) => (wA * proud + (wB * proud - wA * proud) * t) / 2;
      const ptAt = (t: number, dd: number): Pt => {
        const local = (t - t0) / (t1 - t0);
        let dC = 0;
        if (shape && shape.step !== 0) { const sp = shape.stepPos; dC = local >= sp ? shape.step : local > sp - 0.05 ? (shape.step * (local - (sp - 0.05))) / 0.05 : 0; }
        return { x: a2.x + fr.ux * t * fr.len + fr.px * (dd + dC), y: a2.y + fr.uy * t * fr.len + fr.py * (dd + dC) };
      };
      const lineAtU = (uu: number, l0: number, l1: number): Pt[] => {
        const pts: Pt[] = [];
        for (let k = 0; k <= 4; k++) { const local = l0 + (l1 - l0) * k / 4, t = t0 + local * (t1 - t0); pts.push(ptAt(t, uu * hwAt(t))); }
        return pts;
      };
      (A.ridgeMode ??= new Set()).add(myId);
      const h2 = (((myId * 40503 + 7) >>> 0) % 100) / 100, h3 = (((myId * 2246822519) >>> 0) % 100) / 100;
      if (h3 >= 0.3) (A.ridges ??= []).push({ inst: myId, pts: lineAtU(0.15 + h2 * 0.5, 0.05, 0.95), tone: 1.15 });
      const dg = A.panelDiag.get(myId) ?? 0;
      for (const lv of A.panelLines.get(myId) ?? []) {
        const tF = t0 + (lv + dg * -1 * 0.45 + 0.017) * (t1 - t0), tB = t0 + (lv + dg * 1 * 0.45 + 0.017) * (t1 - t0);
        (A.ridges ??= []).push({ inst: myId, pts: [ptAt(tF, -hwAt(tF) * 0.97), ptAt(tB, hwAt(tB) * 0.97)], tone: 1.17, panel: true });
      }
      const su = A.seamU.get(myId);
      if (su !== undefined) (A.ridges ??= []).push({ inst: myId, pts: lineAtU(su - 0.034, 0.14, 0.86), tone: 1.15, panel: true });
      // 料厚面（模式库「料厚」）：板下缘登记正式料厚面——长件本
      // 来就不走钻石刻面（用户定），登记后整片走平色面 + 下缘
      // 料厚带，与足/胫的带料厚件同一条路
      if (faceW) {
        const tE = t0 + (t1 - t0) * 0.97;
        regThickness(A, myId, [ptAt(tE, -hwAt(tE) * 0.97), ptAt(tE, hwAt(tE) * 0.97)], 1.0, { faceW, faceDx: -fr.ux, faceDy: -fr.uy, faceTone: 0.95 });
      }
    }
    return myId;
  };
  const addPoly = (pts: Pt[], bolts = false): number => { cv.insts.push({ kind: 'plate' }); const myId = id; fillShape(cv, id, polyTest(pts)); id++; reg(myId); regPolyRidges(myId, pts); (A.polyPts ??= new Map()).set(myId, pts); if (bolts) { const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); const x0 = Math.min(...xs) + 6, x1 = Math.max(...xs) - 6, y0 = Math.min(...ys) + 6, y1 = Math.max(...ys) - 6; for (const [bx, by] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const) A.boltPts.push({ x: bx, y: by }); } return myId; };
  const addRaw = (kind: Kind, test: (x: number, y: number) => [boolean, number, number]): number => { cv.insts.push({ kind }); const myId = id; fillShape(cv, id, test); id++; return myId; };
  const rod = (a: Pt, b: Pt, r: number, bellows?: number): number => {
    // 管道模式：本体调用画圆柱的模式（'cyl' 基色 + 三调剖面）；
    // 变体二选——光管走三道箍、波纹管（bellows = 波纹距 px）走密排波纹沟，同归缝模式
    const id = addRaw('cyl', lineTest(a, b, r));
    if (bellows) regBellows(A, id, a, b, r, bellows); else regCylHoops(A, id, a, b, r);
    return id;
  };
  const finish = () => { for (let i = 0; i < W * H; i++) if (cv.owner[i] >= 0) cv.sil[i] = 1; };
  return { A, addBlock, addDisc, jointDisc, addPoly, addRaw, rod, grille, intakeBox, box, flatGrille, glacis, portArray, nozzle, wing, finish, segPlate };
}

// ---------- armIR：规格 → 锚点 → 部件列（数据） → 通用解释渲染 ----------
type ArmFrame = 'upper' | 'fore' | 'shoulder' | 'wrist';
type ArmPart =
  | { t: 'segCore'; seg: 'upper' | 'fore'; w0: number; w1: number; s0: number; s1: number }
  | { t: 'segPlate'; seg: 'upper' | 'fore'; w0: number; w1: number; s0: number; s1: number; bulge?: number; role?: 'stripe' | 'armor' | 'armor2' | 'accent' | 'mark' }
  | { t: 'disc'; at: 'shoulder' | 'elbow' | 'wrist'; r: number }
  | { t: 'discAt'; frame: ArmFrame; along: number; perp: number; r: number }
  | { t: 'block'; frame: ArmFrame; along: number; perp: number; w: number; h: number; angOff?: number; kind?: Kind; cham?: number; bolts?: boolean; role?: 'stripe' | 'armor' | 'armor2' | 'accent' | 'mark' }
  | { t: 'rod'; seg: 'upper' | 'fore'; perp: number; s0: number; s1: number; r: number }
  | { t: 'rodLink'; fromSeg: 'upper' | 'fore'; fromS: number; fromPerp: number; toSeg: 'upper' | 'fore'; toS: number; toPerp: number; r: number }
  | { t: 'cable'; seg: 'upper' | 'fore'; perp: number; sag: number; r: number }
  | { t: 'insignia'; frame: ArmFrame; along: number; perp: number; kind: number }
  | { t: 'light'; frame: ArmFrame; along: number; perp: number };
interface ArmSpec {
  family: string; scheme: Scheme; seed: number; wear: number; camo: boolean;
  root: Pt; upperLen: number; foreLen: number; upperAng: number; elbowBend: number;
  thickRatio?: number; // 料厚比（着色覆盖，模式库「料厚」）：段板下缘料厚面宽 = 30·bulk·此比
  blockShape?: BlockShapeParams; // 块形（模式库「块形·非四边形」）：块逐角切角分布
  bulk: number; shell: number; hand: 'fist' | 'claw'; twoTone: boolean; diag: number;
  form: { shell: 'box' | 'cap'; elbow: 'disc' | 'ring' | 'small'; fore: 'plates' | 'housing' | 'shell'; fingerLen: number; fingerCurl: number };
  gear: { cable: boolean; piston: boolean; device: boolean; stripe: boolean };
  insignia?: { kind: number; along: number; perp: number }; // 徽章模式：有没有徽章是模式、徽章在哪是它的参数（kind 种类 + 肩框落点 along/perp）
}
interface ArmIR { anchors: Record<'shoulder' | 'elbow' | 'wrist' | 'palm', Pt>; parts: ArmPart[] }
function armIR(spec: ArmSpec): ArmIR {
  const dir = (a: number): Pt => ({ x: Math.sin(a), y: Math.cos(a) });
  const shoulder = spec.root;
  const du = dir(spec.upperAng), df = dir(spec.upperAng + spec.elbowBend);
  const elbow = { x: shoulder.x + du.x * spec.upperLen, y: shoulder.y + du.y * spec.upperLen };
  const wrist = { x: elbow.x + df.x * spec.foreLen, y: elbow.y + df.y * spec.foreLen };
  const palm = { x: wrist.x + df.x * 18, y: wrist.y + df.y * 18 };
  const b = spec.bulk, parts: ArmPart[] = [];
  const plates = (seg: 'upper' | 'fore', len: number, w0: number, w1: number) => {
    const n = Math.max(2, Math.round(len / 68));
    for (let k = 0; k < n; k++) parts.push({ t: 'segPlate', seg, w0: w0 + (w1 - w0) * (k / n), w1: w0 + (w1 - w0) * ((k + 1) / n), s0: 0.04 + (0.93 * k) / n + 0.0015, s1: 0.04 + (0.93 * (k + 1)) / n - 0.0015, role: seg === 'fore' && k === 0 && spec.gear.stripe ? 'stripe' : undefined });
    if (spec.family === 'powersuit' && seg === 'fore') parts.push({ t: 'segPlate', seg, w0: (w0 + (w1 - w0) * 0.88) * 0.97, w1: w1 * 0.97, s0: 0.9, s1: 0.985, role: 'armor2' }); // 橙只作腕端带（略窄于基板，免四角戳出）
    if (spec.family === 'powersuit' && seg === 'upper') parts.push({ t: 'segPlate', seg, w0, w1: w0 + (w1 - w0) * 0.12, s0: 0.015, s1: 0.14, role: 'armor2' }); // 肩下橙带
  };
  for (const [seg, w0, w1] of [['upper', 30, 26], ['fore', 26, 20]] as const)
    for (let k = 0; k < 3; k++) parts.push({ t: 'segCore', seg, w0: (w0 + (w1 - w0) * (k / 3)) * b, w1: (w0 + (w1 - w0) * ((k + 1) / 3)) * b, s0: k / 3 + 0.01, s1: (k + 1) / 3 - 0.01 });
  // 模式「关节内构衬底」在臂上的执行：三处关节的段端各加一圈加宽
  // 核领——盘嵌在暗内构里、背面不露背景（此前肘盘只靠细核吊着、
  // 两侧透光，用户指「关节背面没有衬内构」）。核领随各自段走，
  // 弯肘时前臂领探进上臂后楔、把凹口垫住；画在板与盘之前，只在
  // 板端缺口里露出
  parts.push({ t: 'segCore', seg: 'upper', w0: 42 * b, w1: 40 * b, s0: -0.02, s1: 0.09 }); // 肩领
  parts.push({ t: 'segCore', seg: 'upper', w0: 40 * b, w1: 44 * b, s0: 0.9, s1: 1.0 }); // 肘领（上臂侧）
  parts.push({ t: 'segCore', seg: 'fore', w0: 44 * b, w1: 40 * b, s0: -0.03, s1: 0.09 }); // 肘领（前臂侧）
  parts.push({ t: 'segCore', seg: 'fore', w0: 38 * b, w1: 36 * b, s0: 0.93, s1: 1.0 }); // 腕领
  parts.push({ t: 'block', frame: 'shoulder', along: -3, perp: 2, w: 44 * b, h: 26 * b, angOff: 0.15, kind: 'frame' });
  parts.push({ t: 'block', frame: 'shoulder', along: 2, perp: 27 * b, w: 14 * b, h: 22 * b, kind: 'frame' }, { t: 'block', frame: 'shoulder', along: 2, perp: -27 * b, w: 14 * b, h: 22 * b, kind: 'frame' });
  parts.push({ t: 'disc', at: 'shoulder', r: (spec.family === 'olive' ? 19 : 15) * b }, { t: 'disc', at: 'shoulder', r: (spec.family === 'olive' ? 11 : 8.5) * b });
  plates('upper', spec.upperLen, 56 * b, 50 * b);
  if (spec.gear.cable) parts.push({ t: 'cable', seg: 'upper', perp: 30 * b, sag: 30, r: 6.5 }); // 外环粗缆（olive/cyber 式大垂环）
  if (spec.gear.piston) { // 短栈贴关节（cyber 式）：套筒+铬杆只跨肘口，前臂内一节短栈，环节点缀盘
    parts.push({ t: 'rodLink', fromSeg: 'upper', fromS: 0.84, fromPerp: 24 * b, toSeg: 'fore', toS: 0.16, toPerp: 22 * b, r: 4.5 });
    parts.push({ t: 'rodLink', fromSeg: 'upper', fromS: 0.9, fromPerp: 24 * b, toSeg: 'fore', toS: 0.26, toPerp: 22 * b, r: 2.4 });
    parts.push({ t: 'rod', seg: 'fore', perp: 24 * b, s0: 0.05, s1: 0.24, r: 4 });
    parts.push({ t: 'rod', seg: 'fore', perp: 24 * b, s0: 0.24, s1: 0.36, r: 2.2 });
    parts.push({ t: 'discAt', frame: 'fore', along: spec.foreLen * 0.05, perp: 24 * b, r: 5 });
    parts.push({ t: 'discAt', frame: 'fore', along: spec.foreLen * 0.24, perp: 24 * b, r: 4.5 });
  }
  if (spec.gear.cable) parts.push({ t: 'cable', seg: 'fore', perp: 29 * b, sag: 20, r: 6 });
  if (spec.form.elbow === 'ring') { parts.push({ t: 'block', frame: 'fore', along: 0, perp: 0, w: 23 * b, h: 23 * b, kind: 'frame' }); parts.push({ t: 'disc', at: 'elbow', r: 15.5 * b }); parts.push({ t: 'disc', at: 'elbow', r: 9 * b }); }
  else if (spec.form.elbow === 'small') { parts.push({ t: 'disc', at: 'elbow', r: 8.5 * b }); parts.push({ t: 'block', frame: 'fore', along: -4, perp: 0, w: 30 * b, h: 24 * b, kind: 'plate', cham: 0.5 }); }
  else parts.push({ t: 'disc', at: 'elbow', r: 15.5 * b }, { t: 'disc', at: 'elbow', r: 9 * b }); // 肘盘外露（与膝/踝同语言：深色圆盘读得出半径，旧 12.5 埋在核领里读不出）
  parts.push({ t: 'block', frame: 'fore', along: 0, perp: 19 * b, w: 15 * b, h: 24 * b, kind: 'frame' }, { t: 'block', frame: 'fore', along: 0, perp: -19 * b, w: 15 * b, h: 24 * b, kind: 'frame' });
  if (spec.form.fore === 'housing') {
    parts.push({ t: 'segPlate', seg: 'fore', w0: 56 * b, w1: 46 * b, s0: 0.03, s1: 0.97, bulge: 0.12, role: spec.gear.stripe ? 'stripe' : undefined }); // 整壳：近平直侧（长板大 bulge 会鼓成两头尖的棺材形）
  } else plates('fore', spec.foreLen, 58 * b, 43 * b);
  if (spec.gear.device) { parts.push({ t: 'block', frame: 'fore', along: spec.foreLen * 0.45, perp: -26 * b, w: 20, h: 26, kind: 'frame' }); parts.push({ t: 'block', frame: 'fore', along: spec.foreLen * 0.45, perp: -27 * b, w: 13, h: 18, kind: 'plate' }); parts.push({ t: 'light', frame: 'fore', along: spec.foreLen * 0.45, perp: -30 * b }); }
  // 前臂顺轴带：走前缘细条（参考的色带贴边走，不在正面中央——
  // 中央带读作赛纹、整板读作色块，都已否）
  if (spec.family === 'powersuit') parts.push({ t: 'block', frame: 'fore', along: spec.foreLen * 0.52, perp: -20 * b, w: 5.5 * b, h: spec.foreLen * 0.62, cham: 0.3, role: 'accent' });
  if (spec.family === 'agile') parts.push({ t: 'block', frame: 'fore', along: spec.foreLen * 0.5, perp: -19 * b, w: 5 * b, h: spec.foreLen * 0.8, cham: 0.3, role: 'accent' });
  // 腕环带：前臂末端一圈略宽的独立带段（7 样本 6 成立）
  parts.push({ t: 'segPlate', seg: 'fore', w0: (spec.form.fore === 'housing' ? 47.5 : 44.5) * b, w1: (spec.form.fore === 'housing' ? 47.5 : 44.5) * b, s0: 0.925, s1: 0.995 });
  // 暗腕层：环带与掌之间的暗色短段（7 样本 6 成立）
  parts.push({ t: 'block', frame: 'wrist', along: 5, perp: 0, w: 32 * b, h: 13, kind: 'frame' });
  parts.push({ t: 'disc', at: 'wrist', r: 8.5 * b }, { t: 'disc', at: 'wrist', r: 4.5 * b });
  parts.push({ t: 'block', frame: 'wrist', along: 16, perp: 0, w: 44 * b, h: 30 * b, kind: 'plate', bolts: true });
  parts.push({ t: 'block', frame: 'wrist', along: 13, perp: 3, w: 30 * b, h: 20 * b, kind: 'plate' }); // 掌背板
  if (spec.hand === 'fist') {
    // 指链（按 cyber/agile 参考抽取：四指位侧面取三列、每指三段渐细、关节盘、逐节累进卷曲；拇指自掌前下角出、两段前指）
    const fr = segFrame(elbow, wrist), foreAng = Math.atan2(fr.uy, fr.ux);
    const fw = 9.5 + 4 * b, L = spec.form.fingerLen, curl = spec.form.fingerCurl;
    const toFrame = (c: Pt) => ({ along: (c.x - wrist.x) * fr.ux + (c.y - wrist.y) * fr.uy, perp: (c.x - wrist.x) * fr.px + (c.y - wrist.y) * fr.py });
    parts.push({ t: 'block', frame: 'wrist', along: 29, perp: 0, w: 38 * b, h: 7, kind: 'frame' }); // 指节梁
    parts.push({ t: 'block', frame: 'wrist', along: 24, perp: -10, w: 25 * b, h: 20, angOff: -0.35, kind: 'plate' }); // 鱼际丘：与掌体、指根三方交叠
    for (let idx = 0; idx < 3; idx++) { // 指根成弧（中指最前最长）、根部相接、张开靠扇角不靠根缝
      const baseAlong = [28.5, 31, 28.5][idx], lenMul = [0.92, 1, 0.86][idx];
      let pos = { x: wrist.x + fr.ux * baseAlong + fr.px * (idx - 1) * fw * 0.92, y: wrist.y + fr.uy * baseAlong + fr.py * (idx - 1) * fw * 0.92 };
      const fan = (idx - 1) * 0.025;
      for (let k = 0; k < 3; k++) {
        const lk = L * lenMul * [0.42, 0.33, 0.25][k], wk = fw * [1, 1.02, 0.94][idx] * [1, 0.84, 0.68][k];
        const a = foreAng + fan - curl * k;
        const cen = { x: pos.x + Math.cos(a) * (lk / 2), y: pos.y + Math.sin(a) * (lk / 2) };
        const cf = toFrame(cen), pf = toFrame(pos);
        parts.push({ t: 'discAt', frame: 'wrist', along: pf.along, perp: pf.perp, r: wk * 0.34 });
        parts.push({ t: 'block', frame: 'wrist', along: cf.along, perp: cf.perp, w: wk, h: lk + 2.5, angOff: a - foreAng, kind: 'plate', cham: 0.3 });
        pos = { x: pos.x + Math.cos(a) * lk, y: pos.y + Math.sin(a) * lk };
      }
    }
    { // 拇指：根植鱼际丘内，两段前指、卷向与四指同向
      let pos = { x: wrist.x + fr.ux * 23 + fr.px * -9.5, y: wrist.y + fr.uy * 23 + fr.py * -9.5 };
      for (let k = 0; k < 2; k++) {
        const lk = [14.5, 12][k] * (0.7 + 0.3 * b), wk = [12, 10.5][k] * (0.7 + 0.3 * b);
        const a = foreAng - 0.38 - 0.32 * k;
        const cen = { x: pos.x + Math.cos(a) * (lk / 2), y: pos.y + Math.sin(a) * (lk / 2) };
        const cf = toFrame(cen), pf = toFrame(pos);
        parts.push({ t: 'discAt', frame: 'wrist', along: pf.along, perp: pf.perp, r: wk * 0.62 });
        parts.push({ t: 'block', frame: 'wrist', along: cf.along, perp: cf.perp, w: wk, h: lk + 2, angOff: a - foreAng, kind: 'plate', cham: 0.3 });
        pos = { x: pos.x + Math.cos(a) * lk, y: pos.y + Math.sin(a) * lk };
      }
    }
  }
  else { parts.push({ t: 'block', frame: 'wrist', along: 34, perp: -12, w: 10, h: 22, angOff: 0.3, kind: 'plate' }); parts.push({ t: 'block', frame: 'wrist', along: 34, perp: 12, w: 10, h: 22, angOff: -0.3, kind: 'plate' }); }
  const sh = spec.shell;
  if (spec.form.shell === 'cap') {
    parts.push({ t: 'block', frame: 'shoulder', along: -4, perp: 0, w: 82 * sh, h: 64 * sh, angOff: -0.04, kind: 'plate', cham: 0.62, bolts: true, ...(spec.family === 'agile' ? { role: 'armor' as const } : {}) }); // 敏捷肩甲是白甲（参考指定，不许轮换到蓝）
    parts.push({ t: 'block', frame: 'shoulder', along: -38, perp: 0, w: 68 * sh, h: 20 * sh, angOff: -0.03, kind: 'plate', cham: 0.5 });
    parts.push({ t: 'block', frame: 'shoulder', along: 17, perp: 0, w: 56 * sh, h: 30 * sh, angOff: 0.02, kind: 'plate', cham: 0.4 }); // 下挂子板：自肩钟下缘垂下，压住上臂首板
    if (spec.family === 'agile') { // 肩甲面凹窗（敏捷参考面上的方形凹窗：亮沿 + 暗凹芯）
      parts.push({ t: 'block', frame: 'shoulder', along: -6, perp: -3, w: 23 * sh, h: 19 * sh, kind: 'plate' });
      parts.push({ t: 'block', frame: 'shoulder', along: -6, perp: -3, w: 14 * sh, h: 10 * sh, kind: 'frame' });
    } else if (spec.family === 'powersuit') { // 肩甲面散热槽（动力服参考面上的横槽列）
      for (const dy of [-11, 0, 11]) parts.push({ t: 'block', frame: 'shoulder', along: -2, perp: dy * sh, w: 24 * sh, h: 4.5 * sh, kind: 'frame' });
    }
  } else {
    parts.push({ t: 'block', frame: 'shoulder', along: -8, perp: 0, w: 104 * sh, h: 62 * sh, angOff: -0.05, kind: 'plate', bolts: true });
    parts.push({ t: 'block', frame: 'shoulder', along: -36, perp: 0, w: 84 * sh, h: 22 * sh, angOff: -0.03, kind: 'plate' });
    parts.push({ t: 'block', frame: 'shoulder', along: 6, perp: -42 * sh, w: 28 * sh, h: 44 * sh, angOff: 0.12, kind: 'plate' });
  }
  if (spec.insignia) parts.push({ t: 'insignia', frame: 'shoulder', along: spec.insignia.along, perp: spec.insignia.perp, kind: spec.insignia.kind });
  return { anchors: { shoulder, elbow, wrist, palm }, parts };
}
function renderArmIR(cv: MechaCanvas, ir: ArmIR, spec: ArmSpec): Anchors {
  const T = makeLayerTools(cv, spec.seed, spec.blockShape);
  const { A } = T;
  const A0 = ir.anchors;
  const segOf = (seg: 'upper' | 'fore') => seg === 'upper' ? { a: A0.shoulder, b: A0.elbow } : { a: A0.elbow, b: A0.wrist };
  const frameOf = (f: ArmFrame) => f === 'upper' || f === 'shoulder' ? { o: A0.shoulder, a: A0.shoulder, b: A0.elbow } : f === 'fore' ? { o: A0.elbow, a: A0.elbow, b: A0.wrist } : { o: A0.wrist, a: A0.elbow, b: A0.wrist };
  const fp = (f: ArmFrame, along: number, perp: number): Pt => { const { o, a, b } = frameOf(f); const fr = segFrame(a, b); return { x: o.x + fr.ux * along + fr.px * perp, y: o.y + fr.uy * along + fr.py * perp }; };
  const fang = (f: ArmFrame) => { const { a, b } = frameOf(f); const fr = segFrame(a, b); return Math.atan2(fr.uy, fr.ux) - Math.PI / 2; };
  for (const p of ir.parts) {
    if (p.t === 'segCore') { const { a, b } = segOf(p.seg); T.segPlate(a, b, p.w0, p.w1, p.s0, p.s1, 0, 'frame'); }
    else if (p.t === 'segPlate') { const { a, b } = segOf(p.seg); const id = T.segPlate(a, b, p.w0, p.w1, p.s0, p.s1, p.bulge ?? 0.5, 'plate', Math.max(3, Math.round(30 * spec.bulk * (spec.thickRatio ?? 0.32)))); if (p.role === 'stripe') A.stripeThigh = id; else if (p.role) (A.colorRole ??= new Map()).set(id, p.role); }
    else if (p.t === 'disc') T.addDisc('disc', A0[p.at], p.r);
    else if (p.t === 'discAt') { const c = fp(p.frame, p.along, p.perp); T.addDisc('disc', c, p.r); }
    else if (p.t === 'block') { const c = fp(p.frame, p.along, p.perp); const id = T.addBlock(p.kind ?? 'plate', c.x, c.y, p.w, p.h, fang(p.frame) + (p.angOff ?? 0), p.cham ?? 0.36, p.bolts ?? false); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); }
    else if (p.t === 'rod') { const { a, b } = segOf(p.seg); const fr = segFrame(a, b); const q = (s: number): Pt => ({ x: a.x + fr.ux * fr.len * s + fr.px * p.perp, y: a.y + fr.uy * fr.len * s + fr.py * p.perp }); T.addRaw('rod', lineTest(q(p.s0), q(p.s1), p.r)); }
    else if (p.t === 'rodLink') {
      const q = (seg: 'upper' | 'fore', s: number, perp: number): Pt => { const { a, b } = segOf(seg); const fr = segFrame(a, b); return { x: a.x + fr.ux * fr.len * s + fr.px * perp, y: a.y + fr.uy * fr.len * s + fr.py * perp }; };
      T.addRaw('rod', lineTest(q(p.fromSeg, p.fromS, p.fromPerp), q(p.toSeg, p.toS, p.toPerp), p.r));
    }
    else if (p.t === 'cable') {
      const { a, b } = segOf(p.seg); const fr = segFrame(a, b);
      const q = (s: number, d: number): Pt => ({ x: a.x + fr.ux * fr.len * s + fr.px * d, y: a.y + fr.uy * fr.len * s + fr.py * d });
      const p0 = q(0.02, p.perp), p2 = q(0.98, p.perp), p1 = q(0.5, p.perp + p.sag);
      const pts: Pt[] = [];
      for (let k = 0; k <= 40; k++) { const t = k / 40, u = 1 - t; pts.push({ x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y }); }
      T.addRaw('cable', (x, y) => { let m = 1e9; for (const q2 of pts) m = Math.min(m, Math.hypot(x - q2.x, y - q2.y)); return [m <= p.r, 0, m / p.r]; });
      T.addDisc('cyl', p0, p.r + 1); T.addDisc('cyl', p2, p.r + 1);
    }
    else if (p.t === 'insignia') A.insignia = { pos: fp(p.frame, p.along, p.perp), kind: p.kind };
    else if (p.t === 'light') A.lightPts.push(fp(p.frame, p.along, p.perp));
  }
  T.finish();
  { let k = 0; for (const id of [...A.panelDiag.keys()]) { if ((k++ * spec.diag) % 1 >= spec.diag && spec.diag < 1) A.panelDiag.delete(id); } }
  return A;
}

// ---------- torsoIR：规格 → 锚点 → 部件列 → 通用解释（三段式：胸/窄腰/胯 + 背挂槽） ----------
type TorsoPart =
  | { t: 'block'; dx: number; dy: number; w: number; h: number; ang?: number; kind?: Kind; cham?: number; bolts?: boolean; faceW?: number; tint?: number; role?: 'stripe' | 'armor2' | 'accent' | 'mark' ; net?: 'ashlar'; netAlt?: number }
  | { t: 'poly'; pts: [number, number][]; bolts?: boolean; faceW?: number; faceEdge?: [number, number]; faceEdges?: ([number, number] | [number, number, number])[]; faceTone?: number; seamless?: boolean; facet?: boolean; edgeLines?: [number, number][]; seamLines?: [number, number, number, number][]; tint?: number; role?: 'armor2' | 'accent' ; net?: 'fan' | 'ashlar'; netAlt?: number }
  | { t: 'pipe'; ax: number; ay: number; bx: number; by: number; r: number; bellows?: number }
  | { t: 'disc'; dx: number; dy: number; r: number; kind?: Kind }
  | { t: 'grille'; dx: number; dy: number; w: number; h: number; face?: [number, number, number, number]; keelUp?: [number, number, number, number]; seat?: [number, number, number, number]; bt?: [number, number]; fw?: [number, number][]; depth?: [number, number]; tilt?: number }
  | { t: 'box'; face: [number, number][]; depth: [number, number]; tone?: number; thickW?: number; stripes?: boolean }
  | { t: 'light'; dx: number; dy: number }
  | { t: 'insignia'; dx: number; dy: number; kind: number }
  | { t: 'number'; dx: number; dy: number; text: string };
/** 躯干构造模式参数（四样本标注提取、模式库条目同值钉版）：
 * 前缘折点 = 前缘在 foldY 高度探到 fold、顶前 top、底收 base
 * （均为胸宽/胸高的比值）；主横分在 divY。四式各有自己的定版
 * 参数（FORM_PROFILES），条目/向导/蓝图经 profile 覆盖改它 */
export interface TorsoProfile { top: number; fold: number; foldY: number; base: number; divY: number }
export const FORM_PROFILES: Record<TorsoSpec['form']['chest'], TorsoProfile> = {
  stack: { top: 0.30, fold: 0.50, foldY: 0.55, base: 0.42, divY: 0.435 },
  shell: { top: 0.40, fold: 0.63, foldY: 0.55, base: 0.44, divY: 0.55 },
  glacis: { top: 0.30, fold: 0.64, foldY: 0.72, base: 0.52, divY: 0.44 },
  slab: { top: 0.52, fold: 0.56, foldY: 0.55, base: 0.46, divY: 0.52 },
};
export function torsoProfileOf(spec: TorsoSpec): TorsoProfile {
  const base = { ...FORM_PROFILES[spec.form.chest], ...(spec.profile ?? {}) };
  // 斜面胸坡度 ≈45°（用户定案）：用户未显式给折点时，折点
  // 由坡面高差等距前伸导出（fold = top + (foldY−0.08)·CH/W，
  // 各族宽高比不同折点随之变、躯干随之前伸变宽，坡面下段
  // 的散热口与后上的肩盘自然分开）；显式覆写优先——向导的
  // 折点控件是真控件，改了就按改的走
  if (spec.form.chest === 'glacis' && spec.profile?.fold === undefined)
    base.fold = base.top + (base.foldY - 0.08) * (spec.chestH / spec.chestW);
  return base;
}
interface TorsoSpec {
  /** 块形（模式库「块形·非四边形」）：块逐角切角分布 */ blockShape?: BlockShapeParams;
  /** 双色交替开关（基色 pass 按序号奇偶交替 armor/armor2）：敏捷躯干关——其蓝色按面指定（colorRole），不按序号 */
  altTone?: boolean;
  /** 进气口三面盒深度 [横, 纵]（模式库 mpat-intake 条目持有标准值） */ intakeDepth?: [number, number];
  /** 凸盒深度向量分量 [沿上边, 沿左边]（三面盒：重型标注实测 [0.92, 0.70]；壳体是凸盒、与格栅浅口深分开） */ boxDepth?: [number, number];
  /** 进气口口占装口面份额 [宽, 高]（同上） */ intakeShare?: [number, number];
  /** 盒姿态（mpat-intake 参数）：'keel' = 两族平行由承载体龙骨棱解出（口前缘∥龙骨前缘、深度向∥龙骨上缘）；缺省 'flat' = 固定框斜 */
  intakeOrient?: 'keel' | 'flat';
  /** 附属件（模式：口从来不单独出现——横槽组+方灯随口同行）；缺省画 */
  intakeTrim?: boolean;
  /** 龙骨突（模式组合 mpat-keelvent）：自散热口盒角生长的前板、由它造下段剪影；缺省画，关时下段前界回 fold→base 直线、无龙骨板 */
  keelPlate?: boolean;
  /** 龙骨突前伸量（W 的分数，组合条目标准值 0.32） */
  keelReach?: number;
  /** 徽章模式的落点（[W 分数, CH 分数]）：徽章在哪是模式的参数、由用户定（向导徽记横/纵），缺省 [0.16, 0.26] */
  insigniaPos?: [number, number];
  /** 颈部斜撑+管道（用户定：头颈结合部靠斜撑杆件与管道充实，不是环）：斜撑横过颈后间隙、管道沿颈后下行接背部；缺省关，动力服工厂钉开 */
  neckStruts?: boolean;
  /** 前楔并体（同组合）：盒左侧面与楔拱前楔并成同一个表面（消缝）；缺省并，关时前楔自画、盒左侧面自画（接缝回来） */
  ventFuse?: boolean;
  family: string; scheme: Scheme; seed: number; wear: number; camo: boolean; twoTone: boolean;
  neck: Pt; chestW: number; chestH: number; waistH: number; pelvisH: number;
  profile?: Partial<TorsoProfile>;
  form: { chest: 'stack' | 'shell' | 'slab' | 'glacis'; back: 'box' | 'binder' | 'rack' | 'none'; grille: 'side' | 'front' | 'none'; skirt: 'front' | 'both' | 'none' };
  gear: { stripe: boolean; insignia: number; number: string };
}
interface TorsoIR { anchors: Record<'neck' | 'shoulder' | 'hip' | 'chestC', Pt>; parts: TorsoPart[] }
function torsoIR(spec: TorsoSpec): TorsoIR {
  const W = spec.chestW, CH = spec.chestH, WH = spec.waistH, PH = spec.pelvisH, F = spec.form, P = torsoProfileOf(spec), parts: TorsoPart[] = [];
  const waistY = CH + WH / 2, pelvisY = CH + WH + PH / 2;
  // 背挂（先画，居后）
  if (F.back === 'box') { parts.push({ t: 'block', dx: -W * 0.52, dy: CH * 0.4, w: W * 0.34, h: CH * 0.78, faceW: 6 }); parts.push({ t: 'grille', dx: -W * 0.52, dy: CH * 0.34, w: W * 0.26, h: CH * 0.4 }); parts.push({ t: 'block', dx: -W * 0.5, dy: CH * 0.86, w: W * 0.3, h: CH * 0.2 }); }
  else if (F.back === 'binder') { // 背板分段不靠构造切片：整板调用异形楔模式的无中心变体
    // （net: 'ashlar'，netAlt: 1 = 中层走第二色调），分段由模式在板面上绘制
    parts.push({ t: 'block', dx: -W * 0.55, dy: CH * 0.75, w: W * 0.42, h: CH * 1.5, ang: 0.22, cham: 0.5, net: 'ashlar', netAlt: 1 });
    parts.push({ t: 'block', dx: -W * 0.7, dy: CH * 0.85, w: W * 0.3, h: CH * 1.3, ang: 0.22, cham: 0.5, net: 'ashlar', netAlt: 1 });
    parts.push({ t: 'block', dx: -W * 0.72, dy: CH * 1.42, w: W * 0.2, h: CH * 0.34, ang: 0.22, kind: 'frame' }); parts.push({ t: 'block', dx: -W * 0.55, dy: CH * 0.16, w: W * 0.28, h: CH * 0.045, ang: 0.22, kind: 'frame' }); }
  else if (F.back === 'rack') { parts.push({ t: 'block', dx: -W * 0.5, dy: CH * 0.3, w: W * 0.22, h: CH * 0.62, kind: 'cyl' }); parts.push({ t: 'block', dx: -W * 0.52, dy: CH * 0.72, w: W * 0.24, h: CH * 0.4, kind: 'frame' }); }
  // 颈部斜撑+管道（用户定）：一根斜撑横过颈后间隙、两根管道沿
  // 颈后下行接背部。先画居后：顶端藏在头下、底端被胸/背压住，
  // 只在结合部的空当里露出杆件与管道
  if (spec.neckStruts) {
    parts.push({ t: 'pipe', ax: -W * 0.30, ay: -CH * 0.03, bx: -W * 0.14, by: CH * 0.25, r: CH * 0.05, bellows: 8 });
    parts.push({ t: 'pipe', ax: -W * 0.15, ay: -CH * 0.03, bx: -W * 0.03, by: CH * 0.23, r: CH * 0.036 });
    parts.push({ t: 'block', dx: -W * 0.02, dy: CH * 0.13, w: W * 0.52, h: CH * 0.075, ang: 0.40, kind: 'frame' });
  }
  // 腰内构先画（居后）：模式「腰独立成段」（4 样本标注提取）——
  // 胸底与胯顶不直接相接，中间隔一段内收的腰（高约占躯干
  // 15%），前缘比胸最前点靠后约 0.3W；横贯管线压腰中段、腰侧
  // 关节盘外露（盘已在下面一行）。胸/胯都不再伸进腰段
  parts.push({ t: 'block', dx: -W * 0.11, dy: waistY, w: W * 0.72, h: WH * 1.6, kind: 'frame' });
  if (spec.family === 'agile') {
    // 敏捷腰（腰段差别模式：实心色块 vs 内构＋覆片——四参考的
    // 腰都是暗色内构打底、上面覆分段装甲片；敏捷是斜蓝带压在
    // 暗关节上）：不再整段盖住暗框，改两片覆片——主片是斜带
    // （上边自左高向右低斜下），副片在下方错开，片间与两端都
    // 露暗框，横管从片间隙里过，左侧关节盘露在暗底上
    const wy = waistY, hh = WH * 0.78;
    parts.push({ t: 'poly', pts: [[-W * 0.30, wy - hh * 0.88], [W * 0.20, wy - hh * 0.52], [W * 0.24, wy + hh * 0.12], [-W * 0.26, wy - hh * 0.14]], role: 'armor2', tint: 0.95, seamless: true, faceW: 7, faceTone: 0.88, faceEdges: [[3, 2]] }); // 主片·斜带
    parts.push({ t: 'poly', pts: [[-W * 0.22, wy + hh * 0.32], [W * 0.15, wy + hh * 0.5], [W * 0.12, wy + hh * 1.08], [-W * 0.18, wy + hh * 0.92]], role: 'armor2', tint: 0.9, seamless: true, faceW: 7, faceTone: 0.88, faceEdges: [[3, 2]] }); // 副片·下段
  } else if (spec.family === 'powersuit') {
    // 动力服的腰是浅色肋环腹段（白-橙-白叠环），不是黑桶：三条环
    // 盖住暗框，环间露出的暗缝就是肋距。环列在胯段前才入列（见下）：
    // 胸的投影按序号落影，环若排在胸之前，整条顶环会被胸影吞成灰
    // 蓝——参考里肋环是受光的，只有上缘一条接触暗线
  }
  if (spec.family === 'agile') parts.push({ t: 'block', dx: -W * 0.02, dy: waistY, w: W * 0.66, h: 7, kind: 'cyl' });
  else if (spec.family !== 'powersuit') {
    // 橄榄腰：缆线束（重型/主战参考的腰是成束缆线，不是单根
    // 粗筒）——三根细管错落成束、管间露暗底
    for (const [dy2, ww] of [[-WH * 0.36, 0.72], [0, 0.78], [WH * 0.36, 0.7]] as const)
      parts.push({ t: 'block', dx: -W * 0.02, dy: waistY + dy2, w: W * ww, h: 5, kind: 'cyl' });
  }
  // 腰盘衬底（与肩盘座圈同理）：盘缘与腰框/侧板的三岔口在躯
  // 干高比例拉长时可开 1px 针孔（敏捷 torsoH 1.26 实测 4px），
  // 暗衬盘垫在盘后、只在缺口露暗色
  parts.push({ t: 'disc', dx: -W * 0.32, dy: waistY + (spec.family === 'agile' ? WH * 0.35 : 0), r: WH * (spec.family === 'powersuit' ? 0.3 : 0.42) * 1.18, kind: 'frame' });
  parts.push({ t: 'disc', dx: -W * 0.32, dy: waistY + (spec.family === 'agile' ? WH * 0.35 : 0), r: WH * (spec.family === 'powersuit' ? 0.3 : 0.42), kind: 'disc' });
  // 躯干衬底（关节内构衬底的躯干版，垫底先画、只在缺口露暗色）：
  // 肩盘座圈——楔拱内缘按 (W, CH) 分开缩放是椭圆、肩盘是圆，
  // 盘左右各剩约 2px 环隙（橄榄实测 4px 洞），座圈垫在盘后；
  // 胸后下角垫块——壳带后下角与背板/腰框交界的针孔（敏捷 9px）
  parts.push({ t: 'disc', dx: -W * 0.2, dy: CH * 0.47, r: W * 0.152, kind: 'frame' });
  parts.push({ t: 'block', dx: -W * 0.42, dy: CH * 0.97, w: W * 0.24, h: CH * 0.36, kind: 'frame' });
  // 领圈 + 胸
  parts.push({ t: 'block', dx: 0, dy: 2, w: W * 0.52, h: 16, kind: 'frame' });
  // 胸型四式（2026-11-07 按四样本标注提取重定）：共同骨架是
  // 模式「前缘折点」——前缘向前下行、到约 0.5 胸高到达最前点、
  // 再向后下行收回腰部（点/竖面/凸弧是变体）；模式「胸内主横
  // 分」——约 0.5 胸高一条主分界。四式只在板数与面的作法上
  // 分家。此前四式的最前点落在底边（下摆外张）、且主板下延
  // 1.06CH 盖住腰段，与标注全不合，已废。
  // 龙骨突（次序定案：剪影是龙骨突造出来的）：先按与渲染同一
  // 式算出散热口盒的实际四边形（原 faceSeg 面线＋框斜 0.15 绕质心），
  // 龙骨突从盒的角点生长——上缘自盒右上角沿盒上缘方向出到最
  // 前点 K1、前缘自 K1 沿盒前缘方向下行到底边 K2；胸前剪影
  // 由 K1/K2 生成（下段多边形前界走 fold→K1→K2），不再拿旧
  // fold→base 直线当剪影。seg＝原 faceSeg（归一化），
  // bottomYn＝下段底边高
  const keelFromVent = (seg: [number, number, number, number], bottomYn: number) => {
    const [sx, sy, ex, ey] = seg;
    const ix0 = sx * W, ix1 = ex * W, y0 = sy * CH, y1 = ey * CH;
    const fxAt = (y: number) => ix0 + (ix1 - ix0) * ((y - y0) / (y1 - y0));
    const vw = W * 0.3, yT = CH * 0.63, yB = CH * 0.87; // 侧栅 dy 0.75CH、h 0.24CH、w 0.3W（与格栅 push 同值）
    const quad: [number, number][] = [[fxAt(yT) - vw, yT], [fxAt(yT), yT], [fxAt(yB), yB], [fxAt(yB) - vw, yB]];
    const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4, cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
    const ct = Math.cos(0.15), st = Math.sin(0.15); // 侧栅框斜（renderTorsoIR grilleTilt 同值）
    const rc = quad.map(([x, y]): [number, number] => [cx + (x - cx) * ct - (y - cy) * st, cy + (x - cx) * st + (y - cy) * ct]);
    const sub = (a: [number, number], b: [number, number]): [number, number] => [a[0] - b[0], a[1] - b[1]];
    const unit = (a: [number, number]): [number, number] => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
    const u = unit(sub(rc[1], rc[0])), v = unit(sub(rc[2], rc[1])); // 盒上缘向 / 盒前缘向
    const reach = spec.keelReach ?? 0.32; // 前伸量（mpat-keelvent 参数，缺省即条目标准值）
    const K1: [number, number] = [rc[1][0] + u[0] * W * reach, rc[1][1] + u[1] * W * reach]; // 最前点（上缘长 reach·W）
    const bY = CH * bottomYn;
    const K2: [number, number] = [K1[0] + v[0] * ((bY - K1[1]) / v[1]), bY];
    const L2: [number, number] = [rc[2][0] + v[0] * ((bY - rc[2][1]) / v[1]), bY];
    return { plate: [rc[1], K1, K2, L2, rc[2]] as [number, number][], K1, K2 };
  };
  if (F.chest === 'stack') {
    // 叠层胸（对橄榄主战）：上板（带徽章）+ 中板 + 斜主板三层，
    // 前缘逐层出台阶（0.30/0.46/0.64W），板间薄缝带是叠压影
    // 不是黑沟；主板前脸是斜面多边形、下延到 1.06CH 压腰
    parts.push({ t: 'block', dx: W * (P.top - 0.4), dy: CH * 0.2, w: W * 0.8, h: CH * 0.36, cham: 0.26, bolts: true, faceW: 7 });
    parts.push({ t: 'block', dx: W * (P.fold - 0.49), dy: CH * P.divY, w: W * 0.9, h: CH * 0.05, kind: 'frame' });
    parts.push({ t: 'block', dx: W * (P.fold - 0.52), dy: CH * (P.divY + 0.115), w: W * 0.96, h: CH * 0.26, cham: 0.22, faceW: 7 });
    if (spec.keelPlate === false) parts.push({ t: 'poly', pts: [[-W * 0.48, CH * (P.foldY + 0.05)], [W * P.fold, CH * (P.foldY + 0.05)], [W * P.base, CH * 0.98], [-W * 0.4, CH * 1.0]], faceW: 11, faceEdges: [[2, 1], [3, 2]] }); // 龙骨突关：前界回 fold→base 直线
    else { const k = keelFromVent([P.fold, P.foldY + 0.05, P.base, 0.98], 0.98);
      parts.push({ t: 'poly', pts: [[-W * 0.48, CH * (P.foldY + 0.05)], [W * P.fold, CH * (P.foldY + 0.05)], k.K1, k.K2, [-W * 0.4, CH * 1.0]], faceW: 11, faceEdges: [[4, 3]] }); // 前界 fold→K1→K2 由龙骨突生成
      parts.push({ t: 'poly', pts: k.plate, faceW: 11, faceEdges: [[2, 1], [3, 2]], edgeLines: [[0, 1]], tint: 0.93 }); } // 龙骨板（自盒右上角起，上缘棱线＋前缘/底边料厚，tint 同壳带3）
    parts.push({ t: 'block', dx: -W * 0.08, dy: CH * 0.05, w: W * 0.7, h: CH * 0.13, kind: 'frame', cham: 0.3 });
  } else if (F.chest === 'shell') {
    // 壳形胸（对动力服圆壳/敏捷折面壳）：一整块多边形壳，前脸
    // 由四段折线逼近凸曲线（顶收→中突→下尖），无横缝无分板；
    // 动力服读圆、敏捷读折面，靠的是同一条轮廓的段数。配色按
    // 族再分一刀：动力服橙壳白顶、敏捷白壳下前蓝段（各自参考
    // 的色块分布，不是同一块壳换个颜色）
    // 中点即龙骨肩：敏捷把它拉到 (fold−0.18W, foldY−0.15CH)，
    // 使入折点的最后一段变浅（龙骨上缘，参考 ≈36° 族）——原点
    // (0.535W, 0.35CH) 让轮廓以约 64° 一路陡降到折点、缺了
    // 这段浅边（用户 2026-11-08 裁：龙骨突上缘角度不对）
    const midOff = spec.family === 'agile' ? -0.065 : 0.085, midY = P.foldY - (spec.family === 'agile' ? 0.15 : 0.2), lowOff = spec.family === 'agile' ? 0.03 : 0.08;
    const shRole = spec.family === 'powersuit' ? { role: 'armor2' as const } : {};
    // 三段带：分面边从轮廓顶点（折点/0.85 点）向后拉到背后缘，
    // 与参考的面分档同构（顶面亮/前面中/下前暗），色调逐段落档；
    // 龙骨料厚边按归属分到各带（点序沿用原壳轮廓）
    parts.push({ t: 'poly', pts: [[-W * 0.46, CH * 0.08], [W * 0.08, CH * 0.0], [W * P.top, CH * 0.12], [W * ((P.top + P.fold) / 2 + midOff), CH * midY], [W * P.fold, CH * P.foldY], [-W * 0.473, CH * 0.36]], bolts: true, faceW: 11, faceTone: 0.84, faceEdges: [[4, 3], [3, 2]], seamless: true, facet: true, tint: 1.06, ...shRole, net: 'fan' });
    parts.push({ t: 'poly', pts: [[W * P.fold, CH * P.foldY], [W * (P.base + lowOff), CH * 0.85], [-W * 0.404, CH * 0.88], [-W * 0.48, CH * 0.5], [-W * 0.473, CH * 0.36]], faceW: 11, faceTone: 0.84, faceEdges: [[1, 0]], edgeLines: [[0, 4]], seamless: true, facet: true, tint: 1.0, ...shRole, net: 'fan' });
    parts.push({ t: 'poly', pts: [[W * (P.base + lowOff), CH * 0.85], [W * P.base, CH * 0.9], [W * P.base, CH * 0.99], [-W * 0.38, CH * 1.0], [-W * 0.404, CH * 0.88]], faceW: 11, faceTone: 0.84, faceEdges: [[2, 1], [1, 0]], edgeLines: [[0, 4]], seamless: true, facet: true, tint: 0.93, ...shRole, net: 'fan' });
    if (spec.family === 'powersuit') parts.push({ t: 'poly', pts: [[-W * 0.46, CH * 0.08], [W * 0.08, CH * 0.0], [W * P.top, CH * 0.12], [W * (P.top + 0.05), CH * 0.28], [-W * 0.28, CH * 0.28], [-W * 0.48, CH * 0.42]], seamless: true, facet: true });
    else if (spec.family === 'agile') parts.push({ t: 'poly', pts: [[W * 0.3, CH * P.divY], [W * (P.fold - 0.01), CH * (P.divY + 0.17)], [W * P.base, CH * 0.9], [W * P.base, CH * 0.99], [W * 0.22, CH * 1.0]], role: 'armor2', tint: 0.95, faceW: 11, faceTone: 0.84, faceEdges: [[3, 2], [2, 1]], seamless: true, facet: true, net: 'fan' });
  } else if (F.chest === 'glacis') {
    // 斜面胸（对敏捷/主战的整坡装甲）：一整块多边形，前脸是
    // 一条连续斜线（0.30W@顶 → 0.66W@尖），坡面中段一块贴坡
    // 舱盖（按坡面切线角转），下唇即胸尖、无二段回收
    parts.push({ t: 'poly', pts: [[-W * 0.48, CH * 0.08], [W * P.top, CH * 0.08], [W * P.fold, CH * P.foldY], [W * P.base, CH * 0.99], [-W * 0.4, CH * 1.0]], faceW: 7, faceEdges: [[2, 1, 19], [3, 2], [4, 3]] }); // 前缘链（顶→折点→基点→底）与壳形同登记，理由同叠层；斜边 [2,1] 的料厚面加宽（19）——坡面即此厚面、舱盖坐其上（mbt 读法）
    // 坡面舱盖（mbt 读法定案）：舱盖整块内嵌在坡面里（沿坡
    // 面法向内退、不得骑在前缘线上探出剪影），外框 + 内嵌
    // 暗板（舱盖的双层读法），顺坡面角
    const slpA = Math.atan2((P.foldY - 0.08) * CH, (P.fold - P.top) * W);
    const slpX = W * (P.top + (P.fold - P.top) * ((P.divY - 0.08) / (P.foldY - 0.08)));
    const hcx = slpX - Math.sin(slpA) * W * 0.066, hcy = CH * P.divY + Math.cos(slpA) * W * 0.066;
    parts.push({ t: 'block', dx: hcx, dy: hcy, w: W * 0.30, h: CH * 0.10, ang: slpA, cham: 0.3, bolts: true });
    parts.push({ t: 'block', dx: hcx, dy: hcy, w: W * 0.20, h: CH * 0.058, ang: slpA, cham: 0.2, kind: 'frame' });
  } else { // slab 重板胸（对重装）：整块长斜楔——标注定案
    // （ann-heavy-slab）：重型人形胸是单一厚板自后高一线斜到
    // 前尖，平脸竖板是肩/臂的读法、不是胸。上段 = 单板斜面
    // （斜面在 divY 处的横坐标由 top/fold 直线插值，与下段
    // faceSeg 起点对齐），厚边走前缘；下段龙骨突构造不动
    const slabTopX = P.top + (P.fold - P.top) * ((P.divY - 0.06) / (P.foldY - 0.06));
    parts.push({ t: 'poly', pts: [[-W * 0.48, CH * 0.06], [W * P.top, CH * 0.06], [W * slabTopX, CH * P.divY], [-W * 0.47, CH * P.divY]], bolts: true, faceW: 11, faceEdges: [[2, 1]] });
    // 龙骨突：下段前界由龙骨突生成（keelFromVent），板自盒角生长
    if (spec.keelPlate === false) parts.push({ t: 'poly', pts: [[-W * 0.47, CH * P.divY], [W * P.fold, CH * P.divY], [W * P.base, CH * 0.99], [-W * 0.41, CH * 1.0]], faceW: 11, faceEdges: [[2, 1], [3, 2]] }); // 龙骨突关：前界回 fold→base 直线
    else { const k = keelFromVent([P.fold, P.divY + 0.03, P.base, 0.99], 0.99);
      parts.push({ t: 'poly', pts: [[-W * 0.47, CH * P.divY], [W * P.fold, CH * P.divY], k.K1, k.K2, [-W * 0.41, CH * 1.0]], faceW: 11, faceEdges: [[4, 3]] });
      parts.push({ t: 'poly', pts: k.plate, faceW: 11, faceEdges: [[2, 1], [3, 2]], edgeLines: [[0, 1]], tint: 0.93 });
      // 沿缘 accent 带（slab 定案：accent 只沿下前斜缘走、
      // 不横贯）：沿龙骨板前缘 [1]→[2] 向内偏 6px 一条带
      const [ax, ay] = k.plate[1], [bx, by] = k.plate[2];
      const ex = bx - ax, ey = by - ay, el = Math.hypot(ex, ey) || 1;
      const nx = ey / el * 6, ny = -ex / el * 6;
      parts.push({ t: 'poly', pts: [[ax, ay], [bx, by], [bx + nx, by + ny], [ax + nx, ay + ny]], role: 'accent' }); }
  }
  // 肩部楔拱（楔拱模式生成，不再手写点列）：四块异形楔绕肩
  // 盘拼合，盘心/内半径/各扇区外链是参数；前楔的外链同时给
  // 格栅并体用——盒的左侧面就是前楔，与之是同一个表面
  const arch = wedgeArch([-0.2, 0.47], 0.145, [
    { a0: -140, a1: -40, outer: [[-0.074, 0.234], [-0.246, 0.172], [-0.418, 0.266]] },
    { a0: 140, a1: 220, outer: [[-0.418, 0.266], [-0.457, 0.484], [-0.418, 0.719]], tint: 0.96 },
    { a0: 40, a1: 140, outer: [[-0.418, 0.719], [-0.215, 0.813], [-0.028, 0.719]], tint: 0.93 },
    { a0: -40, a1: 40, outer: [[-0.028, 0.719], [0.191, 0.625], [0.113, 0.328], [-0.074, 0.234]], tint: 0.98 },
  ]);
  const archPts = (poly: [number, number][]): [number, number][] => poly.map(([a, b]) => [W * a, CH * b]);
  for (const [ai, sec] of arch.entries()) {
    if (ai === 3 && spec.ventFuse !== false && ((F.chest === 'shell' && F.grille === 'front') || F.grille === 'side')) continue; // 前楔与盒左侧面并体（见格栅 fw），壳形前栅与侧栅同路；ventFuse 关时前楔自画
    parts.push({ t: 'poly', pts: archPts(sec.poly), ...(sec.tint !== undefined ? { tint: sec.tint } : {}) });
  }
  const fwFront = arch[3];
  const fwPts: [number, number][] = archPts([fwFront.outer[0], fwFront.arc[2], fwFront.arc[1], fwFront.arc[0], fwFront.outer[3], fwFront.outer[2]]);
  // 格栅：参考里在胸的下前斜面上（side = 主板斜面下段，front =
  // 敏捷壳面中段），横栅条贴面逐级进退，不是正面贴一只箱子
  const faceSeg: [number, number, number, number] = F.chest === 'slab' ? [W * P.fold, CH * (P.divY + 0.03), W * P.base, CH * 0.99]
    : F.chest === 'glacis' ? [W * P.fold, CH * P.foldY, W * P.base, CH * 0.99]
    : F.chest === 'shell' ? [W * P.fold, CH * P.foldY, W * (P.base + 0.08), CH * 0.85]
    : [W * P.fold, CH * (P.foldY + 0.05), W * P.base, CH * 0.98];
  // 龙骨上缘段：轮廓上止于 faceSeg 起点（折点）的前一段——
  // mpat-intake 的 keel 定向要从它解深度向（见 renderTorsoIR）
  const keelUp: [number, number, number, number] = F.chest === 'shell' ? [W * ((P.top + P.fold) / 2 + (spec.family === 'agile' ? -0.065 : 0.085)), CH * (P.foldY - (spec.family === 'agile' ? 0.15 : 0.2)), W * P.fold, CH * P.foldY]
    : F.chest === 'glacis' ? [W * P.top, CH * 0.08, W * P.fold, CH * P.foldY]
    : F.chest === 'slab' ? [W * P.top, CH * 0.28, W * P.fold, CH * P.divY]
    : [-W * 0.48, CH * (P.foldY + 0.05), W * P.fold, CH * (P.foldY + 0.05)];
  // 侧栅：盒在原位（口面即 faceSeg 线）；龙骨突自盒右缘向前
  // 生长造新剪影（见 keelFromVent），盒不后退、新剪影在盒前；
  // fw＝前楔轮廓，盒左侧面与前楔在渲染处并成一个面（消缝）
  if (F.grille === 'side') parts.push({ t: 'grille', dx: 0, dy: CH * 0.75, w: W * 0.3, h: CH * 0.24, face: faceSeg, ...(F.chest === 'shell' ? { keelUp } : {}), ...(spec.ventFuse !== false ? { fw: fwPts } : {}) });
  else if (F.grille === 'front') {
    parts.push(F.chest === 'shell'
      ? { t: 'grille', dx: W * 0.33, dy: CH * 0.66, w: W * 0.36, h: CH * 0.26, face: faceSeg, keelUp, bt: [W * 0.205, CH * 0.3], ...(spec.ventFuse !== false ? { fw: fwPts } : {}) }
      : { t: 'grille', dx: 0, dy: CH * (F.chest === 'glacis' ? 0.86 : 0.7), w: W * 0.28, h: CH * (F.chest === 'glacis' ? 0.22 : 0.26), face: faceSeg, ...(F.chest === 'glacis' ? { depth: spec.intakeDepth, tilt: 0 } : {}) }); // 斜面胸：口整段落在折点以下的下段斜面上（对主战百叶位），不骑折点；进深用浅口（凹进斜面、非凸盒）；面已随陡段剪切、不再叠盒整体转角（−0.3 是缓段定案、叠上陡段面会飞出剪影）
  }
  if (spec.gear.stripe && F.chest !== 'slab') parts.push({ t: 'block', dx: W * 0.0, dy: CH * 0.9, w: W * 0.84, h: 7, role: 'accent' });
  if (spec.gear.insignia > 0) parts.push({ t: 'insignia', dx: W * (spec.insigniaPos?.[0] ?? 0.16), dy: CH * (spec.insigniaPos?.[1] ?? 0.26), kind: spec.gear.insignia });
  // 编号必须整块落在一块板面内、避开板缝/格栅/条纹（按胸型选面）
  if (spec.gear.number) parts.push({ t: 'number', dx: W * 0.02, dy: CH * (F.chest === 'glacis' ? 0.5 : 0.64), text: spec.gear.number });
  // 胯 + 裙（胯顶回到腰底之下，不再上提钻进胸下——腰段要完整露出）
  if (spec.family === 'powersuit') {
    for (const [k, role] of [[-0.44, undefined], [0, 'armor2'], [0.44, undefined]] as const)
      parts.push({ t: 'block', dx: -W * 0.04, dy: waistY + WH * k, w: W * 0.62, h: WH * 0.34, cham: 0.06, faceW: 3, tint: 1.02, ...(role ? { role } : {}) });
  }
  parts.push({ t: 'block', dx: 0, dy: pelvisY + PH * 0.02, w: W * 0.88, h: PH * 0.98, cham: 0.32, bolts: true, faceW: 6 });
  if (spec.family === 'agile') {
    parts.push({ t: 'poly', pts: [[-W * 0.32, pelvisY - PH * 0.34], [W * 0.3, pelvisY + PH * 0.08], [W * 0.3, pelvisY + PH * 0.26], [-W * 0.32, pelvisY - PH * 0.16]], role: 'armor2', seamless: true, seamLines: [[-W * 0.11, pelvisY - PH * 0.2, -W * 0.11, pelvisY - PH * 0.02], [W * 0.12, pelvisY - PH * 0.04, W * 0.12, pelvisY + PH * 0.14]] });
    parts.push({ t: 'block', dx: W * 0.02, dy: pelvisY - PH * 0.42, w: 9, h: 3.5, role: 'mark' });
  }
  if (spec.gear.stripe && F.chest !== 'slab') parts.push({ t: 'block', dx: W * 0.05, dy: pelvisY + PH * 0.3, w: W * 0.8, h: 6, role: 'accent' });
  // 裙甲是贴在胯前/后脸上的斜板组（不是摆在胯边外的方块）：每侧
  // 两片斜板错落（内片高、外片低），中央露暗关节；无自动缝（原
  // 单片平底 + 居中十字缝读作两个盒子——差别清单③）
  if (F.skirt !== 'none') parts.push({ t: 'block', dx: 0, dy: pelvisY + PH * 0.52, w: W * 0.16, h: PH * 0.3, kind: 'frame', cham: 0.2 }); // 中央暗关节
  if (F.skirt !== 'none') {
    // 裙片轮廓（四边形退化处理）：前缘中段出折、底两角按约块
    // 厚三分之一切角——不再是四点平直四边形（判据按画面读法）
    if (F.chest === 'slab') {
      // slab 裙盒（重型标注）：悬挂在胯前侧的三面盒——侧面
      // （本调、带条纹）/前脸（暗一档）/顶面（亮一档）共一个
      // 顶点接合（与散热盒同关系），底缘整圈走料厚带；不是
      // 一块平板加一条底带
      // 裙盒对象（2026-11-09 用户逐轮纠正后定案）：盒子在
      // 胯的侧后——条纹面是主面、其左侧（后侧）是窄素面，
      // 上缘顶面斜带、底缘料厚；盒子右邻的胯前块是裆部、
      // 不属于盒子（先前把裆读成盒子的前脸、方向全反）
      const skTop = pelvisY + PH * 0.19, skBot = pelvisY + PH * 0.85;
      // 调用盒子模式：条纹面为盒的主面，深度 [0.33, 0.14] 朝
      // 后上扫出左侧素面与顶面（模式自带三面五调着色与接合
      // 亮棱）；底缘料厚由 box 件的 thickW 登记一整圈
      parts.push({ t: 'box', face: [[W * 0.115, skTop], [W * 0.40, skTop], [W * 0.40, skBot], [W * 0.115, skBot]], depth: [0.33, 0.14], tone: 1.25, thickW: 6, stripes: true });
    } else {
    parts.push({ t: 'poly', pts: [[W * 0.15, pelvisY - PH * 0.02], [W * 0.47, pelvisY + PH * 0.02], [W * 0.46, pelvisY + PH * 0.34], [W * 0.42, pelvisY + PH * 0.56], [W * 0.35, pelvisY + PH * 0.68], [W * 0.19, pelvisY + PH * 0.64], [W * 0.12, pelvisY + PH * 0.5]], faceW: 5, faceEdge: [5, 4], seamless: true }); // 前裙·外片
    parts.push({ t: 'poly', pts: [[W * 0.01, pelvisY + PH * 0.05], [W * 0.17, pelvisY + PH * 0.08], [W * 0.165, pelvisY + PH * 0.3], [W * 0.14, pelvisY + PH * 0.44], [W * 0.09, pelvisY + PH * 0.52], [W * 0.03, pelvisY + PH * 0.47], [-W * 0.01, pelvisY + PH * 0.38]], faceW: 5, faceEdge: [5, 4], seamless: true }); // 前裙·内片
    }
  }
  if (F.skirt === 'both') {
    parts.push({ t: 'poly', pts: [[-W * 0.47, pelvisY + PH * 0.06], [-W * 0.15, pelvisY + PH * 0.02], [-W * 0.125, pelvisY + PH * 0.32], [-W * 0.12, pelvisY + PH * 0.52], [-W * 0.17, pelvisY + PH * 0.63], [-W * 0.37, pelvisY + PH * 0.7], [-W * 0.44, pelvisY + PH * 0.6]], faceW: 5, faceEdge: [5, 4], seamless: true }); // 后裙·外片
    parts.push({ t: 'poly', pts: [[-W * 0.17, pelvisY + PH * 0.09], [-W * 0.01, pelvisY + PH * 0.06], [-W * 0.002, pelvisY + PH * 0.27], [W * 0.0, pelvisY + PH * 0.4], [-W * 0.04, pelvisY + PH * 0.49], [-W * 0.11, pelvisY + PH * 0.55], [-W * 0.15, pelvisY + PH * 0.47]], faceW: 5, faceEdge: [5, 4], seamless: true }); // 后裙·内片
  }
  // 肩盘最后画（用户令）：盘压在楔拱/盒/胸板之上，不被任何板盖住
  parts.push({ t: 'disc', dx: -W * 0.2, dy: CH * 0.47, r: W * 0.13 });
  return { anchors: { neck: spec.neck, shoulder: { x: spec.neck.x - W * 0.2, y: spec.neck.y + CH * 0.47 }, hip: { x: spec.neck.x, y: spec.neck.y + CH + WH + PH }, chestC: { x: spec.neck.x, y: spec.neck.y + CH / 2 } }, parts };
}
function renderTorsoIR(cv: MechaCanvas, ir: TorsoIR, spec: TorsoSpec): Anchors {
  const T = makeLayerTools(cv, spec.seed, spec.blockShape);
  const { A } = T, o = ir.anchors.neck;
  // 装口面朝向倍率（校准）：shell/glacis 的折面朝上受光（敏捷实测
  // 1.40，取 1.25 留余量）；stack/slab 的口在侧面/平面上，近本调
  const grilleTone = spec.form.chest === 'shell' || spec.form.chest === 'glacis' ? 1.4 : 0.95;
  // 框斜：盒整体转（深度轴锁在面框里、跟着一起转）。定版
  // -0.30 rad = 单独画盒时用户在五档对照（box-tilts.png）里指的
  // 第 4 档；侧置盒 0.15 未测——橄榄胸侧口未在参考上定位到
  const grilleTilt = spec.form.chest === 'shell' || spec.form.chest === 'glacis' ? -0.3 : 0.15;
  for (const p of ir.parts) {
    const cx = o.x + (p.t === 'poly' || p.t === 'box' || p.t === 'pipe' ? 0 : p.dx), cy = o.y + (p.t === 'poly' || p.t === 'box' || p.t === 'pipe' ? 0 : p.dy);
    if (p.t === 'block') { const id = T.addBlock(p.kind ?? 'plate', cx, cy, p.w, p.h, p.ang ?? 0, p.cham ?? 0.36, p.bolts ?? false); if (p.tint !== undefined) A.plateTint.set(id, p.tint); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); if (p.net === 'ashlar') { (A.wedgePlates ??= new Set()).add(id); (A.wedgeAshlar ??= new Map()).set(id, p.netAlt ?? -1); } if (p.faceW) { const ins = (p.w * (p.cham ?? 0.36)) / 2, by = cy + p.h / 2, ca = Math.cos(p.ang ?? 0), sa = Math.sin(p.ang ?? 0); regThickness(A, id, [{ x: cx + (-p.w / 2 + ins) * ca - p.h / 2 * sa, y: cy + (-p.w / 2 + ins) * sa + p.h / 2 * ca }, { x: cx + (p.w / 2 - ins) * ca - p.h / 2 * sa, y: cy + (p.w / 2 - ins) * sa + p.h / 2 * ca }], 1.0, { faceW: p.faceW, faceDx: sa, faceDy: -ca, faceTone: 0.92 }); void by; } }
    else if (p.t === 'poly') { const id = T.addPoly(p.pts.map(([dx, dy]) => ({ x: o.x + dx, y: o.y + dy })), p.bolts ?? false); if (p.tint !== undefined) A.plateTint.set(id, p.tint); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); if (p.seamless) { A.panelDiag.delete(id); A.panelTee.delete(id); A.seamU.delete(id); if (A.ridges) A.ridges = A.ridges.filter(r => !(r.inst === id && !r.thick)) } if (p.net) { (A.wedgePlates ??= new Set()).add(id); if (p.net === 'ashlar') (A.wedgeAshlar ??= new Map()).set(id, p.netAlt ?? -1); } if (p.edgeLines) for (const [a, b] of p.edgeLines) (A.ridges ??= []).push({ inst: id, pts: [{ x: o.x + p.pts[a][0], y: o.y + p.pts[a][1] }, { x: o.x + p.pts[b][0], y: o.y + p.pts[b][1] }], tone: 1.18, noThick: true });
      if (p.seamLines) for (const [x1, y1, x2, y2] of p.seamLines) (A.ridges ??= []).push({ inst: id, pts: [{ x: o.x + x1, y: o.y + y1 }, { x: o.x + x2, y: o.y + y2 }], tone: 0.78, noThick: true });
      // 料厚登记（模式本体）：棱线在带与板面的分界上——登记点从轮廓边向内偏 faceW，带从分界朝外铺到轮廓；线压分界、带在外侧
      if (p.faceW) for (const e of p.faceEdges ?? (p.faceEdge ? [p.faceEdge] : [])) { const [a, b] = e, fw = e[2] ?? p.faceW; const pa = p.pts[a], pb = p.pts[b]; const ex = pb[0] - pa[0], ey = pb[1] - pa[1], el = Math.hypot(ex, ey) || 1; const nx = ey / el, ny = -ex / el; regThickness(A, id, [{ x: o.x + pa[0] + nx * fw, y: o.y + pa[1] + ny * fw }, { x: o.x + pb[0] + nx * fw, y: o.y + pb[1] + ny * fw }], 1.3, { faceW: fw, faceDx: -nx, faceDy: -ny, faceTone: p.faceTone ?? 0.92, noThick: p.facet }); } }
    else if (p.t === 'disc') T.addDisc(p.kind ?? 'disc', { x: cx, y: cy }, p.r);
    else if (p.t === 'pipe') T.rod({ x: o.x + p.ax, y: o.y + p.ay }, { x: o.x + p.bx, y: o.y + p.by }, p.r, p.bellows); // 管道模式：本体归画圆柱的模式，bellows = 波纹管变体
    else if (p.t === 'box') {
      // 闭口盒：调用盒子模式（三面构造 + 盒子着色登记）；底缘
      // 料厚按 poly 的 faceW 同式登记（面底边 + 侧面底边一圈）
      const fc = p.face.map(([dx, dy]) => ({ x: o.x + dx, y: o.y + dy })) as [Pt, Pt, Pt, Pt];
      const r = T.box(fc, p.depth, p.tone ?? 1, 0);
      if (p.thickW) for (const [inst, pa, pb] of [[r.faceId, r.botFace[0], r.botFace[1]], [r.sideId, r.botSide[0], r.botSide[1]]] as [number, Pt, Pt][]) {
        const ex = pb.x - pa.x, ey = pb.y - pa.y, el = Math.hypot(ex, ey) || 1;
        const nx = ey / el, ny = -ex / el;
        regThickness(A, inst, [{ x: pa.x + nx * p.thickW, y: pa.y + ny * p.thickW }, { x: pb.x + nx * p.thickW, y: pb.y + ny * p.thickW }], 1.3, { faceW: p.thickW, faceDx: -nx, faceDy: -ny, faceTone: 0.92 });
      }
      if (p.stripes) {
        // 警示条纹是主面上的漆纹（纹理）：走漆带模式登记线段
        // （带向约 50°、竖排贯通），不另立独立条板
        const u = { x: 0.64, y: 0.77 }, ul = Math.hypot(u.x, u.y); u.x /= ul; u.y /= ul;
        const n = { x: -u.y, y: u.x };
        const ctr = { x: (fc[0].x + fc[2].x) / 2, y: (fc[0].y + fc[2].y) / 2 };
        const proj = fc.map((q) => (q.x - fc[0].x) * n.x + (q.y - fc[0].y) * n.y);
        const pMin = Math.min(...proj), pMax = Math.max(...proj), cMid = (ctr.x - fc[0].x) * n.x + (ctr.y - fc[0].y) * n.y;
        const diag = Math.hypot(fc[2].x - fc[0].x, fc[2].y - fc[0].y) / 2 + 4;
        const ids = new Set([r.faceId]);
        for (let c = Math.ceil(pMin / 11) * 11; c <= pMax; c += 11) {
          const q = { x: ctr.x + n.x * (c - cMid), y: ctr.y + n.y * (c - cMid) };
          (A.stripeSegs ??= []).push({ p1: { x: q.x - u.x * diag, y: q.y - u.y * diag }, p2: { x: q.x + u.x * diag, y: q.y + u.y * diag }, w: 2.5, ids });
        }
      }
    }
    else if (p.t === 'grille') {
      if (!p.face) T.grille(cx, cy, p.w, p.h, spec.intakeDepth, grilleTone, grilleTilt, spec.intakeShare);
      else { // 斜面进气口：壳体前缘贴斜面线（上下两行各取斜面 x），
        // 百叶由着色层在壳体内按水平行画——壳体形状即开口形状
        const [fx0, fy0, fx1, fy1] = p.face;
        const fxAt = (yy: number) => o.x + fx0 + (fx1 - fx0) * Math.max(0, Math.min(1, (yy - (o.y + fy0)) / (fy1 - fy0)));
        const yT = cy - p.h / 2, yB = cy + p.h / 2;
        const rectQuad: [Pt, Pt, Pt, Pt] = [{ x: fxAt(yT) - p.w, y: yT }, { x: fxAt(yT), y: yT }, { x: fxAt(yB), y: yB }, { x: fxAt(yB) - p.w, y: yB }];
        // keel 定向（mpat-intake 的构造规则）：两族平行——口前
        // 缘∥龙骨前缘（放置已给：左右棱沿 faceSeg）、深度向 D∥
        // 龙骨上缘。D = −(fx·T̂ + fy·L̂) 由面上边 T̂ 与左棱 L̂ 定，
        // 两约束联立解上边角 α（纯旋转只有一自由度、必然舍一族，
        // 这正是旧常数倾角的做法错处）。解不出（判别式<0）时退
        // 到 T̂ 取 g 在 L̂ 法向上的分量
        let fc = rectQuad, boxTilt = p.tilt ?? grilleTilt;
        const useKeel = spec.intakeOrient === 'keel' && !!p.keelUp;
        if (useKeel) {
          // 放置：面不在轮廓线上——右棱只取 faceSeg 的方向
          // （龙骨前缘族）；面心 (0.19W, 0.61CH) 由座推导：盒
          // 后缘（顶面后缘）右端正落在肩座块（锚点座，左下角
          // 约 (0.10W, 0.40CH)）上——盒后方贴合连接上臂安装座
          // （用户 2026-11-08 裁：盒不得退到背部、座必须画出）
          const Lv = { x: fx1 - fx0, y: fy1 - fy0 };
          const Lh = p.h, Lu = { x: Lv.x / (Math.hypot(Lv.x, Lv.y) || 1), y: Lv.y / (Math.hypot(Lv.x, Lv.y) || 1) };
          const ku = p.keelUp!;
          const gv = { x: ku[0] - ku[2], y: ku[1] - ku[3] };
          const gh = Math.hypot(gv.x, gv.y) || 1, g = { x: gv.x / gh, y: gv.y / gh };
          const [bfx0, bfy0] = p.depth ?? spec.boxDepth ?? [0.92, 0.7];
          const A = bfx0 * p.w, B = bfy0 * Lh, gd = g.x * Lu.x + g.y * Lu.y;
          const disc = A * A - B * B * (1 - gd * gd);
          // 约束是 D∥g 而 D = −(A·T̂ + B·L̂)，故 A·T̂ + B·L̂ = −λg
          // （λ>0）；符号写反会解出上边近竖直的退化面（实测教训）
          let Tu: Pt;
          if (disc >= 0) {
            const lam = -B * gd + Math.sqrt(disc);
            Tu = { x: (-lam * g.x - B * Lu.x) / A, y: (-lam * g.y - B * Lu.y) / A };
          } else {
            const tx = -g.x, ty = -g.y, td = tx * Lu.x + ty * Lu.y;
            const px = tx - td * Lu.x, py = ty - td * Lu.y, pl = Math.hypot(px, py) || 1;
            Tu = { x: px / pl, y: py / pl };
          }
          // 有 seat 时：盒是座的一部分——顶面后缘锚进座的前
          // 下部（座心 + (0.1·座宽, 0.35·座高)），面由锚点反推，
          // 不再是独立浮放的盒子（用户 2026-11-08 裁）
          let q1: Pt;
          if (p.bt || p.seat) {
            const Dv2 = { x: -(bfx0 * Tu.x * p.w + bfy0 * Lu.x * Lh), y: -(bfx0 * Tu.y * p.w + bfy0 * Lu.y * Lh) };
            const Tgt = p.bt ? { x: o.x + p.bt[0], y: o.y + p.bt[1] } : { x: o.x + p.seat![0] + p.seat![2] * 0.3, y: o.y + p.seat![1] };
            q1 = { x: Tgt.x - Dv2.x, y: Tgt.y - Dv2.y };
          } else {
            const C = { x: cx, y: cy };
            q1 = { x: C.x + Tu.x * p.w / 2 - Lu.x * Lh / 2, y: C.y + Tu.y * p.w / 2 - Lu.y * Lh / 2 };
          }
          const q0 = { x: q1.x - Tu.x * p.w, y: q1.y - Tu.y * p.w };
          fc = [q0, q1, { x: q1.x + Lu.x * Lh, y: q1.y + Lu.y * Lh }, { x: q0.x + Lu.x * Lh, y: q0.y + Lu.y * Lh }];
          boxTilt = 0;
        }
        T.intakeBox(fc, p.depth ?? spec.boxDepth ?? [0.92, 0.7], grilleTone, boxTilt, spec.intakeShare, true);
        // 盒与机身的结合（对重型样本读出）：盒不是贴在面上——
        // 胸顶板的前缘压过盒顶面的后缘（盒从板下钻出来），接触
        // 处只有缝线没有间隙。按 intakeBox 内部同式（绕质心转
        // grilleTilt、深度锁在面框里）算出顶面后缘，在其上压
        // 一条胸板条，接触边登记棱线
        const ctr = { x: (fc[0].x + fc[1].x + fc[2].x + fc[3].x) / 4, y: (fc[0].y + fc[1].y + fc[2].y + fc[3].y) / 4 };
        const ct = Math.cos(boxTilt), st = Math.sin(boxTilt);
        const rc = boxTilt === 0 ? fc : fc.map((q) => ({ x: ctr.x + (q.x - ctr.x) * ct - (q.y - ctr.y) * st, y: ctr.y + (q.x - ctr.x) * st + (q.y - ctr.y) * ct }));
        const [bfx, bfy] = p.depth ?? spec.boxDepth ?? [0.92, 0.7];
        const Dv = { x: -(bfx * (rc[1].x - rc[0].x) + bfy * (rc[3].x - rc[0].x)), y: -(bfx * (rc[1].y - rc[0].y) + bfy * (rc[3].y - rc[0].y)) };
        const dLen = Math.hypot(Dv.x, Dv.y) || 1, dn = { x: Dv.x / dLen, y: Dv.y / dLen };
        const bA = { x: rc[0].x + Dv.x, y: rc[0].y + Dv.y }, bB = { x: rc[1].x + Dv.x, y: rc[1].y + Dv.y };
        const exu = { x: (bB.x - bA.x) / (Math.hypot(bB.x - bA.x, bB.y - bA.y) || 1), y: (bB.y - bA.y) / (Math.hypot(bB.x - bA.x, bB.y - bA.y) || 1) };
        const sA = { x: bA.x - exu.x * 3, y: bA.y - exu.y * 3 }, sB = { x: bB.x + exu.x * 3, y: bB.y + exu.y * 3 };
        const stripId = T.addPoly([sA, sB, { x: sB.x + dn.x * 13, y: sB.y + dn.y * 13 }, { x: sA.x + dn.x * 13, y: sA.y + dn.y * 13 }]);
        (A.ridges ??= []).push({ inst: stripId, pts: [sA, sB], tone: 1.24 });
        if (p.fw) {
          const TLu = { x: rc[0].x + Dv.x, y: rc[0].y + Dv.y };
          const fwAbs = p.fw.map(([fx2, fy2]) => ({ x: o.x + fx2, y: o.y + fy2 }));
          // 并体轮廓必须包住盒左侧面整幅（[TL, 面左上, 面左下, BL]）：
          // 侧栅盒深、左侧面下后角 BL 在旧轮廓（面左下直连前楔）之
          // 外，漏在外面就仍是两个面、缝消不掉——侧栅路把 BL 也
          // 纳入轮廓；壳形前栅（bt）轮廓已验、逐点不动
          if (p.bt) T.addPoly([TLu, fc[0], fc[3], ...fwAbs]);
          else T.addPoly([TLu, rc[0], rc[3], { x: rc[3].x + Dv.x, y: rc[3].y + Dv.y }, ...fwAbs]);
        }
        // 附属件（模式：口从来不单独出现）——横槽组在盒扫掠体
        // 左侧的胸板上（附属件模式①：2 条短横槽，槽长约口宽
        // 1/3）；小方灯在口下一板处（模式④）
        if (spec.intakeTrim !== false) {
          for (const tt of [0.32, 0.52]) {
            const sx = fc[0].x + (fc[3].x - fc[0].x) * tt + Dv.x * 0.3, sy = fc[0].y + (fc[3].y - fc[0].y) * tt + Dv.y * 0.3;
            T.addBlock('frame', sx, sy, Math.max(8, p.w * 0.36), 3.5, 0, 0.2);
          }
          const lx = (useKeel ? fc[2].x : fxAt(yB)) - p.w * 0.25, ly = (useKeel ? fc[2].y : yB) + 11;
          T.addBlock('frame', lx, ly, 10, 10, 0, 0.25);
          A.lightPts.push({ x: lx, y: ly });
        }
      }
    }
    else if (p.t === 'light') A.lightPts.push({ x: cx, y: cy });
    else if (p.t === 'insignia') A.insignia = { pos: { x: cx, y: cy }, kind: p.kind };
    else if (p.t === 'number') { A.numPos = { x: cx, y: cy }; A.numText = p.text; }
  }
  T.finish();
  return A;
}

// ---------- hullIR：车体规格 → 锚点 → 部件列 → 通用解释（楔形主箱+模块阵列+裙带+顶置挂载） ----------
type HullPart =
  | { t: 'block'; dx: number; dy: number; w: number; h: number; ang?: number; kind?: Kind; cham?: number; bolts?: boolean; faceW?: number; tint?: number; role?: 'stripe' | 'armor2' | 'accent' | 'mark'; seams?: [number, number, number, number][]; stripe?: { y: number; x0: number; x1: number; w?: number } }
  | { t: 'disc'; dx: number; dy: number; r: number; kind?: Kind }
  | { t: 'grille'; dx: number; dy: number; w: number; h: number }
  | { t: 'light'; dx: number; dy: number }
  | { t: 'insignia'; dx: number; dy: number; kind: number }
  | { t: 'sagcable'; x1: number; y1: number; x2: number; y2: number; sag: number; r: number }
  | { t: 'sidepod'; dx: number; dy: number; w: number; h: number }
  | { t: 'number'; dx: number; dy: number; text: string };
interface HullSpec {
  /** 块形（模式库「块形·非四边形」）：块逐角切角分布 */ blockShape?: BlockShapeParams;
  /** 进气口三面盒深度 [横, 纵]（模式库 mpat-intake 条目持有标准值） */ intakeDepth?: [number, number];
  /** 进气口口占装口面份额 [宽, 高]（同上） */ intakeShare?: [number, number];
  family: string; scheme: Scheme; seed: number; wear: number; camo: boolean; twoTone: boolean;
  deck: Pt; hullW: number; hullH: number;
  form: { turret: 'gun' | 'rack' | 'none'; cabin: 'front' | 'mid'; skirt: boolean; modules: number };
  gear: { insignia: number; number: string };
  /** 徽章模式的落点（[W 分数, H 分数]）：由用户定，缺省按族（walker 左板/hauler 车头板） */
  insigniaPos?: [number, number];
  /** 垂缆（模式库「垂缆」）：腹线下两兜悬垂线缆 */ sagCables?: boolean;
  /** 侧挂设备舱（模式库「侧挂设备舱」）：前侧面外挂盒 + 舱底垂缆 */ sidePod?: boolean;
  split?: 'body' | 'turret';
}
interface HullIR { anchors: Record<'deck' | 'turret' | 'leg' | 'nose', Pt>; parts: HullPart[] }
function hullIR(spec: HullSpec): HullIR {
  const W = spec.hullW, H = spec.hullH, F = spec.form, parts: HullPart[] = [], tp: HullPart[] = [];
  parts.push({ t: 'block', dx: -W * 0.06, dy: H * 0.34, w: W * 0.94, h: H * 0.62, cham: 0.42, bolts: true, seams: [[-W * 0.49, H * 0.56, W * 0.38, H * 0.56], [spec.family === 'walker' ? W * 0.1 : W * 0.26, H * 0.08, spec.family === 'walker' ? W * 0.1 : W * 0.26, H * 0.56]], ...(spec.family === 'hauler' ? { stripe: { y: H * 0.615, x0: -W * 0.47, x1: W * 0.43, w: 2.2 } } : {}) }); // 主箱（楔）+ 大板结构缝（登记制、与躯干 seamLines 同路，收尾统一画缝唇）；hauler 贯穿漆带（登记制、与胫骨漆带同路）
  parts.push({ t: 'block', dx: W * 0.33, dy: H * 0.28, w: W * 0.42, h: H * 0.46, cham: 0.5 }); // 前斜脸（长坡面：自甲板前缘斜到鼻尖，参考约占车长一半）
  if (F.skirt) parts.push({ t: 'block', dx: -W * 0.02, dy: H * 0.78, w: W * 0.98, h: H * 0.3, cham: 0.3 }); // 底裙带
  const cabDx = F.cabin === 'front' ? W * 0.3 : W * 0.02;
  parts.push({ t: 'block', dx: cabDx, dy: H * 0.3, w: W * 0.3, h: H * 0.36, cham: 0.3 }); // 舱体
  parts.push({ t: 'block', dx: cabDx + W * 0.06, dy: H * 0.22, w: W * 0.2, h: H * 0.1, kind: 'frame' }); // 舱窗带
  parts.push({ t: 'light', dx: cabDx + W * 0.1, dy: H * 0.22 });
  for (let k = 0; k < F.modules; k++) parts.push({ t: 'block', dx: -W * 0.08 - k * W * 0.17, dy: H * 0.32, w: W * 0.14, h: H * 0.3, cham: 0.25 }); // 侧面模块阵列
  // 后侧散热栅：整块落在侧面上（walker 落裙带面、hauler 落
  // 主箱面）——旧位在后下角、半块悬在轮廓外，已内收
  if (F.skirt) parts.push({ t: 'grille', dx: -W * 0.3, dy: H * 0.78, w: W * 0.26, h: H * 0.18 });
  else parts.push({ t: 'grille', dx: -W * 0.4, dy: H * 0.44, w: W * 0.24, h: H * 0.2 });
  if (F.turret === 'gun') {
    // 炮塔本体：座环 + 主体 + 舱盖 + 传感器桅/潜望镜 + 炮盾座。
    // 主炮不在此画——炮是武器模式的产物（gear 臂炮构造），由
    // parts 的 generateMechaTurret/generateMechaHull 生成武器
    // 精灵后贴合到炮盾座上，全仓只有一套炮的画法
    tp.push({ t: 'disc', dx: -W * 0.08, dy: -H * 0.02, r: W * 0.1 });
    tp.push({ t: 'block', dx: -W * 0.06, dy: -H * 0.14, w: W * 0.36, h: H * 0.24, cham: 0.4 }); // 炮塔主体
    tp.push({ t: 'block', dx: -W * 0.1, dy: -H * 0.3, w: W * 0.15, h: H * 0.07, cham: 0.4 }); // 舱盖
    tp.push({ t: 'block', dx: -W * 0.21, dy: -H * 0.36, w: W * 0.025, h: H * 0.22, cham: 0.2 }); // 传感器桅
    tp.push({ t: 'block', dx: W * 0.05, dy: -H * 0.3, w: W * 0.07, h: H * 0.06, kind: 'frame' }); // 潜望镜窗
    tp.push({ t: 'block', dx: W * 0.14, dy: -H * 0.16, w: W * 0.1, h: H * 0.17, cham: 0.3 }); // 炮盾座（武器套筒点与此对齐）
  } else if (F.turret === 'rack') {
    tp.push({ t: 'block', dx: -W * 0.24, dy: -H * 0.02, w: W * 0.08, h: H * 0.14, kind: 'frame' }); // 架柱
    tp.push({ t: 'block', dx: W * 0.08, dy: -H * 0.02, w: W * 0.08, h: H * 0.14, kind: 'frame' });
    tp.push({ t: 'block', dx: -W * 0.08, dy: -H * 0.12, w: W * 0.52, h: H * 0.14, kind: 'frame' }); // 顶架
    tp.push({ t: 'block', dx: -W * 0.22, dy: -H * 0.25, w: W * 0.16, h: H * 0.16, kind: 'cyl', tint: 1.35 }); // 罐（提亮：柱面着色偏暗，原值在架上读作黑桶）
    tp.push({ t: 'block', dx: 0, dy: -H * 0.25, w: W * 0.16, h: H * 0.16, kind: 'cyl', tint: 1.35 });
    tp.push({ t: 'block', dx: W * 0.13, dy: -H * 0.23, w: W * 0.14, h: H * 0.2 }); // 箱（坐架上）
  }
  // 腹线（裙带底沿 / 无裙带时主箱底沿）：垂缆与侧挂舱的挂载线
  const bellyY = F.skirt ? H * 0.93 : H * 0.66;
  // 垂缆（模式：线缆在两锚之间悬垂成兜——铁巢样本车腹两组支架
  // 之间成束垂挂；着色走线缆本体，本处只定兜形与锚位）
  if (spec.sagCables) {
    parts.push({ t: 'sagcable', x1: -W * 0.3, y1: bellyY, x2: -W * 0.02, y2: bellyY, sag: 26, r: 3.4 });
    parts.push({ t: 'sagcable', x1: W * 0.05, y1: bellyY, x2: W * 0.31, y2: bellyY, sag: 20, r: 3 });
  }
  // 侧挂设备舱（模式组合：盒子模式挂主面外侧 + 舱底一兜垂缆——
  // 垂缆模式的第二个调用点，与腹下垂缆同一实现）
  if (spec.sidePod) {
    const pw = W * 0.19, ph = H * 0.3, pdx = W * 0.31, pdy = bellyY - H * 0.17;
    parts.push({ t: 'sidepod', dx: pdx, dy: pdy, w: pw, h: ph });
    parts.push({ t: 'sagcable', x1: pdx - pw * 0.3, y1: pdy + ph / 2, x2: pdx + pw * 0.3, y2: pdy + ph / 2, sag: 13, r: 2.6 });
  }
  // 标记成组：徽记贴编号下方（参考的标记都成组挨着结构件，
  // 不单独浮在空侧面中央）；hauler 的记号在车头板上
  { const [ipx, ipy] = spec.insigniaPos ?? (spec.family === 'hauler' ? [0.37, 0.44] : [-0.3, 0.5]); parts.push({ t: 'insignia', dx: W * ipx, dy: H * ipy, kind: spec.gear.insignia }); }
  if (spec.gear.number) parts.push({ t: 'number', dx: spec.family === 'hauler' ? -W * 0.25 : -W * 0.3, dy: H * 0.36, text: spec.gear.number }); // hauler 编号落在模块面上（旧位被内收后的后栅盖住一半）
  parts.push({ t: 'light', dx: W * 0.44, dy: H * 0.44 });
  const anchors = { deck: spec.deck, turret: { x: spec.deck.x - W * 0.06, y: spec.deck.y - H * 0.14 }, leg: { x: spec.deck.x, y: spec.deck.y + H }, nose: { x: spec.deck.x + W * 0.5, y: spec.deck.y + H * 0.3 } };
  if (spec.split === 'turret') return { anchors, parts: tp };
  if (spec.split === 'body') return { anchors, parts };
  return { anchors, parts: [...parts, ...tp] };
}
function renderHullIR(cv: MechaCanvas, ir: HullIR, spec: HullSpec): Anchors {
  const T = makeLayerTools(cv, spec.seed, spec.blockShape);
  const { A } = T, o = ir.anchors.deck;
  for (const p of ir.parts) {
    const cx = o.x + p.dx, cy = o.y + p.dy;
    if (p.t === 'block') { const id = T.addBlock(p.kind ?? 'plate', cx, cy, p.w, p.h, p.ang ?? 0, p.cham ?? 0.36, p.bolts ?? false); if (p.tint !== undefined) A.plateTint.set(id, p.tint); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); if (p.seams) for (const [x1, y1, x2, y2] of p.seams) (A.ridges ??= []).push({ inst: id, pts: [{ x: o.x + x1, y: o.y + y1 }, { x: o.x + x2, y: o.y + y2 }], tone: 0.78, noThick: true }); if (p.stripe) A.stripeSegs.push({ p1: { x: o.x + p.stripe.x0, y: o.y + p.stripe.y }, p2: { x: o.x + p.stripe.x1, y: o.y + p.stripe.y }, w: p.stripe.w, ids: new Set([id]) }); }
    else if (p.t === 'disc') T.addDisc(p.kind ?? 'disc', { x: cx, y: cy }, p.r);
    else if (p.t === 'grille') T.grille(cx, cy, p.w, p.h, spec.intakeDepth, spec.family === 'walker' ? 0.78 : 1, spec.family === 'walker' ? 0.12 : 0, spec.intakeShare); // 车体口按族分：walker≈mbt 面实测 0.78（框斜未测留 0.12）；hauler≈engineer 正对面实测 1.00、鼻口框正（corr-eng-nose 叶片水平）→0
    else if (p.t === 'light') A.lightPts.push({ x: cx, y: cy });
    else if (p.t === 'sagcable') {
      // 垂缆 = 成组线束（用户定）：三股平行悬垂缆合成一个场（股间沟由场梯度
      // 在电缆着色里自然读出），沿束三道扎带箍，两端接头盘。
      const p0 = { x: o.x + p.x1, y: o.y + p.y1 }, p2 = { x: o.x + p.x2, y: o.y + p.y2 };
      const chord = Math.hypot(p2.x - p0.x, p2.y - p0.y) || 1;
      const nx = -(p2.y - p0.y) / chord, ny = (p2.x - p0.x) / chord; // 束的法向（侧视图里≈竖直，股沿它叠）
      const strandR = p.r * 0.62, off = p.r * 1.05;
      const strands: Pt[][] = [];
      for (const oi of [-1, 0, 1]) {
        const a = { x: p0.x + nx * off * oi, y: p0.y + ny * off * oi }, b = { x: p2.x + nx * off * oi, y: p2.y + ny * off * oi };
        const c = { x: (a.x + b.x) / 2 + nx * off * oi * 0.3, y: (a.y + b.y) / 2 + p.sag * (1 + oi * 0.05) + ny * off * oi * 0.3 };
        const pts: Pt[] = [];
        for (let k = 0; k <= 40; k++) { const t = k / 40, u = 1 - t; pts.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }); }
        strands.push(pts);
      }
      const allPts = strands.flat();
      T.addRaw('cable', (x, y) => { let m = 1e9; for (const q2 of allPts) m = Math.min(m, Math.hypot(x - q2.x, y - q2.y)); return [m <= strandR, 0, m / strandR]; });
      // 扎带箍：沿束心在 t=0.28/0.5/0.72 处横束一带（frame 件，随束切线转）
      const mid = strands[1]!;
      for (const tt of [0.28, 0.5, 0.72]) {
        const idx = Math.round(tt * 40), q = mid[idx]!, qn = mid[Math.min(40, idx + 1)]!, qp = mid[Math.max(0, idx - 1)]!;
        T.addBlock('frame', q.x, q.y, 4.5, (off + strandR) * 2 + 1.5, Math.atan2(qn.y - qp.y, qn.x - qp.x), 0.3);
      }
      T.addDisc('cyl', p0, p.r + 2.4); T.addDisc('cyl', p2, p.r + 2.4);
    }
    else if (p.t === 'sidepod') { const q: [Pt, Pt, Pt, Pt] = [{ x: cx - p.w / 2, y: cy - p.h / 2 }, { x: cx + p.w / 2, y: cy - p.h / 2 }, { x: cx + p.w / 2, y: cy + p.h / 2 }, { x: cx - p.w / 2, y: cy + p.h / 2 }]; T.box(q, [0.34, 0.26], 1); } // 侧挂舱本体 = 盒子模式（闭口盒）
    else if (p.t === 'insignia') A.insignia = { pos: { x: cx, y: cy }, kind: p.kind };
    else if (p.t === 'number') { A.numPos = { x: cx, y: cy }; A.numText = p.text; }
  }
  T.finish();
  return A;
}

/** 髋梁横轴（支架腿组子模式，铁巢样本）：横置梁壳 + 梁端关节盘
 * （盘 + 毂，与腿关节盘同一模式）。梁心 = 精灵原点（装配挂点），
 * 两撑链的髋落在梁下。 */
export function renderHipBeam(cv: MechaCanvas, spec: LegSpec): Anchors {
  const T = makeLayerTools(cv, spec.seed + 31, spec.blockShape);
  const { A } = T;
  const c = { x: 190, y: 70 };
  T.addBlock('plate', c.x, c.y, 132, 36, 0, 0.3, true); // 梁壳
  T.addBlock('frame', c.x, c.y + 13, 108, 8, 0, 0.2); // 梁下沿带（收在梁壳轮廓内）
  for (const dx of [-30, 30]) {
    const id = T.addDisc('disc', { x: c.x + dx, y: c.y + 1 }, 15);
    const d = A.discs.find((q) => q.id === id); if (d) d.hub = true; // 梁端盘（关节盘模式：盘+毂）
  }
  T.finish();
  return A;
}

// ---------- headIR：规格 → 锚点 → 部件列 → 通用解释（构成四项 + 顶部变体槽） ----------
type HeadPart =
  | { t: 'block'; dx: number; dy: number; w: number; h: number; ang?: number; kind?: Kind; cham?: number; bolts?: boolean; faceW?: number; tint?: number; role?: 'stripe' | 'armor2' | 'accent' | 'mark' }
  | { t: 'disc'; dx: number; dy: number; r: number; kind?: Kind }
  | { t: 'grille'; dx: number; dy: number; w: number; h: number }
  | { t: 'poly'; pts: [number, number][]; bolts?: boolean; faceW?: number; faceEdge?: [number, number]; role?: 'armor2' | 'accent' }
  | { t: 'wing'; dx: number; dy: number; len: number; wRoot: number; wTip: number; ang: number; role?: 'armor2' | 'accent' }
  | { t: 'light'; dx: number; dy: number };
interface HeadSpec {
  /** 块形（模式库「块形·非四边形」）：块逐角切角分布 */ blockShape?: BlockShapeParams;
  /** 进气口三面盒深度 [横, 纵]（模式库 mpat-intake 条目持有标准值） */ intakeDepth?: [number, number];
  /** 进气口口占装口面份额 [宽, 高]（同上） */ intakeShare?: [number, number];
  family: string; scheme: Scheme; seed: number; wear: number; camo: boolean;
  /** 双色交替开关（基色 pass 按序号奇偶交替 armor/armor2）：头部关
   * ——参考头部是单主色 + 角色指定件（鳍/颌/漆带），不按序号轮换 */
  altTone?: boolean;
  seat: Pt; w: number; h: number; tilt: number; twoTone: boolean;
  form: { crown: 'dome' | 'flat' | 'angular'; eye: 'slit' | 'dot' | 'visor'; brow: boolean; jaw: 'block' | 'respirator' | 'small' | 'breather'; ear: 'disc' | 'grille' | 'plate' | 'sensor' | 'plateStripe' | 'earcover'; top: 'horn' | 'vfin' | 'antenna' | 'none'; cheekCable: boolean };
}
interface HeadIR { anchors: Record<'seat' | 'eye' | 'ear' | 'crown', Pt>; parts: HeadPart[] }
function headIR(spec: HeadSpec): HeadIR {
  const w = spec.w, h = spec.h, F = spec.form, parts: HeadPart[] = [];
  const chamC = F.crown === 'dome' ? 0.68 : F.crown === 'flat' ? 0.3 : 0.44;
  parts.push({ t: 'block', dx: 0, dy: -h * 0.05, w: w * 0.54, h: h * 0.18, kind: 'frame' }); // 领圈（颈环，窄于盔体藏在颌下；上缘搭进盔底，不留透明带）
  parts.push({ t: 'block', dx: -w * 0.3, dy: -h * 0.52, w: w * 0.32, h: h * 0.64, cham: 0.4 }); // 后颅
  parts.push({ t: 'block', dx: -w * 0.02, dy: -h * 0.52, w: w * 0.92, h: h * 0.8, cham: chamC, bolts: true }); // 盔体（前缘让给面部叠层）
  // —— 冠：模式「冠板组顺势前下」——圆顶走真弧 + 顺弧漆带，其余两级分步板
  if (F.crown === 'dome') {
    const arc: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * (1 - i / 12); // 后→顶→前（密点成弧，免折线阶梯）
      arc.push([-w * 0.05 + Math.cos(a) * w * 0.44, -h * 0.6 - Math.sin(a) * h * 0.44]);
    }
    arc.push([w * 0.36, -h * 0.58], [-w * 0.46, -h * 0.58]);
    parts.push({ t: 'poly', pts: arc }); // 圆顶（真弧顶，不是大倒角方块）
    const band: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (0.92 - (i / 10) * 0.68);
      band.push([-w * 0.05 + Math.cos(a) * w * 0.425, -h * 0.6 - Math.sin(a) * h * 0.425]);
    }
    for (let i = 10; i >= 0; i--) {
      const a = Math.PI * (0.92 - (i / 10) * 0.68);
      band.push([-w * 0.05 + Math.cos(a) * w * 0.372, -h * 0.6 - Math.sin(a) * h * 0.372]);
    }
    // 顺弧漆带（贴着弧面走）：强调色带只有动力服参考有（橙条纹
    // 绕盔）；其余族是同色面板带，不许整顶刷强调色
    if (spec.family === 'powersuit') parts.push({ t: 'poly', pts: band, role: 'accent' });
    else parts.push({ t: 'poly', pts: band });
  } else {
    const stepCham = F.crown === 'flat' ? 0.2 : 0.35;
    parts.push({ t: 'block', dx: -w * 0.24, dy: -h * 0.94, w: w * 0.46, h: h * 0.2, cham: stepCham, bolts: true }); // 后级冠板（高）
    parts.push({ t: 'block', dx: w * 0.08, dy: -h * 0.87, w: w * 0.46, h: h * 0.18, ang: -0.05, cham: stepCham }); // 前级冠板（低一阶、向前探）
  }
  // —— 眼：模式「眼必凹」——暗座先画、陷在眉檐与颊板之间，发光只许在座内成缝
  const seatDy = F.eye === 'visor' ? -h * 0.56 : -h * 0.5;
  if (F.eye === 'visor') { // 整面面罩：面甲打底 + 一道细暗缝 + 缝内亮点
    parts.push({ t: 'poly', pts: [[w * 0.02, -h * 0.63], [w * 0.4, -h * 0.63], [w * 0.45, -h * 0.56], [w * 0.4, -h * 0.49], [w * 0.02, -h * 0.49]] }); //面前不越盔体前缘（旧 0.52 尖出成喙，已收）
    parts.push({ t: 'block', dx: w * 0.27, dy: seatDy, w: w * 0.38, h: h * 0.04, kind: 'frame', cham: 0.5 });
    for (let ex = 0.28; ex <= 0.42; ex += 0.014) parts.push({ t: 'light', dx: w * ex, dy: seatDy }); // 密点成缝（旧步距 0.03 读作断点）
  } else {
    const seatW = F.eye === 'dot' ? 0.22 : 0.28;
    parts.push({ t: 'block', dx: w * 0.28, dy: seatDy, w: w * seatW, h: h * 0.15, kind: 'frame' }); // 暗脸凹座（前面不超过颊板）
    if (F.eye === 'slit') { for (let ex = 0.25; ex <= 0.361; ex += 0.011) parts.push({ t: 'light', dx: w * ex, dy: seatDy }); } // 缝眼：窄（约脸宽 1/9）密点连成实心缝、居座中——参考眼宽约脸宽 1/4–1/3 是含座口径，亮缝本体更窄
    else parts.push({ t: 'light', dx: w * 0.3, dy: seatDy });
  }
  if (F.brow) parts.push({ t: 'block', dx: w * 0.3, dy: -h * 0.64, w: w * 0.34, h: h * 0.11, ang: 0.12, ...(spec.family === 'agile' ? { role: 'armor2' as const } : {}) }); // 眉檐压眼（后画，压住凹座上沿）；敏捷眉檐即额前蓝冠件（参考指定，薄而顺额）
  parts.push({ t: 'block', dx: w * 0.26, dy: -h * 0.27, w: w * 0.36, h: h * 0.26, ang: 0.18 }); // 颊板（斜面承眼座到颌，前缘压住凹座下沿；前缘收进盔体前缘内）
  // —— 颌：颌轴侧件槽之外，颌式槽只占一物
  if (F.jaw === 'respirator') { // 肋管颏：颌板打底 + 近横短管 + 横肋 + 管口（参考为颏前一小簇横栅，不许斜伸成獠牙嘴）
    parts.push({ t: 'block', dx: w * 0.2, dy: -h * 0.11, w: w * 0.36, h: h * 0.22, ang: 0.08 }); // 颌板（收小、后缩）
    parts.push({ t: 'block', dx: w * 0.26, dy: -h * 0.125, w: w * 0.27, h: h * 0.08, ang: 0.14, kind: 'frame' }); // 短管打底（暗——栅格本体是暗的）
    for (const [rx, ry] of [[0.155, -0.176], [0.2075, -0.161], [0.26, -0.147], [0.3125, -0.133], [0.365, -0.119]] as const) {
      parts.push({ t: 'block', dx: w * rx, dy: h * ry, w: w * 0.016, h: h * 0.1, ang: 0.14, kind: 'cyl' }); // 横肋（细金属条压在暗管上 = 栅格亮线；粗暗肋+亮缝会读作牙）
    }
    parts.push({ t: 'disc', dx: w * 0.4, dy: -h * 0.095, r: Math.min(w, h) * 0.045, kind: 'cyl' }); // 管口
  } else if (F.jaw === 'breather') { // 小呼吸器：小颏块 + 颏前小管口（动力服式）
    parts.push({ t: 'block', dx: w * 0.2, dy: -h * 0.11, w: w * 0.24, h: h * 0.13, ang: 0.14 });
    parts.push({ t: 'block', dx: w * 0.4, dy: -h * 0.09, w: w * 0.1, h: h * 0.07, ang: 0.2, kind: 'cyl' });
    parts.push({ t: 'block', dx: w * 0.44, dy: -h * 0.085, w: w * 0.035, h: h * 0.05, role: 'accent' });
  } else if (F.jaw === 'block') parts.push({ t: 'block', dx: w * 0.22, dy: -h * 0.13, w: w * 0.32, h: h * 0.17, ang: 0.14, ...(spec.family === 'agile' ? { role: 'armor2' as const } : {}) }); // 颌块后缩（前缘不越盔体）；敏捷为蓝色颌卫（参考指定）
  else parts.push({ t: 'block', dx: w * 0.25, dy: -h * 0.11, w: w * 0.34, h: h * 0.13, ang: 0.14 });
  // —— 侧件：只占颌轴侧件槽一位，位置在侧面（后半），不许跑进脸区
  if (F.ear === 'grille') { // 带框栅（侧面中后，中等面板口径——参考约占侧面 1/4，不许整颊）
    parts.push({ t: 'grille', dx: -w * 0.19, dy: -h * 0.47, w: w * 0.26, h: h * 0.28 });
  } else if (F.ear === 'sensor') { // 小盘 + 盘下短缝 + 颊鳍（敏捷侧面读法：都是小件）
    parts.push({ t: 'disc', dx: -w * 0.05, dy: -h * 0.6, r: w * 0.038, kind: 'frame' }); // 冠侧小圆传感器
    parts.push({ t: 'block', dx: -w * 0.1, dy: -h * 0.37, w: w * 0.035, h: h * 0.2, kind: 'frame' }); // 盘下短竖缝
    parts.push({ t: 'block', dx: w * 0.02, dy: -h * 0.3, w: w * 0.05, h: h * 0.34, ang: 0.45, role: 'accent' }); // 颊鳍（顺颊斜下，细条）
  } else if (F.ear === 'plateStripe') { // 大平板 + 短划（重型侧面读法）
    parts.push({ t: 'block', dx: -w * 0.12, dy: -h * 0.48, w: w * 0.32, h: h * 0.4, cham: 0.25 });
    parts.push({ t: 'block', dx: -w * 0.14, dy: -h * 0.53, w: w * 0.14, h: h * 0.04, role: 'accent' });
    parts.push({ t: 'block', dx: -w * 0.14, dy: -h * 0.44, w: w * 0.14, h: h * 0.04, role: 'accent' });
  } else if (F.ear === 'earcover') { // 圆耳罩（动力服侧面主导件）：白舱 + 中央小方口——盘件着色偏暗，舱体走大倒角块（装甲白）
    parts.push({ t: 'block', dx: -w * 0.13, dy: -h * 0.46, w: w * 0.27, h: h * 0.31, cham: 0.42 });
    parts.push({ t: 'block', dx: -w * 0.13, dy: -h * 0.46, w: w * 0.075, h: h * 0.075, kind: 'frame' }); // 中央方口
    parts.push({ t: 'block', dx: -w * 0.13, dy: -h * 0.46, w: w * 0.04, h: h * 0.035, role: 'accent' });
  } else if (F.ear === 'disc') { parts.push({ t: 'disc', dx: -w * 0.16, dy: -h * 0.48, r: w * 0.11 }); parts.push({ t: 'disc', dx: -w * 0.16, dy: -h * 0.48, r: w * 0.06 }); }
  else parts.push({ t: 'block', dx: -w * 0.08, dy: -h * 0.48, w: w * 0.3, h: h * 0.4, cham: 0.3 });
  // —— 顶附属：至多一式，根必须压进冠体（自冠体长出，不许浮在外面）
  if (F.top === 'horn') parts.push({ t: 'wing', dx: w * 0.26, dy: -h * 0.8, len: w * 0.37, wRoot: h * 0.11, wTip: h * 0.018, ang: -0.08 }); // 前额角：根在冠前、向前探（细长，不许粗过冠板）
  else if (F.top === 'vfin') {
    parts.push({ t: 'wing', dx: w * 0.22, dy: -h * 0.84, len: w * 0.68, wRoot: h * 0.08, wTip: h * 0.012, ang: -2.05, role: 'accent' }); // 主鳍：根在额上、薄刃长掠
    parts.push({ t: 'wing', dx: -w * 0.04, dy: -h * 0.88, len: w * 0.36, wRoot: h * 0.07, wTip: h * 0.012, ang: -2.5, role: 'accent' }); // 后鳍（同色，短一截）
  }
  else if (F.top === 'antenna') { parts.push({ t: 'block', dx: -w * 0.18, dy: -h * 1.14, w: w * 0.035, h: h * 0.55, kind: 'cyl' }); parts.push({ t: 'disc', dx: -w * 0.18, dy: -h * 1.42, r: w * 0.04 }); parts.push({ t: 'block', dx: -w * 0.3, dy: -h * 1.05, w: w * 0.03, h: h * 0.3, kind: 'cyl' }); parts.push({ t: 'block', dx: w * 0.14, dy: -h * 0.96, w: w * 0.2, h: h * 0.12 }); }
  return { anchors: { seat: spec.seat, eye: { x: spec.seat.x + w * 0.4, y: spec.seat.y - h * 0.5 }, ear: { x: spec.seat.x - w * 0.06, y: spec.seat.y - h * 0.48 }, crown: { x: spec.seat.x, y: spec.seat.y - h } }, parts };
}
function renderHeadIR(cv: MechaCanvas, ir: HeadIR, spec: HeadSpec): Anchors {
  const T = makeLayerTools(cv, spec.seed, spec.blockShape);
  const { A } = T, s = ir.anchors.seat, ca = Math.cos(spec.tilt), sa = Math.sin(spec.tilt);
  const P = (dx: number, dy: number): Pt => ({ x: s.x + dx * ca - dy * sa, y: s.y + dx * sa + dy * ca });
  for (const p of ir.parts) {
    if (p.t === 'block') { const c = P(p.dx, p.dy); const id = T.addBlock(p.kind ?? 'plate', c.x, c.y, p.w, p.h, spec.tilt + (p.ang ?? 0), p.cham ?? 0.36, p.bolts ?? false); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); }
    else if (p.t === 'disc') { const c = P(p.dx, p.dy); T.addDisc(p.kind ?? 'disc', c, p.r); }
    else if (p.t === 'grille') { const c = P(p.dx, p.dy); T.grille(c.x, c.y, p.w, p.h, spec.intakeDepth, 1, 0.1, spec.intakeShare); } // 头部耳侧口：正对面本调 1.0，框斜 0.1
    else if (p.t === 'poly') { const id = T.addPoly(p.pts.map(([dx, dy]) => P(dx, dy)), p.bolts ?? false); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); }
    else if (p.t === 'wing') { const root = P(p.dx, p.dy); const a = spec.tilt + p.ang; const cx = root.x + Math.cos(a) * p.len / 2, cy = root.y + Math.sin(a) * p.len / 2; const id = T.wing(cx, cy, p.len, p.wRoot, p.wTip, a); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); }
    else if (p.t === 'light') { const c = P(p.dx, p.dy); A.lightPts.push(c); }
  }
  T.finish();
  return A;
}
export { SCHEMES, newCanvas, layout, finishRender, legIR, renderIR, makeLayerTools, armIR, renderArmIR, torsoIR, renderTorsoIR, hullIR, renderHullIR, headIR, renderHeadIR };
export type { Scheme, LegSpec, ArmSpec, TorsoSpec, HullSpec, HeadSpec, Anchors, Pt, MechaCanvas };
export { W as MECHA_W, H as MECHA_H };
