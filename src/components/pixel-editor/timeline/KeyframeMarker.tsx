'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Plus, Trash2, SkipForward } from 'lucide-react';
import type { Keyframe, PuppetNodeKeyframe } from '@/lib/types';
import {
  FRAME_WIDTH,
  TRACK_HEIGHT,
  KEYFRAME_SIZE,
  EFFECT_KEYFRAME_SIZE,
  PUPPET_KEYFRAME_SIZE,
  PUPPET_COLOR,
} from './constants';

// ---- Keyframe Marker (HTML-based for ContextMenu support) ----
const KeyframeMarker = React.memo(function KeyframeMarker({
  keyframe,
  isSelected,
  onSelect,
  onDelete,
  onDuplicate,
  onMoveToFrame,
  totalFrames,
  siblingKeyframes,
  onUpdateKeyframe,
}: {
  keyframe: Keyframe;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveToFrame: () => void;
  totalFrames: number;
  siblingKeyframes: Keyframe[];
  onUpdateKeyframe: (id: string, updates: Partial<Keyframe>) => void;
}) {
  // ---- Drag state ----
  const [isDragging, setIsDragging] = useState(false);
  const [dragFrame, setDragFrame] = useState(keyframe.frame);
  // Refs for synchronous access in pointer handlers (avoids stale closures)
  const isDraggingRef = useRef(false);
  const dragFrameRef = useRef(keyframe.frame);
  const trackLaneRef = useRef<Element | null>(null);
  const didDragRef = useRef(false);

  // Use dragFrame for position while dragging, otherwise keyframe.frame
  const displayFrame = isDragging ? dragFrame : keyframe.frame;
  const left = displayFrame * FRAME_WIDTH + FRAME_WIDTH / 2 - KEYFRAME_SIZE / 2;
  const top = TRACK_HEIGHT / 2 - KEYFRAME_SIZE / 2;

  // ---- Pointer handlers for drag-to-move ----
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const trackLane = e.currentTarget.closest('[data-track-lane]');
      trackLaneRef.current = trackLane;
      isDraggingRef.current = true;
      didDragRef.current = false;
      setIsDragging(true);
      setDragFrame(keyframe.frame);
      dragFrameRef.current = keyframe.frame;
      onSelect();
    },
    [keyframe.frame, onSelect]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isDraggingRef.current) return;
      const trackLane = trackLaneRef.current;
      if (!trackLane) return;
      const rect = trackLane.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let frame = Math.round((x - FRAME_WIDTH / 2) / FRAME_WIDTH);
      frame = Math.max(0, Math.min(frame, totalFrames - 1));
      const hasCollision = siblingKeyframes.some(
        (kf) => kf.id !== keyframe.id && kf.frame === frame
      );
      if (!hasCollision && frame !== dragFrameRef.current) {
        didDragRef.current = true;
        setDragFrame(frame);
        dragFrameRef.current = frame;
      }
    },
    [totalFrames, siblingKeyframes, keyframe.id]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isDraggingRef.current) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer capture may already be released
      }
      isDraggingRef.current = false;
      setIsDragging(false);
      trackLaneRef.current = null;
      const finalFrame = dragFrameRef.current;
      if (finalFrame !== keyframe.frame) {
        didDragRef.current = true;
        onUpdateKeyframe(keyframe.id, { frame: finalFrame });
      }
    },
    [keyframe.id, keyframe.frame, onUpdateKeyframe]
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          className={`absolute focus:outline-none group ${isDragging ? 'z-30' : 'z-20'}`}
          style={{
            left,
            top,
            width: KEYFRAME_SIZE,
            height: KEYFRAME_SIZE,
            cursor: isDragging ? 'grabbing' : 'grab',
            touchAction: 'none',
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (didDragRef.current) {
              didDragRef.current = false;
              return;
            }
            onSelect();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <span
            className={`block w-full h-full rotate-45 rounded-[1px] ${
              isDragging ? 'scale-[1.4]' : ''
            }`}
            style={{
              background: isDragging ? '#fbbf24' : isSelected ? '#ffffff' : '#f59e0b',
              boxShadow: isDragging
                ? '0 0 10px rgba(251,191,36,0.7)'
                : isSelected
                  ? '0 0 6px rgba(255,255,255,0.5)'
                  : '0 0 3px rgba(245,158,11,0.3)',
              border: isDragging
                ? '1.5px solid #f59e0b'
                : isSelected
                  ? '1.5px solid #ffffff'
                  : '1px solid #d97706',
              transition: isDragging ? 'none' : 'all 0.1s',
            }}
          />
          {keyframe.interpolationMode === 'step' && (
            <span
              className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-red-400 border border-red-300"
              title="Step interpolation"
            />
          )}
          {keyframe.interpolationMode === 'bezier' && (
            <span
              className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-cyan-400 border border-cyan-300"
              title="Bezier interpolation"
            />
          )}
          <span
            className="absolute -inset-1.5"
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onDelete} variant="destructive">
          <Trash2 className="size-4 mr-2" />
          <span>Delete Keyframe</span>
          <span className="ml-auto text-xs text-gray-500">Del</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={onDuplicate}>
          <Plus className="size-4 mr-2 text-amber-400" />
          <span>Duplicate</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onMoveToFrame}>
          <SkipForward className="size-4 mr-2 text-sky-400" />
          <span>Move to Frame...</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onUpdateKeyframe(keyframe.id, { interpolationMode: 'linear' })}>
          <span className="text-xs">Interpolation: Linear</span>
          {(!keyframe.interpolationMode || keyframe.interpolationMode === 'linear') && (
            <span className="ml-auto text-xs text-emerald-400">✓</span>
          )}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onUpdateKeyframe(keyframe.id, { interpolationMode: 'bezier' })}>
          <span className="text-xs">Interpolation: Bezier</span>
          {keyframe.interpolationMode === 'bezier' && (
            <span className="ml-auto text-xs text-emerald-400">✓</span>
          )}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onUpdateKeyframe(keyframe.id, { interpolationMode: 'step' })}>
          <span className="text-xs">Interpolation: Step</span>
          {keyframe.interpolationMode === 'step' && (
            <span className="ml-auto text-xs text-emerald-400">✓</span>
          )}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}, (prevProps, nextProps) => {
  if (prevProps.keyframe.id !== nextProps.keyframe.id) return false;
  if (prevProps.keyframe.frame !== nextProps.keyframe.frame) return false;
  if (prevProps.isSelected !== nextProps.isSelected) return false;
  if (prevProps.totalFrames !== nextProps.totalFrames) return false;
  if (prevProps.keyframe !== nextProps.keyframe) {
    if (prevProps.keyframe.interpolationMode !== nextProps.keyframe.interpolationMode) return false;
  }
  return true;
});

export default KeyframeMarker;

// ---- Effect Keyframe Marker (circle shape) ----
export const EffectKeyframeMarker = React.memo(function EffectKeyframeMarker({
  keyframe,
  effectColor,
  isSelected,
  onSelect,
  onDelete,
  onEditParams,
}: {
  keyframe: { id: string; frame: number };
  effectColor: string;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onEditParams: () => void;
}) {
  const left = keyframe.frame * FRAME_WIDTH + FRAME_WIDTH / 2 - EFFECT_KEYFRAME_SIZE / 2;
  const top = TRACK_HEIGHT / 2 - EFFECT_KEYFRAME_SIZE / 2;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          className="absolute z-20 focus:outline-none group"
          style={{ left, top, width: EFFECT_KEYFRAME_SIZE, height: EFFECT_KEYFRAME_SIZE }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onEditParams();
          }}
        >
          <span
            className="block w-full h-full rounded-full transition-all duration-100"
            style={{
              background: isSelected ? '#ffffff' : effectColor,
              boxShadow: isSelected
                ? `0 0 6px rgba(255,255,255,0.5)`
                : `0 0 3px ${effectColor}40`,
              border: isSelected
                ? '1.5px solid #ffffff'
                : `1px solid ${effectColor}`,
            }}
          />
          <span
            className="absolute -inset-2"
            style={{ cursor: 'pointer' }}
          />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onEditParams}>
          <span className="size-3 mr-2 rounded-full" style={{ backgroundColor: effectColor }} />
          <span>Edit Params</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={onDelete} variant="destructive">
          <Trash2 className="size-4 mr-2" />
          <span>Delete Keyframe</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}, (prevProps, nextProps) => {
  if (prevProps.keyframe.id !== nextProps.keyframe.id) return false;
  if (prevProps.keyframe.frame !== nextProps.keyframe.frame) return false;
  if (prevProps.effectColor !== nextProps.effectColor) return false;
  if (prevProps.isSelected !== nextProps.isSelected) return false;
  return true;
});

// ---- Puppet Keyframe Marker (teal/cyan diamond) ----
export const PuppetKeyframeMarker = React.memo(function PuppetKeyframeMarker({
  keyframe,
  isSelected,
  onSelect,
  onDelete,
  onMoveToFrame,
  totalFrames,
  siblingKeyframes,
  onUpdatePuppetKeyframe,
}: {
  keyframe: PuppetNodeKeyframe;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onMoveToFrame: () => void;
  totalFrames: number;
  siblingKeyframes: PuppetNodeKeyframe[];
  onUpdatePuppetKeyframe: (id: string, updates: Partial<PuppetNodeKeyframe>) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragFrame, setDragFrame] = useState(keyframe.frame);
  const isDraggingRef = useRef(false);
  const dragFrameRef = useRef(keyframe.frame);
  const trackLaneRef = useRef<Element | null>(null);
  const didDragRef = useRef(false);

  const displayFrame = isDragging ? dragFrame : keyframe.frame;
  const left = displayFrame * FRAME_WIDTH + FRAME_WIDTH / 2 - PUPPET_KEYFRAME_SIZE / 2;
  const top = TRACK_HEIGHT / 2 - PUPPET_KEYFRAME_SIZE / 2;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const trackLane = e.currentTarget.closest('[data-track-lane]');
      trackLaneRef.current = trackLane;
      isDraggingRef.current = true;
      didDragRef.current = false;
      setIsDragging(true);
      setDragFrame(keyframe.frame);
      dragFrameRef.current = keyframe.frame;
      onSelect();
    },
    [keyframe.frame, onSelect]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isDraggingRef.current) return;
      const trackLane = trackLaneRef.current;
      if (!trackLane) return;
      const rect = trackLane.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let frame = Math.round((x - FRAME_WIDTH / 2) / FRAME_WIDTH);
      frame = Math.max(0, Math.min(frame, totalFrames - 1));
      const hasCollision = siblingKeyframes.some(
        (kf) => kf.id !== keyframe.id && kf.frame === frame
      );
      if (!hasCollision && frame !== dragFrameRef.current) {
        didDragRef.current = true;
        setDragFrame(frame);
        dragFrameRef.current = frame;
      }
    },
    [totalFrames, siblingKeyframes, keyframe.id]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isDraggingRef.current) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer capture may already be released
      }
      isDraggingRef.current = false;
      setIsDragging(false);
      trackLaneRef.current = null;
      const finalFrame = dragFrameRef.current;
      if (finalFrame !== keyframe.frame) {
        didDragRef.current = true;
        onUpdatePuppetKeyframe(keyframe.id, { frame: finalFrame });
      }
    },
    [keyframe.id, keyframe.frame, onUpdatePuppetKeyframe]
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          className={`absolute focus:outline-none group ${isDragging ? 'z-30' : 'z-20'}`}
          style={{
            left,
            top,
            width: PUPPET_KEYFRAME_SIZE,
            height: PUPPET_KEYFRAME_SIZE,
            cursor: isDragging ? 'grabbing' : 'grab',
            touchAction: 'none',
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (didDragRef.current) {
              didDragRef.current = false;
              return;
            }
            onSelect();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <span
            className={`block w-full h-full rotate-45 rounded-[1px] ${
              isDragging ? 'scale-[1.4]' : ''
            }`}
            style={{
              background: isDragging ? '#22d3ee' : isSelected ? '#ffffff' : PUPPET_COLOR,
              boxShadow: isDragging
                ? '0 0 10px rgba(6,182,212,0.7)'
                : isSelected
                  ? '0 0 6px rgba(255,255,255,0.5)'
                  : '0 0 3px rgba(6,182,212,0.3)',
              border: isDragging
                ? '1.5px solid #06b6d4'
                : isSelected
                  ? '1.5px solid #ffffff'
                  : '1px solid #0891b2',
              transition: isDragging ? 'none' : 'all 0.1s',
            }}
          />
          <span
            className="absolute -inset-1.5"
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onDelete} variant="destructive">
          <Trash2 className="size-4 mr-2" />
          <span>Delete Puppet Keyframe</span>
          <span className="ml-auto text-xs text-gray-500">Del</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onMoveToFrame}>
          <SkipForward className="size-4 mr-2 text-sky-400" />
          <span>Move to Frame...</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}, (prevProps, nextProps) => {
  if (prevProps.keyframe.id !== nextProps.keyframe.id) return false;
  if (prevProps.keyframe.frame !== nextProps.keyframe.frame) return false;
  if (prevProps.isSelected !== nextProps.isSelected) return false;
  if (prevProps.totalFrames !== nextProps.totalFrames) return false;
  return true;
});
