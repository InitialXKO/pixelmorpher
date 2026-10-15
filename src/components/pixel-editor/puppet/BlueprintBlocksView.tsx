'use client';

// ============================================================
// BlueprintBlocksView — Scratch 风格积木
// - 拖入槽位的是整个块（递归嵌套），不是名字
// - 块文本描述性，输入内联
// ============================================================

import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { BlueprintGraph, BlueprintNode } from '@/lib/blueprint/ir';
import { getNodeInputs, getNodeOutputs, getDefaultOutputForPort } from '@/lib/blueprint/specs';

interface BlueprintBlocksViewProps {
  graph: BlueprintGraph;
  onChange: (graph: BlueprintGraph) => void;
}

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

const BLOCK_TEMPLATES: Record<string, string> = {
  time: '当前帧', const: '常量 {value}', var: '变量 {name}',
  sprite_source: '精灵源', costume: '服装 {setId} 的 {slot} 精灵',
  add: '{a} + {b}', sub: '{a} - {b}', mul: '{a} × {b}', div: '{a} ÷ {b}',
  sin: 'sin {x}', cos: 'cos {x}',
  ease: '缓动 {x}', timeRemap: '时间重映射 {t}',
  nodeRef: '引用节点', switch: '如果 {condition} 则 {a} 否则 {b}',
  step: '阶跃 {x}', hold: '保持 {input}',
  pendulum: '摆动 幅度 {amplitude} 周期 {period}',
  float: '浮动 高度 {height} 周期 {period}',
  breath: '呼吸 幅度 {amplitude}', shake: '抖动 幅度 {amplitude}',
  wobble: '摇摆 角度 {angleAmplitude} 位移 {moveAmplitude} 周期 {period}', bounce: '弹跳 高度 {height} 周期 {period}',
  elastic: '弹性 偏移 {offset} 周期 {period}', wheel: '滚轮 半径X {radiusX} 半径Y {radiusY} 周期 {period}',
  noise: '噪声 幅度 {amplitude}', wave: '波形 幅度 {amplitude}',
  spring: '弹簧 刚度 {stiffness}', jitter: '抖动',
  gait: '步态 周期 {period}', expression: '表达式',
  transform: '输出变换',
  texture_scroll: '纹理滚动 速度 {scrollSpeed}',
  wave_deform: '波形变形 幅度 {amplitude}',
  contour_scroll: '轮廓滚动', reveal_hide: '显现 进度 {progress}',
  shatter_dissolve: '碎裂 进度 {progress}', annihilate: '湮灭 进度 {progress}',
  teleport: '传送 进度 {progress}', crt_off: 'CRT 关闭 进度 {progress}',
  bend: '弯曲 量 {bendAmount}', elliptical_compress: '椭圆压缩',
  dumbbell_stretch: '哑铃拉伸', pillow_stretch: '枕形拉伸',
  hyperbolic_stretch: '双曲拉伸', ring_ripple: '波纹 幅度 {amplitude}',
};

export default function BlueprintBlocksView({ graph, onChange }: BlueprintBlocksViewProps) {
  const [selectedSrcId, setSelectedSrcId] = useState<string | null>(null);
  const [hoverSlot, setHoverSlot] = useState<string | null>(null);

  const nodeMap = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  // 找出被嵌套的节点 ID（作为其他节点输入的）
  const nestedIds = useMemo(() => {
    const s = new Set<string>();
    for (const node of graph.nodes) {
      for (const input of Object.values(node.inputs)) {
        if (typeof input === 'object' && input !== null && 'nodeId' in input) {
          s.add((input as any).nodeId);
        }
      }
    }
    return s;
  }, [graph]);

  // 顶层节点：未被嵌套的 + output
  const topLevelNodes = useMemo(() => {
    const visited = new Set<string>();
    const result: BlueprintNode[] = [];
    function visit(id: string) {
      if (visited.has(id)) return;
      visited.add(id);
      const node = nodeMap.get(id);
      if (!node) return;
      // 先访问依赖（保证拓扑序）
      for (const input of Object.values(node.inputs)) {
        if (typeof input === 'object' && input !== null && 'nodeId' in input) {
          const depId = (input as any).nodeId;
          // 如果依赖未被嵌套（是顶层），则访问
          if (!nestedIds.has(depId)) visit(depId);
        }
      }
      // 只收顶层
      if (!nestedIds.has(id) || id === graph.outputId) result.push(node);
    }
    visit(graph.outputId);
    for (const n of graph.nodes) {
      if (!nestedIds.has(n.id) && !visited.has(n.id)) result.push(n);
    }
    return result;
  }, [graph, nodeMap, nestedIds]);

  const updateNode = (id: string, updates: Partial<BlueprintNode>) => {
    onChange({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)) });
  };

  const removeNode = (id: string) => {
    if (id === graph.outputId) return;
    // 删除时，同时清除其他节点对它的引用
    const newNodes = graph.nodes
      .filter((n) => n.id !== id)
      .map((n) => {
        const newInputs = { ...n.inputs };
        for (const [port, input] of Object.entries(newInputs)) {
          if (typeof input === 'object' && input !== null && 'nodeId' in input && (input as any).nodeId === id) {
            delete newInputs[port];
          }
        }
        return { ...n, inputs: newInputs };
      });
    onChange({ ...graph, nodes: newNodes });
  };

  const connectSlot = (targetNodeId: string, port: string, srcId: string) => {
    if (srcId === targetNodeId) return;
    const srcNode = nodeMap.get(srcId);
    if (!srcNode) return;
    // 防止循环：检查 src 是否依赖 target
    const visited = new Set<string>();
    function hasCycle(id: string): boolean {
      if (id === targetNodeId) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      const n = nodeMap.get(id);
      if (!n) return false;
      for (const input of Object.values(n.inputs)) {
        if (typeof input === 'object' && input !== null && 'nodeId' in input) {
          if (hasCycle((input as any).nodeId)) return true;
        }
      }
      return false;
    }
    if (hasCycle(srcId)) return;

    const output = getDefaultOutputForPort(srcNode.type, port);
    const target = nodeMap.get(targetNodeId);
    if (!target) return;
    updateNode(targetNodeId, {
      inputs: { ...target.inputs, [port]: { nodeId: srcId, output } },
    });
    setSelectedSrcId(null);
    setHoverSlot(null);
  };

  const disconnectSlot = (targetNodeId: string, port: string) => {
    const target = nodeMap.get(targetNodeId);
    if (!target) return;
    const newInputs = { ...target.inputs };
    delete newInputs[port];
    updateNode(targetNodeId, { inputs: newInputs });
  };

  const setSlotLiteral = (targetNodeId: string, port: string, value: number | null) => {
    const target = nodeMap.get(targetNodeId);
    if (!target) return;
    const newInputs = { ...target.inputs };
    if (value === null || isNaN(value)) {
      delete newInputs[port];
    } else {
      newInputs[port] = { type: 'number', value };
    }
    updateNode(targetNodeId, { inputs: newInputs });
  };

  // 递归渲染块（含嵌套）
  const renderBlock = (node: BlueprintNode, depth: number = 0): React.ReactNode => {
    const isOutput = node.id === graph.outputId;
    const color = BLOCK_COLORS[node.type] ?? 'bg-gray-500';
    const outputs = getNodeOutputs(node.type);
    const isReporter = outputs.length > 0 && node.type !== 'transform';
    const isSelected = selectedSrcId === node.id;
    const template = BLOCK_TEMPLATES[node.type] ?? node.type;

    // 嵌套块更小
    const scale = depth > 0 ? 'scale-90 origin-left' : '';

    const parts = template.split(/(\{\w+\})/g);
    const content = (
      <span className={`font-medium text-white leading-6 ${depth > 0 ? 'text-[10px]' : 'text-[11px]'}`}>
        {parts.map((part, i) => {
          const m = part.match(/\{(\w+)\}/);
          if (!m) return <span key={i}>{part}</span>;
          const port = m[1];
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
                className="inline-block w-10 mx-0.5 bg-white rounded-full px-1 text-[9px] text-black text-center outline-none"
              />
            );
          }
          // 输入槽：已连接则递归渲染源块，否则显示可直接输入数字的槽
          const input = node.inputs[port];
          const srcId = typeof input === 'object' && input !== null && 'nodeId' in input ? (input as any).nodeId : null;
          const srcNode = srcId ? nodeMap.get(srcId) : null;
          // 字面值（直接输入的数字）
          const literalVal = typeof input === 'object' && input !== null && 'type' in input && (input as any).type === 'number'
            ? (input as any).value
            : null;
          const slotKey = `${node.id}:${port}`;
          const isHover = hoverSlot === slotKey;

          if (srcNode) {
            // 递归嵌套整个块
            return (
              <span
                key={i}
                className="inline-flex items-center mx-0.5 align-middle"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'link'; setHoverSlot(slotKey); }}
                onDragLeave={() => setHoverSlot(null)}
                onDrop={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  const newSrcId = e.dataTransfer.getData('text/blueprint-node-id');
                  if (newSrcId) connectSlot(node.id, port, newSrcId);
                }}
                title="拖入替换，点击✕断开"
              >
                {renderBlock(srcNode, depth + 1)}
                <button
                  onClick={(e) => { e.stopPropagation(); disconnectSlot(node.id, port); }}
                  className="ml-0.5 text-white/70 hover:text-white bg-black/30 rounded-full p-0.5"
                  title="断开"
                >
                  <X className="size-2" />
                </button>
              </span>
            );
          }

          return (
            <span
              key={i}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'link'; setHoverSlot(slotKey); }}
              onDragLeave={() => setHoverSlot(null)}
              onDrop={(e) => {
                e.preventDefault(); e.stopPropagation();
                const newSrcId = e.dataTransfer.getData('text/blueprint-node-id');
                if (newSrcId) connectSlot(node.id, port, newSrcId);
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (selectedSrcId) connectSlot(node.id, port, selectedSrcId);
              }}
              className={`
                inline-flex items-center mx-0.5 h-5 rounded-full align-middle overflow-hidden
                ${isHover ? 'bg-amber-300 ring-2 ring-amber-200' : 'bg-white'}
              `}
              title="直接输入数字，或拖入积木"
            >
              <input
                type="number"
                value={literalVal ?? ''}
                placeholder="0"
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  setSlotLiteral(node.id, port, v);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-10 h-5 px-1 text-[9px] text-black text-center outline-none bg-transparent"
              />
            </span>
          );
        })}
      </span>
    );

    // 模板中未提及的输入槽（如下 t），单独列出
    const templatePorts = new Set(
      [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    );
    const extraInputs = getNodeInputs(node.type).filter(
      (port) => !templatePorts.has(port) && !(port in node.params)
    );

    const renderSlot = (port: string) => {
      const input = node.inputs[port];
      const srcId = typeof input === 'object' && input !== null && 'nodeId' in input ? (input as any).nodeId : null;
      const srcNode = srcId ? nodeMap.get(srcId) : null;
      const literalVal = typeof input === 'object' && input !== null && 'type' in input && (input as any).type === 'number'
        ? (input as any).value
        : null;
      const slotKey = `${node.id}:${port}`;
      const isHover = hoverSlot === slotKey;

      if (srcNode) {
        return (
          <span
            key={port}
            className="inline-flex items-center mx-0.5 align-middle"
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'link'; setHoverSlot(slotKey); }}
            onDragLeave={() => setHoverSlot(null)}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation();
              const newSrcId = e.dataTransfer.getData('text/blueprint-node-id');
              if (newSrcId) connectSlot(node.id, port, newSrcId);
            }}
            title={`${port}：拖入替换，点击✕断开`}
          >
            <span className="text-[9px] text-white/70 mr-0.5">{port}</span>
            {renderBlock(srcNode, depth + 1)}
            <button
              onClick={(e) => { e.stopPropagation(); disconnectSlot(node.id, port); }}
              className="ml-0.5 text-white/70 hover:text-white bg-black/30 rounded-full p-0.5"
              title="断开"
            >
              <X className="size-2" />
            </button>
          </span>
        );
      }

      return (
        <span
          key={port}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'link'; setHoverSlot(slotKey); }}
          onDragLeave={() => setHoverSlot(null)}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation();
            const newSrcId = e.dataTransfer.getData('text/blueprint-node-id');
            if (newSrcId) connectSlot(node.id, port, newSrcId);
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (selectedSrcId) connectSlot(node.id, port, selectedSrcId);
          }}
          className={`
            inline-flex items-center mx-0.5 h-5 rounded-full align-middle overflow-hidden
            ${isHover ? 'bg-amber-300 ring-2 ring-amber-200' : 'bg-white'}
          `}
          title={`${port}：直接输入数字，或拖入积木`}
        >
          <span className="text-[9px] text-black/60 pl-1.5">{port}</span>
          <input
            type="number"
            value={literalVal ?? ''}
            placeholder="0"
            onChange={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              setSlotLiteral(node.id, port, v);
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-10 h-5 px-1 text-[9px] text-black text-center outline-none bg-transparent"
          />
        </span>
      );
    };

    return (
      <div
        draggable={isReporter && !isOutput && depth === 0}
        onDragStart={(e) => {
          if (!isReporter || isOutput || depth > 0) return;
          e.dataTransfer.setData('text/blueprint-node-id', node.id);
          e.dataTransfer.effectAllowed = 'link';
        }}
        onClick={() => {
          if (isReporter && !isOutput && depth === 0) {
            setSelectedSrcId(isSelected ? null : node.id);
          }
        }}
        className={`
          ${color} shadow-md select-none ${scale}
          ${isReporter ? 'rounded-full cursor-grab active:cursor-grabbing' : 'rounded-[4px]'}
          ${isOutput ? 'ring-2 ring-emerald-400' : ''}
          ${isSelected ? 'ring-2 ring-amber-300' : ''}
          px-2.5 py-0.5 my-0.5 inline-block max-w-full
        `}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          {content}
          {extraInputs.map(renderSlot)}
          {depth === 0 && !isOutput && (
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
  };

  return (
    <div className="max-h-[400px] overflow-y-auto pr-1 py-1">
      {selectedSrcId && (
        <div className="sticky top-0 z-10 bg-amber-500/20 border border-amber-500/50 rounded px-2 py-1 mb-1 text-[10px] text-amber-200 flex items-center justify-between">
          <span>已选中块，点击槽位连接</span>
          <button onClick={() => setSelectedSrcId(null)}><X className="size-3" /></button>
        </div>
      )}
      <div className="flex flex-col items-start">
        {topLevelNodes.map((node) => (
          <div key={node.id}>{renderBlock(node, 0)}</div>
        ))}
      </div>
      {topLevelNodes.length === 0 && (
        <div className="text-[10px] text-gray-600 text-center py-4">空蓝图</div>
      )}
    </div>
  );
}
