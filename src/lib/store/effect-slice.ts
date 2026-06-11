// ============================================================
// PixelMorpher - Effect Slice
// Effect tracks, effect keyframes, motion blur strokes, effect strokes,
// canvas modifier tracks, canvas modifier actions
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import {
  EffectTrack,
  MotionBlurStroke,
  EffectStroke,
  CanvasModifierType,
  CanvasModifierTrack,
  ModifierParamValue,
  createDefaultCanvasModifier,
  getCanvasModifierDef,
} from '../types';

export type EffectSlice = {
  addEffectTrack: ProjectStore['addEffectTrack'];
  removeEffectTrack: ProjectStore['removeEffectTrack'];
  toggleEffectTrackVisibility: ProjectStore['toggleEffectTrackVisibility'];
  addEffectKeyframe: ProjectStore['addEffectKeyframe'];
  removeEffectKeyframe: ProjectStore['removeEffectKeyframe'];
  updateEffectKeyframe: ProjectStore['updateEffectKeyframe'];
  addMotionBlurStroke: ProjectStore['addMotionBlurStroke'];
  removeMotionBlurStroke: ProjectStore['removeMotionBlurStroke'];
  clearMotionBlurStrokesForFrame: ProjectStore['clearMotionBlurStrokesForFrame'];
  addEffectStroke: ProjectStore['addEffectStroke'];
  removeEffectStroke: ProjectStore['removeEffectStroke'];
  clearEffectStrokesForFrame: ProjectStore['clearEffectStrokesForFrame'];
  toggleOnionSkin: ProjectStore['toggleOnionSkin'];
  setOnionSkinFrames: ProjectStore['setOnionSkinFrames'];
  addCanvasModifierTrack: ProjectStore['addCanvasModifierTrack'];
  removeCanvasModifierTrack: ProjectStore['removeCanvasModifierTrack'];
  toggleCanvasModifierTrackVisibility: ProjectStore['toggleCanvasModifierTrackVisibility'];
  toggleCanvasModifierTrackEnabled: ProjectStore['toggleCanvasModifierTrackEnabled'];
  addCanvasModifier: ProjectStore['addCanvasModifier'];
  removeCanvasModifier: ProjectStore['removeCanvasModifier'];
  updateCanvasModifier: ProjectStore['updateCanvasModifier'];
  toggleCanvasModifier: ProjectStore['toggleCanvasModifier'];
  toggleCanvasModifierCollapsed: ProjectStore['toggleCanvasModifierCollapsed'];
  reorderCanvasModifier: ProjectStore['reorderCanvasModifier'];
  addCanvasModifierKeyframe: ProjectStore['addCanvasModifierKeyframe'];
  removeCanvasModifierKeyframe: ProjectStore['removeCanvasModifierKeyframe'];
  updateCanvasModifierKeyframe: ProjectStore['updateCanvasModifierKeyframe'];
};

export const createEffectSlice: StateCreator<ProjectStore, [], [], EffectSlice> = (set, get) => ({
  addEffectTrack: (type, name) => {
    get().pushUndo('添加效果轨道');
    const track: EffectTrack = {
      id: crypto.randomUUID(),
      type,
      name,
      visible: true,
      keyframes: [],
    };
    set((s) => ({ effectTracks: [...s.effectTracks, track] }));
  },

  removeEffectTrack: (id) => {
    get().pushUndo('删除效果轨道');
    set((s) => ({
    effectTracks: s.effectTracks.filter((t) => t.id !== id),
    }));
  },

  toggleEffectTrackVisibility: (id) => set((s) => ({
    effectTracks: s.effectTracks.map((t) => (t.id === id ? { ...t, visible: !t.visible } : t)),
  })),

  addEffectKeyframe: (effectTrackId, frame, params) => {
    get().pushUndo('添加效果关键帧');
    set((s) => {
      const defaultParams = params ?? {};
      return {
        effectTracks: s.effectTracks.map((t) => {
          if (t.id !== effectTrackId) return t;
          if (t.keyframes.some((k) => k.frame === frame)) return t;
          return {
            ...t,
            keyframes: [...t.keyframes, {
              id: crypto.randomUUID(),
              frame,
              params: defaultParams,
            }].sort((a, b) => a.frame - b.frame),
          };
        }),
      };
    });
  },

  removeEffectKeyframe: (effectTrackId, keyframeId) => {
    get().pushUndo('删除效果关键帧');
    set((s) => ({
    effectTracks: s.effectTracks.map((t) => {
      if (t.id !== effectTrackId) return t;
      return {
        ...t,
        keyframes: t.keyframes.filter((k) => k.id !== keyframeId),
      };
    }),
    }));
  },

  updateEffectKeyframe: (effectTrackId, keyframeId, params) => {
    get().pushUndo('更新效果关键帧');
    set((s) => ({
    effectTracks: s.effectTracks.map((t) => {
      if (t.id !== effectTrackId) return t;
      return {
        ...t,
        keyframes: t.keyframes.map((k) => {
          if (k.id !== keyframeId) return k;
          return { ...k, params: { ...k.params, ...params } };
        }),
      };
    }),
    }));
  },

  addMotionBlurStroke: (stroke) => {
    get().pushUndo('添加运动模糊笔触');
    set((s) => ({
    motionBlurStrokes: [...s.motionBlurStrokes, { ...stroke, id: crypto.randomUUID() }],
    }));
  },

  removeMotionBlurStroke: (id) => {
    get().pushUndo('删除运动模糊笔触');
    set((s) => ({
    motionBlurStrokes: s.motionBlurStrokes.filter((s2) => s2.id !== id),
    }));
  },

  clearMotionBlurStrokesForFrame: (frame) => {
    get().pushUndo('清除帧运动模糊');
    set((s) => ({
    motionBlurStrokes: s.motionBlurStrokes.filter((s2) => s2.frame !== frame),
    }));
  },

  addEffectStroke: (stroke) => {
    get().pushUndo('添加效果笔触');
    set((s) => ({
    effectStrokes: [...s.effectStrokes, { ...stroke, id: crypto.randomUUID() }],
    }));
  },

  removeEffectStroke: (id) => {
    get().pushUndo('删除效果笔触');
    set((s) => ({
    effectStrokes: s.effectStrokes.filter((e) => e.id !== id),
    }));
  },

  clearEffectStrokesForFrame: (frame) => {
    get().pushUndo('清除帧效果笔触');
    set((s) => ({
    effectStrokes: s.effectStrokes.filter((e) => e.frame !== frame),
    }));
  },

  toggleOnionSkin: () => set((s) => ({ onionSkinEnabled: !s.onionSkinEnabled })),
  setOnionSkinFrames: (n) => set({ onionSkinFrames: n }),

  addCanvasModifierTrack: (type) => {
    get().pushUndo('添加画布修改器轨道');
    const def = getCanvasModifierDef(type);
    const track: CanvasModifierTrack = {
      id: crypto.randomUUID(),
      type,
      name: def.label,
      visible: true,
      enabled: true,
      modifiers: [createDefaultCanvasModifier(type)],
      keyframes: [],
    };
    set((s) => ({ canvasModifierTracks: [...s.canvasModifierTracks, track] }));
  },

  removeCanvasModifierTrack: (id) => {
    get().pushUndo('删除画布修改器轨道');
    set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.filter((t) => t.id !== id),
    }));
  },

  toggleCanvasModifierTrackVisibility: (id) => set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) =>
      t.id === id ? { ...t, visible: !t.visible } : t
    ),
  })),

  toggleCanvasModifierTrackEnabled: (id) => {
    get().pushUndo('切换画布修改器启用');
    set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) =>
      t.id === id ? { ...t, enabled: !t.enabled } : t
    ),
    }));
  },

  addCanvasModifier: (trackId, type) => {
    get().pushUndo('添加画布修改器');
    set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) => {
      if (t.id !== trackId) return t;
      return { ...t, modifiers: [...t.modifiers, createDefaultCanvasModifier(type)] };
    }),
    }));
  },

  removeCanvasModifier: (trackId, modifierId) => {
    get().pushUndo('删除画布修改器');
    set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) => {
      if (t.id !== trackId) return t;
      return { ...t, modifiers: t.modifiers.filter((m) => m.id !== modifierId) };
    }),
    }));
  },

  updateCanvasModifier: (trackId, modifierId, params) => {
    get().pushUndo('更新画布修改器', 'updateCanvasModifier');
    set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        modifiers: t.modifiers.map((m) => {
          if (m.id !== modifierId) return m;
          return { ...m, params: { ...m.params, ...params } };
        }),
      };
    }),
    }));
  },

  toggleCanvasModifier: (trackId, modifierId) => {
    get().pushUndo('切换画布修改器');
    set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        modifiers: t.modifiers.map((m) => {
          if (m.id !== modifierId) return m;
          return { ...m, enabled: !m.enabled };
        }),
      };
    }),
    }));
  },

  toggleCanvasModifierCollapsed: (trackId, modifierId) => set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        modifiers: t.modifiers.map((m) => {
          if (m.id !== modifierId) return m;
          return { ...m, collapsed: !m.collapsed };
        }),
      };
    }),
  })),

  reorderCanvasModifier: (trackId, modifierId, newIndex) => {
    get().pushUndo('重排画布修改器');
    set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) => {
      if (t.id !== trackId) return t;
      const modifiers = [...t.modifiers];
      const oldIndex = modifiers.findIndex((m) => m.id === modifierId);
      if (oldIndex === -1) return t;
      const [removed] = modifiers.splice(oldIndex, 1);
      modifiers.splice(newIndex, 0, removed);
      return { ...t, modifiers };
    }),
    }));
  },

  addCanvasModifierKeyframe: (trackId, frame, params) => {
    get().pushUndo('添加画布修改器关键帧');
    set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) => {
      if (t.id !== trackId) return t;
      if (t.keyframes.some((k) => k.frame === frame)) return t;
      return {
        ...t,
        keyframes: [...t.keyframes, {
          id: crypto.randomUUID(),
          frame,
          params: params ?? {},
        }].sort((a, b) => a.frame - b.frame),
      };
    }),
    }));
  },

  removeCanvasModifierKeyframe: (trackId, keyframeId) => {
    get().pushUndo('删除画布修改器关键帧');
    set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) => {
      if (t.id !== trackId) return t;
      return { ...t, keyframes: t.keyframes.filter((k) => k.id !== keyframeId) };
    }),
    }));
  },

  updateCanvasModifierKeyframe: (trackId, keyframeId, params) => {
    get().pushUndo('更新画布修改器关键帧');
    set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        keyframes: t.keyframes.map((k) => {
          if (k.id !== keyframeId) return k;
          return { ...k, params: { ...k.params, ...params } };
        }),
      };
    }),
    }));
  },
});
