'use client';

// ============================================================
// SurfaceGraphEditor — 表面模式 DAG 编辑器（v1 结构化形态）
// 设计定稿：一份数据三面孔之「高级面孔」。结构 = 节点行列表；
// 坐标修饰算子（repeat/warp/mirror/…）以作用域呈现——其 in/b
// 子图在列表中缩进并挂紫色作用域边，语义是「子图在变换坐标
// 里求值」，与普通场连线分开读。右侧：实时烘焙预览（与运行时
// 同一求值器 bake-src）+ 写出端（有序，后写覆盖）+ 参数暴露
// （模板参数定义，模式库滑杆由此生成）。
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { createSurfaceBaker } from '@/lib/proc-runtime/bake-src';
import {
  SURFACE_OP_SPECS, SURFACE_OP_SPEC_MAP,
  createSurfaceNode, nextSurfaceNodeId,
} from '@/lib/proc-runtime/surface-ops';
import { expandSurfaceGraph, graphHasRefs, subgraphLibraryOf } from '@/lib/proc-runtime/graph-expand';
import { allPatternTemplates, saveUserPattern } from '@/lib/proc-runtime/pattern-library';
import { analyzePackSelection, rewriteWithSubgraphRefs } from '@/lib/proc-runtime/graph-pack';
import SurfaceGraphCanvas, { AddNodeMenu } from './SurfaceGraphCanvas';
import type { PatternParamDef, PatternTemplate } from '@/lib/proc-runtime/pattern-templates';
import type { SurfaceGraph, SurfaceGraphNode, SurfaceGraphWrite } from '@/lib/unified-types';

export interface EditorRuntimeShape {
  kind: string;
  size: [number, number];
  roundness?: number;
  points?: [number, number][];
  pivot?: [number, number];
}

interface Props {
  title: string;
  graph: SurfaceGraph;
  paramDefs: PatternParamDef[];
  shape: EditorRuntimeShape;
  /** 轮廓外延宽度（与外观 haloWidth 同步，预览含外圈写出） */
  haloWidth?: number;
  onChange: (graph: SurfaceGraph, defs: PatternParamDef[], structural: boolean) => void;
  onSaveTemplate: (name: string) => void;
  onClose: () => void;
}

const TIER_COLORS = ['#14101f', '#2c2140', '#473664', '#655189', '#8672ad', '#a894cc', '#cbbce8', '#f2ecff'];
let bakerSingleton: ReturnType<typeof createSurfaceBaker> | null = null;
function baker() {
  if (!bakerSingleton) bakerSingleton = createSurfaceBaker();
  return bakerSingleton;
}

const selCls = 'h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded text-gray-300 px-1';
const numCls = 'h-6 w-14 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded text-gray-300 px-1';

export default function SurfaceGraphEditor({ title, graph, paramDefs, shape, haloWidth, onChange, onSaveTemplate, onClose }: Props) {
  const [viewMode, setViewMode] = useState<'canvas' | 'list'>('canvas');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 动态表面（D1）预览相位：手动拨动查看各相位烘焙（不写回图）
  const [previewPhase, setPreviewPhase] = useState(0);
  // 打包成子图：null = 未进入打包模式；Set = 已勾选的节点 id
  const [packSel, setPackSel] = useState<ReadonlySet<string> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ids = useMemo(() => new Set(graph.nodes.map((x) => x.id)), [graph.nodes]);
  const specOf = (op: string) => SURFACE_OP_SPEC_MAP.get(op);

  // 作用域深度：被某个作用域算子以 in/b 口消费的节点 +1 层（可嵌套）
  const depthOf = useMemo(() => {
    const parent = new Map<string, string>();
    for (const nd of graph.nodes) {
      const spec = specOf(nd.op);
      if (!spec?.scope) continue;
      for (const port of spec.ports) {
        const child = nd.inputs?.[port];
        if (child) parent.set(child, nd.id);
      }
    }
    const memo = new Map<string, number>();
    const calc = (id: string, seen: Set<string>): number => {
      if (memo.has(id)) return memo.get(id)!;
      if (seen.has(id)) return 0;
      seen.add(id);
      const p = parent.get(id);
      const d = p ? calc(p, seen) + 1 : 0;
      memo.set(id, d);
      return d;
    };
    const out = new Map<string, number>();
    for (const nd of graph.nodes) out.set(nd.id, calc(nd.id, new Set()));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.nodes]);

  const tile = useMemo(() => {
    try {
      // 含子图引用的图先按当前模式库展开再烘焙（与导出/主画布同口径）
      const g = graphHasRefs(graph)
        ? expandSurfaceGraph(graph, subgraphLibraryOf(allPatternTemplates())).graph
        : graph;
      return baker().compileTileDAG(shape, g, haloWidth ?? 0, previewPhase);
    } catch {
      return null;
    }
  }, [graph, shape, haloWidth, previewPhase]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !tile) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(tile.w, tile.h);
    const hasGlint = graph.writes.some((x) => x.ch === 'glint');
    for (let i = 0; i < tile.w * tile.h; i++) {
      const r = tile.data[i * 4], g = tile.data[i * 4 + 1];
      const o = i * 4;
      if (r >= 254) {
        // 轮廓外延写出（B 通道编码）：与主画布着色同一解码
        const hb = tile.data[i * 4 + 2]!;
        if (hb > 0) {
          const hex = TIER_COLORS[(hb & 16) ? 4 : Math.max(0, Math.min(7, (hb & 15) - 1))]!;
          img.data[o] = parseInt(hex.slice(1, 3), 16);
          img.data[o + 1] = parseInt(hex.slice(3, 5), 16);
          img.data[o + 2] = parseInt(hex.slice(5, 7), 16);
          img.data[o + 3] = 255;
        } else {
          img.data[o + 3] = 0;
        }
        continue;
      }
      const hex = TIER_COLORS[Math.min(7, Math.max(0, r))] ?? '#888';
      let cr = parseInt(hex.slice(1, 3), 16), cg = parseInt(hex.slice(3, 5), 16), cb = parseInt(hex.slice(5, 7), 16);
      if (hasGlint && g === 255) {
        cr = Math.min(255, cr + 130); cg = Math.min(255, cg + 100); cb = Math.max(0, cb - 60);
      }
      img.data[o] = cr; img.data[o + 1] = cg; img.data[o + 2] = cb; img.data[o + 3] = 255;
    }
    cv.width = tile.w;
    cv.height = tile.h;
    ctx.putImageData(img, 0, 0);
  }, [tile, graph.writes]);

  const emit = (next: SurfaceGraph, structural: boolean, defs: PatternParamDef[] = paramDefs) =>
    onChange(next, defs, structural);
  const doPack = () => {
    if (!packSel) return;
    const analysis = analyzePackSelection(graph, packSel, paramDefs);
    if (!analysis.ok || !analysis.subgraph) {
      window.alert(analysis.reason ?? '无法打包');
      return;
    }
    const name = window.prompt('子图名称（存入模式库「我的」，之后可被任意图引用）', `${title.replace(/·改$/, '')}·子图`);
    if (!name) return;
    const tpl = saveUserPattern(name, analysis.subgraph.graph, analysis.subgraph.paramDefs, analysis.subgraph.outputs);
    emit(rewriteWithSubgraphRefs(graph, packSel, `${tpl.id}@1`, analysis.boundary, analysis.exposedKeys), true);
    setPackSel(null);
  };
  const setNode = (id: string, fn: (nd: SurfaceGraphNode) => SurfaceGraphNode, structural = false) =>
    emit({ ...graph, nodes: graph.nodes.map((x) => (x.id === id ? fn(x) : x)) }, structural);
  const setWrites = (writes: SurfaceGraphWrite[], structural = true) =>
    emit({ ...graph, writes }, structural);
  const setGraphParam = (key: string, v: number) =>
    emit({ ...graph, params: { ...graph.params, [key]: v } }, false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className={`flex max-h-[92vh] ${viewMode === 'canvas' ? 'h-[88vh] w-[1180px]' : 'w-[880px]'} max-w-[96vw] flex-col rounded-lg border border-[#2a2a4a] bg-[#0c0c1d] shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[#1e1e3a] px-3 py-2">
          <span className="text-xs font-medium text-gray-200">模式编辑器</span>
          <span className="text-[10px] text-cyan-300">{title}</span>
          <span className="text-[9px] text-gray-600">节点 {graph.nodes.length} · 写出 {graph.writes.length}</span>
          <div className="ml-1 flex overflow-hidden rounded border border-[#2a2a4a]">
            {(['canvas', 'list'] as const).map((m) => (
              <button key={m} className={`px-2 py-0.5 text-[9px] ${viewMode === m ? 'bg-violet-500/30 text-violet-100' : 'text-gray-500'}`}
                onClick={() => setViewMode(m)}>
                {m === 'canvas' ? '画布' : '列表'}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" className="h-6 text-[10px]"
            onClick={() => {
              const name = window.prompt('存为我的模板，名称', title.replace(/·改$/, ''));
              if (name) onSaveTemplate(name);
            }}>
            存为我的模板
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onClose}>关闭（改动已实时生效）</Button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左：画布 / 列表双视图 */}
          {viewMode === 'canvas' ? (
            <div className="flex min-w-0 flex-1 flex-col p-2">
              {selectedId && graph.nodes.some((x) => x.id === selectedId) && (
                <div className="mb-1 max-h-[38%] overflow-y-auto">
                  {graph.nodes.filter((x) => x.id === selectedId).map((nd) => (
                    <NodeRow
                      key={nd.id}
                      nd={nd}
                      depth={0}
                      allIds={[...ids]}
                      graphParams={graph.params ?? {}}
                      onChange={(next, structural) => setNode(nd.id, () => next, structural)}
                      onDuplicate={() => {
                        const copy: SurfaceGraphNode = JSON.parse(JSON.stringify(nd));
                        copy.id = nextSurfaceNodeId(ids);
                        emit({ ...graph, nodes: [...graph.nodes, copy] }, true);
                      }}
                      onDelete={() => { emit({ ...graph, nodes: graph.nodes.filter((x) => x.id !== nd.id) }, true); setSelectedId(null); }}
                    />
                  ))}
                </div>
              )}
              <SurfaceGraphCanvas graph={graph} onChange={emit} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
          ) : (
          <div className="min-w-0 flex-1 overflow-y-auto p-2">
            <div className="mb-1 flex items-center gap-1.5">
              <Label className="text-[9px] text-gray-500">节点（紫框 = 作用域，其子图缩进）</Label>
              <div className="flex-1" />
              {packSel === null ? (
                <Button size="sm" variant="ghost" className="h-6 text-[9px] px-1.5"
                  onClick={() => setPackSel(new Set())}>
                  打包成子图…
                </Button>
              ) : (
                <>
                  <span className="text-[9px] text-cyan-300">已选 {packSel.size} 个节点</span>
                  <Button size="sm" variant="ghost" className="h-6 text-[9px] px-1.5 text-cyan-200"
                    onClick={doPack}>
                    完成打包
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[9px] px-1.5"
                    onClick={() => setPackSel(null)}>
                    取消
                  </Button>
                </>
              )}
              <AddNodeMenu onAdd={(op) => {
                const nd = createSurfaceNode(op, nextSurfaceNodeId(ids));
                emit({ ...graph, nodes: [...graph.nodes, nd] }, true);
              }} />
            </div>
            <div className="space-y-1">
              {graph.nodes.map((nd) => (
                <NodeRow
                  key={nd.id}
                  nd={nd}
                  depth={depthOf.get(nd.id) ?? 0}
                  allIds={[...ids]}
                  graphParams={graph.params ?? {}}
                  packChecked={packSel ? packSel.has(nd.id) : undefined}
                  onTogglePack={packSel ? () => setPackSel((prev) => {
                    const next = new Set(prev ?? []);
                    if (next.has(nd.id)) next.delete(nd.id);
                    else next.add(nd.id);
                    return next;
                  }) : undefined}
                  onChange={(next, structural) => setNode(nd.id, () => next, structural)}
                  onDuplicate={() => {
                    const copy: SurfaceGraphNode = JSON.parse(JSON.stringify(nd));
                    copy.id = nextSurfaceNodeId(ids);
                    emit({ ...graph, nodes: [...graph.nodes, copy] }, true);
                  }}
                  onDelete={() => emit({ ...graph, nodes: graph.nodes.filter((x) => x.id !== nd.id) }, true)}
                />
              ))}
            </div>
          </div>

          )}
          {/* 右：预览 + 写出 + 参数 */}
          <div className="w-[248px] shrink-0 space-y-3 overflow-y-auto border-l border-[#1e1e3a] p-2">
            <div>
              <Label className="text-[9px] text-gray-500">烘焙预览（与导出运行时同源；金 = glint）</Label>
              <div
                className="mt-1 flex items-center justify-center rounded border border-[#1e1e3a]"
                style={{ background: 'repeating-conic-gradient(#181830 0% 25%, #101024 0% 50%) 0 0/12px 12px', minHeight: 120 }}
              >
                <canvas ref={canvasRef} style={{ imageRendering: 'pixelated', width: 168, height: 132, objectFit: 'contain' }} />
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="text-[9px] text-gray-500">预览相位</span>
                <input
                  type="range" min={0} max={1} step={graph.animation ? 1 / Math.max(2, graph.animation.frames) : 0.02}
                  value={previewPhase}
                  onChange={(e) => setPreviewPhase(Number(e.target.value))}
                  className="h-1 flex-1 accent-cyan-400"
                />
                <span className="w-8 text-right text-[9px] text-gray-400">{previewPhase.toFixed(2)}</span>
              </div>
              {!graph.animation && (
                <p className="text-[8px] text-gray-600">图未开启动态表面：相位只影响预览，正式烘焙恒为相位 0。在外观面板勾选「动态表面」后生效。</p>
              )}
            </div>

            <div>
              <div className="flex items-center">
                <Label className="text-[9px] text-gray-500">写出端（按序，后写覆盖先写）</Label>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1"
                  onClick={() => setWrites([...graph.writes, { from: graph.nodes[0]?.id ?? '', slot: 3, at: 0.5 }])}>
                  + 写出
                </Button>
              </div>
              <div className="mt-1 space-y-1">
                {graph.writes.map((wr, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-1 rounded border border-[#1e1e3a] bg-[#101024] p-1">
                    <select value={wr.from} className={selCls}
                      onChange={(e) => setWrites(graph.writes.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}>
                      {graph.nodes.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
                    </select>
                    {wr.bump ? (
                      <>
                        <span className="text-[9px] text-gray-500">凸凹</span>
                        {(['hi', 'mid', 'lo'] as const).map((k) => (
                          <input key={k} type="number" min={0} max={7} step={1} value={wr.bump![k]} className={numCls} style={{ width: 34 }}
                            onChange={(e) => setWrites(graph.writes.map((x, j) => (j === i ? { ...x, bump: { ...x.bump!, [k]: Number(e.target.value) } } : x)))} />
                        ))}
                      </>
                    ) : (
                      <>
                        <span className="text-[9px] text-gray-500">档</span>
                        <input type="number" min={0} max={7} step={1} value={wr.slot} className={numCls} style={{ width: 34 }}
                          onChange={(e) => setWrites(graph.writes.map((x, j) => (j === i ? { ...x, slot: Number(e.target.value) } : x)))} />
                        <span className="text-[9px] text-gray-500">≥</span>
                        <input type="number" step={0.05} value={wr.at ?? 0.5} className={numCls} style={{ width: 44 }}
                          onChange={(e) => setWrites(graph.writes.map((x, j) => (j === i ? { ...x, at: Number(e.target.value) } : x)))} />
                        <label className="flex items-center gap-0.5 text-[9px] text-amber-300">
                          <input type="checkbox" checked={wr.ch === 'glint'}
                            onChange={(e) => setWrites(graph.writes.map((x, j) => (j === i ? { ...x, ch: e.target.checked ? 'glint' : undefined } : x)))} />
                          glint
                        </label>
                      </>
                    )}
                    <label className="flex items-center gap-0.5 text-[9px] text-gray-400">
                      <input type="checkbox" checked={!!wr.bump}
                        onChange={(e) => setWrites(graph.writes.map((x, j) => (j === i
                          ? (e.target.checked ? { ...x, bump: { hi: 5, mid: 3, lo: 1 } } : { ...x, bump: undefined })
                          : x)))} />
                      凸凹
                    </label>
                    <div className="flex-1" />
                    <Button size="sm" variant="ghost" className="h-5 px-1 text-[9px]" disabled={i === 0}
                      onClick={() => { const a = [...graph.writes]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setWrites(a); }}>↑</Button>
                    <Button size="sm" variant="ghost" className="h-5 px-1 text-[9px]" disabled={i === graph.writes.length - 1}
                      onClick={() => { const a = [...graph.writes]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setWrites(a); }}>↓</Button>
                    <Button size="sm" variant="ghost" className="h-5 px-1 text-[9px] text-red-400"
                      onClick={() => setWrites(graph.writes.filter((_, j) => j !== i))}>删</Button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center">
                <Label className="text-[9px] text-gray-500">模板参数（暴露给模式库滑杆）</Label>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1"
                  onClick={() => {
                    const key = window.prompt('参数键（英文）', '');
                    if (!key || paramDefs.some((d) => d.key === key)) return;
                    const defs = [...paramDefs, { key, label: key, min: 0, max: 4, step: 0.1, def: 1 }];
                    onChange({ ...graph, params: { ...graph.params, [key]: 1 } }, defs, false);
                  }}>
                  + 参数
                </Button>
              </div>
              <div className="mt-1 space-y-1.5">
                {paramDefs.map((pd) => (
                  <div key={pd.key} className="rounded border border-[#1e1e3a] bg-[#101024] p-1">
                    <div className="flex items-center gap-1">
                      <input value={pd.label} className={numCls} style={{ width: 76 }}
                        onChange={(e) => onChange(graph, paramDefs.map((d) => (d.key === pd.key ? { ...d, label: e.target.value } : d)), false)} />
                      <span className="text-[9px] text-gray-600">${pd.key}</span>
                      <div className="flex-1" />
                      <Button size="sm" variant="ghost" className="h-5 px-1 text-[9px] text-red-400"
                        onClick={() => onChange(graph, paramDefs.filter((d) => d.key !== pd.key), false)}>删</Button>
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <input type="range" min={pd.min} max={pd.max} step={pd.step}
                        value={graph.params?.[pd.key] ?? pd.def}
                        onChange={(e) => setGraphParam(pd.key, Number(e.target.value))}
                        className="h-1 flex-1 accent-cyan-400" />
                      <span className="w-8 text-right text-[9px] text-gray-400">{graph.params?.[pd.key] ?? pd.def}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[8px] text-gray-600">
                      <span>范围</span>
                      <input type="number" value={pd.min} className={numCls} style={{ width: 40, height: 18 }}
                        onChange={(e) => onChange(graph, paramDefs.map((d) => (d.key === pd.key ? { ...d, min: Number(e.target.value) } : d)), false)} />
                      <input type="number" value={pd.max} className={numCls} style={{ width: 40, height: 18 }}
                        onChange={(e) => onChange(graph, paramDefs.map((d) => (d.key === pd.key ? { ...d, max: Number(e.target.value) } : d)), false)} />
                      <span>步</span>
                      <input type="number" value={pd.step} className={numCls} style={{ width: 40, height: 18 }}
                        onChange={(e) => onChange(graph, paramDefs.map((d) => (d.key === pd.key ? { ...d, step: Number(e.target.value) } : d)), false)} />
                    </div>
                  </div>
                ))}
                {paramDefs.length === 0 && (
                  <p className="text-[9px] text-gray-600">尚无暴露参数。节点参数点「$」绑定到参数后，模板使用者就能用滑杆调它。</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NodeRow({
  nd, depth, allIds, graphParams, onChange, onDuplicate, onDelete, packChecked, onTogglePack,
}: {
  nd: SurfaceGraphNode;
  depth: number;
  allIds: string[];
  graphParams: Record<string, number>;
  onChange: (next: SurfaceGraphNode, structural: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  packChecked?: boolean;
  onTogglePack?: () => void;
}) {
  const spec = SURFACE_OP_SPEC_MAP.get(nd.op);
  const setInput = (port: string, target: string) => {
    const inputs: Record<string, string> = { ...nd.inputs };
    if (target) inputs[port] = target;
    else delete inputs[port];
    onChange({ ...nd, inputs }, true);
  };
  const setParam = (key: string, v: number | string) =>
    onChange({ ...nd, params: { ...nd.params, [key]: v } }, false);

  return (
    <div
      className={`rounded border bg-[#101024] p-1.5 ${spec?.scope ? 'border-violet-500/50' : 'border-[#1e1e3a]'}`}
      style={{ marginLeft: Math.min(depth, 6) * 14 }}
    >
      <div className="flex flex-wrap items-center gap-1">
        {onTogglePack && (
          <input type="checkbox" checked={!!packChecked} onChange={onTogglePack}
            className="h-3 w-3 accent-cyan-400" title="打包成子图：勾选要收进子图的节点" />
        )}
        <span className="text-[9px] font-mono text-gray-500">{nd.id}</span>
        <select
          value={nd.op}
          className={selCls}
          onChange={(e) => {
            const fresh = createSurfaceNode(e.target.value, nd.id);
            // 换 op 时保留已连接的同名端口
            const inputs: Record<string, string> = {};
            const ns = SURFACE_OP_SPEC_MAP.get(e.target.value);
            for (const p of ns?.ports ?? []) if (nd.inputs?.[p]) inputs[p] = nd.inputs[p];
            onChange({ ...fresh, inputs }, true);
          }}
        >
          {SURFACE_OP_SPECS.map((s) => <option key={s.op} value={s.op}>{s.label}</option>)}
        </select>
        {spec?.scope && <span className="rounded bg-violet-500/20 px-1 text-[8px] text-violet-300">作用域</span>}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" className="h-5 px-1 text-[9px]" onClick={onDuplicate}>复制</Button>
        <Button size="sm" variant="ghost" className="h-5 px-1 text-[9px] text-red-400" onClick={onDelete}>删</Button>
      </div>

      {spec && spec.ports.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {spec.ports.map((port) => {
            const cur = nd.inputs?.[port] ?? '';
            const dangling = cur !== '' && !allIds.includes(cur);
            return (
              <label key={port} className="flex items-center gap-0.5 text-[9px] text-gray-500">
                {port}
                <select value={cur} className={`${selCls} ${dangling ? 'border-red-500 text-red-300' : ''}`}
                  onChange={(e) => setInput(port, e.target.value)}>
                  <option value="">（未接）</option>
                  {dangling && <option value={cur}>⚠ {cur}（已删）</option>}
                  {allIds.filter((x) => x !== nd.id).map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}

      {nd.op === 'ref' && (
        <RefNodeFields nd={nd} graphParams={graphParams} setParam={setParam}
          replaceParams={(params) => onChange({ ...nd, params }, true)} />
      )}

      {nd.op !== 'ref' && spec && spec.params.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {spec.params.map((p) => {
            const raw = nd.params?.[p.key];
            const isRef = typeof raw === 'string' && raw.startsWith('$');
            if (p.enum) {
              return (
                <label key={p.key} className="flex items-center gap-0.5 text-[9px] text-gray-500">
                  {p.label}
                  <select value={String(raw ?? p.def)} className={selCls}
                    onChange={(e) => setParam(p.key, e.target.value)}>
                    {p.enum.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
              );
            }
            if (isRef) {
              const key = (raw as string).slice(1);
              return (
                <span key={p.key} className="flex items-center gap-0.5 text-[9px] text-cyan-300">
                  {p.label}=${key}
                  <span className="text-gray-500">({graphParams[key] ?? '?'})</span>
                  <button className="text-gray-500 hover:text-gray-300"
                    onClick={() => setParam(p.key, graphParams[key] ?? (typeof p.def === 'number' ? p.def : 0))}>
                    解绑
                  </button>
                </span>
              );
            }
            return (
              <label key={p.key} className="flex items-center gap-0.5 text-[9px] text-gray-500">
                {p.label}
                <input type="number" value={typeof raw === 'number' ? raw : (typeof p.def === 'number' ? p.def : 0)}
                  min={p.min} max={p.max} step={p.step ?? 0.5} className={numCls} style={{ width: 52 }}
                  onChange={(e) => setParam(p.key, Number(e.target.value))} />
                {Object.keys(graphParams).length > 0 && (
                  <select value="" className={selCls} style={{ width: 44 }} title="绑定到模板参数"
                    onChange={(e) => { if (e.target.value) setParam(p.key, `$${e.target.value}`); }}>
                    <option value="">$</option>
                    {Object.keys(graphParams).map((k) => <option key={k} value={k}>${k}</option>)}
                  </select>
                )}
              </label>
            );
          })}
        </div>
      )}
      {!spec && <p className="mt-1 text-[9px] text-red-400">未知算子 {nd.op}（求值时按 0 处理）</p>}
    </div>
  );
}

/** ref 节点专属字段：子图选择 + 输出选择 + 暴露参数覆盖（数值/$ 绑定，
 * 与普通节点参数同一三态口径）。切换目标会重置覆盖（旧目标的参数键
 * 对新目标无意义）。 */
function RefNodeFields({
  nd, graphParams, setParam, replaceParams,
}: {
  nd: SurfaceGraphNode;
  graphParams: Record<string, number>;
  setParam: (key: string, v: number | string) => void;
  replaceParams: (params: Record<string, number | string>) => void;
}) {
  const templates = useMemo(() => allPatternTemplates(), []);
  const refId = typeof nd.params?.ref === 'string' ? nd.params.ref : '';
  const target = templates.find((t) => t.id === refId);
  const outNames = target
    ? (Object.keys(target.outputs ?? {}).length > 0 ? Object.keys(target.outputs!) : ['main'])
    : ['main'];
  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <label className="flex items-center gap-0.5 text-[9px] text-gray-500">
          子图
          <select value={refId} className={`${selCls} ${refId && !target ? 'border-red-500 text-red-300' : ''}`}
            onChange={(e) => { if (e.target.value) replaceParams({ ref: e.target.value, out: 'main' }); }}>
            <option value="">（未选）</option>
            {refId && !target && <option value={refId}>⚠ {refId}（不存在）</option>}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}（{(t as { user?: boolean }).user ? '我的' : '内置'}）</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-0.5 text-[9px] text-gray-500">
          输出
          <select value={String(nd.params?.out ?? 'main')} className={selCls}
            onChange={(e) => setParam('out', e.target.value)}>
            {outNames.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      </div>
      {refId && !target && (
        <p className="text-[9px] text-red-400">目标模板不存在（被删除或改名），烘焙时该节点按零场处理并在导出时点名。</p>
      )}
      {!refId && <p className="text-[9px] text-gray-600">选一个模板作为子图实例；同图同参数的多个引用共享一份展开（不会复制成树）。</p>}
      {target && target.params.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {target.params.map((p) => {
            const raw = nd.params?.[p.key];
            const isRef = typeof raw === 'string' && raw.startsWith('$');
            if (isRef) {
              const key = (raw as string).slice(1);
              return (
                <span key={p.key} className="flex items-center gap-0.5 text-[9px] text-cyan-300">
                  {p.label}=${key}
                  <span className="text-gray-500">({graphParams[key] ?? '?'})</span>
                  <button className="text-gray-500 hover:text-gray-300"
                    onClick={() => setParam(p.key, graphParams[key] ?? p.def)}>
                    解绑
                  </button>
                </span>
              );
            }
            return (
              <label key={p.key} className="flex items-center gap-0.5 text-[9px] text-gray-500">
                {p.label}
                <input type="number" value={typeof raw === 'number' ? raw : p.def}
                  min={p.min} max={p.max} step={p.step} className={numCls} style={{ width: 52 }}
                  onChange={(e) => setParam(p.key, Number(e.target.value))} />
                {Object.keys(graphParams).length > 0 && (
                  <select value="" className={selCls} style={{ width: 44 }} title="绑定到本图参数"
                    onChange={(e) => { if (e.target.value) setParam(p.key, `$${e.target.value}`); }}>
                    <option value="">$</option>
                    {Object.keys(graphParams).map((k) => <option key={k} value={k}>${k}</option>)}
                  </select>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
