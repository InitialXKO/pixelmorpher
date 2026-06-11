'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  GripVertical,
  Eye,
  EyeOff,
  ChevronDown,
  Settings,
  Flame,
  Layers,
  Paintbrush,
  Move,
  RotateCw,
  Maximize2,
  Palette,
  Sun,
  Sparkles,
  Wind,
  Ghost,
  MoreVertical,
  Minimize2,
  ArrowUpDown,
  Zap,
  Grid3x3,
  BoxSelect,
  Atom,
  Waves,
  StretchHorizontal,
  Italic,
  Timer,
  CircleDot,
  ArrowUpFromLine,
  Heart,
  Rotate3d,
  Cloud,
  Disc,
  Cylinder,
  Globe,
  Code2,
  RotateCcw,
  AlertTriangle,
  Diamond,
  PenTool,
  Eraser,
  Bookmark,
  BookOpen,
  Pencil,
  Activity,
  X,
  ChevronRight,
  ChevronsRight,
  Play,
  Pause,
  Link,
  Unlink,
  TrendingUp,
  Variable,
  Footprints,
} from 'lucide-react';

import { useProjectStore, useEditorStore } from '@/lib/store';
import { applyPixelModifiers, getGaitPhaseAtFrame, getAnimationFrameAndWeight, getWheelSegmentAtFrame } from '@/lib/engine';
import {
  ModifierInstance,
  ModifierType,
  MODIFIER_DEFINITIONS,
  getModifierDef,
  ModifierParam,
  ModifierDefinition,
  ModifierParamKeyframe,
  EffectType,
  ANIMATION_MODIFIER_TYPES,
  PartAnimationModifier,
  AnimationModifierType,
  AnimationBlendMode,
  PixelGrid,
  ModifierGroup,
  BrushCommand,
  ParamDriver,
  ParamDriverWaveform,
  ParamDriverNumericParam,
  ParamSource,
  ParamDriverKeyframe,
  SecondaryParamDriver,
  AnimationVariable,
  PARAM_DRIVER_WAVEFORM_LABELS,
  PARAM_DRIVER_PARAM_LABELS,
  StrokeParamDriver,
  STROKE_DRIVER_TARGET_LABELS,
  STROKE_DRIVER_WAVEFORM_LABELS,
  ModifierParamValue,
} from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { loadPresets, addPreset, removePreset, type ModifierPreset } from '@/lib/presets';

import ParamControl from './shared/ParamControl';

// ---- Icon Mapping ----

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Move,
  RotateCw,
  Maximize2,
  StretchHorizontal,
  Italic,
  Palette,
  BoxSelect,
  Grid3x3,
  Atom,
  Wind,
  Sun,
  Sparkles,
  Ghost,
  Waves,
  // V2.1 Animation modifier icons
  Timer,
  CircleDot,
  ArrowUpFromLine,
  Heart,
  Rotate3d,
  Cloud,
  Disc,
  // V2.2 Projection rotation icons
  Cylinder,
  Globe,
  // M5 Expression animation icon
  Code2,
  // PixelEdit modifier icon
  PenTool,
  // V11: Gait animation icon
  Footprints,
};

function ModifierIcon({
  iconName,
  className,
}: {
  iconName: string;
  className?: string;
}) {
  const Comp = ICON_MAP[iconName];
  if (!Comp) return <Settings className={className} />;
  return <Comp className={className} />;
}

// ---- Category Colors ----

const CATEGORY_COLORS: Record<string, string> = {
  transform: 'text-emerald-400',
  color: 'text-pink-400',
  physics: 'text-orange-400',
  effect: 'text-violet-400',
  animation: 'text-cyan-400',
};

const CATEGORY_BG: Record<string, string> = {
  transform: 'bg-emerald-400/10',
  color: 'bg-pink-400/10',
  physics: 'bg-orange-400/10',
  effect: 'bg-violet-400/10',
  animation: 'bg-cyan-400/10',
};

// ---- M7+: BrushCommand block with expandable stroke drivers ----

function BrushCommandBlock({
  cmd,
  idx,
  keyframeId,
  modifierId,
  disabled,
  currentFrame,
  typeIcon,
  typeLabel,
  strokeDriverParams,
  onRemove,
  addStrokeDriverParamDriver,
  removeStrokeDriverParamDriver,
  updateStrokeDriverParamDriver,
  toggleStrokeDriverParamDriver,
  addStrokeDriverParamKeyframe,
  removeStrokeDriverParamKeyframe,
  bakeStrokeDriverParamDriver,
  unbakeStrokeDriverParamDriver,
  maxEndFrame,
}: {
  cmd: BrushCommand;
  idx: number;
  keyframeId: string;
  modifierId: string;
  disabled: boolean;
  currentFrame: number;
  typeIcon: (type: BrushCommand['type']) => React.ReactNode;
  typeLabel: (type: BrushCommand['type']) => string;
  strokeDriverParams: ModifierParam[];
  onRemove: () => void;
  addStrokeDriverParamDriver: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, paramName: string, startFrame?: number, endFrame?: number) => void;
  removeStrokeDriverParamDriver: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, driverId: string) => void;
  updateStrokeDriverParamDriver: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, driverId: string, updates: Partial<ParamDriver>) => void;
  toggleStrokeDriverParamDriver: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, driverId: string) => void;
  addStrokeDriverParamKeyframe: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, frame: number, params: Record<string, ModifierParamValue>) => void;
  removeStrokeDriverParamKeyframe: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, paramKfId: string) => void;
  bakeStrokeDriverParamDriver?: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, driverId: string) => void;
  unbakeStrokeDriverParamDriver?: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, driverId: string) => void;
  /** M7+: Maximum endFrame for keyframe-level ParamDrivers */
  maxEndFrame?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const strokeDrivers = cmd.strokeDrivers ?? [];
  const hasStrokeDrivers = strokeDrivers.length > 0;

  return (
    <div className="rounded-md border border-zinc-800/60 bg-zinc-800/30 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-1.5 px-1.5 py-1 cursor-pointer hover:bg-zinc-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {typeIcon(cmd.type)}
        <span className="text-[10px] text-zinc-300 flex-1 min-w-0 truncate">
          {typeLabel(cmd.type)} #{idx + 1}
        </span>
        {cmd.type !== 'erase' && (
          <div
            className="size-3 rounded-sm shrink-0 border border-zinc-600"
            style={{ backgroundColor: cmd.color }}
            title={cmd.color}
          />
        )}
        <span className="text-[9px] text-zinc-500 shrink-0">
          {cmd.size}px · {cmd.points.length}点
        </span>
        {hasStrokeDrivers && (
          <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3.5 bg-cyan-500/20 text-cyan-400 border-cyan-500/30 shrink-0">
            {strokeDrivers.length}驱动
          </Badge>
        )}
        <button
          type="button"
          className="size-4 flex items-center justify-center text-zinc-600 hover:text-red-400 shrink-0"
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="删除命令"
        >
          <Trash2 className="size-2.5" />
        </button>
        <ChevronRight className={`size-3 text-zinc-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </div>

      {/* Expanded: stroke drivers + time-domain drivers */}
      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          <Separator className="bg-zinc-800/50 mb-1" />

          {strokeDrivers.length === 0 ? (
            <p className="text-[9px] text-zinc-500 italic py-1">
              无笔画驱动器（在工具栏中添加）
            </p>
          ) : (
            strokeDrivers.map((sd) => (
              <div key={sd.id} className="rounded-md border border-cyan-800/20 bg-cyan-950/10">
                {/* Stroke driver header */}
                <div className="flex items-center gap-1 px-1.5 py-1">
                  <Activity className="size-2.5 text-cyan-400 shrink-0" />
                  <span className="text-[9px] text-cyan-300 truncate flex-1 min-w-0">
                    {STROKE_DRIVER_TARGET_LABELS[sd.targetParam]}
                  </span>
                  <span className="text-[8px] text-zinc-500 shrink-0">
                    {STROKE_DRIVER_WAVEFORM_LABELS[sd.waveform]}
                  </span>
                  <span className="text-[8px] text-zinc-600 shrink-0">
                    c={sd.center.toFixed(2)} a={sd.amplitude.toFixed(2)}
                  </span>
                </div>

                {/* Time-domain ParamDriver section */}
                <ParamDriverSection
                  drivers={sd.paramDrivers ?? []}
                  paramsDef={strokeDriverParams}
                  disabled={disabled}
                  currentFrame={currentFrame}
                  onAddDriver={(paramName) => addStrokeDriverParamDriver(keyframeId, modifierId, cmd.id, sd.id, paramName)}
                  onUpdateDriver={(driverId, updates) => updateStrokeDriverParamDriver(keyframeId, modifierId, cmd.id, sd.id, driverId, updates)}
                  onRemoveDriver={(driverId) => removeStrokeDriverParamDriver(keyframeId, modifierId, cmd.id, sd.id, driverId)}
                  onToggleDriver={(driverId) => toggleStrokeDriverParamDriver(keyframeId, modifierId, cmd.id, sd.id, driverId)}
                  onBakeDriver={(driverId) => bakeStrokeDriverParamDriver?.(keyframeId, modifierId, cmd.id, sd.id, driverId)}
                  onUnbakeDriver={(driverId) => unbakeStrokeDriverParamDriver?.(keyframeId, modifierId, cmd.id, sd.id, driverId)}
                  maxEndFrame={maxEndFrame}
                />

                {/* Param keyframe add button for this stroke driver */}
                <div className="px-1.5 pb-1">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-4 text-[8px] text-amber-400/60 hover:text-amber-300 hover:bg-amber-500/10 gap-0.5 px-1"
                      disabled={disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        addStrokeDriverParamKeyframe(keyframeId, modifierId, cmd.id, sd.id, currentFrame, {
                          center: sd.center,
                          amplitude: sd.amplitude,
                          width: sd.width,
                          frequency: sd.frequency,
                          phase: sd.phase,
                        });
                      }}
                    >
                      <Diamond className="size-2" />
                      添加关键帧
                    </Button>
                    <span className="text-[8px] text-zinc-600">帧{currentFrame}</span>
                  </div>

                  {/* Param keyframe markers */}
                  {sd.paramKeyframes && sd.paramKeyframes.length > 0 && (
                    <div className="flex items-center gap-0.5 flex-wrap mt-0.5">
                      {sd.paramKeyframes
                        .slice()
                        .sort((a, b) => a.frame - b.frame)
                        .map((pk) => (
                          <button
                            key={pk.id}
                            type="button"
                            className={`group/pk flex items-center gap-0.5 px-0.5 py-0 rounded text-[8px] transition-colors ${
                              pk.frame === currentFrame
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-zinc-800/40 text-zinc-500 hover:bg-zinc-700/40'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              useProjectStore.getState().setCurrentFrame(pk.frame);
                            }}
                          >
                            <Diamond className="size-1.5 text-amber-400" />
                            F{pk.frame}
                            <span
                              className="opacity-0 group-hover/pk:opacity-100 transition-opacity text-red-400"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeStrokeDriverParamKeyframe(keyframeId, modifierId, cmd.id, sd.id, pk.id);
                              }}
                            >
                              ×
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---- PixelEdit: Brush Command List ----

function PixelEditCommandList({
  keyframeId,
  modifierId,
  brushCommands,
  disabled,
  currentFrame,
  maxEndFrame,
}: {
  keyframeId: string;
  modifierId: string;
  brushCommands: BrushCommand[];
  disabled: boolean;
  currentFrame: number;
  /** M7+: Maximum endFrame for keyframe-level ParamDrivers */
  maxEndFrame?: number;
}) {
  // P1: Use selector to avoid re-renders on unrelated store changes
  const removePixelEditCommand = useProjectStore(s => s.removePixelEditCommand);
  // M7+: Stroke driver time-domain ParamDriver actions
  const addStrokeDriverParamDriver = useProjectStore(s => s.addStrokeDriverParamDriver);
  const removeStrokeDriverParamDriver = useProjectStore(s => s.removeStrokeDriverParamDriver);
  const updateStrokeDriverParamDriver = useProjectStore(s => s.updateStrokeDriverParamDriver);
  const toggleStrokeDriverParamDriver = useProjectStore(s => s.toggleStrokeDriverParamDriver);
  const addStrokeDriverParamKeyframe = useProjectStore(s => s.addStrokeDriverParamKeyframe);
  const removeStrokeDriverParamKeyframe = useProjectStore(s => s.removeStrokeDriverParamKeyframe);
  const bakeStrokeDriverParamDriver = useProjectStore(s => s.bakeStrokeDriverParamDriver);
  const unbakeStrokeDriverParamDriver = useProjectStore(s => s.unbakeStrokeDriverParamDriver);

  const typeIcon = useCallback((type: BrushCommand['type']) => {
    switch (type) {
      case 'draw': return <Paintbrush className="size-3 text-pink-400" />;
      case 'erase': return <Eraser className="size-3 text-zinc-400" />;
      case 'fill': return <Palette className="size-3 text-emerald-400" />;
    }
  }, []);

  const typeLabel = useCallback((type: BrushCommand['type']) => {
    switch (type) {
      case 'draw': return '绘制';
      case 'erase': return '擦除';
      case 'fill': return '填充';
    }
  }, []);

  // StrokeParamDriver's time-driveable numeric params
  const strokeDriverParams: ModifierParam[] = [
    { name: 'center', label: '位置(center)', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    { name: 'amplitude', label: '幅度(amplitude)', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    { name: 'width', label: '宽度(width)', type: 'number', default: 0.3, min: 0, max: 1, step: 0.01 },
    { name: 'frequency', label: '频率(frequency)', type: 'number', default: 1, min: 1, max: 20, step: 1 },
    { name: 'phase', label: '相位(phase)', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
  ];

  return (
    <div className="space-y-1 mt-1">
      <Separator className="bg-zinc-800 mb-1.5" />
      <div className="text-[10px] text-pink-400/60 font-medium tracking-wider uppercase mb-1">
        画笔命令
      </div>
      {brushCommands.length === 0 ? (
        <p className="text-[10px] text-zinc-500 italic py-1">
          在修正模式下绘制以记录命令
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto space-y-1 pr-0.5" style={{ scrollbarWidth: 'thin', scrollbarColor: '#3f3f46 transparent' }}>
          {brushCommands.map((cmd, idx) => (
            <BrushCommandBlock
              key={cmd.id}
              cmd={cmd}
              idx={idx}
              keyframeId={keyframeId}
              modifierId={modifierId}
              disabled={disabled}
              currentFrame={currentFrame}
              typeIcon={typeIcon}
              typeLabel={typeLabel}
              strokeDriverParams={strokeDriverParams}
              onRemove={() => removePixelEditCommand(keyframeId, modifierId, cmd.id)}
              addStrokeDriverParamDriver={addStrokeDriverParamDriver}
              removeStrokeDriverParamDriver={removeStrokeDriverParamDriver}
              updateStrokeDriverParamDriver={updateStrokeDriverParamDriver}
              toggleStrokeDriverParamDriver={toggleStrokeDriverParamDriver}
              addStrokeDriverParamKeyframe={addStrokeDriverParamKeyframe}
              removeStrokeDriverParamKeyframe={removeStrokeDriverParamKeyframe}
              bakeStrokeDriverParamDriver={bakeStrokeDriverParamDriver}
              unbakeStrokeDriverParamDriver={unbakeStrokeDriverParamDriver}
              maxEndFrame={maxEndFrame}
            />
          ))}
        </div>
      )}
      <p className="text-[9px] text-zinc-500 mt-1">
        双击编辑 · 命令可重新排序
      </p>
    </div>
  );
}

// ---- ModifierBlock ----

function ModifierBlock({
  modifier,
  keyframeId,
  currentFrame,
  index,
  totalCount,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isSelected,
  onRemove,
  hasParent,
}: {
  modifier: ModifierInstance;
  keyframeId: string;
  currentFrame: number;  // P1: Passed from parent (frozen during playback)
  index: number;
  totalCount: number;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  isSelected: boolean;
  onRemove: (keyframeId: string, modifierId: string) => void;
  hasParent?: boolean;
}) {
  const def = getModifierDef(modifier.type);
  // P1: Use individual selectors to avoid re-renders on unrelated store changes (e.g., currentFrame during playback)
  const updateModifier = useProjectStore(s => s.updateModifier);
  const toggleModifier = useProjectStore(s => s.toggleModifier);
  const toggleModifierCollapsed = useProjectStore(s => s.toggleModifierCollapsed);
  const reorderModifier = useProjectStore(s => s.reorderModifier);
  const updateModifierRange = useProjectStore(s => s.updateModifierRange);
  const addModifierParamKeyframe = useProjectStore(s => s.addModifierParamKeyframe);
  const removeModifierParamKeyframe = useProjectStore(s => s.removeModifierParamKeyframe);
  // M7: ParamDriver store actions
  const addParamDriver = useProjectStore(s => s.addParamDriver);
  const removeParamDriver = useProjectStore(s => s.removeParamDriver);
  const updateParamDriver = useProjectStore(s => s.updateParamDriver);
  const toggleParamDriver = useProjectStore(s => s.toggleParamDriver);
  const bakeParamDriver = useProjectStore(s => s.bakeParamDriver);
  const unbakeParamDriver = useProjectStore(s => s.unbakeParamDriver);
  // M8: ParamSource and AnimationVariable store actions
  const animationVariables = useProjectStore(s => s.animationVariables);
  const setParamDriverSource = useProjectStore(s => s.setParamDriverSource);
  const clearParamDriverSource = useProjectStore(s => s.clearParamDriverSource);
  const beginDrag = useProjectStore(s => s.beginDrag);
  const endDrag = useProjectStore(s => s.endDrag);
  const { selectModifier } = useEditorStore();

  // M7+: Compute maxEndFrame for ParamDriver clamp warnings
  const allKeyframes = useProjectStore(s => s.keyframes);
  const currentKf = allKeyframes.find(k => k.id === keyframeId);
  const samePartKeyframes = allKeyframes.filter(k => k.partId === currentKf?.partId).sort((a, b) => a.frame - b.frame);
  const nextKfFrame = samePartKeyframes.find(k => k.frame > (currentKf?.frame ?? -1))?.frame;
  const maxEndFrame = nextKfFrame !== undefined ? nextKfFrame - 1 : undefined;

  const handleParamChange = useCallback(
    (paramName: string, value: ModifierParamValue) => {
      updateModifier(keyframeId, modifier.id, { [paramName]: value });
    },
    [keyframeId, modifier.id, updateModifier]
  );

  const handleSliderDragStart = useCallback(() => {
    beginDrag('调整修改器参数');
  }, [beginDrag]);

  const handleSliderDragEnd = useCallback(() => {
    endDrag();
  }, [endDrag]);

  // M6: Add param keyframe at current frame with current param values
  const handleAddParamKeyframe = useCallback(() => {
    // Capture the current param values and create a param keyframe at the current frame
    addModifierParamKeyframe(keyframeId, modifier.id, currentFrame, { ...modifier.params });
  }, [keyframeId, modifier.id, currentFrame, modifier.params, addModifierParamKeyframe]);

  const handleMoveUp = useCallback(() => {
    if (index > 0) {
      reorderModifier(keyframeId, modifier.id, index - 1);
    }
  }, [index, keyframeId, modifier.id, reorderModifier]);

  const handleMoveDown = useCallback(() => {
    if (index < totalCount - 1) {
      reorderModifier(keyframeId, modifier.id, index + 1);
    }
  }, [index, totalCount, keyframeId, modifier.id, reorderModifier]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable
          onDragStart={(e) => onDragStart(e, modifier.id)}
          onDragOver={(e) => onDragOver(e, modifier.id)}
          onDrop={(e) => onDrop(e, modifier.id)}
          onDragEnd={onDragEnd}
          onClick={() => selectModifier(modifier.id)}
          className={`
            group relative rounded-lg border transition-all duration-150 cursor-pointer
            ${
              isSelected
                ? 'border-primary/50 bg-primary/5'
                : 'border-zinc-800 hover:border-zinc-600'
            }
            ${!modifier.enabled ? 'opacity-50' : ''}
            ${modifier.collapsed ? 'opacity-60' : ''}
            bg-zinc-900/80
          `}
        >
          {/* Header row */}
          <div className="flex items-center gap-1.5 px-2 py-2">
            {/* Drag handle */}
            <div className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 transition-colors shrink-0">
              <GripVertical className="size-3.5" />
            </div>

            {/* Category icon + name */}
            <div
              className={`flex items-center justify-center size-5 rounded ${CATEGORY_BG[def.category]} shrink-0`}
            >
              <ModifierIcon
                iconName={def.icon}
                className={`size-3 ${CATEGORY_COLORS[def.category]}`}
              />
            </div>
            <span className="text-xs font-medium text-zinc-200 truncate flex-1 min-w-0">
              {def.label}
            </span>

            {/* Collapsed badge */}
            {modifier.collapsed && (
              <Badge
                variant="secondary"
                className="text-[9px] px-1 py-0 h-4 bg-amber-500/20 text-amber-400 border-amber-500/30 shrink-0"
              >
                已坍缩
              </Badge>
            )}

            {/* Enabled toggle */}
            <Checkbox
              checked={modifier.enabled}
              onCheckedChange={() => toggleModifier(keyframeId, modifier.id)}
              className="size-3.5 shrink-0"
            />

            {/* 3-dot menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 p-0 text-zinc-500 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <MoreVertical className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="bg-zinc-900 border-zinc-700 w-40"
              >
                <DropdownMenuItem
                  className="text-xs text-zinc-200"
                  onClick={() => toggleModifierCollapsed(keyframeId, modifier.id)}
                >
                  <Minimize2 className="size-3 mr-1.5" />
                  {modifier.collapsed ? '展开' : '坍缩'}
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-zinc-700" />
                <DropdownMenuItem
                  className="text-xs text-zinc-200"
                  onClick={handleMoveUp}
                  disabled={index === 0}
                >
                  <ArrowUpDown className="size-3 mr-1.5" />
                  上移
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs text-zinc-200"
                  onClick={handleMoveDown}
                  disabled={index === totalCount - 1}
                >
                  <ArrowUpDown className="size-3 mr-1.5 rotate-180" />
                  下移
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-zinc-700" />
                <DropdownMenuItem
                  className="text-xs text-amber-300"
                  onClick={() => {
                    const name = prompt('预设名称:', def.label);
                    if (!name) return;
                    const category = prompt('分类 (可选):', '') || '默认';
                    addPreset({
                      id: crypto.randomUUID(),
                      name,
                      type: modifier.type,
                      params: { ...modifier.params },
                      category,
                      createdAt: Date.now(),
                    });
                  }}
                >
                  <Bookmark className="size-3 mr-1.5" />
                  保存为预设
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-zinc-700" />
                <DropdownMenuItem
                  variant="destructive"
                  className="text-xs"
                  onClick={() => onRemove(keyframeId, modifier.id)}
                >
                  <Trash2 className="size-3 mr-1.5" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Parameter controls (hidden when collapsed) */}
          {!modifier.collapsed && (
            <div className="px-2 pb-2 space-y-0.5">
              <Separator className="bg-zinc-800 mb-1.5" />
              {def.params
                .filter((p) => {
                  // V3.4: Hide wheel params that are irrelevant for the current trajectoryMode
                  if (modifier.type === 'wheel') {
                    const mode = String(modifier.params.trajectoryMode ?? 'circular');
                    const spinModes = ['independent_spin', 'gear'];
                    if ((p.name === 'radiusX' || p.name === 'radiusY') && spinModes.includes(mode)) return false;
                    if (p.name === 'cornerRadius' && mode !== 'rounded_rect') return false;
                    if ((p.name === 'gearTeeth' || p.name === 'gearMeshOffset') && mode !== 'gear') return false;
                    if ((p.name === 'angularVelocity' || p.name === 'angularAcceleration' || p.name === 'maxSpeed') && spinModes.includes(mode)) return false;
                  }
                  // V11.1: Hide gait params that are irrelevant for the current gaitStyle
                  if (modifier.type === 'gait') {
                    const style = String(modifier.params.gaitStyle ?? 'cartoon');
                    // aerialRatio/teardropAsymmetry: only for run style
                    if ((p.name === 'aerialRatio' || p.name === 'teardropAsymmetry') && style !== 'run') return false;
                  }
                  return true;
                })
                .map((p) => {
                  // V11.2: Dynamic label override for paddle gait style
                  let paramLabel = p.label;
                  if (modifier.type === 'gait') {
                    const style = String(modifier.params.gaitStyle ?? 'cartoon');
                    if (style === 'paddle') {
                      const paddleLabels: Record<string, string> = {
                        'strideLength': '划水幅度(px)',
                        'liftHeight': '下潜深度(px)',
                        'stanceRatio': '恢复比',
                        'liftoffAngle': '入水角度(°)',
                        'peakAngle': '最深处角度(°)',
                        'contactAngle': '出水角度(°)',
                        'landBend': '入水弯折',
                        'landBendDuration': '入水弯折帧数',
                        'liftoffBend': '出水弯折',
                        'liftoffBendDuration': '出水弯折帧数',
                      };
                      if (paddleLabels[p.name]) paramLabel = paddleLabels[p.name];
                    }
                  }
                  return (
                <ParamControl
                  key={p.name}
                  param={{ ...p, label: paramLabel }}
                  value={modifier.params[p.name]}
                  onChange={(v) => handleParamChange(p.name, v)}
                  disabled={!modifier.enabled}
                  onDragStart={handleSliderDragStart}
                  onDragEnd={handleSliderDragEnd}
                />
                  );
                })}

              {/* ---- PixelEdit: Brush command list ---- */}
              {modifier.type === 'pixel_edit' && (
                <PixelEditCommandList
                  keyframeId={keyframeId}
                  modifierId={modifier.id}
                  brushCommands={(modifier.params.brushCommands as BrushCommand[]) || []}
                  disabled={!modifier.enabled}
                  currentFrame={currentFrame}
                  maxEndFrame={maxEndFrame}
                />
              )}

              {/* M6: Add param keyframe button */}
              <Separator className="bg-zinc-800 my-1" />

              {/* V3.7: Coordinate mode toggle for transform modifiers when part has parent */}
              {hasParent && ['translate', 'rotate', 'uniform_scale', 'non_uniform_stretch'].includes(modifier.type) && (
                <div className="flex items-center gap-2 py-1">
                  <span className="text-[11px] text-muted-foreground w-14 shrink-0 truncate">坐标模式</span>
                  <Select
                    value={modifier.coordinateMode || 'world'}
                    disabled={!modifier.enabled}
                    onValueChange={(v) => updateModifier(keyframeId, modifier.id, { coordinateMode: v } as any)}
                  >
                    <SelectTrigger className="h-6 flex-1 min-w-0 text-[11px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1.5 py-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-700">
                      <SelectItem value="world" className="text-[11px] text-zinc-200">世界坐标</SelectItem>
                      <SelectItem value="parent_local" className="text-[11px] text-zinc-200">父级局部坐标</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* M7: ParamDriver section */}
              <ParamDriverSection
                drivers={modifier.paramDrivers ?? []}
                paramsDef={def.params}
                disabled={!modifier.enabled}
                currentFrame={currentFrame}
                onAddDriver={(paramName) => addParamDriver(keyframeId, modifier.id, paramName)}
                onUpdateDriver={(driverId, updates) => updateParamDriver(keyframeId, modifier.id, driverId, updates)}
                onRemoveDriver={(driverId) => removeParamDriver(keyframeId, modifier.id, driverId)}
                onToggleDriver={(driverId) => toggleParamDriver(keyframeId, modifier.id, driverId)}
                onBakeDriver={(driverId) => bakeParamDriver(keyframeId, modifier.id, driverId)}
                onUnbakeDriver={(driverId) => unbakeParamDriver(keyframeId, modifier.id, driverId)}
                maxEndFrame={maxEndFrame}
                variables={animationVariables}
                onSetSource={(driverId, param, source) => setParamDriverSource(keyframeId, modifier.id, driverId, param, source)}
                onClearSource={(driverId, param) => clearParamDriverSource(keyframeId, modifier.id, driverId, param)}
              />

              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[10px] text-amber-400/70 hover:text-amber-300 hover:bg-amber-500/10 gap-1 px-1.5"
                  disabled={!modifier.enabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddParamKeyframe();
                  }}
                >
                  <Diamond className="size-3" />
                  添加参数关键帧
                </Button>
                <span className="text-[9px] text-zinc-600">帧 {currentFrame}</span>
              </div>

              {/* M6: Param keyframe diamond markers */}
              {modifier.paramKeyframes && modifier.paramKeyframes.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap mt-1">
                  <span className="text-[9px] text-zinc-500 shrink-0">参数关键帧:</span>
                  {modifier.paramKeyframes
                    .slice()
                    .sort((a, b) => a.frame - b.frame)
                    .map((pk) => (
                      <Tooltip key={pk.id}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className={`group/pk relative flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] transition-colors ${
                              pk.frame === currentFrame
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700/60'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              // Navigate to this frame
                              useProjectStore.getState().setCurrentFrame(pk.frame);
                            }}
                          >
                            <Diamond className="size-2.5 text-amber-400" />
                            F{pk.frame}
                            {/* Delete on hover */}
                            <span
                              className="ml-0.5 opacity-0 group-hover/pk:opacity-100 transition-opacity text-red-400 hover:text-red-300 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeModifierParamKeyframe(keyframeId, modifier.id, pk.id);
                              }}
                            >
                              ×
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-[10px] max-w-48">
                          <div className="space-y-0.5">
                            {Object.entries(pk.params).map(([k, v]) => (
                              <div key={k} className="flex justify-between gap-2">
                                <span className="text-zinc-400">{k}:</span>
                                <span className="text-zinc-200 font-mono">
                                  {typeof v === 'number' ? v.toFixed(2) : String(v)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="bg-zinc-900 border-zinc-700 w-44">
        <ContextMenuItem
          className="text-xs text-zinc-200"
          onClick={() => toggleModifierCollapsed(keyframeId, modifier.id)}
        >
          <Minimize2 className="size-3 mr-1.5" />
          {modifier.collapsed ? '展开' : '坍缩'}
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-zinc-700" />
        <ContextMenuItem
          className="text-xs text-zinc-200"
          onClick={handleMoveUp}
          disabled={index === 0}
        >
          <ArrowUpDown className="size-3 mr-1.5" />
          上移
        </ContextMenuItem>
        <ContextMenuItem
          className="text-xs text-zinc-200"
          onClick={handleMoveDown}
          disabled={index === totalCount - 1}
        >
          <ArrowUpDown className="size-3 mr-1.5 rotate-180" />
          下移
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-zinc-700" />
        <ContextMenuItem
          variant="destructive"
          className="text-xs"
          onClick={() => onRemove(keyframeId, modifier.id)}
        >
          <Trash2 className="size-3 mr-1.5" />
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ---- M8: ParamSource Indicator & Selector ----

/** Visual indicator for a parameter's source type.
 *  Shows a small colored badge next to the parameter value. */
function ParamSourceIndicator({
  source,
  onOpenSelector,
}: {
  source: ParamSource | undefined;
  onOpenSelector: () => void;
}) {
  if (!source || source.type === 'constant') {
    return (
      <button
        type="button"
        className="size-4 flex items-center justify-center text-zinc-600 hover:text-cyan-400 shrink-0 rounded hover:bg-cyan-500/10"
        onClick={onOpenSelector}
        title="设置参数来源"
      >
        <MoreVertical className="size-2.5" />
      </button>
    );
  }

  const config: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    keyframes: { color: 'text-emerald-400', icon: <TrendingUp className="size-2.5" />, label: '关键帧曲线' },
    secondary_driver: { color: 'text-violet-400', icon: <Waves className="size-2.5" />, label: '二级驱动' },
    variable: { color: 'text-amber-400', icon: <Variable className="size-2.5" />, label: '变量' },
  };

  const c = config[source.type];
  if (!c) return null;

  return (
    <button
      type="button"
      className={`size-4 flex items-center justify-center ${c.color} hover:opacity-80 shrink-0 rounded hover:bg-white/5`}
      onClick={onOpenSelector}
      title={`来源: ${c.label}`}
    >
      {c.icon}
    </button>
  );
}

/** Dropdown selector for choosing a parameter's source type. */
function ParamSourceSelector({
  param,
  currentSource,
  variables,
  onSelectSource,
  onClearSource,
  disabled,
}: {
  param: ParamDriverNumericParam;
  currentSource: ParamSource | undefined;
  variables: AnimationVariable[];
  onSelectSource: (source: ParamSource) => void;
  onClearSource: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <div>
          <ParamSourceIndicator source={currentSource} onOpenSelector={() => setOpen(!open)} />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-zinc-900 border-zinc-700 min-w-40" align="end">
        <DropdownMenuLabel className="text-[9px] text-zinc-500">
          {PARAM_DRIVER_PARAM_LABELS[param]} 来源
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-zinc-800" />
        <DropdownMenuItem
          className="text-[10px] text-zinc-200"
          onClick={() => { onClearSource(); setOpen(false); }}
        >
          <Unlink className="size-3 mr-1.5 text-zinc-500" />
          常量值
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-[10px] text-zinc-200"
          onClick={() => {
            onSelectSource({
              type: 'keyframes',
              keyframes: [],
            });
            setOpen(false);
          }}
        >
          <TrendingUp className="size-3 mr-1.5 text-emerald-400" />
          关键帧曲线
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-[10px] text-zinc-200"
          onClick={() => {
            onSelectSource({
              type: 'secondary_driver',
              driver: {
                id: crypto.randomUUID(),
                waveform: 'sine',
                amplitude: 0.3,
                baseValue: 1,
                endValue: 1,
                period: 16,
                phase: 0,
                damping: 0,
                startFrame: 0,
                endFrame: -1,
                modMode: 'multiply',
              },
            });
            setOpen(false);
          }}
        >
          <Waves className="size-3 mr-1.5 text-violet-400" />
          二级驱动 (AM/FM)
        </DropdownMenuItem>
        {variables.length > 0 && (
          <>
            <DropdownMenuSeparator className="bg-zinc-800" />
            <DropdownMenuLabel className="text-[9px] text-zinc-500">
              外部变量
            </DropdownMenuLabel>
            {variables.map(v => (
              <DropdownMenuItem
                key={v.id}
                className="text-[10px] text-zinc-200"
                onClick={() => {
                  onSelectSource({ type: 'variable', variableId: v.id });
                  setOpen(false);
                }}
              >
                <Variable className="size-3 mr-1.5 text-amber-400" />
                {v.name}
                <span className="text-[8px] text-zinc-600 ml-1">
                  ({v.scope === 'global' ? '全局' : '部件'})
                  {v.mode === 'accumulator' ? ' Σ' : ''}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---- M7: ParamDriver Block (reusable for both keyframe-level and animation modifiers) ----

function ParamDriverBlock({
  driver,
  disabled,
  onUpdate,
  onRemove,
  onToggle,
  onBake,
  onUnbake,
  maxEndFrame,
  variables,
  onSetSource,
  onClearSource,
}: {
  driver: ParamDriver;
  disabled: boolean;
  onUpdate: (updates: Partial<ParamDriver>) => void;
  onRemove: () => void;
  onToggle: () => void;
  onBake: () => void;
  onUnbake: () => void;
  /** M7+: Maximum endFrame for this driver's parent keyframe span.
   *  When provided, shows a warning if driver.endFrame exceeds this value. */
  maxEndFrame?: number;
  /** M8: Available animation variables for source selection */
  variables?: AnimationVariable[];
  /** M8: Set a parameter's source */
  onSetSource?: (param: ParamDriverNumericParam, source: ParamSource) => void;
  /** M8: Clear a parameter's source (revert to constant) */
  onClearSource?: (param: ParamDriverNumericParam) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const frameRate = useProjectStore(s => s.frameRate);

  const waveformOptions: { value: ParamDriverWaveform; label: string }[] = [
    { value: 'sine', label: PARAM_DRIVER_WAVEFORM_LABELS.sine },
    { value: 'triangle', label: PARAM_DRIVER_WAVEFORM_LABELS.triangle },
    { value: 'square', label: PARAM_DRIVER_WAVEFORM_LABELS.square },
    { value: 'sawtooth', label: PARAM_DRIVER_WAVEFORM_LABELS.sawtooth },
    { value: 'linear_ramp', label: PARAM_DRIVER_WAVEFORM_LABELS.linear_ramp },
    { value: 'exponential_decay', label: PARAM_DRIVER_WAVEFORM_LABELS.exponential_decay },
    { value: 'spring_oscillate', label: PARAM_DRIVER_WAVEFORM_LABELS.spring_oscillate },
    { value: 'perlin_noise', label: PARAM_DRIVER_WAVEFORM_LABELS.perlin_noise },
  ];

  const isRampType = driver.waveform === 'linear_ramp' || driver.waveform === 'exponential_decay';
  const isOscillatingType = !isRampType;
  const activeVars = variables ?? [];

  return (
    <div
      className={`rounded-md border transition-all ${
        driver.isBaked
          ? 'border-amber-700/40 bg-amber-950/20'
          : !driver.enabled
          ? 'border-zinc-800/50 bg-zinc-900/30 opacity-50'
          : 'border-cyan-800/30 bg-cyan-950/10'
      }`}
    >
      {/* Header row */}
      <div
        className="flex items-center gap-1 px-1.5 py-1 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <Activity className={`size-3 shrink-0 ${driver.isBaked ? 'text-amber-400' : 'text-cyan-400'}`} />
        <span className="text-[10px] text-zinc-300 truncate flex-1 min-w-0">
          {driver.paramName}
        </span>
        <span className="text-[9px] text-zinc-500 shrink-0">
          {PARAM_DRIVER_WAVEFORM_LABELS[driver.waveform]}
        </span>
        {driver.isBaked && (
          <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3.5 bg-amber-500/20 text-amber-400 border-amber-500/30 shrink-0">
            已烘焙
          </Badge>
        )}
        <Checkbox
          checked={driver.enabled}
          onCheckedChange={() => { onToggle(); }}
          className="size-3 shrink-0"
          disabled={disabled || driver.isBaked}
        />
        <button
          type="button"
          className="size-4 flex items-center justify-center text-zinc-600 hover:text-red-400 shrink-0"
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <X className="size-2.5" />
        </button>
        <ChevronRight className={`size-3 text-zinc-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </div>

      {/* Expanded config */}
      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          <Separator className="bg-cyan-900/20 mb-1" />

          {/* ── Basic Section ── */}

          {/* Waveform selector */}
          <div className="flex items-center gap-2 py-0.5">
            <span className="text-[10px] text-zinc-500 w-10 shrink-0">波形</span>
            <Select
              value={driver.waveform}
              disabled={disabled || driver.isBaked}
              onValueChange={(v) => onUpdate({ waveform: v as ParamDriverWaveform })}
            >
              <SelectTrigger className="h-5 flex-1 min-w-0 text-[10px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1.5 py-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                {waveformOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-[10px] text-zinc-200">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Amplitude (for oscillating types) */}
          {isOscillatingType && (
            <div className="flex items-center gap-2 py-0.5">
              <span className="text-[10px] text-zinc-500 w-10 shrink-0">振幅</span>
              <Slider
                className="flex-1 min-w-0"
                value={[driver.amplitude]}
                min={0}
                max={100}
                step={0.1}
                disabled={disabled || driver.isBaked}
                onValueChange={([v]) => onUpdate({ amplitude: v })}
              />
              <Input
                type="number"
                className="h-5 w-14 text-[10px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1 py-0 shrink-0"
                value={driver.amplitude}
                min={0}
                max={100}
                step={0.1}
                disabled={disabled || driver.isBaked}
                onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onUpdate({ amplitude: v }); }}
              />
              {onSetSource && onClearSource && (
                <ParamSourceSelector
                  param="amplitude"
                  currentSource={driver.paramSources?.amplitude}
                  variables={activeVars}
                  onSelectSource={(s) => onSetSource('amplitude', s)}
                  onClearSource={() => onClearSource('amplitude')}
                  disabled={disabled || driver.isBaked}
                />
              )}
            </div>
          )}

          {/* Frequency / Period (for oscillating types) — labeled as "频率" for UX */}
          {isOscillatingType && (
            <div className="flex items-center gap-2 py-0.5">
              <span className="text-[10px] text-zinc-500 w-10 shrink-0">频率</span>
              <Slider
                className="flex-1 min-w-0"
                value={[driver.period]}
                min={1}
                max={120}
                step={1}
                disabled={disabled || driver.isBaked}
                onValueChange={([v]) => onUpdate({ period: v })}
              />
              <Input
                type="number"
                className="h-5 w-12 text-[10px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1 py-0 shrink-0"
                value={driver.period}
                min={1}
                max={120}
                step={1}
                disabled={disabled || driver.isBaked}
                onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) onUpdate({ period: v }); }}
              />
              <span className="text-[8px] text-zinc-600 w-8 shrink-0 text-right">
                {driver.period > 0 ? (frameRate / driver.period).toFixed(1) : '—'}Hz
              </span>
              {onSetSource && onClearSource && (
                <ParamSourceSelector
                  param="period"
                  currentSource={driver.paramSources?.period}
                  variables={activeVars}
                  onSelectSource={(s) => onSetSource('period', s)}
                  onClearSource={() => onClearSource('period')}
                  disabled={disabled || driver.isBaked}
                />
              )}
            </div>
          )}

          {/* Base value (center / start) */}
          <div className="flex items-center gap-2 py-0.5">
            <span className="text-[10px] text-zinc-500 w-10 shrink-0">{isRampType ? '起始值' : '中心值'}</span>
            <Slider
              className="flex-1 min-w-0"
              value={[driver.baseValue]}
              min={-200}
              max={200}
              step={0.1}
              disabled={disabled || driver.isBaked}
              onValueChange={([v]) => onUpdate({ baseValue: v })}
            />
            <Input
              type="number"
              className="h-5 w-14 text-[10px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1 py-0 shrink-0"
              value={driver.baseValue}
              min={-200}
              max={200}
              step={0.1}
              disabled={disabled || driver.isBaked}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onUpdate({ baseValue: v }); }}
            />
            {onSetSource && onClearSource && (
              <ParamSourceSelector
                param="baseValue"
                currentSource={driver.paramSources?.baseValue}
                variables={activeVars}
                onSelectSource={(s) => onSetSource('baseValue', s)}
                onClearSource={() => onClearSource('baseValue')}
                disabled={disabled || driver.isBaked}
              />
            )}
          </div>

          {/* ── Advanced Section (collapsed by default) ── */}
          <button
            type="button"
            className="flex items-center gap-1 w-full py-0.5 text-[9px] text-zinc-500 hover:text-zinc-400"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <ChevronRight className={`size-2.5 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
            高级参数
          </button>

          {showAdvanced && (
            <div className="space-y-1 pl-1 border-l border-zinc-800/60">
              {/* Phase offset (constant initial condition for phase continuity) */}
              {isOscillatingType && (
                <div className="flex items-center gap-2 py-0.5">
                  <span className="text-[10px] text-zinc-500 w-10 shrink-0">相位</span>
                  <Slider
                    className="flex-1 min-w-0"
                    value={[driver.phase]}
                    min={0}
                    max={360}
                    step={1}
                    disabled={disabled || driver.isBaked}
                    onValueChange={([v]) => onUpdate({ phase: v })}
                  />
                  <Input
                    type="number"
                    className="h-5 w-12 text-[10px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1 py-0 shrink-0"
                    value={driver.phase}
                    min={0}
                    max={360}
                    step={1}
                    disabled={disabled || driver.isBaked}
                    onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) onUpdate({ phase: v }); }}
                  />
                  <span className="text-[8px] text-zinc-600 w-6 shrink-0">deg</span>
                  {onSetSource && onClearSource && (
                    <ParamSourceSelector
                      param="phase"
                      currentSource={driver.paramSources?.phase}
                      variables={activeVars}
                      onSelectSource={(s) => onSetSource('phase', s)}
                      onClearSource={() => onClearSource('phase')}
                      disabled={disabled || driver.isBaked}
                    />
                  )}
                </div>
              )}

              {/* Damping (for decay/spring types) */}
              {(driver.waveform === 'exponential_decay' || driver.waveform === 'spring_oscillate') && (
                <div className="flex items-center gap-2 py-0.5">
                  <span className="text-[10px] text-zinc-500 w-10 shrink-0">阻尼</span>
                  <Slider
                    className="flex-1 min-w-0"
                    value={[driver.damping]}
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={disabled || driver.isBaked}
                    onValueChange={([v]) => onUpdate({ damping: v })}
                  />
                  <Input
                    type="number"
                    className="h-5 w-12 text-[10px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1 py-0 shrink-0"
                    value={driver.damping}
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={disabled || driver.isBaked}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onUpdate({ damping: v }); }}
                  />
                  {onSetSource && onClearSource && (
                    <ParamSourceSelector
                      param="damping"
                      currentSource={driver.paramSources?.damping}
                      variables={activeVars}
                      onSelectSource={(s) => onSetSource('damping', s)}
                      onClearSource={() => onClearSource('damping')}
                      disabled={disabled || driver.isBaked}
                    />
                  )}
                </div>
              )}

              {/* End value (for ramp types) */}
              {isRampType && (
                <div className="flex items-center gap-2 py-0.5">
                  <span className="text-[10px] text-zinc-500 w-10 shrink-0">终止值</span>
                  <Slider
                    className="flex-1 min-w-0"
                    value={[driver.endValue]}
                    min={-200}
                    max={200}
                    step={0.1}
                    disabled={disabled || driver.isBaked}
                    onValueChange={([v]) => onUpdate({ endValue: v })}
                  />
                  <Input
                    type="number"
                    className="h-5 w-14 text-[10px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1 py-0 shrink-0"
                    value={driver.endValue}
                    min={-200}
                    max={200}
                    step={0.1}
                    disabled={disabled || driver.isBaked}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onUpdate({ endValue: v }); }}
                  />
                  {onSetSource && onClearSource && (
                    <ParamSourceSelector
                      param="endValue"
                      currentSource={driver.paramSources?.endValue}
                      variables={activeVars}
                      onSelectSource={(s) => onSetSource('endValue', s)}
                      onClearSource={() => onClearSource('endValue')}
                      disabled={disabled || driver.isBaked}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Active frame range */}
          <div className="flex items-center gap-2 py-0.5">
            <span className="text-[10px] text-zinc-500 w-10 shrink-0">起止帧</span>
            <Input
              type="number"
              className="h-5 w-12 text-[10px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1 py-0 shrink-0"
              value={driver.startFrame}
              min={0}
              step={1}
              disabled={disabled || driver.isBaked}
              onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) onUpdate({ startFrame: v }); }}
            />
            <span className="text-[9px] text-zinc-600 shrink-0">→</span>
            <Input
              type="number"
              className="h-5 w-12 text-[10px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1 py-0 shrink-0"
              value={driver.endFrame}
              min={-1}
              step={1}
              disabled={disabled || driver.isBaked}
              onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) onUpdate({ endFrame: v }); }}
            />
            <span className="text-[8px] text-zinc-600 shrink-0">(-1=∞)</span>
            {maxEndFrame !== undefined && maxEndFrame >= 0 && (driver.endFrame < 0 || driver.endFrame > maxEndFrame) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertTriangle className="size-3 text-amber-400/70 shrink-0" />
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-zinc-900 border-zinc-700 text-[10px] text-zinc-200 max-w-48">
                  {driver.endFrame < 0
                    ? `此驱动器将在帧${maxEndFrame}被钳制，因为下一关键帧在帧${maxEndFrame + 1}`
                    : `止帧${driver.endFrame}超出关键帧范围，实际将被钳制到帧${maxEndFrame}`}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Bake / Unbake buttons */}
          <div className="flex items-center gap-1 pt-1">
            {driver.isBaked ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[9px] text-amber-400/70 hover:text-amber-300 hover:bg-amber-500/10 gap-0.5 px-1.5"
                disabled={disabled}
                onClick={() => onUnbake()}
              >
                <RotateCcw className="size-2.5" />
                解焙
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[9px] text-amber-400/70 hover:text-amber-300 hover:bg-amber-500/10 gap-0.5 px-1.5"
                disabled={disabled}
                onClick={() => onBake()}
              >
                <Flame className="size-2.5" />
                烘焙为关键帧
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- M7: ParamDriver Section (reusable for both modifier types) ----

function ParamDriverSection({
  drivers,
  paramsDef,
  disabled,
  currentFrame,
  onAddDriver,
  onUpdateDriver,
  onRemoveDriver,
  onToggleDriver,
  onBakeDriver,
  onUnbakeDriver,
  maxEndFrame,
  variables,
  onSetSource,
  onClearSource,
}: {
  drivers: ParamDriver[];
  paramsDef: ModifierParam[];
  disabled: boolean;
  currentFrame: number;
  onAddDriver: (paramName: string) => void;
  onUpdateDriver: (driverId: string, updates: Partial<ParamDriver>) => void;
  onRemoveDriver: (driverId: string) => void;
  onToggleDriver: (driverId: string) => void;
  onBakeDriver: (driverId: string) => void;
  onUnbakeDriver: (driverId: string) => void;
  /** M7+: Maximum endFrame for keyframe-level ParamDrivers. Pass to show clamp warnings. */
  maxEndFrame?: number;
  /** M8: Available animation variables */
  variables?: AnimationVariable[];
  /** M8: Set a parameter's source */
  onSetSource?: (driverId: string, param: ParamDriverNumericParam, source: ParamSource) => void;
  /** M8: Clear a parameter's source */
  onClearSource?: (driverId: string, param: ParamDriverNumericParam) => void;
}) {
  // Only show numeric params that can be driven
  const drivableParams = paramsDef.filter(p => p.type === 'number');
  const drivenParamNames = new Set(drivers.map(d => d.paramName));
  const undrivenParams = drivableParams.filter(p => !drivenParamNames.has(p.name));

  return (
    <div className="space-y-1">
      <Separator className="bg-cyan-900/30 my-1.5" />
      <div className="text-[10px] text-cyan-400/60 font-medium tracking-wider uppercase mb-1">
        参数驱动器
      </div>

      {/* Existing drivers */}
      {drivers.length > 0 && (
        <div className="space-y-1">
          {drivers.map((driver) => (
            <ParamDriverBlock
              key={driver.id}
              driver={driver}
              disabled={disabled}
              onUpdate={(updates) => onUpdateDriver(driver.id, updates)}
              onRemove={() => onRemoveDriver(driver.id)}
              onToggle={() => onToggleDriver(driver.id)}
              onBake={() => onBakeDriver(driver.id)}
              onUnbake={() => onUnbakeDriver(driver.id)}
              maxEndFrame={maxEndFrame}
              variables={variables}
              onSetSource={onSetSource ? (param, source) => onSetSource(driver.id, param, source) : undefined}
              onClearSource={onClearSource ? (param) => onClearSource(driver.id, param) : undefined}
            />
          ))}
        </div>
      )}

      {/* Add driver dropdown */}
      {drivableParams.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[10px] text-cyan-400/60 hover:text-cyan-300 hover:bg-cyan-400/5 gap-0.5 px-1.5 w-full justify-start"
              disabled={disabled}
            >
              <Plus className="size-2.5" />
              添加参数驱动器
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            className="bg-zinc-900 border-zinc-700 w-44 max-h-48 overflow-y-auto"
          >
            <DropdownMenuLabel className="text-[9px] text-cyan-400/60 uppercase tracking-wider">
              选择驱动参数
            </DropdownMenuLabel>
            {/* Show undriven params first, then all params (allows adding multiple drivers to same param) */}
            {drivableParams.map((p) => (
              <DropdownMenuItem
                key={p.name}
                className="text-[10px] text-zinc-200"
                onClick={() => onAddDriver(p.name)}
              >
                <Activity className="size-2.5 mr-1.5 text-cyan-400" />
                {p.label}
                {drivenParamNames.has(p.name) && (
                  <Badge variant="secondary" className="text-[8px] px-0.5 py-0 h-3 ml-auto bg-amber-500/20 text-amber-400">
                    已驱动
                  </Badge>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ---- AnimModifierBlock (Part-level animation modifier) ----

// ---- V3.2: Modifier Group Header ----

function ModifierGroupHeader({
  group,
  partId,
  modifierCount,
}: {
  group: ModifierGroup;
  partId: string;
  modifierCount: number;
}) {
  // P1: Use individual selectors to avoid re-renders on unrelated store changes
  const toggleModifierGroup = useProjectStore(s => s.toggleModifierGroup);
  const toggleModifierGroupCollapsed = useProjectStore(s => s.toggleModifierGroupCollapsed);
  const removeModifierGroup = useProjectStore(s => s.removeModifierGroup);
  const updateModifierGroup = useProjectStore(s => s.updateModifierGroup);

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border transition-all cursor-pointer"
      style={{
        borderColor: group.color + '40',
        backgroundColor: group.color + '10',
      }}
      onClick={() => toggleModifierGroupCollapsed(partId, group.id)}
    >
      {/* Color dot */}
      <div
        className="size-2.5 rounded-full shrink-0"
        style={{ backgroundColor: group.color }}
      />

      {/* Group name (editable) */}
      <input
        className="text-[11px] font-medium bg-transparent border-none outline-none truncate flex-1 min-w-0"
        style={{ color: group.color }}
        value={group.name}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => updateModifierGroup(partId, group.id, { name: e.target.value })}
      />

      {/* Modifier count badge */}
      <Badge
        variant="secondary"
        className="text-[9px] px-1 py-0 h-4 shrink-0"
        style={{
          backgroundColor: group.color + '20',
          color: group.color,
          borderColor: group.color + '40',
        }}
      >
        {modifierCount}
      </Badge>

      {/* Collapse indicator */}
      <ChevronDown
        className={`size-3 shrink-0 transition-transform ${group.collapsed ? '-rotate-90' : ''}`}
        style={{ color: group.color }}
      />

      {/* Enable toggle */}
      <Checkbox
        checked={group.enabled}
        onCheckedChange={() => { toggleModifierGroup(partId, group.id); }}
        className="size-3.5 shrink-0"
        onClick={(e) => e.stopPropagation()}
      />

      {/* 3-dot menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: group.color + '80' }}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-700 w-36">
          <DropdownMenuItem
            className="text-xs text-zinc-200"
            onClick={() => toggleModifierGroupCollapsed(partId, group.id)}
          >
            <Minimize2 className="size-3 mr-1.5" />
            {group.collapsed ? '展开组' : '折叠组'}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-zinc-700" />
          <DropdownMenuItem
            variant="destructive"
            className="text-xs"
            onClick={() => removeModifierGroup(partId, group.id)}
          >
            <Trash2 className="size-3 mr-1.5" />
            删除组
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AnimModifierBlock({
  modifier,
  partId,
  groups,
  currentFrame,
}: {
  modifier: PartAnimationModifier;
  partId: string;
  groups: ModifierGroup[];
  currentFrame: number;
}) {
  const def = getModifierDef(modifier.type);
  const group = modifier.groupId ? groups.find(g => g.id === modifier.groupId) : null;
  // P1: Use individual selectors to avoid re-renders on unrelated store changes
  const updatePartAnimationModifier = useProjectStore(s => s.updatePartAnimationModifier);
  const togglePartAnimationModifier = useProjectStore(s => s.togglePartAnimationModifier);
  const togglePartAnimationModifierCollapsed = useProjectStore(s => s.togglePartAnimationModifierCollapsed);
  const removePartAnimationModifier = useProjectStore(s => s.removePartAnimationModifier);
  const updatePartAnimationModifierRange = useProjectStore(s => s.updatePartAnimationModifierRange);
  const moveModifierToGroup = useProjectStore(s => s.moveModifierToGroup);
  const addModifierGroup = useProjectStore(s => s.addModifierGroup);
  const resetWheelAngularVelocity = useProjectStore(s => s.resetWheelAngularVelocity);
  const beginDrag = useProjectStore(s => s.beginDrag);
  const endDrag = useProjectStore(s => s.endDrag);
  // M7: ParamDriver store actions
  const addAnimParamDriver = useProjectStore(s => s.addAnimParamDriver);
  const removeAnimParamDriver = useProjectStore(s => s.removeAnimParamDriver);
  const updateAnimParamDriver = useProjectStore(s => s.updateAnimParamDriver);
  const toggleAnimParamDriver = useProjectStore(s => s.toggleAnimParamDriver);
  const bakeAnimParamDriver = useProjectStore(s => s.bakeAnimParamDriver);
  const unbakeAnimParamDriver = useProjectStore(s => s.unbakeAnimParamDriver);
  // M7: Param keyframe store actions
  const addAnimModifierParamKeyframe = useProjectStore(s => s.addAnimModifierParamKeyframe);
  const removeAnimModifierParamKeyframe = useProjectStore(s => s.removeAnimModifierParamKeyframe);
  const { selectModifier } = useEditorStore();

  const handleParamChange = useCallback(
    (paramName: string, value: ModifierParamValue) => {
      updatePartAnimationModifier(partId, modifier.id, { [paramName]: value });
    },
    [partId, modifier.id, updatePartAnimationModifier]
  );

  const handleSliderDragStart = useCallback(() => {
    beginDrag('调整动画修改器参数');
  }, [beginDrag]);

  const handleSliderDragEnd = useCallback(() => {
    endDrag();
  }, [endDrag]);

  // V11: Advanced params — folded by default, toggled open by user
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Define which params are "advanced" per modifier type.
  // Phase is advanced for most anim modifiers, but basic for gait/wheel (coordination-critical).
  const advancedParamNames = useMemo(() => {
    const map: Partial<Record<string, string[]>> = {
      pendulum: ['phase'],
      bounce: ['phase'],
      breath: ['phase'],
      wobble: ['phase'],
      float: ['phase'],
      shake: ['phase'],
      elastic: ['phase'],
    };
    return map[modifier.type] || [];
  }, [modifier.type]);

  // Split params into basic and advanced groups
  const { basicParams, advancedParams } = useMemo(() => {
    const basic: ModifierParam[] = [];
    const advanced: ModifierParam[] = [];
    for (const p of def.params) {
      if (advancedParamNames.includes(p.name)) {
        advanced.push(p);
      } else {
        basic.push(p);
      }
    }
    return { basicParams: basic, advancedParams: advanced };
  }, [def.params, advancedParamNames]);

  return (
    <div
      onClick={() => selectModifier(modifier.id)}
      className="
        group relative rounded-lg border transition-all duration-150 cursor-pointer
        border-cyan-900/50 bg-cyan-950/20 hover:border-cyan-700/50
      "
      style={{
        borderLeftColor: group ? group.color : undefined,
        borderLeftWidth: group ? '3px' : undefined,
        opacity: !modifier.enabled ? 0.5 : modifier.collapsed ? 0.6 : 1,
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-1.5 px-2 py-2">
        <div className="flex items-center justify-center size-5 rounded bg-cyan-400/10 shrink-0">
          <ModifierIcon iconName={def.icon} className="size-3 text-cyan-400" />
        </div>
        <span className="text-xs font-medium text-zinc-200 truncate flex-1 min-w-0">
          {def.label}
        </span>
        {/* Group indicator dot */}
        {group && (
          <div
            className="size-2 rounded-full shrink-0"
            style={{ backgroundColor: group.color }}
            title={group.name}
          />
        )}
        {modifier.collapsed && (
          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-amber-500/20 text-amber-400 border-amber-500/30 shrink-0">
            已坍缩
          </Badge>
        )}
        <Checkbox
          checked={modifier.enabled}
          onCheckedChange={() => togglePartAnimationModifier(partId, modifier.id)}
          className="size-3.5 shrink-0"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-5 p-0 text-zinc-500 hover:text-zinc-300 shrink-0">
              <MoreVertical className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-700 w-40">
            <DropdownMenuItem className="text-xs text-zinc-200" onClick={() => togglePartAnimationModifierCollapsed(partId, modifier.id)}>
              <Minimize2 className="size-3 mr-1.5" />
              {modifier.collapsed ? '展开' : '坍缩'}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-zinc-700" />
            {/* V3.2: Move to group submenu */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="text-xs text-zinc-200">
                <Layers className="size-3 mr-1.5" />
                移动到组
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="bg-zinc-900 border-zinc-700 w-40">
                <DropdownMenuItem
                  className="text-xs text-zinc-200"
                  onClick={() => moveModifierToGroup(partId, modifier.id, null)}
                >
                  {modifier.groupId === null ? '● ' : '  '}(无分组)
                </DropdownMenuItem>
                {groups.map(g => (
                  <DropdownMenuItem
                    key={g.id}
                    className="text-xs text-zinc-200"
                    onClick={() => moveModifierToGroup(partId, modifier.id, g.id)}
                  >
                    {modifier.groupId === g.id ? '● ' : '  '}
                    <div className="size-2 rounded-full inline-block mr-1.5" style={{ backgroundColor: g.color }} />
                    {g.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator className="bg-zinc-700" />
                <DropdownMenuItem
                  className="text-xs text-cyan-400"
                  onClick={() => {
                    const newGroup = addModifierGroup(partId, '新组');
                    moveModifierToGroup(partId, modifier.id, newGroup.id);
                  }}
                >
                  <Plus className="size-3 mr-1.5" />
                  新建组...
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator className="bg-zinc-700" />
            <DropdownMenuItem variant="destructive" className="text-xs" onClick={() => removePartAnimationModifier(partId, modifier.id)}>
              <Trash2 className="size-3 mr-1.5" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Parameters */}
      {!modifier.collapsed && (
        <div className="px-2 pb-2 space-y-0.5">
          <Separator className="bg-cyan-900/30 mb-1.5" />
          {/* Basic params */}
          {basicParams.map((p) => (
            <ParamControl
              key={p.name}
              param={p}
              value={modifier.params[p.name]}
              onChange={(v) => handleParamChange(p.name, v)}
              disabled={!modifier.enabled}
              onDragStart={handleSliderDragStart}
              onDragEnd={handleSliderDragEnd}
            />
          ))}

          {/* V11: Gait phase quick preset buttons */}
          {modifier.type === 'gait' && (
            <div className="flex items-center gap-1.5 py-1">
              <span className="text-[11px] text-muted-foreground shrink-0">腿偏移</span>
              <Button
                variant="outline"
                size="sm"
                className={`h-5 px-2 text-[10px] ${Number(modifier.params.phase) === 0 ? 'border-cyan-500/50 text-cyan-300 bg-cyan-500/10' : 'border-zinc-700 text-zinc-400'}`}
                disabled={!modifier.enabled}
                onClick={(e) => { e.stopPropagation(); handleParamChange('phase', 0); }}
              >0°</Button>
              <Button
                variant="outline"
                size="sm"
                className={`h-5 px-2 text-[10px] ${Number(modifier.params.phase) === 180 ? 'border-cyan-500/50 text-cyan-300 bg-cyan-500/10' : 'border-zinc-700 text-zinc-400'}`}
                disabled={!modifier.enabled}
                onClick={(e) => { e.stopPropagation(); handleParamChange('phase', 180); }}
              >180°</Button>
            </div>
          )}

          {/* V11: Advanced params (collapsible) */}
          {advancedParams.length > 0 && (
            <div className="mt-1">
              <button
                className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                onClick={(e) => { e.stopPropagation(); setAdvancedOpen(!advancedOpen); }}
              >
                {advancedOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                高级选项
              </button>
              {advancedOpen && (
                <div className="mt-0.5 pl-2 border-l border-zinc-800 space-y-0.5">
                  {advancedParams.map((p) => (
                    <ParamControl
                      key={p.name}
                      param={p}
                      value={modifier.params[p.name]}
                      onChange={(v) => handleParamChange(p.name, v)}
                      disabled={!modifier.enabled}
                      onDragStart={handleSliderDragStart}
                      onDragEnd={handleSliderDragEnd}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* V3.3: Wheel angular acceleration warning */}
          {modifier.type === 'wheel' && Number(modifier.params.angularAcceleration) !== 0 && (
            <div className="flex items-start gap-1.5 py-1.5 px-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 mt-1">
              <AlertTriangle className="size-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span className="text-[10px] text-amber-300 leading-tight">
                角加速度已启用，角速度关键帧将被忽略（仅作初始值）
              </span>
            </div>
          )}

          {/* V3.4: Wheel trajectory segment indicator */}
          {modifier.type === 'wheel' && (() => {
            const mode = String(modifier.params.trajectoryMode ?? 'circular');
            // Only show segment indicator for modes that have segments
            if (mode !== 'caterpillar' && mode !== 'rounded_rect' && mode !== 'independent_spin' && mode !== 'gear') return null;
            const period = Math.max(2, Number(modifier.params.period) || 16);
            const radiusX = Number(modifier.params.radiusX) || 10;
            const radiusY = Number(modifier.params.radiusY) || 10;
            const cornerRadius = Number(modifier.params.cornerRadius ?? 5);
            const { relativeFrame } = getAnimationFrameAndWeight(modifier, currentFrame);
            const segment = getWheelSegmentAtFrame(relativeFrame, period, mode as any, radiusX, radiusY, cornerRadius);
            if (!segment) return null;
            const segmentLabels: Record<string, { text: string; color: string }> = {
              bottom: { text: '底部 (接地)', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20' },
              right: { text: '右侧弧段', color: 'bg-sky-500/15 text-sky-300 border-sky-500/20' },
              top: { text: '顶部 (回程)', color: 'bg-violet-500/15 text-violet-300 border-violet-500/20' },
              left: { text: '左侧弧段', color: 'bg-amber-500/15 text-amber-300 border-amber-500/20' },
              spin: { text: '旋转中', color: 'bg-sky-500/15 text-sky-300 border-sky-500/20' },
            };
            const info = segmentLabels[segment];
            if (!info) return null;
            return (
              <div className="flex items-center gap-2 pt-1.5">
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${info.color}`}>
                  <CircleDot className="size-3" />
                  {info.text}
                </div>
              </div>
            );
          })()}

          {/* V3.3: Reset wheel angular velocity button — only for orbital modes */}
          {modifier.type === 'wheel' && !['independent_spin', 'gear'].includes(String(modifier.params.trajectoryMode ?? 'circular')) && (
            <div className="flex items-center pt-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] border-amber-600/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 gap-1 px-2"
                disabled={!modifier.enabled}
                onClick={(e) => {
                  e.stopPropagation();
                  resetWheelAngularVelocity(partId, modifier.id);
                }}
              >
                <RotateCcw className="size-3" />
                重置角速度
              </Button>
            </div>
          )}

          {/* V11: Gait phase indicator — shows current phase (stance/swing) + aerial indicator for run */}
          {modifier.type === 'gait' && (() => {
            const period = Math.max(4, Number(modifier.params.period) || 24);
            const stanceRatio = Number(modifier.params.stanceRatio ?? 0.6);
            const gaitStyle = String(modifier.params.gaitStyle ?? 'cartoon');
            const aerialRatio = Number(modifier.params.aerialRatio ?? 0.35);
            const { relativeFrame } = getAnimationFrameAndWeight(modifier, currentFrame);
            const gaitPhase = getGaitPhaseAtFrame(relativeFrame, period, stanceRatio);
            const isSwing = gaitPhase === 'swing';

            // Style label
            const styleLabels: Record<string, string> = {
              cartoon: '卡通行走',
              slow_walk: '慢走',
              run: '奔跑',
              paddle: '划桨/游泳',
            };

            // Check if currently in aerial phase (both feet off ground)
            // For run style with phase=180° offset between feet:
            // aerial when one foot is in early swing AND the other is in late swing
            // Simplified: if stanceRatio < 0.5, there's an aerial gap.
            // aerialRatio = 1 - 2*stanceRatio (when feet are 180° apart)
            const effectiveAerial = Math.max(0, 1 - 2 * stanceRatio);
            const isAerial = gaitStyle === 'run' && effectiveAerial > 0 && isSwing &&
              // Check if we're in the aerial overlap zone
              // Left foot swing: stanceRatio..1, Right foot swing: 0.5..0.5+stanceRatio
              // Aerial overlap: both in swing
              (() => {
                const normT = (relativeFrame % period) / period;
                // This foot's phase
                const thisSwing = normT >= stanceRatio;
                // Other foot (180° offset = 0.5 period offset)
                const otherNormT = ((normT + 0.5) % 1);
                const otherSwing = otherNormT >= stanceRatio;
                return thisSwing && otherSwing;
              })();

            return (
              <div className="flex flex-col gap-1 pt-1.5">
                <div className="flex items-center gap-2">
                  <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                    isAerial
                      ? 'bg-orange-500/15 text-orange-300 border border-orange-500/20'
                      : isSwing
                        ? gaitStyle === 'paddle'
                          ? 'bg-teal-500/15 text-teal-300 border border-teal-500/20'
                          : 'bg-sky-500/15 text-sky-300 border border-sky-500/20'
                        : gaitStyle === 'paddle'
                          ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20'
                          : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                  }`}>
                    <Footprints className="size-3" />
                    {isAerial ? '腾空期'
                      : isSwing
                        ? gaitStyle === 'paddle' ? '划水期 (水下)' : '摆动期 (空中)'
                        : gaitStyle === 'paddle' ? '恢复期 (水面)' : '支撑期 (着地)'}
                  </div>
                  <span className="text-[10px] text-zinc-500">
                    {styleLabels[gaitStyle] || '卡通行走'} · {
                      gaitStyle === 'paddle'
                        ? `${Math.round(stanceRatio * 100)}% 恢复 / ${Math.round((1 - stanceRatio) * 100)}% 划水`
                        : `${Math.round(stanceRatio * 100)}% 支撑 / ${Math.round((1 - stanceRatio) * 100)}% 摆动`
                    }
                  </span>
                </div>
                {gaitStyle === 'run' && effectiveAerial > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium bg-orange-500/10 border border-orange-500/20 text-orange-300">
                    <Zap className="size-3" />
                    腾空比 {Math.round(effectiveAerial * 100)}%（双脚同时离地）
                  </div>
                )}
              </div>
            );
          })()}

          {/* Effective range controls */}
          <Separator className="bg-cyan-900/30 my-1.5" />
          <div className="text-[10px] text-cyan-400/60 font-medium tracking-wider uppercase mb-1">
            有效区间
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[11px] text-muted-foreground w-14 shrink-0 truncate">起止帧</span>
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <Input type="number" className="h-6 w-14 text-[11px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1.5 py-0 shrink-0"
                value={modifier.startFrame} min={-1} step={1} disabled={!modifier.enabled}
                onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) updatePartAnimationModifierRange(partId, modifier.id, { startFrame: v }); }}
              />
              <span className="text-[10px] text-zinc-600">→</span>
              <Input type="number" className="h-6 w-14 text-[11px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1.5 py-0 shrink-0"
                value={modifier.endFrame} min={-1} step={1} disabled={!modifier.enabled}
                onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) updatePartAnimationModifierRange(partId, modifier.id, { endFrame: v }); }}
              />
              <span className="text-[9px] text-zinc-600 shrink-0">(-1=始终)</span>
            </div>
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[11px] text-muted-foreground w-14 shrink-0 truncate">淡入/出帧</span>
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <Input type="number" className="h-6 w-12 text-[11px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1.5 py-0 shrink-0"
                value={modifier.fadeInFrames} min={0} max={60} step={1} disabled={!modifier.enabled}
                onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) updatePartAnimationModifierRange(partId, modifier.id, { fadeInFrames: v }); }}
              />
              <span className="text-[10px] text-zinc-600">/</span>
              <Input type="number" className="h-6 w-12 text-[11px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1.5 py-0 shrink-0"
                value={modifier.fadeOutFrames} min={0} max={60} step={1} disabled={!modifier.enabled}
                onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) updatePartAnimationModifierRange(partId, modifier.id, { fadeOutFrames: v }); }}
              />
            </div>
          </div>
          {/* V3.2: Blend mode selector */}
          <Separator className="bg-cyan-900/30 my-1.5" />
          <div className="text-[10px] text-cyan-400/60 font-medium tracking-wider uppercase mb-1">
            混合模式
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[11px] text-muted-foreground w-14 shrink-0 truncate">混合模式</span>
            <Select
              value={modifier.blendMode || 'add'}
              disabled={!modifier.enabled}
              onValueChange={(v) => updatePartAnimationModifier(partId, modifier.id, { blendMode: v } as any)}
            >
              <SelectTrigger className="h-6 flex-1 min-w-0 text-[11px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1.5 py-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                <SelectItem value="add" className="text-[11px] text-zinc-200">加法（默认）</SelectItem>
                <SelectItem value="converge" className="text-[11px] text-zinc-200">收敛</SelectItem>
                <SelectItem value="multiply" className="text-[11px] text-zinc-200">乘法</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(modifier.blendMode === 'converge') && (
            <div className="flex items-center gap-2 py-1">
              <span className="text-[11px] text-muted-foreground w-14 shrink-0 truncate">收敛速度</span>
              <Slider
                className="flex-1 min-w-0"
                value={[Number(modifier.params.convergeSpeed) || 0.5]}
                min={0.01}
                max={3}
                step={0.01}
                disabled={!modifier.enabled}
                onPointerDown={() => handleSliderDragStart()}
                onValueChange={([v]) => handleParamChange('convergeSpeed', v)}
                onValueCommit={([v]) => { handleParamChange('convergeSpeed', v); handleSliderDragEnd(); }}
              />
              <Input
                type="number"
                className="h-6 w-14 text-[11px] bg-zinc-800/60 border-zinc-700 text-zinc-200 px-1.5 py-0 shrink-0"
                value={Number(modifier.params.convergeSpeed) || 0.5}
                min={0.01}
                max={3}
                step={0.01}
                disabled={!modifier.enabled}
                onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) handleParamChange('convergeSpeed', v); }}
              />
            </div>
          )}

          {/* M7: ParamDriver section */}
          <ParamDriverSection
            drivers={modifier.paramDrivers ?? []}
            paramsDef={def.params}
            disabled={!modifier.enabled}
            currentFrame={currentFrame}
            onAddDriver={(paramName) => addAnimParamDriver(partId, modifier.id, paramName)}
            onUpdateDriver={(driverId, updates) => updateAnimParamDriver(partId, modifier.id, driverId, updates)}
            onRemoveDriver={(driverId) => removeAnimParamDriver(partId, modifier.id, driverId)}
            onToggleDriver={(driverId) => toggleAnimParamDriver(partId, modifier.id, driverId)}
            onBakeDriver={(driverId) => bakeAnimParamDriver(partId, modifier.id, driverId)}
            onUnbakeDriver={(driverId) => unbakeAnimParamDriver(partId, modifier.id, driverId)}
          />

          {/* M6/M7: Param keyframe add button */}
          <Separator className="bg-cyan-900/30 my-1.5" />
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[10px] text-amber-400/70 hover:text-amber-300 hover:bg-amber-500/10 gap-1 px-1.5"
              disabled={!modifier.enabled}
              onClick={(e) => {
                e.stopPropagation();
                addAnimModifierParamKeyframe(partId, modifier.id, currentFrame, { ...modifier.params });
              }}
            >
              <Diamond className="size-3" />
              添加参数关键帧
            </Button>
            <span className="text-[9px] text-zinc-600">帧 {currentFrame}</span>
          </div>

          {/* M6/M7: Param keyframe diamond markers */}
          {modifier.paramKeyframes && modifier.paramKeyframes.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mt-1">
              <span className="text-[9px] text-zinc-500 shrink-0">参数关键帧:</span>
              {modifier.paramKeyframes
                .slice()
                .sort((a, b) => a.frame - b.frame)
                .map((pk) => (
                  <Tooltip key={pk.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={`group/pk relative flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] transition-colors ${
                          pk.frame === currentFrame
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-cyan-900/20 text-zinc-400 hover:bg-cyan-800/30'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          useProjectStore.getState().setCurrentFrame(pk.frame);
                        }}
                      >
                        <Diamond className="size-2.5 text-amber-400" />
                        F{pk.frame}
                        <span
                          className="ml-0.5 opacity-0 group-hover/pk:opacity-100 transition-opacity text-red-400 hover:text-red-300 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeAnimModifierParamKeyframe(partId, modifier.id, pk.id);
                          }}
                        >
                          ×
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-[10px] max-w-48">
                      <div className="space-y-0.5">
                        {Object.entries(pk.params).map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2">
                            <span className="text-zinc-400">{k}:</span>
                            <span className="text-zinc-200 font-mono">
                              {typeof v === 'number' ? v.toFixed(2) : String(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Empty State ----

function EmptyState({ onAddKeyframe }: { onAddKeyframe: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="size-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
        <Settings className="size-5 text-zinc-500" />
      </div>
      <p className="text-xs text-zinc-400 mb-1">当前帧没有关键帧</p>
      <p className="text-[11px] text-zinc-500 mb-4">
        添加关键帧以使用修改器栈
      </p>
      <Button
        size="sm"
        variant="outline"
        className="text-xs h-7 border-zinc-700 text-zinc-300 hover:text-zinc-100"
        onClick={onAddKeyframe}
      >
        <Plus className="size-3 mr-1" />
        添加关键帧
      </Button>
    </div>
  );
}

// ---- No Part Selected ----

function NoPartSelected() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="size-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
        <Layers className="size-5 text-zinc-500" />
      </div>
      <p className="text-xs text-zinc-400 mb-1">未选择部件</p>
      <p className="text-[11px] text-zinc-500">
        在画布上选择一个部件以查看修改器栈
      </p>
    </div>
  );
}

// ---- Baked State ----

function BakedState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="size-12 rounded-full bg-orange-500/10 flex items-center justify-center mb-3">
        <Flame className="size-5 text-orange-400" />
      </div>
      <Badge className="mb-2 bg-orange-500/20 text-orange-400 border-orange-500/30">
        已烘焙
      </Badge>
      <p className="text-[11px] text-zinc-500">
        此关键帧已被烘焙，修改器已应用且无法撤销
      </p>
    </div>
  );
}

// ---- Main ModifierPanel Component ----

export default function ModifierPanel() {
  // P1: During playback, freeze the panel to avoid per-frame re-renders that degrade FPS.
  // The panel content only needs to update when the active keyframe changes or
  // when the user explicitly edits a modifier — not on every frame tick.
  // We track playState with a selector (stable — doesn't change every frame),
  // and pass it down so ModifierPanelContent can suppress frame-driven re-renders.
  const playState = useEditorStore(s => s.playState);
  const isPlaying = playState === 'playing';
  return <ModifierPanelContent isPlaying={isPlaying} />;
}

// ---- V7+: Part-edit BrushCommand item with expandable stroke drivers ----

function PartEditBrushCommandItem({
  cmd,
  cmdIdx,
  modifierId,
  disabled,
  cmdLabel,
  cmdDrivers,
  addStrokeDriverToPartEditCmd,
  PartEditStrokeDriverBlock,
}: {
  cmd: BrushCommand;
  cmdIdx: number;
  modifierId: string;
  disabled: boolean;
  cmdLabel: string;
  cmdDrivers: StrokeParamDriver[];
  addStrokeDriverToPartEditCmd: (modifierId: string, commandId: string, driver: StrokeParamDriver) => void;
  PartEditStrokeDriverBlock: (props: { sd: StrokeParamDriver; modifierId: string; commandId: string; disabled: boolean }) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border border-cyan-800/15 bg-cyan-950/5 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-1 px-1.5 py-0.5 cursor-pointer hover:bg-cyan-800/10 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {cmd.type === 'draw' ? <Paintbrush className="size-2.5 text-cyan-400 shrink-0" />
          : cmd.type === 'erase' ? <Eraser className="size-2.5 text-cyan-400 shrink-0" />
          : <Grid3x3 className="size-2.5 text-cyan-400 shrink-0" />}
        <span className="text-[9px] text-zinc-300 flex-1 min-w-0 truncate">
          {cmdLabel} #{cmdIdx + 1}
        </span>
        {cmd.type !== 'erase' && (
          <div
            className="size-2.5 rounded-sm shrink-0 border border-zinc-600"
            style={{ backgroundColor: cmd.color }}
          />
        )}
        <span className="text-[8px] text-zinc-500 shrink-0">
          {cmd.size}px · {cmd.points.length}点
        </span>
        {cmdDrivers.length > 0 && (
          <Badge variant="secondary" className="text-[7px] px-0.5 py-0 h-3 bg-cyan-500/20 text-cyan-400 border-cyan-500/30 shrink-0">
            {cmdDrivers.length}驱动
          </Badge>
        )}
        <ChevronRight className={`size-2.5 text-zinc-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </div>

      {/* Expanded: stroke drivers + add driver */}
      {expanded && (
        <div className="px-1.5 pb-1.5 space-y-1">
          <Separator className="bg-cyan-900/15 mb-1" />
          {cmdDrivers.length === 0 ? (
            <p className="text-[8px] text-zinc-500 italic py-0.5">
              无笔画驱动器
            </p>
          ) : (
            cmdDrivers.map(sd => (
              <PartEditStrokeDriverBlock
                key={sd.id}
                sd={sd}
                modifierId={modifierId}
                commandId={cmd.id}
                disabled={disabled}
              />
            ))
          )}
          {/* Add driver dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-4 text-[8px] text-cyan-400/60 hover:text-cyan-300 hover:bg-cyan-400/5 gap-0.5 px-1 w-full justify-start"
                disabled={disabled}
              >
                <Plus className="size-2" />
                添加笔画驱动器
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              className="bg-zinc-900 border-zinc-700 w-40 max-h-48 overflow-y-auto"
            >
              <DropdownMenuLabel className="text-[8px] text-cyan-400/60 uppercase tracking-wider">
                选择驱动目标
              </DropdownMenuLabel>
              {(Object.entries(STROKE_DRIVER_TARGET_LABELS) as [string, string][]).map(([key, label]) => (
                <DropdownMenuItem
                  key={key}
                  className="text-[9px] text-zinc-200"
                  onClick={() => addStrokeDriverToPartEditCmd(modifierId, cmd.id, {
                    id: crypto.randomUUID(),
                    targetParam: key as StrokeParamDriver['targetParam'],
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
                  <Activity className="size-2.5 mr-1.5 text-cyan-400" />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

// P1: During playback, we suppress re-renders caused by currentFrame changes.
// We achieve this by using individual Zustand selectors for frame-dependent values,
// and a frozen ref for currentFrame so the component doesn't re-render on each frame tick.
function ModifierPanelContent({ isPlaying }: { isPlaying: boolean }) {
  // P1: Use individual selectors to minimize re-render triggers.
  // During playback, currentFrame changes every frame — we freeze it to prevent re-renders.
  // When not playing, we subscribe to the real currentFrame.
  // Key: by using a selector that returns a stable value during playback,
  // Zustand's shallow comparison skips the re-render entirely.
  const frozenFrameRef = useRef(useProjectStore.getState().currentFrame);
  const currentFrame = useProjectStore(s => {
    if (isPlaying) return frozenFrameRef.current; // Stable during playback — no re-render
    frozenFrameRef.current = s.currentFrame;
    return s.currentFrame;
  });

  const keyframes = useProjectStore(s => s.keyframes);
  const totalFrames = useProjectStore(s => s.totalFrames);
  const addKeyframe = useProjectStore(s => s.addKeyframe);
  const addModifier = useProjectStore(s => s.addModifier);
  const removeModifier = useProjectStore(s => s.removeModifier);
  const addModifierToSubsequent = useProjectStore(s => s.addModifierToSubsequent);
  const removeModifierFromSubsequent = useProjectStore(s => s.removeModifierFromSubsequent);
  const collapseModifiers = useProjectStore(s => s.collapseModifiers);
  const bakeModifiers = useProjectStore(s => s.bakeModifiers);
  const bakeToTimeline = useProjectStore(s => s.bakeToTimeline);
  const removeEffectTrack = useProjectStore(s => s.removeEffectTrack);
  const effectTracks = useProjectStore(s => s.effectTracks);
  const beginDrag = useProjectStore(s => s.beginDrag);
  const endDrag = useProjectStore(s => s.endDrag);
  const {
    selectedPartId,
    selectedKeyframeId,
    selectedModifierId,
    editMode,
    setEditMode,
    selectKeyframe,
    partEditPartId,
    partEditModifiers,
    addPartEditModifier,
    updatePartEditModifier,
    removePartEditModifier,
    togglePartEditModifier,
    bakePartEditModifiers,
    enterPartEditMode,
  } = useEditorStore();

  // V7+: Part-edit stroke driver actions (individual selectors for stable references)
  const addStrokeDriverToPartEditCmd = useEditorStore(s => s.addStrokeDriverToPartEditCmd);
  const removeStrokeDriverFromPartEditCmd = useEditorStore(s => s.removeStrokeDriverFromPartEditCmd);
  const updateStrokeDriverOnPartEditCmd = useEditorStore(s => s.updateStrokeDriverOnPartEditCmd);
  const toggleStrokeDriverOnPartEditCmd = useEditorStore(s => s.toggleStrokeDriverOnPartEditCmd);
  const addPartEditStrokeDriverParamDriver = useEditorStore(s => s.addPartEditStrokeDriverParamDriver);
  const removePartEditStrokeDriverParamDriver = useEditorStore(s => s.removePartEditStrokeDriverParamDriver);
  const updatePartEditStrokeDriverParamDriver = useEditorStore(s => s.updatePartEditStrokeDriverParamDriver);
  const togglePartEditStrokeDriverParamDriver = useEditorStore(s => s.togglePartEditStrokeDriverParamDriver);
  const addPartEditStrokeDriverParamKeyframe = useEditorStore(s => s.addPartEditStrokeDriverParamKeyframe);
  const removePartEditStrokeDriverParamKeyframe = useEditorStore(s => s.removePartEditStrokeDriverParamKeyframe);

  // ---- Bake confirmation dialog ----
  const [bakeDialogOpen, setBakeDialogOpen] = useState(false);

  // ---- V3.0: Bake to timeline dialog ----
  const [bakeToTimelineDialogOpen, setBakeToTimelineDialogOpen] = useState(false);
  const [bakeStartFrame, setBakeStartFrame] = useState(0);
  const [bakeEndFrame, setBakeEndFrame] = useState(0);
  const [bakeStep, setBakeStep] = useState(1);

  // ---- V2.3: Apply scope ----
  const [applyScope, setApplyScope] = useState<'current' | 'subsequent'>('current');

  // ---- V7+: Shared StrokeParamDriver time-driveable params definition ----
  const strokeDriverParamsDef: ModifierParam[] = useMemo(() => [
    { name: 'center', label: '位置(center)', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    { name: 'amplitude', label: '幅度(amplitude)', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    { name: 'width', label: '宽度(width)', type: 'number', default: 0.3, min: 0, max: 1, step: 0.01 },
    { name: 'frequency', label: '频率(frequency)', type: 'number', default: 1, min: 1, max: 20, step: 1 },
    { name: 'phase', label: '相位(phase)', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
  ], []);

  // ---- V2.3: Remove from subsequent confirmation dialog ----
  const [removeScopeDialogOpen, setRemoveScopeDialogOpen] = useState(false);
  const [pendingRemoveKeyframeId, setPendingRemoveKeyframeId] = useState<string | null>(null);
  const [pendingRemoveModifierId, setPendingRemoveModifierId] = useState<string | null>(null);

  // ---- Drag state ----
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // ---- Find the current keyframe ----
  const currentKeyframe = useMemo(() => {
    // If a keyframe is explicitly selected, use that
    if (selectedKeyframeId) {
      const kf = keyframes.find((k) => k.id === selectedKeyframeId);
      if (kf) return kf;
    }
    // Otherwise find the keyframe at the current frame for the selected part
    if (selectedPartId) {
      return keyframes.find(
        (k) => k.partId === selectedPartId && k.frame === currentFrame
      );
    }
    return null;
  }, [selectedKeyframeId, keyframes, selectedPartId, currentFrame]);

  const modifiers = currentKeyframe?.modifiers ?? [];

  // V3.1: Part-level animation modifiers
  // V3.2: Include modifier groups
  // P1: Use individual selectors to avoid re-renders on unrelated store changes
  const parts = useProjectStore(s => s.parts);
  const addPartAnimMod = useProjectStore(s => s.addPartAnimationModifier);
  const addGroup = useProjectStore(s => s.addModifierGroup);
  const selectedPart = parts.find((p) => p.id === selectedPartId);
  const animModifiers = selectedPart?.animationModifiers ?? [];
  const modifierGroups = (selectedPart?.modifierGroups ?? []).slice().sort((a, b) => a.order - b.order);

  // V3.2: Organize animation modifiers by group for rendering
  const ungroupedModifiers = animModifiers.filter(m => m.groupId === null);
  // Build a lookup from groupId -> modifiers array
  const groupModMap = modifierGroups.reduce<Record<string, PartAnimationModifier[]>>((acc, group) => {
    acc[group.id] = animModifiers.filter(m => m.groupId === group.id);
    return acc;
  }, {});

  // ---- Grouped modifier definitions for add menu ----
  const groupedDefinitions = useMemo(() => {
    const groups: Record<string, ModifierDefinition[]> = {
      transform: [],
      color: [],
      physics: [],
      effect: [],
      animation: [],
    };
    const categoryLabels: Record<string, string> = {
      transform: '变换',
      color: '颜色',
      physics: '物理',
      effect: '特效',
      animation: '动画',
    };
    for (const def of MODIFIER_DEFINITIONS) {
      groups[def.category]?.push(def);
    }
    return { groups, categoryLabels };
  }, []);

  // ---- Drag handlers ----
  const handleDragStart = useCallback(
    (e: React.DragEvent, id: string) => {
      setDraggedId(id);
      e.dataTransfer.effectAllowed = 'move';
      // Set a transparent drag image
      const el = e.currentTarget as HTMLElement;
      e.dataTransfer.setDragImage(el, 0, 0);
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, id: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (id !== dragOverId) {
        setDragOverId(id);
      }
    },
    [dragOverId]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      if (!draggedId || !currentKeyframe) return;
      if (draggedId === targetId) return;

      const { reorderModifier } = useProjectStore.getState();
      const mods = currentKeyframe.modifiers;
      const targetIndex = mods.findIndex((m) => m.id === targetId);
      if (targetIndex >= 0) {
        reorderModifier(currentKeyframe.id, draggedId, targetIndex);
      }

      setDraggedId(null);
      setDragOverId(null);
    },
    [draggedId, currentKeyframe]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverId(null);
  }, []);

  // ---- Add keyframe handler ----
  const handleAddKeyframe = useCallback(() => {
    if (!selectedPartId) return;
    const kf = addKeyframe(selectedPartId, currentFrame);
    selectKeyframe(kf.id);
  }, [selectedPartId, currentFrame, addKeyframe, selectKeyframe]);

  // ---- Effect modifier types ----
  const EFFECT_MODIFIER_TYPES: ModifierType[] = ['glow', 'particle', 'afterimage', 'pixel_displace', 'motion_blur'];

  // ---- Add modifier handler ----
  const handleAddModifier = useCallback(
    (type: ModifierType) => {
      if (!currentKeyframe) return;

      // P1-3: Wrap addModifier + effect track creation in performBatch for 1 undo entry
      const store = useProjectStore.getState();
      const effectType = EFFECT_MODIFIER_TYPES.includes(type) ? type as EffectType : null;

      store.performBatch('添加修改器', () => {
        if (applyScope === 'subsequent') {
          // Add to current keyframe and all subsequent keyframes of this part
          addModifierToSubsequent(currentKeyframe.partId, currentKeyframe.frame, type);
        } else {
          // Add to current keyframe only
          addModifier(currentKeyframe.id, type);
        }

        // If it's an effect modifier, also create an effect track
        if (effectType) {
          const def = getModifierDef(type);
          const partId = currentKeyframe.partId;
          const part = store.parts.find((p) => p.id === partId);
          const existingTrack = store.effectTracks.find(
            (t) => t.type === effectType && t.name.includes(part?.name ?? '')
          );
          if (!existingTrack) {
            const trackName = `${part?.name ?? 'Effect'} - ${def.label}`;
            store.addEffectTrack(effectType, trackName);
          }
        }
      });
    },
    [currentKeyframe, addModifier, addModifierToSubsequent, applyScope]
  );

  // ---- Internal remove implementation (defined first for correct closure) ----
  const performRemove = useCallback(
    (keyframeId: string, modifierId: string, scope?: 'current' | 'subsequent') => {
      const store = useProjectStore.getState();
      const kf = store.keyframes.find((k) => k.id === keyframeId);
      const mod = kf?.modifiers.find((m) => m.id === modifierId);

      if (scope === 'subsequent' && kf && mod) {
        // Remove modifiers of the same type from all subsequent keyframes
        removeModifierFromSubsequent(kf.partId, kf.frame, mod.type);

        // Also clean up effect track if needed
        if (EFFECT_MODIFIER_TYPES.includes(mod.type)) {
          const effectType = mod.type as EffectType;
          const allKfsForPart = store.keyframes.filter((k) => k.partId === kf.partId);
          const totalCount = allKfsForPart.reduce((count, k) => {
            return count + k.modifiers.filter((m) => m.type === mod.type).length;
          }, 0);
          if (totalCount === 0) {
            const part = store.parts.find((p) => p.id === kf.partId);
            const trackToRemove = store.effectTracks.find(
              (t) => t.type === effectType && t.name.includes(part?.name ?? '')
            );
            if (trackToRemove) {
              removeEffectTrack(trackToRemove.id);
            }
          }
        }
      } else {
        // Current keyframe only
        // Check if this is the last effect modifier of this type on this part
        if (kf && mod && EFFECT_MODIFIER_TYPES.includes(mod.type)) {
          const effectType = mod.type as EffectType;
          const sameTypeCount = kf.modifiers.filter(
            (m) => m.type === mod.type && m.id !== modifierId
          ).length;

          // If no more modifiers of this type on this keyframe, check other keyframes
          if (sameTypeCount === 0) {
            const allKfsForPart = store.keyframes.filter((k) => k.partId === kf.partId);
            const totalCount = allKfsForPart.reduce((count, k) => {
              if (k.id === keyframeId) return count; // already counted above
              return count + k.modifiers.filter((m) => m.type === mod.type).length;
            }, 0);

            if (totalCount === 0) {
              const part = store.parts.find((p) => p.id === kf.partId);
              const trackToRemove = store.effectTracks.find(
                (t) => t.type === effectType && t.name.includes(part?.name ?? '')
              );
              if (trackToRemove) {
                removeEffectTrack(trackToRemove.id);
              }
            }
          }
        }

        removeModifier(keyframeId, modifierId);
      }
    },
    [removeModifier, removeModifierFromSubsequent, removeEffectTrack]
  );

  // ---- Remove modifier handler (wraps store to also remove effect track) ----
  const handleRemoveModifier = useCallback(
    (keyframeId: string, modifierId: string) => {
      // If scope is 'subsequent', show confirmation dialog first
      if (applyScope === 'subsequent') {
        setPendingRemoveKeyframeId(keyframeId);
        setPendingRemoveModifierId(modifierId);
        setRemoveScopeDialogOpen(true);
        return;
      }

      // Current keyframe only
      performRemove(keyframeId, modifierId);
    },
    [applyScope, performRemove]
  );

  // ---- Handle scope-aware remove confirmation ----
  const handleRemoveScopeConfirm = useCallback(
    (scope: 'current' | 'subsequent') => {
      if (pendingRemoveKeyframeId && pendingRemoveModifierId) {
        performRemove(pendingRemoveKeyframeId, pendingRemoveModifierId, scope);
      }
      setRemoveScopeDialogOpen(false);
      setPendingRemoveKeyframeId(null);
      setPendingRemoveModifierId(null);
    },
    [pendingRemoveKeyframeId, pendingRemoveModifierId, performRemove]
  );

  // ---- Collapse all handler ----
  const handleCollapseAll = useCallback(() => {
    if (!currentKeyframe) return;
    collapseModifiers(currentKeyframe.id);
  }, [currentKeyframe, collapseModifiers]);

  // ---- Bake all handler ----
  const handleBakeAll = useCallback(() => {
    setBakeDialogOpen(true);
  }, []);

  const handleBakeConfirm = useCallback(() => {
    if (!currentKeyframe) return;
    bakeModifiers(currentKeyframe.id);
    setBakeDialogOpen(false);
  }, [currentKeyframe, bakeModifiers]);

  // ---- V3.0: Bake to timeline handler ----
  const handleBakeToTimeline = useCallback(() => {
    if (!selectedPartId) return;
    // Initialize range to full timeline
    setBakeStartFrame(0);
    setBakeEndFrame(totalFrames - 1);
    setBakeStep(1);
    setBakeToTimelineDialogOpen(true);
  }, [selectedPartId, totalFrames]);

  const handleBakeToTimelineConfirm = useCallback(() => {
    if (!selectedPartId) return;
    bakeToTimeline(selectedPartId, bakeStartFrame, bakeEndFrame, bakeStep);
    setBakeToTimelineDialogOpen(false);
  }, [selectedPartId, bakeStartFrame, bakeEndFrame, bakeStep, bakeToTimeline]);

  // ---- Correction mode handler ----
  const handleCorrectionMode = useCallback(() => {
    if (!currentKeyframe) return;
    setEditMode(editMode === 'correction' ? 'normal' : 'correction');
  }, [editMode, setEditMode, currentKeyframe]);

  // ---- P1-5: Promote to manual frame handler (bake pixel-level modifiers into keyframe) ----
  // 将所有像素级修改器的结果烘焙到当前关键帧的 correctionMask 中，
  // 而非修改部件本身的 pixels。这样其他关键帧不受影响。
  const handlePromoteToManual = useCallback(() => {
    if (!currentKeyframe || !selectedPartId) return;

    const store = useProjectStore.getState();
    const part = store.parts.find(p => p.id === selectedPartId);
    if (!part) return;

    // Find all pixel-level modifiers on this keyframe
    const pixelModTypes = [
      'color_replace', 'outline', 'dither', 'pixel_displace',
      'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip',
      'pixel_edit',
    ];
    const pixelMods = currentKeyframe.modifiers.filter(m => pixelModTypes.includes(m.type) && m.enabled);
    if (pixelMods.length === 0) return;

    // Bake: apply all pixel-level modifiers to get the final pixel result
    // Use the engine's applyPixelModifiers with correctionMask as base if present
    const basePixels = currentKeyframe.correctionMask ?? part.pixels;
    const bakedResult = applyPixelModifiers(part, pixelMods, currentFrame, basePixels);

    // Store the baked result into the keyframe's correctionMask (NOT part.pixels)
    // This makes this keyframe a "manual frame" with its own independent pixel data
    // Also store dimension overrides if the pixel grid was expanded by modifiers
    const updates: Partial<import('@/lib/types').Keyframe> = {
      correctionMask: bakedResult.pixels,
    };
    if (bakedResult.offsetX !== 0 || bakedResult.offsetY !== 0) {
      updates.overrideWidth = bakedResult.pixels[0]?.length ?? part.width;
      updates.overrideHeight = bakedResult.pixels.length ?? part.height;
      updates.overridePivotX = part.pivotX + bakedResult.offsetX;
      updates.overridePivotY = part.pivotY + bakedResult.offsetY;
    }
    store.setCorrection(currentKeyframe.id, bakedResult.pixels);
    if (updates.overrideWidth !== undefined) {
      store.updateKeyframe(currentKeyframe.id, updates);
    }

    // Remove only the pixel-level modifiers from the keyframe
    // (geometric/effect modifiers remain intact)
    const remainingMods = currentKeyframe.modifiers.filter(m => !pixelModTypes.includes(m.type));
    store.updateKeyframe(currentKeyframe.id, {
      modifiers: remainingMods,
    });
  }, [currentKeyframe, selectedPartId, currentFrame]);

  // ---- Render ----

  // ---- V7+: Part-edit BrushCommand stroke driver block ----
  /** Compact stroke driver display for a single BrushCommand in part edit mode */
  const PartEditStrokeDriverBlock = useCallback(({
    sd,
    modifierId,
    commandId,
    disabled,
  }: {
    sd: StrokeParamDriver;
    modifierId: string;
    commandId: string;
    disabled: boolean;
  }) => {
    const [expanded, setExpanded] = useState(false);
    return (
      <div className="rounded border border-cyan-800/20 bg-cyan-950/10">
        {/* Header */}
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 cursor-pointer select-none"
          onClick={() => setExpanded(!expanded)}
        >
          <Activity className="size-2.5 text-cyan-400 shrink-0" />
          <span className="text-[9px] text-cyan-300 truncate flex-1 min-w-0">
            {STROKE_DRIVER_TARGET_LABELS[sd.targetParam]}
          </span>
          <span className="text-[8px] text-zinc-500 shrink-0">
            {STROKE_DRIVER_WAVEFORM_LABELS[sd.waveform]}
          </span>
          <Checkbox
            checked={sd.enabled}
            onCheckedChange={() => toggleStrokeDriverOnPartEditCmd(modifierId, commandId, sd.id)}
            className="size-2.5 shrink-0"
            disabled={disabled}
          />
          <button
            type="button"
            className="size-3 flex items-center justify-center text-zinc-600 hover:text-red-400 shrink-0"
            disabled={disabled}
            onClick={(e) => { e.stopPropagation(); removeStrokeDriverFromPartEditCmd(modifierId, commandId, sd.id); }}
          >
            <X className="size-2" />
          </button>
          <ChevronRight className={`size-2.5 text-zinc-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
        {/* Expanded: basic params + time-domain param drivers */}
        {expanded && (
          <div className="px-1.5 pb-1.5 space-y-0.5">
            <Separator className="bg-cyan-900/20 mb-1" />
            {/* Waveform */}
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-zinc-500 w-8 shrink-0">波形</span>
              <Select value={sd.waveform} disabled={disabled}
                onValueChange={(v) => updateStrokeDriverOnPartEditCmd(modifierId, commandId, sd.id, { waveform: v as StrokeParamDriver['waveform'] })}>
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
            {/* Amplitude */}
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-zinc-500 w-8 shrink-0">幅度</span>
              <Slider className="flex-1" value={[sd.amplitude]} min={0} max={1} step={0.05}
                onValueChange={([v]) => updateStrokeDriverOnPartEditCmd(modifierId, commandId, sd.id, { amplitude: v })} />
              <span className="text-[8px] text-zinc-400 w-6 text-right font-mono">{Math.round(sd.amplitude * 100)}%</span>
            </div>
            {/* Center */}
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-zinc-500 w-8 shrink-0">中心</span>
              <Slider className="flex-1" value={[sd.center]} min={0} max={1} step={0.05}
                onValueChange={([v]) => updateStrokeDriverOnPartEditCmd(modifierId, commandId, sd.id, { center: v })} />
              <span className="text-[8px] text-zinc-400 w-6 text-right font-mono">{Math.round(sd.center * 100)}%</span>
            </div>
            {/* Width */}
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-zinc-500 w-8 shrink-0">宽度</span>
              <Slider className="flex-1" value={[sd.width]} min={0.01} max={1} step={0.01}
                onValueChange={([v]) => updateStrokeDriverOnPartEditCmd(modifierId, commandId, sd.id, { width: v })} />
              <span className="text-[8px] text-zinc-400 w-6 text-right font-mono">{Math.round(sd.width * 100)}%</span>
            </div>
            {/* Phase */}
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-zinc-500 w-8 shrink-0">相位</span>
              <Slider className="flex-1" value={[sd.phase]} min={0} max={1} step={0.05}
                onValueChange={([v]) => updateStrokeDriverOnPartEditCmd(modifierId, commandId, sd.id, { phase: v })} />
              <span className="text-[8px] text-zinc-400 w-6 text-right font-mono">{Math.round(sd.phase * 100)}%</span>
            </div>
            {/* Frequency */}
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-zinc-500 w-8 shrink-0">频率</span>
              <Slider className="flex-1" value={[sd.frequency]} min={1} max={10} step={1}
                onValueChange={([v]) => updateStrokeDriverOnPartEditCmd(modifierId, commandId, sd.id, { frequency: v })} />
              <span className="text-[8px] text-zinc-400 w-6 text-right font-mono">{sd.frequency}</span>
            </div>
            {/* Direction */}
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-zinc-500 w-8 shrink-0">方向</span>
              <Select value={sd.direction} disabled={disabled}
                onValueChange={(v) => updateStrokeDriverOnPartEditCmd(modifierId, commandId, sd.id, { direction: v as 'forward' | 'reverse' })}>
                <SelectTrigger className="h-4 flex-1 text-[8px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
                  <SelectItem value="forward">正向</SelectItem>
                  <SelectItem value="reverse">反向</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Time-domain ParamDriver section */}
            <ParamDriverSection
              drivers={sd.paramDrivers ?? []}
              paramsDef={strokeDriverParamsDef}
              disabled={disabled}
              currentFrame={currentFrame}
              onAddDriver={(paramName) => addPartEditStrokeDriverParamDriver(modifierId, commandId, sd.id, paramName)}
              onUpdateDriver={(driverId, updates) => updatePartEditStrokeDriverParamDriver(modifierId, commandId, sd.id, driverId, updates)}
              onRemoveDriver={(driverId) => removePartEditStrokeDriverParamDriver(modifierId, commandId, sd.id, driverId)}
              onToggleDriver={(driverId) => togglePartEditStrokeDriverParamDriver(modifierId, commandId, sd.id, driverId)}
              onBakeDriver={(driverId) => {
                const es = useEditorStore.getState();
                es.bakePartEditStrokeDriverParamDriver(modifierId, commandId, sd.id, driverId);
              }}
              onUnbakeDriver={(driverId) => {
                const es = useEditorStore.getState();
                es.unbakePartEditStrokeDriverParamDriver(modifierId, commandId, sd.id, driverId);
              }}
            />

            {/* Param keyframe add button for this stroke driver */}
            <div className="mt-0.5">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 text-[8px] text-amber-400/60 hover:text-amber-300 hover:bg-amber-500/10 gap-0.5 px-1"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    addPartEditStrokeDriverParamKeyframe(modifierId, commandId, sd.id, currentFrame, {
                      center: sd.center,
                      amplitude: sd.amplitude,
                      width: sd.width,
                      frequency: sd.frequency,
                      phase: sd.phase,
                    });
                  }}
                >
                  <Diamond className="size-2" />
                  添加关键帧
                </Button>
                <span className="text-[8px] text-zinc-600">帧{currentFrame}</span>
              </div>

              {/* Param keyframe markers */}
              {sd.paramKeyframes && sd.paramKeyframes.length > 0 && (
                <div className="flex items-center gap-0.5 flex-wrap mt-0.5">
                  {sd.paramKeyframes
                    .slice()
                    .sort((a, b) => a.frame - b.frame)
                    .map((pk) => (
                      <button
                        key={pk.id}
                        type="button"
                        className={`group/pk flex items-center gap-0.5 px-0.5 py-0 rounded text-[8px] transition-colors ${
                          pk.frame === currentFrame
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-zinc-800/40 text-zinc-500 hover:bg-zinc-700/40'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          useProjectStore.getState().setCurrentFrame(pk.frame);
                        }}
                      >
                        <Diamond className="size-1.5 text-amber-400" />
                        F{pk.frame}
                        <span
                          className="opacity-0 group-hover/pk:opacity-100 transition-opacity text-red-400"
                          onClick={(e) => {
                            e.stopPropagation();
                            removePartEditStrokeDriverParamKeyframe(modifierId, commandId, sd.id, pk.id);
                          }}
                        >
                          ×
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }, [currentFrame, strokeDriverParamsDef, toggleStrokeDriverOnPartEditCmd, removeStrokeDriverFromPartEditCmd,
      updateStrokeDriverOnPartEditCmd, addPartEditStrokeDriverParamDriver, removePartEditStrokeDriverParamDriver,
      updatePartEditStrokeDriverParamDriver, togglePartEditStrokeDriverParamDriver,
      addPartEditStrokeDriverParamKeyframe, removePartEditStrokeDriverParamKeyframe]);

  // ---- Part Edit Mode: simplified modifier panel ----
  if (editMode === 'part_edit' && partEditPartId) {
    const partEditPart = parts.find(p => p.id === partEditPartId);
    // Allowed modifier types in part edit mode
    const PART_EDIT_MOD_TYPES: ModifierType[] = [
      'color_replace', 'outline', 'dither', 'pixel_displace',
      'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip', 'translate',
    ];

    return (
      <div className="flex flex-col h-full bg-zinc-950" style={{ width: 280 }}>
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-cyan-800/40 flex items-center gap-2 shrink-0">
          <div className="size-4 rounded bg-cyan-400/10 flex items-center justify-center">
            <Pencil className="size-2.5 text-cyan-400" />
          </div>
          <h3 className="text-xs font-semibold text-cyan-300 tracking-wide">
            部件编辑修改器
          </h3>
        </div>

        {/* Part name */}
        <div className="px-3 py-2 border-b border-zinc-800/50 shrink-0">
          <span className="text-[11px] text-zinc-400">
            正在编辑: <span className="text-cyan-300 font-medium">{partEditPart?.name ?? '未知部件'}</span>
          </span>
        </div>

        {/* Modifier list */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-1.5">
            {partEditModifiers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
                <div className="size-10 rounded-full bg-zinc-800 flex items-center justify-center mb-2">
                  <Zap className="size-4 text-zinc-500" />
                </div>
                <p className="text-[11px] text-zinc-500">
                  暂无修改器
                </p>
                <p className="text-[10px] text-zinc-600">
                  添加修改器以编辑像素
                </p>
              </div>
            ) : (
              partEditModifiers.map((mod, idx) => {
                const def = getModifierDef(mod.type);
                const label = mod.type === 'translate' ? '像素平移' : mod.type === 'pixel_edit' ? '像素编辑' : def.label;
                const brushCommands = mod.type === 'pixel_edit'
                  ? ((mod.params.brushCommands as BrushCommand[]) || [])
                  : [];
                const totalStrokeDrivers = brushCommands.reduce((sum, c) => sum + (c.strokeDrivers?.length ?? 0), 0);
                return (
                  <div
                    key={mod.id}
                    className="group relative rounded-lg border border-cyan-800/30 bg-cyan-950/20 hover:border-cyan-700/40 transition-all cursor-pointer"
                    style={{ opacity: !mod.enabled ? 0.5 : 1 }}
                  >
                    {/* Header */}
                    <div className="flex items-center gap-1.5 px-2 py-2">
                      <div className="flex items-center justify-center size-5 rounded bg-cyan-400/10 shrink-0">
                        <ModifierIcon iconName={def.icon} className="size-3 text-cyan-400" />
                      </div>
                      <span className="text-xs font-medium text-zinc-200 truncate flex-1 min-w-0">
                        {label}
                      </span>
                      {mod.type === 'pixel_edit' && (
                        <span className="text-[9px] text-zinc-500 shrink-0">
                          {brushCommands.length}条笔画
                          {totalStrokeDrivers > 0 && ` · ${totalStrokeDrivers}驱动`}
                        </span>
                      )}
                      <Checkbox
                        checked={mod.enabled}
                        onCheckedChange={() => togglePartEditModifier(mod.id)}
                        className="size-3.5 shrink-0"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-5 p-0 text-zinc-500 hover:text-red-400 shrink-0"
                        onClick={() => removePartEditModifier(mod.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                    {/* Parameters */}
                    <div className="px-2 pb-2 space-y-0.5">
                      <Separator className="bg-cyan-900/30 mb-1.5" />
                      {mod.type !== 'pixel_edit' && def.params
                        .filter(p => {
                          // In part_edit mode, translate only shows offsetX/offsetY
                          if (mod.type === 'translate') {
                            return p.name === 'offsetX' || p.name === 'offsetY';
                          }
                          return true;
                        })
                        .map((p) => (
                          <ParamControl
                            key={p.name}
                            param={{
                              ...p,
                              label: mod.type === 'translate' && p.name === 'offsetX' ? 'X偏移'
                                : mod.type === 'translate' && p.name === 'offsetY' ? 'Y偏移'
                                : p.label,
                            }}
                            value={mod.params[p.name] ?? p.default}
                            onChange={(v) => updatePartEditModifier(mod.id, { [p.name]: v })}
                            disabled={!mod.enabled}
                            onDragStart={() => beginDrag('调整部件编辑参数')}
                            onDragEnd={() => endDrag()}
                          />
                        ))}

                      {/* pixel_edit: brush commands with stroke drivers */}
                      {mod.type === 'pixel_edit' && (
                        <div className="space-y-1">
                          {brushCommands.length === 0 ? (
                            <p className="text-[9px] text-zinc-500 italic py-1">
                              在画布上绘制以记录笔画
                            </p>
                          ) : (
                            <div className="max-h-64 overflow-y-auto space-y-1 pr-0.5" style={{ scrollbarWidth: 'thin', scrollbarColor: '#3f3f46 transparent' }}>
                              {brushCommands.map((cmd, cmdIdx) => {
                                const cmdDrivers = cmd.strokeDrivers ?? [];
                                const cmdLabel = cmd.type === 'draw' ? '绘制' : cmd.type === 'erase' ? '擦除' : '填充';
                                return (
                                  <PartEditBrushCommandItem
                                    key={cmd.id}
                                    cmd={cmd}
                                    cmdIdx={cmdIdx}
                                    modifierId={mod.id}
                                    disabled={!mod.enabled}
                                    cmdLabel={cmdLabel}
                                    cmdDrivers={cmdDrivers}
                                    addStrokeDriverToPartEditCmd={addStrokeDriverToPartEditCmd}
                                    PartEditStrokeDriverBlock={PartEditStrokeDriverBlock}
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>

        {/* Add modifier footer */}
        <div className="px-2 py-2 border-t border-zinc-800 shrink-0 space-y-1.5">
          {partEditModifiers.length > 0 && (
            <Button
              variant="outline"
              className="w-full h-7 text-xs border-amber-800/50 text-amber-400/80 hover:text-amber-300 hover:border-amber-600/50 bg-amber-950/20"
              onClick={() => {
                if (partEditPartId) bakePartEditModifiers(partEditPartId);
              }}
            >
              <Flame className="size-3 mr-1" />
              烘焙修改器到像素
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="w-full h-7 text-xs border-dashed border-cyan-800/50 text-cyan-400/70 hover:text-cyan-300 hover:border-cyan-600/50"
              >
                <Plus className="size-3 mr-1" />
                添加修改器
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              className="bg-zinc-900 border-zinc-700 w-48 max-h-60 overflow-y-auto"
            >
              <DropdownMenuLabel className="text-[10px] text-cyan-400/60 uppercase tracking-wider">
                像素级修改器
              </DropdownMenuLabel>
              {MODIFIER_DEFINITIONS
                .filter(d => PART_EDIT_MOD_TYPES.includes(d.type))
                .map((def) => (
                  <DropdownMenuItem
                    key={def.type}
                    className="text-xs text-zinc-200"
                    onClick={() => addPartEditModifier(def.type)}
                  >
                    <ModifierIcon iconName={def.icon} className="size-3 mr-1.5 text-cyan-400" />
                    {def.type === 'translate' ? '像素平移' : def.label}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  // ---- Normal mode render ----
  return (
    <div
      className="flex flex-col h-full bg-zinc-950"
      style={{ width: 280 }}
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <h3 className="text-xs font-semibold text-zinc-200 tracking-wide">
          修改器栈
        </h3>
        <div className="flex items-center gap-1">
          {currentKeyframe && !currentKeyframe.isBaked && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`size-6 p-0 ${
                      editMode === 'correction'
                        ? 'text-amber-400 bg-amber-400/10'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                    onClick={handleCorrectionMode}
                  >
                    <Paintbrush className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">
                  {editMode === 'correction' ? '退出修正模式' : '像素修正模式'}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 p-0 text-zinc-500 hover:text-zinc-300"
                    onClick={handleCollapseAll}
                  >
                    <Layers className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">
                  坍缩全部
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 p-0 text-zinc-500 hover:text-orange-400"
                    onClick={handleBakeAll}
                  >
                    <Flame className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">
                  烘焙全部
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 p-0 text-zinc-500 hover:text-cyan-400"
                    onClick={handleBakeToTimeline}
                    disabled={!selectedPartId}
                  >
                    <Timer className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">
                  烘焙动画到时间轴
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Baked badge at top of panel */}
      {currentKeyframe?.isBaked && (
        <div className="px-3 py-2 bg-orange-500/10 border-b border-orange-500/20 flex items-center gap-2 shrink-0">
          <Flame className="size-3.5 text-orange-400" />
          <span className="text-[11px] text-orange-400 font-medium">已烘焙</span>
        </div>
      )}

      {/* Correction mode indicator */}
      {editMode === 'correction' && currentKeyframe && (
        <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 shrink-0">
          <Paintbrush className="size-3.5 text-amber-400" />
          <span className="text-[11px] text-amber-400 font-medium">
            修正模式
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-5 text-[10px] text-amber-400/70 hover:text-amber-300 px-1.5"
            onClick={() => setEditMode('normal')}
          >
            退出
          </Button>
        </div>
      )}

      {/* P1-5: Promote to manual frame button (when any pixel-level modifier exists) */}
      {currentKeyframe && currentKeyframe.modifiers.some(m => ['color_replace','outline','dither','pixel_displace','cylinder_rotate','sphere_rotate','mirror','flip','pixel_edit'].includes(m.type) && m.enabled) && (
        <div className="px-3 py-2 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center gap-2 shrink-0">
          <Flame className="size-3.5 text-emerald-400" />
          <span className="text-[11px] text-emerald-400 font-medium flex-1">
            提升为手动帧
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[10px] text-emerald-400 hover:text-emerald-300 bg-emerald-500/20 hover:bg-emerald-500/30 px-2"
            onClick={handlePromoteToManual}
          >
            提升
          </Button>
        </div>
      )}

      {/* Part edit modifiers (persistent, from part.editModifiers) */}
      {selectedPartId && (() => {
        const selPart = parts.find(p => p.id === selectedPartId);
        const editMods = selPart?.editModifiers ?? [];
        if (editMods.length === 0) return null;
        return (
          <div className="px-3 py-2 bg-cyan-500/10 border-b border-cyan-500/20 shrink-0">
            <div className="flex items-center gap-2">
              <Pencil className="size-3.5 text-cyan-400" />
              <span className="text-[11px] text-cyan-400 font-medium flex-1">
                部件编辑修改器 ({editMods.length})
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] text-amber-400 hover:text-amber-300 bg-amber-500/20 hover:bg-amber-500/30 px-2"
                onClick={() => {
                  if (selectedPartId) bakePartEditModifiers(selectedPartId);
                }}
              >
                <Flame className="size-2.5 mr-0.5" />
                烘焙
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] text-cyan-400 hover:text-cyan-300 bg-cyan-500/20 hover:bg-cyan-500/30 px-2"
                onClick={() => {
                  if (selectedPartId) enterPartEditMode(selectedPartId);
                }}
              >
                编辑
              </Button>
            </div>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {editMods.map((m) => {
                const def = getModifierDef(m.type);
                return (
                  <span
                    key={m.id}
                    className={`text-[9px] px-1.5 py-0.5 rounded ${m.enabled ? 'bg-cyan-400/10 text-cyan-300' : 'bg-zinc-800 text-zinc-500 line-through'}`}
                  >
                    {m.type === 'translate' ? '像素平移' : def.label}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Modifier list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {!selectedPartId ? (
            <NoPartSelected />
          ) : (
            <>
              {/* V3.1: Part-level Animation Modifiers section */}
              {/* V3.2: Organized by groups */}
              {animModifiers.length > 0 && (
                <>
                  <div className="flex items-center gap-1.5 py-1">
                    <div className="size-4 rounded bg-cyan-400/10 flex items-center justify-center">
                      <Timer className="size-2.5 text-cyan-400" />
                    </div>
                    <span className="text-[10px] text-cyan-400/80 font-semibold tracking-wider uppercase">
                      动画修改器
                    </span>
                    <span className="text-[9px] text-zinc-600 ml-auto">部件级</span>
                  </div>

                  {/* Ungrouped modifiers first */}
                  {ungroupedModifiers.map((am) => (
                    <AnimModifierBlock
                      key={am.id}
                      modifier={am}
                      partId={selectedPartId!}
                      groups={modifierGroups}
                      currentFrame={currentFrame}
                    />
                  ))}

                  {/* Grouped modifiers, ordered by group order */}
                  {modifierGroups.map((group) => {
                    const groupMods = groupModMap[group.id] ?? [];
                    if (groupMods.length === 0 && !group.collapsed) return null; // hide empty non-collapsed groups
                    return (
                      <div key={group.id} className="space-y-1">
                        <ModifierGroupHeader
                          group={group}
                          partId={selectedPartId!}
                          modifierCount={groupMods.length}
                        />
                        {!group.collapsed && groupMods.map((am) => (
                          <AnimModifierBlock
                            key={am.id}
                            modifier={am}
                            partId={selectedPartId!}
                            groups={modifierGroups}
                            currentFrame={currentFrame}
                          />
                        ))}
                      </div>
                    );
                  })}
                  <Separator className="bg-zinc-800 my-1" />
                </>
              )}

              {/* Add animation modifier + add group buttons */}
              {selectedPartId && (
                <div className="flex gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="flex-1 h-6 text-[11px] text-cyan-400/70 hover:text-cyan-300 hover:bg-cyan-400/5 border border-dashed border-cyan-900/30"
                      >
                        <Plus className="size-3 mr-1" />
                        添加动画修改器
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      side="top"
                      className="bg-zinc-900 border-zinc-700 w-44 max-h-60 overflow-y-auto"
                    >
                      <DropdownMenuLabel className="text-[10px] text-cyan-400/60 uppercase tracking-wider">
                        动画修改器
                      </DropdownMenuLabel>
                      {MODIFIER_DEFINITIONS.filter(d => d.category === 'animation').map((def) => (
                        <DropdownMenuItem
                          key={def.type}
                          className="text-xs text-zinc-200"
                          onClick={() => addPartAnimMod(selectedPartId, def.type as AnimationModifierType)}
                        >
                          <ModifierIcon iconName={def.icon} className="size-3 mr-1.5 text-cyan-400" />
                          {def.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-6 px-2 text-[11px] text-violet-400/70 hover:text-violet-300 hover:bg-violet-400/5 border border-dashed border-violet-900/30"
                        onClick={() => addGroup(selectedPartId, '新组')}
                      >
                        <Layers className="size-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px]">
                      添加修改器组
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}

              {/* Keyframe Modifiers section */}
              {!currentKeyframe ? (
                <EmptyState onAddKeyframe={handleAddKeyframe} />
              ) : currentKeyframe.isBaked ? (
                <BakedState />
              ) : modifiers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
                  <div className="size-10 rounded-full bg-zinc-800 flex items-center justify-center mb-2">
                    <Zap className="size-4 text-zinc-500" />
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    暂无关键帧修改器
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 py-1">
                    <div className="size-4 rounded bg-emerald-400/10 flex items-center justify-center">
                      <Move className="size-2.5 text-emerald-400" />
                    </div>
                    <span className="text-[10px] text-emerald-400/80 font-semibold tracking-wider uppercase">
                      关键帧修改器
                    </span>
                  </div>
                  {modifiers.map((mod, idx) => (
                    <ModifierBlock
                      key={mod.id}
                      modifier={mod}
                      keyframeId={currentKeyframe.id}
                      currentFrame={currentFrame}
                      index={idx}
                      totalCount={modifiers.length}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onDragEnd={handleDragEnd}
                      isSelected={selectedModifierId === mod.id}
                      onRemove={handleRemoveModifier}
                      hasParent={!!selectedPart?.parentId}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Add modifier footer */}
      {currentKeyframe && !currentKeyframe.isBaked && (
        <div className="px-2 py-2 border-t border-zinc-800 shrink-0 space-y-1.5">
          {/* V2.3: Apply scope toggle */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-500 shrink-0 w-10">应用范围</span>
            <div className="flex flex-1 rounded-md border border-zinc-700 overflow-hidden">
              <button
                type="button"
                className={`flex-1 px-2 py-1 text-[10px] transition-colors ${
                  applyScope === 'current'
                    ? 'bg-primary/20 text-primary font-medium'
                    : 'bg-transparent text-zinc-500 hover:text-zinc-300'
                }`}
                onClick={() => setApplyScope('current')}
              >
                仅当前帧
              </button>
              <button
                type="button"
                className={`flex-1 px-2 py-1 text-[10px] transition-colors border-l border-zinc-700 ${
                  applyScope === 'subsequent'
                    ? 'bg-primary/20 text-primary font-medium'
                    : 'bg-transparent text-zinc-500 hover:text-zinc-300'
                }`}
                onClick={() => setApplyScope('subsequent')}
              >
                当前及后续
              </button>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="w-full h-7 text-xs border-dashed border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
              >
                <Plus className="size-3 mr-1" />
                添加修改器
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              className="bg-zinc-900 border-zinc-700 w-52 max-h-72 overflow-y-auto"
            >
              {Object.entries(groupedDefinitions.groups).map(
                ([category, defs]) =>
                  defs.length > 0 && (
                    <DropdownMenuGroup key={category}>
                      <DropdownMenuLabel className="text-[10px] text-zinc-500 uppercase tracking-wider">
                        {groupedDefinitions.categoryLabels[category]}
                      </DropdownMenuLabel>
                      {defs.map((def) => (
                        <DropdownMenuItem
                          key={def.type}
                          className="text-xs text-zinc-200"
                          onClick={() => handleAddModifier(def.type)}
                        >
                          <ModifierIcon
                            iconName={def.icon}
                            className={`size-3 mr-1.5 ${CATEGORY_COLORS[def.category]}`}
                          />
                          {def.label}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator className="bg-zinc-800" />
                    </DropdownMenuGroup>
                  )
              )}
              {/* Feature 3: Load Preset */}
              {(() => {
                const savedPresets = loadPresets();
                const nonAnimPresets = savedPresets.filter(p => !ANIMATION_MODIFIER_TYPES.includes(p.type));
                if (nonAnimPresets.length > 0) {
                  return (
                    <>
                      <DropdownMenuSeparator className="bg-zinc-800" />
                      <DropdownMenuLabel className="text-[10px] text-amber-400/60 uppercase tracking-wider">
                        已保存预设
                      </DropdownMenuLabel>
                      {nonAnimPresets.map((preset) => (
                        <DropdownMenuItem
                          key={preset.id}
                          className="text-xs text-amber-200 flex items-center gap-1.5"
                          onClick={() => handleAddModifier(preset.type)}
                        >
                          <Bookmark className="size-3 text-amber-400" />
                          <span className="flex-1 truncate">{preset.name}</span>
                          <span className="text-[9px] text-zinc-600">{preset.category}</span>
                          <button
                            type="button"
                            className="size-4 flex items-center justify-center text-zinc-600 hover:text-red-400 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              removePreset(preset.id);
                            }}
                          >
                            <Trash2 className="size-2.5" />
                          </button>
                        </DropdownMenuItem>
                      ))}
                    </>
                  );
                }
                return null;
              })()}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Bake confirmation dialog */}
      <Dialog open={bakeDialogOpen} onOpenChange={setBakeDialogOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm text-zinc-100">
              确认烘焙
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              烘焙将把所有修改器效果应用到像素上并移除修改器栈。此操作不可撤销！
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-zinc-400 hover:text-zinc-200"
              onClick={() => setBakeDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="text-xs"
              onClick={handleBakeConfirm}
            >
              <Flame className="size-3 mr-1" />
              确认烘焙
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* V2.3: Remove scope confirmation dialog */}
      <Dialog open={removeScopeDialogOpen} onOpenChange={setRemoveScopeDialogOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm text-zinc-100">
              删除修改器范围
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              当前应用范围设为"当前及后续帧"。请选择要删除的范围：
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 flex-col">
            <Button
              size="sm"
              variant="outline"
              className="text-xs w-full border-zinc-700 text-zinc-300 hover:text-zinc-100"
              onClick={() => handleRemoveScopeConfirm('current')}
            >
              仅当前关键帧
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="text-xs w-full"
              onClick={() => handleRemoveScopeConfirm('subsequent')}
            >
              <Trash2 className="size-3 mr-1" />
              当前及后续所有关键帧
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-zinc-400 hover:text-zinc-200 w-full"
              onClick={() => setRemoveScopeDialogOpen(false)}
            >
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
