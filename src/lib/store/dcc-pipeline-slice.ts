// ============================================================
// PixelMorpher - DCC Pipeline Slice
// Animation Events, Frame Tags, Hitbox Shapes, Palette System.
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import type {
  AnimationEvent,
  FrameTag,
  HitboxShape,
  HitboxShapeType,
  Palette,
  PaletteColor,
  AnimationClip,
} from '../types';

export type DccPipelineSlice = {
  addAnimationEvent: (clipId: string, frame: number, name: string, opts?: Partial<Pick<AnimationEvent, 'stringValue' | 'numberValue' | 'objectValue' | 'active' | 'color'>>) => AnimationEvent;
  removeAnimationEvent: (clipId: string, eventId: string) => void;
  updateAnimationEvent: (clipId: string, eventId: string, updates: Partial<AnimationEvent>) => void;
  toggleAnimationEvent: (clipId: string, eventId: string) => void;
  getEventsAtFrame: (clipId: string, frame: number) => AnimationEvent[];
  addFrameTag: (clipId: string, name: string, startFrame: number, endFrame: number, opts?: Partial<Pick<FrameTag, 'color' | 'loop' | 'direction'>>) => FrameTag;
  removeFrameTag: (clipId: string, tagId: string) => void;
  updateFrameTag: (clipId: string, tagId: string, updates: Partial<FrameTag>) => void;
  getFrameTagsAtFrame: (clipId: string, frame: number) => FrameTag[];
  getFrameTags: (clipId: string) => FrameTag[];
  addHitboxShape: (clipId: string, keyframeId: string, name: string, shapeType: HitboxShapeType, data: HitboxShape['data'], opts?: Partial<Pick<HitboxShape, 'active' | 'color' | 'metadata'>>) => HitboxShape;
  removeHitboxShape: (clipId: string, keyframeId: string, hitboxId: string) => void;
  updateHitboxShape: (clipId: string, keyframeId: string, hitboxId: string, updates: Partial<HitboxShape>) => void;
  toggleHitboxShape: (clipId: string, keyframeId: string, hitboxId: string) => void;
  getHitboxShapes: (clipId: string, keyframeId: string) => HitboxShape[];
  getHitboxesAtFrame: (clipId: string, frame: number) => { keyframeId: string; hitboxes: HitboxShape[] }[];
  addPalette: (name: string, colors?: PaletteColor[], opts?: Partial<Pick<Palette, 'swappableIndices' | 'isDefault' | 'tags'>>) => Palette;
  removePalette: (paletteId: string) => void;
  updatePalette: (paletteId: string, updates: Partial<Palette>) => void;
  setPaletteColor: (paletteId: string, index: number, color: string | null, label?: string) => void;
  addPaletteColorSlot: (paletteId: string, color?: string | null, label?: string) => void;
  removePaletteColorSlot: (paletteId: string, index: number) => void;
  setActivePalette: (paletteId: string | null) => void;
  setSwappableIndices: (paletteId: string, indices: number[]) => void;
  applyPaletteSwap: (sourcePaletteId: string, targetPaletteId: string) => void;
};

function findClip(state: { animationClips: AnimationClip[] }, clipId: string): AnimationClip | undefined {
  return state.animationClips.find(c => c.id === clipId);
}

const EVENT_COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff922b', '#cc5de8'];
const HITBOX_COLORS: Record<string, string> = {
  attack: '#ff4444', hurtbox: '#44ff44', pushbox: '#4488ff', sensor: '#ffaa00', custom: '#cc5de8',
};

export const createDccPipelineSlice: StateCreator<ProjectStore, [], [], DccPipelineSlice> = (set, get) => ({
  // ---- Animation Events ----
  addAnimationEvent: (clipId, frame, name, opts) => {
    const state = get();
    state.pushUndo('添加动画事件');
    const event: AnimationEvent = {
      id: crypto.randomUUID(), frame, name,
      stringValue: opts?.stringValue, numberValue: opts?.numberValue, objectValue: opts?.objectValue,
      active: opts?.active ?? true,
      color: opts?.color ?? EVENT_COLORS[Math.floor(Math.random() * EVENT_COLORS.length)],
    };
    set(s => {
      const clip = findClip(s, clipId);
      if (!clip) return s;
      return { animationClips: s.animationClips.map(c => c.id === clipId ? { ...c, events: [...(clip.events || []), event] } : c) };
    });
    return event;
  },
  removeAnimationEvent: (clipId, eventId) => {
    const state = get(); state.pushUndo('删除动画事件');
    set(s => ({ animationClips: s.animationClips.map(c => c.id === clipId ? { ...c, events: (c.events || []).filter(e => e.id !== eventId) } : c) }));
  },
  updateAnimationEvent: (clipId, eventId, updates) => {
    set(s => ({ animationClips: s.animationClips.map(c => c.id === clipId ? { ...c, events: (c.events || []).map(e => e.id === eventId ? { ...e, ...updates } : e) } : c) }));
  },
  toggleAnimationEvent: (clipId, eventId) => {
    set(s => ({ animationClips: s.animationClips.map(c => c.id === clipId ? { ...c, events: (c.events || []).map(e => e.id === eventId ? { ...e, active: !e.active } : e) } : c) }));
  },
  getEventsAtFrame: (clipId, frame) => {
    const clip = findClip(get(), clipId);
    if (!clip?.events) return [];
    return clip.events.filter(e => e.frame === frame && e.active);
  },

  // ---- Frame Tags ----
  addFrameTag: (clipId, name, startFrame, endFrame, opts) => {
    const state = get(); state.pushUndo('添加帧标签');
    const tag: FrameTag = {
      id: crypto.randomUUID(), name, startFrame, endFrame,
      color: opts?.color ?? EVENT_COLORS[Math.floor(Math.random() * EVENT_COLORS.length)],
      loop: opts?.loop ?? 'loop', direction: opts?.direction ?? 'forward',
    };
    set(s => {
      const clip = findClip(s, clipId);
      if (!clip) return s;
      return { animationClips: s.animationClips.map(c => c.id === clipId ? { ...c, frameTags: [...(clip.frameTags || []), tag] } : c) };
    });
    return tag;
  },
  removeFrameTag: (clipId, tagId) => {
    const state = get(); state.pushUndo('删除帧标签');
    set(s => ({ animationClips: s.animationClips.map(c => c.id === clipId ? { ...c, frameTags: (c.frameTags || []).filter(t => t.id !== tagId) } : c) }));
  },
  updateFrameTag: (clipId, tagId, updates) => {
    set(s => ({ animationClips: s.animationClips.map(c => c.id === clipId ? { ...c, frameTags: (c.frameTags || []).map(t => t.id === tagId ? { ...t, ...updates } : t) } : c) }));
  },
  getFrameTagsAtFrame: (clipId, frame) => {
    const clip = findClip(get(), clipId);
    if (!clip?.frameTags) return [];
    return clip.frameTags.filter(t => frame >= t.startFrame && frame <= t.endFrame);
  },
  getFrameTags: (clipId) => {
    const clip = findClip(get(), clipId);
    return clip?.frameTags || [];
  },

  // ---- Hitbox Shapes ----
  addHitboxShape: (clipId, keyframeId, name, shapeType, data, opts) => {
    const state = get(); state.pushUndo('添加碰撞体');
    const hitbox: HitboxShape = {
      id: crypto.randomUUID(), name, shapeType, data,
      active: opts?.active ?? true,
      color: opts?.color ?? HITBOX_COLORS[name] ?? HITBOX_COLORS.custom,
      metadata: opts?.metadata,
    };
    set(s => {
      const clip = findClip(s, clipId);
      if (!clip) return s;
      const hitboxMap = { ...(clip.hitboxMap || {}) };
      const existing = hitboxMap[keyframeId] || [];
      hitboxMap[keyframeId] = [...existing, hitbox];
      return { animationClips: s.animationClips.map(c => c.id === clipId ? { ...c, hitboxMap } : c) };
    });
    return hitbox;
  },
  removeHitboxShape: (clipId, keyframeId, hitboxId) => {
    const state = get(); state.pushUndo('删除碰撞体');
    set(s => {
      const clip = findClip(s, clipId);
      if (!clip) return s;
      const hitboxMap = { ...(clip.hitboxMap || {}) };
      const existing = hitboxMap[keyframeId] || [];
      if (existing.length <= 1 && existing.some(h => h.id === hitboxId)) delete hitboxMap[keyframeId];
      else hitboxMap[keyframeId] = existing.filter(h => h.id !== hitboxId);
      return { animationClips: s.animationClips.map(c => c.id === clipId ? { ...c, hitboxMap } : c) };
    });
  },
  updateHitboxShape: (clipId, keyframeId, hitboxId, updates) => {
    set(s => {
      const clip = findClip(s, clipId);
      if (!clip) return s;
      const hitboxMap = { ...(clip.hitboxMap || {}) };
      hitboxMap[keyframeId] = (hitboxMap[keyframeId] || []).map(h => h.id === hitboxId ? { ...h, ...updates } : h);
      return { animationClips: s.animationClips.map(c => c.id === clipId ? { ...c, hitboxMap } : c) };
    });
  },
  toggleHitboxShape: (clipId, keyframeId, hitboxId) => {
    set(s => {
      const clip = findClip(s, clipId);
      if (!clip) return s;
      const hitboxMap = { ...(clip.hitboxMap || {}) };
      hitboxMap[keyframeId] = (hitboxMap[keyframeId] || []).map(h => h.id === hitboxId ? { ...h, active: !h.active } : h);
      return { animationClips: s.animationClips.map(c => c.id === clipId ? { ...c, hitboxMap } : c) };
    });
  },
  getHitboxShapes: (clipId, keyframeId) => {
    const clip = findClip(get(), clipId);
    if (!clip?.hitboxMap) return [];
    return clip.hitboxMap[keyframeId] || [];
  },
  getHitboxesAtFrame: (clipId, frame) => {
    const clip = findClip(get(), clipId);
    if (!clip?.hitboxMap) return [];
    const result: { keyframeId: string; hitboxes: HitboxShape[] }[] = [];
    const sortedKfs = [...clip.keyframes].sort((a, b) => a.frame - b.frame);
    const kfByPart = new Map<string, typeof sortedKfs[number]>();
    for (const kf of sortedKfs) {
      if (kf.frame <= frame) kfByPart.set(kf.partId, kf);
    }
    for (const [, kf] of kfByPart) {
      const hitboxes = clip.hitboxMap?.[kf.id];
      if (hitboxes && hitboxes.length > 0) {
        result.push({ keyframeId: kf.id, hitboxes: hitboxes.filter(h => h.active) });
      }
    }
    return result;
  },

  // ---- Palettes ----
  addPalette: (name, colors, opts) => {
    const state = get(); state.pushUndo('添加调色板');
    const palette: Palette = {
      id: crypto.randomUUID(), name,
      colors: colors ?? Array.from({ length: 16 }, (_, i) => ({ color: null, label: `颜色 ${i + 1}` })),
      swappableIndices: opts?.swappableIndices ?? [],
      isDefault: opts?.isDefault ?? false,
      tags: opts?.tags ?? [],
    };
    set(s => ({
      palettes: [...s.palettes, palette],
      activePaletteId: s.activePaletteId ?? (palette.isDefault ? palette.id : s.activePaletteId),
    }));
    return palette;
  },
  removePalette: (paletteId) => {
    const state = get(); state.pushUndo('删除调色板');
    set(s => ({
      palettes: s.palettes.filter(p => p.id !== paletteId),
      activePaletteId: s.activePaletteId === paletteId ? null : s.activePaletteId,
    }));
  },
  updatePalette: (paletteId, updates) => {
    set(s => ({ palettes: s.palettes.map(p => p.id === paletteId ? { ...p, ...updates } : p) }));
  },
  setPaletteColor: (paletteId, index, color, label) => {
    set(s => ({
      palettes: s.palettes.map(p => {
        if (p.id !== paletteId) return p;
        const colors = [...p.colors];
        if (index >= 0 && index < colors.length) colors[index] = { color, label: label ?? colors[index].label };
        return { ...p, colors };
      }),
    }));
  },
  addPaletteColorSlot: (paletteId, color, label) => {
    set(s => ({
      palettes: s.palettes.map(p => {
        if (p.id !== paletteId) return p;
        return { ...p, colors: [...p.colors, { color: color ?? null, label: label ?? `颜色 ${p.colors.length + 1}` }] };
      }),
    }));
  },
  removePaletteColorSlot: (paletteId, index) => {
    set(s => ({
      palettes: s.palettes.map(p => {
        if (p.id !== paletteId) return p;
        const colors = p.colors.filter((_, i) => i !== index);
        const swappableIndices = p.swappableIndices.filter(i => i !== index).map(i => i > index ? i - 1 : i);
        return { ...p, colors, swappableIndices };
      }),
    }));
  },
  setActivePalette: (paletteId) => { set({ activePaletteId: paletteId }); },
  setSwappableIndices: (paletteId, indices) => {
    set(s => ({ palettes: s.palettes.map(p => p.id === paletteId ? { ...p, swappableIndices: indices } : p) }));
  },
  applyPaletteSwap: (sourcePaletteId, targetPaletteId) => {
    const state = get(); state.pushUndo('应用调色板换色');
    const sourcePalette = state.palettes.find(p => p.id === sourcePaletteId);
    const targetPalette = state.palettes.find(p => p.id === targetPaletteId);
    if (!sourcePalette || !targetPalette) return;
    const colorMap = new Map<string, string | null>();
    const maxLen = Math.max(sourcePalette.colors.length, targetPalette.colors.length);
    for (let i = 0; i < maxLen; i++) {
      const srcColor = sourcePalette.colors[i]?.color;
      const tgtColor = targetPalette.colors[i]?.color;
      if (srcColor && tgtColor) colorMap.set(srcColor.toLowerCase(), tgtColor);
    }
    const updatedParts = state.parts.map(part => {
      const newPixels = part.pixels.map(row => row.map(px => {
        if (!px) return px;
        const mapped = colorMap.get(px.toLowerCase());
        return mapped !== undefined ? mapped : px;
      }));
      return { ...part, pixels: newPixels };
    });
    set({ parts: updatedParts });
  },
});
