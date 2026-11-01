/**
 * IK Chain baking: convert high-level IKChain definitions to blueprint nodes.
 *
 * The baked blueprint is persistent and editable in the blueprint editor.
 * Bone lengths are baked as params from the current FK pose.
 * Targets remain as inputs so they can be driven by gait/mouse/const nodes.
 */
import type { BlueprintGraph, BlueprintNode } from './ir';
import type { Character, IKChain } from '../unified-types';
import { subToPx, resolveChainTarget3D, projectToView, pxToSub } from '../unified-types';
import { useProjectStore } from '../store';
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

    // Measure bone lengths from FK（三维口径：与活求解/烘焙桥的段长
    // 同式 Math.hypot(seg.x, seg.y, seg.z)——此前只量 XY，链关节在
    // Z 向有分离时烘焙骨长系统性偏短、末端落点偏离目标。worldZ
    // 缺失的变换表按 0 兜底，与各处 z ?? 0 的口径一致）
    const lengths: number[] = [];
    for (let i = 0; i < jointIds.length - 1; i++) {
      const t1 = transforms.get(jointIds[i]);
      const t2 = transforms.get(jointIds[i + 1]);
      if (!t1 || !t2) break;
      lengths.push(
        Math.hypot(
          subToPx(t2.worldX) - subToPx(t1.worldX),
          subToPx(t2.worldY) - subToPx(t1.worldY),
          subToPx(t2.worldZ ?? pxToSub(0)) - subToPx(t1.worldZ ?? pxToSub(0)),
        ),
      );
    }
    if (lengths.length !== jointIds.length - 1) continue;

    // Get base position
    const baseT = transforms.get(jointIds[0]);
    if (!baseT) continue;
    const baseX = subToPx(baseT.worldX);
    const baseY = subToPx(baseT.worldY);
    // 目标走 target3D 解析（原点空间、按链根朝向填充）；烘焙蓝图是 2D 产物，
    // 其 targetX/Y 取 target3D 在链朝向画布平面上的投影 (u, v)
    const store = useProjectStore.getState();
    const rootDir = transforms.get(jointIds[0])?.variantIndex ?? 6;
    const t3 = resolveChainTarget3D(chain, store.canvasWidth, store.canvasHeight, rootDir);
    const tProj = projectToView(pxToSub(t3.x), pxToSub(t3.y), pxToSub(t3.z), rootDir);
    const t2 = { x: subToPx(tProj.canvasX), y: t3.y };

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
          targetX: t2.x,
          targetY: t2.y,
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
          targetX: t2.x,
          targetY: t2.y,
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
