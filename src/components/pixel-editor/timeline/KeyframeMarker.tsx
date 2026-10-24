'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Trash2, SkipForward, Copy } from 'lucide-react';
import {
  DEFAULT_FRAME_WIDTH,
  TRACK_HEIGHT,
  EFFECT_KEYFRAME_SIZE,
  PUPPET_KEYFRAME_SIZE,
  PUPPET_COLOR,
} from './constants';



// ---- Effect Keyframe Marker (circle shape) ----
export const EffectKeyframeMarker = React.memo(function EffectKeyframeMarker({
  keyframe,
  effectColor,
  isSelected,
  onSelect,
  onDelete,
  onEditParams,
  frameWidth,
}: {
  keyframe: { id: string; frame: number };
  effectColor: string;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onEditParams: () => void;
  frameWidth?: number;
}) {
  const fw = frameWidth ?? DEFAULT_FRAME_WIDTH;
  const left = keyframe.frame * fw + fw / 2 - EFFECT_KEYFRAME_SIZE / 2;
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
export const NodeKeyframeMarker = React.memo(function NodeKeyframeMarker({
  keyframe,
  isSelected,
  onSelect,
  onDelete,
  onDuplicate,
  onMoveToFrame,
  totalFrames,
  siblingKeyframes,
  onUpdateNodeKeyframe,
  frameWidth,
  snapConfig,
  snapFrame,
}: {
  /** 轨道帧键：id 为合成键 `${nodeId}@${frame}`，frame 为该帧位 */
  keyframe: { id: string; frame: number };
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveToFrame: () => void;
  totalFrames: number;
  siblingKeyframes: { id: string; frame: number }[];
  onUpdateNodeKeyframe: (id: string, updates: { frame?: number }) => void;
  frameWidth?: number;
  snapConfig?: import('@/lib/v15-types').SnapConfig;
  snapFrame?: (rawFrame: number, excludeKeyframeId?: string) => number;
}) {
  const fw = frameWidth ?? DEFAULT_FRAME_WIDTH;
  const [isDragging, setIsDragging] = useState(false);
  const [dragFrame, setDragFrame] = useState(keyframe.frame);
  const isDraggingRef = useRef(false);
  const dragFrameRef = useRef(keyframe.frame);
  const trackLaneRef = useRef<Element | null>(null);
  const didDragRef = useRef(false);

  const displayFrame = isDragging ? dragFrame : keyframe.frame;
  const left = displayFrame * fw + fw / 2 - PUPPET_KEYFRAME_SIZE / 2;
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
      let frame = Math.round((x - fw / 2) / fw);
      frame = Math.max(0, Math.min(frame, totalFrames - 1));
      // 吸附：优先用 snapFrame prop（全 store 吸附），没有则回退到同轨道检查
      if (snapFrame && snapConfig?.enabled) {
        frame = snapFrame(frame, keyframe.id);
      }
      const hasCollision = siblingKeyframes.some(
        (kf) => kf.id !== keyframe.id && kf.frame === frame
      );
      if (!hasCollision && frame !== dragFrameRef.current) {
        didDragRef.current = true;
        setDragFrame(frame);
        dragFrameRef.current = frame;
      }
    },
    [totalFrames, siblingKeyframes, keyframe.id, fw, snapConfig, snapFrame]
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
        onUpdateNodeKeyframe(keyframe.id, { frame: finalFrame });
      }
    },
    [keyframe.id, keyframe.frame, onUpdateNodeKeyframe]
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
        <ContextMenuItem onClick={onDuplicate}>
          <Copy className="size-4 mr-2 text-emerald-400" />
          <span>Duplicate Keyframe</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
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
  if (prevProps.frameWidth !== nextProps.frameWidth) return false;
  if (prevProps.snapConfig !== nextProps.snapConfig) return false;
  return true;
});