// ============================================================
// PixelMorpher - Project Slice
// Project name, canvas size, frame rate, total frames, current frame,
// background color, undo/redo, save/load, custom modifiers, brush presets,
// onion skin, reset, project base state
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import type { Project, HistoryEntry, ProjectFile, BrushPreset, AnimationClip, ClipPartData, Character, Costume, Track } from '../types';
import { MODIFIER_DEFINITIONS } from '../types';
import { _isDragActive, _dragPostStackLen, _pendingTrajectoryPartIds, setDragActive, setDragPostStackLen, resetDragState } from './shared';

const defaultProject: Project = {
  id: crypto.randomUUID(),
  name: '未命名项目',
  description: '',

  // Asset Library
  parts: [],
  characters: [],
  animationClips: [],
  activeAnimationClipId: null,

  // Project-level settings
  canvasWidth: 256,
  canvasHeight: 256,
  frameRate: 12,
  totalFrames: 24,
  currentFrame: 0,
  backgroundColor: '#1a1a2e',

  // Project-level effects
  animationVariables: [],
  globalModifiers: [],

  // Editor state
  onionSkinEnabled: false,
  onionSkinFrames: 2,

  // Legacy fields (backward compatibility)
  tracks: [],
  keyframes: [],
  effectTracks: [],
  canvasModifierTracks: [],
  trajectories: [],
  motionBlurStrokes: [],
  effectStrokes: [],

  // Concrete Puppet (first-class project data)
  puppetSkeletons: [],
  puppetCharacters: [],
  selectedPuppetNodeId: null,

  // DCC Pipeline
  palettes: [],
  activePaletteId: null,
};

export type ProjectSlice = Project & {
  setProjectName: ProjectStore['setProjectName'];
  setCanvasSize: ProjectStore['setCanvasSize'];
  setFrameRate: ProjectStore['setFrameRate'];
  setTotalFrames: ProjectStore['setTotalFrames'];
  setCurrentFrame: ProjectStore['setCurrentFrame'];
  incrementFrame: ProjectStore['incrementFrame'];
  setBackgroundColor: ProjectStore['setBackgroundColor'];
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  _captureSnapshot: ProjectStore['_captureSnapshot'];
  _COALESCE_WINDOW_MS: number;
  pushUndo: ProjectStore['pushUndo'];
  undo: ProjectStore['undo'];
  redo: ProjectStore['redo'];
  canUndo: ProjectStore['canUndo'];
  canRedo: ProjectStore['canRedo'];
  _dragActive: boolean;
  beginDrag: ProjectStore['beginDrag'];
  endDrag: ProjectStore['endDrag'];
  performBatch: ProjectStore['performBatch'];
  exportProjectFile: ProjectStore['exportProjectFile'];
  importProjectFile: ProjectStore['importProjectFile'];
  customModifiers: { id: string; name: string; params: any[]; execute: (pixels: any[], params: any) => any[] }[];
  registerCustomModifier: ProjectStore['registerCustomModifier'];
  unregisterCustomModifier: ProjectStore['unregisterCustomModifier'];
  brushPresets: BrushPreset[];
  addBrushPreset: ProjectStore['addBrushPreset'];
  removeBrushPreset: ProjectStore['removeBrushPreset'];
  updateBrushPreset: ProjectStore['updateBrushPreset'];
  maxUndoLevels: number;
  setMaxUndoLevels: ProjectStore['setMaxUndoLevels'];
  resetProject: ProjectStore['resetProject'];
  motionAnalysisSplit: ProjectStore['motionAnalysisSplit'];
  // Skeleton state (initialized here, actions in skeleton-slice)
  selectedBoneId: string | null;
  proceduralAnimations: import('../types').ProceduralAnimation[];
  weightMaps: import('../types').WeightMap[];
  skeletons: import('../types').Skeleton[];
};

export const createProjectSlice: StateCreator<ProjectStore, [], [], Partial<ProjectStore>> = (set, get) => ({
  ...defaultProject,
  undoStack: [],
  redoStack: [],
  _dragActive: false,
  customModifiers: [],

  brushPresets: [
    { id: 'preset-pixel-1x1', name: '像素点', type: 'pixel', size: 1, shape: [[true]] },
    { id: 'preset-dash-3x1', name: '短划线', type: 'dash', size: 3, shape: [[true, true, true]] },
    { id: 'preset-star-3x3', name: '星形', type: 'star', size: 3, shape: [
      [false, true, false],
      [true, true, true],
      [false, true, false],
    ] },
    { id: 'preset-square-2x2', name: '方形', type: 'custom', size: 2, shape: [
      [true, true],
      [true, true],
    ] },
  ],

  maxUndoLevels: 50,

  setProjectName: (name) => {
    get().pushUndo('设置项目名');
    set({ name });
  },
  setCanvasSize: (w, h) => {
    get().pushUndo('设置画布尺寸');
    set({ canvasWidth: w, canvasHeight: h });
  },
  setFrameRate: (fps) => {
    get().pushUndo('设置帧率');
    set({ frameRate: fps });
  },
  setTotalFrames: (n) => {
    get().pushUndo('设置总帧数');
    set({ totalFrames: n });
  },
  setCurrentFrame: (f) => set({ currentFrame: Math.max(0, Math.min(f, get().totalFrames - 1)) }),
  incrementFrame: () => {
    const { currentFrame, totalFrames } = get();
    const next = currentFrame + 1;
    if (next >= totalFrames) {
      set({ currentFrame: 0 });
    } else {
      set({ currentFrame: next });
    }
  },
  setBackgroundColor: (color) => {
    get().pushUndo('设置背景色');
    set({ backgroundColor: color });
  },

  _captureSnapshot: () => {
    const s = get();
    return JSON.stringify({
      name: s.name,
      description: s.description,
      parts: s.parts,
      characters: s.characters,
      animationClips: s.animationClips,
      activeAnimationClipId: s.activeAnimationClipId,
      tracks: s.tracks,
      keyframes: s.keyframes,
      effectTracks: s.effectTracks,
      canvasModifierTracks: s.canvasModifierTracks,
      trajectories: s.trajectories,
      motionBlurStrokes: s.motionBlurStrokes,
      effectStrokes: s.effectStrokes,
      skeletons: s.skeletons,
      proceduralAnimations: s.proceduralAnimations,
      weightMaps: s.weightMaps,
      canvasWidth: s.canvasWidth,
      canvasHeight: s.canvasHeight,
      frameRate: s.frameRate,
      totalFrames: s.totalFrames,
      currentFrame: s.currentFrame,
      backgroundColor: s.backgroundColor,
      onionSkinEnabled: s.onionSkinEnabled,
      onionSkinFrames: s.onionSkinFrames,
      selectedBoneId: s.selectedBoneId,
      customModifiers: s.customModifiers,
      brushPresets: s.brushPresets,
      maxUndoLevels: s.maxUndoLevels,
      globalModifiers: s.globalModifiers,
      // Concrete Puppet (first-class project data)
      puppetSkeletons: s.puppetSkeletons,
      puppetCharacters: s.puppetCharacters,
      selectedPuppetNodeId: s.selectedPuppetNodeId,
      // DCC Pipeline
      palettes: s.palettes,
      activePaletteId: s.activePaletteId,
    });
  },

  _COALESCE_WINDOW_MS: 1000,

  pushUndo: (description, coalesceKey) => {
    if (_isDragActive) {
      return;
    }

    const now = Date.now();

    set((s) => {
      const stack = s.undoStack;
      const top = stack[stack.length - 1];
      if (
        coalesceKey &&
        top?.coalesceKey === coalesceKey &&
        now - top.timestamp < get()._COALESCE_WINDOW_MS
      ) {
        return {
          undoStack: [...stack.slice(0, -1), { ...top, timestamp: now }],
          redoStack: [],
        };
      }
      const snapshot: HistoryEntry = {
        description,
        timestamp: now,
        snapshot: get()._captureSnapshot(),
        coalesceKey,
      };
      return {
        undoStack: [...stack.slice(-(get().maxUndoLevels - 1)), snapshot],
        redoStack: [],
      };
    });
  },

  beginDrag: (description) => {
    if (_isDragActive) return;
    setDragActive(true);
    const snapshot: HistoryEntry = {
      description,
      timestamp: Date.now(),
      snapshot: get()._captureSnapshot(),
    };
    set((s) => ({
      _dragActive: true,
      undoStack: [...s.undoStack, snapshot],
      redoStack: [],
    }));
    setDragPostStackLen(get().undoStack.length);
  },

  endDrag: () => {
    if (!_isDragActive) return;
    setDragActive(false);

    const stack = get().undoStack;
    if (stack.length > _dragPostStackLen) {
      set({
        _dragActive: false,
        undoStack: stack.slice(0, _dragPostStackLen),
      });
    } else {
      set({ _dragActive: false });
    }
    setDragPostStackLen(0);

    if (_pendingTrajectoryPartIds.size > 0) {
      const partIds = [..._pendingTrajectoryPartIds];
      _pendingTrajectoryPartIds.clear();
      setTimeout(() => {
        for (const pid of partIds) {
          get().autoRecordTrajectory(pid);
        }
      }, 0);
    }
  },

  performBatch: (description, fn) => {
    get().beginDrag(description);
    try {
      fn();
    } finally {
      get().endDrag();
    }
  },

  undo: () => {
    const { undoStack, redoStack } = get();
    if (undoStack.length === 0) return;
    if (_isDragActive) return;

    const currentSnapshot: HistoryEntry = {
      description: 'redo',
      timestamp: Date.now(),
      snapshot: get()._captureSnapshot(),
    };

    const lastUndo = undoStack[undoStack.length - 1];
    const restored = JSON.parse(lastUndo.snapshot);

    set((s) => ({
      ...s,
      ...restored,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, currentSnapshot],
    }));
  },

  redo: () => {
    const { undoStack, redoStack } = get();
    if (redoStack.length === 0) return;
    if (_isDragActive) return;

    const currentSnapshot: HistoryEntry = {
      description: 'undo',
      timestamp: Date.now(),
      snapshot: get()._captureSnapshot(),
    };

    const lastRedo = redoStack[redoStack.length - 1];
    const restored = JSON.parse(lastRedo.snapshot);

    set((s) => ({
      ...s,
      ...restored,
      undoStack: [...undoStack, currentSnapshot],
      redoStack: redoStack.slice(0, -1),
    }));
  },

  canUndo: () => get().undoStack.length > 0 && !_isDragActive,
  canRedo: () => get().redoStack.length > 0 && !_isDragActive,

  exportProjectFile: () => {
    const state = get();
    return {
      version: '3.0',
      project: {
        id: state.id,
        name: state.name,
        description: state.description,
        parts: state.parts,
        characters: state.characters,
        animationClips: state.animationClips,
        activeAnimationClipId: state.activeAnimationClipId,
        canvasWidth: state.canvasWidth,
        canvasHeight: state.canvasHeight,
        frameRate: state.frameRate,
        totalFrames: state.totalFrames,
        currentFrame: state.currentFrame,
        backgroundColor: state.backgroundColor,
        onionSkinEnabled: state.onionSkinEnabled,
        onionSkinFrames: state.onionSkinFrames,
        globalModifiers: state.globalModifiers,
        // Legacy fields for backward compatibility
        tracks: state.tracks,
        keyframes: state.keyframes,
        effectTracks: state.effectTracks,
        canvasModifierTracks: state.canvasModifierTracks,
        trajectories: state.trajectories,
        motionBlurStrokes: state.motionBlurStrokes,
        effectStrokes: state.effectStrokes,
        // Concrete Puppet (first-class project data)
        puppetSkeletons: state.puppetSkeletons,
        puppetCharacters: state.puppetCharacters,
        selectedPuppetNodeId: state.selectedPuppetNodeId,
        // DCC Pipeline
        palettes: state.palettes,
        activePaletteId: state.activePaletteId,
      },
      skeletons: state.skeletons,
      proceduralAnimations: state.proceduralAnimations,
      weightMaps: state.weightMaps,
      history: state.undoStack,
    };
  },

  importProjectFile: (file) => {
    get().pushUndo('导入项目文件');
    const currentVersion = '3.0';
    const fileVersion = file.version || '1.0';
    if (fileVersion > currentVersion) {
      console.warn(`Project file version ${fileVersion} is newer than current ${currentVersion}. Some features may not work.`);
    }

    const knownModifierTypes = MODIFIER_DEFINITIONS.map(d => d.type);
    const processedKeyframes = (file.project.keyframes || []).map((kf: any) => ({
      ...kf,
      modifiers: (kf.modifiers || []).map((mod: any) => {
        if (!knownModifierTypes.includes(mod.type)) {
          return { ...mod, type: 'unknown', enabled: false, startFrame: mod.startFrame ?? -1, endFrame: mod.endFrame ?? -1, fadeInFrames: mod.fadeInFrames ?? 0, fadeOutFrames: mod.fadeOutFrames ?? 0 };
        }
        return {
          ...mod,
          startFrame: mod.startFrame ?? -1,
          endFrame: mod.endFrame ?? -1,
          fadeInFrames: mod.fadeInFrames ?? 0,
          fadeOutFrames: mod.fadeOutFrames ?? 0,
          blendMode: mod.blendMode ?? 'add',
          coordinateMode: mod.coordinateMode ?? 'world',
        };
      }),
    }));

    const processedParts = (file.project.parts || []).map((p: any) => ({
      ...p,
      parentId: p.parentId ?? null,
      offsetX: p.offsetX ?? 0,
      offsetY: p.offsetY ?? 0,
      editModifiers: p.editModifiers ?? [],
      globalModifiers: p.globalModifiers ?? [],
      animationModifiers: p.animationModifiers ?? [],
      modifierGroups: p.modifierGroups ?? [],
      partKeyframes: p.partKeyframes ?? [],
    }));

    // V3.0 migration: if file has no animationClips, create one from legacy data
    let animationClips = file.project.animationClips || [];
    let activeAnimationClipId = file.project.activeAnimationClipId ?? null;

    if (animationClips.length === 0 && (file.project.tracks?.length > 0 || file.project.keyframes?.length > 0)) {
      // Migrate legacy project → create a default animation clip from project-level data
      const migratedClip: AnimationClip = {
        id: crypto.randomUUID(),
        name: file.project.name || '默认动画',
        frameRate: file.project.frameRate ?? 12,
        totalFrames: file.project.totalFrames ?? 24,
        tracks: file.project.tracks || [],
        keyframes: processedKeyframes,
        clipPartData: processedParts.map((p: any) => ({
          partId: p.id,
          animationModifiers: p.animationModifiers || [],
          modifierGroups: p.modifierGroups || [],
          partKeyframes: p.partKeyframes || [],
        })),
        effectTracks: file.project.effectTracks || [],
        canvasModifierTracks: file.project.canvasModifierTracks || [],
        trajectories: file.project.trajectories || [],
        motionBlurStrokes: file.project.motionBlurStrokes || [],
        effectStrokes: file.project.effectStrokes || [],
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      animationClips = [migratedClip];
      activeAnimationClipId = migratedClip.id;
    }

    set({
      ...file.project,
      keyframes: processedKeyframes,
      parts: processedParts,
      characters: file.project.characters || file.characters || [],
      animationClips,
      activeAnimationClipId,
      id: file.project.id || crypto.randomUUID(),
      description: file.project.description ?? '',
      skeletons: file.skeletons || [],
      proceduralAnimations: file.proceduralAnimations || [],
      weightMaps: file.weightMaps || [],
      globalModifiers: file.project.globalModifiers || [],
      // Concrete Puppet (first-class project data)
      puppetSkeletons: file.project.puppetSkeletons || [],
      puppetCharacters: file.project.puppetCharacters || [],
      selectedPuppetNodeId: file.project.selectedPuppetNodeId ?? null,
      // DCC Pipeline
      palettes: file.project.palettes || [],
      activePaletteId: file.project.activePaletteId ?? null,
      undoStack: file.history || [],
      redoStack: [],
    });

    // Sync legacy fields from the active clip
    if (activeAnimationClipId) {
      get().syncLegacyFromActiveClip();
    }
  },

  registerCustomModifier: (modifier) => set((s) => ({
    customModifiers: [...s.customModifiers.filter((m) => m.id !== modifier.id), modifier as any],
  })),

  unregisterCustomModifier: (id) => set((s) => ({
    customModifiers: s.customModifiers.filter((m) => m.id !== id),
  })),

  addBrushPreset: (preset) => set((s) => ({
    brushPresets: [...s.brushPresets, preset],
  })),

  removeBrushPreset: (id) => set((s) => ({
    brushPresets: s.brushPresets.filter((p) => p.id !== id),
  })),

  updateBrushPreset: (id, updates) => set((s) => ({
    brushPresets: s.brushPresets.map((p) => p.id === id ? { ...p, ...updates } : p),
  })),

  setMaxUndoLevels: (n) => set({ maxUndoLevels: Math.max(10, Math.min(200, n)) }),

  motionAnalysisSplit: (frames, options) => {
    get().pushUndo('运动分析拆分');
    const { analyzeMotionAndSplit } = require('../motion-analysis');
    const result = analyzeMotionAndSplit(frames, options?.blockSize, options?.searchRadius, options?.motionThreshold, options?.minRegionSize);
    const s = get();
    const newPartIds: string[] = [];
    const createdParts: any[] = [];
    const createdTracks: any[] = [];
    const createdKeyframes: any[] = [];

    for (const region of result.regions) {
      const { x: bx, y: by, width: rw, height: rh } = region.bounds;
      const partPixels: any[] = Array.from({ length: rh }, () => Array(rw).fill(null));

      for (const p of region.pixels) {
        const lx = p.x - bx;
        const ly = p.y - by;
        if (ly >= 0 && ly < rh && lx >= 0 && lx < rw) {
          const refFrame = frames[frames.length - 1];
          if (p.y < refFrame.length && p.x < refFrame[0].length) {
            partPixels[ly][lx] = refFrame[p.y][p.x];
          }
        }
      }

      const partId = crypto.randomUUID();
      const part = {
        id: partId,
        name: `部件_${region.id}`,
        width: rw,
        height: rh,
        pixels: partPixels,
        pivotX: Math.round(region.pivotX - bx),
        pivotY: Math.round(region.pivotY - by),
        offsetX: 0,
        offsetY: 0,
        zIndex: s.parts.length + createdParts.length,
        visible: true,
        locked: false,
        animationModifiers: [],
        modifierGroups: [],
        parentId: null,
        editModifiers: [],
        partKeyframes: [],
      };

      const trackId = crypto.randomUUID();
      const track = {
        id: trackId,
        partId,
        visible: true,
        locked: false,
        expanded: true,
      };

      const keyframeId = crypto.randomUUID();
      const keyframe = {
        id: keyframeId,
        partId,
        frame: s.currentFrame,
        modifiers: [],
        correctionMask: null,
        isBaked: false,
      };

      newPartIds.push(partId);
      createdParts.push(part);
      createdTracks.push(track);
      createdKeyframes.push(keyframe);
    }

    if (createdParts.length > 0) {
      set((s) => ({
        parts: [...s.parts, ...createdParts],
        tracks: [...s.tracks, ...createdTracks],
        keyframes: [...s.keyframes, ...createdKeyframes],
      }));
    }

    return newPartIds;
  },

  resetProject: () => {
    const snapshot: HistoryEntry = {
      description: '重置项目',
      timestamp: Date.now(),
      snapshot: get()._captureSnapshot(),
    };
    set((s) => ({
      ...defaultProject,
      id: crypto.randomUUID(),
      skeletons: [],
      proceduralAnimations: [],
      weightMaps: [],
      // Concrete Puppet: already included in defaultProject via puppetSkeletons/puppetCharacters
      // DCC Pipeline: already included in defaultProject via palettes/activePaletteId
      undoStack: [...s.undoStack.slice(-(s.maxUndoLevels - 1)), snapshot],
      redoStack: [],
      customModifiers: [],
      canvasModifierTracks: [],
      brushPresets: [
        { id: 'preset-pixel-1x1', name: '像素点', type: 'pixel', size: 1, shape: [[true]] },
        { id: 'preset-dash-3x1', name: '短划线', type: 'dash', size: 3, shape: [[true, true, true]] },
        { id: 'preset-star-3x3', name: '星形', type: 'star', size: 3, shape: [
          [false, true, false],
          [true, true, true],
          [false, true, false],
        ] },
        { id: 'preset-square-2x2', name: '方形', type: 'custom', size: 2, shape: [
          [true, true],
          [true, true],
        ] },
      ],
      maxUndoLevels: 50,
      _dragActive: false,
      selectedBoneId: null,
      globalModifiers: [],
    }));
    resetDragState();
  },

  // ============================================================
  // V3.0: AnimationClip CRUD
  // ============================================================

  addAnimationClip: (name: string) => {
    get().pushUndo('添加动画片段');
    const s = get();
    const clip: AnimationClip = {
      id: crypto.randomUUID(),
      name,
      frameRate: s.frameRate,
      totalFrames: s.totalFrames,
      tracks: [],
      keyframes: [],
      clipPartData: [],
      effectTracks: [],
      canvasModifierTracks: [],
      trajectories: [],
      motionBlurStrokes: [],
      effectStrokes: [],
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((s) => ({
      animationClips: [...s.animationClips, clip],
      activeAnimationClipId: clip.id,
    }));
    return clip;
  },

  removeAnimationClip: (clipId: string) => {
    get().pushUndo('删除动画片段');
    const s = get();
    const newClips = s.animationClips.filter(c => c.id !== clipId);
    const newActiveId = s.activeAnimationClipId === clipId
      ? (newClips.length > 0 ? newClips[0].id : null)
      : s.activeAnimationClipId;
    set({
      animationClips: newClips,
      activeAnimationClipId: newActiveId,
    });
    // Sync legacy fields if active clip changed
    if (newActiveId) {
      get().syncLegacyFromActiveClip();
    }
  },

  updateAnimationClip: (clipId: string, updates: Partial<AnimationClip>) => {
    set((s) => ({
      animationClips: s.animationClips.map(c =>
        c.id === clipId ? { ...c, ...updates, updatedAt: Date.now() } : c
      ),
    }));
    // Sync legacy fields if this is the active clip
    if (get().activeAnimationClipId === clipId) {
      get().syncLegacyFromActiveClip();
    }
  },

  setActiveAnimationClip: (clipId: string | null) => {
    set({ activeAnimationClipId: clipId });
    if (clipId) {
      get().syncLegacyFromActiveClip();
    }
  },

  getActiveAnimationClip: () => {
    const s = get();
    if (!s.activeAnimationClipId) return null;
    return s.animationClips.find(c => c.id === s.activeAnimationClipId) ?? null;
  },

  getClipPartData: (partId: string) => {
    const clip = get().getActiveAnimationClip();
    if (!clip) return null;
    return clip.clipPartData.find(d => d.partId === partId) ?? null;
  },

  ensureClipPartData: (partId: string) => {
    const clip = get().getActiveAnimationClip();
    if (!clip) {
      // No active clip — return empty data (shouldn't happen in normal flow)
      return { partId, animationModifiers: [], modifierGroups: [], partKeyframes: [] } as ClipPartData;
    }
    const existing = clip.clipPartData.find(d => d.partId === partId);
    if (existing) return existing;

    // Create new ClipPartData, migrating from Part's legacy fields if they exist
    const part = get().parts.find(p => p.id === partId);
    const newData: ClipPartData = {
      partId,
      animationModifiers: part?.animationModifiers ? [...part.animationModifiers] : [],
      modifierGroups: part?.modifierGroups ? [...part.modifierGroups] : [],
      partKeyframes: part?.partKeyframes ? [...part.partKeyframes] : [],
    };

    get().updateAnimationClip(clip.id, {
      clipPartData: [...clip.clipPartData, newData],
    });

    return newData;
  },

  migrateLegacyToClip: (clipId: string) => {
    const s = get();
    const clip = s.animationClips.find(c => c.id === clipId);
    if (!clip) return;

    // Build ClipPartData from Parts' legacy animation fields
    const clipPartData: ClipPartData[] = s.parts.map(part => ({
      partId: part.id,
      animationModifiers: [...part.animationModifiers],
      modifierGroups: [...part.modifierGroups],
      partKeyframes: [...part.partKeyframes],
    }));

    get().updateAnimationClip(clipId, {
      tracks: [...s.tracks],
      keyframes: [...s.keyframes],
      clipPartData,
      effectTracks: [...s.effectTracks],
      canvasModifierTracks: [...s.canvasModifierTracks],
      trajectories: [...s.trajectories],
      motionBlurStrokes: [...s.motionBlurStrokes],
      effectStrokes: [...s.effectStrokes],
      frameRate: s.frameRate,
      totalFrames: s.totalFrames,
    });
  },

  syncLegacyFromActiveClip: () => {
    const clip = get().getActiveAnimationClip();
    if (!clip) return;

    // Sync clip data to legacy Project-level fields so existing components work
    set({
      tracks: clip.tracks,
      keyframes: clip.keyframes,
      effectTracks: clip.effectTracks,
      canvasModifierTracks: clip.canvasModifierTracks,
      trajectories: clip.trajectories,
      motionBlurStrokes: clip.motionBlurStrokes,
      effectStrokes: clip.effectStrokes,
      frameRate: clip.frameRate,
      totalFrames: clip.totalFrames,
    });

    // Sync ClipPartData back to Part legacy fields
    set((s) => ({
      parts: s.parts.map(part => {
        const cpd = clip.clipPartData.find(d => d.partId === part.id);
        if (!cpd) return part;
        return {
          ...part,
          animationModifiers: cpd.animationModifiers,
          modifierGroups: cpd.modifierGroups,
          partKeyframes: cpd.partKeyframes,
        };
      }),
    }));
  },

  // ============================================================
  // V3.0: Character CRUD
  // ============================================================

  addCharacter: (name: string, partIds?: string[]) => {
    get().pushUndo('添加角色');
    const character: Character = {
      id: crypto.randomUUID(),
      name,
      partIds: partIds ?? [],
      costumes: [],
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((s) => ({
      characters: [...s.characters, character],
    }));
    return character;
  },

  removeCharacter: (characterId: string) => {
    get().pushUndo('删除角色');
    set((s) => ({
      characters: s.characters.filter(c => c.id !== characterId),
    }));
  },

  updateCharacter: (characterId: string, updates: Partial<Character>) => {
    set((s) => ({
      characters: s.characters.map(c =>
        c.id === characterId ? { ...c, ...updates, updatedAt: Date.now() } : c
      ),
    }));
  },

  addPartToCharacter: (characterId: string, partId: string) => {
    set((s) => ({
      characters: s.characters.map(c =>
        c.id === characterId && !c.partIds.includes(partId)
          ? { ...c, partIds: [...c.partIds, partId], updatedAt: Date.now() }
          : c
      ),
    }));
  },

  removePartFromCharacter: (characterId: string, partId: string) => {
    set((s) => ({
      characters: s.characters.map(c =>
        c.id === characterId
          ? { ...c, partIds: c.partIds.filter(id => id !== partId), updatedAt: Date.now() }
          : c
      ),
    }));
  },

  addCostume: (characterId: string, name: string, slotMapping?: Record<string, string>) => {
    const costume: Costume = {
      id: crypto.randomUUID(),
      name,
      slotMapping: slotMapping ?? {},
    };
    set((s) => ({
      characters: s.characters.map(c =>
        c.id === characterId
          ? { ...c, costumes: [...c.costumes, costume], updatedAt: Date.now() }
          : c
      ),
    }));
    return costume;
  },

  removeCostume: (characterId: string, costumeId: string) => {
    set((s) => ({
      characters: s.characters.map(c =>
        c.id === characterId
          ? { ...c, costumes: c.costumes.filter(co => co.id !== costumeId), updatedAt: Date.now() }
          : c
      ),
    }));
  },

  setActiveCostume: (characterId: string, costumeId: string) => {
    set((s) => ({
      characters: s.characters.map(c =>
        c.id === characterId
          ? { ...c, activeCostumeId: costumeId, updatedAt: Date.now() }
          : c
      ),
    }));
  },

  createClipFromCharacter: (characterId: string, clipName: string): AnimationClip => {
    const s = get();
    const character = s.characters.find(c => c.id === characterId);
    if (!character) {
      // Fallback: create empty clip
      return s.addAnimationClip(clipName);
    }

    const clip = s.addAnimationClip(clipName);

    // Create tracks for each part in the character
    const newTracks: Track[] = character.partIds.map((partId: string, index: number) => {
      return {
        id: crypto.randomUUID(),
        partId: partId,
        visible: true,
        locked: false,
        expanded: true,
        zIndex: index,
      };
    });

    // Create ClipPartData for each part
    const newClipPartData: ClipPartData[] = character.partIds.map((partId: string) => {
      const part = s.parts.find(p => p.id === partId);
      return {
        partId: partId,
        animationModifiers: part?.animationModifiers ? [...part.animationModifiers] : [],
        modifierGroups: part?.modifierGroups ? [...part.modifierGroups] : [],
        partKeyframes: part?.partKeyframes ? [...part.partKeyframes] : [],
      };
    });

    get().updateAnimationClip(clip.id, {
      tracks: newTracks,
      clipPartData: newClipPartData,
    });

    return { ...clip, tracks: newTracks, clipPartData: newClipPartData } as AnimationClip;
  },
});
