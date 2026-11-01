'use client';

// ============================================================
// StateBlueprintEditor — 状态蓝图编辑器
// 编辑 character.stateBlueprint：纯状态图（无像素），每帧在服装解析前求值，
// costume_state 节点输出服装集/服装槽变体指令（叠加顺序：静态 → clip 轨道 → 状态蓝图）。
// ============================================================

import React, { useState, useCallback } from 'react';
import { Shirt, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/lib/store';
import type { Character } from '@/lib/unified-types';
import type { BlueprintGraph } from '@/lib/blueprint/ir';
import BlueprintEditor from './BlueprintEditor';
import { useBlueprintPreviewData } from './use-blueprint-preview-data';

function createDefaultStateBlueprint(): BlueprintGraph {
  return {
    version: 1,
    nodes: [
      {
        id: 'state_1',
        type: 'costume_state',
        inputs: {},
        params: { setId: '', slot: '', variant: '', clearVariant: '' },
        ui: { x: 120, y: 120 },
      },
    ],
    outputId: 'state_1',
  } as BlueprintGraph;
}

interface StateBlueprintEditorProps {
  character: Character | null;
}

export default function StateBlueprintEditor({ character }: StateBlueprintEditorProps) {
  const [editing, setEditing] = useState(false);
  const [localGraph, setLocalGraph] = useState<BlueprintGraph | null>(null);
  const updateUnifiedCharacter = useProjectStore((s) => s.updateUnifiedCharacter);
  const { spritesTable, costumeSetsNewFormat, characterNodes } = useBlueprintPreviewData(character);

  const graph = localGraph ?? character?.stateBlueprint ?? null;

  const handleOpen = useCallback(() => {
    if (!character) return;
    setLocalGraph(character.stateBlueprint ?? createDefaultStateBlueprint());
    setEditing(true);
  }, [character]);

  const handleClose = useCallback(() => {
    setEditing(false);
    setLocalGraph(null);
  }, []);

  const handleSave = useCallback(() => {
    if (!character || !localGraph) return;
    useProjectStore.getState().pushUndo('保存状态蓝图');
    updateUnifiedCharacter(character.id, { stateBlueprint: localGraph });
    setEditing(false);
    setLocalGraph(null);
  }, [character, localGraph, updateUnifiedCharacter]);

  const handleDelete = useCallback(() => {
    if (!character) return;
    useProjectStore.getState().pushUndo('删除状态蓝图');
    updateUnifiedCharacter(character.id, { stateBlueprint: null });
    setEditing(false);
    setLocalGraph(null);
  }, [character, updateUnifiedCharacter]);

  if (!character) return null;

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={handleOpen} className="h-7 text-[11px]">
          <Shirt className="size-3 mr-1" />
          {character.stateBlueprint ? '编辑状态蓝图' : '创建状态蓝图'}
        </Button>
        {character.stateBlueprint && (
          <Button size="sm" variant="ghost" onClick={handleDelete} className="h-7 text-[11px] text-red-400 hover:text-red-300">
            <Trash2 className="size-3" />
          </Button>
        )}
      </div>
    );
  }

  // ID 对照（costume_state 参数填 id 用）
  const slotKeys = new Set<string>();
  for (const n of Object.values(character.nodes)) {
    if (n.slot?.slotKey) slotKeys.add(n.slot.slotKey);
  }
  for (const cs of character.costumeSets) {
    for (const k of Object.keys(cs.pieces)) slotKeys.add(k);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-400">
          状态蓝图：costume_state 节点输出服装集/部位变体（gate 可分时段）
        </span>
        <div className="flex-1" />
        <Button size="sm" onClick={handleSave} className="h-7 text-[11px]">
          保存
        </Button>
        <Button size="sm" variant="ghost" onClick={handleClose} className="h-7 text-[11px]">
          取消
        </Button>
      </div>
      <div className="text-[9px] text-gray-600 font-mono leading-relaxed bg-[#0a0a1a] rounded p-1.5">
        <div>服装集：{character.costumeSets.map((cs) => `${cs.name}=${cs.id}`).join(' · ') || '（无）'}</div>
        <div>变体：{(character.variantDefs ?? []).map((v) => `${v.name}=${v.id}`).join(' · ') || '（无）'}</div>
        <div>服装槽：{[...slotKeys].join(' · ') || '（无）'}</div>
      </div>
      {graph && (
        <BlueprintEditor
          graph={graph}
          onChange={setLocalGraph}
          title={`${character.name} 的状态蓝图`}
          character={character}
          characterNodes={characterNodes}
          costumeSets={costumeSetsNewFormat}
          activeCostumeSetId={character.activeCostumeSetId}
          slotVariants={character.slotVariants}
          spritesTable={spritesTable as any}
        />
      )}
      <button
        onClick={() => setLocalGraph((g) => {
          if (!g) return g;
          const id = `state_${g.nodes.length + 1}_${Math.floor(Math.random() * 1e6)}`;
          return {
            ...g,
            nodes: [
              ...g.nodes,
              {
                id,
                type: 'costume_state',
                inputs: {},
                params: { setId: '', slot: '', variant: '', clearVariant: '' },
                ui: { x: 120 + g.nodes.length * 30, y: 260 },
              } as BlueprintGraph['nodes'][number],
            ],
          };
        })}
        className="flex items-center gap-1 text-[10px] text-purple-300 hover:text-purple-200"
      >
        <Plus className="size-3" /> 再加一个服装状态节点
      </button>
    </div>
  );
}
