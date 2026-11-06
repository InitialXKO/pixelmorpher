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
interface Scheme { armor: RGB; armor2: RGB; frame: RGB; metal: RGB; chrome: RGB; accent: RGB; glow: RGB; decal: RGB }
const SCHEMES: Record<string, Scheme> = {
  white:  { armor: [198, 203, 214], armor2: [168, 178, 196], frame: [26, 28, 34], metal: [70, 74, 84], chrome: [205, 212, 224], accent: [64, 110, 224], glow: [150, 200, 255], decal: [42, 50, 66] },
  olive:  { armor: [86, 92, 50], armor2: [69, 76, 40], frame: [35, 37, 32], metal: [80, 82, 84], chrome: [186, 190, 192], accent: [219, 130, 40], glow: [255, 198, 94], decal: [226, 224, 205] },
  desert: { armor: [130, 113, 81], armor2: [111, 95, 66], frame: [50, 44, 36], metal: [86, 84, 80], chrome: [192, 190, 182], accent: [209, 112, 36], glow: [255, 202, 102], decal: [238, 232, 214] },
  slate:  { armor: [75, 83, 95], armor2: [60, 68, 80], frame: [32, 36, 44], metal: [76, 80, 88], chrome: [178, 186, 196], accent: [235, 128, 44], glow: [255, 178, 86], decal: [224, 228, 232] },
  rust:   { armor: [118, 94, 66], armor2: [100, 80, 58], frame: [34, 28, 24], metal: [79, 75, 73], chrome: [176, 172, 166], accent: [223, 124, 38], glow: [255, 190, 98], decal: [230, 222, 204] },
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
    const dx = x - c.x, dy = y - c.y;
    const d = Math.hypot(dx, dy);
    // 12 边形刻面外形：平边在 0.966r、棱角在 r（scout/MBT 的盖帽不是正圆）
    const seg = ((Math.atan2(dy, dx) + Math.PI) % (Math.PI / 6));
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
interface LegSpec { topology: 'standard' | 'reverse'; scheme: Scheme; seed: number; bend: number; camo: boolean; wear?: number; frameHeavy?: boolean; shellMode?: boolean; wScale?: number; lift?: number; guardOff?: boolean; detail?: number; ankleShift?: number; cableTint?: RGB; decalKind?: 'num' | 'plate' | 'none'; coreScale?: number; footType?: 'blocks' | 'shoe' | 'claw' | 'pad' }
interface Anchors {
  plateTint: Map<number, number>; panelLines: Map<number, number[]>;
  boltPts: Pt[]; ventId: number; guardId: number; stripeId: number;
  decalPos: Pt; numPos: Pt; numText: string; lightPts: Pt[];
  discs: { id: number; c: Pt; r: number; hv: number }[];
  chevrons: [Pt, Pt][];
  seamU: Map<number, number>; insignia: { pos: Pt; kind: number };
  stripeThigh: number; blockPlates: Set<number>;
  deviceFrame: { c: Pt; ux: number; uy: number; px: number; py: number } | null; chevDecal: boolean;
  shinIds: Set<number>; stripeSegs: [Pt, Pt][];
  panelDiag: Map<number, number>; panelTee: Map<number, number>; decalKind: string; toeFace: { x0: number; y0: number; x1: number; y1: number } | null; colorRole?: Map<number, string>;
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
  const shin = { a: knee, b: ankle, wA: 94 * ws, wB: 64 * ws, bulge: { f: 0.05, b: 0.2 } };
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
  const addPlate = (a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap: number, cutA: number, cutB: number, kind: Kind = 'plate', bulge: Bulge = { f: 0, b: 0 }) => {
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
    if (kind === 'plate') { // 板衬边：同形宽 ×1.05 的框垫片，属板组件
      cv.insts.push({ kind: 'frame' });
      fillShape(cv, id, plateTest(a2, b2, wA * proud * 1.05, wB * proud * 1.05, Math.max(0, t0 - 0.008), Math.min(1, t1 + 0.008), 0, cutA, cutB, bulge, shape)); id++;
    }
    cv.insts.push({ kind }); const myId = id;
    fillShape(cv, id, plateTest(a2, b2, wA * proud, wB * proud, t0, t1, gap, cutA, cutB, bulge, shape)); id++;
    A.plateTint.set(myId, [0.78, 0.9, 1.0, 1.1, 1.24][Math.floor(rnd() * 5)]);
    const lines: number[] = []; const dtl = spec.detail ?? 1;
    const n = dtl < 0.7 ? (rnd() < 0.55 ? 0 : 1) : dtl > 1.1 ? 2 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) lines.push(0.3 + rnd() * 0.45);
    A.panelLines.set(myId, lines);
    A.seamU.set(myId, -0.42 + rnd() * 0.84); // 竖向面板缝位置
    if ((spec as LegSpec).shellMode && rnd() < 0.45) A.blockPlates.add(myId); // 人形壳：色块板
    if (rnd() < 0.3) A.panelDiag.set(myId, (rnd() - 0.5) * 0.9); // 斜面板线（错位网络）
    if (rnd() < 0.35) A.panelTee.set(myId, -0.5 + rnd()); // T 型接头竖线位置
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
  for (let k = 0; k <= 22; k++) cablePts.push(bezier(backOf(shin, 0.04, 34), backOf(shin, 0.5, 46 + sag * 0.8), backOf(shin, 0.96, 28), k / 22));
  cv.insts.push({ kind: 'cable' });
  fillShape(cv, id, (x, y) => { let m = 1e9; for (const p of cablePts) m = Math.min(m, Math.hypot(x - p.x, y - p.y)); return [m <= 5.5, 0, m / 5.5]; }); id++;
  for (const e of [cablePts[0], cablePts[cablePts.length - 1]]) { cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, discTest(e, 4.5)); id++; } // 线缆端头接头
  // 3) 段板：种子不等分 2–3 块，每块独立宽缩放/收分/切角/间隙
  const fw = spec.frameHeavy ? 0.68 : 1;
  const fg = spec.shellMode ? 1.4 : spec.frameHeavy ? 8.5 : 5;
  const segPlates = (seg: { a: Pt; b: Pt; wA: number; wB: number; bulge: Bulge }): number[] => {
    const n = spec.shellMode ? 2 : (rnd() < 0.35 ? 3 : 2);
    const cuts: number[] = [0.006];
    if (n === 2) cuts.push(0.3 + rnd() * 0.38);
    else { const c1 = 0.18 + rnd() * 0.2; cuts.push(c1, c1 + 0.24 + rnd() * 0.26); }
    cuts.push(0.996);
    const ids: number[] = [];
    for (let k = 0; k < n; k++) {
      const sA = (0.97 + rnd() * 0.28) * fw, sB = (0.97 + rnd() * 0.28) * fw; // 逐块独立宽与收分（v29 宽度分布整体上移，保形态扩）
      ids.push(addPlate(seg.a, seg.b, seg.wA * sA, seg.wB * sB, cuts[k], cuts[k + 1], fg * (0.6 + rnd() * 1.1), rnd() * 24, rnd() * 24, 'plate', seg.bulge));
    }
    return ids;
  };
  const thighIds = segPlates(thigh);
  A.stripeThigh = thighIds[0];
  A.ventId = thighIds[thighIds.length - 1];
  const shinIds = segPlates(shin);
  A.shinIds = new Set(shinIds);
  if (spec.shellMode) {
    const sf = segFrame(shin.a, shin.b); const sgn2 = std ? -1 : 1;
    const SP = (t: number, off: number): Pt => ({ x: shin.a.x + sf.ux * sf.len * t + sf.px * sgn2 * off, y: shin.a.y + sf.uy * sf.len * t + sf.py * sgn2 * off });
    A.stripeSegs = [[SP(0.08, 26), SP(0.92, -14)]];
  }
  // 5) 脚：跟块/掌块/趾块（切角块组，与全图同一套块语言）
  const footBlock = (cx: number, cy: number, w: number, h: number, ang: number, cham = 0.38, seam?: number) => {
    cv.insts.push({ kind: 'foot' }); const bid = id;
    fillShape(cv, id, polyTest(blockPoly(cx, cy, w, h, ang, cham))); id++;
    A.plateTint.set(bid, [0.9, 1.0, 1.08][Math.floor(rnd() * 3)]);
    A.panelLines.set(bid, [0.5]);
    if (seam !== undefined) A.seamU.set(bid, seam); // 趾帽竖缝
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
  } else {
    { // 踝上整流罩：靴筒块（blocks/shoe 共用）
      cv.insts.push({ kind: 'plate' }); const fid = id;
      fillShape(cv, id, polyTest(blockPoly(ankle.x + 38, 427, 96, 30, 0.12, 0.35))); id++;
      A.plateTint.set(fid, 0.95); A.panelLines.set(fid, [0.5]);
    }
    { cv.insts.push({ kind: 'frame' }); fillShape(cv, id, polyTest(blockPoly((ankle.x + toeX) / 2 + 1, 466, toeX - ankle.x + 70, 12, 0, 0.3))); id++; } // 足底件：只在底部留 2px 鞋底线
    footBlock(ankle.x - 24, 455, 64, 34, 0.04); // 跟块（顶 438）
    if (ft === 'shoe') {
      footBlock(ankle.x + 34, 457, 96, 26, -0.045, 0.3); // 鞋身块：微转，顶边略斜
      footBlock(toeX + 6, 461, 62, 18, 0.01, 0.55, 0.55); // 趾帽块：压鞋身前段，前上大切角
    } else if ((spec.wScale ?? 1) >= 1.3) {
      footBlock(ankle.x + 36, 456, 76, 35, 0.03); // 前掌大块（顶 438.5）
      footBlock(toeX + 4, 458, 56, 26, 0.04, 0.5); // 趾块（顶 445，钝厚）
      A.toeFace = { x0: toeX + 18, y0: 450, x1: toeX + 29, y1: 466 };
    } else {
      footBlock(ankle.x + 30, 457, 74, 30, 0.03); // 掌块（顶 442）
      footBlock(toeX - 1, 458, 60, 24, 0.03, 0.5, 0.5); // 趾块（顶 446，钝厚，前上大切角）
      A.toeFace = { x0: toeX + 15, y0: 451, x1: toeX + 26, y1: 465 };
    }
  }
  // 6) 前护板（多边形盾形，压在小腿前方）：坐标 = (沿轴 t, 离轴距离 off)；无护板族跳过
  if (!spec.guardOff) {
    const f = segFrame(shin.a, shin.b);
    const sgn = std ? -1 : 1; // front = -perp（标准型）
    const gS = 0.92 + rnd() * 0.25; // 护板比例逐腿不同（宽窄/突出量）
    const hwAt = (t: number) => ((shin.wA + (shin.wB - shin.wA) * t) / 2) * (1 + shin.bulge.f * bumpAt(t, 0.38)) * (spec.frameHeavy ? 0.8 : 1) * gS;
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
    { const df = segFrame(shin.a, shin.b); const dc = C(0.72, hwAt(0.72) * 0.6); A.deviceFrame = { c: dc, ux: df.ux, uy: df.uy, px: df.px, py: df.py }; }
    A.chevDecal = rnd() < 0.55;
    A.boltPts.push(C(0.12, hwAt(0.12) * 0.72), C(0.85, hwAt(0.85) * 0.42));
    // 三层叠人字纹（AA 式）：三个 ⌄ 上下叠，(t, off) 定义、渲染盖章
    for (const t0 of [0.16, 0.32, 0.48]) {
      const apex = C(t0 + 0.07, hwAt(t0 + 0.07) * 0.88);
      A.chevrons.push([C(t0, hwAt(t0) * 0.3), apex], [apex, C(t0 + 0.14, hwAt(t0 + 0.14) * 0.3)]);
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
      const cc = Math.min(w, h) * 0.24, x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
      fillShape(cv, id, polyTest([{ x: x0 + cc, y: y0 }, { x: x1 - cc, y: y0 }, { x: x1, y: y0 + cc }, { x: x1, y: y1 - cc }, { x: x1 - cc, y: y1 }, { x: x0 + cc, y: y1 }, { x: x0, y: y1 - cc }, { x: x0, y: y0 + cc }])); id++;
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
    if (spec.guardOff && !spec.shellMode) piston(F(0.18, 27), F(0.9, 23), 6.5, 3.4); // 无护板族：第二根前活塞成对露出（侦察式）
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
    cv.insts.push({ kind: 'disc' }); fillShape(cv, id, discTest(cc, r)); A.discs.push({ id, c: cc, r, hv: A.discs.length % 3 }); id++;
  }
  // 壳体块画在盖帽之后：压住帽缘、关节成簇（v15 画在帽前被帽盖住，等于没加）
  jointBlock(ja(hip, segAng(hip, knee), 30), segAng(hip, knee), 64, 46);
  jointBlock(ja(knee, segAng(knee, hip), 28), segAng(knee, hip), 62, 42);
  jointBlock(ja(knee, segAng(knee, ankle), 28), segAng(knee, ankle), 56, 40);
  jointBlock(ja(ankle, segAng(ankle, knee), 19), segAng(ankle, knee), 44, 32);
  jointBlock(ja(knee, segAng(knee, hip) + 0.55, 34), segAng(knee, hip) + 0.3, 38, 28);
  jointBlock(ja(hip, segAng(hip, knee) - 0.6, 32), segAng(hip, knee) - 0.3, 36, 26);
  jointBlock(ja(hip, segAng(hip, knee) + 0.55, 32), segAng(hip, knee) + 0.3, 36, 25); // 髋前整流块
  // 毂块：盖帽中心的切角方块（块语言，不再画同心毂环/毂心变体）
  for (const [j, r] of [[hip, 37], [knee, 35], [ankle, 21]] as [Pt, number][]) {
    cv.insts.push({ kind: 'plate' }); const hid = id;
    const dc = A.discs.find((d) => Math.abs(d.c.x - j.x) < 12 && Math.abs(d.c.y - j.y) < 12)?.c ?? j;
    fillShape(cv, id, polyTest(blockPoly(dc.x, dc.y, r * 0.62, r * 0.62, 0.3, 0.45))); id++;
    A.plateTint.set(hid, 1.1); A.panelLines.set(hid, []);
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
const FOOT_PATTERN = { blocks: 'footBlocks', shoe: 'footShoe', claw: 'footClaw', pad: 'footPad' } as const;
const FOOT_TYPE = { footBlocks: 'blocks', footShoe: 'shoe', footClaw: 'claw', footPad: 'pad' } as const;
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
    { id: 'thigh.plates', pattern: 'segPlates', anchors: ['hip', 'knee'], params: { wA: 110 * ws, wB: 84 * ws, bulgeF: 0.16, bulgeB: 0.05 } },
    { id: 'shin.plates', pattern: 'segPlates', anchors: ['knee', 'ankle'], params: { wA: 94 * ws, wB: 64 * ws, bulgeF: 0.05, bulgeB: 0.2 } },
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
      { kind: 'seg', a: 'knee', b: 'ankle', wA: 94 * ws, wB: 64 * ws },
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
      const fb1 = -0.7 + h1 * 0.45, fb2 = 0.15 + h2 * 0.5;
      const tBack = h4 < 0.22 ? 0.93 + h3 * 0.07 : 0.7 + h2 * 0.16;  // 约 1/5 板背带并入主面（两面块）
      const tMain = 0.93 + h3 * 0.1, tEdge = 0.8 + h1 * 0.14;
      const bevW = h3 < 0.3 ? 0 : 0.1 + h3 * 0.14, tBev = 1.08 + h4 * 0.2; // 约 3/10 板无亮斜面（三面块）
      let fz = uu < fb1 ? tBack : uu < fb2 ? tMain : uu < fb2 + bevW ? tBev : tEdge;
      if (spec.shellMode) fz = 1 + (fz - 1) * 0.75; // 人形壳面间对比略柔
      if (h1 > 0.45 && v > 0.52 + 0.28 * uu) fz *= 0.9; // 斜折面
      if (bevW > 0 && Math.abs(uu - fb2) < 0.028) fz *= 1.15; // 主折线亮棱（主面一侧）
      let f = fz * tint * (1 + (mottle - 1) * 0.35);
      if (v < 0.045) f *= 1.13; else if (v > 0.955) f *= 0.8; // 板端平带：上亮下暗
      f = quant(f);
      let base = (spec as LegSpec & { altTone?: boolean }).altTone === false ? S.armor : (o % 2 ? S.armor : S.armor2);
      if (A.blockPlates.has(o)) base = mix(base, S.accent, 0.38);
      // 大腿饰带：首板下缘双条强调色带
      if (o === A.stripeThigh && ((v > 0.8 && v < 0.845) || (v > 0.875 && v < 0.92))) { set(i, ramp(S.accent, 0.98)); continue; }
      if (inst.kind === 'foot') { base = S.armor2; f *= 0.85; }
      if (inst.kind === 'guard') { base = S.armor; f *= 1.04; } // 护板与段板分面（体积靠剖面本身）
      const cr = A.colorRole?.get(o); if (cr === 'armor2') base = S.armor2; else if (cr === 'accent') base = S.accent;
      if (spec.camo && vnoise(x / 58, y / 40, spec.seed + 3) > 0.62) base = mix(base, shade2(S.armor2, 0.8), 0.7);
      let c = ramp(base, f);
      // 面板线（横向 + 竖向缝，成网）
      const dg = A.panelDiag.get(o);
      for (const lv of A.panelLines.get(o) ?? []) {
        const lvE = dg ? lv + dg * u * 0.45 : lv;
        if (Math.abs(v - lvE) < 0.011) c = ramp(base, f * 0.58);
        else if (Math.abs(v - lvE - 0.017) < 0.008) c = ramp(base, f * 1.17); // 刻线下唇受光
      }
      const tee = A.panelTee.get(o);
      if (tee !== undefined && Math.abs(u - tee) < 0.02 && v > 0.18 && v < 0.82) c = ramp(base, f * 0.58); // T 接头
      const su = A.seamU.get(o);
      if (su !== undefined && v > 0.12 && v < 0.88) {
        if (Math.abs(u - su) < 0.02) c = ramp(base, f * 0.58);
        else if (Math.abs(u - su + 0.034) < 0.009) c = ramp(base, f * 1.15); // 竖缝前侧受光唇
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
      // 圆柱剖面：高光偏前（u=-0.3）、两缘收暗
      let f = 0.3 + 0.95 * Math.max(0, 1 - Math.abs(u + 0.3)) ** 1.5;
      if (v < 0.1 || (v > 0.45 && v < 0.55) || v > 0.9) f *= 0.6; // 缸筒环带
      set(i, ramp(S.metal, quant(f * mottle)));
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
  // 关节盖帽：整面按扇区平坦分面（一块的面）+ 一道毂缝线 + 帽缘收边（无同心环）
  for (const d of A.discs) {
    const x0 = Math.max(0, Math.floor(d.c.x - d.r)), x1 = Math.min(W - 1, Math.ceil(d.c.x + d.r));
    const y0 = Math.max(0, Math.floor(d.c.y - d.r)), y1 = Math.min(H - 1, Math.ceil(d.c.y + d.r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (cv.owner[i] !== d.id) continue;
      const dx = (x - d.c.x) / d.r, dy = (y - d.c.y) / d.r;
      const rr = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      const fa = (Math.floor((ang + Math.PI) / (Math.PI / 6)) + 0.5) * (Math.PI / 6) - Math.PI;
      let c = ramp(mix(S.armor2, S.metal, 0.45), quant(0.86 + 0.42 * (0.45 * Math.cos(fa) - 0.89 * Math.sin(fa))));
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
    else if (kind === 4) { for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) { const r = Math.hypot(dx, dy); if (r < 1 || r > 10) continue; const th = Math.atan2(dy, dx); const loc = Math.abs(((th / (Math.PI * 2) * 5) % 1 + 1.5) % 1 - 0.5) * 2; const R = 9.2 - 5 * loc; if (Math.abs(r - R) < 1.25) put(cx + dx, cy + dy); } }
    else { for (let r = 0; r < 3; r++) for (let dx = -8; dx <= 8; dx++) { put(cx + dx, cy - 6 + r * 6); put(cx + dx, cy - 5 + r * 6); } }
  }
  // 人形壳涂装条纹：沿小腿壳面斜扫的强调色带（只落小腿壳板）
  for (const [p1, p2] of A.stripeSegs) {
    const x0 = Math.max(0, Math.floor(Math.min(p1.x, p2.x) - 10)), x1 = Math.min(W - 1, Math.ceil(Math.max(p1.x, p2.x) + 10));
    const y0 = Math.max(0, Math.floor(Math.min(p1.y, p2.y) - 10)), y1 = Math.min(H - 1, Math.ceil(Math.max(p1.y, p2.y) + 10));
    const dxs = p2.x - p1.x, dys = p2.y - p1.y, ll = Math.hypot(dxs, dys) || 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (!A.shinIds.has(cv.owner[i])) continue;
      const tt = Math.max(0, Math.min(1, ((x - p1.x) * dxs + (y - p1.y) * dys) / (ll * ll)));
      const m = Math.hypot(x - (p1.x + dxs * tt), y - (p1.y + dys * tt));
      if (m < 6.5) set(i, ramp(S.accent, 0.95));
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
    if (k !== 'plate' && k !== 'guard' && k !== 'foot' && k !== 'disc') continue;
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
function blockPolyT(cx: number, cy: number, w: number, h: number, ang: number, cham = 0.36, seed = 0): Pt[] {
  const ca = Math.cos(ang), sa = Math.sin(ang), lx = w / 2, ly = h / 2;
  const rnd = srandF(seed * 7919 + 13);
  const base = (Math.min(w, h) * cham) / 2;
  const c = [0, 1, 2, 3].map(() => Math.min(base * (0.3 + rnd() * 1.5), Math.min(w, h) * 0.46));
  const raw: Pt[] = [{ x: -lx + c[0], y: -ly }, { x: lx - c[1], y: -ly }, { x: lx, y: -ly + c[1] }, { x: lx, y: ly - c[2] }, { x: lx - c[2], y: ly }, { x: -lx + c[3], y: ly }, { x: -lx, y: ly - c[3] }, { x: -lx, y: -ly + c[0] }];
  if (rnd() < 0.45 && w > 34 && h > 26) {
    const d = 2 + rnd() * 3, y0 = -ly + c[1] + (h - c[1] - c[2]) * (0.25 + rnd() * 0.3), len = (h - c[1] - c[2]) * 0.3;
    const pts: Pt[] = [raw[0], raw[1], raw[2], { x: lx, y: y0 }, { x: lx - d, y: y0 }, { x: lx - d, y: y0 + len }, { x: lx, y: y0 + len }, raw[3], raw[4], raw[5], raw[6], raw[7]];
    return pts.map((q) => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
  }
  return raw.map((q) => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
}
interface LayerTools { segPlate: (a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap?: number, kind?: Kind) => number; A: Anchors; addBlock: (kind: Kind, cx: number, cy: number, w: number, h: number, ang?: number, cham?: number, bolts?: boolean) => number; addDisc: (kind: Kind, c: Pt, r: number) => number; addPoly: (pts: Pt[], bolts?: boolean) => number; addRaw: (kind: Kind, test: (x: number, y: number) => [boolean, number, number]) => number; rod: (a: Pt, b: Pt, r: number) => number; grille: (cx: number, cy: number, w: number, h: number) => void; glacis: (cx: number, cy: number, w: number, h: number, slope: number) => number; portArray: (cx: number, cy: number, w: number, h: number, cols: number, rows: number) => void; nozzle: (a: Pt, b: Pt, r0: number, r1: number) => void; wing: (cx: number, cy: number, len: number, wRoot: number, wTip: number, ang: number) => number; finish: () => void }
function makeLayerTools(cv: MechaCanvas, seed: number): LayerTools {
  const rnd = mulberry32(seed);
  let id = 0;
  const A: Anchors = { plateTint: new Map(), panelLines: new Map(), boltPts: [], ventId: -1, guardId: -1, stripeId: -1, decalPos: { x: 0, y: 0 }, numPos: { x: 0, y: 0 }, numText: '', lightPts: [], discs: [], chevrons: [], seamU: new Map(), insignia: { pos: { x: 0, y: 0 }, kind: 0 }, stripeThigh: -1, blockPlates: new Set(), deviceFrame: null, chevDecal: true, shinIds: new Set(), stripeSegs: [], panelDiag: new Map(), panelTee: new Map(), decalKind: 'num', toeFace: null, colorRole: new Map() };
  const tints = [0.78, 0.9, 1.0, 1.1, 1.24];
  const reg = (myId: number) => {
    A.plateTint.set(myId, tints[Math.floor(rnd() * 5)]);
    const lines: number[] = []; const n = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) lines.push(0.3 + rnd() * 0.45);
    A.panelLines.set(myId, lines);
    A.seamU.set(myId, 0.15 + rnd() * 0.7);
    if (rnd() < 0.3) A.panelDiag.set(myId, (rnd() - 0.5) * 0.9);
    if (rnd() < 0.35) A.panelTee.set(myId, 0.1 + rnd() * 0.8);
  };
  const addBlock = (kind: Kind, cx: number, cy: number, w: number, h: number, ang = 0, cham = 0.36, bolts = false): number => {
    cv.insts.push({ kind }); const myId = id;
    const t = polyTest(blockPolyT(cx, cy, w, h, ang, cham, myId + 2000));
    fillShape(cv, id, t); id++;
    if (kind === 'plate') reg(myId);
    if (bolts) for (const [bx, by] of [[cx - w / 2 + 6, cy - h / 2 + 6], [cx + w / 2 - 6, cy - h / 2 + 6], [cx - w / 2 + 6, cy + h / 2 - 6], [cx + w / 2 - 6, cy + h / 2 - 6]] as const) A.boltPts.push({ x: bx, y: by });
    return myId;
  };
  const addDisc = (kind: Kind, c: Pt, r: number): number => { cv.insts.push({ kind }); const myId = id; fillShape(cv, id, discTest(c, r)); id++; A.discs.push({ id: myId, c, r, hv: 0.5 }); return myId; };
  const grille = (cx: number, cy: number, w: number, h: number) => { addBlock('plate', cx, cy, w, h, 0, 0.2); for (let k = 0; k < 3; k++) addBlock('frame', cx, cy - h / 2 + 6 + k * ((h - 8) / 2), w - 4, 4.5, 0, 0.1); };
  const glacis = (cx: number, cy: number, w: number, h: number, slope: number) => { const pts: Pt[] = [{ x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2 - slope, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 + slope * 0.62 }, { x: cx + w / 2, y: cy + h / 2 - 4 }, { x: cx + w / 2 - 5, y: cy + h / 2 }, { x: cx - w / 2 + 5, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 - 4 }]; return addPoly(pts); }; // 斜面箱：前上长斜面切角的箱体
  const portArray = (cx: number, cy: number, w: number, h: number, cols: number, rows: number) => { addBlock('plate', cx, cy, w, h, 0, 0.18); for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const px = cx - w / 2 + (c + 0.5) * (w / cols), py = cy - h / 2 + (r + 0.5) * (h / rows), rr = Math.min(w / cols, h / rows) * 0.3; addDisc('disc', { x: px, y: py }, rr); addDisc('frame', { x: px, y: py }, rr * 0.55); } }; // 管口阵列：底板 + 网格口（金属环+暗口）
  const nozzle = (a: Pt, b: Pt, r0: number, r1: number) => { const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len; addRaw('cyl', (x, y) => { const t = ((x - a.x) * ux + (y - a.y) * uy) / len; if (t < 0 || t > 1) return [false, 0, 0]; const px = a.x + ux * len * t, py = a.y + uy * len * t, d = Math.hypot(x - px, y - py), rr = r0 + (r1 - r0) * t * t; return [d <= rr, t, d / rr]; }); addDisc('frame', b, r1 * 0.78); }; // 钟形喷口：半径沿轴 t² 张开 + 暗口面
  const wing = (cx: number, cy: number, len: number, wRoot: number, wTip: number, ang: number) => { const c = Math.cos(ang), s = Math.sin(ang), loc: Pt[] = [{ x: -len / 2, y: -wRoot / 2 }, { x: len / 2, y: -wTip / 2 }, { x: len / 2 + wTip * 0.7, y: 0 }, { x: len / 2, y: wTip / 2 }, { x: -len / 2, y: wRoot / 2 }]; return addPoly(loc.map((p) => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }))); }; // 翼板：根宽尖细的薄板（厚度走全局边面组）
  const segPlate = (a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap = 2.5, kind: Kind = 'plate'): number => {
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
    return myId;
  };
  const addPoly = (pts: Pt[], bolts = false): number => { cv.insts.push({ kind: 'plate' }); const myId = id; fillShape(cv, id, polyTest(pts)); id++; reg(myId); if (bolts) { const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); const x0 = Math.min(...xs) + 6, x1 = Math.max(...xs) - 6, y0 = Math.min(...ys) + 6, y1 = Math.max(...ys) - 6; for (const [bx, by] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const) A.boltPts.push({ x: bx, y: by }); } return myId; };
  const addRaw = (kind: Kind, test: (x: number, y: number) => [boolean, number, number]): number => { cv.insts.push({ kind }); const myId = id; fillShape(cv, id, test); id++; return myId; };
  const rod = (a: Pt, b: Pt, r: number): number => addRaw('cyl', lineTest(a, b, r));
  const finish = () => { for (let i = 0; i < W * H; i++) if (cv.owner[i] >= 0) cv.sil[i] = 1; };
  return { A, addBlock, addDisc, addPoly, addRaw, rod, grille, glacis, portArray, nozzle, wing, finish, segPlate };
}

// ---------- armIR：规格 → 锚点 → 部件列（数据） → 通用解释渲染 ----------
type ArmFrame = 'upper' | 'fore' | 'shoulder' | 'wrist';
type ArmPart =
  | { t: 'segCore'; seg: 'upper' | 'fore'; w0: number; w1: number; s0: number; s1: number }
  | { t: 'segPlate'; seg: 'upper' | 'fore'; w0: number; w1: number; s0: number; s1: number; role?: 'stripe' | 'armor2' | 'accent' }
  | { t: 'disc'; at: 'shoulder' | 'elbow' | 'wrist'; r: number }
  | { t: 'discAt'; frame: ArmFrame; along: number; perp: number; r: number }
  | { t: 'block'; frame: ArmFrame; along: number; perp: number; w: number; h: number; angOff?: number; kind?: Kind; cham?: number; bolts?: boolean }
  | { t: 'rod'; seg: 'upper' | 'fore'; perp: number; s0: number; s1: number; r: number }
  | { t: 'rodLink'; fromSeg: 'upper' | 'fore'; fromS: number; fromPerp: number; toSeg: 'upper' | 'fore'; toS: number; toPerp: number; r: number }
  | { t: 'cable'; seg: 'upper' | 'fore'; perp: number; sag: number; r: number }
  | { t: 'insignia'; frame: ArmFrame; along: number; perp: number; kind: number }
  | { t: 'light'; frame: ArmFrame; along: number; perp: number };
interface ArmSpec {
  family: string; scheme: Scheme; seed: number; wear: number; camo: boolean;
  root: Pt; upperLen: number; foreLen: number; upperAng: number; elbowBend: number;
  bulk: number; shell: number; hand: 'fist' | 'claw'; twoTone: boolean; diag: number;
  form: { shell: 'box' | 'cap'; elbow: 'disc' | 'ring' | 'small'; fore: 'plates' | 'housing' | 'shell'; fingerLen: number; fingerCurl: number };
  gear: { cable: boolean; piston: boolean; device: boolean; stripe: boolean };
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
    for (let k = 0; k < n; k++) parts.push({ t: 'segPlate', seg, w0: w0 + (w1 - w0) * (k / n), w1: w0 + (w1 - w0) * ((k + 1) / n), s0: 0.04 + (0.93 * k) / n + 0.008, s1: 0.04 + (0.93 * (k + 1)) / n - 0.008, role: seg === 'fore' && k === 0 && spec.gear.stripe ? 'stripe' : undefined });
    if (spec.family === 'powersuit' && seg === 'fore') parts.push({ t: 'segPlate', seg, w0: w0 + (w1 - w0) * 0.88, w1: w1, s0: 0.9, s1: 0.985, role: 'armor2' }); // 橙只作腕端带
    if (spec.family === 'powersuit' && seg === 'upper') parts.push({ t: 'segPlate', seg, w0, w1: w0 + (w1 - w0) * 0.12, s0: 0.015, s1: 0.14, role: 'armor2' }); // 肩下橙带
  };
  for (const [seg, w0, w1] of [['upper', 30, 26], ['fore', 26, 20]] as const)
    for (let k = 0; k < 3; k++) parts.push({ t: 'segCore', seg, w0: (w0 + (w1 - w0) * (k / 3)) * b, w1: (w0 + (w1 - w0) * ((k + 1) / 3)) * b, s0: k / 3 + 0.01, s1: (k + 1) / 3 - 0.01 });
  parts.push({ t: 'block', frame: 'shoulder', along: -4, perp: 2, w: 44 * b, h: 36 * b, angOff: 0.15, kind: 'frame' });
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
  if (spec.form.elbow === 'ring') { parts.push({ t: 'block', frame: 'fore', along: 0, perp: 0, w: 23 * b, h: 23 * b, kind: 'frame' }); parts.push({ t: 'disc', at: 'elbow', r: 12.5 * b }); parts.push({ t: 'disc', at: 'elbow', r: 7 * b }); }
  else if (spec.form.elbow === 'small') { parts.push({ t: 'disc', at: 'elbow', r: 8.5 * b }); parts.push({ t: 'block', frame: 'fore', along: -4, perp: 0, w: 30 * b, h: 24 * b, kind: 'plate', cham: 0.5 }); }
  else parts.push({ t: 'disc', at: 'elbow', r: 12.5 * b }, { t: 'disc', at: 'elbow', r: 7 * b });
  parts.push({ t: 'block', frame: 'fore', along: 0, perp: 19 * b, w: 15 * b, h: 24 * b, kind: 'frame' }, { t: 'block', frame: 'fore', along: 0, perp: -19 * b, w: 15 * b, h: 24 * b, kind: 'frame' });
  if (spec.form.fore === 'housing') {
    parts.push({ t: 'segPlate', seg: 'fore', w0: 56 * b, w1: 46 * b, s0: 0.03, s1: 0.97, role: spec.gear.stripe ? 'stripe' : undefined });
    parts.push({ t: 'block', frame: 'fore', along: spec.foreLen * 0.3, perp: -27 * b, w: 44 * b, h: 13, kind: 'frame' }); // 顶部导轨座
  } else plates('fore', spec.foreLen, 58 * b, 43 * b);
  if (spec.gear.device) { parts.push({ t: 'block', frame: 'fore', along: spec.foreLen * 0.45, perp: -26 * b, w: 20, h: 26, kind: 'frame' }); parts.push({ t: 'block', frame: 'fore', along: spec.foreLen * 0.45, perp: -27 * b, w: 13, h: 18, kind: 'plate' }); parts.push({ t: 'light', frame: 'fore', along: spec.foreLen * 0.45, perp: -30 * b }); }
  parts.push({ t: 'disc', at: 'wrist', r: 8.5 * b }, { t: 'disc', at: 'wrist', r: 4.5 * b });
  parts.push({ t: 'block', frame: 'wrist', along: 16, perp: 0, w: 36 * b, h: 26 * b, kind: 'plate', bolts: true });
  parts.push({ t: 'block', frame: 'wrist', along: 13, perp: 3, w: 24 * b, h: 17 * b, kind: 'plate' }); // 掌背板
  if (spec.hand === 'fist') {
    // 指链（按 cyber/agile 参考抽取：四指位侧面取三列、每指三段渐细、关节盘、逐节累进卷曲；拇指自掌前下角出、两段前指）
    const fr = segFrame(elbow, wrist), foreAng = Math.atan2(fr.uy, fr.ux);
    const fw = 7 + 3.5 * b, L = spec.form.fingerLen, curl = spec.form.fingerCurl;
    const toFrame = (c: Pt) => ({ along: (c.x - wrist.x) * fr.ux + (c.y - wrist.y) * fr.uy, perp: (c.x - wrist.x) * fr.px + (c.y - wrist.y) * fr.py });
    parts.push({ t: 'block', frame: 'wrist', along: 29, perp: 0, w: 31 * b, h: 7, kind: 'frame' }); // 指节梁
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
        parts.push({ t: 'discAt', frame: 'wrist', along: pf.along, perp: pf.perp, r: wk * 0.42 });
        parts.push({ t: 'block', frame: 'wrist', along: cf.along, perp: cf.perp, w: wk, h: lk, angOff: a - foreAng, kind: 'plate', cham: 0.3 });
        pos = { x: pos.x + Math.cos(a) * lk, y: pos.y + Math.sin(a) * lk };
      }
    }
    { // 拇指：根植鱼际丘内，两段前指、卷向与四指同向
      let pos = { x: wrist.x + fr.ux * 24 + fr.px * -11, y: wrist.y + fr.uy * 24 + fr.py * -11 };
      for (let k = 0; k < 2; k++) {
        const lk = [14.5, 12][k] * (0.7 + 0.3 * b), wk = [10.5, 9][k] * (0.7 + 0.3 * b);
        const a = foreAng - 0.38 - 0.32 * k;
        const cen = { x: pos.x + Math.cos(a) * (lk / 2), y: pos.y + Math.sin(a) * (lk / 2) };
        const cf = toFrame(cen), pf = toFrame(pos);
        parts.push({ t: 'discAt', frame: 'wrist', along: pf.along, perp: pf.perp, r: wk * 0.5 });
        parts.push({ t: 'block', frame: 'wrist', along: cf.along, perp: cf.perp, w: wk, h: lk, angOff: a - foreAng, kind: 'plate', cham: 0.3 });
        pos = { x: pos.x + Math.cos(a) * lk, y: pos.y + Math.sin(a) * lk };
      }
    }
  }
  else { parts.push({ t: 'block', frame: 'wrist', along: 34, perp: -12, w: 10, h: 22, angOff: 0.3, kind: 'plate' }); parts.push({ t: 'block', frame: 'wrist', along: 34, perp: 12, w: 10, h: 22, angOff: -0.3, kind: 'plate' }); }
  const sh = spec.shell;
  if (spec.form.shell === 'cap') {
    parts.push({ t: 'block', frame: 'shoulder', along: -2, perp: 0, w: 68 * sh, h: 50 * sh, angOff: -0.04, kind: 'plate', cham: 0.62, bolts: true });
    parts.push({ t: 'block', frame: 'shoulder', along: -30, perp: 0, w: 58 * sh, h: 18 * sh, angOff: -0.03, kind: 'plate', cham: 0.5 });
  } else {
    parts.push({ t: 'block', frame: 'shoulder', along: -8, perp: 0, w: 104 * sh, h: 62 * sh, angOff: -0.05, kind: 'plate', bolts: true });
    parts.push({ t: 'block', frame: 'shoulder', along: -36, perp: 0, w: 84 * sh, h: 22 * sh, angOff: -0.03, kind: 'plate' });
    parts.push({ t: 'block', frame: 'shoulder', along: 6, perp: -42 * sh, w: 28 * sh, h: 44 * sh, angOff: 0.12, kind: 'plate' });
  }
  parts.push({ t: 'insignia', frame: 'shoulder', along: -10, perp: -4, kind: spec.family === 'olive' ? 4 : spec.family === 'powersuit' ? 1 : 0 });
  return { anchors: { shoulder, elbow, wrist, palm }, parts };
}
function renderArmIR(cv: MechaCanvas, ir: ArmIR, spec: ArmSpec): Anchors {
  const T = makeLayerTools(cv, spec.seed);
  const { A } = T;
  const A0 = ir.anchors;
  const segOf = (seg: 'upper' | 'fore') => seg === 'upper' ? { a: A0.shoulder, b: A0.elbow } : { a: A0.elbow, b: A0.wrist };
  const frameOf = (f: ArmFrame) => f === 'upper' || f === 'shoulder' ? { o: A0.shoulder, a: A0.shoulder, b: A0.elbow } : f === 'fore' ? { o: A0.elbow, a: A0.elbow, b: A0.wrist } : { o: A0.wrist, a: A0.elbow, b: A0.wrist };
  const fp = (f: ArmFrame, along: number, perp: number): Pt => { const { o, a, b } = frameOf(f); const fr = segFrame(a, b); return { x: o.x + fr.ux * along + fr.px * perp, y: o.y + fr.uy * along + fr.py * perp }; };
  const fang = (f: ArmFrame) => { const { a, b } = frameOf(f); const fr = segFrame(a, b); return Math.atan2(fr.uy, fr.ux) - Math.PI / 2; };
  for (const p of ir.parts) {
    if (p.t === 'segCore') { const { a, b } = segOf(p.seg); T.segPlate(a, b, p.w0, p.w1, p.s0, p.s1, 0, 'frame'); }
    else if (p.t === 'segPlate') { const { a, b } = segOf(p.seg); const id = T.segPlate(a, b, p.w0, p.w1, p.s0, p.s1); if (p.role === 'stripe') A.stripeThigh = id; else if (p.role) (A.colorRole ??= new Map()).set(id, p.role); }
    else if (p.t === 'disc') T.addDisc('disc', A0[p.at], p.r);
    else if (p.t === 'discAt') { const c = fp(p.frame, p.along, p.perp); T.addDisc('disc', c, p.r); }
    else if (p.t === 'block') { const c = fp(p.frame, p.along, p.perp); T.addBlock(p.kind ?? 'plate', c.x, c.y, p.w, p.h, fang(p.frame) + (p.angOff ?? 0), p.cham ?? 0.36, p.bolts ?? false); }
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
  | { t: 'block'; dx: number; dy: number; w: number; h: number; ang?: number; kind?: Kind; cham?: number; bolts?: boolean; role?: 'stripe' | 'armor2' | 'accent' }
  | { t: 'disc'; dx: number; dy: number; r: number; kind?: Kind }
  | { t: 'grille'; dx: number; dy: number; w: number; h: number }
  | { t: 'light'; dx: number; dy: number }
  | { t: 'insignia'; dx: number; dy: number; kind: number }
  | { t: 'number'; dx: number; dy: number; text: string };
interface TorsoSpec {
  family: string; scheme: Scheme; seed: number; wear: number; camo: boolean; twoTone: boolean;
  neck: Pt; chestW: number; chestH: number; waistH: number; pelvisH: number;
  form: { chest: 'stack' | 'shell' | 'slab'; back: 'box' | 'binder' | 'rack' | 'none'; grille: 'side' | 'front' | 'none'; skirt: 'front' | 'both' | 'none' };
  gear: { stripe: boolean; insignia: number; number: string };
}
interface TorsoIR { anchors: Record<'neck' | 'shoulder' | 'hip' | 'chestC', Pt>; parts: TorsoPart[] }
function torsoIR(spec: TorsoSpec): TorsoIR {
  const W = spec.chestW, CH = spec.chestH, WH = spec.waistH, PH = spec.pelvisH, F = spec.form, parts: TorsoPart[] = [];
  const waistY = CH + WH / 2, pelvisY = CH + WH + PH / 2;
  // 背挂（先画，居后）
  if (F.back === 'box') { parts.push({ t: 'block', dx: -W * 0.52, dy: CH * 0.4, w: W * 0.34, h: CH * 0.78, kind: 'frame' }); parts.push({ t: 'grille', dx: -W * 0.52, dy: CH * 0.34, w: W * 0.26, h: CH * 0.4 }); parts.push({ t: 'block', dx: -W * 0.5, dy: CH * 0.86, w: W * 0.3, h: CH * 0.2 }); }
  else if (F.back === 'binder') { parts.push({ t: 'block', dx: -W * 0.55, dy: CH * 0.75, w: W * 0.42, h: CH * 1.5, ang: 0.22, cham: 0.5 }); parts.push({ t: 'block', dx: -W * 0.7, dy: CH * 0.85, w: W * 0.3, h: CH * 1.3, ang: 0.22, cham: 0.5 }); parts.push({ t: 'block', dx: -W * 0.72, dy: CH * 1.42, w: W * 0.2, h: CH * 0.34, ang: 0.22, kind: 'frame' }); }
  else if (F.back === 'rack') { parts.push({ t: 'block', dx: -W * 0.5, dy: CH * 0.3, w: W * 0.22, h: CH * 0.62, kind: 'cyl' }); parts.push({ t: 'block', dx: -W * 0.52, dy: CH * 0.72, w: W * 0.24, h: CH * 0.4, kind: 'frame' }); }
  // 领圈 + 胸
  parts.push({ t: 'block', dx: 0, dy: 2, w: W * 0.52, h: 16, kind: 'frame' });
  parts.push({ t: 'block', dx: -W * 0.38, dy: CH * 0.16, w: W * 0.3, h: CH * 0.34, kind: 'frame' }); // 肩座
  parts.push({ t: 'disc', dx: W * 0.36, dy: CH * 0.16, r: W * 0.13 }); // 肩关节盘
  if (F.chest === 'stack') {
    parts.push({ t: 'block', dx: W * 0.02, dy: CH * 0.3, w: W, h: CH * 0.56, cham: 0.34, bolts: true });
    parts.push({ t: 'block', dx: -W * 0.02, dy: CH * 0.76, w: W * 0.92, h: CH * 0.48, cham: 0.3 });
  } else if (F.chest === 'shell') {
    parts.push({ t: 'block', dx: 0, dy: CH * 0.46, w: W, h: CH * 0.92, cham: 0.52, bolts: true });
    parts.push({ t: 'block', dx: W * 0.08, dy: CH * 0.97, w: W * 0.5, h: CH * 0.18, ang: 0.1, cham: 0.5 }); // 胸尖
  } else { // slab 两段叠（重型参考是上下两块宽板）
    parts.push({ t: 'block', dx: 0, dy: CH * 0.27, w: W * 1.06, h: CH * 0.54, cham: 0.26, bolts: true });
    parts.push({ t: 'block', dx: -W * 0.02, dy: CH * 0.76, w: W * 1.0, h: CH * 0.48, cham: 0.24 });
  }
  if (F.grille === 'side') parts.push({ t: 'grille', dx: W * 0.18, dy: CH * 0.74, w: W * 0.44, h: CH * 0.3 });
  else if (F.grille === 'front') parts.push({ t: 'grille', dx: W * 0.3, dy: CH * 0.34, w: W * 0.36, h: CH * 0.34 });
  if (spec.gear.stripe) parts.push({ t: 'block', dx: W * 0.02, dy: CH * 0.94, w: W * 0.9, h: 7, role: 'accent' });
  parts.push({ t: 'insignia', dx: W * 0.16, dy: CH * 0.26, kind: spec.gear.insignia });
  if (spec.gear.number) parts.push({ t: 'number', dx: W * 0.3, dy: CH * 0.62, text: spec.gear.number });
  parts.push({ t: 'light', dx: W * 0.34, dy: CH * 0.16 });
  // 窄腰（关节带：宽内构 + 中央柱 + 侧盘，与胸胯交叠不断开）
  parts.push({ t: 'block', dx: -W * 0.04, dy: waistY, w: W * 0.72, h: WH * 1.5, kind: 'frame' });
  parts.push({ t: 'block', dx: W * 0.06, dy: waistY, w: W * 0.2, h: WH * 1.24, kind: 'cyl' });
  parts.push({ t: 'disc', dx: -W * 0.32, dy: waistY, r: WH * (spec.family === 'powersuit' ? 0.3 : 0.42), kind: 'disc' });
  if (spec.family === 'agile') { parts.push({ t: 'block', dx: W * 0.3, dy: waistY, w: 9, h: WH * 1.2, kind: 'cyl', role: 'accent' }); parts.push({ t: 'block', dx: -W * 0.26, dy: waistY, w: 9, h: WH * 1.2, kind: 'cyl', role: 'accent' }); }
  // 胯 + 裙
  parts.push({ t: 'block', dx: 0, dy: pelvisY, w: W * 0.88, h: PH * 0.94, cham: 0.32, bolts: true });
  if (spec.gear.stripe) parts.push({ t: 'block', dx: W * 0.05, dy: pelvisY + PH * 0.3, w: W * 0.8, h: 6, role: 'accent' });
  if (F.skirt !== 'none') parts.push({ t: 'block', dx: W * 0.34, dy: pelvisY + PH * 0.05, w: W * 0.34, h: PH * 0.62, ang: 0.12, cham: 0.3 }); // 前裙
  if (F.skirt === 'both') parts.push({ t: 'block', dx: -W * 0.36, dy: pelvisY + PH * 0.18, w: W * 0.3, h: PH * 0.66, ang: -0.1, cham: 0.3 }); // 后裙
  return { anchors: { neck: spec.neck, shoulder: { x: spec.neck.x + W * 0.3, y: spec.neck.y + CH * 0.18 }, hip: { x: spec.neck.x, y: spec.neck.y + CH + WH + PH }, chestC: { x: spec.neck.x, y: spec.neck.y + CH / 2 } }, parts };
}
function renderTorsoIR(cv: MechaCanvas, ir: TorsoIR, spec: TorsoSpec): Anchors {
  const T = makeLayerTools(cv, spec.seed);
  const { A } = T, o = ir.anchors.neck;
  for (const p of ir.parts) {
    const cx = o.x + p.dx, cy = o.y + p.dy;
    if (p.t === 'block') { const id = T.addBlock(p.kind ?? 'plate', cx, cy, p.w, p.h, p.ang ?? 0, p.cham ?? 0.36, p.bolts ?? false); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); }
    else if (p.t === 'disc') T.addDisc(p.kind ?? 'disc', { x: cx, y: cy }, p.r);
    else if (p.t === 'grille') T.grille(cx, cy, p.w, p.h);
    else if (p.t === 'light') A.lightPts.push({ x: cx, y: cy });
    else if (p.t === 'insignia') A.insignia = { pos: { x: cx, y: cy }, kind: p.kind };
    else if (p.t === 'number') { A.numPos = { x: cx, y: cy }; A.numText = p.text; }
  }
  T.finish();
  return A;
}

// ---------- hullIR：车体规格 → 锚点 → 部件列 → 通用解释（楔形主箱+模块阵列+裙带+顶置挂载） ----------
type HullPart =
  | { t: 'block'; dx: number; dy: number; w: number; h: number; ang?: number; kind?: Kind; cham?: number; bolts?: boolean; role?: 'stripe' | 'armor2' | 'accent' }
  | { t: 'disc'; dx: number; dy: number; r: number; kind?: Kind }
  | { t: 'grille'; dx: number; dy: number; w: number; h: number }
  | { t: 'light'; dx: number; dy: number }
  | { t: 'insignia'; dx: number; dy: number; kind: number }
  | { t: 'number'; dx: number; dy: number; text: string };
interface HullSpec {
  family: string; scheme: Scheme; seed: number; wear: number; camo: boolean; twoTone: boolean;
  deck: Pt; hullW: number; hullH: number;
  form: { turret: 'gun' | 'rack' | 'none'; cabin: 'front' | 'mid'; skirt: boolean; modules: number };
  gear: { insignia: number; number: string };
}
interface HullIR { anchors: Record<'deck' | 'turret' | 'leg' | 'nose', Pt>; parts: HullPart[] }
function hullIR(spec: HullSpec): HullIR {
  const W = spec.hullW, H = spec.hullH, F = spec.form, parts: HullPart[] = [];
  parts.push({ t: 'block', dx: -W * 0.06, dy: H * 0.34, w: W * 0.94, h: H * 0.62, cham: 0.42, bolts: true }); // 主箱（楔）
  parts.push({ t: 'block', dx: W * 0.3, dy: H * 0.2, w: W * 0.34, h: H * 0.3, cham: 0.4 }); // 前上斜脸
  if (F.skirt) parts.push({ t: 'block', dx: -W * 0.02, dy: H * 0.78, w: W * 0.98, h: H * 0.3, cham: 0.3 }); // 底裙带
  const cabDx = F.cabin === 'front' ? W * 0.3 : W * 0.02;
  parts.push({ t: 'block', dx: cabDx, dy: H * 0.3, w: W * 0.3, h: H * 0.36, cham: 0.3 }); // 舱体
  parts.push({ t: 'block', dx: cabDx + W * 0.06, dy: H * 0.22, w: W * 0.2, h: H * 0.1, kind: 'frame' }); // 舱窗带
  parts.push({ t: 'light', dx: cabDx + W * 0.1, dy: H * 0.22 });
  for (let k = 0; k < F.modules; k++) parts.push({ t: 'block', dx: -W * 0.08 - k * W * 0.17, dy: H * 0.32, w: W * 0.14, h: H * 0.3, cham: 0.25 }); // 侧面模块阵列
  parts.push({ t: 'grille', dx: -W * 0.38, dy: H * 0.62, w: W * 0.3, h: H * 0.24 }); // 后侧散热栅
  if (F.turret === 'gun') {
    parts.push({ t: 'disc', dx: -W * 0.08, dy: -H * 0.02, r: W * 0.11 });
    parts.push({ t: 'block', dx: -W * 0.06, dy: -H * 0.14, w: W * 0.36, h: H * 0.24, cham: 0.4 }); // 炮塔
    parts.push({ t: 'block', dx: W * 0.38, dy: -H * 0.16, w: W * 0.62, h: H * 0.09, kind: 'cyl' }); // 主炮
    parts.push({ t: 'block', dx: W * 0.62, dy: -H * 0.16, w: W * 0.1, h: H * 0.13, kind: 'frame' }); // 炮口制退
  } else if (F.turret === 'rack') {
    parts.push({ t: 'block', dx: -W * 0.24, dy: -H * 0.02, w: W * 0.08, h: H * 0.14, kind: 'frame' }); // 架柱
    parts.push({ t: 'block', dx: W * 0.08, dy: -H * 0.02, w: W * 0.08, h: H * 0.14, kind: 'frame' });
    parts.push({ t: 'block', dx: -W * 0.08, dy: -H * 0.12, w: W * 0.52, h: H * 0.14, kind: 'frame' }); // 顶架
    parts.push({ t: 'block', dx: -W * 0.22, dy: -H * 0.25, w: W * 0.16, h: H * 0.16, kind: 'cyl' }); // 罐
    parts.push({ t: 'block', dx: 0, dy: -H * 0.25, w: W * 0.16, h: H * 0.16, kind: 'cyl' });
    parts.push({ t: 'block', dx: W * 0.13, dy: -H * 0.23, w: W * 0.14, h: H * 0.2 }); // 箱（坐架上）
  }
  parts.push({ t: 'insignia', dx: W * 0.28, dy: H * 0.52, kind: spec.gear.insignia });
  if (spec.gear.number) parts.push({ t: 'number', dx: -W * 0.3, dy: H * 0.36, text: spec.gear.number });
  parts.push({ t: 'light', dx: W * 0.44, dy: H * 0.44 });
  return { anchors: { deck: spec.deck, turret: { x: spec.deck.x - W * 0.06, y: spec.deck.y - H * 0.14 }, leg: { x: spec.deck.x, y: spec.deck.y + H }, nose: { x: spec.deck.x + W * 0.5, y: spec.deck.y + H * 0.3 } }, parts };
}
function renderHullIR(cv: MechaCanvas, ir: HullIR, spec: HullSpec): Anchors {
  const T = makeLayerTools(cv, spec.seed);
  const { A } = T, o = ir.anchors.deck;
  for (const p of ir.parts) {
    const cx = o.x + p.dx, cy = o.y + p.dy;
    if (p.t === 'block') { const id = T.addBlock(p.kind ?? 'plate', cx, cy, p.w, p.h, p.ang ?? 0, p.cham ?? 0.36, p.bolts ?? false); if (p.role) (A.colorRole ??= new Map()).set(id, p.role); }
    else if (p.t === 'disc') T.addDisc(p.kind ?? 'disc', { x: cx, y: cy }, p.r);
    else if (p.t === 'grille') T.grille(cx, cy, p.w, p.h);
    else if (p.t === 'light') A.lightPts.push({ x: cx, y: cy });
    else if (p.t === 'insignia') A.insignia = { pos: { x: cx, y: cy }, kind: p.kind };
    else if (p.t === 'number') { A.numPos = { x: cx, y: cy }; A.numText = p.text; }
  }
  T.finish();
  return A;
}

// ---------- headIR：规格 → 锚点 → 部件列 → 通用解释（构成四项 + 顶部变体槽） ----------
type HeadPart =
  | { t: 'block'; dx: number; dy: number; w: number; h: number; ang?: number; kind?: Kind; cham?: number; bolts?: boolean }
  | { t: 'disc'; dx: number; dy: number; r: number; kind?: Kind }
  | { t: 'grille'; dx: number; dy: number; w: number; h: number }
  | { t: 'light'; dx: number; dy: number };
interface HeadSpec {
  family: string; scheme: Scheme; seed: number; wear: number; camo: boolean;
  seat: Pt; w: number; h: number; tilt: number; twoTone: boolean;
  form: { crown: 'dome' | 'flat' | 'angular'; eye: 'slit' | 'dot' | 'visor'; brow: boolean; jaw: 'block' | 'respirator' | 'small'; ear: 'disc' | 'grille' | 'plate'; top: 'horn' | 'vfin' | 'antenna' | 'none'; cheekCable: boolean };
}
interface HeadIR { anchors: Record<'seat' | 'eye' | 'ear' | 'crown', Pt>; parts: HeadPart[] }
function headIR(spec: HeadSpec): HeadIR {
  const w = spec.w, h = spec.h, F = spec.form, parts: HeadPart[] = [];
  const chamC = F.crown === 'dome' ? 0.68 : F.crown === 'flat' ? 0.3 : 0.44;
  parts.push({ t: 'block', dx: 0, dy: h * 0.1, w: w * 0.54, h: h * 0.18, kind: 'frame' }); // 领圈（颈环，窄于盔体藏在颌下）
  parts.push({ t: 'block', dx: -w * 0.3, dy: -h * 0.52, w: w * 0.32, h: h * 0.64, cham: 0.4 }); // 后颅
  parts.push({ t: 'block', dx: -w * 0.02, dy: -h * 0.52, w: w * 0.92, h: h * 0.8, cham: chamC, bolts: true }); // 盔体（前缘让给面部叠层）
  if (F.crown === 'dome') parts.push({ t: 'block', dx: -w * 0.1, dy: -h * 0.94, w: w * 0.4, h: h * 0.18, ang: -0.06, cham: 0.5 }); // 圆顶小盖
  else parts.push({ t: 'block', dx: -w * 0.14, dy: -h * 0.9, w: w * 0.56, h: h * 0.24, ang: -0.1, cham: 0.4 }); // 顶盖
  if (F.brow) parts.push({ t: 'block', dx: w * 0.36, dy: -h * 0.68, w: w * 0.44, h: h * 0.15, ang: 0.1 }); // 眉檐压眼
  const eyeW = F.eye === 'visor' ? 0.56 : F.eye === 'dot' ? 0.24 : 0.34;
  parts.push({ t: 'block', dx: w * (F.eye === 'visor' ? 0.3 : 0.38), dy: -h * 0.5, w: w * eyeW, h: h * (F.eye === 'visor' ? 0.2 : 0.15), kind: 'frame' }); // 暗脸凹座（短、前置）
  if (F.eye === 'visor') parts.push({ t: 'block', dx: w * 0.32, dy: -h * 0.7, w: w * 0.48, h: h * 0.1 }); // 面罩上沿框
  if (F.eye === 'slit') { for (const ex of [0.33, 0.37, 0.41, 0.45, 0.49]) parts.push({ t: 'light', dx: w * ex, dy: -h * 0.5 }); } // 缝眼：五点叠成连续缝
  else if (F.eye === 'visor') { for (const ex of [0.3, 0.44]) parts.push({ t: 'light', dx: w * ex, dy: -h * 0.5 }); }
  else parts.push({ t: 'light', dx: w * 0.44, dy: -h * 0.5 });
  parts.push({ t: 'block', dx: w * 0.3, dy: -h * 0.27, w: w * 0.4, h: h * 0.26, ang: 0.22 }); // 颊板（斜面承眼座到颌）
  if (F.jaw === 'respirator') { // 肋管颏：装甲颌板打底 + 管尾接口盘 + 斜管 + 两道肋（动力服颏装置小一号）
    const js = spec.family === 'powersuit' ? 0.7 : 1;
    parts.push({ t: 'block', dx: w * 0.22, dy: -h * 0.12, w: w * 0.46, h: h * 0.3, ang: 0.1 }); // 颌板（装甲色，管子插在它上面）
    parts.push({ t: 'disc', dx: w * (0.3 - 0.176 * js), dy: -h * (0.14 + 0.096 * js), r: Math.min(w, h) * 0.11 * js, kind: 'disc' }); // 管尾接口盘
    parts.push({ t: 'block', dx: w * (spec.family === 'powersuit' ? 0.26 : 0.3), dy: -h * 0.14, w: w * 0.4 * js, h: h * 0.15 * js, ang: 0.5, kind: spec.family === 'powersuit' ? 'frame' : 'cyl' });
    parts.push({ t: 'block', dx: w * 0.33, dy: -h * 0.17, w: w * 0.37 * js, h: h * 0.045, ang: 0.5, kind: 'frame' });
    parts.push({ t: 'block', dx: w * 0.28, dy: -h * 0.11, w: w * 0.37 * js, h: h * 0.045, ang: 0.5, kind: 'frame' });
  } else if (F.jaw === 'block') parts.push({ t: 'block', dx: w * 0.27, dy: -h * 0.13, w: w * 0.4, h: h * 0.19, ang: 0.16 }); // 颌块后缩
  else parts.push({ t: 'block', dx: w * 0.25, dy: -h * 0.11, w: w * 0.34, h: h * 0.13, ang: 0.14 });
  if (F.ear === 'disc') { parts.push({ t: 'disc', dx: -w * 0.16, dy: -h * 0.48, r: w * 0.11 }); parts.push({ t: 'disc', dx: -w * 0.16, dy: -h * 0.48, r: w * 0.06 }); }
  else if (F.ear === 'grille') { parts.push({ t: 'grille', dx: -w * 0.07, dy: -h * 0.48, w: w * 0.36, h: h * 0.38 }); parts.push({ t: 'disc', dx: -w * 0.07, dy: -h * 0.48, r: w * 0.08 }); }
  else parts.push({ t: 'block', dx: -w * 0.08, dy: -h * 0.48, w: w * 0.3, h: h * 0.4, cham: 0.3 });
  if (F.top === 'horn') parts.push({ t: 'block', dx: w * 0.42, dy: -h * 0.9, w: w * 0.38, h: h * 0.1, ang: 0.25 });
  else if (F.top === 'vfin') { parts.push({ t: 'block', dx: w * 0.2, dy: -h * 1.22, w: w * 0.46, h: h * 0.11, ang: -0.52 }); parts.push({ t: 'block', dx: -w * 0.02, dy: -h * 1.14, w: w * 0.4, h: h * 0.1, ang: -0.68 }); }
  else if (F.top === 'antenna') { parts.push({ t: 'block', dx: -w * 0.18, dy: -h * 1.14, w: w * 0.035, h: h * 0.55, kind: 'cyl' }); parts.push({ t: 'disc', dx: -w * 0.18, dy: -h * 1.42, r: w * 0.04 }); parts.push({ t: 'block', dx: -w * 0.3, dy: -h * 1.05, w: w * 0.03, h: h * 0.3, kind: 'cyl' }); parts.push({ t: 'block', dx: w * 0.14, dy: -h * 0.96, w: w * 0.2, h: h * 0.12 }); }
  return { anchors: { seat: spec.seat, eye: { x: spec.seat.x + w * 0.4, y: spec.seat.y - h * 0.5 }, ear: { x: spec.seat.x - w * 0.06, y: spec.seat.y - h * 0.48 }, crown: { x: spec.seat.x, y: spec.seat.y - h } }, parts };
}
function renderHeadIR(cv: MechaCanvas, ir: HeadIR, spec: HeadSpec): Anchors {
  const T = makeLayerTools(cv, spec.seed);
  const { A } = T, s = ir.anchors.seat, ca = Math.cos(spec.tilt), sa = Math.sin(spec.tilt);
  const P = (dx: number, dy: number): Pt => ({ x: s.x + dx * ca - dy * sa, y: s.y + dx * sa + dy * ca });
  for (const p of ir.parts) {
    if (p.t === 'block') { const c = P(p.dx, p.dy); T.addBlock(p.kind ?? 'plate', c.x, c.y, p.w, p.h, spec.tilt + (p.ang ?? 0), p.cham ?? 0.36, p.bolts ?? false); }
    else if (p.t === 'disc') { const c = P(p.dx, p.dy); T.addDisc(p.kind ?? 'disc', c, p.r); }
    else if (p.t === 'grille') { const c = P(p.dx, p.dy); T.grille(c.x, c.y, p.w, p.h); }
    else if (p.t === 'light') { const c = P(p.dx, p.dy); A.lightPts.push(c); }
  }
  T.finish();
  return A;
}
export { SCHEMES, newCanvas, layout, finishRender, legIR, renderIR, makeLayerTools, armIR, renderArmIR, torsoIR, renderTorsoIR, hullIR, renderHullIR, headIR, renderHeadIR };
export type { Scheme, LegSpec, ArmSpec, TorsoSpec, HullSpec, HeadSpec, Anchors, Pt, MechaCanvas };
export { W as MECHA_W, H as MECHA_H };
