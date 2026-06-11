'use client';

import React from 'react';
import type { BrushPreset } from '@/lib/types';

// ---- Brush Preset Thumbnail ----
export default function BrushPresetThumbnail({ preset }: { preset: BrushPreset }) {
  const rows = preset.shape.length;
  const cols = preset.shape[0]?.length ?? 0;
  const cellSize = Math.max(1, Math.min(3, Math.floor(16 / Math.max(rows, cols))));
  return (
    <div
      className="shrink-0 rounded border border-white/10"
      style={{
        width: cols * cellSize,
        height: rows * cellSize,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
        gap: 0,
        overflow: 'hidden',
      }}
    >
      {preset.shape.flatMap((row, r) =>
        row.map((on, c) => (
          <div
            key={`${r}-${c}`}
            style={{
              width: cellSize,
              height: cellSize,
              backgroundColor: on ? '#a78bfa' : 'transparent',
            }}
          />
        ))
      )}
    </div>
  );
}
