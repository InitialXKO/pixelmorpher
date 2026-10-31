'use client';

// ============================================================
// ChainBakePanel — 链摆烘焙（D6 一期）
// 选中节点为链根，沿子节点收一条链，跑 Verlet 求解（编辑期），
// 把摆动烘进链上各节点的 angle 轨道。播放端不带求解器。
// 烘焙带指纹：驱动/参数变了指纹对不上 → 点名过期，不静默沿用。
// ============================================================

import React, { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type { Character } from '@/lib/unified-types';
import {
  collectChain, bakeChainSwing, isChainBakeFresh,
  chainDriveModeOf, realtimeChainDefs,
  defaultChainBakeParams, type ChainBakeParams,
} from '@/lib/sim/verlet-chain';
import {
  generateClothGrid, detectClothGrid, bakeClothSwing, isClothBakeFresh,
} from '@/lib/sim/cloth-bake';
import {
  generateHairStrands, detectHairStrands, bakeHairSwing, hairStaleStrands,
} from '@/lib/sim/strand-bake';

export default function ChainBakePanel({ character }: { character: Character | null }) {
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const totalFrames = useProjectStore((s) => s.totalFrames);
  const frameRate = useProjectStore((s) => s.frameRate);
  const rawUpdateUnifiedCharacter = useProjectStore((s) => s.updateUnifiedCharacter);
  // 本面板全部写操作（含子区经 props 拿到的同一函数）统一经此补撤销：
  // 烘焙/驱动模式/实时参数原先全无 pushUndo，烘错了无法撤销。
  const updateUnifiedCharacter = useCallback((id: string, patch: Partial<Character>) => {
    useProjectStore.getState().pushUndo('编辑链摆/布料烘焙', 'chainBakePanel');
    rawUpdateUnifiedCharacter(id, patch);
  }, [rawUpdateUnifiedCharacter]);
  const [params, setParams] = useState<ChainBakeParams>(defaultChainBakeParams());
  const [note, setNote] = useState<string>('');
  const [clothCols, setClothCols] = useState(4);
  const [clothRows, setClothRows] = useState(4);
  const [clothNote, setClothNote] = useState<string>('');
  const [hairStrands, setHairStrands] = useState(5);
  const [hairSegs, setHairSegs] = useState(4);
  const [hairNote, setHairNote] = useState<string>('');

  const chain = useMemo(
    () => (character && selectedNodeId ? collectChain(character, selectedNodeId) : null),
    [character, selectedNodeId],
  );
  const record = character && selectedNodeId ? character.chainBakes?.[selectedNodeId] : undefined;
  const fresh = useMemo(
    () => (character && record ? isChainBakeFresh(character, record, frameRate) : null),
    [character, record, frameRate],
  );
  const simMaster = useEditorStore((s) => s.simRealtimePreview);
  const setSimMaster = useEditorStore((s) => s.setSimRealtimePreview);
  const driveMode = character && selectedNodeId ? chainDriveModeOf(character, selectedNodeId) : 'bake';
  const simDef = character && selectedNodeId ? character.chainSims?.[selectedNodeId] : undefined;
  const realtimeDefs = useMemo(() => (character ? realtimeChainDefs(character) : []), [character]);

  const setDriveMode = (mode: 'bake' | 'realtime') => {
    if (!character || !selectedNodeId || !chain) return;
    const patch: Partial<Character> = {
      chainModes: { ...(character.chainModes ?? {}), [selectedNodeId]: mode },
    };
    if (mode === 'realtime' && !character.chainSims?.[selectedNodeId]) {
      patch.chainSims = {
        ...(character.chainSims ?? {}),
        [selectedNodeId]: {
          chainNodeIds: record?.chainNodeIds ?? chain.nodeIds,
          params: record?.params ? { ...record.params } : { ...params },
        },
      };
    }
    updateUnifiedCharacter(character.id, patch);
    setNote(mode === 'realtime' ? '已改用实时模拟（烘焙档案保留，当前不生效）' : '已改回烘焙驱动（实时定义保留，当前不生效）');
  };

  const updateSimParams = () => {
    if (!character || !selectedNodeId || !simDef) return;
    updateUnifiedCharacter(character.id, {
      chainSims: { ...(character.chainSims ?? {}), [selectedNodeId]: { ...simDef, params: { ...params } } },
    });
    setNote('实时参数已更新');
  };

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
      <div className="mt-2 pt-2 border-t border-[#1e1e3a] flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500">实时模拟（同一链与烘焙二选一）</span>
          <label className="flex items-center gap-1 text-[10px] text-gray-400">
            <input type="checkbox" checked={simMaster}
              onChange={(e) => setSimMaster(e.target.checked)} />
            预览总开关
          </label>
        </div>
        {!simMaster && realtimeDefs.length > 0 && (
          <div className="text-[10px] text-amber-400">
            总开关已关，以下链的实时模拟被跳过（画面按各自轨道显示）：{realtimeDefs.map((d) => character.nodes[d.rootId]?.name ?? d.rootId).join('、')}
          </div>
        )}
        {selectedNodeId && chain && chain.nodeIds.length >= 2 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400">本链驱动：{driveMode === 'realtime' ? '实时模拟' : '烘焙'}</span>
            {driveMode !== 'realtime' ? (
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setDriveMode('realtime')}>
                改用实时模拟
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setDriveMode('bake')}>
                改回烘焙
              </Button>
            )}
          </div>
        )}
        {selectedNodeId && driveMode === 'realtime' && simDef && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500">
              实时参数：重力 {simDef.params.gravity}、风力 {simDef.params.windX}、阻尼 {simDef.params.damping}、迭代 {simDef.params.iterations}
            </span>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={updateSimParams}>
              用上方参数更新
            </Button>
          </div>
        )}
        {selectedNodeId && driveMode === 'realtime' && record && (
          <div className="text-[10px] text-gray-500">本链留有烘焙档案，实时模式下不生效；上方新鲜度提示说的是烘焙档案。</div>
        )}
      </div>
      <ClothSection character={character} rootId={selectedNodeId} params={params}
        totalFrames={totalFrames} frameRate={frameRate}
        updateUnifiedCharacter={updateUnifiedCharacter}
        cols={clothCols} rows={clothRows} setCols={setClothCols} setRows={setClothRows}
        note={clothNote} setNote={setClothNote} />
      <HairSection character={character} rootId={selectedNodeId} params={params}
        totalFrames={totalFrames} frameRate={frameRate}
        updateUnifiedCharacter={updateUnifiedCharacter}
        strands={hairStrands} segs={hairSegs} setStrands={setHairStrands} setSegs={setHairSegs}
        note={hairNote} setNote={setHairNote} />
    </div>
  );
}

function HairSection(props: {
  character: Character; rootId: string | null | undefined;
  params: ChainBakeParams; totalFrames: number; frameRate: number;
  updateUnifiedCharacter: (id: string, patch: Partial<Character>) => void;
  strands: number; segs: number; setStrands: (n: number) => void; setSegs: (n: number) => void;
  note: string; setNote: (s: string) => void;
}) {
  const { character, rootId, params, totalFrames, frameRate, updateUnifiedCharacter } = props;
  const strands = useMemo(
    () => (rootId ? detectHairStrands(character, rootId) : null),
    [character, rootId],
  );
  const stale = useMemo(
    () => (strands ? hairStaleStrands(character, strands, frameRate) : []),
    [character, strands, frameRate],
  );
  if (!rootId) return null;
  const bakedCount = strands ? strands.length - stale.length : 0;
  const allRealtime = strands
    ? strands.every((s) => chainDriveModeOf(character, s[0]) === 'realtime')
    : false;
  const setBundleMode = (mode: 'bake' | 'realtime') => {
    if (!strands) return;
    const chainSims = { ...(character.chainSims ?? {}) };
    const chainModes = { ...(character.chainModes ?? {}) };
    for (const s of strands) {
      chainModes[s[0]] = mode;
      if (mode === 'realtime' && !chainSims[s[0]]) {
        const rec = character.chainBakes?.[s[0]];
        chainSims[s[0]] = {
          chainNodeIds: rec?.chainNodeIds ?? s,
          params: rec?.params ? { ...rec.params } : { ...params },
        };
      }
    }
    updateUnifiedCharacter(character.id, { chainSims, chainModes });
    props.setNote(mode === 'realtime' ? '整束已改用实时模拟（烘焙档案保留，不生效）' : '整束已改回烘焙驱动（实时定义保留，不生效）');
  };

  const handleGenerate = () => {
    const gen = generateHairStrands(rootId, props.strands, props.segs);
    const root = character.nodes[rootId];
    if (!root) return;
    const nodes = { ...character.nodes, ...gen.nodes };
    nodes[rootId] = {
      ...root,
      children: [...(root.children ?? []), ...gen.strandIds.map((s) => s[0])],
    };
    updateUnifiedCharacter(character.id, { nodes });
    props.setNote(`已生成 ${props.strands} 根发丝 × ${props.segs} 节（扇形张开）`);
  };

  const handleBake = () => {
    if (!strands) return;
    const res = bakeHairSwing(character, strands, params, 0, Math.max(0, totalFrames - 1), frameRate);
    const nodes = { ...character.nodes };
    for (const [id, track] of Object.entries(res.angleTracks)) {
      const node = nodes[id];
      if (node) nodes[id] = { ...node, tracks: { ...node.tracks, angle: track } };
    }
    updateUnifiedCharacter(character.id, {
      nodes,
      chainBakes: { ...(character.chainBakes ?? {}), ...res.records },
    });
    props.setNote(`已烘焙整束 ${strands.length} 根发丝 × ${totalFrames} 帧`);
  };

  const handleRemove = () => {
    const nodes = { ...character.nodes };
    const root = nodes[rootId];
    const allIds = strands?.flat() ?? [];
    for (const id of allIds) delete nodes[id];
    if (root) {
      nodes[rootId] = { ...root, children: (root.children ?? []).filter((ch) => !allIds.includes(ch)) };
    }
    const chainBakes = { ...(character.chainBakes ?? {}) };
    for (const s of strands ?? []) delete chainBakes[s[0]];
    updateUnifiedCharacter(character.id, { nodes, chainBakes });
    props.setNote('已删除发束');
  };

  return (
    <div className="mt-2 pt-2 border-t border-[#1e1e3a] flex flex-col gap-1.5">
      <div className="text-[10px] text-gray-500">毛发（一束独立链，同一烘焙通道）</div>
      {!strands && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-gray-400">
            发丝
            <input type="number" value={props.strands} min={1} max={12}
              onChange={(e) => props.setStrands(Number(e.target.value))}
              className="w-12 bg-[#12122a] border border-[#2a2a4a] rounded px-1 py-0.5 text-gray-200" />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-gray-400">
            节数
            <input type="number" value={props.segs} min={2} max={8}
              onChange={(e) => props.setSegs(Number(e.target.value))}
              className="w-12 bg-[#12122a] border border-[#2a2a4a] rounded px-1 py-0.5 text-gray-200" />
          </label>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={handleGenerate}>
            生成发束
          </Button>
        </div>
      )}
      {strands && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400">发束 {strands.length} 根 × {strands[0].length} 节</span>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={handleBake}>
            烘焙整束（上方参数）
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px] text-red-400" onClick={handleRemove}>
            删除发束
          </Button>
        </div>
      )}
      {strands && (
        <div className={`text-[10px] ${stale.length === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
          {stale.length === 0
            ? `整束已烘焙（${bakedCount}/${strands.length}），与当前驱动一致`
            : `未烘焙/已过期发丝 ${stale.length}/${strands.length} 根，重烘整束即可`}
        </div>
      )}
      {strands && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400">整束驱动：{allRealtime ? '实时模拟' : '烘焙'}</span>
          {allRealtime ? (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setBundleMode('bake')}>
              整束改回烘焙
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setBundleMode('realtime')}>
              整束改用实时模拟
            </Button>
          )}
        </div>
      )}
      {props.note && <div className="text-[10px] text-gray-500">{props.note}</div>}
    </div>
  );
}

function ClothSection(props: {
  character: Character; rootId: string | null | undefined;
  params: ChainBakeParams; totalFrames: number; frameRate: number;
  updateUnifiedCharacter: (id: string, patch: Partial<Character>) => void;
  cols: number; rows: number; setCols: (n: number) => void; setRows: (n: number) => void;
  note: string; setNote: (s: string) => void;
}) {
  const { character, rootId, params, totalFrames, frameRate, updateUnifiedCharacter } = props;
  const grid = useMemo(
    () => (rootId ? detectClothGrid(character, rootId) : null),
    [character, rootId],
  );
  const record = rootId ? character.clothBakes?.[rootId] : undefined;
  const fresh = useMemo(
    () => (record ? isClothBakeFresh(character, record, frameRate) : null),
    [character, record, frameRate],
  );
  if (!rootId) return null;

  const handleGenerate = () => {
    const gen = generateClothGrid(rootId, props.cols, props.rows, 8, 8);
    const root = character.nodes[rootId];
    if (!root) return;
    const nodes = { ...character.nodes, ...gen.nodes };
    nodes[rootId] = {
      ...root,
      children: [...(root.children ?? []), ...gen.gridIds.map((col) => col[0])],
    };
    updateUnifiedCharacter(character.id, { nodes });
    props.setNote(`已生成 ${props.cols} 列 × ${props.rows} 行网格（挂在所选节点下）`);
  };

  const handleBake = () => {
    if (!grid) return;
    const res = bakeClothSwing(character, grid, params, 0, Math.max(0, totalFrames - 1), frameRate);
    const nodes = { ...character.nodes };
    for (const [id, track] of Object.entries(res.angleTracks)) {
      const node = nodes[id];
      if (node) nodes[id] = { ...node, tracks: { ...node.tracks, angle: track } };
    }
    updateUnifiedCharacter(character.id, {
      nodes,
      clothBakes: { ...(character.clothBakes ?? {}), [rootId]: res.record },
    });
    props.setNote(`已烘焙布料 ${grid.length} 列 × ${grid[0].length} 行 × ${totalFrames} 帧`);
  };

  const handleRemove = () => {
    const nodes = { ...character.nodes };
    const root = nodes[rootId];
    const allIds = grid?.flat() ?? record?.gridIds.flat() ?? [];
    for (const id of allIds) delete nodes[id];
    if (root) {
      nodes[rootId] = { ...root, children: (root.children ?? []).filter((ch) => !allIds.includes(ch)) };
    }
    const clothBakes = { ...(character.clothBakes ?? {}) };
    delete clothBakes[rootId];
    updateUnifiedCharacter(character.id, { nodes, clothBakes });
    props.setNote('已删除布料网格');
  };

  return (
    <div className="mt-2 pt-2 border-t border-[#1e1e3a] flex flex-col gap-1.5">
      <div className="text-[10px] text-gray-500">布料（网格链阵，同一烘焙通道）</div>
      {!grid && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-gray-400">
            列
            <input type="number" value={props.cols} min={2} max={8}
              onChange={(e) => props.setCols(Number(e.target.value))}
              className="w-12 bg-[#12122a] border border-[#2a2a4a] rounded px-1 py-0.5 text-gray-200" />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-gray-400">
            行
            <input type="number" value={props.rows} min={2} max={8}
              onChange={(e) => props.setRows(Number(e.target.value))}
              className="w-12 bg-[#12122a] border border-[#2a2a4a] rounded px-1 py-0.5 text-gray-200" />
          </label>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={handleGenerate}>
            生成布料网格
          </Button>
        </div>
      )}
      {grid && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400">网格 {grid.length} 列 × {grid[0].length} 行</span>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={handleBake}>
            烘焙布料（上方参数）
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px] text-red-400" onClick={handleRemove}>
            删除网格
          </Button>
        </div>
      )}
      {record && (
        <div className={`text-[10px] ${fresh ? 'text-emerald-400' : 'text-amber-400'}`}>
          {fresh ? '布料已烘焙，与当前驱动一致' : '布料烘焙已过期：驱动/参数已变化，重烘或删除网格'}
        </div>
      )}
      {props.note && <div className="text-[10px] text-gray-500">{props.note}</div>}
    </div>
  );
}
