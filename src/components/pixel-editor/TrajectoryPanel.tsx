'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Route,
  Trash2,
  Eye,
  EyeOff,
  Play,
  Ghost,
  CircleDot,
  ChevronDown,
  ChevronRight,
  Zap,
  Settings,
} from 'lucide-react';

import { useProjectStore, useEditorStore } from '@/lib/store';
import type { TrajectoryPoint, TrajectoryCurvePoint, AfterimageConfig } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

// ============================================================
// TrajectoryPanel - Panel for trajectory editing and visualization
// ============================================================

/** Mini trajectory preview canvas */
function TrajectoryMiniPreview({
  points,
  width = 240,
  height = 80,
}: {
  points: TrajectoryPoint[];
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Redraw when points change
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#0a0a16';
    ctx.fillRect(0, 0, width, height);

    if (points.length === 0) {
      ctx.fillStyle = '#333';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No trajectory data', width / 2, height / 2 + 3);
      return;
    }

    // Find bounds
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const pt of points) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const padding = 12;
    const drawW = width - padding * 2;
    const drawH = height - padding * 2;
    const scale = Math.min(drawW / rangeX, drawH / rangeY);

    const toScreen = (x: number, y: number) => ({
      sx: padding + ((x - minX) * scale) + (drawW - rangeX * scale) / 2,
      sy: padding + ((y - minY) * scale) + (drawH - rangeY * scale) / 2,
    });

    // Draw path
    if (points.length >= 2) {
      ctx.strokeStyle = '#00ffaa';
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      const start = toScreen(points[0].x, points[0].y);
      ctx.moveTo(start.sx, start.sy);
      for (let i = 1; i < points.length; i++) {
        const pt = toScreen(points[i].x, points[i].y);
        ctx.lineTo(pt.sx, pt.sy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Draw points
    for (let i = 0; i < points.length; i++) {
      const { sx, sy } = toScreen(points[i].x, points[i].y);
      ctx.fillStyle = i === 0 ? '#00ff88' : i === points.length - 1 ? '#ff6644' : '#00ddcc';
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [points, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="rounded border border-zinc-800 bg-[#0a0a16]"
      style={{ width, height }}
    />
  );
}

// ---- Empty State ----

function EmptyTrajectoryState({ onRecord }: { onRecord: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="size-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
        <Route className="size-5 text-zinc-500" />
      </div>
      <p className="text-xs text-zinc-400 mb-1">No trajectory data</p>
      <p className="text-[11px] text-zinc-500 mb-4">
        Record trajectory from keyframes to visualize the motion path
      </p>
      <Button
        size="sm"
        variant="outline"
        className="text-xs h-7 border-zinc-700 text-zinc-300 hover:text-zinc-100"
        onClick={onRecord}
      >
        <Route className="size-3 mr-1" />
        Record Trajectory
      </Button>
    </div>
  );
}

// ---- No Part Selected ----

function NoPartSelectedState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="size-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
        <CircleDot className="size-5 text-zinc-500" />
      </div>
      <p className="text-xs text-zinc-400 mb-1">No part selected</p>
      <p className="text-[11px] text-zinc-500">
        Select a part to manage its trajectory
      </p>
    </div>
  );
}

// ---- Trajectory Point Row ----

function TrajectoryPointRow({
  point,
  onUpdate,
  isSelected,
  onSelect,
}: {
  point: TrajectoryCurvePoint;
  onUpdate: (frame: number, updates: Partial<Omit<TrajectoryCurvePoint, 'frame'>>) => void;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState({
    x: point.x,
    y: point.y,
    rotation: point.rotation,
  });

  const handleStartEdit = useCallback(() => {
    setEditValues({ x: point.x, y: point.y, rotation: point.rotation });
    setIsEditing(true);
  }, [point]);

  const handleSave = useCallback(() => {
    onUpdate(point.frame, {
      x: editValues.x,
      y: editValues.y,
      rotation: editValues.rotation,
    });
    setIsEditing(false);
  }, [point.frame, editValues, onUpdate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSave();
      if (e.key === 'Escape') setIsEditing(false);
    },
    [handleSave],
  );

  return (
    <div
      onClick={onSelect}
      className={`
        flex items-center gap-2 px-2 py-1.5 rounded text-[11px] cursor-pointer transition-colors
        ${isSelected
          ? 'bg-emerald-500/10 border border-emerald-500/30'
          : 'hover:bg-zinc-800/50 border border-transparent'
        }
      `}
    >
      {/* Frame number */}
      <Badge
        variant="secondary"
        className="text-[9px] px-1.5 py-0 h-4 bg-zinc-700 text-zinc-300 shrink-0 font-mono"
      >
        F{point.frame}
      </Badge>

      {isEditing ? (
        <>
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <span className="text-zinc-500 shrink-0">X</span>
            <Input
              type="number"
              value={editValues.x}
              onChange={(e) => setEditValues((v) => ({ ...v, x: Number(e.target.value) }))}
              onKeyDown={handleKeyDown}
              className="h-5 w-14 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1 py-0"
              autoFocus
            />
            <span className="text-zinc-500 shrink-0">Y</span>
            <Input
              type="number"
              value={editValues.y}
              onChange={(e) => setEditValues((v) => ({ ...v, y: Number(e.target.value) }))}
              onKeyDown={handleKeyDown}
              className="h-5 w-14 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1 py-0"
            />
            <span className="text-zinc-500 shrink-0">R</span>
            <Input
              type="number"
              value={editValues.rotation}
              onChange={(e) => setEditValues((v) => ({ ...v, rotation: Number(e.target.value) }))}
              onKeyDown={handleKeyDown}
              className="h-5 w-12 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1 py-0"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[9px] text-emerald-400 px-1"
            onClick={(e) => { e.stopPropagation(); handleSave(); }}
          >
            Save
          </Button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 flex-1 min-w-0" onDoubleClick={handleStartEdit}>
            <span className="text-zinc-400 font-mono">
              ({point.x}, {point.y})
            </span>
            {Math.abs(point.rotation) > 0.1 && (
              <span className="text-amber-400/70 font-mono">
                {Math.round(point.rotation)}°
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-4 p-0 text-zinc-600 hover:text-zinc-400 shrink-0 opacity-0 group-hover:opacity-100"
            onClick={(e) => { e.stopPropagation(); handleStartEdit(); }}
          >
            <Settings className="size-2.5" />
          </Button>
        </>
      )}
    </div>
  );
}

// ---- Main TrajectoryPanel Component ----

export default function TrajectoryPanel() {
  const {
    keyframes,
    currentFrame,
    trajectories,
    autoRecordTrajectory,
    clearTrajectory,
    toggleTrajectoryVisibility,
    updateTrajectoryPoint,
    generateTweenFromTrajectory,
    generateAfterimageSequence,
  } = useProjectStore();

  const {
    selectedPartId,
    showTrajectories,
    editMode,
    setEditMode,
    toggleTrajectories,
  } = useEditorStore();

  const { setCurrentFrame } = useProjectStore();

  // ---- State ----
  const [selectedPointFrame, setSelectedPointFrame] = useState<number | null>(null);
  const [tweenStartFrame, setTweenStartFrame] = useState(0);
  const [tweenEndFrame, setTweenEndFrame] = useState(12);
  const [tweenStep, setTweenStep] = useState(1);
  const [afterimageCount, setAfterimageCount] = useState(3);
  const [afterimageOpacityDecay, setAfterimageOpacityDecay] = useState(0.3);
  const [afterimageSpacing, setAfterimageSpacing] = useState(5);
  const [showTweenControls, setShowTweenControls] = useState(false);
  const [showAfterimageControls, setShowAfterimageControls] = useState(false);

  // ---- Derived ----
  const trajectory = useMemo(
    () => trajectories.find((t) => t.partId === selectedPartId),
    [trajectories, selectedPartId],
  );

  const hasKeyframes = useMemo(
    () => keyframes.some((k) => k.partId === selectedPartId),
    [keyframes, selectedPartId],
  );

  // ---- Handlers ----
  const handleRecord = useCallback(() => {
    if (!selectedPartId) return;
    autoRecordTrajectory(selectedPartId);
    // Also enable trajectory display
    if (!showTrajectories) {
      toggleTrajectories();
    }
  }, [selectedPartId, autoRecordTrajectory, showTrajectories, toggleTrajectories]);

  const handleClear = useCallback(() => {
    if (!selectedPartId) return;
    clearTrajectory(selectedPartId);
  }, [selectedPartId, clearTrajectory]);

  const handleToggleVisibility = useCallback(() => {
    if (!selectedPartId) return;
    toggleTrajectoryVisibility(selectedPartId);
  }, [selectedPartId, toggleTrajectoryVisibility]);

  const handleToggleShow = useCallback(() => {
    toggleTrajectories();
  }, [toggleTrajectories]);

  const handlePointUpdate = useCallback(
    (frame: number, updates: Partial<Omit<TrajectoryCurvePoint, 'frame'>>) => {
      if (!selectedPartId) return;
      updateTrajectoryPoint(selectedPartId, frame, updates);
    },
    [selectedPartId, updateTrajectoryPoint],
  );

  const handleGenerateTween = useCallback(() => {
    if (!selectedPartId || !trajectory || trajectory.points.length < 2) return;
    generateTweenFromTrajectory(selectedPartId, tweenStartFrame, tweenEndFrame, tweenStep);
  }, [selectedPartId, trajectory, tweenStartFrame, tweenEndFrame, tweenStep, generateTweenFromTrajectory]);

  const handleGenerateAfterimage = useCallback(() => {
    if (!selectedPartId || !trajectory || trajectory.points.length < 2) return;
    const config: AfterimageConfig = {
      count: afterimageCount,
      opacityDecay: afterimageOpacityDecay,
      spacing: afterimageSpacing,
    };
    generateAfterimageSequence(selectedPartId, config);
  }, [selectedPartId, trajectory, afterimageCount, afterimageOpacityDecay, afterimageSpacing, generateAfterimageSequence]);

  const handleEditToggle = useCallback(() => {
    if (editMode === 'trajectory_edit') {
      setEditMode('normal');
    } else {
      setEditMode('trajectory_edit');
      // Also enable trajectory display
      if (!showTrajectories) {
        toggleTrajectories();
      }
    }
  }, [editMode, setEditMode, showTrajectories, toggleTrajectories]);

  // ---- Render ----
  if (!selectedPartId) {
    return (
      <div className="flex flex-col h-full bg-zinc-950" style={{ width: 280 }}>
        <div className="px-3 py-2.5 border-b border-zinc-800 shrink-0">
          <h3 className="text-xs font-semibold text-zinc-200 tracking-wide">轨迹</h3>
        </div>
        <NoPartSelectedState />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950" style={{ width: 280 }}>
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <h3 className="text-xs font-semibold text-zinc-200 tracking-wide">轨迹</h3>
        <div className="flex items-center gap-1">
          {/* Show/hide trajectories toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`size-6 p-0 ${
                  showTrajectories
                    ? 'text-emerald-400 bg-emerald-400/10'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
                onClick={handleToggleShow}
              >
                <Eye className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              {showTrajectories ? '隐藏轨迹' : '显示轨迹'}
            </TooltipContent>
          </Tooltip>

          {/* Trajectory edit mode toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`size-6 p-0 ${
                  editMode === 'trajectory_edit'
                    ? 'text-purple-400 bg-purple-400/10'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
                onClick={handleEditToggle}
              >
                <Route className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              {editMode === 'trajectory_edit' ? '退出轨迹编辑' : '轨迹编辑模式'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Edit mode indicator */}
      {editMode === 'trajectory_edit' && (
        <div className="px-3 py-2 bg-purple-500/10 border-b border-purple-500/20 flex items-center gap-2 shrink-0">
          <Route className="size-3.5 text-purple-400" />
          <span className="text-[11px] text-purple-400 font-medium">轨迹编辑模式</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-5 text-[10px] text-purple-400/70 hover:text-purple-300 px-1.5"
            onClick={() => setEditMode('normal')}
          >
            退出
          </Button>
        </div>
      )}

      {/* Action buttons */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-[11px] border-zinc-700 text-emerald-400 hover:text-emerald-300 hover:border-emerald-500/30"
          onClick={handleRecord}
          disabled={!hasKeyframes}
        >
          <Route className="size-3 mr-1" />
          录制
        </Button>

        {trajectory && trajectory.points.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 p-0 text-zinc-500 hover:text-zinc-300"
            onClick={handleToggleVisibility}
          >
            {trajectory.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="size-7 p-0 text-zinc-500 hover:text-red-400"
          onClick={handleClear}
          disabled={!trajectory || trajectory.points.length === 0}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      {/* Mini preview */}
      {trajectory && trajectory.points.length > 0 && (
        <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
          <TrajectoryMiniPreview points={trajectory.points} />
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] text-zinc-500">
              {trajectory.points.length} points
            </span>
            <Badge
              variant="secondary"
              className={`text-[9px] px-1.5 py-0 h-4 ${
                trajectory.visible
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : 'bg-zinc-700 text-zinc-400'
              }`}
            >
              {trajectory.visible ? 'Visible' : 'Hidden'}
            </Badge>
          </div>
        </div>
      )}

      {/* Point list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-0.5">
          {!trajectory || trajectory.points.length === 0 ? (
            <EmptyTrajectoryState onRecord={handleRecord} />
          ) : (
            trajectory.points.map((pt) => (
              <TrajectoryPointRow
                key={pt.frame}
                point={pt}
                onUpdate={handlePointUpdate}
                isSelected={selectedPointFrame === pt.frame}
                onSelect={() => {
                  setSelectedPointFrame(pt.frame);
                  setCurrentFrame(pt.frame);
                }}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Tween / Afterimage controls */}
      {trajectory && trajectory.points.length >= 2 && (
        <div className="border-t border-zinc-800 shrink-0">
          {/* Tween controls */}
          <div className="px-3 py-1.5">
            <button
              className="flex items-center gap-1.5 w-full text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
              onClick={() => setShowTweenControls(!showTweenControls)}
            >
              {showTweenControls ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              <Zap className="size-3 text-amber-400" />
              自动补间
            </button>

            {showTweenControls && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 w-8 shrink-0">起始帧</span>
                  <Input
                    type="number"
                    value={tweenStartFrame}
                    onChange={(e) => setTweenStartFrame(Number(e.target.value))}
                    className="h-5 flex-1 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5 py-0"
                  />
                  <span className="text-[10px] text-zinc-500 w-8 shrink-0">结束帧</span>
                  <Input
                    type="number"
                    value={tweenEndFrame}
                    onChange={(e) => setTweenEndFrame(Number(e.target.value))}
                    className="h-5 flex-1 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5 py-0"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 shrink-0">步长</span>
                  <Slider
                    className="flex-1"
                    value={[tweenStep]}
                    min={1}
                    max={6}
                    step={1}
                    onValueChange={([v]) => setTweenStep(v)}
                  />
                  <span className="text-[10px] text-zinc-400 w-4 text-center">{tweenStep}</span>
                </div>
                <Button
                  size="sm"
                  className="w-full h-6 text-[10px] bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 border border-amber-500/30"
                  variant="outline"
                  onClick={handleGenerateTween}
                >
                  <Zap className="size-3 mr-1" />
                  生成补间关键帧
                </Button>
              </div>
            )}
          </div>

          <Separator className="bg-zinc-800" />

          {/* Afterimage controls */}
          <div className="px-3 py-1.5">
            <button
              className="flex items-center gap-1.5 w-full text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
              onClick={() => setShowAfterimageControls(!showAfterimageControls)}
            >
              {showAfterimageControls ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              <Ghost className="size-3 text-violet-400" />
              残影序列
            </button>

            {showAfterimageControls && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 w-10 shrink-0">副本数</span>
                  <Slider
                    className="flex-1"
                    value={[afterimageCount]}
                    min={1}
                    max={10}
                    step={1}
                    onValueChange={([v]) => setAfterimageCount(v)}
                  />
                  <span className="text-[10px] text-zinc-400 w-4 text-center">{afterimageCount}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 w-10 shrink-0">衰减</span>
                  <Slider
                    className="flex-1"
                    value={[afterimageOpacityDecay]}
                    min={0.05}
                    max={1}
                    step={0.05}
                    onValueChange={([v]) => setAfterimageOpacityDecay(v)}
                  />
                  <span className="text-[10px] text-zinc-400 w-6 text-center">
                    {afterimageOpacityDecay.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 w-10 shrink-0">间距</span>
                  <Slider
                    className="flex-1"
                    value={[afterimageSpacing]}
                    min={1}
                    max={30}
                    step={1}
                    onValueChange={([v]) => setAfterimageSpacing(v)}
                  />
                  <span className="text-[10px] text-zinc-400 w-4 text-center">{afterimageSpacing}</span>
                </div>
                <Button
                  size="sm"
                  className="w-full h-6 text-[10px] bg-violet-600/20 text-violet-400 hover:bg-violet-600/30 border border-violet-500/30"
                  variant="outline"
                  onClick={handleGenerateAfterimage}
                >
                  <Ghost className="size-3 mr-1" />
                  生成残影序列
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
