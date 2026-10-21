'use client';

import React, { useCallback, useState } from 'react';
import {
  Plus,
  Trash2,
  Bone,
  Target,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import { subToPx, pxToSub } from '@/lib/unified-types';
import type {
  Character,
  Node,
} from '@/lib/unified-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NodeTreeItemWrapper } from './NodeTree';
import PuppetModifierPanel from './PuppetModifierPanel';
import GlobalBlueprintEditor from './GlobalBlueprintEditor';
import CharacterBlueprintEditor from './CharacterBlueprintEditor';
import StateBlueprintEditor from './StateBlueprintEditor';
import IKBakeButton from './IKBakeButton';
import IKChainEditor from './IKChainEditor';
import ThreeBakeDialog from './ThreeBakeDialog';

interface RigPanelProps {
  unifiedCharacters: Record<string, Character>;
  selectedNodeId: string | null;
  selectedNode: Node | null;
  handleSelectNodeWithSync: (nodeId: string | null) => void;
  /** 隐藏节点树（用左侧共享树），只显示细节 */
}

/**
 * RigPanel — 骨架搭建阶段。
 * 只做：选骨骼、节点树、增删节点、关节（socket/plug）、rest pose、z-order。
 * 不做：方向盘、纬度（那是 perform 的事）、精灵分配（那是 dress 的事）。
 */
export default function RigPanel({
  unifiedCharacters,
  selectedNodeId,
  selectedNode,
  handleSelectNodeWithSync,
}: RigPanelProps) {
  // 骨架用左侧选中的，不再用 prop 传进来的
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const selectedSkeletonId = activePuppetSkeletonId;
  const selectedCharacter = selectedSkeletonId ? (unifiedCharacters[selectedSkeletonId] ?? null) : null;

  const [threeBakeOpen, setThreeBakeOpen] = useState(false);

  // ---- Handlers ----
  // (增删节点已移到左侧面板树，此处只保留细节编辑)

  const handleUpdateNode = useCallback(
    (nodeId: string, updates: Partial<Node>) => {
      if (!activePuppetSkeletonId) return;
      const store = useProjectStore.getState();
      store.pushUndo('更新节点', 'updateNode');
      store.updateUnifiedNode(activePuppetSkeletonId, nodeId, updates);
    },
    [activePuppetSkeletonId]
  );

  const handleToggleNodeVisibility = useCallback(
    (nodeId: string) => {
      if (!selectedSkeletonId) return;
      const node = selectedCharacter?.nodes[nodeId];
      if (!node) return;
      handleUpdateNode(nodeId, { visible: !node.visible });
    },
    [selectedSkeletonId, selectedCharacter, handleUpdateNode]
  );

  const handleTransposeClone = useCallback((thetaDeg: number) => {
    if (!selectedSkeletonId || !selectedNodeId || !selectedNode) return;
    if (selectedNodeId === selectedCharacter?.rootNodeId) return;
    const store = useProjectStore.getState();
    const newRootId = store.cloneNodeSubtreeTransposed(selectedSkeletonId, selectedNodeId, thetaDeg);
    if (newRootId) store.setSelectedNodeId(newRootId);
  }, [selectedSkeletonId, selectedNodeId, selectedNode, selectedCharacter]);

  const handleDeleteNode = useCallback(() => {
    if (!selectedSkeletonId || !selectedNodeId || !selectedNode || !selectedCharacter) return;
    // 根节点不能删
    if (selectedNodeId === selectedCharacter.rootNodeId) return;
    const childCount = Object.values(selectedCharacter.nodes).filter(n => n.parentId === selectedNodeId).length;
    if (childCount > 0 && !confirm(`删除节点「${selectedNode.name}」会连带删除 ${childCount} 个子节点，继续？`)) return;
    const store = useProjectStore.getState();
    store.pushUndo('删除节点');
    // 递归收集所有后代
    const idsToRemove = new Set<string>([selectedNodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of Object.values(selectedCharacter.nodes)) {
        if (idsToRemove.has(n.id)) continue;
        if (n.parentId && idsToRemove.has(n.parentId)) {
          idsToRemove.add(n.id);
          changed = true;
        }
      }
    }
    // 从父节点的 children 列表移除
    const parentId = selectedNode.parentId;
    if (parentId) {
      const parent = selectedCharacter.nodes[parentId];
      if (parent) {
        store.updateUnifiedNode(selectedSkeletonId, parentId, {
          children: parent.children.filter(id => id !== selectedNodeId),
        });
      }
    }
    // 删除所有收集到的节点
    for (const id of idsToRemove) {
      store.removeUnifiedNode(selectedSkeletonId, id);
    }
    store.setSelectedNodeId(null);
  }, [selectedSkeletonId, selectedNodeId, selectedNode, selectedCharacter]);

  const handleAddSocket = useCallback(() => {
    if (!selectedSkeletonId || !selectedNodeId || !selectedNode) return;
    const newSocket = {
      id: crypto.randomUUID(),
      name: `socket_${(selectedNode.sockets?.length ?? 0) + 1}`,
      basePosition: { x: pxToSub(0), y: pxToSub(-8) },
      directionOffsets: {},
    };
    handleUpdateNode(selectedNodeId, {
      sockets: [...(selectedNode.sockets ?? []), newSocket],
    });
  }, [selectedSkeletonId, selectedNodeId, selectedNode, handleUpdateNode]);

  const handleRemoveSocket = useCallback(
    (socketId: string) => {
      if (!selectedSkeletonId || !selectedNodeId || !selectedNode) return;
      const store = useProjectStore.getState();
      const character = store.unifiedCharacters[selectedSkeletonId];
      if (!character) return;
      const socket = (selectedNode.sockets ?? []).find((s) => s.id === socketId);
      const attached = Object.values(character.nodes).filter((n) => n.attachment.parentSocketId === socketId);
      if (attached.length > 0 && !confirm(`删除插槽「${socket?.name ?? socketId}」会 detach ${attached.length} 个子节点（${attached.map((n) => n.name).join('、')}），继续？`)) return;
      store.pushUndo('删除插槽');
      // Remove socket from selected node
      store.updateUnifiedNode(selectedSkeletonId, selectedNodeId, {
        sockets: (selectedNode.sockets ?? []).filter((so) => so.id !== socketId),
      });
      // Detach children: reset their attachment to fixed
      for (const n of attached) {
        store.updateUnifiedNode(selectedSkeletonId, n.id, {
          attachment: { type: 'fixed', fixedOffset: { x: 0, y: 0 }, inheritRotation: true },
        });
      }
    },
    [selectedSkeletonId, selectedNodeId, selectedNode]
  );

  return (
    <div className="space-y-3">
      {/* 骨骼：用左侧选中的，不再重复选择 */}

      {/* 3D 烘焙 MVP 测试入口 */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-[10px] h-6 border-purple-600/50 text-purple-400 hover:bg-purple-500/10"
          onClick={() => setThreeBakeOpen(true)}
        >
          <Bone className="size-3 mr-1" /> 3D 烘焙测试 (MVP)
        </Button>
      </div>
      <ThreeBakeDialog open={threeBakeOpen} onClose={() => setThreeBakeOpen(false)} />

      {/* Canvas interaction: Switch to puppet tool */}
      {selectedSkeletonId && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-[10px] h-6 border-cyan-600/50 text-cyan-400 hover:bg-cyan-500/10"
            onClick={() => {
              useEditorStore.getState().setTool('puppet');
              useEditorStore.getState().setActivePuppetSkeletonId(selectedSkeletonId);
              if (!useEditorStore.getState().showPuppetSkeleton) {
                useEditorStore.getState().togglePuppetSkeleton();
              }
            }}
          >
            <Target className="size-3 mr-1" /> 画布选择木偶节点 (P)
          </Button>
        </div>
      )}


      {/* Node properties: rest pose + joints */}
      {selectedNode && selectedCharacter && (
        <RigNodeProperties
          node={selectedNode}
          characterId={selectedSkeletonId}
          onUpdate={(updates) => handleUpdateNode(selectedNode.id, updates)}
          onAddSocket={handleAddSocket}
          onRemoveSocket={handleRemoveSocket}
          onDeleteNode={handleDeleteNode}
          onTransposeClone={handleTransposeClone}
          isRoot={selectedNode.id === selectedCharacter?.rootNodeId}
        />
      )}

      {/* ---- 全局蓝图 ---- */}
      <div className="pt-2 border-t border-[#1e1e3a]">
        <GlobalBlueprintEditor character={selectedCharacter} />
      </div>

      {/* ---- 角色蓝图（整角色后处理） ---- */}
      <div className="pt-2 border-t border-[#1e1e3a]">
        <div className="text-[10px] text-gray-500 mb-1">角色蓝图</div>
        <CharacterBlueprintEditor character={selectedCharacter} />
      </div>

      {/* ---- 状态蓝图（服装/变体程序化驱动） ---- */}
      <div className="pt-2 border-t border-[#1e1e3a]">
        <div className="text-[10px] text-gray-500 mb-1">状态蓝图（服装/变体驱动）</div>
        <StateBlueprintEditor character={selectedCharacter} />
      </div>

      {/* ---- IK 链 ---- */}
      <div className="pt-2 border-t border-[#1e1e3a]">
        <div className="text-[10px] text-gray-500 mb-1">IK 链</div>
        <IKChainEditor character={selectedCharacter} />
      </div>

      {/* ---- IK 烘焙 ---- */}
      <div className="pt-2 border-t border-[#1e1e3a]">
        <div className="text-[10px] text-gray-500 mb-1">IK 烘焙</div>
        <IKBakeButton character={selectedCharacter} />
      </div>
    </div>
  );
}

// ---- 节点属性：rest pose + 关节 ----
function RigNodeProperties({
  node,
  characterId,
  onUpdate,
  onAddSocket,
  onRemoveSocket,
  onDeleteNode,
  onTransposeClone,
  isRoot,
}: {
  node: Node;
  characterId: string | null;
  onUpdate: (updates: Partial<Node>) => void;
  onAddSocket: () => void;
  onRemoveSocket: (socketId: string) => void;
  onDeleteNode: () => void;
  onTransposeClone: (thetaDeg: number) => void;
  isRoot: boolean;
}) {
  const [transposeAngle, setTransposeAngle] = useState(45);
  return (
    <div className="space-y-3 bg-[#080818] rounded border border-[#1e1e3a] p-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">节点属性</Label>
        {!isRoot && (
          <Button
            variant="ghost"
            size="icon"
            className="size-5 text-red-400 hover:text-red-300"
            onClick={onDeleteNode}
            title="删除节点"
          >
            <Trash2 className="size-3" />
          </Button>
        )}
      </div>

      {/* 名称 */}
      <div>
        <Label className="text-[10px] text-gray-500">名称</Label>
        <Input
          value={node.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="h-7 text-[11px] bg-[#111128] border-[#1e1e3a] mt-1"
        />
      </div>

      {/* 转位克隆：克隆整个子树并转平面角度（根节点除外） */}
      {!isRoot && (
        <div className="flex items-end gap-1.5">
          <div className="flex-1">
            <Label className="text-[10px] text-gray-500">转位克隆（转平面角度°）</Label>
            <Input
              type="number"
              value={transposeAngle}
              onChange={(e) => setTransposeAngle(Number(e.target.value) || 0)}
              className="h-7 text-[11px] bg-[#111128] border-[#1e1e3a] mt-1"
              title="克隆此节点子树，克隆根挂 rotate 变换修改器转此角度（渲染期叠加，事后可调可关）"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => onTransposeClone(transposeAngle)}
          >
            克隆
          </Button>
        </div>
      )}

      {/* Rest pose */}
      <div>
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">静止姿态</Label>
        <div className="grid grid-cols-2 gap-1.5 mt-1">
          <div>
            <Label className="text-[9px] text-gray-600">角度°</Label>
            <Input
              type="number"
              value={node.transform.angle}
              onChange={(e) => onUpdate({ transform: { ...node.transform, angle: Number(e.target.value) || 0 } })}
              className="h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
            />
          </div>
          <div>
            <Label className="text-[9px] text-gray-600">拉伸</Label>
            <Input
              type="number"
              step="0.1"
              value={node.transform.stretch}
              onChange={(e) => onUpdate({ transform: { ...node.transform, stretch: Number(e.target.value) || 1 } })}
              className="h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
            />
          </div>
          <div>
            <Label className="text-[9px] text-gray-600">偏移 X</Label>
            <Input
              type="number"
              value={subToPx(node.transform.x)}
              onChange={(e) => onUpdate({ transform: { ...node.transform, x: pxToSub(Number(e.target.value) || 0) } })}
              className="h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
            />
          </div>
          <div>
            <Label className="text-[9px] text-gray-600">偏移 Y</Label>
            <Input
              type="number"
              value={subToPx(node.transform.y)}
              onChange={(e) => onUpdate({ transform: { ...node.transform, y: pxToSub(Number(e.target.value) || 0) } })}
              className="h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
            />
          </div>
        </div>
      </div>

      {/* 关节 */}
      <div>
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">关节</Label>
        <div className="grid grid-cols-2 gap-1.5 mt-1">
          {/* TODO(migration): crossSectionTop/Bottom moved to CostumePiece.crossSections in new model */}
        </div>
        {node.attachment?.type === 'socket' && node.attachment.parentSocketId && (
          <>
            <div className="flex items-center gap-2 mt-1.5">
              <Label className="text-[9px] text-gray-600">关节盘</Label>
              <input
                type="checkbox"
                checked={node.attachment.autoJointDisc !== false}
                onChange={(e) =>
                  onUpdate({
                    attachment: { ...node.attachment, autoJointDisc: e.target.checked },
                  })
                }
              />
              <span className="text-[9px] text-gray-500">自动生成（遮盖接缝）</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <Label className="text-[9px] text-gray-600">蒙皮</Label>
              <input
                type="checkbox"
                checked={node.attachment.allowSkinning === true}
                onChange={(e) =>
                  onUpdate({
                    attachment: { ...node.attachment, allowSkinning: e.target.checked },
                  })
                }
              />
              <span className="text-[9px] text-gray-500">允许蒙皮（动画面板可拍快照）</span>
            </div>
          </>
        )}
        <div className={`flex items-center gap-2 mt-1.5 ${node.attachment?.autoJointDisc === false ? 'opacity-40 pointer-events-none' : ''}`}>
          <Label className="text-[9px] text-gray-600">关节盘颜色</Label>
          <input
            type="color"
            value={node.slot?.fillColor || '#888888'}
            onChange={(e) => onUpdate({ slot: node.slot ? { ...node.slot, fillColor: e.target.value } : undefined })}
            className="size-6 rounded border border-[#1e1e3a] bg-transparent cursor-pointer"
          />
        </div>
      </div>

      {/* Z-order */}
      <div>
        <Label className="text-[10px] text-gray-500">层叠顺序 (zIndex)</Label>
        <Input
          type="number"
          value={node.zIndex}
          onChange={(e) => onUpdate({ zIndex: Number(e.target.value) || 0 })}
          className="h-6 text-[10px] bg-[#111128] border-[#1e1e3a] mt-1"
        />
      </div>

      {/* 方向排序标记 */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-gray-500">左右 (side)</Label>
          <select
            value={node.side ?? 'C'}
            onChange={(e) => onUpdate({ side: e.target.value as 'L' | 'R' | 'C' })}
            className="h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded mt-1 w-full"
          >
            <option value="C">中间</option>
            <option value="L">左</option>
            <option value="R">右</option>
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">躯干/四肢</Label>
          <select
            value={node.isCore ? 'core' : 'limb'}
            onChange={(e) => onUpdate({ isCore: e.target.value === 'core' })}
            className="h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded mt-1 w-full"
          >
            <option value="limb">四肢</option>
            <option value="core">躯干</option>
          </select>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full h-6 text-[10px] mt-2"
        onClick={() => {
          if (!characterId) return;
          const { tagged } = useProjectStore.getState().autoTagNodeDirections(characterId);
          alert(`已标记 ${tagged} 个节点`);
        }}
      >
        按命名自动标记全骨架
      </Button>

      {/* Sockets */}
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
            插槽 ({node.sockets?.length ?? 0})
          </Label>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 text-cyan-400 hover:text-cyan-300"
            onClick={onAddSocket}
            title="添加插槽"
          >
            <Plus className="size-3" />
          </Button>
        </div>
        <div className="space-y-1 mt-1">
          {(node.sockets ?? []).map((socket) => {
            const updateSocket = (patch: Partial<typeof socket>) => {
              const sockets = (node.sockets ?? []).map((s) =>
                s.id === socket.id ? { ...s, ...patch } : s
              );
              onUpdate({ sockets });
            };
            const skinning = socket.skinning ?? 'disc';
            return (
              <div key={socket.id} className="space-y-1 rounded border border-transparent">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <Input
                    value={socket.name}
                    onChange={(e) => updateSocket({ name: e.target.value })}
                    className="flex-1 h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
                  />
                  <Input
                    type="number"
                    value={subToPx(socket.basePosition.x)}
                    onChange={(e) => {
                      updateSocket({ basePosition: { ...socket.basePosition, x: pxToSub(Number(e.target.value) || 0) } });
                    }}
                    className="w-14 h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
                    title="X"
                  />
                  <Input
                    type="number"
                    value={subToPx(socket.basePosition.y)}
                    onChange={(e) => {
                      updateSocket({ basePosition: { ...socket.basePosition, y: pxToSub(Number(e.target.value) || 0) } });
                    }}
                    className="w-14 h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
                    title="Y"
                  />
                  <Select
                    value={skinning}
                    onValueChange={(v) => updateSocket({ skinning: v as 'disc' | 'mesh' })}
                  >
                    <SelectTrigger
                      className="w-[72px] h-6 text-[10px] bg-[#111128] border-[#1e1e3a] text-gray-300"
                      title="关节蒙皮模式：disc=关节盘遮盖，mesh=网格蒙皮变形"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
                      <SelectItem value="disc">关节盘</SelectItem>
                      <SelectItem value="mesh">网格蒙皮</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 text-red-400 hover:text-red-300"
                    onClick={() => onRemoveSocket(socket.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
                {skinning === 'mesh' && (
                  <div className="flex items-center gap-1.5 text-[10px] pl-1">
                    <Label className="text-[10px] text-gray-500 shrink-0">蒙皮半径</Label>
                    <Input
                      type="number"
                      value={socket.skinRadius ?? 8}
                      onChange={(e) => updateSocket({ skinRadius: Math.max(1, Number(e.target.value) || 8) })}
                      className="w-14 h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
                      title="影响半径（像素）"
                    />
                    <Label className="text-[10px] text-gray-500 shrink-0">曲线</Label>
                    <Select
                      value={socket.skinCurve ?? 'smoothstep'}
                      onValueChange={(v) => updateSocket({ skinCurve: v as 'linear' | 'smoothstep' })}
                    >
                      <SelectTrigger className="w-[92px] h-6 text-[10px] bg-[#111128] border-[#1e1e3a] text-gray-300">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
                        <SelectItem value="smoothstep">smoothstep</SelectItem>
                        <SelectItem value="linear">linear</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- 程序化修改器 / 蓝图 ---- */}
      <div className="pt-2 border-t border-[#1e1e3a] space-y-2">
        <PuppetModifierPanel />
      </div>
    </div>
  );
}
