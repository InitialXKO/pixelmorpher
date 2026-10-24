// 行为树纯函数层探针：tick 语义（选择器/顺序器/取反/重复/条件/意图/移动/写变量/等待）、
// 黑板口径（世界覆盖、内部区隔离）、编辑 helpers（加子/加兄弟/删/移/改）、校验。
import {
  addChildToSpec,
  addSiblingToSpec,
  cloneBTSpec,
  collectBTVarNames,
  createBTState,
  moveNodeInSpec,
  removeNodeFromSpec,
  tickBehaviorTree,
  updateNodeInSpec,
  validateBehaviorTreeSpec,
} from '../src/lib/proc-runtime/behavior-tree';
import type { BehaviorTreeNode, BehaviorTreeSpec } from '../src/lib/unified-types';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${extra}`); }
}

const n = (partial: Partial<BehaviorTreeNode> & { type: BehaviorTreeNode['type'] }): BehaviorTreeNode =>
  ({ id: Math.random().toString(36).slice(2, 8), children: undefined, ...partial });
const specOf = (root: BehaviorTreeNode | null): BehaviorTreeSpec => ({ version: 1, root });
const tick = (spec: BehaviorTreeSpec, st = createBTState(), opts: Partial<Parameters<typeof tickBehaviorTree>[2]> = {}) =>
  tickBehaviorTree(spec, st, { dt: 0, worldVars: {}, ...opts });

// —— 组合语义 ——
{
  const calls: string[] = [];
  const rt = { intent: (name: string) => { calls.push(name); return name === 'ok'; } };
  const sel = specOf(n({ type: 'selector', children: [
    n({ type: 'intent', intentName: 'miss' }),
    n({ type: 'intent', intentName: 'ok' }),
    n({ type: 'intent', intentName: 'later' }),
  ] }));
  const r = tick(sel, createBTState(), { runtime: rt });
  check('选择器：首个成功即停（后面的不评估）', r.status === 'success' && calls.join(',') === 'miss,ok', calls.join(','));
  check('选择器：firedIntents 只记命中的', r.firedIntents.join(',') === 'ok');
  const allFail = tick(specOf(n({ type: 'selector', children: [n({ type: 'intent', intentName: 'x' })] })), createBTState(), { runtime: rt });
  check('选择器：全失败=失败', allFail.status === 'failure');
  check('空选择器=失败、空顺序器=成功',
    tick(specOf(n({ type: 'selector', children: [] }))).status === 'failure'
    && tick(specOf(n({ type: 'sequence', children: [] }))).status === 'success');
}
{
  const calls: string[] = [];
  const rt = { intent: (name: string) => { calls.push(name); return name !== 'bad'; } };
  const seq = specOf(n({ type: 'sequence', children: [
    n({ type: 'intent', intentName: 'a' }),
    n({ type: 'intent', intentName: 'bad' }),
    n({ type: 'intent', intentName: 'c' }),
  ] }));
  const r = tick(seq, createBTState(), { runtime: rt });
  check('顺序器：首个失败即停', r.status === 'failure' && calls.join(',') === 'a,bad', calls.join(','));
}

// —— 条件：与模板 smCondOk 同口径（缺失=失败） ——
{
  const c = (op: BehaviorTreeNode['op'], value: number) =>
    specOf(n({ type: 'condition', var: 'dist', op, value }));
  check('条件 gte 命中', tick(c('gte', 50), createBTState(), { worldVars: { dist: 80 } }).status === 'success');
  check('条件 gte 未命中', tick(c('gte', 50), createBTState(), { worldVars: { dist: 10 } }).status === 'failure');
  check('条件：变量缺失=失败', tick(c('gte', 0)).status === 'failure');
  check('条件 eq/neq', tick(c('eq', 3), createBTState(), { worldVars: { dist: 3 } }).status === 'success'
    && tick(c('neq', 3), createBTState(), { worldVars: { dist: 3 } }).status === 'failure');
}

// —— 取反 ——
{
  const inv = specOf(n({ type: 'inverter', children: [n({ type: 'condition', var: 'x', op: 'gte', value: 1 })] }));
  check('取反：子成功→失败、子失败→成功',
    tick(inv, createBTState(), { worldVars: { x: 5 } }).status === 'failure'
    && tick(inv, createBTState(), { worldVars: { x: 0 } }).status === 'success');
  const invWait = specOf(n({ type: 'inverter', children: [n({ type: 'wait', waitSeconds: 1 })] }));
  check('取反：子运行中→运行中', tick(invWait).status === 'running');
  check('修饰无子节点=失败', tick(specOf(n({ type: 'inverter', children: [] }))).status === 'failure');
}

// —— 重复 ——
{
  const rep3 = specOf(n({ type: 'repeat', repeatCount: 3, children: [n({ type: 'setMove', moveX: 1 })] }));
  const st = createBTState();
  const s1 = tick(rep3, st).status, s2 = tick(rep3, st).status, s3 = tick(rep3, st).status;
  check('重复 3 遍：第 1/2 步运行中、第 3 步成功', s1 === 'running' && s2 === 'running' && s3 === 'success', `${s1},${s2},${s3}`);
  const s4 = tick(rep3, st).status;
  check('重复：成功后计数清零（再跑重新计数）', s4 === 'running');
  const repInf = specOf(n({ type: 'repeat', repeatCount: 0, children: [n({ type: 'setMove', moveX: 0 })] }));
  const st2 = createBTState();
  let allRunning = true;
  for (let i = 0; i < 5; i++) allRunning = allRunning && tick(repInf, st2).status === 'running';
  check('重复 0=一直跑：连 tick 恒运行中', allRunning);
  const repFail = specOf(n({ type: 'repeat', repeatCount: 2, children: [n({ type: 'intent', intentName: 'no' })] }));
  check('重复：子失败=失败', tick(repFail, createBTState(), { runtime: { intent: () => false } }).status === 'failure');
}

// —— 等待 ——
{
  const wait = specOf(n({ type: 'wait', waitSeconds: 0.25 }));
  const st = createBTState();
  const r1 = tick(wait, st, { dt: 0.1 }).status;
  const r2 = tick(wait, st, { dt: 0.1 }).status;
  const r3 = tick(wait, st, { dt: 0.1 }).status;
  const r4 = tick(wait, st, { dt: 0.1 }).status;
  check('等待 0.25s @0.1 步进：前 3 步运行中、第 4 步成功', r1 === 'running' && r2 === 'running' && r3 === 'running' && r4 === 'success', `${r1},${r2},${r3},${r4}`);
  check('等待：成功后内部键清除（再 tick 重新计时）', tick(wait, st, { dt: 0.1 }).status === 'running');
  check('等待 0 秒=立即成功', tick(specOf(n({ type: 'wait', waitSeconds: 0 }))).status === 'success');
}

// —— 动作与黑板 ——
{
  const st = createBTState();
  const tree = specOf(n({ type: 'sequence', children: [
    n({ type: 'setVar', setVarName: 'rage', setVarValue: 1 }),
    n({ type: 'condition', var: 'rage', op: 'eq', value: 1 }),
  ] }));
  const r = tick(tree, st);
  check('写变量进黑板、同 tick 内条件可读', r.status === 'success' && st.vars.rage === 1);
  const r2 = tick(specOf(n({ type: 'condition', var: 'rage', op: 'eq', value: 1 })), st, { worldVars: { rage: 0 } });
  check('世界变量覆盖黑板同名键', r2.status === 'failure');
  const st3 = createBTState();
  tick(specOf(n({ type: 'wait', waitSeconds: 5 })), st3, { dt: 0.1, worldVars: { '__bt_wait_x': 999 } });
  check('世界变量不得写入内部区', st3.vars['__bt_wait_x'] === undefined);
  const moves: number[] = [];
  const r4 = tick(specOf(n({ type: 'setMove', moveX: -0.5 })), createBTState(), { runtime: { setMove: (x) => moves.push(x) } });
  check('移动转发运行时、恒成功', r4.status === 'success' && moves.join(',') === '-0.5');
  const r5 = tick(specOf(n({ type: 'setVar', setVarName: 'foo', setVarValue: 2 })), createBTState(), { runtime: { setVar: () => false } });
  check('写变量：转发被拒不影响黑板与成败', r5.status === 'success');
  check('意图：无运行时无清单=失败', tick(specOf(n({ type: 'intent', intentName: 'atk' }))).status === 'failure');
  check('意图：清单回退口径', tick(specOf(n({ type: 'intent', intentName: 'atk' })), createBTState(), { knownIntents: new Set(['atk']) }).status === 'success');
}

// —— trace ——
{
  const tree = specOf(n({ type: 'selector', id: 'root', children: [
    n({ type: 'condition', var: 'a', op: 'gte', value: 1 }),
    n({ type: 'intent', intentName: 'go' }),
  ] }));
  const r = tick(tree, createBTState(), { worldVars: { a: 0 }, knownIntents: new Set(['go']) });
  check('trace：先序、深度正确（根 0、子 1）',
    r.trace.length === 3 && r.trace[0].id === 'root' && r.trace[0].depth === 0 && r.trace[1].depth === 1 && r.trace[0].status === 'success');
}

// —— 校验 ——
{
  const offered = new Set(['atk', 'jump']);
  const bad = specOf(n({ type: 'selector', id: 'r', children: [
    n({ type: 'intent', intentName: 'ghost' }),
    n({ type: 'condition', var: '', op: 'gte', value: 0 }),
    n({ type: 'wait', waitSeconds: -1 }),
    n({ type: 'inverter', children: [] }),
  ] }));
  const w = validateBehaviorTreeSpec(bad, offered);
  check('校验：悬空意图/空变量/负等待/空修饰各报一条', w.length === 4, w.join(' | '));
  check('校验：空树一条', validateBehaviorTreeSpec({ version: 1, root: null }, offered).length === 1);
  const ok = specOf(n({ type: 'sequence', children: [n({ type: 'intent', intentName: 'atk' })] }));
  check('校验：合法树无警告', validateBehaviorTreeSpec(ok, offered).length === 0);
}

// —— 编辑 helpers ——
{
  let s = specOf(n({ type: 'selector', id: 'root', children: [] }));
  s = addChildToSpec(s, 'root', 'condition')!;
  check('加子节点：成功且 id 生成', s.root!.children!.length === 1 && s.root!.children![0].id.startsWith('bt'));
  const inv = specOf(n({ type: 'inverter', id: 'inv', children: [n({ type: 'wait', waitSeconds: 1 })] }));
  check('加子节点：修饰已有子节点拒收', addChildToSpec(inv, 'inv', 'wait') === null);
  check('加子节点：叶子拒收', addChildToSpec(specOf(n({ type: 'wait', id: 'w', waitSeconds: 1 })), 'w', 'wait') === null);
  check('加兄弟：根节点拒收', addSiblingToSpec(s, 'root', 'wait') === null);
  const childId = s.root!.children![0].id;
  const s2 = addSiblingToSpec(s, childId, 'intent')!;
  check('加兄弟：插在其后', s2.root!.children!.length === 2 && s2.root!.children![1].type === 'intent');
  const s3 = moveNodeInSpec(s2, s2.root!.children![1].id, -1)!;
  check('移动：同父内换位', s3.root!.children![0].type === 'intent' && s3.root!.children![1].type === 'condition');
  check('移动：到边界拒收', moveNodeInSpec(s3, s3.root!.children![0].id, -1) === null);
  const s4 = removeNodeFromSpec(s2, childId);
  check('删除：子树移除', s4.root!.children!.length === 1);
  const s5 = removeNodeFromSpec(s2, 'root');
  check('删除根：root 置 null', s5.root === null);
  const s6 = updateNodeInSpec(s2, childId, { var: 'hp', value: 3 })!;
  check('改字段：patch 生效、children 保留', s6.root!.children![0].var === 'hp' && s6.root!.children![0].value === 3);
  const cloned = cloneBTSpec(s2);
  cloned.root!.children = [];
  check('克隆深拷贝：改克隆不影响原树', s2.root!.children!.length === 2);
  const names = collectBTVarNames(specOf(n({ type: 'sequence', children: [
    n({ type: 'condition', var: 'hp', op: 'lt', value: 1 }),
    n({ type: 'setVar', setVarName: 'rage', setVarValue: 1 }),
  ] })));
  check('变量名收集：条件+写变量', names.sort().join(',') === 'hp,rage');
}

console.log(`\n行为树探针：${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
