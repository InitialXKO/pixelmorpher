'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useProjectStore } from '@/lib/store';
import type { PartAnimationModifier } from '@/lib/types';
import { MODIFIER_DEFINITIONS } from '@/lib/types';
import { FRAME_WIDTH as STATIC_FRAME_WIDTH, SUB_TRACK_HEIGHT, CATEGORY_COLOR_MAP } from './constants';

// ---- Modifier Sub-Track Lane ----
// Renders an animation modifier's effective range as a colored bar within the timeline
const ModifierSubTrackLane = React.memo(function ModifierSubTrackLane({
  modifier,
  totalFrames,
  partId,
  onEditParams,
  frameWidth,
}: {
  modifier: PartAnimationModifier;
  totalFrames: number;
  partId: string;
  onEditParams: (partId: string, modifierId: string) => void;
  frameWidth?: number;
}) {
  const { updatePartAnimationModifierRange } = useProjectStore();
  const FRAME_WIDTH = frameWidth ?? STATIC_FRAME_WIDTH;
  const width = totalFrames * FRAME_WIDTH;
  const def = MODIFIER_DEFINITIONS.find((d) => d.type === modifier.type);

  // Compute effective range
  const startFrame = modifier.startFrame >= 0 ? modifier.startFrame : 0;
  const endFrame = modifier.endFrame >= 0 ? modifier.endFrame : totalFrames - 1;
  const rangeStartX = startFrame * FRAME_WIDTH;
  const rangeEndX = (endFrame + 1) * FRAME_WIDTH;
  const rangeWidth = rangeEndX - rangeStartX;

  const category = def?.category ?? 'animation';
  const color = CATEGORY_COLOR_MAP[category] ?? '#8b5cf6';

  // ---- Range handle drag state ----
  const [draggingEdge, setDraggingEdge] = useState<'start' | 'end' | null>(null);
  const [dragFrame, setDragFrame] = useState(startFrame);
  const draggingEdgeRef = useRef<'start' | 'end' | null>(null);
  const dragFrameRef = useRef(startFrame);
  const trackLaneRef = useRef<HTMLDivElement | null>(null);
  const didDragRef = useRef(false);

  const handleStartPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const trackLane = e.currentTarget.closest('[data-track-lane]');
      trackLaneRef.current = trackLane as HTMLDivElement | null;
      draggingEdgeRef.current = 'start';
      didDragRef.current = false;
      setDraggingEdge('start');
      setDragFrame(startFrame);
      dragFrameRef.current = startFrame;
    },
    [startFrame]
  );

  const handleEndPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const trackLane = e.currentTarget.closest('[data-track-lane]');
      trackLaneRef.current = trackLane as HTMLDivElement | null;
      draggingEdgeRef.current = 'end';
      didDragRef.current = false;
      setDraggingEdge('end');
      setDragFrame(endFrame);
      dragFrameRef.current = endFrame;
    },
    [endFrame]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingEdgeRef.current) return;
      const trackLane = trackLaneRef.current;
      if (!trackLane) return;
      const rect = trackLane.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let frame = Math.round((x - FRAME_WIDTH / 2) / FRAME_WIDTH);
      frame = Math.max(0, Math.min(frame, totalFrames - 1));
      if (draggingEdgeRef.current === 'start') {
        frame = Math.min(frame, endFrame - 1);
      } else {
        frame = Math.max(frame, startFrame + 1);
      }
      if (frame !== dragFrameRef.current) {
        didDragRef.current = true;
        setDragFrame(frame);
        dragFrameRef.current = frame;
      }
    },
    [totalFrames, startFrame, endFrame]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingEdgeRef.current) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch { /* already released */ }
      const edge = draggingEdgeRef.current;
      const finalFrame = dragFrameRef.current;
      draggingEdgeRef.current = null;
      setDraggingEdge(null);
      trackLaneRef.current = null;
      if (didDragRef.current && edge === 'start' && finalFrame !== startFrame) {
        updatePartAnimationModifierRange(partId, modifier.id, { startFrame: finalFrame });
      } else if (didDragRef.current && edge === 'end' && finalFrame !== endFrame) {
        updatePartAnimationModifierRange(partId, modifier.id, { endFrame: finalFrame });
      }
    },
    [partId, modifier.id, startFrame, endFrame, updatePartAnimationModifierRange]
  );

  // Compute display range while dragging
  const displayStartFrame = draggingEdge === 'start' ? dragFrame : startFrame;
  const displayEndFrame = draggingEdge === 'end' ? dragFrame : endFrame;
  const displayRangeStartX = displayStartFrame * FRAME_WIDTH;
  const displayRangeEndX = (displayEndFrame + 1) * FRAME_WIDTH;
  const displayRangeWidth = displayRangeEndX - displayRangeStartX;

  return (
    <div
      data-track-lane
      className="relative border-b border-[#1a1a2e]"
      style={{
        height: SUB_TRACK_HEIGHT,
        width,
        minWidth: width,
        background: '#0c0c1e',
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            repeating-linear-gradient(
              90deg,
              rgba(26, 26, 46, 0.8) 0px,
              rgba(26, 26, 46, 0.8) 0.5px,
              transparent 0.5px,
              transparent ${FRAME_WIDTH}px
            )
          `,
          backgroundSize: `${FRAME_WIDTH}px ${SUB_TRACK_HEIGHT}px`,
        }}
      />

      <svg
        width={width}
        height={SUB_TRACK_HEIGHT}
        className="absolute inset-0 pointer-events-none"
        style={{ minWidth: width }}
      >
        {modifier.enabled && displayRangeWidth > 0 && (
          <>
            {(modifier.fadeInFrames > 0 && draggingEdge === null) && (
              <defs>
                <linearGradient id={`fadein-${modifier.id}`}>
                  <stop offset="0%" stopColor={color} stopOpacity={0.1} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.5} />
                </linearGradient>
              </defs>
            )}
            <rect
              x={displayRangeStartX}
              y={3}
              width={displayRangeWidth}
              height={SUB_TRACK_HEIGHT - 6}
              rx={2}
              fill={color}
              opacity={draggingEdge ? 0.5 : 0.35}
            />
            {modifier.fadeInFrames > 0 && draggingEdge === null && (
              <rect
                x={displayRangeStartX}
                y={3}
                width={Math.min(modifier.fadeInFrames * FRAME_WIDTH, displayRangeWidth)}
                height={SUB_TRACK_HEIGHT - 6}
                rx={2}
                fill={`url(#fadein-${modifier.id})`}
              />
            )}
            {modifier.fadeOutFrames > 0 && draggingEdge === null && (
              <>
                <defs>
                  <linearGradient id={`fadeout-${modifier.id}`}>
                    <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <rect
                  x={displayRangeEndX - Math.min(modifier.fadeOutFrames * FRAME_WIDTH, displayRangeWidth)}
                  y={3}
                  width={Math.min(modifier.fadeOutFrames * FRAME_WIDTH, displayRangeWidth)}
                  height={SUB_TRACK_HEIGHT - 6}
                  rx={2}
                  fill={`url(#fadeout-${modifier.id})`}
                />
              </>
            )}
            <rect
              x={displayRangeStartX}
              y={3}
              width={displayRangeWidth}
              height={SUB_TRACK_HEIGHT - 6}
              rx={2}
              fill="none"
              stroke={color}
              strokeWidth={draggingEdge ? 1.5 : 0.5}
              opacity={draggingEdge ? 1 : 0.6}
            />
            {draggingEdge && (
              <text
                x={draggingEdge === 'start' ? displayRangeStartX + 2 : displayRangeEndX - 20}
                y={SUB_TRACK_HEIGHT / 2 + 3}
                fill="#ffffff"
                fontSize={8}
                fontFamily="monospace"
                opacity={0.9}
              >
                {draggingEdge === 'start' ? displayStartFrame : displayEndFrame}
              </text>
            )}
          </>
        )}
        {!modifier.enabled && (
          <line
            x1={rangeStartX}
            y1={SUB_TRACK_HEIGHT / 2}
            x2={rangeEndX}
            y2={SUB_TRACK_HEIGHT / 2}
            stroke="#4b5563"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.5}
          />
        )}
      </svg>

      {modifier.enabled && displayRangeWidth > 0 && (
        <div
          className="absolute top-0 bottom-0 cursor-pointer hover:bg-white/5 transition-colors z-10"
          style={{
            left: displayRangeStartX + 6,
            width: Math.max(0, displayRangeWidth - 12),
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (!didDragRef.current) {
              onEditParams(partId, modifier.id);
            }
          }}
        />
      )}

      {modifier.enabled && displayRangeWidth > 0 && (
        <div
          className="absolute top-0 bottom-0 cursor-ew-resize z-20 hover:bg-white/10 transition-colors group"
          style={{ left: displayRangeStartX, width: 6 }}
          onPointerDown={handleStartPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div
            className="absolute top-0.5 bottom-0.5 left-0.5 w-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ backgroundColor: color }}
          />
        </div>
      )}

      {modifier.enabled && displayRangeWidth > 0 && (
        <div
          className="absolute top-0 bottom-0 cursor-ew-resize z-20 hover:bg-white/10 transition-colors group"
          style={{ left: displayRangeEndX - 6, width: 6 }}
          onPointerDown={handleEndPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div
            className="absolute top-0.5 bottom-0.5 right-0.5 w-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ backgroundColor: color }}
          />
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  if (prevProps.modifier.id !== nextProps.modifier.id) return false;
  if (prevProps.modifier.enabled !== nextProps.modifier.enabled) return false;
  if (prevProps.modifier.startFrame !== nextProps.modifier.startFrame) return false;
  if (prevProps.modifier.endFrame !== nextProps.modifier.endFrame) return false;
  if (prevProps.totalFrames !== nextProps.totalFrames) return false;
  if (prevProps.partId !== nextProps.partId) return false;
  return true;
});

export default ModifierSubTrackLane;
