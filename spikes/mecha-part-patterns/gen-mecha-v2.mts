// gen-mecha-v2.mts — 整机组合 v2：+ 肩/臂/手模式（三层合成：远臂 / 躯干 / 近臂）
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

// ---------- 躯干组 + 头组（中层） ----------
const T = makeLayer();
T.blk('frame', 92, 100, 58, 104, 0.02);
T.blk('frame', 196, 200, 96, 34, 0);
T.blk('plate2', 168, 202, 62, 30, 0.02);
T.blk('plate', 192, 246, 128, 54, 0);
T.blk('plate2', 242, 244, 62, 44, 0.02);
const skirtSide = T.blk('plate', 158, 280, 76, 36, 0.06);
const skirtFront = T.blk('plate', 240, 282, 58, 44, 0.1);
T.blk('plate2', 226, 176, 104, 54, -0.01);
const chest = T.blk('plate', 196, 132, 156, 100, 0);
T.blk('plate2', 202, 82, 138, 46, 0);
T.blk('vent', 128, 126, 40, 56, 0);
T.blk('accent', 252, 104, 44, 8, 0);
T.blk('frame', 210, 66, 26, 20, 0);
T.blk('plate2', 238, 68, 34, 16, 0.03);
T.blk('plate', 224, 42, 66, 48, 0.02);
T.blk('plate2', 248, 44, 28, 34, 0.02);
T.blk('eye', 247, 40, 22, 5, 0);
T.add('metal', discTest({ x: 206, y: 46 }, 10));
T.blk('metal', 200, 8, 6, 26, 0.1, 0.2);

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
const farOut = renderLayer(F, 0.78);
const midOut = renderLayer(T, 1, (col) => {
  const setPx = (i: number, c: RGB) => { col[i * 4] = c[0]; col[i * 4 + 1] = c[1]; col[i * 4 + 2] = c[2]; col[i * 4 + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (T.owner[i] === skirtFront && T.vv[i] > 0.45 && ((x + y) % 16) < 6) setPx(i, S.accent); }
  const text = 'M-46'; let cx = 226; const cy = 118;
  for (const ch of text) { const g = FONT[ch]; if (g) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r][c] === '1') for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const x = cx + c * 2 + dx, y = cy + r * 2 + dy, i = y * W + x; if (T.owner[i] === chest) setPx(i, S.decal); } cx += 8; }
});
const nearOut = renderLayer(N, 1);
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
blit(40, 196, 0.7, 0.3);
blit(0, 190, 1, 0);
over(farOut);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const sx = x - 10, sy = y - 14; if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
  if (T.sil[sy * W + sx] && fin[(y * W + x) * 4 + 3]) { const di = (y * W + x) * 4; fin[di] *= 0.62; fin[di + 1] *= 0.62; fin[di + 2] *= 0.62; }
}
over(midOut);
over(nearOut);
writeFileSync(new URL('./out/mecha-v2-olive.png', import.meta.url).pathname, encodePNG(W, H, fin));
console.log('mecha v2 done');
