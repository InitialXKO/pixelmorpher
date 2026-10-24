// 节点循环命中（中键点击）与锁定解析的纯逻辑，供画布交互与探针共用。

/**
 * 在命中栈（按命中分数升序，即最优先在前）里求下一个节点：
 * 当前节点在栈内 → 取下一个（末尾回绕到第一个）；
 * 不在栈内（含无锁定/未选中）→ 取第一个；空栈 → null。
 */
export function cycleHitNodeId(hitIds: string[], currentId: string | null): string | null {
  if (hitIds.length === 0) return null;
  const idx = currentId ? hitIds.indexOf(currentId) : -1;
  if (idx < 0) return hitIds[0];
  return hitIds[(idx + 1) % hitIds.length];
}

/** 锁定节点是否仍存在（任一角色的节点表里）；不存在视为未锁定 */
export function lockNodeExists(
  characters: Record<string, { nodes: Record<string, unknown> }>,
  lockId: string | null,
): lockId is string {
  if (!lockId) return false;
  for (const ch of Object.values(characters)) {
    if (ch.nodes[lockId]) return true;
  }
  return false;
}
