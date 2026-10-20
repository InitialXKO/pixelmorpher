/**
 * tool-handlers.ts — Strategy Pattern handlers for each pixel-editor tool.
 * Extracted from use-canvas-interaction.ts to reduce cyclomatic complexity.
 * Each handler encapsulates the mouse/keyboard logic for a specific tool.
 */

import type { MouseEvent as ReactMouseEvent } from 'react';
import { useProjectStore } from '@/lib/store';
import { useEditorStore } from '@/lib/store';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { inpaintPixels, samMaskToSelectionMask } from '@/lib/inpainting';
import { floodFill } from '@/lib/engine';
import { renderUnifiedToCanvas, renderSpriteEditUnified } from '@/lib/unified-render';
import { resolveNodeSpriteId } from '@/lib/unified-render';
import { socketOffsetTo3D, computeWorldTransforms } from '@/lib/unified-render';
import { resolvePuppetNodeSprite } from '@/lib/engine/puppet-utils';
import { interpolateNodeKeyframes } from '@/lib/engine/render-helpers/puppet-keyframe-interpolation';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import { suspendIKChain, resumeIKChain, suspendedIKChains } from '@/lib/ik-drag-state';
import { computeIKChainTip, getIKChainJointIds } from '@/lib/ik-tip';
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
import { subToPx, pxToSub, mapDragTo3D, rotatePseudo3D, inverseRotateInViewPlane, ikTargetMirror, type SubPixel } from '@/lib/unified-types';
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
    let kf = s.keyframes.find(k => k.spriteId === selPart.id && k.frame === currentFrame);
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
export function writePuppetPoseKeyframe(
  skeletonId: string,
  clipId: string,
  nodeId: string,
  frame: number,
  values: { angle: number; stretch: number; x: number; y: number },
  variantIndex: number,
) {
  const store = useProjectStore.getState();
  const character = store.unifiedCharacters[skeletonId];
  if (!character) return;
  const node = character.nodes[nodeId];
  if (!node) return;

  // 直接写 node.tracks（渲染器从这里读）
  const setTrack = (trackName: 'angle' | 'x' | 'y' | 'stretch', value: number) => {
    const track = node.tracks[trackName] ?? { keyframes: [], interpolation: 'linear' as const };
    const idx = track.keyframes.findIndex(k => k.frame === frame);
    const newKeyframes = idx >= 0
      ? track.keyframes.map((k, i) => i === idx ? { ...k, value } : k)
      : [...track.keyframes, { frame, value }].sort((a, b) => a.frame - b.frame);
    return { ...track, keyframes: newKeyframes };
  };

  store.updateUnifiedNode(skeletonId, nodeId, {
    tracks: {
      ...node.tracks,
      angle: setTrack('angle', values.angle),
      x: setTrack('x', values.x),
      y: setTrack('y', values.y),
      stretch: setTrack('stretch', values.stretch),
    },
  });
}

/** IK 目标手柄仅做可视化，不可拖拽（拖精灵本身，目标自动跟随） */
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
    // 如果拖的是 IK 链的末端，挂起该链（拖拽期间用 FK，松手后重算目标）
    const ch = project.unifiedCharacters[character.id];
    if (ch) {
      for (const chain of ch.ikChains ?? []) {
        if (chain.enabled && chain.endNodeId === node.id) {
          suspendIKChain(chain.id);
        }
      }
    }
    // 同步到操控会话（PerformPanel 肢体列表高亮用）
    try { usePuppetSessionStore.setState({ performNodeId: node.id }); } catch { /* noop */ }

    // 预计算插值（Ctrl/Alt 路径也需要世界角度）
    const tmpClip = clipId ? project.animationClips.find((c) => c.id === clipId) : null;
    const tmpFrame = project.currentFrame;
    const tmpChar = useProjectStore.getState().unifiedCharacters[character.id];
    const tmpIvMap = tmpChar ? interpolateNodeKeyframes(tmpChar, tmpFrame) : new Map();

    // 计算指定节点的世界角度（从根累加）
    // 世界角度走主渲染共同代码（尊重 inheritRotation；此前手工沿链累加不查该标志，与渲染端口径微差）
    const worldTransformsForAngle = computeWorldTransforms(character, tmpFrame, s.canvasWidth, s.canvasHeight);
    const computeWorldAngle = (targetNode: typeof node): number => {
      return worldTransformsForAngle.get(targetNode.id)?.worldAngle ?? 0;
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
        origOffsetZ: 0,
        moveTargetNodeId: node.id,
        mode: 'pivot' as const,
        pivotWorldX: 0,
        pivotWorldY: 0,
        startMouseAngle: 0,
        dragStarted: false,
        // pivot 移动专用 (spriteId 存于 pivotSpriteId 字段；plug 为 subpixel，需转像素)
        pivotSpriteId: spriteId ?? '',
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
      // 3D socket（带 offset3D）：拖拽起点取 offset3D 在当前视角下的 2D 投影（x2d = x·cosθ + z·sinθ），
      // 否则起点读 basePosition(=0) 会跳
      const rootForDir = character.nodes[character.rootNodeId];
      const dragViewDir = (rootForDir?.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
      const dragTheta = (((dragViewDir + 2) % 8) * Math.PI) / 4;
      const origSocketPosX = socket.offset3D
        ? Math.round(socket.offset3D.x * Math.cos(dragTheta) + socket.offset3D.z * Math.sin(dragTheta))
        : socket.basePosition.x;
      const origSocketPosY = socket.offset3D ? socket.offset3D.y : socket.basePosition.y;
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
        origOffsetZ: 0,
        moveTargetNodeId: node.id,
        mode: 'socket' as const,
        pivotWorldX: 0,
        pivotWorldY: 0,
        startMouseAngle: 0,
        dragStarted: false,
        // socket 移动专用
        socketId: socket.id,
        parentNodeId: parentNode.id,
        origSocketX: origSocketPosX,
        origSocketY: origSocketPosY,
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
      origOffsetZ: moveTarget.transform.z ?? 0,
      moveTargetNodeId: moveTarget.id,
      mode: dragMode,
      pivotWorldX,
      pivotWorldY,
      startMouseAngle,
      dragStarted: false,
      parentWorldAngle,
      // 伪3D模式：存储子节点原始本地偏移（实时烘焙用，取当前帧插值）
      ...(s.editorStore.getState().tool === 'pseudo3d_rotate' && dragMode === 'rotate'
        ? {
            origChildOffsets: (() => {
              // 递归收集整棵子树的原始本地偏移（伪3D烘焙需传播到孙节点）
              const result: Record<string, { x: number; y: number; z: number }> = {};
              const collect = (nodeId: string) => {
                const n = character.nodes[nodeId];
                for (const cid of n?.children ?? []) {
                  const child = character.nodes[cid];
                  const childIv = ivMap.get(cid);
                  result[cid] = {
                    x: childIv?.x ?? child?.transform.x ?? 0,
                    y: childIv?.y ?? child?.transform.y ?? 0,
                    z: child?.transform.z ?? 0,
                  };
                  collect(cid);
                }
              };
              collect(node.id);
              return result;
            })(),
          }
        : {}),
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
    // 3D 视图朝向：用根节点的 variantIndex（全场景统一相机方向，非单节点精灵方向）
    const rootNode = character.nodes[character.rootNodeId];
    const viewDir = (rootNode?.transform.variantIndex ?? variantIndex) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    const clip = store.animationClips.find((c) => c.id === drag.clipId);
    const ivMap = interpolateNodeKeyframes(character, frame);

    if (drag.mode === 'rotate') {
      const currentMouseAngle = Math.atan2(py - drag.pivotWorldY, px - drag.pivotWorldX);
      const angleDelta = (currentMouseAngle - drag.startMouseAngle) * 180 / Math.PI;
      const activeTool = s.editorStore.getState().tool;
      const childIds = drag.origChildOffsets ? Object.keys(drag.origChildOffsets) : [];
      if (activeTool === 'pseudo3d_rotate' && childIds.length > 0) {
        // 伪3D实时烘焙：父角度正常写入，整棵子树递归逆解保证所见即所得
        const newParentAngle = drag.origAngle + Math.round(angleDelta);
        writePuppetPoseKeyframe(drag.skeletonId, drag.clipId, drag.nodeId, frame, {
          angle: newParentAngle,
          stretch: drag.origStretch,
          x: drag.origOffsetX,
          y: drag.origOffsetY,
        }, variantIndex);
        // 递归烘焙：parentNodeId 的子节点用父节点**世界角度**做伪3D→逆解
        // （旧标志位系统渲染端用 parentWorld.worldAngle；传局部角度时，中间节点局部角为 0 的边会退化为普通旋转，伪3D传不到孙节点）
        const bakeLevel = (parentNodeId: string, parentWorldAngle: number) => {
          const parentNode = character.nodes[parentNodeId];
          if (!parentNode) return;
          for (const childId of parentNode.children ?? []) {
            const orig = drag.origChildOffsets![childId];
            const childNode = character.nodes[childId];
            if (!orig || !childNode) continue;
            // socket 3D 偏移（与渲染器一致）
            let sockX3D_px = 0, sockY3D_px = 0, sockZ3D_px = 0;
            if (childNode.attachment?.type === 'socket' && childNode.attachment.parentSocketId) {
              const socket = parentNode.sockets.find((s) => s.id === childNode.attachment!.parentSocketId);
              if (socket) {
                // socket 3D 偏移：走共同口径 socketOffsetTo3D（与渲染器同一实现）
                const s3 = socketOffsetTo3D(socket, viewDir);
                sockX3D_px = s3.x;
                sockY3D_px = s3.y;
                sockZ3D_px = s3.z;
              }
            } else if (childNode.attachment?.type === 'fixed') {
              const fo = childNode.attachment.fixedOffset ?? { x: 0, y: 0 };
              sockX3D_px = subToPx(fo.x);
              sockY3D_px = subToPx(fo.y);
            }
            const childIvEarly = ivMap.get(childId);
            const childStretch = childIvEarly?.stretch ?? childNode.transform.stretch ?? 1;
            const totalX = sockX3D_px + subToPx(orig.x);
            const totalY = sockY3D_px + subToPx(orig.y) * childStretch;
            const totalZ = sockZ3D_px + subToPx(orig.z);
            const rotated = rotatePseudo3D(totalX, totalY, totalZ, parentWorldAngle, viewDir);
            const newTotal = inverseRotateInViewPlane(rotated.x, rotated.y, rotated.z, parentWorldAngle, viewDir);
            const newChildX = pxToSub(newTotal.x - sockX3D_px);
            const newChildY = pxToSub(newTotal.y - sockY3D_px);
            const newChildZ = pxToSub(newTotal.z - sockZ3D_px);
            const childIv = childIvEarly;
            const childAngle = childIv?.angle ?? childNode.transform.angle ?? 0;
            const childVariantIndex = (childNode.transform.variantIndex ?? variantIndex) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
            writePuppetPoseKeyframe(drag.skeletonId, drag.clipId, childId, frame, {
              angle: childAngle,
              stretch: childIv?.stretch ?? childNode.transform.stretch,
              x: Math.round(newChildX),
              y: Math.round(newChildY),
            }, childVariantIndex);
            store.updateUnifiedNode(drag.characterId ?? drag.skeletonId, childId, {
              transform: { ...childNode.transform, z: Math.round(newChildZ) },
            });
            // 递归：子节点的世界角度 = 父世界角度 + 子局部角度（子局部角度本轮不变），往下传
            // 注意：仅当 inheritRotation !== false 时累积（与渲染端 computeWorldTransforms:668-670 一致）
            if ((childNode.children ?? []).length > 0) {
              const childWorldAngle = childNode.attachment.inheritRotation !== false
                ? parentWorldAngle + childAngle
                : childAngle;
              bakeLevel(childId, childWorldAngle);
            }
          }
        };
        // 被拖节点的祖先链世界角度（拖拽期间祖先角度不变）；第一层的父世界角度 = 祖先世界角 + 被拖节点新局部角
        // 祖先世界角度走主渲染共同代码（同 computeWorldAngle 的修法）
        const ancestorsWorldAngle = dragNode?.parentId
          ? (computeWorldTransforms(character, frame, s.canvasWidth, s.canvasHeight).get(dragNode.parentId)?.worldAngle ?? 0)
          : 0;
        bakeLevel(drag.nodeId, ancestorsWorldAngle + newParentAngle);
      } else {
        const newAngle = drag.origAngle + Math.round(angleDelta);
        writePuppetPoseKeyframe(drag.skeletonId, drag.clipId, drag.nodeId, frame, {
          angle: newAngle,
          stretch: drag.origStretch,
          x: drag.origOffsetX,
          y: drag.origOffsetY,
        }, variantIndex);
      }
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
        // 当前视图朝向（根节点方向）：3D 角色 socket 有 8 方向 offsets，需同步更新
        const rootN = character.nodes[character.rootNodeId];
        const viewDir = (rootN?.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
        const moveTheta = (((viewDir + 2) % 8) * Math.PI) / 4;
        const newSockets = parentNode.sockets.map((s) => {
          if (s.id !== drag.socketId) return s;
          if (s.offset3D) {
            // 3D socket：视角平面内的 2D 新位置写回 offset3D；
            // 垂直于视角的深度分量 perp 在当前视角不可见、不可拖，原样保留
            // （x3 = u·cosθ − perp·sinθ，z3 = u·sinθ + perp·cosθ，与正向投影互逆）
            const perp = -s.offset3D.x * Math.sin(moveTheta) + s.offset3D.z * Math.cos(moveTheta);
            return {
              ...s,
              offset3D: {
                x: Math.round(newSocketX * Math.cos(moveTheta) - perp * Math.sin(moveTheta)),
                y: newSocketY,
                z: Math.round(newSocketX * Math.sin(moveTheta) + perp * Math.cos(moveTheta)),
              },
            };
          }
          return {
            ...s,
            basePosition: { x: newSocketX, y: newSocketY },
            directionOffsets: { ...s.directionOffsets, [viewDir]: { x: newSocketX, y: newSocketY } },
          };
        });
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
      const sprite = useProjectStore.getState().sprites[drag.pivotSpriteId ?? ''];
      if (sprite) {
        const newPivotX = Math.round((drag.origPivotX ?? 0) + localDx);
        const newPivotY = Math.round((drag.origPivotY ?? 0) + localDy);
        // 钳制到精灵范围内
        const clampedX = Math.max(0, Math.min(sprite.width - 1, newPivotX));
        const clampedY = Math.max(0, Math.min(sprite.height - 1, newPivotY));
        store.updateSprite(drag.pivotSpriteId!, {
          plug: { x: pxToSub(clampedX), y: pxToSub(clampedY) },
        });
      }
    } else {
      // move：移动目标节点的 offset（offset 在父节点局部空间，需逆旋转鼠标增量）
      // 3D：按视图朝向（根节点方向）将 2D 增量映射到 3D（南向改 x/y，东向改 z/y）
      const ddx = px - drag.startX;
      const ddy = py - drag.startY;
      const angleRad = ((drag.parentWorldAngle ?? 0) * Math.PI) / 180;
      const localDx = ddx * Math.cos(-angleRad) - ddy * Math.sin(-angleRad);
      const localDy = ddx * Math.sin(-angleRad) + ddy * Math.cos(-angleRad);
      const d3 = mapDragTo3D(pxToSub(localDx) as SubPixel, pxToSub(localDy) as SubPixel, viewDir);
      const targetNode = character.nodes[drag.moveTargetNodeId ?? drag.nodeId];
      const newOffsetX = Math.round(drag.origOffsetX + d3.dx3);
      const newOffsetY = Math.round(drag.origOffsetY + d3.dy3);
      const newOffsetZ = Math.round((drag.origOffsetZ ?? 0) + d3.dz3);
      const targetNodeId = drag.moveTargetNodeId ?? drag.nodeId;
      writePuppetPoseKeyframe(drag.skeletonId, drag.clipId, targetNodeId, frame, {
        angle: drag.origAngle,
        stretch: drag.origStretch,
        x: newOffsetX,
        y: newOffsetY,
      }, variantIndex);
      // 3D z 暂直接写 base（无 z 轨道）
      if (targetNode) targetNode.transform.z = newOffsetZ as SubPixel;
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

    const applyNodePose = (nodeId: string, patch: Partial<{ angle: number; x: number; y: number; z: number }>) => {
      const iv = ivMap.get(nodeId);
      const node = character!.nodes[nodeId];
      if (!node) return;
      writePuppetPoseKeyframe(character!.id, clipId, nodeId, frame, {
        angle: patch.angle ?? iv?.angle ?? node.transform.angle,
        stretch: iv?.stretch ?? node.transform.stretch,
        x: patch.x ?? iv?.x ?? node.transform.x,
        y: patch.y ?? iv?.y ?? node.transform.y,
      }, variantIndex);
      // 3D z 暂直接写 base transform（无 z 轨道）
      if (patch.z !== undefined) {
        node.transform.z = patch.z;
      }
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
      // 3D 映射：按视图朝向（根节点方向）将 2D 键盘增量映射到 3D
      const rootN = character.nodes[character.rootNodeId];
      const dir = (rootN?.transform.variantIndex ?? node.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
      const d3 = mapDragTo3D(dx as SubPixel, dy as SubPixel, dir);
      applyNodePose(targetId, {
        x: (iv?.x ?? node.transform.x) + d3.dx3,
        y: (iv?.y ?? node.transform.y) + d3.dy3,
        z: (node.transform.z ?? 0) + d3.dz3,
      });
    }
  },

  onMouseUp(s) {
    const project = useProjectStore.getState();
    // 恢复被挂起的 IK 链，目标点重算到新尖端位置
    if (suspendedIKChains.size > 0) {
      for (const chainId of Array.from(suspendedIKChains)) {
        // 找到这条链所属的角色
        for (const ch of Object.values(project.unifiedCharacters)) {
          if (!ch) continue;
          const chain = ch.ikChains?.find((c) => c.id === chainId);
          if (!chain) continue;
          const jointIds = getIKChainJointIds(ch, chain.rootNodeId, chain.endNodeId);
          if (jointIds.length >= 2) {
            const { tipX, tipY, tipZ, direction } = computeIKChainTip(ch, jointIds, chain.tipLength);
            // tip 是原点中心 3D：求解目标写 target3D；chain.target 写投影镜像（按链朝向投影 + 画布中心）
            project.updateUnifiedCharacter(ch.id, {
              ikChains: ch.ikChains!.map((c) =>
                c.id === chainId ? {
                  ...c,
                  target: ikTargetMirror({ x: tipX, y: tipY, z: tipZ }, direction, project.canvasWidth, project.canvasHeight),
                  target3D: { x: tipX, y: tipY, z: tipZ },
                } : c,
              ),
            });
          }
          resumeIKChain(chainId);
        }
      }
      s.markDirty();
    }
    const drag = s.puppetNodeDragRef.current;
    // Ctrl+点击（未拖动）：进入部件像素编辑
    // pivotSpriteId 存的是 spriteId；若为 part_<id> 格式则提取 id 进入精灵编辑
    if (drag && drag.mode === 'pivot' && !drag.dragStarted) {
      const pivotSpriteId = drag.pivotSpriteId ?? '';
      const extractedSpriteId = pivotSpriteId.startsWith('part_') ? pivotSpriteId.slice(5) : null;
      if (extractedSpriteId) {
        s.editorStore.getState().selectPart(extractedSpriteId);
        s.editorStore.getState().enterSpriteEditMode(extractedSpriteId);
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
// Landmark Annotation Handler（蒙皮转面手动特征点标注）
// ---------------------------------------------------------------------------
// 仅在 sprite_edit 模式有效：点击精灵设置当前目标特征点（左眼/右眼/鼻子/嘴）。
// 坐标存为相对值 0~1（方向无关）。

export const landmarkHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    if (s.editMode !== 'sprite_edit' || !s.selectedSpriteId || !s.selectedPart) return;
    const selPart = s.selectedPart;
    // sprite_edit 居中绘制约定（与 fillToolHandler 一致）
    const offsetX = Math.floor((s.canvasWidth - selPart.width) / 2);
    const offsetY = Math.floor((s.canvasHeight - selPart.height) / 2);
    const lx = px - offsetX;
    const ly = py - offsetY;
    // 越界不标注
    if (lx < 0 || ly < 0 || lx >= selPart.width || ly >= selPart.height) return;
    const nx = lx / selPart.width;
    const ny = ly / selPart.height;
    const target = s.editorStore.getState().landmarkTarget;
    const store = useProjectStore.getState();
    const existing = store.sprites[s.selectedSpriteId!]?.landmarks ?? {};
    store.updateSpriteLandmarks(s.selectedSpriteId!, {
      ...existing,
      [target]: { x: Math.min(1, Math.max(0, nx)), y: Math.min(1, Math.max(0, ny)) },
    });
  },
};

// ---------------------------------------------------------------------------
// Fill Tool Handler
// ---------------------------------------------------------------------------

export const fillToolHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    if (s.editMode === 'correction' && s.selectedSpriteId && s.selectedPart) {
      const selPart = s.selectedPart;
      const store = useProjectStore.getState();
      store.performBatch('填充', () => {
        let currentKf = store.keyframes.find(k => k.spriteId === s.selectedSpriteId && k.frame === currentFrame);
        if (!currentKf) currentKf = store.addKeyframe(s.selectedSpriteId!, currentFrame);
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
    if (s.editMode === 'sprite_edit' && s.selectedSpriteId && s.selectedPart) {
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
    if (s.editMode === 'normal' && s.selectedSpriteId) s.editorStore.getState().enterSpriteEditMode(s.selectedSpriteId);
    s.applyFill(px, py);
  },
};

// ---------------------------------------------------------------------------
// Trajectory Tool Handler
// ---------------------------------------------------------------------------

export const trajectoryHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    if (s.editMode === 'trajectory_edit' && s.selectedSpriteId) {
      const cpHit = s.findTrajectoryCpAtPixel(px, py);
      if (cpHit) {
        useProjectStore.getState().beginDrag('拖动轨迹控制点');
        s.isDrawingRef.current = true; s.markDirty();
        s.trajectoryCpDragRef.current = { spriteId: cpHit.spriteId, segmentIdx: cpHit.segmentIdx, cp: cpHit.cp, startX: px, startY: py, origCp1x: cpHit.cp1x, origCp1y: cpHit.cp1y, origCp2x: cpHit.cp2x, origCp2y: cpHit.cp2y };
        return;
      }
    }
    if (e.shiftKey && s.selectedSpriteId) { s.isDrawingRef.current = true; s.markDirty(); s.handDrawTrajectoryRef.current = [{ x: px, y: py }]; s.lastPixelRef.current = { x: px, y: py }; return; }
    s.isDrawingRef.current = true; s.markDirty();
    s.trajectoryPathRef.current = [{ x: px, y: py }]; s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current) return;
    if (s.trajectoryCpDragRef.current) {
      const drag = s.trajectoryCpDragRef.current; const ddx = px - drag.startX; const ddy = py - drag.startY;
      const traj = useProjectStore.getState().trajectories.find(t => t.spriteId === drag.spriteId);
      if (traj) { const pt = traj.points[drag.segmentIdx]; const nextPt = traj.points[drag.segmentIdx + 1]; if (pt && nextPt) { if (drag.cp === 'cp1') useProjectStore.getState().updateTrajectoryPoint(drag.spriteId, pt.frame, { cp1x: drag.origCp1x + ddx, cp1y: drag.origCp1y + ddy }); else useProjectStore.getState().updateTrajectoryPoint(drag.spriteId, nextPt.frame, { cp2x: drag.origCp2x + ddx, cp2y: drag.origCp2y + ddy }); } }
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
    if (s.isDrawingRef.current && s.handDrawTrajectoryRef.current.length > 2 && s.selectedSpriteId) {
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
        useProjectStore.getState().addTrajectoryPoint(s.selectedSpriteId, frame, snapX, snapY, 0);
        useProjectStore.getState().updateTrajectoryPoint(s.selectedSpriteId, frame, { cp1x, cp1y, cp2x, cp2y });
      }
      s.handDrawTrajectoryRef.current = [];
    } else if (s.handDrawTrajectoryRef.current.length > 0) s.handDrawTrajectoryRef.current = [];

    // Trajectory freehand path
    if (s.isDrawingRef.current && s.trajectoryPathRef.current.length >= 2 && s.selectedSpriteId) {
      const path = s.trajectoryPathRef.current; const totalFrames = useProjectStore.getState().totalFrames; const pathLength = path.length;
      const numSamples = Math.min(totalFrames, Math.max(2, Math.round(pathLength / 3)));
      const step = pathLength / numSamples;
      for (let i = 0; i < numSamples; i++) {
        const pathIndex = Math.min(Math.round(i * step), pathLength - 1); const point = path[pathIndex];
        const frame = Math.round((i / (numSamples - 1)) * (totalFrames - 1));
        const snapX = s.trajectorySnap ? Math.round(point.x) : point.x; const snapY = s.trajectorySnap ? Math.round(point.y) : point.y;
        useProjectStore.getState().addTrajectoryPoint(s.selectedSpriteId, frame, snapX, snapY, 0);
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
        for (const traj of store.trajectories) for (const pt of traj.points) store.updateTrajectoryPoint(traj.spriteId, pt.frame, { x: pt.x - newCenterOffsetX, y: pt.y - newCenterOffsetY });
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
// 选区工具的精灵编辑坐标换算
//
// 选区工具（lasso/magic_wand/smart_select）的使用场景是精灵像素编辑：点选工具时
// 自动进入 sprite_edit（见 Toolbar）。sprite_edit 下画布只居中绘制被编辑的精灵
// （见 renderSpriteEditUnified），选区 mask 存精灵局部坐标（"lx,ly"），Delete 键、
// inpaint、选区覆盖层都按局部坐标消费。
// ---------------------------------------------------------------------------

/** 画布坐标 → 当前编辑精灵的局部坐标（sprite_edit 居中绘制约定） */
function spriteEditCanvasToLocal(s: CanvasState, px: number, py: number): { lx: number; ly: number } | null {
  const sprite = s.selectedPart;
  if (!sprite) return null;
  const offX = Math.floor((s.canvasWidth - sprite.width) / 2);
  const offY = Math.floor((s.canvasHeight - sprite.height) / 2);
  const lx = Math.round(px - offX);
  const ly = Math.round(py - offY);
  if (lx < 0 || lx >= sprite.width || ly < 0 || ly >= sprite.height) return null;
  return { lx, ly };
}

/** 精灵编辑模式下精灵在画布上的绘制原点（左上角），供选区覆盖层把局部坐标映回画布 */
export function spriteEditCanvasOrigin(s: CanvasState): { x: number; y: number } {
  const sprite = s.selectedPart;
  if (!sprite) return { x: 0, y: 0 };
  return {
    x: Math.floor((s.canvasWidth - sprite.width) / 2),
    y: Math.floor((s.canvasHeight - sprite.height) / 2),
  };
}

/** SAM mask（画布坐标）→ 当前编辑精灵局部坐标，写入 selectionMaskRef */
function applySAMMaskToSpriteLocalSelection(s: CanvasState) {
  const editor = s.editorStore.getState();
  const { currentMask, maskShape } = editor.samState;
  const sprite = s.selectedPart;
  if (!currentMask || !maskShape || !sprite) return;
  const canvasMask = samMaskToSelectionMask(currentMask, maskShape, s.canvasWidth, s.canvasHeight);
  const local = new Set<string>();
  for (const key of canvasMask) {
    const comma = key.indexOf(',');
    const cx = Number(key.slice(0, comma));
    const cy = Number(key.slice(comma + 1));
    const pt = spriteEditCanvasToLocal(s, cx, cy);
    if (pt) local.add(`${pt.lx},${pt.ly}`);
  }
  s.selectionMaskRef.current = local;
  s.markDirty();
}

/** 把当前精灵编辑视图渲染到离屏 canvas（供 SAM 编码：所见即所分割） */
function renderSpriteEditViewToCanvas(s: CanvasState): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = s.canvasWidth;
  canvas.height = s.canvasHeight;
  const ctx = canvas.getContext('2d')!;
  renderSpriteEditUnified(
    ctx,
    s.selectedPart!,
    s.spriteEditModifiers ?? [],
    s.canvasWidth,
    s.canvasHeight,
    s.currentFrameRef.current,
  );
  return canvas;
}

// ---------------------------------------------------------------------------
// Smart Select (SAM) Handler
// ---------------------------------------------------------------------------

export const smartSelectHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    const editor = s.editorStore.getState(); const { samState } = editor;
    if (samState.status === 'idle') { editor.initSAMModel(samState.model); return; }
    if (samState.status === 'ready') {
      // 精灵编辑模式：SAM 编码当前精灵编辑视图（所见即所分割），分割后 mask
      // 换算到编辑精灵局部坐标写入选区（复用 inpaint 的 mask→局部换算思路）。
      const inSpriteEdit = s.editMode === 'sprite_edit' && s.selectedPart;
      const afterSegment = () => { if (inSpriteEdit) applySAMMaskToSpriteLocalSelection(s); };
      if (!samState.currentMask) {
        try {
          const pst = useProjectStore.getState();
          const samCanvas = inSpriteEdit
            ? renderSpriteEditViewToCanvas(s)
            : renderUnifiedToCanvas(
              s.canvasWidth, s.canvasHeight,
              Object.values(pst.sprites), s.keyframes, currentFrame, s.backgroundColor,
              s.effectTracks, undefined, undefined, false, 0.5,
              undefined, undefined, undefined, 'low',
              s.globalModifiers, undefined,
              s.frameRate,
              pst.unifiedCharacters,
            );
          if (s.canvasWidth > 0 && s.canvasHeight > 0) {
            editor.setSAMImage(samCanvas).then(() => {
              editor.samSegmentAtPoint(px / s.canvasWidth, py / s.canvasHeight).then(afterSegment);
            });
          }
        } catch (err) { console.error('[SAM] Failed to encode image:', err); }
        return;
      }
      editor.samSegmentAtPoint(px / s.canvasWidth, py / s.canvasHeight).then(afterSegment);
    }
  },
};

// ---------------------------------------------------------------------------
// Inpaint Tool Handler
// ---------------------------------------------------------------------------

export const inpaintHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    const editor = s.editorStore.getState();
    const { samState } = editor;
    // SAM 辅助 inpaint（新架构迁移：替代已删除的 applyInpaint——旧实现读不存在的 parts 必崩）。
    // SAM 选区存在时，用 inpaint 工具点一下即对选区做 Telea 填补；否则走下面的圆形半径逻辑。
    if (samState.currentMask && samState.maskShape && s.selectedPart) {
      const selPart = s.selectedPart;
      const offsetX = s.canvasWidth / 2;
      const offsetY = s.canvasHeight / 2;
      const canvasMask = samMaskToSelectionMask(
        samState.currentMask,
        samState.maskShape,
        s.canvasWidth,
        s.canvasHeight,
      );
      const pivotX = spritePivotX(selPart);
      const pivotY = spritePivotY(selPart);
      const spriteMask = new Set<string>();
      // sprite_edit 下精灵居中绘制，走局部坐标换算；旧模式沿用 pivot 居中的换算
      const inSpriteEdit = s.editMode === 'sprite_edit';
      for (const key of canvasMask) {
        const comma = key.indexOf(',');
        const cx = Number(key.slice(0, comma));
        const cy = Number(key.slice(comma + 1));
        let lx: number, ly: number;
        if (inSpriteEdit) {
          const local = spriteEditCanvasToLocal(s, cx, cy);
          if (!local) continue;
          lx = local.lx; ly = local.ly;
        } else {
          lx = Math.round(cx - (offsetX - pivotX));
          ly = Math.round(cy - (offsetY - pivotY));
        }
        if (lx >= 0 && lx < selPart.width && ly >= 0 && ly < selPart.height) {
          spriteMask.add(`${lx},${ly}`);
        }
      }
      if (spriteMask.size > 0) {
        const store = useProjectStore.getState();
        const currentKf = store.keyframes.find(k => k.spriteId === selPart.id && k.frame === currentFrame);
        const basePixels = currentKf?.correctionMask ?? selPart.data;
        const inpainted = inpaintPixels(basePixels, spriteMask, editor.inpaintRadius);
        if (currentKf?.correctionMask) store.setCorrection(currentKf.id, inpainted);
        else s.setPartPixels(selPart.id!, inpainted);
      }
      return;
    }
    if (s.selectedPart) {
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
        const currentKf = store.keyframes.find(k => k.spriteId === selPart.id && k.frame === currentFrame);
        const basePixels = currentKf?.correctionMask ?? selPart.data;
        const inpainted = inpaintPixels(basePixels, mask, radius);
        if (currentKf?.correctionMask) store.setCorrection(currentKf.id, inpainted);
        else s.setPartPixels(selPart.id!, inpainted);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Node-level Tool Handlers（新架构）
//
// 背景：2026-10-10「木偶唯一工作流」后 getToolHandler 恒返回 puppetHandler，
// 以下 12 个工具静默错配。Node 级实现让它们真正可用：
//   select/move/trajectory/lasso/magic_wand → 操作木偶节点
//   inpaint → 已迁移（62bc70b）
//   motion_blur/glow/particle/afterimage → strokeToolHandler（帧级 overlay，无需 Node 改造）
// ---------------------------------------------------------------------------

// ---- Node 级通用 helper ----

type UnifiedNode = import('@/lib/unified-types').Node;
type UnifiedCharacter = import('@/lib/unified-types').Character;

/** 选中的木偶节点及其角色（优先 selectedNodeId，回退 performNodeId） */
function getSelectedPuppetNode(): { node: UnifiedNode; character: UnifiedCharacter } | null {
  const project = useProjectStore.getState();
  const nodeId = project.selectedNodeId ?? usePuppetSessionStore.getState().performNodeId;
  if (!nodeId) return null;
  for (const ch of Object.values(project.unifiedCharacters)) {
    const node = (ch as UnifiedCharacter).nodes[nodeId];
    if (node) return { node: node as UnifiedNode, character: ch as UnifiedCharacter };
  }
  return null;
}

/** 解析选中节点的精灵（经 costume/piece/sprite） */
function resolveSelectedNodeSprite(s: CanvasState): {
  node: UnifiedNode; character: UnifiedCharacter; sprite: import('@/lib/unified-types').Sprite; spriteId: string;
} | null {
  const sel = getSelectedPuppetNode();
  if (!sel) return null;
  const { node, character } = sel;
  const project = useProjectStore.getState();
  const direction = (node.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  const spriteId = resolveNodeSpriteId(character, node.id, direction, project.sprites);
  if (!spriteId) return null;
  const sprite = project.sprites[spriteId];
  if (!sprite) return null;
  return { node, character, sprite, spriteId };
}

/** 计算节点的世界角度（从根累加当前帧插值角度，度） */
function computeNodeWorldAngle(character: UnifiedCharacter, nodeId: string): number {
  const state = useProjectStore.getState();
  const ivMap = interpolateNodeKeyframes(character, state.currentFrame);
  const chain: string[] = [];
  let cur: string | undefined = nodeId;
  while (cur) {
    chain.unshift(cur);
    cur = character.nodes[cur]?.parentId ?? undefined;
  }
  let angle = 0;
  for (const id of chain) {
    const n = character.nodes[id];
    angle += ivMap.get(id)?.angle ?? n?.transform.angle ?? 0;
  }
  return angle;
}

/** 画布坐标 → 节点精灵局部坐标（考虑节点世界位姿），越界返回 null */
function canvasToNodeSpriteLocal(
  s: CanvasState,
  character: UnifiedCharacter,
  node: UnifiedNode,
  sprite: import('@/lib/unified-types').Sprite,
  px: number, py: number,
): { lx: number; ly: number } | null {
  const world = s.computePivotWorldPosition(node as any, character as any, s.canvasWidth, s.canvasHeight);
  const angle = computeNodeWorldAngle(character, node.id);
  const pivotX = sprite.plug ? subToPx(sprite.plug.x) : sprite.width / 2;
  const pivotY = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
  const dx = px - world.x;
  const dy = py - world.y;
  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  const lx = Math.round(dx * cosA + dy * sinA + pivotX);
  const ly = Math.round(-dx * sinA + dy * cosA + pivotY);
  if (lx < 0 || lx >= sprite.width || ly < 0 || ly >= sprite.height) return null;
  return { lx, ly };
}

/** 节点精灵局部坐标 → 画布坐标 */
function nodeSpriteLocalToCanvas(
  s: CanvasState,
  character: UnifiedCharacter,
  node: UnifiedNode,
  sprite: import('@/lib/unified-types').Sprite,
  lx: number, ly: number,
): { x: number; y: number } {
  const world = s.computePivotWorldPosition(node as any, character as any, s.canvasWidth, s.canvasHeight);
  const angle = computeNodeWorldAngle(character, node.id);
  const pivotX = sprite.plug ? subToPx(sprite.plug.x) : sprite.width / 2;
  const pivotY = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  const dx = lx - pivotX, dy = ly - pivotY;
  return {
    x: Math.round(world.x + dx * cosA - dy * sinA),
    y: Math.round(world.y + dx * sinA + dy * cosA),
  };
}

/** 选中节点的精灵在画布上的包围盒（含旋转），用于选区裁剪 */
function getNodeSpriteCanvasBounds(
  s: CanvasState,
  character: UnifiedCharacter,
  node: UnifiedNode,
  sprite: import('@/lib/unified-types').Sprite,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const corners = [
    nodeSpriteLocalToCanvas(s, character, node, sprite, 0, 0),
    nodeSpriteLocalToCanvas(s, character, node, sprite, sprite.width - 1, 0),
    nodeSpriteLocalToCanvas(s, character, node, sprite, 0, sprite.height - 1),
    nodeSpriteLocalToCanvas(s, character, node, sprite, sprite.width - 1, sprite.height - 1),
  ];
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
}

// ---------------------------------------------------------------------------
// Node Select Handler — 点选木偶节点（只选中，不拖拽）
// ---------------------------------------------------------------------------

export const nodeSelectHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const hit = s.findPuppetNodeAtPixel(px, py);
    const project = useProjectStore.getState();
    if (!hit) {
      project.setSelectedNodeId(null);
      try { usePuppetSessionStore.setState({ performNodeId: null }); } catch { /* noop */ }
      return;
    }
    const { node, character } = hit;
    project.setSelectedNodeId(node.id);
    s.editorStore.getState().setActivePuppetSkeletonId(character.id);
    try { usePuppetSessionStore.setState({ performNodeId: node.id }); } catch { /* noop */ }
  },
};

// ---------------------------------------------------------------------------
// Node Move Handler — 拖拽移动选中的木偶节点（写 node.tracks x/y）
// ---------------------------------------------------------------------------

export const nodeMoveHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const hit = s.findPuppetNodeAtPixel(px, py);
    if (!hit) return;
    const { node, character } = hit;
    const project = useProjectStore.getState();
    project.setSelectedNodeId(node.id);
    s.editorStore.getState().setActivePuppetSkeletonId(character.id);
    try { usePuppetSessionStore.setState({ performNodeId: node.id }); } catch { /* noop */ }

    const session = usePuppetSessionStore.getState();
    if (!session.performArmed) {
      usePuppetSessionStore.setState({ performArmed: true });
    }
    if (!session.autoKeyframe) return; // 关闭自动关键帧时只选中

    const frame = project.currentFrame;
    const ivMap = interpolateNodeKeyframes(character, frame);
    const iv = ivMap.get(node.id);

    // 父节点世界角度（move 坐标转换，复用 puppetHandler 逻辑）
    let parentWorldAngle = 0;
    if (node.parentId) {
      const parent = character.nodes[node.parentId];
      if (parent) parentWorldAngle = computeNodeWorldAngle(character, parent.id);
    }

    s.isDrawingRef.current = true;
    s.markDirty();
    s.puppetNodeDragRef.current = {
      nodeId: node.id,
      skeletonId: character.id,
      characterId: character.id,
      clipId: '',
      startX: px,
      startY: py,
      origAngle: iv?.angle ?? node.transform.angle,
      origStretch: iv?.stretch ?? node.transform.stretch,
      origOffsetX: iv?.x ?? node.transform.x,
      origOffsetY: iv?.y ?? node.transform.y,
      moveTargetNodeId: node.id,
      mode: 'move',
      pivotWorldX: 0,
      pivotWorldY: 0,
      startMouseAngle: 0,
      dragStarted: false,
      parentWorldAngle,
    };
  },

  onMouseMove(s, e, px, py) {
    const drag = s.puppetNodeDragRef.current;
    if (!drag || drag.mode !== 'move') return;
    if (!drag.dragStarted) {
      const ddx = px - drag.startX;
      const ddy = py - drag.startY;
      if (Math.sqrt(ddx * ddx + ddy * ddy) < 2) return;
      drag.dragStarted = true;
      useProjectStore.getState().beginDrag('移动木偶节点');
      s.isDrawingRef.current = true;
      s.markDirty();
    }
    const store = useProjectStore.getState();
    const frame = store.currentFrame;
    const character = store.unifiedCharacters[drag.characterId ?? drag.skeletonId];
    if (!character) return;
    const dragNode = character.nodes[drag.nodeId];
    const variantIndex = (dragNode?.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    // 逆旋转鼠标增量到父节点局部空间（与 puppetHandler move 分支一致）
    const ddx = px - drag.startX;
    const ddy = py - drag.startY;
    const angleRad = ((drag.parentWorldAngle ?? 0) * Math.PI) / 180;
    const localDx = ddx * Math.cos(-angleRad) - ddy * Math.sin(-angleRad);
    const localDy = ddx * Math.sin(-angleRad) + ddy * Math.cos(-angleRad);
    const newOffsetX = Math.round(drag.origOffsetX + pxToSub(localDx));
    const newOffsetY = Math.round(drag.origOffsetY + pxToSub(localDy));
    writePuppetPoseKeyframe(drag.skeletonId, drag.clipId, drag.nodeId, frame, {
      angle: drag.origAngle,
      stretch: drag.origStretch,
      x: newOffsetX,
      y: newOffsetY,
    }, variantIndex);
  },

  onMouseUp(s) {
    s.puppetNodeDragRef.current = null;
  },
};

// ---------------------------------------------------------------------------
// Node Trajectory Handler — 为选中节点绘制运动轨迹，烘焙为 node.trajectory
// ---------------------------------------------------------------------------

export const nodeTrajectoryHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    s.isDrawingRef.current = true;
    s.markDirty();
    s.trajectoryPathRef.current = [{ x: px, y: py }];
    s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current) return;
    if (s.lastPixelRef.current) {
      for (const point of getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)) {
        s.trajectoryPathRef.current.push({ x: point.x, y: point.y });
      }
    } else {
      s.trajectoryPathRef.current.push({ x: px, y: py });
    }
    s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseUp(s) {
    if (!s.isDrawingRef.current) return;
    const path = s.trajectoryPathRef.current;
    s.trajectoryPathRef.current = [];
    if (path.length < 2) return;
    const sel = getSelectedPuppetNode();
    if (!sel) return;
    const { node, character } = sel;
    const store = useProjectStore.getState();
    const totalFrames = store.totalFrames;

    // 以绘制时的当前帧位姿为基准：路径点 → 节点局部 offset
    const baseFrame = store.currentFrame;
    const ivMap = interpolateNodeKeyframes(character, baseFrame);
    const iv = ivMap.get(node.id);
    const baseX = iv?.x ?? node.transform.x;
    const baseY = iv?.y ?? node.transform.y;
    const baseWorld = s.computePivotWorldPosition(node as any, character as any, s.canvasWidth, s.canvasHeight);
    let parentWorldAngle = 0;
    if (node.parentId && character.nodes[node.parentId]) {
      parentWorldAngle = computeNodeWorldAngle(character, node.parentId);
    }
    const angleRad = (parentWorldAngle * Math.PI) / 180;
    const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

    // 路径采样到帧
    const pathLength = path.length;
    const numSamples = Math.min(totalFrames, Math.max(2, Math.round(pathLength / 3)));
    const points: { frame: number; x: number; y: number }[] = [];
    for (let i = 0; i < numSamples; i++) {
      const pathIndex = Math.min(Math.round((i * (pathLength - 1)) / (numSamples - 1)), pathLength - 1);
      const pt = path[pathIndex];
      const frame = numSamples === 1 ? 0 : Math.round((i / (numSamples - 1)) * (totalFrames - 1));
      // 画布增量 → 父节点局部增量（逆旋转）
      const ddx = pt.x - baseWorld.x;
      const ddy = pt.y - baseWorld.y;
      const localDx = ddx * cosA + ddy * sinA;
      const localDy = -ddx * sinA + ddy * cosA;
      points.push({
        frame,
        x: Math.round(baseX + pxToSub(localDx)),
        y: Math.round(baseY + pxToSub(localDy)),
      });
    }

    store.pushUndo('绘制节点轨迹');
    store.updateUnifiedNode(character.id, node.id, { trajectory: points });
    s.markDirty();
  },
};

// ---------------------------------------------------------------------------
// Node Lasso Handler — 套索选区；有选中节点时裁剪到其精灵包围盒
// ---------------------------------------------------------------------------

export const nodeLassoHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    s.isDrawingRef.current = true;
    s.markDirty();
    s.selectionMaskRef.current.clear();
    s.lassoPathRef.current = [{ x: px, y: py }];
    s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseMove(s, e, px, py) {
    if (!s.isDrawingRef.current) return;
    if (s.lastPixelRef.current) {
      for (const point of getLinePixels(s.lastPixelRef.current.x, s.lastPixelRef.current.y, px, py)) {
        s.lassoPathRef.current.push({ x: point.x, y: point.y });
      }
    } else {
      s.lassoPathRef.current.push({ x: px, y: py });
    }
    s.lastPixelRef.current = { x: px, y: py };
  },

  onMouseUp(s) {
    if (!s.isDrawingRef.current || s.lassoPathRef.current.length <= 2) return;
    const path = s.lassoPathRef.current;
    path.push({ ...path[0] });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of path) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    // 精灵编辑模式：选区直接作用于编辑精灵像素，mask 存局部坐标
    if (s.editMode === 'sprite_edit' && s.selectedPart) {
      for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
        for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
          if (!pointInPolygon(x, y, path)) continue;
          const local = spriteEditCanvasToLocal(s, x, y);
          if (local) s.selectionMaskRef.current.add(`${local.lx},${local.ly}`);
        }
      }
      s.lassoPathRef.current = [];
      s.markDirty();
      return;
    }
    // 有选中节点时，将选区裁剪到其精灵包围盒（选区作用于该节点精灵）
    const nodeSprite = resolveSelectedNodeSprite(s);
    let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    if (nodeSprite) {
      bounds = getNodeSpriteCanvasBounds(s, nodeSprite.character, nodeSprite.node, nodeSprite.sprite);
      minX = Math.max(minX, bounds.minX); minY = Math.max(minY, bounds.minY);
      maxX = Math.min(maxX, bounds.maxX); maxY = Math.min(maxY, bounds.maxY);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
        if (pointInPolygon(x, y, path)) s.selectionMaskRef.current.add(`${x},${y}`);
      }
    }
    s.lassoPathRef.current = [];
    s.markDirty();
  },
};

// ---------------------------------------------------------------------------
// Node Magic Wand Handler — 节点感知的魔棒选区
// ---------------------------------------------------------------------------

export const nodeMagicWandHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const shiftHeld = e.shiftKey;
    const ctrlHeld = e.ctrlKey || e.metaKey;
    if (!shiftHeld && !ctrlHeld) s.selectionMaskRef.current.clear();

    // 精灵编辑模式：直接在编辑精灵像素上漫水，mask 存局部坐标（选区作用于精灵像素）
    if (s.editMode === 'sprite_edit' && s.selectedPart) {
      const sprite = s.selectedPart;
      const start = spriteEditCanvasToLocal(s, Math.round(px), Math.round(py));
      if (start) {
        const targetColor = sprite.data[start.ly]?.[start.lx];
        if (targetColor !== null && targetColor !== undefined) {
          const tR = parseInt(targetColor.slice(1, 3), 16);
          const tG = parseInt(targetColor.slice(3, 5), 16);
          const tB = parseInt(targetColor.slice(5, 7), 16);
          const visited = new Set<string>();
          const queue: { lx: number; ly: number }[] = [start];
          visited.add(`${start.lx},${start.ly}`);
          const tolerance = s.magicWandTolerance ?? 10;
          while (queue.length > 0) {
            const { lx, ly } = queue.shift()!;
            const maskKey = `${lx},${ly}`;
            if (ctrlHeld) s.selectionMaskRef.current.delete(maskKey);
            else s.selectionMaskRef.current.add(maskKey);
            for (const n of [{ lx: lx - 1, ly }, { lx: lx + 1, ly }, { lx, ly: ly - 1 }, { lx, ly: ly + 1 }]) {
              if (n.lx < 0 || n.lx >= sprite.width || n.ly < 0 || n.ly >= sprite.height) continue;
              const nKey = `${n.lx},${n.ly}`;
              if (visited.has(nKey)) continue;
              visited.add(nKey);
              const nColor = sprite.data[n.ly]?.[n.lx];
              if (nColor === null || nColor === undefined) continue;
              const nR = parseInt(nColor.slice(1, 3), 16);
              const nG = parseInt(nColor.slice(3, 5), 16);
              const nB = parseInt(nColor.slice(5, 7), 16);
              if (Math.abs(tR - nR) + Math.abs(tG - nG) + Math.abs(tB - nB) <= tolerance * 3) {
                queue.push(n);
              }
            }
          }
          s.markDirty();
        }
      }
      return;
    }

    // 优先：选中节点的精灵（节点感知，考虑世界位姿）
    const nodeSprite = resolveSelectedNodeSprite(s);
    if (nodeSprite) {
      const { character, node, sprite } = nodeSprite;
      const local = canvasToNodeSpriteLocal(s, character, node, sprite, Math.round(px), Math.round(py));
      if (!local) return;
      const targetColor = sprite.data[local.ly]?.[local.lx];
      if (targetColor === null || targetColor === undefined) return;
      const tR = parseInt(targetColor.slice(1, 3), 16);
      const tG = parseInt(targetColor.slice(3, 5), 16);
      const tB = parseInt(targetColor.slice(5, 7), 16);
      const visited = new Set<string>();
      const queue: { lx: number; ly: number }[] = [local];
      visited.add(`${local.lx},${local.ly}`);
      const tolerance = s.magicWandTolerance ?? 10;
      while (queue.length > 0) {
        const { lx, ly } = queue.shift()!;
        const canvasPt = nodeSpriteLocalToCanvas(s, character, node, sprite, lx, ly);
        const maskKey = `${canvasPt.x},${canvasPt.y}`;
        if (ctrlHeld) s.selectionMaskRef.current.delete(maskKey);
        else s.selectionMaskRef.current.add(maskKey);
        for (const n of [{ lx: lx - 1, ly }, { lx: lx + 1, ly }, { lx, ly: ly - 1 }, { lx, ly: ly + 1 }]) {
          if (n.lx < 0 || n.lx >= sprite.width || n.ly < 0 || n.ly >= sprite.height) continue;
          const nKey = `${n.lx},${n.ly}`;
          if (visited.has(nKey)) continue;
          visited.add(nKey);
          const nColor = sprite.data[n.ly]?.[n.lx];
          if (nColor === null || nColor === undefined) continue;
          const nR = parseInt(nColor.slice(1, 3), 16);
          const nG = parseInt(nColor.slice(3, 5), 16);
          const nB = parseInt(nColor.slice(5, 7), 16);
          if (Math.abs(tR - nR) + Math.abs(tG - nG) + Math.abs(tB - nB) <= tolerance * 3) {
            queue.push(n);
          }
        }
      }
      s.markDirty();
      return;
    }

    // 回退：旧逻辑（遍历全局精灵表，画布中心坐标系）
    const offsetX = s.canvasWidth / 2;
    const offsetY = s.canvasHeight / 2;
    const sortedParts = [...s.parts];
    let targetColor: string | null = null;
    let targetPart: import('@/lib/unified-types').Sprite | null = null;
    for (const part of sortedParts) {
      const local = s.canvasToPartLocal(px, py, part);
      if (local && part.data[local.ly]?.[local.lx] !== null) {
        targetColor = part.data[local.ly][local.lx];
        targetPart = part;
        break;
      }
    }
    if (targetColor && targetPart) {
      const local = s.canvasToPartLocal(px, py, targetPart);
      if (!local) return;
      const visited = new Set<string>();
      const queue: { lx: number; ly: number }[] = [local];
      visited.add(`${local.lx},${local.ly}`);
      const tR = parseInt(targetColor.slice(1, 3), 16);
      const tG = parseInt(targetColor.slice(3, 5), 16);
      const tB = parseInt(targetColor.slice(5, 7), 16);
      const pivotX = spritePivotX(targetPart);
      const pivotY = spritePivotY(targetPart);
      while (queue.length > 0) {
        const { lx, ly } = queue.shift()!;
        const canvasX = (offsetX - pivotX) + lx;
        const canvasY = (offsetY - pivotY) + ly;
        const maskKey = `${canvasX},${canvasY}`;
        if (ctrlHeld) s.selectionMaskRef.current.delete(maskKey);
        else s.selectionMaskRef.current.add(maskKey);
        for (const n of [{ lx: lx - 1, ly }, { lx: lx + 1, ly }, { lx, ly: ly - 1 }, { lx, ly: ly + 1 }]) {
          if (n.lx < 0 || n.lx >= targetPart.width || n.ly < 0 || n.ly >= targetPart.height) continue;
          const nKey = `${n.lx},${n.ly}`;
          if (visited.has(nKey)) continue;
          visited.add(nKey);
          const nColor = targetPart.data[n.ly]?.[n.lx];
          if (nColor === null) continue;
          const nR = parseInt(nColor.slice(1, 3), 16);
          const nG = parseInt(nColor.slice(3, 5), 16);
          const nB = parseInt(nColor.slice(5, 7), 16);
          if (Math.abs(tR - nR) + Math.abs(tG - nG) + Math.abs(tB - nB) <= s.magicWandTolerance * 3) queue.push(n);
        }
      }
      s.markDirty();
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
    if (s.editMode === 'correction' && s.selectedSpriteId && s.selectedPart) {
      const selPart = s.selectedPart;
      const store = useProjectStore.getState();
      let currentKf = store.keyframes.find(k => k.spriteId === s.selectedSpriteId && k.frame === currentFrame);
      if (!currentKf) currentKf = store.addKeyframe(s.selectedSpriteId!, currentFrame);
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
      if (s.selectedSpriteId && s.selectedPart) {
        const selPart = s.selectedPart;
        const editorState = s.editorStore.getState(); editorState.enterSpriteEditMode(s.selectedSpriteId!);
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
        const spriteId = editorState.spriteEditSpriteId!;
        const prevFrame = editorState.spriteEditStartFrame;
        const existingPkf = projectStore.getKeyframeAtFrame(spriteId, prevFrame);
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

// ---------------------------------------------------------------------------
// Dispatch: getToolHandler
// ---------------------------------------------------------------------------

export function getToolHandler(
  tool: string,
  isPartEdit: boolean = false,
): ToolHandler | null {
  // 精灵编辑模式：像素工具直接编辑精灵（puppetHandler 会吞掉 brush/eraser/fill 事件）
  if (isPartEdit) {
    if (tool === 'brush' || tool === 'eraser') return brushEraserHandler;
    if (tool === 'fill') return fillToolHandler;
    if (tool === 'eyedropper') return eyedropperHandler;
    if (tool === 'landmark') return landmarkHandler;
  }

  // Node 级分发（新架构；旧画布精灵层分发已随 workspace mode 退役）
  switch (tool) {
    case 'puppet': return puppetHandler;
    case 'pseudo3d_rotate': return puppetHandler; // 复用 puppet 拖拽，onMouseDown 内按工具名设伪3D标志
    case 'landmark': return landmarkHandler; // 精灵编辑模式外 no-op（handler 内 early return）
    case 'select': return nodeSelectHandler;
    case 'move': return nodeMoveHandler;
    case 'trajectory': return nodeTrajectoryHandler;
    case 'crop': return cropHandler; // 评估中：新架构下意义不大，见报告
    case 'lasso': return nodeLassoHandler;
    case 'magic_wand': return nodeMagicWandHandler;
    case 'smart_select': return smartSelectHandler;
    case 'inpaint': return inpaintHandler; // 已迁移（62bc70b：SAM 选区 + 圆形半径）
    case 'motion_blur_brush':
    case 'glow_brush':
    case 'particle_brush':
    case 'afterimage_brush': return strokeToolHandler; // 帧级 overlay，无需 Node 改造
    case 'brush':
    case 'eraser': return brushEraserHandler;
    case 'fill': return fillToolHandler;
    case 'eyedropper': return eyedropperHandler;
    default: return puppetHandler;
  }
}
