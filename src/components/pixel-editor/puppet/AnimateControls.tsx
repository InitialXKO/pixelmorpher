'use client';

import React from 'react';
import {
  Plus,
  Film,
  Circle,
  CheckCircle2,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type {
  PuppetSkeleton,
  PuppetNode,
  PuppetCharacter,
  PuppetDirection,
  PuppetNodeKeyframe,
} from '@/lib/types';
import type { AnimationClip } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AnimateControlsProps {
  animationClips: AnimationClip[];
  currentFrame: number;
  animateCharacterId: string | null;
  animateCharacter: PuppetCharacter;
  animateSkeleton: PuppetSkeleton | null;
  animateSelectedNode: PuppetNode | null;
  latitude: number;
  autoCreatedRef: React.MutableRefObject<string | null>;
  handleSelectAnimateNodeWithSync: (nodeId: string | null) => void;
  handleUpdateAnimateNode: (nodeId: string, updates: Partial<PuppetNode>) => void;
  handleRecordPose: () => void;
}

export default function AnimateControls({
  animationClips,
  currentFrame,
  animateCharacterId,
  animateCharacter,
  animateSkeleton,
  animateSelectedNode,
  latitude,
  autoCreatedRef,
  handleSelectAnimateNodeWithSync,
  handleUpdateAnimateNode,
  handleRecordPose,
}: AnimateControlsProps) {
  return (
    <>
      {/* Node list with interactive editing */}
      {animateSkeleton && (
        <div className="space-y-1.5">
          <Label className="text-[10px] text-gray-500 uppercase tracking-wider">节点值</Label>
          <div className="bg-[#080818] rounded border border-[#1e1e3a] p-1 max-h-48 overflow-y-auto">
            {animateSkeleton.nodes.map((node) => {
              const activeClip = animationClips.find(
                (c) => c.isPuppetClip && c.puppetCharacterId === animateCharacterId
              );
              const hasKeyframe = (activeClip?.puppetNodeKeyframes ?? []).some(
                (kf) => kf.nodeId === node.id && kf.frame === currentFrame
              );
              return (
                <div
                  key={node.id}
                  className={`flex items-center gap-2 px-1 py-1 rounded cursor-pointer transition-colors ${
                    animateSelectedNode?.id === node.id
                      ? 'bg-cyan-500/15 ring-1 ring-cyan-500/30'
                      : 'hover:bg-white/5'
                  }`}
                  onClick={() => handleSelectAnimateNodeWithSync(node.id)}
                >
                  <div
                    className="size-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: node.color || '#888' }}
                  />
                  <span className="text-[10px] text-gray-300 flex-1 truncate">{node.name}</span>
                  <span className="text-[9px] text-gray-600 tabular-nums">
                    {node.angle.toFixed(1)}°
                  </span>
                  <span className="text-[9px] text-gray-700 tabular-nums">
                    ×{node.stretch.toFixed(2)}
                  </span>
                  {hasKeyframe && (
                    <span className="size-1.5 rounded-full bg-amber-400 flex-shrink-0" title="此帧有关键帧" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected node editing in animate mode */}
      {animateSelectedNode && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
              编辑节点 — {animateSelectedNode.name}
            </Label>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-gray-500 hover:text-gray-300"
              onClick={() => handleSelectAnimateNodeWithSync(null)}
            >
              <Circle className="size-2.5" />
            </Button>
          </div>
          <div className="bg-[#080818] rounded border border-[#1e1e3a] p-2 space-y-2">
            {/* Angle */}
            <div className="flex items-center gap-2">
              <Label className="text-[9px] text-gray-600 w-10">角度</Label>
              <Input
                type="number"
                value={animateSelectedNode.angle}
                onChange={(e) =>
                  handleUpdateAnimateNode(animateSelectedNode.id, { angle: Number(e.target.value) })
                }
                className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a] w-14"
              />
              <input
                type="range"
                min={-180}
                max={180}
                value={animateSelectedNode.angle}
                onChange={(e) =>
                  handleUpdateAnimateNode(animateSelectedNode.id, { angle: Number(e.target.value) })
                }
                className="flex-1 h-1 accent-cyan-500"
              />
            </div>

            {/* Stretch */}
            <div className="flex items-center gap-2">
              <Label className="text-[9px] text-gray-600 w-10">拉伸</Label>
              <Input
                type="number"
                step={0.1}
                min={0.1}
                max={5}
                value={animateSelectedNode.stretch}
                onChange={(e) =>
                  handleUpdateAnimateNode(animateSelectedNode.id, { stretch: Number(e.target.value) })
                }
                className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a] w-14"
              />
            </div>

            {/* Offsets */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1">
                <Label className="text-[9px] text-gray-600">X偏移</Label>
                <Input
                  type="number"
                  value={animateSelectedNode.offsetX}
                  onChange={(e) =>
                    handleUpdateAnimateNode(animateSelectedNode.id, { offsetX: Number(e.target.value) })
                  }
                  className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                />
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-[9px] text-gray-600">Y偏移</Label>
                <Input
                  type="number"
                  value={animateSelectedNode.offsetY}
                  onChange={(e) =>
                    handleUpdateAnimateNode(animateSelectedNode.id, { offsetY: Number(e.target.value) })
                  }
                  className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Record pose button */}
      <Button
        size="sm"
        className="w-full text-xs bg-emerald-600 hover:bg-emerald-500 gap-1"
        onClick={handleRecordPose}
      >
        <Film className="size-3" /> 录制当前姿态 (帧 {currentFrame})
      </Button>

      {/* Active puppet clip info */}
      {(() => {
        const activeClip = animationClips.find(
          (c) => c.isPuppetClip && c.puppetCharacterId === animateCharacter.id
        );
        if (!activeClip) {
          return (
            <div className="space-y-2">
              <div className="text-center py-2">
                <p className="text-[9px] text-gray-600">此角色尚无木偶动画片段</p>
                <p className="text-[8px] text-gray-700">将自动创建…</p>
              </div>
              <Button
                size="sm"
                className="w-full text-xs bg-cyan-600 hover:bg-cyan-500 gap-1"
                onClick={() => {
                  if (!animateCharacterId) return;
                  const store = useProjectStore.getState();
                  const character = (store.puppetCharacters ?? []).find((c) => c.id === animateCharacterId);
                  if (!character) return;
                  const clipName = character.name + '动画';
                  const clip = store.addAnimationClip(clipName);
                  store.updateAnimationClip(clip.id, {
                    isPuppetClip: true,
                    puppetCharacterId: animateCharacterId,
                    frameRate: 12,
                    totalFrames: 24,
                  });
                  autoCreatedRef.current = animateCharacterId;
                }}
              >
                <Plus className="size-3" /> 创建木偶动画片段
              </Button>
            </div>
          );
        }
        const nodeKeyframes = activeClip.puppetNodeKeyframes ?? [];
        const frameKeyframes = nodeKeyframes.filter((kf) => kf.frame === currentFrame);
        return (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
                当前帧关键帧
              </Label>
              <span className="text-[8px] text-emerald-500/70 flex items-center gap-0.5">
                <CheckCircle2 className="size-2" /> 自动录制
              </span>
            </div>
            <div className="bg-[#080818] rounded border border-[#1e1e3a] p-1 max-h-32 overflow-y-auto">
              {frameKeyframes.length === 0 ? (
                <p className="text-[9px] text-gray-700 text-center py-1">帧 {currentFrame} 无关键帧 — 拖动滑块自动创建</p>
              ) : (
                frameKeyframes.map((kf) => {
                  const node = animateSkeleton?.nodes.find((n) => n.id === kf.nodeId);
                  return (
                    <div key={kf.id} className="flex items-center gap-1 px-1 py-0.5">
                      <div
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: node?.color || '#888' }}
                      />
                      <span className="text-[9px] text-gray-400">{node?.name ?? kf.nodeId}</span>
                      {kf.angle != null && (
                        <span className="text-[8px] text-gray-600">{kf.angle.toFixed(1)}°</span>
                      )}
                      {kf.stretch != null && (
                        <span className="text-[8px] text-gray-700">×{kf.stretch.toFixed(2)}</span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}
