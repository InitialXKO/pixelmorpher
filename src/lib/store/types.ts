// ============================================================
// PixelMorpher - Store Types (Unified ProjectStore interface)
// ============================================================
// The ProjectStore type MUST remain as the unified interface —
// all consumer components use `useProjectStore(s => s.someField)`.
// The slice split is purely internal.

import type { StateCreator } from 'zustand';
import type {
  Project,
  Track,
  Keyframe,
  ModifierInstance,
  ToolType,
  PlayState,
  EditMode,
  PixelGrid,
  EffectTrack,
  MotionBlurStroke,
  MotionBlurBrushType,
  EffectStroke,
  EffectBrushType,
  BrushPreset,
  CoordinateMode,
  ModifierType,
  PixelColor,
  // V2.0 imports
  ProceduralAnimation,
  ProceduralConfig,
  HistoryEntry,
  ProjectFile,
  // V2.4 imports
  CanvasModifierTrack,
  CanvasModifierInstance,
  CanvasModifierType,
  // V3.0 imports
  AnimationBlendMode,
  // V3.1 imports
  PartAnimationModifier,
  // V3.2 imports
  ModifierGroup,
  // V3.7: Parent-child constraints
  ModifierCoordinateMode,
  // PixelEdit brush command types
  BrushCommand,
  // M7: ParamDriver imports
  ParamDriver,
  ParamDriverWaveform,
  ParamDriverNumericParam,
  ParamSource,
  ParamDriverKeyframe,
  SecondaryParamDriver,
  AnimationVariable,
  VariableParamSource,
  // V5: Brush style types
  BrushStyleType,
  BrushStyleParams,
  DEFAULT_BRUSH_STYLE,
  // V7: Composable style aspects
  StyleAspect,
  StyleAspectType,
  StrokeParamDriver,
  ModifierParamValue,
  // V12: Global modifiers
  GlobalModifier,
  GlobalModifierType,
  // V3.0: Asset-based project model
  AnimationClip,
  ClipPartData,
  Costume,
} from '../types';
import type { Sprite } from '../unified-types';
import type { CharacterSlice } from './character-slice';
import type { DccPipelineSlice } from './dcc-pipeline-slice';
import type { GlobalModifierSlice } from './global-modifier-slice';
import type {
  TimelineZoom, SnapConfig, DEFAULT_SNAP_CONFIG,
  TrackTimelineDisplay, createDefaultTrackTimelineDisplay,
  OnionTransformFilterConfig, DEFAULT_ONION_FILTER_CONFIG,
  OnionSkinState, DEFAULT_ONION_SKIN_STATE,
  SelectionFrameStep,
} from '../v15-types';

export interface ProjectStore extends Omit<Project, 'selectedPuppetNodeId' | 'globalModifiers'>, CharacterSlice, DccPipelineSlice, GlobalModifierSlice {
  // Project actions
  setProjectName: (name: string) => void;
  setCanvasSize: (w: number, h: number) => void;
  setFrameRate: (fps: number) => void;
  setTotalFrames: (n: number) => void;
  setCurrentFrame: (f: number) => void;
  incrementFrame: () => void;
  setBackgroundColor: (color: string) => void;

  // Sprite actions (global sprite table)
  sprites: Record<string, Sprite>;
  addSprite: (name: string, width: number, height: number, opts?: { plugX?: number; plugY?: number }) => Sprite;
  removeSprite: (id: string) => void;
  /** 批量删除精灵（只压一条撤销记录）；undoLabel 可自定义（如「删除整摞」，
   * 配合调用方在同一步里做的角色侧清理共用这一条撤销） */
  removeSprites: (ids: string[], undoLabel?: string) => void;
  updateSprite: (id: string, updates: Partial<Sprite>) => void;
  updateSpriteLandmarks: (id: string, landmarks: import('../unified-types').SpriteLandmarks | undefined) => void;
  updateSpriteMarks: (id: string, marks: import('../unified-types').SpriteMark[] | undefined) => void;
  setSpritePixels: (id: string, pixels: PixelGrid) => void;
  duplicateSprite: (id: string) => Sprite | undefined;
  importSpriteFromImage: (name: string, imageData: ImageData) => Sprite;
  resizeSprite: (id: string, newWidth: number, newHeight: number, cropOffsetX?: number, cropOffsetY?: number) => void;
  transformSprite: (id: string, t: import('../sprite-transform').SpriteTransformRequest) => void;
  deriveSpriteFrom: (sourceSpriteId: string, opts: import('../sprite-transform').DeriveSpriteOptions) => Sprite | undefined;
  splitImageToSprites: (name: string, imageData: ImageData, regions: {x: number; y: number}[][]) => Sprite[];
  autoEstimatePlug: (spriteId: string) => void;

  // Track actions
  toggleTrackVisibility: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;
  toggleTrackExpanded: (trackId: string) => void;

  // Effect track actions
  addEffectTrack: (type: EffectTrack['type'], name: string) => void;
  removeEffectTrack: (id: string) => void;
  toggleEffectTrackVisibility: (id: string) => void;
  addEffectKeyframe: (effectTrackId: string, frame: number, params?: Record<string, ModifierParamValue>) => void;
  removeEffectKeyframe: (effectTrackId: string, keyframeId: string) => void;
  updateEffectKeyframe: (effectTrackId: string, keyframeId: string, params: Record<string, ModifierParamValue>) => void;


  // Motion blur stroke actions
  addMotionBlurStroke: (stroke: Omit<MotionBlurStroke, 'id'>) => void;
  updateMotionBlurStroke: (id: string, patch: Partial<MotionBlurStroke>) => void;
  removeMotionBlurStroke: (id: string) => void;
  clearMotionBlurStrokesForFrame: (frame: number) => void;

  // Effect stroke actions
  addEffectStroke: (stroke: Omit<EffectStroke, 'id'>) => void;
  updateEffectStroke: (id: string, patch: Partial<EffectStroke>) => void;
  removeEffectStroke: (id: string) => void;
  clearEffectStrokesForFrame: (frame: number) => void;

  // Onion skin
  toggleOnionSkin: () => void;
  setOnionSkinFrames: (n: number) => void;

  // Procedural Animation actions（旧骨骼系统已删除，2026-10-26；程序化动画为活功能保留）
  addProceduralAnimation: (spriteId: string, name: string, config: ProceduralConfig, startFrame: number, endFrame: number, nodeId?: string) => ProceduralAnimation;
  removeProceduralAnimation: (id: string) => void;
  updateProceduralAnimation: (id: string, updates: Partial<ProceduralAnimation>) => void;
  toggleProceduralAnimation: (id: string) => void;
  proceduralAnimations: ProceduralAnimation[];

  // V12: Global Modifier actions
  addGlobalModifier: (type: GlobalModifierType) => GlobalModifier;
  removeGlobalModifier: (id: string) => void;
  updateGlobalModifier: (id: string, updates: Partial<GlobalModifier>) => void;
  updateGlobalModifierParams: (id: string, params: Record<string, ModifierParamValue>) => void;
  toggleGlobalModifier: (id: string) => void;
  reorderGlobalModifier: (id: string, direction: 'up' | 'down') => void;

  // V2.0: Undo/Redo
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  _captureSnapshot: () => string;
  _COALESCE_WINDOW_MS: number;
  pushUndo: (description: string, coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Drag coalescing
  _dragActive: boolean;
  beginDrag: (description: string) => void;
  endDrag: () => void;
  // Batch/transaction
  performBatch: (description: string, fn: () => void) => void;

  // V2.0: Project Save/Load
  exportProjectFile: () => ProjectFile;
  importProjectFile: (file: ProjectFile) => void;

  // V2.0: Custom Modifiers (Plugin System)
  customModifiers: { id: string; name: string; params: any[]; execute: (pixels: any[], params: any) => any[] }[];
  registerCustomModifier: (modifier: { id: string; name: string; params: any[]; execute: (...args: any[]) => any[] }) => void;
  unregisterCustomModifier: (id: string) => void;

  // P2-3: Brush presets
  brushPresets: BrushPreset[];
  addBrushPreset: (preset: BrushPreset) => void;
  removeBrushPreset: (id: string) => void;
  updateBrushPreset: (id: string, updates: Partial<BrushPreset>) => void;

  // P2-6: Configurable undo levels
  maxUndoLevels: number;
  setMaxUndoLevels: (n: number) => void;

  // V2.4: Canvas Modifier actions
  addCanvasModifierTrack: (type: CanvasModifierType) => void;
  removeCanvasModifierTrack: (id: string) => void;
  toggleCanvasModifierTrackVisibility: (id: string) => void;
  toggleCanvasModifierTrackEnabled: (id: string) => void;
  addCanvasModifier: (trackId: string, type: CanvasModifierType) => void;
  removeCanvasModifier: (trackId: string, modifierId: string) => void;
  updateCanvasModifier: (trackId: string, modifierId: string, params: Record<string, ModifierParamValue>) => void;
  toggleCanvasModifier: (trackId: string, modifierId: string) => void;
  toggleCanvasModifierCollapsed: (trackId: string, modifierId: string) => void;
  reorderCanvasModifier: (trackId: string, modifierId: string, newIndex: number) => void;
  /** 第三参双形态：分键 map（值为参数袋，新口径，审计 F-30）或存量扁平
   * params 袋（值为标量/数组）——slice 内按值形态判形，扁平袋照旧落盘 */
  addCanvasModifierKeyframe: (trackId: string, frame: number, paramsOrByModifier?: Record<string, Record<string, ModifierParamValue> | ModifierParamValue>) => void;
  removeCanvasModifierKeyframe: (trackId: string, keyframeId: string) => void;
  /** 双形态：(modifierId, params) 只写该修改器分键；(params) 旧形态合并进扁平袋 */
  updateCanvasModifierKeyframe: (trackId: string, keyframeId: string, modifierIdOrParams: string | Record<string, ModifierParamValue>, params?: Record<string, ModifierParamValue>) => void;
  moveCanvasModifierKeyframe: (trackId: string, keyframeId: string, frame: number) => void;

  // M8: Animation variable actions
  addAnimationVariable: (name: string, scope: 'global' | 'part') => AnimationVariable;
  removeAnimationVariable: (variableId: string) => void;
  updateAnimationVariable: (variableId: string, updates: Partial<AnimationVariable>) => void;
  renameAnimationVariable: (variableId: string, name: string) => void;

  // Reset
  resetProject: () => void;

  // ---- V3.0: AnimationClip CRUD ----
  addAnimationClip: (name: string, characterId: string) => AnimationClip;
  removeAnimationClip: (clipId: string) => void;
  updateAnimationClip: (clipId: string, updates: Partial<AnimationClip>) => void;
  setActiveAnimationClip: (clipId: string | null) => void;
  /** Get the currently active animation clip (null if none selected) */
  getActiveAnimationClip: () => AnimationClip | null;

  /** Create an animation clip from a character (adds all character parts with tracks) */
  createClipFromCharacter: (characterId: string, clipName: string) => AnimationClip;

  // ---- V15: Visual Magnetic Timeline ----
  /** Current timeline zoom level (pixels per frame) */
  timelineZoom: TimelineZoom;
  /** Smart snap configuration */
  snapConfig: SnapConfig;
  /** Per-track timeline display settings (trackId → config) */
  trackTimelineDisplays: Record<string, TrackTimelineDisplay>;
  /** Timeline thumbnail rendering quality */
  timelineThumbnailQuality: 'off' | 'low' | 'medium' | 'high';
  /** Set timeline zoom */
  setTimelineZoom: (zoom: TimelineZoom) => void;
  /** Update snap config */
  updateSnapConfig: (updates: Partial<SnapConfig>) => void;
  /** Update a track's timeline display */
  updateTrackTimelineDisplay: (trackId: string, updates: Partial<TrackTimelineDisplay>) => void;
  /** Set timeline thumbnail quality */
  setTimelineThumbnailQuality: (quality: 'off' | 'low' | 'medium' | 'high') => void;

  // ---- V15: Transform Filter Onion Skin ----
  /** Onion skin transform filter configuration */
  onionTransformFilter: OnionTransformFilterConfig;
  /** Per-axis onion skin ghost visibility flags */
  onionSkinState: OnionSkinState;
  /** Update onion transform filter config */
  updateOnionTransformFilter: (updates: Partial<OnionTransformFilterConfig>) => void;
  /** Update onion skin state */
  updateOnionSkinState: (updates: Partial<OnionSkinState>) => void;

  // ---- V15: Mixed Frame Rate Rhythm Control ----
  /** Per-track frame step settings (trackId → steps) */
  trackFrameSteps: Record<string, number>;
  /** Per-segment frame step overrides: \"startFrame-endFrame\" → step value */
  trackSegmentSteps: Record<string, Record<string, number>>;
  /** Per-selection frame step overrides */
  selectionFrameSteps: SelectionFrameStep[];
  /** Set frame step for a track */
  setTrackFrameStep: (trackId: string, step: number) => void;
  /** Set frame step for a segment on a track */
  setTrackSegmentStep: (trackId: string, segmentKey: string, step: number) => void;
  /** Add a selection frame step override */
  addSelectionFrameStep: (selection: SelectionFrameStep) => void;
  /** Remove a selection frame step override */
  removeSelectionFrameStep: (id: string) => void;
  /** Update a selection frame step override */
  updateSelectionFrameStep: (id: string, updates: Partial<SelectionFrameStep>) => void;
  /** Get effective frame step for a track at a given frame */
  getEffectiveFrameStep: (trackId: string, frame: number) => number;
}

// Re-export StateCreator for convenience
export type { StateCreator };
