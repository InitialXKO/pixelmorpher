'use client';

// ============================================================
// PuppetModifierPanel — 木偶节点程序化修改器
// 挂在 Perform 阶段：给选中节点加 pendulum/breath/shake 等修改器，
// 逐帧叠加在关键帧插值之上。复用老系统的求值器 computePartAnimationTransform。
// ============================================================

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Eye, EyeOff, ChevronDown, Network } from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import {
  ANIMATION_MODIFIER_TYPES,
  getModifierDef,
  type AnimationModifierType,
  type PartAnimationModifier,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import BlueprintEditor from './BlueprintEditor';
import BlueprintTemplateLoader from './BlueprintTemplateLoader';
import { modifiersToBlueprint } from '@/lib/blueprint/migrate';
import { isPixelDeformModifier } from '@/lib/engine/modifier-types';
import type { BlueprintGraph } from '@/lib/blueprint/ir';

// 收录的修改器：变换类 + 像素类（用户要求像素层程序化动画也要支持）
const PUPPET_MODIFIER_TYPES: AnimationModifierType[] = [
  // 变换类
  'pendulum', 'bounce', 'breath', 'wobble', 'float', 'shake', 'elastic',
  'gait', 'noise', 'wave', 'spring', 'jitter', 'wheel', 'expression',
  // 像素类
  'texture_scroll', 'wave_deform', 'contour_scroll', 'reveal_hide',
  'shatter_dissolve', 'annihilate', 'teleport', 'crt_off',
  'bend', 'elliptical_compress', 'dumbbell_stretch', 'pillow_stretch',
  'hyperbolic_stretch', 'ring_ripple',
];

export default function PuppetModifierPanel() {
  const puppetSkeletons = useProjectStore((s) => s.puppetSkeletons) ?? [];
  const addPuppetNodeModifier = useProjectStore((s) => s.addPuppetNodeModifier);
  const removePuppetNodeModifier = useProjectStore((s) => s.removePuppetNodeModifier);
  const updatePuppetNodeModifier = useProjectStore((s) => s.updatePuppetNodeModifier);
  const togglePuppetNodeModifier = useProjectStore((s) => s.togglePuppetNodeModifier);

  const [addingType, setAddingType] = useState<AnimationModifierType>('pendulum');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'modifiers' | 'blueprint' | 'templates'>('modifiers');

  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const selectedPuppetNodeId = useProjectStore((s) => s.selectedPuppetNodeId);

  const skeleton = useMemo(
    () => puppetSkeletons.find((sk) => sk.id === activePuppetSkeletonId) ?? null,
    [puppetSkeletons, activePuppetSkeletonId]
  );
  const node = useMemo(
    () => skeleton?.nodes.find((n) => n.id === selectedPuppetNodeId) ?? null,
    [skeleton, selectedPuppetNodeId]
  );
  const modifiers = node?.modifiers ?? [];

  // 蓝图：优先用节点自带的，没有则从 modifiers 即时转换
  const blueprint: BlueprintGraph | null = useMemo(() => {
    if (!node) return null;
    if (node.blueprint) return node.blueprint;
    if (modifiers.length > 0) return modifiersToBlueprint(modifiers);
    return null;
  }, [node, modifiers]);

  const updateBlueprint = (g: BlueprintGraph) => {
    if (!skeleton || !node) return;
    // 保存蓝图到节点
    useProjectStore.getState().updatePuppetNode(skeleton.id, node.id, { blueprint: g });
  };

  if (!node || !skeleton) return null;

  const handleAdd = () => {
    addPuppetNodeModifier(skeleton.id, node.id, addingType);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-400">
          程序化修改器 · {node.name}
        </Label>
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('modifiers')}
            className={`text-[9px] px-1.5 py-0.5 rounded ${
              activeTab === 'modifiers'
                ? 'bg-cyan-500/20 text-cyan-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            列表
          </button>
          <button
            onClick={() => setActiveTab('blueprint')}
            className={`text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
              activeTab === 'blueprint'
                ? 'bg-cyan-500/20 text-cyan-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Network className="size-2.5" />
            蓝图
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`text-[9px] px-1.5 py-0.5 rounded ${
              activeTab === 'templates'
                ? 'bg-cyan-500/20 text-cyan-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            模板
          </button>
        </div>
      </div>

      {activeTab === 'templates' ? (
        <BlueprintTemplateLoader skeleton={skeleton} />
      ) : activeTab === 'blueprint' ? (
        <>
          {/* 像素修改器提示：不在蓝图里，走像素管线 */}
          {(() => {
            const pixelMods = modifiers.filter((m) => isPixelDeformModifier(m.type));
            return pixelMods.length > 0 ? (
              <div className="bg-purple-500/10 border border-purple-500/30 rounded px-2 py-1.5 text-[9px] text-purple-300/90 leading-relaxed mb-2">
                🎨 该节点有 {pixelMods.length} 个像素修改器（{pixelMods.map((m) => getModifierDef(m.type)?.label ?? m.type).join('、')}），
                在"列表" tab 编辑，不进蓝图。
              </div>
            ) : null;
          })()}
          {blueprint ? (
            <BlueprintEditor
              graph={blueprint}
              onChange={updateBlueprint}
              title={`${node.name} 的蓝图`}
              skeleton={skeleton}
            />
          ) : (
            <div className="text-[10px] text-gray-600 text-center py-4">
              暂无蓝图。先在"列表"里加个变换类修改器（如钟摆），会自动转成蓝图。
            </div>
          )}
        </>
      ) : (
      <>
      {/* 蓝图存在时，列表修改器不生效，给出警告 */}
      {node.blueprint && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5 text-[9px] text-amber-300/90 leading-relaxed">
          ⚠️ 该节点有蓝图，列表里的修改器不会生效。去"蓝图" tab 编辑，或删掉蓝图再用列表。
        </div>
      )}
      {/* 添加 */}
      <div className="flex gap-1.5">
        <select
          value={addingType}
          onChange={(e) => setAddingType(e.target.value as AnimationModifierType)}
          className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1.5 py-1 text-[10px] text-gray-300"
        >
          {PUPPET_MODIFIER_TYPES.map((t) => {
            const def = getModifierDef(t);
            return (
              <option key={t} value={t}>
                {def?.label ?? t}
              </option>
            );
          })}
        </select>
        <Button size="sm" onClick={handleAdd} className="h-7 px-2 text-[10px]">
          <Plus className="size-3 mr-0.5" />
          添加
        </Button>
      </div>

      {/* 列表 */}
      {modifiers.length === 0 && (
        <div className="text-[10px] text-gray-600 text-center py-3">
          暂无修改器。加一个 pendulum 试试摆动。
        </div>
      )}
      <div className="space-y-1.5">
        {modifiers.map((m) => (
          <ModifierRow
            key={m.id}
            modifier={m}
            expanded={expandedId === m.id}
            onToggleExpand={() => setExpandedId(expandedId === m.id ? null : m.id)}
            onToggle={() => togglePuppetNodeModifier(skeleton.id, node.id, m.id)}
            onRemove={() => removePuppetNodeModifier(skeleton.id, node.id, m.id)}
            onUpdateParam={(name, value) =>
              updatePuppetNodeModifier(skeleton.id, node.id, m.id, { [name]: value })
            }
          />
        ))}
      </div>
      </>
      )}
    </div>
  );
}

function ModifierRow({
  modifier,
  expanded,
  onToggleExpand,
  onToggle,
  onRemove,
  onUpdateParam,
}: {
  modifier: PartAnimationModifier;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onUpdateParam: (name: string, value: number | string | boolean) => void;
}) {
  const def = getModifierDef(modifier.type);

  return (
    <div
      className={`rounded border ${
        modifier.enabled ? 'border-[#2a2a4a] bg-[#111128]' : 'border-[#1a1a2e] bg-[#0c0c1c] opacity-60'
      }`}
    >
      <div className="flex items-center gap-1 px-1.5 py-1">
        <button
          onClick={onToggle}
          className="p-0.5 text-gray-400 hover:text-gray-200"
          title={modifier.enabled ? '禁用' : '启用'}
        >
          {modifier.enabled ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
        </button>
        <button
          onClick={onToggleExpand}
          className="flex-1 min-w-0 flex items-center gap-1 text-left"
        >
          <span className="text-[10px] text-gray-200 truncate flex-1 min-w-0">
            {def?.label ?? modifier.type}
          </span>
          <ChevronDown
            className={`size-3 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
        <button
          onClick={onRemove}
          className="p-0.5 text-gray-500 hover:text-red-400"
          title="删除"
        >
          <Trash2 className="size-3" />
        </button>
      </div>

      {expanded && def && (
        <div className="px-2 pb-2 space-y-1 border-t border-[#1e1e3a] pt-1.5">
          {def.params.map((p) => {
            const val = modifier.params[p.name] ?? p.default;
            return (
              <div key={p.name} className="flex items-center gap-1.5">
                <span className="text-[9px] text-gray-500 w-20 truncate flex-shrink-0" title={p.label}>
                  {p.label}
                </span>
                {p.type === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={Boolean(val)}
                    onChange={(e) => onUpdateParam(p.name, e.target.checked)}
                    className="size-3"
                  />
                ) : p.type === 'select' && p.options ? (
                  <select
                    value={String(val)}
                    onChange={(e) => onUpdateParam(p.name, e.target.value)}
                    className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[10px] text-gray-300"
                  >
                    {p.options.map((opt) => (
                      <option key={String(opt.value)} value={String(opt.value)}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    value={Number(val)}
                    step={p.step ?? 0.1}
                    min={p.min}
                    max={p.max}
                    onChange={(e) => onUpdateParam(p.name, Number(e.target.value))}
                    className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[10px] text-gray-300 tabular-nums"
                  />
                )}
              </div>
            );
          })}
          {def.params.length === 0 && (
            <div className="text-[9px] text-gray-600">无可调参数</div>
          )}
        </div>
      )}
    </div>
  );
}
