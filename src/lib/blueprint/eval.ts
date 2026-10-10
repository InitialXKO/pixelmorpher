// ============================================================
// Blueprint 求值器 — IR 图 → 每帧变换
// 拓扑排序后按序求值，无环（UI 层禁止成环）
// ============================================================

import type {
  BlueprintGraph,
  BlueprintNode,
  BlueprintEvalContext,
  BlueprintValue,
  BlueprintInput,
} from './ir';
import { asNumber, isRef, num } from './ir';

/** 节点求值函数签名 */
type NodeEvaluator = (
  node: BlueprintNode,
  inputs: Record<string, BlueprintValue>,
  ctx: BlueprintEvalContext,
) => Record<string, BlueprintValue>;

/** 内置节点类型 */
const EVALUATORS: Record<string, NodeEvaluator> = {
  // ---- 源 ----
  time: (_n, _i, ctx) => ({ out: num(ctx.frame) }),
  const: (n) => ({ out: num(Number(n.params.value ?? 0)) }),
  var: (n, _i, ctx) => {
    const v = ctx.vars[String(n.params.name ?? '')] ?? n.params.default ?? 0;
    return { out: num(Number(v)) };
  },

  // ---- 数学 ----
  add: (_n, i) => ({ out: num(asNumber(i.a ?? num(0)) + asNumber(i.b ?? num(0))) }),
  sub: (_n, i) => ({ out: num(asNumber(i.a ?? num(0)) - asNumber(i.b ?? num(0))) }),
  mul: (_n, i) => ({ out: num(asNumber(i.a ?? num(0)) * asNumber(i.b ?? num(1))) }),
  div: (_n, i) => {
    const b = asNumber(i.b ?? num(1));
    return { out: num(b !== 0 ? asNumber(i.a ?? num(0)) / b : 0) };
  },
  sin: (_n, i) => ({ out: num(Math.sin(asNumber(i.x ?? num(0)))) }),
  cos: (_n, i) => ({ out: num(Math.cos(asNumber(i.x ?? num(0)))) }),

  // ---- 程序化动画（复用老修改器语义） ----
  // pendulum: rotation = amplitude * sin(2π * t / period + phase)
  pendulum: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const amplitude = asNumber(i.amplitude ?? num(Number(n.params.amplitude ?? 30)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 16))));
    const phase = ((Number(n.params.phase ?? 0) * Math.PI) / 180);
    return { out: num(amplitude * Math.sin((2 * Math.PI * t) / period + phase)) };
  },
  // breath: scale = 1 + depth * sin(2π * t / period)
  breath: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const depth = asNumber(i.depth ?? num(Number(n.params.depth ?? 0.05)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 48))));
    return { out: num(1 + depth * Math.sin((2 * Math.PI * t) / period)) };
  },
  // shake: translate = amplitude * (noise)
  shake: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const amplitude = asNumber(i.amplitude ?? num(Number(n.params.amplitude ?? 2)));
    // 确定性伪随机（帧相关）
    const r1 = Math.sin(t * 12.9898) * 43758.5453;
    const r2 = Math.sin(t * 78.233) * 12543.123;
    const nx = (r1 - Math.floor(r1)) * 2 - 1;
    const ny = (r2 - Math.floor(r2)) * 2 - 1;
    return {
      outX: num(nx * amplitude),
      outY: num(ny * amplitude),
    };
  },
  // float: translateY = amplitude * sin(2π * t / period)
  float: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const amplitude = asNumber(i.amplitude ?? num(Number(n.params.amplitude ?? 4)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 32))));
    return { out: num(amplitude * Math.sin((2 * Math.PI * t) / period)) };
  },

  // ---- 输出 ----
  // transform: 把各分量组合成最终变换
  transform: (_n, i) => ({
    translateX: num(asNumber(i.translateX ?? num(0))),
    translateY: num(asNumber(i.translateY ?? num(0))),
    rotation: num(asNumber(i.rotation ?? num(0))),
    scaleX: num(asNumber(i.scaleX ?? num(1))),
    scaleY: num(asNumber(i.scaleY ?? num(1))),
  }),
};

/** 拓扑排序（Kahn 算法） */
function topoSort(graph: BlueprintGraph): BlueprintNode[] {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of graph.nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const n of graph.nodes) {
    for (const input of Object.values(n.inputs)) {
      if (isRef(input) && nodeMap.has(input.nodeId)) {
        adj.get(input.nodeId)!.push(n.id);
        inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: BlueprintNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(nodeMap.get(id)!);
    for (const next of adj.get(id) ?? []) {
      const d = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  // 有环则返回已排序部分（UI 层应禁止成环）
  return sorted;
}

/** 求值整图，返回 transform */
export function evaluateBlueprint(
  graph: BlueprintGraph,
  ctx: BlueprintEvalContext,
): {
  translateX: number;
  translateY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
} {
  const sorted = topoSort(graph);
  const values = new Map<string, Record<string, BlueprintValue>>();

  for (const node of sorted) {
    const evaluator = EVALUATORS[node.type];
    if (!evaluator) continue;

    // 解析输入：字面值直接用，连边从已求值节点取
    const resolvedInputs: Record<string, BlueprintValue> = {};
    for (const [port, input] of Object.entries(node.inputs)) {
      if (isRef(input)) {
        const src = values.get(input.nodeId);
        resolvedInputs[port] = src?.[input.output ?? 'out'] ?? num(0);
      } else {
        resolvedInputs[port] = input as BlueprintValue;
      }
    }

    try {
      values.set(node.id, evaluator(node, resolvedInputs, ctx));
    } catch {
      // 单个节点失败不影响整图
      values.set(node.id, {});
    }
  }

  const out = values.get(graph.outputId);
  return {
    translateX: out?.translateX ? asNumber(out.translateX) : 0,
    translateY: out?.translateY ? asNumber(out.translateY) : 0,
    rotation: out?.rotation ? asNumber(out.rotation) : 0,
    scaleX: out?.scaleX ? asNumber(out.scaleX) : 1,
    scaleY: out?.scaleY ? asNumber(out.scaleY) : 1,
  };
}

/** 注册自定义节点类型（插件/扩展用） */
export function registerBlueprintNodeType(type: string, evaluator: NodeEvaluator): void {
  EVALUATORS[type] = evaluator;
}

/** 列出所有内置节点类型（UI  palette 用） */
export function listBlueprintNodeTypes(): string[] {
  return Object.keys(EVALUATORS);
}
