'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEditorStore } from '@/lib/store';
import type { StyleAspectType, StrokeParamDriver } from '@/lib/types';
import { ASPECT_TYPE_LABELS, ASPECT_TYPE_PARAMS, STROKE_DRIVER_TARGET_LABELS, STROKE_DRIVER_WAVEFORM_LABELS } from '@/lib/types';
import { BS_PARAM_LABELS, BS_PARAM_RANGES, COLOR_PARAMS } from './constants';

// ---- Composable Style Editor (styleAspects + strokeDrivers) ----
export default function ComposableStyleEditor() {
  const compositingMode = useEditorStore((s) => s.compositingMode);
  const styleAspects = useEditorStore((s) => s.styleAspects);
  const strokeDrivers = useEditorStore((s) => s.strokeDrivers);
  const setCompositingMode = useEditorStore((s) => s.setCompositingMode);
  const addStyleAspect = useEditorStore((s) => s.addStyleAspect);
  const removeStyleAspect = useEditorStore((s) => s.removeStyleAspect);
  const toggleStyleAspect = useEditorStore((s) => s.toggleStyleAspect);
  const updateStyleAspectParams = useEditorStore((s) => s.updateStyleAspectParams);
  const clearStyleAspects = useEditorStore((s) => s.clearStyleAspects);
  const addStrokeDriver = useEditorStore((s) => s.addStrokeDriver);
  const removeStrokeDriver = useEditorStore((s) => s.removeStrokeDriver);
  const updateStrokeDriver = useEditorStore((s) => s.updateStrokeDriver);
  const toggleStrokeDriver = useEditorStore((s) => s.toggleStrokeDriver);
  const clearStrokeDrivers = useEditorStore((s) => s.clearStrokeDrivers);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 px-1.5 text-[9px] ${compositingMode ? 'text-amber-400 hover:bg-amber-600/10' : 'text-gray-400 hover:bg-white/5'}`}
        >
          组合{styleAspects.filter(a => a.enabled).length > 0 ? `(${styleAspects.filter(a => a.enabled).length})` : ''} ▾
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 bg-[#1a1a2e] border-white/10 text-gray-200 p-3 max-h-96 overflow-y-auto" side="bottom" align="start">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-300">样式组合</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[9px] text-red-400 hover:bg-red-600/10"
              onClick={() => { clearStyleAspects(); clearStrokeDrivers(); }}
            >
              清空
            </Button>
            <Button
              variant={compositingMode ? 'default' : 'ghost'}
              size="sm"
              className={`h-5 px-1.5 text-[9px] ${compositingMode ? 'bg-amber-600 text-white' : 'text-amber-400 hover:bg-amber-600/10'}`}
              onClick={() => setCompositingMode(!compositingMode)}
            >
              {compositingMode ? '已启用' : '启用'}
            </Button>
          </div>
        </div>

        {/* Add aspect */}
        <div className="flex items-center gap-1 mb-2">
          <Select onValueChange={(v) => addStyleAspect(v as StyleAspectType)}>
            <SelectTrigger className="h-5 w-full text-[9px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
              <SelectValue placeholder="+ 添加样式模块..." />
            </SelectTrigger>
            <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
              {(Object.entries(ASPECT_TYPE_LABELS) as [StyleAspectType, string][]).map(([type, label]) => (
                <SelectItem key={type} value={type}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Active aspects list */}
        {styleAspects.length === 0 && (
          <div className="text-[9px] text-gray-500 text-center py-2">
            点击上方添加样式模块，自由组合各种效果
          </div>
        )}
        {styleAspects.map((aspect) => (
          <div key={aspect.id} className="border border-white/5 rounded p-2 mb-1.5">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <button
                  className={`w-3 h-3 rounded-sm border ${aspect.enabled ? 'bg-amber-500 border-amber-400' : 'bg-transparent border-white/20'}`}
                  onClick={() => toggleStyleAspect(aspect.id)}
                />
                <span className="text-[10px] text-gray-200">{ASPECT_TYPE_LABELS[aspect.type]}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 text-gray-500 hover:text-red-400"
                onClick={() => removeStyleAspect(aspect.id)}
              >
                ×
              </Button>
            </div>
            {/* Aspect params */}
            {aspect.enabled && ASPECT_TYPE_PARAMS[aspect.type]?.map((paramKey) => {
              const val = aspect.params[paramKey];
              if (COLOR_PARAMS.has(paramKey)) {
                return (
                  <div key={paramKey} className="flex items-center gap-1 mb-0.5">
                    <span className="text-[9px] text-gray-400 w-12 shrink-0">{BS_PARAM_LABELS[paramKey] ?? paramKey}</span>
                    <input
                      type="color"
                      value={String(val)}
                      onChange={(e) => updateStyleAspectParams(aspect.id, { [paramKey]: e.target.value })}
                      className="w-5 h-4 rounded cursor-pointer border border-white/10 bg-transparent p-0"
                    />
                  </div>
                );
              }
              if (paramKey === 'taperCurve' || paramKey === 'highlightPosition') {
                const options = paramKey === 'taperCurve'
                  ? [{ v: 'smooth', l: '平滑' }, { v: 'linear', l: '线性' }, { v: 'ease_in', l: '缓入' }, { v: 'ease_out', l: '缓出' }]
                  : [{ v: 'top', l: '上方' }, { v: 'bottom', l: '下方' }, { v: 'left', l: '左侧' }, { v: 'right', l: '右侧' }];
                return (
                  <div key={paramKey} className="flex items-center gap-1 mb-0.5">
                    <span className="text-[9px] text-gray-400 w-12 shrink-0">{BS_PARAM_LABELS[paramKey] ?? paramKey}</span>
                    <Select value={String(val)} onValueChange={(v) => updateStyleAspectParams(aspect.id, { [paramKey]: v })}>
                      <SelectTrigger className="h-4 flex-1 text-[8px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
                        {options.map(o => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                );
              }
              if (typeof val === 'number') {
                const [min, max, step] = BS_PARAM_RANGES[paramKey] ?? [0, 100, 1];
                const isPercent = ['minSizeRatio','highlightSize','highlightIntensity','wallShade','lightIntensity','organicNoise','branchDensity','segmentTaper','bellowsWidth','taperLength','innerRadius','falloff','density','glowIntensity'].includes(paramKey);
                return (
                  <div key={paramKey} className="flex items-center gap-1 mb-0.5">
                    <span className="text-[9px] text-gray-400 w-12 shrink-0">{BS_PARAM_LABELS[paramKey] ?? paramKey}</span>
                    <Slider className="flex-1" value={[val]} min={min} max={max} step={step}
                      onValueChange={([v]) => updateStyleAspectParams(aspect.id, { [paramKey]: v })} />
                    <span className="text-[8px] text-gray-400 w-8 text-right font-mono">
                      {isPercent ? `${Math.round(val * 100)}%` : paramKey === 'lightDirection' ? `${val}°` : String(val)}
                    </span>
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}

        {/* Stroke Direction Parameter Drivers */}
        <div className="border-t border-white/10 mt-2 pt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-300">笔画方向驱动器</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[9px] text-emerald-400 hover:bg-emerald-600/10"
              onClick={() => addStrokeDriver({
                id: crypto.randomUUID(),
                targetParam: 'size',
                waveform: 'bump',
                amplitude: 0.5,
                center: 0.5,
                width: 0.3,
                frequency: 1,
                phase: 0,
                direction: 'forward',
                enabled: true,
              })}
            >
              + 驱动器
            </Button>
          </div>
          {strokeDrivers.length === 0 && (
            <div className="text-[9px] text-gray-500 text-center py-1">
              添加驱动器使参数沿笔画方向动画变化
            </div>
          )}
          {strokeDrivers.map((driver) => (
            <div key={driver.id} className="border border-white/5 rounded p-1.5 mb-1">
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1">
                  <button
                    className={`w-3 h-3 rounded-sm border ${driver.enabled ? 'bg-emerald-500 border-emerald-400' : 'bg-transparent border-white/20'}`}
                    onClick={() => toggleStrokeDriver(driver.id)}
                  />
                  <span className="text-[9px] text-gray-200">
                    {STROKE_DRIVER_TARGET_LABELS[driver.targetParam]}·{STROKE_DRIVER_WAVEFORM_LABELS[driver.waveform]}
                  </span>
                </div>
                <Button variant="ghost" size="sm" className="h-4 w-4 p-0 text-gray-500 hover:text-red-400"
                  onClick={() => removeStrokeDriver(driver.id)}>×</Button>
              </div>
              {driver.enabled && (
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-gray-400 w-10">目标</span>
                    <Select value={driver.targetParam} onValueChange={(v) => updateStrokeDriver(driver.id, { targetParam: v as StrokeParamDriver['targetParam'] })}>
                      <SelectTrigger className="h-4 flex-1 text-[8px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
                        {(Object.entries(STROKE_DRIVER_TARGET_LABELS) as [string, string][]).map(([k, l]) => (
                          <SelectItem key={k} value={k}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-gray-400 w-10">波形</span>
                    <Select value={driver.waveform} onValueChange={(v) => updateStrokeDriver(driver.id, { waveform: v as StrokeParamDriver['waveform'] })}>
                      <SelectTrigger className="h-4 flex-1 text-[8px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
                        {(Object.entries(STROKE_DRIVER_WAVEFORM_LABELS) as [string, string][]).map(([k, l]) => (
                          <SelectItem key={k} value={k}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-gray-400 w-10">幅度</span>
                    <Slider className="flex-1" value={[driver.amplitude]} min={0} max={1} step={0.05}
                      onValueChange={([v]) => updateStrokeDriver(driver.id, { amplitude: v })} />
                    <span className="text-[8px] text-gray-400 w-6 text-right font-mono">{Math.round(driver.amplitude * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-gray-400 w-10">中心</span>
                    <Slider className="flex-1" value={[driver.center]} min={0} max={1} step={0.05}
                      onValueChange={([v]) => updateStrokeDriver(driver.id, { center: v })} />
                    <span className="text-[8px] text-gray-400 w-6 text-right font-mono">{Math.round(driver.center * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-gray-400 w-10">宽度</span>
                    <Slider className="flex-1" value={[driver.width]} min={0.01} max={1} step={0.01}
                      onValueChange={([v]) => updateStrokeDriver(driver.id, { width: v })} />
                    <span className="text-[8px] text-gray-400 w-6 text-right font-mono">{Math.round(driver.width * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-gray-400 w-10">频率</span>
                    <Slider className="flex-1" value={[driver.frequency]} min={1} max={10} step={1}
                      onValueChange={([v]) => updateStrokeDriver(driver.id, { frequency: v })} />
                    <span className="text-[8px] text-gray-400 w-6 text-right font-mono">{driver.frequency}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-gray-400 w-10">相位</span>
                    <Slider className="flex-1" value={[driver.phase]} min={0} max={1} step={0.05}
                      onValueChange={([v]) => updateStrokeDriver(driver.id, { phase: v })} />
                    <span className="text-[8px] text-gray-400 w-6 text-right font-mono">{Math.round(driver.phase * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-gray-400 w-10">方向</span>
                    <Select value={driver.direction} onValueChange={(v) => updateStrokeDriver(driver.id, { direction: v as 'forward' | 'reverse' })}>
                      <SelectTrigger className="h-4 flex-1 text-[8px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
                        <SelectItem value="forward">正向</SelectItem>
                        <SelectItem value="reverse">反向</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
