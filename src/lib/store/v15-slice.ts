// ============================================================
// PixelMorpher V15 - Advanced Features Slice
// Visual Magnetic Timeline, Transform Filter Onion Skin,
// Mixed Frame Rate Rhythm Control
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import {
  DEFAULT_SNAP_CONFIG,
  DEFAULT_ONION_FILTER_CONFIG,
  DEFAULT_ONION_SKIN_STATE,
  segmentKey,
} from '../v15-types';
import type {
  TimelineZoom, SnapConfig, TrackTimelineDisplay,
  OnionTransformFilterConfig, OnionSkinState,
  SelectionFrameStep,
} from '../v15-types';

export type V15Slice = {
  // V15.1: Visual Magnetic Timeline
  timelineZoom: TimelineZoom;
  snapConfig: SnapConfig;
  trackTimelineDisplays: Record<string, TrackTimelineDisplay>;
  timelineThumbnailQuality: 'off' | 'low' | 'medium' | 'high';
  setTimelineZoom: (zoom: TimelineZoom) => void;
  updateSnapConfig: (updates: Partial<SnapConfig>) => void;
  updateTrackTimelineDisplay: (trackId: string, updates: Partial<TrackTimelineDisplay>) => void;
  setTimelineThumbnailQuality: (quality: 'off' | 'low' | 'medium' | 'high') => void;

  // V15.2: Transform Filter Onion Skin
  onionTransformFilter: OnionTransformFilterConfig;
  onionSkinState: OnionSkinState;
  updateOnionTransformFilter: (updates: Partial<OnionTransformFilterConfig>) => void;
  updateOnionSkinState: (updates: Partial<OnionSkinState>) => void;

  // V15.3: Mixed Frame Rate Rhythm Control
  trackFrameSteps: Record<string, number>;
  trackSegmentSteps: Record<string, Record<string, number>>;
  selectionFrameSteps: SelectionFrameStep[];
  setTrackFrameStep: (trackId: string, step: number) => void;
  setTrackSegmentStep: (trackId: string, segmentKey: string, step: number) => void;
  addSelectionFrameStep: (selection: SelectionFrameStep) => void;
  removeSelectionFrameStep: (id: string) => void;
  updateSelectionFrameStep: (id: string, updates: Partial<SelectionFrameStep>) => void;
  getEffectiveFrameStep: (trackId: string, frame: number) => number;
};

export const createV15Slice: StateCreator<ProjectStore, [], [], V15Slice> = (set, get) => ({
  // ---- V15.1: Visual Magnetic Timeline ----
  timelineZoom: 24, // Default 24px per frame (matches FRAME_WIDTH in constants)
  snapConfig: { ...DEFAULT_SNAP_CONFIG },
  trackTimelineDisplays: {},
  timelineThumbnailQuality: 'medium',

  setTimelineZoom: (zoom) => {
    const clamped = Math.max(1, Math.min(100, zoom));
    set({ timelineZoom: clamped });
  },

  updateSnapConfig: (updates) => {
    set((s) => ({
      snapConfig: { ...s.snapConfig, ...updates },
    }));
  },

  updateTrackTimelineDisplay: (trackId, updates) => {
    set((s) => ({
      trackTimelineDisplays: {
        ...s.trackTimelineDisplays,
        [trackId]: {
          ...(s.trackTimelineDisplays[trackId] ?? { colorHue: -1, showThumbnails: true, showWaveform: true, frameStep: 1, segmentSteps: {} }),
          ...updates,
        },
      },
    }));
  },

  setTimelineThumbnailQuality: (quality) => {
    set({ timelineThumbnailQuality: quality });
  },

  // ---- V15.2: Transform Filter Onion Skin ----
  onionTransformFilter: { ...DEFAULT_ONION_FILTER_CONFIG },
  onionSkinState: { ...DEFAULT_ONION_SKIN_STATE },

  updateOnionTransformFilter: (updates) => {
    set((s) => ({
      onionTransformFilter: { ...s.onionTransformFilter, ...updates },
    }));
  },

  updateOnionSkinState: (updates) => {
    set((s) => ({
      onionSkinState: { ...s.onionSkinState, ...updates },
    }));
  },

  // ---- V15.3: Mixed Frame Rate Rhythm Control ----
  trackFrameSteps: {},
  trackSegmentSteps: {},
  selectionFrameSteps: [],

  setTrackFrameStep: (trackId, step) => {
    const clamped = Math.max(1, Math.min(60, Math.round(step)));
    set((s) => ({
      trackFrameSteps: { ...s.trackFrameSteps, [trackId]: clamped },
    }));
  },

  setTrackSegmentStep: (trackId, segKey, step) => {
    const clamped = Math.max(1, Math.min(60, Math.round(step)));
    set((s) => ({
      trackSegmentSteps: {
        ...s.trackSegmentSteps,
        [trackId]: {
          ...(s.trackSegmentSteps[trackId] ?? {}),
          [segKey]: clamped,
        },
      },
    }));
  },

  addSelectionFrameStep: (selection) => {
    set((s) => ({
      selectionFrameSteps: [...s.selectionFrameSteps, selection],
    }));
  },

  removeSelectionFrameStep: (id) => {
    set((s) => ({
      selectionFrameSteps: s.selectionFrameSteps.filter((sf) => sf.id !== id),
    }));
  },

  updateSelectionFrameStep: (id, updates) => {
    set((s) => ({
      selectionFrameSteps: s.selectionFrameSteps.map((sf) =>
        sf.id === id ? { ...sf, ...updates } : sf
      ),
    }));
  },

  getEffectiveFrameStep: (trackId, frame) => {
    const state = get();

    // 1. Check selection frame steps (highest priority)
    for (const sf of state.selectionFrameSteps) {
      if (frame >= sf.startFrame && frame <= sf.endFrame) {
        if (sf.trackIds.length === 0 || sf.trackIds.includes(trackId)) {
          return sf.frameStep;
        }
      }
    }

    // 2. Check per-segment steps
    const trackSegments = state.trackSegmentSteps[trackId];
    if (trackSegments) {
      // Find matching segment
      for (const [segKey, step] of Object.entries(trackSegments)) {
        const [startStr, endStr] = segKey.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (frame >= start && frame <= end) {
          return step;
        }
      }
    }

    // 3. Check per-track step (middle priority)
    if (state.trackFrameSteps[trackId]) {
      return state.trackFrameSteps[trackId];
    }

    // 4. Default: every frame
    return 1;
  },
});