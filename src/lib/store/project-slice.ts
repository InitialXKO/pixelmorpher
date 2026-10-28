// ============================================================
// PixelMorpher - Project Slice
// Project name, canvas size, frame rate, total frames, current frame,
// background color, undo/redo, save/load, custom modifiers, brush presets,
// onion skin, reset, project base state
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import type { Project, HistoryEntry, ProjectFile, BrushPreset, AnimationClip, ClipPartData, Costume, Track } from '../types';
import { MODIFIER_DEFINITIONS } from '../types';
import { _isDragActive, _dragPostStackLen, _pendingTrajectorySpriteIds, setDragActive, setDragPostStackLen, resetDragState } from './shared';
import { invalidateInterpolationCache, invalidateParamDriverEvalCache } from '../engine';
import { resolveChainTarget3D, backfillNodeSlots } from '../unified-types';
import { migrateProjectTimeUnits } from '../blueprint/time-migration';
import { syncCharacterPatternBlueprints } from '../blueprint/pattern-sync';
import { migrateClipStructure } from '../clip-migration';
import { backfillSpriteBirth } from '../sprite-folder';
import { guardProjectBoneAxes } from '../bone-axis-guard';

const defaultProject: Project = {
  id: crypto.randomUUID(),
  name: '未命名项目',
  description: '',

  sprites: {},
  animationClips: [],
  activeAnimationClipId: null,

  // Project-level settings
  canvasWidth: 256,
  canvasHeight: 256,
  frameRate: 12,
  timeUnitsVersion: 2,
  patternBlueprintVersion: 1,
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

  // Unified Characters (new model)
  unifiedCharacters: {},
  selectedCharacterId: null,
  selectedNodeId: null,

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
  // 程序化动画初始状态（actions 在 procedural-slice）
  proceduralAnimations: import('../types').ProceduralAnimation[];
};

export const createProjectSlice: StateCreator<ProjectStore, [], [], Partial<ProjectStore>> = (set, get) => ({
  ...defaultProject,
  // Global sprite table (replaces Part asset library)
  sprites: {},
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
      sprites: s.sprites,
      animationClips: s.animationClips,
      activeAnimationClipId: s.activeAnimationClipId,
      tracks: s.tracks,
      keyframes: s.keyframes,
      effectTracks: s.effectTracks,
      canvasModifierTracks: s.canvasModifierTracks,
      trajectories: s.trajectories,
      motionBlurStrokes: s.motionBlurStrokes,
      effectStrokes: s.effectStrokes,
      proceduralAnimations: s.proceduralAnimations,
      canvasWidth: s.canvasWidth,
      canvasHeight: s.canvasHeight,
      frameRate: s.frameRate,
      timeUnitsVersion: s.timeUnitsVersion ?? 2,
      patternBlueprintVersion: (s as any).patternBlueprintVersion ?? 1,
      totalFrames: s.totalFrames,
      currentFrame: s.currentFrame,
      backgroundColor: s.backgroundColor,
      onionSkinEnabled: s.onionSkinEnabled,
      onionSkinFrames: s.onionSkinFrames,
      customModifiers: s.customModifiers,
      brushPresets: s.brushPresets,
      maxUndoLevels: s.maxUndoLevels,
      globalModifiers: s.globalModifiers,
      animationVariables: s.animationVariables,
      // Unified Characters (new model, primary source)
      unifiedCharacters: s.unifiedCharacters,
      selectedCharacterId: s.selectedCharacterId,
      selectedNodeId: s.selectedNodeId,
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

    if (_pendingTrajectorySpriteIds.size > 0) {
      const spriteIds = [..._pendingTrajectorySpriteIds];
      _pendingTrajectorySpriteIds.clear();
      setTimeout(() => {
        for (const sid of spriteIds) {
          get().autoRecordTrajectory(sid);
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
    // H8/H9: undo 恢复了历史快照，缓存必须失效
    invalidateInterpolationCache();
    invalidateParamDriverEvalCache();
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
    // H8/H9: redo 恢复了历史快照，缓存必须失效
    invalidateInterpolationCache();
    invalidateParamDriverEvalCache();
  },

  canUndo: () => get().undoStack.length > 0 && !_isDragActive,
  canRedo: () => get().redoStack.length > 0 && !_isDragActive,

  exportProjectFile: () => {
    const state = get();
    return {
      version: '3.1',
      project: {
        id: state.id,
        name: state.name,
        description: state.description,
        sprites: state.sprites,
        animationClips: state.animationClips,
        activeAnimationClipId: state.activeAnimationClipId,
        canvasWidth: state.canvasWidth,
        canvasHeight: state.canvasHeight,
        frameRate: state.frameRate,
        timeUnitsVersion: state.timeUnitsVersion ?? 2,
        patternBlueprintVersion: (state as any).patternBlueprintVersion ?? 1,
        totalFrames: state.totalFrames,
        currentFrame: state.currentFrame,
        backgroundColor: state.backgroundColor,
        onionSkinEnabled: state.onionSkinEnabled,
        onionSkinFrames: state.onionSkinFrames,
        globalModifiers: state.globalModifiers,
        animationVariables: state.animationVariables,
        // Legacy fields for backward compatibility
        tracks: state.tracks,
        keyframes: state.keyframes,
        effectTracks: state.effectTracks,
        canvasModifierTracks: state.canvasModifierTracks,
        trajectories: state.trajectories,
        motionBlurStrokes: state.motionBlurStrokes,
        effectStrokes: state.effectStrokes,
        // Unified Characters (new model)
        unifiedCharacters: state.unifiedCharacters,
        selectedCharacterId: state.selectedCharacterId,
        selectedNodeId: state.selectedNodeId,
        // DCC Pipeline
        palettes: state.palettes,
        activePaletteId: state.activePaletteId,
      },
      proceduralAnimations: state.proceduralAnimations,
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

    const processedParts = ((file.project as any).parts || []).map((p: any) => ({
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

    if (animationClips.length === 0) {
      // 创建默认木偶动画 clip（旧部件关键帧系统已统一为木偶模型，不再迁移）
      // 归属必填：绑工程的第一个角色（无角色时 '' 占位，建角色后在片段面板改绑）
      const migratedClip: AnimationClip = {
        id: crypto.randomUUID(),
        name: file.project.name || '默认动画',
        puppetCharacterId: Object.keys(file.project.unifiedCharacters ?? {})[0] ?? '',
        startFrame: 0,
        endFrame: (file.project.totalFrames ?? 24) - 1,
        loop: false,
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

    // Migrate parts → sprites (Part retired; Sprite is the single pixel asset type)
    // Also migrate Character.sprites → global table (dedupe by ID)
    const migratedSprites: Record<string, import('../unified-types').Sprite> = {
      ...(file.project.sprites ?? {}),
    };
    for (const p of processedParts as any[]) {
      if (!p?.id || migratedSprites[p.id]) continue;
      migratedSprites[p.id] = {
        id: p.id,
        name: p.name,
        width: p.width,
        height: p.height,
        data: p.pixels ?? [],
        plug: p.pivotX !== undefined ? { x: (p.pivotX ?? 0) / 16, y: (p.pivotY ?? 0) / 16 } : undefined,
        heightmap: p.heightmap,
      };
    }
    let unifiedCharacters = file.project.unifiedCharacters || {};
    // IK target3D 填充：旧项目链只有 target（链朝向画布平面上的点），按文件画布尺寸与
    // 链根节点朝向反投影换算为原点中心 3D 目标（东向时 x 分量落入 z）。填充后 target 原样保留作旧义镜像。
    const fileCanvasW = file.project.canvasWidth ?? 256;
    const fileCanvasH = file.project.canvasHeight ?? 256;
    for (const ch of Object.values(unifiedCharacters) as any[]) {
      for (const chain of ch?.ikChains ?? []) {
        if (chain && !chain.target3D && chain.target) {
          const rootVariant = ch.nodes?.[chain.rootNodeId]?.transform?.variantIndex ?? 6;
          chain.target3D = resolveChainTarget3D(chain, fileCanvasW, fileCanvasH, rootVariant);
        }
      }
    }
    // 片段结构迁移（一次性、幂等）：片段归属补绑 + 时间窗换算 + 旧片段
    // 关键帧里的修饰器/转面/图层数据迁入节点轨道。必须在时间单位迁移
    // 之前跑——迁入轨道的修饰器还要吃时间换算（其循环已改走轨道）。
    {
      const clipMig = migrateClipStructure(
        animationClips as unknown as Array<Record<string, any>>,
        unifiedCharacters as any,
        { projectTotalFrames: file.project.totalFrames ?? 24, activeClipId: activeAnimationClipId },
      );
      animationClips = clipMig.clips;
      unifiedCharacters = clipMig.characters as typeof unifiedCharacters;
      const r = clipMig.report;
      if (r.boundClips.length > 0 || r.dropped.length > 0 || r.phantomFieldsRemoved > 0) {
        console.warn('[clip-migration] 片段结构迁移', JSON.stringify(r));
      }
    }

    // 时间单位迁移（帧制 → 秒制）：旧工程一次性换算全部图与修改器的
    // 时间参数（行为/表演按 60、节点蓝图/修改器按工程帧率、烘焙 IK
    // 蓝图按 12），工程级标记 timeUnitsVersion>=2 时跳过。
    if ((file.project as any).timeUnitsVersion !== 2) {
      migrateProjectTimeUnits(
        unifiedCharacters as any,
        animationClips as any,
        (file.project.globalModifiers ?? []) as any,
        file.project.frameRate ?? 12,
      );
    }

    // 图案↔蓝图统一迁移（2026-10-27 甲案）：存量工程把图案实例
    // 镜像进已有节点蓝图（dynamic_pattern 节点，手术式）；无蓝图
    // 的节点不新建（读侧生成覆盖）。一次性，标记后跳过。
    if ((file.project as any).patternBlueprintVersion !== 1) {
      for (const [cid, ch] of Object.entries(unifiedCharacters)) {
        (unifiedCharacters as any)[cid] = syncCharacterPatternBlueprints(ch as any, false);
      }
    }

    // 服装件定义补挂（一次性、幂等）：存量工程的无 slot 节点补默认件
    // （slotKey = 节点 id，与全部按节点 id 写件的写侧同键）；已有 slot
    // 原样不动、pieces 数据零改动。新工程的节点由 createDefaultNode
    // 出生自带，此处只兜存量。历史快照同理（快照内角色一并补挂，
    // 解析失败的条目原样保留）——否则撤销回旧快照会带回无 slot 节点。
    backfillNodeSlots(unifiedCharacters as any);
    const importedHistory = (file.history || []).map((entry: any) => {
      if (!entry?.snapshot || typeof entry.snapshot !== 'string') return entry;
      try {
        const parsed = JSON.parse(entry.snapshot);
        if (!parsed?.unifiedCharacters) return entry;
        let dirty = backfillNodeSlots(parsed.unifiedCharacters);
        // 骨轴守卫（与主数据同构）：快照内角色一并改轴，快照自带
        // 精灵表时反旋副本写回该表；无表时引用精灵不可达的角色
        // 由守卫中止保持原样（安全方向）。
        const snapSprites = (parsed.sprites ?? {}) as Record<string, import('../unified-types').Sprite>;
        const ag = guardProjectBoneAxes(parsed.unifiedCharacters, snapSprites);
        if (ag.changed) {
          dirty = true;
          if (parsed.sprites || Object.keys(snapSprites).length > 0) parsed.sprites = snapSprites;
        }
        if (dirty) return { ...entry, snapshot: JSON.stringify(parsed) };
      } catch { /* 快照损坏则原样保留 */ }
      return entry;
    });

    for (const ch of Object.values(unifiedCharacters) as any[]) {
      if (!ch?.sprites) continue;
      for (const [sid, sp] of Object.entries(ch.sprites) as [string, any][]) {
        if (!migratedSprites[sid]) {
          migratedSprites[sid] = { id: sid, ...sp };
        }
      }
      // Character.sprites retired — refs are now global
      delete ch.sprites;
    }

    // 精灵出生信息回填（一次性、幂等）：存量烘焙精灵按
    // id 约定（spr_<角色>_<骨序>_…_<方向>）补出生方向夹
    // 与出生标签（角色/骨）；只填未设的，用户手动改过
    // 的不覆盖（sprite-folder.ts）。
    const backfilled = backfillSpriteBirth(migratedSprites);
    const finalSprites = backfilled.changed > 0 ? backfilled.sprites : migratedSprites;

    // 骨轴守卫（读入规范化，一次性、幂等）：静止方向落进水平带
    // 的骨段在数据层改轴（父帧 ±90° 增益 + 偏移反旋 + 精灵 D4
    // 反旋副本），静止几何与绘制逐点不变、IK 两角反解全朝向
    // 可达；合规角色零改动，冲突/不可修的段只点名不改（见
    // bone-axis-guard 报告）。必须在精灵合并完成后跑（反旋副本
    // 注册进 finalSprites）。
    {
      const ag = guardProjectBoneAxes(unifiedCharacters as any, finalSprites as any);
      const notes: string[] = [];
      for (const [cid, r] of Object.entries(ag.reports)) {
        if (r.changed) notes.push(`${cid}: 改轴节点 ${r.gainedNodes.length}、修复段 ${r.fixedSegments.length}`);
        if (r.aborted) notes.push(`${cid}: 中止（${r.aborted}）`);
        for (const u of r.unfixableSegments) notes.push(`${cid}: 不可修段 ${u.parentId}->${u.childId}（${u.reason}）`);
      }
      if (notes.length > 0) console.warn('[bone-axis-guard] 读入改轴', JSON.stringify(notes));
    }

    set({
      ...file.project,
      keyframes: processedKeyframes,
      sprites: finalSprites,
      animationClips,
      activeAnimationClipId,
      id: file.project.id || crypto.randomUUID(),
      description: file.project.description ?? '',
      proceduralAnimations: file.proceduralAnimations || [],
      globalModifiers: file.project.globalModifiers || [],
      animationVariables: file.project.animationVariables || [],
      // Unified Characters (new model; migrated on load if missing)
      unifiedCharacters,
      timeUnitsVersion: 2,
      selectedCharacterId: file.project.selectedCharacterId ?? null,
      selectedNodeId: file.project.selectedNodeId ?? null,
      // DCC Pipeline
      palettes: file.project.palettes || [],
      activePaletteId: file.project.activePaletteId ?? null,
      undoStack: importedHistory,
      redoStack: [],
    });

    // Note: Old puppet-format files (v3.0) are NOT auto-migrated.
    // Users should re-import from Spine source via SpineImportDialog.
    // unifiedCharacters is the single source of truth since v3.1.

    // Sync legacy fields from the active clip
    if (activeAnimationClipId) {
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
    const newSpriteIds: string[] = [];

    for (const region of result.regions) {
      const { x: bx, y: by, width: rw, height: rh } = region.bounds;
      const spritePixels: any[] = Array.from({ length: rh }, () => Array(rw).fill(null));

      for (const p of region.pixels) {
        const lx = p.x - bx;
        const ly = p.y - by;
        if (ly >= 0 && ly < rh && lx >= 0 && lx < rw) {
          const refFrame = frames[frames.length - 1];
          if (p.y < refFrame.length && p.x < refFrame[0].length) {
            spritePixels[ly][lx] = refFrame[p.y][p.x];
          }
        }
      }

      const sprite = get().addSprite(`精灵_${region.id}`, rw, rh, {
        plugX: Math.round(region.pivotX - bx),
        plugY: Math.round(region.pivotY - by),
      });
      get().setSpritePixels(sprite.id!, spritePixels);
      newSpriteIds.push(sprite.id!);
    }

    return newSpriteIds;
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
      proceduralAnimations: [],
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
      globalModifiers: [],
    }));
    resetDragState();
  },

  // ============================================================
  // V3.0: AnimationClip CRUD
  // ============================================================

  addAnimationClip: (name: string, characterId: string) => {
    get().pushUndo('添加动画片段');
    const s = get();
    const clip: AnimationClip = {
      id: crypto.randomUUID(),
      name,
      puppetCharacterId: characterId,
      startFrame: 0,
      endFrame: Math.max(0, s.totalFrames - 1),
      loop: false,
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
    }
  },

  setActiveAnimationClip: (clipId: string | null) => {
    // 校验存在：指向不存在片段的激活 id 会让消费端各自回退、口径分叉
    if (clipId !== null && !get().animationClips.some((c) => c.id === clipId)) return;
    set({ activeAnimationClipId: clipId });
  },

  getActiveAnimationClip: () => {
    const s = get();
    if (!s.activeAnimationClipId) return null;
    return s.animationClips.find(c => c.id === s.activeAnimationClipId) ?? null;
  },





  createClipFromCharacter: (characterId: string, clipName: string): AnimationClip => {
    // 统一为木偶模型：建一个归属该角色的空片段（时间窗缺省全程）
    return get().addAnimationClip(clipName, characterId);
  },
});