// ============================================================
// 刀光 ↔ 蓝图统一：表演的刀光规格落成表演图（perf.graphs）里的
// slash_fan 节点，渲染/进包只从图解析刀光（与图案 PR #49 同一套
// 「列表是编辑模型、图是渲染 IR」架构）。
//
// - 归属：ProcPerformance.graphs 是按节点存的表演图集合，整组图
//   同属一个表演——slash_fan 节点落在任一图中即该表演的刀光，
//   无需所有权元数据（与图案件挂载靠 __setId 区分不同）。
// - 面板节点 id 固定 'slashfx'（规格是主人级单例、无实例 id，
//   固定 id 即其身份）；图内其他 id 的 slash_fan 节点为手加的
//   一等公民：解析按「面板节点优先、否则扫描序首个」取一份。
// - 同步是手术式的：只增删改面板节点，保留其 inputs（用户接线）
//   与 ui、以及图里的一切其他节点（蓝图铁律）。
// - 接线覆盖：解析时传入求值回调则节点 inputs 里与参数同名的
//   数值接线覆盖 params、gate<0.5 视作关闭（与图案同口径）；
//   不传 = 纯静态 params（进包口径）。
// - 读侧镜像：数据未落盘同步时（存量未迁移/手改数据），解析把
//   perf.slashEffect 字段视作虚拟面板节点（面板优先），保证任何
//   数据形态下读到的都是同一份刀光；落盘同步在 store 的表演编辑
//   路径与工程加载迁移里做。
//
// 片段（AnimationClip）侧不在本模块范围：片段没有图结构（内容
// 模型是轨道/效果数组），其 slashEffect 维持字段口径——片段侧
// 如何入图待裁决（见 PR #62 正文「并入蓝图」节的分叉说明）。
// ============================================================

import type { BlueprintGraph, BlueprintNode } from './ir';
import type { ProcPerformance } from '../unified-types';
import { defaultSlashSpec, type SlashFanSpec } from '../slash-fan';

export const SLASH_NODE_TYPE = 'slash_fan';

/** 面板规格在图里的节点 id（主人级单例，固定 id 即身份） */
export const PANEL_SLASH_NODE_ID = 'slashfx';

/** 可被接线覆盖的数值参数（anchorNodeId 是字符串，不走接线） */
const NUMERIC_KEYS = [
  'durationSec', 'frameCount', 'w', 'h', 'cx', 'cy',
  'rx', 'ry', 'rotDeg', 'a0Deg', 'sweepDeg', 'thick', 'gammaAng', 'softRad',
] as const;

/** 规格 → 蓝图节点（新建时 inputs 为空，用户可在图里接线） */
export function slashNodeForSpec(spec: SlashFanSpec): BlueprintNode {
  const params: BlueprintNode['params'] = {
    enabled: true,
    anchorNodeId: spec.anchorNodeId,
  };
  for (const k of NUMERIC_KEYS) {
    const v = spec[k];
    if (typeof v === 'number') params[k] = v;
  }
  // colors 是字符串数组（非标量）：以 __json_colors 存 JSON 串，
  // 解码端还原——保证规格↔节点无损往返（与图案 __json_ 同约定）
  if (spec.colors !== undefined) params.__json_colors = JSON.stringify(spec.colors);
  return {
    id: PANEL_SLASH_NODE_ID,
    type: SLASH_NODE_TYPE,
    inputs: {},
    params,
    ui: { x: 180, y: 240 },
  };
}

export interface SlashNodeData {
  spec: SlashFanSpec;
  enabled: boolean;
}

/** 蓝图节点 → 规格（非刀光节点返回 null；缺参以默认规格补齐——
 *  图编辑器手加的空节点也能还原出一份可消费的规格） */
export function specFromSlashNode(node: BlueprintNode): SlashNodeData | null {
  if (node.type !== SLASH_NODE_TYPE) return null;
  const p = node.params;
  const anchorNodeId = typeof p.anchorNodeId === 'string' ? p.anchorNodeId : '';
  const spec = defaultSlashSpec(anchorNodeId);
  for (const k of NUMERIC_KEYS) {
    if (typeof p[k] === 'number') (spec as unknown as Record<string, number>)[k] = p[k] as number;
  }
  if (typeof p.__json_colors === 'string') {
    try {
      const arr = JSON.parse(p.__json_colors);
      if (Array.isArray(arr)) spec.colors = arr.filter((c): c is string => typeof c === 'string');
    } catch { /* 损坏的 JSON 参数忽略（回落内置调色板） */ }
  }
  return { spec, enabled: p.enabled !== false };
}

export interface PerfSlashCandidate {
  /** 所在图的键（nodeId） */
  graphKey: string;
  node: BlueprintNode;
  data: SlashNodeData;
  /** 是否面板节点（固定 id） */
  isPanel: boolean;
}

/** 扫描序：掩码节点序优先，其余图按插入序；图内按节点数组序 */
function orderedGraphKeys(perf: ProcPerformance): string[] {
  const graphs = perf.graphs ?? {};
  const keys: string[] = [];
  for (const id of perf.maskNodeIds ?? []) {
    if (graphs[id] && !keys.includes(id)) keys.push(id);
  }
  for (const k of Object.keys(graphs)) {
    if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

/** 表演图里的全部刀光节点（按扫描序） */
export function collectPerfSlashCandidates(perf: ProcPerformance): PerfSlashCandidate[] {
  const graphs = perf.graphs ?? {};
  const out: PerfSlashCandidate[] = [];
  for (const key of orderedGraphKeys(perf)) {
    const g = graphs[key];
    if (!g) continue;
    for (const node of g.nodes) {
      const data = specFromSlashNode(node);
      if (data) out.push({ graphKey: key, node, data, isPanel: node.id === PANEL_SLASH_NODE_ID });
    }
  }
  return out;
}

type EvalNodeOutput = (
  graph: BlueprintGraph,
  srcNodeId: string,
) => Record<string, unknown> | null;

/**
 * 统一解析入口（渲染/进包共用）：图为唯一出处——面板节点优先，
 * 其次图内手加节点（扫描序首个）；图里没有面板节点但字段还在
 * （未落盘同步的数据）时字段作虚拟面板节点（面板优先）。
 * evalNodeOutput 可选：传入则对选中节点施加接线覆盖（数值参数 +
 * gate），口径与图案 extractPatternInstances 一致；进包不传。
 */
export function resolvePerfSlash(
  perf: ProcPerformance,
  evalNodeOutput?: EvalNodeOutput,
): SlashFanSpec | undefined {
  const candidates = collectPerfSlashCandidates(perf);
  const panel = candidates.find((c) => c.isPanel);
  if (perf.slashEffect && !panel) return perf.slashEffect;
  const chosen = panel ?? candidates[0];
  if (!chosen || !chosen.data.enabled) return undefined;
  let spec: SlashFanSpec = chosen.data.spec;
  if (evalNodeOutput) {
    const graph = (perf.graphs ?? {})[chosen.graphKey];
    if (graph) {
      const wired: Record<string, number> = {};
      let gateOff = false;
      for (const [port, input] of Object.entries(chosen.node.inputs)) {
        if (port === 't' || !input || typeof input !== 'object' || !('nodeId' in input)) continue;
        const ref = input as { nodeId: string; output?: string };
        const outs = evalNodeOutput(graph, ref.nodeId);
        const v = outs?.[ref.output ?? 'out'];
        let num: number | undefined;
        if (typeof v === 'number') num = v;
        else if (v && typeof v === 'object' && (v as { type?: string }).type === 'number') {
          const nv = (v as { value?: number }).value;
          if (typeof nv === 'number') num = nv;
        }
        if (num === undefined) continue;
        if (port === 'gate') { if (num < 0.5) gateOff = true; }
        else if ((NUMERIC_KEYS as readonly string[]).includes(port)) wired[port] = num;
      }
      if (gateOff) return undefined;
      if (Object.keys(wired).length > 0) spec = { ...spec, ...wired };
    }
  }
  return spec;
}

/** 面板节点落点图的最小骨架（与 BehaviorPanel 创建表演图同形） */
function minimalSlashHostGraph(slashNode: BlueprintNode): BlueprintGraph {
  return {
    version: 1,
    outputId: 'out',
    nodes: [
      { id: 't', type: 'time', inputs: {}, params: {}, ui: { x: 40, y: 120 } },
      { id: 'out', type: 'transform', inputs: {}, params: {}, ui: { x: 320, y: 120 } },
      slashNode,
    ],
  };
}

/**
 * 手术式同步：把 perf.slashEffect（编辑模型）镜像进表演图。
 * 只动面板节点：参数更新保留其 inputs/ui；锚点变更则整节点迁图
 * （接线与布局随行）；规格删除则节点删除。其他节点一律不动，
 * 无变化时返回原 perf 引用。
 */
export function syncPerfSlash(perf: ProcPerformance): ProcPerformance {
  const desired = perf.slashEffect;
  const graphs = perf.graphs ?? {};
  // 定位现有面板节点
  let loc: { key: string; idx: number; node: BlueprintNode } | undefined;
  for (const key of Object.keys(graphs)) {
    const idx = graphs[key]!.nodes.findIndex(
      (n) => n.id === PANEL_SLASH_NODE_ID && n.type === SLASH_NODE_TYPE);
    if (idx >= 0) { loc = { key, idx, node: graphs[key]!.nodes[idx]! }; break; }
  }

  if (!desired) {
    if (!loc) return perf;
    const g = graphs[loc.key]!;
    return {
      ...perf,
      graphs: {
        ...graphs,
        [loc.key]: { ...g, nodes: g.nodes.filter((_, i) => i !== loc!.idx) },
      },
    };
  }

  const fresh = slashNodeForSpec(desired);
  const hostKey = desired.anchorNodeId || loc?.key || Object.keys(graphs)[0];
  if (!hostKey) return perf; // 无任何图且锚点为空：无处落，读侧镜像兜底

  // 已在目标图且参数一致 → 无变化
  if (loc && loc.key === hostKey
    && JSON.stringify(loc.node.params) === JSON.stringify(fresh.params)) {
    return perf;
  }

  let next: Record<string, BlueprintGraph> = graphs;
  const put = (key: string, g: BlueprintGraph) => {
    if (next === graphs) next = { ...graphs };
    next[key] = g;
  };
  // 锚点变更：从旧图摘下（保留其 inputs/ui 随行到新图）
  let carried: BlueprintNode | undefined;
  if (loc && loc.key !== hostKey) {
    carried = loc.node;
    const g = next[loc.key]!;
    put(loc.key, { ...g, nodes: g.nodes.filter((_, i) => i !== loc!.idx) });
  }
  const host = next[hostKey];
  if (!host) {
    put(hostKey, minimalSlashHostGraph(
      carried ? { ...carried, params: fresh.params } : fresh));
  } else {
    const idx = host.nodes.findIndex(
      (n) => n.id === PANEL_SLASH_NODE_ID && n.type === SLASH_NODE_TYPE);
    if (idx >= 0) {
      const nodes = host.nodes.slice();
      nodes[idx] = { ...nodes[idx]!, params: fresh.params };
      put(hostKey, { ...host, nodes });
    } else {
      const node = carried ? { ...carried, params: fresh.params } : fresh;
      put(hostKey, { ...host, nodes: [...host.nodes, node] });
    }
  }
  return next === graphs ? perf : { ...perf, graphs: next };
}

/**
 * 角色级落盘同步（store 表演编辑路径与工程加载迁移共用）：
 * 每个表演的图镜像其刀光规格。无变化时返回原角色引用。
 */
export function syncCharacterSlashBlueprints<T extends { performances?: ProcPerformance[] }>(
  character: T,
): T {
  const perfs = character.performances;
  if (!perfs || perfs.length === 0) return character;
  let changed = false;
  const next = perfs.map((p) => {
    const s = syncPerfSlash(p);
    if (s !== p) changed = true;
    return s;
  });
  return changed ? { ...character, performances: next } : character;
}

/**
 * 去刀光节点的图（convert 表演图采样烘焙前用）：刀光不是姿态
 * 内容，已由 resolvePerfSlash 单独提取，翻译前摘除以免采样路把
 * 它当不支持节点点名。无刀光节点时返回原图引用；摘空返回空图。
 */
export function graphWithoutSlashNodes(graph: BlueprintGraph): BlueprintGraph {
  if (!graph.nodes.some((n) => n.type === SLASH_NODE_TYPE)) return graph;
  return { ...graph, nodes: graph.nodes.filter((n) => n.type !== SLASH_NODE_TYPE) };
}
