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
 * Sprite: a raster image asset attached to a Node.
 * Optional plug overrides the node's default plug position.
 */
export interface Sprite {
  width: number;
  height: number;
  data: PixelGrid;              // 2D pixel grid (replaces Uint8ClampedArray for consistency)
  plug?: Point;                  // Optional: override node's default plug
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

/** Default mirror map: left directions mirror right directions */
export const DEFAULT_MIRROR_MAP: MirrorMap = {
  4: 0,  // West → East
  5: 7,  // SW → SE
  6: 2,  // South stays South (no mirror needed, but can be overridden)
  3: 1,  // NW → NE
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
export interface Socket {
  id: string;
  name: string;
  basePosition: Point;                    // Base offset relative to parent anchor
  directionOffsets: Partial<Record<DirectionIndex, Point>>; // Per-direction overrides
  templateOffsets?: Partial<Record<DirectionIndex, Point>>; // L0 template suggestions (can be reset to these)
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

  // ---- Animation Tracks (drive transform properties) ----
  tracks: NodeTracks;

  // ---- Dynamic Generated Items ----
  generated?: GeneratedItem;

  // ---- Draw Order ----
  drawLayer: string;             // Occlusion layer name
  zIndex: number;                // Within-layer draw order

  // ---- Visibility ----
  visible: boolean;

  // ---- Costume Reference ----
  costumePiece?: CostumePiece;   // Optional: links to costume system

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

// ---- Costume System ----

/**
 * CostumePiece: a slot-based sprite collection with direction variants,
 * mirror mapping, and cross sections for disc generation.
 */
export interface CostumePiece {
  slotKey: string;                              // Slot identifier (e.g., "left_arm", "torso")
  fillColor: string;                            // Primary color for disc generation
  sprites: Partial<Record<DirectionIndex, Sprite>>; // Direction → sprite
  scaleVariants: Partial<Record<number, Partial<Record<DirectionIndex, Sprite>>>>; // Scale → direction → sprite
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
}

// ---- Character Definition ----

/**
 * Character: a top-level creative object composed of a Node tree.
 * Replaces the old PuppetCharacter + separate Part list.
 *
 * Latitude is a static parameter (set at design time, not animated).
 * Direction-dependent draw orders are stored here.
 */
export interface Character {
  id: string;
  name: string;

  // ---- Node Tree ----
  rootNodeId: string;            // Root node of the character's tree
  nodes: Record<string, Node>;   // All nodes indexed by ID

  // ---- Costume System ----
  costumeSets: CostumeSet[];
  activeCostumeSetId?: string;

  // ---- Direction Draw Order ----
  // Per-direction draw order overrides (direction → drawLayer → z-order list)
  directionDrawOrders: Partial<Record<DirectionIndex, Record<string, string[]>>>;

  // ---- Static Latitude ----
  latitude: number;              // Viewing latitude (degrees, -90 to 90)

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
}

/** Render instruction for a dynamically generated disc */
export interface DiscRenderInstruction {
  worldX: SubPixel;
  worldY: SubPixel;
  diameter: number;
  fillColor: string;
  outlineColor: string;
  zIndex: number;                // parent Z - 0.5
}

/** Complete render plan for a frame */
export interface RenderPlan {
  nodeInstructions: NodeRenderInstruction[];
  discInstructions: DiscRenderInstruction[];
  sortedInstructions: (NodeRenderInstruction | DiscRenderInstruction)[];
}

// ---- Migration Types ----

/**
 * Old-to-new migration result.
 * Tracks which old entities map to which new entities.
 */
export interface MigrationMap {
  partToNode: Record<string, string>;      // old Part.id → new Node.id
  puppetNodeToNode: Record<string, string>; // old PuppetNode.id → new Node.id
  skeletonToCharacter: Record<string, string>; // old PuppetSkeleton.id → new Character.id
  oldClipToNewClip: Record<string, string>;   // old AnimationClip.id → new UnifiedAnimationClip.id
}

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
