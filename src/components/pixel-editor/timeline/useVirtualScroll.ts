'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type { Track, EffectTrack, CanvasModifierTrack, Keyframe } from '@/lib/types';
import type { Sprite } from '@/lib/unified-types';
import { ANIMATION_MODIFIER_TYPES } from '@/lib/types';
import { FRAME_WIDTH, TRACK_HEIGHT, SUB_TRACK_HEIGHT } from './constants';

// ---- Virtual Scroll Hook ----
export default function useVirtualScroll(
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
  tracks: Track[],
  sprites: Sprite[],
  effectTracks: EffectTrack[],
  canvasModifierTracks: CanvasModifierTrack[],
  puppetNodes: Array<{ id: string; tracks?: import('@/lib/unified-types').NodeTracks }> = [],
  isPuppetClip: boolean = false,
  showCostumeStateRow: boolean = false,
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

    // Legacy Part tracks removed (Part retired; tracks always empty)

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

    // H4: 木偶行计入总高度，否则播放头红线在木偶区被截断
    // N4: 子轨道行高也要计入（per-keyframe modifiers + param drivers）
    if (isPuppetClip && puppetNodes.length > 0) {
      groups.push({ trackId: '__puppet_sep__', height: 20 });
      for (const node of puppetNodes) {
        // 基础行高
        let height = TRACK_HEIGHT;
        // 子轨道：统计该节点修饰器组轨的 modifier types、paramDrivers 与转面轨
        const modTypes = new Set<string>();
        let paramDriverCount = 0;
        for (const pt of node.tracks?.modifierKeys?.keyframes ?? []) {
          for (const mod of pt.value ?? []) {
            modTypes.add(mod.type);
            paramDriverCount += (mod.paramDrivers ?? []).length;
          }
        }
        const hasFaceTurn = (node.tracks?.faceTurnKeys?.keyframes ?? []).some(
          (pt) => Math.abs(pt.value.yaw) > 1e-6 || Math.abs(pt.value.pitch) > 1e-6,
        );
        height += modTypes.size * SUB_TRACK_HEIGHT;
        height += paramDriverCount * SUB_TRACK_HEIGHT;
        if (hasFaceTurn) height += SUB_TRACK_HEIGHT;
        groups.push({ trackId: `__puppet__${node.id}`, height });
      }
    }

    // 服装/变体状态轨道行（clip 级，排在木偶节点行之后；两列组件按同一位置口径渲染）
    if (isPuppetClip && showCostumeStateRow) {
      groups.push({ trackId: '__costume_state__', height: TRACK_HEIGHT });
    }

    return groups;
  }, [tracks, sprites, effectTracks, canvasModifierTracks, puppetNodes, isPuppetClip, showCostumeStateRow]);

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
