'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useEditorStore, useProjectStore } from '@/lib/store';
import PivotEditor from './puppet/PivotEditor';
import type { Sprite } from '@/lib/unified-types';
import {
  createDefaultCostumePiece,
  projectToView,
  subToPx,
} from '@/lib/unified-types';
import { computeWorldTransforms, geometryDirectionFromToggle } from '@/lib/unified-render';
import { alphaPlaneFromImageData, computeDiskPaintSet, segmentCrossesWall } from '@/lib/mask-region';

// ============================================================
// MaskBrushOverlay - 遮罩模式专用笔刷
// 在参考图上绘制遮罩，不经过现有笔刷管线
// ============================================================

interface Props {
  canvasWidth: number;
  canvasHeight: number;
}

export default function MaskBrushOverlay({ canvasWidth, canvasHeight }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barrierCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastBarrierPos = useRef<{ x: number; y: number } | null>(null);
  // 防溢出（笔画栅栏模型，见 lib/mask-region 头注）：画布上是否已有线；
  // 本笔画锚点 = 上一盖章中心（涂料只许与锚点同侧连通，中心轨迹压墙即
  // 截断）；线画布的 alpha 平面缓存（按线版本号失效，避免每章全图读取）；
  // 上个盖章点（笔画插值用）
  const hasBarrierRef = useRef(false);
  const strokeAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const barrierVersionRef = useRef(0);
  const alphaCacheRef = useRef<{ version: number; alpha: Uint8Array } | null>(null);
  const lastStampPos = useRef<{ x: number; y: number } | null>(null);
  const [brushSize, setBrushSize] = useState(8);
  const [extractedSprite, setExtractedSprite] = useState<Sprite | null>(null);
  const [lastUpdateInfo, setLastUpdateInfo] = useState<string | null>(null);
  // 绘制模式：draw=绘制，erase=擦除，barrier=防溢出线
  const [paintMode, setPaintMode] = useState<'draw' | 'erase' | 'barrier'>('draw');
  // 光标位置（用于显示笔刷大小）
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  // 色键取色（跨肢体共享，存 editor store）
  const [isPicking, setIsPicking] = useState(false);
  const keyColor = useEditorStore((s) => s.chromaKeyColor);
  const setKeyColor = useEditorStore((s) => s.setChromaKeyColor);

  const maskNodeId = useEditorStore((s) => s.maskNodeId);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const setMaskNodeId = useEditorStore((s) => s.setMaskNodeId);
  const referenceImageUrl = useEditorStore((s) => s.referenceImageUrl);
  // 直接订阅，zoom/pan 变化时重渲染
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);

  // 初始化：透明底（遮罩和防溢出线都清空）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    const bCanvas = barrierCanvasRef.current;
    if (bCanvas) {
      bCanvas.width = canvasWidth;
      bCanvas.height = canvasHeight;
      bCanvas.getContext('2d')!.clearRect(0, 0, canvasWidth, canvasHeight);
    }
    hasBarrierRef.current = false;
    strokeAnchorRef.current = null;
    barrierVersionRef.current++;
    alphaCacheRef.current = null;
  }, [canvasWidth, canvasHeight, maskNodeId]);

  const getPos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // overlay canvas 已按 pan/zoom 定位，rect 即图像区域
    // 直接换算到内部像素坐标
    const x = (e.clientX - rect.left) / (rect.width / canvasWidth);
    const y = (e.clientY - rect.top) / (rect.height / canvasHeight);
    return { x: Math.floor(x), y: Math.floor(y) };
  };

  // 加载参考图并返回与画布同尺寸的 ImageData（contain 居中）
  const getReferenceImageData = async (): Promise<ImageData | null> => {
    if (!referenceImageUrl) return null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = referenceImageUrl;
    });
    const refCanvas = document.createElement('canvas');
    refCanvas.width = canvasWidth;
    refCanvas.height = canvasHeight;
    const refCtx = refCanvas.getContext('2d', { willReadFrequently: true })!;
    const scale = Math.min(canvasWidth / img.naturalWidth, canvasHeight / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = (canvasWidth - dw) / 2;
    const dy = (canvasHeight - dh) / 2;
    refCtx.imageSmoothingEnabled = false;
    refCtx.drawImage(img, dx, dy, dw, dh);
    return refCtx.getImageData(0, 0, canvasWidth, canvasHeight);
  };

  // 取色：在参考图上点选像素颜色
  const handlePick = async (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= canvasWidth || y >= canvasHeight) return;
    const refData = await getReferenceImageData();
    if (!refData) return;
    const idx = (y * canvasWidth + x) * 4;
    const r = refData.data[idx];
    const g = refData.data[idx + 1];
    const b = refData.data[idx + 2];
    const a = refData.data[idx + 3];
    if (a < 10) {
      setLastUpdateInfo('取色失败：该处透明');
      return;
    }
    setKeyColor({ r, g, b });
    setIsPicking(false);
    setLastUpdateInfo(`已取色键 rgb(${r},${g},${b})`);
  };


  // 防溢出线的 alpha 平面（栅栏判定用）：按线版本号缓存——线不变时
  // 每个盖章点直接复用，不再每章全图 getImageData（旧射线实现的浪费）。
  // 无线时返回 null（不约束、零成本）。
  const getBarrierAlpha = (): Uint8Array | null => {
    if (!hasBarrierRef.current) return null;
    const cache = alphaCacheRef.current;
    if (cache && cache.version === barrierVersionRef.current) return cache.alpha;
    const bCanvas = barrierCanvasRef.current;
    if (!bCanvas) return null;
    const bCtx = bCanvas.getContext('2d', { willReadFrequently: true })!;
    const img = bCtx.getImageData(0, 0, canvasWidth, canvasHeight);
    const alpha = alphaPlaneFromImageData(img.data, canvasWidth, canvasHeight);
    alphaCacheRef.current = { version: barrierVersionRef.current, alpha };
    return alpha;
  };

  const drawAt = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    if (paintMode === 'barrier') {
      // 防溢出线：1px 蓝色线条（画在独立 canvas）
      const bCanvas = barrierCanvasRef.current;
      if (!bCanvas) return;
      const bCtx = bCanvas.getContext('2d')!;
      bCtx.strokeStyle = 'rgba(0,150,255,1)';
      bCtx.lineWidth = 1;
      bCtx.lineCap = 'round';
      const last = lastBarrierPos.current;
      bCtx.beginPath();
      if (last) {
        bCtx.moveTo(last.x + 0.5, last.y + 0.5);
        bCtx.lineTo(x + 0.5, y + 0.5);
      } else {
        bCtx.moveTo(x + 0.5, y + 0.5);
        bCtx.lineTo(x + 0.5, y + 0.5);
      }
      bCtx.stroke();
      lastBarrierPos.current = { x, y };
      hasBarrierRef.current = true;
      barrierVersionRef.current++;
      return;
    }

    const erase = paintMode === 'erase';
    const radius = brushSize / 2;

    if (erase) {
      // 擦除：不受防溢出线约束
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // 绘制：笔画栅栏判定（lib/mask-region）。无线时整圆涂；有线时本章
    // 只涂圆盘内与锚点（上一盖章中心）同侧 4 连通的像素——笔尖压线时
    // 只涂线内侧、贴墙无死区；中心轨迹压墙则本章整体截断、锚点不越墙，
    // 手速多快都跳不过去；斜线角缝对 4 连通洪泛数学密封。
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255,0,0,0.5)';
    const alpha = getBarrierAlpha();
    if (!alpha) {
      const x0 = Math.max(0, Math.floor(x - radius));
      const x1 = Math.min(canvasWidth - 1, Math.ceil(x + radius));
      const y0 = Math.max(0, Math.floor(y - radius));
      const y1 = Math.min(canvasHeight - 1, Math.ceil(y + radius));
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dx = px - x;
          const dy = py - y;
          if (dx * dx + dy * dy > radius * radius) continue;
          ctx.fillRect(px, py, 1, 1);
        }
      }
      return;
    }
    const anchor = strokeAnchorRef.current;
    if (anchor && segmentCrossesWall(alpha, canvasWidth, canvasHeight, anchor.x, anchor.y, x, y)) {
      return; // 中心轨迹压墙：本章不涂，锚点留在墙内侧
    }
    const paint = computeDiskPaintSet(
      alpha, canvasWidth, canvasHeight, x, y, radius,
      anchor?.x ?? x, anchor?.y ?? y,
    );
    for (const idx of paint) {
      ctx.fillRect(idx % canvasWidth, Math.floor(idx / canvasWidth), 1, 1);
    }
    // 锚点推进到本章中心（中心压在墙上时不推进，锚点保持在内侧）
    if (alpha[y * canvasWidth + x]! <= 10) {
      strokeAnchorRef.current = { x, y };
    }
  };

  const handleDown = (e: React.MouseEvent) => {
    const { x, y } = getPos(e);
    if (isPicking) {
      handlePick(x, y);
      return;
    }
    isDrawing.current = true;
    if (paintMode === 'barrier') {
      lastBarrierPos.current = null; // 新笔画
    } else {
      // 落笔设锚点（绘制模式）：落在墙上则锚点为空，待笔尖移出墙面再立
      if (paintMode === 'draw') {
        const alpha = getBarrierAlpha();
        strokeAnchorRef.current = alpha && alpha[y * canvasWidth + x]! > 10 ? null : { x, y };
      }
      lastStampPos.current = { x, y };
    }
    drawAt(x, y);
  };

  const handleMove = (e: React.MouseEvent) => {
    const { x, y } = getPos(e);
    // 更新光标位置（显示笔刷大小）
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      setCursorPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
    if (!isDrawing.current) return;
    if (paintMode === 'barrier') {
      drawAt(x, y); // 线条靠 lineTo 自带连续性
      return;
    }
    // 绘制/擦除：相邻采样点间插值盖章，快拖不留点状断口
    const last = lastStampPos.current;
    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(1, brushSize / 4);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let i = 1; i <= n; i++) {
        drawAt(Math.round(last.x + (dx * i) / n), Math.round(last.y + (dy * i) / n));
      }
    } else {
      drawAt(x, y);
    }
    lastStampPos.current = { x, y };
  };

  const handleUp = () => {
    isDrawing.current = false;
    lastBarrierPos.current = null;
    lastStampPos.current = null;
    strokeAnchorRef.current = null;
  };

  const handleLeave = () => {
    isDrawing.current = false;
    lastBarrierPos.current = null;
    lastStampPos.current = null;
    strokeAnchorRef.current = null;
    setCursorPos(null);
  };

  const handleConfirm = async () => {
    const maskCanvas = canvasRef.current;
    if (!maskCanvas || !maskNodeId || !referenceImageUrl) {
      setEditMode('normal');
      setMaskNodeId(null);
      return;
    }

    try {
      const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
      const maskData = maskCtx.getImageData(0, 0, canvasWidth, canvasHeight);

      const refData = await getReferenceImageData();
      if (!refData) {
        setEditMode('normal');
        setMaskNodeId(null);
        return;
      }

      let minX = canvasWidth, minY = canvasHeight, maxX = -1, maxY = -1;
      for (let y = 0; y < canvasHeight; y++) {
        for (let x = 0; x < canvasWidth; x++) {
          const idx = (y * canvasWidth + x) * 4;
          if (maskData.data[idx + 3] > 10) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX < 0) {
        setEditMode('normal');
        setMaskNodeId(null);
        return;
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const projectStore = useProjectStore.getState();
      // 找到拥有该节点的角色（新模型：unifiedCharacters）
      const unifiedCharacters = projectStore.unifiedCharacters ?? {};
      let ownerId: string | null = null;
      let ownerChar: (typeof unifiedCharacters)[string] | null = null;
      for (const [id, ch] of Object.entries(unifiedCharacters)) {
        if (ch.nodes[maskNodeId]) {
          ownerId = id;
          ownerChar = ch;
          break;
        }
      }
      const nodeName = ownerChar?.nodes[maskNodeId]?.name ?? '未知';

      // 抠图转正口径：取节点在当前对位姿态下的世界变换（与画布渲染同一条
      // computeWorldTransforms + projectToView 口径）。plug 直接落在关节的画布
      // 位置上，采样后按 −世界角把精灵转回节点局部规范朝向——装配渲染时节点
      // 转回对位姿态即与参考图重合，任何其他姿态下精灵与骨骼的相对朝向恒定，
      // 不再需要 nodeOffsets 之类的事后角度补偿。
      let nodeCanvas: { x: number; y: number; angle: number } | null = null;
      if (ownerChar) {
        const wts = computeWorldTransforms(
          ownerChar,
          projectStore.currentFrame,
          canvasWidth,
          canvasHeight,
          undefined,
          undefined,
          undefined,
          undefined,
          geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D),
        );
        const wt = wts.get(maskNodeId);
        if (wt) {
          const rootNodeForDir = ownerChar.nodes[ownerChar.rootNodeId];
          const currentDirection = (rootNodeForDir?.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
          const proj = projectToView(wt.worldX, wt.worldY, wt.worldZ, currentDirection);
          nodeCanvas = {
            x: subToPx(proj.canvasX) + canvasWidth / 2,
            y: subToPx(proj.canvasY) + canvasHeight / 2,
            angle: wt.worldAngle,
          };
        }
      }

      const sprite = projectStore.addSprite(`遮罩_${nodeName}`, w, h, {
        plugX: nodeCanvas ? nodeCanvas.x - minX : Math.floor(w / 2),
        plugY: nodeCanvas ? nodeCanvas.y - minY : Math.floor(h / 2),
      });

      const pixels: string[][] = [];
      for (let y = 0; y < h; y++) {
        const row: string[] = [];
        for (let x = 0; x < w; x++) {
          const sx = minX + x;
          const sy = minY + y;
          const maskIdx = (sy * canvasWidth + sx) * 4;
          const refIdx = (sy * canvasWidth + sx) * 4;
          if (maskData.data[maskIdx + 3] > 10) {
            const r = refData.data[refIdx];
            const g = refData.data[refIdx + 1];
            const b = refData.data[refIdx + 2];
            const a = refData.data[refIdx + 3];
            // 色键过滤：精确匹配色键颜色的像素视为透明
            const isKey = keyColor && a >= 10 &&
              r === keyColor.r && g === keyColor.g && b === keyColor.b;
            row.push(a < 10 || isKey ? '' : `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`);
          } else {
            row.push('');
          }
        }
        pixels.push(row);
      }
      projectStore.setSpritePixels(sprite.id!, pixels);
      console.log('[MaskBrush] 已生成 Sprite:', sprite.id);

      // 转正：绕 plug（关节）按 −世界角旋转精灵内容（transformSprite 绕锚点烘焙，
      // plug 随旋转更新）。角度归一到 (−180, 180]，近零跳过（轴对齐采样即规范朝向）。
      if (nodeCanvas) {
        let theta = nodeCanvas.angle % 360;
        if (theta > 180) theta -= 360;
        if (theta <= -180) theta += 360;
        if (Math.abs(theta) >= 0.5) {
          projectStore.transformSprite(sprite.id!, { kind: 'rotate', angleDeg: -theta });
        }
      }

      // 关联到节点：只写当前激活服装的 pieces（新模型），不改模板节点的 sprite
      // （模板是共享的，服装才是向导产物）
      if (maskNodeId) {
        if (ownerChar && ownerId) {
          // 只写当前激活服装，只写当前方向（对位时选择的方向），不写四个方向
          // 方向：从角色根节点的 transform.variantIndex 读取（新模型）
          const rootNode = ownerChar.nodes[ownerChar.rootNodeId];
          const dirIndex = (rootNode?.transform.variantIndex ?? 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
          const activeCsId = ownerChar.activeCostumeSetId;
          const activeCs = (ownerChar.costumeSets ?? []).find((cs) => cs.id === activeCsId);
          if (activeCs) {
            // Sprite 已在全局表，直接引用 ID（无需转换）
            const spriteId = sprite.id!;
            // 用 slotKey（不是 nodeId）——渲染器按 costumeSet.pieces[node.slot.slotKey] 查找
            const node = ownerChar.nodes[maskNodeId];
            const slotKey = node?.slot?.slotKey ?? maskNodeId;
            const pieces = { ...activeCs.pieces };
            const piece = pieces[slotKey] ?? createDefaultCostumePiece(slotKey);
            pieces[slotKey] = {
              ...piece,
              sprites: { ...piece.sprites, [dirIndex]: { spriteId } },
            };
            const newCostumeSets = ownerChar.costumeSets.map((cs) =>
              cs.id === activeCs.id ? { ...cs, pieces } : cs
            );
            projectStore.updateUnifiedCharacter(ownerId, {
              costumeSets: newCostumeSets,
            });
            setLastUpdateInfo(
              `节点 ${maskNodeId.slice(0, 8)} → 角色 ${ownerId.slice(0, 8)} → Sprite ${spriteId.slice(0, 12)} ✓成功`
            );
          } else {
            setLastUpdateInfo(`✗角色没有激活服装集`);
          }
        } else {
          setLastUpdateInfo(`✗找不到节点所在角色: ${maskNodeId.slice(0, 8)}`);
        }
        console.log('[MaskBrush] 已关联到节点:', maskNodeId);
        // 通知向导更新进度
        window.dispatchEvent(
          new CustomEvent('ref-assembly:mask-done', { detail: { nodeId: maskNodeId } })
        );
      }

      // 显示轴心编辑器（直接编辑全局表中的 Sprite，无需回写）
      const fullSprite = useProjectStore.getState().sprites[sprite.id!];
      if (fullSprite) {
        setExtractedSprite(fullSprite);
        return; // 不立即退出，等轴心确认后再退出
      }
    } catch (err) {
      console.error('[MaskBrush] 提取失败:', err);
    }

    setEditMode('normal');
    setMaskNodeId(null);
  };

  const handlePivotClose = () => {
    // PivotEditor 直接编辑全局表中的 Sprite，无需回写
    setExtractedSprite(null);
    setEditMode('normal');
    setMaskNodeId(null);
    // 返回向导继续下一个肢体
    useEditorStore.getState().setRefWizardOpen(true);
  };

  const handleCancel = () => {
    setEditMode('normal');
    setMaskNodeId(null);
    // 向导一直挂载，无需重新打开
  };

  return (
    <>
      {/* 防溢出线 canvas（蓝色 1px，z-39 在遮罩之下） */}
      <canvas
        ref={barrierCanvasRef}
        className="absolute z-[39] pointer-events-none"
        style={{
          imageRendering: 'pixelated',
          left: panX,
          top: panY,
          width: canvasWidth * zoom,
          height: canvasHeight * zoom,
        }}
      />
      <canvas
        ref={canvasRef}
        className="absolute z-40"
        style={{
          cursor: isPicking ? 'copy' : 'none',
          imageRendering: 'pixelated',
          left: panX,
          top: panY,
          width: canvasWidth * zoom,
          height: canvasHeight * zoom,
        }}
        onMouseDown={handleDown}
        onMouseMove={handleMove}
        onMouseUp={handleUp}
        onMouseLeave={handleLeave}
      />
      {/* 笔刷大小光标 */}
      {cursorPos && !isPicking && paintMode !== 'barrier' && (
        <div
          className="absolute z-[41] pointer-events-none rounded-full border-2"
          style={{
            left: panX + cursorPos.x - (brushSize * zoom) / 2,
            top: panY + cursorPos.y - (brushSize * zoom) / 2,
            width: brushSize * zoom,
            height: brushSize * zoom,
            borderColor: paintMode === 'erase' ? 'rgba(255,255,255,0.8)' : 'rgba(255,0,0,0.8)',
          }}
        />
      )}
      {cursorPos && !isPicking && paintMode === 'barrier' && (
        <div
          className="absolute z-[41] pointer-events-none rounded-full border-2 border-blue-400"
          style={{
            left: panX + cursorPos.x - 3,
            top: panY + cursorPos.y - 3,
            width: 6,
            height: 6,
          }}
        />
      )}
      {/* 遮罩模式工具条 */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs pointer-events-auto z-50"
        style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', backdropFilter: 'blur(4px)' }}>
        <span className="text-purple-300 font-medium">遮罩绘制</span>
        <span className="text-gray-400">|</span>
        {/* 模式切换：绘制 / 擦除 / 防溢出线 */}
        <div className="flex rounded overflow-hidden border border-white/20">
          {([
            { mode: 'draw' as const, label: '绘制' },
            { mode: 'erase' as const, label: '擦除' },
            { mode: 'barrier' as const, label: '防溢出线' },
          ]).map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setPaintMode(mode)}
              className={`px-2 h-6 text-[11px] transition-colors ${
                paintMode === mode
                  ? mode === 'barrier'
                    ? 'bg-blue-600 text-white'
                    : 'bg-red-600 text-white'
                  : 'bg-transparent text-gray-300 hover:bg-white/10'
              }`}
              title={mode === 'barrier' ? '画1px蓝色线条，绘制时笔刷不会跨过线条' : undefined}
            >
              {label}
            </button>
          ))}
        </div>
        {paintMode !== 'barrier' && (
          <label className="text-gray-300 flex items-center gap-1">
            笔刷
            <input
              type="range"
              min={2}
              max={32}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-16"
            />
            {brushSize}px
          </label>
        )}
        {paintMode === 'barrier' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] text-gray-400"
            onClick={() => {
              const bCanvas = barrierCanvasRef.current;
              if (bCanvas) bCanvas.getContext('2d')!.clearRect(0, 0, canvasWidth, canvasHeight);
              hasBarrierRef.current = false;
              strokeAnchorRef.current = null;
              barrierVersionRef.current++;
              alphaCacheRef.current = null;
            }}
          >
            清除线条
          </Button>
        )}
        <span className="text-gray-400">|</span>
        {/* 色键取色 */}
        <Button
          size="sm"
          variant={isPicking ? "default" : "outline"}
          className="h-6 text-[11px]"
          onClick={() => setIsPicking(!isPicking)}
          title="点击参考图取色键颜色"
        >
          {isPicking ? "取色中…" : "取色"}
        </Button>
        {keyColor && (
          <>
            <span
              className="w-5 h-5 rounded border border-white/30 inline-block"
              style={{ backgroundColor: `rgb(${keyColor.r},${keyColor.g},${keyColor.b})` }}
              title={`rgb(${keyColor.r},${keyColor.g},${keyColor.b})`}
            />
            <Button size="sm" variant="ghost" className="h-6 text-[11px] text-gray-500" onClick={() => setKeyColor(null)}>
              清除
            </Button>
          </>
        )}
        <Button size="sm" className="h-6 text-[11px]" onClick={handleConfirm}>确认</Button>
        <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={handleCancel}>取消</Button>
      </div>
      {/* 更新状态显示 */}
      {lastUpdateInfo && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded text-[11px] pointer-events-none z-50"
          style={{ background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.2)' }}>
          <span className={lastUpdateInfo.includes('✓') ? 'text-green-400' : 'text-red-400'}>
            {lastUpdateInfo}
          </span>
        </div>
      )}
      {/* 轴心编辑器 */}
      {extractedSprite && (
        <PivotEditor sprite={extractedSprite} onClose={handlePivotClose} />
      )}
    </>
  );
}
