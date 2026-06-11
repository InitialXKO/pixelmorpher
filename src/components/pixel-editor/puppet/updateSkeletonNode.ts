import type { PuppetSkeleton, PuppetNode } from '@/lib/types';

/** Immutably update a single node within a skeleton by merging partial updates.
 *  Accepts either a Partial<PuppetNode> or a function that receives the current
 *  node and returns partial updates (useful for updates that depend on current state). */
export function updateSkeletonNode(
  skeleton: PuppetSkeleton,
  nodeId: string,
  updates: Partial<PuppetNode> | ((node: PuppetNode) => Partial<PuppetNode>)
): PuppetSkeleton {
  return {
    ...skeleton,
    nodes: skeleton.nodes.map(node =>
      node.id === nodeId
        ? { ...node, ...(typeof updates === 'function' ? updates(node) : updates) }
        : node
    ),
  };
}
