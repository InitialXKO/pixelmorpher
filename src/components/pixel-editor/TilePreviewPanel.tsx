'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ZoomIn, ZoomOut, Maximize, Eye, EyeOff } from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { renderFrameToCanvas } from '@/lib/engine';

// ============================================================
// TilePreviewPanel - Tiled preview for map tile animation workflow
// ============================================================

export default function TilePreviewPanel() {
  // ---- Workspace store ----
  const { tilePreview, updateTilePreview } = useWorkspaceStore();
  const { cols, rows, gap, gapColor, seamlessHighlight, zoom } = tilePreview;

  // ---- Project store ----
  const {
    parts,
    keyframes,
    canvasWidth,
    canvasHeight,
    backgroundColor,
    currentFrame,
    effectTracks,
    motionBlurStrokes,
    effectStrokes,
    skeletons,
    proceduralAnimations,
    canvasModifierTracks,
  } = useProjectStore();

  // ---- Refs ----
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const dirtyRef = useRef(true);

  // ---- State ----
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // ---- Mark dirty when relevant data changes ----
  useEffect(() => {
    dirtyRef.current = true;
  }, [parts, keyframes, currentFrame, backgroundColor, canvasWidth, canvasHeight,
      cols, rows, gap, gapColor, seamlessHighlight, zoom,
      effectTracks, motionBlurStrokes, effectStrokes, skeletons, proceduralAnimations, canvasModifierTracks]);

  // ---- Container size tracking ----
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

  // ---- Render loop ----
  const renderTilePreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Step 1: Render the current frame to an offscreen canvas using the engine
    const frameCanvas = renderFrameToCanvas(
      canvasWidth,
      canvasHeight,
      parts,
      keyframes,
      currentFrame,
      backgroundColor,
      effectTracks,
      motionBlurStrokes,
      effectStrokes,
      false,
      0,
      skeletons,
      proceduralAnimations,
      canvasModifierTracks,
      'low', // Use low quality for preview performance
    );

    // Step 2: Calculate dimensions for the tiled output
    const tileW = canvasWidth * zoom;
    const tileH = canvasHeight * zoom;
    const totalW = cols * tileW + (cols - 1) * gap;
    const totalH = rows * tileH + (rows - 1) * gap;

    // Set canvas size to fit the tiled grid
    canvas.width = Math.max(1, totalW);
    canvas.height = Math.max(1, totalH);

    // Step 3: Fill with gap color
    ctx.fillStyle = gapColor;
    ctx.fillRect(0, 0, totalW, totalH);

    // Step 4: Draw tiles
    ctx.imageSmoothingEnabled = false;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * (tileW + gap);
        const y = row * (tileH + gap);
        ctx.drawImage(frameCanvas, x, y, tileW, tileH);
      }
    }

    // Step 5: Seamless highlight overlay
    if (seamlessHighlight) {
      ctx.fillStyle = 'rgba(0, 255, 128, 0.25)';
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col * (tileW + gap);
          const y = row * (tileH + gap);

          // Highlight the 1-pixel border of each tile (at zoom scale)
          const borderWidth = Math.max(1, zoom);
          // Top edge
          ctx.fillRect(x, y, tileW, borderWidth);
          // Bottom edge
          ctx.fillRect(x, y + tileH - borderWidth, tileW, borderWidth);
          // Left edge
          ctx.fillRect(x, y, borderWidth, tileH);
          // Right edge
          ctx.fillRect(x + tileW - borderWidth, y, borderWidth, tileH);
        }
      }
    }

    dirtyRef.current = false;
  }, [canvasWidth, canvasHeight, parts, keyframes, currentFrame, backgroundColor,
      cols, rows, gap, gapColor, seamlessHighlight, zoom,
      effectTracks, motionBlurStrokes, effectStrokes, skeletons, proceduralAnimations, canvasModifierTracks]);

  // ---- Animation loop ----
  useEffect(() => {
    const tick = () => {
      if (dirtyRef.current) {
        renderTilePreview();
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [renderTilePreview]);

  // ---- Subscribe to frame changes ----
  useEffect(() => {
    const unsub = useProjectStore.subscribe((state, prevState) => {
      if (state.currentFrame !== prevState.currentFrame) {
        dirtyRef.current = true;
      }
      if (state.parts !== prevState.parts ||
          state.keyframes !== prevState.keyframes ||
          state.backgroundColor !== prevState.backgroundColor) {
        dirtyRef.current = true;
      }
    });
    return unsub;
  }, []);

  // ---- Zoom controls ----
  const handleZoomIn = useCallback(() => {
    updateTilePreview({ zoom: Math.min(8, zoom + 1) });
  }, [zoom, updateTilePreview]);

  const handleZoomOut = useCallback(() => {
    updateTilePreview({ zoom: Math.max(1, zoom - 1) });
  }, [zoom, updateTilePreview]);

  const handleZoomFit = useCallback(() => {
    if (containerSize.w === 0 || containerSize.h === 0) return;
    const tileW = canvasWidth;
    const tileH = canvasHeight;
    const totalW = cols * tileW + (cols - 1) * gap;
    const totalH = rows * tileH + (rows - 1) * gap;
    const zoomX = Math.floor(containerSize.w / totalW);
    const zoomY = Math.floor(containerSize.h / totalH);
    const fitZoom = Math.max(1, Math.min(8, Math.min(zoomX, zoomY)));
    updateTilePreview({ zoom: fitZoom });
  }, [containerSize, canvasWidth, canvasHeight, cols, rows, gap, updateTilePreview]);

  // ---- Calculate preview dimensions for scroll container ----
  const previewW = cols * canvasWidth * zoom + (cols - 1) * gap;
  const previewH = rows * canvasHeight * zoom + (rows - 1) * gap;

  return (
    <div className="flex flex-col h-full">
      {/* ---- Tile Settings Panel ---- */}
      <div className="shrink-0 p-3 border-b border-zinc-800 bg-[#0e0e1c] space-y-2.5">
        <div className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
          瓦片预览设置
        </div>

        {/* Cols × Rows */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 w-10 shrink-0">列×行</span>
          <Input
            type="number"
            min={1}
            max={8}
            value={cols}
            onChange={(e) => updateTilePreview({ cols: Math.max(1, Math.min(8, parseInt(e.target.value) || 1)) })}
            className="h-5 w-10 text-[10px] text-center bg-white/5 border-white/10 text-gray-300 px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[10px] text-zinc-600">×</span>
          <Input
            type="number"
            min={1}
            max={8}
            value={rows}
            onChange={(e) => updateTilePreview({ rows: Math.max(1, Math.min(8, parseInt(e.target.value) || 1)) })}
            className="h-5 w-10 text-[10px] text-center bg-white/5 border-white/10 text-gray-300 px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>

        {/* Gap size */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 w-10 shrink-0">间距</span>
          <Slider
            className="flex-1"
            value={[gap]}
            min={0}
            max={16}
            step={1}
            onValueChange={([v]) => updateTilePreview({ gap: v })}
          />
          <span className="text-[9px] text-zinc-500 w-8 text-right font-mono">{gap}px</span>
        </div>

        {/* Gap color */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 w-10 shrink-0">间隔色</span>
          <input
            type="color"
            value={gapColor}
            onChange={(e) => updateTilePreview({ gapColor: e.target.value })}
            className="w-6 h-5 rounded cursor-pointer border border-white/15 bg-transparent p-0"
          />
          <span className="text-[9px] text-zinc-500 font-mono">{gapColor}</span>
        </div>

        {/* Seamless highlight toggle */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 w-10 shrink-0">无缝</span>
          <button
            className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${
              seamlessHighlight
                ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-300'
                : 'bg-white/5 border-white/10 text-gray-400'
            }`}
            onClick={() => updateTilePreview({ seamlessHighlight: !seamlessHighlight })}
          >
            {seamlessHighlight ? '开启' : '关闭'}
          </button>
          <span className="text-[9px] text-zinc-600">边缘高亮</span>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1 pt-0.5">
          <span className="text-[10px] text-zinc-500 w-10 shrink-0">缩放</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 p-0 text-gray-400 hover:text-gray-200 hover:bg-white/5"
                onClick={handleZoomOut}
              >
                <ZoomOut className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">缩小</TooltipContent>
          </Tooltip>
          <span className="text-[10px] text-zinc-400 font-mono w-6 text-center">{zoom}×</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 p-0 text-gray-400 hover:text-gray-200 hover:bg-white/5"
                onClick={handleZoomIn}
              >
                <ZoomIn className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">放大</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 p-0 text-gray-400 hover:text-gray-200 hover:bg-white/5"
                onClick={handleZoomFit}
              >
                <Maximize className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">适应窗口</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ---- Tile Preview Canvas ---- */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-auto bg-[#0a0a16]"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#3f3f5a transparent',
        }}
      >
        <div
          className="flex items-center justify-center p-4"
          style={{
            minWidth: previewW + 32,
            minHeight: previewH + 32,
          }}
        >
          <canvas
            ref={previewCanvasRef}
            className="border border-zinc-800/50"
            style={{
              imageRendering: 'pixelated',
              width: previewW,
              height: previewH,
            }}
          />
        </div>
      </div>
    </div>
  );
}
