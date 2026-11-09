// ============================================================
// 模式库统一条目（DESIGN-DAG-LIBRARY 已定稿）：动态与表面同一
// 套条目/版本纪律——条目 = 稳定 id + 已发布版本表（不可变）+
// 至多一份草稿；引用一律钉 id@版本；编辑只写草稿，「发布」
// 才 +1；升级是引用方的显式动作（只写引用方草稿）。
// 动态条目分叶子（段参数 + 参数口）与父模式（子模式引用 +
// 配合边）；展开产出现行扁平 DynamicPatternParams，求值层
// 零改动。表面条目 def = 现行 PatternTemplate 的图部分，展开
// 仍走 graph-expand（ref 在那里做版本解析）。
// ============================================================

import {
  DYNAMIC_PATTERN_TEMPLATES, defaultDynamicParams, findDynamicTemplate,
  type DynamicPatternParams,
} from './dynamic-patterns';
import { PATTERN_TEMPLATES, type PatternParamDef, type PatternTemplate } from './proc-runtime/pattern-templates';
import type { SurfaceGraph } from './unified-types';

export type DynParamKey = keyof DynamicPatternParams;

/** 表面条目一个版本的定义（= 子图可引用形） */
export interface SurfaceEntryDef {
  params: PatternParamDef[];
  graph: SurfaceGraph;
  outputs?: Record<string, string>;
}

/** 动态叶子：只写它管的段的键；expose = 参数口（可被覆盖/接线） */
export interface DynamicLeafDef {
  kind: 'leaf';
  segments: Partial<DynamicPatternParams>;
  expose: DynParamKey[];
}

export interface DynChildRef {
  entry: string;
  version: number;
  overrides?: Partial<DynamicPatternParams>;
}

/** 配合边（封闭三种；v1 调制只支持 形变量 → 发射率 这条现行通道） */
export type CoordinationEdge =
  | { type: 'modulate'; fromChild: number; from: 'deformAmount' | 'glowPulse'; toChild: number; toKey: DynParamKey; depth: number }
  | { type: 'phase'; baseChild: number; offsets: Record<number, number> }
  | { type: 'followParams'; leader: number; follower: number; keys: DynParamKey[] };

/** 动态父模式：子模式引用 + 配合边（子模式可为另一父模式，递归） */
export interface DynamicParentDef {
  kind: 'parent';
  children: DynChildRef[];
  coordination: CoordinationEdge[];
}

export type DynamicEntryDef = DynamicLeafDef | DynamicParentDef;

/** 链条目暴露参数口：指向模板内某节点的某个参数（面板展示/说明用） */
export interface ChainExpose {
  node: string;
  key: string;
  label: string;
}

/**
 * 链条目定义：一段像素链模板（节点蓝图形状，局部 id）。
 * 哨兵引用：inputs 里的 nodeId '@in' = 段入口像素（插入时接原 screen 的
 * 像素来源），'@time' = 目标图的时间节点。entry = 段的像素出口节点 id
 * （插入时它的 pixels 输出接 screen）。节点类型限像素链支持集
 * （PIXEL_CHAIN_PIXEL_TYPES / PIXEL_CHAIN_NUMERIC_TYPES），保证进包可真跑。
 */
export interface ChainEntryDef {
  kind: 'chain';
  nodes: import('./blueprint/ir').BlueprintNode[];
  entry: string;
  expose: ChainExpose[];
}

/** 脸型条目定义：五官点位参数组（相对头部框的比例，见 face-features） */
export interface FaceEntryDef {
  kind: 'face';
  params: import('./face-features').FaceFeatureParams;
}

/**
 * 机甲条目定义。模式与算子可以无限组合，机甲条目同样两式：
 * gen 式 = 生成器 + 规格选择（gen 定部位/装备；family/scheme 定族
 * 与配色；overrides = 变体槽选择与数值参数的稀疏覆盖，与向导同一
 * 套覆盖类型，空 = 族预设全量）；combo 式 = 钉版引用其他机甲条目
 * 组合（可嵌组合），每件可带 as 命名与 def 覆写（覆写即派生变体）。
 * 调用 = 按 def 出精灵（mecha/entry-render），输出按名取。
 */
export interface MechaGenDef {
  kind: 'mecha';
  form: 'gen';
  gen: 'leg' | 'arm' | 'torso' | 'head' | 'hand' | 'hull' | 'multileg' | 'track' | 'wheel' | 'jetpack' | 'weapon';
  family: import('./mecha/parts').MechaFamily;
  scheme?: import('./mecha/parts').MechaSchemeName;
  profile?: 'spider' | 'quad';
  hullKind?: 'walker' | 'hauler';
  weaponKind?: import('./mecha/gear').WeaponKind;
  /** 着色条目引用（'id@版本'）：着色是独立模式，机甲条目钉版引用 */
  finish?: string;
  /** 表面材质条目引用（'id@版本'，表面模板）：作用于该 def 的全部输出 */
  surface?: string;
  /** 表面模板参数覆写（键 = 模板参数 key） */
  surfaceParams?: Record<string, number>;
  overrides?: import('./mecha/parts').MechaPartOverrides;
  hullOverrides?: import('./mecha/parts').MechaHullOverrides;
}
export interface MechaComboPart {
  entry: string;
  version: number;
  /** 输出命名前缀（同名输出靠它区分，如 armL/armR） */
  as?: string;
  /** 对子条目 def 的覆写（派生变体：换配色/换着色/改规格） */
  ov?: Partial<Pick<MechaGenDef, 'scheme' | 'finish' | 'surface' | 'surfaceParams' | 'overrides' | 'hullOverrides'>>;
}
export interface MechaComboDef {
  kind: 'mecha';
  form: 'combo';
  parts: MechaComboPart[];
}
export type MechaEntryDef = MechaGenDef | MechaComboDef;

/**
 * 着色条目定义。分层要分清：高光棱、料厚、做旧、迷彩、分面、壳
 * 面、盖章、面板线、线缆着色是着色层的算子（单一 pass + 自带参
 * 数），不是模式；模式是把算子组合起来的着色组合（combo 式）：
 * 钉版引用算子条目并给各自的参数覆写。展开（entry-render）产出
 * 现行扁平着色参数，生成器零改动——与动态父模式展开同一纪律。
 */
export type FinishPass =
  | 'ridges' | 'thickness' | 'wear' | 'camo' | 'facets'
  | 'shell' | 'stamps' | 'panel' | 'cables' | 'intake' | 'wedges' | 'seam';
export interface FinishPassParams {
  amount?: number; enabled?: boolean; ratio?: number; twoTone?: boolean;
  detail?: number; decalKind?: 'num' | 'plate' | 'none';
  tint?: [number, number, number];
  rim?: number; pitch?: number; peak?: number; fall?: number; accentSlats?: boolean;
  topTone?: number; topGrad?: number;
  density?: number;
}
export interface FinishPassDef {
  kind: 'finish';
  form: 'pass';
  pass: FinishPass;
  params: FinishPassParams;
}
export interface FinishComboDef {
  kind: 'finish';
  form: 'combo';
  parts: { entry: string; version: number; params?: FinishPassParams }[];
}
export type FinishEntryDef = FinishPassDef | FinishComboDef;

export type EntryDef = SurfaceEntryDef | DynamicEntryDef | ChainEntryDef | FaceEntryDef | MechaEntryDef | FinishEntryDef;

export interface LibraryEntry {
  id: string;
  kind: 'surface' | 'dynamic' | 'chain' | 'face' | 'mecha' | 'finish';
  name: string;
  cluster: string;
  versions: Record<number, EntryDef>;
  draft?: EntryDef;
  latest: number;
  builtin?: boolean;
}

/** 引用字符串 'id@版本' 的解析（无 @ = 存量浮动引用） */
export function parseRefId(s: string): { id: string; version?: number } {
  const at = s.lastIndexOf('@');
  if (at > 0) {
    const v = Number(s.slice(at + 1));
    if (Number.isInteger(v) && v > 0) return { id: s.slice(0, at), version: v };
  }
  return { id: s };
}

export function formatRefId(id: string, version: number): string {
  return `${id}@${version}`;
}

/** 条目索引（id → 条目）；同 id 后者胜 */
export type LibraryIndex = ReadonlyMap<string, LibraryEntry>;

export function libraryIndexOf(entries: readonly LibraryEntry[]): Map<string, LibraryEntry> {
  const map = new Map<string, LibraryEntry>();
  for (const e of entries) map.set(e.id, e);
  return map;
}

/** 取某版本的 def（version 缺省 = 最新发布版）；不存在返回 undefined */
export function defOf(
  index: LibraryIndex, id: string, version?: number,
): { def: EntryDef; version: number } | undefined {
  const e = index.get(id);
  if (!e) return undefined;
  const v = version ?? e.latest;
  const def = e.versions[v];
  return def ? { def, version: v } : undefined;
}

// ---------------- 内置条目 ----------------

function dynLeafFromTemplate(
  id: string, tplName: string, segmentKeys?: DynParamKey[],
): LibraryEntry | undefined {
  const tpl = findDynamicTemplate(tplName);
  if (!tpl) return undefined;
  const def = defaultDynamicParams();
  const segments: Partial<DynamicPatternParams> = {};
  const keys = segmentKeys ?? (Object.keys(tpl.params) as DynParamKey[]);
  for (const k of keys) {
    const v = tpl.params[k];
    if (JSON.stringify(v) !== JSON.stringify(def[k])) {
      (segments as Record<string, unknown>)[k] = v;
    }
  }
  // 显式指定的段键即使等于缺省也要写下（段归属是语义，不是差量）
  if (segmentKeys) {
    for (const k of segmentKeys) (segments as Record<string, unknown>)[k] = tpl.params[k];
  }
  return {
    id, kind: 'dynamic', name: tpl.name, cluster: tpl.cluster, builtin: true,
    latest: 1,
    versions: {
      1: { kind: 'leaf', segments, expose: Object.keys(segments) as DynParamKey[] } satisfies DynamicLeafDef,
    },
  };
}

const DEFORM_KEYS: DynParamKey[] = ['deformEnabled', 'squashY', 'stretchX', 'deformHz', 'deformPhase'];
const STEAM_KEYS: DynParamKey[] = [
  'emitEnabled', 'source', 'rate', 'speed', 'life', 'sizeStart', 'sizeEnd',
  'rise', 'turbulence', 'color', 'alpha', 'maxParticles',
];

function buildBuiltinEntries(): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  // 表面条目：现行模板全体 v1
  for (const t of PATTERN_TEMPLATES) {
    out.push({
      id: t.id, kind: 'surface', name: t.name, cluster: t.cluster, builtin: true,
      latest: 1,
      versions: { 1: { params: t.params, graph: t.graph, outputs: t.outputs } satisfies SurfaceEntryDef },
    });
  }
  // 动态样板：「挤压冒热气」拆为 挤压形变 + 轮廓热气 + 调制边
  const squeeze = dynLeafFromTemplate('dyn-squeeze', '挤压冒热气', DEFORM_KEYS);
  const steam = dynLeafFromTemplate('dyn-steam', '挤压冒热气', STEAM_KEYS);
  if (squeeze && steam) {
    out.push(squeeze, steam);
    out.push({
      id: 'dyn-squeeze-steam', kind: 'dynamic', name: '挤压冒热气', cluster: '形变', builtin: true,
      latest: 1,
      versions: {
        1: {
          kind: 'parent',
          children: [
            { entry: 'dyn-squeeze', version: 1 },
            { entry: 'dyn-steam', version: 1 },
          ],
          coordination: [
            { type: 'modulate', fromChild: 0, from: 'deformAmount', toChild: 1, toKey: 'rate', depth: 0.8 },
          ],
        } satisfies DynamicParentDef,
      },
    });
  }
  // 火焰环绕单独建叶：显式带上 emitEnabled/source 两键——值虽与
  // 缺省同，但段归属是语义；置换火焰父模式靠它裁决发射开关
  // （置换叶子自带 emitEnabled=false，见 dyn-flame-disp 的跟随边）
  const fireRing = dynLeafFromTemplate('dyn-fire-ring', '火焰环绕', [
    'emitEnabled', 'source', 'rate', 'speed', 'life', 'sizeStart', 'sizeEnd',
    'rise', 'turbulence', 'color', 'alpha',
  ]);
  if (fireRing) out.push(fireRing);
  // 其余动态模板：叶子条目 v1（segments = 相对缺省的差量键）
  const leafIds: Record<string, string> = {
    '呼吸起伏': 'dyn-breath', '弹跳挤压': 'dyn-bounce',
    '水滴滴落': 'dyn-drips', '烟雾缭绕': 'dyn-smoke', '星光闪烁': 'dyn-sparkle',
    '辉光呼吸': 'dyn-glow-breath', '垂饰滞后': 'dyn-lag',
  };
  for (const tpl of DYNAMIC_PATTERN_TEMPLATES) {
    if (tpl.name === '挤压冒热气') continue;
    const id = leafIds[tpl.name];
    if (!id) continue;
    const e = dynLeafFromTemplate(id, tpl.name);
    if (e) out.push(e);
  }
  // ---- 扩充（2026-10-24）：单段子模式叶子 + 组合父模式 ----
  // 发光叶子的取色对示例精灵的靶区（围巾 #ff8a3c / 宝石 #2ea8ff /
  // 符文 #8dff57 / 高光 #a8dcf0），真实部件上由作者改取色。
  const leaf = (
    id: string, name: string, cluster: string,
    segments: Partial<DynamicPatternParams>,
  ): LibraryEntry => ({
    id, kind: 'dynamic', name, cluster, builtin: true, latest: 1,
    versions: {
      1: {
        kind: 'leaf', segments,
        expose: Object.keys(segments) as DynParamKey[],
      } satisfies DynamicLeafDef,
    },
  });
  const parent = (
    id: string, name: string,
    children: DynChildRef[], coordination: CoordinationEdge[],
  ): LibraryEntry => ({
    id, kind: 'dynamic', name, cluster: '组合', builtin: true, latest: 1,
    versions: { 1: { kind: 'parent', children, coordination } satisfies DynamicParentDef },
  });
  out.push(
    // 形变叶子
    leaf('dyn-pulse', '脉冲挤压', '形变', {
      deformEnabled: true, squashY: 0.7, stretchX: 1.25, deformHz: 3, deformPhase: 0,
    }),
    leaf('dyn-swell', '缓慢胀缩', '形变', {
      deformEnabled: true, squashY: 0.9, stretchX: 1.08, deformHz: 0.35, deformPhase: 0,
    }),
    // 粒子叶子
    leaf('dyn-ember', '火星上飘', '粒子', {
      emitEnabled: true, source: 'contour', rate: 14, speed: 3, directionDeg: 270,
      life: 1.6, sizeStart: 2, sizeEnd: 0.5, rise: 12, turbulence: 8,
      color: '#ffb347', alpha: 0.9, spreadDeg: 30,
    }),
    leaf('dyn-bubbles', '气泡上升', '粒子', {
      emitEnabled: true, source: 'inside', rate: 8, speed: 1, directionDeg: 270,
      life: 2.2, sizeStart: 1.5, sizeEnd: 4, rise: 14, turbulence: 3,
      color: '#bfe8ff', alpha: 0.5, spreadDeg: 10,
    }),
    leaf('dyn-petals', '花瓣飘落', '粒子', {
      emitEnabled: true, source: 'contour-top', rate: 10, speed: 3, directionDeg: 90,
      life: 3, sizeStart: 2.5, sizeEnd: 2, rise: -2, turbulence: 14,
      color: '#ffb7d5', alpha: 0.85, spreadDeg: 50,
    }),
    leaf('dyn-rain', '细雨', '粒子', {
      emitEnabled: true, source: 'contour-top', rate: 42, speed: 26, directionDeg: 90,
      life: 1.1, sizeStart: 1, sizeEnd: 1, rise: 0, buoy: -25, turbulence: 0,
      color: '#9db8d9', alpha: 0.4, spreadDeg: 4,
    }),
    leaf('dyn-snow', '雪花飘落', '粒子', {
      emitEnabled: true, source: 'contour-top', rate: 12, speed: 4, directionDeg: 90,
      life: 3.4, sizeStart: 1.5, sizeEnd: 2.5, rise: -1, turbulence: 10,
      color: '#eaf6ff', alpha: 0.75, spreadDeg: 30,
    }),
    leaf('dyn-ash', '灰烬飘散', '粒子', {
      emitEnabled: true, source: 'contour', rate: 7, speed: 1, directionDeg: 270,
      life: 3, sizeStart: 2, sizeEnd: 3.5, rise: 5, turbulence: 16,
      color: '#9a9a9a', alpha: 0.35, spreadDeg: 60,
    }),
    // 发光叶子
    leaf('dyn-glow-flame', '焰形辉光', '发光', {
      glowEnabled: true, glowColor: '#ff9a3c', glowStrength: 1.3, glowHz: 3, glowPhase: 0,
      glowHalo: 3, glowShape: 'flame', glowPick: '#ff8a3c', glowTolerance: 0.18,
    }),
    leaf('dyn-glow-ember', '余烬辉光', '发光', {
      glowEnabled: true, glowColor: '#ff7a33', glowStrength: 1.2, glowHz: 2.4, glowPhase: 0,
      glowHalo: 3, glowShape: 'circle', glowPick: '#ff8a3c', glowTolerance: 0.18,
    }),
    leaf('dyn-glow-frost', '寒霜辉光', '发光', {
      glowEnabled: true, glowColor: '#9fd8ff', glowStrength: 0.95, glowHz: 0.5, glowPhase: 0,
      glowHalo: 3, glowShape: 'circle', glowPick: '#2ea8ff', glowTolerance: 0.15,
    }),
    leaf('dyn-glow-star', '星芒辉光', '发光', {
      glowEnabled: true, glowColor: '#fff3b0', glowStrength: 1.3, glowHz: 1.6, glowPhase: 0,
      glowHalo: 3, glowShape: 'star', glowPick: '#a8dcf0', glowTolerance: 0.1,
    }),
    leaf('dyn-glow-toxic', '毒雾辉光', '发光', {
      glowEnabled: true, glowColor: '#8dff57', glowStrength: 1.05, glowHz: 0.9, glowPhase: 0,
      glowHalo: 4, glowShape: 'circle', glowPick: '#8dff57', glowTolerance: 0.15,
    }),
    // 追随叶子
    leaf('dyn-lag-soft', '柔和垂随', '追随', {
      followEnabled: true, followDelaySec: 0.2, followAmount: 0.45, followRotate: true, emitEnabled: false,
    }),
    leaf('dyn-lag-stiff', '紧跟垂随', '追随', {
      followEnabled: true, followDelaySec: 0.05, followAmount: 0.9, followRotate: true, emitEnabled: false,
    }),
    // 置换叶子（D2）：置换段属形变段的键集，与压拉键同段共存
    leaf('dyn-disp-heat', '热浪升腾', '形变', {
      displaceEnabled: true, displaceAmp: 3, displaceFreq: 0.14, displaceDeg: 270,
      displaceSpeed: 0.35, displacePhase: 0, emitEnabled: false,
    }),
    leaf('dyn-disp-wave', '水波荡漾', '形变', {
      displaceEnabled: true, displaceAmp: 2, displaceFreq: 0.1, displaceDeg: 0,
      displaceSpeed: 0.2, displacePhase: 0, emitEnabled: false,
    }),
    leaf('dyn-disp-flag', '旗帜飘动', '形变', {
      displaceEnabled: true, displaceAmp: 2.5, displaceFreq: 0.07, displaceDeg: 0,
      displaceSpeed: 0.5, displacePhase: 0, emitEnabled: false,
    }),
    leaf('dyn-disp-flame', '火焰摇曳', '形变', {
      displaceEnabled: true, displaceAmp: 3.5, displaceFreq: 0.16, displaceDeg: 270,
      displaceSpeed: 0.55, displacePhase: 0, emitEnabled: false,
    }),
    // 自转叶子（D3）
    leaf('dyn-spin-rune', '法阵自转', '形变', {
      spinEnabled: true, spinSpeedDeg: 30, spinPhaseDeg: 0, emitEnabled: false,
    }),
    leaf('dyn-spin-vortex', '旋涡急转', '形变', {
      spinEnabled: true, spinSpeedDeg: 120, spinPhaseDeg: 0, emitEnabled: false,
    }),
    // 残影叶子（D5）
    leaf('dyn-trail', '残影拖尾', '形变', {
      trailEnabled: true, trailCount: 3, trailIntervalSec: 0.06, trailOpacity: 0.35, emitEnabled: false,
    }),
    leaf('dyn-trail-long', '长残影', '形变', {
      trailEnabled: true, trailCount: 5, trailIntervalSec: 0.05, trailOpacity: 0.3, emitEnabled: false,
    }),
  );
  // 着色叶子（只写一个键：给同段叶子染色，配合 followParams 用）
  out.push(
    leaf('dyn-tint-warm', '暖色调', '着色', { color: '#ffb37a' }),
    leaf('dyn-tint-frost', '寒色调', '着色', { color: '#a8d8ff' }),
  );
  // 组合父模式（配合边见各条 coordination）。展开产物是一份扁平
  // 参数，故同段叶子至多一个（写了同段多键的两个叶子必冲突，
  // 这是模型约束、不是内容疏漏）；嵌套同理：内层父模式占的段，
  // 外层不能再放同段叶子。
  out.push(
    parent('dyn-burning', '燃烧', [
      { entry: 'dyn-glow-flame', version: 1 },
      { entry: 'dyn-ember', version: 1 },
      { entry: 'dyn-swell', version: 1 },
    ], [
      { type: 'modulate', fromChild: 2, from: 'deformAmount', toChild: 1, toKey: 'rate', depth: 0.5 },
    ]),
    parent('dyn-bonfire', '篝火', [
      { entry: 'dyn-glow-flame', version: 1 },
      { entry: 'dyn-ember', version: 1 },
    ], []),
    parent('dyn-boil', '沸腾', [
      { entry: 'dyn-pulse', version: 1 },
      { entry: 'dyn-ash', version: 1 },
    ], [
      { type: 'modulate', fromChild: 0, from: 'deformAmount', toChild: 1, toKey: 'rate', depth: 0.5 },
    ]),
    // 父套父：熔岩沸腾 = 沸腾（父） + 余烬辉光（沸腾未占发光段）
    parent('dyn-magma', '熔岩沸腾', [
      { entry: 'dyn-boil', version: 1 },
      { entry: 'dyn-glow-ember', version: 1 },
    ], []),
    parent('dyn-frost-aegis', '寒霜结界', [
      { entry: 'dyn-glow-frost', version: 1 },
      { entry: 'dyn-snow', version: 1 },
      { entry: 'dyn-swell', version: 1 },
    ], [
      { type: 'modulate', fromChild: 2, from: 'deformAmount', toChild: 1, toKey: 'rate', depth: 0.3 },
    ]),
    parent('dyn-stardust', '星尘环绕', [
      { entry: 'dyn-glow-star', version: 1 },
      { entry: 'dyn-sparkle', version: 1 },
      { entry: 'dyn-swell', version: 1 },
    ], [
      { type: 'modulate', fromChild: 2, from: 'deformAmount', toChild: 1, toKey: 'rate', depth: 0.6 },
      { type: 'phase', baseChild: 2, offsets: { 0: 0.25 } },
    ]),
    parent('dyn-toxic-mire', '剧毒沼气', [
      { entry: 'dyn-glow-toxic', version: 1 },
      { entry: 'dyn-bubbles', version: 1 },
      { entry: 'dyn-swell', version: 1 },
    ], [
      { type: 'modulate', fromChild: 2, from: 'deformAmount', toChild: 1, toKey: 'rate', depth: 0.5 },
    ]),
    parent('dyn-sakura', '樱花吹雪', [
      { entry: 'dyn-petals', version: 1 },
      { entry: 'dyn-breath', version: 1 },
    ], [
      // 呼吸叶子自带 emitEnabled=false（单用时关发射），与花瓣的
      // 发射开关相撞：以花瓣为准（跟随边即裁决，不改叶子本体）
      { type: 'followParams', leader: 0, follower: 1, keys: ['emitEnabled'] },
      { type: 'modulate', fromChild: 1, from: 'deformAmount', toChild: 0, toKey: 'rate', depth: 0.4 },
    ]),
    parent('dyn-rainstorm', '暴雨', [
      { entry: 'dyn-rain', version: 1 },
      { entry: 'dyn-glow-frost', version: 1 },
      { entry: 'dyn-tint-frost', version: 1 },
    ], [
      { type: 'followParams', leader: 2, follower: 0, keys: ['color'] },
    ]),
    parent('dyn-dyed-smoke', '染烟', [
      { entry: 'dyn-smoke', version: 1 },
      { entry: 'dyn-tint-warm', version: 1 },
    ], [
      { type: 'followParams', leader: 1, follower: 0, keys: ['color'] },
    ]),
    // 置换火焰（D2）：置换摇曳 + 火焰粒子环绕。置换叶子自带
    // emitEnabled=false（单用时纯置换），与火焰环绕的发射开关
    // 相撞——以火焰环绕为准（跟随边裁决，与樱花吹雪同例）
    parent('dyn-flame-disp', '置换火焰', [
      { entry: 'dyn-disp-flame', version: 1 },
      { entry: 'dyn-fire-ring', version: 1 },
    ], [
      { type: 'followParams', leader: 1, follower: 0, keys: ['emitEnabled'] },
    ]),
    // 旋转法阵 / 旋转护盾（D3）：自转 + 发光（键集不交、无需配合边；
    // 护盾把自转速度经覆盖调慢——覆盖在子叶子的参数口内）
    parent('dyn-portal', '旋转法阵', [
      { entry: 'dyn-spin-rune', version: 1 },
      { entry: 'dyn-glow-star', version: 1 },
    ], []),
    parent('dyn-spin-aegis', '旋转护盾', [
      { entry: 'dyn-spin-rune', version: 1, overrides: { spinSpeedDeg: 18 } },
      { entry: 'dyn-glow-frost', version: 1 },
    ], []),
    // 冲刺残影（D5）：残影 + 缓慢胀缩（键集不交）
    parent('dyn-dash-trail', '冲刺残影', [
      { entry: 'dyn-trail', version: 1 },
      { entry: 'dyn-swell', version: 1 },
    ], []),
    // 弧线叶子（D4 一期）：电弧/雷击链/静电火花（同段多实例可叠，
    // 展开为同部件的独立实例——弧线段键与粒子的发射段键不相交）
    leaf('dyn-arc-bolt', '电弧', '弧线', {
      arcEnabled: true, arcLengthPx: 26, arcDirDeg: 0, arcDisplace: 0.35,
      arcBranches: 1, arcWidthPx: 1.2, arcFlicker: 10, arcSeed: 7,
      arcColor: '#bfe3ff', emitEnabled: false,
    }),
    leaf('dyn-arc-chain', '雷击链', '弧线', {
      arcEnabled: true, arcLengthPx: 44, arcDirDeg: 90, arcDisplace: 0.42,
      arcBranches: 3, arcWidthPx: 1.5, arcFlicker: 12, arcSeed: 21,
      arcColor: '#cfe8ff', emitEnabled: false,
    }),
    leaf('dyn-arc-spark', '静电火花', '弧线', {
      arcEnabled: true, arcLengthPx: 12, arcDirDeg: 0, arcDisplace: 0.5,
      arcBranches: 0, arcWidthPx: 0.8, arcFlicker: 18, arcSeed: 3,
      arcColor: '#ffe9a8', emitEnabled: false,
    }),
    // 弧线二期（D4）：藤蔓（生长链 + 叶点）/ 星座（散点最近邻连线）
    leaf('dyn-vine', '藤蔓生长', '弧线', {
      arcEnabled: true, arcMode: 'vine', arcLengthPx: 42, arcDirDeg: 270,
      arcDisplace: 0.35, arcBranches: 0, arcWidthPx: 1.6, arcFlicker: 0,
      arcSeed: 11, arcColor: '#7dd069', arcGrowHz: 0.3, arcDetail: 6,
      emitEnabled: false,
    }),
    leaf('dyn-stars', '星座连线', '弧线', {
      arcEnabled: true, arcMode: 'stars', arcLengthPx: 34, arcDirDeg: 0,
      arcDisplace: 0.35, arcBranches: 0, arcWidthPx: 0.8, arcFlicker: 6,
      arcSeed: 5, arcColor: '#cfe4ff', arcGrowHz: 0, arcDetail: 7,
      emitEnabled: false,
    }),
    // 藤蔓花环：两边都显式写 emitEnabled=false 也算段冲突，跟随边裁决
    parent('dyn-vine-wreath', '藤蔓花环', [
      { entry: 'dyn-vine', version: 1 },
      { entry: 'dyn-glow-breath', version: 1 },
    ], [
      { type: 'followParams', leader: 0, follower: 1, keys: ['emitEnabled'] },
    ]),
    // 雷暴电弧（D4 一期）：雷击链 + 火星粒子（emitEnabled 两边
    // 都显式写、跟随边裁决归火星——与置换火焰同例）
    parent('dyn-arc-storm', '雷暴电弧', [
      { entry: 'dyn-arc-chain', version: 1 },
      { entry: 'dyn-ember', version: 1 },
    ], [
      { type: 'followParams', leader: 1, follower: 0, keys: ['emitEnabled'] },
    ]),
    // 批次 1 · A 组（Pixel Composer 映射，现成段拼装、零新能力）
    leaf('dyn-fireflies', '萤火虫', '粒子', {
      emitEnabled: true, source: 'inside', rate: 5, speed: 0.7, directionDeg: 270,
      life: 4, sizeStart: 1.5, sizeEnd: 1, rise: 2, turbulence: 22,
      color: '#d8ffa8', alpha: 0.8, spreadDeg: 80, layer: 'front',
      glowEnabled: true, glowColor: '#c4ff7a', glowStrength: 0.7, glowHz: 0.5, glowPhase: 0,
      glowHalo: 2, glowShape: 'circle', glowPick: '#d8ffa8', glowTolerance: 0.2,
    }),
    leaf('dyn-dust', '漂浮尘埃', '粒子', {
      emitEnabled: true, source: 'inside', rate: 6, speed: 0.4, directionDeg: 270,
      life: 5, sizeStart: 1, sizeEnd: 1.5, rise: 1, turbulence: 6,
      color: '#e8e4da', alpha: 0.18, spreadDeg: 40, layer: 'both',
    }),
    // 水花飞溅（近似）：上抛后靠负浮力回落、短生命截断，不做真重力弧线
    leaf('dyn-splash', '水花飞溅', '粒子', {
      emitEnabled: true, source: 'contour-top', rate: 26, speed: 7, directionDeg: 270,
      life: 0.55, sizeStart: 1.5, sizeEnd: 0.5, buoy: -30, turbulence: 4,
      color: '#bfe8ff', alpha: 0.8, spreadDeg: 35,
    }),
    leaf('dyn-leaves', '落叶', '粒子', {
      emitEnabled: true, source: 'contour-top', rate: 8, speed: 2.5, directionDeg: 90,
      life: 3.6, sizeStart: 2.5, sizeEnd: 2, rise: -1, turbulence: 16,
      color: '#d9a441', alpha: 0.9, spreadDeg: 55,
      deformEnabled: true, squashY: 0.97, stretchX: 1.03, deformHz: 0.9, deformPhase: 0,
    }),
    leaf('dyn-glow-beam', '光束辉光', '发光', {
      glowEnabled: true, glowColor: '#ffeec2', glowStrength: 1.15, glowHz: 1.2, glowPhase: 0,
      glowHalo: 4, glowShape: 'star', glowStarReach: 2.5, glowAngleDeg: 0,
      glowPick: '#fff2b0', glowTolerance: 0.12,
    }),
    leaf('dyn-glow-flash', '频闪辉光', '发光', {
      glowEnabled: true, glowColor: '#e8f1ff', glowStrength: 1.5, glowHz: 7, glowPhase: 0,
      glowHalo: 5, glowShape: 'circle', glowPick: '#cfe4ff', glowTolerance: 0.2,
    }),
    // 批次 1 · B 组（父模式：单发射/单发光折叠口径内组合）
    // 灵气光环：辉光呼吸模板自带 emitEnabled=false（单用时纯辉光），
    // 会压掉发射——发射侧须用显式写下 emitEnabled 的叶子（火星换
    // 星光参数：覆盖只许动其参数口内的键）+ 跟随边裁决（同例）
    parent('dyn-aura', '灵气光环', [
      { entry: 'dyn-glow-breath', version: 1 },
      { entry: 'dyn-ember', version: 1, overrides: {
        source: 'inside', rate: 8, speed: 0.5, directionDeg: 270, life: 0.7,
        sizeStart: 1, sizeEnd: 2, rise: 0, turbulence: 0,
        color: '#ffe9a0', alpha: 0.85, spreadDeg: 60,
      } },
      { entry: 'dyn-swell', version: 1 },
    ], [
      { type: 'followParams', leader: 1, follower: 0, keys: ['emitEnabled'] },
      { type: 'modulate', fromChild: 2, from: 'deformAmount', toChild: 1, toKey: 'rate', depth: 0.5 },
      { type: 'phase', baseChild: 2, offsets: { 0: 0.3 } },
    ]),
    // 升级光效：调研原案的「发射率→辉光强度」调制边在 v1 无通道，
    // 以相位边错开辉光与胀缩代替（强度联动待配合边扩围）
    parent('dyn-levelup', '升级光效', [
      { entry: 'dyn-ember', version: 1, overrides: { color: '#ffe066', rate: 26, speed: 5, rise: 20 } },
      { entry: 'dyn-glow-star', version: 1 },
      { entry: 'dyn-swell', version: 1 },
    ], [
      { type: 'phase', baseChild: 2, offsets: { 1: 0.2 } },
    ]),
    parent('dyn-thunderstorm', '雷暴', [
      { entry: 'dyn-rain', version: 1 },
      { entry: 'dyn-glow-flash', version: 1 },
      { entry: 'dyn-tint-frost', version: 1 },
    ], [
      { type: 'followParams', leader: 2, follower: 0, keys: ['color'] },
    ]),
    parent('dyn-fountain', '喷泉', [
      { entry: 'dyn-splash', version: 1, overrides: { rate: 36, speed: 9, spreadDeg: 22, life: 0.8 } },
      { entry: 'dyn-glow-frost', version: 1, overrides: { glowColor: '#bfe8ff', glowStrength: 0.6 } },
    ], []),
    // 瀑布（近似）：线状发射源以顶部轮廓源近似，底部水花以微辉光代
    parent('dyn-waterfall', '瀑布（近似）', [
      { entry: 'dyn-rain', version: 1, overrides: { rate: 55, speed: 20, life: 1.6, sizeStart: 1.5, sizeEnd: 2, color: '#cfeaff', alpha: 0.55, spreadDeg: 6 } },
      { entry: 'dyn-glow-frost', version: 1, overrides: { glowColor: '#dff4ff', glowStrength: 0.6 } },
    ], []),
  );
  // 链条目：环带预设族（甲4）。结构 = 包络数值节点 → ring_ripple，
  // 插入节点蓝图后经像素链进包真跑；也可落成修改器参数预设（无包络）。
  out.push(...buildBuiltinChainEntries());
  // 脸型条目：五官点位参数预设（在转面面板应用到头部节点）
  out.push(...buildBuiltinFaceEntries());
  // 着色条目：着色本身是模式（收尾参数集），自族基线抽出登记，
  // 被机甲条目钉版引用——改着色发新版，引用方显式升级才跟随。
  out.push(...buildBuiltinFinishEntries());
  // 机甲条目：构造模式入产品库（研究线模式的正式登记处）。
  // 族预设即 v1：def 只钉生成器与族，变体槽缺省走族预设全量；
  // 蜘蛛多足腿的参考本体是石板灰机器，配色在 def 里钉 slate。
  out.push(...buildBuiltinMechaEntries());
  return out;
}

function finishPassEntry(id: string, name: string, pass: FinishPass, params: FinishPassParams): LibraryEntry {
  return {
    id, kind: 'finish', name, cluster: '着色', builtin: true, latest: 1,
    versions: { 1: { kind: 'finish', form: 'pass', pass, params } satisfies FinishPassDef },
  };
}

function finishComboEntry(
  id: string, name: string,
  parts: { entry: string; params?: FinishPassParams }[],
): LibraryEntry {
  return {
    id, kind: 'finish', name, cluster: '着色', builtin: true, latest: 1,
    versions: {
      1: {
        kind: 'finish', form: 'combo',
        parts: parts.map((p) => ({ entry: p.entry, version: 1, params: p.params })),
      } satisfies FinishComboDef,
    },
  };
}

function buildBuiltinFinishEntries(): LibraryEntry[] {
  return [
    // 着色算子（单一 pass 各一份条目；参数是该算子自己的量）
    finishPassEntry('fpass-ridges', '高光棱', 'ridges', { enabled: true }),
    finishPassEntry('fpass-seam', '缝', 'seam', { enabled: true }),
    finishPassEntry('fpass-thickness', '料厚', 'thickness', { ratio: 0.32 }),
    finishPassEntry('fpass-intake', '进气口', 'intake', { topTone: 1.42, topGrad: 0.12, rim: 0.1, pitch: 7, peak: 0.75, fall: 0.22, accentSlats: false }),
    finishPassEntry('fpass-wear', '做旧', 'wear', { amount: 0.3 }),
    finishPassEntry('fpass-camo', '迷彩', 'camo', { enabled: true }),
    finishPassEntry('fpass-facets', '分面着色', 'facets', { twoTone: true }),
    finishPassEntry('fpass-shell', '壳面', 'shell', { enabled: true }),
    finishPassEntry('fpass-stamps', '盖章', 'stamps', { decalKind: 'num' }),
    finishPassEntry('fpass-panel', '面板线', 'panel', { detail: 0.65 }),
    finishPassEntry('fpass-wedges', '异形楔拼块', 'wedges', { density: 1 }),
    finishPassEntry('fpass-cables', '线缆着色', 'cables', {}),
    // 着色组合（族基线 = 一组子模式 + 各自参数覆写）
    finishComboEntry('finish-olive', '着色组合·战损橄榄', [
      { entry: 'fpass-ridges' }, { entry: 'fpass-seam' }, { entry: 'fpass-thickness' }, { entry: 'fpass-intake' }, { entry: 'fpass-intake' }, { entry: 'fpass-intake' },
      { entry: 'fpass-wear', params: { amount: 0.3 } },
      { entry: 'fpass-camo', params: { enabled: true } },
      { entry: 'fpass-facets', params: { twoTone: true } },
      { entry: 'fpass-wedges', params: { density: 1 } },
    ]),
    finishComboEntry('finish-agile', '着色组合·洁净敏捷', [
      { entry: 'fpass-ridges' }, { entry: 'fpass-seam' }, { entry: 'fpass-thickness' },
      { entry: 'fpass-wear', params: { amount: 0.15 } },
      { entry: 'fpass-camo', params: { enabled: false } },
      { entry: 'fpass-facets', params: { twoTone: true } },
      { entry: 'fpass-wedges', params: { density: 1 } },
    ]),
    finishComboEntry('finish-powersuit', '着色组合·动力服', [
      { entry: 'fpass-ridges' }, { entry: 'fpass-seam' }, { entry: 'fpass-thickness' },
      { entry: 'fpass-wear', params: { amount: 0.15 } },
      { entry: 'fpass-camo', params: { enabled: false } },
      { entry: 'fpass-facets', params: { twoTone: false } },
      { entry: 'fpass-wedges', params: { density: 1 } },
    ]),
  ];
}

function mechaEntry(id: string, name: string, def: MechaEntryDef): LibraryEntry {
  return {
    id, kind: 'mecha', name, cluster: '机甲', builtin: true, latest: 1,
    versions: { 1: def },
  };
}

function buildBuiltinMechaEntries(): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  const FAMS = [
    ['olive', '橄榄'], ['agile', '敏捷'], ['powersuit', '动力服'],
  ] as const;
  const WEAPONS = [
    ['cannon', '臂炮'], ['pod', '导弹荚'], ['rifle', '步枪'], ['podPylon', '高架荚'],
  ] as const;
  for (const [fam, label] of FAMS) {
    out.push(mechaEntry(`mecha-leg-${fam}`, `腿组合·${label}`, { kind: 'mecha', form: 'gen', gen: 'leg', family: fam, finish: `finish-${fam}@1` }));
    out.push(mechaEntry(`mecha-arm-${fam}`, `臂组合·${label}`, { kind: 'mecha', form: 'gen', gen: 'arm', family: fam, finish: `finish-${fam}@1` }));
    out.push(mechaEntry(`mecha-torso-${fam}`, `躯干组·${label}`, { kind: 'mecha', form: 'gen', gen: 'torso', family: fam, finish: `finish-${fam}@1` }));
    out.push(mechaEntry(`mecha-head-${fam}`, `头组·${label}`, { kind: 'mecha', form: 'gen', gen: 'head', family: fam, finish: `finish-${fam}@1` }));
    out.push(mechaEntry(`mecha-hand-${fam}`, `手型·${label}`, { kind: 'mecha', form: 'gen', gen: 'hand', family: fam, finish: `finish-${fam}@1` }));
    out.push(mechaEntry(`mecha-track-${fam}`, `履带·${label}`, { kind: 'mecha', form: 'gen', gen: 'track', family: fam, finish: `finish-${fam}@1` }));
    out.push(mechaEntry(`mecha-wheel-${fam}`, `轮足·${label}`, { kind: 'mecha', form: 'gen', gen: 'wheel', family: fam, finish: `finish-${fam}@1` }));
    out.push(mechaEntry(`mecha-jetpack-${fam}`, `喷射背包·${label}`, { kind: 'mecha', form: 'gen', gen: 'jetpack', family: fam, finish: `finish-${fam}@1` }));
    for (const [wk, wl] of WEAPONS) {
      out.push(mechaEntry(`mecha-weapon-${wk}-${fam}`, `${wl}·${label}`, { kind: 'mecha', form: 'gen', gen: 'weapon', family: fam, weaponKind: wk, finish: `finish-${fam}@1` }));
    }
  }
  out.push(mechaEntry('mecha-hull-walker', '车体组·步行', { kind: 'mecha', form: 'gen', gen: 'hull', family: 'olive', hullKind: 'walker', finish: 'finish-olive@1' }));
  out.push(mechaEntry('mecha-hull-hauler', '车体组·运输', { kind: 'mecha', form: 'gen', gen: 'hull', family: 'olive', hullKind: 'hauler', finish: 'finish-olive@1' }));
  out.push(mechaEntry('mecha-multileg-spider', '多足腿·蜘蛛', { kind: 'mecha', form: 'gen', gen: 'multileg', family: 'olive', scheme: 'slate', profile: 'spider', finish: 'finish-olive@1' }));
  out.push(mechaEntry('mecha-multileg-quad', '多足腿·四足', { kind: 'mecha', form: 'gen', gen: 'multileg', family: 'olive', profile: 'quad', finish: 'finish-olive@1' }));
  // 躯干构造模式（2026-11-07 四样本标注提取）：模式本体是参数，
  // 条目钉版持有、躯干生成器经 profile/waistH 覆盖消费——不是
  // 写在生成器里的数字。套用即把该模式的参数装到当前躯干上
  out.push(mechaEntry('mpat-torso-fold', '躯干模式·前缘折点', { kind: 'mecha', form: 'gen', gen: 'torso', family: 'olive', finish: 'finish-olive@1', overrides: { torso: { profile: { top: 0.30, fold: 0.50, foldY: 0.55, base: 0.42 } } } }));
  out.push(mechaEntry('mpat-torso-waist', '躯干模式·腰独立成段', { kind: 'mecha', form: 'gen', gen: 'torso', family: 'olive', finish: 'finish-olive@1', overrides: { torso: { waistH: 34 } } }));
  out.push(mechaEntry('mpat-torso-division', '躯干模式·胸内主横分', { kind: 'mecha', form: 'gen', gen: 'torso', family: 'olive', finish: 'finish-olive@1', overrides: { torso: { profile: { divY: 0.50 } } } }));
  // 进气口·三面盒（立体绘制模式）：构造只做斜框分区，量分三组、
  // 各有校准出处——进深 intakeDepth [0.08, 0.08]（浅盒分区量，两
  // 样本口面板框带剖面约 8%）；口份额 intakeShare [0.92, 0.75]
  // （口占装口面，标注实测宽 0.91–0.93 / 高 0.71–0.79，与进深无
  // 关）；框斜与装口面倍率是站点朝向量、在各生成器调用点给。着
  // 色组合（模式主体）在 fpass-intake：顶面倍率、口内子模式
  out.push(mechaEntry('mpat-intake', '进气口·三面盒', { kind: 'mecha', form: 'gen', gen: 'torso', family: 'olive', finish: 'finish-olive@1', overrides: { torso: { intakeDepth: [0.08, 0.08], boxDepth: [0.92, 0.7], intakeShare: [0.92, 0.75], intakeOrient: 'keel', intakeTrim: true }, head: { intakeDepth: [0.08, 0.08], intakeShare: [0.92, 0.75] } }, hullOverrides: { intakeDepth: [0.08, 0.08], intakeShare: [0.92, 0.75] } }));
  // 龙骨突·散热口组合（模式组合：散热口盒 + 龙骨突 + 前楔并体
  // 三者同行——龙骨突按因果定案从盒的实际角点生长造剪影、前
  // 伸量 keelReach 由本条目持有；前楔并体 ventFuse 把盒左侧面
  // 与楔拱前楔并成同一表面。盒本体参数同 mpat-intake）
  out.push(mechaEntry('mpat-keelvent', '龙骨突·散热口组合', { kind: 'mecha', form: 'gen', gen: 'torso', family: 'olive', finish: 'finish-olive@1', overrides: { torso: { intakeDepth: [0.08, 0.08], boxDepth: [0.92, 0.7], intakeShare: [0.92, 0.75], intakeOrient: 'keel', intakeTrim: true, keelPlate: true, keelReach: 0.32, ventFuse: true } } }));
  // —— 铁巢样本四模式（2026-11-09 拆 DAG 落库）：垂缆 → 髋梁 →
  // 支架腿组 → 侧挂舱，依赖序即落库序。垂缆本体 = 线缆模式在
  // 两锚间悬垂成兜；侧挂舱 = 盒子模式 + 垂缆的组合条目；支架
  // 腿组 = 髋梁 + 撑链对的装配模式（参数经部件集 stand 流通到
  // assembleMechaVehicle 的双骨解算）
  out.push(mechaEntry('mpat-sagcable', '垂缆线束·腹下成束', { kind: 'mecha', form: 'gen', gen: 'hull', family: 'olive', hullKind: 'walker', finish: 'finish-olive@1', hullOverrides: { sagCables: true } }));
  out.push(mechaEntry('mpat-hipbeam', '髋梁横轴·梁端双盘', { kind: 'mecha', form: 'gen', gen: 'leg', family: 'olive', finish: 'finish-olive@1', overrides: { leg: { hipBeam: true } } }));
  out.push(mechaEntry('mpat-standgroup', '支架腿组·双组倒V', { kind: 'mecha', form: 'gen', gen: 'leg', family: 'olive', finish: 'finish-olive@1', overrides: { leg: { hipBeam: true, standSplay: 0.23, standReach: 0.93 } } }));
  out.push(mechaEntry('mpat-sidepod', '侧挂设备舱·盒+垂缆', { kind: 'mecha', form: 'gen', gen: 'hull', family: 'olive', hullKind: 'hauler', finish: 'finish-olive@1', hullOverrides: { sidePod: true } }));
  // 块形·非四边形（2026-11-06 v14 定版，跨部位：块的逐角切角逐角独立
  // 抽 + 侧边台阶 + 切角下限；研究库 G1 索引行指向的 L0 blockPoly 在产
  // 品侧的条目本体——工厂预设同值钉住，覆盖可调）
  out.push(mechaEntry('mpat-blockshape', '块形·非四边形', { kind: 'mecha', form: 'gen', gen: 'torso', family: 'olive', finish: 'finish-olive@1', overrides: { torso: { blockShape: { chamFloor: 0.3, varLo: 0.3, varHi: 1.8, stepP: 0.45 } }, head: { blockShape: { chamFloor: 0.3, varLo: 0.3, varHi: 1.8, stepP: 0.45 } }, arm: { blockShape: { chamFloor: 0.3, varLo: 0.3, varHi: 1.8, stepP: 0.45 } } }, hullOverrides: { blockShape: { chamFloor: 0.3, varLo: 0.3, varHi: 1.8, stepP: 0.45 } } }));
  // 整机组合（组合式条目：模式之上再组合——人形 = 头+躯干+臂+腿，
  // 载具 = 车体 + 行走方式；子条目钉版引用，输出以 as 前缀区分）
  const combo = (id: string, name: string, parts: MechaComboDef['parts']): LibraryEntry => ({
    id, kind: 'mecha', name, cluster: '机甲', builtin: true, latest: 1,
    versions: { 1: { kind: 'mecha', form: 'combo', parts } satisfies MechaComboDef },
  });
  for (const [fam, label] of FAMS) {
    out.push(combo(`mecha-humanoid-${fam}`, `人形整机·${label}`, [
      { entry: `mecha-head-${fam}`, version: 1, as: 'head' },
      { entry: `mecha-torso-${fam}`, version: 1, as: 'torso' },
      { entry: `mecha-arm-${fam}`, version: 1, as: 'arm' },
      { entry: `mecha-leg-${fam}`, version: 1, as: 'leg' },
    ]));
  }
  out.push(combo('mecha-vehicle-spider', '载具整机·步行蜘蛛', [
    { entry: 'mecha-hull-walker', version: 1, as: 'hull' },
    { entry: 'mecha-multileg-spider', version: 1, as: 'legs' },
  ]));
  out.push(combo('mecha-vehicle-quad', '载具整机·步行四足', [
    { entry: 'mecha-hull-walker', version: 1, as: 'hull' },
    { entry: 'mecha-multileg-quad', version: 1, as: 'legs' },
  ]));
  out.push(combo('mecha-vehicle-hauler-track', '载具整机·运输履带', [
    { entry: 'mecha-hull-hauler', version: 1, as: 'hull' },
    { entry: 'mecha-track-olive', version: 1, as: 'legs' },
  ]));
  return out;
}

function faceEntry(
  id: string, name: string,
  params: import('./face-features').FaceFeatureParams,
): LibraryEntry {
  const def: FaceEntryDef = { kind: 'face', params };
  return {
    id, kind: 'face', name, cluster: '脸型', builtin: true, latest: 1,
    versions: { 1: def },
  };
}

function buildBuiltinFaceEntries(): LibraryEntry[] {
  return [
    faceEntry('face-standard', '标准三庭', {
      browY: 0.3, eyeY: 0.38, eyeSpacing: 0.4, eyeHalfW: 0.09,
      noseBaseY: 0.62, noseHalfW: 0.06, mouthY: 0.78, mouthHalfW: 0.11,
    }),
    faceEntry('face-round', '圆脸（低眼线宽眼距）', {
      browY: 0.34, eyeY: 0.44, eyeSpacing: 0.46, eyeHalfW: 0.1,
      noseBaseY: 0.64, noseHalfW: 0.07, mouthY: 0.8, mouthHalfW: 0.1,
    }),
    faceEntry('face-long', '长脸（点位拉开）', {
      browY: 0.26, eyeY: 0.34, eyeSpacing: 0.36, eyeHalfW: 0.08,
      noseBaseY: 0.66, noseHalfW: 0.05, mouthY: 0.84, mouthHalfW: 0.09,
    }),
  ];
}

/** 环带预设的统一构造：env（waveform 包络）驱动 ring 的 amplitude 输入 */
function ringChainEntry(
  id: string, name: string,
  ringParams: Record<string, number | string>,
  envParams: Record<string, number | string>,
  expose: ChainExpose[],
): LibraryEntry {
  const def: ChainEntryDef = {
    kind: 'chain',
    entry: 'ring',
    expose,
    nodes: [
      {
        id: 'env', type: 'waveform',
        inputs: { t: { nodeId: '@time', output: 'out' } },
        params: { ...envParams },
        ui: { x: 0, y: 120 },
      },
      {
        id: 'ring', type: 'ring_ripple',
        inputs: {
          pixels: { nodeId: '@in', output: 'pixels' },
          t: { nodeId: '@time', output: 'out' },
          amplitude: { nodeId: 'env', output: 'out' },
        },
        params: { amplitude: 3, ...ringParams },
        ui: { x: 200, y: 40 },
      },
    ],
  };
  return {
    id, kind: 'chain', name, cluster: '环带', builtin: true, latest: 1,
    versions: { 1: def },
  };
}

function buildBuiltinChainEntries(): LibraryEntry[] {
  return [
    // 重击环：弹簧振荡包络，一次性冲击脉冲约半秒衰尽
    ringChainEntry(
      'chain-heavy-ring', '重击环',
      { frequency: 0.15, speed: 9, damping: 0.03, rippleMode: 'radial' },
      { waveform: 'spring_oscillate', baseValue: 0, amplitude: 6, period: 0.45, damping: 6 },
      [
        { node: 'env', key: 'amplitude', label: '冲击峰值' },
        { node: 'env', key: 'period', label: '振荡周期（秒）' },
        { node: 'ring', key: 'frequency', label: '环密度' },
      ],
    ),
    // 冲击波环：指数衰减包络，多圈扩散约 1.5 秒
    ringChainEntry(
      'chain-shock-ring', '冲击波环',
      { frequency: 0.3, speed: 12, damping: 0.015, rippleMode: 'radial' },
      { waveform: 'exponential_decay', baseValue: 7, endValue: 0, damping: 2.2 },
      [
        { node: 'env', key: 'baseValue', label: '起始振幅' },
        { node: 'env', key: 'damping', label: '衰减速度' },
        { node: 'ring', key: 'frequency', label: '环密度' },
        { node: 'ring', key: 'speed', label: '扩散速度' },
      ],
    ),
    // 护盾环：螺旋模式低振幅常驻 + 正弦呼吸微脉动
    ringChainEntry(
      'chain-shield-ring', '护盾环',
      { frequency: 0.12, speed: 2.5, damping: 0.01, rippleMode: 'spiral', spiralTwist: 3 },
      { waveform: 'sine', baseValue: 1.6, amplitude: 0.7, period: 2.4 },
      [
        { node: 'env', key: 'baseValue', label: '基础振幅' },
        { node: 'env', key: 'period', label: '呼吸周期（秒）' },
        { node: 'ring', key: 'spiralTwist', label: '螺旋扭转' },
      ],
    ),
  ];
}
export const BUILTIN_ENTRIES: LibraryEntry[] = buildBuiltinEntries();
export const BUILTIN_INDEX: LibraryIndex = libraryIndexOf(BUILTIN_ENTRIES);

/** 内置 + 用户条目合并索引（用户同 id 条目盖内置——仅限用户自建
 * 条目误撞内置 id 的兜底；正常路径用户条目用 user- 前缀 id） */
export function mergedIndex(userEntries: readonly LibraryEntry[]): Map<string, LibraryEntry> {
  return libraryIndexOf([...BUILTIN_ENTRIES, ...userEntries]);
}

/** 全部条目（内置 + 本地用户条目）：导出/预览调用 convert 时传 */
export function allLibraryEntries(): LibraryEntry[] {
  return [...BUILTIN_ENTRIES, ...loadUserEntries()];
}

/** 表面条目 → 展开用库条目列表：每版本一条 `id@版本`，最新版
 * 另以裸 `id` 注册（存量无 @ 的 ref 按最新版解析）。形状对齐
 * graph-expand 的 SubgraphLibEntry（结构兼容，不反向依赖）。 */
export function surfaceLibEntriesOf(entries: readonly LibraryEntry[]): {
  id: string; params: PatternParamDef[]; graph: SurfaceGraph; outputs?: Record<string, string>;
}[] {
  const out: {
    id: string; params: PatternParamDef[]; graph: SurfaceGraph; outputs?: Record<string, string>;
  }[] = [];
  for (const e of entries) {
    if (e.kind !== 'surface') continue;
    for (const [vStr, def] of Object.entries(e.versions)) {
      if ('kind' in def) continue;
      out.push({ id: formatRefId(e.id, Number(vStr)), params: def.params, graph: def.graph, outputs: def.outputs });
    }
    const latestDef = e.versions[e.latest];
    if (latestDef && !('kind' in latestDef)) {
      out.push({ id: e.id, params: latestDef.params, graph: latestDef.graph, outputs: latestDef.outputs });
    }
  }
  return out;
}

// ---------------- 草稿 / 发布 / 回收（纯函数） ----------------

/** 写草稿（编辑只走这里；已发布版本永不被改） */
export function withDraft(entry: LibraryEntry, def: EntryDef): LibraryEntry {
  return { ...entry, draft: structuredClone(def) };
}

/** 发布草稿为新版本（无草稿返回 undefined） */
export function publishDraft(entry: LibraryEntry): LibraryEntry | undefined {
  if (!entry.draft) return undefined;
  const v = entry.latest + 1;
  return {
    ...entry,
    versions: { ...entry.versions, [v]: entry.draft },
    draft: undefined,
    latest: v,
  };
}

/** 一个 def 里钉住的条目引用（动态 = children；表面 = 图内 ref 算子） */
export function refsOfDef(def: EntryDef): { id: string; version?: number }[] {
  if ('kind' in def) {
    if (def.kind === 'leaf') return [];
    if (def.kind === 'chain') return [];
    if (def.kind === 'face') return [];
    if (def.kind === 'finish') {
      return def.form === 'combo' ? def.parts.map((p) => ({ id: p.entry, version: p.version })) : [];
    }
    if (def.kind === 'mecha') {
      if (def.form === 'combo') return def.parts.map((p) => ({ id: p.entry, version: p.version }));
      return def.finish ? [parseRefId(def.finish)] : [];
    }
    return def.children.map((c) => ({ id: c.entry, version: c.version }));
  }
  const out: { id: string; version?: number }[] = [];
  for (const n of def.graph?.nodes ?? []) {
    if (n.op === 'ref') out.push(parseRefId(String(n.params?.ref ?? '')));
  }
  return out;
}

/** 反向索引：id → (版本 → 钉住它的条目 id 列表)。含草稿。 */
export function reverseIndex(
  entries: readonly LibraryEntry[],
): Map<string, Map<number | undefined, string[]>> {
  const out = new Map<string, Map<number | undefined, string[]>>();
  const add = (target: { id: string; version?: number }, referrer: string) => {
    let byVer = out.get(target.id);
    if (!byVer) { byVer = new Map(); out.set(target.id, byVer); }
    const list = byVer.get(target.version) ?? [];
    list.push(referrer);
    byVer.set(target.version, list);
  };
  for (const e of entries) {
    for (const def of Object.values(e.versions)) {
      for (const r of refsOfDef(def)) add(r, e.id);
    }
    if (e.draft) for (const r of refsOfDef(e.draft)) add(r, `${e.id}（草稿）`);
  }
  return out;
}

/** 某版本是否被钉住（被钉或为最新版 → 不可删） */
export function versionPinned(
  index: ReturnType<typeof reverseIndex>, entry: LibraryEntry, version: number,
): boolean {
  if (version === entry.latest) return true;
  const byVer = index.get(entry.id);
  if (!byVer) return false;
  for (const [v, list] of byVer) {
    if (list.length > 0 && (v === undefined || v === version)) return true;
  }
  return false;
}

/** 删除一个未被钉住的旧版本（被钉/最新版 → 返回 undefined 表示拒绝） */
export function deleteVersion(
  entry: LibraryEntry, version: number,
  index: ReturnType<typeof reverseIndex>,
): LibraryEntry | undefined {
  if (!entry.versions[version]) return undefined;
  if (versionPinned(index, entry, version)) return undefined;
  const versions = { ...entry.versions };
  delete versions[version];
  return { ...entry, versions };
}

/** 条目可否删除：任一版本/草稿被钉住 → 拒绝并给钉住方 */
export function entryDeleteBlockers(
  entry: LibraryEntry, index: ReturnType<typeof reverseIndex>,
): string[] {
  const byVer = index.get(entry.id);
  if (!byVer) return [];
  const out: string[] = [];
  for (const list of byVer.values()) out.push(...list);
  return [...new Set(out)];
}

// ---------------- 用户条目存储（统一 key + 旧 key 迁移） ----------------

const ENTRIES_KEY = 'pm-library-entries-v1';
const LEGACY_DYN_KEY = 'pm-user-dynamic-patterns-v1';
const LEGACY_SURFACE_KEY = 'pm-user-patterns-v1';

/** 旧动态模板 → 叶子条目（纯函数） */
export function legacyDynToEntries(
  arr: { name: string; cluster?: string; params: DynamicPatternParams }[],
): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  for (const t of arr) {
    if (!t?.name || !t.params) continue;
    const def = defaultDynamicParams();
    const segments: Partial<DynamicPatternParams> = {};
    for (const k of Object.keys(t.params) as DynParamKey[]) {
      if (JSON.stringify(t.params[k]) !== JSON.stringify(def[k])) {
        (segments as Record<string, unknown>)[k] = t.params[k];
      }
    }
    out.push({
      id: `user-dyn-${t.name}`, kind: 'dynamic', name: t.name,
      cluster: t.cluster ?? '我的', latest: 1,
      versions: { 1: { kind: 'leaf', segments, expose: Object.keys(segments) as DynParamKey[] } },
    });
  }
  return out;
}

/** 旧表面模板 → 表面条目（纯函数） */
export function legacySurfaceToEntries(arr: PatternTemplate[]): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  for (const t of arr) {
    if (!t?.id || !t.graph) continue;
    out.push({
      id: t.id, kind: 'surface', name: t.name, cluster: t.cluster ?? '我的', latest: 1,
      versions: { 1: { params: t.params ?? [], graph: t.graph, outputs: t.outputs } },
    });
  }
  return out;
}

/** 增量并入：legacy 来的条目按 id 去重补进已有条目表（旧保存流
 * 还在写旧 key，每次加载都补一次，保证两边不发散；纯函数） */
export function mergeLegacyEntries(
  existing: readonly LibraryEntry[], legacy: readonly LibraryEntry[],
): LibraryEntry[] {
  const have = new Set(existing.map((e) => e.id));
  const add = legacy.filter((e) => !have.has(e.id));
  return add.length > 0 ? [...existing, ...add] : [...existing];
}

export function loadUserEntries(): LibraryEntry[] {
  let stored: LibraryEntry[] = [];
  try {
    const raw = localStorage.getItem(ENTRIES_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as LibraryEntry[];
      if (Array.isArray(arr)) stored = arr.filter((e) => e && e.id && e.versions);
    }
  } catch { /* 存储不可用 → 仅走 legacy 补入 */ }
  // 旧 key 增量补入（旧 key 保留做回滚，不删）
  let merged = stored;
  try {
    const legacy: LibraryEntry[] = [];
    const dynRaw = localStorage.getItem(LEGACY_DYN_KEY);
    if (dynRaw) legacy.push(...legacyDynToEntries(JSON.parse(dynRaw)));
    const surfRaw = localStorage.getItem(LEGACY_SURFACE_KEY);
    if (surfRaw) legacy.push(...legacySurfaceToEntries(JSON.parse(surfRaw)));
    merged = mergeLegacyEntries(stored, legacy);
  } catch { /* 补入失败 → 用已存条目 */ }
  if (merged.length !== stored.length) saveUserEntries(merged);
  return merged;
}

export function saveUserEntries(entries: readonly LibraryEntry[]): void {
  try {
    localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries.filter((e) => !e.builtin)));
  } catch { /* 存储不可用时静默（库管理降级为会话内） */ }
}

/** 全部链条目（内置 + 用户），供蓝图插入/修改器预设/库面板共用 */
export function chainEntriesOf(entries: readonly LibraryEntry[]): LibraryEntry[] {
  return entries.filter((e) => e.kind === 'chain');
}

/** 取链条目某版本的定义（非链条目/无此版本返回 undefined） */
export function chainDefOf(
  index: LibraryIndex, id: string, version?: number,
): { def: ChainEntryDef; version: number } | undefined {
  const got = defOf(index, id, version);
  if (!got || !('kind' in got.def) || got.def.kind !== 'chain') return undefined;
  return { def: got.def, version: got.version };
}

/** 全部脸型条目（内置 + 用户） */
export function faceEntriesOf(entries: readonly LibraryEntry[]): LibraryEntry[] {
  return entries.filter((e) => e.kind === 'face');
}

/** 取脸型条目某版本的定义（非脸型条目/无此版本返回 undefined） */
export function faceDefOf(
  index: LibraryIndex, id: string, version?: number,
): { def: FaceEntryDef; version: number } | undefined {
  const got = defOf(index, id, version);
  if (!got || !('kind' in got.def) || got.def.kind !== 'face') return undefined;
  return { def: got.def, version: got.version };
}

/** 全部机甲条目（内置 + 用户） */
export function mechaEntriesOf(entries: readonly LibraryEntry[]): LibraryEntry[] {
  return entries.filter((e) => e.kind === 'mecha');
}

/** 取机甲条目某版本的定义（非机甲条目/无此版本返回 undefined） */
export function mechaDefOf(
  index: LibraryIndex, id: string, version?: number,
): { def: MechaEntryDef; version: number } | undefined {
  const got = defOf(index, id, version);
  if (!got || !('kind' in got.def) || got.def.kind !== 'mecha') return undefined;
  return { def: got.def, version: got.version };
}

/** 全部着色条目（内置 + 用户） */
export function finishEntriesOf(entries: readonly LibraryEntry[]): LibraryEntry[] {
  return entries.filter((e) => e.kind === 'finish');
}

/** 取着色条目某版本的定义（非着色条目/无此版本返回 undefined） */
export function finishDefOf(
  index: LibraryIndex, id: string, version?: number,
): { def: FinishEntryDef; version: number } | undefined {
  const got = defOf(index, id, version);
  if (!got || !('kind' in got.def) || got.def.kind !== 'finish') return undefined;
  return { def: got.def, version: got.version };
}

export function surfaceDefOf(
  index: LibraryIndex, id: string, version?: number,
): { def: SurfaceEntryDef; version: number } | undefined {
  // 表面条目的 kind 在条目本体上（def 不带 kind），与 finish 的
  // def.kind 口径不同——按条目 kind 判
  const e = index.get(id);
  if (!e || e.kind !== 'surface') return undefined;
  const got = defOf(index, id, version);
  return got ? { def: got.def as SurfaceEntryDef, version: got.version } : undefined;
}
