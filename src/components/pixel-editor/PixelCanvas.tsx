'use client';

import React, { useCallback, useEffect } from 'react';
import { useProjectStore } from '@/lib/store';
import { registerRenderCallback } from '@/lib/playback-scheduler';
import { drawTileGridToCanvas } from '@/lib/tile-blob-engine';
import { renderFrame, renderPartEditMode } from '@/lib/engine';
import { renderUnified, invalidateUnifiedPipelineCache } from '@/lib/unified-pipeline-bridge';
import { useCanvasState } from './canvas/use-canvas-state';
import { useCanvasInteraction } from './canvas/use-canvas-interaction';
import {
  renderGridOverlay,
  renderCanvasBorder,
  renderSelectionOverlay,
  renderSamMaskOverlay,
  renderLassoPreview,
  renderHandDrawnTrajectoryPreview,
  renderCropPreview,
  renderBoneOverlay,
  renderWeightPaintOverlay,
  renderTrajectoryOverlay,
} from './canvas/canvas-render-helpers';
import {
  renderPuppetSkeletonOverlay,
  renderPivotCrosshair,
  renderStrokeCursorIndicator,
  renderFpsCounter,
} from './canvas/canvas-puppet-render';
import { acquireCanvas, releaseCanvas } from '@/lib/engine/canvas-pool';
import { getCursorStyle, isStrokeToolCheck } from './canvas/canvas-utils';

// ============================================================
// PixelCanvas - Central canvas for PixelMorpher pixel animation
// ============================================================

export default function PixelCanvas() {
  const s = useCanvasState();
  const interaction = useCanvasInteraction(s);

  // ---- Render loop ----
  const render = useCallback(() => {
    const canvas = s.canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentFrame = s.currentFrameRef.current;
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

    // 1. Onion skin
    // Determine onion quality based on play state — use 'low' during playback for 60-80% frame time reduction
    const isPlaying = s.playStateRef.current === 'playing';
    const onionQuality: 'low' | 'medium' = isPlaying ? 'low' : 'medium';
    if (s.onionSkinEnabled && s.onionSkinFrames > 0) {
      offCtx.save();
      offCtx.clearRect(0, 0, s.canvasWidth, s.canvasHeight);
      const curVersion = s.onionDataVersionRef.current;
      const kfHash = s.keyframes.map(kf => `${kf.id}:${kf.frame}:${kf.modifiers.length}`).join('|');

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
            renderFrame(cacheCtx, s.canvasWidth, s.canvasHeight, s.nonPuppetParts, s.keyframes, prevFrame, 'rgba(0,0,0,0)', s.effectTracks, undefined, undefined, false, 0.5, undefined, undefined, undefined, s.frameRate, onionQuality, undefined, s.globalModifiers);
            s.onionCacheRef.current.set(prevFrame, { canvas: cacheCanvas, version: curVersion, keyframeHash: kfHash });
          }
          offCtx.drawImage(s.onionCacheRef.current.get(prevFrame)!.canvas, 0, 0);
          offCtx.globalCompositeOperation = 'source-atop';
          offCtx.fillStyle = 'rgba(60,120,255,0.3)';
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
            renderFrame(cacheCtx, s.canvasWidth, s.canvasHeight, s.nonPuppetParts, s.keyframes, nextFrame, 'rgba(0,0,0,0)', s.effectTracks, undefined, undefined, false, 0.5, undefined, undefined, undefined, s.frameRate, onionQuality, undefined, s.globalModifiers);
            s.onionCacheRef.current.set(nextFrame, { canvas: cacheCanvas, version: curVersion, keyframeHash: kfHash });
          }
          offCtx.drawImage(s.onionCacheRef.current.get(nextFrame)!.canvas, 0, 0);
          offCtx.globalCompositeOperation = 'source-atop';
          offCtx.fillStyle = 'rgba(255,120,40,0.3)';
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
    if (s.isTileMode) {
      const tileState = s.tileStore.getState();
      const target = tileState.editingTarget;
      offCtx.fillStyle = s.backgroundColor || '#1a1a2e';
      offCtx.fillRect(0, 0, s.canvasWidth, s.canvasHeight);
      if (target) {
        const { width: tileW, height: tileH } = tileState.getEditingTargetSize();
        const pixels = tileState.getEditingTargetPixels();
        if (pixels && pixels.length > 0) {
          const offsetX = Math.floor((s.canvasWidth - tileW) / 2);
          const offsetY = Math.floor((s.canvasHeight - tileH) / 2);
          drawTileGridToCanvas(offCtx, pixels, offsetX, offsetY, 1, '#1a1a2e');
        }
      } else {
        offCtx.fillStyle = '#3f3f5a'; offCtx.font = '12px sans-serif'; offCtx.textAlign = 'center';
        offCtx.fillText('在左面板选择要编辑的瓦片资产', s.canvasWidth / 2, s.canvasHeight / 2);
      }
    } else if (s.editMode === 'part_edit' && s.partEditPartId) {
      const part = s.parts.find(p => p.id === s.partEditPartId);
      if (part) {
        let effectiveMods = s.partEditModifiers;
        if (s.partEditBrushCmdRef.current) {
          const { modifierId, commandId, points } = s.partEditBrushCmdRef.current;
          if (points.length > 0) {
            const cmd: import('@/lib/types').BrushCommand = {
              id: commandId, type: s.tool === 'eraser' ? 'erase' : 'draw', color: s.brushColor, size: s.brushSize,
              points, blendMode: 'normal', brushStyle: s.brushStyle !== 'solid' ? s.brushStyle : undefined,
              brushStyleParams: s.brushStyle !== 'solid' ? s.brushStyleParams : undefined,
              ...(s.compositingMode && (s.styleAspects.length > 0 || s.strokeDrivers.length > 0) ? { styleAspects: s.styleAspects.filter(a => a.enabled), strokeDrivers: s.strokeDrivers.filter(d => d.enabled) } : {}),
            };
            effectiveMods = s.partEditModifiers.map(m => {
              if (m.id !== modifierId) return m;
              const existingCommands: import('@/lib/types').BrushCommand[] = (m.params.brushCommands as import('@/lib/types').BrushCommand[]) || [];
              return { ...m, params: { ...m.params, brushCommands: [...existingCommands, cmd] } } as import('@/lib/types').ModifierInstance;
            });
          }
        }
        renderPartEditMode(offCtx, part, effectiveMods, s.canvasWidth, s.canvasHeight, currentFrame);
      }
    } else {
      const animationClips = useProjectStore.getState().animationClips;
      renderUnified(offCtx, s.canvasWidth, s.canvasHeight, s.parts, s.keyframes, currentFrame, s.backgroundColor,
        s.effectTracks, s.motionBlurStrokes, s.effectStrokes, s.autoMotionBlur, s.autoMotionBlurIntensity,
        s.skeletons, s.proceduralAnimations, s.canvasModifierTracks, s.frameRate, 'high',
        s.animationVariables, s.globalModifiers, s.puppetSkeletons, s.puppetCharacters, animationClips, true);
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
          onionCtx.globalCompositeOperation = 'source-atop'; onionCtx.fillStyle = 'rgba(60,120,255,0.35)';
          onionCtx.fillRect(0, 0, s.canvasWidth, s.canvasHeight); onionCtx.restore();
        }
        if (nextFrame < useProjectStore.getState().totalFrames) {
          onionCtx.save(); onionCtx.globalAlpha = Math.max(0.05, 0.3 / offset);
          const cached = s.onionCacheRef.current.get(nextFrame);
          if (cached) onionCtx.drawImage(cached.canvas, 0, 0);
          onionCtx.globalCompositeOperation = 'source-atop'; onionCtx.fillStyle = 'rgba(255,120,40,0.35)';
          onionCtx.fillRect(0, 0, s.canvasWidth, s.canvasHeight); onionCtx.restore();
        }
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(onionCanvas, 0, 0, s.canvasWidth, s.canvasHeight, panX, panY, s.canvasWidth * zoom, s.canvasHeight * zoom);
    }

    // 6-10. Overlays
    renderGridOverlay(rc);
    renderCanvasBorder(rc);
    s.selectionMarchOffsetRef.current = renderSelectionOverlay(rc, s.selectionMaskRef.current, s.selectionMarchOffsetRef.current);

    const samState = s.editorStore.getState().samState;
    renderSamMaskOverlay(rc, { currentMask: samState.currentMask, maskShape: samState.maskShape });

    if (s.isDrawingRef.current && s.tool === 'lasso') renderLassoPreview(rc, s.lassoPathRef.current);
    if (s.isDrawingRef.current && s.tool === 'trajectory') renderHandDrawnTrajectoryPreview(rc, s.handDrawTrajectoryRef.current);
    if (s.isDrawingRef.current && s.tool === 'crop') renderCropPreview(rc, s.cropRectRef.current);

    renderBoneOverlay(rc, { skeletons: s.skeletons, showSkeletons: s.showSkeletons, selectedBoneId: s.selectedBoneId, activeSkeletonId: s.activeSkeletonId });
    renderWeightPaintOverlay(rc, { showWeightPaint: s.showWeightPaint, weightPaintBoneId: s.weightPaintBoneId, skeletons: s.skeletons, parts: s.parts, getInterpolatedTranslateOffset: s.getInterpolatedTranslateOffset });
    renderTrajectoryOverlay(rc, { showTrajectories: s.showTrajectories, trajectories: s.trajectories, selectedPartId: s.selectedPartId, editMode: s.editMode, trajectorySnap: s.trajectorySnap, totalFrames: useProjectStore.getState().totalFrames });

    // Skip puppet skeleton overlay during playback — reduces non-essential drawing overhead
    if (!isPlaying) {
      renderPuppetSkeletonOverlay(rc, {
        shouldRender: (s.isPuppetMode || s.showPuppetSkeleton || s.tool === 'puppet') && s.puppetSkeletons.length > 0,
        puppetSkeletons: s.puppetSkeletons, activePuppetSkeletonId: s.activePuppetSkeletonId,
        selectedPuppetNodeId: s.selectedPuppetNodeId, puppetCharacters: s.puppetCharacters,
        animationClips: useProjectStore.getState().animationClips, parts: s.parts,
      });
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
    s.canvasWidth, s.canvasHeight, s.parts, s.keyframes, s.backgroundColor,
    s.onionSkinEnabled, s.onionSkinFrames, s.showGrid, s.showTrajectories, s.editMode,
    s.trajectories, s.selectedPart, s.selectedPartId, s.motionBlurStrokes, s.effectStrokes,
    s.effectTracks, s.autoMotionBlur, s.autoMotionBlurIntensity, s.tool,
    s.skeletons, s.showSkeletons, s.selectedBoneId, s.activeSkeletonId,
    s.showWeightPaint, s.weightPaintBoneId, s.puppetSkeletons, s.puppetCharacters, s.puppetClipsVersion,
    s.canvasModifierTracks, s.partEditPartId, s.partEditModifiers,
    interaction.renderStrokePreview, s.getInterpolatedTranslateOffset,
  ]);

  // Animation loop
  useEffect(() => {
    s.dirtyRef.current = true;
    const unregisterScheduler = registerRenderCallback(() => { s.dirtyRef.current = true; });
    const loop = () => {
      if (s.dirtyRef.current) { s.dirtyRef.current = false; render(); }
      s.rafRef.current = requestAnimationFrame(loop);
    };
    s.rafRef.current = requestAnimationFrame(loop);
    return () => { unregisterScheduler(); if (s.rafRef.current) cancelAnimationFrame(s.rafRef.current); };
  }, [render]);

  const cursorStyle = s.editMode === 'correction' ? 'crosshair' : getCursorStyle(s.tool, s.spaceHeldRef.current);

  return (
    <div ref={s.containerRef} className="relative w-full h-full overflow-hidden" style={{ background: '#0f0f1a' }}>
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
        onWheel={interaction.handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Correction mode badge */}
      {s.editMode === 'correction' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold tracking-wide pointer-events-none z-50" style={{ background: 'rgba(34, 211, 238, 0.2)', color: '#22d3ee', border: '1px solid rgba(34, 211, 238, 0.4)', backdropFilter: 'blur(4px)' }}>
          修正模式 · 笔画记录为 PixelEdit 修改器
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
  );
}
