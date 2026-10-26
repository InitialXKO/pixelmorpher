// 行为探针：精灵库整摞操作依赖的 store 批量删除（removeSprites）——
// 一次删多张只压一条撤销、撤销可整批恢复。走真实 store 消费路径。
import { useProjectStore } from '../src/lib/store';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fails++;
};

const store = useProjectStore.getState();
const a = store.addSprite('层A', 4, 4);
const b = store.addSprite('层B', 4, 4);
const c = store.addSprite('保留', 4, 4);
const undoBefore = useProjectStore.getState().undoStack.length;

useProjectStore.getState().removeSprites([a.id, b.id], '删除整摞');
const after = useProjectStore.getState();
ok(!after.sprites[a.id] && !after.sprites[b.id], '批量删除：两张层图已删');
ok(!!after.sprites[c.id], '批量删除：无关精灵保留');
ok(after.undoStack.length === undoBefore + 1,
  `批量删除只压一条撤销（${undoBefore} → ${after.undoStack.length}）`);
ok(after.undoStack[after.undoStack.length - 1]?.description === '删除整摞', '撤销标签为调用方给定文案');

after.undo();
const restored = useProjectStore.getState();
ok(!!restored.sprites[a.id] && !!restored.sprites[b.id], '撤销后整批层图恢复');

// 空批不压撤销
const n0 = useProjectStore.getState().undoStack.length;
useProjectStore.getState().removeSprites([]);
ok(useProjectStore.getState().undoStack.length === n0, '空批删除不压撤销');

console.log(fails === 0 ? 'STACK LIBRARY PROBE PASS' : `STACK LIBRARY PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
