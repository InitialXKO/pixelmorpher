'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import { REPAIR_PATTERNS, patternDirectional } from '@/lib/repair-patterns';
import type { Sprite } from '@/lib/unified-types';
import type { PixelGrid } from '@/lib/types';

// ============================================================
// RepairPanel - 修补工具面板：7 种 pattern
// ============================================================

interface Props {
  sprite: Sprite;
  onClose: () => void;
}

export default function RepairPanel({ sprite, onClose }: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [dirX, setDirX] = useState(0);
  const [dirY, setDirY] = useState(0);
  const setSpritePixels = useProjectStore((s) => s.setSpritePixels);

  // 获取最新 Part 数据（应用后刷新）
  const liveSprite = useProjectStore((s) => s.sprites[sprite.id!]) ?? sprite;

  const handleApply = (patternId: string) => {
    const pattern = REPAIR_PATTERNS.find((p) => p.id === patternId);
    if (!pattern || !pattern.fn) return;
    const newPixels = pattern.fn(liveSprite.data);
    setSpritePixels(sprite.id!, newPixels);
    setPreviewId(null);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-lg p-4 w-[360px]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">修补：{sprite.name}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X className="size-4" />
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mb-3">
          选择 pattern 填充空洞。仿制图章用画布笔刷手动涂，方向延伸需在画布上拖出方向。
        </p>
        <div className="grid grid-cols-2 gap-2">
          {REPAIR_PATTERNS.filter((p) => p.fn).map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant="outline"
              className="text-[11px] h-8"
              onClick={() => handleApply(p.id)}
              title={`应用${p.label}`}
            >
              {p.label}
            </Button>
          ))}
          {/* 方向延伸：选方向后应用 */}
          <div className="col-span-2 p-2 rounded bg-white/5 border border-white/10">
            <div className="text-[11px] text-gray-400 mb-1">方向延伸：选方向</div>
            <div className="grid grid-cols-3 gap-1 w-24 mx-auto">
              {[
                { dx: -1, dy: -1, label: '↖' }, { dx: 0, dy: -1, label: '↑' }, { dx: 1, dy: -1, label: '↗' },
                { dx: -1, dy: 0, label: '←' }, { dx: 0, dy: 0, label: '·' }, { dx: 1, dy: 0, label: '→' },
                { dx: -1, dy: 1, label: '↙' }, { dx: 0, dy: 1, label: '↓' }, { dx: 1, dy: 1, label: '↘' },
              ].map((d) => (
                <Button
                  key={d.label}
                  size="sm"
                  variant={dirX === d.dx && dirY === d.dy ? 'default' : 'ghost'}
                  className="h-7 text-sm"
                  disabled={d.dx === 0 && d.dy === 0}
                  onClick={() => { setDirX(d.dx); setDirY(d.dy); }}
                >
                  {d.label}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              className="w-full mt-2 text-[11px] h-7"
              disabled={dirX === 0 && dirY === 0}
              onClick={() => {
                const newPixels = patternDirectional(liveSprite.data, dirX, dirY);
                setSpritePixels(sprite.id!, newPixels);
              }}
            >
              应用方向延伸
            </Button>
          </div>
          {/* 仿制图章 */}
          <div className="col-span-2 p-2 rounded bg-white/5 border border-white/10">
            <div className="text-[11px] text-gray-400 mb-1">仿制图章：Alt+点设源点，拖动涂抹</div>
            <CloneStampCanvas sprite={liveSprite} onApply={(pixels) => setSpritePixels(sprite.id!, pixels)} />
          </div>
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

// 仿制图章：Alt+点击设源点，拖动从源点复制
function CloneStampCanvas({ sprite, onApply }: { sprite: Sprite; onApply: (p: PixelGrid) => void }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [src, setSrc] = React.useState<{ x: number; y: number } | null>(null);
  const isDown = React.useRef(false);

  const pixels = sprite.data;
  const w = sprite.width;
  const h = sprite.height;

  // 绘制 Part 预览
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = pixels[y]?.[x];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    // 画源点标记
    if (src) {
      ctx.strokeStyle = '#0ff';
      ctx.strokeRect(src.x - 2, src.y - 2, 5, 5);
    }
  }, [pixels, w, h, src]);

  const getPos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = w / rect.width;
    const scaleY = h / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY),
    };
  };

  const paintAt = (x: number, y: number) => {
    if (!src) return;
    const newPixels = pixels.map((row) => [...row]);
    // 3x3 笔刷
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        // 源点偏移
        const sx = src.x + dx;
        const sy = src.y + dy;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const c = pixels[sy]?.[sx];
        if (c) newPixels[ty][tx] = c;
      }
    }
    onApply(newPixels);
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full border border-white/10 rounded cursor-crosshair"
      style={{ imageRendering: 'pixelated', aspectRatio: `${w}/${h}` }}
      onMouseDown={(e) => {
        const p = getPos(e);
        if (e.altKey) {
          setSrc(p);
        } else {
          isDown.current = true;
          paintAt(p.x, p.y);
        }
      }}
      onMouseMove={(e) => {
        if (!isDown.current || e.altKey) return;
        const p = getPos(e);
        paintAt(p.x, p.y);
      }}
      onMouseUp={() => (isDown.current = false)}
      onMouseLeave={() => (isDown.current = false)}
    />
  );
}
