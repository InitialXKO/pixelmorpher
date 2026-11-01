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
import { modifiersToBlueprint, addModifierNodeToBlueprint, removeModifierNodeFromBlueprint } from '../blueprint/migrate';
import type { BlueprintGraph } from '../blueprint/ir';

export interface GlobalModifierSlice {
  globalModifiers: GlobalModifier[];
  globalBlueprint: import('../blueprint/ir').BlueprintGraph | null;
  addGlobalModifier: (type: GlobalModifierType) => GlobalModifier;
  removeGlobalModifier: (id: string) => void;
  updateGlobalModifier: (id: string, updates: Partial<GlobalModifier>) => void;
  updateGlobalModifierParams: (id: string, params: Record<string, ModifierParamValue>) => void;
  toggleGlobalModifier: (id: string) => void;
  reorderGlobalModifier: (id: string, direction: 'up' | 'down') => void;
  setGlobalBlueprint: (g: import('../blueprint/ir').BlueprintGraph | null) => void;
}

export const createGlobalModifierSlice: StateCreator<ProjectStore, [], [], GlobalModifierSlice> = (set, get) => ({
  globalModifiers: [],
  globalBlueprint: null,

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

    // 先在本地拼好新列表、一次写入：set 之后再 get() 读到的是已含
    // 新修改器的列表，蓝图为空分支若在该列表上再追加一遍 modifier，
    // 新修改器会被计两遍（蓝图里双节点）。本地拼装保证列表与蓝图
    // 构建吃同一份数据。
    const nextModifiers = [...(get().globalModifiers || []), modifier];
    set({ globalModifiers: nextModifiers });

    // 手术式同步蓝图
    try {
      const bp = get().globalBlueprint;
      const newBp = bp
        ? addModifierNodeToBlueprint(bp, modifier as any)
        : modifiersToBlueprint(nextModifiers as any);
      if (newBp) set({ globalBlueprint: newBp });
    } catch {}

    return modifier;
  },

  removeGlobalModifier: (id) => {
    if (!_isDragActive) {
      get().pushUndo('删除全局修改器');
    }
    set((s) => ({
      globalModifiers: (s.globalModifiers || []).filter((m) => m.id !== id),
    }));
    // 手术式从蓝图移除
    try {
      const bp = get().globalBlueprint;
      if (bp) {
        const newBp = removeModifierNodeFromBlueprint(bp, id);
        set({ globalBlueprint: newBp });
      }
    } catch {}
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

  setGlobalBlueprint: (g) => {
    set({ globalBlueprint: g });
  },
});
