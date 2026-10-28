// 刀光共享定义校验（角色级一处存、片段+表演两处活引用）：
// 1) 一份定义被一片段 + 一表演同时绑定，改定义 → 表演解析 / 片段
//    解析 / convert 两路输出（作者表演 + 段表演）同时取到新规格
// 2) 活引用证据：定义变更后未触发任何表演侧同步，convert 已反映
//    新规格；同步对引用形态零改动（同引用返回）；图节点仍是引用
//    形态（参数只有 enabled/__defId，无规格副本落盘）
// 3) 解绑物化：解绑瞬间解析逐项一致；其后定义再变、该 owner 不变
// 4) 悬空：解析为无刀光、convert 点名（表演/片段各一）；引用计数
//    口径（删除预防）含归属过滤
// 5) 边角：改名不影响解析、两表演抢同一定义、空定义表回落私有
//    字段、defs 缺省时绑定即悬空不崩
// 6) 编辑面源级断言：两挂载点都传 defBinding、编辑器含共享定义区
import { readFileSync } from 'node:fs';
import { createDefaultCostumePiece, type Character, type ProcPerformance, type SlashDefinition, type UnifiedNode } from '../src/lib/unified-types';
import {
  PANEL_SLASH_NODE_ID, collectPerfSlashCandidates,
  resolvePerfSlash, syncCharacterSlashBlueprints, syncPerfSlash,
} from '../src/lib/blueprint/slash-sync';
import { cloneSlashSpec, countSlashDefRefs, findSlashDef, resolveClipSlash } from '../src/lib/slash-defs';
import { evaluateNodeOutput } from '../src/lib/blueprint/eval';
import { defaultSlashSpec, type SlashFanSpec } from '../src/lib/slash-fan';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import type { AnimationClip } from '../src/lib/types';
import type { BlueprintGraph } from '../src/lib/blueprint/ir';

let fails = 0;
const ok = (cond: boolean, label: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------- 夹具 ----------
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
    id: 'chS', name: '共享刀光',
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
function mkClip(patch: Partial<AnimationClip>): AnimationClip {
  return {
    id: 'clipX', name: '挥斩', puppetCharacterId: 'chS', startFrame: 3, endFrame: 8, loop: true,
    effectTracks: [], canvasModifierTracks: [], trajectories: [], motionBlurStrokes: [], effectStrokes: [],
    ...patch,
  } as AnimationClip;
}
const hostGraph = (): BlueprintGraph => ({
  version: 1, outputId: 'out',
  nodes: [
    { id: 't', type: 'time', inputs: {}, params: {} },
    { id: 'out', type: 'transform', inputs: {}, params: {} },
  ],
});
const pkgOf = (ch: Character, clips?: AnimationClip[]) =>
  convertCharacterToRuntimePackage(ch, undefined, { frameRate: 12, totalFrames: 24, clips });
const pkgSlash = (ch: Character, perfId: string, clips?: AnimationClip[]) => {
  const pkg = pkgOf(ch, clips);
  const perf = pkg.performances.find((p) => (p as { id?: string }).id === perfId) as
    { slash?: Record<string, unknown> } | undefined;
  return { slash: perf?.slash, warnings: pkg.warnings };
};

const specV1: SlashFanSpec = { ...defaultSlashSpec('handW'), rx: 30 };
const defV1: SlashDefinition = { id: 'def1', name: '居合', spec: specV1 };
const defV2: SlashDefinition = { id: 'def1', name: '居合', spec: { ...specV1, rx: 48 } };

// ---------- 1. 三路同变 ----------
{
  const perfBound = mkPerf({ id: 'perfB', slashDefId: 'def1', graphs: { handW: hostGraph() } });
  const clipBound = mkClip({ id: 'clipB', slashDefId: 'def1' });
  const ch1 = syncCharacterSlashBlueprints(mkChar([perfBound], [defV1]));
  const perfSynced = ch1.performances![0]!;

  const cands = collectPerfSlashCandidates(perfSynced);
  ok(cands.length === 1 && cands[0]!.isPanel && cands[0]!.refDefId === 'def1' && cands[0]!.data === null,
    '三路：同步后表演图面板节点为引用形态');
  ok(eq(resolvePerfSlash(perfSynced, undefined, ch1.slashDefs), specV1),
    '三路：表演解析 = 定义规格 v1');
  ok(eq(resolveClipSlash(clipBound, ch1.slashDefs), specV1),
    '三路：片段解析 = 定义规格 v1');
  const pkgA = pkgSlash(ch1, 'perfB');
  ok(!!pkgA.slash && pkgA.slash.rx === 30, '三路：convert 作者表演 slash rx=30');
  const pkgSegA = pkgSlash(ch1, 'clip_clipB', [clipBound]);
  ok(!!pkgSegA.slash && pkgSegA.slash.rx === 30, '三路：convert 段表演 slash rx=30');

  // 定义变更：只换 slashDefs 数组，perf / clip 对象一字不动、不跑同步
  const ch2: Character = { ...ch1, slashDefs: [defV2] };
  ok(eq(resolvePerfSlash(perfSynced, undefined, ch2.slashDefs), defV2.spec),
    '三路：定义改版后表演解析 = v2（活引用）');
  ok(eq(resolveClipSlash(clipBound, ch2.slashDefs), defV2.spec),
    '三路：定义改版后片段解析 = v2（活引用）');
  const pkgB = pkgSlash(ch2, 'perfB');
  ok(!!pkgB.slash && pkgB.slash.rx === 48, '三路：convert 作者表演 slash rx=48（未触发同步）');
  const pkgSegB = pkgSlash(ch2, 'clip_clipB', [clipBound]);
  ok(!!pkgSegB.slash && pkgSegB.slash.rx === 48, '三路：convert 段表演 slash rx=48（未触发同步）');

  // ---------- 2. 活引用证据 ----------
  ok(ch2.performances![0] === perfSynced, '活引用：定义变更全程 perf 对象同引用未动');
  ok(syncCharacterSlashBlueprints(ch2) === ch2,
    '活引用：定义变更后同步对引用形态零改动（角色同引用返回）');
  const node = perfSynced.graphs['handW']!.nodes.find((n) => n.id === PANEL_SLASH_NODE_ID)!;
  ok(eq(Object.keys(node.params).sort(), ['__defId', 'enabled']),
    '活引用：图节点参数只有 enabled/__defId（无规格副本落盘）');

  // 未落盘同步（无图/无节点）时绑定字段读侧镜像同样活引用
  const perfRaw = mkPerf({ id: 'perfRaw', slashDefId: 'def1' });
  ok(eq(resolvePerfSlash(perfRaw, undefined, [defV2]), defV2.spec),
    '活引用：未落盘数据经绑定字段镜像解引用 = v2');
}

// ---------- 3. 解绑物化 ----------
{
  const perfBound = mkPerf({ id: 'perfB', slashDefId: 'def1', graphs: { handW: hostGraph() } });
  const ch1 = syncCharacterSlashBlueprints(mkChar([perfBound], [defV1]));
  const perfSynced = ch1.performances![0]!;
  const before = resolvePerfSlash(perfSynced, undefined, ch1.slashDefs);

  // 物化（与挂载点 onUnbind 同动作）：规格复制回字段、清绑定，再同步落图
  const materialized = syncPerfSlash(
    { ...perfSynced, slashEffect: cloneSlashSpec(defV1.spec), slashDefId: undefined },
    ch1.slashDefs,
  );
  ok(eq(resolvePerfSlash(materialized, undefined, [{ ...defV1, spec: { ...specV1, rx: 99 } }]), before),
    '解绑：物化后解析与解绑前逐项一致、且不再随定义变');
  const mc = collectPerfSlashCandidates(materialized);
  ok(mc.length === 1 && mc[0]!.refDefId === undefined && !!mc[0]!.data && mc[0]!.data.spec.rx === 30,
    '解绑：图节点回到规格形态（私有参数落盘）');

  const clipBound = mkClip({ id: 'clipB', slashDefId: 'def1' });
  const clipBefore = resolveClipSlash(clipBound, [defV1]);
  const clipMat: AnimationClip = { ...clipBound, slashEffect: cloneSlashSpec(defV1.spec), slashDefId: undefined };
  ok(eq(resolveClipSlash(clipMat, [{ ...defV1, spec: { ...specV1, rx: 99 } }]), clipBefore),
    '解绑：片段物化后解析一致、且不再随定义变');
}

// ---------- 3b. 引用形态的接线覆盖（解引用 → 叠接线） ----------
{
  const graph: BlueprintGraph = {
    version: 1, outputId: 'out',
    nodes: [
      { id: 't', type: 'time', inputs: {}, params: {} },
      { id: 'c_rx', type: 'const', inputs: {}, params: { value: 77 } },
      { id: 'c_gate', type: 'const', inputs: {}, params: { value: 1 } },
      { id: 'out', type: 'transform', inputs: {}, params: {} },
      {
        id: PANEL_SLASH_NODE_ID, type: 'slash_fan',
        inputs: {
          rx: { nodeId: 'c_rx', output: 'out' },
          gate: { nodeId: 'c_gate', output: 'out' },
        },
        params: { enabled: true, __defId: 'def1' },
      },
    ],
  };
  const perfRef = mkPerf({ id: 'perfW', slashDefId: 'def1', graphs: { handW: graph } });
  const evalCb = (g: BlueprintGraph, srcId: string) =>
    evaluateNodeOutput(g, srcId, { frame: 0, frameRate: 60, vars: {} } as never) as Record<string, unknown> | null;
  const driven = resolvePerfSlash(perfRef, evalCb, [defV1]);
  ok(!!driven && driven.rx === 77 && driven.frameCount === specV1.frameCount,
    '接线覆盖：引用形态先解引用（其余参数=定义）、rx 被 const 覆盖');
  ok(eq(resolvePerfSlash(perfRef, undefined, [defV1]), specV1),
    '接线覆盖：不传求值回调时引用规格原样（进包口径）');
  const gated: BlueprintGraph = {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === 'c_gate' ? { ...n, params: { value: 0 } } : n)),
  };
  ok(resolvePerfSlash({ ...perfRef, graphs: { handW: gated } }, evalCb, [defV1]) === undefined,
    '接线覆盖：引用形态 gate=0 → 关闭');
}

// ---------- 4. 悬空 ----------
{
  const perfGhost = mkPerf({ id: 'perfG', slashDefId: 'ghost', graphs: { handW: hostGraph() } });
  const chG = syncCharacterSlashBlueprints(mkChar([perfGhost], [defV1]));
  ok(resolvePerfSlash(chG.performances![0], undefined, chG.slashDefs) === undefined,
    '悬空：表演解析为无刀光（不回落私有字段）');
  const pkgG = pkgSlash(chG, 'perfG');
  ok(!pkgG.slash && pkgG.warnings.some((w) => w.includes('拔刀斩') && w.includes('引用的共享定义')),
    '悬空：convert 点名表演悬空引用、未进包');

  const clipGhost = mkClip({ id: 'clipG', name: '幽灵斩', slashDefId: 'ghost' });
  ok(resolveClipSlash(clipGhost, [defV1]) === undefined, '悬空：片段解析为无刀光');
  const pkgCG = pkgSlash(mkChar([], [defV1]), 'clip_clipG', [clipGhost]);
  ok(pkgCG.warnings.some((w) => w.includes('幽灵斩') && w.includes('引用的共享定义')),
    '悬空：convert 点名片段悬空引用');

  const chCount = mkChar([mkPerf({ id: 'p1', slashDefId: 'def1' }), mkPerf({ id: 'p2' })], [defV1]);
  const clips: AnimationClip[] = [
    mkClip({ id: 'c1', slashDefId: 'def1' }),
    mkClip({ id: 'c2', slashDefId: 'def1', puppetCharacterId: 'someone-else' }),
    mkClip({ id: 'c3' }),
  ];
  ok(countSlashDefRefs(chCount, clips, 'def1') === 2,
    '悬空预防：引用计数 = 本角色 1 表演 + 1 片段（他人片段不计）');
  ok(countSlashDefRefs(chCount, clips, 'nope') === 0, '悬空预防：未引用定义计数 0（可删）');
}

// ---------- 5. 边角 ----------
{
  const renamed: SlashDefinition = { ...defV1, name: '改名居合' };
  ok(findSlashDef([renamed], 'def1')?.name === '改名居合'
    && eq(resolveClipSlash(mkClip({ slashDefId: 'def1' }), [renamed]), specV1),
  '边角：改名不影响按 id 解析');

  const pA = mkPerf({ id: 'pA', slashDefId: 'def1' });
  const pB = mkPerf({ id: 'pB', slashDefId: 'def1' });
  ok(eq(resolvePerfSlash(pA, undefined, [defV1]), specV1)
    && eq(resolvePerfSlash(pB, undefined, [defV1]), specV1),
  '边角：两表演抢同一定义、各自解引用一致');

  const clipPriv = mkClip({ id: 'cP', slashEffect: { ...specV1, rx: 12 } });
  ok(resolveClipSlash(clipPriv, [])?.rx === 12 && resolveClipSlash(clipPriv, undefined)?.rx === 12,
    '边角：空定义表/无定义表时未绑定片段回落私有字段（老口径）');
  ok(resolveClipSlash(mkClip({ slashDefId: 'def1' }), undefined) === undefined,
    '边角：defs 缺省时绑定即悬空（undefined、不崩）');
}

// ---------- 6. 编辑面源级断言 ----------
{
  const editor = readFileSync('src/components/pixel-editor/puppet/SlashEffectEditor.tsx', 'utf8');
  ok(editor.includes('共享定义') && editor.includes('解绑') && editor.includes('存为定义')
    && editor.includes('引用的共享定义已不存在'),
  '编辑面：编辑器含共享定义区（绑定/存为/改名/解绑/删除/悬空提示）');
  const bp = readFileSync('src/components/pixel-editor/puppet/BehaviorPanel.tsx', 'utf8');
  ok(bp.includes('defBinding'), '编辑面：行为面板挂载点传 defBinding');
  const cp = readFileSync('src/components/pixel-editor/AnimationClipPanel.tsx', 'utf8');
  ok(cp.includes('defBinding'), '编辑面：片段面板挂载点传 defBinding');
}

console.log(fails === 0 ? 'SLASH SHARED DEF PROBE PASS' : `SLASH SHARED DEF PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
