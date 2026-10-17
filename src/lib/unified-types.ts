// ============================================================
// PixelMorpher - Unified Node Architecture Types
// ============================================================
// All creative objects are "Characters" composed of Node trees.
// A Node may have: sprite, modifier stack, animation tracks,
// attachment constraint, and dynamic generated items.
//
// This module defines the unified data model that replaces the
// previous Part + PuppetNode dual-system architecture.
// ============================================================

import type { BlueprintGraph } from './blueprint/ir';

 // ---- Primitive Types ----

/** Sub-pixel coordinate unit: 1/16 pixel precision */
export type SubPixel = number; // Stored as integer * 16 + fraction_0to15

/** 2D point with sub-pixel precision */
export interface Point {
  x: SubPixel;
  y: SubPixel;
}

/** Helper: convert pixel value to sub-pixel units */
export function pxToSub(v: number): SubPixel {
  return Math.round(v * 16);
}

/** Helper: convert sub-pixel to pixel value */
export function subToPx(v: SubPixel): number {
  return v / 16;
}

/** Helper: half-pixel align a sub-pixel coordinate (center semantics) */
export function halfPixelAlignSub(v: SubPixel): SubPixel {
  // If the pixel component is integer (i.e. v/16 is integer),
  // shift to center (+0.5px = +8 sub-pixel units)
  const px = v / 16;
  return Number.isInteger(px) ? v + 8 : v;
}

// ---- Sprite & Visual Data ----

/** Pixel color: hex string or null (transparent) */
export type PixelColor = string | null;

/** 2D pixel grid */
export type PixelGrid = PixelColor[][];

/**
 * Sprite: the single pixel asset type (replaces Part).
 * Stored in the global s.sprites table; referenced by ID from CostumePiece.
 * Optional plug overrides the node's default plug position.
 */
export interface SpriteLandmarks {
  /** 相对坐标 0~1（方向无关，存在 sprite 级） */
  leftEye?: { x: number; y: number };
  rightEye?: { x: number; y: number };
  nose?: { x: number; y: number };
  mouth?: { x: number; y: number };
}

export interface Sprite {
  id?: string;                   // Global table key (s.sprites); optional for inline literals
  name?: string;                 // Asset library display name
  width: number;
  height: number;
  data: PixelGrid;              // 2D pixel grid (replaces Uint8ClampedArray for consistency)
  plug?: Point;                  // Optional: override node's default plug
  heightmap?: number[][];        // Optional: hand-painted heightmap for bump_light
  landmarks?: SpriteLandmarks;   // Optional: 手动标注的特征点（眼/鼻/嘴），用于蒙皮转面
}

// ---- Direction System ----

/** 8-direction index (0-7) */
export type DirectionIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Direction names for UI display */
export const DIRECTION_NAMES: Record<DirectionIndex, string> = {
  0: 'East',
  1: 'NE',
  2: 'North',
  3: 'NW',
  4: 'West',
  5: 'SW',
  6: 'South',
  7: 'SE',
} as const;

/** Mirror map: direction → source direction for sprite lookup + flip */
export type MirrorMap = Partial<Record<DirectionIndex, DirectionIndex>>;

/**
 * Convert old PuppetDirection string ('N', 'S', 'E', 'W', etc.) to DirectionIndex.
 * Matches the DIRECTION_MAP in migration-adapter.ts.
 */
export function puppetDirectionToIndex(direction: string): DirectionIndex {
  const lower = direction?.toLowerCase?.() ?? '';
  const map: Record<string, DirectionIndex> = {
    'east': 0, 'e': 0, 'right': 0,
    'ne': 1, 'northeast': 1,
    'north': 2, 'n': 2, 'up': 2,
    'nw': 3, 'northwest': 3,
    'west': 4, 'w': 4, 'left': 4,
    'sw': 5, 'southwest': 5,
    'south': 6, 's': 6, 'down': 6,
    'se': 7, 'southeast': 7,
  };
  return map[lower] ?? map[direction] ?? 0;
}

/** Default mirror map: left directions mirror right directions */
export const DEFAULT_MIRROR_MAP: MirrorMap = {
  4: 0,  // West → East
  5: 7,  // SW → SE
  3: 1,  // NW → NE
  // NOTE: South (6) intentionally NOT mirrored — S→N is visually wrong.
  // The old entry `6: 2` contradicted its own comment ("South stays South").
};

/** Mapping from DirectionIndex (0–7) to PuppetDirection string ('E','NE',...) */
export const DIR_INDEX_TO_PUPPET_DIR: Record<DirectionIndex, string> = {
  0: 'E',
  1: 'NE',
  2: 'N',
  3: 'NW',
  4: 'W',
  5: 'SW',
  6: 'S',
  7: 'SE',
} as const;

/** Mapping from PuppetDirection string to DirectionIndex (0–7) */
export const PUPPET_DIR_TO_INDEX: Record<string, DirectionIndex> = {
  'E': 0,
  'NE': 1,
  'N': 2,
  'NW': 3,
  'W': 4,
  'SW': 5,
  'S': 6,
  'SE': 7,
} as const;

// ---- Cross Section & Generated Items ----

/** Cross section mode for disc generation */
export type CrossSectionMode = 'inside' | 'contour' | 'external';

/**
 * Cross section: defines how a disc is generated at a connection point.
 * Used by the render pipeline to create joint discs automatically.
 */
export interface CrossSection {
  id: string;                    // "plug" or a socket ID
  mode: CrossSectionMode;
  direction?: number;            // inside mode: tangent direction (degrees)
  diameter?: number;             // Manual diameter (pixels), auto-detect if omitted
  contourDiameter?: number;      // contour mode diameter
  autoHose?: boolean;            // external mode: auto-generate rubber hose
}

/**
 * Generated item configuration.
 * Discs are NOT in the node tree — they are dynamically generated
 * by the render pipeline based on this configuration.
 */
export interface GeneratedItem {
  type: 'disc';
  sourceSlotKey?: string;        // Points to a thin limb slot key
  crossSectionId: string;        // Cross section ID (e.g., "plug" or socket ID)
}

// ---- Socket & Attachment ----

/**
 * Socket: an attachment point on a parent node.
 * Supports direction-dependent offset via directionOffsets map.
 * At runtime, the actual position is looked up by the parent's variantIndex.
 * If no entry exists for the current direction, basePosition is used.
 */
/** 关节蒙皮模式：disc=关节盘遮盖（默认），mesh=网格蒙皮变形 */
export type SocketSkinning = 'disc' | 'mesh';

export interface Socket {
  id: string;
  name: string;
  basePosition: Point;                    // Base offset relative to parent anchor
  directionOffsets: Partial<Record<DirectionIndex, Point>>; // Per-direction overrides
  templateOffsets?: Partial<Record<DirectionIndex, Point>>; // L0 template suggestions (can be reset to these)
  /** 蒙皮模式：'disc'（默认，关节盘遮盖接缝）| 'mesh'（网格蒙皮，父子精灵插值变形） */
  skinning?: SocketSkinning;
  /** mesh 模式：影响半径（像素），默认 8 */
  skinRadius?: number;
  /** mesh 模式：混合曲线，默认 'smoothstep' */
  skinCurve?: 'linear' | 'smoothstep';
}

/** Attachment type: how a child node connects to its parent */
export type AttachmentType = 'fixed' | 'socket';

/**
 * Attachment: defines how this node is connected to its parent.
 * - fixed: simple offset constraint (replaces Part.parentId)
 * - socket: socket/plug connection with direction support (replaces PuppetNode.plug)
 */
export interface Attachment {
  type: AttachmentType;

  // fixed mode
  fixedOffset?: Point;           // Offset from parent position
  inheritRotation?: boolean;     // Whether to inherit parent's rotation

  // socket mode
  parentSocketId?: string;       // Which socket on the parent to attach to
  plug?: Point;                  // Child's plug local coordinates (relative to node anchor)
  /**
   * 关节盘颜色覆盖（null/undefined = 自动：取子节点精灵开口处众数颜色）。
   * 由 LiveAdapter 从 PuppetPlug.discColor 透传。
   */
  discColor?: string | null;
  /**
   * 关节开口宽度（= 关节盘直径）。由 LiveAdapter 从 PuppetPlug.jointWidth 透传；
   * 为空时按 plug 位置回退估算。
   */
  jointWidth?: number | null;
}

// ---- Transform ----

/**
 * Node transform: all properties can be driven by animation tracks.
 * Sub-pixel precision (1/16 pixel) for x, y.
 * variantIndex selects direction variant for sprite lookup and socket offsets.
 */
export interface NodeTransform {
  x: SubPixel;                  // Local X offset
  y: SubPixel;                  // Local Y offset
  angle: number;                // Rotation angle (degrees)
  stretch: number;              // Y-axis stretch factor (0.5 ~ 2.0)
  variantIndex: DirectionIndex; // Direction variant index (0-7)
  scaleX?: number;               // X-axis scale factor (blueprint t.scaleX, default 1)
  skewX?: number;               // Skew X in degrees (blueprint t.skewX, default 0)
  skewY?: number;               // Skew Y in degrees (blueprint t.skewY, default 0)
}

/** Default transform values */
function createDefaultTransform(): NodeTransform {
  return {
    x: 0,
    y: 0,
    angle: 0,
    stretch: 1.0,
    variantIndex: 0,
  };
}

// ---- Modifier System ----

/**
 * Modifier type: identifies what kind of modification this is.
 * Reuses the existing ModifierType union from types.ts for compatibility.
 */
export type ModifierType =
  | 'translate' | 'rotate' | 'uniform_scale' | 'non_uniform_stretch' | 'skew'
  | 'color_replace' | 'outline' | 'dither' | 'outline_emphasis' | 'dither_pattern'
  | 'simple_physics' | 'physics' | 'pixel_edit' | 'pixel_displace'
  // Mirror / Flip modifiers (pixel-level)
  | 'mirror' | 'flip'
  // Effect modifiers (render additional visual elements around the sprite)
  | 'motion_blur' | 'glow' | 'particle' | 'afterimage'
  // Animation modifiers (drive transform properties)
  | 'pendulum' | 'wheel' | 'bounce' | 'breath' | 'wobble'
  | 'gait' | 'custom_wave' | 'elliptical_compress'
  | 'float' | 'shake' | 'elastic' | 'expression'
  // V2.2 Projection rotation modifiers (pixel-level)
  | 'cylinder_rotate' | 'sphere_rotate'
  // Procedural modifiers
  | 'noise' | 'wave' | 'spring' | 'jitter'
  // Pixel deformation animation modifiers
  | 'texture_scroll' | 'wave_deform' | 'contour_scroll'
  | 'reveal_hide' | 'shatter_dissolve' | 'annihilate' | 'teleport' | 'crt_off'
  // V10: Geometric deformation modifiers (pixel-level)
  | 'bend' | 'dumbbell_stretch' | 'pillow_stretch'
  | 'hyperbolic_stretch' | 'ring_ripple' | 'noise_displace'
  // Canvas modifiers (post-process)
  | 'canvas_outline' | 'canvas_lut' | 'canvas_glow' | 'canvas_vignette'
  | 'canvas_scanline' | 'canvas_chromatic_aberration';

/** Parameter value for modifiers */
export type ModifierParamValue = string | number | boolean | number[];

/**
 * Modifier instance: a single modifier in a node's modifier stack.
 * Modifiers are executed in order (bottom-to-top).
 *
 * CRITICAL ENHANCEMENT over the original spec:
 * Each modifier's parameters can be driven by paramTracks,
 * enabling per-frame modifier parameter changes (e.g., "enable outline
 * on frame 5, disable on frame 10").
 */
export interface ModifierInstance {
  id: string;
  type: ModifierType;
  enabled: boolean;
  collapsed: boolean;
  params: Record<string, ModifierParamValue>;
  coordinateMode?: ModifierCoordinateMode;
  blendMode?: AnimationBlendMode;

  // Scope: which frames this modifier is active
  startFrame?: number;
  endFrame?: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;

  // Per-parameter animation tracks
  paramKeyframes: ModifierParamKeyframe[];
  paramDrivers: ParamDriver[];
}

export type ModifierCoordinateMode = 'local' | 'world' | 'parent';
export type AnimationBlendMode = 'add' | 'multiply' | 'converge';

/** Keyframe for a modifier parameter */
export interface ModifierParamKeyframe {
  frame: number;
  params: Record<string, ModifierParamValue>;
  interpolation: InterpolationMode;
  bezierCP1?: Point;
  bezierCP2?: Point;
}

/** Interpolation mode for animation tracks */
export type InterpolationMode = 'step' | 'linear' | 'bezier';

// ---- ParamDriver System ----

/** Waveform type for parameter automation */
export type ParamDriverWaveform =
  | 'sine' | 'square' | 'triangle' | 'sawtooth'
  | 'noise' | 'bounce' | 'spring' | 'custom';

/** Parameter driver: function-driven parameter automation */
export interface ParamDriver {
  id: string;
  targetParam: string;
  waveform: ParamDriverWaveform;
  amplitude: number;
  frequency: number;
  phase: number;
  offset: number;
  enabled: boolean;
  source?: ParamSource;
}

/** Parameter source for driver chaining */
export type ParamSource =
  | { type: 'constant'; value: number }
  | { type: 'node_angle'; nodeId: string }
  | { type: 'node_stretch'; nodeId: string }
  | { type: 'variable'; variableName: string };

// ---- Animation Track System ----

/**
 * Keyframe track: a sequence of keyframes driving a single transform property.
 * Each track has its own interpolation mode:
 * - angle, variantIndex: typically step (hold)
 * - x, y, stretch: typically linear or bezier
 */
export interface KeyframeTrack<T = number> {
  keyframes: KeyframePoint<T>[];
  interpolation: InterpolationMode;  // Default interpolation for this track
}

/** A single keyframe point in a track */
export interface KeyframePoint<T = number> {
  frame: number;
  value: T;
  interpolation?: InterpolationMode; // Override track default for this segment
  bezierCP1?: Point;                 // Bezier control point 1 (for bezier mode)
  bezierCP2?: Point;                 // Bezier control point 2 (for bezier mode)
}

/** Helper: create a default keyframe track */
function createDefaultTrack<T>(interpolation: InterpolationMode = 'linear'): KeyframeTrack<T> {
  return { keyframes: [], interpolation };
}

// ---- Node Definition ----

/**
 * Node: the unified building block of a character.
 *
 * Combines the visual capabilities of Part (pixels, modifiers, keyframes)
 * with the structural capabilities of PuppetNode (hierarchy, direction,
 * sockets, stretch, generated items).
 *
 * A node can be:
 * - A visual node (has sprite): rendered as a sprite with modifiers
 * - A structural node (no sprite): only passes transforms to children
 * - A generator node: has `generated` config for disc/shape rendering
 */
export interface Node {
  id: string;
  name: string;

  // ---- Visual Data ----
  sprite?: Sprite;               // Optional: no sprite = structural node
  paletteOverride?: string;      // Optional: override global palette

  // ---- Transform (animatable via tracks) ----
  transform: NodeTransform;

  // ---- Attachment (how this node connects to parent) ----
  attachment: Attachment;

  // ---- Sockets (attachment points for children) ----
  sockets: Socket[];

  // ---- Modifier Stack (executed in order) ----
  modifiers: ModifierInstance[];

  // ---- Blueprint (node-level render IR, preferred over modifiers) ----
  blueprint?: BlueprintGraph | null;

  // ---- Animation Tracks (drive transform properties) ----
  tracks: NodeTracks;

  // ---- Trajectory (node-level motion path, baked from trajectory tool) ----
  // Points are in the same space as tracks.x/tracks.y (parent-local SubPixel offsets).
  // When present, renderer interpolates x/y from trajectory instead of tracks.
  trajectory?: { frame: number; x: number; y: number }[];

  // ---- Face Turn (Spine-style pseudo-3D head turning) ----
  // 用单张静态图 + 网格变形模拟转头/转身，不用画多角度差分。
  // yaw: -1（左）~ 1（右）；pitch: -1（上）~ 1（下）
  faceTurn?: { yaw: number; pitch: number };

  // ---- Dynamic Generated Items ----
  generated?: GeneratedItem;

  // ---- Draw Order ----
  drawLayer: string;             // Occlusion layer name
  zIndex: number;                // Within-layer draw order
  /** 左右标记：用于 E/W 朝向的默认遮挡排序 */
  side?: 'L' | 'R' | 'C';
  /** 是否为躯干核心：用于 S/N 朝向的默认遮挡排序 */
  isCore?: boolean;

  // ---- Visibility ----
  visible: boolean;

  // ---- Costume Reference ----
  slot?: CostumePiece;            // Optional: costume slot definition (links node to a costume slot)

  // ---- Children ----
  children: string[];            // Child node IDs (resolved at runtime)
  parentId?: string;             // Parent node ID (for quick lookup)
}

/** Animation tracks for a node's transform properties */
export interface NodeTracks {
  angle?: KeyframeTrack<number>;
  x?: KeyframeTrack<number>;
  y?: KeyframeTrack<number>;
  stretch?: KeyframeTrack<number>;
  variantIndex?: KeyframeTrack<number>;
}

/**
 * NodeKeyframe: a single keyframe for a Node in a clip timeline.
 * New model replacement for PuppetNodeKeyframe.
 * Field names align with NodeTracks (x/y not offsetX/offsetY, variantIndex not direction).
 */
export interface NodeKeyframe {
  id: string;
  nodeId: string;
  frame: number;
  angle?: number;
  stretch?: number;
  x?: number;
  y?: number;
  variantIndex?: number;
  /** zIndex override (step interpolation) */
  zIndex?: number;
  /** Interpolation mode for this keyframe */
  interpolationMode?: import('./types').InterpolationMode;
  /** Per-keyframe modifiers (interpolated between keyframes by param) */
  modifiers?: ModifierInstance[];
  /** Per-keyframe face turn (Spine-style pseudo-3D head turning, lerped) */
  faceTurn?: { yaw: number; pitch: number };
}

// ---- Costume System ----

/**
 * SpriteRef: reference to a Sprite in Character.sprites by ID.
 * Used in CostumePiece instead of embedding Sprite data directly.
 */
export interface SpriteRef {
  spriteId: string;
}

/**
 * CostumePiece: a slot-based sprite collection with direction variants,
 * mirror mapping, and cross sections for disc generation.
 *
 * Sprites are referenced by ID from Character.sprites (not embedded).
 * This preserves the reference model: shared, deduplicated, single source of truth.
 */
export interface CostumePiece {
  slotKey: string;                              // Slot identifier (e.g., "left_arm", "torso")
  fillColor: string;                            // Primary color for disc generation
  // Direction → sprite. Accepts embedded Sprite (legacy) or SpriteRef (new reference model).
  // New code should use SpriteRef; embedded is for migration transition.
  sprites: Partial<Record<DirectionIndex, Sprite | SpriteRef>>;
  scaleVariants: Partial<Record<number, Partial<Record<DirectionIndex, Sprite | SpriteRef>>>>;
  mirrorMap: MirrorMap;                         // Direction mirror mapping
  crossSections: CrossSection[];                // Cross section definitions for disc gen
}

/**
 * CostumeSet: a named collection of costume pieces.
 * Replaces the old CostumeSet (which was just a spriteMap).
 */
export interface CostumeSet {
  id: string;
  name: string;
  pieces: Record<string, CostumePiece>; // slotKey → CostumePiece
  /** Per-node transform offsets for this costume (from ref-assembly alignment).
   *  Key: node ID. Value: offset applied on top of rest pose. */
  nodeOffsets?: Record<string, { x: number; y: number; angle: number }>;
}

// ---- Character Definition ----

/**
 * Character: a top-level creative object composed of a Node tree.
 * Replaces the old PuppetCharacter + separate Part list.
 *
 * Latitude is a static parameter (set at design time, not animated).
 * Direction-dependent draw orders are stored here.
 */

/**
 * IK Chain: defines a kinematic chain for inverse kinematics.
 *
 * The chain is the path from rootNodeId to endNodeId (via parent links).
 * Bone lengths are derived from node socket positions.
 *
 * During render, if the chain is enabled, IK solves joint angles
 * to reach the target, overriding FK angles.
 */
export interface IKChain {
  id: string;
  name: string;
  /** Root joint node ID (e.g., shoulder) */
  rootNodeId: string;
  /** End effector node ID (e.g., hand) */
  endNodeId: string;
  /** IK target in character space (static fallback) */
  target: { x: number; y: number };
  /**
   * Optional blueprint driving the target dynamically.
   * Evaluated each frame; outputs {x, y} or {targetX, targetY}.
   * If present, overrides the static target. Use for gait/sine/etc.
   */
  targetBlueprint?: import('./blueprint/ir').BlueprintGraph;
  /** Solver: '2bone' for 2-joint chains, 'fabrik' for longer */
  solver: '2bone' | 'fabrik';
  /** Bend direction for 2-bone (+1/-1) */
  bendDir?: number;
  /** Distance from end joint pivot to tip (pixels). IK controls the tip, not the pivot. */
  tipLength?: number;
  /** Whether this chain is active */
  enabled: boolean;
}

export interface Character {
  id: string;
  name: string;

  // ---- Node Tree ----
  rootNodeId: string;            // Root node of the character's tree
  nodes: Record<string, Node>;   // All nodes indexed by ID

  // ---- IK Chains (Inverse Kinematics) ----
  // Defines kinematic chains for IK solving. The chain's joints are
  // determined by walking from rootNodeId to endNodeId via parent links.
  // During render, IK overrides the FK angles for chain joints.
  ikChains?: IKChain[];

  // ---- Baked IK Blueprint ----
  // Persistent blueprint generated from ikChains via the Bake button.
  // Editable in the blueprint editor. Takes precedence over ikChains
  // at render time if present.
  ikBlueprint?: BlueprintGraph | null;

  // ---- Sprite Table (retired) ----
  // Sprites moved to the global s.sprites table. Kept as optional for
  // backward compat during migration; readers must use the global table.
  sprites?: Record<string, Sprite>; // spriteId → Sprite (deprecated)

  // ---- Costume System ----
  costumeSets: CostumeSet[];
  activeCostumeSetId?: string;

  // ---- Direction Draw Order ----
  // Per-direction draw order overrides (direction → drawLayer → z-order list)
  directionDrawOrders: Partial<Record<DirectionIndex, Record<string, string[]>>>;

  // ---- Static Latitude ----
  latitude: number;              // Viewing latitude (degrees, -90 to 90)

  // ---- Character Blueprint (whole-character render IR) ----
  // character_source → user post-processing chain → screen.
  // For whole-character effects (outline/glow/color grade on the composited
  // character). Per-node effects stay in node.blueprint. Null = legacy path.
  blueprint?: BlueprintGraph | null;

  // ---- Face Turn Config (Spine-style pseudo-3D) ----
  faceTurnConfig?: {
    enabled: boolean;
    singleImageMode: boolean;
  };

  // ---- Facing Angle (continuous, for direction blending) ----
  // 0~360 degrees. When set, renderer blends between adjacent discrete
  // directions (0-7) using faceTurn deformation + alpha blending.
  // Undefined = use discrete variantIndex only (legacy behavior).
  facingAngle?: number;

  // ---- Metadata ----
  createdAt: number;
  updatedAt: number;
}

// ---- Animation Clip (Unified) ----

/**
 * AnimationClip: an independent animation resource.
 * Contains keyframe data for node tracks, plus effect/canvas modifier data.
 * Replaces the old dual AnimationClip (sprite + puppet).
 */
export interface UnifiedAnimationClip {
  id: string;
  name: string;
  characterId: string;           // Which character this clip animates

  // Frame settings
  frameRate: number;
  startFrame: number;
  endFrame: number;
  loop: boolean;

  // Node track data (per-node per-property keyframes)
  nodeTracks: Record<string, NodeTracks>; // nodeId → tracks

  // Effect tracks (global, not per-node)
  effectTracks: EffectTrack[];

  // Canvas modifier tracks
  canvasModifierTracks: CanvasModifierTrack[];

  // Metadata
  createdAt: number;
  updatedAt: number;
}

// ---- Effect & Canvas Modifier (reused from old system) ----

export interface EffectTrack {
  id: string;
  type: string;
  name: string;
  keyframes: EffectKeyframe[];
  visible: boolean;
  locked: boolean;
}

export interface EffectKeyframe {
  frame: number;
  params: Record<string, ModifierParamValue>;
}

export interface CanvasModifierTrack {
  id: string;
  type: string;
  name: string;
  keyframes: CanvasModifierKeyframe[];
  enabled: boolean;
}

export interface CanvasModifierKeyframe {
  frame: number;
  params: Record<string, ModifierParamValue>;
}

// ---- Project (Unified) ----

/**
 * UnifiedProject: top-level container for all creative data.
 * Replaces the old Project type.
 */
export interface UnifiedProject {
  id: string;
  name: string;

  // ---- Characters ----
  characters: Character[];

  // ---- Animation Clips ----
  animationClips: UnifiedAnimationClip[];
  activeAnimationClipId?: string;

  // ---- Global Modifiers ----
  globalModifiers: GlobalModifier[];

  // ---- Animation Variables ----
  animationVariables: AnimationVariable[];

  // ---- Canvas Settings ----
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;
  frameRate: number;

  // ---- Palettes ----
  palettes: Palette[];

  // ---- Metadata ----
  createdAt: number;
  updatedAt: number;
}

// ---- Shared Types (reused) ----

export interface GlobalModifier {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, ModifierParamValue>;
  keyframes: GlobalModifierKeyframe[];
}

export interface GlobalModifierKeyframe {
  frame: number;
  params: Record<string, ModifierParamValue>;
}

export interface AnimationVariable {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  // H6: 透传 store 侧的 writer 信息，供 buildVariableContext 做完整求值
  writerDriverId?: string;
  defaultValue?: number;
}

export interface Palette {
  id: string;
  name: string;
  colors: PaletteColor[];
}

export interface PaletteColor {
  color: string;
  name: string;
}

// ---- Render Pipeline Types ----

/** Rotation strategy for the render pipeline */
export type RotationStrategy = 'native' | 'pixel-perfect';

/** Render instruction for a single node */
export interface NodeRenderInstruction {
  nodeId: string;
  sprite: Sprite;
  worldX: SubPixel;
  worldY: SubPixel;
  angle: number;
  stretch: number;
  variantIndex: DirectionIndex;
  rotationStrategy: RotationStrategy;
  mirror: boolean;               // Whether to flip horizontally
  zIndex: number;
  drawLayer: string;
  generated?: DiscRenderInstruction;
  modifiers: ModifierInstance[];  // Pixel-level modifiers to apply before drawing
  frame: number;                 // Current frame (for modifier param resolution)
  frameRate: number;             // Frame rate (for modifier param resolution)
  /** X-axis scale factor (default 1). `stretch` covers the Y axis. */
  scaleX?: number;
  /** Skew transforms in degrees, applied after scale (matches old pipeline order). */
  skews?: Array<{ skewX: number; skewY: number }>;
  /** Preview quality: expensive effects (glow/afterimage/motion_blur/particle) are skipped in 'low'. */
  previewQuality?: 'low' | 'medium' | 'high';
  /** Auto motion blur (old pipeline parity): blurred from keyframe velocity. */
  autoMotionBlur?: boolean;
  autoMotionBlurIntensity?: number;
  /** Part identity + full keyframe list for auto-motion-blur lookup (nodeId = part.id). */
  autoMotionBlurSpriteId?: string;
  autoMotionBlurKeyframes?: UnifiedKeyframe[];
  /** Blueprint graph for this node (transform + pixel chain). Preferred over modifiers. */
  blueprint?: BlueprintGraph | null;
  /** Costume sets for costume node evaluation (character.costumeSets) */
  costumes?: CostumeSet[];
  /** Costume slot key for costume node (node.slot.slotKey) */
  costumeSlot?: string;
  /** Shared sprite table for SpriteRef resolution (character.sprites) */
  sprites?: Record<string, Sprite>;
  /** Mesh skinning params (socket.skinning === 'mesh' 时填充，renderNodeSprite 用） */
  meshSkin?: {
    plugX: number;   // plug 在精灵局部坐标（像素）
    plugY: number;
    jointAngle: number; // 关节相对角度（度，子相对父）
    radius: number;     // 影响半径（像素）
    curve: 'linear' | 'smoothstep';
  };
  /** Face turn params（Spine 式伪 3D 转头，renderNodeSprite 在 meshSkin 之前应用） */
  faceTurn?: {
    yaw: number;    // -1（左）~ 1（右）
    pitch: number;  // -1（上）~ 1（下）
  };
}

/**
 * Unified keyframe (new pipeline).
 * Minimal definition for auto-motion-blur lookup.
 * TODO: Expand as needed, or remove if auto-motion-blur is deprecated.
 */
export interface UnifiedKeyframe {
  id: string;
  frame: number;
  [key: string]: any;
}

/** Render instruction for a dynamically generated disc */
export interface DiscRenderInstruction {
  worldX: SubPixel;
  worldY: SubPixel;
  diameter: number;
  fillColor: string;
  outlineColor: string;
  zIndex: number;                // min(parent Z, child Z) - 50: occluded by sprites on both sides
}

/** Complete render plan for a frame */
export interface RenderPlan {
  nodeInstructions: NodeRenderInstruction[];
  discInstructions: DiscRenderInstruction[];
  sortedInstructions: (NodeRenderInstruction | DiscRenderInstruction)[];
  backgroundColor?: string;
  previewQuality?: 'low' | 'medium' | 'high';
  effectTracks?: any[];
  motionBlurStrokes?: any[];
  effectStrokes?: any[];
  autoMotionBlur?: boolean;
  autoMotionBlurIntensity?: number;
  frame?: number;
  frameRate?: number;
  /** Character-level blueprint (whole-character post-processing). Null = legacy per-node path. */
  characterBlueprint?: import('./blueprint/ir').BlueprintGraph | null;
}

// ---- Procedural Animation (Unified) ----

/**
 * Node-level procedural animation for the unified pipeline.
 * Migrated from old ProceduralAnimation (which was spriteId-based).
 * Uses nodeId to target Character nodes directly.
 */
export interface NodeProceduralAnimation {
  id: string;
  name: string;
  nodeId: string;
  config: ProceduralAnimationConfig;
  enabled: boolean;
  startFrame: number;
  endFrame: number;
}

/**
 * Procedural animation configuration.
 * Defines the animation type and parameters.
 */
export interface ProceduralAnimationConfig {
  type: 'wave' | 'bounce' | 'sway' | 'pulse' | string;
  targetProperty: string;
  amplitude?: number;
  frequency?: number;
  phase?: number;
  [key: string]: any;
}

// ---- Migration Types ----

// ============================================================
// Default Value Factories
// ============================================================

export function createDefaultSocket(id: string, name: string, x: SubPixel = 0, y: SubPixel = 0): Socket {
  return {
    id,
    name,
    basePosition: { x, y },
    directionOffsets: {},
    templateOffsets: {},
  };
}

export function createDefaultAttachment(): Attachment {
  return {
    type: 'fixed',
    fixedOffset: { x: 0, y: 0 },
    inheritRotation: true,
  };
}

function createDefaultSocketAttachment(socketId: string, plugX: SubPixel = 0, plugY: SubPixel = 0): Attachment {
  return {
    type: 'socket',
    parentSocketId: socketId,
    plug: { x: plugX, y: plugY },
  };
}

export function createDefaultNode(id: string, name: string): Node {
  return {
    id,
    name,
    transform: createDefaultTransform(),
    attachment: createDefaultAttachment(),
    sockets: [],
    modifiers: [],
    tracks: {},
    drawLayer: 'default',
    zIndex: 0,
    visible: true,
    children: [],
  };
}

export function createDefaultCharacter(id: string, name: string): Character {
  const rootNodeId = `${id}_root`;
  return {
    id,
    name,
    rootNodeId,
    nodes: {
      [rootNodeId]: createDefaultNode(rootNodeId, 'Root'),
    },
    // NOTE: Character.sprites is deprecated; sprites live in global s.sprites.
    costumeSets: [],
    directionDrawOrders: {},
    latitude: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function createDefaultCostumePiece(slotKey: string, fillColor: string = '#808080'): CostumePiece {
  return {
    slotKey,
    fillColor,
    sprites: {},
    scaleVariants: {},
    mirrorMap: { ...DEFAULT_MIRROR_MAP },
    crossSections: [],
  };
}

export function createDefaultCostumeSet(id: string, name: string): CostumeSet {
  return {
    id,
    name,
    pieces: {},
  };
}

/**
 * Reset a socket's directionOffsets back to the L0 template suggestions.
 * If templateOffsets exist for a direction, copies them to directionOffsets.
 * If no templateOffset exists for a direction, deletes that direction's offset
 * (falling back to basePosition).
 *
 * Returns a new Socket object (immutable update).
 */
function resetSocketToTemplate(socket: Socket): Socket {
  const newOffsets: Partial<Record<DirectionIndex, Point>> = {};
  if (socket.templateOffsets) {
    for (const [dir, point] of Object.entries(socket.templateOffsets)) {
      newOffsets[Number(dir) as DirectionIndex] = { ...point! };
    }
  }
  return {
    ...socket,
    directionOffsets: newOffsets,
  };
}
