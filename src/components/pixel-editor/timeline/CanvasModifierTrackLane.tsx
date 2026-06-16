'use client';

import React from 'react';
import type { CanvasModifierTrack } from '@/lib/types';
import { FRAME_WIDTH as STATIC_FRAME_WIDTH, TRACK_HEIGHT, EFFECT_KEYFRAME_SIZE } from './constants';

// ---- Canvas Modifier Track Lane ----
export default function CanvasModifierTrackLane({
  track,
  totalFrames,
  currentFrame,
  frameWidth,
}: {
  track: CanvasModifierTrack;
  totalFrames: number;
  currentFrame: number;
  frameWidth?: number;
}) {
  const FRAME_WIDTH = frameWidth ?? STATIC_FRAME_WIDTH;
  const width = totalFrames * FRAME_WIDTH;

  return (
    <div
      className="relative border-b border-[#1a1a2e]"
      style={{
        height: TRACK_HEIGHT,
        width,
        minWidth: width,
        background: track.enabled ? '#0d0d22' : '#09091a',
        opacity: track.enabled ? 1 : 0.5,
      }}
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
        {track.keyframes.map((kf) => {
          const left = kf.frame * FRAME_WIDTH + FRAME_WIDTH / 2;
          return (
            <g key={kf.id}>
              <circle cx={left} cy={TRACK_HEIGHT / 2} r={EFFECT_KEYFRAME_SIZE / 2} fill="#22d3ee" stroke="#06b6d4" strokeWidth={1} opacity={0.8} />
            </g>
          );
        })}
      </svg>
      <div
        className="absolute top-0 bottom-0 w-px bg-cyan-400/30 pointer-events-none"
        style={{ left: currentFrame * FRAME_WIDTH + FRAME_WIDTH / 2 }}
      />
      <div className="absolute left-1 top-1/2 -translate-y-1/2 pointer-events-none">
        <span className="text-[9px] text-cyan-500/50 font-mono select-none">
          {track.type.replace('_', ' ')}
        </span>
      </div>
    </div>
  );
}
