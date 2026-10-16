// ============================================================
// PixelMorpher - Modifier Slice
// Keyframe-level modifiers (add/remove/update/toggle, collapse, bake/unbake),
// modifier param keyframes, modifier range, scope-aware actions
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import {
  ModifierType,
  AnimationBlendMode,
  ModifierCoordinateMode,
  ANIMATION_MODIFIER_TYPES,
  PartAnimationModifier,
  createDefaultModifier,
  ModifierParamValue,
  BrushCommand,
} from '../types';
import {
  invalidateAnimModifierCache,
  invalidateInterpolationCache,
  invalidateParamDriverEvalCache,
  applyPixelModifiers,
  computeKeyframeBaseTransform,
  computePartAnimationTransform,
  combineTransformsComponentLevel,
  imageDataToPixelGrid,
  bakeParamDriverToKeyframes,
} from '../engine';
import { _isDragActive, _pendingTrajectorySpriteIds } from './shared';

export type ModifierSlice = {
  addModifier: ProjectStore['addModifier'];
  removeModifier: ProjectStore['removeModifier'];
  updateModifier: ProjectStore['updateModifier'];
  toggleModifier: ProjectStore['toggleModifier'];
  toggleModifierCollapsed: ProjectStore['toggleModifierCollapsed'];
  reorderModifier: ProjectStore['reorderModifier'];
  collapseModifiers: ProjectStore['collapseModifiers'];
  uncollapseModifiers: ProjectStore['uncollapseModifiers'];
  bakeModifiers: ProjectStore['bakeModifiers'];
  bakeToTimeline: ProjectStore['bakeToTimeline'];
  updateModifierRange: ProjectStore['updateModifierRange'];
  addModifierToSubsequent: ProjectStore['addModifierToSubsequent'];
  removeModifierFromSubsequent: ProjectStore['removeModifierFromSubsequent'];
  addModifierParamKeyframe: ProjectStore['addModifierParamKeyframe'];
  removeModifierParamKeyframe: ProjectStore['removeModifierParamKeyframe'];
  updateModifierParamKeyframe: ProjectStore['updateModifierParamKeyframe'];
  addParamDriver: ProjectStore['addParamDriver'];
  removeParamDriver: ProjectStore['removeParamDriver'];
  updateParamDriver: ProjectStore['updateParamDriver'];
  toggleParamDriver: ProjectStore['toggleParamDriver'];
  bakeParamDriver: ProjectStore['bakeParamDriver'];
  unbakeParamDriver: ProjectStore['unbakeParamDriver'];
};

export const createModifierSlice: StateCreator<ProjectStore, [], [], ModifierSlice> = (set, get) => ({
  addModifier: (keyframeId, type) => {
    get().pushUndo('添加修改器');
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        if (k.isBaked) return k;
        return {
          ...k,
          modifiers: [...k.modifiers, createDefaultModifier(type)],
        };
      }),
    }));
    if (type === 'translate' || type === 'rotate') {
      const kf = get().keyframes.find((k) => k.id === keyframeId);
      if (kf) {
        if (_isDragActive) {
          _pendingTrajectorySpriteIds.add(kf.spriteId);
        } else {
          setTimeout(() => get().autoRecordTrajectory(kf.spriteId), 0);
        }
      }
    }
  },

  removeModifier: (keyframeId, modifierId) => {
    get().pushUndo('删除修改器');
    const kf = get().keyframes.find((k) => k.id === keyframeId);
    if (kf) {
      const mod = kf.modifiers.find((m) => m.id === modifierId);
      if (mod && ANIMATION_MODIFIER_TYPES.includes(mod.type)) {
        invalidateAnimModifierCache(modifierId);
      }
    }
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.filter((m) => m.id !== modifierId),
        };
      }),
    }));
  },

  updateModifier: (keyframeId, modifierId, params) => {
    get().pushUndo('更新修改器', 'updateModifier');
    // H8/H9: 修改器数据变更后，插值缓存与 param driver 求值缓存必须失效
    invalidateInterpolationCache();
    invalidateParamDriverEvalCache();
    const { blendMode, coordinateMode, ...restParams } = params as any;
    const actualParams = restParams as Record<string, ModifierParamValue>;

    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              params: { ...m.params, ...actualParams },
              ...(blendMode !== undefined && { blendMode: blendMode as AnimationBlendMode }),
              ...(coordinateMode !== undefined && { coordinateMode: coordinateMode as ModifierCoordinateMode }),
            };
          }),
        };
      }),
    }));
    const updatedState = get();
    const kf = updatedState.keyframes.find((k) => k.id === keyframeId);
    if (kf) {
      const mod = kf.modifiers.find((m) => m.id === modifierId);
      if (mod) {
        if (ANIMATION_MODIFIER_TYPES.includes(mod.type)) {
          invalidateAnimModifierCache(modifierId);
        }
        if (mod.type === 'translate' || mod.type === 'rotate') {
          if (_isDragActive) {
            _pendingTrajectorySpriteIds.add(kf.spriteId);
          } else {
            setTimeout(() => get().autoRecordTrajectory(kf.spriteId), 0);
          }
        }
      }
    }
  },

  toggleModifier: (keyframeId, modifierId) => {
    get().pushUndo('切换修改器');
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            if (ANIMATION_MODIFIER_TYPES.includes(m.type)) {
              invalidateAnimModifierCache(modifierId);
            }
            return { ...m, enabled: !m.enabled };
          }),
        };
      }),
    }));
  },

  toggleModifierCollapsed: (keyframeId, modifierId) => set((s) => ({
    keyframes: s.keyframes.map((k) => {
      if (k.id !== keyframeId) return k;
      return {
        ...k,
        modifiers: k.modifiers.map((m) => {
          if (m.id !== modifierId) return m;
          return { ...m, collapsed: !m.collapsed };
        }),
      };
    }),
  })),

  reorderModifier: (keyframeId, modifierId, newIndex) => {
    get().pushUndo('重排修改器');
    set((s) => ({
    keyframes: s.keyframes.map((k) => {
      if (k.id !== keyframeId) return k;
      const modifiers = [...k.modifiers];
      const oldIndex = modifiers.findIndex((m) => m.id === modifierId);
      if (oldIndex === -1) return k;
      const [removed] = modifiers.splice(oldIndex, 1);
      modifiers.splice(newIndex, 0, removed);
      return { ...k, modifiers };
    }),
    }));
  },

  collapseModifiers: (keyframeId) => {
    get().pushUndo('折叠修改器');
    const s = get();
    const keyframe = s.keyframes.find(k => k.id === keyframeId);
    if (!keyframe || keyframe.isBaked) return;

    // Part model removed; keyframe collapse no longer supported.
    return;
  },

  uncollapseModifiers: (keyframeId) => {
    const s = get();
    const keyframe = s.keyframes.find(k => k.id === keyframeId);
    if (!keyframe) return;

    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => ({ ...m, collapsed: false })),
          correctionMask: null,
          overrideWidth: undefined,
          overrideHeight: undefined,
          overridePivotX: undefined,
          overridePivotY: undefined,
          collapsedWidth: undefined,
          collapsedHeight: undefined,
          collapsedPivotX: undefined,
          collapsedPivotY: undefined,
        };
      }),
    }));
  },

  bakeModifiers: (keyframeId) => {
    get().pushUndo('烘焙修改器');
    const s = get();
    const keyframe = s.keyframes.find(k => k.id === keyframeId);
    if (!keyframe || keyframe.isBaked) return;

    // Part model removed; keyframe bake no longer supported.
    return;
  },

  bakeToTimeline: (spriteId, startFrame, endFrame, step) => {
    get().pushUndo('烘焙到时间轴');
    const state = get();

    const partKeyframes = state.keyframes
      .filter((k) => k.spriteId === spriteId)
      .sort((a, b) => a.frame - b.frame);
    if (partKeyframes.length === 0) return;

    for (let frame = startFrame; frame <= endFrame; frame += step) {
      let totalTX = 0, totalTY = 0, totalRot = 0, totalSX = 1, totalSY = 1;
      let hasAnimMods = false;

      {
        const kf = state.keyframes.find((k) => k.spriteId === spriteId && k.frame === frame);
        if (!kf || kf.isBaked) continue;
        const kfAnimMods = kf.modifiers.filter((m) =>
          m.enabled && ANIMATION_MODIFIER_TYPES.includes(m.type)
        );
        if (kfAnimMods.length === 0) continue;
        for (const animMod of kfAnimMods) {
          const { computeAnimationModifierTransform } = require('../engine');
          const transform = computeAnimationModifierTransform(animMod, frame, state.frameRate);
          totalTX += transform.translateX;
          totalTY += transform.translateY;
          totalRot += transform.rotation;
          totalSX *= transform.scaleX;
          totalSY *= transform.scaleY;
          hasAnimMods = true;
        }
      }

      if (!hasAnimMods) continue;

      totalTX = Math.round(totalTX);
      totalTY = Math.round(totalTY);
      totalRot = Math.round(totalRot * 10) / 10;

      let targetKfId: string;
      const existingKf = state.keyframes.find((k) => k.spriteId === spriteId && k.frame === frame);
      if (existingKf) {
        targetKfId = existingKf.id;
      } else {
        const newKf = get().addKeyframe(spriteId, frame);
        targetKfId = newKf.id;
      }

      if (totalTX !== 0 || totalTY !== 0) {
        get().addModifier(targetKfId, 'translate');
        const updatedKf = get().keyframes.find((k) => k.id === targetKfId);
        const translateMod = updatedKf?.modifiers.find((m) => m.type === 'translate');
        if (translateMod) {
          get().updateModifier(targetKfId, translateMod.id, {
            offsetX: totalTX,
            offsetY: totalTY,
          });
        }
      }

      if (Math.abs(totalRot) > 0.01) {
        get().addModifier(targetKfId, 'rotate');
        const updatedKf = get().keyframes.find((k) => k.id === targetKfId);
        const rotateMod = updatedKf?.modifiers.find((m) => m.type === 'rotate');
        if (rotateMod) {
          get().updateModifier(targetKfId, rotateMod.id, { angle: totalRot });
        }
      }

      if (Math.abs(totalSX - 1) > 0.001 || Math.abs(totalSY - 1) > 0.001) {
        if (Math.abs(totalSX - totalSY) < 0.001) {
          get().addModifier(targetKfId, 'uniform_scale');
          const updatedKf = get().keyframes.find((k) => k.id === targetKfId);
          const scaleMod = updatedKf?.modifiers.find((m) => m.type === 'uniform_scale');
          if (scaleMod) {
            get().updateModifier(targetKfId, scaleMod.id, { scale: totalSX });
          }
        } else {
          get().addModifier(targetKfId, 'non_uniform_stretch');
          const updatedKf = get().keyframes.find((k) => k.id === targetKfId);
          const stretchMod = updatedKf?.modifiers.find((m) => m.type === 'non_uniform_stretch');
          if (stretchMod) {
            get().updateModifier(targetKfId, stretchMod.id, { scaleX: totalSX, scaleY: totalSY });
          }
        }
      }

      const currentKf = get().keyframes.find((k) => k.id === targetKfId);
      if (currentKf) {
        const animModIds = currentKf.modifiers
          .filter((m) => ANIMATION_MODIFIER_TYPES.includes(m.type))
          .map((m) => m.id);
        for (const modId of animModIds) {
          get().removeModifier(targetKfId, modId);
        }
      }
    }
  },

  updateModifierRange: (keyframeId, modifierId, range) => {
    get().pushUndo('更新修改器范围');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              ...(range.startFrame !== undefined && { startFrame: range.startFrame }),
              ...(range.endFrame !== undefined && { endFrame: range.endFrame }),
              ...(range.fadeInFrames !== undefined && { fadeInFrames: range.fadeInFrames }),
              ...(range.fadeOutFrames !== undefined && { fadeOutFrames: range.fadeOutFrames }),
            };
          }),
        };
      }),
    }));
  },

  addModifierToSubsequent: (spriteId, fromFrame, type) => {
    get().pushUndo('添加到后续帧');
    const newMod = createDefaultModifier(type);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.spriteId !== spriteId || k.frame < fromFrame || k.isBaked) return k;
        return {
          ...k,
          modifiers: [...k.modifiers, { ...newMod, id: crypto.randomUUID() }],
        };
      }),
    }));
    if (type === 'translate' || type === 'rotate') {
      if (_isDragActive) {
        _pendingTrajectorySpriteIds.add(spriteId);
      } else {
        setTimeout(() => get().autoRecordTrajectory(spriteId), 0);
      }
    }
  },

  removeModifierFromSubsequent: (spriteId, fromFrame, modifierType) => {
    get().pushUndo('从后续帧删除');
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.spriteId !== spriteId || k.frame < fromFrame) return k;
        return {
          ...k,
          modifiers: k.modifiers.filter((m) => m.type !== modifierType),
        };
      }),
    }));
    if (modifierType === 'translate' || modifierType === 'rotate') {
      if (_isDragActive) {
        _pendingTrajectorySpriteIds.add(spriteId);
      } else {
        setTimeout(() => get().autoRecordTrajectory(spriteId), 0);
      }
    }
  },

  addModifierParamKeyframe: (keyframeId, modifierId, frame, params) => {
    get().pushUndo('添加参数关键帧');
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            const existing = m.paramKeyframes ?? [];
            const existingIdx = existing.findIndex((pk) => pk.frame === frame);
            if (existingIdx >= 0) {
              const updated = [...existing];
              updated[existingIdx] = { ...updated[existingIdx], params: { ...updated[existingIdx].params, ...params } };
              return { ...m, paramKeyframes: updated };
            }
            const newPk: import('../types').ModifierParamKeyframe = {
              id: crypto.randomUUID(),
              frame,
              params,
            };
            return { ...m, paramKeyframes: [...existing, newPk] };
          }),
        };
      }),
    }));
  },

  removeModifierParamKeyframe: (keyframeId, modifierId, paramKfId) => {
    get().pushUndo('删除参数关键帧');
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramKeyframes: (m.paramKeyframes ?? []).filter((pk) => pk.id !== paramKfId),
            };
          }),
        };
      }),
    }));
  },

  updateModifierParamKeyframe: (keyframeId, modifierId, paramKfId, params) => {
    get().pushUndo('更新参数关键帧');
    invalidateInterpolationCache();
    invalidateParamDriverEvalCache();    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramKeyframes: (m.paramKeyframes ?? []).map((pk) => {
                if (pk.id !== paramKfId) return pk;
                const paramsAny = params as Record<string, unknown>;
                if (typeof paramsAny.__frame === 'number') {
                  const { __frame, ...restParams } = paramsAny;
                  const cleanParams: Record<string, ModifierParamValue> = {};
                  for (const [key, val] of Object.entries(restParams)) {
                    if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
                      cleanParams[key] = val;
                    }
                  }
                  return { ...pk, frame: paramsAny.__frame as number, params: { ...pk.params, ...cleanParams } };
                }
                return { ...pk, params: { ...pk.params, ...params } };
              }),
            };
          }),
        };
      }),
    }));
  },

  addParamDriver: (keyframeId, modifierId, paramName, startFrame, endFrame) => {
    get().pushUndo('添加参数驱动器');
    invalidateInterpolationCache();
    invalidateParamDriverEvalCache();    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            const baseVal = typeof m.params[paramName] === 'number' ? (m.params[paramName] as number) : 0;
            const { createDefaultParamDriver } = require('../types');
            const driver = createDefaultParamDriver(
              paramName,
              baseVal,
              startFrame ?? k.frame,
              endFrame ?? -1,
            );
            return {
              ...m,
              paramDrivers: [...(m.paramDrivers ?? []), driver],
            };
          }),
        };
      }),
    }));
  },

  removeParamDriver: (keyframeId, modifierId, driverId) => {
    get().pushUndo('删除参数驱动器');
    invalidateInterpolationCache();
    invalidateParamDriverEvalCache();    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramDrivers: (m.paramDrivers ?? []).filter((d) => d.id !== driverId),
            };
          }),
        };
      }),
    }));
  },

  updateParamDriver: (keyframeId, modifierId, driverId, updates) => {
    get().pushUndo('更新参数驱动器');
    invalidateInterpolationCache();
    invalidateParamDriverEvalCache();
    invalidateAnimModifierCache(modifierId);
    const { invalidatePhaseCache } = require('../engine');
    invalidatePhaseCache(driverId);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramDrivers: (m.paramDrivers ?? []).map((d) => {
                if (d.id !== driverId) return d;
                return { ...d, ...updates };
              }),
            };
          }),
        };
      }),
    }));
  },

  toggleParamDriver: (keyframeId, modifierId, driverId) => {
    get().pushUndo('切换参数驱动器');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramDrivers: (m.paramDrivers ?? []).map((d) => {
                if (d.id !== driverId) return d;
                return { ...d, enabled: !d.enabled };
              }),
            };
          }),
        };
      }),
    }));
  },

  bakeParamDriver: (keyframeId, modifierId, driverId) => {
    get().pushUndo('烘焙参数驱动器');
    invalidateAnimModifierCache(modifierId);
    const s = get();
    const kf = s.keyframes.find((k) => k.id === keyframeId);
    if (!kf) return;
    const mod = kf.modifiers.find((m) => m.id === modifierId);
    if (!mod) return;
    const driver = (mod.paramDrivers ?? []).find((d) => d.id === driverId);
    if (!driver || driver.isBaked) return;

    const result = bakeParamDriverToKeyframes(
      driver,
      mod.paramKeyframes ?? [],
      s.totalFrames,
    );

    set((s2) => ({
      keyframes: s2.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramKeyframes: result.paramKeyframes,
              paramDrivers: (m.paramDrivers ?? []).map((d) => {
                if (d.id !== driverId) return d;
                return { ...d, ...result.driverUpdates };
              }),
            };
          }),
        };
      }),
    }));
  },

  unbakeParamDriver: (keyframeId, modifierId, driverId) => {
    get().pushUndo('反烘焙参数驱动器');
    invalidateAnimModifierCache(modifierId);
    const s = get();
    const kf = s.keyframes.find((k) => k.id === keyframeId);
    if (!kf) return;
    const mod = kf.modifiers.find((m) => m.id === modifierId);
    if (!mod) return;
    const driver = (mod.paramDrivers ?? []).find((d) => d.id === driverId);
    if (!driver || !driver.isBaked) return;

    const startFrame = driver.startFrame;
    const endFrame = driver.endFrame >= 0 ? driver.endFrame : s.totalFrames - 1;

    const cleanedPkfs = (mod.paramKeyframes ?? []).filter((pkf) => {
      if (pkf.frame < startFrame || pkf.frame > endFrame) return true;
      const otherKeys = Object.keys(pkf.params).filter((k) => k !== driver.paramName);
      if (otherKeys.length > 0) {
        return true;
      }
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

    set((s2) => ({
      keyframes: s2.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramKeyframes: cleanedPkfs,
              paramDrivers: (m.paramDrivers ?? []).map((d) => {
                if (d.id !== driverId) return d;
                return { ...d, isBaked: false, enabled: true };
              }),
            };
          }),
        };
      }),
    }));
  },
});
