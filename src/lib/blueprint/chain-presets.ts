// ============================================================
// 链预设（甲4）：库 chain 条目的插入 / 打包 / 修改器化（纯函数）
// - 插入：把预设段手术式串进节点蓝图的 screen 之前（原像素来源 →
//   预设段 → screen），数值包络的 '@time' 哨兵接到图的时间节点。
// - 打包：从某个像素节点出发反向收集它到精灵源之间的像素链及喂它
//   的数值子树，存成 ChainEntryDef（时间引用折成 '@time' 哨兵、
//   链头像素入口折成 '@in' 哨兵）。
// - 修改器化：单像素节点的预设可落成修改器参数预设（包络取峰值，
//   持续型；多像素节点链不支持，返回 undefined）。
// 节点类型一律校验像素链支持集，保证插入/打包的链进包可真跑。
// ============================================================

import type { BlueprintGraph, BlueprintNode, BlueprintInput, BlueprintInputRef } from './ir';
import type { ChainEntryDef } from '../library-entries';
import { PIXEL_CHAIN_PIXEL_TYPES, PIXEL_CHAIN_NUMERIC_TYPES } from '../proc-runtime/pixel-src';

const PIXEL_SET = new Set<string>(PIXEL_CHAIN_PIXEL_TYPES);
const NUMERIC_SET = new Set<string>(PIXEL_CHAIN_NUMERIC_TYPES);

function isRef(inp: BlueprintInput | undefined): inp is BlueprintInputRef {
  return typeof inp === 'object' && inp !== null && 'nodeId' in inp;
}

function cloneNode(n: BlueprintNode): BlueprintNode {
  return {
    ...n,
    params: { ...n.params },
    inputs: Object.fromEntries(
      Object.entries(n.inputs).map(([k, v]) => [k, isRef(v) ? { ...v } : v]),
    ),
    ui: n.ui ? { ...n.ui } : undefined,
  };
}

/** 预设段的节点类型是否全在像素链支持集内（返回第一个不支持的类型） */
export function chainDefUnsupportedType(def: ChainEntryDef): string | undefined {
  for (const n of def.nodes) {
    if (!PIXEL_SET.has(n.type) && !NUMERIC_SET.has(n.type)) return n.type;
  }
  return undefined;
}

// ---------------- 插入 ----------------

export type InsertChainResult =
  | { ok: true; graph: BlueprintGraph; insertedIds: string[] }
  | { ok: false; error: string };

export function insertChainSegment(
  bp: BlueprintGraph, def: ChainEntryDef, prefix: string,
): InsertChainResult {
  const bad = chainDefUnsupportedType(def);
  if (bad) return { ok: false, error: `预设含像素链不支持的节点类型「${bad}」，不能插入` };
  if (!def.nodes.some((n) => Object.values(n.inputs).some((i) => isRef(i) && i.nodeId === '@in'))) {
    return { ok: false, error: '预设缺少段入口（@in），不能插入' };
  }
  const entryDef = def.nodes.find((n) => n.id === def.entry);
  if (!entryDef || !PIXEL_SET.has(entryDef.type)) {
    return { ok: false, error: '预设的像素出口节点无效，不能插入' };
  }

  const nodes = bp.nodes.map(cloneNode);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const screen = nodes.find((n) => n.id === bp.outputId && n.type === 'screen')
    ?? nodes.find((n) => n.type === 'screen');
  if (!screen) return { ok: false, error: '图中没有 screen 节点，无处插入' };

  // 时间节点：没有就补一个（数值包络的时间来源）
  let timeNode = nodes.find((n) => n.type === 'time');
  if (!timeNode) {
    timeNode = {
      id: 'time', type: 'time', inputs: {}, params: {},
      ui: { x: (screen.ui?.x ?? 600) - 520, y: (screen.ui?.y ?? 40) + 160 },
    };
    if (byId.has(timeNode.id)) timeNode.id = 'time_chain';
    nodes.push(timeNode);
    byId.set(timeNode.id, timeNode);
  }

  // 原像素来源：screen 已接的 → 精灵源 → 拒绝
  let prevPixels: BlueprintInputRef | undefined;
  if (isRef(screen.inputs.pixels)) prevPixels = screen.inputs.pixels;
  else {
    const src = nodes.find((n) => n.type === 'sprite_source');
    if (src) prevPixels = { nodeId: src.id, output: 'pixels' };
  }
  if (!prevPixels) return { ok: false, error: '找不到像素来源（screen 未接像素且图中无精灵源）' };

  // id 重映射（prefix_局部id，撞名加序号）
  const idMap = new Map<string, string>();
  for (const dn of def.nodes) {
    let cand = `${prefix}_${dn.id}`;
    let k = 2;
    while (byId.has(cand) || [...idMap.values()].includes(cand)) cand = `${prefix}_${dn.id}_${k++}`;
    idMap.set(dn.id, cand);
  }

  const baseX = (screen.ui?.x ?? 600) - 300;
  const baseY = screen.ui?.y ?? 40;
  const insertedIds: string[] = [];
  for (const dn of def.nodes) {
    const nn = cloneNode(dn);
    nn.id = idMap.get(dn.id)!;
    for (const [key, inp] of Object.entries(nn.inputs)) {
      if (!isRef(inp)) continue;
      if (inp.nodeId === '@in') nn.inputs[key] = { ...prevPixels };
      else if (inp.nodeId === '@time') nn.inputs[key] = { nodeId: timeNode.id, output: 'out' };
      else if (idMap.has(inp.nodeId)) nn.inputs[key] = { ...inp, nodeId: idMap.get(inp.nodeId)! };
    }
    nn.ui = { x: baseX + (dn.ui?.x ?? 0), y: baseY + (dn.ui?.y ?? 0) };
    nodes.push(nn);
    byId.set(nn.id, nn);
    insertedIds.push(nn.id);
  }

  screen.inputs = { ...screen.inputs, pixels: { nodeId: idMap.get(def.entry)!, output: 'pixels' } };
  return { ok: true, graph: { ...bp, nodes }, insertedIds };
}

// ---------------- 打包 ----------------

export type PackChainResult =
  | { ok: true; def: ChainEntryDef }
  | { ok: false; error: string };

export function packChainSegment(bp: BlueprintGraph, endNodeId: string): PackChainResult {
  const byId = new Map(bp.nodes.map((n) => [n.id, n]));
  const end = byId.get(endNodeId);
  if (!end) return { ok: false, error: '节点不存在' };
  if (!PIXEL_SET.has(end.type)) return { ok: false, error: `「${end.type}」不是像素链节点，不能打包` };

  const collected = new Map<string, BlueprintNode>();
  const errors: string[] = [];

  const visitNumeric = (id: string, seen: Set<string>): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = byId.get(id);
    if (!n) { errors.push('数值子图引用了不存在的节点'); return; }
    if (n.type === 'time') return; // 折成哨兵，不收时间节点本体
    if (!NUMERIC_SET.has(n.type)) { errors.push(`数值子图含像素链不支持的节点类型「${n.type}」`); return; }
    collected.set(id, cloneNode(n));
    for (const inp of Object.values(n.inputs)) {
      if (isRef(inp)) visitNumeric(inp.nodeId, seen);
    }
  };

  // 像素链主干：从 end 沿 pixels 输入回溯到精灵源
  let cur: BlueprintNode | undefined = end;
  const chainIds: string[] = [];
  while (cur) {
    if (!PIXEL_SET.has(cur.type)) { errors.push(`链上含非像素节点「${cur.type}」`); break; }
    collected.set(cur.id, cloneNode(cur));
    chainIds.push(cur.id);
    const pin = cur.inputs.pixels;
    if (!isRef(pin)) { errors.push('链头像素入口未接线'); break; }
    const prev = byId.get(pin.nodeId);
    if (!prev) { errors.push('链头像素入口引用了不存在的节点'); break; }
    if (prev.type === 'sprite_source') break;
    cur = prev;
  }
  if (errors.length > 0) return { ok: false, error: errors[0]! };

  // 收集主干各节点的数值子树
  for (const id of chainIds) {
    const n = byId.get(id)!;
    for (const [key, inp] of Object.entries(n.inputs)) {
      if (key === 'pixels' || !isRef(inp)) continue;
      const target = byId.get(inp.nodeId);
      if (target && NUMERIC_SET.has(target.type)) visitNumeric(inp.nodeId, new Set());
      else if (target && target.type !== 'time') {
        return { ok: false, error: `参数输入接了不支持的节点类型「${target.type}」` };
      }
    }
  }
  if (errors.length > 0) return { ok: false, error: errors[0]! };

  // 折哨兵：链头 pixels → '@in'；指向时间节点的引用 → '@time'
  const timeIds = new Set(bp.nodes.filter((n) => n.type === 'time').map((n) => n.id));
  const headId = chainIds[chainIds.length - 1]!;
  const defNodes: BlueprintNode[] = [];
  for (const n of collected.values()) {
    const c = cloneNode(n);
    for (const [key, inp] of Object.entries(c.inputs)) {
      if (!isRef(inp)) continue;
      if (n.id === headId && key === 'pixels') c.inputs[key] = { nodeId: '@in', output: 'pixels' };
      else if (timeIds.has(inp.nodeId)) c.inputs[key] = { nodeId: '@time', output: 'out' };
      else if (!collected.has(inp.nodeId) && key !== 'pixels') delete c.inputs[key];
    }
    defNodes.push(c);
  }

  const expose = chainIds.flatMap((id) => {
    const n = byId.get(id)!;
    return Object.keys(n.params).map((key) => ({ node: id, key, label: key }));
  });

  return { ok: true, def: { kind: 'chain', nodes: defNodes, entry: endNodeId, expose } };
}

// ---------------- 修改器化 ----------------

/** 包络峰值估计（修改器版无包络，用峰值振幅做持续型近似） */
function waveformPeak(params: Record<string, unknown>): number | undefined {
  const base = Number(params.baseValue ?? 0);
  const amp = Number(params.amplitude ?? 1);
  const wf = String(params.waveform ?? 'sine');
  if (!Number.isFinite(base) || !Number.isFinite(amp)) return undefined;
  if (wf === 'exponential_decay') return base;
  return base + amp;
}

export function chainDefToModifierParams(
  def: ChainEntryDef,
): { type: string; params: Record<string, number | string | boolean> } | undefined {
  const pixelNodes = def.nodes.filter((n) => PIXEL_SET.has(n.type));
  if (pixelNodes.length !== 1) return undefined;
  const node = pixelNodes[0]!;
  const params: Record<string, number | string | boolean> = { ...node.params } as Record<string, number | string | boolean>;
  // 接了包络的参数：数值取包络峰值（目前只处理 waveform 来源）
  for (const [key, inp] of Object.entries(node.inputs)) {
    if (!isRef(inp)) continue;
    const src = def.nodes.find((n) => n.id === inp.nodeId);
    if (src && src.type === 'waveform') {
      const peak = waveformPeak(src.params as Record<string, unknown>);
      if (peak !== undefined) params[key] = peak;
    }
  }
  return { type: node.type, params };
}
