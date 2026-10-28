/**
 * 结构断言：左右栏页签化 + 新建角色入口收拢（源级）
 *
 * 页签化：两栏均由 SidePanelTabs 承载、旧堆叠/分高已除、段不再用
 * <details> 堆叠；容器为「首访挂载 + 保持挂载 hidden」策略；左栏
 * 页签状态在 editor store。
 * 新建收拢：每个创建对话框全仓只有一个宿主（统一在工具栏的
 * NewCharacterMenu；参考图装配是资产面板整版视图、宿主唯一留在
 * 资产面板）；两面板头部与 RigPanel 不再有新建入口；草图捕姿
 * （非新建）原处保留。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const ok = (cond: boolean, label: string) => {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
};

// ---------- 页签化 ----------
const page = read('src/app/page.tsx');
ok(page.includes('<SidePanelTabs') && page.includes('side="left"'), 'page.tsx 左栏由 SidePanelTabs 承载');
for (const id of ["'assets'", "'clips'", "'strokes'"]) {
  ok(page.includes(`id: ${id}`), `左栏页签 ${id} 在位`);
}
ok(!page.includes('flex-[2]') && !page.includes('flex-[1.5]'), '左栏旧分高堆叠（flex-[2]/flex-[1.5]）已除');
ok(!page.includes('renderRightPanel'), '右栏旧 Tabs 死代码（renderRightPanel）已除');

const puppetPanel = read('src/components/pixel-editor/PuppetPanel.tsx');
ok(puppetPanel.includes('<SidePanelTabs') && puppetPanel.includes('side="right"'), 'PuppetPanel 右栏由 SidePanelTabs 承载');
for (const id of ["'rig'", "'dress'", "'perform'", "'behavior'", "'statemachine'", "'behaviortree'", "'preview'"]) {
  ok(puppetPanel.includes(`id: ${id}`), `右栏页签 ${id} 在位`);
}
ok(!puppetPanel.includes('<details'), 'PuppetPanel 不再用 <details> 堆叠各段');

const tabsComp = read('src/components/pixel-editor/shared/SidePanelTabs.tsx');
ok(tabsComp.includes('role="tablist"'), 'SidePanelTabs 有竖排页签栏');
ok(tabsComp.includes('visited') && tabsComp.includes("'hidden'"), 'SidePanelTabs 保持挂载 + hidden 策略在位');

const types = read('src/lib/types.ts');
const editorStore = read('src/lib/store/editor-store.ts');
ok(types.includes('leftPanelTab:'), 'EditorState 有 leftPanelTab 字段');
ok(editorStore.includes('setLeftPanelTab'), 'editor store 有 setLeftPanelTab');

// ---------- 新建角色收拢 ----------
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
  });
const allTsx = walk(join(ROOT, 'src/components')).map((p) => ({
  path: p.slice(ROOT.length + 1),
  text: readFileSync(p, 'utf8'),
}));
const mounts = (tag: string) =>
  allTsx.filter((f) => f.text.includes(`<${tag}`)).map((f) => f.path);

const expectSingleHost = (tag: string, hostFile: string) => {
  const m = mounts(tag);
  ok(m.length === 1 && m[0] === hostFile, `${tag} 宿主唯一且在 ${hostFile}（实际：${m.join(', ') || '无'}）`);
};
expectSingleHost('PuppetCreationWizard', 'src/components/pixel-editor/NewCharacterMenu.tsx');
expectSingleHost('SpineImportDialog', 'src/components/pixel-editor/NewCharacterMenu.tsx');
expectSingleHost('StrokeBuildWizard', 'src/components/pixel-editor/NewCharacterMenu.tsx');
expectSingleHost('ThreeBakeDialog', 'src/components/pixel-editor/NewCharacterMenu.tsx');
// 参考图装配是资产面板整版替换视图（非对话框）：宿主唯一留在资产面板
expectSingleHost('RefAssemblyWizard', 'src/components/pixel-editor/PuppetAssetPanel.tsx');

const assetPanel = read('src/components/pixel-editor/PuppetAssetPanel.tsx');
ok(!assetPanel.includes('setWizardOpen') && !assetPanel.includes('setThreeBakeOpen'), '资产面板不再有向导/烘焙开关');
ok(!assetPanel.includes('PuppetCreationWizard') && !assetPanel.includes('ThreeBakeDialog'), '资产面板不再 import 创建对话框');
ok(assetPanel.includes('新建角色'), '资产面板空状态有去统一入口的指引文字');

ok(!puppetPanel.includes('setWizardOpen') && !puppetPanel.includes('setSpineImportOpen') && !puppetPanel.includes('setStrokeWizardOpen'), '木偶面板不再有新建对话框开关');
ok(!puppetPanel.includes('addUnifiedCharacter('), '木偶面板不再直接新建道具');
ok(!puppetPanel.includes('createPuppyRunExampleCharacter'), '木偶面板空状态不再有示例小狗按钮');
ok(puppetPanel.includes('新建角色'), '木偶面板空状态有去统一入口的指引文字');
ok(puppetPanel.includes('<SketchPoseDialog'), '草图捕姿（非新建）仍在木偶面板原处');

const rigPanel = read('src/components/pixel-editor/puppet/RigPanel.tsx');
ok(!rigPanel.includes('ThreeBakeDialog') && !rigPanel.includes('setThreeBakeOpen'), 'RigPanel 的 3D 烘焙测试入口已撤');

const toolbar = read('src/components/pixel-editor/Toolbar.tsx');
ok((toolbar.match(/<NewCharacterMenu/g) ?? []).length === 1, 'Toolbar 挂载 NewCharacterMenu 恰一处');

const menu = read('src/components/pixel-editor/NewCharacterMenu.tsx');
for (const label of ['创建向导', '从参考图装配', '画火柴人建角', '3D 烘焙', '导入 Spine', '新建道具', '小狗']) {
  ok(menu.includes(label), `统一菜单含「${label}」`);
}
ok(menu.includes('setRefWizardOpen') && menu.includes('setLeftPanelTab'), '统一菜单触发参考图装配时切左栏到资产页签');

if (failures > 0) {
  console.error(`\n${failures} 项断言失败`);
  process.exit(1);
}
console.log('SIDE PANEL TABS + NEW CHARACTER ENTRY PROBE PASS');
