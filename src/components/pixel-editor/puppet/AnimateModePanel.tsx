'use client';

import React, { useCallback } from 'react';
import {
  Film,
  Circle,
  Target,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type {
  PuppetSkeleton,
  PuppetNode,
  PuppetCharacter,
  PuppetDirection,
  PuppetNodeKeyframe,
} from '@/lib/types';
import type { AnimationClip } from '@/lib/types';
import DirectionWheel, { oldDirectionToIndex, directionIndexToOldDirection } from '../DirectionWheel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { updateSkeletonNode } from './updateSkeletonNode';
import AnimateControls from './AnimateControls';

interface AnimateModePanelProps {
  puppetCharacters: PuppetCharacter[];
  animationClips: AnimationClip[];
  currentFrame: number;
  animateCharacterId: string | null;
  setAnimateCharacterId: (id: string | null) => void;
  animateDirection: PuppetDirection;
  setAnimateDirection: (dir: PuppetDirection) => void;
  animateSelectedNodeId: string | null;
  animateCharacter: PuppetCharacter | null;
  animateSkeleton: PuppetSkeleton | null;
  animateSelectedNode: PuppetNode | null;
  activePuppetClip: AnimationClip | null;
  latitude: number;
  setLatitude: (lat: number) => void;
  autoCreatedRef: React.MutableRefObject<string | null>;
  handleSelectAnimateNodeWithSync: (nodeId: string | null) => void;
}

export default function AnimateModePanel({
  puppetCharacters,
  animationClips,
  currentFrame,
  animateCharacterId,
  setAnimateCharacterId,
  animateDirection,
  setAnimateDirection,
  animateSelectedNodeId,
  animateCharacter,
  animateSkeleton,
  animateSelectedNode,
  activePuppetClip,
  latitude,
  setLatitude,
  autoCreatedRef,
  handleSelectAnimateNodeWithSync,
}: AnimateModePanelProps) {

  const handleUpdateAnimateNode = useCallback(
    (nodeId: string, updates: Partial<PuppetNode>) => {
      if (!animateSkeleton) return;
      const skeletonId = animateSkeleton.id;
      const store = useProjectStore.getState();
      store.pushUndo('更新动画节点');

      // Compute the merged node state after this update
      const updatedSkel = updateSkeletonNode(animateSkeleton, nodeId, updates);
      const mergedNode = updatedSkel.nodes.find((n) => n.id === nodeId);

      // 1. Update skeleton rest pose
      useProjectStore.setState({
        puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
          s.id === skeletonId
            ? updateSkeletonNode(s, nodeId, updates)
            : s
        ),
      });

      // 2. Auto-keyframe: write/update PuppetNodeKeyframe if an active puppet clip exists
      if (animateCharacterId && mergedNode) {
        const puppetClip = useProjectStore.getState().animationClips.find(
          (c) => c.isPuppetClip && c.puppetCharacterId === animateCharacterId
        );
        if (puppetClip) {
          const frame = useProjectStore.getState().currentFrame;
          const existingKf = (puppetClip.puppetNodeKeyframes ?? []).find(
            (kf) => kf.nodeId === nodeId && kf.frame === frame
          );

          // Only auto-keyframe animatable properties (angle, stretch, offsetX, offsetY)
          const animatableKeys = ['angle', 'stretch', 'offsetX', 'offsetY'] as const;
          const hasAnimatableChange = animatableKeys.some((k) => k in updates);

          if (hasAnimatableChange) {
            if (existingKf) {
              // Update existing keyframe
              store.updatePuppetNodeKeyframe(puppetClip.id, existingKf.id, {
                angle: mergedNode.angle,
                stretch: mergedNode.stretch,
                offsetX: mergedNode.offsetX,
                offsetY: mergedNode.offsetY,
                direction: animateDirection,
                viewLatitude: latitude,
              });
            } else {
              // Create new keyframe for this node
              store.addPuppetNodeKeyframe(puppetClip.id, nodeId, frame, {
                angle: mergedNode.angle,
                stretch: mergedNode.stretch,
                offsetX: mergedNode.offsetX,
                offsetY: mergedNode.offsetY,
                direction: animateDirection,
                viewLatitude: latitude,
              });
            }
          }
        }
      }
    },
    [animateSkeleton, animateCharacterId, animateDirection, latitude]
  );

  const handleRecordPose = useCallback(() => {
    if (!animateCharacter || !animateSkeleton) return;
    const activeClip = animationClips.find((c) => c.isPuppetClip && c.puppetCharacterId === animateCharacter.id);
    if (!activeClip) return;

    const newKeyframes: PuppetNodeKeyframe[] = animateSkeleton.nodes.map((node) => ({
      id: crypto.randomUUID(),
      nodeId: node.id,
      frame: currentFrame,
      angle: node.angle,
      stretch: node.stretch,
      offsetX: node.offsetX,
      offsetY: node.offsetY,
      direction: animateDirection,
      viewLatitude: latitude,
    }));

    const store = useProjectStore.getState();
    store.pushUndo('录制姿态');
    useProjectStore.setState({
      animationClips: store.animationClips.map((clip) =>
        clip.id === activeClip.id
          ? {
              ...clip,
              puppetNodeKeyframes: [
                ...(clip.puppetNodeKeyframes ?? []).filter(
                  (kf) => !(kf.frame === currentFrame && newKeyframes.some((nk) => nk.nodeId === kf.nodeId))
                ),
                ...newKeyframes,
              ],
            }
          : clip
      ),
    });
  }, [animateCharacter, animateSkeleton, animationClips, currentFrame, animateDirection, latitude]);

  return (
    <div className="space-y-3">
      {/* Workflow status bar */}
      <div className={`flex items-center gap-2 px-2 py-1.5 rounded border ${
        activePuppetClip
          ? 'bg-emerald-500/10 border-emerald-500/20'
          : animateCharacterId
            ? 'bg-red-500/10 border-red-500/20'
            : 'bg-[#111128] border-[#1e1e3a]'
      }`}>
        {activePuppetClip ? (
          <CheckCircle2 className="size-3 text-emerald-400 flex-shrink-0" />
        ) : animateCharacterId ? (
          <AlertCircle className="size-3 text-red-400 flex-shrink-0" />
        ) : (
          <Circle className="size-3 text-gray-600 flex-shrink-0" />
        )}
        <span className={`text-[9px] truncate flex-1 ${
          activePuppetClip
            ? 'text-emerald-400'
            : animateCharacterId
              ? 'text-red-400'
              : 'text-gray-600'
        }`}>
          {activePuppetClip
            ? activePuppetClip.name
            : animateCharacterId
              ? '无活跃木偶片段'
              : '选择角色以开始'
          }
        </span>
        <span className="text-[9px] text-gray-500 tabular-nums">
          帧 {currentFrame}
        </span>
      </div>

      {/* Character selector for animation */}
      <div className="space-y-1.5">
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">动画角色</Label>
        <select
          value={animateCharacterId ?? ''}
          onChange={(e) => setAnimateCharacterId(e.target.value || null)}
          className="w-full h-7 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded px-2 text-gray-300"
        >
          <option value="">— 选择角色 —</option>
          {puppetCharacters.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Direction switcher */}
      {animateCharacter && (
        <DirectionWheel
          value={oldDirectionToIndex(animateDirection)}
          onChange={(idx) => {
            const dir = directionIndexToOldDirection(idx) as PuppetDirection;
            setAnimateDirection(dir);
            if (animateSkeleton) {
              useProjectStore.getState().setPuppetDirection(animateSkeleton.id, dir);
            }
          }}
          latitude={latitude}
          onLatitudeChange={(lat) => {
            setLatitude(lat);
            if (animateSkeleton) {
              useProjectStore.getState().setPuppetLatitude(animateSkeleton.id, lat);
            }
          }}
          size="sm"
        />
      )}

      {/* Canvas puppet tool & interaction mode */}
      {animateCharacter && (
        <div className="space-y-1.5">
          <div className="flex gap-1 mt-1">
            <Button
              variant="outline"
              size="sm"
              className={`flex-1 text-[10px] h-6 ${
                useEditorStore.getState().tool === 'puppet'
                  ? 'border-cyan-500/70 text-cyan-300 bg-cyan-500/10'
                  : 'border-cyan-600/50 text-cyan-400 hover:bg-cyan-500/10'
              }`}
              onClick={() => {
                useEditorStore.getState().setTool('puppet');
                if (animateSkeleton) {
                  useEditorStore.getState().setActivePuppetSkeletonId(animateSkeleton.id);
                }
                if (!useEditorStore.getState().showPuppetSkeleton) {
                  useEditorStore.getState().togglePuppetSkeleton();
                }
              }}
            >
              <Target className="size-3 mr-1" /> 画布拖动K帧
            </Button>
          </div>
          {/* Interaction mode toggle */}
          <div className="flex gap-1 mt-1">
            <Button
              variant="outline"
              size="sm"
              className={`flex-1 text-[9px] h-5 ${
                useEditorStore.getState().puppetInteractionMode === 'move'
                  ? 'border-blue-500/70 text-blue-300 bg-blue-500/10'
                  : 'border-[#1e1e3a] text-gray-500 hover:bg-white/5'
              }`}
              onClick={() => useEditorStore.getState().setPuppetInteractionMode('move')}
            >
              移动模式
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={`flex-1 text-[9px] h-5 ${
                useEditorStore.getState().puppetInteractionMode === 'manipulate'
                  ? 'border-purple-500/70 text-purple-300 bg-purple-500/10'
                  : 'border-[#1e1e3a] text-gray-500 hover:bg-white/5'
              }`}
              onClick={() => useEditorStore.getState().setPuppetInteractionMode('manipulate')}
            >
              操控模式
            </Button>
          </div>
          {/* Keyboard shortcut hints */}
          <div className="text-[8px] text-gray-600 mt-1 space-y-0.5">
            {useEditorStore.getState().puppetInteractionMode === 'move' ? (
              <>
                <div>WASD/方向键: 平移整个木偶</div>
                <div>Q/E: 逆时针/顺时针旋转肢体 ±15°</div>
              </>
            ) : (
              <>
                <div>WASD/方向键: 调整末端吸引位置(角度)</div>
                <div>Q/E: 逆时针/顺时针旋转肢体 ±15°</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Node list, selected node editing, record pose, clip info */}
      {animateCharacter && (
        <AnimateControls
          animationClips={animationClips}
          currentFrame={currentFrame}
          animateCharacterId={animateCharacterId}
          animateCharacter={animateCharacter}
          animateSkeleton={animateSkeleton}
          animateSelectedNode={animateSelectedNode}
          latitude={latitude}
          autoCreatedRef={autoCreatedRef}
          handleSelectAnimateNodeWithSync={handleSelectAnimateNodeWithSync}
          handleUpdateAnimateNode={handleUpdateAnimateNode}
          handleRecordPose={handleRecordPose}
        />
      )}
    </div>
  );
}
