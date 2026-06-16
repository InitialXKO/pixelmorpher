'use client';

import React, { useCallback, useRef, useMemo } from 'react';
import type { Track, Part, EffectTrack, CanvasModifierTrack, Keyframe, PuppetNode, PuppetNodeKeyframe } from '@/lib/types';
import { ANIMATION_MODIFIER_TYPES } from '@/lib/types';
import type { SnapConfig, TrackTimelineDisplay } from '@/lib/v15-types';
import { getFrameWidth, TRACK_HEIGHT, RULER_HEIGHT, TRACK_COLOR_HUES } from './constants';
import FrameRuler from './FrameRuler';
import TrackLane from './TrackLane';
import ModifierSubTrackLane from './ModifierSubTrackLane';
import { AnimModifierParamDriverSubTrackLane, ParamDriverSubTrackLane } from './ParamDriverSubTrackLane';
import KeyframeModifierSubTrackLane from './KeyframeModifierSubTrackLane';
import EffectTrackLane from './EffectTrackLane';
import CanvasModifierTrackLane from './CanvasModifierTrackLane';
import PuppetNodeTrackLane from './PuppetNodeTrackLane';
import { useProjectStore } from '@/lib/store';

// ---- Right: Ruler + Keyframe Lanes (scrollable) ----
interface TrackLanesColumnProps {
  tracks: Track[];
  parts: Part[];
  effectTracks: EffectTrack[];
  canvasModifierTracks: CanvasModifierTrack[];
  getKeyframesForPart: (partId: string) => Keyframe[];
  totalFrames: number;
  currentFrame: number;
  selectedKeyframeId: string | null;
  selectedEffectTrackId: string | null;
  visibleRange: { startIndex: number; endIndex: number };
  rowOffsets: number[];
  rowHeights: number[];
  totalHeight: number;
  timelineWidth: number;
  playheadX: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  playheadLineRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onRulerClick: (frame: number) => void;
  onSelectKeyframe: (id: string) => void;
  onSelectEffectTrack: (id: string | null) => void;
  onAddKeyframe: (partId: string, frame: number) => void;
  onDeleteKeyframe: (id: string) => void;
  onDuplicateKeyframe: (id: string) => void;
  onMoveKeyframeToFrame: (id: string) => void;
  onUpdateKeyframe: (id: string, updates: Partial<Keyframe>) => void;
  onAddEffectKeyframe: (trackId: string, frame: number) => void;
  onDeleteEffectKeyframe: (trackId: string, keyframeId: string) => void;
  onEditEffectKeyframe: (trackId: string, keyframeId: string) => void;
  onEditAnimModifierParams: (partId: string, modifierId: string) => void;
  onEditKfModifierParams: (keyframeId: string, modifierId: string) => void;
  onEditParamKeyframe: (keyframeId: string, modifierId: string, paramKfId: string) => void;
  onAddModifierParamKeyframe: (keyframeId: string, modifierId: string, frame: number) => void;
  onEditParamDriver: (keyframeId: string, modifierId: string, driverId: string) => void;
  onEditAnimParamDriver: (partId: string, modifierId: string, driverId: string) => void;
  onPlayheadMouseDown: (e: React.MouseEvent) => void;
  isPuppetClip: boolean;
  puppetNodes: PuppetNode[];
  puppetNodeKeyframes: PuppetNodeKeyframe[];
  selectedPuppetKeyframeId: string | null;
  onSelectPuppetKeyframe: (id: string) => void;
  onAddPuppetKeyframe: (nodeId: string, frame: number) => void;
  onDeletePuppetKeyframe: (keyframeId: string) => void;
  onMovePuppetKeyframeToFrame: (keyframeId: string) => void;
  onUpdatePuppetKeyframe: (keyframeId: string, updates: Partial<PuppetNodeKeyframe>) => void;
  // V15: Dynamic zoom, snap, colors, thumbnails, frame step
  FRAME_WIDTH?: number;
  snapConfig?: SnapConfig;
  snapFrame?: (rawFrame: number, excludeKeyframeId?: string) => number;
  trackTimelineDisplays?: Record<string, TrackTimelineDisplay>;
  getEffectiveFrameStep?: (trackId: string, frame: number) => number;
  timelineThumbnailQuality?: 'off' | 'low' | 'medium' | 'high';
}

export default function TrackLanesColumn({
  tracks, parts, effectTracks, canvasModifierTracks, getKeyframesForPart,
  totalFrames, currentFrame, selectedKeyframeId, selectedEffectTrackId,
  visibleRange, rowOffsets, rowHeights, totalHeight, timelineWidth, playheadX,
  scrollContainerRef, playheadLineRef,
  onScroll, onRulerClick, onSelectKeyframe, onSelectEffectTrack,
  onAddKeyframe, onDeleteKeyframe, onDuplicateKeyframe, onMoveKeyframeToFrame, onUpdateKeyframe,
  onAddEffectKeyframe, onDeleteEffectKeyframe, onEditEffectKeyframe,
  onEditAnimModifierParams, onEditKfModifierParams, onEditParamKeyframe,
  onAddModifierParamKeyframe, onEditParamDriver, onEditAnimParamDriver,
  onPlayheadMouseDown,
  isPuppetClip, puppetNodes, puppetNodeKeyframes, selectedPuppetKeyframeId,
  onSelectPuppetKeyframe, onAddPuppetKeyframe, onDeletePuppetKeyframe,
  onMovePuppetKeyframeToFrame, onUpdatePuppetKeyframe,
  // V15
  FRAME_WIDTH: propFrameWidth,
  snapConfig, snapFrame,
  trackTimelineDisplays, getEffectiveFrameStep, timelineThumbnailQuality,
}: TrackLanesColumnProps) {
  const timelineZoom = useProjectStore((s) => s.timelineZoom);
  const fw = propFrameWidth ?? getFrameWidth(timelineZoom);
  const rulerWidth = totalFrames * fw;

  // Get track color hue based on index
  const getTrackColor = useCallback((trackIndex: number, trackId: string): string => {
    const display = trackTimelineDisplays?.[trackId];
    if (display && display.colorHue >= 0) {
      return `hsl(${display.colorHue}, 50%, 45%)`;
    }
    const hue = TRACK_COLOR_HUES[trackIndex % TRACK_COLOR_HUES.length];
    return `hsl(${hue}, 50%, 45%)`;
  }, [trackTimelineDisplays]);

  return (
    <div className="flex-1 overflow-hidden flex flex-col relative">
      {/* Ruler row (fixed) */}
      <div className="shrink-0 overflow-hidden border-b border-[#1e1e3a]" style={{ height: RULER_HEIGHT }}>
        <FrameRuler totalFrames={totalFrames} currentFrame={currentFrame} onRulerClick={onRulerClick} timelineZoom={timelineZoom} />
      </div>

      {/* Track lanes (scrollable) */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto relative"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#3a3a5a #0d0d1f' }}
        onScroll={onScroll}
        onClick={() => { onSelectKeyframe(''); onSelectEffectTrack(null); }}
      >
        <div style={{ width: rulerWidth, minWidth: rulerWidth, height: totalHeight, position: 'relative' }}>
          {tracks.length === 0 && effectTracks.length === 0 && (
            <div className="flex items-center justify-center h-32 text-xs text-gray-600">
              Double-click on a track lane to add a keyframe
            </div>
          )}
          {rowOffsets.length > 0 && visibleRange.startIndex > 0 && (
            <div style={{ height: rowOffsets[visibleRange.startIndex] }} />
          )}

          {tracks.map((track, idx) => {
            if (idx < visibleRange.startIndex || idx > visibleRange.endIndex) return null;
            const trackKeyframes = getKeyframesForPart(track.partId);
            const part = parts.find((p) => p.id === track.partId);
            const animModifiers = part?.animationModifiers ?? [];
            const kfModifierTypes = [...new Set(
              trackKeyframes.flatMap((kf) => kf.modifiers.map((m) => m.type))
            )].filter((t) => !ANIMATION_MODIFIER_TYPES.includes(t));

            const trackColor = getTrackColor(idx, track.id);
            const display = trackTimelineDisplays?.[track.id];
            const showThumbnails = display?.showThumbnails ?? true;
            const effectiveStep = getEffectiveFrameStep ? getEffectiveFrameStep(track.partId, currentFrame) : 1;

            return (
              <React.Fragment key={track.id}>
                <TrackLane
                  track={track} keyframes={trackKeyframes} selectedKeyframeId={selectedKeyframeId}
                  totalFrames={totalFrames} onSelectKeyframe={onSelectKeyframe} onAddKeyframe={onAddKeyframe}
                  onDeleteKeyframe={onDeleteKeyframe} onDuplicateKeyframe={onDuplicateKeyframe}
                  onMoveKeyframeToFrame={onMoveKeyframeToFrame} onUpdateKeyframe={onUpdateKeyframe}
                  // V15 props
                  frameWidth={fw}
                  trackColor={trackColor}
                  snapConfig={snapConfig}
                  snapFrame={snapFrame}
                  showThumbnail={showThumbnails}
                  timelineThumbnailQuality={timelineThumbnailQuality}
                  part={part}
                  frameStep={effectiveStep}
                />
                {track.expanded && animModifiers.map((mod) => (
                  <ModifierSubTrackLane key={mod.id} modifier={mod} totalFrames={totalFrames} partId={track.partId} onEditParams={onEditAnimModifierParams} frameWidth={fw} />
                ))}
                {track.expanded && animModifiers.map((mod) => (
                  <AnimModifierParamDriverSubTrackLane key={`anim-pd-${mod.id}`} modifier={mod} partId={track.partId} totalFrames={totalFrames} onEditAnimParamDriver={onEditAnimParamDriver} frameWidth={fw} />
                ))}
                {track.expanded && kfModifierTypes.map((modType) => (
                  <KeyframeModifierSubTrackLane
                    key={`kf-mod-${modType}`} modifierType={modType} partKeyframes={trackKeyframes}
                    totalFrames={totalFrames} onAddParamKeyframe={onAddModifierParamKeyframe}
                    onEditModifierParams={onEditKfModifierParams} onEditParamKeyframe={onEditParamKeyframe}
                    frameWidth={fw}
                  />
                ))}
                {track.expanded && kfModifierTypes.map((modType) => (
                  <ParamDriverSubTrackLane
                    key={`pd-${modType}`} modifierType={modType} partKeyframes={trackKeyframes}
                    totalFrames={totalFrames} onEditParamDriver={onEditParamDriver}
                    frameWidth={fw}
                  />
                ))}
              </React.Fragment>
            );
          })}

          {/* Effect tracks separator */}
          {effectTracks.length > 0 && (() => {
            const sepIdx = tracks.length;
            if (sepIdx < visibleRange.startIndex || sepIdx > visibleRange.endIndex) return null;
            return <div className="border-b border-[#2a2a4a]" style={{ height: 20, background: '#0c0c1e' }} />;
          })()}

          {/* Effect track lanes */}
          {effectTracks.map((effectTrack, etIdx) => {
            const rowIdx = tracks.length + (effectTracks.length > 0 ? 1 : 0) + etIdx;
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
            const addIdx = tracks.length + 1 + effectTracks.length;
            if (addIdx < visibleRange.startIndex || addIdx > visibleRange.endIndex) return null;
            return <div style={{ height: TRACK_HEIGHT + 4, background: '#0f0f24' }} />;
          })()}

          {/* Canvas modifier separator */}
          {canvasModifierTracks.length > 0 && (() => {
            let cmSepIdx = tracks.length + (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
            if (cmSepIdx < visibleRange.startIndex || cmSepIdx > visibleRange.endIndex) return null;
            return <div className="border-b border-[#2a2a4a]" style={{ height: 20, background: '#0c0c1e' }} />;
          })()}

          {/* Canvas modifier track lanes */}
          {canvasModifierTracks.map((cmTrack, cmIdx) => {
            let cmRowIdx = tracks.length + (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
            if (canvasModifierTracks.length > 0) cmRowIdx += 1 + cmIdx;
            if (cmRowIdx < visibleRange.startIndex || cmRowIdx > visibleRange.endIndex) return null;
            return <CanvasModifierTrackLane key={cmTrack.id} track={cmTrack} totalFrames={totalFrames} currentFrame={currentFrame} frameWidth={fw} />;
          })}

          {/* Canvas modifier add spacer */}
          {(() => {
            if (canvasModifierTracks.length === 0) return null;
            let cmAddIdx = tracks.length + (effectTracks.length > 0 ? 1 + effectTracks.length + 1 : 0);
            if (canvasModifierTracks.length > 0) cmAddIdx += 1 + canvasModifierTracks.length;
            if (cmAddIdx < visibleRange.startIndex || cmAddIdx > visibleRange.endIndex) return null;
            return <div style={{ height: TRACK_HEIGHT + 4, background: '#0d0d22' }} />;
          })()}

          {/* Puppet Node Track Lanes */}
          {isPuppetClip && puppetNodes.length > 0 && (
            <>
              <div className="border-b border-[#2a2a4a]" style={{ height: 20, background: '#0c0c1e' }} />
              {puppetNodes.map((node) => {
                const nodeKfs = puppetNodeKeyframes.filter((kf) => kf.nodeId === node.id);
                return (
                  <PuppetNodeTrackLane
                    key={`puppet-lane-${node.id}`} node={node} nodeKeyframes={nodeKfs}
                    selectedPuppetKeyframeId={selectedPuppetKeyframeId} totalFrames={totalFrames}
                    onSelectPuppetKeyframe={onSelectPuppetKeyframe} onAddPuppetKeyframe={onAddPuppetKeyframe}
                    onDeletePuppetKeyframe={onDeletePuppetKeyframe} onMovePuppetKeyframeToFrame={onMovePuppetKeyframeToFrame}
                    onUpdatePuppetKeyframe={onUpdatePuppetKeyframe}
                    frameWidth={fw}
                  />
                );
              })}
            </>
          )}

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