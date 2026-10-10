'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Trash2 } from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type { Keyframe, ModifierType, ModifierInstance, ModifierParamKeyframe, ModifierParamValue } from '@/lib/types';
import { MODIFIER_DEFINITIONS } from '@/lib/types';
import { FRAME_WIDTH as STATIC_FRAME_WIDTH, SUB_TRACK_HEIGHT, CATEGORY_COLOR_MAP } from './constants';

// ---- Keyframe Modifier Sub-Track Lane ----
const KeyframeModifierSubTrackLane = React.memo(function KeyframeModifierSubTrackLane({
  modifierType,
  partKeyframes,
  totalFrames,
  onAddParamKeyframe,
  onEditModifierParams,
  onEditParamKeyframe,
  frameWidth,
}: {
  modifierType: ModifierType;
  partKeyframes: Keyframe[];
  totalFrames: number;
  onAddParamKeyframe: (keyframeId: string, modifierId: string, frame: number) => void;
  onEditModifierParams: (keyframeId: string, modifierId: string) => void;
  onEditParamKeyframe: (keyframeId: string, modifierId: string, paramKfId: string) => void;
  frameWidth?: number;
}) {
  const { updateModifierRange, removeModifierParamKeyframe, updateModifierParamKeyframe } = useProjectStore();
  const FRAME_WIDTH = frameWidth ?? STATIC_FRAME_WIDTH;
  const width = totalFrames * FRAME_WIDTH;
  const def = MODIFIER_DEFINITIONS.find((d) => d.type === modifierType);

  const category = def?.category ?? 'transform';
  const color = CATEGORY_COLOR_MAP[category] ?? '#3b82f6';

  // Collect all modifier instances of this type across all keyframes of this part
  const modifierEntries = useMemo(() => {
    const entries: { keyframeId: string; modifier: ModifierInstance; paramKeyframes: ModifierParamKeyframe[] }[] = [];
    for (const kf of partKeyframes) {
      const mod = kf.modifiers.find((m) => m.type === modifierType);
      if (mod) {
        entries.push({
          keyframeId: kf.id,
          modifier: mod,
          paramKeyframes: mod.paramKeyframes ?? [],
        });
      }
    }
    return entries;
  }, [partKeyframes, modifierType]);

  // Collect all param keyframes
  const allParamKeyframes = useMemo(() => {
    const pkfs: { frame: number; keyframeId: string; modifierId: string; pkf: ModifierParamKeyframe }[] = [];
    for (const entry of modifierEntries) {
      for (const pkf of entry.paramKeyframes) {
        pkfs.push({ frame: pkf.frame, keyframeId: entry.keyframeId, modifierId: entry.modifier.id, pkf });
      }
    }
    return pkfs.sort((a, b) => a.frame - b.frame);
  }, [modifierEntries]);

  // Compute effective range
  const rangeStart = useMemo(() => {
    if (modifierEntries.length === 0) return 0;
    return Math.min(...modifierEntries.map((e) => e.modifier.startFrame >= 0 ? e.modifier.startFrame : 0));
  }, [modifierEntries]);
  const rangeEnd = useMemo(() => {
    if (modifierEntries.length === 0) return totalFrames - 1;
    return Math.max(...modifierEntries.map((e) => e.modifier.endFrame >= 0 ? e.modifier.endFrame : totalFrames - 1));
  }, [modifierEntries, totalFrames]);
  const fadeInFrames = useMemo(() => {
    const startEntry = modifierEntries.find((e) => (e.modifier.startFrame >= 0 ? e.modifier.startFrame : 0) === rangeStart);
    return startEntry?.modifier.fadeInFrames ?? 0;
  }, [modifierEntries, rangeStart]);
  const fadeOutFrames = useMemo(() => {
    const endEntry = modifierEntries.find((e) => (e.modifier.endFrame >= 0 ? e.modifier.endFrame : totalFrames - 1) === rangeEnd);
    return endEntry?.modifier.fadeOutFrames ?? 0;
  }, [modifierEntries, rangeEnd, totalFrames]);
  const rangeStartX = rangeStart * FRAME_WIDTH;
  const rangeEndX = (rangeEnd + 1) * FRAME_WIDTH;
  const rangeWidth = rangeEndX - rangeStartX;

  // ---- Range handle drag state ----
  const [draggingEdge, setDraggingEdge] = useState<'start' | 'end' | null>(null);
  const [dragFrame, setDragFrame] = useState(rangeStart);
  const draggingEdgeRef = useRef<'start' | 'end' | null>(null);
  const dragFrameRef = useRef(rangeStart);
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
      setDragFrame(rangeStart);
      dragFrameRef.current = rangeStart;
    },
    [rangeStart]
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
      setDragFrame(rangeEnd);
      dragFrameRef.current = rangeEnd;
    },
    [rangeEnd]
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
        frame = Math.min(frame, rangeEnd - 1);
      } else {
        frame = Math.max(frame, rangeStart + 1);
      }
      if (frame !== dragFrameRef.current) {
        didDragRef.current = true;
        setDragFrame(frame);
        dragFrameRef.current = frame;
      }
    },
    [totalFrames, rangeStart, rangeEnd]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingEdgeRef.current) return;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      const edge = draggingEdgeRef.current;
      const finalFrame = dragFrameRef.current;
      draggingEdgeRef.current = null;
      setDraggingEdge(null);
      trackLaneRef.current = null;
      if (didDragRef.current) {
        for (const entry of modifierEntries) {
          if (edge === 'start' && finalFrame !== rangeStart) {
            updateModifierRange(entry.keyframeId, entry.modifier.id, { startFrame: finalFrame });
          } else if (edge === 'end' && finalFrame !== rangeEnd) {
            updateModifierRange(entry.keyframeId, entry.modifier.id, { endFrame: finalFrame });
          }
        }
      }
    },
    [modifierEntries, rangeStart, rangeEnd, updateModifierRange]
  );

  const displayRangeStart = draggingEdge === 'start' ? dragFrame : rangeStart;
  const displayRangeEnd = draggingEdge === 'end' ? dragFrame : rangeEnd;
  const displayRangeStartX = displayRangeStart * FRAME_WIDTH;
  const displayRangeEndX = (displayRangeEnd + 1) * FRAME_WIDTH;
  const displayRangeWidth = displayRangeEndX - displayRangeStartX;

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frame = Math.floor(x / FRAME_WIDTH);
      if (frame >= 0 && frame < totalFrames && modifierEntries.length > 0) {
        const inRange = modifierEntries.some(
          (entry) => frame >= (entry.modifier.startFrame >= 0 ? entry.modifier.startFrame : 0) &&
                     frame <= (entry.modifier.endFrame >= 0 ? entry.modifier.endFrame : totalFrames - 1)
        );
        if (!inRange) return;
        const exactKf = partKeyframes.find((kf) => kf.frame === frame);
        if (exactKf) {
          const mod = exactKf.modifiers.find((m) => m.type === modifierType);
          if (mod) { onAddParamKeyframe(exactKf.id, mod.id, frame); return; }
        }
        let closestEntry: { keyframeId: string; modifier: ModifierInstance } | null = null;
        let closestDist = Infinity;
        for (const entry of modifierEntries) {
          const kf = partKeyframes.find((k) => k.id === entry.keyframeId);
          if (!kf) continue;
          const dist = Math.abs(kf.frame - frame);
          if (dist < closestDist) { closestDist = dist; closestEntry = entry; }
        }
        if (closestEntry) { onAddParamKeyframe(closestEntry.keyframeId, closestEntry.modifier.id, frame); }
      }
    },
    [totalFrames, modifierEntries, partKeyframes, modifierType, onAddParamKeyframe]
  );

  const anyEnabled = modifierEntries.some((e) => e.modifier.enabled);

  // ---- Param keyframe drag state ----
  const [draggingPkfId, setDraggingPkfId] = useState<string | null>(null);
  const [dragPkfFrame, setDragPkfFrame] = useState(0);
  const dragPkfRef = useRef<{ pkfId: string; keyframeId: string; modifierId: string; origFrame: number } | null>(null);
  const dragPkfFrameRef = useRef(0);
  const didDragPkfRef = useRef(false);

  const handlePkfPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, pkfId: string, keyframeId: string, modifierId: string, origFrame: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragPkfRef.current = { pkfId, keyframeId, modifierId, origFrame };
      dragPkfFrameRef.current = origFrame;
      didDragPkfRef.current = false;
      setDraggingPkfId(pkfId);
      setDragPkfFrame(origFrame);
    }, []
  );

  const handlePkfPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const ref = dragPkfRef.current;
      if (!ref) return;
      const trackLane = (e.currentTarget as HTMLElement).closest('[data-track-lane]');
      if (!trackLane) return;
      const rect = trackLane.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let frame = Math.floor(x / FRAME_WIDTH);
      frame = Math.max(0, Math.min(frame, totalFrames - 1));
      if (frame !== dragPkfFrameRef.current) {
        didDragPkfRef.current = true;
        setDragPkfFrame(frame);
        dragPkfFrameRef.current = frame;
      }
    },
    [totalFrames]
  );

  const handlePkfPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const ref = dragPkfRef.current;
      if (!ref) return;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (didDragPkfRef.current && dragPkfFrameRef.current !== ref.origFrame) {
        updateModifierParamKeyframe(ref.keyframeId, ref.modifierId, ref.pkfId, { __frame: dragPkfFrameRef.current } as Record<string, ModifierParamValue>);
      }
      dragPkfRef.current = null;
      setDraggingPkfId(null);
      didDragPkfRef.current = false;
    },
    [updateModifierParamKeyframe]
  );

  return (
    <div
      data-track-lane
      className="relative border-b border-[#1a1a2e] cursor-pointer"
      style={{ height: SUB_TRACK_HEIGHT, width, minWidth: width, background: '#0c0c1e' }}
      onDoubleClick={handleDoubleClick}
    >
      <svg width={width} height={SUB_TRACK_HEIGHT} className="absolute inset-0 pointer-events-none" style={{ minWidth: width }}>
        {Array.from({ length: totalFrames }, (_, i) => (
          <line key={i} x1={i * FRAME_WIDTH} y1={0} x2={i * FRAME_WIDTH} y2={SUB_TRACK_HEIGHT} stroke="#1a1a2e" strokeWidth={0.5} />
        ))}
        {anyEnabled && displayRangeWidth > 0 && (
          <>
            {fadeInFrames > 0 && draggingEdge === null && (
              <defs><linearGradient id={`kf-fadein-${modifierType}`}><stop offset="0%" stopColor={color} stopOpacity={0.05} /><stop offset="100%" stopColor={color} stopOpacity={0.3} /></linearGradient></defs>
            )}
            {fadeOutFrames > 0 && draggingEdge === null && (
              <defs><linearGradient id={`kf-fadeout-${modifierType}`}><stop offset="0%" stopColor={color} stopOpacity={0.3} /><stop offset="100%" stopColor={color} stopOpacity={0.05} /></linearGradient></defs>
            )}
            <rect x={displayRangeStartX} y={3} width={displayRangeWidth} height={SUB_TRACK_HEIGHT - 6} rx={2} fill={color} opacity={draggingEdge ? 0.35 : 0.2} />
            {fadeInFrames > 0 && draggingEdge === null && (
              <rect x={displayRangeStartX} y={3} width={Math.min(fadeInFrames * FRAME_WIDTH, displayRangeWidth)} height={SUB_TRACK_HEIGHT - 6} rx={2} fill={`url(#kf-fadein-${modifierType})`} />
            )}
            {fadeOutFrames > 0 && draggingEdge === null && (
              <rect x={displayRangeEndX - Math.min(fadeOutFrames * FRAME_WIDTH, displayRangeWidth)} y={3} width={Math.min(fadeOutFrames * FRAME_WIDTH, displayRangeWidth)} height={SUB_TRACK_HEIGHT - 6} rx={2} fill={`url(#kf-fadeout-${modifierType})`} />
            )}
            <rect x={displayRangeStartX} y={3} width={displayRangeWidth} height={SUB_TRACK_HEIGHT - 6} rx={2} fill="none" stroke={color} strokeWidth={draggingEdge ? 1.5 : 0.5} opacity={draggingEdge ? 1 : 0.4} />
            {allParamKeyframes.length >= 2 && allParamKeyframes.map((pkf, idx) => {
              if (idx === 0) return null;
              const prevPkf = allParamKeyframes[idx - 1];
              return (
                <line key={`interp-${pkf.pkf.id}`}
                  x1={prevPkf.frame * FRAME_WIDTH + FRAME_WIDTH / 2} y1={SUB_TRACK_HEIGHT / 2}
                  x2={pkf.frame * FRAME_WIDTH + FRAME_WIDTH / 2} y2={SUB_TRACK_HEIGHT / 2}
                  stroke={color} strokeWidth={1.5} opacity={0.35} strokeDasharray="2 2"
                />
              );
            })}
            {draggingEdge && (
              <text x={draggingEdge === 'start' ? displayRangeStartX + 2 : displayRangeEndX - 20} y={SUB_TRACK_HEIGHT / 2 + 3} fill="#ffffff" fontSize={8} fontFamily="monospace" opacity={0.9}>
                {draggingEdge === 'start' ? displayRangeStart : displayRangeEnd}
              </text>
            )}
          </>
        )}
        {modifierEntries.map((entry) => {
          const kf = partKeyframes.find((k) => k.id === entry.keyframeId);
          if (!kf) return null;
          const cx = kf.frame * FRAME_WIDTH + FRAME_WIDTH / 2;
          const cy = SUB_TRACK_HEIGHT / 2;
          const hasBrushCommands = modifierType === 'pixel_edit' &&
            Array.isArray((entry.modifier.params as Record<string, unknown>)?.brushCommands) &&
            ((entry.modifier.params as Record<string, unknown>).brushCommands as unknown[]).length > 0;
          if (hasBrushCommands) {
            return (
              <g key={entry.keyframeId}>
                <rect x={cx - 3} y={cy - 3} width={6} height={6} rx={1} fill={anyEnabled ? color : '#4b5563'} opacity={0.7} />
                <line x1={cx - 2} y1={cy + 2} x2={cx + 2} y2={cy - 2} stroke={anyEnabled ? '#ffffff' : '#6b7280'} strokeWidth={1} opacity={0.8} />
              </g>
            );
          }
          return <circle key={entry.keyframeId} cx={cx} cy={cy} r={3} fill={anyEnabled ? color : '#4b5563'} opacity={0.6} />;
        })}
        {!anyEnabled && rangeWidth > 0 && (
          <line x1={rangeStartX} y1={SUB_TRACK_HEIGHT / 2} x2={rangeEndX} y2={SUB_TRACK_HEIGHT / 2} stroke="#4b5563" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
        )}
      </svg>

      {/* HTML-based param keyframe markers */}
      {allParamKeyframes.map(({ frame, keyframeId, modifierId, pkf }) => {
        const displayFrame = draggingPkfId === pkf.id ? dragPkfFrame : frame;
        const left = displayFrame * FRAME_WIDTH + FRAME_WIDTH / 2 - 4;
        const top = SUB_TRACK_HEIGHT / 2 - 4;
        return (
          <ContextMenu key={pkf.id}>
            <ContextMenuTrigger asChild>
              <button
                className="absolute z-20 focus:outline-none group"
                style={{ left, top, width: 8, height: 8, cursor: draggingPkfId === pkf.id ? 'grabbing' : 'grab' }}
                onClick={(e) => { e.stopPropagation(); if (!didDragPkfRef.current) onEditModifierParams(keyframeId, modifierId); }}
                onDoubleClick={(e) => { e.stopPropagation(); onEditParamKeyframe(keyframeId, modifierId, pkf.id); }}
                onPointerDown={(e) => handlePkfPointerDown(e, pkf.id, keyframeId, modifierId, frame)}
                onPointerMove={handlePkfPointerMove}
                onPointerUp={handlePkfPointerUp}
              >
                <span
                  className="block w-full h-full rotate-45 rounded-[1px] transition-all duration-100"
                  style={{
                    background: anyEnabled ? '#ffffff' : '#6b7280',
                    border: anyEnabled ? `1px solid ${color}` : '1px solid #4b5563',
                    boxShadow: anyEnabled ? `0 0 3px ${color}40` : 'none',
                    transform: draggingPkfId === pkf.id ? 'rotate(45deg) scale(1.3)' : 'rotate(45deg)',
                  }}
                />
                <span className="absolute -inset-1.5" style={{ cursor: draggingPkfId === pkf.id ? 'grabbing' : 'grab' }} />
                {draggingPkfId === pkf.id && (
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-mono text-white bg-black/70 px-1 rounded pointer-events-none whitespace-nowrap">
                    {dragPkfFrame}
                  </span>
                )}
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
              <ContextMenuItem onClick={() => onEditModifierParams(keyframeId, modifierId)}>
                <span className="text-xs">编辑参数</span>
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onEditParamKeyframe(keyframeId, modifierId, pkf.id)}>
                <span className="text-xs">编辑关键帧参数</span>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={() => removeModifierParamKeyframe(keyframeId, modifierId, pkf.id)}>
                <Trash2 className="size-4 mr-2" />
                <span className="text-xs">删除参数关键帧</span>
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}

      {/* Range handles */}
      {anyEnabled && displayRangeWidth > 0 && (
        <div
          className="absolute top-0 bottom-0 cursor-ew-resize z-20 hover:bg-white/10 transition-colors group"
          style={{ left: displayRangeStartX, width: 6 }}
          onPointerDown={handleStartPointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
        >
          <div className="absolute top-0.5 bottom-0.5 left-0.5 w-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: color }} />
        </div>
      )}
      {anyEnabled && displayRangeWidth > 0 && (
        <div
          className="absolute top-0 bottom-0 cursor-ew-resize z-20 hover:bg-white/10 transition-colors group"
          style={{ left: displayRangeEndX - 6, width: 6 }}
          onPointerDown={handleEndPointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
        >
          <div className="absolute top-0.5 bottom-0.5 right-0.5 w-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: color }} />
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  if (prevProps.modifierType !== nextProps.modifierType) return false;
  if (prevProps.partKeyframes !== nextProps.partKeyframes) return false;
  if (prevProps.totalFrames !== nextProps.totalFrames) return false;
  return true;
});

export default KeyframeModifierSubTrackLane;
