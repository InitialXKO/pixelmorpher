'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Library,
  FolderOpen,
  Workflow,
  Plus,
  Search,
  Image,
  Grid3x3,
  Bone,
  Sliders,
  Trash2,
  Download,
  Tag,
  Copy,
  Edit3,
  Check,
  X,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ChevronRight,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/ui/context-menu';
import { useAssetStore } from '@/lib/asset-store';
import { useProjectStore, useEditorStore } from '@/lib/store';
import { useTileWorkflowStore } from '@/lib/tile-workflow-store';
import { useMapStore } from '@/lib/map-store';
import type { LibraryAsset, LibraryAssetType } from '@/lib/asset-types';
import PartPanel from '@/components/pixel-editor/PartPanel';

const TYPE_ICONS: Record<LibraryAssetType, React.ReactNode> = {
  sprite: <Image className="size-3" />,
  tileset: <Grid3x3 className="size-3" />,
  skeleton_template: <Bone className="size-3" />,
  modifier_preset: <Sliders className="size-3" />,
};

const TYPE_LABELS: Record<LibraryAssetType, string> = {
  sprite: '精灵',
  tileset: '瓦片集',
  skeleton_template: '骨骼模板',
  modifier_preset: '修改器预设',
};

// ============================================================
// AssetCard with Context Menu
// ============================================================

interface AssetCardProps {
  asset: LibraryAsset;
  onImport: () => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
  onUpdateTags: (tags: string[]) => void;
  onDuplicate: () => void;
  isSelected: boolean;
  onSelect: () => void;
}

function AssetCard({
  asset,
  onImport,
  onDelete,
  onRename,
  onUpdateTags,
  onDuplicate,
  isSelected,
  onSelect,
}: AssetCardProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(asset.name);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState(asset.tags.join(', '));
  const renameInputRef = useRef<HTMLInputElement>(null);

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== asset.name) {
      onRename(trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, asset.name, onRename]);

  const commitTags = useCallback(() => {
    const newTags = tagInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    onUpdateTags(newTags);
    setIsEditingTags(false);
  }, [tagInput, onUpdateTags]);

  const startRename = useCallback(() => {
    setRenameValue(asset.name);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }, [asset.name]);

  const startEditTags = useCallback(() => {
    setTagInput(asset.tags.join(', '));
    setIsEditingTags(true);
  }, [asset.tags]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
            isSelected
              ? 'bg-purple-600/20 border border-purple-500/40'
              : 'hover:bg-zinc-800/50 border border-transparent'
          }`}
          onClick={onSelect}
        >
          {/* Thumbnail */}
          <div className="size-8 bg-zinc-900 rounded border border-zinc-800 flex items-center justify-center overflow-hidden flex-shrink-0">
            {asset.thumbnail ? (
              <img src={asset.thumbnail} alt={asset.name} className="w-full h-full object-contain pixelated" />
            ) : (
              <span className="text-zinc-600">{TYPE_ICONS[asset.type]}</span>
            )}
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0">
            {isRenaming ? (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <Input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="h-4 text-[10px] bg-zinc-800 border-zinc-700 py-0 px-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setIsRenaming(false);
                  }}
                  onBlur={commitRename}
                  autoFocus
                />
              </div>
            ) : (
              <div className="text-[10px] font-medium text-zinc-200 truncate">{asset.name}</div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-zinc-500">{TYPE_LABELS[asset.type]}</span>
              {asset.tags.length > 0 && (
                <div className="flex gap-0.5 overflow-hidden">
                  {asset.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="text-[8px] px-1 py-px rounded bg-zinc-800 text-zinc-500 truncate max-w-[40px]"
                    >
                      {tag}
                    </span>
                  ))}
                  {asset.tags.length > 2 && (
                    <span className="text-[8px] text-zinc-600">+{asset.tags.length - 2}</span>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* Quick Actions (hover-revealed) */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-zinc-500 hover:text-purple-400"
              onClick={(e) => { e.stopPropagation(); onImport(); }}
              title="导入到项目"
            >
              <Download className="size-2.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-zinc-500 hover:text-red-400"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="从库中删除"
            >
              <Trash2 className="size-2.5" />
            </Button>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="bg-zinc-900 border-zinc-700 min-w-[160px]">
        <ContextMenuLabel className="text-[10px] text-zinc-400 py-1.5">
          {asset.name}
        </ContextMenuLabel>
        <ContextMenuSeparator className="bg-zinc-800" />

        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-purple-600/20 focus:text-purple-300 py-1.5 cursor-pointer"
          onClick={onImport}
        >
          <Download className="size-3 mr-1.5 text-purple-400" />
          导入到项目
        </ContextMenuItem>

        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer"
          onClick={startRename}
        >
          <Edit3 className="size-3 mr-1.5 text-zinc-400" />
          重命名
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer">
            <Tag className="size-3 mr-1.5 text-zinc-400" />
            标签
            <ChevronRight className="size-3 ml-auto" />
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="bg-zinc-900 border-zinc-700 min-w-[180px] p-2">
            <div className="space-y-1.5">
              {asset.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1 mb-2">
                  {asset.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300"
                    >
                      {tag}
                      <button
                        className="text-zinc-500 hover:text-red-400 ml-0.5"
                        onClick={() => {
                          onUpdateTags(asset.tags.filter((t) => t !== tag));
                        }}
                      >
                        <X className="size-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[9px] text-zinc-600 mb-2">暂无标签</p>
              )}
              <div className="flex gap-1">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="用逗号分隔"
                  className="h-5 text-[9px] bg-zinc-800 border-zinc-700 flex-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTags();
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 text-zinc-500 hover:text-purple-400"
                  onClick={commitTags}
                >
                  <Check className="size-2.5" />
                </Button>
              </div>
            </div>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer"
          onClick={onDuplicate}
        >
          <Copy className="size-3 mr-1.5 text-zinc-400" />
          复制资产
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-zinc-800" />

        <ContextMenuItem
          className="text-[11px] text-red-400 focus:bg-red-600/20 focus:text-red-300 py-1.5 cursor-pointer"
          variant="destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3 mr-1.5" />
          删除资产
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ============================================================
// Project Part Card with Context Menu
// ============================================================

interface PartCardProps {
  part: {
    id: string;
    name: string;
    pixels: (string | null)[][];
    visible: boolean;
    locked: boolean;
    zIndex: number;
    width: number;
    height: number;
    pivotX: number;
    pivotY: number;
    [key: string]: unknown;
  };
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onDuplicate: () => void;
  onSaveToLibrary: () => void;
  isSelected: boolean;
}

function PartCard({
  part,
  onSelect,
  onDelete,
  onRename,
  onToggleVisibility,
  onToggleLock,
  onDuplicate,
  onSaveToLibrary,
  isSelected,
}: PartCardProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(part.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== part.name) {
      onRename(trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, part.name, onRename]);

  const w = part.pixels[0]?.length ?? 0;
  const h = part.pixels.length;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors ${
            isSelected
              ? 'bg-purple-600/20 border border-purple-500/40'
              : 'hover:bg-zinc-800/50 border border-transparent'
          }`}
          onClick={onSelect}
        >
          {/* Mini pixel preview */}
          <div className="size-5 bg-zinc-900 rounded border border-zinc-800 overflow-hidden flex-shrink-0 flex items-center justify-center">
            <span className="text-[8px] text-zinc-600">{part.name.charAt(0)}</span>
          </div>
          <span className="text-[10px] text-zinc-300 truncate flex-1">{part.name}</span>
          <span className="text-[9px] text-zinc-600">{w}×{h}</span>
          {/* Quick visibility/lock toggles */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              className={`h-4 w-4 p-0 ${part.visible ? 'text-zinc-500' : 'text-zinc-700'}`}
              onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
              title={part.visible ? '隐藏' : '显示'}
            >
              {part.visible ? <Eye className="size-2" /> : <EyeOff className="size-2" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-4 w-4 p-0 ${part.locked ? 'text-amber-500' : 'text-zinc-700'}`}
              onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
              title={part.locked ? '解锁' : '锁定'}
            >
              {part.locked ? <Lock className="size-2" /> : <Unlock className="size-2" />}
            </Button>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="bg-zinc-900 border-zinc-700 min-w-[160px]">
        <ContextMenuLabel className="text-[10px] text-zinc-400 py-1.5">
          {part.name}
        </ContextMenuLabel>
        <ContextMenuSeparator className="bg-zinc-800" />

        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-purple-600/20 focus:text-purple-300 py-1.5 cursor-pointer"
          onClick={onSaveToLibrary}
        >
          <Download className="size-3 mr-1.5 text-purple-400" />
          保存到资产库
        </ContextMenuItem>

        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer"
          onClick={() => { setRenameValue(part.name); setIsRenaming(true); }}
        >
          <Edit3 className="size-3 mr-1.5 text-zinc-400" />
          重命名
        </ContextMenuItem>

        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer"
          onClick={onToggleVisibility}
        >
          {part.visible
            ? <EyeOff className="size-3 mr-1.5 text-zinc-400" />
            : <Eye className="size-3 mr-1.5 text-zinc-400" />}
          {part.visible ? '隐藏部件' : '显示部件'}
        </ContextMenuItem>

        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer"
          onClick={onToggleLock}
        >
          {part.locked
            ? <Unlock className="size-3 mr-1.5 text-zinc-400" />
            : <Lock className="size-3 mr-1.5 text-zinc-400" />}
          {part.locked ? '解锁部件' : '锁定部件'}
        </ContextMenuItem>

        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer"
          onClick={onDuplicate}
        >
          <Copy className="size-3 mr-1.5 text-zinc-400" />
          复制部件
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-zinc-800" />

        <ContextMenuItem
          className="text-[11px] text-red-400 focus:bg-red-600/20 focus:text-red-300 py-1.5 cursor-pointer"
          variant="destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3 mr-1.5" />
          删除部件
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ============================================================
// Skeleton Card with Context Menu
// ============================================================

interface SkeletonCardProps {
  skeleton: {
    id: string;
    name: string;
    bones: unknown[];
  };
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
  isSelected: boolean;
}

function SkeletonCard({ skeleton, onSelect, onDelete, onRename, isSelected }: SkeletonCardProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`group flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer transition-colors ${
            isSelected
              ? 'bg-purple-600/20 border border-purple-500/40'
              : 'hover:bg-zinc-800/50 border border-transparent'
          }`}
          onClick={onSelect}
        >
          <Bone className="size-2.5 text-zinc-500 flex-shrink-0" />
          <span className="text-[10px] text-zinc-300 truncate flex-1">{skeleton.name}</span>
          <span className="text-[9px] text-zinc-600">{skeleton.bones.length}骨骼</span>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="bg-zinc-900 border-zinc-700 min-w-[160px]">
        <ContextMenuLabel className="text-[10px] text-zinc-400 py-1.5">
          {skeleton.name}
        </ContextMenuLabel>
        <ContextMenuSeparator className="bg-zinc-800" />

        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer"
          onClick={() => {
            const newName = prompt('重命名骨骼:', skeleton.name);
            if (newName?.trim()) onRename(newName.trim());
          }}
        >
          <Edit3 className="size-3 mr-1.5 text-zinc-400" />
          重命名
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-zinc-800" />

        <ContextMenuItem
          className="text-[11px] text-red-400 focus:bg-red-600/20 focus:text-red-300 py-1.5 cursor-pointer"
          variant="destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3 mr-1.5" />
          删除骨骼
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ============================================================
// Main Panel
// ============================================================

export default function AssetLibraryPanel() {
  const {
    libraryAssets,
    libraryLoaded,
    loadLibrary,
    filter,
    setFilter,
    getFilteredAssets,
    importAssetToProject,
    removeAssetFromLibrary,
    updateAssetInLibrary,
    addAssetToLibrary,
    selectedAssetId,
    setSelectedAssetId,
  } = useAssetStore();

  const { parts, skeletons, keyframes, removePart, updatePart, addPart, setPartPixels } = useProjectStore();
  const { tiles, materialA, materialB, currentStep } = useTileWorkflowStore();
  const { currentMap } = useMapStore();

  const [searchText, setSearchText] = useState('');

  // Selected part from editor store (lazy read to avoid re-render loop)
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [selectedSkeletonId, setSelectedSkeletonId] = useState<string | null>(null);

  useEffect(() => {
    if (!libraryLoaded) loadLibrary();
  }, [libraryLoaded, loadLibrary]);

  // Sync selected part from editor store
  useEffect(() => {
    const unsub = useProjectStore.subscribe(() => {
      const editorStore = (useProjectStore as any).getState?.();
      // Read from the separate editor store
    });
    return unsub;
  }, []);

  const filteredAssets = getFilteredAssets();

  // ---- Asset Library Actions ----

  const handleImport = useCallback(async (assetId: string) => {
    await importAssetToProject(assetId);
  }, [importAssetToProject]);

  const handleDeleteAsset = useCallback(async (assetId: string) => {
    await removeAssetFromLibrary(assetId);
  }, [removeAssetFromLibrary]);

  const handleRenameAsset = useCallback(async (assetId: string, newName: string) => {
    await updateAssetInLibrary(assetId, { name: newName });
  }, [updateAssetInLibrary]);

  const handleUpdateAssetTags = useCallback(async (assetId: string, tags: string[]) => {
    await updateAssetInLibrary(assetId, { tags });
  }, [updateAssetInLibrary]);

  const handleDuplicateAsset = useCallback(async (asset: LibraryAsset) => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = asset;
    await addAssetToLibrary({ ...rest, name: `${asset.name} 副本` });
  }, [addAssetToLibrary]);

  const handleSearch = useCallback((text: string) => {
    setSearchText(text);
    setFilter({ searchText: text || undefined });
  }, [setFilter]);

  // ---- Project Part Actions ----

  const handleSelectPart = useCallback((partId: string) => {
    setSelectedPartId(partId);
    // Also select in editor store
    try {
      const { useEditorStore } = require('@/lib/store') as { useEditorStore: any };
      useEditorStore.getState().selectPart(partId);
    } catch {}
  }, []);

  const handleDeletePart = useCallback((partId: string) => {
    const store = useProjectStore.getState();
    store.pushUndo('删除部件');
    store.removePart(partId);
  }, []);

  const handleRenamePart = useCallback((partId: string, newName: string) => {
    const store = useProjectStore.getState();
    store.pushUndo('重命名部件');
    store.updatePart(partId, { name: newName });
  }, []);

  const handleTogglePartVisibility = useCallback((partId: string) => {
    const store = useProjectStore.getState();
    const part = store.parts.find((p) => p.id === partId);
    if (part) {
      store.updatePart(partId, { visible: !part.visible });
    }
  }, []);

  const handleTogglePartLock = useCallback((partId: string) => {
    const store = useProjectStore.getState();
    const part = store.parts.find((p) => p.id === partId);
    if (part) {
      store.updatePart(partId, { locked: !part.locked });
    }
  }, []);

  const handleDuplicatePart = useCallback((partId: string) => {
    const store = useProjectStore.getState();
    const part = store.parts.find((p) => p.id === partId);
    if (!part) return;
    store.pushUndo('复制部件');
    const newPart = store.addPart(`${part.name} 副本`, part.width, part.height);
    store.setPartPixels(newPart.id, part.pixels.map((row) => [...row] as string[]));
    store.updatePart(newPart.id, {
      pivotX: part.pivotX,
      pivotY: part.pivotY,
      zIndex: part.zIndex + 1,
    });
  }, []);

  const handleSavePartToLibrary = useCallback(async (partId: string) => {
    const store = useProjectStore.getState();
    const part = store.parts.find((p) => p.id === partId);
    if (!part) return;

    const w = part.pixels[0]?.length ?? 16;
    const h = part.pixels.length;

    // Generate thumbnail
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(w, 64);
    canvas.height = Math.min(h, 64);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      const scale = Math.min(canvas.width / w, canvas.height / h);
      ctx.save();
      ctx.scale(scale, scale);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const c = part.pixels[y][x];
          if (c) {
            ctx.fillStyle = c;
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
      ctx.restore();
    }

    const thumbnail = canvas.toDataURL();
    await useAssetStore.getState().saveSpriteToLibrary(
      part.name,
      part.pixels.map((row) => [...row] as string[]),
      w,
      h,
      thumbnail,
    );
  }, []);

  // ---- Skeleton Actions ----

  const handleSelectSkeleton = useCallback((skeletonId: string) => {
    setSelectedSkeletonId(skeletonId);
    try {
      const { useEditorStore } = require('@/lib/store') as { useEditorStore: any };
      useEditorStore.getState().setActiveSkeletonId(skeletonId);
    } catch {}
  }, []);

  const handleDeleteSkeleton = useCallback((skeletonId: string) => {
    const store = useProjectStore.getState();
    store.pushUndo('删除骨骼');
    store.removeSkeleton(skeletonId);
  }, []);

  const handleRenameSkeleton = useCallback((skeletonId: string, newName: string) => {
    const store = useProjectStore.getState();
    store.pushUndo('重命名骨骼');
    // Update skeleton name directly in state
    const skeletons = store.skeletons.map((s) =>
      s.id === skeletonId ? { ...s, name: newName } : s
    );
    useProjectStore.setState({ skeletons });
  }, []);

  return (
    <div className="flex flex-col h-full">
      <Tabs defaultValue="library" className="flex flex-col h-full">
        <TabsList className="w-full justify-start rounded-none border-b border-zinc-800 bg-zinc-950 h-auto min-h-7 px-0.5 py-0.5">
          <TabsTrigger
            value="library"
            className="text-[9px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-0.5 h-5"
          >
            <Library className="size-2.5 mr-0.5" />
            资产库
          </TabsTrigger>
          <TabsTrigger
            value="parts"
            className="text-[9px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-0.5 h-5"
          >
            <Layers className="size-2.5 mr-0.5" />
            部件
          </TabsTrigger>
          <TabsTrigger
            value="project"
            className="text-[9px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-0.5 h-5"
          >
            <FolderOpen className="size-2.5 mr-0.5" />
            项目
          </TabsTrigger>
          <TabsTrigger
            value="workflow"
            className="text-[9px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-0.5 h-5"
          >
            <Workflow className="size-2.5 mr-0.5" />
            工作流
          </TabsTrigger>
        </TabsList>

        {/* ---- Layer 1.5: Part Panel ---- */}
        <TabsContent value="parts" className="flex-1 min-h-0 m-0">
          <PartPanel />
        </TabsContent>

        {/* ---- Layer 1: Asset Library ---- */}
        <TabsContent value="library" className="flex-1 min-h-0 m-0">
          <div className="flex flex-col h-full">
            {/* Search bar */}
            <div className="px-2 py-1.5 border-b border-zinc-800/50">
              <div className="relative">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 size-3 text-zinc-500" />
                <Input
                  value={searchText}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="搜索资产..."
                  className="h-6 text-[10px] pl-6 bg-zinc-900 border-zinc-800"
                />
              </div>
            </div>

            {/* Type filter */}
            <div className="flex gap-0.5 px-2 py-1 border-b border-zinc-800/50">
              {(['sprite', 'tileset', 'skeleton_template', 'modifier_preset'] as LibraryAssetType[]).map((type) => (
                <Button
                  key={type}
                  variant="ghost"
                  size="sm"
                  className={`h-5 text-[9px] px-1.5 ${filter.type === type ? 'bg-zinc-800 text-purple-300' : 'text-zinc-500'}`}
                  onClick={() => setFilter({ type: filter.type === type ? undefined : type })}
                >
                  {TYPE_ICONS[type]}
                  <span className="ml-0.5">{TYPE_LABELS[type]}</span>
                </Button>
              ))}
            </div>

            {/* Asset list */}
            <div className="flex-1 overflow-auto">
              {!libraryLoaded ? (
                <div className="text-[10px] text-zinc-500 text-center py-4">加载中...</div>
              ) : filteredAssets.length === 0 ? (
                <div className="text-[10px] text-zinc-600 text-center py-4">
                  {libraryAssets.length === 0 ? '资产库为空' : '没有匹配的资产'}
                </div>
              ) : (
                <div className="py-1">
                  {filteredAssets.map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      onImport={() => handleImport(asset.id)}
                      onDelete={() => handleDeleteAsset(asset.id)}
                      onRename={(newName) => handleRenameAsset(asset.id, newName)}
                      onUpdateTags={(tags) => handleUpdateAssetTags(asset.id, tags)}
                      onDuplicate={() => handleDuplicateAsset(asset)}
                      isSelected={selectedAssetId === asset.id}
                      onSelect={() => setSelectedAssetId(asset.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer: Save current part to library */}
            <div className="px-2 py-1.5 border-t border-zinc-800/50">
              <p className="text-[9px] text-zinc-600 mb-1">将当前部件保存到资产库</p>
              <SaveToLibrarySection />
            </div>
          </div>
        </TabsContent>

        {/* ---- Layer 2: Project Assets ---- */}
        <TabsContent value="project" className="flex-1 min-h-0 m-0">
          <div className="flex flex-col h-full overflow-auto py-1">
            {/* Parts */}
            <div className="px-2 py-1">
              <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Image className="size-2.5" />
                部件 ({parts.length})
              </div>
              {parts.length === 0 ? (
                <p className="text-[9px] text-zinc-600 pl-3">暂无部件</p>
              ) : (
                <div className="space-y-0.5">
                  {parts.map((part) => (
                    <PartCard
                      key={part.id}
                      part={part as unknown as PartCardProps['part']}
                      onSelect={() => handleSelectPart(part.id)}
                      onDelete={() => handleDeletePart(part.id)}
                      onRename={(newName) => handleRenamePart(part.id, newName)}
                      onToggleVisibility={() => handleTogglePartVisibility(part.id)}
                      onToggleLock={() => handleTogglePartLock(part.id)}
                      onDuplicate={() => handleDuplicatePart(part.id)}
                      onSaveToLibrary={() => handleSavePartToLibrary(part.id)}
                      isSelected={selectedPartId === part.id}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Skeletons */}
            <div className="px-2 py-1 mt-2">
              <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Bone className="size-2.5" />
                骨骼 ({skeletons.length})
              </div>
              {skeletons.length === 0 ? (
                <p className="text-[9px] text-zinc-600 pl-3">暂无骨骼</p>
              ) : (
                skeletons.map((skel) => (
                  <SkeletonCard
                    key={skel.id}
                    skeleton={skel}
                    onSelect={() => handleSelectSkeleton(skel.id)}
                    onDelete={() => handleDeleteSkeleton(skel.id)}
                    onRename={(newName) => handleRenameSkeleton(skel.id, newName)}
                    isSelected={selectedSkeletonId === skel.id}
                  />
                ))
              )}
            </div>

            {/* Keyframes */}
            <div className="px-2 py-1 mt-2">
              <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Sliders className="size-2.5" />
                关键帧 ({keyframes.length})
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ---- Layer 3: Workflow Assets ---- */}
        <TabsContent value="workflow" className="flex-1 min-h-0 m-0">
          <div className="flex flex-col h-full overflow-auto py-1 px-2">
            {/* Tile Workflow */}
            <div className="py-1">
              <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Grid3x3 className="size-2.5" />
                瓦片工作流
              </div>
              <div className="space-y-1 pl-2">
                <div className="flex items-center gap-2 text-[10px]">
                  <span className={`size-1.5 rounded-full ${materialA.pixels ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                  材质A: {materialA.pixels ? '✓' : '未生成'}
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className={`size-1.5 rounded-full ${materialB.pixels ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                  材质B: {materialB.pixels ? '✓' : '未生成'}
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className={`size-1.5 rounded-full ${tiles.length > 0 ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                  已生成瓦片: {tiles.length}
                </div>
                <div className="text-[9px] text-zinc-600 mt-1">
                  当前步骤: {currentStep}/3
                </div>
                {tiles.length > 0 && (
                  <SaveTilesetToLibrarySection />
                )}
              </div>
            </div>

            {/* Map Editing */}
            <div className="py-1 mt-2 border-t border-zinc-800/50">
              <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Grid3x3 className="size-2.5" />
                地图编辑
              </div>
              {currentMap ? (
                <div className="space-y-1 pl-2 text-[10px]">
                  <div>地图: {currentMap.name}</div>
                  <div>图层: {currentMap.layers.length}</div>
                  <div>动态对象: {currentMap.dynamicObjects.length}</div>
                </div>
              ) : (
                <p className="text-[9px] text-zinc-600 pl-2">未创建地图</p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// Sub-component: Save selected part to library
// ============================================================

function SaveToLibrarySection() {
  const [assetName, setAssetName] = useState('');

  const handleSave = useCallback(async () => {
    const projectStore = useProjectStore.getState();
    const editorStore = require('@/lib/store').useEditorStore.getState();
    const partId = editorStore.selectedPartId;
    if (!partId) return;

    const part = projectStore.parts.find((p) => p.id === partId);
    if (!part) return;

    const name = assetName.trim() || part.name;

    // Generate thumbnail (render part to small canvas)
    const canvas = document.createElement('canvas');
    const w = part.pixels[0]?.length ?? 16;
    const h = part.pixels.length;
    canvas.width = Math.min(w, 64);
    canvas.height = Math.min(h, 64);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      const scale = Math.min(canvas.width / w, canvas.height / h);
      ctx.save();
      ctx.scale(scale, scale);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const c = part.pixels[y][x];
          if (c) {
            ctx.fillStyle = c;
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
      ctx.restore();
    }

    const thumbnail = canvas.toDataURL();

    await useAssetStore.getState().saveSpriteToLibrary(
      name,
      part.pixels.map((row) => [...row] as string[]),
      w,
      h,
      thumbnail,
    );

    setAssetName('');
  }, [assetName]);

  return (
    <div className="flex gap-1">
      <Input
        value={assetName}
        onChange={(e) => setAssetName(e.target.value)}
        placeholder="资产名称"
        className="h-5 text-[9px] bg-zinc-900 border-zinc-800 flex-1"
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 text-zinc-500 hover:text-purple-400"
        onClick={handleSave}
        title="保存到资产库"
      >
        <Plus className="size-3" />
      </Button>
    </div>
  );
}

// ============================================================
// Sub-component: Save tileset to library
// ============================================================

function SaveTilesetToLibrarySection() {
  const [name, setName] = useState('');

  const handleSave = useCallback(async () => {
    const tileStore = useTileWorkflowStore.getState();
    if (tileStore.tiles.length === 0) return;

    const tilesetName = name.trim() || '瓦片集';
    const tileW = tileStore.tileWidth;
    const tileH = tileStore.tileHeight;

    // Generate thumbnail from first tile
    const firstTile = tileStore.tiles[0];
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(tileW * 3, 64);
    canvas.height = Math.min(tileH * 3, 64);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      // Draw first few tiles in a grid
      const cols = Math.ceil(Math.sqrt(tileStore.tiles.length));
      const scale = Math.min(canvas.width / (tileW * cols), canvas.height / (tileH * Math.ceil(tileStore.tiles.length / cols)));
      ctx.save();
      ctx.scale(scale, scale);
      for (let i = 0; i < Math.min(tileStore.tiles.length, 9); i++) {
        const tile = tileStore.tiles[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const ox = col * tileW;
        const oy = row * tileH;
        for (let y = 0; y < tileH && y < tile.pixels.length; y++) {
          for (let x = 0; x < tileW && x < tile.pixels[y].length; x++) {
            const c = tile.pixels[y][x];
            if (c) {
              ctx.fillStyle = c;
              ctx.fillRect(ox + x, oy + y, 1, 1);
            }
          }
        }
      }
      ctx.restore();
    }

    const thumbnail = canvas.toDataURL();

    await useAssetStore.getState().saveTilesetToLibrary(
      tilesetName,
      tileW,
      tileH,
      tileStore.tiles.map((t) => ({
        pixels: t.pixels.map((r) => [...r] as string[]),
        animModifiers: t.animModifiers,
        tags: t.tags.map((tag) => String(tag)),
      })),
      thumbnail,
    );

    setName('');
  }, [name]);

  return (
    <div className="mt-1.5 pt-1.5 border-t border-zinc-800/50">
      <p className="text-[9px] text-zinc-600 mb-1">保存瓦片集到资产库</p>
      <div className="flex gap-1">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="瓦片集名称"
          className="h-5 text-[9px] bg-zinc-900 border-zinc-800 flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 text-zinc-500 hover:text-emerald-400"
          onClick={handleSave}
          title="保存瓦片集"
        >
          <Plus className="size-3" />
        </Button>
      </div>
    </div>
  );
}
