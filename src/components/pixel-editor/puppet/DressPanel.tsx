'use client';

import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Shirt,
  X,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type {
  Character,
  Node,
  CostumeSet,
  DirectionIndex,
  Sprite,
} from '@/lib/unified-types';
import {
  createDefaultCostumeSet,
  createDefaultCostumePiece,
} from '@/lib/unified-types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const DIRECTIONS: { value: DirectionIndex; label: string }[] = [
  { value: 6, label: '南' },
  { value: 0, label: '东' },
  { value: 4, label: '西' },
  { value: 2, label: '北' },
];

interface DressPanelProps {
  unifiedCharacters: Record<string, Character>;
  /** 可分配的精灵（全局精灵表；父组件由 s.sprites 转换传入） */
  sprites: Sprite[];
  selectedCostumeId: string | null;
  setSelectedCostumeId: (id: string | null) => void;
  selectedNodeId: string | null;
  handleSelectNodeWithSync: (nodeId: string | null) => void;
  /** 隐藏内部节点列表（用共享树） */
  hideNodeList?: boolean;
}

/**
 * DressPanel — 穿衣阶段（新模型）。
 * 节点驱动：选角色 → 选服装集 → 选节点 → 给四个方向配精灵。
 * 写入 Character.sprites 表 + CostumeSet.pieces（SpriteRef），不再用 spriteMap。
 */

/** 精灵缩略图：canvas 绘制 PixelGrid */
function SpriteThumbnail({ sprite, size = 32 }: { sprite: Sprite; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sprite.data) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = sprite.width, h = sprite.height;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = sprite.data[y]?.[x];
        if (c && c !== '#00000000' && !c.endsWith('00')) {
          ctx.fillStyle = c;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }, [sprite]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
      className="rounded bg-black/50"
    />
  );
}

export default function DressPanel({
  unifiedCharacters,
  sprites,
  selectedCostumeId,
  setSelectedCostumeId,
  selectedNodeId,
  handleSelectNodeWithSync,
  hideNodeList = false,
}: DressPanelProps) {
  // 角色：unifiedCharacters 以 skeletonId 为 key
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const updateUnifiedCharacter = useProjectStore((s) => s.updateUnifiedCharacter);

  const selectedCharacter = useMemo(() => {
    if (!activePuppetSkeletonId) return null;
    return unifiedCharacters[activePuppetSkeletonId] ?? null;
  }, [unifiedCharacters, activePuppetSkeletonId]);

  const characterNodes = useMemo(
    () => (selectedCharacter ? Object.values(selectedCharacter.nodes) : []),
    [selectedCharacter]
  );

  const costumeSets = selectedCharacter?.costumeSets ?? [];
  // 不用 memo，直接算，确保每次渲染都是最新
  const selectedCostume = costumeSets.find((cs) => cs.id === selectedCostumeId) ?? costumeSets[0] ?? null;

  const selectedNode = useMemo(
    () => (selectedNodeId ? (selectedCharacter?.nodes[selectedNodeId] ?? null) : null),
    [selectedCharacter, selectedNodeId]
  );

  // ---- Handlers ----
  const handleAddCostume = () => {
    if (!selectedCharacter || !activePuppetSkeletonId) return;
    const store = useProjectStore.getState();
    store.pushUndo('添加服装集');
    const newSet = createDefaultCostumeSet(
      crypto.randomUUID(),
      `服装${costumeSets.length + 1}`
    );
    updateUnifiedCharacter(activePuppetSkeletonId, {
      costumeSets: [...selectedCharacter.costumeSets, newSet],
    });
    setSelectedCostumeId(newSet.id);
  };

  const handleDeleteCostume = (costumeId: string) => {
    if (!selectedCharacter || !activePuppetSkeletonId) return;
    const cs = selectedCharacter.costumeSets.find((s) => s.id === costumeId);
    if (!confirm(`删除服装集「${cs?.name ?? ''}」（含全部方向精灵分配）？`)) return;
    const store = useProjectStore.getState();
    store.pushUndo('删除服装集');
    const remaining = selectedCharacter.costumeSets.filter((cs) => cs.id !== costumeId);
    updateUnifiedCharacter(activePuppetSkeletonId, {
      costumeSets: remaining,
      // 如果删除的是激活服装，切换到第一个
      ...(selectedCharacter.activeCostumeSetId === costumeId
        ? { activeCostumeSetId: remaining[0]?.id }
        : {}),
    });
    if (selectedCostumeId === costumeId) {
      setSelectedCostumeId(null);
    }
  };

  const handleSpriteAssign = (nodeId: string, direction: DirectionIndex, spriteId: string | null) => {
    if (!selectedCharacter || !activePuppetSkeletonId || !selectedCostume) return;
    const store = useProjectStore.getState();
    store.pushUndo('分配精灵', 'assignSprite');

    const pieces = { ...selectedCostume.pieces };
    // 用 slotKey（不是 nodeId）——渲染器按 costumeSet.pieces[node.slot.slotKey] 查找
    const node = selectedCharacter.nodes[nodeId];
    const slotKey = node?.slot?.slotKey ?? nodeId;

    if (spriteId) {
      // Sprite 在全局表（sprites prop），直接引用 ID，不复制
      const sp = sprites.find((s) => s.id === spriteId);
      if (!sp) return;
      const key = sp.id ?? spriteId;
      // 写入 pieces[slotKey].sprites[direction] = { spriteId }
      const piece = pieces[slotKey] ?? createDefaultCostumePiece(slotKey);
      pieces[slotKey] = {
        ...piece,
        sprites: { ...piece.sprites, [direction]: { spriteId: key } },
      };
    } else {
      // 删除分配
      const piece = pieces[slotKey];
      if (piece) {
        const newSprites = { ...piece.sprites };
        delete newSprites[direction];
        pieces[slotKey] = { ...piece, sprites: newSprites };
      }
    }

    const newCostumeSets = selectedCharacter.costumeSets.map((cs) =>
      cs.id === selectedCostume.id ? { ...cs, pieces } : cs
    );
    updateUnifiedCharacter(activePuppetSkeletonId, {
      costumeSets: newCostumeSets,
    });
  };

  const getSpriteFor = (nodeId: string, direction: DirectionIndex): Sprite | null => {
    if (!selectedCostume || !selectedCharacter) return null;
    const node = selectedCharacter.nodes[nodeId];
    const slotKey = node?.slot?.slotKey ?? nodeId;
    const piece = selectedCostume.pieces[slotKey];
    const ref = piece?.sprites[direction];
    if (!ref) return null;
    // SpriteRef → spriteId → 全局精灵表（sprites prop）
    const spriteId = 'spriteId' in ref ? ref.spriteId : null;
    if (!spriteId) return null;
    return sprites.find((s) => s.id === spriteId) ?? null;
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
      {!hideNodeList && selectedCharacter && selectedCostume && (
        <div>
          <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
            节点（{characterNodes.length}）
          </Label>
          <div className="bg-[#080818] rounded border border-[#1e1e3a] p-1 max-h-40 overflow-y-auto mt-1">
            {characterNodes.map((node) => {
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
          sprites={sprites}
          getSpriteFor={getSpriteFor}
          onAssign={(dir, spriteId) => handleSpriteAssign(selectedNode.id, dir, spriteId)}
        />
      )}
    </div>
  );
}

// ---- 四方向精灵编辑器 ----
function DirectionSpriteEditor({
  node,
  sprites,
  getSpriteFor,
  onAssign,
}: {
  node: Node;
  sprites: Sprite[];
  getSpriteFor: (nodeId: string, dir: DirectionIndex) => Sprite | null;
  onAssign: (dir: DirectionIndex, spriteId: string | null) => void;
}) {
  const [pickerDir, setPickerDir] = useState<DirectionIndex | null>(null);

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
                  <SpriteThumbnail sprite={sprite} size={40} />
                ) : (
                  <Plus className="size-4 text-gray-700" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 精灵选择器 */}
      {pickerDir !== null && (
        <div className="mt-2 bg-[#111128] rounded border border-[#1e1e3a] p-1.5 max-h-40 overflow-y-auto">
          <div className="text-[9px] text-gray-600 mb-1">
            选择精灵 → {DIRECTIONS.find((d) => d.value === pickerDir)?.label}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {sprites.map((sp) => (
              <div
                key={sp.id ?? sp.name}
                onClick={() => {
                  onAssign(pickerDir, sp.id ?? null);
                  setPickerDir(null);
                }}
                className="p-1 rounded bg-black/30 hover:bg-cyan-500/20 cursor-pointer flex flex-col items-center gap-0.5"
                title={sp.name ?? sp.id}
              >
                <SpriteThumbnail sprite={sp} size={36} />
                <span className="text-[8px] text-gray-400 truncate w-full text-center">{sp.name ?? sp.id?.slice(0, 12)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
