/**
 * ik-tip.ts — IK 链尖端位置计算（共用）
 *
 * 用真实变换管线（computeWorldTransforms）算链的尖端世界位置，
 * UI 和拖拽逻辑共用，与求解器（solveChainIKOverrides）同构造。
 */

import { computeWorldTransforms, resolveSpriteTipLength } from './unified-render';
import { frameYAxisWorld, subToPx } from './unified-types';
import { useProjectStore } from './store';
import type { Character, DirectionIndex } from './unified-types';

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
 * 尖端 = 末关节 3D 位置 + 末关节 frame 的 +Y 轴世界方向 × tipLength
 * ——与求解器的尖端构造严格一致，保证以尖端为目标时求解不跳变。
 * tipLength 默认为末关节精灵的 Y 轴长度（plug 到底端距离）
 * direction = 链根关节朝向（target 填充/镜像换算用）
 */
export function computeIKChainTip(
  ch: Character,
  jointIds: string[],
  tipLengthOverride?: number,
  geometryDirection?: DirectionIndex,
): { tipX: number; tipY: number; tipZ: number; tipLength: number; direction: DirectionIndex } {
  const store = useProjectStore.getState();
  const transforms = computeWorldTransforms(ch, store.currentFrame, store.canvasWidth, store.canvasHeight, undefined, undefined, undefined, undefined, geometryDirection);
  const joints: { x: number; y: number; z: number; yAxis: { x: number; y: number; z: number }; variant: DirectionIndex }[] = [];
  for (const jid of jointIds) {
    const t = transforms.get(jid);
    if (!t) break;
    joints.push({
      x: subToPx(t.worldX), y: subToPx(t.worldY), z: subToPx(t.worldZ),
      yAxis: frameYAxisWorld(t.worldFrame, geometryDirection ?? t.variantIndex),
      variant: t.variantIndex,
    });
  }
  let tipLength = tipLengthOverride ?? 0;
  let tipX = 0, tipY = 0, tipZ = 0;
  const direction: DirectionIndex = geometryDirection ?? (joints.length > 0 ? joints[0].variant : 6);
  if (joints.length >= 1) {
    const last = joints[joints.length - 1];
    tipX = last.x; tipY = last.y; tipZ = last.z;
    // 默认尖端长：末关节当前精灵的 Y 轴长度（plug 到底端，走服装解析；
    // 与求解器同一口径 resolveSpriteTipLength）> 旧 node.sprite > 末段骨长
    if (tipLength <= 0) {
      const endNodeId = jointIds[jointIds.length - 1];
      tipLength = resolveSpriteTipLength(ch, endNodeId, last.variant, store.sprites) ?? 0;
      const endNode = ch.nodes[endNodeId];
      const sprite = endNode?.sprite;
      if (tipLength <= 0 && sprite && sprite.height > 0) {
        const plugY = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
        tipLength = Math.max(1, sprite.height - plugY);
      } else if (tipLength <= 0 && joints.length >= 2) {
        // 无精灵时回退到最后一段 3D 骨长（与求解器的 lengths 回退一致）
        const prev = joints[joints.length - 2];
        tipLength = Math.hypot(last.x - prev.x, last.y - prev.y, last.z - prev.z);
      }
    }
    if (tipLength > 1e-6) {
      tipX = last.x + last.yAxis.x * tipLength;
      tipY = last.y + last.yAxis.y * tipLength;
      tipZ = last.z + last.yAxis.z * tipLength;
    }
  }
  return { tipX, tipY, tipZ, tipLength, direction };
}
