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
import { computeWorldTransforms } from '@/lib/unified-render';
import { subToPx } from '@/lib/unified-types';
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

  /** 用真实变换管线算指定链的尖端世界位置（与 applyIKChain 同源） */
  const computeChainTip = (
    ch: Character,
    jointIds: string[],
  ): { tipX: number; tipY: number; tipLength: number } => {
    const store = useProjectStore.getState();
    const transforms = computeWorldTransforms(ch, store.currentFrame, store.canvasWidth, store.canvasHeight);
    const joints: { x: number; y: number; angle: number }[] = [];
    for (const jid of jointIds) {
      const t = transforms.get(jid);
      if (!t) break;
      joints.push({ x: subToPx(t.worldX), y: subToPx(t.worldY), angle: t.worldAngle });
    }
    let tipLength = 0;
    let tipX = 0, tipY = 0;
    if (joints.length >= 1) {
      const last = joints[joints.length - 1];
      tipX = last.x; tipY = last.y;
      // 尖端方向用末关节自己的世界角度，沿精灵局部 Y 轴（骨方向）
      const rad = (last.angle * Math.PI) / 180;
      // 默认尖端长取最后一段骨长
      if (joints.length >= 2) {
        const prev = joints[joints.length - 2];
        tipLength = Math.hypot(last.x - prev.x, last.y - prev.y);
      }
      if (tipLength > 1e-6) {
        tipX = last.x + -Math.sin(rad) * tipLength;
        tipY = last.y + Math.cos(rad) * tipLength;
      }
    }
    return { tipX, tipY, tipLength };
  };

  /** 按 chain 的 root/end 算出 jointIds（root→end） */
  const getChainJointIds = (ch: Character, chain: IKChain): string[] => {
    const path: string[] = [];
    let cur: string | undefined = chain.endNodeId;
    const visited = new Set<string>();
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      path.unshift(cur);
      if (cur === chain.rootNodeId) break;
      cur = ch.nodes[cur]?.parentId;
    }
    return path[0] === chain.rootNodeId ? path : [];
  };

  const handleAdd = () => {
    if (!character || !canAdd) return;
    // 2bone = 2 根骨 = 3 关节；其他（1 骨/多骨）走 fabrik
    const solver = chainJoints.length === 3 ? '2bone' : 'fabrik';
    const endNode = character.nodes[endId];
    const { tipX, tipY, tipLength } = computeChainTip(character, chainJoints);
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
    const chain = chains.find((c) => c.id === id);
    if (!chain) return;
    const willEnable = !chain.enabled;
    let patch: Partial<IKChain> = { enabled: willEnable };
    // 启用时把目标重算到当前尖端位置，避免用创建时的旧位置导致跳变
    if (willEnable) {
      const jointIds = getChainJointIds(character, chain);
      if (jointIds.length >= 2) {
        const { tipX, tipY } = computeChainTip(character, jointIds);
        // 保留用户已调过的 tipLength，只更新目标点
        patch = { ...patch, target: { x: tipX, y: tipY } };
      }
    }
    updateUnifiedCharacter(character.id, {
      ikChains: chains.map((c) => (c.id === id ? { ...c, ...patch } : c)),
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
    // 输入为角色局部坐标，转世界坐标存储
    const offset = axis === 'x'
      ? useProjectStore.getState().canvasWidth / 2
      : useProjectStore.getState().canvasHeight / 2;
    updateUnifiedCharacter(character.id, {
      ikChains: chains.map((c) =>
        c.id === id ? { ...c, target: { ...c.target, [axis]: value + offset } } : c,
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
              {/* IK 目标点坐标（显示为角色局部坐标，存储为世界坐标） */}
              <div className="flex items-center gap-1 text-gray-500">
                <span>目标</span>
                <label className="flex items-center gap-0.5">
                  X
                  <input
                    type="number"
                    value={Math.round(c.target.x - useProjectStore.getState().canvasWidth / 2)}
                    onChange={(e) => handleTargetChange(c.id, 'x', Number(e.target.value))}
                    className="w-14 px-1 py-0.5 bg-black/50 rounded text-gray-300 text-[10px]"
                  />
                </label>
                <label className="flex items-center gap-0.5">
                  Y
                  <input
                    type="number"
                    value={Math.round(c.target.y - useProjectStore.getState().canvasHeight / 2)}
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
