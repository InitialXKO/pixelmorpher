'use client';

import React, { useState, useCallback } from 'react';
import { DirectionIndex, DIRECTION_NAMES } from '@/lib/unified-types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Star, StarOff, ArrowLeftRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// ---- Exported Info Interfaces ----

export interface CharacterInfo {
  id: string;
  name: string;
  skeletonId: string;
}

export interface CostumePieceInfo {
  slotKey: string;
  fillColor: string;
  mirrorMap: Record<number, number>; // direction → source direction
}

export interface CostumeSetInfo {
  id: string;
  name: string;
  /** spriteMap: Record<nodeId:direction, partId> (old format) */
  spriteMap: Record<string, string>;
  /** pieces: Record<slotKey, CostumePieceInfo> (new format, optional) */
  pieces?: Record<string, CostumePieceInfo>;
}

export interface NodeInfo {
  id: string;
  name: string;
  color: string;
  sockets: { id: string; name: string }[];
}

export interface PartInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  thumbnail?: string; // Optional data URL for part preview
}

export interface CostumeManagerProps {
  characters: CharacterInfo[];
  selectedCharacterId: string | null;
  onCharacterSelect: (id: string | null) => void;
  onCharacterDelete: (id: string) => void;

  costumeSets: CostumeSetInfo[];
  selectedCostumeId: string | null;
  onCostumeSelect: (id: string | null) => void;
  onCostumeAdd: () => void;
  onCostumeDelete: (id: string) => void;
  activeCostumeSetId?: string | null;
  onActiveCostumeSetChange?: (id: string | null) => void;

  nodes: NodeInfo[];
  parts: PartInfo[];

  onSpriteAssign: (nodeId: string, direction: number, partId: string | null) => void;
  onSpriteRemove: (nodeId: string, direction: number) => void;

  disabled?: boolean;
}

// ---- Direction label abbreviations for table headers ----

const DIR_ABBREVIATIONS: Record<DirectionIndex, string> = {
  0: 'E',
  1: 'NE',
  2: 'N',
  3: 'NW',
  4: 'W',
  5: 'SW',
  6: 'S',
  7: 'SE',
} as const;

const ALL_DIRECTIONS: DirectionIndex[] = [0, 1, 2, 3, 4, 5, 6, 7];

// ---- Helper: get mirror info for a specific node+direction ----

function getMirrorSource(
  costumeSet: CostumeSetInfo | null,
  nodeId: string,
  direction: DirectionIndex
): DirectionIndex | null {
  if (!costumeSet) return null;

  // Check new format pieces first
  if (costumeSet.pieces) {
    const piece = costumeSet.pieces[nodeId];
    if (piece && piece.mirrorMap && piece.mirrorMap[direction] !== undefined) {
      return piece.mirrorMap[direction] as DirectionIndex;
    }
  }

  // No mirror info available
  return null;
}

// ---- SpriteCell: individual cell in the mapping grid ----

interface SpriteCellProps {
  nodeId: string;
  direction: DirectionIndex;
  assignedPartId: string | undefined;
  assignedPart: PartInfo | undefined;
  mirrorSource: DirectionIndex | null;
  parts: PartInfo[];
  onAssign: (nodeId: string, direction: number, partId: string | null) => void;
  onRemove: (nodeId: string, direction: number) => void;
  disabled?: boolean;
}

function SpriteCell({
  nodeId,
  direction,
  assignedPartId,
  assignedPart,
  mirrorSource,
  parts,
  onAssign,
  onRemove,
  disabled,
}: SpriteCellProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback(
    (partId: string | null) => {
      if (partId === null) {
        onRemove(nodeId, direction);
      } else {
        onAssign(nodeId, direction, partId);
      }
      setOpen(false);
    },
    [nodeId, direction, onAssign, onRemove]
  );

  const dirLabel = DIR_ABBREVIATIONS[direction];

  return (
    <td className="px-0.5 py-0.5">
      <Popover open={open && !disabled} onOpenChange={disabled ? undefined : setOpen}>
        <PopoverTrigger asChild>
          <button
            className={`w-full h-5 text-[8px] rounded px-0.5 text-left flex items-center gap-0.5 border transition-colors ${
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : 'cursor-pointer hover:border-cyan-500/40'
            } ${
              assignedPartId
                ? 'bg-[#0d0d2a] border-[#1e1e3a] text-gray-300'
                : 'bg-[#0d0d1a] border-[#1e1e3a] text-gray-600'
            }`}
            disabled={disabled}
            title={
              mirrorSource !== null
                ? `Mirrors from ${DIRECTION_NAMES[mirrorSource]}`
                : assignedPart
                  ? assignedPart.name
                  : '未分配'
            }
          >
            {assignedPartId && assignedPart ? (
              <>
                <div
                  className="size-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: assignedPartId ? '#22d3ee' : '#444' }}
                />
                <span className="truncate max-w-[36px]">{assignedPart.name}</span>
              </>
            ) : (
              <span>—</span>
            )}
            {mirrorSource !== null && (
              <ArrowLeftRight className="text-cyan-400/60 size-[7px] flex-shrink-0 ml-auto" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="bg-[#111128] border-[#1e1e3a] p-1 w-48 max-h-48 overflow-y-auto"
          side="bottom"
          align="start"
          sideOffset={2}
        >
          {/* Header */}
          <div className="text-[8px] text-gray-500 px-1 py-0.5 border-b border-[#1e1e3a] mb-0.5 flex items-center justify-between">
            <span>
              {dirLabel} 方向精灵
            </span>
            {mirrorSource !== null && (
              <span className="text-cyan-400/60 flex items-center gap-0.5">
                <ArrowLeftRight className="size-[7px]" />
                镜像自 {DIR_ABBREVIATIONS[mirrorSource]}
              </span>
            )}
          </div>
          {/* Clear option */}
          <button
            className="w-full text-left text-[9px] px-1.5 py-1 rounded hover:bg-[#1e1e3a] text-red-400/70 hover:text-red-400 transition-colors"
            onClick={() => handleSelect(null)}
          >
            清除分配
          </button>
          {/* Part list */}
          {parts.map((p) => (
            <button
              key={p.id}
              className={`w-full text-left text-[9px] px-1.5 py-1 rounded transition-colors flex items-center gap-1.5 ${
                p.id === assignedPartId
                  ? 'bg-cyan-500/10 text-cyan-300'
                  : 'hover:bg-[#1e1e3a] text-gray-300'
              }`}
              onClick={() => handleSelect(p.id)}
            >
              {p.thumbnail && (
                <img
                  src={p.thumbnail}
                  alt={p.name}
                  className="size-4 rounded border border-[#1e1e3a] flex-shrink-0"
                  style={{ imageRendering: 'pixelated' }}
                />
              )}
              {!p.thumbnail && (
                <div className="size-4 rounded border border-[#1e1e3a] bg-[#0d0d1a] flex-shrink-0 flex items-center justify-center">
                  <span className="text-[6px] text-gray-600">?</span>
                </div>
              )}
              <span className="truncate">{p.name}</span>
              <span className="text-[7px] text-gray-600 ml-auto flex-shrink-0">
                {p.width}×{p.height}
              </span>
            </button>
          ))}
          {parts.length === 0 && (
            <div className="text-[8px] text-gray-600 px-1.5 py-2 text-center">
              无可用精灵
            </div>
          )}
        </PopoverContent>
      </Popover>
    </td>
  );
}

// ---- Main Component ----

export function CostumeManager({
  characters,
  selectedCharacterId,
  onCharacterSelect,
  onCharacterDelete,
  costumeSets,
  selectedCostumeId,
  onCostumeSelect,
  onCostumeAdd,
  onCostumeDelete,
  activeCostumeSetId,
  onActiveCostumeSetChange,
  nodes,
  parts,
  onSpriteAssign,
  onSpriteRemove,
  disabled,
}: CostumeManagerProps) {
  const selectedCostume = costumeSets.find((cs) => cs.id === selectedCostumeId) ?? null;

  const handleSetActive = useCallback(
    (id: string) => {
      if (onActiveCostumeSetChange) {
        // Toggle: if already active, deactivate
        onActiveCostumeSetChange(activeCostumeSetId === id ? null : id);
      }
    },
    [onActiveCostumeSetChange, activeCostumeSetId]
  );

  return (
    <div className="space-y-3">
      {/* ---- Character Selector ---- */}
      <div className="space-y-1.5">
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">角色</Label>
        <div className="flex items-center gap-1">
          <select
            value={selectedCharacterId ?? ''}
            onChange={(e) => {
              onCharacterSelect(e.target.value || null);
            }}
            className="flex-1 h-7 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded px-2 text-gray-300"
            disabled={disabled}
          >
            <option value="">— 选择角色 —</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-red-400 hover:text-red-300"
            onClick={() => {
              if (selectedCharacterId) onCharacterDelete(selectedCharacterId);
            }}
            disabled={!selectedCharacterId || disabled}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      {/* ---- Costume Set Selector ---- */}
      {selectedCharacterId && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-gray-500 uppercase tracking-wider">服装集</Label>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-cyan-400"
              onClick={onCostumeAdd}
              title="添加服装集"
              disabled={disabled}
            >
              <Plus className="size-3" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <select
              value={selectedCostumeId ?? ''}
              onChange={(e) => onCostumeSelect(e.target.value || null)}
              className="flex-1 h-7 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded px-2 text-gray-300"
              disabled={disabled}
            >
              <option value="">— 选择服装 —</option>
              {costumeSets.map((cs) => (
                <option key={cs.id} value={cs.id}>
                  {cs.name}
                  {activeCostumeSetId === cs.id ? ' ★' : ''}
                </option>
              ))}
            </select>
            {/* Active costume set toggle */}
            {onActiveCostumeSetChange && selectedCostumeId && (
              <Button
                variant="ghost"
                size="icon"
                className={`size-6 ${
                  activeCostumeSetId === selectedCostumeId
                    ? 'text-yellow-400'
                    : 'text-gray-600 hover:text-yellow-400'
                }`}
                onClick={() => handleSetActive(selectedCostumeId)}
                title={
                  activeCostumeSetId === selectedCostumeId
                    ? '取消激活服装集'
                    : '设为激活服装集'
                }
                disabled={disabled}
              >
                {activeCostumeSetId === selectedCostumeId ? (
                  <Star className="size-3" />
                ) : (
                  <StarOff className="size-3" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-red-400 hover:text-red-300"
              onClick={() => {
                if (selectedCostumeId) onCostumeDelete(selectedCostumeId);
              }}
              disabled={!selectedCostumeId || disabled}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
          {/* Active costume set indicator */}
          {activeCostumeSetId && (
            <div className="flex items-center gap-1 text-[8px] text-yellow-400/70">
              <Star className="size-2" />
              <span>
                激活:{' '}
                {costumeSets.find((cs) => cs.id === activeCostumeSetId)?.name ?? activeCostumeSetId}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ---- Sprite Mapping Grid ---- */}
      {selectedCostume && (
        <div className="space-y-1.5">
          <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
            精灵映射 (节点 × 方向)
          </Label>
          {nodes.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-[9px] text-gray-600">角色骨骼无节点</p>
            </div>
          ) : (
            <div className="bg-[#080818] rounded border border-[#1e1e3a] p-1 overflow-x-auto max-h-64">
              <table className="text-[9px] w-full">
                <thead>
                  <tr>
                    <th className="text-gray-600 text-left px-1 py-0.5 sticky left-0 bg-[#080818] z-10">
                      节点
                    </th>
                    {ALL_DIRECTIONS.map((dir) => (
                      <th
                        key={dir}
                        className="text-gray-600 px-1 py-0.5 text-center min-w-[52px]"
                        title={DIRECTION_NAMES[dir]}
                      >
                        {DIR_ABBREVIATIONS[dir]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((node) => (
                    <tr key={node.id}>
                      {/* Node name cell (sticky) */}
                      <td className="text-gray-400 px-1 py-0.5 sticky left-0 bg-[#080818] whitespace-nowrap z-10">
                        <div className="flex items-center gap-1">
                          <div
                            className="size-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: node.color || '#888' }}
                          />
                          <span className="truncate max-w-[60px]" title={node.name}>
                            {node.name}
                          </span>
                        </div>
                      </td>
                      {/* Direction cells */}
                      {ALL_DIRECTIONS.map((dir) => {
                        const slotKey = `${node.id}:${dir}`;
                        const assignedPartId = selectedCostume.spriteMap[slotKey];
                        const assignedPart = assignedPartId
                          ? parts.find((p) => p.id === assignedPartId)
                          : undefined;
                        const mirrorSource = getMirrorSource(
                          selectedCostume,
                          node.id,
                          dir
                        );

                        return (
                          <SpriteCell
                            key={dir}
                            nodeId={node.id}
                            direction={dir}
                            assignedPartId={assignedPartId}
                            assignedPart={assignedPart}
                            mirrorSource={mirrorSource}
                            parts={parts}
                            onAssign={onSpriteAssign}
                            onRemove={onSpriteRemove}
                            disabled={disabled}
                          />
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Mirror map legend */}
          {selectedCostume.pieces && Object.keys(selectedCostume.pieces).length > 0 && (
            <div className="space-y-0.5 mt-1">
              <div className="text-[8px] text-gray-600 uppercase tracking-wider">镜像映射</div>
              <div className="bg-[#080818] rounded border border-[#1e1e3a] p-1.5 space-y-0.5">
                {Object.entries(selectedCostume.pieces).map(([slotKey, piece]) => {
                  const mirrorEntries = Object.entries(piece.mirrorMap);
                  if (mirrorEntries.length === 0) return null;
                  const nodeInfo = nodes.find((n) => n.id === slotKey);
                  return (
                    <div key={slotKey} className="flex items-center gap-1 text-[8px]">
                      <div
                        className="size-1.5 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: nodeInfo?.color || piece.fillColor || '#888',
                        }}
                      />
                      <span className="text-gray-500 truncate max-w-[50px]">
                        {nodeInfo?.name ?? slotKey}
                      </span>
                      <ArrowLeftRight className="text-cyan-400/60 size-[7px] flex-shrink-0" />
                      <span className="text-cyan-400/60">
                        {mirrorEntries
                          .map(
                            ([from, to]) =>
                              `${DIR_ABBREVIATIONS[Number(from) as DirectionIndex]}→${DIR_ABBREVIATIONS[to as DirectionIndex]}`
                          )
                          .join(', ')}
                      </span>
                    </div>
                  );
                })}
                {Object.values(selectedCostume.pieces).every(
                  (p) => Object.keys(p.mirrorMap).length === 0
                ) && (
                  <div className="text-[8px] text-gray-600 text-center py-1">
                    无镜像映射
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CostumeManager;
