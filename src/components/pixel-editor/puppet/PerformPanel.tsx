'use client';

// ============================================================
// PerformPanel — 木偶操控面板（新工作流核心）
// 一键进入操控 → 画布直接拖动木偶 → 自动录制关键帧。
// 替代原来的 AnimateModePanel + AnimateControls。
// ============================================================

import React, { useMemo, useEffect } from 'react';
import {
  Play,
  Pause,
  StepBack,
  StepForward,
  CircleDot,
  Eraser,
  ChevronLeft,
  ChevronRight,
  Square,
  Ghost,
  Magnet,
  Keyboard,
  ArrowUpToLine,
  ArrowUp,
  ArrowDown,
  ArrowDownToLine,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import { interpolateNodeKeyframes } from '@/lib/engine/render-helpers/puppet-keyframe-interpolation';
import DirectionWheel, { oldDirectionToIndex, directionIndexToOldDirection } from '../DirectionWheel';
import BlueprintTemplateLoader from './BlueprintTemplateLoader';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { PuppetDirection } from '@/lib/types';

export default function PerformPanel({ hideNodeList = false }: { hideNodeList?: boolean }) {
  const puppetCharacters = useProjectStore((s) => s.puppetCharacters) ?? [];
  const puppetSkeletons = useProjectStore((s) => s.puppetSkeletons) ?? [];
  const animationClips = useProjectStore((s) => s.animationClips);
  const currentFrame = useProjectStore((s) => s.currentFrame);
  const setCurrentFrame = useProjectStore((s) => s.setCurrentFrame);

  const performCharacterId = usePuppetSessionStore((s) => s.performCharacterId);
  const performNodeId = usePuppetSessionStore((s) => s.performNodeId);
  const performArmed = usePuppetSessionStore((s) => s.performArmed);
  const autoKeyframe = usePuppetSessionStore((s) => s.autoKeyframe);
  // 木偶洋葱皮开关与顶端工具栏同构：直接读写 onionSkinEnabled，不再用独立的 puppetOnionSkin
  const onionSkinEnabled = useProjectStore((s) => s.onionSkinEnabled);
  const toggleOnionSkin = useProjectStore((s) => s.toggleOnionSkin);
  const setPerformNodeId = usePuppetSessionStore((s) => s.setPerformNodeId);
  const setAutoKeyframe = usePuppetSessionStore((s) => s.setAutoKeyframe);
  const enterPerform = usePuppetSessionStore((s) => s.enterPerform);
  const exitPerform = usePuppetSessionStore((s) => s.exitPerform);
  const recordFullPose = usePuppetSessionStore((s) => s.recordFullPose);
  const clearFramePose = usePuppetSessionStore((s) => s.clearFramePose);

  const playState = useEditorStore((s) => s.playState);
  const setPlayState = useEditorStore((s) => s.setPlayState);

  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const character = useMemo(
    () => puppetCharacters.find((c) => c.puppetSkeletonId === activePuppetSkeletonId) ?? null,
    [puppetCharacters, activePuppetSkeletonId]
  );
  const skeleton = useMemo(
    () => puppetSkeletons.find((s) => s.id === activePuppetSkeletonId) ?? null,
    [puppetSkeletons, activePuppetSkeletonId]
  );
  const clip = useMemo(
    () => animationClips.find((c) => c.puppetCharacterId === performCharacterId) ?? null,
    [animationClips, performCharacterId]
  );

  // 每节点在当前帧的插值姿态（面板读数用，与画布一致）
  const interpolated = useMemo(() => {
    if (!skeleton) return new Map();
    return interpolateNodeKeyframes(skeleton, clip?.puppetNodeKeyframes ?? [], currentFrame);
  }, [skeleton, clip, currentFrame]);

  // 该角色全部关键帧所在帧（排序去重），用于上一/下一关键帧导航
  const keyframedFrames = useMemo(() => {
    const frames = new Set<number>();
    for (const kf of clip?.puppetNodeKeyframes ?? []) frames.add(kf.frame);
    return [...frames].sort((a, b) => a - b);
  }, [clip]);

  const totalFrames = clip?.totalFrames ?? 24;

  // 选中角色时自动进入操控（无需"开始操控"按钮）
  useEffect(() => {
    if (character && !performArmed) {
      enterPerform(character.id);
    }
  }, [character?.id]);

  const gotoPrevKeyframe = () => {
    const prev = [...keyframedFrames].reverse().find((f) => f < currentFrame);
    if (prev !== undefined) { setPlayState('paused'); setCurrentFrame(prev); }
  };
  const gotoNextKeyframe = () => {
    const next = keyframedFrames.find((f) => f > currentFrame);
    if (next !== undefined) { setPlayState('paused'); setCurrentFrame(next); }
  };

  const togglePlay = () => {
    if (playState === 'playing') setPlayState('paused');
    else {
      if (currentFrame >= totalFrames - 1) setCurrentFrame(0);
      setPlayState('playing');
    }
  };

  return (
    <div className="space-y-3">
      {/* ---- 状态条 ---- */}
      <div
        className="flex items-center gap-2 px-2 py-1.5 rounded border bg-emerald-500/10 border-emerald-500/30"
      >
        <span className="size-2 rounded-full flex-shrink-0 bg-emerald-400 animate-pulse" />
        <span className="text-[10px] font-medium truncate flex-1 min-w-0 text-emerald-300">
          {character ? `操控中 · ${character.name}` : '请选择角色'}
        </span>
        <span className="text-[10px] text-gray-500 tabular-nums">
          帧 {currentFrame}/{totalFrames - 1}
        </span>
      </div>

      {/* ---- 进入/退出操控（角色用左侧选中的） ---- */}
      <div className="space-y-1.5">
        {puppetCharacters.length === 0 && (
          <p className="text-[9px] text-amber-500/80">还没有角色 — 先去「搭建」阶段创建骨骼与角色</p>
        )}
        {puppetCharacters.length > 0 && !activePuppetSkeletonId && (
          <p className="text-[9px] text-amber-500/80">请在左侧面板选择骨架</p>
        )}
        {activePuppetSkeletonId && skeleton && !character && (
          <p className="text-[9px] text-red-500/80">
            骨架「{skeleton.name}」没有关联角色（数据异常，裸骨架不应存在）
          </p>
        )}
        {/* 选中角色后自动进入操控，无需按钮 */}
        {performArmed && (
          <Button
            size="sm"
            variant="outline"
            className="w-full text-[10px] h-7 border-[#1e1e3a] text-gray-400 hover:text-gray-200 gap-1.5"
            onClick={exitPerform}
          >
            <Square className="size-3" /> 结束操控
          </Button>
        )}
      </div>

      {performArmed && skeleton && character && (
        <>
          {/* ---- 方向盘 ---- */}
          <DirectionWheel
            value={oldDirectionToIndex(skeleton.currentDirection)}
            onChange={(idx) => {
              const dir = directionIndexToOldDirection(idx) as PuppetDirection;
              useProjectStore.getState().setPuppetDirection(skeleton.id, dir);
            }}
            latitude={skeleton.viewLatitude ?? 0}
            onLatitudeChange={(lat) => useProjectStore.getState().setPuppetLatitude(skeleton.id, lat)}
            size="sm"
          />

          {/* ---- 画布操作提示 ---- */}
          <div className="bg-cyan-500/5 border border-cyan-500/20 rounded p-2 space-y-1">
            <div className="flex items-center gap-1 text-[9px] text-cyan-300/90 font-medium">
              <Keyboard className="size-3" /> 画布直接操控
            </div>
            <div className="text-[9px] text-gray-500 leading-relaxed">
              拖动肢体＝旋转 · <span className="text-gray-300">Shift+拖</span>＝移动节点 ·
              <span className="text-gray-300"> Alt+拖</span>＝移动整体<br />
              <span className="text-gray-300">Q / E</span> 旋转选中 ±15° ·
              <span className="text-gray-300"> WASD</span> 微调 · 双击节点＝编辑精灵
            </div>
            {!autoKeyframe && (
              <div className="text-[9px] text-amber-400/90">
                自动关键帧已关闭 — 拖动不会被记录，用「记录姿态」手动打帧。
              </div>
            )}
          </div>

          {/* ---- 肢体选择器（hideNodeList 时用共享树） ---- */}
          {!hideNodeList && (
          <div className="space-y-1.5">
            <Label className="text-[10px] text-gray-500 uppercase tracking-wider">肢体</Label>
            <div className="bg-[#080818] rounded border border-[#1e1e3a] p-1 max-h-44 overflow-y-auto">
              {skeleton.nodes.map((node) => {
                const iv = interpolated.get(node.id);
                const hasKf = (clip?.puppetNodeKeyframes ?? []).some(
                  (kf) => kf.nodeId === node.id && kf.frame === currentFrame
                );
                const isRoot = !node.plug;
                return (
                  <div
                    key={node.id}
                    className={`flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer transition-colors ${
                      performNodeId === node.id
                        ? 'bg-cyan-500/15 ring-1 ring-cyan-500/30'
                        : 'hover:bg-white/5'
                    }`}
                    onClick={() => setPerformNodeId(node.id)}
                  >
                    <div
                      className="size-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: node.color || '#888' }}
                    />
                    <span className="text-[10px] text-gray-300 flex-1 truncate min-w-0">
                      {node.name}
                      {isRoot && <span className="text-[8px] text-gray-600 ml-1">(根)</span>}
                    </span>
                    <span className="text-[9px] text-gray-500 tabular-nums w-12 text-right flex-shrink-0">
                      {(iv?.angle ?? node.angle).toFixed(0)}°
                    </span>
                    {hasKf ? (
                      <CircleDot className="size-3 text-amber-400 flex-shrink-0" />
                    ) : (
                      <span className="size-3 flex-shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          )}
          {/* ---- 关键帧操作 ---- */}
          <div className="space-y-1.5">
            <Label className="text-[10px] text-gray-500 uppercase tracking-wider">关键帧</Label>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-7 text-[10px] border-[#1e1e3a] text-gray-400"
                onClick={gotoPrevKeyframe}
                disabled={!keyframedFrames.some((f) => f < currentFrame)}
                title="上一个关键帧"
              >
                <ChevronLeft className="size-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-7 text-[10px] border-[#1e1e3a] text-gray-400"
                onClick={gotoNextKeyframe}
                disabled={!keyframedFrames.some((f) => f > currentFrame)}
                title="下一个关键帧"
              >
                <ChevronRight className="size-3" />
              </Button>
              <span className="flex items-center text-[9px] text-gray-600 px-1 tabular-nums flex-shrink-0">
                {keyframedFrames.length} 帧有键
              </span>
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                className="flex-1 h-7 text-[10px] bg-amber-600 hover:bg-amber-500 gap-1"
                onClick={recordFullPose}
                title="把当前可见的整姿态写入当前帧"
              >
                <CircleDot className="size-3" /> 记录姿态
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] border-[#1e1e3a] text-gray-500 hover:text-red-300 px-2"
                onClick={() => {
                  if (confirm('清除当前帧全部节点的木偶关键帧？')) clearFramePose();
                }}
                title="清除当前帧的全部木偶关键帧"
              >
                <Eraser className="size-3" />
              </Button>
            </div>
          </div>

          {/* ---- 图层顺序（关键帧，step 插值） ---- */}
          {performNodeId && skeleton && clip && (() => {
            const node = skeleton.nodes.find((n) => n.id === performNodeId);
            const iv = interpolated.get(performNodeId);
            const curZ = iv?.zIndex ?? node?.zIndex ?? 0;
            return (
            <div className="space-y-1.5">
              <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
                图层顺序 <span className="normal-case text-[9px]">(当前帧关键帧)</span>
                <span className="ml-2 text-cyan-300 font-mono">z={curZ}</span>
              </Label>
              <div className="grid grid-cols-4 gap-1">
                {([
                  { label: '置于顶层', icon: 'ArrowUpToLine', getZ: (cur: number, zs: number[]) => Math.max(...zs) + 1 },
                  { label: '上移一层', icon: 'ArrowUp', getZ: (cur: number) => cur + 1 },
                  { label: '下移一层', icon: 'ArrowDown', getZ: (cur: number) => cur - 1 },
                  { label: '置于底层', icon: 'ArrowDownToLine', getZ: (cur: number, zs: number[]) => Math.min(...zs) - 1 },
                ] as const).map(({ label, icon, getZ }) => {
                  const Icon = { ArrowUpToLine, ArrowUp, ArrowDown, ArrowDownToLine }[icon];
                  return (
                    <Button
                      key={label}
                      variant="outline"
                      size="sm"
                      className="h-7 text-[9px] px-1 bg-[#0d0d1a] border-[#1e1e3a]"
                      title={`${label}（在当前帧打关键帧）`}
                      onClick={() => {
                        const node = skeleton.nodes.find((n) => n.id === performNodeId);
                        if (!node) return;
                        // 当前插值后的 zIndex
                        const iv = interpolated.get(performNodeId);
                        const curZ = iv?.zIndex ?? node.zIndex;
                        const allZ = skeleton.nodes.map((n) => interpolated.get(n.id)?.zIndex ?? n.zIndex);
                        const newZ = getZ(curZ, allZ);
                        const store = useProjectStore.getState();
                        // 找当前帧已有关键帧则更新，否则新建
                        const existing = (clip.puppetNodeKeyframes ?? []).find(
                          (kf) => kf.nodeId === performNodeId && kf.frame === currentFrame
                        );
                        if (existing) {
                          store.updatePuppetNodeKeyframe(clip.id, existing.id, { zIndex: newZ });
                        } else {
                          store.addPuppetNodeKeyframe(clip.id, performNodeId, currentFrame, { zIndex: newZ });
                        }
                      }}
                    >
                      <Icon className="size-3" />
                    </Button>
                  );
                })}
              </div>
            </div>
            );
          })()}

          {/* ---- 播放 ---- */}
          <div className="space-y-1.5">
            <Label className="text-[10px] text-gray-500 uppercase tracking-wider">播放</Label>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 border-[#1e1e3a] text-gray-400"
                onClick={() => { setPlayState('paused'); setCurrentFrame(Math.max(0, currentFrame - 1)); }}
              >
                <StepBack className="size-3" />
              </Button>
              <Button
                size="sm"
                className={`flex-1 h-7 text-[10px] gap-1 ${playState === 'playing' ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                onClick={togglePlay}
              >
                {playState === 'playing' ? <Pause className="size-3" /> : <Play className="size-3" />}
                {playState === 'playing' ? '暂停' : '播放'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 border-[#1e1e3a] text-gray-400"
                onClick={() => { setPlayState('paused'); setCurrentFrame(Math.min(totalFrames - 1, currentFrame + 1)); }}
              >
                <StepForward className="size-3" />
              </Button>
            </div>
          </div>

          {/* ---- 开关 ---- */}
          <div className="space-y-2 bg-[#080818] rounded border border-[#1e1e3a] p-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <Magnet className="size-3 text-cyan-500/70" /> 自动关键帧
              </span>
              <Switch checked={autoKeyframe} onCheckedChange={setAutoKeyframe} className="scale-75" />
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <Ghost className="size-3 text-purple-500/70" /> 木偶洋葱皮
              </span>
              <Switch checked={onionSkinEnabled} onCheckedChange={toggleOnionSkin} className="scale-75" />
            </div>
          </div>

          {/* ---- 蓝图模板（骨骼级，不依赖选中节点） ---- */}
          {skeleton && (
            <div className="mt-2 pt-2 border-t border-[#1e1e3a]">
              <BlueprintTemplateLoader skeleton={skeleton} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
