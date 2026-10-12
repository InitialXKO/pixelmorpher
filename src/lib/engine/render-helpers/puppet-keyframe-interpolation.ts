/**
 * Helper: interpolate puppet node keyframes.
 * Extracted from renderPuppetNodes to reduce cyclomatic complexity.
 *
 * For each node, finds surrounding PuppetNodeKeyframes and interpolates:
 * - angle/direction/viewLatitude/zIndex: hold (step) interpolation
 * - offsetX/offsetY/stretch: linear lerp
 */

import type { PuppetSkeleton, PuppetNodeKeyframe, PuppetDirection } from '../../types';
import type { InterpolatedNodeValues } from './types';
import { computePartAnimationTransform } from '../animation-dispatch';
import { evaluateBlueprint } from '../../blueprint/eval';
import { modifiersToBlueprint } from '../../blueprint/migrate';

// hold 等有状态节点的跨帧存储
// key: `${skeletonId}:${nodeId}:${blueprintNodeId}`
// 倒播/跳帧时清空（避免状态错乱）
const blueprintNodeState = new Map<string, any>();
let lastFrame = -1;

/**
 * Compute interpolated values for every node in the skeleton.
 * Pre-indexes keyframes by nodeId for O(N+K) performance.
 */
export function interpolateNodeKeyframes(
  skeleton: PuppetSkeleton,
  puppetNodeKeyframes: PuppetNodeKeyframe[],
  currentFrame: number,
): Map<string, InterpolatedNodeValues> {
  const result = new Map<string, InterpolatedNodeValues>();

  // Pre-index keyframes by nodeId for O(N+K) instead of O(N*K)
  const kfByNodeId = new Map<string, PuppetNodeKeyframe[]>();
  for (const kf of puppetNodeKeyframes) {
    const arr = kfByNodeId.get(kf.nodeId) || [];
    arr.push(kf);
    kfByNodeId.set(kf.nodeId, arr);
  }
  // Sort each bucket once
  for (const [, arr] of kfByNodeId) {
    arr.sort((a, b) => a.frame - b.frame);
  }

  // 倒播或跳帧时清空有状态节点的存储
  if (currentFrame < lastFrame || currentFrame > lastFrame + 5) {
    blueprintNodeState.clear();
  }
  lastFrame = currentFrame;

  // 两遍求值：第一遍算出所有节点的 transform，第二遍让 nodeRef 能读到
  // （无 nodeRef 的蓝图两遍结果一致，有 nodeRef 的第二遍才拿到跨节点值）
  const nodeOutputs = new Map<string, { rotation: number; translateX: number; translateY: number; scaleX: number; scaleY: number; zIndex: number }>();

  for (let pass = 0; pass < 2; pass++) {
  for (const node of skeleton.nodes) {
    const nodeKfs = kfByNodeId.get(node.id) || [];
    const values = interpolateSingleNode(node, nodeKfs, currentFrame, skeleton.currentDirection, skeleton.viewLatitude);
    // 程序化动画：优先用蓝图 IR，没有蓝图则用旧 modifiers 列表
    const hasBp = !!node.blueprint;
    const modLen = node.modifiers?.length ?? 0;
    const blueprint = node.blueprint ?? (node.modifiers?.length ? modifiersToBlueprint(node.modifiers) : null);
    if (blueprint) {
      const t = evaluateBlueprint(blueprint, {
        frame: currentFrame,
        frameRate: 12,
        vars: {},
        nodeOutputs: pass === 1 ? nodeOutputs : undefined,
        nodeState: blueprintNodeState,
      });
      if (currentFrame % 30 === 0 && pass === 0 && node.name?.includes('upper_leg')) {
        console.log(`[蓝图求值] ${node.name} frame=${currentFrame} rotation=${t.rotation.toFixed(2)} hasBp=${hasBp} mods=${modLen}`);
      }
      values.angle += t.rotation;
      values.offsetX += t.translateX;
      values.offsetY += t.translateY;
      values.stretch *= t.scaleY;
      // zIndex：蓝图输出直接覆盖（非累加）
      if (t.zIndex !== 0) values.zIndex = t.zIndex;
      // 记录供第二遍的 nodeRef 读取
      if (pass === 0) {
        nodeOutputs.set(node.id, {
          rotation: t.rotation,
          translateX: t.translateX,
          translateY: t.translateY,
          scaleX: t.scaleX,
          scaleY: t.scaleY,
          zIndex: t.zIndex,
        });
      }
    } else {
      // 兼容：直接用旧求值器（蓝图转换失败时的兜底）
      const mods = node.modifiers ?? [];
      if (mods.length > 0) {
        const t = computePartAnimationTransform(mods, currentFrame, 12);
        values.angle += t.rotation;
        values.offsetX += t.translateX;
        values.offsetY += t.translateY;
        values.stretch *= t.scaleY;
      }
    }
    if (pass === 1) {
      result.set(node.id, values);
    }
  }
  }

  return result;
}

// ── Internal helpers ──────────────────────────────────────────

function interpolateSingleNode(
  node: { id: string; angle: number; stretch: number; offsetX: number; offsetY: number; zIndex: number },
  nodeKfs: PuppetNodeKeyframe[],
  currentFrame: number,
  fallbackDirection: PuppetDirection,
  fallbackLatitude: number,
): InterpolatedNodeValues {
  // No keyframes — use rest values from the node
  if (nodeKfs.length === 0) {
    return {
      angle: node.angle,
      stretch: node.stretch,
      offsetX: node.offsetX,
      offsetY: node.offsetY,
      direction: fallbackDirection,
      viewLatitude: fallbackLatitude,
      zIndex: node.zIndex,
    };
  }

  // Find surrounding keyframes
  let prevKf: PuppetNodeKeyframe | null = null;
  let nextKf: PuppetNodeKeyframe | null = null;
  for (const kf of nodeKfs) {
    if (kf.frame <= currentFrame) prevKf = kf;
    if (kf.frame > currentFrame && !nextKf) nextKf = kf;
  }

  // No previous keyframe — use the first keyframe's values (hold forward)
  if (!prevKf) {
    const first = nodeKfs[0];
    return {
      angle: first.angle ?? node.angle,
      stretch: first.stretch ?? node.stretch,
      offsetX: first.offsetX ?? node.offsetX,
      offsetY: first.offsetY ?? node.offsetY,
      direction: first.direction ?? fallbackDirection,
      viewLatitude: first.viewLatitude ?? fallbackLatitude,
      zIndex: first.zIndex ?? node.zIndex,
    };
  }

  // Both prev and next — interpolate
  if (nextKf && prevKf.frame !== nextKf.frame) {
    const t = (currentFrame - prevKf.frame) / (nextKf.frame - prevKf.frame);
    return {
      angle: prevKf.angle ?? node.angle,
      stretch: lerp(prevKf.stretch ?? node.stretch, nextKf.stretch ?? node.stretch, t),
      offsetX: lerp(prevKf.offsetX ?? node.offsetX, nextKf.offsetX ?? node.offsetX, t),
      offsetY: lerp(prevKf.offsetY ?? node.offsetY, nextKf.offsetY ?? node.offsetY, t),
      direction: prevKf.direction ?? fallbackDirection,
      viewLatitude: prevKf.viewLatitude ?? fallbackLatitude,
      // zIndex: step 插值，不 lerp，到帧直接跳变
      zIndex: prevKf.zIndex ?? node.zIndex,
    };
  }

  // Only prev keyframe — hold
  return {
    angle: prevKf.angle ?? node.angle,
    stretch: prevKf.stretch ?? node.stretch,
    offsetX: prevKf.offsetX ?? node.offsetX,
    offsetY: prevKf.offsetY ?? node.offsetY,
    direction: prevKf.direction ?? fallbackDirection,
    viewLatitude: prevKf.viewLatitude ?? fallbackLatitude,
    zIndex: prevKf.zIndex ?? node.zIndex,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
