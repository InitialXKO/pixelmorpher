'use client';

// ============================================================
// BlueprintBlocksView — 真正的积木块视图（Scratch 风格）
// - Reporter（椭圆形）：输出值的节点，可拖拽
// - Stack（矩形）：transform 输出节点
// - 输入槽位：拖入连接，点击断开，显示输出端口
// - 触屏：点选块再点槽位连接
// ============================================================

import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { BlueprintGraph, BlueprintNode } from '@/lib/blueprint/ir';
import { getBlueprintNodeLabel } from '@/lib/blueprint/eval';
import { getNodeInputs, getNodeOutputs, getDefaultOutputForPort } from '@/lib/blueprint/specs';

interface BlueprintBlocksViewProps {
  graph: BlueprintGraph;
  onChange: (graph: BlueprintGraph) => void;
}

const BLOCK_COLORS: Record<string, string> = {
  time: 'bg-amber-500', const: 'bg-amber-500', var: 'bg-amber-500',
  add: 'bg-blue-500', sub: 'bg-blue-500', mul: 'bg-blue-500', div: 'bg-blue-500',
  sin: 'bg-blue-500', cos: 'bg-blue-500',
  ease: 'bg-purple-500', timeRemap: 'bg-purple-500',
  nodeRef: 'bg-cyan-600',
  switch: 'bg-orange-500', step: 'bg-orange-500', hold: 'bg-orange-500',
  pendulum: 'bg-green-500', breath: 'bg-green-500', shake: 'bg-green-500',
  float: 'bg-green-500', wobble: 'bg-green-500', bounce: 'bg-green-500',
  elastic: 'bg-green-500', wheel: 'bg-green-500', noise: 'bg-green-500',
  wave: 'bg-green-500', spring: 'bg-green-500', jitter: 'bg-green-500',
  gait: 'bg-green-500', expression: 'bg-green-500',
  transform: 'bg-gray-700',
  texture_scroll: 'bg-pink-500', wave_deform: 'bg-pink-500', contour_scroll: 'bg-pink-500',
  reveal_hide: 'bg-pink-500', shatter_dissolve: 'bg-pink-500', annihilate: 'bg-pink-500',
  teleport: 'bg-pink-500', crt_off: 'bg-pink-500', bend: 'bg-pink-500',
  elliptical_compress: 'bg-pink-500', dumbbell_stretch: 'bg-pink-500',
  pillow_stretch: 'bg-pink-500', hyperbolic_stretch: 'bg-pink-500', ring_ripple: 'bg-pink-500',
};

function getBlockColor(type: string): string {
  return BLOCK_COLORS[type] ?? 'bg-gray-500';
}

function isReporter(type: string): boolean {
  return type !== 'transform' && !getNodeOutputs(type).includes('pixels');
}

export default function BlueprintBlocksView({ graph, onChange }: BlueprintBlocksViewProps) {
  // 触屏点选：选中的源块 ID
  const [selectedSrcId, setSelectedSrcId] = useState<string | null>(null);
  // 拖拽高亮：正在悬停的槽位 key
  const [hoverSlot, setHoverSlot] = useState<string | null>(null);

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
        if (typeof input === 'object' && 'nodeId' in input) visit(input.nodeId);
      }
      result.push(node);
    }
    visit(graph.outputId);
    for (const n of graph.nodes) if (!visited.has(n.id)) result.push(n);
    return result;
  }, [graph]);

  const updateNode = (id: string, updates: Partial<BlueprintNode>) => {
    onChange({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)) });
  };

  const removeNode = (id: string) => {
    if (id === graph.outputId) return;
    onChange({ ...graph, nodes: graph.nodes.filter((n) => n.id !== id) });
  };

  const connectSlot = (targetNodeId: string, port: string, srcId: string) => {
    if (srcId === targetNodeId) return;
    const srcNode = graph.nodes.find((n) => n.id === srcId);
    if (!srcNode) return;
    const output = getDefaultOutputForPort(srcNode.type, port);
    const target = graph.nodes.find((n) => n.id === targetNodeId);
    if (!target) return;
    updateNode(targetNodeId, {
      inputs: { ...target.inputs, [port]: { nodeId: srcId, output } },
    });
    setSelectedSrcId(null);
    setHoverSlot(null);
  };

  const disconnectSlot = (targetNodeId: string, port: string) => {
    const target = graph.nodes.find((n) => n.id === targetNodeId);
    if (!target) return;
    const newInputs = { ...target.inputs };
    delete newInputs[port];
    updateNode(targetNodeId, { inputs: newInputs });
  };

  const getInputInfo = (node: BlueprintNode, port: string): { srcId: string; output: string; label: string } | null => {
    const input = node.inputs[port];
    if (!input || typeof input !== 'object' || !('nodeId' in input)) return null;
    const src = graph.nodes.find((n) => n.id === (input as any).nodeId);
    return {
      srcId: (input as any).nodeId,
      output: (input as any).output ?? 'out',
      label: src ? getBlueprintNodeLabel(src.type) : '?',
    };
  };

  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 p-1">
      {selectedSrcId && (
        <div className="sticky top-0 z-10 bg-amber-500/20 border border-amber-500/50 rounded px-2 py-1 text-[10px] text-amber-200 flex items-center justify-between">
          <span>已选中块，点击槽位连接</span>
          <button onClick={() => setSelectedSrcId(null)} className="text-amber-200/70 hover:text-amber-200">
            <X className="size-3" />
          </button>
        </div>
      )}

      {sortedNodes.map((node) => {
        const isOutput = node.id === graph.outputId;
        const color = getBlockColor(node.type);
        const reporter = isReporter(node.type);
        const specInputs = getNodeInputs(node.type);
        const isSelected = selectedSrcId === node.id;

        return (
          <div key={node.id} className="flex justify-start">
            <div
              draggable={reporter && !isOutput}
              onDragStart={(e) => {
                if (!reporter || isOutput) return;
                e.dataTransfer.setData('text/blueprint-node-id', node.id);
                e.dataTransfer.effectAllowed = 'link';
              }}
              onClick={() => {
                // 触屏点选：点 reporter 选中，再点槽位连接
                if (reporter && !isOutput) {
                  setSelectedSrcId(isSelected ? null : node.id);
                }
              }}
              className={`
                ${color} text-white shadow-md select-none
                ${reporter ? 'rounded-full px-3 py-1.5 cursor-grab active:cursor-grabbing' : 'rounded-md px-3 py-2'}
                ${isOutput ? 'ring-2 ring-emerald-400' : ''}
                ${isSelected ? 'ring-2 ring-amber-300' : ''}
                min-w-[120px] max-w-full
              `}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-bold whitespace-nowrap">
                  {getBlueprintNodeLabel(node.type)}
                  {isOutput && <span className="ml-1 text-[8px] opacity-75">输出</span>}
                </span>
                {!isOutput && (
                  <button onClick={(e) => { e.stopPropagation(); removeNode(node.id); }} className="text-white/70 hover:text-white">
                    <X className="size-3" />
                  </button>
                )}
              </div>

              {specInputs.length > 0 && (
                <div className="space-y-1 mb-1">
                  {specInputs.map((port) => {
                    const info = getInputInfo(node, port);
                    const slotKey = `${node.id}:${port}`;
                    const isHover = hoverSlot === slotKey;
                    return (
                      <div key={port} className="flex items-center gap-1">
                        <span className="text-[8px] text-white/80 whitespace-nowrap">{port}</span>
                        <div
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'link'; setHoverSlot(slotKey); }}
                          onDragLeave={() => setHoverSlot(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            const srcId = e.dataTransfer.getData('text/blueprint-node-id');
                            if (srcId) connectSlot(node.id, port, srcId);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            // 触屏：已选中源块 → 连接
                            if (selectedSrcId) {
                              connectSlot(node.id, port, selectedSrcId);
                            }
                          }}
                          className={`
                            flex-1 min-w-[60px] h-6 rounded-full px-2 flex items-center justify-between gap-1
                            transition-colors
                            ${isHover ? 'bg-amber-300/40 border-2 border-amber-300' : ''}
                            ${!isHover && info ? 'bg-white/25' : ''}
                            ${!isHover && !info ? 'bg-black/30 border border-dashed border-white/40 hover:border-white/70' : ''}
                          `}
                          title={info ? `来自: ${info.label}.${info.output}（点击断开）` : '拖入积木或点选后点击连接'}
                        >
                          {info ? (
                            <>
                              <span className="text-[8px] text-white truncate">
                                {info.label}<span className="opacity-60">.{info.output}</span>
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); disconnectSlot(node.id, port); }}
                                className="text-white/60 hover:text-white shrink-0"
                                title="断开"
                              >
                                <X className="size-2.5" />
                              </button>
                            </>
                          ) : (
                            <span className="text-[8px] text-white/40">空</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {Object.entries(node.params).length > 0 && (
                <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                  {Object.entries(node.params).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5">
                      <span className="text-[8px] text-white/80">{key}</span>
                      <input
                        type={typeof val === 'number' ? 'number' : 'text'}
                        value={String(val)}
                        onChange={(e) => {
                          const v = typeof val === 'number' ? Number(e.target.value) : e.target.value;
                          updateNode(node.id, { params: { ...node.params, [key]: v } });
                        }}
                        className="w-12 bg-white/20 rounded px-1 text-[9px] text-white text-center outline-none"
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
