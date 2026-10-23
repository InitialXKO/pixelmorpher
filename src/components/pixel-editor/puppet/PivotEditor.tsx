'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProjectStore } from '@/lib/store';
import type { Sprite } from '@/lib/unified-types';
import { pxToSub, subToPx } from '@/lib/unified-types';
import RepairPanel from './RepairPanel';

// ============================================================
// PivotEditor - 轴心编辑器：拖动 + 坐标输入（直接编辑全局 Sprite）
// plug 单位换算必须用 unified-types 的统一口径（pxToSub = px×16、
// subToPx = sub÷16）；本文件早先自带一份写反的换算，点选位置会被写成 1/16。
// ============================================================

interface Props {
  sprite: Sprite;
  onClose: () => void;
}

export default function PivotEditor({ sprite, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initialPlugX = sprite.plug ? Math.round(subToPx(sprite.plug.x)) : Math.floor(sprite.width / 2);
  const initialPlugY = sprite.plug ? Math.round(subToPx(sprite.plug.y)) : Math.floor(sprite.height / 2);
  const [pivotX, setPivotX] = useState(initialPlugX);
  const [pivotY, setPivotY] = useState(initialPlugY);
  const [showRepair, setShowRepair] = useState(false);
  const isDragging = useRef(false);

  const updateSprite = useProjectStore((s) => s.updateSprite);

  // 显示尺寸：保持宽高比塞进适配盒（宽 ≤ 对话框内容区 288，高 ≤ 视口
  // 55%）。早先 canvas 用 w-full 定宽、高按位图比例自适应——高瘦精灵
  // （如 40×400）会被撑到数千 px 高顶出视口且弹窗不可滚、按钮点不到。
  // 点选换算走 rect 比例，与显示尺寸无关，缩放显示不影响落点精度。
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const dispMaxH = Math.max(120, Math.min(420, Math.floor(viewportH * 0.55)));
  const dispScale = Math.min(288 / sprite.width, dispMaxH / sprite.height);
  const dispW = Math.max(1, Math.round(sprite.width * dispScale));
  const dispH = Math.max(1, Math.round(sprite.height * dispScale));

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
    // clientX 偏移是 CSS 像素，必须除以 CSS 尺寸对应的缩放；
    // 早先用 canvas.width（后备分辨率）换算，与 w-full 拉伸后的显示尺寸
    // 不一致，点击位置会被系统性放大/缩小。
    const scaleX = rect.width / sprite.width;
    const scaleY = rect.height / sprite.height;
    const x = Math.round((e.clientX - rect.left) / scaleX);
    const y = Math.round((e.clientY - rect.top) / scaleY);
    setPivotX(Math.max(0, Math.min(sprite.width, x)));
    setPivotY(Math.max(0, Math.min(sprite.height, y)));
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
      <div className="bg-[#1a1a2e] border border-white/10 rounded-lg p-4 w-[320px] max-h-[calc(100vh-2rem)] overflow-y-auto">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">调整轴心：{sprite.name}</h3>
        <canvas
          ref={canvasRef}
          className="block mx-auto border border-white/10 rounded cursor-crosshair"
          style={{ imageRendering: 'pixelated', width: dispW, height: dispH }}
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
              onChange={(e) => setPivotX(Math.max(0, Math.min(sprite.width, Number(e.target.value))))}
              className="h-7 text-xs"
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-gray-400">Y</label>
            <Input
              type="number"
              value={pivotY}
              onChange={(e) => setPivotY(Math.max(0, Math.min(sprite.height, Number(e.target.value))))}
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
