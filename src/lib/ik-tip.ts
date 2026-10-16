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
 * 计算链的尖端世界位置（像素，世界空间）
 * 尖端 = 末关节位置 + 沿末关节世界角度（Y 轴）外推 tipLength
 * tipLength 默认为末关节精灵的 Y 轴长度（plug 到底端距离）
 */
export function computeIKChainTip(
  ch: Character,
  jointIds: string[],
  tipLengthOverride?: number,
): { tipX: number; tipY: number; tipLength: number } {
  const store = useProjectStore.getState();
  const transforms = computeWorldTransforms(ch, store.currentFrame, store.canvasWidth, store.canvasHeight);
  const joints: { x: number; y: number; angle: number }[] = [];
  for (const jid of jointIds) {
    const t = transforms.get(jid);
    if (!t) break;
    joints.push({ x: subToPx(t.worldX), y: subToPx(t.worldY), angle: t.worldAngle });
  }
  let tipLength = tipLengthOverride ?? 0;
  let tipX = 0, tipY = 0;
  if (joints.length >= 1) {
    const last = joints[joints.length - 1];
    tipX = last.x; tipY = last.y;
    // 默认尖端长：末关节精灵的 Y 轴长度（plug 到底端）
    if (tipLength <= 0) {
      const endNodeId = jointIds[jointIds.length - 1];
      const endNode = ch.nodes[endNodeId];
      const sprite = endNode?.sprite;
      if (sprite && sprite.height > 0) {
        const plugY = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
        tipLength = Math.max(1, sprite.height - plugY);
      } else if (joints.length >= 2) {
        // 无精灵时回退到最后一段骨长
        const prev = joints[joints.length - 2];
        tipLength = Math.hypot(last.x - prev.x, last.y - prev.y);
      }
    }
    if (tipLength > 1e-6) {
      const rad = (last.angle * Math.PI) / 180;
      tipX = last.x + -Math.sin(rad) * tipLength;
      tipY = last.y + Math.cos(rad) * tipLength;
    }
  }
  return { tipX, tipY, tipLength };
}
