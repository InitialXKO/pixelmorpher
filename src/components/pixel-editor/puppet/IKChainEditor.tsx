'use client';

// ============================================================
// IKChainEditor — IK 链创建/管理 UI
// 选根关节 → 选末端 → 自动按父链成链 → 加到 character.ikChains
// ============================================================

import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/lib/store';
import { interpolateNodeKeyframes } from '@/lib/engine/render-helpers/puppet-keyframe-interpolation';
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
    // 2bone = 2 根骨 = 3 关节；其他（1 骨/多骨）走 fabrik
    const solver = chainJoints.length === 3 ? '2bone' : 'fabrik';
    const endNode = character.nodes[endId];
    // 计算末端执行器的 FK 世界位置（SubPixel→像素），作为 IK 初始目标
    // 目标是尖端（末节末端），不是关节轴心
    // 用当前帧插值，不是 rest pose
    const currentFrame = useProjectStore.getState().currentFrame;
    const ivMap = interpolateNodeKeyframes(character, currentFrame);
    let tx = 0, ty = 0, angle = 0;
    const fkPositions: { x: number; y: number }[] = [{ x: 0, y: 0 }];
    // 从根往末端累积（chainJoints 已是 root→end 顺序）
    for (const jid of chainJoints) {
      const jn = character.nodes[jid] as any;
      const iv = ivMap.get(jid);
      const lx = ((iv?.x ?? jn?.transform?.x) ?? 0) / 16;
      const ly = ((iv?.y ?? jn?.transform?.y) ?? 0) / 16;
      const la = iv?.angle ?? jn?.transform?.angle ?? 0;
      const rad = (angle * Math.PI) / 180;
      tx += lx * Math.cos(rad) - ly * Math.sin(rad);
      ty += lx * Math.sin(rad) + ly * Math.cos(rad);
      angle += la;
      fkPositions.push({ x: tx, y: ty });
    }
    // 尖端：末关节位置 + 沿最后一段方向外推（默认长度取最后一段骨长）
    let tipLength = 0;
    let tipX = tx, tipY = ty;
    if (fkPositions.length >= 2) {
      const last = fkPositions[fkPositions.length - 1];
      const prev = fkPositions[fkPositions.length - 2];
      const dx = last.x - prev.x;
      const dy = last.y - prev.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) {
        tipLength = d;
        tipX = last.x + (dx / d) * tipLength;
        tipY = last.y + (dy / d) * tipLength;
      }
    }
    const newChain: IKChain = {
      id: `ik_${Date.now().toString(36)}`,
      name: `${character.nodes[rootId]?.name ?? rootId} → ${endNode?.name ?? endId}`,
      rootNodeId: rootId,
      endNodeId: endId,
      target: { x: tipX, y: tipY },
      solver,
      bendDir: 1,
      tipLength,
      // 默认禁用：用户摆好目标点后再启用，避免新建即干扰拖拽
      enabled: false,
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
    const remaining = chains.filter((c) => c.id !== id);
    const patch: any = { ikChains: remaining };
    // 删光链后，烘焙的蓝图也失效，一并清除（否则 ikBlueprint 优先继续生效）
    if (remaining.length === 0 && character.ikBlueprint) {
      patch.ikBlueprint = null;
    }
    updateUnifiedCharacter(character.id, patch);
  };

  const handleTargetChange = (id: string, axis: 'x' | 'y', value: number) => {
    if (!character || !Number.isFinite(value)) return;
    updateUnifiedCharacter(character.id, {
      ikChains: chains.map((c) =>
        c.id === id ? { ...c, target: { ...c.target, [axis]: value } } : c,
      ),
    });
  };

  const handleTipLengthChange = (id: string, value: number) => {
    if (!character || !Number.isFinite(value) || value < 0) return;
    updateUnifiedCharacter(character.id, {
      ikChains: chains.map((c) => (c.id === id ? { ...c, tipLength: value } : c)),
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
              className="px-1.5 py-1 rounded bg-black/30 text-[10px] space-y-1"
            >
              <div className="flex items-center gap-1.5">
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
              {/* IK 目标点坐标 */}
              <div className="flex items-center gap-1 text-gray-500">
                <span>目标</span>
                <label className="flex items-center gap-0.5">
                  X
                  <input
                    type="number"
                    value={Math.round(c.target.x)}
                    onChange={(e) => handleTargetChange(c.id, 'x', Number(e.target.value))}
                    className="w-14 px-1 py-0.5 bg-black/50 rounded text-gray-300 text-[10px]"
                  />
                </label>
                <label className="flex items-center gap-0.5">
                  Y
                  <input
                    type="number"
                    value={Math.round(c.target.y)}
                    onChange={(e) => handleTargetChange(c.id, 'y', Number(e.target.value))}
                    className="w-14 px-1 py-0.5 bg-black/50 rounded text-gray-300 text-[10px]"
                  />
                </label>
                <label className="flex items-center gap-0.5" title="末节尖端到轴心的距离">
                  尖端
                  <input
                    type="number"
                    value={Math.round(c.tipLength ?? 0)}
                    onChange={(e) => handleTipLengthChange(c.id, Number(e.target.value))}
                    className="w-12 px-1 py-0.5 bg-black/50 rounded text-gray-300 text-[10px]"
                  />
                </label>
              </div>
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
                关节数: {chainJoints.length}（{chainJoints.length === 3 ? '2bone' : 'fabrik'}）
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
