'use client';

import React, { useMemo } from 'react';
import { RULER_HEIGHT } from './constants';
import { getFrameWidth } from './constants';
import { useProjectStore } from '@/lib/store';

// ---- Frame Ruler with dynamic zoom ----
export default function FrameRuler({
  totalFrames,
  currentFrame,
  onRulerClick,
  timelineZoom,
}: {
  totalFrames: number;
  currentFrame: number;
  onRulerClick: (frame: number) => void;
  timelineZoom?: number;
}) {
  const zoom = useProjectStore((s) => s.timelineZoom);
  const effectiveZoom = timelineZoom ?? zoom;
  const FRAME_WIDTH = getFrameWidth(effectiveZoom);
  const width = totalFrames * FRAME_WIDTH;

  // Determine tick interval based on zoom level
  // At low zoom (1-8px/frame): show every 10th, 20th, 50th frame
  // At medium zoom (8-24px/frame): show every 5th frame
  // At high zoom (24-100px/frame): show every frame
  const majorTickInterval = useMemo(() => {
    if (FRAME_WIDTH < 4) return 20;
    if (FRAME_WIDTH < 8) return 10;
    if (FRAME_WIDTH < 16) return 5;
    return 5; // Keep 5 as standard, label every 5th
  }, [FRAME_WIDTH]);

  const showAllLabels = FRAME_WIDTH >= 16;
  const labelInterval = showAllLabels ? 5 : majorTickInterval;

  return (
    <svg
      width={width}
      height={RULER_HEIGHT}
      className="block shrink-0"
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
        const isMajor = i % majorTickInterval === 0;
        const isMinor = i % 5 === 0;
        // Show a tick if major, minor, or zoomed in enough
        const shouldShowTick = isMajor || isMinor || FRAME_WIDTH >= 10;
        if (!shouldShowTick) return null;
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
            {/* Show label for major ticks or when zoomed in enough */}
            {(i % labelInterval === 0) && (
              <text
                x={x + 2}
                y={13}
                fill="#9ca3af"
                fontSize={Math.max(7, Math.min(10, FRAME_WIDTH * 0.4))}
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