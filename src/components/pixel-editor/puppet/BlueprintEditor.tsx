'use client';

// ============================================================
// BlueprintEditor — 蓝图节点图编辑器
// 可视化编辑 BlueprintGraph：节点为盒子，连边为 SVG 线
// 与 IR 直接双向绑定（改 UI 即改 IR）
// ============================================================

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Plus, Trash2, X, Network, Blocks, Maximize2, Minimize2, Play, Pause } from 'lucide-react';
import type { BlueprintGraph, BlueprintNode } from '@/lib/blueprint/ir';
import { listBlueprintNodeTypes, getBlueprintNodeLabel, evaluateBlueprint, evaluateNodeOutput } from '@/lib/blueprint/eval';
import { getDefaultOutputForPort, getNodeInputs } from '@/lib/blueprint/specs';
import { Button } from '@/components/ui/button';
import BlueprintBlocksView from './BlueprintBlocksView';

interface BlueprintEditorProps {
  graph: BlueprintGraph;
  onChange: (graph: BlueprintGraph) => void;
  title?: string;
  /** 传入后，nodeRef 节点的 nodeId 参数渲染为下拉选择 */
  skeleton?: { nodes: { id: string; name: string }[] } | null;
  /** 新节点 ID 前缀（全局编辑器用：归属到指定部件） */
  idPrefix?: string;
  /** 帧率（预览播放用） */
  frameRate?: number;
  /** 整角色预览用：所有节点及其精灵和蓝图 */
  characterNodes?: Array<{
    id: string;
    name: string;
    blueprint?: BlueprintGraph | null;
    spritePixels?: import('@/lib/types').PixelGrid | null;
    spriteW?: number;
    spriteH?: number;
  }>;
}

const NODE_WIDTH = 140;
const NODE_HEADER_H = 24;
const PORT_H = 18;

export default function BlueprintEditor({ graph, onChange, title, skeleton, idPrefix, frameRate = 12, characterNodes }: BlueprintEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingType, setAddingType] = useState<string>('pendulum');
  const [viewMode, setViewMode] = useState<'graph' | 'blocks'>('graph');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [previewFrame, setPreviewFrame] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewMode, setPreviewMode] = useState<'single' | 'character'>('single');
  const [animateOthers, setAnimateOthers] = useState(true);
  const previewRef = useRef<HTMLCanvasElement>(null);

  // 预览播放计时器
  useEffect(() => {
    if (!previewPlaying || !isFullscreen) return;
    const interval = setInterval(() => {
      setPreviewFrame((f) => f + 1);
    }, 1000 / frameRate);
    return () => clearInterval(interval);
  }, [previewPlaying, isFullscreen, frameRate]);

  // 预览小窗：求值蓝图并绘制
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !isFullscreen) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0a0a1a';
      ctx.fillRect(0, 0, W, H);

      if (previewMode === 'character' && characterNodes && characterNodes.length > 0) {
        // 整角色模式：渲染所有精灵
        // 背景网格
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 1;
        for (let x = 0; x <= W; x += 20) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = 0; y <= H; y += 20) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        const cx = W / 2, cy = H / 2;
        for (const cn of characterNodes) {
          if (!cn.spritePixels) continue;
          // 求变换：animateOthers 开时用各自蓝图，否则用静态（frame 0）
          let t = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
          if (cn.blueprint && (animateOthers || cn.id === (graph as any)._nodeId)) {
            try {
              const r = evaluateBlueprint(cn.blueprint, {
                frame: animateOthers ? previewFrame : 0,
                frameRate, vars: {},
              } as any);
              t = r;
            } catch {}
          }
          // 如果是当前编辑的节点，用主 graph 的求值结果
          if ((graph as any)._nodeId === cn.id) {
            try {
              const r = evaluateBlueprint(graph, { frame: previewFrame, frameRate, vars: {} } as any);
              t = r;
            } catch {}
          }
          const grid = cn.spritePixels;
          const gw = grid[0]?.length ?? 0;
          const gh = grid.length;
          if (gw === 0 || gh === 0) continue;
          const scale = Math.min(3, 60 / Math.max(gw, gh));
          const dw = gw * scale, dh = gh * scale;
          const tmp = document.createElement('canvas');
          tmp.width = gw; tmp.height = gh;
          const tctx = tmp.getContext('2d');
          if (!tctx) continue;
          const img = tctx.createImageData(gw, gh);
          for (let y = 0; y < gh; y++) {
            for (let x = 0; x < gw; x++) {
              const c = grid[y]?.[x];
              const idx = (y * gw + x) * 4;
              if (c && typeof c === 'string') {
                const hex = c.replace('#', '');
                img.data[idx] = parseInt(hex.slice(0, 2), 16) || 0;
                img.data[idx+1] = parseInt(hex.slice(2, 4), 16) || 0;
                img.data[idx+2] = parseInt(hex.slice(4, 6), 16) || 0;
                img.data[idx+3] = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) : 255;
              }
            }
          }
          tctx.putImageData(img, 0, 0);
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.translate(cx + t.translateX * scale, cy + t.translateY * scale);
          ctx.rotate((t.rotation * Math.PI) / 180);
          ctx.scale(t.scaleX, t.scaleY);
          ctx.drawImage(tmp, -dw/2, -dh/2, dw, dh);
          ctx.restore();
        }
        // 标注
        ctx.fillStyle = '#71717a';
        ctx.font = '9px monospace';
        ctx.fillText(`整角色 f${previewFrame}${animateOthers ? '' : '（他静态）'}`, 4, 12);
        return;
      }

      // 单节点模式（原有逻辑）
      const t = evaluateBlueprint(graph, { frame: previewFrame, frameRate, vars: {} } as any);

      if (t.pixels) {
        // 有 pixels：绘制 screen 输出的像素
        const grid = t.pixels;
        const gw = grid[0]?.length ?? 0;
        const gh = grid.length;
        if (gw > 0 && gh > 0) {
          // 计算缩放以适应预览窗
          const scale = Math.min((W - 20) / gw, (H - 40) / gh, 4);
          const dw = gw * scale, dh = gh * scale;
          const dx = (W - dw) / 2, dy = 20 + (H - 40 - dh) / 2;
          // 绘制像素（imageSmoothing 关闭保持像素风）
          ctx.imageSmoothingEnabled = false;
          // 创建临时 canvas 绘制像素网格
          const tmp = document.createElement('canvas');
          tmp.width = gw; tmp.height = gh;
          const tctx = tmp.getContext('2d');
          if (tctx) {
            const img = tctx.createImageData(gw, gh);
            for (let y = 0; y < gh; y++) {
              for (let x = 0; x < gw; x++) {
                const c = grid[y]?.[x];
                const idx = (y * gw + x) * 4;
                if (c && typeof c === 'string') {
                  // 解析 #rrggbb 或 #rrggbbaa
                  const hex = c.replace('#', '');
                  img.data[idx] = parseInt(hex.slice(0, 2), 16) || 0;
                  img.data[idx+1] = parseInt(hex.slice(2, 4), 16) || 0;
                  img.data[idx+2] = parseInt(hex.slice(4, 6), 16) || 0;
                  img.data[idx+3] = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) : 255;
                }
              }
            }
            tctx.putImageData(img, 0, 0);
            // 应用变换绘制
            ctx.save();
            ctx.translate(W/2 + t.translateX * scale, H/2 + t.translateY * scale);
            ctx.rotate((t.rotation * Math.PI) / 180);
            ctx.scale(t.scaleX, t.scaleY);
            ctx.drawImage(tmp, dx - W/2, dy - H/2, dw, dh);
            ctx.restore();
          }
        }
      } else {
        // 无 pixels：显示变换数值（纯变换模式）
        ctx.strokeStyle = '#1a1a2e';
        for (let x = 0; x <= W; x += 20) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        ctx.save();
        ctx.translate(W/2 + t.translateX, H/2 + t.translateY);
        ctx.rotate((t.rotation * Math.PI) / 180);
        ctx.scale(t.scaleX, t.scaleY);
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.strokeRect(-30, -20, 60, 40);
        ctx.restore();
      }
      // 数值显示
      ctx.fillStyle = '#71717a';
      ctx.font = '9px monospace';
      ctx.fillText(`f${previewFrame} r${t.rotation.toFixed(1)}°`, 4, 12);
      ctx.fillText(`x${t.translateX.toFixed(1)} y${t.translateY.toFixed(1)}`, 4, 24);
    } catch {}
  }, [graph, previewFrame, frameRate, isFullscreen, previewMode, animateOthers, characterNodes]);
  // 拖拽节点
  const [dragging, setDragging] = useState<{
    nodeId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  // 连线中：从输出端口拖到输入端口
  const [connecting, setConnecting] = useState<{
    fromNodeId: string;
    mouseX: number;
    mouseY: number;
  } | null>(null);

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
    const rawId = `node_${Date.now().toString(36)}`;
    // 全局模式：加前缀归属到指定部件
    const id = idPrefix ? `${idPrefix}__${rawId}` : rawId;
    const newNode: BlueprintNode = {
      id,
      type: addingType,
      inputs: {},
      params: {},
      ui: { x: 20 + Math.random() * 200, y: 20 + Math.random() * 200 },
    };
    onChange({ ...graph, nodes: [...graph.nodes, newNode] });
    setSelectedId(id);
  }, [graph, onChange, addingType, idPrefix]);

  // 自动布局：按拓扑深度分层，左→右排列
  const autoLayout = useCallback(() => {
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    // 计算每个节点的深度（到输入的最长路径）
    const depthCache = new Map<string, number>();
    function getDepth(id: string, visiting = new Set<string>()): number {
      if (depthCache.has(id)) return depthCache.get(id)!;
      if (visiting.has(id)) return 0; // 环则返回 0
      visiting.add(id);
      const node = nodeMap.get(id);
      if (!node) return 0;
      let maxDep = 0;
      for (const input of Object.values(node.inputs)) {
        if (typeof input === 'object' && input !== null && 'nodeId' in input) {
          maxDep = Math.max(maxDep, getDepth((input as any).nodeId, visiting) + 1);
        }
      }
      visiting.delete(id);
      depthCache.set(id, maxDep);
      return maxDep;
    }

    // 按深度分组
    const layers = new Map<number, BlueprintNode[]>();
    for (const node of graph.nodes) {
      const d = getDepth(node.id);
      if (!layers.has(d)) layers.set(d, []);
      layers.get(d)!.push(node);
    }

    // 布局常量（与渲染一致）
    const NODE_W = 160;
    const NODE_H = 80;
    const H_GAP = 60;
    const V_GAP = 20;

    const newNodes = graph.nodes.map((node) => {
      const d = getDepth(node.id);
      const layer = layers.get(d)!;
      const idx = layer.indexOf(node);
      return {
        ...node,
        ui: {
          ...node.ui,
          x: 20 + d * (NODE_W + H_GAP),
          y: 20 + idx * (NODE_H + V_GAP),
        },
      };
    });
    onChange({ ...graph, nodes: newNodes });
  }, [graph, onChange]);

  const removeNode = useCallback((id: string) => {
    if (id === graph.outputId) return; // 不能删输出节点
    // 清除其他节点对它的引用，防止悬空
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
    if (selectedId === id) setSelectedId(null);
  }, [graph, onChange, selectedId]);

  // 断开输入端口的连接
  const disconnectInput = useCallback((nodeId: string, port: string) => {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const newInputs = { ...node.inputs };
    delete newInputs[port];
    onChange({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, inputs: newInputs } : n)),
    });
  }, [graph, onChange]);

  const setSlotLiteral = useCallback((nodeId: string, port: string, value: number | null) => {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const newInputs = { ...node.inputs };
    if (value === null || isNaN(value)) {
      delete newInputs[port];
    } else {
      newInputs[port] = { type: 'number', value };
    }
    onChange({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, inputs: newInputs } : n)),
    });
  }, [graph, onChange]);

  // 连接：fromNode 输出 -> toNode 的 port 输入
  const connectPorts = useCallback((fromNodeId: string, toNodeId: string, port: string) => {
    if (fromNodeId === toNodeId) return; // 不自连
    const fromNode = graph.nodes.find((n) => n.id === fromNodeId);
    const toNode = graph.nodes.find((n) => n.id === toNodeId);
    if (!toNode || !fromNode) return;
    // 从注册表取默认输出端口
    const output = getDefaultOutputForPort(fromNode.type, port);
    onChange({
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === toNodeId
          ? { ...n, inputs: { ...n.inputs, [port]: { nodeId: fromNodeId, output } } }
          : n
      ),
    });
  }, [graph, onChange]);

  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null;

  // 计算连边路径
  const edges = useMemo(() => {
    const list: { from: { x: number; y: number }; to: { x: number; y: number }; key: string }[] = [];
    for (const node of graph.nodes) {
      const toPos = positions.get(node.id);
      if (!toPos) continue;
      // 与渲染一致：spec 输入 + 已有输入
      const specInputs = getNodeInputs(node.type);
      const allPorts = Array.from(new Set([...specInputs, ...Object.keys(node.inputs)]));
      let portIdx = 0;
      for (const port of allPorts) {
        const input = node.inputs[port];
        if (typeof input === 'object' && input !== null && 'nodeId' in input) {
          const fromPos = positions.get((input as any).nodeId);
          if (fromPos) {
            list.push({
              from: { x: fromPos.x + NODE_WIDTH, y: fromPos.y + NODE_HEADER_H / 2 },
              to: { x: toPos.x, y: toPos.y + NODE_HEADER_H + portIdx * PORT_H + PORT_H / 2 },
              key: `${(input as any).nodeId}-${node.id}-${port}`,
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

  const editorContent = (
    <div className="space-y-2">
      {title && (
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-gray-400 font-medium">{title}</div>
          <div className="flex gap-1">
            <button
              onClick={() => setViewMode('graph')}
              className={`p-1 rounded ${viewMode === 'graph' ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-500 hover:text-gray-300'}`}
              title="节点图"
            >
              <Network className="size-3" />
            </button>
            <button
              onClick={() => setViewMode('blocks')}
              className={`p-1 rounded ${viewMode === 'blocks' ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-500 hover:text-gray-300'}`}
              title="积木"
            >
              <Blocks className="size-3" />
            </button>
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1 rounded text-gray-500 hover:text-gray-300"
              title={isFullscreen ? "退出全屏" : "全屏编辑"}
            >
              {isFullscreen ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
            </button>
          </div>
        </div>
      )}
      {!title && (
        <div className="flex justify-end gap-1">
          <button
            onClick={() => setViewMode('graph')}
            className={`p-1 rounded ${viewMode === 'graph' ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-500 hover:text-gray-300'}`}
            title="节点图"
          >
            <Network className="size-3" />
          </button>
          <button
            onClick={() => setViewMode('blocks')}
            className={`p-1 rounded ${viewMode === 'blocks' ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-500 hover:text-gray-300'}`}
            title="积木"
          >
            <Blocks className="size-3" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1 rounded text-gray-500 hover:text-gray-300"
            title={isFullscreen ? "退出全屏" : "全屏编辑"}
          >
            {isFullscreen ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
          </button>
        </div>
      )}

      {/* 工具条 */}
      <div className="flex gap-1.5">
        <select
          value={addingType}
          onChange={(e) => setAddingType(e.target.value)}
          className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1.5 py-1 text-[10px] text-gray-300"
        >
          {nodeTypes.map((t) => (
            <option key={t} value={t}>{getBlueprintNodeLabel(t)}</option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={addNode}
          disabled={!!idPrefix && !idPrefix}
          className="h-7 px-2 text-[10px]"
          title={idPrefix ? `将添加到部件 ${idPrefix}` : '添加节点'}
        >
          <Plus className="size-3 mr-0.5" />节点
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={autoLayout}
          className="h-7 px-2 text-[10px]"
          title="按依赖关系自动排列"
        >
          整理
        </Button>
      </div>
      {idPrefix && (
        <div className="text-[9px] text-gray-500 px-1">
          新节点将归属到部件 <span className="text-cyan-300">{idPrefix}</span>
        </div>
      )}

      {viewMode === 'blocks' ? (
        <BlueprintBlocksView graph={graph} onChange={onChange} />
      ) : (
      <>
      {/* 画布 */}
      <div
        className="relative bg-[#080818] border border-[#1e1e3a] rounded overflow-auto"
        style={{ height: 300 }}
        onClick={() => setSelectedId(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          if (dragging) {
            const dx = mx - dragging.startX;
            const dy = my - dragging.startY;
            const newX = Math.max(0, dragging.origX + dx);
            const newY = Math.max(0, dragging.origY + dy);
            onChange({
              ...graph,
              nodes: graph.nodes.map((n) =>
                n.id === dragging.nodeId ? { ...n, ui: { x: newX, y: newY } } : n
              ),
            });
          }
          if (connecting) {
            setConnecting({ ...connecting, mouseX: mx, mouseY: my });
          }
        }}
        onMouseUp={() => {
          setDragging(null);
          setConnecting(null);
        }}
        onMouseLeave={() => {
          setDragging(null);
          setConnecting(null);
        }}
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
          {/* 连线中的临时线 */}
          {connecting && (() => {
            const fromPos = positions.get(connecting.fromNodeId);
            if (!fromPos) return null;
            const fx = fromPos.x + NODE_WIDTH;
            const fy = fromPos.y + NODE_HEADER_H / 2;
            return (
              <path
                d={`M ${fx} ${fy} C ${fx + 40} ${fy}, ${connecting.mouseX - 40} ${connecting.mouseY}, ${connecting.mouseX} ${connecting.mouseY}`}
                stroke="#22d3ee"
                strokeWidth={1.5}
                fill="none"
                opacity={0.8}
                strokeDasharray="4 2"
              />
            );
          })()}
        </svg>

        {graph.nodes.map((node) => {
          const pos = positions.get(node.id)!;
          const isSelected = selectedId === node.id;
          const isOutput = node.id === graph.outputId;
          return (
            <div
              key={node.id}
              className={`absolute rounded border cursor-pointer select-none ${
                isSelected
                  ? 'border-cyan-400 bg-[#0f1f2f]'
                  : isOutput
                  ? 'border-emerald-500/50 bg-[#0f1f15]'
                  : 'border-[#2a2a4a] bg-[#111128]'
              }`}
              style={{ left: pos.x, top: pos.y, width: NODE_WIDTH }}
              onClick={(e) => { e.stopPropagation(); setSelectedId(node.id); }}
            >
              {/* 输出端口（右侧，可拖出连线） */}
              <div
                className="absolute -right-1.5 top-3 size-3 rounded-full bg-cyan-400 border border-cyan-200 cursor-crosshair hover:scale-125 transition-transform"
                title="拖出以连接"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.closest('.relative')?.getBoundingClientRect();
                  if (!rect) return;
                  setConnecting({
                    fromNodeId: node.id,
                    mouseX: e.clientX - rect.left,
                    mouseY: e.clientY - rect.top,
                  });
                }}
              />
              <div
                className="flex items-center justify-between px-1.5 py-1 border-b border-[#1e1e3a] cursor-move select-none"
                onMouseDown={(e) => {
                  // 只有左键且不是从端口开始的才拖节点
                  if (e.button !== 0) return;
                  e.preventDefault(); // 防止选中文字
                  const rect = e.currentTarget.closest('.relative')?.getBoundingClientRect();
                  if (!rect) return;
                  setDragging({
                    nodeId: node.id,
                    startX: e.clientX - rect.left,
                    startY: e.clientY - rect.top,
                    origX: pos.x,
                    origY: pos.y,
                  });
                  e.stopPropagation();
                }}
              >
                <span className="text-[10px] font-medium text-gray-200 truncate" title={node.type}>
                  {getBlueprintNodeLabel(node.type)}
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
                {(() => {
                  const specInputs = getNodeInputs(node.type);
                  const allPorts = Array.from(new Set([...specInputs, ...Object.keys(node.inputs)]));
                  if (allPorts.length === 0) {
                    return <div className="text-[8px] text-gray-600">无输入</div>;
                  }
                  return allPorts.map((port) => {
                    const input = node.inputs[port];
                    const isConnected = typeof input === 'object' && input !== null && 'nodeId' in input;
                    const literalVal = typeof input === 'object' && input !== null && 'type' in input && (input as any).type === 'number'
                      ? (input as any).value
                      : null;
                    const isSpecDefined = specInputs.includes(port);
                    return (
                      <div
                        key={port}
                        className="relative flex items-center gap-1 text-[9px] text-gray-400 truncate pl-2"
                        onMouseUp={(e) => {
                          e.stopPropagation();
                          if (connecting) {
                            connectPorts(connecting.fromNodeId, node.id, port);
                            setConnecting(null);
                          }
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isConnected) {
                            disconnectInput(node.id, port);
                          }
                        }}
                        title={isConnected ? '点击断开' : '从输出端口拖到这里以连接，或直接输入数字'}
                      >
                        {/* 输入端口圆点 */}
                        <div
                          className={`absolute -left-1.5 top-1/2 -translate-y-1/2 size-2.5 rounded-full border cursor-crosshair ${
                            isConnected
                              ? 'bg-cyan-400 border-cyan-200'
                              : 'bg-[#1e1e3a] border-gray-600 hover:border-cyan-400'
                          }`}
                        />
                        <span className={isSpecDefined ? '' : 'text-amber-500/70'}>← {port}</span>
                        {isConnected ? (
                          <span className="text-[8px] text-cyan-400/70 truncate">
                            {graph.nodes.find((n) => n.id === (input as any).nodeId)?.type ?? '?'}
                          </span>
                        ) : (
                          <input
                            type="number"
                            value={literalVal ?? ''}
                            placeholder="0"
                            onChange={(e) => {
                              const v = e.target.value === '' ? null : Number(e.target.value);
                              setSlotLiteral(node.id, port, v);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onMouseUp={(e) => e.stopPropagation()}
                            className="w-12 h-4 px-0.5 text-[8px] text-gray-200 bg-black/40 border border-white/10 rounded text-center outline-none"
                          />
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
              {/* 节点输出预览（仅全屏模式） */}
              {isFullscreen && (
                <NodePreview graph={graph} nodeId={node.id} frame={previewFrame} frameRate={frameRate} />
              )}
            </div>
          );
        })}
      </div>
      </>
      )}

      {/* 参数编辑（仅节点图模式） */}
      {viewMode === 'graph' && selected && (
        <div className="bg-[#080818] border border-[#1e1e3a] rounded p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-300 font-medium">
              {getBlueprintNodeLabel(selected.type)} 参数
            </span>
            <button
              onClick={() => setSelectedId(null)}
              className="text-gray-500 hover:text-gray-300"
            >
              <X className="size-3" />
            </button>
          </div>

          {/* params */}
          {Object.entries(selected.params).map(([key, val]) => {
            const isPrimitive = typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean';
            return (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-[9px] text-gray-500 w-20 truncate" title={key}>{key}</span>
              {!isPrimitive ? (
                // 非 primitive（数组/对象）：只读显示，由列表 UI 管理
                <span className="flex-1 min-w-0 text-[9px] text-gray-500 truncate" title={JSON.stringify(val)}>
                  {Array.isArray(val) ? `[${val.length} 项]` : '{对象}'}（列表管理）
                </span>
              ) : selected.type === 'nodeRef' && key === 'nodeId' && skeleton ? (
                <select
                  value={String(val)}
                  onChange={(e) => {
                    updateNode(selected.id, {
                      params: { ...selected.params, [key]: e.target.value },
                    });
                  }}
                  className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[10px] text-gray-300"
                >
                  <option value="">选择节点…</option>
                  {skeleton.nodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              ) : selected.type === 'nodeRef' && key === 'output' ? (
                <select
                  value={String(val)}
                  onChange={(e) => {
                    updateNode(selected.id, {
                      params: { ...selected.params, [key]: e.target.value },
                    });
                  }}
                  className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[10px] text-gray-300"
                >
                  {['rotation', 'translateX', 'translateY', 'scaleX', 'scaleY'].map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
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
              )}
            </div>
            );
          })}

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

  // 全屏模式：覆盖层 + 预览小窗
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0a0a1a]/95 backdrop-blur-sm p-6 overflow-auto">
        <div className="max-w-6xl mx-auto relative">
          {editorContent}
          {/* 预览小窗 */}
          <div className="fixed top-6 right-6 bg-[#0a0a1a] border border-[#2a2a4a] rounded-lg p-2 shadow-xl">
            <div className="flex items-center justify-between mb-1 px-1 gap-2">
              <div className="text-[9px] text-gray-500">动画预览 f{previewFrame}</div>
              <div className="flex items-center gap-1">
                {characterNodes && characterNodes.length > 0 && (
                  <>
                    <button
                      onClick={() => setPreviewMode(previewMode === 'single' ? 'character' : 'single')}
                      className="px-1.5 py-0.5 text-[8px] rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      title="切换单节点/整角色"
                    >
                      {previewMode === 'single' ? '整角色' : '单节点'}
                    </button>
                    {previewMode === 'character' && (
                      <button
                        onClick={() => setAnimateOthers(!animateOthers)}
                        className={`px-1.5 py-0.5 text-[8px] rounded ${animateOthers ? 'bg-cyan-900 text-cyan-300' : 'bg-zinc-800 text-zinc-500'}`}
                        title="其他节点是否由各自蓝图驱动"
                      >
                        {animateOthers ? '他动' : '他静'}
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={() => setPreviewPlaying(!previewPlaying)}
                  className="p-1 rounded text-gray-400 hover:text-cyan-300"
                  title={previewPlaying ? "暂停" : "播放"}
                >
                  {previewPlaying ? <Pause className="size-3" /> : <Play className="size-3" />}
                </button>
              </div>
            </div>
            <canvas ref={previewRef} width={220} height={160} className="rounded bg-black/50" />
          </div>
        </div>
      </div>
    );
  }

  return editorContent;
}

/** 单节点输出预览（无播放按钮，同步预览帧） */
function NodePreview({ graph, nodeId, frame, frameRate }: {
  graph: BlueprintGraph;
  nodeId: string;
  frame: number;
  frameRate: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      const out = evaluateNodeOutput(graph, nodeId, { frame, frameRate, vars: {} } as any);
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#080818';
      ctx.fillRect(0, 0, W, H);
      if (!out) {
        ctx.fillStyle = '#52525b';
        ctx.font = '8px monospace';
        ctx.fillText('—', 4, 12);
        return;
      }
      // 优先显示 pixels
      const px = out.pixels;
      if (px && px.type === 'pixels') {
        const grid = px.grid;
        const gw = grid[0]?.length ?? 0;
        const gh = grid.length;
        if (gw > 0 && gh > 0) {
          const scale = Math.min(W / gw, H / gh, 3);
          const dw = gw * scale, dh = gh * scale;
          const tmp = document.createElement('canvas');
          tmp.width = gw; tmp.height = gh;
          const tctx = tmp.getContext('2d');
          if (tctx) {
            const img = tctx.createImageData(gw, gh);
            for (let y = 0; y < gh; y++) {
              for (let x = 0; x < gw; x++) {
                const c = grid[y]?.[x];
                const idx = (y * gw + x) * 4;
                if (c && typeof c === 'string') {
                  const hex = c.replace('#', '');
                  img.data[idx] = parseInt(hex.slice(0, 2), 16) || 0;
                  img.data[idx+1] = parseInt(hex.slice(2, 4), 16) || 0;
                  img.data[idx+2] = parseInt(hex.slice(4, 6), 16) || 0;
                  img.data[idx+3] = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) : 255;
                }
              }
            }
            tctx.putImageData(img, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
          }
          return;
        }
      }
      // 显示数值输出（取第一个 number 类型的输出）
      const entries = Object.entries(out);
      const numEntry = entries.find(([_, v]) => v && (v as any).type === 'number');
      if (numEntry) {
        ctx.fillStyle = '#22d3ee';
        ctx.font = '9px monospace';
        const val = (numEntry[1] as any).value;
        ctx.fillText(`${numEntry[0]}:${Number(val).toFixed(2)}`, 4, 14);
      } else if (entries.length > 0) {
        ctx.fillStyle = '#71717a';
        ctx.font = '8px monospace';
        ctx.fillText(Object.keys(out).join(','), 4, 12);
      } else {
        ctx.fillStyle = '#52525b';
        ctx.font = '8px monospace';
        ctx.fillText('∅', 4, 12);
      }
    } catch {}
  }, [graph, nodeId, frame, frameRate]);

  return (
    <div className="px-1.5 pb-1">
      <canvas
        ref={canvasRef}
        width={120}
        height={36}
        className="w-full rounded bg-black/40 border border-[#1e1e3a]"
      />
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
