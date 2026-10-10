'use client';

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type { MotionBlurBrushType } from '@/lib/types';

// ============================================================
// Tool-Specific Option Panels
// Each panel is shown conditionally based on the active tool.
// ============================================================

// ---- Bone Tool Controls ----

// ---- Magic Wand Tolerance ----
export function MagicWandControls() {
  const magicWandTolerance = useEditorStore((s) => s.magicWandTolerance);
  const setMagicWandTolerance = useEditorStore((s) => s.setMagicWandTolerance);

  return (
    <div className="flex items-center gap-1.5 mx-1 shrink-0">
      <span className="text-[10px] text-gray-500 uppercase tracking-wide">容差</span>
      <Slider
        className="w-16"
        value={[magicWandTolerance]}
        min={0}
        max={255}
        step={1}
        onValueChange={([v]) => setMagicWandTolerance(v)}
      />
      <span className="text-[10px] text-gray-400 w-6">{magicWandTolerance}</span>
    </div>
  );
}

// ---- Smart Select (SAM) Status ----
export function SmartSelectStatus() {
  const samState = useEditorStore((s) => s.samState);

  return (
    <div className="flex items-center gap-1.5 mx-1 shrink-0">
      {samState.status === 'idle' && (
        <span className="text-[10px] text-gray-500">点击画布初始化 AI 模型</span>
      )}
      {samState.status === 'loading' && (
        <span className="text-[10px] text-cyan-400">
          {samState.progress < 30 ? '下载模型中' : samState.progress < 70 ? '加载模型中' : '初始化推理引擎'} {samState.progress}%
        </span>
      )}
      {samState.status === 'encoding' && (
        <span className="text-[10px] text-cyan-400">图像编码中...</span>
      )}
      {samState.status === 'ready' && !samState.currentMask && (
        <span className="text-[10px] text-green-400">就绪 — 点击选择</span>
      )}
      {samState.status === 'segmenting' && (
        <span className="text-[10px] text-yellow-400">分割中...</span>
      )}
      {samState.status === 'ready' && samState.currentMask && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-green-400">已选中</span>
          <button
            className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-600/30 text-cyan-300 hover:bg-cyan-500/40 transition-colors"
            onClick={() => useEditorStore.getState().extractSAMMaskAsPart()}
            title="提取选区为新Part (Shift+E)"
          >
            提取为Part
          </button>
          <button
            className="text-[10px] px-1.5 py-0.5 rounded bg-gray-600/30 text-gray-300 hover:bg-gray-500/40 transition-colors"
            onClick={() => useEditorStore.getState().clearSAMMask()}
            title="清除选区 (Esc)"
          >
            清除
          </button>
        </div>
      )}
      {samState.status === 'error' && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-red-400" title={samState.errorMessage ?? ''}>错误: {samState.errorMessage ?? '未知'}</span>
          <button
            className="text-[10px] px-1.5 py-0.5 rounded bg-red-600/30 text-red-300 hover:bg-red-500/40 transition-colors"
            onClick={() => useEditorStore.getState().initSAMModel()}
            title="重新初始化"
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Inpaint Radius ----
export function InpaintControls() {
  const inpaintRadius = useEditorStore((s) => s.inpaintRadius);
  const setInpaintRadius = useEditorStore((s) => s.setInpaintRadius);

  return (
    <div className="flex items-center gap-1.5 mx-1 shrink-0">
      <span className="text-[10px] text-gray-500 uppercase tracking-wide">修复半径</span>
      <Slider
        className="w-16"
        value={[inpaintRadius]}
        min={1}
        max={20}
        step={1}
        onValueChange={([v]) => setInpaintRadius(v)}
      />
      <span className="text-[10px] text-gray-400 w-6">{inpaintRadius}</span>
    </div>
  );
}

// ---- Motion Blur Brush Controls ----
export function MotionBlurBrushControls({ blendMode, setBlendMode }: {
  blendMode: 'normal' | 'lighter' | 'overlay' | 'screen';
  setBlendMode: (m: 'normal' | 'lighter' | 'overlay' | 'screen') => void;
}) {
  const motionBlurBrushType = useEditorStore((s) => s.motionBlurBrushType);
  const motionBlurIntensity = useEditorStore((s) => s.motionBlurIntensity);
  const motionBlurDirection = useEditorStore((s) => s.motionBlurDirection);
  const setMotionBlurBrushType = useEditorStore((s) => s.setMotionBlurBrushType);
  const setMotionBlurIntensity = useEditorStore((s) => s.setMotionBlurIntensity);
  const setMotionBlurDirection = useEditorStore((s) => s.setMotionBlurDirection);

  return (
    <div className="flex items-center gap-1.5 mx-1 shrink-0">
      <span className="text-[10px] text-gray-500 uppercase tracking-wide">Type</span>
      <div className="flex items-center gap-0.5">
        {(['linear', 'radial', 'directional'] as MotionBlurBrushType[]).map((bt) => (
          <Button
            key={bt}
            variant="ghost"
            size="sm"
            className={`h-5 px-1.5 text-[9px] ${
              motionBlurBrushType === bt
                ? 'bg-cyan-600/30 text-cyan-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
            onClick={() => setMotionBlurBrushType(bt)}
          >
            {bt.charAt(0).toUpperCase() + bt.slice(1)}
          </Button>
        ))}
      </div>

      <span className="text-[10px] text-gray-500 uppercase tracking-wide ml-1">Intensity</span>
      <Slider
        className="w-16"
        value={[motionBlurIntensity]}
        min={1}
        max={20}
        step={1}
        onValueChange={([v]) => setMotionBlurIntensity(v)}
      />
      <span className="text-[10px] text-gray-400 w-4">{motionBlurIntensity}</span>

      {motionBlurBrushType === 'directional' && (
        <>
          <span className="text-[10px] text-gray-500 uppercase tracking-wide ml-1">Dir</span>
          <Input
            type="number"
            min={0}
            max={360}
            value={motionBlurDirection}
            onChange={(e) => setMotionBlurDirection(Number(e.target.value) || 0)}
            className="h-5 w-10 text-[10px] text-center bg-white/5 border-white/10 text-gray-300 px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[10px] text-gray-500">°</span>
        </>
      )}

      {/* Blend mode dropdown */}
      <span className="text-[10px] text-gray-500 uppercase tracking-wide ml-1">Blend</span>
      <Select value={blendMode} onValueChange={(v) => setBlendMode(v as 'normal' | 'lighter' | 'overlay' | 'screen')}>
        <SelectTrigger className="h-5 w-16 text-[9px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
          <SelectItem value="normal">Normal</SelectItem>
          <SelectItem value="lighter">Lighter</SelectItem>
          <SelectItem value="overlay">Overlay</SelectItem>
          <SelectItem value="screen">Screen</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ---- Effect Brush Controls ----
export function EffectBrushControls({ blendMode, setBlendMode }: {
  blendMode: 'normal' | 'lighter' | 'overlay' | 'screen';
  setBlendMode: (m: 'normal' | 'lighter' | 'overlay' | 'screen') => void;
}) {
  const tool = useEditorStore((s) => s.tool);
  const effectBrushColor = useEditorStore((s) => s.effectBrushColor);
  const effectBrushRadius = useEditorStore((s) => s.effectBrushRadius);
  const effectBrushIntensity = useEditorStore((s) => s.effectBrushIntensity);
  const effectBrushDensity = useEditorStore((s) => s.effectBrushDensity);
  const effectBrushSpread = useEditorStore((s) => s.effectBrushSpread);
  const setEffectBrushColor = useEditorStore((s) => s.setEffectBrushColor);
  const setEffectBrushRadius = useEditorStore((s) => s.setEffectBrushRadius);
  const setEffectBrushIntensity = useEditorStore((s) => s.setEffectBrushIntensity);
  const setEffectBrushDensity = useEditorStore((s) => s.setEffectBrushDensity);
  const setEffectBrushSpread = useEditorStore((s) => s.setEffectBrushSpread);
  const effectCoordinateMode = useEditorStore((s) => s.effectCoordinateMode);
  const setEffectCoordinateMode = useEditorStore((s) => s.setEffectCoordinateMode);

  return (
    <div className="flex items-center gap-1.5 mx-1 shrink-0">
      {/* Color */}
      <div className="relative">
        <input
          type="color"
          value={effectBrushColor}
          onChange={(e) => setEffectBrushColor(e.target.value)}
          className="w-5 h-5 rounded cursor-pointer border border-white/15 bg-transparent p-0"
          title="Effect Color"
        />
      </div>

      {/* Radius */}
      <span className="text-[10px] text-gray-500 uppercase tracking-wide">R</span>
      <Slider
        className="w-14"
        value={[effectBrushRadius]}
        min={1}
        max={20}
        step={1}
        onValueChange={([v]) => setEffectBrushRadius(v)}
      />
      <span className="text-[10px] text-gray-400 w-4">{effectBrushRadius}</span>

      {/* Intensity */}
      <span className="text-[10px] text-gray-500 uppercase tracking-wide">I</span>
      <Slider
        className="w-14"
        value={[effectBrushIntensity]}
        min={0.1}
        max={1}
        step={0.05}
        onValueChange={([v]) => setEffectBrushIntensity(v)}
      />
      <span className="text-[10px] text-gray-400 w-6">{Math.round(effectBrushIntensity * 100)}%</span>

      {/* Density (particle brush) */}
      {tool === 'particle_brush' && (
        <>
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">D</span>
          <Slider
            className="w-14"
            value={[effectBrushDensity]}
            min={1}
            max={50}
            step={1}
            onValueChange={([v]) => setEffectBrushDensity(v)}
          />
          <span className="text-[10px] text-gray-400 w-4">{effectBrushDensity}</span>
        </>
      )}

      {/* Spread (particle/afterimage) */}
      {(tool === 'particle_brush' || tool === 'afterimage_brush') && (
        <>
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">S</span>
          <Slider
            className="w-14"
            value={[effectBrushSpread]}
            min={1}
            max={30}
            step={1}
            onValueChange={([v]) => setEffectBrushSpread(v)}
          />
          <span className="text-[10px] text-gray-400 w-4">{effectBrushSpread}</span>
        </>
      )}

      {/* Coordinate mode toggle */}
      <span className="text-[10px] text-gray-500 uppercase tracking-wide ml-1">坐标</span>
      <Button
        variant="ghost"
        size="sm"
        className={`h-5 px-1.5 text-[9px] ${
          effectCoordinateMode === 'world_fixed'
            ? 'bg-red-600/20 text-red-300 border border-red-500/30'
            : 'bg-green-600/20 text-green-300 border border-green-500/30'
        }`}
        onClick={() => setEffectCoordinateMode(effectCoordinateMode === 'follow_part' ? 'world_fixed' : 'follow_part')}
      >
        {effectCoordinateMode === 'follow_part' ? '跟随部件' : '固定坐标'}
      </Button>

      {/* Blend mode dropdown */}
      <span className="text-[10px] text-gray-500 uppercase tracking-wide ml-1">Blend</span>
      <Select value={blendMode} onValueChange={(v) => setBlendMode(v as 'normal' | 'lighter' | 'overlay' | 'screen')}>
        <SelectTrigger className="h-5 w-16 text-[9px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
          <SelectItem value="normal">Normal</SelectItem>
          <SelectItem value="lighter">Lighter</SelectItem>
          <SelectItem value="overlay">Overlay</SelectItem>
          <SelectItem value="screen">Screen</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ---- Move Tool: Target Level ----
export function MoveToolControls() {
  const moveTargetLevel = useEditorStore((s) => s.moveTargetLevel);
  const setMoveTargetLevel = useEditorStore((s) => s.setMoveTargetLevel);

  return (
    <div className="flex items-center gap-1 mx-1">
      <span className="text-[10px] text-gray-400 shrink-0">目标层次</span>
      <ToggleGroup
        type="single"
        value={moveTargetLevel}
        onValueChange={(val) => {
          if (val) setMoveTargetLevel(val as 'keyframe' | 'part_global');
        }}
        className="gap-0.5"
      >
        <ToggleGroupItem
          value="keyframe"
          aria-label="关键帧"
          className={`h-6 px-2 text-[10px] ${moveTargetLevel === 'keyframe' ? 'bg-purple-600/30 text-purple-300 border-purple-500/50' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'} border border-white/10 rounded`}
        >
          关键帧
        </ToggleGroupItem>
        <ToggleGroupItem
          value="part_global"
          aria-label="部件全局"
          className={`h-6 px-2 text-[10px] ${moveTargetLevel === 'part_global' ? 'bg-cyan-600/30 text-cyan-300 border-cyan-500/50' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'} border border-white/10 rounded`}
        >
          部件全局
        </ToggleGroupItem>
      </ToggleGroup>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-[9px] text-gray-500 cursor-help border-b border-dashed border-gray-600">Alt切换</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-48">
          关键帧: 平移写入当前关键帧(帧级位置)<br/>
          部件全局: 平移写入部件全局修改器(所有帧偏移)<br/>
          按住 Alt 临时切换模式
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
