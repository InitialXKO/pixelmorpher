// Character → 程序化运行时包（procedural-pixel-runtime-1）。
// 数据口径：
// - 部件 = 带 slot 的节点；外观取各服装集 piece.parametric（无 parametric 的
//   服装下该部件在运行时包里隐藏——那是精灵部件，不是参数化部件）。
// - pivot = 节点第 0 帧世界位置（computeWorldTransforms 同源求值），
//   坐标转运行时系：x 同向、y 取反（产品 y 下 / 运行时 y 上）、角度同理。
// - 行为图/表演图的 nodeId（含 nodeRef 目标）一律换算成 slotKey。
// - 表演图经 graph-translate 采样烘焙；翻译失败/无贡献逐条进 warnings，不静默。
import type { Character, CostumePiece, DirectionIndex, ParametricAppearance, PixelGrid, Sprite } from '../unified-types';
import { buildParametricSprite } from './main-canvas';
import { subToPx } from '../unified-types';
import { computeWorldTransforms } from '../unified-render';
import { resolvePieceSprite } from '../sprite-resolve';
import { modifiersToBlueprint } from '../blueprint/migrate';
import type { BlueprintGraph, BlueprintInput, BlueprintNode } from '../blueprint/ir';
import { glowField, glowFollowTargetOf, packBytesBase64, resolveDynamicPatterns, type DynamicPatternParams } from '../dynamic-patterns';
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

/**
 * 运行时发光场（导出时按代表图预计算：选区 1 + 柔光圈衰减，权重 0..255）。
 * data 为每像素 3 字节打包：前 3 个发光实例的场依次存 R/G/B 通道，第 4 个起
 * 按各自所选的发光组（glowFollowGroup）并入对应通道（与模板 dynList 解析序
 * 一致）；无对应实例的通道全 0。
 * space: 'tile' = 代表图是参数化烘焙图（与瓦片同尺寸同朝向关系）；
 * 'sprite' = 代表图是精灵原图（瓦片带 2+halo 边距，模板按底图同式映射）。
 */
export interface RuntimeGlowEntry {
  /** 场尺寸（含外扩边距；代表图 (0,0) 位于场 (padX, padY)） */
  w: number;
  h: number;
  padX: number;
  padY: number;
  space: 'tile' | 'sprite';
  data: string;
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
  /** 发光场（默认服装集；换装集见 costumes[*].__glow） */
  glow?: RuntimeGlowEntry;
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

/** 精灵表口径：服装件里的精灵引用（SpriteRef）可能指向角色自带表，
 *  也可能指向工程级全局表（装配向导等写入方用全局表）——主画布出图时
 *  用的是全局表。转换器必须拿到同一张表解析，否则引用全部落空、
 *  精灵部件整件不进包（2026-10-23 实测事故：角色 12 个槽位只剩
 *  1 个参数化部件进包）。调用方传工程级表，与角色表合并（工程级优先）。 */
export type SpriteTable = Record<string, import('../unified-types').Sprite>;

/** 代表精灵网格（与主画布同解析链：变体→基础→镜像回落）。
 *  strictEast=false 时东向缺图按 [2,0,6,4,1,3,5,7] 顺序取该件任一
 *  方向的图作代表（装配服装常只存一个方向；运行时包本来就只带
 *  一张代表图）。底图（composite）口径仍严格取东向，不走此回落。 */
function eastSpriteOf(
  piece: CostumePiece | undefined,
  character: Character,
  slotKey: string,
  table: SpriteTable,
  strictEast = true,
): RuntimePartBase['baseSprite'] {
  if (!piece) return undefined;
  const dirs: DirectionIndex[] = strictEast ? [2] : [2, 0, 6, 4, 1, 3, 5, 7];
  for (const dir of dirs) {
    const r = resolvePieceSprite(piece, dir, character.slotVariants?.[slotKey], table, character.latitude ?? 0);
    if (r.sprite) {
      return {
        w: r.sprite.width,
        h: r.sprite.height,
        plug: r.sprite.plug
          ? [subToPx(r.sprite.plug.x), subToPx(r.sprite.plug.y)]
          : [r.sprite.width / 2, r.sprite.height / 2],
        data: r.sprite.data,
      };
    }
  }
  return undefined;
}

/**
 * 槽位代表图（编辑器取色/手动标记与运行时发光场共用一个口径）：
 * 参数化外观优先（与主画布同路烘焙），否则取代表方向精灵（东向优先、
 * 缺图按方向序回落）。externalSprites = 工程级全局表（与导出同口径合并）。
 */
export function representativeGridForSlot(
  character: Character,
  slotKey: string,
  externalSprites?: Record<string, Sprite>,
  costumeSetId?: string,
): PixelGrid | null {
  return representativeGridForSlotEx(character, slotKey, externalSprites, costumeSetId)?.grid ?? null;
}

/** representativeGridForSlot 的带来源版：space 供运行时模板决定场到瓦片的映射 */
export function representativeGridForSlotEx(
  character: Character,
  slotKey: string,
  externalSprites?: Record<string, Sprite>,
  costumeSetId?: string,
): { grid: PixelGrid; space: 'tile' | 'sprite' } | null {
  const table: SpriteTable = { ...(character.sprites ?? {}), ...(externalSprites ?? {}) };
  const set = character.costumeSets.find((cs) => cs.id === (costumeSetId ?? character.activeCostumeSetId))
    ?? character.costumeSets[0];
  const piece = set?.pieces[slotKey];
  if (!piece) return null;
  let baseSpr: Sprite | undefined;
  for (const dir of [2, 0, 6, 4, 1, 3, 5, 7] as DirectionIndex[]) {
    const r = resolvePieceSprite(piece, dir, character.slotVariants?.[slotKey], table, character.latitude ?? 0);
    if (r.sprite) { baseSpr = r.sprite; break; }
  }
  if (piece.parametric) {
    const nodeId = Object.values(character.nodes)
      .find((n) => (n.slot?.slotKey ?? n.id) === slotKey)?.id ?? slotKey;
    const baked = buildParametricSprite(piece.parametric, nodeId, baseSpr);
    if (baked) return { grid: baked.data, space: (piece.parametric.composite ?? 'generate') === 'generate' ? 'tile' : 'sprite' };
  }
  return baseSpr ? { grid: baseSpr.data, space: 'sprite' } : null;
}

/** silhouette/overlay 的底图：东向精灵（generate 档不需要），无则 undefined */
function baseSpriteFor(
  app: ParametricAppearance,
  piece: CostumePiece | undefined,
  character: Character,
  slotKey: string,
  table: SpriteTable,
): RuntimePartBase['baseSprite'] {
  if ((app.composite ?? 'generate') === 'generate') return undefined;
  return eastSpriteOf(piece, character, slotKey, table, true);
}

/**
 * 发光场进包：前 3 个发光实例各占一个通道（R/G/B）独立进包；第 4 个起
 * 按各自所选的发光组并入对应通道（场逐像素取大，颜色与呼吸参数跟所选组，
 * 与主画布 resolveGlowGroups 同口径）。某实例选区为空、无代表图，逐条点名。
 */
function glowEntryFor(
  character: Character,
  slotKey: string,
  dyn: RuntimeDynamicInstance[] | undefined,
  costumeSetId: string | undefined,
  externalSprites: Record<string, Sprite> | undefined,
  warnings: string[],
): RuntimeGlowEntry | undefined {
  if (!dyn) return undefined;
  const glows = dyn.filter((d) => d.params.glowEnabled);
  if (glows.length === 0) return undefined;
  const setName = character.costumeSets.find((cs) => cs.id === costumeSetId)?.name ?? costumeSetId ?? '';
  const where = setName ? `（服装集「${setName}」）` : '';
  if (glows.length > 3) {
    warnings.push(`发光段：槽位 ${slotKey}${where} 有 ${glows.length} 个发光实例，第 4 个起按各自所选的发光组并入运行时包（选区叠加取大、颜色与呼吸参数跟所选组；主画布同口径）`);
  }
  const rep = representativeGridForSlotEx(character, slotKey, externalSprites, costumeSetId);
  if (!rep) {
    warnings.push(`发光段：槽位 ${slotKey}${where} 没有代表图，选区未进运行时包`);
    return undefined;
  }
  const fields = glows.map((inst, idx) => {
    const gf = glowField(inst.params, rep.grid);
    if (!gf) {
      warnings.push(`发光段：槽位 ${slotKey}${where} 第 ${idx + 1} 个发光实例选区为空（取色无同色像素或未标记），未进运行时包`);
    }
    return gf;
  });
  if (!fields.some((f) => f)) return undefined;
  // 场带外扩边距（辉光溢出包围盒）：全组统一到最大边距，逐实例按网格原点对齐
  const padX = Math.max(...fields.map((f) => f?.padX ?? 0));
  const padY = Math.max(...fields.map((f) => f?.padY ?? 0));
  const w = (rep.grid[0]?.length ?? 0) + padX * 2;
  const h = rep.grid.length + padY * 2;
  const bytes = new Uint8Array(w * h * 3);
  fields.forEach((gf, idx) => {
    if (!gf) return;
    const ci = idx < 3 ? idx : glowFollowTargetOf(glows[idx]!.params); // 第 4 个起并入所选组
    const ox = padX - gf.padX, oy = padY - gf.padY;
    for (let y = 0; y < gf.h; y++) {
      for (let x = 0; x < gf.w; x++) {
        const v = Math.round(Math.max(0, Math.min(1, gf.field[y * gf.w + x])) * 255);
        if (!v) continue;
        const bi = ((y + oy) * w + (x + ox)) * 3 + ci;
        if (v > bytes[bi]) bytes[bi] = v;
      }
    }
  });
  return { w, h, padX, padY, space: rep.space, data: packBytesBase64(bytes) };
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

/**
 * 输出归一：修改器生成图的终点是 screen 节点（同时承载像素与变换通道），
 * 编辑器图终点是 transform。把 screen 输出换成只带变换通道的 transform
 * 输出（像素输入丢弃——像素链运行时无对应物），两路图自此同形。
 */
function normalizeGraphOutput(g: BlueprintGraph): BlueprintGraph {
  const out = g.nodes.find((x) => x.id === g.outputId);
  if (!out || out.type !== 'screen') return g;
  const keep: Record<string, BlueprintInput> = {};
  for (const ch of ['translateX', 'translateY', 'translateZ', 'rotation', 'tilt', 'scaleX', 'scaleY', 'skewX', 'skewY', 'zIndex']) {
    const inp = out.inputs?.[ch];
    if (inp) keep[ch] = inp;
  }
  return {
    ...g,
    nodes: g.nodes.map((n) => (n.id === out.id
      ? { ...n, type: 'transform', inputs: keep } as BlueprintNode
      : n)),
  };
}

/**
 * 只保留能到达输出 transform 的节点（沿连边反向走）。节点蓝图里的像素链
 * 与变换通道互不相干，剪掉后翻译器就不会为注定丢弃的像素节点刷警告。
 */
function pruneToTransform(g: BlueprintGraph): BlueprintGraph {
  const out = graphTransformNode(g);
  if (!out) return g;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const keep = new Set<string>([out.id]);
  const queue: BlueprintNode[] = [out];
  while (queue.length > 0) {
    const n = queue.pop()!;
    for (const inp of Object.values(n.inputs ?? {})) {
      const ref = inp as { nodeId?: unknown };
      if (ref && typeof ref === 'object' && typeof ref.nodeId === 'string' && !keep.has(ref.nodeId)) {
        keep.add(ref.nodeId);
        const src = byId.get(ref.nodeId);
        if (src) queue.push(src);
      }
    }
  }
  return { ...g, nodes: g.nodes.filter((n) => keep.has(n.id)) };
}

/** 图的输出节点是否为 transform（无 transform 输出的图没有姿态贡献）。 */
function graphTransformNode(g: BlueprintGraph): BlueprintNode | null {
  const n = g.nodes.find((x) => x.id === g.outputId);
  return n && n.type === 'transform' ? n : null;
}

type TransformChannel = 'rotation' | 'translateX' | 'translateY';

/**
 * 某图某变换通道的取值表达式：输出 transform 节点的该通道输入——
 * 连边原样（改前缀）、数字字面量原样、缺失时取节点参数（默认 0）。
 */
function channelExpr(g: BlueprintGraph, pfx: string, channel: TransformChannel): BlueprintInput {
  const t = graphTransformNode(g)!;
  const inp = t.inputs?.[channel];
  if (inp && typeof inp === 'object') {
    const ref = inp as { nodeId?: unknown; output?: string };
    if (typeof ref.nodeId === 'string') {
      return { nodeId: pfx + ref.nodeId, ...(ref.output ? { output: ref.output } : {}) } as BlueprintInput;
    }
    const lit = inp as { type?: string; value?: unknown };
    if (lit.type === 'number' && typeof lit.value === 'number') return inp;
  }
  const pv = Number((t.params as Record<string, unknown> | undefined)?.[channel] ?? 0);
  return { type: 'number', value: Number.isFinite(pv) ? pv : 0 } as BlueprintInput;
}

/** 复制一张图的非输出节点：id 与连边统一加前缀（nodeRef 的目标在 params 里，不动）。 */
function remapGraphNodes(g: BlueprintGraph, pfx: string): BlueprintNode[] {
  return g.nodes
    .filter((n) => n.id !== g.outputId)
    .map((n) => ({
      ...n,
      id: pfx + n.id,
      inputs: Object.fromEntries(
        Object.entries(n.inputs ?? {}).map(([port, inp]) => {
          const ref = inp as { nodeId?: unknown };
          return [port, ref && typeof ref === 'object' && typeof ref.nodeId === 'string'
            ? { ...(inp as object), nodeId: pfx + (ref.nodeId as string) }
            : inp];
        }),
      ) as BlueprintNode['inputs'],
      params: { ...(n.params ?? {}) },
    }));
}

/**
 * 行为图 + 节点蓝图合并：两图节点并置（各自加前缀），变换三通道在
 * 输入端逐通道相加后喂给一个新的 transform 输出——与主画布「行为
 * 叠加在节点蓝图之上」的求和语义一致，且合并产物仍是普通产品图，
 * 可直接走行为翻译。follow 取行为图优先。
 */
function combineTransformGraphs(a: BlueprintGraph, b: BlueprintGraph): BlueprintGraph {
  const nodes: BlueprintNode[] = [...remapGraphNodes(a, 'a_'), ...remapGraphNodes(b, 'b_')];
  const sumIds: Record<TransformChannel, string> = { rotation: 'sum_rot', translateX: 'sum_tx', translateY: 'sum_ty' };
  for (const ch of Object.keys(sumIds) as TransformChannel[]) {
    nodes.push({
      id: sumIds[ch], type: 'add',
      inputs: { a: channelExpr(a, 'a_', ch), b: channelExpr(b, 'b_', ch) },
      params: {},
    } as BlueprintNode);
  }
  nodes.push({
    id: 'out', type: 'transform',
    inputs: {
      rotation: { nodeId: 'sum_rot' },
      translateX: { nodeId: 'sum_tx' },
      translateY: { nodeId: 'sum_ty' },
    },
    params: {},
  } as BlueprintNode);
  return pruneToTransform({ version: 1, outputId: 'out', nodes, followMode: a.followMode ?? b.followMode } as BlueprintGraph);
}

export function convertCharacterToRuntimePackage(
  character: Character,
  externalSprites?: SpriteTable,
): ProcRuntimePackage {
  const warnings: string[] = [];
  // 精灵引用解析表：角色自带表 + 工程级全局表（全局优先），与主画布同口径
  const spriteTable: SpriteTable = { ...(character.sprites ?? {}), ...(externalSprites ?? {}) };
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
    const baseSprite = baseSpriteFor(baseApp, basePiece, character, slotKey, spriteTable);
    if ((baseApp.composite ?? 'generate') !== 'generate' && !baseSprite) {
      warnings.push(`槽位 ${slotKey} 合成方式为 ${baseApp.composite} 但东向无精灵，运行时按独立生成处理`);
    }
    const dyn = dynFor(node.dynamicPatterns, activeSet?.pieces[slotKey]?.dynamicPatterns);
    parts.push({
      key: slotKey,
      drawLayer: node.drawLayer,
      sortOrder: node.zIndex,
      costumeKeys: [slotKey],
      base: appearanceToBase(baseApp, pivot, w?.worldAngle ?? 0, baseSprite),
      variants: { 2: {} },
      dynamic: dyn,
      glow: glowEntryFor(character, slotKey, dyn, activeSet?.id, externalSprites, warnings),
    });
  }
  // ---- 精灵部件：无参数化外观、但任一服装集里有东向精灵的槽位 ----
  const spriteSlots = new Set<string>();
  for (const cs of character.costumeSets) {
    for (const [slotKey, piece] of Object.entries(cs.pieces)) {
      if (!parametricSlots.has(slotKey) && eastSpriteOf(piece, character, slotKey, spriteTable, false)) {
        spriteSlots.add(slotKey);
      }
    }
  }
  for (const slotKey of spriteSlots) {
    const nodeId = slotNode.get(slotKey);
    const node = nodeId ? character.nodes[nodeId] : undefined;
    if (!node) { warnings.push(`槽位 ${slotKey} 有精灵但无对应节点，已跳过`); continue; }
    const sg = eastSpriteOf(activeSet?.pieces[slotKey], character, slotKey, spriteTable, false)
      ?? character.costumeSets.map((cs) => eastSpriteOf(cs.pieces[slotKey], character, slotKey, spriteTable, false)).find(Boolean);
    if (!sg) continue;
    const w = worlds.get(node.id);
    const pivot: [number, number] = w ? [subToPx(w.worldX), -subToPx(w.worldY)] : [0, 0];
    const base = appearanceToBase(createDefaultParametricAppearance(), pivot, w?.worldAngle ?? 0);
    base.size = [sg.w, sg.h];
    const dyn = dynFor(node.dynamicPatterns, activeSet?.pieces[slotKey]?.dynamicPatterns);
    parts.push({
      key: slotKey,
      drawLayer: node.drawLayer,
      sortOrder: node.zIndex,
      costumeKeys: [slotKey],
      base,
      variants: { 2: {} },
      spriteKind: true,
      sprite: sg,
      dynamic: dyn,
      glow: glowEntryFor(character, slotKey, dyn, activeSet?.id, externalSprites, warnings),
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
    const glowMap: Record<string, RuntimeGlowEntry> = {};
    for (const slotKey of parametricSlots) {
      const piece = cs.pieces[slotKey];
      const app = piece?.parametric;
      const nodeId = slotNode.get(slotKey);
      const node = nodeId ? character.nodes[nodeId] : undefined;
      const dyn = dynFor(node?.dynamicPatterns, piece?.dynamicPatterns);
      if (dyn) dynMap[slotKey] = dyn;
      const ge = cs.id === activeSet?.id
        ? parts.find((p) => p.key === slotKey)?.glow
        : glowEntryFor(character, slotKey, dyn, cs.id, externalSprites, warnings);
      if (ge) glowMap[slotKey] = ge;
      if (!app) { entry[slotKey] = null; continue; }
      const w = nodeId ? worlds.get(nodeId) : undefined;
      const pivot: [number, number] = w ? [subToPx(w.worldX), -subToPx(w.worldY)] : [0, 0];
      entry[slotKey] = appearanceToBase(app, pivot, w?.worldAngle ?? 0, baseSpriteFor(app, piece, character, slotKey, spriteTable));
    }
    for (const slotKey of spriteSlots) {
      const nodeId = slotNode.get(slotKey);
      const node = nodeId ? character.nodes[nodeId] : undefined;
      const dyn = dynFor(node?.dynamicPatterns, cs.pieces[slotKey]?.dynamicPatterns);
      if (dyn) dynMap[slotKey] = dyn;
      const ge = cs.id === activeSet?.id
        ? parts.find((p) => p.key === slotKey)?.glow
        : glowEntryFor(character, slotKey, dyn, cs.id, externalSprites, warnings);
      if (ge) glowMap[slotKey] = ge;
    }
    if (Object.keys(dynMap).length > 0) entry.__dynamic = dynMap;
    if (Object.keys(glowMap).length > 0) entry.__glow = glowMap;
    // 精灵回落：该集该槽无参数化外观但有精灵 → 模板走直贴图（参数化
    // 槽位的换装回落与纯精灵部件共用此表）
    const spriteMap: Record<string, NonNullable<RuntimePartBase['baseSprite']>> = {};
    for (const slotKey of new Set([...parametricSlots, ...spriteSlots])) {
      const piece = cs.pieces[slotKey];
      if (piece?.parametric) continue;
      const sg = eastSpriteOf(piece, character, slotKey, spriteTable, false);
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
    // 姿态来源有两路：行为图（behaviorGraphs）与节点蓝图
    // （node.blueprint ?? 修改器生成图，与主画布 Phase 0 同一口径）。
    // 主画布上两者叠加求和（行为在节点蓝图之后），进包保持一致：
    // 两者都有时先在产品图层把变换三通道求和合并，再整体按行为口径
    // 翻译；节点蓝图的像素链运行时无对应物，只取变换通道。
    const nodeIds = new Set<string>([
      ...Object.keys(character.behaviorGraphs ?? {}),
      ...Object.values(character.nodes)
        .filter((n) => n.blueprint || (n.modifiers?.length ?? 0) > 0)
        .map((n) => n.id),
    ]);
    for (const nodeId of nodeIds) {
      const slot = toSlot(nodeId);
      const node = character.nodes[nodeId];
      const nodeName = node?.name ?? nodeId;
      if (!slot || !node) { warnings.push(`行为图：节点 ${nodeName} 不存在，未进包`); continue; }
      const bgRaw = character.behaviorGraphs?.[nodeId];
      const bg = bgRaw ? normalizeGraphOutput(bgRaw) : undefined;
      const nbRaw0 = node.blueprint
        ?? (node.modifiers?.length ? modifiersToBlueprint(node.modifiers as never) : null);
      const nbRaw = nbRaw0 ? normalizeGraphOutput(nbRaw0) : null;
      const nb = nbRaw && graphTransformNode(nbRaw) ? pruneToTransform(nbRaw) : null;
      if (nbRaw && !nb) warnings.push(`节点蓝图「${nodeName}」：无 transform 输出（像素类蓝图），未进包`);
      if (!bg && !nb) continue;
      const graph = bg && nb ? combineTransformGraphs(bg, nb) : (bg ?? nb)!;
      const srcLabel = bg && nb ? '行为图+节点蓝图' : bg ? '行为图' : '节点蓝图';
      const res = translateBehaviorGraph(graph, slot, `b${gi++}_`, (refId) => toSlot(refId));
      for (const w of res.warnings) warnings.push(`${srcLabel}「${nodeName}」：${w}`);
      if (!res.ok) { warnings.push(`${srcLabel}「${nodeName}」翻译失败：${res.reason}`); continue; }
      behavior.graphs[slot] = { context: 'behavior', nodes: res.nodes, ...(graph.followMode ? { follow: graph.followMode } : {}) };
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
