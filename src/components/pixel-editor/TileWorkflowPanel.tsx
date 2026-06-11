'use client';

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Upload, Wand2, ChevronRight, ChevronLeft, RefreshCw, Grid3x3,
  Download, Paintbrush, Settings2, Layers, Sparkles, Pencil,
} from 'lucide-react';
import { useTileWorkflowStore } from '@/lib/tile-workflow-store';
import type { WorkflowStep, BlobMaterial, MaterialSource } from '@/lib/tile-workflow-store';
import type { BlobGenParams, TemplateBlendParams, TileGenParams } from '@/lib/tile-blob-engine';
import {
  composeTileFromTemplate,
  drawTileGridToCanvas,
  getAllTileMasks,
  imageDataToTilePixels,
} from '@/lib/tile-blob-engine';

// ============================================================
// TileWorkflowPanel - Right panel for tile mode
// Pure parameter control: step parameters, generation buttons,
// export — NO asset previews (those are in TileAssetPanel on left).
// ============================================================

export default function TileWorkflowPanel() {
  const {
    currentStep,
    setCurrentStep,
    materialA,
    materialB,
    tiles,
  } = useTileWorkflowStore();

  return (
    <div className="flex flex-col h-full bg-[#0a0a16]">
      {/* ---- Step Indicator ---- */}
      <div className="shrink-0 border-b border-zinc-800 bg-[#0e0e1c]">
        <StepIndicator currentStep={currentStep} onStepClick={setCurrentStep} />
      </div>

      {/* ---- Step Content ---- */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#3f3f5a transparent' }}>
        {currentStep === 1 && <Step1Params />}
        {currentStep === 2 && <Step2Params />}
        {currentStep === 3 && <Step3Params />}
      </div>

      {/* ---- Navigation ---- */}
      <div className="shrink-0 flex items-center justify-between p-2 border-t border-zinc-800 bg-[#0e0e1c]">
        <Button
          variant="ghost"
          size="sm"
          className="text-[10px] text-zinc-400 hover:text-zinc-200 h-6 px-2"
          disabled={currentStep === 1}
          onClick={() => setCurrentStep((currentStep - 1) as WorkflowStep)}
        >
          <ChevronLeft className="size-3 mr-0.5" />
          上一步
        </Button>

        <span className="text-[9px] text-zinc-600">
          {currentStep === 1 ? '基础材质' : currentStep === 2 ? '模板合成' : '瓦片生成'}
        </span>

        <Button
          variant="ghost"
          size="sm"
          className="text-[10px] text-zinc-400 hover:text-zinc-200 h-6 px-2"
          disabled={currentStep === 3}
          onClick={() => {
            if (currentStep === 1 && (!materialA.pixels || !materialB.pixels)) return;
            setCurrentStep((currentStep + 1) as WorkflowStep);
          }}
        >
          下一步
          <ChevronRight className="size-3 ml-0.5" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// Step Indicator
// ============================================================

function StepIndicator({ currentStep, onStepClick }: { currentStep: WorkflowStep; onStepClick: (s: WorkflowStep) => void }) {
  const steps = [
    { num: 1, label: '材质', icon: <Paintbrush className="size-3" /> },
    { num: 2, label: '模板', icon: <Grid3x3 className="size-3" /> },
    { num: 3, label: '瓦片', icon: <Layers className="size-3" /> },
  ];

  return (
    <div className="flex items-center px-2 py-1.5 gap-1">
      {steps.map((step, i) => (
        <React.Fragment key={step.num}>
          {i > 0 && <ChevronRight className="size-3 text-zinc-700" />}
          <button
            className={`
              flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors
              ${currentStep === step.num
                ? 'bg-emerald-600/25 text-emerald-300 ring-1 ring-emerald-500/40'
                : currentStep > step.num
                  ? 'text-zinc-400 hover:text-zinc-200'
                  : 'text-zinc-600'
              }
            `}
            onClick={() => onStepClick(step.num as WorkflowStep)}
          >
            {step.icon}
            <span>{step.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

// ============================================================
// Step 1: Material Generation Parameters
// No asset preview — just params for each material slot
// ============================================================

function Step1Params() {
  const { materialA, materialB, generateMaterial } = useTileWorkflowStore();

  const handleGenerateBoth = useCallback(() => {
    generateMaterial('A');
    generateMaterial('B');
  }, [generateMaterial]);

  return (
    <div className="p-2 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
          材质参数
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              className="h-6 text-[9px] bg-emerald-600/80 hover:bg-emerald-500 px-2"
              onClick={handleGenerateBoth}
            >
              <Sparkles className="size-3 mr-1" />
              全部生成
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">生成两种材质</TooltipContent>
        </Tooltip>
      </div>

      {/* Material A params */}
      <MaterialParams slot="A" material={materialA} />

      {/* Material B params */}
      <MaterialParams slot="B" material={materialB} />
    </div>
  );
}

function MaterialParams({ slot, material }: { slot: 'A' | 'B'; material: BlobMaterial }) {
  const { setMaterialSource, setMaterialPixels, setMaterialGenParams, generateMaterial, setMaterialName } = useTileWorkflowStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const pixels = imageDataToTilePixels(imageData);
      setMaterialPixels(slot, pixels);
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  }, [slot, setMaterialPixels]);

  const borderClass = slot === 'A' ? 'border-emerald-800/50 bg-emerald-950/20' : 'border-amber-800/50 bg-amber-950/20';
  const labelClass = slot === 'A' ? 'text-emerald-400' : 'text-amber-400';
  const genBtnClass = slot === 'A' ? 'bg-emerald-600/80 hover:bg-emerald-500' : 'bg-amber-600/80 hover:bg-amber-500';

  return (
    <div className={`border rounded p-2 space-y-1.5 ${borderClass}`}>
      {/* Header: name + source toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-bold ${labelClass}`}>{slot}</span>
          <Input
            value={material.name}
            onChange={(e) => setMaterialName(slot, e.target.value)}
            className="h-5 w-20 text-[10px] bg-white/5 border-white/10 text-gray-300 px-1.5"
          />
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
              material.source === 'import'
                ? (slot === 'A' ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300' : 'bg-amber-600/20 border-amber-500/50 text-amber-300')
                : 'bg-white/5 border-white/10 text-gray-500'
            }`}
            onClick={() => setMaterialSource(slot, 'import')}
          >
            <Upload className="size-2.5 inline mr-0.5" />
            导入
          </button>
          <button
            className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
              material.source === 'generate'
                ? (slot === 'A' ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300' : 'bg-amber-600/20 border-amber-500/50 text-amber-300')
                : 'bg-white/5 border-white/10 text-gray-500'
            }`}
            onClick={() => setMaterialSource(slot, 'generate')}
          >
            <Wand2 className="size-2.5 inline mr-0.5" />
            生成
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Import action */}
      {material.source === 'import' && (
        <Button
          variant="outline"
          size="sm"
          className="w-full h-6 text-[9px] border-zinc-700 text-zinc-400 hover:text-zinc-200"
          onClick={handleImport}
        >
          <Upload className="size-3 mr-1" />
          选择图片文件
        </Button>
      )}

      {/* Generate params */}
      {material.source === 'generate' && (
        <div className="space-y-1">
          <GenParamSlider
            label="种子"
            value={material.genParams.seed}
            min={0} max={9999} step={1}
            onChange={(v) => setMaterialGenParams(slot, { seed: v })}
            isInt
          />
          <GenParamSlider
            label="缩放"
            value={material.genParams.scale}
            min={0.02} max={0.3} step={0.01}
            onChange={(v) => setMaterialGenParams(slot, { scale: v })}
          />
          <GenParamSlider
            label="八度"
            value={material.genParams.octaves}
            min={1} max={6} step={1}
            onChange={(v) => setMaterialGenParams(slot, { octaves: v })}
            isInt
          />
          <GenParamSlider
            label="阈值"
            value={material.genParams.threshold}
            min={0.1} max={0.9} step={0.05}
            onChange={(v) => setMaterialGenParams(slot, { threshold: v })}
          />
          <GenParamSlider
            label="不规则"
            value={material.genParams.irregularity}
            min={0} max={1} step={0.05}
            onChange={(v) => setMaterialGenParams(slot, { irregularity: v })}
          />
          <GenParamSlider
            label="边缘柔化"
            value={material.genParams.edgeSoftness}
            min={0} max={1} step={0.05}
            onChange={(v) => setMaterialGenParams(slot, { edgeSoftness: v })}
          />
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-zinc-500 w-10 shrink-0">色1</span>
            <input
              type="color"
              value={material.genParams.color1}
              onChange={(e) => setMaterialGenParams(slot, { color1: e.target.value })}
              className="w-6 h-5 rounded cursor-pointer border border-white/15 bg-transparent p-0"
            />
            <span className="text-[9px] text-zinc-500 w-4 shrink-0">色2</span>
            <input
              type="color"
              value={material.genParams.color2}
              onChange={(e) => setMaterialGenParams(slot, { color2: e.target.value })}
              className="w-6 h-5 rounded cursor-pointer border border-white/15 bg-transparent p-0"
            />
          </div>

          <Button
            size="sm"
            className={`w-full h-6 text-[9px] ${genBtnClass} px-2`}
            onClick={() => generateMaterial(slot)}
          >
            <Wand2 className="size-3 mr-1" />
            生成材质 {slot}
          </Button>
        </div>
      )}

      {/* Status */}
      {material.pixels && (
        <div className="text-[8px] text-zinc-600">
          {material.width}×{material.height} px · {material.source === 'import' ? '已导入' : '已生成'}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Step 2: Template Blend Parameters
// No template grid preview — that's in TileAssetPanel
// ============================================================

function Step2Params() {
  const {
    materialA, materialB, tileWidth, tileHeight,
    blendParams, setTileSize, setBlendParams,
    setTemplatePreviewMask, setTemplatePreviewEdgeMask,
    templatePreviewMasks, templatePreviewEdgeMasks,
  } = useTileWorkflowStore();

  const hasMaterials = !!materialA.pixels && !!materialB.pixels;

  return (
    <div className="p-2 space-y-2">
      <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
        模板参数
      </span>

      {!hasMaterials && (
        <div className="text-[10px] text-amber-400 bg-amber-950/30 rounded p-2 border border-amber-800/40">
          请先在步骤1中生成或导入两种基础材质
        </div>
      )}

      {/* Tile Size */}
      <div className="space-y-1">
        <span className="text-[9px] text-zinc-500">瓦片尺寸</span>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={4} max={64}
            value={tileWidth}
            onChange={(e) => setTileSize(parseInt(e.target.value) || 16, tileHeight)}
            className="h-5 w-12 text-[10px] text-center bg-white/5 border-white/10 text-gray-300 px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[10px] text-zinc-600">×</span>
          <Input
            type="number"
            min={4} max={64}
            value={tileHeight}
            onChange={(e) => setTileSize(tileWidth, parseInt(e.target.value) || 16)}
            className="h-5 w-12 text-[10px] text-center bg-white/5 border-white/10 text-gray-300 px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[9px] text-zinc-600">px</span>
        </div>
      </div>

      {/* Blend Params */}
      <div className="space-y-1">
        <span className="text-[9px] text-zinc-500">混合参数</span>
        <GenParamSlider
          label="混合宽度"
          value={blendParams.blendWidth}
          min={0} max={8} step={0.5}
          onChange={(v) => setBlendParams({ blendWidth: v })}
        />
        <GenParamSlider
          label="羽化半径"
          value={blendParams.featherRadius}
          min={0} max={4} step={0.5}
          onChange={(v) => setBlendParams({ featherRadius: v })}
        />
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-zinc-500 w-10 shrink-0">混合</span>
          <div className="flex gap-0.5">
            {(['smooth', 'sharp', 'dither'] as const).map((mode) => (
              <button
                key={mode}
                className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                  blendParams.blendMode === mode
                    ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-gray-500'
                }`}
                onClick={() => setBlendParams({ blendMode: mode })}
              >
                {mode === 'smooth' ? '平滑' : mode === 'sharp' ? '锐利' : '抖动'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-zinc-500 w-10 shrink-0">转角</span>
          <div className="flex gap-0.5">
            {(['rounded', 'square', 'chamfer'] as const).map((style) => (
              <button
                key={style}
                className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                  blendParams.cornerStyle === style
                    ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-gray-500'
                }`}
                onClick={() => setBlendParams({ cornerStyle: style })}
              >
                {style === 'rounded' ? '圆角' : style === 'square' ? '直角' : '倒角'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Corner/Edge mask controls for the 3×3 template */}
      <div className="space-y-1">
        <span className="text-[9px] text-zinc-500">模板角点控制
          <span className="text-zinc-600 ml-1">（点击左侧模板瓦片切换）</span>
        </span>
        <div className="text-[8px] text-zinc-600">
          在左面板点击模板瓦片来选中，然后在画布上编辑。每个角点可切换 A/B 材质。
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Step 3: Tile Generation Parameters
// No tile grid — that's in TileAssetPanel
// ============================================================

function Step3Params() {
  const { genParams, tiles, setGenParams, generateAllTiles, regenerateTile, tileWidth, tileHeight } = useTileWorkflowStore();
  const editingTarget = useTileWorkflowStore(s => s.editingTarget);

  return (
    <div className="p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
          生成参数
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              className="h-6 text-[9px] bg-emerald-600/80 hover:bg-emerald-500 px-2"
              onClick={generateAllTiles}
            >
              <RefreshCw className="size-3 mr-1" />
              生成瓦片
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">生成47张瓦片</TooltipContent>
        </Tooltip>
      </div>

      {/* Generation params */}
      <div className="space-y-1">
        <GenParamSlider
          label="变化量"
          value={genParams.variation}
          min={0} max={0.5} step={0.01}
          onChange={(v) => setGenParams({ variation: v })}
        />
        <GenParamSlider
          label="种子"
          value={genParams.seed}
          min={0} max={9999} step={1}
          onChange={(v) => setGenParams({ seed: v })}
          isInt
        />
      </div>

      {/* Tile count */}
      {tiles.length > 0 && (
        <div className="text-[9px] text-zinc-500">
          已生成 <span className="text-emerald-400 font-mono">{tiles.length}</span> 张瓦片
        </div>
      )}

      {/* Selected tile detail — regenerate button */}
      {editingTarget?.type === 'generated_tile' && editingTarget.index !== undefined && tiles[editingTarget.index] && (
        <div className="border border-zinc-800 rounded p-2 space-y-1.5 bg-zinc-900/50">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-emerald-400">
              当前瓦片 #{editingTarget.index}
            </span>
            <div className="flex gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 p-0 text-zinc-400 hover:text-zinc-200"
                    onClick={() => regenerateTile(editingTarget.index!)}
                  >
                    <RefreshCw className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">重新生成此瓦片</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="text-[8px] text-zinc-600">
            边: [{tiles[editingTarget.index].mask.edges.map((e: boolean) => e ? 'B' : 'A').join(', ')}]
            {' | '}
            角: [{tiles[editingTarget.index].mask.corners.map((c: boolean) => c ? 'B' : 'A').join(', ')}]
          </div>
        </div>
      )}

      {/* Export */}
      {tiles.length > 0 && (
        <div className="space-y-1 border-t border-zinc-800/50 pt-2">
          <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">导出</span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[9px] flex-1 border-zinc-700 text-zinc-400 hover:text-zinc-200"
              onClick={() => {
                // Export as sprite sheet
                const store = useTileWorkflowStore.getState();
                const cols = 8;
                const rows = Math.ceil(store.tiles.length / cols);
                const canvas = document.createElement('canvas');
                canvas.width = cols * store.tileWidth;
                canvas.height = rows * store.tileHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                ctx.fillStyle = '#1a1a2e';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                store.tiles.forEach((tile, i) => {
                  const col = i % cols;
                  const row = Math.floor(i / cols);
                  drawTileGridToCanvas(ctx, tile.pixels, col * store.tileWidth, row * store.tileHeight, 1, '#1a1a2e');
                });
                const link = document.createElement('a');
                link.download = 'tiles-spritesheet.png';
                link.href = canvas.toDataURL('image/png');
                link.click();
              }}
            >
              <Download className="size-3 mr-1" />
              精灵图
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[9px] flex-1 border-zinc-700 text-zinc-400 hover:text-zinc-200"
              onClick={() => {
                // Export individual tiles as a single zip-like download
                const store = useTileWorkflowStore.getState();
                const cols = 8;
                const rows = Math.ceil(store.tiles.length / cols);
                const canvas = document.createElement('canvas');
                canvas.width = cols * store.tileWidth;
                canvas.height = rows * store.tileHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                ctx.fillStyle = '#00000000';
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                store.tiles.forEach((tile, i) => {
                  const col = i % cols;
                  const row = Math.floor(i / cols);
                  drawTileGridToCanvas(ctx, tile.pixels, col * store.tileWidth, row * store.tileHeight, 1, undefined);
                });
                const link = document.createElement('a');
                link.download = 'tiles-transparent.png';
                link.href = canvas.toDataURL('image/png');
                link.click();
              }}
            >
              <Layers className="size-3 mr-1" />
              透明背景
            </Button>
          </div>
        </div>
      )}

      {tiles.length === 0 && (
        <div className="text-[10px] text-zinc-600 text-center py-4">
          点击"生成瓦片"以从模板创建47张瓦片
        </div>
      )}
    </div>
  );
}

// ============================================================
// Shared: Parameter Slider
// ============================================================

function GenParamSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  isInt = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  isInt?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-zinc-500 w-10 shrink-0">{label}</span>
      <Slider
        className="flex-1"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(isInt ? Math.round(v) : v)}
      />
      <span className="text-[9px] text-zinc-500 w-8 text-right font-mono">
        {isInt ? Math.round(value) : value.toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)}
      </span>
    </div>
  );
}
