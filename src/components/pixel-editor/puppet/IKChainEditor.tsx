'use client';

// ============================================================
// IKChainEditor — IK 链创建/管理 UI
// 选根关节 → 选末端 → 自动按父链成链 → 加到 character.ikChains
// ============================================================

import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Power, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/lib/store';
import { computeIKChainTip, getIKChainJointIds } from '@/lib/ik-tip';
import { resolveChainTarget3D, ikTargetMirror, subToPx } from '@/lib/unified-types';
import { computeWorldTransforms } from '@/lib/unified-render';
import type { Character, IKChain } from '@/lib/unified-types';
import { Vec3Field } from '../shared/Vec3Field';
import type { BlueprintGraph } from '@/lib/blueprint/ir';
import BlueprintEditor from './BlueprintEditor';

interface IKChainEditorProps {
  character: Character | null;
}

export default function IKChainEditor({ character }: IKChainEditorProps) {
  const updateUnifiedCharacter = useProjectStore((s) => s.updateUnifiedCharacter);
  const [rootId, setRootId] = useState<string>('');
  const [endId, setEndId] = useState<string>('');
  const [editingTargetChainId, setEditingTargetChainId] = useState<string | null>(null);

  /** 为链创建默认目标蓝图（源变换节点 + 输出节点） */
  const createDefaultTargetBlueprint = (chain: IKChain): BlueprintGraph => {
    // 蓝图里用原点中心世界坐标（与 target3D 同空间，渲染世界 Y 向下存；
    // 目标蓝图编辑器按展示空间 X东/Y上/Z南 翻转显示）；填充按链根节点朝向反投影
    const store = useProjectStore.getState();
    const rootVariant = character?.nodes[chain.rootNodeId]?.transform.variantIndex ?? 6;
    const t3 = resolveChainTarget3D(chain, store.canvasWidth, store.canvasHeight, rootVariant);
    const lx = t3.x;
    const ly = t3.y;
    const lz = t3.z;
    const sourceId = `target_src_${chain.id}`;
    const outId = `target_out_${chain.id}`;
    return {
      version: 1,
      nodes: [
        {
          id: sourceId,
          type: 'transform',
          inputs: {},
          params: {
            translateX: lx,
            translateY: ly,
            translateZ: lz,
            _label: '源-拖放位置',
          },
          ui: { x: 50, y: 100 },
        },
        {
          id: outId,
          type: 'transform',
          inputs: {
            translateX: { nodeId: sourceId, output: 'translateX' },
            translateY: { nodeId: sourceId, output: 'translateY' },
            translateZ: { nodeId: sourceId, output: 'translateZ' },
          },
          params: {
            _label: '输出-目标点',
          },
          ui: { x: 300, y: 100 },
        },
      ],
      outputId: outId,
    };
  };

  const handleTargetBlueprintChange = (chainId: string, graph: BlueprintGraph) => {
    if (!character) return;
    updateUnifiedCharacter(character.id, {
      ikChains: chains.map((c) => (c.id === chainId ? { ...c, targetBlueprint: graph } : c)),
    });
  };

  const handleClearTargetBlueprint = (chainId: string) => {
    if (!character) return;
    updateUnifiedCharacter(character.id, {
      ikChains: chains.map((c) => {
        if (c.id !== chainId) return c;
        const { targetBlueprint: _tb, ...rest } = c;
        return rest;
      }),
    });
  };

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
    const { tipX, tipY, tipZ, tipLength, direction } = computeIKChainTip(character, chainJoints);
    // tip 是原点中心 3D：求解目标写 target3D；chain.target 写投影镜像（按链朝向投影 + 画布中心）
    const tipStore = useProjectStore.getState();
    const newChain: IKChain = {
      id: `ik_${Date.now().toString(36)}`,
      name: `${character.nodes[rootId]?.name ?? rootId} → ${endNode?.name ?? endId}`,
      rootNodeId: rootId,
      endNodeId: endId,
      target: ikTargetMirror({ x: tipX, y: tipY, z: tipZ }, direction, tipStore.canvasWidth, tipStore.canvasHeight),
      target3D: { x: tipX, y: tipY, z: tipZ },
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
      const jointIds = getIKChainJointIds(character, chain.rootNodeId, chain.endNodeId);
      if (jointIds.length >= 2) {
        const { tipX, tipY, tipZ, direction } = computeIKChainTip(character, jointIds, chain.tipLength);
        // 保留用户已调过的 tipLength，只更新目标点：target3D 写原点 3D，target 写投影镜像
        const st = useProjectStore.getState();
        patch = {
          ...patch,
          target: ikTargetMirror({ x: tipX, y: tipY, z: tipZ }, direction, st.canvasWidth, st.canvasHeight),
          target3D: { x: tipX, y: tipY, z: tipZ },
        };
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

  // ---- pole（极向量，仅 2bone）：原点中心世界空间，与 target3D 同空间 ----
  const handlePoleSet = (id: string, v: { x: number; y: number; z: number }) => {
    if (!character) return;
    updateUnifiedCharacter(character.id, {
      ikChains: chains.map((c) => (c.id === id ? { ...c, poleTarget3D: v } : c)),
    });
  };

  const handlePoleCapture = (id: string) => {
    if (!character) return;
    const chain = chains.find((c) => c.id === id);
    if (!chain) return;
    const jointIds = getIKChainJointIds(character, chain.rootNodeId, chain.endNodeId);
    if (jointIds.length < 3) return;
    // FK 肘位：全部链禁用的克隆上算（与求解器缺省 pole 口径一致）
    const fkChar = { ...character, ikChains: (character.ikChains ?? []).map((c) => ({ ...c, enabled: false })) };
    const st = useProjectStore.getState();
    const t = computeWorldTransforms(fkChar, st.currentFrame, st.canvasWidth, st.canvasHeight).get(jointIds[1]);
    if (!t) return;
    const r1 = (v: number) => Math.round(v * 10) / 10;
    updateUnifiedCharacter(character.id, {
      ikChains: chains.map((c) =>
        c.id === id
          ? { ...c, poleTarget3D: { x: r1(subToPx(t.worldX)), y: r1(subToPx(t.worldY)), z: r1(subToPx(t.worldZ)) } }
          : c,
      ),
    });
  };

  const handlePoleClear = (id: string) => {
    if (!character) return;
    updateUnifiedCharacter(character.id, {
      ikChains: chains.map((c) => (c.id === id ? { ...c, poleTarget3D: undefined } : c)),
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
                  {c.targetBlueprint && <span className="text-purple-400 ml-1">[蓝图驱动]</span>}
                </span>
                <button
                  onClick={() => {
                    if (!c.targetBlueprint) {
                      // 首次打开时创建默认蓝图
                      const bp = createDefaultTargetBlueprint(c);
                      handleTargetBlueprintChange(c.id, bp);
                    }
                    setEditingTargetChainId(c.id);
                  }}
                  className={`p-0.5 rounded ${c.targetBlueprint ? 'text-purple-400' : 'text-gray-600 hover:text-purple-300'}`}
                  title="编辑目标蓝图（步态/正弦等修改器驱动）"
                >
                  <Network className="size-3" />
                </button>
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
              {/* pole 极向量（仅 2bone 显示）：决定肘的弯曲侧，原点中心世界空间 */}
              {c.solver === '2bone' && (
                <div className="flex items-center gap-1 text-gray-500">
                  <span title="极向量（原点中心世界空间）：肘向极向量一侧弯曲；缺省取求解前 FK 肘位">极向</span>
                  <Vec3Field
                    space="render-world"
                    unit="px"
                    round
                    value={c.poleTarget3D ?? { x: 0, y: 0, z: 0 }}
                    onChange={(v) => handlePoleSet(c.id, v)}
                    labelClassName="text-[10px] text-gray-500 whitespace-nowrap"
                    inputClassName="w-12 px-1 py-0.5 bg-black/50 rounded text-gray-300 text-[10px]"
                  />
                  <button
                    onClick={() => handlePoleCapture(c.id)}
                    className="px-1 py-0.5 rounded bg-black/50 text-gray-400 hover:text-cyan-300"
                    title="把当前帧的 FK 肘位写入极向量"
                  >
                    取肘位
                  </button>
                  {c.poleTarget3D ? (
                    <button
                      onClick={() => handlePoleClear(c.id)}
                      className="px-1 py-0.5 rounded bg-black/50 text-gray-400 hover:text-red-300"
                      title="清除极向量，恢复缺省（FK 肘位）"
                    >
                      清除
                    </button>
                  ) : (
                    <span className="text-gray-600">缺省=FK肘位</span>
                  )}
                </div>
              )}
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

      {/* 目标蓝图编辑弹窗 */}
      {editingTargetChainId && (() => {
        const chain = chains.find((c) => c.id === editingTargetChainId);
        if (!chain) return null;
        const graph = chain.targetBlueprint ?? createDefaultTargetBlueprint(chain);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <div className="w-[90vw] h-[85vh] bg-[#1a1a1a] rounded-lg flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                <span className="text-sm text-gray-200">
                  {chain.name} — 目标点蓝图
                  <span className="text-xs text-gray-500 ml-2">
                    用 translateX/translateY/translateZ 输出目标坐标（原点中心世界系：X 东 / Y 上 / Z 南）
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  {chain.targetBlueprint && (
                    <button
                      onClick={() => {
                        handleClearTargetBlueprint(chain.id);
                      }}
                      className="text-xs text-gray-500 hover:text-red-400"
                      title="清除蓝图，回到静态目标"
                    >
                      清除蓝图
                    </button>
                  )}
                  <button
                    onClick={() => setEditingTargetChainId(null)}
                    className="text-gray-400 hover:text-white text-lg leading-none px-2"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                <BlueprintEditor
                  frameRate={useProjectStore.getState().frameRate}
                  graph={graph}
                  onChange={(g) => handleTargetBlueprintChange(chain.id, g)}
                  title={`${chain.name} 目标`}
                  spaceContext="ik-target"
                />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
