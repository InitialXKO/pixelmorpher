'use client';
import { useState } from 'react';

// ============================================================
// ParametricAppearanceEditor — 槽位参数化外观编辑（Rig 面板内）
// 编辑对象 = 当前服装集 piece.parametric（按服装集存，换集即换外观）。
// 字段与 proc-runtime 的运行时包同构：形状 / 表面层程序预设 / 调色板 /
// 四个枚举槽位 / rim·glint 强度。主画布按「参数化优先」消费此数据，
// 另服务于程序化预览与「程序化运行时包」导出。
// ============================================================

import React from 'react';
import { useProjectStore } from '@/lib/store';
import { createDefaultCostumePiece } from '@/lib/unified-types';
import type { ParametricAppearance, SurfaceGraph } from '@/lib/unified-types';
import {
  PALETTE_NAMES, LIGHT, OUTLINE, RIM, GLINT,
  LIGHT_NAMES, OUTLINE_NAMES, RIM_NAMES, GLINT_NAMES,
} from '@/lib/proc-runtime/palettes';
import { SURFACE_PRESETS, SURFACE_PRESET_NAMES, createDefaultParametricAppearance } from '@/lib/proc-runtime/surfaces';
import PolyContourEditor from './PolyContourEditor';
import { PATTERN_TEMPLATES, instantiatePattern, type PatternParamDef } from '@/lib/proc-runtime/pattern-templates';
import SurfaceGraphEditor from './SurfaceGraphEditor';
import PatternLibraryPanel from './PatternLibraryPanel';
import {
  loadUserPatterns, saveUserPattern, deleteUserPattern, renameUserPattern,
  findPatternTemplate, isUserPattern, deriveParamDefs, type UserPatternTemplate,
} from '@/lib/proc-runtime/pattern-library';
import { resolvePieceSprite } from '@/lib/sprite-resolve';
import { representativeGridForSlot, representativeGridForSlotEx } from '@/lib/proc-runtime/convert';
import DynamicPatternEditor from './DynamicPatternEditor';
import { glowRankByInstanceId, type DynamicPatternInstance } from '@/lib/dynamic-patterns';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const selCls = 'h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded mt-1 w-full text-gray-300';
const numCls = 'h-6 text-[10px] bg-[#111128] border-[#1e1e3a]';

export default function ParametricAppearanceEditor({ characterId, slotKey }: { characterId: string; slotKey: string }) {
  const character = useProjectStore((s) => s.unifiedCharacters[characterId]);
  const spritesRecord = useProjectStore((s) => s.sprites);
  const [userPatterns, setUserPatterns] = useState<UserPatternTemplate[]>(() => loadUserPatterns());
  const [editorOpen, setEditorOpen] = useState(false);
  const [libPanelOpen, setLibPanelOpen] = useState(false);
  const [customDefs, setCustomDefs] = useState<PatternParamDef[] | null>(null);
  const refreshUserPatterns = () => setUserPatterns(loadUserPatterns());
  if (!character) return null;
  const set = character.costumeSets.find((cs) => cs.id === character.activeCostumeSetId) ?? character.costumeSets[0];
  if (!set) {
    return <div className="text-[10px] text-gray-500">参数化外观：角色尚无服装集，先在换装中新建服装集。</div>;
  }
  const piece = set.pieces[slotKey];
  const app = piece?.parametric;
  const allTemplates = [...PATTERN_TEMPLATES, ...userPatterns];
  const allClusters = [...new Set(allTemplates.map((t) => t.cluster))];
  const activeTemplate = findPatternTemplate(app?.surfaceName);
  const editorDefs: PatternParamDef[] = activeTemplate?.params ?? customDefs ?? (app?.surfaceGraph ? deriveParamDefs(app.surfaceGraph) : []);
  const editorShape = app ? (app.shape.kind === 'poly'
    ? { kind: 'poly' as const, size: app.shape.size, points: (app.shape.poly ?? []).map(([x, y]): [number, number] => [x, -y]), pivot: (app.shape.polyPivot ? [app.shape.polyPivot[0], -app.shape.polyPivot[1]] : [0, 0]) as [number, number] }
    : { kind: app.shape.kind, size: app.shape.size, roundness: app.shape.roundness ?? 0 }) : null;

  const mode = app?.composite ?? 'generate';
  // 借/叠加档：模式编辑器预览形状按东向精灵尺寸的矩形近似（真实轮廓看主画布）
  const previewBase = app && mode !== 'generate' ? resolvePieceSprite(piece, 0, undefined, spritesRecord).sprite : null;
  const graphShape = previewBase
    ? { kind: 'rect' as const, size: [previewBase.width, previewBase.height] as [number, number], roundness: 0 }
    : editorShape;

  const write = (next: ParametricAppearance | undefined) => {
    const store = useProjectStore.getState();
    const ch = store.unifiedCharacters[characterId];
    const cs = ch?.costumeSets.find((x) => x.id === ch.activeCostumeSetId) ?? ch?.costumeSets[0];
    if (!ch || !cs) return;
    store.pushUndo('参数化外观', 'parametric');
    const p = cs.pieces[slotKey] ?? createDefaultCostumePiece(slotKey);
    store.updateUnifiedCostumeSet(characterId, cs.id, {
      pieces: { ...cs.pieces, [slotKey]: { ...p, parametric: next } },
    });
  };
  const writeDynamic = (next: DynamicPatternInstance[]) => {
    const store = useProjectStore.getState();
    const ch = store.unifiedCharacters[characterId];
    const cs = ch?.costumeSets.find((x) => x.id === ch.activeCostumeSetId) ?? ch?.costumeSets[0];
    if (!ch || !cs) return;
    store.pushUndo('动态效果（服装件）', 'dynamic');
    const p = cs.pieces[slotKey] ?? createDefaultCostumePiece(slotKey);
    store.updateUnifiedCostumeSet(characterId, cs.id, {
      pieces: { ...cs.pieces, [slotKey]: { ...p, dynamicPatterns: next } },
    });
  };
  const patch = (p: Partial<ParametricAppearance>) => { if (app) write({ ...app, ...p }); };
  const patchShape = (p: Partial<ParametricAppearance['shape']>) => { if (app) patch({ shape: { ...app.shape, ...p } }); };

  return (
    <div>
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">参数化外观（程序化运行时）</Label>
        <input
          type="checkbox"
          checked={!!app}
          onChange={(e) => write(e.target.checked ? createDefaultParametricAppearance() : undefined)}
          title="启用后该槽位在此服装集下进入程序化运行时包"
        />
      </div>
      <p className="mt-0.5 text-[9px] text-gray-600">
        按服装集存（当前：{set.name}）；槽位 {slotKey}。主画布参数化优先，改动即时上画布；同时供程序化预览/导出。
      </p>
      <div className="mt-2">
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">动态效果（服装件）</Label>
        <div className="mt-1">
          <DynamicPatternEditor
            instances={piece?.dynamicPatterns ?? []}
            onChange={writeDynamic}
            hint="挂在当前服装集的这个槽位上，换集即换；与节点挂载按效果位合并：同位替换、关闭压制、不同位叠加。"
            previewGrid={representativeGridForSlot(character, slotKey, spritesRecord)}
            previewMarks={representativeGridForSlotEx(character, slotKey, spritesRecord)?.marks}
            glowRankById={glowRankByInstanceId(
              Object.values(character.nodes).find((n) => (n.slot?.slotKey ?? n.id) === slotKey)?.dynamicPatterns,
              piece?.dynamicPatterns,
            )}
            followSourceOptions={[...new Map(Object.values(character.nodes)
              .filter((n) => n.slot?.slotKey)
              .map((n) => [n.slot!.slotKey as string, n.name] as const)).entries()]
              .map(([key, label]) => ({ key, label }))}
          />
        </div>
      </div>
      {app && (
        <div className="mt-1.5 space-y-1.5">
          <div>
            <Label className="text-[9px] text-gray-600">合成方式</Label>
            <select value={mode} onChange={(e) => patch({ composite: e.target.value as ParametricAppearance['composite'] })} className={selCls}>
              <option value="generate">独立生成（形状即轮廓）</option>
              <option value="silhouette">借精灵轮廓（只出剪影，全出参数化色）</option>
              <option value="overlay">叠加到精灵（精灵作底，只加光影/描边）</option>
            </select>
            {mode !== 'generate' && (
              <p className="mt-0.5 text-[9px] text-gray-600">
                轮廓{mode === 'overlay' ? '与底图' : ''}取自该槽位各方向的精灵（逐方向烘焙）；无精灵时回落独立生成，形状设置不生效。
                {mode === 'overlay' && '叠加档下图案类写出不生效，只认 bump 与光照/描边/轮缘光/闪光。'}
                模式编辑器预览按精灵尺寸矩形近似，真实轮廓看主画布。
              </p>
            )}
          </div>
          <div>
            <Label className="text-[9px] text-gray-600">轮廓外延宽度（px，0=关）</Label>
            <Input
              type="number" min={0} max={8} step={1}
              value={app.haloWidth ?? 0}
              onChange={(e) => patch({ haloWidth: Math.max(0, Math.min(8, Math.floor(Number(e.target.value) || 0))) })}
              className={numCls}
            />
            <p className="mt-0.5 text-[9px] text-gray-600">模式可在轮廓外这圈内继续写出（按离轮廓距离选环，如悬环、火焰边）；产物精灵随之变大，枢轴自动补偿。</p>
          </div>
          <div className={mode !== 'generate' ? 'opacity-40 pointer-events-none space-y-1.5' : 'space-y-1.5'}>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <Label className="text-[9px] text-gray-600">形状</Label>
              <select value={app.shape.kind} onChange={(e) => patchShape({ kind: e.target.value as ParametricAppearance['shape']['kind'] })} className={selCls}>
                <option value="rect">矩形（圆角）</option>
                <option value="ellipse">椭圆</option>
                <option value="capsule">胶囊</option>
                <option value="poly">多边形</option>
              </select>
            </div>
            <div>
              <Label className="text-[9px] text-gray-600">调色板家族</Label>
              <select value={app.palette} onChange={(e) => patch({ palette: e.target.value })} className={selCls}>
                {PALETTE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div>
              <Label className="text-[9px] text-gray-600">宽</Label>
              <Input type="number" value={app.shape.size[0]} onChange={(e) => patchShape({ size: [Number(e.target.value) || 1, app.shape.size[1]] })} className={numCls} />
            </div>
            <div>
              <Label className="text-[9px] text-gray-600">高</Label>
              <Input type="number" value={app.shape.size[1]} onChange={(e) => patchShape({ size: [app.shape.size[0], Number(e.target.value) || 1] })} className={numCls} />
            </div>
            <div>
              <Label className="text-[9px] text-gray-600">圆角</Label>
              <Input type="number" step="0.05" min="0" max="1" value={app.shape.roundness ?? 0} onChange={(e) => patchShape({ roundness: Number(e.target.value) || 0 })} className={numCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <Label className="text-[9px] text-gray-600">中心偏移 X</Label>
              <Input type="number" value={app.centerOffset[0]} onChange={(e) => patch({ centerOffset: [Number(e.target.value) || 0, app.centerOffset[1]] })} className={numCls} />
            </div>
            <div>
              <Label className="text-[9px] text-gray-600">中心偏移 Y</Label>
              <Input type="number" value={app.centerOffset[1]} onChange={(e) => patch({ centerOffset: [app.centerOffset[0], Number(e.target.value) || 0] })} className={numCls} />
            </div>
          </div>
          {app.shape.kind === 'poly' && (
            <div>
              <Label className="text-[9px] text-gray-600">轮廓编辑（原点=形状中心，y 向下）</Label>
              <div className="mt-1">
                <PolyContourEditor
                  poly={app.shape.poly}
                  pivot={app.shape.polyPivot}
                  size={app.shape.size}
                  onChange={(poly) => patchShape({ poly })}
                  onPivotChange={(polyPivot) => patchShape({ polyPivot })}
                />
              </div>
            </div>
          )}
          </div>
          <div>
            <Label className="text-[9px] text-gray-600">表面程序（层语言预设）</Label>
            <select
              value={SURFACE_PRESET_NAMES.includes(app.surfaceName ?? '') ? app.surfaceName : '（自定义）'}
              onChange={(e) => {
                const name = e.target.value;
                if (SURFACE_PRESETS[name]) patch({ surface: SURFACE_PRESETS[name](), surfaceName: name });
              }}
              className={selCls}
            >
              {SURFACE_PRESET_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              <option value="（自定义）">（自定义）</option>
            </select>
          </div>
          {/* 模式库（表面 DAG）：选模板 + 参数 + 我的模板管理；启用后烘焙优先走 DAG，层程序留作回退 */}
          <div>
            <Label className="text-[9px] text-gray-600">模式库（DAG 模板）</Label>
            {app.surfaceGraph ? (
              <div className="mt-1 space-y-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-cyan-300">{activeTemplate?.name ?? app.surfaceName ?? '自定义模式'}</span>
                  <span className="text-[9px] text-gray-600">已启用（烘焙走 DAG）</span>
                  <div className="flex-1" />
                  <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-violet-300"
                    onClick={() => { setCustomDefs(editorDefs); setEditorOpen(true); }}>
                    打开模式编辑器
                  </Button>
                  <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-violet-300"
                    onClick={() => setLibPanelOpen(true)}>
                    模式库管理
                  </Button>
                  <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5"
                    onClick={() => {
                      const name = window.prompt('存为我的模板，名称', app.surfaceName ?? '我的模式');
                      if (!name) return;
                      saveUserPattern(name, app.surfaceGraph!, activeTemplate?.params);
                      refreshUserPatterns();
                      patch({ surfaceName: name });
                    }}>
                    存为我的模板
                  </Button>
                  <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-red-400 hover:text-red-300"
                    onClick={() => patch({ surfaceGraph: undefined })}>
                    移除（回层程序）
                  </Button>
                </div>
                {editorDefs.map((pd) => (
                  <div key={pd.key} className="flex items-center gap-1.5">
                    <span className="w-14 text-[9px] text-gray-500">{pd.label}</span>
                    <input
                      type="range" min={pd.min} max={pd.max} step={pd.step}
                      value={app.surfaceGraph!.params?.[pd.key] ?? pd.def}
                      onChange={(e) => {
                        const g = app.surfaceGraph!;
                        patch({ surfaceGraph: { ...g, params: { ...g.params, [pd.key]: Number(e.target.value) } } });
                      }}
                      className="flex-1 h-1 accent-cyan-400"
                    />
                    <span className="w-8 text-right text-[9px] text-gray-400">{app.surfaceGraph!.params?.[pd.key] ?? pd.def}</span>
                  </div>
                ))}
                {editorDefs.length === 0 && (
                  <p className="text-[9px] text-gray-600">此图尚无暴露参数：在模式编辑器里把节点参数绑定到 $参数后，这里会出现滑杆。</p>
                )}
                {/* 动态表面（D1）：图随时间循环；图内用 phase 场源 / $phase / $phaseDeg / 流动作用域消费相位 */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <label className="flex items-center gap-1 text-[9px] text-gray-400">
                    <input
                      type="checkbox"
                      checked={!!app.surfaceGraph.animation}
                      onChange={(e) => {
                        const g = app.surfaceGraph!;
                        patch({
                          surfaceGraph: e.target.checked
                            ? { ...g, animation: g.animation ?? { cycleSec: 2, frames: 8 } }
                            : { ...g, animation: undefined },
                        });
                      }}
                    />
                    动态表面（随时间循环）
                  </label>
                  {app.surfaceGraph.animation && (
                    <>
                      <span className="text-[9px] text-gray-500">周期秒</span>
                      <input
                        type="number" min={0.1} max={120} step={0.1}
                        value={app.surfaceGraph.animation.cycleSec}
                        onChange={(e) => {
                          const g = app.surfaceGraph!;
                          patch({ surfaceGraph: { ...g, animation: { ...g.animation!, cycleSec: Number(e.target.value) } } });
                        }}
                        className="w-14 rounded border border-[#2e2e55] bg-[#101024] px-1 py-0.5 text-[10px] text-gray-200"
                      />
                      <span className="text-[9px] text-gray-500">步数</span>
                      <input
                        type="number" min={2} max={60} step={1}
                        value={app.surfaceGraph.animation.frames}
                        onChange={(e) => {
                          const g = app.surfaceGraph!;
                          patch({ surfaceGraph: { ...g, animation: { ...g.animation!, frames: Number(e.target.value) } } });
                        }}
                        className="w-12 rounded border border-[#2e2e55] bg-[#101024] px-1 py-0.5 text-[10px] text-gray-200"
                      />
                    </>
                  )}
                </div>
              </div>
            ) : (
              <select
                value=""
                onChange={(e) => {
                  const t = allTemplates.find((x) => x.id === e.target.value);
                  if (t) patch({ surfaceGraph: instantiatePattern(t), surfaceName: t.name });
                }}
                className={selCls}
              >
                <option value="">选择模板启用 DAG 模式…</option>
                {allClusters.map((c) => (
                  <optgroup key={c} label={c}>
                    {allTemplates.filter((t) => t.cluster === c).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
            {!app.surfaceGraph && (
              <Button size="sm" variant="ghost" className="mt-1 h-5 text-[9px] px-1.5 text-violet-300"
                onClick={() => {
                  const blank: SurfaceGraph = {
                    version: 1,
                    nodes: [
                      { id: 'in', op: 'inside' },
                      { id: 'g', op: 'grad', params: { axis: 'y', flip: 0 } },
                    ],
                    writes: [
                      { from: 'in', slot: 2, at: 0.5 },
                      { from: 'g', slot: 0, bump: { hi: 5, mid: 3, lo: 2 } },
                    ],
                    params: {},
                  };
                  patch({ surfaceGraph: blank, surfaceName: '空白模式' });
                  setCustomDefs([]);
                  setEditorOpen(true);
                }}>
                空白新建模式（打开编辑器）
              </Button>
            )}
            <Button size="sm" variant="ghost" className="mt-1 ml-1 h-5 text-[9px] px-1.5 text-violet-300"
              onClick={() => setLibPanelOpen(true)}>
              模式库管理
            </Button>
            {libPanelOpen && <PatternLibraryPanel onClose={() => setLibPanelOpen(false)} />}
            {editorOpen && app.surfaceGraph && graphShape && (
              <SurfaceGraphEditor
                title={app.surfaceName ?? '自定义模式'}
                graph={app.surfaceGraph}
                paramDefs={editorDefs}
                shape={graphShape}
                haloWidth={app.haloWidth ?? 0}
                onChange={(g, defs, structural) => {
                  setCustomDefs(defs);
                  let name = app.surfaceName;
                  if (structural && name && !name.endsWith('·改')) name = `${name}·改`;
                  patch(name !== app.surfaceName ? { surfaceGraph: g, surfaceName: name } : { surfaceGraph: g });
                }}
                onSaveTemplate={(name) => {
                  saveUserPattern(name, app.surfaceGraph!, customDefs ?? editorDefs);
                  refreshUserPatterns();
                  patch({ surfaceName: name });
                }}
                onClose={() => setEditorOpen(false)}
              />
            )}
            {userPatterns.length > 0 && (
              <details className="mt-1">
                <summary className="text-[9px] text-gray-500 cursor-pointer">模式库管理（我的 {userPatterns.length}）</summary>
                <div className="mt-1 space-y-1 max-h-28 overflow-y-auto">
                  {userPatterns.map((t) => (
                    <div key={t.id} className="flex items-center gap-1">
                      <span className="flex-1 text-[10px] text-gray-300 truncate">{t.name}</span>
                      <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1"
                        onClick={() => patch({ surfaceGraph: instantiatePattern(t), surfaceName: t.name })}>
                        应用
                      </Button>
                      <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1"
                        onClick={() => {
                          const name = window.prompt('改名', t.name);
                          if (name) { renameUserPattern(t.id, name); refreshUserPatterns(); }
                        }}>
                        改名
                      </Button>
                      <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1 text-red-400 hover:text-red-300"
                        onClick={() => { deleteUserPattern(t.id); refreshUserPatterns(); }}>
                        删除
                      </Button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <Label className="text-[9px] text-gray-600">光照 LIGHT</Label>
              <select value={LIGHT_NAMES[app.light]} onChange={(e) => patch({ light: (LIGHT as Record<string, number>)[e.target.value] })} className={selCls}>
                {LIGHT_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[9px] text-gray-600">描边 OUTLINE</Label>
              <select value={OUTLINE_NAMES[app.outline]} onChange={(e) => patch({ outline: (OUTLINE as Record<string, number>)[e.target.value] })} className={selCls}>
                {OUTLINE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[9px] text-gray-600">轮廓光 RIM</Label>
              <select value={RIM_NAMES[app.rim]} onChange={(e) => patch({ rim: (RIM as Record<string, number>)[e.target.value] })} className={selCls}>
                {RIM_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[9px] text-gray-600">闪光 GLINT</Label>
              <select value={GLINT_NAMES[app.glint]} onChange={(e) => patch({ glint: (GLINT as Record<string, number>)[e.target.value] })} className={selCls}>
                {GLINT_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <Label className="text-[9px] text-gray-600">rim 强度 {app.rimI.toFixed(2)}</Label>
              <input type="range" min="0" max="1" step="0.05" value={app.rimI} onChange={(e) => patch({ rimI: Number(e.target.value) })} className="w-full" />
            </div>
            <div>
              <Label className="text-[9px] text-gray-600">glint 强度 {app.glintI.toFixed(2)}</Label>
              <input type="range" min="0" max="1" step="0.05" value={app.glintI} onChange={(e) => patch({ glintI: Number(e.target.value) })} className="w-full" />
            </div>
          </div>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] text-red-400 hover:text-red-300 px-1" onClick={() => write(undefined)}>
            移除此服装集的参数化外观
          </Button>
        </div>
      )}
    </div>
  );
}
