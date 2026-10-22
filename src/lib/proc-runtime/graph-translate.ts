// 蓝图 → 运行时迷你图的两条翻译路：
// - 表演（有限时长）：采样烘焙——用产品 evaluateBlueprint 在时长内采样
//   transform 输出，简化成曲线（units='runtime'，已换算）。
// - 行为（无限过程）：结构翻译——节点 1:1 映射到运行时求值器（eval-src）
//   的实现集，图原样进包实时求值（units='main'，通道在 transform 处换算）。
// 两条路共用方言表（按语境分类）与报告口径：不支持的节点逐条点名，不静默。
import type { BlueprintGraph, BlueprintInput } from '../blueprint/ir';
import { isRef } from '../blueprint/ir';
import { evaluateBlueprint } from '../blueprint/eval';
import { dialectOf } from './dialect';

/** 运行时引用：节点 id + 输出口（缺省 'out'） */
export interface RuntimeRef { n: string; o?: string }

/** 运行时迷你图节点（与 eval-src 的求值器同构） */
export type RuntimeGraphNode =
  | { id: string; type: string; params?: Record<string, unknown>; inputs?: Record<string, RuntimeRef | { v: number }> }
  | { id: string; type: 'curve'; points: [number, number][] }
  | { id: string; type: 'transform'; part: string; units: 'main' | 'runtime'; angleFrom?: RuntimeRef; dxFrom?: RuntimeRef; dyFrom?: RuntimeRef };

export interface RuntimeGraph {
  context: 'performance' | 'behavior';
  nodes: RuntimeGraphNode[];
}

export interface GraphTranslateResult {
  ok: boolean;
  /** 翻译出的迷你图节点（已带 id 前缀，可直接并入所属图） */
  nodes: RuntimeGraphNode[];
  /** 图中出现过的节点类型 → 方言分类（报告/徽标用） */
  typeReport: Record<string, string>;
  /** 不进包的原因（ok=false 时） */
  reason?: string;
  /** 采样路专用：三通道最大幅值（全零 = 无姿态贡献）；结构路为 NaN */
  maxAmp: number;
  /** 逐条说明（通道丢弃、不支持节点等） */
  warnings: string[];
}

// ================= 表演：采样烘焙 =================

const SAMPLE_FPS = 60;
const SAMPLE_COUNT = 25; // u = 0..1 共 25 点

/** 曲线简化：去掉与前后连线偏差小于 eps 的中间点 */
function simplify(points: [number, number][], eps: number): [number, number][] {
  if (points.length <= 2) return points;
  const out: [number, number][] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = out[out.length - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const t = nx === px ? 0 : (cx - px) / (nx - px);
    const interp = py + (ny - py) * t;
    if (Math.abs(cy - interp) > eps) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function translatePerformanceGraph(
  graph: BlueprintGraph,
  partKey: string,
  duration: number,
  idPrefix: string,
): GraphTranslateResult {
  const typeReport: Record<string, string> = {};
  for (const n of graph.nodes) typeReport[n.type] = dialectOf(n.type, 'performance');
  const angPts: [number, number][] = [];
  const dxPts: [number, number][] = [];
  const dyPts: [number, number][] = [];
  let maxAmp = 0;
  try {
    const nodeState = new Map<string, unknown>();
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const u = i / (SAMPLE_COUNT - 1);
      const r = evaluateBlueprint(graph, {
        frame: u * duration * SAMPLE_FPS,
        frameRate: SAMPLE_FPS,
        vars: {},
        nodeState: nodeState as Map<string, any>,
      });
      // 单位/坐标转换：rotation 度 → 弧度且 y-down 顺时针 → y-up 逆时针取负；
      // translateY 向下为正 → 运行时 dy 向上为正取负；translateX 同向。
      const ang = -r.rotation * Math.PI / 180;
      const dx = r.translateX;
      const dy = -r.translateY;
      angPts.push([u, ang]); dxPts.push([u, dx]); dyPts.push([u, dy]);
      maxAmp = Math.max(maxAmp, Math.abs(ang), Math.abs(dx), Math.abs(dy));
    }
  } catch (e) {
    return { ok: false, nodes: [], typeReport, maxAmp: 0, warnings: [], reason: e instanceof Error ? e.message : String(e) };
  }
  const nodes: RuntimeGraphNode[] = [{ id: `${idPrefix}t`, type: 'time' }];
  const tr: Extract<RuntimeGraphNode, { type: 'transform' }> = {
    id: `${idPrefix}tr`, type: 'transform', part: partKey, units: 'runtime',
  };
  const addCurve = (pts: [number, number][], suffix: string, field: 'angleFrom' | 'dxFrom' | 'dyFrom', eps: number) => {
    if (pts.every(([, v]) => Math.abs(v) < 1e-4)) return;
    const id = `${idPrefix}${suffix}`;
    nodes.push({ id, type: 'curve', points: simplify(pts, eps) });
    tr[field] = { n: id };
  };
  addCurve(angPts, 'ang', 'angleFrom', 0.01);
  addCurve(dxPts, 'dx', 'dxFrom', 0.15);
  addCurve(dyPts, 'dy', 'dyFrom', 0.15);
  if (tr.angleFrom || tr.dxFrom || tr.dyFrom) nodes.push(tr);
  return { ok: true, nodes, typeReport, maxAmp, warnings: [] };
}

// ================= 行为：结构翻译 =================

function convertInput(
  input: BlueprintInput,
  idPrefix: string,
  warnings: string[],
  port: string,
): RuntimeRef | { v: number } | undefined {
  if (isRef(input)) {
    return { n: idPrefix + input.nodeId, ...(input.output ? { o: input.output } : {}) };
  }
  const lit = input as { type?: string; value?: unknown };
  if (lit.type === 'number' && typeof lit.value === 'number') return { v: lit.value };
  if (lit.type === 'boolean') return { v: lit.value ? 1 : 0 };
  warnings.push(`输入 ${port} 是 ${lit.type ?? '未知'} 字面值，运行时只带数值，已忽略`);
  return undefined;
}

/**
 * 结构翻译一张节点行为图。
 * @param resolveNodeRef nodeRef 的 params.nodeId（产品节点 id）→ 运行时部件键；返回 null 表示无法解析
 */
export function translateBehaviorGraph(
  graph: BlueprintGraph,
  partKey: string,
  idPrefix: string,
  resolveNodeRef: (nodeId: string) => string | null,
): GraphTranslateResult {
  const typeReport: Record<string, string> = {};
  const warnings: string[] = [];
  const nodes: RuntimeGraphNode[] = [];
  let hasTransform = false;

  for (const n of graph.nodes) {
    const cls = dialectOf(n.type, 'behavior');
    typeReport[n.type] = cls;
    // enabled 短路（主系统口径：params.enabled === false → 节点无输出）
    if ((n.params as Record<string, unknown>)?.enabled === false) {
      warnings.push(`节点 ${n.id}（${n.type}）已禁用（enabled=false），未进包`);
      continue;
    }
    if (n.type === 'transform') {
      if (n.id !== graph.outputId) {
        warnings.push(`节点 ${n.id} 是非输出 transform，运行时行为图只认输出节点，已跳过`);
        continue;
      }
      hasTransform = true;
      const tr: Extract<RuntimeGraphNode, { type: 'transform' }> = {
        id: idPrefix + n.id, type: 'transform', part: partKey, units: 'main',
      };
      const channel = (port: string, field: 'angleFrom' | 'dxFrom' | 'dyFrom') => {
        const inp = n.inputs[port];
        if (!inp) return;
        const c = convertInput(inp, idPrefix, warnings, port);
        if (c && 'n' in c) tr[field] = c;
        else if (c && 'v' in c) warnings.push(`transform 通道 ${port} 是字面值 ${c.v}，行为图通道需连边，未进包`);
      };
      channel('rotation', 'angleFrom');
      channel('translateX', 'dxFrom');
      channel('translateY', 'dyFrom');
      for (const port of Object.keys(n.inputs)) {
        if (!['rotation', 'translateX', 'translateY'].includes(port)) {
          warnings.push(`transform 通道 ${port} 运行时不支持（只带 rotation/translateX/translateY），未进包`);
        }
      }
      nodes.push(tr);
      continue;
    }
    if (cls !== 'direct') {
      warnings.push(`节点 ${n.id}（${n.type}）运行时不支持，已跳过（其输出按 0 计）`);
      continue;
    }
    const params: Record<string, unknown> = { ...(n.params ?? {}) };
    delete params.enabled;
    if (n.type === 'nodeRef') {
      const target = resolveNodeRef(String(params.nodeId ?? ''));
      if (!target) {
        warnings.push(`nodeRef 目标 ${String(params.nodeId ?? '')} 无对应运行时部件，已按 0 处理`);
        nodes.push({ id: idPrefix + n.id, type: 'const', params: { value: 0 } });
        continue;
      }
      params.nodeId = target;
    }
    const inputs: Record<string, RuntimeRef | { v: number }> = {};
    for (const [port, inp] of Object.entries(n.inputs ?? {})) {
      const c = convertInput(inp, idPrefix, warnings, port);
      if (c) inputs[port] = c;
    }
    nodes.push({ id: idPrefix + n.id, type: n.type, params, inputs });
  }

  if (!hasTransform) {
    return {
      ok: false, nodes: [], typeReport, maxAmp: Number.NaN, warnings,
      reason: '图没有 transform 输出节点（outputId 须指向 transform 节点）',
    };
  }
  return { ok: true, nodes, typeReport, maxAmp: Number.NaN, warnings };
}
