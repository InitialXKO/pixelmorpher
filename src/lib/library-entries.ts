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
export type EntryDef = SurfaceEntryDef | DynamicEntryDef;

export interface LibraryEntry {
  id: string;
  kind: 'surface' | 'dynamic';
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
  // 其余动态模板：叶子条目 v1（segments = 相对缺省的差量键）
  const leafIds: Record<string, string> = {
    '呼吸起伏': 'dyn-breath', '弹跳挤压': 'dyn-bounce', '火焰环绕': 'dyn-fire-ring',
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
  );
  return out;
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
