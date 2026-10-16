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
  Eye, EyeOff, Lock, Unlock, Plus, Circle,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type { EffectTrack, CanvasModifierTrack, EffectType } from '@/lib/types';
import type { TrackTimelineDisplay } from '@/lib/v15-types';
import { RULER_HEIGHT, TRACK_HEIGHT, LABEL_WIDTH, EFFECT_CONFIG, PUPPET_COLOR } from './constants';

// ---- Left: Track Labels Column ----
interface TrackLabelsColumnProps {
  effectTracks: EffectTrack[];
  canvasModifierTracks: CanvasModifierTrack[];
  visibleRange: { startIndex: number; endIndex: number };
  rowOffsets: number[];
  rowHeights: number[];
  totalHeight: number;
  selectedEffectTrackId: string | null;
  onSelectEffectTrack: (id: string | null) => void;
  isPuppetClip: boolean;
  nodeList: import("@/lib/unified-types").Node[];
  labelScrollRef: React.RefObject<HTMLDivElement | null>;
  // V15: Track colors and frame step
  trackTimelineDisplays?: Record<string, TrackTimelineDisplay>;
  trackFrameSteps?: Record<string, number>;
  onUpdateTrackTimelineDisplay?: (trackId: string, updates: Partial<TrackTimelineDisplay>) => void;
  onSetTrackFrameStep?: (trackId: string, step: number) => void;
}

export default function TrackLabelsColumn({
  effectTracks, canvasModifierTracks,
  visibleRange, rowOffsets, rowHeights, totalHeight,
  selectedEffectTrackId, onSelectEffectTrack,
  isPuppetClip, nodeList, labelScrollRef,
  trackTimelineDisplays, trackFrameSteps,
  onUpdateTrackTimelineDisplay, onSetTrackFrameStep,
}: TrackLabelsColumnProps) {

  return (
    <div className="shrink-0 flex flex-col border-r border-[#1e1e3a]" style={{ width: LABEL_WIDTH }}>
      {/* Ruler label area */}
      <div className="shrink-0 flex items-center px-2 border-b border-[#1e1e2e]" style={{ height: RULER_HEIGHT, background: '#16162a' }}>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider select-none">Tracks</span>
      </div>

      {/* Track labels */}
      <div ref={labelScrollRef} className="flex-1 overflow-y-hidden overflow-x-hidden">
        {effectTracks.length === 0 && nodeList.length === 0 && (
          <div className="flex items-center justify-center h-24 text-xs text-gray-600 px-4 text-center">
            暂无轨道
          </div>
        )}
        {rowOffsets.length > 0 && visibleRange.startIndex > 0 && (
          <div style={{ height: rowOffsets[visibleRange.startIndex] }} />
        )}

        {/* Effect separator */}
        {effectTracks.length > 0 && (() => {
          const sepIdx = 0;
          if (sepIdx < visibleRange.startIndex || sepIdx > visibleRange.endIndex) return null;
          return (
            <div className="flex items-center px-2 border-b border-[#2a2a4a]" style={{ height: 20, background: '#0c0c1e' }}>
              <span className="text-[9px] text-gray-600 uppercase tracking-widest select-none font-medium">Effects</span>
            </div>
          );
        })()}

        {/* Effect track labels */}
        {effectTracks.map((effectTrack, etIdx) => {
          const rowIdx = (effectTracks.length > 0 ? 1 : 0) + etIdx;
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
              <span className="text-xs truncate flex-1 min-w-0 select-none" style={{ color: config?.color ?? '#a78bfa' }} title={effectTrack.name}>{effectTrack.name}</span>
              <button onClick={(e) => { e.stopPropagation(); useProjectStore.getState().toggleEffectTrackVisibility(effectTrack.id); }} className="p-0.5 hover:bg-white/10 rounded transition-colors" title={effectTrack.visible ? 'Hide effect track' : 'Show effect track'}>
                {effectTrack.visible ? <Eye className="size-3 text-gray-500" /> : <EyeOff className="size-3 text-gray-600" />}
              </button>
            </div>
          );
        })}

        {/* Add effect track button */}
        {(() => {
          const addIdx = (effectTracks.length > 0 ? 1 : 0) + effectTracks.length;
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
          let cmSepIdx = (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
          if (cmSepIdx < visibleRange.startIndex || cmSepIdx > visibleRange.endIndex) return null;
          return (
            <div className="flex items-center px-2 border-b border-[#2a2a4a]" style={{ height: 20, background: '#0c0c1e' }}>
              <span className="text-[9px] text-cyan-500 uppercase tracking-widest select-none font-medium">画布效果</span>
            </div>
          );
        })()}

        {/* Canvas modifier labels */}
        {canvasModifierTracks.map((cmTrack, cmIdx) => {
          let cmRowIdx = (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
          if (canvasModifierTracks.length > 0) cmRowIdx += 1 + cmIdx;
          if (cmRowIdx < visibleRange.startIndex || cmRowIdx > visibleRange.endIndex) return null;
          return (
            <div key={cmTrack.id} className="flex items-center gap-1 px-2 border-b border-[#1a1a2e] hover:bg-[#141428] transition-colors"
              style={{ height: TRACK_HEIGHT, background: cmTrack.enabled ? '#0d0d22' : '#09091a', opacity: cmTrack.enabled ? 1 : 0.5 }}>
              <span className="text-cyan-400"><Circle className="size-3" /></span>
              <span className="text-xs text-cyan-300 truncate flex-1 min-w-0 select-none" title={cmTrack.name}>{cmTrack.name}</span>
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
          let cmAddIdx = (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
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
        {isPuppetClip && nodeList.length > 0 && (() => {
          let puppetSepIdx = (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
          if (canvasModifierTracks.length > 0) puppetSepIdx += 1 + canvasModifierTracks.length + 1;
          if (puppetSepIdx < visibleRange.startIndex || puppetSepIdx > visibleRange.endIndex) return null;
          return (
          <React.Fragment key="puppet-section-labels">
            <div className="flex items-center px-2 border-b border-[#2a2a4a]" style={{ height: 20, background: '#0c0c1e' }}>
              <span className="text-[9px] text-cyan-400 uppercase tracking-widest select-none font-medium">🎭 木偶节点</span>
            </div>
            {nodeList.map((node, nodeIdx) => {
              const rowIdx = puppetSepIdx + 1 + nodeIdx;
              if (rowIdx < visibleRange.startIndex || rowIdx > visibleRange.endIndex) return null;
              return (
              <div key={`node-label-${node.id}`} className="flex items-center gap-1 px-2 border-b border-[#1a1a2e] hover:bg-[#141428] transition-colors"
                style={{ height: TRACK_HEIGHT, background: '#0e1028' }}>
                <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: node.attachment?.discColor || PUPPET_COLOR }} />
                <span className="text-xs text-cyan-300 truncate flex-1 min-w-0 select-none" title={node.name}>{node.name}</span>
              </div>
              );
            })}
          </React.Fragment>
          );
        })()}

        {/* Bottom padding */}
        {visibleRange.endIndex < rowOffsets.length - 1 && (
          <div style={{ height: totalHeight - rowOffsets[visibleRange.endIndex] - rowHeights[visibleRange.endIndex] }} />
        )}
      </div>
    </div>
  );
}