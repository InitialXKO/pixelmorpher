// 画布效果审计七修验收探针（PR #68，基点 b77ac8d 上重写）
// 覆盖：
//  A) resolveCanvasModifierParams 区间外端点保持 + 两端（编辑器/运行时）同结果
//  B) 参数 0 被尊重（bloom 强度/阈值、scanlines 不透明度——假 DOM 跑真引擎逐字节比）
//  C) 描边整带覆盖 + blendMode/edgesOnly 经 convert 入包 + 运行时打包/着色器源码断言
//  D) store 关键帧全环（加轨/加修改器/重排/加帧/改帧参/移帧/删帧）
//  E) 迁移不双写 + 导入缺字段清空
//  F) convert 存量去重（片段轨与工程级逐项全同 → 不入包 + 点名；不同 → 入包）
import { resolveCanvasModifierParams, applyCanvasModifiers } from '../src/lib/engine/canvas-modifiers';
import { buildRuntimeHtml } from '../src/lib/proc-runtime/runtime-template';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { useProjectStore } from '../src/lib/store';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗ FAIL:', msg); }
};

// ================= 假 DOM（2D 上下文最小实现，支撑真引擎逐字节比对） =================
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
    const op = this.globalCompositeOperation;
    const d = this.canvas.pixels, s = src.pixels;
    const w = Math.min(src.width, this.canvas.width - dx), h = Math.min(src.height, this.canvas.height - dy);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = (y * src.width + x) * 4, di = ((y + dy) * this.canvas.width + (x + dx)) * 4;
      const sa = (s[si + 3] / 255) * this.globalAlpha;
      if (op === 'lighter') {
        for (let c = 0; c < 3; c++) d[di + c] = Math.min(255, d[di + c] + s[si + c] * sa);
        d[di + 3] = Math.min(255, d[di + 3] + s[si + 3] * sa);
      } else {
        // source-over（含非法 gCO 值回落，与真 canvas 一致）
        const da = d[di + 3] / 255;
        const oa = sa + da * (1 - sa);
        if (oa <= 0) { d[di] = d[di + 1] = d[di + 2] = d[di + 3] = 0; continue; }
        for (let c = 0; c < 3; c++) d[di + c] = Math.round((s[si + c] * sa + d[di + c] * da * (1 - sa)) / oa);
        d[di + 3] = Math.round(oa * 255);
      }
    }
  }
  clearRect(x: number, y: number, w: number, h: number) {
    for (let row = 0; row < h; row++) {
      const i = ((y + row) * this.canvas.width + x) * 4;
      this.canvas.pixels.fill(0, i, i + w * 4);
    }
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const hex = String(this.fillStyle).replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = (yy * this.canvas.width + xx) * 4;
      this.canvas.pixels[i] = r; this.canvas.pixels[i + 1] = g; this.canvas.pixels[i + 2] = b; this.canvas.pixels[i + 3] = 255;
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
const bytesEq = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.length === b.length && a.every((v, i) => v === b[i]);

// ================= A) 求值边界 + 两端一致 =================
console.log('A) resolve 边界与两端一致');
{
  const modifier = { id: 'm1', type: 'bloom', enabled: true, params: { intensity: 0.9, threshold: 0.3 } } as any;
  const track = {
    id: 'ta', name: 'x', type: 'bloom', modifiers: [modifier], visible: true, enabled: true,
    keyframes: [
      { id: 'k2', frame: 20, params: { intensity: 1 } },
      { id: 'k1', frame: 10, params: { intensity: 0 } },
    ],
  } as any;
  const frames = [0, 5, 10, 15, 20, 25];
  const expect = [0, 0, 0, 0.5, 1, 1];
  const editorVals = frames.map((f) => resolveCanvasModifierParams(track, modifier, f).intensity as number);
  ok(frames.every((_, i) => editorVals[i] === expect[i]), `编辑器端点保持+钳制：${editorVals.join(',')}（期望 ${expect.join(',')}）`);
  ok(editorVals.every((v) => Number.isFinite(v)), '编辑器结果全有限（无 NaN）');
  ok(track.keyframes[0].frame === 20 && track.keyframes[1].frame === 10, 'resolve 不改调用方关键帧顺序（拷贝排序）');
  ok(resolveCanvasModifierParams(track, modifier, 15).threshold === 0.3, '关键帧未覆盖的参数保留基础值');

  const html = buildRuntimeHtml({ parts: [], costumes: {}, performances: [], behavior: { graphs: {} }, fx: { canvas: { w: 8, h: 8 }, totalFrames: 24, canvasTracks: [] } } as any);
  const start = html.indexOf('function fxResolveCanvasParams');
  ok(start >= 0, '运行时包内有 fxResolveCanvasParams');
  let depth = 0, end = start;
  for (; end < html.length; end++) {
    if (html[end] === '{') depth++;
    else if (html[end] === '}') { depth--; if (depth === 0) { end++; break; } }
  }
  const rtResolve = new Function(`return (${html.slice(start, end)})`)() as any;
  const rtTrack = { modifiers: [{ id: 'm1', params: { intensity: 0.9, threshold: 0.3 } }], keyframes: track.keyframes };
  const rtVals = frames.map((f) => rtResolve(rtTrack, { intensity: 0.9, threshold: 0.3 }, f).intensity as number);
  ok(frames.every((_, i) => rtVals[i] === expect[i] && rtVals[i] === editorVals[i]), `运行时同口径：${rtVals.join(',')}`);
}

// ================= B) 参数 0 被尊重 =================
console.log('B) 0 值尊重（真引擎逐字节）');
{
  const gray = (px: Uint8ClampedArray) => { for (let i = 0; i < px.length; i += 4) { px[i] = px[i + 1] = px[i + 2] = 128; px[i + 3] = 255; } };
  const base = runChain(8, 8, gray, mkTrack('bloom', { threshold: 0.99, radius: 2, intensity: 0, color: '#ffffff' }));
  const zeroIntensity = runChain(8, 8, gray, mkTrack('bloom', { threshold: 0, radius: 2, intensity: 0, color: '#ffffff' }));
  ok(bytesEq(base, zeroIntensity), 'bloom intensity=0 → 输出与无辉光一致（0 不被缺省 0.5 顶替）');
  const zeroThreshold = runChain(8, 8, gray, mkTrack('bloom', { threshold: 0, radius: 2, intensity: 0.8, color: '#ffffff' }));
  ok(!bytesEq(base, zeroThreshold), 'bloom threshold=0 → 中灰也发光（0 不被缺省 0.7 顶替）');
  const bloomCtl = runChain(8, 8, gray, mkTrack('bloom', { threshold: 0.3, radius: 2, intensity: 0.8, color: '#ff0000' }));
  ok(!bytesEq(base, bloomCtl), '对照：bloom 正常参数确实改变画面（链路有效）');

  const scanBase = runChain(8, 8, gray, mkTrack('scanlines', { lineSpacing: 2, lineOpacity: 0, vignetteIntensity: 0 }));
  const plain = (() => { const px = new Uint8ClampedArray(8 * 8 * 4); gray(px); return px; })();
  ok(bytesEq(plain, scanBase), 'scanlines lineOpacity=0 且 vignetteIntensity=0 → 画面不变');
  const scanCtl = runChain(8, 8, gray, mkTrack('scanlines', { lineSpacing: 2, lineOpacity: 0.5, vignetteIntensity: 0 }));
  ok(!bytesEq(plain, scanCtl), '对照：lineOpacity=0.5 确实压暗扫描线行');
}

// ================= C) 描边整带 + 入包 + 运行时源码断言 =================
console.log('C) 描边');
{
  const dot = (px: Uint8ClampedArray) => { const i = (4 * 9 + 4) * 4; px[i] = 255; px[i + 3] = 255; };
  const out = runChain(9, 9, dot, mkTrack('outline_emphasis', {
    thickness: 2, color: '#00ff00', directions: '8', outlineMode: 'solid', blendMode: 'normal', edgesOnly: false, lightAngle: 315,
  }));
  const at = (x: number, y: number) => { const i = (y * 9 + x) * 4; return [out[i], out[i + 1], out[i + 2], out[i + 3]]; };
  // 与运行时同一几何：8 方向 × 1..thickness 逐级（辐条带）——旧实现只有
  // 恰好 =thickness 的一圈点；骑士步位置两端都不覆盖。
  const onSpoke = (dx: number, dy: number) => dx === 0 || dy === 0 || dx === dy;
  let bandOk = true, outsideOk = true;
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    const dx = Math.abs(x - 4), dy = Math.abs(y - 4), cheb = Math.max(dx, dy);
    const [r, g, , a] = at(x, y);
    if (cheb >= 1 && cheb <= 2 && onSpoke(dx, dy)) { if (!(g === 255 && r === 0 && a === 255)) bandOk = false; }
    if (cheb > 2 || (cheb >= 1 && !onSpoke(dx, dy))) { if (a !== 0) outsideOk = false; }
  }
  ok(bandOk, 'thickness=2：8 方向 1..2 级全覆盖（旧实现只有距 2 一圈点）');
  ok(outsideOk, '带外与骑士步位置无描边（与运行时搜索同几何）');
  // 宽形状：3×3 块 th=1 → 外圈整圈（真实形状的描边带）
  const block = (px: Uint8ClampedArray) => { for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) { const i = (y * 9 + x) * 4; px[i] = 255; px[i + 3] = 255; } };
  const outB = runChain(9, 9, block, mkTrack('outline_emphasis', {
    thickness: 1, color: '#00ff00', directions: '8', outlineMode: 'solid', blendMode: 'normal', edgesOnly: false, lightAngle: 315,
  }));
  let ringOk = true;
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) {
    if (x >= 3 && x <= 5 && y >= 3 && y <= 5) continue;
    const i = (y * 9 + x) * 4;
    if (!(outB[i + 1] === 255 && outB[i + 3] === 255)) ringOk = false;
  }
  ok(ringOk, '3×3 块 thickness=1 外圈整圈描边');
  const [cr, , , ca] = at(4, 4);
  ok(cr === 255 && ca === 255, '中心源像素保留（normal 模式描边垫底）');

  const outlineTrack = mkTrack('outline_emphasis', {
    thickness: 2, color: '#112233', directions: '8', outlineMode: 'gradient', blendMode: 'multiply', edgesOnly: true, lightAngle: 90,
  });
  const pkg = convertCharacterToRuntimePackage({ id: 'ch0', name: '空', nodes: {}, costumeSets: [] } as any, {} as any, {
    frameRate: 12, totalFrames: 8,
    projectData: { canvasWidth: 32, canvasHeight: 32, canvasModifierTracks: [outlineTrack] } as any,
  });
  const inPkg = (pkg.fx as any)?.canvasTracks?.[0]?.modifiers?.[0]?.params;
  ok(inPkg?.blendMode === 'multiply' && inPkg?.edgesOnly === true, 'convert 入包携带 blendMode/edgesOnly');

  const tpl = readFileSync(new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url), 'utf8');
  ok(tpl.includes('edgesOnly ? 1 : 0') && tpl.includes("multiply: 2"), '运行时打包 uP0.w=混合模式、uP1.z=仅边缘');
  ok(tpl.includes('uP1.z > 0.5') && tpl.includes('80.0 / 255.0') && tpl.includes('uColor * 0.3'), '着色器实现仅边缘判定、darken −80、gradient 暗端 ×0.3');
  const th = readFileSync(new URL('../src/components/pixel-editor/canvas/tool-handlers.ts', import.meta.url), 'utf8');
  ok(th.includes('undefined, pst.canvasModifierTracks'), 'SAM 编码帧传当前工程画布轨（D4）');
}

// ================= D) store 关键帧全环 =================
console.log('D) store 关键帧全环');
{
  const st = useProjectStore.getState();
  st.addCanvasModifierTrack('bloom');
  let tracks = useProjectStore.getState().canvasModifierTracks;
  const track = tracks[tracks.length - 1];
  ok(!!track, '加画布轨成功');
  st.addCanvasModifier(track.id, 'color_lut');
  tracks = useProjectStore.getState().canvasModifierTracks;
  const t2 = tracks.find((t) => t.id === track.id)!;
  ok(t2.modifiers.length >= 2, '轨内加第二个修改器');
  const second = t2.modifiers[t2.modifiers.length - 1];
  st.reorderCanvasModifier(track.id, second.id, 0);
  const t3 = useProjectStore.getState().canvasModifierTracks.find((t) => t.id === track.id)!;
  ok(t3.modifiers[0].id === second.id, 'reorder 把第二修改器移到首位');

  const mod = t3.modifiers.find((m) => m.type === 'bloom') ?? t3.modifiers[0];
  st.addCanvasModifierKeyframe(track.id, 10, { intensity: 0 });
  st.addCanvasModifierKeyframe(track.id, 20, { intensity: 1 });
  let cur = useProjectStore.getState().canvasModifierTracks.find((t) => t.id === track.id)!;
  ok(cur.keyframes.length === 2, '加两关键帧');
  ok((resolveCanvasModifierParams(cur as any, mod as any, 5) as any).intensity === 0, '首帧前解析 = 首关键帧值（端点保持）');
  ok((resolveCanvasModifierParams(cur as any, mod as any, 15) as any).intensity === 0.5, '帧间插值 0.5');
  const kf10 = cur.keyframes.find((k) => k.frame === 10)!;
  const kf20 = cur.keyframes.find((k) => k.frame === 20)!;
  st.updateCanvasModifierKeyframe(track.id, kf10.id, { intensity: 0.4 });
  cur = useProjectStore.getState().canvasModifierTracks.find((t) => t.id === track.id)!;
  ok((resolveCanvasModifierParams(cur as any, mod as any, 10) as any).intensity === 0.4, 'updateCanvasModifierKeyframe 生效');
  st.moveCanvasModifierKeyframe(track.id, kf20.id, 30);
  cur = useProjectStore.getState().canvasModifierTracks.find((t) => t.id === track.id)!;
  ok(cur.keyframes.map((k) => k.frame).join(',') === '10,30', 'move 移帧并重排序');
  st.moveCanvasModifierKeyframe(track.id, kf10.id, 30);
  cur = useProjectStore.getState().canvasModifierTracks.find((t) => t.id === track.id)!;
  ok(cur.keyframes.map((k) => k.frame).join(',') === '10,30', 'move 到已占用帧被拒绝');
  st.removeCanvasModifierKeyframe(track.id, kf10.id);
  cur = useProjectStore.getState().canvasModifierTracks.find((t) => t.id === track.id)!;
  ok(cur.keyframes.length === 1 && cur.keyframes[0].frame === 30, 'remove 删帧');
}

// ================= E) 迁移/导入 =================
console.log('E) 迁移与导入');
{
  const projTrack = mkTrack('bloom', { threshold: 0.7, radius: 3, intensity: 0.5, color: '#ffcc88' });
  (projTrack as any).id = 'proj-track-1';
  const legacyFile = {
    version: '1.0',
    project: {
      canvasModifierTracks: [projTrack], animationClips: [], sprites: [], parts: [],
      unifiedCharacters: [], effectTracks: [], globalModifiers: [],
    },
  } as any;
  useProjectStore.getState().importProjectFile(legacyFile);
  let s = useProjectStore.getState();
  ok(s.canvasModifierTracks.some((t) => t.id === 'proj-track-1'), '迁移：工程级画布轨保留一份');
  const migrated = s.animationClips[0] as any;
  ok(!!migrated, '迁移：生成了迁移片段');
  ok(!migrated?.canvasModifierTracks?.length, '迁移：片段画布轨为空（不双写）');

  const bareFile = {
    version: '3.0',
    project: { animationClips: [], sprites: [], parts: [], unifiedCharacters: [], effectTracks: [], globalModifiers: [] },
  } as any;
  useProjectStore.getState().importProjectFile(bareFile);
  s = useProjectStore.getState();
  ok(s.canvasModifierTracks.length === 0, '导入缺 canvasModifierTracks 字段 → 既有轨被清空（不残留）');
}

// ================= F) convert 存量去重 =================
console.log('F) convert 去重');
{
  const sprite = {
    id: 'spr1', name: '体', width: 4, height: 4,
    data: Array.from({ length: 4 }, () => Array(4).fill('#ff88aa')),
    plug: { x: 32, y: 32 },
  } as any;
  const node = {
    id: 'n1', name: '体', parentId: null, children: [],
    transform: { x: 0, y: 0, z: 0, angle: 0, stretch: 1, variantIndex: 6 },
    tracks: { x: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 32 }] } },
    modifiers: [], sockets: [], visible: true, drawLayer: 'default', zIndex: 0,
    attachment: { type: 'root' }, slot: { slotKey: 'body' },
  } as any;
  const character = {
    id: 'ch1', name: '测', nodes: { n1: node }, rootNodeId: 'n1',
    costumeSets: [{ id: 'cs1', name: '默认', pieces: { body: { slotKey: 'body', fillColor: '#888', sprites: { 6: { spriteId: 'spr1' } }, scaleVariants: {}, mirrorMap: {}, crossSections: [] } } }],
    activeCostumeSetId: 'cs1', sprites: { spr1: sprite },
  } as any;
  const projTracks = [mkTrack('bloom', { threshold: 0.7, radius: 3, intensity: 0.5, color: '#ffcc88' })];
  const shuffleKeys = (v: any): any => {
    if (Array.isArray(v)) return v.map(shuffleKeys);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).reverse()) out[k] = shuffleKeys(v[k]);
      return out;
    }
    return v;
  };
  const clipSame = { id: 'clipA', name: '同轨片段', puppetCharacterId: 'ch1', startFrame: 0, endFrame: 15, loop: false, canvasModifierTracks: shuffleKeys(JSON.parse(JSON.stringify(projTracks))) } as any;
  const pkgA = convertCharacterToRuntimePackage(character, { spr1: sprite } as any, {
    frameRate: 12, totalFrames: 16, clips: [clipSame],
    projectData: { canvasWidth: 32, canvasHeight: 32, canvasModifierTracks: projTracks } as any,
  });
  const perfA = pkgA.performances.find((p: any) => p.id === 'clip_clipA') as any;
  ok(!!perfA, '同轨：段表演已生成');
  ok(!(perfA?.fx as any)?.canvasTracks, '同轨：片段级画布轨未入包（避免与工程级双重应用）');
  ok(pkgA.warnings.some((w) => w.includes('同轨片段') && w.includes('未重复入包')), '同轨：点名警告');

  const diffTracks = [mkTrack('bloom', { threshold: 0.2, radius: 3, intensity: 0.5, color: '#ffcc88' })];
  const clipDiff = { ...clipSame, id: 'clipB', name: '异轨片段', canvasModifierTracks: diffTracks } as any;
  const pkgB = convertCharacterToRuntimePackage(character, { spr1: sprite } as any, {
    frameRate: 12, totalFrames: 16, clips: [clipDiff],
    projectData: { canvasWidth: 32, canvasHeight: 32, canvasModifierTracks: projTracks } as any,
  });
  const perfB = pkgB.performances.find((p: any) => p.id === 'clip_clipB') as any;
  ok(!!(perfB?.fx as any)?.canvasTracks, '异轨：真不同的片段轨照常入包');
}

console.log(`\nverify-canvas-effects-audit: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
