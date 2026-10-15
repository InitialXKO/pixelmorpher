'use client';

// ============================================================
// BlueprintTemplateLoader — 蓝图模板加载器
// 列出可用模板，让用户把槽位映射到实际节点，一键应用
// ============================================================

import React, { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  createQuadrupedRunBlueprint,
  type QuadrupedRunSlots,
} from '@/lib/blueprint/examples/quadruped-run';
import type { Character } from '@/lib/unified-types';

interface BlueprintTemplateLoaderProps {
  character: Character;
}

const TEMPLATES = [
  {
    id: 'quadruped-run',
    label: '四足奔跑',
    desc: '前后腿交替摆动，尾巴摇摆，身体起伏',
    slots: ['frontLegs', 'backLegs', 'tail', 'body', 'head'] as const,
    slotLabels: {
      frontLegs: '前腿（可多选）',
      backLegs: '后腿（可多选）',
      tail: '尾巴',
      body: '身体',
      head: '头',
    },
  },
];

export default function BlueprintTemplateLoader({ character }: BlueprintTemplateLoaderProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [slotMapping, setSlotMapping] = useState<Record<string, string[]>>({});

  const template = TEMPLATES.find((t) => t.id === selectedTemplate) ?? null;

  const toggleNodeForSlot = (slot: string, nodeId: string, multi: boolean) => {
    setSlotMapping((prev) => {
      const current = prev[slot] ?? [];
      if (multi) {
        // 多选：切换
        return {
          ...prev,
          [slot]: current.includes(nodeId)
            ? current.filter((id) => id !== nodeId)
            : [...current, nodeId],
        };
      } else {
        // 单选：直接设
        return { ...prev, [slot]: [nodeId] };
      }
    });
  };

  const handleApply = () => {
    if (!template) return;

    const slots: QuadrupedRunSlots = {
      frontLegs: slotMapping['frontLegs'] ?? [],
      backLegs: slotMapping['backLegs'] ?? [],
      tail: slotMapping['tail']?.[0],
      body: slotMapping['body']?.[0],
      head: slotMapping['head']?.[0],
    };

    if (slots.frontLegs.length === 0 && slots.backLegs.length === 0) {
      alert('至少选一条腿');
      return;
    }

    // 检查是否会覆盖已有蓝图
    const allNodeIds = [
      ...slots.frontLegs,
      ...slots.backLegs,
      slots.tail,
      slots.body,
      slots.head,
    ].filter(Boolean) as string[];
    const hasExisting = allNodeIds.some((id) => {
      const n = character.nodes[id];
      return n?.blueprint;
    });
    if (hasExisting) {
      if (!confirm('部分节点已有蓝图，应用模板会覆盖。继续？')) {
        return;
      }
    }

    const blueprints = createQuadrupedRunBlueprint(slots);
    const updateUnifiedNode = useProjectStore.getState().updateUnifiedNode;

    for (const [nodeId, graph] of blueprints) {
      updateUnifiedNode(character.id, nodeId, { blueprint: graph });
    }

    setSelectedTemplate(null);
    setSlotMapping({});
  };

  if (!selectedTemplate) {
    return (
      <div className="space-y-1.5">
        <Label className="text-[10px] text-gray-400">蓝图模板</Label>
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelectedTemplate(t.id)}
            className="w-full text-left px-2 py-1.5 rounded border border-[#2a2a4a] bg-[#111128] hover:border-cyan-500/50 transition-colors"
          >
            <div className="flex items-center gap-1.5">
              <Wand2 className="size-3 text-cyan-400" />
              <span className="text-[10px] text-gray-200 font-medium">{t.label}</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-0.5">{t.desc}</div>
          </button>
        ))}
      </div>
    );
  }

  // 槽位映射 UI
  if (!template) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-300 font-medium">
          {template.label} — 映射槽位
        </Label>
        <button
          onClick={() => { setSelectedTemplate(null); setSlotMapping({}); }}
          className="text-[9px] text-gray-500 hover:text-gray-300"
        >
          返回
        </button>
      </div>

      {template.slots.map((slot) => {
        const isMulti = slot === 'frontLegs' || slot === 'backLegs';
        const selected = slotMapping[slot] ?? [];
        return (
          <div key={slot} className="space-y-1">
            <div className="text-[9px] text-gray-400">
              {template.slotLabels[slot]}
              {isMulti && <span className="text-gray-600">（可多选）</span>}
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.values(character.nodes).map((n) => {
                const isSelected = selected.includes(n.id);
                return (
                  <button
                    key={n.id}
                    onClick={() => toggleNodeForSlot(slot, n.id, isMulti)}
                    className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                      isSelected
                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                        : 'border-[#2a2a4a] text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {n.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <Button
        size="sm"
        onClick={handleApply}
        className="w-full h-7 text-[10px]"
      >
        <Wand2 className="size-3 mr-1" />
        应用模板
      </Button>
    </div>
  );
}
