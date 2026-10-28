// 添加节点挂接探针：addUnifiedNode 必须把 parentId + 父 children 写全——
// 渲染按 root→children 遍历，只写 attachment 的节点不可达、永远不显示
//（向导/资产面板添加的肢体曾全中招：在列表里能选中能抠图、画布不渲染）。
import { useProjectStore } from '../src/lib/store';
import { computeWorldTransforms, computeMannequinShapes } from '../src/lib/unified-render';
import { createDefaultSocket, pxToSub, subToPx } from '../src/lib/unified-types';

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

// 右键「新建子节点」真实路径（addChildNode）：
// E1 父节点有插槽 → 子节点挂该父；
// E2 父节点无插槽（新建节点默认无插槽）→ 仍挂该父，不许落到根下变同级
const { addChildNode } = await import('../src/lib/node-actions');
ch = useProjectStore.getState().unifiedCharacters[charId]!;
const e1 = addChildNode(charId, ch.nodes[root.id]!);
ch = useProjectStore.getState().unifiedCharacters[charId]!;
ok('E1 有插槽父节点：子节点 parentId=所点节点', !!e1 && ch.nodes[e1.id]?.parentId === root.id && ch.nodes[root.id]!.children.includes(e1.id));
const e2 = addChildNode(charId, ch.nodes[e1!.id]!);
ch = useProjectStore.getState().unifiedCharacters[charId]!;
ok('E2 无插槽父节点：子节点 parentId=所点节点（非根）', !!e2 && ch.nodes[e2.id]?.parentId === e1!.id && ch.nodes[e1!.id]!.children.includes(e2.id));
ok('E3 无插槽路径子节点世界变换可达', !!e2 && computeWorldTransforms(ch, 0, 400, 400).has(e2.id));

// F 自动建插槽：无插槽的腕节点新建子节点 → 腕上多一个插槽、子节点插
// 在新插槽上、段长 = 入段 30×(0.16/0.44) ≈ 10.9（人偶里即真实段、
// 手掌延伸撤下由真实段接管）；有插槽的父节点不新建
const mkLinked = (name: string, parentId: string, inLenPx: number) => {
  const sockId = `sock_F_${name}`;
  const st = useProjectStore.getState();
  const p = st.unifiedCharacters[charId]!.nodes[parentId]!;
  st.updateUnifiedNode(charId, parentId, {
    sockets: [...(p.sockets ?? []), createDefaultSocket(sockId, name, 0, pxToSub(inLenPx))],
  });
  return st.addUnifiedNode(charId, name, {
    attachment: { type: 'socket', parentSocketId: sockId, plug: { x: 0, y: 0 } },
    parentId,
  });
};
const farm = mkLinked('forearm_L', root.id, 30);
const wristN = mkLinked('wrist_L', farm.id, 30);
ch = useProjectStore.getState().unifiedCharacters[charId]!;
ok('F0 腕节点初始无插槽', (ch.nodes[wristN.id]!.sockets ?? []).length === 0);
const fChild = addChildNode(charId, ch.nodes[wristN.id]!);
ch = useProjectStore.getState().unifiedCharacters[charId]!;
const wristAfter = ch.nodes[wristN.id]!;
ok('F1 腕上新建了 1 个插槽', wristAfter.sockets.length === 1);
ok('F2 子节点插在新插槽上且 parentId=腕',
  !!fChild && fChild.attachment.type === 'socket'
  && fChild.attachment.parentSocketId === wristAfter.sockets[0]!.id
  && ch.nodes[fChild.id]?.parentId === wristN.id);
const wtF = computeWorldTransforms(ch, 0, 400, 400);
const wPos = wtF.get(wristN.id)!, cPos = wtF.get(fChild!.id)!;
const fDist = Math.hypot(subToPx(cPos.worldX) - subToPx(wPos.worldX), subToPx(cPos.worldY) - subToPx(wPos.worldY));
ok(`F3 段长 ≈ 入段 30×(0.16/0.44) ≈ 10.9（实际 ${fDist.toFixed(1)}）`, Math.abs(fDist - 30 * (0.16 / 0.44)) < 1.5);
const shapesF = computeMannequinShapes(ch, wtF, 400, 400, 6, new Set(Object.keys(ch.nodes)));
const segF = shapesF.find((s) => s.kind === 'segment' && s.nodeId === wristN.id && s.toNodeId === fChild!.id);
ok('F4 人偶出腕→子真实段、腕手掌延伸撤下',
  !!segF && Math.abs(Math.hypot(segF.x2 - segF.x1, segF.y2 - segF.y1) - 30 * (0.16 / 0.44)) < 1.5
  && !shapesF.some((s) => s.kind === 'hand' && s.nodeId === wristN.id));
const rootSockCount = ch.nodes[root.id]!.sockets.length;
const fRoot = addChildNode(charId, ch.nodes[root.id]!);
ch = useProjectStore.getState().unifiedCharacters[charId]!;
ok('F5 有插槽的父节点不新建插槽、子节点挂既有插槽',
  ch.nodes[root.id]!.sockets.length === rootSockCount
  && !!fRoot && fRoot.attachment.type === 'socket'
  && ch.nodes[root.id]!.sockets.some((s) => s.id === fRoot.attachment.parentSocketId));

console.log(`合计：${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
