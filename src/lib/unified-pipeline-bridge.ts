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
// - For non-puppet parts: renderPartsUnified() in unified-render.ts
//   (standalone Part + Keyframe[] → NodeRenderInstruction → executeRenderPlan;
//   covers modifier stacks, effects, motion blur, bones, procedural anims)
// - For puppet parts: use the new unified pipeline via LiveAdapter
//   → Character → generateRenderPlan → executeRenderPlan
// - Both render to the same canvas context, composited together
//
// The old renderFrame() dual-path is fully migrated; the bridge no longer
// calls the old pipeline.
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
  renderPartsUnified,
} from './unified-render';
import { interpolateNodeKeyframes } from './engine/render-helpers/puppet-keyframe-interpolation';
import { renderEffectTrackFrame } from './engine/effect-render';
import { renderMotionBlurStroke, renderEffectStroke } from './engine/brush-render';
import { computeGlobalModifierTransform } from './engine/animation-dispatch';
import { applyCanvasModifiers } from './engine/canvas-modifiers';
import { clearRenderCaches } from './engine/render-cache';

// ---- Singleton LiveAdapter ----
// NOTE: The LiveAdapter is retained as a fallback for render paths that
// don't go through the store (e.g., export, testing). The old UnifiedSlice
// was removed (H21: zombie code); LiveAdapter is the only unified-model path.

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
 * - Non-puppet parts → renderPartsUnified() (unified pipeline)
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
  // 注意：未被任何 Character 引用的 Part 不在主画布渲染（用户确认）。
  // 精灵编辑在独立的编辑画布上渲染（renderPartEditUnified），不在这里。

  // ---- Background ----
  if (backgroundColor !== 'transparent') {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  // ---- Step 2: Render puppet parts ----
  // 统一走 unified pipeline：renderPuppetViaUnifiedPipeline 内部已调
  // interpolateNodeKeyframes，蓝图/修改器/关键帧都在烘焙阶段求值。
  if (puppetSkeletons && puppetCharacters && puppetSkeletons.length > 0) {
    renderPuppetViaUnifiedPipeline(
      ctx, canvasWidth, canvasHeight,
      puppetSkeletons, puppetCharacters, parts,
      animationClips, currentFrame, frameRate,
      globalModifiers, animationVariables, canvasModifierTracks,
    );
  }

  // ---- Step 3: Effects (canvas-level overlays) ----
  // 特效轨道、动态模糊笔触、特效笔触：画布级叠加，不绑定特定角色
  if (effectTracks) {
    for (const effectTrack of effectTracks) {
      if (!effectTrack.visible) continue;
      const kf = effectTrack.keyframes
        ?.filter((k: any) => k.frame <= currentFrame)
        ?.sort((a: any, b: any) => b.frame - a.frame)[0];
      if (!kf) continue;
      renderEffectTrackFrame(ctx, effectTrack, kf, currentFrame, canvasWidth, canvasHeight);
    }
  }
  if (motionBlurStrokes) {
    for (const stroke of motionBlurStrokes) {
      if (stroke.frame === currentFrame) {
        renderMotionBlurStroke(ctx, stroke);
      }
    }
  }
  if (effectStrokes) {
    for (const stroke of effectStrokes) {
      if (stroke.frame === currentFrame) {
        renderEffectStroke(ctx, stroke);
      }
    }
  }

  // ---- Step 4: Canvas modifiers — 全帧后处理，只应用一次（H10）
  // 必须在木偶叠加之后，否则木偶不受后处理影响；renderFrame 内部已不再应用。
  if (canvasModifierTracks && canvasModifierTracks.length > 0) {
    applyCanvasModifiers(ctx, canvasModifierTracks, currentFrame, canvasWidth, canvasHeight);
  }
}

// ---- New Unified Pipeline Path ----

/**
 * H11: 全局变换（镜头/世界）包装抽成共享函数——实时预览与导出两条路径复用，
 * 保证存在 globalModifiers 时导出图与预览一致。
 * 返回是否应用了变换（调用方据此决定是否 ctx.restore()）。
 */
function applyGlobalTransformWrapper(
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
  const hasGlobalTransform = applyGlobalTransformWrapper(
    ctx, canvasWidth, canvasHeight, globalModifiers, currentFrame, frameRate,
  );

  for (const character of puppetCharacters) {
    const skeleton = puppetSkeletons.find(s => s.id === character.puppetSkeletonId);
    if (!skeleton) continue;

    // Find puppet keyframes from animation clip
    const puppetClip = animationClips.find(
      c => true && c.puppetCharacterId === character.id
    );
    const nodeKeyframes = puppetClip?.puppetNodeKeyframes ?? [];

    // 蓝图/修改器求值：unified pipeline 的 LiveAdapter 不调 interpolateNodeKeyframes，
    // 这里先求出完整插值（含关键帧+蓝图+修改器），烘焙进 skeleton 副本，
    // 再喂给 adapter（传空关键帧，避免 adapter 重复插值）。
    const interpValues = interpolateNodeKeyframes(skeleton, nodeKeyframes, currentFrame);
    const bakedSkeleton: PuppetSkeleton = {
      ...skeleton,
      nodes: skeleton.nodes.map(n => {
        const v = interpValues.get(n.id);
        if (!v) return n;
        return {
          ...n,
          angle: v.angle,
          offsetX: v.offsetX,
          offsetY: v.offsetY,
          stretch: v.stretch,
          zIndex: v.zIndex,
          // 已烘焙，清空防重复计算
          blueprint: undefined,
          modifiers: [],
        };
      }),
    };

    // Convert old data to unified Character via LiveAdapter
    // 注意：bakedSkeleton 每帧的角度都不同，但 skeleton.id 相同，
    // LiveAdapter 按 id 缓存 Character，必须先 invalidate，否则拿到的是旧缓存。
    liveAdapter.invalidate();
    const unifiedCharacter = liveAdapter.getCharacter(
      bakedSkeleton,
      [character],
      parts,
      [], // 关键帧已烘焙，传空
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
      // H6: 透传 writer，供变量驱动求值
      writerDriverId: v.writerDriverId,
      defaultValue: v.defaultValue ?? 0,
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
}

// ---- Old Pipeline Path (Fallback) ----

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

  // Render non-puppet parts via the unified pipeline
  // (renderPartsUnified handles the full old renderFrame() feature set;
  // canvas modifiers are applied once at the end of this function — H10)
  renderPartsUnified(
    ctx, nonPuppetParts, keyframes, frame,
    canvasWidth, canvasHeight, backgroundColor,
    {
      skeletons, proceduralAnimations, animationVariables,
      globalModifiers,
      effectTracks, motionBlurStrokes, effectStrokes,
      autoMotionBlur, autoMotionBlurIntensity,
      previewQuality, frameRate,
    },
  );

  // Render puppet parts via unified pipeline
  // H11: 与实时预览一致，木偶渲染包裹全局变换
  const hasGlobalTransform = applyGlobalTransformWrapper(
    ctx, canvasWidth, canvasHeight, globalModifiers, frame, frameRate,
  );
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
        // H6: 透传 writer，供变量驱动求值
        writerDriverId: v.writerDriverId,
        defaultValue: v.defaultValue ?? 0,
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

  if (hasGlobalTransform) {
    ctx.restore();
  }

  // Apply canvas modifier post-processing
  if (canvasModifierTracks && canvasModifierTracks.length > 0) {
    applyCanvasModifiers(ctx, canvasModifierTracks, frame, canvasWidth, canvasHeight);
  }

  return canvas;
}

/**
 * Render a single character at a specific frame for onion skin.
 * Uses the unified pipeline. Migrated from old renderPuppetNodes usage.
 */
export function renderCharacterOnionFrameUnified(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  skeleton: PuppetSkeleton,
  character: PuppetCharacter,
  parts: Part[],
  nodeKeyframes: PuppetNodeKeyframe[],
  frame: number,
  frameRate: number,
  globalModifiers?: GlobalModifier[],
  animationVariables?: AnimationVariable[],
): void {
  // Use LiveAdapter to convert to unified Character
  liveAdapter.invalidate();
  const unifiedCharacter = liveAdapter.getCharacter(
    skeleton,
    [character],
    parts,
    nodeKeyframes,
    character.costumeSets ?? [],
  );

  // Build animation variables
  const unifiedVars = animationVariables?.map(v => ({
    id: v.id,
    name: v.name,
    value: v.defaultValue ?? 0,
    min: 0,
    max: 100,
    writerDriverId: v.writerDriverId,
    defaultValue: v.defaultValue ?? 0,
  }));

  const plan = generateRenderPlan(
    unifiedCharacter,
    frame,
    canvasWidth,
    canvasHeight,
    'pixel-perfect',
    frameRate,
    unifiedVars as any,
  );
  executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);
}
