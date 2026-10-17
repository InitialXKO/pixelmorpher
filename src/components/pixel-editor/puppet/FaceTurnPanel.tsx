'use client';

import React, { useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Crosshair, KeyRound } from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type { Node, Character } from '@/lib/unified-types';

// ---- Node FaceTurn Panel（蒙皮转面：方向内微动） ----
// yaw/pitch 滑杆 → node.faceTurn（updateUnifiedNode，带撤销）
// "打关键帧" → addNodeKeyframe(nodeId, frame, { faceTurn })
// "标注特征点" → 进 sprite_edit + landmark 工具（标注该节点当前方向的精灵）

export function FaceTurnPanel({
  character,
  node,
}: {
  character: Character;
  node: Node;
}) {
  const updateUnifiedNode = useProjectStore((s) => s.updateUnifiedNode);
  const addNodeKeyframe = useProjectStore((s) => s.addNodeKeyframe);
  const currentFrame = useProjectStore((s) => s.currentFrame);
  const activeClipId = useProjectStore((s: any) => s.activeAnimationClipId);
  const setTool = useEditorStore((s) => s.setTool);
  const enterSpriteEditMode = useEditorStore((s) => s.enterSpriteEditMode);

  const faceTurn = node.faceTurn ?? { yaw: 0, pitch: 0 };

  const handleYaw = useCallback(
    (v: number) => {
      updateUnifiedNode(character.id, node.id, {
        faceTurn: { yaw: v, pitch: faceTurn.pitch },
      });
    },
    [character.id, node.id, faceTurn.pitch, updateUnifiedNode]
  );

  const handlePitch = useCallback(
    (v: number) => {
      updateUnifiedNode(character.id, node.id, {
        faceTurn: { yaw: faceTurn.yaw, pitch: v },
      });
    },
    [character.id, node.id, faceTurn.yaw, updateUnifiedNode]
  );

  const handleKeyframe = useCallback(() => {
    if (!activeClipId) return;
    addNodeKeyframe(activeClipId, node.id, currentFrame, {
      faceTurn: { yaw: faceTurn.yaw, pitch: faceTurn.pitch },
    });
  }, [activeClipId, node.id, currentFrame, faceTurn, addNodeKeyframe]);

  // 找到该节点当前方向的精灵，进 sprite_edit 标注
  const handleAnnotate = useCallback(() => {
    // 用 unified-render 的 resolveNodeSpriteId（懒加载避免循环依赖）
    const { resolveNodeSpriteId } = require('@/lib/unified-render') as typeof import('@/lib/unified-render');
    const direction = (node.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    const sprites = useProjectStore.getState().sprites ?? {};
    const spriteId = resolveNodeSpriteId(character, node.id, direction, sprites);
    if (spriteId) {
      useEditorStore.getState().selectPart(spriteId);
      enterSpriteEditMode(spriteId);
      setTool('landmark');
    }
  }, [character, node, enterSpriteEditMode, setTool]);

  return (
    <div className="space-y-3 p-1">
      <div className="text-[10px] text-gray-500">
        转面微动 · {node.name}（单张图模拟转头，不用多角度差分）
      </div>

      {/* yaw */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-gray-400">左右转 yaw</Label>
          <span className="text-[10px] text-cyan-300 font-mono">
            {faceTurn.yaw.toFixed(2)}
          </span>
        </div>
        <Slider
          value={[faceTurn.yaw]}
          min={-1}
          max={1}
          step={0.01}
          onValueChange={([v]) => handleYaw(v)}
          className="w-full"
        />
        <div className="flex justify-between text-[8px] text-gray-600">
          <span>← 左</span>
          <span>右 →</span>
        </div>
      </div>

      {/* pitch */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-gray-400">上下转 pitch</Label>
          <span className="text-[10px] text-cyan-300 font-mono">
            {faceTurn.pitch.toFixed(2)}
          </span>
        </div>
        <Slider
          value={[faceTurn.pitch]}
          min={-1}
          max={1}
          step={0.01}
          onValueChange={([v]) => handlePitch(v)}
          className="w-full"
        />
        <div className="flex justify-between text-[8px] text-gray-600">
          <span>← 上</span>
          <span>下 →</span>
        </div>
      </div>

      {/* actions */}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-[10px] border-[#1e1e3a] text-gray-300 hover:text-white gap-1"
          onClick={handleKeyframe}
          disabled={!activeClipId}
          title={activeClipId ? `在第 ${currentFrame} 帧记录转面` : '无激活片段'}
        >
          <KeyRound className="size-3" />
          打关键帧
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-[10px] border-[#1e1e3a] text-gray-300 hover:text-white gap-1"
          onClick={handleAnnotate}
        >
          <Crosshair className="size-3" />
          标注特征点
        </Button>
      </div>

      <div className="text-[9px] text-gray-600 leading-relaxed">
        有手动标注（眼/鼻/嘴）时转面用标注位置算深度，无标注时回退亮度启发式。
      </div>
    </div>
  );
}
