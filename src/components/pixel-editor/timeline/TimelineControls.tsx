'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Play, Pause, Square, SkipBack, SkipForward, Diamond, Trash2,
} from 'lucide-react';
import type { InterpolationMode } from '@/lib/types';

// ---- Top Controls Bar ----
export default function TimelineControls({
  playState,
  currentFrame,
  totalFrames,
  frameRate,
  isEditingFps,
  isEditingFrames,
  displayFps,
  displayFrames,
  selectedKeyframeId,
  selectedKfInterpolationMode,
  onPlay,
  onStop,
  onStepBack,
  onStepForward,
  onFpsInput,
  onFpsSubmit,
  onFramesInput,
  onFramesSubmit,
  onAddKeyframe,
  onDeleteKeyframe,
  onInterpolationChange,
  onEditFpsStart,
  onEditFramesStart,
  onEditFpsCancel,
  onEditFramesCancel,
  frameDisplayRef,
}: {
  playState: string;
  currentFrame: number;
  totalFrames: number;
  frameRate: number;
  isEditingFps: boolean;
  isEditingFrames: boolean;
  displayFps: string;
  displayFrames: string;
  selectedKeyframeId: string | null;
  selectedKfInterpolationMode?: InterpolationMode;
  onPlay: () => void;
  onStop: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onFpsInput: (val: string) => void;
  onFpsSubmit: () => void;
  onFramesInput: (val: string) => void;
  onFramesSubmit: () => void;
  onAddKeyframe: () => void;
  onDeleteKeyframe: () => void;
  onInterpolationChange: (mode: InterpolationMode) => void;
  onEditFpsStart: () => void;
  onEditFramesStart: () => void;
  onEditFpsCancel: () => void;
  onEditFramesCancel: () => void;
  frameDisplayRef: React.RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 shrink-0"
      style={{ background: '#111128', borderBottom: '1px solid #1e1e3a' }}
    >
      {/* Playback controls */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 text-gray-300 hover:text-white hover:bg-white/10" onClick={onStop}>
              <Square className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Stop (Home)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 text-gray-300 hover:text-white hover:bg-white/10" onClick={onStepBack}>
              <SkipBack className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Step Back (←)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`size-8 rounded-full transition-colors ${
                playState === 'playing'
                  ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 hover:text-amber-300'
                  : 'text-gray-300 hover:text-white hover:bg-white/10'
              }`}
              onClick={onPlay}
            >
              {playState === 'playing' ? <Pause className="size-4" /> : <Play className="size-4 ml-0.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{playState === 'playing' ? 'Pause (Space)' : 'Play (Space)'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 text-gray-300 hover:text-white hover:bg-white/10" onClick={onStepForward}>
              <SkipForward className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Step Forward (→)</TooltipContent>
        </Tooltip>
      </div>

      <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

      {/* Current frame display */}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-gray-500">Frame</span>
        <span ref={frameDisplayRef} className="font-mono text-amber-400 min-w-[2ch] text-center">{currentFrame}</span>
        <span className="text-gray-600">/</span>
        <span className="font-mono text-gray-400 min-w-[2ch] text-center">{totalFrames - 1}</span>
      </div>

      <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

      {/* FPS */}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-gray-500">FPS</span>
        {isEditingFps ? (
          <Input
            value={displayFps}
            onChange={(e) => onFpsInput(e.target.value)}
            onBlur={onFpsSubmit}
            onKeyDown={(e) => { if (e.key === 'Enter') onFpsSubmit(); if (e.key === 'Escape') onEditFpsCancel(); }}
            className="h-5 w-12 text-xs font-mono px-1 py-0 bg-[#1a1a30] border-[#3a3a5a] text-white"
            autoFocus min={1} max={120} type="number"
          />
        ) : (
          <button
            className="font-mono text-emerald-400 hover:text-emerald-300 hover:bg-white/5 px-1 rounded transition-colors cursor-pointer"
            onClick={onEditFpsStart}
            title="Click to edit FPS"
          >
            {frameRate}
          </button>
        )}
      </div>

      <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

      {/* Total Frames */}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-gray-500">Total</span>
        {isEditingFrames ? (
          <Input
            value={displayFrames}
            onChange={(e) => onFramesInput(e.target.value)}
            onBlur={onFramesSubmit}
            onKeyDown={(e) => { if (e.key === 'Enter') onFramesSubmit(); if (e.key === 'Escape') onEditFramesCancel(); }}
            className="h-5 w-14 text-xs font-mono px-1 py-0 bg-[#1a1a30] border-[#3a3a5a] text-white"
            autoFocus min={1} max={9999} type="number"
          />
        ) : (
          <button
            className="font-mono text-sky-400 hover:text-sky-300 hover:bg-white/5 px-1 rounded transition-colors cursor-pointer"
            onClick={onEditFramesStart}
            title="Click to edit total frames"
          >
            {totalFrames}
          </button>
        )}
      </div>

      <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

      {/* Add keyframe button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10" onClick={onAddKeyframe}>
            <Diamond className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Add keyframe at current frame</TooltipContent>
      </Tooltip>

      {/* Delete keyframe button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`size-7 ${selectedKeyframeId ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10' : 'text-gray-600 cursor-not-allowed'}`}
            disabled={!selectedKeyframeId}
            onClick={onDeleteKeyframe}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Delete selected keyframe (Del)</TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      {/* Interpolation mode selector */}
      {selectedKeyframeId && selectedKfInterpolationMode !== undefined && (
        <div className="flex items-center gap-1 text-xs">
          <span className="text-gray-500">Interp</span>
          <select
            value={selectedKfInterpolationMode ?? 'linear'}
            onChange={(e) => onInterpolationChange(e.target.value as InterpolationMode)}
            className="h-5 text-[10px] bg-[#1a1a30] border-[#3a3a5a] text-gray-300 rounded px-1 py-0 cursor-pointer"
          >
            <option value="linear">Linear</option>
            <option value="bezier">Bezier</option>
            <option value="step">Step</option>
          </select>
        </div>
      )}

      {/* Duration display */}
      <div className="text-xs text-gray-500 font-mono">
        {(totalFrames / frameRate).toFixed(1)}s
      </div>
    </div>
  );
}
