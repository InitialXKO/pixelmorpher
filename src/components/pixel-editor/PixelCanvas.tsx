'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import { registerRenderCallback } from '@/lib/playback-scheduler';
import { drawTileGridToCanvas } from '@/lib/tile-blob-engine';
import { renderCharacterOnionFrameFromCharacter, geometryDirectionFromToggle } from '@/lib/unified-render';
import { editorClampContextFor } from '@/lib/clamp-session';
import { editorSimContextFor } from '@/lib/sim-session';
import { clearJointDiscs, regenerateJointDiscs } from '@/lib/joint-discs';
import { renderSpriteEditUnified } from '@/lib/unified-render';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import { renderUnified, invalidateUnifiedPipelineCache } from '@/lib/unified-render';
import { beginPickFrame, endPickFrame } from '@/lib/pick-buffer';
import { useCanvasState } from './canvas/use-canvas-state';
import { useCanvasInteraction } from './canvas/use-canvas-interaction';
import MaskBrushOverlay from './MaskBrushOverlay';
import {
  renderGridOverlay,
  renderCanvasBorder,
  renderSelectionOverlay,
  renderLandmarkOverlay,
  renderMarkOverlay,
  renderLassoPreview,
  renderHandDrawnTrajectoryPreview,
  renderCropPreview,
  renderTrajectoryOverlay,
} from './canvas/canvas-render-helpers';
import {
  renderPuppetSkeletonOverlay,
  renderIKTargetHandles,
  renderClampAnchorGizmos,
  renderFaceGuideOverlay,
  renderPivotCrosshair,
  renderStrokeCursorIndicator,
  renderFpsCounter,
} from './canvas/canvas-puppet-render';
import { proportionGuideDataUrl, type ProportionView } from '@/lib/proportion-guide';
import { acquireCanvas, releaseCanvas } from '@/lib/engine/canvas-pool';
import { getCursorStyle, isStrokeToolCheck } from './canvas/canvas-utils';
import { spriteEditCanvasOrigin } from './canvas/tool-handlers';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Check } from 'lucide-react';
import { addChildNode, addSocketToNode, deleteNodeSubtree } from '@/lib/node-actions';

// ============================================================
// PixelCanvas - Central canvas for PixelMorpher pixel animation
// ============================================================

/**
 * 角色显示过滤：互斥模式下只返回选中角色。
 * - perform 阶段且 showAllCharacters=true → 全部
 * - 否则若 performCharacterId 有值 → 仅该角色
 * - 否则 → 全部（无选中时的回退）
 */
function filterVisibleCharacters<T extends { id: string }>(
  characters: T[],
  session: { showAllCharacters: boolean; performCharacterId: string | null },
): T[] {
  if (session.showAllCharacters) {
    return characters;
  }
  if (session.performCharacterId) {
    const selected = characters.filter((c) => c.id === session.performCharacterId);
    // 选中角色不在列表里时回退到全部（避免画布空白）
    return selected.length > 0 ? selected : characters;
  }
  return characters;
}

export default function PixelCanvas() {
  const s = useCanvasState();
  const interaction = useCanvasInteraction(s);

  // 订阅角色显示状态，变化时触发重渲染
  const showAllCharacters = usePuppetSessionStore((st) => st.showAllCharacters);
  const performCharacterId = usePuppetSessionStore((st) => st.performCharacterId);
  const performArmed = usePuppetSessionStore((st) => st.performArmed);
  // 订阅当前帧，播放时触发 render 回调更新（否则闭包里的 currentFrame 是旧的）
  const storeCurrentFrame = useProjectStore((st) => st.currentFrame);
  // 订阅精灵编辑模式的 sprite ID（从 Part 迁移到 Sprite）
  const spriteEditSpriteId = useEditorStore((st) => st.spriteEditSpriteId);

  // ---- Render loop ----
  const render = useCallback(() => {
    const canvas = s.canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const currentFrame = storeCurrentFrame;
    const zoom = s.zoomRef.current;
    const panX = s.panRef.current.x;
    const panY = s.panRef.current.y;

    const rc = { ctx, canvasWidth: s.canvasWidth, canvasHeight: s.canvasHeight, zoom, panX, panY, currentFrame };

    // Create offscreen canvas
    if (!s.offscreenRef.current) s.offscreenRef.current = document.createElement('canvas');
    const offscreen = s.offscreenRef.current;
    offscreen.width = s.canvasWidth;
    offscreen.height = s.canvasHeight;
    const offCtx = offscreen.getContext('2d')!;

    // 0. 参考图：直接画在离屏画布上（DOM <img> 方案废弃，会被不透明填充盖住）
    if (s.referenceImageUrl && s.referenceImageVisible) {
      // 注意：img.src 是绝对路径，不能直接和相对路径的 referenceImageUrl 比
      // 用 dataset 存原始 URL 来比对
      const cached = s.refImageRef.current;
      if (!cached || cached.dataset.url !== s.referenceImageUrl) {
        const img = new Image();
        img.dataset.url = s.referenceImageUrl;
        img.src = s.referenceImageUrl;
        // 加载完成后触发重绘
        img.onload = () => s.markDirty();
        s.refImageRef.current = img;
      }
      const img = s.refImageRef.current;
      if (img && img.complete && img.naturalWidth > 0) {
        offCtx.save();
        offCtx.globalAlpha = s.referenceImageOpacity;
        // contain 模式居中绘制
        const scale = Math.min(s.canvasWidth / img.naturalWidth, s.canvasHeight / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        const dx = (s.canvasWidth - dw) / 2;
        const dy = (s.canvasHeight - dh) / 2;
        offCtx.imageSmoothingEnabled = false;
        offCtx.drawImage(img, dx, dy, dw, dh);
        offCtx.restore();
      }
    }

    // 1. Onion skin with transform filtering
    // Determine onion quality based on play state — use 'low' during playback for 60-80% frame time reduction
    const isPlaying = s.playStateRef.current === 'playing';
    const onionQuality: 'low' | 'medium' = isPlaying ? 'low' : 'medium';
    // V15: Read onion skin transform filter settings from store
    const storeState = useProjectStore.getState();
    const onionFilterMode = storeState.onionTransformFilter?.filterMode ?? 'all';
    const showDisplacement = storeState.onionSkinState?.showDisplacement ?? true;
    const showRotation = storeState.onionSkinState?.showRotation ?? true;
    const showStretch = storeState.onionSkinState?.showStretch ?? true;
    const displacementColor = storeState.onionSkinState?.displacementColor ?? 'rgba(60,120,255,0.3)';
    const rotationColor = storeState.onionSkinState?.rotationColor ?? 'rgba(255,120,40,0.3)';
    const stretchColor = storeState.onionSkinState?.stretchColor ?? 'rgba(40,255,120,0.3)';
    // Compute tint color based on filter mode
    const getTintColor = (isPrev: boolean): string => {
      if (onionFilterMode === 'displacement') return 'rgba(60,120,255,0.35)';
      if (onionFilterMode === 'rotation') return 'rgba(255,120,40,0.35)';
      if (onionFilterMode === 'stretch') return 'rgba(40,255,120,0.35)';
      return isPrev ? 'rgba(60,120,255,0.3)' : 'rgba(255,120,40,0.3)';
    };
    if (s.onionSkinEnabled && s.onionSkinFrames > 0) {
      offCtx.save();
      offCtx.clearRect(0, 0, s.canvasWidth, s.canvasHeight);
      const curVersion = s.onionDataVersionRef.current;
      const kfHash = s.keyframes.map(kf => `${kf.id}:${kf.frame}:${kf.modifiers.length}`).join('|')
        + `|tracks:${JSON.stringify(Object.values(useProjectStore.getState().unifiedCharacters).map((c) => Object.values(c.nodes).map((n) => n.tracks ?? null)))}`;

      // 木偶洋葱皮：把指定帧的木偶角色渲染进洋葱缓存画布（新模型）
      // 与顶端开关同构：外层 s.onionSkinEnabled 已控制，此处不再单独检查
      const renderPuppetOnionFrame = (cacheCtx: CanvasRenderingContext2D, frame: number) => {
        const pst = useProjectStore.getState();
        const unifiedChars = pst.unifiedCharacters ?? {};
        const allCharacters = Object.values(unifiedChars);
        if (allCharacters.length === 0) return;
        // 角色显示互斥：非 perform 或未开启"显示全部"时，只渲染选中角色
        // 新模型：performCharacterId 直接是 unified Character ID
        const session = usePuppetSessionStore.getState();
        let characters = allCharacters;
        if (!session.showAllCharacters && session.performCharacterId) {
          const matched = allCharacters.filter((c) => c.id === session.performCharacterId);
          if (matched.length > 0) characters = matched;
        }
        for (const character of characters) {
          try {
            // 新模型：Character 已包含 tracks（sync 时合并），无需单独传 keyframes
            renderCharacterOnionFrameFromCharacter(
              cacheCtx, s.canvasWidth, s.canvasHeight, character,
              frame,
              s.frameRate, s.globalModifiers, s.animationVariables, undefined,
              geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D)
            );
          } catch { /* 单个角色渲染失败不影响其它 */ }
        }
      };

      for (let offset = 1; offset <= s.onionSkinFrames; offset++) {
        const prevFrame = currentFrame - offset;
        const nextFrame = currentFrame + offset;

        if (prevFrame >= 0) {
          offCtx.save();
          offCtx.globalAlpha = Math.max(0.05, 0.25 / offset);
          offCtx.globalCompositeOperation = 'source-over';
          const cached = s.onionCacheRef.current.get(prevFrame);
          if (!cached || cached.version < curVersion || cached.keyframeHash !== kfHash) {
            // Use canvas pool instead of createElement to reduce GC pressure
            const cacheCanvas = acquireCanvas(s.canvasWidth, s.canvasHeight);
            const cacheCtx = cacheCanvas.getContext('2d')!;
            // 重构后画布只画木偶，nonPuppetParts 死代码已删
            renderPuppetOnionFrame(cacheCtx, prevFrame);
            s.onionCacheRef.current.set(prevFrame, { canvas: cacheCanvas, version: curVersion, keyframeHash: kfHash });
          }
          offCtx.drawImage(s.onionCacheRef.current.get(prevFrame)!.canvas, 0, 0);
          offCtx.globalCompositeOperation = 'source-atop';
          offCtx.fillStyle = getTintColor(true);
          offCtx.fillRect(0, 0, s.canvasWidth, s.canvasHeight);
          offCtx.restore();
        }

        if (nextFrame < useProjectStore.getState().totalFrames) {
          offCtx.save();
          offCtx.globalAlpha = Math.max(0.05, 0.25 / offset);
          offCtx.globalCompositeOperation = 'source-over';
          const cached = s.onionCacheRef.current.get(nextFrame);
          if (!cached || cached.version < curVersion || cached.keyframeHash !== kfHash) {
            const cacheCanvas = acquireCanvas(s.canvasWidth, s.canvasHeight);
            const cacheCtx = cacheCanvas.getContext('2d')!;
            // 重构后画布只画木偶，nonPuppetParts 死代码已删
            renderPuppetOnionFrame(cacheCtx, nextFrame);
            s.onionCacheRef.current.set(nextFrame, { canvas: cacheCanvas, version: curVersion, keyframeHash: kfHash });
          }
          offCtx.drawImage(s.onionCacheRef.current.get(nextFrame)!.canvas, 0, 0);
          offCtx.globalCompositeOperation = 'source-atop';
          offCtx.fillStyle = getTintColor(false);
          offCtx.fillRect(0, 0, s.canvasWidth, s.canvasHeight);
          offCtx.restore();
        }
      }
      offCtx.restore();

      // Trim onion cache — also release pooled canvases back to pool
      const maxCacheSize = Math.max(20, s.onionSkinFrames * 4);
      if (s.onionCacheRef.current.size > maxCacheSize) {
        const entries = [...s.onionCacheRef.current.entries()];
        entries.sort((a, b) => Math.abs(a[0] - currentFrame) - Math.abs(b[0] - currentFrame));
        const toKeep = new Set(entries.slice(0, maxCacheSize).map(e => e[0]));
        for (const [key, val] of s.onionCacheRef.current.entries()) {
          if (!toKeep.has(key)) {
            releaseCanvas(val.canvas);
            s.onionCacheRef.current.delete(key);
          }
        }
      }
    }

    // 2. Render current frame
    // 精灵编辑模式：从全局 sprites 表取 Sprite（已从 Part 迁移）
    if (s.editMode === 'sprite_edit' && spriteEditSpriteId) {
      const sprite = useProjectStore.getState().sprites[spriteEditSpriteId];
      if (sprite) {
        let effectiveMods = s.spriteEditModifiers;
        if (s.spriteEditBrushCmdRef.current) {
          const { modifierId, commandId, points } = s.spriteEditBrushCmdRef.current;
          if (points.length > 0) {
            const cmd: import('@/lib/types').BrushCommand = {
              id: commandId, type: s.tool === 'eraser' ? 'erase' : 'draw', color: s.brushColor, size: s.brushSize,
              points, blendMode: 'normal', brushStyle: s.brushStyle !== 'solid' ? s.brushStyle : undefined,
              brushStyleParams: s.brushStyle !== 'solid' ? s.brushStyleParams : undefined,
              ...(s.compositingMode && (s.styleAspects.length > 0 || s.strokeDrivers.length > 0) ? { styleAspects: s.styleAspects.filter(a => a.enabled), strokeDrivers: s.strokeDrivers.filter(d => d.enabled) } : {}),
            };
            effectiveMods = s.spriteEditModifiers.map(m => {
              if (m.id !== modifierId) return m;
              const existingCommands: import('@/lib/types').BrushCommand[] = (m.params.brushCommands as import('@/lib/types').BrushCommand[]) || [];
              return { ...m, params: { ...m.params, brushCommands: [...existingCommands, cmd] } } as import('@/lib/types').ModifierInstance;
            });
          }
        }
        renderSpriteEditUnified(offCtx, sprite, effectiveMods, s.canvasWidth, s.canvasHeight, currentFrame);
      }
    } else {
      const animationClips = useProjectStore.getState().animationClips;
      // 角色显示互斥过滤
      const puppetSession = usePuppetSessionStore.getState();
      // 必须从 store 直接读最新的 characters：闭包里的引用在蓝图挂载后可能还是旧的
      // 在蓝图挂载后可能还是旧引用，导致播放时读不到 blueprint
      const freshStore = useProjectStore.getState();
      // 新模型：数据直写 unifiedCharacters，无需每帧同步
      const unifiedCharacters = useProjectStore.getState().unifiedCharacters;
      const globalBlueprint = useProjectStore.getState().globalBlueprint;
      // 参考图可见时用透明背景，让参考图透出来做底
      const bgColor = (s.referenceImageUrl && s.referenceImageVisible) ? 'transparent' : s.backgroundColor;
      // 拾取编号图与主画布同帧并行绘制（命中读绘制结果，见 pick-buffer）
      beginPickFrame({
        characters: unifiedCharacters, sprites: freshStore.sprites,
        frame: currentFrame, canvasWidth: s.canvasWidth, canvasHeight: s.canvasHeight,
        nodeTurn3D: useEditorStore.getState().nodeTurn3D,
      });
      try {
        renderUnified(offCtx, s.canvasWidth, s.canvasHeight, Object.values(freshStore.sprites), s.keyframes, currentFrame, bgColor,
          s.effectTracks, s.motionBlurStrokes, s.effectStrokes, s.autoMotionBlur, s.autoMotionBlurIntensity,
          s.proceduralAnimations, s.canvasModifierTracks, s.frameRate, 'high',
          s.animationVariables, s.globalModifiers, unifiedCharacters, animationClips, true, globalBlueprint,
          freshStore.sprites, s.perspectiveForeshorten, freshStore.activeAnimationClipId,
          geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D),
          useEditorStore.getState().showMannequinFallback,
          {
            sleeveRatio: useEditorStore.getState().mannequinSleeveRatio,
            pantsRatio: useEditorStore.getState().mannequinPantsRatio,
            fogStrength: useEditorStore.getState().depthFogStrength,
            faceGuide: useEditorStore.getState().showFaceGuide,
          },
          (ch) => editorClampContextFor(ch, currentFrame, animationClips, {
            canvasWidth: s.canvasWidth, canvasHeight: s.canvasHeight,
            frameRate: s.frameRate, sprites: freshStore.sprites,
          }),
          (ch) => useEditorStore.getState().simRealtimePreview
            ? editorSimContextFor(ch, currentFrame, animationClips, {
                canvasWidth: s.canvasWidth, canvasHeight: s.canvasHeight,
                frameRate: s.frameRate,
              })
            : undefined);
      } finally {
        endPickFrame();
      }
    }

    // 3. Stroke preview
    if (s.isDrawingRef.current && isStrokeToolCheck(s.tool)) {
      interaction.renderStrokePreview(offCtx);
    }

    // 4. Draw offscreen to main canvas
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(offscreen, 0, 0, s.canvasWidth, s.canvasHeight, panX, panY, s.canvasWidth * zoom, s.canvasHeight * zoom);

    // 5. Onion skin overlay on main canvas — SKIP during playback to save 50-80% frame time
    // The offscreen canvas already has the onion skin tinted; we only need this second
    // pass when we need a separate overlay compositing step (which is for visual quality).
    // During playback, the first pass (step 1) is sufficient.
    if (s.onionSkinEnabled && s.onionSkinFrames > 0 && !isPlaying) {
      if (!s.onionOverlayRef.current) s.onionOverlayRef.current = document.createElement('canvas');
      const onionCanvas = s.onionOverlayRef.current;
      onionCanvas.width = s.canvasWidth; onionCanvas.height = s.canvasHeight;
      const onionCtx = onionCanvas.getContext('2d')!;
      onionCtx.clearRect(0, 0, s.canvasWidth, s.canvasHeight);
      for (let offset = 1; offset <= s.onionSkinFrames; offset++) {
        const prevFrame = currentFrame - offset;
        const nextFrame = currentFrame + offset;
        if (prevFrame >= 0) {
          onionCtx.save(); onionCtx.globalAlpha = Math.max(0.05, 0.3 / offset);
          const cached = s.onionCacheRef.current.get(prevFrame);
          if (cached) onionCtx.drawImage(cached.canvas, 0, 0);
          onionCtx.globalCompositeOperation = 'source-atop'; onionCtx.fillStyle = getTintColor(true);
          onionCtx.fillRect(0, 0, s.canvasWidth, s.canvasHeight); onionCtx.restore();
        }
        if (nextFrame < useProjectStore.getState().totalFrames) {
          onionCtx.save(); onionCtx.globalAlpha = Math.max(0.05, 0.3 / offset);
          const cached = s.onionCacheRef.current.get(nextFrame);
          if (cached) onionCtx.drawImage(cached.canvas, 0, 0);
          onionCtx.globalCompositeOperation = 'source-atop'; onionCtx.fillStyle = getTintColor(false);
          onionCtx.fillRect(0, 0, s.canvasWidth, s.canvasHeight); onionCtx.restore();
        }
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(onionCanvas, 0, 0, s.canvasWidth, s.canvasHeight, panX, panY, s.canvasWidth * zoom, s.canvasHeight * zoom);
    }

    // 6-10. Overlays
    if (s.showGrid) renderGridOverlay(rc);
    renderCanvasBorder(rc);
    // sprite_edit 下选区 mask 存的是精灵局部坐标，绘制时加回精灵的画布原点偏移
    const selOrigin = s.editMode === 'sprite_edit' ? spriteEditCanvasOrigin(s) : { x: 0, y: 0 };
    s.selectionMarchOffsetRef.current = renderSelectionOverlay(rc, s.selectionMaskRef.current, s.selectionMarchOffsetRef.current, selOrigin.x, selOrigin.y);

    // sprite_edit 下绘制已标注的特征点（蒙皮转面）
    if (s.editMode === 'sprite_edit' && spriteEditSpriteId) {
      const lmSprite = useProjectStore.getState().sprites[spriteEditSpriteId];
      if (lmSprite?.landmarks) {
        renderLandmarkOverlay(rc, lmSprite.landmarks, lmSprite.width, lmSprite.height, selOrigin.x, selOrigin.y);
      }
      // 精灵标记（点/选区/矢量/方向）：拖拽中按工作副本预览
      if (lmSprite && (lmSprite.marks?.length || useEditorStore.getState().markDrag)) {
        const es = useEditorStore.getState();
        renderMarkOverlay(rc, lmSprite, selOrigin.x, selOrigin.y, es.selectedMarkId, es.markDrag);
      }
    }

    if (s.isDrawingRef.current && s.tool === 'lasso') renderLassoPreview(rc, s.lassoPathRef.current);
    if (s.isDrawingRef.current && s.tool === 'trajectory') renderHandDrawnTrajectoryPreview(rc, s.handDrawTrajectoryRef.current);
    if (s.isDrawingRef.current && s.tool === 'crop') renderCropPreview(rc, s.cropRectRef.current);

    renderTrajectoryOverlay(rc, { showTrajectories: s.showTrajectories, trajectories: s.trajectories, selectedSpriteId: s.selectedSpriteId, editMode: s.editMode, trajectorySnap: s.trajectorySnap, totalFrames: useProjectStore.getState().totalFrames });

    // Skip puppet skeleton overlay during playback — reduces non-essential drawing overhead
    if (!isPlaying) {
      // 新模型：从 unifiedCharacters 获取（确保已同步）
      const pst = useProjectStore.getState();
      const unifiedChars = pst.unifiedCharacters ?? {};
      const charList = Object.values(unifiedChars);
      renderPuppetSkeletonOverlay(rc, {
        shouldRender: s.showPuppetSkeleton && charList.length > 0,
        characters: charList, activePuppetSkeletonId: s.activePuppetSkeletonId,
        selectedNodeId: s.selectedNodeId,
        animationClips: useProjectStore.getState().animationClips, sprites: Object.values(useProjectStore.getState().sprites),
      });
      // IK 目标手柄（启用的链）
      const activeChar = charList.find((c) => c.id === s.activePuppetSkeletonId) ?? charList[0];
      if (activeChar && s.showPuppetSkeleton) {
        renderIKTargetHandles(rc, activeChar);
        renderClampAnchorGizmos(rc, activeChar);
      }
      // 五官参照（选中节点头部框点位）
      if (activeChar && useEditorStore.getState().showFaceGuide) {
        renderFaceGuideOverlay(rc, activeChar, s.selectedNodeId);
      }
    }

    renderPivotCrosshair(rc, s.selectedPart, s.getInterpolatedTranslateOffset);
    renderStrokeCursorIndicator(rc, s.isDrawingRef.current, s.tool, isStrokeToolCheck(s.tool), s.lastPixelRef.current);

    // FPS counter
    if (process.env.NODE_ENV === 'development') {
      s.fpsFramesRef.current++;
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      if (now - s.fpsLastTimeRef.current >= 5000) {
        const fps = Math.round(s.fpsFramesRef.current / ((now - s.fpsLastTimeRef.current) / 1000));
        s.setFpsDisplay(`${fps} fps`);
        s.fpsFramesRef.current = 0;
        s.fpsLastTimeRef.current = now;
      }
      renderFpsCounter(ctx, s.fpsDisplay);
    }
  // Dependencies reduced: moved rarely-changing values to refs to avoid unnecessary
  // re-creation of the render callback. Only truly render-affecting state is listed.
  // During playback, most of these don't change, so the callback stays stable.
  }, [
    s.canvasWidth, s.canvasHeight, useProjectStore.getState().sprites, s.keyframes, s.backgroundColor,
    s.onionSkinEnabled, s.onionSkinFrames, s.showGrid, s.showTrajectories, s.editMode,
    s.trajectories, s.selectedPart, s.selectedSpriteId, s.motionBlurStrokes, s.effectStrokes,
    s.effectTracks, s.autoMotionBlur, s.autoMotionBlurIntensity, s.tool,
    s.showPuppetSkeleton, s.unifiedCharacters,
    s.canvasModifierTracks, spriteEditSpriteId, s.spriteEditModifiers,
    interaction.renderStrokePreview, s.getInterpolatedTranslateOffset,
    showAllCharacters, performCharacterId, storeCurrentFrame,
    // 参考图：URL/可见性/不透明度变化时重建 render，否则闭包里是旧 s
    s.referenceImageUrl, s.referenceImageVisible, s.referenceImageOpacity,
  ]);

  // 用 ref 存最新 render，避免 effect 反复重建导致旧闭包执行
  const renderRef = React.useRef(render);
  renderRef.current = render;

  // 参考图变化时标记重绘
  useEffect(() => {
    s.markDirty();
  }, [s.referenceImageUrl, s.referenceImageVisible, s.referenceImageOpacity]);

  // 覆盖层开关变化时标记重绘（网格/骨骼/轨迹等）
  useEffect(() => {
    s.markDirty();
  }, [s.showGrid, s.showPuppetSkeleton, s.showTrajectories, s.perspectiveForeshorten]);

  // 节点关键帧变化时标记重绘
  const animationClips = useProjectStore((s) => s.animationClips);
  useEffect(() => {
    s.markDirty();
  }, [animationClips]);

  // Animation loop
  useEffect(() => {
    s.dirtyRef.current = true;
    const unregisterScheduler = registerRenderCallback(() => { s.dirtyRef.current = true; });
    const loop = () => {
      const isPlaying = useEditorStore.getState().playState === 'playing';
      if (s.dirtyRef.current || isPlaying) { s.dirtyRef.current = false; renderRef.current(); }
      s.rafRef.current = requestAnimationFrame(loop);
    };
    s.rafRef.current = requestAnimationFrame(loop);

    // 参考图装配：聚焦到指定节点
    const handleFocusNode = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const { nodeId, skeletonId } = detail;
      const projectState = useProjectStore.getState();
      // 新模型：从 unifiedCharacters 获取
      const character = projectState.unifiedCharacters?.[skeletonId]
        ?? null;
      const node = character?.nodes[nodeId];
      if (!character || !node) return;
      // 计算世界坐标
      const worldPos = s.computePivotWorldPosition(node, character, s.canvasWidth, s.canvasHeight);
      // 设置 zoom=3，平移使节点居中
      const zoom = 3;
      const editorStore = useEditorStore.getState();
      editorStore.setZoom(zoom);
      // 容器尺寸
      const container = s.containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const panX = rect.width / 2 - worldPos.x * zoom;
        const panY = rect.height / 2 - worldPos.y * zoom;
        editorStore.setPan(panX, panY);
      }
    };
    window.addEventListener('ref-assembly:focus-node', handleFocusNode);

    return () => {
      unregisterScheduler();
      if (s.rafRef.current) cancelAnimationFrame(s.rafRef.current);
      window.removeEventListener('ref-assembly:focus-node', handleFocusNode);
    };
  }, []); // 不依赖 render，用 ref 拿最新的

  const cursorStyle = s.editMode === 'correction' ? 'crosshair' : getCursorStyle(s.tool, s.spaceHeldRef.current, performArmed);

  // ---- 右键菜单（命中节点 → 节点操作；空白 → 视图/缩放；有选区 → 追加提取） ----
  const [menuTarget, setMenuTarget] = useState<{
    nodeId: string;
    characterId: string;
    nodeName: string;
    nodeVisible: boolean;
    isRoot: boolean;
  } | null>(null);
  const [menuHasSelection, setMenuHasSelection] = useState(false);
  const showGrid = useEditorStore((x) => x.showGrid);
  const nodeLockId = useEditorStore((x) => x.nodeLockId);
  const lockedNodeName = useProjectStore((x) => {
    if (!nodeLockId) return null;
    for (const ch of Object.values(x.unifiedCharacters)) {
      const n = ch.nodes[nodeLockId];
      if (n) return n.name;
    }
    return null;
  });
  const nodeTurn3D = useEditorStore((x) => x.nodeTurn3D);
  const activePuppetSkeletonId = useEditorStore((x) => x.activePuppetSkeletonId);
  const showPuppetSkeleton = useEditorStore((x) => x.showPuppetSkeleton);
  const showMannequinFallback = useEditorStore((x) => x.showMannequinFallback);
  // 人偶兜底开关变化时标记重绘（render 内部走 getState 读最新值）
  useEffect(() => { s.markDirty(); }, [showMannequinFallback]); // eslint-disable-line react-hooks/exhaustive-deps
  const showFaceGuide = useEditorStore((x) => x.showFaceGuide);
  useEffect(() => { s.markDirty(); }, [showFaceGuide]); // eslint-disable-line react-hooks/exhaustive-deps
  const mannequinSleeveRatio = useEditorStore((x) => x.mannequinSleeveRatio);
  const mannequinPantsRatio = useEditorStore((x) => x.mannequinPantsRatio);
  const depthFogStrength = useEditorStore((x) => x.depthFogStrength);
  useEffect(() => { s.markDirty(); }, [mannequinSleeveRatio, mannequinPantsRatio, depthFogStrength]); // eslint-disable-line react-hooks/exhaustive-deps
  // 比例垫图：内置比例人偶生成图 → 走既有参考图通道（与外部图源并列）
  const applyProportionGuide = useCallback((presetId: string, view: ProportionView) => {
    const url = proportionGuideDataUrl(presetId, view);
    useEditorStore.getState().setReferenceImageUrl(url);
    useEditorStore.getState().setReferenceImageVisible(true);
    s.markDirty();
  }, [s]);
  const onionSkinEnabled = useProjectStore((x) => x.onionSkinEnabled);

  const handleCanvasContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const { px, py } = s.screenToPixel(e.clientX, e.clientY);
      const hit = s.findPuppetNodeAtPixel(px, py);
      if (hit) {
        useProjectStore.getState().setSelectedNodeId(hit.node.id);
        useEditorStore.getState().setActivePuppetSkeletonId(hit.character.id);
        setMenuTarget({
          nodeId: hit.node.id,
          characterId: hit.character.id,
          nodeName: hit.node.name,
          nodeVisible: hit.node.visible,
          isRoot: hit.character.rootNodeId === hit.node.id,
        });
      } else {
        setMenuTarget(null);
      }
      setMenuHasSelection(s.selectionMaskRef.current.size > 0);
    },
    [s],
  );

  const focusInputById = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  };

  const zoomBy = (factor: number) => {
    const es = useEditorStore.getState();
    es.setZoom(es.zoom * factor);
  };
  const zoomFit = () => {
    const el = s.containerRef.current;
    if (!el) return;
    const es = useEditorStore.getState();
    const z = Math.min(el.clientWidth / s.canvasWidth, el.clientHeight / s.canvasHeight);
    es.setZoom(z);
    const az = useEditorStore.getState().zoom;
    es.setPan((el.clientWidth - s.canvasWidth * az) / 2, (el.clientHeight - s.canvasHeight * az) / 2);
  };
  const applyJointDiscOp = (op: 'clear' | 'regen') => {
    const st = useProjectStore.getState();
    const id = useEditorStore.getState().activePuppetSkeletonId;
    const ch = id ? st.unifiedCharacters[id] : undefined;
    if (!id || !ch) return;
    const r = op === 'clear' ? clearJointDiscs(ch) : regenerateJointDiscs(ch, st.sprites);
    if (r.changed === 0) return;
    st.pushUndo(op === 'clear' ? '清除关节盘' : '重新生成关节盘');
    st.updateUnifiedCharacter(id, { nodes: r.character.nodes });
  };

  const zoom100 = () => {
    const el = s.containerRef.current;
    if (!el) return;
    const es = useEditorStore.getState();
    es.setZoom(1);
    es.setPan((el.clientWidth - s.canvasWidth) / 2, (el.clientHeight - s.canvasHeight) / 2);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <div id="pixel-canvas-root" ref={s.containerRef} className="relative w-full h-full overflow-hidden" style={{ background: '#0f0f1a' }} onContextMenu={handleCanvasContextMenu}>
      {/* Correction mode border */}
      {s.editMode === 'correction' && (
        <div className="absolute inset-0 pointer-events-none z-50" style={{ boxShadow: 'inset 0 0 0 3px rgba(34, 211, 238, 0.6)', borderRadius: '4px' }} />
      )}

      <canvas
        ref={s.canvasRef}
        className="absolute inset-0"
        style={{ cursor: cursorStyle }}
        onMouseDown={interaction.handleMouseDown}
        onMouseMove={interaction.handleMouseMove}
        onMouseUp={interaction.handleMouseUp}
        onMouseLeave={interaction.handleMouseUp}
        onDoubleClick={interaction.handleDoubleClick}
      />

      {/* 遮罩模式：专用遮罩笔刷覆盖层（必须在主画布之后，否则收不到鼠标事件） */}
      {s.editMode === 'mask' && s.maskNodeId && (
        <MaskBrushOverlay
          canvasWidth={s.canvasWidth}
          canvasHeight={s.canvasHeight}
        />
      )}

      {/* Correction mode badge */}
      {s.editMode === 'correction' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold tracking-wide pointer-events-none z-50" style={{ background: 'rgba(34, 211, 238, 0.2)', color: '#22d3ee', border: '1px solid rgba(34, 211, 238, 0.4)', backdropFilter: 'blur(4px)' }}>
          修正模式 · 笔画记录为 PixelEdit 修改器
        </div>
      )}

      {/* Unarmed badge */}
      {!performArmed && (
        <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide pointer-events-none z-50" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.4)', backdropFilter: 'blur(4px)' }}>
          未武装
        </div>
      )}

      {/* Node lock badge */}
      {nodeLockId && lockedNodeName && (
        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide pointer-events-none z-50" style={{ background: 'rgba(168, 85, 247, 0.18)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.4)', backdropFilter: 'blur(4px)' }}>
          🔒 已锁定节点：{lockedNodeName}（空白处单击解除 · 中键点击循环切换）
        </div>
      )}

      {/* Zoom indicator */}
      <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-md text-xs font-mono" style={{ background: 'rgba(15,15,26,0.85)', color: '#888', border: '1px solid rgba(255,255,255,0.08)' }}>
        {Math.round(s.zoom * 10) / 10}x
      </div>

      {/* Canvas size editor */}
      <div className="absolute bottom-3 left-3 rounded-md text-xs font-mono" style={{ background: 'rgba(15,15,26,0.85)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {s.canvasSizeEditing ? (
          <div className="flex items-center gap-1 px-2 py-1">
            <input type="number" min={1} max={2048} value={s.canvasSizeW} onChange={(e) => s.setCanvasSizeW(Math.max(1, Math.min(2048, parseInt(e.target.value) || 1)))} onKeyDown={(e) => { if (e.key === 'Enter') s.applyCanvasSize(); if (e.key === 'Escape') s.setCanvasSizeEditing(false); }} className="w-10 h-4 text-[10px] text-center bg-white/10 border border-white/15 rounded text-gray-300 px-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" autoFocus />
            <span className="text-gray-500">×</span>
            <input type="number" min={1} max={2048} value={s.canvasSizeH} onChange={(e) => s.setCanvasSizeH(Math.max(1, Math.min(2048, parseInt(e.target.value) || 1)))} onKeyDown={(e) => { if (e.key === 'Enter') s.applyCanvasSize(); if (e.key === 'Escape') s.setCanvasSizeEditing(false); }} className="w-10 h-4 text-[10px] text-center bg-white/10 border border-white/15 rounded text-gray-300 px-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            <button onClick={s.applyCanvasSize} className="ml-0.5 px-1.5 py-0 rounded text-[9px] bg-purple-600/40 text-purple-300 hover:bg-purple-600/60 transition-colors">✓</button>
          </div>
        ) : (
          <button onClick={() => { s.setCanvasSizeW(s.canvasWidth); s.setCanvasSizeH(s.canvasHeight); s.setCanvasSizeEditing(true); }} className="px-2.5 py-1 text-gray-500 hover:text-gray-300 cursor-pointer transition-colors" title="点击修改画布大小">
            {s.canvasWidth}×{s.canvasHeight}
          </button>
        )}
      </div>

      {/* Selected part indicator */}
      {s.selectedPart && (
        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md text-xs font-mono" style={{ background: 'rgba(15,15,26,0.85)', color: '#aaa', border: '1px solid rgba(255,255,255,0.08)' }}>
          {s.selectedPart.name} ({s.selectedPart.width}×{s.selectedPart.height})
        </div>
      )}

      {/* Active stroke tool indicator */}
      {(s.tool === 'motion_blur_brush' || s.tool === 'glow_brush' || s.tool === 'particle_brush' || s.tool === 'afterimage_brush') && (
        <div className="absolute top-3 right-3 px-2.5 py-1 rounded-md text-xs font-mono" style={{ background: s.tool === 'motion_blur_brush' ? 'rgba(0,180,180,0.15)' : 'rgba(180,120,0,0.15)', color: s.tool === 'motion_blur_brush' ? '#00cccc' : '#cc8800', border: `1px solid ${s.tool === 'motion_blur_brush' ? 'rgba(0,180,180,0.25)' : 'rgba(180,120,0,0.25)'}` }}>
          {s.tool === 'motion_blur_brush' ? `Blur: ${s.motionBlurBrushType}` : s.tool === 'glow_brush' ? 'Glow Brush' : s.tool === 'particle_brush' ? 'Particle Brush' : 'Afterimage Brush'}
        </div>
      )}

      {/* Extract Selection Dialog */}
      {interaction.showExtractDialog && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/40" onClick={() => interaction.setShowExtractDialog(false)}>
          <div className="bg-[#1a1a2e] border border-white/10 rounded-lg p-4 w-72 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-medium text-gray-200 mb-3">提取选区为新部件</div>
            <div className="mb-3">
              <label className="text-[10px] text-gray-400 block mb-1">新部件名称</label>
              <input type="text" value={interaction.extractPartName} onChange={(e) => interaction.setExtractPartName(e.target.value)} placeholder="选区" className="w-full px-2 py-1 text-xs bg-white/5 border border-white/10 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50" autoFocus />
            </div>
            <div className="text-[10px] text-gray-400 mb-3">选区内像素将被提取为独立部件，请选择原位置的处理方式：</div>
            <div className="space-y-1.5">
              <button className="w-full text-left px-3 py-2 rounded text-xs text-gray-300 hover:bg-purple-600/20 hover:text-purple-300 transition-colors border border-transparent hover:border-purple-500/30" onClick={() => { s.extractSelectionAsPart('keep', '#000000', interaction.extractPartName); interaction.setShowExtractDialog(false); interaction.setExtractPartName(''); }}>
                <div className="font-medium">保留原样</div>
                <div className="text-[9px] text-gray-500">原像素不变，新部件叠加在上层</div>
              </button>
              <button className="w-full text-left px-3 py-2 rounded text-xs text-gray-300 hover:bg-cyan-600/20 hover:text-cyan-300 transition-colors border border-transparent hover:border-cyan-500/30" onClick={() => { s.extractSelectionAsPart('transparent', '#000000', interaction.extractPartName); interaction.setShowExtractDialog(false); interaction.setExtractPartName(''); }}>
                <div className="font-medium">扣透明洞</div>
                <div className="text-[9px] text-gray-500">原位置变为透明，仅保留新部件</div>
              </button>
              <button className="w-full text-left px-3 py-2 rounded text-xs text-gray-300 hover:bg-amber-600/20 hover:text-amber-300 transition-colors border border-transparent hover:border-amber-500/30" onClick={() => { s.extractSelectionAsPart('fill', interaction.extractFillColor, interaction.extractPartName); interaction.setShowExtractDialog(false); interaction.setExtractPartName(''); }}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">扣纯色洞</span>
                  <input type="color" value={interaction.extractFillColor} onChange={(e) => interaction.setExtractFillColor(e.target.value)} onClick={(e) => e.stopPropagation()} className="w-4 h-3 rounded cursor-pointer border border-white/15 bg-transparent p-0" />
                </div>
                <div className="text-[9px] text-gray-500">原位置填充为指定纯色</div>
              </button>
              <button className="w-full text-left px-3 py-2 rounded text-xs text-gray-300 hover:bg-emerald-600/20 hover:text-emerald-300 transition-colors border border-transparent hover:border-emerald-500/30" onClick={() => { s.extractSelectionAsPart('inpaint', '#000000', interaction.extractPartName); interaction.setShowExtractDialog(false); interaction.setExtractPartName(''); }}>
                <div className="font-medium">Inpaint 修补</div>
                <div className="text-[9px] text-gray-500">用周围像素自动修补原位置</div>
              </button>
            </div>
            <button className="mt-3 w-full text-center text-[10px] text-gray-500 hover:text-gray-300 py-1 border border-white/5 rounded hover:bg-white/5 transition-colors" onClick={() => interaction.setShowExtractDialog(false)}>
              取消 (Esc)
            </button>
          </div>
        </div>
      )}
    </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        {menuTarget ? (
          <>
            <ContextMenuLabel className="max-w-48 truncate">{menuTarget.nodeName}</ContextMenuLabel>
            <ContextMenuItem onSelect={() => focusInputById('rig-node-name-input')}>
              重命名
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                const ch = useProjectStore.getState().unifiedCharacters[menuTarget.characterId];
                const n = ch?.nodes[menuTarget.nodeId];
                if (n) addChildNode(menuTarget.characterId, n);
              }}
            >
              新建子节点
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                const ch = useProjectStore.getState().unifiedCharacters[menuTarget.characterId];
                const n = ch?.nodes[menuTarget.nodeId];
                if (n) addSocketToNode(menuTarget.characterId, n);
              }}
            >
              添加插槽
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={menuTarget.isRoot}
              onSelect={() => {
                const id = useProjectStore
                  .getState()
                  .cloneNodeSubtree(menuTarget.characterId, menuTarget.nodeId);
                if (id) useProjectStore.getState().setSelectedNodeId(id);
              }}
            >
              复制子树
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={menuTarget.isRoot}>转位克隆</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {[45, 90, 180].map((deg) => (
                  <ContextMenuItem
                    key={deg}
                    onSelect={() => {
                      const id = useProjectStore
                        .getState()
                        .cloneNodeSubtreeTransposed(menuTarget.characterId, menuTarget.nodeId, deg);
                      if (id) useProjectStore.getState().setSelectedNodeId(id);
                    }}
                  >
                    {deg}°
                  </ContextMenuItem>
                ))}
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => focusInputById('rig-transpose-angle-input')}>
                  自定义角度…
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                const st = useProjectStore.getState();
                const n = st.unifiedCharacters[menuTarget.characterId]?.nodes[menuTarget.nodeId];
                if (n) {
                  st.pushUndo('更新节点', 'updateNode');
                  st.updateUnifiedNode(menuTarget.characterId, menuTarget.nodeId, { visible: !n.visible });
                }
              }}
            >
              {menuTarget.nodeVisible ? '隐藏节点' : '显示节点'}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={menuTarget.isRoot}
              className="text-red-400 focus:text-red-300"
              onSelect={() => deleteNodeSubtree(menuTarget.characterId, menuTarget.nodeId)}
            >
              删除节点
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => useEditorStore.getState().toggleGrid()}>
              {showGrid && <Check className="size-3.5" />} 显示网格
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => useProjectStore.getState().toggleOnionSkin()}>
              {onionSkinEnabled && <Check className="size-3.5" />} 洋葱皮
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => useEditorStore.getState().togglePuppetSkeleton()}>
              {showPuppetSkeleton && <Check className="size-3.5" />} 骨骼叠加
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => useEditorStore.getState().toggleMannequinFallback()}>
              {showMannequinFallback && <Check className="size-3.5" />} 人偶兜底
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => useEditorStore.getState().toggleFaceGuide()}>
              {showFaceGuide && <Check className="size-3.5" />} 五官参照
            </ContextMenuItem>
            <ContextMenuSeparator />
            {([['realistic', '写实 7.5 头身'], ['standard', '标准 6 头身'], ['chibi', 'Q 版 3 头身']] as const).map(([pid, label]) => (
              <ContextMenuItem key={pid} onSelect={() => applyProportionGuide(pid, 'front')}>
                比例垫图·正面（{label}）
              </ContextMenuItem>
            ))}
            <ContextMenuItem onSelect={() => applyProportionGuide('standard', 'side')}>
              比例垫图·侧面（标准 6 头身）
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => useEditorStore.getState().toggleNodeTurn3D()}>
              {nodeTurn3D && <Check className="size-3.5" />} 节点转向
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!activePuppetSkeletonId} onSelect={() => applyJointDiscOp('clear')}>
              清除所有关节盘
            </ContextMenuItem>
            <ContextMenuItem disabled={!activePuppetSkeletonId} onSelect={() => applyJointDiscOp('regen')}>
              重新生成所有关节盘
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => zoomBy(1.25)}>放大</ContextMenuItem>
            <ContextMenuItem onSelect={() => zoomBy(0.8)}>缩小</ContextMenuItem>
            <ContextMenuItem onSelect={zoomFit}>适应画布</ContextMenuItem>
            <ContextMenuItem onSelect={zoom100}>100%</ContextMenuItem>
            {menuHasSelection && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => interaction.setShowExtractDialog(true)}>
                  提取为部件…
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => {
                    s.selectionMaskRef.current.clear();
                    s.markDirty();
                  }}
                >
                  清除选区
                </ContextMenuItem>
              </>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
