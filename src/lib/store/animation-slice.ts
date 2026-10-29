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
};

export const createAnimationSlice: StateCreator<ProjectStore, [], [], AnimationSlice> = (set, get) => ({

















  addAnimationVariable: (name, scope) => {
    get().pushUndo('添加动画变量');
    invalidateVariableContextCache();
    const variable: AnimationVariable = {
      id: crypto.randomUUID(),
      name,
      scope,
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

    set((s) => ({
      animationVariables: (s.animationVariables ?? []).filter(v => v.id !== variableId),
    }));
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

});
