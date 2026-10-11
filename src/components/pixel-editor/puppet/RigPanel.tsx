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
  selectedSkeletonId: string | null;
  setSelectedSkeletonId: (id: string | null) => void;
  selectedNodeId: string | null;
  selectedSkeleton: PuppetSkeleton | null;
  selectedNode: PuppetNode | null;
  handleSelectNodeWithSync: (nodeId: string | null) => void;
  /** 隐藏节点树（用左侧共享树），只显示细节 */
  hideNodeTree?: boolean;
}

/**
 * RigPanel — 骨架搭建阶段。
 * 只做：选骨骼、节点树、增删节点、关节（socket/plug）、rest pose、z-order。
 * 不做：方向盘、纬度（那是 perform 的事）、精灵分配（那是 dress 的事）。
 */
export default function RigPanel({
  puppetSkeletons,
  selectedSkeletonId,
  setSelectedSkeletonId,
  selectedNodeId,
  selectedSkeleton,
  selectedNode,
  handleSelectNodeWithSync,
  hideNodeTree = false,
}: RigPanelProps) {

  // ---- Handlers ----
  const handleDeleteSkeleton = useCallback(() => {
    if (!selectedSkeletonId) return;
    const store = useProjectStore.getState();
    const affected = (store.puppetCharacters ?? []).filter(
      (c) => c.puppetSkeletonId === selectedSkeletonId
    );
    const names = affected.map((c) => c.name).join('、');
    if (!confirm(`删除骨骼会连带删除 ${affected.length} 个角色${names ? `（${names}）` : ''}，继续？`)) return;
    store.pushUndo('删除骨骼');
    useProjectStore.setState({
      puppetSkeletons: (store.puppetSkeletons ?? []).filter((s) => s.id !== selectedSkeletonId),
      puppetCharacters: (store.puppetCharacters ?? []).filter(
        (c) => c.puppetSkeletonId !== selectedSkeletonId
      ),
    });
    setSelectedSkeletonId(null);
    handleSelectNodeWithSync(null);
  }, [selectedSkeletonId, handleSelectNodeWithSync, setSelectedSkeletonId]);

  const handleAddNode = useCallback(() => {
    if (!selectedSkeletonId) return;
    const store = useProjectStore.getState();
    const nodeName = `节点_${(selectedSkeleton?.nodes.length ?? 0) + 1}`;
    const newNode = store.addPuppetNode(selectedSkeletonId, nodeName, {
      mirrorFrom: false,
      crossSectionTop: 4,
      crossSectionBottom: 3,
      zIndex: 0,
    });
    handleSelectNodeWithSync(newNode.id);
  }, [selectedSkeletonId, selectedSkeleton, handleSelectNodeWithSync]);

  const handleDeleteNode = useCallback(() => {
    if (!selectedSkeletonId || !selectedNodeId) return;
    const store = useProjectStore.getState();
    const skeleton = (store.puppetSkeletons ?? []).find((s) => s.id === selectedSkeletonId);
    const node = skeleton?.nodes.find((n) => n.id === selectedNodeId);
    if (!node) return;
    // 子节点：挂在被删节点上的
    const children = (skeleton?.nodes ?? []).filter((n) => n.plug?.socketId && node.sockets?.some((s) => s.id === n.plug!.socketId));
    // 检查其他节点蓝图里的 nodeRef 引用
    const refBy = (skeleton?.nodes ?? []).filter((n) =>
      n.id !== selectedNodeId &&
      n.blueprint?.nodes.some((bn) => bn.type === 'nodeRef' && String(bn.params.nodeId) === selectedNodeId)
    );
    const warns: string[] = [];
    if (children.length > 0) warns.push(`${children.length} 个子节点将被 detached（plug 置空）`);
    if (refBy.length > 0) warns.push(`${refBy.length} 个节点的蓝图引用了它（nodeRef 将输出 0）：${refBy.map((n) => n.name).join('、')}`);
    if (warns.length > 0 && !confirm(`删除节点「${node.name}」？\n${warns.join('\n')}`)) return;
    store.pushUndo('删除节点');
    useProjectStore.setState({
      puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
        s.id === selectedSkeletonId
          ? {
              ...s,
              nodes: s.nodes
                .filter((n) => n.id !== selectedNodeId)
                .map((n) =>
                  n.plug?.socketId && node.sockets?.some((so) => so.id === n.plug!.socketId)
                    ? { ...n, plug: null }
                    : n
                ),
            }
          : s
      ),
      // 删除该节点的全部关键帧（所有使用该骨骼的动画片段）
      animationClips: (store.animationClips ?? []).map((c) => {
        const char = (store.puppetCharacters ?? []).find((ch) => ch.id === c.puppetCharacterId);
        if (char?.puppetSkeletonId !== selectedSkeletonId) return c;
        return {
          ...c,
          puppetNodeKeyframes: (c.puppetNodeKeyframes ?? []).filter((k) => k.nodeId !== selectedNodeId),
        };
      }),
    });
    handleSelectNodeWithSync(null);
  }, [selectedSkeletonId, selectedNodeId, handleSelectNodeWithSync]);

  const handleUpdateNode = useCallback(
    (nodeId: string, updates: Partial<PuppetNode>) => {
      if (!selectedSkeletonId) return;
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
      {/* Skeleton selector */}
      <div>
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">骨骼</Label>
        <div className="flex items-center gap-1.5 mt-1">
          <select
            value={selectedSkeletonId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null;
              setSelectedSkeletonId(id);
              handleSelectNodeWithSync(null);
            }}
            className="flex-1 min-w-0 h-7 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded px-2 text-gray-300"
          >
            <option value="">— 选择骨骼 —</option>
            {puppetSkeletons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-red-400 hover:text-red-300"
            onClick={handleDeleteSkeleton}
            disabled={!selectedSkeletonId}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

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

      {/* Node tree（hideNodeTree 时用左侧共享树） */}
      {!hideNodeTree && selectedSkeleton && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-gray-500 uppercase tracking-wider">节点树</Label>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-cyan-400 hover:text-cyan-300"
              onClick={handleAddNode}
              title="添加节点"
            >
              <Plus className="size-3" />
            </Button>
          </div>
          <div className="bg-[#080818] rounded border border-[#1e1e3a] p-1 max-h-48 overflow-y-auto">
            {selectedSkeleton.nodes.length === 0 ? (
              <div className="text-center py-3">
                <Bone className="size-4 text-gray-700 mx-auto mb-1" />
                <p className="text-[9px] text-gray-600">暂无节点</p>
              </div>
            ) : (
              selectedSkeleton.nodes
                .filter((node) => !node.plug)
                .map((node) => (
                  <NodeTreeItemWrapper
                    key={node.id}
                    node={node}
                    depth={0}
                    selectedNodeId={selectedNodeId}
                    onSelect={handleSelectNodeWithSync}
                    allNodes={selectedSkeleton.nodes}
                    onToggleVisibility={handleToggleNodeVisibility}
                  />
                ))
            )}
          </div>
        </div>
      )}

      {/* Node properties: rest pose + joints */}
      {selectedNode && selectedSkeleton && (
        <RigNodeProperties
          node={selectedNode}
          onUpdate={(updates) => handleUpdateNode(selectedNode.id, updates)}
          onDelete={handleDeleteNode}
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
  onDelete,
  onAddSocket,
  onRemoveSocket,
}: {
  node: PuppetNode;
  onUpdate: (updates: Partial<PuppetNode>) => void;
  onDelete: () => void;
  onAddSocket: () => void;
  onRemoveSocket: (socketId: string) => void;
}) {
  return (
    <div className="space-y-3 bg-[#080818] rounded border border-[#1e1e3a] p-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">节点属性</Label>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-red-400 hover:text-red-300"
          onClick={onDelete}
          title="删除节点"
        >
          <Trash2 className="size-3" />
        </Button>
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
