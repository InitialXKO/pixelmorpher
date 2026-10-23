'use client';

// ============================================================
// DynamicPatternEditor — 动态模式实例编辑（节点/服装件共用）
// 模板库（内置 + 我的）+ 效果位 + 三段参数滑杆。受控组件：
// 挂载方负责落盘（节点走 updateUnifiedNode、服装件走服装集写回）。
// ============================================================

import React, { useState } from 'react';
import {
  DYNAMIC_PARAM_DEFS,
  DYNAMIC_PATTERN_TEMPLATES,
  createDynamicInstance,
  defaultDynamicParams,
  deleteUserDynamicPattern,
  loadUserDynamicPatterns,
  saveUserDynamicPattern,
  type DynamicPatternInstance,
  type DynamicPatternParams,
  type DynamicPatternTemplate,
} from '@/lib/dynamic-patterns';
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
}: {
  instances: DynamicPatternInstance[];
  onChange: (next: DynamicPatternInstance[]) => void;
  hint?: string;
}) {
  const [userTemplates, setUserTemplates] = useState<DynamicPatternTemplate[]>(() => loadUserDynamicPatterns());
  const allTemplates = [...DYNAMIC_PATTERN_TEMPLATES, ...userTemplates];

  const patchInstance = (id: string, patch: Partial<DynamicPatternInstance>) =>
    onChange(instances.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const patchParam = (id: string, key: keyof DynamicPatternParams, value: number | boolean | string) =>
    onChange(instances.map((x) => (x.id === id ? { ...x, params: { ...x.params, [key]: value } } : x)));
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
              颜色
              <input type="color" value={inst.params.color} onChange={(e) => patchParam(inst.id, 'color', e.target.value)} className="h-5 w-8 bg-transparent" />
            </label>
          </div>
          {(['形变', '发射', '粒子'] as const).map((section) => (
            <div key={section}>
              <div className="text-[9px] text-gray-600 mt-0.5">{section}</div>
              {DYNAMIC_PARAM_DEFS.filter((d) => d.section === section).map((d) => {
                const v = inst.params[d.key] as number;
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

export function createBlankDynamicInstance(): DynamicPatternInstance {
  return createDynamicInstance('', defaultDynamicParams());
}
