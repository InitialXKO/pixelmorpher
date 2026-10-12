'use client';

// ============================================================
// BlueprintBlockView — 蓝图积木视图
// Scratch 风格：节点垂直堆叠，参数内联编辑
// 与节点图视图数据互通（同一 BlueprintGraph）
// ============================================================

import React, { useMemo, useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { BlueprintGraph, BlueprintNode } from '@/lib/blueprint/ir';
import { getBlueprintNodeLabel, listBlueprintNodeTypes } from '@/lib/blueprint/eval';
import { Button } from '@/components/ui/button';

interface BlueprintBlockViewProps {
  graph: BlueprintGraph;
  onChange: (graph: BlueprintGraph) => void;
}

// 节点颜色（按类别）
const BLOCK_COLORS: Record<string, string> = {
  time: 'bg-amber-500/20 border-amber-500/40',
  const: 'bg-amber-500/20 border-amber-500/40',
  var: 'bg-amber-500/20 border-amber-500/40',
  add: 'bg-blue-500/20 border-blue-500/40',
  sub: 'bg-blue-500/20 border-blue-500/40',
  mul: 'bg-blue-500/20 border-blue-500/40',
  div: 'bg-blue-500/20 border-blue-500/40',
  sin: 'bg-blue-500/20 border-blue-500/40',
  cos: 'bg-blue-500/20 border-blue-500/40',
  ease: 'bg-purple-500/20 border-purple-500/40',
  timeRemap: 'bg-purple-500/20 border-purple-500/40',
  nodeRef: 'bg-cyan-500/20 border-cyan-500/40',
  switch: 'bg-orange-500/20 border-orange-500/40',
  step: 'bg-orange-500/20 border-orange-500/40',
  hold: 'bg-orange-500/20 border-orange-500/40',
  transform: 'bg-emerald-500/20 border-emerald-500/40',
};

function getBlockColor(type: string): string {
  if (BLOCK_COLORS[type]) return BLOCK_COLORS[type];
  // 程序化动画默认绿色
  return 'bg-green-500/20 border-green-500/40';
}

export default function BlueprintBlockView({ graph, onChange }: BlueprintBlockViewProps) {
  // 拓扑排序（简化：按依赖深度）
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

    // 从输出节点开始
    visit(graph.outputId);
    // 加上没访问到的（孤立节点）
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

  const getInputLabel = (node: BlueprintNode, port: string): string => {
    const input = node.inputs[port];
    if (!input) return '';
    if (typeof input === 'object' && 'nodeId' in input) {
      const src = graph.nodes.find((n) => n.id === input.nodeId);
      return src ? `← ${getBlueprintNodeLabel(src.type)}` : '← ?';
    }
    return '';
  };

  // 添加节点
  const [addingType, setAddingType] = useState<string>('pendulum');
  const addNode = () => {
    const id = `node_${Date.now().toString(36)}`;
    onChange({
      ...graph,
      nodes: [...graph.nodes, { id, type: addingType, inputs: {}, params: {} }],
    });
  };

  const nodeTypes = useMemo(() => listBlueprintNodeTypes(), []);

  return (
    <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
      {/* 添加节点工具条 */}
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
          <Plus className="size-3 mr-0.5" />节点
        </Button>
      </div>
      {sortedNodes.map((node, idx) => {
        const isOutput = node.id === graph.outputId;
        const color = getBlockColor(node.type);
        return (
          <div
            key={node.id}
            className={`rounded-lg border px-2 py-1.5 ${color} ${
              isOutput ? 'ring-1 ring-emerald-400/50' : ''
            }`}
          >
            {/* 块头 */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-gray-500 font-mono">{idx + 1}</span>
                <span className="text-[10px] font-medium text-gray-200">
                  {getBlueprintNodeLabel(node.type)}
                </span>
                {isOutput && (
                  <span className="text-[8px] text-emerald-400 bg-emerald-500/20 px-1 rounded">
                    输出
                  </span>
                )}
              </div>
              {!isOutput && (
                <button
                  onClick={() => removeNode(node.id)}
                  className="text-gray-500 hover:text-red-400"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>

            {/* 输入连接（只读显示，去节点图模式编辑） */}
            {Object.keys(node.inputs).length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {Object.keys(node.inputs).map((port) => (
                  <span
                    key={port}
                    className="text-[8px] text-gray-400 bg-black/30 px-1 py-0.5 rounded"
                    title="去节点图模式编辑连线"
                  >
                    {port} {getInputLabel(node, port)}
                  </span>
                ))}
              </div>
            )}

            {/* 参数 */}
            <div className="space-y-1">
              {Object.entries(node.params).length > 0 && (
                <div className="grid grid-cols-2 gap-1">
                  {Object.entries(node.params).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-1">
                      <span className="text-[8px] text-gray-500 truncate" title={key}>
                        {key}
                      </span>
                      <input
                        type={typeof val === 'number' ? 'number' : 'text'}
                        value={String(val)}
                        onChange={(e) => {
                          const v = typeof val === 'number' ? Number(e.target.value) : e.target.value;
                          updateNode(node.id, {
                            params: { ...node.params, [key]: v },
                          });
                        }}
                        className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded px-1 py-0.5 text-[9px] text-gray-200"
                      />
                    </div>
                  ))}
                </div>
              )}
              {/* 添加参数 */}
              <AddParamRow
                onAdd={(k, v) => updateNode(node.id, {
                  params: { ...node.params, [k]: v },
                })}
              />
            </div>

            {Object.entries(node.params).length === 0 &&
              Object.keys(node.inputs).length === 0 && (
                <div className="text-[8px] text-gray-600">无参数</div>
              )}
          </div>
        );
      })}

      {sortedNodes.length === 0 && (
        <div className="text-[10px] text-gray-600 text-center py-4">空蓝图</div>
      )}
    </div>
  );
}

function AddParamRow({ onAdd }: { onAdd: (k: string, v: number) => void }) {
  const [key, setKey] = useState('');
  const [val, setVal] = useState('0');
  return (
    <div className="flex gap-1">
      <input
        placeholder="参数名"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded px-1 py-0.5 text-[8px] text-gray-300"
      />
      <input
        type="number"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="w-14 bg-black/40 border border-white/10 rounded px-1 py-0.5 text-[8px] text-gray-300"
      />
      <button
        onClick={() => {
          if (key.trim()) {
            onAdd(key.trim(), Number(val));
            setKey('');
            setVal('0');
          }
        }}
        className="px-1.5 h-6 text-[8px] bg-white/10 hover:bg-white/20 rounded text-gray-300"
      >
        <Plus className="size-2.5" />
      </button>
    </div>
  );
}
