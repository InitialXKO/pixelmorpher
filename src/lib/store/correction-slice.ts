// ============================================================
// PixelMorpher - Correction Slice
// Correction mask, pixel edit modifier (BrushCommand CRUD),
// stroke driver actions, stroke driver ParamDriver/ParamKeyframe actions
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import {
  PixelGrid,
  ModifierType,
  AnimationBlendMode,
  ModifierCoordinateMode,
  BrushCommand,
  ModifierParamValue,
  ParamDriver,
  StrokeParamDriver,
  Keyframe,
  createDefaultParamDriver,
} from '../types';
import {
  invalidateAnimModifierCache,
  bakeParamDriverToKeyframes,
} from '../engine';

export type CorrectionSlice = {
  setCorrection: ProjectStore['setCorrection'];
  clearCorrection: ProjectStore['clearCorrection'];
  createPixelEditModifier: ProjectStore['createPixelEditModifier'];
  addPixelEditCommand: ProjectStore['addPixelEditCommand'];
  removePixelEditCommand: ProjectStore['removePixelEditCommand'];
  updatePixelEditCommand: ProjectStore['updatePixelEditCommand'];
  addStrokeDriverParamDriver: ProjectStore['addStrokeDriverParamDriver'];
  removeStrokeDriverParamDriver: ProjectStore['removeStrokeDriverParamDriver'];
  updateStrokeDriverParamDriver: ProjectStore['updateStrokeDriverParamDriver'];
  toggleStrokeDriverParamDriver: ProjectStore['toggleStrokeDriverParamDriver'];
  addStrokeDriverParamKeyframe: ProjectStore['addStrokeDriverParamKeyframe'];
  removeStrokeDriverParamKeyframe: ProjectStore['removeStrokeDriverParamKeyframe'];
  bakeStrokeDriverParamDriver: ProjectStore['bakeStrokeDriverParamDriver'];
  unbakeStrokeDriverParamDriver: ProjectStore['unbakeStrokeDriverParamDriver'];
};

/** Applies an immutable update to a specific StrokeParamDriver nested inside
 *  keyframes → modifiers → brushCommands → strokeDrivers.
 *  Returns the partial state `{ keyframes }` for use with zustand's `set()`. */
function updateStrokeDriver(
  keyframes: Keyframe[],
  keyframeId: string,
  modifierId: string,
  commandId: string,
  strokeDriverId: string,
  updateFn: (sd: StrokeParamDriver) => StrokeParamDriver,
): { keyframes: Keyframe[] } {
  return {
    keyframes: keyframes.map((k) => {
      if (k.id !== keyframeId) return k;
      return {
        ...k,
        modifiers: k.modifiers.map((m) => {
          if (m.id !== modifierId) return m;
          const commands = ((m.params.brushCommands as BrushCommand[]) || []).map(c => {
            if (c.id !== commandId) return c;
            const drivers = (c.strokeDrivers ?? []).map(sd => {
              if (sd.id !== strokeDriverId) return sd;
              return updateFn(sd);
            });
            return { ...c, strokeDrivers: drivers };
          });
          return { ...m, params: { ...m.params, brushCommands: commands } };
        }),
      };
    }),
  };
}

export const createCorrectionSlice: StateCreator<ProjectStore, [], [], CorrectionSlice> = (set, get) => ({
  setCorrection: (keyframeId, mask) => {
    get().pushUndo('设置修正', 'setCorrection');
    set((s) => ({
    keyframes: s.keyframes.map((k) => {
      if (k.id !== keyframeId) return k;
      return { ...k, correctionMask: mask };
    }),
    }));
  },

  clearCorrection: (keyframeId) => {
    get().pushUndo('清除修正');
    set((s) => ({
    keyframes: s.keyframes.map((k) => {
      if (k.id !== keyframeId) return k;
      return { ...k, correctionMask: null };
    }),
    }));
  },

  createPixelEditModifier: (keyframeId) => {
    get().pushUndo('创建像素编辑修改器');
    const id = crypto.randomUUID();
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: [...k.modifiers, {
            id,
            type: 'pixel_edit' as ModifierType,
            enabled: true,
            collapsed: false,
            params: {
              opacity: 1,
              brushCommands: [] as BrushCommand[],
            },
            startFrame: -1,
            endFrame: -1,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            blendMode: 'add' as AnimationBlendMode,
            coordinateMode: 'world' as ModifierCoordinateMode,
          }],
        };
      }),
    }));
    return id;
  },

  addPixelEditCommand: (keyframeId, modifierId, command) => {
    get().pushUndo('添加像素编辑命令');
    set((s) => ({
    keyframes: s.keyframes.map((k) => {
      if (k.id !== keyframeId) return k;
      return {
        ...k,
        modifiers: k.modifiers.map((m) => {
          if (m.id !== modifierId) return m;
          const commands = [...((m.params.brushCommands as BrushCommand[]) || []), command];
          return { ...m, params: { ...m.params, brushCommands: commands } };
        }),
      };
    }),
    }));
  },

  removePixelEditCommand: (keyframeId, modifierId, commandId) => {
    get().pushUndo('删除像素编辑命令');
    set((s) => ({
    keyframes: s.keyframes.map((k) => {
      if (k.id !== keyframeId) return k;
      return {
        ...k,
        modifiers: k.modifiers.map((m) => {
          if (m.id !== modifierId) return m;
          const commands = ((m.params.brushCommands as BrushCommand[]) || []).filter(c => c.id !== commandId);
          return { ...m, params: { ...m.params, brushCommands: commands } };
        }),
      };
    }),
    }));
  },

  updatePixelEditCommand: (keyframeId, modifierId, commandId, updates) => {
    get().pushUndo('更新像素编辑命令', 'updatePixelEditCommand');
    set((s) => ({
    keyframes: s.keyframes.map((k) => {
      if (k.id !== keyframeId) return k;
      return {
        ...k,
        modifiers: k.modifiers.map((m) => {
          if (m.id !== modifierId) return m;
          const commands = ((m.params.brushCommands as BrushCommand[]) || []).map(c =>
            c.id === commandId ? { ...c, ...updates } : c
          );
          return { ...m, params: { ...m.params, brushCommands: commands } };
        }),
      };
    }),
    }));
  },

  addStrokeDriverParamDriver: (keyframeId, modifierId, commandId, strokeDriverId, paramName, startFrame, endFrame) => {
    get().pushUndo('添加笔画驱动器参数驱动器');
    set((s) => updateStrokeDriver(s.keyframes, keyframeId, modifierId, commandId, strokeDriverId, (sd) => {
      const baseVal = typeof (sd as any)[paramName] === 'number' ? (sd as any)[paramName] as number : 0;
      const driver = createDefaultParamDriver(paramName, baseVal, startFrame ?? 0, endFrame ?? -1);
      return { ...sd, paramDrivers: [...(sd.paramDrivers ?? []), driver] };
    }));
  },

  removeStrokeDriverParamDriver: (keyframeId, modifierId, commandId, strokeDriverId, driverId) => {
    get().pushUndo('删除笔画驱动器参数驱动器');
    set((s) => updateStrokeDriver(s.keyframes, keyframeId, modifierId, commandId, strokeDriverId, (sd) =>
      ({ ...sd, paramDrivers: (sd.paramDrivers ?? []).filter(d => d.id !== driverId) })
    ));
  },

  updateStrokeDriverParamDriver: (keyframeId, modifierId, commandId, strokeDriverId, driverId, updates) => {
    get().pushUndo('更新笔画驱动器参数驱动器');
    set((s) => updateStrokeDriver(s.keyframes, keyframeId, modifierId, commandId, strokeDriverId, (sd) =>
      ({ ...sd, paramDrivers: (sd.paramDrivers ?? []).map(d => d.id === driverId ? { ...d, ...updates } : d) })
    ));
  },

  toggleStrokeDriverParamDriver: (keyframeId, modifierId, commandId, strokeDriverId, driverId) => {
    get().pushUndo('切换笔画驱动器参数驱动器');
    set((s) => updateStrokeDriver(s.keyframes, keyframeId, modifierId, commandId, strokeDriverId, (sd) =>
      ({ ...sd, paramDrivers: (sd.paramDrivers ?? []).map(d => d.id === driverId ? { ...d, enabled: !d.enabled } : d) })
    ));
  },

  addStrokeDriverParamKeyframe: (keyframeId, modifierId, commandId, strokeDriverId, frame, params) => {
    get().pushUndo('添加笔画驱动器参数关键帧');
    set((s) => updateStrokeDriver(s.keyframes, keyframeId, modifierId, commandId, strokeDriverId, (sd) => {
      const existing = sd.paramKeyframes ?? [];
      const existingIdx = existing.findIndex(pk => pk.frame === frame);
      if (existingIdx >= 0) {
        const updated = [...existing];
        updated[existingIdx] = { ...updated[existingIdx], params: { ...updated[existingIdx].params, ...params } };
        return { ...sd, paramKeyframes: updated };
      }
      const newPk: import('../types').ModifierParamKeyframe = { id: crypto.randomUUID(), frame, params };
      return { ...sd, paramKeyframes: [...existing, newPk] };
    }));
  },

  removeStrokeDriverParamKeyframe: (keyframeId, modifierId, commandId, strokeDriverId, paramKfId) => {
    get().pushUndo('删除笔画驱动器参数关键帧');
    set((s) => updateStrokeDriver(s.keyframes, keyframeId, modifierId, commandId, strokeDriverId, (sd) =>
      ({ ...sd, paramKeyframes: (sd.paramKeyframes ?? []).filter(pk => pk.id !== paramKfId) })
    ));
  },

  bakeStrokeDriverParamDriver: (keyframeId, modifierId, commandId, strokeDriverId, driverId) => {
    get().pushUndo('烘焙笔画驱动器参数驱动器');
    invalidateAnimModifierCache(modifierId);
    const s = get();
    const kf = s.keyframes.find((k) => k.id === keyframeId);
    if (!kf) return;
    const mod = kf.modifiers.find((m) => m.id === modifierId);
    if (!mod) return;
    const commands = (mod.params.brushCommands as BrushCommand[]) || [];
    const cmd = commands.find((c) => c.id === commandId);
    if (!cmd) return;
    const sd = (cmd.strokeDrivers ?? []).find((d) => d.id === strokeDriverId);
    if (!sd) return;
    const driver = (sd.paramDrivers ?? []).find((d) => d.id === driverId);
    if (!driver || driver.isBaked) return;

    const result = bakeParamDriverToKeyframes(
      driver,
      sd.paramKeyframes ?? [],
      s.totalFrames,
    );

    set((s2) => updateStrokeDriver(s2.keyframes, keyframeId, modifierId, commandId, strokeDriverId, (d) => ({
      ...d,
      paramKeyframes: result.paramKeyframes,
      paramDrivers: (d.paramDrivers ?? []).map((pd) => {
        if (pd.id !== driverId) return pd;
        return { ...pd, ...result.driverUpdates };
      }),
    })));
  },

  unbakeStrokeDriverParamDriver: (keyframeId, modifierId, commandId, strokeDriverId, driverId) => {
    get().pushUndo('反烘焙笔画驱动器参数驱动器');
    invalidateAnimModifierCache(modifierId);
    const s = get();
    const kf = s.keyframes.find((k) => k.id === keyframeId);
    if (!kf) return;
    const mod = kf.modifiers.find((m) => m.id === modifierId);
    if (!mod) return;
    const commands = (mod.params.brushCommands as BrushCommand[]) || [];
    const cmd = commands.find((c) => c.id === commandId);
    if (!cmd) return;
    const sd = (cmd.strokeDrivers ?? []).find((d) => d.id === strokeDriverId);
    if (!sd) return;
    const driver = (sd.paramDrivers ?? []).find((d) => d.id === driverId);
    if (!driver || !driver.isBaked) return;

    const startFrame = driver.startFrame;
    const endFrame = driver.endFrame >= 0 ? driver.endFrame : s.totalFrames - 1;

    const cleanedPkfs = (sd.paramKeyframes ?? []).filter((pkf) => {
      if (pkf.frame < startFrame || pkf.frame > endFrame) return true;
      const otherKeys = Object.keys(pkf.params).filter((k) => k !== driver.paramName);
      if (otherKeys.length > 0) return true;
      return false;
    }).map((pkf) => {
      if (pkf.frame >= startFrame && pkf.frame <= endFrame) {
        const newParams = { ...pkf.params };
        delete newParams[driver.paramName];
        if (Object.keys(newParams).length === 0) return null;
        return { ...pkf, params: newParams };
      }
      return pkf;
    }).filter(Boolean) as import('../types').ModifierParamKeyframe[];

    set((s2) => updateStrokeDriver(s2.keyframes, keyframeId, modifierId, commandId, strokeDriverId, (d) => ({
      ...d,
      paramKeyframes: cleanedPkfs,
      paramDrivers: (d.paramDrivers ?? []).map((pd) => {
        if (pd.id !== driverId) return pd;
        return { ...pd, isBaked: false, enabled: true };
      }),
    })));
  },
});
