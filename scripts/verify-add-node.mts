// 添加节点挂接探针：addUnifiedNode 必须把 parentId + 父 children 写全——
// 渲染按 root→children 遍历，只写 attachment 的节点不可达、永远不显示
//（向导/资产面板添加的肢体曾全中招：在列表里能选中能抠图、画布不渲染）。
import { useProjectStore } from '../src/lib/store';
import { computeWorldTransforms } from '../src/lib/unified-render';
import { createDefaultSocket } from '../src/lib/unified-types';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

const ps = useProjectStore.getState();
const ch0 = ps.addUnifiedCharacter('探针角色');
const charId = ch0.id;
const root = ch0.nodes[ch0.rootNodeId]!;

// socket 路径：父（根）上开一个插槽，子节点经 attachment.parentSocketId 挂入
const sockId = 'sock_probe_1';
ps.updateUnifiedNode(charId, root.id, { sockets: [createDefaultSocket(sockId, '挂点', 0, 160)] });
const sockChild = ps.addUnifiedNode(charId, '剑', {
  attachment: { type: 'socket', parentSocketId: sockId, plug: { x: 0, y: 0 } },
  zIndex: 1,
});
let ch = useProjectStore.getState().unifiedCharacters[charId]!;
ok('A1 socket 子节点 parentId=插槽属主', ch.nodes[sockChild.id]?.parentId === root.id);
ok('A2 socket 子节点进父 children', ch.nodes[root.id]!.children.includes(sockChild.id));
ok('A3 socket 子节点世界变换可达', computeWorldTransforms(ch, 0, 400, 400).has(sockChild.id));

// fixed 路径：无插槽信息 → 挂根
const fixedChild = ps.addUnifiedNode(charId, '尾巴', {
  attachment: { type: 'fixed', fixedOffset: { x: 0, y: 0 }, inheritRotation: true },
  zIndex: 1,
});
ch = useProjectStore.getState().unifiedCharacters[charId]!;
ok('B1 fixed 子节点 parentId=根', ch.nodes[fixedChild.id]?.parentId === root.id);
ok('B2 fixed 子节点世界变换可达', computeWorldTransforms(ch, 0, 400, 400).has(fixedChild.id));

// 无 opts：同样挂根可达（plugin-api 等调用方）
const bare = ps.addUnifiedNode(charId, '裸节点');
ch = useProjectStore.getState().unifiedCharacters[charId]!;
ok('C1 无 opts 节点挂根可达', ch.nodes[bare.id]?.parentId === root.id && computeWorldTransforms(ch, 0, 400, 400).has(bare.id));

// 显式 parentId 优先于推导
const explicit = ps.addUnifiedNode(charId, '显式子', { parentId: sockChild.id } as any);
ch = useProjectStore.getState().unifiedCharacters[charId]!;
ok('D1 显式 parentId 被尊重并挂 children', ch.nodes[explicit.id]?.parentId === sockChild.id && ch.nodes[sockChild.id]!.children.includes(explicit.id));

console.log(`合计：${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
