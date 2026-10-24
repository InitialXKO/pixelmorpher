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

export function loadUserEntries(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(ENTRIES_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as LibraryEntry[];
      if (Array.isArray(arr)) return arr.filter((e) => e && e.id && e.versions);
    }
  } catch { /* 存储不可用 → 走迁移/空 */ }
  // 首次：从旧 key 迁移（旧 key 保留一代做回滚，不删）
  const migrated: LibraryEntry[] = [];
  try {
    const dynRaw = localStorage.getItem(LEGACY_DYN_KEY);
    if (dynRaw) {
      const arr = JSON.parse(dynRaw) as { name: string; cluster?: string; params: DynamicPatternParams }[];
      for (const t of arr) {
        if (!t?.name || !t.params) continue;
        const def = defaultDynamicParams();
        const segments: Partial<DynamicPatternParams> = {};
        for (const k of Object.keys(t.params) as DynParamKey[]) {
          if (JSON.stringify(t.params[k]) !== JSON.stringify(def[k])) {
            (segments as Record<string, unknown>)[k] = t.params[k];
          }
        }
        migrated.push({
          id: `user-dyn-${t.name}`, kind: 'dynamic', name: t.name,
          cluster: t.cluster ?? '我的', latest: 1,
          versions: { 1: { kind: 'leaf', segments, expose: Object.keys(segments) as DynParamKey[] } },
        });
      }
    }
    const surfRaw = localStorage.getItem(LEGACY_SURFACE_KEY);
    if (surfRaw) {
      const arr = JSON.parse(surfRaw) as PatternTemplate[];
      for (const t of arr) {
        if (!t?.id || !t.graph) continue;
        migrated.push({
          id: t.id, kind: 'surface', name: t.name, cluster: t.cluster ?? '我的', latest: 1,
          versions: { 1: { params: t.params ?? [], graph: t.graph, outputs: t.outputs } },
        });
      }
    }
  } catch { /* 迁移失败 → 空库起步，旧 key 还在 */ }
  if (migrated.length > 0) saveUserEntries(migrated);
  return migrated;
}

export function saveUserEntries(entries: readonly LibraryEntry[]): void {
  try {
    localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries.filter((e) => !e.builtin)));
  } catch { /* 存储不可用时静默（库管理降级为会话内） */ }
}
