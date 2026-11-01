// 节点结构操作助手：右键菜单（节点树/画布）与面板按钮共用同一口径，
// 构造与确认文案对齐 RigPanel 既有 handler 与资产面板的添加节点对话框。

import { useProjectStore } from './store';
import { createDefaultSocket, pxToSub, type Attachment, type DirectionIndex, type Node } from './unified-types';
import { mannequinLimbKind, socketOffsetTo3D } from './unified-render';

/** 收集子树全部节点 id（含根）：后代关系同时认 parentId 与槽位归属
 *  （对话框新建的子节点只有 attachment.parentSocketId、没有 parentId） */
export function collectSubtreeIds(nodes: Record<string, Node>, rootId: string): string[] {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of Object.values(nodes)) {
      if (ids.has(n.id)) continue;
      if (n.parentId && ids.has(n.parentId)) {
        ids.add(n.id);
        changed = true;
        continue;
      }
      const sockId = n.attachment?.parentSocketId;
      if (sockId) {
        for (const pid of ids) {
          if (nodes[pid]?.sockets?.some((s) => s.id === sockId)) {
            ids.add(n.id);
            changed = true;
            break;
          }
        }
      }
    }
  }
  return [...ids];
}

/** 找节点的父节点（parentId 优先，其次槽位归属） */
export function findParentNode(nodes: Record<string, Node>, node: Node): Node | null {
  if (node.parentId && nodes[node.parentId]) return nodes[node.parentId];
  const sockId = node.attachment?.parentSocketId;
  if (sockId) {
    for (const n of Object.values(nodes)) {
      if (n.sockets?.some((s) => s.id === sockId)) return n;
    }
  }
  return null;
}

/** 删除节点及整个子树（根节点拒绝）；确认文案与 RigPanel 删除一致。返回是否执行 */
export function deleteNodeSubtree(characterId: string, rootId: string): boolean {
  const store = useProjectStore.getState();
  const character = store.unifiedCharacters[characterId];
  if (!character) return false;
  const node = character.nodes[rootId];
  if (!node || rootId === character.rootNodeId) return false;
  const ids = collectSubtreeIds(character.nodes, rootId);
  const childCount = ids.length - 1;
  if (
    childCount > 0 &&
    !confirm(`删除节点「${node.name}」会连带删除 ${childCount} 个子节点，继续？`)
  ) {
    return false;
  }
  store.pushUndo('删除节点');
  const parent = findParentNode(character.nodes, node);
  if (parent && parent.children.includes(rootId)) {
    store.updateUnifiedNode(characterId, parent.id, {
      children: parent.children.filter((id) => id !== rootId),
    });
  }
  for (const id of ids) store.removeUnifiedNode(characterId, id);
  if (store.selectedNodeId && ids.includes(store.selectedNodeId)) {
    store.setSelectedNodeId(null);
  }
  return true;
}

/** 子节点的挂接：父节点有槽位 → 挂第一个；没有 → 先在父节点上新建
 * 一个槽位再挂——沿父节点局部 +Y（肢体伸出方向，与肢链槽位同款
 * 约定），长度按父节点入段长定：手/脚末端取人偶延伸同口径的比例
 * （臂 ×0.16/0.44、腿 ×0.15/0.45），其余取入段全长，无入段回退 20px。
 * 此前无槽位直接退成同位 fixed：子节点贴在父关节上、段长为零，
 * 手/脚的人偶延伸又因「非叶子」被撤，胶囊整个消失（用户实测）。 */
export function ensureChildAttachment(characterId: string, parent: Node, childName: string): Attachment {
  const store = useProjectStore.getState();
  const character = store.unifiedCharacters[characterId];
  const fresh = character?.nodes[parent.id] ?? parent;
  const firstSocket = fresh.sockets?.[0];
  if (firstSocket) {
    return { type: 'socket', parentSocketId: firstSocket.id, plug: { x: 0, y: 0 } };
  }
  // 父节点入段长 = 它挂在祖父槽位上的那段偏移的长
  let inLenPx = 0;
  if (character && fresh.parentId && fresh.attachment?.type === 'socket' && fresh.attachment.parentSocketId) {
    const grand = character.nodes[fresh.parentId];
    const inSocket = grand?.sockets?.find((s) => s.id === fresh.attachment.parentSocketId);
    if (inSocket) {
      const v = socketOffsetTo3D(inSocket, (fresh.transform.variantIndex ?? 6) as DirectionIndex);
      inLenPx = Math.hypot(v.x, v.y, v.z);
    }
  }
  const kind = character ? mannequinLimbKind(character, fresh) : null;
  const lenPx = inLenPx > 0
    ? kind === 'arm' ? inLenPx * (0.16 / 0.44) : kind === 'leg' ? inLenPx * (0.15 / 0.45) : inLenPx
    : 20;
  const socket = createDefaultSocket(crypto.randomUUID(), childName, 0, pxToSub(lenPx));
  store.updateUnifiedNode(characterId, fresh.id, { sockets: [...(fresh.sockets ?? []), socket] });
  return { type: 'socket', parentSocketId: socket.id, plug: { x: 0, y: 0 } };
}

/** 在父节点下新建子节点（与资产面板添加节点对话框同构造：
 *  挂接走 ensureChildAttachment——无槽位自动新建槽位）。
 *  返回新节点并选中 */
export function addChildNode(characterId: string, parent: Node): Node | null {
  const store = useProjectStore.getState();
  const character = store.unifiedCharacters[characterId];
  if (!character) return null;
  const name = `节点_${Object.keys(character.nodes).length + 1}`;
  const attachment = ensureChildAttachment(characterId, parent, name);
  // 父级必须显式给：不给时 addUnifiedNode 只能按 attachment 推导，无槽位
  // 的父节点推导不出、会落到根节点——新节点就成了根的子节点（在树上
  // 表现为与所点节点同级），而不是所点节点的子节点。
  const node = store.addUnifiedNode(characterId, name, { zIndex: 0, attachment, parentId: parent.id });
  store.setSelectedNodeId(node.id);
  return node;
}

/** 节点在 IK 链中的身份：'root' = 链根（可整链搬迁）、'member' = 链中间关节
 *  （改父级会断链）、null = 不在任何链中 */
export function ikChainMembership(
  character: { ikChains?: { rootNodeId: string; endNodeId: string }[]; nodes: Record<string, Node> },
  nodeId: string,
): 'root' | 'member' | null {
  for (const chain of character.ikChains ?? []) {
    if (chain.rootNodeId === nodeId) return 'root';
    let cur: Node | undefined = character.nodes[chain.endNodeId];
    const seen = new Set<string>();
    while (cur && cur.id !== chain.rootNodeId && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.id === nodeId) return 'member';
      cur = findParentNode(character.nodes, cur) ?? undefined;
    }
  }
  return null;
}

/** 更改节点的父节点与连接槽位：三处写齐——attachment.parentSocketId、
 * 新旧父级的 children 迁移、node.parentId（渲染按 children 遍历 + 在父身上查槽位，
 * 只改 attachment 会留半吊子状态）。socketId 为 null = 固定连接（不用槽位）。
 * 根节点拒绝、目标在自身子树内拒绝（防环）。返回是否执行（无变化也算执行成功）。 */
export function reparentNode(
  characterId: string,
  nodeId: string,
  target: { parentId: string; socketId: string | null },
): boolean {
  const store = useProjectStore.getState();
  const character = store.unifiedCharacters[characterId];
  if (!character) return false;
  const node = character.nodes[nodeId];
  if (!node || nodeId === character.rootNodeId) return false;
  const newParent = character.nodes[target.parentId];
  if (!newParent) return false;
  if (collectSubtreeIds(character.nodes, nodeId).includes(target.parentId)) return false;
  if (target.socketId !== null && !(newParent.sockets ?? []).some((s) => s.id === target.socketId)) {
    return false;
  }
  const oldParent = findParentNode(character.nodes, node);
  const att = node.attachment;
  const already =
    oldParent?.id === target.parentId &&
    (target.socketId !== null
      ? att?.type === 'socket' && att.parentSocketId === target.socketId
      : att?.type === 'fixed');
  if (already) return true;

  store.pushUndo('更改父节点');
  if (oldParent && oldParent.id !== target.parentId && oldParent.children.includes(nodeId)) {
    store.updateUnifiedNode(characterId, oldParent.id, {
      children: oldParent.children.filter((id) => id !== nodeId),
    });
  }
  if (!newParent.children.includes(nodeId)) {
    store.updateUnifiedNode(characterId, target.parentId, {
      children: [...newParent.children, nodeId],
    });
  }
  const attachment =
    target.socketId !== null
      ? { ...att, type: 'socket' as const, parentSocketId: target.socketId }
      : {
          ...att,
          type: 'fixed' as const,
          parentSocketId: undefined,
          fixedOffset: att?.fixedOffset ?? { x: 0, y: 0 },
          inheritRotation: att?.inheritRotation ?? true,
        };
  store.updateUnifiedNode(characterId, nodeId, { parentId: target.parentId, attachment });
  return true;
}

/** 给节点添加一个槽位（构造与 RigPanel handleAddSocket 一致） */
export function addSocketToNode(characterId: string, node: Node): void {
  const store = useProjectStore.getState();
  const newSocket = {
    id: crypto.randomUUID(),
    name: `socket_${(node.sockets?.length ?? 0) + 1}`,
    basePosition: { x: pxToSub(0), y: pxToSub(-8) },
    directionOffsets: {},
  };
  store.pushUndo('更新节点', 'updateNode');
  store.updateUnifiedNode(characterId, node.id, {
    sockets: [...(node.sockets ?? []), newSocket],
  });
}
