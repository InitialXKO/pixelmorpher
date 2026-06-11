'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Radio,
  Zap,
  Shuffle,
  Plus,
  Trash2,
  Play,
  Pause,
  Settings,
  CircleDot,
  ChevronDown,
  ChevronRight,
  FileUp,
} from 'lucide-react';

import { useProjectStore, useEditorStore } from '@/lib/store';
import type {
  ProceduralAnimation,
  ProceduralConfig,
  ProceduralNoise,
  ProceduralWave,
  ProceduralSpring,
  ProceduralJitter,
} from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { parseCSVWaveform } from '@/lib/csv-waveform';

// ============================================================
// ProceduralPanel - Panel for procedural animation management
// ============================================================

// ---- Constants ----

const PROCEDURAL_TYPE_INFO: Record<
  ProceduralConfig['type'],
  { label: string; icon: React.ElementType; color: string; defaultConfig: ProceduralConfig }
> = {
  noise: {
    label: '噪声',
    icon: Radio,
    color: 'text-violet-400',
    defaultConfig: {
      type: 'noise',
      amplitude: 5,
      frequency: 0.05,
      octaves: 2,
      seed: 42,
      targetProperty: 'translateX',
    } satisfies ProceduralNoise,
  },
  wave: {
    label: '波浪',
    icon: Activity,
    color: 'text-cyan-400',
    defaultConfig: {
      type: 'wave',
      amplitude: 5,
      frequency: 0.1,
      phase: 0,
      waveType: 'sine',
      targetProperty: 'translateY',
    } satisfies ProceduralWave,
  },
  spring: {
    label: '弹簧',
    icon: Zap,
    color: 'text-amber-400',
    defaultConfig: {
      type: 'spring',
      stiffness: 0.5,
      damping: 0.3,
      mass: 1,
      restLength: 0,
      targetProperty: 'translateY',
    } satisfies ProceduralSpring,
  },
  jitter: {
    label: '抖动',
    icon: Shuffle,
    color: 'text-rose-400',
    defaultConfig: {
      type: 'jitter',
      amount: 2,
      frequency: 0.5,
      smooth: true,
      targetProperty: 'translateX',
    } satisfies ProceduralJitter,
  },
};

const TARGET_PROPERTY_OPTIONS = [
  { value: 'translateX', label: 'X位移' },
  { value: 'translateY', label: 'Y位移' },
  { value: 'rotation', label: '旋转' },
  { value: 'scale', label: '缩放' },
] as const;

const WAVE_TYPE_OPTIONS = [
  { value: 'sine', label: '正弦波' },
  { value: 'triangle', label: '三角波' },
  { value: 'square', label: '方波' },
  { value: 'sawtooth', label: '锯齿波' },
] as const;

// ---- Mini Preview Canvas ----

function ProceduralMiniPreview({
  animation,
  currentFrame,
  width = 200,
  height = 60,
}: {
  animation: ProceduralAnimation;
  currentFrame: number;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#0a0a16';
    ctx.fillRect(0, 0, width, height);

    const { startFrame, endFrame, config } = animation;
    const frameRange = endFrame - startFrame;
    if (frameRange <= 0) {
      ctx.fillStyle = '#333';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Invalid frame range', width / 2, height / 2 + 3);
      return;
    }

    // Compute curve values
    const padding = 4;
    const drawW = width - padding * 2;
    const drawH = height - padding * 2;
    const numSamples = Math.min(frameRange, 200);

    const values: number[] = [];
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const frame = startFrame + t * frameRange;
      values.push(computeProceduralValue(config, frame));
    }

    // Find min/max for Y axis
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const v of values) {
      minVal = Math.min(minVal, v);
      maxVal = Math.max(maxVal, v);
    }
    const rangeY = maxVal - minVal || 1;

    // Draw center line
    const centerY = padding + drawH / 2;
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(padding, centerY);
    ctx.lineTo(width - padding, centerY);
    ctx.stroke();

    // Draw curve
    const typeColor = PROCEDURAL_TYPE_INFO[config.type]?.color;
    const lineColor = typeColor === 'text-violet-400' ? '#a78bfa'
      : typeColor === 'text-cyan-400' ? '#22d3ee'
      : typeColor === 'text-amber-400' ? '#fbbf24'
      : '#fb7185';

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = animation.enabled ? 0.9 : 0.3;
    ctx.beginPath();

    for (let i = 0; i <= numSamples; i++) {
      const x = padding + (i / numSamples) * drawW;
      const y = padding + drawH - ((values[i] - minVal) / rangeY) * drawH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Draw current frame indicator
    if (currentFrame >= startFrame && currentFrame <= endFrame) {
      const frameX = padding + ((currentFrame - startFrame) / frameRange) * drawW;
      ctx.strokeStyle = '#ffffff55';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(frameX, padding);
      ctx.lineTo(frameX, height - padding);
      ctx.stroke();

      // Draw dot at current value
      const currentT = (currentFrame - startFrame) / frameRange;
      const currentVal = computeProceduralValue(config, currentFrame);
      const dotY = padding + drawH - ((currentVal - minVal) / rangeY) * drawH;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(frameX, dotY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [animation, currentFrame, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="rounded border border-zinc-800 bg-[#0a0a16]"
      style={{ width, height }}
    />
  );
}

// ---- Procedural value computation (simplified for preview) ----

function computeProceduralValue(config: ProceduralConfig, frame: number): number {
  switch (config.type) {
    case 'noise': {
      // Simple multi-octave pseudo-noise
      let value = 0;
      let amp = config.amplitude;
      let freq = config.frequency;
      for (let o = 0; o < config.octaves; o++) {
        value += amp * pseudoNoise(frame * freq + config.seed + o * 100);
        amp *= 0.5;
        freq *= 2;
      }
      return value;
    }
    case 'wave': {
      const phaseRad = (config.phase * Math.PI) / 180;
      const t = frame * config.frequency * Math.PI * 2 + phaseRad;
      switch (config.waveType) {
        case 'sine':
          return config.amplitude * Math.sin(t);
        case 'triangle':
          return config.amplitude * (2 * Math.abs(2 * (t / (2 * Math.PI) - Math.floor(t / (2 * Math.PI) + 0.5))) - 1);
        case 'square':
          return config.amplitude * (Math.sin(t) >= 0 ? 1 : -1);
        case 'sawtooth':
          return config.amplitude * 2 * (t / (2 * Math.PI) - Math.floor(t / (2 * Math.PI) + 0.5));
        default:
          return 0;
      }
    }
    case 'spring': {
      // Damped spring oscillation simulation
      const { stiffness, damping, mass, restLength } = config;
      const omega = Math.sqrt(stiffness / mass);
      const gamma = damping / (2 * mass);
      const dampedOmega = Math.sqrt(Math.max(0, omega * omega - gamma * gamma));
      const t = frame * 0.1;
      const envelope = Math.exp(-gamma * t);
      return restLength + envelope * (restLength + 10) * Math.cos(dampedOmega * t);
    }
    case 'jitter': {
      // Pseudo-random jitter with optional smoothing
      if (config.smooth) {
        return config.amount * pseudoNoise(frame * config.frequency);
      }
      return config.amount * (pseudoNoise(frame * config.frequency * 10) > 0 ? 1 : -1);
    }
    default:
      return 0;
  }
}

/** Simple pseudo-noise function for preview purposes */
function pseudoNoise(x: number): number {
  const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

// ---- Empty State ----

function EmptyProceduralState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="size-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
        <Activity className="size-5 text-zinc-500" />
      </div>
      <p className="text-xs text-zinc-400 mb-1">No procedural animations</p>
      <p className="text-[11px] text-zinc-500 mb-4">
        Add noise, wave, spring, or jitter animations
      </p>
      <Button
        size="sm"
        variant="outline"
        className="text-xs h-7 border-zinc-700 text-zinc-300 hover:text-zinc-100"
        onClick={onAdd}
      >
        <Plus className="size-3 mr-1" />
        Add Animation
      </Button>
    </div>
  );
}

// ---- No Part Selected ----

function NoPartSelectedState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="size-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
        <CircleDot className="size-5 text-zinc-500" />
      </div>
      <p className="text-xs text-zinc-400 mb-1">No part selected</p>
      <p className="text-[11px] text-zinc-500">
        Select a part to manage its procedural animations
      </p>
    </div>
  );
}

// ---- Animation Card ----

function ProceduralAnimationCard({
  animation,
  currentFrame,
  onUpdate,
  onRemove,
  onToggle,
}: {
  animation: ProceduralAnimation;
  currentFrame: number;
  onUpdate: (id: string, updates: Partial<ProceduralAnimation>) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(animation.name);
  const [collapsed, setCollapsed] = useState(true);

  const typeInfo = PROCEDURAL_TYPE_INFO[animation.config.type];
  const TypeIcon = typeInfo.icon;

  const handleNameSave = useCallback(() => {
    if (editName.trim()) {
      onUpdate(animation.id, { name: editName.trim() });
    }
    setIsEditingName(false);
  }, [animation.id, editName, onUpdate]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleNameSave();
      if (e.key === 'Escape') {
        setEditName(animation.name);
        setIsEditingName(false);
      }
    },
    [handleNameSave, animation.name],
  );

  const handleConfigUpdate = useCallback(
    (configUpdates: Partial<ProceduralConfig>) => {
      const newConfig = { ...animation.config, ...configUpdates } as ProceduralConfig;
      onUpdate(animation.id, { config: newConfig });
    },
    [animation.id, animation.config, onUpdate],
  );

  return (
    <div
      className={`rounded-md border transition-colors ${
        animation.enabled
          ? 'border-zinc-700 bg-zinc-900/50'
          : 'border-zinc-800 bg-zinc-900/20 opacity-60'
      }`}
    >
      {/* Card Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {/* Collapse toggle */}
        <button
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
        </button>

        {/* Type icon */}
        <TypeIcon className={`size-3.5 ${typeInfo.color} shrink-0`} />

        {/* Editable name */}
        {isEditingName ? (
          <Input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleNameKeyDown}
            onBlur={handleNameSave}
            className="h-5 flex-1 text-[11px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5 py-0 min-w-0"
            autoFocus
          />
        ) : (
          <span
            className="text-[11px] text-zinc-200 flex-1 min-w-0 truncate cursor-pointer hover:text-white transition-colors"
            onDoubleClick={() => {
              setEditName(animation.name);
              setIsEditingName(true);
            }}
          >
            {animation.name}
          </span>
        )}

        {/* Type badge */}
        <Badge
          variant="secondary"
          className={`text-[9px] px-1.5 py-0 h-4 shrink-0 ${
            animation.config.type === 'noise'
              ? 'bg-violet-500/20 text-violet-400 border-violet-500/30'
              : animation.config.type === 'wave'
                ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                : animation.config.type === 'spring'
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                  : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
          }`}
        >
          {typeInfo.label}
        </Badge>

        {/* Enable toggle */}
        <Switch
          checked={animation.enabled}
          onCheckedChange={() => onToggle(animation.id)}
          className="scale-50 origin-center"
        />

        {/* Delete */}
        <Button
          variant="ghost"
          size="icon"
          className="size-5 p-0 text-zinc-600 hover:text-red-400 shrink-0"
          onClick={() => onRemove(animation.id)}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      {/* Mini preview (always visible) */}
      <div className="px-2 pb-1.5">
        <ProceduralMiniPreview
          animation={animation}
          currentFrame={currentFrame}
        />
      </div>

      {/* Expanded config */}
      {!collapsed && (
        <div className="px-2 pb-2 space-y-2">
          <Separator className="bg-zinc-800" />

          {/* Frame Range */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-zinc-500 font-medium">帧范围</span>
            <div className="flex items-center gap-1.5">
              <Label className="text-[10px] text-zinc-500 shrink-0">起始</Label>
              <Input
                type="number"
                value={animation.startFrame}
                onChange={(e) =>
                  onUpdate(animation.id, { startFrame: Math.max(0, Number(e.target.value)) })
                }
                className="h-5 flex-1 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5 py-0"
                min={0}
              />
              <Label className="text-[10px] text-zinc-500 shrink-0">结束</Label>
              <Input
                type="number"
                value={animation.endFrame}
                onChange={(e) =>
                  onUpdate(animation.id, { endFrame: Math.max(0, Number(e.target.value)) })
                }
                className="h-5 flex-1 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5 py-0"
                min={0}
              />
            </div>
          </div>

          {/* Target Property */}
          <div className="space-y-1">
            <Label className="text-[10px] text-zinc-500">目标属性</Label>
            <Select
              value={animation.config.targetProperty}
              onValueChange={(val) =>
                handleConfigUpdate({ targetProperty: val as ProceduralNoise['targetProperty'] })
              }
            >
              <SelectTrigger className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                {TARGET_PROPERTY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-[11px]">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator className="bg-zinc-800" />

          {/* Type-specific config */}
          {animation.config.type === 'noise' && (
            <NoiseConfig config={animation.config} onUpdate={handleConfigUpdate} />
          )}
          {animation.config.type === 'wave' && (
            <WaveConfig config={animation.config} onUpdate={handleConfigUpdate} />
          )}
          {animation.config.type === 'spring' && (
            <SpringConfig config={animation.config} onUpdate={handleConfigUpdate} />
          )}
          {animation.config.type === 'jitter' && (
            <JitterConfig config={animation.config} onUpdate={handleConfigUpdate} />
          )}
        </div>
      )}
    </div>
  );
}

// ---- Noise Config ----

function NoiseConfig({
  config,
  onUpdate,
}: {
  config: ProceduralNoise;
  onUpdate: (updates: Partial<ProceduralNoise>) => void;
}) {
  return (
    <div className="space-y-2">
      <ParamSlider
        label="振幅"
        value={config.amplitude}
        min={0.1}
        max={50}
        step={0.5}
        onChange={(v) => onUpdate({ amplitude: v })}
      />
      <ParamSlider
        label="频率"
        value={config.frequency}
        min={0.001}
        max={0.5}
        step={0.005}
        onChange={(v) => onUpdate({ frequency: v })}
        displayPrecision={3}
      />
      <ParamSlider
        label="八度数"
        value={config.octaves}
        min={1}
        max={8}
        step={1}
        onChange={(v) => onUpdate({ octaves: Math.round(v) })}
        displayPrecision={0}
      />
      <ParamSlider
        label="随机种子"
        value={config.seed}
        min={0}
        max={9999}
        step={1}
        onChange={(v) => onUpdate({ seed: Math.round(v) })}
        displayPrecision={0}
      />
    </div>
  );
}

// ---- Wave Config ----

function WaveConfig({
  config,
  onUpdate,
}: {
  config: ProceduralWave;
  onUpdate: (updates: Partial<ProceduralWave>) => void;
}) {
  return (
    <div className="space-y-2">
      <ParamSlider
        label="振幅"
        value={config.amplitude}
        min={0.1}
        max={50}
        step={0.5}
        onChange={(v) => onUpdate({ amplitude: v })}
      />
      <ParamSlider
        label="频率"
        value={config.frequency}
        min={0.01}
        max={2}
        step={0.01}
        onChange={(v) => onUpdate({ frequency: v })}
        displayPrecision={2}
      />
      <ParamSlider
        label="相位"
        value={config.phase}
        min={0}
        max={360}
        step={1}
        onChange={(v) => onUpdate({ phase: v })}
        displayPrecision={0}
      />
      <div className="space-y-1">
        <Label className="text-[10px] text-zinc-500">波形</Label>
        <Select
          value={config.waveType}
          onValueChange={(val) => onUpdate({ waveType: val as ProceduralWave['waveType'] })}
        >
          <SelectTrigger className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            {WAVE_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-[11px]">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ---- Spring Config ----

function SpringConfig({
  config,
  onUpdate,
}: {
  config: ProceduralSpring;
  onUpdate: (updates: Partial<ProceduralSpring>) => void;
}) {
  return (
    <div className="space-y-2">
      <ParamSlider
        label="刚度"
        value={config.stiffness}
        min={0.01}
        max={2}
        step={0.01}
        onChange={(v) => onUpdate({ stiffness: v })}
        displayPrecision={2}
      />
      <ParamSlider
        label="阻尼"
        value={config.damping}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onUpdate({ damping: v })}
        displayPrecision={2}
      />
      <ParamSlider
        label="质量"
        value={config.mass}
        min={0.1}
        max={10}
        step={0.1}
        onChange={(v) => onUpdate({ mass: v })}
        displayPrecision={1}
      />
      <ParamSlider
        label="静止长度"
        value={config.restLength}
        min={-50}
        max={50}
        step={1}
        onChange={(v) => onUpdate({ restLength: v })}
        displayPrecision={0}
      />
    </div>
  );
}

// ---- Jitter Config ----

function JitterConfig({
  config,
  onUpdate,
}: {
  config: ProceduralJitter;
  onUpdate: (updates: Partial<ProceduralJitter>) => void;
}) {
  return (
    <div className="space-y-2">
      <ParamSlider
        label="抖动量"
        value={config.amount}
        min={0.1}
        max={20}
        step={0.1}
        onChange={(v) => onUpdate({ amount: v })}
        displayPrecision={1}
      />
      <ParamSlider
        label="频率"
        value={config.frequency}
        min={0.01}
        max={5}
        step={0.01}
        onChange={(v) => onUpdate({ frequency: v })}
        displayPrecision={2}
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id={`jitter-smooth-${config.amount}-${config.frequency}`}
          checked={config.smooth}
          onCheckedChange={(checked) => onUpdate({ smooth: !!checked })}
          className="size-3.5"
        />
        <Label
          htmlFor={`jitter-smooth-${config.amount}-${config.frequency}`}
          className="text-[10px] text-zinc-400 cursor-pointer"
        >
          平滑
        </Label>
      </div>
    </div>
  );
}

// ---- Reusable Param Slider ----

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  displayPrecision = 1,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  displayPrecision?: number;
}) {
  const { beginDrag, endDrag } = useProjectStore();
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-zinc-500 w-12 shrink-0 truncate">{label}</span>
      <Slider
        className="flex-1"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onPointerDown={() => beginDrag('调整程序动画参数')}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={([v]) => { onChange(v); endDrag(); }}
      />
      <span className="text-[10px] text-zinc-400 w-10 text-right shrink-0 font-mono">
        {value.toFixed(displayPrecision)}
      </span>
    </div>
  );
}

// ---- Main ProceduralPanel Component ----

export default function ProceduralPanel() {
  const {
    proceduralAnimations,
    addProceduralAnimation,
    removeProceduralAnimation,
    updateProceduralAnimation,
    toggleProceduralAnimation,
    currentFrame,
    totalFrames,
  } = useProjectStore();

  const { selectedPartId } = useEditorStore();

  // Feature 5: CSV waveform import ref
  const csvInputRef = useRef<HTMLInputElement>(null);

  // ---- Derived ----
  const partAnimations = useMemo(
    () => proceduralAnimations.filter((pa) => pa.partId === selectedPartId),
    [proceduralAnimations, selectedPartId],
  );

  // ---- Handlers ----
  const handleAdd = useCallback(
    (type: ProceduralConfig['type']) => {
      if (!selectedPartId) return;
      const info = PROCEDURAL_TYPE_INFO[type];
      addProceduralAnimation(
        selectedPartId,
        `${info.label} ${partAnimations.length + 1}`,
        { ...info.defaultConfig },
        0,
        totalFrames - 1,
      );
    },
    [selectedPartId, partAnimations.length, totalFrames, addProceduralAnimation],
  );

  const handleRemove = useCallback(
    (id: string) => {
      removeProceduralAnimation(id);
    },
    [removeProceduralAnimation],
  );

  const handleUpdate = useCallback(
    (id: string, updates: Partial<ProceduralAnimation>) => {
      updateProceduralAnimation(id, updates);
    },
    [updateProceduralAnimation],
  );

  const handleToggle = useCallback(
    (id: string) => {
      toggleProceduralAnimation(id);
    },
    [toggleProceduralAnimation],
  );

  // ---- Render ----
  if (!selectedPartId) {
    return (
      <div className="flex flex-col h-full bg-zinc-950" style={{ width: 280 }}>
        <div className="px-3 py-2.5 border-b border-zinc-800 shrink-0">
          <h3 className="text-xs font-semibold text-zinc-200 tracking-wide">程序动画</h3>
        </div>
        <NoPartSelectedState />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950" style={{ width: 280 }}>
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <h3 className="text-xs font-semibold text-zinc-200 tracking-wide">程序动画</h3>
        <div className="flex items-center gap-1">
          <Badge
            variant="secondary"
            className="text-[9px] px-1.5 py-0 h-4 bg-zinc-700 text-zinc-400"
          >
            {partAnimations.length}
          </Badge>

          {/* Add dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 p-0 text-zinc-500 hover:text-emerald-400"
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[11px]">
                添加程序动画
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              className="bg-zinc-800 border-zinc-700 w-36"
              align="end"
            >
              <DropdownMenuItem
                className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 cursor-pointer"
                onClick={() => handleAdd('noise')}
              >
                <Radio className="size-3.5 text-violet-400 mr-2" />
                噪声 (Noise)
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 cursor-pointer"
                onClick={() => handleAdd('wave')}
              >
                <Activity className="size-3.5 text-cyan-400 mr-2" />
                波浪 (Wave)
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 cursor-pointer"
                onClick={() => handleAdd('spring')}
              >
                <Zap className="size-3.5 text-amber-400 mr-2" />
                弹簧 (Spring)
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 cursor-pointer"
                onClick={() => handleAdd('jitter')}
              >
                <Shuffle className="size-3.5 text-rose-400 mr-2" />
                抖动 (Jitter)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Animation list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {partAnimations.length === 0 ? (
            <EmptyProceduralState onAdd={() => handleAdd('noise')} />
          ) : (
            partAnimations.map((pa) => (
              <ProceduralAnimationCard
                key={pa.id}
                animation={pa}
                currentFrame={currentFrame}
                onUpdate={handleUpdate}
                onRemove={handleRemove}
                onToggle={handleToggle}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer summary */}
      {partAnimations.length > 0 && (
        <div className="border-t border-zinc-800 px-3 py-1.5 flex items-center justify-between shrink-0">
          <span className="text-[10px] text-zinc-500">
            {partAnimations.filter((pa) => pa.enabled).length} / {partAnimations.length} 启用
          </span>
          <div className="flex items-center gap-1">
            {partAnimations.some((pa) => pa.enabled) && (
              <Badge
                variant="secondary"
                className="text-[9px] px-1.5 py-0 h-4 bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
              >
                <Play className="size-2.5 mr-0.5" />
                Active
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Feature 5: CSV Waveform Import */}
      <div className="border-t border-zinc-800 px-3 py-1.5 shrink-0">
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file || !selectedPartId) return;
            const reader = new FileReader();
            reader.onload = (event) => {
              try {
                const text = event.target?.result as string;
                const values = parseCSVWaveform(text);
                if (values.length === 0) return;
                // Create an expression animation modifier with CSV waveform data
                const store = useProjectStore.getState();
                const part = store.parts.find(p => p.id === selectedPartId);
                if (!part) return;
                const newMod: any = {
                  id: crypto.randomUUID(),
                  type: 'expression' as const,
                  enabled: true,
                  collapsed: false,
                  params: {
                    expressionX: '0',
                    expressionY: '0',
                    expressionRotation: '0',
                    expressionScale: '1',
                    amplitude: 10,
                    period: values.length,
                    phase: 0,
                    convergeSpeed: 0.5,
                    csvWaveform: values,
                  },
                  startFrame: 0,
                  endFrame: -1,
                  fadeInFrames: 0,
                  fadeOutFrames: 0,
                  blendMode: 'add',
                  groupId: null,
                };
                store.updatePart(selectedPartId, {
                  animationModifiers: [...(part.animationModifiers || []), newMod],
                });
              } catch (err) {
                console.error('Failed to parse CSV waveform:', err);
              }
            };
            reader.readAsText(file);
            e.target.value = '';
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-6 text-[10px] text-violet-400/70 hover:text-violet-300 hover:bg-violet-400/5 border border-dashed border-violet-900/30"
          onClick={() => csvInputRef.current?.click()}
          disabled={!selectedPartId}
        >
          <FileUp className="size-3 mr-1" />
          导入CSV波形
        </Button>
      </div>
    </div>
  );
}
