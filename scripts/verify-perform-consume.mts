// ============================================================
// 表演事件消费探针：事件来源 = 角色事件轨（Character.cueTrack，
// 与输入轨同实现路子——关键帧数据挂角色、纯函数逐帧采样、字面
// 语义：第 F 帧有键 = 第 F 帧触发）。消费链 = PixelCanvas 渲染
// 发布采样事件 → playback-scheduler 推进前观测（定格停工程
// 帧）→ PixelCanvas 平移叠加震屏偏移。本探针验五段：
//  1) PerformFxDriver 状态机（合成时钟）：每帧判别一次、定格
//     时长、紧邻两帧各有关键帧各算一记（字面语义，无窗口合并）、
//     shake-only 不定格、震屏包络衰减与 60Hz 方波翻转、陈旧
//     发布不触发、回退重触发、reset 清空；
//  2) sampleCueTrack / cueEventsAt：恰帧命中、非键帧为零、多
//     角色取大、缺轨为零、非法载荷钳零；
//  3) characterHasCueEvents：事件轨上有无有效事件；
//  4) convert 点名：事件轨含有效事件的角色进包时 warnings 含
//     「未进包」定格/震屏条，无事件的角色不点名；
//  5) 源码接线断言：scheduler 观测/复位、PixelCanvas 发布/
//     震屏偏移、convert 点名、时间线事件轨条挂载在位。
// ============================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PerformFxDriver,
  sampleCueTrack,
  cueEventsAt,
  characterHasCueEvents,
} from '../src/lib/perform-fx';
import { createDefaultCharacter, type CueEventValue, type KeyframeTrack } from '../src/lib/unified-types';
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

  // 紧邻两帧各有关键帧：字面语义，各算一记（事件轨无窗口合并）
  d.publish(11, { hitstop: 0.1, shake: 0 });
  check('1i 帧 11 事件触发定格', d.observe(11, 2000) === true);
  d.publish(12, { hitstop: 0.1, shake: 0 });
  check('1j 紧邻帧 12 的事件独立触发（前记定格已满 100ms）', d.observe(12, 2150) === true);
  check('1j2 帧 12 定格期内同帧不重触发', d.observe(12, 2200) === true && d.observe(12, 2260) === false);
  d.publish(13, { hitstop: 0, shake: 0 });
  d.observe(13, 2300);
  d.publish(14, { hitstop: 0.1, shake: 0 });
  check('1k 无事件帧之后的下一记重新触发', d.observe(14, 2400) === true);

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

// ---------- 2) 事件轨采样 ----------
function cueTrackOf(kfs: { frame: number; value: CueEventValue }[]): KeyframeTrack<CueEventValue> {
  return { keyframes: kfs, interpolation: 'step' };
}
function charWithEvents(id: string, kfs: { frame: number; value: CueEventValue }[]) {
  const ch = createDefaultCharacter(id, id);
  ch.cueTrack = cueTrackOf(kfs);
  return ch;
}
{
  const track = cueTrackOf([
    { frame: 10, value: { hitstop: 0.12, shake: 3 } },
    { frame: 12, value: { hitstop: 0.3 } },
  ]);
  const s10 = sampleCueTrack(track, 10);
  check('2a 关键帧所在帧采样命中', Math.abs(s10.hitstop - 0.12) < 1e-9 && Math.abs(s10.shake - 3) < 1e-9, JSON.stringify(s10));
  const s11 = sampleCueTrack(track, 11);
  check('2b 非关键帧为零（无插值）', s11.hitstop === 0 && s11.shake === 0);
  const s12 = sampleCueTrack(track, 12);
  check('2c 只设 hitstop 的键 shake 为零', Math.abs(s12.hitstop - 0.3) < 1e-9 && s12.shake === 0);
  check('2d 缺轨/空轨为零', sampleCueTrack(undefined, 10).hitstop === 0 && sampleCueTrack(cueTrackOf([]), 10).shake === 0);
  const bad = sampleCueTrack(cueTrackOf([{ frame: 3, value: { hitstop: -1, shake: Number.NaN } }]), 3);
  check('2e 非法载荷（负/NaN）钳零', bad.hitstop === 0 && bad.shake === 0);

  const rec = {
    a: charWithEvents('a', [{ frame: 10, value: { hitstop: 0.12, shake: 3 } }]),
    b: charWithEvents('b', [{ frame: 10, value: { hitstop: 0.3, shake: 1 } }]),
    c: createDefaultCharacter('c', 'c'),
  };
  const agg = cueEventsAt(rec, 10);
  check('2f 多角色同帧 hitstop 取最大（0.3）', Math.abs(agg.hitstop - 0.3) < 1e-9, `${agg.hitstop}`);
  check('2g 多角色同帧 shake 取最大（3）', Math.abs(agg.shake - 3) < 1e-9, `${agg.shake}`);
  const aggOff = cueEventsAt(rec, 11);
  check('2h 无键帧聚合为零', aggOff.hitstop === 0 && aggOff.shake === 0);
}

// ---------- 3) 事件判定（convert 点名口径） ----------
{
  check('3a 事件轨带 hitstop 键 → 有事件', characterHasCueEvents(charWithEvents('x', [{ frame: 1, value: { hitstop: 0.08 } }])) === true);
  check('3b 事件轨带 shake 键 → 有事件', characterHasCueEvents(charWithEvents('x', [{ frame: 1, value: { shake: 3 } }])) === true);
  check('3c 事件轨键载荷全零 → 无事件', characterHasCueEvents(charWithEvents('x', [{ frame: 1, value: { hitstop: 0, shake: 0 } }])) === false);
  check('3d 无事件轨 → 无事件', characterHasCueEvents(createDefaultCharacter('y', 'y')) === false);
  check('3e 空事件轨 → 无事件', characterHasCueEvents(charWithEvents('z', [])) === false);
}

// ---------- 4) convert 点名 ----------
{
  const withEvents = charWithEvents('w', [{ frame: 5, value: { hitstop: 0.08, shake: 3 } }]);
  const pkg = convertCharacterToRuntimePackage(withEvents);
  check('4a 事件轨含有效事件进包时点名未进包', pkg.warnings.some((w) => w.includes('定格/震屏') && w.includes('未进包')),
    pkg.warnings.join(' | '));
  const plain = convertCharacterToRuntimePackage(createDefaultCharacter('p', 'p'));
  check('4b 无事件轨角色不点名', !plain.warnings.some((w) => w.includes('定格/震屏')));
  const zeroOnly = convertCharacterToRuntimePackage(charWithEvents('q', [{ frame: 5, value: { hitstop: 0 } }]));
  check('4c 事件轨只有零载荷键不点名', !zeroOnly.warnings.some((w) => w.includes('定格/震屏')));
}

// ---------- 5) 源码接线断言 ----------
{
  const sched = readFileSync(join(root, 'src/lib/playback-scheduler.ts'), 'utf8');
  const canvas = readFileSync(join(root, 'src/components/pixel-editor/PixelCanvas.tsx'), 'utf8');
  const conv = readFileSync(join(root, 'src/lib/proc-runtime/convert.ts'), 'utf8');
  const timeline = readFileSync(join(root, 'src/components/pixel-editor/Timeline.tsx'), 'utf8');
  const types = readFileSync(join(root, 'src/lib/unified-types.ts'), 'utf8');
  check('5a scheduler 推进前观测 performFx.observe', sched.includes('performFx.observe('));
  check('5b scheduler 启动时 performFx.reset', sched.includes('performFx.reset()'));
  check('5c PixelCanvas 发布事件轨采样', canvas.includes('cueEventsAt(') && canvas.includes('performFx.publish('));
  check('5d PixelCanvas 平移叠加震屏偏移', canvas.includes('performFx.shakeOffset('));
  check('5e convert 以 characterHasCueEvents 点名', conv.includes('characterHasCueEvents(character)'));
  check('5f 时间线挂载事件轨条 CueTrackStrip', timeline.includes('CueTrackStrip'));
  check('5g Character 数据含 cueTrack 字段', types.includes('cueTrack?: KeyframeTrack<CueEventValue>'));
}

console.log(`\nverify-perform-consume: ${passed} 过 / ${failed} 败`);
if (failed > 0) process.exit(1);
