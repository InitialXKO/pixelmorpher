'use client';

import React, { useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Shirt,
  X,
  Check,
  Layers,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import SpriteThumb from '../SpriteThumb';
import SpritePicker from '../SpritePicker';
import type {
  Character,
  Node,
  CostumeSet,
  DirectionIndex,
  Sprite,
} from '@/lib/unified-types';
import {
  createDefaultCostumeSet,
} from '@/lib/unified-types';
import { readPieceLayerSpriteId } from '@/lib/store/character-slice';
import { resolvePieceSprite } from '@/lib/sprite-resolve';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const DIRECTIONS: { value: DirectionIndex; label: string }[] = [
  { value: 6, label: '南' },
  { value: 7, label: '东南' },
  { value: 0, label: '东' },
  { value: 1, label: '东北' },
  { value: 2, label: '北' },
  { value: 3, label: '西北' },
  { value: 4, label: '西' },
  { value: 5, label: '西南' },
];

interface DressPanelProps {
  unifiedCharacters: Record<string, Character>;
  /** 可分配的精灵（全局精灵表；父组件由 s.sprites 转换传入） */
  sprites: Sprite[];
  selectedCostumeId: string | null;
  setSelectedCostumeId: (id: string | null) => void;
  selectedNodeId: string | null;
  handleSelectNodeWithSync: (nodeId: string | null) => void;
  /** 隐藏内部节点列表（用共享树） */
  hideNodeList?: boolean;
}

// ---- 镜像/复制生成管理：从同服装其他部位的基础层精灵烘焙派生，写入当前编辑层 ----
function MirrorDeriveSection({
  nodes,
  targetNode,
  getBaseSpriteFor,
  onAssign,
}: {
  nodes: Node[];
  targetNode: Node;
  getBaseSpriteFor: (nodeId: string, dir: DirectionIndex) => Sprite | null;
  onAssign: (dir: DirectionIndex, spriteId: string) => void;
}) {
  const [dir, setDir] = useState<DirectionIndex>(6);
  const [sourceId, setSourceId] = useState<string>('');
  const [axis, setAxis] = useState(90);
  const [darkenOn, setDarkenOn] = useState(false);
  const [darken, setDarken] = useState(0.7);
  const candidates = nodes.filter((n) => n.id !== targetNode.id && getBaseSpriteFor(n.id, dir));
  const effectiveSource = candidates.some((c) => c.id === sourceId) ? sourceId : (candidates[0]?.id ?? '');
  const handleDerive = (mode: 'copy' | 'mirror') => {
    const srcNode = candidates.find((c) => c.id === effectiveSource);
    if (!srcNode) return;
    const srcSprite = getBaseSpriteFor(srcNode.id, dir);
    if (!srcSprite?.id) return;
    const derived = useProjectStore.getState().deriveSpriteFrom(srcSprite.id, {
      mode,
      axisDeg: axis,
      darken: darkenOn ? darken : 1,
      name: `${mode === 'mirror' ? '镜像' : '复制'}_${targetNode.name}`,
    });
    if (derived?.id) onAssign(dir, derived.id);
  };
  const selectCls =
    'bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-1 text-[10px] text-gray-300';
  return (
    <div className="bg-[#080818] rounded border border-[#1e1e3a] p-2 space-y-2">
      <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
        {targetNode.name} — 复制/镜像生成（烘焙式）
      </Label>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-500 shrink-0">方向</span>
        <select
          value={dir}
          onChange={(e) => setDir(Number(e.target.value) as DirectionIndex)}
          className={selectCls}
        >
          {DIRECTIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <select
          value={effectiveSource}
          onChange={(e) => setSourceId(e.target.value)}
          className={`${selectCls} flex-1 min-w-0`}
        >
          {candidates.length === 0 && <option value="">无可用源（同方向基础层）</option>}
          {candidates.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-500 shrink-0">镜像轴</span>
        {([[90, '竖直'], [0, '水平'], [45, '主对角'], [135, '副对角']] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setAxis(v)}
            className={`h-5 px-1.5 text-[10px] rounded border ${axis === v ? 'border-cyan-400 text-cyan-300' : 'border-[#2a2a4a] text-gray-400'}`}
          >
            {label}
          </button>
        ))}
        <input
          type="number"
          value={axis}
          onChange={(e) => setAxis(parseFloat(e.target.value) || 0)}
          className="h-6 w-14 px-1 text-[10px] bg-[#0a0a1a] border border-[#2a2a4a] rounded text-gray-300"
          title="自定义轴向角（度）：预设轴按整图翻转，任意角绕源锚点"
        />
        <span className="text-[10px] text-gray-500">°</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-[10px] text-gray-400">
          <input type="checkbox" checked={darkenOn} onChange={(e) => setDarkenOn(e.target.checked)} />
          压暗
        </label>
        <input
          type="range"
          min={0.3}
          max={1}
          step={0.05}
          value={darken}
          disabled={!darkenOn}
          onChange={(e) => setDarken(parseFloat(e.target.value))}
          className="flex-1 h-1"
        />
        <span className="text-[10px] text-gray-500 w-8 text-right">{Math.round(darken * 100)}%</span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1 h-6 text-[10px]" disabled={!effectiveSource} onClick={() => handleDerive('copy')}>
          复制生成
        </Button>
        <Button size="sm" variant="outline" className="flex-1 h-6 text-[10px]" disabled={!effectiveSource} onClick={() => handleDerive('mirror')}>
          镜像生成
        </Button>
      </div>
      <p className="text-[9px] leading-relaxed text-gray-600">
        源取同服装基础层同方向精灵，生成后写入当前编辑层；源后续修改不跟随。
      </p>
    </div>
  );
}

/**
 * DressPanel — 穿衣阶段（新模型）。
 * 节点驱动：选角色 → 选服装集 → 选节点 → 给八个方向配精灵。
 * 写入 Character.sprites 表 + CostumeSet.pieces（SpriteRef），不再用 spriteMap。
 */

/** 精灵缩略图已收拢为共用组件 SpriteThumb（对象身份缓存 + 等比适配） */

export default function DressPanel({
  unifiedCharacters,
  sprites,
  selectedCostumeId,
  setSelectedCostumeId,
  selectedNodeId,
  handleSelectNodeWithSync,
  hideNodeList = false,
}: DressPanelProps) {
  // 角色：unifiedCharacters 以 skeletonId 为 key
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const updateUnifiedCharacter = useProjectStore((s) => s.updateUnifiedCharacter);

  const selectedCharacter = useMemo(() => {
    if (!activePuppetSkeletonId) return null;
    return unifiedCharacters[activePuppetSkeletonId] ?? null;
  }, [unifiedCharacters, activePuppetSkeletonId]);

  const characterNodes = useMemo(
    () => (selectedCharacter ? Object.values(selectedCharacter.nodes) : []),
    [selectedCharacter]
  );

  const costumeSets = selectedCharacter?.costumeSets ?? [];
  // 不用 memo，直接算，确保每次渲染都是最新
  const selectedCostume = costumeSets.find((cs) => cs.id === selectedCostumeId) ?? costumeSets[0] ?? null;

  const selectedNode = useMemo(
    () => (selectedNodeId ? (selectedCharacter?.nodes[selectedNodeId] ?? null) : null),
    [selectedCharacter, selectedNodeId]
  );

  // ---- 通用变体（服装槽级） ----
  const variantDefs = selectedCharacter?.variantDefs ?? [];
  // 编辑维度：null = 基础层；否则配图写进该变体的 variantSprites 层
  const [editVariantIdRaw, setEditVariantId] = useState<string | null>(null);
  const editVariantId = editVariantIdRaw && variantDefs.some((v) => v.id === editVariantIdRaw) ? editVariantIdRaw : null;
  const editVariant = variantDefs.find((v) => v.id === editVariantId) ?? null;

  // ---- Handlers ----
  const handleAddCostume = () => {
    if (!selectedCharacter || !activePuppetSkeletonId) return;
    const store = useProjectStore.getState();
    store.pushUndo('添加服装集');
    const newSet = createDefaultCostumeSet(
      crypto.randomUUID(),
      `服装${costumeSets.length + 1}`
    );
    updateUnifiedCharacter(activePuppetSkeletonId, {
      costumeSets: [...selectedCharacter.costumeSets, newSet],
    });
    setSelectedCostumeId(newSet.id);
  };

  const handleSetActiveCostume = (costumeId: string) => {
    if (!selectedCharacter || !activePuppetSkeletonId) return;
    if (selectedCharacter.activeCostumeSetId === costumeId) return;
    const store = useProjectStore.getState();
    store.pushUndo('设为生效服装');
    // 主渲染（generateRenderPlan/resolveSprite）与画布命中都读 activeCostumeSetId；
    // 同时把面板编辑对象切到该集，避免「编辑的」与「生效的」不一致
    updateUnifiedCharacter(activePuppetSkeletonId, { activeCostumeSetId: costumeId });
    setSelectedCostumeId(costumeId);
  };

  const handleDeleteCostume = (costumeId: string) => {
    if (!selectedCharacter || !activePuppetSkeletonId) return;
    const cs = selectedCharacter.costumeSets.find((s) => s.id === costumeId);
    if (!confirm(`删除服装集「${cs?.name ?? ''}」（含全部方向精灵分配）？`)) return;
    const store = useProjectStore.getState();
    store.pushUndo('删除服装集');
    const remaining = selectedCharacter.costumeSets.filter((cs) => cs.id !== costumeId);
    updateUnifiedCharacter(activePuppetSkeletonId, {
      costumeSets: remaining,
      // 如果删除的是激活服装，切换到第一个
      ...(selectedCharacter.activeCostumeSetId === costumeId
        ? { activeCostumeSetId: remaining[0]?.id }
        : {}),
    });
    if (selectedCostumeId === costumeId) {
      setSelectedCostumeId(null);
    }
  };

  // ---- 变体 handlers ----
  const handleAddVariant = () => {
    if (!selectedCharacter || !activePuppetSkeletonId) return;
    const store = useProjectStore.getState();
    store.pushUndo('添加变体');
    const def = { id: crypto.randomUUID(), name: `变体${variantDefs.length + 1}` };
    updateUnifiedCharacter(activePuppetSkeletonId, {
      variantDefs: [...variantDefs, def],
    });
    setEditVariantId(def.id);
  };

  const handleRenameVariant = (variantId: string) => {
    if (!selectedCharacter || !activePuppetSkeletonId) return;
    const def = variantDefs.find((v) => v.id === variantId);
    if (!def) return;
    const name = prompt('变体名称（如：破损、湿透、燃烧）', def.name)?.trim();
    if (!name || name === def.name) return;
    const store = useProjectStore.getState();
    store.pushUndo('变体改名');
    updateUnifiedCharacter(activePuppetSkeletonId, {
      variantDefs: variantDefs.map((v) => (v.id === variantId ? { ...v, name } : v)),
    });
  };

  const handleDeleteVariant = (variantId: string) => {
    if (!selectedCharacter || !activePuppetSkeletonId) return;
    const def = variantDefs.find((v) => v.id === variantId);
    if (!confirm(`删除变体「${def?.name ?? ''}」？全部服装集里的该变体精灵与部位指派将一并清除（基础精灵不受影响）。`)) return;
    const store = useProjectStore.getState();
    store.pushUndo('删除变体');
    // 清理三处引用：各集 piece 的 variantSprites[id]、服装槽指派、定义本身
    const newCostumeSets = selectedCharacter.costumeSets.map((cs) => {
      let touched = false;
      const pieces: Record<string, CostumeSet['pieces'][string]> = {};
      for (const [key, piece] of Object.entries(cs.pieces)) {
        if (piece.variantSprites && variantId in piece.variantSprites) {
          touched = true;
          const variantSprites = { ...piece.variantSprites };
          delete variantSprites[variantId];
          pieces[key] = { ...piece, variantSprites };
        } else {
          pieces[key] = piece;
        }
      }
      return touched ? { ...cs, pieces } : cs;
    });
    const newSlotVariants: Record<string, string> = {};
    for (const [k, v] of Object.entries(selectedCharacter.slotVariants ?? {})) {
      if (v !== variantId) newSlotVariants[k] = v;
    }
    updateUnifiedCharacter(activePuppetSkeletonId, {
      variantDefs: variantDefs.filter((v) => v.id !== variantId),
      costumeSets: newCostumeSets,
      slotVariants: newSlotVariants,
    });
    if (editVariantId === variantId) setEditVariantId(null);
  };

  /** 堆叠层厚（作用于全部服装集的此部位——同一摞层图被各集共享，
   * 层厚是摞本身的属性，不是某一集的穿法） */
  const handleStackThickness = (node: Node, value: number) => {
    if (!selectedCharacter || !activePuppetSkeletonId || !Number.isFinite(value)) return;
    const slotKey = node.slot?.slotKey ?? node.id;
    const v = Math.min(64, Math.max(0.5, value));
    const store = useProjectStore.getState();
    store.pushUndo('改堆叠层厚');
    const newCostumeSets = selectedCharacter.costumeSets.map((cs) => {
      const piece = cs.pieces[slotKey];
      if (!piece?.stack) return cs;
      return { ...cs, pieces: { ...cs.pieces, [slotKey]: { ...piece, stack: { ...piece.stack, layerThickness: v } } } };
    });
    updateUnifiedCharacter(activePuppetSkeletonId, { costumeSets: newCostumeSets });
  };

  /** 删除整摞：清全部服装集此部位的 stack + 删除全部层图（一条撤销） */
  const handleDeleteStack = (node: Node) => {
    if (!selectedCharacter || !activePuppetSkeletonId) return;
    const slotKey = node.slot?.slotKey ?? node.id;
    const layerIds = new Set<string>();
    for (const cs of selectedCharacter.costumeSets) {
      const st = cs.pieces[slotKey]?.stack;
      if (st) for (const id of st.layerSpriteIds) layerIds.add(id);
    }
    if (!confirm(`删除此部位的精灵堆叠？全部服装集的堆叠将清除，${layerIds.size} 张层图将一并删除（方向平面图不受影响）。`)) return;
    const store = useProjectStore.getState();
    // removeSprites 压唯一的撤销记录（快照在任何改动之前），角色侧随后写
    store.removeSprites([...layerIds], '删除整摞');
    const newCostumeSets = selectedCharacter.costumeSets.map((cs) => {
      const piece = cs.pieces[slotKey];
      if (!piece?.stack) return cs;
      const next = { ...piece };
      delete next.stack;
      return { ...cs, pieces: { ...cs.pieces, [slotKey]: next } };
    });
    updateUnifiedCharacter(activePuppetSkeletonId, { costumeSets: newCostumeSets });
  };

  /** 服装槽变体指派：'' = 基础（删条目） */
  const handleSlotVariantChange = (node: Node, variantId: string) => {
    if (!selectedCharacter || !activePuppetSkeletonId) return;
    const slotKey = node?.slot?.slotKey ?? node.id;
    const store = useProjectStore.getState();
    store.pushUndo('指派部位变体');
    const slotVariants = { ...(selectedCharacter.slotVariants ?? {}) };
    if (variantId) slotVariants[slotKey] = variantId;
    else delete slotVariants[slotKey];
    updateUnifiedCharacter(activePuppetSkeletonId, { slotVariants });
  };

  const handleSpriteAssign = (nodeId: string, direction: DirectionIndex, spriteId: string | null) => {
    if (!selectedCharacter || !activePuppetSkeletonId || !selectedCostume) return;
    if (spriteId && !sprites.some((s) => s.id === spriteId)) return;
    const store = useProjectStore.getState();
    store.pushUndo('分配精灵', 'assignSprite');
    // 走分层写入口（与装配/遮罩同一套 applySpriteToPieceLayer：层序、顺带指派
    // 口径一致）。此前本面板手写拼 sprites/variantSprites，与主口径双实现漂移
    // （审计 F-16）。面板无纬度编辑维度，纬度恒 0；变体层由 editVariantId 决定。
    store.setUnifiedCostumeSpriteLayered(
      activePuppetSkeletonId,
      selectedCostume.id,
      nodeId,
      direction,
      spriteId,
      { variantId: editVariantId },
    );
  };

  /** 全局精灵表（sprites prop 数组 → id 表），供共享解析函数查内嵌/引用 */
  const spritesTable = useMemo(() => {
    const table: Record<string, Sprite> = {};
    for (const sp of sprites) if (sp.id) table[sp.id] = sp;
    return table;
  }, [sprites]);

  /** 当前编辑层（基础/变体）下某节点某方向的精灵 id：读侧孪生精确读，
   * 内嵌 Sprite 形态（旧数据）也认（此前手写读不认、面板显示为空而渲染有图） */
  const getLayerSpriteIdFor = (nodeId: string, direction: DirectionIndex): string | null => {
    if (!selectedCostume || !selectedCharacter) return null;
    const node = selectedCharacter.nodes[nodeId];
    const slotKey = node?.slot?.slotKey ?? nodeId;
    const piece = selectedCostume.pieces[slotKey];
    if (!piece) return null;
    return readPieceLayerSpriteId(piece, direction, { variantId: editVariantId });
  };

  /** 当前编辑层下某节点某方向的精灵（精确读本层，不含回落） */
  const getSpriteFor = (nodeId: string, direction: DirectionIndex): Sprite | null => {
    const id = getLayerSpriteIdFor(nodeId, direction);
    return id ? (spritesTable[id] ?? null) : null;
  };

  /** 当前编辑层渲染回落图：本层无图时按共享解析（变体镜像→基础直达→基础镜像）
   * 找实际会显示的图；mirror 标记供 UI 区分「镜像回落」与「回落基础」 */
  const getFallbackSpriteFor = (
    nodeId: string,
    direction: DirectionIndex,
  ): { sprite: Sprite; mirror: boolean } | null => {
    if (!selectedCostume || !selectedCharacter) return null;
    if (getLayerSpriteIdFor(nodeId, direction)) return null;
    const node = selectedCharacter.nodes[nodeId];
    const slotKey = node?.slot?.slotKey ?? nodeId;
    const piece = selectedCostume.pieces[slotKey];
    if (!piece) return null;
    const resolved = resolvePieceSprite(piece, direction, editVariantId ?? undefined, spritesTable);
    if (!resolved.sprite) return null;
    return { sprite: resolved.sprite, mirror: resolved.mirror };
  };

  /** 基础层精灵（镜像派生源等用）：读侧孪生精确读基础层 */
  const getBaseSpriteFor = (nodeId: string, direction: DirectionIndex): Sprite | null => {
    if (!selectedCostume || !selectedCharacter) return null;
    const node = selectedCharacter.nodes[nodeId];
    const slotKey = node?.slot?.slotKey ?? nodeId;
    const piece = selectedCostume.pieces[slotKey];
    if (!piece) return null;
    const id = readPieceLayerSpriteId(piece, direction);
    return id ? (spritesTable[id] ?? null) : null;
  };

  return (
    <div className="space-y-3">
      {/* 角色：用左侧选中的骨架对应的角色，不再重复选择 */}
      {/* 服装集 */}
      {selectedCharacter && (
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
              <Shirt className="size-3 inline mr-1" />
              服装集
            </Label>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-cyan-400 hover:text-cyan-300"
              onClick={handleAddCostume}
              title="添加服装集"
            >
              <Plus className="size-3" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {costumeSets.map((cs) => {
              const isActive = selectedCharacter.activeCostumeSetId === cs.id;
              return (
              <div
                key={cs.id}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] cursor-pointer border ${
                  selectedCostume?.id === cs.id
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                    : 'bg-[#111128] border-[#1e1e3a] text-gray-400 hover:border-gray-600'
                } ${isActive ? 'ring-1 ring-emerald-500/60' : ''}`}
                onClick={() => setSelectedCostumeId(cs.id)}
                title={isActive ? '主渲染生效中（点击切换面板编辑对象）' : '点击切换面板编辑对象'}
              >
                <span>{cs.name}</span>
                {isActive ? (
                  <span className="flex items-center gap-0.5 text-emerald-400" title="主渲染生效中">
                    <Check className="size-3" />
                    生效中
                  </span>
                ) : (
                  <button
                    className="px-1 rounded bg-emerald-500/15 text-emerald-300/90 hover:bg-emerald-500/30 hover:text-emerald-200"
                    title="设为主渲染生效的服装集"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSetActiveCostume(cs.id);
                    }}
                  >
                    设为生效
                  </button>
                )}
                {costumeSets.length > 1 && (
                  <X
                    className="size-3 hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCostume(cs.id);
                    }}
                  />
                )}
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 通用变体（服装槽级）：选编辑维度后配图写进变体层；部位指派决定渲染用哪层 */}
      {selectedCharacter && (
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
              <Layers className="size-3 inline mr-1" />
              变体（部位状态）
            </Label>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-purple-400 hover:text-purple-300"
              onClick={handleAddVariant}
              title="添加变体（名称自定义，如破损/湿透）"
            >
              <Plus className="size-3" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] cursor-pointer border ${
                editVariantId === null
                  ? 'bg-purple-500/20 border-purple-500/50 text-purple-200'
                  : 'bg-[#111128] border-[#1e1e3a] text-gray-400 hover:border-gray-600'
              }`}
              onClick={() => setEditVariantId(null)}
              title="编辑基础层精灵"
            >
              基础
            </div>
            {variantDefs.map((v) => (
              <div
                key={v.id}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] cursor-pointer border ${
                  editVariantId === v.id
                    ? 'bg-purple-500/20 border-purple-500/50 text-purple-200'
                    : 'bg-[#111128] border-[#1e1e3a] text-gray-400 hover:border-gray-600'
                }`}
                onClick={() => setEditVariantId(v.id)}
                title="点击切换到此变体的编辑层"
              >
                <span>{v.name}</span>
                {editVariantId === v.id && (
                  <button
                    className="text-purple-300/80 hover:text-purple-100"
                    title="改名"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRenameVariant(v.id);
                    }}
                  >
                    改名
                  </button>
                )}
                <X
                  className="size-3 hover:text-red-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteVariant(v.id);
                  }}
                />
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-600 mt-1 leading-relaxed">
            {editVariant
              ? `正在编辑「${editVariant.name}」层：配图只写变体层，未画的方向渲染时回落基础图。`
              : '正在编辑基础层。变体是部位级状态（全身切换用服装集）；在下方选节点可指派该部位的变体。'}
          </p>
        </div>
      )}

      {/* 节点列表（hideNodeList 时用共享树） */}
      {!hideNodeList && selectedCharacter && selectedCostume && (
        <div>
          <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
            节点（{characterNodes.length}）
          </Label>
          <div className="bg-[#080818] rounded border border-[#1e1e3a] p-1 max-h-40 overflow-y-auto mt-1">
            {characterNodes.map((node) => {
              const hasSprite = DIRECTIONS.some((d) => getSpriteFor(node.id, d.value));
              const assignedVariant = variantDefs.find(
                (v) => v.id === selectedCharacter.slotVariants?.[node.slot?.slotKey ?? node.id],
              );
              return (
                <div
                  key={node.id}
                  onClick={() => handleSelectNodeWithSync(node.id)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-[11px] cursor-pointer ${
                    selectedNodeId === node.id
                      ? 'bg-cyan-500/20 text-cyan-300'
                      : 'text-gray-400 hover:bg-white/5'
                  }`}
                >
                  <span className="flex-1 truncate">{node.name}</span>
                  {assignedVariant && (
                    <span className="text-[9px] text-purple-300 flex-shrink-0" title="此部位已指派变体（主渲染生效）">
                      {assignedVariant.name}
                    </span>
                  )}
                  {hasSprite && (
                    <span className="size-1.5 rounded-full bg-emerald-400" title="当前编辑层已配精灵" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 部位变体指派 + 方向精灵分配 */}
      {selectedNode && selectedCostume && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <span className="flex-shrink-0">此部位变体</span>
            <select
              value={selectedCharacter?.slotVariants?.[selectedNode.slot?.slotKey ?? selectedNode.id] ?? ''}
              onChange={(e) => handleSlotVariantChange(selectedNode, e.target.value)}
              className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-1 text-[10px] text-gray-300"
              title="指派后主渲染该部位用变体层精灵（未画方向回落基础）；与当前编辑哪层无关"
            >
              <option value="">基础（无变体）</option>
              {variantDefs.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <DirectionSpriteEditor
            node={selectedNode}
            sprites={sprites}
            getSpriteFor={getSpriteFor}
            getFallbackSpriteFor={getFallbackSpriteFor}
            layerLabel={editVariant?.name}
            onAssign={(dir, spriteId) => handleSpriteAssign(selectedNode.id, dir, spriteId)}
          />
          <MirrorDeriveSection
            nodes={characterNodes}
            targetNode={selectedNode}
            getBaseSpriteFor={getBaseSpriteFor}
            onAssign={(dir, spriteId) => handleSpriteAssign(selectedNode.id, dir, spriteId)}
          />
          {selectedCostume.pieces[selectedNode.slot?.slotKey ?? selectedNode.id]?.stack && (() => {
            const stack = selectedCostume.pieces[selectedNode.slot?.slotKey ?? selectedNode.id]!.stack!;
            return (
              <div className="rounded border border-[#1e1e3a] bg-[#0a0a1a] p-2 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                  <span className="flex-1">精灵堆叠（{stack.layerSpriteIds.length} 层，呈现按 3D 朝向逐层合成）</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <span className="flex-shrink-0">层厚（px）</span>
                  <input
                    key={`${selectedNode.id}:${stack.layerThickness}`}
                    type="number"
                    min={0.5}
                    max={64}
                    step={0.5}
                    defaultValue={stack.layerThickness}
                    onBlur={(e) => handleStackThickness(selectedNode, Number(e.target.value))}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-16 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[10px] text-gray-300"
                    title="层与层沿部件主轴的间距；改动作用于全部服装集的此部位"
                  />
                  <span className="text-gray-600">回车/失焦生效</span>
                </div>
                <button
                  onClick={() => handleDeleteStack(selectedNode)}
                  className="text-[10px] px-1.5 py-1 rounded border border-red-900/60 text-red-400 hover:bg-red-950/40"
                  title="清除全部服装集此部位的堆叠并删除全部层图"
                >
                  删除整摞
                </button>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ---- 八方向精灵编辑器 ----
function DirectionSpriteEditor({
  node,
  sprites,
  getSpriteFor,
  getFallbackSpriteFor,
  layerLabel,
  onAssign,
}: {
  node: Node;
  sprites: Sprite[];
  getSpriteFor: (nodeId: string, dir: DirectionIndex) => Sprite | null;
  /** 本层无图时按共享解析找到的实际显示图（半透明显示）：变体回落基础、
   * 或同层/基础层镜像回落，mirror 标记区分徽标文案 */
  getFallbackSpriteFor?: (
    nodeId: string,
    dir: DirectionIndex,
  ) => { sprite: Sprite; mirror: boolean } | null;
  /** 当前编辑层名称（变体名）；undefined = 基础层 */
  layerLabel?: string;
  onAssign: (dir: DirectionIndex, spriteId: string | null) => void;
}) {
  const [pickerDir, setPickerDir] = useState<DirectionIndex | null>(null);

  return (
    <div className="bg-[#080818] rounded border border-[#1e1e3a] p-2">
      <Label className="text-[10px] text-gray-500 uppercase tracking-wider">
        {node.name} — 方向精灵
        {layerLabel && <span className="text-purple-300 normal-case">（变体：{layerLabel}）</span>}
      </Label>
      <div className="grid grid-cols-2 gap-1.5 mt-1.5">
        {DIRECTIONS.map(({ value, label }) => {
          const sprite = getSpriteFor(node.id, value);
          const fallback = !sprite && getFallbackSpriteFor ? getFallbackSpriteFor(node.id, value) : null;
          return (
            <div
              key={value}
              className="bg-[#111128] rounded border border-[#1e1e3a] p-1.5"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-gray-500">{label} ({value})</span>
                {fallback && (
                  <span
                    className="text-[8px] text-gray-600"
                    title={fallback.mirror ? '此方向未配图，渲染按镜像映射回落此图' : '此方向未配图，渲染回落此基础图'}
                  >
                    {fallback.mirror ? '镜像回落' : '回落基础'}
                  </span>
                )}
                {sprite && (
                  <X
                    className="size-3 text-gray-600 hover:text-red-400 cursor-pointer"
                    onClick={() => onAssign(value, null)}
                  />
                )}
              </div>
              <div
                onClick={() => setPickerDir(pickerDir === value ? null : value)}
                className="h-12 rounded bg-black/30 border border-dashed border-gray-700 flex items-center justify-center cursor-pointer hover:border-cyan-500/50 overflow-hidden"
              >
                {sprite ? (
                  <SpriteThumb sprite={sprite} size={40} />
                ) : fallback ? (
                  <div className={`opacity-40 ${fallback.mirror ? '-scale-x-100' : ''}`}>
                    <SpriteThumb sprite={fallback.sprite} size={40} />
                  </div>
                ) : (
                  <Plus className="size-4 text-gray-700" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 精灵选择器（共用组件 SpritePicker：搜索 + 缩略图网格） */}
      {pickerDir !== null && (
        <div className="mt-2 bg-[#111128] rounded border border-[#1e1e3a] p-1.5">
          <div className="text-[9px] text-gray-600 mb-1">
            选择精灵 → {DIRECTIONS.find((d) => d.value === pickerDir)?.label}
          </div>
          <SpritePicker
            sprites={sprites}
            groupBy={(sp) => sp.folder ?? ''}
            onPick={(spriteId) => {
              onAssign(pickerDir, spriteId);
              setPickerDir(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
