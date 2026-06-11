'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { BrushStyleType, BrushStyleParams } from '@/lib/types';
import { BRUSH_STYLE_LABELS, BRUSH_STYLE_RELEVANT_PARAMS } from '@/lib/brush-engine';
import { BS_PARAM_LABELS, BS_PARAM_RANGES, PERCENT_PARAMS, DEGREE_PARAMS, COLOR_PARAMS } from './constants';

// ---- Brush Style Params Editor (compact inline) ----
export default function BrushStyleParamsEditor({
  style,
  params,
  onChange,
}: {
  style: BrushStyleType;
  params: BrushStyleParams;
  onChange: (updates: Partial<BrushStyleParams>) => void;
}) {
  const relevantParams = BRUSH_STYLE_RELEVANT_PARAMS[style] ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[9px] text-purple-400 hover:bg-purple-600/10 hover:text-purple-300"
        >
          参数 ▾
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 bg-[#1a1a2e] border-white/10 text-gray-200 p-3" side="bottom" align="start">
        <div className="text-xs font-medium text-gray-300 mb-2">
          {BRUSH_STYLE_LABELS[style]} 参数
        </div>
        <div className="space-y-2">
          {relevantParams.map((paramName) => {
            const value = params[paramName];
            const label = BS_PARAM_LABELS[paramName] ?? paramName;

            // Color params
            if (COLOR_PARAMS.has(paramName)) {
              return (
                <div key={paramName} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-16 shrink-0">{label}</span>
                  <input
                    type="color"
                    value={String(value)}
                    onChange={(e) => onChange({ [paramName]: e.target.value })}
                    className="w-6 h-5 rounded cursor-pointer border border-white/15 bg-transparent p-0"
                  />
                  <span className="text-[9px] text-gray-500 font-mono">{String(value)}</span>
                </div>
              );
            }

            // Select params
            if (paramName === 'gradientType') {
              return (
                <div key={paramName} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-16 shrink-0">{label}</span>
                  <Select value={String(value)} onValueChange={(v) => onChange({ gradientType: v as 'linear' | 'radial' })}>
                    <SelectTrigger className="h-5 w-20 text-[9px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
                      <SelectItem value="radial">径向</SelectItem>
                      <SelectItem value="linear">线性</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            }

            // TaperCurve select
            if (paramName === 'taperCurve') {
              return (
                <div key={paramName} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-16 shrink-0">{label}</span>
                  <Select value={String(value)} onValueChange={(v) => onChange({ taperCurve: v as 'linear' | 'ease_in' | 'ease_out' | 'smooth' })}>
                    <SelectTrigger className="h-5 w-20 text-[9px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
                      <SelectItem value="smooth">平滑</SelectItem>
                      <SelectItem value="linear">线性</SelectItem>
                      <SelectItem value="ease_in">缓入</SelectItem>
                      <SelectItem value="ease_out">缓出</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            }

            // HighlightPosition select
            if (paramName === 'highlightPosition') {
              return (
                <div key={paramName} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-16 shrink-0">{label}</span>
                  <Select value={String(value)} onValueChange={(v) => onChange({ highlightPosition: v as 'top' | 'bottom' | 'left' | 'right' })}>
                    <SelectTrigger className="h-5 w-20 text-[9px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
                      <SelectItem value="top">上方</SelectItem>
                      <SelectItem value="bottom">下方</SelectItem>
                      <SelectItem value="left">左侧</SelectItem>
                      <SelectItem value="right">右侧</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            }

            // Boolean params (hollow, hasSlats)
            if (paramName === 'hollow') {
              return (
                <div key={paramName} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-16 shrink-0">{label}</span>
                  <button
                    className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${value ? 'bg-purple-600/30 border-purple-500/50 text-purple-300' : 'bg-white/5 border-white/10 text-gray-400'}`}
                    onClick={() => onChange({ hollow: !value })}
                  >
                    {value ? '空心' : '实心'}
                  </button>
                </div>
              );
            }
            if (paramName === 'hasSlats') {
              return (
                <div key={paramName} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-16 shrink-0">{label}</span>
                  <button
                    className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${value ? 'bg-cyan-600/30 border-cyan-500/50 text-cyan-300' : 'bg-white/5 border-white/10 text-gray-400'}`}
                    onClick={() => onChange({ hasSlats: !value })}
                  >
                    {value ? '开启' : '关闭'}
                  </button>
                </div>
              );
            }

            // Punctuation type select
            if (paramName === 'punctuationType') {
              return (
                <div key={paramName} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-16 shrink-0">{label}</span>
                  <Select value={String(value)} onValueChange={(v) => onChange({ punctuationType: v as any })}>
                    <SelectTrigger className="h-5 w-20 text-[9px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
                      <SelectItem value="exclamation">!</SelectItem>
                      <SelectItem value="question">?</SelectItem>
                      <SelectItem value="ellipsis">...</SelectItem>
                      <SelectItem value="comma">,</SelectItem>
                      <SelectItem value="period">.</SelectItem>
                      <SelectItem value="interrobang">?!</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            }

            // Emoji type select
            if (paramName === 'emojiType') {
              return (
                <div key={paramName} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-16 shrink-0">{label}</span>
                  <Select value={String(value)} onValueChange={(v) => onChange({ emojiType: v as any })}>
                    <SelectTrigger className="h-5 w-20 text-[9px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
                      <SelectItem value="happy">开心</SelectItem>
                      <SelectItem value="sad">伤心</SelectItem>
                      <SelectItem value="angry">生气</SelectItem>
                      <SelectItem value="surprised">惊讶</SelectItem>
                      <SelectItem value="wink">眨眼</SelectItem>
                      <SelectItem value="cool">墨镜</SelectItem>
                      <SelectItem value="love">花痴</SelectItem>
                      <SelectItem value="dizzy">晕眩</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            }

            // Number params (with slider)
            if (typeof value === 'number') {
              const [min, max, step] = BS_PARAM_RANGES[paramName] ?? [0, 100, 1];
              return (
                <div key={paramName} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-16 shrink-0">{label}</span>
                  <Slider
                    className="flex-1"
                    value={[value]}
                    min={min}
                    max={max}
                    step={step}
                    onValueChange={([v]) => onChange({ [paramName]: v })}
                  />
                  <span className="text-[9px] text-gray-400 w-10 text-right font-mono">
                    {PERCENT_PARAMS.has(paramName)
                      ? `${Math.round(value * 100)}%`
                      : DEGREE_PARAMS.has(paramName)
                        ? `${value}°`
                        : String(value)}
                  </span>
                </div>
              );
            }

            return null;
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
