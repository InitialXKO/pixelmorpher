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
import { captureSkinningSnapshot } from '@/lib/skin/snapshot-capture';
import { writePuppetPoseKeyframe } from '../canvas/tool-handlers';
import { trackKeyFrames } from '../timeline/NodeTrackLane';
import DirectionWheel from '../DirectionWheel';
import BlueprintTemplateLoader from './BlueprintTemplateLoader';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
// (PuppetDirection import removed: direction now uses DirectionIndex directly)

export default function PerformPanel({ hideNodeList = false }: { hideNodeList?: boolean }) {
  const unifiedCharacters = useProjectStore((s) => s.unifiedCharacters);
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
    () => (activePuppetSkeletonId ? unifiedCharacters[activePuppetSkeletonId] ?? null : null),
    [unifiedCharacters, activePuppetSkeletonId]
  );
  // Migrated: read skeleton nodes from unifiedCharacters (new Character model)
  // instead of puppetSkeletons. Character.nodes is a Record, use Object.values().
  const unifiedSkeleton = useMemo(() => {
    if (!activePuppetSkeletonId) return null;
    return unifiedCharacters[activePuppetSkeletonId] ?? null;
  }, [unifiedCharacters, activePuppetSkeletonId]);
  const skeletonNodes = useMemo(
    () => (unifiedSkeleton ? Object.values(unifiedSkeleton.nodes) : []),
    [unifiedSkeleton]
  );
  // 角色带堆叠件时，朝向角滑杆独立于转面开关显示（连续偏航是堆叠的原生能力）
  const hasStackPieces = useMemo(
    () => (character?.costumeSets ?? []).some((cs) => Object.values(cs.pieces ?? {}).some((p) => !!p.stack)),
    [character]
  );
  const activeAnimationClipId = useProjectStore((s) => s.activeAnimationClipId);
  // 片段口径与主渲染门控严格一致（pickClipStateKeyframes/pickSlashClip）：
  // 只认激活片段、且归属须等于操控角色——渲染端没有「回落到该角色
  // 第一个片段」这回事。此前面板自带回落并标注「实际片段（已回落）」，
  // 但该片段的状态键/刀光在画布上并不生效，属口径分叉，已摘除回落。
  const clip = useMemo(
    () =>
      animationClips.find((c) => c.id === activeAnimationClipId && c.puppetCharacterId === performCharacterId) ??
      null,
    [animationClips, activeAnimationClipId, performCharacterId]
  );

  // 每节点在当前帧的插值姿态（面板读数用；轨迹 x/y 与主画布同口径
  // ——两链共用 interpolateTrajectoryPoints、轨迹盖过轨道；其余通道
  // 走本辅助链插值，与主画布的逐步口径不完全等同）
  // 从新 store 读 unifiedCharacters，用新签名
  const unifiedCharacter = useProjectStore((s) => s.unifiedCharacters[performCharacterId ?? '']);
  const interpolated = useMemo(() => {
    if (!unifiedCharacter) return new Map();
    return interpolateNodeKeyframes(unifiedCharacter, currentFrame);
  }, [unifiedCharacter, currentFrame]);

  // 该角色全部轨道键所在帧（排序去重），用于上一/下一关键帧导航；
  // 有归属片段时只算其时间窗内的帧（窗外不属于这一段）
  const keyframedFrames = useMemo(() => {
    const frames = new Set<number>();
    if (unifiedCharacter) {
      for (const node of Object.values(unifiedCharacter.nodes)) {
        for (const f of trackKeyFrames(node.tracks)) {
          if (clip && (f < clip.startFrame || f > clip.endFrame)) continue;
          frames.add(f);
        }
      }
    }
    return [...frames].sort((a, b) => a - b);
  }, [unifiedCharacter, clip]);

  const projectTotalFrames = useProjectStore((s) => s.totalFrames);
  const totalFrames = clip ? clip.endFrame + 1 : projectTotalFrames;

  // 选中角色时自动进入操控（无需"开始操控"按钮）
  useEffect(() => {
    if (character && !performArmed) {
      enterPerform(character.id);
    }
  }, [character?.id]);

  // 武装中切换角色时同步会话：片段解析、姿态来源、记录/清帧、关键帧
  // 导航都按会话的 performCharacterId 落笔，它只在 enterPerform 时写；
  // 只切 activePuppetSkeletonId 不切它，面板显示与实际写入会分属两个
  // 角色。enterPerform 无前置条件（重入即整套重设：片段、工具、根节点
  // 选择一并对齐新角色），这里直接按新角色重入，不另造进入逻辑。
  useEffect(() => {
    if (performArmed && character && performCharacterId !== character.id) {
      enterPerform(character.id);
    }
  }, [performArmed, character, performCharacterId]);

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

      {/* ---- 实际使用的片段（与画布门控一致：激活片段不属于操控角色时无片段生效） ---- */}
      {performArmed && character && (
        <p className="text-[9px] text-gray-500 px-0.5 -mt-1.5">
          实际片段：{clip ? clip.name : '（无片段）'}
          {!clip && activeAnimationClipId && (
            <span className="text-amber-500/90">（时间线选中的片段不属于当前角色，画布上不生效）</span>
          )}
        </p>
      )}

      {/* ---- 进入/退出操控（角色用左侧选中的） ---- */}
      <div className="space-y-1.5">
        {Object.keys(unifiedCharacters).length === 0 && (
          <p className="text-[9px] text-amber-500/80">还没有角色 — 先去「搭建」阶段创建骨骼与角色</p>
        )}
        {Object.keys(unifiedCharacters).length > 0 && !activePuppetSkeletonId && (
          <p className="text-[9px] text-amber-500/80">请在左侧面板选择骨架</p>
        )}
        {activePuppetSkeletonId && unifiedSkeleton && !character && (
          <p className="text-[9px] text-red-500/80">
            骨架「{unifiedSkeleton.name}」没有关联角色（数据异常，裸骨架不应存在）
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

      {performArmed && unifiedSkeleton && character && (
        <>
          {/* ---- 方向盘 ---- */}
          <DirectionWheel
            value={unifiedSkeleton.nodes[unifiedSkeleton.rootNodeId]?.transform.variantIndex ?? 0}
            onChange={(idx) => {
              useProjectStore.getState().setUnifiedDirection(activePuppetSkeletonId!, idx);
            }}
            latitude={unifiedSkeleton.latitude ?? 0}
            onLatitudeChange={(lat) => useProjectStore.getState().updateUnifiedCharacter(activePuppetSkeletonId!, { latitude: lat })}
            size="sm"
          />

          {/* ---- 蒙皮转面（连续朝向 + 单图模式） ---- */}
          <div className="space-y-1.5 bg-[#080818] rounded border border-[#1e1e3a] p-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-gray-500 uppercase tracking-wider">转面</Label>
              <label className="flex items-center gap-1 text-[9px] text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  className="size-3 accent-cyan-500"
                  checked={character.faceTurnConfig?.enabled ?? false}
                  onChange={(e) => {
                    const cfg = character.faceTurnConfig ?? {};
                    useProjectStore.getState().updateUnifiedCharacter(activePuppetSkeletonId!, {
                      faceTurnConfig: { ...cfg, enabled: e.target.checked } as any,
                    });
                  }}
                />
                启用
              </label>
            </div>
            {((character.faceTurnConfig?.enabled ?? false) || hasStackPieces) && (
                <div className="flex items-center gap-2" title={hasStackPieces && !(character.faceTurnConfig?.enabled ?? false) ? '整个角色绕竖直轴连续转动：堆叠按新朝向逐层重合成，平面精灵仍按最近的离散朝向选图' : undefined}>
                  <span className="text-[9px] text-gray-500 w-12 shrink-0">朝向角</span>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={character.facingAngle ?? 0}
                    onChange={(e) => {
                      useProjectStore.getState().updateUnifiedCharacter(activePuppetSkeletonId!, {
                        facingAngle: Number(e.target.value),
                      });
                    }}
                    className="flex-1 h-1 accent-cyan-500"
                  />
                  <span className="text-[9px] text-cyan-300 font-mono w-8 text-right">
                    {Math.round(character.facingAngle ?? 0)}°
                  </span>
                </div>
            )}
            {(character.faceTurnConfig?.enabled ?? false) && (
                <label className="flex items-center gap-1.5 text-[9px] text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    className="size-3 accent-cyan-500"
                    checked={character.faceTurnConfig?.singleImageMode ?? false}
                    onChange={(e) => {
                      const cfg = character.faceTurnConfig ?? {};
                      useProjectStore.getState().updateUnifiedCharacter(activePuppetSkeletonId!, {
                        faceTurnConfig: { ...cfg, singleImageMode: e.target.checked } as any,
                      });
                    }}
                  />
                  单图模式（不切换精灵，全程转面）
                </label>
            )}
          </div>

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
                自动关键帧已关闭 — 拖动修改当前帧已有的关键帧；当前帧没有的写到第 0 帧。
              </div>
            )}
          </div>

          {/* ---- 肢体选择器（hideNodeList 时用共享树） ---- */}
          {!hideNodeList && (
          <div className="space-y-1.5">
            <Label className="text-[10px] text-gray-500 uppercase tracking-wider">肢体</Label>
            <div className="bg-[#080818] rounded border border-[#1e1e3a] p-1 max-h-44 overflow-y-auto">
              {skeletonNodes.map((node) => {
                const iv = interpolated.get(node.id);
                const hasKf = trackKeyFrames(node.tracks).includes(currentFrame);
                const isRoot = node.attachment.type === 'fixed' && !node.attachment.parentSocketId;
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
                      style={{ backgroundColor: node.slot?.fillColor || '#888' }}
                    />
                    <span className="text-[10px] text-gray-300 flex-1 truncate min-w-0">
                      {node.name}
                      {isRoot && <span className="text-[8px] text-gray-600 ml-1">(根)</span>}
                    </span>
                    <span className="text-[9px] text-gray-500 tabular-nums w-12 text-right flex-shrink-0">
                      {(iv?.angle ?? node.transform.angle).toFixed(0)}°
                    </span>
                    {Math.abs(iv?.tilt ?? node.transform.tilt ?? 0) >= 0.5 && (
                      <span className="text-[9px] text-purple-300/80 tabular-nums flex-shrink-0" title="出平面角 tilt">
                        t{(iv?.tilt ?? node.transform.tilt ?? 0).toFixed(0)}°
                      </span>
                    )}
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

          {/* ---- 出平面角 tilt（关键帧） ---- */}
          {performNodeId && unifiedSkeleton && (() => {
            const node = unifiedSkeleton.nodes[performNodeId];
            if (!node) return null;
            const iv = interpolated.get(performNodeId);
            const curTilt = iv?.tilt ?? node.transform.tilt ?? 0;
            return (
              <div className="space-y-1.5">
                <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
                  出平面角 tilt <span className="normal-case text-[9px]">(当前帧关键帧)</span>
                  <span className="ml-2 text-cyan-300 font-mono">{curTilt.toFixed(0)}°</span>
                </Label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step={1}
                    value={Math.round(curTilt)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      writePuppetPoseKeyframe(unifiedSkeleton.id, clip?.id ?? '', performNodeId, currentFrame, {
                        angle: iv?.angle ?? node.transform.angle,
                        stretch: iv?.stretch ?? node.transform.stretch,
                        scaleX: iv?.scaleX ?? node.transform.scaleX ?? 1,
                        x: iv?.x ?? node.transform.x,
                        y: iv?.y ?? node.transform.y,
                        tilt: v,
                      }, (node.transform.variantIndex ?? 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7);
                    }}
                    className="w-20 px-1.5 py-1 bg-black/50 rounded text-gray-300 text-[10px]"
                    title="出平面角（度）：绕朝向水平轴掀转，整棵子树跟随。伪3D旋转工具拖拽也写此轨道"
                  />
                  <span className="text-[9px] text-gray-600">伪3D旋转工具拖拽也写此轨道</span>
                </div>
              </div>
            );
          })()}

          {/* ---- 蒙皮快照（plug 允许蒙皮时） ---- */}
          {performNodeId && unifiedSkeleton && (() => {
            const node = unifiedSkeleton.nodes[performNodeId];
            if (!node || node.attachment?.type !== 'socket' || !node.attachment.parentSocketId) return null;
            if (node.attachment.allowSkinning !== true) return null;
            const snap = node.attachment.skinningSnapshot;
            return (
              <div className="space-y-1.5">
                <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
                  蒙皮快照 <span className="normal-case text-[9px]">(与父节点合并变形)</span>
                </Label>
                <div className="text-[9px] text-gray-500 leading-relaxed">
                  {snap
                    ? `已快照：帧 ${snap.frame} · 朝向 ${snap.direction} · 基础角 ${snap.baseAngle.toFixed(0)}°（该朝向下旋转走合并精灵弯曲，不再用关节盘）`
                    : '未快照：按下后把本节点与父节点按当前帧姿态合并成一张精灵，之后旋转自动网格弯曲'}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="flex-1 h-7 text-[10px] bg-cyan-700 hover:bg-cyan-600"
                    title="以当前帧姿态捕获蒙皮快照（父+子合并精灵）"
                    onClick={() => {
                      const st = useProjectStore.getState();
                      const character = st.unifiedCharacters[unifiedSkeleton.id];
                      if (!character) return;
                      const result = captureSkinningSnapshot(
                        character,
                        performNodeId,
                        currentFrame,
                        st.canvasWidth,
                        st.canvasHeight,
                        st.sprites,
                      );
                      if (!result) {
                        alert('快照失败：当前帧该节点与父节点没有可捕获的像素');
                        return;
                      }
                      const spriteId = result.sprite.id;
                      if (!spriteId) return;
                      st.pushUndo('蒙皮快照');
                      useProjectStore.setState((s) => ({
                        sprites: { ...s.sprites, [spriteId]: result.sprite },
                      }));
                      const cur = useProjectStore.getState().unifiedCharacters[unifiedSkeleton.id]?.nodes[performNodeId];
                      if (cur) {
                        st.updateUnifiedNode(unifiedSkeleton.id, performNodeId, {
                          attachment: { ...cur.attachment, skinningSnapshot: result.snapshot },
                        });
                      }
                    }}
                  >
                    蒙皮快照（当前帧）
                  </Button>
                  {snap && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] border-[#1e1e3a] text-gray-500 hover:text-red-300 px-2"
                      title="删除快照，恢复双精灵 + 关节盘渲染"
                      onClick={() => {
                        const st = useProjectStore.getState();
                        const cur = st.unifiedCharacters[unifiedSkeleton.id]?.nodes[performNodeId];
                        if (!cur) return;
                        st.pushUndo('删除蒙皮快照');
                        st.updateUnifiedNode(unifiedSkeleton.id, performNodeId, {
                          attachment: { ...cur.attachment, skinningSnapshot: null },
                        });
                      }}
                    >
                      删除
                    </Button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ---- 图层顺序（关键帧，step 插值） ---- */}
          {performNodeId && unifiedSkeleton && (() => {
            const node = unifiedSkeleton.nodes[performNodeId];
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
                        const node = unifiedSkeleton.nodes[performNodeId];
                        if (!node) return;
                        // 当前插值后的 zIndex
                        const iv = interpolated.get(performNodeId);
                        const curZ = iv?.zIndex ?? node.zIndex;
                        const allZ = skeletonNodes.map((n) => interpolated.get(n.id)?.zIndex ?? n.zIndex);
                        const newZ = getZ(curZ, allZ);
                        // 写图层顺序轨在当前帧的点（step 取值，面板/拖拽管线即时生效）
                        useProjectStore.getState().setNodeZIndexKey(unifiedSkeleton.id, performNodeId, currentFrame, newZ);
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
          {unifiedSkeleton && (
            <div className="mt-2 pt-2 border-t border-[#1e1e3a]">
              <BlueprintTemplateLoader character={unifiedSkeleton} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
