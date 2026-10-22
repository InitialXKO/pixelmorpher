'use client';

// ============================================================
// ParametricAppearanceEditor — 槽位参数化外观编辑（Rig 面板内）
// 编辑对象 = 当前服装集 piece.parametric（按服装集存，换集即换外观）。
// 字段与 proc-runtime 的运行时包同构：形状 / 表面层程序预设 / 调色板 /
// 四个枚举槽位 / rim·glint 强度。主渲染管线不消费此数据，它服务于
// 程序化预览与「程序化运行时包」导出。
// ============================================================

import React from 'react';
import { useProjectStore } from '@/lib/store';
import { createDefaultCostumePiece } from '@/lib/unified-types';
import type { ParametricAppearance } from '@/lib/unified-types';
import {
  PALETTE_NAMES, LIGHT, OUTLINE, RIM, GLINT,
  LIGHT_NAMES, OUTLINE_NAMES, RIM_NAMES, GLINT_NAMES,
} from '@/lib/proc-runtime/palettes';
import { SURFACE_PRESETS, SURFACE_PRESET_NAMES, createDefaultParametricAppearance } from '@/lib/proc-runtime/surfaces';
import PolyContourEditor from './PolyContourEditor';
import { PATTERN_TEMPLATES, instantiatePattern, patternTemplateByName } from '@/lib/proc-runtime/pattern-templates';
const PATTERN_CLUSTERS = [...new Set(PATTERN_TEMPLATES.map((t) => t.cluster))];
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const selCls = 'h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded mt-1 w-full text-gray-300';
const numCls = 'h-6 text-[10px] bg-[#111128] border-[#1e1e3a]';

export default function ParametricAppearanceEditor({ characterId, slotKey }: { characterId: string; slotKey: string }) {
  const character = useProjectStore((s) => s.unifiedCharacters[characterId]);
  if (!character) return null;
  const set = character.costumeSets.find((cs) => cs.id === character.activeCostumeSetId) ?? character.costumeSets[0];
  if (!set) {
    return <div className="text-[10px] text-gray-500">参数化外观：角色尚无服装集，先在换装中新建服装集。</div>;
  }
  const piece = set.pieces[slotKey];
  const app = piece?.parametric;

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
        按服装集存（当前：{set.name}）；槽位 {slotKey}。主画布渲染仍走精灵，此数据供程序化预览/导出。
      </p>
      {app && (
        <div className="mt-1.5 space-y-1.5">
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
          {/* 模式模板（表面 DAG）：选模板 + 参数；启用后烘焙优先走 DAG，层程序留作回退 */}
          <div>
            <Label className="text-[9px] text-gray-600">模式模板（DAG）</Label>
            {app.surfaceGraph ? (
              <div className="mt-1 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-cyan-300">{patternTemplateByName(app.surfaceName)?.name ?? app.surfaceName ?? '自定义模式'}</span>
                  <span className="text-[9px] text-gray-600">已启用（烘焙走 DAG）</span>
                  <div className="flex-1" />
                  <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-red-400 hover:text-red-300"
                    onClick={() => patch({ surfaceGraph: undefined })}>
                    移除（回层程序）
                  </Button>
                </div>
                {(patternTemplateByName(app.surfaceName)?.params ?? []).map((pd) => (
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
                {!patternTemplateByName(app.surfaceName) && (
                  <p className="text-[9px] text-gray-600">自定义图（非模板实例）：参数在图数据内，模板滑杆不适用。</p>
                )}
              </div>
            ) : (
              <select
                value=""
                onChange={(e) => {
                  const t = PATTERN_TEMPLATES.find((x) => x.id === e.target.value);
                  if (t) patch({ surfaceGraph: instantiatePattern(t), surfaceName: t.name });
                }}
                className={selCls}
              >
                <option value="">选择模板启用 DAG 模式…</option>
                {PATTERN_CLUSTERS.map((c) => (
                  <optgroup key={c} label={c}>
                    {PATTERN_TEMPLATES.filter((t) => t.cluster === c).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
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
