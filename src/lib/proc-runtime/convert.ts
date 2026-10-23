// Character → 程序化运行时包（procedural-pixel-runtime-1）。
// 数据口径：
// - 部件 = 带 slot 的节点；外观取各服装集 piece.parametric（无 parametric 的
//   服装下该部件在运行时包里隐藏——那是精灵部件，不是参数化部件）。
// - pivot = 节点第 0 帧世界位置（computeWorldTransforms 同源求值），
//   坐标转运行时系：x 同向、y 取反（产品 y 下 / 运行时 y 上）、角度同理。
// - 行为图/表演图的 nodeId（含 nodeRef 目标）一律换算成 slotKey。
// - 表演图经 graph-translate 采样烘焙；翻译失败/无贡献逐条进 warnings，不静默。
import type { Character, CostumePiece, ParametricAppearance } from '../unified-types';
import { subToPx } from '../unified-types';
import { computeWorldTransforms } from '../unified-render';
import { resolvePieceSprite } from '../sprite-resolve';
import { resolveDynamicPatterns, type DynamicPatternParams } from '../dynamic-patterns';
import { createDefaultParametricAppearance } from './surfaces';
import { PALETTES } from './palettes';
import {
  translatePerformanceGraph, translateBehaviorGraph,
  type RuntimeGraph, type RuntimeGraphNode,
} from './graph-translate';

export interface RuntimePartBase {
  pivot: [number, number];
  off: [number, number];
  size: [number, number];
  shapeKind: string;
  roundness?: number;
  poly?: [number, number][];
  polyPivot?: [number, number];
  restRot: number;
  light: number; outline: number; rim: number; glint: number;
  pal: string;
  rimI: number; glintI: number;
  surfaceName?: string;
  surface: ParametricAppearance['surface'];
  surfaceGraph?: ParametricAppearance['surfaceGraph'];
  /** 合成方式（缺省/ generate = 独立生成） */
  composite?: 'silhouette' | 'overlay';
  /** 轮廓外延宽度（0..8） */
  haloWidth?: number;
  /** silhouette/overlay 的底图精灵（东向解析结果，产品空间像素网格） */
  baseSprite?: { w: number; h: number; plug: [number, number]; data: (string | null)[][] };
}

/** 运行时动态实例（双挂载解析后，只留效果位 + 参数） */
export interface RuntimeDynamicInstance {
  slot: string;
  params: DynamicPatternParams;
}

export interface RuntimePart {
  key: string;
  drawLayer: string;
  sortOrder: number;
  costumeKeys: string[];
  base: RuntimePartBase;
  /** 变体覆盖：base 即东向（2）主形态，标空覆盖使西向走统一镜像（同产品 mirrorMap 口径） */
  variants: { 2: Record<string, never> };
  /** 动态模式（默认服装集下的解析结果；换装集见 costumes[*].__dynamic） */
  dynamic?: RuntimeDynamicInstance[];
  /** 精灵部件（无参数化外观）：模板按直贴图瓦片绘制 */
  spriteKind?: boolean;
  /** 精灵部件在默认服装集下的东向精灵网格（逐集见 costumes[*].__sprite） */
  sprite?: { w: number; h: number; plug: [number, number]; data: (string | null)[][] };
}

export interface ProcRuntimePackage {
  format: 'procedural-pixel-runtime-1';
  characterName: string;
  palettes: Record<string, number[]>;
  parts: RuntimePart[];
  costumes: Record<string, { label: string; [slotKey: string]: unknown }>;
  /** 模板初始服装集（产品当前生效集） */
  defaultCostume?: string;
  behavior: {
    /** slotKey → 行为迷你图（运行时实时求值） */
    graphs: Record<string, RuntimeGraph>;
  };
  performances: Array<Record<string, unknown>>;
  warnings: string[];
}

const TRIGGER_KEY_MAP: Record<string, string> = {
  attack: 'KeyJ', interact: 'KeyE', skill: 'KeyK', dash: 'KeyL', use: 'KeyF',
};

/** 东向精灵网格（与主画布同解析链：变体→基础→镜像回落），无则 undefined */
function eastSpriteOf(
  piece: CostumePiece | undefined,
  character: Character,
  slotKey: string,
): RuntimePartBase['baseSprite'] {
  if (!piece) return undefined;
  const r = resolvePieceSprite(piece, 2, character.slotVariants?.[slotKey], character.sprites, character.latitude ?? 0);
  if (!r.sprite) return undefined;
  return {
    w: r.sprite.width,
    h: r.sprite.height,
    plug: r.sprite.plug
      ? [subToPx(r.sprite.plug.x), subToPx(r.sprite.plug.y)]
      : [r.sprite.width / 2, r.sprite.height / 2],
    data: r.sprite.data,
  };
}

/** silhouette/overlay 的底图：东向精灵（generate 档不需要），无则 undefined */
function baseSpriteFor(
  app: ParametricAppearance,
  piece: CostumePiece | undefined,
  character: Character,
  slotKey: string,
): RuntimePartBase['baseSprite'] {
  if ((app.composite ?? 'generate') === 'generate') return undefined;
  return eastSpriteOf(piece, character, slotKey);
}

/** 双挂载解析 → 运行时动态实例（节点为底、服装件同位替换/压制） */
function dynFor(
  nodeDyn: Parameters<typeof resolveDynamicPatterns>[0],
  pieceDyn: Parameters<typeof resolveDynamicPatterns>[1],
): RuntimeDynamicInstance[] | undefined {
  const r = resolveDynamicPatterns(nodeDyn, pieceDyn);
  return r.length ? r.map((x) => ({ slot: x.instance.slot, params: x.instance.params })) : undefined;
}

function appearanceToBase(
  app: ParametricAppearance,
  pivot: [number, number],
  restRotDeg: number,
  baseSprite?: RuntimePartBase['baseSprite'],
): RuntimePartBase {
  const mode = app.composite ?? 'generate';
  return {
    pivot,
    off: [app.centerOffset[0], -app.centerOffset[1]],
    size: app.shape.size,
    shapeKind: app.shape.kind,
    roundness: app.shape.roundness,
    poly: app.shape.poly?.map(([x, y]) => [x, -y] as [number, number]),
    polyPivot: app.shape.polyPivot ? [app.shape.polyPivot[0], -app.shape.polyPivot[1]] : undefined,
    restRot: -restRotDeg * Math.PI / 180,
    light: app.light, outline: app.outline, rim: app.rim, glint: app.glint,
    pal: app.palette,
    rimI: app.rimI, glintI: app.glintI,
    surfaceName: app.surfaceName,
    surface: app.surface,
    surfaceGraph: app.surfaceGraph,
    composite: mode === 'generate' ? undefined : mode,
    haloWidth: app.haloWidth ? Math.max(0, Math.min(8, Math.floor(app.haloWidth))) : undefined,
    baseSprite,
  };
}

export function convertCharacterToRuntimePackage(character: Character): ProcRuntimePackage {
  const warnings: string[] = [];
  const worlds = computeWorldTransforms(character, 0, 512, 512, 12);
  const activeSet = character.costumeSets.find((cs) => cs.id === character.activeCostumeSetId)
    ?? character.costumeSets[0];

  // ---- 部件：任一服装集里带 parametric 的槽位 ----
  // 槽位键与换装同一口径（slot.slotKey ?? nodeId）：手建节点没有 slot
  // （slot 只由烘焙导入写入），其 pieces 以 nodeId 为键，必须能反查到节点。
  const slotNode = new Map<string, string>(); // slotKey → nodeId
  for (const node of Object.values(character.nodes)) {
    slotNode.set(node.slot?.slotKey ?? node.id, node.id);
  }
  const parts: RuntimePart[] = [];
  const parametricSlots = new Set<string>();
  for (const cs of character.costumeSets) {
    for (const [slotKey, piece] of Object.entries(cs.pieces)) {
      if (piece.parametric) parametricSlots.add(slotKey);
    }
  }
  for (const slotKey of parametricSlots) {
    const nodeId = slotNode.get(slotKey);
    const node = nodeId ? character.nodes[nodeId] : undefined;
    if (!node) { warnings.push(`槽位 ${slotKey} 有参数化外观但无对应节点，已跳过`); continue; }
    const basePiece = (activeSet?.pieces[slotKey]?.parametric)
      ? activeSet.pieces[slotKey]
      : character.costumeSets.map((cs) => cs.pieces[slotKey]).find((p) => p?.parametric);
    const baseApp = basePiece?.parametric;
    if (!baseApp) continue;
    const w = worlds.get(node.id);
    const pivot: [number, number] = w ? [subToPx(w.worldX), -subToPx(w.worldY)] : [0, 0];
    const baseSprite = baseSpriteFor(baseApp, basePiece, character, slotKey);
    if ((baseApp.composite ?? 'generate') !== 'generate' && !baseSprite) {
      warnings.push(`槽位 ${slotKey} 合成方式为 ${baseApp.composite} 但东向无精灵，运行时按独立生成处理`);
    }
    parts.push({
      key: slotKey,
      drawLayer: node.drawLayer,
      sortOrder: node.zIndex,
      costumeKeys: [slotKey],
      base: appearanceToBase(baseApp, pivot, w?.worldAngle ?? 0, baseSprite),
      variants: { 2: {} },
      dynamic: dynFor(node.dynamicPatterns, activeSet?.pieces[slotKey]?.dynamicPatterns),
    });
  }
  // ---- 精灵部件：无参数化外观、但任一服装集里有东向精灵的槽位 ----
  const spriteSlots = new Set<string>();
  for (const cs of character.costumeSets) {
    for (const [slotKey, piece] of Object.entries(cs.pieces)) {
      if (!parametricSlots.has(slotKey) && eastSpriteOf(piece, character, slotKey)) {
        spriteSlots.add(slotKey);
      }
    }
  }
  for (const slotKey of spriteSlots) {
    const nodeId = slotNode.get(slotKey);
    const node = nodeId ? character.nodes[nodeId] : undefined;
    if (!node) { warnings.push(`槽位 ${slotKey} 有精灵但无对应节点，已跳过`); continue; }
    const sg = eastSpriteOf(activeSet?.pieces[slotKey], character, slotKey)
      ?? character.costumeSets.map((cs) => eastSpriteOf(cs.pieces[slotKey], character, slotKey)).find(Boolean);
    if (!sg) continue;
    const w = worlds.get(node.id);
    const pivot: [number, number] = w ? [subToPx(w.worldX), -subToPx(w.worldY)] : [0, 0];
    const base = appearanceToBase(createDefaultParametricAppearance(), pivot, w?.worldAngle ?? 0);
    base.size = [sg.w, sg.h];
    parts.push({
      key: slotKey,
      drawLayer: node.drawLayer,
      sortOrder: node.zIndex,
      costumeKeys: [slotKey],
      base,
      variants: { 2: {} },
      spriteKind: true,
      sprite: sg,
      dynamic: dynFor(node.dynamicPatterns, activeSet?.pieces[slotKey]?.dynamicPatterns),
    });
  }
  // 动态效果孤儿：挂了动态但槽位既无参数化外观也无精灵 → 不在包内
  for (const node of Object.values(character.nodes)) {
    const slotKey = node.slot?.slotKey ?? node.id;
    if (parametricSlots.has(slotKey) || spriteSlots.has(slotKey)) continue;
    const hasDyn = (node.dynamicPatterns?.length ?? 0) > 0
      || character.costumeSets.some((cs) => (cs.pieces[slotKey]?.dynamicPatterns?.length ?? 0) > 0);
    if (hasDyn) warnings.push(`动态效果：槽位 ${slotKey} 既无参数化外观也无精灵，未进运行时包`);
  }
  parts.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  if (parts.length === 0) warnings.push('没有任何可进包的部件（参数化外观或精灵）：运行时包将没有部件');
  else if (Object.keys(character.directionDrawOrders ?? {}).length > 0) {
    warnings.push('运行时绘制顺序按节点 zIndex 近似：角色的 directionDrawOrders 未进包（v1）');
  }

  // ---- 服装：每集对每个参数化槽位给覆盖或 null ----
  const costumes: ProcRuntimePackage['costumes'] = {};
  for (const cs of character.costumeSets) {
    const entry: { label: string; [k: string]: unknown } = { label: cs.name };
    const dynMap: Record<string, RuntimeDynamicInstance[]> = {};
    for (const slotKey of parametricSlots) {
      const piece = cs.pieces[slotKey];
      const app = piece?.parametric;
      const nodeId = slotNode.get(slotKey);
      const node = nodeId ? character.nodes[nodeId] : undefined;
      const dyn = dynFor(node?.dynamicPatterns, piece?.dynamicPatterns);
      if (dyn) dynMap[slotKey] = dyn;
      if (!app) { entry[slotKey] = null; continue; }
      const w = nodeId ? worlds.get(nodeId) : undefined;
      const pivot: [number, number] = w ? [subToPx(w.worldX), -subToPx(w.worldY)] : [0, 0];
      entry[slotKey] = appearanceToBase(app, pivot, w?.worldAngle ?? 0, baseSpriteFor(app, piece, character, slotKey));
    }
    for (const slotKey of spriteSlots) {
      const nodeId = slotNode.get(slotKey);
      const node = nodeId ? character.nodes[nodeId] : undefined;
      const dyn = dynFor(node?.dynamicPatterns, cs.pieces[slotKey]?.dynamicPatterns);
      if (dyn) dynMap[slotKey] = dyn;
    }
    if (Object.keys(dynMap).length > 0) entry.__dynamic = dynMap;
    // 精灵回落：该集该槽无参数化外观但有精灵 → 模板走直贴图（参数化
    // 槽位的换装回落与纯精灵部件共用此表）
    const spriteMap: Record<string, NonNullable<RuntimePartBase['baseSprite']>> = {};
    for (const slotKey of new Set([...parametricSlots, ...spriteSlots])) {
      const piece = cs.pieces[slotKey];
      if (piece?.parametric) continue;
      const sg = eastSpriteOf(piece, character, slotKey);
      if (sg) spriteMap[slotKey] = sg;
    }
    if (Object.keys(spriteMap).length > 0) entry.__sprite = spriteMap;
    costumes[cs.id] = entry;
  }

  // ---- 行为蓝图：nodeId → slotKey，逐图结构翻译 ----
  // 同一回退口径：无 slot 的节点以 nodeId 为部件键；节点不存在才判死。
  const toSlot = (nodeId: string): string | null => {
    const n = character.nodes[nodeId];
    return n ? (n.slot?.slotKey ?? nodeId) : null;
  };
  const behavior: ProcRuntimePackage['behavior'] = { graphs: {} };
  {
    let gi = 0;
    for (const [nodeId, graph] of Object.entries(character.behaviorGraphs ?? {})) {
      const slot = toSlot(nodeId);
      const nodeName = character.nodes[nodeId]?.name ?? nodeId;
      if (!slot) { warnings.push(`行为图：节点 ${nodeName} 不存在，未进包`); continue; }
      const res = translateBehaviorGraph(graph, slot, `b${gi++}_`, (refId) => toSlot(refId));
      for (const w of res.warnings) warnings.push(`行为图「${nodeName}」：${w}`);
      if (!res.ok) { warnings.push(`行为图「${nodeName}」翻译失败：${res.reason}`); continue; }
      behavior.graphs[slot] = { context: 'behavior', nodes: res.nodes };
    }
  }

  // ---- 表演：逐个翻译 ----
  const performances: Array<Record<string, unknown>> = [];
  for (const perf of character.performances ?? []) {
    if (!perf.enabled) continue;
    const mask: string[] = [];
    const graphNodes: RuntimeGraphNode[] = [];
    let gi = 0;
    for (const nodeId of perf.maskNodeIds) {
      const slot = toSlot(nodeId);
      if (!slot) { warnings.push(`表演「${perf.name}」：掩码节点 ${character.nodes[nodeId]?.name ?? nodeId} 不存在`); continue; }
      mask.push(slot);
      const graph = perf.graphs[nodeId];
      if (!graph) { warnings.push(`表演「${perf.name}」：节点 ${character.nodes[nodeId]?.name ?? nodeId} 在掩码内但没有表演图`); continue; }
      const res = translatePerformanceGraph(graph, slot, perf.duration, `g${gi++}_`);
      graphNodes.push(...res.nodes);
      if (!res.ok) warnings.push(`表演「${perf.name}」节点 ${character.nodes[nodeId]?.name ?? nodeId} 的图翻译失败：${res.reason}`);
      else if (res.maxAmp < 1e-4) warnings.push(`表演「${perf.name}」节点 ${character.nodes[nodeId]?.name ?? nodeId} 的图采样后无姿态贡献`);
      const unsupported = Object.entries(res.typeReport).filter(([, c]) => c === 'unsupported').map(([t]) => t);
      if (unsupported.length) warnings.push(`表演「${perf.name}」节点 ${character.nodes[nodeId]?.name ?? nodeId} 含运行时不支持的节点：${unsupported.join('、')}（其数值若未进 transform 输出则无影响）`);
    }
    const afterSlot = perf.afterimageNodeId ? toSlot(perf.afterimageNodeId) : null;
    performances.push({
      id: perf.id,
      name: perf.name,
      trigger: perf.trigger,
      triggerKey: TRIGGER_KEY_MAP[perf.trigger] ?? (/^Key[A-Z]$/.test(perf.trigger) ? perf.trigger : 'KeyJ'),
      duration: perf.duration,
      envelope: { in: perf.envelopeIn, out: perf.envelopeOut },
      mode: perf.mode,
      mask,
      afterimage: afterSlot ? { part: afterSlot, count: 3, interval: 0.035 } : undefined,
      graph: { context: 'performance', nodes: graphNodes },
    });
  }

  return {
    format: 'procedural-pixel-runtime-1',
    characterName: character.name,
    palettes: PALETTES,
    parts,
    costumes,
    defaultCostume: activeSet?.id,
    behavior,
    performances,
    warnings,
  };
}
