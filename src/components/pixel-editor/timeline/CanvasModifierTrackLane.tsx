'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Trash2, SkipForward } from 'lucide-react';
import type { CanvasModifierTrack, CanvasModifierKeyframe } from '@/lib/types';
import { FRAME_WIDTH as STATIC_FRAME_WIDTH, TRACK_HEIGHT, EFFECT_KEYFRAME_SIZE } from './constants';

const KF_COLOR = '#22d3ee';

// ---- Canvas Modifier Keyframe Marker（圆形，交互照特效轨标记 +
// 节点标记的指针拖拽：单击选中、双击跳帧编辑、拖动改帧、右键删除） ----
const CanvasModifierKeyframeMarker = React.memo(function CanvasModifierKeyframeMarker({
  keyframe,
  isSelected,
  totalFrames,
  siblingKeyframes,
  frameWidth,
  onSelect,
  onDelete,
  onEdit,
  onMove,
}: {
  keyframe: CanvasModifierKeyframe;
  isSelected: boolean;
  totalFrames: number;
  siblingKeyframes: CanvasModifierKeyframe[];
  frameWidth: number;
  onSelect: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onMove: (keyframeId: string, frame: number) => void;
}) {
  const fw = frameWidth;
  const [isDragging, setIsDragging] = useState(false);
  const [dragFrame, setDragFrame] = useState(keyframe.frame);
  const isDraggingRef = useRef(false);
  const dragFrameRef = useRef(keyframe.frame);
  const didDragRef = useRef(false);

  const displayFrame = isDragging ? dragFrame : keyframe.frame;
  const left = displayFrame * fw + fw / 2 - EFFECT_KEYFRAME_SIZE / 2;
  const top = TRACK_HEIGHT / 2 - EFFECT_KEYFRAME_SIZE / 2;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      isDraggingRef.current = true;
      didDragRef.current = false;
      setIsDragging(true);
      setDragFrame(keyframe.frame);
      dragFrameRef.current = keyframe.frame;
      onSelect();
    },
    [keyframe.frame, onSelect],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isDraggingRef.current) return;
      const trackLane = e.currentTarget.closest('[data-track-lane]');
      if (!trackLane) return;
      const rect = trackLane.getBoundingClientRect();
      let frame = Math.round((e.clientX - rect.left - fw / 2) / fw);
      frame = Math.max(0, Math.min(frame, totalFrames - 1));
      const hasCollision = siblingKeyframes.some(
        (kf) => kf.id !== keyframe.id && kf.frame === frame,
      );
      if (!hasCollision && frame !== dragFrameRef.current) {
        didDragRef.current = true;
        setDragFrame(frame);
        dragFrameRef.current = frame;
      }
    },
    [totalFrames, siblingKeyframes, keyframe.id, fw],
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
      const finalFrame = dragFrameRef.current;
      if (finalFrame !== keyframe.frame) {
        didDragRef.current = true;
        onMove(keyframe.id, finalFrame);
      }
    },
    [keyframe.id, keyframe.frame, onMove],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          data-kf-marker
          className={`absolute focus:outline-none group ${isDragging ? 'z-30' : 'z-20'}`}
          style={{
            left,
            top,
            width: EFFECT_KEYFRAME_SIZE,
            height: EFFECT_KEYFRAME_SIZE,
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
          onDoubleClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <span
            className="block w-full h-full rounded-full"
            style={{
              background: isDragging ? '#ffffff' : isSelected ? '#ffffff' : KF_COLOR,
              boxShadow: isDragging
                ? '0 0 8px rgba(34,211,238,0.8)'
                : isSelected
                  ? '0 0 6px rgba(255,255,255,0.5)'
                  : `0 0 3px ${KF_COLOR}40`,
              border: isSelected || isDragging ? '1.5px solid #ffffff' : '1px solid #06b6d4',
              transition: isDragging ? 'none' : 'all 0.1s',
            }}
          />
          <span className="absolute -inset-2" style={{ cursor: isDragging ? 'grabbing' : 'grab' }} />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onEdit}>
          <SkipForward className="size-4 mr-2 text-sky-400" />
          <span>跳到该帧编辑</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDelete} variant="destructive">
          <Trash2 className="size-4 mr-2" />
          <span>删除关键帧</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

// ---- Canvas Modifier Track Lane ----
export default function CanvasModifierTrackLane({
  track,
  totalFrames,
  currentFrame,
  frameWidth,
  onAddKeyframe,
  onDeleteKeyframe,
  onEditKeyframe,
  onMoveKeyframe,
}: {
  track: CanvasModifierTrack;
  totalFrames: number;
  currentFrame: number;
  frameWidth?: number;
  onAddKeyframe: (trackId: string, frame: number) => void;
  onDeleteKeyframe: (trackId: string, keyframeId: string) => void;
  onEditKeyframe: (trackId: string, keyframeId: string) => void;
  onMoveKeyframe: (trackId: string, keyframeId: string, frame: number) => void;
}) {
  const FRAME_WIDTH = frameWidth ?? STATIC_FRAME_WIDTH;
  const width = totalFrames * FRAME_WIDTH;
  const [selectedKfId, setSelectedKfId] = useState<string | null>(null);

  // 双击空白处加关键帧（照特效轨口径；点在标记上不触发）
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('[data-kf-marker]')) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const frame = Math.floor((e.clientX - rect.left) / FRAME_WIDTH);
      if (frame >= 0 && frame < totalFrames) {
        onAddKeyframe(track.id, frame);
      }
    },
    [track.id, totalFrames, onAddKeyframe, FRAME_WIDTH],
  );

  return (
    <div
      data-track-lane
      className="relative border-b border-[#1a1a2e]"
      style={{
        height: TRACK_HEIGHT,
        width,
        minWidth: width,
        background: track.enabled ? '#0d0d22' : '#09091a',
        opacity: track.enabled ? 1 : 0.5,
      }}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        width={width}
        height={TRACK_HEIGHT}
        className="absolute inset-0 pointer-events-none"
        style={{ minWidth: width }}
      >
        {Array.from({ length: totalFrames }, (_, i) => (
          <line key={i} x1={i * FRAME_WIDTH} y1={0} x2={i * FRAME_WIDTH} y2={TRACK_HEIGHT} stroke="#1a1a2e" strokeWidth={0.5} />
        ))}
        {track.keyframes.length > 1 &&
          track.keyframes.slice(0, -1).map((kf, i) => {
            const next = track.keyframes[i + 1];
            return (
              <line
                key={`cm-interp-${kf.id}`}
                x1={kf.frame * FRAME_WIDTH + FRAME_WIDTH / 2}
                y1={TRACK_HEIGHT / 2}
                x2={next.frame * FRAME_WIDTH + FRAME_WIDTH / 2}
                y2={TRACK_HEIGHT / 2}
                stroke="#22d3ee40"
                strokeWidth={2}
              />
            );
          })}
      </svg>

      {track.keyframes.map((kf) => (
        <CanvasModifierKeyframeMarker
          key={kf.id}
          keyframe={kf}
          isSelected={selectedKfId === kf.id}
          totalFrames={totalFrames}
          siblingKeyframes={track.keyframes}
          frameWidth={FRAME_WIDTH}
          onSelect={() => setSelectedKfId(kf.id)}
          onDelete={() => onDeleteKeyframe(track.id, kf.id)}
          onEdit={() => onEditKeyframe(track.id, kf.id)}
          onMove={(keyframeId, frame) => onMoveKeyframe(track.id, keyframeId, frame)}
        />
      ))}

      <div
        className="absolute top-0 bottom-0 w-px bg-cyan-400/30 pointer-events-none"
        style={{ left: currentFrame * FRAME_WIDTH + FRAME_WIDTH / 2 }}
      />
      <div className="absolute left-1 top-1/2 -translate-y-1/2 pointer-events-none">
        <span className="text-[9px] text-cyan-500/50 font-mono select-none">
          {track.type.replace('_', ' ')}
        </span>
      </div>
    </div>
  );
}
