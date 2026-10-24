'use client';

import React, { useRef } from 'react';
import type { EffectTrack, CanvasModifierTrack } from '@/lib/types';
import type { Node } from '@/lib/unified-types';
import type { SnapConfig, TrackTimelineDisplay } from '@/lib/v15-types';
import { getFrameWidth, TRACK_HEIGHT, RULER_HEIGHT } from './constants';
import FrameRuler from './FrameRuler';
import EffectTrackLane from './EffectTrackLane';
import CanvasModifierTrackLane from './CanvasModifierTrackLane';
import NodeTrackLane from './NodeTrackLane';
import { useProjectStore } from '@/lib/store';

// ---- Right: Ruler + Keyframe Lanes (scrollable) ----
interface TrackLanesColumnProps {
  effectTracks: EffectTrack[];
  canvasModifierTracks: CanvasModifierTrack[];
  totalFrames: number;
  currentFrame: number;
  selectedEffectTrackId: string | null;
  visibleRange: { startIndex: number; endIndex: number };
  rowOffsets: number[];
  rowHeights: number[];
  totalHeight: number;
  timelineWidth: number;
  playheadX: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  rulerScrollRef: React.RefObject<HTMLDivElement | null>;
  rulerHighlightRef: React.RefObject<SVGRectElement | null>;
  playheadLineRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onRulerClick: (frame: number) => void;
  onSelectEffectTrack: (id: string | null) => void;
  onAddEffectKeyframe: (trackId: string, frame: number) => void;
  onDeleteEffectKeyframe: (trackId: string, keyframeId: string) => void;
  onEditEffectKeyframe: (trackId: string, keyframeId: string) => void;
  onPlayheadMouseDown: (e: React.MouseEvent) => void;
  isPuppetClip: boolean;
  nodeList: Node[];
  /** 木偶节点所属角色 id（轨道数据的所有者） */
  characterId: string | null;
  /** 激活片段的时间窗（节点行上的可视标记） */
  clipWindow?: { startFrame: number; endFrame: number } | null;
  selectedNodeKeyframeId: string | null;
  onSelectNodeKeyframe: (id: string) => void;
  onAddNodeKeyframe: (nodeId: string, frame: number) => void;
  onDeleteNodeKeyframe: (keyId: string) => void;
  onDuplicateNodeKeyframe: (keyId: string) => void;
  onMoveNodeKeyframeToFrame: (keyId: string) => void;
  onUpdateNodeKeyframe: (keyId: string, updates: { frame?: number }) => void;
  onEditModifierParams?: (nodeId: string, frame: number, modifierId: string) => void;
  onEditParamDriver?: (nodeId: string, frame: number, modifierId: string, driverId: string) => void;
  // V15: Dynamic zoom, snap, colors, thumbnails, frame step
  FRAME_WIDTH?: number;
  snapConfig?: SnapConfig;
  snapFrame?: (rawFrame: number, excludeKeyframeId?: string) => number;
  trackTimelineDisplays?: Record<string, TrackTimelineDisplay>;
  getEffectiveFrameStep?: (trackId: string, frame: number) => number;
  timelineThumbnailQuality?: 'off' | 'low' | 'medium' | 'high';
  /** 服装/变体状态轨道（clip 级，排在木偶节点行之后） */
  costumeState?: {
    keyframes: import('@/lib/unified-types').CostumeStateKeyframe[];
    selectedFrame: number | null;
    onSelectKeyframe: (frame: number | null) => void;
  } | null;
}

export default function TrackLanesColumn({
  effectTracks, canvasModifierTracks,
  totalFrames, currentFrame, selectedEffectTrackId,
  visibleRange, rowOffsets, rowHeights, totalHeight, timelineWidth, playheadX,
  scrollContainerRef, rulerScrollRef, rulerHighlightRef, playheadLineRef,
  onScroll, onRulerClick, onSelectEffectTrack,
  onAddEffectKeyframe, onDeleteEffectKeyframe, onEditEffectKeyframe,
  onPlayheadMouseDown,
  isPuppetClip, nodeList, characterId, clipWindow, selectedNodeKeyframeId,
  onSelectNodeKeyframe, onAddNodeKeyframe, onDeleteNodeKeyframe, onDuplicateNodeKeyframe,
  onMoveNodeKeyframeToFrame, onUpdateNodeKeyframe, onEditModifierParams, onEditParamDriver,
  // V15
  FRAME_WIDTH: propFrameWidth,
  snapConfig, snapFrame,
  trackTimelineDisplays, getEffectiveFrameStep, timelineThumbnailQuality,
  costumeState,
}: TrackLanesColumnProps) {
  const timelineZoom = useProjectStore((s) => s.timelineZoom);
  const fw = propFrameWidth ?? getFrameWidth(timelineZoom);
  const rulerWidth = totalFrames * fw;

  return (
    <div className="flex-1 overflow-hidden flex flex-col relative">
      {/* Ruler row (fixed) */}
      <div ref={rulerScrollRef} className="shrink-0 overflow-hidden border-b border-[#1e1e3a]" style={{ height: RULER_HEIGHT }}>
        <FrameRuler totalFrames={totalFrames} currentFrame={currentFrame} onRulerClick={onRulerClick} timelineZoom={timelineZoom} highlightRef={rulerHighlightRef} />
      </div>

      {/* Track lanes (scrollable) */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto relative"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#3a3a5a #0d0d1f' }}
        onScroll={onScroll}
        onClick={() => { onSelectEffectTrack(null); }}
      >
        <div style={{ width: rulerWidth, minWidth: rulerWidth, height: totalHeight, position: 'relative' }}>
          {effectTracks.length === 0 && nodeList.length === 0 && (
            <div className="flex items-center justify-center h-32 text-xs text-gray-600">
              Double-click on a track lane to add a keyframe
            </div>
          )}
          {rowOffsets.length > 0 && visibleRange.startIndex > 0 && (
            <div style={{ height: rowOffsets[visibleRange.startIndex] }} />
          )}

          {/* Effect tracks separator */}
          {effectTracks.length > 0 && (() => {
            const sepIdx = 0;
            if (sepIdx < visibleRange.startIndex || sepIdx > visibleRange.endIndex) return null;
            return <div className="border-b border-[#2a2a4a]" style={{ height: 20, background: '#0c0c1e' }} />;
          })()}

          {/* Effect track lanes */}
          {effectTracks.map((effectTrack, etIdx) => {
            const rowIdx = (effectTracks.length > 0 ? 1 : 0) + etIdx;
            if (rowIdx < visibleRange.startIndex || rowIdx > visibleRange.endIndex) return null;
            return (
              <EffectTrackLane
                key={effectTrack.id} effectTrack={effectTrack} totalFrames={totalFrames}
                selectedEffectTrackId={selectedEffectTrackId}
                onAddEffectKeyframe={onAddEffectKeyframe} onDeleteEffectKeyframe={onDeleteEffectKeyframe}
                onEditEffectKeyframe={onEditEffectKeyframe} onSelectEffectTrack={onSelectEffectTrack}
                frameWidth={fw}
              />
            );
          })}

          {/* Effect add spacer */}
          {(() => {
            if (effectTracks.length === 0) return null;
            const addIdx = 1 + effectTracks.length;
            if (addIdx < visibleRange.startIndex || addIdx > visibleRange.endIndex) return null;
            return <div style={{ height: TRACK_HEIGHT + 4, background: '#0f0f24' }} />;
          })()}

          {/* Canvas modifier separator */}
          {canvasModifierTracks.length > 0 && (() => {
            const cmSepIdx = (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
            if (cmSepIdx < visibleRange.startIndex || cmSepIdx > visibleRange.endIndex) return null;
            return <div className="border-b border-[#2a2a4a]" style={{ height: 20, background: '#0c0c1e' }} />;
          })()}

          {/* Canvas modifier track lanes */}
          {canvasModifierTracks.map((cmTrack, cmIdx) => {
            let cmRowIdx = (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
            if (canvasModifierTracks.length > 0) cmRowIdx += 1 + cmIdx;
            if (cmRowIdx < visibleRange.startIndex || cmRowIdx > visibleRange.endIndex) return null;
            return <CanvasModifierTrackLane key={cmTrack.id} track={cmTrack} totalFrames={totalFrames} currentFrame={currentFrame} frameWidth={fw} />;
          })}

          {/* Canvas modifier add spacer */}
          {(() => {
            if (canvasModifierTracks.length === 0) return null;
            let cmAddIdx = (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
            if (canvasModifierTracks.length > 0) cmAddIdx += 1 + canvasModifierTracks.length;
            if (cmAddIdx < visibleRange.startIndex || cmAddIdx > visibleRange.endIndex) return null;
            return <div style={{ height: TRACK_HEIGHT + 4, background: '#0d0d22' }} />;
          })()}

          {/* Puppet Node Track Lanes */}
          {isPuppetClip && nodeList.length > 0 && (() => {
            // 计算 puppet 分隔符的行索引（effect + canvasModifier 之后）
            let puppetSepIdx = (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
            if (canvasModifierTracks.length > 0) puppetSepIdx += 1 + canvasModifierTracks.length + 1;
            if (puppetSepIdx < visibleRange.startIndex || puppetSepIdx > visibleRange.endIndex) return null;
            return (
              <>
                <div className="border-b border-[#2a2a4a]" style={{ height: 20, background: '#0c0c1e' }} />
                {nodeList.map((node, nodeIdx) => {
                  const rowIdx = puppetSepIdx + 1 + nodeIdx;
                  if (rowIdx < visibleRange.startIndex || rowIdx > visibleRange.endIndex) return null;
                  return (
                    <NodeTrackLane
                      key={`node-lane-${node.id}`} node={node} characterId={characterId ?? ''}
                      selectedNodeKeyframeId={selectedNodeKeyframeId} totalFrames={totalFrames}
                      clipWindow={clipWindow}
                      onSelectNodeKeyframe={onSelectNodeKeyframe} onAddNodeKeyframe={onAddNodeKeyframe}
                      onDeleteNodeKeyframe={onDeleteNodeKeyframe} onDuplicateNodeKeyframe={onDuplicateNodeKeyframe} onMoveNodeKeyframeToFrame={onMoveNodeKeyframeToFrame}
                      onUpdateNodeKeyframe={onUpdateNodeKeyframe}
                      onEditModifierParams={onEditModifierParams}
                      onEditParamDriver={onEditParamDriver}
                      frameWidth={fw}
                      snapConfig={snapConfig}
                      snapFrame={snapFrame}
                    />
                  );
                })}
              </>
            );
          })()}

          {/* 服装/变体状态轨道（clip 级，木偶节点行之后；行索引与 useVirtualScroll 的 __costume_state__ 对齐） */}
          {costumeState && isPuppetClip && nodeList.length > 0 && (() => {
            let puppetSepIdx = (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
            if (canvasModifierTracks.length > 0) puppetSepIdx += 1 + canvasModifierTracks.length + 1;
            const rowIdx = puppetSepIdx + 1 + nodeList.length;
            if (rowIdx < visibleRange.startIndex || rowIdx > visibleRange.endIndex) return null;
            const describe = (k: import('@/lib/unified-types').CostumeStateKeyframe) => {
              const parts: string[] = [`帧 ${k.frame}`];
              if (k.costumeSetId) parts.push('换服装集');
              if (k.slotChanges) {
                for (const [slot, v] of Object.entries(k.slotChanges)) {
                  parts.push(`${slot} → ${v === null ? '基础' : '变体'}`);
                }
              }
              return parts.join(' · ');
            };
            return (
              <div className="relative border-b border-[#1a1a2e]" style={{ height: TRACK_HEIGHT, background: '#14102a' }}>
                {costumeState.keyframes.map((k) => {
                  const selected = costumeState.selectedFrame === k.frame;
                  return (
                    <button
                      key={k.frame}
                      title={describe(k)}
                      onClick={(e) => {
                        e.stopPropagation();
                        costumeState.onSelectKeyframe(selected ? null : k.frame);
                      }}
                      className={`absolute top-1/2 size-2.5 rotate-45 border ${
                        selected
                          ? 'bg-purple-200 border-white'
                          : 'bg-purple-400 border-purple-200/60 hover:bg-purple-300'
                      }`}
                      style={{ left: k.frame * fw + fw / 2, transform: 'translate(-50%, -50%) rotate(45deg)' }}
                    />
                  );
                })}
              </div>
            );
          })()}

          {/* Bottom padding */}
          {visibleRange.endIndex < rowOffsets.length - 1 && (
            <div style={{ height: totalHeight - rowOffsets[visibleRange.endIndex] - rowHeights[visibleRange.endIndex] }} />
          )}
        </div>

        {/* Playhead overlay */}
        <div
          ref={playheadLineRef}
          className="absolute top-0 bottom-0 pointer-events-none z-30"
          style={{ left: playheadX - 1, width: 2 }}
        >
          <div className="w-0.5 h-full" style={{ background: '#ef4444' }} />
          <div
            className="absolute -top-0.5 -left-[5px] pointer-events-auto cursor-col-resize"
            style={{ width: 12, height: 10 }}
            onMouseDown={onPlayheadMouseDown}
          >
            <svg width={12} height={10} viewBox="0 0 12 10">
              <polygon points="1,0 11,0 11,3 6,9 1,3" fill="#ef4444" stroke="#ff6b6b" strokeWidth={0.5} />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}