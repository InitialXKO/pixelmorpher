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
  addPartAnimationModifier: ProjectStore['addPartAnimationModifier'];
  removePartAnimationModifier: ProjectStore['removePartAnimationModifier'];
  updatePartAnimationModifier: ProjectStore['updatePartAnimationModifier'];
  togglePartAnimationModifier: ProjectStore['togglePartAnimationModifier'];
  togglePartAnimationModifierCollapsed: ProjectStore['togglePartAnimationModifierCollapsed'];
  updatePartAnimationModifierRange: ProjectStore['updatePartAnimationModifierRange'];
  reorderPartAnimationModifier: ProjectStore['reorderPartAnimationModifier'];
  addModifierGroup: ProjectStore['addModifierGroup'];
  removeModifierGroup: ProjectStore['removeModifierGroup'];
  updateModifierGroup: ProjectStore['updateModifierGroup'];
  toggleModifierGroup: ProjectStore['toggleModifierGroup'];
  toggleModifierGroupCollapsed: ProjectStore['toggleModifierGroupCollapsed'];
  reorderModifierGroup: ProjectStore['reorderModifierGroup'];
  moveModifierToGroup: ProjectStore['moveModifierToGroup'];
  addAnimModifierParamKeyframe: ProjectStore['addAnimModifierParamKeyframe'];
  removeAnimModifierParamKeyframe: ProjectStore['removeAnimModifierParamKeyframe'];
  addAnimParamDriver: ProjectStore['addAnimParamDriver'];
  removeAnimParamDriver: ProjectStore['removeAnimParamDriver'];
  updateAnimParamDriver: ProjectStore['updateAnimParamDriver'];
  toggleAnimParamDriver: ProjectStore['toggleAnimParamDriver'];
  bakeAnimParamDriver: ProjectStore['bakeAnimParamDriver'];
  unbakeAnimParamDriver: ProjectStore['unbakeAnimParamDriver'];
  resetWheelAngularVelocity: ProjectStore['resetWheelAngularVelocity'];
  setPartParent: ProjectStore['setPartParent'];
  getPartWorldTransform: ProjectStore['getPartWorldTransform'];
  addPartKeyframe: ProjectStore['addPartKeyframe'];
  removePartKeyframe: ProjectStore['removePartKeyframe'];
  updatePartKeyframe: ProjectStore['updatePartKeyframe'];
  getPartKeyframeAtFrame: ProjectStore['getPartKeyframeAtFrame'];
  getSurroundingPartKeyframes: ProjectStore['getSurroundingPartKeyframes'];
  resolvePartEditModifiers: ProjectStore['resolvePartEditModifiers'];
  ensurePartKeyframe: ProjectStore['ensurePartKeyframe'];
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
  addPartAnimationModifier: (partId, type) => {
    get().pushUndo('添加部件动画修改器');
    const mod = createDefaultPartAnimationModifier(type);
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: [...(p.animationModifiers || []), mod],
        };
      }),
    }));
    return mod;
  },

  removePartAnimationModifier: (partId, modifierId) => {
    get().pushUndo('删除部件动画修改器');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: (p.animationModifiers || []).filter((m) => m.id !== modifierId),
        };
      }),
    }));
  },

  updatePartAnimationModifier: (partId, modifierId, params) => {
    get().pushUndo('更新部件动画修改器', 'updatePartAnimationModifier');
    invalidateAnimModifierCache(modifierId);
    const { blendMode, ...restParams } = params as any;
    const actualParams = restParams as Record<string, ModifierParamValue>;

    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: (p.animationModifiers || []).map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              params: { ...m.params, ...actualParams },
              ...(blendMode !== undefined && { blendMode: blendMode as AnimationBlendMode }),
            };
          }),
        };
      }),
    }));
  },

  togglePartAnimationModifier: (partId, modifierId) => {
    get().pushUndo('切换部件动画修改器');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: (p.animationModifiers || []).map((m) => {
            if (m.id !== modifierId) return m;
            return { ...m, enabled: !m.enabled };
          }),
        };
      }),
    }));
  },

  togglePartAnimationModifierCollapsed: (partId, modifierId) => set((s) => ({
    parts: s.parts.map((p) => {
      if (p.id !== partId) return p;
      return {
        ...p,
        animationModifiers: (p.animationModifiers || []).map((m) => {
          if (m.id !== modifierId) return m;
          return { ...m, collapsed: !m.collapsed };
        }),
      };
    }),
  })),

  updatePartAnimationModifierRange: (partId, modifierId, range) => {
    get().pushUndo('更新部件动画修改器范围');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: (p.animationModifiers || []).map((m) => {
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

  reorderPartAnimationModifier: (partId, modifierId, newIndex) => {
    get().pushUndo('重排部件动画修改器');
    set((s) => ({
    parts: s.parts.map((p) => {
      if (p.id !== partId) return p;
      const mods = [...(p.animationModifiers || [])];
      const oldIndex = mods.findIndex((m) => m.id === modifierId);
      if (oldIndex === -1) return p;
      const [removed] = mods.splice(oldIndex, 1);
      mods.splice(newIndex, 0, removed);
      return { ...p, animationModifiers: mods };
    }),
    }));
  },

  addModifierGroup: (partId, name) => {
    get().pushUndo('添加修改器组');
    const part = get().parts.find(p => p.id === partId);
    const existingGroups = part?.modifierGroups || [];
    const colorIndex = existingGroups.length % MODIFIER_GROUP_COLORS.length;
    const group: ModifierGroup = {
      id: crypto.randomUUID(),
      name,
      enabled: true,
      collapsed: false,
      color: MODIFIER_GROUP_COLORS[colorIndex],
      order: existingGroups.length,
    };
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          modifierGroups: [...(p.modifierGroups || []), group],
        };
      }),
    }));
    return group;
  },

  removeModifierGroup: (partId, groupId) => {
    get().pushUndo('删除修改器组');
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          modifierGroups: (p.modifierGroups || []).filter(g => g.id !== groupId),
          animationModifiers: (p.animationModifiers || []).map(m =>
            m.groupId === groupId ? { ...m, groupId: null } : m
          ),
        };
      }),
    }));
  },

  updateModifierGroup: (partId, groupId, updates) => {
    get().pushUndo('更新修改器组');
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          modifierGroups: (p.modifierGroups || []).map(g =>
            g.id === groupId ? { ...g, ...updates } : g
          ),
        };
      }),
    }));
  },

  toggleModifierGroup: (partId, groupId) => {
    get().pushUndo('切换修改器组');
    const part = get().parts.find(p => p.id === partId);
    const group = (part?.modifierGroups || []).find(g => g.id === groupId);
    if (!group) return;
    const newEnabled = !group.enabled;
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          modifierGroups: (p.modifierGroups || []).map(g =>
            g.id === groupId ? { ...g, enabled: newEnabled } : g
          ),
          animationModifiers: (p.animationModifiers || []).map(m =>
            m.groupId === groupId ? { ...m, enabled: newEnabled } : m
          ),
        };
      }),
    }));
  },

  toggleModifierGroupCollapsed: (partId, groupId) => {
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          modifierGroups: (p.modifierGroups || []).map(g =>
            g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
          ),
        };
      }),
    }));
  },

  reorderModifierGroup: (partId, groupId, newIndex) => {
    get().pushUndo('重排修改器组');
    set((s) => ({
    parts: s.parts.map((p) => {
      if (p.id !== partId) return p;
      const groups = [...(p.modifierGroups || [])];
      const oldIndex = groups.findIndex(g => g.id === groupId);
      if (oldIndex === -1) return p;
      const [removed] = groups.splice(oldIndex, 1);
      groups.splice(newIndex, 0, removed);
      const reordered = groups.map((g, i) => ({ ...g, order: i }));
      return { ...p, modifierGroups: reordered };
    }),
    }));
  },

  moveModifierToGroup: (partId, modifierId, groupId) => {
    get().pushUndo('移动修改器到组');
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: (p.animationModifiers || []).map(m =>
            m.id === modifierId ? { ...m, groupId } : m
          ),
        };
      }),
    }));
  },

  addAnimModifierParamKeyframe: (partId, modifierId, frame, params) => {
    get().pushUndo('添加动画参数关键帧');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: p.animationModifiers.map((m) => {
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

  removeAnimModifierParamKeyframe: (partId, modifierId, paramKfId) => {
    get().pushUndo('删除动画参数关键帧');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: p.animationModifiers.map((m) => {
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

  addAnimParamDriver: (partId, modifierId, paramName, startFrame, endFrame) => {
    get().pushUndo('添加动画参数驱动器');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: p.animationModifiers.map((m) => {
            if (m.id !== modifierId) return m;
            const baseVal = typeof m.params[paramName] === 'number' ? (m.params[paramName] as number) : 0;
            const { createDefaultParamDriver } = require('../types');
            const driver = createDefaultParamDriver(
              paramName,
              baseVal,
              startFrame ?? 0,
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

  removeAnimParamDriver: (partId, modifierId, driverId) => {
    get().pushUndo('删除动画参数驱动器');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: p.animationModifiers.map((m) => {
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

  updateAnimParamDriver: (partId, modifierId, driverId, updates) => {
    get().pushUndo('更新动画参数驱动器');
    invalidateAnimModifierCache(modifierId);
    invalidatePhaseCache(driverId);
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: p.animationModifiers.map((m) => {
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

  toggleAnimParamDriver: (partId, modifierId, driverId) => {
    get().pushUndo('切换动画参数驱动器');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: p.animationModifiers.map((m) => {
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

  bakeAnimParamDriver: (partId, modifierId, driverId) => {
    get().pushUndo('烘焙动画参数驱动器');
    invalidateAnimModifierCache(modifierId);
    const s = get();
    const part = s.parts.find(p => p.id === partId);
    if (!part) return;
    const mod = part.animationModifiers.find(m => m.id === modifierId);
    if (!mod) return;
    const driver = (mod.paramDrivers ?? []).find(d => d.id === driverId);
    if (!driver || driver.isBaked) return;

    const { bakeParamDriverToKeyframes } = require('../engine');
    const result = bakeParamDriverToKeyframes(
      driver,
      mod.paramKeyframes ?? [],
      s.totalFrames,
    );
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: p.animationModifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramKeyframes: result.paramKeyframes,
              paramDrivers: (m.paramDrivers ?? []).map((d) => {
                if (d.id !== driverId) return d;
                return { ...d, isBaked: true, enabled: false };
              }),
            };
          }),
        };
      }),
    }));
  },

  unbakeAnimParamDriver: (partId, modifierId, driverId) => {
    get().pushUndo('解焙动画参数驱动器');
    invalidateAnimModifierCache(modifierId);
    const s = get();
    const part = s.parts.find(p => p.id === partId);
    if (!part) return;
    const mod = part.animationModifiers.find(m => m.id === modifierId);
    if (!mod) return;
    const driver = (mod.paramDrivers ?? []).find(d => d.id === driverId);
    if (!driver || !driver.isBaked) return;

    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: p.animationModifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramKeyframes: [],
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

  resetWheelAngularVelocity: (partId, modifierId) => {
    get().pushUndo('重置轮角速度');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        return {
          ...p,
          animationModifiers: (p.animationModifiers || []).map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              params: { ...m.params, angularVelocity: 0 },
            };
          }),
        };
      }),
    }));
  },

  setPartParent: (partId, parentId) => {
    get().pushUndo('设置父级部件');
    set((s) => ({
    parts: s.parts.map((p) => {
      if (p.id !== partId) return p;
      if (parentId) {
        let current: string | null = parentId;
        while (current) {
          if (current === partId) return p;
          const parentPart = s.parts.find(pp => pp.id === current);
          current = parentPart?.parentId ?? null;
        }
      }
      return { ...p, parentId };
    }),
    }));
  },

  getPartWorldTransform: (partId, frame) => {
    const s = get();
    const part = s.parts.find(p => p.id === partId);
    if (!part) return { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };

    // V13: Include part-level global modifiers in world transform
    const partGlobalTransform = (part.globalModifiers && part.globalModifiers.length > 0)
      ? computeGlobalModifierTransform(part.globalModifiers, frame, s.frameRate)
      : { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };

    const parentPart = part.parentId ? s.parts.find(p => p.id === part.parentId) : null;
    if (part.parentId && parentPart) {
      const keyframe = s.keyframes.find(k => k.partId === partId && k.frame === frame);
      let localTransform = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
      if (keyframe) {
        const kfBase = computeKeyframeBaseTransform(keyframe.modifiers.filter(m => m.enabled));
        localTransform = { translateX: kfBase.translateX, translateY: kfBase.translateY, rotation: kfBase.rotation, scaleX: kfBase.scaleX, scaleY: kfBase.scaleY };
      }

      // Apply part global modifiers to local transform
      localTransform = {
        translateX: localTransform.translateX + partGlobalTransform.translateX,
        translateY: localTransform.translateY + partGlobalTransform.translateY,
        rotation: localTransform.rotation + partGlobalTransform.rotation,
        scaleX: localTransform.scaleX * partGlobalTransform.scaleX,
        scaleY: localTransform.scaleY * partGlobalTransform.scaleY,
      };

      const parentWorld = get().getPartWorldTransform(part.parentId, frame);

      const rad = (parentWorld.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const worldTX = parentWorld.translateX + (localTransform.translateX * cos - localTransform.translateY * sin) * parentWorld.scaleX;
      const worldTY = parentWorld.translateY + (localTransform.translateX * sin + localTransform.translateY * cos) * parentWorld.scaleY;
      const worldRotation = parentWorld.rotation + localTransform.rotation;
      const worldScaleX = parentWorld.scaleX * localTransform.scaleX;
      const worldScaleY = parentWorld.scaleY * localTransform.scaleY;

      return { translateX: worldTX, translateY: worldTY, rotation: worldRotation, scaleX: worldScaleX, scaleY: worldScaleY };
    }

    const keyframe = s.keyframes.find(k => k.partId === partId && k.frame === frame);
    if (keyframe) {
      const kfBase = computeKeyframeBaseTransform(keyframe.modifiers.filter(m => m.enabled));
      return {
        translateX: kfBase.translateX + partGlobalTransform.translateX,
        translateY: kfBase.translateY + partGlobalTransform.translateY,
        rotation: kfBase.rotation + partGlobalTransform.rotation,
        scaleX: kfBase.scaleX * partGlobalTransform.scaleX,
        scaleY: kfBase.scaleY * partGlobalTransform.scaleY,
      };
    }

    // No keyframe — return just the part global modifier transform + offsets
    return partGlobalTransform;
  },

  addPartKeyframe: (partId: string, frame: number) => {
    get().pushUndo('添加部件关键帧');
    const id = crypto.randomUUID();
    const part = get().parts.find(p => p.id === partId);
    if (!part) return '';

    const existing = (part.partKeyframes || []).find(pkf => pkf.frame === frame);
    if (existing) return existing.id;

    const resolvedMods = get().resolvePartEditModifiers(partId, frame);
    const newPkf: PartKeyframe = {
      id,
      frame,
      editModifiers: resolvedMods.map(m => ({
        ...m,
        id: crypto.randomUUID(),
        params: {
          ...m.params,
          ...(m.params.brushCommands ? { brushCommands: JSON.parse(JSON.stringify(m.params.brushCommands)) } : {}),
        },
      })),
    };

    set((s) => ({
      parts: s.parts.map(p => p.id === partId
        ? { ...p, partKeyframes: [...(p.partKeyframes || []), newPkf].sort((a, b) => a.frame - b.frame) }
        : p
      ),
    }));
    return id;
  },

  removePartKeyframe: (partId: string, partKeyframeId: string) => {
    get().pushUndo('删除部件关键帧');
    set((s) => ({
      parts: s.parts.map(p => p.id === partId
        ? { ...p, partKeyframes: (p.partKeyframes || []).filter(pkf => pkf.id !== partKeyframeId) }
        : p
      ),
    }));
  },

  updatePartKeyframe: (partId: string, partKeyframeId: string, updates) => {
    get().pushUndo('更新部件关键帧', 'updatePartKeyframe');
    set((s) => ({
      parts: s.parts.map(p => p.id === partId
        ? {
            ...p,
            partKeyframes: (p.partKeyframes || []).map(pkf =>
              pkf.id === partKeyframeId ? { ...pkf, ...updates } : pkf
            ),
          }
        : p
      ),
    }));
  },

  getPartKeyframeAtFrame: (partId: string, frame: number) => {
    const part = get().parts.find(p => p.id === partId);
    if (!part) return undefined;
    return (part.partKeyframes || []).find(pkf => pkf.frame === frame);
  },

  getSurroundingPartKeyframes: (partId: string, frame: number) => {
    const part = get().parts.find(p => p.id === partId);
    if (!part) return { prev: null, next: null };
    const pkfs = (part.partKeyframes || []).sort((a, b) => a.frame - b.frame);
    let prev: PartKeyframe | null = null;
    let next: PartKeyframe | null = null;
    for (const pkf of pkfs) {
      if (pkf.frame <= frame) prev = pkf;
      if (pkf.frame > frame && !next) next = pkf;
    }
    return { prev, next };
  },

  resolvePartEditModifiers: (partId: string, frame: number) => {
    const part = get().parts.find(p => p.id === partId);
    if (!part) return [];
    const pkfs = part.partKeyframes || [];
    if (pkfs.length === 0) return part.editModifiers || [];
    const sorted = [...pkfs].sort((a, b) => a.frame - b.frame);
    let active: PartKeyframe | null = null;
    for (const pkf of sorted) {
      if (pkf.frame <= frame) active = pkf;
      else break;
    }
    return active ? active.editModifiers : (part.editModifiers || []);
  },

  ensurePartKeyframe: (partId: string, frame: number) => {
    const existing = get().getPartKeyframeAtFrame(partId, frame);
    if (existing) return existing.id;
    return get().addPartKeyframe(partId, frame);
  },

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
