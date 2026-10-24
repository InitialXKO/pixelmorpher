'use client';

// ============================================================
// PatternLibraryPanel — 模式库管理面板（DESIGN-DAG-LIBRARY §五）
// 统一条目治理：版本表、影响面（谁钉了哪版）、草稿编辑→发布、
// 旧版本回收、条目删除（被钉住拒绝）。内置条目只读。
// 动态叶子草稿用现行参数表单（临时实例）编辑；动态父模式草稿
// 用结构化列表（子引用 + 配合边）。表面条目的图编辑仍在外观
// 编辑器，本面板只做治理。
// ============================================================

import React, { useMemo, useState } from 'react';
import {
  BUILTIN_ENTRIES, defOf, deleteVersion, entryDeleteBlockers, libraryIndexOf, loadUserEntries,
  publishDraft, reverseIndex, saveUserEntries, versionPinned, withDraft,
  type CoordinationEdge, type DynamicEntryDef, type DynamicParentDef,
  type DynChildRef, type EntryDef, type LibraryEntry, type SurfaceEntryDef,
} from '@/lib/library-entries';
import { expandDynamicEntry } from '@/lib/dynamic-expand';
import { cachedThumb, dynamicPosterRGBA, surfaceThumbRGBA } from '@/lib/library-thumbs';
import { convertCharacterToRuntimePackage } from '@/lib/proc-runtime/convert';
import { buildRuntimeHtml } from '@/lib/proc-runtime/runtime-template';
import { createDefaultParametricAppearance } from '@/lib/proc-runtime/surfaces';
import type { Character } from '@/lib/unified-types';
import {
  defaultDynamicParams, normalizeDynamicParams,
  type DynamicPatternInstance, type DynamicPatternParams,
} from '@/lib/dynamic-patterns';
import DynamicPatternEditor from './DynamicPatternEditor';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const selCls = 'h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded w-full text-gray-300';
const numCls = 'h-6 text-[10px] bg-[#111128] border-[#1e1e3a]';

const isDynDef = (d: EntryDef): d is DynamicEntryDef => 'kind' in d;

export default function PatternLibraryPanel({
  onClose, onChanged,
}: {
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [userEntries, setUserEntries] = useState<LibraryEntry[]>(() => loadUserEntries());
  const [kindFilter, setKindFilter] = useState<'all' | 'dynamic' | 'surface'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 正在编辑的草稿（工作副本；保存才落 withDraft） */
  const [draftWork, setDraftWork] = useState<{ entryId: string; def: DynamicEntryDef } | null>(null);
  const [leafScratch, setLeafScratch] = useState<DynamicPatternInstance | null>(null);

  const all = useMemo(() => [...BUILTIN_ENTRIES, ...userEntries], [userEntries]);
  const rIndex = useMemo(() => reverseIndex(all), [all]);
  const nameOf = (id: string) => all.find((e) => e.id === id)?.name ?? id;
  const selected = all.find((e) => e.id === selectedId) ?? null;

  const mutate = (id: string, fn: (e: LibraryEntry) => LibraryEntry) => {
    setUserEntries((prev) => {
      const next = prev.map((e) => (e.id === id ? fn(e) : e));
      saveUserEntries(next);
      return next;
    });
    onChanged?.();
  };
  const createEntry = (kind: 'leaf' | 'parent') => {
    const name = window.prompt(kind === 'leaf' ? '新动态叶子名称' : '新动态父模式名称', kind === 'leaf' ? '我的叶子' : '我的组合');
    if (!name) return;
    const def: DynamicEntryDef = kind === 'leaf'
      ? { kind: 'leaf', segments: {}, expose: [] }
      : { kind: 'parent', children: [], coordination: [] };
    const entry: LibraryEntry = {
      id: `user-dyn-${Date.now().toString(36)}`, kind: 'dynamic', name,
      cluster: '我的', latest: 1, versions: { 1: def },
    };
    setUserEntries((prev) => {
      const next = [...prev, entry];
      saveUserEntries(next);
      return next;
    });
    setSelectedId(entry.id);
    onChanged?.();
  };

  const startDraft = (entry: LibraryEntry) => {
    const def = (entry.draft ?? entry.versions[entry.latest]) as EntryDef;
    if (!isDynDef(def)) return;
    const work = structuredClone(def) as DynamicEntryDef;
    setDraftWork({ entryId: entry.id, def: work });
    if (work.kind === 'leaf') {
      setLeafScratch({
        id: 'draft', slot: 'main', enabled: true,
        params: normalizeDynamicParams({ ...defaultDynamicParams(), ...work.segments }),
      });
    } else {
      setLeafScratch(null);
    }
  };
  const saveDraft = () => {
    if (!draftWork) return;
    let def = draftWork.def;
    if (def.kind === 'leaf' && leafScratch) {
      // 叶子草稿落盘：原段键保留（段归属是语义）+ 新增非缺省键
      const base = defaultDynamicParams();
      const segments: Partial<DynamicPatternParams> = { ...def.segments };
      for (const k of Object.keys(leafScratch.params) as (keyof DynamicPatternParams)[]) {
        if (JSON.stringify(leafScratch.params[k]) !== JSON.stringify(base[k])) {
          (segments as Record<string, unknown>)[k] = leafScratch.params[k];
        }
      }
      def = { kind: 'leaf', segments, expose: [...new Set([...def.expose, ...Object.keys(segments) as (keyof DynamicPatternParams)[]])] };
    }
    if (def.kind === 'parent') {
      const bad = def.coordination.find((e) => e.type === 'followParams'
        && e.keys.some((k) => !(k in defaultDynamicParams())));
      if (bad) { window.alert('跟随边的参数键有不认识的键，未保存'); return; }
    }
    mutate(draftWork.entryId, (e) => withDraft(e, def));
    setDraftWork(null);
    setLeafScratch(null);
  };

  const referrersOf = (id: string): { label: string }[] => {
    const byVer = rIndex.get(id);
    if (!byVer) return [];
    const out: { label: string }[] = [];
    for (const [v, list] of byVer) {
      for (const r of list) out.push({ label: `${nameOf(r.replace('（草稿）', ''))}${r.includes('（草稿）') ? '（草稿）' : ''} → ${v === undefined ? '浮动引用' : `v${v}`}` });
    }
    return out;
  };

  const dynEntries = all.filter((e) => e.kind === 'dynamic');
  const filtered = all.filter((e) => kindFilter === 'all' || e.kind === kindFilter);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-[860px] max-w-[94vw] max-h-[88vh] overflow-hidden flex flex-col rounded-lg border border-[#26264d] bg-[#0c0c1d] text-gray-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#26264d]">
          <span className="text-[12px] font-medium text-gray-100">模式库管理</span>
          <span className="text-[9px] text-gray-500">引用钉版本 · 编辑走草稿 · 发布才升版 · 被钉住的版本删不掉</span>
          <div className="flex-1" />
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)} className="h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded text-gray-300 w-24">
            <option value="all">全部</option>
            <option value="dynamic">动态</option>
            <option value="surface">表面</option>
          </select>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => createEntry('leaf')}>新建动态叶子</Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => createEntry('parent')}>新建动态父模式</Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={onClose}>关闭</Button>
        </div>
        <div className="flex min-h-0 flex-1">
          {/* 条目列表 */}
          <div className="w-56 shrink-0 overflow-y-auto border-r border-[#26264d] p-1.5 space-y-0.5">
            {filtered.map((e) => {
              const refs = referrersOf(e.id).length;
              return (
                <button
                  key={e.id}
                  onClick={() => { setSelectedId(e.id); setDraftWork(null); }}
                  className={`w-full text-left rounded px-1.5 py-1 ${selectedId === e.id ? 'bg-[#1b1b38]' : 'hover:bg-[#14142a]'}`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <EntryThumb entry={e} index={libraryIndexOf(all)} size={30} />
                    <span className="text-[8px] text-gray-600">{e.kind === 'dynamic' ? '定格图' : '烘焙图'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-200 flex-1 truncate">{e.name}</span>
                    <span className="text-[8px] text-gray-500">{e.kind === 'dynamic' ? '动态' : '表面'}</span>
                    {e.builtin && <span className="text-[8px] text-gray-600">内置</span>}
                  </div>
                  <div className="text-[8px] text-gray-500">
                    {e.cluster} · 最新 v{e.latest}{e.draft ? ' · 有草稿' : ''}{refs > 0 ? ` · 被引 ${refs}` : ''}
                  </div>
                </button>
              );
            })}
          </div>
          {/* 详情 */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {!selected && <p className="text-[10px] text-gray-500">从左侧选一个条目看版本与引用。</p>}
            {selected && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-gray-100">{selected.name}</span>
                  <span className="text-[9px] text-gray-500">{selected.id} · {selected.kind === 'dynamic' ? '动态' : '表面'} · {selected.cluster}</span>
                  <div className="flex-1" />
                  {!selected.builtin && selected.kind === 'dynamic' && !draftWork && (
                    <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-cyan-300"
                      onClick={() => startDraft(selected)}>
                      {selected.draft ? '继续编辑草稿' : '编辑草稿'}
                    </Button>
                  )}
                  {!selected.builtin && selected.draft && !draftWork && (
                    <>
                      <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-emerald-300"
                        onClick={() => mutate(selected.id, (e) => publishDraft(e) ?? e)}>
                        发布为 v{selected.latest + 1}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-red-300"
                        onClick={() => mutate(selected.id, (e) => ({ ...e, draft: undefined }))}>
                        丢弃草稿
                      </Button>
                    </>
                  )}
                  {!selected.builtin && (
                    <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-red-300"
                      onClick={() => {
                        const blockers = entryDeleteBlockers(selected, rIndex);
                        if (blockers.length > 0) {
                          window.alert(`删不掉：被 ${blockers.map(nameOf).join('、')} 钉住`);
                          return;
                        }
                        if (!window.confirm(`删除条目「${selected.name}」及其全部版本？`)) return;
                        setUserEntries((prev) => {
                          const next = prev.filter((e) => e.id !== selected.id);
                          saveUserEntries(next);
                          return next;
                        });
                        setSelectedId(null);
                        onChanged?.();
                      }}>
                      删除条目
                    </Button>
                  )}
                </div>
                <div className="flex items-start gap-2">
                  <EntryThumb entry={selected} index={libraryIndexOf(all)} size={84} />
                  {selected.kind === 'dynamic'
                    ? <p className="text-[9px] text-gray-600 leading-relaxed">左图为定格图（峰值帧）；下方有动态预览。</p>
                    : <p className="text-[9px] text-gray-600 leading-relaxed">标准瓦片烘焙图；实际部件形状不同，图案按同一图生成。</p>}
                </div>
                {selected.kind === 'dynamic' && (
                  <EntryLivePreview entry={selected} allEntries={all} />
                )}
                {/* 影响面 */}
                <div>
                  <Label className="text-[9px] text-gray-600">影响面（谁钉了这个条目）</Label>
                  {referrersOf(selected.id).length === 0
                    ? <p className="text-[9px] text-gray-600">没有条目引用它（挂载实例的引用在工程里，不在此列）。</p>
                    : referrersOf(selected.id).map((r, i) => (
                      <p key={i} className="text-[9px] text-gray-400">{r.label}</p>
                    ))}
                </div>
                {/* 版本表 */}
                <div>
                  <Label className="text-[9px] text-gray-600">版本（已发布不可变）</Label>
                  <div className="space-y-0.5">
                    {Object.keys(selected.versions).map(Number).sort((a, b) => b - a).map((v) => {
                      const pinned = versionPinned(rIndex, selected, v);
                      const deletable = !selected.builtin && !pinned;
                      return (
                        <div key={v} className="flex items-center gap-1.5 text-[9px] text-gray-400">
                          <span className="w-8">v{v}</span>
                          <span className="text-gray-600">
                            {v === selected.latest ? '最新版' : pinned ? '被钉住' : '游离（可回收）'}
                          </span>
                          <div className="flex-1" />
                          {!selected.builtin && (
                            <Button size="sm" variant="ghost" disabled={!deletable}
                              className="h-4 text-[9px] px-1 text-red-300 disabled:opacity-30"
                              onClick={() => mutate(selected.id, (e) => deleteVersion(e, v, rIndex) ?? e)}>
                              删除此版本
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {selected.kind === 'surface' && (
                  <p className="text-[9px] text-gray-600">表面条目的图在外观编辑器里改：应用模板 → 编辑 → 存为我的模板（新条目）；本面板管版本与引用。</p>
                )}
                {/* 草稿编辑器 */}
                {draftWork && draftWork.entryId === selected.id && (
                  <div className="rounded border border-[#26264d] p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-cyan-300">草稿编辑（保存后还需「发布」才成为新版本）</span>
                      <div className="flex-1" />
                      <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-emerald-300" onClick={saveDraft}>保存草稿</Button>
                      <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5" onClick={() => { setDraftWork(null); setLeafScratch(null); }}>取消</Button>
                    </div>
                    {draftWork.def.kind === 'leaf' && leafScratch && (
                      <DynamicPatternEditor
                        instances={[leafScratch]}
                        onChange={(next) => { if (next[0]) setLeafScratch(next[0]); }}
                      />
                    )}
                    {draftWork.def.kind === 'parent' && (
                      <ParentDefEditor
                        def={draftWork.def}
                        dynEntries={dynEntries}
                        onChange={(def) => setDraftWork({ entryId: selected.id, def })}
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 条目缩略图：表面=烘焙图、动态=定格图（按 id@最新版缓存） */
function EntryThumb({ entry, index, size }: {
  entry: LibraryEntry;
  index: ReturnType<typeof libraryIndexOf>;
  size: number;
}) {
  const url = React.useMemo(() => {
    if (entry.kind === 'surface') {
      const found = defOf(index, entry.id);
      if (!found || 'kind' in found.def) return undefined;
      return cachedThumb(`surf:${entry.id}@${found.version}`, () => surfaceThumbRGBA(found.def as SurfaceEntryDef));
    }
    const ex = expandDynamicEntry(index, entry.id, entry.latest);
    if (!ex.params) return undefined;
    return cachedThumb(`dyn:${entry.id}@${entry.latest}`, () => dynamicPosterRGBA(ex.params!));
  }, [entry, index]);
  if (!url) return <div style={{ width: size, height: size }} className="shrink-0 rounded bg-[#14142a]" />;
  return (
    <img src={url} alt="" width={size} height={size}
      className="shrink-0 rounded bg-[#14142a]" style={{ imageRendering: 'pixelated' }} />
  );
}

/** 动态条目动态预览：示例角色挂上钉版本引用 → 与导出同一套
 * 程序化预览（整包 iframe）。追随类只有单部件时显不出跟随，
 * 展开参数带 followEnabled 时在下方注明。 */
function EntryLivePreview({ entry, allEntries }: { entry: LibraryEntry; allEntries: LibraryEntry[] }) {
  const built = React.useMemo(() => {
    const index = libraryIndexOf(allEntries);
    const ex = expandDynamicEntry(index, entry.id, entry.latest);
    const inst = {
      id: 'preview', slot: 'main', enabled: true,
      params: ex.params ?? defaultDynamicParams(),
      patternRef: { id: entry.id, version: entry.latest },
    };
    const character = {
      id: 'preview-char', name: '预览',
      nodes: {
        torso: {
          id: 'torso', name: '躯干', role: 'bone',
          slot: { slotKey: 'torso' }, dynamicPatterns: [inst],
        },
      },
      rootNodeId: 'torso', rootNodeIds: ['torso'],
      costumeSets: [{
        id: 'set1', name: '默认',
        pieces: { torso: { nodeId: 'torso', zIndex: 0, parametric: createDefaultParametricAppearance() } },
      }],
      activeCostumeSetId: 'set1', variants: {},
    } as unknown as Character;
    const pkg = convertCharacterToRuntimePackage(character, undefined, {
      frameRate: 12, totalFrames: 48, libraryEntries: allEntries,
    });
    return { html: buildRuntimeHtml(pkg), follow: !!ex.params?.followEnabled };
  }, [entry, allEntries]);
  return (
    <div>
      <Label className="text-[9px] text-gray-600">动态预览（与导出同一运行时）</Label>
      <iframe
        title="条目动态预览"
        srcDoc={built.html}
        sandbox="allow-scripts"
        className="w-full rounded border border-[#1e1e3a] bg-[#12122a] mt-1"
        style={{ height: 180, pointerEvents: 'none' }}
      />
      {built.follow && (
        <p className="text-[9px] text-gray-600 mt-0.5">追随效果需要两个部件：此预览只有示例部件，跟随不显形；在真实角色上生效。</p>
      )}
    </div>
  );
}

/** 父模式草稿的结构化编辑：子引用（条目+版本）与配合边 */
function ParentDefEditor({
  def, dynEntries, onChange,
}: {
  def: DynamicParentDef;
  dynEntries: LibraryEntry[];
  onChange: (def: DynamicParentDef) => void;
}) {
  const setChildren = (children: DynChildRef[]) => onChange({ ...def, children });
  const setCoord = (coordination: CoordinationEdge[]) => onChange({ ...def, coordination });
  const entryOf = (id: string) => dynEntries.find((e) => e.id === id);
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-[9px] text-gray-600">子模式（按顺序合并；同段同键两写会展开报错，须用配合边裁决）</Label>
        <div className="space-y-1 mt-1">
          {def.children.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-[9px] text-gray-500 w-6">#{i}</span>
              <select
                value={c.entry}
                onChange={(e) => {
                  const en = entryOf(e.target.value);
                  const next = [...def.children];
                  next[i] = { entry: e.target.value, version: en?.latest ?? 1 };
                  setChildren(next);
                }}
                className={selCls}
              >
                {dynEntries.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <select
                value={c.version}
                onChange={(e) => {
                  const next = [...def.children];
                  next[i] = { ...c, version: Number(e.target.value) };
                  setChildren(next);
                }}
                className="h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded w-16 text-gray-300"
              >
                {Object.keys(entryOf(c.entry)?.versions ?? { 1: null }).map((v) => (
                  <option key={v} value={v}>v{v}</option>
                ))}
              </select>
              <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1 text-red-300"
                onClick={() => setChildren(def.children.filter((_, j) => j !== i))}>
                移除
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-cyan-300"
            onClick={() => {
              const first = dynEntries[0];
              if (first) setChildren([...def.children, { entry: first.id, version: first.latest }]);
            }}>
            添加子模式
          </Button>
        </div>
      </div>
      <div>
        <Label className="text-[9px] text-gray-600">配合边</Label>
        <div className="space-y-1 mt-1">
          {def.coordination.map((e, i) => (
            <CoordRow
              key={i}
              edge={e}
              childCount={def.children.length}
              onChange={(ne) => {
                const next = [...def.coordination];
                next[i] = ne;
                setCoord(next);
              }}
              onRemove={() => setCoord(def.coordination.filter((_, j) => j !== i))}
            />
          ))}
          <div className="flex gap-1">
            {(['modulate', 'phase', 'followParams'] as const).map((t) => (
              <Button key={t} size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-cyan-300"
                onClick={() => {
                  const edge: CoordinationEdge = t === 'modulate'
                    ? { type: 'modulate', fromChild: 0, from: 'deformAmount', toChild: Math.min(1, def.children.length - 1), toKey: 'rate', depth: 0.8 }
                    : t === 'phase'
                      ? { type: 'phase', baseChild: 0, offsets: {} }
                      : { type: 'followParams', leader: 0, follower: Math.min(1, def.children.length - 1), keys: ['glowColor'] };
                  setCoord([...def.coordination, edge]);
                }}>
                + {t === 'modulate' ? '调制' : t === 'phase' ? '相位' : '跟随'}
              </Button>
            ))}
          </div>
          <p className="text-[8px] text-gray-600">调制 v1 只支持一条通道：子模式形变量 → 另一子模式的发射率。</p>
        </div>
      </div>
    </div>
  );
}

function CoordRow({
  edge, childCount, onChange, onRemove,
}: {
  edge: CoordinationEdge;
  childCount: number;
  onChange: (e: CoordinationEdge) => void;
  onRemove: () => void;
}) {
  const childSel = (value: number, set: (n: number) => void) => (
    <select value={value} onChange={(e) => set(Number(e.target.value))}
      className="h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded w-14 text-gray-300">
      {Array.from({ length: Math.max(childCount, 1) }, (_, i) => <option key={i} value={i}>#{i}</option>)}
    </select>
  );
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[9px] text-gray-400">
      <span className="text-cyan-300 w-10">
        {edge.type === 'modulate' ? '调制' : edge.type === 'phase' ? '相位' : '跟随'}
      </span>
      {edge.type === 'modulate' && (
        <>
          {childSel(edge.fromChild, (n) => onChange({ ...edge, fromChild: n }))}
          <span>形变量 →</span>
          {childSel(edge.toChild, (n) => onChange({ ...edge, toChild: n }))}
          <span>发射率，深度</span>
          <Input type="number" step={0.05} min={0} max={1} value={edge.depth}
            onChange={(ev) => onChange({ ...edge, depth: Number(ev.target.value) })}
            className={`${numCls} w-14`} />
        </>
      )}
      {edge.type === 'phase' && (
        <>
          <span>基准</span>
          {childSel(edge.baseChild, (n) => onChange({ ...edge, baseChild: n }))}
          <span>各子模式偏移（圈，逗号分隔对应 #0..）</span>
          <Input
            value={Object.entries(edge.offsets).sort(([a], [b]) => Number(a) - Number(b)).map(([, v]) => v).join(',')}
            onChange={(ev) => {
              const parts = ev.target.value.split(',').map((x) => Number(x.trim()));
              const offsets: Record<number, number> = {};
              parts.forEach((v, i) => { if (Number.isFinite(v) && i !== edge.baseChild) offsets[i] = v; });
              onChange({ ...edge, offsets });
            }}
            className={`${numCls} w-24`} placeholder="0,0.3"
          />
        </>
      )}
      {edge.type === 'followParams' && (
        <>
          <span>领队</span>
          {childSel(edge.leader, (n) => onChange({ ...edge, leader: n }))}
          <span>跟随</span>
          {childSel(edge.follower, (n) => onChange({ ...edge, follower: n }))}
          <span>键（逗号分隔）</span>
          <Input
            value={edge.keys.join(',')}
            onChange={(ev) => onChange({ ...edge, keys: ev.target.value.split(',').map((x) => x.trim()).filter(Boolean) as (keyof DynamicPatternParams)[] })}
            className={`${numCls} w-36`} placeholder="glowColor,glowHz"
          />
        </>
      )}
      <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1 text-red-300" onClick={onRemove}>移除</Button>
    </div>
  );
}
