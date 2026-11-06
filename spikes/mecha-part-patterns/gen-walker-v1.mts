// gen-walker-v1.mts — 载具型整机 v1：车体组（楔箱）+ 炮塔/主炮挂载，配既有腿（模式库换原型组装）
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

// ---------- 车体组 + 挂载（楔箱型，主战式） ----------
// 锚：腿髋线 y=234；车体底沿 252 压腿根，顶面甲板 130 为挂载面
const T = makeLayer();
const HULL = [[70, 130], [215, 130], [315, 225], [300, 252], [75, 252]];
T.add('plate', polyTest(HULL.map(([x, y]) => ({ x, y }))));                    // 车体主积（楔箱：前斜面一整面）
T.blk('plate2', 150, 122, 150, 18, 0, 0.2);                                    // 顶甲板
const panelA = T.blk('plate2', 138, 186, 118, 76, 0);                          // 侧面板 A（编号归此件）
T.blk('plate', 232, 190, 96, 68, 0);                                           // 侧面板 B
T.blk('frame', 120, 168, 54, 40, 0);                                           // 侧挂舱框
T.blk('vent', 120, 168, 46, 32, 0);                                            // 侧挂舱肋面
T.blk('frame', 182, 248, 236, 14, 0, 0.15);                                    // 底裙带
T.blk('metal', 288, 232, 30, 16, 0.35);                                        // 前下小件（灯座）
T.blk('accent', 292, 230, 12, 5, 0.35);                                        // 车灯（强调色小件）
// 炮塔（挂载：塔座 + 塔体 + 传感器 + 天线）
T.blk('frame', 152, 112, 66, 20, 0);                                           // 塔座
T.blk('plate', 152, 88, 58, 30, 0, 0.3);                                       // 塔体
T.blk('plate2', 168, 72, 30, 12, 0);                                           // 塔顶盖
T.add('metal', discTest({ x: 140, y: 70 }, 8));                                // 传感器球
T.blk('metal', 128, 48, 4, 26, 0.06, 0.2);                                     // 天线
// 主炮（挂载：自车体前下出筒）
T.blk('frame', 296, 214, 34, 22, 0);                                           // 炮座
T.blk('metal', 322, 214, 52, 13, 0, 0.15);                                     // 炮筒
T.blk('metal', 352, 214, 18, 19, 0, 0.15);                                     // 制退节

// ---------- 合成 ----------
const FONT: Record<string, string[]> = { M: ['101', '111', '111', '101', '101'], '-': ['000', '000', '111', '000', '000'], '7': ['111', '001', '010', '010', '010'], '1': ['010', '010', '010', '010', '010'], '0': ['111', '101', '101', '101', '111'], T: ['111', '010', '010', '010', '010'] };
const panelHook = (L: Layer) => (col: Uint8ClampedArray) => {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = L.owner[i]; if (o < 0) continue;
    const k = L.insts[o].kind; if (k !== 'plate' && k !== 'plate2') continue;
    const v = L.vv[i];
    const s1 = 0.36 + ((o * 29) % 7 - 3) * 0.02, s2 = 0.68 + ((o * 41) % 7 - 3) * 0.02;
    if (Math.abs(v - s1) < 0.016 || Math.abs(v - s2) < 0.016) { col[i * 4] *= 0.74; col[i * 4 + 1] *= 0.74; col[i * 4 + 2] *= 0.74; }
  }
};
const midOut = renderLayer(T, 1, (col) => {
  panelHook(T)(col);
  const setPx = (i: number, c: RGB) => { col[i * 4] = c[0]; col[i * 4 + 1] = c[1]; col[i * 4 + 2] = c[2]; col[i * 4 + 3] = 255; };
  const drawText = (text: string, cx0: number, cy: number, clip: number) => { let cx = cx0; for (const ch of text) { const g = FONT[ch]; if (g) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r][c] === '1') for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const x = cx + c * 2 + dx, y = cy + r * 2 + dy, i = y * W + x; if (T.owner[i] === clip) setPx(i, S.decal); } cx += 8; } };
  drawText('M-77', 100, 168, panelA);
  drawText('10T', 100, 196, panelA);
});
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
castShadow(T.sil);
over(midOut);
writeFileSync(new URL('./out/walker-v1-olive.png', import.meta.url).pathname, encodePNG(W, H, fin));
console.log('walker v1 done');
