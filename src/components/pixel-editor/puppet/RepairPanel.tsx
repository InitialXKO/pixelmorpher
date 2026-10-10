'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import { REPAIR_PATTERNS } from '@/lib/repair-patterns';
import type { Part } from '@/lib/types';

// ============================================================
// RepairPanel - 修补工具面板：7 种 pattern
// ============================================================

interface Props {
  part: Part;
  onClose: () => void;
}

export default function RepairPanel({ part, onClose }: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const setPartPixels = useProjectStore((s) => s.setPartPixels);

  // 获取最新 Part 数据（应用后刷新）
  const livePart = useProjectStore((s) => s.parts.find((p) => p.id === part.id)) ?? part;

  const handleApply = (patternId: string) => {
    const pattern = REPAIR_PATTERNS.find((p) => p.id === patternId);
    if (!pattern || !pattern.fn) return;
    const newPixels = pattern.fn(livePart.pixels);
    setPartPixels(part.id, newPixels);
    setPreviewId(null);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-lg p-4 w-[360px]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">修补：{part.name}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X className="size-4" />
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mb-3">
          选择 pattern 填充空洞。仿制图章用画布笔刷手动涂，方向延伸需在画布上拖出方向。
        </p>
        <div className="grid grid-cols-2 gap-2">
          {REPAIR_PATTERNS.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={p.fn ? 'outline' : 'ghost'}
              disabled={!p.fn}
              className="text-[11px] h-8"
              onClick={() => handleApply(p.id)}
              title={p.id === 'directional' ? '在画布上拖出方向后应用' : `应用${p.label}`}
            >
              {p.label}
            </Button>
          ))}
          {/* 仿制图章：手动 */}
          <Button size="sm" variant="ghost" disabled className="text-[11px] h-8">
            仿制图章（手动）
          </Button>
        </div>
        <div className="mt-3">
          <Button size="sm" variant="ghost" className="w-full" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>
    </div>
  );
}
