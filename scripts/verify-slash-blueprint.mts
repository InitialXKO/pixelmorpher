// 刀光↔蓝图统一校验（表演侧；片段无图、维持字段口径不在此范围）：
// 1) 规格↔slash_fan 节点无损往返（colors/durationSec 有无两态）
// 2) 图为唯一出处：字段-only（未同步）读侧镜像 ≡ 同步落图后解析 ≡ 进包；
//    图内手加节点（无字段）照样解析与进包；字段+手加并存时面板优先
// 3) syncPerfSlash 手术式：他人节点同引用、面板节点接线/ui 保留、
//    锚点变更迁图、删规格删节点、无变化同引用
// 4) 接线覆盖：const 接 rx/sweepDeg 生效、gate=0 关闭（真求值）
// 5) 迁移幂等：syncCharacterSlashBlueprints 二跑无变化（同引用）
// 6) convert 清洁：掩码图含刀光节点时翻译结果与无刀光节点逐项一致、
//    不产生 slash_fan 不支持点名
import { createDefaultCostumePiece, type Character, type ProcPerformance, type UnifiedNode } from '../src/lib/unified-types';
import {
  SLASH_NODE_TYPE, PANEL_SLASH_NODE_ID,
  slashNodeForSpec, specFromSlashNode, collectPerfSlashCandidates,
  resolvePerfSlash, syncPerfSlash, syncCharacterSlashBlueprints,
} from '../src/lib/blueprint/slash-sync';
import { defaultSlashSpec, type SlashFanSpec } from '../src/lib/slash-fan';
import { evaluateNodeOutput } from '../src/lib/blueprint/eval';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import type { BlueprintGraph } from '../src/lib/blueprint/ir';

let fails = 0;
const ok = (cond: boolean, label: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const specFull: SlashFanSpec = {
  ...defaultSlashSpec('handW'),
  durationSec: 0.45, frameCount: 8, rx: 31,
  colors: ['#ffffff', '#ffee00', '#ff0000'],
};
const specMin: SlashFanSpec = defaultSlashSpec('handW');

// ---------- 1. 往返无损 ----------
{
  const back1 = specFromSlashNode(slashNodeForSpec(specFull));
  ok(!!back1 && eq(back1.spec, specFull) && back1.enabled === true, '往返：全规格（colors/durationSec）无损');
  const back2 = specFromSlashNode(slashNodeForSpec(specMin));
  ok(!!back2 && eq(back2.spec, specMin), '往返：缺省规格（无 colors/durationSec）无损');
  ok(specFromSlashNode({ id: 'x', type: 'sin', inputs: {}, params: {} }) === null, '往返：非刀光节点返回 null');
}

// ---------- 夹具 ----------
function makeNode(id: string, name: string, slotKey: string | null): UnifiedNode {
  return {
    id, name,
    role: 'bone',
    slot: slotKey ? { slotKey } : undefined,
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' },
    sockets: [], tracks: {}, modifiers: [], children: [],
    sprite: undefined as never,
  } as unknown as UnifiedNode;
}
function mkChar(performances: ProcPerformance[]): Character {
  return {
    id: 'chS', name: '刀光蓝图',
    nodes: { handW: makeNode('handW', '持剑手', 'hand') },
    rootNodeId: 'handW', rootNodeIds: ['handW'],
    costumeSets: [{
      id: 'set1', name: '默认',
      pieces: { hand: { ...createDefaultCostumePiece('hand'), parametric: createDefaultParametricAppearance() } },
    }],
    activeCostumeSetId: 'set1', variants: {},
    performances,
  } as unknown as Character;
}
function mkPerf(patch: Partial<ProcPerformance>): ProcPerformance {
  return {
    id: 'perf1', name: '拔刀斩', trigger: 'attack', duration: 0.8, enabled: true,
    mode: 'add', envelopeIn: 0, envelopeOut: 0, maskNodeIds: [], graphs: {},
    ...patch,
  } as ProcPerformance;
}
const pkgSlashOf = (ch: Character, perfId: string) => {
  const pkg = convertCharacterToRuntimePackage(ch, undefined, { frameRate: 12 });
  const perf = pkg.performances.find((p) => (p as { id?: string }).id === perfId) as
    { slash?: Record<string, unknown> } | undefined;
  return { slash: perf?.slash, warnings: pkg.warnings };
};

// ---------- 2. 图为唯一出处 ----------
{
  // 2a 字段-only（未落盘同步）：读侧镜像解析 ≡ 字段；进包正常
  const perfField = mkPerf({ id: 'perfField', slashEffect: specFull });
  ok(eq(resolvePerfSlash(perfField), specFull), '出处：未同步数据读侧镜像 = 字段规格');
  const before = pkgSlashOf(mkChar([perfField]), 'perfField');
  ok(!!before.slash && before.slash.anchor === 'hand' && before.slash.frameCount === 8,
    '出处：未同步数据刀光照常进包');

  // 2b 同步落图后：面板节点出现、解析与进包与落图前逐项一致
  const synced = syncCharacterSlashBlueprints(mkChar([perfField]));
  const perfSynced = synced.performances![0]!;
  const cands = collectPerfSlashCandidates(perfSynced);
  ok(cands.length === 1 && cands[0]!.isPanel && cands[0]!.graphKey === 'handW',
    '出处：同步后面板节点落锚点图');
  ok(eq(resolvePerfSlash(perfSynced), specFull), '出处：落图后解析 = 字段规格');
  const after = pkgSlashOf(synced, 'perfField');
  ok(eq(after.slash, before.slash), '出处：落图前后进包 slash 逐项一致');

  // 2c 图内手加（无字段）：解析与进包都认
  const handSpec: SlashFanSpec = { ...defaultSlashSpec('handW'), rx: 44, frameCount: 5 };
  const handNode = { ...slashNodeForSpec(handSpec), id: 'my_slash' };
  const hostGraph: BlueprintGraph = {
    version: 1, outputId: 'out',
    nodes: [
      { id: 't', type: 'time', inputs: {}, params: {} },
      { id: 'out', type: 'transform', inputs: {}, params: {} },
      handNode,
    ],
  };
  const perfGraphOnly = mkPerf({ id: 'perfGraph', graphs: { handW: hostGraph } });
  const resolved = resolvePerfSlash(perfGraphOnly);
  ok(!!resolved && resolved.rx === 44 && resolved.frameCount === 5, '出处：手加节点被解析认到');
  const pkgG = pkgSlashOf(mkChar([perfGraphOnly]), 'perfGraph');
  ok(!!pkgG.slash && pkgG.slash.rx === 44, '出处：手加节点刀光进包');

  // 2d 字段 + 手加并存（无面板节点）：面板（字段）优先
  const perfBoth = mkPerf({ id: 'perfBoth', slashEffect: specMin, graphs: { handW: hostGraph } });
  ok(eq(resolvePerfSlash(perfBoth), specMin), '出处：字段与手加并存 → 面板优先');
}

// ---------- 3. 手术式同步 ----------
{
  const sinNode = { id: 'sin1', type: 'sin', inputs: { x: { nodeId: 't' } }, params: { amplitude: 1 } } as never;
  const baseGraph: BlueprintGraph = {
    version: 1, outputId: 'out',
    nodes: [
      { id: 't', type: 'time', inputs: {}, params: {} },
      sinNode as never,
      { id: 'out', type: 'transform', inputs: {}, params: {} },
    ],
  };
  const perf = mkPerf({ slashEffect: specMin, maskNodeIds: ['handW'], graphs: { handW: baseGraph } });
  const s1 = syncPerfSlash(perf);
  const g1 = s1.graphs['handW']!;
  const panelNode = g1.nodes.find((n) => n.id === PANEL_SLASH_NODE_ID);
  ok(!!panelNode && panelNode.type === SLASH_NODE_TYPE, '同步：面板节点插入锚点图');
  ok(g1.nodes.find((n) => n.id === 'sin1') === (sinNode as unknown), '同步：他人节点原样（同引用）');
  ok(perf.graphs['handW'] === baseGraph, '同步：原图未被改动（不可变）');

  // 接线 + ui 后改参数再同步 → params 更新、接线与 ui 保留
  const wired: ProcPerformance = {
    ...s1,
    graphs: {
      handW: {
        ...g1,
        nodes: g1.nodes.map((n) => n.id === PANEL_SLASH_NODE_ID
          ? { ...n, inputs: { rx: { nodeId: 'sin1', output: 'out' } }, ui: { x: 7, y: 9 } }
          : n),
      },
    },
  };
  const s2 = syncPerfSlash({ ...wired, slashEffect: { ...specMin, rx: 99 } });
  const pn2 = s2.graphs['handW']!.nodes.find((n) => n.id === PANEL_SLASH_NODE_ID)!;
  ok(pn2.params.rx === 99 && (pn2.inputs as never)['rx'] !== undefined && pn2.ui?.x === 7,
    '同步：更新 params、保留接线与布局');

  // 锚点变更 → 节点迁图（接线随行），旧图他人节点不动
  const s3 = syncPerfSlash({ ...s2, slashEffect: { ...specMin, rx: 99, anchorNodeId: 'armW' } });
  ok(!s3.graphs['handW']!.nodes.some((n) => n.type === SLASH_NODE_TYPE)
    && s3.graphs['handW']!.nodes.length === 3, '同步：迁出后旧图只剩原节点');
  const pn3 = s3.graphs['armW']!.nodes.find((n) => n.id === PANEL_SLASH_NODE_ID)!;
  ok(!!pn3 && (pn3.inputs as never)['rx'] !== undefined, '同步：节点迁入新锚点图、接线随行');

  // 删规格 → 节点删、其余不动；再同步 → 同引用
  const s4 = syncPerfSlash({ ...s3, slashEffect: undefined });
  ok(!Object.values(s4.graphs).some((g) => g.nodes.some((n) => n.type === SLASH_NODE_TYPE)),
    '同步：删规格 → 面板节点删除');
  ok(syncPerfSlash(s4) === s4, '同步：无变化时返回原引用');
}

// ---------- 4. 接线覆盖 ----------
{
  const graph: BlueprintGraph = {
    version: 1, outputId: 'out',
    nodes: [
      { id: 't', type: 'time', inputs: {}, params: {} },
      { id: 'c_rx', type: 'const', inputs: {}, params: { value: 48 } },
      { id: 'c_sw', type: 'const', inputs: {}, params: { value: 200 } },
      { id: 'c_gate', type: 'const', inputs: {}, params: { value: 1 } },
      { id: 'out', type: 'transform', inputs: {}, params: {} },
      {
        ...slashNodeForSpec(specMin),
        inputs: {
          rx: { nodeId: 'c_rx', output: 'out' },
          sweepDeg: { nodeId: 'c_sw', output: 'out' },
          gate: { nodeId: 'c_gate', output: 'out' },
        },
      },
    ],
  };
  const perf = mkPerf({ graphs: { handW: graph } });
  const evalCb = (g: BlueprintGraph, srcId: string) =>
    evaluateNodeOutput(g, srcId, { frame: 0, frameRate: 60, vars: {} } as never) as Record<string, unknown> | null;
  const driven = resolvePerfSlash(perf, evalCb);
  ok(!!driven && driven.rx === 48 && driven.sweepDeg === 200,
    `接线覆盖：rx/sweepDeg 被 const 驱动（实得 rx=${driven?.rx} sweep=${driven?.sweepDeg}）`);
  const gated: BlueprintGraph = {
    ...graph,
    nodes: graph.nodes.map((n) => n.id === 'c_gate' ? { ...n, params: { value: 0 } } : n),
  };
  ok(resolvePerfSlash({ ...perf, graphs: { handW: gated } }, evalCb) === undefined,
    '接线覆盖：gate=0 → 本次解析视作关闭');
  ok(eq(resolvePerfSlash(perf), specMin), '接线覆盖：不传求值回调时按 params 固化（进包口径）');
}

// ---------- 5. 迁移幂等 ----------
{
  const chOld = mkChar([mkPerf({ id: 'perfOld', slashEffect: specFull })]);
  const once = syncCharacterSlashBlueprints(chOld);
  ok(once !== chOld && collectPerfSlashCandidates(once.performances![0]!).length === 1,
    '迁移：存量表演落图出面板节点');
  const twice = syncCharacterSlashBlueprints(once);
  ok(twice === once, '迁移：二跑无变化（同引用、不重复建节点）');
  const noSlash = mkChar([mkPerf({ id: 'perfNone' })]);
  ok(syncCharacterSlashBlueprints(noSlash) === noSlash, '迁移：无刀光表演零改动');
}

// ---------- 6. convert 翻译清洁 ----------
{
  const poseGraph: BlueprintGraph = {
    version: 1, outputId: 'out',
    nodes: [
      { id: 't', type: 'time', inputs: {}, params: {} },
      {
        id: 'kf', type: 'keyframes',
        inputs: { t: { nodeId: 't', output: 'out' } },
        params: { frames: '[0,1]', values: '[0,60]', interpolation: 'linear' },
      },
      { id: 'out', type: 'transform', inputs: { rotation: { nodeId: 'kf', output: 'out' } }, params: {} },
    ],
  };
  const perfClean = mkPerf({ id: 'perfPose', maskNodeIds: ['handW'], graphs: { handW: poseGraph } });
  const perfWithSlash = mkPerf({
    id: 'perfPose', maskNodeIds: ['handW'], slashEffect: specMin,
    graphs: { handW: { ...poseGraph, nodes: [...poseGraph.nodes, slashNodeForSpec(specMin)] } },
  });
  const pkgA = convertCharacterToRuntimePackage(mkChar([perfClean]), undefined, { frameRate: 12 });
  const pkgB = convertCharacterToRuntimePackage(mkChar([perfWithSlash]), undefined, { frameRate: 12 });
  const gA = (pkgA.performances.find((p) => (p as { id?: string }).id === 'perfPose') as { graph?: unknown })?.graph;
  const gB = (pkgB.performances.find((p) => (p as { id?: string }).id === 'perfPose') as { graph?: unknown; slash?: unknown })!;
  ok(eq(gA, gB?.graph), 'convert：含刀光节点的图翻译与无刀光逐项一致');
  ok(!!gB?.slash, 'convert：姿态表演的刀光同时进包');
  ok(!pkgB.warnings.some((w) => w.includes('slash_fan')), 'convert：不产生 slash_fan 不支持点名');
}

console.log(fails === 0 ? 'SLASH BLUEPRINT PROBE PASS' : `SLASH BLUEPRINT PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
