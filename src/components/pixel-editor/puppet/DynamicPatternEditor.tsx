'use client';

// ============================================================
// DynamicPatternEditor — 动态模式实例编辑（节点/服装件共用）
// 模板库（内置 + 我的）+ 效果位 + 三段参数滑杆。受控组件：
// 挂载方负责落盘（节点走 updateUnifiedNode、服装件走服装集写回）。
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  DYNAMIC_PARAM_DEFS,
  DYNAMIC_PATTERN_TEMPLATES,
  createDynamicInstance,
  defaultDynamicParams,
  deleteUserDynamicPattern,
  encodeGlowMask,
  glowMaskCells,
  loadUserDynamicPatterns,
  normalizeDynamicParams,
  saveUserDynamicPattern,
  unpackMaskBits,
  type DynamicPatternInstance,
  type DynamicPatternParams,
  type DynamicPatternTemplate,
  type GlowMaskData,
} from '@/lib/dynamic-patterns';
import type { PixelGrid } from '@/lib/unified-types';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const selCls = 'h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded mt-1 w-full text-gray-300';
const numCls = 'h-6 text-[10px] bg-[#111128] border-[#1e1e3a]';

const SOURCE_OPTIONS: { v: DynamicPatternParams['source']; label: string }[] = [
  { v: 'contour', label: '轮廓（全周）' },
  { v: 'contour-top', label: '轮廓上半' },
  { v: 'contour-bottom', label: '轮廓下半' },
  { v: 'inside', label: '内部' },
  { v: 'plug', label: '枢轴点' },
];
const LAYER_OPTIONS: { v: DynamicPatternParams['layer']; label: string }[] = [
  { v: 'back', label: '身后' },
  { v: 'front', label: '身前' },
  { v: 'both', label: '两层' },
];

export default function DynamicPatternEditor({
  instances,
  onChange,
  hint,
  previewGrid,
  glowRankById,
}: {
  instances: DynamicPatternInstance[];
  onChange: (next: DynamicPatternInstance[]) => void;
  hint?: string;
  /** 当前槽位的代表图（发光段取色/手动标记用；无图时这两项不可用） */
  previewGrid?: PixelGrid | null;
  /** 双挂载解析后的发光组序（实例 id → 0 起序数）：判「超过第 3 个」用；
   *  挂载方按当前服装集解析传入，缺省按本列表顺序自算 */
  glowRankById?: ReadonlyMap<string, number>;
}) {
  const [userTemplates, setUserTemplates] = useState<DynamicPatternTemplate[]>(() => loadUserDynamicPatterns());
  const allTemplates = [...DYNAMIC_PATTERN_TEMPLATES, ...userTemplates];
  const localGlowRankById = new Map<string, number>();
  {
    let r = 0;
    for (const x of instances) {
      if (x.enabled && normalizeDynamicParams(x.params).glowEnabled) localGlowRankById.set(x.id, r++);
    }
  }

  const patchInstance = (id: string, patch: Partial<DynamicPatternInstance>) =>
    onChange(instances.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const patchParam = (id: string, key: keyof DynamicPatternParams, value: number | boolean | string | GlowMaskData) =>
    onChange(instances.map((x) => (x.id === id ? { ...x, params: { ...normalizeDynamicParams(x.params), [key]: value } } : x)));
  const np = (inst: DynamicPatternInstance): DynamicPatternParams => normalizeDynamicParams(inst.params);
  const glowRankOf = (inst: DynamicPatternInstance): number | undefined =>
    glowRankById?.get(inst.id) ?? localGlowRankById.get(inst.id);
  /** 发光组只有前 3 个独立：第 4 个起改选「并入哪一组」，不再给独立参数 */
  const glowOverflowOf = (inst: DynamicPatternInstance): boolean => {
    if (!np(inst).glowEnabled) return false;
    const rank = glowRankOf(inst);
    return rank !== undefined && rank >= 3;
  };
  const applyTemplate = (id: string, name: string) => {
    const t = allTemplates.find((x) => x.name === name);
    if (!t) return;
    patchInstance(id, { templateName: name, params: structuredClone(t.params) });
  };

  return (
    <div className="space-y-1.5">
      {hint && <p className="text-[9px] text-gray-600">{hint}</p>}
      {instances.map((inst) => (
        <div key={inst.id} className="rounded border border-[#1e1e3a] p-1.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={inst.enabled}
              onChange={(e) => patchInstance(inst.id, { enabled: e.target.checked })}
              title="启用（服装件挂载下关闭 = 压制节点同效果位实例）"
            />
            <Input
              value={inst.slot}
              onChange={(e) => patchInstance(inst.id, { slot: e.target.value })}
              className={`${numCls} w-24`}
              title="效果位（双挂载合并键）"
            />
            <select
              value={inst.templateName ?? ''}
              onChange={(e) => applyTemplate(inst.id, e.target.value)}
              className={`${selCls} flex-1`}
            >
              <option value="">（自定义参数）</option>
              {[...new Set(allTemplates.map((t) => t.cluster))].map((cluster) => (
                <optgroup key={cluster} label={cluster}>
                  {allTemplates.filter((t) => t.cluster === cluster).map((t) => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <Button
              size="sm" variant="ghost" className="h-5 text-[9px] px-1.5"
              onClick={() => {
                const name = window.prompt('存为我的模板，名称', inst.templateName ?? '我的动态效果');
                if (!name) return;
                saveUserDynamicPattern(name, inst.params);
                setUserTemplates(loadUserDynamicPatterns());
                patchInstance(inst.id, { templateName: name });
              }}
            >
              存模板
            </Button>
            <Button
              size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-red-300"
              onClick={() => onChange(instances.filter((x) => x.id !== inst.id))}
            >
              删除
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <Label className="text-[9px] text-gray-600">发射来源</Label>
              <select value={inst.params.source} onChange={(e) => patchParam(inst.id, 'source', e.target.value)} className={selCls}>
                {SOURCE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[9px] text-gray-600">绘制层</Label>
              <select value={inst.params.layer} onChange={(e) => patchParam(inst.id, 'layer', e.target.value)} className={selCls}>
                {LAYER_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-gray-400">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={inst.params.deformEnabled} onChange={(e) => patchParam(inst.id, 'deformEnabled', e.target.checked)} />
              形变段
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={inst.params.emitEnabled} onChange={(e) => patchParam(inst.id, 'emitEnabled', e.target.checked)} />
              发射段
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={np(inst).glowEnabled} onChange={(e) => patchParam(inst.id, 'glowEnabled', e.target.checked)} />
              发光段
            </label>
            <label className="flex items-center gap-1">
              颜色
              <input type="color" value={inst.params.color} onChange={(e) => patchParam(inst.id, 'color', e.target.value)} className="h-5 w-8 bg-transparent" />
            </label>
            {np(inst).glowEnabled && !glowOverflowOf(inst) && (
              <label className="flex items-center gap-1">
                辉光
                <input type="color" value={np(inst).glowColor} onChange={(e) => patchParam(inst.id, 'glowColor', e.target.value)} className="h-5 w-8 bg-transparent" />
              </label>
            )}
          </div>
          {(['形变', '发射', '粒子', '发光'] as const).map((section) => (
            <div key={section}>
              <div className="text-[9px] text-gray-600 mt-0.5">{section}</div>
              {section === '发光' && glowOverflowOf(inst) && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-gray-500 w-24 shrink-0">并入发光组</span>
                  <select
                    value={np(inst).glowFollowGroup}
                    onChange={(e) => patchParam(inst.id, 'glowFollowGroup', Number(e.target.value))}
                    className={`${selCls} flex-1`}
                    title="发光组只有前 3 个独立：第 4 个起只贡献选区，颜色与呼吸参数跟所选组"
                  >
                    <option value={0}>第 1 组</option>
                    <option value={1}>第 2 组</option>
                    <option value={2}>第 3 组</option>
                  </select>
                  <span className="text-[9px] text-gray-500">第 {(glowRankOf(inst) ?? 3) + 1} 个</span>
                </div>
              )}
              {section === '发光' && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-gray-500 w-24 shrink-0">辉光形状</span>
                  <select
                    value={np(inst).glowShape}
                    onChange={(e) => patchParam(inst.id, 'glowShape', e.target.value)}
                    className={`${selCls} flex-1`}
                    title="柔光圈的形状：方形（一直以来的样子）/ 圆形 / 十字星形（横竖伸长）/ 焰形（向上伸长收尖）/ 自定义印章（自己画轮廓）"
                  >
                    <option value="square">方形</option>
                    <option value="circle">圆形</option>
                    <option value="star">十字星形</option>
                    <option value="flame">焰形</option>
                    <option value="custom">自定义印章</option>
                  </select>
                </div>
              )}
              {section === '发光' && ['star', 'flame', 'custom'].includes(np(inst).glowShape) && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-gray-500 w-24 shrink-0">方向基准</span>
                  <select
                    value={np(inst).glowAngleSpace}
                    onChange={(e) => patchParam(inst.id, 'glowAngleSpace', e.target.value)}
                    className={`${selCls} flex-1`}
                    title="精灵方向：形状跟着精灵一起转；世界方向：精灵怎么转，形状都恒指所设的世界方向"
                  >
                    <option value="sprite">精灵方向（跟随精灵旋转）</option>
                    <option value="world">世界方向（不跟随）</option>
                  </select>
                </div>
              )}
              {DYNAMIC_PARAM_DEFS.filter((d) => d.section === section)
                .filter((d) => !(section === '发光' && glowOverflowOf(inst)
                  && (d.key === 'glowStrength' || d.key === 'glowHz' || d.key === 'glowPhase')))
                .filter((d) => !(section === '发光' && d.key === 'glowHalo' && np(inst).glowShape === 'custom'))
                .filter((d) => !(section === '发光' && d.key === 'glowStarReach' && np(inst).glowShape !== 'star'))
                .filter((d) => !(section === '发光' && d.key === 'glowFlameReach' && np(inst).glowShape !== 'flame'))
                .filter((d) => !(section === '发光' && d.key === 'glowAngleDeg' && !['star', 'flame', 'custom'].includes(np(inst).glowShape)))
                .map((d) => {
                const v = np(inst)[d.key] as number;
                return (
                  <div key={d.key} className="flex items-center gap-1.5">
                    <span className="text-[9px] text-gray-500 w-24 shrink-0">{d.label}</span>
                    <input
                      type="range" min={d.min} max={d.max} step={d.step} value={v}
                      onChange={(e) => patchParam(inst.id, d.key, Number(e.target.value))}
                      className="flex-1 h-1 accent-cyan-500"
                    />
                    <span className="text-[9px] text-gray-400 w-9 text-right">{Math.round(v * 100) / 100}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {np(inst).glowEnabled && (
            <GlowSelectionPanel
              grid={previewGrid}
              params={np(inst)}
              onPatch={(key, value) => patchParam(inst.id, key, value)}
            />
          )}
          {np(inst).glowEnabled && np(inst).glowShape === 'custom' && (
            <GlowShapeKernelPanel
              params={np(inst)}
              onPatch={(key, value) => patchParam(inst.id, key, value)}
            />
          )}
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <Button
          size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-cyan-300"
          onClick={() => {
            const t = DYNAMIC_PATTERN_TEMPLATES[0]!;
            onChange([...instances, createDynamicInstance(t.name, t.params)]);
          }}
        >
          + 添加动态效果
        </Button>
        {userTemplates.length > 0 && (
          <Button
            size="sm" variant="ghost" className="h-5 text-[9px] px-1.5"
            onClick={() => {
              const name = window.prompt('删除我的模板，名称', userTemplates[0]?.name ?? '');
              if (!name) return;
              deleteUserDynamicPattern(name);
              setUserTemplates(loadUserDynamicPatterns());
            }}
          >
            管理我的模板
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * 发光选区面板：在槽位代表图上取色（点中哪个颜色就选哪种颜色的全部像素）
 * 或手动标记（按住拖动刷选区，再点已选格起拖 = 擦除）。选区与渲染同口径：
 * 取色高亮 = glowMaskCells 的实际选区，标记直接存位打包掩码。
 */
function GlowSelectionPanel({
  grid,
  params,
  onPatch,
}: {
  grid: PixelGrid | null | undefined;
  params: DynamicPatternParams;
  onPatch: (key: keyof DynamicPatternParams, value: number | boolean | string | GlowMaskData) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ value: boolean } | null>(null);
  const h = grid?.length ?? 0;
  const w = h > 0 ? grid![0].length : 0;
  const cell = w > 0 ? Math.max(2, Math.min(10, Math.floor(184 / Math.max(w, h)))) : 4;
  const marked = params.glowMaskSource === 'marked';

  const overlay: Uint8Array | null = React.useMemo(() => {
    if (!grid || !w || !h) return null;
    if (marked) {
      const out = new Uint8Array(w * h);
      const m = params.glowMask;
      if (m && m.w && m.h) {
        const src = unpackMaskBits(m.bits, m.w * m.h);
        for (let y = 0; y < Math.min(h, m.h); y++) {
          for (let x = 0; x < Math.min(w, m.w); x++) out[y * w + x] = src[y * m.w + x];
        }
      }
      return out;
    }
    return glowMaskCells({ ...params, glowEnabled: true }, grid) ?? new Uint8Array(w * h);
  }, [grid, marked, params, w, h]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid || !overlay) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = grid[y][x];
        ctx.fillStyle = c ?? (((x + y) % 2 === 0) ? '#1a1a2e' : '#141424');
        ctx.fillRect(x * cell, y * cell, cell, cell);
        if (overlay[y * w + x]) {
          ctx.fillStyle = marked ? 'rgba(255,80,180,0.55)' : 'rgba(0,229,255,0.5)';
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }
  }, [grid, overlay, cell, w, h, marked]);

  const cellAt = (e: React.PointerEvent): { x: number; y: number } | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !w || !h) return null;
    const x = Math.floor((e.clientX - rect.left) / cell);
    const y = Math.floor((e.clientY - rect.top) / cell);
    return x >= 0 && y >= 0 && x < w && y < h ? { x, y } : null;
  };
  const applyAt = (x: number, y: number, value: boolean) => {
    if (!grid || !overlay) return;
    const boolGrid: boolean[][] = [];
    for (let yy = 0; yy < h; yy++) {
      const row: boolean[] = [];
      for (let xx = 0; xx < w; xx++) row.push(!!overlay[yy * w + xx]);
      boolGrid.push(row);
    }
    boolGrid[y][x] = value;
    onPatch('glowMask', encodeGlowMask(boolGrid));
  };

  const markedCount = overlay && marked ? overlay.reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="rounded border border-[#1e1e3a] p-1.5 space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-gray-500">发光选区</span>
        <select
          value={params.glowMaskSource}
          onChange={(e) => onPatch('glowMaskSource', e.target.value)}
          className={`${selCls} flex-1`}
        >
          <option value="color">取色（按颜色选像素）</option>
          <option value="marked">手动标记</option>
        </select>
        {!marked && (
          <label className="flex items-center gap-1 text-[9px] text-gray-400">
            目标色
            <input
              type="color" value={params.glowPick}
              onChange={(e) => onPatch('glowPick', e.target.value)}
              className="h-5 w-8 bg-transparent"
            />
            <span className="text-gray-500">{params.glowPick}</span>
          </label>
        )}
        {marked && overlay && (
          <>
            <span className="text-[9px] text-gray-500">已标记 {markedCount} 像素</span>
            <Button
              size="sm" variant="ghost" className="h-5 text-[9px] px-1.5"
              onClick={() => grid && onPatch('glowMask', encodeGlowMask(grid.map((row) => row.map(() => false))))}
            >
              清除
            </Button>
          </>
        )}
      </div>
      {grid ? (
        <>
          <canvas
            ref={canvasRef}
            width={w * cell}
            height={h * cell}
            className="max-w-full border border-[#1e1e3a] rounded cursor-crosshair touch-none"
            onPointerDown={(e) => {
              const p = cellAt(e);
              if (!p || !grid) return;
              if (!marked) {
                const c = grid[p.y][p.x];
                if (c) onPatch('glowPick', c.toLowerCase());
                return;
              }
              if (!overlay) return;
              dragRef.current = { value: !overlay[p.y * w + p.x] };
              applyAt(p.x, p.y, dragRef.current.value);
              (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragRef.current || !marked) return;
              const p = cellAt(e);
              if (p) applyAt(p.x, p.y, dragRef.current.value);
            }}
            onPointerUp={() => { dragRef.current = null; }}
            onPointerLeave={() => { dragRef.current = null; }}
          />
          <p className="text-[9px] text-gray-600">
            {marked ? '在图上按住拖动标记发光像素；从已标记处起拖 = 擦除。' : '在图上点一种颜色，所有同色像素一起发光（高亮即选区）。'}
          </p>
        </>
      ) : (
        <p className="text-[9px] text-gray-600">当前槽位没有可用的代表图 — 先给这个槽位配上精灵或参数化外观，才能取色/标记。</p>
      )}
    </div>
  );
}

const KERNEL_SIZE = 15;

/** 自定义印章的缺省轮廓：半径 5 的圆 */
function defaultKernelGrid(): boolean[][] {
  const c = Math.floor(KERNEL_SIZE / 2);
  return Array.from({ length: KERNEL_SIZE }, (_, y) =>
    Array.from({ length: KERNEL_SIZE }, (_, x) => (x - c) ** 2 + (y - c) ** 2 <= 25));
}

/**
 * 自定义辉光印章面板：画柔光圈的轮廓（15×15，中心对准每个选区像素盖下去）。
 * 亮度按轮廓内深度衰减（越靠中心越亮），与 glowStamp 的 custom 口径一致。
 */
function GlowShapeKernelPanel({
  params,
  onPatch,
}: {
  params: DynamicPatternParams;
  onPatch: (key: keyof DynamicPatternParams, value: number | boolean | string | GlowMaskData) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ value: boolean } | null>(null);
  const cell = 12;
  const boolGrid: boolean[][] = React.useMemo(() => {
    const k = params.glowShapeKernel;
    if (k && k.w === KERNEL_SIZE && k.h === KERNEL_SIZE) {
      const cells = unpackMaskBits(k.bits, KERNEL_SIZE * KERNEL_SIZE);
      return Array.from({ length: KERNEL_SIZE }, (_, y) =>
        Array.from({ length: KERNEL_SIZE }, (_, x) => !!cells[y * KERNEL_SIZE + x]));
    }
    return defaultKernelGrid();
  }, [params.glowShapeKernel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const c = Math.floor(KERNEL_SIZE / 2);
    for (let y = 0; y < KERNEL_SIZE; y++) {
      for (let x = 0; x < KERNEL_SIZE; x++) {
        ctx.fillStyle = boolGrid[y][x] ? 'rgba(255,170,60,0.85)' : (((x + y) % 2 === 0) ? '#1a1a2e' : '#141424');
        ctx.fillRect(x * cell, y * cell, cell, cell);
        if (x === c && y === c) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillRect(x * cell + cell / 2 - 1, y * cell + cell / 2 - 1, 2, 2);
        }
      }
    }
  }, [boolGrid, cell]);

  const applyAt = (x: number, y: number, value: boolean) => {
    const next = boolGrid.map((row) => [...row]);
    next[y][x] = value;
    onPatch('glowShapeKernel', encodeGlowMask(next));
  };
  const cellAt = (e: React.PointerEvent): { x: number; y: number } | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.floor((e.clientX - rect.left) / cell);
    const y = Math.floor((e.clientY - rect.top) / cell);
    return x >= 0 && y >= 0 && x < KERNEL_SIZE && y < KERNEL_SIZE ? { x, y } : null;
  };

  return (
    <div className="rounded border border-[#1e1e3a] p-1.5 space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-gray-500">辉光印章（中心点对准选区像素）</span>
        <Button
          size="sm" variant="ghost" className="h-5 text-[9px] px-1.5"
          onClick={() => onPatch('glowShapeKernel', encodeGlowMask(defaultKernelGrid()))}
        >
          填成圆形
        </Button>
        <Button
          size="sm" variant="ghost" className="h-5 text-[9px] px-1.5"
          onClick={() => onPatch('glowShapeKernel', encodeGlowMask(Array.from({ length: KERNEL_SIZE }, () => Array(KERNEL_SIZE).fill(false))))}
        >
          清空
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        width={KERNEL_SIZE * cell}
        height={KERNEL_SIZE * cell}
        className="max-w-full border border-[#1e1e3a] rounded cursor-crosshair touch-none"
        onPointerDown={(e) => {
          const p = cellAt(e);
          if (!p) return;
          dragRef.current = { value: !boolGrid[p.y][p.x] };
          applyAt(p.x, p.y, dragRef.current.value);
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          const p = cellAt(e);
          if (p) applyAt(p.x, p.y, dragRef.current.value);
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerLeave={() => { dragRef.current = null; }}
      />
      <p className="text-[9px] text-gray-600">按住拖动画轮廓；从已画处起拖 = 擦除。轮廓内越靠中心越亮，边缘淡出。</p>
    </div>
  );
}

export function createBlankDynamicInstance(): DynamicPatternInstance {
  return createDynamicInstance('', defaultDynamicParams());
}
