'use client';

import React, { useRef, useEffect, useMemo } from 'react';
import {
  Paintbrush, Grid3x3, Layers, Wand2, ChevronRight, ChevronDown, Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useTileWorkflowStore } from '@/lib/tile-workflow-store';
import type { TileEditTarget, BlobMaterial } from '@/lib/tile-workflow-store';
import { drawTileGridToCanvas, composeTileFromTemplate } from '@/lib/tile-blob-engine';

// ============================================================
// TileAssetPanel - Left panel for tile mode
// Pure asset navigation: lists materials, template tiles, and
// generated tiles as clickable items to switch canvas editing target.
// NO parameter controls — those are in TileWorkflowPanel (right).
// ============================================================

export default function TileAssetPanel() {
  const {
    currentStep,
    editingTarget,
    setEditingTarget,
    materialA,
    materialB,
    tileWidth,
    tileHeight,
    blendParams,
    templatePreviewMasks,
    templatePreviewEdgeMasks,
    templateManualEdits,
    tiles,
    generateMaterial,
    generateAllTiles,
  } = useTileWorkflowStore();

  // Auto-set editing target when step changes
  useEffect(() => {
    if (currentStep === 1) {
      if (!editingTarget || (editingTarget.type !== 'material_A' && editingTarget.type !== 'material_B')) {
        setEditingTarget({ type: 'material_A', label: materialA.name || '材质 A' });
      }
    } else if (currentStep === 2) {
      if (!editingTarget || editingTarget.type !== 'template_tile') {
        setEditingTarget({ type: 'template_tile', index: 4, label: '模板中心' });
      }
    } else if (currentStep === 3) {
      if (!editingTarget || editingTarget.type !== 'generated_tile') {
        if (tiles.length > 0) {
          setEditingTarget({ type: 'generated_tile', index: 0, label: tiles[0].mask.label });
        }
      }
    }
  }, [currentStep]);

  return (
    <div className="w-[180px] flex flex-col h-full min-h-0 bg-[#0a0a16] border-r border-zinc-800/50">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-zinc-800/50">
        <h3 className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          瓦片资产
        </h3>
        <span className="text-[9px] text-zinc-600">
          步骤 {currentStep}
        </span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#3f3f5a transparent' }}>
        {/* Section: Materials */}
        <AssetSection
          title="基础材质"
          icon={<Paintbrush className="size-3" />}
          defaultOpen={currentStep === 1}
        >
          <MaterialItem
            slot="A"
            material={materialA}
            isActive={editingTarget?.type === 'material_A'}
            onClick={() => setEditingTarget({ type: 'material_A', label: materialA.name || '材质 A' })}
            onQuickGenerate={() => generateMaterial('A')}
          />
          <MaterialItem
            slot="B"
            material={materialB}
            isActive={editingTarget?.type === 'material_B'}
            onClick={() => setEditingTarget({ type: 'material_B', label: materialB.name || '材质 B' })}
            onQuickGenerate={() => generateMaterial('B')}
          />
        </AssetSection>

        {/* Section: Template Grid */}
        <AssetSection
          title="3×3 模板"
          icon={<Grid3x3 className="size-3" />}
          defaultOpen={currentStep === 2}
        >
          <TemplateGrid
            editingTarget={editingTarget}
            onTileClick={(idx) => {
              const row = Math.floor(idx / 3);
              const col = idx % 3;
              const hasManual = !!templateManualEdits[`${row}-${col}`];
              setEditingTarget({
                type: 'template_tile',
                index: idx,
                label: `模板 [${row},${col}]${hasManual ? ' ✎' : ''}`,
              });
            }}
          />
        </AssetSection>

        {/* Section: Generated Tiles */}
        <AssetSection
          title={`瓦片集 (${tiles.length})`}
          icon={<Layers className="size-3" />}
          defaultOpen={currentStep === 3}
        >
          <div className="flex gap-1 mb-1.5">
            <Button
              size="sm"
              className="h-5 text-[8px] bg-emerald-600/80 hover:bg-emerald-500 px-1.5 flex-1"
              onClick={generateAllTiles}
              disabled={!materialA.pixels || !materialB.pixels}
            >
              <Wand2 className="size-2.5 mr-0.5" />
              生成瓦片
            </Button>
          </div>
          {tiles.length > 0 ? (
            <TileSetGrid
              tiles={tiles}
              tileWidth={tileWidth}
              tileHeight={tileHeight}
              selectedIndex={editingTarget?.type === 'generated_tile' ? editingTarget.index ?? -1 : -1}
              onSelect={(idx) => {
                setEditingTarget({
                  type: 'generated_tile',
                  index: idx,
                  label: tiles[idx].mask.label + (tiles[idx].isEdited ? ' ✎' : ''),
                });
              }}
            />
          ) : (
            <div className="text-[9px] text-zinc-600 text-center py-3">
              在右侧面板生成瓦片
            </div>
          )}
        </AssetSection>
      </div>

      {/* Current editing target indicator */}
      {editingTarget && (
        <div className="shrink-0 px-2 py-1.5 border-t border-zinc-800/50 bg-emerald-950/20">
          <div className="flex items-center gap-1">
            <Pencil className="size-2.5 text-emerald-400" />
            <span className="text-[9px] text-emerald-300 font-medium truncate">
              编辑: {editingTarget.label}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Collapsible Section
// ============================================================

function AssetSection({
  title,
  icon,
  defaultOpen,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className="border-b border-zinc-800/30">
      <button
        className="flex items-center gap-1.5 w-full px-2 py-1.5 hover:bg-white/5 transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="size-3 text-zinc-500" />
        ) : (
          <ChevronRight className="size-3 text-zinc-500" />
        )}
        {icon}
        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
          {title}
        </span>
      </button>
      {open && (
        <div className="px-1.5 pb-1.5 space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Material Item — thumbnail + click to select + quick generate
// ============================================================

function MaterialItem({
  slot,
  material,
  isActive,
  onClick,
  onQuickGenerate,
}: {
  slot: 'A' | 'B';
  material: BlobMaterial;
  isActive: boolean;
  onClick: () => void;
  onQuickGenerate: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !material.pixels) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = 2;
    canvas.width = material.width * scale;
    canvas.height = material.height * scale;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawTileGridToCanvas(ctx, material.pixels, 0, 0, scale, '#1a1a2e');
  }, [material.pixels, material.width, material.height]);

  const activeBorder = isActive
    ? slot === 'A' ? 'border-emerald-500/60 bg-emerald-950/30' : 'border-amber-500/60 bg-amber-950/30'
    : 'border-zinc-800/50 hover:border-zinc-700';

  return (
    <div
      className={`flex items-center gap-1.5 px-1.5 py-1 rounded border cursor-pointer transition-colors ${activeBorder}`}
      onClick={onClick}
    >
      {/* Thumbnail */}
      <div className={`size-8 shrink-0 rounded border overflow-hidden ${
        slot === 'A' ? 'border-emerald-800/40' : 'border-amber-800/40'
      }`}>
        {material.pixels ? (
          <canvas
            ref={canvasRef}
            style={{ imageRendering: 'pixelated' }}
            className="size-full"
          />
        ) : (
          <div className="size-full bg-zinc-900 flex items-center justify-center">
            <Paintbrush className="size-3 text-zinc-600" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className={`text-[10px] font-bold ${slot === 'A' ? 'text-emerald-400' : 'text-amber-400'}`}>
          {slot}
        </div>
        <div className="text-[8px] text-zinc-500 truncate">
          {material.name} · {material.width}×{material.height}
        </div>
      </div>

      {/* Quick generate */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`size-5 p-0 ${slot === 'A' ? 'text-emerald-500 hover:text-emerald-300' : 'text-amber-500 hover:text-amber-300'}`}
            onClick={(e) => { e.stopPropagation(); onQuickGenerate(); }}
          >
            <Wand2 className="size-2.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-[9px]">快速生成</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ============================================================
// Template Grid (3×3) — click to select for canvas editing
// ============================================================

function TemplateGrid({
  editingTarget,
  onTileClick,
}: {
  editingTarget: TileEditTarget | null;
  onTileClick: (index: number) => void;
}) {
  const {
    materialA, materialB, tileWidth, tileHeight, blendParams,
    templatePreviewMasks, templatePreviewEdgeMasks, templateManualEdits,
  } = useTileWorkflowStore();

  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  // Compute template tiles
  const templateTiles = useMemo(() => {
    if (!materialA.pixels || !materialB.pixels) return Array(9).fill(null);
    return templatePreviewMasks.map((cornerMask, idx) =>
      composeTileFromTemplate(
        materialA.pixels!, materialB.pixels!,
        tileWidth, tileHeight, blendParams, cornerMask,
        templatePreviewEdgeMasks[idx],
      )
    );
  }, [materialA.pixels, materialB.pixels, tileWidth, tileHeight, blendParams, templatePreviewMasks, templatePreviewEdgeMasks]);

  // Render thumbnails
  useEffect(() => {
    for (let i = 0; i < 9; i++) {
      const canvas = canvasRefs.current[i];
      const tile = templateTiles[i];
      if (!canvas || !tile) continue;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const scale = Math.max(1, Math.min(16 / tileWidth, 16 / tileHeight));
      canvas.width = tileWidth * scale;
      canvas.height = tileHeight * scale;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawTileGridToCanvas(ctx, tile, 0, 0, scale, '#1a1a2e');
    }
  }, [templateTiles, tileWidth, tileHeight]);

  const hasMaterials = !!materialA.pixels && !!materialB.pixels;

  return (
    <div className="space-y-1">
      {!hasMaterials && (
        <div className="text-[9px] text-amber-400/70 px-1 py-1">
          需要先创建材质
        </div>
      )}
      <div className="grid grid-cols-3 gap-px bg-zinc-800/50 p-px rounded">
        {Array.from({ length: 9 }).map((_, i) => {
          const row = Math.floor(i / 3);
          const col = i % 3;
          const isEdited = !!templateManualEdits[`${row}-${col}`];
          const isActive = editingTarget?.type === 'template_tile' && editingTarget.index === i;
          return (
            <button
              key={i}
              className={`relative border transition-colors ${
                isActive
                  ? 'border-emerald-400/60 bg-emerald-950/40'
                  : 'border-zinc-800/50 hover:border-zinc-600'
              }`}
              onClick={() => onTileClick(i)}
              disabled={!hasMaterials}
            >
              <canvas
                ref={(el) => { canvasRefs.current[i] = el; }}
                style={{ imageRendering: 'pixelated' }}
                className="block mx-auto"
              />
              {isEdited && (
                <span className="absolute top-0 right-0 text-[6px] text-emerald-400">✎</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="text-[8px] text-zinc-600 text-center">
        点击选择编辑目标
      </div>
    </div>
  );
}

// ============================================================
// Tile Set Grid — click to select for canvas editing
// ============================================================

function TileSetGrid({
  tiles,
  tileWidth,
  tileHeight,
  selectedIndex,
  onSelect,
}: {
  tiles: any[];
  tileWidth: number;
  tileHeight: number;
  selectedIndex: number;
  onSelect: (idx: number) => void;
}) {
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const zoom = 2;

  useEffect(() => {
    for (let i = 0; i < tiles.length; i++) {
      const canvas = canvasRefs.current[i];
      if (!canvas) continue;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      canvas.width = tileWidth * zoom;
      canvas.height = tileHeight * zoom;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (tiles[i].pixels) {
        drawTileGridToCanvas(ctx, tiles[i].pixels, 0, 0, zoom, '#1a1a2e');
      }
    }
  }, [tiles, tileWidth, tileHeight]);

  const cols = Math.min(6, tiles.length);

  return (
    <div
      className="grid gap-px bg-zinc-800/50 p-px rounded"
      style={{ gridTemplateColumns: `repeat(${cols}, ${tileWidth * zoom}px)` }}
    >
      {tiles.map((tile, i) => (
        <button
          key={i}
          className={`relative border transition-colors ${
            selectedIndex === i
              ? 'border-emerald-400/60 bg-emerald-950/40'
              : 'border-zinc-800/50 hover:border-zinc-600'
          }`}
          onClick={() => onSelect(i)}
        >
          <canvas
            ref={(el) => { canvasRefs.current[i] = el; }}
            style={{ imageRendering: 'pixelated' }}
            className="block"
          />
          {tile.isEdited && (
            <span className="absolute top-0 right-0 text-[5px] text-emerald-400">✎</span>
          )}
        </button>
      ))}
    </div>
  );
}
