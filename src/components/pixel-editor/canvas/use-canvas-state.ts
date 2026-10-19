/**
 * use-canvas-state.ts — Custom hook for PixelCanvas state, refs, and helper functions.
 * Encapsulates all Zustand store subscriptions, refs, derived state, and
 * coordinate/drawing helper callbacks.
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useProjectStore } from '@/lib/store';
import { useEditorStore } from '@/lib/store';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { invalidateUnifiedPipelineCache } from '@/lib/unified-render';
import {
  interpolateModifiers,
  computeKeyframeBaseTransform,
  computePartAnimationTransform,
  combineTransformsComponentLevel,
  floodFill,
} from '@/lib/engine';
import { interpolateNodeKeyframes } from '@/lib/engine/render-helpers/puppet-keyframe-interpolation';
import { generateBrushStamp, applyBrushStamp } from '@/lib/brush-engine';
import { inpaintPixels } from '@/lib/inpainting';
import { catmullRomToBezier, isPixelInPart, getPixelAt, computeSpriteEndPoint, spritePivotX, spritePivotY } from './canvas-utils';
import type { PixelColor, PixelGrid, Bone, PuppetNode, PuppetSkeleton, PuppetCharacter, PuppetNodeKeyframe, BrushCommand, ModifierInstance } from '@/lib/types';
import type { Node, Character, Sprite } from '@/lib/unified-types';
import { pxToSub, subToPx } from '@/lib/unified-types';
import { createEmptyPixelGrid } from '@/lib/types';
import { resolvePuppetNodeSprite } from '@/lib/engine/puppet-utils';

export function useCanvasState() {
  // ---- Refs ----
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const refImageRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number>(0);
  const dirtyRef = useRef(true);
  const markDirty = useCallback(() => { dirtyRef.current = true; }, []);

  const onionCacheRef = useRef<Map<number, { canvas: HTMLCanvasElement; version: number; keyframeHash: string }>>(new Map());
  const onionDataVersionRef = useRef(0);
  const onionOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const isPanningRef = useRef(false);
  const isDrawingRef = useRef(false);

  const fpsFramesRef = useRef(0);
  const fpsLastTimeRef = useRef(typeof performance !== 'undefined' ? performance.now() : 0);
  const lastPixelRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const moveStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number; targetLevel: 'keyframe' | 'part_global'; partGlobalOffsetX: number; partGlobalOffsetY: number } | null>(null);
  const spaceHeldRef = useRef(false);
  const altToggleBackupRef = useRef<'keyframe' | 'part_global' | null>(null);
  const lastDrawnPixelsRef = useRef<Set<string>>(new Set());

  const currentStrokePointsRef = useRef<{ x: number; y: number }[]>([]);
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);
  const cropRectRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const trajectoryPathRef = useRef<{ x: number; y: number }[]>([]);
  const handDrawTrajectoryRef = useRef<{ x: number; y: number }[]>([]);
  const trajectoryCpDragRef = useRef<{
    spriteId: string; segmentIdx: number; cp: 'cp1' | 'cp2';
    startX: number; startY: number; origCp1x: number; origCp1y: number; origCp2x: number; origCp2y: number;
  } | null>(null);
  const selectionMaskRef = useRef<Set<string>>(new Set());
  const lassoPathRef = useRef<{ x: number; y: number }[]>([]);
  const selectionMarchOffsetRef = useRef<number>(0);
  const boneDragRef = useRef<{ boneId: string; skeletonId: string; endpoint: 'head' | 'tail' | 'ik_target'; startX: number; startY: number; origHeadX: number; origHeadY: number; origTailX: number; origTailY: number; origTargetX: number; origTargetY: number } | null>(null);
  const puppetNodeDragRef = useRef<{
    nodeId: string; skeletonId: string; characterId: string; clipId: string;
    startX: number; startY: number; origAngle: number; origStretch: number; origOffsetX: number; origOffsetY: number; origOffsetZ?: number;
    mode: 'rotate' | 'move' | 'moveAll' | 'socket' | 'pivot'; pivotWorldX: number; pivotWorldY: number; startMouseAngle: number;
    dragStarted: boolean; moveTargetNodeId?: string; parentWorldAngle?: number; nodeWorldAngle?: number;
    // socket 模式专用
    socketId?: string; parentNodeId?: string; origSocketX?: number; origSocketY?: number; parentAngle?: number;
    // pivot 模式专用
    pivotSpriteId?: string; origPivotX?: number; origPivotY?: number;
  } | null>(null);
  const pixelEditCommandRef = useRef<{ commandId: string; modifierId: string; keyframeId: string; points: { x: number; y: number }[] } | null>(null);
  const spriteEditBrushCmdRef = useRef<{ commandId: string; modifierId: string; points: { x: number; y: number }[] } | null>(null);

  // ---- Dev FPS counter ----
  const [fpsDisplay, setFpsDisplay] = useState('');

  // ---- Store (ref-based for performance) ----
  const currentFrameRef = useRef(useProjectStore.getState().currentFrame);
  const playStateRef = useRef(useEditorStore.getState().playState);
  const zoomRef = useRef(useEditorStore.getState().zoom);
  const panRef = useRef({ x: useEditorStore.getState().panX, y: useEditorStore.getState().panY });

  // ---- Store (reactive selectors) ----
  const spritesRecord = useProjectStore((s) => s.sprites);
  // 全局精灵表（Record）→ 数组；表内精灵 id 必有（addSprite 等写入时生成）
  const parts: (Sprite & { id: string })[] = useMemo(
    () => Object.values(spritesRecord).filter((s): s is Sprite & { id: string } => !!s.id),
    [spritesRecord],
  );
  const keyframes = useProjectStore((s) => s.keyframes);
  const canvasWidth = useProjectStore((s) => s.canvasWidth);
  const canvasHeight = useProjectStore((s) => s.canvasHeight);
  const backgroundColor = useProjectStore((s) => s.backgroundColor);
  const onionSkinEnabled = useProjectStore((s) => s.onionSkinEnabled);
  const onionSkinFrames = useProjectStore((s) => s.onionSkinFrames);
  const trajectories = useProjectStore((s) => s.trajectories);
  const motionBlurStrokes = useProjectStore((s) => s.motionBlurStrokes);
  const effectStrokes = useProjectStore((s) => s.effectStrokes);
  const effectTracks = useProjectStore((s) => s.effectTracks);
  const skeletons = useProjectStore((s) => s.skeletons);
  const proceduralAnimations = useProjectStore((s) => s.proceduralAnimations);
  const canvasModifierTracks = useProjectStore((s) => s.canvasModifierTracks);
  const setPartPixels = useProjectStore((s) => s.setSpritePixels);
  const setCorrection = useProjectStore((s) => s.setCorrection);
  const frameRate = useProjectStore((s) => s.frameRate);
  const setCanvasSize = useProjectStore((s) => s.setCanvasSize);
  const animationVariables = useProjectStore((s) => s.animationVariables);
  const globalModifiers = useProjectStore((s) => s.globalModifiers);
  const unifiedCharacters = useProjectStore((s) => s.unifiedCharacters);
  // All parts are non-puppet now (puppet system deleted)
  const nonPuppetParts = parts;

  // ---- Subscribe to currentFrame/zoom/pan via ref ----
  useEffect(() => {
    const unsub1 = useProjectStore.subscribe((state, prevState) => {
      if (state.currentFrame !== prevState.currentFrame) {
        currentFrameRef.current = state.currentFrame;
        dirtyRef.current = true;
      }
    });
    const unsub2 = useEditorStore.subscribe((state, prevState) => {
      if (state.playState !== prevState.playState) playStateRef.current = state.playState;
      if (state.zoom !== prevState.zoom || state.panX !== prevState.panX || state.panY !== prevState.panY) {
        zoomRef.current = state.zoom;
        panRef.current = { x: state.panX, y: state.panY };
        dirtyRef.current = true;
      }
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  // ---- Puppet mode state ----
  // ---- Editor store selectors ----
  const tool = useEditorStore((s) => s.tool);
  const brushSize = useEditorStore((s) => s.brushSize);
  const brushColor = useEditorStore((s) => s.brushColor);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showTrajectories = useEditorStore((s) => s.showTrajectories);
  const editMode = useEditorStore((s) => s.editMode);
  const selectedSpriteId = useEditorStore((s) => s.selectedSpriteId);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);
  const autoMotionBlur = useEditorStore((s) => s.autoMotionBlur);
  const autoMotionBlurIntensity = useEditorStore((s) => s.autoMotionBlurIntensity);
  const motionBlurBrushType = useEditorStore((s) => s.motionBlurBrushType);
  const motionBlurIntensity = useEditorStore((s) => s.motionBlurIntensity);
  const motionBlurDirection = useEditorStore((s) => s.motionBlurDirection);
  const effectBrushColor = useEditorStore((s) => s.effectBrushColor);
  const effectBrushRadius = useEditorStore((s) => s.effectBrushRadius);
  const effectBrushIntensity = useEditorStore((s) => s.effectBrushIntensity);
  const effectBrushDensity = useEditorStore((s) => s.effectBrushDensity);
  const effectBrushSpread = useEditorStore((s) => s.effectBrushSpread);
  const strokeBlendMode = useEditorStore((s) => s.strokeBlendMode);
  const showSkeletons = useEditorStore((s) => s.showSkeletons);
  const selectedBoneId = useProjectStore((s) => s.selectedBoneId);
  const activeSkeletonId = useEditorStore((s) => s.activeSkeletonId);
  const showWeightPaint = useEditorStore((s) => s.showWeightPaint);
  const weightPaintBoneId = useEditorStore((s) => s.weightPaintBoneId);
  const showPuppetSkeleton = useEditorStore((s) => s.showPuppetSkeleton);
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const referenceImageUrl = useEditorStore((s) => s.referenceImageUrl);
  const referenceImageOpacity = useEditorStore((s) => s.referenceImageOpacity);
  const referenceImageVisible = useEditorStore((s) => s.referenceImageVisible);
  const maskNodeId = useEditorStore((s) => s.maskNodeId);
  const refWizardOpen = useEditorStore((s) => s.refWizardOpen);
  const magicWandTolerance = useEditorStore((s) => s.magicWandTolerance);
  const trajectorySnap = useEditorStore((s) => s.trajectorySnap);
  const spriteEditSpriteId = useEditorStore((s) => s.spriteEditSpriteId);
  const spriteEditModifiers = useEditorStore((s) => s.spriteEditModifiers);
  const brushStyle = useEditorStore((s) => s.brushStyle);
  const brushStyleParams = useEditorStore((s) => s.brushStyleParams);
  const compositingMode = useEditorStore((s) => s.compositingMode);
  const styleAspects = useEditorStore((s) => s.styleAspects);
  const strokeDrivers = useEditorStore((s) => s.strokeDrivers);
  const editorStore = useEditorStore;

  // ---- Derived ----
  const selectedPart: Sprite | null = (selectedSpriteId ? spritesRecord[selectedSpriteId] : undefined) ?? null;

  // ---- Helper: get full translate offset ----
  const getFullTranslateOffset = useCallback(
    (spriteId: string, frame: number): { offsetX: number; offsetY: number } => {
      const store = useProjectStore.getState();
      const { getSurroundingKeyframes: getSurrounding } = store;
      const { prev } = getSurrounding(spriteId, frame);
      const part = store.sprites[spriteId];
      if (!part) return { offsetX: 0, offsetY: 0 };

      const keyframe = prev;
      const allModifiers = keyframe && !keyframe.isBaked ? keyframe.modifiers : [];
      const modifiers = allModifiers.filter(m => !m.collapsed);
      const kfBase = computeKeyframeBaseTransform(modifiers);
      const animTransform = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1, weight: 0, blendMode: 'add' as const, convergeFactor: 1 }; // Part 无 animationModifiers
      const combined = combineTransformsComponentLevel(kfBase, animTransform, animTransform.blendMode, animTransform.convergeFactor);

      const partGlobalOffsetX = 0;
      const partGlobalOffsetY = 0;
      return { offsetX: combined.translateX + partGlobalOffsetX, offsetY: combined.translateY + partGlobalOffsetY };
    }, [],
  );
  const getInterpolatedTranslateOffset = getFullTranslateOffset;

  // ---- Helper: get interpolated modifiers ----
  const getInterpolatedModifiers = useCallback(
    (spriteId: string, frame: number) => {
      const { getSurroundingKeyframes: getSurrounding } = useProjectStore.getState();
      const { prev, next, t } = getSurrounding(spriteId, frame);
      if (prev && next && prev.frame !== next.frame && t > 0) {
        return interpolateModifiers(prev.modifiers, next.modifiers, t, prev.interpolationMode ?? 'linear', prev.bezierCP1, prev.bezierCP2);
      } else if (prev) return prev.modifiers;
      return [];
    }, [],
  );

  // ---- Canvas size editor ----
  const [canvasSizeEditing, setCanvasSizeEditing] = useState(false);
  const [canvasSizeW, setCanvasSizeW] = useState(canvasWidth);
  const [canvasSizeH, setCanvasSizeH] = useState(canvasHeight);

  const applyCanvasSize = useCallback(() => {
    const w = Math.max(1, Math.min(2048, canvasSizeW));
    const h = Math.max(1, Math.min(2048, canvasSizeH));
    if (w !== canvasWidth || h !== canvasHeight) setCanvasSize(w, h);
    setCanvasSizeEditing(false);
  }, [canvasSizeW, canvasSizeH, canvasWidth, canvasHeight, setCanvasSize]);

  // ---- Container size tracking ----
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ---- Coordinate conversion ----
  const screenToPixel = useCallback(
    (clientX: number, clientY: number): { px: number; py: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { px: 0, py: 0 };
      const rect = canvas.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;
      const px = Math.floor((mouseX - panX) / zoom);
      const py = Math.floor((mouseY - panY) / zoom);
      return { px, py };
    }, [panX, panY, zoom],
  );

  const canvasToPartLocal = useCallback(
    (px: number, py: number, part: Sprite, translateOffsetX: number = 0, translateOffsetY: number = 0): { lx: number; ly: number } | null => {
      if (editMode === 'sprite_edit' && spriteEditSpriteId === part.id) {
        const offsetX = Math.floor((canvasWidth - part.width) / 2);
        const offsetY = Math.floor((canvasHeight - part.height) / 2);
        const localX = px - offsetX;
        const localY = py - offsetY;
        if (localX < 0 || localX >= part.width || localY < 0 || localY >= part.height) return null;
        return { lx: localX, ly: localY };
      }
      const offsetX = canvasWidth / 2;
      const offsetY = canvasHeight / 2;
      const localX = px - (offsetX - spritePivotX(part) + 0 + translateOffsetX);
      const localY = py - (offsetY - spritePivotY(part) + 0 + translateOffsetY);
      if (localX < 0 || localX >= part.width || localY < 0 || localY >= part.height) return null;
      return { lx: localX, ly: localY };
    }, [canvasWidth, canvasHeight, editMode, spriteEditSpriteId],
  );

  // ---- Find topmost part at pixel position ----
  const findPartAtPixel = useCallback(
    (px: number, py: number): Sprite | null => {
      const offsetX = canvasWidth / 2;
      const offsetY = canvasHeight / 2;
      const frame = useProjectStore.getState().currentFrame;
      const sorted = [...parts].sort((a, b) => 0);
      for (const part of sorted) {
        const { offsetX: txOff, offsetY: tyOff } = getInterpolatedTranslateOffset(part.id, frame);
        if (isPixelInPart(px, py, part, offsetX, offsetY, txOff, tyOff)) {
          const color = getPixelAt(px, py, part, offsetX, offsetY, txOff, tyOff);
          if (color !== null) return part;
        }
      }
      return null;
    }, [parts, canvasWidth, canvasHeight, getInterpolatedTranslateOffset],
  );

  // ---- Drawing helpers ----
  const applyBrush = useCallback(
    (px: number, py: number, color: PixelColor, stampIndex: number = 0) => {
      const currentFrame = currentFrameRef.current;
      if (!selectedPart) return;
      const { offsetX: txOff, offsetY: tyOff } = getInterpolatedTranslateOffset(selectedPart.id!, currentFrame);
      const local = canvasToPartLocal(px, py, selectedPart, txOff, tyOff);
      if (!local) return;

      const store = useProjectStore.getState();
      const currentKf = store.keyframes.find(k => k.spriteId === selectedPart.id! && k.frame === currentFrame);
      const basePixels = currentKf?.correctionMask ?? selectedPart.data;
      const newPixels: PixelGrid = basePixels.map((row) => [...row]);

      if (brushStyle === 'solid' || color === null) {
        const halfBrush = Math.floor(brushSize / 2);
        for (let dy = -halfBrush; dy < brushSize - halfBrush; dy++) {
          for (let dx = -halfBrush; dx < brushSize - halfBrush; dx++) {
            const tx = local.lx + dx;
            const ty = local.ly + dy;
            if (tx >= 0 && tx < selectedPart.width && ty >= 0 && ty < selectedPart.height) {
              newPixels[ty][tx] = color;
            }
          }
        }
      } else {
        const drawColor = color ?? '#000000';
        const stamp = generateBrushStamp(brushStyle, brushSize, drawColor, brushStyleParams, stampIndex * 7919);
        applyBrushStamp(newPixels, stamp, local.lx, local.ly, selectedPart.width, selectedPart.height);
      }

      if (currentKf?.correctionMask) store.setCorrection(currentKf.id, newPixels);
      else setPartPixels(selectedPart.id!, newPixels);
    }, [selectedPart, brushSize, brushStyle, brushStyleParams, canvasToPartLocal, setPartPixels, setCorrection, getInterpolatedTranslateOffset, canvasWidth, canvasHeight],
  );

  const applyFill = useCallback(
    (px: number, py: number) => {
      const currentFrame = currentFrameRef.current;
      if (!selectedPart) return;
      const { offsetX: txOff, offsetY: tyOff } = getInterpolatedTranslateOffset(selectedPart.id!, currentFrame);
      const local = canvasToPartLocal(px, py, selectedPart, txOff, tyOff);
      if (!local) return;

      const store = useProjectStore.getState();
      const currentKf = store.keyframes.find(k => k.spriteId === selectedPart.id! && k.frame === currentFrame);
      const basePixels = currentKf?.correctionMask ?? selectedPart.data;
      const filled = floodFill(basePixels, local.lx, local.ly, brushColor);
      if (currentKf?.correctionMask) store.setCorrection(currentKf.id, filled);
      else setPartPixels(selectedPart.id!, filled);
    }, [selectedPart, brushColor, canvasToPartLocal, setPartPixels, setCorrection, getInterpolatedTranslateOffset, canvasWidth, canvasHeight],
  );

  const applyEyedropper = useCallback(
    (px: number, py: number) => {
      const offsetX = canvasWidth / 2;
      const offsetY = canvasHeight / 2;
      const frame = useProjectStore.getState().currentFrame;
      const sorted = [...parts].sort((a, b) => 0);
      for (const part of sorted) {
        const { offsetX: txOff, offsetY: tyOff } = getInterpolatedTranslateOffset(part.id, frame);
        if (isPixelInPart(px, py, part, offsetX, offsetY, txOff, tyOff)) {
          const color = getPixelAt(px, py, part, offsetX, offsetY, txOff, tyOff);
          if (color) { editorStore.getState().setBrushColor(color); return; }
        }
      }
    }, [parts, canvasWidth, canvasHeight, editorStore, getInterpolatedTranslateOffset],
  );

  // ---- V2.0: Find bone at pixel position ----
  const findBoneAtPixel = useCallback(
    (px: number, py: number): { bone: Bone; skeletonId: string; endpoint: 'head' | 'tail' | 'ik_target'; targetX?: number; targetY?: number } | null => {
      const currentFrame = currentFrameRef.current;
      const hitRadius = Math.max(6 / zoom, 2);
      for (const skeleton of skeletons) {
        if (!skeleton.visible) continue;
        for (const bone of skeleton.bones) {
          if (!bone.visible) continue;
          for (const constraint of bone.constraints) {
            if (constraint.type === 'ik_solver') {
              const pose = skeleton.poses.find(p => p.boneId === bone.id && p.frame === currentFrame);
              const targetX = pose?.ikTargetX ?? constraint.targetX;
              const targetY = pose?.ikTargetY ?? constraint.targetY;
              if (Math.sqrt(Math.pow(px - targetX, 2) + Math.pow(py - targetY, 2)) <= hitRadius) {
                return { bone, skeletonId: skeleton.id, endpoint: 'ik_target', targetX, targetY };
              }
            }
          }
          if (Math.sqrt(Math.pow(px - bone.headX, 2) + Math.pow(py - bone.headY, 2)) <= hitRadius)
            return { bone, skeletonId: skeleton.id, endpoint: 'head' };
          if (Math.sqrt(Math.pow(px - bone.tailX, 2) + Math.pow(py - bone.tailY, 2)) <= hitRadius)
            return { bone, skeletonId: skeleton.id, endpoint: 'tail' };
        }
      }
      return null;
    }, [skeletons, zoom],
  );

  // ---- Compute puppet node world pivot position ----
  // 单位统一：内部全 SubPixel，返回画布像素（调用方按像素用）
  const computePivotWorldPosition = useCallback(
    (node: Node, character: Character, canvasW: number, canvasH: number): { x: number; y: number } => {
      // 用当前帧插值，不是 rest pose
      const state = useProjectStore.getState();
      const ivMap = interpolateNodeKeyframes(character, state.currentFrame);
      const centerX = pxToSub(canvasW / 2);
      const centerY = pxToSub(canvasH / 2);
      const nodes = Object.values(character.nodes);

      const parentMap = new Map<string, { parentId: string; socketId: string }>();
      for (const n of nodes) {
        if (n.attachment?.type === 'socket' && n.attachment.parentSocketId) {
          const socketId = n.attachment.parentSocketId;
          const parentNode = nodes.find(pn => pn.sockets.some(s => s.id === socketId));
          if (parentNode) parentMap.set(n.id, { parentId: parentNode.id, socketId });
        }
      }

      const worldPositions = new Map<string, { x: number; y: number; angle: number }>();
      function computeNodeWorldPos(nodeId: string, parentWorldX: number, parentWorldY: number, parentWorldAngle: number): { x: number; y: number; angle: number } {
        const n = character.nodes[nodeId];
        if (!n) return { x: parentWorldX, y: parentWorldY, angle: 0 };
        const iv = ivMap.get(nodeId);
        const angle = iv?.angle ?? n.transform.angle ?? 0;
        const offsetX = iv?.x ?? n.transform.x ?? 0;
        const offsetY = iv?.y ?? n.transform.y ?? 0;
        let worldX: number, worldY: number;
        const isSocketAttached = n.attachment?.type === 'socket';
        if (!isSocketAttached) { worldX = Math.round(centerX + offsetX); worldY = Math.round(centerY + offsetY); }
        else {
          const parentInfo = parentMap.get(n.id);
          if (parentInfo) {
            const parentPos = worldPositions.get(parentInfo.parentId);
            if (parentPos) {
              const parentNode = character.nodes[parentInfo.parentId];
              const socket = parentNode?.sockets.find(s => s.id === parentInfo.socketId);
              if (socket && parentNode) {
                const parentAngleRad = (parentPos.angle * Math.PI) / 180;
                const cosA = Math.cos(parentAngleRad); const sinA = Math.sin(parentAngleRad);
                const rotatedOffsetX = offsetX * cosA - offsetY * sinA;
                const rotatedOffsetY = offsetX * sinA + offsetY * cosA;
                const dir4 = (parentNode.transform.variantIndex ?? 0) as 0|1|2|3|4|5|6|7;
                const sockOff4 = socket.directionOffsets?.[dir4] ?? socket.basePosition;
                worldX = Math.round(parentPos.x + (sockOff4.x * cosA - sockOff4.y * sinA) + rotatedOffsetX);
                worldY = Math.round(parentPos.y + (sockOff4.x * sinA + sockOff4.y * cosA) + rotatedOffsetY);
              } else { worldX = Math.round(parentPos.x + offsetX); worldY = Math.round(parentPos.y + offsetY); }
            } else { worldX = Math.round(centerX + offsetX); worldY = Math.round(centerY + offsetY); }
          } else { worldX = Math.round(centerX + offsetX); worldY = Math.round(centerY + offsetY); }
        }
        const worldAngle = parentWorldAngle + angle;
        const pos = { x: worldX, y: worldY, angle: worldAngle };
        worldPositions.set(n.id, pos);
        for (const childInfo of nodes.filter(nn => nn.attachment?.type === 'socket' && parentMap.get(nn.id)?.parentId === n.id)) computeNodeWorldPos(childInfo.id, worldX, worldY, worldAngle);
        return pos;
      }
      for (const n of nodes) { if (n.attachment?.type !== 'socket') computeNodeWorldPos(n.id, centerX, centerY, 0); }
      const nodePos = worldPositions.get(node.id);
      // 返回画布像素
      return nodePos ? { x: subToPx(nodePos.x), y: subToPx(nodePos.y) } : { x: subToPx(centerX), y: subToPx(centerY) };
    }, [],
  );

  // ---- Puppet node hit-testing (Character model) ----
  const findPuppetNodeAtPixel = useCallback(
    (px: number, py: number): { node: Node; character: Character; clipId: string | null } | null => {
      // 单位统一：内部全 SubPixel。px/py（画布像素）、hitRadius（画布像素）入口转 SubPixel。
      const hitRadius = pxToSub(Math.max(20 / zoom, 8));
      const clickX = pxToSub(px);
      const clickY = pxToSub(py);
      const state = useProjectStore.getState();
      const characters = state.unifiedCharacters;
      const clips = state.animationClips;
      let bestHit: { node: Node; character: Character; clipId: string | null; score: number } | null = null;

      for (const character of Object.values(characters)) {
        const clip = clips.find(c => c.puppetCharacterId === character.id);
        const worldPositions = new Map<string, { x: number; y: number; angle: number }>();
        const centerX = pxToSub(canvasWidth / 2);
        const centerY = pxToSub(canvasHeight / 2);
        const nodes = Object.values(character.nodes);
        // 用当前帧插值（不是 rest pose），否则移动/旋转后点击不准
        const ivMap = interpolateNodeKeyframes(character, state.currentFrame);

        function computeNodeWorldPos(nodeId: string, parentWorldX: number, parentWorldY: number, parentWorldAngle: number): { x: number; y: number; angle: number } {
          const node = character.nodes[nodeId];
          if (!node) return { x: parentWorldX, y: parentWorldY, angle: 0 };
          const iv = ivMap.get(nodeId);
          const angle = iv?.angle ?? node.transform.angle;
          const offsetX = iv?.x ?? node.transform.x;
          const offsetY = iv?.y ?? node.transform.y;
          let worldX: number, worldY: number;
          const isRoot = !node.parentId;
          if (isRoot) {
            worldX = Math.round(centerX + offsetX);
            worldY = Math.round(centerY + offsetY);
          } else {
            const parentNode = node.parentId ? character.nodes[node.parentId] : undefined;
            const parentPos = node.parentId ? worldPositions.get(node.parentId) : undefined;
            if (parentPos && parentNode) {
              // Socket attachment: find socket position on parent
              // 全 SubPixel：socket.basePosition、offset 均为 SubPixel，直接用
              const socketId = node.attachment.parentSocketId;
              const socket = socketId ? parentNode.sockets.find(s => s.id === socketId) : undefined;
              const parentAngleRad = (parentPos.angle * Math.PI) / 180;
              const cosA = Math.cos(parentAngleRad); const sinA = Math.sin(parentAngleRad);
              const dir5 = (parentNode.transform.variantIndex ?? 0) as 0|1|2|3|4|5|6|7;
              const sockOff5 = socket?.directionOffsets?.[dir5] ?? socket?.basePosition;
              const socketX = sockOff5?.x ?? 0;
              const socketY = sockOff5?.y ?? 0;
              // World pos = parent pos + rotated (socket pos + offset)
              // 与 overlay/主渲染一致：不减 plug
              const localX = socketX + offsetX;
              const localY = socketY + offsetY;
              worldX = Math.round(parentPos.x + localX * cosA - localY * sinA);
              worldY = Math.round(parentPos.y + localX * sinA + localY * cosA);
            } else {
              worldX = Math.round(centerX + offsetX);
              worldY = Math.round(centerY + offsetY);
            }
          }
          const worldAngle = parentWorldAngle + angle;
          worldPositions.set(node.id, { x: worldX, y: worldY, angle: worldAngle });
          for (const child of nodes.filter(n => n.parentId === node.id)) {
            computeNodeWorldPos(child.id, worldX, worldY, worldAngle);
          }
          return { x: worldX, y: worldY, angle: worldAngle };
        }
        for (const node of nodes) { if (!node.parentId) computeNodeWorldPos(node.id, centerX, centerY, 0); }

        const activeCostumeSet = character.activeCostumeSetId
          ? character.costumeSets.find(cs => cs.id === character.activeCostumeSetId)
          : null;
        // Direction from root node transform
        const rootNode = character.nodes[character.rootNodeId];
        const direction = (rootNode?.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

        for (const node of nodes) {
          if (!node.visible) continue;
          const pos = worldPositions.get(node.id);
          if (!pos) continue;
          // Resolve sprite from Character.sprites table (via costumePiece or node.sprite)
          let sprite: import('@/lib/unified-types').Sprite | null = null;
          if (node.slot && activeCostumeSet) {
            const piece = activeCostumeSet.pieces[node.slot.slotKey];
            if (piece) {
              const ref = piece.sprites[direction] ?? piece.sprites[0];
              if (ref) {
                sprite = 'spriteId' in ref ? (useProjectStore.getState().sprites[ref.spriteId] ?? null) : ref;
              }
            }
          }
          if (!sprite && node.sprite) sprite = node.sprite;
          let endWorldX: number, endWorldY: number;
          if (sprite) {
            // plug 是 SubPixel，转像素后与 width/height（像素）一致计算，再转回 SubPixel
            const endLocal = computeSpriteEndPoint(sprite.width, sprite.height, subToPx(sprite.plug?.x ?? 0), subToPx(sprite.plug?.y ?? 0));
            const rad = (pos.angle * Math.PI) / 180;
            endWorldX = pos.x + pxToSub(endLocal.x * Math.cos(rad) - endLocal.y * Math.sin(rad));
            endWorldY = pos.y + pxToSub(endLocal.x * Math.sin(rad) + endLocal.y * Math.cos(rad));
          } else { endWorldX = pos.x; endWorldY = pos.y; }

          let score: number;
          const isRoot = !node.parentId;
          if (isRoot) {
            score = Math.min(Math.sqrt((clickX - endWorldX) ** 2 + (clickY - endWorldY) ** 2), Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2));
          } else {
            const distToEnd = Math.sqrt((clickX - endWorldX) ** 2 + (clickY - endWorldY) ** 2);
            const midX = (pos.x + endWorldX) / 2; const midY = (pos.y + endWorldY) / 2;
            score = Math.min(distToEnd * 0.7, Math.sqrt((clickX - midX) ** 2 + (clickY - midY) ** 2));
          }
          const spriteExtent = pxToSub(sprite ? Math.max(sprite.width, sprite.height) / 2 : 5);
          const maxDist = hitRadius + spriteExtent;
          if (score <= maxDist && (!bestHit || score < bestHit.score)) {
            bestHit = { node, character, clipId: clip?.id ?? null, score };
          }
        }
      }
      return bestHit ? { node: bestHit.node, character: bestHit.character, clipId: bestHit.clipId } : null;
    }, [canvasWidth, canvasHeight, zoom],
  );

  // ---- Find trajectory control point handle ----
  const findTrajectoryCpAtPixel = useCallback(
    (px: number, py: number) => {
      const hitRadius = Math.max(8 / zoom, 3);
      const centerX = canvasWidth / 2;
      const centerY = canvasHeight / 2;
      const { catmullRomToBezier: crb } = { catmullRomToBezier };

      for (const traj of trajectories) {
        if (!traj.visible || traj.points.length < 2) continue;
        if (traj.spriteId !== selectedSpriteId) continue;
        const screenPoints = traj.points.map((pt) => ({ x: panX + (centerX + pt.x) * zoom, y: panY + (centerY + pt.y) * zoom }));
        for (let i = 0; i < screenPoints.length - 1; i++) {
          const p0 = i > 0 ? screenPoints[i - 1] : screenPoints[i];
          const p1 = screenPoints[i]; const p2 = screenPoints[i + 1];
          const p3 = i < screenPoints.length - 2 ? screenPoints[i + 2] : screenPoints[i + 1];
          const bez = crb({ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }, { x: p3.x, y: p3.y });
          const curvePt = traj.points[i]; const nextCurvePt = traj.points[i + 1];
          let cp1x = bez.cp1x, cp1y = bez.cp1y, cp2x = bez.cp2x, cp2y = bez.cp2y;
          if (curvePt && (curvePt.cp1x !== 0 || curvePt.cp1y !== 0)) { cp1x = p1.x + curvePt.cp1x * zoom; cp1y = p1.y + curvePt.cp1y * zoom; }
          if (nextCurvePt && (nextCurvePt.cp2x !== 0 || nextCurvePt.cp2y !== 0)) { cp2x = p2.x + nextCurvePt.cp2x * zoom; cp2y = p2.y + nextCurvePt.cp2y * zoom; }
          if (Math.sqrt((px * zoom + panX - cp1x) ** 2 + (py * zoom + panY - cp1y) ** 2) <= hitRadius) {
            return { spriteId: traj.spriteId, segmentIdx: i, cp: 'cp1' as const, cp1x: curvePt?.cp1x ?? 0, cp1y: curvePt?.cp1y ?? 0, cp2x: nextCurvePt?.cp2x ?? 0, cp2y: nextCurvePt?.cp2y ?? 0 };
          }
          if (Math.sqrt((px * zoom + panX - cp2x) ** 2 + (py * zoom + panY - cp2y) ** 2) <= hitRadius) {
            return { spriteId: traj.spriteId, segmentIdx: i, cp: 'cp2' as const, cp1x: curvePt?.cp1x ?? 0, cp1y: curvePt?.cp1y ?? 0, cp2x: nextCurvePt?.cp2x ?? 0, cp2y: nextCurvePt?.cp2y ?? 0 };
          }
        }
      }
      return null;
    }, [trajectories, selectedSpriteId, canvasWidth, canvasHeight, zoom, panX, panY],
  );

  // ---- Apply weight paint ----
  const applyWeightPaint = useCallback(
    (px: number, py: number) => {
      if (!weightPaintBoneId) return;
      const hitPart = findPartAtPixel(px, py);
      if (!hitPart) return;
      for (const skeleton of skeletons) {
        const bone = skeleton.bones.find(b => b.id === weightPaintBoneId);
        if (bone) { useProjectStore.getState().bindPartToBone(skeleton.id, weightPaintBoneId, hitPart.id!, 1.0); break; }
      }
    }, [weightPaintBoneId, findPartAtPixel, skeletons],
  );

  // ---- Extract selection pixels as a new part ----
  const extractSelectionAsPart = useCallback((mode: 'keep' | 'transparent' | 'fill' | 'inpaint' = 'keep', fillColor: string = '#000000', partName: string = '选区') => {
    const mask = selectionMaskRef.current;
    if (mask.size === 0) return;
    const projectStore = useProjectStore.getState();
    projectStore.performBatch('提取选区', () => {
      const { addSprite, setSpritePixels, updateSprite } = projectStore;
      const offsetX = canvasWidth / 2; const offsetY = canvasHeight / 2;
      const sorted = [...parts].sort((a, b) => 0);
      const selectedPixels: { x: number; y: number; color: string; spriteId: string; localX: number; localY: number }[] = [];
      // sprite_edit 下 mask 存的是编辑精灵局部坐标，先映回画布坐标，后续沿用画布坐标流程
      //（canvasToPartLocal 本身已是 sprite_edit 感知的，映回后能正确解回局部坐标）
      let maskKeys: Set<string> = mask;
      if (editMode === 'sprite_edit' && selectedPart) {
        const offX = Math.floor((canvasWidth - selectedPart.width) / 2);
        const offY = Math.floor((canvasHeight - selectedPart.height) / 2);
        const translated = new Set<string>();
        for (const key of mask) {
          const [lx, ly] = key.split(',').map(Number);
          translated.add(`${lx + offX},${ly + offY}`);
        }
        maskKeys = translated;
      }
      for (const key of maskKeys) {
        const [pxStr, pyStr] = key.split(',');
        const px = parseInt(pxStr, 10); const py = parseInt(pyStr, 10);
        for (const part of sorted) {
          const local = canvasToPartLocal(px, py, part);
          if (local && part.data[local.ly]?.[local.lx] !== null) {
            selectedPixels.push({ x: px, y: py, color: part.data[local.ly][local.lx]!, spriteId: part.id!, localX: local.lx, localY: local.ly });
            break;
          }
        }
      }
      if (selectedPixels.length === 0) { mask.clear(); return; }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const px of selectedPixels) { minX = Math.min(minX, px.x); minY = Math.min(minY, px.y); maxX = Math.max(maxX, px.x); maxY = Math.max(maxY, px.y); }
      const partW = maxX - minX + 1; const partH = maxY - minY + 1;
      const colorMap = new Map<string, string>();
      for (const px of selectedPixels) colorMap.set(`${px.x},${px.y}`, px.color);
      const pixels = createEmptyPixelGrid(partW, partH) as PixelColor[][];
      let sumX = 0, sumY = 0, count = 0;
      for (let y = 0; y < partH; y++) for (let x = 0; x < partW; x++) {
        const color = colorMap.get(`${minX + x},${minY + y}`);
        if (color) { pixels[y][x] = color; sumX += x; sumY += y; count++; }
      }
      if (count === 0) { mask.clear(); return; }
      const pivotX = Math.round(sumX / count); const pivotY = Math.round(sumY / count);
      // addSprite 默认 plug 为中心（px）；原 pivot 算式里 newPart.pivotX 即此默认值
      const defPivotX = Math.floor(partW / 2); const defPivotY = Math.floor(partH / 2);
      const newSprite = addSprite(partName || '选区', partW, partH, {
        plugX: pivotX + (minX - Math.floor(canvasWidth / 2) + defPivotX - (defPivotX - pivotX)),
        plugY: pivotY + (minY - Math.floor(canvasHeight / 2) + defPivotY - (defPivotY - pivotY)),
      });
      setSpritePixels(newSprite.id!, pixels);
      editorStore.getState().selectPart(newSprite.id!);

      if (mode !== 'keep') {
        const partPixels = new Map<string, { part: Sprite; locals: Set<string> }>();
        for (const sp of selectedPixels) {
          if (!partPixels.has(sp.spriteId)) { const part = parts.find(p => p.id === sp.spriteId)!; partPixels.set(sp.spriteId, { part, locals: new Set() }); }
          partPixels.get(sp.spriteId)!.locals.add(`${sp.localX},${sp.localY}`);
        }
        for (const [spriteId, { part, locals }] of partPixels) {
          const newPixels: PixelGrid = part.data.map(row => [...row]);
          if (mode === 'transparent') { for (const key of locals) { const [lx, ly] = key.split(',').map(Number); if (ly >= 0 && ly < part.height && lx >= 0 && lx < part.width) newPixels[ly][lx] = null; } setSpritePixels(spriteId, newPixels); }
          else if (mode === 'fill') { for (const key of locals) { const [lx, ly] = key.split(',').map(Number); if (ly >= 0 && ly < part.height && lx >= 0 && lx < part.width) newPixels[ly][lx] = fillColor; } setSpritePixels(spriteId, newPixels); }
          else if (mode === 'inpaint') { const inpainted = inpaintPixels(newPixels, locals, 3); setSpritePixels(spriteId, inpainted); }
        }
      }
    });
  }, [parts, canvasWidth, canvasHeight, canvasToPartLocal, editorStore, editMode, selectedPart]);

  // ---- Onion data version bump effect ----
  useEffect(() => {
    onionDataVersionRef.current++;
    invalidateUnifiedPipelineCache();
    dirtyRef.current = true;
  }, [parts, keyframes, backgroundColor, onionSkinEnabled, onionSkinFrames, trajectories, motionBlurStrokes, effectStrokes, effectTracks, skeletons, proceduralAnimations, canvasModifierTracks, frameRate, animationVariables, spriteEditModifiers, unifiedCharacters]);

  // ---- Container size / canvas dimension effects ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerSize.w * dpr;
    canvas.height = containerSize.h * dpr;
    canvas.style.width = `${containerSize.w}px`;
    canvas.style.height = `${containerSize.h}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);
  }, [containerSize]);

  useEffect(() => {
    if (containerSize.w === 0 || containerSize.h === 0) return;
    const centerPanX = (containerSize.w - canvasWidth * zoom) / 2;
    const centerPanY = (containerSize.h - canvasHeight * zoom) / 2;
    setPan(centerPanX, centerPanY);
  }, [containerSize.w, containerSize.h, canvasWidth, canvasHeight, zoom, setPan]);

  return {
    // Refs
    containerRef, canvasRef, offscreenRef, refImageRef, rafRef, dirtyRef, markDirty,
    onionCacheRef, onionDataVersionRef, onionOverlayRef,
    isPanningRef, isDrawingRef, lastPixelRef, panStartRef, moveStartRef,
    spaceHeldRef, altToggleBackupRef, lastDrawnPixelsRef,
    currentStrokePointsRef, cropStartRef, cropRectRef,
    trajectoryPathRef, handDrawTrajectoryRef, trajectoryCpDragRef,
    selectionMaskRef, lassoPathRef, selectionMarchOffsetRef,
    boneDragRef, puppetNodeDragRef, pixelEditCommandRef, spriteEditBrushCmdRef,
    // State
    fpsFramesRef, fpsLastTimeRef, fpsDisplay, setFpsDisplay,
    currentFrameRef, playStateRef, zoomRef, panRef,
    // Store values
    parts, keyframes, canvasWidth, canvasHeight, backgroundColor,
    onionSkinEnabled, onionSkinFrames, trajectories, motionBlurStrokes, effectStrokes,
    effectTracks, skeletons, proceduralAnimations, canvasModifierTracks,
    setPartPixels, setCorrection, frameRate, setCanvasSize, animationVariables,
    globalModifiers,
    nonPuppetParts, unifiedCharacters,
    // Editor
    tool, brushSize, brushColor, zoom, panX, panY, showGrid, showTrajectories,
    editMode, selectedSpriteId, setZoom, setPan,
    autoMotionBlur, autoMotionBlurIntensity, motionBlurBrushType, motionBlurIntensity, motionBlurDirection,
    effectBrushColor, effectBrushRadius, effectBrushIntensity, effectBrushDensity, effectBrushSpread, strokeBlendMode,
    showSkeletons, selectedBoneId, activeSkeletonId, showWeightPaint, weightPaintBoneId,
    showPuppetSkeleton, activePuppetSkeletonId, selectedNodeId,
    referenceImageUrl, referenceImageOpacity, referenceImageVisible, maskNodeId,
    refWizardOpen,
    magicWandTolerance, trajectorySnap, spriteEditSpriteId, spriteEditModifiers,
    brushStyle, brushStyleParams, compositingMode, styleAspects, strokeDrivers, editorStore,
    // Derived
    selectedPart,
    // Helpers
    getFullTranslateOffset, getInterpolatedTranslateOffset, getInterpolatedModifiers,
    screenToPixel, canvasToPartLocal, findPartAtPixel,
    applyBrush, applyFill, applyEyedropper,
    findBoneAtPixel, computePivotWorldPosition, findPuppetNodeAtPixel,
    findTrajectoryCpAtPixel, applyWeightPaint, extractSelectionAsPart,
    // Canvas size
    canvasSizeEditing, setCanvasSizeEditing, canvasSizeW, setCanvasSizeW, canvasSizeH, setCanvasSizeH, applyCanvasSize,
    // Container
    containerSize,
  };
}

export type CanvasState = ReturnType<typeof useCanvasState>;
