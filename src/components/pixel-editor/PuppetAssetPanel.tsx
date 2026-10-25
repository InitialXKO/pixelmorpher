'use client';

import React, { useState, useMemo } from 'react';
import {
  Users,
  Bone,
  Shirt,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Eye,
  EyeOff,
  Image,
  ImagePlus,
  Crosshair,
  Film,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import { NodeTreeItemWrapper, type NodeMenuHandlers, type ExpandCmd } from './puppet/NodeTree';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { collectSubtreeIds, deleteNodeSubtree, addSocketToNode } from '@/lib/node-actions';
import { SocketEditor, type SocketInfo } from './SocketEditor';
import SpriteThumb from './SpriteThumb';
import { filterSpritesByQuery } from '@/lib/sprite-thumb';
import ThreeBakeDialog from './puppet/ThreeBakeDialog';
import { Box } from 'lucide-react';
import { pxToSub, subToPx, type Socket } from '@/lib/unified-types';
import type {
  PuppetDirection,
} from '@/lib/types';
import type { Character, Node, Sprite } from '@/lib/unified-types';
import ResizePreviewDialog from './ResizePreviewDialog';
import PuppetCreationWizard from './PuppetCreationWizard';
import RefAssemblyWizard from './puppet/RefAssemblyWizard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ============================================================
// PuppetAssetPanel — Left panel for puppet mode
// Browses puppet characters, skeletons, sprite parts, and clips
// ============================================================

/** Socket（SubPixel）→ SocketInfo（像素） */
function socketToInfo(s: Socket): SocketInfo {
  return {
    id: s.id,
    name: s.name,
    x: subToPx(s.basePosition.x),
    y: subToPx(s.basePosition.y),
    directionOffsets: Object.fromEntries(
      Object.entries(s.directionOffsets ?? {})
        .filter(([, o]) => o !== undefined)
        .map(([d, o]) => [d, { x: subToPx(o.x), y: subToPx(o.y) }]),
    ),
    offset3D: s.offset3D
      ? { x: subToPx(s.offset3D.x), y: subToPx(s.offset3D.y), z: subToPx(s.offset3D.z) }
      : undefined,
  };
}

/** 行内重命名输入（右键菜单触发；Enter/blur 提交，Esc/空名取消） */
function RowRenameInput({ initial, onCommit }: { initial: string; onCommit: (name: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <input
      className="h-4 flex-1 min-w-0 bg-[#111128] border border-cyan-700 rounded px-1 text-[10px] text-gray-200 outline-none"
      value={v}
      autoFocus
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(v.trim());
        if (e.key === 'Escape') onCommit('');
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// ---- 精灵属性区（自退役的 PartPanel/SpritePanel 平移：锚点编辑/自动枢轴/调整尺寸） ----
function SpritePropertiesSection({ sprite }: { sprite: Sprite }) {
  const updateSprite = useProjectStore((s) => s.updateSprite);
  const autoEstimatePlug = useProjectStore((s) => s.autoEstimatePlug);
  const transformSprite = useProjectStore((s) => s.transformSprite);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [rotAngle, setRotAngle] = useState(90);
  const [rotStep, setRotStep] = useState(15);
  const [axisAngle, setAxisAngle] = useState(0);
  const [axisStep, setAxisStep] = useState(15);
  const snapAngle = (v: number, step: number) => (step > 1 ? Math.round(v / step) * step : v);
  const spriteId = sprite.id ?? '';
  const plugXPx = sprite.plug ? subToPx(sprite.plug.x) : 0;
  const plugYPx = sprite.plug ? subToPx(sprite.plug.y) : 0;
  const handlePlugChange = (axis: 'x' | 'y', value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num)) return;
    const clamped = Math.max(0, num);
    const cur = useProjectStore.getState().sprites[spriteId]?.plug ?? { x: 0, y: 0 };
    updateSprite(spriteId, {
      plug: axis === 'x' ? { x: pxToSub(clamped), y: cur.y } : { x: cur.x, y: pxToSub(clamped) },
    });
  };
  return (
    <div className="space-y-2 px-1 py-1.5">
      <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
        精灵属性 · {sprite.name ?? '未命名精灵'}
      </h4>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">锚点 X</Label>
          <Input
            type="number"
            min={0}
            max={sprite.width - 1}
            value={plugXPx}
            onChange={(e) => handlePlugChange('x', e.target.value)}
            className="h-7 text-xs px-2"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">锚点 Y</Label>
          <Input
            type="number"
            min={0}
            max={sprite.height - 1}
            value={plugYPx}
            onChange={(e) => handlePlugChange('y', e.target.value)}
            className="h-7 text-xs px-2"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-gray-500">
        <span>{sprite.width} x {sprite.height} px</span>
        <Button
          variant="outline"
          size="sm"
          className="h-5 px-1.5 text-[10px] gap-0.5 ml-auto"
          onClick={() => setResizeOpen(true)}
        >
          调整尺寸
        </Button>
      </div>
      <ResizePreviewDialog open={resizeOpen} onOpenChange={setResizeOpen} sprite={sprite} />
      <Button
        variant="outline"
        size="sm"
        className="h-6 w-full text-[10px] gap-1"
        onClick={() => autoEstimatePlug(spriteId)}
      >
        <Crosshair className="size-3" />
        自动枢轴
      </Button>
      <div className="space-y-1.5 border-t border-white/5 pt-2">
        <span className="text-[10px] text-gray-500">变换（绕锚点）</span>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['rot90', '↻ 90°'],
              ['rot270', '↺ 90°'],
              ['rot180', '180°'],
              ['flipH', '左右镜像'],
              ['flipV', '上下镜像'],
              ['transpose', '主对角'],
              ['antiTranspose', '副对角'],
            ] as const
          ).map(([op, label]) => (
            <Button
              key={op}
              variant="outline"
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              onClick={() => transformSprite(spriteId, { kind: 'd4', op })}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            value={rotAngle}
            onChange={(e) => setRotAngle(parseFloat(e.target.value) || 0)}
            className="h-6 w-16 text-[10px] px-1.5"
            title="旋转角（度，正值顺时针）"
          />
          <span className="text-[10px] text-gray-500">° 步进</span>
          <select
            value={rotStep}
            onChange={(e) => setRotStep(parseInt(e.target.value, 10))}
            className="h-6 rounded border border-white/10 bg-transparent px-1 text-[10px] text-gray-300"
            title="应用时把角度吸附到步进倍数"
          >
            <option value={1}>自由</option>
            <option value={15}>15°</option>
            <option value={45}>45°</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px] ml-auto"
            onClick={() => transformSprite(spriteId, { kind: 'rotate', angleDeg: snapAngle(rotAngle, rotStep) })}
          >
            旋转
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            value={axisAngle}
            onChange={(e) => setAxisAngle(parseFloat(e.target.value) || 0)}
            className="h-6 w-16 text-[10px] px-1.5"
            title="镜像轴向角（度）：0°=水平轴，90°=竖直轴，45°=主对角"
          />
          <span className="text-[10px] text-gray-500">° 步进</span>
          <select
            value={axisStep}
            onChange={(e) => setAxisStep(parseInt(e.target.value, 10))}
            className="h-6 rounded border border-white/10 bg-transparent px-1 text-[10px] text-gray-300"
            title="应用时把轴向角吸附到步进倍数"
          >
            <option value={1}>自由</option>
            <option value={15}>15°</option>
            <option value={45}>45°</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px] ml-auto"
            onClick={() => transformSprite(spriteId, { kind: 'mirrorAxis', axisDeg: snapAngle(axisAngle, axisStep) })}
          >
            轴镜像
          </Button>
        </div>
        <p className="text-[9px] leading-relaxed text-gray-600">
          90° 倍数旋转与 45° 倍数轴走无损置换；任意角/任意轴走 4× 超采样烘焙（与主渲染同口径）。
        </p>
      </div>
    </div>
  );
}

export default function PuppetAssetPanel() {
  // ---- New Character model ----
  const unifiedCharacters = useProjectStore((s) => s.unifiedCharacters) ?? {};
  const removeUnifiedCharacter = useProjectStore((s) => s.removeUnifiedCharacter);
  const addUnifiedNode = useProjectStore((s) => s.addUnifiedNode);
  const removeUnifiedNode = useProjectStore((s) => s.removeUnifiedNode);
  const updateUnifiedNode = useProjectStore((s) => s.updateUnifiedNode);
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useProjectStore((s) => s.setSelectedNodeId);
  // Character list derived from unifiedCharacters (each Character = skeleton + character)
  const characters: Character[] = useMemo(() => Object.values(unifiedCharacters), [unifiedCharacters]);

  const sprites = useProjectStore((s) => s.sprites);
  const animationClips = useProjectStore((s) => s.animationClips);
  const activeAnimationClipId = useProjectStore((s) => s.activeAnimationClipId);
  const setActiveAnimationClip = useProjectStore((s) => s.setActiveAnimationClip);

  const showPuppetSkeleton = useEditorStore((s) => s.showPuppetSkeleton);
  const togglePuppetSkeleton = useEditorStore((s) => s.togglePuppetSkeleton);
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const setActivePuppetSkeletonId = useEditorStore((s) => s.setActivePuppetSkeletonId);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [threeBakeOpen, setThreeBakeOpen] = useState(false);
  const [spriteQuery, setSpriteQuery] = useState('');
  // 新建空白精灵（从零绘制的入口；此前只有死面板 AssetLibraryPanel 里有，已退役）
  const [newSpriteOpen, setNewSpriteOpen] = useState(false);
  const [newSpriteName, setNewSpriteName] = useState('');
  const [newSpriteW, setNewSpriteW] = useState(32);
  const [newSpriteH, setNewSpriteH] = useState(32);
  const handleCreateSprite = () => {
    const w = Math.max(1, Math.min(512, newSpriteW || 32));
    const h = Math.max(1, Math.min(512, newSpriteH || 32));
    const name = newSpriteName.trim() || `精灵 ${Object.keys(sprites).length + 1}`;
    const sprite = useProjectStore.getState().addSprite(name, w, h);
    setNewSpriteOpen(false);
    setNewSpriteName('');
    setNewSpriteW(32);
    setNewSpriteH(32);
    if (sprite.id) useEditorStore.getState().enterSpriteEditMode(sprite.id);
  };
  // 属性区跟随编辑器选中精灵（点行进编辑时同步写入 selectedSpriteId）
  const selectedSpriteId = useEditorStore((s) => s.selectedSpriteId);
  const selectedSprite = selectedSpriteId ? (sprites[selectedSpriteId] ?? null) : null;
  // 导入 PNG（单张进精灵表，自退役的 PartPanel 平移）
  const spriteFileRef = React.useRef<HTMLInputElement>(null);
  const handleImportSpritePNG = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const name = file.name.replace(/\.[^/.]+$/, '') || '导入图像';
        const sprite = useProjectStore.getState().importSpriteFromImage(name, imageData);
        if (sprite.id) useEditorStore.getState().enterSpriteEditMode(sprite.id);
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const refWizardOpen = useEditorStore((s) => s.refWizardOpen);
  const setRefWizardOpen = useEditorStore((s) => s.setRefWizardOpen);
  const [expandedChars, setExpandedChars] = useState<Set<string>>(new Set());
  const [sectionExpanded, setSectionExpanded] = useState({
    characters: true,
    nodes: true,
    sprites: true,
    clips: true,
  });
  // 添加节点对话框：选父节点+插槽
  const [addNodeDialog, setAddNodeDialog] = useState<{
    parentNodeId: string;
    socketId: string;
  } | null>(null);

  const puppetClips = animationClips;

  // ---- 右键菜单：展开命令 + 行内重命名目标 ----
  const [expandCmd, setExpandCmd] = useState<ExpandCmd | null>(null);
  const [renaming, setRenaming] = useState<
    | { kind: 'character'; id: string }
    | { kind: 'costume'; id: string; charId: string }
    | { kind: 'sprite'; id: string }
    | { kind: 'clip'; id: string }
    | null
  >(null);

  const nodeMenuHandlers: NodeMenuHandlers | undefined = activePuppetSkeletonId
    ? {
        onRename: (node, name) => {
          const st = useProjectStore.getState();
          st.pushUndo('更新节点', 'updateNode');
          st.updateUnifiedNode(activePuppetSkeletonId, node.id, { name });
        },
        onAddChild: (node) => {
          setSelectedNodeId(node.id);
          setAddNodeDialog({
            parentNodeId: node.id,
            socketId: (node as Node).sockets?.[0]?.id ?? '',
          });
        },
        onAddSocket: (node) => addSocketToNode(activePuppetSkeletonId, node as Node),
        onClone: (node) => {
          const id = useProjectStore.getState().cloneNodeSubtree(activePuppetSkeletonId, node.id);
          if (id) setSelectedNodeId(id);
        },
        onTranspose: (node, deg) => {
          const id = useProjectStore
            .getState()
            .cloneNodeSubtreeTransposed(activePuppetSkeletonId, node.id, deg);
          if (id) setSelectedNodeId(id);
        },
        onCustomTranspose: (node) => {
          setSelectedNodeId(node.id);
          const el = document.getElementById('rig-transpose-angle-input') as HTMLInputElement | null;
          el?.focus();
          el?.select();
        },
        onToggleVisibility: (node) => {
          const target = unifiedCharacters[activePuppetSkeletonId]?.nodes[node.id];
          if (target) updateUnifiedNode(activePuppetSkeletonId, node.id, { visible: !target.visible });
        },
        onExpandSubtree: (node, value) => {
          const ch = unifiedCharacters[activePuppetSkeletonId];
          if (!ch) return;
          setExpandCmd({
            ids: new Set(collectSubtreeIds(ch.nodes, node.id)),
            value,
            nonce: Date.now(),
          });
        },
        onDelete: (node) => {
          deleteNodeSubtree(activePuppetSkeletonId, node.id);
        },
        isRoot: (node) => unifiedCharacters[activePuppetSkeletonId]?.rootNodeId === node.id,
      }
    : undefined;

  /** 精灵被服装槽位引用的次数（删除确认用；深走 pieces 统计同 id 字符串） */
  const countSpriteRefs = (spriteId: string): number => {
    const deep = (v: unknown): number =>
      v === spriteId
        ? 1
        : v && typeof v === 'object'
          ? Object.values(v as Record<string, unknown>).reduce<number>((a, x) => a + deep(x), 0)
          : 0;
    let n = 0;
    for (const ch of Object.values(unifiedCharacters)) {
      for (const cs of ch.costumeSets) n += deep(cs.pieces);
    }
    return n;
  };

  const toggleCharExpand = (id: string) => {
    setExpandedChars((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSection = (key: keyof typeof sectionExpanded) => {
    setSectionExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // ---- 选中节点及其插槽编辑（SocketEditor 接线） ----
  const activeCharacter = activePuppetSkeletonId ? unifiedCharacters[activePuppetSkeletonId] ?? null : null;
  const selectedNode = activeCharacter && selectedNodeId ? activeCharacter.nodes[selectedNodeId] ?? null : null;

  const handleSocketChange = (socketId: string, updates: Partial<SocketInfo>) => {
    if (!activePuppetSkeletonId || !selectedNode) return;
    const sockets = selectedNode.sockets.map((s) => {
      if (s.id !== socketId) return s;
      const next: Socket = { ...s };
      if (updates.name !== undefined) next.name = updates.name;
      if (updates.x !== undefined || updates.y !== undefined) {
        next.basePosition = {
          x: pxToSub(updates.x ?? subToPx(s.basePosition.x)),
          y: pxToSub(updates.y ?? subToPx(s.basePosition.y)),
        };
      }
      if (updates.directionOffsets !== undefined) {
        const dirOff: Record<string, { x: ReturnType<typeof pxToSub>; y: ReturnType<typeof pxToSub> }> = {};
        for (const [d, o] of Object.entries(updates.directionOffsets)) {
          if (o) dirOff[d] = { x: pxToSub(o.x), y: pxToSub(o.y) };
        }
        next.directionOffsets = dirOff as Socket['directionOffsets'];
      }
      if ('offset3D' in updates) {
        next.offset3D = updates.offset3D
          ? { x: pxToSub(updates.offset3D.x), y: pxToSub(updates.offset3D.y), z: pxToSub(updates.offset3D.z) }
          : undefined;
      }
      return next;
    });
    updateUnifiedNode(activePuppetSkeletonId, selectedNode.id, { sockets });
  };

  const handleSocketAdd = () => {
    if (!activePuppetSkeletonId || !selectedNode) return;
    const newSocket: Socket = {
      id: crypto.randomUUID(),
      name: `socket_${selectedNode.sockets.length + 1}`,
      basePosition: { x: pxToSub(0), y: pxToSub(-8) },
      directionOffsets: {},
    };
    updateUnifiedNode(activePuppetSkeletonId, selectedNode.id, {
      sockets: [...selectedNode.sockets, newSocket],
    });
  };

  const handleSocketRemove = (socketId: string) => {
    if (!activePuppetSkeletonId || !selectedNode || !activeCharacter) return;
    const socket = selectedNode.sockets.find((s) => s.id === socketId);
    const attached = Object.values(activeCharacter.nodes).filter(
      (n) => n.attachment?.type === 'socket' && n.attachment.parentSocketId === socketId,
    );
    if (attached.length > 0 && !confirm(`删除插槽「${socket?.name ?? socketId}」会 detach ${attached.length} 个子节点（${attached.map((n) => n.name).join('、')}），继续？`)) return;
    updateUnifiedNode(activePuppetSkeletonId, selectedNode.id, {
      sockets: selectedNode.sockets.filter((s) => s.id !== socketId),
    });
    // 与 RigPanel 同语义：被 detach 的子节点改 fixed 附件（parentId 保留，仍挂在原父节点下）
    for (const n of attached) {
      updateUnifiedNode(activePuppetSkeletonId, n.id, {
        attachment: { type: 'fixed', fixedOffset: { x: 0, y: 0 }, inheritRotation: true },
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d1a]">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-[#1e1e3a]">
        <Users className="size-3.5 text-cyan-400" />
        <span className="text-[10px] font-semibold text-cyan-300 uppercase tracking-wider flex-1">
          木偶资产
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-cyan-400 hover:text-cyan-300"
          onClick={() => setWizardOpen(true)}
          title="创建木偶角色"
        >
          <Plus className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-amber-400 hover:text-amber-300"
          onClick={() => setRefWizardOpen(true)}
          title="从参考图装配"
        >
          <Image className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-purple-400 hover:text-purple-300"
          onClick={() => setThreeBakeOpen(true)}
          title="3D 烘焙导入（GLB → 2D 木偶）"
        >
          <Box className="size-3" />
        </Button>
      </div>

      <ThreeBakeDialog open={threeBakeOpen} onClose={() => setThreeBakeOpen(false)} />

      {/* 新建空白精灵：建完直接进像素编辑从零画 */}
      <Dialog open={newSpriteOpen} onOpenChange={setNewSpriteOpen}>
        <DialogContent className="sm:max-w-[320px]">
          <DialogHeader>
            <DialogTitle>新建精灵</DialogTitle>
            <DialogDescription>创建一张空白像素精灵，创建后直接进入像素编辑。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-sprite-name" className="text-xs">名称</Label>
              <Input
                id="new-sprite-name"
                value={newSpriteName}
                onChange={(e) => setNewSpriteName(e.target.value)}
                placeholder={`精灵 ${Object.keys(sprites).length + 1}`}
                className="h-8 text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateSprite(); }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-sprite-w" className="text-xs">宽度</Label>
                <Input
                  id="new-sprite-w"
                  type="number"
                  min={1}
                  max={512}
                  value={newSpriteW}
                  onChange={(e) => setNewSpriteW(Number(e.target.value))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-sprite-h" className="text-xs">高度</Label>
                <Input
                  id="new-sprite-h"
                  type="number"
                  min={1}
                  max={512}
                  value={newSpriteH}
                  onChange={(e) => setNewSpriteH(Number(e.target.value))}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setNewSpriteOpen(false)}>取消</Button>
            <Button size="sm" onClick={handleCreateSprite}>创建并编辑</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PuppetCreationWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      {refWizardOpen ? (
        <div className="flex-1 min-h-0">
          <RefAssemblyWizard
            onClose={() => {
              const store = useEditorStore.getState();
              // 清理：退出遮罩锁定，隐藏参考图
              if (store.editMode === 'mask') {
                store.setEditMode('normal');
                store.setMaskNodeId(null);
              }
              // 不清除 referenceImageUrl，用户可能还想看；但隐藏
              store.setReferenceImageVisible(false);
              setRefWizardOpen(false);
            }}
          />
        </div>
      ) : (
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">

          {/* ---- Characters Section ---- */}
          <div>
            <button
              className="flex items-center gap-1 w-full px-1 py-1 text-[10px] text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
              onClick={() => toggleSection('characters')}
            >
              {sectionExpanded.characters ? (
                <ChevronDown className="size-2.5" />
              ) : (
                <ChevronRight className="size-2.5" />
              )}
              <Users className="size-2.5" />
              角色 ({characters.length})
            </button>

            {sectionExpanded.characters && (
              <div className="space-y-0.5 mt-0.5">
                {characters.length === 0 ? (
                  <div className="text-center py-4 px-2">
                    <Users className="size-5 text-gray-700 mx-auto mb-1" />
                    <p className="text-[9px] text-gray-600 mb-2">尚无木偶角色</p>
                    <Button
                      size="sm"
                      className="text-[9px] h-6 bg-cyan-600 hover:bg-cyan-500"
                      onClick={() => setWizardOpen(true)}
                    >
                      <Plus className="size-2.5 mr-0.5" /> 创建角色
                    </Button>
                  </div>
                ) : (
                  Object.entries(unifiedCharacters).map(([skeletonKey, char]) => {
                    const isExpanded = expandedChars.has(char.id);
                    const clip = puppetClips.find(
                      (c) => c.puppetCharacterId === char.id
                    );
                    const isActive =
                      activePuppetSkeletonId === skeletonKey;
                    const nodeCount = Object.keys(char.nodes).length;

                    return (
                      <div key={char.id}>
                        <ContextMenu>
                          <ContextMenuTrigger asChild>
                        <div
                          className={`group flex items-center gap-1 px-1.5 py-1 rounded cursor-pointer transition-colors ${
                            isActive
                              ? 'bg-cyan-500/15 text-cyan-300'
                              : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                          }`}
                          onClick={() => {
                            setActivePuppetSkeletonId(skeletonKey);
                            // 只开不关：避免点另一个角色时把骨骼显示关掉
                            if (!useEditorStore.getState().showPuppetSkeleton) {
                              togglePuppetSkeleton();
                            }
                            toggleCharExpand(char.id);
                          }}
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-2.5 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="size-2.5 flex-shrink-0" />
                          )}
                          <Shirt className="size-2.5 text-cyan-500/70 flex-shrink-0" />
                          {renaming?.kind === 'character' && renaming.id === skeletonKey ? (
                            <RowRenameInput
                              initial={char.name}
                              onCommit={(name) => {
                                if (name && name !== char.name) {
                                  useProjectStore.getState().updateUnifiedCharacter(skeletonKey, { name });
                                }
                                setRenaming(null);
                              }}
                            />
                          ) : (
                            <span className="text-[10px] truncate flex-1 min-w-0">
                              {char.name}
                            </span>
                          )}
                          <span className="text-[8px] text-gray-600">
                            {nodeCount} 节点
                          </span>
                          <button
                            className="opacity-0 group-hover:opacity-100 hover:text-red-400 text-gray-600 transition-opacity"
                            title="删除角色"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`确定删除角色「${char.name}」吗？其骨架、服装和动画片段将一并删除，此操作不可撤销。`)) {
                                removeUnifiedCharacter(skeletonKey);
                              }
                            }}
                          >
                            <Trash2 className="size-2.5" />
                          </button>
                        </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="min-w-36">
                            <ContextMenuItem
                              onSelect={() => {
                                setActivePuppetSkeletonId(skeletonKey);
                                if (!useEditorStore.getState().showPuppetSkeleton) {
                                  togglePuppetSkeleton();
                                }
                              }}
                            >
                              设为当前角色
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => setRenaming({ kind: 'character', id: skeletonKey })}>
                              重命名
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() =>
                                useProjectStore
                                  .getState()
                                  .addUnifiedCostumeSet(skeletonKey, `服装集 ${(char.costumeSets.length ?? 0) + 1}`)
                              }
                            >
                              新建服装集
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              className="text-red-400 focus:text-red-300"
                              onSelect={() => {
                                if (confirm(`确定删除角色「${char.name}」吗？其骨架、服装和动画片段将一并删除，此操作不可撤销。`)) {
                                  removeUnifiedCharacter(skeletonKey);
                                }
                              }}
                            >
                              删除角色
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>

                        {isExpanded && (
                          <div className="ml-4 space-y-0.5 mt-0.5">
                            {/* Skeleton info */}
                            <div className="flex items-center gap-1 px-1 py-0.5 text-[9px] text-gray-500">
                              <Bone className="size-2" />
                              <span className="truncate">
                                {char.name}
                              </span>
                            </div>
                            {/* Costume sets */}
                            {char.costumeSets.map((cs) => (
                              <ContextMenu key={cs.id}>
                                <ContextMenuTrigger asChild>
                                  <div className="flex items-center gap-1 px-1 py-0.5 text-[9px] text-gray-500 cursor-pointer hover:text-gray-300">
                                    <Shirt className="size-2" />
                                    {renaming?.kind === 'costume' && renaming.id === cs.id ? (
                                      <RowRenameInput
                                        initial={cs.name}
                                        onCommit={(name) => {
                                          if (name && name !== cs.name) {
                                            useProjectStore
                                              .getState()
                                              .updateUnifiedCostumeSet(skeletonKey, cs.id, { name });
                                          }
                                          setRenaming(null);
                                        }}
                                      />
                                    ) : (
                                      <span className="truncate">{cs.name}</span>
                                    )}
                                    {char.activeCostumeSetId === cs.id && (
                                      <span className="text-cyan-500">生效中</span>
                                    )}
                                    <span className="text-gray-700">
                                      {Object.keys(cs.pieces).length} 槽位
                                    </span>
                                  </div>
                                </ContextMenuTrigger>
                                <ContextMenuContent className="min-w-36">
                                  <ContextMenuItem
                                    disabled={char.activeCostumeSetId === cs.id}
                                    onSelect={() =>
                                      useProjectStore
                                        .getState()
                                        .updateUnifiedCharacter(skeletonKey, { activeCostumeSetId: cs.id })
                                    }
                                  >
                                    设为生效
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    onSelect={() => setRenaming({ kind: 'costume', id: cs.id, charId: skeletonKey })}
                                  >
                                    重命名
                                  </ContextMenuItem>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem
                                    className="text-red-400 focus:text-red-300"
                                    onSelect={() => {
                                      if (confirm(`确定删除服装集「${cs.name}」吗？其 ${Object.keys(cs.pieces).length} 个槽位配置将一并删除。`)) {
                                        useProjectStore.getState().removeUnifiedCostumeSet(skeletonKey, cs.id);
                                      }
                                    }}
                                  >
                                    删除服装集
                                  </ContextMenuItem>
                                </ContextMenuContent>
                              </ContextMenu>
                            ))}
                            {/* Linked clip */}
                            {clip && (
                              <div className="flex items-center gap-1 px-1 py-0.5 text-[9px] text-gray-500">
                                <Film className="size-2" />
                                <span className="truncate">{clip.name}</span>
                                <span className="text-gray-700">
                                  {clip.endFrame - clip.startFrame + 1} 帧
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <Separator className="bg-[#1e1e3a]" />

          {/* ---- Node Tree Section (共享，右侧三段共用) ---- */}
          <div>
            <div className="flex items-center gap-1">
              <button
                className="flex items-center gap-1 flex-1 px-1 py-1 text-[10px] text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
                onClick={() => toggleSection('nodes')}
              >
                {sectionExpanded.nodes ? (
                  <ChevronDown className="size-2.5" />
                ) : (
                  <ChevronRight className="size-2.5" />
                )}
                <Bone className="size-2.5" />
                节点树
              </button>
              {/* 增删节点 */}
              {activePuppetSkeletonId && (() => {
                const character = unifiedCharacters[activePuppetSkeletonId];
                if (!character) return null;
                const nodes = Object.values(character.nodes);
                return (
                <>
                  <button
                    className="size-5 flex items-center justify-center text-cyan-400 hover:text-cyan-300"
                    title="添加节点（选择父节点插槽）"
                    onClick={() => {
                      if (nodes.length === 0) {
                        // 没有节点时直接创建根节点
                        const newNode = addUnifiedNode(activePuppetSkeletonId, `节点_1`, {
                          zIndex: 0,
                        });
                        setSelectedNodeId(newNode.id);
                        return;
                      }
                      // 默认选第一个节点的第一个插槽
                      const firstNode = nodes[0];
                      setAddNodeDialog({
                        parentNodeId: firstNode.id,
                        socketId: firstNode.sockets[0]?.id ?? '',
                      });
                    }}
                  >
                    <Plus className="size-3" />
                  </button>
                  <button
                    className="size-5 flex items-center justify-center text-red-400 hover:text-red-300"
                    title="删除选中节点"
                    onClick={() => {
                      if (!selectedNodeId) return;
                      if (!confirm('确定删除该节点吗？')) return;
                      removeUnifiedNode(activePuppetSkeletonId, selectedNodeId);
                      setSelectedNodeId(null);
                    }}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </>
                );
              })()}
            </div>
            {sectionExpanded.nodes && (() => {
              const character = activePuppetSkeletonId ? unifiedCharacters[activePuppetSkeletonId] : null;
              if (!character) {
                return <p className="text-[9px] text-gray-600 px-1 py-1">先选择骨架</p>;
              }
              const nodes = Object.values(character.nodes);
              // Root nodes: no parentId (migrated from !node.plug)
              const rootNodes = nodes.filter((node) => !node.parentId);
              return (
                <div className="bg-[#080818] rounded border border-[#1e1e3a] p-1 max-h-64 overflow-y-auto mt-1">
                  {rootNodes.map((node) => (
                      <NodeTreeItemWrapper
                        key={node.id}
                        node={node}
                        depth={0}
                        selectedNodeId={selectedNodeId}
                        onSelect={(id) => {
                          setSelectedNodeId(id);
                          // 节点树点选同样进入锁定（与画布中键命中同一状态）
                          useEditorStore.getState().setNodeLockId(id);
                        }}
                        allNodes={nodes}
                        menuHandlers={nodeMenuHandlers}
                        expandCmd={expandCmd}
                        onToggleVisibility={(nodeId) => {
                          const target = character.nodes[nodeId];
                          if (target && activePuppetSkeletonId) {
                            updateUnifiedNode(activePuppetSkeletonId, nodeId, { visible: !target.visible });
                          }
                        }}
                      />
                    ))}
                </div>
              );
            })()}
          </div>

          {/* 添加节点对话框 */}
          {addNodeDialog && (() => {
            const character = activePuppetSkeletonId ? unifiedCharacters[activePuppetSkeletonId] : null;
            if (!character) return null;
            const nodes = Object.values(character.nodes);
            const parentNode = character.nodes[addNodeDialog.parentNodeId];
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAddNodeDialog(null)}>
                <div className="bg-[#0d0d1a] border border-[#1e1e3a] rounded p-4 w-64 space-y-3" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-xs font-medium text-gray-200">添加节点</h3>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">父节点</label>
                    <select
                      value={addNodeDialog.parentNodeId}
                      onChange={(e) => {
                        const pid = e.target.value;
                        const pnode = character.nodes[pid];
                        setAddNodeDialog({ parentNodeId: pid, socketId: pnode?.sockets[0]?.id ?? '' });
                      }}
                      className="w-full h-7 text-[11px] bg-[#111128] border border-[#1e1e3a] rounded px-2 text-gray-300"
                    >
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>{n.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">插槽</label>
                    <select
                      value={addNodeDialog.socketId}
                      onChange={(e) => setAddNodeDialog({ ...addNodeDialog, socketId: e.target.value })}
                      className="w-full h-7 text-[11px] bg-[#111128] border border-[#1e1e3a] rounded px-2 text-gray-300"
                    >
                      {(parentNode?.sockets ?? []).map((s) => (
                        <option key={s.id} value={s.id}>{s.name || s.id.slice(0, 8)}</option>
                      ))}
                      {(parentNode?.sockets ?? []).length === 0 && (
                        <option value="">（无插槽，将创建为根节点）</option>
                      )}
                    </select>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      className="px-3 h-7 text-[11px] text-gray-400 hover:text-gray-200"
                      onClick={() => setAddNodeDialog(null)}
                    >
                      取消
                    </button>
                    <button
                      className="px-3 h-7 text-[11px] bg-cyan-600 hover:bg-cyan-500 text-white rounded"
                      onClick={() => {
                        const nodeName = `节点_${nodes.length + 1}`;
                        // New model: plug → attachment
                        const attachment = addNodeDialog.socketId
                          ? { type: 'socket' as const, parentSocketId: addNodeDialog.socketId, plug: { x: 0, y: 0 } }
                          : { type: 'fixed' as const, fixedOffset: { x: 0, y: 0 }, inheritRotation: true };
                        const newNode = addUnifiedNode(activePuppetSkeletonId!, nodeName, {
                          zIndex: 0,
                          attachment,
                        });
                        setSelectedNodeId(newNode.id);
                        setAddNodeDialog(null);
                      }}
                    >
                      添加
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ---- 选中节点的插槽编辑（SocketEditor） ---- */}
          {selectedNode && (
            <div className="mt-2 bg-[#080818] rounded border border-[#1e1e3a] p-1.5">
              <div className="text-[9px] text-gray-500 px-0.5 pb-1 truncate">
                {selectedNode.name} 的插槽
              </div>
              <SocketEditor
                sockets={selectedNode.sockets.map(socketToInfo)}
                selectedDirection={(activeCharacter?.nodes[activeCharacter.rootNodeId]?.transform.variantIndex ?? 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}
                onSocketChange={handleSocketChange}
                onSocketAdd={handleSocketAdd}
                onSocketRemove={handleSocketRemove}
              />
            </div>
          )}

          <Separator className="bg-[#1e1e3a]" />

          {/* ---- Sprite Parts Section ---- */}
          <div>
            <div className="flex items-center">
              <button
                className="flex items-center gap-1 flex-1 px-1 py-1 text-[10px] text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
                onClick={() => toggleSection('sprites')}
              >
                {sectionExpanded.sprites ? (
                  <ChevronDown className="size-2.5" />
                ) : (
                  <ChevronRight className="size-2.5" />
                )}
                <Image className="size-2.5" />
                精灵 ({Object.keys(sprites).length})
              </button>
              <button
                title="新建精灵"
                aria-label="新建精灵"
                className="p-1 text-gray-500 hover:text-gray-200 hover:bg-white/5 rounded transition-colors"
                onClick={() => setNewSpriteOpen(true)}
              >
                <Plus className="size-3" />
              </button>
              <button
                title="导入 PNG"
                aria-label="导入 PNG"
                className="p-1 mr-1 text-gray-500 hover:text-gray-200 hover:bg-white/5 rounded transition-colors"
                onClick={() => spriteFileRef.current?.click()}
              >
                <ImagePlus className="size-3" />
              </button>
              <input
                ref={spriteFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleImportSpritePNG}
              />
            </div>

            {sectionExpanded.sprites && (
              <div className="px-1 pb-0.5">
                <input
                  type="text"
                  value={spriteQuery}
                  onChange={(e) => setSpriteQuery(e.target.value)}
                  placeholder="搜索精灵"
                  className="h-6 w-full text-[10px] bg-[#0a0a1e] border border-[#1e1e3a] rounded px-1.5 text-gray-300"
                />
              </div>
            )}
            {sectionExpanded.sprites && (
              <div className="space-y-0.5 mt-0.5 max-h-32 overflow-y-auto">
                {filterSpritesByQuery(Object.values(sprites), spriteQuery).map((sprite) => (
                  <ContextMenu key={sprite.id}>
                    <ContextMenuTrigger asChild>
                  <div
                    className="group flex items-center gap-1.5 px-1.5 py-0.5 text-[9px] text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded cursor-pointer transition-colors"
                    title="编辑像素"
                    onClick={() => {
                      useEditorStore.getState().enterSpriteEditMode(sprite.id!);
                    }}
                  >
                    <SpriteThumb sprite={sprite} size={18} className="rounded-sm bg-black/50 flex-shrink-0" />
                    {renaming?.kind === 'sprite' && renaming.id === sprite.id ? (
                      <RowRenameInput
                        initial={sprite.name ?? ''}
                        onCommit={(name) => {
                          if (name && name !== sprite.name) {
                            useProjectStore.getState().updateSprite(sprite.id!, { name });
                          }
                          setRenaming(null);
                        }}
                      />
                    ) : (
                      <span className="truncate flex-1 min-w-0">{sprite.name}</span>
                    )}
                    {(() => {
                      const lm = (sprite as any).landmarks;
                      const n = lm ? ['leftEye', 'rightEye', 'nose', 'mouth'].filter((k) => (lm as any)[k]).length : 0;
                      return n > 0 ? (
                        <span className="text-cyan-500/80" title="特征点标注">
                          ◉{n}/4
                        </span>
                      ) : null;
                    })()}
                    <span className="text-gray-700">
                      {sprite.width}x{sprite.height}
                    </span>
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-white"
                      title="编辑像素"
                      onClick={(e) => {
                        e.stopPropagation();
                        useEditorStore.getState().enterSpriteEditMode(sprite.id!);
                      }}
                    >
                      ✏️
                    </button>
                  </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="min-w-36">
                      <ContextMenuItem
                        onSelect={() => useEditorStore.getState().enterSpriteEditMode(sprite.id!)}
                      >
                        编辑像素
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => setRenaming({ kind: 'sprite', id: sprite.id! })}>
                        重命名
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => {
                          const dup = useProjectStore.getState().duplicateSprite(sprite.id!);
                          if (dup?.id) useEditorStore.getState().enterSpriteEditMode(dup.id);
                        }}
                      >
                        复制精灵
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onSelect={() => useProjectStore.getState().transformSprite(sprite.id!, { kind: 'd4', op: 'rot90' })}
                      >
                        顺时针旋转 90°
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => useProjectStore.getState().transformSprite(sprite.id!, { kind: 'd4', op: 'rot270' })}
                      >
                        逆时针旋转 90°
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => useProjectStore.getState().transformSprite(sprite.id!, { kind: 'd4', op: 'flipH' })}
                      >
                        左右镜像
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => useProjectStore.getState().transformSprite(sprite.id!, { kind: 'd4', op: 'flipV' })}
                      >
                        上下镜像
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className="text-red-400 focus:text-red-300"
                        onSelect={() => {
                          const refs = countSpriteRefs(sprite.id!);
                          const msg =
                            refs > 0
                              ? `精灵「${sprite.name}」被 ${refs} 处槽位引用，删除后这些槽位将无图，继续？`
                              : `确定删除精灵「${sprite.name}」吗？`;
                          if (confirm(msg)) useProjectStore.getState().removeSprite(sprite.id!);
                        }}
                      >
                        删除精灵
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </div>
            )}
            {sectionExpanded.sprites && selectedSprite && (
              <div className="border-t border-white/5 mt-0.5">
                <SpritePropertiesSection sprite={selectedSprite} />
              </div>
            )}
          </div>

          <Separator className="bg-[#1e1e3a]" />

          {/* ---- Puppet Clips Section ---- */}
          <div>
            <button
              className="flex items-center gap-1 w-full px-1 py-1 text-[10px] text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
              onClick={() => toggleSection('clips')}
            >
              {sectionExpanded.clips ? (
                <ChevronDown className="size-2.5" />
              ) : (
                <ChevronRight className="size-2.5" />
              )}
              <Film className="size-2.5" />
              木偶片段 ({puppetClips.length})
            </button>

            {sectionExpanded.clips && (
              <div className="space-y-0.5 mt-0.5">
                {puppetClips.length === 0 ? (
                  <p className="text-[9px] text-gray-700 text-center py-2">
                    尚无木偶动画片段
                  </p>
                ) : (
                  puppetClips.map((clip) => {
                    // Find character by Character.id (equals puppetCharacterId after migration)
                    const char = characters.find(
                      (c) => c.id === clip.puppetCharacterId
                    );
                    return (
                      <ContextMenu key={clip.id}>
                        <ContextMenuTrigger asChild>
                          <div
                            className={`flex items-center gap-1.5 px-1.5 py-1 rounded cursor-pointer transition-colors ${
                              activeAnimationClipId === clip.id
                                ? 'bg-amber-500/15 text-amber-300'
                                : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                            }`}
                            onClick={() => setActiveAnimationClip(clip.id)}
                          >
                            <Film className="size-2.5 text-amber-500/70 flex-shrink-0" />
                            {renaming?.kind === 'clip' && renaming.id === clip.id ? (
                              <RowRenameInput
                                initial={clip.name}
                                onCommit={(name) => {
                                  if (name && name !== clip.name) {
                                    useProjectStore.getState().updateAnimationClip(clip.id, { name });
                                  }
                                  setRenaming(null);
                                }}
                              />
                            ) : (
                              <span className="text-[10px] truncate flex-1 min-w-0">
                                {clip.name}
                              </span>
                            )}
                            <span className="text-[8px] text-gray-600">
                              {clip.endFrame - clip.startFrame + 1} 帧
                            </span>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="min-w-36">
                          <ContextMenuItem onSelect={() => setActiveAnimationClip(clip.id)}>
                            设为当前片段
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={() => setRenaming({ kind: 'clip', id: clip.id })}>
                            重命名
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            className="text-red-400 focus:text-red-300"
                            onSelect={() => {
                              if (animationClips.length <= 1) return;
                              if (!confirm(`确定删除动画片段「${clip.name}」吗？其中的关键帧将一并删除，此操作不可撤销。`)) return;
                              useProjectStore.getState().removeAnimationClip(clip.id);
                            }}
                          >
                            删除片段
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* ---- Skeleton Overlay Toggle ---- */}
          <Separator className="bg-[#1e1e3a]" />
          <div className="flex items-center gap-2 px-1.5 py-1.5">
            <button
              className={`flex items-center gap-1.5 text-[10px] transition-colors ${
                showPuppetSkeleton
                  ? 'text-cyan-400'
                  : 'text-gray-600 hover:text-gray-300'
              }`}
              onClick={togglePuppetSkeleton}
            >
              {showPuppetSkeleton ? (
                <Eye className="size-3" />
              ) : (
                <EyeOff className="size-3" />
              )}
              骨骼叠加显示
            </button>
          </div>
        </div>
      </ScrollArea>
      )}
    </div>
  );
}
