'use client';
/**
 * SpriteThumb — 全仓共用精灵缩略图（research/sprite-management）
 *
 * 画布尺寸恒为 box×box，精灵经 thumbFitRect 等比居中绘制
 * （不变形）；像素来源是 sprite-thumb 的对象身份缓存，重复
 * 挂载只剩一次 drawImage。棋盘格背景衬透明像素。
 */
import { useEffect, useRef } from 'react';
import type { Sprite } from '@/lib/unified-types';
import { getSpriteThumbCanvas, thumbFitRect } from '@/lib/sprite-thumb';

export default function SpriteThumb({
  sprite,
  size = 36,
  className,
}: {
  sprite: Sprite;
  /** 显示边长（px，正方形盒子） */
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    const thumb = getSpriteThumbCanvas(sprite);
    if (!thumb) return;
    const fit = thumbFitRect(sprite.width, sprite.height, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(thumb, fit.x, fit.y, fit.w, fit.h);
  }, [sprite, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
      className={className ?? 'rounded bg-black/50'}
    />
  );
}
