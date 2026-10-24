// Spike：子图实例化展开原型（方向甲）——验证「按实例去重展开」
// 不把 DAG 退化成树，且展开烘焙与手工平图逐字节一致。
// 运行：bun spikes/pattern-library/spike-subgraph-check.mts
import { PATTERN_TEMPLATES, type PatternTemplate } from '../../src/lib/proc-runtime/pattern-templates';
import { createSurfaceBaker } from '../../src/lib/proc-runtime/bake-src';
import type { SurfaceGraph, SurfaceGraphNode } from '../../src/lib/unified-types';

let pass = 0, fail = 0;
function check(name: string, ok: boolean) {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}`); }
}

// ---------- 展开原型（与 DESIGN-SUBGRAPH.md 同语义） ----------
interface LibEntry {
  id: string;
  params: { key: string; def: number }[];
  graph: SurfaceGraph;
  outputs?: Record<string, string>;
}

function expandSurfaceGraph(
  root: SurfaceGraph,
  lib: Map<string, LibEntry>,
): { graph: SurfaceGraph; warnings: string[] } {
  const warnings: string[] = [];
  const outNodes: SurfaceGraphNode[] = [];
  const instances = new Map<string, Record<string, string>>(); // 实例键 → 输出名→最终节点id
  let instCounter = 0;

  const subst = (params: Record<string, number | string> | undefined, scope: Record<string, number>) => {
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
      if (!tpl || stack.includes(tplId)) {
        warnings.push(!tpl ? `未解析的子图引用「${tplId}」` : `子图引用成环「${tplId}」`);
        const nid = prefix + node.id;
        outNodes.push({ id: nid, op: 'const', params: { v: 0 } });
        map.set(node.id, nid);
        continue;
      }
      // 有效参数：定义缺省 → 模板当前值 → ref 覆盖（可 $ 转发本图作用域）
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
      const key = tplId + '|' + JSON.stringify(Object.entries(eff).sort());
      let outputs = instances.get(key);
      if (!outputs) {
        const iprefix = `i${instCounter++}:`;
        const subMap = processGraph({ ...tpl.graph, params: eff }, iprefix, [...stack, tplId]);
        const declared = tpl.outputs ?? (tpl.graph.writes[0] ? { main: tpl.graph.writes[0].from } : {});
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
    // 第二遍：修本图新增节点的输入边（图内 id → 最终 id）
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

// ---------- 夹具 ----------
const baker = createSurfaceBaker();
const shape = { kind: 'rect', size: [24, 24] as [number, number], roundness: 0 };
const bakeBytes = (g: SurfaceGraph) => Buffer.from(baker.compileTileDAG(shape as never, g as never, 0).data).toString('hex');

const scales = PATTERN_TEMPLATES.find((t) => t.id === 'scales')!;
const lib = new Map<string, LibEntry>();
for (const t of PATTERN_TEMPLATES) lib.set(t.id, t as LibEntry);
lib.set('scales', { ...(scales as LibEntry), outputs: { main: 'rep', shadow: 'shadowG', edge: 'edge' } });

const scalesApplied: SurfaceGraph = {
  ...scales.graph,
  params: Object.fromEntries(scales.params.map((p) => [p.key, p.def])),
};
const scalesBytes = bakeBytes(scalesApplied);

// S1：无 ref 图展开后烘焙不变、节点数不变
{
  const { graph, warnings } = expandSurfaceGraph(scalesApplied, lib);
  check('S1 无 ref 图展开烘焙逐字节不变', bakeBytes(graph) === scalesBytes && warnings.length === 0);
  check('S1b 节点数不变', graph.nodes.length === scalesApplied.nodes.length);
}

// S2：宿主图以 3 个 ref（同实例、不同输出）复现鳞片写出——展开只含一份子图节点
const hostGraph: SurfaceGraph = {
  version: 1,
  nodes: [
    { id: 'in', op: 'inside' },
    { id: 'r1', op: 'ref', params: { ref: 'scales', out: 'main' } },
    { id: 'r2', op: 'ref', params: { ref: 'scales', out: 'shadow' } },
    { id: 'r3', op: 'ref', params: { ref: 'scales', out: 'edge' } },
  ],
  writes: [
    { from: 'in', slot: 2, at: 0.5 },
    { from: 'r1', slot: 3, at: 0 },
    { from: 'r2', slot: 2, at: 0.35 },
    { from: 'r3', slot: 5, at: 0.45 },
  ],
  params: {},
};
{
  const { graph } = expandSurfaceGraph(hostGraph, lib);
  check('S2 三引用同实例展开烘焙 == 鳞片原图', bakeBytes(graph) === scalesBytes);
  check(`S2b 去重：展开节点数 ${graph.nodes.length} == 宿主 1 + 鳞片 ${scales.graph.nodes.length}（朴素拷贝将是 1+3×）`,
    graph.nodes.length === 1 + scales.graph.nodes.length);
}

// S3：ref 覆盖参数生效且等值于原图改参数
{
  const host = structuredClone(hostGraph);
  host.nodes[1]!.params = { ref: 'scales', out: 'main', cw: 14 };
  host.nodes[2]!.params = { ref: 'scales', out: 'shadow', cw: 14 };
  host.nodes[3]!.params = { ref: 'scales', out: 'edge', cw: 14 };
  const { graph } = expandSurfaceGraph(host, lib);
  const truth: SurfaceGraph = { ...scalesApplied, params: { ...scalesApplied.params, cw: 14 } };
  check('S3 覆盖 cw=14 的展开烘焙 == 原图 cw=14', bakeBytes(graph) === bakeBytes(truth));
  check('S3b 与缺省烘焙不同（覆盖真生效）', bakeBytes(graph) !== scalesBytes);
  // 注：三处覆盖同值才同实例；若只改 r1，则 r1 与 r2/r3 参数不同 → 两个实例
  const host2 = structuredClone(hostGraph);
  host2.nodes[1]!.params = { ref: 'scales', out: 'main', cw: 14 };
  const g2 = expandSurfaceGraph(host2, lib).graph;
  check('S3c 参数不同则实例分裂（节点数 = 宿主 + 2 份子图）',
    g2.nodes.length === 1 + 2 * scales.graph.nodes.length);
}

// S4：$ 转发——宿主参数 w=14 经 $w 喂给 ref 的 cw
{
  const host = structuredClone(hostGraph);
  host.params = { w: 14 };
  for (const i of [1, 2, 3]) host.nodes[i]!.params = { ...(host.nodes[i]!.params as object), cw: '$w' };
  const { graph } = expandSurfaceGraph(host, lib);
  const truth: SurfaceGraph = { ...scalesApplied, params: { ...scalesApplied.params, cw: 14 } };
  check('S4 $ 转发等值于字面覆盖', bakeBytes(graph) === bakeBytes(truth));
}

// S5：环——模板自引用，展开终止 + 点名 + 可烘焙
{
  lib.set('loop', {
    id: 'loop', params: [],
    graph: {
      version: 1,
      nodes: [{ id: 'r', op: 'ref', params: { ref: 'loop' } }],
      writes: [{ from: 'r', slot: 2 }],
      params: {},
    },
  });
  const host: SurfaceGraph = {
    version: 1,
    nodes: [{ id: 'x', op: 'ref', params: { ref: 'loop' } }],
    writes: [{ from: 'x', slot: 2 }],
    params: {},
  };
  const { graph, warnings } = expandSurfaceGraph(host, lib);
  check('S5 环被点名且展开终止', warnings.some((w) => w.includes('成环')));
  check('S5b 环展开图可烘焙', bakeBytes(graph).length > 0);
}

// S6：未解析引用——点名 + 零场可烘焙
{
  const host: SurfaceGraph = {
    version: 1,
    nodes: [{ id: 'x', op: 'ref', params: { ref: 'nope' } }],
    writes: [{ from: 'x', slot: 2 }],
    params: {},
  };
  const { graph, warnings } = expandSurfaceGraph(host, lib);
  check('S6 未解析被点名', warnings.some((w) => w.includes('未解析')));
  check('S6b 未解析展开图可烘焙', bakeBytes(graph).length > 0);
}

// S7：嵌套——B 引用鳞片再被宿主引用，跨层级同实例仍合并
{
  lib.set('wrapB', {
    id: 'wrapB', params: [],
    graph: {
      version: 1,
      nodes: [
        { id: 's', op: 'ref', params: { ref: 'scales', out: 'main' } },
        { id: 't', op: 'threshold', inputs: { in: 's' }, params: { at: 0.2 } },
      ],
      writes: [],
      params: {},
    },
    outputs: { main: 't' },
  });
  const host: SurfaceGraph = {
    version: 1,
    nodes: [
      { id: 'd1', op: 'ref', params: { ref: 'scales', out: 'main' } },
      { id: 'b1', op: 'ref', params: { ref: 'wrapB', out: 'main' } },
      { id: 'mx', op: 'max', inputs: { a: 'd1', b: 'b1' } },
    ],
    writes: [{ from: 'mx', slot: 3, at: 0 }],
    params: {},
  };
  const { graph } = expandSurfaceGraph(host, lib);
  const expected = 1 /* mx */ + 1 /* wrapB 的 t */ + scales.graph.nodes.length;
  check(`S7 跨层级同实例合并（节点数 ${graph.nodes.length} == ${expected}）`, graph.nodes.length === expected);
  check('S7b 嵌套展开可烘焙且非空', bakeBytes(graph).length > 0);
}

console.log(`\n子图展开 spike：${pass} 过 / ${fail} 败`);
process.exit(fail ? 1 : 0);
