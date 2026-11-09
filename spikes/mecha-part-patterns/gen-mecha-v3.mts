// gen-mecha-v3.mts — 整机组合 v3：头/躯干按补册模式与配方重做 + 层间投影补全 + 面板线网
import { writeFileSync, readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

type RGB = [number, number, number];
type Pt = { x: number; y: number };
const S = { armor: [86, 92, 50] as RGB, armor2: [69, 76, 40] as RGB, frame: [35, 37, 32] as RGB, metal: [80, 82, 84] as RGB, chrome: [186, 190, 192] as RGB, accent: [219, 130, 40] as RGB, glow: [255, 198, 94] as RGB, decal: [226, 224, 205] as RGB };
const shade = (c: RGB, f: number): RGB => [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];

const crcTable = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf: Uint8Array) { let c = -1; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type: string, data: Uint8Array) { const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, data.length); const td = new Uint8Array(4 + data.length); td.set([...type].map((ch) => ch.charCodeAt(0)), 0); td.set(data, 4); const crc = new Uint8Array(4); new DataView(crc.buffer).setUint32(0, crc32(td)); return [len, td, crc]; }
function encodePNG(w: number, h: number, rgba: Uint8ClampedArray) {
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 4)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1); }
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  for (const c of chunk('IHDR', ihdr)) parts.push(c);
  for (const c of chunk('IDAT', deflateSync(raw))) parts.push(c);
  for (const c of chunk('IEND', new Uint8Array(0))) parts.push(c);
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}
function decodePNG(path: string): { w: number; h: number; rgba: Uint8ClampedArray } {
  const buf = readFileSync(path); let off = 8, w = 0, h = 0; const idats: Buffer[] = [];
  while (off < buf.length) { const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8); if (type === 'IHDR') { w = buf.readUInt32BE(off + 8); h = buf.readUInt32BE(off + 12); } if (type === 'IDAT') idats.push(buf.subarray(off + 8, off + 8 + len)); off += 12 + len; }
  const raw = inflateSync(Buffer.concat(idats)); const rgba = new Uint8ClampedArray(w * h * 4); const stride = 1 + w * 4;
  for (let y = 0; y < h; y++) { const f = raw[y * stride]; for (let x = 0; x < w * 4; x++) { const i = y * w * 4 + x; const a = x >= 4 ? rgba[i - 4] : 0, b = y > 0 ? rgba[i - w * 4] : 0, c = x >= 4 && y > 0 ? rgba[i - w * 4 - 4] : 0; let v = raw[y * stride + 1 + x]; if (f === 1) v = (v + a) & 255; else if (f === 2) v = (v + b) & 255; else if (f === 3) v = (v + ((a + b) >> 1)) & 255; else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; } rgba[i] = v; } }
  return { w, h, rgba };
}

// ---------- 算子层（LIBRARY L0）+ 层工厂 ----------
const W = 380, H = 730;
type Kind = 'plate' | 'plate2' | 'frame' | 'metal' | 'vent' | 'eye' | 'accent';
interface Inst { kind: Kind; test: (x: number, y: number) => [boolean, number, number] }
function blockPoly(cx: number, cy: number, w: number, h: number, ang: number, cham = 0.36): Pt[] {
  const ca = Math.cos(ang), sa = Math.sin(ang), lx = w / 2, ly = h / 2, c = (Math.min(w, h) * cham) / 2;
  const raw: Pt[] = [{ x: -lx + c, y: -ly }, { x: lx - c, y: -ly }, { x: lx, y: -ly + c }, { x: lx, y: ly - c }, { x: lx - c, y: ly }, { x: -lx + c, y: ly }, { x: -lx, y: ly - c }, { x: -lx, y: -ly + c }];
  return raw.map((q) => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
}
function polyTest(pts: Pt[]) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return (x: number, y: number): [boolean, number, number] => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside; }
    return [inside, (x - x0) / Math.max(1, x1 - x0), (y - y0) / Math.max(1, y1 - y0)];
  };
}
function cableTest(p0: Pt, p1: Pt, p2: Pt, r: number) {
  const pts: Pt[] = [];
  for (let s = 0; s <= 24; s++) { const t = s / 24, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t; pts.push({ x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y }); }
  return (x: number, y: number): [boolean, number, number] => { let d = 1e9; for (const p of pts) d = Math.min(d, Math.hypot(x - p.x, y - p.y)); return [d <= r, 0.5, d / r]; };
}
function discTest(c: Pt, r: number) { return (x: number, y: number): [boolean, number, number] => { const d = Math.hypot(x - c.x, y - c.y); return [d <= r, (x - c.x) / r * 0.5 + 0.5, (y - c.y) / r * 0.5 + 0.5]; }; }
interface Layer { owner: Int16Array; uu: Float32Array; vv: Float32Array; sil: Uint8Array; insts: Inst[]; add: (k: Kind, t: Inst['test']) => number; blk: (k: Kind, cx: number, cy: number, w: number, h: number, ang?: number, cham?: number) => number }
function makeLayer(): Layer {
  const L: Layer = { owner: new Int16Array(W * H).fill(-1), uu: new Float32Array(W * H), vv: new Float32Array(W * H), sil: new Uint8Array(W * H), insts: [],
    add(k, test) { const id = L.insts.length; L.insts.push({ kind: k, test }); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [hit, u, v] = test(x, y); if (hit) { const i = y * W + x; L.owner[i] = id; L.uu[i] = u; L.vv[i] = v; L.sil[i] = 1; } } return id; },
    blk(k, cx, cy, w, h, ang = 0, cham = 0.36) { return L.add(k, polyTest(blockPoly(cx, cy, w, h, ang, cham))); } };
  return L;
}
function renderLayer(L: Layer, dim = 1, decorate?: (col: Uint8ClampedArray) => void): Uint8ClampedArray {
  const col = new Uint8ClampedArray(W * H * 4);
  const setPx = (i: number, c: RGB) => { col[i * 4] = Math.min(255, c[0] * dim); col[i * 4 + 1] = Math.min(255, c[1] * dim); col[i * 4 + 2] = Math.min(255, c[2] * dim); col[i * 4 + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = L.owner[i]; if (o < 0) continue;
    const k = L.insts[o].kind, v = L.vv[i];
    if (k === 'plate' || k === 'plate2') { const bands = [1.04, 0.95, 0.88, 0.8]; setPx(i, shade(k === 'plate' ? S.armor : S.armor2, bands[Math.min(3, Math.floor(v * 4))] * (1 + ((o * 37) % 5 - 2) * 0.012))); }
    else if (k === 'frame') setPx(i, shade(S.frame, 0.85 + 0.3 * v));
    else if (k === 'metal') setPx(i, shade(S.metal, 0.8 + 0.35 * v));
    else if (k === 'vent') setPx(i, y % 5 < 2 ? shade(S.frame, 0.55) : shade(S.metal, 0.75));
    else if (k === 'eye') setPx(i, S.glow);
    else if (k === 'accent') setPx(i, S.accent);
  }
  if (decorate) decorate(col);
  const out = new Uint8ClampedArray(col);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = L.owner[i]; if (o < 0) continue;
    const n = (dx: number, dy: number) => { const nx = x + dx, ny = y + dy; return nx < 0 || ny < 0 || nx >= W || ny >= H ? -2 : L.owner[ny * W + nx]; };
    const c: RGB = [col[i * 4], col[i * 4 + 1], col[i * 4 + 2]];
    let f = 0;
    if (n(0, -1) !== o) f = 1.22; else if (n(0, 1) !== o) f = 0.62; else if (n(1, 0) !== o) f = 1.1; else if (n(-1, 0) !== o) f = 0.8;
    if (f) { out[i * 4] = Math.min(255, c[0] * f); out[i * 4 + 1] = Math.min(255, c[1] * f); out[i * 4 + 2] = Math.min(255, c[2] * f); out[i * 4 + 3] = 255; }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!L.sil[i]) continue;
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx < 0 || ny < 0 || nx >= W || ny >= H || !L.sil[ny * W + nx]; });
    if (edge) { out[i * 4] = 14; out[i * 4 + 1] = 14; out[i * 4 + 2] = 12; out[i * 4 + 3] = 255; }
  }
  return out;
}

// ---------- 远臂（躯干后层） ----------
const F = makeLayer();
F.blk('frame', 190, 130, 30, 72, -0.08);            // 上臂内框
F.blk('plate2', 196, 128, 46, 48, -0.06);          // 上臂板
F.add('metal', discTest({ x: 188, y: 164 }, 11));  // 肘盘
F.blk('plate', 184, 202, 52, 54, 0.04);            // 前臂护板
F.blk('plate2', 184, 250, 32, 28, 0.04);           // 拳
F.blk('plate', 196, 88, 78, 54, -0.02);            // 肩壳
F.blk('plate2', 194, 62, 66, 22, -0.02);           // 肩顶板

// ---------- 躯干组 + 头组（中层，按补册模式与配方） ----------
const T = makeLayer();
T.blk('frame', 112, 104, 64, 104, 0.02);              // 背侧箱（贴合胸后缘）
const chest = T.blk('plate', 196, 128, 156, 96, 0);   // 胸主面板（主导，编号归此件）
T.blk('plate2', 202, 80, 138, 44, 0);                 // 胸顶板
T.blk('frame', 128, 140, 44, 50, 0);                  // 胸侧栅框
T.blk('vent', 128, 140, 36, 42, 0);                   // 胸侧栅（带框横槽栅）
T.blk('accent', 252, 100, 44, 8, 0);                  // 胸前强调条
T.blk('frame', 198, 180, 128, 15, 0);                 // 腰带（暗带）
T.blk('metal', 234, 180, 20, 11, 0);                  // 腰带扣
T.blk('plate2', 228, 200, 96, 38, -0.01);             // 腰下前板
T.blk('plate2', 166, 200, 60, 28, 0.02);              // 腰侧板
T.blk('plate', 192, 240, 138, 52, 0);                 // 骨盆主块
T.blk('plate2', 244, 238, 62, 42, 0.02);              // 骨盆前板
T.blk('accent', 246, 259, 58, 6, 0);                  // 骨盆前带（贴花级）
T.add('frame', cableTest({ x: 148, y: 166 }, { x: 168, y: 208 }, { x: 218, y: 226 }, 7)); // 躯干粗管线缆（heavy 级变体）
T.add('metal', discTest({ x: 148, y: 166 }, 9));      // 线缆接头（胸侧）
T.add('metal', discTest({ x: 218, y: 226 }, 9));      // 线缆接头（骨盆）
const skirtSide = T.blk('plate', 156, 272, 76, 36, 0.06);   // 侧裙
const skirtFront = T.blk('plate', 242, 274, 58, 44, 0.1);   // 前裙（人字纹归此件）
// 头组：盔体 + 眉檐 + 凹座眼（楔）+ 肋管颏 + 侧栅 + 鞭天线（变体槽 = heavy）
T.blk('frame', 224, 64, 24, 18, 0);                   // 颈
T.blk('plate', 234, 36, 58, 44, 0.02, 0.42);          // 盔体
T.blk('plate2', 220, 20, 40, 20, 0.02);               // 盔顶后板
T.blk('frame', 214, 38, 28, 26, 0);                   // 侧栅框（颌轴侧件，与耳盘二选一）
T.blk('vent', 214, 38, 22, 20, 0);                    // 侧栅
T.blk('plate2', 250, 28, 36, 12, 0.05);               // 眉檐（前出）
T.blk('frame', 250, 39, 32, 10, 0.02);                // 眼凹座
T.blk('eye', 252, 39, 26, 6, 0.02, 0.2);              // 眼（楔光带）
T.blk('plate2', 254, 52, 30, 15, 0.1);                // 颊板
T.blk('vent', 258, 62, 26, 11, 0.5);                  // 肋管（口格栅）
T.blk('plate', 264, 72, 20, 12, 0.2);                 // 颏块（前凸）
T.blk('metal', 204, 12, 5, 22, 0.12, 0.2);            // 鞭天线

// ---------- 近臂（躯干前层） ----------
const N = makeLayer();
N.add('metal', discTest({ x: 232, y: 92 }, 13));   // 肩关节盘（壳下半露）
N.blk('frame', 230, 130, 30, 78, 0.1);             // 上臂内框
N.blk('plate', 238, 122, 52, 50, 0.1);             // 上臂板 1
N.blk('plate2', 244, 152, 48, 42, 0.08);           // 上臂板 2
N.add('metal', discTest({ x: 246, y: 170 }, 12));  // 肘盘
N.blk('plate2', 246, 170, 30, 26, 0.05);           // 肘块
N.blk('plate', 234, 208, 62, 62, -0.05);           // 前臂大护板
N.blk('frame', 250, 200, 36, 44, -0.03);           // 前臂内侧
N.blk('plate2', 234, 256, 38, 30, 0.04);           // 拳掌块
N.blk('plate', 250, 258, 18, 26, 0.04);            // 指节前块
N.blk('plate', 230, 84, 90, 62, -0.03);            // 肩壳（整机最大单块之一）
N.blk('plate2', 228, 56, 78, 24, -0.03);           // 肩顶板
N.blk('plate2', 264, 94, 30, 44, 0.08);            // 肩前檐

// ---------- 合成 ----------
const FONT: Record<string, string[]> = { M: ['101', '111', '111', '101', '101'], '-': ['000', '000', '111', '000', '000'], '4': ['101', '101', '111', '001', '001'], '6': ['011', '100', '110', '101', '010'] };
const panelHook = (L: Layer) => (col: Uint8ClampedArray) => {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = L.owner[i]; if (o < 0) continue;
    const k = L.insts[o].kind; if (k !== 'plate' && k !== 'plate2') continue;
    const v = L.vv[i];
    if (Math.abs(v - 0.36) < 0.016 || Math.abs(v - 0.68) < 0.016) { col[i * 4] *= 0.74; col[i * 4 + 1] *= 0.74; col[i * 4 + 2] *= 0.74; }
  }
};
const farOut = renderLayer(F, 0.78, panelHook(F));
const midOut = renderLayer(T, 1, (col) => { panelHook(T)(col);
  const setPx = (i: number, c: RGB) => { col[i * 4] = c[0]; col[i * 4 + 1] = c[1]; col[i * 4 + 2] = c[2]; col[i * 4 + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (T.owner[i] === skirtFront && T.vv[i] > 0.45 && ((x + y) % 16) < 6) setPx(i, S.accent); }
  const text = 'M-46'; let cx = 138; const cy = 104; // 落胸主面板左上可见区（右前被近臂覆盖，编号按板扫描落点同理）
  for (const ch of text) { const g = FONT[ch]; if (g) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r][c] === '1') for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const x = cx + c * 2 + dx, y = cy + r * 2 + dy, i = y * W + x; if (T.owner[i] === chest) setPx(i, S.decal); } cx += 8; }
});
const nearOut = renderLayer(N, 1, panelHook(N));
const leg = decodePNG(new URL('./out/v29-leg-olive.png', import.meta.url).pathname);
const fin = new Uint8ClampedArray(W * H * 4);
const blit = (ox: number, oy: number, dark: number, desat: number) => {
  for (let y = 0; y < leg.h; y++) for (let x = 0; x < leg.w; x++) {
    const si = (y * leg.w + x) * 4; if (!leg.rgba[si + 3]) continue;
    const tx = x + ox, ty = y + oy; if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    const di = (ty * W + tx) * 4; let r = leg.rgba[si], g = leg.rgba[si + 1], b = leg.rgba[si + 2];
    const gray = (r + g + b) / 3; r = (r + (gray - r) * desat) * dark; g = (g + (gray - g) * desat) * dark; b = (b + (gray - b) * desat) * dark;
    fin[di] = r; fin[di + 1] = g; fin[di + 2] = b; fin[di + 3] = 255;
  }
};
const over = (src: Uint8ClampedArray) => { for (let i = 0; i < W * H; i++) if (src[i * 4 + 3]) { fin[i * 4] = src[i * 4]; fin[i * 4 + 1] = src[i * 4 + 1]; fin[i * 4 + 2] = src[i * 4 + 2]; fin[i * 4 + 3] = 255; } };
const castShadow = (silL: Uint8Array, dx = 10, dy = 14, f = 0.62) => {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x - dx, sy = y - dy; if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    if (silL[sy * W + sx] && fin[(y * W + x) * 4 + 3]) { const di = (y * W + x) * 4; fin[di] *= f; fin[di + 1] *= f; fin[di + 2] *= f; }
  }
};
blit(40, 196, 0.7, 0.3);
blit(0, 190, 1, 0);
castShadow(F.sil);
over(farOut);
castShadow(T.sil);
over(midOut);
castShadow(N.sil, 8, 10, 0.66);
over(nearOut);
writeFileSync(new URL('./out/mecha-v3-olive.png', import.meta.url).pathname, encodePNG(W, H, fin));
console.log('mecha v3 done');
