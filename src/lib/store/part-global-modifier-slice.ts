// ============================================================
// PixelMorpher - Part Global Modifier Slice
// V13: Part-level global modifiers — persistent transform/animation
// modifiers that always apply to a specific part across all frames.
// Stored on Part.globalModifiers[], evaluated before keyframe base
// transforms in the render pipeline.
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import type { GlobalModifier, GlobalModifierType, ModifierParamValue } from '../types';
import { GLOBAL_MODIFIER_DEFINITIONS } from '../types';
import { _isDragActive } from './shared';

export interface PartGlobalModifierSlice {
  // ---- Part global modifier CRUD ----
  addPartGlobalModifier: (partId: string, type: GlobalModifierType) => GlobalModifier;
  removePartGlobalModifier: (partId: string, modifierId: string) => void;
  updatePartGlobalModifier: (partId: string, modifierId: string, updates: Partial<GlobalModifier>) => void;
  updatePartGlobalModifierParams: (partId: string, modifierId: string, params: Record<string, ModifierParamValue>) => void;
  togglePartGlobalModifier: (partId: string, modifierId: string) => void;
  reorderPartGlobalModifier: (partId: string, modifierId: string, direction: 'up' | 'down') => void;
}

export const createPartGlobalModifierSlice: StateCreator<ProjectStore, [], [], PartGlobalModifierSlice> = (set, get) => ({
  addPartGlobalModifier: (partId, type) => {
    if (!_isDragActive) {
      get().pushUndo('添加部件全局修改器');
    }

    const def = GLOBAL_MODIFIER_DEFINITIONS.find((d) => d.type === type);
    const defaultParams: Record<string, ModifierParamValue> = {};
    if (def) {
      for (const p of def.params) {
        defaultParams[p.name] = p.default;
      }
    }

    const modifier: GlobalModifier = {
      id: crypto.randomUUID(),
      type,
      name: def?.label ?? type,
      enabled: true,
      collapsed: false,
      params: defaultParams,
      startFrame: -1,
      endFrame: -1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      blendMode: 'add',
    };

    set((s) => ({
      parts: s.parts.map((p) =>
        p.id === partId
          ? { ...p, globalModifiers: [...(p.globalModifiers || []), modifier] }
          : p
      ),
    }));

    return modifier;
  },

  removePartGlobalModifier: (partId, modifierId) => {
    if (!_isDragActive) {
      get().pushUndo('删除部件全局修改器');
    }
    set((s) => ({
      parts: s.parts.map((p) =>
        p.id === partId
          ? { ...p, globalModifiers: (p.globalModifiers || []).filter((m) => m.id !== modifierId) }
          : p
      ),
    }));
  },

  updatePartGlobalModifier: (partId, modifierId, updates) => {
    set((s) => ({
      parts: s.parts.map((p) =>
        p.id === partId
          ? {
              ...p,
              globalModifiers: (p.globalModifiers || []).map((m) =>
                m.id === modifierId ? { ...m, ...updates } : m
              ),
            }
          : p
      ),
    }));
  },

  updatePartGlobalModifierParams: (partId, modifierId, params) => {
    set((s) => ({
      parts: s.parts.map((p) =>
        p.id === partId
          ? {
              ...p,
              globalModifiers: (p.globalModifiers || []).map((m) =>
                m.id === modifierId ? { ...m, params: { ...m.params, ...params } } : m
              ),
            }
          : p
      ),
    }));
  },

  togglePartGlobalModifier: (partId, modifierId) => {
    set((s) => ({
      parts: s.parts.map((p) =>
        p.id === partId
          ? {
              ...p,
              globalModifiers: (p.globalModifiers || []).map((m) =>
                m.id === modifierId ? { ...m, enabled: !m.enabled } : m
              ),
            }
          : p
      ),
    }));
  },

  reorderPartGlobalModifier: (partId, modifierId, direction) => {
    set((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== partId) return p;
        const mods = [...(p.globalModifiers || [])];
        const idx = mods.findIndex((m) => m.id === modifierId);
        if (idx < 0) return p;
        const newIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= mods.length) return p;
        [mods[idx], mods[newIdx]] = [mods[newIdx], mods[idx]];
        return { ...p, globalModifiers: mods };
      }),
    }));
  },
});
