'use client';

// ============================================================
// PolyContourEditor — 参数化外观的多边形轮廓编辑器
// 数据口径与 ParametricShapeDef.poly 一致：部件局部 px、原点=形状中心、
// x 右、y 下（导出时转换器翻 y）。交互沿用 PathEditor 的产品先例并
// 适配闭合轮廓：拖顶点移动、点边插入点、双击/右键顶点删除（≥3 点）、
// 橙色菱形为枢轴 polyPivot（插头锚点）可拖。Shift 拖动 = 吸附整数格。
// ============================================================

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  poly: [number, number][] | undefined;
  pivot: [number, number] | undefined;
  /** 标称尺寸（参考框 + 初始化矩形轮廓用） */
  size: [number, number];
  onChange: (poly: [number, number][]) => void;
  onPivotChange: (pivot: [number, number] | undefined) => void;
}

const W = 248;
const H = 248;

export default function PolyContourEditor({ poly, pivot, size, onChange, onPivotChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ kind: 'vertex' | 'pivot'; index: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const points = poly ?? [];

  // 视图：半幅 = 点/枢轴/尺寸框的最大外延 + 余量（下限 10px）
  let half = Math.max(size[0], size[1]) / 2 + 4;
  for (const [x, y] of points) half = Math.max(half, Math.abs(x) + 3, Math.abs(y) + 3);
  if (pivot) half = Math.max(half, Math.abs(pivot[0]) + 3, Math.abs(pivot[1]) + 3);
  half = Math.max(10, half);
  const scale = (W / 2) / half;
  const toPx = (p: [number, number]): [number, number] => [W / 2 + p[0] * scale, H / 2 + p[1] * scale];
  const toLocal = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (W / rect.width);
    const py = (e.clientY - rect.top) * (H / rect.height);
    return [(px - W / 2) / scale, (py - H / 2) / scale];
  };
  const hitVertex = (local: [number, number]): number => {
    const tol = 7 / scale;
    let best = -1;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.hypot(p[0] - local[0], p[1] - local[1]);
      if (d < tol && d < bestD) { best = i; bestD = d; }
    });
    return best;
  };
  const hitPivot = (local: [number, number]): boolean =>
    !!pivot && Math.hypot(pivot[0] - local[0], pivot[1] - local[1]) < 7 / scale;

  /** 点到线段的距离与最近段下标（加点用） */
  const nearestSegment = (local: [number, number]): { index: number; dist: number } => {
    let index = points.length - 1;
    let dist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const len2 = abx * abx + aby * aby;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((local[0] - a[0]) * abx + (local[1] - a[1]) * aby) / len2));
      const d = Math.hypot(local[0] - (a[0] + abx * t), local[1] - (a[1] + aby * t));
      if (d < dist) { dist = d; index = i; }
    }
    return { index, dist };
  };

  const handleDown = (e: React.PointerEvent) => {
    if (e.button === 2) return; // 右键走 contextmenu 删点
    const local = toLocal(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (hitPivot(local)) { setDrag({ kind: 'pivot', index: -1 }); return; }
    const v = hitVertex(local);
    if (v >= 0) { setDrag({ kind: 'vertex', index: v }); return; }
    // 空白处：在最近的边上插入点并立即拖动；无轮廓时起新点
    if (points.length >= 2) {
      const { index } = nearestSegment(local);
      const next: [number, number][] = [...points];
      next.splice(index + 1, 0, [local[0], local[1]]);
      onChange(next);
      setDrag({ kind: 'vertex', index: index + 1 });
    } else {
      onChange([...points, [local[0], local[1]]]);
      setDrag({ kind: 'vertex', index: points.length });
    }
  };

  const handleMove = (e: React.PointerEvent) => {
    const local = toLocal(e);
    if (!drag) { setHover(hitVertex(local)); return; }
    const snap = e.shiftKey ? 1 : 0.1;
    const v: [number, number] = [
      Math.round(local[0] / snap) * snap,
      Math.round(local[1] / snap) * snap,
    ];
    if (drag.kind === 'pivot') {
      onPivotChange(v);
    } else {
      const next: [number, number][] = [...points];
      next[drag.index] = v;
      onChange(next);
    }
  };

  const deleteVertex = (index: number) => {
    if (points.length <= 3) return;
    onChange(points.filter((_, i) => i !== index));
  };

  const initFromSize = () => {
    const [w, h] = size;
    onChange([
      [-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2],
    ] as [number, number][]);
  };

  // ---- 绘制 ----
  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, W, H);
    // 1px 逻辑网格
    ctx.strokeStyle = '#16162c';
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(-half); gx <= half; gx++) {
      const [px] = toPx([gx, 0]);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
    }
    for (let gy = Math.ceil(-half); gy <= half; gy++) {
      const [, py] = toPx([0, gy]);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
    }
    // 标称尺寸框（虚线）
    const [rx, ry] = toPx([-size[0] / 2, -size[1] / 2]);
    ctx.strokeStyle = '#3f3f56';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(rx, ry, size[0] * scale, size[1] * scale);
    ctx.setLineDash([]);
    // 中心十字（原点）
    const [cx, cy] = toPx([0, 0]);
    ctx.strokeStyle = '#52525b';
    ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();
    // 轮廓
    if (points.length >= 2) {
      ctx.beginPath();
      const [sx, sy] = toPx(points[0]);
      ctx.moveTo(sx, sy);
      for (let i = 1; i < points.length; i++) { const [x, y] = toPx(points[i]); ctx.lineTo(x, y); }
      if (points.length >= 3) ctx.closePath();
      if (points.length >= 3) { ctx.fillStyle = 'rgba(34, 211, 238, 0.13)'; ctx.fill(); }
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // 顶点
    points.forEach((p, i) => {
      const [x, y] = toPx(p);
      ctx.fillStyle = drag?.index === i && drag.kind === 'vertex' ? '#facc15' : hover === i ? '#facc15' : '#e4e4e7';
      ctx.strokeStyle = '#0a0a1a';
      ctx.lineWidth = 1;
      ctx.fillRect(x - 3, y - 3, 6, 6);
      ctx.strokeRect(x - 3, y - 3, 6, 6);
      ctx.fillStyle = '#71717a';
      ctx.font = '8px sans-serif';
      ctx.fillText(String(i), x + 5, y - 4);
    });
    // 枢轴（插头锚点）
    if (pivot) {
      const [x, y] = toPx(pivot);
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y);
      ctx.closePath(); ctx.fill();
    }
  };

  return (
    <div>
      <canvas
        ref={(el) => {
          canvasRef.current = el;
          if (el) { const ctx = el.getContext('2d'); if (ctx) draw(ctx); }
        }}
        width={W}
        height={H}
        className="w-full rounded border border-[#1e1e3a] cursor-crosshair touch-none"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={() => setDrag(null)}
        onDoubleClick={(e) => { const v = hitVertex(toLocal(e)); if (v >= 0) deleteVertex(v); }}
        onContextMenu={(e) => {
          e.preventDefault();
          const local = toLocal(e);
          if (hitPivot(local)) { onPivotChange(undefined); return; }
          const v = hitVertex(local);
          if (v >= 0) deleteVertex(v);
        }}
      />
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-[9px] text-gray-600">
          {points.length} 点 · 拖顶点移动 / 点边加点 / 双击或右键删点（≥3）/ Shift=整数格 · 橙菱形=枢轴（右键清）
        </span>
        <div className="flex-1" />
        {points.length < 3 && (
          <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5" onClick={initFromSize}>
            按尺寸生成矩形
          </Button>
        )}
        {!pivot && points.length >= 3 && (
          <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5" onClick={() => onPivotChange([0, -size[1] / 2])}>
            设枢轴（顶部中点）
          </Button>
        )}
      </div>
    </div>
  );
}
