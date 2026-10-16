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
import type { InterpolationMode } from '@/lib/types';
import type { NodeKeyframe } from '@/lib/unified-types';
import type { SnapTarget } from '@/lib/v15-types';
import { DEFAULT_FRAME_WIDTH, getFrameWidth, TRACK_COLOR_HUES } from './timeline/constants';
import TimelineControls from './timeline/TimelineControls';
import TrackLabelsColumn from './timeline/TrackLabelsColumn';
import TrackLanesColumn from './timeline/TrackLanesColumn';
import EffectKeyframeEditDialog from './timeline/dialogs/EffectKeyframeEditDialog';
import useVirtualScroll from './timeline/useVirtualScroll';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import { interpolateNodeKeyframes } from '@/lib/engine/render-helpers/puppet-keyframe-interpolation';

// ---- Main Timeline Component ----
export default function Timeline() {
  // P5-2: currentFrame removed from reactive subscription — read via ref + subscribe instead
  const currentFrameRef = useRef(useProjectStore.getState().currentFrame);
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const playheadTriangleRef = useRef<HTMLDivElement>(null);
  const frameDisplayRef = useRef<HTMLSpanElement>(null);
  const rulerHighlightRef = useRef<SVGRectElement>(null);

  // ---- Store ----
  const keyframes = useProjectStore((s) => s.keyframes);
  const totalFrames = useProjectStore((s) => s.totalFrames);
  const frameRate = useProjectStore((s) => s.frameRate);
  const setCurrentFrame = useProjectStore((s) => s.setCurrentFrame);
  const setFrameRate = useProjectStore((s) => s.setFrameRate);
  const setTotalFrames = useProjectStore((s) => s.setTotalFrames);
  const effectTracks = useProjectStore((s) => s.effectTracks);
  const addEffectKeyframe = useProjectStore((s) => s.addEffectKeyframe);
  const removeEffectKeyframe = useProjectStore((s) => s.removeEffectKeyframe);
  const canvasModifierTracks = useProjectStore((s) => s.canvasModifierTracks);

  // ---- V15: Timeline zoom & snap ----
  const timelineZoom = useProjectStore((s) => s.timelineZoom);
  const setTimelineZoom = useProjectStore((s) => s.setTimelineZoom);
  const snapConfig = useProjectStore((s) => s.snapConfig);
  const updateSnapConfig = useProjectStore((s) => s.updateSnapConfig);
  const trackTimelineDisplays = useProjectStore((s) => s.trackTimelineDisplays);
  const updateTrackTimelineDisplay = useProjectStore((s) => s.updateTrackTimelineDisplay);
  const trackFrameSteps = useProjectStore((s) => s.trackFrameSteps);
  const setTrackFrameStep = useProjectStore((s) => s.setTrackFrameStep);
  const getEffectiveFrameStep = useProjectStore((s) => s.getEffectiveFrameStep);

  // ---- Puppet data from store ----
  const activeAnimationClipId = useProjectStore((s) => s.activeAnimationClipId);
  const animationClips = useProjectStore((s) => s.animationClips);
  const unifiedCharacters = useProjectStore((s) => s.unifiedCharacters) ?? {};
  const addNodeKeyframe = useProjectStore((s) => s.addNodeKeyframe);
  const removeNodeKeyframe = useProjectStore((s) => s.removeNodeKeyframe);
  const updateNodeKeyframe = useProjectStore((s) => s.updateNodeKeyframe);

  // ---- Derived puppet data ----
  const activeClip = useMemo(
    () => animationClips.find((c) => c.id === activeAnimationClipId) ?? null,
    [animationClips, activeAnimationClipId]
  );
  const isPuppetClip = true; // 所有 clip 统一为木偶模型
  const puppetCharacter = useMemo(() => {
    if (!isPuppetClip || !activeClip?.puppetCharacterId) return null;
    return Object.values(unifiedCharacters).find((c) => c.id === activeClip.puppetCharacterId) ?? null;
  }, [isPuppetClip, activeClip, unifiedCharacters]);
  const puppetSkeleton = useMemo(() => {
    // In new model, Character IS the skeleton
    return puppetCharacter;
  }, [puppetCharacter]);
  const puppetNodes = useMemo(() => (puppetSkeleton ? Object.values(puppetSkeleton.nodes) : []), [puppetSkeleton]);
  const nodeKeyframes = useMemo(
    () => activeClip?.nodeKeyframes ?? [],
    [activeClip]
  );

  // ---- Puppet keyframe selection state ----
  const [selectedNodeKeyframeId, setSelectedNodeKeyframeId] = useState<string | null>(null);
  const [nodeMoveToFrameKfId, setNodeMoveToFrameKfId] = useState<string | null>(null);
  const [nodeMoveToFrameValue, setNodeMoveToFrameValue] = useState(0);

  const handleSelectNodeKeyframe = useCallback((id: string) => {
    setSelectedNodeKeyframeId(id || null);
  }, []);

  const handleAddNodeKeyframe = useCallback(
    (nodeId: string, frame: number) => {
      if (!activeClip) return;
      // H2: 用当前帧的插值姿态填充，而不是空对象（避免节点弹回静止姿态）
      const skeleton = Object.values(unifiedCharacters).find((ch) =>
        Object.values(ch.nodes).some((n) => n.id === nodeId)
      );
      const node = skeleton?.nodes[nodeId];
      let values: Partial<Pick<import('@/lib/unified-types').NodeKeyframe, 'angle' | 'stretch' | 'x' | 'y' | 'variantIndex' | 'zIndex'>> = {};
      // 从新 store 获取 Character，用新签名
      const unifiedCharacter = useProjectStore.getState().unifiedCharacters[activeClip.puppetCharacterId ?? ''];
      if (unifiedCharacter) {
        const ivMap = interpolateNodeKeyframes(unifiedCharacter, frame);
        const iv = ivMap.get(nodeId);
        const uniNode = unifiedCharacter.nodes[nodeId];
        values = {
          angle: iv?.angle ?? uniNode?.transform?.angle ?? 0,
          stretch: iv?.stretch ?? 1,
          x: iv?.x ?? 0,
          y: iv?.y ?? 0,
          variantIndex: 0,
        };
      }
      addNodeKeyframe(activeClip.id, nodeId, frame, values);
    },
    [activeClip, addNodeKeyframe, unifiedCharacters]
  );

  const handleDeleteNodeKeyframe = useCallback(
    (keyframeId: string) => {
      if (!activeClip) return;
      removeNodeKeyframe(activeClip.id, keyframeId);
    },
    [activeClip, removeNodeKeyframe]
  );

  const handleMoveNodeKeyframeToFrame = useCallback(
    (keyframeId: string) => {
      const kf = nodeKeyframes.find((k) => k.id === keyframeId);
      if (kf) {
        setNodeMoveToFrameKfId(keyframeId);
        setNodeMoveToFrameValue(kf.frame);
      }
    },
    [nodeKeyframes]
  );

  const handleUpdateNodeKeyframe = useCallback(
    (keyframeId: string, updates: Partial<NodeKeyframe>) => {
      if (!activeClip) return;
      updateNodeKeyframe(activeClip.id, keyframeId, updates);
    },
    [activeClip, updateNodeKeyframe]
  );

  const handleNodeMoveToFrameConfirm = useCallback(() => {
    if (nodeMoveToFrameKfId) {
      handleUpdateNodeKeyframe(nodeMoveToFrameKfId, { frame: nodeMoveToFrameValue });
      setNodeMoveToFrameKfId(null);
    }
  }, [nodeMoveToFrameKfId, nodeMoveToFrameValue, handleUpdateNodeKeyframe]);

  const playState = useEditorStore((s) => s.playState);
  const selectedEffectTrackId = useEditorStore((s) => s.selectedEffectTrackId);
  const setPlayState = useEditorStore((s) => s.setPlayState);
  const selectEffectTrack = useEditorStore((s) => s.selectEffectTrack);
  const editMode = useEditorStore((s) => s.editMode);
  const spriteEditSpriteId = useEditorStore((s) => s.spriteEditSpriteId);

  // ---- Puppet session (for H1: Diamond button targets selected puppet node) ----
  const performNodeId = usePuppetSessionStore((s) => s.performNodeId);

  // ---- Dynamic frame width from zoom ----
  const FRAME_WIDTH = useMemo(() => getFrameWidth(timelineZoom), [timelineZoom]);

  // P5-2: Subscribe to currentFrame changes via ref
  useEffect(() => {
    const unsub = useProjectStore.subscribe((state, prevState) => {
      if (state.currentFrame !== prevState.currentFrame) {
        currentFrameRef.current = state.currentFrame;
        const f = state.currentFrame;
        const fw = getFrameWidth(state.timelineZoom);
        if (playheadLineRef.current) {
          playheadLineRef.current.style.left = `${f * fw + fw / 2 - 1}px`;
        }
        if (rulerHighlightRef.current) {
          rulerHighlightRef.current.setAttribute('x', String(f * fw));
          rulerHighlightRef.current.setAttribute('width', String(fw));
        }
        if (frameDisplayRef.current) {
          frameDisplayRef.current.textContent = String(f);
        }
        if (scrollContainerRef.current) {
          const container = scrollContainerRef.current;
          const playheadX = f * fw;
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

  const displayFps = isEditingFps ? fpsInput : String(frameRate);
  const displayFrames = isEditingFrames ? framesInput : String(totalFrames);

  // ---- Refs ----
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const labelScrollRef = useRef<HTMLDivElement>(null);
  const rulerScrollRef = useRef<HTMLDivElement>(null);

  // ---- Virtual Scroll ----
  // Part 轨道已删除：tracks 传空数组（原 tracks 恒为空）
  const { visibleRange, rowOffsets, rowHeights, totalHeight, onScroll: handleVirtualScroll } = useVirtualScroll(
    scrollContainerRef, [], [], effectTracks, canvasModifierTracks, () => [],
    puppetNodes.length, isPuppetClip
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
      // 木偶操控时方向键归木偶 handler（画布拖动/微调），Timeline 不抢
      const activeTool = useEditorStore.getState().tool;
      const puppetOwnsArrows = activeTool === 'puppet';
      switch (e.key) {
        case 'Delete':
        case 'Backspace': {
          if (selectedNodeKeyframeId && activeClip) {
            e.preventDefault();
            removeNodeKeyframe(activeClip.id, selectedNodeKeyframeId);
            setSelectedNodeKeyframeId(null);
          }
          break;
        }
        case ' ': {
          e.preventDefault();
          if (playState === 'playing') { setPlayState('paused'); }
          else { if (currentFrameRef.current >= totalFrames - 1) setCurrentFrame(0); setPlayState('playing'); }
          break;
        }
        case 'ArrowLeft': { if (puppetOwnsArrows) break; e.preventDefault(); setPlayState('paused'); setCurrentFrame(Math.max(0, currentFrameRef.current - 1)); break; }
        case 'ArrowRight': { if (puppetOwnsArrows) break; e.preventDefault(); setPlayState('paused'); setCurrentFrame(Math.min(totalFrames - 1, currentFrameRef.current + 1)); break; }
        case 'Home': { if (puppetOwnsArrows) break; e.preventDefault(); setCurrentFrame(0); break; }
        case 'End': { if (puppetOwnsArrows) break; e.preventDefault(); setCurrentFrame(totalFrames - 1); break; }
        // V15: Timeline zoom shortcuts
        case '=':
        case '+': {
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); setTimelineZoom(Math.min(100, timelineZoom + 2)); }
          break;
        }
        case '-': {
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); setTimelineZoom(Math.max(1, timelineZoom - 2)); }
          break;
        }
        case '0': {
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); setTimelineZoom(DEFAULT_FRAME_WIDTH); }
          break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeKeyframeId, activeClip, playState, totalFrames, removeNodeKeyframe, setPlayState, setCurrentFrame, timelineZoom, setTimelineZoom]);

  // ---- Scroll sync ----
  const handleTrackScroll = useCallback(() => {
    if (labelScrollRef.current && scrollContainerRef.current) {
      labelScrollRef.current.scrollTop = scrollContainerRef.current.scrollTop;
    }
    if (rulerScrollRef.current && scrollContainerRef.current) {
      rulerScrollRef.current.scrollLeft = scrollContainerRef.current.scrollLeft;
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
    // L5: 拖拽播放头时先暂停，避免与播放调度器打架抖动
    if (useEditorStore.getState().playState === 'playing') {
      setPlayState('paused');
    }
    setIsDraggingPlayhead(true);
  }, [setPlayState]);

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
  }, [isDraggingPlayhead, totalFrames, setCurrentFrame, FRAME_WIDTH]);

  // ---- Computed ----
  const currentFrame = currentFrameRef.current;
  const timelineWidth = totalFrames * FRAME_WIDTH;
  const playheadX = currentFrame * FRAME_WIDTH + FRAME_WIDTH / 2;

  const editTrack = editKfTrackId ? effectTracks.find((t) => t.id === editKfTrackId) ?? null : null;

  // Selected node keyframe interpolation mode
  const selectedNodeKf = nodeKeyframes.find((k) => k.id === selectedNodeKeyframeId);
  const selectedKfInterpolationMode = selectedNodeKeyframeId
    ? (selectedNodeKf?.interpolationMode ?? 'linear')
    : undefined;

  // ---- V15: Smart snap helper (returns frame with snap applied) ----
  const snapFrame = useCallback(
    (rawFrame: number, excludeKeyframeId?: string): number => {
      if (!snapConfig.enabled) return rawFrame;

      const fw = getFrameWidth(timelineZoom);
      const threshold = snapConfig.threshold / fw; // Convert pixel threshold to frame distance
      let bestFrame = rawFrame;
      let bestDist = threshold;

      // Snap to frame markers (every 5th frame)
      if (snapConfig.snapToFrameMarkers) {
        for (let f = 0; f < totalFrames; f += 5) {
          const dist = Math.abs(rawFrame - f);
          if (dist < bestDist) { bestDist = dist; bestFrame = f; }
        }
        // Also snap to 0 and totalFrames-1
        const dist0 = Math.abs(rawFrame - 0);
        if (dist0 < bestDist) { bestDist = dist0; bestFrame = 0; }
        const distEnd = Math.abs(rawFrame - (totalFrames - 1));
        if (distEnd < bestDist) { bestDist = distEnd; bestFrame = totalFrames - 1; }
      }

      // Snap to other keyframes
      if (snapConfig.snapToKeyframes) {
        for (const kf of keyframes) {
          if (excludeKeyframeId && kf.id === excludeKeyframeId) continue;
          const dist = Math.abs(rawFrame - kf.frame);
          if (dist < bestDist) { bestDist = dist; bestFrame = kf.frame; }
        }
      }

      // Snap to segment boundaries (0, mid, end)
      if (snapConfig.snapToSegmentBoundaries) {
        const mid = Math.floor(totalFrames / 2);
        const boundaries = [0, mid, totalFrames - 1];
        for (const f of boundaries) {
          const dist = Math.abs(rawFrame - f);
          if (dist < bestDist) { bestDist = dist; bestFrame = f; }
        }
      }

      return bestFrame;
    },
    [snapConfig, timelineZoom, totalFrames, keyframes]
  );

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
        selectedNodeKeyframeId={selectedNodeKeyframeId}
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
          // 木偶是唯一工作流，Diamond 按钮给选中的木偶节点打帧
          if (activeClip && performNodeId) {
            handleAddNodeKeyframe(performNodeId, currentFrameRef.current);
          }
        }}
        onDeleteKeyframe={() => {
          if (selectedNodeKeyframeId && activeClip) {
            removeNodeKeyframe(activeClip.id, selectedNodeKeyframeId);
            setSelectedNodeKeyframeId(null);
          }
        }}
        onInterpolationChange={(mode: InterpolationMode) => {
          if (selectedNodeKeyframeId && activeClip) {
            updateNodeKeyframe(activeClip.id, selectedNodeKeyframeId, { interpolationMode: mode });
          }
        }}
        onEditFpsStart={() => { setFpsInput(String(frameRate)); setIsEditingFps(true); }}
        onEditFramesStart={() => { setFramesInput(String(totalFrames)); setIsEditingFrames(true); }}
        onEditFpsCancel={() => { setFpsInput(String(frameRate)); setIsEditingFps(false); }}
        onEditFramesCancel={() => { setFramesInput(String(totalFrames)); setIsEditingFrames(false); }}
        frameDisplayRef={frameDisplayRef}
        // V15: Pass zoom and snap props
        timelineZoom={timelineZoom}
        onZoomIn={() => setTimelineZoom(Math.min(100, timelineZoom + 2))}
        onZoomOut={() => setTimelineZoom(Math.max(1, timelineZoom - 2))}
        onZoomReset={() => setTimelineZoom(DEFAULT_FRAME_WIDTH)}
        snapConfig={snapConfig}
        onToggleSnap={() => updateSnapConfig({ enabled: !snapConfig.enabled })}
      />

      {/* Timeline Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Track Labels Column */}
        <TrackLabelsColumn
          effectTracks={effectTracks}
          canvasModifierTracks={canvasModifierTracks}
          visibleRange={visibleRange}
          rowOffsets={rowOffsets}
          rowHeights={rowHeights}
          totalHeight={totalHeight}
          selectedEffectTrackId={selectedEffectTrackId}
          onSelectEffectTrack={handleSelectEffectTrack}
          isPuppetClip={isPuppetClip}
          nodeList={puppetNodes as any}
          labelScrollRef={labelScrollRef}
          // V15: Pass track colors and frame step info
          trackTimelineDisplays={trackTimelineDisplays}
          trackFrameSteps={trackFrameSteps}
          onUpdateTrackTimelineDisplay={updateTrackTimelineDisplay}
          onSetTrackFrameStep={setTrackFrameStep}
        />

        {/* Right: Ruler + Keyframe Lanes */}
        <TrackLanesColumn
          effectTracks={effectTracks}
          canvasModifierTracks={canvasModifierTracks}
          totalFrames={totalFrames}
          currentFrame={currentFrame}
          selectedEffectTrackId={selectedEffectTrackId}
          visibleRange={visibleRange}
          rowOffsets={rowOffsets}
          rowHeights={rowHeights}
          totalHeight={totalHeight}
          timelineWidth={timelineWidth}
          playheadX={playheadX}
          scrollContainerRef={scrollContainerRef}
          rulerScrollRef={rulerScrollRef}
          rulerHighlightRef={rulerHighlightRef}
          playheadLineRef={playheadLineRef}
          onScroll={handleTrackScroll}
          onRulerClick={handleRulerClick}
          onSelectEffectTrack={handleSelectEffectTrack}
          onAddEffectKeyframe={handleAddEffectKeyframe}
          onDeleteEffectKeyframe={handleDeleteEffectKeyframe}
          onEditEffectKeyframe={handleEditEffectKeyframe}
          onPlayheadMouseDown={handlePlayheadMouseDown}
          isPuppetClip={isPuppetClip}
          nodeList={puppetNodes as any}
          nodeKeyframes={nodeKeyframes}
          selectedNodeKeyframeId={selectedNodeKeyframeId}
          onSelectNodeKeyframe={handleSelectNodeKeyframe}
          onAddNodeKeyframe={handleAddNodeKeyframe}
          onDeleteNodeKeyframe={handleDeleteNodeKeyframe}
          onMoveNodeKeyframeToFrame={handleMoveNodeKeyframeToFrame}
          onUpdateNodeKeyframe={handleUpdateNodeKeyframe}
          // V15: Pass zoom, snap, and frame step props
          FRAME_WIDTH={FRAME_WIDTH}
          snapConfig={snapConfig}
          snapFrame={snapFrame}
          trackTimelineDisplays={trackTimelineDisplays}
          getEffectiveFrameStep={getEffectiveFrameStep}
          timelineThumbnailQuality={useProjectStore.getState().timelineThumbnailQuality}
        />
      </div>

      {/* Dialogs */}
      <EffectKeyframeEditDialog
        open={editKfDialogOpen}
        onOpenChange={setEditKfDialogOpen}
        effectTrack={editTrack}
        keyframeId={editKfId}
      />

      {/* Node keyframe: Move to Frame dialog */}
      <Dialog open={nodeMoveToFrameKfId !== null} onOpenChange={(open) => { if (!open) setNodeMoveToFrameKfId(null); }}>
        <DialogContent className="bg-[#1a1a2e] border-white/10 text-gray-200 max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm text-gray-100">移动节点关键帧</DialogTitle>
            <DialogDescription className="text-xs text-gray-400">
              将此节点关键帧移动到另一帧
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs text-gray-400">帧</Label>
            <Input
              type="number"
              value={nodeMoveToFrameValue}
              onChange={(e) => setNodeMoveToFrameValue(parseInt(e.target.value) || 0)}
              className="h-7 text-xs bg-white/5 border-white/10 text-gray-300 px-2"
              min={0}
              max={totalFrames - 1}
              step={1}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" className="text-xs text-gray-400 hover:text-gray-200" onClick={() => setNodeMoveToFrameKfId(null)}>取消</Button>
            <Button size="sm" className="text-xs bg-cyan-600 hover:bg-cyan-500 text-white" onClick={handleNodeMoveToFrameConfirm}>移动</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}