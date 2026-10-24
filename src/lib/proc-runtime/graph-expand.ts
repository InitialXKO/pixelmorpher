// ============================================================
// 表面图子图实例化展开（方向甲：DAG 分层封装）。
// 存储的图带 ref 算子（引用另一模板为子图）；烘焙/进包前经
// 本函数展开成平图，求值器（bake-src）零改动。
//
// 铁律：展开按「实例」去重、不按「引用点」复制——实例 =
// （模板 id，有效参数集）。同一实例被多引用点、多输出、跨
// 层级消费，只展开一份节点集；ref 节点在展开图中消失，消费
// 边直连共享节点，扇出保留。不许把 DAG 退化成树。
//
// 语义要点：
// - 有效参数链：模板参数定义缺省 → 模板 graph.params →
//   ref 节点覆盖（覆盖值可 "$外层键" 转发引用方图的参数）。
// - 子图内部的 $ 引用只认自身有效作用域；展开时按来源图
//   作用域全部代入字面量（展开图 params 清空），求值器的
//   单层参数表不串扰。
// - 上下文穿透：子图的环境叶（inside/dist/cell* 等）读实例化
//   位置的上下文——与平图「同一节点被作用域内外共用」同义。
// - 环（实例化栈含目标 id）/未解析：一律点名警告 + 零场
//   const 节点，不挂死、不静默。
// ============================================================

import type { SurfaceGraph, SurfaceGraphNode } from '../unified-types';
import type { PatternParamDef } from './pattern-templates';

/** 可被引用的库条目（PatternTemplate / UserPatternTemplate 均满足） */
export interface SubgraphLibEntry {
  id: string;
  /** 暴露参数定义（有效参数链的缺省来源） */
  params: PatternParamDef[];
  graph: SurfaceGraph;
  /** 命名输出（输出名 → 子图内节点 id）；缺省 main = 首条写出的 from */
  outputs?: Record<string, string>;
}

export type SubgraphLibrary = ReadonlyMap<string, SubgraphLibEntry>;

/** 模板数组 → 展开用库（按 id 索引；同 id 后者胜） */
export function subgraphLibraryOf(templates: readonly SubgraphLibEntry[]): Map<string, SubgraphLibEntry> {
  const map = new Map<string, SubgraphLibEntry>();
  for (const t of templates) map.set(t.id, t);
  return map;
}

const MAX_DEPTH = 16;

export function expandSurfaceGraph(
  root: SurfaceGraph,
  lib: SubgraphLibrary,
): { graph: SurfaceGraph; warnings: string[] } {
  const warnings: string[] = [];
  const outNodes: SurfaceGraphNode[] = [];
  const instances = new Map<string, Record<string, string>>();
  let instCounter = 0;

  const subst = (
    params: Record<string, number | string> | undefined,
    scope: Record<string, number>,
  ): Record<string, number | string> | undefined => {
    if (!params) return undefined;
    const out: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string' && v.startsWith('$')) {
        const pv = scope[v.slice(1)];
        out[k] = pv !== undefined ? pv : v;
      } else out[k] = v;
    }
    return out;
  };

  function processGraph(
    g: SurfaceGraph,
    prefix: string,
    stack: string[],
  ): Map<string, string> {
    const scope = g.params ?? {};
    const map = new Map<string, string>();
    const addedFrom = outNodes.length;
    for (const node of g.nodes) {
      if (node.op !== 'ref') {
        const nid = prefix + node.id;
        outNodes.push({ ...node, id: nid, params: subst(node.params, scope) });
        map.set(node.id, nid);
        continue;
      }
      const tplId = String(node.params?.ref ?? '');
      const tpl = lib.get(tplId);
      if (!tpl || stack.includes(tplId) || stack.length >= MAX_DEPTH) {
        warnings.push(!tpl
          ? `子图：未解析的引用「${tplId || '(空)'}」，按零场处理`
          : `子图：引用「${tplId}」成环或嵌套过深，按零场处理`);
        const nid = prefix + node.id;
        outNodes.push({ id: nid, op: 'const', params: { v: 0 } });
        map.set(node.id, nid);
        continue;
      }
      const eff: Record<string, number> = {};
      for (const d of tpl.params) eff[d.key] = d.def;
      Object.assign(eff, tpl.graph.params ?? {});
      for (const [k, v] of Object.entries(node.params ?? {})) {
        if (k === 'ref' || k === 'out') continue;
        if (typeof v === 'string' && v.startsWith('$')) {
          const pv = scope[v.slice(1)];
          if (pv !== undefined) eff[k] = pv;
        } else if (typeof v === 'number') eff[k] = v;
      }
      const key = `${tplId}|${JSON.stringify(Object.entries(eff).sort())}`;
      let outputs = instances.get(key);
      if (!outputs) {
        const iprefix = `i${instCounter++}:`;
        const subMap = processGraph({ ...tpl.graph, params: eff }, iprefix, [...stack, tplId]);
        const declared = tpl.outputs
          ?? (tpl.graph.writes[0] ? { main: tpl.graph.writes[0].from } : {});
        outputs = {};
        for (const [name, nid] of Object.entries(declared)) {
          const mapped = subMap.get(nid);
          if (mapped) outputs[name] = mapped;
        }
        instances.set(key, outputs);
      }
      const outName = String(node.params?.out ?? 'main');
      map.set(node.id, outputs[outName] ?? outputs.main ?? '');
    }
    for (let i = addedFrom; i < outNodes.length; i++) {
      const nd = outNodes[i]!;
      if (!nd.inputs) continue;
      const fixed: Record<string, string> = {};
      for (const [port, src] of Object.entries(nd.inputs)) fixed[port] = map.get(src) ?? src;
      outNodes[i] = { ...nd, inputs: fixed };
    }
    return map;
  }

  const rootMap = processGraph(root, '', []);
  const writes = root.writes.map((wr) => ({ ...wr, from: rootMap.get(wr.from) ?? wr.from }));
  return { graph: { version: 1, nodes: outNodes, writes, params: {} }, warnings };
}

/** 图里是否含 ref 节点（调用方据此决定要不要展开/传库） */
export function graphHasRefs(g: SurfaceGraph | undefined): boolean {
  return !!g && g.nodes.some((n) => n.op === 'ref');
}
