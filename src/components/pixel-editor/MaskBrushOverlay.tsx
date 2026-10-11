'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useEditorStore, useProjectStore } from '@/lib/store';
import PivotEditor from './puppet/PivotEditor';
import type { Part } from '@/lib/types';

// ============================================================
// MaskBrushOverlay - 遮罩模式专用笔刷
// 在参考图上绘制遮罩，不经过现有笔刷管线
// ============================================================

interface Props {
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  panX: number;
  panY: number;
}

export default function MaskBrushOverlay({ canvasWidth, canvasHeight, zoom, panX, panY }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const [brushSize, setBrushSize] = useState(8);
  const [extractedPart, setExtractedPart] = useState<Part | null>(null);

  const maskNodeId = useEditorStore((s) => s.maskNodeId);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const setMaskNodeId = useEditorStore((s) => s.setMaskNodeId);
  const referenceImageUrl = useEditorStore((s) => s.referenceImageUrl);

  // 初始化：透明底
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  }, [canvasWidth, canvasHeight, maskNodeId]);

  const getPos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // 转为画布像素坐标
    const x = (e.clientX - rect.left - panX) / zoom;
    const y = (e.clientY - rect.top - panY) / zoom;
    return { x: Math.floor(x), y: Math.floor(y) };
  };

  const drawAt = (x: number, y: number, erase = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.fillStyle = erase ? 'rgba(0,0,0,1)' : 'rgba(255,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const handleDown = (e: React.MouseEvent) => {
    isDrawing.current = true;
    const { x, y } = getPos(e);
    drawAt(x, y, e.shiftKey); // Shift+画 = 擦除
  };

  const handleMove = (e: React.MouseEvent) => {
    if (!isDrawing.current) return;
    const { x, y } = getPos(e);
    drawAt(x, y, e.shiftKey);
  };

  const handleUp = () => {
    isDrawing.current = false;
  };

  const handleConfirm = async () => {
    const maskCanvas = canvasRef.current;
    if (!maskCanvas || !maskNodeId || !referenceImageUrl) {
      setEditMode('normal');
      setMaskNodeId(null);
      return;
    }

    try {
      const maskCtx = maskCanvas.getContext('2d')!;
      const maskData = maskCtx.getImageData(0, 0, canvasWidth, canvasHeight);

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
      const refCtx = refCanvas.getContext('2d')!;
      // 与 PixelCanvas 显示一致：contain 模式居中，不是拉伸
      const scale = Math.min(canvasWidth / img.naturalWidth, canvasHeight / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const dx = (canvasWidth - dw) / 2;
      const dy = (canvasHeight - dh) / 2;
      refCtx.imageSmoothingEnabled = false;
      refCtx.drawImage(img, dx, dy, dw, dh);
      const refData = refCtx.getImageData(0, 0, canvasWidth, canvasHeight);

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
      const part = projectStore.addPart(`遮罩精灵`, w, h, {
        pivotX: Math.floor(w / 2),
        pivotY: Math.floor(h / 2),
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
            row.push(a < 10 ? '' : `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`);
          } else {
            row.push('');
          }
        }
        pixels.push(row);
      }
      projectStore.setPartPixels(part.id, pixels);
      console.log('[MaskBrush] 已生成 Part:', part.id);

      // 关联到节点
      const activeSkeletonId = useEditorStore.getState().activePuppetSkeletonId;
      if (activeSkeletonId && maskNodeId) {
        projectStore.updatePuppetNode(activeSkeletonId, maskNodeId, {
          spritePartId: part.id,
        });
        console.log('[MaskBrush] 已关联到节点:', maskNodeId);
      }

      // 显示轴心编辑器
      const fullPart = useProjectStore.getState().parts.find((p) => p.id === part.id);
      if (fullPart) {
        setExtractedPart(fullPart);
        return; // 不立即退出，等轴心确认后再退出
      }
    } catch (err) {
      console.error('[MaskBrush] 提取失败:', err);
    }

    setEditMode('normal');
    setMaskNodeId(null);
  };

  const handlePivotClose = () => {
    setExtractedPart(null);
    setEditMode('normal');
    setMaskNodeId(null);
    // 返回向导继续下一个肢体
    useEditorStore.getState().setRefWizardOpen(true);
  };

  const handleCancel = () => {
    setEditMode('normal');
    setMaskNodeId(null);
    // 返回向导
    useEditorStore.getState().setRefWizardOpen(true);
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ cursor: 'crosshair', imageRendering: 'pixelated' }}
        onMouseDown={handleDown}
        onMouseMove={handleMove}
        onMouseUp={handleUp}
        onMouseLeave={handleUp}
      />
      {/* 遮罩模式工具条 */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs pointer-events-auto z-50"
        style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', backdropFilter: 'blur(4px)' }}>
        <span className="text-purple-300 font-medium">遮罩绘制</span>
        <span className="text-gray-400">|</span>
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
        <span className="text-gray-500 text-[10px]">Shift+画=擦除</span>
        <Button size="sm" className="h-6 text-[11px]" onClick={handleConfirm}>确认</Button>
        <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={handleCancel}>取消</Button>
      </div>
      {/* 轴心编辑器 */}
      {extractedPart && (
        <PivotEditor part={extractedPart} onClose={handlePivotClose} />
      )}
    </>
  );
}
