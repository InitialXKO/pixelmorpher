'use client';

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Grid3x3,
  ScanLine,
  FileJson,
  X,
  Check,
  Eye,
  EyeOff,
  Download,
  ImageIcon,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type { PixelGrid } from '@/lib/types';
import { rgbaToHexOrNull } from '@/lib/engine/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

// ---- Types ----

type SliceMode = 'grid' | 'manual' | 'atlas';

interface SliceRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
  label: string;
}

// ---- Overlay colors for region numbering ----

const REGION_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f43f5e', '#a855f7', '#0ea5e9', '#84cc16',
  '#d946ef', '#fb923c', '#64748b', '#fbbf24',
];

// ---- Props ----

interface SpritesheetImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---- Component ----

export default function SpritesheetImportDialog({ open, onOpenChange }: SpritesheetImportDialogProps) {
  const addPart = useProjectStore((s) => s.addPart);
  const setPartPixels = useProjectStore((s) => s.setPartPixels);
  const addAnimationClip = useProjectStore((s) => s.addAnimationClip);
  const updateAnimationClip = useProjectStore((s) => s.updateAnimationClip);
  const parts = useProjectStore((s) => s.parts);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imageData, setImageData] = useState<HTMLImageElement | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [sliceMode, setSliceMode] = useState<SliceMode>('grid');

  // Grid settings
  const [gridCols, setGridCols] = useState(4);
  const [gridRows, setGridRows] = useState(4);
  const [frameWidth, setFrameWidth] = useState(32);
  const [frameHeight, setFrameHeight] = useState(32);
  const [padding, setPadding] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);

  // Manual regions
  const [manualRegions, setManualRegions] = useState<SliceRegion[]>([]);
  const [newRegionX, setNewRegionX] = useState(0);
  const [newRegionY, setNewRegionY] = useState(0);
  const [newRegionW, setNewRegionW] = useState(32);
  const [newRegionH, setNewRegionH] = useState(32);

  // Atlas
  const [atlasJson, setAtlasJson] = useState('');

  // Computed regions from current mode
  const regions = useMemo<SliceRegion[]>(() => {
    if (!imageData) return [];

    if (sliceMode === 'grid') {
      const result: SliceRegion[] = [];
      let idx = 0;
      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const x = offsetX + col * (frameWidth + padding);
          const y = offsetY + row * (frameHeight + padding);
          if (x + frameWidth <= imageData.width && y + frameHeight <= imageData.height) {
            result.push({
              id: `grid_${idx}`,
              x,
              y,
              width: frameWidth,
              height: frameHeight,
              enabled: true,
              label: `帧_${idx}`,
            });
            idx++;
          }
        }
      }
      return result;
    }

    if (sliceMode === 'atlas' && atlasJson) {
      try {
        const parsed = JSON.parse(atlasJson);
        const frames = parsed.frames || parsed;
        const result: SliceRegion[] = [];
        let idx = 0;
        if (Array.isArray(frames)) {
          for (const frame of frames) {
            const fr = frame.frame || frame;
            result.push({
              id: `atlas_${idx}`,
              x: fr.x ?? 0,
              y: fr.y ?? 0,
              width: fr.w ?? fr.width ?? 32,
              height: fr.h ?? fr.height ?? 32,
              enabled: true,
              label: frame.filename || `atlas_${idx}`,
            });
            idx++;
          }
        } else if (typeof frames === 'object') {
          for (const [name, frame] of Object.entries(frames)) {
            const fr = (frame as any).frame || frame;
            result.push({
              id: `atlas_${idx}`,
              x: (fr as any).x ?? 0,
              y: (fr as any).y ?? 0,
              width: (fr as any).w ?? (fr as any).width ?? 32,
              height: (fr as any).h ?? (fr as any).height ?? 32,
              enabled: true,
              label: name,
            });
            idx++;
          }
        }
        return result;
      } catch {
        return [];
      }
    }

    return manualRegions;
  }, [sliceMode, imageData, gridCols, gridRows, frameWidth, frameHeight, padding, offsetX, offsetY, manualRegions, atlasJson]);

  // Import options
  const [createClip, setCreateClip] = useState(true);
  const [clipName, setClipName] = useState('');
  const [partPrefix, setPartPrefix] = useState('');

  // Reset on open
  useEffect(() => {
    if (open) {
      setImageData(null);
      setImageSrc(null);
      setSliceMode('grid');
      setGridCols(4);
      setGridRows(4);
      setFrameWidth(32);
      setFrameHeight(32);
      setPadding(0);
      setOffsetX(0);
      setOffsetY(0);
      setManualRegions([]);
      setAtlasJson('');
      setCreateClip(true);
      setClipName('');
      setPartPrefix('');
    }
  }, [open]);

  // Draw preview canvas with overlays
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageData || !imageSrc) return;

    const maxW = 400;
    const maxH = 300;
    const scale = Math.min(maxW / imageData.width, maxH / imageData.height, 2);
    const drawW = Math.round(imageData.width * scale);
    const drawH = Math.round(imageData.height * scale);

    canvas.width = drawW;
    canvas.height = drawH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, drawW, drawH);

    // Draw image
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, drawW, drawH);

      // Draw region overlays
      regions.forEach((region, idx) => {
        if (!region.enabled) return;
        const rx = region.x * scale;
        const ry = region.y * scale;
        const rw = region.width * scale;
        const rh = region.height * scale;

        const color = REGION_COLORS[idx % REGION_COLORS.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx, ry, rw, rh);

        // Number badge
        ctx.fillStyle = color;
        ctx.fillRect(rx, ry, 12, 12);
        ctx.fillStyle = '#fff';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(idx), rx + 6, ry + 6);
      });
    };
    img.src = imageSrc;
  }, [imageData, imageSrc, regions]);

  const handleLoadImage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        setImageData(img);
        setImageSrc(ev.target?.result as string);
        // Auto-set grid params
        setFrameWidth(Math.floor(img.width / gridCols));
        setFrameHeight(Math.floor(img.height / gridRows));
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [gridCols, gridRows]);

  const handleAddManualRegion = useCallback(() => {
    const region: SliceRegion = {
      id: `manual_${Date.now()}`,
      x: newRegionX,
      y: newRegionY,
      width: newRegionW,
      height: newRegionH,
      enabled: true,
      label: `区域_${manualRegions.length}`,
    };
    setManualRegions((prev) => [...prev, region]);
  }, [newRegionX, newRegionY, newRegionW, newRegionH, manualRegions.length]);

  const handleRemoveRegion = useCallback((id: string) => {
    setManualRegions((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleToggleRegion = useCallback((id: string) => {
    setManualRegions((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  }, []);

  const handleImport = useCallback(() => {
    if (!imageData) return;

    const store = useProjectStore.getState();
    store.pushUndo('导入精灵表');

    const enabledRegions = regions.filter((r) => r.enabled);
    const prefix = partPrefix || '精灵_';

    // Create a temporary canvas to extract pixel data
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imageData.width;
    tempCanvas.height = imageData.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;
    tempCtx.imageSmoothingEnabled = false;
    tempCtx.drawImage(imageData, 0, 0);
    const fullImageData = tempCtx.getImageData(0, 0, imageData.width, imageData.height);

    const createdPartIds: string[] = [];

    for (const region of enabledRegions) {
      const part = addPart(`${prefix}${region.label}`, region.width, region.height);

      // Extract pixel data for this region
      const pixels: PixelGrid = [];
      for (let y = 0; y < region.height; y++) {
        const row: (string | null)[] = [];
        for (let x = 0; x < region.width; x++) {
          const srcX = region.x + x;
          const srcY = region.y + y;
          const pixIdx = (srcY * imageData.width + srcX) * 4;
          const r = fullImageData.data[pixIdx];
          const g = fullImageData.data[pixIdx + 1];
          const b = fullImageData.data[pixIdx + 2];
          const a = fullImageData.data[pixIdx + 3];
          row.push(rgbaToHexOrNull(r, g, b, a));
        }
        pixels.push(row);
      }
      setPartPixels(part.id, pixels);
      createdPartIds.push(part.id);
    }

    // Optionally create animation clip
    if (createClip && createdPartIds.length > 0) {
      const name = clipName || `${prefix}动画`;
      const clip = addAnimationClip(name);
      // Add tracks for each part
      const tracks = createdPartIds.map((partId, idx) => ({
        id: crypto.randomUUID(),
        partId,
        visible: true,
        locked: false,
        expanded: false,
        zIndex: idx,
      }));
      updateAnimationClip(clip.id, { tracks });
    }

    onOpenChange(false);
  }, [imageData, regions, partPrefix, createClip, clipName, addPart, setPartPixels, addAnimationClip, updateAnimationClip, onOpenChange]);

  const enabledCount = regions.filter((r) => r.enabled).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] bg-[#0d0d1a] border-[#1e1e3a] text-gray-300 max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-gray-200">精灵表导入</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-4 p-1">
            {/* Image loading */}
            <div className="space-y-2">
              <Label className="text-[10px] text-gray-500 uppercase tracking-wider">图像源</Label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[10px] gap-1 border-[#1e1e3a] hover:bg-[#1a1a3a]"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageIcon className="size-3" /> 加载图像
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleLoadImage}
                />
                {imageData && (
                  <span className="text-[9px] text-gray-500">
                    {imageData.width}×{imageData.height}px · {regions.length} 区域 · {enabledCount} 启用
                  </span>
                )}
              </div>
            </div>

            {/* Preview canvas */}
            {imageSrc && (
              <div className="border border-[#1e1e3a] rounded bg-[#080818] p-1 flex items-center justify-center">
                <canvas
                  ref={canvasRef}
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
            )}

            {/* Slice mode tabs */}
            {imageData && (
              <>
                <div className="flex items-center gap-1">
                  {([
                    { key: 'grid' as SliceMode, label: '网格', icon: <Grid3x3 className="size-3" /> },
                    { key: 'manual' as SliceMode, label: '手动', icon: <ScanLine className="size-3" /> },
                    { key: 'atlas' as SliceMode, label: '图集 JSON', icon: <FileJson className="size-3" /> },
                  ]).map((tab) => (
                    <button
                      key={tab.key}
                      className={`flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                        sliceMode === tab.key
                          ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                          : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                      }`}
                      onClick={() => setSliceMode(tab.key)}
                    >
                      {tab.icon} {tab.label}
                    </button>
                  ))}
                </div>

                {/* Grid settings */}
                {sliceMode === 'grid' && (
                  <div className="grid grid-cols-3 gap-2 bg-[#111128] rounded border border-[#1e1e3a] p-2">
                    <div className="space-y-1">
                      <Label className="text-[9px] text-gray-600">列数</Label>
                      <Input
                        type="number"
                        min={1}
                        value={gridCols}
                        onChange={(e) => setGridCols(Math.max(1, Number(e.target.value)))}
                        className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[9px] text-gray-600">行数</Label>
                      <Input
                        type="number"
                        min={1}
                        value={gridRows}
                        onChange={(e) => setGridRows(Math.max(1, Number(e.target.value)))}
                        className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[9px] text-gray-600">帧宽</Label>
                      <Input
                        type="number"
                        min={1}
                        value={frameWidth}
                        onChange={(e) => setFrameWidth(Math.max(1, Number(e.target.value)))}
                        className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[9px] text-gray-600">帧高</Label>
                      <Input
                        type="number"
                        min={1}
                        value={frameHeight}
                        onChange={(e) => setFrameHeight(Math.max(1, Number(e.target.value)))}
                        className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[9px] text-gray-600">间距</Label>
                      <Input
                        type="number"
                        min={0}
                        value={padding}
                        onChange={(e) => setPadding(Math.max(0, Number(e.target.value)))}
                        className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[9px] text-gray-600">偏移X</Label>
                      <Input
                        type="number"
                        value={offsetX}
                        onChange={(e) => setOffsetX(Number(e.target.value))}
                        className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[9px] text-gray-600">偏移Y</Label>
                      <Input
                        type="number"
                        value={offsetY}
                        onChange={(e) => setOffsetY(Number(e.target.value))}
                        className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a]"
                      />
                    </div>
                  </div>
                )}

                {/* Manual mode */}
                {sliceMode === 'manual' && (
                  <div className="space-y-2">
                    <div className="flex items-end gap-1 bg-[#111128] rounded border border-[#1e1e3a] p-2">
                      <div className="space-y-1">
                        <Label className="text-[8px] text-gray-600">X</Label>
                        <Input
                          type="number"
                          value={newRegionX}
                          onChange={(e) => setNewRegionX(Number(e.target.value))}
                          className="h-5 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] w-14"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[8px] text-gray-600">Y</Label>
                        <Input
                          type="number"
                          value={newRegionY}
                          onChange={(e) => setNewRegionY(Number(e.target.value))}
                          className="h-5 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] w-14"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[8px] text-gray-600">宽</Label>
                        <Input
                          type="number"
                          min={1}
                          value={newRegionW}
                          onChange={(e) => setNewRegionW(Math.max(1, Number(e.target.value)))}
                          className="h-5 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] w-14"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[8px] text-gray-600">高</Label>
                        <Input
                          type="number"
                          min={1}
                          value={newRegionH}
                          onChange={(e) => setNewRegionH(Math.max(1, Number(e.target.value)))}
                          className="h-5 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] w-14"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-cyan-400"
                        onClick={handleAddManualRegion}
                      >
                        <Plus className="size-3" />
                      </Button>
                    </div>

                    {/* Region list */}
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {manualRegions.map((region, idx) => (
                        <div
                          key={region.id}
                          className={`flex items-center gap-1 px-1.5 py-1 rounded border text-[9px] ${
                            region.enabled
                              ? 'bg-[#111128] border-[#1e1e3a]'
                              : 'bg-[#0a0a18] border-[#1e1e3a]/50 opacity-60'
                          }`}
                        >
                          <div
                            className="size-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: REGION_COLORS[idx % REGION_COLORS.length] }}
                          />
                          <span className="text-gray-400 flex-1 truncate">{region.label}</span>
                          <span className="text-gray-600">
                            {region.x},{region.y} {region.width}×{region.height}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`size-4 ${region.enabled ? 'text-cyan-400' : 'text-gray-700'}`}
                            onClick={() => handleToggleRegion(region.id)}
                          >
                            {region.enabled ? <Eye className="size-2.5" /> : <EyeOff className="size-2.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-4 text-red-400"
                            onClick={() => handleRemoveRegion(region.id)}
                          >
                            <Trash2 className="size-2.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Atlas mode */}
                {sliceMode === 'atlas' && (
                  <div className="space-y-2">
                    <Label className="text-[9px] text-gray-600">粘贴 JSON (TexturePicker / Aseprite / 通用格式)</Label>
                    <textarea
                      value={atlasJson}
                      onChange={(e) => setAtlasJson(e.target.value)}
                      placeholder='{"frames": {"sprite_0": {"frame": {"x": 0, "y": 0, "w": 32, "h": 32}}, ...}}'
                      className="w-full h-32 text-[9px] bg-[#080818] border border-[#1e1e3a] rounded p-2 text-gray-400 font-mono resize-none"
                    />
                  </div>
                )}

                {/* Region count */}
                <div className="text-[9px] text-gray-600 text-center">
                  共 {regions.length} 区域 · {enabledCount} 启用
                </div>

                {/* Import options */}
                <div className="space-y-2 border-t border-[#1e1e3a] pt-3">
                  <Label className="text-[10px] text-gray-500 uppercase tracking-wider">导入选项</Label>

                  <div className="flex items-center gap-1">
                    <Label className="text-[9px] text-gray-600 w-14">部件前缀</Label>
                    <Input
                      value={partPrefix}
                      onChange={(e) => setPartPrefix(e.target.value)}
                      placeholder="精灵_"
                      className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={createClip}
                      onChange={(e) => setCreateClip(e.target.checked)}
                      className="accent-cyan-500"
                    />
                    <Label className="text-[9px] text-gray-500">同时创建动画片段</Label>
                  </div>

                  {createClip && (
                    <div className="flex items-center gap-1 ml-4">
                      <Label className="text-[9px] text-gray-600">片段名</Label>
                      <Input
                        value={clipName}
                        onChange={(e) => setClipName(e.target.value)}
                        placeholder="精灵动画"
                        className="h-6 text-[10px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t border-[#1e1e3a] pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-gray-400"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            size="sm"
            className="text-xs bg-cyan-600 hover:bg-cyan-500 gap-1"
            onClick={handleImport}
            disabled={!imageData || enabledCount === 0}
          >
            <Download className="size-3" /> 导入 ({enabledCount})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
