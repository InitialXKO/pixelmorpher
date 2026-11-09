// 机甲腿程序化生成 spike：验证「多次程序化生成叠加」能否复现参考图库机甲腿的共性。
// 管线 = 结构布局（关节/段）→ 剪影 → 分板（留缝见内框）→ 关节盘/活塞 → 场着色 → 细节 → 描边。
// 每一层都是一次独立的程序化生成，靠 owner/u/v 三张参数图叠加。
// 运行：bun spikes/mecha-part-patterns/gen-legs.mts
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
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
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

// ---------- 颜色 ----------
type RGB = [number, number, number];
interface Scheme { armor: RGB; armor2: RGB; frame: RGB; metal: RGB; chrome: RGB; accent: RGB; glow: RGB }
const SCHEMES: Record<string, Scheme> = {
  olive:  { armor: [106, 114, 62], armor2: [88, 96, 50], frame: [38, 40, 34], metal: [86, 88, 90], chrome: [178, 182, 184], accent: [216, 128, 40], glow: [255, 196, 92] },
  desert: { armor: [172, 152, 112], armor2: [150, 130, 94], frame: [52, 46, 38], metal: [92, 90, 86], chrome: [186, 184, 176], accent: [206, 110, 36], glow: [255, 200, 100] },
  slate:  { armor: [96, 106, 120], armor2: [78, 88, 102], frame: [34, 38, 46], metal: [80, 84, 92], chrome: [172, 180, 190], accent: [232, 126, 44], glow: [255, 176, 84] },
  rust:   { armor: [104, 84, 70], armor2: [88, 70, 58], frame: [36, 30, 26], metal: [84, 80, 78], chrome: [170, 166, 160], accent: [220, 122, 38], glow: [255, 188, 96] },
};
const shade = (c: RGB, f: number): RGB => [Math.max(0, Math.min(255, c[0] * f)), Math.max(0, Math.min(255, c[1] * f)), Math.max(0, Math.min(255, c[2] * f))];

// ---------- 画布与参数图 ----------
const W = 200, H = 280;
interface Inst { kind: 'plate' | 'disc' | 'rod' | 'cyl' | 'foot'; cx?: number; cy?: number; r?: number }
interface Canvas {
  col: Uint8ClampedArray; owner: Int16Array; u: Float32Array; v: Float32Array;
  sil: Uint8Array; insts: Inst[];
}
function newCanvas(): Canvas {
  return { col: new Uint8ClampedArray(W * H * 4), owner: new Int16Array(W * H).fill(-1), u: new Float32Array(W * H), v: new Float32Array(W * H), sil: new Uint8Array(W * H), insts: [] };
}
function fillShape(cv: Canvas, id: number, test: (x: number, y: number) => [boolean, number, number]) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [hit, u, v] = test(x + 0.5, y + 0.5);
    if (hit) { const i = y * W + x; cv.owner[i] = id; cv.u[i] = u; cv.v[i] = v; }
  }
}
function markSil(cv: Canvas, test: (x: number, y: number) => boolean) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (test(x + 0.5, y + 0.5)) cv.sil[y * W + x] = 1;
}
type Pt = { x: number; y: number };
function segFrame(a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  return { ux: dx / len, uy: dy / len, px: -dy / len, py: dx / len, len };
}
function quadTest(a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap: number) {
  const f = segFrame(a, b);
  return (x: number, y: number): [boolean, number, number] => {
    const rx = x - a.x, ry = y - a.y;
    const t = (rx * f.ux + ry * f.uy) / f.len;
    if (t < t0 || t > t1) return [false, 0, 0];
    const d = rx * f.px + ry * f.py;
    const hw = (wA + (wB - wA) * t) / 2;
    const local = (t - t0) / (t1 - t0);
    const shrink = gap / f.len / (t1 - t0);
    if (local < shrink || local > 1 - shrink) return [false, 0, 0];
    return [Math.abs(d) <= hw - gap * 0.4, d / hw, local];
  };
}
function silQuad(a: Pt, b: Pt, wA: number, wB: number) {
  const f = segFrame(a, b);
  return (x: number, y: number) => {
    const rx = x - a.x, ry = y - a.y;
    const t = (rx * f.ux + ry * f.uy) / f.len;
    if (t < 0 || t > 1) return false;
    const d = rx * f.px + ry * f.py;
    return Math.abs(d) <= (wA + (wB - wA) * t) / 2;
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

// ---------- 布局：关节链 + 分板 + 关节盘 + 活塞 ----------
interface LegSpec {
  topology: 'standard' | 'reverse';
  scheme: Scheme;
  seed: number;
  bend: number; // 膝部相位偏移（多腿阵列用）
}
function layout(cv: Canvas, spec: LegSpec) {
  const rnd = mulberry32(spec.seed);
  const hip: Pt = { x: 96, y: 26 };
  const knee: Pt = spec.topology === 'standard' ? { x: 106 + spec.bend, y: 128 } : { x: 64 + spec.bend, y: 126 };
  const ankle: Pt = { x: 92, y: 222 };
  const toe: Pt = { x: 148, y: 246 };
  const segs = [
    { a: hip, b: knee, wA: 62, wB: 46, plates: 2 },
    { a: knee, b: ankle, wA: 52, wB: 36, plates: 3 },
  ];
  // 剪影（整段 + 关节盘 + 脚）
  for (const s of segs) markSil(cv, silQuad(s.a, s.b, s.wA, s.wB));
  for (const j of [hip, knee, ankle]) markSil(cv, (x, y) => Math.hypot(x - j.x, y - j.y) <= 25);
  markSil(cv, silQuad({ x: ankle.x - 4, y: 234 }, { x: toe.x, y: 240 }, 26, 18));
  markSil(cv, silQuad({ x: ankle.x - 16, y: 238 }, { x: ankle.x + 4, y: 240 }, 22, 20));
  let id = 0;
  const plateOwners: number[] = [];
  for (const s of segs) {
    const step = 1 / s.plates;
    for (let p = 0; p < s.plates; p++) {
      cv.insts.push({ kind: 'plate' });
      fillShape(cv, id, quadTest(s.a, s.b, s.wA, s.wB, p * step, (p + 1) * step, 3.2));
      plateOwners.push(id); id++;
    }
  }
  // 脚（脚掌 + 脚趾两块）
  cv.insts.push({ kind: 'foot' }); fillShape(cv, id, quadTest({ x: ankle.x - 2, y: 233 }, { x: toe.x - 16, y: 239 }, 27, 22, 0, 1, 0.6)); id++;
  cv.insts.push({ kind: 'foot' }); fillShape(cv, id, quadTest({ x: toe.x - 18, y: 238 }, { x: toe.x + 6, y: 241 }, 21, 13, 0, 1, 0.6)); id++;
  // 小腿前护板：沿小腿前方另叠一块板（主战步行坦克式的大块胫甲）
  let stripeTarget = plateOwners[3];
  if (spec.topology === 'standard') {
    const f = segFrame(knee, ankle);
    const fx = -f.px, fy = -f.py; // 朝前面
    const ga = { x: knee.x + fx * 13, y: knee.y + fy * 13 + 8 };
    const gb = { x: ankle.x + fx * 10, y: ankle.y + fy * 10 - 10 };
    cv.insts.push({ kind: 'plate' });
    fillShape(cv, id, quadTest(ga, gb, 34, 26, 0, 1, 2.2));
    plateOwners.push(id); stripeTarget = id; id++;
  }
  // 活塞：大腿根在后侧、小腿根在前侧（参考图通例），跨关节连接两段
  const pistonPairs: [Pt, Pt][] = [
    [{ x: hip.x - 24, y: hip.y + 16 }, { x: knee.x - 24, y: knee.y - 20 }],
    [{ x: knee.x + 16, y: knee.y + 20 }, { x: ankle.x + 13, y: ankle.y - 28 }],
  ];
  if (spec.topology === 'reverse') { pistonPairs[0] = [{ x: hip.x + 18, y: hip.y + 14 }, { x: knee.x + 20, y: knee.y - 16 }]; pistonPairs[1] = [{ x: knee.x + 16, y: knee.y + 16 }, { x: ankle.x + 12, y: ankle.y - 24 }]; }
  for (const [a, b] of pistonPairs) {
    const mid = { x: a.x + (b.x - a.x) * 0.52, y: a.y + (b.y - a.y) * 0.52 };
    cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, lineTest(a, mid, 6.5)); id++;
    cv.insts.push({ kind: 'rod' }); fillShape(cv, id, lineTest(mid, b, 3.4)); id++;
  }
  // 关节盘（压在最上层）
  const discIds: number[] = [];
  for (const j of [hip, knee, ankle]) {
    const r = j === ankle ? 17 : 24;
    cv.insts.push({ kind: 'disc', cx: j.x, cy: j.y, r });
    fillShape(cv, id, discTest(j, r)); discIds.push(id); id++;
  }
  return { rnd, plateOwners, discIds, stripeTarget, joints: { hip, knee, ankle } };
}

// ---------- 着色与细节各层 ----------
function render(spec: LegSpec) {
  const cv = newCanvas();
  const { rnd, plateOwners, stripeTarget } = layout(cv, spec);
  const S = spec.scheme;
  const plateTint = new Map<number, number>();
  for (const pid of plateOwners) plateTint.set(pid, 0.92 + rnd() * 0.16);
  const stripePlate = stripeTarget; // 前护板（无护板时为小腿中板）
  const ventPlate = plateOwners[0]; // 大腿首板
  const set = (i: number, c: RGB) => { cv.col[i * 4] = c[0]; cv.col[i * 4 + 1] = c[1]; cv.col[i * 4 + 2] = c[2]; cv.col[i * 4 + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!cv.sil[i]) continue;
    const o = cv.owner[i], inst = o >= 0 ? cv.insts[o] : null;
    const u = cv.u[i], v = cv.v[i];
    if (!inst) { set(i, S.frame); continue; } // 板缝露内框
    if (inst.kind === 'plate' || inst.kind === 'foot') {
      // 柱面场（横向）+ 纵向渐变 + 板间色差
      let f = (0.78 + 0.34 * (1 - Math.abs(u)) ** 1.4) * (1.04 - 0.13 * v) * (plateTint.get(o) ?? 1);
      let c = shade(o % 2 ? S.armor : S.armor2, f);
      if (inst.kind === 'foot') c = shade(S.armor2, f * 0.82);
      // 警示条纹：小腿中板斜带两条
      if (o === stripePlate && v > 0.34 && v < 0.62 && ((x + y) % 26) < 13) c = shade(S.accent, 0.92 + 0.1 * (1 - Math.abs(u)));
      // 通风栅：大腿首板顶部横排短缝
      if (o === ventPlate && v > 0.1 && v < 0.3 && Math.abs(u) < 0.55 && (x % 9) < 5 && (y % 7) < 2.4) c = shade(S.frame, 0.8);
      // 面板线：板内一条横线
      if (Math.abs(v - 0.78) < 0.012) c = shade(c, 0.62);
      set(i, c);
    } else if (inst.kind === 'disc') {
      const rr = v; // 0 中心 → 1 边缘
      let c = shade(S.metal, rr < 0.34 ? 0.72 : rr < 0.72 ? 1.0 : 0.66);
      if (rr < 0.34) c = shade(S.armor2, 0.9);
      if (rr < 0.13) c = shade(S.chrome, 0.85); // 毂心螺栓
      if (rr > 0.9) c = shade(c, 0.55);
      set(i, shade(c, 0.92 + 0.14 * (1 - Math.abs(u))));
    } else if (inst.kind === 'cyl') {
      set(i, shade(S.metal, 0.55 + 0.3 * (1 - Math.abs(u))));
    } else if (inst.kind === 'rod') {
      set(i, shade(S.chrome, 0.72 + 0.42 * (1 - Math.abs(u)))); // 活塞杆高光
    }
  }
  // 螺栓点：沿板边缘等距（用 owner 边界 + 周期采样近似）
  for (let y = 2; y < H - 2; y += 1) for (let x = 2; x < W - 2; x += 1) {
    const i = y * W + x, o = cv.owner[i];
    if (o < 0 || cv.insts[o].kind !== 'plate') continue;
    if ((x * 7 + y * 13) % 61 !== 0) continue;
    if (cv.owner[i - W] === o && cv.owner[i + W] === o && cv.owner[i - 1] === o && cv.owner[i + 1] === o) {
      const nearGap = cv.owner[i - W * 3] !== o || cv.owner[i + W * 3] !== o || cv.owner[i - 3] !== o || cv.owner[i + 3] !== o;
      if (nearGap) set(i, shade(S.frame, 1.5));
    }
  }
  // 棱线：板的上缘提亮、下缘压暗（相邻 owner 不同处）
  for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = cv.owner[i];
    if (o < 0) continue;
    const cur: RGB = [cv.col[i * 4], cv.col[i * 4 + 1], cv.col[i * 4 + 2]];
    if (cv.owner[i - W] !== o) set(i, shade(cur, 1.22));
    if (cv.owner[i + W] !== o) set(i, shade(cur, 0.68));
  }
  // 描边：剪影外缘 1px 近黑
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!cv.sil[i]) continue;
    if (!cv.sil[i - 1] || !cv.sil[i + 1] || !cv.sil[i - W] || !cv.sil[i + W]) set(i, [16, 18, 20]);
  }
  // 信号灯：大腿板一枚亮点
  return { cv, stripePlate };
}

// ---------- 输出 ----------
mkdirSync(new URL('./out', import.meta.url).pathname, { recursive: true });
const OUT = new URL('./out/', import.meta.url).pathname;
function saveLeg(name: string, spec: LegSpec) {
  const { cv } = render(spec);
  writeFileSync(OUT + name + '.png', encodePNG(W, H, cv.col));
}
saveLeg('leg-olive', { topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 0 });
saveLeg('leg-desert', { topology: 'standard', scheme: SCHEMES.desert, seed: 23, bend: 6 });
saveLeg('leg-slate-reverse', { topology: 'reverse', scheme: SCHEMES.slate, seed: 37, bend: 0 });
saveLeg('leg-rust', { topology: 'standard', scheme: SCHEMES.rust, seed: 41, bend: -6 });
// 双腿站姿：同种子单元 ×2（一正一侧弯）并排——验证单元复用
{
  const a = render({ topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 0 }).cv;
  const b = render({ topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 14 }).cv;
  const w2 = W * 2, buf = new Uint8ClampedArray(w2 * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4;
    if (a.col[s + 3]) buf.set(a.col.subarray(s, s + 4), (y * w2 + x) * 4);
    if (b.col[s + 3]) buf.set(b.col.subarray(s, s + 4), (y * w2 + x + W - 30) * 4);
  }
  writeFileSync(OUT + 'pair-olive.png', encodePNG(w2, H, buf));
}
console.log('done');
