'use client';

import React, { useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Shirt,
  X,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type {
  PuppetCharacter,
  PuppetSkeleton,
  PuppetNode,
  PuppetDirection,
  Part,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const DIRECTIONS: { value: PuppetDirection; label: string }[] = [
  { value: 'S', label: '南' },
  { value: 'E', label: '东' },
  { value: 'W', label: '西' },
  { value: 'N', label: '北' },
];

interface DressPanelProps {
  puppetCharacters: PuppetCharacter[];
  puppetSkeletons: PuppetSkeleton[];
  parts: Part[];
  selectedCostumeId: string | null;
  setSelectedCostumeId: (id: string | null) => void;
  selectedNodeId: string | null;
  handleSelectNodeWithSync: (nodeId: string | null) => void;
  /** 隐藏内部节点列表（用共享树） */
  hideNodeList?: boolean;
}

/**
 * DressPanel — 穿衣阶段。
 * 节点驱动：选角色 → 选服装集 → 选节点 → 给四个方向配精灵。
 * 服装集保留，但 UI 不再是独立管理器，而是嵌在节点流程里。
 */
export default function DressPanel({
  puppetCharacters,
  puppetSkeletons,
  parts,
  selectedCostumeId,
  setSelectedCostumeId,
  selectedNodeId,
  handleSelectNodeWithSync,
  hideNodeList = false,
}: DressPanelProps) {
  // 角色从左侧选中的骨架反查，不再用右侧选择
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const selectedCharacter = useMemo(
    () => puppetCharacters.find((c) => c.puppetSkeletonId === activePuppetSkeletonId) ?? null,
    [puppetCharacters, activePuppetSkeletonId]
  );

  const skeleton = useMemo(
    () =>
      selectedCharacter
        ? puppetSkeletons.find((s) => s.id === selectedCharacter.puppetSkeletonId) ?? null
        : null,
    [selectedCharacter, puppetSkeletons]
  );

  const costumeSets = selectedCharacter?.costumeSets ?? [];
  const selectedCostume = useMemo(
    () => costumeSets.find((cs) => cs.id === selectedCostumeId) ?? costumeSets[0] ?? null,
    [costumeSets, selectedCostumeId]
  );

  const selectedNode = useMemo(
    () => skeleton?.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [skeleton, selectedNodeId]
  );

  // ---- Handlers ----
  const handleAddCostume = () => {
    if (!selectedCharacter?.id) return;
    const store = useProjectStore.getState();
    store.pushUndo('添加服装集');
    const newSet = {
      id: crypto.randomUUID(),
      name: `服装${costumeSets.length + 1}`,
      spriteMap: {},
    };
    useProjectStore.setState({
      puppetCharacters: (store.puppetCharacters ?? []).map((c) =>
        c.id === selectedCharacter?.id
          ? { ...c, costumeSets: [...c.costumeSets, newSet] }
          : c
      ),
    });
    setSelectedCostumeId(newSet.id);
  };

  const handleDeleteCostume = (costumeId: string) => {
    if (!selectedCharacter?.id) return;
    const store = useProjectStore.getState();
    const cs = store.puppetCharacters
      ?.find((c) => c.id === selectedCharacter?.id)
      ?.costumeSets.find((s) => s.id === costumeId);
    if (!confirm(`删除服装集「${cs?.name ?? ''}」（含全部方向精灵分配）？`)) return;
    store.pushUndo('删除服装集');
    useProjectStore.setState({
      puppetCharacters: (store.puppetCharacters ?? []).map((c) =>
        c.id === selectedCharacter?.id
          ? { ...c, costumeSets: c.costumeSets.filter((cs) => cs.id !== costumeId) }
          : c
      ),
    });
    if (selectedCostumeId === costumeId) {
      setSelectedCostumeId(null);
    }
  };

  const handleSpriteAssign = (nodeId: string, direction: PuppetDirection, partId: string | null) => {
    if (!selectedCharacter?.id || !selectedCostume) return;
    const store = useProjectStore.getState();
    store.pushUndo('分配精灵', 'assignSprite');
    const key = `${nodeId}:${direction}`;
    useProjectStore.setState({
      puppetCharacters: (store.puppetCharacters ?? []).map((c) =>
        c.id === selectedCharacter?.id
          ? {
              ...c,
              costumeSets: c.costumeSets.map((cs) =>
                cs.id === selectedCostume.id
                  ? {
                      ...cs,
                      spriteMap: partId
                        ? { ...cs.spriteMap, [key]: partId }
                        : Object.fromEntries(
                            Object.entries(cs.spriteMap).filter(([k]) => k !== key)
                          ),
                    }
                  : cs
              ),
            }
          : c
      ),
    });
  };

  const getSpriteFor = (nodeId: string, direction: PuppetDirection): Part | null => {
    if (!selectedCostume) return null;
    const partId = selectedCostume.spriteMap[`${nodeId}:${direction}`];
    if (!partId) return null;
    return parts.find((p) => p.id === partId) ?? null;
  };

  return (
    <div className="space-y-3">
      {/* 角色：用左侧选中的骨架对应的角色，不再重复选择 */}
      {/* 服装集 */}
      {selectedCharacter && (
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
              <Shirt className="size-3 inline mr-1" />
              服装集
            </Label>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-cyan-400 hover:text-cyan-300"
              onClick={handleAddCostume}
              title="添加服装集"
            >
              <Plus className="size-3" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {costumeSets.map((cs) => (
              <div
                key={cs.id}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] cursor-pointer border ${
                  selectedCostume?.id === cs.id
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                    : 'bg-[#111128] border-[#1e1e3a] text-gray-400 hover:border-gray-600'
                }`}
                onClick={() => setSelectedCostumeId(cs.id)}
              >
                <span>{cs.name}</span>
                {costumeSets.length > 1 && (
                  <X
                    className="size-3 hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCostume(cs.id);
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 节点列表（hideNodeList 时用共享树） */}
      {!hideNodeList && skeleton && selectedCostume && (
        <div>
          <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
            节点（{skeleton.nodes.length}）
          </Label>
          <div className="bg-[#080818] rounded border border-[#1e1e3a] p-1 max-h-40 overflow-y-auto mt-1">
            {skeleton.nodes.map((node) => {
              const hasSprite = DIRECTIONS.some((d) => getSpriteFor(node.id, d.value));
              return (
                <div
                  key={node.id}
                  onClick={() => handleSelectNodeWithSync(node.id)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-[11px] cursor-pointer ${
                    selectedNodeId === node.id
                      ? 'bg-cyan-500/20 text-cyan-300'
                      : 'text-gray-400 hover:bg-white/5'
                  }`}
                >
                  <span className="flex-1 truncate">{node.name}</span>
                  {hasSprite && (
                    <span className="size-1.5 rounded-full bg-emerald-400" title="已配精灵" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 方向精灵分配 */}
      {selectedNode && selectedCostume && (
        <DirectionSpriteEditor
          node={selectedNode}
          parts={parts}
          getSpriteFor={getSpriteFor}
          onAssign={(dir, partId) => handleSpriteAssign(selectedNode.id, dir, partId)}
        />
      )}
    </div>
  );
}

// ---- 四方向精灵编辑器 ----
function DirectionSpriteEditor({
  node,
  parts,
  getSpriteFor,
  onAssign,
}: {
  node: PuppetNode;
  parts: Part[];
  getSpriteFor: (nodeId: string, dir: PuppetDirection) => Part | null;
  onAssign: (dir: PuppetDirection, partId: string | null) => void;
}) {
  const [pickerDir, setPickerDir] = useState<PuppetDirection | null>(null);

  return (
    <div className="bg-[#080818] rounded border border-[#1e1e3a] p-2">
      <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
        {node.name} — 方向精灵
      </Label>
      <div className="grid grid-cols-2 gap-1.5 mt-1.5">
        {DIRECTIONS.map(({ value, label }) => {
          const sprite = getSpriteFor(node.id, value);
          return (
            <div
              key={value}
              className="bg-[#111128] rounded border border-[#1e1e3a] p-1.5"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-gray-500">{label} ({value})</span>
                {sprite && (
                  <X
                    className="size-3 text-gray-600 hover:text-red-400 cursor-pointer"
                    onClick={() => onAssign(value, null)}
                  />
                )}
              </div>
              <div
                onClick={() => setPickerDir(pickerDir === value ? null : value)}
                className="h-12 rounded bg-black/30 border border-dashed border-gray-700 flex items-center justify-center cursor-pointer hover:border-cyan-500/50 overflow-hidden"
              >
                {sprite ? (
                  <span className="text-[9px] text-gray-400 truncate px-1">{sprite.name}</span>
                ) : (
                  <Plus className="size-4 text-gray-700" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 精灵选择器 */}
      {pickerDir && (
        <div className="mt-2 bg-[#111128] rounded border border-[#1e1e3a] p-1.5 max-h-40 overflow-y-auto">
          <div className="text-[9px] text-gray-600 mb-1">
            选择精灵 → {DIRECTIONS.find((d) => d.value === pickerDir)?.label}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {parts.map((part) => (
              <div
                key={part.id}
                onClick={() => {
                  onAssign(pickerDir, part.id);
                  setPickerDir(null);
                }}
                className="px-1.5 py-1 rounded text-[9px] bg-black/30 text-gray-400 hover:bg-cyan-500/20 hover:text-cyan-300 cursor-pointer truncate"
                title={part.name}
              >
                {part.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
