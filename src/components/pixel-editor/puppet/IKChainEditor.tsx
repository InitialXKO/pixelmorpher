'use client';

// ============================================================
// IKChainEditor — IK 链创建/管理 UI
// 选根关节 → 选末端 → 自动按父链成链 → 加到 character.ikChains
// ============================================================

import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/lib/store';
import type { Character, IKChain } from '@/lib/unified-types';

interface IKChainEditorProps {
  character: Character | null;
}

export default function IKChainEditor({ character }: IKChainEditorProps) {
  const updateUnifiedCharacter = useProjectStore((s) => s.updateUnifiedCharacter);
  const [rootId, setRootId] = useState<string>('');
  const [endId, setEndId] = useState<string>('');

  const nodes = useMemo(() => {
    if (!character) return [];
    return Object.values(character.nodes);
  }, [character]);

  const chains = character?.ikChains ?? [];

  // 从 end 往 root 走父链，算出关节数
  const chainJoints = useMemo(() => {
    if (!character || !rootId || !endId) return [];
    const path: string[] = [];
    let cur: string | undefined = endId;
    const visited = new Set<string>();
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      path.unshift(cur);
      if (cur === rootId) break;
      cur = character.nodes[cur]?.parentId;
    }
    if (path[0] !== rootId) return []; // 不连通
    return path;
  }, [character, rootId, endId]);

  const canAdd = rootId && endId && rootId !== endId && chainJoints.length >= 2;

  const handleAdd = () => {
    if (!character || !canAdd) return;
    const solver = chainJoints.length === 2 ? '2bone' : 'fabrik';
    const endNode = character.nodes[endId];
    // 目标点默认为末端当前位置（需在 FK 下计算，这里简化用节点本地坐标）
    const newChain: IKChain = {
      id: `ik_${Date.now().toString(36)}`,
      name: `${character.nodes[rootId]?.name ?? rootId} → ${endNode?.name ?? endId}`,
      rootNodeId: rootId,
      endNodeId: endId,
      target: { x: 0, y: 0 },
      solver,
      bendDir: 1,
      enabled: true,
    };
    updateUnifiedCharacter(character.id, {
      ikChains: [...(character.ikChains ?? []), newChain],
    });
    setRootId('');
    setEndId('');
  };

  const handleToggle = (id: string) => {
    if (!character) return;
    updateUnifiedCharacter(character.id, {
      ikChains: chains.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)),
    });
  };

  const handleDelete = (id: string) => {
    if (!character) return;
    updateUnifiedCharacter(character.id, {
      ikChains: chains.filter((c) => c.id !== id),
    });
  };

  if (!character) return null;

  return (
    <div className="space-y-2">
      {/* 已有链列表 */}
      {chains.length > 0 && (
        <div className="space-y-1">
          {chains.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-1.5 px-1.5 py-1 rounded bg-black/30 text-[10px]"
            >
              <span className="flex-1 truncate text-gray-300" title={c.name}>
                {c.name} <span className="text-gray-600">({c.solver})</span>
              </span>
              <button
                onClick={() => handleToggle(c.id)}
                className={`p-0.5 rounded ${c.enabled ? 'text-green-400' : 'text-gray-600'}`}
                title={c.enabled ? '禁用' : '启用'}
              >
                <Power className="size-3" />
              </button>
              <button
                onClick={() => handleDelete(c.id)}
                className="p-0.5 rounded text-gray-600 hover:text-red-400"
                title="删除"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 新建链 */}
      <div className="space-y-1.5 p-1.5 rounded bg-[#111128] border border-[#1e1e3a]">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-gray-500 w-10 flex-shrink-0">根关节</span>
          <select
            value={rootId}
            onChange={(e) => setRootId(e.target.value)}
            className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[10px] text-gray-300"
          >
            <option value="">选择…</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {(n as any).name ?? n.id}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-gray-500 w-10 flex-shrink-0">末端</span>
          <select
            value={endId}
            onChange={(e) => setEndId(e.target.value)}
            className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[10px] text-gray-300"
          >
            <option value="">选择…</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {(n as any).name ?? n.id}
              </option>
            ))}
          </select>
        </div>
        {rootId && endId && (
          <div className="text-[9px] text-gray-500">
            {chainJoints.length >= 2 ? (
              <span>
                关节数: {chainJoints.length}（{chainJoints.length === 2 ? '2bone' : 'fabrik'}）
              </span>
            ) : (
              <span className="text-amber-500">两节点不连通（末端不在根的子树下）</span>
            )}
          </div>
        )}
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={!canAdd}
          className="w-full h-6 text-[10px]"
        >
          <Plus className="size-3 mr-1" /> 添加 IK 链
        </Button>
      </div>
    </div>
  );
}
