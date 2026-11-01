// 画布算子验收探针：场擦除 field_wipe + 块位移 block_shift
// 覆盖：
//  A) 覆盖函数断言（逐形状：值域、progress 单调、iris 中心先行、blinds
//     条带结构、diamond 对称、threshold 同种子同场/异种子异场）
//  B) 编辑器/包内纯函数逐点对拍（抽运行时模板 fwKeepAt/bsOffsetAt 原文
//     在桩环境求值，与编辑器 fieldWipeKeep/blockShiftOffsetAt 同输入比对）
//  C) 编辑器引擎端到端（假 DOM 跑真 applyCanvasModifiers：wipe 全擦/
//     全保留/中心先行、关键帧插值驱动 progress、block_shift 全图映射与
//     纯函数逐像素一致、rows 行带门控、strength 包络上限）
//  D) 结构断言（包内 uEffect 10/11 分支与链路接线、Definition 注册）
import {
  applyCanvasModifiers,
  resolveCanvasModifierParams,
  fieldWipeCoverage,
  fieldWipeKeep,
  blockShiftOffsetAt,
} from '../src/lib/engine/canvas-modifiers';
import { buildRuntimeHtml } from '../src/lib/proc-runtime/runtime-template';
import { CANVAS_MODIFIER_DEFINITIONS, createDefaultCanvasModifier } from '../src/lib/types';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗ FAIL:', msg); }
};

// ================= 假 DOM（与 verify-canvas-effects-audit 同款最小实现） =================
class FakeImageData {
  data: Uint8ClampedArray; width: number; height: number;
  constructor(data: Uint8ClampedArray, w: number, h: number) { this.data = data; this.width = w; this.height = h; }
}
class FakeCanvas {
  _w = 0; _h = 0; pixels = new Uint8ClampedArray(0); ctx: FakeCtx | null = null;
  get width() { return this._w; }
  set width(v: number) { this._w = v; this.pixels = new Uint8ClampedArray(this._w * this._h * 4); }
  get height() { return this._h; }
  set height(v: number) { this._h = v; this.pixels = new Uint8ClampedArray(this._w * this._h * 4); }
  getContext() { if (!this.ctx) this.ctx = new FakeCtx(this); return this.ctx; }
}
class FakeCtx {
  canvas: FakeCanvas; globalCompositeOperation = 'source-over'; globalAlpha = 1; fillStyle = '#000000';
  constructor(c: FakeCanvas) { this.canvas = c; }
  save() {} restore() {}
  getImageData(x: number, y: number, w: number, h: number) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      const src = ((y + row) * this.canvas.width + x) * 4;
      out.set(this.canvas.pixels.subarray(src, src + w * 4), row * w * 4);
    }
    return new FakeImageData(out, w, h);
  }
  putImageData(img: FakeImageData, dx: number, dy: number) {
    for (let row = 0; row < img.height; row++) {
      const dst = ((dy + row) * this.canvas.width + dx) * 4;
      this.canvas.pixels.set(img.data.subarray(row * img.width * 4, (row + 1) * img.width * 4), dst);
    }
  }
  drawImage(src: FakeCanvas, dx = 0, dy = 0) {
    const d = this.canvas.pixels, s = src.pixels;
    const w = Math.min(src.width, this.canvas.width - dx), h = Math.min(src.height, this.canvas.height - dy);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = (y * src.width + x) * 4, di = ((y + dy) * this.canvas.width + (x + dx)) * 4;
      const sa = (s[si + 3] / 255) * this.globalAlpha;
      const da = d[di + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) { d[di] = d[di + 1] = d[di + 2] = d[di + 3] = 0; continue; }
      for (let c = 0; c < 3; c++) d[di + c] = Math.round((s[si + c] * sa + d[di + c] * da * (1 - sa)) / oa);
      d[di + 3] = Math.round(oa * 255);
    }
  }
  clearRect(x: number, y: number, w: number, h: number) {
    for (let row = 0; row < h; row++) {
      const i = ((y + row) * this.canvas.width + x) * 4;
      this.canvas.pixels.fill(0, i, i + w * 4);
    }
  }
}
(globalThis as any).document = { createElement: () => new FakeCanvas() };
(globalThis as any).ImageData = FakeImageData;

const mkTrack = (type: string, params: Record<string, unknown>, keyframes: unknown[] = []) => ({
  id: `t-${type}`, name: type, type,
  modifiers: [{ id: `m-${type}`, type, enabled: true, collapsed: false, params }],
  keyframes, visible: true, enabled: true,
}) as any;

function runChain(w: number, h: number, fill: (px: Uint8ClampedArray) => void, track: any, frame = 0) {
  const cv = new FakeCanvas(); cv.width = w; cv.height = h;
  const img = new FakeImageData(new Uint8ClampedArray(w * h * 4), w, h);
  fill(img.data);
  const ctx = cv.getContext();
  ctx.putImageData(img, 0, 0);
  applyCanvasModifiers(ctx as any, [track], frame, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

// ================= A) 覆盖函数断言 =================
console.log('A) 覆盖函数逐形状断言');
{
  const W = 64, H = 48;
  const shapes = ['threshold', 'blinds', 'iris', 'diamond'];
  for (const shape of shapes) {
    let inRange = true;
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
      const c = fieldWipeCoverage(shape, x, y, W, H, 7);
      if (!(c >= 0 && c < 1)) inRange = false;
    }
    ok(inRange, `${shape}: cov 值域 [0,1)`);

    // progress 增大 → keep 单调不减（feather 0 与 0.1 两态）
    let mono = true;
    for (const feather of [0, 0.1]) {
      for (let y = 0; y < H; y += 5) for (let x = 0; x < W; x += 5) {
        let prev = -1;
        for (let p = 0; p <= 1.0001; p += 0.05) {
          const k = fieldWipeKeep(shape, Math.min(1, p), feather, 7, x, y, W, H);
          if (k < prev - 1e-12) mono = false;
          prev = k;
        }
      }
    }
    ok(mono, `${shape}: keep 随 progress 单调不减`);
  }

  // iris 中心先行：中心 cov 最小、沿射线向外递增
  {
    const cx = (W - 1) / 2, cy = (H - 1) / 2;
    const cC = fieldWipeCoverage('iris', Math.round(cx), Math.round(cy), W, H, 7);
    const cNear = fieldWipeCoverage('iris', Math.round(cx) + 5, Math.round(cy), W, H, 7);
    const cFar = fieldWipeCoverage('iris', Math.round(cx) + 20, Math.round(cy), W, H, 7);
    ok(cC < cNear && cNear < cFar && cC <= 0.05, 'iris: 中心 cov 最小、沿射线递增（中心先行）');
  }

  // blinds 条带结构：与 x 无关、带内线性、跨带步长 1/bands
  {
    const bands = Math.ceil(H / 16);
    let xFree = true, structure = true;
    for (let y = 0; y < H; y++) {
      if (fieldWipeCoverage('blinds', 0, y, W, H, 7) !== fieldWipeCoverage('blinds', W - 1, y, W, H, 7)) xFree = false;
      if (y + 1 < H && Math.floor(y / 16) === Math.floor((y + 1) / 16)) {
        const step = fieldWipeCoverage('blinds', 0, y + 1, W, H, 7) - fieldWipeCoverage('blinds', 0, y, W, H, 7);
        if (Math.abs(step - 1 / 16 / bands) > 1e-9) structure = false;
      }
      if (y + 16 < H) {
        const jump = fieldWipeCoverage('blinds', 0, y + 16, W, H, 7) - fieldWipeCoverage('blinds', 0, y, W, H, 7);
        if (Math.abs(jump - 1 / bands) > 1e-9) structure = false;
      }
    }
    ok(xFree, 'blinds: cov 与 x 无关（水平条带）');
    ok(structure, 'blinds: 带内线性扫、跨带步长 = 1/带数');
  }

  // diamond 对称（奇数边长、正中心像素）
  {
    const S = 65, c = 32;
    let sym = true;
    for (let d = 1; d <= 30; d += 3) {
      if (fieldWipeCoverage('diamond', c + d, c, S, S, 7) !== fieldWipeCoverage('diamond', c - d, c, S, S, 7)) sym = false;
      if (fieldWipeCoverage('diamond', c, c + d, S, S, 7) !== fieldWipeCoverage('diamond', c, c - d, S, S, 7)) sym = false;
      if (fieldWipeCoverage('diamond', c + d, c + 7, S, S, 7) !== fieldWipeCoverage('diamond', c + 7, c + d, S, S, 7)) sym = false;
    }
    ok(sym, 'diamond: 左右/上下/转置三重对称');
  }

  // threshold 同种子同场、异种子异场、且对 seed 以外的输入确定
  {
    let same = true, total = 0, diff = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      total++;
      const a = fieldWipeCoverage('threshold', x, y, W, H, 7);
      if (a !== fieldWipeCoverage('threshold', x, y, W, H, 7)) same = false;
      if (a !== fieldWipeCoverage('threshold', x, y, W, H, 42)) diff++;
    }
    ok(same, 'threshold: 同种子同场（重复求值逐点一致）');
    ok(diff / total > 0.5, `threshold: 异种子异场（差异点占比 ${(diff / total).toFixed(2)} > 0.5）`);
  }
}

// ================= B) 编辑器/包内逐点对拍 =================
console.log('B) 编辑器/包内纯函数逐点对拍');
{
  const html = buildRuntimeHtml({ parts: [], costumes: {}, performances: [], behavior: { graphs: {} }, fx: { canvas: { w: 8, h: 8 }, totalFrames: 24, canvasTracks: [] } } as any);
  const extractFn = (src: string, name: string): string => {
    const start = src.indexOf(`function ${name}`);
    ok(start >= 0, `包内有 ${name}`);
    let depth = 0, end = start;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    return src.slice(start, end);
  };
  const factory = new Function(
    `${extractFn(html, 'fwHash2')}\n${extractFn(html, 'fwCovAt')}\n${extractFn(html, 'fwKeepAt')}\n${extractFn(html, 'bsOffsetAt')}\nreturn { fwKeepAt, bsOffsetAt };`,
  ) as any;
  const rt = factory();

  let worst = 0, bad = 0, n = 0;
  for (const shape of ['threshold', 'blinds', 'iris', 'diamond']) {
    for (const progress of [0, 0.37, 0.8, 1]) {
      for (const feather of [0, 0.1]) {
        for (const seed of [7, 42]) {
          for (let y = 0; y < 48; y += 3) for (let x = 0; x < 64; x += 3) {
            n++;
            const a = fieldWipeKeep(shape, progress, feather, seed, x, y, 64, 48);
            const b = rt.fwKeepAt(shape, progress, feather, seed, x, y, 64, 48);
            const d = Math.abs(a - b);
            if (d > worst) worst = d;
            if (d > 1e-12) bad++;
          }
        }
      }
    }
  }
  ok(bad === 0, `fwKeepAt 对拍 ${n} 点全一致（最大差 ${worst}）`);

  let badOff = 0, nOff = 0;
  for (const [ampPx, rows, decay, strength] of [[6, 0, 1, 1], [6, 2, 0.8, 1], [12, 0, 0.5, 0.7], [0, 0, 1, 1]] as const) {
    for (let brow = 0; brow < 12; brow++) for (let bx = 0; bx < 24; bx++) {
      nOff++;
      if (blockShiftOffsetAt(bx, brow, ampPx, rows, decay, strength) !== rt.bsOffsetAt(bx, brow, ampPx, rows, decay, strength)) badOff++;
    }
  }
  ok(badOff === 0, `bsOffsetAt 对拍 ${nOff} 块全一致（整数精确）`);
}

// ================= C) 编辑器引擎端到端 =================
console.log('C) 编辑器引擎端到端');
{
  const W = 64, H = 48;
  const opaque = (px: Uint8ClampedArray) => { for (let i = 0; i < px.length; i += 4) { px[i] = 200; px[i + 3] = 255; } };
  const alphaAt = (d: Uint8ClampedArray, x: number, y: number) => d[(y * W + x) * 4 + 3];
  const keptCount = (d: Uint8ClampedArray) => { let c = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) c++; return c; };

  for (const shape of ['threshold', 'blinds', 'iris', 'diamond']) {
    const wiped = runChain(W, H, opaque, mkTrack('field_wipe', { shape, progress: 0, feather: 0, seed: 7 }));
    ok(keptCount(wiped) === 0, `${shape}: progress=0 全擦`);
    const full = runChain(W, H, opaque, mkTrack('field_wipe', { shape, progress: 1, feather: 0, seed: 7 }));
    ok(keptCount(full) === W * H, `${shape}: progress=1 全保留`);
  }

  // iris 中心先行（端到端）
  {
    const d = runChain(W, H, opaque, mkTrack('field_wipe', { shape: 'iris', progress: 0.08, feather: 0, seed: 7 }));
    ok(alphaAt(d, 32, 24) === 255 && alphaAt(d, 0, 0) === 0, 'iris 端到端：小 progress 时中心保留、四角已擦');
  }

  // 关键帧驱动 progress：0@f0 → 1@f10，f5 的保留数严格居中
  {
    const track = mkTrack('field_wipe', { shape: 'threshold', progress: 0, feather: 0, seed: 7 }, [
      { id: 'k1', frame: 0, params: { progress: 0 } },
      { id: 'k2', frame: 10, params: { progress: 1 } },
    ]);
    const resolved = resolveCanvasModifierParams(track, track.modifiers[0], 5);
    ok(resolved.progress === 0.5, '关键帧插值：f5 的 progress = 0.5（线性）');
    const c0 = keptCount(runChain(W, H, opaque, track, 0));
    const c5 = keptCount(runChain(W, H, opaque, track, 5));
    const c10 = keptCount(runChain(W, H, opaque, track, 10));
    ok(c0 === 0 && c10 === W * H && c5 > c0 && c5 < c10, `关键帧驱动：保留数 f0=${c0} < f5=${c5} < f10=${c10}`);
  }

  // block_shift 全图映射 = 纯函数逐像素一致（含钳制）、纵向不动、|dx|≤amp
  {
    const indexed = (px: Uint8ClampedArray) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4; px[i] = x; px[i + 1] = y; px[i + 3] = 255;
      }
    };
    const params = { blockPx: 16, ampPx: 6, rows: 0, decay: 1, strength: 1 };
    const d = runChain(W, H, indexed, mkTrack('block_shift', params));
    let mapOk = true, boundOk = true;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const sx = d[i], sy = d[i + 1];
      const bx = Math.floor(x / 16), brow = Math.floor((H - 1 - y) / 16);
      const dx = blockShiftOffsetAt(bx, brow, 6, 0, 1, 1);
      const expectSx = Math.min(W - 1, Math.max(0, x - dx));
      if (sy !== y || sx !== expectSx) mapOk = false;
      if (Math.abs(x - sx) > 6 && sx !== 0 && sx !== W - 1) boundOk = false;
    }
    ok(mapOk, 'block_shift：全图采样映射与 blockShiftOffsetAt 逐像素一致');
    ok(boundOk, 'block_shift：位移量 ≤ ampPx（钳制点除外）');
  }

  // rows 门控 + strength 包络
  {
    const indexed = (px: Uint8ClampedArray) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4; px[i] = x; px[i + 1] = y; px[i + 3] = 255;
      }
    };
    const d = runChain(W, H, indexed, mkTrack('block_shift', { blockPx: 16, ampPx: 6, rows: 1, decay: 1, strength: 1 }));
    let gateOk = true;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const brow = Math.floor((H - 1 - y) / 16);
      if (brow >= 1 && d[(y * W + x) * 4] !== x) gateOk = false;
    }
    ok(gateOk, 'rows=1：仅最底行带位移、上方行带恒等');
    let anyShift = false;
    for (let x = 0; x < W; x++) if (d[((H - 1) * W + x) * 4] !== x) anyShift = true;
    ok(anyShift, 'rows=1：最底行带确有位移（门控不是全关）');

    const dHalf = runChain(W, H, indexed, mkTrack('block_shift', { blockPx: 16, ampPx: 6, rows: 0, decay: 1, strength: 0.5 }));
    let envOk = true;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = dHalf[(y * W + x) * 4];
      if (Math.abs(x - sx) > 3 && sx !== 0 && sx !== W - 1) envOk = false;
    }
    ok(envOk, 'strength=0.5 包络：位移量 ≤ ampPx×0.5 = 3');
  }
}

// ================= D) 结构与注册 =================
console.log('D) 结构与注册');
{
  const defs = Object.fromEntries(CANVAS_MODIFIER_DEFINITIONS.map((d) => [d.type, d]));
  ok(defs.field_wipe?.label === '场擦除', 'Definition 注册：场擦除');
  ok(defs.block_shift?.label === '块位移', 'Definition 注册：块位移');
  ok(['shape', 'progress', 'feather', 'seed'].every((k) => defs.field_wipe.params.some((p) => p.name === k)), '场擦除参数齐（shape/progress/feather/seed）');
  ok(['blockPx', 'ampPx', 'rows', 'decay', 'strength'].every((k) => defs.block_shift.params.some((p) => p.name === k)), '块位移参数齐（blockPx/ampPx/rows/decay/strength）');
  const inst = createDefaultCanvasModifier('field_wipe');
  ok(inst.params.progress === 1 && inst.params.shape === 'threshold', 'createDefaultCanvasModifier(field_wipe) 缺省与 Definition 一致');

  const html = buildRuntimeHtml({ parts: [], costumes: {}, performances: [], behavior: { graphs: {} }, fx: { canvas: { w: 8, h: 8 }, totalFrames: 24, canvasTracks: [] } } as any);
  ok(html.includes('uEffect == 10'), '包内着色器有 uEffect==10（场擦除采样）');
  ok(html.includes('uEffect == 11'), '包内着色器有 uEffect==11（块位移采样）');
  ok(html.includes("m.type === 'field_wipe'") && html.includes("m.type === 'block_shift'"), '包内 fxRunPostChain 接入两个新类型');
  ok(html.includes('fxBuildWipeTex') && html.includes('fxBuildShiftTex'), '包内有 CPU 栅格化函数（与编辑器纯函数对拍地基）');
  const typesSrc = readFileSync(new URL('../src/lib/types.ts', import.meta.url), 'utf8');
  ok(typesSrc.includes("'field_wipe'") && typesSrc.includes("'block_shift'"), 'CanvasModifierType 联合含两个新类型');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
