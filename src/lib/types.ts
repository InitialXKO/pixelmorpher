// ============================================================
// PixelMorpher - Core Type Definitions (V2.0)
// ============================================================

/** Pixel color: hex string or null (transparent) */
export type PixelColor = string | null;

/** 2D pixel grid: pixels[y][x] */
export type PixelGrid = PixelColor[][];

// ---- V3.4: Wheel Trajectory Mode ----

/** Wheel modifier trajectory mode — determines the orbital path shape and body orientation */
export type WheelTrajectoryMode =
  | 'circular'         // 圆形/椭圆轨道 — body stays upright
  | 'caterpillar'      // 履带轨迹 — stadium shape (flat bottom, semicircle top)
  | 'rounded_rect'     // 圆角矩形轨迹 — rounded rectangle path
  | 'tidal_lock'       // 潮汐锁定 — circular orbit + body always faces center
  | 'independent_spin' // 独立自转 — spin in place, no orbital translation
  | 'gear';            // 齿轮对位 — gear-mesh synchronized rotation

// ---- V11: Gait Animation Modifier ----

/** Gait modifier phase — stance (foot on ground) vs swing (foot in air) */
export type GaitPhase = 'stance' | 'swing';

// ---- V3.0: Animation Modifier Blend Modes ----

/** How an animation modifier combines with the underlying keyframe transform */
export type AnimationBlendMode =
  | 'add'        // Additive: animation offset is added to keyframe transform (default)
  | 'multiply'   // Multiplicative: animation scale/rotation multiplies keyframe transform
  | 'converge';  // Converge blend: animation gradually converges toward keyframe transform

// ---- Modifier Types ----

export type ModifierType =
  | 'translate'
  | 'rotate'
  | 'uniform_scale'
  | 'non_uniform_stretch'
  | 'skew'
  | 'color_replace'
  | 'outline'
  | 'dither'
  | 'simple_physics'
  | 'motion_blur'
  | 'glow'
  | 'particle'
  | 'afterimage'
  | 'pixel_displace'
  // Mirror / Flip modifiers (pixel-level)
  | 'mirror'
  | 'flip'
  // V2.0 Procedural modifiers
  | 'noise'
  | 'wave'
  | 'spring'
  | 'jitter'
  // V2.1 Animation modifiers (parameterized presets)
  | 'pendulum'
  | 'wheel'
  | 'bounce'
  | 'breath'
  | 'wobble'
  | 'float'
  | 'shake'
  | 'elastic'
  // V2.2 Projection rotation modifiers (pixel-level)
  | 'cylinder_rotate'
  | 'sphere_rotate'
  // M5: Expression-based animation modifier
  | 'expression'
  // Pixel-level deformation animation modifiers
  | 'texture_scroll'
  | 'wave_deform'
  // PixelEdit: editable brush command modifier
  | 'pixel_edit'
  // V9: Pixel-level animation modifiers
  | 'contour_scroll'    // Scroll texture along part contour outline
  | 'reveal_hide'       // Reveal/hide animation (wipe, dissolve-in, etc.)
  | 'shatter_dissolve'  // Shatter into fragments and dissolve
  | 'annihilate'        // Annihilation effect (energy implosion)
  | 'teleport'          // Teleport effect (glitch in/out)
  | 'crt_off'           // CRT screen power-off effect
  // V10: Geometric deformation modifiers (pixel-level)
  | 'bend'                  // Bend along an axis
  | 'elliptical_compress'   // Elliptical compression
  | 'dumbbell_stretch'      // Dumbbell/barbell stretch (thin center, thick ends)
  | 'pillow_stretch'        // Pillow/bulge stretch
  | 'hyperbolic_stretch'    // Hyperbolic curve stretch
  | 'ring_ripple'          // Ring ripple stretch
  | 'gait';                  // V11: Gait animation (semicircle+chord trajectory)

/** Brush command shape for PixelEdit modifier */
export type BrushCommandType = 'draw' | 'erase' | 'fill';

export interface BrushCommand {
  id: string;
  type: BrushCommandType;
  color: string;       // hex color (for draw/fill)
  size: number;        // brush size in pixels
  /** Path points for draw/erase strokes */
  points: { x: number; y: number }[];
  /** Blend mode for this brush command */
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay';
  /** V5: Brush style type for this command (default: 'solid') */
  brushStyle?: BrushStyleType;
  /** V5: Brush style parameters for this command */
  brushStyleParams?: Partial<BrushStyleParams>;
  /** V7: Composited style aspects — if present, overrides brushStyle for rendering.
   *  Each aspect independently contributes a specific visual effect. */
  styleAspects?: StyleAspect[];
  /** V7: Stroke-direction parameter drivers — animate parameters along the stroke path */
  strokeDrivers?: StrokeParamDriver[];
}

/** Value types allowed in modifier params — includes primitives and structured data */
export type ModifierParamValue = number | string | boolean | BrushCommand[] | StyleAspect[] | number[];

export interface ModifierParam {
  name: string;
  label: string;
  type: 'number' | 'color' | 'select' | 'boolean' | 'string';
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string | number }[];
}

export interface ModifierDefinition {
  type: ModifierType;
  label: string;
  icon: string;
  category: 'transform' | 'color' | 'physics' | 'effect' | 'animation';
  params: ModifierParam[];
}

// ---- M6: Modifier Parameter Keyframe ----

/** A per-modifier parameter keyframe: captures only the params that differ from the modifier's base params at a specific frame. */
export interface ModifierParamKeyframe {
  id: string;
  frame: number;
  params: Record<string, ModifierParamValue>; // only the params that differ from the parent modifier
}

// ---- M7: ParamDriver (Function-Driven Parameter Automation) ----

/** Waveform types for ParamDriver */
export type ParamDriverWaveform =
  | 'sine'              // Sinusoidal oscillation
  | 'triangle'          // Triangle wave
  | 'square'            // Square wave
  | 'sawtooth'          // Sawtooth wave
  | 'linear_ramp'       // Linear ramp from startValue to endValue
  | 'exponential_decay' // Exponential decay from startValue toward endValue
  | 'spring_oscillate'  // Spring-damped oscillation
  | 'perlin_noise';     // Perlin noise-driven smooth random variation

/** Numeric parameter names of a ParamDriver that can have alternative sources */
export type ParamDriverNumericParam = 'amplitude' | 'baseValue' | 'endValue' | 'period' | 'phase' | 'damping';

/** Source type 1: constant value (default — reads the field directly from ParamDriver) */
/** Source type 2: keyframe curve driving a single ParamDriver parameter over time */
export interface ParamDriverKeyframe {
  frame: number;
  value: number;
  interpolation?: 'linear' | 'step' | 'bezier';
  bezierCP1?: { x: number; y: number };
  bezierCP2?: { x: number; y: number };
}

/** Source type 3: secondary ParamDriver (depth=1, constants only, no nesting) */
export interface SecondaryParamDriver {
  id: string;
  waveform: ParamDriverWaveform;
  amplitude: number;     // constant — cannot reference sources
  baseValue: number;
  endValue: number;
  period: number;
  phase: number;
  damping: number;
  startFrame: number;
  endFrame: number;
  /** Modulation mode: 'multiply' = AM (default), 'add' = offset */
  modMode?: 'multiply' | 'add';
}

/** Source type 4: external variable reference */
export interface VariableParamSource {
  type: 'variable';
  variableId: string;
}

/** Union of all parameter source types.
 *  undefined / { type: 'constant' } = read the field directly (source 1).
 *  Each ParamDriver numeric param can independently choose its source. */
export type ParamSource =
  | { type: 'constant' }
  | { type: 'keyframes'; keyframes: ParamDriverKeyframe[] }
  | { type: 'secondary_driver'; driver: SecondaryParamDriver }
  | VariableParamSource;

/** Animation variable: a named float that can be written by one ParamDriver
 *  and read by any number of other ParamDrivers' paramSources.
 *  Each variable has exactly one writer (single-writer constraint).
 *  DAG validation prevents circular dependencies between variables.
 *
 *  Variable modes:
 *  - 'value': direct assignment — var[f] = evaluateParamDriverWithSources(writer, f)
 *    The writer's output is the variable's value at each frame.
 *  - 'accumulator': frame-to-frame accumulation — var[f] = var[f-1] + evaluateParamDriverWithSources(writer, f)
 *    The writer's output is the *increment* added each frame.
 *    Enables counter/odometer use cases: total rotation, cycle count, distance traveled, etc.
 *    Requires sequential evaluation (var[f] depends on var[f-1]). */
export interface AnimationVariable {
  id: string;
  name: string;
  /** 'global' = visible to all parts; 'part' = visible only within one part */
  scope: 'global' | 'part';
  /** For part-scope variables: which part this variable belongs to */
  partId?: string;
  /** The single ParamDriver that writes to this variable each frame.
   *  Its evaluateParamDriver output becomes the variable's value. */
  writerDriverId: string;
  /** Default value when the writer is inactive (before startFrame / disabled / baked).
   *  For accumulator mode, this is the starting value. */
  defaultValue: number;
  /** Evaluation mode: 'value' = direct assignment, 'accumulator' = frame-to-frame accumulation.
   *  undefined defaults to 'value' for backward compatibility. */
  mode?: 'value' | 'accumulator';
}

/** Labels for ParamDriver numeric params (used in UI) */
export const PARAM_DRIVER_PARAM_LABELS: Record<ParamDriverNumericParam, string> = {
  amplitude: '振幅',
  baseValue: '中心值',
  endValue: '终止值',
  period: '频率',
  phase: '相位',
  damping: '阻尼',
};

/** A ParamDriver automatically drives a single numeric parameter of a keyframe-level
 *  modifier using a waveform function. It computes values in real-time during rendering
 *  and can be "baked" into consecutive ModifierParamKeyframes for manual editing.
 *
 *  Each numeric parameter (amplitude, baseValue, period, etc.) can independently
 *  derive its value from one of four sources via `paramSources`:
 *  1. constant — the field value directly (default, backward-compatible)
 *  2. keyframes — a per-parameter keyframe curve
 *  3. secondary_driver — a depth-1 Sub-Driver (AM/FM modulation)
 *  4. variable — an external AnimationVariable reference */
export interface ParamDriver {
  id: string;
  /** Which parameter of the parent modifier this driver controls */
  paramName: string;
  /** Waveform function type */
  waveform: ParamDriverWaveform;
  /** Amplitude of the oscillation (ignored for linear_ramp).
   *  Always stores the constant default — actual value comes from paramSources if set. */
  amplitude: number;
  /** Center value the wave oscillates around (for oscillating waves);
   *  start value for linear_ramp / exponential_decay.
   *  Always stores the constant default. */
  baseValue: number;
  /** End value for linear_ramp / exponential_decay (ignored for oscillating waves).
   *  Always stores the constant default. */
  endValue: number;
  /** Period in frames (for oscillating waves).
   *  Always stores the constant default. */
  period: number;
  /** Phase offset in degrees (0-360).
   *  Always stores the constant default. */
  phase: number;
  /** Damping factor (0 = no damping, 1 = heavy damping).
   *  Always stores the constant default. */
  damping: number;
  /** Frame at which this driver starts being active */
  startFrame: number;
  /** Frame at which this driver stops being active (-1 = until project end) */
  endFrame: number;
  /** Whether this driver is currently active */
  enabled: boolean;
  /** Whether this driver has been baked into paramKeyframes (baked drivers are disabled) */
  isBaked: boolean;
  /** Per-parameter source overrides. undefined = all params use constant (source 1).
   *  When a param has a non-constant source, its value is resolved at evaluation time
   *  instead of reading the field directly. The field always retains its constant value
   *  as a fallback and for UI display when the source is switched back. */
  paramSources?: Partial<Record<ParamDriverNumericParam, ParamSource>>;
}

export type ModifierCoordinateMode = 'parent_local' | 'world';

export interface ModifierInstance {
  id: string;
  type: ModifierType;
  enabled: boolean;
  collapsed: boolean;
  params: Record<string, ModifierParamValue>;
  // V3.0: Effective range for animation modifiers
  /** Frame at which this modifier starts being active (-1 = always active from frame 0) */
  startFrame: number;
  /** Frame at which this modifier stops being active (-1 = always active until end) */
  endFrame: number;
  /** Number of frames for fade-in from start (0 = instant) */
  fadeInFrames: number;
  /** Number of frames for fade-out before end (0 = instant) */
  fadeOutFrames: number;
  // V3.0: Blend mode for how this modifier combines with the keyframe transform
  /** How this animation modifier combines with the underlying keyframe transform */
  blendMode: AnimationBlendMode;
  // V3.7: Coordinate mode for parent-child constraints
  /** Whether this modifier operates in parent-local or world coordinates */
  coordinateMode: ModifierCoordinateMode;
  // M6: Per-modifier parameter keyframes
  /** Optional per-modifier parameter keyframes that animate modifier params across frames */
  paramKeyframes?: ModifierParamKeyframe[];
  // M7: ParamDrivers — function-driven parameter automation
  /** Optional ParamDrivers that auto-drive this modifier's numeric params via waveform functions */
  paramDrivers?: ParamDriver[];
}

// ---- V3.0: Animation Modifier Runtime State ----
// This is NOT persisted — it's computed per-frame during rendering.
// Used for incremental phase integration to maintain phase continuity
// when parameters change over time.

export interface AnimationModifierState {
  /** Current phase angle (radians) */
  phase: number;
  /** Current angular velocity (rad/frame) */
  angularVelocity: number;
  /** Last frame this state was updated at */
  lastFrame: number;
  /** Whether the modifier was active at lastFrame */
  wasActive: boolean;
  /** V3.4: Current wheel trajectory segment (for UI indicator) */
  wheelSegment?: 'bottom' | 'right' | 'top' | 'left' | 'spin';
  /** V3.3: Wheel angular dynamics state (for acceleration state machine) */
  wheelAngle?: number;       // Current accumulated angle (degrees)
  wheelOmega?: number;       // Current angular velocity (degrees/second)
  wheelAccelActive?: boolean; // Whether acceleration mode is active
  /** V11: Gait phase state */
  gaitPhase?: GaitPhase;
  /** V11: Frame when current gait phase started */
  gaitPhaseStartFrame?: number;
}

/** Set of animation modifier types that use effective range and phase state */
export const ANIMATION_MODIFIER_TYPES: ModifierType[] = [
  'pendulum', 'wheel', 'bounce', 'breath', 'wobble', 'float', 'shake', 'elastic', 'expression',
  // V11: Gait animation modifier
  'gait',
  'texture_scroll', 'wave_deform',
  // V9: New pixel-level animation modifiers
  'contour_scroll', 'reveal_hide', 'shatter_dissolve', 'annihilate', 'teleport', 'crt_off',
  // V10: Geometric deformation modifiers
  'bend', 'elliptical_compress', 'dumbbell_stretch', 'pillow_stretch', 'hyperbolic_stretch', 'ring_ripple',
  // V2.0 procedural modifiers also produce geometric transforms per-frame
  'noise', 'wave', 'spring', 'jitter',
];

/** The specific animation modifier type union (for PartAnimationModifier.type) */
export type AnimationModifierType = typeof ANIMATION_MODIFIER_TYPES[number];

// ---- V3.1: Part-Level Animation Modifier ----
// Animation modifiers live on the Part, not on individual keyframes.
// They have an effective range and are evaluated independently of keyframe
// static transforms. Component-level blending (translate=add, rotate=add,
// scale=multiply) is applied automatically.

export interface PartAnimationModifier {
  id: string;
  type: AnimationModifierType;
  enabled: boolean;
  collapsed: boolean;
  params: Record<string, ModifierParamValue>;
  /** Frame at which this modifier starts being active (-1 = always active from frame 0) */
  startFrame: number;
  /** Frame at which this modifier stops being active (-1 = always active until end) */
  endFrame: number;
  /** Number of frames for fade-in from start (0 = instant) */
  fadeInFrames: number;
  /** Number of frames for fade-out before end (0 = instant) */
  fadeOutFrames: number;
  /** V3.2: Blend mode for how this modifier combines with the keyframe transform */
  blendMode: AnimationBlendMode;
  /** V3.2: Group this modifier belongs to (null = ungrouped) */
  groupId: string | null;
  /** M7: Optional per-modifier parameter keyframes that animate modifier params across frames */
  paramKeyframes?: ModifierParamKeyframe[];
  /** M7: Optional ParamDrivers that auto-drive this modifier's numeric params via waveform functions */
  paramDrivers?: ParamDriver[];
}

// ---- V3.2: Modifier Groups ----

/** A group of animation modifiers that can be enabled/disabled together */
export interface ModifierGroup {
  id: string;
  name: string;
  enabled: boolean;
  collapsed: boolean;
  color: string; // Display color (hex) for visual grouping
  /** Order index within the group list (lower = rendered first) */
  order: number;
}

/** Default colors for modifier groups (cycled when creating new groups) */
export const MODIFIER_GROUP_COLORS = [
  '#06b6d4', // cyan
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#ec4899', // pink
  '#3b82f6', // blue
  '#f97316', // orange
];

// ---- Canvas Modifier Types (V2.4) ----

export type CanvasModifierType =
  | 'outline_emphasis'
  | 'color_lut'
  | 'pixel_zoom'
  | 'bloom'
  | 'scanlines'
  | 'canvas_mask';

export interface CanvasModifierParam {
  name: string;
  label: string;
  type: 'number' | 'color' | 'select' | 'boolean';
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string | number }[];
}

export interface CanvasModifierDefinition {
  type: CanvasModifierType;
  label: string;
  icon: string;
  params: CanvasModifierParam[];
}

export interface CanvasModifierInstance {
  id: string;
  type: CanvasModifierType;
  enabled: boolean;
  collapsed: boolean;
  params: Record<string, ModifierParamValue>;
}

export interface CanvasModifierKeyframe {
  id: string;
  frame: number;
  params: Record<string, ModifierParamValue>;
}

export interface CanvasModifierTrack {
  id: string;
  type: CanvasModifierType;
  name: string;
  visible: boolean;
  enabled: boolean;
  modifiers: CanvasModifierInstance[];
  keyframes: CanvasModifierKeyframe[];
}

// ---- Part (Asset) ----
// A Part is a reusable pixel art asset — the fundamental visual unit.
// It holds intrinsic asset data (pixels, pivot, edit modifiers, always-on transforms).
// Animation-specific data can also live on AnimationClip.clipPartData[] for
// per-clip animation behavior — this allows a single Part to be used in multiple
// animations with different animation behaviors.

export interface Part {
  id: string;
  name: string;
  width: number;
  height: number;
  pixels: PixelGrid;
  pivotX: number;
  pivotY: number;
  /** Default position offset. Can be overridden per-animation-clip via ClipPartData. */
  offsetX: number;
  offsetY: number;
  /** Default z-index. Can be overridden per-animation-clip via ClipPartData. */
  zIndex: number;
  /** Default visibility. Can be overridden per-animation-clip via Track. */
  visible: boolean;
  locked: boolean;
  thumbnail?: string; // base64 data URL
  /** V3.7: Parent part ID (null = no parent, root level) */
  parentId: string | null;
  /** Persistent part-level edit modifiers. Applied before keyframe modifiers in the render pipeline.
   *  These are intrinsic to the asset — they define the part's base visual state.
   *  Can be manually baked into part.pixels. */
  editModifiers: ModifierInstance[];
  /** V13: Part-level global modifiers — persistent transform/animation modifiers
   *  that always apply to this part across all frames and all animations.
   *  These are intrinsic to the asset (e.g., permanent rotation offset, persistent scale factor).
   *  For animation-specific always-on transforms, use ClipPartData.animationModifiers instead. */
  globalModifiers: GlobalModifier[];
  // V3.1: Part-level animation modifiers.
  // When activeAnimationClipId is set and ClipPartData exists, ClipPartData takes precedence.
  animationModifiers: PartAnimationModifier[];
  /** V3.2: Modifier groups for organizing animation modifiers */
  modifierGroups: ModifierGroup[];
  /** V4.1: Part-level keyframes for per-frame modifier stack state.
   *  When activeAnimationClipId is set and ClipPartData exists, ClipPartData takes precedence.
   *  When present, these override editModifiers at their respective frames (step interpolation). */
  partKeyframes: PartKeyframe[];
}

// ---- Part Keyframe ----

/** A keyframe on the part's internal timeline, defining the modifier stack state at a specific frame.
 *  Uses step interpolation: the modifier stack from the most recent part keyframe (at or before
 *  the current frame) is used. If no part keyframe exists at the current frame, falls back to
 *  part.editModifiers as the base state. */
export interface PartKeyframe {
  id: string;
  /** Frame index in the animation timeline */
  frame: number;
  /** Full modifier stack at this frame (pixel-level + translate modifiers) */
  editModifiers: ModifierInstance[];
}

// ---- Keyframe ----

export type InterpolationMode = 'linear' | 'bezier' | 'step';

export interface Keyframe {
  id: string;
  partId: string;
  frame: number;
  modifiers: ModifierInstance[];
  /** Manual pixel data for this keyframe (set by "promote to manual frame" or collapse).
   *  When present, replaces part.pixels as the rendering base for this keyframe.
   *  Other keyframes are unaffected. Can be further edited with brush/fill tools. */
  correctionMask: PixelGrid | null;
  /** Dimension overrides when correctionMask has different size than part.
   *  Used when geometric/effect modifiers are baked into the keyframe. */
  overrideWidth?: number;
  overrideHeight?: number;
  overridePivotX?: number;
  overridePivotY?: number;
  /** Whether this keyframe has been baked (modifiers removed, pixels applied) */
  isBaked: boolean;
  /** Pre-collapse pixel data saved when modifiers are collapsed, so we can restore on uncollapse */
  collapsedPixels?: PixelGrid | null;
  /** Pre-collapse dimension data saved for uncollapse of geometric/effect modifiers */
  collapsedWidth?: number;
  collapsedHeight?: number;
  collapsedPivotX?: number;
  collapsedPivotY?: number;
  /** Interpolation mode for the segment FROM this keyframe TO the next (default: 'linear') */
  interpolationMode?: InterpolationMode;
  /** Bezier control point 1 for easing curve (default: {x: 0.25, y: 0.1} = CSS ease) */
  bezierCP1?: { x: number; y: number };
  /** Bezier control point 2 for easing curve (default: {x: 0.25, y: 1} = CSS ease) */
  bezierCP2?: { x: number; y: number };
}

// ---- Track ----
// A Track represents a Part's participation in an AnimationClip.
// It controls visibility, lock state, z-ordering, and expansion in the timeline.

export interface Track {
  id: string;
  partId: string;
  visible: boolean;
  locked: boolean;
  expanded: boolean;
  /** Z-order override for this part within this animation clip.
   *  If undefined, falls back to Part.zIndex. */
  zIndex?: number;
}

// ---- Effect ----

export type EffectType = 'glow' | 'particle' | 'afterimage' | 'pixel_displace' | 'motion_blur';

export interface EffectKeyframe {
  id: string;
  frame: number;
  params: Record<string, ModifierParamValue>;
}

export interface EffectTrack {
  id: string;
  type: EffectType;
  name: string;
  visible: boolean;
  keyframes: EffectKeyframe[];
}

// ---- Trajectory ----

export interface TrajectoryPoint {
  frame: number;
  x: number;
  y: number;
  rotation: number;
}

export interface TrajectoryCurvePoint extends TrajectoryPoint {
  cp1x: number; // control point 1 x
  cp1y: number; // control point 1 y
  cp2x: number; // control point 2 x
  cp2y: number; // control point 2 y
}

export interface Trajectory {
  partId: string;
  points: TrajectoryCurvePoint[];
  visible: boolean;
}

export interface AfterimageConfig {
  count: number;        // number of afterimage copies
  opacityDecay: number; // opacity decay factor (0-1)
  spacing: number;      // spacing between afterimages in pixels
}

// ---- V12: Global Modifiers ----
// Global modifiers apply to ALL parts simultaneously at the transform level.
// They are evaluated after per-part animation modifiers but before per-part rendering.
// This allows effects like "global shake", "camera rotation", "world scale" etc.

/** Global modifier types — subset that makes sense at the global level */
export type GlobalModifierType =
  | 'translate'       // 全局平移 (camera pan)
  | 'rotate'          // 全局旋转 (camera rotation)
  | 'uniform_scale'   // 全局缩放 (zoom)
  | 'shake'           // 全局震动
  | 'bounce'          // 全局弹跳
  | 'breath'          // 全局呼吸缩放
  | 'float'           // 全局悬浮
  | 'wobble'          // 全局摇晃
  | 'noise'           // 全局噪声偏移
  | 'wave'            // 全局波浪
  | 'spring'          // 全局弹簧
  | 'jitter'          // 全局抖动
  | 'pendulum'        // 全局钟摆
  | 'expression';     // 全局表达式

export interface GlobalModifier {
  id: string;
  type: GlobalModifierType;
  name: string;
  enabled: boolean;
  collapsed: boolean;
  params: Record<string, ModifierParamValue>;
  /** Frame at which this modifier starts being active (-1 = always active from frame 0) */
  startFrame: number;
  /** Frame at which this modifier stops being active (-1 = always active until end) */
  endFrame: number;
  /** Number of frames for fade-in from start (0 = instant) */
  fadeInFrames: number;
  /** Number of frames for fade-out before end (0 = instant) */
  fadeOutFrames: number;
  /** How this modifier combines with per-part transforms */
  blendMode: AnimationBlendMode;
  /** Optional per-modifier parameter keyframes */
  paramKeyframes?: ModifierParamKeyframe[];
  /** Optional ParamDrivers for auto-driven params */
  paramDrivers?: ParamDriver[];
}

/** Definitions for global modifier types */
export const GLOBAL_MODIFIER_DEFINITIONS: { type: GlobalModifierType; label: string; icon: string; category: string; params: ModifierParam[] }[] = [
  {
    type: 'translate',
    label: '全局平移',
    icon: 'Move',
    category: 'transform',
    params: [
      { name: 'offsetX', label: 'X偏移', type: 'number', default: 0, min: -500, max: 500, step: 1 },
      { name: 'offsetY', label: 'Y偏移', type: 'number', default: 0, min: -500, max: 500, step: 1 },
    ],
  },
  {
    type: 'rotate',
    label: '全局旋转',
    icon: 'RotateCw',
    category: 'transform',
    params: [
      { name: 'angle', label: '角度', type: 'number', default: 0, min: -360, max: 360, step: 1 },
      { name: 'centerX', label: '中心X', type: 'number', default: 0, min: -500, max: 500, step: 1 },
      { name: 'centerY', label: '中心Y', type: 'number', default: 0, min: -500, max: 500, step: 1 },
    ],
  },
  {
    type: 'uniform_scale',
    label: '全局缩放',
    icon: 'Maximize2',
    category: 'transform',
    params: [
      { name: 'scale', label: '缩放', type: 'number', default: 1, min: 0.1, max: 10, step: 0.01 },
    ],
  },
  {
    type: 'shake',
    label: '全局震动',
    icon: 'Zap',
    category: 'animation',
    params: [
      { name: 'amplitude', label: '振幅', type: 'number', default: 5, min: 0, max: 50, step: 0.5 },
      { name: 'frequency', label: '频率', type: 'number', default: 12, min: 1, max: 60, step: 1 },
      { name: 'decay', label: '衰减', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    type: 'bounce',
    label: '全局弹跳',
    icon: 'ArrowUpFromLine',
    category: 'animation',
    params: [
      { name: 'amplitude', label: '振幅', type: 'number', default: 10, min: 0, max: 100, step: 1 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 16, min: 2, max: 120, step: 1 },
      { name: 'phase', label: '相位', type: 'number', default: 0, min: 0, max: 360, step: 1 },
    ],
  },
  {
    type: 'breath',
    label: '全局呼吸',
    icon: 'Heart',
    category: 'animation',
    params: [
      { name: 'amplitude', label: '振幅', type: 'number', default: 0.1, min: 0, max: 1, step: 0.01 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 30, min: 2, max: 120, step: 1 },
      { name: 'phase', label: '相位', type: 'number', default: 0, min: 0, max: 360, step: 1 },
      { name: 'pivotOffsetX', label: '枢轴偏移X', type: 'number', default: 0, min: -500, max: 500, step: 1 },
      { name: 'pivotOffsetY', label: '枢轴偏移Y', type: 'number', default: 0, min: -500, max: 500, step: 1 },
    ],
  },
  {
    type: 'float',
    label: '全局悬浮',
    icon: 'Cloud',
    category: 'animation',
    params: [
      { name: 'amplitude', label: '振幅', type: 'number', default: 5, min: 0, max: 50, step: 0.5 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 30, min: 2, max: 120, step: 1 },
      { name: 'phase', label: '相位', type: 'number', default: 0, min: 0, max: 360, step: 1 },
      { name: 'pivotOffsetX', label: '枢轴偏移X', type: 'number', default: 0, min: -500, max: 500, step: 1 },
      { name: 'pivotOffsetY', label: '枢轴偏移Y', type: 'number', default: 0, min: -500, max: 500, step: 1 },
    ],
  },
  {
    type: 'wobble',
    label: '全局摇晃',
    icon: 'Rotate3d',
    category: 'animation',
    params: [
      { name: 'amplitude', label: '振幅', type: 'number', default: 5, min: 0, max: 45, step: 0.5 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 20, min: 2, max: 120, step: 1 },
      { name: 'phase', label: '相位', type: 'number', default: 0, min: 0, max: 360, step: 1 },
      { name: 'pivotOffsetX', label: '枢轴偏移X', type: 'number', default: 0, min: -500, max: 500, step: 1 },
      { name: 'pivotOffsetY', label: '枢轴偏移Y', type: 'number', default: 0, min: -500, max: 500, step: 1 },
    ],
  },
  {
    type: 'pendulum',
    label: '全局钟摆',
    icon: 'Timer',
    category: 'animation',
    params: [
      { name: 'amplitude', label: '振幅', type: 'number', default: 10, min: 0, max: 90, step: 1 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 24, min: 2, max: 120, step: 1 },
      { name: 'phase', label: '相位', type: 'number', default: 0, min: 0, max: 360, step: 1 },
      { name: 'damping', label: '阻尼', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
      { name: 'pivotOffsetX', label: '枢轴偏移X', type: 'number', default: 0, min: -500, max: 500, step: 1 },
      { name: 'pivotOffsetY', label: '枢轴偏移Y', type: 'number', default: 0, min: -500, max: 500, step: 1 },
    ],
  },
  {
    type: 'noise',
    label: '全局噪声',
    icon: 'Radio',
    category: 'animation',
    params: [
      { name: 'amplitudeX', label: 'X振幅', type: 'number', default: 5, min: 0, max: 100, step: 0.5 },
      { name: 'amplitudeY', label: 'Y振幅', type: 'number', default: 5, min: 0, max: 100, step: 0.5 },
      { name: 'speed', label: '速度', type: 'number', default: 0.1, min: 0.01, max: 2, step: 0.01 },
      { name: 'seed', label: '种子', type: 'number', default: 0, min: 0, max: 999, step: 1 },
    ],
  },
  {
    type: 'wave',
    label: '全局波浪',
    icon: 'Activity',
    category: 'animation',
    params: [
      { name: 'amplitudeX', label: 'X振幅', type: 'number', default: 5, min: 0, max: 100, step: 0.5 },
      { name: 'amplitudeY', label: 'Y振幅', type: 'number', default: 5, min: 0, max: 100, step: 0.5 },
      { name: 'frequency', label: '频率', type: 'number', default: 0.5, min: 0.01, max: 5, step: 0.01 },
      { name: 'phase', label: '相位', type: 'number', default: 0, min: 0, max: 360, step: 1 },
    ],
  },
  {
    type: 'spring',
    label: '全局弹簧',
    icon: 'Zap',
    category: 'animation',
    params: [
      { name: 'amplitude', label: '振幅', type: 'number', default: 10, min: 0, max: 100, step: 1 },
      { name: 'stiffness', label: '刚度', type: 'number', default: 0.3, min: 0.01, max: 1, step: 0.01 },
      { name: 'damping', label: '阻尼', type: 'number', default: 0.1, min: 0, max: 1, step: 0.01 },
      { name: 'triggerFrame', label: '触发帧', type: 'number', default: 0, min: 0, max: 999, step: 1 },
    ],
  },
  {
    type: 'jitter',
    label: '全局抖动',
    icon: 'Shuffle',
    category: 'animation',
    params: [
      { name: 'amplitudeX', label: 'X振幅', type: 'number', default: 2, min: 0, max: 50, step: 0.5 },
      { name: 'amplitudeY', label: 'Y振幅', type: 'number', default: 2, min: 0, max: 50, step: 0.5 },
      { name: 'probability', label: '概率', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    type: 'expression',
    label: '全局表达式',
    icon: 'Code2',
    category: 'animation',
    params: [
      { name: 'translateXExpr', label: 'X偏移表达式', type: 'string', default: '0' },
      { name: 'translateYExpr', label: 'Y偏移表达式', type: 'string', default: '0' },
      { name: 'rotateExpr', label: '旋转表达式', type: 'string', default: '0' },
      { name: 'scaleExpr', label: '缩放表达式', type: 'string', default: '1' },
    ],
  },
];

// ---- Animation Clip ----
// An AnimationClip is an independent animation resource with its own timeline.
// It references shared Parts and contains all animation-specific data.
// This is the core of the "asset-based project" model:
//   - Parts are shared visual assets (reused across clips)
//   - AnimationClips are independent animation resources (each with its own timeline)
//   - A single Part can appear in multiple clips with different animation behaviors

export interface ClipPartData {
  /** The part this data belongs to */
  partId: string;
  /** Animation modifiers for this part within this clip.
   *  Moved from Part.animationModifiers — allows different clips to animate
   *  the same part differently (e.g., walk vs run vs idle). */
  animationModifiers: PartAnimationModifier[];
  /** Modifier groups for organizing animation modifiers within this clip. */
  modifierGroups: ModifierGroup[];
  /** Part-level keyframes for per-frame modifier stack state within this clip.
   *  Moved from Part.partKeyframes — allows different clips to have different
   *  part-edit states at different frames. */
  partKeyframes: PartKeyframe[];
}

export interface AnimationClip {
  id: string;
  name: string;
  description?: string;
  /** Frame rate for this clip (frames per second) */
  frameRate: number;
  /** Total number of frames in this clip */
  totalFrames: number;

  // ---- Per-clip timeline data ----
  /** One track per participating part — controls visibility, lock, z-order */
  tracks: Track[];
  /** Keyframe data — flat array, linked by partId */
  keyframes: Keyframe[];
  /** Per-part animation data within this clip */
  clipPartData: ClipPartData[];

  // ---- Per-clip effects ----
  effectTracks: EffectTrack[];
  canvasModifierTracks: CanvasModifierTrack[];
  trajectories: Trajectory[];
  motionBlurStrokes: MotionBlurStroke[];
  effectStrokes: EffectStroke[];

  // ---- Metadata ----
  thumbnail?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;

  // ---- Concrete Puppet ----
  /** Whether this is a puppet animation clip */
  isPuppetClip?: boolean;
  /** Linked puppet character ID */
  puppetCharacterId?: string;
  /** Per-node keyframes for puppet animation */
  puppetNodeKeyframes?: PuppetNodeKeyframe[];

  // ---- DCC Pipeline ----
  /** Animation events for game logic */
  events?: AnimationEvent[];
  /** Frame tags for animation state machines */
  frameTags?: FrameTag[];
  /** Hitbox shapes per keyframe (keyframeId → shapes) */
  hitboxMap?: Record<string, HitboxShape[]>;
}

// ============================================================
// Concrete Puppet System Types
// ============================================================

/** 8-direction system for puppet characters */
export type PuppetDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/** All 8 puppet directions */
export const PUPPET_DIRECTIONS: PuppetDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Direction mirroring: left-side directions mirror from right-side */
export const DIRECTION_MIRROR: Record<PuppetDirection, PuppetDirection> = {
  'N': 'N', 'NE': 'NW', 'E': 'W', 'SE': 'SW',
  'S': 'S', 'SW': 'SE', 'W': 'E', 'NW': 'NE',
};

/** Socket: an attachment point on a PuppetNode where child nodes connect */
export interface PuppetSocket {
  id: string;
  name: string;
  localX: number;
  localY: number;
}

/** Plug: the connection point on a child node that attaches to a parent's socket */
export interface PuppetPlug {
  socketId: string;
  localX: number;
  localY: number;
}

/** PuppetNode: a single node in the puppet skeleton hierarchy */
export interface PuppetNode {
  id: string;
  name: string;
  /** Sockets where child nodes can attach */
  sockets: PuppetSocket[];
  /** Plug connecting this node to its parent's socket (null for root) */
  plug: PuppetPlug | null;
  /** Default sprite part ID for this node */
  spritePartId: string | null;
  /** Direction-specific sprite overrides: direction → partId */
  directionSprites: Partial<Record<PuppetDirection, string>>;
  /** Mirror-from direction: if set, missing direction sprites mirror from the opposite side */
  mirrorFrom: boolean;
  /** Current rotation angle (degrees) */
  angle: number;
  /** Current stretch factor along local Y axis */
  stretch: number;
  /** Current X offset from connection point */
  offsetX: number;
  /** Current Y offset from connection point */
  offsetY: number;
  /** Cross-section size at the top of this node (for joint disc rendering) */
  crossSectionTop: number;
  /** Cross-section size at the bottom of this node (for joint disc rendering) */
  crossSectionBottom: number;
  /** Z-index for draw ordering */
  zIndex: number;
  /** Whether this node is visible */
  visible: boolean;
  /** Color for joint disc rendering */
  color: string;
}

/** Keyframe data for a single puppet node at a specific frame */
export interface PuppetNodeKeyframe {
  id: string;
  nodeId: string;
  frame: number;
  angle?: number;
  stretch?: number;
  offsetX?: number;
  offsetY?: number;
  direction?: PuppetDirection;
  viewLatitude?: number;
}

/** Joint disc render data (computed, not stored) */
export interface JointDiscRenderData {
  x: number;
  y: number;
  diameter: number;
  z: number;
  color: string;
  parentNodeId: string;
  childNodeId: string;
}

/** PuppetSkeleton: the hierarchical bone structure of a puppet character */
export interface PuppetSkeleton {
  id: string;
  name: string;
  nodes: PuppetNode[];
  /** Current viewing direction */
  currentDirection: PuppetDirection;
  /** Viewing latitude in degrees (0=front, 90=top) */
  viewLatitude: number;
}

/** CostumeSet: a named set of sprite overrides for all nodes and directions */
export interface CostumeSet {
  id: string;
  name: string;
  /** Maps "nodeId:direction" to partId for sprite overrides */
  spriteMap: Record<string, string>;
}

/** PuppetCharacter: a complete puppet character with skeleton and costumes */
export interface PuppetCharacter {
  id: string;
  name: string;
  description?: string;
  /** The skeleton this character uses */
  puppetSkeletonId: string;
  /** Available costume sets */
  costumeSets: CostumeSet[];
  /** Currently active costume set */
  activeCostumeSetId: string | null;
  createdAt: number;
  updatedAt: number;
}

// ============================================================
// DCC Pipeline Types
// Animation Events, Frame Tags, Hitbox Shapes, Palettes
// ============================================================

/** Hitbox shape type */
export type HitboxShapeType = 'rect' | 'circle' | 'capsule' | 'polygon';

/** Hitbox shape for collision editing */
export interface HitboxShape {
  id: string;
  name: string;
  shapeType: HitboxShapeType;
  data: Record<string, unknown>;
  active: boolean;
  color: string;
  metadata?: Record<string, unknown>;
}

/** Animation event for game logic integration */
export interface AnimationEvent {
  id: string;
  frame: number;
  name: string;
  stringValue?: string;
  numberValue?: number;
  objectValue?: Record<string, unknown>;
  active: boolean;
  color: string;
}

/** Frame tag for animation state machines */
export interface FrameTag {
  id: string;
  name: string;
  startFrame: number;
  endFrame: number;
  color: string;
  loop: 'loop' | 'once' | 'ping_pong';
  direction: 'forward' | 'reverse' | 'ping_pong';
}

/** Palette color slot */
export interface PaletteColor {
  color: string | null;
  label: string;
}

/** Color palette for indexed-color workflows */
export interface Palette {
  id: string;
  name: string;
  colors: PaletteColor[];
  /** Indices that can be swapped at runtime for team color systems */
  swappableIndices: number[];
  isDefault?: boolean;
  tags?: string[];
}

// ---- Character ----
// A Character is a named collection of Parts, typically representing a game character.
// Characters can have optional bone structures and costume variants.
// Characters serve as a grouping mechanism — when creating an animation,
// you can add an entire character's parts at once.

export interface Costume {
  id: string;
  name: string;
  /** Maps slot names to part IDs.
   *  Example: { "head": "part-head-v2", "body": "part-body-armor" }
   *  Different costumes swap parts for the same logical slots. */
  slotMapping: Record<string, string>;
}

export interface Character {
  id: string;
  name: string;
  description?: string;
  /** Ordered list of part IDs that make up this character */
  partIds: string[];
  /** Optional skeleton for bone-based animation */
  skeletonId?: string;
  /** Costume variants — different visual appearances for the same character */
  costumes: Costume[];
  activeCostumeId?: string;
  thumbnail?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

// ---- Project (Asset Library) ----
// A Project is a collection of reusable art assets — NOT a single animation container.
// The project holds the shared asset library (Parts, Characters) and
// independent animation resources (AnimationClips).
// Product positioning: 资产管理与动画制作软件
//   - 以项目为单位集中管理所有美术资源
//   - 支持跨项目复用
//   - 可独立导出角色、部件、动画片段或完整 Spritesheet

export interface Project {
  id: string;
  name: string;
  description?: string;

  // ---- Asset Library ----
  /** Shared pixel art parts — the fundamental visual unit */
  parts: Part[];
  /** Character groupings — named collections of parts */
  characters: Character[];
  /** Animation clips — independent animation resources */
  animationClips: AnimationClip[];
  /** The currently active animation clip being edited (null = no clip active) */
  activeAnimationClipId: string | null;

  // ---- Project-level settings ----
  canvasWidth: number;
  canvasHeight: number;
  frameRate: number;  // Default frame rate for new clips
  totalFrames: number; // Default total frames for new clips
  currentFrame: number;
  backgroundColor: string;

  // ---- Project-level effects ----
  /** M8: Animation variables for cross-driver parameter linking */
  animationVariables?: AnimationVariable[];
  /** V12: Global modifiers — apply transform effects to all parts simultaneously */
  globalModifiers?: GlobalModifier[];

  // ---- Editor state ----
  onionSkinEnabled: boolean;
  onionSkinFrames: number;

  // ---- LEGACY FIELDS (kept for backward compatibility during migration) ----
  // These are now stored in AnimationClip, but kept here so existing code
  // continues to work during the transition. When activeAnimationClipId is set,
  // the active clip's data takes precedence.
  /** @deprecated Use activeAnimationClip.tracks instead */
  tracks: Track[];
  /** @deprecated Use activeAnimationClip.keyframes instead */
  keyframes: Keyframe[];
  /** @deprecated Use activeAnimationClip.effectTracks instead */
  effectTracks: EffectTrack[];
  /** @deprecated Use activeAnimationClip.canvasModifierTracks instead */
  canvasModifierTracks: CanvasModifierTrack[];
  /** @deprecated Use activeAnimationClip.trajectories instead */
  trajectories: Trajectory[];
  /** @deprecated Use activeAnimationClip.motionBlurStrokes instead */
  motionBlurStrokes: MotionBlurStroke[];
  /** @deprecated Use activeAnimationClip.effectStrokes instead */
  effectStrokes: EffectStroke[];

  // ---- Concrete Puppet (first-class project data) ----
  puppetSkeletons: PuppetSkeleton[];
  puppetCharacters: PuppetCharacter[];
  selectedPuppetNodeId: string | null;

  // ---- DCC Pipeline: Palettes (first-class project data) ----
  palettes: Palette[];
  activePaletteId: string | null;
}

// ---- Editor State ----

export type MotionBlurBrushType = 'linear' | 'radial' | 'directional';

export interface MotionBlurStroke {
  id: string;
  frame: number;
  partId: string;
  points: { x: number; y: number }[];
  brushType: MotionBlurBrushType;
  intensity: number;
  direction: number; // angle in degrees for directional
  blendMode?: 'normal' | 'lighter' | 'overlay' | 'screen';
}

export type EffectBrushType = 'glow_brush' | 'particle_brush' | 'afterimage_brush';

export type CoordinateMode = 'follow_part' | 'world_fixed';

export interface EffectStroke {
  id: string;
  frame: number;
  partId: string;
  type: EffectBrushType;
  points: { x: number; y: number }[];
  color: string;
  radius: number;
  intensity: number;
  density?: number; // for particle brush
  spread?: number; // for particle/afterimage brush
  blendMode?: 'normal' | 'lighter' | 'overlay' | 'screen';
  coordinateMode?: CoordinateMode; // default: 'follow_part'
}

export type ToolType = 'select' | 'brush' | 'eraser' | 'fill' | 'eyedropper' | 'move' | 'trajectory' | 'crop' | 'motion_blur_brush' | 'glow_brush' | 'particle_brush' | 'afterimage_brush' | 'bone' | 'ik' | 'weight_paint' | 'lasso' | 'magic_wand' | 'smart_select' | 'inpaint' | 'hitbox_drag' | 'puppet';
export type PlayState = 'stopped' | 'playing' | 'paused';
export type EditMode = 'normal' | 'correction' | 'trajectory_edit' | 'bone_edit' | 'weight_paint' | 'part_edit';

// ---- Brush Style System ----

/** Advanced brush style types that generate pixel patterns with multiple parameters.
 *  Stamp-based styles (solid–scatter) render each point independently.
 *  Stroke-aware styles (tapered–vine) need the full stroke path for correct rendering. */
export type BrushStyleType =
  | 'solid'            // Default solid pixel fill
  | 'glow_orb'         // Radial glow orb with inner/outer color
  | 'dual_flame'       // Dual-color inner/outer flame with flicker
  | 'spray'            // Scattered particle spray
  | 'neon'             // Neon glow outline
  | 'gradient'         // Linear/radial gradient fill
  | 'scatter'          // Random scatter with shape stamps
  | 'tapered'          // Stroke that tapers at both ends (头尾渐细笔触)
  | 'pipe'             // Tube/pipe with configurable highlight (带高光管道)
  | 'segmented_pipe'   // Segmented pipe / bellows (分节管道/波纹管)
  | 'vine'             // Vine / blood vessel with directional lighting (血管/藤蔓)
  | 'star'             // Star shape with inner/outer colors, hollow or solid (五角星)
  | 'heart'            // Heart shape with inner/outer colors (爱心)
  | 'sphere'           // Sphere with configurable highlight position (带高光球体)
  | 'droplet'          // Water droplet shape with highlight (水滴)
  | 'bubble'           // Soap bubble with rainbow highlight (泡泡)
  | 'bevel_seam'       // Beveled seam/groove with directional lighting (倒角线/缝)
  | 'prism'            // 3D prism/frustum with directional lighting (棱柱/台)
  | 'plate'            // Thick plate/panel with edge bevel (带厚度感的板材/面板)
  | 'grille'           // Repeating slats/louvers (格栅)
  | 'vent'             // Vent/jet with rim/edge trim (带包边的散热口/喷口)
  | 'punctuation'      // Cartoon punctuation marks (卡通标点)
  | 'emoji';           // Pixel emoji faces (表情包)

// ---- V7: Composable Style Aspects ----

/** Independent visual aspects that can be freely combined.
 *  Each aspect contributes a specific visual effect and has its own parameters.
 *  Aspects compose naturally: width aspects multiply, color aspects layer. */
export type StyleAspectType =
  | 'taper'              // Width profile: taper at stroke ends (渐细)
  | 'segment'            // Width profile: repeating segments with gaps (分节)
  | 'pipe_shade'         // Cross-section: cylindrical highlight (管道高光)
  | 'directional_light'  // Cross-section: directional lighting (方向光照)
  | 'organic_edge'       // Edge: organic/noisy wavy edges (有机边缘)
  | 'vein'               // Detail: center vein line (脉络)
  | 'branch'             // Detail: sub-branches (分支)
  | 'inner_outer'        // Cross-section: inner/outer color gradient (内外色)
  | 'glow_halo'          // Detail: glow halo around stroke (光晕)
  | 'spray_scatter';     // Shape: scattered particle dots (喷溅散布)

/** A single composable style aspect with its own parameters */
export interface StyleAspect {
  id: string;
  type: StyleAspectType;
  enabled: boolean;
  /** Parameters for this aspect (subset of BrushStyleParams fields relevant to this aspect) */
  params: Record<string, ModifierParamValue>;
}

/** Which BrushStyleParams keys each aspect type uses */
export const ASPECT_TYPE_PARAMS: Record<StyleAspectType, string[]> = {
  taper:            ['taperLength', 'taperCurve', 'minSizeRatio'],
  segment:          ['segmentLength', 'segmentGap', 'segmentTaper', 'bellowsWidth'],
  pipe_shade:       ['highlightPosition', 'highlightSize', 'highlightIntensity', 'wallShade'],
  directional_light:['lightDirection', 'lightIntensity'],
  organic_edge:     ['organicNoise'],
  vein:             ['veinColor'],
  branch:           ['branchDensity', 'seed'],
  inner_outer:      ['innerColor', 'outerColor', 'innerRadius', 'falloff'],
  glow_halo:        ['glowRadius', 'glowIntensity'],
  spray_scatter:    ['density', 'spread', 'seed'],
};

/** Human-readable labels for style aspect types */
export const ASPECT_TYPE_LABELS: Record<StyleAspectType, string> = {
  taper:             '渐细',
  segment:           '分节',
  pipe_shade:        '管道高光',
  directional_light: '方向光照',
  organic_edge:      '有机边缘',
  vein:              '脉络',
  branch:            '分支',
  inner_outer:       '内外色',
  glow_halo:         '光晕',
  spray_scatter:     '喷溅散布',
};

// ---- V7: Stroke-Direction Parameter Drivers ----

/** Drives a parameter along the stroke path.
 *  The driver evaluates a waveform at each normalized position t (0–1) along the stroke,
 *  producing a multiplier that modifies the base parameter value. */
export interface StrokeParamDriver {
  id: string;
  /** Which parameter to animate along the stroke */
  targetParam: 'size' | 'opacity' | 'hardness' | 'wallShade' | 'lightIntensity' | 'bellowsWidth' | 'organicNoise' | 'glowIntensity';
  /** Waveform shape */
  waveform: 'bump' | 'sine' | 'sawtooth' | 'square' | 'pulse';
  /** Amplitude of variation (0-1, relative to base value) */
  amplitude: number;
  /** Center position within each cycle (0-1) where the main effect peaks.
   *  When frequency=1, this is equivalent to position along the stroke.
   *  When frequency>1, each cycle repeats the bump centered at this position. */
  center: number;
  /** Width of the effect region (0-1, fraction of stroke length).
   *  For localized waveforms (bump, pulse), this is the total fraction of the stroke
   *  covered by the effect region. When frequency>1, this width is distributed among
   *  all cycles equally. */
  width: number;
  /** Number of repetitions (1 = single, >1 = repeating along stroke) */
  frequency: number;
  /** Phase offset (0-1) */
  phase: number;
  /** Direction: 'forward' = from start to end, 'reverse' = from end to start */
  direction: 'forward' | 'reverse';
  enabled: boolean;
  /** M7+: Time-domain parameter keyframes — allows animating this driver's own
   *  parameters (center, amplitude, width, frequency, phase) across frames.
   *  Each keyframe overrides the base values above at a specific frame. */
  paramKeyframes?: ModifierParamKeyframe[];
  /** M7+: Time-domain parameter drivers — automatically drive this driver's own
   *  numeric parameters using waveform functions over time.
   *  For example, a linear_ramp on 'center' from 0→1 over frames 0–15 makes
   *  a bump travel along the stroke. */
  paramDrivers?: ParamDriver[];
}

/** Human-readable labels for stroke driver targets */
export const STROKE_DRIVER_TARGET_LABELS: Record<StrokeParamDriver['targetParam'], string> = {
  size: '笔刷大小',
  opacity: '不透明度',
  hardness: '硬度',
  wallShade: '壁面阴影',
  lightIntensity: '光照强度',
  bellowsWidth: '波纹扩展',
  organicNoise: '有机噪点',
  glowIntensity: '光晕强度',
};

/** Human-readable labels for stroke driver waveforms */
export const STROKE_DRIVER_WAVEFORM_LABELS: Record<StrokeParamDriver['waveform'], string> = {
  bump: '鼓包',
  sine: '正弦',
  sawtooth: '锯齿',
  square: '方波',
  pulse: '脉冲',
};

/** Styles that require the full stroke path for correct rendering */
export const STROKE_AWARE_STYLES: BrushStyleType[] = ['tapered', 'pipe', 'segmented_pipe', 'vine', 'bevel_seam', 'prism', 'plate', 'grille', 'vent'];

/** Parameters for advanced brush styles.
 *  Not all params apply to every style — irrelevant params are ignored. */
export interface BrushStyleParams {
  /** Overall opacity (0-1) */
  opacity: number;
  /** Edge hardness (0 = soft falloff, 1 = crisp edge) */
  hardness: number;

  // ---- Glow Orb & Dual Flame ----
  /** Inner zone color (hot core) */
  innerColor: string;
  /** Outer zone color (cool edge) */
  outerColor: string;
  /** Ratio of inner zone to total radius (0-1) */
  innerRadius: number;
  /** How quickly color transitions from inner to outer (0 = sharp, 1 = smooth) */
  falloff: number;

  // ---- Dual Flame ----
  /** Flicker intensity (0 = static, 1 = maximum random perturbation) */
  flickerAmount: number;
  /** Direction the flame extends toward (degrees, 0 = right, 90 = down) */
  flameDirection: number;
  /** Elongation factor (1 = circular, >1 = stretched in flameDirection) */
  elongation: number;

  // ---- Spray / Scatter ----
  /** Density of spray particles (0-1) */
  density: number;
  /** Spread radius multiplier (1 = brush size, >1 = wider) */
  spread: number;

  // ---- Neon ----
  /** Glow extension beyond the stroke (pixels) */
  glowRadius: number;
  /** Glow brightness (0-1) */
  glowIntensity: number;

  // ---- Gradient ----
  /** Gradient direction or type */
  gradientType: 'linear' | 'radial';
  /** Secondary color for gradient endpoint */
  secondaryColor: string;

  // ---- Random seed for reproducible patterns ----
  /** Seed for deterministic random effects (spray, flicker, scatter, vine) */
  seed: number;

  // ---- Tapered (头尾渐细笔触) ----
  /** Fraction of stroke length that tapers at each end (0 = no taper, 0.5 = half the stroke) */
  taperLength: number;
  /** Taper curve shape */
  taperCurve: 'linear' | 'ease_in' | 'ease_out' | 'smooth';
  /** Minimum size ratio at the tapered tip relative to full brush size (0 = point, 1 = no taper) */
  minSizeRatio: number;

  // ---- Pipe (管道/带高光管道) ----
  /** Which side the highlight stripe appears on (relative to stroke direction) */
  highlightPosition: 'top' | 'bottom' | 'left' | 'right';
  /** Proportion of pipe width occupied by the highlight band (0-1) */
  highlightSize: number;
  /** Brightness of the highlight (0-1, added as white overlay) */
  highlightIntensity: number;
  /** How dark the shadow side gets (0 = no shading, 1 = full dark) */
  wallShade: number;

  // ---- Segmented Pipe (分节管道/波纹管) ----
  /** Length of each segment in pixels */
  segmentLength: number;
  /** Gap between segments in pixels (0 = flush segments) */
  segmentGap: number;
  /** How much each segment tapers at the ends (0 = no taper, 1 = sharp points) */
  segmentTaper: number;
  /** Expansion at segment joints relative to base width (0 = no expansion, 1 = double width) */
  bellowsWidth: number;

  // ---- Vine (藤蔓/血管) ----
  /** Light source direction in degrees (0 = right, 90 = down, 180 = left, 270 = up) */
  lightDirection: number;
  /** How strongly light affects shading (0 = flat, 1 = dramatic) */
  lightIntensity: number;
  /** Center vein color (darker line running through the middle) */
  veinColor: string;
  /** How wobbly/organic the edges are (0 = smooth, 1 = very wavy) */
  organicNoise: number;
  /** Sub-branch frequency along the main vine (0 = none, 1 = dense) */
  branchDensity: number;

  // ---- Star (五角星) ----
  /** Number of star points (3-12, default 5) */
  spikeCount: number;
  /** Whether the star is hollow (only outline ring) */
  hollow: boolean;
  /** Ratio of inner radius to outer radius for star (0.1-0.9) */
  innerOuterRatio: number;
  /** Rotation angle of the star in degrees */
  rotation: number;

  // ---- Heart (爱心) ----
  /** Heart top lobe width ratio (0.5-1.5) */
  lobeWidth: number;
  /** How pointed the bottom of the heart is (0 = round, 1 = very pointed) */
  pointiness: number;

  // ---- Sphere (带高光球体) ----
  /** Highlight X position offset (-1 to 1, 0 = center) */
  highlightX: number;
  /** Highlight Y position offset (-1 to 1, -1 = top) */
  highlightY: number;
  /** Highlight radius ratio (0.1-0.8) */
  highlightRadius: number;
  /** Highlight brightness (0-1) */
  highlightBrightness: number;
  /** Ambient shading intensity (0 = flat, 1 = dramatic sphere shading) */
  shadingIntensity: number;

  // ---- Droplet (水滴) ----
  /** How elongated the droplet tail is (0 = round, 1 = long tail) */
  tailLength: number;
  /** Tail direction in degrees (0 = right, 270 = up) */
  tailDirection: number;

  // ---- Bubble (泡泡) ----
  /** Rainbow iridescence intensity (0 = clear, 1 = full rainbow) */
  iridescence: number;
  /** Membrane thickness ratio (0.02-0.3) */
  membraneThickness: number;
  /** Reflection spot size (0.1-0.5) */
  reflectionSize: number;

  // ---- Punctuation (卡通标点) ----
  /** Which punctuation mark to render */
  punctuationType: 'exclamation' | 'question' | 'ellipsis' | 'comma' | 'period' | 'interrobang';
  /** Outline thickness (1-3 pixels) */
  outlineThickness: number;
  /** Outline color */
  outlineColor: string;

  // ---- Emoji (表情包) ----
  /** Which emoji face to render */
  emojiType: 'happy' | 'sad' | 'angry' | 'surprised' | 'wink' | 'cool' | 'love' | 'dizzy';
  /** Eye size ratio (0.1-0.5) */
  eyeSize: number;
  /** Mouth curve (-1 = frown, 0 = neutral, 1 = smile) */
  mouthCurve: number;

  // ---- Bevel Seam (倒角线/缝) ----
  /** Depth of the bevel groove (0 = flat, 1 = deep groove) */
  bevelDepth: number;
  /** Width of the bevel highlight edge (0-1 ratio of stroke width) */
  bevelWidth: number;
  /** Light direction for the bevel (degrees, 0 = right, 90 = down) */
  bevelLightDir: number;
  /** Inner shadow intensity (0 = no shadow, 1 = deep shadow in groove) */
  bevelShadow: number;
  /** Color of the groove interior */
  grooveColor: string;

  // ---- Prism (棱柱/台) ----
  /** Top face width ratio relative to stroke width (0.3-1.0, 1 = rectangular, <1 = trapezoid) */
  topWidthRatio: number;
  /** Height/thickness of the prism body (0.2-1.0 ratio of stroke width) */
  prismHeight: number;
  /** Light direction for the prism (degrees, 0 = right, 90 = down) */
  prismLightDir: number;
  /** How strongly the top face is lit (0 = same as side, 1 = bright top) */
  topFaceBrightness: number;
  /** Edge highlight intensity (0 = no edge highlight, 1 = bright edge line) */
  edgeHighlight: number;

  // ---- Plate (板材/面板) ----
  /** Thickness of the plate (0.1-1.0 ratio of stroke width) */
  plateThickness: number;
  /** Bevel/chamfer size on the plate edge (0-0.5 ratio of thickness) */
  plateBevel: number;
  /** Light direction for the plate (degrees, 0 = right, 90 = down) */
  plateLightDir: number;
  /** Surface texture: how much noise on the plate surface (0 = smooth, 1 = rough) */
  surfaceTexture: number;
  /** Edge highlight intensity */
  plateEdgeBright: number;

  // ---- Grille (格栅) ----
  /** Number of slat openings per segment */
  slatCount: number;
  /** Gap between slats (0-1 ratio of segment) */
  slatGap: number;
  /** Depth/shadow of the slat openings (0 = shallow, 1 = deep) */
  slatDepth: number;
  /** Frame border width (0-0.5 ratio of stroke width) */
  frameWidth: number;
  /** Color of the opening/shadow area */
  openingColor: string;

  // ---- Vent (散热口/喷口) ----
  /** Inner opening width ratio (0.2-0.9 of stroke width) */
  ventOpening: number;
  /** Rim/edge trim thickness (0.05-0.3 ratio of stroke width) */
  rimThickness: number;
  /** Rim color (usually lighter than body) */
  rimColor: string;
  /** Inner depth shading (0 = flat, 1 = deep tunnel effect) */
  innerDepth: number;
  /** Whether the vent has internal horizontal slats */
  hasSlats: boolean;
  /** Number of internal slats (2-8) */
  ventSlatCount: number;
}

/** Default brush style parameters */
export const DEFAULT_BRUSH_STYLE: BrushStyleParams = {
  opacity: 1,
  hardness: 1,
  innerColor: '#ffffff',
  outerColor: '#ff4400',
  innerRadius: 0.3,
  falloff: 0.5,
  flickerAmount: 0.3,
  flameDirection: 270,
  elongation: 1.5,
  density: 0.5,
  spread: 1,
  glowRadius: 2,
  glowIntensity: 0.8,
  gradientType: 'radial',
  secondaryColor: '#000000',
  seed: 42,
  // Tapered
  taperLength: 0.15,
  taperCurve: 'smooth',
  minSizeRatio: 0.1,
  // Pipe
  highlightPosition: 'top',
  highlightSize: 0.3,
  highlightIntensity: 0.6,
  wallShade: 0.5,
  // Segmented Pipe
  segmentLength: 8,
  segmentGap: 2,
  segmentTaper: 0.2,
  bellowsWidth: 0.3,
  // Vine
  lightDirection: 315,
  lightIntensity: 0.6,
  veinColor: '#4a1a2e',
  organicNoise: 0.3,
  branchDensity: 0.2,
  // Star
  spikeCount: 5,
  hollow: false,
  innerOuterRatio: 0.4,
  rotation: 0,
  // Heart
  lobeWidth: 1.0,
  pointiness: 0.6,
  // Sphere
  highlightX: -0.25,
  highlightY: -0.3,
  highlightRadius: 0.3,
  highlightBrightness: 0.8,
  shadingIntensity: 0.7,
  // Droplet
  tailLength: 0.5,
  tailDirection: 270,
  // Bubble
  iridescence: 0.5,
  membraneThickness: 0.08,
  reflectionSize: 0.25,
  // Punctuation
  punctuationType: 'exclamation',
  outlineThickness: 1,
  outlineColor: '#000000',
  // Emoji
  emojiType: 'happy',
  eyeSize: 0.25,
  mouthCurve: 1,
  // Bevel Seam
  bevelDepth: 0.5,
  bevelWidth: 0.3,
  bevelLightDir: 315,
  bevelShadow: 0.7,
  grooveColor: '#333333',
  // Prism
  topWidthRatio: 0.7,
  prismHeight: 0.8,
  prismLightDir: 315,
  topFaceBrightness: 0.6,
  edgeHighlight: 0.5,
  // Plate
  plateThickness: 0.5,
  plateBevel: 0.2,
  plateLightDir: 315,
  surfaceTexture: 0.1,
  plateEdgeBright: 0.4,
  // Grille
  slatCount: 4,
  slatGap: 0.3,
  slatDepth: 0.7,
  frameWidth: 0.15,
  openingColor: '#111111',
  // Vent
  ventOpening: 0.6,
  rimThickness: 0.1,
  rimColor: '#cccccc',
  innerDepth: 0.8,
  hasSlats: true,
  ventSlatCount: 3,
};

export interface BrushPreset {
  id: string;
  name: string;
  type: 'pixel' | 'dash' | 'star' | 'custom';
  size: number;
  shape: boolean[][]; // pixel pattern for the brush tip
  /** V5: Brush style (defaults to 'solid' for backward compat) */
  style?: BrushStyleType;
  /** V5: Brush style parameters (used when style !== 'solid') */
  styleParams?: Partial<BrushStyleParams>;
}

export interface EditorState {
  tool: ToolType;
  brushSize: number;
  brushColor: string;
  zoom: number;
  panX: number;
  panY: number;
  playState: PlayState;
  editMode: EditMode;
  selectedPartId: string | null;
  selectedKeyframeId: string | null;
  selectedModifierId: string | null;
  selectedEffectTrackId: string | null;
  showGrid: boolean;
  showOnionSkin: boolean;
  showTrajectories: boolean;
  isDirty: boolean;
  // Motion blur
  autoMotionBlur: boolean;
  autoMotionBlurIntensity: number;
  motionBlurBrushType: MotionBlurBrushType;
  motionBlurIntensity: number;
  motionBlurDirection: number;
  // Effect brushes
  effectBrushColor: string;
  effectBrushRadius: number;
  effectBrushIntensity: number;
  effectBrushDensity: number;
  effectBrushSpread: number;
  // Effect coordinate mode
  effectCoordinateMode: CoordinateMode;
  // Selection tools
  magicWandTolerance: number;
  // Trajectory snap
  trajectorySnap: boolean;
  // Preview quality (Feature 2)
  previewQuality: 'low' | 'medium' | 'high';
  // SAM / Smart Selection
  samState: SAMState;
  inpaintRadius: number;
  // Part Edit Mode
  partEditPartId: string | null;
  partEditBackupPixels: PixelGrid | null;
  /** Backup of part.editModifiers from when entering part_edit mode (for cancel) */
  partEditBackupModifiers: ModifierInstance[];
  partEditModifiers: ModifierInstance[];
  /** V4.1: Backup of part.partKeyframes from when entering part_edit mode (for cancel) */
  partEditBackupPartKeyframes: PartKeyframe[];
  /** V4.1: The frame at which part_edit mode was entered (used to save as part keyframe) */
  partEditStartFrame?: number;
  // V5: Brush style
  /** Current brush style type (defaults to 'solid') */
  brushStyle: BrushStyleType;
  /** Current brush style parameters */
  brushStyleParams: BrushStyleParams;
  // V7: Composable style aspects
  /** Active style aspects for compositing (if non-empty, overrides brushStyle) */
  styleAspects: StyleAspect[];
  /** Whether compositing mode is active (vs single-style mode) */
  compositingMode: boolean;
  // V7: Stroke-direction parameter drivers
  /** Active stroke parameter drivers */
  strokeDrivers: StrokeParamDriver[];
  // Move tool target level
  /** Which modifier layer the move tool writes translate to.
   *  'keyframe' = Keyframe.modifiers (default, per-frame position)
   *  'part_global' = Part.globalModifiers (all-frame persistent offset) */
  moveTargetLevel: 'keyframe' | 'part_global';
  // ---- Concrete Puppet ----
  showPuppetSkeleton: boolean;
  activePuppetSkeletonId: string | null;
  puppetInteractionMode: 'move' | 'manipulate';
  // ---- Hitbox editor ----
  selectedHitboxId: string | null;
  // ---- Palette constraint drawing ----
  paletteConstrained: boolean;
  selectedPaletteSlot: number | null;
}

// ---- SAM / Smart Selection ----

export type SAMModelType = 'mobilesam' | 'sam2_tiny';
export type SAMStatus = 'idle' | 'loading' | 'encoding' | 'ready' | 'segmenting' | 'error';

export interface SAMState {
  status: SAMStatus;
  model: SAMModelType;
  progress: number; // 0-100
  errorMessage: string | null;
  currentMask: Float32Array | null; // Raw mask data from SAM
  maskShape: [number, number] | null; // [height, width]
  maskBounds: { x: number; y: number; width: number; height: number } | null;
}

// ---- History ----

export interface HistoryEntry {
  description: string;
  timestamp: number;
  snapshot: string; // JSON stringified project state
  coalesceKey?: string; // If set, consecutive entries with the same key within COALESCE_WINDOW_MS are merged (replace top-of-stack instead of pushing)
}

// ---- V2.0: Skeleton / Bone System ----

export type BoneConstraintType = 'ik_solver' | 'copy_rotation' | 'limit_rotation' | 'stretch_to';

export interface BoneIKConstraint {
  type: 'ik_solver';
  targetX: number;
  targetY: number;
  chainLength: number; // number of bones in IK chain
  iterations: number; // solver iterations
  poleAngle: number; // pole angle for IK
}

export interface BoneLimitConstraint {
  type: 'limit_rotation';
  minAngle: number;
  maxAngle: number;
}

export interface BoneCopyRotationConstraint {
  type: 'copy_rotation';
  targetBoneId: string;
  influence: number; // 0-1
}

export interface BoneStretchToConstraint {
  type: 'stretch_to';
  targetX: number;
  targetY: number;
  maxLength: number;
}

export type BoneConstraint = BoneIKConstraint | BoneLimitConstraint | BoneCopyRotationConstraint | BoneStretchToConstraint;

export interface Bone {
  id: string;
  name: string;
  parentId: string | null;
  /** Head (start) position relative to canvas */
  headX: number;
  headY: number;
  /** Tail (end) position relative to canvas */
  tailX: number;
  tailY: number;
  /** Rest rotation angle in degrees */
  restRotation: number;
  /** Current pose rotation (animated) */
  poseRotation: number;
  /** Bone length */
  length: number;
  /** Connected parts with weights */
  boundParts: { partId: string; weight: number }[];
  /** Constraints on this bone */
  constraints: BoneConstraint[];
  visible: boolean;
  locked: boolean;
  color: string; // bone display color
}

export interface BonePose {
  boneId: string;
  frame: number;
  rotation: number;
  /** IK target position (if IK constraint active) */
  ikTargetX?: number;
  ikTargetY?: number;
}

export interface Skeleton {
  id: string;
  name: string;
  bones: Bone[];
  poses: BonePose[];
  visible: boolean;
}

// ---- V2.0: Procedural Animation System ----

export type ProceduralType = 'noise' | 'wave' | 'spring' | 'jitter';

export interface ProceduralNoise {
  type: 'noise';
  amplitude: number;
  frequency: number;
  octaves: number;
  seed: number;
  /** Which property to affect: translateX, translateY, rotation, scale */
  targetProperty: 'translateX' | 'translateY' | 'rotation' | 'scale';
}

export interface ProceduralWave {
  type: 'wave';
  amplitude: number;
  frequency: number;
  phase: number;
  waveType: 'sine' | 'triangle' | 'square' | 'sawtooth';
  targetProperty: 'translateX' | 'translateY' | 'rotation' | 'scale';
}

export interface ProceduralSpring {
  type: 'spring';
  stiffness: number;
  damping: number;
  mass: number;
  restLength: number;
  targetProperty: 'translateX' | 'translateY' | 'rotation' | 'scale';
}

export interface ProceduralJitter {
  type: 'jitter';
  amount: number;
  frequency: number;
  smooth: boolean;
  targetProperty: 'translateX' | 'translateY' | 'rotation' | 'scale';
}

export type ProceduralConfig = ProceduralNoise | ProceduralWave | ProceduralSpring | ProceduralJitter;

export interface ProceduralAnimation {
  id: string;
  name: string;
  partId: string;
  config: ProceduralConfig;
  enabled: boolean;
  startFrame: number;
  endFrame: number;
}

// ---- V2.0: Weight Map ----

export interface WeightMap {
  partId: string;
  /** weights[y][x] = boneId or null */
  weights: (string | null)[][];
}

// ---- V2.0: Project Save/Load ----

export interface ProjectFile {
  version: string;
  project: Project;
  skeletons: Skeleton[];
  proceduralAnimations: ProceduralAnimation[];
  weightMaps: WeightMap[];
  history: HistoryEntry[];
  /** V3.0: Characters data */
  characters?: Character[];
}

// ---- M7: ParamDriver Helpers ----

/** Human-readable labels for ParamDriver waveforms */
export const PARAM_DRIVER_WAVEFORM_LABELS: Record<ParamDriverWaveform, string> = {
  sine: '正弦波',
  triangle: '三角波',
  square: '方波',
  sawtooth: '锯齿波',
  linear_ramp: '线性渐变',
  exponential_decay: '指数衰减',
  spring_oscillate: '弹簧振荡',
  perlin_noise: '柏林噪声',
};

/** Create a default ParamDriver for a given parameter */
export function createDefaultParamDriver(
  paramName: string,
  baseValue: number,
  startFrame: number = 0,
  endFrame: number = -1,
): ParamDriver {
  return {
    id: crypto.randomUUID(),
    paramName,
    waveform: 'sine',
    amplitude: Math.abs(baseValue) > 0.01 ? Math.abs(baseValue) * 0.5 : 5,
    baseValue,
    endValue: baseValue,
    period: 16,
    phase: 0,
    damping: 0,
    startFrame,
    endFrame,
    enabled: true,
    isBaked: false,
  };
}

/** Evaluate a ParamDriver at a given frame. Returns the computed numeric value.
 *
 *  Phase continuity: when `accumulatedPhase` is provided, it is used as the
 *  pre-computed phase (in radians) for all periodic waveforms instead of the
 *  analytical formula `2π × t / period + phaseRad`. This enables seamless
 *  waveform transitions when frequency (period) changes dynamically.
 *
 *  When `accumulatedPhase` is undefined, the function falls back to the
 *  analytical formula using `driver.period` and `driver.phase` — this is
 *  backward compatible and equivalent for constant-period drivers.
 *
 *  Phase semantics for each waveform:
 *  - sine / spring_oscillate: sin(Φ)
 *  - triangle / square / sawtooth: normalizedPhase = (Φ / 2π) mod 1
 *  - perlin_noise: noiseX = Φ / 2π  (warp coordinate)
 *  - linear_ramp / exponential_decay: not affected by phase  */
export function evaluateParamDriver(driver: ParamDriver, frame: number, accumulatedPhase?: number): number {
  // If outside the driver's active range, return baseValue
  const startFrame = driver.startFrame;
  const endFrame = driver.endFrame >= 0 ? driver.endFrame : Infinity;
  if (frame < startFrame || frame > endFrame) {
    return driver.baseValue;
  }

  // Local time relative to driver start
  const t = frame - startFrame;
  const period = Math.max(1, driver.period);
  const totalDuration = endFrame - startFrame;

  // Compute phase: either use pre-computed accumulated phase or analytical formula
  // Φ = accumulated phase in radians; normalizedP = phase mapped to [0,1) cycle position
  let phi: number;
  let normalizedP: number;

  if (accumulatedPhase !== undefined) {
    phi = accumulatedPhase;
    normalizedP = ((phi / (2 * Math.PI)) % 1 + 1) % 1;
  } else {
    // Constant-period analytical formula (backward compatible)
    const phaseRad = (driver.phase * Math.PI) / 180;
    phi = (2 * Math.PI * t) / period + phaseRad;
    normalizedP = ((t / period + driver.phase / 360) % 1 + 1) % 1;
  }

  switch (driver.waveform) {
    case 'sine': {
      // y = baseValue + amplitude * sin(Φ) * ramp
      const rampUp = Math.min(t / Math.max(1, Math.min(3, totalDuration * 0.1)), 1);
      const rampDown = Math.min((totalDuration - t) / Math.max(1, Math.min(3, totalDuration * 0.1)), 1);
      const ramp = rampUp * rampDown;
      return driver.baseValue + driver.amplitude * Math.sin(phi) * ramp;
    }

    case 'triangle': {
      // Triangle wave: linear segments based on normalized phase
      const triVal = normalizedP < 0.25 ? 4 * normalizedP : normalizedP < 0.75 ? 2 - 4 * normalizedP : 4 * normalizedP - 4;
      return driver.baseValue + driver.amplitude * triVal;
    }

    case 'square': {
      // Square wave: +amplitude or -amplitude
      return driver.baseValue + driver.amplitude * (normalizedP < 0.5 ? 1 : -1);
    }

    case 'sawtooth': {
      // Sawtooth: linear ramp from -1 to +1 over each period
      return driver.baseValue + driver.amplitude * (2 * normalizedP - 1);
    }

    case 'linear_ramp': {
      // Linear ramp from baseValue to endValue over the driver's range
      if (totalDuration <= 0) return driver.baseValue;
      const progress = Math.min(1, Math.max(0, t / totalDuration));
      return driver.baseValue + (driver.endValue - driver.baseValue) * progress;
    }

    case 'exponential_decay': {
      // Exponential decay from baseValue toward endValue
      if (totalDuration <= 0) return driver.baseValue;
      const progress = Math.min(1, Math.max(0, t / totalDuration));
      const decay = Math.exp(-driver.damping * 5 * progress);
      return driver.endValue + (driver.baseValue - driver.endValue) * decay;
    }

    case 'spring_oscillate': {
      // Spring-damped oscillation: exponentially decaying sinusoid
      const progress = totalDuration > 0 ? t / totalDuration : 0;
      const dampFactor = Math.exp(-driver.damping * 5 * progress);
      const oscillation = Math.sin(phi);
      return driver.baseValue + driver.amplitude * dampFactor * oscillation;
    }

    case 'perlin_noise': {
      // Perlin noise: use accumulated phase / 2π as warp coordinate
      // This ensures smooth speed transitions when period changes dynamically
      const noiseX = phi / (2 * Math.PI);
      // Use a simple hash of the driver id for the y coordinate
      let noiseSeed = 0;
      for (let i = 0; i < driver.id.length; i++) {
        noiseSeed = ((noiseSeed << 5) - noiseSeed + driver.id.charCodeAt(i)) | 0;
      }
      const noiseY = (Math.abs(noiseSeed) % 1000) * 0.001;
      const rampUp = Math.min(t / Math.max(1, Math.min(3, totalDuration * 0.1)), 1);
      const rampDown = Math.min((totalDuration - t) / Math.max(1, Math.min(3, totalDuration * 0.1)), 1);
      const ramp = rampUp * rampDown;
      // Value noise with smoothstep
      const ix = Math.floor(noiseX);
      const fx = noiseX - ix;
      const iy = Math.floor(noiseY);
      const fy = noiseY - iy;
      const smoothFx = fx * fx * (3 - 2 * fx);
      const smoothFy = fy * fy * (3 - 2 * fy);
      function hash2d(x: number, y: number): number {
        let h = x * 374761393 + y * 668265263;
        h = (h ^ (h >> 13)) * 1274126177;
        h = h ^ (h >> 16);
        return ((h & 0x7fffffff) / 0x7fffffff) * 2 - 1; // [-1, 1]
      }
      const n00 = hash2d(ix, iy);
      const n10 = hash2d(ix + 1, iy);
      const n01 = hash2d(ix, iy + 1);
      const n11 = hash2d(ix + 1, iy + 1);
      const nx0 = n00 + smoothFx * (n10 - n00);
      const nx1 = n01 + smoothFx * (n11 - n01);
      const noiseVal = nx0 + smoothFy * (nx1 - nx0);
      return driver.baseValue + driver.amplitude * noiseVal * ramp;
    }

    default:
      return driver.baseValue;
  }
}

// ---- Modifier Definitions ----

export const MODIFIER_DEFINITIONS: ModifierDefinition[] = [
  {
    type: 'translate',
    label: '平移',
    icon: 'Move',
    category: 'transform',
    params: [
      { name: 'offsetX', label: 'X偏移', type: 'number', default: 0, min: -500, max: 500, step: 1 },
      { name: 'offsetY', label: 'Y偏移', type: 'number', default: 0, min: -500, max: 500, step: 1 },
    ],
  },
  {
    type: 'rotate',
    label: '旋转',
    icon: 'RotateCw',
    category: 'transform',
    params: [
      { name: 'angle', label: '角度(°)', type: 'number', default: 0, min: -360, max: 360, step: 1 },
      { name: 'pivotOffsetX', label: '枢轴偏移X', type: 'number', default: 0, min: -500, max: 500, step: 1 },
      { name: 'pivotOffsetY', label: '枢轴偏移Y', type: 'number', default: 0, min: -500, max: 500, step: 1 },
    ],
  },
  {
    type: 'uniform_scale',
    label: '均匀缩放',
    icon: 'Maximize2',
    category: 'transform',
    params: [
      { name: 'scale', label: '缩放比例', type: 'number', default: 1, min: 0.1, max: 10, step: 0.1 },
      { name: 'pivotOffsetX', label: '枢轴偏移X', type: 'number', default: 0, min: -500, max: 500, step: 1 },
      { name: 'pivotOffsetY', label: '枢轴偏移Y', type: 'number', default: 0, min: -500, max: 500, step: 1 },
    ],
  },
  {
    type: 'non_uniform_stretch',
    label: '非均匀拉伸',
    icon: 'StretchHorizontal',
    category: 'transform',
    params: [
      { name: 'scaleX', label: 'X缩放', type: 'number', default: 1, min: 0.1, max: 10, step: 0.1 },
      { name: 'scaleY', label: 'Y缩放', type: 'number', default: 1, min: 0.1, max: 10, step: 0.1 },
    ],
  },
  {
    type: 'skew',
    label: '倾斜',
    icon: 'Italic',
    category: 'transform',
    params: [
      { name: 'skewX', label: 'X角度(°)', type: 'number', default: 0, min: -89, max: 89, step: 1 },
      { name: 'skewY', label: 'Y角度(°)', type: 'number', default: 0, min: -89, max: 89, step: 1 },
    ],
  },
  {
    type: 'color_replace',
    label: '颜色替换',
    icon: 'Palette',
    category: 'color',
    params: [
      { name: 'sourceColor', label: '源色', type: 'color', default: '#000000' },
      { name: 'targetColor', label: '目标色', type: 'color', default: '#ffffff' },
      { name: 'tolerance', label: '容差', type: 'number', default: 0, min: 0, max: 255, step: 1 },
    ],
  },
  {
    type: 'outline',
    label: '轮廓强调',
    icon: 'BoxSelect',
    category: 'color',
    params: [
      { name: 'thickness', label: '厚度', type: 'number', default: 1, min: 1, max: 5, step: 1 },
      { name: 'color', label: '轮廓颜色', type: 'color', default: '#000000' },
      { name: 'directions', label: '方向数', type: 'select', default: '8', options: [
        { label: '4方向(高效)', value: '4' },
        { label: '8方向(圆润)', value: '8' },
      ]},
      { name: 'outlineMode', label: '轮廓模式', type: 'select', default: 'solid', options: [
        { label: '纯色轮廓', value: 'solid' },
        { label: '变暗轮廓', value: 'darken' },
        { label: '内容光照', value: 'gradient' },
      ]},
      { name: 'lightAngle', label: '光照角度(°)', type: 'number', default: 315, min: 0, max: 360, step: 1 },
      { name: 'blendMode', label: '混合模式', type: 'select', default: 'normal', options: [
        { label: '正常', value: 'normal' },
        { label: '叠加', value: 'overlay' },
        { label: '正片叠底', value: 'multiply' },
        { label: '滤色', value: 'screen' },
      ]},
      { name: 'edgesOnly', label: '仅边缘生效', type: 'boolean', default: true },
    ],
  },
  {
    type: 'dither',
    label: '抖动模式',
    icon: 'Grid3x3',
    category: 'color',
    params: [
      { name: 'pattern', label: '抖动模板', type: 'select', default: 'bayer4', options: [
        { label: 'Bayer 2x2', value: 'bayer2' },
        { label: 'Bayer 4x4', value: 'bayer4' },
        { label: 'Bayer 8x8', value: 'bayer8' },
      ]},
    ],
  },
  {
    type: 'simple_physics',
    label: '简单物理',
    icon: 'Atom',
    category: 'physics',
    params: [
      { name: 'gravity', label: '重力方向(°)', type: 'number', default: 90, min: 0, max: 360, step: 1 },
      { name: 'elasticity', label: '弹性系数', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
      { name: 'damping', label: '阻尼', type: 'number', default: 0.9, min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    type: 'motion_blur',
    label: '运动模糊',
    icon: 'Wind',
    category: 'effect',
    params: [
      { name: 'length', label: '模糊长度', type: 'number', default: 5, min: 1, max: 50, step: 1 },
      { name: 'decay', label: '衰减曲线', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
      { name: 'edgesOnly', label: '仅边缘', type: 'boolean', default: false },
    ],
  },
  {
    type: 'glow',
    label: '光晕',
    icon: 'Sun',
    category: 'effect',
    params: [
      { name: 'radius', label: '半径', type: 'number', default: 3, min: 1, max: 20, step: 1 },
      { name: 'color', label: '颜色', type: 'color', default: '#ffff00' },
      { name: 'intensity', label: '强度', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    type: 'particle',
    label: '粒子',
    icon: 'Sparkles',
    category: 'effect',
    params: [
      { name: 'rate', label: '发射速率', type: 'number', default: 10, min: 1, max: 100, step: 1 },
      { name: 'speed', label: '速度', type: 'number', default: 2, min: 0.5, max: 10, step: 0.5 },
      { name: 'life', label: '寿命(帧)', type: 'number', default: 10, min: 1, max: 60, step: 1 },
      { name: 'color', label: '颜色', type: 'color', default: '#ff8800' },
      { name: 'gravity', label: '重力', type: 'number', default: 0.5, min: 0, max: 5, step: 0.1 },
    ],
  },
  {
    type: 'afterimage',
    label: '残影',
    icon: 'Ghost',
    category: 'effect',
    params: [
      { name: 'count', label: '副本数', type: 'number', default: 3, min: 1, max: 10, step: 1 },
      { name: 'opacity', label: '透明度衰减', type: 'number', default: 0.3, min: 0.05, max: 1, step: 0.05 },
      { name: 'spacing', label: '间距(像素)', type: 'number', default: 5, min: 1, max: 30, step: 1 },
    ],
  },
  {
    type: 'pixel_displace',
    label: '像素置换',
    icon: 'Waves',
    category: 'effect',
    params: [
      { name: 'intensity', label: '强度', type: 'number', default: 2, min: 1, max: 10, step: 1 },
      { name: 'frequency', label: '频率', type: 'number', default: 0.1, min: 0.01, max: 1, step: 0.01 },
    ],
  },
  // ---- PixelEdit Modifier ----
  {
    type: 'pixel_edit',
    label: 'PixelEdit(手动涂改)',
    icon: 'PenTool',
    category: 'color',
    params: [
      { name: 'opacity', label: '不透明度', type: 'number', default: 1, min: 0, max: 1, step: 0.05 },
    ],
  },
  // ---- Mirror / Flip Modifiers ----
  {
    type: 'mirror',
    label: '水平镜像',
    icon: 'FlipHorizontal',
    category: 'transform',
    params: [],
  },
  {
    type: 'flip',
    label: '垂直翻转',
    icon: 'FlipVertical',
    category: 'transform',
    params: [],
  },
  // ---- V2.0: Procedural Modifiers ----
  {
    type: 'noise',
    label: '噪声动画',
    icon: 'Radio',
    category: 'effect',
    params: [
      { name: 'amplitude', label: '振幅', type: 'number', default: 5, min: 0.1, max: 50, step: 0.5 },
      { name: 'frequency', label: '频率', type: 'number', default: 0.05, min: 0.001, max: 0.5, step: 0.005 },
      { name: 'octaves', label: '八度数', type: 'number', default: 2, min: 1, max: 8, step: 1 },
      { name: 'seed', label: '随机种子', type: 'number', default: 42, min: 0, max: 9999, step: 1 },
      { name: 'targetProperty', label: '目标属性', type: 'select', default: 'translateX', options: [
        { label: 'X位移', value: 'translateX' },
        { label: 'Y位移', value: 'translateY' },
        { label: '旋转', value: 'rotation' },
        { label: '缩放', value: 'scale' },
      ]},
    ],
  },
  {
    type: 'wave',
    label: '波浪动画',
    icon: 'Activity',
    category: 'effect',
    params: [
      { name: 'amplitude', label: '振幅', type: 'number', default: 5, min: 0.1, max: 50, step: 0.5 },
      { name: 'frequency', label: '频率', type: 'number', default: 0.1, min: 0.01, max: 2, step: 0.01 },
      { name: 'phase', label: '相位', type: 'number', default: 0, min: 0, max: 360, step: 1 },
      { name: 'waveType', label: '波形', type: 'select', default: 'sine', options: [
        { label: '正弦波', value: 'sine' },
        { label: '三角波', value: 'triangle' },
        { label: '方波', value: 'square' },
        { label: '锯齿波', value: 'sawtooth' },
      ]},
      { name: 'targetProperty', label: '目标属性', type: 'select', default: 'translateY', options: [
        { label: 'X位移', value: 'translateX' },
        { label: 'Y位移', value: 'translateY' },
        { label: '旋转', value: 'rotation' },
        { label: '缩放', value: 'scale' },
      ]},
    ],
  },
  {
    type: 'spring',
    label: '弹簧动画',
    icon: 'Zap',
    category: 'physics',
    params: [
      { name: 'stiffness', label: '刚度', type: 'number', default: 0.5, min: 0.01, max: 2, step: 0.01 },
      { name: 'damping', label: '阻尼', type: 'number', default: 0.3, min: 0, max: 1, step: 0.01 },
      { name: 'mass', label: '质量', type: 'number', default: 1, min: 0.1, max: 10, step: 0.1 },
      { name: 'restLength', label: '静止长度', type: 'number', default: 0, min: -50, max: 50, step: 1 },
      { name: 'targetProperty', label: '目标属性', type: 'select', default: 'translateY', options: [
        { label: 'X位移', value: 'translateX' },
        { label: 'Y位移', value: 'translateY' },
        { label: '旋转', value: 'rotation' },
        { label: '缩放', value: 'scale' },
      ]},
    ],
  },
  {
    type: 'jitter',
    label: '抖动动画',
    icon: 'Shuffle',
    category: 'effect',
    params: [
      { name: 'amount', label: '抖动量', type: 'number', default: 2, min: 0.1, max: 20, step: 0.1 },
      { name: 'frequency', label: '频率', type: 'number', default: 0.5, min: 0.01, max: 5, step: 0.01 },
      { name: 'smooth', label: '平滑', type: 'boolean', default: true },
      { name: 'targetProperty', label: '目标属性', type: 'select', default: 'translateX', options: [
        { label: 'X位移', value: 'translateX' },
        { label: 'Y位移', value: 'translateY' },
        { label: '旋转', value: 'rotation' },
        { label: '缩放', value: 'scale' },
      ]},
    ],
  },
  // ---- V2.1: Parameterized Animation Presets ----
  {
    type: 'pendulum',
    label: '钟摆运动',
    icon: 'Timer',
    category: 'animation',
    params: [
      { name: 'amplitude', label: '摆幅(°)', type: 'number', default: 30, min: 1, max: 180, step: 1 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 16, min: 2, max: 120, step: 1 },
      { name: 'phase', label: '相位(°)', type: 'number', default: 0, min: 0, max: 360, step: 1 },
      { name: 'damping', label: '阻尼', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
      // V3.2: Converge blend mode parameter
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
      // Pivot offset — allows pendulum to swing around a point other than Part.pivot
      { name: 'pivotOffsetX', label: '枢轴偏移X', type: 'number', default: 0, min: -500, max: 500, step: 1 },
      { name: 'pivotOffsetY', label: '枢轴偏移Y', type: 'number', default: 0, min: -500, max: 500, step: 1 },
    ],
  },
  {
    type: 'wheel',
    label: '轮式运动',
    icon: 'CircleDot',
    category: 'animation',
    params: [
      // ---- Trajectory (轨迹) ----
      { name: 'trajectoryMode', label: '轨迹模式', type: 'select', default: 'circular', options: [
        { label: '圆形/椭圆轨道', value: 'circular' },
        { label: '履带轨迹', value: 'caterpillar' },
        { label: '圆角矩形轨迹', value: 'rounded_rect' },
        { label: '潮汐锁定', value: 'tidal_lock' },
        { label: '独立自转', value: 'independent_spin' },
        { label: '齿轮对位', value: 'gear' },
      ]},
      { name: 'radiusX', label: '水平半径', type: 'number', default: 10, min: 1, max: 200, step: 1 },
      { name: 'radiusY', label: '垂直半径', type: 'number', default: 10, min: 1, max: 200, step: 1 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 16, min: 2, max: 120, step: 1 },
      { name: 'phase', label: '相位(°)', type: 'number', default: 0, min: 0, max: 360, step: 1 },
      { name: 'direction', label: '方向', type: 'select', default: 'cw', options: [
        { label: '顺时针', value: 'cw' },
        { label: '逆时针', value: 'ccw' },
      ]},
      // ---- Rounded rectangle specific ----
      { name: 'cornerRadius', label: '圆角半径', type: 'number', default: 5, min: 0, max: 50, step: 1 },
      // ---- Gear specific ----
      { name: 'gearTeeth', label: '齿数', type: 'number', default: 8, min: 2, max: 64, step: 1 },
      { name: 'gearMeshOffset', label: '啮合偏移', type: 'number', default: 0, min: 0, max: 1, step: 0.05 },
      // ---- Angular dynamics (旋转动力学) ----
      { name: 'angularVelocity', label: '角速度(°/s)', type: 'number', default: 0, min: -3600, max: 3600, step: 10 },
      { name: 'angularAcceleration', label: '角加速度(°/s²)', type: 'number', default: 0, min: -3600, max: 3600, step: 10 },
      { name: 'maxSpeed', label: '最大速度(°/s)', type: 'number', default: 720, min: 0, max: 7200, step: 10 },
      // ---- Converge ----
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  // V11: Dedicated gait animation modifier — D-shape trajectory with
  // aerial angle adjustment, landing/liftoff bending deformation,
  // and multiple gait styles (cartoon walk / slow walk / run)
  {
    type: 'gait',
    label: '步态运动',
    icon: 'Footprints',
    category: 'animation',
    params: [
      // ---- Gait style (步态风格) ----
      { name: 'gaitStyle', label: '步态风格', type: 'select', default: 'cartoon', options: [
        { label: '卡通行走', value: 'cartoon' },
        { label: '慢走', value: 'slow_walk' },
        { label: '奔跑', value: 'run' },
        { label: '划桨/游泳', value: 'paddle' },
      ]},
      // ---- Trajectory (轨迹) ----
      { name: 'strideLength', label: '步幅(px)', type: 'number', default: 20, min: 1, max: 100, step: 1 },
      { name: 'liftHeight', label: '抬步高度(px)', type: 'number', default: 12, min: 1, max: 80, step: 1 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 24, min: 4, max: 120, step: 1 },
      { name: 'phase', label: '腿偏移(°)', type: 'number', default: 0, min: 0, max: 360, step: 1 },
      { name: 'stanceRatio', label: '支撑比', type: 'number', default: 0.6, min: 0.15, max: 0.85, step: 0.05 },
      { name: 'direction', label: '行进方向', type: 'select', default: 'forward', options: [
        { label: '前进', value: 'forward' },
        { label: '后退', value: 'backward' },
      ]},
      // ---- Run-specific (奔跑参数) ----
      { name: 'aerialRatio', label: '腾空比', type: 'number', default: 0.35, min: 0, max: 0.6, step: 0.05 },
      { name: 'teardropAsymmetry', label: '水滴偏移', type: 'number', default: 0.3, min: 0, max: 0.6, step: 0.05 },
      // ---- Aerial angle (空中角度) ----
      { name: 'liftoffAngle', label: '离地角度(°)', type: 'number', default: -20, min: -90, max: 90, step: 1 },
      { name: 'peakAngle', label: '最高点角度(°)', type: 'number', default: 15, min: -90, max: 90, step: 1 },
      { name: 'contactAngle', label: '着地角度(°)', type: 'number', default: 10, min: -90, max: 90, step: 1 },
      { name: 'angleEasing', label: '角度缓动', type: 'select', default: 'sine', options: [
        { label: '线性', value: 'linear' },
        { label: '正弦', value: 'sine' },
        { label: '缓入缓出', value: 'ease_in_out' },
      ]},
      // ---- Bend deformation (弯折变形) ----
      { name: 'landBend', label: '着地弯折', type: 'number', default: 0.15, min: 0, max: 1, step: 0.01 },
      { name: 'landBendDuration', label: '着地弯折帧数', type: 'number', default: 3, min: 0, max: 12, step: 1 },
      { name: 'liftoffBend', label: '离地弯折', type: 'number', default: 0.1, min: 0, max: 1, step: 0.01 },
      { name: 'liftoffBendDuration', label: '离地弯折帧数', type: 'number', default: 2, min: 0, max: 12, step: 1 },
      // ---- Converge ----
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'bounce',
    label: '弹跳',
    icon: 'ArrowUpFromLine',
    category: 'animation',
    params: [
      { name: 'height', label: '弹跳高度', type: 'number', default: 20, min: 1, max: 200, step: 1 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 12, min: 2, max: 120, step: 1 },
      { name: 'bounces', label: '弹跳次数', type: 'number', default: 3, min: 1, max: 20, step: 1 },
      { name: 'damping', label: '衰减', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
      // V3.2: Converge blend mode parameter
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'breath',
    label: '呼吸缩放',
    icon: 'Heart',
    category: 'animation',
    params: [
      { name: 'amplitude', label: '缩放幅度', type: 'number', default: 0.1, min: 0.01, max: 1, step: 0.01 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 24, min: 2, max: 120, step: 1 },
      { name: 'phase', label: '相位(°)', type: 'number', default: 0, min: 0, max: 360, step: 1 },
      // V3.2: Converge blend mode parameter
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
      { name: 'pivotOffsetX', label: '枢轴偏移X', type: 'number', default: 0, min: -500, max: 500, step: 1 },
      { name: 'pivotOffsetY', label: '枢轴偏移Y', type: 'number', default: 0, min: -500, max: 500, step: 1 },
    ],
  },
  {
    type: 'wobble',
    label: '摇晃',
    icon: 'Rotate3d',
    category: 'animation',
    params: [
      { name: 'angleAmplitude', label: '摆角(°)', type: 'number', default: 5, min: 0.5, max: 45, step: 0.5 },
      { name: 'moveAmplitude', label: '位移幅度', type: 'number', default: 2, min: 0, max: 50, step: 0.5 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 12, min: 2, max: 120, step: 1 },
      { name: 'phase', label: '相位(°)', type: 'number', default: 0, min: 0, max: 360, step: 1 },
      { name: 'damping', label: '阻尼', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
      // V3.2: Converge blend mode parameter
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
      { name: 'pivotOffsetX', label: '枢轴偏移X', type: 'number', default: 0, min: -500, max: 500, step: 1 },
      { name: 'pivotOffsetY', label: '枢轴偏移Y', type: 'number', default: 0, min: -500, max: 500, step: 1 },
    ],
  },
  {
    type: 'float',
    label: '悬浮',
    icon: 'Cloud',
    category: 'animation',
    params: [
      { name: 'height', label: '浮动高度', type: 'number', default: 5, min: 0.5, max: 50, step: 0.5 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 24, min: 2, max: 120, step: 1 },
      { name: 'tilt', label: '倾斜(°)', type: 'number', default: 3, min: 0, max: 30, step: 0.5 },
      { name: 'phase', label: '相位(°)', type: 'number', default: 0, min: 0, max: 360, step: 1 },
      // V3.2: Converge blend mode parameter
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
      { name: 'pivotOffsetX', label: '枢轴偏移X', type: 'number', default: 0, min: -500, max: 500, step: 1 },
      { name: 'pivotOffsetY', label: '枢轴偏移Y', type: 'number', default: 0, min: -500, max: 500, step: 1 },
    ],
  },
  {
    type: 'shake',
    label: '震动',
    icon: 'Zap',
    category: 'animation',
    params: [
      { name: 'intensity', label: '强度', type: 'number', default: 3, min: 0.5, max: 30, step: 0.5 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 4, min: 1, max: 30, step: 1 },
      { name: 'decay', label: '衰减', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
      { name: 'seed', label: '随机种子', type: 'number', default: 0, min: 0, max: 9999, step: 1 },
      // V3.2: Converge blend mode parameter
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'elastic',
    label: '弹性回弹',
    icon: 'Disc',
    category: 'animation',
    params: [
      { name: 'offset', label: '偏移量', type: 'number', default: 20, min: 1, max: 200, step: 1 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 12, min: 2, max: 120, step: 1 },
      { name: 'overshoot', label: '过冲量', type: 'number', default: 0.3, min: 0, max: 1, step: 0.01 },
      { name: 'damping', label: '阻尼', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
      { name: 'axis', label: '轴向', type: 'select', default: 'y', options: [
        { label: 'Y轴(垂直)', value: 'y' },
        { label: 'X轴(水平)', value: 'x' },
        { label: '旋转', value: 'rotation' },
        { label: '缩放', value: 'scale' },
      ]},
      // V3.2: Converge blend mode parameter
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  // ---- M5: Expression Animation Modifier ----
  {
    type: 'expression',
    label: '表达式动画',
    icon: 'Code2',
    category: 'animation',
    params: [
      { name: 'expressionX', label: 'X位移表达式', type: 'select', default: '0', options: [
        { label: '无', value: '0' },
        { label: '正弦波', value: 'amplitude * sin(2 * PI * t / period + phase * PI / 180)' },
        { label: '余弦波', value: 'amplitude * cos(2 * PI * t / period + phase * PI / 180)' },
        { label: '锯齿波', value: 'amplitude * (2 * (t / period - floor(t / period)) - 1)' },
        { label: '弹跳', value: 'amplitude * abs(sin(2 * PI * t / period + phase * PI / 180))' },
      ]},
      { name: 'expressionY', label: 'Y位移表达式', type: 'select', default: '0', options: [
        { label: '无', value: '0' },
        { label: '正弦波', value: 'amplitude * sin(2 * PI * t / period + phase * PI / 180)' },
        { label: '余弦波', value: 'amplitude * cos(2 * PI * t / period + phase * PI / 180)' },
        { label: '弹跳', value: '-amplitude * abs(sin(2 * PI * t / period + phase * PI / 180))' },
      ]},
      { name: 'expressionRotation', label: '旋转表达式', type: 'select', default: '0', options: [
        { label: '无', value: '0' },
        { label: '钟摆', value: 'amplitude * sin(2 * PI * t / period + phase * PI / 180)' },
      ]},
      { name: 'expressionScale', label: '缩放表达式', type: 'select', default: '1', options: [
        { label: '无缩放', value: '1' },
        { label: '呼吸', value: '1 + amplitude * sin(2 * PI * t / period + phase * PI / 180)' },
      ]},
      { name: 'amplitude', label: '振幅', type: 'number', default: 10, min: 0.1, max: 200, step: 0.5 },
      { name: 'period', label: '周期(帧)', type: 'number', default: 16, min: 2, max: 120, step: 1 },
      { name: 'phase', label: '相位(°)', type: 'number', default: 0, min: 0, max: 360, step: 1 },
      // V3.2: Converge blend mode parameter
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  // ---- Pixel-Level Deformation Animation Modifiers ----
  {
    type: 'texture_scroll',
    label: '纹理滚动',
    icon: 'MoveHorizontal',
    category: 'animation',
    params: [
      { name: 'scrollDirection', label: '滚动方向', type: 'select', default: 'horizontal', options: [
        { label: '水平', value: 'horizontal' },
        { label: '垂直', value: 'vertical' },
        { label: '对角线', value: 'diagonal' },
      ]},
      { name: 'diagonalAngle', label: '对角角度(°)', type: 'number', default: 45, min: 0, max: 180, step: 1 },
      { name: 'scrollSpeed', label: '滚动速度(px/s)', type: 'number', default: 30, min: -200, max: 200, step: 1 },
      { name: 'scrollMode', label: '滚动模式', type: 'select', default: 'loop', options: [
        { label: '循环', value: 'loop' },
        { label: '往复循环', value: 'bounce_loop' },
        { label: '往复画布', value: 'bounce_canvas' },
      ]},
      { name: 'seamlessMode', label: '无缝模式', type: 'select', default: 'require_seamless', options: [
        { label: '要求无缝', value: 'require_seamless' },
        { label: '自动边缘融合', value: 'auto_edge_blend' },
      ]},
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'wave_deform',
    label: '波浪变形',
    icon: 'Waves',
    category: 'animation',
    params: [
      { name: 'directionType', label: '方向类型', type: 'select', default: 'horizontal', options: [
        { label: '水平', value: 'horizontal' },
        { label: '垂直', value: 'vertical' },
        { label: '对角线', value: 'diagonal' },
        { label: '径向', value: 'radial' },
      ]},
      { name: 'diagonalAngle', label: '对角角度(°)', type: 'number', default: 45, min: 0, max: 180, step: 1 },
      { name: 'radialCenterX', label: '径向中心X', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'radialCenterY', label: '径向中心Y', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'tangentialSign', label: '切向方向', type: 'select', default: 'cw', options: [
        { label: '顺时针', value: 'cw' },
        { label: '逆时针', value: 'ccw' },
      ]},
      { name: 'smoothRadius', label: '平滑半径', type: 'number', default: 5, min: 1, max: 10, step: 1 },
      { name: 'waveType', label: '波形类型', type: 'select', default: 'transverse', options: [
        { label: '横波', value: 'transverse' },
        { label: '纵波', value: 'longitudinal' },
        { label: '混合波', value: 'mixed' },
      ]},
      { name: 'transLongRatio', label: '横纵比', type: 'number', default: 0.7, min: 0, max: 1, step: 0.05 },
      { name: 'transverseSign', label: '横向符号', type: 'number', default: 1, min: -1, max: 1, step: 1 },
      { name: 'transverseAmplitude', label: '横向振幅', type: 'number', default: 5, min: 0, max: 30, step: 0.5 },
      { name: 'longitudinalAmplitude', label: '纵向振幅', type: 'number', default: 0, min: 0, max: 30, step: 0.5 },
      { name: 'spatialFrequency', label: '空间频率', type: 'number', default: 0.3, min: 0.01, max: 2, step: 0.01 },
      { name: 'phaseSpeed', label: '相位速度', type: 'number', default: 6.28, min: -20, max: 20, step: 0.1 },
      { name: 'initialPhase', label: '初始相位', type: 'number', default: 0, min: 0, max: 6.28, step: 0.01 },
      { name: 'densityWaveIntensity', label: '密度波强度', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
      { name: 'densityMinWeight', label: '密度最小权重', type: 'number', default: 0.3, min: 0, max: 1, step: 0.01 },
      { name: 'densityMaxWeight', label: '密度最大权重', type: 'number', default: 1.5, min: 0, max: 1, step: 0.01 },
      { name: 'densityTargetRGB', label: '密度目标RGB', type: 'boolean', default: true },
      { name: 'densityTargetAlpha', label: '密度目标Alpha', type: 'boolean', default: false },
      { name: 'densityTargetBrightness', label: '密度目标亮度', type: 'boolean', default: false },
      { name: 'densityTargetSaturation', label: '密度目标饱和度', type: 'boolean', default: false },
      { name: 'blendMode_composite', label: '合成模式', type: 'select', default: 'nearest', options: [
        { label: '最近邻', value: 'nearest' },
        { label: '平均', value: 'average' },
        { label: '深度', value: 'depth' },
      ]},
      { name: 'holeFill', label: '空洞填充', type: 'select', default: 'edge_copy', options: [
        { label: '无', value: 'none' },
        { label: '边缘复制', value: 'edge_copy' },
        { label: '固定颜色', value: 'fixed_color' },
      ]},
      { name: 'coordinateSystem', label: '坐标系', type: 'select', default: 'local', options: [
        { label: '局部', value: 'local' },
        { label: '世界', value: 'world' },
      ]},
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  // ---- V9: Pixel-Level Animation Modifiers ----
  {
    type: 'contour_scroll',
    label: '沿轮廓滚动纹理',
    icon: 'RotateCw',
    category: 'animation',
    params: [
      { name: 'scrollSpeed', label: '滚动速度(px/s)', type: 'number', default: 40, min: -200, max: 200, step: 1 },
      { name: 'scrollDirection', label: '滚动方向', type: 'select', default: 'cw', options: [
        { label: '顺时针', value: 'cw' },
        { label: '逆时针', value: 'ccw' },
      ]},
      { name: 'bandWidth', label: '纹理带宽度', type: 'number', default: 3, min: 1, max: 10, step: 1 },
      { name: 'colorA', label: '纹理色A', type: 'color', default: '#ffffff' },
      { name: 'colorB', label: '纹理色B', type: 'color', default: '#000000' },
      { name: 'blendWithOriginal', label: '与原图混合', type: 'boolean', default: true },
      { name: 'outlineThickness', label: '轮廓厚度', type: 'number', default: 2, min: 1, max: 8, step: 1 },
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'reveal_hide',
    label: '显形与隐形',
    icon: 'Eye',
    category: 'animation',
    params: [
      { name: 'mode', label: '模式', type: 'select', default: 'reveal', options: [
        { label: '显形(逐渐出现)', value: 'reveal' },
        { label: '隐形(逐渐消失)', value: 'hide' },
      ]},
      { name: 'transitionType', label: '过渡类型', type: 'select', default: 'wipe_right', options: [
        { label: '从左向右擦除', value: 'wipe_right' },
        { label: '从右向左擦除', value: 'wipe_left' },
        { label: '从上向下擦除', value: 'wipe_down' },
        { label: '从下向上擦除', value: 'wipe_up' },
        { label: '径向扩展', value: 'radial_out' },
        { label: '径向收缩', value: 'radial_in' },
        { label: '随机像素溶解', value: 'pixel_dissolve' },
        { label: '百叶窗', value: 'blinds' },
      ]},
      { name: 'duration', label: '持续帧数', type: 'number', default: 20, min: 2, max: 120, step: 1 },
      { name: 'easing', label: '缓动曲线', type: 'select', default: 'smooth', options: [
        { label: '线性', value: 'linear' },
        { label: '平滑', value: 'smooth' },
        { label: '缓入', value: 'ease_in' },
        { label: '缓出', value: 'ease_out' },
      ]},
      { name: 'randomSeed', label: '随机种子', type: 'number', default: 42, min: 0, max: 9999, step: 1 },
      { name: 'blindsCount', label: '百叶窗条数', type: 'number', default: 6, min: 2, max: 20, step: 1 },
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'shatter_dissolve',
    label: '碎裂消散',
    icon: 'Sparkles',
    category: 'animation',
    params: [
      { name: 'fragmentSize', label: '碎片大小', type: 'number', default: 4, min: 2, max: 16, step: 1 },
      { name: 'shatterDuration', label: '碎裂持续帧数', type: 'number', default: 10, min: 2, max: 60, step: 1 },
      { name: 'dissolveDuration', label: '消散持续帧数', type: 'number', default: 20, min: 2, max: 120, step: 1 },
      { name: 'scatterForce', label: '散射力度', type: 'number', default: 5, min: 1, max: 30, step: 1 },
      { name: 'scatterDirection', label: '散射方向', type: 'select', default: 'outward', options: [
        { label: '向外', value: 'outward' },
        { label: '向上', value: 'upward' },
        { label: '向下', value: 'downward' },
        { label: '随机', value: 'random' },
      ]},
      { name: 'fadeRate', label: '消散速率', type: 'number', default: 0.05, min: 0.01, max: 0.2, step: 0.01 },
      { name: 'rotationSpeed', label: '碎片旋转速度', type: 'number', default: 5, min: 0, max: 30, step: 1 },
      { name: 'randomSeed', label: '随机种子', type: 'number', default: 42, min: 0, max: 9999, step: 1 },
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'annihilate',
    label: '湮灭',
    icon: 'Zap',
    category: 'animation',
    params: [
      { name: 'implosionDuration', label: '内爆持续帧数', type: 'number', default: 8, min: 2, max: 60, step: 1 },
      { name: 'flashDuration', label: '闪光持续帧数', type: 'number', default: 4, min: 1, max: 30, step: 1 },
      { name: 'flashColor', label: '闪光颜色', type: 'color', default: '#ffffff' },
      { name: 'implosionForce', label: '内爆力度', type: 'number', default: 8, min: 1, max: 30, step: 1 },
      { name: 'sparkCount', label: '火花数量', type: 'number', default: 12, min: 0, max: 40, step: 1 },
      { name: 'sparkColor', label: '火花颜色', type: 'color', default: '#ffaa00' },
      { name: 'sparkLength', label: '火花长度', type: 'number', default: 3, min: 1, max: 8, step: 1 },
      { name: 'afterglowColor', label: '余晖颜色', type: 'color', default: '#ff4400' },
      { name: 'afterglowDuration', label: '余晖帧数', type: 'number', default: 10, min: 0, max: 60, step: 1 },
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'teleport',
    label: '传送',
    icon: 'Wifi',
    category: 'animation',
    params: [
      { name: 'mode', label: '传送方向', type: 'select', default: 'teleport_in', options: [
        { label: '传送进入', value: 'teleport_in' },
        { label: '传送离开', value: 'teleport_out' },
      ]},
      { name: 'duration', label: '持续帧数', type: 'number', default: 15, min: 2, max: 60, step: 1 },
      { name: 'glitchIntensity', label: '故障强度', type: 'number', default: 5, min: 1, max: 20, step: 1 },
      { name: 'scanLineSpeed', label: '扫描线速度', type: 'number', default: 30, min: 5, max: 100, step: 1 },
      { name: 'colorShift', label: '色彩偏移', type: 'number', default: 3, min: 0, max: 10, step: 1 },
      { name: 'scanLineColor', label: '扫描线颜色', type: 'color', default: '#00ffff' },
      { name: 'particleDensity', label: '粒子密度', type: 'number', default: 0.3, min: 0, max: 1, step: 0.05 },
      { name: 'randomSeed', label: '随机种子', type: 'number', default: 42, min: 0, max: 9999, step: 1 },
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'crt_off',
    label: '荧光屏关机',
    icon: 'Monitor',
    category: 'animation',
    params: [
      { name: 'shrinkDuration', label: '收缩持续帧数', type: 'number', default: 12, min: 2, max: 60, step: 1 },
      { name: 'flashDuration', label: '白闪帧数', type: 'number', default: 3, min: 1, max: 15, step: 1 },
      { name: 'lineDuration', label: '横线持续帧数', type: 'number', default: 8, min: 2, max: 30, step: 1 },
      { name: 'dotDuration', label: '亮点持续帧数', type: 'number', default: 15, min: 2, max: 60, step: 1 },
      { name: 'scanlineIntensity', label: '扫描线强度', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
      { name: 'flashColor', label: '闪光颜色', type: 'color', default: '#ffffff' },
      { name: 'dotColor', label: '亮点颜色', type: 'color', default: '#ffffff' },
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  // ---- V10: Geometric Deformation Modifiers (pixel-level) ----
  {
    type: 'bend',
    label: '弯曲',
    icon: 'Spline',
    category: 'animation',
    params: [
      { name: 'direction', label: '弯曲方向', type: 'select', default: 'horizontal', options: [
        { label: '水平弯曲', value: 'horizontal' },
        { label: '垂直弯曲', value: 'vertical' },
      ]},
      { name: 'curvature', label: '曲率', type: 'number', default: 0.3, min: -1, max: 1, step: 0.01 },
      { name: 'bendMode', label: '弯曲模式', type: 'select', default: 'arc', options: [
        { label: '弧线弯曲', value: 'arc' },
        { label: 'S型弯曲', value: 's_curve' },
        { label: '鱼尾弯曲', value: 'fishtail' },
      ]},
      { name: 'sPeriods', label: 'S型周期数', type: 'number', default: 1, min: 0.5, max: 4, step: 0.5 },
      { name: 'centerBias', label: '弯曲中心偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'falloff', label: '衰减', type: 'number', default: 1, min: 0, max: 2, step: 0.05 },
      { name: 'phaseSpeed', label: '相位速度', type: 'number', default: 0, min: -6.28, max: 6.28, step: 0.1 },
      { name: 'smoothSampling', label: '平滑采样', type: 'boolean', default: false },
      { name: 'holeFill', label: '空洞填充', type: 'select', default: 'edge_copy', options: [
        { label: '无', value: 'none' },
        { label: '边缘复制', value: 'edge_copy' },
      ]},
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'elliptical_compress',
    label: '椭圆化压缩',
    icon: 'Circle',
    category: 'animation',
    params: [
      { name: 'compressAxis', label: '压缩轴', type: 'select', default: 'y', options: [
        { label: '纵向压缩(变扁)', value: 'y' },
        { label: '横向压缩(变窄)', value: 'x' },
        { label: '双轴压缩', value: 'both' },
      ]},
      { name: 'compressRatio', label: '压缩比', type: 'number', default: 0.6, min: 0.1, max: 1, step: 0.01 },
      { name: 'centerX', label: '中心X偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'centerY', label: '中心Y偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'preserveArea', label: '面积守恒', type: 'boolean', default: true },
      { name: 'anisotropy', label: '各向异性', type: 'number', default: 0, min: -1, max: 1, step: 0.05 },
      { name: 'phaseSpeed', label: '相位速度', type: 'number', default: 0, min: -6.28, max: 6.28, step: 0.1 },
      { name: 'smoothSampling', label: '平滑采样', type: 'boolean', default: false },
      { name: 'holeFill', label: '空洞填充', type: 'select', default: 'edge_copy', options: [
        { label: '无', value: 'none' },
        { label: '边缘复制', value: 'edge_copy' },
      ]},
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'dumbbell_stretch',
    label: '哑铃化拉伸',
    icon: 'StretchHorizontal',
    category: 'animation',
    params: [
      { name: 'direction', label: '拉伸方向', type: 'select', default: 'horizontal', options: [
        { label: '水平拉伸', value: 'horizontal' },
        { label: '垂直拉伸', value: 'vertical' },
      ]},
      { name: 'neckRatio', label: '颈部缩放比', type: 'number', default: 0.4, min: 0.05, max: 1, step: 0.01 },
      { name: 'endRatio', label: '端部膨胀比', type: 'number', default: 1.3, min: 0.5, max: 2, step: 0.05 },
      { name: 'transitionWidth', label: '过渡宽度', type: 'number', default: 0.3, min: 0.05, max: 0.8, step: 0.05 },
      { name: 'stretchLength', label: '拉伸长度', type: 'number', default: 1.2, min: 0.5, max: 3, step: 0.05 },
      { name: 'centerX', label: '中心X偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'centerY', label: '中心Y偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'phaseSpeed', label: '相位速度', type: 'number', default: 0, min: -6.28, max: 6.28, step: 0.1 },
      { name: 'smoothSampling', label: '平滑采样', type: 'boolean', default: false },
      { name: 'holeFill', label: '空洞填充', type: 'select', default: 'edge_copy', options: [
        { label: '无', value: 'none' },
        { label: '边缘复制', value: 'edge_copy' },
      ]},
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'pillow_stretch',
    label: '枕型拉伸',
    icon: 'Square',
    category: 'animation',
    params: [
      { name: 'bulgeAmount', label: '膨胀量', type: 'number', default: 0.4, min: -1, max: 1.5, step: 0.01 },
      { name: 'centerX', label: '中心X偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'centerY', label: '中心Y偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'radiusX', label: '半径X', type: 'number', default: 100, min: 10, max: 200, step: 1 },
      { name: 'radiusY', label: '半径Y', type: 'number', default: 100, min: 10, max: 200, step: 1 },
      { name: 'falloffCurve', label: '衰减曲线', type: 'select', default: 'cosine', options: [
        { label: '余弦', value: 'cosine' },
        { label: '线性', value: 'linear' },
        { label: '二次', value: 'quadratic' },
        { label: '指数', value: 'exponential' },
      ]},
      { name: 'phaseSpeed', label: '相位速度', type: 'number', default: 0, min: -6.28, max: 6.28, step: 0.1 },
      { name: 'smoothSampling', label: '平滑采样', type: 'boolean', default: false },
      { name: 'holeFill', label: '空洞填充', type: 'select', default: 'edge_copy', options: [
        { label: '无', value: 'none' },
        { label: '边缘复制', value: 'edge_copy' },
      ]},
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'hyperbolic_stretch',
    label: '双曲型拉伸',
    icon: 'TrendingUp',
    category: 'animation',
    params: [
      { name: 'intensity', label: '拉伸强度', type: 'number', default: 0.5, min: 0, max: 2, step: 0.01 },
      { name: 'direction', label: '拉伸方向', type: 'select', default: 'radial', options: [
        { label: '径向', value: 'radial' },
        { label: '水平', value: 'horizontal' },
        { label: '垂直', value: 'vertical' },
      ]},
      { name: 'centerX', label: '中心X偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'centerY', label: '中心Y偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'asymmetry', label: '不对称度', type: 'number', default: 0, min: -1, max: 1, step: 0.05 },
      { name: 'falloff', label: '衰减', type: 'number', default: 1, min: 0.1, max: 3, step: 0.05 },
      { name: 'phaseSpeed', label: '相位速度', type: 'number', default: 0, min: -6.28, max: 6.28, step: 0.1 },
      { name: 'smoothSampling', label: '平滑采样', type: 'boolean', default: false },
      { name: 'holeFill', label: '空洞填充', type: 'select', default: 'edge_copy', options: [
        { label: '无', value: 'none' },
        { label: '边缘复制', value: 'edge_copy' },
      ]},
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  {
    type: 'ring_ripple',
    label: '环状涟漪拉伸',
    icon: 'Target',
    category: 'animation',
    params: [
      { name: 'amplitude', label: '振幅', type: 'number', default: 3, min: 0, max: 20, step: 0.5 },
      { name: 'frequency', label: '空间频率', type: 'number', default: 0.15, min: 0.01, max: 1, step: 0.01 },
      { name: 'speed', label: '传播速度', type: 'number', default: 6.28, min: -20, max: 20, step: 0.1 },
      { name: 'centerX', label: '中心X偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'centerY', label: '中心Y偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'damping', label: '阻尼', type: 'number', default: 0.02, min: 0, max: 0.2, step: 0.005 },
      { name: 'rippleMode', label: '涟漪模式', type: 'select', default: 'radial', options: [
        { label: '径向涟漪', value: 'radial' },
        { label: '螺旋涟漪', value: 'spiral' },
      ]},
      { name: 'spiralTwist', label: '螺旋扭转', type: 'number', default: 2, min: 0, max: 10, step: 0.1 },
      { name: 'phaseSpeed', label: '相位速度', type: 'number', default: 0, min: -6.28, max: 6.28, step: 0.1 },
      { name: 'smoothSampling', label: '平滑采样', type: 'boolean', default: false },
      { name: 'holeFill', label: '空洞填充', type: 'select', default: 'edge_copy', options: [
        { label: '无', value: 'none' },
        { label: '边缘复制', value: 'edge_copy' },
      ]},
      { name: 'convergeSpeed', label: '收敛速度', type: 'number', default: 0.5, min: 0.01, max: 3, step: 0.01 },
    ],
  },
  // ---- V2.2: Projection Rotation Modifiers (pixel-level) ----
  {
    type: 'cylinder_rotate',
    label: '圆柱投影旋转',
    icon: 'Cylinder',
    category: 'transform',
    params: [
      { name: 'angle', label: '旋转角度(°)', type: 'number', default: 0, min: -360, max: 360, step: 1 },
      { name: 'axisOffsetX', label: '轴心水平偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'radiusShrinkRatio', label: '半径缩小比例', type: 'number', default: 1, min: 0.1, max: 1, step: 0.01 },
      { name: 'projection', label: '投影类型', type: 'select', default: 'front', options: [
        { label: '正视图', value: 'front' },
        { label: '斜侧视图', value: 'oblique' },
      ]},
      { name: 'smooth', label: '平滑采样', type: 'boolean', default: false },
      { name: 'backFill', label: '背面填充', type: 'select', default: 'cyclic', options: [
        { label: '无填充', value: 'none' },
        { label: '循环纹理', value: 'cyclic' },
        { label: '同色延伸', value: 'extend' },
      ]},
    ],
  },
  {
    type: 'sphere_rotate',
    label: '球体投影旋转',
    icon: 'Globe',
    category: 'transform',
    params: [
      { name: 'angle', label: '旋转角度(°)', type: 'number', default: 0, min: -360, max: 360, step: 1 },
      { name: 'mode', label: '投影模式', type: 'select', default: 'segmented', options: [
        { label: '分段近似', value: 'segmented' },
        { label: '完整墨卡托', value: 'mercator' },
      ]},
      { name: 'centerX', label: '球心X偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'centerY', label: '球心Y偏移', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'maxLatitude', label: '有效纬度(°)', type: 'number', default: 85, min: 10, max: 90, step: 1 },
      { name: 'radiusShrinkRatio', label: '半径缩小比例', type: 'number', default: 1, min: 0.1, max: 1, step: 0.01 },
      { name: 'backFill', label: '背面填充', type: 'select', default: 'cyclic', options: [
        { label: '无填充', value: 'none' },
        { label: '循环纹理', value: 'cyclic' },
        { label: '同色延伸', value: 'extend' },
      ]},
    ],
  },
];

export function getModifierDef(type: ModifierType): ModifierDefinition {
  return MODIFIER_DEFINITIONS.find(d => d.type === type)!;
}

// ---- Helper Functions ----

export function createEmptyPixelGrid(width: number, height: number): PixelGrid {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => null));
}

export function createDefaultModifier(type: ModifierType): ModifierInstance {
  const def = getModifierDef(type);
  const params: Record<string, ModifierParamValue> = {};
  for (const p of def.params) {
    params[p.name] = p.default;
  }
  return {
    id: crypto.randomUUID(),
    type,
    enabled: true,
    collapsed: false,
    params,
    // V3.0: Effective range defaults (-1 = always active)
    startFrame: -1,
    endFrame: -1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    // V3.0: Blend mode default (additive for animation modifiers, ignored for others)
    blendMode: 'add',
    // V3.7: Coordinate mode default (world coordinates)
    coordinateMode: 'world',
  };
}

/** Create a default PartAnimationModifier with standard params for the given type */
export function createDefaultPartAnimationModifier(type: PartAnimationModifier['type']): PartAnimationModifier {
  const def = getModifierDef(type);
  const params: Record<string, ModifierParamValue> = {};
  for (const p of def.params) {
    params[p.name] = p.default;
  }
  return {
    id: crypto.randomUUID(),
    type,
    enabled: true,
    collapsed: false,
    params,
    startFrame: -1,
    endFrame: -1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    // V3.2: Default blend mode is additive (same as before)
    blendMode: 'add',
    // V3.2: Default group is null (ungrouped)
    groupId: null,
    // M7: ParamDriver support (empty by default)
    paramKeyframes: [],
    paramDrivers: [],
  };
}

// ---- Canvas Modifier Definitions (V2.4) ----

export const CANVAS_MODIFIER_DEFINITIONS: CanvasModifierDefinition[] = [
  {
    type: 'outline_emphasis',
    label: '轮廓强调',
    icon: 'BoxSelect',
    params: [
      { name: 'thickness', label: '厚度', type: 'number', default: 1, min: 1, max: 5, step: 1 },
      { name: 'color', label: '轮廓颜色', type: 'color', default: '#000000' },
      { name: 'directions', label: '方向数', type: 'select', default: '8', options: [
        { label: '4方向(高效)', value: '4' },
        { label: '8方向(圆润)', value: '8' },
      ]},
      { name: 'outlineMode', label: '轮廓模式', type: 'select', default: 'solid', options: [
        { label: '纯色轮廓', value: 'solid' },
        { label: '变暗轮廓', value: 'darken' },
        { label: '内容光照', value: 'gradient' },
      ]},
      { name: 'lightAngle', label: '光照角度(°)', type: 'number', default: 315, min: 0, max: 360, step: 1 },
      { name: 'blendMode', label: '混合模式', type: 'select', default: 'normal', options: [
        { label: '正常', value: 'normal' },
        { label: '叠加', value: 'overlay' },
        { label: '正片叠底', value: 'multiply' },
        { label: '滤色', value: 'screen' },
      ]},
      { name: 'edgesOnly', label: '仅边缘生效', type: 'boolean', default: true },
    ],
  },
  {
    type: 'color_lut',
    label: '全局颜色查找表',
    icon: 'Palette',
    params: [
      { name: 'preset', label: '预设', type: 'select', default: 'none', options: [
        { label: '无', value: 'none' },
        { label: '复古', value: 'retro' },
        { label: '单色', value: 'monochrome' },
        { label: '夜视', value: 'nightvision' },
        { label: '暖色', value: 'warm' },
        { label: '冷色', value: 'cool' },
        { label: '反色', value: 'invert' },
      ]},
      { name: 'intensity', label: '强度', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    type: 'pixel_zoom',
    label: '像素化缩放',
    icon: 'Maximize2',
    params: [
      { name: 'scale', label: '缩放倍数', type: 'number', default: 1, min: 0.25, max: 8, step: 0.25 },
      { name: 'antiAlias', label: '抗锯齿', type: 'boolean', default: false },
    ],
  },
  {
    type: 'bloom',
    label: '辉光/泛光',
    icon: 'Sun',
    params: [
      { name: 'threshold', label: '亮度阈值', type: 'number', default: 0.7, min: 0, max: 1, step: 0.05 },
      { name: 'radius', label: '半径', type: 'number', default: 3, min: 1, max: 20, step: 1 },
      { name: 'intensity', label: '强度', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
      { name: 'color', label: '颜色', type: 'color', default: '#ffffff' },
    ],
  },
  {
    type: 'scanlines',
    label: '扫描线/CRT',
    icon: 'Grid3x3',
    params: [
      { name: 'lineSpacing', label: '线间距', type: 'number', default: 2, min: 1, max: 8, step: 1 },
      { name: 'lineOpacity', label: '线透明度', type: 'number', default: 0.3, min: 0, max: 1, step: 0.05 },
      { name: 'lineColor', label: '线颜色', type: 'color', default: '#000000' },
      { name: 'vignette', label: '暗角效果', type: 'boolean', default: true },
      { name: 'vignetteIntensity', label: '暗角强度', type: 'number', default: 0.3, min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    type: 'canvas_mask',
    label: '画布裁剪/遮罩',
    icon: 'Circle',
    params: [
      { name: 'shape', label: '形状', type: 'select', default: 'circle', options: [
        { label: '圆形', value: 'circle' },
        { label: '星形', value: 'star' },
        { label: '圆角矩形', value: 'rounded_rect' },
        { label: '菱形', value: 'diamond' },
      ]},
      { name: 'margin', label: '边距', type: 'number', default: 0, min: 0, max: 50, step: 1 },
      { name: 'feather', label: '羽化', type: 'number', default: 0, min: 0, max: 10, step: 1 },
    ],
  },
];

export function getCanvasModifierDef(type: CanvasModifierType): CanvasModifierDefinition {
  return CANVAS_MODIFIER_DEFINITIONS.find(d => d.type === type)!;
}

export function createDefaultCanvasModifier(type: CanvasModifierType): CanvasModifierInstance {
  const def = getCanvasModifierDef(type);
  const params: Record<string, ModifierParamValue> = {};
  for (const p of def.params) {
    params[p.name] = p.default;
  }
  return {
    id: crypto.randomUUID(),
    type,
    enabled: true,
    collapsed: false,
    params,
  };
}

// ---- Workspace Mode System ----

/** Top-level workspace mode that determines the overall layout and workflow */
export type WorkspaceMode = 'project_home' | 'animation' | 'map_tile' | 'puppet';

/** Stages in the blob tile creation workflow */
export type TileWorkflowStage = 'base_materials' | 'template_3x3' | 'autotiles_47';

// ============================================================
// Shared Infrastructure Layer — PixelRenderable + PixelAnimModifier
// These types decouple pixel-level animation capabilities from Part,
// allowing tiles and map objects to reuse the same modifier system.
// ============================================================

/** Pixel-level animation modifier types that can operate on ANY PixelGrid,
 *  not just Part. These are the modifiers most useful for tiles and map objects:
 *  texture_scroll (water/lava), wave_deform (grass/heat), color_replace (palette),
 *  contour_scroll (energy borders), reveal_hide (fog), noise (flicker), etc.
 *
 *  Transform modifiers (translate, rotate, scale) are NOT included here because
 *  they require a coordinate system (pivot, parent transform) that only Part provides. */
export type PixelAnimModifierType =
  | 'texture_scroll'
  | 'wave_deform'
  | 'color_replace'
  | 'contour_scroll'
  | 'reveal_hide'
  | 'noise'
  | 'wave'
  | 'dither'
  | 'glow'
  | 'pixel_displace'
  | 'outline'
  | 'mirror'
  | 'flip'
  | 'bend'
  | 'elliptical_compress'
  | 'dumbbell_stretch'
  | 'pillow_stretch'
  | 'hyperbolic_stretch'
  | 'ring_ripple'
  | 'shatter_dissolve'
  | 'annihilate'
  | 'teleport'
  | 'crt_off'
  | 'cylinder_rotate'
  | 'sphere_rotate';

/** A pixel-level animation modifier that operates on a PixelGrid independently
 *  of Part. Reuses the same ParamDriver system as PartAnimationModifier.
 *  This is the shared abstraction that allows tiles and map objects to animate. */
export interface PixelAnimModifier {
  id: string;
  type: PixelAnimModifierType;
  enabled: boolean;
  collapsed: boolean;
  params: Record<string, ModifierParamValue>;
  /** Animation speed in fps (for time-based modifiers like texture_scroll) */
  animationSpeed: number;
  /** Optional ParamDrivers that auto-drive this modifier's numeric params */
  paramDrivers?: ParamDriver[];
  /** Optional per-modifier parameter keyframes */
  paramKeyframes?: ModifierParamKeyframe[];
}

/** Common interface for any object that can be rendered with pixel-level modifiers.
 *  Both Part and TileVariant implement this interface.
 *  This is the key abstraction for the shared infrastructure layer. */
export interface PixelRenderable {
  pixels: PixelGrid;
  width: number;
  height: number;
  /** Pixel-level animation modifiers — from shared infrastructure */
  animModifiers?: PixelAnimModifier[];
}

// ============================================================
// Tile Variant — Full data model for animated tiles
// ============================================================

/** Property tags for tile variants — game logic metadata */
export type TileTag =
  | 'walkable'
  | 'water'
  | 'lava'
  | 'damage'
  | 'obstacle'
  | 'wall'
  | 'decoration'
  | 'bridge'
  | 'door'
  | 'trigger'
  | 'transparent'
  | 'animated';

/** A tile variant that extends static pixels with animation and metadata.
 *  Implements PixelRenderable so it can use shared modifier infrastructure. */
export interface TileVariant extends PixelRenderable {
  id: string;
  /** Human-readable name */
  name: string;
  /** Bitmask metadata for autotiling */
  bitmask: number;
  /** Human-readable bitmask label (e.g., "N+E+NE") */
  bitmaskLabel: string;
  /** Property tags for game logic */
  tags: TileTag[];
  /** Number of animation frames (1 = static, >1 = animated) */
  animationFrameCount: number;
  /** Animation speed in fps */
  animationSpeed: number;
  /** Whether this variant has been manually edited */
  isEdited: boolean;
  /** Optional collision shape data for game engines */
  collisionShape?: {
    type: 'box' | 'polygon' | 'none';
    /** For box: [x, y, w, h]. For polygon: array of [x, y] points */
    data: number[][];
  };
}

// ============================================================
// Map Editor Subsystem — Tile map creation and editing
// ============================================================

/** A single tile placed on the map grid */
export interface MapTile {
  /** Reference to a TileVariant ID */
  variantId: string;
  /** Grid X position */
  x: number;
  /** Grid Y position */
  y: number;
  /** Layer index (0 = ground, 1+ = decoration) */
  layer: number;
  /** Horizontal flip */
  flipH: boolean;
  /** Vertical flip */
  flipV: boolean;
  /** Rotation in 90-degree steps (0, 90, 180, 270) */
  rotation: number;
}

/** Map layer configuration */
export interface MapLayer {
  id: string;
  name: string;
  /** Layer type: tile, collision, or object */
  type: 'tile' | 'collision' | 'object';
  visible: boolean;
  locked: boolean;
  opacity: number;
  /** Z-order (lower = rendered first) */
  order: number;
}

/** Map collision cell type */
export type CollisionCellType =
  | 'passable'      // Can walk through
  | 'blocked'       // Cannot walk through
  | 'water'         // Water — blocks non-aquatic
  | 'lava'          // Lava — damages on contact
  | 'half_block'    // Half-height block (can jump over)
  | 'slope_left'    // Slope going left
  | 'slope_right'   // Slope going right
  | 'platform';     // One-way platform (can jump through from below)

/** A collision map cell */
export interface MapCollisionCell {
  x: number;
  y: number;
  type: CollisionCellType;
  /** Optional game-specific data */
  metadata?: Record<string, string | number | boolean>;
}

/** Map export format options */
export type MapExportFormat = 'ldtk' | 'tiled' | 'json_custom';

/** The complete tile map */
export interface TileMap {
  id: string;
  name: string;
  /** Grid width in tiles */
  gridWidth: number;
  /** Grid height in tiles */
  gridHeight: number;
  /** Size of each tile in pixels */
  tileSize: number;
  /** Map layers */
  layers: MapLayer[];
  /** Placed tiles, organized by layer */
  tiles: MapTile[];
  /** Collision data (separate layer) */
  collisionData: MapCollisionCell[];
  /** Reference to the tile set this map uses */
  tileSetId: string;
  /** Background color for empty areas */
  backgroundColor: string;
  /** Dynamic objects on the map (props, effects, creatures, interactives) */
  dynamicObjects: MapDynamicObject[];
}

// ============================================================
// Map Dynamic Objects — Simplified animation for map decorations
// ============================================================

/** A dynamic object on the map — simplified version of Part.
 *  Only needs PixelGrid + PixelAnimModifier + ParamDriver.
 *  No Skeleton, no Keyframe, no Bone, no IK. */
export interface MapDynamicObject extends PixelRenderable {
  id: string;
  name: string;
  /** Position on the map in pixels */
  positionX: number;
  positionY: number;
  /** Z-order for rendering */
  zIndex: number;
  /** Object type for categorization */
  objectType: 'prop' | 'effect' | 'creature' | 'interactive';
  /** Whether the object loops its animation */
  loop: boolean;
  /** Animation frame rate */
  animationSpeed: number;
  /** Optional game logic trigger ID */
  triggerId?: string;
}

// ============================================================
// Tile Set Export — Game engine format output
// ============================================================

/** Tile set definition for game engine export */
export interface TileSetExport {
  name: string;
  tileSize: number;
  variants: {
    id: string;
    name: string;
    bitmask: number;
    bitmaskLabel: string;
    tags: TileTag[];
    isAnimated: boolean;
    frameCount: number;
    frameDurationMs: number;
    /** Base64 encoded PNG or reference to sprite sheet position */
    spriteData: string;
  }[];
  /** Sprite sheet layout (for packed exports) */
  spriteSheet?: {
    width: number;
    height: number;
    columns: number;
    padding: number;
  };
}

/** A blob material used as base input for tile generation */
export type MaterialSource = 'import' | 'generate';

/** Parameters for generating a blob material via noise */
export interface BlobGenParams {
  seed: number;
  scale: number;        // Noise scale (lower = bigger blobs)
  octaves: number;      // Noise octaves (1-6)
  persistence: number;  // Noise persistence (0.3-0.7)
  lacunarity: number;   // Noise lacunarity (1.5-2.5)
  threshold: number;    // Threshold for A/B (0-1, 0.5 = equal mix)
  color1: string;       // Primary color (hex)
  color2: string;       // Secondary color (hex)
  irregularity: number; // Edge irregularity (0 = smooth, 1 = very noisy)
  edgeSoftness: number; // Edge softness (0 = hard, 1 = very soft)
}

export interface BlobMaterial {
  id: string;
  name: string;
  source: MaterialSource;
  pixels: PixelGrid | null;
  width: number;
  height: number;
  genParams: BlobGenParams;
}

/** A 3x3 template tile generated from two base materials */
export interface TileTemplate {
  id: string;
  tiles: PixelGrid[][];
  tileSize: number;
  params: TileTemplateParams;
  materialAId: string;
  materialBId: string;
}

/** Parameters for generating the 3x3 template from base materials */
export interface TileTemplateParams {
  blendRatio: number;
  edgeSoftness: number;
  cornerStyle: 'round' | 'square' | 'chamfer';
  transitionWidth: number;
  ditherStrength: number;
  colorVariation: number;
  seed: number;
}

/** A single autotile generated from the template */
export interface Autotile {
  id: string;
  bitmask: number;
  label: string;
  pixels: PixelGrid;
  width: number;
  height: number;
}

/** Parameters for generating the 47 autotiles from a template */
export interface AutotileGenParams {
  tileSize: number;
  edgeBleed: number;
  cornerMerge: 'average' | 'dominant' | 'overlay';
  antiAlias: boolean;
  paddingInner: number;
  variationSeed: number;
}

/** Complete tile workflow state */
export interface TileWorkflowState {
  stage: TileWorkflowStage;
  baseMaterials: [BlobMaterial | null, BlobMaterial | null];
  template: TileTemplate | null;
  templateParams: TileTemplateParams;
  autotiles: Autotile[];
  autotileParams: AutotileGenParams;
  selectedAutotileBitmask: number | null;
  selectedMaterialSlot: 0 | 1;
  showTemplatePreview: boolean;
}

export function createDefaultTileWorkflowState(): TileWorkflowState {
  return {
    stage: 'base_materials',
    baseMaterials: [null, null],
    template: null,
    templateParams: {
      blendRatio: 0.5,
      edgeSoftness: 0.3,
      cornerStyle: 'round',
      transitionWidth: 0.3,
      ditherStrength: 0.2,
      colorVariation: 0.1,
      seed: 42,
    },
    autotiles: [],
    autotileParams: {
      tileSize: 16,
      edgeBleed: 0.2,
      cornerMerge: 'average',
      antiAlias: false,
      paddingInner: 0,
      variationSeed: 0,
    },
    selectedAutotileBitmask: null,
    selectedMaterialSlot: 0,
    showTemplatePreview: false,
  };
}
