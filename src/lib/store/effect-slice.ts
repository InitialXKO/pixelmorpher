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
import { effectKeyframeDefaultParams } from '../effect-track-params';

export type EffectSlice = {
  addEffectTrack: ProjectStore['addEffectTrack'];
  removeEffectTrack: ProjectStore['removeEffectTrack'];
  toggleEffectTrackVisibility: ProjectStore['toggleEffectTrackVisibility'];
  addEffectKeyframe: ProjectStore['addEffectKeyframe'];
  removeEffectKeyframe: ProjectStore['removeEffectKeyframe'];
  updateEffectKeyframe: ProjectStore['updateEffectKeyframe'];
  addMotionBlurStroke: ProjectStore['addMotionBlurStroke'];
  updateMotionBlurStroke: ProjectStore['updateMotionBlurStroke'];
  removeMotionBlurStroke: ProjectStore['removeMotionBlurStroke'];
  clearMotionBlurStrokesForFrame: ProjectStore['clearMotionBlurStrokesForFrame'];
  addEffectStroke: ProjectStore['addEffectStroke'];
  updateEffectStroke: ProjectStore['updateEffectStroke'];
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
  moveCanvasModifierKeyframe: ProjectStore['moveCanvasModifierKeyframe'];
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
      // 未给 params 时按轨类型播种全字段缺省（lib/effect-track-params
      // 参数表，飘字走事件缺省）：否则关键帧 params 恒 {}、没有任何
      // 字段可编辑、渲染只能走写死回落（审计 F-05）。
      const track = s.effectTracks.find((t) => t.id === effectTrackId);
      const defaultParams = params ?? effectKeyframeDefaultParams(track?.type);
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

  updateMotionBlurStroke: (id, patch) => {
    get().pushUndo('更新运动模糊笔触');
    set((s) => ({
    motionBlurStrokes: s.motionBlurStrokes.map((s2) => (s2.id === id ? { ...s2, ...patch } : s2)),
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

  updateEffectStroke: (id, patch) => {
    get().pushUndo('更新效果笔触');
    set((s) => ({
    effectStrokes: s.effectStrokes.map((e) => (e.id === id ? { ...e, ...patch } : e)),
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

  addCanvasModifierKeyframe: (trackId, frame, paramsOrByModifier) => {
    get().pushUndo('添加画布修改器关键帧');
    // 兼容旧调用形态（扁平袋）：分键 map 的每个值都是参数袋（普通对象），
    // 扁平袋的值是 ModifierParamValue（标量/数组，永不为普通对象），
    // 据此判形——旧形态按存量扁平袋落盘，读时回落兼容（审计 F-30）
    const isByModifier = !!paramsOrByModifier
      && Object.values(paramsOrByModifier).every((v) => !!v && typeof v === 'object' && !Array.isArray(v));
    set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) => {
      if (t.id !== trackId) return t;
      if (t.keyframes.some((k) => k.frame === frame)) return t;
      return {
        ...t,
        keyframes: [...t.keyframes, isByModifier
          ? {
            id: crypto.randomUUID(),
            frame,
            // 参数按修改器分键（审计 F-30）；params 留空袋仅作存量格式占位
            params: {},
            paramsByModifier: paramsOrByModifier as Record<string, Record<string, ModifierParamValue>>,
          }
          : {
            id: crypto.randomUUID(),
            frame,
            params: (paramsOrByModifier ?? {}) as Record<string, ModifierParamValue>,
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

  updateCanvasModifierKeyframe: (trackId, keyframeId, modifierIdOrParams, maybeParams) => {
    get().pushUndo('更新画布修改器关键帧');
    // 双形态：新形态 (modifierId, params) 只写该修改器分键；旧形态
    // (params) 合并进扁平袋（读时全体回落，语义与旧实现一致，审计 F-30）
    const legacy = typeof modifierIdOrParams === 'object';
    const modifierId = legacy ? '' : (modifierIdOrParams as string);
    const params = (legacy ? modifierIdOrParams : maybeParams) as Record<string, ModifierParamValue>;
    set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        keyframes: t.keyframes.map((k) => {
          if (k.id !== keyframeId) return k;
          if (legacy) return { ...k, params: { ...(k.params ?? {}), ...params } };
          // 只写该修改器自己的分键（审计 F-30）；存量扁平袋关键帧首次编辑
          // 时把扁平袋按本修改器当前读口径物化为它的分键，其余修改器的
          // 回落仍走扁平袋、行为不变
          const byMod = { ...(k.paramsByModifier ?? {}) };
          byMod[modifierId] = {
            ...(byMod[modifierId] ?? (k.paramsByModifier ? {} : (k.params ?? {}))),
            ...params,
          };
          return { ...k, paramsByModifier: byMod };
        }),
      };
    }),
    }));
  },

  moveCanvasModifierKeyframe: (trackId, keyframeId, frame) => {
    get().pushUndo('移动画布修改器关键帧');
    set((s) => ({
    canvasModifierTracks: s.canvasModifierTracks.map((t) => {
      if (t.id !== trackId) return t;
      // 目标帧已有其他关键帧时拒绝（与轨道拖拽的碰撞检查同口径）
      if (t.keyframes.some((k) => k.id !== keyframeId && k.frame === frame)) return t;
      return {
        ...t,
        keyframes: t.keyframes
          .map((k) => (k.id === keyframeId ? { ...k, frame } : k))
          .sort((a, b) => a.frame - b.frame),
      };
    }),
    }));
  },
});
