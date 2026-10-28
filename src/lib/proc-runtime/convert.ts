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
import type { Character, CostumePiece, DirectionIndex, ParametricAppearance, PixelGrid, Sprite, SpriteMark, StateMachineSpec } from '../unified-types';
import type { AnimationClip } from '../types';
import { buildParametricSprite } from './main-canvas';
import { subToPx, projectToView, frameYAxisWorld, directionTrig } from '../unified-types';
import { computeWorldTransforms, computeRestWorldTransforms, stackBendForNode, rotateWorldTransformsForYaw, facingYawDeltaRad, stepClampState, type ClampStateMap } from '../unified-render';
import { cloneClampState, steppedClampState } from '../clamp-session';
import { realtimeChainDefs, sampleReference, type ChainBakeParams } from '../sim/verlet-chain';
import { resolvePieceSprite } from '../sprite-resolve';
import { computeStackOps, rasterizeStackOpsData, STACK_VIEW_ELEVATION_DEG, type StackDrawOp } from '../stack-render';
import { packMaskBits, unpackMaskBits } from '../sprite-marks';
import { collectDesiredPatterns, effectivePatternGraph, extractPatternInstances } from '../blueprint/pattern-sync';
import { resolvePerfSlash, graphWithoutSlashNodes } from '../blueprint/slash-sync';
import { findSlashDef, resolveClipSlash } from '../slash-defs';
import { rgbaToHexOrNull } from '../engine/utils';
import { modifiersToBlueprint } from '../blueprint/migrate';
import type { BlueprintGraph, BlueprintInput, BlueprintNode } from '../blueprint/ir';
import { followAnchoredDeltaAt, glowField, glowMaskCells, glowFollowTargetOf, packBytesBase64, resolveDynamicPatterns, type DynamicPatternParams, type DynamicPatternInstance } from '../dynamic-patterns';
import { BUILTIN_ENTRIES, libraryIndexOf, surfaceLibEntriesOf } from '../library-entries';
import { expandDynamicEntry } from '../dynamic-expand';
import { createDefaultParametricAppearance } from './surfaces';
import { expandSurfaceGraph, graphHasRefs, subgraphLibraryOf } from './graph-expand';
import { PATTERN_TEMPLATES, type PatternTemplate } from './pattern-templates';
import { PALETTES } from './palettes';
import {
  translatePerformanceGraph, translateBehaviorGraph, simplify, extractPixelGraph,
  type RuntimeGraph, type RuntimeGraphNode,
} from './graph-translate';
import type { RuntimePixelGraph } from './pixel-src';

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
  baseSprite?: { w: number; h: number; plug: [number, number]; data: (string | null)[][]; marks?: import('../unified-types').SpriteMark[] };
}

/** 运行时动态实例（双挂载解析后：实例 id + 效果位 + 参数）。
 * id 必须保留：粒子模拟的随机种子 = f(部件键, 实例 id)，与编辑器
 * 同源——丢了 id 改用效果位做种子，两边粒子花纹就不是同一批。 */
export interface RuntimeDynamicInstance {
  id: string;
  slot: string;
  params: DynamicPatternParams;
  /** 追随段烘焙增量曲线（u = 全程窗进度 0..1 → 增量；运行时空间：
   * da 为弧度、ds 为沿轴缩放倍乘）。导出时由源部件的全程窗轨道样本
   * 按锚定换算逐帧算好（连接点锚死，平移增量按跟随者主轴与臂长换
   * 算为摆角 + 缩放，与编辑器实时落点同一公式）——运行时只采样本
   * 曲线，不回头取样源部件。dx/dy 为旧整件平移烘焙的遗留字段，
   * 现行烘焙不再产出，运行时保留消费以兼容旧包。 */
  followCurve?: {
    dx?: [number, number][];
    dy?: [number, number][];
    da?: [number, number][];
    /** 锚定版沿轴缩放因子（倍乘，缺省 1）：与 da 同为锚定换算产物 */
    ds?: [number, number][];
  };
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
  sortOrder: number;
  /** 节点遮挡层名：随包播放器现行画序不读，但属包的对外数据面
   * （用户端可按层名做自己的排序/分组），保留原样进包 */
  drawLayer: string;
  costumeKeys: string[];
  base: RuntimePartBase;
  /** 变体覆盖：base 即显示方向（第 0 帧根节点朝向）主形态，标空覆盖使
   *  对侧方向走统一镜像（同产品 mirrorMap 口径） */
  variants: Partial<Record<DirectionIndex, Record<string, never>>>;
  /** 动态模式（默认服装集下的解析结果；换装集见 costumes[*].__dynamic） */
  dynamic?: RuntimeDynamicInstance[];
  /** 发光场（默认服装集；换装集见 costumes[*].__glow） */
  glow?: RuntimeGlowEntry;
  /** 裁剪面（锚点部件图空间，相对锚点瓦片中心、x 右 y 下）：
   * 保留 a·x + b·y + c >= 0 侧；模板逐帧按两位姿合成到本部件图空间 */
  clip?: { by: string; a: number; b: number; c: number };
  /** 精灵部件（无参数化外观）：模板按直贴图瓦片绘制 */
  spriteKind?: boolean;
  /** 精灵部件在默认服装集下的显示方向精灵网格（逐集见 costumes[*].__sprite） */
  sprite?: { w: number; h: number; plug: [number, number]; data: (string | null)[][]; marks?: import('../unified-types').SpriteMark[] };
  /** 像素链（节点蓝图 screen 像素子图的迷你图）：模板逐帧以部件
   * 当前精灵网格为源求值、结果写回瓦片。仅精灵部件携带（参数化
   * 部件 v1 不带，convert 点名）。逐集换图不换链（链挂节点蓝图）。 */
  pixelGraph?: RuntimePixelGraph;
  /** 变体替代精灵（缺口 6）：仅当某片段状态轨给该槽指派过变体时才带；
   * variantId → 该变体解析后的代表精灵（与基础解析不同才收） */
  altSprites?: Record<string, { w: number; h: number; plug: [number, number]; data: (string | null)[][]; marks?: import('../unified-types').SpriteMark[] }>;
  /** 网格蒙皮（缺口 4）：父槽位 skinning='mesh' 时带；parent 为父部件
   * 键，plugOff 为 attachment.plug 偏移（px，叠加在瓦片 cx/cy 上） */
  skin?: { parent: string; radius: number; curve: 'linear' | 'smoothstep'; plugOff: [number, number] };
  /** 精灵堆叠（默认服装集口径；与默认集不同的集见 costumes[*].__stack）：
   * 层图网格 + 摞几何（节点局部坐标，全局像素），全量进包不丢弃。
   * 显示图（sprite/__sprite）是 convert 期以第 0 帧世界帧、按编辑
   * 器同一公式（computeStackOps）合成的静止帧图（已按动画全窗并集
   * 垫边，与层变换帧同画布）；轨道/片段表演另带 stackFrames 逐帧
   * 层变换（并集画布空间、锚点归一化的仿射算子），模板在这些表演
   * 主导时逐层真合成；其余位姿来源下回落静止图。能做 3D 的消费方
   * 也可直接用本字段逐帧合成。 */
  stack?: RuntimeStackPayload;
}

/** 运行时包中的一摞：层图（根→尖）+ 几何（与编辑器 SpriteStack 同数） */
export interface RuntimeStackPayload {
  layerThickness: number;
  origin: [number, number, number];
  axis: [number, number, number];
  uAxis: [number, number, number];
  vAxis: [number, number, number];
  marks?: import('../unified-types').SpriteMark[];
  layers: Array<{
    w: number; h: number;
    plug: [number, number];
    data: (string | null)[][];
    marks?: import('../unified-types').SpriteMark[];
  }>;
}

/** 运行时实时模拟链（D6 乙路）：包内只发定义不发曲线——链结构、
 * 参数与表演起点初始状态；运行时模板逐帧以当帧部件位姿为参考
 * 步进同一份 Verlet 数学。坐标均为运行时系（px、y 向上、角度
 * 弧度），关节位与部件 pivot 同投影（projectToView）。 */
export interface RuntimeSimChain {
  /** 链根节点 id（编辑器口径，消费方对账用） */
  nodeId: string;
  /** 链根部件键（模板按部件定位的状态键） */
  root: string;
  /** 链节点部件键（根→尖，与 chainNodeIds 一一对应） */
  nodes: string[];
  /** 链节点 id（根→尖） */
  chainNodeIds: string[];
  params: ChainBakeParams;
  /** 初始状态种子：initState.frame 帧的平结算关节位（零初速，
   * px=x、py=y 由消费方自建）；运行时硬重锁/首帧播种用 */
  initState: { frame: number; joints: [number, number][]; angles: number[] };
  /** initState 帧的逐段段长（px） */
  restLengths: number[];
  /** initState 帧各链节点的基准本地角（弧度，运行时系） */
  baseAngles: number[];
}

export interface ProcRuntimePackage {
  format: 'procedural-pixel-runtime-1';
  characterName: string;
  /** 玩家时钟模式（缺省 'frame'）：'frame' | 'wall' | 'audio'；
   * 模板侧无运行时切换接口，宿主在构建 HTML 前改本字段覆盖
   * （如预览面板改 'wall' 按真实时间播） */
  simMode?: string;
  /** 实时模拟链定义（无实时链时缺省，包与旧行为一致） */
  chains?: RuntimeSimChain[];
  /** 工程帧率：粒子模拟的帧量化基数（出生帧/生命帧与编辑器同口径） */
  frameRate: number;
  palettes: Record<string, number[]>;
  parts: RuntimePart[];
  /** 骨骼名/父子表（按部件键对齐）：parts 的 slotKey 对烘焙角色是
   * 不透明键（slot_<角色>_<骨序>），消费方无从按名识别骨骼——本表把
   * 编辑器侧节点的原始名与父子拓扑按部件键发一份；几何仍以
   * parts.base 为准，本表只发名称与关系。旧包无此字段。 */
  skeleton?: Array<{ key: string; name: string; parent: string | null }>;
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
  /** 程序化动画（工程级数据经 opts.projectData 传入；仅保留在编辑器内
   *  确有对应启用修改器、因而确实生效的条目，其余逐条点名） */
  procedural?: Array<{ slot: string; target: string; cfg: Record<string, unknown>; startFrame: number; endFrame: number }>;
  /** 全局变换图（工程级全局修改器/全局蓝图翻译；运行时逐帧求值后
   *  对整场施加平移/旋转/缩放，与编辑器 applyGlobalTransformWrapper 同口径） */
  globalGraph?: RuntimeGraph;
  /** 画布级特效数据（缺口 5）：工程级特效轨/笔触/画布修改轨原样带入，
   * 运行时按工程时间线帧消费；片段级同类数据挂在段表演的 fx 上 */
  fx?: {
    canvas: { w: number; h: number };
    totalFrames: number;
    effectTracks?: import('../types').EffectTrack[];
    motionBlurStrokes?: import('../types').MotionBlurStroke[];
    effectStrokes?: import('../types').EffectStroke[];
    canvasTracks?: import('../types').CanvasModifierTrack[];
  };
  /** 场景实体（AABB，左下角 + 宽高，世界单位 y 向上）：随包播放器据此
   * 做落地/顶头/堵墙/贴墙/抓边与俯视阻挡；缺省时播放器用内置默认关卡 */
  scene?: { solids: Array<{ x: number; y: number; w: number; h: number }> };
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

/** 实时模拟链发包（D6 乙路步骤 4）：枚举 realtimeChainDefs（mode=
 * realtime 且定义完整；发束在编辑器侧就是逐根独立的 chainSims 条目，
 * 此处逐条成链）。initState 锚点 = 全程窗首帧（帧 0）——包级只有
 * 一份 chains，全程窗是 convert 最先采样的窗、片段窗的快照亦由它
 * 延续（与钳制 convert 的整窗快照口径同构），故初始状态取帧 0 的
 * 平结算。链上任一节点不是运行时部件时整链不进包（模板的参考
 * 关节位只能取自部件位姿，无位姿来源不臆造通道）并点名。 */
export function buildSimChains(
  character: Character,
  frameRate: number,
  toSlot: (nodeId: string) => string | null,
  partKeys: Set<string>,
  warnings: string[],
): RuntimeSimChain[] {
  const defs = realtimeChainDefs(character);
  if (defs.length === 0) return [];
  const fromFrame = 0;
  const map = computeWorldTransforms(character, fromFrame, 800, 800, frameRate);
  const dirF = (character.rootNodeId ? map.get(character.rootNodeId)?.variantIndex : undefined) ?? 0;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const out: RuntimeSimChain[] = [];
  for (const { rootId, def } of defs) {
    const nodes: string[] = [];
    let missing: string | null = null;
    for (const id of def.chainNodeIds) {
      const slot = toSlot(id);
      if (!slot || !partKeys.has(slot)) { missing = id; break; }
      nodes.push(slot);
    }
    if (missing) {
      warnings.push(`实时模拟：链根「${character.nodes[rootId]?.name ?? rootId}」的节点 ${character.nodes[missing]?.name ?? missing} 不是运行时部件，整链未进包（运行时无该关节的位姿来源）`);
      continue;
    }
    const joints: [number, number][] = def.chainNodeIds.map((id) => {
      const w = map.get(id);
      if (!w) return [0, 0] as [number, number];
      const proj = projectToView(w.worldX, w.worldY, w.worldZ, dirF as DirectionIndex);
      return [r3(subToPx(proj.canvasX)), r3(-subToPx(proj.canvasY))] as [number, number];
    });
    const angles = def.chainNodeIds.map((id) => {
      const w = map.get(id);
      return w ? r3(-w.worldAngle * Math.PI / 180) : 0;
    });
    const restLengths: number[] = [];
    for (let i = 0; i + 1 < joints.length; i++) {
      restLengths.push(r3(Math.hypot(joints[i + 1][0] - joints[i][0], joints[i + 1][1] - joints[i][1])));
    }
    const baseLocals = sampleReference(character, def.chainNodeIds, fromFrame, fromFrame, frameRate).baseLocals;
    out.push({
      nodeId: rootId,
      root: nodes[0],
      nodes,
      chainNodeIds: [...def.chainNodeIds],
      params: { ...def.params },
      initState: { frame: fromFrame, joints, angles },
      restLengths,
      baseAngles: baseLocals.map((d) => r3(-d * Math.PI / 180)),
    });
  }
  return out;
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
        marks: r.sprite.marks,
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
): { grid: PixelGrid; space: 'tile' | 'sprite'; marks?: import('../unified-types').SpriteMark[] } | null {
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
    if (baked) return { grid: baked.data, space: (piece.parametric.composite ?? 'generate') === 'generate' ? 'tile' : 'sprite', marks: baseSpr?.marks };
  }
  return baseSpr ? { grid: baseSpr.data, space: 'sprite', marks: baseSpr.marks } : null;
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
    const gf = glowField(inst.params, rep.grid, 0, rep.marks);
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
        const cells = glowMaskCells(glows[idx]!.params, rep.grid, rep.marks);
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

/** 双挂载解析 → 运行时动态实例（节点为底、服装件同位替换/压制）。
 * 带库引用的实例按钉版本权威重展开（快照只作展开失败时的回退，
 * 失败点名不静默）。 */
/** 图案↔蓝图统一：进包的图案实例从节点生效图提取（节点挂载 +
 * 指定集的件挂载两列，喂给 dynFor 走既有双挂载合并/库展开口径）。
 * 接线覆盖是编辑器实时求值，包内按节点 params 固化。 */
function graphPatternLists(
  character: Character,
  node: Character['nodes'][string] | undefined,
  setId: string | undefined,
): [DynamicPatternInstance[] | undefined, DynamicPatternInstance[] | undefined] {
  if (!node) return [undefined, undefined];
  const graph = effectivePatternGraph(character, node as never);
  if (!graph) return [node.dynamicPatterns, undefined];
  const { nodeList, pieceListBySet } = extractPatternInstances(graph);
  return [nodeList, setId ? pieceListBySet.get(setId) : undefined];
}

function dynFor(
  nodeDyn: Parameters<typeof resolveDynamicPatterns>[0],
  pieceDyn: Parameters<typeof resolveDynamicPatterns>[1],
  dynLib?: import('../library-entries').LibraryIndex,
  warnings?: string[],
): RuntimeDynamicInstance[] | undefined {
  const r = resolveDynamicPatterns(nodeDyn, pieceDyn);
  if (!r.length) return undefined;
  return r.map((x) => {
    let params = x.instance.params;
    const ref = x.instance.patternRef;
    if (ref && dynLib) {
      const ex = expandDynamicEntry(dynLib, ref.id, ref.version, x.instance.overrides);
      if (ex.params) params = ex.params;
      else warnings?.push(`模式库：动态实例（效果位 ${x.instance.slot}）引用 ${ref.id}@${ref.version} 展开失败，沿用快照——${ex.errors.join('；')}`);
    }
    return { id: x.instance.id, slot: x.instance.slot, params };
  });
}

function appearanceToBase(
  app: ParametricAppearance,
  pivot: [number, number],
  restRotDeg: number,
  baseSprite?: RuntimePartBase['baseSprite'],
  graphOverride?: ParametricAppearance['surfaceGraph'],
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
    surfaceGraph: graphOverride ?? app.surfaceGraph,
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
  opts?: { frameRate?: number; totalFrames?: number; clips?: AnimationClip[]; patternLibrary?: PatternTemplate[]; libraryEntries?: import('../library-entries').LibraryEntry[]; projectData?: { proceduralAnimations?: import('../types').ProceduralAnimation[]; globalModifiers?: import('../types').GlobalModifier[]; globalBlueprint?: import('../blueprint/ir').BlueprintGraph | null; canvasModifierTracks?: import('../types').CanvasModifierTrack[]; effectTracks?: import('../types').EffectTrack[]; motionBlurStrokes?: import('../types').MotionBlurStroke[]; effectStrokes?: import('../types').EffectStroke[]; canvasWidth?: number; canvasHeight?: number; scene?: { solids?: Array<{ x: number; y: number; w: number; h: number }> } }; projectExtras?: { perspectiveForeshorten?: boolean } },
): ProcRuntimePackage {
  const warnings: string[] = [];
  // ---- 工程级数据点名（运行时完备性审计缺口 5/7，未修项）：convert
  // 结构上拿不到工程级 store，调用方把计数经 projectExtras 传入，有
  // 则点名，不再静默丢弃。（缺口 3 全局修改器/蓝图已改走 projectData
  // 真进包，见函数末尾 globalGraph。） ----
  {
    const ex = opts?.projectExtras;
    // 透视缩短（缺口 7）：因子已随轨道采样进包（fore 通道），播放器
    // 自带开关（默认关，与编辑器缺省一致），此处不再点名缺失。
  }
  // 子图库：调用方传全库快照；给了统一条目库时按版本展开成
  // id@版本 条目（钉版本纪律），否则走平铺模板（同 SpriteTable
  // 由调用方传工程级表的先例，convert 不读存储）。
  const subLib = opts?.libraryEntries
    ? subgraphLibraryOf(surfaceLibEntriesOf(opts.libraryEntries))
    : subgraphLibraryOf(opts?.patternLibrary ?? PATTERN_TEMPLATES);
  // 动态条目索引：实例钉版本引用按此权威重展开（缺省只认内置）
  const dynLib = libraryIndexOf(opts?.libraryEntries ?? BUILTIN_ENTRIES);
  /** 进包图：含 ref 时展开成平图（包自包含，运行时模板不认 ref），警告点名 */
  const expandPkg = (g: ParametricAppearance['surfaceGraph'], where: string) => {
    if (!g || !graphHasRefs(g)) return g;
    const r = expandSurfaceGraph(g, subLib);
    for (const w of r.warnings) warnings.push(`${where}：${w}`);
    return r.graph;
  };
  // 精灵引用解析表：角色自带表 + 工程级全局表（全局优先），与主画布同口径
  const spriteTable: SpriteTable = { ...(character.sprites ?? {}), ...(externalSprites ?? {}) };
  // 工程帧率：一切帧↔秒换算的唯一来源（调用方传入；缺省 12 仅兜底）
  const projectFpsTop = opts?.frameRate && opts.frameRate > 0 ? opts.frameRate : 12;
  const worlds = computeWorldTransforms(character, 0, 512, 512, projectFpsTop);
  // 连续偏航与主画布同口径：facingAngle 给出时整角色先绕竖直轴转，
  // 静止合成图与 2D 摆放都用转后位姿（运行时包内无逐帧 3D 合成）
  if (character.facingAngle !== undefined) {
    const rootDirC = (character.rootNodeId ? worlds.get(character.rootNodeId)?.variantIndex : undefined) ?? 0;
    rotateWorldTransformsForYaw(worlds, facingYawDeltaRad(character.facingAngle, rootDirC as never));
  }
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

  // ---- 精灵堆叠：摞载荷（全量进包）+ 静止帧合成显示图 ----
  const stackPayloadOf = (piece: CostumePiece | undefined): RuntimeStackPayload | undefined => {
    const st = piece?.stack;
    if (!st) return undefined;
    const layers: RuntimeStackPayload['layers'] = [];
    for (const id of st.layerSpriteIds) {
      const spr = spriteTable[id];
      if (!spr) continue;
      layers.push({
        w: spr.width, h: spr.height,
        plug: spr.plug ? [subToPx(spr.plug.x), subToPx(spr.plug.y)] : [spr.width / 2, spr.height / 2],
        data: spr.data, marks: spr.marks,
      });
    }
    if (layers.length === 0) return undefined;
    return {
      layerThickness: st.layerThickness,
      origin: [st.origin.x, st.origin.y, st.origin.z],
      axis: [st.axis.x, st.axis.y, st.axis.z],
      uAxis: [st.uAxis.x, st.uAxis.y, st.uAxis.z],
      vAxis: [st.vAxis.x, st.vAxis.y, st.vAxis.z],
      marks: st.marks,
      layers,
    };
  };
  const gridToRgba = (spr: Sprite): { rgba: Uint8ClampedArray; width: number; height: number } => {
    const rgba = new Uint8ClampedArray(spr.width * spr.height * 4);
    for (let y = 0; y < spr.height; y++) {
      const row = spr.data[y];
      for (let x = 0; x < spr.width; x++) {
        const cell = row?.[x];
        if (!cell) continue;
        const o = (y * spr.width + x) * 4;
        rgba[o] = parseInt(cell.slice(1, 3), 16);
        rgba[o + 1] = parseInt(cell.slice(3, 5), 16);
        rgba[o + 2] = parseInt(cell.slice(5, 7), 16);
        rgba[o + 3] = 255;
      }
    }
    return { rgba, width: spr.width, height: spr.height };
  };
  /** 堆叠件的显示图：第 0 帧世界帧下、按编辑器同一公式
   *（computeStackOps + 同口径栅格化）合成的静止帧图。播放器位姿是
   * 2D 的，逐帧 3D 合成不在包内——摞本体全量走 part.stack/__stack。 */
  const stackDisplayOf = (piece: CostumePiece | undefined, nodeId: string | undefined): RuntimePartBase['baseSprite'] => {
    const st = piece?.stack;
    if (!st || !nodeId) return undefined;
    const w = worlds.get(nodeId);
    if (!w) return undefined;
    const layerSprites = st.layerSpriteIds.map((id) => spriteTable[id]);
    if (!layerSprites.some(Boolean)) return undefined;
    const res = computeStackOps(st, layerSprites, w.worldFrame, w.worldAngle);
    if (res.ops.length === 0) return undefined;
    const raster = rasterizeStackOpsData(res, layerSprites.map((spr) => (spr ? gridToRgba(spr) : null)));
    if (!raster) return undefined;
    let rgba = raster.rgba;
    let pivotX = res.pivotX;
    if (w.mirror) {
      // 与编辑器执行端口径一致：镜像时合成图整图水平翻转、枢轴随翻
      const flipped = new Uint8ClampedArray(rgba.length);
      for (let y = 0; y < raster.height; y++) {
        for (let x = 0; x < raster.width; x++) {
          const so = (y * raster.width + x) * 4;
          const df = (y * raster.width + (raster.width - 1 - x)) * 4;
          flipped[df] = rgba[so]!; flipped[df + 1] = rgba[so + 1]!;
          flipped[df + 2] = rgba[so + 2]!; flipped[df + 3] = rgba[so + 3]!;
        }
      }
      rgba = flipped;
      pivotX = raster.width - pivotX;
    }
    const data: PixelGrid = [];
    for (let y = 0; y < raster.height; y++) {
      const row: (string | null)[] = [];
      for (let x = 0; x < raster.width; x++) {
        const o = (y * raster.width + x) * 4;
        row.push(rgbaToHexOrNull(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!, rgba[o + 3]!));
      }
      data.push(row);
    }
    return { w: raster.width, h: raster.height, plug: [pivotX, res.pivotY], data, marks: st.marks };
  };

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
    const dyn = dynFor(...graphPatternLists(character, node, activeSet?.id), dynLib, warnings);
    parts.push({
      key: slotKey,
      sortOrder: node.zIndex,
      drawLayer: node.drawLayer,
      costumeKeys: [slotKey],
      base: appearanceToBase(baseApp, pivot, w?.worldAngle ?? 0, baseSprite,
        expandPkg(baseApp.surfaceGraph, `子图（槽位 ${slotKey}）`)),
      variants: { [rootDir]: {} },
      dynamic: dyn,
      glow: glowEntryFor(character, slotKey, dyn, activeSet?.id, externalSprites, warnings),
    });
  }
  // ---- 精灵部件：无参数化外观、但任一服装集里有东向精灵的槽位 ----
  const spriteSlots = new Set<string>();
  for (const cs of character.costumeSets) {
    for (const [slotKey, piece] of Object.entries(cs.pieces)) {
      if (!parametricSlots.has(slotKey)
        && (displaySpriteOf(piece, character, slotKey, spriteTable, false, rootDir as DirectionIndex) || stackPayloadOf(piece))) {
        spriteSlots.add(slotKey);
      }
    }
  }
  for (const slotKey of spriteSlots) {
    const nodeId = slotNode.get(slotKey);
    const node = nodeId ? character.nodes[nodeId] : undefined;
    if (!node) { warnings.push(`槽位 ${slotKey} 有精灵但无对应节点，已跳过`); continue; }
    const sg = stackDisplayOf(activeSet?.pieces[slotKey], nodeId)
      ?? displaySpriteOf(activeSet?.pieces[slotKey], character, slotKey, spriteTable, false, rootDir as DirectionIndex)
      ?? character.costumeSets.map((cs) => stackDisplayOf(cs.pieces[slotKey], nodeId)
        ?? displaySpriteOf(cs.pieces[slotKey], character, slotKey, spriteTable, false, rootDir as DirectionIndex)).find(Boolean);
    if (!sg) continue;
    const w = worlds.get(node.id);
    const pivot = pivotOf(node.id);
    const base = appearanceToBase(createDefaultParametricAppearance(), pivot, w?.worldAngle ?? 0);
    base.size = [sg.w, sg.h];
    const dyn = dynFor(...graphPatternLists(character, node, activeSet?.id), dynLib, warnings);
    parts.push({
      key: slotKey,
      sortOrder: node.zIndex,
      drawLayer: node.drawLayer,
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
    const hasDyn = collectDesiredPatterns(character, node as never).length > 0;
    if (hasDyn) warnings.push(`动态效果：槽位 ${slotKey} 既无参数化外观也无精灵，未进运行时包`);
  }
  parts.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  // 像素链进包：从节点原始蓝图（normalize 之前）提取 screen 像素
  // 子图挂 part.pixelGraph（仅精灵部件——链的源与回写都以精灵
  // 网格为口径；参数化部件 v1 点名不进）。行为图一节的「无
  // transform 输出」警告据 pixelCarriedNodes 免发（链已进包）。
  const pixelCarriedNodes = new Set<string>();
  for (const part of parts) {
    const nodeId = slotNode.get(part.key);
    const node = nodeId ? character.nodes[nodeId] : undefined;
    if (!node) continue;
    const rawBp = node.blueprint
      ?? (node.modifiers?.length ? modifiersToBlueprint(node.modifiers as never) : null);
    if (!rawBp) continue;
    const ext = extractPixelGraph(rawBp as BlueprintGraph);
    for (const w of ext.warnings) warnings.push(`节点蓝图「${node.name ?? nodeId}」像素链：${w}`);
    if (!ext.graph) continue;
    if (part.spriteKind) {
      part.pixelGraph = ext.graph;
      pixelCarriedNodes.add(node.id);
    } else {
      warnings.push(`节点蓝图「${node.name ?? nodeId}」像素链：参数化部件 v1 不带像素链，未进包（编辑器内照常生效）`);
    }
  }
  // 精灵堆叠载荷：默认集口径挂 part.stack（来源层 id 串记下，供
  // __stack 只收与默认口径不同的集，避免整摞层图在每集重复进包）
  const stackBaseIds = new Map<string, string>();
  const stackPartSlots: string[] = [];
  const stackBakedSlots = new Set<string>();
  for (const part of parts) {
    const src = activeSet?.pieces[part.key]?.stack
      ? activeSet.pieces[part.key]
      : character.costumeSets.map((cs) => cs.pieces[part.key]).find((p) => p?.stack);
    const payload = stackPayloadOf(src);
    if (payload && src?.stack) {
      part.stack = payload;
      stackBaseIds.set(part.key, src.stack.layerSpriteIds.join(','));
      stackPartSlots.push(part.key);
    }
  }
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
      const dyn = dynFor(...graphPatternLists(character, node, cs.id), dynLib, warnings);
      if (dyn) dynMap[slotKey] = dyn;
      const ge = cs.id === activeSet?.id
        ? parts.find((p) => p.key === slotKey)?.glow
        : glowEntryFor(character, slotKey, dyn, cs.id, externalSprites, warnings);
      if (ge) glowMap[slotKey] = ge;
      if (!app) { entry[slotKey] = null; continue; }
      const w = nodeId ? worlds.get(nodeId) : undefined;
      const pivot = pivotOf(nodeId);
      entry[slotKey] = appearanceToBase(app, pivot, w?.worldAngle ?? 0, baseSpriteFor(app, piece, character, slotKey, spriteTable, rootDir as DirectionIndex),
        expandPkg(app.surfaceGraph, `子图（槽位 ${slotKey}，服装集「${cs.name}」）`));
    }
    for (const slotKey of spriteSlots) {
      const nodeId = slotNode.get(slotKey);
      const node = nodeId ? character.nodes[nodeId] : undefined;
      const dyn = dynFor(...graphPatternLists(character, node, cs.id), dynLib, warnings);
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
      const sg = stackDisplayOf(piece, slotNode.get(slotKey)) ?? displaySpriteOf(piece, character, slotKey, spriteTable, false, rootDir as DirectionIndex);
      if (sg) spriteMap[slotKey] = sg;
    }
    if (Object.keys(spriteMap).length > 0) entry.__sprite = spriteMap;
    // 堆叠旁表：该集此槽的摞与默认口径不同才收（同摞不重复进包）
    const stackMap: Record<string, RuntimeStackPayload> = {};
    for (const part of parts) {
      const piece = cs.pieces[part.key];
      if (!piece?.stack) continue;
      if (stackBaseIds.get(part.key) === piece.stack.layerSpriteIds.join(',')) continue;
      const payload = stackPayloadOf(piece);
      if (payload) stackMap[part.key] = payload;
    }
    if (Object.keys(stackMap).length > 0) entry.__stack = stackMap;
    costumes[cs.id] = entry;
  }

  // ---- 裁剪面：node.clipPlane → part.clip ----
  // 数据口径：平面定义在锚点精灵图空间（相对图中心、x 右 y 下），
  // convert 只做角度/偏移 → (a, b, c) 的直译（保留 a·x+b·y+c >= 0
  // 侧），逐帧位姿合成在模板侧。锚点不是部件槽位则点名丢弃。
  for (const part of parts) {
    const node = Object.values(character.nodes).find((n) => n.slot?.slotKey === part.key);
    const cp = node?.clipPlane;
    if (!node || !cp) continue;
    const anchorNode = character.nodes[cp.anchor];
    const anchorSlot = anchorNode?.slot?.slotKey;
    if (!anchorNode || !anchorSlot || !parts.some((p) => p.key === anchorSlot)) {
      warnings.push(`裁剪面：节点 ${node.name} 的锚点 ${anchorNode?.name ?? cp.anchor} 不是部件槽位，裁剪未进包`);
      continue;
    }
    const rad = (cp.angleDeg ?? 0) * Math.PI / 180;
    part.clip = { by: anchorSlot, a: Math.cos(rad), b: Math.sin(rad), c: -(cp.offset ?? 0) };
  }

  // ---- 网格蒙皮回填（缺口 4）：节点 attachment 指向的父槽位
  // skinning='mesh' → 部件带 skin（父部件键 + 半径/曲线 + plug 偏移）；
  // 运行时逐帧按子/父世界角差对当前瓦片做同编辑器公式的变形。 ----
  for (const part of parts) {
    const nodeId = slotNode.get(part.key);
    const node = nodeId ? character.nodes[nodeId] : undefined;
    if (!node || node.attachment?.type !== 'socket' || !node.attachment.parentSocketId || !node.parentId) continue;
    const parentNode = character.nodes[node.parentId];
    const socket = parentNode?.sockets?.find((sk) => sk.id === node.attachment!.parentSocketId);
    if (socket?.skinning !== 'mesh') continue;
    part.skin = {
      parent: parentNode.slot?.slotKey ?? parentNode.id,
      radius: socket.skinRadius ?? 8,
      curve: socket.skinCurve ?? 'smoothstep',
      plugOff: node.attachment.plug ? [subToPx(node.attachment.plug.x), subToPx(node.attachment.plug.y)] : [0, 0],
    };
  }

  // ---- 变体替代精灵回填（缺口 6）：片段状态轨给某槽指派过的变体，
  // 逐个按与代表图同一解析链（变体直达→镜像→基础回落）解析成代表
  // 精灵进 part.altSprites；与基础解析同一张图的跳过。只取生效集的
  // 服装件（运行时覆盖叠在当前集之上，跨集+变体同时切换时变体图仍
  // 取生效集件——近似，已知会点名在 AUDIT）。 ----
  {
    const needed = new Map<string, Set<string>>();
    for (const c of opts?.clips ?? []) {
      for (const k of c.stateKeyframes ?? []) {
        for (const [slot, v] of Object.entries(k.slotChanges ?? {})) {
          if (v === null) continue;
          if (!needed.has(slot)) needed.set(slot, new Set());
          needed.get(slot)!.add(v);
        }
      }
    }
    if (needed.size > 0) {
      const dirOrder: DirectionIndex[] = [rootDir, ...([2, 0, 6, 4, 1, 3, 5, 7] as DirectionIndex[]).filter((d) => d !== rootDir)];
      const resolveWith = (piece: CostumePiece, variantId: string | undefined) => {
        for (const dir of dirOrder) {
          const r = resolvePieceSprite(piece, dir, variantId, spriteTable, character.latitude ?? 0);
          if (r.sprite) return r.sprite;
        }
        return undefined;
      };
      for (const part of parts) {
        const vids = needed.get(part.key);
        if (!vids) continue;
        const piece = activeSet?.pieces[part.key];
        if (!piece) continue;
        const baseSpr = resolveWith(piece, character.slotVariants?.[part.key]);
        const alt: NonNullable<RuntimePart['altSprites']> = {};
        for (const vid of vids) {
          const spr = resolveWith(piece, vid);
          if (spr && spr.id !== baseSpr?.id) {
            alt[vid] = {
              w: spr.width, h: spr.height,
              plug: spr.plug ? [subToPx(spr.plug.x), subToPx(spr.plug.y)] : [spr.width / 2, spr.height / 2],
              data: spr.data, marks: spr.marks,
            };
          }
        }
        if (Object.keys(alt).length > 0) part.altSprites = alt;
      }
    }
  }

  // ---- 行为蓝图：nodeId → slotKey，逐图结构翻译 ----
  // 同一回退口径：无 slot 的节点以 nodeId 为部件键；节点不存在才判死。
  const toSlot = (nodeId: string): string | null => {
    const n = character.nodes[nodeId];
    return n ? (n.slot?.slotKey ?? nodeId) : null;
  };
  /** 刀光规格进包：锚点必须是包内真实部件（槽位键或节点 id 命中
   * 部件键），否则点名警告并丢弃——模板侧靠部件位姿定格刀光。 */
  const slashForPkg = (
    spec: import('../slash-fan').SlashFanSpec | undefined,
    ownerLabel: string,
  ): Record<string, unknown> | undefined => {
    if (!spec) return undefined;
    const anchorNode = character.nodes[spec.anchorNodeId];
    const candidates = anchorNode
      ? [anchorNode.slot?.slotKey, spec.anchorNodeId].filter((v): v is string => !!v)
      : [];
    const slot = candidates.find((k) => parts.some((p) => p.key === k));
    if (!slot) {
      warnings.push(`刀光：${ownerLabel} 的锚点节点 ${anchorNode?.name ?? spec.anchorNodeId} 不是部件，未进包`);
      return undefined;
    }
    return {
      anchor: slot,
      durationSec: spec.durationSec ?? 0,
      frameCount: Math.max(2, Math.min(12, Math.round(spec.frameCount || 6))),
      w: spec.w, h: spec.h, cx: spec.cx, cy: spec.cy,
      ...(spec.dir === -1 ? { dir: -1 } : {}),
      rx: spec.rx, ry: spec.ry, rotDeg: spec.rotDeg,
      a0Deg: spec.a0Deg, sweepDeg: spec.sweepDeg,
      thick: spec.thick, gammaAng: spec.gammaAng, softRad: spec.softRad,
      ...(spec.colors && spec.colors.length >= 2 ? { colors: spec.colors } : {}),
    };
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
      if (nbRaw && !nb && !pixelCarriedNodes.has(nodeId)) warnings.push(`节点蓝图「${nodeName}」：无 transform 输出（像素类蓝图），未进包`);
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
      const rawGraph = perf.graphs[nodeId];
      // 刀光节点不是姿态内容（已由下方 resolvePerfSlash 从图单独
      // 提取）：翻译前摘除，免得采样路把它当不支持节点点名；摘空
      // 视同无姿态图、走既有口径
      const cleanedGraph = rawGraph ? graphWithoutSlashNodes(rawGraph) : undefined;
      const graph = cleanedGraph && cleanedGraph.nodes.length > 0 ? cleanedGraph : undefined;
      if (!graph) { warnings.push(`表演「${perf.name}」：节点 ${character.nodes[nodeId]?.name ?? nodeId} 在掩码内但没有表演图`); continue; }
      const res = translatePerformanceGraph(graph, slot, perf.duration, `g${gi++}_`);
      graphNodes.push(...res.nodes);
      if (!res.ok) warnings.push(`表演「${perf.name}」节点 ${character.nodes[nodeId]?.name ?? nodeId} 的图翻译失败：${res.reason}`);
      else if (res.maxAmp < 1e-4) warnings.push(`表演「${perf.name}」节点 ${character.nodes[nodeId]?.name ?? nodeId} 的图采样后无姿态贡献`);
      const unsupported = Object.entries(res.typeReport).filter(([, c]) => c === 'unsupported').map(([t]) => t);
      if (unsupported.length) warnings.push(`表演「${perf.name}」节点 ${character.nodes[nodeId]?.name ?? nodeId} 含运行时不支持的节点：${unsupported.join('、')}（其数值若未进 transform 输出则无影响）`);
    }
    const afterSlot = perf.afterimageNodeId ? toSlot(perf.afterimageNodeId) : null;
    if (perf.slashDefId && !findSlashDef(character.slashDefs, perf.slashDefId)) {
      warnings.push(`刀光：表演「${perf.name}」引用的共享定义（${perf.slashDefId}）不存在，未进包`);
    }
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
      // 刀光↔蓝图统一：只从表演图解析（slash_fan 节点，静态 params
      // 固化；未落盘同步的数据由 slash-sync 读侧镜像兜底）。
      // 绑定共享定义时解引用活读角色定义（悬空点名、不进包）
      slash: slashForPkg(resolvePerfSlash(perf, undefined, character.slashDefs), `表演「${perf.name}」`),
      graph: { context: 'performance', nodes: graphNodes },
    });
  }

  // ---- 实时模拟链（D6 乙路）：包级一份定义，锚帧 0 平结算 ----
  const simChainsPkg = buildSimChains(
    character, projectFpsTop, toSlot, new Set(parts.map((p) => p.key)), warnings);

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
    // ---- 片段级点名（缺口 5/6）：片段内的状态切换与特效数据不进包 ----
    for (const c of opts?.clips ?? []) {
      if ((c.trajectories?.length ?? 0) > 0) warnings.push(`片段「${c.name}」内的轨迹未进运行时包（v1）`);
    }
  // ---- 片段状态轨（缺口 6）：状态键 → 段表演内的定时状态切换 ----
  // 帧为工程绝对帧，换算为片段本地秒；窗外（起点之前）的键折叠到 0。
  // costumeSetId 指向不存在的集时点名丢弃；slotChanges 原样带（槽位
  // 变体在运行时经 altSprites 解析，见 parts 组装后的回填）。
  // 片段级特效数据（缺口 5）：挂段表演 fx，键帧/笔触帧均为工程绝对帧，
  // 运行时以 clip.startFrame + 本地帧求值（与状态轨同一帧口径）。
  const clipFxOf = (clip: AnimationClip) => {
    const fx: Record<string, unknown> = {};
    if (clip.effectTracks?.length) fx.effectTracks = clip.effectTracks;
    if (clip.canvasModifierTracks?.length) fx.canvasTracks = clip.canvasModifierTracks;
    if (clip.motionBlurStrokes?.length) fx.motionBlurStrokes = clip.motionBlurStrokes;
    if (clip.effectStrokes?.length) fx.effectStrokes = clip.effectStrokes;
    return Object.keys(fx).length > 0 ? fx : undefined;
  };
  const stateFxOf = (clip: AnimationClip) => {
    const keys = [...(clip.stateKeyframes ?? [])].sort((a, b) => a.frame - b.frame);
    if (keys.length === 0) return undefined;
    const fx: Array<Record<string, unknown>> = [];
    for (const k of keys) {
      const e: Record<string, unknown> = { t: Math.max(0, (k.frame - clip.startFrame) / projectFpsTop) };
      if (k.costumeSetId) {
        if (character.costumeSets.some((cs) => cs.id === k.costumeSetId)) e.costume = k.costumeSetId;
        else warnings.push(`片段「${clip.name}」状态键指向不存在的服装集 ${k.costumeSetId}，已丢弃`);
      }
      if (k.slotChanges && Object.keys(k.slotChanges).length > 0) e.slots = k.slotChanges;
      if ('costume' in e || 'slots' in e) fx.push(e);
    }
    return fx.length > 0 ? fx : undefined;
  };

    const clipList = (opts?.clips ?? []).filter((c) =>
      c.puppetCharacterId === character.id
      && typeof c.startFrame === 'number' && typeof c.endFrame === 'number'
      && c.endFrame >= c.startFrame);
    const emittedClipPerfIds = new Set<string>();
    // 片段刀光共享定义悬空点名（每片段只报一次；悬空解析为无刀光，
    // 绝不静默回落私有字段冒充）
    const slashDanglingWarned = new Set<string>();
    const warnClipSlashDangling = (clip: AnimationClip) => {
      if (!clip.slashDefId || findSlashDef(character.slashDefs, clip.slashDefId)) return;
      if (slashDanglingWarned.has(clip.id)) return;
      slashDanglingWarned.add(clip.id);
      warnings.push(`刀光：片段「${clip.name}」引用的共享定义（${clip.slashDefId}）不存在，未进包`);
    };
    if (trackNodes.length > 0) {
      const frameRate = opts?.frameRate && opts.frameRate > 0 ? opts.frameRate : 12;
      const partKeys = new Set(parts.map((p) => p.key));
      // 不支持通道点名（仅在关键帧真偏离静态值时；恒等空转不算损失）。
      // zIndex 轨同理：主渲染画序未消费该轨，运行时包也不烘它。
      for (const node of Object.values(character.nodes)) {
        if (!node.tracks) continue;
        const baseOf: Record<string, number> = {
          stretch: node.transform.stretch,
          scaleX: node.transform.scaleX ?? 1, variantIndex: node.transform.variantIndex,
          zIndex: node.zIndex ?? 0,
        };
        // tilt 不再列缺失：其位姿效应经世界变换采样进 a/x/y，其精灵
        // 缩短效应经 fore 通道进包（缺口 7）。
        const bad = (['stretch', 'scaleX', 'variantIndex', 'zIndex'] as const).filter((ch) => {
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
      // 实时链的烘焙注入剥离：链根已改实时驱动时，其 angle 轨里可
      // 能还留着烘焙写回的关键帧——采样前按烘焙档案的基准本地角
      // 还原为常值轨，包内位姿不再含该链的烘焙摆幅（运行时由模拟
      // 遍接管，免双重施加）；烘焙模式链与布料一律不动。无档案的
      // 实时链从未烘焙过，轨道即作者原稿，保持原样。
      for (const rc of simChainsPkg) {
        const rec = character.chainBakes?.[rc.nodeId];
        if (!rec) {
          warnings.push(`实时模拟：链根「${character.nodes[rc.nodeId]?.name ?? rc.nodeId}」无烘焙档案，包内位姿按现轨道采样（无基准角可还原）`);
          continue;
        }
        let touched = false;
        rec.chainNodeIds.forEach((id, i) => {
          const n = stripped.nodes[id];
          if (!n) return;
          const base = rec.baseLocals[i] ?? n.transform.angle;
          stripped.nodes[id] = {
            ...n,
            tracks: { ...n.tracks, angle: { keyframes: [{ frame: 0, value: base }], interpolation: 'linear' as const } },
          };
          touched = true;
        });
        if (touched) warnings.push(`实时模拟：链根「${character.nodes[rc.nodeId]?.name ?? rc.nodeId}」的烘焙角轨已从包内位姿剥离，改由运行时模拟驱动`);
      }
      // ---- 堆叠层变换烘焙的采样对象：仅 spriteKind 堆叠件、且显示图
      // 确由同一摞合成（与 stackDisplayOf 几何比对一致）、默认集口径。
      // 挂在显示图上的发光场/标记/裁剪面在垫图时逐项补偿（坐标随内容
      // 平移，见 padStackDisplays），不再排除。 ----
      type StackFrameSample = { ops: StackDrawOp[]; pivotX: number; pivotY: number; w: number; h: number; mirror: boolean };
      const stackNodes = new Map<string, { slot: string; stack: NonNullable<CostumePiece['stack']>; layerSprites: (Sprite | undefined)[] }>();
      const stackYawDelta = character.facingAngle !== undefined
        ? facingYawDeltaRad(character.facingAngle, ((character.rootNodeId ? worlds.get(character.rootNodeId)?.variantIndex : undefined) ?? 0) as DirectionIndex)
        : 0;
      for (const part of parts) {
        if (!part.spriteKind || !part.stack || !part.sprite) continue;
        const piece = activeSet?.pieces[part.key];
        if (!piece?.stack) continue;
        const nodeId = slotNode.get(part.key);
        if (!nodeId) continue;
        const disp = stackDisplayOf(piece, nodeId);
        if (!disp || disp.w !== part.sprite.w || disp.h !== part.sprite.h
          || disp.plug[0] !== part.sprite.plug[0] || disp.plug[1] !== part.sprite.plug[1]) continue;
        stackNodes.set(nodeId, {
          slot: part.key, stack: piece.stack,
          layerSprites: piece.stack.layerSpriteIds.map((id) => spriteTable[id]),
        });
      }
      // 采样一个窗：工程帧 [startF, startF + D] 共 D+1 个样本（末样本为循环接点）；
      // 与部件摆放同一投影（projectToView，朝向取当帧根节点 variantIndex），
      // 运行时系（角度弧度、y 取反、px）
      const hasClamps = (character.clampAnchors ?? []).some((a) => a.enabled);
      const clampSnapshots = new Map<number, ClampStateMap>();
      if (hasClamps && (character.clampAnchors ?? []).some((a) => a.enabled && a.trigger.kind === 'scene')) {
        warnings.push('钳制锚定：scene 触发不进采样，运行时按 anchor 点标记对全部固体自动锚定');
      }
      const sampleWindow = (startF: number, D: number) => {
        const samples = new Map<string, Array<{ a: number; x: number; y: number; fore: number }>>();
        const stackSamples = new Map<string, Array<StackFrameSample | null>>();
        for (const snId of stackNodes.keys()) stackSamples.set(snId, []);
        // 钳制状态：整窗从空状态顺序步进并在每帧界留快照；片段窗从
        // 快照起算（裁决 6：convert 整窗跨片段延续、片段起点缓存）
        let clampState: ClampStateMap | null = null;
        if (hasClamps) {
          if (startF === 0) clampState = new Map();
          else if (clampSnapshots.has(startF)) clampState = cloneClampState(clampSnapshots.get(startF)!);
          else clampState = steppedClampState(stripped, startF - 1, 0, { canvasWidth: 512, canvasHeight: 512, frameRate: projectFpsTop });
        }
        for (let f = startF; f <= startF + D; f++) {
          let wf = computeWorldTransforms(stripped, f, 512, 512, projectFpsTop);
          if (clampState) {
            stepClampState(stripped, wf, clampState);
            if (startF === 0) clampSnapshots.set(f + 1, cloneClampState(clampState));
            wf = computeWorldTransforms(stripped, f, 512, 512, projectFpsTop, undefined, undefined, undefined, undefined, { frozen: clampState });
          }
          const dirF = (character.rootNodeId ? wf.get(character.rootNodeId)?.variantIndex : undefined) ?? rootDir;
          for (const node of Object.values(character.nodes)) {
            const w = wf.get(node.id);
            if (!w) continue;
            let arr = samples.get(node.id);
            if (!arr) { arr = []; samples.set(node.id, arr); }
            const proj = projectToView(w.worldX, w.worldY, w.worldZ, dirF as DirectionIndex);
            // 透视缩短因子（缺口 7）：与主画布 generateRenderPlan 同式——
            // 节点 +Y 轴（骨骼主轴）世界向量的视平面投影长度比，钳制 ≤1。
            const yw = frameYAxisWorld(w.worldFrame, (w.variantIndex ?? dirF) as DirectionIndex);
            const trigF = directionTrig(dirF as DirectionIndex);
            const fore = Math.min(1, Math.hypot(yw.x * trigF.cos + yw.z * trigF.sin, yw.y));
            arr.push({ a: -w.worldAngle * Math.PI / 180, x: subToPx(proj.canvasX), y: -subToPx(proj.canvasY), fore });
          }
          // 堆叠层算子：与静止显示图同一公式（computeStackOps）；偏航
          // 与静止口径一致地先转世界变换（姿态样本本身不转）
          if (stackNodes.size > 0) {
            let wfS = wf;
            if (stackYawDelta !== 0) { wfS = new Map(wf); rotateWorldTransformsForYaw(wfS, stackYawDelta); }
            // 接缝插值旋转：与编辑器同一公式——静止帧同源助手，
            // 偏航口径与当帧 wfS 一致地同步转
            let restS = computeRestWorldTransforms(stripped, dirF as DirectionIndex);
            if (stackYawDelta !== 0) { restS = new Map(restS); rotateWorldTransformsForYaw(restS, stackYawDelta); }
            for (const [snId, info] of stackNodes) {
              const sArr = stackSamples.get(snId)!;
              const w = wfS.get(snId);
              if (!w) { sArr.push(null); continue; }
              const snNode = character.nodes[snId];
              const bend = snNode ? stackBendForNode(snNode, info.stack, wfS, restS) : undefined;
              const res = computeStackOps(info.stack, info.layerSprites, w.worldFrame, w.worldAngle, STACK_VIEW_ELEVATION_DEG, bend);
              sArr.push(res.ops.length > 0
                ? { ops: res.ops, pivotX: res.pivotX, pivotY: res.pivotY, w: res.width, h: res.height, mirror: !!w.mirror }
                : null);
            }
          }
        }
        return { samples, stackSamples };
      };
      // 样本 → 曲线图节点（增量相对窗首样本）；warnNodes 时逐节点报无贡献
      const curvesForWindow = (
        samples: Map<string, Array<{ a: number; x: number; y: number; fore: number }>>,
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
          const mkPts = (pick: (s: { a: number; x: number; y: number; fore: number }) => number) =>
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
          // fore 通道：绝对因子点（非相对增量）；全程 ≈1 时不发（无倾斜）
          const forePts = arr.map((sm, f) => [f / D, sm.fore] as [number, number]);
          if (forePts.some(([, v]) => Math.abs(v - 1) > 1e-3)) {
            const id = `${prefix}fre`;
            nodes.push({ id, type: 'curve', points: simplify(forePts, 0.01) });
            tr.foreFrom = { n: id };
          }
          if (tr.angleFrom || tr.dxFrom || tr.dyFrom || tr.foreFrom) {
            nodes.push(tr);
            mask.push(slot);
            graphNodes.push(...nodes);
          } else if (warnNodes && trackNodes.includes(node)) {
            warnings.push(`轨道：节点 ${node.name} 的轨道采样后无姿态贡献（与静态姿态无差异或仅有不支持通道）`);
          }
        }
        return { graphNodes, mask };
      };
      // ---- 堆叠层变换：跨窗并集画布 + 锚点归一化算子 + 垫显示图 ----
      // 算子原本活在各自帧的紧画布里；统一平移到全窗并集画布（锚点 =
      // 显示图 plug），播放器才能把任意帧的算子栅格化进同一张瓦片。
      const stackUnion = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
      const feedStackBox = (slot: string, minX: number, minY: number, maxX: number, maxY: number) => {
        let u = stackUnion.get(slot);
        if (!u) { u = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }; stackUnion.set(slot, u); }
        u.minX = Math.min(u.minX, minX); u.minY = Math.min(u.minY, minY);
        u.maxX = Math.max(u.maxX, maxX); u.maxY = Math.max(u.maxY, maxY);
      };
      const feedStackUnion = (ss: Map<string, Array<StackFrameSample | null>>) => {
        for (const [nodeId, arr] of ss) {
          const slot = stackNodes.get(nodeId)?.slot;
          if (!slot) continue;
          for (const sm of arr) {
            if (!sm) continue;
            feedStackBox(slot, -sm.pivotX, -sm.pivotY, sm.w - sm.pivotX, sm.h - sm.pivotY);
          }
        }
      };
      const unionPx = (slot: string) => {
        const u = stackUnion.get(slot)!;
        const fx = Math.floor(u.minX), fy = Math.floor(u.minY);
        return { W: Math.ceil(u.maxX) - fx, H: Math.ceil(u.maxY) - fy, px: -fx, py: -fy };
      };
      const r3 = (v: number) => Math.round(v * 1000) / 1000;
      const stackFrameOps = (sm: StackFrameSample, slot: string): number[][] => {
        const { px, py } = unionPx(slot);
        return sm.ops.map((op) => {
          let a = op.tr[0], b = op.tr[1], c = op.tr[2], d = op.tr[3];
          let e = op.tr[4] - sm.pivotX, f = op.tr[5] - sm.pivotY;
          if (sm.mirror) { a = -a; c = -c; e = -e; }
          return [op.layer, r3(a), r3(b), r3(c), r3(d), r3(e + px), r3(f + py)];
        });
      };
      const stackStaticKeyCache = new Map<string, string>();
      const stackStaticKey = (slot: string): string => {
        const hit = stackStaticKeyCache.get(slot);
        if (hit !== undefined) return hit;
        let key = '';
        const nodeId = slotNode.get(slot);
        const info = nodeId ? stackNodes.get(nodeId) : undefined;
        const w = nodeId ? worlds.get(nodeId) : undefined;
        if (info && w) {
          const res = computeStackOps(info.stack, info.layerSprites, w.worldFrame, w.worldAngle);
          if (res.ops.length > 0) {
            key = JSON.stringify(stackFrameOps(
              { ops: res.ops, pivotX: res.pivotX, pivotY: res.pivotY, w: res.width, h: res.height, mirror: !!w.mirror }, slot));
          }
        }
        stackStaticKeyCache.set(slot, key);
        return key;
      };
      // 一窗的层变换组帧：全窗恒定则塌成一帧；与静止合成一致则整槽略去
      const stackFramesForWindow = (
        ss: Map<string, Array<StackFrameSample | null>>,
      ): Record<string, { costume: string; frames: number[][][] }> | undefined => {
        const out: Record<string, { costume: string; frames: number[][][] }> = {};
        for (const [nodeId, arr] of ss) {
          const info = stackNodes.get(nodeId);
          if (!info || arr.length === 0) continue;
          const slot = info.slot;
          let frames = arr.map((sm) => (sm ? stackFrameOps(sm, slot) : []));
          const keys = frames.map((fr) => JSON.stringify(fr));
          if (keys.every((k) => k === keys[0])) frames = [frames[0]!];
          if (frames.length === 1 && keys[0] === stackStaticKey(slot)) continue;
          out[slot] = { costume: activeSet?.id ?? '', frames };
        }
        return Object.keys(out).length > 0 ? out : undefined;
      };
      // 显示图标记随垫图补偿：标记坐标是归一 0..1（点/矢量原点与分量、
      // 矩形选区按新旧尺寸换算）；涂画选区是像素位图、逐格平移重打包；
      // 圆形选区在各向异性垫图下不再是圆，按旧格心判定烘成涂画选区保
      // 逐格一致；取色/值/方向无坐标不动。摞本体 marks（part.stack）
      // 是摞自身口径，不随显示呈现垫图而动。
      const shiftMarks = (marks: SpriteMark[], W: number, H: number, W2: number, H2: number, dx: number, dy: number): SpriteMark[] =>
        marks.map((m) => {
          switch (m.kind) {
            case 'point':
              return { ...m, x: (m.x * W + dx) / W2, y: (m.y * H + dy) / H2 };
            case 'vector':
              return { ...m, x: (m.x * W + dx) / W2, y: (m.y * H + dy) / H2, dx: (m.dx * W) / W2, dy: (m.dy * H) / H2 };
            case 'region': {
              const r = m.region;
              if (r.by === 'rect') {
                return { ...m, region: { ...r, x: (r.x * W + dx) / W2, y: (r.y * H + dy) / H2, w: (r.w * W) / W2, h: (r.h * H) / H2 } };
              }
              if (r.by === 'circle') {
                const cells = new Uint8Array(W2 * H2);
                for (let y = 0; y < H; y++) {
                  for (let x = 0; x < W; x++) {
                    const nx = (x + 0.5) / W, ny = (y + 0.5) / H;
                    if (Math.hypot(nx - r.cx, ny - r.cy) <= r.r) cells[(y + dy) * W2 + (x + dx)] = 1;
                  }
                }
                return { ...m, region: { by: 'painted' as const, mask: { w: W2, h: H2, bits: packMaskBits(cells) } } };
              }
              if (r.by === 'painted') {
                const src = unpackMaskBits(r.mask.bits, r.mask.w * r.mask.h);
                const cells = new Uint8Array(W2 * H2);
                for (let y = 0; y < r.mask.h; y++) {
                  for (let x = 0; x < r.mask.w; x++) {
                    if (!src[y * r.mask.w + x]) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && ny >= 0 && nx < W2 && ny < H2) cells[ny * W2 + nx] = 1;
                  }
                }
                return { ...m, region: { by: 'painted' as const, mask: { w: W2, h: H2, bits: packMaskBits(cells) } } };
              }
              return m;
            }
            default:
              return m;
          }
        });
      const padStackDisplays = () => {
        for (const slot of stackUnion.keys()) {
          const part = parts.find((p) => p.key === slot);
          if (!part?.sprite) continue;
          const { W, H, px, py } = unionPx(slot);
          const sg = part.sprite;
          if (sg.w === W && sg.h === H && sg.plug[0] === px && sg.plug[1] === py) continue;
          const dx = px - sg.plug[0], dy = py - sg.plug[1];
          const dW = W - sg.w, dH = H - sg.h;
          const data: PixelGrid = [];
          for (let y = 0; y < H; y++) {
            const row: (string | null)[] = new Array(W).fill(null);
            const oy = y - dy;
            if (oy >= 0 && oy < sg.h) {
              const orow = sg.data[oy];
              if (orow) for (let x = 0; x < W; x++) {
                const ox = x - dx;
                if (ox >= 0 && ox < sg.w) row[x] = orow[ox] ?? null;
              }
            }
            data.push(row);
          }
          const padded = {
            ...sg, w: W, h: H, plug: [px, py] as [number, number], data,
            marks: sg.marks ? shiftMarks(sg.marks, sg.w, sg.h, W, H, dx, dy) : sg.marks,
          };
          part.sprite = padded;
          part.base.size = [W, H];
          // 发光场补偿：场内容不动、采样窗随显示内容平移（padX/Y 反向
          // 减垫量；默认集条目与 part.glow 同对象，一处即全）
          if (part.glow) { part.glow.padX -= dx; part.glow.padY -= dy; }
          // 裁剪面补偿：锚在本槽的平面随锚图内容平移——内容相对图心
          // 的位移 = 垫量 − 尺寸增量/2，常量 c 按 a·sx + b·sy 修正
          const sx = dx - dW / 2, sy = dy - dH / 2;
          if (sx !== 0 || sy !== 0) {
            for (const p2 of parts) {
              if (p2.clip && p2.clip.by === slot) {
                p2.clip = { ...p2.clip, c: p2.clip.c - (p2.clip.a * sx + p2.clip.b * sy) };
              }
            }
          }
          const sm = (activeSet ? costumes[activeSet.id]?.__sprite : undefined) as Record<string, unknown> | undefined;
          if (sm && sm[slot]) sm[slot] = padded;
        }
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
      const fullSamples = sampleWindow(0, totalFrames);
      const full = curvesForWindow(fullSamples.samples, totalFrames, 't', true);
      // 堆叠层变换：片段窗先全部采样（并集画布跨窗算），再统一垫显示图
      const sortedClips = [...clipList].sort((a, b) => a.startFrame - b.startFrame);
      const clipSamples = new Map<AnimationClip, ReturnType<typeof sampleWindow>>();
      for (const clip of sortedClips) {
        clipSamples.set(clip, sampleWindow(clip.startFrame, clip.endFrame - clip.startFrame + 1));
      }
      if (stackNodes.size > 0) {
        feedStackUnion(fullSamples.stackSamples);
        for (const cs of clipSamples.values()) feedStackUnion(cs.stackSamples);
        // 显示图自身内容框并入并集（回落图不被垫图裁掉）
        for (const info of stackNodes.values()) {
          const part = parts.find((p) => p.key === info.slot);
          if (part?.sprite) {
            feedStackBox(info.slot, -part.sprite.plug[0], -part.sprite.plug[1],
              part.sprite.w - part.sprite.plug[0], part.sprite.h - part.sprite.plug[1]);
          }
        }
        padStackDisplays();
      }
      const fullStackFrames = stackFramesForWindow(fullSamples.stackSamples);
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
          ...(fullStackFrames ? { stackFrames: fullStackFrames } : {}),
        });
        if (fullStackFrames) for (const slot of Object.keys(fullStackFrames)) stackBakedSlots.add(slot);
      }
      // ---- 追随段：锚定增量曲线烘焙（甲：摆角 + 沿轴缩放） ----
      // 连接点锚死：源部件轨道样本的平移增量不再整件平移跟随者，
      // 而是按「跟随者自己的主轴方向 × 臂长」逐件换算成摆角 da 与
      // 沿轴缩放 ds（followAnchoredDeltaAt，与编辑器实时落点同一
      // 公式、同一尖端落点）。曲线因此逐跟随者一份（缓存键含跟随
      // 者与臂长），不再同源同参共享。源静止时仍不产曲线。
      {
        const bags: { inst: RuntimeDynamicInstance; slotKey: string }[] = [];
        for (const p of parts) for (const d of p.dynamic ?? []) bags.push({ inst: d, slotKey: p.key });
        for (const cs of Object.values(costumes)) {
          const dm = (cs as { __dynamic?: Record<string, RuntimeDynamicInstance[]> }).__dynamic;
          if (dm) for (const [slotKey, arr] of Object.entries(dm)) {
            for (const d of arr) bags.push({ inst: d, slotKey });
          }
        }
        const curveCache = new Map<string, RuntimeDynamicInstance['followCurve']>();
        for (const { inst, slotKey } of bags) {
          const fp = inst.params;
          if (!fp.followEnabled) continue;
          if (!fp.followSource) {
            warnings.push(`追随：部件 ${slotKey} 的动态实例已启用追随但未选源部件，未烘焙`);
            continue;
          }
          const srcNode = Object.values(character.nodes).find(
            (n) => (n.slot?.slotKey ?? n.id) === fp.followSource);
          const srcSamples = srcNode ? fullSamples.samples.get(srcNode.id) : undefined;
          if (!srcSamples) {
            warnings.push(`追随：部件 ${slotKey} 的源部件「${fp.followSource}」不存在，未烘焙`);
            continue;
          }
          // 跟随者自身样本（算主轴方向）与臂长（精灵件取代表图高 −
          // plug y；参数化件由编辑器 plug 定义换算 size/2 + pivot）
          const folNode = Object.values(character.nodes).find(
            (n) => (n.slot?.slotKey ?? n.id) === slotKey);
          const folSamples = folNode ? fullSamples.samples.get(folNode.id) : undefined;
          const folPart = parts.find((p) => p.key === slotKey);
          let reach = 0;
          if (folPart?.sprite) {
            reach = Math.max(0, folPart.sprite.h - (folPart.sprite.plug ? folPart.sprite.plug[1] : folPart.sprite.h / 2));
          } else if (folPart?.base) {
            reach = Math.max(0, folPart.base.size[1] / 2 + folPart.base.pivot[1]);
          }
          const delayFrames = Math.round(fp.followDelaySec * frameRate);
          const cacheKey = `${fp.followSource}|${delayFrames}|${fp.followAmount}|${fp.followRotate}|${slotKey}|${Math.round(reach * 10)}`;
          let curve = curveCache.get(cacheKey);
          if (curve === undefined) {
            const daPts: [number, number][] = [], dsPts: [number, number][] = [];
            for (let f = 0; f <= totalFrames; f++) {
              const cur = srcSamples[f];
              const lag = srcSamples[Math.max(0, f - delayFrames)];
              if (!cur || !lag) continue;
              // 采样空间主轴：a 为跟随者自身样本角（x 同画布、y 取反、
              // a = −画布角），u = (sin a, −cos a)
              const fa = folSamples?.[f]?.a ?? 0;
              const d = followAnchoredDeltaAt(cur, lag, fp.followAmount, fp.followRotate, Math.sin(fa), -Math.cos(fa), reach);
              daPts.push([f / totalFrames, d.da]);
              dsPts.push([f / totalFrames, d.ds]);
            }
            const keepDa = (pts: [number, number][]) =>
              pts.every(([, v]) => Math.abs(v) < 1e-4) ? undefined : simplify(pts, 0.01);
            const keepDs = (pts: [number, number][]) =>
              pts.every(([, v]) => Math.abs(v - 1) < 1e-3) ? undefined : simplify(pts, 0.01);
            const da = keepDa(daPts), ds = keepDs(dsPts);
            curve = da || ds ? { da, ds } : undefined;
            curveCache.set(cacheKey, curve);
          }
          if (curve) inst.followCurve = curve;
        }
      }
      // 片段窗 → 段表演（按窗起点排序，状态机/宿主按 id 或名触发）
      let ci = 0;
      for (const clip of sortedClips) {
        const len = clip.endFrame - clip.startFrame + 1;
        const clipSampled = clipSamples.get(clip)!;
        const seg = curvesForWindow(clipSampled.samples, len, `c${ci++}_`, false);
        const segStackFrames = stackFramesForWindow(clipSampled.stackSamples);
        // 片段刀光：私有字段或共享定义活引用，同一解析入口
        const clipSlash = resolveClipSlash(clip, character.slashDefs);
        warnClipSlashDangling(clip);
        if (seg.graphNodes.length === 0 && !clipSlash) {
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
          slash: slashForPkg(clipSlash, `片段「${clip.name}」`),
          graph: { context: 'performance', nodes: seg.graphNodes },
          ...(segStackFrames ? { stackFrames: segStackFrames } : {}),
          stateFx: stateFxOf(clip),
          fx: clipFxOf(clip),
          fxStart: clip.startFrame,
        });
        emittedClipPerfIds.add(`clip_${clip.id}`);
        if (segStackFrames) for (const slot of Object.keys(segStackFrames)) stackBakedSlots.add(slot);
      }
    }
    // 刀光专用片段：角色全无姿态轨道时采样块整体跳过，段表演仍须
    // 生成（刀光本身就是该片段的内容），否则引用悬空且无声丢失
    for (const clip of clipList) {
      const clipSlash = resolveClipSlash(clip, character.slashDefs);
      warnClipSlashDangling(clip);
      if (!clipSlash || emittedClipPerfIds.has(`clip_${clip.id}`)) continue;
      const rate = opts?.frameRate && opts.frameRate > 0 ? opts.frameRate : 12;
      performances.push({
        id: `clip_${clip.id}`,
        name: clip.name,
        trigger: 'clip',
        duration: (clip.endFrame - clip.startFrame + 1) / rate,
        envelope: { in: 0, out: 0 },
        mode: 'add',
        loop: clip.loop === true,
        mask: [],
        slash: slashForPkg(clipSlash, `片段「${clip.name}」`),
        graph: { context: 'performance', nodes: [] },
        stateFx: stateFxOf(clip),
        fx: clipFxOf(clip),
        fxStart: clip.startFrame,
      });
    }
  }

  // ---- 堆叠进包口径点名（逐槽：层变换已烘 / 仅静止图回落） ----
  for (const slot of stackPartSlots) {
    if (stackBakedSlots.has(slot)) {
      warnings.push(`精灵堆叠：槽位 ${slot} 的摞已全量进包（part.stack）；轨道/片段动画的层变换已逐帧烘焙（stackFrames），播放器在这些表演主导时逐层真合成；行为图等其他位姿来源下仍显示第 0 帧静止合成图`);
    } else {
      warnings.push(`精灵堆叠：槽位 ${slot} 的摞已全量进包（part.stack）；播放器位姿为 2D，显示图按第 0 帧静止朝向合成，逐帧 3D 合成不在包内`);
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


  // ---- 程序化动画（缺口 2）：与编辑器同口径——PA 只在目标节点挂有
  // 对应类型的启用修改器时才生效（applyProceduralAnimations 的查找
  // 规则），不满足的在编辑器内同样无效，逐条点名不进包；只认
  // nodeId 的条目（编辑器主渲染只按 nodeId 匹配，spriteId-only 的
  // 历史条目在编辑器内亦不生效，同口径点名）。 ----
  const procedural: NonNullable<ProcRuntimePackage['procedural']> = [];
  for (const pa of opts?.projectData?.proceduralAnimations ?? []) {
    if (!pa.enabled) continue;
    if (!pa.nodeId) { warnings.push(`程序化动画「${pa.name}」只有 spriteId 无 nodeId：编辑器主渲染亦不生效，未进包`); continue; }
    const node = character.nodes[pa.nodeId];
    if (!node) { warnings.push(`程序化动画「${pa.name}」目标节点不存在，未进包`); continue; }
    const need = pa.config.targetProperty === 'rotation' ? 'rotate' : pa.config.targetProperty === 'scale' ? 'uniform_scale' : 'translate';
    if (!(node.modifiers ?? []).some((m) => m.type === need && m.enabled)) {
      warnings.push(`程序化动画「${pa.name}」目标节点无启用的 ${need} 修改器：编辑器内同样不生效，未进包`);
      continue;
    }
    procedural.push({
      slot: node.slot?.slotKey ?? node.id,
      target: pa.config.targetProperty,
      cfg: pa.config as unknown as Record<string, unknown>,
      startFrame: pa.startFrame,
      endFrame: pa.endFrame,
    });
  }

  // ---- 全局变换（缺口 3）：与编辑器 applyGlobalTransformWrapper 同
  // 口径——全局蓝图只在全局修改器非空时才被使用（编辑器同一闸门）；
  // 图经剪变换通道后按行为图同一翻译器进包，运行时逐帧求值施加于
  // 整场。图里引用节点输出的通道在翻译器内按不支持处理并点名。 ----
  let globalGraph: RuntimeGraph | undefined;
  {
    const gMods = opts?.projectData?.globalModifiers ?? [];
    if (gMods.length > 0) {
      const gRaw0 = opts?.projectData?.globalBlueprint
        ?? modifiersToBlueprint(gMods as never);
      const gRaw = gRaw0 ? normalizeGraphOutput(gRaw0) : null;
      const gPruned = gRaw && graphTransformNode(gRaw) ? pruneToTransform(gRaw) : null;
      if (gRaw && !gPruned) warnings.push('全局蓝图/全局修改器：无 transform 输出（像素类），未进包');
      else if (gPruned) {
        const res = translateBehaviorGraph(gPruned, '__global', 'gl_', () => null);
        for (const w of res.warnings) warnings.push(`全局变换：${w}`);
        if (!res.ok) warnings.push(`全局变换翻译失败：${res.reason}`);
        else globalGraph = { context: 'behavior', nodes: res.nodes };
      }
    } else if (opts?.projectData?.globalBlueprint) {
      warnings.push('工程级全局蓝图未进运行时包：编辑器内全局蓝图仅在全局修改器非空时生效，现无全局修改器（同口径）');
    }
  }

  const fxPkg: ProcRuntimePackage['fx'] = (() => {
    const pd = opts?.projectData;
    if (!pd) return undefined;
    return {
      canvas: { w: pd.canvasWidth ?? 512, h: pd.canvasHeight ?? 512 },
      totalFrames: opts?.totalFrames && opts.totalFrames > 0 ? opts.totalFrames : 1,
      effectTracks: pd.effectTracks,
      canvasTracks: pd.canvasModifierTracks,
      motionBlurStrokes: pd.motionBlurStrokes,
      effectStrokes: pd.effectStrokes,
    };
  })();

  // 注：动态实例 params 整份进包——追随/发光形状等键随包播放器不读
  // （生效数据已烘成 followCurve / 印章与场），但包的消费方还有拿到
  // 包的用户端，其代码可读这些原始参数做自己的处理，不按播放器
  // 读没读判死删除（2026-10-26 用户纠正）。

  // 场景实体透传：只收有限数、宽高至少 2，其余条目点名丢弃
  const scenePkg = ((): ProcRuntimePackage['scene'] => {
    const list = opts?.projectData?.scene?.solids;
    if (!Array.isArray(list) || list.length === 0) return undefined;
    const solids: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const q of list) {
      const x = Number(q?.x), y = Number(q?.y), w = Number(q?.w), h = Number(q?.h);
      if ([x, y, w, h].every(Number.isFinite) && w >= 2 && h >= 2) solids.push({ x, y, w, h });
      else warnings.push('场景实体被丢弃（坐标非有限数或宽高小于 2）：' + JSON.stringify(q));
    }
    return solids.length > 0 ? { solids } : undefined;
  })();

  // 骨骼名/父子表：slotNode 是 slotKey → nodeId，反查得 nodeId → 部件
  // 键；逐部件取节点名与父节点部件键（父不在包内部件集时记 null）。
  const nodeSlot = new Map<string, string>();
  for (const [k, nid] of slotNode) nodeSlot.set(nid, k);
  const partKeySet = new Set(parts.map((p) => p.key));
  const skeleton: NonNullable<ProcRuntimePackage['skeleton']> = [];
  for (const p of parts) {
    const nodeId = slotNode.get(p.key);
    const node = nodeId ? character.nodes[nodeId] : undefined;
    if (!node) continue;
    const parentKey = node.parentId ? nodeSlot.get(node.parentId) : undefined;
    skeleton.push({
      key: p.key,
      name: node.name ?? p.key,
      parent: parentKey && partKeySet.has(parentKey) ? parentKey : null,
    });
  }

  return {
    format: 'procedural-pixel-runtime-1',
    characterName: character.name,
    simMode: 'frame',
    chains: simChainsPkg.length > 0 ? simChainsPkg : undefined,
    frameRate: projectFpsTop,
    palettes: PALETTES,
    parts,
    skeleton: skeleton.length > 0 ? skeleton : undefined,
    costumes,
    defaultCostume: activeSet?.id,
    behavior,
    performances,
    stateMachine,
    procedural: procedural.length > 0 ? procedural : undefined,
    globalGraph,
    fx: fxPkg,
    scene: scenePkg,
    warnings,
  };
}
