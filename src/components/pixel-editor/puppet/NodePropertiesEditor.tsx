'use client';

import React, { useCallback } from 'react';
import {
  Trash2,
  Palette,
  Pencil,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import { resolvePuppetNodeSprite } from '@/lib/engine/puppet-render';
import type {
  PuppetSkeleton,
  PuppetNode,
  PuppetCharacter,
  PuppetSocket,
  PuppetDirection,
} from '@/lib/types';
import type { Part } from '@/lib/types';
import { SocketEditor } from '../SocketEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import NodeModifierSection from './NodeModifierSection';
import PlugConnectionEditor from './PlugConnectionEditor';
import { updateSkeletonNode } from './updateSkeletonNode';
import { NODE_COLOR_PRESETS } from './types';
import { oldDirectionToIndex } from '../DirectionWheel';

interface NodePropertiesEditorProps {
  selectedSkeletonId: string | null;
  selectedNodeId: string | null;
  selectedNode: PuppetNode;
  selectedSkeleton: PuppetSkeleton;
  puppetSkeletons: PuppetSkeleton[];
  puppetCharacters: PuppetCharacter[];
  parts: Part[];
  direction: PuppetDirection;
  handleUpdateNode: (nodeId: string, updates: Partial<PuppetNode>) => void;
  handleDeleteNode: () => void;
  handleAddSocket: () => void;
  handleRemoveSocket: (socketId: string) => void;
}

export default function NodePropertiesEditor({
  selectedSkeletonId,
  selectedNodeId,
  selectedNode,
  selectedSkeleton,
  puppetSkeletons,
  puppetCharacters,
  parts,
  direction,
  handleUpdateNode,
  handleDeleteNode,
  handleAddSocket,
  handleRemoveSocket,
}: NodePropertiesEditorProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
          节点属性
        </Label>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-red-400 hover:text-red-300"
          onClick={handleDeleteNode}
          title="删除节点"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      <div className="bg-[#080818] rounded border border-[#1e1e3a] p-2 space-y-2">
        {/* Name */}
        <div className="flex items-center gap-2">
          <Label className="text-[9px] text-gray-600 w-14">名称</Label>
          <Input
            value={selectedNode.name}
            onChange={(e) => handleUpdateNode(selectedNode.id, { name: e.target.value })}
            className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
          />
        </div>

        {/* Sprite */}
        <div className="flex items-center gap-2">
          <Label className="text-[9px] text-gray-600 w-14">精灵</Label>
          <select
            value={selectedNode.spritePartId ?? ''}
            onChange={(e) =>
              handleUpdateNode(selectedNode.id, {
                spritePartId: e.target.value || null,
              })
            }
            className="flex-1 h-6 text-[9px] bg-[#0d0d1a] border border-[#1e1e3a] rounded px-1 text-gray-300"
          >
            <option value="">— 无 —</option>
            {parts.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {/* Edit Sprite Button */}
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-cyan-400 hover:text-cyan-300 flex-shrink-0"
            disabled={!selectedNode.spritePartId}
            title={selectedNode.spritePartId ? '编辑此节点的精灵像素' : '未分配精灵'}
            onClick={() => {
              if (!selectedNode.spritePartId) return;
              const char = puppetCharacters.find((c) =>
                c.puppetSkeletonId === selectedSkeletonId
              );
              const activeCostume = char?.activeCostumeSetId
                ? char.costumeSets.find((cs) => cs.id === char.activeCostumeSetId) ?? null
                : null;
              const skeleton = puppetSkeletons.find((s) => s.id === selectedSkeletonId);
              const dir = skeleton?.currentDirection ?? 'S';
              const resolvedPart = resolvePuppetNodeSprite(
                selectedNode,
                dir,
                activeCostume,
                parts,
              );
              if (resolvedPart) {
                const { useWorkspaceStore } = require('@/lib/workspace-store');
                useWorkspaceStore.getState().setMode('animation');
                useEditorStore.getState().selectPart(resolvedPart.id);
                useEditorStore.getState().enterPartEditMode(resolvedPart.id);
              }
            }}
          >
            <Pencil className="size-3" />
          </Button>
        </div>

        {/* Angle */}
        <div className="flex items-center gap-2">
          <Label className="text-[9px] text-gray-600 w-14">角度</Label>
          <Input
            type="number"
            value={selectedNode.angle}
            onChange={(e) =>
              handleUpdateNode(selectedNode.id, { angle: Number(e.target.value) })
            }
            className="h-6 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] w-16"
          />
          <input
            type="range"
            min={-180}
            max={180}
            value={selectedNode.angle}
            onChange={(e) =>
              handleUpdateNode(selectedNode.id, { angle: Number(e.target.value) })
            }
            className="flex-1 h-1 accent-cyan-500"
          />
        </div>

        {/* Stretch */}
        <div className="flex items-center gap-2">
          <Label className="text-[9px] text-gray-600 w-14">拉伸</Label>
          <Input
            type="number"
            step={0.1}
            min={0.1}
            max={5}
            value={selectedNode.stretch}
            onChange={(e) =>
              handleUpdateNode(selectedNode.id, { stretch: Number(e.target.value) })
            }
            className="h-6 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] w-16"
          />
        </div>

        {/* Offsets */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-1">
            <Label className="text-[9px] text-gray-600">X偏移</Label>
            <Input
              type="number"
              value={selectedNode.offsetX}
              onChange={(e) =>
                handleUpdateNode(selectedNode.id, { offsetX: Number(e.target.value) })
              }
              className="h-6 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
            />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[9px] text-gray-600">Y偏移</Label>
            <Input
              type="number"
              value={selectedNode.offsetY}
              onChange={(e) =>
                handleUpdateNode(selectedNode.id, { offsetY: Number(e.target.value) })
              }
              className="h-6 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
            />
          </div>
        </div>

        {/* Z-Index */}
        <div className="flex items-center gap-2">
          <Label className="text-[9px] text-gray-600 w-14">Z顺序</Label>
          <Input
            type="number"
            value={selectedNode.zIndex}
            onChange={(e) =>
              handleUpdateNode(selectedNode.id, { zIndex: Number(e.target.value) })
            }
            className="h-6 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] w-16"
          />
        </div>

        {/* Cross sections */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-1">
            <Label className="text-[9px] text-gray-600">截面上</Label>
            <Input
              type="number"
              min={0}
              value={selectedNode.crossSectionTop}
              onChange={(e) =>
                handleUpdateNode(selectedNode.id, {
                  crossSectionTop: Number(e.target.value),
                })
              }
              className="h-6 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
            />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[9px] text-gray-600">截面下</Label>
            <Input
              type="number"
              min={0}
              value={selectedNode.crossSectionBottom}
              onChange={(e) =>
                handleUpdateNode(selectedNode.id, {
                  crossSectionBottom: Number(e.target.value),
                })
              }
              className="h-6 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
            />
          </div>
        </div>

        {/* Mirror toggle */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selectedNode.mirrorFrom}
            onChange={(e) =>
              handleUpdateNode(selectedNode.id, { mirrorFrom: e.target.checked })
            }
            className="accent-cyan-500"
          />
          <Label className="text-[9px] text-gray-500">镜像方向精灵</Label>
        </div>

        {/* Node Color */}
        <div className="flex items-center gap-2">
          <Palette className="size-2.5 text-gray-600" />
          <Label className="text-[9px] text-gray-600">颜色</Label>
          <div className="flex items-center gap-0.5 flex-wrap flex-1">
            {NODE_COLOR_PRESETS.map((c) => (
              <button
                key={c}
                className={`size-3.5 rounded-full border transition-transform ${
                  selectedNode.color === c
                    ? 'border-white scale-125'
                    : 'border-transparent hover:scale-110'
                }`}
                style={{ backgroundColor: c }}
                onClick={() => handleUpdateNode(selectedNode.id, { color: c })}
                title={c}
              />
            ))}
          </div>
        </div>

        <Separator className="bg-[#1e1e3a]" />

        {/* Sockets */}
        <SocketEditor
          sockets={selectedNode.sockets.map(s => ({
            id: s.id,
            name: s.name,
            x: s.localX ?? 0,
            y: s.localY ?? 0,
          }))}
          onSocketChange={(socketId, updates) => {
            const store = useProjectStore.getState();
            useProjectStore.setState({
              puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
                s.id === selectedSkeletonId
                  ? updateSkeletonNode(s, selectedNodeId!, (n) => ({
                      sockets: n.sockets.map((sk) =>
                        sk.id === socketId
                          ? {
                              ...sk,
                              ...(updates.name !== undefined ? { name: updates.name } : {}),
                              ...(updates.x !== undefined ? { localX: updates.x } : {}),
                              ...(updates.y !== undefined ? { localY: updates.y } : {}),
                            }
                          : sk
                      ),
                    }))
                  : s
              ),
            });
          }}
          onSocketAdd={handleAddSocket}
          onSocketRemove={handleRemoveSocket}
          selectedDirection={oldDirectionToIndex(direction)}
        />

        {/* Plug connection */}
        <Separator className="bg-[#1e1e3a]" />
        <PlugConnectionEditor
          selectedSkeletonId={selectedSkeletonId}
          selectedNodeId={selectedNodeId}
          selectedNode={selectedNode}
          selectedSkeleton={selectedSkeleton}
        />

        {/* Modifiers for Puppet Limb */}
        {(() => {
          const char = puppetCharacters.find((c) =>
            c.puppetSkeletonId === selectedSkeletonId
          );
          const activeCostume = char?.activeCostumeSetId
            ? char.costumeSets.find((cs) => cs.id === char.activeCostumeSetId) ?? null
            : null;
          const skeleton = puppetSkeletons.find((s) => s.id === selectedSkeletonId);
          const dir = skeleton?.currentDirection ?? 'S';
          const spritePart = selectedNode
            ? resolvePuppetNodeSprite(selectedNode, dir, activeCostume, parts)
            : null;

          if (!spritePart) return null;

          const editMods = spritePart.editModifiers ?? [];
          const animMods = spritePart.animationModifiers ?? [];
          const globalMods = spritePart.globalModifiers ?? [];
          const allModsCount = editMods.length + animMods.length + globalMods.length;

          return (
            <NodeModifierSection
              part={spritePart}
              editMods={editMods}
              animMods={animMods}
              globalMods={globalMods}
              allModsCount={allModsCount}
            />
          );
        })()}
      </div>
    </div>
  );
}
