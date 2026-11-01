// ============================================================
// 蓝图「时序编排」pattern_cue 节点探针
//
// 覆盖三件事：
//  1) cue 求值语义：对求值器喂时间序列（frameRate=10，帧步 0.1s），
//     断言 value 阶梯（含 hold 过期回落、无 cue 生效回 0）、pulse
//     事件窗口、hitstop/shake 只在窗口内给出、cycleSec 循环回绕
//     重复触发、缺省示例 cues 的行为。
//  2) 端到端接线覆盖：pattern_cue.value → dynamic_pattern 节点的
//     glowStrength 输入，经常渲染同路（resolvePatternsFromGraph +
//     evaluateNodeOutput 回调，与 unified-render 同口径）解析，
//     断言图案参数被逐帧驱动；不传回调（进包口径）时 params 固化。
//  3) 注册完整性：specs 端口/参数、中文标签、加节点菜单来源
//     （listBlueprintNodeTypes = EVALUATORS 键）三处都在。
//
// 还原自查：把 eval.ts 里 pattern_cue 阶梯值的胜出条件
// `if (d < bestD)` 改成 `if (d > bestD)`，第 1 部分的 value
// 断言应转红（已实测，见提交说明）。
// ============================================================

import { evaluateNodeOutput } from '../src/lib/blueprint/eval';
import { getBlueprintNodeLabel, listBlueprintNodeTypes } from '../src/lib/blueprint/eval';
import { getNodeInputs, getNodeOutputs, getNodeParamPorts } from '../src/lib/blueprint/specs';
import { patternNodeForInstance, resolvePatternsFromGraph } from '../src/lib/blueprint/pattern-sync';
import { normalizeDynamicParams, type DynamicPatternInstance } from '../src/lib/dynamic-patterns';
import type { BlueprintGraph, BlueprintNode, BlueprintValue } from '../src/lib/blueprint/ir';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, got === want, `got=${String(got)} want=${String(want)}`);
}

const FRAME_RATE = 10;
function outAt(graph: BlueprintGraph, nodeId: string, frame: number): Record<string, number> {
  const outs = evaluateNodeOutput(graph, nodeId, {
    frame, frameRate: FRAME_RATE, vars: {},
  } as never) as Record<string, BlueprintValue> | null;
  const r: Record<string, number> = {};
  for (const [k, v] of Object.entries(outs ?? {})) {
    if (v && typeof v === 'object' && (v as { type?: string }).type === 'number') {
      r[k] = (v as { value: number }).value;
    }
  }
  return r;
}

function cueGraph(cueParams: Record<string, unknown>): BlueprintGraph {
  const cueNode: BlueprintNode = {
    id: 'cue1',
    type: 'pattern_cue',
    inputs: { t: { nodeId: 'tm', output: 'out' } },
    params: cueParams as BlueprintNode['params'],
  };
  return {
    version: 1,
    outputId: 'cue1',
    nodes: [
      { id: 'tm', type: 'time', inputs: {}, params: {} },
      cueNode,
    ],
  };
}

// ---------- 1) cue 求值语义 ----------
console.log('[1] cue 求值：阶梯/hold 回落/事件窗口');
{
  const g = cueGraph({
    cues: JSON.stringify([
      { at: 0.2, value: 5 },
      { at: 0.5, value: 9, hold: 0.2, hitstop: 0.12, shake: 4 },
      { at: 1.0, value: 3, shake: 2 },
    ]),
    pulseWidth: 0.25,
  });
  const at = (f: number) => outAt(g, 'cue1', f);
  eq('t=0.0 无 cue 生效 value=0', at(0).value, 0);
  eq('t=0.0 pulse=0', at(0).pulse, 0);
  eq('t=0.2 cue1 触发 value=5', at(2).value, 5);
  eq('t=0.2 pulse=1', at(2).pulse, 1);
  eq('t=0.2 该 cue 无事件量 hitstop=0', at(2).hitstop, 0);
  eq('t=0.4 窗口内 pulse 仍为 1（d=0.2<0.25）', at(4).pulse, 1);
  eq('t=0.5 cue2 触发 value=9', at(5).value, 9);
  eq('t=0.5 hitstop=0.12', at(5).hitstop, 0.12);
  eq('t=0.5 shake=4', at(5).shake, 4);
  eq('t=0.6 hold 内 value=9', at(6).value, 9);
  eq('t=0.7 hold 过期回落 cue1 value=5', at(7).value, 5);
  eq('t=0.7 事件窗口未过 hitstop 仍给出', at(7).hitstop, 0.12);
  eq('t=0.8 事件窗口过 pulse=0', at(8).pulse, 0);
  eq('t=0.8 value=5', at(8).value, 5);
  eq('t=1.0 cue3 触发 value=3', at(10).value, 3);
  eq('t=1.0 shake=2', at(10).shake, 2);
  eq('t=1.0 hitstop=0（cue3 未设）', at(10).hitstop, 0);
  eq('t=1.3 pulse=0、value 保持 3', at(13).pulse, 0);
  eq('t=1.3 value=3', at(13).value, 3);
  eq('out 别名与 value 同值', at(5).out, 9);
}

console.log('[1b] cue 求值：循环回绕');
{
  const g = cueGraph({
    cues: JSON.stringify([
      { at: 0.2, value: 5 },
      { at: 0.7, value: 8 },
    ]),
    cycleSec: 1.0,
  });
  const at = (f: number) => outAt(g, 'cue1', f);
  eq('t=0.2 value=5 pulse=1', at(2).value, 5);
  eq('t=0.2 pulse=1（缺省窗口一帧）', at(2).pulse, 1);
  eq('t=0.5 value=5（圈内 cue1 最近）', at(5).value, 5);
  eq('t=0.5 pulse=0', at(5).pulse, 0);
  eq('t=0.7 value=8', at(7).value, 8);
  eq('t=1.2 回绕后 cue1 再触发 value=5', at(12).value, 5);
  eq('t=1.2 pulse=1', at(12).pulse, 1);
  eq('t=1.7 第二圈 cue2 value=8', at(17).value, 8);
  eq('t=2.2 第三圈 cue1 value=5', at(22).value, 5);
}

console.log('[1c] cue 求值：缺省示例与坏数据');
{
  const g = cueGraph({});
  const at = (f: number) => outAt(g, 'cue1', f);
  eq('无 cues 参数 → 缺省示例 t=0 value=1', at(0).value, 1);
  eq('缺省示例 t=0.5 value=2', at(5).value, 2);
  eq('缺省示例 t=0.5 hitstop=0.08', at(5).hitstop, 0.08);
  eq('缺省示例 t=0.5 shake=3', at(5).shake, 3);
  const bad = cueGraph({ cues: '{not json' });
  eq('坏 JSON 回落缺省示例 value=1', outAt(bad, 'cue1', 0).value, 1);
}

// ---------- 2) 端到端：cue → dynamic_pattern 参数覆盖 ----------
console.log('[2] cue → 图案参数覆盖（渲染同路 / 进包固化）');
{
  const inst: DynamicPatternInstance = {
    id: 'inst-cue-e2e',
    slot: 'fx',
    enabled: true,
    params: normalizeDynamicParams({ glowEnabled: true, glowStrength: 0.25 } as never),
  };
  const dynNode = patternNodeForInstance(inst, { mount: 'node' });
  dynNode.inputs = {
    t: { nodeId: 'tm', output: 'out' },
    glowStrength: { nodeId: 'cue1', output: 'value' },
  };
  const graph: BlueprintGraph = {
    version: 1,
    outputId: dynNode.id,
    nodes: [
      { id: 'tm', type: 'time', inputs: {}, params: {} },
      {
        id: 'cue1',
        type: 'pattern_cue',
        inputs: { t: { nodeId: 'tm', output: 'out' } },
        params: {
          cues: JSON.stringify([
            { at: 0, value: 0.5 },
            { at: 0.3, value: 1.8 },
          ]),
        },
      },
      dynNode,
    ],
  };
  const evalCb = (frame: number) => (srcId: string) => {
    try {
      return evaluateNodeOutput(graph, srcId, {
        frame, frameRate: FRAME_RATE, vars: {},
      } as never) as Record<string, unknown> | null;
    } catch { return null; }
  };
  const glowAt = (frame: number) =>
    resolvePatternsFromGraph(graph, undefined, evalCb(frame))[0]?.instance.params.glowStrength;
  eq('帧 0（t=0）glowStrength 被驱动为 0.5', glowAt(0), 0.5);
  eq('帧 2（t=0.2）仍为 0.5', glowAt(2), 0.5);
  eq('帧 3（t=0.3）跳为 1.8', glowAt(3), 1.8);
  eq('帧 9（t=0.9）保持 1.8', glowAt(9), 1.8);
  const frozen = resolvePatternsFromGraph(graph, undefined)[0]?.instance.params.glowStrength;
  eq('无求值回调（进包口径）glowStrength 固化为 params 原值 0.25', frozen, 0.25);
}

// ---------- 3) 注册完整性 ----------
console.log('[3] 注册：specs/标签/菜单来源');
{
  check('加节点菜单来源含 pattern_cue', listBlueprintNodeTypes().includes('pattern_cue'));
  eq('中文标签为「时序编排」', getBlueprintNodeLabel('pattern_cue'), '时序编排');
  check('specs 输出含 value/pulse/hitstop/shake',
    ['value', 'pulse', 'hitstop', 'shake'].every((p) => getNodeOutputs('pattern_cue').includes(p)));
  check('specs 输入含 t', getNodeInputs('pattern_cue').includes('t'));
  check('specs 参数含 cues/cycleSec/pulseWidth',
    ['cues', 'cycleSec', 'pulseWidth'].every((p) => getNodeParamPorts('pattern_cue').includes(p)));
  check('dynamic_pattern 参数表含 glowStrength（接法成立）',
    getNodeParamPorts('dynamic_pattern').includes('glowStrength'));
}

console.log(`\n结果：${passed} 过 / ${failed} 红`);
process.exit(failed > 0 ? 1 : 0);
