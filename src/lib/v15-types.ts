// ============================================================
// PixelMorpher V15 - Advanced Feature Types
// Visual Magnetic Timeline, Transform Filter Onion Skin,
// Mixed Frame Rate Rhythm Control
// ============================================================

import type { ModifierParamValue, ModifierParamKeyframe, ParamDriver } from './types';

// ============================================================
// V15.1: Visual Magnetic Timeline Types
// ============================================================

/** Timeline zoom level in pixels per frame (1-100) */
export type TimelineZoom = number;

/** Track color assignment for visual distinction in multi-track timelines */
export interface TrackColorConfig {
  trackId: string;
  hue: number;        // 0-360
  saturation: number; // 0-100
  lightness: number;  // 0-100
}

/** Smart snap targets for keyframe dragging */
export type SnapTarget =
  | { type: 'frame_marker'; frame: number }     // Grid frame markers (multiples of 5)
  | { type: 'other_keyframe'; frame: number }   // Other keyframe positions
  | { type: 'segment_boundary'; frame: number } // Segment boundaries / clip start-end
  | { type: 'playhead'; frame: number };        // Current playhead position

/** Snapping configuration */
export interface SnapConfig {
  enabled: boolean;
  /** Snap threshold in pixels */
  threshold: number;
  /** Snap to existing keyframes */
  snapToKeyframes: boolean;
  /** Snap to frame markers (every 5th frame) */
  snapToFrameMarkers: boolean;
  /** Snap to playhead */
  snapToPlayhead: boolean;
  /** Snap to segment boundaries (0, totalFrames/2, totalFrames-1) */
  snapToSegmentBoundaries: boolean;
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  enabled: true,
  threshold: 8,
  snapToKeyframes: true,
  snapToFrameMarkers: true,
  snapToPlayhead: false,
  snapToSegmentBoundaries: true,
};

/** Per-track timeline display settings */
export interface TrackTimelineDisplay {
  /** Track color hue override (0-360, -1 = auto) */
  colorHue: number;
  /** Whether to show thumbnail previews inline */
  showThumbnails: boolean;
  /** Whether to show motion waveform indicators */
  showWaveform: boolean;
  /** The track's frame step (1 = every frame, 2 = every 2nd frame, etc.) */
  frameStep: number;
  /** Per-segment frame step overrides: maps "startFrame-endFrame" to step value */
  segmentSteps: Record<string, number>;
}

/** Create default track display settings */
export function createDefaultTrackTimelineDisplay(colorHue: number): TrackTimelineDisplay {
  return {
    colorHue,
    showThumbnails: true,
    showWaveform: true,
    frameStep: 1,
    segmentSteps: {},
  };
}

// ============================================================
// V15.2: Transform Filter Onion Skin Types
// ============================================================

/** Transform filter modes for onion skin ghost rendering */
export type OnionTransformFilter =
  | 'all'             // Show all transforms (default)
  | 'displacement'    // Show only translation changes
  | 'rotation'        // Show only rotation changes
  | 'stretch';        // Show only scale/stretch changes

/** Per-axis onion skin filter configuration */
export interface OnionTransformFilterConfig {
  filterMode: OnionTransformFilter;
  /** Show displacement ghosts */
  showDisplacement: boolean;
  /** Show rotation ghosts */
  showRotation: boolean;
  /** Show stretch ghosts */
  showStretch: boolean;
}

export const DEFAULT_ONION_FILTER_CONFIG: OnionTransformFilterConfig = {
  filterMode: 'all',
  showDisplacement: true,
  showRotation: true,
  showStretch: true,
};

// ============================================================
// V15.3: Mixed Frame Rate Rhythm Control Types
// ============================================================

/** Per-selection frame step override */
export interface SelectionFrameStep {
  id: string;
  /** Track IDs the selection applies to (empty = all tracks) */
  trackIds: string[];
  /** Start frame of the selection */
  startFrame: number;
  /** End frame of the selection */
  endFrame: number;
  /** Frame step to use for this selection range */
  frameStep: number;
}

// ============================================================
// V15.4: Onion Skin with Transform Filter Controls
// ============================================================

/** Extended onion skin state with transform filtering */
export interface OnionSkinState {
  enabled: boolean;
  frames: number;
  /** Transform filter mode */
  transformFilter: OnionTransformFilter;
  /** Whether displacement ghosts are visible */
  showDisplacement: boolean;
  /** Whether rotation ghosts are visible */
  showRotation: boolean;
  /** Whether stretch ghosts are visible */
  showStretch: boolean;
  /** Displacement-only tint color (hex) */
  displacementColor: string;
  /** Rotation-only tint color (hex) */
  rotationColor: string;
  /** Stretch-only tint color (hex) */
  stretchColor: string;
}

export const DEFAULT_ONION_SKIN_STATE: OnionSkinState = {
  enabled: false,
  frames: 2,
  transformFilter: 'all',
  showDisplacement: true,
  showRotation: true,
  showStretch: true,
  displacementColor: 'rgba(60,120,255,0.3)',
  rotationColor: 'rgba(255,120,40,0.3)',
  stretchColor: 'rgba(40,255,120,0.3)',
};

// ============================================================
// V15.5: Segment Frame Step on Keyframes
// ============================================================

/** Extended keyframe data for segment frame step */
export interface SegmentFrameStepData {
  /** Frame step for the segment FROM this keyframe TO the next keyframe */
  frameStep?: number;
}

/** Helper: parse segment key from start-end pair */
export function segmentKey(startFrame: number, endFrame: number): string {
  return `${startFrame}-${endFrame}`;
}