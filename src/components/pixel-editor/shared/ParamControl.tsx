'use client';

import React from 'react';

import {
  ModifierParam,
  ModifierParamValue,
} from '@/lib/types';

import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface ParamControlProps {
  param: ModifierParam;
  value: ModifierParamValue;
  onChange: (val: ModifierParamValue) => void;
  disabled: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export default function ParamControl({
  param,
  value,
  onChange,
  disabled,
  onDragStart,
  onDragEnd,
}: ParamControlProps) {
  if (param.type === 'number') {
    const numVal = typeof value === 'number' ? value : Number(value) || 0;
    const min = param.min ?? 0;
    const max = param.max ?? 100;
    const step = param.step ?? 1;

    return (
      <div className="flex items-center gap-2 py-1">
        <span className="text-[11px] text-muted-foreground w-14 shrink-0 truncate">
          {param.label}
        </span>
        <Slider
          className="flex-1 min-w-0"
          value={[numVal]}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onPointerDown={() => onDragStart?.()}
          onValueChange={([v]) => onChange(v)}
          onValueCommit={([v]) => { onChange(v); onDragEnd?.(); }}
        />
        <Input
          type="number"
          className="h-6 w-14 text-[11px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1.5 py-0 shrink-0"
          value={numVal}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
        />
      </div>
    );
  }

  if (param.type === 'color') {
    const strVal = typeof value === 'string' ? value : String(value);
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="text-[11px] text-muted-foreground w-14 shrink-0 truncate">
          {param.label}
        </span>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <label className="relative cursor-pointer">
            <input
              type="color"
              value={strVal}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <div
              className="w-6 h-6 rounded border border-zinc-600 shrink-0"
              style={{ backgroundColor: strVal }}
            />
          </label>
          <Input
            className="h-6 flex-1 min-w-0 text-[11px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1.5 py-0 font-mono"
            value={strVal}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>
    );
  }

  if (param.type === 'select') {
    const strVal = typeof value === 'string' ? value : String(value);
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="text-[11px] text-muted-foreground w-14 shrink-0 truncate">
          {param.label}
        </span>
        <Select
          value={strVal}
          disabled={disabled}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger className="h-6 flex-1 min-w-0 text-[11px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1.5 py-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-700">
            {param.options?.map((opt) => (
              <SelectItem
                key={String(opt.value)}
                value={String(opt.value)}
                className="text-[11px] text-zinc-200"
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (param.type === 'boolean') {
    const boolVal = typeof value === 'boolean' ? value : value === 'true';
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="text-[11px] text-muted-foreground w-14 shrink-0 truncate">
          {param.label}
        </span>
        <Switch
          checked={boolVal}
          disabled={disabled}
          onCheckedChange={(v) => onChange(v)}
          className="scale-75 origin-left"
        />
      </div>
    );
  }

  return null;
}
