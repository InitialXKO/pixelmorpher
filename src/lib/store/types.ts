// ============================================================
// PixelMorpher - Store Types (Unified ProjectStore interface)
// ============================================================
// The ProjectStore type MUST remain as the unified interface —
// all consumer components use `useProjectStore(s => s.someField)`.
// The slice split is purely internal.

import type { StateCreator } from 'zustand';
import type {
  Project,
  Part,
  Track,
  Keyframe,
  ModifierInstance,
  ToolType,
  PlayState,
  EditMode,
  PixelGrid,
  EffectTrack,
  Trajectory,
  TrajectoryPoint,
  TrajectoryCurvePoint,
  AfterimageConfig,
  MotionBlurStroke,
  MotionBlurBrushType,
  EffectStroke,
  EffectBrushType,
  BrushPreset,
  CoordinateMode,
  ModifierType,
  PixelColor,
  // V2.0 imports
  Bone,
  BonePose,
  Skeleton,
  BoneConstraint,
  ProceduralAnimation,
  ProceduralConfig,
  WeightMap,
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
  // V4.1: Part keyframe type
  PartKeyframe,
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
  Character,
  Costume,
} from '../types';
import type { PuppetSlice } from './puppet-slice';
import type { DccPipelineSlice } from './dcc-pipeline-slice';
import type { UnifiedSlice } from './unified-slice';

export interface ProjectStore extends Omit<Project, 'selectedPuppetNodeId'>, PuppetSlice, DccPipelineSlice, UnifiedSlice {
  // Project actions
  setProjectName: (name: string) => void;
  setCanvasSize: (w: number, h: number) => void;
  setFrameRate: (fps: number) => void;
  setTotalFrames: (n: number) => void;
  setCurrentFrame: (f: number) => void;
  incrementFrame: () => void;
  setBackgroundColor: (color: string) => void;

  // Part actions
  addPart: (name: string, width: number, height: number, opts?: { pivotX?: number; pivotY?: number }) => Part;
  removePart: (id: string) => void;
  updatePart: (id: string, updates: Partial<Part>) => void;
  setPartPixels: (id: string, pixels: PixelGrid) => void;
  duplicatePart: (id: string) => void;
  reorderPart: (id: string, newZIndex: number) => void;
  importPartFromImage: (name: string, imageData: ImageData) => Part;
  /** Resize a part's pixel grid, preserving existing pixels and adjusting pivot.
   *  cropOffsetX/Y control which portion of the original pixels is kept:
   *    - positive = shift original content right/down within the new canvas
   *    - negative = crop from left/top (effectively shifting content left/up) */
  resizePart: (id: string, newWidth: number, newHeight: number, cropOffsetX?: number, cropOffsetY?: number) => void;

  // Split image actions
  splitImageToParts: (name: string, imageData: ImageData, regions: {x: number; y: number}[][]) => Part[];
  autoEstimatePivot: (partId: string) => void;

  // Track actions
  toggleTrackVisibility: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;
  toggleTrackExpanded: (trackId: string) => void;

  // Keyframe actions
  addKeyframe: (partId: string, frame: number) => Keyframe;
  removeKeyframe: (keyframeId: string) => void;
  updateKeyframe: (keyframeId: string, updates: Partial<Keyframe>) => void;
  duplicateKeyframe: (keyframeId: string, toFrame: number) => Keyframe;
  getKeyframesForPart: (partId: string) => Keyframe[];
  getKeyframeAtFrame: (partId: string, frame: number) => Keyframe | undefined;
  getSurroundingKeyframes: (partId: string, frame: number) => { prev: Keyframe | null; next: Keyframe | null; t: number };

  // Modifier actions
  addModifier: (keyframeId: string, type: ModifierType) => void;
  removeModifier: (keyframeId: string, modifierId: string) => void;
  updateModifier: (keyframeId: string, modifierId: string, params: Record<string, ModifierParamValue>) => void;
  toggleModifier: (keyframeId: string, modifierId: string) => void;
  toggleModifierCollapsed: (keyframeId: string, modifierId: string) => void;
  reorderModifier: (keyframeId: string, modifierId: string, newIndex: number) => void;
  collapseModifiers: (keyframeId: string) => void;
  uncollapseModifiers: (keyframeId: string) => void;
  bakeModifiers: (keyframeId: string) => void;
  // V3.0: Bake animation modifiers to timeline keyframes
  bakeToTimeline: (partId: string, startFrame: number, endFrame: number, step: number) => void;
  // V3.0: Update modifier effective range
  updateModifierRange: (keyframeId: string, modifierId: string, range: { startFrame?: number; endFrame?: number; fadeInFrames?: number; fadeOutFrames?: number }) => void;
  // V2.3: Scope-aware modifier actions
  addModifierToSubsequent: (partId: string, fromFrame: number, type: ModifierType) => void;
  removeModifierFromSubsequent: (partId: string, fromFrame: number, modifierType: ModifierType) => void;

  // M6: Modifier parameter keyframe actions
  addModifierParamKeyframe: (keyframeId: string, modifierId: string, frame: number, params: Record<string, ModifierParamValue>) => void;
  removeModifierParamKeyframe: (keyframeId: string, modifierId: string, paramKfId: string) => void;
  updateModifierParamKeyframe: (keyframeId: string, modifierId: string, paramKfId: string, params: Record<string, ModifierParamValue>) => void;

  // M7: PartAnimationModifier param keyframe actions
  addAnimModifierParamKeyframe: (partId: string, modifierId: string, frame: number, params: Record<string, ModifierParamValue>) => void;
  removeAnimModifierParamKeyframe: (partId: string, modifierId: string, paramKfId: string) => void;

  // M7: ParamDriver actions
  addParamDriver: (keyframeId: string, modifierId: string, paramName: string, startFrame?: number, endFrame?: number) => void;
  removeParamDriver: (keyframeId: string, modifierId: string, driverId: string) => void;
  updateParamDriver: (keyframeId: string, modifierId: string, driverId: string, updates: Partial<ParamDriver>) => void;
  toggleParamDriver: (keyframeId: string, modifierId: string, driverId: string) => void;
  /** Bake a ParamDriver into consecutive paramKeyframes for manual editing */
  bakeParamDriver: (keyframeId: string, modifierId: string, driverId: string) => void;
  /** Unbake: remove baked paramKeyframes that came from a driver, re-enable the driver */
  unbakeParamDriver: (keyframeId: string, modifierId: string, driverId: string) => void;

  // M7: PartAnimationModifier ParamDriver actions
  addAnimParamDriver: (partId: string, modifierId: string, paramName: string, startFrame?: number, endFrame?: number) => void;
  removeAnimParamDriver: (partId: string, modifierId: string, driverId: string) => void;
  updateAnimParamDriver: (partId: string, modifierId: string, driverId: string, updates: Partial<ParamDriver>) => void;
  toggleAnimParamDriver: (partId: string, modifierId: string, driverId: string) => void;
  bakeAnimParamDriver: (partId: string, modifierId: string, driverId: string) => void;
  unbakeAnimParamDriver: (partId: string, modifierId: string, driverId: string) => void;

  // Correction actions
  setCorrection: (keyframeId: string, mask: PixelGrid | null) => void;
  clearCorrection: (keyframeId: string) => void;

  // Effect track actions
  addEffectTrack: (type: EffectTrack['type'], name: string) => void;
  removeEffectTrack: (id: string) => void;
  toggleEffectTrackVisibility: (id: string) => void;
  addEffectKeyframe: (effectTrackId: string, frame: number, params?: Record<string, ModifierParamValue>) => void;
  removeEffectKeyframe: (effectTrackId: string, keyframeId: string) => void;
  updateEffectKeyframe: (effectTrackId: string, keyframeId: string, params: Record<string, ModifierParamValue>) => void;

  // Trajectory actions
  addTrajectoryPoint: (partId: string, frame: number, x: number, y: number, rotation: number) => void;
  updateTrajectoryPoint: (partId: string, frame: number, updates: Partial<Omit<TrajectoryCurvePoint, 'frame'>>) => void;
  clearTrajectory: (partId: string) => void;
  toggleTrajectoryVisibility: (partId: string) => void;
  autoRecordTrajectory: (partId: string) => void;
  generateTweenFromTrajectory: (partId: string, startFrame: number, endFrame: number, step: number) => void;
  generateAfterimageSequence: (partId: string, config: AfterimageConfig) => void;

  // Motion blur stroke actions
  addMotionBlurStroke: (stroke: Omit<MotionBlurStroke, 'id'>) => void;
  removeMotionBlurStroke: (id: string) => void;
  clearMotionBlurStrokesForFrame: (frame: number) => void;

  // Effect stroke actions
  addEffectStroke: (stroke: Omit<EffectStroke, 'id'>) => void;
  removeEffectStroke: (id: string) => void;
  clearEffectStrokesForFrame: (frame: number) => void;

  // Onion skin
  toggleOnionSkin: () => void;
  setOnionSkinFrames: (n: number) => void;

  // V2.0: Skeleton / Bone actions
  addSkeleton: (name: string) => Skeleton;
  removeSkeleton: (id: string) => void;
  addBone: (skeletonId: string, name: string, parentId: string | null, headX: number, headY: number, tailX: number, tailY: number) => Bone;
  removeBone: (skeletonId: string, boneId: string) => void;
  updateBone: (skeletonId: string, boneId: string, updates: Partial<Bone>) => void;
  bindPartToBone: (skeletonId: string, boneId: string, partId: string, weight: number) => void;
  unbindPartFromBone: (skeletonId: string, boneId: string, partId: string) => void;
  addBoneConstraint: (skeletonId: string, boneId: string, constraint: BoneConstraint) => void;
  removeBoneConstraint: (skeletonId: string, boneId: string, constraintIndex: number) => void;
  addBonePose: (skeletonId: string, boneId: string, frame: number, rotation: number, ikTargetX?: number, ikTargetY?: number) => void;
  removeBonePose: (skeletonId: string, boneId: string, frame: number) => void;
  toggleSkeletonVisibility: (skeletonId: string) => void;
  setSelectedBoneId: (boneId: string | null) => void;
  selectedBoneId: string | null;

  // V2.0: Procedural Animation actions
  addProceduralAnimation: (partId: string, name: string, config: ProceduralConfig, startFrame: number, endFrame: number) => ProceduralAnimation;
  removeProceduralAnimation: (id: string) => void;
  updateProceduralAnimation: (id: string, updates: Partial<ProceduralAnimation>) => void;
  toggleProceduralAnimation: (id: string) => void;
  proceduralAnimations: ProceduralAnimation[];

  // V2.0: Weight Map actions
  weightMaps: WeightMap[];
  setWeightMap: (partId: string, weights: (string | null)[][]) => void;
  getWeightMap: (partId: string) => WeightMap | undefined;

  // V12: Global Modifier actions
  addGlobalModifier: (type: GlobalModifierType) => GlobalModifier;
  removeGlobalModifier: (id: string) => void;
  updateGlobalModifier: (id: string, updates: Partial<GlobalModifier>) => void;
  updateGlobalModifierParams: (id: string, params: Record<string, ModifierParamValue>) => void;
  toggleGlobalModifier: (id: string) => void;
  reorderGlobalModifier: (id: string, direction: 'up' | 'down') => void;

  // V13: Part-level global modifier actions
  addPartGlobalModifier: (partId: string, type: GlobalModifierType) => GlobalModifier;
  removePartGlobalModifier: (partId: string, modifierId: string) => void;
  updatePartGlobalModifier: (partId: string, modifierId: string, updates: Partial<GlobalModifier>) => void;
  updatePartGlobalModifierParams: (partId: string, modifierId: string, params: Record<string, ModifierParamValue>) => void;
  togglePartGlobalModifier: (partId: string, modifierId: string) => void;
  reorderPartGlobalModifier: (partId: string, modifierId: string, direction: 'up' | 'down') => void;

  // V2.0: Skeletons state
  skeletons: Skeleton[];

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
  addCanvasModifierKeyframe: (trackId: string, frame: number, params?: Record<string, ModifierParamValue>) => void;
  removeCanvasModifierKeyframe: (trackId: string, keyframeId: string) => void;
  updateCanvasModifierKeyframe: (trackId: string, keyframeId: string, params: Record<string, ModifierParamValue>) => void;

  // V3.1: Part-level animation modifier actions
  addPartAnimationModifier: (partId: string, type: PartAnimationModifier['type']) => PartAnimationModifier;
  removePartAnimationModifier: (partId: string, modifierId: string) => void;
  updatePartAnimationModifier: (partId: string, modifierId: string, params: Record<string, ModifierParamValue>) => void;
  togglePartAnimationModifier: (partId: string, modifierId: string) => void;
  togglePartAnimationModifierCollapsed: (partId: string, modifierId: string) => void;
  updatePartAnimationModifierRange: (partId: string, modifierId: string, range: { startFrame?: number; endFrame?: number; fadeInFrames?: number; fadeOutFrames?: number }) => void;
  reorderPartAnimationModifier: (partId: string, modifierId: string, newIndex: number) => void;

  // V3.2: Modifier group actions
  addModifierGroup: (partId: string, name: string) => ModifierGroup;
  removeModifierGroup: (partId: string, groupId: string) => void;
  updateModifierGroup: (partId: string, groupId: string, updates: Partial<ModifierGroup>) => void;
  toggleModifierGroup: (partId: string, groupId: string) => void;
  toggleModifierGroupCollapsed: (partId: string, groupId: string) => void;
  reorderModifierGroup: (partId: string, groupId: string, newIndex: number) => void;
  moveModifierToGroup: (partId: string, modifierId: string, groupId: string | null) => void;

  // V3.3: Reset wheel angular velocity
  resetWheelAngularVelocity: (partId: string, modifierId: string) => void;

  // V3.7: Parent-child constraints
  setPartParent: (partId: string, parentId: string | null) => void;
  getPartWorldTransform: (partId: string, frame: number) => { translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number };

  // PixelEdit modifier actions
  createPixelEditModifier: (keyframeId: string) => string;
  addPixelEditCommand: (keyframeId: string, modifierId: string, command: BrushCommand) => void;
  removePixelEditCommand: (keyframeId: string, modifierId: string, commandId: string) => void;
  updatePixelEditCommand: (keyframeId: string, modifierId: string, commandId: string, updates: Partial<BrushCommand>) => void;

  // M7+: StrokeParamDriver time-domain ParamDriver actions (on persisted BrushCommands)
  addStrokeDriverParamDriver: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, paramName: string, startFrame?: number, endFrame?: number) => void;
  removeStrokeDriverParamDriver: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, driverId: string) => void;
  updateStrokeDriverParamDriver: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, driverId: string, updates: Partial<ParamDriver>) => void;
  toggleStrokeDriverParamDriver: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, driverId: string) => void;
  addStrokeDriverParamKeyframe: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, frame: number, params: Record<string, ModifierParamValue>) => void;
  removeStrokeDriverParamKeyframe: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, paramKfId: string) => void;
  /** Bake a ParamDriver on a StrokeParamDriver into consecutive paramKeyframes */
  bakeStrokeDriverParamDriver: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, driverId: string) => void;
  /** Unbake: re-enable the driver and clear the baked paramKeyframes on a StrokeParamDriver */
  unbakeStrokeDriverParamDriver: (keyframeId: string, modifierId: string, commandId: string, strokeDriverId: string, driverId: string) => void;

  // V4.1: Part keyframe actions (part-level timeline)
  addPartKeyframe: (partId: string, frame: number) => string;
  removePartKeyframe: (partId: string, partKeyframeId: string) => void;
  updatePartKeyframe: (partId: string, partKeyframeId: string, updates: { frame?: number; editModifiers?: ModifierInstance[] }) => void;
  getPartKeyframeAtFrame: (partId: string, frame: number) => PartKeyframe | undefined;
  getSurroundingPartKeyframes: (partId: string, frame: number) => { prev: PartKeyframe | null; next: PartKeyframe | null };
  /** Resolve the effective edit modifiers for a part at a given frame (step interpolation) */
  resolvePartEditModifiers: (partId: string, frame: number) => ModifierInstance[];
  /** Ensure a part keyframe exists at the current frame (create if needed), return its ID */
  ensurePartKeyframe: (partId: string, frame: number) => string;

  // Motion analysis split (PRD 3.1.1)
  motionAnalysisSplit: (frames: PixelGrid[], options?: { blockSize?: number; searchRadius?: number; motionThreshold?: number; minRegionSize?: number }) => string[];

  // M8: Animation variable actions
  addAnimationVariable: (name: string, scope: 'global' | 'part', partId?: string) => AnimationVariable;
  removeAnimationVariable: (variableId: string) => void;
  updateAnimationVariable: (variableId: string, updates: Partial<AnimationVariable>) => void;
  renameAnimationVariable: (variableId: string, name: string) => void;
  setVariableWriter: (variableId: string, writerDriverId: string) => boolean;

  // M8: ParamSource actions
  setParamDriverSource: (keyframeId: string, modifierId: string, driverId: string, param: ParamDriverNumericParam, source: ParamSource) => void;
  clearParamDriverSource: (keyframeId: string, modifierId: string, driverId: string, param: ParamDriverNumericParam) => void;
  updateParamDriverKeyframes: (keyframeId: string, modifierId: string, driverId: string, param: ParamDriverNumericParam, keyframes: ParamDriverKeyframe[]) => void;
  updateSecondaryDriver: (keyframeId: string, modifierId: string, driverId: string, param: ParamDriverNumericParam, updates: Partial<SecondaryParamDriver>) => void;

  // Reset
  resetProject: () => void;

  // ---- V3.0: AnimationClip CRUD ----
  addAnimationClip: (name: string) => AnimationClip;
  removeAnimationClip: (clipId: string) => void;
  updateAnimationClip: (clipId: string, updates: Partial<AnimationClip>) => void;
  setActiveAnimationClip: (clipId: string | null) => void;
  /** Get the currently active animation clip (null if none selected) */
  getActiveAnimationClip: () => AnimationClip | null;
  /** Get ClipPartData for a specific part in the active clip */
  getClipPartData: (partId: string) => ClipPartData | null;
  /** Ensure a ClipPartData entry exists for a part in the active clip */
  ensureClipPartData: (partId: string) => ClipPartData;
  /** Migrate legacy project data (tracks, keyframes, etc.) from Project level into AnimationClip */
  migrateLegacyToClip: (clipId: string) => void;
  /** Sync legacy fields from active clip (for backward compatibility) */
  syncLegacyFromActiveClip: () => void;

  // ---- V3.0: Character CRUD ----
  addCharacter: (name: string, partIds?: string[]) => Character;
  removeCharacter: (characterId: string) => void;
  updateCharacter: (characterId: string, updates: Partial<Character>) => void;
  addPartToCharacter: (characterId: string, partId: string) => void;
  removePartFromCharacter: (characterId: string, partId: string) => void;
  addCostume: (characterId: string, name: string, slotMapping?: Record<string, string>) => Costume;
  removeCostume: (characterId: string, costumeId: string) => void;
  setActiveCostume: (characterId: string, costumeId: string) => void;
  /** Create an animation clip from a character (adds all character parts with tracks) */
  createClipFromCharacter: (characterId: string, clipName: string) => AnimationClip;
}

// Re-export StateCreator for convenience
export type { StateCreator };
