import React from 'react';
import { Sun, Sparkles, Ghost, Waves, Wind } from 'lucide-react';
import type { EffectType } from '@/lib/types';

// ---- Layout Constants ----
export const FRAME_WIDTH = 24;
export const TRACK_HEIGHT = 32;
export const SUB_TRACK_HEIGHT = 22;
export const RULER_HEIGHT = 24;
export const LABEL_WIDTH = 180;
export const KEYFRAME_SIZE = 10;
export const EFFECT_KEYFRAME_SIZE = 8;
export const PUPPET_KEYFRAME_SIZE = 10;
export const PUPPET_COLOR = '#06b6d4'; // teal/cyan for puppet keyframes

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
