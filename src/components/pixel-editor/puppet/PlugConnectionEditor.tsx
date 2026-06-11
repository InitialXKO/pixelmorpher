'use client';

import React from 'react';
import {
  Plug,
  Link2,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type {
  PuppetSkeleton,
  PuppetNode,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateSkeletonNode } from './updateSkeletonNode';

interface PlugConnectionEditorProps {
  selectedSkeletonId: string | null;
  selectedNodeId: string | null;
  selectedNode: PuppetNode;
  selectedSkeleton: PuppetSkeleton;
}

export default function PlugConnectionEditor({
  selectedSkeletonId,
  selectedNodeId,
  selectedNode,
  selectedSkeleton,
}: PlugConnectionEditorProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[9px] text-gray-600 uppercase tracking-wider">连接 (Plug)</Label>
      {!selectedNode.plug ? (
        <p className="text-[8px] text-gray-500">根节点 — 无父连接</p>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Plug className="size-2.5 text-yellow-500/70" />
            <select
              value={selectedNode.plug.socketId}
              onChange={(e) => {
                const newSocketId = e.target.value;
                const store = useProjectStore.getState();
                useProjectStore.setState({
                  puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
                    s.id === selectedSkeletonId
                      ? updateSkeletonNode(s, selectedNodeId!, (n) => ({ plug: { ...n.plug!, socketId: newSocketId } }))
                      : s
                  ),
                });
              }}
              className="flex-1 h-5 text-[8px] bg-[#080818] border border-[#1e1e3a] rounded px-1 text-gray-300"
            >
              <option value="">— 选择父插口 —</option>
              {selectedSkeleton.nodes
                .filter(n => n.id !== selectedNodeId)
                .flatMap(n => n.sockets.map(s => (
                  <option key={s.id} value={s.id}>
                    {n.name} / {s.name}
                  </option>
                )))
              }
            </select>
          </div>
          <div className="flex items-center gap-1 pl-4">
            <Label className="text-[8px] text-gray-600 w-4">X</Label>
            <Input
              type="number"
              value={selectedNode.plug.localX}
              onChange={(e) => {
                const store = useProjectStore.getState();
                useProjectStore.setState({
                  puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
                    s.id === selectedSkeletonId
                      ? updateSkeletonNode(s, selectedNodeId!, (n) => ({ plug: { ...n.plug!, localX: Number(e.target.value) } }))
                      : s
                  ),
                });
              }}
              className="h-4 text-[8px] bg-[#080818] border-[#1e1e3a] w-12"
            />
            <Label className="text-[8px] text-gray-600 w-4">Y</Label>
            <Input
              type="number"
              value={selectedNode.plug.localY}
              onChange={(e) => {
                const store = useProjectStore.getState();
                useProjectStore.setState({
                  puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
                    s.id === selectedSkeletonId
                      ? updateSkeletonNode(s, selectedNodeId!, (n) => ({ plug: { ...n.plug!, localY: Number(e.target.value) } }))
                      : s
                  ),
                });
              }}
              className="h-4 text-[8px] bg-[#080818] border-[#1e1e3a] w-12"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-[8px] h-5 text-yellow-500/70 hover:text-yellow-400"
            onClick={() => {
              const store = useProjectStore.getState();
              useProjectStore.setState({
                puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
                  s.id === selectedSkeletonId
                    ? updateSkeletonNode(s, selectedNodeId!, { plug: null })
                    : s
                ),
              });
            }}
          >
            断开连接
          </Button>
        </div>
      )}
      {/* Allow connecting a root node to a parent */}
      {!selectedNode.plug && selectedSkeleton.nodes.some(n => n.id !== selectedNodeId && n.sockets.length > 0) && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-[8px] h-5 text-cyan-400 hover:text-cyan-300"
          onClick={() => {
            const otherNode = selectedSkeleton.nodes.find(n => n.id !== selectedNodeId && n.sockets.length > 0);
            if (otherNode) {
              const firstSocket = otherNode.sockets[0];
              const store = useProjectStore.getState();
              useProjectStore.setState({
                puppetSkeletons: (store.puppetSkeletons ?? []).map((s) =>
                  s.id === selectedSkeletonId
                    ? updateSkeletonNode(s, selectedNodeId!, { plug: { socketId: firstSocket.id, localX: 0, localY: 0 } })
                    : s
                ),
              });
            }
          }}
        >
          <Link2 className="size-2.5 mr-1" /> 连接到父节点
        </Button>
      )}
    </div>
  );
}
