// 节点循环命中纯逻辑探针
import { cycleHitNodeId, lockNodeExists } from '../src/lib/node-cycle';

let passed = 0;
const check = (name: string, cond: boolean) => {
  if (!cond) throw new Error(`FAIL: ${name}`);
  console.log(`✓ ${name}`);
  passed++;
};

check('空栈 → null', cycleHitNodeId([], 'a') === null);
check('无当前 → 栈顶', cycleHitNodeId(['a', 'b', 'c'], null) === 'a');
check('当前不在栈 → 栈顶', cycleHitNodeId(['a', 'b'], 'zz') === 'a');
check('当前在栈中 → 下一个', cycleHitNodeId(['a', 'b', 'c'], 'a') === 'b');
check('末尾回绕 → 栈顶', cycleHitNodeId(['a', 'b', 'c'], 'c') === 'a');
check('单元素栈 → 自身', cycleHitNodeId(['a'], 'a') === 'a');
check('锁定存在性：命中', lockNodeExists({ c1: { nodes: { n1: {} } } }, 'n1') === true);
check('锁定存在性：已删 → false', lockNodeExists({ c1: { nodes: { n1: {} } } }, 'gone') === false);
check('锁定存在性：null → false', lockNodeExists({}, null) === false);

console.log(`\n节点循环探针全过（${passed} 项）`);
