// ============================================================
// PixelMorpher - Animation Slice
// Part-level animation modifiers, modifier groups, animation param keyframes,
// ParamDriver actions (bake/unbake), animation variables, ParamSource actions,
// wheel reset, parent-child constraints, part keyframes
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import {
  PartAnimationModifier,
  AnimationBlendMode,
  ModifierParamValue,
  ModifierGroup,
  MODIFIER_GROUP_COLORS,
  ParamDriver,
  ParamDriverNumericParam,
  ParamSource,
  ParamDriverKeyframe,
  SecondaryParamDriver,
  AnimationVariable,
  VariableParamSource,
  PartKeyframe,
  ModifierInstance,
  createDefaultPartAnimationModifier,
  ModifierCoordinateMode,
} from '../types';
import {
  invalidateAnimModifierCache,
  invalidatePhaseCache,
  invalidateVariableContextCache,
  validateVariableGraph,
  computeKeyframeBaseTransform,
  computeGlobalModifierTransform,
} from '../engine';

export type AnimationSlice = {
  addAnimationVariable: ProjectStore['addAnimationVariable'];
  removeAnimationVariable: ProjectStore['removeAnimationVariable'];
  updateAnimationVariable: ProjectStore['updateAnimationVariable'];
  renameAnimationVariable: ProjectStore['renameAnimationVariable'];
  setVariableWriter: ProjectStore['setVariableWriter'];
  setParamDriverSource: ProjectStore['setParamDriverSource'];
  clearParamDriverSource: ProjectStore['clearParamDriverSource'];
  updateParamDriverKeyframes: ProjectStore['updateParamDriverKeyframes'];
  updateSecondaryDriver: ProjectStore['updateSecondaryDriver'];
};

export const createAnimationSlice: StateCreator<ProjectStore, [], [], AnimationSlice> = (set, get) => ({

















  addAnimationVariable: (name, scope, partId) => {
    get().pushUndo('添加动画变量');
    invalidateVariableContextCache();
    const variable: AnimationVariable = {
      id: crypto.randomUUID(),
      name,
      scope,
      partId: scope === 'part' ? partId : undefined,
      writerDriverId: '',
      defaultValue: 0,
    };
    set((s) => ({
      animationVariables: [...(s.animationVariables ?? []), variable],
    }));
    return variable;
  },

  removeAnimationVariable: (variableId) => {
    get().pushUndo('删除动画变量');
    invalidateVariableContextCache();
    const s = get();
    const variable = (s.animationVariables ?? []).find(v => v.id === variableId);
    if (!variable) return;

    set((s) => {
      const keyframes = s.keyframes.map(kf => ({
        ...kf,
        modifiers: kf.modifiers.map(mod => ({
          ...mod,
          paramDrivers: (mod.paramDrivers ?? []).map(d => {
            if (!d.paramSources) return d;
            const newSources = { ...d.paramSources };
            let changed = false;
            for (const [param, source] of Object.entries(newSources)) {
              if ((source as ParamSource).type === 'variable' && (source as VariableParamSource).variableId === variableId) {
                delete newSources[param as ParamDriverNumericParam];
                changed = true;
              }
            }
            return changed ? { ...d, paramSources: newSources } : d;
          }),
        })),
      }));

      return {
        animationVariables: (s.animationVariables ?? []).filter(v => v.id !== variableId),
        keyframes,
      };
    });
  },

  updateAnimationVariable: (variableId, updates) => {
    get().pushUndo('更新动画变量');
    invalidateVariableContextCache();
    set((s) => ({
      animationVariables: (s.animationVariables ?? []).map(v =>
        v.id === variableId ? { ...v, ...updates } : v
      ),
    }));
  },

  renameAnimationVariable: (variableId, name) => {
    set((s) => ({
      animationVariables: (s.animationVariables ?? []).map(v =>
        v.id === variableId ? { ...v, name } : v
      ),
    }));
  },

  setVariableWriter: (variableId, writerDriverId) => {
    const s = get();
    const variables = s.animationVariables ?? [];

    const driverMap = new Map<string, ParamDriver>();
    for (const kf of s.keyframes) {
      for (const mod of kf.modifiers) {
        if (mod.paramDrivers) {
          for (const d of mod.paramDrivers) driverMap.set(d.id, d);
        }
      }
    }

    const tempVariables = variables.map(v =>
      v.id === variableId ? { ...v, writerDriverId } : v
    );
    const validation = validateVariableGraph(tempVariables, driverMap);
    if (!validation.valid) {
      return false;
    }

    get().pushUndo('设置变量写入者');
    invalidateVariableContextCache();
    set((s) => ({
      animationVariables: (s.animationVariables ?? []).map(v =>
        v.id === variableId ? { ...v, writerDriverId } : v
      ),
    }));
    return true;
  },

  setParamDriverSource: (keyframeId, modifierId, driverId, param, source) => {
    get().pushUndo('设置参数来源');
    invalidatePhaseCache(driverId);
    if (source.type === 'variable') {
      const s = get();
      const variables = s.animationVariables ?? [];
      const selfLoop = variables.some(v =>
        v.writerDriverId === driverId && v.id === source.variableId
      );
      if (selfLoop) return;
    }

    set((s) => ({
      keyframes: s.keyframes.map(k => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map(m => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramDrivers: (m.paramDrivers ?? []).map(d => {
                if (d.id !== driverId) return d;
                return {
                  ...d,
                  paramSources: { ...d.paramSources, [param]: source },
                };
              }),
            };
          }),
        };
      }),
    }));
  },

  clearParamDriverSource: (keyframeId, modifierId, driverId, param) => {
    get().pushUndo('清除参数来源');
    invalidatePhaseCache(driverId);
    set((s) => ({
      keyframes: s.keyframes.map(k => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map(m => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramDrivers: (m.paramDrivers ?? []).map(d => {
                if (d.id !== driverId) return d;
                const newSources = { ...d.paramSources };
                delete newSources[param];
                if (Object.keys(newSources).length === 0) {
                  return { ...d, paramSources: undefined };
                }
                return { ...d, paramSources: newSources };
              }),
            };
          }),
        };
      }),
    }));
  },

  updateParamDriverKeyframes: (keyframeId, modifierId, driverId, param, keyframes) => {
    get().pushUndo('更新参数关键帧');
    invalidatePhaseCache(driverId);
    set((s) => ({
      keyframes: s.keyframes.map(k => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map(m => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramDrivers: (m.paramDrivers ?? []).map(d => {
                if (d.id !== driverId) return d;
                const currentSource = d.paramSources?.[param];
                if (currentSource?.type === 'keyframes') {
                  return {
                    ...d,
                    paramSources: {
                      ...d.paramSources,
                      [param]: { ...currentSource, keyframes },
                    },
                  };
                }
                return d;
              }),
            };
          }),
        };
      }),
    }));
  },

  updateSecondaryDriver: (keyframeId, modifierId, driverId, param, updates) => {
    get().pushUndo('更新二级驱动器');
    invalidatePhaseCache(driverId);
    set((s) => ({
      keyframes: s.keyframes.map(k => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map(m => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramDrivers: (m.paramDrivers ?? []).map(d => {
                if (d.id !== driverId) return d;
                const currentSource = d.paramSources?.[param];
                if (currentSource?.type === 'secondary_driver') {
                  return {
                    ...d,
                    paramSources: {
                      ...d.paramSources,
                      [param]: {
                        ...currentSource,
                        driver: { ...currentSource.driver, ...updates },
                      },
                    },
                  };
                }
                return d;
              }),
            };
          }),
        };
      }),
    }));
  },
});
