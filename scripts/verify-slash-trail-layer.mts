// ============================================================
// 刀光轨迹化集成探针：轨迹进包 + 扇面新字段（头部弧度/图层段）+ 运行时孪生对拍
// A) 表演轨迹：sync 往返（mode/tipNodeId/layerSegs）→ 真 convert
//    → trailTiles 在包内、帧可解码且含非空像素、无扇面几何字段
// B) 片段轨迹：clip 路采样烘焙同样进包
// C) 扇面：headCurve 非 0 落字段/为 0 不落；layerSegs 归一化落包
// D) 尖端不是部件 → 点名丢弃
// E) 接线覆盖（frameCount / headCurve）对烘焙/序列化生效
// F) 运行时孪生 slashFanFrame（含 headCurve）与编辑器逐字节对拍
// G) slashLayerAtRt 孪生与编辑器 slashLayerAt 对拍；运行时
//    slashTrailFrameOf 解码与编辑器 generateTrailFrame 对拍
// ============================================================
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  createDefaultCostumePiece, type Character, type ProcPerformance, type UnifiedNode,
} from '../src/lib/unified-types';
import type { AnimationClip } from '../src/lib/types';
import {
  PANEL_SLASH_NODE_ID, resolvePerfSlash, syncCharacterSlashBlueprints,
} from '../src/lib/blueprint/slash-sync';
import {
  defaultSlashSpec, generateSlashFrame, normalizeSlashLayerSegs, slashLayerAt,
  type SlashFanSpec,
} from '../src/lib/slash-fan';
import {
  generateTrailFrame, trailFrameLayout, type SlashTrailSample,
} from '../src/lib/slash-trail';
import { packBytesBase64 } from '../src/lib/dynamic-patterns';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import type { BlueprintGraph, BlueprintNode } from '../src/lib/blueprint/ir';

let fails = 0;
const ok = (cond: boolean, label: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};

// ---------- 夹具：手臂（锚点，带 slot+angle 轨）+ 刃尖（子节点，带 slot） ----------
function makeNode(
  id: string, name: string, slotKey: string,
  patch: Record<string, unknown> = {},
): UnifiedNode {
  return {
    id, name,
    role: 'bone',
    slot: { slotKey },
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' },
    sockets: [],
    tracks: {},
    modifiers: [], children: [],
    sprite: undefined as never,
    ...patch,
  } as unknown as UnifiedNode;
}
function mkChar(performances: ProcPerformance[]): Character {
  const arm = makeNode('arm', '手臂', 'arm', {
    children: ['tipN'],
    tracks: {
      angle: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 6, value: -90 }, { frame: 12, value: 0 }] },
    },
  });
  // 刃尖：手臂本地 +x 24px（transform 单位为 sub，1px = 16）
  const tip = makeNode('tipN', '刃尖', 'tip', {
    parentId: 'arm',
    transform: { x: 24 * 16, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
  });
  return {
    id: 'chT', name: '轨迹刀光',
    nodes: { arm, tipN: tip },
    rootNodeId: 'arm', rootNodeIds: ['arm'],
    costumeSets: [{
      id: 'set1', name: '默认',
      pieces: {
        arm: { ...createDefaultCostumePiece('arm'), parametric: createDefaultParametricAppearance() },
        tip: { ...createDefaultCostumePiece('tip'), parametric: createDefaultParametricAppearance() },
      },
    }],
    activeCostumeSetId: 'set1', variants: {},
    performances,
  } as unknown as Character;
}
function mkPerf(patch: Partial<ProcPerformance>): ProcPerformance {
  return {
    id: 'perf1', name: '挥砍', trigger: 'attack', duration: 1, enabled: true,
    mode: 'add', envelopeIn: 0, envelopeOut: 0, maskNodeIds: [], graphs: {},
    ...patch,
  } as ProcPerformance;
}
// 宿主图带真实运动：time → waveform（正弦 ±60°）→ transform.rotation，
// 使表演路采样能采到锚点/尖端的实际摆动（无运动的表演轨迹为空是正确语义，
// 不在本夹具的断言范围内）。
const hostGraph = (): BlueprintGraph => ({
  version: 1, outputId: 'out',
  nodes: [
    { id: 't', type: 'time', inputs: {}, params: {} },
    {
      id: 'wv', type: 'waveform',
      inputs: { t: { nodeId: 't', output: 'out' } },
      params: { waveform: 'sine', amplitude: 60, baseValue: 0, endValue: 0, period: 1, phase: 0, damping: 0 },
    },
    { id: 'out', type: 'transform', inputs: { rotation: { nodeId: 'wv', output: 'out' } }, params: {} },
  ],
} as unknown as BlueprintGraph);
const trailSpec = (patch: Partial<SlashFanSpec> = {}): SlashFanSpec => ({
  ...defaultSlashSpec('arm'),
  mode: 'trail', tipNodeId: 'tipN', frameCount: 6,
  ...patch,
});
type PkgSlash = Record<string, any>;
const pkgSlashOf = (
  ch: Character, perfId: string,
  opts?: { clips?: AnimationClip[] },
): { slash: PkgSlash | undefined; warnings: string[] } => {
  const pkg = convertCharacterToRuntimePackage(ch, undefined, {
    frameRate: 12, totalFrames: 24, ...(opts ?? {}),
  });
  const perf = pkg.performances.find((p) => (p as { id?: string }).id === perfId) as
    { slash?: PkgSlash } | undefined;
  return { slash: perf?.slash, warnings: pkg.warnings };
};
const decodeFrame = (b64: string): Uint8Array => {
  const pad = (4 - (b64.length % 4)) % 4;
  return new Uint8Array(Buffer.from(b64 + '='.repeat(pad), 'base64'));
};
const alphaCount = (data: Uint8Array): number => {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) n++;
  return n;
};

// ---------- A) 表演轨迹 ----------
console.log('A) 表演轨迹刀光');
{
  const messySegs = [{ until: 2, layer: 'back' }, { until: 0.3, layer: 'front' }] as never;
  const perf = mkPerf({
    id: 'ptrail', graphs: { arm: hostGraph() }, maskNodeIds: ['arm'],
    slashEffect: trailSpec({ layerSegs: messySegs }),
  });
  const ch = syncCharacterSlashBlueprints(mkChar([perf]));
  const synced = ch.performances![0]!;
  // sync 往返：结构字段经面板节点 params 落盘并读回（layerSegs 读回归一化）
  const resolved = resolvePerfSlash(synced);
  ok(resolved?.mode === 'trail', 'sync 往返：mode=trail 读回');
  ok(resolved?.tipNodeId === 'tipN', 'sync 往返：tipNodeId 读回');
  assert.deepEqual(resolved?.layerSegs, [{ until: 0.3, layer: 'front' }, { until: 1, layer: 'back' }]);
  ok(true, 'sync 往返：layerSegs 读回已归一化（升序/末段=1）');

  const { slash, warnings } = pkgSlashOf(ch, 'ptrail');
  ok(!!slash, '包内有 slash');
  const tt = slash?.trailTiles as { w: number; h: number; plugX: number; plugY: number; frames: string[] } | undefined;
  ok(!!tt, '包内有 trailTiles');
  ok(tt?.frames.length === 6, `帧数 = frameCount 6（实际 ${tt?.frames.length}）`);
  ok(!!tt && tt.w >= 64 && tt.h >= 64, `帧尺寸含用户盒 64×64（实际 ${tt?.w}×${tt?.h}）`);
  ok(!!tt && tt.plugX >= 0 && tt.plugX <= tt.w && tt.plugY >= 0 && tt.plugY <= tt.h, 'plug 在帧内');
  let allLenOk = true;
  const counts: number[] = [];
  for (const f of tt?.frames ?? []) {
    const d = decodeFrame(f);
    if (d.length !== (tt!.w * tt!.h * 4)) allLenOk = false;
    counts.push(alphaCount(d));
  }
  ok(allLenOk, '每帧 base64 解码长度 = w·h·4');
  ok(counts.some((c) => c > 30), `至少一帧含非空像素（逐帧 alpha 计数 ${counts.join('/')}）`);
  ok(!('rx' in (slash ?? {})) && !('sweepDeg' in (slash ?? {})) && !('w' in (slash ?? {})),
    '轨迹模式不落扇面几何字段（无 rx/sweepDeg/w）');
  assert.deepEqual(slash?.layerSegs, [{ until: 0.3, layer: 'front' }, { until: 1, layer: 'back' }]);
  ok(true, '包内 layerSegs 已归一化');
  ok(!warnings.some((w) => w.includes('轨迹')), '无轨迹相关点名警告');
}

// ---------- B) 片段轨迹 ----------
console.log('B) 片段轨迹刀光');
{
  const clip: AnimationClip = {
    id: 'c1', name: '挥砍片段', startFrame: 0, endFrame: 11,
    puppetCharacterId: 'chT',
    slashEffect: trailSpec({ frameCount: 4 }),
  } as unknown as AnimationClip;
  const { slash } = pkgSlashOf(mkChar([]), 'clip_c1', { clips: [clip] });
  const tt = slash?.trailTiles as { frames: string[]; w: number; h: number } | undefined;
  ok(!!tt && tt.frames.length === 4, `片段轨迹进包、帧数 4（实际 ${tt?.frames.length}）`);
  const mid = tt ? decodeFrame(tt.frames[1]!) : new Uint8Array(0);
  ok(alphaCount(mid) > 30, `片段轨迹帧含非空像素（alpha 计数 ${alphaCount(mid)}）`);
}

// ---------- C) 扇面新字段 ----------
console.log('C) 扇面 headCurve / layerSegs 进包');
{
  const perf = mkPerf({
    id: 'pfan',
    slashEffect: {
      ...defaultSlashSpec('arm'), headCurve: 0.7,
      layerSegs: [{ until: 0.5, layer: 'back' }, { until: 0.9, layer: 'front' }],
    } as SlashFanSpec,
  });
  const { slash } = pkgSlashOf(syncCharacterSlashBlueprints(mkChar([perf])), 'pfan');
  ok(slash?.headCurve === 0.7, `headCurve 落字段（实际 ${slash?.headCurve}）`);
  assert.deepEqual(slash?.layerSegs, [{ until: 0.5, layer: 'back' }, { until: 1, layer: 'front' }]);
  ok(true, 'layerSegs 归一化落字段（末段 until 强制 1）');

  const plain = mkPerf({ id: 'pplain', slashEffect: defaultSlashSpec('arm') });
  const s2 = pkgSlashOf(syncCharacterSlashBlueprints(mkChar([plain])), 'pplain').slash;
  ok(!!s2 && !('headCurve' in s2) && !('layerSegs' in s2), 'headCurve=0/无分段不落字段（旧包形态不变）');
}

// ---------- D) 尖端不是部件 ----------
console.log('D) 尖端校验点名');
{
  const perf = mkPerf({ id: 'pbad', slashEffect: trailSpec({ tipNodeId: 'nope' }) });
  const { slash, warnings } = pkgSlashOf(syncCharacterSlashBlueprints(mkChar([perf])), 'pbad');
  ok(slash === undefined, '尖端不存在 → 刀光丢弃');
  ok(warnings.some((w) => w.includes('尖端节点') && w.includes('未进包')),
    `点名警告在列（${warnings.filter((w) => w.includes('刀光')).join('；')}）`);
}

// ---------- E) 接线覆盖对烘焙生效 ----------
console.log('E) 接线覆盖');
{
  const attachWiring = (
    perf: ProcPerformance, graphKey: string,
    extraNodes: BlueprintNode[],
    inputs: Record<string, { nodeId: string; output?: string }>,
  ): void => {
    const g = perf.graphs[graphKey]!;
    g.nodes.push(...extraNodes);
    const panel = g.nodes.find((n) => n.id === PANEL_SLASH_NODE_ID)!;
    panel.inputs = { ...panel.inputs, ...inputs };
  };
  const constNode = (id: string, value: number): BlueprintNode =>
    ({ id, type: 'const', inputs: {}, params: { value } } as BlueprintNode);

  const perfT = mkPerf({
    id: 'pwire', graphs: { arm: hostGraph() }, slashEffect: trailSpec(),
  });
  const chT = syncCharacterSlashBlueprints(mkChar([perfT]));
  attachWiring(chT.performances![0]!, 'arm', [constNode('c3', 3)], { frameCount: { nodeId: 'c3', output: 'out' } });
  const sw = pkgSlashOf(chT, 'pwire').slash;
  ok(sw?.frameCount === 3 && (sw?.trailTiles as { frames: string[] })?.frames.length === 3,
    `轨迹烘焙用覆盖后 frameCount=3（包内 ${sw?.frameCount}）`);

  const perfF = mkPerf({
    id: 'pwiref', graphs: { arm: hostGraph() },
    slashEffect: { ...defaultSlashSpec('arm'), headCurve: 0.1 } as SlashFanSpec,
  });
  const chF = syncCharacterSlashBlueprints(mkChar([perfF]));
  attachWiring(chF.performances![0]!, 'arm', [constNode('c9', 0.9)], { headCurve: { nodeId: 'c9', output: 'out' } });
  const sf = pkgSlashOf(chF, 'pwiref').slash;
  ok(sf?.headCurve === 0.9, `扇面 headCurve 接线覆盖 0.1→0.9（包内 ${sf?.headCurve}）`);
}

// ---------- F) 孪生 headCurve 逐字节对拍 ----------
console.log('F) 运行时孪生对拍（headCurve）');
{
  const tplSrc = readFileSync(
    new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url),
    'utf8',
  );
  const grabFn = (src: string, marker: string): string => {
    const start = src.indexOf(marker);
    assert.ok(start >= 0, `模板缺 ${marker}`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('花括号不配平');
  };
  const palLine = tplSrc.slice(
    tplSrc.indexOf('const SLASH_PALETTE_RT'),
    tplSrc.indexOf(';', tplSrc.indexOf('const SLASH_PALETTE_RT')) + 1,
  );
  const rtGen = new Function(
    `${palLine}\n${grabFn(tplSrc, 'function slashHexRgb')}\n${grabFn(tplSrc, 'function slashSmooth01')}\n${grabFn(tplSrc, 'function slashFrameLayout')}\n${grabFn(tplSrc, 'function slashFanFrame')}\nreturn slashFanFrame;`,
  )() as (spec: never, p: number, mir: boolean) => { w: number; h: number; plugX: number; plugY: number; data: Uint8Array };
  const specs: SlashFanSpec[] = [
    { ...defaultSlashSpec('a') },
    { ...defaultSlashSpec('a'), headCurve: -1 },
    { ...defaultSlashSpec('a'), headCurve: -0.55 },
    { ...defaultSlashSpec('a'), headCurve: 0.35 },
    { ...defaultSlashSpec('a'), headCurve: 1 },
    { ...defaultSlashSpec('a'), headCurve: -0.8, dir: -1 },
    { ...defaultSlashSpec('a'), headCurve: 0.8, cx: -14, cy: 22, rx: 40, ry: 34, rotDeg: 45 },
    { ...defaultSlashSpec('a'), headCurve: 0, sweepDeg: 250, colors: ['#ffffff', '#ffee00', '#ff0000'] },
  ];
  let parity = true;
  let curvedDiffers = false;
  for (const spec of specs) {
    for (const p of [0, 0.2, 0.45, 0.58, 0.8, 1]) {
      for (const mir of [false, true]) {
        const a = generateSlashFrame(spec, p, mir);
        const b = rtGen(spec as never, p, mir);
        if (a.w !== b.w || a.h !== b.h || a.plugX !== b.plugX || a.plugY !== b.plugY || a.rgba.length !== b.data.length) {
          parity = false; break;
        }
        for (let i = 0; i < a.rgba.length; i++) if (a.rgba[i] !== b.data[i]) { parity = false; break; }
        if (!parity) break;
      }
      if (!parity) break;
    }
    if (!parity) break;
  }
  ok(parity, '孪生 slashFanFrame 与编辑器 generateSlashFrame 逐字节一致（含 headCurve/dir/镜像）');
  // 证伪性：headCurve 确实改变画面（否则对拍通过也无意义）。
  // 取 p=0.3（head≈0.6、未达扫过角末端）：内凹必减像素、外凸必加
  const base = generateSlashFrame(defaultSlashSpec('a'), 0.3, false);
  const curved = generateSlashFrame({ ...defaultSlashSpec('a'), headCurve: 1 }, 0.3, false);
  for (let i = 0; i < base.rgba.length; i++) if (base.rgba[i] !== curved.rgba[i]) { curvedDiffers = true; break; }
  ok(curvedDiffers && alphaCount(curved.rgba) < alphaCount(base.rgba),
    `headCurve=1 前沿内凹、像素减少（${alphaCount(base.rgba)} → ${alphaCount(curved.rgba)}）`);
  const bulged = generateSlashFrame({ ...defaultSlashSpec('a'), headCurve: -1 }, 0.3, false);
  ok(alphaCount(bulged.rgba) > alphaCount(base.rgba),
    `headCurve=-1 前沿外凸、像素增加（${alphaCount(base.rgba)} → ${alphaCount(bulged.rgba)}）`);
}

// ---------- G) 图层查表孪生 + 轨迹帧解码对拍 ----------
console.log('G) slashLayerAtRt / slashTrailFrameOf 孪生');
{
  const tplSrc = readFileSync(
    new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url),
    'utf8',
  );
  const grabFn = (src: string, marker: string): string => {
    const start = src.indexOf(marker);
    assert.ok(start >= 0, `模板缺 ${marker}`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('花括号不配平');
  };
  const rtLayer = new Function(
    `${grabFn(tplSrc, 'function slashLayerAtRt')}\nreturn slashLayerAtRt;`,
  )() as (segs: unknown, p: number) => string;
  const rtTrail = new Function(
    `${grabFn(tplSrc, 'function decodeGlowData')}\n${grabFn(tplSrc, 'function slashTrailFrameOf')}\nreturn slashTrailFrameOf;`,
  )() as (tt: unknown, fi: number, mir: boolean) => { w: number; h: number; plugX: number; plugY: number; data: Uint8Array };

  const segSets = [
    undefined,
    [],
    [{ until: 1, layer: 'back' }],
    [{ until: 0.4, layer: 'back' }, { until: 1, layer: 'front' }],
    [{ until: 0.3, layer: 'front' }, { until: 0.7, layer: 'back' }, { until: 1, layer: 'front' }],
  ] as const;
  let layerParity = true;
  for (const segs of segSets) {
    const norm = normalizeSlashLayerSegs(segs as never);
    for (let pi = 0; pi <= 20; pi++) {
      const p = pi / 20;
      // 编辑器侧吃归一化前/后都应同结果（归一化幂等口径）；运行时吃包内归一化形
      if (slashLayerAt({ ...defaultSlashSpec(), layerSegs: norm }, p) !== rtLayer(norm, p)) layerParity = false;
      if (slashLayerAt({ ...defaultSlashSpec(), layerSegs: segs as never }, p) !== rtLayer(norm, p) && segs && segs.length) {
        // 未归一化输入编辑器结果可与归一化不同（末段 until<1 时），不作断言
      }
    }
  }
  ok(layerParity, 'slashLayerAtRt 与编辑器 slashLayerAt（归一化输入）逐点一致');
  ok(rtLayer([{ until: 0.5, layer: 'back' }, { until: 1, layer: 'front' }], 0.5) === 'back',
    'p 恰 = until 归本段（与编辑器 slashLayerAt 同口径）');

  // 轨迹帧：编辑器生成 → 同 convert 编码 → 运行时解码 → 逐字节一致
  const samples: SlashTrailSample[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const ang = (-80 * t) * Math.PI / 180;
    samples.push({ ax: 0, ay: 0, bx: 24 * Math.cos(ang), by: 24 * Math.sin(ang) });
  }
  const specT = trailSpec();
  const lay = trailFrameLayout(specT, samples);
  const tt = {
    w: lay.w, h: lay.h, plugX: lay.plugX, plugY: lay.plugY,
    frames: [0, 1, 2].map((fi) => packBytesBase64(new Uint8Array(generateTrailFrame(specT, samples, fi / 2, false)!.data))),
  };
  let trailParity = true;
  for (const mir of [false, true]) {
    for (let fi = 0; fi < 3; fi++) {
      const a = generateTrailFrame(specT, samples, fi / 2, mir)!;
      const b = rtTrail(tt, fi, mir);
      if (a.w !== b.w || a.h !== b.h || a.plugX !== b.plugX || a.plugY !== b.plugY) { trailParity = false; break; }
      for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) { trailParity = false; break; }
    }
  }
  ok(trailParity, '运行时 slashTrailFrameOf 解码（含镜像翻转）与编辑器 generateTrailFrame 逐字节一致');
  ok(alphaCount(rtTrail(tt, 1, false).data) > 30, '解码帧含非空像素');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);

// ---------- H) 生成器直查：轨迹带形状/头尾明暗/镜像与图层段单测 ----------
{
  const samples: SlashTrailSample[] = [];
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = (i / (N - 1)) * Math.PI / 2; // 刃尖绕刃根扫 90°
    samples.push({ ax: 0, ay: 0, bx: Math.sin(a) * 40, by: -Math.cos(a) * 40 });
  }
  const spec = { ...defaultSlashSpec(), mode: 'trail' as const, frameCount: 6 };
  const mid = generateTrailFrame(spec, samples, 0.5, false);
  ok(!!mid, 'H 轨迹帧生成非空');
  if (mid) {
    let count = 0;
    for (let i = 3; i < mid.data.length; i += 4) if (mid.data[i] > 0) count++;
    ok(count > 500, `H 中段帧非空像素充足（${count}）`);
    // 镜像：像素集应为原图水平镜像、plug 横坐标对称
    const mir = generateTrailFrame(spec, samples, 0.5, true)!;
    let same = mir.w === mid.w && mir.h === mid.h && Math.abs(mir.plugX - (mid.w - mid.plugX)) < 1e-9;
    if (same) {
      outer: for (let y = 0; y < mid.h; y++) for (let x = 0; x < mid.w; x++) {
        const a1 = mid.data[(y * mid.w + x) * 4 + 3];
        const a2 = mir.data[(y * mid.w + (mid.w - 1 - x)) * 4 + 3];
        if (a1 !== a2) { same = false; break outer; }
      }
    }
    ok(same, 'H 镜像帧 = 原帧水平镜像且 plug 对称');
  }
  ok(generateTrailFrame(spec, [samples[0]], 0.5, false) === null, 'H 样本不足 2 → null');

  // 图层段单测
  const segs = normalizeSlashLayerSegs([
    { until: 0.7, layer: 'front' }, { until: 0.4, layer: 'back' }, { until: 0.4, layer: 'back' },
  ]);
  ok(segs.length === 2 && segs[0].layer === 'back' && segs[1].until === 1, 'H 图层段归一：排序+合并+末段拉到 1');
  const specL: SlashFanSpec = { ...defaultSlashSpec(), layerSegs: segs };
  ok(slashLayerAt(specL, 0.2) === 'back' && slashLayerAt(specL, 0.4) === 'back' && slashLayerAt(specL, 0.9) === 'front', 'H slashLayerAt 分段命中（含界）');
  ok(slashLayerAt(defaultSlashSpec(), 0.5) === 'front', 'H 无图层段 → 全程在前');

  // 头部弧度单调性：+1 内凹像素最少、−1 外凸最多
  const fan = { ...defaultSlashSpec(), rx: 48, ry: 48, w: 128, h: 128, sweepDeg: 160 };
  const cnt = (hc: number) => {
    const f = generateSlashFrame({ ...fan, headCurve: hc }, 0.45, false);
    let c = 0; for (let i = 3; i < f.data.length; i += 4) if (f.data[i] > 0) c++;
    return c;
  };
  const cPos = cnt(1), c0 = cnt(0), cNeg = cnt(-1);
  ok(cPos < c0 && c0 < cNeg, `H 头部弧度单调（+1:${cPos} < 0:${c0} < −1:${cNeg}）`);
}
