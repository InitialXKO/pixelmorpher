/**
 * IK Chain baking: convert high-level IKChain definitions to blueprint nodes.
 *
 * The baked blueprint is persistent and editable in the blueprint editor.
 * Bone lengths are baked as params from the current FK pose.
 * Targets remain as inputs so they can be driven by gait/mouse/const nodes.
 */
import type { BlueprintGraph, BlueprintNode } from './ir';
import type { Character, IKChain } from '../unified-types';
import { subToPx } from '../unified-types';
import type { WorldTransform } from '../unified-render';

/**
 * Bake IK chains to a blueprint graph.
 *
 * For each chain, generates:
 * - An ik_2bone or ik_fabrik node with baked bone lengths
 * - Target X/Y as inputs (connectable to gait, const, mouse, etc.)
 *
 * @param character The character with ikChains
 * @param transforms Current FK world transforms (for bone length measurement)
 * @returns Blueprint graph with IK nodes, or null if no chains
 */
export function ikChainsToBlueprint(
  character: Character,
  transforms: Map<string, WorldTransform>,
): BlueprintGraph | null {
  const chains = character.ikChains?.filter((c) => c.enabled);
  if (!chains || chains.length === 0) return null;

  const nodes: BlueprintNode[] = [];
  let yOffset = 0;

  for (const chain of chains) {
    // Build joint chain
    const jointIds: string[] = [];
    let currentId: string | undefined = chain.endNodeId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      jointIds.unshift(currentId);
      const node = character.nodes[currentId];
      if (!node) break;
      if (currentId === chain.rootNodeId) break;
      currentId = node.parentId;
    }

    if (jointIds.length < 2) continue;
    if (jointIds[0] !== chain.rootNodeId) continue;

    // Measure bone lengths from FK
    const lengths: number[] = [];
    for (let i = 0; i < jointIds.length - 1; i++) {
      const t1 = transforms.get(jointIds[i]);
      const t2 = transforms.get(jointIds[i + 1]);
      if (!t1 || !t2) break;
      lengths.push(
        Math.hypot(
          subToPx(t2.worldX) - subToPx(t1.worldX),
          subToPx(t2.worldY) - subToPx(t1.worldY),
        ),
      );
    }
    if (lengths.length !== jointIds.length - 1) continue;

    // Get base position
    const baseT = transforms.get(jointIds[0]);
    if (!baseT) continue;
    const baseX = subToPx(baseT.worldX);
    const baseY = subToPx(baseT.worldY);

    const ikNodeId = `ik_${chain.id}`;

    if (chain.solver === '2bone' && lengths.length === 2) {
      // 2-bone IK node
      nodes.push({
        id: ikNodeId,
        type: 'ik_2bone',
        inputs: {
          // Target as inputs (drivable by gait/mouse/const)
          // Default to chain.target if not connected
        },
        params: {
          targetX: chain.target.x,
          targetY: chain.target.y,
          len1: lengths[0],
          len2: lengths[1],
          baseX,
          baseY,
          bendDir: chain.bendDir ?? 1,
        },
        ui: { x: 100, y: yOffset },
      });

      // Output helper nodes for each joint angle
      // (user connects these to transform.rotation in the blueprint editor)
      nodes.push({
        id: `${ikNodeId}_angle1`,
        type: 'transform',
        inputs: {
          rotation: { nodeId: ikNodeId, output: 'angle1' },
        },
        params: {
          _label: `${chain.name} - ${jointIds[0]} 角度`,
          _jointId: jointIds[0],
        },
        ui: { x: 300, y: yOffset },
      });
      nodes.push({
        id: `${ikNodeId}_angle2`,
        type: 'transform',
        inputs: {
          rotation: { nodeId: ikNodeId, output: 'angle2' },
        },
        params: {
          _label: `${chain.name} - ${jointIds[1]} 角度`,
          _jointId: jointIds[1],
        },
        ui: { x: 300, y: yOffset + 80 },
      });
    } else {
      // FABRIK node
      nodes.push({
        id: ikNodeId,
        type: 'ik_fabrik',
        inputs: {},
        params: {
          targetX: chain.target.x,
          targetY: chain.target.y,
          lengths: lengths.join(','),
          baseX,
          baseY,
        },
        ui: { x: 100, y: yOffset },
      });
    }

    yOffset += 200;
  }

  if (nodes.length === 0) return null;

  // Output is the first IK node (for graph validity; actual use is via angle outputs)
  return {
    version: 1,
    nodes,
    outputId: nodes[0].id,
  };
}
