'use client';

import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Shirt,
  X,
  Check,
  Layers,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type {
  Character,
  Node,
  CostumeSet,
  DirectionIndex,
  Sprite,
} from '@/lib/unified-types';
import {
  createDefaultCostumeSet,
  createDefaultCostumePiece,
} from '@/lib/unified-types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const DIRECTIONS: { value: DirectionIndex; label: string }[] = [
  { value: 6, label: '南' },
  { value: 0, label: '东' },
  { value: 4, label: '西' },
  { value: 2, label: '北' },
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
 * 节点驱动：选角色 → 选服装集 → 选节点 → 给四个方向配精灵。
 * 写入 Character.sprites 表 + CostumeSet.pieces（SpriteRef），不再用 spriteMap。
 */

/** 精灵缩略图：canvas 绘制 PixelGrid */
function SpriteThumbnail({ sprite, size = 32 }: { sprite: Sprite; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sprite.data) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = sprite.width, h = sprite.height;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = sprite.data[y]?.[x];
        if (c && c !== '#00000000' && !c.endsWith('00')) {
          ctx.fillStyle = c;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }, [sprite]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
      className="rounded bg-black/50"
    />
  );
}

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

  // ---- 通用变体（槽位级） ----
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
    // 清理三处引用：各集 piece 的 variantSprites[id]、槽位指派、定义本身
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

  /** 槽位变体指派：'' = 基础（删条目） */
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
    const store = useProjectStore.getState();
    store.pushUndo('分配精灵', 'assignSprite');

    const pieces = { ...selectedCostume.pieces };
    // 用 slotKey（不是 nodeId）——渲染器按 costumeSet.pieces[node.slot.slotKey] 查找
    const node = selectedCharacter.nodes[nodeId];
    const slotKey = node?.slot?.slotKey ?? nodeId;

    if (spriteId) {
      // Sprite 在全局表（sprites prop），直接引用 ID，不复制
      const sp = sprites.find((s) => s.id === spriteId);
      if (!sp) return;
      const key = sp.id ?? spriteId;
      const piece = pieces[slotKey] ?? createDefaultCostumePiece(slotKey);
      if (editVariantId) {
        // 变体层：写入 pieces[slotKey].variantSprites[editVariantId][direction]
        const layer = { ...(piece.variantSprites?.[editVariantId] ?? {}), [direction]: { spriteId: key } };
        pieces[slotKey] = {
          ...piece,
          variantSprites: { ...piece.variantSprites, [editVariantId]: layer },
        };
      } else {
        // 基础层：写入 pieces[slotKey].sprites[direction] = { spriteId }
        pieces[slotKey] = {
          ...piece,
          sprites: { ...piece.sprites, [direction]: { spriteId: key } },
        };
      }
    } else {
      // 删除分配（当前编辑层内）
      const piece = pieces[slotKey];
      if (piece) {
        if (editVariantId) {
          const layer = { ...(piece.variantSprites?.[editVariantId] ?? {}) };
          delete layer[direction];
          pieces[slotKey] = {
            ...piece,
            variantSprites: { ...piece.variantSprites, [editVariantId]: layer },
          };
        } else {
          const newSprites = { ...piece.sprites };
          delete newSprites[direction];
          pieces[slotKey] = { ...piece, sprites: newSprites };
        }
      }
    }

    const newCostumeSets = selectedCharacter.costumeSets.map((cs) =>
      cs.id === selectedCostume.id ? { ...cs, pieces } : cs
    );
    updateUnifiedCharacter(activePuppetSkeletonId, {
      costumeSets: newCostumeSets,
    });
  };

  /** 当前编辑层（基础/变体）下某节点某方向的精灵 */
  const getSpriteFor = (nodeId: string, direction: DirectionIndex): Sprite | null => {
    if (!selectedCostume || !selectedCharacter) return null;
    const node = selectedCharacter.nodes[nodeId];
    const slotKey = node?.slot?.slotKey ?? nodeId;
    const piece = selectedCostume.pieces[slotKey];
    const ref = editVariantId
      ? piece?.variantSprites?.[editVariantId]?.[direction]
      : piece?.sprites[direction];
    if (!ref) return null;
    // SpriteRef → spriteId → 全局精灵表（sprites prop）
    const spriteId = 'spriteId' in ref ? ref.spriteId : null;
    if (!spriteId) return null;
    return sprites.find((s) => s.id === spriteId) ?? null;
  };

  /** 基础层精灵（变体编辑时显示回落来源用） */
  const getBaseSpriteFor = (nodeId: string, direction: DirectionIndex): Sprite | null => {
    if (!selectedCostume || !selectedCharacter) return null;
    const node = selectedCharacter.nodes[nodeId];
    const slotKey = node?.slot?.slotKey ?? nodeId;
    const ref = selectedCostume.pieces[slotKey]?.sprites[direction];
    if (!ref) return null;
    const spriteId = 'spriteId' in ref ? ref.spriteId : null;
    if (!spriteId) return null;
    return sprites.find((s) => s.id === spriteId) ?? null;
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

      {/* 通用变体（槽位级）：选编辑维度后配图写进变体层；部位指派决定渲染用哪层 */}
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
            getBaseSpriteFor={editVariant ? getBaseSpriteFor : undefined}
            layerLabel={editVariant?.name}
            onAssign={(dir, spriteId) => handleSpriteAssign(selectedNode.id, dir, spriteId)}
          />
          <MirrorDeriveSection
            nodes={characterNodes}
            targetNode={selectedNode}
            getBaseSpriteFor={getBaseSpriteFor}
            onAssign={(dir, spriteId) => handleSpriteAssign(selectedNode.id, dir, spriteId)}
          />
        </div>
      )}
    </div>
  );
}

// ---- 四方向精灵编辑器 ----
function DirectionSpriteEditor({
  node,
  sprites,
  getSpriteFor,
  getBaseSpriteFor,
  layerLabel,
  onAssign,
}: {
  node: Node;
  sprites: Sprite[];
  getSpriteFor: (nodeId: string, dir: DirectionIndex) => Sprite | null;
  /** 变体编辑时传入：显示回落的基础图（半透明） */
  getBaseSpriteFor?: (nodeId: string, dir: DirectionIndex) => Sprite | null;
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
          const baseSprite = !sprite && getBaseSpriteFor ? getBaseSpriteFor(node.id, value) : null;
          return (
            <div
              key={value}
              className="bg-[#111128] rounded border border-[#1e1e3a] p-1.5"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-gray-500">{label} ({value})</span>
                {baseSprite && (
                  <span className="text-[8px] text-gray-600" title="变体未画此方向，渲染回落此基础图">回落基础</span>
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
                  <SpriteThumbnail sprite={sprite} size={40} />
                ) : baseSprite ? (
                  <div className="opacity-40">
                    <SpriteThumbnail sprite={baseSprite} size={40} />
                  </div>
                ) : (
                  <Plus className="size-4 text-gray-700" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 精灵选择器 */}
      {pickerDir !== null && (
        <div className="mt-2 bg-[#111128] rounded border border-[#1e1e3a] p-1.5 max-h-40 overflow-y-auto">
          <div className="text-[9px] text-gray-600 mb-1">
            选择精灵 → {DIRECTIONS.find((d) => d.value === pickerDir)?.label}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {sprites.map((sp) => (
              <div
                key={sp.id ?? sp.name}
                onClick={() => {
                  onAssign(pickerDir, sp.id ?? null);
                  setPickerDir(null);
                }}
                className="p-1 rounded bg-black/30 hover:bg-cyan-500/20 cursor-pointer flex flex-col items-center gap-0.5"
                title={sp.name ?? sp.id}
              >
                <SpriteThumbnail sprite={sp} size={36} />
                <span className="text-[8px] text-gray-400 truncate w-full text-center">{sp.name ?? sp.id?.slice(0, 12)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
