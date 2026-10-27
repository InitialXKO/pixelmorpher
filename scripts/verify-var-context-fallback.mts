// 变量上下文兜底探针（行为）：裸调 computeWorldTransforms（覆盖层/
// 命中同款路径，不传 variableContext）时，函数应按主渲染同口径
// 从工程 store 现建变量上下文——变量驱动的蓝图变换不再回退默认值。
import { computeWorldTransforms } from '../src/lib/unified-render';
import { buildVariableContext } from '../src/lib/unified-animation-resolver';
import { createDefaultNode, type Character } from '../src/lib/unified-types';
import { useProjectStore } from '../src/lib/store';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const mkNode = (id: string, name: string, parentId?: string) => {
  const n = createDefaultNode(id, name);
  n.id = id;
  (n.transform as any).variantIndex = 6;
  if (parentId) n.parentId = parentId;
  return n;
};
const root = mkNode('vc_root', 'torso');
(root as any).blueprint = {
  version: 1,
  nodes: [
    { id: 'v', type: 'var', inputs: {}, params: { name: 'push', default: 5 } },
    { id: 't', type: 'transform', inputs: { translateX: { nodeId: 'v', output: 'out' } }, params: {} },
  ],
  outputId: 't',
};
const character = {
  id: 'vc1', name: '变量测试', nodes: { [root.id]: root },
  rootNodeId: root.id, sprites: {}, costumeSets: [], activeCostumeSetId: undefined,
  direction: 6, latitude: 0, ikChains: [],
} as unknown as Character;

const W = 512, H = 512;
const xAt = () => computeWorldTransforms(character, 0, W, H, 12).get(root.id)!.worldX;

// 基线：store 无变量 → 蓝图 var 回退节点 default 5
useProjectStore.setState({ animationVariables: [] as never });
const x5 = xAt();

// store 变量 push=42 → 裸调也应吃到 42（Δ=37px=592 SubPixel）
useProjectStore.setState({
  animationVariables: [{ id: 'pv', name: 'push', value: 42, defaultValue: 42, min: 0, max: 100 }] as never,
});
const x42 = xAt();
ok(x42 - x5 === 592, `裸调吃 store 变量（Δ ${x42 - x5}，期望 592）`);

// 调用方显式传 variableContext（push=100）→ 显式优先于兜底
const vc100 = buildVariableContext(
  [{ id: 'pv', name: 'push', value: 100, defaultValue: 100, min: 0, max: 200 } as never], 0, [], 12);
const x100 = computeWorldTransforms(character, 0, W, H, 12, vc100 as never).get(root.id)!.worldX;
ok(x100 - x42 === 928, `显式上下文优先（Δ ${x100 - x42}，期望 928）`);

useProjectStore.setState({ animationVariables: [] as never });
console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
