// ============================================================
// Character Blueprint — 角色蓝图（整角色渲染 IR）
// 结构：character_source（系统） → 用户后处理链 → screen
// 用于整角色特效（描边/辉光/调色等作用于合成后整角色）。
// 单节点特效仍在 node.blueprint。character_source 与层级无关，
// 节点增删改无需手术式同步用户链。
// ============================================================

import type { BlueprintGraph } from './ir';

/**
 * 生成默认角色蓝图：角色源 → screen。
 * 用户在两者之间插入后处理节点。
 */
export function createDefaultCharacterBlueprint(): BlueprintGraph {
  return {
    version: 1,
    nodes: [
      {
        id: 'ch_time',
        type: 'time',
        inputs: {},
        params: {},
        ui: { x: 40, y: 40 },
      },
      {
        id: 'ch_source',
        type: 'character_source',
        inputs: {},
        params: {},
        ui: { x: 40, y: 160 },
      },
      {
        id: 'ch_screen',
        type: 'screen',
        inputs: {
          pixels: { nodeId: 'ch_source', output: 'pixels' },
        },
        params: {},
        ui: { x: 420, y: 160 },
      },
    ],
    outputId: 'ch_screen',
  };
}

/**
 * 校验角色蓝图是否包含系统必需节点。
 * 缺少 character_source 或 screen 时返回缺失项。
 */
export function validateCharacterBlueprint(graph: BlueprintGraph): string[] {
  const missing: string[] = [];
  const types = new Set(graph.nodes.map((n) => n.type));
  if (!types.has('character_source')) missing.push('character_source');
  const screenNode = graph.nodes.find((n) => n.id === graph.outputId);
  if (!screenNode || screenNode.type !== 'screen') missing.push('screen（输出节点）');
  return missing;
}
