// ============================================================
// PixelMorpher - Global Modifier Slice
// V12: Global modifiers apply transform effects to ALL parts
// simultaneously. Stored at project level, evaluated per-frame.
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import type { GlobalModifier, GlobalModifierType, ModifierParamValue } from '../types';
import { GLOBAL_MODIFIER_DEFINITIONS } from '../types';
import { _isDragActive, setDragActive, setDragPostStackLen, _dragPostStackLen } from './shared';

export interface GlobalModifierSlice {
  globalModifiers: GlobalModifier[];
  addGlobalModifier: (type: GlobalModifierType) => GlobalModifier;
  removeGlobalModifier: (id: string) => void;
  updateGlobalModifier: (id: string, updates: Partial<GlobalModifier>) => void;
  updateGlobalModifierParams: (id: string, params: Record<string, ModifierParamValue>) => void;
  toggleGlobalModifier: (id: string) => void;
  reorderGlobalModifier: (id: string, direction: 'up' | 'down') => void;
}

export const createGlobalModifierSlice: StateCreator<ProjectStore, [], [], GlobalModifierSlice> = (set, get) => ({
  globalModifiers: [],

  addGlobalModifier: (type) => {
    if (!_isDragActive) {
      get().pushUndo('添加全局修改器');
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
      globalModifiers: [...(s.globalModifiers || []), modifier],
    }));

    return modifier;
  },

  removeGlobalModifier: (id) => {
    if (!_isDragActive) {
      get().pushUndo('删除全局修改器');
    }
    set((s) => ({
      globalModifiers: (s.globalModifiers || []).filter((m) => m.id !== id),
    }));
  },

  updateGlobalModifier: (id, updates) => {
    set((s) => ({
      globalModifiers: (s.globalModifiers || []).map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    }));
  },

  updateGlobalModifierParams: (id, params) => {
    set((s) => ({
      globalModifiers: (s.globalModifiers || []).map((m) =>
        m.id === id ? { ...m, params: { ...m.params, ...params } } : m
      ),
    }));
  },

  toggleGlobalModifier: (id) => {
    set((s) => ({
      globalModifiers: (s.globalModifiers || []).map((m) =>
        m.id === id ? { ...m, enabled: !m.enabled } : m
      ),
    }));
  },

  reorderGlobalModifier: (id, direction) => {
    set((s) => {
      const mods = [...(s.globalModifiers || [])];
      const idx = mods.findIndex((m) => m.id === id);
      if (idx < 0) return {};
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= mods.length) return {};
      [mods[idx], mods[newIdx]] = [mods[newIdx], mods[idx]];
      return { globalModifiers: mods };
    });
  },
});
