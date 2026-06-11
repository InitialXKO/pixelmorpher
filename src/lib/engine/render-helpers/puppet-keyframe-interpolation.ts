/**
 * Helper: interpolate puppet node keyframes.
 * Extracted from renderPuppetNodes to reduce cyclomatic complexity.
 *
 * For each node, finds surrounding PuppetNodeKeyframes and interpolates:
 * - angle/direction/viewLatitude: hold (step) interpolation
 * - offsetX/offsetY/stretch: linear lerp
 */

import type { PuppetSkeleton, PuppetNodeKeyframe, PuppetDirection } from '../../types';
import type { InterpolatedNodeValues } from './types';

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

  for (const node of skeleton.nodes) {
    const nodeKfs = kfByNodeId.get(node.id) || [];
    const values = interpolateSingleNode(node, nodeKfs, currentFrame, skeleton.currentDirection, skeleton.viewLatitude);
    result.set(node.id, values);
  }

  return result;
}

// ── Internal helpers ──────────────────────────────────────────

function interpolateSingleNode(
  node: { id: string; angle: number; stretch: number; offsetX: number; offsetY: number },
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
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
