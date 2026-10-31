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
import { computeWorldTransforms } from '@/lib/unified-render';
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

    // 骨长必须按真 FK 测：关节点位经父 frame 复合 + 插槽挂接得出，
    // 不能拿 node.transform 在父坐标里直加（子 transform 与插槽位不
    // 一致时就测错）。口径同 IKChainEditor 捕获 FK 肘位：链全禁用的
    // 克隆上算；另把 ikBlueprint 置空——已有烘焙蓝图时它会接管求值，
    // 测到的就不是纯 FK 姿态。
    const fkChar: Character = {
      ...character,
      ikChains: (character.ikChains ?? []).map((c) => ({ ...c, enabled: false })),
      ikBlueprint: null,
    };
    const st = useProjectStore.getState();
    const transforms = computeWorldTransforms(fkChar, st.currentFrame, st.canvasWidth, st.canvasHeight);

    const blueprint = ikChainsToBlueprint(character, transforms as any);
    if (blueprint) {
      st.pushUndo('烘焙 IK 蓝图');
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
    useProjectStore.getState().pushUndo('保存 IK 蓝图');
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
    useProjectStore.getState().pushUndo('删除 IK 蓝图');
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
            <BlueprintEditor frameRate={useProjectStore.getState().frameRate} graph={localGraph} onChange={setLocalGraph} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
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
      {hasBaked && (
        <p className="text-[10px] leading-snug text-amber-300/80">
          已烘焙：该角色的 IK 由烘焙蓝图接管，IK 链不再直接求解；删除蓝图后恢复链求解。
        </p>
      )}
    </div>
  );
}
