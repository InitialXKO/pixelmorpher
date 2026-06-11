// ============================================================
// PixelMorpher - Puppet Rendering Pipeline
// Latitude-based Y offset, half-pixel alignment, 4x upscale rotation,
// puppet node world transforms, joint disc generation, Z-channel occlusion,
// puppet frame rendering, sprite resolution with mirror fallback
// ============================================================

import type {
  Part,
  Keyframe,
  PixelGrid,
  PuppetNode,
  PuppetSkeleton,
  PuppetCharacter,
  PuppetDirection,
  PuppetNodeKeyframe,
  CostumeSet,
  JointDiscRenderData,
  AnimationClip,
  GlobalModifier,
  AnimationVariable,
  ParamDriver,
} from '../types';
import { PUPPET_DIRECTIONS, DIRECTION_MIRROR } from '../types';
import { hexToRgbCached } from './color-utils';
import { acquireCanvas, releaseCanvas } from './canvas-pool';
import { getRotationCacheKey, getCachedRotation, setCachedRotation } from './render-cache';
import { applyPixelModifiers, isPixelDeformModifier, padPixelGrid, trimTransparentEdges, computeTotalAnimPadding } from './pixel-modifiers';
import { getAnimationFrameAndWeight } from './animation-state';
import { resolveAnimModifierParams, resolveKeyframeModifierParams } from './param-driver';
import {
  applyTextureScroll, applyWaveDeform, applyContourScroll, applyRevealHide,
  applyShatterDissolve, applyAnnihilate, applyTeleport, applyCrtOff,
  applyBend, applyEllipticalCompress, applyDumbbellStretch, applyPillowStretch,
  applyHyperbolicStretch, applyRingRipple,
} from './modifier-renderers';
import { computeGlobalModifierTransform } from './animation-dispatch';
import { buildVariableContext, EMPTY_VARIABLE_CONTEXT, VariableContext } from './param-driver';
import { applyCanvasModifiers } from './canvas-modifiers';
import { applyProceduralAnimations } from './skeleton';
import { interpolateModifiers } from './interpolation';

// ============================================================
// Latitude Y Offset
// ============================================================

/**
 * Compute the negative Y offset for deeper nodes at higher latitudes.
 * This moves child nodes upward when the viewing angle is from above,
 * creating a pseudo-3D depth effect.
 *
 * IMPORTANT: Latitude does NOT cause sprite foreshortening — only Y position
 * offsets and draw order changes.
 *
 * @param latitude Viewing latitude in degrees (0=front, 90=top)
 * @param depth Depth of this node in the skeleton hierarchy (0=root)
 * @returns Negative Y offset in pixels (0 if latitude<=0 or depth<=0)
 */
function computeLatitudeYOffset(latitude: number, depth: number): number {
  if (latitude <= 0 || depth <= 0) return 0;
  // Clamp latitude to [0, 90]
  const clampedLat = Math.min(90, Math.max(0, latitude));
  return -(clampedLat * depth * 0.8);
}

/**
 * Compute sort bias for occlusion based on latitude and worldY position.
 * At higher latitudes, nodes with higher worldY (lower on screen) should
 * be drawn later (on top) to simulate looking from above.
 *
 * @param latitude Viewing latitude in degrees (0=front, 90=top)
 * @param worldY World Y position of the node
 * @param minY Minimum Y in the scene (for normalization)
 * @param maxY Maximum Y in the scene (for normalization)
 * @returns Sort bias value (negative = drawn earlier, positive = drawn later)
 */
function computeLatitudeWorldYBias(
  latitude: number,
  worldY: number,
  minY: number,
  maxY: number,
): number {
  if (latitude <= 0) return 0;
  const range = maxY - minY;
  if (range <= 0) return 0;
  const normalizedY = Math.max(0, Math.min(1, (worldY - minY) / range));
  return -(latitude / 90) * normalizedY * 500;
}

/**
 * Deprecated: use computeLatitudeWorldYBias instead.
 * Compute sort bias based on latitude and depth.
 */
function computeLatitudeDepthBias(latitude: number, depth: number): number {
  if (latitude <= 0 || depth <= 0) return 0;
  return -(latitude / 90) * depth * 50;
}

// ============================================================
// Half-Pixel Alignment
// ============================================================

/**
 * Apply half-pixel alignment to ensure crisp pixel rendering.
 * Snaps to half-pixel boundaries: n + 0.5
 *
 * @param x X coordinate
 * @param y Y coordinate
 * @returns Aligned coordinates snapped to half-pixel grid
 */
function applyHalfPixelAlignment(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(x) + 0.5,
    y: Math.round(y) + 0.5,
  };
}

// ============================================================
// Pixel-Perfect Rotation (4x Upscale + Nearest Neighbor)
// ============================================================

/** Result of pixel-perfect rotation: the rotated canvas and the pivot position within it.
 *  After rotation, the bounding box expands, so the pivot shifts from its original
 *  (pivotX, pivotY) to a new position in the output canvas. Callers MUST use
 *  resultPivotX / resultPivotY (not the original pivotX / pivotY) to position the
 *  rotated canvas on screen.
 */
export interface PixelPerfectRotationResult {
  canvas: HTMLCanvasElement;
  /** Pivot X position in the rotated output canvas (in native pixels) */
  resultPivotX: number;
  /** Pivot Y position in the rotated output canvas (in native pixels) */
  resultPivotY: number;
}

/**
 * Render a sprite with pixel-perfect rotation using 4x upscale and
 * nearest-neighbor downsampling.
 *
 * Algorithm:
 * 1. Create a 4x upscaled canvas
 * 2. Apply stretchY to the sprite on the upscaled canvas
 * 3. Calculate bounding box after rotation
 * 4. Rotate on the upscaled canvas
 * 5. Downsample back to native resolution with nearest-neighbor sampling
 *
 * IMPORTANT: After rotation, the pivot position in the output canvas changes
 * because the bounding box expands. The returned `resultPivotX` / `resultPivotY`
 * reflect the correct pivot position in the output canvas. Callers MUST use these
 * values (not the original pivotX/pivotY) when positioning the rotated canvas.
 *
 * @param spriteCanvas The source sprite canvas
 * @param angle Rotation angle in degrees
 * @param stretchY Vertical stretch factor (1 = no stretch)
 * @param pivotX Pivot X in sprite coordinates
 * @param pivotY Pivot Y in sprite coordinates
 * @returns Rotated sprite canvas with updated pivot position
 */
export function renderPixelPerfectRotation(
  spriteCanvas: HTMLCanvasElement,
  angle: number,
  stretchY: number = 1,
  pivotX: number = 0,
  pivotY: number = 0,
): PixelPerfectRotationResult {
  // No rotation needed — pivot stays unchanged
  if (angle === 0 && stretchY === 1) {
    return { canvas: spriteCanvas, resultPivotX: pivotX, resultPivotY: pivotY };
  }

  const sw = spriteCanvas.width;
  const sh = spriteCanvas.height;

  // Guard: zero-sized source canvas or zero stretch would produce invalid canvases
  if (sw <= 0 || sh <= 0 || stretchY <= 0) {
    return { canvas: spriteCanvas, resultPivotX: pivotX, resultPivotY: pivotY };
  }

  // ---- Cache lookup ----
  const cacheKey = getRotationCacheKey(spriteCanvas, angle, stretchY, pivotX, pivotY);
  const cached = getCachedRotation(cacheKey);
  if (cached) {
    return {
      canvas: cached.canvas,
      resultPivotX: cached.resultPivotX,
      resultPivotY: cached.resultPivotY,
    };
  }

  const UPSCALE = 4;

  // Step 1: Create 4x upscaled canvas with stretch applied
  const upW = Math.ceil(sw * UPSCALE);
  const upH = Math.ceil(sh * UPSCALE * stretchY);

  // Guard: computed dimensions must be > 0
  if (upW <= 0 || upH <= 0) {
    return { canvas: spriteCanvas, resultPivotX: pivotX, resultPivotY: pivotY };
  }
  const upCanvas = acquireCanvas(upW, upH);
  const upCtx = upCanvas.getContext('2d')!;
  upCtx.clearRect(0, 0, upW, upH);
  upCtx.imageSmoothingEnabled = false;

  // Draw sprite upscaled with stretchY
  upCtx.drawImage(spriteCanvas, 0, 0, sw, sh, 0, 0, sw * UPSCALE, sh * UPSCALE * stretchY);

  // If no rotation (stretch only), pivot position is preserved
  if (angle === 0) {
    const result = downsample4x(upCanvas, sw, sh);
    releaseCanvas(upCanvas);
    // Store in cache
    setCachedRotation(cacheKey, { canvas: result, resultPivotX: pivotX, resultPivotY: pivotY });
    return { canvas: result, resultPivotX: pivotX, resultPivotY: pivotY };
  }

  // Step 2: Calculate bounding box after rotation on the upscaled canvas
  const pivotUpX = pivotX * UPSCALE;
  const pivotUpY = pivotY * UPSCALE * stretchY;
  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  // Compute rotated corners
  const corners = [
    { x: 0, y: 0 },
    { x: upW, y: 0 },
    { x: 0, y: upH },
    { x: upW, y: upH },
  ];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of corners) {
    const dx = c.x - pivotUpX;
    const dy = c.y - pivotUpY;
    const rx = dx * cosA - dy * sinA + pivotUpX;
    const ry = dx * sinA + dy * cosA + pivotUpY;
    minX = Math.min(minX, rx);
    minY = Math.min(minY, ry);
    maxX = Math.max(maxX, rx);
    maxY = Math.max(maxY, ry);
  }

  const rotW = Math.ceil(maxX - minX);
  const rotH = Math.ceil(maxY - minY);

  // Guard: degenerate rotation producing zero-sized bounding box
  if (rotW <= 0 || rotH <= 0) {
    releaseCanvas(upCanvas);
    return { canvas: spriteCanvas, resultPivotX: pivotX, resultPivotY: pivotY };
  }

  // Compute the pivot position in the rotated upscaled canvas.
  // The rotation keeps the pivot at (pivotUpX, pivotUpY), but the canvas is
  // then shifted by (-minX, -minY), so the pivot moves to:
  //   (pivotUpX - minX, pivotUpY - minY) in the rotated upscaled canvas.
  // After downsample by UPSCALE, the pivot in the native-resolution result is:
  //   ((pivotUpX - minX) / UPSCALE, (pivotUpY - minY) / UPSCALE)
  const resultPivotX = (pivotUpX - minX) / UPSCALE;
  const resultPivotY = (pivotUpY - minY) / UPSCALE;

  // Step 3: Create rotated upscaled canvas
  const rotCanvas = acquireCanvas(rotW, rotH);
  const rotCtx = rotCanvas.getContext('2d')!;
  rotCtx.clearRect(0, 0, rotW, rotH);
  rotCtx.imageSmoothingEnabled = false;
  rotCtx.translate(-minX, -minY);
  rotCtx.translate(pivotUpX, pivotUpY);
  rotCtx.rotate(rad);
  rotCtx.translate(-pivotUpX, -pivotUpY);
  rotCtx.drawImage(upCanvas, 0, 0);
  releaseCanvas(upCanvas);

  // Step 4: Downsample back to native resolution with nearest-neighbor
  const nativeW = Math.ceil(rotW / UPSCALE);
  const nativeH = Math.ceil(rotH / UPSCALE);
  const result = downsample4x(rotCanvas, nativeW, nativeH);
  releaseCanvas(rotCanvas);

  // Store in cache
  setCachedRotation(cacheKey, { canvas: result, resultPivotX, resultPivotY });
  return { canvas: result, resultPivotX, resultPivotY };
}

/**
 * Downsample a 4x upscaled canvas back to native resolution using
 * nearest-neighbor sampling (take the center pixel of each 4x4 block).
 */
function downsample4x(
  srcCanvas: HTMLCanvasElement,
  targetW: number,
  targetH: number,
): HTMLCanvasElement {
  // Guard: zero-sized canvases cannot be used with drawImage
  if (targetW <= 0 || targetH <= 0 || srcCanvas.width <= 0 || srcCanvas.height <= 0) {
    const fallback = acquireCanvas(Math.max(1, targetW), Math.max(1, targetH));
    const fallbackCtx = fallback.getContext('2d')!;
    fallbackCtx.clearRect(0, 0, Math.max(1, targetW), Math.max(1, targetH));
    return fallback;
  }
  const result = acquireCanvas(targetW, targetH);
  const ctx = result.getContext('2d')!;
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, 0, 0, targetW, targetH);
  return result;
}

// ============================================================
// Puppet Node World Transforms
// ============================================================

/** World transform data for a single puppet node */
export interface PuppetNodeWorldTransform {
  nodeId: string;
  /** World position X (including all parent transforms) */
  worldX: number;
  /** World position Y (including all parent transforms) */
  worldY: number;
  /** World rotation angle in degrees (accumulated from all parents) */
  worldAngle: number;
  /** Local stretchY factor (from keyframes) */
  stretchY: number;
  /** Depth in the skeleton hierarchy (0 = root) */
  depth: number;
  /** The node itself */
  node: PuppetNode;
  /** Computed direction at this frame */
  direction: PuppetDirection;
}

/**
 * Compute world transforms for all nodes in a puppet skeleton.
 *
 * For each node, recursively computes:
 * 1. Interpolate keyframe values (HOLD for angle/direction, LERP for stretch/offset)
 * 2. Apply stretch to local Y
 * 3. Rotate local offset by parent's world angle
 * 4. Apply latitude Y offset
 * 5. Snap to integer pixels
 * 6. Recurse for children at socket positions
 *
 * Transform order: stretch → rotate → translate (NOT translate→rotate→scale)
 *
 * @param skeleton The puppet skeleton
 * @param nodeKeyframes Per-node keyframes for this clip
 * @param currentFrame Current animation frame
 * @param latitude Viewing latitude (0=front, 90=top)
 * @returns Array of world transforms for all nodes
 */
function computePuppetNodeWorldTransforms(
  skeleton: PuppetSkeleton,
  nodeKeyframes: PuppetNodeKeyframe[],
  currentFrame: number,
  latitude: number = 0,
): PuppetNodeWorldTransform[] {
  const result: PuppetNodeWorldTransform[] = [];

  // Build node lookup and parent→children map
  const nodeMap = new Map<string, PuppetNode>();
  for (const node of skeleton.nodes) {
    nodeMap.set(node.id, node);
  }

  // Build keyframe index by nodeId
  const kfByNode = new Map<string, PuppetNodeKeyframe[]>();
  for (const kf of nodeKeyframes) {
    const arr = kfByNode.get(kf.nodeId) || [];
    arr.push(kf);
    kfByNode.set(kf.nodeId, arr);
  }

  // Find root node (node with plug === null)
  const rootNode = skeleton.nodes.find(n => n.plug === null);
  if (!rootNode) return result;

  // Recursive computation
  function computeNode(
    node: PuppetNode,
    parentWorldX: number,
    parentWorldY: number,
    parentWorldAngle: number,
    parentSocketLocalX: number,
    parentSocketLocalY: number,
    depth: number,
  ): void {
    // Get keyframes for this node
    const nodeKfs = kfByNode.get(node.id) || [];

    // Interpolate keyframe values (use skeleton.currentDirection as fallback)
    const interpolated = interpolateNodeKeyframes(node, nodeKfs, currentFrame, skeleton.currentDirection);

    // Local offset from the connection point
    let localX = interpolated.offsetX;
    let localY = interpolated.offsetY;

    // Apply stretch to local Y
    localY *= interpolated.stretchY;

    // Rotate local offset by parent's world angle
    const parentAngleRad = (parentWorldAngle * Math.PI) / 180;
    const rotatedX = localX * Math.cos(parentAngleRad) - localY * Math.sin(parentAngleRad);
    const rotatedY = localX * Math.sin(parentAngleRad) + localY * Math.cos(parentAngleRad);

    // Compute world position: parent position + socket offset + rotated local offset
    let worldX = parentWorldX + parentSocketLocalX + rotatedX;
    let worldY = parentWorldY + parentSocketLocalY + rotatedY;

    // Apply latitude Y offset
    const latOffset = computeLatitudeYOffset(latitude, depth);
    worldY += latOffset;

    // Snap to integer pixels
    worldX = Math.round(worldX);
    worldY = Math.round(worldY);

    // World angle = parent angle + local angle
    const worldAngle = parentWorldAngle + interpolated.angle;

    const transform: PuppetNodeWorldTransform = {
      nodeId: node.id,
      worldX,
      worldY,
      worldAngle,
      stretchY: interpolated.stretchY,
      depth,
      node,
      direction: interpolated.direction,
    };
    result.push(transform);

    // Recurse for children: find nodes whose plug.socketId matches this node's sockets
    for (const socket of node.sockets) {
      for (const childNode of skeleton.nodes) {
        if (childNode.plug && childNode.plug.socketId === socket.id) {
          // Child's connection point is at the socket position, rotated by this node's world angle
          const socketRad = (worldAngle * Math.PI) / 180;
          const childOffsetX = socket.localX * Math.cos(socketRad) - socket.localY * Math.sin(socketRad);
          const childOffsetY = socket.localX * Math.sin(socketRad) + socket.localY * Math.cos(socketRad);

          computeNode(
            childNode,
            worldX,
            worldY,
            worldAngle,
            childOffsetX - (childNode.plug?.localX || 0),
            childOffsetY - (childNode.plug?.localY || 0),
            depth + 1,
          );
        }
      }
    }
  }

  // Start from root
  computeNode(rootNode, 0, 0, 0, 0, 0, 0);

  return result;
}

/**
 * Interpolate keyframe values for a puppet node.
 * - Angle: HOLD (step) interpolation
 * - Direction: HOLD (step) interpolation
 * - Stretch: LERP interpolation
 * - Offset: LERP interpolation
 */
function interpolateNodeKeyframes(
  node: PuppetNode,
  keyframes: PuppetNodeKeyframe[],
  currentFrame: number,
  fallbackDirection: PuppetDirection = 'S',
): {
  angle: number;
  stretchY: number;
  offsetX: number;
  offsetY: number;
  direction: PuppetDirection;
} {
  if (keyframes.length === 0) {
    return {
      angle: node.angle,
      stretchY: node.stretch,
      offsetX: node.offsetX,
      offsetY: node.offsetY,
      direction: fallbackDirection,
    };
  }

  // Sort by frame
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);

  // Find surrounding keyframes
  let prevKf: PuppetNodeKeyframe | null = null;
  let nextKf: PuppetNodeKeyframe | null = null;
  for (const kf of sorted) {
    if (kf.frame <= currentFrame) prevKf = kf;
    if (kf.frame > currentFrame && !nextKf) nextKf = kf;
  }

  // If at or after last keyframe, hold
  if (prevKf && !nextKf) {
    return {
      angle: prevKf.angle ?? node.angle,
      stretchY: prevKf.stretch ?? node.stretch,
      offsetX: prevKf.offsetX ?? node.offsetX,
      offsetY: prevKf.offsetY ?? node.offsetY,
      direction: prevKf.direction ?? fallbackDirection,
    };
  }

  // If before first keyframe, use node defaults
  if (!prevKf) {
    return {
      angle: node.angle,
      stretchY: node.stretch,
      offsetX: node.offsetX,
      offsetY: node.offsetY,
      direction: fallbackDirection,
    };
  }

  // Interpolate between prev and next
  const t = (currentFrame - prevKf.frame) / (nextKf!.frame - prevKf.frame);

  // HOLD (step) for angle and direction
  const angle = prevKf.angle ?? node.angle;
  const direction = prevKf.direction ?? fallbackDirection;

  // LERP for stretch and offset
  const prevStretch = prevKf.stretch ?? node.stretch;
  const nextStretch = nextKf!.stretch ?? prevStretch;
  const stretchY = prevStretch + (nextStretch - prevStretch) * t;

  const prevOffX = prevKf.offsetX ?? node.offsetX;
  const nextOffX = nextKf!.offsetX ?? prevOffX;
  const offsetX = prevOffX + (nextOffX - prevOffX) * t;

  const prevOffY = prevKf.offsetY ?? node.offsetY;
  const nextOffY = nextKf!.offsetY ?? prevOffY;
  const offsetY = prevOffY + (nextOffY - prevOffY) * t;

  return { angle, stretchY, offsetX, offsetY, direction };
}

// ============================================================
// Joint Disc Generation
// ============================================================

/**
 * Generate joint disc render data for all parent-child connections
 * in the skeleton.
 *
 * @param worldTransforms World transforms for all nodes
 * @param skeleton The puppet skeleton
 * @param latitude Viewing latitude (affects disc Y scaling)
 * @returns Array of joint disc render data
 */
function generateJointDiscs(
  worldTransforms: PuppetNodeWorldTransform[],
  skeleton: PuppetSkeleton,
  latitude: number = 0,
): JointDiscRenderData[] {
  const discs: JointDiscRenderData[] = [];
  const transformMap = new Map<string, PuppetNodeWorldTransform>();
  for (const wt of worldTransforms) {
    transformMap.set(wt.nodeId, wt);
  }

  for (const node of skeleton.nodes) {
    if (!node.plug) continue;

    const childTransform = transformMap.get(node.id);
    if (!childTransform) continue;

    // Find parent node (the node whose socket this plug connects to)
    const parentNode = skeleton.nodes.find(n =>
      n.sockets.some(s => s.id === node.plug!.socketId)
    );
    if (!parentNode) continue;

    const parentTransform = transformMap.get(parentNode.id);
    if (!parentTransform) continue;

    // Find the socket position on the parent
    const socket = parentNode.sockets.find(s => s.id === node.plug!.socketId);
    if (!socket) continue;

    // Compute socket world position
    const parentAngleRad = (parentTransform.worldAngle * Math.PI) / 180;
    const socketWorldX = parentTransform.worldX +
      socket.localX * Math.cos(parentAngleRad) - socket.localY * Math.sin(parentAngleRad);
    const socketWorldY = parentTransform.worldY +
      socket.localX * Math.sin(parentAngleRad) + socket.localY * Math.cos(parentAngleRad);

    // Joint disc diameter: average of parent's bottom cross-section and child's top
    const diameter = Math.max(1, (parentNode.crossSectionBottom + node.crossSectionTop) / 2);

    // Z-index: average of parent and child z-index
    const z = (parentNode.zIndex + node.zIndex) / 2;

    discs.push({
      x: socketWorldX,
      y: socketWorldY,
      diameter,
      z,
      color: node.color || parentNode.color || '#888888',
      parentNodeId: parentNode.id,
      childNodeId: node.id,
    });
  }

  return discs;
}

/**
 * Render a single joint disc on the canvas context.
 *
 * @param ctx Canvas rendering context
 * @param disc Joint disc render data
 * @param canvasOffsetX Canvas X offset for centering
 * @param canvasOffsetY Canvas Y offset for centering
 * @param latitudeScaleY Y scaling factor based on latitude (for ellipse rendering)
 */
function renderJointDisc(
  ctx: CanvasRenderingContext2D,
  disc: JointDiscRenderData,
  canvasOffsetX: number,
  canvasOffsetY: number,
  latitudeScaleY: number = 1,
): void {
  const cx = disc.x + canvasOffsetX;
  const cy = disc.y + canvasOffsetY;
  const rx = disc.diameter / 2;
  const ry = (disc.diameter / 2) * latitudeScaleY;

  ctx.save();
  ctx.fillStyle = disc.color;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ============================================================
// Puppet Node Sprite Resolution
// ============================================================

/**
 * Resolve the sprite (Part) for a puppet node, considering:
 * 1. Direction-specific sprite override
 * 2. Active CostumeSet override
 * 3. Default spritePartId
 * 4. Mirror fallback from opposite direction
 *
 * @param node The puppet node
 * @param direction Current viewing direction
 * @param activeCostumeSet The active costume set (if any)
 * @param parts All available parts
 * @returns The resolved Part, or null if not found
 */
export function resolvePuppetNodeSprite(
  node: PuppetNode,
  direction: PuppetDirection,
  activeCostumeSet: CostumeSet | null,
  parts: Part[],
): Part | null {
  let partId: string | null = null;

  // Step 1: Check costume set override
  if (activeCostumeSet) {
    const costumeKey = `${node.id}:${direction}`;
    partId = activeCostumeSet.spriteMap[costumeKey] ?? null;
    if (!partId) {
      // Try default direction key
      const defaultKey = `${node.id}:default`;
      partId = activeCostumeSet.spriteMap[defaultKey] ?? null;
    }
  }

  // Step 2: Check direction-specific sprite override
  if (!partId && node.directionSprites) {
    partId = node.directionSprites[direction] ?? null;

    // Step 3: Mirror fallback
    if (!partId && node.mirrorFrom) {
      const mirrorDir = DIRECTION_MIRROR[direction];
      if (mirrorDir !== direction) {
        partId = node.directionSprites[mirrorDir] ?? null;
      }
    }
  }

  // Step 4: Fall back to default sprite
  if (!partId) {
    partId = node.spritePartId;
  }

  if (!partId) return null;

  return parts.find(p => p.id === partId) ?? null;
}

/**
 * Check if a direction should be mirrored for a given node.
 *
 * Mirror logic:
 * 1. mirrorFrom must be true (left-side limbs that should mirror the right side)
 * 2. If directionSprites has an explicit entry for this direction, no mirror needed
 *    (the user provided a dedicated sprite for this direction)
 * 3. Otherwise, mirror — flip the resolved sprite horizontally
 *
 * IMPORTANT DESIGN NOTES:
 * - mirrorFrom means "this node's sprite is derived from the opposite-side limb".
 *   Therefore it should be horizontally flipped in ALL directions, not just left-facing ones.
 *   The previous logic only mirrored in left-facing directions (NW, W, SW), which caused
 *   sprites to appear un-flipped in S/N/E/SE/NE directions — making paired limbs like
 *   left/right thighs show identical (non-mirrored) sprites when facing South, which
 *   looked wrong when limbs were rotated to the same or symmetric world angles.
 * - The costume set's spriteMap is NOT checked here because it typically maps
 *   ALL directions to the same spritePartId (auto-generated default). The costume
 *   set is about WHICH sprite to use, not WHETHER to mirror it. If a user wants
 *   a per-direction non-mirrored sprite, they should set directionSprites.
 * - This function is called AFTER resolvePuppetNodeSprite, which already handles
 *   the costume set's mirror fallback for sprite SELECTION.
 * - Draw order (z-index) is handled separately by computeDirectionDrawOrder(),
 *   which swaps z-indices for mirrorFrom nodes in left-facing directions.
 *
 * @param node The puppet node
 * @param direction Current direction
 * @returns True if this direction should be rendered as a mirror (horizontal flip)
 */
export function shouldMirrorDirection(
  node: PuppetNode,
  direction: PuppetDirection,
): boolean {
  if (!node.mirrorFrom) return false;

  // If this direction has an explicit per-direction sprite override, no mirror needed
  // (the user provided a dedicated sprite for this specific direction)
  if (node.directionSprites && node.directionSprites[direction]) return false;

  // For mirrorFrom nodes without a dedicated sprite for this direction,
  // always mirror (horizontal flip) regardless of which direction the character faces.
  // This ensures left-side limbs display the horizontally-flipped version of the
  // right-side sprite in all directions (S, N, E, W, etc.).
  return true;
}

// ============================================================
// Render Sort Key
// ============================================================

/**
 * Compute the render sort key for a puppet render item.
 * Items with lower sort keys are drawn first (behind).
 *
 * The sort key encodes:
 * - zIndex: primary sort order
 * - drawOrderIndex: secondary sort (front-to-back within same z)
 * - worldY bias: latitude-dependent depth sorting
 *
 * @param zIndex Node's z-index
 * @param drawOrderIndex Draw order index within the skeleton
 * @param worldY World Y position of the node
 * @param minY Minimum Y in scene
 * @param maxY Maximum Y in scene
 * @param latitude Current viewing latitude
 * @returns Numeric sort key (lower = drawn first)
 */
function computeRenderSortKey(
  zIndex: number,
  drawOrderIndex: number,
  worldY: number,
  minY: number,
  maxY: number,
  latitude: number,
): number {
  const zBias = zIndex * 100000;
  const drawBias = drawOrderIndex * 1000;
  const latBias = computeLatitudeWorldYBias(latitude, worldY, minY, maxY);
  return zBias + drawBias - latBias;
}

// ============================================================
// Puppet Frame Rendering
// ============================================================

/** Render item for sorting and drawing */
interface PuppetRenderItem {
  sortKey: number;
  type: 'sprite' | 'disc';
  worldX: number;
  worldY: number;
  worldAngle: number;
  stretchY: number;
  part: Part | null;
  node: PuppetNode;
  direction: PuppetDirection;
  mirrored: boolean;
  disc?: JointDiscRenderData;
  depth: number;
}

/**
 * Main entry point: render a complete puppet frame.
 *
 * Steps:
 * 1. Find linked PuppetCharacter and PuppetSkeleton
 * 2. Find active CostumeSet
 * 3. Build node keyframe index
 * 4. Apply global modifier transform
 * 5. Compute world transforms with latitude
 * 6. Compute direction-dependent draw order
 * 7. Generate joint discs
 * 8. Create combined render list with sort keys
 * 9. Sort by sort key and render each item
 *
 * @param ctx Canvas rendering context
 * @param canvasWidth Canvas width
 * @param canvasHeight Canvas height
 * @param clip Current animation clip (must be a puppet clip)
 * @param parts All available parts
 * @param currentFrame Current animation frame
 * @param backgroundColor Background color
 * @param puppetSkeletons All puppet skeletons in the project
 * @param puppetCharacters All puppet characters in the project
 * @param keyframes Regular keyframes (for part modifiers)
 * @param globalModifiers Project-level global modifiers
 * @param animationVariables Animation variables
 * @param frameRate Frame rate
 */
function renderPuppetFrame(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  clip: AnimationClip,
  parts: Part[],
  currentFrame: number,
  backgroundColor: string,
  puppetSkeletons: PuppetSkeleton[],
  puppetCharacters: PuppetCharacter[],
  keyframes: Keyframe[],
  globalModifiers?: GlobalModifier[],
  animationVariables?: AnimationVariable[],
  frameRate: number = 12,
): void {
  // Clear canvas with background color
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Step 1: Find linked PuppetCharacter
  if (!clip.isPuppetClip || !clip.puppetCharacterId) return;
  const character = puppetCharacters.find(c => c.id === clip.puppetCharacterId);
  if (!character) return;

  // Step 2: Find PuppetSkeleton
  const skeleton = puppetSkeletons.find(s => s.id === character.puppetSkeletonId);
  if (!skeleton) return;

  // Step 3: Find active CostumeSet
  const activeCostumeSet = character.activeCostumeSetId
    ? character.costumeSets.find(cs => cs.id === character.activeCostumeSetId) ?? null
    : null;

  // Step 4: Get node keyframes
  const nodeKeyframes = clip.puppetNodeKeyframes || [];

  // Step 5: Compute latitude from skeleton
  const latitude = skeleton.viewLatitude || 0;
  const direction = skeleton.currentDirection || 'S';

  // Step 6: Apply global modifier transform (camera/world transform)
  let globalTransform = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  if (globalModifiers && globalModifiers.length > 0) {
    globalTransform = computeGlobalModifierTransform(globalModifiers, currentFrame, frameRate);
  }

  const hasGlobalTransform = globalTransform.translateX !== 0 || globalTransform.translateY !== 0 ||
    globalTransform.rotation !== 0 || globalTransform.scaleX !== 1 || globalTransform.scaleY !== 1;

  if (hasGlobalTransform) {
    ctx.save();
    ctx.translate(canvasWidth / 2, canvasHeight / 2);
    ctx.translate(globalTransform.translateX, globalTransform.translateY);
    ctx.rotate((globalTransform.rotation * Math.PI) / 180);
    ctx.scale(globalTransform.scaleX, globalTransform.scaleY);
    ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
  }

  // Step 7: Compute world transforms
  const worldTransforms = computePuppetNodeWorldTransforms(
    skeleton,
    nodeKeyframes,
    currentFrame,
    latitude,
  );

  // Step 8: Generate joint discs
  const jointDiscs = generateJointDiscs(worldTransforms, skeleton, latitude);

  // Step 9: Create render list
  const renderList: PuppetRenderItem[] = [];

  // Center offset for the puppet on the canvas
  const centerOffsetX = canvasWidth / 2;
  const centerOffsetY = canvasHeight / 2;

  // Compute minY/maxY for sort key normalization
  let minY = Infinity, maxY = -Infinity;
  for (const wt of worldTransforms) {
    minY = Math.min(minY, wt.worldY);
    maxY = Math.max(maxY, wt.worldY);
  }
  if (minY === Infinity) { minY = 0; maxY = 100; }

  // Add sprite render items
  let drawOrderIndex = 0;
  for (const wt of worldTransforms) {
    const node = wt.node;
    if (!node.visible) continue;

    // Resolve sprite for this node and direction.
    // Use skeleton.currentDirection (the `direction` variable) instead of the
    // keyframe-interpolated direction (wt.direction). The keyframe direction
    // can be stale — created when the skeleton faced a different direction —
    // causing incorrect sprite resolution and mirroring.
    // This is the same fix applied in renderPuppetNodes (render-pipeline.ts).
    const nodeDirection = direction;
    const part = resolvePuppetNodeSprite(node, nodeDirection, activeCostumeSet, parts);
    const mirrored = shouldMirrorDirection(node, nodeDirection);

    const sortKey = computeRenderSortKey(
      node.zIndex,
      drawOrderIndex,
      wt.worldY,
      minY,
      maxY,
      latitude,
    );

    renderList.push({
      sortKey,
      type: 'sprite',
      worldX: wt.worldX,
      worldY: wt.worldY,
      worldAngle: wt.worldAngle,
      stretchY: wt.stretchY,
      part,
      node,
      direction: nodeDirection,
      mirrored,
      depth: wt.depth,
    });

    drawOrderIndex++;
  }

  // Add joint disc render items
  for (const disc of jointDiscs) {
    const sortKey = computeRenderSortKey(
      disc.z,
      drawOrderIndex,
      disc.y,
      minY,
      maxY,
      latitude,
    ) - 0.5; // Slightly behind the child node

    renderList.push({
      sortKey,
      type: 'disc',
      worldX: disc.x,
      worldY: disc.y,
      worldAngle: 0,
      stretchY: 1,
      part: null,
      node: skeleton.nodes.find(n => n.id === disc.childNodeId)!,
      direction,
      mirrored: false,
      disc,
      depth: 0,
    });

    drawOrderIndex++;
  }

  // Step 10: Sort render list
  renderList.sort((a, b) => a.sortKey - b.sortKey);

  // Step 11: Render each item
  for (const item of renderList) {
    if (item.type === 'disc' && item.disc) {
      const latitudeScaleY = latitude > 0 ? Math.max(0.3, 1 - latitude / 120) : 1;
      renderJointDisc(ctx, item.disc, centerOffsetX, centerOffsetY, latitudeScaleY);
      continue;
    }

    // Render sprite
    if (!item.part) continue;

    // Create part canvas
    const partCanvasResult = createPartCanvasFromPart(item.part, keyframes, currentFrame, frameRate);
    if (!partCanvasResult) continue;

    let partCanvas = partCanvasResult.canvas;
    let partPivotX = item.part.pivotX + partCanvasResult.offsetX;
    let partPivotY = item.part.pivotY + partCanvasResult.offsetY;

    // Static mirror: flip the sprite BEFORE rotation so that rotation direction
    // matches the bone/drag direction. Dynamic mirror (rotate-then-flip) reverses
    // the visual rotation direction.
    if (item.mirrored) {
      const flippedCanvas = acquireCanvas(partCanvas.width, partCanvas.height);
      const flipCtx = flippedCanvas.getContext('2d')!;
      flipCtx.clearRect(0, 0, flippedCanvas.width, flippedCanvas.height);
      flipCtx.translate(flippedCanvas.width, 0);
      flipCtx.scale(-1, 1);
      flipCtx.drawImage(partCanvas, 0, 0);
      releaseCanvas(partCanvas);
      partCanvas = flippedCanvas;
      // Flip pivot: pivotX measured from left edge becomes (width - pivotX) after horizontal flip
      partPivotX = partCanvas.width - partPivotX;
    }

    // Apply pixel-perfect rotation
    // IMPORTANT: After rotation, the pivot position in the output canvas changes
    // because the bounding box expands. We MUST use resultPivotX/Y for positioning.
    const rotResult = renderPixelPerfectRotation(
      partCanvas,
      item.worldAngle,
      item.stretchY,
      partPivotX,
      partPivotY,
    );
    const rotatedCanvas = rotResult.canvas;

    // Compute draw position using the PIVOT POSITION IN THE ROTATED CANVAS
    // (not the original pivot position, which is wrong after rotation expands the bbox)
    const aligned = applyHalfPixelAlignment(
      item.worldX + centerOffsetX - rotResult.resultPivotX,
      item.worldY + centerOffsetY - rotResult.resultPivotY,
    );

    // Draw (no post-rotation mirror needed — mirroring was applied before rotation)
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(rotatedCanvas, aligned.x, aligned.y);
    ctx.restore();

    // Release canvases
    if (rotatedCanvas !== partCanvas) {
      releaseCanvas(rotatedCanvas);
    }
    releaseCanvas(partCanvas);
  }

  if (hasGlobalTransform) {
    ctx.restore();
  }
}

/**
 * Create an offscreen canvas from a Part's pixel data.
 * Applies pixel-level edit modifiers, keyframe modifiers, and animation modifiers.
 * Returns the canvas and any offset from modifiers that expanded the canvas.
 *
 * This mirrors the modifier pipeline in render-pipeline.ts createPartCanvasInner(),
 * ensuring puppet sprites get the same modifier treatment as non-puppet parts.
 */
function createPartCanvasFromPart(
  part: Part,
  keyframes: Keyframe[],
  currentFrame: number,
  frameRate: number = 12,
): { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } | null {
  if (!part.pixels || part.pixels.length === 0) return null;

  const w = part.width;
  const h = part.height;

  // ---- Step 1: Apply part edit modifiers (pixel-level) ----
  let pixels: PixelGrid;
  let modOffsetX = 0;
  let modOffsetY = 0;

  const activePixelMods = part.editModifiers?.filter(m =>
    m.enabled && ['color_replace', 'outline', 'dither', 'pixel_displace',
      'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip', 'pixel_edit'].includes(m.type)
  ) || [];

  if (activePixelMods.length > 0) {
    // Resolve ParamDrivers/ParamKeyframes before rendering
    const resolvedPixelMods = activePixelMods.some(m =>
      (m.paramKeyframes && m.paramKeyframes.length > 0) ||
      (m.paramDrivers && m.paramDrivers.length > 0 && m.paramDrivers.some(d => d.enabled && !d.isBaked))
    ) ? resolveKeyframeModifierParams(activePixelMods, currentFrame) : activePixelMods;
    const modResult = applyPixelModifiers(part, resolvedPixelMods, currentFrame);
    pixels = modResult.pixels;
    modOffsetX = modResult.offsetX;
    modOffsetY = modResult.offsetY;
  } else {
    pixels = part.pixels;
  }

  // Apply translate shift from part edit modifiers
  const translateMod = part.editModifiers?.find(m => m.type === 'translate' && m.enabled);
  if (translateMod) {
    const dx = Math.round(Number(translateMod.params.offsetX) || 0);
    const dy = Math.round(Number(translateMod.params.offsetY) || 0);
    if (dx !== 0 || dy !== 0) {
      const gridH = pixels.length;
      const gridW = pixels[0]?.length || 0;
      const shifted: PixelGrid = [];
      for (let y = 0; y < gridH; y++) {
        const row: (string | null)[] = [];
        for (let x = 0; x < gridW; x++) {
          const srcX = x - dx;
          const srcY = y - dy;
          if (srcX >= 0 && srcX < gridW && srcY >= 0 && srcY < gridH) {
            row.push(pixels[srcY]?.[srcX] ?? null);
          } else {
            row.push(null);
          }
        }
        shifted.push(row);
      }
      pixels = shifted;
    }
  }

  // ---- Step 2: Apply keyframe pixel modifiers ----
  // Find the keyframe for this part at the current frame
  const currentKf = keyframes.find(kf => kf.partId === part.id && kf.frame === currentFrame);
  if (currentKf && !currentKf.isBaked) {
    const activeKfMods = currentKf.modifiers.filter(m => !m.collapsed);
    if (activeKfMods.length > 0) {
      // Resolve ParamDrivers/ParamKeyframes before rendering
      const resolvedKfMods = activeKfMods.some(m =>
        (m.paramKeyframes && m.paramKeyframes.length > 0) ||
        (m.paramDrivers && m.paramDrivers.length > 0 && m.paramDrivers.some(d => d.enabled && !d.isBaked))
      ) ? resolveKeyframeModifierParams(activeKfMods, currentFrame) : activeKfMods;
      const modResult = applyPixelModifiers(part, resolvedKfMods, currentFrame, pixels);
      pixels = modResult.pixels;
      modOffsetX = modResult.offsetX;
      modOffsetY = modResult.offsetY;
    }
  }

  // ---- Step 3: Apply pixel-level deformation animation modifiers ----
  // (wave_deform, texture_scroll, contour_scroll, etc.)
  if (part.animationModifiers && part.animationModifiers.length > 0) {
    const animMods = part.animationModifiers.filter(m => m.enabled && isPixelDeformModifier(m.type));
    if (animMods.length > 0) {
      // Compute padding for overflow
      const animPadding = computeTotalAnimPadding(animMods, currentFrame, frameRate);
      if (animPadding.left > 0 || animPadding.top > 0 || animPadding.right > 0 || animPadding.bottom > 0) {
        pixels = padPixelGrid(pixels, animPadding.left, animPadding.top, animPadding.right, animPadding.bottom);
        modOffsetX += animPadding.left;
        modOffsetY += animPadding.top;
      }

      for (const rawAnimMod of animMods) {
        const animMod = resolveAnimModifierParams(rawAnimMod, currentFrame);
        const { weight } = getAnimationFrameAndWeight(animMod, currentFrame);
        if (weight <= 0) continue;

        const blendMode = animMod.blendMode || 'add';
        let convergeFactor = 1;
        if (blendMode === 'converge') {
          const convergeSpeed = Number(animMod.params.convergeSpeed) || 0.5;
          const { relativeFrame: cRelFrame } = getAnimationFrameAndWeight(animMod, currentFrame);
          convergeFactor = Math.exp(-convergeSpeed * cRelFrame * 0.1);
        }
        const effectiveWeight = weight * convergeFactor;

        switch (animMod.type) {
          case 'texture_scroll':
            pixels = applyTextureScroll(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
          case 'wave_deform':
            pixels = applyWaveDeform(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
          case 'contour_scroll':
            pixels = applyContourScroll(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
          case 'reveal_hide':
            pixels = applyRevealHide(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
          case 'shatter_dissolve':
            pixels = applyShatterDissolve(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
          case 'annihilate':
            pixels = applyAnnihilate(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
          case 'teleport':
            pixels = applyTeleport(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
          case 'crt_off':
            pixels = applyCrtOff(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
          case 'bend':
            pixels = applyBend(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
          case 'elliptical_compress':
            pixels = applyEllipticalCompress(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
          case 'dumbbell_stretch':
            pixels = applyDumbbellStretch(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
          case 'pillow_stretch':
            pixels = applyPillowStretch(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
          case 'hyperbolic_stretch':
            pixels = applyHyperbolicStretch(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
          case 'ring_ripple':
            pixels = applyRingRipple(pixels, w, h, animMod.params, currentFrame, frameRate, effectiveWeight);
            break;
        }
      }

      // Trim transparent edges from animation padding
      if (animPadding.left > 0 || animPadding.top > 0 || animPadding.right > 0 || animPadding.bottom > 0) {
        const trimmed = trimTransparentEdges(pixels);
        pixels = trimmed.pixels;
        modOffsetX -= trimmed.trimLeft;
        modOffsetY -= trimmed.trimTop;
      }
    }
  }

  const canvasW = pixels[0]?.length || w;
  const canvasH = pixels.length || h;

  const canvas = acquireCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Build ImageData
  const imageData = ctx.createImageData(canvasW, canvasH);
  const data = imageData.data;

  for (let y = 0; y < canvasH; y++) {
    const row = pixels[y];
    if (!row) continue;
    const rowOff = y * canvasW * 4;
    for (let x = 0; x < canvasW; x++) {
      const color = row[x];
      if (color) {
        const packed = hexToRgbCached(color);
        const idx = rowOff + x * 4;
        data[idx] = (packed >> 16) & 0xFF;
        data[idx + 1] = (packed >> 8) & 0xFF;
        data[idx + 2] = packed & 0xFF;
        data[idx + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return { canvas, offsetX: modOffsetX, offsetY: modOffsetY };
}
