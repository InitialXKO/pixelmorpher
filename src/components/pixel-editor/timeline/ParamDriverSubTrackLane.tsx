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
import type { Keyframe, ModifierType, PartAnimationModifier, ParamDriver, ParamDriverWaveform, ModifierParamValue } from '@/lib/types';
import { MODIFIER_DEFINITIONS, PARAM_DRIVER_WAVEFORM_LABELS, evaluateParamDriver } from '@/lib/types';
import { FRAME_WIDTH, SUB_TRACK_HEIGHT, CATEGORY_COLOR_MAP } from './constants';

// ---- ParamDriver Sub-Track Lane ----
// Renders ParamDriver wave preview and bake/unbake controls for a modifier's param drivers
export function ParamDriverSubTrackLane({
  modifierType,
  partKeyframes,
  totalFrames,
  onEditParamDriver,
}: {
  modifierType: ModifierType;
  partKeyframes: Keyframe[];
  totalFrames: number;
  onEditParamDriver: (keyframeId: string, modifierId: string, driverId: string) => void;
}) {
  const { updateParamDriver, removeParamDriver, toggleParamDriver, bakeParamDriver, unbakeParamDriver } = useProjectStore();
  const width = totalFrames * FRAME_WIDTH;

  const driverEntries = useMemo(() => {
    const entries: { keyframeId: string; modifierId: string; driver: ParamDriver }[] = [];
    for (const kf of partKeyframes) {
      const mod = kf.modifiers.find((m) => m.type === modifierType);
      if (mod && mod.paramDrivers) {
        for (const driver of mod.paramDrivers) {
          entries.push({ keyframeId: kf.id, modifierId: mod.id, driver });
        }
      }
    }
    return entries;
  }, [partKeyframes, modifierType]);

  if (driverEntries.length === 0) return null;

  return (
    <>
      {driverEntries.map(({ keyframeId, modifierId, driver }) => (
        <ParamDriverLaneRow
          key={driver.id}
          driver={driver}
          keyframeId={keyframeId}
          modifierId={modifierId}
          totalFrames={totalFrames}
          width={width}
          onEdit={() => onEditParamDriver(keyframeId, modifierId, driver.id)}
          onUpdate={(updates) => updateParamDriver(keyframeId, modifierId, driver.id, updates)}
          onRemove={() => removeParamDriver(keyframeId, modifierId, driver.id)}
          onToggle={() => toggleParamDriver(keyframeId, modifierId, driver.id)}
          onBake={() => bakeParamDriver(keyframeId, modifierId, driver.id)}
          onUnbake={() => unbakeParamDriver(keyframeId, modifierId, driver.id)}
        />
      ))}
    </>
  );
}

// ---- AnimModifier ParamDriver Sub-Track Lane ----
export function AnimModifierParamDriverSubTrackLane({
  modifier,
  partId,
  totalFrames,
  onEditAnimParamDriver,
}: {
  modifier: PartAnimationModifier;
  partId: string;
  totalFrames: number;
  onEditAnimParamDriver: (partId: string, modifierId: string, driverId: string) => void;
}) {
  const { updateAnimParamDriver, removeAnimParamDriver, toggleAnimParamDriver, bakeAnimParamDriver, unbakeAnimParamDriver } = useProjectStore();
  const width = totalFrames * FRAME_WIDTH;

  const drivers = modifier.paramDrivers ?? [];
  if (drivers.length === 0) return null;

  return (
    <>
      {drivers.map((driver) => (
        <ParamDriverLaneRow
          key={driver.id}
          driver={driver}
          keyframeId={`anim-${partId}`}
          modifierId={modifier.id}
          totalFrames={totalFrames}
          width={width}
          onEdit={() => onEditAnimParamDriver(partId, modifier.id, driver.id)}
          onUpdate={(updates) => updateAnimParamDriver(partId, modifier.id, driver.id, updates)}
          onRemove={() => removeAnimParamDriver(partId, modifier.id, driver.id)}
          onToggle={() => toggleAnimParamDriver(partId, modifier.id, driver.id)}
          onBake={() => bakeAnimParamDriver(partId, modifier.id, driver.id)}
          onUnbake={() => unbakeAnimParamDriver(partId, modifier.id, driver.id)}
        />
      ))}
    </>
  );
}

// ---- Single row for one ParamDriver ----
function ParamDriverLaneRow({
  driver, keyframeId, modifierId, totalFrames, width,
  onEdit, onUpdate, onRemove, onToggle, onBake, onUnbake,
}: {
  driver: ParamDriver;
  keyframeId: string;
  modifierId: string;
  totalFrames: number;
  width: number;
  onEdit: () => void;
  onUpdate: (updates: Partial<ParamDriver>) => void;
  onRemove: () => void;
  onToggle: () => void;
  onBake: () => void;
  onUnbake: () => void;
}) {
  const DRIVER_LANE_HEIGHT = 22;
  const startFrame = driver.startFrame;
  const endFrame = driver.endFrame >= 0 ? driver.endFrame : totalFrames - 1;
  const isActive = driver.enabled && !driver.isBaked;

  const waveformColors: Record<ParamDriverWaveform, string> = {
    sine: '#06b6d4', triangle: '#8b5cf6', square: '#ef4444',
    sawtooth: '#f59e0b', linear_ramp: '#10b981', exponential_decay: '#ec4899',
    spring_oscillate: '#3b82f6', perlin_noise: '#f97316',
  };
  const color = waveformColors[driver.waveform];

  const wavePoints = useMemo(() => {
    if (!isActive && !driver.isBaked) return '';
    const points: string[] = [];
    const midY = DRIVER_LANE_HEIGHT / 2;
    const halfHeight = DRIVER_LANE_HEIGHT / 2 - 2;
    for (let f = startFrame; f <= endFrame; f += 0.25) {
      const value = evaluateParamDriver(driver, Math.floor(f));
      const displayRange = driver.waveform === 'linear_ramp' || driver.waveform === 'exponential_decay'
        ? Math.abs(driver.endValue - driver.baseValue) || Math.abs(driver.amplitude) || 10
        : driver.amplitude || 10;
      const normalizedValue = (value - driver.baseValue) / displayRange;
      const clampedValue = Math.max(-1, Math.min(1, normalizedValue));
      const x = f * FRAME_WIDTH;
      const y = midY - clampedValue * halfHeight;
      points.push(`${x},${y}`);
    }
    return points.join(' ');
  }, [driver, startFrame, endFrame, isActive, totalFrames]);

  // Range handle drag state
  const [draggingEdge, setDraggingEdge] = useState<'start' | 'end' | null>(null);
  const [dragFrame, setDragFrame] = useState(startFrame);
  const draggingEdgeRef = useRef<'start' | 'end' | null>(null);
  const dragFrameRef = useRef(startFrame);
  const trackLaneRef = useRef<HTMLDivElement | null>(null);
  const didDragRef = useRef(false);

  const handleStartPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const trackLane = e.currentTarget.closest('[data-track-lane]');
      trackLaneRef.current = trackLane as HTMLDivElement | null;
      draggingEdgeRef.current = 'start'; didDragRef.current = false;
      setDraggingEdge('start'); setDragFrame(startFrame); dragFrameRef.current = startFrame;
    }, [startFrame]
  );

  const handleEndPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const trackLane = e.currentTarget.closest('[data-track-lane]');
      trackLaneRef.current = trackLane as HTMLDivElement | null;
      draggingEdgeRef.current = 'end'; didDragRef.current = false;
      setDraggingEdge('end'); setDragFrame(endFrame); dragFrameRef.current = endFrame;
    }, [endFrame]
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
      if (draggingEdgeRef.current === 'start') { frame = Math.min(frame, endFrame - 1); }
      else { frame = Math.max(frame, startFrame + 1); }
      if (frame !== dragFrameRef.current) { didDragRef.current = true; setDragFrame(frame); dragFrameRef.current = frame; }
    }, [totalFrames, startFrame, endFrame]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingEdgeRef.current) return;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      const edge = draggingEdgeRef.current;
      const finalFrame = dragFrameRef.current;
      draggingEdgeRef.current = null; setDraggingEdge(null); trackLaneRef.current = null;
      if (didDragRef.current) {
        if (edge === 'start') onUpdate({ startFrame: finalFrame });
        else onUpdate({ endFrame: finalFrame });
      }
    }, [onUpdate]
  );

  const displayStartFrame = draggingEdge === 'start' ? dragFrame : startFrame;
  const displayEndFrame = draggingEdge === 'end' ? dragFrame : endFrame;
  const displayStartX = displayStartFrame * FRAME_WIDTH;
  const displayEndX = (displayEndFrame + 1) * FRAME_WIDTH;
  const displayWidth = displayEndX - displayStartX;

  return (
    <div
      data-track-lane
      className="relative border-b border-[#1a1a2e] cursor-pointer"
      style={{ height: DRIVER_LANE_HEIGHT, width, minWidth: width, background: driver.isBaked ? '#100c1e' : '#0c0c1e' }}
      onDoubleClick={onEdit}
    >
      <svg width={width} height={DRIVER_LANE_HEIGHT} className="absolute inset-0 pointer-events-none" style={{ minWidth: width }}>
        {Array.from({ length: totalFrames }, (_, i) => (
          <line key={i} x1={i * FRAME_WIDTH} y1={0} x2={i * FRAME_WIDTH} y2={DRIVER_LANE_HEIGHT} stroke="#1a1a2e" strokeWidth={0.5} />
        ))}
        {displayWidth > 0 && (
          <>
            <rect x={displayStartX} y={1} width={displayWidth} height={DRIVER_LANE_HEIGHT - 2} rx={2} fill={color} opacity={driver.isBaked ? 0.08 : 0.12} />
            <rect x={displayStartX} y={1} width={displayWidth} height={DRIVER_LANE_HEIGHT - 2} rx={2} fill="none" stroke={color} strokeWidth={draggingEdge ? 1.5 : 0.5} opacity={driver.isBaked ? 0.25 : 0.5} strokeDasharray={driver.isBaked ? '3 3' : undefined} />
          </>
        )}
        {isActive && wavePoints && (
          <polyline points={wavePoints} fill="none" stroke={color} strokeWidth={1.5} opacity={0.8} strokeLinejoin="round" />
        )}
        {driver.isBaked && displayWidth > 0 && (
          <text x={displayStartX + 4} y={DRIVER_LANE_HEIGHT / 2 + 3} fill={color} fontSize={8} fontFamily="monospace" opacity={0.6}>BAKED</text>
        )}
        {isActive && displayWidth > 30 && (
          <text x={displayStartX + 4} y={9} fill={color} fontSize={7} fontFamily="monospace" opacity={0.7}>
            {driver.paramName}({PARAM_DRIVER_WAVEFORM_LABELS[driver.waveform]})
          </text>
        )}
        {draggingEdge && (
          <text x={draggingEdge === 'start' ? displayStartX + 2 : displayEndX - 20} y={DRIVER_LANE_HEIGHT / 2 + 3} fill="#ffffff" fontSize={8} fontFamily="monospace" opacity={0.9}>
            {draggingEdge === 'start' ? displayStartFrame : displayEndFrame}
          </text>
        )}
      </svg>

      <ContextMenu>
        <ContextMenuTrigger asChild><div className="absolute inset-0 z-10" /></ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={onEdit}><span className="text-xs">编辑ParamDriver</span></ContextMenuItem>
          <ContextMenuItem onClick={onToggle}><span className="text-xs">{driver.enabled ? '禁用' : '启用'}</span></ContextMenuItem>
          {!driver.isBaked && <ContextMenuItem onClick={onBake}><span className="text-xs text-amber-400">烘焙为关键帧</span></ContextMenuItem>}
          {driver.isBaked && <ContextMenuItem onClick={onUnbake}><span className="text-xs text-cyan-400">取消烘焙</span></ContextMenuItem>}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={onRemove}><Trash2 className="size-4 mr-2" /><span className="text-xs">删除ParamDriver</span></ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isActive && displayWidth > 0 && (
        <div className="absolute top-0 bottom-0 cursor-ew-resize z-20 hover:bg-white/10 transition-colors group" style={{ left: displayStartX, width: 6 }}
          onPointerDown={handleStartPointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
          <div className="absolute top-0.5 bottom-0.5 left-0.5 w-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: color }} />
        </div>
      )}
      {isActive && displayWidth > 0 && (
        <div className="absolute top-0 bottom-0 cursor-ew-resize z-20 hover:bg-white/10 transition-colors group" style={{ left: displayEndX - 6, width: 6 }}
          onPointerDown={handleEndPointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
          <div className="absolute top-0.5 bottom-0.5 right-0.5 w-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: color }} />
        </div>
      )}
    </div>
  );
}
