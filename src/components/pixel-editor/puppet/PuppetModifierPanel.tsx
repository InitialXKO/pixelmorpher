'use client';

// ============================================================
// PuppetModifierPanel — 木偶节点程序化修改器
// 挂在 Perform 阶段：给选中节点加 pendulum/breath/shake 等修改器，
// 逐帧叠加在关键帧插值之上。复用老系统的求值器 computePartAnimationTransform。
// ============================================================

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Eye, EyeOff, ChevronDown } from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import {
  ANIMATION_MODIFIER_TYPES,
  getModifierDef,
  type AnimationModifierType,
  type PartAnimationModifier,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

// 只收录对木偶节点有意义的变换类修改器（像素破坏类不收）
const PUPPET_MODIFIER_TYPES: AnimationModifierType[] = [
  'pendulum', 'bounce', 'breath', 'wobble', 'float', 'shake', 'elastic',
  'gait', 'noise', 'wave', 'spring', 'jitter', 'wheel',
];

export default function PuppetModifierPanel() {
  const puppetSkeletons = useProjectStore((s) => s.puppetSkeletons) ?? [];
  const addPuppetNodeModifier = useProjectStore((s) => s.addPuppetNodeModifier);
  const removePuppetNodeModifier = useProjectStore((s) => s.removePuppetNodeModifier);
  const updatePuppetNodeModifier = useProjectStore((s) => s.updatePuppetNodeModifier);
  const togglePuppetNodeModifier = useProjectStore((s) => s.togglePuppetNodeModifier);

  const phase = usePuppetSessionStore((s) => s.phase);
  const performCharacterId = usePuppetSessionStore((s) => s.performCharacterId);
  const performNodeId = usePuppetSessionStore((s) => s.performNodeId);

  const [addingType, setAddingType] = useState<AnimationModifierType>('pendulum');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const puppetCharacters = useProjectStore((s) => s.puppetCharacters) ?? [];
  const character = useMemo(
    () => puppetCharacters.find((c) => c.id === performCharacterId) ?? null,
    [puppetCharacters, performCharacterId]
  );
  const skeleton = useMemo(
    () => puppetSkeletons.find((sk) => sk.id === character?.puppetSkeletonId) ?? null,
    [puppetSkeletons, character]
  );
  const node = useMemo(
    () => skeleton?.nodes.find((n) => n.id === performNodeId) ?? null,
    [skeleton, performNodeId]
  );
  const modifiers = node?.modifiers ?? [];

  if (phase !== 'perform' || !node || !skeleton) return null;

  const handleAdd = () => {
    addPuppetNodeModifier(skeleton.id, node.id, addingType);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-400">
          程序化修改器 · {node.name}
        </Label>
        <span className="text-[9px] text-gray-600">{modifiers.length} 个</span>
      </div>

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
