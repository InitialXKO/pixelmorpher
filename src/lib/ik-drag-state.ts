/**
 * ik-drag-state.ts — IK 链拖拽时的临时挂起状态
 *
 * 交互模型：用户直接拖精灵/关节（FK），IK 在拖拽期间挂起，
 * 松手后目标点重算到新尖端位置，IK 恢复。
 * 这样用户不用拖抽象的目标点。
 */

/** 当前正在被 FK 拖拽的 IK 链 ID 集合（挂起中，不参与解算） */
export const suspendedIKChains = new Set<string>();

export function suspendIKChain(chainId: string): void {
  suspendedIKChains.add(chainId);
}

export function resumeIKChain(chainId: string): void {
  suspendedIKChains.delete(chainId);
}

export function isIKChainSuspended(chainId: string): boolean {
  return suspendedIKChains.has(chainId);
}

export function clearSuspendedIKChains(): void {
  suspendedIKChains.clear();
}
