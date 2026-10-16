'use client';

// ============================================================
// IKBakeButton — IK 烘焙按钮
// 把 character.ikChains 烘焙成 character.ikBlueprint（持久化蓝图，
// 可在蓝图编辑器里打开编辑）。骨骼长度从当前 FK 姿态烘焙为 params，
// 目标点保留为 inputs（可接 gait/mouse/const 节点）。
// ============================================================

import React, { useState, useCallback } from 'react';
import { Flame, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/lib/store';
import type { Character } from '@/lib/unified-types';
import { ikChainsToBlueprint } from '@/lib/blueprint/ik-bake';
import BlueprintEditor from './BlueprintEditor';
import type { BlueprintGraph } from '@/lib/blueprint/ir';

interface IKBakeButtonProps {
  character: Character | null;
}

export default function IKBakeButton({ character }: IKBakeButtonProps) {
  const [editing, setEditing] = useState(false);
  const [localGraph, setLocalGraph] = useState<BlueprintGraph | null>(null);
  const updateUnifiedCharacter = useProjectStore((s) => s.updateUnifiedCharacter);

  const chains = character?.ikChains?.filter((c) => c.enabled) ?? [];
  const hasBaked = !!character?.ikBlueprint;

  const handleBake = useCallback(() => {
    if (!character || chains.length === 0) return;

    // Compute current FK transforms for bone length measurement.
    // We use a minimal transform map; bone lengths are measured from
    // the character's rest pose (node.transform + hierarchy).
    // For simplicity, we compute from the stored node transforms.
    const transforms = new Map();
    const computeNode = (nodeId: string, parentX: number, parentY: number, parentAngle: number) => {
      const node = character.nodes[nodeId];
      if (!node) return;
      const angle = parentAngle + (node.transform.angle ?? 0);
      const x = parentX + (node.transform.x ?? 0);
      const y = parentY + (node.transform.y ?? 0);
      // 已是 SubPixel，直接存
      transforms.set(nodeId, {
        nodeId,
        worldX: x,
        worldY: y,
        worldAngle: angle,
      });
      for (const childId of node.children) {
        computeNode(childId, x, y, angle);
      }
    };
    computeNode(character.rootNodeId, 0, 0, 0);

    const blueprint = ikChainsToBlueprint(character, transforms as any);
    if (blueprint) {
      updateUnifiedCharacter(character.id, { ikBlueprint: blueprint });
    }
  }, [character, chains.length, updateUnifiedCharacter]);

  const handleOpen = useCallback(() => {
    if (!character?.ikBlueprint) return;
    setLocalGraph(character.ikBlueprint);
    setEditing(true);
  }, [character]);

  const handleSave = useCallback(() => {
    if (!character || !localGraph) return;
    updateUnifiedCharacter(character.id, { ikBlueprint: localGraph });
    setEditing(false);
    setLocalGraph(null);
  }, [character, localGraph, updateUnifiedCharacter]);

  const handleClose = useCallback(() => {
    setEditing(false);
    setLocalGraph(null);
  }, []);

  const handleDelete = useCallback(() => {
    if (!character) return;
    updateUnifiedCharacter(character.id, { ikBlueprint: null });
  }, [character, updateUnifiedCharacter]);

  if (!character) return null;

  if (editing && localGraph) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
        <div className="bg-[#0a0a1a] border border-[#2a2a4a] rounded-lg w-full max-w-4xl h-[80vh] flex flex-col">
          <div className="flex items-center justify-between p-3 border-b border-[#1e1e3a]">
            <div className="text-sm text-gray-200">IK 蓝图（已烘焙，可编辑）</div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave}>保存</Button>
              <Button size="sm" variant="outline" onClick={handleClose}>取消</Button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <BlueprintEditor graph={localGraph} onChange={setLocalGraph} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={handleBake}
        disabled={chains.length === 0}
        className="h-7 text-[11px]"
        title={chains.length === 0 ? '没有启用的 IK 链' : `烘焙 ${chains.length} 条 IK 链`}
      >
        <Flame className="size-3 mr-1" />
        烘焙 IK
      </Button>
      {hasBaked && (
        <>
          <Button size="sm" variant="outline" onClick={handleOpen} className="h-7 text-[11px]">
            <Pencil className="size-3 mr-1" />
            编辑 IK 蓝图
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDelete} className="h-7 text-[11px] text-red-400">
            删除
          </Button>
        </>
      )}
    </div>
  );
}
