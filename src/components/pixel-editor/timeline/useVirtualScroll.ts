'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type { Track, Part, EffectTrack, CanvasModifierTrack, Keyframe } from '@/lib/types';
import { ANIMATION_MODIFIER_TYPES } from '@/lib/types';
import { FRAME_WIDTH, TRACK_HEIGHT, SUB_TRACK_HEIGHT } from './constants';

// ---- Virtual Scroll Hook ----
export default function useVirtualScroll(
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
  tracks: Track[],
  parts: Part[],
  effectTracks: EffectTrack[],
  canvasModifierTracks: CanvasModifierTrack[],
  getKeyframesForPart: (partId: string) => Keyframe[],
): {
  visibleRange: { startIndex: number; endIndex: number };
  rowOffsets: number[];
  rowHeights: number[];
  totalHeight: number;
  onScroll: () => void;
} {
  // Compute a flat list of row groups
  const rowGroups = useMemo(() => {
    const groups: { trackId: string; height: number }[] = [];

    for (const track of tracks) {
      const part = parts.find((p) => p.id === track.partId);
      const animModifiers = part?.animationModifiers ?? [];
      const trackKeyframes = getKeyframesForPart(track.partId);
      const kfModifierTypes = [...new Set(
        trackKeyframes.flatMap((kf) => kf.modifiers.map((m) => m.type))
      )].filter((t) => !ANIMATION_MODIFIER_TYPES.includes(t));

      let height = TRACK_HEIGHT;
      if (track.expanded) {
        height += animModifiers.length * SUB_TRACK_HEIGHT;
        for (const mod of animModifiers) {
          height += (mod.paramDrivers?.length ?? 0) * SUB_TRACK_HEIGHT;
        }
        height += kfModifierTypes.length * SUB_TRACK_HEIGHT;
        for (const modType of kfModifierTypes) {
          const driverCount = trackKeyframes.reduce((sum, kf) => {
            const mod = kf.modifiers.find((m) => m.type === modType);
            return sum + (mod?.paramDrivers?.length ?? 0);
          }, 0);
          height += driverCount * SUB_TRACK_HEIGHT;
        }
      }
      groups.push({ trackId: track.id, height });
    }

    if (effectTracks.length > 0) {
      groups.push({ trackId: '__effect_sep__', height: 20 });
    }

    for (const et of effectTracks) {
      groups.push({ trackId: `__effect__${et.id}`, height: TRACK_HEIGHT });
    }

    if (effectTracks.length > 0) {
      groups.push({ trackId: '__effect_add__', height: TRACK_HEIGHT + 4 });
    }

    if (canvasModifierTracks.length > 0) {
      groups.push({ trackId: '__canvas_mod_sep__', height: 20 });
    }

    for (const cm of canvasModifierTracks) {
      groups.push({ trackId: `__canvas_mod__${cm.id}`, height: TRACK_HEIGHT });
    }

    if (canvasModifierTracks.length > 0) {
      groups.push({ trackId: '__canvas_mod_add__', height: TRACK_HEIGHT + 4 });
    }

    return groups;
  }, [tracks, parts, effectTracks, canvasModifierTracks, getKeyframesForPart]);

  const { rowOffsets, rowHeights, totalHeight } = useMemo(() => {
    const offsets: number[] = [];
    const heights: number[] = [];
    let y = 0;
    for (const group of rowGroups) {
      offsets.push(y);
      heights.push(group.height);
      y += group.height;
    }
    return { rowOffsets: offsets, rowHeights: heights, totalHeight: y };
  }, [rowGroups]);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  const onScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    setScrollTop(container.scrollTop);
    setViewportHeight(container.clientHeight);
  }, [scrollContainerRef]);

  const BUFFER = 200;
  const visibleRange = useMemo(() => {
    const viewTop = scrollTop - BUFFER;
    const viewBottom = scrollTop + viewportHeight + BUFFER;

    let startIndex = 0;
    let endIndex = rowGroups.length - 1;

    let lo = 0, hi = rowGroups.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const rowBottom = rowOffsets[mid] + rowHeights[mid];
      if (rowBottom < viewTop) { lo = mid + 1; } else { hi = mid - 1; }
    }
    startIndex = Math.max(0, lo);

    lo = startIndex;
    hi = rowGroups.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rowOffsets[mid] > viewBottom) { hi = mid - 1; } else { lo = mid + 1; }
    }
    endIndex = Math.min(rowGroups.length - 1, hi);

    return { startIndex, endIndex };
  }, [scrollTop, viewportHeight, rowOffsets, rowHeights, rowGroups.length]);

  return { visibleRange, rowOffsets, rowHeights, totalHeight, onScroll };
}
