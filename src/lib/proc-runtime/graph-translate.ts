// 蓝图 → 运行时迷你图的两条翻译路：
// - 表演（有限时长）：采样烘焙——用产品 evaluateBlueprint 在时长内采样
//   transform 输出，简化成曲线（units='runtime'，已换算）。
// - 行为（无限过程）：结构翻译——节点 1:1 映射到运行时求值器（eval-src）
//   的实现集，图原样进包实时求值（units='main'，通道在 transform 处换算）。
// 两条路共用方言表（按语境分类）与报告口径：不支持的节点逐条点名，不静默。
import type { BlueprintGraph, BlueprintInput, BlueprintEvalContext } from '../blueprint/ir';
import { asPixels, isRef } from '../blueprint/ir';
import { evaluateBlueprint, evaluateNodeOutput, getBlueprintNodeLabel, listBlueprintNodeTypes } from '../blueprint/eval';
import type { PixelGrid } from '../types';
import { dialectOf } from './dialect';

/** 运行时引用：节点 id + 输出口（缺省 'out'） */
export interface RuntimeRef { n: string; o?: string }

/**
 * 警告点名用的节点类型显示名：插件类型（plugin_ 前缀）优先用注册时的
 * 标签（如「插件:反相」），插件未安装时注册表里没有标签、回落原始类型
 * 串；其余类型一律原样返回（内置类型的既有警告文案不借标签改写）。
 */
export function nodeTypeDisplayName(type: string): string {
  return type.startsWith('plugin_') ? getBlueprintNodeLabel(type) : type;
}

/** 运行时迷你图节点（与 eval-src 的求值器同构） */
export type RuntimeGraphNode =
  | { id: string; type: string; params?: Record<string, unknown>; inputs?: Record<string, RuntimeRef | { v: number }> }
  | { id: string; type: 'curve'; points: [number, number][] }
  | { id: string; type: 'transform'; part: string; units: 'main' | 'runtime'; angleFrom?: RuntimeRef; dxFrom?: RuntimeRef; dyFrom?: RuntimeRef; scaleXFrom?: RuntimeRef; scaleYFrom?: RuntimeRef; foreFrom?: RuntimeRef };

export interface RuntimeGraph {
  context?: 'performance' | 'behavior'; // 来源标记（可选）：播放器不读，仅编辑器侧构造时自带
  nodes: RuntimeGraphNode[];
  /** 仅行为图：nodeRef 读上一帧（'prev'，缺省）还是本帧（'same'）输出 */
  follow?: 'prev' | 'same';
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
export function simplify(points: [number, number][], eps: number): [number, number][] {
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
      warnings.push(`节点 ${n.id}（${nodeTypeDisplayName(n.type)}）已禁用（enabled=false），未进包`);
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
      const channel = (port: string, field: 'angleFrom' | 'dxFrom' | 'dyFrom' | 'scaleXFrom' | 'scaleYFrom') => {
        const inp = n.inputs[port];
        if (!inp) return;
        const c = convertInput(inp, idPrefix, warnings, port);
        if (c && 'n' in c) tr[field] = c;
        else if (c && 'v' in c) warnings.push(`transform 通道 ${port} 是字面值 ${c.v}，行为图通道需连边，未进包`);
      };
      channel('rotation', 'angleFrom');
      channel('translateX', 'dxFrom');
      channel('translateY', 'dyFrom');
      channel('scaleX', 'scaleXFrom');
      channel('scaleY', 'scaleYFrom');
      for (const port of Object.keys(n.inputs)) {
        if (!['rotation', 'translateX', 'translateY', 'scaleX', 'scaleY'].includes(port)) {
          warnings.push(`transform 通道 ${port} 运行时不支持（只带 rotation/translateX/translateY/scaleX/scaleY），未进包`);
        }
      }
      nodes.push(tr);
      continue;
    }
    if (cls !== 'direct') {
      warnings.push(`节点 ${n.id}（${nodeTypeDisplayName(n.type)}）运行时不支持，已跳过（其输出按 0 计）`);
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

// ================= 像素链：子图提取 =================

import { PIXEL_CHAIN_NUMERIC_TYPES, PIXEL_CHAIN_PIXEL_TYPES } from './pixel-src';
import type { RuntimePixelGraph } from './pixel-src';

export interface PixelGraphExtraction {
  graph?: RuntimePixelGraph;
  warnings: string[];
  /** 整链因含运行时不支持节点被拒时给出：链终点节点 id 与链内节点
   * id 集（供导出「烘焙」档接管静态求值；drop 档不读此字段） */
  rejectedChain?: { endpoint: string; nodeIds: string[] };
}

/**
 * 从节点原始蓝图提取像素链子图：沿输出 screen 的 pixels 输入边
 * 反向收集祖先节点（含驱动参数的数值子树），逐节点校验支持集，
 * 翻成 PIXEL_SRC 的迷你图格式。图中含 costume/character_source
 * （跨服装槽读图）或范围外像素节点（texture_scroll、bump_light、
 * pixel_edit 等）时整链不进包并逐条点名——不静默丢弃、不部分
 * 进包造成与编辑器分叉。
 * opts.allowPluginNodes（导出「实时执行」档）：plugin_ 前缀类型
 * 与内置三类同等放行（包内经 ctx.plugins 注入插件 execute 求值）；
 * 缺省关，判读与此前逐字一致。
 */
export function extractPixelGraph(
  graph: BlueprintGraph,
  opts?: { allowPluginNodes?: boolean },
): PixelGraphExtraction {
  const allowPlugins = !!opts?.allowPluginNodes;
  const warnings: string[] = [];
  const outNode = graph.nodes.find((n) => n.id === graph.outputId)
    ?? graph.nodes.find((n) => n.type === 'screen');
  if (!outNode || outNode.type !== 'screen') return { warnings };
  const pxIn = (outNode.inputs ?? {}).pixels as BlueprintInput | undefined;
  if (!pxIn || !isRef(pxIn)) return { warnings };
  if (pxIn.output !== undefined && pxIn.output !== 'pixels') {
    warnings.push(`screen 的 pixels 输入接在 ${pxIn.output} 输出上（非 pixels），像素链未进包`);
    return { warnings };
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const keep = new Set<string>();
  const stack = [pxIn.nodeId];
  let missing = false;
  while (stack.length) {
    const id = stack.pop()!;
    if (keep.has(id)) continue;
    const node = byId.get(id);
    if (!node) { missing = true; continue; }
    keep.add(id);
    for (const inp of Object.values(node.inputs ?? {})) {
      if (isRef(inp as BlueprintInput)) stack.push((inp as { nodeId: string }).nodeId);
    }
  }
  if (missing) {
    warnings.push('像素链引用了不存在的节点，整链未进包');
    return { warnings };
  }
  const pixelSet = new Set<string>(PIXEL_CHAIN_PIXEL_TYPES as readonly string[]);
  const numericSet = new Set<string>(PIXEL_CHAIN_NUMERIC_TYPES as readonly string[]);
  let unsupported = false;
  for (const id of keep) {
    const node = byId.get(id)!;
    if (node.type === 'sprite_source' || pixelSet.has(node.type) || numericSet.has(node.type)
      || (allowPlugins && node.type.startsWith('plugin_'))) continue;
    unsupported = true;
    if (node.type === 'costume' || node.type === 'character_source') {
      warnings.push(`像素链含 ${node.type} 节点（跨图读像素），v1 不支持，整链未进包`);
    } else {
      warnings.push(`像素链节点 ${node.id}（${nodeTypeDisplayName(node.type)}）不在运行时支持集，整链未进包`);
    }
  }
  if (unsupported) return { warnings, rejectedChain: { endpoint: pxIn.nodeId, nodeIds: [...keep] } };
  const nodes: RuntimePixelGraph['nodes'] = [];
  for (const id of keep) {
    const node = byId.get(id)!;
    const inputs: NonNullable<RuntimePixelGraph['nodes'][number]['inputs']> = {};
    for (const [port, inp] of Object.entries(node.inputs ?? {})) {
      const input = inp as BlueprintInput;
      if (isRef(input)) {
        inputs[port] = { n: input.nodeId, ...(input.output ? { o: input.output } : {}) };
        continue;
      }
      const lit = input as unknown as { type?: string; value?: unknown };
      if (lit.type === 'number' && typeof lit.value === 'number') inputs[port] = { v: lit.value };
      else if (lit.type === 'boolean') inputs[port] = { v: lit.value ? 1 : 0 };
      else if (lit.type === 'string' && typeof lit.value === 'string') inputs[port] = { s: lit.value };
      else {
        warnings.push(`像素链节点 ${node.id} 的输入 ${port} 是 ${lit.type ?? '未知'} 字面值，整链未进包`);
        return { warnings };
      }
    }
    const mini: RuntimePixelGraph['nodes'][number] = {
      id: node.id, type: node.type,
      ...(node.params && Object.keys(node.params).length ? { params: node.params as Record<string, unknown> } : {}),
      ...(Object.keys(inputs).length ? { inputs } : {}),
    };
    const pts = (node as unknown as { points?: [number, number][] }).points;
    if (node.type === 'curve' && Array.isArray(pts)) mini.points = pts;
    nodes.push(mini);
  }
  return { graph: { nodes, out: pxIn.nodeId }, warnings };
}

/** 帧相关/有状态节点：静态烘焙会把某一帧的状态冻进瓦片，逐类点名拒 */
const BAKE_TYPE_BLACKLIST: Record<string, string> = {
  spring: '有状态（弹簧历史）',
  hold: '与历史相关（保持采样）',
  var: '变量在烘焙时会被冻结',
};

/**
 * 导出「烘焙」档：把一条因含运行时不支持节点而会被整链拒绝的像素链，
 * 在编辑器侧以部件代表图为源静态求值，产出可直接替换代表图的网格。
 * 烘前逐项校验（任一不过回落整链拒绝，reason 区分原因）：
 * - 链起源为 costume / character_source（跨图读源、代表图口径下源不
 *   唯一）拒；
 * - 链中任一节点无求值器（插件未装/已卸——evaluateNodeOutput 对无
 *   求值器节点是静默跳过，不验会烘出残图）拒；
 * - spring / hold / var 三类帧相关/有状态节点拒，其余链在 frame
 *   0/7/23 各以全新 ctx 求值一次、任一输出不一致按「链随帧变化」拒；
 * - 求值抛错、无像素输出、输出尺寸与源图不一致拒。
 * 校验全过才返回 frame 0 的输出（三帧已证一致，取哪帧等价）。
 */
export function bakePixelChainStatic(
  graph: BlueprintGraph,
  chain: { endpoint: string; nodeIds: string[] },
  source: PixelGrid,
  frameRate: number,
): { ok: true; data: PixelGrid } | { ok: false; reason: string } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const known = new Set(listBlueprintNodeTypes());
  for (const id of chain.nodeIds) {
    const node = byId.get(id);
    if (!node) return { ok: false, reason: `链引用了不存在的节点 ${id}` };
    if (node.type === 'costume' || node.type === 'character_source') {
      return { ok: false, reason: `链含 ${node.type} 节点（跨图读源），代表图口径下源不唯一` };
    }
    const bl = BAKE_TYPE_BLACKLIST[node.type];
    if (bl) return { ok: false, reason: `链含 ${node.type} 节点（${bl}）` };
    if (!known.has(node.type)) {
      return { ok: false, reason: `链节点 ${node.id}（${nodeTypeDisplayName(node.type)}）无求值器（插件未安装或已卸载）` };
    }
  }
  const srcW = source[0]?.length ?? 0;
  const srcH = source.length;
  const evalAt = (frame: number): PixelGrid | null => {
    const ctx = { frame, frameRate, vars: {}, spritePixels: source } as unknown as BlueprintEvalContext;
    const out = evaluateNodeOutput(graph, chain.endpoint, ctx);
    const px = out?.pixels;
    return px ? asPixels(px) : null;
  };
  let base: PixelGrid | null;
  try {
    base = evalAt(0);
  } catch (e) {
    return { ok: false, reason: `链求值抛错（${e instanceof Error ? e.message : String(e)}）` };
  }
  if (!base) return { ok: false, reason: '链求值无像素输出' };
  const outW = base[0]?.length ?? 0;
  if (base.length !== srcH || outW !== srcW) {
    return { ok: false, reason: `链输出尺寸 ${outW}×${base.length} 与源图 ${srcW}×${srcH} 不一致` };
  }
  const baseJson = JSON.stringify(base);
  for (const f of [7, 23]) {
    let g: PixelGrid | null;
    try {
      g = evalAt(f);
    } catch (e) {
      return { ok: false, reason: `链求值抛错（${e instanceof Error ? e.message : String(e)}）` };
    }
    if (!g || JSON.stringify(g) !== baseJson) {
      return { ok: false, reason: '链随帧变化（多帧求值结果不一致）' };
    }
  }
  return { ok: true, data: base };
}
