'use client';

import React, { useCallback } from 'react';
import type { Track, Keyframe } from '@/lib/types';
import KeyframeMarker from './KeyframeMarker';
import { FRAME_WIDTH, TRACK_HEIGHT } from './constants';

// ---- Track Lane ----
const TrackLane = React.memo(function TrackLane({
  track,
  keyframes,
  selectedKeyframeId,
  totalFrames,
  onSelectKeyframe,
  onAddKeyframe,
  onDeleteKeyframe,
  onDuplicateKeyframe,
  onMoveKeyframeToFrame,
  onUpdateKeyframe,
}: {
  track: Track;
  keyframes: Keyframe[];
  selectedKeyframeId: string | null;
  totalFrames: number;
  onSelectKeyframe: (id: string) => void;
  onAddKeyframe: (partId: string, frame: number) => void;
  onDeleteKeyframe: (id: string) => void;
  onDuplicateKeyframe: (id: string) => void;
  onMoveKeyframeToFrame: (id: string) => void;
  onUpdateKeyframe: (id: string, updates: Partial<Keyframe>) => void;
}) {
  const width = totalFrames * FRAME_WIDTH;

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (track.locked) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frame = Math.floor(x / FRAME_WIDTH);
      if (frame >= 0 && frame < totalFrames) {
        onAddKeyframe(track.partId, frame);
      }
    },
    [track.partId, track.locked, totalFrames, onAddKeyframe]
  );

  return (
    <div
      data-track-lane
      className="relative border-b border-[#1e1e2e]"
      style={{
        height: TRACK_HEIGHT,
        width,
        minWidth: width,
        backgroundImage: `
          repeating-linear-gradient(
            90deg,
            #1e1e2e 0px,
            #1e1e2e 0.5px,
            transparent 0.5px,
            transparent ${FRAME_WIDTH}px
          )
        `,
        backgroundSize: `${FRAME_WIDTH}px ${TRACK_HEIGHT}px`,
        background: track.locked ? '#0e0e20' : '#12122a',
        backgroundBlendMode: 'normal',
      }}
      onDoubleClick={handleDoubleClick}
      onClick={() => onSelectKeyframe('')}
    >
      {/* B5: Grid lines via CSS repeating-linear-gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            repeating-linear-gradient(
              90deg,
              rgba(30, 30, 46, 0.8) 0px,
              rgba(30, 30, 46, 0.8) 0.5px,
              transparent 0.5px,
              transparent ${FRAME_WIDTH}px
            )
          `,
          backgroundSize: `${FRAME_WIDTH}px ${TRACK_HEIGHT}px`,
        }}
      />

      {/* Interpolation lines between consecutive keyframes */}
      {keyframes.length > 1 && (
        <svg
          width={width}
          height={TRACK_HEIGHT}
          className="absolute inset-0 pointer-events-none"
          style={{ minWidth: width }}
        >
          {keyframes.slice(0, -1).map((kf, i) => {
            const next = keyframes[i + 1];
            return (
              <line
                key={`interp-${kf.id}`}
                x1={kf.frame * FRAME_WIDTH + FRAME_WIDTH / 2}
                y1={TRACK_HEIGHT / 2}
                x2={next.frame * FRAME_WIDTH + FRAME_WIDTH / 2}
                y2={TRACK_HEIGHT / 2}
                stroke="#f59e0b40"
                strokeWidth={2}
              />
            );
          })}
        </svg>
      )}

      {/* Keyframe markers (HTML overlays for context menu support) */}
      {keyframes.map((kf) => (
        <KeyframeMarker
          key={kf.id}
          keyframe={kf}
          isSelected={selectedKeyframeId === kf.id}
          onSelect={() => onSelectKeyframe(kf.id)}
          onDelete={() => onDeleteKeyframe(kf.id)}
          onDuplicate={() => onDuplicateKeyframe(kf.id)}
          onMoveToFrame={() => onMoveKeyframeToFrame(kf.id)}
          totalFrames={totalFrames}
          siblingKeyframes={keyframes}
          onUpdateKeyframe={onUpdateKeyframe}
        />
      ))}
    </div>
  );
}, (prevProps, nextProps) => {
  if (prevProps.track.id !== nextProps.track.id) return false;
  if (prevProps.track.locked !== nextProps.track.locked) return false;
  if (prevProps.track.visible !== nextProps.track.visible) return false;
  if (prevProps.keyframes !== nextProps.keyframes) return false;
  if (prevProps.selectedKeyframeId !== nextProps.selectedKeyframeId) return false;
  if (prevProps.totalFrames !== nextProps.totalFrames) return false;
  return true;
});

export default TrackLane;
