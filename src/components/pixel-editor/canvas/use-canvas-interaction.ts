/**
 * use-canvas-interaction.ts — Custom hook for all PixelCanvas interaction handlers.
 * Contains mouse, keyboard, and wheel event handlers, stroke commit logic,
 * and the extract selection dialog state.
 *
 * Tool-specific interaction logic is delegated to handler objects via the
 * Strategy Pattern (see ./tool-handlers.ts), dramatically reducing cyclomatic
 * complexity in each event handler.
 */

import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '@/lib/store';
import { useEditorStore } from '@/lib/store';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { renderMotionBlurStroke, renderEffectStroke } from '@/lib/engine';
import { resolvePuppetNodeSprite } from '@/lib/engine/puppet-utils';
import { isStrokeToolCheck } from './canvas-utils';
import { getToolHandler } from './tool-handlers';
import type { CanvasState } from './use-canvas-state';
import type { MotionBlurStroke, EffectStroke } from '@/lib/types';

export function useCanvasInteraction(s: CanvasState) {
  const [showExtractDialog, setShowExtractDialog] = useState(false);
  const [extractPartName, setExtractPartName] = useState('');
  const [extractFillColor, setExtractFillColor] = useState('#000000');

  // ---- Stroke tool check ----
  const isStrokeTool = useCallback(() => isStrokeToolCheck(s.tool), [s.tool]);

  // ---- Commit stroke ----
  const commitStroke = useCallback(() => {
    const points = s.currentStrokePointsRef.current;
    if (points.length < 2) { s.currentStrokePointsRef.current = []; return; }
    const spriteId = s.selectedPartId || '';
    const currentFrame = s.currentFrameRef.current;
    const frame = currentFrame;

    if (s.tool === 'motion_blur_brush') {
      const stroke: Omit<MotionBlurStroke, 'id'> = { frame, spriteId, points, brushType: s.motionBlurBrushType, intensity: s.motionBlurIntensity, direction: s.motionBlurDirection, blendMode: s.strokeBlendMode };
      useProjectStore.getState().addMotionBlurStroke(stroke);
    } else if (s.tool === 'glow_brush' || s.tool === 'particle_brush' || s.tool === 'afterimage_brush') {
      const effectType = s.tool === 'glow_brush' ? 'glow_brush' : s.tool === 'particle_brush' ? 'particle_brush' : 'afterimage_brush';
      const stroke: Omit<EffectStroke, 'id'> = { frame, spriteId, type: effectType, points, color: s.effectBrushColor, radius: s.effectBrushRadius, intensity: s.effectBrushIntensity, density: s.effectBrushDensity, spread: s.effectBrushSpread, blendMode: s.strokeBlendMode };
      useProjectStore.getState().addEffectStroke(stroke);
    }
    s.currentStrokePointsRef.current = [];
  }, [s.tool, s.selectedPartId, s.motionBlurBrushType, s.motionBlurIntensity, s.motionBlurDirection, s.effectBrushColor, s.effectBrushRadius, s.effectBrushIntensity, s.effectBrushDensity, s.effectBrushSpread]);

  // ---- Render stroke preview ----
  const renderStrokePreview = useCallback(
    (offCtx: CanvasRenderingContext2D) => {
      const currentFrame = s.currentFrameRef.current;
      const points = s.currentStrokePointsRef.current;
      if (points.length < 2) return;

      if (s.tool === 'motion_blur_brush') {
        const previewStroke: MotionBlurStroke = { id: '__preview__', frame: currentFrame, spriteId: s.selectedPartId || '', points, brushType: s.motionBlurBrushType, intensity: s.motionBlurIntensity, direction: s.motionBlurDirection, blendMode: s.strokeBlendMode };
        renderMotionBlurStroke(offCtx, previewStroke);
      } else if (s.tool === 'glow_brush' || s.tool === 'particle_brush' || s.tool === 'afterimage_brush') {
        const effectType = s.tool === 'glow_brush' ? 'glow_brush' : s.tool === 'particle_brush' ? 'particle_brush' : 'afterimage_brush';
        const previewStroke: EffectStroke = { id: '__preview__', frame: currentFrame, spriteId: s.selectedPartId || '', type: effectType, points, color: s.effectBrushColor, radius: s.effectBrushRadius, intensity: s.effectBrushIntensity, density: s.effectBrushDensity, spread: s.effectBrushSpread, blendMode: s.strokeBlendMode };
        renderEffectStroke(offCtx, previewStroke);
      }
    }, [s.tool, s.selectedPartId, s.motionBlurBrushType, s.motionBlurIntensity, s.motionBlurDirection, s.effectBrushColor, s.effectBrushRadius, s.effectBrushIntensity, s.effectBrushDensity, s.effectBrushSpread],
  );

  // ---- Mouse Down ----
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();

      // Panning takes priority (middle-button or space+left-button)
      if (e.button === 1 || (s.spaceHeldRef.current && e.button === 0)) {
        s.isPanningRef.current = true; s.markDirty();
        s.panStartRef.current = { x: e.clientX, y: e.clientY, panX: s.panX, panY: s.panY };
        return;
      }
      if (e.button !== 0) return;
      const { px, py } = s.screenToPixel(e.clientX, e.clientY);

      // Delegate to tool handler
      const handler = getToolHandler(s.tool, s.isPuppetMode, s.editMode === 'sprite_edit');
      if (handler?.onMouseDown) handler.onMouseDown(s, e, px, py);
    },
    [s],
  );

  // ---- Mouse Move ----
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (s.isPanningRef.current || s.isDrawingRef.current) s.markDirty();

      // Panning takes priority
      if (s.isPanningRef.current && s.panStartRef.current) {
        const dx = e.clientX - s.panStartRef.current.x; const dy = e.clientY - s.panStartRef.current.y;
        s.setPan(s.panStartRef.current.panX + dx, s.panStartRef.current.panY + dy); return;
      }

      const { px, py } = s.screenToPixel(e.clientX, e.clientY);

      // Delegate to tool handler
      const handler = getToolHandler(s.tool, s.isPuppetMode, s.editMode === 'sprite_edit');
      if (handler?.onMouseMove) handler.onMouseMove(s, e, px, py);
    },
    [s],
  );

  // ---- Mouse Up ----
  const handleMouseUp = useCallback(() => {
    // Stroke commit (kept here because it uses hook-local commitStroke)
    if (s.isDrawingRef.current && isStrokeTool()) commitStroke();

    // Delegate to tool handler for tool-specific mouseUp logic
    const handler = getToolHandler(s.tool, s.isPuppetMode, s.editMode === 'sprite_edit');
    if (handler?.onMouseUp) handler.onMouseUp(s);

    // General cleanup (always runs)
    s.isPanningRef.current = false; s.markDirty(); s.isDrawingRef.current = false; s.markDirty();
    s.panStartRef.current = null; s.moveStartRef.current = null; s.lastPixelRef.current = null;
    s.lastDrawnPixelsRef.current.clear(); s.boneDragRef.current = null; s.puppetNodeDragRef.current = null;
    useProjectStore.getState().endDrag();
  }, [isStrokeTool, commitStroke, s]);

  // ---- Wheel handler ----
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = s.canvasRef.current; if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
      const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newZoom = Math.max(1, Math.min(32, Math.round(s.zoom * zoomFactor * 10) / 10));
      const worldX = (mouseX - s.panX) / s.zoom; const worldY = (mouseY - s.panY) / s.zoom;
      s.setZoom(newZoom); s.setPan(mouseX - worldX * newZoom, mouseY - worldY * newZoom);
    }, [s.zoom, s.panX, s.panY, s.setZoom, s.setPan],
  );

  // ---- Double-click handler ----
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (s.selectionMaskRef.current.size > 0) { setShowExtractDialog(true); return; }
      // 木偶模式下双击进入该服装部件的像素编辑
      if (s.isPuppetMode) {
        const canvas = s.canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const px = (e.clientX - rect.left - s.panX) / s.zoom;
        const py = (e.clientY - rect.top - s.panY) / s.zoom;
        const hit = s.findPuppetNodeAtPixel(px, py);
        if (!hit) return;
        const { node, character } = hit;
        const activeCostume = character.activeCostumeSetId
          ? character.costumeSets.find((cs) => cs.id === character.activeCostumeSetId) ?? null
          : null;
        const dir = (node.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
        // Resolve sprite ID from new model (for part edit mode)
        let spriteId: string | null = null;
        if (node.slot && activeCostume) {
          const piece = activeCostume.pieces[node.slot.slotKey];
          const ref = piece?.sprites[dir] ?? piece?.sprites[0];
          if (ref && 'spriteId' in ref) spriteId = ref.spriteId;
        }
        if (spriteId) {
          // Sprite IDs are "part_<id>" for migrated sprites; extract for edit mode
          const extractedSpriteId = spriteId.startsWith('part_') ? spriteId.slice(5) : spriteId;
          useEditorStore.getState().selectPart(extractedSpriteId);
          useEditorStore.getState().enterSpriteEditMode(extractedSpriteId);
        }
        return;
      }
    }, [s.selectionMaskRef, s.isPuppetMode, s.canvasRef, s.panX, s.panY, s.zoom, s.findPuppetNodeAtPixel],
  );

  // ---- Keyboard handlers ----
  // 原生 wheel 监听（passive: false），React onWheel 默认 passive 调 preventDefault 会警告
  useEffect(() => {
    const canvas = s.canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
      const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newZoom = Math.max(1, Math.min(32, Math.round(s.zoom * zoomFactor * 10) / 10));
      const worldX = (mouseX - s.panX) / s.zoom; const worldY = (mouseY - s.panY) / s.zoom;
      s.setZoom(newZoom); s.setPan(mouseX - worldX * newZoom, mouseY - worldY * newZoom);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [s.canvasRef, s.zoom, s.panX, s.panY, s.setZoom, s.setPan]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // General keyboard shortcuts (not tool-specific)
      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); s.spaceHeldRef.current = true; }
      if (e.code === 'AltLeft' || e.code === 'AltRight') {
        const editorState = s.editorStore.getState();
        if (editorState.tool === 'move' && !s.altToggleBackupRef.current) { s.altToggleBackupRef.current = editorState.moveTargetLevel; s.editorStore.getState().setMoveTargetLevel(editorState.moveTargetLevel === 'keyframe' ? 'part_global' : 'keyframe'); }
      }
      if (e.code === 'Enter') { if (s.selectionMaskRef.current.size > 0) { e.preventDefault(); setShowExtractDialog(true); } }
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (s.selectionMaskRef.current.size > 0) {
          e.preventDefault();
          // 删除选区像素
          const state = useProjectStore.getState();
          const sprite = state.sprites[s.editorStore.getState().selectedPartId ?? ''];
          if (sprite) {
            const newPixels = sprite.data.map((row) => [...row]);
            for (const key of s.selectionMaskRef.current) {
              const [x, y] = key.split(',').map(Number);
              if (newPixels[y] && newPixels[y][x] !== undefined) {
                newPixels[y][x] = null;
              }
            }
            state.setSpritePixels(sprite.id!, newPixels);
            s.selectionMaskRef.current.clear();
            s.markDirty();
          }
        }
      }
      if (e.code === 'KeyE' && e.shiftKey) { const samSt = s.editorStore.getState().samState; if (samSt.currentMask && samSt.maskShape) { e.preventDefault(); s.editorStore.getState().extractSAMMaskAsPart(); } }
      if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey && !e.shiftKey) s.editorStore.getState().setTool('puppet');

      // Delegate tool-specific keyboard handling
      const handler = getToolHandler(s.tool, s.isPuppetMode, s.editMode === 'sprite_edit');
      if (handler?.onKeyDown) handler.onKeyDown(s, e);

      // Escape handler (general, runs after tool-specific handlers)
      if (e.code === 'Escape') {
        if (s.editorStore.getState().editMode === 'sprite_edit') { s.editorStore.getState().exitSpriteEditMode(false); return; }
        s.selectionMaskRef.current.clear(); s.lassoPathRef.current = [];
        const samSt = s.editorStore.getState().samState; if (samSt.currentMask) s.editorStore.getState().clearSAMMask();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') { s.spaceHeldRef.current = false; if (s.isPanningRef.current) { s.isPanningRef.current = false; s.markDirty(); s.panStartRef.current = null; } }
      if (e.code === 'AltLeft' || e.code === 'AltRight') { if (s.altToggleBackupRef.current !== null) { s.editorStore.getState().setMoveTargetLevel(s.altToggleBackupRef.current); s.altToggleBackupRef.current = null; } }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [s.extractSelectionAsPart, s.editorStore, s.canvasWidth, s.canvasHeight, s.computePivotWorldPosition, s.markDirty]);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    handleDoubleClick,
    renderStrokePreview,
    isStrokeTool,
    commitStroke,
    showExtractDialog, setShowExtractDialog,
    extractPartName, setExtractPartName,
    extractFillColor, setExtractFillColor,
  };
}
