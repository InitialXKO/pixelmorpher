'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useProjectStore, useEditorStore } from '@/lib/store';
import { startPlayback, stopPlayback } from '@/lib/playback-scheduler';
import type { InterpolationMode, ModifierType, ModifierParamValue, PuppetNodeKeyframe } from '@/lib/types';
import { FRAME_WIDTH } from './timeline/constants';
import TimelineControls from './timeline/TimelineControls';
import TrackLabelsColumn from './timeline/TrackLabelsColumn';
import TrackLanesColumn from './timeline/TrackLanesColumn';
import ParamDriverEditDialog from './timeline/dialogs/ParamDriverEditDialog';
import EffectKeyframeEditDialog from './timeline/dialogs/EffectKeyframeEditDialog';
import ModifierParamEditDialog from './timeline/dialogs/ModifierParamEditDialog';
import useVirtualScroll from './timeline/useVirtualScroll';

// ---- Main Timeline Component ----
export default function Timeline() {
  // P5-2: currentFrame removed from reactive subscription — read via ref + subscribe instead
  const currentFrameRef = useRef(useProjectStore.getState().currentFrame);
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const playheadTriangleRef = useRef<HTMLDivElement>(null);
  const frameDisplayRef = useRef<HTMLSpanElement>(null);
  const rulerHighlightRef = useRef<SVGRectElement | null>(null);

  // ---- Store ----
  const tracks = useProjectStore((s) => s.tracks);
  const parts = useProjectStore((s) => s.parts);
  const keyframes = useProjectStore((s) => s.keyframes);
  const totalFrames = useProjectStore((s) => s.totalFrames);
  const frameRate = useProjectStore((s) => s.frameRate);
  const setCurrentFrame = useProjectStore((s) => s.setCurrentFrame);
  const setFrameRate = useProjectStore((s) => s.setFrameRate);
  const setTotalFrames = useProjectStore((s) => s.setTotalFrames);
  const addKeyframe = useProjectStore((s) => s.addKeyframe);
  const removeKeyframe = useProjectStore((s) => s.removeKeyframe);
  const duplicateKeyframe = useProjectStore((s) => s.duplicateKeyframe);
  const getKeyframesForPart = useProjectStore((s) => s.getKeyframesForPart);
  const updateKeyframe = useProjectStore((s) => s.updateKeyframe);
  const effectTracks = useProjectStore((s) => s.effectTracks);
  const addEffectKeyframe = useProjectStore((s) => s.addEffectKeyframe);
  const removeEffectKeyframe = useProjectStore((s) => s.removeEffectKeyframe);
  const canvasModifierTracks = useProjectStore((s) => s.canvasModifierTracks);
  const addModifierParamKeyframe = useProjectStore((s) => s.addModifierParamKeyframe);
  const addParamDriver = useProjectStore((s) => s.addParamDriver);

  // ---- Puppet data from store ----
  const activeAnimationClipId = useProjectStore((s) => s.activeAnimationClipId);
  const animationClips = useProjectStore((s) => s.animationClips);
  const puppetSkeletons = useProjectStore((s) => s.puppetSkeletons) ?? [];
  const puppetCharacters = useProjectStore((s) => s.puppetCharacters) ?? [];
  const addPuppetNodeKeyframe = useProjectStore((s) => s.addPuppetNodeKeyframe);
  const removePuppetNodeKeyframe = useProjectStore((s) => s.removePuppetNodeKeyframe);
  const updatePuppetNodeKeyframe = useProjectStore((s) => s.updatePuppetNodeKeyframe);

  // ---- Derived puppet data ----
  const activeClip = useMemo(
    () => animationClips.find((c) => c.id === activeAnimationClipId) ?? null,
    [animationClips, activeAnimationClipId]
  );
  const isPuppetClip = activeClip?.isPuppetClip === true;
  const puppetCharacter = useMemo(() => {
    if (!isPuppetClip || !activeClip?.puppetCharacterId) return null;
    return puppetCharacters.find((c) => c.id === activeClip.puppetCharacterId) ?? null;
  }, [isPuppetClip, activeClip, puppetCharacters]);
  const puppetSkeleton = useMemo(() => {
    if (!puppetCharacter) return null;
    return puppetSkeletons.find((s) => s.id === puppetCharacter.puppetSkeletonId) ?? null;
  }, [puppetCharacter, puppetSkeletons]);
  const puppetNodes = useMemo(() => puppetSkeleton?.nodes ?? [], [puppetSkeleton]);
  const puppetNodeKeyframes = useMemo(
    () => activeClip?.puppetNodeKeyframes ?? [],
    [activeClip]
  );

  // ---- Puppet keyframe selection state ----
  const [selectedPuppetKeyframeId, setSelectedPuppetKeyframeId] = useState<string | null>(null);
  const [puppetMoveToFrameKfId, setPuppetMoveToFrameKfId] = useState<string | null>(null);
  const [puppetMoveToFrameValue, setPuppetMoveToFrameValue] = useState(0);

  const handleSelectPuppetKeyframe = useCallback((id: string) => {
    setSelectedPuppetKeyframeId(id || null);
  }, []);

  const handleAddPuppetKeyframe = useCallback(
    (nodeId: string, frame: number) => {
      if (!activeClip) return;
      addPuppetNodeKeyframe(activeClip.id, nodeId, frame, {});
    },
    [activeClip, addPuppetNodeKeyframe]
  );

  const handleDeletePuppetKeyframe = useCallback(
    (keyframeId: string) => {
      if (!activeClip) return;
      removePuppetNodeKeyframe(activeClip.id, keyframeId);
    },
    [activeClip, removePuppetNodeKeyframe]
  );

  const handleMovePuppetKeyframeToFrame = useCallback(
    (keyframeId: string) => {
      const kf = puppetNodeKeyframes.find((k) => k.id === keyframeId);
      if (kf) {
        setPuppetMoveToFrameKfId(keyframeId);
        setPuppetMoveToFrameValue(kf.frame);
      }
    },
    [puppetNodeKeyframes]
  );

  const handleUpdatePuppetKeyframe = useCallback(
    (keyframeId: string, updates: Partial<PuppetNodeKeyframe>) => {
      if (!activeClip) return;
      updatePuppetNodeKeyframe(activeClip.id, keyframeId, updates);
    },
    [activeClip, updatePuppetNodeKeyframe]
  );

  const handlePuppetMoveToFrameConfirm = useCallback(() => {
    if (puppetMoveToFrameKfId) {
      handleUpdatePuppetKeyframe(puppetMoveToFrameKfId, { frame: puppetMoveToFrameValue });
      setPuppetMoveToFrameKfId(null);
    }
  }, [puppetMoveToFrameKfId, puppetMoveToFrameValue, handleUpdatePuppetKeyframe]);

  const playState = useEditorStore((s) => s.playState);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectedKeyframeId = useEditorStore((s) => s.selectedKeyframeId);
  const selectedEffectTrackId = useEditorStore((s) => s.selectedEffectTrackId);
  const setPlayState = useEditorStore((s) => s.setPlayState);
  const selectKeyframe = useEditorStore((s) => s.selectKeyframe);
  const selectEffectTrack = useEditorStore((s) => s.selectEffectTrack);
  const editMode = useEditorStore((s) => s.editMode);
  const partEditPartId = useEditorStore((s) => s.partEditPartId);

  // P5-2: Subscribe to currentFrame changes via ref
  useEffect(() => {
    const unsub = useProjectStore.subscribe((state, prevState) => {
      if (state.currentFrame !== prevState.currentFrame) {
        currentFrameRef.current = state.currentFrame;
        const f = state.currentFrame;
        if (playheadLineRef.current) {
          playheadLineRef.current.style.left = `${f * 24 + 12 - 1}px`;
        }
        if (frameDisplayRef.current) {
          frameDisplayRef.current.textContent = String(f);
        }
        if (rulerHighlightRef.current) {
          rulerHighlightRef.current.setAttribute('x', String(f * 24));
        }
        if (scrollContainerRef.current) {
          const container = scrollContainerRef.current;
          const playheadX = f * 24;
          const scrollLeft = container.scrollLeft;
          const viewWidth = container.clientWidth;
          if (playheadX < scrollLeft + 40 || playheadX > scrollLeft + viewWidth - 40) {
            container.scrollLeft = Math.max(0, playheadX - viewWidth / 3);
          }
        }
      }
    });
    return unsub;
  }, []);

  // ---- Local state ----
  const [isEditingFps, setIsEditingFps] = useState(false);
  const [isEditingFrames, setIsEditingFrames] = useState(false);
  const [fpsInput, setFpsInput] = useState(String(frameRate));
  const [framesInput, setFramesInput] = useState(String(totalFrames));
  const [editKfDialogOpen, setEditKfDialogOpen] = useState(false);
  const [editKfTrackId, setEditKfTrackId] = useState<string | null>(null);
  const [editKfId, setEditKfId] = useState<string | null>(null);

  // ---- Modifier param edit dialog state ----
  const [modifierEditOpen, setModifierEditOpen] = useState(false);
  const [modifierEditMode, setModifierEditMode] = useState<'animation' | 'keyframe'>('animation');
  const [modifierEditPartId, setModifierEditPartId] = useState<string | null>(null);
  const [modifierEditModifierId, setModifierEditModifierId] = useState<string | null>(null);
  const [modifierEditModifierType, setModifierEditModifierType] = useState<ModifierType | null>(null);
  const [modifierEditCurrentParams, setModifierEditCurrentParams] = useState<Record<string, ModifierParamValue> | undefined>(undefined);
  const [modifierEditKeyframeId, setModifierEditKeyframeId] = useState<string | null>(null);
  const [modifierEditFrame, setModifierEditFrame] = useState<number>(0);

  // ---- ParamDriver edit dialog state ----
  const [paramDriverEditOpen, setParamDriverEditOpen] = useState(false);
  const [paramDriverEditKeyframeId, setParamDriverEditKeyframeId] = useState<string | null>(null);
  const [paramDriverEditModifierId, setParamDriverEditModifierId] = useState<string | null>(null);
  const [paramDriverEditDriverId, setParamDriverEditDriverId] = useState<string | null>(null);
  const [paramDriverEditSource, setParamDriverEditSource] = useState<'keyframe' | 'animation'>('keyframe');
  const [paramDriverEditPartId, setParamDriverEditPartId] = useState<string | null>(null);

  const displayFps = isEditingFps ? fpsInput : String(frameRate);
  const displayFrames = isEditingFrames ? framesInput : String(totalFrames);

  // ---- Refs ----
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const labelScrollRef = useRef<HTMLDivElement>(null);

  // ---- Virtual Scroll ----
  const { visibleRange, rowOffsets, rowHeights, totalHeight, onScroll: handleVirtualScroll } = useVirtualScroll(
    scrollContainerRef, tracks, parts, effectTracks, canvasModifierTracks, getKeyframesForPart
  );

  // ---- Playback Logic ----
  useEffect(() => {
    if (playState === 'playing') {
      startPlayback();
    } else {
      stopPlayback();
    }
    return () => {
      if (playState === 'playing') stopPlayback();
    };
  }, [playState]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'Delete':
        case 'Backspace': {
          if (selectedKeyframeId) { e.preventDefault(); removeKeyframe(selectedKeyframeId); selectKeyframe(null); }
          break;
        }
        case ' ': {
          e.preventDefault();
          if (playState === 'playing') { setPlayState('paused'); }
          else { if (currentFrameRef.current >= totalFrames - 1) setCurrentFrame(0); setPlayState('playing'); }
          break;
        }
        case 'ArrowLeft': { e.preventDefault(); setPlayState('paused'); setCurrentFrame(Math.max(0, currentFrameRef.current - 1)); break; }
        case 'ArrowRight': { e.preventDefault(); setPlayState('paused'); setCurrentFrame(Math.min(totalFrames - 1, currentFrameRef.current + 1)); break; }
        case 'Home': { e.preventDefault(); setCurrentFrame(0); break; }
        case 'End': { e.preventDefault(); setCurrentFrame(totalFrames - 1); break; }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedKeyframeId, playState, totalFrames, removeKeyframe, selectKeyframe, setPlayState, setCurrentFrame]);

  // ---- Scroll sync ----
  const handleTrackScroll = useCallback(() => {
    if (labelScrollRef.current && scrollContainerRef.current) {
      labelScrollRef.current.scrollTop = scrollContainerRef.current.scrollTop;
    }
    handleVirtualScroll();
  }, [handleVirtualScroll]);

  // ---- Handlers ----
  const handlePlay = useCallback(() => {
    if (playState === 'playing') { setPlayState('paused'); }
    else { if (currentFrameRef.current >= totalFrames - 1) setCurrentFrame(0); setPlayState('playing'); }
  }, [playState, totalFrames, setPlayState, setCurrentFrame]);

  const handleStop = useCallback(() => { setPlayState('stopped'); setCurrentFrame(0); }, [setPlayState, setCurrentFrame]);
  const handleStepBack = useCallback(() => { setPlayState('paused'); setCurrentFrame(Math.max(0, currentFrameRef.current - 1)); }, [setPlayState, setCurrentFrame]);
  const handleStepForward = useCallback(() => { setPlayState('paused'); setCurrentFrame(Math.min(totalFrames - 1, currentFrameRef.current + 1)); }, [totalFrames, setPlayState, setCurrentFrame]);

  const handleRulerClick = useCallback((frame: number) => { setCurrentFrame(frame); }, [setCurrentFrame]);
  const handleSelectKeyframe = useCallback((id: string) => { selectKeyframe(id || null); }, [selectKeyframe]);
  const handleAddKeyframe = useCallback((partId: string, frame: number) => { addKeyframe(partId, frame); }, [addKeyframe]);

  const handleDeleteKeyframe = useCallback(
    (id: string) => { removeKeyframe(id); if (selectedKeyframeId === id) selectKeyframe(null); },
    [selectedKeyframeId, removeKeyframe, selectKeyframe]
  );

  const handleDuplicateKeyframe = useCallback(
    (id: string) => { const targetFrame = Math.min(currentFrameRef.current + 5, totalFrames - 1); duplicateKeyframe(id, targetFrame); },
    [totalFrames, duplicateKeyframe]
  );

  const handleMoveKeyframeToFrame = useCallback(
    (id: string) => {
      const kf = useProjectStore.getState().keyframes.find((k) => k.id === id);
      if (!kf) return;
      const targetStr = window.prompt('Move keyframe to frame:', String(kf.frame));
      if (targetStr !== null) {
        const target = parseInt(targetStr, 10);
        if (!isNaN(target) && target >= 0 && target < totalFrames) updateKeyframe(id, { frame: target });
      }
    },
    [totalFrames, updateKeyframe]
  );

  const handleFpsSubmit = useCallback(() => {
    const val = parseInt(fpsInput, 10);
    if (!isNaN(val) && val >= 1 && val <= 120) setFrameRate(val);
    else setFpsInput(String(frameRate));
    setIsEditingFps(false);
  }, [fpsInput, frameRate, setFrameRate]);

  const handleFramesSubmit = useCallback(() => {
    const val = parseInt(framesInput, 10);
    if (!isNaN(val) && val >= 1 && val <= 9999) setTotalFrames(val);
    else setFramesInput(String(totalFrames));
    setIsEditingFrames(false);
  }, [framesInput, totalFrames, setTotalFrames]);

  const handleAddModifierParamKeyframe = useCallback(
    (keyframeId: string, modifierId: string, frame: number) => {
      const kf = useProjectStore.getState().keyframes.find((k) => k.id === keyframeId);
      const mod = kf?.modifiers.find((m) => m.id === modifierId);
      if (mod) addModifierParamKeyframe(keyframeId, modifierId, frame, {});
    },
    [addModifierParamKeyframe]
  );

  const handleEditAnimModifierParams = useCallback(
    (partId: string, modifierId: string) => {
      const part = useProjectStore.getState().parts.find((p) => p.id === partId);
      const mod = part?.animationModifiers.find((m) => m.id === modifierId);
      if (!mod) return;
      setModifierEditMode('animation');
      setModifierEditPartId(partId);
      setModifierEditModifierId(modifierId);
      setModifierEditModifierType(mod.type);
      setModifierEditCurrentParams({ ...mod.params });
      setModifierEditKeyframeId(null);
      setModifierEditFrame(0);
      setModifierEditOpen(true);
    }, []
  );

  const handleEditKfModifierParams = useCallback(
    (keyframeId: string, modifierId: string) => {
      const kf = useProjectStore.getState().keyframes.find((k) => k.id === keyframeId);
      const mod = kf?.modifiers.find((m) => m.id === modifierId);
      if (!mod || !kf) return;
      setModifierEditMode('keyframe');
      setModifierEditPartId(null);
      setModifierEditModifierId(modifierId);
      setModifierEditModifierType(mod.type);
      setModifierEditCurrentParams({ ...mod.params });
      setModifierEditKeyframeId(keyframeId);
      setModifierEditFrame(kf.frame);
      setModifierEditOpen(true);
    }, []
  );

  const handleEditParamKeyframe = useCallback(
    (keyframeId: string, modifierId: string, paramKfId: string) => {
      const kf = useProjectStore.getState().keyframes.find((k) => k.id === keyframeId);
      const mod = kf?.modifiers.find((m) => m.id === modifierId);
      const pkf = mod?.paramKeyframes?.find((p) => p.id === paramKfId);
      if (!mod || !kf || !pkf) return;
      setModifierEditMode('keyframe');
      setModifierEditPartId(null);
      setModifierEditModifierId(modifierId);
      setModifierEditModifierType(mod.type);
      setModifierEditCurrentParams({ ...mod.params, ...pkf.params });
      setModifierEditKeyframeId(keyframeId);
      setModifierEditFrame(pkf.frame);
      setModifierEditOpen(true);
    }, []
  );

  const handleEditParamDriver = useCallback(
    (keyframeId: string, modifierId: string, driverId: string) => {
      setParamDriverEditKeyframeId(keyframeId);
      setParamDriverEditModifierId(modifierId);
      setParamDriverEditDriverId(driverId);
      setParamDriverEditSource('keyframe');
      setParamDriverEditPartId(null);
      setParamDriverEditOpen(true);
    }, []
  );

  const handleEditAnimParamDriver = useCallback(
    (partId: string, modifierId: string, driverId: string) => {
      setParamDriverEditKeyframeId(null);
      setParamDriverEditModifierId(modifierId);
      setParamDriverEditDriverId(driverId);
      setParamDriverEditSource('animation');
      setParamDriverEditPartId(partId);
      setParamDriverEditOpen(true);
    }, []
  );

  // ---- Effect track handlers ----
  const handleAddEffectKeyframe = useCallback((trackId: string, frame: number) => { addEffectKeyframe(trackId, frame); }, [addEffectKeyframe]);
  const handleDeleteEffectKeyframe = useCallback((trackId: string, keyframeId: string) => { removeEffectKeyframe(trackId, keyframeId); }, [removeEffectKeyframe]);
  const handleEditEffectKeyframe = useCallback((trackId: string, keyframeId: string) => { setEditKfTrackId(trackId); setEditKfId(keyframeId); setEditKfDialogOpen(true); }, []);
  const handleSelectEffectTrack = useCallback((id: string | null) => { selectEffectTrack(id); }, [selectEffectTrack]);

  // ---- Playhead Drag ----
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPlayhead(true);
  }, []);

  useEffect(() => {
    if (!isDraggingPlayhead) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!scrollContainerRef.current) return;
      const rect = scrollContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollContainerRef.current.scrollLeft;
      const frame = Math.floor(x / FRAME_WIDTH);
      setCurrentFrame(Math.max(0, Math.min(frame, totalFrames - 1)));
    };
    const handleMouseUp = () => { setIsDraggingPlayhead(false); };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [isDraggingPlayhead, totalFrames, setCurrentFrame]);

  // ---- Computed ----
  const currentFrame = currentFrameRef.current;
  const timelineWidth = totalFrames * FRAME_WIDTH;
  const playheadX = currentFrame * FRAME_WIDTH + FRAME_WIDTH / 2;

  const getPartName = useCallback((partId: string) => {
    const part = parts.find((p) => p.id === partId);
    return part?.name ?? 'Unknown';
  }, [parts]);

  const editTrack = editKfTrackId ? effectTracks.find((t) => t.id === editKfTrackId) ?? null : null;

  // Selected keyframe interpolation mode
  const selectedKf = keyframes.find((k) => k.id === selectedKeyframeId);
  const selectedKfInterpolationMode = selectedKeyframeId ? (selectedKf?.interpolationMode ?? 'linear') : undefined;

  return (
    <div
      className="flex flex-col select-none shrink-0 overflow-hidden"
      style={{ minHeight: 200, maxHeight: '40vh', background: '#0d0d1f', borderTop: '1px solid #2a2a4a', color: '#e5e7eb' }}
    >
      {/* Top Controls Bar */}
      <TimelineControls
        playState={playState}
        currentFrame={currentFrame}
        totalFrames={totalFrames}
        frameRate={frameRate}
        isEditingFps={isEditingFps}
        isEditingFrames={isEditingFrames}
        displayFps={displayFps}
        displayFrames={displayFrames}
        selectedKeyframeId={selectedKeyframeId}
        selectedKfInterpolationMode={selectedKfInterpolationMode}
        onPlay={handlePlay}
        onStop={handleStop}
        onStepBack={handleStepBack}
        onStepForward={handleStepForward}
        onFpsInput={setFpsInput}
        onFpsSubmit={handleFpsSubmit}
        onFramesInput={setFramesInput}
        onFramesSubmit={handleFramesSubmit}
        onAddKeyframe={() => {
          let targetPartId: string | null = null;
          if (selectedPartId) {
            const track = tracks.find((t) => t.partId === selectedPartId);
            if (track && !track.locked) targetPartId = selectedPartId;
          }
          if (!targetPartId) {
            const unlockedTrack = tracks.find((t) => !t.locked);
            if (unlockedTrack) targetPartId = unlockedTrack.partId;
          }
          if (targetPartId) {
            const kf = addKeyframe(targetPartId, currentFrameRef.current);
            selectKeyframe(kf.id);
          }
        }}
        onDeleteKeyframe={() => {
          if (selectedKeyframeId) { removeKeyframe(selectedKeyframeId); selectKeyframe(null); }
        }}
        onInterpolationChange={(mode: InterpolationMode) => {
          if (selectedKeyframeId) updateKeyframe(selectedKeyframeId, { interpolationMode: mode });
        }}
        onEditFpsStart={() => { setFpsInput(String(frameRate)); setIsEditingFps(true); }}
        onEditFramesStart={() => { setFramesInput(String(totalFrames)); setIsEditingFrames(true); }}
        onEditFpsCancel={() => { setFpsInput(String(frameRate)); setIsEditingFps(false); }}
        onEditFramesCancel={() => { setFramesInput(String(totalFrames)); setIsEditingFrames(false); }}
        frameDisplayRef={frameDisplayRef}
      />

      {/* Timeline Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Track Labels Column */}
        <TrackLabelsColumn
          tracks={tracks}
          parts={parts}
          effectTracks={effectTracks}
          canvasModifierTracks={canvasModifierTracks}
          getKeyframesForPart={getKeyframesForPart}
          visibleRange={visibleRange}
          rowOffsets={rowOffsets}
          rowHeights={rowHeights}
          totalHeight={totalHeight}
          getPartName={getPartName}
          selectedEffectTrackId={selectedEffectTrackId}
          onSelectEffectTrack={handleSelectEffectTrack}
          isPuppetClip={isPuppetClip}
          puppetNodes={puppetNodes}
          labelScrollRef={labelScrollRef}
        />

        {/* Right: Ruler + Keyframe Lanes */}
        <TrackLanesColumn
          tracks={tracks}
          parts={parts}
          effectTracks={effectTracks}
          canvasModifierTracks={canvasModifierTracks}
          getKeyframesForPart={getKeyframesForPart}
          totalFrames={totalFrames}
          currentFrame={currentFrame}
          selectedKeyframeId={selectedKeyframeId}
          selectedEffectTrackId={selectedEffectTrackId}
          visibleRange={visibleRange}
          rowOffsets={rowOffsets}
          rowHeights={rowHeights}
          totalHeight={totalHeight}
          timelineWidth={timelineWidth}
          playheadX={playheadX}
          scrollContainerRef={scrollContainerRef}
          playheadLineRef={playheadLineRef}
          onScroll={handleTrackScroll}
          onRulerClick={handleRulerClick}
          onSelectKeyframe={handleSelectKeyframe}
          onSelectEffectTrack={handleSelectEffectTrack}
          onAddKeyframe={handleAddKeyframe}
          onDeleteKeyframe={handleDeleteKeyframe}
          onDuplicateKeyframe={handleDuplicateKeyframe}
          onMoveKeyframeToFrame={handleMoveKeyframeToFrame}
          onUpdateKeyframe={updateKeyframe}
          onAddEffectKeyframe={handleAddEffectKeyframe}
          onDeleteEffectKeyframe={handleDeleteEffectKeyframe}
          onEditEffectKeyframe={handleEditEffectKeyframe}
          onEditAnimModifierParams={handleEditAnimModifierParams}
          onEditKfModifierParams={handleEditKfModifierParams}
          onEditParamKeyframe={handleEditParamKeyframe}
          onAddModifierParamKeyframe={handleAddModifierParamKeyframe}
          onEditParamDriver={handleEditParamDriver}
          onEditAnimParamDriver={handleEditAnimParamDriver}
          onPlayheadMouseDown={handlePlayheadMouseDown}
          isPuppetClip={isPuppetClip}
          puppetNodes={puppetNodes}
          puppetNodeKeyframes={puppetNodeKeyframes}
          selectedPuppetKeyframeId={selectedPuppetKeyframeId}
          onSelectPuppetKeyframe={handleSelectPuppetKeyframe}
          onAddPuppetKeyframe={handleAddPuppetKeyframe}
          onDeletePuppetKeyframe={handleDeletePuppetKeyframe}
          onMovePuppetKeyframeToFrame={handleMovePuppetKeyframeToFrame}
          onUpdatePuppetKeyframe={handleUpdatePuppetKeyframe}
        />
      </div>

      {/* Dialogs */}
      <EffectKeyframeEditDialog
        open={editKfDialogOpen}
        onOpenChange={setEditKfDialogOpen}
        effectTrack={editTrack}
        keyframeId={editKfId}
      />

      <ModifierParamEditDialog
        key={`${modifierEditMode}-${modifierEditModifierId ?? ''}-${modifierEditKeyframeId ?? ''}`}
        open={modifierEditOpen}
        onOpenChange={setModifierEditOpen}
        mode={modifierEditMode}
        partId={modifierEditPartId ?? undefined}
        modifierId={modifierEditModifierId ?? undefined}
        modifierType={modifierEditModifierType ?? undefined}
        currentParams={modifierEditCurrentParams}
        keyframeId={modifierEditKeyframeId ?? undefined}
        frame={modifierEditFrame}
      />

      <ParamDriverEditDialog
        open={paramDriverEditOpen}
        onOpenChange={setParamDriverEditOpen}
        keyframeId={paramDriverEditKeyframeId}
        modifierId={paramDriverEditModifierId}
        driverId={paramDriverEditDriverId}
        source={paramDriverEditSource}
        partId={paramDriverEditPartId}
      />

      {/* Puppet keyframe: Move to Frame dialog */}
      <Dialog open={puppetMoveToFrameKfId !== null} onOpenChange={(open) => { if (!open) setPuppetMoveToFrameKfId(null); }}>
        <DialogContent className="bg-[#1a1a2e] border-white/10 text-gray-200 max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm text-gray-100">Move Puppet Keyframe</DialogTitle>
            <DialogDescription className="text-xs text-gray-400">
              Move this puppet keyframe to a different frame
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs text-gray-400">Frame</Label>
            <Input
              type="number"
              value={puppetMoveToFrameValue}
              onChange={(e) => setPuppetMoveToFrameValue(parseInt(e.target.value) || 0)}
              className="h-7 text-xs bg-white/5 border-white/10 text-gray-300 px-2"
              min={0}
              max={totalFrames - 1}
              step={1}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" className="text-xs text-gray-400 hover:text-gray-200" onClick={() => setPuppetMoveToFrameKfId(null)}>Cancel</Button>
            <Button size="sm" className="text-xs bg-cyan-600 hover:bg-cyan-500 text-white" onClick={handlePuppetMoveToFrameConfirm}>Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
