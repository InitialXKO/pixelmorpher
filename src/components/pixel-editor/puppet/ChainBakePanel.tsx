'use client';

// ============================================================
// ChainBakePanel — 链摆烘焙（D6 一期）
// 选中节点为链根，沿子节点收一条链，跑 Verlet 求解（编辑期），
// 把摆动烘进链上各节点的 angle 轨道。播放端不带求解器。
// 烘焙带指纹：驱动/参数变了指纹对不上 → 点名过期，不静默沿用。
// ============================================================

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/lib/store';
import type { Character } from '@/lib/unified-types';
import {
  collectChain, bakeChainSwing, isChainBakeFresh,
  defaultChainBakeParams, type ChainBakeParams,
} from '@/lib/sim/verlet-chain';

export default function ChainBakePanel({ character }: { character: Character | null }) {
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const totalFrames = useProjectStore((s) => s.totalFrames);
  const frameRate = useProjectStore((s) => s.frameRate);
  const updateUnifiedCharacter = useProjectStore((s) => s.updateUnifiedCharacter);
  const [params, setParams] = useState<ChainBakeParams>(defaultChainBakeParams());
  const [note, setNote] = useState<string>('');

  const chain = useMemo(
    () => (character && selectedNodeId ? collectChain(character, selectedNodeId) : null),
    [character, selectedNodeId],
  );
  const record = character && selectedNodeId ? character.chainBakes?.[selectedNodeId] : undefined;
  const fresh = useMemo(
    () => (character && record ? isChainBakeFresh(character, record, frameRate) : null),
    [character, record, frameRate],
  );

  if (!character) return null;
  const num = (
    label: string, key: keyof ChainBakeParams, step: number, min: number, max: number,
  ) => (
    <label className="flex items-center gap-1 text-[10px] text-gray-400">
      <span className="w-14 shrink-0">{label}</span>
      <input
        type="number" value={params[key]} step={step} min={min} max={max}
        onChange={(e) => setParams((p) => ({ ...p, [key]: Number(e.target.value) }))}
        className="w-16 bg-[#12122a] border border-[#2a2a4a] rounded px-1 py-0.5 text-gray-200"
      />
    </label>
  );

  const handleBake = () => {
    if (!chain || chain.nodeIds.length < 2 || !selectedNodeId) return;
    const res = bakeChainSwing(character, chain.nodeIds, params, 0, Math.max(0, totalFrames - 1), frameRate);
    const nodes = { ...character.nodes };
    for (const id of chain.nodeIds) {
      const node = nodes[id];
      if (!node) continue;
      nodes[id] = { ...node, tracks: { ...node.tracks, angle: res.angleTracks[id] } };
    }
    updateUnifiedCharacter(character.id, {
      nodes,
      chainBakes: { ...(character.chainBakes ?? {}), [selectedNodeId]: res.record },
    });
    setNote(`已烘焙 ${chain.nodeIds.length} 节点 × ${totalFrames} 帧`);
  };

  const handleUndo = () => {
    if (!record || !selectedNodeId) return;
    const nodes = { ...character.nodes };
    record.chainNodeIds.forEach((id, i) => {
      const node = nodes[id];
      if (!node) return;
      const kept = (node.tracks?.angle?.keyframes ?? [])
        .filter((kf) => kf.frame < record.fromFrame || kf.frame > record.toFrame);
      kept.push({ frame: record.fromFrame, value: record.baseLocals[i] ?? 0 });
      kept.sort((a, b) => a.frame - b.frame);
      nodes[id] = {
        ...node,
        tracks: { ...node.tracks, angle: { keyframes: kept, interpolation: node.tracks?.angle?.interpolation ?? 'linear' } },
      };
    });
    const chainBakes = { ...(character.chainBakes ?? {}) };
    delete chainBakes[selectedNodeId];
    updateUnifiedCharacter(character.id, { nodes, chainBakes });
    setNote('已撤销烘焙（角度回到烘焙前基准）');
  };

  return (
    <div className="flex flex-col gap-1.5">
      {!selectedNodeId && <div className="text-[10px] text-gray-500">先在节点树里选中链根节点（披风/尾巴/锁链的根）</div>}
      {selectedNodeId && chain && (
        <div className="text-[10px] text-gray-400">
          链：{chain.nodeIds.length} 个节点
          {chain.truncated && <span className="text-amber-400">（途中有多子节点，只取第一子成链）</span>}
          {chain.nodeIds.length < 2 && <span className="text-amber-400">（链太短，至少要 2 个节点）</span>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1">
        {num('重力', 'gravity', 10, 0, 4000)}
        {num('风力', 'windX', 10, -2000, 2000)}
        {num('阻尼', 'damping', 0.01, 0, 0.2)}
        {num('约束迭代', 'iterations', 1, 1, 24)}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={handleBake}
          disabled={!chain || chain.nodeIds.length < 2}>
          烘焙链摆（全程 {totalFrames} 帧）
        </Button>
        {record && (
          <Button size="sm" variant="ghost" className="h-7 text-[11px] text-red-400" onClick={handleUndo}>
            撤销烘焙
          </Button>
        )}
      </div>
      {record && (
        <div className={`text-[10px] ${fresh ? 'text-emerald-400' : 'text-amber-400'}`}>
          {fresh
            ? `已烘焙（第 ${record.fromFrame}–${record.toFrame} 帧），与当前驱动一致`
            : '烘焙已过期：驱动动画/参数已变化，画面仍用旧烘焙——重烘或撤销'}
        </div>
      )}
      {note && <div className="text-[10px] text-gray-500">{note}</div>}
    </div>
  );
}
