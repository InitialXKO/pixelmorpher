// 机甲生成引擎（自 spikes/mecha-part-patterns 研究线移植，PR #88 落地）
// 工厂（owner/u/v 参数图）+ 面式着色渲染 finishRender + 部位 IR 生成器。
import { ANT_GEOM_STD, FACE_DESCENT_STD, FIN_GEOM_STD, HEAD_DRAW_ORDER, HEAD_GEOM, HEAD_GRAPH, HORN_GEOM_STD, type DomeGeom, type FinBaseGeom, type FinGeom, type GLine, type GPart, type HeadStep, type HeadWhen } from './head-geom';
import { ARM_GEOM, ARM_GRAPH, type APart, type ArmScale, type ArmWhen } from './arm-geom';
import { TORSO_GEOM, TORSO_GRAPH, type SegSrc, type TNum, type TPart, type TorsoWhen } from './torso-geom';
import { HULL_GEOM, HULL_GRAPH, type HNum, type HPart, type HullWhen } from './hull-geom';
import { LEG_GRAPH, type LegParam, type LegWhen } from './leg-geom';
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
// 楔拼的合法构造只有一式：绕次级轮廓的楔拱（下方 wedgeArch
// 算子——肩盘、膝盘这类次级轮廓作拱心，楔缝指向轮廓心）。板
// 面上凭空分块的两式都已删净：放射扇形（哈希随机内点放射）
// 与无中心层砌（横层 + 竖节错位 + 逐块色差——即「砌格」换名，
// 同一构造）：缝走向审计与回池读板面分缝都验明，池里板面只
// 有顺边/顺折面的缝、唯一的放射是绕轮廓心的楔拱，两式皆零
// 见证（2026-11-12 用户两度点名后全删；层砌的主犯是把审计的
// 「层线走板框」走向判定偷换成了分块构造的合法性）
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
/** 嵌框算子（识别·算子层）：板面内嵌的矩形框线 = 缝围成的
 * 闭环（沟 + 内壁受光唇），框内可再放一式（漆条/槽）。不是一
 * 块填色方块——框是刻进面的线，宿主面在框内外连续 */
export function regInsetFrame(A: Anchors, inst: number, cx: number, cy: number, w: number, h: number, ang = 0) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const corner = (dx: number, dy: number): Pt => ({ x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca });
  const hw = w / 2, hh = h / 2, lip = 2.5;
  const rect = [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh), corner(-hw, -hh)];
  const inner = [corner(-hw + lip, -hh + lip), corner(hw - lip, -hh + lip), corner(hw - lip, hh - lip), corner(-hw + lip, hh - lip), corner(-hw + lip, -hh + lip)];
  regSeam(A, inst, rect, inner, 0.9, 0.4);
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
/** 路径管算子（形状）：折线距离场成管，v = 到轴线的归一距离。
 * 腿缆/臂缆/躯干缆束此前在三处各写一份同一公式，收敛于此——
 * 构造侧只给点列与半径。距离必须量到线段：旧版量到采样点，
 * 采样间距大于管径时管身断成一串珠（M 轮反向检查实证：腿缆
 * 23 点走全腿、间距过径处全断） */
export function pathTubeTest(pts: Pt[], r: number) {
  return (x: number, y: number): [boolean, number, number] => {
    let m = 1e9;
    if (pts.length === 1) m = Math.hypot(x - pts[0].x, y - pts[0].y);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const ux = b.x - a.x, uy = b.y - a.y, len2 = ux * ux + uy * uy || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ux + (y - a.y) * uy) / len2));
      m = Math.min(m, Math.hypot(x - (a.x + ux * t), y - (a.y + uy * t)));
    }
    return [m <= r, 0, m / r];
  };
}
/** 收分胶囊链算子（形状）：多段变径胶囊的并集（腿结构核）——
 * u = 归一径向距、v = 沿链归一程。构造侧只给段列与半径倍率 */
export function capsuleChainTest(segs: [Pt, Pt, number, number][], rScale = 1) {
  return (x: number, y: number): [boolean, number, number] => {
    let best: [boolean, number, number] = [false, 0, 0];
    for (let si = 0; si < segs.length; si++) {
      const [a, b, ra, rb] = segs[si];
      const ux = b.x - a.x, uy = b.y - a.y, len = Math.hypot(ux, uy) || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ux + (y - a.y) * uy) / (len * len)));
      const d = Math.hypot(x - (a.x + ux * t), y - (a.y + uy * t)), r = (ra + (rb - ra) * t) * rScale;
      if (d <= r) { const uu = d / r, vv = (si + t) / segs.length; if (!best[0] || uu < best[1]) best = [true, uu, vv]; }
    }
    return best;
  };
}
/** 胎面扇区值（轮胎环的着色坐标）：12 扇区交替两值，随滚动相位转 */
export function sectorVal(x: number, y: number, c: Pt, spin: number): number {
  const a = Math.atan2(y - c.y, x - c.x) + spin;
  const sec = Math.floor((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 6));
  return sec % 2 === 0 ? 0.36 : 0.64;
}
/** 环带算子（形状）：圆环带 + 扇区值（轮胎环）。构造侧只给环心与内外径 */
export function annulusTest(c: Pt, rIn: number, rOut: number, spin = 0) {
  return (x: number, y: number): [boolean, number, number] => {
    const d = Math.hypot(x - c.x, y - c.y);
    return d >= rIn && d <= rOut ? [true, (d - rIn) / (rOut - rIn), sectorVal(x, y, c, spin)] : [false, 0, 0];
  };
}
/** 胶囊距：点到水平线段的距离（履带环的几何基） */
function segDistX(x: number, y: number, x0: number, x1: number, cy: number): number {
  const dx = Math.max(x0 - x, 0, x - x1);
  return Math.hypot(dx, y - cy);
}
/** 履带环带算子（形状）：胶囊距落在 [R−band, R] 的环带，v 沿带长（含相位） */
export function capsuleBandTest(x0: number, x1: number, cy: number, R: number, band: number, cx: number, len: number, phase = 0) {
  return (x: number, y: number): [boolean, number, number] => {
    const d = segDistX(x, y, x0, x1, cy);
    if (d < R - band || d > R) return [false, 0, 0];
    return [true, (d - (R - band)) / band, (x + phase - (cx - len / 2)) / len];
  };
}
/** 履带内体算子（形状）：胶囊距 ≤ rFill 的实填，u 按 rNorm 归一，v 沿带长 */
export function capsuleFillTest(x0: number, x1: number, cy: number, rFill: number, rNorm: number, cx: number, len: number, phase = 0) {
  return (x: number, y: number): [boolean, number, number] => {
    const d = segDistX(x, y, x0, x1, cy);
    if (d > rFill) return [false, 0, 0];
    return [true, d / rNorm, (x + phase - (cx - len / 2)) / len];
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
interface LegSpec { /** 髋梁横轴（模式库「髋梁横轴」）：部件集附带梁精灵，支架腿组装配挂它 */ hipBeam?: boolean; /** 支架张开：足相对髋的水平偏移占腿全长比（模式库「支架腿组」，装配双骨解算消费） */ standSplay?: number; /** 支架够达：髋足距占腿全长比（同上） */ standReach?: number; topology: 'standard' | 'reverse'; scheme: Scheme; seed: number; bend: number; camo: boolean; wear?: number; frameHeavy?: boolean; shellMode?: boolean; wScale?: number; /** 小腿宽相对大腿宽的比（缺省 1；人形族按形式语言横读的段长宽比分段定，随 wScale 等比） */ shinWRatio?: number; /** 大腿收分（末宽/首宽，缺省 84/110） */ taperThigh?: number; /** 小腿收分（缺省 64/100） */ taperShin?: number; lift?: number; guardOff?: boolean; detail?: number; ankleShift?: number; cableTint?: RGB; decalKind?: 'num' | 'plate' | 'none'; coreScale?: number; footType?: 'blocks' | 'shoe' | 'claw' | 'pad' | 'wheel'; /** 膝盖块厚度系数（用户可调，默认 1） */ kneeScale?: number; /** 腓肠隆起系数（用户可调，默认 1） */ calfScale?: number; /** 胫骨凹面深度系数（用户可调，默认 1；0 = 前缘不凹） */ shinConcave?: number; /** 履带相位帧专用：皮带行程 px，圆盘 pass 按同心最大半径折算转角（其余画布不设、零影响） */ beltPhase?: number; /** 轮足相位帧专用：轮行程 px，毂盘按胎外径折算转角、胎环扇区随之移（仅轮足画布设） */ wheelPhase?: number; /** 高光棱模式开关（着色算子「高光棱」）：默认开；关时棱线 pass 不画、面着色公式对登记件保持跳过（无第二实现） */ ridges?: boolean; /** 缝模式开关（着色算子「缝」）：默认开；关时缝 pass 不画 */ seams?: boolean; /** 缝宽倍率（缝算子的族档位）：登记宽一律在缝 pass 处乘此值——同尺寸下主战/重型粗沟、敏捷细线，宽度是族数据不是跨度副产物（未设 1） */ seamScale?: number; /** 接触缝合成（头部专用）：收尾时按 owner 图把后画件压先画件的接触边合成登记给缝 pass——头部板界由此成为缝、seamScale 对头生效（其余画布不设、零影响） */ stackSeams?: boolean; /** 描边链开关（模式库「描边链」条目）：默认开；关时末尾描边 pass 不画 */ outline?: boolean; /** 暗沿量（模式库「暗沿」算子）：背光侧（下/后）剪影内一像素暗带的压暗量，0/未设 = 不画 */ darkRim?: number; /** 黑隙量（模式库「黑隙」算子）：后件在与前件相接的一行像素上的压暗量，0/未设 = 不画 */ blackGap?: number; /** 料厚比（着色算子「料厚」）：件端料厚 = 件厚 × 此比，默认 0.32 */ thickRatio?: number; /** 双色交替（板按序号奇偶交替 armor/armor2）：false = 全板走 armor，副色只由漆带/嵌板等显式件承担（敏捷腿：蓝是带与嵌板、不是整板） */ altTone?: boolean; /** 壳面从简：段板不带横向刻线/斜线/T 接头，只留纵缝（敏捷腿：长壳面干净，横线只在构造分段处） */ panelSparse?: boolean; /** 小腿沿轴副色带（敏捷：白壳上的一条蓝带，顺小腿前缘走） */ shinBand?: boolean; /** 小腿前壳面深蓝嵌板（敏捷：嵌板租户） */ shinInset?: boolean; /** 小腿前脸整幅副色板（动力服：橙是随身大图形面，胫前整幅橙板，与橙靴同档） */ shinPanel?: boolean; /** 大腿前幅副色板（动力服：橙的用量档位与胫板/肩穹同档，大腿前幅整面橙、后界沿段扫下——曲面语言过腰不断） */ thighPanel?: boolean; /** 机械收敛（三族人形缺省）：壳后不留铬活塞组——大腿后无杆、小腿后只一根深色细杆贴壳后缘，机械藏进壳里，密度让给壳面（横读三样本定版） */ mechSlim?: boolean; /** 小腿后单铬活塞（重型方言：池图重型 + m3 双见证——缸筒在上、亮杆直达踝盘；置真时取代 mechSlim 的深色细杆，大腿后仍无杆） */ shinPiston?: boolean; /** 栓/毂是算子组合不是整式开关（着色算子 boltframe/boltcore/hubgroove/hubframe 四个叶子）：栓框（方/环/无）× 栓芯（暗点/半球）自由组合——方口 = 方框+暗芯、圆环 = 环框+暗芯、半球栓 = 无框+半球芯；毂槽（对角深槽）与毂框（方框轮廓）各自独立、与毂面着色叠加 */ boltFrame?: 'square' | 'ring' | 'none'; boltCore?: 'dark' | 'dome'; hubGroove?: boolean; hubFrame?: 'square';
  /** 进气口模式参数（着色算子 intake，着色模式步）：
   * topTone/topGrad=顶面朝向倍率与沿深轴落差、rim=腔内上影高占比、
   * pitch=叶片节距 px、peak=叶片亮峰位置、fall=横向落光、accentSlats=
   * 叶片用强调色（荚口变体；胸口为金属叶片）。装口面倍率是构造侧按
   * 站点斜向给的（登记 ftone），不在此 */
  intake?: { rim?: number; pitch?: number; peak?: number; fall?: number; accentSlats?: boolean; topTone?: number; topGrad?: number; slatTone?: number; slatBlue?: number } }
interface Anchors {
  plateTint: Map<number, number>; panelLines: Map<number, number[]>;
  boltPts: Pt[]; ventId: number; guardId: number; stripeId: number;
  decalPos: Pt; numPos: Pt; numText: string; lightPts: Pt[];
  /** 发光组合登记（模式库「发光」）：座 = 定向矩形（中心/半宽高/旋转），pts = 亮芯点列；着色 pass 按座框裁剪亮芯——亮只许在座内 */ glows?: { cx: number; cy: number; hw: number; hh: number; cos: number; sin: number; pts: (Pt & { s?: number })[] }[];
  /** 压覆登记（模式库「黑隙」）：构造时声明「本件压在别的件上」的件 id 集——黑隙 pass 据此在被压件一侧画黑缝（板压板靠登记区分于同件拼贴界） */ pressIds?: Set<number>;
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
  /** 高光棱模式（着色算子「高光棱」）：一切高光棱在此登记，
   * 着色层的高光棱 pass 逐条调用高光算子在件自身像素上画。
   * pts=棱线折线；tone=提亮倍率；登记过的件进 ridgeMode，其面
   * 着色公式内的旧棱线项跳过。开关在规格层（LegSpec.ridges） */
  ridges?: { inst: number; pts: Pt[]; tone: number; noThick?: boolean; panel?: boolean; thick?: boolean }[];
  /** 料厚模式（着色算子「料厚」）：登记走 regThickness——它
   * 把棱线的高光代登记给高光棱模式（料厚模式调用高光棱模式），
   * 带面本身（棱线前侧 faceW 宽、faceTone 平色差）归本表、由
   * 料厚 pass 画。wedgeBandsAuto 与切面抑制都读本表 */
  thickBands?: { inst: number; pts: Pt[]; faceW: number; faceDx?: number; faceDy?: number; faceTone?: number; noThick?: boolean }[];
  /** 缝模式（着色算子「缝」）：登记走 regSeam——一道沟 +
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
  polyPts?: Map<number, Pt[]>;
  ridgeMode?: Set<number>;
  /** 轮足毂心 + 胎外径（圆盘 pass 按胎外径折算毂盘转角用；仅轮足布局登记） */
  wheelHubs?: { c: Pt; r: number }[];
}
/** 腿算子帧：layout 原先的隐式闭包帧改成显式上下文——腿算子是
 * 模块级命名函数、只经帧交接（与头部 HeadCtx 同口径）。id 是部件
 * 登记序（fillShape 的实例号），rnd 是本腿的随机流（按步序消费、
 * 消费次序即出图，不许乱序） */
interface LegFrame {
  cv: MechaCanvas; spec: LegSpec; std: boolean;
  hip: Pt; knee: Pt; ankle: Pt; toeX: number;
  ws: number; wsS: number; dF: number;
  thigh: { a: Pt; b: Pt; wA: number; wB: number; bulge: Bulge };
  shin: { a: Pt; b: Pt; wA: number; wB: number; bulge: Bulge };
  A: Anchors; rnd: () => number; id: number;
  /** 缆下垂量（帧派生：种子与护板有无定，缆算子只消费帧值） */
  sag: number;
}

function makeLegFrame(cv: MechaCanvas, spec: LegSpec, pre: { hip: Pt; knee: Pt; ankle: Pt; toeX: number }): LegFrame {
  const rnd = mulberry32(spec.seed);
  const std = spec.topology === 'standard';
  const hip: Pt = pre.hip;
  const knee: Pt = pre.knee;
  const ankle: Pt = pre.ankle;
  const toeX = pre.toeX;
  const ws = spec.wScale ?? 1;
  const wsS = ws * (spec.shinWRatio ?? 1);
  const dF = spec.shinWRatio !== undefined ? (ws + wsS) / 2 : 1;
  const thigh = { a: hip, b: knee, wA: 110 * ws, wB: spec.taperThigh !== undefined ? 110 * ws * spec.taperThigh : 84 * ws, bulge: { f: 0.16, b: 0.05 } };
  // 小腿去人形化（用户定）：腓肠（后隆起）夸张、前缘（胫骨侧）改凹
  // ——人腿是前直后胀的平滑曲线，机甲腿要前凹后凸的机械剖面；
  // 两者都是用户可调参数（calfScale / shinConcave，默认 1）
  const shin = { a: knee, b: ankle, wA: 100 * wsS, wB: spec.taperShin !== undefined ? 100 * wsS * spec.taperShin : 52 * wsS, bulge: { f: -0.38 * (spec.shinConcave ?? 1), b: 0.42 * (spec.calfScale ?? 1) } }; // wB 64→52：小腿渐细（形态关系）——参考小腿膝/踝宽比约 0.5、产品原 0.64 且踝端构件再加宽，整段读成等宽板；收末端宽使锥形读出来（护板/腓肠/活塞的偏移全走 wA→wB 插值，自动跟随）
  // 剪影
  const A: Anchors = { plateTint: new Map(), panelLines: new Map(), boltPts: [], ventId: -1, guardId: -1, stripeId: -1, decalPos: { x: 0, y: 0 }, numPos: { x: 0, y: 0 }, numText: '', lightPts: [], discs: [], chevrons: [], seamU: new Map(), insignia: { pos: { x: 0, y: 0 }, kind: 0 }, stripeThigh: -1, blockPlates: new Set(), deviceFrame: null, chevDecal: true, shinIds: new Set(), stripeSegs: [], panelDiag: new Map(), panelTee: new Map(), decalKind: 'num', toeFace: null, colorRole: new Map() };
  return { cv, spec, std, hip, knee, ankle, toeX, ws, wsS, dF, thigh, shin, A, rnd, id: 0, sag: (spec.seed % 4) * 3 + (spec.guardOff ? 3 : 0) };
}

/** 腓肠表面相对默认（bulge.b = 0.42）的外移量：背侧附件（导轨/
 * 排气/挂盒/线缆）按它跟随，腓肠参数变化时不埋进也不飘离表面 */
function calfDeltaOf(shin: LegFrame['shin'], t: number): number {
  return ((shin.wA + (shin.wB - shin.wA) * t) / 2) * (shin.bulge.b - 0.42) * bumpAt(t, 0.34);
}

/** 剪影包络：段包络 + 关节盘 + 足基（部件探出包络的部分在走步后并入） */
function markLegSilhouette(F: LegFrame): void {
  const { cv, thigh, shin, hip, knee, ankle, toeX, dF } = F;
  const segProf = (t: number) => (1 - 0.13 * Math.exp(-((t / 0.09) ** 2)) - 0.13 * Math.exp(-(((1 - t) / 0.09) ** 2))) * (t > 0.52 ? 0.95 : 1);
  for (const s of [thigh, shin]) markSil(cv, silQuad(s.a, s.b, s.wA, s.wB, 2, { f: s.bulge.f * 0.5, b: s.bulge.b * 0.5 }, segProf)); // 包络隆起减半：原隆起全量是过 claim（板面才是外表面）
  for (const [j, r] of [[hip, 36], [knee, 34], [ankle, 21]] as [Pt, number][]) markSil(cv, (x, y) => Math.hypot(x - j.x, y - j.y) <= r * dF);
  markSil(cv, silQuad({ x: ankle.x - 8, y: 448 }, { x: toeX, y: 458 }, 38, 30, 2));
}
  // 切角块多边形（关节壳体/毂块/脚块共用）
  const blockPoly = (cx: number, cy: number, w: number, h: number, ang: number, cham: number): Pt[] => {
    const ca = Math.cos(ang), sa = Math.sin(ang), lx = w / 2, ly = h / 2, c = (Math.min(w, h) * cham) / 2;
    const raw: Pt[] = [
      { x: -lx + c, y: -ly }, { x: lx - c, y: -ly }, { x: lx, y: -ly + c }, { x: lx, y: ly - c },
      { x: lx - c, y: ly }, { x: -lx + c, y: ly }, { x: -lx, y: ly - c }, { x: -lx, y: -ly + c },
    ];
    return raw.map((q) => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
  };
function addPlate(F: LegFrame, a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap: number, cutA: number, cutB: number, kind: Kind = 'plate', bulge: Bulge = { f: 0, b: 0 }, clipFn?: (x: number, y: number) => boolean) {
    // 独立成廓：每块板绕自身中心微转 + 横移 + 出边，轮廓在接缝处出天然台阶
    const js = (F.spec.shellMode ? 0.4 : 1) * (kind === 'foot' ? 0.5 : 1);
    const jit = (F.rnd() - 0.5) * 6.4 * js, rot = (F.rnd() - 0.5) * 0.11 * js, proud = 1 + (0.02 + F.rnd() * 0.1) * js;
    const f0 = segFrame(a, b), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const rotPt = (p: Pt): Pt => {
      const dx = p.x - mx, dy = p.y - my;
      return { x: mx + dx * Math.cos(rot) - dy * Math.sin(rot) + f0.px * jit, y: my + dx * Math.sin(rot) + dy * Math.cos(rot) + f0.py * jit };
    };
    const a2 = rotPt(a), b2 = rotPt(b);
    // 逐块形状：四角切角量（3/10 近直角，其余大切角）+ 侧边台阶
    const hwAvg = (wA + wB) / 4, shScale = kind === 'foot' ? 0.5 : 1;
    const cham = () => (F.rnd() < 0.3 ? F.rnd() * 5 : (0.2 + F.rnd() * 0.8) * hwAvg * 0.9) * shScale;
    const shape: PlateShape = { cTF: cham(), cTB: cham(), cBF: cham(), cBB: cham(), step: F.rnd() < 0.4 ? (F.rnd() - 0.5) * 14 : 0, stepPos: 0.3 + F.rnd() * 0.4 };
    const wrapClip = (t: (x: number, y: number) => [boolean, number, number]) => clipFn ? (x: number, y: number): [boolean, number, number] => { const r = t(x, y); return r[0] && !clipFn(x, y) ? r : [false, 0, 0] as [boolean, number, number]; } : t;
    if (kind === 'plate') { // 板衬边：同形宽 ×1.05 的框垫片，属板组件
      F.cv.insts.push({ kind: 'frame' });
      fillShape(F.cv, F.id, wrapClip(plateTest(a2, b2, wA * proud * 1.05, wB * proud * 1.05, Math.max(0, t0 - 0.008), Math.min(1, t1 + 0.008), 0, cutA, cutB, bulge, shape))); F.id++;
    }
    F.cv.insts.push({ kind }); const myId = F.id;
    fillShape(F.cv, F.id, wrapClip(plateTest(a2, b2, wA * proud, wB * proud, t0, t1, gap, cutA, cutB, bulge, shape))); F.id++;
    F.A.plateTint.set(myId, [0.78, 0.9, 1.0, 1.1, 1.24][Math.floor(F.rnd() * 5)]);
    const lines: number[] = []; const dtl = F.spec.detail ?? 1;
    const sparse = (F.spec as LegSpec).panelSparse;
    const n = sparse ? 0 : dtl < 0.7 ? (F.rnd() < 0.55 ? 0 : 1) : dtl > 1.1 ? 2 + Math.floor(F.rnd() * 2) : 1 + Math.floor(F.rnd() * 2);
    for (let k = 0; k < n; k++) lines.push(0.3 + F.rnd() * 0.45);
    F.A.panelLines.set(myId, lines);
    F.A.seamU.set(myId, -0.42 + F.rnd() * 0.84); // 竖向面板缝位置
    if ((F.spec as LegSpec).shellMode && F.rnd() < 0.45) F.A.blockPlates.add(myId); // 人形壳：色块板
    if (!sparse && F.rnd() < 0.3) F.rnd(); // 随机斜置已废（缝走向审计 2026-11-12：横线只许平行板端边——平行族；随机倾斜在参考池零见证）：随机流照常消费，只是不登记
    if (!sparse && F.rnd() < 0.35) F.A.panelTee.set(myId, -0.5 + F.rnd()); // T 型接头竖线位置
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
      (F.A.ridgeMode ??= new Set()).add(myId);
      const h2 = (((myId * 40503 + 7) >>> 0) % 100) / 100, h3 = (((myId * 2246822519) >>> 0) % 100) / 100;
      if (h3 >= 0.3) (F.A.ridges ??= []).push({ inst: myId, pts: lineAtU(0.15 + h2 * 0.5, 0.05, 0.95), tone: 1.15 }); // 主折线亮棱
      const dg = F.A.panelDiag.get(myId) ?? 0;
      for (const lv of lines) { // 刻线下唇受光
        const tF = t0 + (lv + dg * -1 * 0.45 + 0.017) * (t1 - t0), tB = t0 + (lv + dg * 1 * 0.45 + 0.017) * (t1 - t0);
        (F.A.ridges ??= []).push({ inst: myId, pts: [ptAt(tF, -hwAt(tF, true) * 0.97), ptAt(tB, hwAt(tB, false) * 0.97)], tone: 1.17, panel: true });
      }
      const su = F.A.seamU.get(myId); // 竖缝前侧受光唇
      if (su !== undefined) (F.A.ridges ??= []).push({ inst: myId, pts: lineAtU(su - 0.034, 0.14, 0.86), tone: 1.15, panel: true });
    }
    // 铆钉点：沿板两侧缘（跟随抖动后的板框）
    const f = segFrame(a2, b2);
    for (const vv of [0.14, 0.5, 0.86]) for (const ss of [-0.8, 0.8]) {
      const t = t0 + (t1 - t0) * vv, hw = ((wA + (wB - wA) * t) / 2) * proud;
      F.A.boltPts.push({ x: a2.x + f.ux * f.len * t + f.px * hw * ss, y: a2.y + f.uy * f.len * t + f.py * hw * ss });
    }
    return myId;
  }
function backOf(F: LegFrame, s: { a: Pt; b: Pt }, t: number, off: number): Pt {
    const f = segFrame(s.a, s.b);
    const sgn = F.std ? 1 : -1;
    return { x: s.a.x + f.ux * f.len * t + f.px * off * sgn, y: s.a.y + f.uy * f.len * t + f.py * off * sgn };
  }
function segPlates(F: LegFrame, seg: { a: Pt; b: Pt; wA: number; wB: number; bulge: Bulge }, clipFn?: (x: number, y: number) => boolean): number[] {
    // 段板：种子不等分 2–3 块，每块独立宽缩放/收分/切角/间隙
    const fw = F.spec.frameHeavy ? 0.68 : 1;
    const fg = F.spec.shellMode ? 1.4 : F.spec.frameHeavy ? 8.5 : 5;
    const n = F.spec.shellMode ? 2 : (F.rnd() < 0.35 ? 3 : 2);
    const cuts: number[] = [0.006];
    if (n === 2) cuts.push(0.3 + F.rnd() * 0.38);
    else { const c1 = 0.18 + F.rnd() * 0.2; cuts.push(c1, c1 + 0.24 + F.rnd() * 0.26); }
    cuts.push(0.996);
    const ids: number[] = [];
    for (let k = 0; k < n; k++) {
      const sA = (0.97 + F.rnd() * 0.28) * fw, sB = (0.97 + F.rnd() * 0.28) * fw; // 逐块独立宽与收分（v29 宽度分布整体上移，保形态扩）
      ids.push(addPlate(F, seg.a, seg.b, seg.wA * sA, seg.wB * sB, cuts[k], cuts[k + 1], fg * (0.6 + F.rnd() * 1.1), F.rnd() * 24, F.rnd() * 24, 'plate', seg.bulge, clipFn));
    }
    return ids;
  }
  // 小腿板止于压块套靠指尖一侧的端边：套整体是斜的、该端是一条边，
  // 板角越过这条边就成了挂在边上的孤角。按套的局部坐标盒裁小腿板
  // （含衬边）——盒内其余位置本就被压块/连带盖住、裁掉不可见，
  // 只有越界的角被收回（套的几何与 §5 同一数据：D=50、主线 -0.40）
function shinClip(F: LegFrame, x: number, y: number): boolean {
    const D = 50, HS = (F.spec.wScale ?? 1) >= 1.3 ? 1.12 : 1, LA = -0.40;
    const dx = Math.cos(LA), dy = Math.sin(LA), nx = -dy, ny = dx;
    const scx = F.ankle.x + dx * 0.62 * D, scy = F.ankle.y + dy * 0.62 * D;
    const u = dx * (x - scx) + dy * (y - scy), v = nx * (x - scx) + ny * (y - scy);
    const hl = 0.95 * D * HS / 2, ht = 0.58 * D / 2;
    return u > hl - 4 && u < hl + 30 && v > -ht - 18 && v < ht + 18;
  }
  // 活塞帮手提前定义：小腿活塞要在段板之前画（见下）
function piston(F: LegFrame, a: Pt, b: Pt, rC = 10, rR = 5.5): void {
    const mid = { x: a.x + (b.x - a.x) * 0.5, y: a.y + (b.y - a.y) * 0.5 };
    F.cv.insts.push({ kind: 'cyl' }); const pcId = F.id; fillShape(F.cv, F.id, lineTest(a, mid, rC)); F.id++;
    regCylHoops(F.A, pcId, a, mid, rC); // 缸筒环带是箍：登记给缝模式
    F.cv.insts.push({ kind: 'rod' }); fillShape(F.cv, F.id, lineTest(mid, b, rR)); F.id++;
    for (const e of [a, b]) { F.cv.insts.push({ kind: 'cyl' }); fillShape(F.cv, F.id, discTest(e, rC * 0.9)); F.id++; }
  }
  // —— 腿模板（legIR 的 MechaIR 部件列）即本函数的图：步序 =
  // 画序，模式选择与条件全在模板数据里（legIR 按规格生成部件
  // 列）。下面每个算子是模板点名的一个模式，共享本函数的帧与
  // 帮手（addPlate/segPlates/backOf/piston），随机流按步序消费、
  // 与旧单体同序。layout 不再自存装配决定：给它换一份部件列，
  // 它就按那份列画。
/** 杂物小盒（切角块）：膝前盒与小腿后挂盒共用一份画法（算子本体） */
function legBox(F: LegFrame, cx: number, cy: number, w: number, h: number): void {
  F.cv.insts.push({ kind: 'plate' }); const bid = F.id;
  const cc = Math.min(w, h) * 0.24, x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  fillShape(F.cv, F.id, polyTest([{ x: x0 + cc, y: y0 }, { x: x1 - cc, y: y0 }, { x: x1, y: y0 + cc }, { x: x1, y: y1 - cc }, { x: x1 - cc, y: y1 }, { x: x0 + cc, y: y1 }, { x: x0, y: y1 - cc }, { x: x0, y: y0 + cc }])); F.id++;
  F.A.plateTint.set(bid, 0.94); F.A.panelLines.set(bid, []);
}

function legOp_foot(F: LegFrame, part: MechaIR['parts'][number]): void {
  // 5) 脚：跟块/掌块/趾块（切角块组，与全图同一套块语言）
  const footBlock = (cx: number, cy: number, w: number, h: number, ang: number, cham = 0.38, seam?: number, role?: string) => {
    F.cv.insts.push({ kind: 'foot' }); const bid = F.id;
    const bp = blockPoly(cx, cy, w, h, ang, cham);
    fillShape(F.cv, F.id, polyTest(bp)); F.id++;
    if (role) (F.A.colorRole ??= new Map()).set(bid, role);
    F.A.plateTint.set(bid, [0.9, 1.0, 1.08][Math.floor(F.rnd() * 3)]);
    F.A.panelLines.set(bid, [0.5]);
    polyLip(F.A, bid, bp, 0.5);
    if (seam !== undefined) { F.A.seamU.set(bid, seam); polySeamLip(F.A, bid, bp, seam); } // 趾帽竖缝
  };
  // 足（v29 四型，全由有厚度的块组成；底面标高 470，块顶分级下行、块间叠压相接）
  const ft = FOOT_TYPE[part.pattern as keyof typeof FOOT_TYPE] ?? 'blocks';
  if (ft === 'claw') {
    // 分趾爪足：基座块 + 前趾两节 + 后趾两节（趾块带转角下探、远节贴地）
    footBlock(F.ankle.x, 446, 46, 24, 0.05);
    footBlock(F.ankle.x + 30, 452, 52, 19, 0.4);
    footBlock(F.ankle.x + 68, 463, 46, 14, 0.06, 0.5);
    footBlock(F.ankle.x - 29, 452, 46, 18, -0.4);
    footBlock(F.ankle.x - 60, 463, 40, 13, -0.06, 0.5);
  } else if (ft === 'pad') {
    // 宽掌垫足：宽平基座 + 前段块 + 跟块（低矮、掌面宽）
    footBlock((F.ankle.x + F.toeX) / 2 + 4, 460, F.toeX - F.ankle.x + 62, 20, 0.01, 0.3);
    footBlock(F.toeX - 8, 449, 56, 23, 0.02, 0.45);
    footBlock(F.ankle.x - 20, 455, 44, 16, 0.03);
  } else if (ft === 'wheel') {
    // 轮足（据生成参考）：踝毂整流罩 + 主轮（胎环+毂盘+毂盖）+ 后小轮
    // + 减震杆（小腿→两毂）+ 后稳定橇；轮底与足底同高（470）
    footBlock(F.ankle.x + 10, 416, 64, 34, 0.06); // 踝毂罩：跨踝关节
    footBlock(F.ankle.x + 24, 426, 46, 20, 0.45); // 毂臂：踝→主轮毂斜撑
    { F.cv.insts.push({ kind: 'disc' }); fillShape(F.cv, F.id, discTest(F.ankle, 13)); F.id++; }
    const hubM = { x: F.ankle.x + 34, y: 426 }, hubR = { x: F.ankle.x - 44, y: 440 };
    // 滚动相位：轮图样是 12 扇区旋转对称（有限群一圈只有 12 个等价位），
    // 转角按胎外径折算（行程/半径）；胎环扇区分带与毂盘刻面同相位转
    const spinM = (F.spec.wheelPhase ?? 0) / 44, spinR = (F.spec.wheelPhase ?? 0) / 30;
    (F.A.wheelHubs ??= []).push({ c: hubM, r: 44 }, { c: hubR, r: 30 });
    { F.cv.insts.push({ kind: 'frame' }); fillShape(F.cv, F.id, annulusTest(hubM, 30, 44, spinM)); F.id++; } // 主轮胎环
    { F.cv.insts.push({ kind: 'disc' }); const did = F.id; fillShape(F.cv, F.id, discTest(hubM, 30, spinM)); F.A.discs.push({ id: did, c: hubM, r: 30, hv: F.A.discs.length % 3 }); F.id++; }
    { F.cv.insts.push({ kind: 'disc' }); const did = F.id; fillShape(F.cv, F.id, discTest(hubM, 15, spinM)); F.A.discs.push({ id: did, c: hubM, r: 15, hv: F.A.discs.length % 3 }); F.id++; }
    { F.cv.insts.push({ kind: 'frame' }); fillShape(F.cv, F.id, annulusTest(hubR, 20, 30, spinR)); F.id++; } // 后轮胎环
    { F.cv.insts.push({ kind: 'disc' }); const did = F.id; fillShape(F.cv, F.id, discTest(hubR, 20, spinR)); F.A.discs.push({ id: did, c: hubR, r: 20, hv: F.A.discs.length % 3 }); F.id++; }
    { F.cv.insts.push({ kind: 'disc' }); const did = F.id; fillShape(F.cv, F.id, discTest(hubR, 9, spinR)); F.A.discs.push({ id: did, c: hubR, r: 9, hv: F.A.discs.length % 3 }); F.id++; }
    { F.cv.insts.push({ kind: 'rod' }); fillShape(F.cv, F.id, lineTest({ x: F.ankle.x - 2, y: 372 }, hubM, 4)); F.id++; } // 减震杆
    { F.cv.insts.push({ kind: 'rod' }); fillShape(F.cv, F.id, lineTest({ x: F.ankle.x - 8, y: 388 }, hubR, 3)); F.id++; }
    footBlock(F.ankle.x - 88, 466, 26, 8, 0.08); // 后稳定橇
  } else {
    // 重装/主战足型（blocks，据两张参考高清裁图提取）：跟块 + 两级长板
    // 趾（顶面逐级下行、底面共一线）+ 脚背斜板（自踝盘上方斜下前方、
    // 前端压住中趾板）。旧构造的问题：脚背是近水平的横条、趾段是
    // 一掌一趾两块短块——参考里是两级长板与真斜板。
    const heavy = (F.spec.wScale ?? 1) >= 1.3;
    if (ft === 'shoe') {
      { // 踝上整流罩：靴筒块（shoe 专用，敏捷鞋形另有其式）
        F.cv.insts.push({ kind: 'plate' }); const fid = F.id;
        const fp = blockPoly(F.ankle.x + 38, 427, 96, 30, 0.12, 0.35);
        fillShape(F.cv, F.id, polyTest(fp)); F.id++;
        F.A.plateTint.set(fid, 0.95); F.A.panelLines.set(fid, [0.5]);
        polyLip(F.A, fid, fp, 0.5);
      }
      { F.cv.insts.push({ kind: 'frame' }); fillShape(F.cv, F.id, polyTest(blockPoly((F.ankle.x + F.toeX) / 2 + 1, 466, F.toeX - F.ankle.x + 70, 12, 0, 0.3))); F.id++; } // 足底件
      footBlock(F.ankle.x - 24, 455, 64, 34, 0.04, 0.38, undefined, 'armor'); // 跟块（顶 438）
      footBlock(F.ankle.x + 34, 457, 96, 26, -0.045, 0.3, undefined, 'armor'); // 鞋身块：微转，顶边略斜（鞋身是主色，副色只在趾帽——参考鞋形足）
      footBlock(F.toeX + 18, 462, 36, 16, 0.01, 0.55, 0.55, 'accent'); // 趾帽块：只占趾尖（参考蓝只在趾尖前脸；原 62 宽整段饱和蓝读作脱落的蓝砖）
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
        F.cv.insts.push({ kind: 'foot' }); const bid = F.id;
        const pts = jagPoly(cx, cy, len, thick, ang, cuts);
        fillShape(F.cv, F.id, polyTest(pts)); F.id++;
        F.A.plateTint.set(bid, tint); F.A.panelLines.set(bid, [0.5]);
        polyLip(F.A, bid, pts, 0.5);
      };
      // 板类件（压块套/压块/折面）
      const blkP = (cx: number, cy: number, len: number, thick: number, ang: number, cuts: { ft?: number; fb?: number; bt?: number; bb?: number }, tint: number, panel = true) => {
        F.cv.insts.push({ kind: 'plate' }); const bid = F.id;
        const pts = jagPoly(cx, cy, len, thick, ang, cuts);
        fillShape(F.cv, F.id, polyTest(pts)); F.id++;
        F.A.plateTint.set(bid, tint); if (panel) F.A.panelLines.set(bid, [0.5]);
        if (panel) polyLip(F.A, bid, pts, 0.5);
      };
      // 接地趾：平顶块（顶平、底面坐 GY、逐级下行是标注读数）。
      // 后缘上端前倾是相邻趾块相抵的缝（标注读数）；前端斜面是趾帽
      // 折面（两参考每趾都有），不是装饰切口；
      // 其余角保持完整。此前借 jagPoly 出图、切口只剩 1–6px，图上
      // 就是矩形（四边形退化的一处）
      const toeG = (x0: number, len: number, thick: number, tint: number) => {
        const ch = thick * 0.18, rc = thick * 0.12, fi = thick * 0.08; // 切口收到缝级（原 ch/rc/fi 叠加成黑楔、趾读作三块散板；参考趾是连续体+缝线）
        F.cv.insts.push({ kind: 'foot' }); const bid = F.id;
        const tp = [
          { x: x0 + rc * 0.4, y: GY }, { x: x0 + len - fi, y: GY },
          { x: x0 + len, y: GY - thick + ch }, { x: x0 + len - ch, y: GY - thick },
          { x: x0 + rc, y: GY - thick }, { x: x0, y: GY - thick + rc },
        ];
        fillShape(F.cv, F.id, polyTest(tp)); F.id++;
        F.A.plateTint.set(bid, tint); F.A.panelLines.set(bid, [0.5]);
        polyLip(F.A, bid, tp, 0.5);
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
        F.cv.insts.push({ kind: 'foot' }); const bid = F.id;
        fillShape(F.cv, F.id, polyTest(poly)); F.id++;
        F.A.plateTint.set(bid, tint);
        return bid;
      };
      const ax = F.ankle.x, ay = F.ankle.y;
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
        regThickness(F.A, bid, [p0, p1], 1.35, { faceW: 10, faceTone: 1.22 });
        (F.A.ridgeMode ??= new Set()).add(bid);
      }
      toeG(F.ankle.x + 0.52 * D, 0.98 * D * HS, 0.52 * D, 1.02);
      toeG(F.ankle.x + 1.44 * D, 0.86 * D * HS, 0.46 * D, 0.93);
      const toe3Front = F.ankle.x + 2.24 * D + 0.80 * D * HS;
      toeG(F.ankle.x + 2.24 * D, 0.80 * D * HS, 0.56 * D, 1.07); // 趾3 顶明显高于趾2（用户定）：厚 0.56D，顶 442（趾2 顶 447、趾1 顶 444）——前趾是全列最高块
      F.A.toeFace = { x0: Math.round(toe3Front - 0.17 * D), y0: Math.round(GY - 0.34 * D), x1: Math.round(toe3Front - 0.03 * D), y1: Math.round(GY - 0.06 * D) };
      // 跟块：楔块平坐地。顶边两段——靠盘陡升段沿主线（FT→BK），
      // 其后浅段（BK→RT）向后缓降；FT = 顶边触盘点
      const FT = { x: F.ankle.x - 0.15 * D, y: F.ankle.y + 0.1 * D };
      {
        const BK = { x: FT.x - dir.x * 0.42 * D, y: FT.y - dir.y * 0.42 * D };
        const RT = { x: BK.x - 0.95 * D * HS, y: BK.y + 0.10 * D };
        F.cv.insts.push({ kind: 'foot' }); const bid = F.id;
        fillShape(F.cv, F.id, polyTest([
          { x: FT.x - 6, y: FT.y + 9 }, { x: FT.x + 2, y: FT.y }, { x: BK.x + 3, y: BK.y - 2 },
          { x: RT.x + 8, y: RT.y + 2 }, { x: RT.x, y: RT.y + 6 }, { x: RT.x - 7, y: GY },
          { x: F.ankle.x - 0.05 * D, y: GY }, { x: FT.x - 3, y: FT.y + 17 },
        ])); F.id++;
        F.A.plateTint.set(bid, 0.95);
        F.A.boltPts.push({ x: (BK.x + RT.x) / 2, y: (BK.y + RT.y) / 2 + 12 }); // 跟块面上一颗栓（参考两张都有）
      }
      // 模式「压块总成」（模式库 L1·足型子构造）：一条主线
      // （LINE_ANG，标注定版）贯穿跟块陡升段—盘心—压块顶边；踝前
      // 小套环是主线在盘对面的落点（套心 = 盘心沿主线 0.62D）；
      // 压块顶边贴主线、自 0.98D 处向前上行、主面一块，前端料厚
      // 以高光棱表示（模式库「料厚」条目，非独立件）
      {
        const scx = F.ankle.x + dir.x * 0.62 * D, scy = F.ankle.y + dir.y * 0.62 * D;
        blkP(scx, scy, 0.95 * D * HS, 0.58 * D, LINE_ANG, { bt: 0.25, bb: 0.35, fb: 0.20 }, 1.02);
        F.A.boltPts.push({ x: scx, y: scy });
      }
      {
        const slabLen = 1.45 * D * HS, slabThick = 0.8 * D, slabRear = 0.98 * D;
        const mx = F.ankle.x + dir.x * (slabRear + slabLen / 2), my = F.ankle.y + dir.y * (slabRear + slabLen / 2);
        const slabCx = mx + nrm.x * slabThick / 2, slabCy = my + nrm.y * slabThick / 2;
        const slabId = F.id;
        blkP(slabCx, slabCy, slabLen, slabThick, LINE_ANG, { bb: 0.30, ft: 0.30, fb: 0.15 }, 0.95, false);
        F.A.boltPts.push({ x: mx - dir.x * slabLen * 0.14 + nrm.x * slabThick * 0.68, y: my - dir.y * slabLen * 0.14 + nrm.y * slabThick * 0.68 }); // 压块面低处一颗栓（参考两张都有）
        // 前端料厚以高光棱表示（用户定：厚度是画高光棱表示的、
        // 不是个块）：棱线离前端边一个料厚、与前端边平行，登记给
        // 着色层在压块自身像素上画——棱线提亮、线至边间平色差
        {
          const hl = slabLen / 2, ht = slabThick / 2, cA = Math.cos(LINE_ANG), sA = Math.sin(LINE_ANG);
          const rot = (lx: number, ly: number): Pt => ({ x: slabCx + lx * cA - ly * sA, y: slabCy + lx * sA + ly * cA });
          const fT0 = rot(hl, -ht + slabThick * 0.30 * 0.75), fB0 = rot(hl - slabThick * 0.15, ht);
          const w = slabThick * (F.spec.thickRatio ?? 0.32); // 料厚（模式库「料厚」条目参数）
          const rA = { x: fT0.x + (fB0.x - fT0.x) * 0.06 - dir.x * w, y: fT0.y + (fB0.y - fT0.y) * 0.06 - dir.y * w };
          const rB = { x: fT0.x + (fB0.x - fT0.x) * 0.94 - dir.x * w, y: fT0.y + (fB0.y - fT0.y) * 0.94 - dir.y * w };
          regThickness(F.A, slabId, [rA, rB], 1.30, { faceW: w, faceDx: dir.x, faceDy: dir.y, faceTone: 0.95 });
          (F.A.ridgeMode ??= new Set()).add(slabId);
        }
      }
    }
  }
  }
const LEG_OPS: Record<string, (F: LegFrame, part: MechaIR['parts'][number]) => void> = {
    core: (F, part) => {
  // 1) 内框杆（垫底）：沿轴窄带 + 关节间连接杆
  // 内体：沿关节链的结构核，半径自定（髋 26→膝 23→踝 16，×coreScale），与包络参数无关
  // 变体选择（框重系数/核面跟宽）由图步参数给（coreScale/frameK/follow），不读规格
  {
    const coreR = (part.params.coreScale as number) * (part.params.frameK as number) * (part.params.follow ? 1 : F.dF);
    const coreSegs: [Pt, Pt, number, number][] = part.params.follow
      ? [[F.hip, F.knee, F.thigh.wA / 2 - 5, F.thigh.wB / 2 - 5], [F.knee, F.ankle, F.shin.wA / 2 - 5, F.shin.wB / 2 - 5]] // 细腿：核面跟段宽走（板内面 −5），板缝透出的就是核面
      : [[F.hip, F.knee, 34, 30], [F.knee, F.ankle, 30, 21]]; // v29 等比放大（29/25.5/18），收分剖面不变
    F.cv.insts.push({ kind: 'frame' });
    fillShape(F.cv, F.id, capsuleChainTest(coreSegs, coreR)); F.id++;
  }
    },
    jointBacking: (F, part) => {
  // 模式「关节内构衬底」（模式库 L1）：关节盘四周衬暗内构、凹口不
  // 露背景。在一切段板/足块/关节件之前画，只在盘缘外的缺口里露
  // 出。块表 = [相对盘心偏移, 宽, 高, 角]：壳块沿小腿轴、盘下块、
  // 前上延块（衬住压块后上方凹口——旧版此处只有小腿板衬边一角探
  // 进背景成孤立暗三角，衬满后同为暗框色、三角融进衬底）。
  // 踝/膝/髋三处均已执行（膝/髋衬块紧随踝表之后）
  {
    const aAng = Math.atan2(F.ankle.y - F.knee.y, F.ankle.x - F.knee.x);
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
      F.cv.insts.push({ kind: 'frame' });
      fillShape(F.cv, F.id, clipGround(blockPoly(F.ankle.x + dx, F.ankle.y + dy, w, h, ang, 0.3))); F.id++;
    }
    // 膝/髋衬底（同模式补齐）：盘后楔区 + 沿两段背侧的衬块，弯腿时
    // 凹侧张开也不露背景；同为垫底先画，只在缺口里露暗内构色
    const tAng = Math.atan2(F.knee.y - F.hip.y, F.knee.x - F.hip.x);
    // 前楔下尖接缝衬垫（只有前楔块后必需）：小腿侧楔撤除后，
    // 前楔下尖与小腿板上端前角之间在前轮廓上夹出 1–3px 透光
    // 缝（变体门实测：洞在膝心相对 (+49, +47)——前楔外链下段
    // 与小腿板前角之间）——垫块沉在两板之下、只封缝不改轮廓
    {
      const sd = { x: F.ankle.x - F.knee.x, y: F.ankle.y - F.knee.y }; const ls = Math.hypot(sd.x, sd.y) || 1; sd.x /= ls; sd.y /= ls;
      const pfp = { x: sd.y, y: -sd.x }; if (pfp.x < 0) { pfp.x = -pfp.x; pfp.y = -pfp.y; }
      const pc = { x: F.knee.x + sd.x * 44 + pfp.x * 48 * F.ws, y: F.knee.y + sd.y * 44 + pfp.y * 48 * F.ws };
      F.cv.insts.push({ kind: 'frame' });
      fillShape(F.cv, F.id, clipGround(blockPoly(pc.x, pc.y, 36, 32, Math.atan2(sd.y, sd.x), 0.3))); F.id++;
    }
    const KNEE_BACKING: [number, number, number, number, number][] = [
      [-30, 0, 64, 72, aAng], [-34, -36, 56, 44, tAng], [-30, 38, 56, 42, aAng],
    ];
    for (const [dx, dy, w, h, ang] of KNEE_BACKING) {
      F.cv.insts.push({ kind: 'frame' });
      fillShape(F.cv, F.id, clipGround(blockPoly(F.knee.x + dx, F.knee.y + dy, w, h, ang, 0.3))); F.id++;
    }
    const HIP_BACKING: [number, number, number, number, number][] = [
      [-16, -14, 76, 60, tAng], [-38, 8, 56, 56, tAng],
    ];
    for (const [dx, dy, w, h, ang] of HIP_BACKING) {
      F.cv.insts.push({ kind: 'frame' });
      fillShape(F.cv, F.id, clipGround(blockPoly(F.hip.x + dx, F.hip.y + dy, w, h, ang, 0.3))); F.id++;
    }
    // 段背衬条（同模式）：小腿后侧板前缘与活塞杆之间有一条楔
    // 形空腔（正直画布 cy340 实测：板边 x149、杆 x161、中间
    // 11px 全空；变体门敏捷 281px、动力服同型）——沿段背侧垫
    // 暗内构长条，外界压在既有轮廓之内（板后缘/缆线更靠后），
    // 只封空腔不改剪影；大腿背侧同理垫一条（板缝小口袋）
    const backStrip = (s: { a: Pt; b: Pt }, t0: number, t1: number, dIn: number, dOut: number) => {
      const f = segFrame(s.a, s.b); const sgn = F.std ? 1 : -1;
      const B = (t: number, d: number): Pt => ({ x: s.a.x + f.ux * f.len * t + f.px * d * sgn, y: s.a.y + f.uy * f.len * t + f.py * d * sgn });
      F.cv.insts.push({ kind: 'frame' });
      fillShape(F.cv, F.id, clipGround([B(t0, dOut), B(t1, dOut), B(t1, dIn), B(t0, dIn)])); F.id++;
    };
    backStrip(F.shin, 0.40, 0.90, 16, 46);
    backStrip(F.thigh, 0.38, 0.72, 16, 48);
    // 细腿前缘衬条（分段宽参启用时）：板变窄后，大腿下板前切角与膝楔
    // 之间在前轮廓上夹出透光口袋（变体门实测三族同位：髋相对
    // (+42, +116) 一带）、小腿背侧活塞走廊在衬条起边处同样开口——
    // 沿前表面内侧垫暗内构条、背条起止外扩，只封口袋不改剪影
    if (part.params.wide) {
      backStrip(F.shin, 0.12, 0.95, 10, 56);
      const fT = segFrame(F.thigh.a, F.thigh.b); const sgnT = F.std ? 1 : -1;
      const offF = (t: number) => ((F.thigh.wA + (F.thigh.wB - F.thigh.wA) * t) / 2) * (1 + F.thigh.bulge.f * bumpAt(t, 0.38));
      const BF = (t: number, d: number): Pt => ({ x: F.thigh.a.x + fT.ux * fT.len * t + fT.px * d * sgnT, y: F.thigh.a.y + fT.uy * fT.len * t + fT.py * d * sgnT });
      F.cv.insts.push({ kind: 'frame' });
      fillShape(F.cv, F.id, clipGround([BF(0.40, -(offF(0.40) + 14)), BF(1.05, -(offF(1.0) + 14)), BF(1.05, -(offF(1.0) - 18)), BF(0.40, -(offF(0.40) - 18))])); F.id++;
    }
  }
    },
    frameBeam: (F) => {
  // 框梁（仅框主导族）：窄板挂在露出的框梁上，段侧缘带归框梁（按段规格定宽，与甲板同源）；入列由图 when 定，本算子无条件画
  for (const sgm of [F.thigh, F.shin]) {
    F.cv.insts.push({ kind: 'frame' });
    fillShape(F.cv, F.id, plateTest(sgm.a, sgm.b, sgm.wA * 0.82, sgm.wB * 0.82, 0, 1, 0, 0, 0, sgm.bulge)); F.id++;
  }
  // （v29 删）中心脊线：髋→踝一根直杆斜穿弯曲关节，形态错误；垫底由沿关节链的分段结构核承担
    },
    cableRun: (F) => {
  // 2) 线缆：髋后 → 膝后 → 踝后两段贝塞尔（采样点盖章）
  const cablePts: Pt[] = [];
  const sag = F.sag;
  for (let k = 0; k <= 22; k++) cablePts.push(bezier(backOf(F, F.thigh, 0.06, 40), backOf(F, F.thigh, 0.5, 52 + sag), backOf(F, F.thigh, 0.97, 36), k / 22));
  for (let k = 0; k <= 22; k++) cablePts.push(bezier(backOf(F, F.shin, 0.04, 40 + calfDeltaOf(F.shin, 0.04)), backOf(F, F.shin, 0.5, 58 + sag * 0.8 + calfDeltaOf(F.shin, 0.5)), backOf(F, F.shin, 0.96, 32 + calfDeltaOf(F.shin, 0.96)), k / 22));
  F.cv.insts.push({ kind: 'cable' });
  fillShape(F.cv, F.id, pathTubeTest(cablePts, 5.5)); F.id++;
  for (const e of [cablePts[0], cablePts[cablePts.length - 1]]) { F.cv.insts.push({ kind: 'cyl' }); fillShape(F.cv, F.id, discTest(e, 4.5)); F.id++; } // 线缆端头接头
    },
    segPlates: (F, part) => {
      if (part.params.seg === 'thigh') {
  const thighIds = segPlates(F, F.thigh);
  // 模式「膝上盖板」（模式库 L1）：段板组单板特例——只盖前侧的一
  // 条板，末端止于膝心，填平末板切角在膝前上方留的凹口；后半
  // 不设（对照参考：膝后是暗的关节凹口）。参数：沿段 t 0.84→1.0、
  // 前缘贴大腿板前表面 +3、后缘收到轴线前 6。末端原越膝心到
  // 1.07——越界的那截被拆分线切进小腿精灵、装配时随小腿摆动甩
  // 出成鳍（整机横读实证）；盖板本体归大腿，止于膝心即整块留
  // 在大腿精灵内，膝前下半由前楔（小腿侧）与衬垫接住
  {
    const CAP = { t0: 0.84, t1: 1.0, backIn: 6, proud: 3 };
    const frontOff = (t: number) => ((F.thigh.wA + (F.thigh.wB - F.thigh.wA) * t) / 2) * (1 + F.thigh.bulge.f * bumpAt(t, 0.38)) + CAP.proud;
    F.cv.insts.push({ kind: 'plate' }); const sid = F.id;
    const capPts = [
      backOf(F, F.thigh, CAP.t0, -frontOff(CAP.t0)), backOf(F, F.thigh, CAP.t1, -frontOff(CAP.t1)),
      backOf(F, F.thigh, CAP.t1, -CAP.backIn), backOf(F, F.thigh, CAP.t0, -CAP.backIn),
    ];
    fillShape(F.cv, F.id, polyTest(capPts)); F.id++;
    F.A.plateTint.set(sid, 1.0); F.A.panelLines.set(sid, [0.5]);
    if (part.params.panel) (F.A.colorRole ??= new Map()).set(sid, 'armor2'); // 大腿前幅族：盖板是膝前副色系统的一环（与胫板同色衔接），白色盖板尖压在橙胫板上读作异物
    polyLip(F.A, sid, capPts, 0.5);
  }
  // 大腿前幅板（thighPanel 族）：贴大腿前表面的一整幅副色壳面，
  // 前缘随段膨出采样贴合、后界扫到轴线后 8——橙在大腿上是整幅
  // 图形面而不是一条线（与胫前整幅橙板同一用量档位）
  if (part.params.panel) {
    const fOff = (t: number) => ((F.thigh.wA + (F.thigh.wB - F.thigh.wA) * t) / 2) * (1 + F.thigh.bulge.f * bumpAt(t, 0.38));
    const TS = [0.04, 0.22, 0.40, 0.58, 0.70];
    const pts: Pt[] = [...TS.map((t) => backOf(F, F.thigh, t, -(fOff(t) + 2))), ...TS.slice().reverse().map((t) => backOf(F, F.thigh, t, 8))];
    F.cv.insts.push({ kind: 'guard' }); const pid = F.id;
    fillShape(F.cv, F.id, polyTest(pts)); F.id++;
    (F.A.colorRole ??= new Map()).set(pid, 'armor2');
    F.A.plateTint.set(pid, 1.02); F.A.panelLines.set(pid, [0.5]);
    polyLip(F.A, pid, pts, 0.5);
  }
  F.A.stripeThigh = thighIds[0];
  F.A.ventId = thighIds[thighIds.length - 1];
      } else {
  const shinIds = segPlates(F, F.shin, (x, y) => shinClip(F, x, y));
  F.A.shinIds = new Set(shinIds);
  {
    const sf = segFrame(F.shin.a, F.shin.b); const sgn2 = F.std ? -1 : 1;
    const SP = (t: number, off: number): Pt => ({ x: F.shin.a.x + sf.ux * sf.len * t + sf.px * sgn2 * off, y: F.shin.a.y + sf.uy * sf.len * t + sf.py * sgn2 * off });
    if (part.params.shellStripe) F.A.stripeSegs = [{ p1: SP(0.08, 26), p2: SP(0.92, -14) }];
    else if (part.params.band) {
      // 沿轴蓝带：落在前壳面上、距前缘约 1/4 半宽处（前 = 负偏置侧，
      // 实测正偏置落在后缘被活塞遮），半宽随收分缩小、带位跟随
      const hwF = (t: number) => (F.shin.wA + (F.shin.wB - F.shin.wA) * t) / 2;
      F.A.stripeSegs.push({ p1: SP(0.12, hwF(0.12) * 0.55), p2: SP(0.92, hwF(0.92) * 0.55), w: 8, ids: new Set(shinIds) });
    }
    if (part.params.inset) {
      // 小腿深蓝嵌板（模式库「嵌板」：板件的租户）：前壳面下段一块
      // 深蓝矩形嵌板，t 0.60–0.86、横向心 +0.20 半宽、幅 0.72 半宽，
      // 位与幅随收分跟随。kind 借 foot（不切刻面、base=armor2），
      // plateTint 0.62 压成深蓝；与宿主相接行由黑隙算子描缝
      // （DAG：两构件相接必经黑隙，foot 在压覆件集内）
      const hwF = (t: number) => (F.shin.wA + (F.shin.wB - F.shin.wA) * t) / 2;
      const pts = [SP(0.60, -0.16 * hwF(0.60)), SP(0.60, 0.56 * hwF(0.60)), SP(0.86, 0.56 * hwF(0.86)), SP(0.86, -0.16 * hwF(0.86))];
      F.cv.insts.push({ kind: 'foot' }); const ip = F.id;
      fillShape(F.cv, F.id, polyTest(pts)); F.id++;
      (F.A.colorRole ??= new Map()).set(ip, 'armor2');
      F.A.plateTint.set(ip, 0.62);
      polyLip(F.A, ip, pts, 0.5);
    }
    if (part.params.panel) {
      // 小腿前脸整幅副色板（动力服气质档位：橙是随身大图形面——
      // 胫前板整幅橙，与头穹弧带/背包中板/橙靴同档，不是小点缀）：
      // 参考的橙板就是胫骨前板本身——直接给小腿段板登记 armor2
      // 色角色（整幅覆色实验过：叠画多边形按 SP 偏置猜位只盖住
      // 中缝一条，段板本体才是前脸）
      for (const i2 of shinIds) (F.A.colorRole ??= new Map()).set(i2, 'armor2');
    }
  }
      }
    },
    footBlocks: legOp_foot, footShoe: legOp_foot, footClaw: legOp_foot, footPad: legOp_foot, footWheel: legOp_foot,
    guard: (F, part) => {
  // 6) 胫骨套（前护板，多边形盾形，压在小腿前方——与后侧腓肠套
  // §7.5 前后成对）：坐标 = (沿轴 t, 离轴距离 off)；入列由图
  // when 定（无护板族不入列），本算子无条件画
  {
    const f = segFrame(F.shin.a, F.shin.b);
    const sgn = F.std ? -1 : 1; // front = -perp（标准型）
    const gS = 0.92 + F.rnd() * 0.25; // 护板比例逐腿不同（宽窄/突出量）
    const hwAt = (t: number) => ((F.shin.wA + (F.shin.wB - F.shin.wA) * t) / 2) * (1 + F.shin.bulge.f * bumpAt(t, 0.38)) * (part.params.heavy ? 0.8 : 1) * gS;
    const C = (t: number, off: number): Pt => ({
      x: F.shin.a.x + f.ux * f.len * t + f.px * sgn * off,
      y: F.shin.a.y + f.uy * f.len * t + f.py * sgn * off,
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
    const T1 = { x: F.ankle.x + dirG.x * 49, y: F.ankle.y + dirG.y * 49 };
    const T2 = { x: F.ankle.x + dirG.x * 95, y: F.ankle.y + dirG.y * 95 };
    const F0 = C(0.10, hwAt(0.10) * 0.93); // 前缘起点（九成高，见上）
    const pts = [
      C(0.02, hwAt(0.02) * 0.34), C(0.04, hwAt(0.04) * 1.06), F0,
      T2, T1, C(0.90, hwAt(0.90) * 0.24), C(0.5, hwAt(0.5) * 0.2), C(0.12, hwAt(0.12) * 0.22),
    ];
    F.cv.insts.push({ kind: 'guard' }); F.A.guardId = F.id; F.A.stripeId = F.id;
    fillShape(F.cv, F.id, polyTest(pts)); F.id++;
    // 胫骨套下缘料厚：走模式库「料厚」条目的注册做法（归高光棱
    // 执行，与压块前端同一套构造，不另发明）：棱线沿下缘内缩一
    // 个料厚 w = 件厚 × thickRatio、两端内收 0.06/0.94，线至下缘
    // 间是平色差带——套以这个「面」压在压块顶边上。此前一版用
    // 放大衬边冒充厚度，是跳过模式的自创，已删
    {
      const w = 0.8 * 50 * (F.spec.thickRatio ?? 0.32); // 件厚同压块尺度（0.8·D）
      const nx = 0.389, ny = 0.921; // 主线法向（指向压块一侧）
      const rA = { x: T1.x + (T2.x - T1.x) * 0.06 - nx * w, y: T1.y + (T2.y - T1.y) * 0.06 - ny * w };
      const rB = { x: T1.x + (T2.x - T1.x) * 0.94 - nx * w, y: T1.y + (T2.y - T1.y) * 0.94 - ny * w };
      regThickness(F.A, F.A.guardId, [rA, rB], 1.30, { faceW: w, faceDx: nx, faceDy: ny, faceTone: 0.95 });
      (F.A.ridgeMode ??= new Set()).add(F.A.guardId);
    }
    // 前缘料厚（用户定「前缘应该更厚」）：同一「料厚」构造沿前缘
    // （F0→T2）再登记一条——前缘是套的迎面，料厚带比下缘更宽：
    // 件厚按套的前后进深取 1.45·D（与压块长同尺度），w 随之更大
    {
      const w = 1.45 * 50 * (F.spec.thickRatio ?? 0.32);
      const fx = 0.894, fy = 0.442; // 前向（套内指向前缘）
      const rA = { x: F0.x + (T2.x - F0.x) * 0.06 - fx * w, y: F0.y + (T2.y - F0.y) * 0.06 - fy * w };
      const rB = { x: F0.x + (T2.x - F0.x) * 0.94 - fx * w, y: F0.y + (T2.y - F0.y) * 0.94 - fy * w };
      regThickness(F.A, F.A.guardId, [rA, rB], 1.30, { faceW: w, faceDx: fx, faceDy: fy, faceTone: 0.95 });
    }
    F.A.plateTint.set(F.A.guardId, 1.05);
    F.A.panelLines.set(F.A.guardId, [0.52, 0.79]);
    polyLip(F.A, F.A.guardId, pts, 0.52); polyLip(F.A, F.A.guardId, pts, 0.79);
    if (part.params.panel) (F.A.colorRole ??= new Map()).set(F.A.guardId, 'armor2'); // 动力服：护板即胫前橙板本体（气质档位，见 shinPanel）
    // 模式「套系连带」（模式库 L1·护板子构造，用户定）：护板下端
    // 到踝前压块套之间一条连带，贴小腿前表面下行、压住套的上
    // 缘——两套相连成一个套系，小腿前轮廓在连带处收进，凹轮廓
    // 由此形成（套心与压块总成同式：主线 -0.40、盘心沿主线 0.62·50）
    {
      const dirL = { x: Math.cos(-0.40), y: Math.sin(-0.40) }, nrmL = { x: -dirL.y, y: dirL.x };
      const sc = { x: F.ankle.x + dirL.x * 31, y: F.ankle.y + dirL.y * 31 };
      const band: Pt[] = [
        C(0.90, hwAt(0.90) * 0.34), C(0.995, hwAt(0.995) * 0.30),
        { x: sc.x + nrmL.x * 2 + dirL.x * 8, y: sc.y + nrmL.y * 2 + dirL.y * 8 },
        { x: sc.x - nrmL.x * 14, y: sc.y - nrmL.y * 14 },
      ];
      F.cv.insts.push({ kind: 'guard' });
      fillShape(F.cv, F.id, polyTest(band)); F.id++;
      F.A.plateTint.set(F.id - 1, 0.92);
    }
    F.A.decalPos = C(0.8, hwAt(0.8) * 0.44);
    // （M 轮反向检查撤销）护板仪表窗登记：每条腿胫前盖一枚框式
    // 副色窗、全参考池无见证。deviceFrame 着色步保留在管线里
    // （无登记即不画），腿侧不再登记
    F.A.chevDecal = F.rnd() < 0.55;
    F.A.boltPts.push(C(0.12, hwAt(0.12) * 0.72), C(0.85, hwAt(0.85) * 0.42));
    // 三层叠人字纹（AA 式）：三个 ⌄ 上下叠，(t, off) 定义、渲染盖章
    // （顶端收进护板凹面前缘之内，不越界落到板面外）。人字纹与
    // CAUTION/M 编号同属载具模板字一档（参考池：人字纹只在 walker
    // 车体/腿上，人形参考的护板面上没有）——只在 decalKind 'num'
    // 时登记，人形族缺省 'plate' 不登记。
    if (part.params.chevrons) for (const t0 of [0.16, 0.32, 0.48]) {
      const apex = C(t0 + 0.07, hwAt(t0 + 0.07) * 0.6);
      F.A.chevrons.push([C(t0, hwAt(t0) * 0.26), apex], [apex, C(t0 + 0.14, hwAt(t0 + 0.14) * 0.26)]);
    }
  }
    },
    kneeCapBox: (F) => {
  // 6.5) 膝盖帽 + 大腿前小盒（参考图的构件密度主要来自这类小件）
  {
    // 膝盖帽已撤（用户定：膝盖只有前楔块——楔拱前扇区那块，见下方
    // 楔块段；帽与前楔同压盘面前缘、双块并存是残留，膝盖块系数
    // kneeScale 由前楔单独承载）
    const tf = segFrame(F.thigh.a, F.thigh.b); const tsgn = F.std ? -1 : 1;
    legBox(F, F.thigh.a.x + tf.ux * tf.len * 0.3 + tf.px * tsgn * 44, F.thigh.a.y + tf.uy * tf.len * 0.3 + tf.py * tsgn * 44, 26, 34);
  }
    },
    backBox: (F) => {
  // 小腿后挂盒：随腓肠表面跟随；入列由图 when 定（机械收敛族
  // 不挂：壳后只留暗杆），本算子无条件画
  {
    const f = segFrame(F.shin.a, F.shin.b); const sgn = F.std ? -1 : 1;
    legBox(F, F.shin.a.x + f.ux * f.len * 0.62 - f.px * sgn * (52 + calfDeltaOf(F.shin, 0.62)), F.shin.a.y + f.uy * f.len * 0.62 - f.py * sgn * (52 + calfDeltaOf(F.shin, 0.62)), 24, 32);
  }
    },
    detailSet: (F) => {
  // 6.6) 中型构件一批：裙板 / 副油缸 / 膝连杆 / 排气管 / 背导轨 / 踝护板 / 提手
  {
    const tf = segFrame(F.thigh.a, F.thigh.b);
    const P = (t: number, off: number): Pt => ({ x: F.thigh.a.x + tf.ux * tf.len * t + tf.px * off, y: F.thigh.a.y + tf.uy * tf.len * t + tf.py * off });
    // 大腿后裙板（沿后侧另挂一块，向上张开）——压在大腿板上，登记压覆（黑隙）
    (F.A.pressIds ??= new Set()).add(addPlate(F, P(0.0, 13), P(0.48, 13), 68, 54, 0.02, 0.98, 2.6, 4, 12));
    // 膝连杆：膝后一根粗杆跨接两段 + 两端销盘
    const l1 = backOf(F, F.thigh, 0.8, 27), l2 = backOf(F, F.shin, 0.15, 23);
    F.cv.insts.push({ kind: 'frame' }); fillShape(F.cv, F.id, lineTest(l1, l2, 7)); F.id++;
    for (const e of [l1, l2]) { F.cv.insts.push({ kind: 'cyl' }); fillShape(F.cv, F.id, discTest(e, 8)); F.id++; }
  }
    },
    backGear: (F) => {
  // 小腿背导轨 + 排气管：壳后外露硬件——入列由图 when 定（机械
  // 收敛族不挂：导轨是板色长条、飘在腓肠表面之外，整机上读作
  // 壳后一片亮鳍，与「机械藏壳」正相反），本算子无条件画
  {
      // 小腿背导轨（贴腓肠表面走：离轴距离随腓肠表面跟随）
      F.cv.insts.push({ kind: 'plate' }); const railId = F.id;
      fillShape(F.cv, F.id, lineTest(backOf(F, F.shin, 0.14, 58 + calfDeltaOf(F.shin, 0.14)), backOf(F, F.shin, 0.88, 38 + calfDeltaOf(F.shin, 0.88)), 4.5)); F.id++;
      F.A.plateTint.set(railId, 0.95); F.A.panelLines.set(railId, []);
      // 小腿排气管 ×3（膝后向上短管）
      for (let k = 0; k < 3; k++) {
        const base = backOf(F, F.shin, 0.1 + k * 0.055, 52 + calfDeltaOf(F.shin, 0.1 + k * 0.055));
        const tip = { x: base.x - 3, y: base.y - 32 };
        F.cv.insts.push({ kind: 'cyl' }); const exId = F.id; fillShape(F.cv, F.id, lineTest(base, tip, 4.2)); F.id++;
        regCylHoops(F.A, exId, base, tip, 4.2); // 排气管环带同路（箍归缝模式）
      }
  }
    },
    detailTail: (F) => {
  // 中型构件尾批：踝前护板 / 提手（与 detailSet 同组同序，拆步只为入列条件入图）
  {
    // 踝前护板
    F.cv.insts.push({ kind: 'plate' }); const agId = F.id;
    const agPts = [{ x: F.ankle.x + 16, y: 402 }, { x: F.ankle.x + 36, y: 412 }, { x: F.ankle.x + 37, y: 442 }, { x: F.ankle.x + 25, y: 458 }, { x: F.ankle.x + 13, y: 434 }];
    fillShape(F.cv, F.id, polyTest(agPts)); F.id++;
    F.A.plateTint.set(agId, 1.0); F.A.panelLines.set(agId, [0.5]);
    (F.A.pressIds ??= new Set()).add(agId); // 踝前护板压在小腿前，登记压覆（黑隙）
    polyLip(F.A, agId, agPts, 0.5);
    // 提手：大腿下板正面 Π 形（两脚 + 横杆，金属色）
    const hf = segFrame(F.thigh.a, F.thigh.b); const hsgn = F.std ? -1 : 1;
    const H = (t: number, off: number): Pt => ({ x: F.thigh.a.x + hf.ux * hf.len * t + hf.px * hsgn * off, y: F.thigh.a.y + hf.uy * hf.len * t + hf.py * hsgn * off });
    const h1 = H(0.66, 47), h2 = H(0.8, 47), h1b = H(0.66, 38), h2b = H(0.8, 38);
    F.cv.insts.push({ kind: 'cyl' }); const hd1 = F.id; fillShape(F.cv, F.id, lineTest(h1b, h1, 3)); F.id++;
    F.cv.insts.push({ kind: 'cyl' }); const hd2 = F.id; fillShape(F.cv, F.id, lineTest(h2b, h2, 3)); F.id++;
    F.cv.insts.push({ kind: 'cyl' }); const hd3 = F.id; fillShape(F.cv, F.id, lineTest(h1, h2, 3.4)); F.id++;
    regCylHoops(F.A, hd1, h1b, h1, 3); regCylHoops(F.A, hd2, h2b, h2, 3); regCylHoops(F.A, hd3, h1, h2, 3.4); // 提手管环带同路
  }
    },
    pistonPair: (F, part) => {
  // 7) 活塞：大腿后侧、小腿后侧（两参考样本一致：胫前是装甲
  // 面、活塞一律在腓肠侧）。小腿活塞自膝下画到踝盘、贴段板后
  // 缘走线；它上半截由紧随其后的腓肠套（§7.5 膝下板）盖住。
  // 式（三式）由图步以 when + mode 参数选定，本算子只按 mode 画
  if (part.params.mode === 'piston') {
    // 重型方言（M 轮反向检查补回）：池图重型与 m3 的小腿后都是
    // 一根亮铬活塞——缸筒在上半、亮杆直达踝盘；大腿后无杆。
    // 与全套活塞组（非 slim 族）区别只在取舍：只要小腿主活塞一根
    piston(F, backOf(F, F.shin, 0.10, 36), backOf(F, F.shin, 1.0, 15), 6, 3.2);
  } else if (part.params.mode === 'slim') {
    // 机械收敛（三族人形横读定版）：壳后不留铬活塞组。大腿后
    // 三样本皆无杆（敏捷纯壳、动力服壳+挂箱、主战壳+髋侧小缸），
    // 不挂杆；小腿后只一根深色细杆贴壳后缘——上半截照旧被腓肠
    // 套盖住、自套下缘探出（动力服/主战样本的黑细杆即此读法）
    const slimRod = (seg: typeof F.thigh, t0: number, d0: number, t1: number, d1: number) => { F.cv.insts.push({ kind: 'frame' }); fillShape(F.cv, F.id, lineTest(backOf(F, seg, t0, d0), backOf(F, seg, t1, d1), 3)); F.id++; };
    slimRod(F.shin, 0.10, 34, 1.0, 14);
  } else {
    piston(F, backOf(F, F.thigh, 0.14, 44), backOf(F, F.thigh, 0.88, 40));
    piston(F, backOf(F, F.thigh, 0.24, 26), backOf(F, F.thigh, 0.62, 24), 6, 3.2); // 副油缸（贴板面、更细更短）
    piston(F, backOf(F, F.shin, 0.10, 36), backOf(F, F.shin, 1.0, 15), 6, 3.2); // 小腿主活塞：上端藏进腓肠套、下端落在踝盘上缘（径收细：原缸 8/杆 4.2 在整机上读作粗银柱，参考是细杆）
  }
    },
    pistonExtra: (F) => {
  // 无护板族的后侧成对第二根（全套式的附加件）：入列由图 when
  // 定（全套式 + 无护板 + 非壳面），本算子无条件画
  piston(F, backOf(F, F.shin, 0.20, 30), backOf(F, F.shin, 0.84, 27), 5, 2.6);
    },
    calfSleeve: (F) => {
  // 7.5) 腓肠套（用户命名，即参考图里的「膝下板」）：小腿后侧上
  // 半的一块套板，自膝下挂到小腿中段——盖住活塞上半截与段板后
  // 半，活塞自它的下缘探出。与前侧胫骨套（§6 护板）前后成对
  // 入列由图 when 定（壳面族不入列），本算子无条件画
  {
    const f7 = segFrame(F.shin.a, F.shin.b); const s7 = F.std ? 1 : -1;
    const hwB7 = (t: number) => ((F.shin.wA + (F.shin.wB - F.shin.wA) * t) / 2) * (1 + F.shin.bulge.b * Math.exp(-(((t - 0.34) / 0.3) ** 2)));
    const B7 = (t: number, off: number): Pt => ({ x: F.shin.a.x + f7.ux * f7.len * t + f7.px * s7 * off, y: F.shin.a.y + f7.uy * f7.len * t + f7.py * s7 * off });
    const calfPts = [
      B7(0.03, hwB7(0.03) + 5), B7(0.18, hwB7(0.18) + 7), B7(0.34, hwB7(0.34) + 7), B7(0.46, hwB7(0.46) + 3),
      B7(0.50, 14), B7(0.30, 8), B7(0.12, 10), B7(0.04, 16),
    ];
    F.cv.insts.push({ kind: 'plate' }); const calfId = F.id;
    fillShape(F.cv, F.id, polyTest(calfPts)); F.id++;
    F.A.plateTint.set(calfId, 1.02);
    F.A.panelLines.set(calfId, [0.55]);
    polyLip(F.A, calfId, calfPts, 0.55);
    F.A.boltPts.push(B7(0.14, hwB7(0.14) * 0.55), B7(0.40, hwB7(0.40) * 0.5));
  }
    },
    jointCluster: (F, part) => {
  // 8) 关节 = 块簇：沿段轴的壳体块 + 盖帽盘 + 切角毂块
  const segAng = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);
  const ja = (q: Pt, ang: number, dist: number): Pt => ({ x: q.x + Math.cos(ang) * dist, y: q.y + Math.sin(ang) * dist });
  const jointBlock = (c: Pt, ang: number, w: number, h: number) => {
    F.cv.insts.push({ kind: 'plate' }); const bid = F.id;
    fillShape(F.cv, F.id, polyTest(blockPoly(c.x, c.y, w * F.dF, h * F.dF, ang, 0.4))); F.id++;
    F.A.plateTint.set(bid, [0.85, 0.95, 1.05][Math.floor(F.rnd() * 3)]);
    F.A.panelLines.set(bid, []);
  };
  // 膝盘径按整机对照定：参考三样本盘径占身高 3.9–5.7%，旧值（法兰 39/盖帽 35）
  // 装配后约 8–9%，约 1.5–1.8 倍；法兰 19/盖帽 17 后装配暗区约 5%（含描边与关节暗隙）。盘心本就坐在关节上，只缩径。
  for (const [j, r] of [[F.hip, 41 * F.dF], [F.knee, 19 * F.dF], [F.ankle, 25 * F.dF]] as [Pt, number][]) {
    F.cv.insts.push({ kind: 'frame' }); fillShape(F.cv, F.id, discTest(j, r)); F.id++; // 关节法兰：盖帽垫圈（v29 半径改由盖帽派生，见下方半径表）
  }
  // （M 轮反向检查撤销）关节暗舱领：膝两侧各压一段全宽 frame 块，
  // 出图读作夹住膝盘的双黑带、全参考池无见证（池内膝 = 盘直贴
  // 板件、只有暗隙）。盘的嵌舱读法由法兰+盖帽+黑隙承担，不再加块
  for (const [j, r] of [[F.hip, 37 * F.dF], [F.knee, 17 * F.dF], [F.ankle, 21 * F.dF]] as [Pt, number][]) {
    const cc = { x: j.x + (F.rnd() * 8 - 4), y: j.y + (F.rnd() * 6 - 3) }; // 盖帽偏心，不再正中靶心
    F.cv.insts.push({ kind: 'disc' }); fillShape(F.cv, F.id, discTest(cc, r)); F.A.discs.push({ id: F.id, c: cc, r, hv: F.A.discs.length % 3, hub: true }); F.id++;
  }
  // 壳体块画在盖帽之后：压住帽缘、关节成簇（v15 画在帽前被帽盖住，等于没加）
  jointBlock(ja(F.hip, segAng(F.hip, F.knee), 30), segAng(F.hip, F.knee), 64, 46);
  // 膝/踝的关节块向段内退（28→40、19→27）：参考图的关节是深色外露
  // 圆盘、装甲在盘缘处断开；旧位块体压住盘面大半，关节读不出来
  // 膝盖由楔模式画（楔拱生成器，与肩部同模式）：只拼前楔
  // 一块——楔界由两段轴向与各自前侧定，外链取两段前截面点
  // 与其间的浅弧垫面，厚度随 kneeScale；旧矩形关节块三块已撤
  {
    const ks = F.spec.kneeScale ?? 1;
    const uTv = { x: F.hip.x - F.knee.x, y: F.hip.y - F.knee.y }; const lT = Math.hypot(uTv.x, uTv.y) || 1; uTv.x /= lT; uTv.y /= lT;
    const uSv = { x: F.ankle.x - F.knee.x, y: F.ankle.y - F.knee.y }; const lS = Math.hypot(uSv.x, uSv.y) || 1; uSv.x /= lS; uSv.y /= lS;
    const pf = (u: Pt) => { const p = { x: u.y, y: -u.x }; return p.x >= 0 ? p : { x: -p.x, y: -p.y }; }; // 前侧垂向（取 +x 一侧）
    const pfT = pf(uTv), pfS = pf(uSv);
    const P = (u: Pt, d: number, q: Pt, o: number): [number, number] => [F.knee.x + u.x * d + q.x * o, F.knee.y + u.y * d + q.y * o];
    // 垫形收敛（整机横读纠正）：旧形两段同伸 58、前链单顶点
    // 66——装配图里读作脱离腿面的尖星（楔体大半探出胫前线外、
    // 又跨关节被拆分线切开，弯膝时尖角甩出剪影）。参考的膝垫
    // 是贴关节的紧凑垫、整体坐小腿侧：大腿侧只伸 10（垫顶止于
    // 盘前沿，盘上由大腿侧的膝上盖板压住，两件在盘面相接）、
    // 小腿侧伸 48、前链改弦上浅凸（见下 capPt），垫面贴段前线
    // 微凸，不再成尖、不再悬空
    const pTF = P(uTv, 10 * ks, pfT, 42 * F.ws + 6);
    const pSF = P(uSv, 48 * ks, pfS, 50 * F.ws + 6);
    const ang = (p: [number, number]) => (Math.atan2(p[1] - F.knee.y, p[0] - F.knee.x) * 180) / Math.PI;
    // 垫面取两锚点的弦 + 沿前向平分线的浅凸（中点 +6·ks）：垫面
    // 位置由两段前表面导出、对任何族都只微凸于段前线——旧作法
    // 以膝心为圆心取固定半径 58 作弧，细壳族（敏捷）段前线只
    // 在 40 上下，垫面整片悬在壳外读作鳍（kneeScale 探针实证：
    // 缩半径鳍即消失，病在垫面不贴段面、不是尺寸本身）
    const fb = { x: pfT.x + pfS.x, y: pfT.y + pfS.y }; const lfb = Math.hypot(fb.x, fb.y) || 1; fb.x /= lfb; fb.y /= lfb;
    const capPt = (t: number): [number, number] => {
      const bump = Math.sin(Math.PI * t) * 6 * ks;
      return [pSF[0] + (pTF[0] - pSF[0]) * t + fb.x * bump, pSF[1] + (pTF[1] - pSF[1]) * t + fb.y * bump];
    };
    // 膝盖只有前楔块（用户定）：楔拱只生成前扇区一块——大腿
    // 侧/小腿侧/后侧三块撤除，盘在其余三面外露（与参考的关
    // 节盘外露一致）；前楔仍由楔拱生成器出（与肩部同模式）
    const kw = wedgeArch([F.knee.x, F.knee.y], 20, [
      { a0: ang(pTF), a1: ang(pSF), outer: [pSF, capPt(0.3), capPt(0.5), capPt(0.7), pTF], tint: 1.06 },
    ]);
    for (const w of kw) {
      F.cv.insts.push({ kind: 'plate' }); const wid = F.id;
      fillShape(F.cv, F.id, polyTest(w.poly.map(([x, y]) => ({ x, y })))); F.id++;
      F.A.plateTint.set(wid, w.tint ?? 1); F.A.panelLines.set(wid, []);
      if (part.params.panel) (F.A.colorRole ??= new Map()).set(wid, 'armor2'); // 副色腿面族：前楔即膝盖垫、与大腿/胫前橙板同系统（参考动力服膝垫为橙）；白色前楔压在橙面上读作异物
    }
  }
  jointBlock(ja(F.ankle, segAng(F.ankle, F.knee), 27), segAng(F.ankle, F.knee), 44, 27); // 踝块横宽 32→27：随小腿末端收细（见 F.shin wB），不把踝端重新撑宽
  jointBlock(ja(F.hip, segAng(F.hip, F.knee) - 0.6, 32), segAng(F.hip, F.knee) - 0.3, 36, 26);
  jointBlock(ja(F.hip, segAng(F.hip, F.knee) + 0.55, 32), segAng(F.hip, F.knee) + 0.3, 36, 25); // 髋前整流块
  // 毂块：盖帽中心的切角方块（块语言，不再画同心毂环/毂心变体）；
  // 膝/踝毂块缩小压暗成盘心螺栓（参考：盘面大面积深色外露）
  for (const [j, r] of [[F.hip, 37], [F.knee, 17], [F.ankle, 21]] as [Pt, number][]) {
    F.cv.insts.push({ kind: 'plate' }); const hid = F.id;
    const dc = F.A.discs.find((d) => Math.abs(d.c.x - j.x) < 12 && Math.abs(d.c.y - j.y) < 12)?.c ?? j;
    const isHip = r === 37;
    fillShape(F.cv, F.id, polyTest(blockPoly(dc.x, dc.y, r * (isHip ? 0.62 : 0.42), r * (isHip ? 0.62 : 0.42), 0.3, 0.45))); F.id++;
    F.A.plateTint.set(hid, isHip ? 1.1 : 0.8); F.A.panelLines.set(hid, []);
  }
    },
    bellows: (F) => {
  // 膝后波纹套（显形版）：画在盖帽之后、加粗后移，落在关节后凹口
  for (let k = 0; k < 5; k++) {
    const b1 = backOf(F, F.thigh, 0.94 + k * 0.015, 17 + k * 5), b2 = backOf(F, F.shin, 0.09 - k * 0.015, 17 + k * 5);
    F.cv.insts.push({ kind: 'frame' }); fillShape(F.cv, F.id, lineTest(b1, b2, 4.2)); F.id++;
  }
    },
    decals: (F, part) => {
  // 贴纸编号锚点（大腿下板前缘）与信号灯
  {
    const f = segFrame(F.thigh.a, F.thigh.b); const sgn = F.std ? -1 : 1;
    F.A.numPos = { x: F.thigh.a.x + f.ux * f.len * 0.68 + f.px * sgn * 16, y: F.thigh.a.y + f.uy * f.len * 0.68 + f.py * sgn * 16 };
    F.A.decalKind = part.params.decalKind as 'num' | 'plate' | 'none';
    F.A.numText = F.A.decalKind === 'num' ? 'M-' + (10 + Math.floor(F.rnd() * 89)) : '';
    // 编号按板定位：在大腿首板（stripeThigh）的实际像素里找完整落点（整串字落在一块板内）
    if (F.A.numText) {
      const tw = F.A.numText.length * 8 - 2, th = 10;
      let found: Pt | null = null;
      for (let y = 56; y < 250 && !found; y += 2) for (let x = 96; x < 300 && !found; x += 2) {
        let ok = true;
        for (let yy = y; yy < y + th && ok; yy++) for (let xx = x; xx < x + tw && ok; xx++) if (F.cv.owner[yy * W + xx] !== F.A.stripeThigh) ok = false;
        if (ok) found = { x, y };
      }
      if (found) F.A.numPos = found;
    }
    F.A.insignia = { pos: { x: F.A.numPos.x + 4, y: F.A.numPos.y - 34 }, kind: Math.floor(F.rnd() * 4) };
    F.A.lightPts = [{ x: F.knee.x + (F.std ? 26 : -26), y: F.knee.y - 30 }, { x: F.hip.x - 30, y: F.hip.y + 34 }];
    if ((part.params.level as number) > 1.1) { // 高细节族：小腿前三灯串（侦察式）
      const lf = segFrame(F.shin.a, F.shin.b); const lsgn = F.std ? -1 : 1;
      for (const lt of [0.3, 0.55, 0.8]) F.A.lightPts.push({ x: F.shin.a.x + lf.ux * lf.len * lt + lf.px * lsgn * 26, y: F.shin.a.y + lf.uy * lf.len * lt + lf.py * lsgn * 26 });
    }
  }
    },
  };

/** 腿的图执行：帧组装 → 剪影包络 → 按 IR 部件列走步（LEG_OPS）→
 * 剪影并入全部部件。装配决定全在模板（legIR 的部件列）与规格里，
 * 本函数不自存；姿势由调用方给（pre），缺省取模板自己的锚点
 * （legIR.anchors）——姿势数据只在模板一处，不许在此再写一份 */
function layout(cv: MechaCanvas, spec: LegSpec, ir: MechaIR, pre?: { hip: Pt; knee: Pt; ankle: Pt; toeX: number }): Anchors {
  const F = makeLegFrame(cv, spec, pre ?? { hip: ir.anchors.hip, knee: ir.anchors.knee, ankle: ir.anchors.ankle, toeX: ir.anchors.toe.x });
  markLegSilhouette(F);
  for (const part of ir.parts) LEG_OPS[part.pattern]?.(F, part);
  // 剪影 = 包络 ∪ 全部部件：部件探出包络的部分同样成廓
  for (let i = 0; i < W * H; i++) if (cv.owner[i] >= 0) cv.sil[i] = 1;
  return F.A;
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
  rig: { topology: 'standard' | 'reverse'; shellMode: boolean; wScale: number; shinWRatio?: number; taperThigh?: number; taperShin?: number; altTone?: boolean; panelSparse?: boolean; shinBand?: boolean; shinInset?: boolean; shinPanel?: boolean; thighPanel?: boolean; mechSlim?: boolean; shinPiston?: boolean; calfScale?: number; shinConcave?: number; kneeScale?: number; thickRatio?: number };
  canvas: { w: number; h: number; groundY: number };
  anchors: Record<string, Pt & { y: number }>;
  volumes: unknown[];
  parts: { id: string; pattern: string; anchors: string[]; params: Record<string, number | string | boolean> }[];
}
const FOOT_TYPE = { footBlocks: 'blocks', footShoe: 'shoe', footClaw: 'claw', footPad: 'pad', footWheel: 'wheel' } as const;

/** 腿图条件求值（数据条件对规格求值，与 ArmWhen 同口径） */
function legWhen(w: LegWhen | undefined, spec: LegSpec): boolean {
  if (!w) return true;
  if ('all' in w) return w.all.every((q) => legWhen(q, spec));
  if ('not' in w) return !legWhen(w.not, spec);
  const v = (spec as unknown as Record<string, unknown>)[w.path];
  if (w.eq !== undefined) return v === w.eq;
  if (w.neq !== undefined) return v !== w.neq;
  if (w.truthy) return !!v;
  if (w.falsy) return !v;
  if (w.present) return v !== undefined;
  return true;
}

/** 腿图参数槽解析（口径见 leg-geom 头注） */
function legParam(p: LegParam, spec: LegSpec, scl: { ws: number; wsS: number; dF: number }): number | string | boolean {
  if (typeof p !== 'object') return p;
  const S = spec as unknown as Record<string, unknown>;
  if ('spec' in p) {
    const v = S[p.spec] ?? p.dflt;
    return p.eq !== undefined ? v === p.eq : (v as number | string | boolean);
  }
  if ('flag' in p) {
    const on = !!S[p.flag];
    return p.on !== undefined ? (on ? p.on : (p.off ?? 0)) : on;
  }
  if ('present' in p) return S[p.present] !== undefined;
  if ('anySpec' in p) return p.anySpec.some((k) => !!S[k]);
  const scale = p.scl === 'ws' ? scl.ws : p.scl === 'wsS' ? scl.wsS : p.scl === 'dF' ? scl.dF : 1;
  const mul = p.mul ? ((S[p.mul] as number | undefined) ?? p.mulDflt ?? 1) : 1;
  return p.base * scale * mul;
}

function legIR(spec: LegSpec): MechaIR {
  const std = spec.topology === 'standard';
  const hip = { x: 170, y: 44 };
  const knee = std ? { x: 236 + spec.bend, y: 248 } : { x: 112 + spec.bend, y: 244 };
  const ankle = { x: 178 + (std ? -1 : 1) * (spec.ankleShift ?? 10), y: 434 };
  const toe = { x: ankle.x + 100, y: 470 };
  const ws = spec.wScale ?? 1;
  const wsS = ws * (spec.shinWRatio ?? 1);
  const thWB = spec.taperThigh !== undefined ? 110 * ws * spec.taperThigh : 84 * ws;
  const shWB = spec.taperShin !== undefined ? 100 * wsS * spec.taperShin : 64 * wsS;
  const dF = spec.shinWRatio !== undefined ? (ws + wsS) / 2 : 1;
  const schemeName = Object.entries(SCHEMES).find(([, v]) => v === spec.scheme)?.[0] ?? 'olive';
  // 部件列 = LEG_GRAPH 走图（leg-geom）：入列条件、式选择与步参数
  // 全在图数据里，本函数只求值与拼列，不存装配决定
  const parts: MechaIR['parts'] = [];
  for (const step of LEG_GRAPH) {
    if (!legWhen(step.when, spec)) continue;
    const pattern = step.patternFrom
      ? (step.patternFrom.map[(spec as unknown as Record<string, unknown>)[step.patternFrom.path] as string] ?? step.patternFrom.dflt)
      : step.pattern;
    const params: Record<string, number | string | boolean> = {};
    for (const [k, v] of Object.entries(step.params ?? {})) params[k] = legParam(v, spec, { ws, wsS, dF });
    parts.push({ id: step.id, pattern, anchors: [...step.anchors], params });
  }
  return {
    version: 1, archetype: 'humanoid', scheme: schemeName, seed: spec.seed,
    style: { wear: spec.wear ?? 1, camo: spec.camo, cableTint: spec.cableTint, decalKind: spec.decalKind ?? 'num', lift: spec.lift ?? 0 },
    rig: { topology: spec.topology, shellMode: spec.shellMode ?? false, wScale: ws, shinWRatio: spec.shinWRatio, taperThigh: spec.taperThigh, taperShin: spec.taperShin, altTone: (spec as LegSpec & { altTone?: boolean }).altTone, panelSparse: spec.panelSparse, shinBand: spec.shinBand, shinInset: spec.shinInset, shinPanel: spec.shinPanel, thighPanel: spec.thighPanel, mechSlim: spec.mechSlim, shinPiston: spec.shinPiston, calfScale: spec.calfScale, shinConcave: spec.shinConcave, kneeScale: spec.kneeScale, thickRatio: spec.thickRatio },
    canvas: { w: W, h: H, groundY: 470 },
    anchors: { hip, knee, ankle, toe },
    volumes: [
      { kind: 'seg', a: 'hip', b: 'knee', wA: 110 * ws, wB: thWB },
      { kind: 'seg', a: 'knee', b: 'ankle', wA: 100 * wsS, wB: shWB },
      { kind: 'disc', c: 'hip', r: 36 * dF }, { kind: 'disc', c: 'knee', r: 34 * dF }, { kind: 'disc', c: 'ankle', r: 21 * dF },
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
    shellMode: ir.rig.shellMode, wScale: ir.rig.wScale, shinWRatio: ir.rig.shinWRatio, taperThigh: ir.rig.taperThigh, taperShin: ir.rig.taperShin, altTone: ir.rig.altTone, panelSparse: ir.rig.panelSparse, shinBand: ir.rig.shinBand, shinInset: ir.rig.shinInset, shinPanel: ir.rig.shinPanel, thighPanel: ir.rig.thighPanel, mechSlim: ir.rig.mechSlim, shinPiston: ir.rig.shinPiston, calfScale: ir.rig.calfScale, shinConcave: ir.rig.shinConcave, kneeScale: ir.rig.kneeScale, thickRatio: ir.rig.thickRatio, lift: ir.style.lift,
    guardOff: !part('guard'), detail: (part('detailSet')?.params.level as number) ?? 0,
    cableTint: ir.style.cableTint, decalKind: ir.style.decalKind,
    coreScale: (part('core')?.params.coreScale as number) ?? 1,
    footType: FOOT_TYPE[(foot?.pattern ?? 'footBlocks') as keyof typeof FOOT_TYPE],
  };
}
function renderIR(ir: MechaIR) {
  const spec = viewOf(ir);
  const cv = newCanvas();
  const A = layout(cv, spec, ir, { hip: ir.anchors.hip, knee: ir.anchors.knee, ankle: ir.anchors.ankle, toeX: ir.anchors.toe.x });
  return finishRender(cv, A, spec);
}

// ---------- 渲染 ----------
function render(spec: LegSpec) { return renderIR(legIR(spec)); }
/** FINISH 阶段图（数据）：着色渲染的阶段步列，次序即执行序。
 * 每步命名一个阶段算子（FINISH_OPS 里的本体函数），finishRender
 * 只按图走步。门控不在代码里：着色条目的步列展开成收尾规格
 * （开关/量/形参数），各算子只消费规格字段——组合选择在条目
 * 步列，算子内只有自身参数面 */
const FINISH_GRAPH: { op: string }[] = [
  { op: 'baseField' },
  { op: 'toneStretch' },
  { op: 'lift' },
  { op: 'shadow' },
  { op: 'discs' },
  { op: 'stamps' },
  { op: 'stripeSegs' },
  { op: 'deviceFrame' },
  { op: 'thighSlashes' },
  { op: 'cautionArrows' },
  { op: 'decals' },
  { op: 'bolts' },
  { op: 'balls' },
  { op: 'glows' },
  { op: 'rimWall' },
  { op: 'bevelBand' },
  { op: 'contactSeams' },
  { op: 'seams' },
  { op: 'ridgeBands' },
  { op: 'recessShadow' },
  { op: 'intake' },
  { op: 'wearEdge' },
  { op: 'wearScratch' },
  { op: 'wearStain' },
  { op: 'wearDirected' },
  { op: 'dust' },
  { op: 'blackGap' },
  { op: 'darkRim' },
  { op: 'outline' },
  { op: 'cleanup' },
];

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
  // 环算子（模式库「环」）：圆环按圆柱调绕周着色——亮在光向弧、
  // 暗在背光弧（角向调子场，与 toneFacing 同层）。盘模式的环带
  // 与一切环件共用此一实现（环 → 圆柱调）
  const ringShade = (base: RGB, ang: number): RGB => ramp(base, quant(0.72 + 0.22 * (0.45 * Math.cos(ang) - 0.89 * Math.sin(ang))));
  // 毂面（板件式小盖帽）：与环同向分面，但基线更高、跨度更平——
  // 毂是坐在环里的一块盖板，不是环面的一部分（盘 → 环 + 毂）
  const hubShade = (base: RGB, ang: number): RGB => ramp(base, quant(0.94 + 0.12 * (0.45 * Math.cos(ang) - 0.89 * Math.sin(ang))));
  // 凹底算子（模式库「凹底」）：栅腔的近黑底只有一种取色——框色
  // 按腔调压暗，永不取部件本色。腔内上影、肋间缝、大腿通风栅的
  // 槽底都是它（栅 → 凹底 + 肋 + 板件框）
  const recessShade = (f: number): RGB => ramp(S.frame, f);
  // 肋算子（模式库「肋」）：一根肋的相位剖面——自暗端渐亮（面）、
  // 在 peak 处触顶（叶面亮端 = 高光在肋上的落点）、其后回落（暗
  // 底边）。ph = 节距内相位，zone = 肋占节距的宽，fall = 横向落光
  const ribShade = (ph: number, zone: number, peak: number, fall: number, dark: RGB, light: RGB): RGB => {
    const t = ph / zone, g = t < peak ? t / peak : 1 - (t - peak) * 0.8;
    return ramp(mix(dark, light, g), fall);
  };
  // —— 以下三件是多阶段共用的算子，先于走步定义（原散在各阶段前）——
  const INK: RGB = [18, 18, 32]; // 描边链定色墨（黑隙与之同墨，深度语言一致）
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
  // 高光算子（单一实现）：把一条折线按 tone 画在登记件自身像素
  // 上（tone>1 为高光、<1 为暗线）。高光棱模式与缝模式都只调
  // 它画线，不许别处再写一份线着色
  const toneLine = (inst: number, pts: Pt[], tone: number, rad = 0.9) => {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (cv.owner[i] !== inst) continue;
      let dMin = 1e9, arcBest = 0, angBest = 0, cum = 0;
      for (let s = 0; s + 1 < pts.length; s++) {
        const ax = pts[s].x, ay = pts[s].y, bx = pts[s + 1].x, by = pts[s + 1].y;
        const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1;
        let tt = ((x - ax) * ex + (y - ay) * ey) / L2; tt = Math.max(0, Math.min(1, tt));
        const d = Math.hypot(x - (ax + ex * tt), y - (ay + ey * tt));
        if (d < dMin) { dMin = d; arcBest = cum + tt * Math.sqrt(L2); angBest = Math.atan2(Math.abs(ey), Math.abs(ex)); }
        cum += Math.sqrt(L2);
      }
      if (dMin <= rad) {
        // 斜边珠链（参考方块读法）：斜段（18°–72°）上的高光不是
        // 连续线，是逐台阶的亮珠——按弧长节距 2.2、占空 0.62 断
        // 开；横/竖段保持连续带
        const aDeg = angBest * 180 / Math.PI;
        if (aDeg >= 18 && aDeg <= 72 && arcBest % 2.2 > 2.2 * 0.62) continue;
        set(i, ramp(get(i), tone));
      }
    }
  };
  /** 阶段算子本体：每步一个命名函数，共享 finishRender 的场环境（画布/登记/种子流），块体与旧单体逐字一致 */
  const FINISH_OPS: Record<string, () => void> = {
    baseField: () => {
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
      if (inst.kind === 'foot') { base = (spec as LegSpec & { footAlt?: boolean }).footAlt ? S.armor2 : S.armor; f *= 0.85; } // 足随主体色；仅 footAlt 族（动力服）走副色靴
      if (inst.kind === 'guard') { base = S.armor; f *= 1.04; } // 护板与段板分面（体积靠剖面本身）
      const cr = A.colorRole?.get(o); if (cr === 'armor') base = S.armor; else if (cr === 'armor2') base = S.armor2; else if (cr === 'accent') base = S.accent; else if (cr === 'mark') base = S.mark ?? S.accent; else if (cr === 'steel') base = S.metal; else if (cr === 'frame') base = S.frame; // frame 色角色此前不在解析表里：写 role 'frame' 的件会被当无 role 走缺省底色（步枪握把实测仍是装甲色）——补上消费端
      // 迷彩只上装甲底色：显式上漆的件（强调色/双色调色块）是
      // 漆面决定、不许被迷彩混色（躯干条纹曾被混成荧光黄——
      // 强调色块与迷彩同开时才发作，腿的饰带因 continue 躲过）
      if (spec.camo && !cr && vnoise(x / 58, y / 40, spec.seed + 3) > 0.62) base = mix(base, shade2(S.armor2, 0.8), 0.7);
      let c = ramp(base, f);
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
      // 警示纹在细节段按线段距离盖章（见下方 chevrons），此处不处理
      // 鞋底纹：脚底横向刻槽
      if (inst.kind === 'foot' && y > 470 && (x % 13) < 6) c = ramp(base, f * 0.5);
      if (inst.kind === 'foot' && v > 0.78) c = ramp(base, f * 0.68); // 鞋底带
      // 通风栅：大腿下板一块栅格
            if (o === A.ventId && u > -0.42 && u < 0.26 && v > 0.13 && v < 0.25) { // 带幅收至板高 0.12/板长 0.68（原 0.20/0.86 整机读作黑带）
        const cyc = y % 12; // 凹槽 = 凹底（槽顶影/槽底）+ 槽下唇高光；槽间的肋即板面自身（肋 → 板件）
        if (cyc < 2) c = recessShade(0.5);
        else if (cyc < 8) c = recessShade(0.42); // 槽体减黑（原 0.32 近黑）
        else if (cyc < 9) c = ramp(S.armor2, 1.05); // 槽下唇受光（高光落点）
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
    },
    toneStretch: () => {
  // 全局调色拉伸：暗更暗、亮更亮（拉开 std 与深暗部，细节盖章在其后保持 crisp）
  for (let i = 0; i < W * H; i++) {
    if (!cv.sil[i] || cv.col[i * 4 + 3] === 0) continue;
    for (let ch = 0; ch < 3; ch++) cv.col[i * 4 + ch] = Math.max(0, Math.min(255, (cv.col[i * 4 + ch] - 26) * 1.24 + 10));
  }
    },
    lift: () => {
  // 分族明度抬升（逐族对参考明度带）
  { const lift = spec.lift ?? 0; if (lift) for (let i = 0; i < W * H; i++) { if (!cv.sil[i] || cv.col[i * 4 + 3] === 0) continue; for (let ch = 0; ch < 3; ch++) cv.col[i * 4 + ch] = Math.min(255, cv.col[i * 4 + ch] + lift); } }
    },
    shadow: () => {
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
    },
    discs: () => {
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
      // 盘 = 环 + 毂：环带走环算子（ringShade）；登记 hub 者毂面
      // 走毂面着色（板件式盖帽）、毂根一道凹缝把两者分开——旧
      // 配方整面一块刻面、毂只是环面乘 1.17，无组合关系
      let c = ringShade(dBase, fa);
      if (d.hub) { if (rr < 0.34) c = hubShade(dBase, fa); else if (rr < 0.43) c = ramp(c, 0.66); }
      // 毂上算子（各自独立、按登记叠加，不是整式互斥）：毂槽 =
      // 毂面一条对角深槽（主战/重型大盘——参考槽是近黑深沟、毂
      // 底本身已是深枪灰，压暗须到 0.22 才读得出）；毂框 = 毂心
      // 一圈浅色方框轮廓 + 芯面略沉（敏捷盘是暗盘亮框、动力服方
      // 壳是黑壳亮芯，两样本同为亮轮廓）
      if (d.hub && rr < 0.34) {
        if (spec.hubGroove && rr < 0.30 && Math.abs(dy - dx) < 0.11) c = ramp(c, 0.22);
        if (spec.hubFrame === 'square') { const m = Math.max(Math.abs(dx), Math.abs(dy)); if (m > 0.14 && m < 0.24) c = ramp(c, 1.32); else if (m <= 0.14) c = ramp(c, 0.78); }
      }
      // 盘沿 = 厚圆盘的圆柱侧壁：上沿受光、下沿沉暗（参考膝/踝盘
      // 沿上亮下暗），最外一线再压暗收口——不是一圈平色收边
      if (rr > 0.86) { const wall = 0.94 - 0.30 * dy; c = ramp(c, rr > 0.97 ? wall * 0.82 : wall); }
      set(i, c);
    }
  }
    },
    stamps: () => {
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
    },
    stripeSegs: () => {
  // 漆带（模式：沿线段在指定板面上漆强调色带；缺省落小腿壳板
  // shinIds、半宽 6.5——胫骨斜带与车体贯穿带共用此一画法，站点
  // 只登记线段、目标板与半宽）
  const lumOf = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const roleBaseOf = (o: number): RGB => { const r = A.colorRole?.get(o); return r === 'armor2' ? S.armor2 : r === 'steel' ? S.metal : r === 'accent' ? S.accent : r === 'mark' ? (S.mark ?? S.accent) : S.armor; };
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
      if (m < hw) {
        // 漆带继承承载面明暗（漆带 → 板面调）：分母 = 承载件底色 ×
        // 其 plateTint，分子 = 当前像素亮度（已含面调/斑驳/投影），
        // 比值即承载面的局部调子场；漆色 = 基准漆色 × 该比值（连续
        // 乘法，不走 rampQ 量化——量化步距会把面调差整段吞掉，实测
        // 全件零变化；直乘在描边/黑隙 pass 已有先例）
        const o = cv.owner[i];
        const den = lumOf(roleBaseOf(o)) * (A.plateTint.get(o) ?? 1);
        const fl = den > 1 ? Math.max(0.45, Math.min(1.1, lumOf(get(i)) / den)) : 1;
        const bc = ramp(S.accent, 0.95);
        set(i, [bc[0] * fl, bc[1] * fl, bc[2] * fl]);
      }
    }
  }
    },
    deviceFrame: () => {
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
    },
    thighSlashes: () => {
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
    },
    cautionArrows: () => {
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
    },
    decals: () => {
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
  if (A.decalKind === 'num') drawText(A.decalPos, 'CAUTION', 2, ramp(S.decal, 1.0), true, A.guardId);
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
  // 警示三角（CAUTION 上方、同属载具模板字档）
  if (A.decalKind === 'num') {
    const cx = Math.round(A.decalPos.x), cy = Math.round(A.decalPos.y) - 16;
    for (let dy = 0; dy < 9; dy++) for (let dx = -dy / 2; dx <= dy / 2; dx++) {
      const px = cx + Math.round(dx), py = cy + dy;
      if (px >= 0 && px < W && py >= 0 && py < H && cv.sil[py * W + px]) set(py * W + px, ramp(S.accent, 1.0));
    }
  }
    },
    bolts: () => {
  // 铆钉/栓 = 栓框 × 栓芯两个算子的组合（着色算子 boltframe /
  // boltcore）：框分方/环/无，芯分暗点/半球。方口栓 = 方框+
  // 暗芯（主战/重型/敏捷）、圆环栓 = 环框+暗芯（动力服）、半球栓 =
  // 无框+半球芯（旧缺省）。芯缺省：有框走暗芯、无框走半球芯（旧
  // 行为 = 无框半球 r 1.6——深框色表达不出亮面与高光，实测全团
  // 发黑，故半球走钢色球面着色）
  for (const p of A.boltPts) {
    const bx = Math.round(p.x), by = Math.round(p.y);
    const core = spec.boltCore ?? (spec.boltFrame ? 'dark' : 'dome');
    if (core === 'dome') domePx(p.x, p.y, spec.boltFrame ? 2.2 : 1.6, S.metal);
    if (spec.boltFrame === 'square') {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const px = bx + dx, py = by + dy;
        if (px < 0 || px >= W || py < 0 || py >= H || !cv.sil[py * W + px]) continue;
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        if (m === 2) set(py * W + px, ramp(S.frame, 0.8));
        else if (m === 1) set(py * W + px, ramp(S.metal, 0.9));
      }
    } else if (spec.boltFrame === 'ring') {
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const px = bx + dx, py = by + dy;
        if (px < 0 || px >= W || py < 0 || py >= H || !cv.sil[py * W + px]) continue;
        const dist = Math.hypot(dx, dy);
        if (dist > 2.5 || dist <= 0.8) continue;
        set(py * W + px, dist > 1.5 ? ramp(S.frame, 0.75) : ramp(S.metal, 1.1));
      }
    }
    if (core === 'dark') {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (Math.hypot(dx, dy) > 0.8) continue;
        const px = bx + dx, py = by + dy;
        if (px < 0 || px >= W || py < 0 || py >= H || !cv.sil[py * W + px]) continue;
        set(py * W + px, ramp(S.frame, 0.45));
      }
    }
  }
    },
    balls: () => {
  // 球模式：整球与半球同配方（球面法线场相同），差别在反光
  // 环更整圈、且球体自带轮廓——登记走 A.balls（如瞄具桅球）
  for (const b of A.balls ?? []) domePx(b.x, b.y, b.r, b.role === 'accent' ? S.accent : b.role === 'steel' ? S.metal : S.frame);
    },
    glows: () => {
  // 信号灯：亮芯 + 光晕
  // 发光组合（模式库「发光」= 暗座 + 亮芯 + 檐压边）：登记过的
  // 发光（头眼）亮芯由 pass 按座框裁剪——芯画出座外一像素都不许；
  // 未登记的光点（腿部指示灯）先在芯下落一个凹底暗窝再画芯，
  // 亮必坐座，不许裸亮贴在亮面上
  const paintCore = (p: Pt, inside?: (x: number, y: number) => boolean, s = 1, phase: 'all' | 'body' | 'core' = 'all', rMax = 2): void => {
    const bx = Math.round(p.x), by = Math.round(p.y);
    // 轮廓值 s：亮芯的半径与亮度随之收分——峰处饱满（热芯 + 2px
    // 晕）、尾处只剩一点暗光。等亮点列画不出参考那颗收尾的光体，
    // 轮廓是发光算子的一维（生成器在点上带 s，pass 照单执行）。
    // 晕身锚配色的饱和端：accent 按 s 提亮（0.85→1.4 档）。只拿
    // glow 乘亮时 R 先钳顶、色相被冲成奶黄（主战眼实测均色
    // [253,222,106]，参考是 [221,160,65] 的饱和橙）；热芯仍走
    // glow 提亮，只许峰值 s 的中心一列。肥瘦：峰段半径 rMax 由
    // 座高定（登记座的光体要填满座高——固定 2 让高座里的眼只剩
    // 一条 3px 细线、座下半截空黑，参考的透镜前段是填满座高的
    // 泪滴）；无座光点（腿部指示灯）rMax 缺省 2 不变
    const R = s >= 0.9 ? rMax : s >= 0.35 ? Math.max(1, Math.round(rMax * 0.62)) : 0;
    const body = ramp(S.accent, 0.85 + 0.55 * s);
    for (let dy = -rMax; dy <= rMax; dy++) for (let dx = -rMax; dx <= rMax; dx++) {
      const px = bx + dx, py = by + dy, d = Math.abs(dx) + Math.abs(dy);
      if (px < 0 || px >= W || py < 0 || py >= H || !cv.sil[py * W + px]) continue;
      if (inside && !inside(px, py)) continue;
      if (d === 0) { if (phase !== 'body') set(py * W + px, s >= 0.75 ? ramp(S.glow, 1.14) : ramp(S.glow, 0.85 + 0.4 * s)); }
      else if (d <= R && phase !== 'core') set(py * W + px, body);
    }
  };
  for (const g of A.glows ?? []) {
    const inside = (x: number, y: number): boolean => {
      const dx = x - g.cx, dy = y - g.cy;
      const lx = dx * g.cos + dy * g.sin, ly = -dx * g.sin + dy * g.cos;
      return Math.abs(lx) <= g.hw + 1 && Math.abs(ly) <= g.hh + 1; // +1 容座自身的描边行
    };
    // 光体峰半径按座高定：填满座高的泪滴（座半高 4.6 → 峰半径 3）
    const rMax = Math.min(3, Math.max(2, Math.round(g.hh * 0.7)));
    // 两遍画：先全列晕身、再全列亮芯。逐点一遍画时，相邻印章的
    // 晕身（d=1 环）会盖掉前一颗刚画的芯，芯线只剩首尾两点——
    // 缝眼读成无芯的平带。芯后画，芯线才连续（与缆管量到线段同理：
    // 点列是折线采样，画法按连续体对待）
    // 晕身遍同样沿线段补点：逐点盖章的轮廓在半径变化处成锯齿，
    // 光体的次级轮廓（泪滴外形线）须与芯同为连续体
    for (let i = 0; i < g.pts.length; i++) {
      const p = g.pts[i], q = g.pts[i + 1];
      paintCore(p, inside, p.s, 'body', rMax);
      if (!q) break;
      const steps = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y));
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        paintCore({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }, inside, (p.s ?? 1) + ((q.s ?? 1) - (p.s ?? 1)) * t, 'body', rMax);
      }
    }
    // 芯遍沿点列线段补点：点列在局部坐标按 ~1px 采样，整头缩放
    // 落到画布后步长 ~1.3px，逐点盖章的芯（只有中心 1px）必然周期
    // 性跳格、断成虚线（晕身有半径、跳格被桥住，故只芯断）。按线段
    // 以 ≤1px 步补齐中心、s 线性插值，芯才与晕身同为连续体
    for (let i = 0; i < g.pts.length; i++) {
      const p = g.pts[i], q = g.pts[i + 1];
      paintCore(p, inside, p.s, 'core', rMax);
      if (!q) break;
      const steps = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y));
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        paintCore({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }, inside, (p.s ?? 1) + ((q.s ?? 1) - (p.s ?? 1)) * t, 'core', rMax);
      }
    }
  }
  for (const p of A.lightPts) {
    const bx = Math.round(p.x), by = Math.round(p.y);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const px = bx + dx, py = by + dy;
      if (px < 0 || px >= W || py < 0 || py >= H || !cv.sil[py * W + px]) continue;
      if (dx * dx + dy * dy <= 9) set(py * W + px, recessShade(0.5)); // 暗座窝（凹底）
    }
    paintCore(p);
  }
    },
    rimWall: () => {
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
    },
    bevelBand: () => {
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
    },
    contactSeams: () => {
  // 接触缝合成（spec.stackSeams，头部）：头部板件此前零登记，
  // 边界全靠零件间隙、缝算子对头无作用对象。按 owner 图合成
  // 登记：后画件（owner 序大）压先画件的接触边 = 先画件上的一道
  // 沟，唇朝先画件内侧。逐行/逐列取同一对（下件,上件）的连续
  // 接触像素成段；合成缝与手登记缝走同一条 pass，无第二实现，
  // 宽度同样吃 seamScale 族档位
  if (spec.stackSeams) {
    const seams = A.seams ?? (A.seams = []);
    // 沟线压进下件 0.5px：下件边缘行落在沟的背光侧（暗）、再内
    // 一行落在受光侧（唇）——与缝 pass 的符号约定对齐；唇段只
    // 定方向、再往下件内侧偏 2px
    for (let y = 0; y < H - 1; y++) { // 横边：相邻两行之间
      let a = -1, b = -1, x0 = 0;
      const flush = (x1: number) => { if (a >= 0) { const above = a === cv.owner[y * W + x0]; const gy = above ? y : y + 1, ly = above ? y - 2 : y + 3; seams.push({ inst: a, pts: [{ x: x0 - 0.5, y: gy }, { x: x1 + 0.5, y: gy }], lipPts: [{ x: x0 - 0.5, y: ly }, { x: x1 + 0.5, y: ly }], w: 0.9 }); a = -1; } };
      for (let x = 0; x < W; x++) {
        const o1 = cv.owner[y * W + x], o2 = cv.owner[(y + 1) * W + x];
        const under = o1 >= 0 && o2 >= 0 && o1 !== o2 ? Math.min(o1, o2) : -1;
        const over = under >= 0 ? Math.max(o1, o2) : -1;
        if (under !== a || over !== b) { flush(x - 1); if (under >= 0) { a = under; b = over; x0 = x; } }
      }
      flush(W - 1);
    }
    for (let x = 0; x < W - 1; x++) { // 竖边：相邻两列之间
      let a = -1, b = -1, y0 = 0;
      const flush = (y1: number) => { if (a >= 0) { const left = a === cv.owner[y0 * W + x]; const gx = left ? x : x + 1, lx = left ? x - 2 : x + 3; seams.push({ inst: a, pts: [{ x: gx, y: y0 - 0.5 }, { x: gx, y: y1 + 0.5 }], lipPts: [{ x: lx, y: y0 - 0.5 }, { x: lx, y: y1 + 0.5 }], w: 0.9 }); a = -1; } };
      for (let y = 0; y < H; y++) {
        const o1 = cv.owner[y * W + x], o2 = cv.owner[y * W + x + 1];
        const under = o1 >= 0 && o2 >= 0 && o1 !== o2 ? Math.min(o1, o2) : -1;
        const over = under >= 0 ? Math.max(o1, o2) : -1;
        if (under !== a || over !== b) { flush(y - 1); if (under >= 0) { a = under; b = over; y0 = y; } }
      }
      flush(H - 1);
    }
  }
    },
    seams: () => {
  // 缝模式（单一实现）：一道缝 = 一条沟，横截面分段给调子
  // ——沟底 ×0.55、背光侧沟壁同沟底、受光侧沟壁 ×1.2：高光
  // 渗透到缝里（亮在沟内），缝外不画任何亮带（用户立）。高
  // 光的施加与高光算子同式（对现色 ramp 乘倍率）；lipPts 只
  // 定哪一侧是受光侧、本身不画。不登记的件不走此路；
  // spec.seams=false 时整表不画
  for (const sm of spec.seams === false ? [] : A.seams ?? []) {
    const w = (sm.w ?? 0.9) * (spec.seamScale ?? 1);
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
    },
    ridgeBands: () => {
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
    toneLine(r.inst, r.pts, r.tone);
    const b = bandOf.get(r.pts);
    if (b) bandShade(b);
  }
    },
    recessShadow: () => {
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
    },
    intake: () => {
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
    // 叶片材质：金属（胸口）/ 强调色（荚口变体）；slatBlue = 金属向 armor2
    // 掺混（叶片带承载族的蓝色，如敏捷参考的蓝灰叶面）、slatTone = 叶面
    // 整体明度倍率（缺省 1/0 = 校准原值，其余族逐值不变）
    const slatBase = IP?.accentSlats ? S.accent : IP?.slatBlue ? mix(S.metal, S.armor2, IP.slatBlue) : S.metal;
    const slatDark = ramp(slatBase, 0.42 * (IP?.slatTone ?? 1)), slatLight = ramp(slatBase, 1.04 * (IP?.slatTone ?? 1));
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
        if (ly <= shadowH) c = recessShade(0.48); // 腔内上影 = 凹底
        else {
          const yy = ly - shadowH - 1, ph = yy % pitch, zone = pitch * 0.76, peak = IP?.peak ?? 0.75; // 缝占节距 24%
          if (ph < zone) c = ribShade(ph, zone, peak, fall, slatDark, slatLight); // 肋（叶片）
          else c = recessShade(0.5 * fall + 0.12); // 肋间缝 = 凹底
        }
        set(i, c);
      }
    }
  }
    },
    wearEdge: () => {
  // 做旧一：啃边（剪影边缘高频噪声咬成内框色）
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!cv.sil[i]) continue;
    const edge = !cv.sil[i - 1] || !cv.sil[i + 1] || !cv.sil[i - W] || !cv.sil[i + W];
    if (edge && vnoise(x / 3.1, y / 3.1, spec.seed + 5) > 0.78) set(i, hash2(x, y, spec.seed + 31) > 0.45 ? ramp(mix(S.frame, S.chrome, 0.55), 1.05) : ramp(S.frame, 1.15));
  }
    },
    wearScratch: () => {
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
    },
    wearStain: () => {
  // 做旧二点五：磨损斑（锈色斑块 + 暗斑，强度按配色 wear）。
  // 污痕的落点律（算子识别·二轮）：褐渍挂在每块板的下缘与角部，
  // 不写板面中部——按像素在本板纵向的位置加权（下 45% 渐强、
  // 底缘满强），中面只剩一成；无主像素（内构）三成
  {
    const wear = spec.wear ?? 0;
    if (wear > 0) {
      const yLo = new Map<number, number>(), yHi = new Map<number, number>();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = cv.owner[y * W + x];
        if (o < 0) continue;
        if (!yLo.has(o)) { yLo.set(o, y); yHi.set(o, y); } else if (y > (yHi.get(o) ?? y)) yHi.set(o, y);
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!cv.sil[i]) continue;
        const o = cv.owner[i];
        let lw = 0.3, vv = 0;
        if (o >= 0 && yLo.has(o)) { const span = Math.max(1, (yHi.get(o) ?? y) - (yLo.get(o) ?? y)); vv = (y - (yLo.get(o) ?? y)) / span; lw = 0.1 + 0.9 * Math.min(1, Math.max(0, (vv - 0.55) / 0.45)); }
        const n = vnoise(x / 13, y / 13, spec.seed + 21);
        if (n > 0.665) { const b = Math.min(0.75, 0.55 * wear * Math.min(1, (n - 0.665) * 4) * lw * (1 + 0.5 * Math.min(1, Math.max(0, (vv - 0.8) / 0.2)))); if (b > 0.02) set(i, mix(get(i), [146, 86, 48], b)); }
        else if (n < 0.3) set(i, ramp(get(i), 1 - 0.16 * wear * (0.3 + 0.7 * lw)));
        // 下缘渍带：参考里污痕沿板底缘成带（不只是斑点）——底 15%
        // 恒有一层薄褐渍，噪声只调其浓淡
        if (vv > 0.85) { const bb = 0.13 * wear * ((vv - 0.85) / 0.15) * (0.7 + 0.6 * n); if (bb > 0.02) set(i, mix(get(i), [146, 86, 48], bb)); }
      }
    }
  }
    },
    wearDirected: () => {
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
    },
    dust: () => {
  // 做旧三：底部积尘（越靠下越暗 + 斑驳）
  for (let y = Math.floor(H * 0.72); y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!cv.sil[i] || cv.col[i * 4 + 3] === 0) continue;
    const t = (y / H - 0.72) / 0.28;
    const f = 1 - 0.16 * t * (0.6 + 0.4 * vnoise(x / 6, y / 6, spec.seed + 9));
    set(i, ramp(get(i), f));
  }
    },
    blackGap: () => {
  // （接地阴影已移除：它不是机甲的一部分，属于展示层，不进生成管线——2026-11-06 用户裁定）
  // 黑隙（模式库「黑隙」算子）：压覆件（盘/护板/足——真正叠在别的
  // 件之上的构件）与被压件相接处必有黑缝：被压件贴着压覆件的那一
  // 行像素压到描边同深。同件内部的拼贴界（楔块相邻等）不在此列，
  // 那里有缝/楔自己的线。深度语言与描边链一致（黑隙 → 描边链）
  { const amt = spec.blackGap ?? 0;
    if (amt > 0) {
      const FRONT = new Set(['disc', 'guard', 'foot']);
      const frontAt = (j: number): boolean => { const oo = cv.owner[j]; return oo >= 0 && (FRONT.has(cv.insts[oo].kind) || (A.pressIds?.has(oo) ?? false)); };
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x, o = cv.owner[i];
        if (o < 0 || !cv.sil[i] || FRONT.has(cv.insts[o].kind)) continue;
        if ((cv.owner[i - 1] > o && frontAt(i - 1)) || (cv.owner[i + 1] > o && frontAt(i + 1)) || (cv.owner[i - W] > o && frontAt(i - W)) || (cv.owner[i + W] > o && frontAt(i + W))) {
          set(i, mix(get(i), INK, amt));
        }
      }
    } }
    },
    darkRim: () => {
  // 暗沿（模式库「暗沿」算子）：背光侧（下/后，影落向）剪影内一像素
  // 暗带——先标剪影边，非边像素若其下邻或后邻是边像素即在暗沿带上
  { const amt = spec.darkRim ?? 0;
    if (amt > 0) {
      const edge = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (cv.sil[i] && (!cv.sil[i - 1] || !cv.sil[i + 1] || !cv.sil[i - W] || !cv.sil[i + W])) edge[i] = 1;
      }
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!cv.sil[i] || edge[i]) continue;
        if (edge[i + W] || edge[i - 1]) set(i, ramp(get(i), 1 - amt));
      }
    } }
    },
    outline: () => {
  // 描边（模式库「描边链」算子）：剪影最外圈 = 定色墨线。参考
  // 描边是纯黑链（取样中位 RGB≈(20,20,38)，带蓝的近黑），不随
  // 本色缩放——旧式 ×0.3 在白甲上只得灰线、在深色甲上才近黑
  if (spec.outline !== false) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!cv.sil[i]) continue;
    if (!cv.sil[i - 1] || !cv.sil[i + 1] || !cv.sil[i - W] || !cv.sil[i + W]) set(i, INK);
  }
    },
    cleanup: () => {
  // 末端清扫：中途各 pass 按剪影迭代可能给无主像素上过色，统一清回透明（只清剪影内）
  for (let i = 0; i < W * H; i++) {
    if (cv.sil[i] && cv.owner[i] < 0) cv.col[i * 4 + 3] = 0;
  }
    },
  };
  for (const step of FINISH_GRAPH) FINISH_OPS[step.op]();
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
function makeLayerTools(cv: MechaCanvas, seed: number, bs?: BlockShapeParams, opts?: { panelLines?: boolean; tightTint?: boolean }): LayerTools {
  const rnd = mulberry32(seed);
  let id = 0;
  const A: Anchors = { plateTint: new Map(), panelLines: new Map(), boltPts: [], ventId: -1, guardId: -1, stripeId: -1, decalPos: { x: 0, y: 0 }, numPos: { x: 0, y: 0 }, numText: '', lightPts: [], discs: [], chevrons: [], seamU: new Map(), insignia: { pos: { x: 0, y: 0 }, kind: 0 }, stripeThigh: -1, blockPlates: new Set(), deviceFrame: null, chevDecal: true, shinIds: new Set(), stripeSegs: [], panelDiag: new Map(), panelTee: new Map(), decalKind: 'num', toeFace: null, colorRole: new Map() };
  const tints = [0.78, 0.9, 1.0, 1.1, 1.24];
  const reg = (myId: number) => {
    // 紧调档（头部）：头盔是一个壳——相邻壳板的随机调差不许拉
    // 满五档（0.78 vs 1.24 = 1.6 倍亮差），否则两块大板共边处
    // 读成一条假分界线（实证：敏捷穹 255 vs 盔体 140 的横贯悬
    // 崖）。头部抽窄三档（0.95/1.0/1.05），板间区分靠刻面与缝；
    // 随机流仍只消费一次、后续抽签不受影响
    A.plateTint.set(myId, opts?.tightTint ? [0.95, 1.0, 1.05][Math.floor(rnd() * 3)] : tints[Math.floor(rnd() * 5)]);
    // 随机面板线只许在站点明确要的部位出现：头部关（env 面板线
    // 档）——头上的线只能来自图的构造步（壳缝/颊线/接触缝），随
    // 机横线落在头盔大板上就是一条无见证的水平线（实证：敏捷头
    // 后脑/盔体两块大板各抽一条、位置相近叠成显眼横条）
    const noLines = opts?.panelLines === false;
    const lines: number[] = []; const n = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) lines.push(0.3 + rnd() * 0.45);
    A.panelLines.set(myId, noLines ? [] : lines); // 随机流照常消费，只是不登记（免牵动后续抽签）
    // 不登记自动竖缝（用户定）：随机位置的全高竖线与横线在板面
    // 上组成十字，那不是装甲板该有的缝——板的竖向分界只能来自
    // 构造（另一块板、T 型接头、显式登记的缝）
    if (rnd() < 0.3) { rnd(); } // 随机斜置已废（同 addPlate 处审计注）：横线平行板端边，随机流照常消费、只是不登记
    if (rnd() < 0.35) { const t = 0.1 + rnd() * 0.8; if (!noLines) A.panelTee.set(myId, t); }
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
  const wing = (cx: number, cy: number, len: number, wRoot: number, wTip: number, ang: number, cut = 0) => { const c = Math.cos(ang), s = Math.sin(ang), loc: Pt[] = cut > 0
    ? [{ x: -len / 2, y: -wRoot / 2 }, { x: len / 2 - cut * len, y: -wTip / 2 }, { x: len / 2, y: wTip / 2 }, { x: -len / 2, y: wRoot / 2 }]
    : [{ x: -len / 2, y: -wRoot / 2 }, { x: len / 2, y: -wTip / 2 }, { x: len / 2 + wTip * 0.7, y: 0 }, { x: len / 2, y: wTip / 2 }, { x: -len / 2, y: wRoot / 2 }]; return addPoly(loc.map((p) => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }))); }; // 翼板：根宽尖细的薄板（厚度走全局边面组）；cut>0 时是扫掠刃形（正样实读：迎风长边全长直扫、背风边短一截、尖偏长边——对称收分只会画成等腰三角）；鳍只是刃身，根部不出檐（檐归座）
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
  | { t: 'block'; frame: ArmFrame; along: number; perp: number; w: number; h: number; angOff?: number; kind?: Kind; cham?: number; bolts?: boolean; role?: 'stripe' | 'armor' | 'armor2' | 'accent' | 'mark'; inset?: { fw: number; fh: number }; faceW?: number }
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
  /** 前臂顺轴带（模式：前臂壳面纵走一条副色带）：perp/w 以 bulk
   * 倍率计（perp 负 = 背侧），along/len 以 foreLen 比计 */
  foreBand?: { perp: number; w: number; along: number; len: number; role: 'accent' | 'armor2' };
  /** —— 以下皆 DAG 数据（族差异只许落在这里，armIR 内零族别分支）—— */
  /** 前臂腕端 armor2 带（略窄于基板的一段端带） */ foreTipBand?: boolean;
  /** 上臂条纹组：肩裙下沿之下沿轴排的 armor2 细带条数（参考定形
   * 为 3 道、带与间隙近等宽；单段根带旧式落在肩壳覆盖区内、是
   * 画不出来的死漆，已废） */ upperRootStripes?: number;
  /** 前臂横条纹组：前臂中段的 armor2 粗横带条数（动力服池图 2 道） */ foreStripes?: number;
  /** 肩盘半径对 [外, 毂]（以 bulk 计；未设 = [15, 8.5]，主战实测 [19, 11]） */ shoulderDisc?: [number, number];
  /** 肩钟主块的色角色（敏捷白甲 'armor'、动力服橙穹 'armor2'、未设 = 轮换缺省） */ shellRole?: 'armor' | 'armor2';
  /** 肩面嵌板式：'window' 方凹窗（敏捷）/'slots' 白面板+散热槽列（动力服） */ shoulderPanel?: 'window' | 'slots';
  insignia?: { kind: number; along: number; perp: number }; // 徽章模式：有没有徽章是模式、徽章在哪是它的参数（kind 种类 + 肩框落点 along/perp）
}
interface ArmIR { anchors: Record<'shoulder' | 'elbow' | 'wrist' | 'palm', Pt>; parts: ArmPart[] }
/** 拳手算子：指链正向运动学——四指三列（侧面取三列）每指三段渐
 * 细、关节盘、逐节累进卷曲，拇指自掌前下角两段前指；关节位在
 * 腕框里走、逐节转回腕框记录（指长/卷曲/体量是规格数据） */
function fistParts(spec: ArmSpec, elbow: Pt, wrist: Pt): ArmPart[] {
  const parts: ArmPart[] = [];
  const b = spec.bulk;
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
  return parts;
}

// ---------- 臂图展开器：模板（ARM_GRAPH 数据）→ 部件列 ----------
// 臂模板就是数据（arm-geom 的 ARM_GRAPH/ARM_GEOM）：步骤序 = 画
// 序，式与装备的选择全在 when 条件数据里，部件记录是带标度标
// 注的数据。展开器只按图走：求值条件、展开记录标度、调算子
// （段板行/拳手/肩钟等），锚点链由根与角度数据算出——不存臂的
// 装配决定。部件列由 renderArmIR 解释（段框词汇），与头部同一
// 纪律：实例（规格）+ 模板（图）自己展开成节点列。
function armWhen(when: ArmWhen | undefined, spec: ArmSpec): boolean {
  if (!when) return true;
  if ('all' in when) return when.all.every((w2) => armWhen(w2, spec));
  let v: unknown = spec;
  for (const k of when.path.split('.')) v = (v as Record<string, unknown> | undefined)?.[k];
  if (when.eq !== undefined) return v === when.eq;
  if (when.neq !== undefined) return v !== when.neq;
  if (when.present) return v !== undefined && v !== null;
  return !!v;
}

function armIR(spec: ArmSpec): ArmIR {
  const dir = (a: number): Pt => ({ x: Math.sin(a), y: Math.cos(a) });
  const shoulder = spec.root;
  const du = dir(spec.upperAng), df = dir(spec.upperAng + spec.elbowBend);
  const elbow = { x: shoulder.x + du.x * spec.upperLen, y: shoulder.y + du.y * spec.upperLen };
  const wrist = { x: elbow.x + df.x * spec.foreLen, y: elbow.y + df.y * spec.foreLen };
  const palm = { x: wrist.x + df.x * ARM_GEOM.palmOff, y: wrist.y + df.y * ARM_GEOM.palmOff };
  const b = spec.bulk, sh = spec.shell, parts: ArmPart[] = [];
  const scaleVal = (s: ArmScale): number => s === 'b' ? b : s === 'sh' ? sh : s === 'foreLen' ? spec.foreLen : spec.upperLen;
  const emitAPart = (rec: APart): void => {
    const { scl, ...rest } = rec;
    const p = { ...rest } as Record<string, unknown>;
    if (scl) for (const [f, s] of Object.entries(scl)) if (typeof p[f] === 'number') p[f] = (p[f] as number) * scaleVal(s);
    parts.push(p as ArmPart);
  };
  for (const step of ARM_GRAPH) {
    if (!armWhen(step.when, spec)) continue;
    switch (step.op) {
      case 'coreRun': { // 段核行算子：两段各 3 节、宽按数据插值（bulk 倍率）
        for (const seg of ['upper', 'fore'] as const) { const [w0, w1] = ARM_GEOM.coreW[seg]; for (let k = 0; k < 3; k++) parts.push({ t: 'segCore', seg, w0: (w0 + (w1 - w0) * (k / 3)) * b, w1: (w0 + (w1 - w0) * ((k + 1) / 3)) * b, s0: k / 3 + 0.01, s1: (k + 1) / 3 - 0.01 }); }
        break;
      }
      case 'plateRun': { // 段板行算子：按段长分段插值；腕端带/根条纹组/条纹角色全由规格数据驱动
        const seg = step.seg!;
        const len = seg === 'upper' ? spec.upperLen : spec.foreLen;
        const w0 = ARM_GEOM.plateW[seg][0] * b, w1 = ARM_GEOM.plateW[seg][1] * b;
        // 前臂横条纹组 = 段板本体的染色（不是外挂板）：带数在规格
        // 数据里，板数随带数定（带居中段），中段板染 armor2——与
        // 上臂条纹组同属「条纹组」算子（动力服池图：前臂白-橙-橙-白）
        const n = seg === 'fore' && spec.foreStripes ? spec.foreStripes + 2 : Math.max(2, Math.round(len / 68));
        for (let k = 0; k < n; k++) parts.push({ t: 'segPlate', seg, w0: w0 + (w1 - w0) * (k / n), w1: w0 + (w1 - w0) * ((k + 1) / n), s0: 0.04 + (0.93 * k) / n + 0.0015, s1: 0.04 + (0.93 * (k + 1)) / n - 0.0015, role: seg === 'fore' && spec.foreStripes && k >= 1 && k <= spec.foreStripes ? 'armor2' : seg === 'fore' && k === 0 && spec.gear.stripe ? 'stripe' : undefined });
        if (spec.foreTipBand && seg === 'fore') parts.push({ t: 'segPlate', seg, w0: (w0 + (w1 - w0) * 0.88) * 0.97, w1: w1 * 0.97, s0: 0.9, s1: 0.985, role: 'armor2' }); // 腕端带（略窄于基板，免四角戳出）
        if (spec.upperRootStripes && seg === 'upper') for (let k = 0; k < spec.upperRootStripes; k++) { const s0 = 0.32 + k * 0.068; parts.push({ t: 'segPlate', seg, w0: w0 + (w1 - w0) * s0, w1: w0 + (w1 - w0) * (s0 + 0.032), s0, s1: s0 + 0.032, role: 'armor2' }); } // 条纹组：自肩裙覆盖界之下起排

        break;
      }
      case 'parts': for (const rec of (ARM_GEOM as Record<string, APart[]>)[step.list!]) emitAPart(rec); break;
      case 'shoulderDiscs': { const [r0, r1] = spec.shoulderDisc ?? ARM_GEOM.discStd; parts.push({ t: 'disc', at: 'shoulder', r: r0 * b }, { t: 'disc', at: 'shoulder', r: r1 * b }); break; }
      case 'foreHousing': { const hp = ARM_GEOM.housingPlate; parts.push({ t: 'segPlate', seg: 'fore', w0: hp.w0 * b, w1: hp.w1 * b, s0: 0.03, s1: 0.97, bulge: hp.bulge, role: spec.gear.stripe ? 'stripe' : undefined }); break; } // 整壳：近平直侧（长板大 bulge 会鼓成棺材形）
      case 'foreBand': { const fb = spec.foreBand!; parts.push({ t: 'block', frame: 'fore', along: spec.foreLen * fb.along, perp: fb.perp * b, w: fb.w * b, h: spec.foreLen * fb.len, cham: 0.3, role: fb.role }); break; } // 前臂顺轴带：落点/宽度/长度全是规格数据
      case 'wristBand': { const wv = (spec.form.fore === 'housing' ? ARM_GEOM.wristBandW.housing : ARM_GEOM.wristBandW.std) * b; parts.push({ t: 'segPlate', seg: 'fore', w0: wv, w1: wv, s0: 0.925, s1: 0.995 }); break; } // 腕环带（带宽按前臂式查数据表）
      case 'fist': parts.push(...fistParts(spec, elbow, wrist)); break;
      case 'shellMain': { const m = ARM_GEOM.shellMain; parts.push({ t: 'block', frame: 'shoulder', along: m.along, perp: m.perp, w: m.w * sh, h: m.h * sh, angOff: m.angOff, kind: 'plate', cham: m.cham, bolts: true, faceW: m.faceW, ...(spec.shellRole ? { role: spec.shellRole } : {}) }); break; } // 肩钟主块：色角色是规格数据
      case 'slotsRun': { const sr = ARM_GEOM.slotsRun; for (const da of sr.das) parts.push({ t: 'block', frame: 'shoulder', along: sr.baseAlong + da * sh, perp: 0, w: sr.w * sh, h: sr.h * sh, kind: 'frame' }); break; } // 散热槽列：沿臂轴排（偏移列是数据）
      case 'insignia': { const ins = spec.insignia!; parts.push({ t: 'insignia', frame: 'shoulder', along: ins.along, perp: ins.perp, kind: ins.kind }); break; } // 徽章：种类与落点全是规格数据
    }
  }
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
    else if (p.t === 'block') { const c = fp(p.frame, p.along, p.perp); const id = T.addBlock(p.kind ?? 'plate', c.x, c.y, p.w, p.h, fang(p.frame) + (p.angOff ?? 0), p.cham ?? 0.36, p.bolts ?? false); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); if (p.inset) regInsetFrame(A, id, c.x, c.y, p.w * p.inset.fw, p.h * p.inset.fh, fang(p.frame) + (p.angOff ?? 0)); if (p.faceW) { const ba = fang(p.frame) + (p.angOff ?? 0), bca = Math.cos(ba), bsa = Math.sin(ba), ins = (p.w * (p.cham ?? 0.36)) / 2; regThickness(A, id, [{ x: c.x + (-p.w / 2 + ins) * bca - p.h / 2 * bsa, y: c.y + (-p.w / 2 + ins) * bsa + p.h / 2 * bca }, { x: c.x + (p.w / 2 - ins) * bca - p.h / 2 * bsa, y: c.y + (p.w / 2 - ins) * bsa + p.h / 2 * bca }], 1.0, { faceW: p.faceW, faceDx: bsa, faceDy: -bca, faceTone: 0.92 }); } }
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
      T.addRaw('cable', pathTubeTest(pts, p.r));
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
  | { t: 'block'; dx: number; dy: number; w: number; h: number; ang?: number; kind?: Kind; cham?: number; bolts?: boolean; faceW?: number; tint?: number; role?: 'stripe' | 'armor' | 'armor2' | 'accent' | 'mark' ; insetCorners?: number }
  | { t: 'poly'; pts: [number, number][]; bolts?: boolean; faceW?: number; faceEdge?: [number, number]; faceEdges?: ([number, number] | [number, number, number])[]; faceTone?: number; seamless?: boolean; facet?: boolean; edgeLines?: [number, number][]; seamLines?: [number, number, number, number][]; tint?: number; role?: 'armor' | 'armor2' | 'accent' ; press?: boolean }
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
  /** —— 以下皆 DAG 数据（族差异只许落在这里，torsoIR 内零族别分支）—— */
  /** 腰式（模式「腰独立成段」）：'plates' 斜蓝覆片（敏捷）/'rings'
   * 白-橙-白肋环（动力服，环列在胯段前入列）/'hose' 横走线缆
   * （主战：粗缆成束横走腰间、两端探入甲内——旧式三条 5px 扁
   * 带是它的降级形，本轮按双样本标注以真管重落）；未设 = 暗框 */
  waistForm?: 'plates' | 'rings' | 'hose';
  /** 线缆参数（waistForm 'hose'）：管数 / 管半径（WH 比，缺省 0.2） */ hoseTubes?: number; hoseR?: number;
  /** 腰侧关节盘 [下移（WH 比）, 半径（WH 比）]，缺省 [0, 0.42] */ waistDisc?: [number, number];
  /** 裙片垂距收缩（敏捷实测 0.72：裙短、胯下留暗隙），缺省 1 */ skirtShrink?: number;
  /** 髋板下角嵌框对（主战参考：髋板与背板下角各有一对小方框） */ pelvisInset?: boolean;
  /** 骨盆式：'shell' 弧底壳（动力服，与胸壳同曲面语言） */ pelvisForm?: 'shell';
  /** 骨盆前覆板 + 微标（敏捷骨盆前脸的 armor2 斜板） */ pelvisPlate?: boolean;
  /** 胸甲条纹组：胸前板上横排的强调色细带条数（动力服实测 3 道） */ chestStripes?: number;
  /** 胸前通风线组（动力服实测：条纹组正上方三道短黑线，与条纹组同 x 叠排） */ chestVent?: boolean;
  /** 壳形胸轮廓参数 [中点横偏, 中点下沉（foldY 比）, 下段横偏]：敏捷
   * 把中点拉浅成龙骨上缘（实测 [-0.065, 0.15, 0.03]），缺省动力服值 */
  shellMid?: [number, number, number];
  /** 壳形胸顶盖板（动力服：顶段一块素面盖板压住壳顶） */ shellCap?: boolean;
  /** 壳形胸下前副色段（敏捷：下前一段 armor2 蓝段） */ shellSeg?: boolean;
  /** 前楔并体（同组合）：盒左侧面与楔拱前楔并成同一个表面（消缝）；缺省并，关时前楔自画、盒左侧面自画（接缝回来） */
  ventFuse?: boolean;
  family: string; scheme: Scheme; seed: number; wear: number; camo: boolean; twoTone: boolean;
  neck: Pt; chestW: number; chestH: number; waistH: number; pelvisH: number;
  profile?: Partial<TorsoProfile>;
  form: { chest: 'stack' | 'shell' | 'slab' | 'glacis'; back: 'box' | 'binder' | 'rack' | 'none'; grille: 'side' | 'front' | 'none'; skirt: 'front' | 'both' | 'none' };
  gear: { stripe: boolean; insignia: number; number: string };
}
interface TorsoIR { anchors: Record<'neck' | 'shoulder' | 'hip' | 'chestC', Pt>; parts: TorsoPart[] }
// 裙片纵向口径：敏捷参考的裙片短（下垂止于胯下、下方留暗关节空
// 隙），产品原多边形下垂近 0.7·PH、读作垂到大腿中段的大场。敏捷族
// 把 pelvisY 以下的垂距 ×0.72（上缘不动），其余族逐字原值。
function skirtPts(spec: TorsoSpec, pts: [number, number][], pelvisY: number): [number, number][] {
  const sk = spec.skirtShrink ?? 1;
  if (sk === 1) return pts;
  return pts.map(([x, y]) => [x, y > pelvisY ? pelvisY + (y - pelvisY) * sk : y] as [number, number]);
}
/** 龙骨突派生算子：按与渲染同一式从散热口盒的实际四边形（面线
 * seg + 框斜 0.15 绕质心）算出龙骨板——上缘自盒右上角沿盒上缘
 * 方向出到最前点 K1、前缘自 K1 沿盒前缘方向下行到底边 K2；
 * 胸前剪影由 K1/K2 生成。seg 为归一化面线（数据表 faceSeg）。 */
function keelFromVent(spec: TorsoSpec, W: number, CH: number, seg: [number, number, number, number], bottomYn: number) {
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
}

/** 面线取值（数据语义求值）：轮廓参数键/字面值/壳中点派生 */
function segVal(src: SegSrc, spec: TorsoSpec, P: TorsoProfile): number {
  if (src.lit !== undefined) return src.lit;
  if (src.avgTF) return (P.top + P.fold) / 2 + (spec.shellMid?.[0] ?? 0.085);
  if (src.midSub !== undefined) return P.foldY - (spec.shellMid?.[1] ?? 0.2);
  return (P as unknown as Record<string, number>)[src.p!] + (src.off ?? 0);
}
function segFrac(spec: TorsoSpec, P: TorsoProfile, table: Record<string, SegSrc[]>, form: string): [number, number, number, number] {
  const t = table[form];
  return [segVal(t[0], spec, P), segVal(t[1], spec, P), segVal(t[2], spec, P), segVal(t[3], spec, P)];
}

/** 胸·叠层式装配算子（上板+中板+斜主板三层出台阶；下段前界由龙骨突生成、关时回直线） */
function chestStackParts(spec: TorsoSpec, P: TorsoProfile, W: number, CH: number): TorsoPart[] {
  const parts: TorsoPart[] = [];
  parts.push({ t: 'block', dx: W * (P.top - 0.4), dy: CH * 0.2, w: W * 0.8, h: CH * 0.36, cham: 0.26, bolts: true, faceW: 7 });
  parts.push({ t: 'block', dx: W * (P.fold - 0.49), dy: CH * P.divY, w: W * 0.9, h: CH * 0.05, kind: 'frame' });
  parts.push({ t: 'block', dx: W * (P.fold - 0.52), dy: CH * (P.divY + 0.115), w: W * 0.96, h: CH * 0.26, cham: 0.22, faceW: 7 });
  if (spec.keelPlate === false) parts.push({ t: 'poly', pts: [[-W * 0.48, CH * (P.foldY + 0.05)], [W * P.fold, CH * (P.foldY + 0.05)], [W * P.base, CH * 0.98], [-W * 0.4, CH * 1.0]], faceW: 11, faceEdges: [[2, 1], [3, 2]] }); // 龙骨突关：前界回 fold→base 直线
  else { const k = keelFromVent(spec, W, CH, segFrac(spec, P, TORSO_GEOM.faceSeg, 'stack'), 0.98);
    parts.push({ t: 'poly', pts: [[-W * 0.48, CH * (P.foldY + 0.05)], [W * P.fold, CH * (P.foldY + 0.05)], k.K1, k.K2, [-W * 0.4, CH * 1.0]], faceW: 11, faceEdges: [[4, 3]] }); // 前界 fold→K1→K2 由龙骨突生成
    parts.push({ t: 'poly', pts: k.plate, faceW: 11, faceEdges: [[2, 1], [3, 2]], edgeLines: [[0, 1]], tint: 0.93 }); } // 龙骨板（自盒右上角起，上缘棱线＋前缘/底边料厚）
  parts.push({ t: 'block', dx: -W * 0.08, dy: CH * 0.05, w: W * 0.7, h: CH * 0.13, kind: 'frame', cham: 0.3 });
  return parts;
}

/** 胸·壳形式装配算子（一整块壳按三段带分面：顶面亮/前面中/下前暗；顶盖与下前副色段是规格数据开关） */
function chestShellParts(spec: TorsoSpec, P: TorsoProfile, W: number, CH: number): TorsoPart[] {
  const parts: TorsoPart[] = [];
  // 中点即龙骨肩：敏捷把它拉浅成龙骨上缘（shellMid 数据），使入折点的最后一段变浅
  const midOff = spec.shellMid?.[0] ?? 0.085, midY = P.foldY - (spec.shellMid?.[1] ?? 0.2), lowOff = spec.shellMid?.[2] ?? 0.08;
  parts.push({ t: 'poly', pts: [[-W * 0.46, CH * 0.08], [W * 0.08, CH * 0.0], [W * P.top, CH * 0.12], [W * ((P.top + P.fold) / 2 + midOff), CH * midY], [W * P.fold, CH * P.foldY], [-W * 0.473, CH * 0.36]], bolts: true, faceW: 11, faceTone: 0.84, faceEdges: [[4, 3], [3, 2]], seamless: true, facet: true, tint: 1.06 });
  parts.push({ t: 'poly', pts: [[W * P.fold, CH * P.foldY], [W * (P.base + lowOff), CH * 0.85], [-W * 0.404, CH * 0.88], [-W * 0.48, CH * 0.5], [-W * 0.473, CH * 0.36]], faceW: 11, faceTone: 0.84, faceEdges: [[1, 0]], edgeLines: [[0, 4]], seamless: true, facet: true, tint: 1.0 });
  parts.push({ t: 'poly', pts: [[W * (P.base + lowOff), CH * 0.85], [W * P.base, CH * 0.9], [W * P.base, CH * 0.99], [-W * 0.38, CH * 1.0], [-W * 0.404, CH * 0.88]], faceW: 11, faceTone: 0.84, faceEdges: [[2, 1], [1, 0]], edgeLines: [[0, 4]], seamless: true, facet: true, tint: 0.93 });
  if (spec.shellCap) parts.push({ t: 'poly', pts: [[-W * 0.46, CH * 0.08], [W * 0.08, CH * 0.0], [W * P.top, CH * 0.12], [W * (P.top + 0.05), CH * 0.28], [-W * 0.28, CH * 0.28], [-W * 0.48, CH * 0.42]], seamless: true, facet: true });
  if (spec.shellSeg) parts.push({ t: 'poly', pts: [[W * 0.3, CH * P.divY], [W * (P.fold - 0.01), CH * (P.divY + 0.17)], [W * P.base, CH * 0.9], [W * P.base, CH * 0.99], [W * 0.22, CH * 1.0]], role: 'armor2', tint: 0.95, faceW: 11, faceTone: 0.84, faceEdges: [[3, 2], [2, 1]], seamless: true, facet: true });
  return parts;
}

/** 胸·斜面式装配算子（一整块连续斜坡 + 坡面舱盖：舱盖按坡面切线角内嵌、外框+暗板双层） */
function chestGlacisParts(spec: TorsoSpec, P: TorsoProfile, W: number, CH: number): TorsoPart[] {
  const parts: TorsoPart[] = [];
  parts.push({ t: 'poly', pts: [[-W * 0.48, CH * 0.08], [W * P.top, CH * 0.08], [W * P.fold, CH * P.foldY], [W * P.base, CH * 0.99], [-W * 0.4, CH * 1.0]], faceW: 7, faceEdges: [[2, 1, 19], [3, 2], [4, 3]] }); // 前缘链与壳形同登记；斜边料厚面加宽（19）——坡面即此厚面、舱盖坐其上
  const slpA = Math.atan2((P.foldY - 0.08) * CH, (P.fold - P.top) * W);
  const slpX = W * (P.top + (P.fold - P.top) * ((P.divY - 0.08) / (P.foldY - 0.08)));
  const hcx = slpX - Math.sin(slpA) * W * 0.066, hcy = CH * P.divY + Math.cos(slpA) * W * 0.066;
  parts.push({ t: 'block', dx: hcx, dy: hcy, w: W * 0.30, h: CH * 0.10, ang: slpA, cham: 0.3, bolts: true });
  parts.push({ t: 'block', dx: hcx, dy: hcy, w: W * 0.20, h: CH * 0.058, ang: slpA, cham: 0.2, kind: 'frame' });
  return parts;
}

/** 胸·重板式装配算子（整块长斜楔自后高一线斜到前尖；下段龙骨突 + 沿缘 accent 带） */
function chestSlabParts(spec: TorsoSpec, P: TorsoProfile, W: number, CH: number): TorsoPart[] {
  const parts: TorsoPart[] = [];
  const slabTopX = P.top + (P.fold - P.top) * ((P.divY - 0.06) / (P.foldY - 0.06));
  parts.push({ t: 'poly', pts: [[-W * 0.48, CH * 0.06], [W * P.top, CH * 0.06], [W * slabTopX, CH * P.divY], [-W * 0.47, CH * P.divY]], bolts: true, faceW: 11, faceEdges: [[2, 1]] });
  if (spec.keelPlate === false) parts.push({ t: 'poly', pts: [[-W * 0.47, CH * P.divY], [W * P.fold, CH * P.divY], [W * P.base, CH * 0.99], [-W * 0.41, CH * 1.0]], faceW: 11, faceEdges: [[2, 1], [3, 2]] }); // 龙骨突关：前界回 fold→base 直线
  else { const k = keelFromVent(spec, W, CH, segFrac(spec, P, TORSO_GEOM.faceSeg, 'slab'), 0.99);
    parts.push({ t: 'poly', pts: [[-W * 0.47, CH * P.divY], [W * P.fold, CH * P.divY], k.K1, k.K2, [-W * 0.41, CH * 1.0]], faceW: 11, faceEdges: [[4, 3]] });
    parts.push({ t: 'poly', pts: k.plate, faceW: 11, faceEdges: [[2, 1], [3, 2]], edgeLines: [[0, 1]], tint: 0.93 });
    // 沿缘 accent 带：沿龙骨板前缘向内偏 6px 一条带（不横贯）
    const [ax, ay] = k.plate[1], [bx, by] = k.plate[2];
    const ex = bx - ax, ey = by - ay, el = Math.hypot(ex, ey) || 1;
    const nx = ey / el * 6, ny = -ex / el * 6;
    parts.push({ t: 'poly', pts: [[ax, ay], [bx, by], [bx + nx, by + ny], [ax + nx, ay + ny]], role: 'accent' }); }
  return parts;
}

// ---------- 躯干图展开器：模板（TORSO_GRAPH 数据）→ 部件列 ----------
// 躯干模板就是数据（torso-geom 的 TORSO_GRAPH/TORSO_GEOM）：步
// 骤序 = 画序，式与装备的选择全在 when 条件数据里，部件记录是
// 带单位标注的数据。展开器只按图走：求值条件、换算单位、调
// 算子（胸四式/楔拱/龙骨突/线缆行等），锚点由颈点与尺寸数据
// 算出——不存躯干的装配决定。
function torsoWhen(when: TorsoWhen | undefined, spec: TorsoSpec): boolean {
  if (!when) return true;
  if ('all' in when) return when.all.every((w2) => torsoWhen(w2, spec));
  let v: unknown = spec;
  for (const k of when.path.split('.')) v = (v as Record<string, unknown> | undefined)?.[k];
  if (when.eq !== undefined) return v === when.eq;
  if (when.neq !== undefined) return v !== when.neq;
  if (when.gt !== undefined) return typeof v === 'number' && v > when.gt;
  return !!v;
}

function torsoIR(spec: TorsoSpec): TorsoIR {
  const W = spec.chestW, CH = spec.chestH, WH = spec.waistH, PH = spec.pelvisH, F = spec.form, P = torsoProfileOf(spec), parts: TorsoPart[] = [];
  const waistY = CH + WH / 2, pelvisY = CH + WH + PH / 2;
  const hosts: { fwPts?: [number, number][] } = {};
  const xVal = (n: TNum): number => n[1] === 'W' ? n[0] * W : n[0];
  const lenVal = (n: TNum): number => n[1] === 'W' ? n[0] * W : n[1] === 'CH' ? n[0] * CH : n[1] === 'WH' ? n[0] * WH : n[1] === 'PH' ? n[0] * PH : n[0];
  const yVal = (n: TNum): number => n[1] === 'CH' ? n[0] * CH : n[1] === 'waist' ? waistY + n[0] * WH : n[1] === 'pelvis' ? pelvisY + n[0] * PH : lenVal(n);
  const emitTPart = (rec: TPart): void => {
    const { pts, face, seamLines, seamUnit, shrink, insetCornersWhen, ...rest } = rec;
    const p = { ...rest } as Record<string, unknown>;
    if (rec.dx) p.dx = xVal(rec.dx);
    if (rec.dy) p.dy = yVal(rec.dy);
    if (rec.w) p.w = lenVal(rec.w);
    if (rec.h) p.h = lenVal(rec.h);
    if (rec.r) p.r = lenVal(rec.r);
    if (rec.ax) { p.ax = xVal(rec.ax); p.ay = yVal(rec.ay!); p.bx = xVal(rec.bx!); p.by = yVal(rec.by!); }
    if (pts) p.pts = pts.map(([x, y, yu]) => [x * W, yVal([y, yu])] as [number, number]);
    if (face) p.face = face.map(([x, y, yu]) => [x * W, yVal([y, yu])] as [number, number]);
    if (seamLines) p.seamLines = seamLines.map(([a, b2, c, d]) => [a * W, yVal([b2, seamUnit ?? 'raw']), c * W, yVal([d, seamUnit ?? 'raw'])] as [number, number, number, number]);
    if (insetCornersWhen && !(spec as unknown as Record<string, unknown>)[insetCornersWhen]) delete p.insetCorners;
    if (shrink && p.pts) p.pts = skirtPts(spec, p.pts as [number, number][], pelvisY); // 裙片垂距收缩（规格数据）
    parts.push(p as TorsoPart);
  };
  const faceSegPx = (): [number, number, number, number] => { const f = segFrac(spec, P, TORSO_GEOM.faceSeg, F.chest); return [f[0] * W, f[1] * CH, f[2] * W, f[3] * CH]; };
  const keelUpPx = (): [number, number, number, number] => { const f = segFrac(spec, P, TORSO_GEOM.keelUp, F.chest); return [f[0] * W, f[1] * CH, f[2] * W, f[3] * CH]; };
  for (const step of TORSO_GRAPH) {
    if (!torsoWhen(step.when, spec)) continue;
    switch (step.op) {
      case 'parts': for (const rec of (TORSO_GEOM as Record<string, TPart[]>)[step.list!]) emitTPart(rec); break;
      case 'hoseRun': { // 横走线缆算子：粗缆成束横走腰间、贴体浅弧、两端探入甲内（管数/半径是规格数据，走真管圆柱调、两段折线逼近浅弧）
        const tubes = spec.hoseTubes ?? 2, hr = (spec.hoseR ?? 0.2) * WH;
        for (let i = 0; i < tubes; i++) {
          const cy = waistY + (i - (tubes - 1) / 2) * hr * 2.4;
          parts.push({ t: 'pipe', ax: -W * 0.40, ay: cy - WH * 0.05, bx: -W * 0.02, by: cy + WH * 0.10, r: hr });
          parts.push({ t: 'pipe', ax: -W * 0.02, ay: cy + WH * 0.10, bx: W * 0.34, by: cy - WH * 0.03, r: hr });
        }
        break;
      }
      case 'waistDiscs': { // 腰侧关节盘 + 暗衬盘（盘缘三岔口防针孔，衬盘垫后只在缺口露暗）
        const wd = spec.waistDisc ?? TORSO_GEOM.waistDiscStd;
        parts.push({ t: 'disc', dx: -W * 0.32, dy: waistY + wd[0] * WH, r: WH * wd[1] * 1.18, kind: 'frame' });
        parts.push({ t: 'disc', dx: -W * 0.32, dy: waistY + wd[0] * WH, r: WH * wd[1], kind: 'disc' });
        break;
      }
      case 'chestStack': parts.push(...chestStackParts(spec, P, W, CH)); break;
      case 'chestShell': parts.push(...chestShellParts(spec, P, W, CH)); break;
      case 'chestGlacis': parts.push(...chestGlacisParts(spec, P, W, CH)); break;
      case 'chestSlab': parts.push(...chestSlabParts(spec, P, W, CH)); break;
      case 'wedgeArch': { // 楔拱算子：四块异形楔绕肩盘拼合（盘心/内半径/扇区外链是数据）；前楔轮廓登记为宿主供格栅并体
        const arch = wedgeArch(TORSO_GEOM.arch.center, TORSO_GEOM.arch.ri, TORSO_GEOM.arch.sectors);
        const archPts = (poly: [number, number][]): [number, number][] => poly.map(([a, b]) => [W * a, CH * b]);
        for (const [ai, sec] of arch.entries()) {
          if (ai === 3 && spec.ventFuse !== false && ((F.chest === 'shell' && F.grille === 'front') || F.grille === 'side')) continue; // 前楔与盒左侧面并体（见格栅 fw）；ventFuse 关时前楔自画
          parts.push({ t: 'poly', pts: archPts(sec.poly), ...(sec.tint !== undefined ? { tint: sec.tint } : {}) });
        }
        const fwFront = arch[3];
        hosts.fwPts = archPts([fwFront.outer[0], fwFront.arc[2], fwFront.arc[1], fwFront.arc[0], fwFront.outer[3], fwFront.outer[2]]);
        break;
      }
      case 'grilleSide': { const g = TORSO_GEOM.grilleSide; parts.push({ t: 'grille', dx: 0, dy: CH * g.dy, w: W * g.w, h: CH * g.h, face: faceSegPx(), ...(F.chest === 'shell' ? { keelUp: keelUpPx() } : {}), ...(spec.ventFuse !== false ? { fw: hosts.fwPts } : {}) }); break; }
      case 'grilleFrontShell': { const g = TORSO_GEOM.grilleFrontShell; parts.push({ t: 'grille', dx: W * g.dx, dy: CH * g.dy, w: W * g.w, h: CH * g.h, face: faceSegPx(), keelUp: keelUpPx(), bt: [W * g.bt[0], CH * g.bt[1]], ...(spec.ventFuse !== false ? { fw: hosts.fwPts } : {}) }); break; }
      case 'grilleFrontGlacis': { const g = TORSO_GEOM.grilleFrontGlacis; parts.push({ t: 'grille', dx: 0, dy: CH * g.dy, w: W * g.w, h: CH * g.h, face: faceSegPx(), depth: spec.intakeDepth, tilt: 0 }); break; } // 斜面胸：口整段落折点以下、浅口凹进、面随陡段剪切不再叠转角
      case 'grilleFrontPlain': { const g = TORSO_GEOM.grilleFrontPlain; parts.push({ t: 'grille', dx: 0, dy: CH * g.dy, w: W * g.w, h: CH * g.h, face: faceSegPx() }); break; }
      case 'ventRun': { const v = TORSO_GEOM.ventRun; for (let k = 0; k < v.n; k++) parts.push({ t: 'block', dx: W * v.dx, dy: CH * (v.dy0 + k * v.step), w: W * v.w, h: CH * v.h, kind: 'frame' }); break; } // 胸前通风线组（条纹组正上方叠排）
      case 'stripesRun': { const s = TORSO_GEOM.stripesRun; for (let k = 0; k < (spec.chestStripes ?? 0); k++) parts.push({ t: 'block', dx: W * s.dx, dy: CH * (s.dy0 + k * s.step), w: W * s.w, h: CH * s.h, role: 'accent' }); break; } // 胸甲条纹组（条数是规格数据；带厚保底由数据值保证）
      case 'insignia': parts.push({ t: 'insignia', dx: W * (spec.insigniaPos?.[0] ?? 0.16), dy: CH * (spec.insigniaPos?.[1] ?? 0.26), kind: spec.gear.insignia }); break; // 徽章：落点是规格数据
      case 'number': parts.push({ t: 'number', dx: W * 0.02, dy: CH * (F.chest === 'glacis' ? TORSO_GEOM.numberDy.glacis : TORSO_GEOM.numberDy.std), text: spec.gear.number }); break; // 编号落点按胸式查数据表（整块落在板面内）
    }
  }
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
    if (p.t === 'block') { const id = T.addBlock(p.kind ?? 'plate', cx, cy, p.w, p.h, p.ang ?? 0, p.cham ?? 0.36, p.bolts ?? false); if (p.insetCorners) { const isz = p.insetCorners, iix = p.w / 2 - isz * 0.85, iiy = p.h / 2 - isz * 0.85; for (const [iox, ioy] of [[-iix, iiy], [p.w * 0.02, iiy]] as const) regInsetFrame(A, id, cx + iox, cy + ioy, isz, isz, p.ang ?? 0); } if (p.tint !== undefined) A.plateTint.set(id, p.tint); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); if (p.faceW) { const ins = (p.w * (p.cham ?? 0.36)) / 2, by = cy + p.h / 2, ca = Math.cos(p.ang ?? 0), sa = Math.sin(p.ang ?? 0); regThickness(A, id, [{ x: cx + (-p.w / 2 + ins) * ca - p.h / 2 * sa, y: cy + (-p.w / 2 + ins) * sa + p.h / 2 * ca }, { x: cx + (p.w / 2 - ins) * ca - p.h / 2 * sa, y: cy + (p.w / 2 - ins) * sa + p.h / 2 * ca }], 1.0, { faceW: p.faceW, faceDx: sa, faceDy: -ca, faceTone: 0.92 }); void by; } }
    else if (p.t === 'poly') { const id = T.addPoly(p.pts.map(([dx, dy]) => ({ x: o.x + dx, y: o.y + dy })), p.bolts ?? false); if (p.tint !== undefined) A.plateTint.set(id, p.tint); if (p.press) (A.pressIds ??= new Set()).add(id); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); if (p.seamless) { A.panelDiag.delete(id); A.panelTee.delete(id); A.seamU.delete(id); if (A.ridges) A.ridges = A.ridges.filter(r => !(r.inst === id && !r.thick)) } if (p.edgeLines) for (const [a, b] of p.edgeLines) (A.ridges ??= []).push({ inst: id, pts: [{ x: o.x + p.pts[a][0], y: o.y + p.pts[a][1] }, { x: o.x + p.pts[b][0], y: o.y + p.pts[b][1] }], tone: 1.18, noThick: true });
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
  /** 车体口明暗/倾角：族差异是数据（walker≈mbt 面实测 0.78、框斜未测留 0.12；hauler≈engineer 正对面实测 1.00、鼻口框正→0；工厂给） */ grilleTone?: number; grilleTilt?: number;
  family: string; scheme: Scheme; seed: number; wear: number; camo: boolean; twoTone: boolean;
  deck: Pt; hullW: number; hullH: number;
  form: { turret: 'gun' | 'rack' | 'none'; cabin: 'front' | 'mid'; skirt: boolean; modules: number };
  gear: { insignia: number; number: string };
  /** 徽章模式的落点（[W 分数, H 分数]）：由用户定，缺省按族（walker 左板/hauler 车头板） */
  insigniaPos?: [number, number];
  /** 主箱纵缝横位（W 分数）：族差异是数据（walker 0.1 / hauler 0.26，工厂给） */ seamX?: number;
  /** 主箱贯穿漆带（单位分数，渲染时换算）：族差异是数据（hauler 有、walker 无，工厂给） */ hullStripe?: { y: number; x0: number; x1: number; w?: number };
  /** 编号横位（W 分数）：族差异是数据（hauler 落模块面 -0.25 / walker -0.3，工厂给） */ numberDx?: number;
  /** 垂缆（模式库「垂缆」）：腹线下两兜悬垂线缆 */ sagCables?: boolean;
  /** 侧挂设备舱（模式库「侧挂设备舱」）：前侧面外挂盒 + 舱底垂缆 */ sidePod?: boolean;
  split?: 'body' | 'turret';
}
interface HullIR { anchors: Record<'deck' | 'turret' | 'leg' | 'nose', Pt>; parts: HullPart[] }
// ---------- 车体图展开器：模板（HULL_GRAPH 数据）→ 部件列 ----------
// 车体模板就是数据（hull-geom 的 HULL_GRAPH/HULL_GEOM）：步骤
// 序 = 画序，式与装备的选择全在 when 条件数据里，部件记录是
// 带单位标注的数据；族差异（缝位/漆带/编号位/徽记位）只在规
// 格数据里（seamX/hullStripe/numberDx/insigniaPos）。展开器只
// 按图走：求值条件、换算单位、调算子——不存车体的装配决定。
// 炮塔件走独立列（split 时与车体分开返回）。
function hullWhen(when: HullWhen | undefined, spec: HullSpec): boolean {
  if (!when) return true;
  if ('all' in when) return when.all.every((w2) => hullWhen(w2, spec));
  let v: unknown = spec;
  for (const k of when.path.split('.')) v = (v as Record<string, unknown> | undefined)?.[k];
  if (when.eq !== undefined) return v === when.eq;
  if (when.neq !== undefined) return v !== when.neq;
  if (when.falsy) return !v;
  return !!v;
}

function hullIR(spec: HullSpec): HullIR {
  const W = spec.hullW, H = spec.hullH, F = spec.form, parts: HullPart[] = [], tp: HullPart[] = [];
  const bellyY = F.skirt ? H * HULL_GEOM.bellyY.skirt : H * HULL_GEOM.bellyY.plain; // 腹线（裙带底沿 / 主箱底沿）：垂缆与侧挂舱的挂载线
  const val = (n: HNum): number => n[1] === 'W' ? n[0] * W : n[1] === 'H' ? n[0] * H : n[0];
  const emitHPart = (rec: HPart, to?: 'turret'): void => {
    const { seams, ...rest } = rec;
    const p = { ...rest } as Record<string, unknown>;
    if (rec.dx) p.dx = val(rec.dx);
    if (rec.dy) p.dy = val(rec.dy);
    if (rec.w) p.w = val(rec.w);
    if (rec.h) p.h = val(rec.h);
    if (rec.r) p.r = val(rec.r);
    if (rec.x1) { p.x1 = val(rec.x1); p.y1 = val(rec.y1!); p.x2 = val(rec.x2!); p.y2 = val(rec.y2!); }
    if (seams) p.seams = seams.map(([a, b, c, d]) => [a * W, b * H, c * W, d * H] as [number, number, number, number]);
    (to === 'turret' ? tp : parts).push(p as HullPart);
  };
  for (const step of HULL_GRAPH) {
    if (!hullWhen(step.when, spec)) continue;
    switch (step.op) {
      case 'parts': for (const rec of (HULL_GEOM as Record<string, HPart[]>)[step.list!]) emitHPart(rec, step.to); break;
      case 'mainBox': { // 主箱（楔）+ 大板结构缝（登记制、收尾统一画缝唇）；纵缝横位与贯穿漆带是规格数据
        const m = HULL_GEOM.mainBox, sx = spec.seamX ?? m.seamXStd;
        parts.push({ t: 'block', dx: W * m.dx, dy: H * m.dy, w: W * m.w, h: H * m.h, cham: m.cham, bolts: true, seams: [[W * m.seamH[0], H * m.seamH[1], W * m.seamH[2], H * m.seamH[3]], [W * sx, H * m.seamY0, W * sx, H * m.seamY1]], ...(spec.hullStripe ? { stripe: { y: H * spec.hullStripe.y, x0: W * spec.hullStripe.x0, x1: W * spec.hullStripe.x1, w: spec.hullStripe.w } } : {}) });
        break;
      }
      case 'cabinSet': { // 舱体组：舱位按 form.cabin 查数据表、组内件相对偏移（分数域相加后统一换算）
        const cabDx = HULL_GEOM.cabinDx[F.cabin] ?? 0;
        for (const rec of HULL_GEOM.cabinParts) { const p = { ...rec } as HPart; if (rec.dx) p.dx = [rec.dx[0] + cabDx, 'W'] as HNum; emitHPart(p); }
        break;
      }
      case 'modulesRun': { const mr = HULL_GEOM.modulesRun; for (let k = 0; k < F.modules; k++) parts.push({ t: 'block', dx: W * (mr.dx0 + k * mr.step), dy: H * mr.dy, w: W * mr.w, h: H * mr.h, cham: mr.cham }); break; } // 侧面模块阵列（个数是规格数据）
      case 'sagCables': for (const c of HULL_GEOM.sagCables) parts.push({ t: 'sagcable', x1: W * c.x1, y1: bellyY, x2: W * c.x2, y2: bellyY, sag: c.sag, r: c.r }); break; // 垂缆：线缆在两锚之间悬垂成兜（着色走线缆本体，此处只定兜形与锚位）
      case 'sidePod': { // 侧挂设备舱：盒子模式挂主面外侧 + 舱底一兜垂缆（垂缆的第二个调用点、同一实现）
        const sp = HULL_GEOM.sidePod, pw = W * sp.pw, ph = H * sp.ph, pdx = W * sp.pdx, pdy = bellyY + H * sp.pdyOff;
        parts.push({ t: 'sidepod', dx: pdx, dy: pdy, w: pw, h: ph });
        parts.push({ t: 'sagcable', x1: pdx - pw * sp.cableHalf, y1: pdy + ph / 2, x2: pdx + pw * sp.cableHalf, y2: pdy + ph / 2, sag: sp.cableSag, r: sp.cableR });
        break;
      }
      case 'insignia': { const [ipx, ipy] = spec.insigniaPos ?? HULL_GEOM.insigniaPosStd; parts.push({ t: 'insignia', dx: W * ipx, dy: H * ipy, kind: spec.gear.insignia }); break; } // 徽记：落点是规格数据（标记成组贴编号下方）
      case 'number': parts.push({ t: 'number', dx: W * (spec.numberDx ?? HULL_GEOM.numberDxStd), dy: H * HULL_GEOM.numberDy, text: spec.gear.number }); break;
    }
  }
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
    if (p.t === 'block') { const id = T.addBlock(p.kind ?? 'plate', cx, cy, p.w, p.h, p.ang ?? 0, p.cham ?? 0.36, p.bolts ?? false); if (p.insetCorners) { const isz = p.insetCorners, iix = p.w / 2 - isz * 0.85, iiy = p.h / 2 - isz * 0.85; for (const [iox, ioy] of [[-iix, iiy], [p.w * 0.02, iiy]] as const) regInsetFrame(A, id, cx + iox, cy + ioy, isz, isz, p.ang ?? 0); } if (p.tint !== undefined) A.plateTint.set(id, p.tint); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); if (p.seams) for (const [x1, y1, x2, y2] of p.seams) (A.ridges ??= []).push({ inst: id, pts: [{ x: o.x + x1, y: o.y + y1 }, { x: o.x + x2, y: o.y + y2 }], tone: 0.78, noThick: true }); if (p.stripe) A.stripeSegs.push({ p1: { x: o.x + p.stripe.x0, y: o.y + p.stripe.y }, p2: { x: o.x + p.stripe.x1, y: o.y + p.stripe.y }, w: p.stripe.w, ids: new Set([id]) }); }
    else if (p.t === 'disc') T.addDisc(p.kind ?? 'disc', { x: cx, y: cy }, p.r);
    else if (p.t === 'grille') T.grille(cx, cy, p.w, p.h, spec.intakeDepth, spec.grilleTone ?? 1, spec.grilleTilt ?? 0, spec.intakeShare); // 口明暗/倾角是规格数据（grilleTone/grilleTilt，工厂按族给），不再在展开器里按 family 分支选字面量
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
      T.addRaw('cable', pathTubeTest(allPts, strandR));
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
/** 节点溯源标记：每个 HeadPart 记它由图里哪一步/哪份几何展开
 * （src = 几何键或算子名，如 'cheekPlate' / 'wing:main' / 'dome'）——
 * 防漏二号关的审计以 headIR 的节点列为源逐件判定见证，件的身份
 * 必须来自展开本身、不许审计脚本再按坐标猜件。渲染忽略此字段 */
type HeadPart =
  | { t: 'block'; dx: number; dy: number; w: number; h: number; ang?: number; kind?: Kind; cham?: number; bolts?: boolean; faceW?: number; tint?: number; role?: 'stripe' | 'armor2' | 'accent' | 'mark'; glowSeat?: boolean; inset?: { fw: number; fh: number }; src?: string }
  | { t: 'disc'; dx: number; dy: number; r: number; kind?: Kind; src?: string }
  | { t: 'grille'; dx: number; dy: number; w: number; h: number; bars?: { groups: number[]; gap: number; role?: string }; src?: string }
  | { t: 'poly'; pts: [number, number][]; bolts?: boolean; faceW?: number; faceEdge?: [number, number]; role?: 'armor2' | 'accent'; tint?: number; src?: string }
  | { t: 'wing'; dx: number; dy: number; len: number; wRoot: number; wTip: number; ang: number; role?: 'armor2' | 'accent'; src?: string }
  | { t: 'stripe'; pts: [number, number][]; ws: number[]; hosts: HeadPart[]; src?: string }
  | { t: 'light'; dx: number; dy: number; s?: number; src?: string };
interface HeadSpec {
  /** 块形（模式库「块形·非四边形」）：块逐角切角分布 */ blockShape?: BlockShapeParams;
  /** 进气口三面盒深度 [横, 纵]（模式库 mpat-intake 条目持有标准值） */ intakeDepth?: [number, number];
  /** 进气口口占装口面份额 [宽, 高]（同上） */ intakeShare?: [number, number];
  family: string; scheme: Scheme; seed: number; wear: number; camo: boolean;
  /** 双色交替开关（基色 pass 按序号奇偶交替 armor/armor2）：头部关
   * ——参考头部是单主色 + 角色指定件（鳍/颌/漆带），不按序号轮换 */
  altTone?: boolean;
  /** —— 以下皆 DAG 数据（族差异只许落在这里，headIR 内零族别分支）—— */
  /** 眼座高占头高比（未设 0.15：主战实测一道横槽 0.11、敏捷细缝 0.08） */ seatH?: number;
  /** 眼座宽占头宽比（未给走 HEAD_GEOM.seatW 按眼式档：缝眼光带长
   * 随座宽派生——敏捷正样眼长约脸宽 0.42、产品旧档 0.28 座宽下
   * 光带只及 0.31，轮十三量测后敏捷钉 0.36） */ seatW?: number;
  /** 眼座倾角（弧度，正 = 前端下沉；鳍座眼未给走 HEAD_GEOM.eyeAngStd——眼随眉线斜置，眉座眼读眉块自带角） */ eyeAng?: number;
  /** 缝眼亮点终点 x 占头宽比（未设 0.361；敏捷亮缝拉长到约脸宽 1/4 → 0.40） */ slitEnd?: number;
  /** 发光轮廓峰位：亮芯轮廓峰值在缝长上的位置（0 = 缝尾、1 = 缝
   * 前端；未设 0.7）。参考三脸的光都是单颗光体——峰偏前、向后
   * 收尾，不是等亮的一条缝 */ glowPeak?: number;
  /** 分节开关（分节算子）：tubeSeg = 吻面横管环沟；topSeg = 顶
   * 附属分节（天线珠节/双鳍刻节）。节形与节位由算子按宿主派生，
   * 数据只给开关 */ tubeSeg?: boolean; topSeg?: boolean;
  /** 缝宽倍率（族档位，头部渲染时转交收尾规格）：主战/重型粗
   * 沟、敏捷细线——见 LegSpec.seamScale */ seamScale?: number;
  /** 接触缝合成开关（数据）：头部规格置真——装配时转交收尾
   * 规格，头部板界走接触缝合成（见 LegSpec.stackSeams） */ stackSeams?: boolean;
  /** 太阳穴圆盘（第二侧件位）：与颊侧件分槽——敏捷的太阳穴小
   * 圆盘与颊栅柱是两个位置两个算子，不打包成一式 */ templeDisc?: boolean;
  /** 领圈分节：领圈走分节算子成颈环列（兽头两样本——图池原
   * 兽头与新生成狼头——的颈都是环列构造，不是素圈） */ collarSeg?: boolean;
  /** 眉鳍合一（组合模式，ann-h2 + ann-g3 两样本）：主鳍根部前
   * 探增厚、垂到眼上自成眉檐——眉不再是独立件，眼座改由鳍的
   * 下缘派生（眼座算子读翼宿主）。仅 top 'vfin' 有意义 */ finBrow?: boolean;
  /** 太阳穴栓芯（组合模式，ann-h2 + ann-g3 两样本）：太阳穴
   * 件 = 圆盘 + 栓芯（盘心暗芯），不是素框圆盘 */ templeBolt?: boolean;
  /** 颏尖点色大小倍率（点色档位：图池敏捷 = 小点档 1；ann-h2/
   * g1/g3 = 占颏端的整段档，约 2） */ chinTipScale?: number;
  /** 穹弧高倍率（轮廓数据）：1 = 正圆弧；参考里动力服/敏捷的
   * 穹弧更平（对照轮实测产品正圆弧读作圆泡） */ domeFlat?: number;
  /** 双鳍几何（数据）：主/后鳍的位长粗角，未给的分量走
   * FIN_GEOM_STD 标准档 */ finGeom?: { main?: Partial<FinGeom>; rear?: Partial<FinGeom> };
  /** 鳍座几何（数据）：眉鳍合一的座相对主鳍根的形，未给的分量
   * 走 HEAD_GEOM.finBase 标准档 */ finBaseGeom?: Partial<FinBaseGeom>;
  /** 整流罩色角色（双色头把分布钉在数据里；未给走收尾奇偶） */ fairingTone?: 'armor' | 'armor2';
  /** 前额角几何（数据，FinGeom 同型）：未给走 HORN_GEOM_STD */ hornGeom?: Partial<FinGeom>;
  /** 粗天线几何（数据）：dx 以 w 计、base/len 以 h 计、lean 为
   * 后倾角；未给走 ANT_GEOM_STD */ antGeom?: { dx?: number; sink?: number; len?: number; lean?: number };
  /** 穹顶平台（轮廓数据）：弧顶 sin 封顶值，1 = 不截；动力服
   * 0.82（平台宽约半头宽，ann-g1/k4 量测） */ domeApex?: number;
  /** 第二条等距回声的半径 [外, 内]（数据）：给了才画第二带
   * （动力服双回声组合，ann-g1/k4/图池三见证） */ echoSecond?: [number, number];
  /** 几何覆盖（数据）：按槽位换构造几何记录，未给走
   * head-geom 的 HEAD_GEOM 缺省表 */ geom?: { base?: GPart[]; shellStep?: GPart; shellSeams?: GLine[]; dome?: DomeGeom; crownSteps?: GPart[]; brow?: GPart; cheek?: GPart; cheekLines?: GLine[]; templeBolt?: GPart[]; templeDisc?: GPart; respTube?: GPart; breatherPipe?: GPart; breatherTip?: GPart; jawBlock?: GPart; jawSmall?: GPart; jawWedge?: GPart; earGrille?: GPart; earSensor?: GPart; earPlateStripe?: GPart[]; earCover?: GPart[]; earDisc?: GPart[]; earPlate?: GPart };
  /** 点列/元组类覆盖的出处（防漏一号关）：visorPts/breatherPts/
   * fairingPts/faceDescent/echoSecond 这类点列与元组挂不上
   * witness 字段，出处记在这里（键 = 字段名、值 = 样本 + 部位）。
   * 几何记录类覆盖（GPart/GLine/DomeGeom/FinGeom）直接在记录上
   * 带 witness 字段；本表只补点列与元组 */ witness?: Record<string, string>;
  /** 降式数据（降式算子）：脸前楔的站位向量——上缘/主降/尖下
   * 内收/底回收/后升，全是数据，点列由算子算出 */ faceDescent?: { top: [number, number]; descent: [number, number]; under: [number, number]; inset: number; rise: number };
  /** 颌块倾角（缺省 0.14）：原先 block/small 两式共用一处写死
   * 字面量，现入数据 */ jawAng?: number;
  /** 式内形点列（单位坐标，x 乘 w、y 乘 h）：visor 面甲板 /
   * crest 眉 / 鳍根整流罩 / breather 颌体的点列是数据，不再以
   * 字面量埋在生成器分支里；未给时生成器用同区占位矩形 */ visorPts?: [number, number][]; crestPts?: [number, number][]; fairingPts?: [number, number][]; breatherPts?: [number, number][];
  /** 圆顶顺弧带的漆色：'accent' 强调色（动力服橙带绕盔）/未设 = 同色面板带 */ crownBand?: 'accent';
  /** 眉式：'crest' 额前冠件（贴额顺下、前探成檐尖，敏捷式）/未设 = 眉檐块压眼 */ browForm?: 'crest';
  /** 后延伸板：后脑上方向后伸出的平板、板下后脸内收成阶（敏捷盔体细节） */ shellStep?: boolean;
  /** 盔体细缝：横缝贯穿中线 + 斜缝自鳍根向后下，1px 级细暗线（敏捷盔体细节） */ shellSeams?: boolean;
  /** 眼下双横线：颊前两道短横栅细暗线（敏捷颊面细节） */ cheekLines?: boolean;
  /** 颏尖点色：颌前下端一小块 armor2 点色（四样本通则，落点随颌式构造） */ chinTip?: boolean;
  /** 脸侧顺边漆带：自面甲下沿沿颊板前缘下行至颏的一条强调色带
   * （动力服参考实测：穹带顺脸侧下行成一条连续橙路） */ faceStripe?: boolean;
  seat: Pt; w: number; h: number; tilt: number; twoTone: boolean;
  form: { crown: 'dome' | 'flat' | 'angular'; eye: 'slit' | 'dot' | 'visor'; brow: boolean; jaw: 'block' | 'respirator' | 'small' | 'breather' | 'plate'; ear: 'disc' | 'grille' | 'plate' | 'sensor' | 'plateStripe' | 'earcover'; top: 'horn' | 'vfin' | 'antenna' | 'none'; cheekCable: boolean };
}
interface HeadIR { anchors: Record<'seat' | 'eye' | 'ear' | 'crown', Pt>; parts: HeadPart[] }
/** 节点下缘算子：在给定 x 处读一个部件节点的下边界 y——块按
 * 尺寸/倾角算下边线、折线按边插值取下包络。宿主几何的读数归
 * 算子，调用方不许拿常数凑宿主的位置 */
function partLowerY(p: HeadPart, x: number): number {
  if (p.t === 'block') { const a = p.ang ?? 0; return p.dy + (p.h / 2) * Math.cos(a) + (x - p.dx) * Math.sin(a); }
  if (p.t === 'wing') {
    // 翼的下缘：四角多边形（根±半宽、尖±半宽）走多边形同路
    const ca = Math.cos(p.ang), sa = Math.sin(p.ang), px = -sa, py = ca;
    const tipX = p.dx + ca * p.len, tipY = p.dy + sa * p.len;
    const pts: [number, number][] = [
      [p.dx + px * p.wRoot / 2, p.dy + py * p.wRoot / 2], [tipX + px * p.wTip / 2, tipY + py * p.wTip / 2],
      [tipX - px * p.wTip / 2, tipY - py * p.wTip / 2], [p.dx - px * p.wRoot / 2, p.dy - py * p.wRoot / 2],
    ];
    let best = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if (x1 === x2 || (x - x1) * (x - x2) > 0) continue;
      const y = y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
      if (y > best) best = y;
    }
    return best === -Infinity ? Math.max(...pts.map((q) => q[1])) : best;
  }
  if (p.t === 'poly') {
    let best = -Infinity;
    for (let i = 0; i < p.pts.length; i++) {
      const [x1, y1] = p.pts[i], [x2, y2] = p.pts[(i + 1) % p.pts.length];
      if (x1 === x2 || (x - x1) * (x - x2) > 0) continue;
      const y = y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
      if (y > best) best = y;
    }
    return best === -Infinity ? Math.max(...p.pts.map((q) => q[1])) : best;
  }
  return 0;
}

/** 鳍座框（派生链 穹→座→鳍 的中间环）：座锚点 S 由穹弧派生——
 * S = 穹弧在站位角 FinBaseGeom.arc 处的点、向下埋 sink；座顶
 * 线（顶后角→顶前角）由 S 与主鳍根宽定。座不存坐标、鳍根不
 * 存坐标：穹数据（DomeGeom/domeFlat/domeApex）一变，S 与座顶
 * 线整条跟走，鳍根再按座框派生（见 wing 步） */
function seatFrameOf(spec: HeadSpec, w: number, h: number): { sx: number; sy: number; topBack: [number, number]; topFront: [number, number] } | undefined {
  if (!spec.finBrow) return undefined;
  const dg = spec.geom?.dome ?? HEAD_GEOM.dome;
  const fb = { ...HEAD_GEOM.finBase, ...spec.finBaseGeom };
  const a = fb.arc;
  const sx = dg.cx * w + Math.cos(a) * w * dg.r;
  const sy = dg.cy * h - Math.min(Math.sin(a), spec.domeApex ?? 1) * h * dg.r * (spec.domeFlat ?? 1) + fb.sink * h;
  const mainG = { ...FIN_GEOM_STD.main, ...spec.finGeom?.main };
  const R = mainG.wRoot * h;
  return { sx, sy, topBack: [sx - R * 1.1, sy - h * 0.07], topFront: [sx + R * 0.9, sy - h * 0.02] };
}
/** 鳍座算子（模式「鳍植于座」）：座的位置由三条关系定（正样
 * mecha-agile-side 侧面实读）——对穹：锚点贴穹弧（seatFrameOf
 * 派生，座是长在轮廓上的块体）；对鳍：座顶跨鳍根全幅（顶缘
 * 两端按根宽外张，刃的下行边在座顶内走一段才出座＝根埋进
 * 座里）；对眼：眼座挂下缘前段之下（眼座算子的 frontRead 读
 * 座多边形的下缘落位）。
 * 座形（2026-11-12 用户指认四边形板形不对后按正样重读）：座
 * 是鳍根的楔形整流罩，不是额前矩形板——顶缘跨根、前脸短
 * （只到 drop 的 0.45）、下缘前低后高：前下角自前脸下端斜收
 * 成尖（尖在 along 的 0.62、全深），后下角只到 drop 的
 * 0.55，下缘整条向后上方扫。前脸/下缘都不许拉成全幅直线。
 * 座形在头部坐标系展开、只有包鳍的顶缘随鳍根宽；尺寸是数据
 * （FinBaseGeom），鳍的画序在座之后 */
function finBasePart(frame: { sx: number; sy: number; topBack: [number, number]; topFront: [number, number] }, w: number, h: number, g: FinBaseGeom): HeadPart[] {
  const rx = frame.sx, ry = frame.sy;
  const nose: [number, number] = [rx + g.along * w, ry + g.drop * h * 0.45]; // 前脸下端（前脸只占全深的前段）
  const tip: [number, number] = [rx + g.along * w * 0.62, ry + g.drop * h]; // 前下尖（全深、横向收回——下缘前段是收尖斜边）
  const botBack: [number, number] = [rx - g.back * w, ry + g.drop * h * 0.55]; // 后下角（下缘向后上扫，只到 0.55 深）
  const pts: [number, number][] = [frame.topBack, frame.topFront, nose, tip, botBack];
  // 座的面分工（料厚层）：座是块体不是平板——前脸深一档、自座
  // 顶前段斜切到收尖斜边中段成界（正样实读的分面线）；本体面
  // 留在上/后，前脸覆层压暗（档位 finBaseFacet）
  const lerp2 = (p: [number, number], q: [number, number], t: number): [number, number] => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const facet: [number, number][] = [lerp2(frame.topBack, frame.topFront, 0.70), frame.topFront, nose, lerp2(nose, tip, 0.45)];
  return [
    { t: 'poly', pts, role: 'armor2' },
    { t: 'poly', pts: facet, role: 'armor2', tint: HEAD_GEOM.finBaseFacet },
  ];
}

/** 眼座算子（模式「檐凹座眼」）：座不许摆——座顶由檐的下缘派生
 * （下缘算子读檐节点），座顶再钻进檐下 0.012h 让檐压住；座高是
 * 数据（seatH 占头高）；发光登记随座同行，亮芯只许落在座内 */
function eyeSeatPart(brow: HeadPart | undefined, w: number, h: number, seatH: number, seatW: number, frontRead = false, eyeAng = 0): Extract<HeadPart, { t: 'block' }> {
  const cx = w * 0.28, hh = h * seatH, sw = w * seatW;
  if (frontRead && brow) {
    // 鳍座：眼座挂座下缘的前段——前端贴檐尖之后、前顶角贴
    // 座下缘（锚点读法见下），眼沿下缘全露。座身随眉线斜置
    // （eyeAng 数据：正样眼长轴向前下倾约 18°，与座下缘斜度
    // 同族），不许摆成水平条
    const frontX = brow.t === 'poly' ? Math.max(...brow.pts.map((q) => q[0])) : cx + sw / 2;
    const ncx = frontX - w * 0.10 - sw / 2; // 眼座前端退到座前脸之后（正样读数约 0.10w）
    // 锚点 = 眼座前顶角处的座下缘（不是全段最浅处）：座下缘前低
    // 后高时取最浅会把整座眼吊进座体、被座身画序盖掉（楔形座实
    // 证：眼被埋 9px、只剩光带一段露在分面边上）。前顶角贴下缘
    // 后，座身斜度（eyeAng）与下缘斜度同族，眼沿下缘全露
    const cornerX = ncx + (sw / 2) * Math.cos(eyeAng) + (hh / 2) * Math.sin(eyeAng);
    const top = partLowerY(brow, cornerX);
    // 斜置的座以「前顶角贴座下缘」定位：中心按转角回算——前顶
    // 角恰落在 top。沉量取 0：眼座斜度与座下缘斜度同族、整条
    // 顶边与下缘齐平贴合（留 0.012h 沉量时两边之间留一条亚像
    // 素缝，座尖处被周围件围成 1px 内洞——门实测）；后半座身
    // 仍由座体画序压住，后下角只略出座下缘
    const dy = top - Math.sin(eyeAng) * (sw / 2) + Math.cos(eyeAng) * (hh / 2);
    // faceW = 座的下沿料厚（眼窝的下唇面）：正样眼座下有一道
    // 受光的唇沿再接颊，座不许以一条黑边直接收尾
    return { t: 'block', dx: ncx, dy, w: sw, h: hh, kind: 'frame', glowSeat: true, ang: eyeAng, faceW: 2 };
  }
  const top = brow ? partLowerY(brow, cx) - h * 0.012 : -h * 0.5 - hh / 2;
  // 眉座眼：倾角读眉块宿主自带角（平行族——眼随眉斜，不自立水平）
  const hostAng = brow?.t === 'block' ? brow.ang : undefined;
  return { t: 'block', dx: cx, dy: top + hh / 2, w: sw, h: hh, kind: 'frame', glowSeat: true, faceW: 2, ...(hostAng ? { ang: hostAng } : {}) };
}

/** 平行线组算子（模式「着色线必平行于轮廓线」）：线没有自有角
 * 度——角从宿主节点读（flip = 与宿主角取镜像同族，壳斜缝对后鳍
 * 即此关系）；算子只按行表（位置/长/厚）排线。宿主转角线随转；
 * 在算子之外手抄一份同值角度就是回退 */
function parallelLines(host: HeadPart, flip: boolean, rows: { dx: number; dy: number; len: number; thick: number; ang?: number }[]): HeadPart[] {
  const ha = host.t === 'block' || host.t === 'wing' ? (host.ang ?? 0) : 0;
  const ang = flip ? -ha : ha;
  return rows.map((r) => ({ t: 'block', dx: r.dx, dy: r.dy, w: r.len, h: r.thick, kind: 'frame', cham: 0.5, ang: r.ang ?? ang }));
}

/** 前缘提取（沿边带算子的读数）：块取前缘两角；折线取前上
 * 顶点（x−y 最大）到前下顶点（x+y 最大）之间过最前点的顶点链 */
function frontEdgeOf(p: HeadPart): [number, number][] {
  if (p.t === 'block') {
    const a = p.ang ?? 0, cos = Math.cos(a), sin = Math.sin(a);
    const ux = cos, uy = sin, vx = -sin, vy = cos;
    const hw = p.w / 2, hh = p.h / 2;
    return [
      [p.dx + hw * ux - hh * vx, p.dy + hw * uy - hh * vy],
      [p.dx + hw * ux + hh * vx, p.dy + hw * uy + hh * vy],
    ];
  }
  if (p.t === 'poly') {
    const pts = p.pts;
    let si = 0, ei = 0, mx = -Infinity;
    pts.forEach(([x, y], i) => { if (x - y > pts[si][0] - pts[si][1]) si = i; if (x + y > pts[ei][0] + pts[ei][1]) ei = i; if (x > mx) mx = x; });
    const walk = (dir: number): [number, number][] => { const out: [number, number][] = []; for (let i = si; ; i = (i + dir + pts.length) % pts.length) { out.push(pts[i]); if (i === ei) break; } return out; };
    const fwd = walk(1);
    return fwd.some(([x]) => x === mx) ? fwd : walk(-1);
  }
  return [];
}

/** 沿边带算子（模式「随形带」）：带没有自有路径——路径是宿主列
 * 的前缘链包络（逐 y 取最前 x，脸面哪块板在最前就贴哪块的边），
 * 按链长参数 t 取段（t 可越出 [0,1] 沿端向延伸），带宽两端档位
 * 沿链渐变、离边内偏是数据；宿主移位/转角，带随之走。带是漆不
 * 是件：不自成 inst（长条自成板件会被刻面按自身框压暗、与承载
 * 面脱开），只交出中心路径点列 + 逐点半宽 + 承载宿主列，装配
 * 器渲染时登记给漆带阶段（继承承载面明暗）。手摆点列凑一条
 * 「沿边」的带就是回退 */
function chainRibbonPart(hosts: HeadPart[], paintHosts: HeadPart[], t0: number, t1: number, w0: number, w1: number, inset: number): HeadPart | null {
  const segs: [number, number, number, number][] = [];
  for (const hst of hosts) { const e = frontEdgeOf(hst); for (let i = 0; i + 1 < e.length; i++) segs.push([e[i][0], e[i][1], e[i + 1][0], e[i + 1][1]]); }
  if (!segs.length) return null;
  let yTop = Infinity, yBot = -Infinity;
  for (const sg of segs) { yTop = Math.min(yTop, sg[1], sg[3]); yBot = Math.max(yBot, sg[1], sg[3]); }
  const raw: [number, number][] = [];
  for (let y = yTop; y <= yBot; y += 2) {
    let fx = -Infinity;
    for (const [x1, y1, x2, y2] of segs) { if (y1 !== y2 && (y - y1) * (y - y2) <= 0) { const x = x1 + ((x2 - x1) * (y - y1)) / (y2 - y1); if (x > fx) fx = x; } }
    if (fx > -Infinity) raw.push([fx, y]);
  }
  if (raw.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const total = cum[cum.length - 1];
  if (!(total > 0)) return null;
  const at = (t: number): [number, number] => {
    const d = t * total;
    if (d <= 0) { const [x1, y1] = raw[0], [x2, y2] = raw[1]; const l = cum[1] || 1; return [x1 + ((x2 - x1) / l) * d, y1 + ((y2 - y1) / l) * d]; }
    if (d >= total) { const n = raw.length, [x1, y1] = raw[n - 2], [x2, y2] = raw[n - 1]; const l = (cum[n - 1] - cum[n - 2]) || 1; return [x2 + ((x2 - x1) / l) * (d - total), y2 + ((y2 - y1) / l) * (d - total)]; }
    let i = 1; while (cum[i] < d) i++;
    const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return [raw[i - 1][0] + (raw[i][0] - raw[i - 1][0]) * f, raw[i - 1][1] + (raw[i][1] - raw[i - 1][1]) * f];
  };
  const N = Math.max(2, Math.round(((t1 - t0) * total) / 3));
  const pts: [number, number][] = [], ws: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + (t1 - t0) * (i / N);
    const p = at(t), pn = at(Math.min(t + 0.01, t1)), pp = at(Math.max(t - 0.01, t0));
    let dx = pn[0] - pp[0], dy = pn[1] - pp[1];
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const nx = -dy, ny = dx; // 路径自上而下，内法线指 −x 侧（脸内）
    const wd = w0 + (w1 - w0) * t; // 全宽沿链渐变（两端档位是数据）
    const off = inset + wd / 2; // 中心线 = 前缘内偏（离边量 + 半宽）
    pts.push([p[0] + nx * off, p[1] + ny * off]);
    ws.push(wd / 2);
  }
  return { t: 'stripe', pts, ws, hosts: paintHosts };
}

/** 点色算子（模式「颏尖点色」）：点位不许选——由宿主轮廓的收尾
 * 点派生。宿主是折线：取最前下顶点（x+y 最大）为收尾点，点块沿
 * 该点两邻边的角平分线内收半高、长轴顺底边；宿主是块：取前下
 * 角，点块沿角平分线内收半高、角度随块。点的大小是数据 */
function chinTipPart(host: HeadPart, tw: number, th: number): HeadPart | null {
  if (host.t === 'poly') {
    let pi = 0, best = -Infinity;
    host.pts.forEach(([x, y], i) => { if (x + y > best) { best = x + y; pi = i; } });
    const P = host.pts[pi];
    const A = host.pts[(pi + host.pts.length - 1) % host.pts.length], B = host.pts[(pi + 1) % host.pts.length];
    const n = (dx: number, dy: number) => { const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l] as const; };
    const [ax, ay] = n(A[0] - P[0], A[1] - P[1]);
    const [bx, by] = n(B[0] - P[0], B[1] - P[1]);
    const [sx, sy] = n(ax + bx, ay + by);
    let ang = Math.atan2(by, bx);
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
    return { t: 'block', dx: P[0] + (sx * th) / 2, dy: P[1] + (sy * th) / 2, w: tw, h: th, ang, role: 'accent' };
  }
  if (host.t === 'block') {
    const a = host.ang ?? 0, cos = Math.cos(a), sin = Math.sin(a);
    const ux = cos, uy = sin, vx = -sin, vy = cos;
    const cx = host.dx + (host.w / 2) * ux + (host.h / 2) * vx, cy = host.dy + (host.w / 2) * uy + (host.h / 2) * vy;
    const l = Math.hypot(ux + vx, uy + vy) || 1;
    const ix = -(ux + vx) / l, iy = -(uy + vy) / l;
    return { t: 'block', dx: cx + (ix * th) / 2, dy: cy + (iy * th) / 2, w: tw, h: th, ang: a, role: 'accent' };
  }
  return null;
}

/** 降式算子：脸前楔由站位向量生成——上缘（次级轮廓，与主降同
 * 斜族）→ 主降（前缘斜线）→ 尖下内收（收尾点，颏尖点色挂它）
 * → 底缘回收 → 后缘升回。点列全由数据算出；此前主战吻板是手写
 * 六点多边形，降式在生成器里没有承载、收尾点只能靠手摆 */
function descentPart(x: number, y: number, w: number, h: number, d: { top: [number, number]; descent: [number, number]; under: [number, number]; inset: number; rise: number }): Extract<HeadPart, { t: 'poly' }> {
  const tx = x + d.top[0] * w, ty = y + d.top[1] * h;
  const fx = tx + d.descent[0] * w, fy = ty + d.descent[1] * h;
  const ux = fx + d.under[0] * w, uy = fy + d.under[1] * h;
  return { t: 'poly', pts: [[x, y], [tx, ty], [fx, fy], [ux, uy], [x + d.inset * w, uy + h * 0.05], [x - w * 0.02, y + d.rise * h]] };
}

/** 檐影带算子：沿宿主多边形首边（顶边）派生贴边暗带——带的上
 * 缘就是宿主首边、下缘由首边竖直内偏 drop 得出（面甲檐影的真
 * 身：是顶边的带，不是第二块手摆多边形） */
function topBandPart(pts: [number, number][], drop: number): Extract<HeadPart, { t: 'poly' }> {
  const [a, b] = [pts[0], pts[1]];
  return { t: 'poly', pts: [a, b, [b[0], b[1] + drop], [a[0], a[1] + drop]], tint: 0.8 };
}

/** 分节算子：沿宿主轴向派生节件——宿主先行建成，节距与轮廓是
 * 数据，节位全由宿主几何算出（同眼座/点色的派生纪律）。同一算子
 * 的四个已证实例：吻面横管的环沟（ring）、重型粗天线的环沟
 * （ring）、敏捷双鳍的刻节（翼宿主走 segWingParts）、兽颈环。
 * 此前横管的环是手摆的三块、天线与鳍根本没节——算子缺失的两副
 * 面孔（内联与缺画）在此收齐 */
function segBlockParts(host: Extract<HeadPart, { t: 'block' }>, axis: 'w' | 'h', pitch: number, profile: 'ring' | 'bead'): HeadPart[] {
  const a = host.ang ?? 0, cos = Math.cos(a), sin = Math.sin(a);
  const ux = axis === 'w' ? cos : -sin, uy = axis === 'w' ? sin : cos; // 宿主轴向单位向量
  const L = axis === 'w' ? host.w : host.h, T = axis === 'w' ? host.h : host.w;
  const out: HeadPart[] = [];
  for (let d = -L / 2 + pitch; d < L / 2 - pitch * 0.4; d += pitch) {
    const cx = host.dx + ux * d, cy = host.dy + uy * d;
    const along = profile === 'ring' ? Math.max(1.5, pitch * 0.22) : pitch * 0.6;
    const cross = profile === 'ring' ? T : T * 1.45; // 珠节须胀出宿主一圈才读得出（1.25 时在产品尺寸上与光杆无别，实测）
    out.push(axis === 'w'
      ? { t: 'block', dx: cx, dy: cy, w: along, h: cross, ang: a, kind: profile === 'ring' ? 'frame' : 'cyl' }
      : { t: 'block', dx: cx, dy: cy, w: cross, h: along, ang: a, kind: profile === 'ring' ? 'frame' : 'cyl' });
  }
  return out;
}

/** 分节算子（翼宿主）：沿翼脊派生刻沟——沟位与沟宽由翼长/根梢宽
 * 插值算出，沟向垂直于脊（与 parallelLines 同纪律：角度读宿主） */
/** 翼的扫掠刃形量：背风边比迎风边短的轴向份（翼工具的 cut 与
 * 刻节的截面读数共用一份——两处各写一份同值就是回退） */
const WING_CUT = 0.2;
function segWingParts(host: Extract<HeadPart, { t: 'wing' }>, pitchFrac: number): HeadPart[] {
  const out: HeadPart[] = [];
  const ca = Math.cos(host.ang), sa = Math.sin(host.ang);
  for (let t = pitchFrac; t < 1 - pitchFrac * 0.4; t += pitchFrac) {
    // 截面按扫掠刃形读：迎风边全程线性收分、背风边在 (1−cut) 处
    // 先收完，环宽 = 两边余量之和、环心随截面心偏（不许按对称
    // 宽排环——环会宽出刃身）
    const f = (host.wRoot * (1 - t) + host.wTip * t) / 2;
    const tb = Math.min(t / (1 - WING_CUT), 1);
    const b = (host.wRoot * (1 - tb) + host.wTip * tb) / 2;
    const off = (f - b) / 2; // 截面心相对轴线的偏（+ = 迎风侧）
    out.push({ t: 'block', dx: host.dx + ca * host.len * t - sa * off, dy: host.dy + sa * host.len * t + ca * off, w: (f + b) * 1.03, h: Math.max(1.5, host.len * pitchFrac * 0.32), ang: host.ang + Math.PI / 2, kind: 'frame' });
  }
  return out;
}

/** 鳍料厚算子（中脊式截面）：刃不是平面剪影——截面是带中脊的
 * 厚板（正样实读：脊线一条亮带、迎/背两面异调）。沿扫掠刃形
 * 的截面心列（与 segWingParts 同一截面读法）织两件：中脊亮带
 * （脊半宽 = 截面宽 × 档位、亮档 tint）+ 背侧面压暗覆层（脊缘
 * →背缘）。截面几何全由宿主翼派生，档位是数据（finSpine） */
function wingSpineParts(host: Extract<HeadPart, { t: 'wing' }>, opt: { w: number; spine: number; flank: number }): HeadPart[] {
  const ca = Math.cos(host.ang), sa = Math.sin(host.ang);
  const sec = (t: number) => {
    const f = (host.wRoot * (1 - t) + host.wTip * t) / 2;
    const tb = Math.min(t / (1 - WING_CUT), 1);
    const b = (host.wRoot * (1 - tb) + host.wTip * tb) / 2;
    const off = (f - b) / 2;
    return { x: host.dx + ca * host.len * t - sa * off, y: host.dy + sa * host.len * t + ca * off, full: f + b };
  };
  const ts = [0.05, 0.3, 0.55, 0.8, 0.96];
  const spineHalf = (t: number) => Math.min(Math.max(0.7, sec(t).full * opt.w), Math.max(0.15, sec(t).full / 2 - 0.3)); // 脊半宽随截面收分封顶在刃内：梢部刃薄于档位下限时脊不许宽出刃身（宽出会探出剪影、撑大画布）
  const band = (inner: (t: number) => number, outer: (t: number) => number): [number, number][] => [
    ...ts.map((t) => { const s = sec(t); return [s.x - sa * inner(t), s.y + ca * inner(t)] as [number, number]; }),
    ...[...ts].reverse().map((t) => { const s = sec(t); return [s.x - sa * outer(t), s.y + ca * outer(t)] as [number, number]; }),
  ];
  const spine = band((t) => -spineHalf(t), spineHalf);
  const flank = band(spineHalf, (t) => Math.max(spineHalf(t), sec(t).full / 2 - 0.6)); // 背侧覆层止于刃缘内 0.6px：覆层只许在刃身内分面、不许探出剪影（探出会撑大画布、动装配锚）
  const role = host.role ?? 'accent';
  return [
    { t: 'poly', pts: flank, role, tint: opt.flank },
    { t: 'poly', pts: spine, role, tint: opt.spine },
  ];
}

/** 降式算子标准站位在 head-geom 数据层（FACE_DESCENT_STD）：规格未给
 * faceDescent 时的缺省档；规格显式给了站位时以数据为准 */

/** 单位点列 → 头部坐标（x 乘 w、y 乘 h）：规格里的形点列数据统一走它 */
function unitPts(pts: [number, number][], w: number, h: number): [number, number][] {
  return pts.map(([ux, uy]) => [ux * w, uy * h]);
}

/** 几何记录装配器：把单位几何数据（GPart）缩放为头部零件。
 * 构造器只经它取几何——几何数值全在数据层（head-geom / 规格覆盖）。 */
function emitG(g: GPart, w: number, h: number): HeadPart {
  const dx = (g.dx ?? 0) * w, dy = (g.dy ?? 0) * h;
  const opt = {
    ...(g.ang !== undefined ? { ang: g.ang } : {}),
    ...(g.kind ? { kind: g.kind } : {}),
    ...(g.cham !== undefined ? { cham: g.cham } : {}),
    ...(g.bolts ? { bolts: true } : {}),
    ...(g.faceW !== undefined ? { faceW: g.faceW } : {}),
    ...(g.tint !== undefined ? { tint: g.tint } : {}),
    ...(g.role ? { role: g.role } : {}),
    ...(g.glowSeat ? { glowSeat: true } : {}),
    ...(g.inset ? { inset: g.inset } : {}),
  };
  switch (g.t) {
    case 'block': return { t: 'block', dx, dy, w: (g.w ?? 0) * w, h: (g.h ?? 0) * h, ...opt };
    case 'disc': return { t: 'disc', dx, dy, r: g.r !== undefined ? g.r * w : g.rh !== undefined ? g.rh * h : (g.rm ?? 0) * Math.min(w, h), ...(g.kind ? { kind: g.kind } : {}) };
    case 'grille': return { t: 'grille', dx, dy, w: (g.w ?? 0) * w, h: (g.h ?? 0) * h, ...(g.bars ? { bars: { groups: g.bars.groups, gap: g.bars.gap * h, role: g.bars.role } } : {}) };
    case 'poly': return { t: 'poly', pts: unitPts(g.pts ?? [], w, h), ...(g.bolts ? { bolts: true } : {}), ...(g.faceW !== undefined ? { faceW: g.faceW } : {}), ...(g.faceEdge ? { faceEdge: g.faceEdge } : {}), ...(g.role ? { role: g.role } : {}), ...(g.tint !== undefined ? { tint: g.tint } : {}) };
  }
}

/** 线记录缩放（平行线组算子的入参装配） */
function scaleLine(L: GLine, w: number, h: number): { dx: number; dy: number; len: number; thick: number; ang?: number } {
  return { dx: L.dx * w, dy: L.dy * h, len: L.len * w, thick: L.thick * h, ...(L.ang !== undefined ? { ang: L.ang } : {}) };
}

/** 翼形装配：把翼形几何数据（FinGeom，规格/标准档）转成翼件 */
function wingOf(g: FinGeom, w: number, h: number, role?: 'accent'): Extract<HeadPart, { t: 'wing' }> {
  return { t: 'wing', dx: g.dx * w, dy: g.dy * h, len: g.len * w, wRoot: g.wRoot * h, wTip: g.wTip * h, ang: g.ang, ...(role ? { role } : {}) };
}

/** 穹顶算子：按穹弧几何数据织弧顶 + 等距回声带——弧的织法（密点成弧、
 * sin 封顶成平台、回声带顺弧）是算子的画法，几何全来自数据（DomeGeom +
 * domeFlat/domeApex/crownBand/echoSecond），算子内不存一份几何数值。 */
function domeParts(w: number, h: number, dg: DomeGeom, flat: number, apex: number, band: 'accent' | 'line', echoSecond?: [number, number]): HeadPart[] {
  const arcY = (a: number, r: number) => dg.cy * h - Math.min(Math.sin(a), apex) * h * r * flat;
  const arc: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI * (1 - i / 12); // 后→顶→前（密点成弧，免折线阶梯）
    arc.push([dg.cx * w + Math.cos(a) * w * dg.r, arcY(a, dg.r)]);
  }
  // 底边走斜边（botAng 数据）：以后角为锚、向前下行，与壳缝
  // 同属对角线族——水平直弦是假分界，水平+垂直的阶梯拼同样
  // 是轴线、一样假。后角不动（关合边与剪影原样）
  const dip = Math.tan(dg.botAng ?? 0.15) * (dg.baseFront - dg.baseRear) * w;
  arc.push([dg.baseFront * w, dg.baseY * h + dip], [dg.baseRear * w, dg.baseY * h]);
  const out: HeadPart[] = [{ t: 'poly', pts: arc, ...(dg.roleMain ? { role: dg.roleMain } : {}) }]; // 圆顶（真弧顶，不是大倒角方块）
  const echoBand = (rOut: number, rIn: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (dg.bandSpan[0] - (i / 10) * dg.bandSpan[1]);
      pts.push([dg.cx * w + Math.cos(a) * w * rOut, arcY(a, rOut)]);
    }
    for (let i = 10; i >= 0; i--) {
      const a = Math.PI * (dg.bandSpan[0] - (i / 10) * dg.bandSpan[1]);
      pts.push([dg.cx * w + Math.cos(a) * w * rIn, arcY(a, rIn)]);
    }
    return pts;
  };
  // 顺弧回声带：漆带（强调色、宽档）或板界线（压暗成线、薄档）由 crownBand 数据选——无 tint 的线档会读作凸肋（对照轮实证）
  const [bOut, bIn] = band === 'accent' ? dg.bandWide : dg.bandLine;
  out.push(band === 'accent' ? { t: 'poly', pts: echoBand(bOut, bIn), role: 'accent' } : { t: 'poly', pts: echoBand(bOut, bIn), tint: 0.78, ...(dg.roleBand ? { role: dg.roleBand } : {}) });
  if (echoSecond) out.push({ t: 'poly', pts: echoBand(echoSecond[0], echoSecond[1]), role: 'accent' }); // 双回声组合（动力服）：同算子第二次调用，半径是数据
  return out;
}

/** 穹弧面高度（绝对 px）：穹弧在横站位 dxFrac 处的弧面 y——与
 * domeParts 同式（圆心/半径/domeFlat/domeApex 全走规格穹数据）。
 * 贴穹件的纵坐标一律经此派生，不许各存一份写死高度 */
/** 穹底线派生（brow 类）：几何带 baseOff 时中心纵坐标 = 穹底线
 * baseY + baseOff——眉下缘贴穹底线、穹数据变眉跟走 */
function baseSnap(spec: HeadSpec, h: number, g: GPart, p: HeadPart): HeadPart {
  if (g.baseOff === undefined || !('dy' in p)) return p;
  const dg = spec.geom?.dome ?? HEAD_GEOM.dome;
  return { ...p, dy: (dg.baseY + g.baseOff) * h } as HeadPart;
}
function domeArcY(spec: HeadSpec, w: number, h: number, dxFrac: number): number {
  const dg = spec.geom?.dome ?? HEAD_GEOM.dome;
  const c = Math.max(-1, Math.min(1, (dxFrac - dg.cx) / dg.r));
  const s = Math.sqrt(1 - c * c);
  return dg.cy * h - Math.min(s, spec.domeApex ?? 1) * h * dg.r * (spec.domeFlat ?? 1);
}
/** 穹弧前端切线角（平行族派生）：线行带 arcTan 时，走向 = 穹弧
 * 在该行前端站位处的切线角——穹前侧下降段的切线方向，缝是这
 * 条下降线在壳面上的平行延续（正样壳缝实测 ≈0.15–0.30 rad，
 * 本式在敏捷穹上给出 0.28）。前端站位由行长与角自洽（迭代两
 * 次）；站位落进 apex 压平区时切线归水平 */
function domeFrontTangent(spec: HeadSpec, w: number, h: number, cxFrac: number, lenFrac: number): number {
  const dg = spec.geom?.dome ?? HEAD_GEOM.dome;
  const flat = spec.domeFlat ?? 1, apex = spec.domeApex ?? 1;
  let th = 0.28;
  for (let i = 0; i < 2; i++) {
    const xf = cxFrac + (lenFrac / 2) * Math.cos(th);
    const c = Math.max(-1, Math.min(1, (xf - dg.cx) / dg.r));
    const s = Math.sqrt(1 - c * c);
    th = s > apex ? 0 : Math.atan2(c * h * flat, s * w);
  }
  return th;
}
/** 贴穹件纵坐标派生：GPart 带 arcOff 时 dy 改由穹弧面 + 偏移定 */
function arcSnap(spec: HeadSpec, w: number, h: number, g: GPart, p: HeadPart): HeadPart {
  return g.arcOff !== undefined && 'dy' in p ? { ...p, dy: domeArcY(spec, w, h, g.dx ?? 0) + g.arcOff * h } as HeadPart : p;
}

/** 天线装配算子：粗杆（杆脚贴穹弧、向下埋 sink；分节走环沟）+ 杆顶盘（位置由杆轴派生）+ 细杆 + 基座（站位均贴穹弧 arcOff）——几何全是数据（antGeom 规格/ANT_GEOM_STD/HEAD_GEOM 天线档） */
function antennaParts(spec: HeadSpec, w: number, h: number): HeadPart[] {
  const ag = { ...ANT_GEOM_STD, ...spec.antGeom }; // 标准档在 head-geom 数据层，规格覆盖
  const rodBottom = domeArcY(spec, w, h, ag.dx) + ag.sink * h; // 杆脚：穹弧面 + 埋深（穹变杆脚跟走）
  const antA: Extract<HeadPart, { t: 'block' }> = { t: 'block', dx: ag.dx * w, dy: rodBottom - (ag.len * h) / 2, w: w * HEAD_GEOM.antW, h: ag.len * h, kind: 'cyl', ang: ag.lean };
  const out: HeadPart[] = [antA];
  if (spec.topSeg) out.push(...segBlockParts(antA, 'h', h * HEAD_GEOM.antSegPitch, 'ring')); // 粗天线走分节算子的环沟式：杆身连续、沟是切进杆身的环——珠节式（节间留空 40%）在产品尺寸上断成点列，与参考的连续杆+环沟不合（反向检查定案）；细杆保持光素
  out.push({ t: 'disc', dx: ag.dx * w + Math.sin(ag.lean) * (ag.len / 2 + HEAD_GEOM.antTipOff) * h, dy: antA.dy - Math.cos(ag.lean) * (ag.len / 2 + HEAD_GEOM.antTipOff) * h, r: w * HEAD_GEOM.antTipR }); // 杆顶盘：位置由杆的轴线派生（倾则随倾）
  out.push(arcSnap(spec, w, h, HEAD_GEOM.antThin, emitG(HEAD_GEOM.antThin, w, h)));
  out.push(arcSnap(spec, w, h, HEAD_GEOM.antBase, emitG(HEAD_GEOM.antBase, w, h)));
  return out;
}

// ---------- 头部图展开器：模板（HEAD_GRAPH 数据）→ 节点列 ----------
// 头部模板就是数据（head-geom 的 HEAD_GRAPH）：每步写明槽位/式/
// 条件/算子/几何出处/宿主交接。展开器只按图走——选式与条件都是
// 数据判定，算子按名调用，节点列按 HEAD_DRAW_ORDER 画序组出——
// 不存任何头部专属的装配决定。实例（规格）+ 模板（图）经此展开
// 成节点列，再由通用装配器 renderPartNodes 画出：DAG 自己把
// 自己画出来，代码只负责调用。

/** 图步条件判定（数据语义求值，判定本身不带头部知识） */
function headWhen(when: HeadWhen | undefined, spec: HeadSpec): boolean {
  if (!when) return true;
  if ('all' in when) return when.all.every((w2) => headWhen(w2, spec));
  const S = spec as unknown as Record<string, unknown>;
  if ('flag' in when) return !!S[when.flag];
  if ('notFlag' in when) return !S[when.notFlag];
  if ('specEq' in when) return S[when.specEq[0]] === when.specEq[1];
  if ('specNeq' in when) return S[when.specNeq[0]] !== when.specNeq[1];
  if ('formNeq' in when) return spec.form[when.formNeq[0] as keyof HeadSpec['form']] !== when.formNeq[1];
  if ('formFlag' in when) return !!spec.form[when.formFlag as keyof HeadSpec['form']];
  return true;
}

function headIR(spec: HeadSpec): HeadIR {
  const w = spec.w, h = spec.h, F = spec.form;
  const hosts: Record<string, HeadPart | undefined> = {};
  const groups = new Map<string, HeadPart[]>();
  let curSrc = ''; // 当前图步的溯源名（runStep 入口置，push 缺省盖它）
  const push = (group: string, parts: HeadPart[], src?: string) => { const s = src ?? curSrc; const stamped = s ? parts.map((p) => ({ ...p, src: s })) : parts; const g = groups.get(group); if (g) g.push(...stamped); else groups.set(group, [...stamped]); };
  /** 图步溯源名：几何键优先（emit/emitEach/lines/tipBlock），无
   * 几何键的算子步按算子名 + 槽位（dome / wing:main / eyeSeat /
   * eyeGlow / finBase / antenna / ribbon / descent / seg:节距键） */
  const stepSrc = (step: HeadStep): string => {
    if (step.geom) return step.geom;
    if (step.pts) return step.pts;
    if (step.pitchFrom) return 'seg:' + step.pitchFrom;
    if (step.sizeFrom) return 'tip:' + step.sizeFrom;
    switch (step.op) {
      case 'dome': return 'dome';
      case 'wing': return 'wing:' + (step.fin ?? '');
      case 'seat': return 'eyeSeat';
      case 'slitLights': return 'eyeGlow';
      case 'dotLight': return 'dotLight';
      case 'finBase': return 'finBase';
      case 'antenna': return 'antenna';
      case 'ribbon': return 'ribbon';
      case 'descent': return 'descent';
      default: return step.op;
    }
  };
  const geomOf = (key: string): unknown => (spec.geom as Record<string, unknown> | undefined)?.[key] ?? (HEAD_GEOM as Record<string, unknown>)[key];
  const seatFrame = seatFrameOf(spec, w, h); // 鳍座框（穹→座派生，展开前先行：鳍步与座步共用）
  const mainFinG = { ...FIN_GEOM_STD.main, ...spec.finGeom?.main };
  const mainRootDy = mainFinG.arcSink !== undefined ? domeArcY(spec, w, h, mainFinG.dx) / h + mainFinG.arcSink : mainFinG.dy; // 无座主鳍根与 wing 步同式（弧站位派生）——整流罩锚点必须与鳍根同点
  const finAnchor: [number, number] = seatFrame ? [seatFrame.sx, seatFrame.sy] : [mainFinG.dx * w, mainRootDy * h]; // 鳍锚点：有座 = 座锚 S、无座 = 主鳍根（整流罩点列的平移原点）
  let seatPart: Extract<HeadPart, { t: 'block' }> | undefined;
  let seatFront = false; // 眼座是否挂鳍座前缘（frontRead）——缝光带随座定位的开关
  const hostCenterOf = (p: HeadPart | undefined): [number, number] | undefined => { // 宿主中心（多边形取包围盒心）：rel 站位的原点
    if (!p) return undefined;
    if (p.t === 'poly') { const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; }
    if (p.t === 'stripe' || p.t === 'light') return undefined;
    return [p.dx, p.dy];
  };
  const hostBBoxOf = (p: HeadPart | undefined): { x2: number; y2: number } | undefined => { // 宿主包围盒前下角（tipBlock 锚）：块按未旋转框、 多边形按点列
    if (!p) return undefined;
    if (p.t === 'poly') { const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]); return { x2: Math.max(...xs), y2: Math.max(...ys) }; }
    if (p.t === 'block') return { x2: p.dx + p.w / 2, y2: p.dy + p.h / 2 };
    if (p.t === 'disc') return { x2: p.dx + p.r, y2: p.dy + p.r };
    return undefined;
  };
  const relPlace = (step: HeadStep, g: GPart, p: HeadPart): HeadPart => { // rel 站位：几何带 rel 且图步带 relHost 时，站位 = 宿主中心 + rel（dx/dy 不作数）
    if (!step.relHost || !g.rel || !('dx' in p)) return p;
    const c = hostCenterOf(hosts[step.relHost]);
    return c ? { ...p, dx: c[0] + g.rel[0] * w, dy: c[1] + g.rel[1] * h } as HeadPart : p;
  };
  const segOn = (target: HeadPart, segKind: 'block' | 'wing' | undefined, axis: 'w' | 'h' | undefined, pitchFrom: string, mode: 'ring' | 'bead' | undefined): HeadPart[] =>
    segKind === 'wing'
      ? segWingParts(target as Extract<HeadPart, { t: 'wing' }>, (HEAD_GEOM as Record<string, number>)[pitchFrom])
      : segBlockParts(target as Extract<HeadPart, { t: 'block' }>, axis ?? 'h', (axis === 'w' ? w : h) * (HEAD_GEOM as Record<string, number>)[pitchFrom], mode ?? 'ring');
  const runStep = (step: HeadStep): void => {
    if (step.slot && step.form !== undefined) { const want = Array.isArray(step.form) ? step.form : [step.form]; if (!want.includes(F[step.slot])) return; }
    if (!headWhen(step.when, spec)) return;
    curSrc = stepSrc(step);
    switch (step.op) {
      case 'emit': {
        const eg = geomOf(step.geom!) as GPart;
        let p = arcSnap(spec, w, h, eg, emitG(eg, w, h)); // 贴穹件（arcOff）纵坐标由穹弧派生
        p = baseSnap(spec, h, eg, p); // 穹底线件（baseOff，如眉）纵坐标由穹底线派生
        p = relPlace(step, eg, p); // 宿主相对站位（rel）：承载体定原点
        if (step.angFrom === 'jawAng') p = { ...p, ang: spec.jawAng ?? HEAD_GEOM.jawAngStd } as HeadPart; // 颌角是规格（块/小颌共用）
        if (step.provides) hosts[step.provides] = p;
        push(step.group, [p]);
        break;
      }
      case 'emitEach': {
        const out: HeadPart[] = [];
        for (const g of geomOf(step.geom!) as GPart[]) {
          let p: HeadPart;
          if (step.bodyCham && g.host === 'body') { // 盔体切角按冠式（数据 bodyCham；构造器当年的当场读法原样）
            const bc = (spec.geom as { bodyCham?: Record<string, number> } | undefined)?.bodyCham?.[F.crown] ?? HEAD_GEOM.bodyCham[F.crown];
            p = { ...emitG(g, w, h), cham: bc } as HeadPart;
          } else p = emitG(g, w, h);
          p = arcSnap(spec, w, h, g, p); // 贴穹件（arcOff，如冠阶）纵坐标由穹弧派生
          p = relPlace(step, g, p); // 宿主相对站位（rel，如耳/太阳穴对盔体）
          if (step.chamByCrown && p.t === 'block' && p.cham === undefined) p.cham = HEAD_GEOM.stepCham[F.crown] ?? HEAD_GEOM.stepChamStd; // 分段冠板切角缺省按冠式
          if (g.host) hosts[g.host] = p;
          out.push(p);
          if (step.followUps) for (const fu of step.followUps) if (fu.host === g.host && headWhen(fu.step.when, spec)) out.push(...segOn(p, 'block', fu.step.axis, fu.step.pitchFrom, fu.step.mode)); // 紧随步（如领圈分节：环沟横切领圈成叠环）
        }
        push(step.group, out);
        break;
      }
      case 'poly': {
        let pts = unitPts((spec as unknown as Record<string, [number, number][] | undefined>)[step.pts!] ?? (HEAD_GEOM as Record<string, [number, number][]>)[step.ptsStd!], w, h);
        if (step.anchorFin) pts = pts.map(([x, y]): [number, number] => [x + finAnchor[0], y + finAnchor[1]]); // 点列锚定鳍锚点（存的是相对偏移）
        if (step.anchorHost) { // 点列锚定宿主中心（存相对偏移）：宿主不在场时回落到眉站位数据（眉块可缺席、站位是建筑线恒在——面甲锚的是眉线不是眉块）
          const c = hostCenterOf(hosts[step.anchorHost]) ?? (step.anchorHost === 'brow' ? [(HEAD_GEOM.brow.dx ?? 0) * w, ((spec.geom?.dome ?? HEAD_GEOM.dome).baseY + (HEAD_GEOM.brow.baseOff ?? 0)) * h] as [number, number] : undefined);
          if (c) pts = pts.map(([x, y]): [number, number] => [x + c[0], y + c[1]]);
        }
        if (step.anchorBaseY) { const by = (spec.geom?.dome ?? HEAD_GEOM.dome).baseY * h; pts = pts.map(([x, y]): [number, number] => [x, y + by]); } // 点列 y 锚定穹底线（存相对偏移）
        const role = step.specRole ? (spec as unknown as Record<string, string | undefined>)[step.specRole] : step.role; // 角色可由规格数据给（步只声明出处，如整流罩色随头数据钉）
        const p: HeadPart = { t: 'poly', pts, ...(role ? { role } : {}), ...(step.tintFrom ? { tint: (HEAD_GEOM as Record<string, number>)[step.tintFrom] } : {}) } as HeadPart;
        if (step.provides) hosts[step.provides] = p;
        push(step.group, step.topBandFrom ? [p, topBandPart(pts, h * (HEAD_GEOM as Record<string, number>)[step.topBandFrom])] : [p]); // 檐影带（面甲：沿顶边派生）
        break;
      }
      case 'wing': {
        let g = step.fin === 'horn' ? { ...HORN_GEOM_STD, ...spec.hornGeom } : { ...FIN_GEOM_STD[step.fin as 'main' | 'rear'], ...spec.finGeom?.[step.fin as 'main' | 'rear'] };
        if (seatFrame && step.fin !== 'horn') { // 鳍根由座派生（穹→座→鳍）：双鳍同根——主/后鳍根同为锚点 S、只轴角与长不同，从一点扇出；规格里的 dx/dy 在有座时不作数
          g = { ...g, dx: seatFrame.sx / w, dy: seatFrame.sy / h };
        } else if (g.arcSink !== undefined) { // 无座鳍的根走弧站位：根 = 穹弧在 dx 站位的弧面 + 埋深（角/刃型主鳍）——根贴轮廓、穹变跟走，不许存自由纵坐标
          g = { ...g, dy: domeArcY(spec, w, h, g.dx) / h + g.arcSink };
        }
        const p = wingOf(g, w, h, step.role);
        if (step.provides) hosts[step.provides] = p; // 宿主交接由步数据声明（如后鳍宿主 rearWing：壳斜缝读它取镜像同族）
        push(step.group, [p]);
        break;
      }
      case 'dome': {
        push(step.group, domeParts(w, h, spec.geom?.dome ?? HEAD_GEOM.dome, spec.domeFlat ?? 1, spec.domeApex ?? 1, spec.crownBand === 'accent' ? 'accent' : 'line', spec.echoSecond)); // 穹顶算子：几何/档位全是数据
        break;
      }
      case 'seg': {
        const target = hosts[step.target!];
        if (target) push(step.group, segOn(target, step.segKind, step.axis, step.pitchFrom!, step.mode));
        break;
      }
      case 'spine': {
        const target = hosts[step.target!];
        if (target && target.t === 'wing') push(step.group, wingSpineParts(target, HEAD_GEOM.finSpine), 'wingSpine'); // 鳍料厚：中脊亮带 + 背侧压暗（截面由宿主翼派生）
        break;
      }
      case 'lines': {
        const all = geomOf(step.geom!) as GLine[];
        let rows = step.index !== undefined ? [all[step.index]] : all;
        let host = hosts[step.host!]; let mirror = step.mirror ?? false;
        if (step.hostAny) { // 候选宿主列由步数据声明：取第一个在场的；mirrorWhenFirst = 命中首选时镜像（如斜缝：有后鳍读后鳍镜像、无则读盔体）
          host = step.hostAny.map((hn) => hosts[hn]).find((x) => !!x);
          if (step.mirrorWhenFirst) mirror = !!hosts[step.hostAny[0]];
        }
        if (step.relHost) { const c = hostCenterOf(hosts[step.relHost]); if (c) rows = rows.map((L) => ({ ...L, dx: L.dx + c[0] / w, dy: L.dy + c[1] / h })); } // 线位相对宿主中心（rel）：行数据存偏移、展开时平移到宿主
        rows = rows.map((L) => (L.arcTan ? { ...L, ang: domeFrontTangent(spec, w, h, L.dx, L.len) } : L)); // arcTan 行：角由穹弧前端切线派生（平行族），数据里不许存写死角
        if (host) push(step.group, parallelLines(host, mirror, rows.map((L) => scaleLine(L, w, h)))); // 平行线组算子：角度从宿主读
        break;
      }
      case 'ribbon': {
        const rb = HEAD_GEOM.cheekRibbon;
        const hs = (step.hosts ?? []).map((hn) => hosts[hn]).filter((x): x is HeadPart => !!x);
        const extra = (step.paintHosts ?? []).map((hn) => hosts[hn]).filter((x): x is HeadPart => !!x); // 承载列 = 链宿主 + 步数据声明的漆宿主（如盔体：宿主间隙段的脸面是盔体）
        const paint = [...hs, ...extra.filter((p) => !hs.includes(p))];
        const rp = hs.length ? chainRibbonPart(hs, paint, rb.from, rb.to, w * rb.w0, w * rb.w1, w * rb.inset) : null;
        if (rp) push(step.group, [rp]); // 脸侧顺边带：路径由沿边带算子从宿主前缘链派生
        break;
      }
      case 'seat': {
        const seatW = spec.seatW ?? HEAD_GEOM.seatW[F.eye] ?? HEAD_GEOM.seatW.slit; // 眼座宽：规格覆盖优先，未给按眼式档（数据）
        seatFront = !!hosts.seatHost;
        seatPart = eyeSeatPart(hosts.seatHost ?? hosts.brow, w, h, spec.seatH ?? HEAD_GEOM.seatHStd, seatW, seatFront, spec.eyeAng ?? HEAD_GEOM.eyeAngStd); // 眼座算子：座顶按檐下缘派生（鳍座时读座前缘）、倾角走 eyeAng 数据
        push(step.group, [seatPart]);
        break;
      }
      case 'slitLights': {
        if (!seatPart) break;
        const out: HeadPart[] = [];
        const ex0 = HEAD_GEOM.slitStart, exEnd = spec.slitEnd ?? HEAD_GEOM.slitEndStd, peak = spec.glowPeak ?? HEAD_GEOM.glowPeakStd;
        if (seatFront) {
          // 鳍座眼：光带是眼座的内含物、随座定位（座在哪光带在哪；
          // 按头部绝对分数排带只对得住钉死的眉座，座一移光带就脱座）。
          // 点列沿座身转角轴排（座斜带斜），前端多留一档收进座内——
          // 光带前端不许探出脸面（正样：眼尖在眉尖之后、脸面之前内收）
          const a = seatPart.ang ?? 0, cos = Math.cos(a), sin = Math.sin(a);
          const lx0 = -seatPart.w / 2 + w * 0.02, lx1 = seatPart.w / 2 - w * 0.02;
          for (let lx = lx0; lx <= lx1; lx += w * 0.011) { const t = (lx - lx0) / (lx1 - lx0); const s = t <= peak ? 0.3 + 0.7 * Math.pow(t / peak, 1.4) : 1 - 0.3 * ((t - peak) / (1 - peak)); out.push({ t: 'light', dx: seatPart.dx + lx * cos, dy: seatPart.dy + lx * sin, s }); }
          push(step.group, out);
          break;
        }
        for (let ex = ex0; ex <= exEnd; ex += 0.011) { const t = (ex - ex0) / (exEnd - ex0); const s = t <= peak ? 0.3 + 0.7 * Math.pow(t / peak, 1.4) : 1 - 0.3 * ((t - peak) / (1 - peak)); out.push({ t: 'light', dx: w * ex, dy: seatPart.dy + (w * ex - seatPart.dx) * Math.tan(seatPart.ang ?? 0), s }); } // 缝眼光带：峰在前段、向后收尾成一颗光体（织法是算子画法，起终点/峰位是数据）；带随座倾角走、不自立水平
        push(step.group, out);
        break;
      }
      case 'dotLight': {
        if (seatPart) push(step.group, [{ t: 'light', dx: w * HEAD_GEOM.dotLightDx, dy: seatPart.dy }]);
        break;
      }
      case 'descent': {
        const p = descentPart(w * HEAD_GEOM.respAnchor[0], h * HEAD_GEOM.respAnchor[1], w, h, spec.faceDescent ?? FACE_DESCENT_STD); // 降式算子：站位向量是数据
        if (step.provides) hosts[step.provides] = p;
        push(step.group, [p]);
        break;
      }
      case 'chinTip': {
        const host = hosts[step.host!];
        if (host) { const ts = spec.chinTipScale ?? 1; const size = (HEAD_GEOM as Record<string, [number, number]>)[step.sizeFrom!]; const tip = chinTipPart(host, w * size[0] * ts, h * size[1] * ts); if (tip) push(step.group, [tip]); } // 点色算子：点位从宿主收尾派生、大小是档位
        break;
      }
      case 'tipBlock': {
        const tg = geomOf(step.geom!) as GPart; const ts = spec.chinTipScale ?? 1; // 颏前点色块走点色档位（整段档 = 占颏端整段）；块的斜置/切角随几何数据（楔形件要斜挂）
        let tdx = (tg.dx ?? 0) * w, tdy = (tg.dy ?? 0) * h;
        if (step.relHost && tg.rel) { const bb = hostBBoxOf(hosts[step.relHost]); if (bb) { tdx = bb.x2 + tg.rel[0] * w; tdy = bb.y2 + tg.rel[1] * h; } } // 前下角锚：块挂宿主包围盒前下角 + rel（颌楔随颌板、管口尖随颌体）
        push(step.group, [{ t: 'block', dx: tdx, dy: tdy, w: (tg.w ?? 0) * w * ts, h: (tg.h ?? 0) * h * ts, role: 'accent', ...(tg.ang ? { ang: tg.ang } : {}), ...(tg.cham ? { cham: tg.cham } : {}) }]);
        break;
      }
      case 'antenna': {
        push(step.group, antennaParts(spec, w, h)); // 天线装配算子（杆/珠节/杆顶盘/细杆/基座一组，几何全是数据）
        break;
      }
      case 'finBase': {
        if (seatFrame) { const ps = finBasePart(seatFrame, w, h, { ...HEAD_GEOM.finBase, ...spec.finBaseGeom }); if (step.provides) hosts[step.provides] = ps[0]; push(step.group, ps); } // 鳍座：座锚点由穹弧派生（seatFrameOf），不读鳍——派生方向穹→座→鳍；两鳍共用此座（鳍根在 wing 步按座框落位）；座体 + 前脸分面两件
        break;
      }
    }
  };
  for (const step of HEAD_GRAPH) if (step.group === 'top') runStep(step); // 顶附属先展开（壳斜缝/眼座宿主先行），画序仍排最后
  for (const step of HEAD_GRAPH) if (step.group !== 'top') runStep(step);
  const parts = HEAD_DRAW_ORDER.flatMap((g) => groups.get(g) ?? []);
  // 对外锚点全部由构造派生（原 HEAD_GEOM.anchors 绝对分数表已
  // 删——无消费方、且与零件实际位置对不上）：眼 = 眼座件中心
  // （无眼座时取面甲包围盒心）、耳 = 耳组首件中心、冠 = 穹弧顶点
  const dgA = spec.geom?.dome ?? HEAD_GEOM.dome;
  const eyeC = seatPart ? [seatPart.dx, seatPart.dy] : (hosts['visor'] ? hostCenterOf(hosts['visor']) : undefined);
  const earP = (groups.get('ear') ?? [])[0];
  const earC = earP ? hostCenterOf(earP) : undefined;
  const toAbs = (c: [number, number] | undefined): Pt => ({ x: spec.seat.x + (c ? c[0] : 0), y: spec.seat.y + (c ? c[1] : 0) });
  return { anchors: { seat: spec.seat, eye: toAbs(eyeC), ear: toAbs(earC), crown: { x: spec.seat.x + dgA.cx * w, y: spec.seat.y + dgA.cy * h - Math.min(1, spec.domeApex ?? 1) * h * dgA.r * (spec.domeFlat ?? 1) } }, parts };
}

// ---------- 通用装配器：节点列 → 画布（部位无关） ----------
// DAG 的唯一解释器：只认节点列与环境（锚点/倾角/种子），不认
// 部位——头部的节点列与足部的节点列走同一条路（交换判据：把
// 足的节点列喂到头的锚点，就在头位渲出一只脚）。节点带 reg 时
// 走显式登记（足部构造在 layout 里逐件手登记的色调/面线/唇/缝/
// 棱/栓，收进节点数据，装配器照单执行）；不带 reg 走图层工具的
// 板件登记（头部路径，行为与旧 renderHeadIR 逐像素一致）。
export interface NodeReg {
  tint: number;
  lines?: number[];
  seam?: number;
  ridge?: { edge: [Pt, Pt]; tone: number; faceW: number; faceTone: number; faceDx?: number; faceDy?: number };
  boltsAt?: Pt[];
}
export type PartNode =
  | { t: 'block'; dx: number; dy: number; w: number; h: number; ang?: number; kind?: Kind; cham?: number; bolts?: boolean; role?: string; glowSeat?: boolean; inset?: { fw: number; fh: number }; reg?: NodeReg; instKind?: Kind }
  | { t: 'disc'; dx: number; dy: number; r: number; kind?: Kind }
  | { t: 'grille'; dx: number; dy: number; w: number; h: number; bars?: { groups: number[]; gap: number; role?: string } }
  | { t: 'poly'; pts: [number, number][]; bolts?: boolean; role?: string; tint?: number; reg?: NodeReg; instKind?: Kind; raw?: boolean }
  | { t: 'wing'; dx: number; dy: number; len: number; wRoot: number; wTip: number; ang: number; role?: string }
  | { t: 'stripe'; pts: [number, number][]; ws: number[]; hosts: PartNode[] }
  | { t: 'light'; dx: number; dy: number; s?: number };
export interface PartEnv {
  origin: Pt; tilt: number; seed: number; blockShape?: BlockShapeParams;
  intakeDepth?: [number, number]; intakeShare?: [number, number];
  grilleTone?: number; grilleTilt?: number;
  /** 随机面板线档：false = 板件不登记随机面板线/斜线/T 接头（头部用——线只能来自构造步） */
  panelLines?: boolean;
  /** 紧调档：true = 板调只抽窄三档（头部用——头盔是单壳，相邻壳板不许满档色差） */
  tightTint?: boolean;
  toeFace?: { x0: number; y0: number; x1: number; y1: number };
}
export function renderPartNodes(cv: MechaCanvas, nodes: PartNode[], env: PartEnv): Anchors {
  const T = makeLayerTools(cv, env.seed, env.blockShape, { panelLines: env.panelLines, tightTint: env.tightTint });
  const { A } = T, s = env.origin, ca = Math.cos(env.tilt), sa = Math.sin(env.tilt);
  const P = (dx: number, dy: number): Pt => ({ x: s.x + dx * ca - dy * sa, y: s.y + dx * sa + dy * ca });
  const applyReg = (id: number, pts: Pt[], reg: NodeReg) => {
    A.plateTint.set(id, reg.tint);
    if (reg.lines) { A.panelLines.set(id, reg.lines); for (const lv of reg.lines) polyLip(A, id, pts, lv); }
    if (reg.seam !== undefined) { A.seamU.set(id, reg.seam); polySeamLip(A, id, pts, reg.seam); }
    if (reg.ridge) { const e = reg.ridge; regThickness(A, id, [P(e.edge[0].x, e.edge[0].y), P(e.edge[1].x, e.edge[1].y)], e.tone, { faceW: e.faceW, faceTone: e.faceTone, faceDx: e.faceDx, faceDy: e.faceDy }); (A.ridgeMode ??= new Set()).add(id); }
    if (reg.boltsAt) for (const b of reg.boltsAt) A.boltPts.push(P(b.x, b.y));
  };
  // 发光组合登记：标了 glowSeat 的块是暗座，其后紧跟的 light 点是
  // 它的亮芯（座先画、芯登记、眉檐块随后压住座上沿——组合三件）
  let curGlow: { cx: number; cy: number; hw: number; hh: number; cos: number; sin: number; pts: (Pt & { s?: number })[] } | null = null;
  const nodeIds = new Map<PartNode, number[]>(); // 节点 → 其 inst id 列（漆带节点的承载宿主按对象身份查）
  for (const p of nodes) {
    if (p.t !== 'light' && p.t !== 'block') curGlow = null; // 亮芯只认紧跟暗座的一串 light
    if (p.t === 'block') {
      const c = P(p.dx, p.dy);
      if (p.reg) { const bp = blockPoly(c.x, c.y, p.w, p.h, env.tilt + (p.ang ?? 0), p.cham ?? 0.38); const id = T.addRaw(p.instKind ?? 'foot', polyTest(bp)); nodeIds.set(p, [id]); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); applyReg(id, bp, p.reg); }
      else { const id = T.addBlock(p.kind ?? 'plate', c.x, c.y, p.w, p.h, env.tilt + (p.ang ?? 0), p.cham ?? 0.36, p.bolts ?? false); nodeIds.set(p, [id]); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); if (p.inset) regInsetFrame(A, id, c.x, c.y, p.w * p.inset.fw, p.h * p.inset.fh, env.tilt + (p.ang ?? 0)); if (p.glowSeat) { const rot = env.tilt + (p.ang ?? 0); curGlow = { cx: c.x, cy: c.y, hw: p.w / 2, hh: p.h / 2, cos: Math.cos(rot), sin: Math.sin(rot), pts: [] }; (A.glows ??= []).push(curGlow); } else curGlow = null; if (p.faceW) { const rot = env.tilt + (p.ang ?? 0), ca = Math.cos(rot), sa = Math.sin(rot), ins = (p.w * (p.cham ?? 0.36)) / 2; regThickness(A, id, [{ x: c.x + (-p.w / 2 + ins) * ca - p.h / 2 * sa, y: c.y + (-p.w / 2 + ins) * sa + p.h / 2 * ca }, { x: c.x + (p.w / 2 - ins) * ca - p.h / 2 * sa, y: c.y + (p.w / 2 - ins) * sa + p.h / 2 * ca }], 1.0, { faceW: p.faceW, faceDx: sa, faceDy: -ca, faceTone: 0.92 }); } }
    }
    else if (p.t === 'disc') { const c = P(p.dx, p.dy); const id = T.addDisc(p.kind ?? 'disc', c, p.r); nodeIds.set(p, [id]); }
    else if (p.t === 'grille') { const c = P(p.dx, p.dy); if (p.bars) { // 条组式（栅算子第二式）：无框横片成组——片位/片厚由总高、总片数与组距算出（敏捷颊侧栅柱的真身；此前是侧件分支里手排的六块、没走栅算子）
        const bars = p.bars, total = bars.groups.reduce((a2, b2) => a2 + b2, 0), pitch = (p.h - (bars.groups.length - 1) * bars.gap) / total;
        let yy = c.y - p.h / 2; const barIds: number[] = [];
        bars.groups.forEach((n) => { for (let k = 0; k < n; k++) { const id = T.addBlock('plate', c.x, yy + pitch / 2, p.w, pitch * 0.62, env.tilt); barIds.push(id); (A.colorRole ??= new Map()).set(id, bars.role ?? 'armor2'); yy += pitch; } yy += bars.gap; });
        nodeIds.set(p, barIds);
      } else T.grille(c.x, c.y, p.w, p.h, env.intakeDepth, env.grilleTone ?? 1, env.grilleTilt ?? 0, env.intakeShare); }
    else if (p.t === 'poly') {
      const pts = p.pts.map(([dx, dy]) => P(dx, dy));
      if (p.reg || p.raw) { const id = T.addRaw(p.instKind ?? 'foot', polyTest(pts)); nodeIds.set(p, [id]); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); if (p.reg) applyReg(id, pts, p.reg); }
      else { const id = T.addPoly(pts, p.bolts ?? false); nodeIds.set(p, [id]); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); if (p.tint !== undefined) A.plateTint.set(id, p.tint); }
    }
    else if (p.t === 'wing') { const root = P(p.dx, p.dy); const a = env.tilt + p.ang; const cx = root.x + Math.cos(a) * p.len / 2, cy = root.y + Math.sin(a) * p.len / 2; const id = T.wing(cx, cy, p.len, p.wRoot, p.wTip, a, WING_CUT); nodeIds.set(p, [id]); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); }
    else if (p.t === 'stripe') { // 漆带节点：不自成 inst——把路径逐段登记给漆带阶段，承载 = 宿主列的 inst（漆继承承载面明暗）
      const ids = new Set<number>();
      for (const hn of p.hosts) for (const id of nodeIds.get(hn) ?? []) ids.add(id);
      for (let i = 0; i + 1 < p.pts.length; i++) A.stripeSegs.push({ p1: P(p.pts[i][0], p.pts[i][1]), p2: P(p.pts[i + 1][0], p.pts[i + 1][1]), w: (p.ws[i] + p.ws[i + 1]) / 2, ids });
    }
    else if (p.t === 'light') { const c = P(p.dx, p.dy); if (curGlow) curGlow.pts.push({ ...c, s: p.s }); else A.lightPts.push(c); }
  }
  if (env.toeFace) { const f = env.toeFace, a = P(f.x0, f.y0), b = P(f.x1, f.y1); A.toeFace = { x0: Math.round(Math.min(a.x, b.x)), y0: Math.round(Math.min(a.y, b.y)), x1: Math.round(Math.max(a.x, b.x)), y1: Math.round(Math.max(a.y, b.y)) }; }
  T.finish();
  return A;
}
function renderHeadIR(cv: MechaCanvas, ir: HeadIR, spec: HeadSpec): Anchors {
  // 头部 = 节点列 + 头锚点环境，解释走通用装配器（耳侧口：正对面
  // 本调 1.0、框斜 0.1，是环境数据不是装配器判断）
  return renderPartNodes(cv, ir.parts as PartNode[], { origin: ir.anchors.seat, tilt: spec.tilt, seed: spec.seed, blockShape: spec.blockShape, intakeDepth: spec.intakeDepth, intakeShare: spec.intakeShare, grilleTone: 1, grilleTilt: 0.1, panelLines: false, tightTint: true });
}
// ---------- 足部节点列（足的 DAG）：layout 足部构造的节点化 ----------
// 局部框：踝 (0,0)、趾尖 +100、地面 +50（生产画布 GY 470 − 踝
// 420）。几何与登记逐项对应 layout 的 claw/pad/shoe/blocks 四式；
// wheel 的胎环扇区测试不在节点词表内，返回 null（仍走 layout）。
export function footNodes(footType: LegSpec['footType'], opts?: { wScale?: number; thickRatio?: number; seed?: number }): { nodes: PartNode[]; toeFace?: { x0: number; y0: number; x1: number; y1: number } } | null {
  const ft = footType ?? 'blocks';
  if (ft === 'wheel') return null;
  const rnd = mulberry32(opts?.seed ?? 7);
  const pick = () => [0.9, 1.0, 1.08][Math.floor(rnd() * 3)];
  const nodes: PartNode[] = [];
  const footBlock = (cx: number, cy: number, w: number, h: number, ang: number, cham = 0.38, seam?: number, role?: string) => {
    nodes.push({ t: 'block', dx: cx, dy: cy, w, h, ang, cham, role, instKind: 'foot', reg: { tint: pick(), lines: [0.5], seam } });
  };
  const polyPts = (pts: Pt[]): [number, number][] => pts.map((p) => [p.x, p.y] as [number, number]);
  if (ft === 'claw') {
    footBlock(0, 26, 46, 24, 0.05);
    footBlock(30, 32, 52, 19, 0.4);
    footBlock(68, 43, 46, 14, 0.06, 0.5);
    footBlock(-29, 32, 46, 18, -0.4);
    footBlock(-60, 43, 40, 13, -0.06, 0.5);
    return { nodes };
  }
  if (ft === 'pad') {
    footBlock(54, 40, 162, 20, 0.01, 0.3);
    footBlock(92, 29, 56, 23, 0.02, 0.45);
    footBlock(-20, 35, 44, 16, 0.03);
    return { nodes };
  }
  if (ft === 'shoe') {
    nodes.push({ t: 'poly', pts: polyPts(blockPoly(38, 7, 96, 30, 0.12, 0.35)), instKind: 'plate', reg: { tint: 0.95, lines: [0.5] } }); // 踝上整流罩（靴筒块）
    nodes.push({ t: 'poly', pts: polyPts(blockPoly(51, 46, 170, 12, 0, 0.3)), instKind: 'frame', raw: true }); // 足底件（无登记，layout 原样）
    footBlock(-24, 35, 64, 34, 0.04, 0.38, undefined, 'armor'); // 跟块
    footBlock(34, 37, 96, 26, -0.045, 0.3, undefined, 'armor'); // 鞋身块
    footBlock(118, 42, 36, 16, 0.01, 0.55, 0.55, 'accent'); // 趾帽块（竖缝 0.55）
    return { nodes };
  }
  // blocks（主战/重型）：跟块 + 两级叠瓦楔板 + 压块总成 + 三趾
  const D = 50, GY = 50;
  const heavy = (opts?.wScale ?? 1) >= 1.3;
  const HS = heavy ? 1.12 : 1;
  const LINE_ANG = -0.40;
  const dir = { x: Math.cos(LINE_ANG), y: Math.sin(LINE_ANG) };
  const nrm = { x: -dir.y, y: dir.x };
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
  const blkP = (cx: number, cy: number, len: number, thick: number, ang: number, cuts: { ft?: number; fb?: number; bt?: number; bb?: number }, tint: number, panel = true, boltsAt?: Pt[]) => {
    nodes.push({ t: 'poly', pts: polyPts(jagPoly(cx, cy, len, thick, ang, cuts)), instKind: 'plate', reg: { tint, lines: panel ? [0.5] : undefined, boltsAt } });
  };
  const toeG = (x0: number, len: number, thick: number, tint: number) => {
    const ch = thick * 0.18, rc = thick * 0.12, fi = thick * 0.08;
    const tp = [
      { x: x0 + rc * 0.4, y: GY }, { x: x0 + len - fi, y: GY },
      { x: x0 + len, y: GY - thick + ch }, { x: x0 + len - ch, y: GY - thick },
      { x: x0 + rc, y: GY - thick }, { x: x0, y: GY - thick + rc },
    ];
    nodes.push({ t: 'poly', pts: polyPts(tp), instKind: 'foot', reg: { tint, lines: [0.5] } });
  };
  // 叠瓦楔板：前板先画、后板尖压前板根；顶边登记高光棱亮面
  nodes.push({ t: 'poly', pts: [[92, -17], [134, 8], [140, 22], [84, 15]], instKind: 'foot', reg: { tint: 1.05, ridge: { edge: [{ x: 92, y: -17 }, { x: 134, y: 8 }], tone: 1.35, faceW: 10, faceTone: 1.22 } } });
  nodes.push({ t: 'poly', pts: [[48, -36], [114, 2], [105, 12], [71, 5], [71, 2], [40, 2]], instKind: 'foot', reg: { tint: 0.94, ridge: { edge: [{ x: 48, y: -36 }, { x: 114, y: 2 }], tone: 1.35, faceW: 10, faceTone: 1.22 } } });
  toeG(0.52 * D, 0.98 * D * HS, 0.52 * D, 1.02);
  toeG(1.44 * D, 0.86 * D * HS, 0.46 * D, 0.93);
  const toe3Front = 2.24 * D + 0.80 * D * HS;
  toeG(2.24 * D, 0.80 * D * HS, 0.56 * D, 1.07);
  const toeFace = { x0: Math.round(toe3Front - 0.17 * D), y0: Math.round(GY - 0.34 * D), x1: Math.round(toe3Front - 0.03 * D), y1: Math.round(GY - 0.06 * D) };
  // 跟块（楔块平坐地，顶边陡升段沿主线）+ 面上一颗栓
  const FTp = { x: -0.15 * D, y: 0.1 * D };
  const BK = { x: FTp.x - dir.x * 0.42 * D, y: FTp.y - dir.y * 0.42 * D };
  const RT = { x: BK.x - 0.95 * D * HS, y: BK.y + 0.10 * D };
  nodes.push({ t: 'poly', pts: polyPts([
    { x: FTp.x - 6, y: FTp.y + 9 }, { x: FTp.x + 2, y: FTp.y }, { x: BK.x + 3, y: BK.y - 2 },
    { x: RT.x + 8, y: RT.y + 2 }, { x: RT.x, y: RT.y + 6 }, { x: RT.x - 7, y: GY },
    { x: -0.05 * D, y: GY }, { x: FTp.x - 3, y: FTp.y + 17 },
  ]), instKind: 'foot', reg: { tint: 0.95, boltsAt: [{ x: (BK.x + RT.x) / 2, y: (BK.y + RT.y) / 2 + 12 }] } });
  // 压块总成：套环（主线在盘对面的落点）+ 压块（前端料厚走高光棱）
  const scx = dir.x * 0.62 * D, scy = dir.y * 0.62 * D;
  blkP(scx, scy, 0.95 * D * HS, 0.58 * D, LINE_ANG, { bt: 0.25, bb: 0.35, fb: 0.20 }, 1.02, true, [{ x: scx, y: scy }]);
  const slabLen = 1.45 * D * HS, slabThick = 0.8 * D, slabRear = 0.98 * D;
  const mx = dir.x * (slabRear + slabLen / 2), my = dir.y * (slabRear + slabLen / 2);
  const slabCx = mx + nrm.x * slabThick / 2, slabCy = my + nrm.y * slabThick / 2;
  blkP(slabCx, slabCy, slabLen, slabThick, LINE_ANG, { bb: 0.30, ft: 0.30, fb: 0.15 }, 0.95, false,
    [{ x: mx - dir.x * slabLen * 0.14 + nrm.x * slabThick * 0.68, y: my - dir.y * slabLen * 0.14 + nrm.y * slabThick * 0.68 }]);
  const slabNode = nodes[nodes.length - 1];
  if (slabNode.t === 'poly' && slabNode.reg) {
    const hl = slabLen / 2, ht = slabThick / 2, cA = Math.cos(LINE_ANG), sA = Math.sin(LINE_ANG);
    const rot = (lx: number, ly: number): Pt => ({ x: slabCx + lx * cA - ly * sA, y: slabCy + lx * sA + ly * cA });
    const fT0 = rot(hl, -ht + slabThick * 0.30 * 0.75), fB0 = rot(hl - slabThick * 0.15, ht);
    const w = slabThick * (opts?.thickRatio ?? 0.32);
    const rA = { x: fT0.x + (fB0.x - fT0.x) * 0.06 - dir.x * w, y: fT0.y + (fB0.y - fT0.y) * 0.06 - dir.y * w };
    const rB = { x: fT0.x + (fB0.x - fT0.x) * 0.94 - dir.x * w, y: fT0.y + (fB0.y - fT0.y) * 0.94 - dir.y * w };
    slabNode.reg.ridge = { edge: [rA, rB], tone: 1.30, faceW: w, faceTone: 0.95, faceDx: dir.x, faceDy: dir.y };
  }
  return { nodes, toeFace };
}
export { SCHEMES, newCanvas, layout, finishRender, legIR, renderIR, makeLayerTools, armIR, renderArmIR, torsoIR, renderTorsoIR, hullIR, renderHullIR, headIR, renderHeadIR };
export type { Scheme, LegSpec, ArmSpec, TorsoSpec, HullSpec, HeadSpec, Anchors, Pt, MechaCanvas, PartNode, NodeReg, PartEnv, ArmPart };
export { W as MECHA_W, H as MECHA_H };
