/**
 * use-canvas-state.ts — Custom hook for PixelCanvas state, refs, and helper functions.
 * Encapsulates all Zustand store subscriptions, refs, derived state, and
 * coordinate/drawing helper callbacks.
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useProjectStore } from '@/lib/store';
import { useEditorStore } from '@/lib/store';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { invalidateUnifiedPipelineCache, geometryDirectionFromToggle } from '@/lib/unified-render';
import { computeEditorWorldTransforms } from '@/lib/editor-world-transforms';
import { pickNodesAt } from '@/lib/node-picking';
import { readPick } from '@/lib/pick-buffer';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import { visibleCharactersRecord } from '@/lib/visible-characters';
import {
  interpolateModifiers,
  computeKeyframeBaseTransform,
  computePartAnimationTransform,
  combineTransformsComponentLevel,
  floodFill,
} from '@/lib/engine';
import { generateBrushStamp, applyBrushStamp } from '@/lib/brush-engine';
import { inpaintPixels } from '@/lib/inpainting';
import { isPixelInPart, getPixelAt, computeSpriteEndPoint, spritePivotX, spritePivotY } from './canvas-utils';
import type { PixelColor, PixelGrid, PuppetNode, PuppetSkeleton, PuppetCharacter, PuppetNodeKeyframe, BrushCommand, ModifierInstance } from '@/lib/types';
import type { Node, Character, Sprite } from '@/lib/unified-types';
import { pxToSub, subToPx, projectToView } from '@/lib/unified-types';
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
  // 中键按下点（client 坐标）：抬起时位移小于阈值 = 中键点击（循环命中），否则是中键拖动平移
  const middleClickRef = useRef<{ x: number; y: number } | null>(null);
  // 左键按下信息：供「锁定中空白单击解锁」判定（按下点是否命中节点 + 客户位移）
  const leftPressRef = useRef<{ clientX: number; clientY: number; hitNode: boolean } | null>(null);
  const moveStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number; targetLevel: 'keyframe' | 'part_global'; partGlobalOffsetX: number; partGlobalOffsetY: number } | null>(null);
  const spaceHeldRef = useRef(false);
  const altToggleBackupRef = useRef<'keyframe' | 'part_global' | null>(null);
  const lastDrawnPixelsRef = useRef<Set<string>>(new Set());

  const currentStrokePointsRef = useRef<{ x: number; y: number }[]>([]);
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);
  const cropRectRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const trajectoryPathRef = useRef<{ x: number; y: number }[]>([]);
  const selectionMaskRef = useRef<Set<string>>(new Set());
  const lassoPathRef = useRef<{ x: number; y: number }[]>([]);
  const selectionMarchOffsetRef = useRef<number>(0);
  const boneDragRef = useRef<{ boneId: string; skeletonId: string; endpoint: 'head' | 'tail' | 'ik_target'; startX: number; startY: number; origHeadX: number; origHeadY: number; origTailX: number; origTailY: number; origTargetX: number; origTargetY: number } | null>(null);
  const puppetNodeDragRef = useRef<{
    nodeId: string; skeletonId: string; characterId: string; clipId: string;
    startX: number; startY: number; origAngle: number; origStretch: number; origScaleX?: number; origOffsetX: number; origOffsetY: number; origOffsetZ?: number;
    mode: 'rotate' | 'move' | 'moveAll' | 'socket' | 'pivot'; pivotWorldX: number; pivotWorldY: number; startMouseAngle: number;
    dragStarted: boolean; moveTargetNodeId?: string; parentWorldAngle?: number; nodeWorldAngle?: number;
    // 伪3D工具专用：拖拽起始的出平面角（tracks.tilt 插值，含蓝图贡献）
    origTilt?: number;
    // socket 模式专用
    socketId?: string; parentNodeId?: string; origSocketX?: number; origSocketY?: number; parentAngle?: number;
    // pivot 模式专用
    pivotSpriteId?: string; origPivotX?: number; origPivotY?: number;
  } | null>(null);
  // 矫正模式进行中的笔画：目标节点 + 笔画起始帧的映射上下文（世界变换快照，
  // 与 node-picking 逆映射同口径）+ 已积累的精灵局部点列
  const pixelEditCommandRef = useRef<{
    commandId: string;
    characterId: string;
    nodeId: string;
    spriteId: string;
    sprite: import('@/lib/unified-types').Sprite;
    wt: { worldAngle: number; scaleX?: number; worldStretch: number; skewX?: number; skewY?: number; mirror: boolean };
    jointX: number;
    jointY: number;
    points: { x: number; y: number }[];
  } | null>(null);
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
  const canvasWidth = useProjectStore((s) => s.canvasWidth);
  const canvasHeight = useProjectStore((s) => s.canvasHeight);
  const backgroundColor = useProjectStore((s) => s.backgroundColor);
  const onionSkinEnabled = useProjectStore((s) => s.onionSkinEnabled);
  const onionSkinFrames = useProjectStore((s) => s.onionSkinFrames);
  const motionBlurStrokes = useProjectStore((s) => s.motionBlurStrokes);
  const effectStrokes = useProjectStore((s) => s.effectStrokes);
  const effectTracks = useProjectStore((s) => s.effectTracks);
  const proceduralAnimations = useProjectStore((s) => s.proceduralAnimations);
  const canvasModifierTracks = useProjectStore((s) => s.canvasModifierTracks);
  const setPartPixels = useProjectStore((s) => s.setSpritePixels);
  const frameRate = useProjectStore((s) => s.frameRate);
  const setCanvasSize = useProjectStore((s) => s.setCanvasSize);
  const animationVariables = useProjectStore((s) => s.animationVariables);
  const globalModifiers = useProjectStore((s) => s.globalModifiers);
  const globalBlueprint = useProjectStore((s) => s.globalBlueprint);
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
  const perspectiveForeshorten = useEditorStore((s) => s.perspectiveForeshorten);
  const showPuppetSkeleton = useEditorStore((s) => s.showPuppetSkeleton);
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const referenceImageUrl = useEditorStore((s) => s.referenceImageUrl);
  const referenceImageOpacity = useEditorStore((s) => s.referenceImageOpacity);
  const referenceImageVisible = useEditorStore((s) => s.referenceImageVisible);
  const maskNodeId = useEditorStore((s) => s.maskNodeId);
  const refWizardOpen = useEditorStore((s) => s.refWizardOpen);
  const magicWandTolerance = useEditorStore((s) => s.magicWandTolerance);
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
  // 旧工程关键帧退役后，独立精灵在画布上再无帧位移来源（part_global 层
  // 更早已删），偏移恒为 0；保留签名供旧部件几何助手（命中/取色）使用。
  const getFullTranslateOffset = useCallback(
    (_spriteId: string, _frame: number): { offsetX: number; offsetY: number } => ({ offsetX: 0, offsetY: 0 }),
    [],
  );
  const getInterpolatedTranslateOffset = getFullTranslateOffset;

  // ---- Helper: get interpolated modifiers ----
  // 同上：无关键帧即无逐帧修改器，恒空。
  const getInterpolatedModifiers = useCallback(
    (_spriteId: string, _frame: number): never[] => [],
    [],
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

      const basePixels = selectedPart.data;
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

      setPartPixels(selectedPart.id!, newPixels);
    }, [selectedPart, brushSize, brushStyle, brushStyleParams, canvasToPartLocal, setPartPixels, getInterpolatedTranslateOffset, canvasWidth, canvasHeight],
  );

  const applyFill = useCallback(
    (px: number, py: number) => {
      const currentFrame = currentFrameRef.current;
      if (!selectedPart) return;
      const { offsetX: txOff, offsetY: tyOff } = getInterpolatedTranslateOffset(selectedPart.id!, currentFrame);
      const local = canvasToPartLocal(px, py, selectedPart, txOff, tyOff);
      if (!local) return;

      const filled = floodFill(selectedPart.data, local.lx, local.ly, brushColor);
      setPartPixels(selectedPart.id!, filled);
    }, [selectedPart, brushColor, canvasToPartLocal, setPartPixels, getInterpolatedTranslateOffset, canvasWidth, canvasHeight],
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

  // ---- Compute puppet node world pivot position ----
  // 单位统一：内部全 SubPixel，返回画布像素（调用方按像素用）
  // 经共用 helper 按主画布同一上下文构造世界变换（与绘制、命中同源，
  // 钳制/模拟/程序化增量齐全，审计 F-20）；此前私有 2D 计算不认 offset3D，
  // 3D 角色的枢轴点同样塌到父/根位置
  const computePivotWorldPosition = useCallback(
    (node: Node, character: Character, canvasW: number, canvasH: number): { x: number; y: number } => {
      const state = useProjectStore.getState();
      const worldTransforms = computeEditorWorldTransforms(character, state.currentFrame, { canvasWidth: canvasW, canvasHeight: canvasH, geometryDirection: geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D) });
      const centerX = pxToSub(canvasW / 2);
      const centerY = pxToSub(canvasH / 2);
      // 与主渲染 generateRenderPlan 一致：根节点 variantIndex 为当前朝向
      const rootNodeForDir = character.nodes[character.rootNodeId];
      const currentDirection = (rootNodeForDir?.transform.variantIndex ?? 0) as 0|1|2|3|4|5|6|7;
      const wt = worldTransforms.get(node.id);
      if (!wt) return { x: canvasW / 2, y: canvasH / 2 };
      const proj = projectToView(wt.worldX, wt.worldY, wt.worldZ, currentDirection);
      return { x: subToPx(proj.canvasX + centerX), y: subToPx(proj.canvasY + centerY) };
    }, [],
  );

  // ---- Puppet node hit-testing (Character model) ----
  // 所见即所点：形状判定三遍（精灵像素/关节盘 → 细精灵与堆叠胶囊 →
  // 无精灵兜底胶囊），纯函数在 lib/node-picking，与绘制同源。
  const collectPuppetNodeHits = useCallback(
    (px: number, py: number): { node: Node; character: Character; clipId: string | null; score: number }[] => {
      const state = useProjectStore.getState();
      const clips = state.animationClips;
      // 可见集与主画布同一份（visibleCharactersRecord 按输入记忆：
      // 绘制侧 beginPickFrame 与此处读到的必须是同一个对象，拾取戳记
      // 的同一性校验才对得上；未过滤时即原表）。隐藏的角色编号图里
      // 没画、几何兜底也不迭代它——看不见即点不中。
      const visibleRecord = visibleCharactersRecord(state.unifiedCharacters, {
        ...usePuppetSessionStore.getState(),
        activeCharacterId: useEditorStore.getState().activePuppetSkeletonId,
      });
      // 拾取编号图（与主画布同帧绘制的剪影编号）：戳记对上（fresh）
      // 时它是 tier 0 的权威口径——读到节点即视觉最上层，读到背景
      // 即此处没画精灵/关节盘（像素链擦掉的区域点不中）
      const pickRead = readPick(px, py, {
        characters: visibleRecord, sprites: state.sprites,
        frame: state.currentFrame, canvasWidth, canvasHeight,
        nodeTurn3D: useEditorStore.getState().nodeTurn3D,
      });
      const bufferNodeId = pickRead.nodeId;
      const picks = pickNodesAt(Object.values(visibleRecord ?? {}), px, py, {
        sprites: state.sprites,
        frame: state.currentFrame,
        canvasWidth,
        canvasHeight,
        geometryDirection: geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D),
        // 容差按屏幕像素定（约 6 屏幕 px），换算到画布坐标
        slopPx: Math.max(6 / zoom, 1.5),
        bufferNodeId,
        bufferAuthoritative: pickRead.fresh,
      });
      return picks.map((p, i) => ({
        node: p.node,
        character: p.character,
        clipId: clips.find((c) => c.puppetCharacterId === p.character.id)?.id ?? null,
        score: p.tier * 100000 + i,
      }));
    },
    [canvasWidth, canvasHeight, zoom],
  );

  /** 命中栈顶（原 findPuppetNodeAtPixel 语义） */
  const findPuppetNodeAtPixel = useCallback(
    (px: number, py: number): { node: Node; character: Character; clipId: string | null } | null => {
      const hits = collectPuppetNodeHits(px, py);
      const top = hits[0];
      return top ? { node: top.node, character: top.character, clipId: top.clipId } : null;
    },
    [collectPuppetNodeHits],
  );

  /** 全部命中（按分数升序），供中键循环切换 */
  const findAllPuppetNodesAtPixel = useCallback(
    (px: number, py: number): { node: Node; character: Character; clipId: string | null }[] => {
      return collectPuppetNodeHits(px, py).map((h) => ({ node: h.node, character: h.character, clipId: h.clipId }));
    },
    [collectPuppetNodeHits],
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
  }, [parts, backgroundColor, onionSkinEnabled, onionSkinFrames, motionBlurStrokes, effectStrokes, effectTracks, proceduralAnimations, canvasModifierTracks, frameRate, animationVariables, spriteEditModifiers, unifiedCharacters, globalModifiers, globalBlueprint]);

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
    trajectoryPathRef,
    selectionMaskRef, lassoPathRef, selectionMarchOffsetRef,
    boneDragRef, puppetNodeDragRef, pixelEditCommandRef, spriteEditBrushCmdRef,
    // State
    fpsFramesRef, fpsLastTimeRef, fpsDisplay, setFpsDisplay,
    currentFrameRef, playStateRef, zoomRef, panRef,
    // Store values
    parts, canvasWidth, canvasHeight, backgroundColor,
    onionSkinEnabled, onionSkinFrames, motionBlurStrokes, effectStrokes,
    effectTracks, proceduralAnimations, canvasModifierTracks,
    setPartPixels, frameRate, setCanvasSize, animationVariables,
    globalModifiers,
    nonPuppetParts, unifiedCharacters,
    // Editor
    tool, brushSize, brushColor, zoom, panX, panY, showGrid,
    editMode, selectedSpriteId, setZoom, setPan,
    autoMotionBlur, autoMotionBlurIntensity, motionBlurBrushType, motionBlurIntensity, motionBlurDirection,
    effectBrushColor, effectBrushRadius, effectBrushIntensity, effectBrushDensity, effectBrushSpread, strokeBlendMode,
    perspectiveForeshorten,
    showPuppetSkeleton, activePuppetSkeletonId, selectedNodeId,
    referenceImageUrl, referenceImageOpacity, referenceImageVisible, maskNodeId,
    refWizardOpen,
    magicWandTolerance, spriteEditSpriteId, spriteEditModifiers,
    brushStyle, brushStyleParams, compositingMode, styleAspects, strokeDrivers, editorStore,
    // Derived
    selectedPart,
    // Helpers
    getFullTranslateOffset, getInterpolatedTranslateOffset, getInterpolatedModifiers,
    screenToPixel, canvasToPartLocal, findPartAtPixel,
    applyBrush, applyFill, applyEyedropper,
    computePivotWorldPosition, findPuppetNodeAtPixel, findAllPuppetNodesAtPixel, extractSelectionAsPart,
    middleClickRef, leftPressRef,
    // Canvas size
    canvasSizeEditing, setCanvasSizeEditing, canvasSizeW, setCanvasSizeW, canvasSizeH, setCanvasSizeH, applyCanvasSize,
    // Container
    containerSize,
  };
}

export type CanvasState = ReturnType<typeof useCanvasState>;
