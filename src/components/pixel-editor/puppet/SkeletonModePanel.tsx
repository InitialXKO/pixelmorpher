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
  PuppetCharacter,
  PuppetSocket,
  PuppetDirection,
} from '@/lib/types';
import type { Part } from '@/lib/types';
import DirectionWheel, { oldDirectionToIndex, directionIndexToOldDirection } from '../DirectionWheel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NodeTreeItemWrapper } from './NodeTree';
import NodePropertiesEditor from './NodePropertiesEditor';
import { updateSkeletonNode } from './updateSkeletonNode';

interface SkeletonModePanelProps {
  puppetSkeletons: PuppetSkeleton[];
  puppetCharacters: PuppetCharacter[];
  parts: Part[];
  selectedSkeletonId: string | null;
  setSelectedSkeletonId: (id: string | null) => void;
  selectedNodeId: string | null;
  selectedSkeleton: PuppetSkeleton | null;
  selectedNode: PuppetNode | null;
  direction: PuppetDirection;
  setDirection: (dir: PuppetDirection) => void;
  latitude: number;
  setLatitude: (lat: number) => void;
  handleSelectNodeWithSync: (nodeId: string | null) => void;
}

export default function SkeletonModePanel({
  puppetSkeletons,
  puppetCharacters,
  parts,
  selectedSkeletonId,
  setSelectedSkeletonId,
  selectedNodeId,
  selectedSkeleton,
  selectedNode,
  direction,
  setDirection,
  latitude,
  setLatitude,
  handleSelectNodeWithSync,
}: SkeletonModePanelProps) {

  // ---- Handlers ----
  const handleDeleteSkeleton = useCallback(() => {
    if (!selectedSkeletonId) return;
    const store = useProjectStore.getState();
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
    store.pushUndo('删除节点');
    useProjectStore.setState({
      puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
        s.id === selectedSkeletonId
          ? { ...s, nodes: s.nodes.filter((n) => n.id !== selectedNodeId) }
          : s
      ),
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
      const store = useProjectStore.getState();
      const skeleton = (store.puppetSkeletons ?? []).find((s) => s.id === selectedSkeletonId);
      if (!skeleton) return;
      const node = skeleton.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      store.pushUndo('切换可见性');
      useProjectStore.setState({
        puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
          s.id === selectedSkeletonId
            ? updateSkeletonNode(s, nodeId, { visible: !node.visible })
            : s
        ),
      });
    },
    [selectedSkeletonId]
  );

  const handleAddSocket = useCallback(() => {
    if (!selectedSkeletonId || !selectedNodeId) return;
    const store = useProjectStore.getState();
    store.pushUndo('添加插口');
    const newSocket: PuppetSocket = {
      id: crypto.randomUUID(),
      name: '新插口',
      localX: 0,
      localY: 8,
    };
    useProjectStore.setState({
      puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
        s.id === selectedSkeletonId
          ? updateSkeletonNode(s, selectedNodeId, (n) => ({ sockets: [...n.sockets, newSocket] }))
          : s
      ),
    });
  }, [selectedSkeletonId, selectedNodeId]);

  const handleRemoveSocket = useCallback(
    (socketId: string) => {
      if (!selectedSkeletonId || !selectedNodeId) return;
      const store = useProjectStore.getState();
      store.pushUndo('删除插口');
      useProjectStore.setState({
        puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
          s.id === selectedSkeletonId
            ? updateSkeletonNode(s, selectedNodeId, (n) => ({ sockets: n.sockets.filter((sk) => sk.id !== socketId) }))
            : s
        ),
      });
    },
    [selectedSkeletonId, selectedNodeId]
  );

  const handleSetDirection = useCallback(
    (dir: PuppetDirection) => {
      setDirection(dir);
      if (selectedSkeletonId) {
        const store = useProjectStore.getState();
        useProjectStore.setState({
          puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
            s.id === selectedSkeletonId ? { ...s, currentDirection: dir } : s
          ),
        });
      }
    },
    [selectedSkeletonId, setDirection]
  );

  return (
    <div className="space-y-3">
      {/* Skeleton selector */}
      <div className="space-y-1.5">
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">骨骼</Label>
        <div className="flex items-center gap-1">
          <select
            value={selectedSkeletonId ?? ''}
            onChange={(e) => {
              setSelectedSkeletonId(e.target.value || null);
              handleSelectNodeWithSync(null);
              if (e.target.value) {
                useEditorStore.getState().setActivePuppetSkeletonId(e.target.value);
              }
            }}
            className="flex-1 h-7 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded px-2 text-gray-300"
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

      {/* Node tree */}
      {selectedSkeleton && (
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

      {/* Direction selector */}
      {selectedSkeleton && (
        <DirectionWheel
          value={oldDirectionToIndex(direction)}
          onChange={(idx) => handleSetDirection(directionIndexToOldDirection(idx) as PuppetDirection)}
          latitude={latitude}
          onLatitudeChange={setLatitude}
          size="sm"
          showLabels
        />
      )}

      {/* Node properties */}
      {selectedNode && selectedSkeleton && (
        <NodePropertiesEditor
          selectedSkeletonId={selectedSkeletonId}
          selectedNodeId={selectedNodeId}
          selectedNode={selectedNode}
          selectedSkeleton={selectedSkeleton}
          puppetSkeletons={puppetSkeletons}
          puppetCharacters={puppetCharacters}
          parts={parts}
          direction={direction}
          handleUpdateNode={handleUpdateNode}
          handleDeleteNode={handleDeleteNode}
          handleAddSocket={handleAddSocket}
          handleRemoveSocket={handleRemoveSocket}
        />
      )}
    </div>
  );
}
