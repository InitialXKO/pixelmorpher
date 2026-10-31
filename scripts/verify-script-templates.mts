// 脚本模板验收探针（右栏审计组 3：预览 + 脚本修复）
// 覆盖：
//  A) 从 ScriptPanel.tsx 源码抽出两个模板的 code 原文真跑——抽取依
//     赖「模板字符串内不含反引号/${」这一格式，抽不到即判失败（把
//     模板格式钉住，防止以后改回只打日志的演示版）；
//  B) 「批量添加关键帧」：最小工程（1 角色 2 节点 1 片段、
//     totalFrames=16）经 pluginManager.executeScript 跑模板原文，
//     断言每节点 angle/x/y 三条轨道各落 4 个关键帧（每 4 帧一键），
//     且键值等于节点静止姿态 transform（按静止姿态落键）；
//  C) 「随机旋转动画」：重置夹具并选中子节点后跑模板原文，断言
//     angle 轨共 3 键（帧 0/8 随机 + 末帧 15 回 0），随机键值在
//     [-15, 15] 内、末帧值恰为 0；
//  D) 源码级断言——ScriptPanel：运行入口压 pushUndo('执行脚本')、
//     stopScript 与停止按钮已删、历史回填 UI 在位；ProcPreview：
//     角色回落与导出同口径（未选中回落第一个角色）、计时文案如实
//     （挂钟/按帧两词都在）、simMode 仍改 'wall'（刻意保留）。

import { readFileSync } from 'node:fs';
import { useProjectStore } from '../src/lib/store';
import { pluginManager } from '../src/lib/plugin-manager';

let pass = 0;
let fail = 0;
const failed: string[] = [];
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failed.push(label); console.log('  ✗ ' + label); }
}

// ---------- A) 抽模板原文 ----------
const panelSrc = readFileSync(new URL('../src/components/pixel-editor/ScriptPanel.tsx', import.meta.url), 'utf8');
function extractTemplate(id: string): string | null {
  const idIdx = panelSrc.indexOf(`id: '${id}'`);
  if (idIdx < 0) return null;
  const start = panelSrc.indexOf('code: `', idIdx);
  if (start < 0) return null;
  const from = start + 'code: `'.length;
  const end = panelSrc.indexOf('`', from);
  if (end < 0) return null;
  return panelSrc.slice(from, end);
}
const batchCode = extractTemplate('batch-keyframes');
const rotateCode = extractTemplate('random-rotation');
ok(batchCode !== null && batchCode.includes('api.addNodeKeyframe'), 'A1 批量模板抽出且真调用 addNodeKeyframe');
ok(rotateCode !== null && rotateCode.includes('api.addNodeKeyframe'), 'A2 随机旋转模板抽出且真调用 addNodeKeyframe');
ok(batchCode !== null && !batchCode.includes('简化为演示'), 'A3 批量模板无「简化为演示」残留');

// ---------- 夹具 ----------
function freshFixture() {
  return {
    id: 'char1',
    name: '夹具角色',
    rootNodeId: 'n1',
    costumeSets: [],
    nodes: {
      n1: { id: 'n1', name: 'root', transform: { x: 0, y: 0, angle: 5, tilt: 0, stretch: 1, scaleX: 1 }, children: ['n2'] },
      n2: { id: 'n2', name: 'child', transform: { x: 160, y: 32, angle: -3, tilt: 0, stretch: 1, scaleX: 1 }, children: [] },
    },
  };
}
function seedStore(selectedNodeId: string | null) {
  useProjectStore.setState({
    unifiedCharacters: { char1: freshFixture() as never },
    animationClips: [{ id: 'clip1', name: '片段1', puppetCharacterId: 'char1' } as never],
    totalFrames: 16,
    selectedNodeId,
  });
}
function trackOf(nodeId: string, channel: string): Array<{ frame: number; value: number }> {
  const ch = useProjectStore.getState().unifiedCharacters['char1'] as never as {
    nodes: Record<string, { tracks?: Record<string, { keyframes: Array<{ frame: number; value: number }> }> }>;
  };
  return ch.nodes[nodeId]?.tracks?.[channel]?.keyframes ?? [];
}

// ---------- B) 批量模板真跑 ----------
console.log('B) 批量添加关键帧模板');
seedStore(null);
if (batchCode) pluginManager.executeScript(batchCode);
for (const [nodeId, rest] of [['n1', { angle: 5, x: 0, y: 0 }], ['n2', { angle: -3, x: 160, y: 32 }]] as const) {
  for (const ch of ['angle', 'x', 'y'] as const) {
    const keys = trackOf(nodeId, ch);
    ok(keys.length === 4, `B ${nodeId}.${ch} 落 4 键（实际 ${keys.length}）`);
    ok(keys.map((k) => k.frame).join(',') === '0,4,8,12', `B ${nodeId}.${ch} 帧位 0/4/8/12`);
    ok(keys.every((k) => k.value === rest[ch]), `B ${nodeId}.${ch} 键值 = 静止姿态 ${rest[ch]}`);
  }
}

// ---------- C) 随机旋转模板真跑 ----------
console.log('C) 随机旋转动画模板');
seedStore('n2');
if (rotateCode) pluginManager.executeScript(rotateCode);
{
  const keys = trackOf('n2', 'angle');
  ok(keys.length === 3, `C n2.angle 共 3 键（实际 ${keys.length}）`);
  ok(keys.map((k) => k.frame).join(',') === '0,8,15', 'C 帧位 0/8/15');
  ok(keys.slice(0, 2).every((k) => k.value >= -15 && k.value <= 15), 'C 随机键值在 [-15, 15] 内');
  ok(keys.length === 3 && keys[2].value === 0, 'C 末帧回 0 收尾');
  ok(trackOf('n1', 'angle').length === 0, 'C 未选中节点 n1 不落键');
}

// ---------- D) 源码级断言 ----------
console.log('D) 源码断言');
ok(panelSrc.includes("pushUndo('执行脚本')"), 'D1 运行入口压 pushUndo(执行脚本)');
ok(!panelSrc.includes('stopScript') && !panelSrc.includes('<Square'), 'D2 stopScript 与停止按钮已删');
ok(panelSrc.includes('历史脚本（点选回填）') && panelSrc.includes('localStorage.removeItem(HISTORY_KEY)'), 'D3 历史回填 UI 与清空在位');
ok(panelSrc.includes('同步执行') && panelSrc.includes('死循环只能刷新页面恢复'), 'D4 同步执行如实说明在位');

const previewSrc = readFileSync(new URL('../src/components/pixel-editor/puppet/ProcPreview.tsx', import.meta.url), 'utf8');
ok(previewSrc.includes('allCharacters[0]'), 'D5 预览未选中回落第一个角色（与导出同口径）');
ok(previewSrc.includes('按挂钟走') && previewSrc.includes('按帧走'), 'D6 预览计时文案如实（挂钟/按帧）');
ok(previewSrc.includes("pkg.simMode = 'wall'"), "D7 simMode 仍改 'wall'（刻意保留）");

console.log(`\nverify-script-templates: ${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  console.log('失败项：\n - ' + failed.join('\n - '));
  process.exit(1);
}
