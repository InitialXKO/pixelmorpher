/**
 * use-canvas-state.ts — Custom hook for PixelCanvas state, refs, and helper functions.
 * Encapsulates all Zustand store subscriptions, refs, derived state, and
 * coordinate/drawing helper callbacks.
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useProjectStore } from '@/lib/store';
import { useEditorStore } from '@/lib/store';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { useTileWorkflowStore } from '@/lib/tile-workflow-store';
import { invalidateUnifiedPipelineCache } from '@/lib/unified-pipeline-bridge';
import { computePuppetSpritePartIds } from '@/lib/unified-pipeline-bridge';
import {
  interpolateModifiers,
  computeKeyframeBaseTransform,
  computePartAnimationTransform,
  combineTransformsComponentLevel,
  floodFill,
} from '@/lib/engine';
import { generateBrushStamp, applyBrushStamp } from '@/lib/brush-engine';
import { inpaintPixels } from '@/lib/inpainting';
import { catmullRomToBezier, isPixelInPart, getPixelAt, computeSpriteEndPoint } from './canvas-utils';
import type { PixelColor, PixelGrid, Part, Bone, PuppetNode, PuppetSkeleton, PuppetCharacter, PuppetNodeKeyframe, BrushCommand, ModifierInstance } from '@/lib/types';
import { createEmptyPixelGrid } from '@/lib/types';
import { resolvePuppetNodeSprite } from '@/lib/engine/puppet-render';

export function useCanvasState() {
  // ---- Refs ----
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
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
    partId: string; segmentIdx: number; cp: 'cp1' | 'cp2';
    startX: number; startY: number; origCp1x: number; origCp1y: number; origCp2x: number; origCp2y: number;
  } | null>(null);
  const selectionMaskRef = useRef<Set<string>>(new Set());
  const lassoPathRef = useRef<{ x: number; y: number }[]>([]);
  const selectionMarchOffsetRef = useRef<number>(0);
  const boneDragRef = useRef<{ boneId: string; skeletonId: string; endpoint: 'head' | 'tail' | 'ik_target'; startX: number; startY: number; origHeadX: number; origHeadY: number; origTailX: number; origTailY: number; origTargetX: number; origTargetY: number } | null>(null);
  const puppetNodeDragRef = useRef<{
    nodeId: string; skeletonId: string; characterId: string; clipId: string;
    startX: number; startY: number; origAngle: number; origOffsetX: number; origOffsetY: number;
    mode: 'rotate' | 'move'; pivotWorldX: number; pivotWorldY: number; startMouseAngle: number;
    dragStarted: boolean; moveTargetNodeId?: string;
  } | null>(null);
  const pixelEditCommandRef = useRef<{ commandId: string; modifierId: string; keyframeId: string; points: { x: number; y: number }[] } | null>(null);
  const partEditBrushCmdRef = useRef<{ commandId: string; modifierId: string; points: { x: number; y: number }[] } | null>(null);

  // ---- Dev FPS counter ----
  const [fpsDisplay, setFpsDisplay] = useState('');

  // ---- Store (ref-based for performance) ----
  const currentFrameRef = useRef(useProjectStore.getState().currentFrame);
  const playStateRef = useRef(useEditorStore.getState().playState);
  const zoomRef = useRef(useEditorStore.getState().zoom);
  const panRef = useRef({ x: useEditorStore.getState().panX, y: useEditorStore.getState().panY });

  // ---- Store (reactive selectors) ----
  const parts = useProjectStore((s) => s.parts);
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
  const setPartPixels = useProjectStore((s) => s.setPartPixels);
  const setCorrection = useProjectStore((s) => s.setCorrection);
  const frameRate = useProjectStore((s) => s.frameRate);
  const setCanvasSize = useProjectStore((s) => s.setCanvasSize);
  const animationVariables = useProjectStore((s) => s.animationVariables);
  const globalModifiers = useProjectStore((s) => s.globalModifiers);
  const puppetSkeletons = useProjectStore((s) => s.puppetSkeletons);
  const puppetCharacters = useProjectStore((s) => s.puppetCharacters);

  // Puppet sprite part filtering
  const puppetSpritePartIds = useMemo(
    () => computePuppetSpritePartIds(puppetSkeletons, puppetCharacters),
    [puppetSkeletons, puppetCharacters],
  );
  const nonPuppetParts = useMemo(() => {
    if (puppetSpritePartIds.size === 0) return parts;
    return parts.filter(p => !puppetSpritePartIds.has(p.id));
  }, [parts, puppetSpritePartIds]);

  const puppetClipsVersion = useProjectStore((s) => {
    const clips = s.animationClips;
    let v = 0;
    for (const c of clips) {
      if (c.isPuppetClip && c.puppetNodeKeyframes) {
        for (const kf of c.puppetNodeKeyframes) {
          v = v * 31 + kf.frame * 7 + Math.round((kf.angle ?? 0) * 10) +
              Math.round((kf.offsetX ?? 0) * 10) + Math.round((kf.offsetY ?? 0) * 10) +
              Math.round((kf.stretch ?? 1) * 100);
        }
      }
    }
    return v;
  });

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
    const unsub3 = useTileWorkflowStore.subscribe(() => {
      if (useWorkspaceStore.getState().mode === 'map_tile') dirtyRef.current = true;
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  // ---- Tile / puppet mode state ----
  const { mode: workspaceMode } = useWorkspaceStore();
  const tileStore = useTileWorkflowStore;
  const tileEditingTarget = useTileWorkflowStore((s) => s.editingTarget);
  const isTileMode = workspaceMode === 'map_tile';
  const isPuppetMode = workspaceMode === 'puppet';

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
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
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
  const showSkeletons = useEditorStore((s) => s.showSkeletons);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const activeSkeletonId = useEditorStore((s) => s.activeSkeletonId);
  const showWeightPaint = useEditorStore((s) => s.showWeightPaint);
  const weightPaintBoneId = useEditorStore((s) => s.weightPaintBoneId);
  const weightPaintRadius = useEditorStore((s) => s.weightPaintRadius);
  const showPuppetSkeleton = useEditorStore((s) => s.showPuppetSkeleton);
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const selectedPuppetNodeId = useProjectStore((s) => s.selectedPuppetNodeId);
  const magicWandTolerance = useEditorStore((s) => s.magicWandTolerance);
  const trajectorySnap = useEditorStore((s) => s.trajectorySnap);
  const partEditPartId = useEditorStore((s) => s.partEditPartId);
  const partEditModifiers = useEditorStore((s) => s.partEditModifiers);
  const brushStyle = useEditorStore((s) => s.brushStyle);
  const brushStyleParams = useEditorStore((s) => s.brushStyleParams);
  const compositingMode = useEditorStore((s) => s.compositingMode);
  const styleAspects = useEditorStore((s) => s.styleAspects);
  const strokeDrivers = useEditorStore((s) => s.strokeDrivers);
  const editorStore = useEditorStore;

  // ---- Derived ----
  const selectedPart = parts.find((p) => p.id === selectedPartId) ?? null;

  // ---- Helper: get full translate offset ----
  const getFullTranslateOffset = useCallback(
    (partId: string, frame: number): { offsetX: number; offsetY: number } => {
      const store = useProjectStore.getState();
      const { getSurroundingKeyframes: getSurrounding } = store;
      const { prev } = getSurrounding(partId, frame);
      const part = store.parts.find(p => p.id === partId);
      if (!part) return { offsetX: 0, offsetY: 0 };

      const keyframe = prev;
      const allModifiers = keyframe && !keyframe.isBaked ? keyframe.modifiers : [];
      const modifiers = allModifiers.filter(m => !m.collapsed);
      const kfBase = computeKeyframeBaseTransform(modifiers);
      const animTransform = computePartAnimationTransform(part.animationModifiers || [], frame, store.frameRate);
      const combined = combineTransformsComponentLevel(kfBase, animTransform, animTransform.blendMode, animTransform.convergeFactor);

      let partGlobalOffsetX = 0;
      let partGlobalOffsetY = 0;
      if (part.globalModifiers) {
        for (const mod of part.globalModifiers) {
          if (mod.enabled && mod.type === 'translate') {
            partGlobalOffsetX += Number(mod.params.offsetX) || 0;
            partGlobalOffsetY += Number(mod.params.offsetY) || 0;
          }
        }
      }
      return { offsetX: combined.translateX + partGlobalOffsetX, offsetY: combined.translateY + partGlobalOffsetY };
    }, [],
  );
  const getInterpolatedTranslateOffset = getFullTranslateOffset;

  // ---- Helper: get interpolated modifiers ----
  const getInterpolatedModifiers = useCallback(
    (partId: string, frame: number) => {
      const { getSurroundingKeyframes: getSurrounding } = useProjectStore.getState();
      const { prev, next, t } = getSurrounding(partId, frame);
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
    (px: number, py: number, part: Part, translateOffsetX: number = 0, translateOffsetY: number = 0): { lx: number; ly: number } | null => {
      if (editMode === 'part_edit' && partEditPartId === part.id) {
        const offsetX = Math.floor((canvasWidth - part.width) / 2);
        const offsetY = Math.floor((canvasHeight - part.height) / 2);
        const localX = px - offsetX;
        const localY = py - offsetY;
        if (localX < 0 || localX >= part.width || localY < 0 || localY >= part.height) return null;
        return { lx: localX, ly: localY };
      }
      const offsetX = canvasWidth / 2;
      const offsetY = canvasHeight / 2;
      const localX = px - (offsetX - part.pivotX + (part.offsetX || 0) + translateOffsetX);
      const localY = py - (offsetY - part.pivotY + (part.offsetY || 0) + translateOffsetY);
      if (localX < 0 || localX >= part.width || localY < 0 || localY >= part.height) return null;
      return { lx: localX, ly: localY };
    }, [canvasWidth, canvasHeight, editMode, partEditPartId],
  );

  // ---- Find topmost part at pixel position ----
  const findPartAtPixel = useCallback(
    (px: number, py: number): Part | null => {
      const offsetX = canvasWidth / 2;
      const offsetY = canvasHeight / 2;
      const frame = useProjectStore.getState().currentFrame;
      const sorted = [...parts].filter((p) => p.visible).sort((a, b) => b.zIndex - a.zIndex);
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
      const { offsetX: txOff, offsetY: tyOff } = getInterpolatedTranslateOffset(selectedPart.id, currentFrame);
      const local = canvasToPartLocal(px, py, selectedPart, txOff, tyOff);
      if (!local) return;

      const store = useProjectStore.getState();
      const currentKf = store.keyframes.find(k => k.partId === selectedPart.id && k.frame === currentFrame);
      const basePixels = currentKf?.correctionMask ?? selectedPart.pixels;
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
      else setPartPixels(selectedPart.id, newPixels);
    }, [selectedPart, brushSize, brushStyle, brushStyleParams, canvasToPartLocal, setPartPixels, setCorrection, getInterpolatedTranslateOffset, canvasWidth, canvasHeight],
  );

  const applyFill = useCallback(
    (px: number, py: number) => {
      const currentFrame = currentFrameRef.current;
      if (!selectedPart) return;
      const { offsetX: txOff, offsetY: tyOff } = getInterpolatedTranslateOffset(selectedPart.id, currentFrame);
      const local = canvasToPartLocal(px, py, selectedPart, txOff, tyOff);
      if (!local) return;

      const store = useProjectStore.getState();
      const currentKf = store.keyframes.find(k => k.partId === selectedPart.id && k.frame === currentFrame);
      const basePixels = currentKf?.correctionMask ?? selectedPart.pixels;
      const filled = floodFill(basePixels, local.lx, local.ly, brushColor);
      if (currentKf?.correctionMask) store.setCorrection(currentKf.id, filled);
      else setPartPixels(selectedPart.id, filled);
    }, [selectedPart, brushColor, canvasToPartLocal, setPartPixels, setCorrection, getInterpolatedTranslateOffset, canvasWidth, canvasHeight],
  );

  const applyEyedropper = useCallback(
    (px: number, py: number) => {
      const offsetX = canvasWidth / 2;
      const offsetY = canvasHeight / 2;
      const frame = useProjectStore.getState().currentFrame;
      const sorted = [...parts].filter((p) => p.visible).sort((a, b) => b.zIndex - a.zIndex);
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
  const computePivotWorldPosition = useCallback(
    (node: PuppetNode, skeleton: PuppetSkeleton, canvasW: number, canvasH: number): { x: number; y: number } => {
      const state = useProjectStore.getState();
      const clip = state.animationClips.find(c => c.isPuppetClip && c.puppetCharacterId === state.puppetCharacters.find(ch => ch.puppetSkeletonId === skeleton.id)?.id);
      const keyframes = clip?.puppetNodeKeyframes ?? [];
      const kfByNode = new Map<string, PuppetNodeKeyframe[]>();
      for (const kf of keyframes) { const arr = kfByNode.get(kf.nodeId) || []; arr.push(kf); kfByNode.set(kf.nodeId, arr); }

      const centerX = canvasW / 2;
      const centerY = canvasH / 2;
      const currentFrame = state.currentFrame;

      const parentMap = new Map<string, { parentId: string; socketId: string }>();
      for (const n of skeleton.nodes) {
        if (n.plug) {
          const parentNode = skeleton.nodes.find(pn => pn.sockets.some(s => s.id === n.plug!.socketId));
          if (parentNode) parentMap.set(n.id, { parentId: parentNode.id, socketId: n.plug.socketId });
        }
      }

      const worldPositions = new Map<string, { x: number; y: number; angle: number }>();
      function computeNodeWorldPos(nodeId: string, parentWorldX: number, parentWorldY: number, parentWorldAngle: number): { x: number; y: number; angle: number } {
        const n = skeleton.nodes.find(nn => nn.id === nodeId);
        if (!n) return { x: parentWorldX, y: parentWorldY, angle: 0 };
        let angle = n.angle, offsetX = n.offsetX, offsetY = n.offsetY;
        const nodeKfs = kfByNode.get(n.id) || [];
        if (nodeKfs.length > 0) {
          const sorted = [...nodeKfs].sort((a, b) => a.frame - b.frame);
          let prevKf: PuppetNodeKeyframe | null = null;
          for (const kf of sorted) { if (kf.frame <= currentFrame) prevKf = kf; }
          if (prevKf) { angle = prevKf.angle ?? n.angle; offsetX = prevKf.offsetX ?? n.offsetX; offsetY = prevKf.offsetY ?? n.offsetY; }
        }
        let worldX: number, worldY: number;
        if (!n.plug) { worldX = Math.round(centerX + offsetX); worldY = Math.round(centerY + offsetY); }
        else {
          const parentInfo = parentMap.get(n.id);
          if (parentInfo) {
            const parentPos = worldPositions.get(parentInfo.parentId);
            if (parentPos) {
              const parentNode = skeleton.nodes.find(nn => nn.id === parentInfo.parentId);
              const socket = parentNode?.sockets.find(s => s.id === parentInfo.socketId);
              if (socket && parentNode) {
                const parentAngleRad = (parentPos.angle * Math.PI) / 180;
                const cosA = Math.cos(parentAngleRad); const sinA = Math.sin(parentAngleRad);
                worldX = Math.round(parentPos.x + (socket.localX * cosA - socket.localY * sinA) + offsetX);
                worldY = Math.round(parentPos.y + (socket.localX * sinA + socket.localY * cosA) + offsetY);
              } else { worldX = Math.round(parentPos.x + offsetX); worldY = Math.round(parentPos.y + offsetY); }
            } else { worldX = Math.round(centerX + offsetX); worldY = Math.round(centerY + offsetY); }
          } else { worldX = Math.round(centerX + offsetX); worldY = Math.round(centerY + offsetY); }
        }
        const worldAngle = parentWorldAngle + angle;
        const pos = { x: worldX, y: worldY, angle: worldAngle };
        worldPositions.set(n.id, pos);
        for (const childInfo of skeleton.nodes.filter(nn => nn.plug && parentMap.get(nn.id)?.parentId === n.id)) computeNodeWorldPos(childInfo.id, worldX, worldY, worldAngle);
        return pos;
      }
      for (const n of skeleton.nodes) { if (!n.plug) computeNodeWorldPos(n.id, centerX, centerY, 0); }
      const nodePos = worldPositions.get(node.id);
      return nodePos ? { x: nodePos.x, y: nodePos.y } : { x: centerX, y: centerY };
    }, [],
  );

  // ---- Puppet node hit-testing ----
  const findPuppetNodeAtPixel = useCallback(
    (px: number, py: number): { node: PuppetNode; skeleton: PuppetSkeleton; character: PuppetCharacter; clipId: string | null } | null => {
      const hitRadius = Math.max(20 / zoom, 8);
      const state = useProjectStore.getState();
      const skeletons = state.puppetSkeletons;
      const characters = state.puppetCharacters;
      const clips = state.animationClips;
      const partsById = new Map(state.parts.map(p => [p.id, p]));
      let bestHit: { node: PuppetNode; skeleton: PuppetSkeleton; character: PuppetCharacter; clipId: string | null; score: number } | null = null;

      for (const character of characters) {
        const skeleton = skeletons.find(s => s.id === character.puppetSkeletonId);
        if (!skeleton) continue;
        const skel = skeleton;
        const clip = clips.find(c => c.isPuppetClip && c.puppetCharacterId === character.id);
        const keyframes = clip?.puppetNodeKeyframes ?? [];
        const worldPositions = new Map<string, { x: number; y: number; angle: number }>();
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;

        const parentMap = new Map<string, { parentId: string; socketId: string }>();
        for (const node of skel.nodes) {
          if (node.plug) { const parentNode = skel.nodes.find(n => n.sockets.some(s => s.id === node.plug!.socketId)); if (parentNode) parentMap.set(node.id, { parentId: parentNode.id, socketId: node.plug.socketId }); }
        }
        const kfByNode = new Map<string, PuppetNodeKeyframe[]>();
        for (const kf of keyframes) { const arr = kfByNode.get(kf.nodeId) || []; arr.push(kf); kfByNode.set(kf.nodeId, arr); }

        function computeNodeWorldPos(nodeId: string, parentWorldX: number, parentWorldY: number, parentWorldAngle: number): { x: number; y: number; angle: number } {
          const node = skel.nodes.find(n => n.id === nodeId);
          if (!node) return { x: parentWorldX, y: parentWorldY, angle: 0 };
          const nodeKfs = kfByNode.get(node.id) || [];
          const currentFrame = state.currentFrame;
          let angle = node.angle, offsetX = node.offsetX, offsetY = node.offsetY;
          if (nodeKfs.length > 0) {
            const sorted = [...nodeKfs].sort((a, b) => a.frame - b.frame);
            let prevKf: PuppetNodeKeyframe | null = null, nextKf: PuppetNodeKeyframe | null = null;
            for (const kf of sorted) { if (kf.frame <= currentFrame) prevKf = kf; if (kf.frame > currentFrame && !nextKf) nextKf = kf; }
            if (prevKf) {
              angle = prevKf.angle ?? node.angle; offsetX = prevKf.offsetX ?? node.offsetX; offsetY = prevKf.offsetY ?? node.offsetY;
              if (nextKf && prevKf.frame !== nextKf.frame) {
                const t = (currentFrame - prevKf.frame) / (nextKf.frame - prevKf.frame);
                offsetX = (prevKf.offsetX ?? node.offsetX) + ((nextKf.offsetX ?? node.offsetX) - (prevKf.offsetX ?? node.offsetX)) * t;
                offsetY = (prevKf.offsetY ?? node.offsetY) + ((nextKf.offsetY ?? node.offsetY) - (prevKf.offsetY ?? node.offsetY)) * t;
              }
            }
          }
          let worldX: number, worldY: number;
          if (!node.plug) { worldX = Math.round(centerX + offsetX); worldY = Math.round(centerY + offsetY); }
          else {
            const parentInfo = parentMap.get(node.id);
            if (parentInfo) {
              const parentPos = worldPositions.get(parentInfo.parentId);
              if (parentPos) {
                const parentNode = skel.nodes.find(n => n.id === parentInfo.parentId);
                const socket = parentNode?.sockets.find(s => s.id === parentInfo.socketId);
                if (socket && parentNode) {
                  const parentAngleRad = (parentPos.angle * Math.PI) / 180;
                  const cosA = Math.cos(parentAngleRad); const sinA = Math.sin(parentAngleRad);
                  worldX = Math.round(parentPos.x + (socket.localX * cosA - socket.localY * sinA) + offsetX);
                  worldY = Math.round(parentPos.y + (socket.localX * sinA + socket.localY * cosA) + offsetY);
                } else { worldX = Math.round(parentPos.x + offsetX); worldY = Math.round(parentPos.y + offsetY); }
              } else { worldX = Math.round(centerX + offsetX); worldY = Math.round(centerY + offsetY); }
            } else { worldX = Math.round(centerX + offsetX); worldY = Math.round(centerY + offsetY); }
          }
          const worldAngle = parentWorldAngle + angle;
          worldPositions.set(node.id, { x: worldX, y: worldY, angle: worldAngle });
          for (const childInfo of skel.nodes.filter(n => n.plug && parentMap.get(n.id)?.parentId === node.id)) computeNodeWorldPos(childInfo.id, worldX, worldY, worldAngle);
          return { x: worldX, y: worldY, angle: worldAngle };
        }
        for (const node of skel.nodes) { if (!node.plug) computeNodeWorldPos(node.id, centerX, centerY, 0); }

        const activeCostumeSet = character.activeCostumeSetId ? character.costumeSets.find(cs => cs.id === character.activeCostumeSetId) : null;
        const direction = skel.currentDirection;

        for (const node of skel.nodes) {
          if (!node.visible) continue;
          const pos = worldPositions.get(node.id);
          if (!pos) continue;
          const part = resolvePuppetNodeSprite(node, direction, activeCostumeSet ?? null, state.parts);
          let endWorldX: number, endWorldY: number;
          if (part) {
            const endLocal = computeSpriteEndPoint(part.width, part.height, part.pivotX, part.pivotY);
            const rad = (pos.angle * Math.PI) / 180;
            endWorldX = pos.x + endLocal.x * Math.cos(rad) - endLocal.y * Math.sin(rad);
            endWorldY = pos.y + endLocal.x * Math.sin(rad) + endLocal.y * Math.cos(rad);
          } else { endWorldX = pos.x; endWorldY = pos.y; }

          let score: number;
          if (!node.plug) {
            score = Math.min(Math.sqrt((px - endWorldX) ** 2 + (py - endWorldY) ** 2), Math.sqrt((px - pos.x) ** 2 + (py - pos.y) ** 2));
          } else {
            const distToEnd = Math.sqrt((px - endWorldX) ** 2 + (py - endWorldY) ** 2);
            const midX = (pos.x + endWorldX) / 2; const midY = (pos.y + endWorldY) / 2;
            score = Math.min(distToEnd * 0.7, Math.sqrt((px - midX) ** 2 + (py - midY) ** 2));
          }
          const spriteExtent = part ? Math.max(part.width, part.height) / 2 : 5;
          const maxDist = hitRadius + spriteExtent;
          if (score <= maxDist && (!bestHit || score < bestHit.score)) {
            bestHit = { node, skeleton: skel, character, clipId: clip?.id ?? null, score };
          }
        }
      }
      return bestHit ? { node: bestHit.node, skeleton: bestHit.skeleton, character: bestHit.character, clipId: bestHit.clipId } : null;
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
        if (traj.partId !== selectedPartId) continue;
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
            return { partId: traj.partId, segmentIdx: i, cp: 'cp1' as const, cp1x: curvePt?.cp1x ?? 0, cp1y: curvePt?.cp1y ?? 0, cp2x: nextCurvePt?.cp2x ?? 0, cp2y: nextCurvePt?.cp2y ?? 0 };
          }
          if (Math.sqrt((px * zoom + panX - cp2x) ** 2 + (py * zoom + panY - cp2y) ** 2) <= hitRadius) {
            return { partId: traj.partId, segmentIdx: i, cp: 'cp2' as const, cp1x: curvePt?.cp1x ?? 0, cp1y: curvePt?.cp1y ?? 0, cp2x: nextCurvePt?.cp2x ?? 0, cp2y: nextCurvePt?.cp2y ?? 0 };
          }
        }
      }
      return null;
    }, [trajectories, selectedPartId, canvasWidth, canvasHeight, zoom, panX, panY],
  );

  // ---- Apply weight paint ----
  const applyWeightPaint = useCallback(
    (px: number, py: number) => {
      if (!weightPaintBoneId) return;
      const hitPart = findPartAtPixel(px, py);
      if (!hitPart) return;
      for (const skeleton of skeletons) {
        const bone = skeleton.bones.find(b => b.id === weightPaintBoneId);
        if (bone) { useProjectStore.getState().bindPartToBone(skeleton.id, weightPaintBoneId, hitPart.id, 1.0); break; }
      }
    }, [weightPaintBoneId, findPartAtPixel, skeletons],
  );

  // ---- Extract selection pixels as a new part ----
  const extractSelectionAsPart = useCallback((mode: 'keep' | 'transparent' | 'fill' | 'inpaint' = 'keep', fillColor: string = '#000000', partName: string = '选区') => {
    const mask = selectionMaskRef.current;
    if (mask.size === 0) return;
    const projectStore = useProjectStore.getState();
    projectStore.performBatch('提取选区', () => {
      const { addPart, setPartPixels, updatePart } = projectStore;
      const offsetX = canvasWidth / 2; const offsetY = canvasHeight / 2;
      const sorted = [...parts].filter((p) => p.visible).sort((a, b) => b.zIndex - a.zIndex);
      const selectedPixels: { x: number; y: number; color: string; partId: string; localX: number; localY: number }[] = [];
      for (const key of mask) {
        const [pxStr, pyStr] = key.split(',');
        const px = parseInt(pxStr, 10); const py = parseInt(pyStr, 10);
        for (const part of sorted) {
          const local = canvasToPartLocal(px, py, part);
          if (local && part.pixels[local.ly]?.[local.lx] !== null) {
            selectedPixels.push({ x: px, y: py, color: part.pixels[local.ly][local.lx]!, partId: part.id, localX: local.lx, localY: local.ly });
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
      const newPart = addPart(partName || '选区', partW, partH);
      updatePart(newPart.id, { pivotX: pivotX + (minX - Math.floor(canvasWidth / 2) + newPart.pivotX - (newPart.pivotX - pivotX)), pivotY: pivotY + (minY - Math.floor(canvasHeight / 2) + newPart.pivotY - (newPart.pivotY - pivotY)) });
      setPartPixels(newPart.id, pixels);
      editorStore.getState().selectPart(newPart.id);

      if (mode !== 'keep') {
        const partPixels = new Map<string, { part: Part; locals: Set<string> }>();
        for (const sp of selectedPixels) {
          if (!partPixels.has(sp.partId)) { const part = parts.find(p => p.id === sp.partId)!; partPixels.set(sp.partId, { part, locals: new Set() }); }
          partPixels.get(sp.partId)!.locals.add(`${sp.localX},${sp.localY}`);
        }
        for (const [partId, { part, locals }] of partPixels) {
          const newPixels: PixelGrid = part.pixels.map(row => [...row]);
          if (mode === 'transparent') { for (const key of locals) { const [lx, ly] = key.split(',').map(Number); if (ly >= 0 && ly < part.height && lx >= 0 && lx < part.width) newPixels[ly][lx] = null; } setPartPixels(partId, newPixels); }
          else if (mode === 'fill') { for (const key of locals) { const [lx, ly] = key.split(',').map(Number); if (ly >= 0 && ly < part.height && lx >= 0 && lx < part.width) newPixels[ly][lx] = fillColor; } setPartPixels(partId, newPixels); }
          else if (mode === 'inpaint') { const inpainted = inpaintPixels(newPixels, locals, 3); setPartPixels(partId, inpainted); }
        }
      }
    });
  }, [parts, canvasWidth, canvasHeight, canvasToPartLocal, editorStore]);

  // ---- Onion data version bump effect ----
  useEffect(() => {
    onionDataVersionRef.current++;
    invalidateUnifiedPipelineCache();
    dirtyRef.current = true;
  }, [parts, keyframes, backgroundColor, onionSkinEnabled, onionSkinFrames, trajectories, motionBlurStrokes, effectStrokes, effectTracks, skeletons, proceduralAnimations, canvasModifierTracks, frameRate, animationVariables, partEditModifiers, puppetSkeletons, puppetCharacters, puppetClipsVersion]);

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
    containerRef, canvasRef, offscreenRef, rafRef, dirtyRef, markDirty,
    onionCacheRef, onionDataVersionRef, onionOverlayRef,
    isPanningRef, isDrawingRef, lastPixelRef, panStartRef, moveStartRef,
    spaceHeldRef, altToggleBackupRef, lastDrawnPixelsRef,
    currentStrokePointsRef, cropStartRef, cropRectRef,
    trajectoryPathRef, handDrawTrajectoryRef, trajectoryCpDragRef,
    selectionMaskRef, lassoPathRef, selectionMarchOffsetRef,
    boneDragRef, puppetNodeDragRef, pixelEditCommandRef, partEditBrushCmdRef,
    // State
    fpsFramesRef, fpsLastTimeRef, fpsDisplay, setFpsDisplay,
    currentFrameRef, playStateRef, zoomRef, panRef,
    // Store values
    parts, keyframes, canvasWidth, canvasHeight, backgroundColor,
    onionSkinEnabled, onionSkinFrames, trajectories, motionBlurStrokes, effectStrokes,
    effectTracks, skeletons, proceduralAnimations, canvasModifierTracks,
    setPartPixels, setCorrection, frameRate, setCanvasSize, animationVariables,
    globalModifiers, puppetSkeletons, puppetCharacters, puppetSpritePartIds,
    nonPuppetParts, puppetClipsVersion,
    // Tile/puppet
    workspaceMode, tileStore, tileEditingTarget, isTileMode, isPuppetMode,
    // Editor
    tool, brushSize, brushColor, zoom, panX, panY, showGrid, showTrajectories,
    editMode, selectedPartId, setZoom, setPan,
    autoMotionBlur, autoMotionBlurIntensity, motionBlurBrushType, motionBlurIntensity, motionBlurDirection,
    effectBrushColor, effectBrushRadius, effectBrushIntensity, effectBrushDensity, effectBrushSpread,
    showSkeletons, selectedBoneId, activeSkeletonId, showWeightPaint, weightPaintBoneId, weightPaintRadius,
    showPuppetSkeleton, activePuppetSkeletonId, selectedPuppetNodeId,
    magicWandTolerance, trajectorySnap, partEditPartId, partEditModifiers,
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
