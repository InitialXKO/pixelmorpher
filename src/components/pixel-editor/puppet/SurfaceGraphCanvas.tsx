'use client';

// ============================================================
// SurfaceGraphCanvas — 模式编辑器 v2 画布形态。
// 普通节点 = 卡片；作用域算子 = 框（框即该节点本体，子图在框内，
// 框头承载其非成员口如 warp 的 fx/fy 与输出口）。交互：背景拖
// 平移、滚轮缩放、卡头/框头拖动（拖框带成员）、框右下改尺寸、
// ⤢ 自动贴合、端口点点连线（点输入口再点输出口，或反序）、
// SVG 连线（作用域成员边为紫色虚线）。布局存 graph.ui，缺失时
// 用 computeSurfaceLayout 确定性自动布局兜底。
// ============================================================

import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  SURFACE_OP_SPECS, SURFACE_OP_SPEC_MAP, SURFACE_OP_CATS,
  computeSurfaceLayout, createSurfaceNode, nextSurfaceNodeId, surfaceScopeParentMap,
  SURFACE_NODE_W, SURFACE_NODE_H,
  type SurfaceLayout,
} from '@/lib/proc-runtime/surface-ops';
import type { SurfaceGraph, SurfaceGraphNode } from '@/lib/unified-types';

interface Props {
  graph: SurfaceGraph;
  onChange: (graph: SurfaceGraph, structural: boolean) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

type LinkState = { kind: 'in'; nodeId: string; port: string } | { kind: 'out'; nodeId: string } | null;

interface DragState {
  kind: 'node' | 'frame' | 'pan' | 'resize';
  id?: string;
  startX: number;
  startY: number;
  origPos: Record<string, { x: number; y: number }>;
  origFrame?: { x: number; y: number; w: number; h: number };
  moved: boolean;
}

const WORLD = 3200;

export function AddNodeMenu({ onAdd }: { onAdd: (op: string) => void }) {
  return (
    <select
      value=""
      className="h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded text-gray-300 px-1"
      onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}
    >
      <option value="">+ 节点…</option>
      {SURFACE_OP_CATS.map((c) => (
        <optgroup key={c} label={c}>
          {SURFACE_OP_SPECS.filter((s) => s.cat === c).map((s) => (
            <option key={s.op} value={s.op}>{s.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export default function SurfaceGraphCanvas({ graph, onChange, selectedId, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ tx: 12, ty: 12, k: 1 });
  const [link, setLink] = useState<LinkState>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number } | null>(null);

  const auto = useMemo(() => computeSurfaceLayout(graph), [graph]);
  const layout: SurfaceLayout = useMemo(() => ({
    pos: { ...auto.pos, ...(graph.ui?.pos ?? {}) },
    frames: { ...auto.frames, ...(graph.ui?.frames ?? {}) },
  }), [auto, graph.ui]);
  const scopeParent = useMemo(() => surfaceScopeParentMap(graph), [graph]);
  const byId = useMemo(() => new Map(graph.nodes.map((x) => [x.id, x])), [graph.nodes]);
  const specOf = (op: string) => SURFACE_OP_SPEC_MAP.get(op);
  const isScope = (nd: SurfaceGraphNode) => !!specOf(nd.op)?.scope;

  // 某作用域节点的全部后代成员（拖框时跟随）
  const membersOf = (frameId: string): string[] => {
    const out: string[] = [];
    const walk = (pid: string) => {
      for (const [child, p] of scopeParent) if (p === pid) { out.push(child); walk(child); }
    };
    walk(frameId);
    return out;
  };

  const posOf = (id: string) => {
    const base = layout.pos[id] ?? { x: 60, y: 60 };
    if (dragRef.current && dragDelta) {
      const d = dragRef.current;
      if (d.origPos[id]) return { x: d.origPos[id].x + dragDelta.dx, y: d.origPos[id].y + dragDelta.dy };
    }
    return base;
  };
  const frameOf = (id: string) => {
    const base = layout.frames[id] ?? { ...(layout.pos[id] ?? { x: 60, y: 60 }), w: 220, h: 130 };
    if (dragRef.current && dragDelta) {
      const d = dragRef.current;
      if (d.kind === 'frame' && d.id === id && d.origFrame) {
        return { x: d.origFrame.x + dragDelta.dx, y: d.origFrame.y + dragDelta.dy, w: d.origFrame.w, h: d.origFrame.h };
      }
      if (d.kind === 'resize' && d.id === id && d.origFrame) {
        return { ...d.origFrame, w: Math.max(130, d.origFrame.w + dragDelta.dx), h: Math.max(84, d.origFrame.h + dragDelta.dy) };
      }
    }
    return base;
  };

  const commitUi = (pos: Record<string, { x: number; y: number }>, frames: Record<string, { x: number; y: number; w: number; h: number }>) =>
    onChange({ ...graph, ui: { pos, frames } }, false);

  const beginDrag = (e: React.PointerEvent, d: Omit<DragState, 'startX' | 'startY' | 'moved'>) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { ...d, startX: e.clientX, startY: e.clientY, moved: false };
    setDragDelta({ dx: 0, dy: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / view.k;
    const dy = (e.clientY - d.startY) / view.k;
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 3) d.moved = true;
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, tx: v.tx + e.movementX, ty: v.ty + e.movementY }));
      return;
    }
    setDragDelta({ dx, dy });
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    const delta = dragDelta;
    dragRef.current = null;
    setDragDelta(null);
    if (!d || !delta || !d.moved) return;
    if (d.kind === 'node' || d.kind === 'frame') {
      const pos = { ...layout.pos };
      for (const [id, o] of Object.entries(d.origPos)) pos[id] = { x: o.x + delta.dx, y: o.y + delta.dy };
      const frames = { ...layout.frames };
      if (d.kind === 'frame' && d.id && d.origFrame) frames[d.id] = { x: d.origFrame.x + delta.dx, y: d.origFrame.y + delta.dy, w: d.origFrame.w, h: d.origFrame.h };
      // 作用域节点本体被拖（卡头在框头上）时框跟随
      if (d.kind === 'node' && d.id && isScope(byId.get(d.id)!)) {
        const f = layout.frames[d.id];
        if (f) frames[d.id] = { ...f, x: f.x + delta.dx, y: f.y + delta.dy };
      }
      commitUi(pos, frames);
    } else if (d.kind === 'resize' && d.id && d.origFrame) {
      const frames = { ...layout.frames };
      frames[d.id] = { ...d.origFrame, w: Math.max(130, d.origFrame.w + delta.dx), h: Math.max(84, d.origFrame.h + delta.dy) };
      commitUi({ ...layout.pos }, frames);
    }
  };

  const setInput = (nodeId: string, port: string, target: string) => {
    const nodes = graph.nodes.map((x) => {
      if (x.id !== nodeId) return x;
      const inputs: Record<string, string> = { ...x.inputs };
      if (target) inputs[port] = target;
      else delete inputs[port];
      return { ...x, inputs };
    });
    onChange({ ...graph, nodes }, true);
  };
  const clickInPort = (nodeId: string, port: string) => {
    if (link?.kind === 'out') {
      setInput(nodeId, port, link.nodeId);
      setLink(null);
    } else {
      setLink({ kind: 'in', nodeId, port });
    }
  };
  const clickOutPort = (nodeId: string) => {
    if (link?.kind === 'in') {
      setInput(link.nodeId, link.port, nodeId);
      setLink(null);
    } else {
      setLink({ kind: 'out', nodeId });
    }
  };

  const autoFitFrame = (frameId: string) => {
    const kids = graph.nodes.filter((x) => scopeParent.get(x.id) === frameId);
    if (kids.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const kid of kids) {
      const p = posOf(kid.id);
      const f = isScope(kid) ? frameOf(kid.id) : null;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, f ? f.x + f.w : p.x + SURFACE_NODE_W);
      maxY = Math.max(maxY, f ? f.y + f.h : p.y + SURFACE_NODE_H);
    }
    const rect = { x: minX - 12, y: minY - 30, w: maxX - minX + 24, h: maxY - minY + 42 };
    const frames = { ...layout.frames, [frameId]: rect };
    const pos = { ...layout.pos, [frameId]: { x: rect.x, y: rect.y } };
    commitUi(pos, frames);
  };

  // 连线锚点：输出 = 卡/框右缘中点；输入 = 左缘按口序
  const outAnchor = (id: string) => {
    const nd = byId.get(id);
    if (nd && isScope(nd)) { const f = frameOf(id); return { x: f.x + f.w, y: f.y + 14 }; }
    const p = posOf(id);
    return { x: p.x + SURFACE_NODE_W, y: p.y + 16 };
  };
  const inAnchor = (id: string, portIdx: number, nd: SurfaceGraphNode) => {
    if (isScope(nd)) { const f = frameOf(id); return { x: f.x, y: f.y + 14 }; }
    const p = posOf(id);
    return { x: p.x, y: p.y + 30 + portIdx * 13 };
  };

  const wirePath = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = Math.max(24, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };

  const portRowY = (i: number) => 30 + i * 13;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1 flex items-center gap-1.5">
        <AddNodeMenu onAdd={(op) => {
          const nd = createSurfaceNode(op, nextSurfaceNodeId(new Set(graph.nodes.map((x) => x.id))));
          const pos = { ...layout.pos, [nd.id]: { x: 60 - view.tx / view.k + 40, y: 60 - view.ty / view.k + 40 } };
          onChange({ ...graph, nodes: [...graph.nodes, nd], ui: { pos, frames: layout.frames } }, true);
        }} />
        <Button size="sm" variant="ghost" className="h-6 text-[9px] px-1.5"
          onClick={() => commitUi(auto.pos, auto.frames)}>
          自动布局
        </Button>
        <span className="text-[9px] text-gray-600">
          {link ? (link.kind === 'in' ? `连线中：${link.nodeId}.${link.port} → 点一个输出口` : '连线中：点一个输入口完成') : '拖背景平移 · 滚轮缩放 · 点口连线 · 点卡片在上方检查条改参数'}
        </span>
        {link && (
          <Button size="sm" variant="ghost" className="h-6 text-[9px] px-1 text-red-400" onClick={() => setLink(null)}>取消连线</Button>
        )}
        <div className="flex-1" />
        <span className="text-[9px] text-gray-600">{Math.round(view.k * 100)}%</span>
      </div>

      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded border border-[#1e1e3a]"
        style={{ background: 'radial-gradient(circle, #1b1b33 1px, transparent 1px) 0 0/18px 18px, #0a0a18', touchAction: 'none' }}
        onWheel={(e) => {
          const rect = wrapRef.current!.getBoundingClientRect();
          const mx = e.clientX - rect.left, my = e.clientY - rect.top;
          setView((v) => {
            const k = Math.max(0.35, Math.min(2.2, v.k * (e.deltaY < 0 ? 1.12 : 0.9)));
            const s = k / v.k;
            return { k, tx: mx - (mx - v.tx) * s, ty: my - (my - v.ty) * s };
          });
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.world === '1') {
            onSelect(null);
            setLink(null);
            beginDrag(e, { kind: 'pan', origPos: {} });
          }
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          data-world="1"
          className="absolute left-0 top-0"
          style={{ width: WORLD, height: WORLD, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})`, transformOrigin: '0 0' }}
        >
          <svg className="pointer-events-none absolute left-0 top-0" width={WORLD} height={WORLD}>
            {graph.nodes.flatMap((nd) => {
              const spec = specOf(nd.op);
              if (!spec) return [];
              return spec.ports.map((port, pi) => {
                const target = nd.inputs?.[port];
                if (!target || !byId.has(target)) return null;
                const a = outAnchor(target);
                const b = inAnchor(nd.id, pi, nd);
                const memberEdge = isScope(nd) && (port === 'in' || port === 'b');
                return (
                  <path key={`${nd.id}-${port}`} d={wirePath(a, b)} fill="none"
                    stroke={memberEdge ? '#8b5cf6' : '#565690'} strokeWidth={1.4}
                    strokeDasharray={memberEdge ? '5 4' : undefined} opacity={0.9} />
                );
              });
            })}
          </svg>

          {/* 作用域框（= 作用域节点本体） */}
          {graph.nodes.filter(isScope).map((nd) => {
            const f = frameOf(nd.id);
            const spec = specOf(nd.op)!;
            const extraPorts = spec.ports.filter((p) => p !== 'in' && p !== 'b');
            const selected = selectedId === nd.id;
            return (
              <div key={nd.id}
                className={`absolute rounded-md border ${selected ? 'border-violet-300' : 'border-violet-500/60'} bg-violet-500/[0.05]`}
                style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
              >
                <div
                  className="flex h-[26px] cursor-grab items-center gap-1 rounded-t-md bg-violet-500/15 px-1.5 active:cursor-grabbing"
                  onPointerDown={(e) => {
                    onSelect(nd.id);
                    const origPos: Record<string, { x: number; y: number }> = { [nd.id]: { ...layout.pos[nd.id] ?? { x: f.x, y: f.y } } };
                    for (const m of membersOf(nd.id)) origPos[m] = { ...posOf(m) };
                    beginDrag(e, { kind: 'frame', id: nd.id, origPos, origFrame: { ...f } });
                  }}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                >
                  <span className="text-[9px] font-mono text-violet-300/70">{nd.id}</span>
                  <span className="text-[10px] text-violet-200">{spec.label}</span>
                  <span className="text-[8px] text-violet-300/60">子图 {membersOf(nd.id).length}</span>
                  <div className="flex-1" />
                  <button className="text-[10px] text-violet-300 hover:text-white" title="自动贴合子图"
                    onClick={(e) => { e.stopPropagation(); autoFitFrame(nd.id); }}>⤢</button>
                  <button
                    className={`h-3 w-3 rounded-full border ${link?.kind === 'in' ? 'border-amber-300 bg-amber-300/40' : 'border-violet-300 bg-violet-400/30'}`}
                    title="输出口"
                    onClick={(e) => { e.stopPropagation(); clickOutPort(nd.id); }}
                  />
                </div>
                {extraPorts.map((port) => {
                  const target = nd.inputs?.[port];
                  return (
                    <div key={port} className="flex items-center gap-1 px-1.5 pt-0.5">
                      <button
                        className={`h-2.5 w-2.5 rounded-full border ${target ? 'border-cyan-300 bg-cyan-400/50' : 'border-gray-500 bg-transparent'} ${link?.kind === 'out' ? 'ring-1 ring-amber-300' : ''}`}
                        title={`输入口 ${port}`}
                        onClick={(e) => { e.stopPropagation(); clickInPort(nd.id, port); }}
                      />
                      <span className="text-[8px] text-gray-400">{port}{target ? ` ← ${target}` : ''}</span>
                      {target && (
                        <button className="text-[8px] text-gray-600 hover:text-red-300" onClick={() => setInput(nd.id, port, '')}>✕</button>
                      )}
                    </div>
                  );
                })}
                <div
                  className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize rounded-tl bg-violet-500/30"
                  onPointerDown={(e) => beginDrag(e, { kind: 'resize', id: nd.id, origPos: {}, origFrame: { ...f } })}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                />
              </div>
            );
          })}

          {/* 普通节点卡片 */}
          {graph.nodes.filter((nd) => !isScope(nd)).map((nd) => {
            const p = posOf(nd.id);
            const spec = specOf(nd.op);
            const selected = selectedId === nd.id;
            const paramChips = Object.entries(nd.params ?? {}).slice(0, 3);
            return (
              <div key={nd.id}
                className={`absolute rounded border ${selected ? 'border-cyan-300' : 'border-[#2c2c52]'} bg-[#12122a] shadow`}
                style={{ left: p.x, top: p.y, width: SURFACE_NODE_W }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div
                  className="flex h-[22px] cursor-grab items-center gap-1 rounded-t bg-[#1a1a38] px-1.5 active:cursor-grabbing"
                  onPointerDown={(e) => {
                    onSelect(nd.id);
                    beginDrag(e, { kind: 'node', id: nd.id, origPos: { [nd.id]: { ...p } } });
                  }}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                >
                  <span className="text-[9px] font-mono text-gray-500">{nd.id}</span>
                  <span className="truncate text-[10px] text-gray-200">{spec?.label ?? nd.op}</span>
                  <div className="flex-1" />
                  <button
                    className={`h-3 w-3 shrink-0 rounded-full border ${link?.kind === 'in' ? 'border-amber-300 bg-amber-300/40' : 'border-cyan-300 bg-cyan-400/30'}`}
                    title="输出口"
                    onClick={(e) => { e.stopPropagation(); clickOutPort(nd.id); }}
                  />
                </div>
                <div className="px-1.5 py-0.5">
                  {(spec?.ports ?? []).map((port, pi) => {
                    const target = nd.inputs?.[port];
                    return (
                      <div key={port} className="flex items-center gap-1" style={{ height: 13 }}>
                        <button
                          className={`h-2.5 w-2.5 rounded-full border ${target ? 'border-cyan-300 bg-cyan-400/50' : 'border-gray-500 bg-transparent'} ${link?.kind === 'out' ? 'ring-1 ring-amber-300' : ''}`}
                          title={`输入口 ${port}`}
                          onClick={(e) => { e.stopPropagation(); clickInPort(nd.id, port); }}
                        />
                        <span className="text-[8px] text-gray-400">{port}{target ? ` ← ${target}` : ''}</span>
                        {target && (
                          <button className="text-[8px] text-gray-600 hover:text-red-300" onClick={() => setInput(nd.id, port, '')}>✕</button>
                        )}
                        <span className="hidden">{portRowY(pi)}</span>
                      </div>
                    );
                  })}
                  {paramChips.length > 0 && (
                    <div className="truncate text-[8px] text-gray-600">
                      {paramChips.map(([k, v]) => `${k}=${v}`).join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
