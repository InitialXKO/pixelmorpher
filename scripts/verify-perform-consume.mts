// ============================================================
// 表演事件消费探针：pattern_cue 的 hitstop/shake 输出在蓝图侧只
// 给值，消费链 = PixelCanvas 渲染发布聚合事件 → playback-
// scheduler 推进前观测（定格停工程帧）→ PixelCanvas 平移叠加
// 震屏偏移。本探针验四段：
//  1) PerformFxDriver 状态机（合成时钟）：边沿单次触发、定格
//     时长、跨帧事件窗口只算一记、shake-only 不定格、震屏包络
//     衰减与 60Hz 方波翻转、陈旧发布不触发、回退重触发；
//  2) aggregateCueEvents（注入替身求值器）：多角色多 cue 取大、
//     无 cue 角色零求值（预扫快路径）、替身计数；
//  3) cueNodeHasEvents / characterHasCueEvents：与求值器同口径
//     （缺省示例自带事件、纯值 cue 无事件、损坏 JSON 按回落）；
//  4) convert 点名：带事件 cue 的角色进包时 warnings 含「未进
//     包」定格/震屏条，无 cue 的角色不点名；
//  5) 源码接线断言：scheduler 观测/复位、PixelCanvas 发布/
//     震屏偏移、convert 点名三处接线在位（拆任一处应转红）。
// ============================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PerformFxDriver,
  aggregateCueEvents,
  cueNodeHasEvents,
  characterHasCueEvents,
} from '../src/lib/perform-fx';
import { num } from '../src/lib/blueprint/ir';
import { createDefaultCharacter } from '../src/lib/unified-types';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

// ---------- 1) 驱动状态机 ----------
{
  const d = new PerformFxDriver();
  d.publish(10, { hitstop: 0.2, shake: 3 });
  check('1a 命中帧观测即定格', d.observe(10, 1000) === true);
  check('1b 定格期内仍冻结（1199ms）', d.observe(10, 1199) === true);
  check('1c 定格恰满 200ms 解冻（1200ms）', d.observe(10, 1200) === false);
  check('1d 同帧事件不二次触发（1500ms 不再冻结）', d.observe(10, 1500) === false);

  // 震屏：触发帧满幅、60Hz 方波翻转、包络衰减、时长到零
  const o0 = d.shakeOffset(1000);
  const o1 = d.shakeOffset(1017);
  const oMid = d.shakeOffset(1100);
  check('1e 震屏触发帧满幅 +3', Math.abs(o0.x - 3) < 1e-9, `x=${o0.x}`);
  check('1f 60Hz 方波次步翻转符号', o1.x < 0, `x=${o1.x}`);
  check('1g 包络随时间衰减', Math.abs(oMid.x) < Math.abs(o0.x) && Math.abs(oMid.x) > 0, `mid=${oMid.x}`);
  check('1h 包络时长（max(250, 200)=250ms）后归零', d.shakeOffset(1250).x === 0 && d.shakeOffset(1250).y === 0);

  // 事件窗口跨两帧（pulseWidth 覆盖帧 11、12）：只算一记
  d.publish(11, { hitstop: 0.1, shake: 0 });
  check('1i 新一记命中触发定格', d.observe(11, 2000) === true);
  d.publish(12, { hitstop: 0.1, shake: 0 });
  check('1j 窗口次帧不二次触发（定格已满、信号未落）', d.observe(12, 2150) === false && d.observe(12, 2160) === false);
  d.publish(13, { hitstop: 0, shake: 0 });
  d.observe(13, 2200);
  d.publish(14, { hitstop: 0.1, shake: 0 });
  check('1k 信号落零后的下一记重新触发', d.observe(14, 2300) === true);

  // shake-only：不定格、只震屏
  const d2 = new PerformFxDriver();
  d2.publish(5, { hitstop: 0, shake: 5 });
  check('1l shake-only 不定格', d2.observe(5, 3000) === false);
  check('1m shake-only 满幅 5px', Math.abs(d2.shakeOffset(3000).x - 5) < 1e-9);
  check('1n shake-only 按最短包络 250ms 归零', d2.shakeOffset(3250).x === 0);

  // 陈旧发布（帧号不符）不触发、且不污染边沿状态
  const d3 = new PerformFxDriver();
  d3.publish(9, { hitstop: 0.5, shake: 0 });
  check('1o 陈旧发布不触发定格', d3.observe(10, 4000) === false);
  d3.publish(10, { hitstop: 0.5, shake: 0 });
  check('1p 同号新鲜发布正常触发', d3.observe(10, 4100) === true);

  // 回退（帧号变小 = 新一遍）后同一事件可再触发
  check('1q 回退后同事件再触发', (() => {
    d3.observe(3, 5000);
    d3.publish(3, { hitstop: 0.1, shake: 0 });
    return d3.observe(3, 5100) === true;
  })());

  // reset 清空全部状态
  const d4 = new PerformFxDriver();
  d4.publish(1, { hitstop: 1, shake: 4 });
  d4.observe(1, 100);
  d4.reset();
  check('1r reset 后定格与震屏皆清', d4.observe(1, 150) === false && d4.shakeOffset(150).x === 0);
}

// ---------- 2) 聚合（替身求值器） ----------
function charWithCue(id: string, cueNodeId: string) {
  const ch = createDefaultCharacter(id, id);
  const rootId = ch.rootNodeId;
  ch.nodes[rootId]!.blueprint = {
    version: 1,
    outputId: '',
    nodes: [{ id: cueNodeId, type: 'pattern_cue', params: {}, inputs: {} }],
  } as never;
  return ch;
}
{
  let calls = 0;
  const stub = (graph: never, nodeId: string) => {
    calls++;
    return nodeId === 'cueA'
      ? { hitstop: num(0.12), shake: num(3) }
      : { hitstop: num(0.3), shake: num(1) };
  };
  const rec = {
    a: charWithCue('a', 'cueA'),
    b: charWithCue('b', 'cueB'),
    c: createDefaultCharacter('c', 'c'),
  } as never;
  const agg = aggregateCueEvents(rec, 30, 12, { evaluateNode: stub as never });
  check('2a 聚合 hitstop 取最大（0.3）', Math.abs(agg.hitstop - 0.3) < 1e-9, `${agg.hitstop}`);
  check('2b 聚合 shake 取最大（3）', Math.abs(agg.shake - 3) < 1e-9, `${agg.shake}`);
  check('2c 无 cue 角色零求值（两次调用）', calls === 2, `calls=${calls}`);

  const agg0 = aggregateCueEvents({ c: createDefaultCharacter('c', 'c') } as never, 30, 12, { evaluateNode: stub as never });
  check('2d 全无 cue 时聚合为零且不求值', agg0.hitstop === 0 && agg0.shake === 0 && calls === 2, `calls=${calls}`);

  const aggNull = aggregateCueEvents(rec, 30, 12, { evaluateNode: (() => null) as never });
  check('2e 求值返回 null 按无事件', aggNull.hitstop === 0 && aggNull.shake === 0);
}

// ---------- 3) 事件判定（与求值器同口径） ----------
{
  const cue = (params: Record<string, unknown>) => ({ type: 'pattern_cue', params });
  check('3a 带 hitstop 的 cue 有事件', cueNodeHasEvents(cue({ cues: JSON.stringify([{ at: 0.5, value: 2, hitstop: 0.08 }]) })) === true);
  check('3b 带 shake 的 cue 有事件', cueNodeHasEvents(cue({ cues: JSON.stringify([{ at: 0.5, value: 2, shake: 3 }]) })) === true);
  check('3c 纯值 cue 无事件', cueNodeHasEvents(cue({ cues: JSON.stringify([{ at: 0, value: 1 }]) })) === false);
  check('3d cues 缺失回落缺省示例（自带事件）', cueNodeHasEvents(cue({})) === true);
  check('3e cues 损坏按回落处理（自带事件）', cueNodeHasEvents(cue({ cues: '{oops' })) === true);
  check('3f 非 cue 节点无事件', cueNodeHasEvents({ type: 'dynamic_pattern', params: {} }) === false);
  check('3g 角色级判定（带 cue 蓝图）', characterHasCueEvents(charWithCue('x', 'cueX')) === true);
  check('3h 角色级判定（无蓝图）', characterHasCueEvents(createDefaultCharacter('y', 'y')) === false);
}

// ---------- 4) convert 点名 ----------
{
  const withCue = charWithCue('w', 'cueW');
  withCue.nodes[withCue.rootNodeId]!.blueprint!.nodes[0]!.params = {
    cues: JSON.stringify([{ at: 0.5, value: 2, hitstop: 0.08, shake: 3 }]),
  } as never;
  const pkg = convertCharacterToRuntimePackage(withCue);
  check('4a 带事件 cue 进包时点名未进包', pkg.warnings.some((w) => w.includes('定格/震屏') && w.includes('未进包')),
    pkg.warnings.join(' | '));
  const plain = convertCharacterToRuntimePackage(createDefaultCharacter('p', 'p'));
  check('4b 无 cue 角色不点名', !plain.warnings.some((w) => w.includes('定格/震屏')));
}

// ---------- 5) 源码接线断言 ----------
{
  const sched = readFileSync(join(root, 'src/lib/playback-scheduler.ts'), 'utf8');
  const canvas = readFileSync(join(root, 'src/components/pixel-editor/PixelCanvas.tsx'), 'utf8');
  const conv = readFileSync(join(root, 'src/lib/proc-runtime/convert.ts'), 'utf8');
  check('5a scheduler 推进前观测 performFx.observe', sched.includes('performFx.observe('));
  check('5b scheduler 启动时 performFx.reset', sched.includes('performFx.reset()'));
  check('5c PixelCanvas 发布聚合事件', canvas.includes('aggregateCueEvents(') && canvas.includes('performFx.publish('));
  check('5d PixelCanvas 平移叠加震屏偏移', canvas.includes('performFx.shakeOffset('));
  check('5e convert 以 characterHasCueEvents 点名', conv.includes('characterHasCueEvents(character)'));
}

console.log(`\nverify-perform-consume: ${passed} 过 / ${failed} 败`);
if (failed > 0) process.exit(1);
