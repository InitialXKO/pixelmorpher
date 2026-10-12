'use client';

// ============================================================
// BlueprintBlocksView — 真正的积木块视图（Scratch 风格）
// - Reporter（椭圆形）：输出值的节点（time/const/数学/动画）
// - Stack（矩形）：transform 输出节点
// - 输入槽位可嵌入 reporter 块
// ============================================================

import React, { useMemo, useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { BlueprintGraph, BlueprintNode } from '@/lib/blueprint/ir';
import { getBlueprintNodeLabel, listBlueprintNodeTypes } from '@/lib/blueprint/eval';
import { getNodeInputs } from '@/lib/blueprint/specs';
import { Button } from '@/components/ui/button';

interface BlueprintBlocksViewProps {
  graph: BlueprintGraph;
  onChange: (graph: BlueprintGraph) => void;
}

// 积木颜色（Scratch 风格）
const BLOCK_COLORS: Record<string, string> = {
  // 源 - 黄色
  time: 'bg-amber-500',
  const: 'bg-amber-500',
  var: 'bg-amber-500',
  // 数学 - 蓝色
  add: 'bg-blue-500',
  sub: 'bg-blue-500',
  mul: 'bg-blue-500',
  div: 'bg-blue-500',
  sin: 'bg-blue-500',
  cos: 'bg-blue-500',
  // 缓动 - 紫色
  ease: 'bg-purple-500',
  timeRemap: 'bg-purple-500',
  // 跨节点 - 青色
  nodeRef: 'bg-cyan-600',
  // 条件 - 橙色
  switch: 'bg-orange-500',
  step: 'bg-orange-500',
  hold: 'bg-orange-500',
  // 动画 - 绿色
  pendulum: 'bg-green-500',
  breath: 'bg-green-500',
  shake: 'bg-green-500',
  float: 'bg-green-500',
  wobble: 'bg-green-500',
  bounce: 'bg-green-500',
  elastic: 'bg-green-500',
  wheel: 'bg-green-500',
  noise: 'bg-green-500',
  wave: 'bg-green-500',
  spring: 'bg-green-500',
  jitter: 'bg-green-500',
  gait: 'bg-green-500',
  expression: 'bg-green-500',
  // 输出 - 深灰
  transform: 'bg-gray-700',
};

function getBlockColor(type: string): string {
  return BLOCK_COLORS[type] ?? 'bg-gray-500';
}

// 是否为 reporter（输出值，可嵌入）
function isReporter(type: string): boolean {
  return type !== 'transform';
}

export default function BlueprintBlocksView({ graph, onChange }: BlueprintBlocksViewProps) {
  const [addingType, setAddingType] = useState<string>('pendulum');
  const nodeTypes = useMemo(() => listBlueprintNodeTypes(), []);

  // 拓扑排序
  const sortedNodes = useMemo(() => {
    const visited = new Set<string>();
    const result: BlueprintNode[] = [];
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

    function visit(id: string) {
      if (visited.has(id)) return;
      visited.add(id);
      const node = nodeMap.get(id);
      if (!node) return;
      for (const input of Object.values(node.inputs)) {
        if (typeof input === 'object' && 'nodeId' in input) {
          visit(input.nodeId);
        }
      }
      result.push(node);
    }

    visit(graph.outputId);
    for (const n of graph.nodes) {
      if (!visited.has(n.id)) result.push(n);
    }
    return result;
  }, [graph]);

  const updateNode = (id: string, updates: Partial<BlueprintNode>) => {
    onChange({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    });
  };

  const removeNode = (id: string) => {
    if (id === graph.outputId) return;
    onChange({
      ...graph,
      nodes: graph.nodes.filter((n) => n.id !== id),
    });
  };

  const addNode = () => {
    const id = `node_${Date.now().toString(36)}`;
    onChange({
      ...graph,
      nodes: [...graph.nodes, { id, type: addingType, inputs: {}, params: {} }],
    });
  };

  const getInputSourceLabel = (node: BlueprintNode, port: string): string => {
    const input = node.inputs[port];
    if (!input) return '';
    if (typeof input === 'object' && 'nodeId' in input) {
      const src = graph.nodes.find((n) => n.id === input.nodeId);
      return src ? getBlueprintNodeLabel(src.type) : '?';
    }
    return '';
  };

  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 p-1">
      {/* 添加节点 */}
      <div className="flex gap-1.5 sticky top-0 bg-[#080818] py-1 z-10">
        <select
          value={addingType}
          onChange={(e) => setAddingType(e.target.value)}
          className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1.5 py-1 text-[10px] text-gray-300"
        >
          {nodeTypes.map((t) => (
            <option key={t} value={t}>{getBlueprintNodeLabel(t)}</option>
          ))}
        </select>
        <Button size="sm" onClick={addNode} className="h-7 px-2 text-[10px]">
          <Plus className="size-3 mr-0.5" />积木
        </Button>
      </div>

      {/* 积木堆叠 */}
      {sortedNodes.map((node) => {
        const isOutput = node.id === graph.outputId;
        const color = getBlockColor(node.type);
        const reporter = isReporter(node.type);
        const specInputs = getNodeInputs(node.type);

        return (
          <div key={node.id} className="flex justify-start">
            {/* 积木块 */}
            <div
              className={`
                ${color} text-white shadow-md
                ${reporter
                  ? 'rounded-full px-3 py-1.5'  // reporter: 椭圆
                  : 'rounded-md px-3 py-2'      // stack: 矩形
                }
                ${isOutput ? 'ring-2 ring-emerald-400' : ''}
                min-w-[120px] max-w-full
              `}
            >
              {/* 块头：类型 + 删除 */}
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-bold whitespace-nowrap">
                  {getBlueprintNodeLabel(node.type)}
                  {isOutput && <span className="ml-1 text-[8px] opacity-75">输出</span>}
                </span>
                {!isOutput && (
                  <button
                    onClick={() => removeNode(node.id)}
                    className="text-white/70 hover:text-white"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>

              {/* 输入槽位 */}
              {specInputs.length > 0 && (
                <div className="space-y-1 mb-1">
                  {specInputs.map((port) => {
                    const srcLabel = getInputSourceLabel(node, port);
                    return (
                      <div key={port} className="flex items-center gap-1">
                        <span className="text-[8px] text-white/80 whitespace-nowrap">{port}</span>
                        <div
                          className={`
                            flex-1 min-w-[60px] h-6 rounded-full px-2 flex items-center
                            ${srcLabel
                              ? 'bg-white/25 text-[8px] text-white'
                              : 'bg-black/30 border border-dashed border-white/40'
                            }
                          `}
                          title={srcLabel ? `来自: ${srcLabel}（去节点图模式改连线）` : '空槽位（去节点图模式连线）'}
                        >
                          {srcLabel ? (
                            <span className="truncate">{srcLabel}</span>
                          ) : (
                            <span className="text-[8px] text-white/40">空</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 参数（内联编辑） */}
              {Object.entries(node.params).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(node.params).map(([key, val]) => (
                    <div
                      key={key}
                      className="flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5"
                    >
                      <span className="text-[8px] text-white/80">{key}</span>
                      <input
                        type={typeof val === 'number' ? 'number' : 'text'}
                        value={String(val)}
                        onChange={(e) => {
                          const v = typeof val === 'number' ? Number(e.target.value) : e.target.value;
                          updateNode(node.id, {
                            params: { ...node.params, [key]: v },
                          });
                        }}
                        className="w-12 bg-white/20 rounded px-1 text-[9px] text-white text-center outline-none"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {sortedNodes.length === 0 && (
        <div className="text-[10px] text-gray-600 text-center py-4">空蓝图</div>
      )}
    </div>
  );
}
