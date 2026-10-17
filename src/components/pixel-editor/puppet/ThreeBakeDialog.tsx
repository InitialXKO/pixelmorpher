'use client';

// ============================================================
// PixelMorpher - three.js 烘焙 MVP 验证对话框
// 上传 .glb/.gltf 或填 URL → 8 方向烘焙 → 拼图预览
// ============================================================

import { useCallback, useRef, useState } from 'react';
import { bakeModelToSprites, type BakeResult } from '@/lib/bake/threejs-baker';

const SAMPLE_URL =
  'https://threejs.org/examples/models/gltf/Xbot.glb';

interface ThreeBakeDialogProps {
  open: boolean;
  onClose: () => void;
}

function ResultCanvas({ result }: { result: BakeResult }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawnFor = useRef<BakeResult | null>(null);
  if (ref.current && drawnFor.current !== result) {
    drawnFor.current = result;
    const ctx = ref.current.getContext('2d');
    if (ctx) {
      const copy = new Uint8ClampedArray(result.pixels.length);
      copy.set(result.pixels);
      const img = new ImageData(copy, result.width, result.height);
      // 画到临时 canvas 再放大(nearest)显示
      const tmp = document.createElement('canvas');
      tmp.width = result.width;
      tmp.height = result.height;
      tmp.getContext('2d')?.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, ref.current.width, ref.current.height);
      ctx.drawImage(tmp, 0, 0, ref.current.width, ref.current.height);
    }
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <canvas
        ref={ref}
        width={128}
        height={128}
        className="border border-[#2a2a4a] bg-[repeating-conic-gradient(#1a1a2e_0%_25%,#141428_0%_50%)] bg-[size:16px_16px]"
        style={{ imageRendering: 'pixelated' }}
      />
      <div className="text-[10px] text-gray-400">
        方向 {result.direction} · {result.direction * 45}°
      </div>
      <div className="text-[10px] text-gray-500">
        {result.colorCount} 色 · {result.elapsedMs.toFixed(0)}ms
      </div>
    </div>
  );
}

export default function ThreeBakeDialog({ open, onClose }: ThreeBakeDialogProps) {
  const [url, setUrl] = useState(SAMPLE_URL);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  const [size, setSize] = useState(64);
  const [paletteSize, setPaletteSize] = useState(16);
  const [baking, setBaking] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<BakeResult[] | null>(null);
  const [totalMs, setTotalMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    setFileData(null);
    setResults(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setFileData(reader.result as ArrayBuffer);
    reader.onerror = () => setError('文件读取失败');
    reader.readAsArrayBuffer(f);
  }, []);

  const handleBake = useCallback(async () => {
    setBaking(true);
    setError(null);
    setResults(null);
    try {
      const input: string | ArrayBuffer = fileData ?? url.trim();
      if (!input || (typeof input === 'string' && input.length === 0)) {
        throw new Error('请先选择文件或填写 URL');
      }
      setProgress('加载模型…');
      // 让 UI 先 paint
      await new Promise((r) => setTimeout(r, 30));
      const t0 = performance.now();
      const out = await bakeModelToSprites(input, { size, paletteSize });
      setTotalMs(performance.now() - t0);
      setResults(out);
      setProgress('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress('');
    } finally {
      setBaking(false);
    }
  }, [fileData, url, size, paletteSize]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-[720px] overflow-y-auto rounded-lg border border-[#2a2a4a] bg-[#12122a] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-200">3D 烘焙测试 (three.js MVP)</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200">✕</button>
        </div>

        {/* 输入 */}
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="h-7 shrink-0 rounded border border-[#3a3a5a] bg-[#1a1a30] px-3 text-[11px] text-gray-300 hover:bg-[#222240]"
            >
              选择 .glb/.gltf
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".glb,.gltf"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <span className="truncate text-[11px] text-gray-500">
              {fileName ?? '或使用下方 URL（默认 Khronos Duck 示例）'}
            </span>
          </div>
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setFileName(null); setFileData(null); }}
            placeholder="https://…/model.glb"
            className="h-7 w-full rounded border border-[#2a2a4a] bg-[#0d0d1f] px-2 text-[11px] text-gray-300"
          />
          <div className="flex items-center gap-4 text-[11px] text-gray-400">
            <label className="flex items-center gap-1">
              分辨率
              <select
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="h-6 rounded border border-[#2a2a4a] bg-[#0d0d1f] px-1 text-gray-300"
              >
                <option value={32}>32</option>
                <option value={64}>64</option>
                <option value={128}>128</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              调色板
              <select
                value={paletteSize}
                onChange={(e) => setPaletteSize(Number(e.target.value))}
                className="h-6 rounded border border-[#2a2a4a] bg-[#0d0d1f] px-1 text-gray-300"
              >
                <option value={8}>8 色</option>
                <option value={16}>16 色</option>
                <option value={32}>32 色</option>
              </select>
            </label>
            <button
              onClick={handleBake}
              disabled={baking}
              className="h-7 rounded bg-cyan-700 px-4 text-[11px] font-bold text-white hover:bg-cyan-600 disabled:opacity-50"
            >
              {baking ? '烘焙中…' : '开始烘焙'}
            </button>
            {progress && <span className="text-cyan-400">{progress}</span>}
          </div>
        </div>

        {error && (
          <div className="mb-3 rounded border border-red-900 bg-red-950/50 p-2 text-[11px] text-red-300">
            {error}
          </div>
        )}

        {/* 结果拼图 */}
        {results && (
          <div>
            <div className="mb-2 text-[11px] text-gray-400">
              共 {results.length} 方向 · 总耗时 {totalMs.toFixed(0)}ms · {size}×{size}
            </div>
            <div className="grid grid-cols-4 gap-3">
              {results.map((r) => (
                <ResultCanvas key={r.direction} result={r} />
              ))}
            </div>
          </div>
        )}

        {!results && !error && !baking && (
          <div className="py-8 text-center text-[11px] text-gray-600">
            选择模型后点「开始烘焙」，8 方向渲染 + 颜色量化结果会显示在这里
          </div>
        )}
      </div>
    </div>
  );
}
