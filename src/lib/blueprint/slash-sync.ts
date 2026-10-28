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
// 共享定义（角色级 character.slashDefs，见 lib/slash-defs）：绑定
// 定义的表演（perf.slashDefId），其面板节点是「引用形态」——只带
// __defId 参数、绝不镜像定义规格；resolvePerfSlash 先解引用得
// 规格、再叠该节点的接线覆盖；syncPerfSlash 对绑定表演只维护
// 引用形态（定义内容变化与同步无关——活引用，同步零改动返回）。
// 片段（AnimationClip）侧没有图结构，其绑定直接存片段字段、经
// slash-defs 的 resolveClipSlash 与预览/进包同源解引用。
// ============================================================

import type { BlueprintGraph, BlueprintNode } from './ir';
import type { ProcPerformance, SlashDefinition } from '../unified-types';
import { defaultSlashSpec, type SlashFanSpec } from '../slash-fan';
import { findSlashDef } from '../slash-defs';

export const SLASH_NODE_TYPE = 'slash_fan';

/** 引用形态节点的定义 id 参数键（与 __json_colors 同 __ 前缀约定） */
export const SLASH_DEF_PARAM = '__defId';

/** 引用形态的面板节点：只带定义 id，不含任何规格参数 */
export function slashRefNodeForDef(defId: string): BlueprintNode {
  return {
    id: PANEL_SLASH_NODE_ID,
    type: SLASH_NODE_TYPE,
    inputs: {},
    params: { enabled: true, [SLASH_DEF_PARAM]: defId },
    ui: { x: 180, y: 240 },
  };
}

/** 节点是否为引用形态、引用的是哪份定义（非引用节点返回 undefined） */
export function defIdFromSlashNode(node: BlueprintNode): string | undefined {
  if (node.type !== SLASH_NODE_TYPE) return undefined;
  const v = node.params[SLASH_DEF_PARAM];
  return typeof v === 'string' && v ? v : undefined;
}

/** 面板规格在图里的节点 id（主人级单例，固定 id 即身份） */
export const PANEL_SLASH_NODE_ID = 'slashfx';

/** 可被接线覆盖的数值参数（anchorNodeId 是字符串，不走接线） */
const NUMERIC_KEYS = [
  'durationSec', 'frameCount', 'w', 'h', 'cx', 'cy', 'dir',
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
  // 引用形态节点不带规格（规格在共享定义里），不作规格候选
  if (defIdFromSlashNode(node) !== undefined) return null;
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
  /** 规格数据；引用形态节点为 null（规格在共享定义里） */
  data: SlashNodeData | null;
  /** 是否面板节点（固定 id） */
  isPanel: boolean;
  /** 引用形态：所引用的共享定义 id（规格形态为 undefined） */
  refDefId?: string;
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
      const refDefId = defIdFromSlashNode(node);
      if (refDefId !== undefined) {
        out.push({ graphKey: key, node, data: null, isPanel: node.id === PANEL_SLASH_NODE_ID, refDefId });
        continue;
      }
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

/** 接线覆盖：对选定节点 inputs 施加求值覆盖（数值参数 + gate），
 *  口径与图案 extractPatternInstances 一致；无求值回调时按静态
 *  规格原样返回（进包口径）。gate 关闭返回 undefined */
function applySlashWiring(
  chosen: PerfSlashCandidate,
  spec: SlashFanSpec,
  perf: ProcPerformance,
  evalNodeOutput?: EvalNodeOutput,
): SlashFanSpec | undefined {
  if (!evalNodeOutput) return spec;
  const graph = (perf.graphs ?? {})[chosen.graphKey];
  if (!graph) return spec;
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
  if (Object.keys(wired).length > 0) return { ...spec, ...wired };
  return spec;
}

/**
 * 统一解析入口（渲染/进包共用）：图为唯一出处——面板节点优先，
 * 其次图内手加节点（扫描序首个）；图里没有面板节点但字段还在
 * （未落盘同步的数据）时字段作虚拟面板节点（面板优先）。
 * 绑定共享定义时：引用形态面板节点（或未落盘的绑定字段）先活
 * 解引用（defs 为角色 slashDefs），再叠接线覆盖；悬空引用一律
 * 无刀光（不回落私有字段冒充，convert 侧点名）。
 * evalNodeOutput 可选：传入则对选中节点施加接线覆盖（数值参数 +
 * gate）；进包不传。
 */
export function resolvePerfSlash(
  perf: ProcPerformance,
  evalNodeOutput?: EvalNodeOutput,
  defs?: readonly SlashDefinition[],
): SlashFanSpec | undefined {
  const candidates = collectPerfSlashCandidates(perf);
  const panel = candidates.find((c) => c.isPanel);
  // 引用形态面板节点：解引用 → 接线覆盖
  if (panel?.refDefId) {
    if (panel.node.params.enabled === false) return undefined;
    const def = findSlashDef(defs, panel.refDefId);
    if (!def) return undefined;
    return applySlashWiring(panel, def.spec, perf, evalNodeOutput);
  }
  // 绑定字段（未落盘同步的读侧镜像）：活引用定义
  if (perf.slashDefId) {
    return findSlashDef(defs, perf.slashDefId)?.spec;
  }
  if (perf.slashEffect && !panel) return perf.slashEffect;
  const chosen = panel ?? candidates[0];
  if (!chosen || !chosen.data || !chosen.data.enabled) return undefined;
  return applySlashWiring(chosen, chosen.data.spec, perf, evalNodeOutput);
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
 * 绑定共享定义时（perf.slashDefId）：只维护引用形态——面板节点
 * 参数收成 { enabled, __defId }，绝不把定义规格镜像进来；已是
 * 同 id 引用形态时与未绑定同口径返回原引用（定义内容的变化属
 * 活引用，不经本同步、也不触发本同步的任何改动）。
 */
export function syncPerfSlash(
  perf: ProcPerformance,
  defs?: readonly SlashDefinition[],
): ProcPerformance {
  const desired = perf.slashEffect;
  const bindId = perf.slashDefId;
  const graphs = perf.graphs ?? {};
  // 定位现有面板节点
  let loc: { key: string; idx: number; node: BlueprintNode } | undefined;
  for (const key of Object.keys(graphs)) {
    const idx = graphs[key]!.nodes.findIndex(
      (n) => n.id === PANEL_SLASH_NODE_ID && n.type === SLASH_NODE_TYPE);
    if (idx >= 0) { loc = { key, idx, node: graphs[key]!.nodes[idx]! }; break; }
  }

  if (!desired && !bindId) {
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

  let fresh: BlueprintNode;
  let hostKey: string | undefined;
  if (bindId) {
    fresh = slashRefNodeForDef(bindId);
    // 既有节点的 enabled 保留（图内关掉的引用同步不擅自打开）
    if (loc) fresh = { ...fresh, params: { ...fresh.params, enabled: loc.node.params.enabled !== false } };
    const def = findSlashDef(defs, bindId);
    hostKey = loc?.key
      ?? (def && graphs[def.spec.anchorNodeId] ? def.spec.anchorNodeId : undefined)
      ?? Object.keys(graphs)[0];
  } else {
    fresh = slashNodeForSpec(desired!);
    hostKey = desired!.anchorNodeId || loc?.key || Object.keys(graphs)[0];
  }
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
export function syncCharacterSlashBlueprints<T extends { performances?: ProcPerformance[]; slashDefs?: SlashDefinition[] }>(
  character: T,
): T {
  const perfs = character.performances;
  if (!perfs || perfs.length === 0) return character;
  let changed = false;
  const next = perfs.map((p) => {
    const s = syncPerfSlash(p, character.slashDefs);
    if (s !== p) changed = true;
    return s;
  });
  return changed ? { ...character, performances: next } : character;
}

/**
 * 刀光中心语义迁移（2026-10-28，一次性、幂等；store 导入链以
 * slashCenterVersion 标记门控）：旧语义 cx/cy 是帧画布坐标兼任
 * 对位点，任何规格渲染出的扇面相对锚点偏移恒为 0；新语义 cx/cy
 * 是椭圆中心相对锚点的偏移——存量规格一律 cx/cy 归零即逐像素
 * 保真（帧尺寸随覆盖盒新定义变化、画面相对锚点不变）。
 * 覆盖全部存量住所：角色共享定义、表演字段（编辑模型）、表演图
 * 规格形态节点 params（引用形态节点不存规格、跳过；手加节点同
 * 为旧数据、一并归零）、片段字段。就地改写，返回归零份数。
 */
export function migrateSlashCenterOffsets(
  characters: Record<string, {
    slashDefs?: SlashDefinition[];
    performances?: ProcPerformance[];
  }>,
  clips: readonly { slashEffect?: SlashFanSpec }[],
): number {
  let n = 0;
  const fixSpec = (spec: SlashFanSpec | undefined): void => {
    if (!spec) return;
    if (spec.cx !== 0 || spec.cy !== 0) { spec.cx = 0; spec.cy = 0; n++; }
  };
  for (const ch of Object.values(characters)) {
    for (const d of ch.slashDefs ?? []) fixSpec(d.spec);
    for (const perf of ch.performances ?? []) {
      fixSpec(perf.slashEffect);
      for (const g of Object.values(perf.graphs ?? {})) {
        for (const node of g.nodes) {
          if (node.type !== SLASH_NODE_TYPE) continue;
          if (defIdFromSlashNode(node) !== undefined) continue;
          let touched = false;
          if (typeof node.params.cx === 'number' && node.params.cx !== 0) { node.params.cx = 0; touched = true; }
          if (typeof node.params.cy === 'number' && node.params.cy !== 0) { node.params.cy = 0; touched = true; }
          if (touched) n++;
        }
      }
    }
  }
  for (const c of clips) fixSpec(c.slashEffect);
  return n;
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
