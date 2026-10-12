// ============================================================
// Global Blueprint — 全局蓝图（合并视图）
// 把各节点的蓝图合并成一个大图显示/编辑，保存时再拆分回去
// ============================================================

import type { BlueprintGraph, BlueprintNode, BlueprintInput } from './ir';
import type { PuppetSkeleton } from '../types';

const SEPARATOR = '__';
const SYNTHETIC_OUTPUT_ID = '__global_output__';

/**
 * 合并骨架下所有节点的蓝图为一个大图
 * - 每个蓝图节点的 ID 加上所属部件节点 ID 前缀，避免冲突
 * - 输入引用也同步加前缀
 * @returns 合并后的图，以及 mergedOutputId -> { puppetNodeId, origOutputId } 的映射
 */
export function mergeBlueprints(skeleton: PuppetSkeleton): {
  graph: BlueprintGraph;
  /** merged 节点 ID -> 所属部件节点 ID */
  nodeOwner: Map<string, string>;
  /** merged 输出节点 ID -> 原始输出节点 ID（用于拆分时恢复） */
  outputMap: Map<string, string>;
} {
  const allNodes: BlueprintNode[] = [];
  const nodeOwner = new Map<string, string>();
  const outputMap = new Map<string, string>();

  for (const puppetNode of skeleton.nodes) {
    const bp = puppetNode.blueprint;
    if (!bp) continue;
    const prefix = `${puppetNode.id}${SEPARATOR}`;

    for (const bn of bp.nodes) {
      const newId = prefix + bn.id;
      const newInputs: Record<string, BlueprintInput> = {};

      for (const [port, input] of Object.entries(bn.inputs)) {
        if (typeof input === 'object' && input !== null && 'nodeId' in input) {
          const ref = input as { nodeId: string; output?: string };
          newInputs[port] = { ...ref, nodeId: prefix + ref.nodeId };
        } else {
          newInputs[port] = input;
        }
      }

      // UI 坐标按部件分组偏移，避免重叠
      const nodeIdx = skeleton.nodes.indexOf(puppetNode);
      const baseX = (nodeIdx % 3) * 400;
      const baseY = Math.floor(nodeIdx / 3) * 400;

      allNodes.push({
        ...bn,
        id: newId,
        inputs: newInputs,
        ui: bn.ui ? { x: baseX + bn.ui.x, y: baseY + bn.ui.y } : { x: baseX + 20, y: baseY + 20 },
      });

      nodeOwner.set(newId, puppetNode.id);

      if (bn.id === bp.outputId) {
        outputMap.set(newId, bn.id);
      }
    }
  }

  // 合成输出占位（编辑器需要一个 outputId）
  allNodes.push({
    id: SYNTHETIC_OUTPUT_ID,
    type: 'transform',
    inputs: {},
    params: {},
    ui: { x: 0, y: -100 },
  });

  return {
    graph: { version: 1, nodes: allNodes, outputId: SYNTHETIC_OUTPUT_ID },
    nodeOwner,
    outputMap,
  };
}

/**
 * 把合并后的大图拆分回各节点的蓝图
 * - 按前缀分组
 * - 还原 ID 和输入引用
 * - 恢复原始 outputId
 */
export function splitBlueprints(
  merged: BlueprintGraph,
  skeleton: PuppetSkeleton,
  outputMap: Map<string, string>
): Map<string, BlueprintGraph> {
  // 按部件节点分组
  const groups = new Map<string, BlueprintNode[]>();

  for (const bn of merged.nodes) {
    if (bn.id === SYNTHETIC_OUTPUT_ID) continue;
    if (bn.id === merged.outputId && bn.id.startsWith('__')) continue;

    const sepIdx = bn.id.indexOf(SEPARATOR);
    if (sepIdx === -1) continue;

    const puppetNodeId = bn.id.slice(0, sepIdx);
    const origId = bn.id.slice(sepIdx + SEPARATOR.length);

    // 还原输入引用（去掉前缀）
    const newInputs: Record<string, BlueprintInput> = {};
    for (const [port, input] of Object.entries(bn.inputs)) {
      if (typeof input === 'object' && input !== null && 'nodeId' in input) {
        const ref = input as { nodeId: string; output?: string };
        // 只还原同前缀的引用（跨部件引用在拆分时断开）
        if (ref.nodeId.startsWith(puppetNodeId + SEPARATOR)) {
          newInputs[port] = {
            ...ref,
            nodeId: ref.nodeId.slice(puppetNodeId.length + SEPARATOR.length),
          };
        }
        // 跨部件引用丢弃（不写回）
      } else {
        newInputs[port] = input;
      }
    }

    // 还原 UI 坐标（去掉分组偏移）
    const nodeIdx = skeleton.nodes.findIndex((n) => n.id === puppetNodeId);
    const baseX = nodeIdx >= 0 ? (nodeIdx % 3) * 400 : 0;
    const baseY = nodeIdx >= 0 ? Math.floor(nodeIdx / 3) * 400 : 0;

    const origNode: BlueprintNode = {
      ...bn,
      id: origId,
      inputs: newInputs,
      ui: bn.ui ? { x: bn.ui.x - baseX, y: bn.ui.y - baseY } : undefined,
    };

    if (!groups.has(puppetNodeId)) {
      groups.set(puppetNodeId, []);
    }
    groups.get(puppetNodeId)!.push(origNode);
  }

  // 组装回 BlueprintGraph
  const result = new Map<string, BlueprintGraph>();
  for (const [puppetNodeId, nodes] of groups) {
    // 找到该部件的原始输出 ID
    let origOutputId: string | null = null;
    for (const [mergedId, origId] of outputMap) {
      if (mergedId.startsWith(puppetNodeId + SEPARATOR)) {
        origOutputId = origId;
        break;
      }
    }
    // 如果找不到（输出节点被删了），用第一个 transform 节点
    if (!origOutputId) {
      const t = nodes.find((n) => n.type === 'transform');
      origOutputId = t?.id ?? nodes[0]?.id ?? '';
    }
    if (!origOutputId) continue;

    result.set(puppetNodeId, {
      version: 1,
      nodes,
      outputId: origOutputId,
    });
  }

  return result;
}
