'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
import type { ModifierType, ModifierParamValue } from '@/lib/types';
import { MODIFIER_DEFINITIONS } from '@/lib/types';

// ---- Modifier Param Edit Dialog ----
export default function ModifierParamEditDialog({
  open,
  onOpenChange,
  mode,
  partId,
  modifierId,
  modifierType,
  currentParams,
  keyframeId,
  frame,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'animation' | 'keyframe';
  partId?: string;
  modifierId?: string;
  modifierType?: ModifierType;
  currentParams?: Record<string, ModifierParamValue>;
  keyframeId?: string;
  frame?: number;
}) {
  const { updatePartAnimationModifier, updateModifier } = useProjectStore();
  const def = MODIFIER_DEFINITIONS.find((d) => d.type === modifierType);

  const [params, setParams] = useState<Record<string, ModifierParamValue>>(() => currentParams ? { ...currentParams } : {});

  if (!modifierType || !modifierId) return null;

  const handleSave = () => {
    if (mode === 'animation' && partId) {
      updatePartAnimationModifier(partId, modifierId, params);
    } else if (mode === 'keyframe' && keyframeId) {
      updateModifier(keyframeId, modifierId, params);
    }
    onOpenChange(false);
  };

  const paramDefs = def?.params ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1a1a2e] border-white/10 text-gray-200 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm text-gray-100 flex items-center gap-2">
            <span className="size-2 rounded-sm" style={{ backgroundColor: def ? (def.category === 'transform' ? '#3b82f6' : def.category === 'color' ? '#ec4899' : def.category === 'effect' ? '#f59e0b' : def.category === 'physics' ? '#10b981' : '#8b5cf6') : '#8b5cf6' }} />
            {def?.label ?? modifierType}
            <span className="text-xs text-gray-500 font-normal ml-1">- 编辑修改器参数</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-gray-400">
            {mode === 'animation' ? '动画修改器' : '关键帧修改器'} · 帧 {frame ?? 0}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5 py-2 max-h-72 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#3a3a5a #1a1a2e' }}>
          {paramDefs.map((paramDef) => {
            const value = params[paramDef.name] ?? paramDef.default;
            return (
              <div key={paramDef.name} className="flex items-center gap-2">
                <Label className="text-[11px] text-gray-400 w-20 shrink-0 truncate" title={paramDef.label}>
                  {paramDef.label}
                </Label>
                {paramDef.type === 'number' && (
                  <div className="flex-1 flex items-center gap-2">
                    {paramDef.min !== undefined && paramDef.max !== undefined && (
                      <Slider
                        value={[Number(value)]}
                        min={paramDef.min}
                        max={paramDef.max}
                        step={paramDef.step ?? 1}
                        onValueChange={([v]) => setParams((p) => ({ ...p, [paramDef.name]: v }))}
                        className="flex-1"
                      />
                    )}
                    <Input
                      type="number"
                      value={Number(value)}
                      min={paramDef.min}
                      max={paramDef.max}
                      step={paramDef.step ?? 1}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setParams((p) => ({ ...p, [paramDef.name]: isNaN(v) ? 0 : v }));
                      }}
                      className={`h-7 text-xs bg-white/5 border-white/10 text-gray-300 px-2 ${paramDef.min !== undefined && paramDef.max !== undefined ? 'w-16' : 'flex-1'}`}
                    />
                  </div>
                )}
                {paramDef.type === 'boolean' && (
                  <Switch
                    checked={Boolean(value)}
                    onCheckedChange={(v) => setParams((p) => ({ ...p, [paramDef.name]: v }))}
                  />
                )}
                {paramDef.type === 'color' && (
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      type="color"
                      value={String(value)}
                      onChange={(e) => setParams((p) => ({ ...p, [paramDef.name]: e.target.value }))}
                      className="w-7 h-7 rounded border border-white/10 cursor-pointer bg-transparent"
                    />
                    <Input
                      value={String(value)}
                      onChange={(e) => setParams((p) => ({ ...p, [paramDef.name]: e.target.value }))}
                      className="h-7 text-xs bg-white/5 border-white/10 text-gray-300 px-2 flex-1"
                    />
                  </div>
                )}
                {paramDef.type === 'select' && paramDef.options && (
                  <Select
                    value={String(value)}
                    onValueChange={(v) => {
                      const opt = paramDef.options?.find((o) => String(o.value) === v);
                      setParams((p) => ({ ...p, [paramDef.name]: opt?.value ?? v }));
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs bg-white/5 border-white/10 text-gray-300 flex-1" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#1a1a2e] border-white/10">
                      {paramDef.options.map((opt) => (
                        <SelectItem key={String(opt.value)} value={String(opt.value)} className="text-xs text-gray-300">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            );
          })}
          {paramDefs.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-2">无参数可编辑</p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" className="text-xs text-gray-400 hover:text-gray-200" onClick={() => onOpenChange(false)}>取消</Button>
          <Button size="sm" className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white" onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
