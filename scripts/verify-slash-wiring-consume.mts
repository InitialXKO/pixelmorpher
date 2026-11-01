// ============================================================
// slash_fan 接线覆盖生产消费探针（用户裁定：接线必须真消费）
//
// convert 进包时以表演本地 t=0 单点求值回调（slashWiringEval →
// evaluateNodeOutput，帧 0、vars={}）喂 resolvePerfSlash：
// 1) 数值覆盖：sweepDeg 接 const 200（静态 90）→ 包内 200
// 2) gate 接 const 0 → 无刀光；接 1 → 在且静态值不变
// 3) 绑定共享定义 + 接线覆盖叠加：解引用规格被覆盖、其余随定义
// 4) 未接线表演与基线逐值不变
// 5) 时间型来源取 t=0 输出：sine phase=90（峰值 200）与
//    phase=0（起点 145）两点从两侧钉住 t=0
// 6) 接线源节点不存在 → 回调 null → 回落静态规格
// 全部走真 convertCharacterToRuntimePackage 断言产物。
// ============================================================
import {
  createDefaultCostumePiece, type Character, type ProcPerformance, type SlashDefinition, type UnifiedNode,
} from '../src/lib/unified-types';
import {
  PANEL_SLASH_NODE_ID, syncCharacterSlashBlueprints,
} from '../src/lib/blueprint/slash-sync';
import { defaultSlashSpec, type SlashFanSpec } from '../src/lib/slash-fan';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import type { BlueprintGraph, BlueprintNode } from '../src/lib/blueprint/ir';

let fails = 0;
const ok = (cond: boolean, label: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};

// ---------- 夹具（与 verify-slash-shared-def 同构） ----------
function makeNode(id: string, name: string, slotKey: string | null): UnifiedNode {
  return {
    id, name,
    role: 'bone',
    slot: slotKey ? { slotKey } : undefined,
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' },
    sockets: [],
    tracks: {
      angle: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 6, value: 60 }, { frame: 12, value: 0 }] },
    },
    modifiers: [], children: [],
    sprite: undefined as never,
  } as unknown as UnifiedNode;
}
function mkChar(performances: ProcPerformance[], slashDefs?: SlashDefinition[]): Character {
  return {
    id: 'chW', name: '接线刀光',
    nodes: { handW: makeNode('handW', '持剑手', 'hand') },
    rootNodeId: 'handW', rootNodeIds: ['handW'],
    costumeSets: [{
      id: 'set1', name: '默认',
      pieces: { hand: { ...createDefaultCostumePiece('hand'), parametric: createDefaultParametricAppearance() } },
    }],
    activeCostumeSetId: 'set1', variants: {},
    performances,
    ...(slashDefs ? { slashDefs } : {}),
  } as unknown as Character;
}
function mkPerf(patch: Partial<ProcPerformance>): ProcPerformance {
  return {
    id: 'perf1', name: '拔刀斩', trigger: 'attack', duration: 0.8, enabled: true,
    mode: 'add', envelopeIn: 0, envelopeOut: 0, maskNodeIds: [], graphs: {},
    ...patch,
  } as ProcPerformance;
}
const hostGraph = (): BlueprintGraph => ({
  version: 1, outputId: 'out',
  nodes: [
    { id: 't', type: 'time', inputs: {}, params: {} },
    { id: 'out', type: 'transform', inputs: {}, params: {} },
  ],
});
const constNode = (id: string, value: number): BlueprintNode =>
  ({ id, type: 'const', inputs: {}, params: { value } });
const waveNode = (id: string, phase: number): BlueprintNode =>
  ({ id, type: 'waveform', inputs: {}, params: { waveform: 'sine', amplitude: 55, baseValue: 145, phase } });

/** 同步出面板节点后，把源节点与接线挂进表演图（模拟图里存盘的接线） */
function attachWiring(
  perf: ProcPerformance, graphKey: string,
  extraNodes: BlueprintNode[],
  inputs: Record<string, { nodeId: string; output?: string }>,
): void {
  const g = perf.graphs[graphKey]!;
  g.nodes.push(...extraNodes);
  const panel = g.nodes.find((n) => n.id === PANEL_SLASH_NODE_ID)!;
  panel.inputs = { ...panel.inputs, ...inputs };
}

const pkgSlash = (ch: Character, perfId: string) => {
  const pkg = convertCharacterToRuntimePackage(ch, undefined, { frameRate: 12, totalFrames: 24 });
  const perf = pkg.performances.find((p) => (p as { id?: string }).id === perfId) as
    { slash?: Record<string, unknown> } | undefined;
  return perf?.slash;
};

const baseSpec: SlashFanSpec = { ...defaultSlashSpec('handW'), sweepDeg: 90, rx: 30 };
const defW: SlashDefinition = { id: 'defW', name: '居合', spec: baseSpec };

/** 建一台「单表演 + 已同步 + 已接线」的角色并取包内 slash */
function buildAndConvert(
  perfPatch: Partial<ProcPerformance>,
  attach: ((perf: ProcPerformance) => void) | null,
  defs?: SlashDefinition[],
): Record<string, unknown> | undefined {
  const perf = mkPerf({ graphs: { handW: hostGraph() }, ...perfPatch });
  const ch = syncCharacterSlashBlueprints(mkChar([perf], defs));
  const synced = ch.performances![0]!;
  if (attach) attach(synced);
  return pkgSlash(ch, synced.id);
}

// ---------- 1) 数值覆盖 ----------
{
  const slash = buildAndConvert(
    { id: 'p1', slashEffect: baseSpec },
    (perf) => attachWiring(perf, 'handW', [constNode('c200', 200)], { sweepDeg: { nodeId: 'c200', output: 'out' } }),
  );
  ok(!!slash && slash.sweepDeg === 200, '数值覆盖：sweepDeg 接 const 200 → 包内 200（静态 90）');
  ok(!!slash && slash.rx === 30, '数值覆盖：未接线字段 rx 保持静态 30');
}

// ---------- 2) gate ----------
{
  const off = buildAndConvert(
    { id: 'p2a', slashEffect: baseSpec },
    (perf) => attachWiring(perf, 'handW', [constNode('g0', 0)], { gate: { nodeId: 'g0', output: 'out' } }),
  );
  ok(off === undefined, 'gate：接 const 0 → 该表演无刀光');
  const on = buildAndConvert(
    { id: 'p2b', slashEffect: baseSpec },
    (perf) => attachWiring(perf, 'handW', [constNode('g1', 1)], { gate: { nodeId: 'g1', output: 'out' } }),
  );
  ok(!!on && on.sweepDeg === 90, 'gate：接 const 1 → 刀光在且 sweepDeg 为静态 90');
}

// ---------- 3) 绑定共享定义 + 接线覆盖叠加 ----------
{
  const slash = buildAndConvert(
    { id: 'p3', slashDefId: 'defW' },
    (perf) => attachWiring(perf, 'handW', [constNode('c200', 200)], { sweepDeg: { nodeId: 'c200', output: 'out' } }),
    [defW],
  );
  ok(!!slash && slash.sweepDeg === 200, '绑定+覆盖：解引用规格的 sweepDeg 被接线改写为 200');
  ok(!!slash && slash.rx === 30, '绑定+覆盖：其余字段随定义（rx=30）');
}

// ---------- 4) 未接线基线 ----------
{
  const slash = buildAndConvert({ id: 'p4', slashEffect: baseSpec }, null);
  ok(!!slash && slash.sweepDeg === 90 && slash.rx === 30 && slash.thick === baseSpec.thick
    && slash.a0Deg === baseSpec.a0Deg && slash.w === baseSpec.w && slash.h === baseSpec.h,
    '基线：未接线表演包内规格与静态逐值一致');
}

// ---------- 5) 时间型来源取 t=0 ----------
{
  // sine phase=90：t=0 恰为峰值 145+55=200；任意 t>0（小）严格小于 200
  const peak = buildAndConvert(
    { id: 'p5a', slashEffect: baseSpec },
    (perf) => attachWiring(perf, 'handW', [waveNode('wv', 90)], { sweepDeg: { nodeId: 'wv', output: 'out' } }),
  );
  ok(!!peak && peak.sweepDeg === 200, 't=0 取值：waveform phase=90 在 t=0 峰值 200');
  // sine phase=0：t=0 恰为起点 145；任意 t>0（小）严格大于 145
  const start = buildAndConvert(
    { id: 'p5b', slashEffect: baseSpec },
    (perf) => attachWiring(perf, 'handW', [waveNode('wv', 0)], { sweepDeg: { nodeId: 'wv', output: 'out' } }),
  );
  ok(!!start && start.sweepDeg === 145, 't=0 取值：waveform phase=0 在 t=0 起点 145');
}

// ---------- 6) 源节点不存在 → 回落静态 ----------
{
  const slash = buildAndConvert(
    { id: 'p6', slashEffect: baseSpec },
    (perf) => attachWiring(perf, 'handW', [], { sweepDeg: { nodeId: 'ghost-node', output: 'out' } }),
  );
  ok(!!slash && slash.sweepDeg === 90, '悬空接线：源节点不存在 → 回落静态规格（sweepDeg 90、刀光在）');
}

console.log(fails === 0 ? '\n✓ verify-slash-wiring-consume 全部通过' : `\n✗ ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
