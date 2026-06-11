// ============================================================
// PixelMorpher - Part Slice
// Part CRUD, pixel editing, resize, split, duplicate, reorder, pivot estimation
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import {
  Part,
  Track,
  PixelGrid,
  PixelColor,
  createEmptyPixelGrid,
} from '../types';
import { markPartDirty, invalidateAnimModifierCache } from '../engine';
import { rgbaToHexOrNull } from '@/lib/engine/utils';

export type PartSlice = {
  addPart: ProjectStore['addPart'];
  removePart: ProjectStore['removePart'];
  updatePart: ProjectStore['updatePart'];
  setPartPixels: ProjectStore['setPartPixels'];
  duplicatePart: ProjectStore['duplicatePart'];
  reorderPart: ProjectStore['reorderPart'];
  importPartFromImage: ProjectStore['importPartFromImage'];
  resizePart: ProjectStore['resizePart'];
  splitImageToParts: ProjectStore['splitImageToParts'];
  autoEstimatePivot: ProjectStore['autoEstimatePivot'];
  // Track actions (closely related to parts)
  toggleTrackVisibility: ProjectStore['toggleTrackVisibility'];
  toggleTrackLock: ProjectStore['toggleTrackLock'];
  toggleTrackExpanded: ProjectStore['toggleTrackExpanded'];
};

export const createPartSlice: StateCreator<ProjectStore, [], [], PartSlice> = (set, get) => ({
  addPart: (name, width, height, opts) => {
    get().pushUndo('添加部件');
    const id = crypto.randomUUID();
    const pixels = createEmptyPixelGrid(width, height);
    const part: Part = {
      id,
      name,
      width,
      height,
      pixels,
      pivotX: opts?.pivotX ?? Math.floor(width / 2),
      pivotY: opts?.pivotY ?? Math.floor(height / 2),
      offsetX: 0,
      offsetY: 0,
      zIndex: get().parts.length,
      visible: true,
      locked: false,
      animationModifiers: [],
      modifierGroups: [],
      parentId: null,
      editModifiers: [],
      partKeyframes: [],
      globalModifiers: [],
    };
    const track: Track = {
      id: crypto.randomUUID(),
      partId: id,
      visible: true,
      locked: false,
      expanded: true,
    };
    set((s) => ({
      parts: [...s.parts, part],
      tracks: [...s.tracks, track],
    }));
    return part;
  },

  removePart: (id) => {
    get().pushUndo('删除部件');
    // V3.1: Clean up animation modifier caches for this part
    const part = get().parts.find(p => p.id === id);
    if (part && part.animationModifiers) {
      for (const am of part.animationModifiers) {
        invalidateAnimModifierCache(am.id);
      }
    }
    set((s) => ({
      parts: s.parts.filter((p) => p.id !== id).map((p) =>
        // V3.7: Clear parentId references to the deleted part
        p.parentId === id ? { ...p, parentId: null } : p
      ),
      tracks: s.tracks.filter((t) => t.partId !== id),
      keyframes: s.keyframes.filter((k) => k.partId !== id),
      trajectories: s.trajectories.filter((t) => t.partId !== id),
      motionBlurStrokes: s.motionBlurStrokes.filter((s2) => s2.partId !== id),
      effectStrokes: s.effectStrokes.filter((e) => e.partId !== id),
    }));
  },

  updatePart: (id, updates) => {
    get().pushUndo('更新部件', 'updatePart');
    // B8: Mark part as dirty so canvas gets rebuilt
    markPartDirty(id);
    set((s) => ({
    parts: s.parts.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
  },

  setPartPixels: (id, pixels) => {
    get().pushUndo('设置部件像素', 'setPartPixels');
    // B8: Mark part as dirty so canvas gets rebuilt
    markPartDirty(id);
    set((s) => ({
    parts: s.parts.map((p) => (p.id === id ? { ...p, pixels } : p)),
    }));
  },

  duplicatePart: (id) => {
    get().pushUndo('复制部件');
    const part = get().parts.find((p) => p.id === id);
    if (!part) return;
    const newId = crypto.randomUUID();
    const newPart: Part = {
      ...part,
      id: newId,
      name: `${part.name} (副本)`,
      zIndex: get().parts.length,
      pixels: part.pixels.map((row) => [...row]),
      animationModifiers: (part.animationModifiers || []).map((am) => ({
        ...am,
        id: crypto.randomUUID(),
        params: { ...am.params },
        // M7: Deep-copy paramKeyframes and paramDrivers with new IDs
        paramKeyframes: (am.paramKeyframes ?? []).map(pk => ({ ...pk, id: crypto.randomUUID() })),
        paramDrivers: (am.paramDrivers ?? []).map(pd => ({ ...pd, id: crypto.randomUUID() })),
      })),
      modifierGroups: (part.modifierGroups || []).map((g) => ({
        ...g,
        id: crypto.randomUUID(),
      })),
      // V4.1: Deep-copy part keyframes
      partKeyframes: (part.partKeyframes || []).map((pkf) => ({
        ...pkf,
        id: crypto.randomUUID(),
        editModifiers: pkf.editModifiers.map((m) => ({
          ...m,
          id: crypto.randomUUID(),
          params: {
            ...m.params,
            ...(m.params.brushCommands ? { brushCommands: JSON.parse(JSON.stringify(m.params.brushCommands)) } : {}),
          },
        })),
      })),
      // V13: Deep-copy part global modifiers with new IDs
      globalModifiers: (part.globalModifiers || []).map((gm) => ({
        ...gm,
        id: crypto.randomUUID(),
        params: { ...gm.params },
        paramKeyframes: (gm.paramKeyframes ?? []).map(pk => ({ ...pk, id: crypto.randomUUID() })),
        paramDrivers: (gm.paramDrivers ?? []).map(pd => ({ ...pd, id: crypto.randomUUID() })),
      })),
    };
    // Update animation modifier groupIds to point to new group IDs
    const oldToNewGroupId = new Map<string, string>();
    (part.modifierGroups || []).forEach((oldG, i) => {
      const newG = newPart.modifierGroups[i];
      if (oldG.id && newG) oldToNewGroupId.set(oldG.id, newG.id);
    });
    newPart.animationModifiers = newPart.animationModifiers.map((am) => ({
      ...am,
      groupId: am.groupId ? (oldToNewGroupId.get(am.groupId) ?? null) : null,
    }));
    const track: Track = {
      id: crypto.randomUUID(),
      partId: newId,
      visible: true,
      locked: false,
      expanded: true,
    };

    // Also duplicate all keyframes from the original part, remapped to the new part ID
    const originalKeyframes = get().keyframes.filter(k => k.partId === id);
    const duplicatedKeyframes = originalKeyframes.map(kf => ({
      ...kf,
      id: crypto.randomUUID(),
      partId: newId,
      modifiers: kf.modifiers.map(m => ({ ...m, id: crypto.randomUUID(), params: { ...m.params } })),
      correctionMask: kf.correctionMask ? kf.correctionMask.map(row => [...row]) : null,
      overrideWidth: kf.overrideWidth,
      overrideHeight: kf.overrideHeight,
      overridePivotX: kf.overridePivotX,
      overridePivotY: kf.overridePivotY,
    }));

    set((s) => ({
      parts: [...s.parts, newPart],
      tracks: [...s.tracks, track],
      keyframes: [...s.keyframes, ...duplicatedKeyframes],
    }));
  },

  reorderPart: (id, newZIndex) => {
    get().pushUndo('重排部件');
    set((s) => {
      const parts = s.parts.map((p) =>
        p.id === id ? { ...p, zIndex: newZIndex } : p
      );
      return { parts };
    });
  },

  importPartFromImage: (name, imageData) => {
    get().pushUndo('导入图像部件');
    const { width, height, data } = imageData;
    const id = crypto.randomUUID();
    const pixels: PixelGrid = [];
    for (let y = 0; y < height; y++) {
      const row: PixelColor[] = [];
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        row.push(rgbaToHexOrNull(r, g, b, a));
      }
      pixels.push(row);
    }
    const part: Part = {
      id,
      name,
      width,
      height,
      pixels,
      pivotX: Math.floor(width / 2),
      pivotY: Math.floor(height / 2),
      offsetX: 0,
      offsetY: 0,
      zIndex: get().parts.length,
      visible: true,
      locked: false,
      animationModifiers: [],
      modifierGroups: [],
      parentId: null,
      editModifiers: [],
      partKeyframes: [],
      globalModifiers: [],
    };
    const track: Track = {
      id: crypto.randomUUID(),
      partId: id,
      visible: true,
      locked: false,
      expanded: true,
    };
    set((s) => ({
      parts: [...s.parts, part],
      tracks: [...s.tracks, track],
    }));
    return part;
  },

  resizePart: (id, newWidth, newHeight, cropOffsetX = 0, cropOffsetY = 0) => {
    get().pushUndo('调整部件尺寸');
    if (newWidth < 1 || newHeight < 1) return;
    set((s) => {
      const part = s.parts.find((p) => p.id === id);
      if (!part) return s;

      const oldW = part.width;
      const oldH = part.height;
      if (oldW === newWidth && oldH === newHeight && cropOffsetX === 0 && cropOffsetY === 0) return s;

      const newPixels: PixelGrid = Array.from({ length: newHeight }, (_, y) =>
        Array.from({ length: newWidth }, (_, x) => {
          const srcX = x - cropOffsetX;
          const srcY = y - cropOffsetY;
          if (srcY >= 0 && srcY < oldH && srcX >= 0 && srcX < oldW) {
            return part.pixels[srcY]?.[srcX] ?? null;
          }
          return null;
        })
      );

      const newPivotX = Math.max(0, Math.min(part.pivotX + cropOffsetX, newWidth - 1));
      const newPivotY = Math.max(0, Math.min(part.pivotY + cropOffsetY, newHeight - 1));

      return {
        parts: s.parts.map((p) =>
          p.id === id
            ? { ...p, width: newWidth, height: newHeight, pixels: newPixels, pivotX: newPivotX, pivotY: newPivotY }
            : p
        ),
      };
    });
  },

  splitImageToParts: (name, imageData, regions) => {
    get().pushUndo('拆分图像');
    const { width, height, data } = imageData;
    const createdParts: Part[] = [];

    for (const region of regions) {
      if (region.length === 0) continue;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of region) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }

      const partW = maxX - minX + 1;
      const partH = maxY - minY + 1;
      if (partW <= 0 || partH <= 0) continue;

      const regionSet = new Set(region.map(p => `${p.x},${p.y}`));

      const pixels: PixelGrid = [];
      let sumX = 0, sumY = 0, count = 0;
      for (let y = 0; y < partH; y++) {
        const row: PixelColor[] = [];
        for (let x = 0; x < partW; x++) {
          const srcX = minX + x;
          const srcY = minY + y;
          if (!regionSet.has(`${srcX},${srcY}`)) {
            row.push(null);
            continue;
          }
          const i = (srcY * width + srcX) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          const hex = rgbaToHexOrNull(r, g, b, a);
          row.push(hex);
          if (hex !== null) {
            sumX += srcX;
            sumY += srcY;
            count++;
          }
        }
        pixels.push(row);
      }

      if (count === 0) continue;

      const pivotX = Math.round(sumX / count - minX);
      const pivotY = Math.round(sumY / count - minY);

      const id = crypto.randomUUID();
      const part: Part = {
        id,
        name: `${name} ${createdParts.length + 1}`,
        width: partW,
        height: partH,
        pixels,
        pivotX,
        pivotY,
        offsetX: 0,
        offsetY: 0,
        zIndex: get().parts.length + createdParts.length,
        visible: true,
        locked: false,
        animationModifiers: [],
        modifierGroups: [],
        parentId: null,
        editModifiers: [],
        partKeyframes: [],
        globalModifiers: [],
      };
      createdParts.push(part);
    }

    if (createdParts.length > 0) {
      set((s) => ({
        parts: [...s.parts, ...createdParts],
        tracks: [...s.tracks, ...createdParts.map(p => ({
          id: crypto.randomUUID(),
          partId: p.id,
          visible: true,
          locked: false,
          expanded: true,
        }))],
      }));
    }

    return createdParts;
  },

  autoEstimatePivot: (partId) => {
    get().pushUndo('自动枢轴');
    const part = get().parts.find(p => p.id === partId);
    if (!part) return;

    let sumX = 0, sumY = 0, count = 0;
    for (let y = 0; y < part.height; y++) {
      for (let x = 0; x < part.width; x++) {
        if (part.pixels[y]?.[x] !== null) {
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }

    if (count > 0) {
      const pivotX = Math.round(sumX / count);
      const pivotY = Math.round(sumY / count);
      set((s) => ({
        parts: s.parts.map(p => p.id === partId ? { ...p, pivotX, pivotY } : p),
      }));
    }
  },

  // ---- Track Actions ----

  toggleTrackVisibility: (trackId) => set((s) => ({
    tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, visible: !t.visible } : t)),
  })),

  toggleTrackLock: (trackId) => set((s) => ({
    tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, locked: !t.locked } : t)),
  })),

  toggleTrackExpanded: (trackId) => set((s) => ({
    tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, expanded: !t.expanded } : t)),
  })),
});
