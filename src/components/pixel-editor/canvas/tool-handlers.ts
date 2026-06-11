/**
 * tool-handlers.ts — Strategy Pattern handlers for each pixel-editor tool.
 * Extracted from use-canvas-interaction.ts to reduce cyclomatic complexity.
 * Each handler encapsulates the mouse/keyboard logic for a specific tool.
 */

import type { MouseEvent as ReactMouseEvent } from 'react';
import { useProjectStore } from '@/lib/store';
import { useEditorStore } from '@/lib/store';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { inpaintPixels } from '@/lib/inpainting';
import { renderFrame, floodFill } from '@/lib/engine';
import { resolvePuppetNodeSprite } from '@/lib/engine/puppet-render';
import {
  isPixelInPart,
  getLinePixels,
  simplifyPath,
  pointInPolygon,
  computeSpriteEndPoint,
  isStrokeToolCheck,
} from './canvas-utils';
import type { CanvasState } from './use-canvas-state';
import type { BrushCommand, ModifierInstance } from '@/lib/types';

// ---------------------------------------------------------------------------
// ToolHandler interface
// ---------------------------------------------------------------------------

export interface ToolHandler {
  onMouseDown?(s: CanvasState, e: ReactMouseEvent, px: number, py: number): void;
  onMouseMove?(s: CanvasState, e: ReactMouseEvent, px: number, py: number): void;
  onMouseUp?(s: CanvasState): void;
  onKeyDown?(s: CanvasState, e: KeyboardEvent): void;
}

// ---------------------------------------------------------------------------
// PanningHandler (reference only — actual panning stays in the hook)
// ---------------------------------------------------------------------------

export const panningHandler: ToolHandler = {};

// ---------------------------------------------------------------------------
// Tile Mode Handler (brush/eraser/fill/eyedropper in tile mode)
// ---------------------------------------------------------------------------

export const tileModeHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const tileState = s.tileStore.getState();
    const target = tileState.editingTarget;
    if (!target) return;
    const { width: tileW, height: tileH } = tileState.getEditingTargetSize();
    const tileOffsetX = Math.floor((s.canvasWidth - tileW) / 2);
    const tileOffsetY = Math.floor((s.canvasHeight - tileH) / 2);
    const localX = px - tileOffsetX;
    const localY = py - tileOffsetY;
    if (localX < 0 || localX >= tileW || localY < 0 || localY >= tileH) return;

    if (s.tool === 'eyedropper') {
      const pixels = tileState.getEditingTargetPixels();
      if (pixels && pixels[localY]?.[localX]) s.editorStore.getState().setBrushColor(pixels[localY][localX]!);
      return;
    }
    if (s.tool === 'fill') {
      const pixels = tileState.getEditingTargetPixels();
      if (!pixels) return;
      const filled = floodFill(pixels, localX, localY, s.brushColor);
      tileState.setEditingTargetPixels(filled);
      s.markDirty(); return;
    }
    s.isDrawingRef.current = true; s.markDirty();
    s.lastPixelRef.current = { x: localX, y: localY };
    s.lastDrawnPixelsRef.current.clear();
    const color = s.tool === 'eraser' ? null : s.brushColor;
    const halfBrush = Math.floor(s.brushSize / 2);
    const pixels = tileState.getEditingTargetPixels();
    if (!pixels) return;
    const gridH = pixels.length; const gridW = gridH > 0 ? pixels[0].length : 0;
    const newPixels = pixels.map(row => [...row]);
    for (let dy = -halfBrush; dy < s.brushSize - halfBrush; dy++) {
      for (let dx = -halfBrush; dx < s.brushSize - halfBrush; dx++) {
        const tx = localX + dx; const ty = localY + dy;
        if (tx >= 0 && tx < gridW && ty >= 0 && ty < gridH) {
          const key = `${tx},${ty}`;
          if (!s.lastDrawnPixelsRef.current.has(key)) { newPixels[ty][tx] = color; s.lastDrawnPixelsRef.current.add(key); }
        }
      }
    }
    tileState.setEditingTargetPixels(newPixels);
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current) return;
    if (s.tool !== 'brush' && s.tool !== 'eraser') return;
    const tileState = s.tileStore.getState(); const target = tileState.editingTarget;
    if (!target) return;
    const { width: tileW, height: tileH } = tileState.getEditingTargetSize();
    const tileOffsetX = Math.floor((s.canvasWidth - tileW) / 2); const tileOffsetY = Math.floor((s.canvasHeight - tileH) / 2);
    const localX = px - tileOffsetX; const localY = py - tileOffsetY;
    if (localX < 0 || localX >= tileW || localY < 0 || localY >= tileH) return;
    const color = s.tool === 'eraser' ? null : s.brushColor;
    const halfBrush = Math.floor(s.brushSize / 2);
    const pixels = tileState.getEditingTargetPixels(); if (!pixels) return;
    const gridH = pixels.length; const gridW = gridH > 0 ? pixels[0].length : 0;
    if (s.lastPixelRef.current) {
      const linePixels = getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, localX, localY);
      const newPixels = pixels.map(row => [...row]);
      for (const point of linePixels) for (let dy2 = -halfBrush; dy2 < s.brushSize - halfBrush; dy2++) for (let dx2 = -halfBrush; dx2 < s.brushSize - halfBrush; dx2++) {
        const tx = point.x + dx2; const ty = point.y + dy2;
        if (tx >= 0 && tx < gridW && ty >= 0 && ty < gridH) { const key = `${tx},${ty}`; if (!s.lastDrawnPixelsRef.current.has(key)) { newPixels[ty][tx] = color; s.lastDrawnPixelsRef.current.add(key); } }
      }
      tileState.setEditingTargetPixels(newPixels);
    }
    s.lastPixelRef.current = { x: localX, y: localY };
  },
};

// ---------------------------------------------------------------------------
// Move Tool Handler
// ---------------------------------------------------------------------------

export const moveToolHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    if (!s.selectedPart) return;
    const selPart = s.selectedPart;
    const offsetX = s.canvasWidth / 2; const offsetY = s.canvasHeight / 2;
    const { offsetX: txOff, offsetY: tyOff } = s.getInterpolatedTranslateOffset(selPart.id, currentFrame);
    if (isPixelInPart(px, py, selPart, offsetX, offsetY, txOff, tyOff)) {
      const targetLevel = s.editorStore.getState().moveTargetLevel;
      let partGlobalOffsetX = 0; let partGlobalOffsetY = 0;
      const partGlobalTranslate = selPart.globalModifiers?.find(m => m.type === 'translate' && m.enabled);
      if (partGlobalTranslate) { partGlobalOffsetX = Number(partGlobalTranslate.params.offsetX) || 0; partGlobalOffsetY = Number(partGlobalTranslate.params.offsetY) || 0; }
      const kfOnlyOffsetX = txOff - partGlobalOffsetX; const kfOnlyOffsetY = tyOff - partGlobalOffsetY;
      const startOffsetX = targetLevel === 'part_global' ? partGlobalOffsetX : kfOnlyOffsetX;
      const startOffsetY = targetLevel === 'part_global' ? partGlobalOffsetY : kfOnlyOffsetY;
      useProjectStore.getState().beginDrag(targetLevel === 'part_global' ? '移动部件(全局)' : '移动部件');
      s.isDrawingRef.current = true; s.markDirty();
      s.moveStartRef.current = { x: px, y: py, offsetX: startOffsetX, offsetY: startOffsetY, targetLevel, partGlobalOffsetX, partGlobalOffsetY };
    }
  },

  onMouseMove(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    if (!s.isDrawingRef.current || !s.selectedPart || !s.moveStartRef.current) return;
    const selPart = s.selectedPart;
    const dx = px - s.moveStartRef.current.x; const dy = py - s.moveStartRef.current.y;
    const newOffsetX = s.moveStartRef.current.offsetX + dx; const newOffsetY = s.moveStartRef.current.offsetY + dy;
    if (s.moveStartRef.current.targetLevel === 'part_global') {
      const store = useProjectStore.getState();
      const existingMod = selPart.globalModifiers?.find(m => m.type === 'translate' && m.enabled);
      if (existingMod) store.updatePartGlobalModifierParams(selPart.id, existingMod.id, { offsetX: newOffsetX, offsetY: newOffsetY });
      else { const newMod = store.addPartGlobalModifier(selPart.id, 'translate'); const updatedPart = store.parts.find(p => p.id === selPart.id); const addedMod = updatedPart?.globalModifiers?.find(m => m.id === newMod.id); if (addedMod) store.updatePartGlobalModifierParams(selPart.id, addedMod.id, { offsetX: newOffsetX, offsetY: newOffsetY }); }
    } else {
      let kf = s.keyframes.find(k => k.partId === selPart.id && k.frame === currentFrame);
      if (!kf) kf = useProjectStore.getState().addKeyframe(selPart.id, currentFrame);
      const translateMod = kf.modifiers.find(m => m.type === 'translate');
      if (translateMod) useProjectStore.getState().updateModifier(kf.id, translateMod.id, { offsetX: newOffsetX, offsetY: newOffsetY });
      else { useProjectStore.getState().addModifier(kf.id, 'translate'); const updatedKf = useProjectStore.getState().keyframes.find(k => k.id === kf!.id); if (updatedKf) { const newMod = updatedKf.modifiers.find(m => m.type === 'translate'); if (newMod) useProjectStore.getState().updateModifier(updatedKf.id, newMod.id, { offsetX: newOffsetX, offsetY: newOffsetY }); } }
    }
  },
};

// ---------------------------------------------------------------------------
// Select Tool Handler
// ---------------------------------------------------------------------------

export const selectToolHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    s.editorStore.getState().selectPart(s.findPartAtPixel(px, py)?.id ?? null);
  },
};

// ---------------------------------------------------------------------------
// Puppet Handler
// ---------------------------------------------------------------------------

export const puppetHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const hit = s.findPuppetNodeAtPixel(px, py);
    if (hit) {
      const { node, skeleton, character, clipId } = hit;
      useProjectStore.getState().setSelectedPuppetNodeId(node.id);
      s.editorStore.getState().setActivePuppetSkeletonId(skeleton.id);

      if (e.ctrlKey || e.metaKey) {
        const activeCostume = character.activeCostumeSetId ? character.costumeSets.find((cs) => cs.id === character.activeCostumeSetId) ?? null : null;
        const direction = skeleton.currentDirection || 'S';
        const state = useProjectStore.getState();
        const resolvedPart = resolvePuppetNodeSprite(node, direction, activeCostume, state.parts);
        if (resolvedPart) { useWorkspaceStore.getState().setMode('animation'); s.editorStore.getState().selectPart(resolvedPart.id); s.editorStore.getState().enterPartEditMode(resolvedPart.id); return; }
      }

      const interactionMode = s.editorStore.getState().puppetInteractionMode;
      let dragMode: 'rotate' | 'move';
      if (interactionMode === 'manipulate') dragMode = e.shiftKey ? 'move' : 'rotate';
      else dragMode = e.shiftKey ? 'rotate' : 'move';

      const pivotWorldX = s.computePivotWorldPosition(node, skeleton, s.canvasWidth, s.canvasHeight).x;
      const pivotWorldY = s.computePivotWorldPosition(node, skeleton, s.canvasWidth, s.canvasHeight).y;
      const startMouseAngle = Math.atan2(py - pivotWorldY, px - pivotWorldX);

      let resolvedClipId = clipId;
      if (!resolvedClipId) {
        const state = useProjectStore.getState();
        const existingClip = state.animationClips.find(c => c.isPuppetClip && c.puppetCharacterId === character.id);
        if (existingClip) resolvedClipId = existingClip.id;
        else {
          const clip = state.addAnimationClip(`${character.name}动画`);
          useProjectStore.setState(st => ({ animationClips: st.animationClips.map(c => c.id === clip.id ? { ...c, isPuppetClip: true, puppetCharacterId: character.id, puppetNodeKeyframes: [] } : c) }));
          resolvedClipId = clip.id;
        }
      }

      const rootNode = skeleton.nodes.find(n => !n.plug);
      const moveTargetNode = (dragMode === 'move' && rootNode) ? rootNode : node;
      s.puppetNodeDragRef.current = {
        nodeId: node.id, skeletonId: skeleton.id, characterId: character.id, clipId: resolvedClipId!,
        startX: px, startY: py, origAngle: node.angle, origOffsetX: moveTargetNode.offsetX, origOffsetY: moveTargetNode.offsetY,
        moveTargetNodeId: dragMode === 'move' ? moveTargetNode.id : undefined,
        mode: dragMode, pivotWorldX, pivotWorldY, startMouseAngle, dragStarted: false,
      };
    } else { useProjectStore.getState().setSelectedPuppetNodeId(null); }
  },

  onMouseMove(s, e, px, py) {
    if (!s.puppetNodeDragRef.current) return;
    const drag = s.puppetNodeDragRef.current;
    if (!drag.dragStarted) { const ddx = px - drag.startX; const ddy = py - drag.startY; if (Math.sqrt(ddx * ddx + ddy * ddy) < 2) return; drag.dragStarted = true; useProjectStore.getState().beginDrag(drag.mode === 'rotate' ? '旋转木偶节点' : '移动木偶节点'); s.isDrawingRef.current = true; s.markDirty(); }
    const store = useProjectStore.getState(); const frame = store.currentFrame;
    const skeleton = store.puppetSkeletons.find(sk => sk.id === drag.skeletonId);
    const node = skeleton?.nodes.find(n => n.id === drag.nodeId);
    if (node && skeleton) {
      if (drag.mode === 'rotate') {
        const currentMouseAngle = Math.atan2(py - drag.pivotWorldY, px - drag.pivotWorldX);
        const newAngle = drag.origAngle + Math.round((currentMouseAngle - drag.startMouseAngle) * 180 / Math.PI);
        store.updatePuppetNode(drag.skeletonId, drag.nodeId, { angle: newAngle });
        const clip = store.animationClips.find(c => c.id === drag.clipId);
        if (clip) { const existingKf = (clip.puppetNodeKeyframes ?? []).find(kf => kf.nodeId === drag.nodeId && kf.frame === frame); if (existingKf) store.updatePuppetNodeKeyframe(clip.id, existingKf.id, { angle: newAngle, direction: skeleton.currentDirection }); else store.addPuppetNodeKeyframe(clip.id, drag.nodeId, frame, { angle: newAngle, stretch: node.stretch, offsetX: node.offsetX, offsetY: node.offsetY, direction: skeleton.currentDirection }); }
      } else {
        const ddx = px - drag.startX; const ddy = py - drag.startY;
        const newOffsetX = Math.round(drag.origOffsetX + ddx); const newOffsetY = Math.round(drag.origOffsetY + ddy);
        const targetNodeId = drag.moveTargetNodeId ?? drag.nodeId;
        store.updatePuppetNode(drag.skeletonId, targetNodeId, { offsetX: newOffsetX, offsetY: newOffsetY });
        const clip = store.animationClips.find(c => c.id === drag.clipId);
        if (clip) { const existingKf = (clip.puppetNodeKeyframes ?? []).find(kf => kf.nodeId === targetNodeId && kf.frame === frame); if (existingKf) store.updatePuppetNodeKeyframe(clip.id, existingKf.id, { offsetX: newOffsetX, offsetY: newOffsetY, direction: skeleton.currentDirection }); else { const targetNode = skeleton.nodes.find(n => n.id === targetNodeId); store.addPuppetNodeKeyframe(clip.id, targetNodeId, frame, { angle: targetNode?.angle ?? 0, stretch: targetNode?.stretch ?? 1, offsetX: newOffsetX, offsetY: newOffsetY, direction: skeleton.currentDirection }); } }
      }
    }
  },

  onKeyDown(s, e) {
    if (e.ctrlKey || e.metaKey) return;
    const projectState = useProjectStore.getState();
    const selectedNodeId = projectState.selectedPuppetNodeId;
    if (!selectedNodeId) return;

    const skeleton = projectState.puppetSkeletons.find(sk => sk.nodes.some(n => n.id === selectedNodeId));
    const node = skeleton?.nodes.find(n => n.id === selectedNodeId);
    if (!skeleton || !node) return;

    const character = projectState.puppetCharacters.find(c => c.puppetSkeletonId === skeleton.id);
    const clip = character ? projectState.animationClips.find(c => c.isPuppetClip && c.puppetCharacterId === character.id) : null;
    const ANGLE_STEP = 15;

    if (e.code === 'KeyQ') {
      e.preventDefault();
      const newAngle = node.angle - ANGLE_STEP;
      projectState.updatePuppetNode(skeleton.id, node.id, { angle: newAngle });
      if (clip) { const frame = projectState.currentFrame; const existingKf = (clip.puppetNodeKeyframes ?? []).find(kf => kf.nodeId === node.id && kf.frame === frame); if (existingKf) projectState.updatePuppetNodeKeyframe(clip.id, existingKf.id, { angle: newAngle, direction: skeleton.currentDirection }); else projectState.addPuppetNodeKeyframe(clip.id, node.id, frame, { angle: newAngle, stretch: node.stretch, offsetX: node.offsetX, offsetY: node.offsetY, direction: skeleton.currentDirection }); }
    } else if (e.code === 'KeyE' && !e.shiftKey) {
      e.preventDefault();
      const newAngle = node.angle + ANGLE_STEP;
      projectState.updatePuppetNode(skeleton.id, node.id, { angle: newAngle });
      if (clip) { const frame = projectState.currentFrame; const existingKf = (clip.puppetNodeKeyframes ?? []).find(kf => kf.nodeId === node.id && kf.frame === frame); if (existingKf) projectState.updatePuppetNodeKeyframe(clip.id, existingKf.id, { angle: newAngle, direction: skeleton.currentDirection }); else projectState.addPuppetNodeKeyframe(clip.id, node.id, frame, { angle: newAngle, stretch: node.stretch, offsetX: node.offsetX, offsetY: node.offsetY, direction: skeleton.currentDirection }); }
    } else if (e.code === 'KeyW' || e.code === 'KeyS' || e.code === 'KeyA' || e.code === 'KeyD' || e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const interactionMode = s.editorStore.getState().puppetInteractionMode;
      if (interactionMode === 'move') {
        const rootNode = skeleton.nodes.find(n => !n.plug);
        if (rootNode) {
          const MOVE_STEP = 1; let dOffsetX = 0; let dOffsetY = 0;
          if (e.code === 'KeyW' || e.code === 'ArrowUp') dOffsetY = -MOVE_STEP;
          else if (e.code === 'KeyS' || e.code === 'ArrowDown') dOffsetY = MOVE_STEP;
          else if (e.code === 'KeyA' || e.code === 'ArrowLeft') dOffsetX = -MOVE_STEP;
          else if (e.code === 'KeyD' || e.code === 'ArrowRight') dOffsetX = MOVE_STEP;
          const newOffsetX = rootNode.offsetX + dOffsetX; const newOffsetY = rootNode.offsetY + dOffsetY;
          projectState.updatePuppetNode(skeleton.id, rootNode.id, { offsetX: newOffsetX, offsetY: newOffsetY });
          if (clip) { const frame = projectState.currentFrame; const existingKf = (clip.puppetNodeKeyframes ?? []).find(kf => kf.nodeId === rootNode.id && kf.frame === frame); if (existingKf) projectState.updatePuppetNodeKeyframe(clip.id, existingKf.id, { offsetX: newOffsetX, offsetY: newOffsetY, direction: skeleton.currentDirection }); else projectState.addPuppetNodeKeyframe(clip.id, rootNode.id, frame, { angle: rootNode.angle, stretch: rootNode.stretch, offsetX: newOffsetX, offsetY: newOffsetY, direction: skeleton.currentDirection }); }
        }
      } else {
        // Manipulate mode: WASD/arrows adjust endpoint position via angle
        const pivotPos = s.computePivotWorldPosition(node, skeleton, s.canvasWidth, s.canvasHeight);
        const activeCostumeSet = character?.activeCostumeSetId ? character?.costumeSets.find(cs => cs.id === character.activeCostumeSetId) : null;
        const direction = skeleton.currentDirection;
        const part = resolvePuppetNodeSprite(node, direction, activeCostumeSet ?? null, projectState.parts);

        let worldAngle = 0;
        const parentMap = new Map<string, { parentId: string; socketId: string }>();
        for (const n of skeleton.nodes) { if (n.plug) { const parentNode = skeleton.nodes.find(pn => pn.sockets.some(s2 => s2.id === n.plug!.socketId)); if (parentNode) parentMap.set(n.id, { parentId: parentNode.id, socketId: n.plug.socketId }); } }
        let curId: string | null = node.id; const angleChain: string[] = [];
        while (curId) { angleChain.unshift(curId); const pInfo = parentMap.get(curId); curId = pInfo?.parentId ?? null; }
        for (const nid of angleChain) { const n = skeleton.nodes.find(nn => nn.id === nid); if (n) worldAngle += n.angle; }

        let endWorldX = pivotPos.x; let endWorldY = pivotPos.y;
        if (part) { const endLocal = computeSpriteEndPoint(part.width, part.height, part.pivotX, part.pivotY); const rad = (worldAngle * Math.PI) / 180; endWorldX = pivotPos.x + endLocal.x * Math.cos(rad) - endLocal.y * Math.sin(rad); endWorldY = pivotPos.y + endLocal.x * Math.sin(rad) + endLocal.y * Math.cos(rad); }

        const TARGET_OFFSET = 10; let targetX = endWorldX; let targetY = endWorldY;
        if (e.code === 'KeyW' || e.code === 'ArrowUp') targetY -= TARGET_OFFSET;
        else if (e.code === 'KeyS' || e.code === 'ArrowDown') targetY += TARGET_OFFSET;
        else if (e.code === 'KeyA' || e.code === 'ArrowLeft') targetX -= TARGET_OFFSET;
        else if (e.code === 'KeyD' || e.code === 'ArrowRight') targetX += TARGET_OFFSET;

        const tryAngle = (deltaDeg: number) => {
          const testAngle = worldAngle + deltaDeg; const testRad = (testAngle * Math.PI) / 180;
          if (!part) return { dist: Infinity, newLocalAngle: node.angle + deltaDeg };
          const endLocal = computeSpriteEndPoint(part.width, part.height, part.pivotX, part.pivotY);
          const testEndX = pivotPos.x + endLocal.x * Math.cos(testRad) - endLocal.y * Math.sin(testRad);
          const testEndY = pivotPos.y + endLocal.x * Math.sin(testRad) + endLocal.y * Math.cos(testRad);
          return { dist: Math.sqrt((testEndX - targetX) ** 2 + (testEndY - targetY) ** 2), newLocalAngle: node.angle + deltaDeg };
        };

        const steps = [ANGLE_STEP, -ANGLE_STEP, ANGLE_STEP * 2, -ANGLE_STEP * 2];
        let bestResult = { dist: Infinity, newLocalAngle: node.angle };
        const currentDist = Math.sqrt((endWorldX - targetX) ** 2 + (endWorldY - targetY) ** 2);
        for (const step of steps) { const result = tryAngle(step); if (result.dist < bestResult.dist) bestResult = result; }

        if (bestResult.dist < currentDist) {
          const newAngle = bestResult.newLocalAngle;
          projectState.updatePuppetNode(skeleton.id, node.id, { angle: newAngle });
          if (clip) { const frame = projectState.currentFrame; const existingKf = (clip.puppetNodeKeyframes ?? []).find(kf => kf.nodeId === node.id && kf.frame === frame); if (existingKf) projectState.updatePuppetNodeKeyframe(clip.id, existingKf.id, { angle: newAngle, direction: skeleton.currentDirection }); else projectState.addPuppetNodeKeyframe(clip.id, node.id, frame, { angle: newAngle, stretch: node.stretch, offsetX: node.offsetX, offsetY: node.offsetY, direction: skeleton.currentDirection }); }
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Eyedropper Handler
// ---------------------------------------------------------------------------

export const eyedropperHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    s.applyEyedropper(px, py);
  },
};

// ---------------------------------------------------------------------------
// Fill Tool Handler
// ---------------------------------------------------------------------------

export const fillToolHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    if (s.editMode === 'correction' && s.selectedPartId && s.selectedPart) {
      const selPart = s.selectedPart;
      const store = useProjectStore.getState();
      store.performBatch('填充', () => {
        let currentKf = store.keyframes.find(k => k.partId === s.selectedPartId && k.frame === currentFrame);
        if (!currentKf) currentKf = store.addKeyframe(s.selectedPartId!, currentFrame);
        if (currentKf) {
          let pixelEditMod = currentKf.modifiers.find(m => m.type === 'pixel_edit' && m.enabled);
          let modId = pixelEditMod?.id;
          if (!modId) modId = store.createPixelEditModifier(currentKf.id);
          const { offsetX: txOffF, offsetY: tyOffF } = s.getInterpolatedTranslateOffset(selPart.id, currentFrame);
          const localF = s.canvasToPartLocal(px, py, selPart, txOffF, tyOffF);
          const fillPt = localF ? { x: localF.lx, y: localF.ly } : { x: px, y: py };
          const fillCmd: BrushCommand = { id: crypto.randomUUID(), type: 'fill', color: s.brushColor, size: 1, points: [fillPt], blendMode: 'normal', brushStyle: s.brushStyle !== 'solid' ? s.brushStyle : undefined, brushStyleParams: s.brushStyle !== 'solid' ? s.brushStyleParams : undefined };
          store.addPixelEditCommand(currentKf.id, modId, fillCmd);
        }
      });
      return;
    }
    if (s.editMode === 'part_edit' && s.selectedPartId && s.selectedPart) {
      const selPart = s.selectedPart;
      const editorState = s.editorStore.getState();
      const currentPartEditMods = editorState.partEditModifiers;
      const lastMod = currentPartEditMods[currentPartEditMods.length - 1];
      let modId: string | undefined = (lastMod?.type === 'pixel_edit' && lastMod?.enabled) ? lastMod.id : undefined;
      if (!modId) modId = editorState.addPartEditModifier('pixel_edit');
      if (modId) {
        const offsetX = Math.floor((s.canvasWidth - selPart.width) / 2);
        const offsetY = Math.floor((s.canvasHeight - selPart.height) / 2);
        const fillPt = { x: px - offsetX, y: py - offsetY };
        const fillCmd: BrushCommand = { id: crypto.randomUUID(), type: 'fill', color: s.brushColor, size: 1, points: [fillPt], blendMode: 'normal', brushStyle: s.brushStyle !== 'solid' ? s.brushStyle : undefined, brushStyleParams: s.brushStyle !== 'solid' ? s.brushStyleParams : undefined, ...(s.compositingMode && (s.styleAspects.length > 0 || s.strokeDrivers.length > 0) ? { styleAspects: s.styleAspects.filter(a => a.enabled), strokeDrivers: s.strokeDrivers.filter(d => d.enabled) } : {}) };
        const updatedMods = s.editorStore.getState().partEditModifiers.map(m => {
          if (m.id !== modId) return m;
          const existingCommands: BrushCommand[] = (m.params.brushCommands as BrushCommand[]) || [];
          return { ...m, params: { ...m.params, brushCommands: [...existingCommands, fillCmd] } } as ModifierInstance;
        });
        s.editorStore.getState().setPartEditModifiers(updatedMods);
      }
      return;
    }
    if (s.editMode === 'normal' && s.selectedPartId) s.editorStore.getState().enterPartEditMode(s.selectedPartId);
    s.applyFill(px, py);
  },
};

// ---------------------------------------------------------------------------
// Trajectory Tool Handler
// ---------------------------------------------------------------------------

export const trajectoryHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    if (s.editMode === 'trajectory_edit' && s.selectedPartId) {
      const cpHit = s.findTrajectoryCpAtPixel(px, py);
      if (cpHit) {
        useProjectStore.getState().beginDrag('拖动轨迹控制点');
        s.isDrawingRef.current = true; s.markDirty();
        s.trajectoryCpDragRef.current = { partId: cpHit.partId, segmentIdx: cpHit.segmentIdx, cp: cpHit.cp, startX: px, startY: py, origCp1x: cpHit.cp1x, origCp1y: cpHit.cp1y, origCp2x: cpHit.cp2x, origCp2y: cpHit.cp2y };
        return;
      }
    }
    if (e.shiftKey && s.selectedPartId) { s.isDrawingRef.current = true; s.markDirty(); s.handDrawTrajectoryRef.current = [{ x: px, y: py }]; s.lastPixelRef.current = { x: px, y: py }; return; }
    s.isDrawingRef.current = true; s.markDirty();
    s.trajectoryPathRef.current = [{ x: px, y: py }]; s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current) return;
    if (s.trajectoryCpDragRef.current) {
      const drag = s.trajectoryCpDragRef.current; const ddx = px - drag.startX; const ddy = py - drag.startY;
      const traj = useProjectStore.getState().trajectories.find(t => t.partId === drag.partId);
      if (traj) { const pt = traj.points[drag.segmentIdx]; const nextPt = traj.points[drag.segmentIdx + 1]; if (pt && nextPt) { if (drag.cp === 'cp1') useProjectStore.getState().updateTrajectoryPoint(drag.partId, pt.frame, { cp1x: drag.origCp1x + ddx, cp1y: drag.origCp1y + ddy }); else useProjectStore.getState().updateTrajectoryPoint(drag.partId, nextPt.frame, { cp2x: drag.origCp2x + ddx, cp2y: drag.origCp2y + ddy }); } }
      return;
    }
    if (s.handDrawTrajectoryRef.current.length > 0) {
      if (s.lastPixelRef.current) { for (const point of getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)) s.handDrawTrajectoryRef.current.push({ x: point.x, y: point.y }); }
      else s.handDrawTrajectoryRef.current.push({ x: px, y: py });
      s.lastPixelRef.current = { x: px, y: py }; return;
    }
    if (s.lastPixelRef.current) { for (const point of getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)) s.trajectoryPathRef.current.push({ x: point.x, y: point.y }); }
    else s.trajectoryPathRef.current.push({ x: px, y: py });
    s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseUp(s) {
    // Hand-drawn trajectory
    if (s.isDrawingRef.current && s.handDrawTrajectoryRef.current.length > 2 && s.selectedPartId) {
      const rawPath = s.handDrawTrajectoryRef.current;
      const simplified = simplifyPath(rawPath, 3);
      const totalFrames = useProjectStore.getState().totalFrames;
      const numPoints = Math.min(totalFrames, simplified.length);
      const step = Math.max(1, Math.floor(totalFrames / numPoints));
      for (let i = 0; i < simplified.length; i++) {
        const frame = Math.min(i * step, totalFrames - 1);
        const pt = simplified[i];
        const snapX = s.trajectorySnap ? Math.round(pt.x) : pt.x; const snapY = s.trajectorySnap ? Math.round(pt.y) : pt.y;
        const prevPt = i > 0 ? simplified[i - 1] : simplified[i]; const nextPt = i < simplified.length - 1 ? simplified[i + 1] : simplified[i];
        const cp1x = i > 0 ? (prevPt.x + pt.x) / 2 - pt.x : 0; const cp1y = i > 0 ? (prevPt.y + pt.y) / 2 - pt.y : 0;
        const cp2x = i < simplified.length - 1 ? (nextPt.x + pt.x) / 2 - pt.x : 0; const cp2y = i < simplified.length - 1 ? (nextPt.y + pt.y) / 2 - pt.y : 0;
        useProjectStore.getState().addTrajectoryPoint(s.selectedPartId, frame, snapX, snapY, 0);
        useProjectStore.getState().updateTrajectoryPoint(s.selectedPartId, frame, { cp1x, cp1y, cp2x, cp2y });
      }
      s.handDrawTrajectoryRef.current = [];
    } else if (s.handDrawTrajectoryRef.current.length > 0) s.handDrawTrajectoryRef.current = [];

    // Trajectory freehand path
    if (s.isDrawingRef.current && s.trajectoryPathRef.current.length >= 2 && s.selectedPartId) {
      const path = s.trajectoryPathRef.current; const totalFrames = useProjectStore.getState().totalFrames; const pathLength = path.length;
      const numSamples = Math.min(totalFrames, Math.max(2, Math.round(pathLength / 3)));
      const step = pathLength / numSamples;
      for (let i = 0; i < numSamples; i++) {
        const pathIndex = Math.min(Math.round(i * step), pathLength - 1); const point = path[pathIndex];
        const frame = Math.round((i / (numSamples - 1)) * (totalFrames - 1));
        const snapX = s.trajectorySnap ? Math.round(point.x) : point.x; const snapY = s.trajectorySnap ? Math.round(point.y) : point.y;
        useProjectStore.getState().addTrajectoryPoint(s.selectedPartId, frame, snapX, snapY, 0);
      }
      s.trajectoryPathRef.current = [];
    }

    if (s.trajectoryCpDragRef.current) s.trajectoryCpDragRef.current = null;
  },
};

// ---------------------------------------------------------------------------
// Crop Tool Handler
// ---------------------------------------------------------------------------

export const cropHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    s.isDrawingRef.current = true; s.markDirty(); s.cropStartRef.current = { x: px, y: py }; s.cropRectRef.current = { x1: px, y1: py, x2: px, y2: py };
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current || !s.cropStartRef.current) return;
    s.cropRectRef.current = { x1: s.cropStartRef.current.x, y1: s.cropStartRef.current.y, x2: px, y2: py };
  },

  onMouseUp(s) {
    if (!s.isDrawingRef.current || !s.cropRectRef.current) return;
    const rect = s.cropRectRef.current;
    const cropX = Math.min(rect.x1, rect.x2); const cropY = Math.min(rect.y1, rect.y2);
    const cropW = Math.abs(rect.x2 - rect.x1) + 1; const cropH = Math.abs(rect.y2 - rect.y1) + 1;
    if (cropW >= 2 && cropH >= 2) {
      const store = useProjectStore.getState(); const oldCenterX = s.canvasWidth / 2; const oldCenterY = s.canvasHeight / 2;
      const newCenterOffsetX = cropX + cropW / 2 - oldCenterX; const newCenterOffsetY = cropY + cropH / 2 - oldCenterY;
      store.performBatch('裁剪画布', () => {
        for (const part of store.parts) store.updatePart(part.id, { pivotX: part.pivotX - newCenterOffsetX, pivotY: part.pivotY - newCenterOffsetY, offsetX: (part.offsetX || 0) - newCenterOffsetX, offsetY: (part.offsetY || 0) - newCenterOffsetY });
        for (const traj of store.trajectories) for (const pt of traj.points) store.updateTrajectoryPoint(traj.partId, pt.frame, { x: pt.x - newCenterOffsetX, y: pt.y - newCenterOffsetY });
        store.setCanvasSize(cropW, cropH);
      });
    }
    s.cropStartRef.current = null; s.cropRectRef.current = null;
  },
};

// ---------------------------------------------------------------------------
// Lasso Tool Handler
// ---------------------------------------------------------------------------

export const lassoHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    s.isDrawingRef.current = true; s.markDirty(); s.selectionMaskRef.current.clear(); s.lassoPathRef.current = [{ x: px, y: py }]; s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current) return;
    if (s.lastPixelRef.current) { for (const point of getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)) s.lassoPathRef.current.push({ x: point.x, y: point.y }); }
    else s.lassoPathRef.current.push({ x: px, y: py });
    s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseUp(s) {
    if (!s.isDrawingRef.current || s.lassoPathRef.current.length <= 2) return;
    const path = s.lassoPathRef.current; path.push({ ...path[0] });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of path) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (pointInPolygon(x, y, path)) s.selectionMaskRef.current.add(`${x},${y}`);
    s.lassoPathRef.current = [];
  },
};

// ---------------------------------------------------------------------------
// Magic Wand Handler
// ---------------------------------------------------------------------------

export const magicWandHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const shiftHeld = e.shiftKey; const ctrlHeld = e.ctrlKey || e.metaKey;
    if (!shiftHeld && !ctrlHeld) s.selectionMaskRef.current.clear();
    const offsetX = s.canvasWidth / 2; const offsetY = s.canvasHeight / 2;
    const sortedParts = [...s.parts].filter((p) => p.visible).sort((a, b) => b.zIndex - a.zIndex);
    let targetColor: string | null = null; let targetPart: import('@/lib/types').Part | null = null;
    for (const part of sortedParts) {
      const local = s.canvasToPartLocal(px, py, part);
      if (local && part.pixels[local.ly]?.[local.lx] !== null) { targetColor = part.pixels[local.ly][local.lx]; targetPart = part; break; }
    }
    if (targetColor && targetPart) {
      const local = s.canvasToPartLocal(px, py, targetPart);
      if (!local) return;
      const visited = new Set<string>(); const queue: { lx: number; ly: number }[] = [local]; visited.add(`${local.lx},${local.ly}`);
      const tR = parseInt(targetColor.slice(1, 3), 16); const tG = parseInt(targetColor.slice(3, 5), 16); const tB = parseInt(targetColor.slice(5, 7), 16);
      while (queue.length > 0) {
        const { lx, ly } = queue.shift()!;
        const canvasX = (offsetX - targetPart.pivotX + (targetPart.offsetX || 0)) + lx;
        const canvasY = (offsetY - targetPart.pivotY + (targetPart.offsetY || 0)) + ly;
        const maskKey = `${canvasX},${canvasY}`;
        if (ctrlHeld) s.selectionMaskRef.current.delete(maskKey); else s.selectionMaskRef.current.add(maskKey);
        for (const n of [{ lx: lx - 1, ly }, { lx: lx + 1, ly }, { lx, ly: ly - 1 }, { lx, ly: ly + 1 }]) {
          if (n.lx < 0 || n.lx >= targetPart.width || n.ly < 0 || n.ly >= targetPart.height) continue;
          const nKey = `${n.lx},${n.ly}`; if (visited.has(nKey)) continue; visited.add(nKey);
          const nColor = targetPart.pixels[n.ly]?.[n.lx]; if (nColor === null) continue;
          const nR = parseInt(nColor.slice(1, 3), 16); const nG = parseInt(nColor.slice(3, 5), 16); const nB = parseInt(nColor.slice(5, 7), 16);
          if (Math.abs(tR - nR) + Math.abs(tG - nG) + Math.abs(tB - nB) <= s.magicWandTolerance * 3) queue.push(n);
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Smart Select (SAM) Handler
// ---------------------------------------------------------------------------

export const smartSelectHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    const editor = s.editorStore.getState(); const { samState } = editor;
    if (samState.status === 'idle') { editor.initSAMModel(samState.model); return; }
    if (samState.status === 'ready') {
      if (!samState.currentMask) {
        try {
          const samCanvas = document.createElement('canvas'); samCanvas.width = s.canvasWidth; samCanvas.height = s.canvasHeight;
          const samCtx = samCanvas.getContext('2d');
          if (samCtx && s.canvasWidth > 0 && s.canvasHeight > 0) {
            renderFrame(samCtx, s.canvasWidth, s.canvasHeight, s.nonPuppetParts, s.keyframes, currentFrame, s.backgroundColor, s.effectTracks, undefined, undefined, false, 0.5, undefined, undefined, undefined, s.frameRate, 'low', undefined, s.globalModifiers);
            editor.setSAMImage(samCanvas).then(() => { editor.samSegmentAtPoint(px / s.canvasWidth, py / s.canvasHeight); });
          }
        } catch (err) { console.error('[SAM] Failed to encode image:', err); }
        return;
      }
      editor.samSegmentAtPoint(px / s.canvasWidth, py / s.canvasHeight);
    }
  },
};

// ---------------------------------------------------------------------------
// Inpaint Tool Handler
// ---------------------------------------------------------------------------

export const inpaintHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    const editor = s.editorStore.getState(); const { samState } = editor;
    if (samState.currentMask && s.selectedPart) { editor.applyInpaint(s.selectedPart.id); }
    else if (s.selectedPart) {
      const selPart = s.selectedPart;
      const offsetX = s.canvasWidth / 2; const offsetY = s.canvasHeight / 2;
      const lx = px - (offsetX - selPart.pivotX + (selPart.offsetX || 0));
      const ly = py - (offsetY - selPart.pivotY + (selPart.offsetY || 0));
      const radius = editor.inpaintRadius;
      const mask = new Set<string>();
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) { const mx = lx + dx; const my = ly + dy; if (mx >= 0 && mx < selPart.width && my >= 0 && my < selPart.height) mask.add(`${mx},${my}`); }
      }
      if (mask.size > 0) {
        const store = useProjectStore.getState();
        const currentKf = store.keyframes.find(k => k.partId === selPart.id && k.frame === currentFrame);
        const basePixels = currentKf?.correctionMask ?? selPart.pixels;
        const inpainted = inpaintPixels(basePixels, mask, radius);
        if (currentKf?.correctionMask) store.setCorrection(currentKf.id, inpainted);
        else s.setPartPixels(selPart.id, inpainted);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Brush / Eraser Handler
// ---------------------------------------------------------------------------

export const brushEraserHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    useProjectStore.getState().beginDrag('画笔绘制');
    s.isDrawingRef.current = true; s.markDirty();
    s.lastDrawnPixelsRef.current.clear();
    const color = s.tool === 'eraser' ? null : s.brushColor;

    // Correction mode
    if (s.editMode === 'correction' && s.selectedPartId && s.selectedPart) {
      const selPart = s.selectedPart;
      const store = useProjectStore.getState();
      let currentKf = store.keyframes.find(k => k.partId === s.selectedPartId && k.frame === currentFrame);
      if (!currentKf) currentKf = store.addKeyframe(s.selectedPartId!, currentFrame);
      if (currentKf) {
        let pixelEditMod = currentKf.modifiers.find(m => m.type === 'pixel_edit' && m.enabled);
        let modId = pixelEditMod?.id;
        if (!modId) modId = store.createPixelEditModifier(currentKf.id);
        const cmdId = crypto.randomUUID();
        const { offsetX: txOff2, offsetY: tyOff2 } = s.getInterpolatedTranslateOffset(selPart.id, currentFrame);
        const local2 = s.canvasToPartLocal(px, py, selPart, txOff2, tyOff2);
        const startPt = local2 ? { x: local2.lx, y: local2.ly } : { x: px, y: py };
        s.pixelEditCommandRef.current = { commandId: cmdId, modifierId: modId, keyframeId: currentKf.id, points: [startPt] };
        s.lastPixelRef.current = { x: px, y: py }; return;
      }
    }

    // Normal mode fallback
    if (s.editMode === 'normal') {
      if (s.selectedPartId && s.selectedPart) {
        const selPart = s.selectedPart;
        const editorState = s.editorStore.getState(); editorState.enterPartEditMode(s.selectedPartId!);
        const offsetX = Math.floor((s.canvasWidth - selPart.width) / 2);
        const offsetY = Math.floor((s.canvasHeight - selPart.height) / 2);
        const localX = px - offsetX; const localY = py - offsetY;
        if (localX >= 0 && localX < selPart.width && localY >= 0 && localY < selPart.height) {
          const halfBrush = Math.floor(s.brushSize / 2);
          const newPixels: import('@/lib/types').PixelGrid = selPart.pixels.map((row) => [...row]);
          for (let dy = -halfBrush; dy < s.brushSize - halfBrush; dy++) for (let dx = -halfBrush; dx < s.brushSize - halfBrush; dx++) {
            const tx = localX + dx; const ty = localY + dy;
            if (tx >= 0 && tx < selPart.width && ty >= 0 && ty < selPart.height) newPixels[ty][tx] = color;
          }
          s.setPartPixels(selPart.id, newPixels);
        }
        s.lastPixelRef.current = { x: px, y: py }; return;
      }
      return;
    }

    // part_edit mode
    {
      const projectStore = useProjectStore.getState();
      const editorState = s.editorStore.getState();
      if (editorState.partEditStartFrame !== undefined && editorState.partEditStartFrame !== projectStore.currentFrame) {
        const partId = editorState.partEditPartId!;
        const prevFrame = editorState.partEditStartFrame;
        const existingPkf = projectStore.getPartKeyframeAtFrame(partId, prevFrame);
        const mods = editorState.partEditModifiers.map(m => ({
          ...m,
          params: {
            ...m.params,
            ...(m.params.brushCommands ? { brushCommands: JSON.parse(JSON.stringify(m.params.brushCommands)) } : {}),
          },
        }));
        if (existingPkf) projectStore.updatePartKeyframe(partId, existingPkf.id, { editModifiers: mods });
        else { const pkfId = projectStore.addPartKeyframe(partId, prevFrame); projectStore.updatePartKeyframe(partId, pkfId, { editModifiers: mods }); }
        const resolvedMods = projectStore.resolvePartEditModifiers(partId, projectStore.currentFrame);
        s.editorStore.getState().setPartEditModifiers(resolvedMods.map(m => ({
          ...m,
          params: {
            ...m.params,
            ...(m.params.brushCommands ? { brushCommands: JSON.parse(JSON.stringify(m.params.brushCommands)) } : {}),
          },
        })));
        s.editorStore.setState({ partEditStartFrame: projectStore.currentFrame });
      }
      const currentPartEditMods = s.editorStore.getState().partEditModifiers;
      const lastMod = currentPartEditMods[currentPartEditMods.length - 1];
      let modId: string | undefined = (lastMod?.type === 'pixel_edit' && lastMod?.enabled) ? lastMod.id : undefined;
      if (!modId) modId = editorState.addPartEditModifier('pixel_edit');
      if (modId && s.selectedPart) {
        const selPart = s.selectedPart;
        const cmdId = crypto.randomUUID();
        const offsetX = Math.floor((s.canvasWidth - selPart.width) / 2);
        const offsetY = Math.floor((s.canvasHeight - selPart.height) / 2);
        const startPt = { x: px - offsetX, y: py - offsetY };
        s.partEditBrushCmdRef.current = { commandId: cmdId, modifierId: modId, points: [startPt] };
      }
    }
    s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseMove(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    if (!s.isDrawingRef.current || !s.selectedPart) return;
    const selPart = s.selectedPart;
    const color = s.tool === 'eraser' ? null : s.brushColor;
    if (s.editMode === 'correction' && s.pixelEditCommandRef.current && selPart) {
      const { offsetX: txOff3, offsetY: tyOff3 } = s.getInterpolatedTranslateOffset(selPart.id, currentFrame);
      const local3 = s.canvasToPartLocal(px, py, selPart, txOff3, tyOff3);
      if (local3) s.pixelEditCommandRef.current.points.push({ x: local3.lx, y: local3.ly });
      s.lastPixelRef.current = { x: px, y: py }; return;
    }
    if (s.editMode === 'part_edit' && s.partEditBrushCmdRef.current && selPart) {
      const offsetX = Math.floor((s.canvasWidth - selPart.width) / 2); const offsetY = Math.floor((s.canvasHeight - selPart.height) / 2);
      const localX = px - offsetX; const localY = py - offsetY;
      if (s.lastPixelRef.current) { const lastOffsetX = Math.floor((s.canvasWidth - selPart.width) / 2); const lastOffsetY = Math.floor((s.canvasHeight - selPart.height) / 2); for (const pt of getLinePixels(s.lastPixelRef.current.x - lastOffsetX, s.lastPixelRef.current.y - lastOffsetY, localX, localY)) s.partEditBrushCmdRef.current.points.push({ x: pt.x, y: pt.y }); }
      else s.partEditBrushCmdRef.current.points.push({ x: localX, y: localY });
      s.lastPixelRef.current = { x: px, y: py }; return;
    }
    if (s.lastPixelRef.current) {
      for (let i = 0; i < getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py).length; i++) {
        const point = getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)[i];
        const key = `${point.x},${point.y}`;
        if (!s.lastDrawnPixelsRef.current.has(key)) { s.lastDrawnPixelsRef.current.add(key); s.applyBrush(point.x, point.y, color, i); }
      }
    } else { const key = `${px},${py}`; if (!s.lastDrawnPixelsRef.current.has(key)) { s.lastDrawnPixelsRef.current.add(key); s.applyBrush(px, py, color, 0); } }
    s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseUp(s) {
    // PixelEdit commit
    if (s.pixelEditCommandRef.current) {
      const { commandId, modifierId, keyframeId, points } = s.pixelEditCommandRef.current;
      if (points.length > 0) {
        const cmd: BrushCommand = { id: commandId, type: s.tool === 'eraser' ? 'erase' : 'draw', color: s.brushColor, size: s.brushSize, points, blendMode: 'normal', brushStyle: s.brushStyle !== 'solid' ? s.brushStyle : undefined, brushStyleParams: s.brushStyle !== 'solid' ? s.brushStyleParams : undefined, ...(s.compositingMode && (s.styleAspects.length > 0 || s.strokeDrivers.length > 0) ? { styleAspects: s.styleAspects.filter(a => a.enabled), strokeDrivers: s.strokeDrivers.filter(d => d.enabled) } : {}) };
        useProjectStore.getState().addPixelEditCommand(keyframeId, modifierId, cmd);
      }
      s.pixelEditCommandRef.current = null;
    }

    // PartEdit PixelEdit commit
    if (s.partEditBrushCmdRef.current) {
      const { commandId, modifierId, points } = s.partEditBrushCmdRef.current;
      if (points.length > 0) {
        const cmd: BrushCommand = { id: commandId, type: s.tool === 'eraser' ? 'erase' : 'draw', color: s.brushColor, size: s.brushSize, points, blendMode: 'normal', brushStyle: s.brushStyle !== 'solid' ? s.brushStyle : undefined, brushStyleParams: s.brushStyle !== 'solid' ? s.brushStyleParams : undefined, ...(s.compositingMode && (s.styleAspects.length > 0 || s.strokeDrivers.length > 0) ? { styleAspects: s.styleAspects.filter(a => a.enabled), strokeDrivers: s.strokeDrivers.filter(d => d.enabled) } : {}) };
        const updatedMods = s.editorStore.getState().partEditModifiers.map(m => { if (m.id !== modifierId) return m; const existingCommands: BrushCommand[] = (m.params.brushCommands as BrushCommand[]) || []; return { ...m, params: { ...m.params, brushCommands: [...existingCommands, cmd] } } as ModifierInstance; });
        s.editorStore.getState().setPartEditModifiers(updatedMods);
      }
      s.partEditBrushCmdRef.current = null;
    }
  },
};

// ---------------------------------------------------------------------------
// Stroke Tool Handler (motion_blur_brush, glow_brush, etc.)
// ---------------------------------------------------------------------------

export const strokeToolHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    s.isDrawingRef.current = true; s.markDirty(); s.currentStrokePointsRef.current = [{ x: px, y: py }]; s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current) return;
    if (s.lastPixelRef.current) { for (const point of getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)) s.currentStrokePointsRef.current.push({ x: point.x, y: point.y }); }
    else s.currentStrokePointsRef.current.push({ x: px, y: py });
    s.lastPixelRef.current = { x: px, y: py };
  },
};

// ---------------------------------------------------------------------------
// Bone Tool Handler
// ---------------------------------------------------------------------------

export const boneHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const hitResult = s.findBoneAtPixel(px, py);
    if (hitResult) {
      useProjectStore.getState().beginDrag('拖动骨骼'); s.isDrawingRef.current = true; s.markDirty();
      s.boneDragRef.current = { boneId: hitResult.bone.id, skeletonId: hitResult.skeletonId, endpoint: hitResult.endpoint, startX: px, startY: py, origHeadX: hitResult.bone.headX, origHeadY: hitResult.bone.headY, origTailX: hitResult.bone.tailX, origTailY: hitResult.bone.tailY, origTargetX: hitResult.targetX ?? 0, origTargetY: hitResult.targetY ?? 0 };
      s.editorStore.getState().setSelectedBoneId(hitResult.bone.id);
    } else s.editorStore.getState().setSelectedBoneId(null);
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current || !s.boneDragRef.current) return;
    const currentFrame = s.currentFrameRef.current;
    const drag = s.boneDragRef.current; const ddx = px - drag.startX; const ddy = py - drag.startY;
    if (drag.endpoint === 'head') useProjectStore.getState().updateBone(drag.skeletonId, drag.boneId, { headX: drag.origHeadX + ddx, headY: drag.origHeadY + ddy });
    else if (drag.endpoint === 'tail') useProjectStore.getState().updateBone(drag.skeletonId, drag.boneId, { tailX: drag.origTailX + ddx, tailY: drag.origTailY + ddy });
    else if (drag.endpoint === 'ik_target') useProjectStore.getState().addBonePose(drag.skeletonId, drag.boneId, currentFrame, 0, drag.origTargetX + ddx, drag.origTargetY + ddy);
  },
};

// ---------------------------------------------------------------------------
// IK Tool Handler
// ---------------------------------------------------------------------------

export const ikHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const hitResult = s.findBoneAtPixel(px, py);
    if (hitResult && hitResult.endpoint === 'ik_target') {
      useProjectStore.getState().beginDrag('IK拖动'); s.isDrawingRef.current = true; s.markDirty();
      s.boneDragRef.current = { boneId: hitResult.bone.id, skeletonId: hitResult.skeletonId, endpoint: 'ik_target', startX: px, startY: py, origHeadX: hitResult.bone.headX, origHeadY: hitResult.bone.headY, origTailX: hitResult.bone.tailX, origTailY: hitResult.bone.tailY, origTargetX: hitResult.targetX ?? 0, origTargetY: hitResult.targetY ?? 0 };
      s.editorStore.getState().setSelectedBoneId(hitResult.bone.id);
    } else if (hitResult) s.editorStore.getState().setSelectedBoneId(hitResult.bone.id);
    else s.editorStore.getState().setSelectedBoneId(null);
  },

  // IK shares the same drag logic as bone
  onMouseMove: boneHandler.onMouseMove!,
};

// ---------------------------------------------------------------------------
// Weight Paint Handler
// ---------------------------------------------------------------------------

export const weightPaintHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    useProjectStore.getState().beginDrag('权重绘制'); s.isDrawingRef.current = true; s.markDirty(); s.applyWeightPaint(px, py); s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current) return;
    if (s.lastPixelRef.current) { for (const point of getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)) s.applyWeightPaint(point.x, point.y); }
    else s.applyWeightPaint(px, py);
    s.lastPixelRef.current = { x: px, y: py };
  },
};

// ---------------------------------------------------------------------------
// Dispatch: getToolHandler
// ---------------------------------------------------------------------------

const TILE_TOOLS = new Set(['brush', 'eraser', 'fill', 'eyedropper']);

export function getToolHandler(
  tool: string,
  isTileMode: boolean,
  isPuppetMode: boolean,
): ToolHandler | null {
  // Tile mode takes priority for brush/eraser/fill/eyedropper
  if (isTileMode && TILE_TOOLS.has(tool)) return tileModeHandler;

  // Puppet mode takes priority
  if (isPuppetMode || tool === 'puppet') return puppetHandler;

  // Standard tool dispatch
  switch (tool) {
    case 'move': return moveToolHandler;
    case 'select': return selectToolHandler;
    case 'eyedropper': return eyedropperHandler;
    case 'fill': return fillToolHandler;
    case 'trajectory': return trajectoryHandler;
    case 'crop': return cropHandler;
    case 'lasso': return lassoHandler;
    case 'magic_wand': return magicWandHandler;
    case 'smart_select': return smartSelectHandler;
    case 'inpaint': return inpaintHandler;
    case 'brush':
    case 'eraser': return brushEraserHandler;
    case 'bone': return boneHandler;
    case 'ik': return ikHandler;
    case 'weight_paint': return weightPaintHandler;
    default:
      // Stroke tools (motion_blur_brush, glow_brush, particle_brush, afterimage_brush)
      if (isStrokeToolCheck(tool)) return strokeToolHandler;
      return null;
  }
}
