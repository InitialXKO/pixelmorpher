'use client';

import React, { useCallback } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type {
  PuppetSkeleton,
  PuppetCharacter,
  CostumeSet,
  PuppetDirection,
} from '@/lib/types';
import type { Part } from '@/lib/types';
import { PUPPET_DIRECTIONS } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface CostumeModePanelProps {
  puppetSkeletons: PuppetSkeleton[];
  puppetCharacters: PuppetCharacter[];
  parts: Part[];
  selectedCharacterId: string | null;
  setSelectedCharacterId: (id: string | null) => void;
  selectedCostumeId: string | null;
  setSelectedCostumeId: (id: string | null) => void;
  selectedCharacter: PuppetCharacter | null;
  selectedCostume: CostumeSet | null;
}

export default function CostumeModePanel({
  puppetSkeletons,
  puppetCharacters,
  parts,
  selectedCharacterId,
  setSelectedCharacterId,
  selectedCostumeId,
  setSelectedCostumeId,
  selectedCharacter,
  selectedCostume,
}: CostumeModePanelProps) {

  const handleDeleteCharacter = useCallback(() => {
    if (!selectedCharacterId) return;
    const store = useProjectStore.getState();
    store.pushUndo('删除角色');
    useProjectStore.setState({
      puppetCharacters: (store.puppetCharacters ?? []).filter((c) => c.id !== selectedCharacterId),
    });
    setSelectedCharacterId(null);
  }, [selectedCharacterId, setSelectedCharacterId]);

  const handleAddCostumeSet = useCallback(() => {
    if (!selectedCharacterId) return;
    const store = useProjectStore.getState();
    store.pushUndo('添加服装');
    const newCostume: CostumeSet = {
      id: crypto.randomUUID(),
      name: `服装_${((selectedCharacter?.costumeSets.length ?? 0) + 1)}`,
      spriteMap: {},
    };
    useProjectStore.setState({
      puppetCharacters: (store.puppetCharacters ?? []).map((c) =>
        c.id === selectedCharacterId
          ? { ...c, costumeSets: [...c.costumeSets, newCostume] }
          : c
      ),
    });
    setSelectedCostumeId(newCostume.id);
  }, [selectedCharacterId, selectedCharacter, setSelectedCostumeId]);

  const handleDeleteCostumeSet = useCallback(() => {
    if (!selectedCharacterId || !selectedCostumeId) return;
    const store = useProjectStore.getState();
    store.pushUndo('删除服装');
    useProjectStore.setState({
      puppetCharacters: (store.puppetCharacters ?? []).map((c) =>
        c.id === selectedCharacterId
          ? {
              ...c,
              costumeSets: c.costumeSets.filter((cs) => cs.id !== selectedCostumeId),
              activeCostumeSetId:
                c.activeCostumeSetId === selectedCostumeId
                  ? c.costumeSets[0]?.id ?? null
                  : c.activeCostumeSetId,
            }
          : c
      ),
    });
    setSelectedCostumeId(null);
  }, [selectedCharacterId, selectedCostumeId, setSelectedCostumeId]);

  const handleAssignSpriteToSlot = useCallback(
    (key: string, partId: string) => {
      if (!selectedCharacterId || !selectedCostumeId) return;
      const store = useProjectStore.getState();
      store.pushUndo('分配精灵', 'assignSprite');
      useProjectStore.setState({
        puppetCharacters: (store.puppetCharacters ?? []).map((c) =>
          c.id === selectedCharacterId
            ? {
                ...c,
                costumeSets: c.costumeSets.map((cs) =>
                  cs.id === selectedCostumeId
                    ? { ...cs, spriteMap: { ...cs.spriteMap, [key]: partId } }
                    : cs
                ),
              }
            : c
        ),
      });
    },
    [selectedCharacterId, selectedCostumeId]
  );

  return (
    <div className="space-y-3">
      {/* Character selector */}
      <div className="space-y-1.5">
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">角色</Label>
        <div className="flex items-center gap-1">
          <select
            value={selectedCharacterId ?? ''}
            onChange={(e) => {
              setSelectedCharacterId(e.target.value || null);
              setSelectedCostumeId(null);
            }}
            className="flex-1 h-7 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded px-2 text-gray-300"
          >
            <option value="">— 选择角色 —</option>
            {puppetCharacters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-red-400 hover:text-red-300"
            onClick={handleDeleteCharacter}
            disabled={!selectedCharacterId}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      {/* Costume set selector */}
      {selectedCharacter && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-gray-500 uppercase tracking-wider">服装集</Label>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-cyan-400"
              onClick={handleAddCostumeSet}
              title="添加服装集"
            >
              <Plus className="size-3" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <select
              value={selectedCostumeId ?? ''}
              onChange={(e) => setSelectedCostumeId(e.target.value || null)}
              className="flex-1 h-7 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded px-2 text-gray-300"
            >
              <option value="">— 选择服装 —</option>
              {selectedCharacter.costumeSets.map((cs) => (
                <option key={cs.id} value={cs.id}>{cs.name}</option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-red-400 hover:text-red-300"
              onClick={handleDeleteCostumeSet}
              disabled={!selectedCostumeId}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Sprite mapping grid */}
      {selectedCostume && (() => {
        const charSkeleton = puppetSkeletons.find(
          (s) => s.id === selectedCharacter!.puppetSkeletonId
        );
        if (!charSkeleton) {
          return (
            <div className="text-center py-4">
              <p className="text-[9px] text-gray-600">角色骨骼未找到</p>
            </div>
          );
        }
        return (
          <div className="space-y-1.5">
            <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
              精灵映射 (节点 × 方向)
            </Label>
            <div className="bg-[#080818] rounded border border-[#1e1e3a] p-1 overflow-x-auto max-h-64">
              <table className="text-[9px] w-full">
                <thead>
                  <tr>
                    <th className="text-gray-600 text-left px-1 py-0.5 sticky left-0 bg-[#080818]">节点</th>
                    {PUPPET_DIRECTIONS.map((dir) => (
                      <th key={dir} className="text-gray-600 px-1 py-0.5 text-center">{dir}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {charSkeleton.nodes.map((node) => (
                    <tr key={node.id}>
                      <td className="text-gray-400 px-1 py-0.5 sticky left-0 bg-[#080818] whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <div
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: node.color || '#888' }}
                          />
                          {node.name}
                        </div>
                      </td>
                      {PUPPET_DIRECTIONS.map((dir) => {
                        const key = `${node.id}:${dir}`;
                        const assignedPartId = selectedCostume.spriteMap[key];
                        const assignedPart = assignedPartId
                          ? parts.find((p) => p.id === assignedPartId)
                          : null;
                        return (
                          <td key={dir} className="px-0.5 py-0.5">
                            <div className="flex items-center gap-0.5">
                              <select
                                value={assignedPartId ?? ''}
                                onChange={(e) =>
                                  handleAssignSpriteToSlot(key, e.target.value)
                                }
                                className="w-full h-5 text-[8px] bg-[#0d0d1a] border border-[#1e1e3a] rounded px-0.5 text-gray-400"
                              >
                                <option value="">-</option>
                                {parts.map((p) => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                              {assignedPartId && (
                                <button
                                  className="size-4 flex items-center justify-center text-cyan-500 hover:text-cyan-300 flex-shrink-0"
                                  title="编辑此精灵像素"
                                  onClick={() => {
                                    const { useWorkspaceStore } = require('@/lib/workspace-store');
                                    useWorkspaceStore.getState().setMode('animation');
                                    useEditorStore.getState().selectPart(assignedPartId);
                                    useEditorStore.getState().enterPartEditMode(assignedPartId);
                                  }}
                                >
                                  <Pencil className="size-2.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
