'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ArrowLeft, ArrowRight, X, Upload } from 'lucide-react';
import { useEditorStore, useProjectStore } from '@/lib/store';
import { refAssemblyComboKey, refImageSlotKey, type RefAssemblyCombo } from '@/lib/store/editor-store';
import { computeSlotVariantsAfterAssemblyDiscard, readPieceLayerSpriteId } from '@/lib/store/character-slice';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import type { PixelGrid } from '@/lib/types';
import { initSAM, isSAMReady, setSAMImage } from '@/lib/sam';
import { inpaintPixels } from '@/lib/inpainting';
import type { CostumePiece, CostumeSet, DirectionIndex, NodeTransform, NodeTracks, Sprite } from '@/lib/unified-types';
import { collectSubtreeIds, deleteNodeSubtree, ensureChildAttachment } from '@/lib/node-actions';
import PivotEditor from './PivotEditor';

// ============================================================
// RefAssemblyWizard - 参考图装配向导
// 四步：底图 → 对位 → 抠图 → 确认
// ============================================================

type Step = 'upload' | 'sam' | 'align' | 'mask' | 'cleanup' | 'confirm';

// 模块级持久化：防组件卸载导致状态丢失（左栏隐藏即卸载本向导）。
// 工作服装 ID 与姿态快照也必须在此层：只存组件 state/ref 时，重挂后选模板
// 的 effect 会再建一套工作服装（旧的一套连同已抠精灵成孤儿、生效集被换走）
// 并把已对位过的姿态当原姿态重拍快照——关闭时「恢复」的就是污染后的姿态。
let persistedStep: Step = 'upload';
let persistedSelectedCharacterId: string | null = null;
let persistedWorkingCostumeId: string | null = null;
// 已处理进度按组合记：键 = refAssemblyComboKey（节点 × 方向 × 纬度 × 写入层），
// 值带节点与组合本身，确认步按节点归组列组合清单时不必反解键。
export interface ProcessedComboEntry extends RefAssemblyCombo {
  nodeId: string;
  method: string; // 'mask' | 'mirror' | 'copy'
}
let persistedProcessedNodes: Map<string, ProcessedComboEntry> = new Map();
// ---- 参考图分槽：键 `${direction}|${latitude}` → 图片地址 ----
// 当前槽 = 当前目标方向 × 当前目标纬度；切方向/纬度时当前参考图换成新槽
// 的图（槽空则清空），由组件内同步 effect 执行。步 1 选图与 SAM 产出都写
// 进当前槽。槽内 blob 地址在清表时回收（正显示的那张除外，它的回收归
// handleClose 的既有口径，见 clearRefImageSlots）。
let persistedRefImageSlots: Map<string, string> = new Map();
// 当前 referenceImageUrl 归属的槽键；null = 尚未归属（首次由同步 effect
// 把已在显示的图收编进当前槽，而不是清空——向导外设入的参考图不许丢）。
let persistedRefImageSlotKey: string | null = null;
function clearRefImageSlots(revokeDisplayed = false) {
  const displayed = useEditorStore.getState().referenceImageUrl;
  for (const url of persistedRefImageSlots.values()) {
    if (url.startsWith('blob:') && (revokeDisplayed || url !== displayed)) {
      URL.revokeObjectURL(url);
    }
  }
  persistedRefImageSlots.clear();
  persistedRefImageSlotKey = null;
}
// SAM 分割步点选图的缩放/平移视角（原图与预览图共用一份，两图交替不跳）：
// 与 step 同理模块级持久化，切步/重挂不丢；换新参考图时由组件内 effect 复位。
let persistedSamView = { scale: 1, x: 0, y: 0 };
let persistedPoseSnapshot: {
  charKey: string;
  /** 会话开始前的角色纬度（与姿态同快照：会话期间角色纬度切到目标纬度，结束时恢复） */
  latitude: number;
  nodes: Map<string, { transform: NodeTransform; tracks: NodeTracks }>;
} | null = null;
// ---- 装配目标（会话语义与快照，同理由模块级持久化） ----
// 目标服装集选择：'new' = 每会话新建一套「X（装配）」；否则为已有服装集 id。
let persistedTargetCostumeChoice: string = 'new';
// 写入层与目标纬度是活选择（会话中可改，立即作用于后续写入，不重启会话）。
let persistedTargetVariantId: string | null = null;
let persistedTargetLatitude = 0;
// 当前装配会话的元信息：结束会话时按它决定丢弃方式（新建集删除 / 已有集还原）。
let persistedSessionMeta: {
  charKey: string;
  costumeSetId: string;
  isNewCostumeSet: boolean;
} | null = null;
// 目标为已有集时的会话快照：pieces 深拷贝 + 会话前的生效集（放弃时整表还原）。
let persistedTargetSnapshot: {
  charKey: string;
  costumeSetId: string;
  pieces: CostumeSet['pieces'];
  prevActiveCostumeSetId?: string;
} | null = null;
export function resetRefWizardStep() {
  persistedStep = 'upload';
  persistedSelectedCharacterId = null;
  persistedWorkingCostumeId = null;
  persistedProcessedNodes = new Map();
  persistedSamView = { scale: 1, x: 0, y: 0 };
  persistedPoseSnapshot = null;
  persistedTargetCostumeChoice = 'new';
  persistedTargetVariantId = null;
  persistedTargetLatitude = 0;
  persistedSessionMeta = null;
  persistedTargetSnapshot = null;
  // 参考图槽表随会话状态一并清（正显示的 blob 不在此回收：X 关闭路径已由
  // handleClose 先行回收；完成路径保留显示，地址留待下次收编/关闭处理）
  clearRefImageSlots(false);
}

const STEPS: { id: Step; label: string; optional?: boolean }[] = [
  { id: 'upload', label: '底图' },
  { id: 'sam', label: 'AI分割', optional: true },
  { id: 'align', label: '对位' },
  { id: 'mask', label: '抠图' },
  { id: 'cleanup', label: 'AI清理', optional: true },
  { id: 'confirm', label: '确认' },
];

// 方向名（下标与对位步下拉同一约定：6 南 / 2 北 / 0 东 / 4 西 / 斜向 1/7/5/3）
const DIRECTION_NAMES: Record<number, string> = {
  0: '东', 1: '东北', 2: '北', 3: '西北', 4: '西', 5: '西南', 6: '南', 7: '东南',
};
// 服装槽总览的行内方向顺序：南起顺时针
const DIRECTION_DISPLAY_ORDER = [6, 7, 0, 1, 2, 3, 4, 5];

/** 组合的人话写法：方向 · 层（纬度层 / 变体名 / 基础层），确认步与覆盖确认共用 */
function refAssemblyComboLabel(
  combo: RefAssemblyCombo,
  variantName?: (id: string) => string | undefined,
): string {
  const dir = DIRECTION_NAMES[combo.direction] ?? `方向${combo.direction}`;
  if (combo.latitude !== 0) return `${dir} · 纬度 ${combo.latitude}°`;
  if (combo.variantId) return `${dir} · 变体「${variantName?.(combo.variantId) ?? combo.variantId}」`;
  return `${dir} · 基础层`;
}

const BUILT_IN_REFS = [
  { id: 'knight-front', label: '骑士·正面', url: '/reference-demos/knight-front.webp' },
  { id: 'runner-side', label: '跑者·侧面', url: '/reference-demos/runner-side.webp' },
  { id: 'dog-side', label: '小狗·侧面', url: '/reference-demos/dog-side.webp' },
  { id: 'robot-front', label: '机器人·正面', url: '/reference-demos/robot-front.webp' },
  { id: 'mecha-side', label: '机甲·侧面', url: '/reference-demos/mecha-side.webp' },
  { id: 'werewolf-front', label: '狼人·正面', url: '/reference-demos/werewolf-front.webp' },
  { id: 'swordsman-side', label: '剑士·侧面', url: '/reference-demos/swordsman-side.webp' },
  { id: 'angel-front', label: '天使·正面', url: '/reference-demos/angel-front.webp' },
  { id: 'mage-front', label: '法师·正面', url: '/reference-demos/mage-front.webp' },
  { id: 'archer-side', label: '弓箭手·侧面', url: '/reference-demos/archer-side.webp' },
  { id: 'dwarf-front', label: '矮人·正面', url: '/reference-demos/dwarf-front.webp' },
  { id: 'skeleton-front', label: '骷髅·正面', url: '/reference-demos/skeleton-front.webp' },
  { id: 'cat-side', label: '猫·侧面', url: '/reference-demos/cat-side.webp' },
  { id: 'dragon-side', label: '幼龙·侧面', url: '/reference-demos/dragon-side.webp' },
  { id: 'ninja-side', label: '忍者·侧面', url: '/reference-demos/ninja-side.webp' },
  { id: 'chibi-front', label: 'Q版勇者·正面', url: '/reference-demos/chibi-front.webp' },
  { id: 'orc-front', label: '兽人·正面', url: '/reference-demos/orc-front.webp' },
  { id: 'cyber-front', label: '赛博少女·正面', url: '/reference-demos/cyber-front.webp' },
];

// ============================================================
// SAM 点选图：滚轮缩放 + 拖动平移 + 单击点选，三者共存
//
// 缩放走 CSS transform（translate + scale、origin 左上），外层
// overflow-hidden 裁到原图框内。点选坐标仍按 img 的
// getBoundingClientRect 做 0–1 归一化——rect 返回的是变换后的
// 可视框，归一化比例在任何仿射变换下不变，所以缩放/平移后这套
// 换算天然成立，不需要手动逆变换。
// 点选与平移的区分不放在 click/contextmenu 里做（右键菜单事件的
// 触发时机跨平台不一致），统一收在 pointerup：按下到抬起的位移
// ≤ 阈值判点选（左键=保留 1、右键=抠除 0），超过判平移、不加点；
// contextmenu 只 preventDefault 压掉系统菜单，本身不加点。
// 滚轮用原生监听 + { passive: false } 拦截：React 的 onWheel 在
// 根节点是被动监听，preventDefault 无效，会连带滚外层面板。
// ============================================================

const SAM_VIEW_MIN_SCALE = 1;
const SAM_VIEW_MAX_SCALE = 8;
const SAM_PICK_DRAG_THRESHOLD = 4; // px：按下到抬起位移 ≤ 此值判点选，超过判平移

type SamView = { scale: number; x: number; y: number };

// 视角钳制：倍率夹在 [1, 8]，平移保证放大图始终盖满原图框（不露边）
function clampSamView(v: SamView, w: number, h: number): SamView {
  const scale = Math.min(SAM_VIEW_MAX_SCALE, Math.max(SAM_VIEW_MIN_SCALE, v.scale));
  return {
    scale,
    x: Math.min(0, Math.max(w * (1 - scale), v.x)),
    y: Math.min(0, Math.max(h * (1 - scale), v.y)),
  };
}

function SamPickImage({
  src,
  alt,
  frameClassName,
  view,
  onViewChange,
  onPick,
}: {
  src: string;
  alt: string;
  frameClassName: string;
  view: SamView;
  onViewChange: (v: SamView) => void;
  onPick: (x: number, y: number, label: 1 | 0) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [dragging, setDragging] = useState(false);
  // 原生监听与手势回调要读最新视角/回调，走 ref 防闭包过期
  const viewRef = useRef(view);
  viewRef.current = view;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const dragRef = useRef<{
    pointerId: number;
    button: number;
    startClientX: number;
    startClientY: number;
    startView: SamView;
    moved: boolean;
  } | null>(null);

  // 滚轮缩放：以光标为中心——光标压着的图上比例点在缩放前后不动
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const img = imgRef.current;
      if (!img) return;
      const w = img.offsetWidth;
      const h = img.offsetHeight;
      if (!w || !h) return;
      const rect = img.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      const v = viewRef.current;
      const scale = v.scale * Math.exp(-delta * 0.002);
      onViewChangeRef.current(
        clampSamView(
          {
            scale,
            x: v.x - fx * w * (scale - v.scale),
            y: v.y - fy * h * (scale - v.scale),
          },
          w,
          h,
        ),
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    dragRef.current = {
      pointerId: e.pointerId,
      button: e.button,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startView: viewRef.current,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) > SAM_PICK_DRAG_THRESHOLD) {
      drag.moved = true;
      if (drag.startView.scale > 1) setDragging(true);
    }
    if (drag.moved && drag.startView.scale > 1) {
      const img = imgRef.current;
      if (!img) return;
      const w = img.offsetWidth;
      const h = img.offsetHeight;
      if (!w || !h) return;
      onViewChange(
        clampSamView(
          { scale: drag.startView.scale, x: drag.startView.x + dx, y: drag.startView.y + dy },
          w,
          h,
        ),
      );
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (cancelled || drag.moved) return;
    // 未判平移 → 点选：坐标按变换后的可视 rect 归一化（变换下成立，见段头注）
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    onPick(x, y, drag.button === 2 ? 0 : 1);
  };

  return (
    <div
      ref={viewportRef}
      className={`relative touch-none select-none overflow-hidden rounded border ${frameClassName} ${dragging ? 'cursor-grabbing' : 'cursor-crosshair'}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => endPointer(e, false)}
      onPointerCancel={(e) => endPointer(e, true)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className="block w-full"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: '0 0',
        }}
      />
    </div>
  );
}

export default function RefAssemblyWizard({ onClose }: { onClose: () => void }) {
  // 恢复模板姿态快照（transform + tracks 整表写回）。
  // 对位拖动经操控管线写的是当前帧的姿态关键帧（node.tracks），不写 transform——
  // 早先只快照/恢复 transform 且把差值存进无人消费的 nodeOffsets，等于对位成果
  // 既存不进服装、又以关键帧形式污染模板轨道。现行口径：对位姿态只是抠图的
  // 取样条件，抠图时按节点世界角把精灵转正（见 MaskBrushOverlay），姿态本身
  // 不落盘；快照在选模板时拍下，关闭/完成/换模板时整表恢复，模板不留痕迹。
  const restoreTemplatePose = () => {
    const snap = persistedPoseSnapshot;
    if (!snap) return;
    persistedPoseSnapshot = null;
    const ps = useProjectStore.getState();
    snap.nodes.forEach((entry, nodeId) => {
      ps.updateUnifiedNode(snap.charKey, nodeId, {
        transform: structuredClone(entry.transform),
        tracks: structuredClone(entry.tracks),
      });
    });
    // 角色纬度与姿态同快照恢复（会话期间被切到目标纬度）
    ps.updateUnifiedCharacter(snap.charKey, { latitude: snap.latitude });
  };

  // 结束装配会话：discard 时按目标类型回滚——本会话新建的服装集整套删除；
  // 已有服装集不许删，pieces 还原为会话快照、生效集还原为会话前。
  // 两种情况都恢复模板姿态（含纬度）并清目标上下文；keep 时写入原样保留。
  const endAssemblySession = (discard: boolean) => {
    const ps = useProjectStore.getState();
    if (discard) {
      // 顺带指派回滚（指派是角色级的，新建/已有集都算）：必须在清目标上下文
      // 前读本会话写入记录——只回滚仍等于当时顺带值的指派，被别处改过的不动。
      // 不回滚会留窄口子：已有集 pieces 还原后，顺带指派还在、若该服装槽本有
      // 该变体的旧图就会真显示出来，放弃不等于没发生过。
      const ctx = useEditorStore.getState().refAssemblyTarget;
      if (ctx && ctx.writes.some((w) => w.autoAssignedVariant)) {
        const ch = ps.unifiedCharacters[ctx.characterId];
        if (ch) {
          const next = computeSlotVariantsAfterAssemblyDiscard(ch.slotVariants, ctx.writes);
          if (next !== ch.slotVariants) {
            ps.updateUnifiedCharacter(ctx.characterId, { slotVariants: next });
          }
        }
      }
    }
    const meta = persistedSessionMeta;
    if (meta) {
      if (discard) {
        if (meta.isNewCostumeSet) {
          ps.removeUnifiedCostumeSet(meta.charKey, meta.costumeSetId);
        } else if (persistedTargetSnapshot) {
          ps.updateUnifiedCostumeSet(meta.charKey, meta.costumeSetId, {
            pieces: structuredClone(persistedTargetSnapshot.pieces),
          });
          ps.updateUnifiedCharacter(meta.charKey, {
            activeCostumeSetId: persistedTargetSnapshot.prevActiveCostumeSetId,
          });
        }
      }
      persistedSessionMeta = null;
      persistedTargetSnapshot = null;
    }
    restoreTemplatePose();
    setWorkingCostumeIdState(null);
    useEditorStore.getState().setRefAssemblyTarget(null);
  };

  // 内部关闭：结束会话（取消时回滚目标），清参考图
  const handleClose = (keepCostume: boolean = false) => {
    endAssemblySession(!keepCostume);
    // 清参考图（否则第二次进入时残留旧 URL）
    const oldUrl = useEditorStore.getState().referenceImageUrl;
    if (oldUrl && oldUrl.startsWith('blob:')) {
      URL.revokeObjectURL(oldUrl);
    }
    useEditorStore.getState().setReferenceImageUrl(null);
    // 清色键（跨肢体共享，但不出向导）
    useEditorStore.getState().setChromaKeyColor(null);
    resetRefWizardStep();
    onClose();
  };

  // SAM 多点分割：左键 label=1（保留），右键 label=0（抠除）
  const handleSamClick = async (x: number, y: number, label: 1 | 0) => {
    const store = useEditorStore.getState();
    const newPoints = [...samPoints, { x, y, label }];
    setSamPoints(newPoints);
    try {
      if (referenceImageUrl !== samImageUrl) {
        const simg = new Image();
        if (referenceImageUrl && !referenceImageUrl.startsWith('data:') && !referenceImageUrl.startsWith('blob:')) {
          simg.crossOrigin = 'anonymous';
        }
        await new Promise((res, rej) => {
          simg.onload = res; simg.onerror = rej;
          simg.src = referenceImageUrl!;
        });
        await setSAMImage(simg);
        setSamImageUrl(referenceImageUrl);
      }
      const { segmentWithPoints } = await import('@/lib/sam');
      const result = await segmentWithPoints(newPoints);
      const { data: currentMask, shape: maskShape } = result;
      if (!referenceImageUrl) return;
      const img = new Image();
      if (!referenceImageUrl.startsWith('data:') && !referenceImageUrl.startsWith('blob:')) {
        img.crossOrigin = 'anonymous';
      }
      await new Promise((res, rej) => {
        img.onload = res; img.onerror = rej;
        img.src = referenceImageUrl;
      });
      if (!img.naturalWidth || !img.naturalHeight) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const [mh, mw] = maskShape;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const scale = 1024 / Math.max(iw, ih);
      const sw = iw * scale, sh = ih * scale;
      const padX = (1024 - sw) / 2, padY = (1024 - sh) / 2;
      for (let py = 0; py < canvas.height; py++) {
        for (let px = 0; px < canvas.width; px++) {
          const sx = px * scale + padX;
          const sy = py * scale + padY;
          const mx = Math.floor((sx / 1024) * mw);
          const my = Math.floor((sy / 1024) * mh);
          const inMask = mx >= 0 && mx < mw && my >= 0 && my < mh;
          const maskVal = inMask ? currentMask[my * mw + mx] : 0;
          const idx = (py * canvas.width + px) * 4;
          if (!(maskVal >= 0.5)) {
            // 抠除区：红色半透明叠加（能透见底下原图）
            const a = 0.45;
            imgData.data[idx] = Math.floor(imgData.data[idx] * (1 - a) + 255 * a);
            imgData.data[idx + 1] = Math.floor(imgData.data[idx + 1] * (1 - a) + 60 * a);
            imgData.data[idx + 2] = Math.floor(imgData.data[idx + 2] * (1 - a) + 60 * a);
            // alpha 保持原图
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
      setSamPreviewUrl(canvas.toDataURL('image/png'));
      // 经 setState 正规写入并通知订阅者——此前直接改 getState() 快照
      // 字段绕过 zustand set，订阅 samState 的组件不会重渲染
      useEditorStore.setState((s) => ({
        samState: { ...s.samState, currentMask, maskShape },
      }));
    } catch (err) {
      console.error('[SAM] 分割失败:', err);
    }
  };

  const [step, setStepState] = useState<Step>(persistedStep);
  const setStep = (s: Step) => {
    persistedStep = s;
    setStepState(s);
  };
  const [showAddLimb, setShowAddLimb] = useState(false);
  const [newLimbName, setNewLimbName] = useState('');
  const [newLimbParentId, setNewLimbParentId] = useState('');
  const [newLimbSocketId, setNewLimbSocketId] = useState('');
  const [newLimbPlugX, setNewLimbPlugX] = useState(0);
  const [newLimbPlugY, setNewLimbPlugY] = useState(0);
  // 已处理进度（按组合键，见文件头 persistedProcessedNodes）；模块级镜像防重挂丢标记
  const [processedNodes, setProcessedNodes] = useState<Map<string, ProcessedComboEntry>>(() => new Map(persistedProcessedNodes));
  useEffect(() => {
    persistedProcessedNodes = processedNodes;
  }, [processedNodes]);
  // ref 镜像：遮罩完成事件回调（依赖只有 sortedNodes）要读最新进度判「下一未处理」
  const processedNodesRef = useRef(processedNodes);
  processedNodesRef.current = processedNodes;
  // 会话目标上下文（确认步读本会话写入记录；写入发生时随之更新触发重渲染）
  const refAssemblyTarget = useEditorStore((s) => s.refAssemblyTarget);
  // 复制/镜像派生面板状态
  const [deriveSourceId, setDeriveSourceId] = useState<string | null>(null);
  const [deriveAxis, setDeriveAxis] = useState(90);
  const [deriveDarkenOn, setDeriveDarkenOn] = useState(false);
  const [deriveDarken, setDeriveDarken] = useState(0.7);
  // 旋转已抠精灵的角度
  const [rotExtractAngle, setRotExtractAngle] = useState(90);
  // 已抠精灵事后重开枢轴编辑（PivotEditor 弹窗，取打开时刻的最新精灵快照）
  const [pivotSprite, setPivotSprite] = useState<Sprite | null>(null);
  // AI 清理步的执行结果（界面反馈，替代原先只有 console.info 的做法）
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // SAM 状态
  const [samStatus, setSamStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [samPreviewUrl, setSamPreviewUrl] = useState<string | null>(null);
  const [samProgress, setSamProgress] = useState(0);
  const [samImageUrl, setSamImageUrl] = useState<string | null>(null);
  const [samPoints, setSamPoints] = useState<{ x: number; y: number; label: 1 | 0 }[]>([]);

  const referenceImageUrl = useEditorStore((s) => s.referenceImageUrl);
  const setReferenceImageUrl = useEditorStore((s) => s.setReferenceImageUrl);
  // 分割步缩放/平移视角（原图与预览图共用一份）；同步模块级持久化，理由同 step
  const [samView, setSamViewState] = useState<SamView>(persistedSamView);
  const setSamView = (v: SamView) => {
    persistedSamView = v;
    setSamViewState(v);
  };
  // 参考图换人（新上传、或用抠图结果回写）时视角复位：旧图的平移量对新图
  // 几何无意义。同一张图内切步离开再回来、原图↔预览交替、重选都不触发。
  const prevReferenceUrlRef = useRef(referenceImageUrl);
  useEffect(() => {
    if (prevReferenceUrlRef.current !== referenceImageUrl) {
      prevReferenceUrlRef.current = referenceImageUrl;
      setSamView({ scale: 1, x: 0, y: 0 });
    }
  }, [referenceImageUrl]);
  const referenceImageOpacity = useEditorStore((s) => s.referenceImageOpacity);
  const setReferenceImageOpacity = useEditorStore((s) => s.setReferenceImageOpacity);
  // 抠图目标：直接用画布全局当前选中的肢体
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useProjectStore((s) => s.setSelectedNodeId);
  const setZoom = useEditorStore((s) => s.setZoom);

  // 获取当前角色及其骨架节点（按 zIndex 排序，从后往前）
  const unifiedCharacters = useProjectStore((s) => s.unifiedCharacters) ?? {};
  const addUnifiedNode = useProjectStore((s) => s.addUnifiedNode);
  const [selectedCharacterId, setSelectedCharacterIdState] = useState<string | null>(persistedSelectedCharacterId);
  const setSelectedCharacterId = (id: string | null) => {
    persistedSelectedCharacterId = id;
    setSelectedCharacterIdState(id);
  };
  // 工作服装 ID（会话目标服装集；初值与变更都同步模块级持久化，防重挂重建）
  const [workingCostumeId, setWorkingCostumeIdState] = useState<string | null>(persistedWorkingCostumeId);
  useEffect(() => {
    persistedWorkingCostumeId = workingCostumeId;
  }, [workingCostumeId]);
  // 装配目标三选择（同款模块级持久化）：目标服装集（'new' 或已有集 id）、
  // 写入层变体、目标纬度。后两者是活选择，会话中改动不重启会话。
  const [targetCostumeChoice, setTargetCostumeChoiceState] = useState<string>(persistedTargetCostumeChoice);
  const setTargetCostumeChoice = (v: string) => {
    persistedTargetCostumeChoice = v;
    setTargetCostumeChoiceState(v);
  };
  const [targetVariantId, setTargetVariantIdState] = useState<string | null>(persistedTargetVariantId);
  const setTargetVariantId = (v: string | null) => {
    persistedTargetVariantId = v;
    setTargetVariantIdState(v);
  };
  const [targetLatitude, setTargetLatitudeState] = useState<number>(persistedTargetLatitude);
  const setTargetLatitude = (v: number) => {
    persistedTargetLatitude = v;
    setTargetLatitudeState(v);
  };
  // 模板姿态快照存模块级 persistedPoseSnapshot（选模板时拍下：
  // 每节点 transform + tracks 深拷贝 + 角色字典键），理由同文件头注释。

  // 向导直接使用选中的模板（不克隆）
  const effectiveCharacterId = selectedCharacterId;
  const selectedCharacter = Object.values(unifiedCharacters).find((c) => c.id === effectiveCharacterId) ?? null;
  // In new model, Character IS the skeleton (has nodes)
  const activeSkeleton = selectedCharacter;
  // Find dict key for setActivePuppetSkeletonId (keyed by skeletonId)
  const activeSkeletonKey = selectedCharacter
    ? Object.keys(unifiedCharacters).find((k) => unifiedCharacters[k]?.id === selectedCharacter.id) ?? null
    : null;
  // 同步到 editor store 供其他组件使用
  const setActivePuppetSkeletonId = useEditorStore((s) => s.setActivePuppetSkeletonId);
  useEffect(() => {
    setActivePuppetSkeletonId(activeSkeletonKey);
  }, [activeSkeletonKey, setActivePuppetSkeletonId]);
  const sortedNodes = activeSkeleton
    ? Object.values(activeSkeleton.nodes).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    : [];
  // 抠图目标节点：直接用画布全局选中的，不再用向导内部的 targetNodeIndex
  const targetNode = (activeSkeleton && selectedNodeId ? activeSkeleton.nodes[selectedNodeId] : null) ?? null;

  // 选中模板（或改目标服装集）：开装配会话——拍姿态快照、定目标服装集、
  // 直接进入对位。不需要"开始对位"按钮：选即开始，直接拖。
  // 不克隆：对位姿态只是抠图取样条件，快照在关闭/完成/换模板时整表恢复。
  // 目标为已有集时先对其 pieces 拍深快照，放弃/换目标时整表还原（不删集）。
  useEffect(() => {
    if (!selectedCharacterId) return;
    const ps = useProjectStore.getState();
    const charKey = Object.keys(ps.unifiedCharacters ?? {}).find((k) => ps.unifiedCharacters[k]?.id === selectedCharacterId);
    const sc = charKey ? ps.unifiedCharacters[charKey] : undefined;
    if (!sc || !charKey) return;
    const skeleton = sc;

    // 本次想要的目标集：'new' 恒为新建；选定的已有集已被删时回落新建
    const wantExisting =
      targetCostumeChoice !== 'new'
        ? sc.costumeSets.find((cs) => cs.id === targetCostumeChoice) ?? null
        : null;

    // 已有会话且（同角色 + 同目标集）→ 重挂恢复，跳过。
    // 显式选到会话新建的那套本身也算同目标，不重启。
    const meta = persistedSessionMeta;
    if (
      meta &&
      meta.charKey === charKey &&
      workingCostumeId === meta.costumeSetId &&
      (meta.costumeSetId === wantExisting?.id || (meta.isNewCostumeSet && !wantExisting))
    ) {
      return;
    }
    // 换角色 / 换目标集：先按丢弃语义结束旧会话（新建集删、已有集还原、姿态恢复）
    if (meta) endAssemblySession(true);

    // 拍姿态快照（transform + tracks + 角色纬度，深拷贝）
    persistedPoseSnapshot = {
      charKey,
      latitude: sc.latitude ?? 0,
      nodes: new Map(
        Object.values(skeleton.nodes).map((n) => [
          n.id,
          { transform: structuredClone(n.transform), tracks: structuredClone(n.tracks) },
        ]),
      ),
    };

    // 定目标服装集：已有集先拍 pieces 快照；新建沿用现行「X（装配）」
    let targetId: string;
    let isNewCostumeSet = false;
    if (wantExisting) {
      targetId = wantExisting.id;
      persistedTargetSnapshot = {
        charKey,
        costumeSetId: targetId,
        pieces: structuredClone(wantExisting.pieces),
        prevActiveCostumeSetId: sc.activeCostumeSetId,
      };
    } else {
      const costume = ps.addUnifiedCostumeSet(charKey, `${sc.name}（装配）`);
      targetId = costume.id;
      isNewCostumeSet = true;
      persistedTargetSnapshot = null;
    }
    persistedSessionMeta = { charKey, costumeSetId: targetId, isNewCostumeSet };
    setWorkingCostumeIdState(targetId);
    // 目标集设为生效集（写侧落点口径），角色纬度切到目标纬度（所见即所写层）
    ps.updateUnifiedCharacter(charKey, {
      activeCostumeSetId: targetId,
      ...(targetLatitude !== (sc.latitude ?? 0) ? { latitude: targetLatitude } : {}),
    });
    // 写入目标上下文（MaskBrushOverlay 完成时读；含空的写入记录）
    useEditorStore.getState().setRefAssemblyTarget({
      characterId: charKey,
      costumeSetId: targetId,
      isNewCostumeSet,
      variantId: targetVariantId,
      latitude: targetLatitude,
      writes: [],
    });
    // 进入操控（画布只显示该角色）
    usePuppetSessionStore.getState().enterPerform(selectedCharacterId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCharacterId, targetCostumeChoice]);

  // 写入层 / 目标纬度是活选择：会话中变更只改上下文与角色纬度，不重启会话、
  // 不丢已抠成果；会话结束时角色纬度随姿态快照恢复到会话前。
  useEffect(() => {
    const meta = persistedSessionMeta;
    if (!meta) return;
    const es = useEditorStore.getState();
    const ctx = es.refAssemblyTarget;
    if (ctx && (ctx.variantId !== targetVariantId || ctx.latitude !== targetLatitude)) {
      es.setRefAssemblyTarget({ ...ctx, variantId: targetVariantId, latitude: targetLatitude });
    }
    const ps = useProjectStore.getState();
    const ch = ps.unifiedCharacters[meta.charKey];
    if (ch && (ch.latitude ?? 0) !== targetLatitude) {
      ps.updateUnifiedCharacter(meta.charKey, { latitude: targetLatitude });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetVariantId, targetLatitude]);

  // 监听遮罩完成事件，按组合更新进度、记入会话写入记录，并自动推进到
  // 下一个在当前组合下未处理的肢体。组合从最新 store 读（方向 = 写入时刻
  // 角色根方向，与遮罩写侧落格口径一致；层/纬度 = 目标上下文）。
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { nodeId?: string; autoAssignedVariant?: boolean }
        | undefined;
      const nodeId = detail?.nodeId;
      if (nodeId) {
        const es = useEditorStore.getState();
        const ctx = es.refAssemblyTarget;
        const meta = persistedSessionMeta;
        const chNow = meta ? useProjectStore.getState().unifiedCharacters[meta.charKey] : undefined;
        const combo: RefAssemblyCombo = {
          direction: (chNow?.nodes[chNow.rootNodeId]?.transform.variantIndex ?? 6) as DirectionIndex,
          latitude: ctx?.latitude ?? persistedTargetLatitude,
          variantId:
            (ctx?.latitude ?? persistedTargetLatitude) !== 0
              ? null
              : (ctx?.variantId ?? persistedTargetVariantId),
        };
        const comboKey = refAssemblyComboKey(nodeId, combo);
        const nextMap = new Map(processedNodesRef.current).set(comboKey, {
          nodeId,
          method: 'mask',
          ...combo,
        });
        setProcessedNodes(nextMap);
        // 记入会话写入记录（节点 × 组合，含顺带指派标记），供确认步展示
        if (ctx) {
          const ch = useProjectStore.getState().unifiedCharacters[ctx.characterId];
          const node = ch?.nodes[nodeId];
          es.setRefAssemblyTarget({
            ...ctx,
            writes: [
              ...ctx.writes,
              {
                nodeId,
                slotKey: node?.slot?.slotKey ?? nodeId,
                direction: combo.direction,
                variantId: combo.variantId,
                latitude: combo.latitude,
                autoAssignedVariant: !!detail?.autoAssignedVariant,
              },
            ],
          });
        }
        // 自动推进到下一个未处理的肢体（「未处理」按当前组合判；更新画布全局选中）
        const idx = sortedNodes.findIndex((n) => n.id === nodeId);
        for (let i = idx + 1; i < sortedNodes.length; i++) {
          if (!nextMap.has(refAssemblyComboKey(sortedNodes[i].id, combo))) {
            setSelectedNodeId(sortedNodes[i].id);
            break;
          }
        }
      }
    };
    window.addEventListener('ref-assembly:mask-done', handler);
    return () => window.removeEventListener('ref-assembly:mask-done', handler);
  }, [sortedNodes]);


  const handleAddLimb = () => {
    if (!activeSkeleton || !newLimbName.trim()) return;
    // 父节点有槽位时必须选槽位：不选则 attachment 落成 fixed、节点挂到根下，
    // 与用户选的父节点毫无关系（addUnifiedNode 按 attachment 推导父级写全挂接）。
    // 父节点无槽位时走 ensureChildAttachment 自动新建槽位，不再退成同位 fixed。
    if (parentNodeForSocket && parentNodeForSocket.sockets.length > 0 && !newLimbSocketId) return;
    const attachment = newLimbSocketId
      ? { type: 'socket' as const, parentSocketId: newLimbSocketId, plug: { x: newLimbPlugX, y: newLimbPlugY } }
      : parentNodeForSocket
        ? ensureChildAttachment(activeSkeletonKey!, parentNodeForSocket, newLimbName.trim())
        : { type: 'fixed' as const, fixedOffset: { x: 0, y: 0 }, inheritRotation: true };
    // addUnifiedNode 返回新节点，直接选中——旧实现 setTimeout 后读渲染闭包里
    // 的旧角色快照（根本没有新节点），选中的恒是添加前的末位节点
    const newNode = addUnifiedNode(activeSkeletonKey!, newLimbName.trim(), {
      attachment,
      // 父级显式给：父节点无槽位时 attachment 是 fixed、推导不出父级，
      // 不给就会挂到根下，与所选父节点无关（同上方强制选槽位的注释）
      parentId: newLimbParentId || undefined,
      zIndex: (targetNode?.zIndex ?? 0) + 1,
    });
    setNewLimbName('');
    setNewLimbParentId('');
    setNewLimbSocketId('');
    setNewLimbPlugX(0);
    setNewLimbPlugY(0);
    setShowAddLimb(false);
    setSelectedNodeId(newNode.id);
  };

  // 某节点在任一组合下处理过（组合键以 `${nodeId}|` 起头）
  const hasAnyProcessedCombo = (nodeId: string) =>
    [...processedNodes.keys()].some((k) => k.startsWith(`${nodeId}|`));

  // 找镜像源：按名称匹配 left/right/L/R
  const findMirrorSource = (node: { id: string; name: string }): string | null => {
    const name = node.name.toLowerCase();
    let mirrorName: string | null = null;
    if (name.includes('left')) mirrorName = node.name.replace(/left/i, 'right');
    else if (name.includes('right')) mirrorName = node.name.replace(/right/i, 'left');
    else if (name.includes('_l')) mirrorName = node.name.replace(/_l/i, '_r');
    else if (name.includes('_r')) mirrorName = node.name.replace(/_r/i, '_l');
    // 中文：左/右
    else if (node.name.includes('左')) mirrorName = node.name.replace('左', '右');
    else if (node.name.includes('右')) mirrorName = node.name.replace('右', '左');
    if (!mirrorName) return null;
    const src = sortedNodes.find((n) => n.name.toLowerCase() === mirrorName!.toLowerCase());
    // 源节点必须已有精灵（已遮罩或模板自带）
    if (src && ((src as any).sprite || src.slot || hasAnyProcessedCombo(src.id))) return src.id;
    return null;
  };

  // ---- 抠图方向与精灵解析（与 MaskBrushOverlay 同口径：根节点 variantIndex，缺省南 6） ----
  const wizardDirIndex = (selectedCharacter?.nodes[selectedCharacter.rootNodeId]?.transform.variantIndex ?? 6) as DirectionIndex;
  // ---- 参考图分槽：当前槽 = 当前目标方向 × 当前目标纬度 ----
  const currentRefSlotKey = refImageSlotKey(wizardDirIndex, targetLatitude);
  // 切方向/纬度（含向导外改向，如操控面板切方向）时换图：离开旧槽前先把
  // 当前显示图归档回旧槽（吸收向导外的换图，如比例垫图），再把当前图换成
  // 新槽的图（槽空则清空，等用户回步 1 给该槽选图）。首次归属（重挂、或
  // 向导打开前已设了参考图）只收编进当前槽、不清空。
  useEffect(() => {
    const prevKey = persistedRefImageSlotKey;
    if (prevKey === currentRefSlotKey) return;
    const es = useEditorStore.getState();
    if (prevKey === null) {
      persistedRefImageSlotKey = currentRefSlotKey;
      const cur = es.referenceImageUrl;
      if (cur && !persistedRefImageSlots.has(currentRefSlotKey)) {
        persistedRefImageSlots.set(currentRefSlotKey, cur);
      }
      return;
    }
    const cur = es.referenceImageUrl;
    if (cur) persistedRefImageSlots.set(prevKey, cur);
    else persistedRefImageSlots.delete(prevKey);
    persistedRefImageSlotKey = currentRefSlotKey;
    es.setReferenceImageUrl(persistedRefImageSlots.get(currentRefSlotKey) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRefSlotKey]);
  // 服装槽总览的行：已有图的纬度 + 当前纬度（当前槽所在行恒显示，其余空行不铺）
  const refSlotRows = (() => {
    const lats = new Set<number>();
    for (const key of persistedRefImageSlots.keys()) lats.add(Number(key.split('|')[1]));
    lats.add(targetLatitude);
    return [...lats].sort((a, b) => a - b);
  })();
  // 步 1 选图 / SAM 产出：写进当前槽并显示
  const setRefImageForCurrentSlot = (url: string | null) => {
    if (url) persistedRefImageSlots.set(currentRefSlotKey, url);
    else persistedRefImageSlots.delete(currentRefSlotKey);
    persistedRefImageSlotKey = currentRefSlotKey;
    setReferenceImageUrl(url);
  };
  const workingCostume = selectedCharacter?.costumeSets.find((cs) => cs.id === workingCostumeId) ?? null;
  // 节点在目标服装集的目标层（优先）或模板服装槽同层中的精灵 ID
  // （SpriteRef 才可解析，与 DressPanel 同口径；读侧认当前写入层，
  // 进度与派生源看到的都是正在写的那一层的状态）
  const resolveNodeSpriteId = (node: (typeof sortedNodes)[number]): string | null => {
    const key = node.slot?.slotKey ?? node.id;
    const pickFromPiece = (piece: CostumePiece | undefined): string | null => {
      if (!piece) return null;
      const table =
        targetLatitude !== 0
          ? piece.latitudeSprites?.[targetLatitude]
          : targetVariantId
            ? piece.variantSprites?.[targetVariantId]
            : piece.sprites;
      const ref = table?.[wizardDirIndex];
      return ref && 'spriteId' in ref ? ref.spriteId : null;
    };
    return pickFromPiece(workingCostume?.pieces[key]) ?? pickFromPiece(node.slot ?? undefined);
  };
  const targetSpriteId = targetNode ? resolveNodeSpriteId(targetNode) : null;
  // 当前组合（方向 × 纬度 × 写入层）：进度键、覆盖门、参考图槽都以它为准
  const currentCombo: RefAssemblyCombo = {
    direction: wizardDirIndex,
    latitude: targetLatitude,
    variantId: targetLatitude !== 0 ? null : targetVariantId,
  };
  const variantNameOf = (id: string) =>
    selectedCharacter?.variantDefs?.find((v) => v.id === id)?.name;
  // ---- 覆盖门：目标格已有精灵时，写入发起前必须先确认（消灭静默覆盖） ----
  // 查的格与写侧落格严格同口径：工作服装该件的目标层同格（readPieceLayerSpriteId
  // 是 applySpriteToPieceLayer 的读侧孪生）。模板服装槽同层有图不算占用——
  // 写侧从不写模板服装槽。
  const targetCellOccupied = (node: (typeof sortedNodes)[number]): boolean => {
    if (!workingCostume) return false;
    const piece = workingCostume.pieces[node.slot?.slotKey ?? node.id];
    if (!piece) return false;
    return (
      readPieceLayerSpriteId(piece, wizardDirIndex, {
        variantId: targetVariantId,
        latitude: targetLatitude,
      }) !== null
    );
  };
  const confirmOverwriteIfOccupied = (node: (typeof sortedNodes)[number]): boolean => {
    if (!targetCellOccupied(node)) return true;
    return confirm(
      `「${node.name}」在 ${refAssemblyComboLabel(currentCombo, variantNameOf)} 已有精灵，继续将覆盖它，确定继续？`,
    );
  };
  // 节点在当前组合的进度条目 + 在其它组合处理过的数量（抠图步标记用）
  const comboProgressOf = (nodeId: string) => {
    const cur = processedNodes.get(refAssemblyComboKey(nodeId, currentCombo));
    const total = [...processedNodes.values()].filter((en) => en.nodeId === nodeId).length;
    return { cur, otherCount: total - (cur ? 1 : 0) };
  };
  const deriveCandidates = sortedNodes.filter((n) => n.id !== targetNode?.id && resolveNodeSpriteId(n));

  // 目标节点变化时，派生源默认预选名称镜像匹配，其次第一个可用源
  useEffect(() => {
    if (!targetNode) {
      setDeriveSourceId(null);
      return;
    }
    setDeriveSourceId(findMirrorSource(targetNode) ?? deriveCandidates[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetNode?.id]);

  // 复制/镜像生成（烘焙式）：生成新精灵并写入工作服装的目标节点服装槽
  const handleDerive = (mode: 'copy' | 'mirror') => {
    if (!targetNode || !deriveSourceId || !selectedCharacterId || !workingCostumeId) return;
    const srcNode = sortedNodes.find((n) => n.id === deriveSourceId);
    if (!srcNode) return;
    const srcSpriteId = resolveNodeSpriteId(srcNode);
    if (!srcSpriteId) return;
    // 覆盖门：目标格已有精灵时先确认，取消则不派生、不写入
    if (!confirmOverwriteIfOccupied(targetNode)) return;
    const ps = useProjectStore.getState();
    const derived = ps.deriveSpriteFrom(srcSpriteId, {
      mode,
      axisDeg: deriveAxis,
      darken: deriveDarkenOn ? deriveDarken : 1,
      name: `${mode === 'mirror' ? '镜像' : '复制'}_${targetNode.name}`,
    });
    if (!derived?.id) return;
    // 与遮罩写同一目标层（基础/变体/纬度），并记入会话写入记录
    const res = ps.setUnifiedCostumeSpriteLayered(
      selectedCharacterId,
      workingCostumeId,
      targetNode.id,
      wizardDirIndex,
      derived.id,
      { variantId: targetVariantId, latitude: targetLatitude },
    );
    const es = useEditorStore.getState();
    const ctx = es.refAssemblyTarget;
    if (ctx) {
      es.setRefAssemblyTarget({
        ...ctx,
        writes: [
          ...ctx.writes,
          {
            nodeId: targetNode.id,
            slotKey: targetNode.slot?.slotKey ?? targetNode.id,
            direction: wizardDirIndex,
            variantId: targetLatitude !== 0 ? null : targetVariantId,
            latitude: targetLatitude,
            autoAssignedVariant: res.autoAssignedVariant,
          },
        ],
      });
    }
    setProcessedNodes((m) =>
      new Map(m).set(refAssemblyComboKey(targetNode.id, currentCombo), {
        nodeId: targetNode.id,
        method: mode,
        ...currentCombo,
      }),
    );
  };

  // 旋转已抠精灵（绕锚点）：抠图时已按对位姿态转正，此处是事后手动再转，
  // 直接改精灵本体即可——不再有 nodeOffsets 反调（该通道已随对位落盘一并退役）
  const handleRotateExtracted = (theta: number) => {
    if (!targetNode || !targetSpriteId) return;
    useProjectStore.getState().transformSprite(targetSpriteId, { kind: 'rotate', angleDeg: theta });
  };

  // 父节点变化时，重置 socket 选择
  const handleParentChange = (parentId: string) => {
    setNewLimbParentId(parentId);
    setNewLimbSocketId('');
  };
  const parentNodeForSocket = sortedNodes.find((n) => n.id === newLimbParentId);

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 清空 input，下次选同一文件也能触发 onChange
    e.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    setRefImageForCurrentSlot(url);
    // 确保可见（上次关闭时被隐藏了）
    useEditorStore.getState().setReferenceImageVisible(true);
    setStep('sam');
  };

  // 抠图步目标节点的组合进度（当前组合条目 + 在其它组合处理过的数量）
  const targetProgress = targetNode
    ? comboProgressOf(targetNode.id)
    : { cur: undefined as ProcessedComboEntry | undefined, otherCount: 0 };

  return (
    <div className="flex flex-col h-full bg-[#1a1a2e] border-b border-white/10">
      <div className="p-3 border-b border-white/10">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-200">参考图装配</h2>
          <button
            onClick={() => {
              // X = 放弃装配：目标为新建集时整套删除；为已有集时还原到会话
              // 快照（不删集）。有成果时先确认防误点，文案按目标类型分开。
              const toExisting = persistedSessionMeta && !persistedSessionMeta.isNewCostumeSet;
              if (
                processedNodes.size > 0 &&
                !confirm(
                  toExisting
                    ? '关闭将把目标服装集还原到本次装配开始时的状态（本次写入会回滚），确定关闭？'
                    : '关闭将删除本次装配的工作服装（含已抠出的精灵），确定关闭？',
                )
              )
                return;
              handleClose(false);
            }}
            className="text-gray-500 hover:text-gray-300"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Steps */}
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.id}>
              <div
                className={`flex-1 text-center text-xs py-1.5 rounded ${
                  i === stepIndex
                    ? 'bg-purple-600/40 text-purple-200'
                    : i < stepIndex
                    ? 'bg-white/5 text-gray-400'
                    : 'text-gray-600'
                }`}
              >
                {s.label}
              </div>
              {i < STEPS.length - 1 && <div className="text-gray-600 text-xs">›</div>}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Step content - scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {step === 'upload' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">选一张内置参考图，或导入自己的立绘作为抠图底图。</p>
            {/* 参考图按（方向 × 纬度）分槽：此处选的图只进当前槽；切方向/纬度后回到本步为新槽选图，已选的图按槽保留 */}
            <div className="space-y-1.5">
              <div className="text-[11px] text-gray-500">
                当前槽：{DIRECTION_NAMES[wizardDirIndex]} · {targetLatitude === 0 ? '基础纬度' : `纬度 ${targetLatitude}°`}（参考图按方向 × 纬度分槽）
              </div>
              {refSlotRows.map((lat) => (
                <div key={lat} className="flex items-center gap-1">
                  <span className="text-[9px] text-gray-500 w-11 shrink-0">
                    {lat === 0 ? '基础纬度' : `纬度 ${lat}°`}
                  </span>
                  <div className="grid grid-cols-8 gap-1 flex-1">
                    {DIRECTION_DISPLAY_ORDER.map((dir) => {
                      const key = refImageSlotKey(dir, lat);
                      const has = persistedRefImageSlots.has(key);
                      const isCurrent = key === currentRefSlotKey;
                      return (
                        <div
                          key={dir}
                          title={`${DIRECTION_NAMES[dir]}${has ? '（已有图）' : '（无图）'}${isCurrent ? ' · 当前槽' : ''}`}
                          className={`text-center text-[9px] py-0.5 rounded border ${
                            isCurrent
                              ? 'border-cyan-400 text-cyan-200'
                              : 'border-transparent'
                          } ${has ? 'bg-purple-600/40 text-purple-100' : 'bg-white/5 text-gray-600'}`}
                        >
                          {DIRECTION_NAMES[dir]}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {/* 内置图库 */}
            <div className="grid grid-cols-4 gap-2">
              {BUILT_IN_REFS.map((ref) => (
                <button
                  key={ref.id}
                  onClick={() => {
                    setRefImageForCurrentSlot(ref.url);
                    useEditorStore.getState().setReferenceImageVisible(true);
                    setStep('sam');
                  }}
                  className="group relative aspect-square rounded overflow-hidden border border-white/10 hover:border-purple-500/50 transition-colors"
                  title={ref.label}
                >
                  <img src={ref.url} alt={ref.label} className="w-full h-full object-cover" style={{ imageRendering: 'pixelated' }} />
                  <div className="absolute bottom-0 inset-x-0 text-[9px] text-center py-0.5 bg-black/60 text-gray-300">
                    {ref.label}
                  </div>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-[10px] text-gray-500">或</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            <Button onClick={() => fileRef.current?.click()} variant="outline" className="w-full">
              <Upload className="size-3.5 mr-2" /> 导入自己的图片
            </Button>
          </div>
        )}

        {step === 'sam' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              可选：用 SAM 点选角色、抠除背景，生成一张干净底图，后续对位与逐肢体手绘遮罩更省事。分割结果是整图级的，不直接生成各肢体精灵。
            </p>
            {samStatus === 'idle' && (
              <Button
                size="sm" variant="outline" className="w-full"
                onClick={async () => {
                  setSamStatus('loading');
                  try {
                    await initSAM('mobilesam', (_s, p) => setSamProgress(p));
                    // 设置参考图
                    if (referenceImageUrl) {
                      const img = new Image();
                      img.crossOrigin = 'anonymous';
                      await new Promise((res, rej) => {
                        img.onload = res; img.onerror = rej;
                        img.src = referenceImageUrl;
                      });
                      await setSAMImage(img);
                      setSamImageUrl(referenceImageUrl);
                    }
                    setSamStatus('ready');
                  } catch {
                    setSamStatus('error');
                  }
                }}
              >
                初始化 SAM（首次下载模型 ~45MB）
              </Button>
            )}
            {samStatus === 'loading' && (
              <div className="text-xs text-gray-400">加载模型中… {Math.round(samProgress)}%</div>
            )}
            {samStatus === 'error' && (
              <div className="space-y-2">
                <div className="text-xs text-red-400">SAM 初始化失败，可跳过此步骤</div>
                <Button size="sm" variant="outline" className="w-full" onClick={() => setSamStatus('idle')}>
                  重试初始化
                </Button>
              </div>
            )}
            {samStatus === 'ready' && (
              <div className="space-y-2">
                <div className="text-xs text-green-400">SAM 就绪。左键点选要保留的，右键点选要抠掉的，预览确认后应用。</div>
                {(referenceImageUrl || samPreviewUrl) && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-500">滚轮缩放 · 按住拖动平移 · 单击加点（拖动不误加）</span>
                    <span className="ml-auto text-[11px] text-gray-400">{samView.scale.toFixed(1)}×</span>
                    <Button
                      size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                      disabled={samView.scale === 1 && samView.x === 0 && samView.y === 0}
                      onClick={() => setSamView({ scale: 1, x: 0, y: 0 })}
                    >
                      复位
                    </Button>
                  </div>
                )}
                {referenceImageUrl && !samPreviewUrl && (
                  <SamPickImage
                    src={referenceImageUrl}
                    alt="参考图"
                    frameClassName="border-white/10"
                    view={samView}
                    onViewChange={setSamView}
                    onPick={(x, y, label) => { void handleSamClick(x, y, label); }}
                  />
                )}
                {samPreviewUrl && (
                  <div className="space-y-2">
                    <div className="text-xs text-gray-400">预览效果（红色为将抠除，可继续左右键加点修正）：</div>
                    <SamPickImage
                      src={samPreviewUrl}
                      alt="抠图预览"
                      frameClassName="border-green-500/30"
                      view={samView}
                      onViewChange={setSamView}
                      onPick={(x, y, label) => { void handleSamClick(x, y, label); }}
                    />
                    <div className="text-xs text-gray-500">左键{ samPoints.filter(p => p.label === 1).length }点保留 · 右键{ samPoints.filter(p => p.label === 0).length }点抠除</div>
                    <div className="flex gap-2">
                      <Button
                        size="sm" className="flex-1"
                        onClick={async () => {
                          // 用存的 mask 生成干净抠图（透明背景，无红色覆盖）
                          const store = useEditorStore.getState();
                          const { currentMask, maskShape } = store.samState;
                          if (!currentMask || !maskShape || !referenceImageUrl) return;
                          const img = new Image();
                          if (!referenceImageUrl.startsWith('data:') && !referenceImageUrl.startsWith('blob:')) {
                            img.crossOrigin = 'anonymous';
                          }
                          await new Promise((res, rej) => {
                            img.onload = res; img.onerror = rej;
                            img.src = referenceImageUrl;
                          });
                          const canvas = document.createElement('canvas');
                          canvas.width = img.naturalWidth;
                          canvas.height = img.naturalHeight;
                          const ctx = canvas.getContext('2d')!;
                          ctx.drawImage(img, 0, 0);
                          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                          const [mh, mw] = maskShape;
                          const iw = img.naturalWidth, ih = img.naturalHeight;
                          const scale = 1024 / Math.max(iw, ih);
                          const padX = (1024 - iw * scale) / 2, padY = (1024 - ih * scale) / 2;
                          for (let py = 0; py < canvas.height; py++) {
                            for (let px = 0; px < canvas.width; px++) {
                              const mx = Math.floor(((px * scale + padX) / 1024) * mw);
                              const my = Math.floor(((py * scale + padY) / 1024) * mh);
                              const inMask = mx >= 0 && mx < mw && my >= 0 && my < mh;
                              if (!(inMask && currentMask[my * mw + mx] >= 0.5)) {
                                imgData.data[(py * canvas.width + px) * 4 + 3] = 0;
                              }
                            }
                          }
                          ctx.putImageData(imgData, 0, 0);
                          // SAM 产出回写当前槽（与回写 referenceImageUrl 同点多写一层槽表）
                          setRefImageForCurrentSlot(canvas.toDataURL('image/png'));
                          store.clearSAMMask();
                          setSamPreviewUrl(null);
                          setSamPoints([]);
                        }}
                      >
                        应用到主画布
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => {
                          setSamPreviewUrl(null);
                          setSamPoints([]);
                          useEditorStore.getState().clearSAMMask();
                        }}
                      >
                        重选
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <Button
              size="sm" variant="ghost" className="w-full text-[11px]"
              onClick={() => {
                const idx = STEPS.findIndex((s) => s.id === 'sam');
                if (idx >= 0) setStep(STEPS[idx + 1].id);
              }}
            >
              跳过 <ArrowRight className="size-3.5 ml-1" />
            </Button>
          </div>
        )}

        {step === 'align' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">选择模板角色</label>
              <select
                value={selectedCharacterId ?? ''}
                onChange={(e) => {
                  const nextId = e.target.value || null;
                  if (nextId !== selectedCharacterId) {
                    // 换模板角色：参考图槽是给上一个角色准备的，整表清空
                    //（连正显示的一张一并回收），当前图随之清空待为新槽选图
                    clearRefImageSlots(true);
                    setReferenceImageUrl(null);
                  }
                  setSelectedCharacterId(nextId);
                  setProcessedNodes(new Map());
                }}
                className="w-full h-8 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
              >
                <option value="">— 选择角色 —</option>
                {Object.values(unifiedCharacters).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {/* 目标服装集：缺省新建一套（装配）；可选已有集——会话开始对该
                集 pieces 拍快照，放弃时整表还原（不删集），完成时保留写入 */}
            <div>
              <label className="text-xs text-gray-500 block mb-1">目标服装</label>
              <select
                value={targetCostumeChoice}
                onChange={(e) => {
                  setTargetCostumeChoice(e.target.value);
                  setProcessedNodes(new Map());
                }}
                disabled={!selectedCharacter}
                className="w-full h-8 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
              >
                <option value="new">新建一套（装配）</option>
                {selectedCharacter?.costumeSets.map((cs) => (
                  <option key={cs.id} value={cs.id}>
                    {cs.name}
                  </option>
                ))}
              </select>
              {targetCostumeChoice !== 'new' && (
                <p className="text-[10px] text-gray-500 mt-1">
                  写入已有服装集；放弃装配时该集会还原到本次装配开始时的状态（集本身不删）。
                </p>
              )}
            </div>
            {activeSkeleton && selectedCharacter ? (
              <>
                <p className="text-xs text-gray-400">
                  模板角色「{selectedCharacter.name}」已覆盖在底图上，
                  直接在画布上拖动角色肢体（拖动旋转，Shift+拖动平移）对准底图。
                </p>
                {/* 方向选择：直接读写角色当前方向（根节点 variantIndex），
                    遮罩保存时按同一口径落进该方向的精灵服装槽 */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">对位方向（遮罩将应用于此方向）</label>
                  <select
                    value={wizardDirIndex}
                    onChange={(e) => {
                      if (!selectedCharacterId) return;
                      useProjectStore.getState().setUnifiedDirection(
                        selectedCharacterId,
                        Number(e.target.value) as DirectionIndex,
                      );
                    }}
                    className="w-full h-8 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
                  >
                    <option value={6}>南 (S) - 正面</option>
                    <option value={2}>北 (N) - 背面</option>
                    <option value={0}>东 (E) - 右侧</option>
                    <option value={4}>西 (W) - 左侧</option>
                    <option value={1}>东北 (NE)</option>
                    <option value={7}>东南 (SE)</option>
                    <option value={5}>西南 (SW)</option>
                    <option value={3}>西北 (NW)</option>
                  </select>
                  {!persistedRefImageSlots.has(currentRefSlotKey) && (
                    <p className="text-[10px] text-amber-500 mt-1">
                      当前方向 × 纬度尚无底图，回「底图」步为该槽选图（已选过的图按槽保留，切回原方向即可见）。
                    </p>
                  )}
                </div>
                <p className="text-[11px] text-gray-400">
                  装配目标服装「{workingCostume?.name ?? '—'}」，直接在画布上拖动肢体对位（拖动旋转，Shift+拖动平移）。对位姿态只是抠图的取样条件：抠图时精灵按对位角度自动转正、锚点落在关节上；离开向导后模板姿态自动恢复，不留痕迹。
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">底图不透明度</span>
                  <Slider
                    className="flex-1"
                    value={[referenceImageOpacity]}
                    min={0.1}
                    max={1}
                    step={0.05}
                    onValueChange={([v]) => setReferenceImageOpacity(v)}
                  />
                  <span className="text-xs text-gray-400 w-10 text-right">
                    {Math.round(referenceImageOpacity * 100)}%
                  </span>
                </div>
              </>
            ) : (
              <div className="text-xs text-amber-500">
                请先选择一个模板角色。如果没有，去木偶资产面板点 + 创建。
              </div>
            )}
          </div>
        )}

        {step === 'mask' && (
          <div className="space-y-3">
            {/* 写入目标（活选择）：层与纬度会话中可改，立即作用于后续的
                遮罩提取与派生写入；解析层序为纬度层整套优先于变体层 */}
            <div className="p-2 rounded bg-white/5 border border-white/10 space-y-2">
              <div className="text-[10px] text-gray-500">
                写入目标服装：{workingCostume?.name ?? '—'}
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">写入层</label>
                <select
                  value={targetVariantId ?? ''}
                  disabled={targetLatitude !== 0}
                  onChange={(e) => setTargetVariantId(e.target.value || null)}
                  className="w-full h-7 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200 disabled:opacity-50"
                >
                  <option value="">基础层</option>
                  {(selectedCharacter?.variantDefs ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">目标纬度</label>
                <select
                  value={targetLatitude}
                  onChange={(e) => setTargetLatitude(Number(e.target.value))}
                  className="w-full h-7 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
                >
                  <option value={0}>基础纬度（0°）</option>
                  <option value={45}>45°</option>
                  <option value={90}>90°</option>
                  <option value={-45}>−45°</option>
                  <option value={-90}>−90°</option>
                </select>
              </div>
              {targetLatitude !== 0 ? (
                <p className="text-[10px] text-amber-500">
                  纬度层优先于变体层（与解析口径一致）：当前写入只落纬度 {targetLatitude}° 层，写入层选择不生效。角色预览纬度已切到 {targetLatitude}°，离开向导后恢复。
                </p>
              ) : targetVariantId ? (
                <p className="text-[10px] text-gray-500">
                  写入变体层；被写服装槽原先没有任何变体指派时会自动指派为该变体（已有指派不覆盖）。
                </p>
              ) : null}
            </div>
            <p className="text-xs text-gray-400">
              目标肢体（画布上点选）：{targetNode?.name ?? '未选中'}
              {targetNode && (
                <span className="ml-2 text-[10px] text-gray-500">
                  z:{targetNode.zIndex ?? 0}
                </span>
              )}
            </p>
            {/* 节点管理：删除（走 node-actions 的级联删除：摘父 children、整子树
                一并删、清选中——旧实现只删单个节点却在文案里承诺连子节点，
                且被删节点的子节点会成孤儿留在字典里） */}
            {targetNode && activeSkeleton && targetNode.id !== activeSkeleton.rootNodeId && (
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 text-[10px] h-6 text-red-400 hover:text-red-300"
                  onClick={() => {
                    const subtreeIds = collectSubtreeIds(activeSkeleton.nodes, targetNode.id);
                    if (!deleteNodeSubtree(activeSkeletonKey!, targetNode.id)) return;
                    setProcessedNodes((m) => {
                      const next = new Map(m);
                      for (const key of [...next.keys()]) {
                        if (subtreeIds.some((id) => key.startsWith(`${id}|`))) next.delete(key);
                      }
                      return next;
                    });
                  }}
                >
                  删除节点
                </Button>
              </div>
            )}
            {/* 添加临时肢体 */}
            {!showAddLimb ? (
              <Button
                size="sm"
                variant="ghost"
                className="w-full text-[11px] text-cyan-400"
                onClick={() => setShowAddLimb(true)}
              >
                + 添加肢体/道具（如耳朵、尾巴、武器）
              </Button>
            ) : (
              <div className="p-2 rounded bg-white/5 border border-white/10 space-y-2">
                <input
                  value={newLimbName}
                  onChange={(e) => setNewLimbName(e.target.value)}
                  placeholder="名称，如：左耳、尾巴、剑"
                  className="w-full h-7 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
                />
                <select
                  value={newLimbParentId}
                  onChange={(e) => handleParentChange(e.target.value)}
                  className="w-full h-7 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
                >
                  <option value="">选择父节点（挂在哪）</option>
                  {sortedNodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
                {parentNodeForSocket && parentNodeForSocket.sockets.length > 0 && (
                  <>
                    <select
                      value={newLimbSocketId}
                      onChange={(e) => setNewLimbSocketId(e.target.value)}
                      className="w-full h-7 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
                    >
                      <option value="">选择槽位</option>
                      {parentNodeForSocket.sockets.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.basePosition?.x ?? 0}, {s.basePosition?.y ?? 0})</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <label className="flex-1 text-[10px] text-gray-500">
                        Plug X
                        <input
                          type="number"
                          value={newLimbPlugX}
                          onChange={(e) => setNewLimbPlugX(Number(e.target.value))}
                          className="w-full h-6 px-1 text-xs bg-white/5 border border-white/10 rounded text-gray-200 mt-0.5"
                        />
                      </label>
                      <label className="flex-1 text-[10px] text-gray-500">
                        Plug Y
                        <input
                          type="number"
                          value={newLimbPlugY}
                          onChange={(e) => setNewLimbPlugY(Number(e.target.value))}
                          className="w-full h-6 px-1 text-xs bg-white/5 border border-white/10 rounded text-gray-200 mt-0.5"
                        />
                      </label>
                    </div>
                  </>
                )}
                {parentNodeForSocket && parentNodeForSocket.sockets.length === 0 && (
                  <div className="text-[10px] text-amber-500">父节点无槽位，将挂到根节点下（固定连接）</div>
                )}
                {parentNodeForSocket && parentNodeForSocket.sockets.length > 0 && !newLimbSocketId && (
                  <div className="text-[10px] text-amber-500">父节点有槽位，必须先选一个槽位——不选会挂到根下、与所选父节点无关</div>
                )}
                {!newLimbParentId && (
                  <div className="text-[10px] text-gray-500">未选父节点时挂到根节点下</div>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={handleAddLimb}
                    disabled={!newLimbName.trim() || (!!parentNodeForSocket && parentNodeForSocket.sockets.length > 0 && !newLimbSocketId)}
                  >
                    添加
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddLimb(false)}>
                    取消
                  </Button>
                </div>
              </div>
            )}
            {/* 操作选项 */}
            {targetNode && (
              <div className="space-y-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-[11px]"
                  onClick={() => {
                    // 覆盖门：目标格已有精灵时先确认，取消则不进入遮罩
                    if (!confirmOverwriteIfOccupied(targetNode)) return;
                    const store = useEditorStore.getState();
                    store.setMaskNodeId(targetNode.id);
                    store.setEditMode('mask');
                    // 向导保持挂载（不卸载），mask 画布在主区域，侧边栏不冲突
                  }}
                >
                  绘制遮罩
                </Button>
                {/* 复制/镜像生成（烘焙式）：源可选、镜像轴可自定义、可选压暗 */}
                <div className="p-2 rounded bg-white/5 border border-white/10 space-y-2">
                  <div className="text-[10px] text-gray-500">从已抠节点复制/镜像生成（烘焙式，源改不跟随）</div>
                  <select
                    value={deriveSourceId ?? ''}
                    onChange={(e) => setDeriveSourceId(e.target.value || null)}
                    className="w-full h-7 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
                  >
                    <option value="">— 选择源节点 —</option>
                    {deriveCandidates.map((n) => (
                      <option key={n.id} value={n.id}>{n.name}</option>
                    ))}
                  </select>
                  {deriveCandidates.length === 0 && (
                    <div className="text-[10px] text-amber-500">暂无可用源：先遮罩抠出至少一个其他节点</div>
                  )}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-500 shrink-0">镜像轴</span>
                    {([[90, '竖直'], [0, '水平'], [45, '主对角'], [135, '副对角']] as const).map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => setDeriveAxis(v)}
                        className={`h-5 px-1.5 text-[10px] rounded border ${deriveAxis === v ? 'border-cyan-400 text-cyan-300' : 'border-white/10 text-gray-400'}`}
                      >
                        {label}
                      </button>
                    ))}
                    <input
                      type="number"
                      value={deriveAxis}
                      onChange={(e) => setDeriveAxis(parseFloat(e.target.value) || 0)}
                      className="h-6 w-14 px-1 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
                      title="自定义轴向角（度）：预设轴按整图翻转，任意角绕源锚点"
                    />
                    <span className="text-[10px] text-gray-500">°</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[10px] text-gray-400">
                      <input
                        type="checkbox"
                        checked={deriveDarkenOn}
                        onChange={(e) => setDeriveDarkenOn(e.target.checked)}
                      />
                      压暗
                    </label>
                    <Slider
                      className="flex-1"
                      value={[deriveDarken]}
                      min={0.3}
                      max={1}
                      step={0.05}
                      disabled={!deriveDarkenOn}
                      onValueChange={([v]) => setDeriveDarken(v)}
                    />
                    <span className="text-[10px] text-gray-500 w-8 text-right">{Math.round(deriveDarken * 100)}%</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-[11px]"
                      disabled={!deriveSourceId}
                      onClick={() => handleDerive('copy')}
                    >
                      复制生成
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-[11px]"
                      disabled={!deriveSourceId}
                      onClick={() => handleDerive('mirror')}
                    >
                      镜像生成
                    </Button>
                  </div>
                </div>
                {/* 已抠精灵再编辑：不必重抠——像素直接进精灵编辑（改的是同一精灵 ID，
                    画布横幅确认/取消），枢轴重开 PivotEditor 点击调整 */}
                {targetSpriteId && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-[11px]"
                      onClick={() => {
                        const es = useEditorStore.getState();
                        // 若正开着遮罩绘制，先收掉，避免两种画布模式叠加
                        if (es.editMode === 'mask') es.setMaskNodeId(null);
                        es.enterSpriteEditMode(targetSpriteId);
                      }}
                    >
                      编辑像素
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-[11px]"
                      onClick={() => {
                        const sp = useProjectStore.getState().sprites[targetSpriteId];
                        if (sp) setPivotSprite(sp);
                      }}
                    >
                      调整枢轴
                    </Button>
                  </div>
                )}
                {/* 旋转已抠精灵（绕锚点）：事后手动再转，直接改精灵本体 */}
                {targetSpriteId && (
                  <div className="p-2 rounded bg-white/5 border border-white/10 space-y-2">
                    <div className="text-[10px] text-gray-500">旋转已抠精灵（绕锚点）</div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRotateExtracted(90)}
                        className="h-6 px-2 text-[10px] rounded border border-white/10 text-gray-300"
                      >
                        ↻ 90°
                      </button>
                      <button
                        onClick={() => handleRotateExtracted(-90)}
                        className="h-6 px-2 text-[10px] rounded border border-white/10 text-gray-300"
                      >
                        ↺ 90°
                      </button>
                      <input
                        type="number"
                        value={rotExtractAngle}
                        onChange={(e) => setRotExtractAngle(parseFloat(e.target.value) || 0)}
                        className="h-6 w-14 px-1 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
                        title="旋转角（度，正值顺时针）"
                      />
                      <span className="text-[10px] text-gray-500">°</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px] ml-auto"
                        onClick={() => handleRotateExtracted(rotExtractAngle)}
                      >
                        旋转
                      </Button>
                    </div>
                  </div>
                )}
                {targetProgress.cur && (
                  <div className="text-[10px] text-emerald-400">
                    ✓ 当前组合已处理（{targetProgress.cur.method === 'mask' ? '遮罩' : targetProgress.cur.method === 'copy' ? '复制' : '镜像'}）
                    {targetProgress.otherCount > 0 && (
                      <span className="text-gray-500"> · 另在 {targetProgress.otherCount} 个组合处理过</span>
                    )}
                  </div>
                )}
                {!targetProgress.cur && targetProgress.otherCount > 0 && (
                  <div className="text-[10px] text-gray-500">
                    当前组合未处理（该节点已在其它 {targetProgress.otherCount} 个组合处理过）
                  </div>
                )}
              </div>
            )}
            {!activeSkeleton && (
              <div className="text-xs text-amber-400">请先在木偶资产面板选择一个骨架</div>
            )}
          </div>
        )}

        {step === 'cleanup' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              可选：用 Inpainting 清理抠图结果。自动检测并填补精灵中的小洞、修复边缘。
            </p>
            <Button
              size="sm" variant="outline" className="w-full"
              disabled={processedNodes.size === 0}
              onClick={() => {
                const projectStore = useProjectStore.getState();
                let cleanedSprites = 0;
                let filledHoles = 0;
                let skipped = 0;
                for (const nodeId of new Set([...processedNodes.values()].map((en) => en.nodeId))) {
                  const node = sortedNodes.find((n) => n.id === nodeId);
                  if (!node) continue;
                  // 与抠图步同一解析口径：工作服装当前方向优先、模板服装槽回退。
                  // 旧实现读 slot.sprites[0]/node.spriteId——抠图成果根本不在那，
                  // 清的是模板自带精灵或直接跳过，本步等于白跑还可能误伤模板。
                  const spriteId = resolveNodeSpriteId(node);
                  const sprite = spriteId ? projectStore.sprites[spriteId] : null;
                  if (!spriteId || !sprite?.data) {
                    skipped++;
                    continue;
                  }
                  const pixels = sprite.data as PixelGrid;
                  const h = pixels.length;
                  const w = h > 0 ? pixels[0].length : 0;
                  // 检测洞：透明像素（null 与 '' 同为透明）且四邻域全不透明
                  const holes = new Set<string>();
                  for (let y = 1; y < h - 1; y++) {
                    for (let x = 1; x < w - 1; x++) {
                      if (pixels[y][x]) continue;
                      const neighbors = [
                        pixels[y-1][x], pixels[y+1][x],
                        pixels[y][x-1], pixels[y][x+1],
                      ];
                      if (neighbors.every((n) => !!n)) {
                        holes.add(`${x},${y}`);
                      }
                    }
                  }
                  if (holes.size > 0) {
                    const cleanedPixels = inpaintPixels(pixels, holes, 3);
                    projectStore.setSpritePixels(spriteId, cleanedPixels);
                    cleanedSprites++;
                    filledHoles += holes.size;
                  }
                }
                setCleanupResult(
                  `清理完成：${cleanedSprites} 个精灵共填补 ${filledHoles} 个洞` +
                    (skipped > 0 ? `；${skipped} 个节点未解析到精灵，已跳过` : '') +
                    (cleanedSprites === 0 && skipped === 0 ? '（未检测到可填补的洞）' : ''),
                );
              }}
            >
              对已抠肢体跑 Inpainting 清理
            </Button>
            {cleanupResult && <div className="text-[11px] text-emerald-400">{cleanupResult}</div>}
            {processedNodes.size === 0 && (
              <div className="text-[11px] text-amber-500">尚无已处理肢体，先到抠图步抠出或派生至少一个节点。</div>
            )}
            <Button
              size="sm" variant="ghost" className="w-full text-[11px]"
              onClick={() => {
                const idx = STEPS.findIndex((s) => s.id === 'cleanup');
                if (idx >= 0) setStep(STEPS[idx + 1].id);
              }}
            >
              跳过 <ArrowRight className="size-3.5 ml-1" />
            </Button>
          </div>
        )}

        {step === 'confirm' && (() => {
          // 按节点一张清单：行 = 已完成组合（进度）∪ 本会话写入格（目标上下文
          // writes，会话结束才清，此刻可读），同组合合并一行并标「本会话写入」；
          // 顺带设了变体指派的写入单独标注。
          const sessionWrites = refAssemblyTarget?.writes ?? [];
          const processedNodeCount = sortedNodes.filter((n) =>
            [...processedNodes.values()].some((en) => en.nodeId === n.id),
          ).length;
          return (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">
                已处理 {processedNodeCount}/{sortedNodes.length} 个肢体 · 共 {processedNodes.size} 个组合
                {sessionWrites.length > 0 && <> · 本会话写入 {sessionWrites.length} 格</>}
              </p>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {sortedNodes.map((n) => {
                  const entries = [...processedNodes.values()].filter((en) => en.nodeId === n.id);
                  const writes = sessionWrites.filter((w) => w.nodeId === n.id);
                  const rowMap = new Map<
                    string,
                    { combo: RefAssemblyCombo; method?: string; write?: (typeof writes)[number] }
                  >();
                  for (const en of entries) {
                    rowMap.set(refAssemblyComboKey(n.id, en), { combo: en, method: en.method });
                  }
                  for (const w of writes) {
                    const key = refAssemblyComboKey(n.id, w);
                    const row = rowMap.get(key);
                    if (row) row.write = w;
                    else rowMap.set(key, { combo: w, write: w });
                  }
                  const rows = [...rowMap.values()];
                  return (
                    <div key={n.id} className="text-xs px-2 py-1 rounded bg-white/5">
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-gray-300">{n.name}</span>
                        {rows.length === 0 && <span className="text-gray-600">○ 未处理</span>}
                      </div>
                      {rows.map((row, i) => (
                        <div key={i} className="pl-3 text-[11px] text-emerald-400">
                          ✓ {refAssemblyComboLabel(row.combo, variantNameOf)}
                          {row.method && (
                            <>（{row.method === 'mask' ? '遮罩' : row.method === 'copy' ? '复制' : '镜像'}）</>
                          )}
                          {row.write && <span className="text-cyan-300"> · 本会话写入</span>}
                          {row.write?.autoAssignedVariant && (
                            <span className="text-amber-400"> · 已顺带设为该服装槽的变体</span>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              {processedNodeCount < sortedNodes.length && (
                <div className="text-[11px] text-amber-500">
                  还有 {sortedNodes.length - processedNodeCount} 个肢体未处理，返回抠图步骤继续。
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* 已抠精灵枢轴重开编辑（弹窗自带确认/取消，直接写全局精灵表） */}
      {pivotSprite && (
        <PivotEditor sprite={pivotSprite} onClose={() => setPivotSprite(null)} />
      )}

        {/* Footer */}
        <div className="flex justify-between p-3 border-t border-white/10 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            disabled={stepIndex <= 0}
            onClick={() => stepIndex > 0 && setStep(STEPS[stepIndex - 1].id)}
          >
            <ArrowLeft className="size-3.5 mr-1" /> 上一步
          </Button>
          <Button
            size="sm"
            disabled={
              (stepIndex === 0 && !referenceImageUrl) ||
              (step === 'align' && !activeSkeleton)
            }
            onClick={() => {
              if (stepIndex >= 0 && stepIndex < STEPS.length - 1) {
                // 对位姿态跨 align/mask 两步保留（抠图取样要用），不中途恢复
                setStep(STEPS[stepIndex + 1].id);
              } else if (stepIndex === STEPS.length - 1) {
                // 完成：结束会话保留写入（目标服装集与各层写入原样保留），
                // 恢复模板姿态与角色纬度，清会话快照与目标上下文，关向导
                endAssemblySession(false);
                resetRefWizardStep();
                onClose();
              }
            }}
          >
            {stepIndex === STEPS.length - 1 ? '完成' : '下一步'} <ArrowRight className="size-3.5 ml-1" />
          </Button>
        </div>
    </div>
  );
}
