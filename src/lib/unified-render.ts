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
  ModifierInstance, GeneratedItem, AnimationVariable, ParamDriver,
} from './unified-types';
import {
  subToPx, halfPixelAlignSub, DEFAULT_MIRROR_MAP,
} from './unified-types';
import { renderPixelPerfectRotation } from './engine/puppet-utils';
import { releaseCanvas } from './engine/canvas-pool';
import { sampleJointDiscColor, getPlugJointWidth } from './engine/render-helpers/puppet-joint-color';
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
import { applyPixelDeformAnimations } from './engine/render-helpers/pixel-deform-animations';
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
  computePhysicsOffset,
  renderEffectTrackFrame,
} from './engine/effect-render';
import { applyAutoMotionBlur, renderMotionBlurStroke, renderEffectStroke } from './engine/brush-render';
import { getAnimationFrameAndWeight, computeKeyframeBaseTransform } from './engine/animation-state';
import { computeGlobalModifierTransform } from './engine/animation-dispatch';
import { computeBoneTransforms, applyProceduralAnimations } from './engine/skeleton';
// Blueprint evaluation (path B: unified transform + pixel via blueprint)
import { evaluateBlueprint } from './blueprint/eval';
import { modifiersToBlueprint } from './blueprint/migrate';
import type { BlueprintGraph } from './blueprint/ir';
import { getKfByPart } from './engine/frame-cache';
import {
  resolvePartKeyframe,
  applyBoneDrivenTransforms,
  buildPartBoneBindingsMap,
  buildVariableContextForFrame,
} from './engine/part-bone-utils';
import type { VariableContext as EngineVariableContext } from './engine/param-driver';
import type {
  Part, PixelGrid, ModifierType, Keyframe, Skeleton, ProceduralAnimation,
  EffectTrack, MotionBlurStroke, EffectStroke, GlobalModifier,
  AnimationVariable as StoreAnimationVariable,
} from './types';
import {
  resolveNodeModifiers,
  computeAnimationModifierTransform,
  buildVariableContext,
  type ResolvedModifier,
  type VariableContext,
  getEmptyVariableContext,
} from './unified-animation-resolver';

// ---- World Transform Computation ----

/** Blueprint evaluation state (module-level, cleared on frame jumps) */
const blueprintNodeState = new Map<string, unknown>();
let blueprintLastFrame = -1;

/** Pre-computed blueprint transform result for a node */
export interface BlueprintTransformResult {
  translateX: number;
  translateY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
}

/**
 * Phase 0 (path B): Evaluate all node blueprints for transform values.
 * Two-pass for cross-node references (nodeOutputs). Mirrors puppet-keyframe-interpolation.
 */
function evaluateBlueprintTransforms(
  character: Character,
  frame: number,
  frameRate: number,
): Map<string, BlueprintTransformResult> {
  if (frame < blueprintLastFrame || frame > blueprintLastFrame + 5) {
    blueprintNodeState.clear();
  }
  blueprintLastFrame = frame;

  const result = new Map<string, BlueprintTransformResult>();
  const nodeOutputs = new Map<string, {
    rotation: number; translateX: number; translateY: number;
    scaleX: number; scaleY: number; skewX: number; skewY: number; zIndex: number;
  }>();

  for (let pass = 0; pass < 2; pass++) {
    for (const nodeId of Object.keys(character.nodes)) {
      const node = character.nodes[nodeId]!;
      const blueprint: BlueprintGraph | null =
        (node as any).blueprint ?? (node.modifiers?.length ? modifiersToBlueprint(node.modifiers as any) : null);
      if (!blueprint) continue;
      try {
        const t = evaluateBlueprint(blueprint, {
          frame,
          frameRate,
          vars: {},
          nodeOutputs: pass === 1 ? nodeOutputs : undefined,
          nodeState: blueprintNodeState,
        } as any);
        result.set(nodeId, {
          translateX: t.translateX,
          translateY: t.translateY,
          rotation: t.rotation,
          scaleX: t.scaleX,
          scaleY: t.scaleY,
          skewX: t.skewX,
          skewY: t.skewY,
        });
        if (pass === 0) {
          nodeOutputs.set(nodeId, {
            rotation: t.rotation,
            translateX: t.translateX,
            translateY: t.translateY,
            scaleX: t.scaleX,
            scaleY: t.scaleY,
            skewX: t.skewX,
            skewY: t.skewY,
            zIndex: (t as any).zIndex ?? 0,
          });
        }
      } catch {
        // Single node failure doesn't break the whole graph
      }
    }
  }
  return result;
}

/** Computed world transform for a node */
export interface WorldTransform {
  nodeId: string;
  worldX: SubPixel;        // World position X (sub-pixel)
  worldY: SubPixel;        // World position Y (sub-pixel)
  worldAngle: number;      // Accumulated rotation (degrees)
  worldStretch: number;    // Accumulated stretch factor
  variantIndex: DirectionIndex; // Current direction
  mirror: boolean;         // Whether this node is mirrored
  scaleX?: number;          // X-axis scale factor (blueprint t.scaleX, default 1)
  skewX?: number;          // Local skew X in degrees (blueprint/legacy skew modifier)
  skewY?: number;          // Local skew Y in degrees (blueprint/legacy skew modifier)
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
  blueprintTransforms?: Map<string, BlueprintTransformResult>,
): Map<string, WorldTransform> {
  const transforms = new Map<string, WorldTransform>();

  const rootNode = character.nodes[character.rootNodeId];
  if (!rootNode) return transforms;

  // Root node: center of canvas + node's own offset
  const rootInterpolated = interpolateTransform(rootNode, frame, frameRate, variableContext, blueprintTransforms);
  const rootWorld: WorldTransform = {
    nodeId: rootNode.id,
    worldX: halfPixelAlignSub(pxToSub(canvasWidth / 2) + rootInterpolated.x),
    worldY: halfPixelAlignSub(pxToSub(canvasHeight / 2) + rootInterpolated.y),
    worldAngle: rootInterpolated.angle,
    worldStretch: rootInterpolated.stretch,
    variantIndex: rootInterpolated.variantIndex,
    mirror: false,
    scaleX: rootInterpolated.scaleX,
    skewX: rootInterpolated.skewX,
    skewY: rootInterpolated.skewY,
  };
  transforms.set(rootNode.id, rootWorld);

  // Recursively compute children
  computeChildTransforms(rootNode, rootWorld, character, frame, transforms, frameRate, variableContext, blueprintTransforms);

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
  blueprintTransforms?: Map<string, BlueprintTransformResult>,
): void {
  for (const childId of parentNode.children) {
    const childNode = character.nodes[childId];
    if (!childNode) continue;

    const childInterpolated = interpolateTransform(childNode, frame, frameRate, variableContext, blueprintTransforms);
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
      scaleX: childInterpolated.scaleX,
      skewX: childInterpolated.skewX,
      skewY: childInterpolated.skewY,
    };
    transforms.set(childId, childWorld);

    // Recurse into children
    computeChildTransforms(childNode, childWorld, character, frame, transforms, frameRate, variableContext, blueprintTransforms);
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
  blueprintTransforms?: Map<string, BlueprintTransformResult>,
): NodeTransform {
  const base = node.transform;

  // Step 1: Keyframe-driven base transform
  const kfX = interpolateTrack(node.tracks.x, frame, base.x);
  const kfY = interpolateTrack(node.tracks.y, frame, base.y);
  const kfAngle = interpolateTrack(node.tracks.angle, frame, base.angle);
  const kfStretch = interpolateTrack(node.tracks.stretch, frame, base.stretch);
  const kfVariant = interpolateTrack(node.tracks.variantIndex, frame, base.variantIndex) as DirectionIndex;

  // Step 2 (path B): Blueprint-driven modifier contributions (preferred)
  const bpT = blueprintTransforms?.get(node.id);
  if (bpT) {
    return {
      x: kfX + pxToSub(bpT.translateX),
      y: kfY + pxToSub(bpT.translateY),
      angle: kfAngle + bpT.rotation,
      stretch: kfStretch * bpT.scaleY,
      scaleX: bpT.scaleX,
      skewX: bpT.skewX,
      skewY: bpT.skewY,
      variantIndex: kfVariant,
    };
  }

  // Step 2 (legacy fallback): Resolve animation modifiers via old resolver
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

  const rootTransform = worldTransforms.get(character.rootNodeId);
  const currentDirection = rootTransform?.variantIndex ?? 0;
  const latitude = character.latitude ?? 0;

  // 计算 worldY 范围，用于纬度归一化
  let minY = Infinity, maxY = -Infinity;
  for (const wt of worldTransforms.values()) {
    if (wt.worldY < minY) minY = wt.worldY;
    if (wt.worldY > maxY) maxY = wt.worldY;
  }
  const yRange = maxY - minY;

  // 方向：variantIndex 0=S, 1=SE, 2=E, 3=NE, 4=N, 5=NW, 6=W, 7=SW（按 directionToVariantIndex）
  const dirName = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'][currentDirection] ?? 'S';
  const facingE = dirName.includes('E');
  const facingW = dirName.includes('W');
  const facingS = dirName === 'S' || dirName === 'SE' || dirName === 'SW';
  const facingN = dirName === 'N' || dirName === 'NE' || dirName === 'NW';

  const computeDefaultZ = (node: Node, worldY: number): number => {
    let directionBias = 0;
    const side = node.side ?? 'C';
    const isCore = node.isCore ?? false;

    if (facingE) {
      if (side === 'L') directionBias = -0.1;
      else if (side === 'R') directionBias = 0.1;
    } else if (facingW) {
      if (side === 'L') directionBias = 0.1;
      else if (side === 'R') directionBias = -0.1;
    }
    // S/N：肢体 vs 身体
    if (facingS) {
      directionBias += isCore ? -0.2 : 0.2;
    } else if (facingN) {
      directionBias += isCore ? 0.2 : -0.2;
    }

    let latitudeBias = 0;
    if (latitude > 0 && yRange > 0) {
      const normalizedY = Math.max(0, Math.min(1, (worldY - minY) / yRange));
      // 俯视时 worldY 小的（头/上部）在上层
      latitudeBias = (0.5 - normalizedY) * 0.5 * (latitude / 90);
    }

    return 0.5 + directionBias + latitudeBias;
  };

  // Assign Z indices: sortKey = explicitZ * 1000 + defaultZ
  const assignZ = (nodeId: string) => {
    const node = character.nodes[nodeId];
    if (!node || !node.visible) return;

    const wt = worldTransforms.get(nodeId);
    const worldY = wt?.worldY ?? 0;
    const defaultZ = computeDefaultZ(node, worldY);
    const explicitZ = node.zIndex ?? 0;
    const sortKey = explicitZ * 1000 + defaultZ;
    nodeZ.set(nodeId, sortKey);

    // If this node has a generated disc, its Z goes BELOW both parent and child
    if (node.generated) {
      const ownZ = nodeZ.get(nodeId) ?? 0;
      const parentZ = node.parentId ? nodeZ.get(node.parentId) ?? ownZ : ownZ;
      discZ.set(`${nodeId}_disc`, Math.min(parentZ, ownZ) - 0.5);
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
 * Disc diameter = the joint opening width (plug-side), via getPlugJointWidth:
 *   plug.jointWidth (written at creation) > plug position → crossSectionTop/Bottom > 4.
 * No longer averaged with parent bottom (that made discs a ring too big at
 * non-bottom sockets like shoulders).
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

    // 关节盘直径 = plug 侧开口宽度（与 carve 同源，不再与 parent bottom 求平均）。
    // 优先用 attachment.jointWidth（创建时写入），否则按 plug 位置回退估算。
    const storedJointWidth = node.attachment?.jointWidth;
    let diameter: number;
    if (typeof storedJointWidth === 'number' && storedJointWidth > 0) {
      diameter = storedJointWidth;
    } else {
      const childPiece = node.costumePiece;
      const plugCS = childPiece?.crossSections.find(cs => cs.id === node.generated!.crossSectionId);
      const bottomCS = childPiece?.crossSections.find(cs => cs.id === 'bottom');
      diameter = getPlugJointWidth(
        {
          plug: node.attachment?.plug
            ? { localX: subToPx(node.attachment.plug.x), localY: subToPx(node.attachment.plug.y) }
            : null,
          crossSectionTop: plugCS?.diameter,
          crossSectionBottom: bottomCS?.diameter,
        },
        node.sprite
          ? {
              width: node.sprite.width,
              height: node.sprite.height,
              pivotX: subToPx(node.sprite.plug?.x ?? 0),
              pivotY: subToPx(node.sprite.plug?.y ?? 0),
            }
          : null,
      );
    }
    diameter = Math.max(1, diameter);

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

    // 关节盘颜色约定：plug.discColor 自定义 > 子节点精灵开口处众数颜色 > 旧 fallback。
    // 开口中心 = 精灵 pivot（sprite.plug）+ plug 本地坐标（attachment.plug）。
    const childPiece = node.costumePiece;
    let fillColor: string = childPiece?.fillColor ?? node.sprite?.data?.[0]?.[0] ?? '#808080';
    const customDiscColor = node.attachment?.discColor;
    if (typeof customDiscColor === 'string' && customDiscColor) {
      fillColor = customDiscColor;
    } else if (node.sprite?.data && node.sprite?.plug) {
      const pivotX = subToPx(node.sprite.plug.x);
      const pivotY = subToPx(node.sprite.plug.y);
      const plugLocalX = node.attachment?.plug ? subToPx(node.attachment.plug.x) : 0;
      const plugLocalY = node.attachment?.plug ? subToPx(node.attachment.plug.y) : 0;
      const sampled = sampleJointDiscColor(node.sprite.data, pivotX + plugLocalX, pivotY + plugLocalY);
      if (sampled) fillColor = sampled;
    }
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
  backgroundColor?: string,
  previewQuality?: 'low' | 'medium' | 'high',
  effectTracks?: any[],
  motionBlurStrokes?: any[],
  effectStrokes?: any[],
  autoMotionBlur?: boolean,
  autoMotionBlurIntensity?: number,
  proceduralAnimations?: any[],
): RenderPlan {
  // Build variable context for ParamDriver resolution
  // H6: 收集角色全部节点的 active param drivers，传入真实求值（之前恒为默认值）
  const allActiveDrivers: ParamDriver[] = [];
  if (animationVariables && animationVariables.length > 0) {
    for (const node of Object.values(character.nodes)) {
      for (const mod of node.modifiers ?? []) {
        for (const d of mod.paramDrivers ?? []) {
          if (d.enabled) allActiveDrivers.push(d);
        }
      }
    }
  }
  const variableContext = animationVariables && animationVariables.length > 0
    ? buildVariableContext(animationVariables, frame, allActiveDrivers)
    : undefined;

  // Phase 0 (path B): Evaluate node blueprints for transform values (two-pass)
  const blueprintTransforms = evaluateBlueprintTransforms(character, frame, frameRate);

  // Step 1: World transforms (includes blueprint-evaluated modifier contributions)
  const worldTransforms = computeWorldTransforms(
    character, frame, canvasWidth, canvasHeight, frameRate, variableContext, blueprintTransforms,
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

    // Apply procedural animations to node modifiers (migrated from old renderFrame)
    let nodeModifiers = node.modifiers;
    if (proceduralAnimations && proceduralAnimations.length > 0) {
      nodeModifiers = applyProceduralAnimations(
        node.modifiers as any ?? [],
        proceduralAnimations as any,
        '', frame, nodeId,
      ) as any;
    }

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
      modifiers: nodeModifiers,
      frame,
      frameRate,
      // t.scaleX 修复：蓝图 scaleX 独立 plumbing，不再平均吃掉
      scaleX: worldTf.scaleX,
      // 蓝图 skew：有倾斜量时才填，避免空数组污染
      skews: (worldTf.skewX || worldTf.skewY) ? [{ skewX: worldTf.skewX ?? 0, skewY: worldTf.skewY ?? 0 }] : undefined,
      // STEP2 合并：plumbing 蓝图给 renderNodeSprite，替代手拼像素链
      blueprint: (node as any).blueprint ?? (node.modifiers?.length ? modifiersToBlueprint(node.modifiers as any) : null),
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
    backgroundColor,
    previewQuality,
    effectTracks,
    motionBlurStrokes,
    effectStrokes,
    autoMotionBlur,
    autoMotionBlurIntensity,
    frame,
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
  // NOTE: 不再在此清画布。调用方负责 clear/fill 背景（renderUnifiedFrame 自己清；
  // unified-pipeline-bridge 的两处调用都是在 renderFrame 已画好非木偶部件之后叠加木偶，
  // 若在此 clear 会擦掉同一画布上已有的全部内容——见 F1）。

  for (const instruction of plan.sortedInstructions) {
    if ('nodeId' in instruction) {
      renderNodeSprite(ctx, instruction, canvasWidth, canvasHeight);
    } else {
      renderDisc(ctx, instruction);
    }
  }

  // Render effects (overlays, not tied to specific nodes)
  // These are canvas-level effects from the old renderFrame pipeline
  const currentFrame = plan.frame ?? 0;
  if (plan.effectTracks) {
    for (const effectTrack of plan.effectTracks) {
      if (!effectTrack.visible) continue;
      const kf = effectTrack.keyframes
        ?.filter((k: any) => k.frame <= currentFrame)
        ?.sort((a: any, b: any) => b.frame - a.frame)[0];
      if (!kf) continue;
      renderEffectTrackFrame(ctx, effectTrack, kf, currentFrame, canvasWidth, canvasHeight);
    }
  }

  // Render motion blur strokes for this frame
  if (plan.motionBlurStrokes) {
    for (const stroke of plan.motionBlurStrokes) {
      if ((stroke as any).frame === currentFrame) {
        renderMotionBlurStroke(ctx, stroke as any);
      }
    }
  }

  // Render effect strokes for this frame
  if (plan.effectStrokes) {
    for (const stroke of plan.effectStrokes) {
      if ((stroke as any).frame === currentFrame) {
        renderEffectStroke(ctx, stroke as any);
      }
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
  const { nodeId, sprite, worldX, worldY, angle, stretch, mirror, rotationStrategy, modifiers, frame, frameRate } = instruction;
  const scaleX = instruction.scaleX ?? 1;
  const skews = instruction.skews ?? [];
  const previewQuality = instruction.previewQuality ?? 'high';

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
    const modResult = applyPixelModifiers(sprite.data, resolvedMods as any, frame);
    effectivePixels = modResult.pixels;
    modOffsetX = modResult.offsetX;
    modOffsetY = modResult.offsetY;
  }

  // 像素形变走蓝图，不再此处直接调用 applyPixelDeformAnimations
  // （用户指令：extractPixelModifiers + applyPixelDeformAnimations 不用）

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
  // STEP 2: Apply pixel-deform via node's BLUEPRINT (unified graph)
  // Path B + STEP2 merge: use instruction.blueprint instead of hand-built graph.
  // The blueprint contains sprite_source -> pixel mods -> screen (from migrate.ts
  // or manual editor wiring). Transform nodes in the graph are re-evaluated
  // harmlessly; only pixels are consumed here.
  // ========================================================================
  const blueprint = (instruction as any).blueprint as BlueprintGraph | null | undefined;

  if (blueprint) {
    // Only evaluate if the blueprint has pixel-deform work to do.
    // (Pure transform blueprints skip pixel evaluation.)
    const hasPixelChain = blueprint.nodes.some(n =>
      n.type === 'sprite_source' || (n.inputs as any)?.pixels
    );
    if (hasPixelChain) {
      const bpCtx: any = {
        frame, frameRate, vars: {},
        spritePixels: effectivePixels,  // sprite_source 从这里取图
        // screen 为绘制终点：直接回调更新 effectivePixels
        drawToScreen: (cmd: { pixels: PixelGrid }) => {
          if (cmd.pixels) effectivePixels = cmd.pixels;
        },
      };
      try {
        evaluateBlueprint(blueprint, bpCtx);
      } catch {
        // Blueprint pixel evaluation failure: keep original pixels
      }
      // screen 已通过 drawToScreen 更新 effectivePixels，无需再读 renderCommands
    }
  } else {
    // Legacy fallback: no blueprint (should not happen for nodes with modifiers,
    // but preserved for safety). Uses manual graph construction.
    const activeDeformMods = modifiers.filter(m =>
      m.enabled && isPixelDeformModifier(m.type as ModifierType)
    );

    if (activeDeformMods.length > 0) {
      const { pixels: pixelsVal } = require('./blueprint/ir');

      // 构建蓝图图
      const bpNodes: any[] = [
        { id: 'bp_time', type: 'time', inputs: {}, params: {} },
        { id: 'bp_source', type: 'sprite_source', inputs: {}, params: {} },
      ];

      let prevPixelsNodeId = 'bp_source';
      for (const mod of activeDeformMods) {
        const nodeId = `bp_mod_${mod.id}`;
        bpNodes.push({
          id: nodeId,
          type: mod.type,
          inputs: {
            pixels: { nodeId: prevPixelsNodeId, output: 'pixels' },
            t: { nodeId: 'bp_time', output: 'out' },
          },
          params: mod.params ?? {},
        });
        prevPixelsNodeId = nodeId;
      }

      // 终点 screen 节点：接收最终像素 + 变换
      bpNodes.push({
        id: 'bp_screen',
        type: 'screen',
        inputs: {
          pixels: { nodeId: prevPixelsNodeId, output: 'pixels' },
          // 变换数值直接传字面量（worldX/worldY/angle 在指令里）
          translateX: { type: 'number', value: 0 },
          translateY: { type: 'number', value: 0 },
          rotation: { type: 'number', value: 0 },
          scaleX: { type: 'number', value: 1 },
          scaleY: { type: 'number', value: 1 },
        },
        params: {},
      });

      const bpGraph = { version: 1 as const, nodes: bpNodes, edges: [], outputId: 'bp_screen' };
      const bpCtx: any = {
        frame, frameRate, vars: {},
        spritePixels: effectivePixels,
        drawToScreen: (cmd: { pixels: PixelGrid }) => {
          if (cmd.pixels) effectivePixels = cmd.pixels;
        },
      };

      evaluateBlueprint(bpGraph, bpCtx);
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

  // STEP 4: Set up canvas transform for this sprite's world position
  // (translate + rotate + scale around pivot), then render effects + sprite
  // ========================================================================

  // Compute the draw position (where the pivot lands on canvas)
  const drawPivotX = subToPx(worldX);
  const drawPivotY = subToPx(worldY);

  // We need ctx.save/restore to isolate the transform for effect rendering
  ctx.save();

  // Apply the same transform chain as the old pipeline:
  // translate(worldPosition) → rotate(angle) → scale(scaleX, stretchY) → skew
  // Then draw at (-pivotX, -pivotY) so the pivot aligns with world position
  ctx.translate(Math.round(drawPivotX), Math.round(drawPivotY));
  ctx.rotate((angle * Math.PI) / 180);
  ctx.scale(scaleX, stretch);

  // Apply skews (matches old pipeline's renderPartToCanvas order: after scale)
  for (const { skewX, skewY } of skews) {
    ctx.transform(1, Math.tan((skewY * Math.PI) / 180), Math.tan((skewX * Math.PI) / 180), 1, 0, 0);
  }

  // ========================================================================
  // STEP 4a: Render "behind" effects (before the part itself)
  // glow, afterimage, motion_blur are drawn BEHIND the main sprite
  // This matches the old pipeline's renderPartToCanvas() behavior.
  // Preview quality: skip effect modifiers in low quality mode (old parity).
  // ========================================================================
  const behindEffectMods = previewQuality === 'low' ? [] : modifiers.filter(m =>
    m.enabled && ['glow', 'afterimage', 'motion_blur'].includes(m.type)
  );
  for (const mod of behindEffectMods) {
    switch (mod.type) {
      case 'glow':
        renderGlowEffect(ctx, mod as any, workingCanvas);
        break;
      case 'afterimage':
        renderAfterimageEffect(ctx, mod as any, modifiers as any, workingCanvas);
        break;
      case 'motion_blur':
        renderMotionBlurEffect(ctx, mod as any, modifiers as any, workingCanvas);
        break;
    }
  }

  // === Auto motion blur (old pipeline parity) ===
  // Rendered in the transformed space, after behind effects, before the sprite.
  if (
    instruction.autoMotionBlur &&
    instruction.autoMotionBlurKeyframes &&
    instruction.autoMotionBlurKeyframes.length > 0 &&
    instruction.autoMotionBlurPartId
  ) {
    applyAutoMotionBlur(
      ctx,
      instruction.autoMotionBlurPartId ?? instruction.nodeId,
      frame,
      instruction.autoMotionBlurKeyframes,
      instruction.autoMotionBlurIntensity ?? 0.5,
      workingCanvas,
      undefined,
    );
  }

  // ========================================================================
  // STEP 4b: Draw the main sprite
  // In the transformed coordinate space, the sprite's top-left is at (-pivotX, -pivotY)
  // ========================================================================
  ctx.imageSmoothingEnabled = false;

  // Pixel-perfect rotation only handles rotate + Y-stretch. Parts with X-scale
  // or skew fall back to the native canvas path (same as the old pipeline).
  const usePixelPerfect = rotationStrategy === 'pixel-perfect'
    && (angle !== 0 || stretch !== 1.0)
    && scaleX === 1
    && skews.length === 0;
  if (usePixelPerfect) {
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

    // NOTE: behind effects (glow/afterimage/motion_blur) + auto motion blur were
    // already rendered above in the transformed space before ctx.restore(),
    // so they are NOT repeated here (old code rendered them twice — fixed).

    ctx.drawImage(result.canvas, drawX, drawY);

    // H13: 释放 pixel-perfect 旋转产生的池化 canvas（缓存命中返回的也是调用方拥有的
    // 池化副本）。注意 angle=0&&stretch=1 时返回的是 workingCanvas 本身，不能释放。
    if (result.canvas !== workingCanvas) {
      releaseCanvas(result.canvas);
    }

    // Render "on top" effects after the sprite for pixel-perfect rotation path
    // Preview quality: skip particle effects in low quality mode (old parity).
    const topEffectMods = previewQuality === 'low' ? [] : modifiers.filter(m =>
      m.enabled && m.type === 'particle'
    );
    if (topEffectMods.length > 0) {
      ctx.save();
      ctx.translate(Math.round(drawPivotX), Math.round(drawPivotY));
      ctx.rotate((angle * Math.PI) / 180);
      ctx.scale(scaleX, stretch);
      for (const { skewX, skewY } of skews) {
        ctx.transform(1, Math.tan((skewY * Math.PI) / 180), Math.tan((skewX * Math.PI) / 180), 1, 0, 0);
      }
      for (const mod of topEffectMods) {
        renderParticleEffect(ctx, nodeId, sprite, mod as any, frame);
      }
      ctx.restore();
    }
  } else {
    // Native Canvas2D or no rotation: draw in the already-transformed space
    ctx.drawImage(workingCanvas, -pivotX, -pivotY);

    // ========================================================================
    // STEP 4c: Render "on top" effects (after the part itself)
    // particle effects are drawn ON TOP of the main sprite
    // Preview quality: skip particle effects in low quality mode (old parity).
    // ========================================================================
    const topEffectMods = previewQuality === 'low' ? [] : modifiers.filter(m =>
      m.enabled && m.type === 'particle'
    );
    for (const mod of topEffectMods) {
      renderParticleEffect(ctx, nodeId, sprite, mod as any, frame);
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
export function pixelsToCanvas(pixels: PixelGrid, width: number, height: number): HTMLCanvasElement | null {
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

// ---- Standalone Part Rendering (Unified) ----

/**
 * Modifier types consumed into the node transform (position/rotation/scale/skew).
 * These are NOT passed through to renderNodeSprite's modifier pipeline —
 * renderNodeSprite treats 'translate' as a pixel shift, so keeping them would
 * double-apply the transform. Matches old renderPartToCanvas() semantics where
 * computeKeyframeBaseTransform() extracts these before canvas drawing.
 */
const PART_TRANSFORM_MOD_TYPES = new Set<string>([
  'translate', 'rotate', 'uniform_scale', 'non_uniform_stretch', 'skew',
  'simple_physics', // consumed via computePhysicsOffset → position offset
]);

export interface PartsRenderOptions {
  skeletons?: Skeleton[];
  proceduralAnimations?: ProceduralAnimation[];
  animationVariables?: StoreAnimationVariable[];
  globalModifiers?: GlobalModifier[];
  effectTracks?: EffectTrack[];
  motionBlurStrokes?: MotionBlurStroke[];
  effectStrokes?: EffectStroke[];
  autoMotionBlur?: boolean;
  autoMotionBlurIntensity?: number;
  previewQuality?: 'low' | 'medium' | 'high';
  frameRate?: number;
}

/**
 * Render standalone (non-character) parts through the unified pipeline.
 * Migrated from old `renderFrame()` in render-pipeline.ts.
 *
 * For each part:
 * 1. Resolve the effective keyframe at `frame` (interpolation + param drivers
 *    + procedural animations) — reuses the old resolution logic verbatim.
 * 2. Apply bone-driven transforms (V2.0 skeletons).
 * 3. Extract the base transform (translate/rotate/scale/skew) into a
 *    NodeRenderInstruction; pixel/effect/deform modifiers stay on the node.
 * 4. correctionMask (manual pixel override) becomes the sprite's base pixels.
 *
 * Canvas-level effects (effect tracks, brush strokes) are rendered after parts,
 * matching the old pipeline order. Canvas modifiers and the global transform
 * stay with the caller (bridge), as before.
 */
export function renderPartsUnified(
  ctx: CanvasRenderingContext2D,
  parts: Part[],
  keyframes: Keyframe[],
  frame: number,
  canvasWidth: number,
  canvasHeight: number,
  backgroundColor: string,
  options: PartsRenderOptions = {},
): void {
  const {
    skeletons,
    proceduralAnimations,
    animationVariables,
    globalModifiers,
    effectTracks,
    motionBlurStrokes,
    effectStrokes,
    autoMotionBlur = false,
    autoMotionBlurIntensity = 0.5,
    previewQuality = 'high',
    frameRate = 12,
  } = options;

  // Clear canvas (skip if transparent - used for reference image background)
  if (backgroundColor !== 'transparent') {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  // V12: Apply global modifier transform (camera/world) around parts + effects.
  // Matches old renderFrame(): the transform wraps everything except canvas
  // modifiers (which the caller applies after).
  const hasGlobalTransform = applyPartsGlobalTransform(
    ctx, canvasWidth, canvasHeight, globalModifiers, frame, frameRate,
  );

  // M8: Build variable context for the current frame
  const variableContext: EngineVariableContext = buildVariableContextForFrame(keyframes, animationVariables, frame);

  // V2.0: Compute bone transforms for all skeletons
  const boneTransforms = new Map<string, Map<string, { rotation: number; headX: number; headY: number; tailX: number; tailY: number }>>();
  if (skeletons) {
    for (const skeleton of skeletons) {
      boneTransforms.set(skeleton.id, computeBoneTransforms(skeleton, frame));
    }
  }

  // V2.0: Build part-to-bone binding lookup from skeletons
  const partBoneBindings = buildPartBoneBindingsMap(skeletons);

  // B3: Use cached kfByPart index
  const kfByPart = getKfByPart(keyframes);

  // Build one render instruction per part
  const instructions: NodeRenderInstruction[] = [];
  for (const part of parts) {
    // Part 是纯精灵数据，恒可见
    // Resolve the effective keyframe for this part (old logic, verbatim)
    let renderKf = resolvePartKeyframe(part, kfByPart, frame, variableContext, keyframes, proceduralAnimations);

    // Apply bone-driven transforms
    if (renderKf) {
      renderKf = applyBoneDrivenTransforms(renderKf, part.id, partBoneBindings, boneTransforms);
    }

    const allModifiers = renderKf && !renderKf.isBaked ? renderKf.modifiers : [];
    // Skip collapsed modifiers — their effect is already baked into correctionMask
    const modifiers = allModifiers.filter(m => !m.collapsed);

    // Compute physics offset before canvas transforms
    const physicsOffset = computePhysicsOffset(modifiers, frame);

    // V3.1: keyframe base transform (non-animation modifiers only)
    const kfBase = computeKeyframeBaseTransform(modifiers);

    // Split: transform modifiers are consumed into the instruction transform.
    // Everything else (pixel/effect/deform) stays for renderNodeSprite.
    const nodeMods = modifiers.filter(m => !PART_TRANSFORM_MOD_TYPES.has(m.type));

    // Sprite base pixels: correctionMask (manual frame) overrides part.pixels
    const basePixels = renderKf?.correctionMask ?? part.pixels;
    const spriteWidth = renderKf?.overrideWidth ?? part.width;
    const spriteHeight = renderKf?.overrideHeight ?? part.height;
    const pivotX = renderKf?.overridePivotX ?? part.pivotX;
    const pivotY = renderKf?.overridePivotY ?? part.pivotY;

    instructions.push({
      nodeId: part.id,
      sprite: {
        width: spriteWidth,
        height: spriteHeight,
        data: basePixels,
        // Preserve Part's pivot semantics: pivot = anchor point relative to
        // sprite top-left; worldX/Y = where the pivot lands on canvas.
        plug: { x: pxToSub(pivotX), y: pxToSub(pivotY) },
      },
      // Old pipeline drew parts at canvas center + keyframe offset.
      worldX: halfPixelAlignSub(pxToSub(canvasWidth / 2 + kfBase.translateX + physicsOffset.x)),
      worldY: halfPixelAlignSub(pxToSub(canvasHeight / 2 + kfBase.translateY + physicsOffset.y)),
      angle: kfBase.rotation,
      scaleX: kfBase.scaleX,
      stretch: kfBase.scaleY,
      skews: kfBase.skews,
      variantIndex: 0,
      rotationStrategy: 'pixel-perfect',
      mirror: false,
      // Parts render in array order (old pipeline's z-sort is disabled);
      // stable sort below preserves insertion order for equal zIndex.
      zIndex: 0,
      drawLayer: 'default',
      // Boundary cast: old ModifierInstance → unified ModifierInstance
      // (structurally compatible; same pattern as renderNodeSprite's oldFormatMods).
      modifiers: nodeMods as any,
      frame,
      frameRate,
      previewQuality,
      autoMotionBlur,
      autoMotionBlurIntensity,
      autoMotionBlurPartId: part.id,
      autoMotionBlurKeyframes: keyframes,
    });
  }

  // Execute through the unified plan executor
  const plan: RenderPlan = {
    nodeInstructions: instructions,
    discInstructions: [],
    sortedInstructions: [...instructions].sort((a, b) => a.zIndex - b.zIndex),
    backgroundColor,
    previewQuality,
  };
  executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);

  // Render effect tracks, motion blur strokes, effect strokes (old order)
  if (effectTracks) {
    for (const effectTrack of effectTracks) {
      if (!effectTrack.visible) continue;
      // Find the keyframe at or before the current frame
      const kf = effectTrack.keyframes
        .filter((k) => k.frame <= frame)
        .sort((a, b) => b.frame - a.frame)[0];
      if (!kf) continue;
      renderEffectTrackFrame(ctx, effectTrack, kf, frame, canvasWidth, canvasHeight);
    }
  }

  if (motionBlurStrokes) {
    for (const stroke of motionBlurStrokes) {
      if (stroke.frame === frame) {
        renderMotionBlurStroke(ctx, stroke);
      }
    }
  }

  if (effectStrokes) {
    for (const stroke of effectStrokes) {
      if (stroke.frame === frame) {
        renderEffectStroke(ctx, stroke);
      }
    }
  }

  // V12: Restore the global modifier transform
  if (hasGlobalTransform) {
    ctx.restore();
  }
}

/**
 * Apply the global modifier transform (camera/world) to the canvas.
 * Matches old renderFrame()'s applyGlobalTransform: translate(canvas center)
 * → translate → rotate → scale → translate(-center).
 * Returns whether a transform was applied (caller must ctx.restore()).
 */
function applyPartsGlobalTransform(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  globalModifiers: GlobalModifier[] | undefined,
  frame: number,
  frameRate: number,
): boolean {
  let globalTransform = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  if (globalModifiers && globalModifiers.length > 0) {
    globalTransform = computeGlobalModifierTransform(globalModifiers, frame, frameRate);
  }
  const has = globalTransform.translateX !== 0 || globalTransform.translateY !== 0 ||
    globalTransform.rotation !== 0 || globalTransform.scaleX !== 1 || globalTransform.scaleY !== 1;
  if (has) {
    ctx.save();
    ctx.translate(canvasWidth / 2, canvasHeight / 2);
    ctx.translate(globalTransform.translateX, globalTransform.translateY);
    ctx.rotate((globalTransform.rotation * Math.PI) / 180);
    ctx.scale(globalTransform.scaleX, globalTransform.scaleY);
    ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
  }
  return has;
}
