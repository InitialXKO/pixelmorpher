'use client';

import React, { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Grid3x3,
  Spline,
  Bone,
  Paintbrush,
  Eye,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';

// ============================================================
// View Controls - Zoom, Grid, Toggles, etc.
// ============================================================

// ---- Zoom Controls ----
export function ZoomControls() {
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const canvasWidth = useProjectStore((s) => s.canvasWidth);
  const canvasHeight = useProjectStore((s) => s.canvasHeight);

  const handleZoomIn = useCallback(() => {
    setZoom(Math.min(32, zoom + 1));
  }, [zoom, setZoom]);

  const handleZoomOut = useCallback(() => {
    setZoom(Math.max(1, zoom - 1));
  }, [zoom, setZoom]);

  const handleZoomFit = useCallback(() => {
    const viewportWidth = window.innerWidth - 40;
    const viewportHeight = window.innerHeight - 120;
    const zoomX = Math.floor(viewportWidth / canvasWidth);
    const zoomY = Math.floor(viewportHeight / canvasHeight);
    const fitZoom = Math.max(1, Math.min(32, Math.min(zoomX, zoomY)));
    setZoom(fitZoom);
  }, [canvasWidth, canvasHeight, setZoom]);

  return (
    <div className="flex items-center gap-0.5 mx-1 shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-400 hover:bg-white/5 hover:text-gray-200"
            onClick={handleZoomOut}
          >
            <ZoomOut className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">Zoom Out</TooltipContent>
      </Tooltip>

      <span className="text-[10px] text-gray-500 w-9 text-center font-mono">
        {Math.round(zoom * 100)}%
      </span>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-400 hover:bg-white/5 hover:text-gray-200"
            onClick={handleZoomIn}
          >
            <ZoomIn className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">Zoom In</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-400 hover:bg-white/5 hover:text-gray-200"
            onClick={handleZoomFit}
          >
            <Maximize className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">Fit to View</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ---- Grid Toggle ----
export function GridToggle() {
  const showGrid = useEditorStore((s) => s.showGrid);
  const toggleGrid = useEditorStore((s) => s.toggleGrid);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          pressed={showGrid}
          onPressedChange={toggleGrid}
          aria-label="Toggle Grid"
          className="h-7 w-7 p-0 data-[state=on]:bg-purple-600/30 data-[state=on]:text-purple-300 text-gray-500 hover:bg-white/5 hover:text-gray-200 rounded"
        >
          <Grid3x3 className="size-3.5" />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">Toggle Grid</TooltipContent>
    </Tooltip>
  );
}

// ---- Trajectory Toggle ----
export function TrajectoryToggle() {
  const showTrajectories = useEditorStore((s) => s.showTrajectories);
  const toggleTrajectories = useEditorStore((s) => s.toggleTrajectories);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          pressed={showTrajectories}
          onPressedChange={toggleTrajectories}
          aria-label="Toggle Trajectories"
          className="h-7 w-7 p-0 data-[state=on]:bg-emerald-600/30 data-[state=on]:text-emerald-300 text-gray-500 hover:bg-white/5 hover:text-gray-200 rounded"
        >
          <Spline className="size-3.5" />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">Toggle Trajectories</TooltipContent>
    </Tooltip>
  );
}

// ---- Trajectory Snap Toggle ----
export function TrajectorySnapToggle() {
  const trajectorySnap = useEditorStore((s) => s.trajectorySnap);
  const setTrajectorySnap = useEditorStore((s) => s.setTrajectorySnap);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          pressed={trajectorySnap}
          onPressedChange={setTrajectorySnap}
          aria-label="Trajectory Snap"
          className="h-7 w-7 p-0 data-[state=on]:bg-cyan-600/30 data-[state=on]:text-cyan-300 text-gray-500 hover:bg-white/5 hover:text-gray-200 rounded"
        >
          <Grid3x3 className="size-3.5" />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">Trajectory Snap to Pixels</TooltipContent>
    </Tooltip>
  );
}

// ---- Skeletons Toggle ----
export function SkeletonsToggle() {
  const showSkeletons = useEditorStore((s) => s.showSkeletons);
  const toggleSkeletons = useEditorStore((s) => s.toggleSkeletons);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          pressed={showSkeletons}
          onPressedChange={toggleSkeletons}
          aria-label="显示骨骼"
          className="h-7 w-7 p-0 data-[state=on]:bg-orange-600/30 data-[state=on]:text-orange-300 text-gray-500 hover:bg-white/5 hover:text-gray-200 rounded"
        >
          <Bone className="size-3.5" />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">显示骨骼</TooltipContent>
    </Tooltip>
  );
}

// ---- Weight Paint Toggle ----
export function WeightPaintToggle() {
  const showWeightPaint = useEditorStore((s) => s.showWeightPaint);
  const toggleWeightPaint = useEditorStore((s) => s.toggleWeightPaint);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          pressed={showWeightPaint}
          onPressedChange={toggleWeightPaint}
          aria-label="权重绘制"
          className="h-7 w-7 p-0 data-[state=on]:bg-orange-600/30 data-[state=on]:text-orange-300 text-gray-500 hover:bg-white/5 hover:text-gray-200 rounded"
        >
          <Paintbrush className="size-3.5" />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">权重绘制</TooltipContent>
    </Tooltip>
  );
}

// ---- Onion Skin Toggle ----
export function OnionSkinToggle() {
  const showOnionSkin = useEditorStore((s) => s.showOnionSkin);
  const toggleEditorOnionSkin = useEditorStore((s) => s.toggleOnionSkin);
  const onionSkinEnabled = useProjectStore((s) => s.onionSkinEnabled);
  const onionSkinFrames = useProjectStore((s) => s.onionSkinFrames);
  const toggleProjectOnionSkin = useProjectStore((s) => s.toggleOnionSkin);
  const setOnionSkinFrames = useProjectStore((s) => s.setOnionSkinFrames);

  const handleOnionSkinToggle = useCallback(() => {
    toggleProjectOnionSkin();
    toggleEditorOnionSkin();
  }, [toggleProjectOnionSkin, toggleEditorOnionSkin]);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Toggle
              pressed={showOnionSkin || onionSkinEnabled}
              onPressedChange={handleOnionSkinToggle}
              aria-label="Toggle Onion Skin"
              className="h-7 w-7 p-0 data-[state=on]:bg-purple-600/30 data-[state=on]:text-purple-300 text-gray-500 hover:bg-white/5 hover:text-gray-200 rounded"
            >
              <Eye className="size-3.5" />
            </Toggle>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">Onion Skin</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-48 bg-[#1a1a2e] border-white/10 text-gray-200" side="bottom">
        <div className="space-y-3">
          <div className="text-xs font-medium text-gray-300">Onion Skin Settings</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Frames:</span>
            <Input
              type="number"
              min={1}
              max={10}
              value={onionSkinFrames}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) setOnionSkinFrames(Math.max(1, Math.min(10, val)));
              }}
              className="h-6 w-12 text-xs text-center bg-white/5 border-white/10 text-gray-300 px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---- Preview Quality Select ----
export function PreviewQualitySelect() {
  const previewQuality = useEditorStore((s) => s.previewQuality);
  const setPreviewQuality = useEditorStore((s) => s.setPreviewQuality);

  return (
    <div className="flex items-center gap-1 mx-1 shrink-0">
      <span className="text-[10px] text-gray-500 uppercase tracking-wide">画质</span>
      <Select
        value={previewQuality}
        onValueChange={(v) => setPreviewQuality(v as 'low' | 'medium' | 'high')}
      >
        <SelectTrigger className="h-6 w-16 text-[9px] bg-white/5 border-white/10 text-gray-300 px-1.5 py-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
          <SelectItem value="high" className="text-[10px]">高画质</SelectItem>
          <SelectItem value="medium" className="text-[10px]">中画质</SelectItem>
          <SelectItem value="low" className="text-[10px]">低画质</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
