// ============================================================
// PixelMorpher - Unified Pipeline Bridge
// ============================================================
// Bridges the old store data (Part + PuppetNode + PuppetSkeleton)
// to the new unified render pipeline (Character + Node + RenderPlan).
//
// This is the integration point that PixelCanvas calls instead of
// the old dual-path (renderFrame + renderPuppetNodes).
//
// Strategy:
// - For non-puppet parts: delegate to the existing renderFrame()
//   (these parts use modifier stacks, effects, etc. that the new
//   pipeline doesn't fully replicate yet)
// - For puppet parts: use the new unified pipeline via LiveAdapter
//   → Character → generateRenderPlan → executeRenderPlan
// - Both render to the same canvas context, composited together
//
// This hybrid approach ensures zero regression while incrementally
// migrating rendering to the unified pipeline.
// ============================================================

import type {
  Part, Keyframe, PuppetSkeleton, PuppetCharacter, PuppetNodeKeyframe,
  AnimationClip, Skeleton, ProceduralAnimation,
  EffectTrack, MotionBlurStroke, EffectStroke,
  CanvasModifierTrack, GlobalModifier, AnimationVariable,
} from './types';
import type { Character, RotationStrategy, AnimationVariable as UnifiedAnimationVariable } from './unified-types';
import { LiveAdapter } from './migration-adapter';
import {
  generateRenderPlan,
  executeRenderPlan,
} from './unified-render';
import { renderFrame, renderPuppetNodes } from './engine';
import { computeGlobalModifierTransform } from './engine/animation-dispatch';
import { applyCanvasModifiers } from './engine/canvas-modifiers';
import { clearRenderCaches } from './engine/render-cache';

// ---- Singleton LiveAdapter ----
// NOTE: The LiveAdapter is retained as a fallback for render paths that
// don't go through the store (e.g., export, testing). The store's
// UnifiedSlice.getUnifiedProject() is preferred for main rendering.

const liveAdapter = new LiveAdapter();

/** Invalidate the LiveAdapter cache and render caches when store data changes */
export function invalidateUnifiedPipelineCache(): void {
  liveAdapter.invalidate();
  clearRenderCaches();
}

// ---- Hybrid Render Function ----

/**
 * Unified render function that replaces the dual renderFrame + renderPuppetNodes pattern.
 *
 * Phase 2 hybrid strategy:
 * - Non-puppet parts → existing renderFrame() (full modifier/effect pipeline)
 * - Puppet parts → new unified pipeline (via LiveAdapter → Character → RenderPlan)
 *
 * The new unified pipeline handles:
 * - World transform computation (recursive, socket-based)
 * - Direction-dependent sprite resolution + mirrorMap
 * - Disc generation (zIndex = parent - 0.5)
 * - Pixel-perfect rotation (4× upscale)
 * - Sub-pixel positioning (1/16 pixel precision)
 */
export function renderUnified(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  parts: Part[],
  keyframes: Keyframe[],
  currentFrame: number,
  backgroundColor: string,
  effectTracks: EffectTrack[] | undefined,
  motionBlurStrokes: MotionBlurStroke[] | undefined,
  effectStrokes: EffectStroke[] | undefined,
  autoMotionBlur: boolean,
  autoMotionBlurIntensity: number,
  skeletons: Skeleton[] | undefined,
  proceduralAnimations: ProceduralAnimation[] | undefined,
  canvasModifierTracks: CanvasModifierTrack[] | undefined,
  frameRate: number,
  previewQuality: 'low' | 'medium' | 'high',
  animationVariables: AnimationVariable[] | undefined,
  globalModifiers: GlobalModifier[] | undefined,
  puppetSkeletons: PuppetSkeleton[] | undefined,
  puppetCharacters: PuppetCharacter[] | undefined,
  animationClips: AnimationClip[],
  useUnifiedPipeline: boolean = true,
): void {
  // ---- Compute puppet sprite part IDs (shared logic) ----
  const puppetSpritePartIds = computePuppetSpritePartIds(puppetSkeletons, puppetCharacters);
  const nonPuppetParts = puppetSpritePartIds.size > 0
    ? parts.filter(p => !puppetSpritePartIds.has(p.id))
    : parts;

  // ---- Step 1: Render non-puppet parts using the EXISTING pipeline ----
  // The existing renderFrame() handles all modifier stacks, effects,
  // canvas modifiers, motion blur, etc. for non-puppet parts.
  // This is NOT yet migrated to the unified pipeline.
  renderFrame(
    ctx, canvasWidth, canvasHeight, nonPuppetParts, keyframes, currentFrame,
    backgroundColor, effectTracks, motionBlurStrokes, effectStrokes,
    autoMotionBlur, autoMotionBlurIntensity, skeletons, proceduralAnimations,
    canvasModifierTracks, frameRate, previewQuality, animationVariables,
    globalModifiers,
  );

  // ---- Step 2: Render puppet parts ----
  if (puppetSkeletons && puppetCharacters && puppetSkeletons.length > 0) {
    if (useUnifiedPipeline) {
      // NEW: Unified pipeline path
      renderPuppetViaUnifiedPipeline(
        ctx, canvasWidth, canvasHeight,
        puppetSkeletons, puppetCharacters, parts,
        animationClips, currentFrame, frameRate,
        globalModifiers, animationVariables, canvasModifierTracks,
      );
    } else {
      // OLD: Direct renderPuppetNodes() path (fallback)
      renderPuppetViaOldPipeline(
        ctx, parts, puppetSkeletons, puppetCharacters,
        animationClips, currentFrame, canvasWidth, canvasHeight, frameRate,
        keyframes,
      );
    }
  }
}

// ---- New Unified Pipeline Path ----

function renderPuppetViaUnifiedPipeline(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  puppetSkeletons: PuppetSkeleton[],
  puppetCharacters: PuppetCharacter[],
  parts: Part[],
  animationClips: AnimationClip[],
  currentFrame: number,
  frameRate: number,
  globalModifiers?: GlobalModifier[],
  animationVariables?: AnimationVariable[],
  canvasModifierTracks?: CanvasModifierTrack[],
): void {
  // Apply global modifier transform (camera/world transform)
  // This matches the old pipeline's behavior in renderPuppetFrame().
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

  for (const character of puppetCharacters) {
    const skeleton = puppetSkeletons.find(s => s.id === character.puppetSkeletonId);
    if (!skeleton) continue;

    // Find puppet keyframes from animation clip
    const puppetClip = animationClips.find(
      c => c.isPuppetClip && c.puppetCharacterId === character.id
    );
    const nodeKeyframes = puppetClip?.puppetNodeKeyframes ?? [];

    // Convert old data to unified Character via LiveAdapter
    const unifiedCharacter = liveAdapter.getCharacter(
      skeleton,
      [character],
      parts,
      nodeKeyframes,
      character.costumeSets ?? [],
    );

    // Generate and execute render plan
    // Convert old AnimationVariable format to unified format
    const unifiedVars: UnifiedAnimationVariable[] | undefined = animationVariables?.map(v => ({
      id: v.id,
      name: v.name,
      value: v.defaultValue ?? 0,
      min: 0,
      max: 100,
    }));
    const plan = generateRenderPlan(
      unifiedCharacter,
      currentFrame,
      canvasWidth,
      canvasHeight,
      'pixel-perfect',
      frameRate,
      unifiedVars,
    );
    executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);
  }

  if (hasGlobalTransform) {
    ctx.restore();
  }

  // Apply canvas modifier post-processing (outline_emphasis, color_lut, bloom, scanlines, etc.)
  if (canvasModifierTracks && canvasModifierTracks.length > 0) {
    applyCanvasModifiers(ctx, canvasModifierTracks, currentFrame, canvasWidth, canvasHeight);
  }
}

// ---- Old Pipeline Path (Fallback) ----

function renderPuppetViaOldPipeline(
  ctx: CanvasRenderingContext2D,
  parts: Part[],
  puppetSkeletons: PuppetSkeleton[],
  puppetCharacters: PuppetCharacter[],
  animationClips: AnimationClip[],
  currentFrame: number,
  canvasWidth: number,
  canvasHeight: number,
  frameRate: number,
  keyframes?: Keyframe[],
): void {
  for (const character of puppetCharacters) {
    const skeleton = puppetSkeletons.find(s => s.id === character.puppetSkeletonId);
    if (!skeleton) continue;

    const puppetClip = animationClips.find(
      c => c.isPuppetClip && c.puppetCharacterId === character.id
    );

    if (!puppetClip) {
      renderPuppetNodes(
        ctx, parts, skeleton, character,
        [], currentFrame, canvasWidth, canvasHeight, frameRate,
        'high', undefined, keyframes,
      );
    } else {
      renderPuppetNodes(
        ctx, parts, skeleton, character,
        puppetClip.puppetNodeKeyframes ?? [], currentFrame, canvasWidth, canvasHeight, frameRate,
        'high', undefined, keyframes,
      );
    }
  }
}

// ---- Shared Utility ----

/**
 * Compute the set of Part IDs that are used as puppet node sprites.
 * Parts in this set should be excluded from renderFrame() to avoid
 * double-rendering.
 */
export function computePuppetSpritePartIds(
  puppetSkeletons?: PuppetSkeleton[],
  puppetCharacters?: PuppetCharacter[],
): Set<string> {
  const ids = new Set<string>();
  if (!puppetSkeletons) return ids;

  for (const skeleton of puppetSkeletons) {
    for (const node of skeleton.nodes) {
      if (node.spritePartId) ids.add(node.spritePartId);
      for (const partId of Object.values(node.directionSprites)) {
        if (partId) ids.add(partId);
      }
    }
  }
  if (puppetCharacters) {
    for (const character of puppetCharacters) {
      for (const costumeSet of character.costumeSets ?? []) {
        for (const partId of Object.values(costumeSet.spriteMap)) {
          if (partId) ids.add(partId);
        }
      }
    }
  }
  return ids;
}

// ---- Convenience Wrapper for Export ----

/**
 * Render a single frame to a canvas for export, using the unified pipeline.
 * Replaces renderFrameToCanvas for puppet-inclusive exports.
 */
export function renderUnifiedToCanvas(
  canvasWidth: number,
  canvasHeight: number,
  parts: Part[],
  keyframes: Keyframe[],
  frame: number,
  backgroundColor: string,
  effectTracks?: EffectTrack[],
  motionBlurStrokes?: MotionBlurStroke[],
  effectStrokes?: EffectStroke[],
  autoMotionBlur: boolean = false,
  autoMotionBlurIntensity: number = 0.5,
  skeletons?: Skeleton[],
  proceduralAnimations?: ProceduralAnimation[],
  canvasModifierTracks?: CanvasModifierTrack[],
  previewQuality: 'low' | 'medium' | 'high' = 'high',
  globalModifiers?: GlobalModifier[],
  animationVariables?: AnimationVariable[],
  puppetSkeletons?: PuppetSkeleton[],
  puppetCharacters?: PuppetCharacter[],
  puppetNodeKeyframes?: PuppetNodeKeyframe[],
  frameRate: number = 12,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d')!;

  // Compute puppet sprite part IDs
  const puppetSpritePartIds = computePuppetSpritePartIds(puppetSkeletons, puppetCharacters);
  const nonPuppetParts = puppetSpritePartIds.size > 0
    ? parts.filter(p => !puppetSpritePartIds.has(p.id))
    : parts;

  // Render non-puppet parts
  renderFrame(
    ctx, canvasWidth, canvasHeight, nonPuppetParts, keyframes, frame,
    backgroundColor, effectTracks, motionBlurStrokes, effectStrokes,
    autoMotionBlur, autoMotionBlurIntensity, skeletons, proceduralAnimations,
    canvasModifierTracks, frameRate, previewQuality, animationVariables,
    globalModifiers,
  );

  // Render puppet parts via unified pipeline
  if (puppetSkeletons && puppetCharacters && puppetSkeletons.length > 0) {
    // Build animation clips lookup for puppet keyframes
    for (const character of puppetCharacters) {
      const skeleton = puppetSkeletons.find(s => s.id === character.puppetSkeletonId);
      if (!skeleton) continue;

      // Find keyframes for this character
      const charKeyframes = (puppetNodeKeyframes ?? []).filter(kf => {
        return skeleton.nodes.some(n => n.id === kf.nodeId);
      });

      const unifiedCharacter = liveAdapter.getCharacter(
        skeleton,
        [character],
        parts,
        charKeyframes,
        character.costumeSets ?? [],
      );

      // Convert old AnimationVariable format to unified format
      const unifiedVars: UnifiedAnimationVariable[] | undefined = animationVariables?.map(v => ({
        id: v.id,
        name: v.name,
        value: v.defaultValue ?? 0,
        min: 0,
        max: 100,
      }));
      const plan = generateRenderPlan(
        unifiedCharacter,
        frame,
        canvasWidth,
        canvasHeight,
        'pixel-perfect',
        frameRate,
        unifiedVars,
      );
      executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);
    }
  }

  // Apply canvas modifier post-processing
  if (canvasModifierTracks && canvasModifierTracks.length > 0) {
    applyCanvasModifiers(ctx, canvasModifierTracks, frame, canvasWidth, canvasHeight);
  }

  return canvas;
}
