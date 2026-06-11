'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useProjectStore } from '@/lib/store';
import type { ParamDriver, ParamDriverWaveform } from '@/lib/types';
import { MODIFIER_DEFINITIONS, PARAM_DRIVER_WAVEFORM_LABELS, evaluateParamDriver } from '@/lib/types';

// ---- M7: ParamDriver Edit Dialog ----
export default function ParamDriverEditDialog({
  open,
  onOpenChange,
  keyframeId,
  modifierId,
  driverId,
  source,
  partId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyframeId: string | null;
  modifierId: string | null;
  driverId: string | null;
  source?: 'keyframe' | 'animation';
  partId?: string | null;
}) {
  const isAnim = source === 'animation';
  const {
    keyframes, updateParamDriver, removeParamDriver, bakeParamDriver, unbakeParamDriver, addParamDriver, totalFrames,
    parts, addAnimParamDriver, updateAnimParamDriver, removeAnimParamDriver, bakeAnimParamDriver, unbakeAnimParamDriver,
  } = useProjectStore();
  const [activeDriverId, setActiveDriverId] = useState<string | null>(null);

  const modifier = useMemo(() => {
    if (!modifierId) return null;
    if (isAnim) {
      if (!partId) return null;
      const part = parts.find((p) => p.id === partId);
      return part?.animationModifiers.find((m) => m.id === modifierId) ?? null;
    }
    if (!keyframeId) return null;
    const kf = keyframes.find((k) => k.id === keyframeId);
    return kf?.modifiers.find((m) => m.id === modifierId) ?? null;
  }, [isAnim, parts, partId, keyframes, keyframeId, modifierId]);

  const drivers = modifier?.paramDrivers ?? [];
  const activeDriver = drivers.find((d) => d.id === (activeDriverId ?? driverId)) ?? null;

  useEffect(() => {
    if (open && driverId) setActiveDriverId(driverId);
  }, [open, driverId]);

  const numericParams = useMemo(() => {
    if (!modifier) return [];
    const def = MODIFIER_DEFINITIONS.find((d) => d.type === modifier.type);
    return def?.params.filter((p) => p.type === 'number') ?? [];
  }, [modifier]);

  const previewPath = useMemo(() => {
    if (!activeDriver) return '';
    const startFrame = activeDriver.startFrame;
    const endFrame = activeDriver.endFrame >= 0 ? activeDriver.endFrame : totalFrames - 1;
    const points: string[] = [];
    const width = 280;
    const height = 60;
    for (let f = startFrame; f <= endFrame; f++) {
      const value = evaluateParamDriver(activeDriver, f);
      const displayRange = activeDriver.waveform === 'linear_ramp' || activeDriver.waveform === 'exponential_decay'
        ? Math.abs(activeDriver.endValue - activeDriver.baseValue) || Math.abs(activeDriver.amplitude) || 10
        : activeDriver.amplitude || 10;
      const normalizedValue = (value - activeDriver.baseValue) / displayRange;
      const clampedValue = Math.max(-1, Math.min(1, normalizedValue));
      const x = ((f - startFrame) / Math.max(1, endFrame - startFrame)) * width;
      const y = height / 2 - clampedValue * (height / 2 - 4);
      points.push(`${x},${y}`);
    }
    return points.join(' ');
  }, [activeDriver, totalFrames]);

  const handleAddDriver = useCallback(() => {
    if (!modifierId || numericParams.length === 0) return;
    const firstParam = numericParams[0];
    if (isAnim) addAnimParamDriver(partId!, modifierId, firstParam.name);
    else addParamDriver(keyframeId!, modifierId, firstParam.name);
  }, [isAnim, partId, keyframeId, modifierId, numericParams, addAnimParamDriver, addParamDriver]);

  const handleUpdate = useCallback((updates: Partial<ParamDriver>) => {
    if (!modifierId || !activeDriver) return;
    if (isAnim) updateAnimParamDriver(partId!, modifierId, activeDriver.id, updates);
    else updateParamDriver(keyframeId!, modifierId, activeDriver.id, updates);
  }, [isAnim, partId, keyframeId, modifierId, activeDriver, updateAnimParamDriver, updateParamDriver]);

  if (!modifier) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-[#0f0f24] border-[#2a2a4a] text-white">
        <DialogHeader>
          <DialogTitle className="text-sm">
            ParamDriver 管理 — {MODIFIER_DEFINITIONS.find((d) => d.type === modifier.type)?.label ?? modifier.type}
          </DialogTitle>
          <DialogDescription className="text-xs text-gray-400">
            用波形函数自动驱动修改器的数值参数，烘焙后可手动编辑关键帧
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-gray-300">驱动器列表</Label>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleAddDriver}>+ 添加</Button>
            </div>
            {drivers.length === 0 && (
              <div className="text-xs text-gray-500 py-2 text-center">暂无驱动器，点击"添加"创建</div>
            )}
            {drivers.map((driver) => (
              <div
                key={driver.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs ${
                  activeDriver?.id === driver.id ? 'bg-[#1a1a3e] ring-1 ring-cyan-500/40' : 'hover:bg-[#141428]'
                }`}
                onClick={() => setActiveDriverId(driver.id)}
              >
                <span className={driver.enabled ? 'text-cyan-400' : 'text-gray-500'}>{driver.paramName}</span>
                <span className="text-gray-400">{PARAM_DRIVER_WAVEFORM_LABELS[driver.waveform]}</span>
                {driver.isBaked && <span className="text-amber-400 text-[10px]">BAKED</span>}
                <div className="flex-1" />
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-[10px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (modifierId) {
                      if (isAnim) { driver.isBaked ? unbakeAnimParamDriver(partId!, modifierId, driver.id) : bakeAnimParamDriver(partId!, modifierId, driver.id); }
                      else if (keyframeId) { driver.isBaked ? unbakeParamDriver(keyframeId, modifierId, driver.id) : bakeParamDriver(keyframeId, modifierId, driver.id); }
                    }
                  }}>
                  {driver.isBaked ? '↩' : '🔥'}
                </Button>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400 text-[10px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (modifierId) {
                      if (isAnim) removeAnimParamDriver(partId!, modifierId, driver.id);
                      else if (keyframeId) removeParamDriver(keyframeId, modifierId, driver.id);
                    }
                  }}>
                  ×
                </Button>
              </div>
            ))}
          </div>

          {activeDriver && (
            <div className="space-y-2 border-t border-[#2a2a4a] pt-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-gray-300 w-16">参数</Label>
                <Select value={activeDriver.paramName} onValueChange={(v) => handleUpdate({ paramName: v })}>
                  <SelectTrigger className="h-7 text-xs flex-1 bg-[#0a0a1e] border-[#2a2a4a]"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#0f0f24] border-[#2a2a4a]">
                    {numericParams.map((p) => <SelectItem key={p.name} value={p.name} className="text-xs">{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-gray-300 w-16">波形</Label>
                <Select value={activeDriver.waveform} onValueChange={(v) => handleUpdate({ waveform: v as ParamDriverWaveform })}>
                  <SelectTrigger className="h-7 text-xs flex-1 bg-[#0a0a1e] border-[#2a2a4a]"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#0f0f24] border-[#2a2a4a]">
                    {Object.entries(PARAM_DRIVER_WAVEFORM_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key} className="text-xs">{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="border border-[#2a2a4a] rounded bg-[#0a0a1e]">
                <svg width={280} height={60} className="w-full">
                  <line x1={0} y1={30} x2={280} y2={30} stroke="#2a2a4a" strokeWidth={0.5} />
                  {previewPath && <polyline points={previewPath} fill="none" stroke="#06b6d4" strokeWidth={1.5} opacity={0.8} />}
                </svg>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-gray-300 w-16">振幅</Label>
                <Input type="number" value={activeDriver.amplitude} onChange={(e) => handleUpdate({ amplitude: parseFloat(e.target.value) || 0 })} className="h-7 text-xs flex-1 bg-[#0a0a1e] border-[#2a2a4a]" step={0.5} />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-gray-300 w-16">基准值</Label>
                <Input type="number" value={activeDriver.baseValue} onChange={(e) => handleUpdate({ baseValue: parseFloat(e.target.value) || 0 })} className="h-7 text-xs flex-1 bg-[#0a0a1e] border-[#2a2a4a]" step={0.5} />
              </div>
              {(activeDriver.waveform === 'linear_ramp' || activeDriver.waveform === 'exponential_decay') && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-gray-300 w-16">终点值</Label>
                  <Input type="number" value={activeDriver.endValue} onChange={(e) => handleUpdate({ endValue: parseFloat(e.target.value) || 0 })} className="h-7 text-xs flex-1 bg-[#0a0a1e] border-[#2a2a4a]" step={0.5} />
                </div>
              )}
              {activeDriver.waveform !== 'linear_ramp' && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-gray-300 w-16">周期(帧)</Label>
                  <Input type="number" value={activeDriver.period} onChange={(e) => handleUpdate({ period: parseInt(e.target.value) || 1 })} className="h-7 text-xs flex-1 bg-[#0a0a1e] border-[#2a2a4a]" min={1} step={1} />
                </div>
              )}
              {activeDriver.waveform !== 'linear_ramp' && activeDriver.waveform !== 'exponential_decay' && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-gray-300 w-16">相位(°)</Label>
                  <Input type="number" value={activeDriver.phase} onChange={(e) => handleUpdate({ phase: parseFloat(e.target.value) || 0 })} className="h-7 text-xs flex-1 bg-[#0a0a1e] border-[#2a2a4a]" min={0} max={360} step={1} />
                </div>
              )}
              {(activeDriver.waveform === 'exponential_decay' || activeDriver.waveform === 'spring_oscillate') && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-gray-300 w-16">阻尼</Label>
                  <Slider value={[activeDriver.damping]} onValueChange={([v]) => handleUpdate({ damping: v })} min={0} max={1} step={0.01} className="flex-1" />
                  <span className="text-xs text-gray-400 w-8 text-right">{activeDriver.damping.toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-gray-300 w-16">起始帧</Label>
                <Input type="number" value={activeDriver.startFrame} onChange={(e) => handleUpdate({ startFrame: parseInt(e.target.value) || 0 })} className="h-7 text-xs flex-1 bg-[#0a0a1e] border-[#2a2a4a]" min={0} step={1} />
                <Label className="text-xs text-gray-300 ml-2">结束帧</Label>
                <Input type="number" value={activeDriver.endFrame} onChange={(e) => handleUpdate({ endFrame: parseInt(e.target.value) || -1 })} className="h-7 text-xs flex-1 bg-[#0a0a1e] border-[#2a2a4a]" min={-1} step={1} />
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={() => handleUpdate({ enabled: !activeDriver.enabled })}>
                  {activeDriver.enabled ? '禁用' : '启用'}
                </Button>
                {!activeDriver.isBaked ? (
                  <Button variant="outline" size="sm" className="h-7 text-xs flex-1 border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                    onClick={() => { if (keyframeId && modifierId) bakeParamDriver(keyframeId, modifierId, activeDriver.id); }}>
                    🔥 烘焙为关键帧
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="h-7 text-xs flex-1 border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                    onClick={() => { if (keyframeId && modifierId) unbakeParamDriver(keyframeId, modifierId, activeDriver.id); }}>
                    ↩ 取消烘焙
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
