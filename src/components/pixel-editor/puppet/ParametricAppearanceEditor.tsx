'use client';

// ============================================================
// ParametricAppearanceEditor — 槽位参数化外观编辑（Rig 面板内）
// 编辑对象 = 当前服装集 piece.parametric（按服装集存，换集即换外观）。
// 字段与 proc-runtime 的运行时包同构：形状 / 表面层程序预设 / 调色板 /
// 四个枚举槽位 / rim·glint 强度。主渲染管线不消费此数据，它服务于
// 程序化预览与「程序化运行时包」导出。
// ============================================================

import React, { useState } from 'react';
import { useProjectStore } from '@/lib/store';
import { createDefaultCostumePiece } from '@/lib/unified-types';
import type { ParametricAppearance } from '@/lib/unified-types';
import {
  PALETTE_NAMES, LIGHT, OUTLINE, RIM, GLINT,
  LIGHT_NAMES, OUTLINE_NAMES, RIM_NAMES, GLINT_NAMES,
} from '@/lib/proc-runtime/palettes';
import { SURFACE_PRESETS, SURFACE_PRESET_NAMES, createDefaultParametricAppearance } from '@/lib/proc-runtime/surfaces';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const selCls = 'h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded mt-1 w-full text-gray-300';
const numCls = 'h-6 text-[10px] bg-[#111128] border-[#1e1e3a]';

export default function ParametricAppearanceEditor({ characterId, slotKey }: { characterId: string; slotKey: string }) {
  const character = useProjectStore((s) => s.unifiedCharacters[characterId]);
  const [polyText, setPolyText] = useState<string | null>(null);
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
              <Label className="text-[9px] text-gray-600">轮廓点（x,y 空格分隔，原点=形状中心，y 向下）</Label>
              <Input
                value={polyText ?? (app.shape.poly ?? []).map((p) => p.join(',')).join(' ')}
                onChange={(e) => {
                  setPolyText(e.target.value);
                  const pts = e.target.value.trim().split(/\s+/).map((tok) => tok.split(',').map(Number));
                  if (pts.length >= 3 && pts.every((p) => p.length === 2 && p.every((v) => Number.isFinite(v)))) {
                    patchShape({ poly: pts as [number, number][] });
                  }
                }}
                onBlur={() => setPolyText(null)}
                className={numCls + ' w-full'}
              />
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
