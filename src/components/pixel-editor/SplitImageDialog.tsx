'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { useProjectStore } from '@/lib/store';
import { initSAM, setSAMImage, segmentAtPoint, isSAMReady } from '@/lib/sam';
import { samMaskToSelectionMask } from '@/lib/inpainting';
import type { SAMModelType, SAMStatus } from '@/lib/types';
import { Scissors, Upload, Wand2, Check, X, Trash2, Brain, Loader2 } from 'lucide-react';

// Region colors for overlay
const REGION_COLORS = [
  '#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff',
  '#ff8800', '#8800ff', '#00ff88', '#ff0088', '#0088ff', '#88ff00',
  '#ff6666', '#66ff66', '#6666ff', '#ffff66',
];

interface DetectedRegion {
  id: number;
  name: string;
  pixels: { x: number; y: number }[];
  color: string;
  enabled: boolean;
}

/** BFS flood-fill to find connected non-transparent pixel regions */
function detectRegions(imageData: ImageData, tolerance: number): DetectedRegion[] {
  const { width, height, data } = imageData;
  const visited = new Uint8Array(width * height);
  const regions: DetectedRegion[] = [];

  function isOpaque(idx: number): boolean {
    const a = data[idx * 4 + 3];
    return a > 10; // alpha threshold
  }

  for (let startY = 0; startY < height; startY++) {
    for (let startX = 0; startX < width; startX++) {
      const flatIdx = startY * width + startX;
      if (visited[flatIdx] || !isOpaque(flatIdx)) continue;

      // BFS flood fill
      const regionPixels: { x: number; y: number }[] = [];
      const queue: number[] = [flatIdx];
      visited[flatIdx] = 1;

      while (queue.length > 0) {
        const current = queue.shift()!;
        const cy = Math.floor(current / width);
        const cx = current % width;
        regionPixels.push({ x: cx, y: cy });

        // 4-connected neighbors
        const neighbors = [
          cy > 0 ? current - width : -1,
          cy < height - 1 ? current + width : -1,
          cx > 0 ? current - 1 : -1,
          cx < width - 1 ? current + 1 : -1,
        ];

        for (const nIdx of neighbors) {
          if (nIdx < 0 || visited[nIdx]) continue;
          if (!isOpaque(nIdx)) continue;

          // Color similarity check with tolerance
          const srcR = data[current * 4];
          const srcG = data[current * 4 + 1];
          const srcB = data[current * 4 + 2];
          const nR = data[nIdx * 4];
          const nG = data[nIdx * 4 + 1];
          const nB = data[nIdx * 4 + 2];

          const diff = Math.abs(srcR - nR) + Math.abs(srcG - nG) + Math.abs(srcB - nB);
          if (diff <= tolerance * 3) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }

      // Only keep regions with more than 4 pixels
      if (regionPixels.length > 4) {
        regions.push({
          id: regions.length,
          name: `区域 ${regions.length + 1}`,
          pixels: regionPixels,
          color: REGION_COLORS[regions.length % REGION_COLORS.length],
          enabled: true,
        });
      }
    }
  }

  return regions;
}

/**
 * SAM-based auto segmentation using grid sampling.
 * Samples the image at regular grid points, segments at each point,
 * and merges overlapping masks into distinct regions.
 */
async function samAutoSegment(
  imageCanvas: HTMLCanvasElement,
  imageData: ImageData,
  onProgress?: (stage: string, progress: number) => void,
): Promise<DetectedRegion[]> {
  const { width, height } = imageData;

  // Step 1: Initialize SAM if not ready
  onProgress?.('init', 0);
  if (!isSAMReady()) {
    await initSAM('mobilesam', (status: SAMStatus, progress: number) => {
      onProgress?.('init', progress);
    });
  }

  // Step 2: Encode the image
  onProgress?.('encode', 0);
  await setSAMImage(imageCanvas);
  onProgress?.('encode', 50);

  // Step 3: Grid sampling - segment at multiple points
  // Determine grid density based on image size
  const minGridSize = 32;
  const gridStepX = Math.max(minGridSize, Math.floor(width / 8));
  const gridStepY = Math.max(minGridSize, Math.floor(height / 8));
  const samplePoints: { x: number; y: number }[] = [];

  for (let py = gridStepY / 2; py < height; py += gridStepY) {
    for (let px = gridStepX / 2; px < width; px += gridStepX) {
      // Only sample at non-transparent pixels
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      if (ix >= 0 && ix < width && iy >= 0 && iy < height) {
        const alpha = imageData.data[(iy * width + ix) * 4 + 3];
        if (alpha > 10) {
          samplePoints.push({ x: ix, y: iy });
        }
      }
    }
  }

  if (samplePoints.length === 0) {
    return [];
  }

  // Step 4: Segment at each sample point and collect masks
  const masks: { pixels: Set<string>; bounds: { x: number; y: number; w: number; h: number } }[] = [];
  const totalSamples = samplePoints.length;

  for (let i = 0; i < totalSamples; i++) {
    const pt = samplePoints[i];
    const normalizedX = pt.x / width;
    const normalizedY = pt.y / height;

    try {
      const result = await segmentAtPoint(normalizedX, normalizedY, 1);
      const pixelSet = samMaskToSelectionMask(result.data, result.shape, width, height, 0.5);

      // Skip empty or very small masks
      if (pixelSet.size < 5) continue;

      // Calculate bounds
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const key of pixelSet) {
        const [cx, cy] = key.split(',').map(Number);
        minX = Math.min(minX, cx);
        minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx);
        maxY = Math.max(maxY, cy);
      }

      masks.push({ pixels: pixelSet, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } });
    } catch {
      // Skip failed segmentations
    }

    onProgress?.('segment', Math.round(((i + 1) / totalSamples) * 100));
  }

  if (masks.length === 0) {
    return [];
  }

  // Step 5: Merge overlapping masks into distinct regions
  // Use union-find to group masks that overlap significantly
  const parent = Array.from({ length: masks.length }, (_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Check overlap between masks
  for (let i = 0; i < masks.length; i++) {
    for (let j = i + 1; j < masks.length; j++) {
      const mi = masks[i];
      const mj = masks[j];

      // Quick bounds overlap check
      if (mi.bounds.x > mj.bounds.x + mj.bounds.w || mj.bounds.x > mi.bounds.x + mi.bounds.w ||
          mi.bounds.y > mj.bounds.y + mj.bounds.h || mj.bounds.y > mi.bounds.y + mi.bounds.h) {
        continue;
      }

      // Calculate IoU (Intersection over Union)
      let intersection = 0;
      // Iterate over the smaller set for efficiency
      const smaller = mi.pixels.size < mj.pixels.size ? mi.pixels : mj.pixels;
      const larger = mi.pixels.size < mj.pixels.size ? mj.pixels : mi.pixels;
      for (const key of smaller) {
        if (larger.has(key)) intersection++;
      }

      const unionSize = mi.pixels.size + mj.pixels.size - intersection;
      const iou = unionSize > 0 ? intersection / unionSize : 0;

      // If IoU > 0.3, they are the same region
      if (iou > 0.3) {
        union(i, j);
      }
    }
  }

  // Group masks by their root
  const groups = new Map<number, number[]>();
  for (let i = 0; i < masks.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  // Step 6: Merge each group into a single region
  const regions: DetectedRegion[] = [];

  for (const [, indices] of groups) {
    // Merge all pixels from the group
    const mergedPixels = new Set<string>();
    for (const idx of indices) {
      for (const key of masks[idx].pixels) {
        mergedPixels.add(key);
      }
    }

    // Convert to pixel coordinate array
    const regionPixels: { x: number; y: number }[] = [];
    for (const key of mergedPixels) {
      const [x, y] = key.split(',').map(Number);
      regionPixels.push({ x, y });
    }

    if (regionPixels.length > 4) {
      regions.push({
        id: regions.length,
        name: `区域 ${regions.length + 1}`,
        pixels: regionPixels,
        color: REGION_COLORS[regions.length % REGION_COLORS.length],
        enabled: true,
      });
    }
  }

  // Sort regions by size (largest first)
  regions.sort((a, b) => b.pixels.length - a.pixels.length);
  // Reassign IDs after sorting
  regions.forEach((r, i) => {
    r.id = i;
    r.name = `区域 ${i + 1}`;
    r.color = REGION_COLORS[i % REGION_COLORS.length];
  });

  return regions;
}

// ---- SplitImageDialog Component ----

interface SplitImageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SplitImageDialog({ open, onOpenChange }: SplitImageDialogProps) {
  const [sourceImage, setSourceImage] = useState<ImageData | null>(null);
  const [sourceImageUrl, setSourceImageUrl] = useState<string>('');
  const [regions, setRegions] = useState<DetectedRegion[]>([]);
  const [tolerance, setTolerance] = useState(32);
  const [detecting, setDetecting] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [samSegmenting, setSamSegmenting] = useState(false);
  const [samProgress, setSamProgress] = useState<{ stage: string; progress: number }>({ stage: '', progress: 0 });

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const splitImageToParts = useProjectStore((s) => s.splitImageToParts);

  // Render preview with region overlays
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !sourceImage) return;

    canvas.width = sourceImage.width;
    canvas.height = sourceImage.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw original image
    ctx.putImageData(sourceImage, 0, 0);

    // Draw region overlays
    for (const region of regions) {
      if (!region.enabled) continue;
      ctx.fillStyle = region.color + '66'; // semi-transparent
      for (const px of region.pixels) {
        ctx.fillRect(px.x, px.y, 1, 1);
      }
    }
  }, [sourceImage, regions]);

  // Handle image import
  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          setSourceImage(imageData);
          setSourceImageUrl(ev.target?.result as string);
          setRegions([]); // Reset regions when new image is loaded
        };
        img.src = ev.target?.result as string;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    },
    [],
  );

  // Handle auto-detect (color-based BFS)
  const handleAutoDetect = useCallback(() => {
    if (!sourceImage) return;
    setDetecting(true);
    // Use setTimeout to allow UI to update
    setTimeout(() => {
      const detected = detectRegions(sourceImage, tolerance);
      setRegions(detected);
      setDetecting(false);
    }, 50);
  }, [sourceImage, tolerance]);

  // Handle SAM auto-segment
  const handleSAMSegment = useCallback(async () => {
    if (!sourceImage) return;
    setSamSegmenting(true);
    setSamProgress({ stage: 'init', progress: 0 });

    try {
      // Create a canvas from the source image for SAM
      const canvas = document.createElement('canvas');
      canvas.width = sourceImage.width;
      canvas.height = sourceImage.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setSamSegmenting(false);
        return;
      }
      ctx.putImageData(sourceImage, 0, 0);

      const detected = await samAutoSegment(canvas, sourceImage, (stage, progress) => {
        setSamProgress({ stage, progress });
      });

      setRegions(detected);
    } catch (error: any) {
      console.error('[SplitImage] SAM segmentation failed:', error);
      alert(`SAM 智能拆分失败: ${error.message || '未知错误'}`);
    } finally {
      setSamSegmenting(false);
      setSamProgress({ stage: '', progress: 0 });
    }
  }, [sourceImage]);

  // Toggle region enabled
  const toggleRegion = useCallback((id: number) => {
    setRegions((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
  }, []);

  // Remove a region
  const removeRegion = useCallback((id: number) => {
    setRegions((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // Rename a region
  const renameRegion = useCallback((id: number, name: string) => {
    setRegions((prev) =>
      prev.map((r) => (r.id === id ? { ...r, name } : r)),
    );
  }, []);

  // Handle split
  const handleSplit = useCallback(() => {
    if (!sourceImage || regions.length === 0) return;
    setSplitting(true);

    const enabledRegions = regions.filter((r) => r.enabled);
    if (enabledRegions.length === 0) {
      setSplitting(false);
      return;
    }

    const regionPixels = enabledRegions.map((r) => r.pixels);
    const baseName = '拆分';

    splitImageToParts(baseName, sourceImage, regionPixels);

    setSplitting(false);
    onOpenChange(false);
    // Reset state
    setSourceImage(null);
    setSourceImageUrl('');
    setRegions([]);
  }, [sourceImage, regions, splitImageToParts, onOpenChange]);

  // Reset dialog when closed
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      onOpenChange(newOpen);
      if (!newOpen) {
        setSourceImage(null);
        setSourceImageUrl('');
        setRegions([]);
      }
    },
    [onOpenChange],
  );

  const enabledCount = regions.filter((r) => r.enabled).length;
  const totalPixels = regions.reduce((sum, r) => sum + (r.enabled ? r.pixels.length : 0), 0);

  // SAM progress display text
  const getSamProgressText = useCallback(() => {
    const { stage, progress } = samProgress;
    switch (stage) {
      case 'init':
        return progress < 30 ? '下载 AI 模型中...' : progress < 70 ? '加载模型中...' : '初始化推理引擎...';
      case 'encode':
        return '图像编码中...';
      case 'segment':
        return `智能分割中... ${progress}%`;
      default:
        return '准备中...';
    }
  }, [samProgress]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="size-5" />
            拆分图像
          </DialogTitle>
          <DialogDescription>
            导入PNG图像，自动检测连通区域，将每个区域拆分为独立部件。支持颜色检测和AI智能分割两种模式。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Import section */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="gap-1.5"
            >
              <Upload className="size-3.5" />
              导入图像
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/webp,image/gif,image/jpeg"
              className="hidden"
              onChange={handleImport}
            />
            {sourceImage && (
              <span className="text-xs text-muted-foreground">
                {sourceImage.width} x {sourceImage.height} px
              </span>
            )}
          </div>

          {/* Preview canvas */}
          {sourceImage && (
            <div className="border rounded-md overflow-hidden bg-muted/30 flex items-center justify-center p-2">
              <canvas
                ref={previewCanvasRef}
                className="max-w-full max-h-64"
                style={{ imageRendering: sourceImage.width <= 128 ? 'pixelated' : 'auto' }}
              />
            </div>
          )}

          {/* Detection controls - two modes */}
          {sourceImage && (
            <div className="space-y-3">
              {/* Color-based detection */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">容差</Label>
                  <Slider
                    className="flex-1"
                    value={[tolerance]}
                    min={0}
                    max={255}
                    step={1}
                    onValueChange={([v]) => setTolerance(v)}
                  />
                  <span className="text-xs text-muted-foreground w-8 text-right">{tolerance}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAutoDetect}
                  disabled={detecting || samSegmenting}
                  className="gap-1.5"
                >
                  <Wand2 className="size-3.5" />
                  {detecting ? '检测中...' : '颜色检测'}
                </Button>
              </div>

              {/* SAM-based detection */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-[10px] text-muted-foreground">
                    AI 智能分割：基于语义理解自动识别图像中的不同对象区域，无需调参
                  </p>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSAMSegment}
                  disabled={detecting || samSegmenting}
                  className="gap-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
                >
                  {samSegmenting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Brain className="size-3.5" />
                  )}
                  {samSegmenting ? getSamProgressText() : 'AI 智能拆分'}
                </Button>
              </div>
            </div>
          )}

          {/* Regions list */}
          {regions.length > 0 && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                  检测到 {regions.length} 个区域 ({enabledCount} 个启用, {totalPixels} 像素)
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1"
                    onClick={() => setRegions((prev) => prev.map((r) => ({ ...r, enabled: true })))}
                  >
                    全选
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1"
                    onClick={() => setRegions((prev) => prev.map((r) => ({ ...r, enabled: false })))}
                  >
                    全不选
                  </Button>
                </div>
              </div>
              <ScrollArea className="max-h-48">
                <div className="space-y-1 pr-2">
                  {regions.map((region) => (
                    <div
                      key={region.id}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                        region.enabled ? 'bg-muted/50' : 'bg-muted/20 opacity-60'
                      }`}
                    >
                      {/* Color swatch */}
                      <div
                        className="size-4 rounded-sm border border-white/20 shrink-0 cursor-pointer"
                        style={{ backgroundColor: region.enabled ? region.color : '#666' }}
                        onClick={() => toggleRegion(region.id)}
                      />
                      {/* Name */}
                      <Input
                        value={region.name}
                        onChange={(e) => renameRegion(region.id, e.target.value)}
                        className="h-6 text-xs px-1.5 py-0 flex-1 bg-transparent border-transparent hover:border-border focus:border-border"
                        disabled={!region.enabled}
                      />
                      {/* Pixel count */}
                      <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                        {region.pixels.length}px
                      </span>
                      {/* Toggle */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-5 shrink-0"
                        onClick={() => toggleRegion(region.id)}
                        title={region.enabled ? '禁用' : '启用'}
                      >
                        {region.enabled ? (
                          <Check className="size-3 text-green-500" />
                        ) : (
                          <X className="size-3 text-muted-foreground" />
                        )}
                      </Button>
                      {/* Remove */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-5 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeRegion(region.id)}
                        title="移除"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSplit}
            disabled={!sourceImage || regions.filter((r) => r.enabled).length === 0 || splitting}
            className="gap-1.5"
          >
            <Scissors className="size-3.5" />
            {splitting ? '拆分中...' : `拆分 (${enabledCount})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
