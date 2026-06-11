'use client';

import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useProjectStore } from '@/lib/store';
import type { Part, PixelGrid, PixelColor } from '@/lib/types';

// ---- Preview Canvas: renders part pixels with crop overlay ----

interface ResizePreviewCanvasProps {
  part: Part;
  newWidth: number;
  newHeight: number;
  cropOffsetX: number;
  cropOffsetY: number;
  onCropOffsetChange: (dx: number, dy: number) => void;
}

function ResizePreviewCanvas({
  part,
  newWidth,
  newHeight,
  cropOffsetX,
  cropOffsetY,
  onCropOffsetChange,
}: ResizePreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; startOffsetX: number; startOffsetY: number } | null>(null);

  // Compute the display scale to fit the preview area
  const [displayScale, setDisplayScale] = useState(1);

  // Maximum canvas display area
  const maxDisplayW = 320;
  const maxDisplayH = 240;

  useEffect(() => {
    const scale = Math.min(maxDisplayW / Math.max(newWidth, part.width), maxDisplayH / Math.max(newHeight, part.height), 8);
    setDisplayScale(Math.max(1, Math.floor(scale)));
  }, [newWidth, newHeight, part.width, part.height]);

  // Render the preview
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pixelSize = displayScale;

    // Canvas size: show the larger of old/new dimensions with some padding for offset
    // We need to show where both the original content and the new bounds are.
    // In resizePart, new[x][y] = old[x - cropOffsetX][y - cropOffsetY], so
    // the new grid starts at old position (-cropOffsetX, -cropOffsetY) and
    // extends to (-cropOffsetX + newWidth, -cropOffsetY + newHeight).
    const minShowX = Math.min(0, -cropOffsetX);
    const minShowY = Math.min(0, -cropOffsetY);
    const maxShowX = Math.max(part.width, newWidth - cropOffsetX);
    const maxShowY = Math.max(part.height, newHeight - cropOffsetY);

    const showW = maxShowX - minShowX;
    const showH = maxShowY - minShowY;

    const canvasW = showW * pixelSize;
    const canvasH = showH * pixelSize;

    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvasW, canvasH);

    // Draw checkerboard background
    const checkSize = pixelSize;
    for (let y = 0; y < canvasH; y += checkSize) {
      for (let x = 0; x < canvasW; x += checkSize) {
        const checkY = Math.floor(y / checkSize);
        const checkX = Math.floor(x / checkSize);
        ctx.fillStyle = (checkX + checkY) % 2 === 0 ? '#2a2a3a' : '#222233';
        ctx.fillRect(x, y, checkSize, checkSize);
      }
    }

    // Helper: draw pixel grid
    const drawPixels = (pixels: PixelGrid, offsetX: number, offsetY: number, highlight: boolean) => {
      for (let y = 0; y < pixels.length; y++) {
        for (let x = 0; x < pixels[y].length; x++) {
          const color = pixels[y][x];
          if (color !== null) {
            const drawX = (x + offsetX - minShowX) * pixelSize;
            const drawY = (y + offsetY - minShowY) * pixelSize;
            if (highlight) {
              // Dim the original content that falls outside the crop frame.
              // Source pixel (x, y) maps to (x + cropOffsetX, y + cropOffsetY) in the new grid.
              const inNew = (x + cropOffsetX >= 0 && x + cropOffsetX < newWidth &&
                            y + cropOffsetY >= 0 && y + cropOffsetY < newHeight);
              ctx.globalAlpha = inNew ? 1.0 : 0.3;
            }
            ctx.fillStyle = color;
            ctx.fillRect(drawX, drawY, pixelSize, pixelSize);
            ctx.globalAlpha = 1.0;
          }
        }
      }
    };

    // Draw original pixels (dimmed where outside crop)
    drawPixels(part.pixels, 0, 0, true);

    // Draw new bounds rectangle (crop frame)
    // The new grid starts at old position (-cropOffsetX, -cropOffsetY),
    // so the frame is drawn there in the preview.
    const frameX = (-cropOffsetX - minShowX) * pixelSize;
    const frameY = (-cropOffsetY - minShowY) * pixelSize;
    const frameW = newWidth * pixelSize;
    const frameH = newHeight * pixelSize;

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(frameX + 1, frameY + 1, frameW - 2, frameH - 2);
    ctx.setLineDash([]);

    // Draw dimension labels
    ctx.fillStyle = '#3b82f6';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${newWidth} px`, frameX + frameW / 2, frameY - 4);
    ctx.save();
    ctx.translate(frameX - 4, frameY + frameH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${newHeight} px`, 0, 0);
    ctx.restore();

    // Draw pivot point of the original part
    const pivotDrawX = (part.pivotX - minShowX) * pixelSize + pixelSize / 2;
    const pivotDrawY = (part.pivotY - minShowY) * pixelSize + pixelSize / 2;
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(pivotDrawX, pivotDrawY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw new pivot position (where pivot will be after resize)
    // The new pivot at (newPivotX, newPivotY) in the new grid maps to
    // old position (newPivotX - cropOffsetX, newPivotY - cropOffsetY).
    const newPivotX = Math.max(0, Math.min(part.pivotX + cropOffsetX, newWidth - 1));
    const newPivotY = Math.max(0, Math.min(part.pivotY + cropOffsetY, newHeight - 1));
    const nPivCanvasX = (newPivotX - cropOffsetX - minShowX) * pixelSize + pixelSize / 2;
    const nPivCanvasY = (newPivotY - cropOffsetY - minShowY) * pixelSize + pixelSize / 2;

    // Only draw if new pivot differs from old pivot
    if (nPivCanvasX !== pivotDrawX || nPivCanvasY !== pivotDrawY) {
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(nPivCanvasX, nPivCanvasY, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Legend
    const legendY = canvasH - 16;
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(8, legendY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cccccc';
    ctx.fillText('原始锚点', 16, legendY + 3);

    if (nPivCanvasX !== pivotDrawX || nPivCanvasY !== pivotDrawY) {
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(80, legendY, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#cccccc';
      ctx.fillText('新锚点', 88, legendY + 3);
    }
  }, [part, newWidth, newHeight, cropOffsetX, cropOffsetY, displayScale]);

  // ---- Mouse drag to adjust crop offset ----

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        startOffsetX: cropOffsetX,
        startOffsetY: cropOffsetY,
      };
    },
    [cropOffsetX, cropOffsetY]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      const pixelDx = Math.round(dx / displayScale);
      const pixelDy = Math.round(dy / displayScale);
      onCropOffsetChange(
        dragStartRef.current.startOffsetX + pixelDx,
        dragStartRef.current.startOffsetY + pixelDy
      );
    },
    [displayScale, onCropOffsetChange]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    dragStartRef.current = null;
  }, []);

  // Also handle mouse leaving the canvas
  const handleMouseLeave = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      dragStartRef.current = null;
    }
  }, []);

  return (
    <div ref={containerRef} className="flex items-center justify-center bg-muted/30 rounded border border-border/30 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="cursor-move"
        style={{ imageRendering: 'pixelated' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}

// ---- ResizePreviewDialog ----

interface ResizePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  part: Part;
}

export default function ResizePreviewDialog({ open, onOpenChange, part }: ResizePreviewDialogProps) {
  const resizePart = useProjectStore((s) => s.resizePart);

  const [newWidth, setNewWidth] = useState(part.width);
  const [newHeight, setNewHeight] = useState(part.height);
  const [cropOffsetX, setCropOffsetX] = useState(0);
  const [cropOffsetY, setCropOffsetY] = useState(0);

  // Reset state when the dialog opens or part changes
  useEffect(() => {
    if (open) {
      setNewWidth(part.width);
      setNewHeight(part.height);
      setCropOffsetX(0);
      setCropOffsetY(0);
    }
  }, [open, part.id, part.width, part.height]);

  const handleCropOffsetChange = useCallback((dx: number, dy: number) => {
    setCropOffsetX(dx);
    setCropOffsetY(dy);
  }, []);

  // Compute the resulting preview pixels info
  const previewInfo = useMemo(() => {
    const w = Math.max(1, Math.min(512, newWidth));
    const h = Math.max(1, Math.min(512, newHeight));

    // Count visible pixels after resize
    let visibleCount = 0;
    let totalCount = 0;
    for (let y = 0; y < part.height; y++) {
      for (let x = 0; x < part.width; x++) {
        if (part.pixels[y]?.[x] !== null) {
          totalCount++;
          const newX = x + cropOffsetX;
          const newY = y + cropOffsetY;
          if (newX >= 0 && newX < w && newY >= 0 && newY < h) {
            visibleCount++;
          }
        }
      }
    }

    const lostCount = totalCount - visibleCount;
    const newPivotX = Math.max(0, Math.min(part.pivotX + cropOffsetX, w - 1));
    const newPivotY = Math.max(0, Math.min(part.pivotY + cropOffsetY, h - 1));

    return { visibleCount, lostCount, totalCount, newPivotX, newPivotY };
  }, [newWidth, newHeight, cropOffsetX, cropOffsetY, part]);

  const handleApply = useCallback(() => {
    const w = Math.max(1, Math.min(512, newWidth));
    const h = Math.max(1, Math.min(512, newHeight));
    resizePart(part.id, w, h, cropOffsetX, cropOffsetY);
    onOpenChange(false);
  }, [newWidth, newHeight, cropOffsetX, cropOffsetY, part.id, resizePart, onOpenChange]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Quick preset sizes
  const presets = useMemo(() => {
    const base = Math.max(part.width, part.height);
    return [
      { label: '原始', w: part.width, h: part.height },
      { label: '50%', w: Math.max(1, Math.round(part.width * 0.5)), h: Math.max(1, Math.round(part.height * 0.5)) },
      { label: '150%', w: Math.min(512, Math.round(part.width * 1.5)), h: Math.min(512, Math.round(part.height * 1.5)) },
      { label: '200%', w: Math.min(512, part.width * 2), h: Math.min(512, part.height * 2) },
      { label: '正方形', w: base, h: base },
    ];
  }, [part.width, part.height]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>调整部件尺寸</DialogTitle>
          <DialogDescription>
            设置新尺寸，在预览中拖动调整裁剪位置。蓝色框表示新的边界，框外的像素将被裁剪。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Size inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">新宽度</Label>
              <Input
                type="number"
                min={1}
                max={512}
                value={newWidth}
                onChange={(e) => setNewWidth(Math.max(1, Math.min(512, parseInt(e.target.value, 10) || 1)))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">新高度</Label>
              <Input
                type="number"
                min={1}
                max={512}
                value={newHeight}
                onChange={(e) => setNewHeight(Math.max(1, Math.min(512, parseInt(e.target.value, 10) || 1)))}
                className="h-8 text-sm"
              />
            </div>
          </div>

          {/* Quick presets */}
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-muted-foreground">预设:</span>
            {presets.map((p) => (
              <Button
                key={p.label}
                variant={newWidth === p.w && newHeight === p.h ? 'default' : 'outline'}
                size="sm"
                className="h-5 px-1.5 text-[10px]"
                onClick={() => {
                  setNewWidth(p.w);
                  setNewHeight(p.h);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>

          {/* Crop offset inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">裁剪偏移 X</Label>
              <Input
                type="number"
                value={cropOffsetX}
                onChange={(e) => setCropOffsetX(parseInt(e.target.value, 10) || 0)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">裁剪偏移 Y</Label>
              <Input
                type="number"
                value={cropOffsetY}
                onChange={(e) => setCropOffsetY(parseInt(e.target.value, 10) || 0)}
                className="h-8 text-sm"
              />
            </div>
          </div>

          {/* Preview canvas */}
          <ResizePreviewCanvas
            part={part}
            newWidth={newWidth}
            newHeight={newHeight}
            cropOffsetX={cropOffsetX}
            cropOffsetY={cropOffsetY}
            onCropOffsetChange={handleCropOffsetChange}
          />

          {/* Info */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span>原始: {part.width} x {part.height}</span>
            <span>|</span>
            <span>新: {newWidth} x {newHeight}</span>
            <span>|</span>
            <span>保留像素: {previewInfo.visibleCount}/{previewInfo.totalCount}</span>
            {previewInfo.lostCount > 0 && (
              <>
                <span>|</span>
                <span className="text-amber-500">丢失像素: {previewInfo.lostCount}</span>
              </>
            )}
            <span>|</span>
            <span>新锚点: ({previewInfo.newPivotX}, {previewInfo.newPivotY})</span>
          </div>

          {previewInfo.lostCount > 0 && (
            <div className="text-[10px] text-amber-500 bg-amber-500/10 rounded px-2 py-1">
              缩小尺寸将裁剪 {previewInfo.lostCount} 个像素。拖动画布可调整保留区域的位置。
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleCancel}>
            取消
          </Button>
          <Button size="sm" onClick={handleApply}>
            应用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
