'use client';

// ============================================================
// CharacterBlueprintEditor — 角色蓝图编辑器
// 编辑 character.blueprint：character_source → 用户后处理链 → screen
// 整角色特效（描边/辉光/调色等作用于合成后整角色）。
// character_source 与层级无关，节点增删改无需同步此图。
// ============================================================

import React, { useState, useCallback } from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/lib/store';
import type { Character } from '@/lib/unified-types';
import type { BlueprintGraph } from '@/lib/blueprint/ir';
import { createDefaultCharacterBlueprint, validateCharacterBlueprint } from '@/lib/blueprint/character';
import BlueprintEditor from './BlueprintEditor';
import { useBlueprintPreviewData } from './use-blueprint-preview-data';

interface CharacterBlueprintEditorProps {
  character: Character | null;
}

export default function CharacterBlueprintEditor({ character }: CharacterBlueprintEditorProps) {
  const [editing, setEditing] = useState(false);
  const [localGraph, setLocalGraph] = useState<BlueprintGraph | null>(null);
  const updateUnifiedCharacter = useProjectStore((s) => s.updateUnifiedCharacter);
  // 预览接线：与 PuppetModifierPanel 同一构造（服装/变体解析 + 整角色预览数据）
  const { spritesTable, costumeSetsNewFormat, characterNodes } = useBlueprintPreviewData(character);

  const graph = localGraph ?? character?.blueprint ?? null;

  const handleOpen = useCallback(() => {
    if (!character) return;
    setLocalGraph(character.blueprint ?? createDefaultCharacterBlueprint());
    setEditing(true);
  }, [character]);

  const handleClose = useCallback(() => {
    setEditing(false);
    setLocalGraph(null);
  }, []);

  const handleSave = useCallback(() => {
    if (!character || !localGraph) return;
    const missing = validateCharacterBlueprint(localGraph);
    if (missing.length > 0) {
      // 缺少系统节点时自动补回（不丢弃用户链）
      const fixed = { ...localGraph, nodes: [...localGraph.nodes] };
      if (missing.includes('character_source')) {
        fixed.nodes.unshift({
          id: 'ch_source',
          type: 'character_source',
          inputs: {},
          params: {},
          ui: { x: 40, y: 160 },
        });
      }
      updateUnifiedCharacter(character.id, { blueprint: fixed });
    } else {
      updateUnifiedCharacter(character.id, { blueprint: localGraph });
    }
    setEditing(false);
    setLocalGraph(null);
  }, [character, localGraph, updateUnifiedCharacter]);

  const handleDelete = useCallback(() => {
    if (!character) return;
    updateUnifiedCharacter(character.id, { blueprint: null });
    setEditing(false);
    setLocalGraph(null);
  }, [character, updateUnifiedCharacter]);

  if (!character) return null;

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={handleOpen} className="h-7 text-[11px]">
          <Layers className="size-3 mr-1" />
          {character.blueprint ? '编辑角色蓝图' : '创建角色蓝图'}
        </Button>
        {character.blueprint && (
          <Button size="sm" variant="ghost" onClick={handleDelete} className="h-7 text-[11px] text-red-400 hover:text-red-300">
            <Trash2 className="size-3" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-400">
          角色蓝图：整角色后处理（character_source → 后处理 → screen）
        </span>
        <div className="flex-1" />
        <Button size="sm" onClick={handleSave} className="h-7 text-[11px]">
          保存
        </Button>
        <Button size="sm" variant="ghost" onClick={handleClose} className="h-7 text-[11px]">
          取消
        </Button>
      </div>
      {graph && (
        <BlueprintEditor
          frameRate={useProjectStore.getState().frameRate}
          graph={graph}
          onChange={setLocalGraph}
          title={`${character.name} 的角色蓝图`}
          character={character}
          characterNodes={characterNodes}
          costumeSets={costumeSetsNewFormat}
          activeCostumeSetId={character.activeCostumeSetId}
          slotVariants={character.slotVariants}
          spritesTable={spritesTable as any}
        />
      )}
    </div>
  );
}
