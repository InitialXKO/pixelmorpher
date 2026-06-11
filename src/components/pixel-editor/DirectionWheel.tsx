'use client';

import React, { useCallback } from 'react';
import type { DirectionIndex } from '@/lib/unified-types';
import { DIRECTION_NAMES } from '@/lib/unified-types';
import { Label } from '@/components/ui/label';

// ---- Props Interface ----

interface DirectionWheelProps {
  value: DirectionIndex;                          // Current direction (0-7)
  onChange: (dir: DirectionIndex) => void;        // Direction change callback
  latitude?: number;                              // Optional latitude (0-90)
  onLatitudeChange?: (lat: number) => void;       // Optional latitude change callback
  size?: 'sm' | 'md';                            // Component size variant
  showLabels?: boolean;                           // Show Chinese labels on hover
  disabled?: boolean;                             // Disable all interactions
}

// ---- Direction ↔ Old PuppetDirection Helpers ----

/** Mapping from unified DirectionIndex to old PuppetDirection string */
const DIRECTION_INDEX_TO_OLD: Record<DirectionIndex, string> = {
  0: 'E',
  1: 'NE',
  2: 'N',
  3: 'NW',
  4: 'W',
  5: 'SW',
  6: 'S',
  7: 'SE',
} as const;

/** Mapping from old PuppetDirection string to unified DirectionIndex */
const OLD_DIRECTION_TO_INDEX: Record<string, DirectionIndex> = {
  'E': 0,
  'NE': 1,
  'N': 2,
  'NW': 3,
  'W': 4,
  'SW': 5,
  'S': 6,
  'SE': 7,
} as const;

/**
 * Convert a unified DirectionIndex to the old PuppetDirection string.
 * Useful for backward compatibility with the legacy PuppetPanel system.
 */
export function directionIndexToOldDirection(idx: DirectionIndex): string {
  return DIRECTION_INDEX_TO_OLD[idx];
}

/**
 * Convert an old PuppetDirection string to a unified DirectionIndex.
 * Returns 0 (East) as default if the direction string is not recognized.
 */
export function oldDirectionToIndex(dir: string): DirectionIndex {
  return OLD_DIRECTION_TO_INDEX[dir] ?? 0;
}

// ---- Chinese Direction Labels ----

const DIRECTION_CHINESE: Record<DirectionIndex, string> = {
  0: '东',
  1: '东北',
  2: '北',
  3: '西北',
  4: '西',
  5: '西南',
  6: '南',
  7: '东南',
} as const;

// ---- Compass Layout ----

/**
 * Grid positions for the 3×3 compass layout.
 * Index maps to DirectionIndex, position is {row, col} in the 3×3 grid.
 * The center cell (row=1, col=1) is decorative.
 */
const COMPASS_POSITIONS: { dir: DirectionIndex; row: number; col: number }[] = [
  { dir: 3, row: 0, col: 0 },  // NW
  { dir: 2, row: 0, col: 1 },  // N
  { dir: 1, row: 0, col: 2 },  // NE
  { dir: 4, row: 1, col: 0 },  // W
  { dir: 0, row: 1, col: 2 },  // E
  { dir: 5, row: 2, col: 0 },  // SW
  { dir: 6, row: 2, col: 1 },  // S
  { dir: 7, row: 2, col: 2 },  // SE
];

// ---- Component ----

function DirectionWheel({
  value,
  onChange,
  latitude,
  onLatitudeChange,
  size = 'sm',
  showLabels = true,
  disabled = false,
}: DirectionWheelProps) {
  const isMedium = size === 'md';
  const buttonSize = isMedium ? 'size-8' : 'size-7';
  const textSize = isMedium ? 'text-[9px]' : 'text-[8px]';
  const showLatitude = latitude !== undefined && onLatitudeChange !== undefined;

  const handleClick = useCallback(
    (dir: DirectionIndex) => {
      if (!disabled) {
        onChange(dir);
      }
    },
    [disabled, onChange]
  );

  const handleLatitudeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!disabled && onLatitudeChange) {
        onLatitudeChange(Number(e.target.value));
      }
    },
    [disabled, onLatitudeChange]
  );

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Compass wheel */}
      <div className="grid grid-cols-3 gap-0.5 w-fit">
        {Array.from({ length: 9 }, (_, i) => {
          const row = Math.floor(i / 3);
          const col = i % 3;

          // Center cell — decorative dot showing current direction abbreviation
          if (row === 1 && col === 1) {
            return (
              <div
                key="center"
                className={`${buttonSize} flex items-center justify-center rounded bg-[#0a0a1e] border border-[#1e1e3a]`}
              >
                <span className={`${textSize} font-bold text-cyan-500/60 select-none`}>
                  {DIRECTION_NAMES[value].charAt(0)}
                </span>
              </div>
            );
          }

          // Direction button
          const pos = COMPASS_POSITIONS.find((p) => p.row === row && p.col === col);
          if (!pos) return null;

          const { dir } = pos;
          const isActive = value === dir;
          const abbreviation = DIRECTION_NAMES[dir];

          return (
            <button
              key={dir}
              type="button"
              className={`${buttonSize} rounded font-medium transition-colors ${
                isActive
                  ? 'bg-cyan-500/30 text-cyan-400 border border-cyan-500/40'
                  : 'bg-[#111128] text-gray-500 hover:bg-[#1a1a3a] border border-transparent'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              onClick={() => handleClick(dir)}
              disabled={disabled}
              title={showLabels ? DIRECTION_CHINESE[dir] : abbreviation}
            >
              <span className={`${textSize} leading-none`}>{abbreviation}</span>
            </button>
          );
        })}
      </div>

      {/* Active direction label */}
      {showLabels && (
        <div className="text-[9px] text-cyan-400/70 text-center select-none">
          {DIRECTION_CHINESE[value]} ({DIRECTION_NAMES[value]})
        </div>
      )}

      {/* Latitude slider */}
      {showLatitude && (
        <div className="flex items-center gap-2 w-full">
          <Label className="text-[9px] text-gray-600 w-8 shrink-0">纬度</Label>
          <input
            type="range"
            min={0}
            max={90}
            value={latitude}
            onChange={handleLatitudeChange}
            className="flex-1 h-1 accent-cyan-500"
            disabled={disabled}
          />
          <span className="text-[9px] text-gray-500 w-6 text-right shrink-0">
            {latitude}°
          </span>
        </div>
      )}
    </div>
  );
}

export default DirectionWheel;
