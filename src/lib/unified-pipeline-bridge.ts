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
  Keyframe, PuppetSkeleton, PuppetCharacter, PuppetNodeKeyframe, AnimationClip, Skeleton, ProceduralAnimation,
  EffectTrack, MotionBlurStroke, EffectStroke,
  CanvasModifierTrack, GlobalModifier, AnimationVariable,
  PixelGrid, ModifierType,
} from './types';
import type { Character, RotationStrategy, AnimationVariable as UnifiedAnimationVariable, Sprite } from './unified-types';
import { subToPx } from './unified-types';
import { LiveAdapter } from './migration-adapter';
import {
  generateRenderPlan,
  executeRenderPlan,
  pixelsToCanvas,
} from './unified-render';
// (interpolateNodeKeyframes 已迁移：新管线内部 interpolateTransform 处理)
import { applyPixelModifiers } from './engine/pixel-modifiers';
import { resolveKeyframeModifierParams } from './engine/param-driver';
import { renderEffectTrackFrame } from './engine/effect-render';
import { renderMotionBlurStroke, renderEffectStroke } from './engine/brush-render';
import { evaluateBlueprint } from './blueprint/eval';
import { modifiersToBlueprint } from './blueprint/migrate';
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
  _parts: import('./unified-types').Sprite[],
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
  unifiedCharacters: Record<string, Character> | undefined,
  animationClips: AnimationClip[],
  useUnifiedPipeline: boolean = true,
  globalBlueprint?: import('./blueprint/ir').BlueprintGraph | null,
  sprites?: Record<string, import('./unified-types').Sprite>,
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
  // 统一走 unified pipeline：新管线内部 interpolateTransform 处理关键帧。
  // 直接从新 store 读 unifiedCharacters，不再经 LiveAdapter 转换。
  if (unifiedCharacters && Object.keys(unifiedCharacters).length > 0) {
    renderPuppetViaUnifiedPipeline(
      ctx, canvasWidth, canvasHeight,
      unifiedCharacters,
      animationClips, currentFrame, frameRate,
      globalModifiers, animationVariables, canvasModifierTracks,
      proceduralAnimations, globalBlueprint, sprites,
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
  globalBlueprint?: import('./blueprint/ir').BlueprintGraph | null,
): boolean {
  let globalTransform = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  if (globalModifiers && globalModifiers.length > 0) {
    // 全局修改器走蓝图路径：优先用存储的蓝图（含手工接线），否则现场生成
    const blueprint = globalBlueprint ?? modifiersToBlueprint(globalModifiers as any);
    if (blueprint) {
      const t = evaluateBlueprint(blueprint, {
        frame,
        frameRate,
        vars: {},
      } as any);
      globalTransform = {
        translateX: t.translateX,
        translateY: t.translateY,
        rotation: t.rotation,
        scaleX: t.scaleX,
        scaleY: t.scaleY,
      };
    }
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
  unifiedCharacters: Record<string, Character>,
  animationClips: AnimationClip[],
  currentFrame: number,
  frameRate: number,
  globalModifiers?: GlobalModifier[],
  animationVariables?: AnimationVariable[],
  canvasModifierTracks?: CanvasModifierTrack[],
  proceduralAnimations?: ProceduralAnimation[],
  globalBlueprint?: import('./blueprint/ir').BlueprintGraph | null,
  sprites?: Record<string, import('./unified-types').Sprite>,
): void {
  // Apply global modifier transform (camera/world transform)
  // This matches the old pipeline's behavior in renderPuppetFrame().
  const hasGlobalTransform = applyGlobalTransformWrapper(
    ctx, canvasWidth, canvasHeight, globalModifiers, currentFrame, frameRate, globalBlueprint,
  );

  for (const unifiedCharacter of Object.values(unifiedCharacters)) {
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
      undefined, // backgroundColor
      undefined, // previewQuality
      undefined, // effectTracks
      undefined, // motionBlurStrokes
      undefined, // effectStrokes
      undefined, // autoMotionBlur
      undefined, // autoMotionBlurIntensity
      proceduralAnimations,
      sprites, // global sprite table
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
  _parts: import('./unified-types').Sprite[],
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
  unifiedCharacters?: Record<string, import('./unified-types').Character>,
  sprites?: Record<string, import('./unified-types').Sprite>,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d')!;

  // 注意：孤儿 Part（未被 Character 引用）主画布不渲染，只在编辑画布渲染。
  // 这里不再调用 renderPartsUnified。

  // Render puppet parts via unified pipeline
  // H11: 与实时预览一致，木偶渲染包裹全局变换
  const hasGlobalTransform = applyGlobalTransformWrapper(
    ctx, canvasWidth, canvasHeight, globalModifiers, frame, frameRate, undefined,
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
        _parts,
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
        undefined, // backgroundColor
        undefined, // previewQuality
        undefined, // effectTracks
        undefined, // motionBlurStrokes
        undefined, // effectStrokes
        undefined, // autoMotionBlur
        undefined, // autoMotionBlurIntensity
        undefined, // proceduralAnimations
        sprites, // global sprite table
      );
      executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);
    }
  }

  if (hasGlobalTransform) {
    ctx.restore();
  }

  // Render unifiedCharacters directly (new model, no LiveAdapter)
  if (unifiedCharacters && Object.keys(unifiedCharacters).length > 0) {
    renderPuppetViaUnifiedPipeline(
      ctx, canvasWidth, canvasHeight,
      unifiedCharacters, [], frame, frameRate,
      globalModifiers, animationVariables, canvasModifierTracks,
      undefined, undefined, sprites,
    );
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
  _parts: import('./unified-types').Sprite[],
  nodeKeyframes: PuppetNodeKeyframe[],
  frame: number,
  frameRate: number,
  globalModifiers?: GlobalModifier[],
  animationVariables?: AnimationVariable[],
  sprites?: Record<string, import('./unified-types').Sprite>,
): void {
  // Use LiveAdapter to convert to unified Character
  liveAdapter.invalidate();
  const unifiedCharacter = liveAdapter.getCharacter(
    skeleton,
    [character],
    _parts,
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
    undefined, // backgroundColor
    undefined, // previewQuality
    undefined, // effectTracks
    undefined, // motionBlurStrokes
    undefined, // effectStrokes
    undefined, // autoMotionBlur
    undefined, // autoMotionBlurIntensity
    undefined, // proceduralAnimations
    sprites, // global sprite table
  );
  executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);
}

/**
 * Render a single unified Character at a specific frame for onion skin.
 * New model: accepts a pre-converted Character directly (no LiveAdapter needed).
 */
export function renderCharacterOnionFrameFromCharacter(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  character: Character,
  nodeKeyframes: import('./unified-types').UnifiedKeyframe[],
  frame: number,
  frameRate: number,
  globalModifiers?: GlobalModifier[],
  animationVariables?: AnimationVariable[],
  sprites?: Record<string, import('./unified-types').Sprite>,
): void {
  // Convert UnifiedKeyframe format if needed (currently using old format via adapter)
  // For now, the Character from syncPuppetToUnified already has tracks populated
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
    character,
    frame,
    canvasWidth,
    canvasHeight,
    'pixel-perfect',
    frameRate,
    unifiedVars as any,
    undefined, // backgroundColor
    undefined, // previewQuality
    undefined, // effectTracks
    undefined, // motionBlurStrokes
    undefined, // effectStrokes
    undefined, // autoMotionBlur
    undefined, // autoMotionBlurIntensity
    undefined, // proceduralAnimations
    sprites, // global sprite table
  );
  executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);
}

/**
 * Render multiple unified Characters to a canvas (for export).
 * New model: accepts Character[] directly.
 */
export function renderUnifiedCharactersToCanvas(
  canvasWidth: number,
  canvasHeight: number,
  characters: Character[],
  frame: number,
  backgroundColor: string,
  frameRate: number = 12,
  globalModifiers?: GlobalModifier[],
  animationVariables?: AnimationVariable[],
  canvasModifierTracks?: CanvasModifierTrack[],
  sprites?: Record<string, import('./unified-types').Sprite>,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d')!;

  // Background
  if (backgroundColor && backgroundColor !== 'rgba(0,0,0,0)') {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  const hasGlobalTransform = applyGlobalTransformWrapper(
    ctx, canvasWidth, canvasHeight, globalModifiers, frame, frameRate, undefined,
  );

  for (const character of characters) {
    const unifiedVars: UnifiedAnimationVariable[] | undefined = animationVariables?.map(v => ({
      id: v.id,
      name: v.name,
      value: v.defaultValue ?? 0,
      min: 0,
      max: 100,
      writerDriverId: v.writerDriverId,
      defaultValue: v.defaultValue ?? 0,
    }));
    const plan = generateRenderPlan(
      character,
      frame,
      canvasWidth,
      canvasHeight,
      'pixel-perfect',
      frameRate,
      unifiedVars,
      undefined, // backgroundColor
      undefined, // previewQuality
      undefined, // effectTracks
      undefined, // motionBlurStrokes
      undefined, // effectStrokes
      undefined, // autoMotionBlur
      undefined, // autoMotionBlurIntensity
      undefined, // proceduralAnimations
      sprites, // global sprite table
    );
    executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);
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

// ---- Part Edit Mode (moved from unified-render.ts) ----
// Transition function: renders old Part data for the sprite editor.
// Lives in the bridge layer (not the new-pipeline core) by design.

/**
 * Render a single Sprite centered on canvas for sprite editing.
 * Migrated from old `renderPartEditMode` in render-pipeline.ts.
 * Applies pixel modifiers via the blueprint pixel pipeline, then draws.
 */
export function renderSpriteEditUnified(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  partEditModifiers: any[],
  canvasWidth: number,
  canvasHeight: number,
  currentFrame: number = 0,
  sprites?: Record<string, import('./unified-types').Sprite>,
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Center the part on the canvas
  const centerX = Math.floor((canvasWidth - sprite.width) / 2);
  const centerY = Math.floor((canvasHeight - sprite.height) / 2);

  // Resolve paramKeyframes and paramDrivers before applying pixel modifiers
  const resolvedMods = (partEditModifiers.some(m =>
    (m.paramKeyframes && m.paramKeyframes.length > 0) ||
    (m.paramDrivers && m.paramDrivers.length > 0 && m.paramDrivers.some((d: any) => d.enabled && !d.isBaked))
  ))
    ? resolveKeyframeModifierParams(partEditModifiers, currentFrame)
    : partEditModifiers;

  // Apply pixel-level modifiers via blueprint pipeline
  const pixelModTypes: ModifierType[] = [
    'color_replace', 'outline', 'dither', 'pixel_displace',
    'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip', 'pixel_edit',
  ];
  const activePixelMods = resolvedMods.filter(m => pixelModTypes.includes(m.type) && m.enabled);

  let pixels: PixelGrid;
  let modOffsetX = 0;
  let modOffsetY = 0;
  if (activePixelMods.length > 0) {
    const modResult = applyPixelModifiers(sprite.data, activePixelMods, currentFrame);
    pixels = modResult.pixels;
    modOffsetX = modResult.offsetX;
    modOffsetY = modResult.offsetY;
  } else {
    pixels = sprite.data;
  }

  // Apply pixel shift from translate modifiers
  const translateMod = resolvedMods.find(m => m.type === 'translate' && m.enabled);
  let shiftX = 0, shiftY = 0;
  if (translateMod) {
    shiftX = Math.round(Number(translateMod.params.offsetX) || 0);
    shiftY = Math.round(Number(translateMod.params.offsetY) || 0);
  }

  // Render pixels
  const gridH = pixels.length;
  const gridW = pixels[0]?.length || 0;
  const originX = centerX - modOffsetX;
  const originY = centerY - modOffsetY;

  ctx.imageSmoothingEnabled = false;

  // Use pixelsToCanvas helper if available, else manual ImageData
  const spriteCanvas = pixelsToCanvas(pixels, gridW, gridH);
  if (spriteCanvas) {
    // Apply shift by drawing at offset
    ctx.drawImage(spriteCanvas, originX + shiftX, originY + shiftY);
  }

  // Draw part boundary indicator
  ctx.strokeStyle = 'rgba(100, 200, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(centerX - 0.5, centerY - 0.5, sprite.width + 1, sprite.height + 1);

  // Draw pivot cross
  ctx.strokeStyle = 'rgba(255, 200, 50, 0.5)';
  ctx.lineWidth = 1;
  const pivotScreenX = centerX + (sprite.plug ? subToPx(sprite.plug.x) : sprite.width / 2);
  const pivotScreenY = centerY + (sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2);
  ctx.beginPath();
  ctx.moveTo(pivotScreenX - 4, pivotScreenY);
  ctx.lineTo(pivotScreenX + 4, pivotScreenY);
  ctx.moveTo(pivotScreenX, pivotScreenY - 4);
  ctx.lineTo(pivotScreenX, pivotScreenY + 4);
  ctx.stroke();
}
