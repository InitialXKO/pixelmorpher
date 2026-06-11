'use client';

import React, { useState, useRef, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ImagePlus,
  GripVertical,
  Scissors,
  Grid3x3,
  Crosshair,
  Link,
  Activity,
  Pencil,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Move,
  RotateCw,
  Maximize2,
  Zap,
  ArrowUpFromLine,
  Heart,
  Cloud,
  Rotate3d,
  Timer,
  Radio,
  Code2,
  Shuffle,
  Globe,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type { Part, GlobalModifierType, GlobalModifier, ModifierParamValue } from '@/lib/types';
import { GLOBAL_MODIFIER_DEFINITIONS } from '@/lib/types';
import SplitImageDialog from '@/components/pixel-editor/SplitImageDialog';
import MotionAnalysisDialog from '@/components/pixel-editor/MotionAnalysisDialog';
import ResizePreviewDialog from '@/components/pixel-editor/ResizePreviewDialog';
import SpritesheetImportDialog from '@/components/pixel-editor/SpritesheetImportDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from '@/components/ui/context-menu';

// ---- Icon map for modifier types ----

const TYPE_ICONS: Record<string, React.ReactNode> = {
  translate: <Move className="size-3" />,
  rotate: <RotateCw className="size-3" />,
  uniform_scale: <Maximize2 className="size-3" />,
  shake: <Zap className="size-3" />,
  bounce: <ArrowUpFromLine className="size-3" />,
  breath: <Heart className="size-3" />,
  float: <Cloud className="size-3" />,
  wobble: <Rotate3d className="size-3" />,
  pendulum: <Timer className="size-3" />,
  noise: <Radio className="size-3" />,
  wave: <Activity className="size-3" />,
  spring: <Zap className="size-3" />,
  jitter: <Shuffle className="size-3" />,
  expression: <Code2 className="size-3" />,
};

function PartThumbnail({ part }: { part: Part }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!part.pixels || part.pixels.length === 0) return;

    const size = 32;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);

    const scaleX = size / part.width;
    const scaleY = size / part.height;
    const scale = Math.min(scaleX, scaleY);

    const drawW = part.width * scale;
    const drawH = part.height * scale;
    const offsetX = (size - drawW) / 2;
    const offsetY = (size - drawH) / 2;

    const checkSize = Math.max(2, Math.floor(scale));
    for (let y = 0; y < drawH; y += checkSize) {
      for (let x = 0; x < drawW; x += checkSize) {
        const px = Math.floor(x / scale);
        const py = Math.floor(y / scale);
        if (px < part.width && py < part.height && part.pixels[py]?.[px] != null) {
          ctx.fillStyle = part.pixels[py][px]!;
          ctx.fillRect(offsetX + x, offsetY + y, checkSize, checkSize);
        }
      }
    }
  }, [part.pixels, part.width, part.height]);

  return (
    <div className="size-8 flex-shrink-0 rounded border border-border/50 bg-muted/30 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="size-full"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}

// ---- Part Item Component ----

function PartItem({
  part,
  isSelected,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onRename,
  dragHandleProps,
  onEdit,
}: {
  part: Part;
  isSelected: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onRename: (name: string) => void;
  dragHandleProps?: Record<string, unknown>;
  onEdit?: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(part.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = useCallback(() => {
    setEditName(part.name);
    setIsEditing(true);
  }, [part.name]);

  const commitName = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== part.name) {
      onRename(trimmed);
    }
    setIsEditing(false);
  }, [editName, part.name, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        commitName();
      } else if (e.key === 'Escape') {
        setIsEditing(false);
        setEditName(part.name);
      }
    },
    [commitName, part.name]
  );

  return (
    <div
      className={`
        group flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer
        transition-colors duration-150
        ${
          isSelected
            ? 'bg-accent/80 border border-accent/60 shadow-sm'
            : 'hover:bg-muted/50 border border-transparent'
        }
      `}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <div
        className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        {...dragHandleProps}
      >
        <GripVertical className="size-3.5" />
      </div>

      {/* Thumbnail */}
      <PartThumbnail part={part} />

      {/* Name */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <Input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitName}
            onKeyDown={handleKeyDown}
            className="h-5 px-1 py-0 text-xs bg-background/80"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="block text-xs truncate text-foreground/90"
            onDoubleClick={handleDoubleClick}
            title={part.name}
          >
            {part.name}
          </span>
        )}
      </div>

      {/* Visibility toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisibility();
            }}
          >
            {part.visible ? (
              <Eye className="size-3" />
            ) : (
              <EyeOff className="size-3 text-muted-foreground" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {part.visible ? '隐藏' : '显示'}
        </TooltipContent>
      </Tooltip>

      {/* Lock toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onToggleLock();
            }}
          >
            {part.locked ? (
              <Lock className="size-3 text-amber-500" />
            ) : (
              <Unlock className="size-3" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {part.locked ? '解锁' : '锁定'}
        </TooltipContent>
      </Tooltip>

      {/* Edit (part edit mode) button */}
      {onEdit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <Pencil className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            编辑
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ---- Part Properties Section ----

function PartProperties({ part }: { part: Part }) {
  const updatePart = useProjectStore((s) => s.updatePart);
  const autoEstimatePivot = useProjectStore((s) => s.autoEstimatePivot);
  const setPartParent = useProjectStore((s) => s.setPartParent);
  const parts = useProjectStore((s) => s.parts);
  const [resizeOpen, setResizeOpen] = useState(false);

  const handlePivotChange = useCallback(
    (field: 'pivotX' | 'pivotY', value: string) => {
      const num = parseInt(value, 10);
      if (!isNaN(num)) {
        updatePart(part.id, { [field]: Math.max(0, num) });
      }
    },
    [part.id, updatePart]
  );

  const handleOffsetChange = useCallback(
    (field: 'offsetX' | 'offsetY', value: string) => {
      const num = parseInt(value, 10);
      if (!isNaN(num)) {
        updatePart(part.id, { [field]: num });
      }
    },
    [part.id, updatePart]
  );

  const handleAutoPivot = useCallback(() => {
    autoEstimatePivot(part.id);
  }, [autoEstimatePivot, part.id]);

  // V3.7: Build list of valid parent candidates (exclude self and descendants to prevent cycles)
  const parentCandidates = useMemo(() => {
    const descendantIds = new Set<string>();
    const collectDescendants = (id: string) => {
      descendantIds.add(id);
      for (const p of parts) {
        if (p.parentId === id) collectDescendants(p.id);
      }
    };
    collectDescendants(part.id);
    return parts.filter((p) => !descendantIds.has(p.id));
  }, [parts, part.id]);

  const handleSetParent = useCallback(
    (value: string) => {
      if (value === '__none__') {
        setPartParent(part.id, null);
      } else {
        setPartParent(part.id, value);
      }
    },
    [part.id, setPartParent]
  );

  const parentPart = part.parentId ? parts.find((p) => p.id === part.parentId) : null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        部件属性
      </h4>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">锚点 X</Label>
          <Input
            type="number"
            min={0}
            max={part.width - 1}
            value={part.pivotX}
            onChange={(e) => handlePivotChange('pivotX', e.target.value)}
            className="h-7 text-xs px-2"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">锚点 Y</Label>
          <Input
            type="number"
            min={0}
            max={part.height - 1}
            value={part.pivotY}
            onChange={(e) => handlePivotChange('pivotY', e.target.value)}
            className="h-7 text-xs px-2"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">偏移 X</Label>
          <Input
            type="number"
            value={part.offsetX || 0}
            onChange={(e) => handleOffsetChange('offsetX', e.target.value)}
            className="h-7 text-xs px-2"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">偏移 Y</Label>
          <Input
            type="number"
            value={part.offsetY || 0}
            onChange={(e) => handleOffsetChange('offsetY', e.target.value)}
            className="h-7 text-xs px-2"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">宽度</Label>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={1}
              max={512}
              value={part.width}
              readOnly
              className="h-7 text-xs px-2 bg-muted/50"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">高度</Label>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={1}
              max={512}
              value={part.height}
              readOnly
              className="h-7 text-xs px-2 bg-muted/50"
            />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
        <span>Z-Index: {part.zIndex}</span>
        <span>|</span>
        <span>{part.width} x {part.height} px</span>
        <Button
          variant="outline"
          size="sm"
          className="h-5 px-1.5 text-[10px] gap-0.5 ml-auto"
          onClick={() => setResizeOpen(true)}
        >
          调整尺寸
        </Button>
      </div>

      {/* Resize Preview Dialog */}
      <ResizePreviewDialog
        open={resizeOpen}
        onOpenChange={setResizeOpen}
        part={part}
      />

      {/* V3.7: Parent selector */}
      <Separator className="my-1" />
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Link className="size-3" />
          父级部件
        </Label>
        <Select
          value={part.parentId ?? '__none__'}
          onValueChange={handleSetParent}
        >
          <SelectTrigger className="h-7 text-xs px-2">
            <SelectValue placeholder="无 (根级)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs">
              无 (根级)
            </SelectItem>
            {parentCandidates.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {parentPart && (
          <div className="text-[10px] text-muted-foreground/70">
            子部件变换将相对于父级「{parentPart.name}」进行
          </div>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="h-6 w-full text-[10px] gap-1"
        onClick={handleAutoPivot}
      >
        <Crosshair className="size-3" />
        自动枢轴
      </Button>
    </div>
  );
}

// ---- Part Global Modifier Card ----

function PartGlobalModifierCard({ partId, modifier }: { partId: string; modifier: GlobalModifier }) {
  const {
    updatePartGlobalModifier,
    updatePartGlobalModifierParams,
    togglePartGlobalModifier,
    removePartGlobalModifier,
    reorderPartGlobalModifier,
  } = useProjectStore();

  const [collapsed, setCollapsed] = useState(!modifier.enabled);
  const def = GLOBAL_MODIFIER_DEFINITIONS.find((d) => d.type === modifier.type);

  const handleParamChange = useCallback((paramName: string, value: ModifierParamValue) => {
    updatePartGlobalModifierParams(partId, modifier.id, { [paramName]: value });
  }, [partId, modifier.id, updatePartGlobalModifierParams]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={`group border rounded-md transition-colors ${
          modifier.enabled
            ? 'bg-zinc-900/80 border-zinc-800'
            : 'bg-zinc-950/50 border-zinc-800/50 opacity-60'
        }`}>
          {/* Header */}
          <div
            className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer select-none"
            onClick={() => setCollapsed(!collapsed)}
          >
            <span className="text-zinc-500">
              {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
            </span>
            <span className="text-cyan-400">
              {TYPE_ICONS[modifier.type] || <Globe className="size-3" />}
            </span>
            <span className="text-[10px] font-medium text-zinc-200 flex-1 truncate">
              {modifier.name}
            </span>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className={`h-4 w-4 p-0 ${modifier.enabled ? 'text-cyan-400' : 'text-zinc-600'}`}
                onClick={(e) => { e.stopPropagation(); togglePartGlobalModifier(partId, modifier.id); }}
                title={modifier.enabled ? '禁用' : '启用'}
              >
                {modifier.enabled ? <Eye className="size-2.5" /> : <EyeOff className="size-2.5" />}
              </Button>
            </div>
          </div>

          {/* Parameters */}
          {!collapsed && def && (
            <div className="px-2 pb-2 space-y-1.5 border-t border-zinc-800/50 pt-1.5">
              {def.params.map((param) => (
                <div key={param.name} className="flex items-center gap-2">
                  <label className="text-[9px] text-zinc-500 w-16 shrink-0 truncate" title={param.label}>
                    {param.label}
                  </label>
                  {param.type === 'boolean' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-5 text-[9px] px-2 ${modifier.params[param.name] ? 'text-cyan-400' : 'text-zinc-600'}`}
                      onClick={() => handleParamChange(param.name, !modifier.params[param.name])}
                    >
                      {modifier.params[param.name] ? '开' : '关'}
                    </Button>
                  ) : param.type === 'select' ? (
                    <select
                      value={String(modifier.params[param.name] ?? param.default)}
                      onChange={(e) => handleParamChange(param.name, e.target.value)}
                      className="h-5 text-[9px] bg-zinc-800 border border-zinc-700 rounded px-1 flex-1 text-zinc-300"
                    >
                      {param.options?.map((opt) => (
                        <option key={String(opt.value)} value={String(opt.value)}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : param.type === 'color' ? (
                    <input
                      type="color"
                      value={String(modifier.params[param.name] ?? param.default)}
                      onChange={(e) => handleParamChange(param.name, e.target.value)}
                      className="h-5 w-8 bg-transparent border-0 cursor-pointer"
                    />
                  ) : (
                    <div className="flex items-center gap-1 flex-1">
                      <Input
                        type="number"
                        value={Number(modifier.params[param.name] ?? param.default)}
                        onChange={(e) => handleParamChange(param.name, Number(e.target.value))}
                        step={param.step ?? 1}
                        min={param.min}
                        max={param.max}
                        className="h-5 text-[9px] bg-zinc-800 border-zinc-700 flex-1"
                      />
                      {param.min !== undefined && param.max !== undefined && (
                        <input
                          type="range"
                          value={Number(modifier.params[param.name] ?? param.default)}
                          onChange={(e) => handleParamChange(param.name, Number(e.target.value))}
                          min={param.min}
                          max={param.max}
                          step={param.step ?? 1}
                          className="flex-1 h-1 accent-cyan-500"
                        />
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Effective range */}
              <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/30">
                <label className="text-[9px] text-zinc-600 w-16 shrink-0">起始帧</label>
                <Input
                  type="number"
                  value={modifier.startFrame === -1 ? '' : modifier.startFrame}
                  onChange={(e) => {
                    const v = e.target.value;
                    updatePartGlobalModifier(partId, modifier.id, { startFrame: v === '' ? -1 : Number(v) });
                  }}
                  placeholder="始终"
                  className="h-5 text-[9px] bg-zinc-800 border-zinc-700 flex-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[9px] text-zinc-600 w-16 shrink-0">结束帧</label>
                <Input
                  type="number"
                  value={modifier.endFrame === -1 ? '' : modifier.endFrame}
                  onChange={(e) => {
                    const v = e.target.value;
                    updatePartGlobalModifier(partId, modifier.id, { endFrame: v === '' ? -1 : Number(v) });
                  }}
                  placeholder="始终"
                  className="h-5 text-[9px] bg-zinc-800 border-zinc-700 flex-1"
                />
              </div>
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="bg-zinc-900 border-zinc-700 min-w-[140px]">
        <ContextMenuLabel className="text-[10px] text-zinc-400 py-1.5">
          {modifier.name}
        </ContextMenuLabel>
        <ContextMenuSeparator className="bg-zinc-800" />
        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer"
          onClick={() => togglePartGlobalModifier(partId, modifier.id)}
        >
          {modifier.enabled ? <EyeOff className="size-3 mr-1.5 text-zinc-400" /> : <Eye className="size-3 mr-1.5 text-zinc-400" />}
          {modifier.enabled ? '禁用' : '启用'}
        </ContextMenuItem>
        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer"
          onClick={() => reorderPartGlobalModifier(partId, modifier.id, 'up')}
        >
          <ArrowUp className="size-3 mr-1.5 text-zinc-400" />
          上移
        </ContextMenuItem>
        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer"
          onClick={() => reorderPartGlobalModifier(partId, modifier.id, 'down')}
        >
          <ArrowDown className="size-3 mr-1.5 text-zinc-400" />
          下移
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-zinc-800" />
        <ContextMenuItem
          className="text-[11px] text-red-400 focus:bg-red-600/20 focus:text-red-300 py-1.5 cursor-pointer"
          variant="destructive"
          onClick={() => removePartGlobalModifier(partId, modifier.id)}
        >
          <Trash2 className="size-3 mr-1.5" />
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ---- Part Global Modifiers Section ----

function PartGlobalModifiers({ part }: { part: Part }) {
  const addPartGlobalModifier = useProjectStore((s) => s.addPartGlobalModifier);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [sectionCollapsed, setSectionCollapsed] = useState(false);

  const handleAdd = useCallback((type: GlobalModifierType) => {
    addPartGlobalModifier(part.id, type);
    setShowAddMenu(false);
  }, [part.id, addPartGlobalModifier]);

  const transformTypes = GLOBAL_MODIFIER_DEFINITIONS.filter((d) => d.category === 'transform');
  const animTypes = GLOBAL_MODIFIER_DEFINITIONS.filter((d) => d.category === 'animation');
  const modifiers = part.globalModifiers || [];

  return (
    <div className="space-y-2">
      {/* Section header */}
      <div
        className="flex items-center gap-1.5 cursor-pointer select-none"
        onClick={() => setSectionCollapsed(!sectionCollapsed)}
      >
        <span className="text-muted-foreground">
          {sectionCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        </span>
        <Globe className="size-3 text-cyan-400" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1">
          部件全局修改器
        </span>
        <span className="text-[9px] text-muted-foreground/60">
          {modifiers.length}
        </span>
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-zinc-500 hover:text-cyan-400"
            onClick={(e) => { e.stopPropagation(); setShowAddMenu(!showAddMenu); }}
            title="添加部件全局修改器"
          >
            <Plus className="size-3" />
          </Button>
          {showAddMenu && (
            <div className="absolute right-0 top-6 z-50 bg-zinc-900 border border-zinc-700 rounded-md shadow-lg min-w-[140px] py-1">
              <div className="px-2 py-1 text-[9px] text-zinc-500 uppercase tracking-wider">变换</div>
              {transformTypes.map((def) => (
                <button
                  key={def.type}
                  className="flex items-center gap-1.5 w-full px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 transition-colors"
                  onClick={() => handleAdd(def.type)}
                >
                  {TYPE_ICONS[def.type]}
                  {def.label}
                </button>
              ))}
              <div className="px-2 py-1 mt-1 text-[9px] text-zinc-500 uppercase tracking-wider border-t border-zinc-800">动画</div>
              {animTypes.map((def) => (
                <button
                  key={def.type}
                  className="flex items-center gap-1.5 w-full px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 transition-colors"
                  onClick={() => handleAdd(def.type)}
                >
                  {TYPE_ICONS[def.type]}
                  {def.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modifier list */}
      {!sectionCollapsed && (
        <div className="space-y-1 pl-1">
          {modifiers.length === 0 ? (
            <div className="text-center py-3">
              <Globe className="size-5 text-zinc-800 mx-auto mb-1" />
              <p className="text-[9px] text-zinc-600">暂无部件全局修改器</p>
              <p className="text-[8px] text-zinc-700 mt-0.5">始终生效的变换/动画</p>
            </div>
          ) : (
            modifiers.map((mod) => (
              <PartGlobalModifierCard key={mod.id} partId={part.id} modifier={mod} />
            ))
          )}
        </div>
      )}

      {/* Click outside to close add menu */}
      {showAddMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowAddMenu(false)}
        />
      )}
    </div>
  );
}

// ---- Expandable Part Detail (click to expand) ----

function ExpandablePartDetail({ part, onEdit }: { part: Part; onEdit: () => void }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      {/* Clickable header row */}
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer select-none hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
        <PartThumbnail part={part} />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-foreground/90 truncate">{part.name}</span>
          <div className="text-[9px] text-muted-foreground/60">
            {part.width}×{part.height} · 枢轴({part.pivotX},{part.pivotY})
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
            >
              <Pencil className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">编辑像素</TooltipContent>
        </Tooltip>
      </div>

      {/* Expandable content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          <PartProperties part={part} />
          <Separator />
          <PartGlobalModifiers part={part} />
        </div>
      )}
    </div>
  );
}

// ---- Main PartPanel Component ----

export default function PartPanel() {
  const parts = useProjectStore((s) => s.parts);
  const addPart = useProjectStore((s) => s.addPart);
  const removePart = useProjectStore((s) => s.removePart);
  const updatePart = useProjectStore((s) => s.updatePart);
  const duplicatePart = useProjectStore((s) => s.duplicatePart);
  const importPartFromImage = useProjectStore((s) => s.importPartFromImage);
  const reorderPart = useProjectStore((s) => s.reorderPart);

  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectPart = useEditorStore((s) => s.selectPart);
  const enterPartEditMode = useEditorStore((s) => s.enterPartEditMode);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [motionAnalysisOpen, setMotionAnalysisOpen] = useState(false);
  const [spritesheetImportOpen, setSpritesheetImportOpen] = useState(false);
  const [newWidth, setNewWidth] = useState(32);
  const [newHeight, setNewHeight] = useState(32);
  const [newName, setNewName] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const sortedParts = [...parts].sort((a, b) => a.zIndex - b.zIndex);
  const selectedPart = parts.find((p) => p.id === selectedPartId) ?? null;

  // ---- Handlers ----

  const handleAddPart = useCallback(() => {
    const w = Math.max(1, Math.min(512, newWidth));
    const h = Math.max(1, Math.min(512, newHeight));
    const name = newName.trim() || `部件 ${parts.length + 1}`;
    const part = addPart(name, w, h);
    selectPart(part.id);
    setAddDialogOpen(false);
    setNewName('');
    setNewWidth(32);
    setNewHeight(32);
  }, [newWidth, newHeight, newName, parts.length, addPart, selectPart]);

  const handleDeletePart = useCallback(() => {
    if (!selectedPartId) return;
    const currentSorted = [...parts].sort((a, b) => a.zIndex - b.zIndex);
    const currentIndex = currentSorted.findIndex((p) => p.id === selectedPartId);
    removePart(selectedPartId);
    // Select adjacent part
    const remaining = currentSorted.filter((p) => p.id !== selectedPartId);
    if (remaining.length > 0) {
      const nextIndex = Math.min(currentIndex, remaining.length - 1);
      selectPart(remaining[nextIndex]?.id ?? null);
    } else {
      selectPart(null);
    }
  }, [selectedPartId, parts, removePart, selectPart]);

  const handleDuplicatePart = useCallback(() => {
    if (!selectedPartId) return;
    duplicatePart(selectedPartId);
  }, [selectedPartId, duplicatePart]);

  const handleImportPNG = useCallback(
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
          const name = file.name.replace(/\.[^/.]+$/, '') || '导入图像';
          const part = importPartFromImage(name, imageData);
          selectPart(part.id);
        };
        img.src = ev.target?.result as string;
      };
      reader.readAsDataURL(file);

      // Reset input so the same file can be re-imported
      e.target.value = '';
    },
    [importPartFromImage, selectPart]
  );

  // ---- Drag & Drop Handlers ----

  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      setDragIndex(index);
      e.dataTransfer.effectAllowed = 'move';
      // Required for Firefox
      e.dataTransfer.setData('text/plain', String(index));
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragIndex !== null && dragIndex !== index) {
        setDragOverIndex(index);
      }
    },
    [dragIndex]
  );

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === dropIndex) {
        setDragIndex(null);
        setDragOverIndex(null);
        return;
      }

      const reordered = [...sortedParts];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(dropIndex, 0, moved);

      // Update zIndex for all affected parts
      reordered.forEach((part, idx) => {
        if (part.zIndex !== idx) {
          reorderPart(part.id, idx);
        }
      });

      setDragIndex(null);
      setDragOverIndex(null);
    },
    [dragIndex, sortedParts, reorderPart]
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/50">
        <h3 className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
          部件
        </h3>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {parts.length}
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-border/30">
        {/* Add Part Dialog */}
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <Plus className="size-3.5" />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">新建部件</TooltipContent>
          </Tooltip>

          <DialogContent className="sm:max-w-[320px]">
            <DialogHeader>
              <DialogTitle>新建部件</DialogTitle>
              <DialogDescription>
                创建一个新的像素部件，设置名称和尺寸。
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="part-name" className="text-xs">
                  名称
                </Label>
                <Input
                  id="part-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={`部件 ${parts.length + 1}`}
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddPart();
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="part-width" className="text-xs">
                    宽度
                  </Label>
                  <Input
                    id="part-width"
                    type="number"
                    min={1}
                    max={512}
                    value={newWidth}
                    onChange={(e) => setNewWidth(parseInt(e.target.value, 10) || 1)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="part-height" className="text-xs">
                    高度
                  </Label>
                  <Input
                    id="part-height"
                    type="number"
                    min={1}
                    max={512}
                    value={newHeight}
                    onChange={(e) => setNewHeight(parseInt(e.target.value, 10) || 1)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>预设:</span>
                {[8, 16, 32, 64, 128].map((size) => (
                  <Button
                    key={size}
                    variant="outline"
                    size="sm"
                    className="h-5 px-1.5 text-[10px]"
                    onClick={() => {
                      setNewWidth(size);
                      setNewHeight(size);
                    }}
                  >
                    {size}x{size}
                  </Button>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddDialogOpen(false)}
              >
                取消
              </Button>
              <Button size="sm" onClick={handleAddPart}>
                创建
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Import PNG */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">导入 PNG</TooltipContent>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png"
          className="hidden"
          onChange={handleImportPNG}
        />

        {/* Split Image Dialog */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setSplitOpen(true)}
            >
              <Scissors className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">拆分图像</TooltipContent>
        </Tooltip>
        <SplitImageDialog open={splitOpen} onOpenChange={setSplitOpen} />

        {/* Spritesheet Import Dialog */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setSpritesheetImportOpen(true)}
            >
              <Grid3x3 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">精灵表导入</TooltipContent>
        </Tooltip>
        <SpritesheetImportDialog open={spritesheetImportOpen} onOpenChange={setSpritesheetImportOpen} />

        {/* Motion Analysis Dialog */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setMotionAnalysisOpen(true)}
            >
              <Activity className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">运动分析拆分</TooltipContent>
        </Tooltip>
        <MotionAnalysisDialog open={motionAnalysisOpen} onOpenChange={setMotionAnalysisOpen} />

        <div className="flex-1" />

        {/* Duplicate */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={!selectedPartId}
              onClick={handleDuplicatePart}
            >
              <Copy className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">复制部件</TooltipContent>
        </Tooltip>

        {/* Delete */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-destructive/70 hover:text-destructive"
              disabled={!selectedPartId}
              onClick={handleDeletePart}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">删除部件</TooltipContent>
        </Tooltip>
      </div>

      {/* Parts List + Part Properties - scrollable together */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="p-1.5 space-y-0.5">
          {sortedParts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/60">
              <ImagePlus className="size-8 mb-2 opacity-40" />
              <p className="text-[10px]">暂无部件</p>
              <p className="text-[10px]">点击 + 创建新部件</p>
            </div>
          ) : (
            sortedParts.map((part, index) => (
              <div
                key={part.id}
                className={`
                  transition-colors duration-150 rounded-md
                  ${dragOverIndex === index && dragIndex !== null && dragIndex !== index
                    ? 'border-t-2 border-t-accent'
                    : ''}
                  ${dragIndex === index ? 'opacity-40' : ''}
                `}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
              >
                <PartItem
                  part={part}
                  isSelected={part.id === selectedPartId}
                  onSelect={() => selectPart(part.id)}
                  onToggleVisibility={() =>
                    updatePart(part.id, { visible: !part.visible })
                  }
                  onToggleLock={() =>
                    updatePart(part.id, { locked: !part.locked })
                  }
                  onRename={(name) => updatePart(part.id, { name })}
                  onEdit={() => enterPartEditMode(part.id)}
                  dragHandleProps={{
                    draggable: true,
                    onDragStart: (e: React.DragEvent) => handleDragStart(e, index),
                    onDragEnd: handleDragEnd,
                  }}
                />
              </div>
            ))
          )}
        </div>

        {/* Part Properties - inside the scrollable area */}
        {selectedPart && (
          <div className="border-t border-border/40 mt-2">
            <ExpandablePartDetail part={selectedPart} onEdit={() => enterPartEditMode(selectedPart.id)} />
          </div>
        )}
      </div>
    </div>
  );
}
