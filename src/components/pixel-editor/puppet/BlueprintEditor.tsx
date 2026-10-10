'use client';

// ============================================================
// BlueprintEditor — 蓝图节点图编辑器
// 可视化编辑 BlueprintGraph：节点为盒子，连边为 SVG 线
// 与 IR 直接双向绑定（改 UI 即改 IR）
// ============================================================

import React, { useMemo, useState, useCallback } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { BlueprintGraph, BlueprintNode } from '@/lib/blueprint/ir';
import { listBlueprintNodeTypes } from '@/lib/blueprint/eval';
import { Button } from '@/components/ui/button';

interface BlueprintEditorProps {
  graph: BlueprintGraph;
  onChange: (graph: BlueprintGraph) => void;
  title?: string;
}

const NODE_WIDTH = 140;
const NODE_HEADER_H = 24;
const PORT_H = 18;

export default function BlueprintEditor({ graph, onChange, title }: BlueprintEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingType, setAddingType] = useState<string>('pendulum');

  const nodeTypes = useMemo(() => listBlueprintNodeTypes(), []);

  // 自动布局：按拓扑深度分列
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    // 简单：按现有 ui 坐标，没有则按索引排列
    graph.nodes.forEach((n, i) => {
      if (n.ui) {
        pos.set(n.id, n.ui);
      } else {
        const col = Math.floor(i / 4);
        const row = i % 4;
        pos.set(n.id, { x: 20 + col * 180, y: 20 + row * 100 });
      }
    });
    return pos;
  }, [graph.nodes]);

  const updateNode = useCallback((id: string, updates: Partial<BlueprintNode>) => {
    onChange({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    });
  }, [graph, onChange]);

  const addNode = useCallback(() => {
    const id = `node_${Date.now().toString(36)}`;
    const newNode: BlueprintNode = {
      id,
      type: addingType,
      inputs: {},
      params: {},
      ui: { x: 20 + Math.random() * 200, y: 20 + Math.random() * 200 },
    };
    onChange({ ...graph, nodes: [...graph.nodes, newNode] });
    setSelectedId(id);
  }, [graph, onChange, addingType]);

  const removeNode = useCallback((id: string) => {
    if (id === graph.outputId) return; // 不能删输出节点
    onChange({
      ...graph,
      nodes: graph.nodes.filter((n) => n.id !== id),
    });
    if (selectedId === id) setSelectedId(null);
  }, [graph, onChange, selectedId]);

  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null;

  // 计算连边路径
  const edges = useMemo(() => {
    const list: { from: { x: number; y: number }; to: { x: number; y: number }; key: string }[] = [];
    for (const node of graph.nodes) {
      const toPos = positions.get(node.id);
      if (!toPos) continue;
      let portIdx = 0;
      for (const [port, input] of Object.entries(node.inputs)) {
        if (typeof input === 'object' && 'nodeId' in input) {
          const fromPos = positions.get(input.nodeId);
          if (fromPos) {
            list.push({
              from: { x: fromPos.x + NODE_WIDTH, y: fromPos.y + NODE_HEADER_H / 2 },
              to: { x: toPos.x, y: toPos.y + NODE_HEADER_H + portIdx * PORT_H + PORT_H / 2 },
              key: `${input.nodeId}-${node.id}-${port}`,
            });
          }
        }
        portIdx++;
      }
    }
    return list;
  }, [graph.nodes, positions]);

  const maxX = Math.max(...Array.from(positions.values()).map((p) => p.x), 0) + NODE_WIDTH + 40;
  const maxY = Math.max(...Array.from(positions.values()).map((p) => p.y), 0) + 120;

  return (
    <div className="space-y-2">
      {title && <div className="text-[10px] text-gray-400 font-medium">{title}</div>}

      {/* 工具条 */}
      <div className="flex gap-1.5">
        <select
          value={addingType}
          onChange={(e) => setAddingType(e.target.value)}
          className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1.5 py-1 text-[10px] text-gray-300"
        >
          {nodeTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <Button size="sm" onClick={addNode} className="h-7 px-2 text-[10px]">
          <Plus className="size-3 mr-0.5" />节点
        </Button>
      </div>

      {/* 画布 */}
      <div
        className="relative bg-[#080818] border border-[#1e1e3a] rounded overflow-auto"
        style={{ height: 300 }}
        onClick={() => setSelectedId(null)}
      >
        <svg
          width={maxX}
          height={maxY}
          className="absolute inset-0 pointer-events-none"
        >
          {edges.map((e) => (
            <path
              key={e.key}
              d={`M ${e.from.x} ${e.from.y} C ${e.from.x + 40} ${e.from.y}, ${e.to.x - 40} ${e.to.y}, ${e.to.x} ${e.to.y}`}
              stroke="#06b6d4"
              strokeWidth={1.5}
              fill="none"
              opacity={0.6}
            />
          ))}
        </svg>

        {graph.nodes.map((node) => {
          const pos = positions.get(node.id)!;
          const isSelected = selectedId === node.id;
          const isOutput = node.id === graph.outputId;
          return (
            <div
              key={node.id}
              className={`absolute rounded border cursor-pointer ${
                isSelected
                  ? 'border-cyan-400 bg-[#0f1f2f]'
                  : isOutput
                  ? 'border-emerald-500/50 bg-[#0f1f15]'
                  : 'border-[#2a2a4a] bg-[#111128]'
              }`}
              style={{ left: pos.x, top: pos.y, width: NODE_WIDTH }}
              onClick={(e) => { e.stopPropagation(); setSelectedId(node.id); }}
            >
              <div className="flex items-center justify-between px-1.5 py-1 border-b border-[#1e1e3a]">
                <span className="text-[10px] font-medium text-gray-200 truncate">
                  {node.type}
                  {isOutput && <span className="text-[8px] text-emerald-400 ml-1">输出</span>}
                </span>
                {!isOutput && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
                    className="text-gray-500 hover:text-red-400"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
              <div className="px-1.5 py-1">
                {Object.keys(node.inputs).length === 0 && (
                  <div className="text-[8px] text-gray-600">无输入</div>
                )}
                {Object.entries(node.inputs).map(([port]) => (
                  <div key={port} className="text-[9px] text-gray-400 truncate">
                    ← {port}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 参数编辑 */}
      {selected && (
        <div className="bg-[#080818] border border-[#1e1e3a] rounded p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-300 font-medium">
              {selected.type} 参数
            </span>
            <button
              onClick={() => setSelectedId(null)}
              className="text-gray-500 hover:text-gray-300"
            >
              <X className="size-3" />
            </button>
          </div>

          {/* params */}
          {Object.entries(selected.params).map(([key, val]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-[9px] text-gray-500 w-20 truncate">{key}</span>
              <input
                type={typeof val === 'number' ? 'number' : 'text'}
                value={String(val)}
                onChange={(e) => {
                  const v = typeof val === 'number' ? Number(e.target.value) : e.target.value;
                  updateNode(selected.id, {
                    params: { ...selected.params, [key]: v },
                  });
                }}
                className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[10px] text-gray-300"
              />
            </div>
          ))}

          {/* 添加参数 */}
          <AddParamRow
            onAdd={(k, v) => updateNode(selected.id, {
              params: { ...selected.params, [k]: v },
            })}
          />

          {Object.keys(selected.params).length === 0 && (
            <div className="text-[9px] text-gray-600">无参数，点击下方添加</div>
          )}
        </div>
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
        className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[10px] text-gray-300"
      />
      <input
        type="number"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="w-16 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[10px] text-gray-300"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-[10px]"
        onClick={() => {
          if (key.trim()) {
            onAdd(key.trim(), Number(val));
            setKey('');
            setVal('0');
          }
        }}
      >
        <Plus className="size-3" />
      </Button>
    </div>
  );
}
