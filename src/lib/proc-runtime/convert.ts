// Character → 程序化运行时包（procedural-pixel-runtime-1）。
// 数据口径：
// - 部件 = 带 slot 的节点；外观取各服装集 piece.parametric（无 parametric 的
//   服装下该部件在运行时包里隐藏——那是精灵部件，不是参数化部件）。
// - pivot = 节点第 0 帧世界位置（computeWorldTransforms 同源求值），
//   坐标转运行时系：x 同向、y 取反（产品 y 下 / 运行时 y 上）、角度同理。
// - 行为图/表演图的 nodeId（含 nodeRef 目标）一律换算成 slotKey。
// - 表演图经 graph-translate 采样烘焙；翻译失败/无贡献逐条进 warnings，不静默。
// - 节点关键帧轨道同样采样烘焙：剥离行为/蓝图后逐帧 FK，烘世界位姿增量
//   曲线合成一条「轨道」表演（add 模式；运行时部件扁平摆放、无父子跟随，
//   世界增量才能带上父轨道对子孙的带动）；tilt/stretch/scaleX/variantIndex
//   轨道运行时无对应通道，逐条点名不静默。
import type { Character, CostumePiece, DirectionIndex, ParametricAppearance, PixelGrid, Sprite, StateMachineSpec } from '../unified-types';
import type { AnimationClip } from '../types';
import { buildParametricSprite } from './main-canvas';
import { subToPx, projectToView } from '../unified-types';
import { computeWorldTransforms } from '../unified-render';
import { resolvePieceSprite } from '../sprite-resolve';
import { modifiersToBlueprint } from '../blueprint/migrate';
import type { BlueprintGraph, BlueprintInput, BlueprintNode } from '../blueprint/ir';
import { glowField, glowMaskCells, glowFollowTargetOf, packBytesBase64, resolveDynamicPatterns, type DynamicPatternParams } from '../dynamic-patterns';
import { createDefaultParametricAppearance } from './surfaces';
import { PALETTES } from './palettes';
import {
  translatePerformanceGraph, translateBehaviorGraph, simplify,
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

/** 运行时动态实例（双挂载解析后：实例 id + 效果位 + 参数）。
 * id 必须保留：粒子模拟的随机种子 = f(部件键, 实例 id)，与编辑器
 * 同源——丢了 id 改用效果位做种子，两边粒子花纹就不是同一批。 */
export interface RuntimeDynamicInstance {
  id: string;
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
  /**
   * 逐通道印章参数（片元重算用，与 data 三通道一一对应）：
   * shape 0=方形 1=圆形 2=星形 3=焰形 → data 该通道存选区掩码（选中=255），
   * 片元按主画布 glowStamp 同式现算印章（世界基准在片元按转角调方向，
   * 选区始终贴精灵）；shape 4=烘焙场（自绘印章或同通道并入了参数不一致
   * 的实例，无法用单个印章重算）→ data 该通道存烘焙好的权重场，片元直用。
   * 无该通道时为 null。
   */
  stamps: (RuntimeGlowStamp | null)[];
}

/** 片元重算印章参数（值域已按 glowStamp 同口径钳制） */
export interface RuntimeGlowStamp {
  shape: 0 | 1 | 2 | 3 | 4;
  halo: number;
  angleDeg: number;
  reach: number;
}

export interface RuntimePart {
  key: string;
  drawLayer: string;
  sortOrder: number;
  costumeKeys: string[];
  base: RuntimePartBase;
  /** 变体覆盖：base 即显示方向（第 0 帧根节点朝向）主形态，标空覆盖使
   *  对侧方向走统一镜像（同产品 mirrorMap 口径） */
  variants: Partial<Record<DirectionIndex, Record<string, never>>>;
  /** 动态模式（默认服装集下的解析结果；换装集见 costumes[*].__dynamic） */
  dynamic?: RuntimeDynamicInstance[];
  /** 发光场（默认服装集；换装集见 costumes[*].__glow） */
  glow?: RuntimeGlowEntry;
  /** 精灵部件（无参数化外观）：模板按直贴图瓦片绘制 */
  spriteKind?: boolean;
  /** 精灵部件在默认服装集下的显示方向精灵网格（逐集见 costumes[*].__sprite） */
  sprite?: { w: number; h: number; plug: [number, number]; data: (string | null)[][] };
}

export interface ProcRuntimePackage {
  format: 'procedural-pixel-runtime-1';
  characterName: string;
  /** 工程帧率：粒子模拟的帧量化基数（出生帧/生命帧与编辑器同口径） */
  frameRate: number;
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
  /** 运行时状态机（作者规格直通或默认机；模板据此编排表演与身体状态） */
  stateMachine?: StateMachineSpec;
  warnings: string[];
}

const TRIGGER_KEY_MAP: Record<string, string> = {
  attack: 'KeyJ', interact: 'KeyE', skill: 'KeyK', dash: 'KeyL', use: 'KeyF',
};

/** 默认状态机：常驻三态（idle/move/air，只读宿主变量判定）+ 包内每条
 *  表演一个表演状态（意图进入、播完自动退出回落）。作者在角色上写了
 *  stateMachine 规格时不用此默认机（convert 直通，见函数末尾） */
export function defaultStateMachine(performances: Array<Record<string, unknown>>): StateMachineSpec {
  return {
    version: 1,
    initial: 'idle',
    states: [
      { id: 'idle' },
      { id: 'move' },
      { id: 'air' },
      ...performances.map((p) => ({ id: `perf:${String(p.id)}`, performanceId: String(p.id) })),
    ],
    transitions: [
      { from: '*', to: 'air', when: [{ var: 'grounded', op: 'eq', value: 0 }] },
      { from: 'air', to: 'move', when: [{ var: 'grounded', op: 'eq', value: 1 }, { var: 'speed01', op: 'gte', value: 0.05 }] },
      { from: 'air', to: 'idle', when: [{ var: 'grounded', op: 'eq', value: 1 }, { var: 'speed01', op: 'lt', value: 0.05 }] },
      { from: 'idle', to: 'move', when: [{ var: 'speed01', op: 'gte', value: 0.05 }] },
      { from: 'move', to: 'idle', when: [{ var: 'speed01', op: 'lt', value: 0.05 }] },
    ],
  };
}

/** 精灵表口径：服装件里的精灵引用（SpriteRef）可能指向角色自带表，
 *  也可能指向工程级全局表（装配向导等写入方用全局表）——主画布出图时
 *  用的是全局表。转换器必须拿到同一张表解析，否则引用全部落空、
 *  精灵部件整件不进包（2026-10-23 实测事故：角色 12 个槽位只剩
 *  1 个参数化部件进包）。调用方传工程级表，与角色表合并（工程级优先）。 */
export type SpriteTable = Record<string, import('../unified-types').Sprite>;

/** 代表精灵网格（与主画布同解析链：变体→基础→镜像回落）。
 *  strictEast=false 时显示方向缺图按 [2,0,6,4,1,3,5,7] 顺序取该件任一
 *  方向的图作代表（装配服装常只存一个方向；运行时包本来就只带
 *  一张代表图）。底图（composite）口径仍严格取显示方向，不走回落。 */
function displaySpriteOf(
  piece: CostumePiece | undefined,
  character: Character,
  slotKey: string,
  table: SpriteTable,
  strictEast = true,
  homeDir: DirectionIndex = 2,
): RuntimePartBase['baseSprite'] {
  if (!piece) return undefined;
  // 代表方向 = 角色第 0 帧的显示方向（根节点 variantIndex），不是写死的
  // 2——方向编号里 2 是北向，此前误当东向优先，取到的图与编辑器显示的
  // 不是同一张（尺寸/plug 都对不上，枢轴自然错位）。
  const dirs: DirectionIndex[] = strictEast
    ? [homeDir]
    : [homeDir, ...([2, 0, 6, 4, 1, 3, 5, 7] as DirectionIndex[]).filter((d) => d !== homeDir)];
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
  preferredDir?: DirectionIndex,
): { grid: PixelGrid; space: 'tile' | 'sprite' } | null {
  const table: SpriteTable = { ...(character.sprites ?? {}), ...(externalSprites ?? {}) };
  const set = character.costumeSets.find((cs) => cs.id === (costumeSetId ?? character.activeCostumeSetId))
    ?? character.costumeSets[0];
  const piece = set?.pieces[slotKey];
  if (!piece) return null;
  // 代表方向缺省取根节点静态朝向（编辑器面板无帧上下文时的最佳近似）
  const homeDir = preferredDir
    ?? (character.rootNodeId ? character.nodes[character.rootNodeId]?.transform.variantIndex : undefined)
    ?? 2;
  const dirOrder = [homeDir, ...([2, 0, 6, 4, 1, 3, 5, 7] as DirectionIndex[]).filter((d) => d !== homeDir)];
  let baseSpr: Sprite | undefined;
  for (const dir of dirOrder) {
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
  homeDir: DirectionIndex = 2,
): RuntimePartBase['baseSprite'] {
  if ((app.composite ?? 'generate') === 'generate') return undefined;
  return displaySpriteOf(piece, character, slotKey, table, true, homeDir);
}

/**
 * 发光场进包：前 3 个发光实例各占一个通道（R/G/B）独立进包；第 4 个起
 * 按各自所选的发光组并入对应通道（场逐像素取大，颜色与呼吸参数跟所选组，
 * 与主画布 resolveGlowGroups 同口径）。某实例选区为空、无代表图，逐条点名。
 */
/** 形状名 → 片元印章代码（自绘印章走烘焙场，代码 4 在通道判定处处理） */
function glowShapeCodeOf(params: DynamicPatternParams): 0 | 1 | 2 | 3 {
  switch (params.glowShape ?? 'square') {
    case 'circle': return 1;
    case 'star': return 2;
    case 'flame': return 3;
    default: return 0;
  }
}

/** 印章参数签名：同通道并入的实例只有签名全同时才能共用一个印章重算 */
function glowStampSignature(params: DynamicPatternParams): string {
  const shape = params.glowShape ?? 'square';
  const reach = shape === 'star' ? (params.glowStarReach ?? 1.2)
    : shape === 'flame' ? (params.glowFlameReach ?? 1.8) : 1;
  return [shape, Math.round(params.glowHalo || 0), params.glowAngleDeg ?? 270,
    params.glowAngleSpace ?? 'sprite', reach].join('|');
}

/** 片元重算印章参数（钳制口径与 dynamic-patterns 的 glowStamp 一致） */
function glowStampOf(params: DynamicPatternParams): RuntimeGlowStamp {
  const shape = glowShapeCodeOf(params);
  const halo = Math.max(0, Math.min(8, Math.round(params.glowHalo || 0)));
  const reach = shape === 2
    ? Math.max(1, Math.min(2.5, params.glowStarReach || 1.2))
    : shape === 3
      ? Math.max(1, Math.min(3.5, params.glowFlameReach || 1.8))
      : 1;
  return { shape, halo, angleDeg: params.glowAngleDeg ?? 270, reach };
}

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
  const gw = rep.grid[0]?.length ?? 0;
  const gh = rep.grid.length;
  const w = gw + padX * 2;
  const h = gh + padY * 2;
  const bytes = new Uint8Array(w * h * 3);
  // 逐通道组装：通道内实例印章参数一致且都是解析形状 → 存选区掩码（并集），
  // 片元按印章参数现算（世界基准的方向在片元按部件转角调，位置始终贴精灵）；
  // 含自绘印章或参数不一致的通道 → 存烘焙权重场（逐实例场取大合并，同旧口径）。
  const stamps: (RuntimeGlowStamp | null)[] = [null, null, null];
  for (let ci = 0; ci < 3; ci++) {
    const idxs = glows.map((g, idx) => (idx < 3 ? idx : glowFollowTargetOf(g.params)) === ci ? idx : -1).filter((i) => i >= 0);
    const live = idxs.filter((idx) => fields[idx]);
    if (live.length === 0) continue;
    const first = glows[live[0]!]!.params;
    const recomputable = live.every((idx) => {
      const pp = glows[idx]!.params;
      return (pp.glowShape ?? 'square') !== 'custom'
        && glowStampSignature(pp) === glowStampSignature(first);
    });
    if (recomputable) {
      stamps[ci] = glowStampOf(first);
      for (const idx of live) {
        const cells = glowMaskCells(glows[idx]!.params, rep.grid);
        if (!cells) continue;
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            if (cells[y * gw + x]) bytes[((y + padY) * w + (x + padX)) * 3 + ci] = 255;
          }
        }
      }
    } else {
      stamps[ci] = { shape: 4, halo: 0, angleDeg: 0, reach: 0 };
      for (const idx of live) {
        const gf = fields[idx]!;
        const ox = padX - gf.padX, oy = padY - gf.padY;
        for (let y = 0; y < gf.h; y++) {
          for (let x = 0; x < gf.w; x++) {
            const v = Math.round(Math.max(0, Math.min(1, gf.field[y * gf.w + x])) * 255);
            if (!v) continue;
            const bi = ((y + oy) * w + (x + ox)) * 3 + ci;
            if (v > bytes[bi]) bytes[bi] = v;
          }
        }
      }
    }
  }
  return { w, h, padX, padY, space: rep.space, data: packBytesBase64(bytes), stamps };
}

/** 双挂载解析 → 运行时动态实例（节点为底、服装件同位替换/压制） */
function dynFor(
  nodeDyn: Parameters<typeof resolveDynamicPatterns>[0],
  pieceDyn: Parameters<typeof resolveDynamicPatterns>[1],
): RuntimeDynamicInstance[] | undefined {
  const r = resolveDynamicPatterns(nodeDyn, pieceDyn);
  return r.length ? r.map((x) => ({ id: x.instance.id, slot: x.instance.slot, params: x.instance.params })) : undefined;
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
  opts?: { frameRate?: number; totalFrames?: number; clips?: AnimationClip[] },
): ProcRuntimePackage {
  const warnings: string[] = [];
  // 精灵引用解析表：角色自带表 + 工程级全局表（全局优先），与主画布同口径
  const spriteTable: SpriteTable = { ...(character.sprites ?? {}), ...(externalSprites ?? {}) };
  // 工程帧率：一切帧↔秒换算的唯一来源（调用方传入；缺省 12 仅兜底）
  const projectFpsTop = opts?.frameRate && opts.frameRate > 0 ? opts.frameRate : 12;
  const worlds = computeWorldTransforms(character, 0, 512, 512, projectFpsTop);
  // 世界位姿 → 2D 摆放：必须走与主画布同一投影（projectToView 按根节点
  // 朝向把 3D 世界坐标投到视平面）——直接拿 worldX 当横坐标会把深度轴
  // 当成横轴，东/北等朝向的角色整幅错位/镜像。
  const rootDir = (character.rootNodeId ? worlds.get(character.rootNodeId)?.variantIndex : undefined) ?? 0;
  const pivotOf = (nodeId: string | undefined): [number, number] => {
    const w = nodeId ? worlds.get(nodeId) : undefined;
    if (!w) return [0, 0];
    const proj = projectToView(w.worldX, w.worldY, w.worldZ, rootDir as DirectionIndex);
    return [subToPx(proj.canvasX), -subToPx(proj.canvasY)];
  };
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
    const pivot = pivotOf(node.id);
    const baseSprite = baseSpriteFor(baseApp, basePiece, character, slotKey, spriteTable, rootDir as DirectionIndex);
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
      variants: { [rootDir]: {} },
      dynamic: dyn,
      glow: glowEntryFor(character, slotKey, dyn, activeSet?.id, externalSprites, warnings),
    });
  }
  // ---- 精灵部件：无参数化外观、但任一服装集里有东向精灵的槽位 ----
  const spriteSlots = new Set<string>();
  for (const cs of character.costumeSets) {
    for (const [slotKey, piece] of Object.entries(cs.pieces)) {
      if (!parametricSlots.has(slotKey) && displaySpriteOf(piece, character, slotKey, spriteTable, false, rootDir as DirectionIndex)) {
        spriteSlots.add(slotKey);
      }
    }
  }
  for (const slotKey of spriteSlots) {
    const nodeId = slotNode.get(slotKey);
    const node = nodeId ? character.nodes[nodeId] : undefined;
    if (!node) { warnings.push(`槽位 ${slotKey} 有精灵但无对应节点，已跳过`); continue; }
    const sg = displaySpriteOf(activeSet?.pieces[slotKey], character, slotKey, spriteTable, false, rootDir as DirectionIndex)
      ?? character.costumeSets.map((cs) => displaySpriteOf(cs.pieces[slotKey], character, slotKey, spriteTable, false, rootDir as DirectionIndex)).find(Boolean);
    if (!sg) continue;
    const w = worlds.get(node.id);
    const pivot = pivotOf(node.id);
    const base = appearanceToBase(createDefaultParametricAppearance(), pivot, w?.worldAngle ?? 0);
    base.size = [sg.w, sg.h];
    const dyn = dynFor(node.dynamicPatterns, activeSet?.pieces[slotKey]?.dynamicPatterns);
    parts.push({
      key: slotKey,
      drawLayer: node.drawLayer,
      sortOrder: node.zIndex,
      costumeKeys: [slotKey],
      base,
      variants: { [rootDir]: {} },
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
      const pivot = pivotOf(nodeId);
      entry[slotKey] = appearanceToBase(app, pivot, w?.worldAngle ?? 0, baseSpriteFor(app, piece, character, slotKey, spriteTable, rootDir as DirectionIndex));
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
      const sg = displaySpriteOf(piece, character, slotKey, spriteTable, false, rootDir as DirectionIndex);
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
    // 时间单位口径：图内时间一律秒（time 节点、周期参数、phase
    // 圈数），行为图与节点蓝图共用同一秒钟，合并无双时钟问题。
    const projectFps = projectFpsTop;
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

  // ---- 轨道：采样烘焙成曲线 ----
  // 运行时部件是扁平摆放（各自钉在第 0 帧世界位姿、无父子跟随），而轨道在
  // 主画布是局部量（父轨道会带动子孙）。故不能逐节点烘局部增量：须把行为/
  // 蓝图/修改器/IK 全部剥离后逐帧跑主画布同源 FK，烘每个部件的世界位姿
  // 增量（相对采样窗首帧）——父轨道的带动自动体现在子孙部件的曲线里。
  // 采样窗参数化：全程窗合成一条「轨道」表演；每个片段的时间窗
  // （AnimationClip.startFrame–endFrame）另烘一条段表演（窗内相对帧、
  // 时长=窗长/帧率、循环标记随片段），供运行时状态机/宿主按名触发。
  {
    const POSE_CHANNELS = ['angle', 'tilt', 'x', 'y', 'stretch', 'scaleX', 'variantIndex'] as const;
    const trackNodes = Object.values(character.nodes).filter((n) =>
      n.tracks && POSE_CHANNELS.some((ch) => (n.tracks[ch]?.keyframes?.length ?? 0) > 0));
    const clipList = (opts?.clips ?? []).filter((c) =>
      c.puppetCharacterId === character.id
      && typeof c.startFrame === 'number' && typeof c.endFrame === 'number'
      && c.endFrame >= c.startFrame);
    if (trackNodes.length > 0) {
      const frameRate = opts?.frameRate && opts.frameRate > 0 ? opts.frameRate : 12;
      const partKeys = new Set(parts.map((p) => p.key));
      // 不支持通道点名（仅在关键帧真偏离静态值时；恒等空转不算损失）。
      // zIndex 轨同理：主渲染画序未消费该轨，运行时包也不烘它。
      for (const node of Object.values(character.nodes)) {
        if (!node.tracks) continue;
        const baseOf: Record<string, number> = {
          tilt: node.transform.tilt ?? 0, stretch: node.transform.stretch,
          scaleX: node.transform.scaleX ?? 1, variantIndex: node.transform.variantIndex,
          zIndex: node.zIndex ?? 0,
        };
        const bad = (['tilt', 'stretch', 'scaleX', 'variantIndex', 'zIndex'] as const).filter((ch) => {
          const kfs = node.tracks[ch]?.keyframes ?? [];
          return kfs.length > 0 && kfs.some((kf) => Math.abs(kf.value - baseOf[ch]) > 1e-9);
        });
        if (bad.length) {
          warnings.push(`轨道：节点 ${node.name}：轨道通道 ${bad.join('、')} 运行时无对应变换通道，未进包`);
        }
      }
      // 剥离克隆（浅拷贝：只换掉驱动姿态的输入，几何/轨道/层级原样共享）
      const stripped: Character = {
        ...character,
        behaviorGraphs: {},
        ikChains: [],
        nodes: Object.fromEntries(Object.values(character.nodes).map((n) => [
          n.id, { ...n, blueprint: null, modifiers: [] },
        ])),
      };
      // 采样一个窗：工程帧 [startF, startF + D] 共 D+1 个样本（末样本为循环接点）；
      // 与部件摆放同一投影（projectToView，朝向取当帧根节点 variantIndex），
      // 运行时系（角度弧度、y 取反、px）
      const sampleWindow = (startF: number, D: number) => {
        const samples = new Map<string, Array<{ a: number; x: number; y: number }>>();
        for (let f = startF; f <= startF + D; f++) {
          const wf = computeWorldTransforms(stripped, f, 512, 512, projectFpsTop);
          const dirF = (character.rootNodeId ? wf.get(character.rootNodeId)?.variantIndex : undefined) ?? rootDir;
          for (const node of Object.values(character.nodes)) {
            const w = wf.get(node.id);
            if (!w) continue;
            let arr = samples.get(node.id);
            if (!arr) { arr = []; samples.set(node.id, arr); }
            const proj = projectToView(w.worldX, w.worldY, w.worldZ, dirF as DirectionIndex);
            arr.push({ a: -w.worldAngle * Math.PI / 180, x: subToPx(proj.canvasX), y: -subToPx(proj.canvasY) });
          }
        }
        return samples;
      };
      // 样本 → 曲线图节点（增量相对窗首样本）；warnNodes 时逐节点报无贡献
      const curvesForWindow = (
        samples: Map<string, Array<{ a: number; x: number; y: number }>>,
        D: number,
        prefixBase: string,
        warnNodes: boolean,
      ) => {
        const mask: string[] = [];
        const graphNodes: RuntimeGraphNode[] = [];
        let gi = 0;
        for (const node of Object.values(character.nodes)) {
          const slot = toSlot(node.id);
          const arr = samples.get(node.id);
          if (!slot || !arr || arr.length === 0) continue;
          if (!partKeys.has(slot)) {
            if (warnNodes && trackNodes.includes(node)) warnings.push(`轨道：节点 ${node.name} 不在运行时部件内，其轨道未进包`);
            continue;
          }
          const base = arr[0];
          const mkPts = (pick: (s: { a: number; x: number; y: number }) => number) =>
            arr.map((s, f) => [f / D, pick(s) - pick(base)] as [number, number]);
          const chans: Array<{ pts: [number, number][]; suffix: string; field: 'angleFrom' | 'dxFrom' | 'dyFrom'; eps: number }> = [
            { pts: mkPts((s) => s.a), suffix: 'ang', field: 'angleFrom', eps: 0.01 },
            { pts: mkPts((s) => s.x), suffix: 'dx', field: 'dxFrom', eps: 0.15 },
            { pts: mkPts((s) => s.y), suffix: 'dy', field: 'dyFrom', eps: 0.15 },
          ];
          const prefix = `${prefixBase}${gi++}_`;
          const nodes: RuntimeGraphNode[] = [{ id: `${prefix}t`, type: 'time' }];
          const tr: Extract<RuntimeGraphNode, { type: 'transform' }> = {
            id: `${prefix}tr`, type: 'transform', part: slot, units: 'runtime',
          };
          for (const ch of chans) {
            if (ch.pts.every(([, v]) => Math.abs(v) < 1e-4)) continue;
            const id = `${prefix}${ch.suffix}`;
            nodes.push({ id, type: 'curve', points: simplify(ch.pts, ch.eps) });
            tr[ch.field] = { n: id };
          }
          if (tr.angleFrom || tr.dxFrom || tr.dyFrom) {
            nodes.push(tr);
            mask.push(slot);
            graphNodes.push(...nodes);
          } else if (warnNodes && trackNodes.includes(node)) {
            warnings.push(`轨道：节点 ${node.name} 的轨道采样后无姿态贡献（与静态姿态无差异或仅有不支持通道）`);
          }
        }
        return { graphNodes, mask };
      };
      // 全程窗 →「轨道」表演。时长：工程总帧数优先（时间线长度，末帧后
      // 保持）；缺省取最晚关键帧
      let totalFrames = Math.max(1, Math.round(opts?.totalFrames ?? 0));
      if (!opts?.totalFrames) {
        totalFrames = 1;
        for (const n of trackNodes) {
          for (const t of Object.values(n.tracks)) {
            for (const kf of t?.keyframes ?? []) if (kf.frame > totalFrames) totalFrames = kf.frame;
          }
        }
      }
      const full = curvesForWindow(sampleWindow(0, totalFrames), totalFrames, 't', true);
      if (full.graphNodes.length > 0) {
        performances.push({
          id: 'tracks',
          name: '轨道',
          trigger: 'tracks',
          triggerKey: 'KeyT',
          duration: totalFrames / frameRate,
          envelope: { in: 0, out: 0 },
          mode: 'add',
          mask: full.mask,
          graph: { context: 'performance', nodes: full.graphNodes },
        });
      }
      // 片段窗 → 段表演（按窗起点排序，状态机/宿主按 id 或名触发）
      let ci = 0;
      for (const clip of [...clipList].sort((a, b) => a.startFrame - b.startFrame)) {
        const len = clip.endFrame - clip.startFrame + 1;
        const seg = curvesForWindow(sampleWindow(clip.startFrame, len), len, `c${ci++}_`, false);
        if (seg.graphNodes.length === 0) {
          warnings.push(`片段「${clip.name}」：时间窗内轨道无姿态贡献，未生成段表演`);
          continue;
        }
        performances.push({
          id: `clip_${clip.id}`,
          name: clip.name,
          trigger: 'clip',
          duration: len / frameRate,
          envelope: { in: 0, out: 0 },
          mode: 'add',
          loop: clip.loop === true,
          mask: seg.mask,
          graph: { context: 'performance', nodes: seg.graphNodes },
        });
      }
    }
  }


  // ---- 状态机：作者规格直通（表演状态引用的表演必须在包内，悬空的
  // 降为常驻状态并点名）；缺省生成默认机 ----
  let stateMachine: StateMachineSpec;
  if (character.stateMachine) {
    const perfIds = new Set(performances.map((p) => String(p.id)));
    stateMachine = {
      ...character.stateMachine,
      states: character.stateMachine.states.map((s) => {
        if (s.performanceId && !perfIds.has(s.performanceId)) {
          warnings.push(`状态机：状态「${s.id}」引用的表演 ${s.performanceId} 不在包内，已降为常驻状态`);
          return { id: s.id };
        }
        return s;
      }),
    };
  } else {
    stateMachine = defaultStateMachine(performances);
  }

  return {
    format: 'procedural-pixel-runtime-1',
    characterName: character.name,
    frameRate: projectFpsTop,
    palettes: PALETTES,
    parts,
    costumes,
    defaultCostume: activeSet?.id,
    behavior,
    performances,
    stateMachine,
    warnings,
  };
}
