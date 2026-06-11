// ============================================================
// PixelMorpher - Unified Render Pipeline
// ============================================================
// Implements the rendering flow described in the unified architecture:
//
// 1. Compute world transforms: depth-first from root node
// 2. Compute socket world positions: per parent, per direction
// 3. Z-order computation: draw layers + direction-dependent ordering
// 4. Generate render instructions: all node sprites + all discs
// 5. Execute rendering: stretch → rotate → translate → draw
//
// This pipeline replaces both renderFrame() and renderPuppetNodes()
// with a single unified entry point.
// ============================================================

import type {
  Node, Character, NodeTransform, Socket, DirectionIndex,
  SubPixel, Point, Sprite, RotationStrategy, CostumePiece,
  NodeRenderInstruction, DiscRenderInstruction, RenderPlan,
  KeyframeTrack, KeyframePoint, InterpolationMode,
  ModifierInstance, GeneratedItem, AnimationVariable,
} from './unified-types';
import {
  subToPx, halfPixelAlignSub, DEFAULT_MIRROR_MAP,
} from './unified-types';
import { renderPixelPerfectRotation } from './engine/puppet-render';
import {
  getDiscCacheKey, getCachedDisc, setCachedDisc,
  clearRenderCaches,
} from './engine/render-cache';
import {
  applyPixelModifiers,
  isPixelDeformModifier,
  computeTotalAnimPadding,
  padPixelGrid,
  trimTransparentEdges,
} from './engine/pixel-modifiers';
import { resolveKeyframeModifierParams } from './engine/param-driver';
import {
  applyTextureScroll,
  applyWaveDeform,
  applyContourScroll,
  applyRevealHide,
  applyShatterDissolve,
  applyAnnihilate,
  applyTeleport,
  applyCrtOff,
  applyBend,
  applyEllipticalCompress,
  applyDumbbellStretch,
  applyPillowStretch,
  applyHyperbolicStretch,
  applyRingRipple,
} from './engine/modifier-renderers';
import {
  renderGlowEffect,
  renderAfterimageEffect,
  renderMotionBlurEffect,
  renderParticleEffect,
  getTranslateOffset,
} from './engine/effect-render';
import { getAnimationFrameAndWeight } from './engine/animation-state';
import type { Part, PixelGrid, ModifierType } from './types';
import {
  resolveNodeModifiers,
  computeAnimationModifierTransform,
  buildVariableContext,
  type ResolvedModifier,
  type VariableContext,
  getEmptyVariableContext,
} from './unified-animation-resolver';

// ---- World Transform Computation ----

/** Computed world transform for a node */
export interface WorldTransform {
  nodeId: string;
  worldX: SubPixel;        // World position X (sub-pixel)
  worldY: SubPixel;        // World position Y (sub-pixel)
  worldAngle: number;      // Accumulated rotation (degrees)
  worldStretch: number;    // Accumulated stretch factor
  variantIndex: DirectionIndex; // Current direction
  mirror: boolean;         // Whether this node is mirrored
}

/**
 * Step 1: Compute world transforms for all nodes in a character.
 * Traverses the node tree depth-first from the root.
 */
function computeWorldTransforms(
  character: Character,
  frame: number,
  canvasWidth: number,
  canvasHeight: number,
  frameRate: number = 12,
  variableContext?: VariableContext,
): Map<string, WorldTransform> {
  const transforms = new Map<string, WorldTransform>();

  const rootNode = character.nodes[character.rootNodeId];
  if (!rootNode) return transforms;

  // Root node: center of canvas + node's own offset
  const rootInterpolated = interpolateTransform(rootNode, frame, frameRate, variableContext);
  const rootWorld: WorldTransform = {
    nodeId: rootNode.id,
    worldX: halfPixelAlignSub(pxToSub(canvasWidth / 2) + rootInterpolated.x),
    worldY: halfPixelAlignSub(pxToSub(canvasHeight / 2) + rootInterpolated.y),
    worldAngle: rootInterpolated.angle,
    worldStretch: rootInterpolated.stretch,
    variantIndex: rootInterpolated.variantIndex,
    mirror: false,
  };
  transforms.set(rootNode.id, rootWorld);

  // Recursively compute children
  computeChildTransforms(rootNode, rootWorld, character, frame, transforms, frameRate, variableContext);

  return transforms;
}

function computeChildTransforms(
  parentNode: Node,
  parentWorld: WorldTransform,
  character: Character,
  frame: number,
  transforms: Map<string, WorldTransform>,
  frameRate: number = 12,
  variableContext?: VariableContext,
): void {
  for (const childId of parentNode.children) {
    const childNode = character.nodes[childId];
    if (!childNode) continue;

    const childInterpolated = interpolateTransform(childNode, frame, frameRate, variableContext);
    let childWorldX: SubPixel;
    let childWorldY: SubPixel;
    let childAngle = childInterpolated.angle;
    let childMirror = parentWorld.mirror;

    if (childNode.attachment.type === 'socket' && childNode.attachment.parentSocketId) {
      // Socket-based attachment: compute from parent's socket position
      const socket = parentNode.sockets.find(s => s.id === childNode.attachment!.parentSocketId);
      if (socket) {
        // Get socket offset based on parent's current direction
        const socketOffset = resolveSocketOffset(socket, parentWorld.variantIndex);

        // IMPORTANT: Socket offsets are stored in sub-pixel units.
        // We must convert to PIXELS before applying rotation (cos/sin),
        // then convert the rotated result back to sub-pixel for world position.
        const socketOffsetX_px = subToPx(socketOffset.x);
        const socketOffsetY_px = subToPx(socketOffset.y);

        // Rotate socket offset by parent's world angle
        const angleRad = (parentWorld.worldAngle * Math.PI) / 180;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        const rotatedSocketX_px = socketOffsetX_px * cosA - socketOffsetY_px * sinA;
        const rotatedSocketY_px = socketOffsetX_px * sinA + socketOffsetY_px * cosA;

        // Rotate child's local offset by parent's world angle
        // (child offset is in parent's local space, so it must rotate with the parent)
        const childOffsetX_px = subToPx(childInterpolated.x);
        const childOffsetY_px = subToPx(childInterpolated.y) * childInterpolated.stretch;
        const rotatedChildX_px = childOffsetX_px * cosA - childOffsetY_px * sinA;
        const rotatedChildY_px = childOffsetX_px * sinA + childOffsetY_px * cosA;

        // The child's plug (attachment point) should be at the socket position.
        // Subtract the plug offset to align the child's plug with the socket.
        // This matches the old pipeline's:
        //   childOffsetX - childNode.plug.localX
        const plugOffset = childNode.attachment.plug ?? { x: 0, y: 0 };

        childWorldX = parentWorld.worldX
          + pxToSub(rotatedSocketX_px) - plugOffset.x
          + pxToSub(rotatedChildX_px);
        childWorldY = parentWorld.worldY
          + pxToSub(rotatedSocketY_px) - plugOffset.y
          + pxToSub(rotatedChildY_px);
      } else {
        childWorldX = parentWorld.worldX + childInterpolated.x;
        childWorldY = parentWorld.worldY + childInterpolated.y;
      }

      // Check if this direction requires mirroring
      const mirrorMap = childNode.costumePiece?.mirrorMap ?? DEFAULT_MIRROR_MAP;
      if (mirrorMap[childInterpolated.variantIndex] !== undefined) {
        childMirror = !parentWorld.mirror; // Toggle mirror
      }

    } else {
      // Fixed attachment: offset rotated by parent's world angle
      const fixedOffset = childNode.attachment.fixedOffset ?? { x: 0, y: 0 };
      const angleRad = (parentWorld.worldAngle * Math.PI) / 180;
      const cosA = Math.cos(angleRad);
      const sinA = Math.sin(angleRad);

      // Combine fixed offset + child's local offset, then rotate
      const totalOffsetX_px = subToPx(fixedOffset.x) + subToPx(childInterpolated.x);
      const totalOffsetY_px = subToPx(fixedOffset.y) + subToPx(childInterpolated.y) * childInterpolated.stretch;
      const rotatedX = totalOffsetX_px * cosA - totalOffsetY_px * sinA;
      const rotatedY = totalOffsetX_px * sinA + totalOffsetY_px * cosA;

      childWorldX = parentWorld.worldX + pxToSub(rotatedX);
      childWorldY = parentWorld.worldY + pxToSub(rotatedY);
    }

    // Inherit parent rotation if configured
    if (childNode.attachment.inheritRotation !== false) {
      childAngle += parentWorld.worldAngle;
    }

    const childWorld: WorldTransform = {
      nodeId: childId,
      worldX: childWorldX,
      worldY: childWorldY,
      worldAngle: childAngle,
      worldStretch: childInterpolated.stretch * parentWorld.worldStretch,
      variantIndex: childInterpolated.variantIndex,
      mirror: childMirror,
    };
    transforms.set(childId, childWorld);

    // Recurse into children
    computeChildTransforms(childNode, childWorld, character, frame, transforms, frameRate, variableContext);
  }
}

// ---- Socket Offset Resolution ----

/**
 * Get the effective socket offset for a given direction.
 * Falls back to basePosition if no direction-specific offset exists.
 */
function resolveSocketOffset(socket: Socket, direction: DirectionIndex): Point {
  return socket.directionOffsets[direction] ?? socket.basePosition;
}

// ---- Transform Interpolation ----

/**
 * Interpolate a node's transform at the given frame using its tracks.
 * Falls back to the node's base transform for properties without tracks.
 * Also applies animation modifier contributions (pendulum, bounce, etc.)
 * as additive offsets on top of the keyframe-driven base transform.
 */
function interpolateTransform(
  node: Node,
  frame: number,
  frameRate: number = 12,
  variableContext?: VariableContext,
): NodeTransform {
  const base = node.transform;

  // Step 1: Keyframe-driven base transform
  const kfX = interpolateTrack(node.tracks.x, frame, base.x);
  const kfY = interpolateTrack(node.tracks.y, frame, base.y);
  const kfAngle = interpolateTrack(node.tracks.angle, frame, base.angle);
  const kfStretch = interpolateTrack(node.tracks.stretch, frame, base.stretch);
  const kfVariant = interpolateTrack(node.tracks.variantIndex, frame, base.variantIndex) as DirectionIndex;

  // Step 2: Resolve animation modifiers and compute their transform contributions
  const animMods = resolveNodeModifiers(
    node.modifiers.filter(m => isAnimationModifier(m.type)),
    frame,
    variableContext,
  );

  if (animMods.length > 0) {
    const animTransform = computeAnimationModifierTransform(animMods, frame, frameRate);
    return {
      x: kfX + pxToSub(animTransform.translateX),
      y: kfY + pxToSub(animTransform.translateY),
      angle: kfAngle + animTransform.rotation,
      stretch: kfStretch * ((animTransform.scaleX + animTransform.scaleY) / 2), // Average scale as stretch
      variantIndex: kfVariant,
    };
  }

  return {
    x: kfX,
    y: kfY,
    angle: kfAngle,
    stretch: kfStretch,
    variantIndex: kfVariant,
  };
}

/**
 * Effect modifier types that render additional visual elements
 * (glow behind, particles on top, etc.) around the sprite.
 */
const EFFECT_MOD_TYPES: string[] = ['glow', 'afterimage', 'motion_blur', 'particle'];

/**
 * Check if a modifier type is an animation modifier (produces transform offsets)
 * vs. an edit modifier (produces pixel-level changes) or effect modifier.
 *
 * Note: 'elliptical_compress' was previously listed here, but in the old pipeline
 * it is handled as a pixel-deform modifier (PIXEL_DEFORM_MODIFIER_TYPES),
 * NOT as a transform-level animation modifier. It has been removed from this list
 * to match the old pipeline's behavior.
 */
function isAnimationModifier(type: string): boolean {
  return [
    'pendulum', 'wheel', 'bounce', 'breath', 'wobble',
    'gait', 'custom_wave',
    'float', 'shake', 'elastic',
  ].includes(type);
}

/**
 * Interpolate a single track at the given frame.
 * Returns the base value if no track or no keyframes.
 *
 * Supports three interpolation modes:
 * - step: hold previous keyframe value until next keyframe
 * - linear: straight-line interpolation between keyframes
 * - bezier: cubic bezier easing with time-parameterized curve
 *   (control points are normalized [0,1]² vectors;
 *    Newton-Raphson iteration finds the bezier parameter s
 *    where Bx(s) = t, then evaluates By(s) for the value fraction)
 */
function interpolateTrack<T extends number>(
  track: KeyframeTrack<T> | undefined,
  frame: number,
  baseValue: T,
): T {
  if (!track || track.keyframes.length === 0) return baseValue;

  const kfs = track.keyframes;

  // Before first keyframe: hold first value
  if (frame <= kfs[0].frame) return kfs[0].value;

  // After last keyframe: hold last value
  if (frame >= kfs[kfs.length - 1].frame) return kfs[kfs.length - 1].value;

  // Find surrounding keyframes
  for (let i = 0; i < kfs.length - 1; i++) {
    if (frame >= kfs[i].frame && frame <= kfs[i + 1].frame) {
      const mode = kfs[i + 1].interpolation ?? track.interpolation;

      switch (mode) {
        case 'step':
          return kfs[i].value;

        case 'linear': {
          const t = (frame - kfs[i].frame) / (kfs[i + 1].frame - kfs[i].frame);
          return (kfs[i].value + (kfs[i + 1].value - kfs[i].value) * t) as T;
        }

        case 'bezier': {
          // Time fraction between the two keyframes
          const t = (frame - kfs[i].frame) / (kfs[i + 1].frame - kfs[i].frame);
          const v0 = kfs[i].value;
          const v1 = kfs[i + 1].value;

          // Normalized control points in [0,1]² space.
          // Default: ease-in-out (0.33, 0) → (0.66, 1)
          const cp1 = kfs[i].bezierCP1 ?? { x: 0.33, y: 0 };
          const cp2 = kfs[i + 1].bezierCP2 ?? { x: 0.66, y: 1 };

          // Evaluate cubic bezier easing.
          // P0 = (0, 0), P1 = cp1, P2 = cp2, P3 = (1, 1)
          // Find s such that Bx(s) = t, then return v0 + By(s) * (v1 - v0)
          const easedT = solveCubicBezierX(cp1.x, cp2.x, t);
          const easedY = cubicBezierY(cp1.x, cp1.y, cp2.x, cp2.y, easedT);

          return (v0 + easedY * (v1 - v0)) as T;
        }

        default:
          return kfs[i].value;
      }
    }
  }

  return baseValue;
}

// ---- Cubic Bezier Easing ----

/**
 * Evaluate Bx(s) for a cubic bezier with P0=(0,0), P1=(cp1x,?), P2=(cp2x,?), P3=(1,1).
 * Only the x-coordinates of control points matter for Bx.
 */
function cubicBezierX(cp1x: number, cp2x: number, s: number): number {
  const ms = 1 - s;
  return 3 * ms * ms * s * cp1x + 3 * ms * s * s * cp2x + s * s * s;
}

/**
 * Evaluate By(s) for a cubic bezier with P0=(0,0), P1=(cp1x,cp1y), P2=(cp2x,cp2y), P3=(1,1).
 */
function cubicBezierY(cp1x: number, cp1y: number, cp2x: number, cp2y: number, s: number): number {
  const ms = 1 - s;
  return 3 * ms * ms * s * cp1y + 3 * ms * s * s * cp2y + s * s * s;
}

/**
 * Evaluate derivative Bx'(s).
 */
function cubicBezierXDeriv(cp1x: number, cp2x: number, s: number): number {
  const ms = 1 - s;
  return 3 * ms * ms * cp1x + 6 * ms * s * (cp2x - cp1x) + 3 * s * s * (1 - cp2x);
}

/**
 * Solve Bx(s) = t using Newton-Raphson iteration.
 * Falls back to binary search if Newton-Raphson diverges.
 *
 * This is the standard approach used by CSS and most animation systems
 * for time-parameterized cubic bezier easing.
 */
function solveCubicBezierX(cp1x: number, cp2x: number, t: number): number {
  // Edge cases
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  // Linear case: control points at 1/3 and 2/3 produce approximately linear X
  if (Math.abs(cp1x - 1 / 3) < 1e-6 && Math.abs(cp2x - 2 / 3) < 1e-6) {
    return t;
  }

  // Newton-Raphson iteration (typically converges in 4-8 iterations)
  let s = t; // Initial guess
  for (let i = 0; i < 8; i++) {
    const x = cubicBezierX(cp1x, cp2x, s) - t;
    const dx = cubicBezierXDeriv(cp1x, cp2x, s);
    if (Math.abs(dx) < 1e-12) break; // Near-zero derivative, fall back to bisection
    const sNew = s - x / dx;
    if (Math.abs(sNew - s) < 1e-8) return sNew; // Converged
    s = sNew;
  }

  // If Newton-Raphson didn't converge, use binary search
  let lo = 0, hi = 1;
  s = t;
  for (let i = 0; i < 20; i++) {
    const x = cubicBezierX(cp1x, cp2x, s);
    if (Math.abs(x - t) < 1e-8) return s;
    if (x < t) lo = s; else hi = s;
    s = (lo + hi) / 2;
  }

  return s;
}

// ---- Z-Order Computation ----

/**
 * Step 3: Compute Z-order for all nodes and discs.
 * Uses drawLayer and zIndex, with direction-dependent ordering.
 */
function computeZOrder(
  character: Character,
  worldTransforms: Map<string, WorldTransform>,
): { nodeZ: Map<string, number>; discZ: Map<string, number> } {
  const nodeZ = new Map<string, number>();
  const discZ = new Map<string, number>();

  // Get direction-dependent draw order if available
  const rootTransform = worldTransforms.get(character.rootNodeId);
  const currentDirection = rootTransform?.variantIndex ?? 0;
  const directionOrder = character.directionDrawOrders[currentDirection];

  // Assign Z indices based on tree order and direction overrides
  let zCounter = 0;
  const assignZ = (nodeId: string) => {
    const node = character.nodes[nodeId];
    if (!node || !node.visible) return;

    nodeZ.set(nodeId, node.zIndex + zCounter);
    zCounter += 100; // Leave room for disc insertion

    // If this node has a generated disc, its Z = parent Z - 0.5
    // (We use parent Z - 50 to place it between parent and children in the 100-step grid)
    if (node.generated) {
      discZ.set(`${nodeId}_disc`, (nodeZ.get(nodeId) ?? 0) - 50);
    }

    // Process children
    for (const childId of node.children) {
      assignZ(childId);
    }
  };

  assignZ(character.rootNodeId);
  return { nodeZ, discZ };
}

// ---- Sprite Resolution ----

/**
 * Resolve which sprite to use for a node at the current direction.
 * Priority: costumeSet → directionSprites → default sprite
 */
function resolveSprite(
  node: Node,
  direction: DirectionIndex,
  costumeSet?: import('./unified-types').CostumeSet,
): { sprite: Sprite | null; mirror: boolean } {
  // 1. Try costume set
  if (costumeSet && node.costumePiece) {
    const piece = costumeSet.pieces[node.costumePiece.slotKey];
    if (piece) {
      // Check for direct sprite at this direction
      const directSprite = piece.sprites[direction];
      if (directSprite) {
        return { sprite: directSprite, mirror: false };
      }

      // Check mirror map
      const mirrorSource = piece.mirrorMap[direction];
      if (mirrorSource !== undefined) {
        const mirroredSprite = piece.sprites[mirrorSource];
        if (mirroredSprite) {
          return { sprite: mirroredSprite, mirror: true };
        }
      }
    }
  }

  // 2. Try costumePiece direction sprites
  if (node.costumePiece) {
    const directSprite = node.costumePiece.sprites[direction];
    if (directSprite) {
      return { sprite: directSprite, mirror: false };
    }

    const mirrorSource = node.costumePiece.mirrorMap[direction];
    if (mirrorSource !== undefined) {
      const mirroredSprite = node.costumePiece.sprites[mirrorSource];
      if (mirroredSprite) {
        return { sprite: mirroredSprite, mirror: true };
      }
    }
  }

  // 3. Fall back to default sprite
  if (node.sprite) {
    return { sprite: node.sprite, mirror: false };
  }

  return { sprite: null, mirror: false };
}

// ---- Disc Generation ----

/**
 * Step 4 (partial): Generate disc render instructions for nodes
 * with `generated` configuration.
 *
 * Disc diameter is computed the same way as the old pipeline:
 *   diameter = (parent.crossSectionBottom + child.crossSectionTop) / 2
 *
 * The disc is positioned at the socket world position (the connection
 * point between parent and child), NOT at the child node's world position.
 */
function generateDiscInstructions(
  character: Character,
  worldTransforms: Map<string, WorldTransform>,
  discZ: Map<string, number>,
): DiscRenderInstruction[] {
  const discs: DiscRenderInstruction[] = [];

  for (const [nodeId, node] of Object.entries(character.nodes)) {
    if (!node.generated || node.generated.type !== 'disc') continue;

    const worldTf = worldTransforms.get(nodeId);
    if (!worldTf) continue;

    // Find parent node to get its crossSectionBottom
    const parentNode = node.parentId ? character.nodes[node.parentId] : undefined;

    // Child's crossSectionTop (stored as id='plug' crossSection in costumePiece)
    const childPiece = node.costumePiece;
    const childCrossSection = childPiece?.crossSections.find(
      cs => cs.id === node.generated!.crossSectionId
    );
    const childDiameter = childCrossSection?.diameter ?? 0;

    // Parent's crossSectionBottom (stored as id='bottom' crossSection in costumePiece)
    const parentPiece = parentNode?.costumePiece;
    const parentCrossSection = parentPiece?.crossSections.find(
      cs => cs.id === 'bottom'
    );
    const parentDiameter = parentCrossSection?.diameter ?? 0;

    // Diameter = average of parent bottom + child top (matches old pipeline logic)
    const diameter = Math.max(1, (parentDiameter + childDiameter) / 2);

    // Position the disc at the socket world position (connection point),
    // not at the child node's world position.
    // Compute the socket world position from the parent's transform.
    let discWorldX = worldTf.worldX;
    let discWorldY = worldTf.worldY;

    if (parentNode && node.attachment.type === 'socket' && node.attachment.parentSocketId) {
      // Find the socket on the parent
      const socket = parentNode.sockets.find(s => s.id === node.attachment!.parentSocketId);
      if (socket) {
        const parentWorldTf = worldTransforms.get(parentNode.id);
        if (parentWorldTf) {
          // Compute socket world position (same math as computeChildTransforms)
          const socketOffset = resolveSocketOffset(socket, parentWorldTf.variantIndex);
          const socketOffsetX_px = subToPx(socketOffset.x);
          const socketOffsetY_px = subToPx(socketOffset.y);
          const angleRad = (parentWorldTf.worldAngle * Math.PI) / 180;
          const cosA = Math.cos(angleRad);
          const sinA = Math.sin(angleRad);
          const rotatedSocketX_px = socketOffsetX_px * cosA - socketOffsetY_px * sinA;
          const rotatedSocketY_px = socketOffsetX_px * sinA + socketOffsetY_px * cosA;
          discWorldX = parentWorldTf.worldX + pxToSub(rotatedSocketX_px);
          discWorldY = parentWorldTf.worldY + pxToSub(rotatedSocketY_px);
        }
      }
    }

    const fillColor = childPiece?.fillColor ?? node.sprite?.data?.[0]?.[0] ?? '#808080';
    const outlineColor = '#000000'; // From global palette in full implementation

    discs.push({
      worldX: discWorldX,
      worldY: discWorldY,
      diameter,
      fillColor: typeof fillColor === 'string' ? fillColor : '#808080',
      outlineColor,
      zIndex: discZ.get(`${nodeId}_disc`) ?? 0,
    });
  }

  return discs;
}

// ---- Render Plan Generation ----

/**
 * Generate the complete render plan for a frame.
 * This is the main entry point for the unified render pipeline.
 *
 * Now supports animation modifier resolution: each node's modifiers
 * are resolved at the given frame (paramKeyframes + paramDrivers)
 * before computing world transforms, ensuring procedural animation
 * contributions (pendulum, bounce, etc.) are included.
 */
export function generateRenderPlan(
  character: Character,
  frame: number,
  canvasWidth: number,
  canvasHeight: number,
  rotationStrategy: RotationStrategy = 'pixel-perfect',
  frameRate: number = 12,
  animationVariables?: AnimationVariable[],
): RenderPlan {
  // Build variable context for ParamDriver resolution
  const variableContext = animationVariables && animationVariables.length > 0
    ? buildVariableContext(animationVariables, frame)
    : undefined;

  // Step 1: World transforms (includes animation modifier contributions)
  const worldTransforms = computeWorldTransforms(
    character, frame, canvasWidth, canvasHeight, frameRate, variableContext,
  );

  // Step 2: Z-order (includes disc Z computation)
  const { nodeZ, discZ } = computeZOrder(character, worldTransforms);

  // Step 3: Get active costume set
  const activeCostumeSet = character.activeCostumeSetId
    ? character.costumeSets.find(cs => cs.id === character.activeCostumeSetId)
    : undefined;

  // Step 4: Generate node render instructions
  const nodeInstructions: NodeRenderInstruction[] = [];
  const rootTransform = worldTransforms.get(character.rootNodeId);
  const currentDirection = rootTransform?.variantIndex ?? 0;

  for (const [nodeId, worldTf] of worldTransforms) {
    const node = character.nodes[nodeId];
    if (!node || !node.visible) continue;

    // Resolve sprite
    const { sprite, mirror } = resolveSprite(node, currentDirection, activeCostumeSet);
    if (!sprite) continue;

    // Determine rotation strategy
    const strategy: RotationStrategy = rotationStrategy;

    nodeInstructions.push({
      nodeId,
      sprite,
      worldX: worldTf.worldX,
      worldY: worldTf.worldY,
      angle: worldTf.worldAngle,
      stretch: worldTf.worldStretch,
      variantIndex: worldTf.variantIndex,
      rotationStrategy: strategy,
      mirror: mirror || worldTf.mirror,
      zIndex: nodeZ.get(nodeId) ?? 0,
      drawLayer: node.drawLayer,
      generated: undefined, // Discs are handled separately
      modifiers: node.modifiers,
      frame,
      frameRate,
    });
  }

  // Step 5: Generate disc instructions
  const discInstructions = generateDiscInstructions(character, worldTransforms, discZ);

  // Step 6: Sort all instructions by Z
  const allInstructions: (NodeRenderInstruction | DiscRenderInstruction)[] = [
    ...nodeInstructions,
    ...discInstructions,
  ];
  allInstructions.sort((a, b) => a.zIndex - b.zIndex);

  return {
    nodeInstructions,
    discInstructions,
    sortedInstructions: allInstructions,
  };
}

// ---- Render Execution ----

/**
 * Execute a render plan: draw all sprites and discs to the canvas.
 * This is the final step of the unified render pipeline.
 */
export function executeRenderPlan(
  ctx: CanvasRenderingContext2D,
  plan: RenderPlan,
  canvasWidth: number,
  canvasHeight: number,
): void {
  // Clear canvas
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  for (const instruction of plan.sortedInstructions) {
    if ('nodeId' in instruction) {
      renderNodeSprite(ctx, instruction, canvasWidth, canvasHeight);
    } else {
      renderDisc(ctx, instruction);
    }
  }
}

/**
 * Pixel-level modifier types that modify the pixel grid before drawing.
 * These are applied in the sprite → canvas conversion step.
 */
const PIXEL_MOD_TYPES: ModifierType[] = [
  'color_replace', 'outline', 'dither', 'pixel_displace',
  'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip', 'pixel_edit',
];

/**
 * Render a single node sprite to the canvas.
 * Implements the unified rendering flow:
 * modifiers → stretch → rotate → translate → draw
 *
 * Pixel-level modifiers (color_replace, outline, dither, pixel_edit, etc.)
 * are applied to the sprite's pixel data before creating the canvas.
 */
function renderNodeSprite(
  ctx: CanvasRenderingContext2D,
  instruction: NodeRenderInstruction,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const { sprite, worldX, worldY, angle, stretch, mirror, rotationStrategy, modifiers, frame, frameRate } = instruction;

  // ========================================================================
  // STEP 1: Apply pixel-level EDIT modifiers (color_replace, outline, dither, etc.)
  // These modify the sprite's pixel grid before any canvas creation.
  // This matches the old pipeline's createPartCanvasFromPart() behavior.
  // ========================================================================
  let effectivePixels: PixelGrid = sprite.data;
  let modOffsetX = 0;
  let modOffsetY = 0;

  const activePixelMods = modifiers.filter(m =>
    m.enabled && PIXEL_MOD_TYPES.includes(m.type as ModifierType)
  );

  // Create a minimal Part-like object for compatibility with applyPixelModifiers,
  // effect renderers, and animation-state functions that expect a Part.
  const pseudoPart = {
    id: instruction.nodeId,
    name: instruction.nodeId,
    width: sprite.width,
    height: sprite.height,
    pixels: sprite.data,
    pivotX: 0,
    pivotY: 0,
    offsetX: 0,
    offsetY: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    parentId: null as string | null,
    editModifiers: [] as any[],
    globalModifiers: [] as any[],
    animationModifiers: modifiers.filter(m =>
      m.enabled && isPixelDeformModifier(m.type as ModifierType)
    ) as any[],
    modifierGroups: [] as any[],
    partKeyframes: [] as any[],
  };

  if (activePixelMods.length > 0) {
    // Convert ModifierInstance[] to old format for applyPixelModifiers
    // Preserve paramKeyframes/paramDrivers so time-domain resolution works
    const oldFormatMods = activePixelMods.map(m => ({
      id: m.id,
      type: m.type,
      enabled: m.enabled,
      collapsed: m.collapsed ?? false,
      params: m.params ?? {},
      startFrame: m.startFrame,
      endFrame: m.endFrame,
      fadeInFrames: m.fadeInFrames,
      fadeOutFrames: m.fadeOutFrames,
      blendMode: m.blendMode,
      coordinateMode: m.coordinateMode,
      paramKeyframes: m.paramKeyframes,
      paramDrivers: m.paramDrivers,
    }));
    // Resolve ParamDrivers/ParamKeyframes before rendering
    const resolvedMods = oldFormatMods.some(m =>
      (m.paramKeyframes && m.paramKeyframes.length > 0) ||
      (m.paramDrivers && m.paramDrivers.length > 0 && m.paramDrivers.some((d: any) => d.enabled && !d.isBaked))
    ) ? resolveKeyframeModifierParams(oldFormatMods as any, frame) : oldFormatMods;
    const modResult = applyPixelModifiers(pseudoPart, resolvedMods as any, frame);
    effectivePixels = modResult.pixels;
    modOffsetX = modResult.offsetX;
    modOffsetY = modResult.offsetY;
  }

  // Apply translate modifier as pixel-level shift (internal shift, not position offset)
  // This matches the old pipeline's behavior in createPartCanvasInner()
  const translateMod = modifiers.find(m => m.type === 'translate' && m.enabled);
  if (translateMod) {
    const dx = Math.round(Number(translateMod.params.offsetX) || 0);
    const dy = Math.round(Number(translateMod.params.offsetY) || 0);
    if (dx !== 0 || dy !== 0) {
      const gridH = effectivePixels.length;
      const gridW = effectivePixels[0]?.length || 0;
      const shifted: PixelGrid = [];
      for (let y = 0; y < gridH; y++) {
        const row: (string | null)[] = [];
        for (let x = 0; x < gridW; x++) {
          const srcX = x - dx;
          const srcY = y - dy;
          if (srcX >= 0 && srcX < gridW && srcY >= 0 && srcY < gridH) {
            row.push(effectivePixels[srcY]?.[srcX] ?? null);
          } else {
            row.push(null);
          }
        }
        shifted.push(row);
      }
      effectivePixels = shifted;
    }
  }

  // ========================================================================
  // STEP 2: Apply pixel-deform ANIMATION modifiers
  // (texture_scroll, wave_deform, contour_scroll, reveal_hide, etc.)
  // These modify the pixel grid before canvas creation, after edit modifiers.
  // This matches the old pipeline's createPartCanvasInner() V4.0 section.
  // ========================================================================
  const activeDeformMods = modifiers.filter(m =>
    m.enabled && isPixelDeformModifier(m.type as ModifierType)
  );

  if (activeDeformMods.length > 0) {
    // Compute required padding for animation modifiers that can produce overflow
    const animPadding = computeTotalAnimPadding(activeDeformMods, frame, frameRate);
    if (animPadding.left > 0 || animPadding.top > 0 || animPadding.right > 0 || animPadding.bottom > 0) {
      effectivePixels = padPixelGrid(effectivePixels, animPadding.left, animPadding.top, animPadding.right, animPadding.bottom);
      modOffsetX += animPadding.left;
      modOffsetY += animPadding.top;
    }

    for (const rawAnimMod of activeDeformMods) {
      // Resolve paramKeyframes/paramDrivers before applying
      const resolvedMods = resolveNodeModifiers([rawAnimMod], frame);
      if (resolvedMods.length === 0) continue;
      const animMod = resolvedMods[0];

      // Compute weight from effective range
      const { weight } = getAnimationFrameAndWeight(rawAnimMod as any, frame);
      if (weight <= 0) continue;

      // V3.2: Apply converge factor
      const blendMode = rawAnimMod.blendMode || 'add';
      let convergeFactor = 1;
      if (blendMode === 'converge') {
        const convergeSpeed = Number(animMod.params.convergeSpeed) || 0.5;
        const { relativeFrame: cRelFrame } = getAnimationFrameAndWeight(rawAnimMod as any, frame);
        convergeFactor = Math.exp(-convergeSpeed * cRelFrame * 0.1);
      }
      const effectiveWeight = weight * convergeFactor;

      const partWidth = sprite.width;
      const partHeight = sprite.height;
      const params = animMod.params;

      switch (animMod.type) {
        case 'texture_scroll':
          effectivePixels = applyTextureScroll(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
          );
          break;
        case 'wave_deform':
          effectivePixels = applyWaveDeform(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
            0, 0, // worldOffsetX, worldOffsetY (approximation)
          );
          break;
        case 'contour_scroll':
          effectivePixels = applyContourScroll(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
          );
          break;
        case 'reveal_hide':
          effectivePixels = applyRevealHide(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
          );
          break;
        case 'shatter_dissolve':
          effectivePixels = applyShatterDissolve(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
          );
          break;
        case 'annihilate':
          effectivePixels = applyAnnihilate(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
          );
          break;
        case 'teleport':
          effectivePixels = applyTeleport(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
          );
          break;
        case 'crt_off':
          effectivePixels = applyCrtOff(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
          );
          break;
        case 'bend':
          effectivePixels = applyBend(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
          );
          break;
        case 'elliptical_compress':
          effectivePixels = applyEllipticalCompress(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
          );
          break;
        case 'dumbbell_stretch':
          effectivePixels = applyDumbbellStretch(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
          );
          break;
        case 'pillow_stretch':
          effectivePixels = applyPillowStretch(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
          );
          break;
        case 'hyperbolic_stretch':
          effectivePixels = applyHyperbolicStretch(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
          );
          break;
        case 'ring_ripple':
          effectivePixels = applyRingRipple(
            effectivePixels, partWidth, partHeight,
            params, frame, frameRate, effectiveWeight,
          );
          break;
      }
    }

    // Trim transparent edges created by the animation padding
    if (animPadding.left > 0 || animPadding.top > 0 || animPadding.right > 0 || animPadding.bottom > 0) {
      const trimmed = trimTransparentEdges(effectivePixels);
      effectivePixels = trimmed.pixels;
      modOffsetX -= trimmed.trimLeft;
      modOffsetY -= trimmed.trimTop;
    }
  }

  // Create offscreen canvas from (possibly modified) sprite data
  const spriteCanvas = pixelsToCanvas(effectivePixels, sprite.width, sprite.height);
  if (!spriteCanvas || spriteCanvas.width === 0 || spriteCanvas.height === 0) return;

  // Compute the pivot/plug position in the working canvas.
  // Account for modifier offset (e.g. outline expansion shifts the origin).
  // worldX/Y is where this pivot should land on the output canvas.
  // When mirrored, the plug X is flipped: x → width - x
  let pivotX = (sprite.plug?.x !== undefined ? subToPx(sprite.plug.x) : spriteCanvas.width / 2) + modOffsetX;
  const pivotY = (sprite.plug?.y !== undefined ? subToPx(sprite.plug.y) : spriteCanvas.height / 2) + modOffsetY;

  // Step 3: Apply horizontal flip if mirrored (STATIC mirror: flip BEFORE rotation)
  let workingCanvas: HTMLCanvasElement = spriteCanvas;
  if (mirror) {
    const flipCanvas = document.createElement('canvas');
    flipCanvas.width = spriteCanvas.width;
    flipCanvas.height = spriteCanvas.height;
    const flipCtx = flipCanvas.getContext('2d')!;
    flipCtx.translate(flipCanvas.width, 0);
    flipCtx.scale(-1, 1);
    flipCtx.drawImage(spriteCanvas, 0, 0);
    workingCanvas = flipCanvas;
    // Flip pivot: pivotX measured from left edge becomes (width - pivotX) after horizontal flip
    pivotX = workingCanvas.width - pivotX;
  }

  // ========================================================================
  // STEP 4: Set up canvas transform for this sprite's world position
  // (translate + rotate + scale around pivot), then render effects + sprite
  // ========================================================================

  // Compute the draw position (where the pivot lands on canvas)
  const drawPivotX = subToPx(worldX);
  const drawPivotY = subToPx(worldY);

  // We need ctx.save/restore to isolate the transform for effect rendering
  ctx.save();

  // Apply the same transform chain as the old pipeline:
  // translate(worldPosition) → rotate(angle) → scale(stretchY)
  // Then draw at (-pivotX, -pivotY) so the pivot aligns with world position
  ctx.translate(Math.round(drawPivotX), Math.round(drawPivotY));
  ctx.rotate((angle * Math.PI) / 180);
  ctx.scale(1, stretch);

  // ========================================================================
  // STEP 4a: Render "behind" effects (before the part itself)
  // glow, afterimage, motion_blur are drawn BEHIND the main sprite
  // This matches the old pipeline's renderPartToCanvas() behavior.
  // ========================================================================
  const behindEffectMods = modifiers.filter(m =>
    m.enabled && ['glow', 'afterimage', 'motion_blur'].includes(m.type)
  );
  for (const mod of behindEffectMods) {
    switch (mod.type) {
      case 'glow':
        renderGlowEffect(ctx, pseudoPart as Part, mod as any, workingCanvas);
        break;
      case 'afterimage':
        renderAfterimageEffect(ctx, pseudoPart as Part, mod as any, modifiers as any, workingCanvas);
        break;
      case 'motion_blur':
        renderMotionBlurEffect(ctx, pseudoPart as Part, mod as any, modifiers as any, workingCanvas);
        break;
    }
  }

  // ========================================================================
  // STEP 4b: Draw the main sprite
  // In the transformed coordinate space, the sprite's top-left is at (-pivotX, -pivotY)
  // ========================================================================
  ctx.imageSmoothingEnabled = false;

  if (rotationStrategy === 'pixel-perfect' && (angle !== 0 || stretch !== 1.0)) {
    // Use 4× upscale pixel-perfect rotation — this renders to an offscreen
    // canvas, then we draw that result at the world position.
    // Since we already applied the translate+rotate+scale transform above,
    // we need to undo it and draw the pixel-perfect result directly.
    ctx.restore(); // Undo the transform we set up

    const result = renderPixelPerfectRotation(
      workingCanvas,
      angle,
      stretch,
      pivotX,
      pivotY,
    );

    // Draw at world position with half-pixel alignment
    const drawX = Math.round(subToPx(worldX) - result.resultPivotX);
    const drawY = Math.round(subToPx(worldY) - result.resultPivotY);

    // For pixel-perfect rotation, render effects separately without the rotation transform
    // This is a simplification — in the full implementation, effects would need to account
    // for the rotation. For now, effects + pixel-perfect rotation don't fully compose,
    // but this matches the old pipeline's behavior where effects are rendered in the
    // pre-rotation coordinate space.
    if (behindEffectMods.length > 0) {
      ctx.save();
      ctx.translate(Math.round(drawPivotX), Math.round(drawPivotY));
      ctx.rotate((angle * Math.PI) / 180);
      ctx.scale(1, stretch);
      for (const mod of behindEffectMods) {
        switch (mod.type) {
          case 'glow':
            renderGlowEffect(ctx, pseudoPart as Part, mod as any, workingCanvas);
            break;
          case 'afterimage':
            renderAfterimageEffect(ctx, pseudoPart as Part, mod as any, modifiers as any, workingCanvas);
            break;
          case 'motion_blur':
            renderMotionBlurEffect(ctx, pseudoPart as Part, mod as any, modifiers as any, workingCanvas);
            break;
        }
      }
      ctx.restore();
    }

    ctx.drawImage(result.canvas, drawX, drawY);

    // Render "on top" effects after the sprite for pixel-perfect rotation path
    const topEffectMods = modifiers.filter(m =>
      m.enabled && m.type === 'particle'
    );
    if (topEffectMods.length > 0) {
      ctx.save();
      ctx.translate(Math.round(drawPivotX), Math.round(drawPivotY));
      ctx.rotate((angle * Math.PI) / 180);
      ctx.scale(1, stretch);
      for (const mod of topEffectMods) {
        renderParticleEffect(ctx, pseudoPart as Part, mod as any, frame);
      }
      ctx.restore();
    }
  } else {
    // Native Canvas2D or no rotation: draw in the already-transformed space
    ctx.drawImage(workingCanvas, -pivotX, -pivotY);

    // ========================================================================
    // STEP 4c: Render "on top" effects (after the part itself)
    // particle effects are drawn ON TOP of the main sprite
    // ========================================================================
    const topEffectMods = modifiers.filter(m =>
      m.enabled && m.type === 'particle'
    );
    for (const mod of topEffectMods) {
      renderParticleEffect(ctx, pseudoPart as Part, mod as any, frame);
    }

    ctx.restore(); // Undo the transform we set up
  }
}

/**
 * Render a disc (joint circle) at its world position.
 */
function renderDisc(
  ctx: CanvasRenderingContext2D,
  instruction: DiscRenderInstruction,
): void {
  const { worldX, worldY, diameter, fillColor, outlineColor } = instruction;
  const x = Math.round(subToPx(worldX));
  const y = Math.round(subToPx(worldY));
  const radius = Math.max(1, diameter / 2);

  // ---- Disc bitmap cache ----
  // Discs are pure geometric shapes determined by diameter + fillColor + outlineColor.
  // Cache the pre-rendered disc bitmap and reuse it across frames.
  const cacheKey = getDiscCacheKey(diameter, fillColor, outlineColor);
  let cached = getCachedDisc(cacheKey);

  if (!cached || cached.radius !== radius) {
    // Create pre-rendered disc bitmap
    const padding = 2; // Extra pixels for outline stroke
    const bmpSize = Math.ceil(diameter + padding * 2);
    const discCanvas = document.createElement('canvas');
    discCanvas.width = bmpSize;
    discCanvas.height = bmpSize;
    const discCtx = discCanvas.getContext('2d')!;
    const cx = bmpSize / 2;
    const cy = bmpSize / 2;

    discCtx.beginPath();
    discCtx.ellipse(cx, cy, radius, radius, 0, 0, Math.PI * 2);
    discCtx.fillStyle = fillColor;
    discCtx.fill();
    discCtx.strokeStyle = outlineColor;
    discCtx.lineWidth = 1;
    discCtx.stroke();

    cached = { canvas: discCanvas, radius };
    setCachedDisc(cacheKey, cached);
  }

  // Draw the cached disc bitmap centered at the world position
  const bmpSize = cached.canvas.width;
  ctx.drawImage(cached.canvas, x - bmpSize / 2, y - bmpSize / 2);
}

/**
 * Convert a PixelGrid to an offscreen HTMLCanvasElement.
 * This is the raw pixel→canvas conversion without modifier processing.
 */
function pixelsToCanvas(pixels: PixelGrid, width: number, height: number): HTMLCanvasElement | null {
  if (!pixels || pixels.length === 0) return null;
  if (width <= 0 || height <= 0) return null;

  const canvasW = pixels[0]?.length ?? width;
  const canvasH = pixels.length ?? height;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  const imageData = ctx.createImageData(canvasW, canvasH);
  for (let y = 0; y < canvasH; y++) {
    for (let x = 0; x < canvasW; x++) {
      const color = pixels[y]?.[x];
      if (color) {
        const idx = (y * canvasW + x) * 4;
        const rgb = hexToRgb(color);
        if (rgb) {
          imageData.data[idx] = rgb.r;
          imageData.data[idx + 1] = rgb.g;
          imageData.data[idx + 2] = rgb.b;
          imageData.data[idx + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Convert Sprite data to an offscreen HTMLCanvasElement.
 * Convenience wrapper around pixelsToCanvas for Sprite objects.
 */
function spriteDataToCanvas(sprite: Sprite): HTMLCanvasElement | null {
  return pixelsToCanvas(sprite.data, sprite.width, sprite.height);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '');
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// ---- Unified Render Entry Point ----

/**
 * Unified render function: renders a complete frame using the new architecture.
 * This is the primary entry point that replaces both renderFrame() and renderPuppetNodes().
 */
function renderUnifiedFrame(
  ctx: CanvasRenderingContext2D,
  character: Character,
  frame: number,
  canvasWidth: number,
  canvasHeight: number,
  backgroundColor: string = '#000000',
  rotationStrategy: RotationStrategy = 'pixel-perfect',
  frameRate: number = 12,
  animationVariables?: AnimationVariable[],
): void {
  // Clear and fill background
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Generate and execute render plan
  const plan = generateRenderPlan(
    character, frame, canvasWidth, canvasHeight,
    rotationStrategy, frameRate, animationVariables,
  );
  executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);
}

// ---- Compatibility Bridge ----

/**
 * Render using the old data model through the new pipeline.
 * This is the transitional API that allows the new render pipeline
 * to work with the old store data via the LiveAdapter.
 */
function renderFrameViaUnifiedPipeline(
  ctx: CanvasRenderingContext2D,
  character: Character,
  frame: number,
  canvasWidth: number,
  canvasHeight: number,
  backgroundColor: string = '#000000',
  frameRate: number = 12,
  animationVariables?: AnimationVariable[],
): void {
  renderUnifiedFrame(
    ctx, character, frame, canvasWidth, canvasHeight,
    backgroundColor, 'pixel-perfect', frameRate, animationVariables,
  );
}

// Helper: convert pixel value to sub-pixel units (imported from unified-types but also needed here)
function pxToSub(v: number): SubPixel {
  return Math.round(v * 16);
}
