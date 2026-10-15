'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProjectStore } from '@/lib/store';
import type { Sprite } from '@/lib/unified-types';
import RepairPanel from './RepairPanel';

// ============================================================
// PivotEditor - 轴心编辑器：拖动 + 坐标输入（直接编辑全局 Sprite）
// ============================================================

interface Props {
  sprite: Sprite;
  onClose: () => void;
}

// sub-pixel (1/16px) ↔ px
const subToPx = (v: number) => v * 16;
const pxToSub = (v: number) => v / 16;

export default function PivotEditor({ sprite, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initialPlugX = sprite.plug ? Math.round(subToPx(sprite.plug.x)) : Math.floor(sprite.width / 2);
  const initialPlugY = sprite.plug ? Math.round(subToPx(sprite.plug.y)) : Math.floor(sprite.height / 2);
  const [pivotX, setPivotX] = useState(initialPlugX);
  const [pivotY, setPivotY] = useState(initialPlugY);
  const [showRepair, setShowRepair] = useState(false);
  const isDragging = useRef(false);

  const updateSprite = useProjectStore((s) => s.updateSprite);

  // 绘制 Sprite + 轴心十字线
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = Math.min(200 / sprite.width, 200 / sprite.height, 8);
    canvas.width = sprite.width * scale;
    canvas.height = sprite.height * scale;
    const ctx = canvas.getContext('2d')!;

    // 绘制像素
    for (let y = 0; y < sprite.height; y++) {
      for (let x = 0; x < sprite.width; x++) {
        const color = sprite.data[y]?.[x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }

    // 绘制轴心十字线
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 1;
    const px = pivotX * scale;
    const py = pivotY * scale;
    ctx.beginPath();
    ctx.moveTo(px - 8, py);
    ctx.lineTo(px + 8, py);
    ctx.moveTo(px, py - 8);
    ctx.lineTo(px, py + 8);
    ctx.stroke();
  });

  const handleDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    handleMove(e);
  };

  const handleMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / sprite.width;
    const x = Math.round((e.clientX - rect.left) / scale);
    const y = Math.round((e.clientY - rect.top) / scale);
    setPivotX(Math.max(0, Math.min(sprite.width - 1, x)));
    setPivotY(Math.max(0, Math.min(sprite.height - 1, y)));
  };

  const handleUp = () => {
    isDragging.current = false;
  };

  const handleConfirm = () => {
    updateSprite(sprite.id!, { plug: { x: pxToSub(pivotX), y: pxToSub(pivotY) } });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-lg p-4 w-[320px]">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">调整轴心：{sprite.name}</h3>
        <canvas
          ref={canvasRef}
          className="w-full border border-white/10 rounded cursor-crosshair"
          style={{ imageRendering: 'pixelated' }}
          onMouseDown={handleDown}
          onMouseMove={handleMove}
          onMouseUp={handleUp}
          onMouseLeave={handleUp}
        />
        <div className="flex gap-2 mt-3">
          <div className="flex-1">
            <label className="text-[10px] text-gray-400">X</label>
            <Input
              type="number"
              value={pivotX}
              onChange={(e) => setPivotX(Math.max(0, Math.min(sprite.width - 1, Number(e.target.value))))}
              className="h-7 text-xs"
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-gray-400">Y</label>
            <Input
              type="number"
              value={pivotY}
              onChange={(e) => setPivotY(Math.max(0, Math.min(sprite.height - 1, Number(e.target.value))))}
              className="h-7 text-xs"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={() => setShowRepair(true)} variant="outline" className="flex-1 h-7 text-xs">
            修复像素
          </Button>
        </div>
        <div className="flex gap-2 mt-2">
          <Button size="sm" onClick={handleConfirm} className="flex-1 h-7 text-xs">
            确认
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} className="flex-1 h-7 text-xs">
            取消
          </Button>
        </div>
        {showRepair && (
          <RepairPanel sprite={sprite} onClose={() => setShowRepair(false)} />
        )}
      </div>
    </div>
  );
}
