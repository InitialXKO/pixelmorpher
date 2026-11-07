// 机甲腿程序化生成 spike v9：第一层重做（用户判「第一层的轮廓
// 生成器就不合格」）。v8 的剪影是预画的平滑包络（两段 silQuad +
// 三圆 + 脚四边形），部件只写 owner、在包络内填色，包络外一律
// 裁掉——轮廓每侧只是一条光滑曲线。参考的轮廓是部件并集。本轮：
//   剪影 = 包络 ∪ 全部部件（layout 末尾并集），部件可以探出包络
//   每块板独立成廓：种子角度抖动 ±1.4° + 横移 ±2px + 出边 3–8%
//   段包络改台阶剖面：两端向关节盘收腰 13%、中段接缝处 5% 台阶
//   关节盘加大（髋 46/膝 44/踝 31），在收腰处咬出轮廓
// v8 立体感第三轮（沿用）：立体感第三轮——轮廓本身。v7 复看：
// 段的剪影是直线收分的一对平行边，平板再怎么着色也是平板。本轮
// 段横截面改非对称隆起：大腿前侧股肌隆起、小腿后侧腓肠肌隆起，
// plateTest/silQuad 同步（u 按前后侧各自半宽归一，剖面不变形）。
// v7 立体感第二轮（沿用）：立体感第二轮。v6 复看残差：部件仍是
// 贴面平板——缺三样：每件四周的厚度侧壁、件与件之间拉开的明度差、
// 更长的投影尾。本轮：3px 盘缘侧壁带（上沿受光、下沿侧壁压暗、
// 前壁转暗）、板间色差拉大（0.82~1.18）、投影加强并加长尾。
// v6 立体感第一轮（沿用）：立体感专项。v5 的着色是对称中心渐变 +
// 1px 棱线 + 无投影，构造上就是贴纸。本轮换体积着色：
//   非对称形态剖面（前缘高光带/前面/转折/背侧收暗，坡道量化成色带）
//   投影：靠前部件向后下在身后部件上落影（近影 0.72、远影 0.87）
//   斜面带：横向边界上亮唇 2px + 下暗唇、纵向边界前亮后暗
//   圆盘方向体积（光自前上）+ 毂影；活塞/拉杆高光偏前、两缘收暗
//   脚下接地阴影（半透明椭圆，落在剪影外）
// v5 已销账项（沿用）：区别模式迭代第二轮。v4 复测残差：
//   对比度（std 36 vs 参考 49）与深暗部（0.22 vs 0.32）仍差 → 全局调色
//   拉伸（暗更暗、亮更亮）一次解决三项；强调色占比差 → 箭头纹加粗 +
//   大腿加饰带；人形壳子族（白甲）未覆盖 → shellMode 变体（近无缝板 +
//   色块板 + 鞋式单趾 + 光滑柱面）。
// v4 已销账项（沿用）：
//   暗部占比差一倍 → 配色与板面着色整体压暗、缝更深、板缝加宽
//   脚无分趾 → 三趾块脚；面板线只有横向 → 每板加竖向缝
//   盘面无螺栓圈 → 关节盘 8 颗环螺栓；无标志图形 → 种子标志（菱/十字/三角/横杠）
//   锈斑缺 → 磨损斑层（锈色混色，强度按配色）；掉漆只有暗啃 → 亮掉漆点
//   无轻型内框变体 → frameHeavy（板宽 0.7 倍、内框主导，侦察/轨道炮式）
//   无远侧腿 → formation 合成（远侧腿压暗去饱和垫后）
// 运行：bun spikes/mecha-part-patterns/gen-legs-v9.mts
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

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
function crc32(buf: Uint8Array) { let c = -1; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type: string, data: Uint8Array) {
  const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, data.length);
  const td = new Uint8Array(4 + data.length); td.set([...type].map((c) => c.charCodeAt(0))); td.set(data, 4);
  const crc = new Uint8Array(4); new DataView(crc.buffer).setUint32(0, crc32(td));
  return [len, td, crc];
}
function encodePNG(w: number, h: number, rgba: Uint8ClampedArray) {
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 4)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1); }
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  for (const c of chunk('IHDR', ihdr)) parts.push(c);
  for (const c of chunk('IDAT', deflateSync(raw))) parts.push(c);
  for (const c of chunk('IEND', new Uint8Array(0))) parts.push(c);
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

// ---------- 颜色：量化坡道 ----------
type RGB = [number, number, number];
interface Scheme { armor: RGB; armor2: RGB; frame: RGB; metal: RGB; chrome: RGB; accent: RGB; glow: RGB; decal: RGB }
const SCHEMES: Record<string, Scheme> = {
  white:  { armor: [198, 203, 214], armor2: [168, 178, 196], frame: [26, 28, 34], metal: [70, 74, 84], chrome: [205, 212, 224], accent: [64, 110, 224], glow: [150, 200, 255], decal: [42, 50, 66] },
  olive:  { armor: [86, 92, 50], armor2: [69, 76, 40], frame: [35, 37, 32], metal: [80, 82, 84], chrome: [186, 190, 192], accent: [219, 130, 40], glow: [255, 198, 94], decal: [226, 224, 205] },
  desert: { armor: [130, 113, 81], armor2: [111, 95, 66], frame: [50, 44, 36], metal: [86, 84, 80], chrome: [192, 190, 182], accent: [209, 112, 36], glow: [255, 202, 102], decal: [238, 232, 214] },
  slate:  { armor: [75, 83, 95], armor2: [60, 68, 80], frame: [32, 36, 44], metal: [76, 80, 88], chrome: [178, 186, 196], accent: [235, 128, 44], glow: [255, 178, 86], decal: [224, 228, 232] },
  rust:   { armor: [83, 66, 54], armor2: [68, 54, 43], frame: [34, 28, 24], metal: [79, 75, 73], chrome: [176, 172, 166], accent: [223, 124, 38], glow: [255, 190, 98], decal: [230, 222, 204] },
};
// 亮度因子量化到 6 档、暗部略偏冷——像素画的坡道感
function ramp(c: RGB, f: number): RGB {
  const steps = [0.3, 0.45, 0.6, 0.76, 0.9, 1.0, 1.14, 1.3];
  let q = steps[0]; for (const s of steps) if (f >= s - 0.06) q = s;
  const cool = q < 0.8 ? 0.96 : 1;
  return [Math.min(255, c[0] * q * cool), Math.min(255, c[1] * q), Math.min(255, c[2] * q * (q < 0.8 ? 1.05 : 1))];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- 画布与参数图 ----------
const W = 380, H = 540;
type Kind = 'plate' | 'disc' | 'rod' | 'cyl' | 'foot' | 'frame' | 'cable' | 'guard';
interface Inst { kind: Kind }
interface Canvas { col: Uint8ClampedArray; owner: Int16Array; u: Float32Array; v: Float32Array; sil: Uint8Array; insts: Inst[] }
function newCanvas(): Canvas {
  return { col: new Uint8ClampedArray(W * H * 4), owner: new Int16Array(W * H).fill(-1), u: new Float32Array(W * H), v: new Float32Array(W * H), sil: new Uint8Array(W * H), insts: [] };
}
type Pt = { x: number; y: number };
function fillShape(cv: Canvas, id: number, test: (x: number, y: number) => [boolean, number, number]) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [hit, u, v] = test(x + 0.5, y + 0.5);
    if (hit) { const i = y * W + x; cv.owner[i] = id; cv.u[i] = u; cv.v[i] = v; }
  }
}
function markSil(cv: Canvas, test: (x: number, y: number) => boolean) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (test(x + 0.5, y + 0.5)) cv.sil[y * W + x] = 1;
}
function segFrame(a: Pt, b: Pt) { const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy); return { ux: dx / len, uy: dy / len, px: -dy / len, py: dx / len, len }; }
// 段板：t0..t1 区间 + 缝 + 两端斜切（cutA/cutB 为端部削角量，单位 px 沿横向）
interface Bulge { f: number; b: number } // 前/后隆起幅度（d<0 为前侧）
const bumpAt = (t: number, c: number) => Math.exp(-(((t - c) / 0.3) ** 2));
function plateTest(a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap: number, cutA: number, cutB: number, bulge: Bulge = { f: 0, b: 0 }) {
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
    const hit = d < 0 ? -d <= limF : d <= limB;
    return [hit, d < 0 ? d / hwF : d / hwB, local];
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
function polyTest(pts: Pt[]) { // 多边形（护板/趾块）：局部坐标取包围盒
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return (x: number, y: number): [boolean, number, number] => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return [inside, ((x - x0) / (x1 - x0)) * 2 - 1, (y - y0) / (y1 - y0)];
  };
}
function discTest(c: Pt, r: number) {
  return (x: number, y: number): [boolean, number, number] => {
    const d = Math.hypot(x - c.x, y - c.y);
    return [d <= r, (x - c.x) / r, d / r];
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
interface LegSpec { topology: 'standard' | 'reverse'; scheme: Scheme; seed: number; bend: number; camo: boolean; wear?: number; frameHeavy?: boolean; shellMode?: boolean }
interface Anchors {
  plateTint: Map<number, number>; panelLines: Map<number, number[]>;
  boltPts: Pt[]; ventId: number; guardId: number; stripeId: number;
  decalPos: Pt; numPos: Pt; numText: string; lightPts: Pt[];
  discs: { id: number; c: Pt; r: number }[];
  chevrons: [Pt, Pt][];
  seamU: Map<number, number>; insignia: { pos: Pt; kind: number };
  stripeThigh: number; blockPlates: Set<number>;
}
function layout(cv: Canvas, spec: LegSpec): Anchors {
  const rnd = mulberry32(spec.seed);
  const std = spec.topology === 'standard';
  const hip: Pt = { x: 170, y: 44 };
  const knee: Pt = std ? { x: 236 + spec.bend, y: 248 } : { x: 112 + spec.bend, y: 244 };
  const ankle: Pt = { x: 178, y: 434 };
  const toeX = 278;
  const thigh = { a: hip, b: knee, wA: 110, wB: 84, bulge: { f: 0.16, b: 0.05 } };
  const shin = { a: knee, b: ankle, wA: 94, wB: 64, bulge: { f: 0.05, b: 0.2 } };
  // 剪影
  const segProf = (t: number) => (1 - 0.13 * Math.exp(-((t / 0.09) ** 2)) - 0.13 * Math.exp(-(((1 - t) / 0.09) ** 2))) * (t > 0.52 ? 0.95 : 1);
  for (const s of [thigh, shin]) markSil(cv, silQuad(s.a, s.b, s.wA, s.wB, 2, s.bulge, segProf));
  for (const [j, r] of [[hip, 46], [knee, 44], [ankle, 31]] as [Pt, number][]) markSil(cv, (x, y) => Math.hypot(x - j.x, y - j.y) <= r);
  markSil(cv, silQuad({ x: ankle.x - 8, y: 446 }, { x: toeX, y: 456 }, 44, 34, 2));
  let id = 0;
  const A: Anchors = { plateTint: new Map(), panelLines: new Map(), boltPts: [], ventId: -1, guardId: -1, stripeId: -1, decalPos: { x: 0, y: 0 }, numPos: { x: 0, y: 0 }, numText: '', lightPts: [], discs: [], chevrons: [], seamU: new Map(), insignia: { pos: { x: 0, y: 0 }, kind: 0 }, stripeThigh: -1, blockPlates: new Set() };
  const addPlate = (a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap: number, cutA: number, cutB: number, kind: Kind = 'plate', bulge: Bulge = { f: 0, b: 0 }) => {
    cv.insts.push({ kind }); const myId = id;
    // 独立成廓：每块板绕自身中心微转 + 横移 + 出边，轮廓在接缝处出天然台阶
    const js = (spec.shellMode ? 0.4 : 1) * (kind === 'foot' ? 0.5 : 1);
    const jit = (rnd() - 0.5) * 4 * js, rot = (rnd() - 0.5) * 0.05 * js, proud = 1 + (0.03 + rnd() * 0.05) * js;
    const f0 = segFrame(a, b), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const rotPt = (p: Pt): Pt => {
      const dx = p.x - mx, dy = p.y - my;
      return { x: mx + dx * Math.cos(rot) - dy * Math.sin(rot) + f0.px * jit, y: my + dx * Math.sin(rot) + dy * Math.cos(rot) + f0.py * jit };
    };
    const a2 = rotPt(a), b2 = rotPt(b);
    fillShape(cv, id, plateTest(a2, b2, wA * proud, wB * proud, t0, t1, gap, cutA, cutB, bulge)); id++;
    A.plateTint.set(myId, [0.82, 0.94, 1.06, 1.18][Math.floor(rnd() * 4)]);
    const lines: number[] = []; const n = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) lines.push(0.3 + rnd() * 0.45);
    A.panelLines.set(myId, lines);
    A.seamU.set(myId, -0.42 + rnd() * 0.84); // 竖向面板缝位置
    if ((spec as LegSpec).shellMode && rnd() < 0.45) A.blockPlates.add(myId); // 人形壳：色块板
    // 铆钉点：沿板两侧缘（跟随抖动后的板框）
    const f = segFrame(a2, b2);
    for (const vv of [0.14, 0.5, 0.86]) for (const ss of [-0.8, 0.8]) {
      const t = t0 + (t1 - t0) * vv, hw = ((wA + (wB - wA) * t) / 2) * proud;
      A.boltPts.push({ x: a2.x + f.ux * f.len * t + f.px * hw * ss, y: a2.y + f.uy * f.len * t + f.py * hw * ss });
    }
    return myId;
  };
  // 1) 内框杆（垫底）：沿轴窄带 + 关节间连接杆
  cv.insts.push({ kind: 'frame' }); fillShape(cv, id, lineTest({ x: hip.x, y: hip.y - 6 }, { x: ankle.x, y: ankle.y + 8 }, spec.frameHeavy ? 30 : 22)); id++;
  // 2) 线缆：髋后 → 膝后 → 踝后两段贝塞尔（采样点盖章）
  const backOf = (s: { a: Pt; b: Pt }, t: number, off: number): Pt => {
    const f = segFrame(s.a, s.b);
    const sgn = std ? 1 : -1;
    return { x: s.a.x + f.ux * f.len * t + f.px * off * sgn, y: s.a.y + f.uy * f.len * t + f.py * off * sgn };
  };
  const cablePts: Pt[] = [];
  for (let k = 0; k <= 22; k++) cablePts.push(bezier(backOf(thigh, 0.06, 40), backOf(thigh, 0.5, 52), backOf(thigh, 0.97, 36), k / 22));
  for (let k = 0; k <= 22; k++) cablePts.push(bezier(backOf(shin, 0.04, 34), backOf(shin, 0.5, 46), backOf(shin, 0.96, 28), k / 22));
  cv.insts.push({ kind: 'cable' });
  fillShape(cv, id, (x, y) => { let m = 1e9; for (const p of cablePts) m = Math.min(m, Math.hypot(x - p.x, y - p.y)); return [m <= 5.5, 0, m / 5.5]; }); id++;
  // 3) 大腿板 ×2（下板搭接上板）；frameHeavy 时板变窄、缝变宽，内框主导
  const fw = spec.frameHeavy ? 0.68 : 1;
  const fg = spec.shellMode ? 1.4 : spec.frameHeavy ? 8.5 : 5;
  A.stripeThigh = addPlate(thigh.a, thigh.b, thigh.wA * fw, thigh.wB * fw, 0.03, 0.52, fg, 6, 16, 'plate', thigh.bulge);
  const thighB = addPlate(thigh.a, thigh.b, thigh.wA * fw, thigh.wB * fw, 0.47, 0.985, fg, 12, 8, 'plate', thigh.bulge);
  A.ventId = thighB;
  // 4) 小腿板 ×2（同上搭接）
  addPlate(shin.a, shin.b, shin.wA * fw, shin.wB * fw, 0.03, 0.54, fg, 8, 14, 'plate', shin.bulge);
  addPlate(shin.a, shin.b, shin.wA * fw, shin.wB * fw, 0.49, 0.985, fg, 10, 6, 'plate', shin.bulge);
  // 5) 脚：跟块 + 掌 + 趾
  addPlate({ x: ankle.x - 42, y: 442 }, { x: ankle.x - 6, y: 448 }, 38, 34, 0, 1, 1.2, 4, 2, 'foot');
  addPlate({ x: ankle.x - 8, y: 446 }, { x: toeX - 26, y: 454 }, 42, 34, 0, 1, 1.2, 2, 6, 'foot');
  // 三趾块（参考通例：脚趾分节、阶梯错开）；人形壳为鞋式单趾
  if (spec.shellMode) {
    addPlate({ x: toeX - 30, y: 451 }, { x: toeX + 24, y: 457 }, 34, 15, 0, 1, 1, 6, 12, 'foot');
  } else {
    for (let k = 0; k < 3; k++) {
      addPlate({ x: toeX - 30 + k * 14, y: 451 + k * 2.5 }, { x: toeX + 4 + k * 12, y: 456 + k * 2.5 }, 31 - k * 5, 16 - k * 3, 0, 1, 1.4, 2, 9, 'foot');
    }
  }
  // 6) 前护板（多边形盾形，压在小腿前方）：坐标 = (沿轴 t, 离轴距离 off)
  {
    const f = segFrame(shin.a, shin.b);
    const sgn = std ? -1 : 1; // front = -perp（标准型）
    const hwAt = (t: number) => ((shin.wA + (shin.wB - shin.wA) * t) / 2) * (1 + shin.bulge.f * bumpAt(t, 0.38)) * (spec.frameHeavy ? 0.8 : 1);
    const C = (t: number, off: number): Pt => ({
      x: shin.a.x + f.ux * f.len * t + f.px * sgn * off,
      y: shin.a.y + f.uy * f.len * t + f.py * sgn * off,
    });
    const pts = [
      C(0.02, hwAt(0.02) * 0.34), C(0.03, hwAt(0.03) * 1.02), C(0.16, hwAt(0.16) * 1.2),
      C(0.42, hwAt(0.42) * 1.14), C(0.7, hwAt(0.7) * 0.88), C(0.9, hwAt(0.9) * 0.55),
      C(0.99, hwAt(0.99) * 0.3), C(0.86, hwAt(0.86) * 0.22), C(0.5, hwAt(0.5) * 0.2), C(0.12, hwAt(0.12) * 0.22),
    ];
    cv.insts.push({ kind: 'guard' }); A.guardId = id; A.stripeId = id;
    fillShape(cv, id, polyTest(pts)); id++;
    A.plateTint.set(A.guardId, 1.05);
    A.panelLines.set(A.guardId, [0.52, 0.79]);
    A.decalPos = C(0.8, hwAt(0.8) * 0.44);
    A.boltPts.push(C(0.12, hwAt(0.12) * 0.72), C(0.85, hwAt(0.85) * 0.42));
    // 双 V 箭头纹的线段（按护板自身坐标系 (t, off) 定义，渲染时按距离盖章）
    for (const t0 of [0.24, 0.43]) {
      const apex = C(t0 + 0.1, hwAt(t0 + 0.1) * 1.02);
      A.chevrons.push([C(t0, hwAt(t0) * 0.3), apex], [apex, C(t0 + 0.2, hwAt(t0 + 0.2) * 0.3)]);
    }
  }
  // 6.5) 膝盖帽 + 杂物小盒（参考图的构件密度主要来自这类小件）
  {
    const f = segFrame(shin.a, shin.b); const sgn = std ? -1 : 1;
    const C = (along: number, off: number): Pt => ({
      x: knee.x + f.ux * along + f.px * sgn * off, y: knee.y + f.uy * along + f.py * sgn * off,
    });
    const cap = [C(-34, 22), C(-30, 44), C(2, 50), C(26, 40), C(24, 20)];
    cv.insts.push({ kind: 'plate' }); const capId = id;
    fillShape(cv, id, polyTest(cap)); id++;
    A.plateTint.set(capId, 1.06); A.panelLines.set(capId, [0.55]);
    // 大腿前小盒 + 小腿后挂盒
    const box = (cx: number, cy: number, w: number, h: number) => {
      cv.insts.push({ kind: 'plate' }); const bid = id;
      fillShape(cv, id, polyTest([{ x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 }])); id++;
      A.plateTint.set(bid, 0.94); A.panelLines.set(bid, []);
    };
    const tf = segFrame(thigh.a, thigh.b); const tsgn = std ? -1 : 1;
    box(thigh.a.x + tf.ux * tf.len * 0.3 + tf.px * tsgn * 44, thigh.a.y + tf.uy * tf.len * 0.3 + tf.py * tsgn * 44, 26, 34);
    box(shin.a.x + f.ux * f.len * 0.62 - f.px * sgn * 40, shin.a.y + f.uy * f.len * 0.62 - f.py * sgn * 40, 20, 28);
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
    // 小腿背导轨
    cv.insts.push({ kind: 'plate' }); const railId = id;
    fillShape(cv, id, lineTest(backOf(shin, 0.14, 41), backOf(shin, 0.88, 35), 4.5)); id++;
    A.plateTint.set(railId, 0.95); A.panelLines.set(railId, []);
    // 小腿排气管 ×3（膝后向上短管）
    for (let k = 0; k < 3; k++) {
      const base = backOf(shin, 0.1 + k * 0.055, 33);
      cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, lineTest(base, { x: base.x - 3, y: base.y - 32 }, 4.2)); id++;
    }
    // 踝前护板
    cv.insts.push({ kind: 'plate' }); const agId = id;
    fillShape(cv, id, polyTest([{ x: ankle.x + 16, y: 402 }, { x: ankle.x + 36, y: 412 }, { x: ankle.x + 37, y: 442 }, { x: ankle.x + 25, y: 458 }, { x: ankle.x + 13, y: 434 }])); id++;
    A.plateTint.set(agId, 1.0); A.panelLines.set(agId, [0.5]);
    // 提手：大腿下板正面 Π 形（两脚 + 横杆，金属色）
    const hf = segFrame(thigh.a, thigh.b); const hsgn = std ? -1 : 1;
    const H = (t: number, off: number): Pt => ({ x: thigh.a.x + hf.ux * hf.len * t + hf.px * hsgn * off, y: thigh.a.y + hf.uy * hf.len * t + hf.py * hsgn * off });
    const h1 = H(0.66, 47), h2 = H(0.8, 47), h1b = H(0.66, 38), h2b = H(0.8, 38);
    cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, lineTest(h1b, h1, 3)); id++;
    cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, lineTest(h2b, h2, 3)); id++;
    cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, lineTest(h1, h2, 3.4)); id++;
  }
  // 7) 活塞：大腿后侧、 小腿前侧（反关节互换）
  const piston = (a: Pt, b: Pt, rC = 10, rR = 5.5) => {
    const mid = { x: a.x + (b.x - a.x) * 0.5, y: a.y + (b.y - a.y) * 0.5 };
    cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, lineTest(a, mid, rC)); id++;
    cv.insts.push({ kind: 'rod' }); fillShape(cv, id, lineTest(mid, b, rR)); id++;
    for (const e of [a, b]) { cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, discTest(e, rC * 0.9)); id++; }
  };
  piston(backOf(thigh, 0.14, 44), backOf(thigh, 0.88, 40));
  piston(backOf(thigh, 0.24, 26), backOf(thigh, 0.62, 24), 6, 3.2); // 副油缸（贴板面、更细更短）
  {
    const f = segFrame(shin.a, shin.b); const sgn = std ? -1 : 1;
    const F = (t: number, off: number): Pt => ({ x: shin.a.x + f.ux * f.len * t + f.px * sgn * off, y: shin.a.y + f.uy * f.len * t + f.py * sgn * off });
    piston(F(0.12, 13), F(0.86, 10), 8, 4.2); // 贴护板内缘走线，不抢护板正面
  }
  // 8) 关节盘
  for (const [j, r] of [[hip, 45], [knee, 43], [ankle, 30]] as [Pt, number][]) {
    cv.insts.push({ kind: 'disc' }); fillShape(cv, id, discTest(j, r)); A.discs.push({ id, c: j, r }); id++;
  }
  // 贴纸编号锚点（大腿下板前缘）与信号灯
  {
    const f = segFrame(thigh.a, thigh.b); const sgn = std ? -1 : 1;
    A.numPos = { x: thigh.a.x + f.ux * f.len * 0.68 + f.px * sgn * 16, y: thigh.a.y + f.uy * f.len * 0.68 + f.py * sgn * 16 };
    A.numText = 'M-' + (10 + Math.floor(rnd() * 89));
    A.insignia = { pos: { x: A.numPos.x + 4, y: A.numPos.y - 34 }, kind: Math.floor(rnd() * 4) };
    A.lightPts = [{ x: knee.x + (std ? 26 : -26), y: knee.y - 30 }, { x: hip.x - 30, y: hip.y + 34 }];
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

// ---------- 渲染 ----------
function render(spec: LegSpec) {
  const cv = newCanvas();
  const A = layout(cv, spec);
  const S = spec.scheme;
  const rnd = mulberry32(spec.seed + 99);
  const set = (i: number, c: RGB) => { cv.col[i * 4] = c[0]; cv.col[i * 4 + 1] = c[1]; cv.col[i * 4 + 2] = c[2]; cv.col[i * 4 + 3] = 255; };
  const get = (i: number): RGB => [cv.col[i * 4], cv.col[i * 4 + 1], cv.col[i * 4 + 2]];
  // 基色 + 场着色（量化坡道）
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!cv.sil[i]) continue;
    const o = cv.owner[i], inst = o >= 0 ? cv.insts[o] : null;
    const u = cv.u[i], v = cv.v[i];
    if (!inst) { set(i, ramp(S.frame, 0.42 + 0.16 * vnoise(x / 7, y / 7, spec.seed))); continue; }
    const mottle = 0.94 + 0.11 * vnoise(x / 8, y / 8, spec.seed + 1);
    if (inst.kind === 'frame') set(i, ramp(S.frame, 0.62 * mottle));
    else if (inst.kind === 'cable') set(i, ramp(S.frame, (1.05 - 0.5 * v) * mottle));
    else if (inst.kind === 'plate' || inst.kind === 'guard' || inst.kind === 'foot') {
      const tint = A.plateTint.get(o) ?? 1;
      const uu = inst.kind === 'guard' ? -u : u; // 多边形护板的 u 是包围盒坐标，方向与段板相反
      const prof = formProfile(uu);
      let f = (spec.shellMode ? 1 + (prof - 1) * 0.72 : prof) * (1.05 - 0.22 * v) * tint * mottle;
      if (v < 0.04) f *= 1.1; else if (v > 0.96) f *= 0.84; // 板端面：上端受光、下端收暗
      f = quant(f);
      let base = o % 2 ? S.armor : S.armor2;
      if (A.blockPlates.has(o)) base = mix(base, S.accent, 0.38);
      // 大腿饰带：首板下缘双条强调色带
      if (o === A.stripeThigh && ((v > 0.8 && v < 0.845) || (v > 0.875 && v < 0.92))) { set(i, ramp(S.accent, 0.98)); continue; }
      if (inst.kind === 'foot') { base = S.armor2; f *= 0.85; }
      if (inst.kind === 'guard') { base = S.armor; f *= 1.04; } // 护板与段板分面（体积靠剖面本身）
      if (spec.camo && vnoise(x / 30, y / 30, spec.seed + 3) > 0.6) base = mix(base, shade2(S.armor2, 0.82), 0.55);
      let c = ramp(base, f);
      // 面板线（横向 + 竖向缝，成网）
      for (const lv of A.panelLines.get(o) ?? []) if (Math.abs(v - lv) < 0.011) c = ramp(base, f * 0.6);
      const su = A.seamU.get(o);
      if (su !== undefined && Math.abs(u - su) < 0.02 && v > 0.12 && v < 0.88) c = ramp(base, f * 0.6);
      // 警示纹在细节段按线段距离盖章（见下方 chevrons），此处不处理
      // 鞋底纹：脚底横向刻槽
      if (inst.kind === 'foot' && y > 470 && (x % 13) < 6) c = ramp(base, f * 0.5);
      // 通风栅：大腿下板一块栅格
      if (o === A.ventId && u > -0.52 && u < 0.34 && v > 0.1 && v < 0.3 && (y % 9) < 3.6) c = ramp(S.frame, 0.75);
      set(i, c);
    } else if (inst.kind === 'disc') {
      const rr = v;
      let c: RGB;
      if (rr > 0.88) c = ramp(S.frame, 0.7);
      else if (rr > 0.62) c = ramp(S.metal, 0.95);
      else if (rr > 0.3) c = ramp(S.armor2, 0.95);
      else if (rr > 0.14) c = ramp(S.metal, 0.7);
      else c = ramp(S.chrome, 0.9);
      set(i, ramp(c, (0.9 + 0.2 * (1 - Math.abs(u))) * mottle));
    } else if (inst.kind === 'cyl') {
      // 圆柱剖面：高光偏前（u=-0.3）、两缘收暗
      let f = 0.3 + 0.95 * Math.max(0, 1 - Math.abs(u + 0.3)) ** 1.5;
      if (v < 0.1 || (v > 0.45 && v < 0.55) || v > 0.9) f *= 0.6; // 缸筒环带
      set(i, ramp(S.metal, quant(f * mottle)));
    } else if (inst.kind === 'rod') {
      // 拉杆：亮带偏前 + 暗缘，金属管读法
      set(i, ramp(S.chrome, quant((0.24 + 1.2 * Math.max(0, 1 - Math.abs(u + 0.35)) ** 2) * mottle)));
    }
  }
  // 全局调色拉伸：暗更暗、亮更亮（拉开 std 与深暗部，细节盖章在其后保持 crisp）
  for (let i = 0; i < W * H; i++) {
    if (!cv.sil[i] || cv.col[i * 4 + 3] === 0) continue;
    for (let ch = 0; ch < 3; ch++) cv.col[i * 4 + ch] = Math.max(0, Math.min(255, (cv.col[i * 4 + ch] - 26) * 1.24 + 10));
  }
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
  // 关节盘刻槽：金属环带按角度分 8 扇区交替压暗
  for (const d of A.discs) {
    const x0 = Math.max(0, Math.floor(d.c.x - d.r)), x1 = Math.min(W - 1, Math.ceil(d.c.x + d.r));
    const y0 = Math.max(0, Math.floor(d.c.y - d.r)), y1 = Math.min(H - 1, Math.ceil(d.c.y + d.r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (cv.owner[i] !== d.id) continue;
      const rr = Math.hypot(x - d.c.x, y - d.c.y) / d.r;
      if (rr < 0.64 || rr > 0.86) continue;
      const sector = Math.floor(((Math.atan2(y - d.c.y, x - d.c.x) + Math.PI) / (2 * Math.PI)) * 8);
      if (sector % 2 === 0) set(i, ramp(get(i), 0.7));
    }
  }
  // 关节盘螺栓圈：8 颗环螺栓（暗点 + 高光）
  for (const d of A.discs) {
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + 0.39;
      const bx = Math.round(d.c.x + Math.cos(ang) * d.r * 0.75), by = Math.round(d.c.y + Math.sin(ang) * d.r * 0.75);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const px = bx + dx, py = by + dy;
        if (px >= 0 && px < W && py >= 0 && py < H && cv.owner[py * W + px] === d.id) set(py * W + px, ramp(S.frame, 1.5));
      }
      if (bx - 1 >= 0 && by - 1 >= 0 && cv.owner[(by - 1) * W + bx - 1] === d.id) set((by - 1) * W + bx - 1, ramp(S.chrome, 0.85));
    }
  }
  // 圆盘体积：方向性明暗（光自前上）+ 毂心在下右的微影
  for (const d of A.discs) {
    const x0 = Math.max(0, Math.floor(d.c.x - d.r)), x1 = Math.min(W - 1, Math.ceil(d.c.x + d.r));
    const y0 = Math.max(0, Math.floor(d.c.y - d.r)), y1 = Math.min(H - 1, Math.ceil(d.c.y + d.r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (cv.owner[i] !== d.id) continue;
      const dx = (x - d.c.x) / d.r, dy = (y - d.c.y) / d.r;
      let f = 0.9 + 0.34 * (0.45 * dx - 0.89 * dy);
      const rr = Math.hypot(dx, dy);
      if (rr > 0.16 && rr < 0.36 && dx > 0.1 && dy > 0.1) f *= 0.82; // 毂影
      set(i, ramp(get(i), Math.max(0.55, Math.min(1.3, f))));
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
    else { for (let r = 0; r < 3; r++) for (let dx = -8; dx <= 8; dx++) { put(cx + dx, cy - 6 + r * 6); put(cx + dx, cy - 5 + r * 6); } }
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
    if (m < 6.5) set(i, ramp(S.accent, 1.02));
  }
  // 贴纸文字与编号
  const drawText = (anchor: Pt, text: string, scale: number, colr: RGB, center = false) => {
    const wpx = text.length * 4 * scale - scale;
    let cx0 = Math.round(anchor.x - (center ? wpx / 2 : 0)), cy0 = Math.round(anchor.y);
    for (const ch of text) {
      const g = FONT[ch] ?? FONT[' '];
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (g[gy][gx] === '1')
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
          const px = cx0 + gx * scale + sx, py = cy0 + gy * scale + sy;
          if (px >= 0 && px < W && py >= 0 && py < H && cv.sil[py * W + px]) set(py * W + px, colr);
        }
      cx0 += 4 * scale;
    }
  };
  drawText(A.decalPos, 'CAUTION', 2, ramp(S.decal, 1.0), true);
  drawText(A.numPos, A.numText, 2, ramp(S.decal, 0.95));
  // 警示三角（CAUTION 上方）
  {
    const cx = Math.round(A.decalPos.x), cy = Math.round(A.decalPos.y) - 16;
    for (let dy = 0; dy < 9; dy++) for (let dx = -dy / 2; dx <= dy / 2; dx++) {
      const px = cx + Math.round(dx), py = cy + dy;
      if (px >= 0 && px < W && py >= 0 && py < H && cv.sil[py * W + px]) set(py * W + px, ramp(S.accent, 1.0));
    }
  }
  // 铆钉：2px 暗点 + 1px 高光
  for (const p of A.boltPts) {
    const bx = Math.round(p.x), by = Math.round(p.y);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const px = bx + dx, py = by + dy;
      if (px >= 0 && px < W && py >= 0 && py < H && cv.sil[py * W + px]) set(py * W + px, ramp(S.frame, 1.35));
    }
    if (bx - 1 >= 0 && by - 1 >= 0 && cv.sil[(by - 1) * W + bx - 1]) set((by - 1) * W + bx - 1, ramp(S.chrome, 0.8));
  }
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
    if (k !== 'plate' && k !== 'guard' && k !== 'foot') continue;
    const cur = get(i);
    if (cv.owner[i + 3 * W] !== o) set(i, ramp(cur, 0.68));       // 下侧壁（最强）
    else if (cv.owner[i - 3 * W] !== o) set(i, ramp(cur, 1.13));  // 上沿受光
    else if (cv.owner[i + 3] !== o) set(i, ramp(cur, 0.8));       // 前壁
    else if (cv.owner[i - 3] !== o) set(i, ramp(cur, 0.88));      // 后壁
  }
  // 斜面带：横向边界上亮唇 + 下暗唇两行；纵向边界前亮后暗（剪影最外圈由描边收尾）
  for (let y = 2; y < H - 2; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, o = cv.owner[i];
    if (o < 0 || !cv.sil[i]) continue;
    const cur = get(i);
    if (cv.owner[i - W] !== o) set(i, ramp(cur, 1.24));
    else if (cv.owner[i + W] !== o) set(i, ramp(cur, 0.6));
    else if (cv.owner[i + W] === o && cv.owner[i + 2 * W] !== o) set(i, ramp(cur, 0.84));
    else if (cv.owner[i + 1] !== o) set(i, ramp(cur, 1.12));
    else if (cv.owner[i - 1] !== o) set(i, ramp(cur, 0.8));
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
  // 做旧三：底部积尘（越靠下越暗 + 斑驳）
  for (let y = Math.floor(H * 0.72); y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!cv.sil[i] || cv.col[i * 4 + 3] === 0) continue;
    const t = (y / H - 0.72) / 0.28;
    const f = 1 - 0.16 * t * (0.6 + 0.4 * vnoise(x / 6, y / 6, spec.seed + 9));
    set(i, ramp(get(i), f));
  }
  // 接地阴影：脚下半透明椭圆（剪影外落笔，锚定站立感）
  {
    const cxG = 218, cyG = 494, rxG = 108, ryG = 13;
    for (let y = cyG - ryG - 2; y <= cyG + ryG + 2; y++) for (let x = cxG - rxG - 2; x <= cxG + rxG + 2; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const i = y * W + x;
      if (cv.col[i * 4 + 3] !== 0) continue;
      const q = ((x - cxG) / rxG) ** 2 + ((y - cyG) / ryG) ** 2;
      if (q < 1) { cv.col[i * 4] = 6; cv.col[i * 4 + 1] = 10; cv.col[i * 4 + 2] = 12; cv.col[i * 4 + 3] = Math.round(115 * (1 - q) ** 1.5); }
    }
  }
  // 描边
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!cv.sil[i]) continue;
    if (!cv.sil[i - 1] || !cv.sil[i + 1] || !cv.sil[i - W] || !cv.sil[i + W]) set(i, [14, 16, 18]);
  }
  return cv;
}
function shade2(c: RGB, f: number): RGB { return [c[0] * f, c[1] * f, c[2] * f]; }

// ---------- 输出 ----------
mkdirSync(new URL('./out', import.meta.url).pathname, { recursive: true });
const OUT = new URL('./out/', import.meta.url).pathname;
function saveLeg(name: string, spec: LegSpec) { writeFileSync(OUT + name + '.png', encodePNG(W, H, render(spec).col)); }
saveLeg('v9-leg-olive', { topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 0, camo: true, wear: 0.3 });
saveLeg('v9-leg-desert', { topology: 'standard', scheme: SCHEMES.desert, seed: 23, bend: 8, camo: true, wear: 0.35 });
saveLeg('v9-leg-slate-reverse', { topology: 'reverse', scheme: SCHEMES.slate, seed: 37, bend: 0, camo: false, wear: 0.2 });
saveLeg('v9-leg-rust', { topology: 'standard', scheme: SCHEMES.rust, seed: 41, bend: -8, camo: false, wear: 1 });
saveLeg('v9-leg-agile-shell', { topology: 'standard', scheme: SCHEMES.white, seed: 61, bend: 6, camo: false, wear: 0.05, shellMode: true });
saveLeg('v9-leg-scout-light', { topology: 'reverse', scheme: SCHEMES.slate, seed: 53, bend: 4, camo: false, wear: 0.25, frameHeavy: true });
{
  const a = render({ topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 0, camo: true, wear: 0.3 }).col;
  const b = render({ topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 26, camo: true, wear: 0.3 }).col;
  const w2 = W * 2 - 60, buf = new Uint8ClampedArray(w2 * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4;
    if (a[s + 3]) buf.set(a.subarray(s, s + 4), (y * w2 + x) * 4);
    if (b[s + 3] && x + W - 60 < w2) buf.set(b.subarray(s, s + 4), (y * w2 + x + W - 60) * 4);
  }
  writeFileSync(OUT + 'v9-pair-olive.png', encodePNG(w2, H, buf));
}
{
  // 阵列：远侧腿（压暗 + 去饱和 + 后移）垫后，近侧腿在前，两对相位交错
  const specA: LegSpec = { topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 0, camo: true, wear: 0.3 };
  const specB: LegSpec = { topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 24, camo: true, wear: 0.3 };
  const nearA = render(specA).col, nearB = render(specB).col;
  const farOf = (src: Uint8ClampedArray) => {
    const out = new Uint8ClampedArray(src);
    for (let i = 0; i < out.length; i += 4) {
      if (!out[i + 3]) continue;
      const r = out[i], g = out[i + 1], b = out[i + 2], L = (r + g + b) / 3;
      out[i] = (r + (L - r) * 0.35) * 0.5; out[i + 1] = (g + (L - g) * 0.35) * 0.5; out[i + 2] = (b + (L - b) * 0.35) * 0.54;
    }
    return out;
  };
  const wF = W * 2 + 40, hF = H + 18, buf = new Uint8ClampedArray(wF * hF * 4);
  const blit = (src: Uint8ClampedArray, dx: number, dy: number) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4;
      if (src[s + 3] && x + dx < wF && y + dy < hF) buf.set(src.subarray(s, s + 4), ((y + dy) * wF + x + dx) * 4);
    }
  };
  blit(farOf(nearB), 6, 0); blit(farOf(nearA), W + 12, 0);
  blit(nearA, 58, 16); blit(nearB, W + 64, 16);
  writeFileSync(OUT + 'v9-formation.png', encodePNG(wF, hF, buf));
}
console.log('done v9');
