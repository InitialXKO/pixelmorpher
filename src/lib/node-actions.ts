// 节点结构操作助手：右键菜单（节点树/画布）与面板按钮共用同一口径，
// 构造与确认文案对齐 RigPanel 既有 handler 与资产面板的添加节点对话框。

import { useProjectStore } from './store';
import { pxToSub, type Node } from './unified-types';

/** 收集子树全部节点 id（含根）：后代关系同时认 parentId 与插槽归属
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

/** 找节点的父节点（parentId 优先，其次插槽归属） */
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

/** 在父节点下新建子节点（与资产面板添加节点对话框同构造：
 *  有插槽挂第一个插槽，无插槽用 fixed 附着）。返回新节点并选中 */
export function addChildNode(characterId: string, parent: Node): Node | null {
  const store = useProjectStore.getState();
  const character = store.unifiedCharacters[characterId];
  if (!character) return null;
  const name = `节点_${Object.keys(character.nodes).length + 1}`;
  const firstSocket = parent.sockets?.[0];
  const attachment = firstSocket
    ? { type: 'socket' as const, parentSocketId: firstSocket.id, plug: { x: 0, y: 0 } }
    : { type: 'fixed' as const, fixedOffset: { x: 0, y: 0 }, inheritRotation: true };
  const node = store.addUnifiedNode(characterId, name, { zIndex: 0, attachment });
  store.setSelectedNodeId(node.id);
  return node;
}

/** 给节点添加一个插槽（构造与 RigPanel handleAddSocket 一致） */
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
