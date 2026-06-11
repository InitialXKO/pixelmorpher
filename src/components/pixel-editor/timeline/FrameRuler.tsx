'use client';

import React from 'react';
import { FRAME_WIDTH, RULER_HEIGHT } from './constants';

// ---- Frame Ruler ----
export default function FrameRuler({
  totalFrames,
  currentFrame,
  onRulerClick,
}: {
  totalFrames: number;
  currentFrame: number;
  onRulerClick: (frame: number) => void;
}) {
  const width = totalFrames * FRAME_WIDTH;

  return (
    <svg
      width={width}
      height={RULER_HEIGHT}
      className="block"
      style={{ minWidth: width }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const frame = Math.floor(x / FRAME_WIDTH);
        onRulerClick(Math.max(0, Math.min(frame, totalFrames - 1)));
      }}
    >
      {/* Background */}
      <rect width={width} height={RULER_HEIGHT} fill="#16162a" />

      {/* Current frame highlight */}
      <rect
        x={currentFrame * FRAME_WIDTH}
        y={0}
        width={FRAME_WIDTH}
        height={RULER_HEIGHT}
        fill="rgba(239, 68, 68, 0.15)"
      />

      {/* Tick marks and frame numbers */}
      {Array.from({ length: totalFrames }, (_, i) => {
        const x = i * FRAME_WIDTH;
        const isMajor = i % 5 === 0;
        return (
          <g key={i}>
            <line
              x1={x}
              y1={isMajor ? 4 : RULER_HEIGHT - 6}
              x2={x}
              y2={RULER_HEIGHT}
              stroke={isMajor ? '#6b7280' : '#3f3f5a'}
              strokeWidth={isMajor ? 1 : 0.5}
            />
            {isMajor && (
              <text
                x={x + 2}
                y={13}
                fill="#9ca3af"
                fontSize={9}
                fontFamily="monospace"
              >
                {i}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
