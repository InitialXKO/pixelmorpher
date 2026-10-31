// 插件生命周期验收探针（右栏审计·插件组修复）
// 覆盖：
//  A) 安装（installPluginFromSource）→ 蓝图注册表三处可查（求值器/
//     规格/标签）、求值器经注册表分发真生效、导出器契约
//     export(projectData) => Blob 可调用且返回 Blob
//  B) 启停真生效——禁用后 getters 缺省不再返回该插件能力、求值器
//     直通输入像素；恢复启用后求值恢复
//  C) 持久化——安装即落 localStorage（清单+代码+启停）；新 manager
//     实例 restorePersistedPlugins 按同一路重注册且还原启停、幂等
//  D) 卸载真注销——注册表三处查不到、getters 全空、落盘记录清除；
//     编程式 registerPlugin（函数形态）可用但不落盘
//  E) 源码级断言——ExportDialog 真接插件导出（getCustomExporters +
//     Blob 校验 + 下载处理）；PluginPanel 挂载恢复、安装走
//     installPluginFromSource、校验不再要求 main、无空实现注册

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗ FAIL:', msg); }
};

// localStorage 桩必须在导入 plugin-manager 前装好
const lsData = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (lsData.has(k) ? lsData.get(k)! : null),
  setItem: (k: string, v: string) => { lsData.set(k, String(v)); },
  removeItem: (k: string) => { lsData.delete(k); },
};

const {
  pluginManager,
  PluginManagerClass,
  PLUGIN_STORAGE_KEY,
} = await import('../src/lib/plugin-manager');
const { EVALUATORS, BLUEPRINT_NODE_LABELS } = await import('../src/lib/blueprint/eval');
const { BLUEPRINT_NODE_SPECS } = await import('../src/lib/blueprint/specs');

const manifest = {
  id: 'testplug',
  name: '测试插件',
  version: '1.0.0',
  description: '',
  author: 'probe',
};
const NODE_TYPE = 'plugin_testplug_invert';
const pluginCode = `
return {
  customModifiers: [{
    name: 'invert',
    params: [{ name: 'amt', label: '量', type: 'number', default: 1 }],
    execute: (pixels, params) => pixels.map((row) => row.map((c) => (c === null ? null : 'INVERTED'))),
  }],
  customExporters: [{
    name: 'textexport',
    extension: 'txt',
    export: (projectData) => new Blob(['name:' + (projectData && projectData.name || 'none')], { type: 'text/plain' }),
  }],
  cleanup: () => {},
};`;
const grid: (string | null)[][] = [['#aabbcc', null], [null, '#000000']];
// 输入用图求值的真实形态 { type:'pixels', grid }（ir.pixels）——旧版
// 探针喂手拼的 { value } 形态，恰好掩盖了桥只认 value 的形态 bug
const evalNode = () =>
  (EVALUATORS[NODE_TYPE] as any)(
    { id: 'n1', type: NODE_TYPE, params: {} },
    { pixels: { type: 'pixels', grid } },
    {},
  );

// ---- A) 安装与注册 ----
ok(pluginManager.installPluginFromSource(manifest as any, pluginCode) === true, 'A1 代码字符串安装成功');
ok(pluginManager.installPluginFromSource(manifest as any, pluginCode) === false, 'A2 重复 id 安装被拒');
ok(
  pluginManager.installPluginFromSource({ ...manifest, id: 'broken' } as any, 'return {') === false &&
    !pluginManager.getPlugin('broken'),
  'A3 编译失败的安装被拒且不留半成品',
);
ok(typeof EVALUATORS[NODE_TYPE] === 'function', 'A4 求值器进注册表');
ok(!!BLUEPRINT_NODE_SPECS[NODE_TYPE], 'A5 节点规格进注册表（节点面板数据源）');
ok(BLUEPRINT_NODE_LABELS[NODE_TYPE] === '插件:invert', 'A6 节点标签进注册表');
{
  const out = evalNode();
  ok(
    out?.pixels?.grid?.[0]?.[0] === 'INVERTED' && out?.pixels?.grid?.[0]?.[1] === null,
    'A7 求值器经注册表分发真生效（非空像素被改写、null 保留）',
  );
}
ok(pluginManager.getCustomModifiers().some((m) => m.id === 'testplug:invert'), 'A8 getters 含像素修改器');
{
  const exps = pluginManager.getCustomExporters();
  ok(exps.some((e) => e.id === 'testplug:textexport'), 'A9 getters 含导出器');
  const exp = exps.find((e) => e.id === 'testplug:textexport')!;
  const blob = exp.export({ name: 'demo' });
  ok(blob instanceof Blob, 'A10 导出器契约：export(projectData) 返回 Blob');
  ok((await blob.text()) === 'name:demo', 'A11 导出器收到 projectData 并据此产出内容');
}

// ---- C-前置) 安装即落盘 ----
{
  const stored = JSON.parse(lsData.get(PLUGIN_STORAGE_KEY) || '[]');
  ok(
    Array.isArray(stored) && stored.length === 1 && stored[0].manifest.id === 'testplug' &&
      typeof stored[0].code === 'string' && stored[0].code.includes('invert') && stored[0].enabled === true,
    'C1 安装即落盘（清单+代码字符串+启停=true）',
  );
}

// ---- B) 启停真生效 ----
pluginManager.togglePlugin('testplug');
ok(pluginManager.getPlugin('testplug')?.enabled === false, 'B1 启停状态翻转');
ok(!pluginManager.getCustomModifiers().some((m) => m.id === 'testplug:invert'), 'B2 禁用后缺省 getters 不再返回修改器');
ok(!pluginManager.getCustomExporters().some((e) => e.id === 'testplug:textexport'), 'B3 禁用后缺省 getters 不再返回导出器');
{
  const all = pluginManager.getCustomModifiers({ includeDisabled: true });
  const entry = all.find((m) => m.id === 'testplug:invert');
  ok(!!entry && entry.enabled === false, 'B4 includeDisabled 可见且标注 enabled=false（面板标注用）');
}
{
  const out = evalNode();
  ok(out?.pixels?.grid?.[0]?.[0] === '#aabbcc', 'B5 禁用后求值器直通输入像素');
}
{
  const stored = JSON.parse(lsData.get(PLUGIN_STORAGE_KEY) || '[]');
  ok(stored[0]?.enabled === false, 'B6 启停状态同步落盘');
}
pluginManager.togglePlugin('testplug');
{
  const out = evalNode();
  ok(out?.pixels?.grid?.[0]?.[0] === 'INVERTED', 'B7 恢复启用后求值恢复');
}
// 留 disabled 状态落盘，供 C 段验证恢复时还原启停
pluginManager.togglePlugin('testplug');

// ---- C) 新实例恢复 ----
{
  const m2 = new PluginManagerClass();
  m2.restorePersistedPlugins();
  ok(m2.getPlugins().length === 1 && m2.getPlugins()[0].manifest.id === 'testplug', 'C2 新实例从落盘重注册');
  ok(m2.getPlugin('testplug')?.enabled === false, 'C3 恢复还原启停状态（disabled）');
  ok(!m2.getCustomModifiers().some((m) => m.id === 'testplug:invert'), 'C4 恢复出的禁用插件能力缺省不可见');
  m2.restorePersistedPlugins();
  ok(m2.getPlugins().length === 1, 'C5 恢复幂等（重复调用不重复注册）');
}

// ---- D) 卸载真注销 ----
pluginManager.unregisterPlugin('testplug');
ok(typeof EVALUATORS[NODE_TYPE] === 'undefined', 'D1 卸载后求值器从注册表消失');
ok(!BLUEPRINT_NODE_SPECS[NODE_TYPE], 'D2 卸载后节点规格从注册表消失（节点面板不再列）');
ok(!(NODE_TYPE in BLUEPRINT_NODE_LABELS), 'D3 卸载后节点标签从注册表消失');
ok(
  pluginManager.getCustomModifiers({ includeDisabled: true }).length === 0 &&
    pluginManager.getCustomExporters({ includeDisabled: true }).length === 0,
  'D4 卸载后 getters 全空',
);
{
  const stored = JSON.parse(lsData.get(PLUGIN_STORAGE_KEY) || '[]');
  ok(!stored.some((e: any) => e.manifest.id === 'testplug'), 'D5 卸载清除落盘记录（刷新不复活）');
}
{
  // 编程式 registerPlugin（函数形态）仍可用，但不属于落盘来源
  const okReg = pluginManager.registerPlugin(
    { id: 'fnplug', name: '函数插件', version: '', description: '', author: '' } as any,
    () => ({}),
  );
  const stored = JSON.parse(lsData.get(PLUGIN_STORAGE_KEY) || '[]');
  ok(okReg && !stored.some((e: any) => e.manifest.id === 'fnplug'), 'D6 函数形态注册可用且不落盘（如实区分）');
  pluginManager.unregisterPlugin('fnplug');
}

// ---- E) 源码级断言 ----
{
  const evalSrc = readFileSync(new URL('../src/lib/blueprint/eval.ts', import.meta.url), 'utf8');
  const specsSrc = readFileSync(new URL('../src/lib/blueprint/specs.ts', import.meta.url), 'utf8');
  const mgrSrc = readFileSync(new URL('../src/lib/plugin-manager.ts', import.meta.url), 'utf8');
  const dlgSrc = readFileSync(new URL('../src/components/pixel-editor/ExportDialog.tsx', import.meta.url), 'utf8');
  const panelSrc = readFileSync(new URL('../src/components/pixel-editor/PluginPanel.tsx', import.meta.url), 'utf8');
  ok(evalSrc.includes('export function removeEvaluator') && evalSrc.includes('export function removeNodeLabel'), 'E1 eval.ts 有注销函数');
  ok(specsSrc.includes('export function removeNodeSpec'), 'E2 specs.ts 有注销函数');
  ok(mgrSrc.includes('removeEvaluator(nodeType)') && mgrSrc.includes('removeNodeSpec(nodeType)'), 'E3 manager 卸载时真调注销');
  ok(!mgrSrc.includes('sandboxed context'), 'E4 executeScript 注释不再声称沙箱');
  ok(
    dlgSrc.includes('pluginManager.getCustomExporters()') && dlgSrc.includes('handlePluginExport') &&
      dlgSrc.includes('instanceof Blob') && dlgSrc.includes('插件导出'),
    'E5 ExportDialog 真接插件导出（列启用导出器、按契约校验 Blob 并下载）',
  );
  ok(panelSrc.includes('restorePersistedPlugins') && panelSrc.includes('installPluginFromSource'), 'E6 面板挂载恢复 + 安装走统一入口');
  ok(!panelSrc.includes('!data.main') && !panelSrc.includes('() => ({})'), 'E7 面板校验不再要求 main、无空实现注册');
}

console.log(`\nverify-plugin-lifecycle: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
