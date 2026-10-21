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

/**
 * 3D → 2D 投影：按朝向将 3D 节点坐标投影到画布 2D
 * @param x 3D X（东西向，SubPixel）
 * @param y 3D Y（垂直，SubPixel）
 * @param z 3D Z（南北向，SubPixel）
 * @param direction 8 方向索引（0=East…6=South）
 * @returns { canvasX, canvasY, depth } 画布 2D 坐标（SubPixel）与深度（越大越靠前）
 */
export function projectToView(
  x: SubPixel,
  y: SubPixel,
  z: SubPixel,
  direction: DirectionIndex,
): { canvasX: SubPixel; canvasY: SubPixel; depth: number } {
  // 朝向 → 旋转角（与烘焙一致：南向 0°，东向 90°，逆时针）
  const theta = (((direction + 2) % 8) * Math.PI) / 4;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // 旋转投影：x' = x·cosθ + z·sinθ，深度 = -x·sinθ + z·cosθ
  const canvasX = x * cos + z * sin;
  const depth = -x * sin + z * cos;
  return { canvasX, canvasY: y, depth };
}

/**
 * 2D 拖动 → 3D 增量：按朝向将画布 2D 拖动映射到 3D 坐标增量
 * @param dx 画布 X 增量（SubPixel）
 * @param dy 画布 Y 增量（SubPixel）
 * @param direction 8 方向索引（0=East…6=South）
 * @returns { dx3, dy3, dz3 } 3D 坐标增量（SubPixel）
 */
export function mapDragTo3D(
  dx: SubPixel,
  dy: SubPixel,
  direction: DirectionIndex,
): { dx3: SubPixel; dy3: SubPixel; dz3: SubPixel } {
  const theta = (((direction + 2) % 8) * Math.PI) / 4;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // 逆映射：dx 分配到 x/z，dy 直接到 y
  const dx3 = dx * cos;
  const dz3 = dx * sin;
  return { dx3: dx3 as SubPixel, dy3: dy, dz3: dz3 as SubPixel };
}

/**
 * 视平面内旋转：将 3D 偏移量按朝向在视平面内旋转 angle 度
 * 南向转 XY 面，东向转 ZY 面，斜向按 θ 旋转
 * @param x 3D X 偏移（像素）
 * @param y 3D Y 偏移（像素）
 * @param z 3D Z 偏移（像素）
 * @param angleDeg 旋转角度（度）
 * @param direction 8 方向索引
 * @returns 旋转后的 (x', y', z')（像素）
 */
export function rotateInViewPlane(
  x: number,
  y: number,
  z: number,
  angleDeg: number,
  direction: DirectionIndex,
): { x: number; y: number; z: number } {
  const theta = (((direction + 2) % 8) * Math.PI) / 4;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  // 3D → 视平面坐标：h = x·cosθ + z·sinθ（横），d = -x·sinθ + z·cosθ（深）
  const h = x * cosT + z * sinT;
  const d = -x * sinT + z * cosT;
  // 视平面内旋转 (h, y)
  const rad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const h2 = h * cosA - y * sinA;
  const y2 = h * sinA + y * cosA;
  // 视平面 → 3D：x' = h'·cosθ - d·sinθ，z' = h'·sinθ + d·cosθ
  const x2 = h2 * cosT - d * sinT;
  const z2 = h2 * sinT + d * cosT;
  return { x: x2, y: y2, z: z2 };
}

/**
 * rotateInViewPlane 的逆运算：已知旋转后坐标，反推旋转前
 */
export function inverseRotateInViewPlane(
  x: number,
  y: number,
  z: number,
  angleDeg: number,
  direction: DirectionIndex,
): { x: number; y: number; z: number } {
  return rotateInViewPlane(x, y, z, -angleDeg, direction);
}

/**
 * 伪3D旋转：固定视平面水平轴，转 (Y, 深度轴) 平面
 * 南向转 (Z,Y)，东向转 (X,Y)，全朝向有效
 */
export function rotatePseudo3D(
  x: number,
  y: number,
  z: number,
  angleDeg: number,
  direction: DirectionIndex,
): { x: number; y: number; z: number } {
  const theta = (((direction + 2) % 8) * Math.PI) / 4;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  // 3D → (h=视水平, d=深度)
  const h = x * cosT + z * sinT;
  const d = -x * sinT + z * cosT;
  // 转 (d, y) 平面
  const rad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const d2 = d * cosA - y * sinA;
  const y2 = d * sinA + y * cosA;
  // (h, d2) → 3D
  return {
    x: h * cosT - d2 * sinT,
    y: y2,
    z: h * sinT + d2 * cosT,
  };
}

// ---- Frame FK 数学（真 3D 姿态） ----
//
// 姿态不再是标量角，而是朝向框架的复合旋转。矩阵在「朝向基」坐标 (h, y, d) 下表达：
// h = 视平面横轴、y = 竖直、d = 深度轴（与 projectToView/rotateInViewPlane 同约定）。
// 局部旋转 L = RU(tilt)·RD(angle)：RD 绕 d 轴转视平面内角（= rotateInViewPlane 的旋转），
// RU 绕 h 轴转出平面角（= rotatePseudo3D 的旋转）。tilt 恒 0 时整套逐值退化为旧标量 FK。

/** 3×3 旋转矩阵（行主序），坐标系为朝向基 (h, y, d) */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const MAT3_IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** 矩阵乘法 a·b（先 b 后 a） */
export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

/** 矩阵作用于朝向基坐标向量 (h, y, d) */
export function mat3Apply(m: Mat3, h: number, y: number, d: number): { h: number; y: number; d: number } {
  return {
    h: m[0] * h + m[1] * y + m[2] * d,
    y: m[3] * h + m[4] * y + m[5] * d,
    d: m[6] * h + m[7] * y + m[8] * d,
  };
}

/** 转置（旋转矩阵的逆） */
export function mat3Transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** 视平面内旋转矩阵 RD（绕 d 轴），与 rotateInViewPlane 的 (h,y) 旋转同约定 */
export function rotMatD(angleDeg: number): Mat3 {
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** 出平面旋转矩阵 RU（绕 h 轴），与 rotatePseudo3D 的 (d,y) 旋转同约定 */
export function rotMatU(tiltDeg: number): Mat3 {
  const rad = (tiltDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // y' = c·y + s·d；d' = −s·y + c·d
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

/** 局部旋转复合：先视平面内 angle、后出平面 tilt（L = RU(tilt)·RD(angle)） */
export function localRotMat(angleDeg: number, tiltDeg: number): Mat3 {
  if (tiltDeg === 0) return rotMatD(angleDeg);
  return mat3Mul(rotMatU(tiltDeg), rotMatD(angleDeg));
}

/** 世界轴坐标 → 朝向基坐标 (h, y, d) */
export function worldToViewBasis(
  x: number, y: number, z: number, direction: DirectionIndex,
): { h: number; y: number; d: number } {
  const theta = (((direction + 2) % 8) * Math.PI) / 4;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  return { h: x * cosT + z * sinT, y, d: -x * sinT + z * cosT };
}

/** 朝向基坐标 (h, y, d) → 世界轴坐标 */
export function viewBasisToWorld(
  h: number, y: number, d: number, direction: DirectionIndex,
): { x: number; y: number; z: number } {
  const theta = (((direction + 2) % 8) * Math.PI) / 4;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  return { x: h * cosT - d * sinT, y, z: h * sinT + d * cosT };
}

/**
 * 用 frame 旋转一个世界轴偏移向量：偏移先换到 direction 的朝向基，
 * 在基坐标下左乘 m，再换回世界轴。m = rotMatD(A) 时与 rotateInViewPlane 逐值相同。
 */
export function applyFrameRotation(
  m: Mat3, x: number, y: number, z: number, direction: DirectionIndex,
): { x: number; y: number; z: number } {
  const b = worldToViewBasis(x, y, z, direction);
  const r = mat3Apply(m, b.h, b.y, b.d);
  return viewBasisToWorld(r.h, r.y, r.d, direction);
}

/**
 * frame 的视平面派生角（度）：节点局部 +Y 轴（骨骼主轴）经 frame 旋转后，
 * 在自身朝向视平面上的投影角。tilt=0 时恒等于累积标量角（旧 worldAngle）。
 */
export function frameViewAngle(m: Mat3): number {
  // +Y 轴在基坐标下旋转后 = 矩阵第 2 列 (m[1], m[4], m[7])，取 (h, y) 分量
  return (Math.atan2(-m[1], m[4]) * 180) / Math.PI;
}

/** frame 旋转后的节点局部 +Y 轴在世界轴下的单位方向（入参须为单位长度偏移的 frame） */
export function frameYAxisWorld(m: Mat3, direction: DirectionIndex): { x: number; y: number; z: number } {
  return viewBasisToWorld(m[1], m[4], m[7], direction);
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
  /** 分部件相机半宽（归一化单位），用于渲染时换算到全局尺度（可逆性：记录尺度差） */
  partCameraHalf?: number;
  /** 整模相机半宽（归一化单位），全局统一尺度基准 */
  globalCameraHalf?: number;
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
  /** 3D 静态偏移（3D 管线用）：父关节→子关节的 3D 向量（SubPixel），direction 无关 */
  offset3D?: { x: number; y: number; z: number };
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
  /**
   * 自动生成关节盘（plug 开关）：undefined/true = 在此连接处自动生成关节盘
   * 遮盖接缝；false = 不生成。直径取 jointWidth / plug 截面，颜色取 discColor。
   */
  autoJointDisc?: boolean;
  /**
   * 允许蒙皮（plug 开关）：true 时动画面板出现「蒙皮快照」按钮；
   * 快照生效后该连接不再生成关节盘，改走合并精灵网格变形。
   */
  allowSkinning?: boolean;
  /** 蒙皮快照（动画面板捕获；null/undefined = 未快照，仍走双精灵渲染） */
  skinningSnapshot?: SkinningSnapshot | null;
}

/**
 * 蒙皮快照：把子节点与父节点在某个关键帧的姿态合并成一张精灵，
 * 之后子节点旋转时对这张合并精灵做网格弯曲（代替父/子两张精灵 + 关节盘）。
 */
export interface SkinningSnapshot {
  /** 合并精灵 id（全局精灵表）；其 plug = 关节在合并精灵内的位置 */
  spriteId: string;
  /** 捕获帧（展示用） */
  frame: number;
  /** 捕获时的渲染朝向（快照只在该朝向生效） */
  direction: DirectionIndex;
  /** 捕获时子相对父的角度（度） */
  baseAngle: number;
  /** 捕获时父节点的世界角度（度）：渲染时合并精灵转角 = 父当前世界角 − 此值 */
  parentBaseAngle: number;
  /** 子肢体轴向（合并精灵局部坐标的单位向量，y-down）：弯曲权重沿此轴过渡 */
  axisX: number;
  axisY: number;
  /** 弯曲带半径（像素）：关节沿轴向 ±radius 为过渡带，之外刚性 */
  radius: number;
  /** 弯曲过渡曲线 */
  curve: 'linear' | 'smoothstep';
}

// ---- Transform ----

/**
 * Node transform: all properties can be driven by animation tracks.
 * Sub-pixel precision (1/16 pixel) for x, y.
 * variantIndex selects direction variant for sprite lookup and socket offsets.
 */
export interface NodeTransform {
  x: SubPixel;                  // Local X offset (3D)
  y: SubPixel;                  // Local Y offset (3D, vertical)
  z: SubPixel;                  // Local Z offset (3D, depth)
  angle: number;                // Rotation angle (degrees, view-plane)
  tilt?: number;                // Out-of-plane rotation (degrees, about view-plane horizontal axis). Default 0 = legacy scalar FK.
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
    z: 0,
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
  tilt?: KeyframeTrack<number>;
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
  tilt?: number;
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
  /** 通用自定义变体精灵：variantId → direction → sprite（变体定义在 Character.variantDefs）。
   *  解析顺序：变体直达 → 变体镜像 → 基础 sprites 直达 → 基础镜像（见 sprite-resolve 的 resolvePieceSprite） */
  variantSprites?: Record<string, Partial<Record<DirectionIndex, Sprite | SpriteRef>>>;
  /** 全角度烘焙的纬度精灵集：纬度（度，±45/±90）→ direction → sprite；基纬度 0 用 sprites。
   *  解析：角色 latitude 取最近的已存纬度（差 ≤22.5°）整套优先，套内缺方向回落基础链；
   *  极点套（±90）只有 direction 0 一张，任意方向都用它（见 sprite-resolve 的 resolvePieceSprite） */
  latitudeSprites?: Record<number, Partial<Record<DirectionIndex, Sprite | SpriteRef>>>;
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
  /**
   * 旧义 2D 目标（历史字段）：链朝向画布平面上的点（含画布中心）。
   * 仅作旧数据种子与旧义镜像——求解禁止读它，一律走 target3D（见 resolveChainTarget3D）。
   * 写入方须保持投影镜像不变式：target = 画布中心 + projectToView(target3D, 链朝向).canvasXY。
   */
  target: { x: number; y: number };
  /**
   * 求解唯一输入：原点中心世界空间的 3D 目标（像素，z 向外为正）。
   * 缺失（旧项目）时由 resolveChainTarget3D 从 target 按链朝向反投影换算
   * （target 是链朝向画布平面上的点：其 x 分量按朝向落入世界 x/z，y 不变）。
   */
  target3D?: { x: number; y: number; z: number };
  /** 2bone 极向量目标（原点中心世界空间）；缺省取求解前 FK 的肘位（姿态连续） */
  poleTarget3D?: { x: number; y: number; z: number };
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

/**
 * IK 链求解目标的唯一解析口径：返回原点中心世界空间的 3D 目标（像素）。
 * - target3D 存在 → 直接用；
 * - 缺失（旧项目）→ 从旧义 target 换算：target 是「链朝向画布平面」上的点，
 *   (u, v) = target − 画布中心 是该朝向视平面坐标、深度 d=0，按 direction 反投影：
 *   南向 (u, v, 0)；东向 (0, v, u)——x 分量落入 z（用户 2026-10-20 定案）。
 * direction = 链根关节朝向（缺省 6 南向，与旧行为逐值一致）。
 * 求解、绘制、烘焙、编辑器一律走这里，不得直读 chain.target 求解。
 */
export function resolveChainTarget3D(
  chain: IKChain,
  canvasWidth: number,
  canvasHeight: number,
  direction: DirectionIndex = 6,
): { x: number; y: number; z: number } {
  if (chain.target3D) return chain.target3D;
  return viewBasisToWorld(
    chain.target.x - canvasWidth / 2,
    chain.target.y - canvasHeight / 2,
    0,
    direction,
  );
}

/** 旧义镜像：由 target3D（原点中心世界）按链朝向投影回画布平面 + 画布中心，写入 chain.target */
export function ikTargetMirror(
  target3D: { x: number; y: number; z: number },
  direction: DirectionIndex,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  const proj = projectToView(pxToSub(target3D.x), pxToSub(target3D.y), pxToSub(target3D.z), direction);
  return {
    x: canvasWidth / 2 + subToPx(proj.canvasX),
    y: canvasHeight / 2 + subToPx(proj.canvasY),
  };
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

  // ---- 通用自定义变体（槽位级） ----
  /** 变体定义（用户命名，如破损/湿透/燃烧）；变体只到槽位级——全身切换是服装集的职责，不在此重复 */
  variantDefs?: { id: string; name: string }[];
  /** 槽位变体指派：slotKey → variantId（无条目 = 基础）。角色级状态，不属于任何服装集，
   *  故同一部位在任何服装下都处于该变体；精灵本体存各集 piece 的 variantSprites */
  slotVariants?: Record<string, string>;

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

  /** 状态蓝图：纯状态图（无像素），每帧在服装解析前求值，输出服装集/槽位变体指令
   *  （costume_state 节点）。生效状态叠加顺序：静态字段 → clip 状态轨道 → 状态蓝图 */
  stateBlueprint?: BlueprintGraph | null;

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

/** clip 服装/变体状态轨道的一个关键帧（离散切换、无插值）。
 *  求值：以角色静态字段为底，按帧序增量应用 frame ≤ 当前帧的键 */
export interface CostumeStateKeyframe {
  frame: number;
  /** 给出时从该帧起整覆生效服装集 id；不给 = 沿用下层/前键的结果 */
  costumeSetId?: string;
  /** 逐槽增量：variantId = 指派该变体；null = 该槽从此回基础 */
  slotChanges?: Record<string, string | null>;
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
  /** 透视缩短系数（0~1）：精灵沿骨骼方向的绘制长度比；undefined = 不缩短 */
  foreshorten?: number;
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
  /** 蒙皮快照弯曲参数（attachment.skinningSnapshot 生效时填充，renderNodeSprite 用） */
  snapshotSkin?: {
    jointX: number;  // 关节在合并精灵局部坐标（像素）
    jointY: number;
    axisX: number;   // 子肢体轴向（单位向量）
    axisY: number;
    deltaAngle: number; // 当前相对角 − 快照基础角（度）
    radius: number;     // 弯曲带半径（像素）
    curve: 'linear' | 'smoothstep';
  };
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
  /** 本帧蓝图变量（变量名 → 值）：generateRenderPlan 从 AnimationVariable 求值后注入，
   *  供 executeRenderPlan/renderNodeSprite 的蓝图求值 ctx.vars 使用 */
  blueprintVars?: Record<string, number>;
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
