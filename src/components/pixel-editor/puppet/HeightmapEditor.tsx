import { useRef, useEffect, useState, useCallback } from 'react';

interface HeightmapEditorProps {
  value: number[][] | undefined;
  onChange: (heightmap: number[][]) => void;
  width: number;
  height: number;
}

/**
 * 高度图编辑器：画布上涂抹，白色=凸起，黑色=凹陷
 * 左键画凸起，右键画凹陷（或按住 Shift 反转）
 */
export default function HeightmapEditor({ value, onChange, width, height }: HeightmapEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [painting, setPainting] = useState(false);
  const [brushValue, setBrushValue] = useState(0.5);
  const [brushSize, setBrushSize] = useState(5);
  const [isErasing, setIsErasing] = useState(false);

  // 初始化空高度图
  const getHeightmap = useCallback((): number[][] => {
    if (value && value.length === height && value[0]?.length === width) {
      return value.map(row => [...row]);
    }
    return Array.from({ length: height }, () => Array.from({ length: width }, () => 0));
  }, [value, width, height]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const hm = getHeightmap();
    const img = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = hm[y]?.[x] ?? 0;
        // -1~1 映射到 0~255（0=黑凹陷，128=中灰平面，255=白凸起）
        const gray = Math.round((v + 1) * 127.5);
        const idx = (y * width + x) * 4;
        img.data[idx] = gray;
        img.data[idx + 1] = gray;
        img.data[idx + 2] = gray;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [getHeightmap, width, height]);

  useEffect(() => {
    draw();
  }, [draw]);

  const paintAt = (cx: number, cy: number, val: number) => {
    const hm = getHeightmap();
    const r = brushSize;
    for (let y = Math.max(0, cy - r); y < Math.min(height, cy + r + 1); y++) {
      for (let x = Math.max(0, cx - r); x < Math.min(width, cx + r + 1); x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (d <= r) {
          // 圆形笔刷，边缘衰减
          const falloff = 1 - d / r;
          const target = isErasing ? 0 : val;
          hm[y]![x] = hm[y]![x]! * (1 - falloff * 0.5) + target * (falloff * 0.5);
          // clamp
          hm[y]![x] = Math.max(-1, Math.min(1, hm[y]![x]!));
        }
      }
    }
    onChange(hm);
  };

  const getPos = (e: React.MouseEvent): [number, number] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    return [
      Math.floor((e.clientX - rect.left) * scaleX),
      Math.floor((e.clientY - rect.top) * scaleY),
    ];
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) {
      // 右键：画凹陷
      const [x, y] = getPos(e);
      setPainting(true);
      setIsErasing(false);
      // 临时用负值
      const hm = getHeightmap();
      paintAt(x, y, -brushValue);
      return;
    }
    if (e.button === 0) {
      const [x, y] = getPos(e);
      setPainting(true);
      setIsErasing(e.shiftKey);
      paintAt(x, y, e.shiftKey ? 0 : brushValue);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!painting) return;
    const [x, y] = getPos(e);
    // 右键绘画时用负值
    paintAt(x, y, brushValue);
  };

  const handleMouseUp = () => {
    setPainting(false);
    setIsErasing(false);
  };

  return (
    <div className="space-y-1">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="rounded border border-[#2a2a4a] cursor-crosshair w-full"
        style={{ aspectRatio: `${width}/${height}`, imageRendering: 'pixelated' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="flex items-center gap-2">
        <label className="text-[9px] text-gray-500">强度</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={brushValue}
          onChange={(e) => setBrushValue(Number(e.target.value))}
          className="flex-1 h-1"
        />
        <span className="text-[9px] text-gray-400 w-8">{brushValue.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[9px] text-gray-500">笔刷</label>
        <input
          type="range"
          min={1}
          max={20}
          step={1}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          className="flex-1 h-1"
        />
        <span className="text-[9px] text-gray-400 w-8">{brushSize}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-gray-500">
          左键画凸起 · 右键画凹陷 · Shift+左键擦除
        </span>
        <button
          onClick={() => onChange(Array.from({ length: height }, () => Array.from({ length: width }, () => 0)))}
          className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
        >
          清空
        </button>
      </div>
    </div>
  );
}
