/**
 * ik-tip.ts — IK 链尖端位置计算（共用）
 *
 * 用真实变换管线（computeWorldTransforms）算链的尖端世界位置，
 * UI 和拖拽逻辑共用，与 applyIKChain 同源。
 */

import { computeWorldTransforms } from './unified-render';
import { subToPx } from './unified-types';
import { useProjectStore } from './store';
import type { Character } from './unified-types';

/** 按 chain 的 root/end 算出 jointIds（root→end） */
export function getIKChainJointIds(ch: Character, rootNodeId: string, endNodeId: string): string[] {
  const path: string[] = [];
  let cur: string | undefined = endNodeId;
  const visited = new Set<string>();
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    path.unshift(cur);
    if (cur === rootNodeId) break;
    cur = ch.nodes[cur]?.parentId;
  }
  return path[0] === rootNodeId ? path : [];
}

/**
 * 计算链的尖端世界位置（像素，原点中心世界空间，3D）
 * 尖端 = 末关节 3D 位置 + 末关节局部 Y 轴的 3D 方向 × tipLength，
 * 其中 Y 轴方向 = 视平面内的 (-sin a, cos a)（a=末关节世界角）保持深度分量 0 反投影回 3D
 * ——与 applyIKChain 的尖端构造严格同构，保证以尖端为目标时求解不跳变。
 * tipLength 默认为末关节精灵的 Y 轴长度（plug 到底端距离）
 */
export function computeIKChainTip(
  ch: Character,
  jointIds: string[],
  tipLengthOverride?: number,
): { tipX: number; tipY: number; tipZ: number; tipLength: number } {
  const store = useProjectStore.getState();
  const transforms = computeWorldTransforms(ch, store.currentFrame, store.canvasWidth, store.canvasHeight);
  const joints: { x: number; y: number; z: number; angle: number; variant: number }[] = [];
  for (const jid of jointIds) {
    const t = transforms.get(jid);
    if (!t) break;
    joints.push({ x: subToPx(t.worldX), y: subToPx(t.worldY), z: subToPx(t.worldZ), angle: t.worldAngle, variant: t.variantIndex });
  }
  let tipLength = tipLengthOverride ?? 0;
  let tipX = 0, tipY = 0, tipZ = 0;
  if (joints.length >= 1) {
    const last = joints[joints.length - 1];
    tipX = last.x; tipY = last.y; tipZ = last.z;
    // 默认尖端长：末关节精灵的 Y 轴长度（plug 到底端）
    if (tipLength <= 0) {
      const endNodeId = jointIds[jointIds.length - 1];
      const endNode = ch.nodes[endNodeId];
      const sprite = endNode?.sprite;
      if (sprite && sprite.height > 0) {
        const plugY = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
        tipLength = Math.max(1, sprite.height - plugY);
      } else if (joints.length >= 2) {
        // 无精灵时回退到最后一段骨长（视平面口径，与求解器的 lengths 回退一致）
        const prev = joints[joints.length - 2];
        const th = (((prev.variant + 2) % 8) * Math.PI) / 4;
        const du = (last.x - prev.x) * Math.cos(th) + (last.z - prev.z) * Math.sin(th);
        tipLength = Math.hypot(du, last.y - prev.y);
      }
    }
    if (tipLength > 1e-6) {
      // 末关节局部 Y 轴的 3D 方向：视平面内 (-sin a, cos a)、深度分量 0，反投影回 3D
      const theta = (((last.variant + 2) % 8) * Math.PI) / 4;
      const rad = (last.angle * Math.PI) / 180;
      const h = -Math.sin(rad);
      const dirX = h * Math.cos(theta);
      const dirZ = h * Math.sin(theta);
      tipX = last.x + dirX * tipLength;
      tipY = last.y + Math.cos(rad) * tipLength;
      tipZ = last.z + dirZ * tipLength;
    }
  }
  return { tipX, tipY, tipZ, tipLength };
}
