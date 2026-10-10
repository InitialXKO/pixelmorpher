'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';
import {
  Eye, EyeOff, Lock, Unlock, ChevronDown, ChevronRight, Plus, Circle, Diamond, Palette,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type { Track, Part, EffectTrack, CanvasModifierTrack, Keyframe, EffectType, PuppetNode, PuppetNodeKeyframe } from '@/lib/types';
import { ANIMATION_MODIFIER_TYPES, MODIFIER_DEFINITIONS } from '@/lib/types';
import type { TrackTimelineDisplay } from '@/lib/v15-types';
import { RULER_HEIGHT, TRACK_HEIGHT, SUB_TRACK_HEIGHT, LABEL_WIDTH, EFFECT_CONFIG, CATEGORY_COLOR_MAP, PUPPET_COLOR, TRACK_COLOR_HUES } from './constants';

// ---- Left: Track Labels Column ----
interface TrackLabelsColumnProps {
  tracks: Track[];
  parts: Part[];
  effectTracks: EffectTrack[];
  canvasModifierTracks: CanvasModifierTrack[];
  getKeyframesForPart: (partId: string) => Keyframe[];
  visibleRange: { startIndex: number; endIndex: number };
  rowOffsets: number[];
  rowHeights: number[];
  totalHeight: number;
  getPartName: (partId: string) => string;
  selectedEffectTrackId: string | null;
  onSelectEffectTrack: (id: string | null) => void;
  isPuppetClip: boolean;
  puppetNodes: PuppetNode[];
  labelScrollRef: React.RefObject<HTMLDivElement | null>;
  // V15: Track colors and frame step
  trackTimelineDisplays?: Record<string, TrackTimelineDisplay>;
  trackFrameSteps?: Record<string, number>;
  onUpdateTrackTimelineDisplay?: (trackId: string, updates: Partial<TrackTimelineDisplay>) => void;
  onSetTrackFrameStep?: (trackId: string, step: number) => void;
}

export default function TrackLabelsColumn({
  tracks, parts, effectTracks, canvasModifierTracks, getKeyframesForPart,
  visibleRange, rowOffsets, rowHeights, totalHeight,
  getPartName, selectedEffectTrackId, onSelectEffectTrack,
  isPuppetClip, puppetNodes, labelScrollRef,
  trackTimelineDisplays, trackFrameSteps,
  onUpdateTrackTimelineDisplay, onSetTrackFrameStep,
}: TrackLabelsColumnProps) {
  // Get track color hue
  const getTrackColor = (trackIndex: number, trackId: string): string => {
    const display = trackTimelineDisplays?.[trackId];
    if (display && display.colorHue >= 0) {
      return `hsl(${display.colorHue}, 50%, 45%)`;
    }
    const hue = TRACK_COLOR_HUES[trackIndex % TRACK_COLOR_HUES.length];
    return `hsl(${hue}, 50%, 45%)`;
  };

  // Cycle track color
  const cycleTrackColor = (trackId: string, currentHue: number) => {
    const nextHue = currentHue < 0 ? 0 : (currentHue + 30) % 360;
    onUpdateTrackTimelineDisplay?.(trackId, { colorHue: nextHue });
  };

  return (
    <div className="shrink-0 flex flex-col border-r border-[#1e1e3a]" style={{ width: LABEL_WIDTH }}>
      {/* Ruler label area */}
      <div className="shrink-0 flex items-center px-2 border-b border-[#1e1e2e]" style={{ height: RULER_HEIGHT, background: '#16162a' }}>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider select-none">Tracks</span>
      </div>

      {/* Track labels */}
      <div ref={labelScrollRef} className="flex-1 overflow-y-hidden overflow-x-hidden">
        {tracks.length === 0 && effectTracks.length === 0 && (
          <div className="flex items-center justify-center h-24 text-xs text-gray-600 px-4 text-center">
            No tracks yet. Add a part to create a track.
          </div>
        )}
        {rowOffsets.length > 0 && visibleRange.startIndex > 0 && (
          <div style={{ height: rowOffsets[visibleRange.startIndex] }} />
        )}

        {tracks.map((track, idx) => {
          if (idx < visibleRange.startIndex || idx > visibleRange.endIndex) return null;
          const partName = getPartName(track.partId);
          const part = parts.find((p) => p.id === track.partId);
          const animModifiers = part?.animationModifiers ?? [];
          const trackKeyframes = getKeyframesForPart(track.partId);
          const kfModifierTypes = [...new Set(
            trackKeyframes.flatMap((kf) => kf.modifiers.map((m) => m.type))
          )].filter((t) => !ANIMATION_MODIFIER_TYPES.includes(t));

          const trackColor = getTrackColor(idx, track.id);
          const display = trackTimelineDisplays?.[track.id];
          const frameStep = trackFrameSteps?.[track.partId] ?? 1;
          const colorHue = display?.colorHue ?? -1;

          return (
            <React.Fragment key={track.id}>
              <div
                className="flex items-center gap-1 px-2 border-b border-[#1e1e2e] hover:bg-[#1a1a30] transition-colors"
                style={{ height: TRACK_HEIGHT, background: track.locked ? '#0e0e20' : '#12122a' }}
              >
                {/* V15: Track color indicator */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    cycleTrackColor(track.id, colorHue);
                  }}
                  className="p-0.5 hover:bg-white/10 rounded transition-colors"
                  title="Click to cycle track color"
                >
                  <span className="block size-2.5 rounded-sm" style={{ backgroundColor: trackColor }} />
                </button>
                <button onClick={() => useProjectStore.getState().toggleTrackExpanded(track.id)} className="p-0.5 hover:bg-white/10 rounded transition-colors">
                  {track.expanded ? <ChevronDown className="size-3 text-gray-400" /> : <ChevronRight className="size-3 text-gray-400" />}
                </button>
                <span className="text-xs text-gray-300 truncate flex-1 select-none" title={partName}>{partName}</span>
                {/* V15: Frame step indicator */}
                {frameStep > 1 && (
                  <span className="text-[8px] font-mono text-amber-500/70 select-none px-0.5" title={`Frame step: ${frameStep}`}>
                    x{frameStep}
                  </span>
                )}
                <button onClick={() => useProjectStore.getState().toggleTrackVisibility(track.id)} className="p-0.5 hover:bg-white/10 rounded transition-colors" title={track.visible ? 'Hide track' : 'Show track'}>
                  {track.visible ? <Eye className="size-3 text-gray-400" /> : <EyeOff className="size-3 text-gray-600" />}
                </button>
                <button onClick={() => useProjectStore.getState().toggleTrackLock(track.id)} className="p-0.5 hover:bg-white/10 rounded transition-colors" title={track.locked ? 'Unlock track' : 'Lock track'}>
                  {track.locked ? <Lock className="size-3 text-amber-500" /> : <Unlock className="size-3 text-gray-400" />}
                </button>
              </div>
              {/* Anim modifier sub-labels */}
              {track.expanded && animModifiers.map((mod) => {
                const modDef = MODIFIER_DEFINITIONS.find((d) => d.type === mod.type);
                const modLabel = modDef?.label ?? mod.type;
                const category = modDef?.category ?? 'animation';
                const modColor = CATEGORY_COLOR_MAP[category] ?? '#8b5cf6';
                return (
                  <div key={mod.id} className="flex items-center gap-1 px-2 border-b border-[#1a1a2e]" style={{ height: SUB_TRACK_HEIGHT, background: '#0c0c1e' }}>
                    <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: mod.enabled ? modColor : '#4b5563', opacity: mod.enabled ? 0.8 : 0.4 }} />
                    <span className="text-[10px] truncate flex-1 select-none" style={{ color: mod.enabled ? '#9ca3af' : '#4b5563' }} title={modLabel}>{modLabel}</span>
                  </div>
                );
              })}
              {/* Anim ParamDriver spacers */}
              {track.expanded && animModifiers.map((mod) => {
                const driverCount = mod.paramDrivers?.length ?? 0;
                if (driverCount === 0) return null;
                return <div key={`anim-pd-spacer-${mod.id}`} style={{ height: driverCount * SUB_TRACK_HEIGHT, background: '#0c0c1e' }} />;
              })}
              {/* KF modifier sub-labels */}
              {track.expanded && kfModifierTypes.map((modType) => {
                const modDef = MODIFIER_DEFINITIONS.find((d) => d.type === modType);
                const modLabel = modDef?.label ?? modType;
                const category = modDef?.category ?? 'transform';
                const modColor = CATEGORY_COLOR_MAP[category] ?? '#3b82f6';
                const anyEnabled = trackKeyframes.some((kf) => kf.modifiers.some((m) => m.type === modType && m.enabled));
                const paramKfCount = trackKeyframes.reduce((sum, kf) => {
                  const mod = kf.modifiers.find((m) => m.type === modType);
                  return sum + (mod?.paramKeyframes?.length ?? 0);
                }, 0);
                return (
                  <div key={`kf-mod-${modType}`} className="flex items-center gap-1 px-2 border-b border-[#1a1a2e]" style={{ height: SUB_TRACK_HEIGHT, background: '#0a0a1a' }}>
                    <Diamond className="size-2 shrink-0" style={{ color: anyEnabled ? modColor : '#4b5563', opacity: anyEnabled ? 0.8 : 0.4 }} />
                    <span className="text-[10px] truncate flex-1 select-none" style={{ color: anyEnabled ? '#9ca3af' : '#4b5563' }} title={`${modLabel}${paramKfCount > 0 ? ` (${paramKfCount} keyframes)` : ''}`}>{modLabel}</span>
                    {paramKfCount > 0 && <span className="text-[8px] text-gray-600 select-none">{paramKfCount}k</span>}
                  </div>
                );
              })}
              {/* KF ParamDriver spacers */}
              {track.expanded && kfModifierTypes.map((modType) => {
                const driverCount = trackKeyframes.reduce((sum, kf) => {
                  const mod = kf.modifiers.find((m) => m.type === modType);
                  return sum + (mod?.paramDrivers?.length ?? 0);
                }, 0);
                if (driverCount === 0) return null;
                return <div key={`pd-spacer-${modType}`} style={{ height: driverCount * SUB_TRACK_HEIGHT, background: '#0a0a1a' }} />;
              })}
            </React.Fragment>
          );
        })}

        {/* Effect separator */}
        {effectTracks.length > 0 && (() => {
          const sepIdx = tracks.length;
          if (sepIdx < visibleRange.startIndex || sepIdx > visibleRange.endIndex) return null;
          return (
            <div className="flex items-center px-2 border-b border-[#2a2a4a]" style={{ height: 20, background: '#0c0c1e' }}>
              <span className="text-[9px] text-gray-600 uppercase tracking-widest select-none font-medium">Effects</span>
            </div>
          );
        })()}

        {/* Effect track labels */}
        {effectTracks.map((effectTrack, etIdx) => {
          const rowIdx = tracks.length + (effectTracks.length > 0 ? 1 : 0) + etIdx;
          if (rowIdx < visibleRange.startIndex || rowIdx > visibleRange.endIndex) return null;
          const config = EFFECT_CONFIG[effectTrack.type];
          const isSelected = selectedEffectTrackId === effectTrack.id;
          return (
            <div
              key={effectTrack.id}
              className={`flex items-center gap-1 px-2 border-b border-[#1a1a2e] transition-colors ${isSelected ? 'bg-[#161630]' : 'hover:bg-[#141428]'}`}
              style={{ height: TRACK_HEIGHT, background: isSelected ? '#161630' : '#0f0f24' }}
              onClick={() => onSelectEffectTrack(effectTrack.id)}
            >
              <span style={{ color: config?.color ?? '#a78bfa' }}>{config?.icon ?? <Circle className="size-3" />}</span>
              <span className="text-xs truncate flex-1 select-none" style={{ color: config?.color ?? '#a78bfa' }} title={effectTrack.name}>{effectTrack.name}</span>
              <button onClick={(e) => { e.stopPropagation(); useProjectStore.getState().toggleEffectTrackVisibility(effectTrack.id); }} className="p-0.5 hover:bg-white/10 rounded transition-colors" title={effectTrack.visible ? 'Hide effect track' : 'Show effect track'}>
                {effectTrack.visible ? <Eye className="size-3 text-gray-500" /> : <EyeOff className="size-3 text-gray-600" />}
              </button>
            </div>
          );
        })}

        {/* Add effect track button */}
        {(() => {
          const addIdx = tracks.length + (effectTracks.length > 0 ? 1 : 0) + effectTracks.length;
          if (effectTracks.length === 0) return null;
          if (addIdx < visibleRange.startIndex || addIdx > visibleRange.endIndex) return null;
          return (
            <div className="px-2 py-1 border-b border-[#1a1a2e]" style={{ background: '#0f0f24' }}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full h-6 text-[10px] text-gray-600 hover:text-violet-400 hover:bg-violet-500/10 border border-dashed border-gray-700 hover:border-violet-500/50 rounded">
                    <Plus className="size-3 mr-1" />Add Effect Track
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="bg-[#1a1a2e] border-white/10 w-44">
                  <DropdownMenuLabel className="text-[10px] text-gray-500">Effect Types</DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-white/10" />
                  {Object.entries(EFFECT_CONFIG).map(([type, cfg]) => (
                    <DropdownMenuItem key={type} className="text-xs text-gray-200 cursor-pointer" onClick={() => useProjectStore.getState().addEffectTrack(type as EffectType, cfg.label)}>
                      <span style={{ color: cfg.color }}>{cfg.icon}</span>
                      <span className="ml-2">{cfg.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })()}

        {/* Canvas modifier separator */}
        {canvasModifierTracks.length > 0 && (() => {
          let cmSepIdx = tracks.length + (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
          if (cmSepIdx < visibleRange.startIndex || cmSepIdx > visibleRange.endIndex) return null;
          return (
            <div className="flex items-center px-2 border-b border-[#2a2a4a]" style={{ height: 20, background: '#0c0c1e' }}>
              <span className="text-[9px] text-cyan-500 uppercase tracking-widest select-none font-medium">画布效果</span>
            </div>
          );
        })()}

        {/* Canvas modifier labels */}
        {canvasModifierTracks.map((cmTrack, cmIdx) => {
          let cmRowIdx = tracks.length + (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
          if (canvasModifierTracks.length > 0) cmRowIdx += 1 + cmIdx;
          if (cmRowIdx < visibleRange.startIndex || cmRowIdx > visibleRange.endIndex) return null;
          return (
            <div key={cmTrack.id} className="flex items-center gap-1 px-2 border-b border-[#1a1a2e] hover:bg-[#141428] transition-colors"
              style={{ height: TRACK_HEIGHT, background: cmTrack.enabled ? '#0d0d22' : '#09091a', opacity: cmTrack.enabled ? 1 : 0.5 }}>
              <span className="text-cyan-400"><Circle className="size-3" /></span>
              <span className="text-xs text-cyan-300 truncate flex-1 select-none" title={cmTrack.name}>{cmTrack.name}</span>
              <button onClick={(e) => { e.stopPropagation(); useProjectStore.getState().toggleCanvasModifierTrackVisibility(cmTrack.id); }} className="p-0.5 hover:bg-white/10 rounded transition-colors" title={cmTrack.visible ? '隐藏' : '显示'}>
                {cmTrack.visible ? <Eye className="size-3 text-gray-500" /> : <EyeOff className="size-3 text-gray-600" />}
              </button>
              <button onClick={(e) => { e.stopPropagation(); useProjectStore.getState().toggleCanvasModifierTrackEnabled(cmTrack.id); }} className="p-0.5 hover:bg-white/10 rounded transition-colors" title={cmTrack.enabled ? '禁用' : '启用'}>
                {cmTrack.enabled ? <Unlock className="size-3 text-gray-500" /> : <Lock className="size-3 text-amber-500" />}
              </button>
            </div>
          );
        })}

        {/* Add canvas modifier button */}
        {(() => {
          if (canvasModifierTracks.length === 0) return null;
          let cmAddIdx = tracks.length + (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
          if (canvasModifierTracks.length > 0) cmAddIdx += 1 + canvasModifierTracks.length;
          if (cmAddIdx < visibleRange.startIndex || cmAddIdx > visibleRange.endIndex) return null;
          return (
            <div className="px-2 py-1 border-b border-[#1a1a2e]" style={{ background: '#0d0d22' }}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full h-6 text-[10px] text-gray-600 hover:text-cyan-400 hover:bg-cyan-500/10 border border-dashed border-gray-700 hover:border-cyan-500/50 rounded">
                    <Plus className="size-3 mr-1" />添加画布效果
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="bg-[#1a1a2e] border-white/10 w-44">
                  <DropdownMenuLabel className="text-[10px] text-gray-500">画布效果类型</DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem className="text-xs text-gray-200 cursor-pointer" onClick={() => useProjectStore.getState().addCanvasModifierTrack('outline_emphasis')}><span className="text-amber-400 mr-2">◆</span>轮廓强调</DropdownMenuItem>
                  <DropdownMenuItem className="text-xs text-gray-200 cursor-pointer" onClick={() => useProjectStore.getState().addCanvasModifierTrack('color_lut')}><span className="text-pink-400 mr-2">◆</span>全局颜色查找表</DropdownMenuItem>
                  <DropdownMenuItem className="text-xs text-gray-200 cursor-pointer" onClick={() => useProjectStore.getState().addCanvasModifierTrack('pixel_zoom')}><span className="text-emerald-400 mr-2">◆</span>像素化缩放</DropdownMenuItem>
                  <DropdownMenuItem className="text-xs text-gray-200 cursor-pointer" onClick={() => useProjectStore.getState().addCanvasModifierTrack('bloom')}><span className="text-yellow-400 mr-2">◆</span>辉光/泛光</DropdownMenuItem>
                  <DropdownMenuItem className="text-xs text-gray-200 cursor-pointer" onClick={() => useProjectStore.getState().addCanvasModifierTrack('scanlines')}><span className="text-cyan-400 mr-2">◆</span>扫描线/CRT</DropdownMenuItem>
                  <DropdownMenuItem className="text-xs text-gray-200 cursor-pointer" onClick={() => useProjectStore.getState().addCanvasModifierTrack('canvas_mask')}><span className="text-teal-400 mr-2">◆</span>画布裁剪/遮罩</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })()}

        {/* Puppet Node labels */}
        {isPuppetClip && puppetNodes.length > 0 && (() => (
          <React.Fragment key="puppet-section-labels">
            <div className="flex items-center px-2 border-b border-[#2a2a4a]" style={{ height: 20, background: '#0c0c1e' }}>
              <span className="text-[9px] text-cyan-400 uppercase tracking-widest select-none font-medium">🎭 木偶节点</span>
            </div>
            {puppetNodes.map((node) => (
              <div key={`puppet-label-${node.id}`} className="flex items-center gap-1 px-2 border-b border-[#1a1a2e] hover:bg-[#141428] transition-colors"
                style={{ height: TRACK_HEIGHT, background: '#0e1028' }}>
                <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: node.color || PUPPET_COLOR }} />
                <span className="text-xs text-cyan-300 truncate flex-1 select-none" title={node.name}>{node.name}</span>
              </div>
            ))}
          </React.Fragment>
        ))()}

        {/* Bottom padding */}
        {visibleRange.endIndex < rowOffsets.length - 1 && (
          <div style={{ height: totalHeight - rowOffsets[visibleRange.endIndex] - rowHeights[visibleRange.endIndex] }} />
        )}
      </div>
    </div>
  );
}