/**
 * tool-handlers.ts — Strategy Pattern handlers for each pixel-editor tool.
 * Extracted from use-canvas-interaction.ts to reduce cyclomatic complexity.
 * Each handler encapsulates the mouse/keyboard logic for a specific tool.
 */

import type { MouseEvent as ReactMouseEvent } from 'react';
import { useProjectStore } from '@/lib/store';
import { useEditorStore } from '@/lib/store';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { inpaintPixels } from '@/lib/inpainting';
import { floodFill } from '@/lib/engine';
import { renderUnifiedToCanvas } from '@/lib/unified-render';
import { resolvePuppetNodeSprite } from '@/lib/engine/puppet-utils';
import { interpolateNodeKeyframes } from '@/lib/engine/render-helpers/puppet-keyframe-interpolation';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import {
  isPixelInPart,
  getLinePixels,
  simplifyPath,
  pointInPolygon,
  computeSpriteEndPoint,
  isStrokeToolCheck,
  spritePivotX,
  spritePivotY,
} from './canvas-utils';
import { subToPx, pxToSub } from '@/lib/unified-types';
import type { CanvasState } from './use-canvas-state';
import type { BrushCommand, ModifierInstance } from '@/lib/types';

// ---------------------------------------------------------------------------
// ToolHandler interface
// ---------------------------------------------------------------------------

export interface ToolHandler {
  onMouseDown?(s: CanvasState, e: ReactMouseEvent, px: number, py: number): void;
  onMouseMove?(s: CanvasState, e: ReactMouseEvent, px: number, py: number): void;
  onMouseUp?(s: CanvasState): void;
  onKeyDown?(s: CanvasState, e: KeyboardEvent): void;
}

// ---------------------------------------------------------------------------
// PanningHandler (reference only — actual panning stays in the hook)
// ---------------------------------------------------------------------------

export const panningHandler: ToolHandler = {};

// ---------------------------------------------------------------------------
// Tile Mode Handler (brush/eraser/fill/eyedropper in tile mode)
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Move Tool Handler
// ---------------------------------------------------------------------------

export const moveToolHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    const editorState = s.editorStore.getState();
    // part_edit 模式下只能拖正在编辑的部位
    if (editorState.editMode === 'sprite_edit') {
      const editPartId = editorState.spriteEditSpriteId;
      if (!editPartId || s.selectedPart?.id !== editPartId) return;
    }
    if (!s.selectedPart) return;
    const selPart = s.selectedPart;
    const offsetX = s.canvasWidth / 2; const offsetY = s.canvasHeight / 2;
    const { offsetX: txOff, offsetY: tyOff } = s.getInterpolatedTranslateOffset(selPart.id!, currentFrame);
    if (isPixelInPart(px, py, selPart, offsetX, offsetY, txOff, tyOff)) {
      const targetLevel = s.editorStore.getState().moveTargetLevel;
      const kfOnlyOffsetX = txOff; const kfOnlyOffsetY = tyOff;
      const startOffsetX = kfOnlyOffsetX;
      const startOffsetY = kfOnlyOffsetY;
      useProjectStore.getState().beginDrag('移动部件');
      s.isDrawingRef.current = true; s.markDirty();
      s.moveStartRef.current = { x: px, y: py, offsetX: startOffsetX, offsetY: startOffsetY, targetLevel, partGlobalOffsetX: 0, partGlobalOffsetY: 0 };
    }
  },

  onMouseMove(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    if (!s.isDrawingRef.current || !s.selectedPart || !s.moveStartRef.current) return;
    const selPart = s.selectedPart;
    const dx = px - s.moveStartRef.current.x; const dy = py - s.moveStartRef.current.y;
    const newOffsetX = s.moveStartRef.current.offsetX + dx; const newOffsetY = s.moveStartRef.current.offsetY + dy;
    // Part 是纯精灵数据，不再有 part_global 位移层级；统一走关键帧
    let kf = s.keyframes.find(k => k.partId === selPart.id && k.frame === currentFrame);
    if (!kf) kf = useProjectStore.getState().addKeyframe(selPart.id!, currentFrame);
    const translateMod = kf.modifiers.find(m => m.type === 'translate');
    if (translateMod) useProjectStore.getState().updateModifier(kf.id, translateMod.id, { offsetX: newOffsetX, offsetY: newOffsetY });
    else { useProjectStore.getState().addModifier(kf.id, 'translate'); const updatedKf = useProjectStore.getState().keyframes.find(k => k.id === kf!.id); if (updatedKf) { const newMod = updatedKf.modifiers.find(m => m.type === 'translate'); if (newMod) useProjectStore.getState().updateModifier(updatedKf.id, newMod.id, { offsetX: newOffsetX, offsetY: newOffsetY }); } }
  },
};

// ---------------------------------------------------------------------------
// Select Tool Handler
// ---------------------------------------------------------------------------

export const selectToolHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    // part_edit 模式下禁止切换选中部位
    const editorState = s.editorStore.getState();
    if (editorState.editMode === 'sprite_edit') return;
    s.editorStore.getState().selectPart(s.findPartAtPixel(px, py)?.id ?? null);
  },
};

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Puppet Handler — 木偶直接操控（新工作流）
//
// 单一操控模型（不再有 move/manipulate 双模式切换）：
//   拖动肢体         = 绕轴心旋转
//   Shift + 拖动     = 移动该节点
//   Alt + 拖动       = 移动该节点所插入的父节点插槽在父节点中的位置（rig）
//   Ctrl + 拖动      = 移动该部件枢轴在该部件中的位置
//   Ctrl + 点击      = 编辑该节点精灵像素
//   Q / E            = 选中节点 ±15°
//   WASD / 方向键    = 移动选中节点 1px（Alt+方向键 = 移动整体）
//
// 关键语义：perform 阶段的所有操控只写 PuppetNodeKeyframe，
// 永不修改节点的 rest pose（angle/offsetX/... 的静止值只在 rig 阶段编辑）。
// 新关键帧以当前帧插值姿态为基准写入，避免旧代码用 rest 值覆盖未触碰属性的 bug。
// 自动关键帧关闭时，画布拖动/按键不写入任何数据（用面板「记录姿态」手动打帧）。
// ---------------------------------------------------------------------------

/** 把操控写入关键帧：存在则更新，不存在则以当前插值姿态为基准新建 */
function writePuppetPoseKeyframe(
  skeletonId: string,
  clipId: string,
  nodeId: string,
  frame: number,
  values: { angle: number; stretch: number; x: number; y: number },
  variantIndex: number,
) {
  const store = useProjectStore.getState();
  const clip = store.animationClips.find((c) => c.id === clipId);
  if (!clip) return;
  const existingKf = (clip.nodeKeyframes ?? []).find(
    (kf) => kf.nodeId === nodeId && kf.frame === frame
  );
  if (existingKf) {
    store.updateNodeKeyframe(clip.id, existingKf.id, { ...values, variantIndex });
  } else {
    store.addNodeKeyframe(clip.id, nodeId, frame, { ...values, variantIndex });
  }
}

export const puppetHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const hit = s.findPuppetNodeAtPixel(px, py);
    const project = useProjectStore.getState();
    if (!hit) {
      project.setSelectedNodeId(null);
      return;
    }
    const { node, character, clipId } = hit;
    project.setSelectedNodeId(node.id);
    s.editorStore.getState().setActivePuppetSkeletonId(character.id);
    // 同步到操控会话（PerformPanel 肢体列表高亮用）
    try { usePuppetSessionStore.setState({ performNodeId: node.id }); } catch { /* noop */ }

    // 预计算插值（Ctrl/Alt 路径也需要世界角度）
    const tmpClip = clipId ? project.animationClips.find((c) => c.id === clipId) : null;
    const tmpFrame = project.currentFrame;
    const tmpChar = useProjectStore.getState().unifiedCharacters[character.id];
    const tmpIvMap = tmpChar ? interpolateNodeKeyframes(tmpChar, tmpFrame) : new Map();

    // 计算指定节点的世界角度（从根累加）
    const computeWorldAngle = (targetNode: typeof node): number => {
      const chain: typeof targetNode[] = [];
      let cur: typeof targetNode | undefined = targetNode;
      while (cur) {
        chain.unshift(cur);
        if (!cur.parentId) break;
        cur = character.nodes[cur.parentId];
      }
      let angle = 0;
      for (const n of chain) {
        angle += tmpIvMap.get(n.id)?.angle ?? n.transform.angle;
      }
      return angle;
    };

    // Ctrl+点击/拖动：点击=编辑该节点精灵，拖动=移动部件枢轴在部件中的位置
    if (e.ctrlKey || e.metaKey) {
      const activeCostume = character.activeCostumeSetId
        ? character.costumeSets.find((cs) => cs.id === character.activeCostumeSetId) ?? null
        : null;
      const direction = (node.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
      // Resolve sprite from Character.sprites table (track spriteId for pivot updates)
      let sprite: import('@/lib/unified-types').Sprite | null = null;
      let spriteId: string | null = null;
      if (node.slot && activeCostume) {
        const piece = activeCostume.pieces[node.slot.slotKey];
        const ref = piece?.sprites[direction] ?? piece?.sprites[0];
        if (ref) {
          if ('spriteId' in ref) {
            spriteId = ref.spriteId;
            sprite = useProjectStore.getState().sprites[ref.spriteId] ?? null;
          } else {
            sprite = ref;
          }
        }
      }
      if (!sprite && node.sprite) sprite = node.sprite;
      if (!sprite) return;
      // 先记录，等 mouseup 时判断是点击还是拖动
      s.puppetNodeDragRef.current = {
        nodeId: node.id,
        skeletonId: character.id,
        characterId: character.id,
        clipId: clipId ?? '',
        startX: px,
        startY: py,
        origAngle: 0,
        origStretch: 1,
        origOffsetX: 0,
        origOffsetY: 0,
        moveTargetNodeId: node.id,
        mode: 'pivot' as const,
        pivotWorldX: 0,
        pivotWorldY: 0,
        startMouseAngle: 0,
        dragStarted: false,
        // pivot 移动专用 (spriteId 存于 pivotPartId 字段；plug 为 subpixel，需转像素)
        pivotPartId: spriteId ?? '',
        origPivotX: sprite.plug ? subToPx(sprite.plug.x) : 0,
        origPivotY: sprite.plug ? subToPx(sprite.plug.y) : 0,
        nodeWorldAngle: computeWorldAngle(node),
      };
      return;
    }

    const session = usePuppetSessionStore.getState();
    // 未武装时自动武装（不弹 toast）
    if (!session.performArmed) {
      usePuppetSessionStore.setState({ performArmed: true });
    }
    // 关闭自动关键帧时：只选中，不开始拖动
    if (!usePuppetSessionStore.getState().autoKeyframe) {
      return;
    }

    // Alt+拖动：移动该节点所插入的父节点插槽在父节点中的位置（rig 操作，直接改骨架）
    if (e.altKey) {
      const socketId = node.attachment.parentSocketId;
      if (!socketId) return; // 根节点无插槽
      const parentNode = node.parentId ? character.nodes[node.parentId] : undefined;
      if (!parentNode) return;
      const socket = parentNode.sockets.find((s) => s.id === socketId);
      if (!socket) return;
      // 父节点世界角度（用当前插值姿态，保证视觉跟手）
      const parentWorldAngle = computeWorldAngle(parentNode);
      s.puppetNodeDragRef.current = {
        nodeId: node.id,
        skeletonId: character.id,
        characterId: character.id,
        clipId: clipId ?? '',
        startX: px,
        startY: py,
        origAngle: 0,
        origStretch: 1,
        origOffsetX: 0,
        origOffsetY: 0,
        moveTargetNodeId: node.id,
        mode: 'socket' as const,
        pivotWorldX: 0,
        pivotWorldY: 0,
        startMouseAngle: 0,
        dragStarted: false,
        // socket 移动专用
        socketId: socket.id,
        parentNodeId: parentNode.id,
        origSocketX: socket.basePosition.x,
        origSocketY: socket.basePosition.y,
        parentAngle: parentWorldAngle,
      };
      return;
    }

    let dragMode: 'rotate' | 'move' | 'moveAll';
    // Alt+拖动（IK）已禁用：实现不可靠，待重做
    if (e.shiftKey) dragMode = 'move';
    else dragMode = 'rotate';

    const resolvedClipId = clipId ?? session.ensurePuppetClip(character.id);
    if (!resolvedClipId) return;
    const clip = project.animationClips.find((c) => c.id === resolvedClipId);
    const frame = project.currentFrame;

    // 以当前帧的插值姿态为拖动基准（所见即所得）
    const _uc = useProjectStore.getState().unifiedCharacters[character.id];
    const ivMap = _uc ? interpolateNodeKeyframes(_uc, frame) : new Map();
    const rootNode = Object.values(character.nodes).find((n) => !n.parentId);
    const moveTarget = node;
    const rotateIv = ivMap.get(node.id);
    const moveIv = ivMap.get(moveTarget.id);

    const pivotWorldX = (() => {
      const project = useProjectStore.getState();
      const uChar = project.unifiedCharacters?.[character.id];
      const uNode = uChar?.nodes[node.id];
      if (uChar && uNode) return s.computePivotWorldPosition(uNode, uChar, s.canvasWidth, s.canvasHeight).x;
      return 0;
    })();
    const pivotWorldY = (() => {
      const project = useProjectStore.getState();
      const uChar = project.unifiedCharacters?.[character.id];
      const uNode = uChar?.nodes[node.id];
      if (uChar && uNode) return s.computePivotWorldPosition(uNode, uChar, s.canvasWidth, s.canvasHeight).y;
      return 0;
    })();
    const startMouseAngle = Math.atan2(py - pivotWorldY, px - pivotWorldX);

    // 计算父节点的世界角度（用于 move 模式的坐标转换）
    let parentWorldAngle = 0;
    if (dragMode === 'move' && node.attachment.parentSocketId) {
      const parent = node.parentId ? character.nodes[node.parentId] : undefined;
      if (parent) {
        parentWorldAngle = computeWorldAngle(parent);
      }
    }

    s.puppetNodeDragRef.current = {
      nodeId: node.id,
      skeletonId: character.id,
      characterId: character.id,
      clipId: resolvedClipId,
      startX: px,
      startY: py,
      origAngle: rotateIv?.angle ?? node.transform.angle,
      origStretch: rotateIv?.stretch ?? node.transform.stretch,
      origOffsetX: moveIv?.x ?? moveTarget.transform.x,
      origOffsetY: moveIv?.y ?? moveTarget.transform.y,
      moveTargetNodeId: moveTarget.id,
      mode: dragMode,
      pivotWorldX,
      pivotWorldY,
      startMouseAngle,
      dragStarted: false,
      parentWorldAngle,
    };
  },

  onMouseMove(s, e, px, py) {
    const drag = s.puppetNodeDragRef.current;
    if (!drag) return;
    if (!drag.dragStarted) {
      const ddx = px - drag.startX;
      const ddy = py - drag.startY;
      if (Math.sqrt(ddx * ddx + ddy * ddy) < 2) return;
      drag.dragStarted = true;
      useProjectStore.getState().beginDrag(
        drag.mode === 'rotate' ? '旋转木偶节点' : drag.mode === 'socket' ? '移动父节点插槽' : '移动木偶节点'
      );
      s.isDrawingRef.current = true;
      s.markDirty();
    }
    const store = useProjectStore.getState();
    const frame = store.currentFrame;
    const character = store.unifiedCharacters[drag.characterId ?? drag.skeletonId];
    if (!character) return;
    // Direction for keyframes: from node's variantIndex (0-7) → PuppetDirection
    const dragNode = character.nodes[drag.nodeId];
    const variantIndex = (dragNode?.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    const direction = (['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'] as const)[variantIndex];
    const clip = store.animationClips.find((c) => c.id === drag.clipId);
    const ivMap = interpolateNodeKeyframes(character, frame);

    if (drag.mode === 'rotate') {
      const currentMouseAngle = Math.atan2(py - drag.pivotWorldY, px - drag.pivotWorldX);
      const newAngle = drag.origAngle + Math.round((currentMouseAngle - drag.startMouseAngle) * 180 / Math.PI);
      writePuppetPoseKeyframe(drag.skeletonId, drag.clipId, drag.nodeId, frame, {
        angle: newAngle,
        stretch: drag.origStretch,
        x: drag.origOffsetX,
        y: drag.origOffsetY,
      }, variantIndex);
    } else if (drag.mode === 'socket') {
      // socket：移动父节点插槽在父节点中的位置（rig 操作，直接改骨架）
      const ddx = px - drag.startX;
      const ddy = py - drag.startY;
      // 逆旋转到父节点局部空间
      const angleRad = ((drag.parentAngle ?? 0) * Math.PI) / 180;
      const localDx = ddx * Math.cos(-angleRad) - ddy * Math.sin(-angleRad);
      const localDy = ddx * Math.sin(-angleRad) + ddy * Math.cos(-angleRad);
      const newSocketX = Math.round((drag.origSocketX ?? 0) + pxToSub(localDx));
      const newSocketY = Math.round((drag.origSocketY ?? 0) + pxToSub(localDy));
      const charId = drag.characterId ?? drag.skeletonId;
      const parentNode = character.nodes[drag.parentNodeId ?? ''];
      if (parentNode) {
        const newSockets = parentNode.sockets.map((s) =>
          s.id === drag.socketId ? { ...s, basePosition: { x: newSocketX, y: newSocketY } } : s
        );
        store.updateUnifiedNode(charId, drag.parentNodeId!, { sockets: newSockets });
      }
    } else if (drag.mode === 'pivot') {
      // pivot：移动精灵枢轴在精灵中的位置（直接改全局 sprites 表）
      // 精灵在画布上按节点世界角度旋转，需逆旋转鼠标增量到精灵局部空间
      const ddx = px - drag.startX;
      const ddy = py - drag.startY;
      const angleRad = ((drag.nodeWorldAngle ?? 0) * Math.PI) / 180;
      const localDx = ddx * Math.cos(-angleRad) - ddy * Math.sin(-angleRad);
      const localDy = ddx * Math.sin(-angleRad) + ddy * Math.cos(-angleRad);
      // px 已是画布像素（screenToPixel 里除过 zoom），精灵 1:1 绘制，画布像素 = 精灵像素
      const sprite = useProjectStore.getState().sprites[drag.pivotPartId ?? ''];
      if (sprite) {
        const newPivotX = Math.round((drag.origPivotX ?? 0) + localDx);
        const newPivotY = Math.round((drag.origPivotY ?? 0) + localDy);
        // 钳制到精灵范围内
        const clampedX = Math.max(0, Math.min(sprite.width - 1, newPivotX));
        const clampedY = Math.max(0, Math.min(sprite.height - 1, newPivotY));
        store.updateSprite(drag.pivotPartId!, {
          plug: { x: pxToSub(clampedX), y: pxToSub(clampedY) },
        });
      }
    } else {
      // move：移动目标节点的 offset（offset 在父节点局部空间，需逆旋转鼠标增量）
      const ddx = px - drag.startX;
      const ddy = py - drag.startY;
      const angleRad = ((drag.parentWorldAngle ?? 0) * Math.PI) / 180;
      const localDx = ddx * Math.cos(-angleRad) - ddy * Math.sin(-angleRad);
      const localDy = ddx * Math.sin(-angleRad) + ddy * Math.cos(-angleRad);
      const newOffsetX = Math.round(drag.origOffsetX + pxToSub(localDx));
      const newOffsetY = Math.round(drag.origOffsetY + pxToSub(localDy));
      const targetNodeId = drag.moveTargetNodeId ?? drag.nodeId;
      writePuppetPoseKeyframe(drag.skeletonId, drag.clipId, targetNodeId, frame, {
        angle: drag.origAngle,
        stretch: drag.origStretch,
        x: newOffsetX,
        y: newOffsetY,
      }, variantIndex);
    }
  },

  onKeyDown(s, e) {
    if (e.ctrlKey || e.metaKey) return;
    const session = usePuppetSessionStore.getState();
    // 未武装或关闭自动关键帧时：按键不写入
    if (!session.performArmed || !session.autoKeyframe) return;

    const projectState = useProjectStore.getState();
    const selectedNodeId = session.performNodeId ?? projectState.selectedNodeId;
    if (!selectedNodeId) return;

    // Find the Character containing the selected node
    let character: import('@/lib/unified-types').Character | null = null;
    for (const ch of Object.values(projectState.unifiedCharacters)) {
      if (ch.nodes[selectedNodeId]) { character = ch; break; }
    }
    if (!character) return;
    const clipId = session.ensurePuppetClip(character.id);
    if (!clipId) return;
    const clip = projectState.animationClips.find((c) => c.id === clipId);
    const frame = projectState.currentFrame;
    const selNode = character.nodes[selectedNodeId];
    const variantIndex = (selNode?.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    const direction = (['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'] as const)[variantIndex];
    const ivMap = interpolateNodeKeyframes(character, frame);

    const ANGLE_STEP = 15;
    const MOVE_STEP = pxToSub(1);  // SubPixel：键盘微调 1 像素

    const applyNodePose = (nodeId: string, patch: Partial<{ angle: number; x: number; y: number }>) => {
      const iv = ivMap.get(nodeId);
      const node = character!.nodes[nodeId];
      if (!node) return;
      writePuppetPoseKeyframe(character!.id, clipId, nodeId, frame, {
        angle: patch.angle ?? iv?.angle ?? node.transform.angle,
        stretch: iv?.stretch ?? node.transform.stretch,
        x: patch.x ?? iv?.x ?? node.transform.x,
        y: patch.y ?? iv?.y ?? node.transform.y,
      }, variantIndex);
    };

    if (e.code === 'KeyQ' || e.code === 'KeyE') {
      e.preventDefault();
      const iv = ivMap.get(selectedNodeId);
      const node = character.nodes[selectedNodeId]!;
      const base = iv?.angle ?? node.transform.angle;
      const newAngle = e.code === 'KeyQ' ? base - ANGLE_STEP : base + ANGLE_STEP;
      applyNodePose(selectedNodeId, { angle: newAngle });
      return;
    }

    const isMoveKey = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code);
    if (isMoveKey) {
      e.preventDefault();
      // Alt+方向键 = 移动整个木偶（根节点），否则移动选中节点
      const targetId = e.altKey
        ? Object.values(character.nodes).find((n) => !n.parentId)?.id ?? selectedNodeId
        : selectedNodeId;
      const iv = ivMap.get(targetId);
      const node = character.nodes[targetId]!;
      let dx = 0, dy = 0;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') dy = -MOVE_STEP;
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') dy = MOVE_STEP;
      else if (e.code === 'KeyA' || e.code === 'ArrowLeft') dx = -MOVE_STEP;
      else if (e.code === 'KeyD' || e.code === 'ArrowRight') dx = MOVE_STEP;
      applyNodePose(targetId, {
        x: (iv?.x ?? node.transform.x) + dx,
        y: (iv?.y ?? node.transform.y) + dy,
      });
    }
  },

  onMouseUp(s) {
    const drag = s.puppetNodeDragRef.current;
    // Ctrl+点击（未拖动）：进入部件像素编辑
    // pivotPartId 存的是 spriteId；若为 part_<id> 格式则提取 partId 进入 Part 编辑
    if (drag && drag.mode === 'pivot' && !drag.dragStarted) {
      const spriteId = drag.pivotPartId ?? '';
      const partId = spriteId.startsWith('part_') ? spriteId.slice(5) : null;
      if (partId) {
        s.editorStore.getState().selectPart(partId);
        s.editorStore.getState().enterSpriteEditMode(partId);
      }
    }
  },
};
// Eyedropper Handler
// ---------------------------------------------------------------------------

export const eyedropperHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    s.applyEyedropper(px, py);
  },
};

// ---------------------------------------------------------------------------
// Fill Tool Handler
// ---------------------------------------------------------------------------

export const fillToolHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    if (s.editMode === 'correction' && s.selectedPartId && s.selectedPart) {
      const selPart = s.selectedPart;
      const store = useProjectStore.getState();
      store.performBatch('填充', () => {
        let currentKf = store.keyframes.find(k => k.partId === s.selectedPartId && k.frame === currentFrame);
        if (!currentKf) currentKf = store.addKeyframe(s.selectedPartId!, currentFrame);
        if (currentKf) {
          let pixelEditMod = currentKf.modifiers.find(m => m.type === 'pixel_edit' && m.enabled);
          let modId = pixelEditMod?.id;
          if (!modId) modId = store.createPixelEditModifier(currentKf.id);
          const { offsetX: txOffF, offsetY: tyOffF } = s.getInterpolatedTranslateOffset(selPart.id!, currentFrame);
          const localF = s.canvasToPartLocal(px, py, selPart, txOffF, tyOffF);
          const fillPt = localF ? { x: localF.lx, y: localF.ly } : { x: px, y: py };
          const fillCmd: BrushCommand = { id: crypto.randomUUID(), type: 'fill', color: s.brushColor, size: 1, points: [fillPt], blendMode: 'normal', brushStyle: s.brushStyle !== 'solid' ? s.brushStyle : undefined, brushStyleParams: s.brushStyle !== 'solid' ? s.brushStyleParams : undefined };
          store.addPixelEditCommand(currentKf.id, modId, fillCmd);
        }
      });
      return;
    }
    if (s.editMode === 'sprite_edit' && s.selectedPartId && s.selectedPart) {
      const selPart = s.selectedPart;
      const editorState = s.editorStore.getState();
      const currentPartEditMods = editorState.spriteEditModifiers;
      const lastMod = currentPartEditMods[currentPartEditMods.length - 1];
      let modId: string | undefined = (lastMod?.type === 'pixel_edit' && lastMod?.enabled) ? lastMod.id : undefined;
      if (!modId) modId = editorState.addPartEditModifier('pixel_edit');
      if (modId) {
        const offsetX = Math.floor((s.canvasWidth - selPart.width) / 2);
        const offsetY = Math.floor((s.canvasHeight - selPart.height) / 2);
        const fillPt = { x: px - offsetX, y: py - offsetY };
        const fillCmd: BrushCommand = { id: crypto.randomUUID(), type: 'fill', color: s.brushColor, size: 1, points: [fillPt], blendMode: 'normal', brushStyle: s.brushStyle !== 'solid' ? s.brushStyle : undefined, brushStyleParams: s.brushStyle !== 'solid' ? s.brushStyleParams : undefined, ...(s.compositingMode && (s.styleAspects.length > 0 || s.strokeDrivers.length > 0) ? { styleAspects: s.styleAspects.filter(a => a.enabled), strokeDrivers: s.strokeDrivers.filter(d => d.enabled) } : {}) };
        const updatedMods = s.editorStore.getState().spriteEditModifiers.map(m => {
          if (m.id !== modId) return m;
          const existingCommands: BrushCommand[] = (m.params.brushCommands as BrushCommand[]) || [];
          return { ...m, params: { ...m.params, brushCommands: [...existingCommands, fillCmd] } } as ModifierInstance;
        });
        s.editorStore.getState().setPartEditModifiers(updatedMods);
      }
      return;
    }
    if (s.editMode === 'normal' && s.selectedPartId) s.editorStore.getState().enterSpriteEditMode(s.selectedPartId);
    s.applyFill(px, py);
  },
};

// ---------------------------------------------------------------------------
// Trajectory Tool Handler
// ---------------------------------------------------------------------------

export const trajectoryHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    if (s.editMode === 'trajectory_edit' && s.selectedPartId) {
      const cpHit = s.findTrajectoryCpAtPixel(px, py);
      if (cpHit) {
        useProjectStore.getState().beginDrag('拖动轨迹控制点');
        s.isDrawingRef.current = true; s.markDirty();
        s.trajectoryCpDragRef.current = { partId: cpHit.partId, segmentIdx: cpHit.segmentIdx, cp: cpHit.cp, startX: px, startY: py, origCp1x: cpHit.cp1x, origCp1y: cpHit.cp1y, origCp2x: cpHit.cp2x, origCp2y: cpHit.cp2y };
        return;
      }
    }
    if (e.shiftKey && s.selectedPartId) { s.isDrawingRef.current = true; s.markDirty(); s.handDrawTrajectoryRef.current = [{ x: px, y: py }]; s.lastPixelRef.current = { x: px, y: py }; return; }
    s.isDrawingRef.current = true; s.markDirty();
    s.trajectoryPathRef.current = [{ x: px, y: py }]; s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current) return;
    if (s.trajectoryCpDragRef.current) {
      const drag = s.trajectoryCpDragRef.current; const ddx = px - drag.startX; const ddy = py - drag.startY;
      const traj = useProjectStore.getState().trajectories.find(t => t.partId === drag.partId);
      if (traj) { const pt = traj.points[drag.segmentIdx]; const nextPt = traj.points[drag.segmentIdx + 1]; if (pt && nextPt) { if (drag.cp === 'cp1') useProjectStore.getState().updateTrajectoryPoint(drag.partId, pt.frame, { cp1x: drag.origCp1x + ddx, cp1y: drag.origCp1y + ddy }); else useProjectStore.getState().updateTrajectoryPoint(drag.partId, nextPt.frame, { cp2x: drag.origCp2x + ddx, cp2y: drag.origCp2y + ddy }); } }
      return;
    }
    if (s.handDrawTrajectoryRef.current.length > 0) {
      if (s.lastPixelRef.current) { for (const point of getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)) s.handDrawTrajectoryRef.current.push({ x: point.x, y: point.y }); }
      else s.handDrawTrajectoryRef.current.push({ x: px, y: py });
      s.lastPixelRef.current = { x: px, y: py }; return;
    }
    if (s.lastPixelRef.current) { for (const point of getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)) s.trajectoryPathRef.current.push({ x: point.x, y: point.y }); }
    else s.trajectoryPathRef.current.push({ x: px, y: py });
    s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseUp(s) {
    // Hand-drawn trajectory
    if (s.isDrawingRef.current && s.handDrawTrajectoryRef.current.length > 2 && s.selectedPartId) {
      const rawPath = s.handDrawTrajectoryRef.current;
      const simplified = simplifyPath(rawPath, 3);
      const totalFrames = useProjectStore.getState().totalFrames;
      const numPoints = Math.min(totalFrames, simplified.length);
      const step = Math.max(1, Math.floor(totalFrames / numPoints));
      for (let i = 0; i < simplified.length; i++) {
        const frame = Math.min(i * step, totalFrames - 1);
        const pt = simplified[i];
        const snapX = s.trajectorySnap ? Math.round(pt.x) : pt.x; const snapY = s.trajectorySnap ? Math.round(pt.y) : pt.y;
        const prevPt = i > 0 ? simplified[i - 1] : simplified[i]; const nextPt = i < simplified.length - 1 ? simplified[i + 1] : simplified[i];
        const cp1x = i > 0 ? (prevPt.x + pt.x) / 2 - pt.x : 0; const cp1y = i > 0 ? (prevPt.y + pt.y) / 2 - pt.y : 0;
        const cp2x = i < simplified.length - 1 ? (nextPt.x + pt.x) / 2 - pt.x : 0; const cp2y = i < simplified.length - 1 ? (nextPt.y + pt.y) / 2 - pt.y : 0;
        useProjectStore.getState().addTrajectoryPoint(s.selectedPartId, frame, snapX, snapY, 0);
        useProjectStore.getState().updateTrajectoryPoint(s.selectedPartId, frame, { cp1x, cp1y, cp2x, cp2y });
      }
      s.handDrawTrajectoryRef.current = [];
    } else if (s.handDrawTrajectoryRef.current.length > 0) s.handDrawTrajectoryRef.current = [];

    // Trajectory freehand path
    if (s.isDrawingRef.current && s.trajectoryPathRef.current.length >= 2 && s.selectedPartId) {
      const path = s.trajectoryPathRef.current; const totalFrames = useProjectStore.getState().totalFrames; const pathLength = path.length;
      const numSamples = Math.min(totalFrames, Math.max(2, Math.round(pathLength / 3)));
      const step = pathLength / numSamples;
      for (let i = 0; i < numSamples; i++) {
        const pathIndex = Math.min(Math.round(i * step), pathLength - 1); const point = path[pathIndex];
        const frame = Math.round((i / (numSamples - 1)) * (totalFrames - 1));
        const snapX = s.trajectorySnap ? Math.round(point.x) : point.x; const snapY = s.trajectorySnap ? Math.round(point.y) : point.y;
        useProjectStore.getState().addTrajectoryPoint(s.selectedPartId, frame, snapX, snapY, 0);
      }
      s.trajectoryPathRef.current = [];
    }

    if (s.trajectoryCpDragRef.current) s.trajectoryCpDragRef.current = null;
  },
};

// ---------------------------------------------------------------------------
// Crop Tool Handler
// ---------------------------------------------------------------------------

export const cropHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    s.isDrawingRef.current = true; s.markDirty(); s.cropStartRef.current = { x: px, y: py }; s.cropRectRef.current = { x1: px, y1: py, x2: px, y2: py };
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current || !s.cropStartRef.current) return;
    s.cropRectRef.current = { x1: s.cropStartRef.current.x, y1: s.cropStartRef.current.y, x2: px, y2: py };
  },

  onMouseUp(s) {
    if (!s.isDrawingRef.current || !s.cropRectRef.current) return;
    const rect = s.cropRectRef.current;
    const cropX = Math.min(rect.x1, rect.x2); const cropY = Math.min(rect.y1, rect.y2);
    const cropW = Math.abs(rect.x2 - rect.x1) + 1; const cropH = Math.abs(rect.y2 - rect.y1) + 1;
    if (cropW >= 2 && cropH >= 2) {
      const store = useProjectStore.getState(); const oldCenterX = s.canvasWidth / 2; const oldCenterY = s.canvasHeight / 2;
      const newCenterOffsetX = cropX + cropW / 2 - oldCenterX; const newCenterOffsetY = cropY + cropH / 2 - oldCenterY;
      store.performBatch('裁剪画布', () => {
        // Part 是纯精灵数据，无位置偏移；裁剪画布不再移动 Part
        for (const traj of store.trajectories) for (const pt of traj.points) store.updateTrajectoryPoint(traj.partId, pt.frame, { x: pt.x - newCenterOffsetX, y: pt.y - newCenterOffsetY });
        store.setCanvasSize(cropW, cropH);
      });
    }
    s.cropStartRef.current = null; s.cropRectRef.current = null;
  },
};

// ---------------------------------------------------------------------------
// Lasso Tool Handler
// ---------------------------------------------------------------------------

export const lassoHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    s.isDrawingRef.current = true; s.markDirty(); s.selectionMaskRef.current.clear(); s.lassoPathRef.current = [{ x: px, y: py }]; s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current) return;
    if (s.lastPixelRef.current) { for (const point of getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)) s.lassoPathRef.current.push({ x: point.x, y: point.y }); }
    else s.lassoPathRef.current.push({ x: px, y: py });
    s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseUp(s) {
    if (!s.isDrawingRef.current || s.lassoPathRef.current.length <= 2) return;
    const path = s.lassoPathRef.current; path.push({ ...path[0] });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of path) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (pointInPolygon(x, y, path)) s.selectionMaskRef.current.add(`${x},${y}`);
    s.lassoPathRef.current = [];
  },
};

// ---------------------------------------------------------------------------
// Magic Wand Handler
// ---------------------------------------------------------------------------

export const magicWandHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const shiftHeld = e.shiftKey; const ctrlHeld = e.ctrlKey || e.metaKey;
    if (!shiftHeld && !ctrlHeld) s.selectionMaskRef.current.clear();
    const offsetX = s.canvasWidth / 2; const offsetY = s.canvasHeight / 2;
    const sortedParts = [...s.parts];
    let targetColor: string | null = null; let targetPart: import('@/lib/unified-types').Sprite | null = null;
    for (const part of sortedParts) {
      const local = s.canvasToPartLocal(px, py, part);
      if (local && part.data[local.ly]?.[local.lx] !== null) { targetColor = part.data[local.ly][local.lx]; targetPart = part; break; }
    }
    if (targetColor && targetPart) {
      const local = s.canvasToPartLocal(px, py, targetPart);
      if (!local) return;
      const visited = new Set<string>(); const queue: { lx: number; ly: number }[] = [local]; visited.add(`${local.lx},${local.ly}`);
      const tR = parseInt(targetColor.slice(1, 3), 16); const tG = parseInt(targetColor.slice(3, 5), 16); const tB = parseInt(targetColor.slice(5, 7), 16);
      const pivotX = spritePivotX(targetPart); const pivotY = spritePivotY(targetPart);
      while (queue.length > 0) {
        const { lx, ly } = queue.shift()!;
        const canvasX = (offsetX - pivotX) + lx;
        const canvasY = (offsetY - pivotY) + ly;
        const maskKey = `${canvasX},${canvasY}`;
        if (ctrlHeld) s.selectionMaskRef.current.delete(maskKey); else s.selectionMaskRef.current.add(maskKey);
        for (const n of [{ lx: lx - 1, ly }, { lx: lx + 1, ly }, { lx, ly: ly - 1 }, { lx, ly: ly + 1 }]) {
          if (n.lx < 0 || n.lx >= targetPart.width || n.ly < 0 || n.ly >= targetPart.height) continue;
          const nKey = `${n.lx},${n.ly}`; if (visited.has(nKey)) continue; visited.add(nKey);
          const nColor = targetPart.data[n.ly]?.[n.lx]; if (nColor === null) continue;
          const nR = parseInt(nColor.slice(1, 3), 16); const nG = parseInt(nColor.slice(3, 5), 16); const nB = parseInt(nColor.slice(5, 7), 16);
          if (Math.abs(tR - nR) + Math.abs(tG - nG) + Math.abs(tB - nB) <= s.magicWandTolerance * 3) queue.push(n);
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Smart Select (SAM) Handler
// ---------------------------------------------------------------------------

export const smartSelectHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    const editor = s.editorStore.getState(); const { samState } = editor;
    if (samState.status === 'idle') { editor.initSAMModel(samState.model); return; }
    if (samState.status === 'ready') {
      if (!samState.currentMask) {
        try {
          const pst = useProjectStore.getState();
          const samCanvas = renderUnifiedToCanvas(
            s.canvasWidth, s.canvasHeight,
            Object.values(pst.sprites), s.keyframes, currentFrame, s.backgroundColor,
            s.effectTracks, undefined, undefined, false, 0.5,
            undefined, undefined, undefined, 'low',
            s.globalModifiers, undefined,
            s.frameRate,
            pst.unifiedCharacters,
          );
          if (s.canvasWidth > 0 && s.canvasHeight > 0) {
            editor.setSAMImage(samCanvas).then(() => { editor.samSegmentAtPoint(px / s.canvasWidth, py / s.canvasHeight); });
          }
        } catch (err) { console.error('[SAM] Failed to encode image:', err); }
        return;
      }
      editor.samSegmentAtPoint(px / s.canvasWidth, py / s.canvasHeight);
    }
  },
};

// ---------------------------------------------------------------------------
// Inpaint Tool Handler
// ---------------------------------------------------------------------------

export const inpaintHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    const editor = s.editorStore.getState(); const { samState } = editor;
    if (samState.currentMask && s.selectedPart) { editor.applyInpaint(s.selectedPart.id!); }
    else if (s.selectedPart) {
      const selPart = s.selectedPart;
      const offsetX = s.canvasWidth / 2; const offsetY = s.canvasHeight / 2;
      const lx = px - (offsetX - spritePivotX(selPart) + 0);
      const ly = py - (offsetY - spritePivotY(selPart) + 0);
      const radius = editor.inpaintRadius;
      const mask = new Set<string>();
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) { const mx = lx + dx; const my = ly + dy; if (mx >= 0 && mx < selPart.width && my >= 0 && my < selPart.height) mask.add(`${mx},${my}`); }
      }
      if (mask.size > 0) {
        const store = useProjectStore.getState();
        const currentKf = store.keyframes.find(k => k.partId === selPart.id && k.frame === currentFrame);
        const basePixels = currentKf?.correctionMask ?? selPart.data;
        const inpainted = inpaintPixels(basePixels, mask, radius);
        if (currentKf?.correctionMask) store.setCorrection(currentKf.id, inpainted);
        else s.setPartPixels(selPart.id!, inpainted);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Brush / Eraser Handler
// ---------------------------------------------------------------------------

export const brushEraserHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    useProjectStore.getState().beginDrag('画笔绘制');
    s.isDrawingRef.current = true; s.markDirty();
    s.lastDrawnPixelsRef.current.clear();
    const color = s.tool === 'eraser' ? null : s.brushColor;

    // Correction mode
    if (s.editMode === 'correction' && s.selectedPartId && s.selectedPart) {
      const selPart = s.selectedPart;
      const store = useProjectStore.getState();
      let currentKf = store.keyframes.find(k => k.partId === s.selectedPartId && k.frame === currentFrame);
      if (!currentKf) currentKf = store.addKeyframe(s.selectedPartId!, currentFrame);
      if (currentKf) {
        let pixelEditMod = currentKf.modifiers.find(m => m.type === 'pixel_edit' && m.enabled);
        let modId = pixelEditMod?.id;
        if (!modId) modId = store.createPixelEditModifier(currentKf.id);
        const cmdId = crypto.randomUUID();
        const { offsetX: txOff2, offsetY: tyOff2 } = s.getInterpolatedTranslateOffset(selPart.id!, currentFrame);
        const local2 = s.canvasToPartLocal(px, py, selPart, txOff2, tyOff2);
        const startPt = local2 ? { x: local2.lx, y: local2.ly } : { x: px, y: py };
        s.pixelEditCommandRef.current = { commandId: cmdId, modifierId: modId, keyframeId: currentKf.id, points: [startPt] };
        s.lastPixelRef.current = { x: px, y: py }; return;
      }
    }

    // Normal mode fallback
    if (s.editMode === 'normal') {
      if (s.selectedPartId && s.selectedPart) {
        const selPart = s.selectedPart;
        const editorState = s.editorStore.getState(); editorState.enterSpriteEditMode(s.selectedPartId!);
        const offsetX = Math.floor((s.canvasWidth - selPart.width) / 2);
        const offsetY = Math.floor((s.canvasHeight - selPart.height) / 2);
        const localX = px - offsetX; const localY = py - offsetY;
        if (localX >= 0 && localX < selPart.width && localY >= 0 && localY < selPart.height) {
          const halfBrush = Math.floor(s.brushSize / 2);
          const newPixels: import('@/lib/types').PixelGrid = selPart.data.map((row) => [...row]);
          for (let dy = -halfBrush; dy < s.brushSize - halfBrush; dy++) for (let dx = -halfBrush; dx < s.brushSize - halfBrush; dx++) {
            const tx = localX + dx; const ty = localY + dy;
            if (tx >= 0 && tx < selPart.width && ty >= 0 && ty < selPart.height) newPixels[ty][tx] = color;
          }
          s.setPartPixels(selPart.id!, newPixels);
        }
        s.lastPixelRef.current = { x: px, y: py }; return;
      }
      return;
    }

    // part_edit mode
    {
      const projectStore = useProjectStore.getState();
      const editorState = s.editorStore.getState();
      if (editorState.spriteEditStartFrame !== undefined && editorState.spriteEditStartFrame !== projectStore.currentFrame) {
        const partId = editorState.spriteEditSpriteId!;
        const prevFrame = editorState.spriteEditStartFrame;
        const existingPkf = projectStore.getKeyframeAtFrame(partId, prevFrame);
        const mods = editorState.spriteEditModifiers.map(m => ({
          ...m,
          params: {
            ...m.params,
            ...(m.params.brushCommands ? { brushCommands: JSON.parse(JSON.stringify(m.params.brushCommands)) } : {}),
          },
        }));
        // Part 不再有 editModifiers keyframe，直接使用当前编辑的 modifiers
        const resolvedMods = editorState.spriteEditModifiers;
        s.editorStore.getState().setPartEditModifiers(resolvedMods.map(m => ({
          ...m,
          params: {
            ...m.params,
            ...(m.params.brushCommands ? { brushCommands: JSON.parse(JSON.stringify(m.params.brushCommands)) } : {}),
          },
        })));
        s.editorStore.setState({ spriteEditStartFrame: projectStore.currentFrame });
      }
      const currentPartEditMods = s.editorStore.getState().spriteEditModifiers;
      const lastMod = currentPartEditMods[currentPartEditMods.length - 1];
      let modId: string | undefined = (lastMod?.type === 'pixel_edit' && lastMod?.enabled) ? lastMod.id : undefined;
      if (!modId) modId = editorState.addPartEditModifier('pixel_edit');
      if (modId && s.selectedPart) {
        const selPart = s.selectedPart;
        const cmdId = crypto.randomUUID();
        const offsetX = Math.floor((s.canvasWidth - selPart.width) / 2);
        const offsetY = Math.floor((s.canvasHeight - selPart.height) / 2);
        const startPt = { x: px - offsetX, y: py - offsetY };
        s.spriteEditBrushCmdRef.current = { commandId: cmdId, modifierId: modId, points: [startPt] };
      }
    }
    s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseMove(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    if (!s.isDrawingRef.current || !s.selectedPart) return;
    const selPart = s.selectedPart;
    const color = s.tool === 'eraser' ? null : s.brushColor;
    if (s.editMode === 'correction' && s.pixelEditCommandRef.current && selPart) {
      const { offsetX: txOff3, offsetY: tyOff3 } = s.getInterpolatedTranslateOffset(selPart.id!, currentFrame);
      const local3 = s.canvasToPartLocal(px, py, selPart, txOff3, tyOff3);
      if (local3) s.pixelEditCommandRef.current.points.push({ x: local3.lx, y: local3.ly });
      s.lastPixelRef.current = { x: px, y: py }; return;
    }
    if (s.editMode === 'sprite_edit' && s.spriteEditBrushCmdRef.current && selPart) {
      const offsetX = Math.floor((s.canvasWidth - selPart.width) / 2); const offsetY = Math.floor((s.canvasHeight - selPart.height) / 2);
      const localX = px - offsetX; const localY = py - offsetY;
      if (s.lastPixelRef.current) { const lastOffsetX = Math.floor((s.canvasWidth - selPart.width) / 2); const lastOffsetY = Math.floor((s.canvasHeight - selPart.height) / 2); for (const pt of getLinePixels(s.lastPixelRef.current.x - lastOffsetX, s.lastPixelRef.current.y - lastOffsetY, localX, localY)) s.spriteEditBrushCmdRef.current.points.push({ x: pt.x, y: pt.y }); }
      else s.spriteEditBrushCmdRef.current.points.push({ x: localX, y: localY });
      s.lastPixelRef.current = { x: px, y: py }; return;
    }
    if (s.lastPixelRef.current) {
      for (let i = 0; i < getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py).length; i++) {
        const point = getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)[i];
        const key = `${point.x},${point.y}`;
        if (!s.lastDrawnPixelsRef.current.has(key)) { s.lastDrawnPixelsRef.current.add(key); s.applyBrush(point.x, point.y, color, i); }
      }
    } else { const key = `${px},${py}`; if (!s.lastDrawnPixelsRef.current.has(key)) { s.lastDrawnPixelsRef.current.add(key); s.applyBrush(px, py, color, 0); } }
    s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseUp(s) {
    // PixelEdit commit
    if (s.pixelEditCommandRef.current) {
      const { commandId, modifierId, keyframeId, points } = s.pixelEditCommandRef.current;
      if (points.length > 0) {
        const cmd: BrushCommand = { id: commandId, type: s.tool === 'eraser' ? 'erase' : 'draw', color: s.brushColor, size: s.brushSize, points, blendMode: 'normal', brushStyle: s.brushStyle !== 'solid' ? s.brushStyle : undefined, brushStyleParams: s.brushStyle !== 'solid' ? s.brushStyleParams : undefined, ...(s.compositingMode && (s.styleAspects.length > 0 || s.strokeDrivers.length > 0) ? { styleAspects: s.styleAspects.filter(a => a.enabled), strokeDrivers: s.strokeDrivers.filter(d => d.enabled) } : {}) };
        useProjectStore.getState().addPixelEditCommand(keyframeId, modifierId, cmd);
      }
      s.pixelEditCommandRef.current = null;
    }

    // PartEdit PixelEdit commit
    if (s.spriteEditBrushCmdRef.current) {
      const { commandId, modifierId, points } = s.spriteEditBrushCmdRef.current;
      if (points.length > 0) {
        const cmd: BrushCommand = { id: commandId, type: s.tool === 'eraser' ? 'erase' : 'draw', color: s.brushColor, size: s.brushSize, points, blendMode: 'normal', brushStyle: s.brushStyle !== 'solid' ? s.brushStyle : undefined, brushStyleParams: s.brushStyle !== 'solid' ? s.brushStyleParams : undefined, ...(s.compositingMode && (s.styleAspects.length > 0 || s.strokeDrivers.length > 0) ? { styleAspects: s.styleAspects.filter(a => a.enabled), strokeDrivers: s.strokeDrivers.filter(d => d.enabled) } : {}) };
        const updatedMods = s.editorStore.getState().spriteEditModifiers.map(m => { if (m.id !== modifierId) return m; const existingCommands: BrushCommand[] = (m.params.brushCommands as BrushCommand[]) || []; return { ...m, params: { ...m.params, brushCommands: [...existingCommands, cmd] } } as ModifierInstance; });
        s.editorStore.getState().setPartEditModifiers(updatedMods);
      }
      s.spriteEditBrushCmdRef.current = null;
    }
  },
};

// ---------------------------------------------------------------------------
// Stroke Tool Handler (motion_blur_brush, glow_brush, etc.)
// ---------------------------------------------------------------------------

export const strokeToolHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    s.isDrawingRef.current = true; s.markDirty(); s.currentStrokePointsRef.current = [{ x: px, y: py }]; s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current) return;
    if (s.lastPixelRef.current) { for (const point of getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)) s.currentStrokePointsRef.current.push({ x: point.x, y: point.y }); }
    else s.currentStrokePointsRef.current.push({ x: px, y: py });
    s.lastPixelRef.current = { x: px, y: py };
  },
};

// ---------------------------------------------------------------------------
// Bone Tool Handler
// ---------------------------------------------------------------------------

export const boneHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const hitResult = s.findBoneAtPixel(px, py);
    if (hitResult) {
      useProjectStore.getState().beginDrag('拖动骨骼'); s.isDrawingRef.current = true; s.markDirty();
      s.boneDragRef.current = { boneId: hitResult.bone.id, skeletonId: hitResult.skeletonId, endpoint: hitResult.endpoint, startX: px, startY: py, origHeadX: hitResult.bone.headX, origHeadY: hitResult.bone.headY, origTailX: hitResult.bone.tailX, origTailY: hitResult.bone.tailY, origTargetX: hitResult.targetX ?? 0, origTargetY: hitResult.targetY ?? 0 };
      useProjectStore.getState().setSelectedBoneId(hitResult.bone.id);
    } else useProjectStore.getState().setSelectedBoneId(null);
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current || !s.boneDragRef.current) return;
    const currentFrame = s.currentFrameRef.current;
    const drag = s.boneDragRef.current; const ddx = px - drag.startX; const ddy = py - drag.startY;
    if (drag.endpoint === 'head') useProjectStore.getState().updateBone(drag.skeletonId, drag.boneId, { headX: drag.origHeadX + ddx, headY: drag.origHeadY + ddy });
    else if (drag.endpoint === 'tail') useProjectStore.getState().updateBone(drag.skeletonId, drag.boneId, { tailX: drag.origTailX + ddx, tailY: drag.origTailY + ddy });
    else if (drag.endpoint === 'ik_target') useProjectStore.getState().addBonePose(drag.skeletonId, drag.boneId, currentFrame, 0, drag.origTargetX + ddx, drag.origTargetY + ddy);
  },
};

// ---------------------------------------------------------------------------
// IK Tool Handler
// ---------------------------------------------------------------------------

export const ikHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const hitResult = s.findBoneAtPixel(px, py);
    if (hitResult && hitResult.endpoint === 'ik_target') {
      useProjectStore.getState().beginDrag('IK拖动'); s.isDrawingRef.current = true; s.markDirty();
      s.boneDragRef.current = { boneId: hitResult.bone.id, skeletonId: hitResult.skeletonId, endpoint: 'ik_target', startX: px, startY: py, origHeadX: hitResult.bone.headX, origHeadY: hitResult.bone.headY, origTailX: hitResult.bone.tailX, origTailY: hitResult.bone.tailY, origTargetX: hitResult.targetX ?? 0, origTargetY: hitResult.targetY ?? 0 };
      useProjectStore.getState().setSelectedBoneId(hitResult.bone.id);
    } else if (hitResult) useProjectStore.getState().setSelectedBoneId(hitResult.bone.id);
    else useProjectStore.getState().setSelectedBoneId(null);
  },

  // IK shares the same drag logic as bone
  onMouseMove: boneHandler.onMouseMove!,
};

// ---------------------------------------------------------------------------
// Weight Paint Handler
// ---------------------------------------------------------------------------

export const weightPaintHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    useProjectStore.getState().beginDrag('权重绘制'); s.isDrawingRef.current = true; s.markDirty(); s.applyWeightPaint(px, py); s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current) return;
    if (s.lastPixelRef.current) { for (const point of getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)) s.applyWeightPaint(point.x, point.y); }
    else s.applyWeightPaint(px, py);
    s.lastPixelRef.current = { x: px, y: py };
  },
};

// ---------------------------------------------------------------------------
// Dispatch: getToolHandler
// ---------------------------------------------------------------------------

export function getToolHandler(
  tool: string,
  isPuppetMode: boolean,
  isPartEdit: boolean = false,
): ToolHandler | null {
  // Part-edit mode: pixel tools edit the part directly even inside puppet workspace
  // (puppetHandler would otherwise swallow brush/eraser/fill events)
  if (isPartEdit) {
    if (tool === 'brush' || tool === 'eraser') return brushEraserHandler;
    if (tool === 'fill') return fillToolHandler;
    if (tool === 'eyedropper') return eyedropperHandler;
  }

  // Puppet mode takes priority
  if (isPuppetMode || tool === 'puppet') return puppetHandler;

  // Standard tool dispatch
  switch (tool) {
    case 'move': return moveToolHandler;
    case 'select': return selectToolHandler;
    case 'eyedropper': return eyedropperHandler;
    case 'fill': return fillToolHandler;
    case 'trajectory': return trajectoryHandler;
    case 'crop': return cropHandler;
    case 'lasso': return lassoHandler;
    case 'magic_wand': return magicWandHandler;
    case 'smart_select': return smartSelectHandler;
    case 'inpaint': return inpaintHandler;
    case 'brush':
    case 'eraser': return brushEraserHandler;
    default:
      // Stroke tools (motion_blur_brush, glow_brush, particle_brush, afterimage_brush)
      if (isStrokeToolCheck(tool)) return strokeToolHandler;
      return null;
  }
}
