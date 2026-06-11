'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Settings,
  BoxSelect,
  Palette,
  Maximize2,
  Sun,
  Grid3x3,
  Circle,
} from 'lucide-react';

import { useProjectStore } from '@/lib/store';
import {
  CanvasModifierTrack,
  CanvasModifierType,
  CanvasModifierInstance,
  CANVAS_MODIFIER_DEFINITIONS,
  getCanvasModifierDef,
  ModifierParamValue,
} from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';

import ParamControl from './shared/ParamControl';

// ---- Icon Mapping ----

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  BoxSelect,
  Palette,
  Maximize2,
  Sun,
  Grid3x3,
  Circle,
};

function CanvasModifierIcon({ iconName, className }: { iconName: string; className?: string }) {
  const Comp = ICON_MAP[iconName];
  if (!Comp) return <Settings className={className} />;
  return <Comp className={className} />;
}

// ---- Canvas Modifier Colors ----

const CANVAS_MODIFIER_COLORS: Record<CanvasModifierType, string> = {
  outline_emphasis: 'text-amber-400',
  color_lut: 'text-pink-400',
  pixel_zoom: 'text-emerald-400',
  bloom: 'text-yellow-400',
  scanlines: 'text-cyan-400',
  canvas_mask: 'text-teal-400',
};

const CANVAS_MODIFIER_BG: Record<CanvasModifierType, string> = {
  outline_emphasis: 'bg-amber-400/10',
  color_lut: 'bg-pink-400/10',
  pixel_zoom: 'bg-emerald-400/10',
  bloom: 'bg-yellow-400/10',
  scanlines: 'bg-cyan-400/10',
  canvas_mask: 'bg-teal-400/10',
};

// ---- CanvasModifierBlock ----

function CanvasModifierBlock({
  modifier,
  trackId,
}: {
  modifier: CanvasModifierInstance;
  trackId: string;
}) {
  const def = getCanvasModifierDef(modifier.type);
  // P1: Use individual selectors to avoid re-renders on unrelated store changes
  const updateCanvasModifier = useProjectStore(s => s.updateCanvasModifier);
  const toggleCanvasModifier = useProjectStore(s => s.toggleCanvasModifier);
  const toggleCanvasModifierCollapsed = useProjectStore(s => s.toggleCanvasModifierCollapsed);
  const removeCanvasModifier = useProjectStore(s => s.removeCanvasModifier);
  const beginDrag = useProjectStore(s => s.beginDrag);
  const endDrag = useProjectStore(s => s.endDrag);

  const handleParamChange = useCallback(
    (paramName: string, value: ModifierParamValue) => {
      updateCanvasModifier(trackId, modifier.id, { [paramName]: value });
    },
    [trackId, modifier.id, updateCanvasModifier],
  );

  const handleSliderDragStart = useCallback(() => {
    beginDrag('调整画布修改器参数');
  }, [beginDrag]);

  const handleSliderDragEnd = useCallback(() => {
    endDrag();
  }, [endDrag]);

  return (
    <div
      className={`
        group relative rounded-lg border transition-all duration-150
        ${!modifier.enabled ? 'opacity-50' : ''}
        ${modifier.collapsed ? 'opacity-60' : ''}
        bg-zinc-900/80 border-zinc-800 hover:border-zinc-600
      `}
    >
      {/* Header row */}
      <div className="flex items-center gap-1.5 px-2 py-2">
        {/* Category icon + name */}
        <div
          className={`flex items-center justify-center size-5 rounded ${CANVAS_MODIFIER_BG[modifier.type]} shrink-0`}
        >
          <CanvasModifierIcon
            iconName={def.icon}
            className={`size-3 ${CANVAS_MODIFIER_COLORS[modifier.type]}`}
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
          onCheckedChange={() => toggleCanvasModifier(trackId, modifier.id)}
          className="size-3.5 shrink-0"
        />

        {/* Collapse toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="size-5 p-0 text-zinc-500 hover:text-zinc-300 shrink-0"
          onClick={() => toggleCanvasModifierCollapsed(trackId, modifier.id)}
        >
          {modifier.collapsed ? (
            <ChevronRight className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
        </Button>

        {/* Delete button */}
        <Button
          variant="ghost"
          size="icon"
          className="size-5 p-0 text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={() => removeCanvasModifier(trackId, modifier.id)}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      {/* Parameter controls (hidden when collapsed) */}
      {!modifier.collapsed && (
        <div className="px-2 pb-2 space-y-0.5">
          <Separator className="bg-zinc-800 mb-1.5" />
          {def.params.map((p) => (
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
  );
}

// ---- CanvasModifierTrackBlock ----

function CanvasModifierTrackBlock({ track }: { track: CanvasModifierTrack }) {
  const def = getCanvasModifierDef(track.type);
  // P1: Use individual selectors to avoid re-renders on unrelated store changes
  const removeCanvasModifierTrack = useProjectStore(s => s.removeCanvasModifierTrack);
  const toggleCanvasModifierTrackVisibility = useProjectStore(s => s.toggleCanvasModifierTrackVisibility);
  const toggleCanvasModifierTrackEnabled = useProjectStore(s => s.toggleCanvasModifierTrackEnabled);
  const addCanvasModifier = useProjectStore(s => s.addCanvasModifier);

  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 overflow-hidden">
      {/* Track header */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-zinc-800/50">
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-0.5 hover:bg-white/10 rounded transition-colors shrink-0"
        >
          {collapsed ? (
            <ChevronRight className="size-3 text-zinc-400" />
          ) : (
            <ChevronDown className="size-3 text-zinc-400" />
          )}
        </button>

        {/* Icon */}
        <div
          className={`flex items-center justify-center size-5 rounded ${CANVAS_MODIFIER_BG[track.type]} shrink-0`}
        >
          <CanvasModifierIcon
            iconName={def.icon}
            className={`size-3 ${CANVAS_MODIFIER_COLORS[track.type]}`}
          />
        </div>

        {/* Track name */}
        <span className="text-xs font-medium text-zinc-200 truncate flex-1 min-w-0">
          {track.name}
        </span>

        {/* Modifiers count */}
        <Badge
          variant="secondary"
          className="text-[9px] px-1 py-0 h-4 bg-cyan-500/20 text-cyan-400 border-cyan-500/30 shrink-0"
        >
          {track.modifiers.length}
        </Badge>

        {/* Visibility toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="size-5 p-0 text-zinc-500 hover:text-zinc-300 shrink-0"
          onClick={() => toggleCanvasModifierTrackVisibility(track.id)}
        >
          {track.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
        </Button>

        {/* Enable toggle */}
        <Checkbox
          checked={track.enabled}
          onCheckedChange={() => toggleCanvasModifierTrackEnabled(track.id)}
          className="size-3.5 shrink-0"
        />

        {/* Delete track */}
        <Button
          variant="ghost"
          size="icon"
          className="size-5 p-0 text-zinc-500 hover:text-red-400 shrink-0"
          onClick={() => removeCanvasModifierTrack(track.id)}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      {/* Track content */}
      {!collapsed && (
        <div className="p-2 space-y-1.5">
          {track.modifiers.map((mod) => (
            <CanvasModifierBlock
              key={mod.id}
              modifier={mod}
              trackId={track.id}
            />
          ))}

          {track.modifiers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-4 px-4 text-center">
              <p className="text-[11px] text-zinc-500">暂无效果实例</p>
            </div>
          )}

          {/* Add modifier button */}
          <Button
            variant="outline"
            className="w-full h-6 text-[11px] border-dashed border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
            onClick={() => addCanvasModifier(track.id, track.type)}
          >
            <Plus className="size-3 mr-1" />
            添加{def.label}实例
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- Main CanvasModifierPanel Component ----

export default function CanvasModifierPanel() {
  // P1: Use individual selectors to avoid re-renders on unrelated store changes
  const canvasModifierTracks = useProjectStore(s => s.canvasModifierTracks);
  const addCanvasModifierTrack = useProjectStore(s => s.addCanvasModifierTrack);

  return (
    <div className="flex flex-col h-full bg-zinc-950" style={{ width: 280 }}>
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <h3 className="text-xs font-semibold text-zinc-200 tracking-wide">
          画布效果
        </h3>
        <div className="flex items-center gap-1">
          <Badge
            variant="secondary"
            className="text-[9px] px-1.5 py-0 h-4 bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
          >
            {canvasModifierTracks.length}
          </Badge>
        </div>
      </div>

      {/* Track list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-2">
          {canvasModifierTracks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="size-12 rounded-full bg-cyan-500/10 flex items-center justify-center mb-3">
                <Settings className="size-5 text-cyan-400/50" />
              </div>
              <p className="text-xs text-zinc-400 mb-1">暂无画布效果</p>
              <p className="text-[11px] text-zinc-500">
                添加画布效果以对整个画面进行后处理
              </p>
            </div>
          ) : (
            canvasModifierTracks.map((track) => (
              <CanvasModifierTrackBlock key={track.id} track={track} />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Add canvas modifier footer */}
      <div className="px-2 py-2 border-t border-zinc-800 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="w-full h-7 text-xs border-dashed border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
            >
              <Plus className="size-3 mr-1" />
              添加画布效果
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            className="bg-zinc-900 border-zinc-700 w-52 max-h-72 overflow-y-auto"
          >
            <DropdownMenuLabel className="text-[10px] text-zinc-500 uppercase tracking-wider">
              画布效果类型
            </DropdownMenuLabel>
            {CANVAS_MODIFIER_DEFINITIONS.map((def) => (
              <DropdownMenuItem
                key={def.type}
                className="text-xs text-zinc-200"
                onClick={() => addCanvasModifierTrack(def.type)}
              >
                <CanvasModifierIcon
                  iconName={def.icon}
                  className={`size-3 mr-1.5 ${CANVAS_MODIFIER_COLORS[def.type]}`}
                />
                {def.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
