// ============================================================
// Global Blueprint — 全局蓝图（合并视图）
// 把各节点的蓝图合并成一个大图显示/编辑，保存时再拆分回去
// ============================================================

import type { BlueprintGraph, BlueprintNode, BlueprintInput } from './ir';
import type { PuppetSkeleton } from '../types';
import type { Character } from '../unified-types';

const SEPARATOR = '__';
const SYNTHETIC_OUTPUT_ID = '__global_output__';

/** skeleton 的部件列表（PuppetSkeleton 是数组、Character 是 Record，统一成数组） */
function partListOf(skeleton: PuppetSkeleton | Character) {
  return Array.isArray((skeleton as PuppetSkeleton).nodes)
    ? (skeleton as PuppetSkeleton).nodes
    : Object.values((skeleton as Character).nodes);
}

/**
 * 合并骨架下所有节点的蓝图为一个大图
 * - 每个蓝图节点的 ID 加上所属部件节点 ID 前缀，避免冲突
 * - 输入引用也同步加前缀
 * @returns 合并后的图，以及拆分还原所需的三条快照通道：
 *   outputMap（输出节点映射）、followMap（各部件 followMode）、
 *   partOrder（打开时全部部件 id 的顺序，ui 偏移的下标基准）；
 *   另附 partIds（本次实际收录的部件，即打开时有蓝图的部件清单）
 */
export function mergeBlueprints(skeleton: PuppetSkeleton | Character): {
  graph: BlueprintGraph;
  /** merged 节点 ID -> 所属部件节点 ID */
  nodeOwner: Map<string, string>;
  /** merged 输出节点 ID -> 原始输出节点 ID（用于拆分时恢复） */
  outputMap: Map<string, string>;
  /** 部件节点 ID -> 该部件蓝图的 followMode（仅记录有值的部件，拆分时写回） */
  followMap: Map<string, 'prev' | 'same'>;
  /** 打开时 skeleton 全部部件 id 的顺序快照（拆分按此下标还原 ui 偏移） */
  partOrder: string[];
  /** 本次合并实际收录的部件 id（打开时有蓝图的部件，按 skeleton 顺序） */
  partIds: string[];
} {
  const allNodes: BlueprintNode[] = [];
  const nodeOwner = new Map<string, string>();
  const outputMap = new Map<string, string>();
  const followMap = new Map<string, 'prev' | 'same'>();
  const partIds: string[] = [];

  const nodeList = partListOf(skeleton);
  const partOrder = nodeList.map((n) => n.id);

  for (const puppetNode of nodeList) {
    const bp = puppetNode.blueprint;
    if (!bp) continue;
    partIds.push(puppetNode.id);
    if (bp.followMode !== undefined) {
      followMap.set(puppetNode.id, bp.followMode);
    }
    const prefix = `${puppetNode.id}${SEPARATOR}`;

    // UI 坐标按部件分组偏移，避免重叠（下标取 skeleton 顺序，与拆分快照口径一致）
    const nodeIdx = nodeList.indexOf(puppetNode as any);
    const baseX = (nodeIdx % 3) * 400;
    const baseY = Math.floor(nodeIdx / 3) * 400;

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
    followMap,
    partOrder,
    partIds,
  };
}

export interface SplitBlueprintsOptions {
  /**
   * 打开时记录的部件 id 顺序快照：ui 偏移按快照下标还原，
   * 避免编辑期间别处增删/重排部件导致坐标漂移。缺省时用当前 skeleton 顺序。
   */
  partOrder?: string[];
  /** mergeBlueprints 返回的 followMap：拆回时按部件写回 followMode */
  followMap?: Map<string, 'prev' | 'same'>;
}

/**
 * 把合并后的大图拆分回各节点的蓝图
 * - 按所属部件分组：归属按已知部件 id 集合做最长前缀匹配
 *   （部件 id 本身含 '__' 时也不会被首个 '__' 切错）
 * - 还原 ID 和输入引用（跨部件引用丢弃，与面板披露一致）
 * - 恢复原始 outputId；输出节点已被删时回落该部件第一个 transform 节点，
 *   没有 transform 节点则 outputId 置空
 * - followMode 沿 merge 的 followMap 通道写回
 */
export function splitBlueprints(
  merged: BlueprintGraph,
  skeleton: PuppetSkeleton | Character,
  outputMap: Map<string, string>,
  options?: SplitBlueprintsOptions
): Map<string, BlueprintGraph> {
  const nodeList = partListOf(skeleton);

  // 归属全集：当前部件 ∪ 打开快照里的部件（编辑期间被删的部件，
  // 其图节点仍要能归属回去——写回时对已删节点是安全空操作）
  const knownIds = new Set<string>(nodeList.map((n) => n.id));
  for (const id of options?.partOrder ?? []) knownIds.add(id);
  // 最长前缀优先：一个部件 id 是另一个的前缀加 '__' 时归属唯一
  const knownByLenDesc = [...knownIds].sort((a, b) => b.length - a.length);

  /** merged 节点 ID -> { 所属部件, 还原后的原始 ID }；匹配不到任何已知部件返回 null */
  const ownerOf = (mergedId: string): { owner: string; origId: string } | null => {
    for (const pid of knownByLenDesc) {
      if (mergedId.startsWith(pid + SEPARATOR)) {
        return { owner: pid, origId: mergedId.slice(pid.length + SEPARATOR.length) };
      }
    }
    return null;
  };

  /** ui 偏移下标：优先打开快照顺序，缺失再回落当前 skeleton 顺序 */
  const offsetIndexOf = (pid: string): number => {
    if (options?.partOrder) {
      const i = options.partOrder.indexOf(pid);
      if (i >= 0) return i;
    }
    return nodeList.findIndex((n) => n.id === pid);
  };

  // 按部件节点分组
  const groups = new Map<string, BlueprintNode[]>();

  for (const bn of merged.nodes) {
    if (bn.id === SYNTHETIC_OUTPUT_ID) continue;
    if (bn.id === merged.outputId && bn.id.startsWith('__')) continue;

    const own = ownerOf(bn.id);
    if (!own) continue; // 匹配不到任何已知部件：跳过（沿用现行行为）
    const { owner: puppetNodeId, origId } = own;

    // 还原输入引用（去掉前缀）：引用目标必须同属本部件，跨部件引用丢弃
    const newInputs: Record<string, BlueprintInput> = {};
    for (const [port, input] of Object.entries(bn.inputs)) {
      if (typeof input === 'object' && input !== null && 'nodeId' in input) {
        const ref = input as { nodeId: string; output?: string };
        const refOwn = ownerOf(ref.nodeId);
        if (refOwn && refOwn.owner === puppetNodeId) {
          newInputs[port] = { ...ref, nodeId: refOwn.origId };
        }
        // 跨部件引用丢弃（不写回）
      } else {
        newInputs[port] = input;
      }
    }

    // 还原 UI 坐标（去掉分组偏移，下标按打开快照顺序）
    const nodeIdx = offsetIndexOf(puppetNodeId);
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
    // 找到该部件的原始输出 ID（outputMap 的键是 merged ID，同样按归属匹配）
    let origOutputId: string | undefined;
    for (const [mergedId, origId] of outputMap) {
      const o = ownerOf(mergedId);
      if (o && o.owner === puppetNodeId) {
        origOutputId = origId;
        break;
      }
    }
    // 输出节点已被删（还原出的 ID 不在拆回的节点集里）→ 回落第一个 transform 节点
    if (origOutputId !== undefined && !nodes.some((n) => n.id === origOutputId)) {
      origOutputId = undefined;
    }
    if (origOutputId === undefined) {
      origOutputId = nodes.find((n) => n.type === 'transform')?.id;
    }

    const graph: BlueprintGraph = {
      version: 1,
      nodes,
      // 没有 transform 节点时置空（undefined）：图保留其余节点，仅失去输出
      outputId: origOutputId as string,
    };
    const fm = options?.followMap?.get(puppetNodeId);
    if (fm !== undefined) {
      graph.followMode = fm;
    }
    result.set(puppetNodeId, graph);
  }

  return result;
}
