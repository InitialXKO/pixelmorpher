'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import { useAssetStore } from '@/lib/asset-store';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Paintbrush,
  Flame,
  Sun,
  Moon,
  Download,
  Save,
  FolderOpen,
} from 'lucide-react';
import type { BrushStyleType } from '@/lib/types';
import { BUILT_IN_BRUSH_PRESETS } from '@/lib/brush-presets';
import { BRUSH_STYLE_LABELS } from '@/lib/brush-engine';
import { applyTheme, loadTheme, type ThemeMode } from '@/lib/theme';
import { useToast } from '@/hooks/use-toast';
import WorkspaceSwitcher from '@/components/pixel-editor/WorkspaceSwitcher';
import NewCharacterMenu from '@/components/pixel-editor/NewCharacterMenu';

// Sub-components
import { MAX_RECENT_COLORS } from './toolbar/constants';
import BrushPresetThumbnail from './toolbar/BrushPresetThumbnail';
import BrushStyleParamsEditor from './toolbar/BrushStyleParamsEditor';
import ComposableStyleEditor from './toolbar/ComposableStyleEditor';
import {
  MagicWandControls,
  SmartSelectStatus,
  InpaintControls,
  LandmarkControls,
  MarkControls,
  MotionBlurBrushControls,
  EffectBrushControls,
  MoveToolControls,
} from './toolbar/ToolOptionPanels';
import { PreviewQualitySelect } from './toolbar/ViewControls';
import { UndoRedoControls } from './toolbar/UndoRedoControls';

// ============================================================
// Toolbar - Top toolbar for PixelMorpher (V2.0)
// ============================================================

interface ToolbarProps {
  onExportClick?: () => void;
}

export default function Toolbar({ onExportClick }: ToolbarProps) {
  // ---- Store selectors (only what's needed directly in this component) ----
  const name = useProjectStore((s) => s.name);
  const setProjectName = useProjectStore((s) => s.setProjectName);

  const tool = useEditorStore((s) => s.tool);
  const brushSize = useEditorStore((s) => s.brushSize);
  const brushColor = useEditorStore((s) => s.brushColor);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const setBrushColor = useEditorStore((s) => s.setBrushColor);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const editMode = useEditorStore((s) => s.editMode);
  // Brush style
  const brushStyle = useEditorStore((s) => s.brushStyle);
  const brushStyleParams = useEditorStore((s) => s.brushStyleParams);
  const setBrushStyle = useEditorStore((s) => s.setBrushStyle);
  const setBrushStyleParams = useEditorStore((s) => s.setBrushStyleParams);
  const applyBrushPreset = useEditorStore((s) => s.applyBrushPreset);
  // Motion blur
  const autoMotionBlur = useEditorStore((s) => s.autoMotionBlur);
  const autoMotionBlurIntensity = useEditorStore((s) => s.autoMotionBlurIntensity);
  const setAutoMotionBlur = useEditorStore((s) => s.setAutoMotionBlur);
  const setAutoMotionBlurIntensity = useEditorStore((s) => s.setAutoMotionBlurIntensity);

  // Brush presets
  const brushPresets = useProjectStore((s) => s.brushPresets);
  const allBrushPresets = [...BUILT_IN_BRUSH_PRESETS, ...brushPresets];

  // Sprites (for export disabled state) and selection (for correction toggle guard)
  const sprites = useProjectStore((s) => s.sprites);
  const selectedSpriteId = useEditorStore((s) => s.selectedSpriteId);

  // Toast for user-facing errors
  const { toast } = useToast();

  // ---- Local state ----
  const [isDark, setIsDark] = useState<ThemeMode>('dark');
  const [recentColors, setRecentColors] = useState<string[]>(['#ffffff', '#ff4444', '#00aaff', '#ffcc88', '#000000']);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(name);
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Brush size text input (reverts to brushSize on invalid input/blur)
  const [sizeText, setSizeText] = useState(String(brushSize));

  // Blend mode for motion blur / effect brushes — lives in the editor store so the
  // canvas commit path can read it (previously local state that never reached strokes)
  const blendMode = useEditorStore((s) => s.strokeBlendMode);
  const setBlendMode = useEditorStore((s) => s.setStrokeBlendMode);

  // Brush preset dropdown state
  const [showBrushPresets, setShowBrushPresets] = useState(false);

  // Save/Load refs
  const loadInputRef = useRef<HTMLInputElement>(null);

  // Sync name input when project name changes externally
  useEffect(() => {
    setNameInput(name);
  }, [name]);

  // Sync size text when brush size changes externally (e.g. preset applied)
  useEffect(() => {
    setSizeText(String(brushSize));
  }, [brushSize]);

  // Load saved theme on mount
  useEffect(() => {
    const savedTheme = loadTheme();
    setIsDark(savedTheme);
    applyTheme(savedTheme);
  }, []);

  // Focus the name input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  // ---- Color handling ----
  const addRecentColor = useCallback((color: string) => {
    setRecentColors((prev) => {
      const filtered = prev.filter((c) => c !== color);
      return [color, ...filtered].slice(0, MAX_RECENT_COLORS);
    });
  }, []);

  const handleColorChange = useCallback(
    (color: string) => {
      setBrushColor(color);
      addRecentColor(color);
    },
    [setBrushColor, addRecentColor],
  );

  // ---- Name editing ----
  const handleNameSubmit = useCallback(() => {
    setProjectName(nameInput.trim() || 'Untitled');
    setIsEditingName(false);
  }, [nameInput, setProjectName]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleNameSubmit();
      if (e.key === 'Escape') {
        setNameInput(name);
        setIsEditingName(false);
      }
    },
    [handleNameSubmit, name],
  );

  // ---- Brush size validation ----
  // Invalid input keeps the typed text while editing, reverts on blur
  const handleBrushSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setSizeText(raw);
      const val = parseInt(raw, 10);
      if (!isNaN(val)) {
        setBrushSize(Math.max(1, Math.min(10, val)));
      }
    },
    [setBrushSize],
  );

  const handleBrushSizeBlur = useCallback(() => {
    if (isNaN(parseInt(sizeText, 10))) {
      setSizeText(String(brushSize));
    }
  }, [sizeText, brushSize]);

  // ---- Save/Load handlers ----
  const handleSaveProject = useCallback(() => {
    const projectFile = useProjectStore.getState().exportProjectFile();
    const json = JSON.stringify(projectFile, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.pxm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [name]);

  const handleLoadProject = useCallback(() => {
    loadInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (!file.name.endsWith('.pxm')) {
        toast({ title: '无法加载', description: '请选择 .pxm 工程文件', variant: 'destructive' });
        return;
      }
      // 与项目主页导入同口径：走 asset-store 的 importProjectFromFile
      // （新建工程 ID + 落库 + 建条目 + 绑定 currentProjectId）。
      // 此前这里只调 importProjectFile 把内容灌进 store、不绑 ID，
      // 「返回主页」时 saveCurrentProject 按旧 ID 落盘，会把导入内容
      // 覆盖回此前打开的 DB 工程、原数据静默丢失。
      const meta = await useAssetStore.getState().importProjectFromFile(file);
      if (!meta) {
        toast({ title: '加载失败', description: '文件损坏或格式不正确', variant: 'destructive' });
      }
    },
    [toast],
  );

  // ---- Tool conditional display ----
  const showBrushOptions = tool === 'brush' || tool === 'eraser';
  const showCorrectionToggle = tool === 'brush' || tool === 'eraser' || tool === 'fill';
  const showColorPicker = tool === 'brush';
  const isMotionBlurBrush = tool === 'motion_blur_brush';
  const isEffectBrush = tool === 'glow_brush' || tool === 'particle_brush' || tool === 'afterimage_brush';
  const isLassoTool = tool === 'lasso';
  const isMagicWandTool = tool === 'magic_wand';
  const isMoveTool = tool === 'move';

  return (
    <div className="flex items-center h-11 min-h-[44px] px-2 gap-1 border-b border-white/10 bg-[#12121f] select-none overflow-x-auto">
      {/* ---- Project Name ---- */}
      <div className="flex items-center mr-1 shrink-0">
        {isEditingName ? (
          <Input
            ref={nameInputRef}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleNameKeyDown}
            className="h-7 w-32 text-xs bg-white/5 border-white/10 text-gray-200 px-2"
          />
        ) : (
          <button
            onClick={() => setIsEditingName(true)}
            className="text-sm font-semibold text-purple-400 hover:text-purple-300 transition-colors truncate max-w-[120px]"
            title="Click to rename project"
          >
            {name}
          </button>
        )}
      </div>

      {/* ---- Save / Load Buttons ---- */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-400 hover:bg-white/5 hover:text-gray-200"
            onClick={handleSaveProject}
          >
            <Save className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">保存工程 (.pxm)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-400 hover:bg-white/5 hover:text-gray-200"
            onClick={handleLoadProject}
          >
            <FolderOpen className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">打开工程 (.pxm)</TooltipContent>
      </Tooltip>

      {/* Hidden file input for loading */}
      <input
        ref={loadInputRef}
        type="file"
        accept=".pxm"
        className="hidden"
        onChange={handleFileChange}
      />

      <Separator orientation="vertical" className="h-5 bg-white/10" />

      {/* ---- Workspace Switcher ---- */}
      <WorkspaceSwitcher />

      <Separator orientation="vertical" className="h-5 bg-white/10" />

      {/* ---- 新建角色（统一入口：全部新建方式 + 对话框唯一宿主） ---- */}
      <NewCharacterMenu />

      <Separator orientation="vertical" className="h-5 bg-white/10" />

      {/* ---- Correction Mode Toggle ---- */}
      {showCorrectionToggle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              pressed={editMode === 'correction'}
              onPressedChange={(pressed) => {
                setEditMode(pressed ? 'correction' : 'normal');
              }}
              aria-label="修正模式"
              className="h-7 px-2 py-0 data-[state=on]:bg-cyan-600/30 data-[state=on]:text-cyan-300 data-[state=on]:ring-cyan-500/50 text-gray-500 hover:bg-white/5 hover:text-gray-200 rounded text-[10px] gap-1"
            >
              <Paintbrush className="size-3" />
              修正
            </Toggle>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            修正模式: 在木偶节点上逐帧补画（笔画记为该节点当前帧的像素修正，非破坏性）
          </TooltipContent>
        </Tooltip>
      )}
      {showCorrectionToggle && editMode === 'correction' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="清除本帧修正"
              className="h-7 px-2 py-0 text-gray-500 hover:bg-white/5 hover:text-red-300 rounded text-[10px]"
              onClick={() => {
                const ps = useProjectStore.getState();
                const nodeId = ps.selectedNodeId;
                if (!nodeId) return;
                for (const ch of Object.values(ps.unifiedCharacters)) {
                  const node = ch.nodes?.[nodeId];
                  if (!node?.frameCorrections?.[ps.currentFrame]) continue;
                  const next = { ...(node.frameCorrections ?? {}) };
                  delete next[ps.currentFrame];
                  ps.pushUndo('清除本帧修正');
                  ps.updateUnifiedNode(ch.id, nodeId, { frameCorrections: next } as any);
                  break;
                }
              }}
            >
              清除本帧修正
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            清除选中节点在当前帧的全部像素修正
          </TooltipContent>
        </Tooltip>
      )}

      <Separator orientation="vertical" className="h-5 bg-white/10" />

      {/* ---- Brush Size + Style + Presets (visible for brush/eraser) ---- */}
      {showBrushOptions && (
        <div className="flex items-center gap-1.5 mx-1 shrink-0">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">Size</span>
          <Input
            type="number"
            min={1}
            max={10}
            value={sizeText}
            onChange={handleBrushSizeChange}
            onBlur={handleBrushSizeBlur}
            className="h-6 w-10 text-xs text-center bg-white/5 border-white/10 text-gray-300 px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          {/* Brush Style Selector */}
          <span className="text-[10px] text-gray-500 uppercase tracking-wide ml-1">样式</span>
          <Select value={brushStyle} onValueChange={(v) => setBrushStyle(v as BrushStyleType)}>
            <SelectTrigger className="h-6 w-20 text-[9px] bg-white/5 border-white/10 text-gray-300 px-1 py-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#1a1a2e] border-white/10 text-gray-200">
              {(Object.entries(BRUSH_STYLE_LABELS) as [BrushStyleType, string][]).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Brush Style Parameters */}
          {brushStyle !== 'solid' && (
            <BrushStyleParamsEditor
              style={brushStyle}
              params={brushStyleParams}
              onChange={setBrushStyleParams}
            />
          )}

          {/* Composable Style Editor */}
          <ComposableStyleEditor />

          {/* Brush Preset Dropdown */}
          <Popover open={showBrushPresets} onOpenChange={setShowBrushPresets}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[9px] text-gray-400 hover:bg-white/5 hover:text-gray-200"
              >
                预设 ▾
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 bg-[#1a1a2e] border-white/10 text-gray-200 p-2" side="bottom" align="start">
              <div className="text-xs font-medium text-gray-300 mb-2">笔刷预设</div>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {allBrushPresets.map((preset) => (
                  <button
                    key={preset.id}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-white/5 text-left transition-colors"
                    onClick={() => {
                      applyBrushPreset(preset);
                      setShowBrushPresets(false);
                    }}
                  >
                    <BrushPresetThumbnail preset={preset} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-gray-200 truncate">{preset.name}</div>
                      <div className="text-[9px] text-gray-500">{preset.size}px · {preset.style && preset.style !== 'solid' ? BRUSH_STYLE_LABELS[preset.style] : preset.type}</div>
                    </div>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* ---- Color Picker (visible for brush) ---- */}
      {showColorPicker && (
        <div className="flex items-center gap-1.5 mx-1 shrink-0">
          <div className="relative">
            <input
              type="color"
              value={brushColor}
              onChange={(e) => handleColorChange(e.target.value)}
              className="w-6 h-6 rounded cursor-pointer border border-white/15 bg-transparent p-0"
              title="Pick color"
            />
          </div>
          {/* Recent colors */}
          <div className="flex items-center gap-0.5">
            {recentColors.map((color) => (
              <button
                key={color}
                onClick={() => handleColorChange(color)}
                className="w-4 h-4 rounded-sm border border-white/10 hover:border-white/30 transition-colors shrink-0"
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </div>
      )}

      {/* ---- Tool-Specific Option Panels ---- */}
      {isMagicWandTool && <MagicWandControls />}
      {tool === 'smart_select' && <SmartSelectStatus />}
      {tool === 'inpaint' && <InpaintControls />}
      {tool === 'landmark' && <LandmarkControls />}
      {tool === 'mark' && <MarkControls />}
      {isMotionBlurBrush && <MotionBlurBrushControls blendMode={blendMode} setBlendMode={setBlendMode} />}
      {isEffectBrush && <EffectBrushControls blendMode={blendMode} setBlendMode={setBlendMode} />}
      {isMoveTool && <MoveToolControls />}

      {/* ---- Auto Motion Blur Toggle (always visible) ---- */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            pressed={autoMotionBlur}
            onPressedChange={setAutoMotionBlur}
            aria-label="Auto Motion Blur"
            className="h-7 w-7 p-0 data-[state=on]:bg-cyan-600/30 data-[state=on]:text-cyan-300 text-gray-500 hover:bg-white/5 hover:text-gray-200 rounded"
          >
            <Flame className="size-3.5" />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">Auto Motion Blur</TooltipContent>
      </Tooltip>

      {/* ---- Auto Motion Blur Settings ---- */}
      {autoMotionBlur && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-cyan-400 hover:bg-cyan-500/10"
            >
              <span className="text-[10px] font-mono">{Math.round(autoMotionBlurIntensity * 100)}%</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 bg-[#1a1a2e] border-white/10 text-gray-200" side="bottom">
            <div className="space-y-3">
              <div className="text-xs font-medium text-gray-300">Auto Motion Blur</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Intensity:</span>
                <Slider
                  className="flex-1"
                  value={[autoMotionBlurIntensity]}
                  min={0.1}
                  max={1}
                  step={0.05}
                  onValueChange={([v]) => setAutoMotionBlurIntensity(v)}
                />
                <span className="text-xs text-gray-400 w-8 text-right">
                  {Math.round(autoMotionBlurIntensity * 100)}%
                </span>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* ---- Conditional Separator ---- */}
      {(showBrushOptions || isMotionBlurBrush || isEffectBrush || isLassoTool || isMagicWandTool || isMoveTool) && <Separator orientation="vertical" className="h-5 bg-white/10" />}

      {/* 视图开关与缩放已迁画布悬浮层（CanvasViewOverlays：开关右上、缩放右下）；
          此处只剩轨迹工具提示（工具语境文案，非视图控制） */}
      {tool === 'trajectory' && (
        <span className="text-[10px] text-purple-400 mx-1">Shift+拖拽 = 手绘轨迹</span>
      )}

      <Separator orientation="vertical" className="h-5 bg-white/10" />

      {/* ---- Undo / Redo ---- */}
      <UndoRedoControls />

      {/* ---- Preview Quality ---- */}
      <PreviewQualitySelect />

      {/* Spacer */}
      <div className="flex-1 min-w-2" />

      {/* ---- Theme Toggle ---- */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-500 hover:bg-white/5 hover:text-gray-300"
            onClick={() => {
              const newMode = isDark === 'dark' ? 'light' : 'dark';
              setIsDark(newMode);
              applyTheme(newMode);
            }}
          >
            {isDark === 'dark' ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {isDark === 'dark' ? '深色模式' : '浅色模式'}
        </TooltipContent>
      </Tooltip>

      {/* ---- Export Button ---- */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={onExportClick}
            disabled={Object.keys(sprites).length === 0}
          >
            <Download className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {Object.keys(sprites).length === 0 ? '导出 (暂无精灵)' : '导出'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
