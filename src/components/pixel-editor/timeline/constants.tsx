import React from 'react';
import { Sun, Sparkles, Ghost, Waves, Wind } from 'lucide-react';
import type { EffectType } from '@/lib/types';

// ---- Layout Constants ----
export const DEFAULT_FRAME_WIDTH = 24;
export const FRAME_WIDTH = DEFAULT_FRAME_WIDTH; // Backward compat, use getFrameWidth(zoom) for dynamic
export const TRACK_HEIGHT = 32;
export const SUB_TRACK_HEIGHT = 22;
export const RULER_HEIGHT = 24;
export const LABEL_WIDTH = 180;
export const KEYFRAME_SIZE = 10;
export const EFFECT_KEYFRAME_SIZE = 8;
export const PUPPET_KEYFRAME_SIZE = 10;
export const PUPPET_COLOR = '#06b6d4'; // teal/cyan for puppet keyframes

/** Dynamic frame width from timeline zoom */
export function getFrameWidth(zoom: number): number {
  return Math.max(1, Math.min(100, zoom));
}

/** Minimum keyframe hit area for drag operations */
export const MIN_KEYFRAME_HIT_AREA = 6;

/** Snap threshold in pixels for smart snapping */
export const SNAP_PIXEL_THRESHOLD = 8;

/** Default track colors for multi-track display (hue values) */
export const TRACK_COLOR_HUES = [
  45,   // amber/gold
  190,  // teal/cyan
  330,  // pink
  270,  // violet
  160,  // emerald
  20,   // orange
  210,  // blue
  0,    // red
  120,  // green
  300,  // magenta
];

// ---- Effect Type Icons & Colors ----
export const EFFECT_CONFIG: Record<EffectType, { icon: React.ReactNode; color: string; label: string }> = {
  glow: { icon: <Sun className="size-3" />, color: '#fbbf24', label: '光晕' },
  particle: { icon: <Sparkles className="size-3" />, color: '#f97316', label: '粒子' },
  afterimage: { icon: <Ghost className="size-3" />, color: '#a78bfa', label: '残影' },
  pixel_displace: { icon: <Waves className="size-3" />, color: '#34d399', label: '像素置换' },
  motion_blur: { icon: <Wind className="size-3" />, color: '#22d3ee', label: '运动模糊' },
};

// ---- Color maps ----
export const CATEGORY_COLOR_MAP: Record<string, string> = {
  animation: '#8b5cf6',
  transform: '#3b82f6',
  color: '#ec4899',
  effect: '#f59e0b',
  pixel: '#10b981',
};
