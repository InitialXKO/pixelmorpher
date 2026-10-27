// ============================================================
// 动态图案 ↔ 蓝图统一（甲案）：图案实例落成 node.blueprint 里的
// dynamic_pattern 节点，渲染/进包只从图解析图案（与修改器同一套
// 「列表是编辑模型、图是渲染 IR」架构）。
//
// - 实例 → 节点 id：dyn_<实例id>（与 mod_<修改器id> 同约定）
// - 节点 params：图案参数平铺 + 元数据键（__instanceId/__slot/
//   __mount/__setId/__templateName/__patternRef/__overridesJson）
// - 同步是手术式的：只增删改 dyn_ 节点，保留其 inputs（用户接线）
//   与 ui、以及图里的一切其他节点（蓝图铁律）
// - 接线覆盖：编辑器渲染时，节点 inputs 里与参数同名的数值接线
//   覆盖 params（与 extractPixelModifiers 同口径）；进包侧图案是
//   静态数据，接线不进包（按 params 固化，见 convert 调用点）
// ============================================================

import type { BlueprintGraph, BlueprintNode } from './ir';
import type { Character } from '../unified-types';
import {
  normalizeDynamicParams,
  resolveDynamicPatterns,
  type DynamicPatternInstance,
  type ResolvedDynamicPattern,
} from '../dynamic-patterns';
import { modifiersToBlueprint } from './migrate';

export const DYNAMIC_PATTERN_NODE_TYPE = 'dynamic_pattern';

const META_KEYS = new Set([
  '__instanceId', '__slot', '__mount', '__setId',
  '__templateName', '__patternRef', '__overridesJson',
]);

export function dynNodeId(instanceId: string): string {
  return `dyn_${instanceId.replace(/-/g, '').slice(0, 16)}`;
}

export interface PatternMount {
  mount: 'node' | 'piece';
  /** mount='piece' 时所属服装集 id */
  setId?: string;
}

export interface DesiredPattern {
  inst: DynamicPatternInstance;
  mount: PatternMount;
}

/** 实例 → 蓝图节点（新建时 inputs 为空，用户可在图里接线） */
export function patternNodeForInstance(inst: DynamicPatternInstance, mount: PatternMount): BlueprintNode {
  const params: BlueprintNode['params'] = {
    enabled: inst.enabled,
    __instanceId: inst.id,
    __slot: inst.slot,
    __mount: mount.mount,
  };
  if (mount.setId) params.__setId = mount.setId;
  if (inst.templateName) params.__templateName = inst.templateName;
  if (inst.patternRef) params.__patternRef = `${inst.patternRef.id}@${inst.patternRef.version}`;
  if (inst.overrides) params.__overridesJson = JSON.stringify(inst.overrides);
  for (const [k, v] of Object.entries(inst.params)) {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') params[k] = v;
    // 非标量参数（glowMask / glowShapeKernel 等 GlowMaskData）以
    // __json_<键> 存 JSON 串，解码端还原——保证实例↔节点无损往返
    else if (v !== undefined && v !== null) params[`__json_${k}`] = JSON.stringify(v);
  }
  return { id: dynNodeId(inst.id), type: DYNAMIC_PATTERN_NODE_TYPE, inputs: {}, params };
}

/** 蓝图节点 → 实例（非图案节点/缺元数据返回 null） */
export function instanceFromPatternNode(node: BlueprintNode): DesiredPattern | null {
  if (node.type !== DYNAMIC_PATTERN_NODE_TYPE) return null;
  const p = node.params;
  const instanceId = p.__instanceId;
  const slot = p.__slot;
  if (typeof instanceId !== 'string' || typeof slot !== 'string') return null;
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (META_KEYS.has(k) || k === 'enabled') continue;
    if (k.startsWith('__json_')) {
      try { raw[k.slice(7)] = JSON.parse(v as string); } catch { /* 损坏的 JSON 参数忽略 */ }
      continue;
    }
    raw[k] = v;
  }
  const inst: DynamicPatternInstance = {
    id: instanceId,
    slot,
    enabled: p.enabled !== false,
    params: normalizeDynamicParams(raw as never),
  };
  if (typeof p.__templateName === 'string') inst.templateName = p.__templateName;
  if (typeof p.__patternRef === 'string') {
    const at = p.__patternRef.lastIndexOf('@');
    if (at > 0) inst.patternRef = { id: p.__patternRef.slice(0, at), version: Number(p.__patternRef.slice(at + 1)) || 0 };
  }
  if (typeof p.__overridesJson === 'string') {
    try { inst.overrides = JSON.parse(p.__overridesJson); } catch { /* 损坏的覆盖串忽略 */ }
  }
  const mount: PatternMount = p.__mount === 'piece'
    ? { mount: 'piece', setId: typeof p.__setId === 'string' ? p.__setId : undefined }
    : { mount: 'node' };
  return { inst, mount };
}

/**
 * 手术式同步：把 desired 里的实例镜像进图（按 dyn 节点 id 对账：
 * 新增/更新 params——保留已有节点的 inputs 与 ui；删除不在
 * desired 里的 dyn 节点）。其他节点一律不动。
 */
export function syncPatternNodes(bp: BlueprintGraph, desired: DesiredPattern[]): BlueprintGraph {
  const want = new Map(desired.map((d) => [dynNodeId(d.inst.id), d]));
  const nodes: BlueprintNode[] = [];
  const seen = new Set<string>();
  for (const n of bp.nodes) {
    if (n.type === DYNAMIC_PATTERN_NODE_TYPE) {
      const d = want.get(n.id);
      if (!d) continue; // 实例已删 → 节点删
      seen.add(n.id);
      const fresh = patternNodeForInstance(d.inst, d.mount);
      nodes.push({ ...n, params: fresh.params });
    } else {
      nodes.push(n);
    }
  }
  for (const [id, d] of want) {
    if (seen.has(id)) continue;
    const fresh = patternNodeForInstance(d.inst, d.mount);
    // 新节点摆在 screen 之前（视觉上靠近输出，与修改器插入位一致）
    const screenIdx = nodes.findIndex((n) => n.type === 'screen');
    if (screenIdx >= 0) nodes.splice(screenIdx, 0, fresh);
    else nodes.push(fresh);
  }
  return { ...bp, nodes };
}

/** 最小可用图（time + sprite_source + screen 直通）：无修改器无蓝图但有图案时用 */
export function minimalPatternBlueprint(): BlueprintGraph {
  const timeId = 'time_pattern_min';
  const sourceId = 'source_pattern_min';
  const screenId = 'screen_pattern_min';
  return {
    version: 1,
    outputId: screenId,
    nodes: [
      { id: timeId, type: 'time', inputs: {}, params: {} },
      { id: sourceId, type: 'sprite_source', inputs: {}, params: {} },
      { id: screenId, type: 'screen', inputs: { pixels: { nodeId: sourceId, output: 'pixels' } }, params: {} },
    ],
  };
}

type NodeLike = {
  blueprint?: BlueprintGraph | null;
  modifiers?: unknown;
  dynamicPatterns?: DynamicPatternInstance[];
  slot?: { slotKey?: string } | null;
  id: string;
};

/** 某节点应有的全部图案实例（节点挂载 + 各服装集的件挂载） */
export function collectDesiredPatterns(character: Character, node: NodeLike): DesiredPattern[] {
  const out: DesiredPattern[] = [];
  for (const inst of node.dynamicPatterns ?? []) out.push({ inst, mount: { mount: 'node' } });
  const slotKey = node.slot?.slotKey ?? node.id;
  for (const cs of character.costumeSets ?? []) {
    const piece = cs.pieces?.[slotKey];
    for (const inst of piece?.dynamicPatterns ?? []) {
      out.push({ inst, mount: { mount: 'piece', setId: cs.id } });
    }
  }
  // 图内既存的 dyn 节点同为一等公民（蓝图编辑器里手加/手改的）：
  // 列表没有的并入 desired（按实例 id 去重，列表版本优先——列表
  // 是面板编辑模型，图内手改在下一次列表编辑同步时以列表为准）
  if (node.blueprint) {
    const have = new Set(out.map((d) => d.inst.id));
    for (const n of node.blueprint.nodes) {
      const d = instanceFromPatternNode(n);
      if (d && !have.has(d.inst.id)) out.push(d);
    }
  }
  return out;
}

/**
 * 生效图（读侧）：node.blueprint ?? 修改器生成 ?? 最小图，最后把
 * 图案实例临时镜像进去（不落盘）。落盘同步在 store 的图案编辑
 * 路径与工程加载迁移里做；此函数保证任何数据形态下渲染/进包
 * 读到的都是「图里的图案」。
 */
export function effectivePatternGraph(character: Character, node: NodeLike): BlueprintGraph | null {
  const desired = collectDesiredPatterns(character, node);
  const base = node.blueprint
    ?? modifiersToBlueprint((node.modifiers ?? []) as never)
    ?? (desired.length > 0 ? minimalPatternBlueprint() : null);
  if (!base) return null;
  if (desired.length === 0 && !base.nodes.some((n) => n.type === DYNAMIC_PATTERN_NODE_TYPE)) return base;
  return syncPatternNodes(base, desired);
}

/**
 * 从图提取图案实例（按挂载分列）。evalNodeOutput 可选：编辑器
 * 渲染时传入蓝图求值函数，接线参数（数值）覆盖 params、gate
 * 接线 <0.5 视作本帧关闭；不传 = 纯静态 params（进包口径）。
 */
export function extractPatternInstances(
  graph: BlueprintGraph,
  evalNodeOutput?: (nodeId: string) => Record<string, unknown> | null,
): { nodeList: DynamicPatternInstance[]; pieceListBySet: Map<string, DynamicPatternInstance[]> } {
  const nodeList: DynamicPatternInstance[] = [];
  const pieceListBySet = new Map<string, DynamicPatternInstance[]>();
  for (const node of graph.nodes) {
    const d = instanceFromPatternNode(node);
    if (!d) continue;
    let inst = d.inst;
    if (evalNodeOutput) {
      const wired: Record<string, number> = {};
      let gateOff = false;
      for (const [port, input] of Object.entries(node.inputs)) {
        if (port === 't' || !input || typeof input !== 'object' || !('nodeId' in input)) continue;
        const outs = evalNodeOutput((input as { nodeId: string }).nodeId);
        const v = outs?.[(input as { output?: string }).output ?? 'out'];
        if (typeof v === 'number') {
          if (port === 'gate') { if (v < 0.5) gateOff = true; }
          else wired[port] = v;
        } else if (v && typeof v === 'object' && (v as { type?: string }).type === 'number') {
          const nv = (v as { value?: number }).value;
          if (typeof nv === 'number') {
            if (port === 'gate') { if (nv < 0.5) gateOff = true; }
            else wired[port] = nv;
          }
        }
      }
      if (gateOff) inst = { ...inst, enabled: false };
      if (Object.keys(wired).length > 0) {
        inst = { ...inst, params: normalizeDynamicParams({ ...inst.params, ...wired } as never) };
      }
    }
    if (d.mount.mount === 'piece') {
      const key = d.mount.setId ?? '';
      const arr = pieceListBySet.get(key) ?? [];
      arr.push(inst);
      pieceListBySet.set(key, arr);
    } else {
      nodeList.push(inst);
    }
  }
  return { nodeList, pieceListBySet };
}

/**
 * 统一解析入口（渲染/进包共用）：从生效图取实例 → 走既有双挂载
 * 合并口径（同效果位件挂载替换/压制节点挂载）。
 * evalNodeOutput 同 extractPatternInstances。
 */
export function resolveGraphPatterns(
  character: Character,
  node: NodeLike,
  activeSetId: string | undefined,
  evalNodeOutput?: (nodeId: string) => Record<string, unknown> | null,
): ResolvedDynamicPattern[] {
  const graph = effectivePatternGraph(character, node);
  if (!graph) {
    // 无图也无图案的常态零开销路径
    return resolveDynamicPatterns(node.dynamicPatterns, undefined);
  }
  return resolvePatternsFromGraph(graph, activeSetId, evalNodeOutput);
}

/** 已有生效图时直接解析（调用方已算好图，避免重复同步） */
export function resolvePatternsFromGraph(
  graph: BlueprintGraph,
  activeSetId: string | undefined,
  evalNodeOutput?: (nodeId: string) => Record<string, unknown> | null,
): ResolvedDynamicPattern[] {
  const { nodeList, pieceListBySet } = extractPatternInstances(graph, evalNodeOutput);
  const pieceList = activeSetId ? pieceListBySet.get(activeSetId) : undefined;
  return resolveDynamicPatterns(nodeList, pieceList);
}

/**
 * 角色级落盘同步（store 图案编辑路径与工程加载迁移共用）：
 * 每个节点的蓝图镜像其图案实例。createMissing=false 时只同步
 * 已有蓝图的节点（加载迁移口径：无蓝图节点由读侧生成覆盖）。
 */
export function syncCharacterPatternBlueprints<T extends Character>(character: T, createMissing: boolean): T {
  let changed = false;
  const nodes: Record<string, unknown> = {};
  for (const node of Object.values(character.nodes)) {
    const n = node as NodeLike;
    const desired = collectDesiredPatterns(character, n);
    if (!n.blueprint && !createMissing) { nodes[node.id] = node; continue; }
    if (!n.blueprint && desired.length === 0) { nodes[node.id] = node; continue; }
    const base = n.blueprint
      ?? modifiersToBlueprint((n.modifiers ?? []) as never)
      ?? minimalPatternBlueprint();
    const synced = syncPatternNodes(base, desired);
    if (synced !== n.blueprint) {
      nodes[node.id] = { ...node, blueprint: synced };
      changed = true;
    } else {
      nodes[node.id] = node;
    }
  }
  return changed ? { ...character, nodes } as T : character;
}
