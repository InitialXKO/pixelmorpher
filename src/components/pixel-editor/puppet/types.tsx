import React from 'react';
import { Bone, Shirt, Film } from 'lucide-react';
import type { PuppetDirection, ModifierType, AnimationModifierType } from '@/lib/types';

// ---- Types ----

export type PuppetWorkspaceMode = 'none' | 'skeleton' | 'costume' | 'animate';

// ---- Workflow Step Definitions ----
export const WORKFLOW_STEPS = [
  { key: 'skeleton' as PuppetWorkspaceMode, label: '骨骼编辑', icon: <Bone className="size-3" />, desc: '定义骨骼结构和节点层级' },
  { key: 'costume' as PuppetWorkspaceMode, label: '服装设置', icon: <Shirt className="size-3" />, desc: '为每个节点分配精灵和方向' },
  { key: 'animate' as PuppetWorkspaceMode, label: '动画制作', icon: <Film className="size-3" />, desc: '录制姿态和关键帧动画' },
] as const;

// ---- Node Color Presets ----
export const NODE_COLOR_PRESETS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e', '#a855f7',
  '#64748b', '#888888',
];

// ---- Direction Labels ----
const DIRECTION_LABELS: Record<PuppetDirection, string> = {
  N: '北', NE: '东北', E: '东', SE: '东南',
  S: '南', SW: '西南', W: '西', NW: '西北',
};

const DIRECTION_COMPASS: { dir: PuppetDirection; x: number; y: number }[] = [
  { dir: 'NW', x: 0, y: 0 }, { dir: 'N', x: 1, y: 0 }, { dir: 'NE', x: 2, y: 0 },
  { dir: 'W', x: 0, y: 1 }, { dir: 'S', x: 1, y: 1 }, { dir: 'E', x: 2, y: 1 },
  { dir: 'SW', x: 0, y: 2 }, { dir: 'SE', x: 1, y: 2 },
];

// ---- Modifier type lists for puppet limbs ----

/** Categories of modifiers available for puppet limbs */
export const LIMB_EDIT_MOD_TYPES: ModifierType[] = [
  'color_replace', 'outline', 'dither', 'pixel_displace',
  'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip', 'pixel_edit',
  'translate',
];

export const LIMB_ANIM_MOD_TYPES: AnimationModifierType[] = [
  'pendulum', 'wheel', 'bounce', 'breath', 'wobble', 'float', 'shake', 'elastic', 'expression',
  'gait',
  'texture_scroll', 'wave_deform',
  'contour_scroll', 'reveal_hide', 'shatter_dissolve', 'annihilate', 'teleport', 'crt_off',
  'bend', 'elliptical_compress', 'dumbbell_stretch', 'pillow_stretch', 'hyperbolic_stretch', 'ring_ripple',
  'noise', 'wave', 'spring', 'jitter',
];
