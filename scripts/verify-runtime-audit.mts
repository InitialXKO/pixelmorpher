/**
 * verify-runtime-audit.mts — 运行时完备性审计锁定探针
 *
 * 把 spikes/runtime-completeness/AUDIT.md 的分类逐项锁成断言：
 * 某项被修复（缺口关闭）或恶化（完善面断裂）时本探针变红，
 * 提示同步更新 AUDIT.md 的分类，而不是让文档与代码悄悄分叉。
 * 风格：源码接线级断言（与 verify-sprite-mgmt 同级），不做渲染断言。
 */
import { readFileSync } from 'node:fs';

let passed = 0;
function check(name: string, ok: boolean) {
  if (!ok) { console.error('✗', name); process.exit(1); }
  passed++; console.log('✓', name);
}
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const convert = read('../src/lib/proc-runtime/convert.ts');
const template = read('../src/lib/proc-runtime/runtime-template.ts');
const dynSrc = read('../src/lib/proc-runtime/dynamic-src.ts');

// ---- 完善面（断了 = 回退）----
check('完善·状态机进包且运行时消费',
  convert.includes('stateMachine') && template.includes('smUpdate') && template.includes('smSetState'));
check('完善·动态实例进包且运行时消费',
  convert.includes('__dynamic') && template.includes('dynListFor'));
check('完善·发光场进包且运行时消费',
  convert.includes('glowEntryFor') && template.includes('glowEntryOf'));
check('完善·裁剪面进包且运行时消费',
  convert.includes('clipPlane') && template.includes('clipPlaneForPart'));
check('完善·标记进包且运行时换算',
  convert.includes('marks') && template.includes('marksDir'));

// ---- 静默缺口（关了 = 有人修了，须更新 AUDIT 分类）----
check('缺口1·服装集条目 surface 仍未被 resolvePart 消费（修复后更新文档）',
  !/if \(c\.surface\)/.test(template));
check('缺口2·程序化动画仍未进 convert（修复后更新文档）',
  !convert.includes('proceduralAnimations'));
check('缺口3·全局修改器仍未进 convert（修复后更新文档）',
  !convert.includes('globalModifiers'));
check('缺口4·运行时仍无网格蒙皮（修复后更新文档）',
  !template.includes('skinning') && !dynSrc.includes('skinning'));
check('缺口5·画布修改轨仍未进 convert（修复后更新文档）',
  !convert.includes('canvasModifierTracks'));
check('缺口6·片段状态轨道仍未进 convert（修复后更新文档）',
  !convert.includes('stateKeyframes'));

// ---- 已点名近似（点名消失 = 口径变化，须更新文档）----
check('近似·directionDrawOrders 仍有点名 warning',
  convert.includes('directionDrawOrders') && convert.includes('未进包'));
check('近似·蓝图剪变换通道仍在',
  convert.includes('pruneToTransform'));

console.log(`\n运行时审计锁定探针全过（${passed} 项）`);
