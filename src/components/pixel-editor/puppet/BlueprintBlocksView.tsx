'use client';

// ============================================================
// BlueprintBlocksView — Scratch 风格积木
// - 块文本描述性，输入内联
// - Reporter 椭圆，Stack 矩形带拼图缺口
// - 紧密堆叠
// ============================================================

import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { BlueprintGraph, BlueprintNode } from '@/lib/blueprint/ir';
import { getNodeInputs, getNodeOutputs, getDefaultOutputForPort } from '@/lib/blueprint/specs';

interface BlueprintBlocksViewProps {
  graph: BlueprintGraph;
  onChange: (graph: BlueprintGraph) => void;
}

// Scratch 风格颜色
const BLOCK_COLORS: Record<string, string> = {
  time: 'bg-[#F9A826]', const: 'bg-[#F9A826]', var: 'bg-[#F9A826]',
  add: 'bg-[#4C97FF]', sub: 'bg-[#4C97FF]', mul: 'bg-[#4C97FF]', div: 'bg-[#4C97FF]',
  sin: 'bg-[#4C97FF]', cos: 'bg-[#4C97FF]',
  ease: 'bg-[#9966FF]', timeRemap: 'bg-[#9966FF]',
  nodeRef: 'bg-[#5CB1D6]',
  switch: 'bg-[#FFAB19]', step: 'bg-[#FFAB19]', hold: 'bg-[#FFAB19]',
  pendulum: 'bg-[#59C059]', breath: 'bg-[#59C059]', shake: 'bg-[#59C059]',
  float: 'bg-[#59C059]', wobble: 'bg-[#59C059]', bounce: 'bg-[#59C059]',
  elastic: 'bg-[#59C059]', wheel: 'bg-[#59C059]', noise: 'bg-[#59C059]',
  wave: 'bg-[#59C059]', spring: 'bg-[#59C059]', jitter: 'bg-[#59C059]',
  gait: 'bg-[#59C059]', expression: 'bg-[#59C059]',
  transform: 'bg-[#5B5B8A]',
  texture_scroll: 'bg-[#FF6680]', wave_deform: 'bg-[#FF6680]', contour_scroll: 'bg-[#FF6680]',
  reveal_hide: 'bg-[#FF6680]', shatter_dissolve: 'bg-[#FF6680]', annihilate: 'bg-[#FF6680]',
  teleport: 'bg-[#FF6680]', crt_off: 'bg-[#FF6680]', bend: 'bg-[#FF6680]',
  elliptical_compress: 'bg-[#FF6680]', dumbbell_stretch: 'bg-[#FF6680]',
  pillow_stretch: 'bg-[#FF6680]', hyperbolic_stretch: 'bg-[#FF6680]', ring_ripple: 'bg-[#FF6680]',
};

// 块描述模板：{port} 会被替换为输入槽
const BLOCK_TEMPLATES: Record<string, string> = {
  time: '当前帧',
  const: '常量 {value}',
  var: '变量 {name}',
  add: '{a} + {b}',
  sub: '{a} - {b}',
  mul: '{a} × {b}',
  div: '{a} ÷ {b}',
  sin: 'sin {x}',
  cos: 'cos {x}',
  ease: '缓动 {x}',
  timeRemap: '时间重映射 {t}',
  nodeRef: '引用节点 {nodeId}',
  switch: '如果 {condition} 则 {a} 否则 {b}',
  step: '阶跃 {x}',
  hold: '保持 {input}',
  pendulum: '摆动 幅度 {amplitude} 周期 {period}',
  float: '浮动 高度 {height} 周期 {period}',
  breath: '呼吸 幅度 {amplitude}',
  shake: '抖动 幅度 {amplitude}',
  wobble: '摇摆 幅度 {amplitude}',
  bounce: '弹跳 高度 {amplitude}',
  elastic: '弹性 幅度 {amplitude}',
  wheel: '滚轮 幅度 {amplitude}',
  noise: '噪声 幅度 {amplitude}',
  wave: '波形 幅度 {amplitude}',
  spring: '弹簧 刚度 {stiffness}',
  jitter: ' jitter',
  gait: '步态 周期 {period}',
  expression: '表达式',
  transform: '输出变换',
  texture_scroll: '纹理滚动 速度 {scrollSpeed}',
  wave_deform: '波形变形 幅度 {amplitude}',
  contour_scroll: '轮廓滚动',
  reveal_hide: '显现 进度 {progress}',
  shatter_dissolve: '碎裂 进度 {progress}',
  annihilate: '湮灭 进度 {progress}',
  teleport: '传送 进度 {progress}',
  crt_off: 'CRT 关闭 进度 {progress}',
  bend: '弯曲 量 {bendAmount}',
  elliptical_compress: '椭圆压缩',
  dumbbell_stretch: '哑铃拉伸',
  pillow_stretch: '枕形拉伸',
  hyperbolic_stretch: '双曲拉伸',
  ring_ripple: '波纹 幅度 {amplitude}',
};

function getBlockColor(type: string): string {
  return BLOCK_COLORS[type] ?? 'bg-gray-500';
}

function getTemplate(type: string): string {
  return BLOCK_TEMPLATES[type] ?? type;
}

export default function BlueprintBlocksView({ graph, onChange }: BlueprintBlocksViewProps) {
  const [selectedSrcId, setSelectedSrcId] = useState<string | null>(null);
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

  const getInputInfo = (node: BlueprintNode, port: string) => {
    const input = node.inputs[port];
    if (!input || typeof input !== 'object' || !('nodeId' in input)) return null;
    const src = graph.nodes.find((n) => n.id === (input as any).nodeId);
    return {
      srcId: (input as any).nodeId,
      output: (input as any).output ?? 'out',
      label: src ? getTemplate(src.type).split(' ')[0] : '?',
    };
  };

  // 渲染块模板，把 {port} 替换为槽位
  const renderBlockContent = (node: BlueprintNode) => {
    const template = getTemplate(node.type);
    const parts = template.split(/(\{\w+\})/g);
    return (
      <span className="text-[11px] font-medium text-white leading-6">
        {parts.map((part, i) => {
          const m = part.match(/\{(\w+)\}/);
          if (!m) return <span key={i}>{part}</span>;
          const port = m[1];
          // 如果是 params，直接显示可编辑值
          if (port in node.params) {
            const val = node.params[port];
            return (
              <input
                key={i}
                type={typeof val === 'number' ? 'number' : 'text'}
                value={String(val)}
                onChange={(e) => {
                  const v = typeof val === 'number' ? Number(e.target.value) : e.target.value;
                  updateNode(node.id, { params: { ...node.params, [port]: v } });
                }}
                onClick={(e) => e.stopPropagation()}
                onDragStart={(e) => e.stopPropagation()}
                className="inline-block w-12 mx-0.5 bg-white rounded-full px-1.5 text-[10px] text-black text-center outline-none"
              />
            );
          }
          // 否则是输入槽
          const info = getInputInfo(node, port);
          const slotKey = `${node.id}:${port}`;
          const isHover = hoverSlot === slotKey;
          return (
            <span
              key={i}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'link'; setHoverSlot(slotKey); }}
              onDragLeave={() => setHoverSlot(null)}
              onDrop={(e) => {
                e.preventDefault();
                const srcId = e.dataTransfer.getData('text/blueprint-node-id');
                if (srcId) connectSlot(node.id, port, srcId);
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (selectedSrcId) connectSlot(node.id, port, selectedSrcId);
              }}
              className={`
                inline-flex items-center gap-0.5 mx-0.5 h-6 px-1.5 rounded-full align-middle
                ${isHover ? 'bg-amber-300 ring-2 ring-amber-200' : ''}
                ${!isHover && info ? 'bg-white/90' : ''}
                ${!isHover && !info ? 'bg-black/25 border border-dashed border-white/50 min-w-[24px] justify-center' : ''}
              `}
              title={info ? `${info.label}.${info.output}（点✕断开）` : '拖入积木'}
            >
              {info ? (
                <>
                  <span className="text-[9px] text-black font-medium max-w-[60px] truncate">{info.label}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); disconnectSlot(node.id, port); }}
                    className="text-black/50 hover:text-black"
                  >
                    <X className="size-2" />
                  </button>
                </>
              ) : (
                <span className="text-[9px] text-white/60">○</span>
              )}
            </span>
          );
        })}
      </span>
    );
  };

  return (
    <div className="max-h-[400px] overflow-y-auto pr-1 py-1">
      {selectedSrcId && (
        <div className="sticky top-0 z-10 bg-amber-500/20 border border-amber-500/50 rounded px-2 py-1 mb-1 text-[10px] text-amber-200 flex items-center justify-between">
          <span>已选中块，点击槽位连接</span>
          <button onClick={() => setSelectedSrcId(null)}><X className="size-3" /></button>
        </div>
      )}

      <div className="flex flex-col items-start gap-0">
        {sortedNodes.map((node) => {
          const isOutput = node.id === graph.outputId;
          const color = getBlockColor(node.type);
          const isReporter = getNodeOutputs(node.type).length > 0 && node.type !== 'transform';
          const isSelected = selectedSrcId === node.id;

          return (
            <div
              key={node.id}
              draggable={isReporter && !isOutput}
              onDragStart={(e) => {
                if (!isReporter || isOutput) return;
                e.dataTransfer.setData('text/blueprint-node-id', node.id);
                e.dataTransfer.effectAllowed = 'link';
              }}
              onClick={() => {
                if (isReporter && !isOutput) setSelectedSrcId(isSelected ? null : node.id);
              }}
              className={`
                ${color} shadow-md select-none relative
                ${isReporter ? 'rounded-full cursor-grab active:cursor-grabbing' : 'rounded-[4px]'}
                ${isOutput ? 'ring-2 ring-emerald-400' : ''}
                ${isSelected ? 'ring-2 ring-amber-300' : ''}
                px-3 py-1 my-0.5 max-w-full
              `}
            >
              <div className="flex items-center gap-2">
                {renderBlockContent(node)}
                {!isOutput && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
                    className="text-white/60 hover:text-white shrink-0"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {sortedNodes.length === 0 && (
        <div className="text-[10px] text-gray-600 text-center py-4">空蓝图</div>
      )}
    </div>
  );
}
