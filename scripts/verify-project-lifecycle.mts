// ============================================================
// 工程生命周期探针（审计 F-02/F-03/F-04/F-22/F-23 修复回归网）
//
// 覆盖分工：
//  - 能脱离 IndexedDB/浏览器跑的走行为断言（useProjectStore 真
//    store)：F-23 首次添加蓝图单节点、F-22 快照/存档/导入三路
//    带 globalBlueprint、撤销后蓝图与列表一致；
//  - 依赖 IndexedDB/DOM 的走接线断言（源码级）：F-02 duplicate
//    记录键构造、F-03 Toolbar 委托绑定路径、F-04 恢复收尾两件。
//    这三处的行为后果（DB 行落键、主页保存落盘）需浏览器内验，
//    本探针只锁住修复的构造与接线不被改回去。
// ============================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useProjectStore } from '../src/lib/store';

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

const store = () => useProjectStore.getState();
const modNodeId = (modifierId: string) => `mod_${modifierId.replace(/-/g, '').slice(0, 12)}`;

function resetStore() {
  useProjectStore.setState({
    globalModifiers: [],
    globalBlueprint: null,
    undoStack: [],
    redoStack: [],
  } as never);
}

// ---------- F-23：首次添加全局修改器，蓝图只建一份节点 ----------
{
  resetStore();
  const m1 = store().addGlobalModifier('translate');
  const bp1 = store().globalBlueprint;
  check('F-23a 首次添加后 globalBlueprint 非空', !!bp1);
  const ids1 = (bp1?.nodes ?? []).map((n) => n.id);
  check('F-23b 蓝图节点 ID 全局唯一（无双节点）', new Set(ids1).size === ids1.length,
    `nodes=${ids1.length} unique=${new Set(ids1).size}`);
  check('F-23c 新修改器的节点恰一份', ids1.filter((id) => id === modNodeId(m1.id)).length === 1,
    `count=${ids1.filter((id) => id === modNodeId(m1.id)).length}`);
  check('F-23d 列表里新修改器恰一条', store().globalModifiers.filter((m) => m.id === m1.id).length === 1);

  // 蓝图已存在分支：再加一个，两个节点各一份、ID 仍唯一
  const m2 = store().addGlobalModifier('translate');
  const bp2 = store().globalBlueprint;
  const ids2 = (bp2?.nodes ?? []).map((n) => n.id);
  check('F-23e 已有蓝图时再加：两修改器节点各一份',
    ids2.filter((id) => id === modNodeId(m1.id)).length === 1
    && ids2.filter((id) => id === modNodeId(m2.id)).length === 1
    && new Set(ids2).size === ids2.length);
}

// ---------- F-22：撤销快照带 globalBlueprint，撤销后蓝图与列表一致 ----------
{
  resetStore();
  store().addGlobalModifier('translate');
  check('F-22a 添加后蓝图与列表同时非空', !!store().globalBlueprint && store().globalModifiers.length === 1);
  store().undo();
  check('F-22b 撤销后列表清空', store().globalModifiers.length === 0);
  check('F-22c 撤销后蓝图同步清 null（不残留节点形态）', store().globalBlueprint === null,
    `bp=${store().globalBlueprint ? 'non-null' : 'null'}`);
  store().redo();
  check('F-22d 重做后蓝图与列表一并恢复', !!store().globalBlueprint && store().globalModifiers.length === 1);

  const snap = JSON.parse(store()._captureSnapshot());
  check('F-22e _captureSnapshot 含 globalBlueprint 字段',
    Object.prototype.hasOwnProperty.call(snap, 'globalBlueprint')
    && JSON.stringify(snap.globalBlueprint) === JSON.stringify(store().globalBlueprint));
}

// ---------- F-22：存档往返带 globalBlueprint；导入缺字段清残留 ----------
{
  resetStore();
  store().addGlobalModifier('translate');
  const bpBefore = store().globalBlueprint;
  const file = store().exportProjectFile() as never as {
    project: Record<string, unknown>;
  };
  check('F-22f exportProjectFile 的 project 带 globalBlueprint',
    JSON.stringify(file.project.globalBlueprint) === JSON.stringify(bpBefore));

  // 清空后导入 → 恢复
  useProjectStore.setState({ globalModifiers: [], globalBlueprint: null } as never);
  store().importProjectFile(file as never);
  check('F-22g importProjectFile 恢复 globalBlueprint',
    JSON.stringify(store().globalBlueprint) === JSON.stringify(bpBefore));

  // 旧文件（无 globalBlueprint 字段）导入 → 不许残留当前会话蓝图
  const legacy = JSON.parse(JSON.stringify(file)) as { project: Record<string, unknown> };
  delete legacy.project.globalBlueprint;
  store().importProjectFile(legacy as never);
  check('F-22h 旧文件导入后 globalBlueprint 清为 null（无残留）', store().globalBlueprint === null,
    `bp=${store().globalBlueprint ? 'non-null' : 'null'}`);

  // resetProject 一并清蓝图
  store().addGlobalModifier('translate');
  store().resetProject();
  check('F-22i resetProject 后 globalBlueprint 为 null', store().globalBlueprint === null);
}

// ---------- F-02：duplicate 的 DB 记录键构造（源码级，IndexedDB 行为需浏览器验） ----------
{
  const src = readFileSync(join(root, 'src/lib/asset-store.ts'), 'utf8');
  const seg = src.slice(src.indexOf('duplicateProject: async'), src.indexOf('renameProject: async'));
  check('F-02a duplicate 落行时新 ID 在展开之后（覆盖原 ID）',
    seg.includes('{ ...projectData, id: duplicate.id }'));
  check('F-02b 旧错误顺序的落行调用已消除', !seg.includes("dbPut('projects', { id: duplicate.id"));
  // 构造语义复刻：keyPath='id' 下记录的 id 字段即落键
  const projectData = { id: 'orig-id', version: '3.1' };
  const rec = { ...projectData, id: 'dup-id' };
  check('F-02c 展开构造语义：记录 id 为副本 ID', rec.id === 'dup-id');
}

// ---------- F-03：顶栏打开 .pxm 走绑定路径（源码级） ----------
{
  const toolbar = readFileSync(join(root, 'src/components/pixel-editor/Toolbar.tsx'), 'utf8');
  const asset = readFileSync(join(root, 'src/lib/asset-store.ts'), 'utf8');
  check('F-03a Toolbar 委托 importProjectFromFile(file)', toolbar.includes('importProjectFromFile(file)'));
  check('F-03b Toolbar 不再只灌 store 的旧路径', !toolbar.includes('importProjectFile(projectFile)'));
  const seg = asset.slice(asset.indexOf('importProjectFromFile: async'), asset.indexOf('updateCurrentProjectMeta: async'));
  check('F-03c importProjectFromFile 绑定 currentProjectId=newId', seg.includes('currentProjectId: newId'));
  check('F-03d importProjectFromFile 成功返回 meta、失败返回 null',
    seg.includes('return meta;') && seg.includes('return null;'));
}

// ---------- F-04：自动保存恢复收尾两件（源码级） ----------
{
  const page = readFileSync(join(root, 'src/app/page.tsx'), 'utf8');
  const seg = page.slice(page.indexOf('handleRestoreAutosave'), page.indexOf('handleDiscardAutosave'));
  check('F-04a 恢复后绑定 currentProjectId（取恢复工程自身 id）',
    seg.includes('currentProjectId: restoredId') && seg.includes('useProjectStore.getState().id'));
  check('F-04b 恢复后关闭项目主页进编辑器', seg.includes('showProjectHome: false'));
}

console.log(`\nverify-project-lifecycle: ${passed} 过 / ${failed} 败`);
if (failed > 0) process.exit(1);
