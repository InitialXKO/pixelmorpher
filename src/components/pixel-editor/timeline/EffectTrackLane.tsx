'use client';

import React, { useCallback } from 'react';
import type { EffectTrack } from '@/lib/types';
import { EffectKeyframeMarker } from './KeyframeMarker';
import { FRAME_WIDTH as STATIC_FRAME_WIDTH, TRACK_HEIGHT, EFFECT_CONFIG } from './constants';

// ---- Effect Track Lane ----
export default function EffectTrackLane({
  effectTrack,
  totalFrames,
  selectedEffectTrackId,
  onAddEffectKeyframe,
  onDeleteEffectKeyframe,
  onEditEffectKeyframe,
  onSelectEffectTrack,
  frameWidth,
}: {
  effectTrack: EffectTrack;
  totalFrames: number;
  selectedEffectTrackId: string | null;
  onAddEffectKeyframe: (trackId: string, frame: number) => void;
  onDeleteEffectKeyframe: (trackId: string, keyframeId: string) => void;
  onEditEffectKeyframe: (trackId: string, keyframeId: string) => void;
  onSelectEffectTrack: (id: string | null) => void;
  frameWidth?: number;
}) {
  const FRAME_WIDTH = frameWidth ?? STATIC_FRAME_WIDTH;
  const width = totalFrames * FRAME_WIDTH;
  const config = EFFECT_CONFIG[effectTrack.type];
  const isSelected = selectedEffectTrackId === effectTrack.id;

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frame = Math.floor(x / FRAME_WIDTH);
      if (frame >= 0 && frame < totalFrames) {
        onAddEffectKeyframe(effectTrack.id, frame);
      }
    },
    [effectTrack.id, totalFrames, onAddEffectKeyframe]
  );

  return (
    <div
      className="relative border-b border-[#1a1a2e]"
      style={{
        height: TRACK_HEIGHT,
        width,
        minWidth: width,
        background: isSelected ? '#161630' : '#0f0f24',
      }}
      onDoubleClick={handleDoubleClick}
      onClick={() => onSelectEffectTrack(effectTrack.id)}
    >
      <svg
        width={width}
        height={TRACK_HEIGHT}
        className="absolute inset-0 pointer-events-none"
        style={{ minWidth: width }}
      >
        {Array.from({ length: totalFrames }, (_, i) => (
          <line key={i} x1={i * FRAME_WIDTH} y1={0} x2={i * FRAME_WIDTH} y2={TRACK_HEIGHT} stroke="#1a1a2e" strokeWidth={0.5} />
        ))}
        {effectTrack.keyframes.length > 1 &&
          effectTrack.keyframes.slice(0, -1).map((kf, i) => {
            const next = effectTrack.keyframes[i + 1];
            return (
              <line
                key={`efx-interp-${kf.id}`}
                x1={kf.frame * FRAME_WIDTH + FRAME_WIDTH / 2}
                y1={TRACK_HEIGHT / 2}
                x2={next.frame * FRAME_WIDTH + FRAME_WIDTH / 2}
                y2={TRACK_HEIGHT / 2}
                stroke={config ? `${config.color}40` : '#a78bfa40'}
                strokeWidth={2}
              />
            );
          })}
      </svg>

      {effectTrack.keyframes.map((kf) => (
        <EffectKeyframeMarker
          key={kf.id}
          keyframe={kf}
          effectColor={config?.color ?? '#a78bfa'}
          isSelected={isSelected}
          onSelect={() => onSelectEffectTrack(effectTrack.id)}
          onDelete={() => onDeleteEffectKeyframe(effectTrack.id, kf.id)}
          onEditParams={() => onEditEffectKeyframe(effectTrack.id, kf.id)}
          frameWidth={FRAME_WIDTH}
      ))}
    </div>
  );
}
