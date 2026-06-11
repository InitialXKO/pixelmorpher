// ============================================================
// PixelMorpher - Keyframe Slice
// Keyframe CRUD, interpolation, duplicate, surrounding keyframes
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import {
  Keyframe,
  ANIMATION_MODIFIER_TYPES,
} from '../types';

export type KeyframeSlice = {
  addKeyframe: ProjectStore['addKeyframe'];
  removeKeyframe: ProjectStore['removeKeyframe'];
  updateKeyframe: ProjectStore['updateKeyframe'];
  duplicateKeyframe: ProjectStore['duplicateKeyframe'];
  getKeyframesForPart: ProjectStore['getKeyframesForPart'];
  getKeyframeAtFrame: ProjectStore['getKeyframeAtFrame'];
  getSurroundingKeyframes: ProjectStore['getSurroundingKeyframes'];
};

export const createKeyframeSlice: StateCreator<ProjectStore, [], [], KeyframeSlice> = (set, get) => ({
  addKeyframe: (partId, frame) => {
    get().pushUndo('添加关键帧');
    const id = crypto.randomUUID();
    const keyframe: Keyframe = {
      id,
      partId,
      frame,
      modifiers: [],
      correctionMask: null,
      isBaked: false,
    };
    // Copy modifiers from previous keyframe if exists
    // V3.1: Only copy NON-animation modifiers (animation modifiers are part-level now)
    const existing = get().getKeyframeAtFrame(partId, frame);
    if (!existing) {
      const prevKf = get().getSurroundingKeyframes(partId, frame).prev;
      if (prevKf) {
        keyframe.modifiers = prevKf.modifiers
          .filter((m) => !ANIMATION_MODIFIER_TYPES.includes(m.type))
          .map((m) => ({
            ...m,
            id: crypto.randomUUID(),
            params: { ...m.params },
          }));
      }
    }
    set((s) => ({
      keyframes: [...s.keyframes.filter((k) => !(k.partId === partId && k.frame === frame)), keyframe],
    }));
    return keyframe;
  },

  removeKeyframe: (keyframeId) => {
    get().pushUndo('删除关键帧');
    set((s) => ({
    keyframes: s.keyframes.filter((k) => k.id !== keyframeId),
    }));
  },

  updateKeyframe: (keyframeId, updates) => {
    get().pushUndo('更新关键帧', 'updateKeyframe');
    set((s) => ({
    keyframes: s.keyframes.map((k) => (k.id === keyframeId ? { ...k, ...updates } : k)),
    }));
  },

  duplicateKeyframe: (keyframeId, toFrame) => {
    get().pushUndo('复制关键帧');
    const source = get().keyframes.find((k) => k.id === keyframeId);
    if (!source) return {} as Keyframe;
    const newKf: Keyframe = {
      id: crypto.randomUUID(),
      partId: source.partId,
      frame: toFrame,
      modifiers: source.modifiers.map((m) => ({
        ...m,
        id: crypto.randomUUID(),
        params: {
          ...m.params,
          ...(m.params.brushCommands ? { brushCommands: JSON.parse(JSON.stringify(m.params.brushCommands)) } : {}),
        },
      })),
      correctionMask: null,
      isBaked: false,
    };
    set((s) => ({
      keyframes: [...s.keyframes.filter((k) => !(k.partId === source.partId && k.frame === toFrame)), newKf],
    }));
    return newKf;
  },

  getKeyframesForPart: (partId) => get().keyframes.filter((k) => k.partId === partId).sort((a, b) => a.frame - b.frame),

  getKeyframeAtFrame: (partId, frame) => get().keyframes.find((k) => k.partId === partId && k.frame === frame),

  getSurroundingKeyframes: (partId, frame) => {
    const kfs = get().keyframes.filter((k) => k.partId === partId).sort((a, b) => a.frame - b.frame);
    let prev: Keyframe | null = null;
    let next: Keyframe | null = null;
    for (const kf of kfs) {
      if (kf.frame <= frame) prev = kf;
      if (kf.frame > frame && !next) next = kf;
    }
    let t = 0;
    if (prev && next && prev.frame !== next.frame) {
      t = (frame - prev.frame) / (next.frame - prev.frame);
    }
    return { prev, next, t };
  },
});
