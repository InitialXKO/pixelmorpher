// ============================================================
// PixelMorpher - Editor Store (SEPARATE store from ProjectStore)
// Contains UI/editor state: tool, zoom, selection, SAM, part-edit mode, etc.
// ============================================================

import { create } from 'zustand';
import {
  EditorState,
  ToolType,
  PlayState,
  EditMode,
  CoordinateMode,
  MotionBlurBrushType,
  ModifierType,
  ModifierParamValue,
  BrushCommand,
  BrushStyleType,
  BrushStyleParams,
  DEFAULT_BRUSH_STYLE,
  StyleAspectType,
  StyleAspect,
  StrokeParamDriver,
  ParamDriver,
  SAMModelType,
  SAMStatus,
  PixelGrid,
  PixelColor,
} from '../types';
import { initSAM, setSAMImage as samSetImage, segmentAtPoint as samSegmentAtPoint, segmentWithBox as samSegmentWithBox, disposeSAM as samDispose } from '../sam';
import { inpaintPixels, samMaskToSelectionMask } from '../inpainting';
import { applyPixelModifiers, invalidateAnimModifierCache, bakeParamDriverToKeyframes } from '../engine';

interface EditorStore extends EditorState {
  setTool: (tool: ToolType) => void;
  setBrushSize: (size: number) => void;
  setBrushColor: (color: string) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setPlayState: (state: PlayState) => void;
  setEditMode: (mode: EditMode) => void;
  selectPart: (id: string | null) => void;
  selectKeyframe: (id: string | null) => void;
  selectModifier: (id: string | null) => void;
  selectEffectTrack: (id: string | null) => void;
  toggleGrid: () => void;
  toggleOnionSkin: () => void;
  toggleTrajectories: () => void;
  // Motion blur
  setAutoMotionBlur: (enabled: boolean) => void;
  setAutoMotionBlurIntensity: (intensity: number) => void;
  setMotionBlurBrushType: (type: MotionBlurBrushType) => void;
  setMotionBlurIntensity: (intensity: number) => void;
  setMotionBlurDirection: (direction: number) => void;
  // Effect brush
  setEffectBrushColor: (color: string) => void;
  setEffectBrushRadius: (radius: number) => void;
  setEffectBrushIntensity: (intensity: number) => void;
  setEffectBrushDensity: (density: number) => void;
  setEffectBrushSpread: (spread: number) => void;
  setEffectCoordinateMode: (mode: CoordinateMode) => void;
  setTrajectorySnap: (enabled: boolean) => void;
  setPreviewQuality: (quality: 'low' | 'medium' | 'high') => void;
  magicWandTolerance: number;
  setMagicWandTolerance: (tolerance: number) => void;
  // V2.0: Skeleton / Bone editor state
  selectedBoneId: string | null;
  setSelectedBoneId: (id: string | null) => void;
  activeSkeletonId: string | null;
  setActiveSkeletonId: (id: string | null) => void;
  showSkeletons: boolean;
  toggleSkeletons: () => void;
  showWeightPaint: boolean;
  toggleWeightPaint: () => void;
  weightPaintBoneId: string | null;
  setWeightPaintBoneId: (id: string | null) => void;
  weightPaintRadius: number;
  setWeightPaintRadius: (r: number) => void;
  showProcedural: boolean;
  toggleProcedural: () => void;
  // SAM / Smart Selection
  samState: import('../types').SAMState;
  initSAMModel: (model?: SAMModelType) => Promise<void>;
  setSAMImage: (canvas: HTMLCanvasElement) => Promise<void>;
  samSegmentAtPoint: (x: number, y: number) => Promise<void>;
  samSegmentWithBox: (x1: number, y1: number, x2: number, y2: number) => Promise<void>;
  clearSAMMask: () => void;
  disposeSAMModel: () => void;
  setInpaintRadius: (radius: number) => void;
  applyInpaint: (partId: string) => void;
  extractSAMMaskAsPart: () => string | null;
  // Part Edit Mode
  enterPartEditMode: (partId: string) => void;
  exitPartEditMode: (cancel: boolean) => void;
  addPartEditModifier: (type: ModifierType) => string;
  updatePartEditModifier: (modId: string, params: Record<string, ModifierParamValue>) => void;
  removePartEditModifier: (modId: string) => void;
  togglePartEditModifier: (modId: string) => void;
  setPartEditModifiers: (modifiers: import('../types').ModifierInstance[]) => void;
  bakePartEditModifiers: (partId: string) => void;
  // V5: Brush style
  setBrushStyle: (style: BrushStyleType) => void;
  setBrushStyleParams: (params: Partial<BrushStyleParams>) => void;
  applyBrushPreset: (preset: import('../types').BrushPreset) => void;
  // V7: Composable style aspects
  setCompositingMode: (enabled: boolean) => void;
  addStyleAspect: (type: StyleAspectType) => void;
  removeStyleAspect: (id: string) => void;
  toggleStyleAspect: (id: string) => void;
  updateStyleAspectParams: (id: string, params: Record<string, ModifierParamValue>) => void;
  clearStyleAspects: () => void;
  // V7: Stroke-direction parameter drivers
  addStrokeDriver: (driver: StrokeParamDriver) => void;
  removeStrokeDriver: (id: string) => void;
  updateStrokeDriver: (id: string, updates: Partial<StrokeParamDriver>) => void;
  toggleStrokeDriver: (id: string) => void;
  clearStrokeDrivers: () => void;
  // V7+: Part-edit BrushCommand stroke driver CRUD
  addStrokeDriverToPartEditCmd: (modifierId: string, commandId: string, driver: StrokeParamDriver) => void;
  removeStrokeDriverFromPartEditCmd: (modifierId: string, commandId: string, driverId: string) => void;
  updateStrokeDriverOnPartEditCmd: (modifierId: string, commandId: string, driverId: string, updates: Partial<StrokeParamDriver>) => void;
  toggleStrokeDriverOnPartEditCmd: (modifierId: string, commandId: string, driverId: string) => void;
  // V7+: Part-edit BrushCommand stroke driver param driver CRUD
  addPartEditStrokeDriverParamDriver: (modifierId: string, commandId: string, strokeDriverId: string, paramName: string, startFrame?: number, endFrame?: number) => void;
  removePartEditStrokeDriverParamDriver: (modifierId: string, commandId: string, strokeDriverId: string, driverId: string) => void;
  updatePartEditStrokeDriverParamDriver: (modifierId: string, commandId: string, strokeDriverId: string, driverId: string, updates: Partial<ParamDriver>) => void;
  togglePartEditStrokeDriverParamDriver: (modifierId: string, commandId: string, strokeDriverId: string, driverId: string) => void;
  // V7+: Part-edit BrushCommand stroke driver param keyframe CRUD
  addPartEditStrokeDriverParamKeyframe: (modifierId: string, commandId: string, strokeDriverId: string, frame: number, params: Record<string, ModifierParamValue>) => void;
  removePartEditStrokeDriverParamKeyframe: (modifierId: string, commandId: string, strokeDriverId: string, paramKfId: string) => void;
  bakePartEditStrokeDriverParamDriver: (modifierId: string, commandId: string, strokeDriverId: string, driverId: string) => void;
  unbakePartEditStrokeDriverParamDriver: (modifierId: string, commandId: string, strokeDriverId: string, driverId: string) => void;
  // Move tool target level
  moveTargetLevel: 'keyframe' | 'part_global';
  setMoveTargetLevel: (level: 'keyframe' | 'part_global') => void;
  // Palette constraint drawing
  paletteConstrained: boolean;
  setPaletteConstrained: (enabled: boolean) => void;
  selectedPaletteSlot: number | null;
  setSelectedPaletteSlot: (index: number | null) => void;
  // Hitbox editor
  selectedHitboxId: string | null;
  setSelectedHitboxId: (id: string | null) => void;
  // Puppet skeleton overlay
  togglePuppetSkeleton: () => void;
  setActivePuppetSkeletonId: (id: string | null) => void;
  // Puppet interaction mode
  puppetInteractionMode: 'move' | 'manipulate';
  setPuppetInteractionMode: (mode: 'move' | 'manipulate') => void;
}

const defaultEditor: EditorState = {
  tool: 'select',
  brushSize: 1,
  brushColor: '#ffffff',
  zoom: 4,
  panX: 0,
  panY: 0,
  playState: 'stopped',
  editMode: 'normal',
  selectedPartId: null,
  selectedKeyframeId: null,
  selectedModifierId: null,
  selectedEffectTrackId: null,
  showGrid: true,
  showOnionSkin: false,
  showTrajectories: false,
  isDirty: false,
  autoMotionBlur: false,
  autoMotionBlurIntensity: 0.5,
  motionBlurBrushType: 'linear',
  motionBlurIntensity: 5,
  motionBlurDirection: 0,
  effectBrushColor: '#ffff00',
  effectBrushRadius: 3,
  effectBrushIntensity: 0.5,
  effectBrushDensity: 10,
  effectBrushSpread: 5,
  effectCoordinateMode: 'follow_part',
  previewQuality: 'high' as const,
  magicWandTolerance: 32,
  trajectorySnap: false,
  samState: {
    status: 'idle' as SAMStatus,
    model: 'mobilesam' as SAMModelType,
    progress: 0,
    errorMessage: null,
    currentMask: null,
    maskShape: null,
    maskBounds: null,
  },
  inpaintRadius: 3,
  partEditPartId: null,
  partEditBackupPixels: null,
  partEditBackupModifiers: [],
  partEditModifiers: [],
  partEditBackupPartKeyframes: [],
  partEditStartFrame: undefined,
  brushStyle: 'solid' as BrushStyleType,
  brushStyleParams: { ...DEFAULT_BRUSH_STYLE },
  styleAspects: [],
  compositingMode: false,
  strokeDrivers: [],
  moveTargetLevel: 'keyframe',
  showPuppetSkeleton: false,
  activePuppetSkeletonId: null,
  puppetInteractionMode: 'move' as const,
  selectedHitboxId: null,
  paletteConstrained: false,
  selectedPaletteSlot: null,
};

// Lazy import to avoid circular dependency
let _useProjectStore: any = null;
function getProjectStore() {
  if (!_useProjectStore) {
    _useProjectStore = require('./index').useProjectStore;
  }
  return _useProjectStore;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...defaultEditor,
  moveTargetLevel: 'keyframe' as const,
  selectedBoneId: null,
  activeSkeletonId: null,
  showSkeletons: false,
  showWeightPaint: false,
  weightPaintBoneId: null,
  weightPaintRadius: 3,
  showProcedural: false,

  samState: {
    status: 'idle' as SAMStatus,
    model: 'mobilesam' as SAMModelType,
    progress: 0,
    errorMessage: null,
    currentMask: null,
    maskShape: null,
    maskBounds: null,
  },

  setTool: (tool) => set({ tool }),
  setBrushSize: (size) => set({ brushSize: size }),
  setBrushColor: (color) => set({ brushColor: color }),
  setZoom: (zoom) => set({ zoom: Math.max(1, Math.min(32, zoom)) }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  setPlayState: (state) => set({ playState: state }),
  setEditMode: (mode) => set({ editMode: mode }),
  selectPart: (id) => set({ selectedPartId: id, selectedKeyframeId: null, selectedModifierId: null }),
  selectKeyframe: (id) => set({ selectedKeyframeId: id }),
  selectModifier: (id) => set({ selectedModifierId: id }),
  selectEffectTrack: (id) => set({ selectedEffectTrackId: id }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleOnionSkin: () => set((s) => ({ showOnionSkin: !s.showOnionSkin })),
  toggleTrajectories: () => set((s) => ({ showTrajectories: !s.showTrajectories })),
  setAutoMotionBlur: (enabled) => set({ autoMotionBlur: enabled }),
  setAutoMotionBlurIntensity: (intensity) => set({ autoMotionBlurIntensity: intensity }),
  setMotionBlurBrushType: (type) => set({ motionBlurBrushType: type }),
  setMotionBlurIntensity: (intensity) => set({ motionBlurIntensity: intensity }),
  setMotionBlurDirection: (direction) => set({ motionBlurDirection: direction }),
  setEffectBrushColor: (color) => set({ effectBrushColor: color }),
  setEffectBrushRadius: (radius) => set({ effectBrushRadius: radius }),
  setEffectBrushIntensity: (intensity) => set({ effectBrushIntensity: intensity }),
  setEffectBrushDensity: (density) => set({ effectBrushDensity: density }),
  setEffectBrushSpread: (spread) => set({ effectBrushSpread: spread }),
  setEffectCoordinateMode: (mode) => set({ effectCoordinateMode: mode }),
  setTrajectorySnap: (enabled) => set({ trajectorySnap: enabled }),
  setPreviewQuality: (quality) => set({ previewQuality: quality }),
  setSelectedBoneId: (id) => set({ selectedBoneId: id }),
  setActiveSkeletonId: (id) => set({ activeSkeletonId: id }),
  toggleSkeletons: () => set((s) => ({ showSkeletons: !s.showSkeletons })),
  toggleWeightPaint: () => set((s) => ({ showWeightPaint: !s.showWeightPaint })),
  setWeightPaintBoneId: (id) => set({ weightPaintBoneId: id }),
  setWeightPaintRadius: (r) => set({ weightPaintRadius: r }),
  toggleProcedural: () => set((s) => ({ showProcedural: !s.showProcedural })),
  setMagicWandTolerance: (tolerance) => set({ magicWandTolerance: tolerance }),
  setMoveTargetLevel: (level) => set({ moveTargetLevel: level }),
  setPaletteConstrained: (enabled) => set({ paletteConstrained: enabled }),
  setSelectedPaletteSlot: (index) => set({ selectedPaletteSlot: index }),
  setSelectedHitboxId: (id) => set({ selectedHitboxId: id }),
  togglePuppetSkeleton: () => set((s) => ({ showPuppetSkeleton: !s.showPuppetSkeleton })),
  setActivePuppetSkeletonId: (id) => set({ activePuppetSkeletonId: id }),
  puppetInteractionMode: 'move' as const,
  setPuppetInteractionMode: (mode) => set({ puppetInteractionMode: mode }),

  initSAMModel: async (model?: SAMModelType) => {
    const { disposeSAMModel } = get();
    disposeSAMModel();
    set((s) => ({
      samState: { ...s.samState, status: 'loading', progress: 5, errorMessage: null, model: model ?? s.samState.model },
    }));
    try {
      await initSAM(model ?? get().samState.model, (status, progress) => {
        set((s) => ({ samState: { ...s.samState, status, progress } }));
      });
      set((s) => ({ samState: { ...s.samState, status: 'ready', progress: 100 } }));
    } catch (error: any) {
      set((s) => ({ samState: { ...s.samState, status: 'error', errorMessage: error.message, progress: 0 } }));
    }
  },
  setSAMImage: async (canvas: HTMLCanvasElement) => {
    set((s) => ({ samState: { ...s.samState, status: 'encoding' } }));
    try {
      await samSetImage(canvas);
      set((s) => ({ samState: { ...s.samState, status: 'ready' } }));
    } catch (error: any) {
      set((s) => ({ samState: { ...s.samState, status: 'error', errorMessage: error.message } }));
    }
  },
  samSegmentAtPoint: async (x: number, y: number) => {
    set((s) => ({ samState: { ...s.samState, status: 'segmenting' } }));
    try {
      const result = await samSegmentAtPoint(x, y);
      set((s) => ({
        samState: {
          ...s.samState,
          status: 'ready',
          currentMask: result.data,
          maskShape: result.shape,
          maskBounds: result.bounds,
        },
      }));
    } catch (error: any) {
      set((s) => ({ samState: { ...s.samState, status: 'error', errorMessage: error.message } }));
    }
  },
  samSegmentWithBox: async (x1: number, y1: number, x2: number, y2: number) => {
    set((s) => ({ samState: { ...s.samState, status: 'segmenting' } }));
    try {
      const result = await samSegmentWithBox(x1, y1, x2, y2);
      set((s) => ({
        samState: {
          ...s.samState,
          status: 'ready',
          currentMask: result.data,
          maskShape: result.shape,
          maskBounds: result.bounds,
        },
      }));
    } catch (error: any) {
      set((s) => ({ samState: { ...s.samState, status: 'error', errorMessage: error.message } }));
    }
  },
  clearSAMMask: () => set((s) => ({
    samState: { ...s.samState, currentMask: null, maskShape: null, maskBounds: null },
  })),
  disposeSAMModel: () => {
    samDispose();
    set((s) => ({
      samState: { ...s.samState, status: 'idle', currentMask: null, maskShape: null, maskBounds: null, progress: 0 },
    }));
  },
  setInpaintRadius: (radius) => set({ inpaintRadius: radius }),
  applyInpaint: (partId: string) => {
    const { samState, inpaintRadius } = get();
    if (!samState.currentMask || !samState.maskShape) return;

    const projectStore = getProjectStore().getState();
    const part = projectStore.parts.find(p => p.id === partId);
    if (!part) return;

    const offsetX = projectStore.canvasWidth / 2;
    const offsetY = projectStore.canvasHeight / 2;

    if (!samState.currentMask || !samState.maskShape) return;
    const canvasMask = samMaskToSelectionMask(
      samState.currentMask,
      samState.maskShape,
      projectStore.canvasWidth,
      projectStore.canvasHeight,
    );

    const partMask = new Set<string>();
    for (const key of canvasMask) {
      const [cx, cy] = key.split(',').map(Number);
      const lx = cx - (offsetX - part.pivotX + (part.offsetX || 0));
      const ly = cy - (offsetY - part.pivotY + (part.offsetY || 0));
      if (lx >= 0 && lx < part.width && ly >= 0 && ly < part.height) {
        partMask.add(`${lx},${ly}`);
      }
    }

    if (partMask.size === 0) return;

    const currentFrame = projectStore.currentFrame;
    const currentKf = projectStore.keyframes.find(k => k.partId === partId && k.frame === currentFrame);
    const basePixels = currentKf?.correctionMask ?? part.pixels;
    const inpaintedPixels = inpaintPixels(basePixels, partMask, inpaintRadius);
    if (currentKf?.correctionMask) {
      projectStore.setCorrection(currentKf.id, inpaintedPixels);
    } else {
      projectStore.setPartPixels(partId, inpaintedPixels);
    }
  },

  extractSAMMaskAsPart: () => {
    const { samState } = get();
    if (!samState.currentMask || !samState.maskShape) return null;

    const projectStore = getProjectStore().getState();
    let resultPartId: string | null = null;
    projectStore.performBatch('提取SAM选区', () => {
      const { canvasWidth, canvasHeight, parts } = projectStore;
    const offsetX = canvasWidth / 2;
    const offsetY = canvasHeight / 2;

    if (!samState.currentMask || !samState.maskShape) return null;
    const canvasMask = samMaskToSelectionMask(
      samState.currentMask,
      samState.maskShape,
      canvasWidth,
      canvasHeight,
    );

    if (canvasMask.size === 0) return null;

    const sorted = [...parts].filter((p) => p.visible).sort((a, b) => b.zIndex - a.zIndex);
    const selectedPixels: { x: number; y: number; color: string }[] = [];

    for (const key of canvasMask) {
      const [pxStr, pyStr] = key.split(',');
      const px = parseInt(pxStr, 10);
      const py = parseInt(pyStr, 10);

      for (const part of sorted) {
        const lx = px - (offsetX - part.pivotX + (part.offsetX || 0));
        const ly = py - (offsetY - part.pivotY + (part.offsetY || 0));
        if (lx >= 0 && lx < part.width && ly >= 0 && ly < part.height) {
          const color = part.pixels[ly]?.[lx];
          if (color !== null) {
            selectedPixels.push({ x: px, y: py, color });
            break;
          }
        }
      }
    }

    if (selectedPixels.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const px of selectedPixels) {
      minX = Math.min(minX, px.x);
      minY = Math.min(minY, px.y);
      maxX = Math.max(maxX, px.x);
      maxY = Math.max(maxY, px.y);
    }

    const partW = maxX - minX + 1;
    const partH = maxY - minY + 1;

    const colorMap = new Map<string, string>();
    for (const px of selectedPixels) {
      colorMap.set(`${px.x},${px.y}`, px.color);
    }

    const pixels: PixelGrid = [];
    let sumX = 0, sumY = 0, count = 0;
    for (let y = 0; y < partH; y++) {
      const row: PixelColor[] = [];
      for (let x = 0; x < partW; x++) {
        const key = `${minX + x},${minY + y}`;
        const color = colorMap.get(key);
        if (color) {
          row.push(color);
          sumX += x;
          sumY += y;
          count++;
        } else {
          row.push(null);
        }
      }
      pixels.push(row);
    }

    if (count === 0) return null;

    const pivotX = Math.round(sumX / count);
    const pivotY = Math.round(sumY / count);

    const part = projectStore.addPart('SAM选区', partW, partH);

    const newPivotX = pivotX + (minX - Math.floor(canvasWidth / 2)) + (part.pivotX - pivotX);
    const newPivotY = pivotY + (minY - Math.floor(canvasHeight / 2)) + (part.pivotY - pivotY);
    projectStore.updatePart(part.id, { pivotX: newPivotX, pivotY: newPivotY });
    projectStore.setPartPixels(part.id, pixels);

    get().selectPart(part.id);

    set((s) => ({
      samState: { ...s.samState, currentMask: null, maskShape: null, maskBounds: null },
    }));

    resultPartId = part.id;
    });

    return resultPartId;
  },

  enterPartEditMode: (partId: string) => {
    const projectStore = getProjectStore().getState();
    const part = projectStore.parts.find(p => p.id === partId);
    if (!part) return;

    const backupPixels = part.pixels.map(row => [...row]);
    const backupModifiers = part.editModifiers ? part.editModifiers.map(m => ({ ...m })) : [];
    const backupPartKeyframes = (part.partKeyframes || []).map(pkf => ({
      ...pkf,
      editModifiers: pkf.editModifiers.map(m => ({
        ...m,
        params: {
          ...m.params,
          ...(m.params.brushCommands ? { brushCommands: JSON.parse(JSON.stringify(m.params.brushCommands)) } : {}),
        },
      })),
    }));

    const currentFrame = projectStore.currentFrame;
    const resolvedMods = projectStore.resolvePartEditModifiers(partId, currentFrame);

    set({
      editMode: 'part_edit',
      partEditPartId: partId,
      partEditBackupPixels: backupPixels,
      partEditBackupModifiers: backupModifiers,
      partEditBackupPartKeyframes: backupPartKeyframes,
      partEditModifiers: resolvedMods.map(m => ({
        ...m,
        params: {
          ...m.params,
          ...(m.params.brushCommands ? { brushCommands: JSON.parse(JSON.stringify(m.params.brushCommands)) } : {}),
        },
      })),
      partEditStartFrame: currentFrame,
      selectedPartId: partId,
    });
  },

  exitPartEditMode: (cancel: boolean) => {
    const { partEditPartId, partEditBackupPixels, partEditBackupModifiers, partEditBackupPartKeyframes, partEditModifiers, partEditStartFrame } = get();

    if (!partEditPartId) {
      set({ editMode: 'normal', partEditPartId: null, partEditBackupPixels: null, partEditBackupModifiers: [], partEditBackupPartKeyframes: [], partEditModifiers: [], partEditStartFrame: undefined });
      return;
    }

    const projectStore = getProjectStore().getState();

    projectStore.performBatch(cancel ? '取消部件编辑' : '完成部件编辑', () => {
    if (cancel) {
      if (partEditBackupPixels) {
        projectStore.setPartPixels(partEditPartId, partEditBackupPixels);
      }
      projectStore.updatePart(partEditPartId, {
        editModifiers: partEditBackupModifiers,
        partKeyframes: partEditBackupPartKeyframes || [],
      });
    } else {
      const frame = partEditStartFrame ?? projectStore.currentFrame;
      const existingPkf = projectStore.getPartKeyframeAtFrame(partEditPartId, frame);
      if (existingPkf) {
        projectStore.updatePartKeyframe(partEditPartId, existingPkf.id, {
          editModifiers: partEditModifiers.map(m => ({
            ...m,
            params: {
              ...m.params,
              ...(m.params.brushCommands ? { brushCommands: JSON.parse(JSON.stringify(m.params.brushCommands)) } : {}),
            },
          })),
        });
      } else {
        const pkfId = projectStore.addPartKeyframe(partEditPartId, frame);
        projectStore.updatePartKeyframe(partEditPartId, pkfId, {
          editModifiers: partEditModifiers.map(m => ({
            ...m,
            params: {
              ...m.params,
              ...(m.params.brushCommands ? { brushCommands: JSON.parse(JSON.stringify(m.params.brushCommands)) } : {}),
            },
          })),
        });
      }
    }
    });

    set({
      editMode: 'normal',
      partEditPartId: null,
      partEditBackupPixels: null,
      partEditBackupModifiers: [],
      partEditBackupPartKeyframes: [],
      partEditModifiers: [],
      partEditStartFrame: undefined,
    });
  },

  addPartEditModifier: (type: ModifierType) => {
    const { createDefaultModifier } = require('../types');
    const newMod = createDefaultModifier(type);
    set((s) => ({
      partEditModifiers: [...s.partEditModifiers, newMod],
    }));
    return newMod.id;
  },

  setPartEditModifiers: (modifiers) => {
    set({ partEditModifiers: modifiers });
  },

  updatePartEditModifier: (modId: string, params: Record<string, ModifierParamValue>) => {
    set((s) => ({
      partEditModifiers: s.partEditModifiers.map((m) => {
        if (m.id !== modId) return m;
        return { ...m, params: { ...m.params, ...params } };
      }),
    }));
  },

  removePartEditModifier: (modId: string) => {
    set((s) => ({
      partEditModifiers: s.partEditModifiers.filter((m) => m.id !== modId),
    }));
  },

  togglePartEditModifier: (modId: string) => {
    set((s) => ({
      partEditModifiers: s.partEditModifiers.map((m) => {
        if (m.id !== modId) return m;
        return { ...m, enabled: !m.enabled };
      }),
    }));
  },

  bakePartEditModifiers: (partId: string) => {
    const projectStore = getProjectStore().getState();
    const part = projectStore.parts.find(p => p.id === partId);
    if (!part || !part.editModifiers || part.editModifiers.length === 0) return;

    const pixelModTypes: ModifierType[] = [
      'color_replace', 'outline', 'dither', 'pixel_displace',
      'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip',
      'pixel_edit',
    ];
    const pixelMods = part.editModifiers.filter(m => pixelModTypes.includes(m.type) && m.enabled);
    let resultPixels = part.pixels.map(row => [...row]);
    if (pixelMods.length > 0) {
      const currentFrame = projectStore.currentFrame;
      const modResult = applyPixelModifiers(part, pixelMods, currentFrame, resultPixels);
      resultPixels = modResult.pixels;
    }

    const translateMod = part.editModifiers.find(m => m.type === 'translate' && m.enabled);
    if (translateMod) {
      const dx = Math.round(Number(translateMod.params.offsetX) || 0);
      const dy = Math.round(Number(translateMod.params.offsetY) || 0);
      if (dx !== 0 || dy !== 0) {
        const shifted: PixelGrid = [];
        for (let y = 0; y < part.height; y++) {
          const row: PixelColor[] = [];
          for (let x = 0; x < part.width; x++) {
            const srcX = x - dx;
            const srcY = y - dy;
            if (srcX >= 0 && srcX < part.width && srcY >= 0 && srcY < part.height) {
              row.push(resultPixels[srcY]?.[srcX] ?? null);
            } else {
              row.push(null);
            }
          }
          shifted.push(row);
        }
        resultPixels = shifted;
      }
    }

    projectStore.setPartPixels(partId, resultPixels);
    projectStore.updatePart(partId, { editModifiers: [], partKeyframes: [] });

    const { partEditPartId } = get();
    if (partEditPartId === partId) {
      set({ partEditModifiers: [] });
    }
  },

  setBrushStyle: (style) => set({ brushStyle: style }),
  setBrushStyleParams: (params) => set((s) => ({
    brushStyleParams: { ...s.brushStyleParams, ...params },
  })),
  applyBrushPreset: (preset) => {
    const updates: Partial<EditorState> = {
      brushSize: preset.size,
      brushStyle: preset.style ?? 'solid',
    };
    if (preset.styleParams) {
      updates.brushStyleParams = { ...DEFAULT_BRUSH_STYLE, ...preset.styleParams };
    } else if (preset.style && preset.style !== 'solid') {
      // keep current params
    } else {
      updates.brushStyleParams = { ...DEFAULT_BRUSH_STYLE };
    }
    set(updates);
  },

  setCompositingMode: (enabled) => set({ compositingMode: enabled }),
  addStyleAspect: (type) => {
    const id = crypto.randomUUID();
    const { ASPECT_TYPE_PARAMS, DEFAULT_BRUSH_STYLE: DBS } = require('../types');
    const aspectParamKeys = ASPECT_TYPE_PARAMS[type];
    const defaultParams: Record<string, ModifierParamValue> = {};
    for (const key of aspectParamKeys) {
      if (key in DBS) {
        defaultParams[key] = DBS[key as keyof typeof DBS];
      }
    }
    set((s) => ({
      styleAspects: [...s.styleAspects, { id, type, enabled: true, params: defaultParams }],
    }));
  },
  removeStyleAspect: (id) => set((s) => ({
    styleAspects: s.styleAspects.filter((a) => a.id !== id),
  })),
  toggleStyleAspect: (id) => set((s) => ({
    styleAspects: s.styleAspects.map((a) => a.id === id ? { ...a, enabled: !a.enabled } : a),
  })),
  updateStyleAspectParams: (id, params) => set((s) => ({
    styleAspects: s.styleAspects.map((a) => a.id === id ? { ...a, params: { ...a.params, ...params } } : a),
  })),
  clearStyleAspects: () => set({ styleAspects: [] }),

  addStrokeDriver: (driver) => set((s) => ({
    strokeDrivers: [...s.strokeDrivers, driver],
  })),
  removeStrokeDriver: (id) => set((s) => ({
    strokeDrivers: s.strokeDrivers.filter((d) => d.id !== id),
  })),
  updateStrokeDriver: (id, updates) => set((s) => ({
    strokeDrivers: s.strokeDrivers.map((d) => d.id === id ? { ...d, ...updates } : d),
  })),
  toggleStrokeDriver: (id) => set((s) => ({
    strokeDrivers: s.strokeDrivers.map((d) => d.id === id ? { ...d, enabled: !d.enabled } : d),
  })),
  clearStrokeDrivers: () => set({ strokeDrivers: [] }),

  addStrokeDriverToPartEditCmd: (modifierId, commandId, driver) => set((s) => {
    const mods = s.partEditModifiers.map(m => {
      if (m.id !== modifierId) return m;
      const commands = ((m.params.brushCommands as BrushCommand[]) || []).map(c => {
        if (c.id !== commandId) return c;
        return { ...c, strokeDrivers: [...(c.strokeDrivers ?? []), driver] };
      });
      return { ...m, params: { ...m.params, brushCommands: commands } };
    });
    return { partEditModifiers: mods };
  }),
  removeStrokeDriverFromPartEditCmd: (modifierId, commandId, driverId) => set((s) => {
    const mods = s.partEditModifiers.map(m => {
      if (m.id !== modifierId) return m;
      const commands = ((m.params.brushCommands as BrushCommand[]) || []).map(c => {
        if (c.id !== commandId) return c;
        return { ...c, strokeDrivers: (c.strokeDrivers ?? []).filter(d => d.id !== driverId) };
      });
      return { ...m, params: { ...m.params, brushCommands: commands } };
    });
    return { partEditModifiers: mods };
  }),
  updateStrokeDriverOnPartEditCmd: (modifierId, commandId, driverId, updates) => set((s) => {
    const mods = s.partEditModifiers.map(m => {
      if (m.id !== modifierId) return m;
      const commands = ((m.params.brushCommands as BrushCommand[]) || []).map(c => {
        if (c.id !== commandId) return c;
        return { ...c, strokeDrivers: (c.strokeDrivers ?? []).map(d => d.id === driverId ? { ...d, ...updates } : d) };
      });
      return { ...m, params: { ...m.params, brushCommands: commands } };
    });
    return { partEditModifiers: mods };
  }),
  toggleStrokeDriverOnPartEditCmd: (modifierId, commandId, driverId) => set((s) => {
    const mods = s.partEditModifiers.map(m => {
      if (m.id !== modifierId) return m;
      const commands = ((m.params.brushCommands as BrushCommand[]) || []).map(c => {
        if (c.id !== commandId) return c;
        return { ...c, strokeDrivers: (c.strokeDrivers ?? []).map(d => d.id === driverId ? { ...d, enabled: !d.enabled } : d) };
      });
      return { ...m, params: { ...m.params, brushCommands: commands } };
    });
    return { partEditModifiers: mods };
  }),

  addPartEditStrokeDriverParamDriver: (modifierId, commandId, strokeDriverId, paramName, startFrame, endFrame) => set((s) => {
    const driver: ParamDriver = { ...require('../types').createDefaultParamDriver(paramName, 0.5, startFrame ?? 0, endFrame ?? -1) };
    const mods = s.partEditModifiers.map(m => {
      if (m.id !== modifierId) return m;
      const commands = ((m.params.brushCommands as BrushCommand[]) || []).map(c => {
        if (c.id !== commandId) return c;
        const drivers = (c.strokeDrivers ?? []).map(sd => {
          if (sd.id !== strokeDriverId) return sd;
          return { ...sd, paramDrivers: [...(sd.paramDrivers ?? []), driver] };
        });
        return { ...c, strokeDrivers: drivers };
      });
      return { ...m, params: { ...m.params, brushCommands: commands } };
    });
    return { partEditModifiers: mods };
  }),
  removePartEditStrokeDriverParamDriver: (modifierId, commandId, strokeDriverId, driverId) => set((s) => {
    const mods = s.partEditModifiers.map(m => {
      if (m.id !== modifierId) return m;
      const commands = ((m.params.brushCommands as BrushCommand[]) || []).map(c => {
        if (c.id !== commandId) return c;
        const drivers = (c.strokeDrivers ?? []).map(sd => {
          if (sd.id !== strokeDriverId) return sd;
          return { ...sd, paramDrivers: (sd.paramDrivers ?? []).filter(d => d.id !== driverId) };
        });
        return { ...c, strokeDrivers: drivers };
      });
      return { ...m, params: { ...m.params, brushCommands: commands } };
    });
    return { partEditModifiers: mods };
  }),
  updatePartEditStrokeDriverParamDriver: (modifierId, commandId, strokeDriverId, driverId, updates) => set((s) => {
    const mods = s.partEditModifiers.map(m => {
      if (m.id !== modifierId) return m;
      const commands = ((m.params.brushCommands as BrushCommand[]) || []).map(c => {
        if (c.id !== commandId) return c;
        const drivers = (c.strokeDrivers ?? []).map(sd => {
          if (sd.id !== strokeDriverId) return sd;
          return { ...sd, paramDrivers: (sd.paramDrivers ?? []).map(d => d.id === driverId ? { ...d, ...updates } : d) };
        });
        return { ...c, strokeDrivers: drivers };
      });
      return { ...m, params: { ...m.params, brushCommands: commands } };
    });
    return { partEditModifiers: mods };
  }),
  togglePartEditStrokeDriverParamDriver: (modifierId, commandId, strokeDriverId, driverId) => set((s) => {
    const mods = s.partEditModifiers.map(m => {
      if (m.id !== modifierId) return m;
      const commands = ((m.params.brushCommands as BrushCommand[]) || []).map(c => {
        if (c.id !== commandId) return c;
        const drivers = (c.strokeDrivers ?? []).map(sd => {
          if (sd.id !== strokeDriverId) return sd;
          return { ...sd, paramDrivers: (sd.paramDrivers ?? []).map(d => d.id === driverId ? { ...d, enabled: !d.enabled } : d) };
        });
        return { ...c, strokeDrivers: drivers };
      });
      return { ...m, params: { ...m.params, brushCommands: commands } };
    });
    return { partEditModifiers: mods };
  }),

  addPartEditStrokeDriverParamKeyframe: (modifierId, commandId, strokeDriverId, frame, params) => set((s) => {
    const newPk: import('../types').ModifierParamKeyframe = {
      id: crypto.randomUUID(),
      frame,
      params,
    };
    const mods = s.partEditModifiers.map(m => {
      if (m.id !== modifierId) return m;
      const commands = ((m.params.brushCommands as BrushCommand[]) || []).map(c => {
        if (c.id !== commandId) return c;
        const drivers = (c.strokeDrivers ?? []).map(sd => {
          if (sd.id !== strokeDriverId) return sd;
          const existing = sd.paramKeyframes ?? [];
          const filtered = existing.filter(pk => pk.frame !== frame);
          return { ...sd, paramKeyframes: [...filtered, newPk] };
        });
        return { ...c, strokeDrivers: drivers };
      });
      return { ...m, params: { ...m.params, brushCommands: commands } };
    });
    return { partEditModifiers: mods };
  }),
  removePartEditStrokeDriverParamKeyframe: (modifierId, commandId, strokeDriverId, paramKfId) => set((s) => {
    const mods = s.partEditModifiers.map(m => {
      if (m.id !== modifierId) return m;
      const commands = ((m.params.brushCommands as BrushCommand[]) || []).map(c => {
        if (c.id !== commandId) return c;
        const drivers = (c.strokeDrivers ?? []).map(sd => {
          if (sd.id !== strokeDriverId) return sd;
          return { ...sd, paramKeyframes: (sd.paramKeyframes ?? []).filter(pk => pk.id !== paramKfId) };
        });
        return { ...c, strokeDrivers: drivers };
      });
      return { ...m, params: { ...m.params, brushCommands: commands } };
    });
    return { partEditModifiers: mods };
  }),

  bakePartEditStrokeDriverParamDriver: (modifierId, commandId, strokeDriverId, driverId) => {
    const projectStore = getProjectStore().getState();
    projectStore.pushUndo('烘焙部件编辑笔画驱动器参数驱动器');
    invalidateAnimModifierCache(modifierId);
    const totalFrames = projectStore.totalFrames;
    const mod = get().partEditModifiers.find((m) => m.id === modifierId);
    if (!mod) return;
    const commands = (mod.params.brushCommands as BrushCommand[]) || [];
    const cmd = commands.find((c) => c.id === commandId);
    if (!cmd) return;
    const sd = (cmd.strokeDrivers ?? []).find((d) => d.id === strokeDriverId);
    if (!sd) return;
    const driver = (sd.paramDrivers ?? []).find((d) => d.id === driverId);
    if (!driver || driver.isBaked) return;

    const result = bakeParamDriverToKeyframes(
      driver,
      sd.paramKeyframes ?? [],
      totalFrames,
    );

    set((s2) => {
      const mods = s2.partEditModifiers.map((m) => {
        if (m.id !== modifierId) return m;
        const cmds = ((m.params.brushCommands as BrushCommand[]) || []).map(c => {
          if (c.id !== commandId) return c;
          const drivers = (c.strokeDrivers ?? []).map(d => {
            if (d.id !== strokeDriverId) return d;
            return {
              ...d,
              paramKeyframes: result.paramKeyframes,
              paramDrivers: (d.paramDrivers ?? []).map((pd) => {
                if (pd.id !== driverId) return pd;
                return { ...pd, ...result.driverUpdates };
              }),
            };
          });
          return { ...c, strokeDrivers: drivers };
        });
        return { ...m, params: { ...m.params, brushCommands: cmds } };
      });
      return { partEditModifiers: mods };
    });
  },

  unbakePartEditStrokeDriverParamDriver: (modifierId, commandId, strokeDriverId, driverId) => {
    const projectStore = getProjectStore().getState();
    projectStore.pushUndo('反烘焙部件编辑笔画驱动器参数驱动器');
    invalidateAnimModifierCache(modifierId);
    const mod = get().partEditModifiers.find((m) => m.id === modifierId);
    if (!mod) return;
    const commands = (mod.params.brushCommands as BrushCommand[]) || [];
    const cmd = commands.find((c) => c.id === commandId);
    if (!cmd) return;
    const sd = (cmd.strokeDrivers ?? []).find((d) => d.id === strokeDriverId);
    if (!sd) return;
    const driver = (sd.paramDrivers ?? []).find((d) => d.id === driverId);
    if (!driver || !driver.isBaked) return;

    set((s2) => {
      const mods = s2.partEditModifiers.map((m) => {
        if (m.id !== modifierId) return m;
        const cmds = ((m.params.brushCommands as BrushCommand[]) || []).map(c => {
          if (c.id !== commandId) return c;
          const drivers = (c.strokeDrivers ?? []).map(d => {
            if (d.id !== strokeDriverId) return d;
            return {
              ...d,
              paramKeyframes: [],
              paramDrivers: (d.paramDrivers ?? []).map((pd) => {
                if (pd.id !== driverId) return pd;
                return { ...pd, isBaked: false, enabled: true };
              }),
            };
          });
          return { ...c, strokeDrivers: drivers };
        });
        return { ...m, params: { ...m.params, brushCommands: cmds } };
      });
      return { partEditModifiers: mods };
    });
  },
}));
