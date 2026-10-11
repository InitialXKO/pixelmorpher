'use client';

import React, { useCallback } from 'react';
import {
  Plus,
  Trash2,
  Bone,
  Target,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type {
  PuppetSkeleton,
  PuppetNode,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NodeTreeItemWrapper } from './NodeTree';
import { updateSkeletonNode } from './updateSkeletonNode';

interface RigPanelProps {
  puppetSkeletons: PuppetSkeleton[];
  selectedNodeId: string | null;
  selectedNode: PuppetNode | null;
  handleSelectNodeWithSync: (nodeId: string | null) => void;
  /** 隐藏节点树（用左侧共享树），只显示细节 */
}

/**
 * RigPanel — 骨架搭建阶段。
 * 只做：选骨骼、节点树、增删节点、关节（socket/plug）、rest pose、z-order。
 * 不做：方向盘、纬度（那是 perform 的事）、精灵分配（那是 dress 的事）。
 */
export default function RigPanel({
  puppetSkeletons,
  selectedNodeId,
  selectedNode,
  handleSelectNodeWithSync,
}: RigPanelProps) {
  // 骨架用左侧选中的，不再用 prop 传进来的
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const selectedSkeletonId = activePuppetSkeletonId;
  const selectedSkeleton = puppetSkeletons.find((s) => s.id === selectedSkeletonId) ?? null;

  // ---- Handlers ----
  // (增删节点已移到左侧面板树，此处只保留细节编辑)

  const handleUpdateNode = useCallback(
    (nodeId: string, updates: Partial<PuppetNode>) => {
      if (!activePuppetSkeletonId) return;
      const store = useProjectStore.getState();
      store.pushUndo('更新节点', 'updateNode');
      useProjectStore.setState({
        puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
          s.id === selectedSkeletonId
            ? updateSkeletonNode(s, nodeId, updates)
            : s
        ),
      });
    },
    [selectedSkeletonId]
  );

  const handleToggleNodeVisibility = useCallback(
    (nodeId: string) => {
      if (!selectedSkeletonId) return;
      const node = selectedSkeleton?.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      handleUpdateNode(nodeId, { visible: !node.visible });
    },
    [selectedSkeletonId, selectedSkeleton, handleUpdateNode]
  );

  const handleAddSocket = useCallback(() => {
    if (!selectedSkeletonId || !selectedNodeId || !selectedNode) return;
    const newSocket = {
      id: crypto.randomUUID(),
      name: `socket_${(selectedNode.sockets?.length ?? 0) + 1}`,
      localX: 0,
      localY: -8,
    };
    handleUpdateNode(selectedNodeId, {
      sockets: [...(selectedNode.sockets ?? []), newSocket],
    });
  }, [selectedSkeletonId, selectedNodeId, selectedNode, handleUpdateNode]);

  const handleRemoveSocket = useCallback(
    (socketId: string) => {
      if (!selectedSkeletonId || !selectedNodeId || !selectedNode) return;
      const store = useProjectStore.getState();
      const skeleton = (store.puppetSkeletons ?? []).find((s) => s.id === selectedSkeletonId);
      const socket = (selectedNode.sockets ?? []).find((s) => s.id === socketId);
      const attached = (skeleton?.nodes ?? []).filter((n) => n.plug?.socketId === socketId);
      if (attached.length > 0 && !confirm(`删除插槽「${socket?.name ?? socketId}」会 detach ${attached.length} 个子节点（${attached.map((n) => n.name).join('、')}），继续？`)) return;
      store.pushUndo('删除插槽');
      useProjectStore.setState({
        puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
          s.id === selectedSkeletonId
            ? {
                ...s,
                nodes: s.nodes.map((n) => {
                  if (n.id === selectedNodeId) {
                    return { ...n, sockets: (n.sockets ?? []).filter((so) => so.id !== socketId) };
                  }
                  if (n.plug?.socketId === socketId) {
                    return { ...n, plug: null };
                  }
                  return n;
                }),
              }
            : s
        ),
      });
    },
    [selectedSkeletonId, selectedNodeId, selectedNode]
  );

  return (
    <div className="space-y-3">
      {/* 骨骼：用左侧选中的，不再重复选择 */}

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
      {selectedNode && selectedSkeleton && (
        <RigNodeProperties
          node={selectedNode}
          onUpdate={(updates) => handleUpdateNode(selectedNode.id, updates)}
          onAddSocket={handleAddSocket}
          onRemoveSocket={handleRemoveSocket}
        />
      )}
    </div>
  );
}

// ---- 节点属性：rest pose + 关节 ----
function RigNodeProperties({
  node,
  onUpdate,
  onAddSocket,
  onRemoveSocket,
}: {
  node: PuppetNode;
  onUpdate: (updates: Partial<PuppetNode>) => void;
  onAddSocket: () => void;
  onRemoveSocket: (socketId: string) => void;
}) {
  return (
    <div className="space-y-3 bg-[#080818] rounded border border-[#1e1e3a] p-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">节点属性</Label>
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

      {/* Rest pose */}
      <div>
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">静止姿态</Label>
        <div className="grid grid-cols-2 gap-1.5 mt-1">
          <div>
            <Label className="text-[9px] text-gray-600">角度°</Label>
            <Input
              type="number"
              value={node.angle}
              onChange={(e) => onUpdate({ angle: Number(e.target.value) || 0 })}
              className="h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
            />
          </div>
          <div>
            <Label className="text-[9px] text-gray-600">拉伸</Label>
            <Input
              type="number"
              step="0.1"
              value={node.stretch}
              onChange={(e) => onUpdate({ stretch: Number(e.target.value) || 1 })}
              className="h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
            />
          </div>
          <div>
            <Label className="text-[9px] text-gray-600">偏移 X</Label>
            <Input
              type="number"
              value={node.offsetX}
              onChange={(e) => onUpdate({ offsetX: Number(e.target.value) || 0 })}
              className="h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
            />
          </div>
          <div>
            <Label className="text-[9px] text-gray-600">偏移 Y</Label>
            <Input
              type="number"
              value={node.offsetY}
              onChange={(e) => onUpdate({ offsetY: Number(e.target.value) || 0 })}
              className="h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
            />
          </div>
        </div>
      </div>

      {/* 关节 */}
      <div>
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">关节</Label>
        <div className="grid grid-cols-2 gap-1.5 mt-1">
          <div>
            <Label className="text-[9px] text-gray-600">顶部截面</Label>
            <Input
              type="number"
              value={node.crossSectionTop}
              onChange={(e) => onUpdate({ crossSectionTop: Number(e.target.value) || 0 })}
              className="h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
            />
          </div>
          <div>
            <Label className="text-[9px] text-gray-600">底部截面</Label>
            <Input
              type="number"
              value={node.crossSectionBottom}
              onChange={(e) => onUpdate({ crossSectionBottom: Number(e.target.value) || 0 })}
              className="h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <Label className="text-[9px] text-gray-600">关节盘颜色</Label>
          <input
            type="color"
            value={node.color || '#888888'}
            onChange={(e) => onUpdate({ color: e.target.value })}
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
          {(node.sockets ?? []).map((socket) => (
            <div key={socket.id} className="flex items-center gap-1.5 text-[10px]">
              <Input
                value={socket.name}
                onChange={(e) => {
                  const sockets = (node.sockets ?? []).map((s) =>
                    s.id === socket.id ? { ...s, name: e.target.value } : s
                  );
                  onUpdate({ sockets });
                }}
                className="flex-1 h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
              />
              <Input
                type="number"
                value={socket.localX}
                onChange={(e) => {
                  const sockets = (node.sockets ?? []).map((s) =>
                    s.id === socket.id ? { ...s, localX: Number(e.target.value) || 0 } : s
                  );
                  onUpdate({ sockets });
                }}
                className="w-14 h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
                title="X"
              />
              <Input
                type="number"
                value={socket.localY}
                onChange={(e) => {
                  const sockets = (node.sockets ?? []).map((s) =>
                    s.id === socket.id ? { ...s, localY: Number(e.target.value) || 0 } : s
                  );
                  onUpdate({ sockets });
                }}
                className="w-14 h-6 text-[10px] bg-[#111128] border-[#1e1e3a]"
                title="Y"
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-5 text-red-400 hover:text-red-300"
                onClick={() => onRemoveSocket(socket.id)}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
