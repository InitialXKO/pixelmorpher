import { useRef, useEffect, useState, useCallback } from 'react';

interface PathPoint {
  x: number;
  y: number;
}

interface PathEditorProps {
  value: PathPoint[];
  onChange: (path: PathPoint[]) => void;
  pathType?: 'polyline' | 'bezier';
  width?: number;
  height?: number;
}

/**
 * 路径编辑器：在画布上点击添加点，拖拽移动点，右键/双击删除点
 * 贝塞尔模式下每4点为一段（p0, c1, c2, p1），控制点可拖拽
 */
export default function PathEditor({ value, onChange, pathType = 'polyline', width = 200, height = 160 }: PathEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const points = value ?? [];

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, W, H);

    // 网格
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += 20) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    if (points.length === 0) {
      ctx.fillStyle = '#52525b';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('点击添加路径点', W / 2, H / 2);
      return;
    }

    // 绘制路径
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (pathType === 'bezier' && points.length >= 4) {
      // 贝塞尔曲线
      for (let s = 0; s + 3 < points.length; s += 4) {
        const p0 = points[s]!, p1 = points[s + 1]!, p2 = points[s + 2]!, p3 = points[s + 3]!;
        if (s === 0) ctx.moveTo(p0.x, p0.y);
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
        // 控制线
        ctx.strokeStyle = '#52525b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
        ctx.moveTo(p3.x, p3.y); ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p3.x, p3.y);
      }
    } else {
      // 多段线
      ctx.moveTo(points[0]!.x, points[0]!.y);
      for (let k = 1; k < points.length; k++) {
        ctx.lineTo(points[k]!.x, points[k]!.y);
      }
    }
    ctx.stroke();

    // 绘制点
    points.forEach((p, idx) => {
      const isControl = pathType === 'bezier' && (idx % 4 === 1 || idx % 4 === 2);
      const isHover = hover === idx;
      const isDrag = dragging === idx;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isHover || isDrag ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isControl ? '#a78bfa' : (isDrag ? '#f59e0b' : '#22d3ee');
      ctx.fill();
      ctx.strokeStyle = '#0a0a1a';
      ctx.lineWidth = 1;
      ctx.stroke();
      // 序号
      if (!isControl) {
        ctx.fillStyle = '#0a0a1a';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(Math.floor(idx / (pathType === 'bezier' ? 4 : 1))), p.x, p.y + 3);
      }
    });
  }, [points, pathType, hover, dragging]);

  useEffect(() => {
    draw();
  }, [draw]);

  const getPos = (e: React.MouseEvent): PathPoint => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const findPoint = (pos: PathPoint): number | null => {
    for (let k = points.length - 1; k >= 0; k--) {
      const dx = points[k]!.x - pos.x;
      const dy = points[k]!.y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10) return k;
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return; // 右键不处理（由 contextmenu 处理）
    const pos = getPos(e);
    const idx = findPoint(pos);
    if (idx !== null) {
      setDragging(idx);
    } else {
      // 添加新点
      onChange([...points, { x: Math.round(pos.x), y: Math.round(pos.y) }]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getPos(e);
    if (dragging !== null) {
      const newPoints = [...points];
      newPoints[dragging] = { x: Math.round(pos.x), y: Math.round(pos.y) };
      onChange(newPoints);
    } else {
      setHover(findPoint(pos));
    }
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const pos = getPos(e);
    const idx = findPoint(pos);
    if (idx !== null) {
      onChange(points.filter((_, k) => k !== idx));
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const pos = getPos(e);
    const idx = findPoint(pos);
    if (idx !== null) {
      onChange(points.filter((_, k) => k !== idx));
    }
  };

  return (
    <div className="space-y-1">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="rounded border border-[#2a2a4a] cursor-crosshair w-full"
        style={{ aspectRatio: `${width}/${height}` }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setDragging(null); setHover(null); }}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
      />
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-gray-500">
          {points.length} 点 · 点击添加 · 拖拽移动 · 右键删除
        </span>
        {points.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
          >
            清空
          </button>
        )}
      </div>
    </div>
  );
}
