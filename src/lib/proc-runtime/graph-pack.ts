// ============================================================
// 打包成子图（方向甲的作者侧入口）：把图中所选节点收成一个
// 命名子图模板（存模式库），原选区替换为 ref 节点。
// 纯函数两件：analyzePackSelection（校验 + 产出子图内容）、
// rewriteWithSubgraphRefs（用 saveUserPattern 拿到的模板 id
// 重写原图）。语义约束（v1）：
// - 子图无字段输入口：选区节点不得有来自选区外的输入边
//   （$ 参数引用不算边——它们成为子图的暴露参数）；
// - 选区必须有对外输出（被选区外节点或写出消费的选区节点）；
// - 重写后烘焙等值：ref 覆盖把暴露参数以 $ 转发回原图参数，
//   展开后与原图逐字节一致（探针把守）。
// ============================================================

import type { SurfaceGraph, SurfaceGraphNode } from '../unified-types';
import type { PatternParamDef } from './pattern-templates';
import { nextSurfaceNodeId } from './surface-ops';

export interface PackAnalysis {
  ok: boolean;
  reason?: string;
  /** 对外输出的选区节点 id（按图中顺序） */
  boundary: string[];
  /** 暴露参数键（选区内 $ 引用的键，按首次出现序） */
  exposedKeys: string[];
  subgraph?: {
    graph: SurfaceGraph;
    outputs: Record<string, string>;
    paramDefs: PatternParamDef[];
  };
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function analyzePackSelection(
  graph: SurfaceGraph,
  selectedIds: ReadonlySet<string>,
  outerDefs: PatternParamDef[],
): PackAnalysis {
  const sel = graph.nodes.filter((n) => selectedIds.has(n.id));
  if (sel.length === 0) return { ok: false, reason: '先勾选要打包的节点', boundary: [], exposedKeys: [] };
  const inGraph = new Set(graph.nodes.map((n) => n.id));
  // 外部输入边：选区节点引用了选区外的现存节点（悬空引用不算）
  const badEdges: string[] = [];
  for (const nd of sel) {
    for (const src of Object.values(nd.inputs ?? {})) {
      if (inGraph.has(src) && !selectedIds.has(src)) badEdges.push(`${nd.id} ← ${src}`);
    }
  }
  if (badEdges.length > 0) {
    return {
      ok: false,
      reason: `选区有来自外部的输入边（子图暂无字段输入口）：${badEdges.join('、')}。把上游节点一并选入，或先解除这些连线。`,
      boundary: [], exposedKeys: [],
    };
  }
  // 对外输出：被选区外节点输入或写出消费的选区节点
  const boundarySet = new Set<string>();
  for (const nd of graph.nodes) {
    if (selectedIds.has(nd.id)) continue;
    for (const src of Object.values(nd.inputs ?? {})) {
      if (selectedIds.has(src)) boundarySet.add(src);
    }
  }
  for (const wr of graph.writes) if (selectedIds.has(wr.from)) boundarySet.add(wr.from);
  const boundary = sel.map((n) => n.id).filter((id) => boundarySet.has(id));
  if (boundary.length === 0) {
    return {
      ok: false,
      reason: '选区没有对外输出（没有节点被选区外或写出端消费），打包后这段图会从图里消失。',
      boundary: [], exposedKeys: [],
    };
  }
  // 暴露参数：选区内 $ 引用的键
  const exposedKeys: string[] = [];
  for (const nd of sel) {
    for (const v of Object.values(nd.params ?? {})) {
      if (typeof v === 'string' && v.startsWith('$')) {
        const k = v.slice(1);
        if (!exposedKeys.includes(k)) exposedKeys.push(k);
      }
    }
  }
  const params: Record<string, number> = {};
  const paramDefs: PatternParamDef[] = [];
  for (const k of exposedKeys) {
    const outer = outerDefs.find((d) => d.key === k);
    const cur = graph.params?.[k] ?? outer?.def ?? 0;
    params[k] = cur;
    if (outer) paramDefs.push(clone(outer));
    else {
      const av = Math.abs(cur);
      paramDefs.push({
        key: k, label: k, min: 0,
        max: av > 0 ? Math.round(av * 2.5 * 100) / 100 : 1,
        step: av >= 2 ? 0.5 : 0.05, def: cur,
      });
    }
  }
  const outputs: Record<string, string> = { main: boundary[0]! };
  for (const b of boundary) outputs[b] = b;
  return {
    ok: true,
    boundary,
    exposedKeys,
    subgraph: {
      graph: { version: 1, nodes: clone(sel), writes: [], params },
      outputs,
      paramDefs,
    },
  };
}

export function rewriteWithSubgraphRefs(
  graph: SurfaceGraph,
  selectedIds: ReadonlySet<string>,
  tplId: string,
  boundary: string[],
  exposedKeys: string[],
): SurfaceGraph {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const refIdOf = new Map<string, string>();
  for (const b of boundary) {
    const id = nextSurfaceNodeId(ids);
    ids.add(id);
    refIdOf.set(b, id);
  }
  const overrides: Record<string, string> = {};
  for (const k of exposedKeys) overrides[k] = `$${k}`;
  const refNodes: SurfaceGraphNode[] = boundary.map((b) => ({
    id: refIdOf.get(b)!,
    op: 'ref',
    params: { ref: tplId, out: b, ...overrides },
  }));
  const nodes: SurfaceGraphNode[] = [];
  for (const nd of graph.nodes) {
    if (selectedIds.has(nd.id)) continue;
    if (!nd.inputs) { nodes.push(nd); continue; }
    const inputs: Record<string, string> = {};
    for (const [port, src] of Object.entries(nd.inputs)) inputs[port] = refIdOf.get(src) ?? src;
    nodes.push({ ...nd, inputs });
  }
  nodes.push(...refNodes);
  const writes = graph.writes.map((wr) => ({ ...wr, from: refIdOf.get(wr.from) ?? wr.from }));
  const ui = graph.ui
    ? {
        ...graph.ui,
        pos: graph.ui.pos
          ? Object.fromEntries(Object.entries(graph.ui.pos).filter(([id]) => !selectedIds.has(id)))
          : undefined,
      }
    : undefined;
  return { ...graph, nodes, writes, ...(ui ? { ui } : {}) };
}
