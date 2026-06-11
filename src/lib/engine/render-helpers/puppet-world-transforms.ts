/**
 * Helper: compute world transforms for puppet skeleton nodes.
 * Extracted from renderPuppetNodes to reduce cyclomatic complexity.
 *
 * Builds the node tree and computes world transforms recursively,
 * handling root nodes, child nodes with socket connections, and
 * latitude-based Y offsets for pseudo-3D depth.
 */

import type { PuppetSkeleton } from '../../types';
import { snapToPixel, buildPuppetNodeTree } from '../../store/puppet-slice';
import type { InterpolatedNodeValues, WorldTransform } from './types';

/** Type for a tree node in the puppet hierarchy */
interface PuppetTreeNode {
  node: PuppetSkeleton['nodes'][0];
  children: PuppetTreeNode[];
}

/**
 * Compute world transforms for all nodes in the skeleton.
 * Returns a map from nodeId → WorldTransform.
 */
export function computePuppetWorldTransforms(
  skeleton: PuppetSkeleton,
  interpolatedValues: Map<string, InterpolatedNodeValues>,
  canvasWidth: number,
  canvasHeight: number,
  latitude: number,
): Map<string, WorldTransform> {
  const tree = buildPuppetNodeTree(skeleton);
  const worldTransforms = new Map<string, WorldTransform>();

  computeWorldTransformsRecursive(
    tree as PuppetTreeNode[],
    skeleton,
    interpolatedValues,
    canvasWidth,
    canvasHeight,
    latitude,
    worldTransforms,
    0, // parentWorldAngle
    0, // depth
  );

  return worldTransforms;
}

// ── Internal recursive implementation ─────────────────────────

function computeWorldTransformsRecursive(
  treeNodes: PuppetTreeNode[],
  skeleton: PuppetSkeleton,
  interpolatedValues: Map<string, InterpolatedNodeValues>,
  canvasWidth: number,
  canvasHeight: number,
  latitude: number,
  worldTransforms: Map<string, WorldTransform>,
  parentWorldAngle: number,
  depth: number,
): void {
  for (const treeNode of treeNodes) {
    const node = treeNode.node;
    const values = interpolatedValues.get(node.id)!;

    if (!node.plug) {
      // Root node: world position at canvas center
      const wx = snapToPixel(canvasWidth / 2 + values.offsetX);
      const wy = snapToPixel(canvasHeight / 2 + values.offsetY);
      const worldAngle = parentWorldAngle + values.angle;
      worldTransforms.set(node.id, { worldX: wx, worldY: wy, worldAngle, worldStretch: values.stretch });
    } else {
      handleChildNode(node, values, skeleton, latitude, canvasWidth, canvasHeight, parentWorldAngle, depth, worldTransforms);
    }

    // Recurse into children using this node's computed world angle
    const wt = worldTransforms.get(node.id)!;
    computeWorldTransformsRecursive(
      treeNode.children,
      skeleton,
      interpolatedValues,
      canvasWidth,
      canvasHeight,
      latitude,
      worldTransforms,
      wt.worldAngle,
      depth + 1,
    );
  }
}

function handleChildNode(
  node: PuppetSkeleton['nodes'][0],
  values: InterpolatedNodeValues,
  skeleton: PuppetSkeleton,
  latitude: number,
  canvasWidth: number,
  canvasHeight: number,
  parentWorldAngle: number,
  depth: number,
  worldTransforms: Map<string, WorldTransform>,
): void {
  const parentNode = skeleton.nodes.find(n =>
    n.sockets.some(s => s.id === node.plug!.socketId)
  );

  if (!parentNode || !worldTransforms.has(parentNode.id)) {
    // No parent found — treat as root
    const wx = snapToPixel(canvasWidth / 2 + values.offsetX);
    const wy = snapToPixel(canvasHeight / 2 + values.offsetY);
    const worldAngle = parentWorldAngle + values.angle;
    worldTransforms.set(node.id, { worldX: wx, worldY: wy, worldAngle, worldStretch: values.stretch });
    return;
  }

  const parentWt = worldTransforms.get(parentNode.id)!;
  const socket = parentNode.sockets.find(s => s.id === node.plug!.socketId);

  if (socket) {
    computeSocketWorldPosition(node, values, parentWt, socket, latitude, depth, worldTransforms);
  } else {
    // Socket not found — place at parent's world position
    const wx = snapToPixel(parentWt.worldX + values.offsetX);
    const latitudeYOffset = computeLatitudeYOffset(latitude, depth);
    const wy = snapToPixel(parentWt.worldY + values.offsetY + latitudeYOffset);
    const worldAngle = parentWt.worldAngle + values.angle;
    worldTransforms.set(node.id, { worldX: wx, worldY: wy, worldAngle, worldStretch: values.stretch });
  }
}

function computeSocketWorldPosition(
  node: PuppetSkeleton['nodes'][0],
  values: InterpolatedNodeValues,
  parentWt: WorldTransform,
  socket: { localX: number; localY: number },
  latitude: number,
  depth: number,
  worldTransforms: Map<string, WorldTransform>,
): void {
  const parentAngleRad = (parentWt.worldAngle * Math.PI) / 180;
  const cosA = Math.cos(parentAngleRad);
  const sinA = Math.sin(parentAngleRad);

  const socketWorldX = parentWt.worldX + (socket.localX * cosA - socket.localY * sinA);
  const socketWorldY = parentWt.worldY + (socket.localX * sinA + socket.localY * cosA);

  const wx = snapToPixel(socketWorldX + values.offsetX);
  const latitudeYOffset = computeLatitudeYOffset(latitude, depth);
  const wy = snapToPixel(socketWorldY + values.offsetY + latitudeYOffset);
  const worldAngle = parentWt.worldAngle + values.angle;

  worldTransforms.set(node.id, { worldX: wx, worldY: wy, worldAngle, worldStretch: values.stretch });
}

function computeLatitudeYOffset(latitude: number, depth: number): number {
  return (latitude > 0 && depth > 0) ? -(Math.min(90, Math.max(0, latitude)) * depth * 0.8) : 0;
}
