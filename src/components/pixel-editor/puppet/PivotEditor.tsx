'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProjectStore } from '@/lib/store';
import type { Part } from '@/lib/types';
import RepairPanel from './RepairPanel';

// ============================================================
// PivotEditor - 轴心编辑器：拖动 + 坐标输入
// ============================================================

interface Props {
  part: Part;
  onClose: () => void;
}

export default function PivotEditor({ part, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pivotX, setPivotX] = useState(part.pivotX);
  const [pivotY, setPivotY] = useState(part.pivotY);
  const [showRepair, setShowRepair] = useState(false);
  const isDragging = useRef(false);

  const updatePart = useProjectStore((s) => s.updatePart);

  // 绘制 Part + 轴心十字线
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = Math.min(200 / part.width, 200 / part.height, 8);
    canvas.width = part.width * scale;
    canvas.height = part.height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // 绘制像素
    for (let y = 0; y < part.height; y++) {
      for (let x = 0; x < part.width; x++) {
        const color = part.pixels[y]?.[x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }

    // 绘制轴心十字线
    const px = pivotX * scale;
    const py = pivotY * scale;
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px - 10, py);
    ctx.lineTo(px + 10, py);
    ctx.moveTo(px, py - 10);
    ctx.lineTo(px, py + 10);
    ctx.stroke();
    // 中心圆
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  }, [part, pivotX, pivotY]);

  const getPivotFromEvent = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / part.width;
    const x = Math.round((e.clientX - rect.left) / scale);
    const y = Math.round((e.clientY - rect.top) / scale);
    return {
      x: Math.max(0, Math.min(part.width - 1, x)),
      y: Math.max(0, Math.min(part.height - 1, y)),
    };
  };

  const handleDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    const { x, y } = getPivotFromEvent(e);
    setPivotX(x);
    setPivotY(y);
  };

  const handleMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const { x, y } = getPivotFromEvent(e);
    setPivotX(x);
    setPivotY(y);
  };

  const handleUp = () => {
    isDragging.current = false;
  };

  const handleConfirm = () => {
    updatePart(part.id, { pivotX, pivotY });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-lg p-4 w-[320px]">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">调整轴心：{part.name}</h3>
        <div className="flex justify-center mb-3">
          <canvas
            ref={canvasRef}
            className="border border-white/10 cursor-crosshair"
            style={{ imageRendering: 'pixelated' }}
            onMouseDown={handleDown}
            onMouseMove={handleMove}
            onMouseUp={handleUp}
            onMouseLeave={handleUp}
          />
        </div>
        <div className="flex gap-2 mb-3">
          <label className="flex-1 text-xs text-gray-400">
            X
            <Input
              type="number"
              value={pivotX}
              onChange={(e) => setPivotX(Math.max(0, Math.min(part.width - 1, Number(e.target.value))))}
              className="h-7 text-xs mt-1"
            />
          </label>
          <label className="flex-1 text-xs text-gray-400">
            Y
            <Input
              type="number"
              value={pivotY}
              onChange={(e) => setPivotY(Math.max(0, Math.min(part.height - 1, Number(e.target.value))))}
              className="h-7 text-xs mt-1"
            />
          </label>
        </div>
        <p className="text-[10px] text-gray-500 mb-3">拖动红色十字线或直接输入坐标</p>
        <div className="flex gap-2 mb-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => setShowRepair(true)}>
            修补空洞
          </Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={handleConfirm}>确认</Button>
          <Button size="sm" variant="ghost" className="flex-1" onClick={onClose}>取消</Button>
        </div>
      </div>
      {showRepair && (
        <RepairPanel part={part} onClose={() => setShowRepair(false)} />
      )}
    </div>
  );
}
