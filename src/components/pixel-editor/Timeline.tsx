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
import type { InterpolationMode, ModifierParamValue } from '@/lib/types';
import { resolveCanvasModifierParams } from '@/lib/engine/canvas-modifiers';
import { writePuppetPoseKeyframe } from './canvas/tool-handlers';
import { trackKeyFrames, trackKeyId } from './timeline/NodeTrackLane';
import type { SnapTarget } from '@/lib/v15-types';
import { DEFAULT_FRAME_WIDTH, getFrameWidth, TRACK_COLOR_HUES } from './timeline/constants';
import TimelineControls from './timeline/TimelineControls';
import TrackLabelsColumn from './timeline/TrackLabelsColumn';
import TrackLanesColumn from './timeline/TrackLanesColumn';
import EffectKeyframeEditDialog from './timeline/dialogs/EffectKeyframeEditDialog';
import InputTracksStrip from './timeline/InputTracksStrip';
import CueTrackStrip from './timeline/CueTrackStrip';
import useVirtualScroll from './timeline/useVirtualScroll';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import { interpolateNodeKeyframes } from '@/lib/engine/render-helpers/puppet-keyframe-interpolation';
import { resolveTrackCostumeState } from '@/lib/unified-render';
import type { CostumeStateKeyframe, ModifierInstance, ParamDriver, ParamDriverWaveform, ParamSource } from '@/lib/unified-types';
import { MODIFIER_DEFINITIONS } from '@/lib/types';
import type { ModifierDefinition } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

// ---- Main Timeline Component ----
export default function Timeline() {
  const { toast } = useToast();
  // P5-2: currentFrame removed from reactive subscription — read via ref + subscribe instead
  const currentFrameRef = useRef(useProjectStore.getState().currentFrame);
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const playheadTriangleRef = useRef<HTMLDivElement>(null);
  const frameDisplayRef = useRef<HTMLSpanElement>(null);
  const rulerHighlightRef = useRef<SVGRectElement>(null);

  // ---- Store ----
  const totalFrames = useProjectStore((s) => s.totalFrames);
  const frameRate = useProjectStore((s) => s.frameRate);
  const setCurrentFrame = useProjectStore((s) => s.setCurrentFrame);
  const setFrameRate = useProjectStore((s) => s.setFrameRate);
  const setTotalFrames = useProjectStore((s) => s.setTotalFrames);
  const effectTracks = useProjectStore((s) => s.effectTracks);
  const addEffectKeyframe = useProjectStore((s) => s.addEffectKeyframe);
  const removeEffectKeyframe = useProjectStore((s) => s.removeEffectKeyframe);
  const canvasModifierTracks = useProjectStore((s) => s.canvasModifierTracks);
  const addCanvasModifierKeyframe = useProjectStore((s) => s.addCanvasModifierKeyframe);
  const removeCanvasModifierKeyframe = useProjectStore((s) => s.removeCanvasModifierKeyframe);
  const moveCanvasModifierKeyframe = useProjectStore((s) => s.moveCanvasModifierKeyframe);

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
  const clearNodeFrameKeys = useProjectStore((s) => s.clearNodeFrameKeys);
  const copyNodeFrameKeys = useProjectStore((s) => s.copyNodeFrameKeys);
  const moveNodeFrameKeys = useProjectStore((s) => s.moveNodeFrameKeys);
  const setNodeFrameInterpolation = useProjectStore((s) => s.setNodeFrameInterpolation);
  const updateAnimationClip = useProjectStore((s) => s.updateAnimationClip);

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
  // 全部节点的轨道键（帧并集）：选择/复制/吸附的统一坐标，id = `${nodeId}@${frame}`
  const allTrackKeys = useMemo(() => {
    const out: { id: string; nodeId: string; frame: number }[] = [];
    for (const n of puppetNodes) {
      for (const f of trackKeyFrames(n.tracks)) out.push({ id: trackKeyId(n.id, f), nodeId: n.id, frame: f });
    }
    return out;
  }, [puppetNodes]);
  const parseTrackKey = useCallback((key: string | null): { nodeId: string; frame: number } | null => {
    if (!key) return null;
    const at = key.lastIndexOf('@');
    if (at <= 0) return null;
    const frame = Number(key.slice(at + 1));
    if (!Number.isFinite(frame)) return null;
    return { nodeId: key.slice(0, at), frame };
  }, []);

  // ---- Puppet keyframe selection state ----
  const [selectedNodeKeyframeId, setSelectedNodeKeyframeId] = useState<string | null>(null);
  // 正在编辑的轨道参数驱动器（定位 = 角色 + 节点 + 轨点帧 + 修饰器 + 驱动器）
  const [editingDriver, setEditingDriver] = useState<{
    nodeId: string; frame: number; modifierId: string; driverId: string;
  } | null>(null);
  // 正在编辑的轨点修饰器参数（定位 = 角色 + 节点 + 轨点帧 + 修饰器）
  const [editingModifier, setEditingModifier] = useState<{
    nodeId: string; frame: number; modifierId: string;
  } | null>(null);
  const [nodeMoveToFrameKfId, setNodeMoveToFrameKfId] = useState<string | null>(null);
  const [nodeMoveToFrameValue, setNodeMoveToFrameValue] = useState(0);

  const handleSelectNodeKeyframe = useCallback((id: string) => {
    setSelectedNodeKeyframeId(id || null);
  }, []);

  const handleAddNodeKeyframe = useCallback(
    (nodeId: string, frame: number) => {
      if (!puppetCharacter) return;
      // 用当前帧的插值姿态填充各通道轨点，而不是空值（避免节点弹回静止姿态）
      const iv = interpolateNodeKeyframes(puppetCharacter, frame).get(nodeId);
      const node = puppetCharacter.nodes[nodeId];
      useProjectStore.getState().pushUndo('添加节点关键帧');
      writePuppetPoseKeyframe(puppetCharacter.id, '', nodeId, frame, {
        angle: iv?.angle ?? node?.transform?.angle ?? 0,
        stretch: iv?.stretch ?? node?.transform?.stretch ?? 1,
        scaleX: iv?.scaleX ?? node?.transform?.scaleX ?? 1,
        x: iv?.x ?? node?.transform?.x ?? 0,
        y: iv?.y ?? node?.transform?.y ?? 0,
        // 显式「添加关键帧」：不受自动关键帧开关约束，永远新建
      }, 0, { forceCreate: true });
    },
    [puppetCharacter]
  );

  const handleDeleteNodeKeyframe = useCallback(
    (keyId: string) => {
      if (!puppetCharacter) return;
      const parsed = parseTrackKey(keyId);
      if (!parsed) return;
      clearNodeFrameKeys(puppetCharacter.id, parsed.nodeId, parsed.frame);
      setSelectedNodeKeyframeId((cur) => (cur === keyId ? null : cur));
    },
    [puppetCharacter, parseTrackKey, clearNodeFrameKeys]
  );

  const handleDuplicateNodeKeyframe = useCallback(
    (keyId: string) => {
      if (!puppetCharacter) return;
      const parsed = parseTrackKey(keyId);
      if (!parsed) return;
      const node = puppetCharacter.nodes[parsed.nodeId];
      if (!node) return;
      // 新帧 = 原帧+1（若冲突则找下一个空位）
      const usedFrames = new Set(trackKeyFrames(node.tracks));
      let newFrame = parsed.frame + 1;
      while (usedFrames.has(newFrame) && newFrame < totalFrames) newFrame++;
      if (newFrame >= totalFrames) return;
      copyNodeFrameKeys(puppetCharacter.id, parsed.nodeId, parsed.frame, newFrame);
    },
    [puppetCharacter, parseTrackKey, totalFrames, copyNodeFrameKeys]
  );

  const handleMoveNodeKeyframeToFrame = useCallback(
    (keyId: string) => {
      const parsed = parseTrackKey(keyId);
      if (parsed) {
        setNodeMoveToFrameKfId(keyId);
        setNodeMoveToFrameValue(parsed.frame);
      }
    },
    [parseTrackKey]
  );

  const handleUpdateNodeKeyframe = useCallback(
    (keyId: string, updates: { frame?: number }) => {
      if (!puppetCharacter) return;
      const parsed = parseTrackKey(keyId);
      if (!parsed) return;
      if (updates.frame !== undefined && updates.frame !== parsed.frame) {
        // 目标帧已有该节点的点时 move 内部拒绝（与拖拽碰撞口径一致）
        if (moveNodeFrameKeys(puppetCharacter.id, parsed.nodeId, parsed.frame, updates.frame)) {
          setSelectedNodeKeyframeId((cur) => (cur === keyId ? trackKeyId(parsed.nodeId, updates.frame!) : cur));
        }
      }
    },
    [puppetCharacter, parseTrackKey, moveNodeFrameKeys]
  );

  const handleNodeMoveToFrameConfirm = useCallback(() => {
    if (nodeMoveToFrameKfId) {
      handleUpdateNodeKeyframe(nodeMoveToFrameKfId, { frame: nodeMoveToFrameValue });
      setNodeMoveToFrameKfId(null);
    }
  }, [nodeMoveToFrameKfId, nodeMoveToFrameValue, handleUpdateNodeKeyframe]);

  /** 子车道点击定位：跳到该帧、选中该轨道键与节点 */
  const handleSeekTrackKey = useCallback(
    (nodeId: string, frame: number) => {
      setCurrentFrame(frame);
      setSelectedNodeKeyframeId(trackKeyId(nodeId, frame));
      useProjectStore.getState().setSelectedNodeId(nodeId);
    },
    [setCurrentFrame]
  );

  // 驱动器「编辑」：先跳帧+选中（保留旧导航行为），再打开编辑器。
  // 旧实现只跳帧、把 modifierId/driverId 丢掉，编辑器从未存在，按钮是死路。
  const handleEditParamDriver = useCallback(
    (nodeId: string, frame: number, modifierId: string, driverId: string) => {
      handleSeekTrackKey(nodeId, frame);
      if (puppetCharacter) setEditingDriver({ nodeId, frame, modifierId, driverId });
    },
    [handleSeekTrackKey, puppetCharacter]
  );

  // 修饰器参数「编辑」：先跳帧+选中（保留旧导航行为），再打开参数编辑器。
  // 旧实现只跳帧、把 modifierId 丢掉，编辑器从未存在，菱形标记只是定位入口。
  const handleEditModifierParams = useCallback(
    (nodeId: string, frame: number, modifierId: string) => {
      handleSeekTrackKey(nodeId, frame);
      if (puppetCharacter) setEditingModifier({ nodeId, frame, modifierId });
    },
    [handleSeekTrackKey, puppetCharacter]
  );

  // 编辑器目标修饰器（store 直读；目标消失则自动关窗）
  const editingModifierData = useMemo(() => {
    if (!editingModifier || !puppetCharacter) return null;
    const node = puppetCharacter.nodes[editingModifier.nodeId];
    const pt = node?.tracks?.modifierKeys?.keyframes.find((k) => k.frame === editingModifier.frame);
    const modifiers = pt?.value ?? [];
    const mod = modifiers.find((m) => m.id === editingModifier.modifierId);
    if (!node || !mod) return null;
    const def = MODIFIER_DEFINITIONS.find((d) => d.type === mod.type) ?? null;
    return { characterId: puppetCharacter.id, node, modifiers, mod, def };
  }, [editingModifier, puppetCharacter]);
  useEffect(() => {
    if (editingModifier && !editingModifierData) setEditingModifier(null);
  }, [editingModifier, editingModifierData]);

  // 编辑器目标驱动器（store 直读，删改后实时一致；目标消失则自动关窗）
  const editingDriverData = useMemo(() => {
    if (!editingDriver || !puppetCharacter) return null;
    const node = puppetCharacter.nodes[editingDriver.nodeId];
    const pt = node?.tracks?.modifierKeys?.keyframes.find((k) => k.frame === editingDriver.frame);
    const mod = pt?.value.find((m) => m.id === editingDriver.modifierId);
    const driver = mod?.paramDrivers?.find((d) => d.id === editingDriver.driverId);
    if (!node || !mod || !driver) return null;
    const modLabel = MODIFIER_DEFINITIONS.find((d) => d.type === mod.type)?.label ?? mod.type;
    return { characterId: puppetCharacter.id, node, mod, driver, modLabel };
  }, [editingDriver, puppetCharacter]);
  useEffect(() => {
    if (editingDriver && !editingDriverData) setEditingDriver(null);
  }, [editingDriver, editingDriverData]);

  // ---- 服装/变体状态轨道（clip 级） ----
  const [selectedStateKfFrame, setSelectedStateKfFrame] = useState<number | null>(null);
  const stateKeyframes = useMemo(
    () => activeClip?.stateKeyframes ?? [],
    [activeClip]
  );
  /** 当前帧轨道生效状态摘要（静态+轨道口径，不含状态蓝图层；帧读 ref 与 Lanes 同口径） */
  const costumeStateSummary = (() => {
    if (!puppetCharacter) return '';
    const eff = resolveTrackCostumeState(puppetCharacter, currentFrameRef.current, stateKeyframes);
    const setName = puppetCharacter.costumeSets.find((cs) => cs.id === eff.costumeSetId)?.name ?? '无服装集';
    const parts = Object.entries(eff.slotVariants).map(([slot, vid]) => {
      const vName = (puppetCharacter.variantDefs ?? []).find((v) => v.id === vid)?.name ?? vid.slice(0, 6);
      return `${slot}:${vName}`;
    });
    return parts.length > 0 ? `${setName} · ${parts.join(' ')}` : setName;
  })();

  /** 在当前帧记录状态键：把角色当前静态状态与「本帧之前轨道求值」的差异写成增量键 */
  const handleRecordStateKeyframe = useCallback(() => {
    if (!activeClip || !puppetCharacter) return;
    const frame = currentFrameRef.current;
    const prev = resolveTrackCostumeState(
      puppetCharacter, frame, stateKeyframes.filter((k) => k.frame < frame)
    );
    const targetSetId = puppetCharacter.activeCostumeSetId;
    const targetSlots = puppetCharacter.slotVariants ?? {};
    const key: CostumeStateKeyframe = { frame };
    if (targetSetId && targetSetId !== prev.costumeSetId) key.costumeSetId = targetSetId;
    const slotChanges: Record<string, string | null> = {};
    for (const slot of new Set([...Object.keys(prev.slotVariants), ...Object.keys(targetSlots)])) {
      if (targetSlots[slot] !== prev.slotVariants[slot]) {
        slotChanges[slot] = targetSlots[slot] ?? null;
      }
    }
    if (Object.keys(slotChanges).length > 0) key.slotChanges = slotChanges;
    const hasChanges = key.costumeSetId !== undefined || key.slotChanges !== undefined;
    const rest = stateKeyframes.filter((k) => k.frame !== frame);
    const next = hasChanges ? [...rest, key].sort((a, b) => a.frame - b.frame) : rest;
    updateAnimationClip(activeClip.id, { stateKeyframes: next });
    setSelectedStateKfFrame(hasChanges ? frame : null);
  }, [activeClip, puppetCharacter, stateKeyframes, updateAnimationClip]);

  const handleDeleteStateKeyframe = useCallback(
    (frame: number) => {
      if (!activeClip) return;
      updateAnimationClip(activeClip.id, {
        stateKeyframes: stateKeyframes.filter((k) => k.frame !== frame),
      });
      if (selectedStateKfFrame === frame) setSelectedStateKfFrame(null);
    },
    [activeClip, stateKeyframes, selectedStateKfFrame, updateAnimationClip]
  );

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
  const tagStripScrollRef = useRef<HTMLDivElement>(null);
  const inputStripScrollRef = useRef<HTMLDivElement>(null);
  const cueStripScrollRef = useRef<HTMLDivElement>(null);

  // ---- Virtual Scroll ----
  // Part 轨道已删除：tracks 传空数组（原 tracks 恒为空）
  const { visibleRange, rowOffsets, rowHeights, totalHeight, onScroll: handleVirtualScroll } = useVirtualScroll(
    scrollContainerRef, [], [], effectTracks, canvasModifierTracks,
    puppetNodes as any, isPuppetClip,
    !!(activeClip && puppetCharacter && puppetNodes.length > 0)
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
          if (selectedNodeKeyframeId) {
            e.preventDefault();
            handleDeleteNodeKeyframe(selectedNodeKeyframeId);
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
  }, [selectedNodeKeyframeId, handleDeleteNodeKeyframe, playState, totalFrames, setPlayState, setCurrentFrame, timelineZoom, setTimelineZoom]);

  // ---- Scroll sync ----
  const handleTrackScroll = useCallback(() => {
    if (labelScrollRef.current && scrollContainerRef.current) {
      labelScrollRef.current.scrollTop = scrollContainerRef.current.scrollTop;
    }
    if (rulerScrollRef.current && scrollContainerRef.current) {
      rulerScrollRef.current.scrollLeft = scrollContainerRef.current.scrollLeft;
    }
    if (tagStripScrollRef.current && scrollContainerRef.current) {
      tagStripScrollRef.current.scrollLeft = scrollContainerRef.current.scrollLeft;
    }
    if (inputStripScrollRef.current && scrollContainerRef.current) {
      inputStripScrollRef.current.scrollLeft = scrollContainerRef.current.scrollLeft;
    }
    if (cueStripScrollRef.current && scrollContainerRef.current) {
      cueStripScrollRef.current.scrollLeft = scrollContainerRef.current.scrollLeft;
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

  // ---- Canvas modifier track handlers ----
  // 加帧时快照该帧各修改器的解析参数（加帧不改变当前画面，之后在面板
  // 里改参即写这一帧的关键帧）；编辑 = 把播放头跳到该帧（面板改参写关键帧）。
  const handleAddCanvasModifierKeyframe = useCallback((trackId: string, frame: number) => {
    const track = useProjectStore.getState().canvasModifierTracks.find((t) => t.id === trackId);
    if (!track) return;
    const bag: Record<string, ModifierParamValue> = {};
    for (const m of track.modifiers) Object.assign(bag, resolveCanvasModifierParams(track, m, frame));
    addCanvasModifierKeyframe(trackId, frame, bag);
  }, [addCanvasModifierKeyframe]);
  const handleDeleteCanvasModifierKeyframe = useCallback((trackId: string, keyframeId: string) => { removeCanvasModifierKeyframe(trackId, keyframeId); }, [removeCanvasModifierKeyframe]);
  const handleEditCanvasModifierKeyframe = useCallback((trackId: string, keyframeId: string) => {
    const track = useProjectStore.getState().canvasModifierTracks.find((t) => t.id === trackId);
    const kf = track?.keyframes.find((k) => k.id === keyframeId);
    if (kf) setCurrentFrame(kf.frame);
  }, [setCurrentFrame]);
  const handleMoveCanvasModifierKeyframe = useCallback((trackId: string, keyframeId: string, frame: number) => { moveCanvasModifierKeyframe(trackId, keyframeId, frame); }, [moveCanvasModifierKeyframe]);

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

  // Selected track key interpolation mode（读该帧第一个数值通道点的覆盖，无则轨缺省）
  const selectedKfInterpolationMode = (() => {
    const parsed = parseTrackKey(selectedNodeKeyframeId);
    if (!parsed || !puppetCharacter) return undefined;
    const tracks = puppetCharacter.nodes[parsed.nodeId]?.tracks;
    if (!tracks) return 'linear';
    for (const key of ['angle', 'x', 'y', 'stretch', 'scaleX', 'tilt', 'variantIndex', 'zIndex'] as const) {
      const track = tracks[key];
      const pt = track?.keyframes.find((k) => k.frame === parsed.frame);
      if (pt) return pt.interpolation ?? track?.interpolation ?? 'linear';
    }
    return 'linear';
  })();

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

      // Snap to other track keys (puppet node tracks)
      if (snapConfig.snapToKeyframes) {
        for (const kf of allTrackKeys) {
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
    [snapConfig, timelineZoom, totalFrames, allTrackKeys]
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
          } else if (!performNodeId) {
            toast({ title: '请先选择节点', description: '在画布上点击一个木偶节点后再打关键帧' });
          }
        }}
        onDeleteKeyframe={() => {
          if (selectedNodeKeyframeId) {
            handleDeleteNodeKeyframe(selectedNodeKeyframeId);
          }
        }}
        onInterpolationChange={(mode: InterpolationMode) => {
          const parsed = parseTrackKey(selectedNodeKeyframeId);
          if (parsed && puppetCharacter) {
            setNodeFrameInterpolation(puppetCharacter.id, parsed.nodeId, parsed.frame, mode);
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

      {/* 输入轨（角色级：行为图宿主输入） */}
      {puppetCharacter && (
        <InputTracksStrip
          character={puppetCharacter}
          totalFrames={totalFrames}
          currentFrame={currentFrame}
          frameWidth={FRAME_WIDTH}
          timelineWidth={timelineWidth}
          scrollRef={inputStripScrollRef}
        />
      )}

      {/* 事件轨（角色级：定格/震屏关键帧，perform-fx 采样消费） */}
      {puppetCharacter && (
        <CueTrackStrip
          character={puppetCharacter}
          totalFrames={totalFrames}
          currentFrame={currentFrame}
          frameWidth={FRAME_WIDTH}
          timelineWidth={timelineWidth}
          scrollRef={cueStripScrollRef}
        />
      )}

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
          tagStripVisible={(activeClip?.frameTags?.length ?? 0) > 0}
          // V15: Pass track colors and frame step info
          trackTimelineDisplays={trackTimelineDisplays}
          trackFrameSteps={trackFrameSteps}
          onUpdateTrackTimelineDisplay={updateTrackTimelineDisplay}
          onSetTrackFrameStep={setTrackFrameStep}
          costumeState={activeClip && puppetCharacter ? {
            summary: costumeStateSummary,
            selectedFrame: selectedStateKfFrame,
            onRecord: handleRecordStateKeyframe,
            onDeleteSelected: () => {
              if (selectedStateKfFrame !== null) handleDeleteStateKeyframe(selectedStateKfFrame);
            },
          } : null}
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
          tagStripScrollRef={tagStripScrollRef}
          frameTags={activeClip?.frameTags ?? []}
          rulerHighlightRef={rulerHighlightRef}
          playheadLineRef={playheadLineRef}
          onScroll={handleTrackScroll}
          onRulerClick={handleRulerClick}
          onSelectEffectTrack={handleSelectEffectTrack}
          onAddEffectKeyframe={handleAddEffectKeyframe}
          onDeleteEffectKeyframe={handleDeleteEffectKeyframe}
          onEditEffectKeyframe={handleEditEffectKeyframe}
          onAddCanvasModifierKeyframe={handleAddCanvasModifierKeyframe}
          onDeleteCanvasModifierKeyframe={handleDeleteCanvasModifierKeyframe}
          onEditCanvasModifierKeyframe={handleEditCanvasModifierKeyframe}
          onMoveCanvasModifierKeyframe={handleMoveCanvasModifierKeyframe}
          onPlayheadMouseDown={handlePlayheadMouseDown}
          isPuppetClip={isPuppetClip}
          nodeList={puppetNodes as any}
          characterId={puppetCharacter?.id ?? null}
          clipWindow={activeClip && puppetCharacter && activeClip.puppetCharacterId === puppetCharacter.id
            ? { startFrame: activeClip.startFrame, endFrame: activeClip.endFrame }
            : null}
          selectedNodeKeyframeId={selectedNodeKeyframeId}
          onSelectNodeKeyframe={handleSelectNodeKeyframe}
          onAddNodeKeyframe={handleAddNodeKeyframe}
          onDeleteNodeKeyframe={handleDeleteNodeKeyframe}
          onDuplicateNodeKeyframe={handleDuplicateNodeKeyframe}
          onMoveNodeKeyframeToFrame={handleMoveNodeKeyframeToFrame}
          onUpdateNodeKeyframe={handleUpdateNodeKeyframe}
          onEditModifierParams={handleEditModifierParams}
          onEditParamDriver={handleEditParamDriver}
          // V15: Pass zoom, snap, and frame step props
          FRAME_WIDTH={FRAME_WIDTH}
          snapConfig={snapConfig}
          snapFrame={snapFrame}
          trackTimelineDisplays={trackTimelineDisplays}
          getEffectiveFrameStep={getEffectiveFrameStep}
          timelineThumbnailQuality={useProjectStore.getState().timelineThumbnailQuality}
          costumeState={activeClip && puppetCharacter ? {
            keyframes: stateKeyframes,
            selectedFrame: selectedStateKfFrame,
            onSelectKeyframe: setSelectedStateKfFrame,
          } : null}
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

      {/* Node keyframe: Modifier params editor */}
      {editingModifier && editingModifierData && (
        <ModifierParamsEditorDialog
          key={`${editingModifier.nodeId}-${editingModifier.frame}-${editingModifier.modifierId}`}
          characterId={editingModifierData.characterId}
          nodeId={editingModifier.nodeId}
          frame={editingModifier.frame}
          modifiers={editingModifierData.modifiers}
          mod={editingModifierData.mod}
          def={editingModifierData.def}
          nodeName={editingModifierData.node.name}
          onClose={() => setEditingModifier(null)}
        />
      )}

      {/* Node keyframe: ParamDriver editor */}
      {editingDriver && editingDriverData && (
        <ParamDriverEditorDialog
          key={`${editingDriver.nodeId}-${editingDriver.frame}-${editingDriver.driverId}`}
          characterId={editingDriverData.characterId}
          nodeId={editingDriver.nodeId}
          frame={editingDriver.frame}
          modifierId={editingDriver.modifierId}
          driver={editingDriverData.driver}
          nodeName={editingDriverData.node.name}
          modLabel={editingDriverData.modLabel}
          nodes={puppetNodes.map((n: any) => ({ id: n.id, name: n.name }))}
          onClose={() => setEditingDriver(null)}
        />
      )}
    </div>
  );
}

const WAVEFORM_LABELS: Record<ParamDriverWaveform, string> = {
  sine: '正弦', square: '方波', triangle: '三角波', sawtooth: '锯齿波',
  noise: '噪声', bounce: '弹跳', spring: '弹簧', custom: '自定义',
};

type DriverSourceKind = 'none' | 'constant' | 'node_angle' | 'node_stretch' | 'variable';

function sourceKindOf(source: ParamSource | undefined): DriverSourceKind {
  if (!source) return 'none';
  return source.type;
}

/** 轨道参数驱动器编辑器：改波形/幅值/频率/相位/偏移/启用/来源，或删除驱动器。
 *  保存与删除各走一次 store 动作（各压一条撤销），不逐字段写。 */
function ParamDriverEditorDialog({
  characterId, nodeId, frame, modifierId, driver, nodeName, modLabel, nodes, onClose,
}: {
  characterId: string; nodeId: string; frame: number; modifierId: string;
  driver: ParamDriver; nodeName: string; modLabel: string;
  nodes: { id: string; name: string }[];
  onClose: () => void;
}) {
  const updateTrackParamDriver = useProjectStore((s) => s.updateTrackParamDriver);
  const removeTrackParamDriver = useProjectStore((s) => s.removeTrackParamDriver);
  const [waveform, setWaveform] = useState<ParamDriverWaveform>(driver.waveform);
  const [amplitude, setAmplitude] = useState(driver.amplitude);
  const [frequency, setFrequency] = useState(driver.frequency);
  const [phase, setPhase] = useState(driver.phase);
  const [offset, setOffset] = useState(driver.offset);
  const [enabled, setEnabled] = useState(driver.enabled);
  const [sourceKind, setSourceKind] = useState<DriverSourceKind>(sourceKindOf(driver.source));
  const [sourceValue, setSourceValue] = useState(
    driver.source?.type === 'constant' ? driver.source.value : 0);
  const [sourceNodeId, setSourceNodeId] = useState(
    (driver.source?.type === 'node_angle' || driver.source?.type === 'node_stretch')
      ? driver.source.nodeId : (nodes[0]?.id ?? ''));
  const [sourceVariable, setSourceVariable] = useState(
    driver.source?.type === 'variable' ? driver.source.variableName : '');

  const num = (setter: (v: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (!Number.isNaN(v)) setter(v);
  };
  const buildSource = (): ParamSource | undefined => {
    if (sourceKind === 'constant') return { type: 'constant', value: sourceValue };
    if (sourceKind === 'node_angle') return { type: 'node_angle', nodeId: sourceNodeId };
    if (sourceKind === 'node_stretch') return { type: 'node_stretch', nodeId: sourceNodeId };
    if (sourceKind === 'variable') return { type: 'variable', variableName: sourceVariable };
    return undefined;
  };
  const handleSave = () => {
    updateTrackParamDriver(characterId, nodeId, frame, modifierId, driver.id, {
      waveform, amplitude, frequency, phase, offset, enabled, source: buildSource(),
    });
    onClose();
  };
  const handleDelete = () => {
    removeTrackParamDriver(characterId, nodeId, frame, modifierId, driver.id);
    onClose();
  };

  const fieldCls = 'h-7 text-xs bg-white/5 border-white/10 text-gray-300 px-2';
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-[#1a1a2e] border-white/10 text-gray-200 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm text-gray-100">编辑参数驱动器</DialogTitle>
          <DialogDescription className="text-xs text-gray-400">
            {nodeName} · 第 {frame} 帧 · {modLabel}.{driver.targetParam}
            （目标参数创建时确定，此处不改）
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <div>
            <Label className="text-xs text-gray-400">波形</Label>
            <select
              value={waveform}
              onChange={(e) => setWaveform(e.target.value as ParamDriverWaveform)}
              className={`w-full rounded ${fieldCls}`}
            >
              {(Object.keys(WAVEFORM_LABELS) as ParamDriverWaveform[]).map((w) => (
                <option key={w} value={w}>{WAVEFORM_LABELS[w]}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-gray-400">幅值</Label>
              <Input type="number" value={amplitude} onChange={num(setAmplitude)} className={fieldCls} />
            </div>
            <div>
              <Label className="text-xs text-gray-400">频率</Label>
              <Input type="number" value={frequency} onChange={num(setFrequency)} className={fieldCls} step="0.1" />
            </div>
            <div>
              <Label className="text-xs text-gray-400">相位</Label>
              <Input type="number" value={phase} onChange={num(setPhase)} className={fieldCls} step="0.1" />
            </div>
            <div>
              <Label className="text-xs text-gray-400">偏移</Label>
              <Input type="number" value={offset} onChange={num(setOffset)} className={fieldCls} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            启用驱动器
          </label>
          <div>
            <Label className="text-xs text-gray-400">来源</Label>
            <select
              value={sourceKind}
              onChange={(e) => setSourceKind(e.target.value as DriverSourceKind)}
              className={`w-full rounded ${fieldCls}`}
            >
              <option value="none">无（波形直驱）</option>
              <option value="constant">常量</option>
              <option value="node_angle">节点角度</option>
              <option value="node_stretch">节点拉伸</option>
              <option value="variable">变量</option>
            </select>
          </div>
          {sourceKind === 'constant' && (
            <div>
              <Label className="text-xs text-gray-400">常量值</Label>
              <Input type="number" value={sourceValue} onChange={num(setSourceValue)} className={fieldCls} />
            </div>
          )}
          {(sourceKind === 'node_angle' || sourceKind === 'node_stretch') && (
            <div>
              <Label className="text-xs text-gray-400">来源节点</Label>
              <select
                value={sourceNodeId}
                onChange={(e) => setSourceNodeId(e.target.value)}
                className={`w-full rounded ${fieldCls}`}
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>
            </div>
          )}
          {sourceKind === 'variable' && (
            <div>
              <Label className="text-xs text-gray-400">变量名</Label>
              <Input value={sourceVariable} onChange={(e) => setSourceVariable(e.target.value)} className={fieldCls} />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" className="text-xs text-red-400 hover:text-red-300 mr-auto" onClick={handleDelete}>删除驱动器</Button>
          <Button variant="ghost" size="sm" className="text-xs text-gray-400 hover:text-gray-200" onClick={onClose}>取消</Button>
          <Button size="sm" className="text-xs bg-purple-600 hover:bg-purple-500 text-white" onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 轨点修饰器参数编辑器：按修饰器类型定义动态出表单，改完整组写回该帧。
 *  保存与移除各走一次 store 动作（各压一条撤销）；空组写回即删点（setNodeModifierKey 语义）。
 *  路径/复合值参数不在此编辑（只读显示），避免把数组值塞进数字框写坏。 */
function ModifierParamsEditorDialog({
  characterId, nodeId, frame, modifiers, mod, def, nodeName, onClose,
}: {
  characterId: string; nodeId: string; frame: number;
  modifiers: ModifierInstance[]; mod: ModifierInstance;
  def: ModifierDefinition | null; nodeName: string;
  onClose: () => void;
}) {
  const setNodeModifierKey = useProjectStore((s) => s.setNodeModifierKey);
  const [params, setParams] = useState<ModifierInstance['params']>(() => ({ ...(mod.params ?? {}) }));
  const [enabled, setEnabled] = useState(mod.enabled);
  const setParam = (name: string, value: ModifierInstance['params'][string]) =>
    setParams((prev) => ({ ...prev, [name]: value }));
  const num = (name: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (!Number.isNaN(v)) setParam(name, v);
  };
  const handleSave = () => {
    const next = modifiers.map((m) => (m.id === mod.id ? { ...m, params, enabled } : m));
    setNodeModifierKey(characterId, nodeId, frame, next);
    onClose();
  };
  const handleRemove = () => {
    setNodeModifierKey(characterId, nodeId, frame, modifiers.filter((m) => m.id !== mod.id));
    onClose();
  };

  const fieldCls = 'h-7 text-xs bg-white/5 border-white/10 text-gray-300 px-2';
  const isScalar = (v: unknown) =>
    typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-[#1a1a2e] border-white/10 text-gray-200 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm text-gray-100">编辑修饰器参数</DialogTitle>
          <DialogDescription className="text-xs text-gray-400">
            {nodeName} · 第 {frame} 帧 · {def?.label ?? mod.type}
            {def ? '' : '（该类型无参数定义，只可开关与移除）'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            启用修饰器
          </label>
          {(def?.params ?? []).map((param) => {
            const raw = params[param.name] ?? param.default;
            if (param.type === 'path' || !isScalar(raw)) {
              return (
                <div key={param.name} className="flex items-center gap-2">
                  <label className="text-xs text-gray-400 w-20 shrink-0 truncate" title={param.label}>{param.label}</label>
                  <span className="text-xs text-gray-500">该参数不在此编辑（路径/复合值）</span>
                </div>
              );
            }
            return (
              <div key={param.name} className="flex items-center gap-2">
                <label className="text-xs text-gray-400 w-20 shrink-0 truncate" title={param.label}>{param.label}</label>
                {param.type === 'boolean' ? (
                  <Button
                    variant="ghost" size="sm"
                    className={`h-6 text-xs px-2 ${raw ? 'text-purple-400' : 'text-zinc-500'}`}
                    onClick={() => setParam(param.name, !raw)}
                  >
                    {raw ? '开' : '关'}
                  </Button>
                ) : param.type === 'select' ? (
                  <select
                    value={String(raw)}
                    onChange={(e) => {
                      const opt = param.options?.find((o) => String(o.value) === e.target.value);
                      setParam(param.name, opt ? opt.value : e.target.value);
                    }}
                    className={`flex-1 rounded ${fieldCls}`}
                  >
                    {param.options?.map((opt) => (
                      <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>
                    ))}
                  </select>
                ) : param.type === 'color' ? (
                  <input
                    type="color"
                    value={typeof raw === 'string' ? raw : String(param.default)}
                    onChange={(e) => setParam(param.name, e.target.value)}
                    className="h-6 w-10 bg-transparent border-0 cursor-pointer"
                  />
                ) : param.type === 'string' ? (
                  <Input value={String(raw)} onChange={(e) => setParam(param.name, e.target.value)} className={`flex-1 ${fieldCls}`} />
                ) : (
                  <div className="flex items-center gap-1 flex-1">
                    <Input
                      type="number" value={Number(raw)} onChange={num(param.name)}
                      step={param.step ?? 1} min={param.min} max={param.max}
                      className={`flex-1 ${fieldCls}`}
                    />
                    {param.min !== undefined && param.max !== undefined && (
                      <input
                        type="range" value={Number(raw)} onChange={(e) => setParam(param.name, Number(e.target.value))}
                        min={param.min} max={param.max} step={param.step ?? 1}
                        className="flex-1 h-1 accent-purple-500"
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" className="text-xs text-red-400 hover:text-red-300 mr-auto" onClick={handleRemove}>从该帧移除修饰器</Button>
          <Button variant="ghost" size="sm" className="text-xs text-gray-400 hover:text-gray-200" onClick={onClose}>取消</Button>
          <Button size="sm" className="text-xs bg-purple-600 hover:bg-purple-500 text-white" onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}