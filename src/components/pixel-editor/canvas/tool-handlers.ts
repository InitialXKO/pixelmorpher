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
import { computeWorldTransforms, geometryDirectionFromToggle } from '@/lib/unified-render';
import { resolvePuppetNodeSprite } from '@/lib/engine/puppet-utils';
import { spriteLocalPoint } from '@/lib/node-picking';
import { interpolateNodeKeyframes } from '@/lib/engine/render-helpers/puppet-keyframe-interpolation';
import { bakeCanvasPointsToTrajectory } from '@/lib/motion-guide';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import {
  newMarkId, uniqueMarkName, rectSpecFromCorners, paintedSpecFromCells,
  cellsFromPaintedSpec, normalizeSpriteMarks,
} from '@/lib/sprite-marks';
import type { SpriteMark } from '@/lib/unified-types';
import { suspendIKChain, resumeIKChain, suspendedIKChains } from '@/lib/ik-drag-state';
import { computeIKChainTip, getIKChainJointIds } from '@/lib/ik-tip';
import {
  isPixelInPart,
  getLinePixels,
  pointInPolygon,
  computeSpriteEndPoint,
  isStrokeToolCheck,
  spritePivotX,
  spritePivotY,
} from './canvas-utils';
import { subToPx, pxToSub, mapDragTo3D, ikTargetMirror, projectToView, type SubPixel } from '@/lib/unified-types';
import { toast } from '@/hooks/use-toast';
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
  values: { angle: number; stretch: number; scaleX: number; x: number; y: number; tilt?: number },
  variantIndex: number,
  opts?: { forceCreate?: boolean },
) {
  const store = useProjectStore.getState();
  const character = store.unifiedCharacters[skeletonId];
  if (!character) return;
  const node = character.nodes[nodeId];
  if (!node) return;

  // 直接写 node.tracks（渲染器从这里读）。自动关键帧口径（2026-10-28
  // 用户裁决）：已有关键帧的通道永远可改；开关关着且当前帧该通道无
  // 键 → 不在当前帧新建，改写到第 0 帧（0 帧有键更新、无键新建）——
  // 拖拽永远有落点。显式打帧入口（时间轴「添加关键帧」）传
  // forceCreate 绕过（永远在指定帧新建）；改骨架的操作（Alt 拖
  // 插槽）不经此函数、不受管。
  const mayCreate = opts?.forceCreate === true || usePuppetSessionStore.getState().autoKeyframe;
  const setTrack = (trackName: 'angle' | 'x' | 'y' | 'stretch' | 'scaleX' | 'tilt', value: number) => {
    const existing = node.tracks[trackName];
    const track = existing ?? { keyframes: [], interpolation: 'linear' as const };
    let idx = track.keyframes.findIndex(k => k.frame === frame);
    let targetFrame = frame;
    if (idx < 0 && !mayCreate) {
      targetFrame = 0;
      idx = track.keyframes.findIndex(k => k.frame === 0);
    }
    const newKeyframes = idx >= 0
      ? track.keyframes.map((k, i) => i === idx ? { ...k, value } : k)
      : [...track.keyframes, { frame: targetFrame, value }].sort((a, b) => a.frame - b.frame);
    return { ...track, keyframes: newKeyframes };
  };

  const nextTracks: typeof node.tracks = { ...node.tracks };
  const put = (trackName: 'angle' | 'x' | 'y' | 'stretch' | 'scaleX' | 'tilt', value: number) => {
    const t = setTrack(trackName, value);
    if (t) nextTracks[trackName] = t;
  };
  put('angle', values.angle);
  put('x', values.x);
  put('y', values.y);
  put('stretch', values.stretch);
  put('scaleX', values.scaleX);
  // tilt 仅在调用方给出时写（伪 3D 工具 / tilt 编辑），其余拖拽不碰出平面角轨道
  if (values.tilt !== undefined) put('tilt', values.tilt);
  store.updateUnifiedNode(skeletonId, nodeId, { tracks: nextTracks });
}

/** 锁定节点解析：editor.nodeLockId 有效（节点仍存在）时返回其命中三元组，
 *  节点类 handler 在锁定期间以它为准、不再另行命中其他节点。 */
export function lockedPuppetHit(s: CanvasState): { node: import('@/lib/unified-types').Node; character: import('@/lib/unified-types').Character; clipId: string | null } | null {
  const lockId = s.editorStore.getState().nodeLockId;
  if (!lockId) return null;
  const project = useProjectStore.getState();
  for (const character of Object.values(project.unifiedCharacters)) {
    const node = character.nodes[lockId];
    if (node) {
      const clip = project.animationClips.find((c) => c.puppetCharacterId === character.id);
      return { node, character, clipId: clip?.id ?? null };
    }
  }
  return null;
}

/** IK 目标手柄仅做可视化，不可拖拽（拖精灵本身，目标自动跟随） */
export const puppetHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const lockHit = lockedPuppetHit(s);
    const hit = lockHit ?? s.findPuppetNodeAtPixel(px, py);
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
    const worldTransformsForAngle = computeWorldTransforms(character, tmpFrame, s.canvasWidth, s.canvasHeight, undefined, undefined, undefined, undefined, geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D));
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
        origScaleX: 1,
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
    // 自动关键帧不再拦拖拽：开关只管写关键帧时要不要自动新建
    // （writePuppetPoseKeyframe 内部口径），拖拽本身永远可用

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
        origScaleX: 1,
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
      origTilt: rotateIv?.tilt ?? node.transform.tilt ?? 0,
      origStretch: rotateIv?.stretch ?? node.transform.stretch,
      origScaleX: rotateIv?.scaleX ?? node.transform.scaleX ?? 1,
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
      if (activeTool === 'pseudo3d_rotate') {
        // 伪3D旋转（乙）：拖拽角直接写被拖节点的出平面角 tilt 关键帧，子树零写入——
        // frame 复合（RU(tilt)）自动把整棵子树掀出平面。旧版递归烘焙后代 local x/y/z 已废弃
        // （历史烘焙数据是普通 x/y/z 数据，原样可渲染，不迁移）。
        const newTilt = (drag.origTilt ?? 0) + Math.round(angleDelta);
        writePuppetPoseKeyframe(drag.skeletonId, drag.clipId, drag.nodeId, frame, {
          angle: drag.origAngle,
          stretch: drag.origStretch,
          scaleX: drag.origScaleX ?? 1,
          x: drag.origOffsetX,
          y: drag.origOffsetY,
          tilt: newTilt,
        }, variantIndex);
      } else {
        const newAngle = drag.origAngle + Math.round(angleDelta);
        writePuppetPoseKeyframe(drag.skeletonId, drag.clipId, drag.nodeId, frame, {
          angle: newAngle,
          stretch: drag.origStretch,
          scaleX: drag.origScaleX ?? 1,
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
        scaleX: drag.origScaleX ?? 1,
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
        scaleX: iv?.scaleX ?? node.transform.scaleX ?? 1,
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
            const { tipX, tipY, tipZ, direction } = computeIKChainTip(ch, jointIds, chain.tipLength, geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D));
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
// Sprite Mark Handler（精灵标记：点/选区/矢量，供消费端按名复用）
// ---------------------------------------------------------------------------
// 仅 sprite_edit 有效。交互模型：子模式 point/paint/rect/vector。
// 拖拽全程只改 editor-store 的 markDrag 工作副本（覆盖层实时
// 预览），mouseUp 一次性提交（一次撤销）。点模式点空位新建、
// 抓已有标记拖动；paint 只落选中的涂画选区（无则新建）；
// rect 落选中的选区标记（改其定义为矩形）或新建；vector 拖
// 出锚点→尖端，点击不移动时保留原有分量（防误清）。

type MarkDragMeta = {
  spriteId: string;
  startNx: number; startNy: number;
  lastCx: number; lastCy: number;
  moved: boolean;
};
let markDragState: MarkDragMeta | null = null;

function markLocal(s: CanvasState, px: number, py: number) {
  const selPart = s.selectedPart;
  if (!selPart) return null;
  const offsetX = Math.floor((s.canvasWidth - selPart.width) / 2);
  const offsetY = Math.floor((s.canvasHeight - selPart.height) / 2);
  const lx = px - offsetX;
  const ly = py - offsetY;
  return {
    lx, ly,
    nx: lx / selPart.width, ny: ly / selPart.height,
    inside: lx >= 0 && ly >= 0 && lx < selPart.width && ly < selPart.height,
    w: selPart.width, h: selPart.height,
  };
}

export const markHandler: ToolHandler = {
  onMouseDown(s, _e, px, py) {
    if (s.editMode !== 'sprite_edit' || !s.selectedSpriteId || !s.selectedPart) return;
    const loc = markLocal(s, px, py);
    if (!loc || !loc.inside) return;
    const es = s.editorStore.getState();
    const store = useProjectStore.getState();
    const sprite = store.sprites[s.selectedSpriteId];
    if (!sprite) return;
    const marks = sprite.marks ?? [];
    const mode = es.markToolMode;
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    markDragState = {
      spriteId: s.selectedSpriteId,
      startNx: clamp01(loc.nx), startNy: clamp01(loc.ny),
      lastCx: loc.lx, lastCy: loc.ly, moved: false,
    };

    if (mode === 'point') {
      let hit: SpriteMark | undefined;
      let best = 4; // 抓取半径（精灵 px）
      for (const m of marks) {
        if (m.kind !== 'point') continue;
        const d = Math.hypot(m.x * loc.w - loc.lx, m.y * loc.h - loc.ly);
        if (d < best) { best = d; hit = m; }
      }
      const working: SpriteMark = hit
        ? { ...hit }
        : { id: newMarkId(), name: uniqueMarkName(marks, '标记'), kind: 'point', x: clamp01(loc.nx), y: clamp01(loc.ny) };
      es.setSelectedMarkId(working.id);
      es.setMarkDrag({ markId: working.id, working });
    } else if (mode === 'vector') {
      let hit: SpriteMark | undefined;
      let best = 4;
      for (const m of marks) {
        if (m.kind !== 'vector') continue;
        const d = Math.hypot(m.x * loc.w - loc.lx, m.y * loc.h - loc.ly);
        if (d < best) { best = d; hit = m; }
      }
      const working: SpriteMark = hit
        ? { ...hit }
        : { id: newMarkId(), name: uniqueMarkName(marks, '矢量'), kind: 'vector', x: clamp01(loc.nx), y: clamp01(loc.ny), dx: 0.2, dy: 0 };
      es.setSelectedMarkId(working.id);
      es.setMarkDrag({ markId: working.id, working });
    } else if (mode === 'paint') {
      const sel = marks.find((m) => m.id === es.selectedMarkId);
      const target = sel?.kind === 'region' && sel.region.by === 'painted'
        ? sel
        : marks.find((m) => m.kind === 'region' && m.region.by === 'painted');
      const working: SpriteMark = target
        ? { ...target }
        : {
            id: newMarkId(), name: uniqueMarkName(marks, '选区'), kind: 'region',
            region: { by: 'painted', mask: { w: loc.w, h: loc.h, bits: '' } },
          };
      const cells = working.kind === 'region' && working.region.by === 'painted'
        ? cellsFromPaintedSpec(working.region, loc.w, loc.h)
        : new Uint8Array(loc.w * loc.h);
      const paintValue = !cells[loc.ly * loc.w + loc.lx];
      cells[loc.ly * loc.w + loc.lx] = paintValue ? 1 : 0;
      es.setSelectedMarkId(working.id);
      es.setMarkDrag({ markId: working.id, working, paintCells: cells, paintValue });
    } else {
      // rect
      const sel = marks.find((m) => m.id === es.selectedMarkId);
      const working: SpriteMark = sel?.kind === 'region'
        ? { ...sel, region: rectSpecFromCorners(loc.nx, loc.ny, loc.nx, loc.ny) }
        : {
            id: newMarkId(), name: uniqueMarkName(marks, '选区'), kind: 'region',
            region: rectSpecFromCorners(loc.nx, loc.ny, loc.nx, loc.ny),
          };
      es.setSelectedMarkId(working.id);
      es.setMarkDrag({ markId: working.id, working });
    }
    s.markDirty();
  },

  onMouseMove(s, _e, px, py) {
    const es = s.editorStore.getState();
    const drag = es.markDrag;
    if (!drag || !markDragState) return;
    const loc = markLocal(s, px, py);
    if (!loc) return;
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    if (Math.abs(loc.nx - markDragState.startNx) > 0.001 || Math.abs(loc.ny - markDragState.startNy) > 0.001) {
      markDragState.moved = true;
    }
    const mode = es.markToolMode;
    if (mode === 'point' && drag.working.kind === 'point') {
      es.setMarkDrag({ ...drag, working: { ...drag.working, x: clamp01(loc.nx), y: clamp01(loc.ny) } });
    } else if (mode === 'vector' && drag.working.kind === 'vector') {
      es.setMarkDrag({
        ...drag,
        working: { ...drag.working, dx: clamp01(loc.nx) - drag.working.x, dy: clamp01(loc.ny) - drag.working.y },
      });
    } else if (mode === 'paint' && drag.paintCells) {
      const cells = new Uint8Array(drag.paintCells);
      const v = drag.paintValue ? 1 : 0;
      for (const p of getLinePixels(markDragState.lastCx, markDragState.lastCy, loc.lx, loc.ly)) {
        if (p.x >= 0 && p.y >= 0 && p.x < loc.w && p.y < loc.h) cells[p.y * loc.w + p.x] = v;
      }
      markDragState.lastCx = loc.lx; markDragState.lastCy = loc.ly;
      es.setMarkDrag({ ...drag, paintCells: cells });
    } else if (mode === 'rect' && drag.working.kind === 'region') {
      es.setMarkDrag({
        ...drag,
        working: {
          ...drag.working,
          region: rectSpecFromCorners(markDragState.startNx, markDragState.startNy, clamp01(loc.nx), clamp01(loc.ny)),
        },
      });
    }
    s.markDirty();
  },

  onMouseUp(s) {
    const es = s.editorStore.getState();
    const drag = es.markDrag;
    if (!drag || !markDragState) { es.setMarkDrag(null); markDragState = null; return; }
    const store = useProjectStore.getState();
    const sprite = store.sprites[markDragState.spriteId];
    es.setMarkDrag(null);
    const meta = markDragState;
    markDragState = null;
    if (!sprite) return;
    let working = drag.working;
    // vector 点击未移动：保留原分量（新建的保留缺省分量），不写成零矢量
    if (working.kind === 'vector' && !meta.moved) {
      const orig = (sprite.marks ?? []).find((m) => m.id === working.id);
      if (orig?.kind === 'vector') working = orig;
    }
    if (working.kind === 'region' && drag.paintCells && sprite.width && sprite.height) {
      working = { ...working, region: paintedSpecFromCells(drag.paintCells, sprite.width, sprite.height) };
    }
    const marks = [...(sprite.marks ?? [])];
    const idx = marks.findIndex((m) => m.id === working.id);
    if (idx >= 0) marks[idx] = working;
    else marks.push(working);
    store.updateSpriteMarks(meta.spriteId, normalizeSpriteMarks(marks));
    s.markDirty();
  },
};

// ---------------------------------------------------------------------------
// 矫正模式目标解析（逐帧像素修正，2026-10-30 自旧工程关键帧搬家到节点）
// ---------------------------------------------------------------------------

/** 画布点命中的可修正目标：木偶节点 + 当帧生效精灵 + 逆映射上下文。
 * 堆叠件（无单一底图）与参数化生成图（无静态底图）不可修正，返回 null。 */
function correctionTargetAt(s: CanvasState, px: number, py: number): {
  characterId: string;
  nodeId: string;
  spriteId: string;
  sprite: import('@/lib/unified-types').Sprite;
  wt: { worldAngle: number; scaleX?: number; worldStretch: number; skewX?: number; skewY?: number; mirror: boolean };
  jointX: number;
  jointY: number;
} | null {
  const hit = s.findPuppetNodeAtPixel(px, py);
  if (!hit) return null;
  const { node, character } = hit;
  const store = useProjectStore.getState();
  const activeCs = (character.costumeSets ?? []).find((cs) => cs.id === character.activeCostumeSetId);
  const piece = activeCs?.pieces[node.slot?.slotKey ?? node.id];
  if (piece?.stack) return null;
  const rootNode = character.nodes[character.rootNodeId];
  const direction = (rootNode?.transform.variantIndex ?? 0) as import('@/lib/unified-types').DirectionIndex;
  const spriteId = resolveNodeSpriteId(character, node.id, direction, store.sprites);
  if (!spriteId) return null;
  const sprite = store.sprites[spriteId];
  if (!sprite) return null;
  const frame = s.currentFrameRef.current;
  const wts = computeWorldTransforms(character, frame, s.canvasWidth, s.canvasHeight, undefined, undefined, undefined, undefined, geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D));
  const w = wts.get(node.id);
  if (!w) return null;
  const proj = projectToView(w.worldX, w.worldY, w.worldZ, direction);
  return {
    characterId: character.id,
    nodeId: node.id,
    spriteId,
    sprite,
    wt: w,
    jointX: subToPx(proj.canvasX) + s.canvasWidth / 2,
    jointY: subToPx(proj.canvasY) + s.canvasHeight / 2,
  };
}

/** 把一条笔刷命令追加到节点当帧的逐帧修正（同帧换过图则旧条目作废重开）。 */
function appendFrameCorrectionCommand(
  target: { characterId: string; nodeId: string; spriteId: string },
  frame: number,
  cmd: BrushCommand,
): void {
  const store = useProjectStore.getState();
  const node = store.unifiedCharacters[target.characterId]?.nodes?.[target.nodeId];
  if (!node) return;
  const prev = node.frameCorrections?.[frame];
  const base = prev && prev.spriteId === target.spriteId ? prev.commands ?? [] : [];
  store.updateUnifiedNode(target.characterId, target.nodeId, {
    frameCorrections: {
      ...(node.frameCorrections ?? {}),
      [frame]: { spriteId: target.spriteId, commands: [...base, cmd] },
    },
  } as any);
}

// ---------------------------------------------------------------------------
// Fill Tool Handler
// ---------------------------------------------------------------------------

export const fillToolHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    const currentFrame = s.currentFrameRef.current;
    if (s.editMode === 'correction') {
      // 矫正模式：填充记到命中节点的当帧逐帧修正（精灵局部坐标）
      const target = correctionTargetAt(s, px, py);
      if (target) {
        const localF = spriteLocalPoint(target.sprite, target.wt, target.jointX, target.jointY, px, py);
        if (localF) {
          const fillCmd: BrushCommand = { id: crypto.randomUUID(), type: 'fill', color: s.brushColor, size: 1, points: [{ x: localF.x, y: localF.y }], blendMode: 'normal', brushStyle: s.brushStyle !== 'solid' ? s.brushStyle : undefined, brushStyleParams: s.brushStyle !== 'solid' ? s.brushStyleParams : undefined };
          useProjectStore.getState().performBatch('填充', () => {
            appendFrameCorrectionCommand(target, currentFrame, fillCmd);
          });
        }
      }
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
    // sprite_edit：裁当前精灵——框选矩形换算到精灵局部坐标（精灵居中绘制），
    // 框超出精灵边界 = 扩边补透明；走 resizeSprite（像素/plug/heightmap/
    // landmarks 同步平移，与「调整尺寸」对话框同一口径）。其余模式维持裁画布。
    if (s.editMode === 'sprite_edit' && s.selectedSpriteId && s.selectedPart) {
      if (cropW >= 1 && cropH >= 1) {
        const origin = spriteEditCanvasOrigin(s);
        const lx0 = cropX - origin.x;
        const ly0 = cropY - origin.y;
        const newW = Math.max(1, Math.min(512, cropW));
        const newH = Math.max(1, Math.min(512, cropH));
        useProjectStore.getState().resizeSprite(s.selectedSpriteId, newW, newH, -lx0, -ly0);
        s.markDirty();
      }
      s.cropStartRef.current = null; s.cropRectRef.current = null;
      s.isDrawingRef.current = false;
      return;
    }
    if (cropW >= 2 && cropH >= 2) {
      const store = useProjectStore.getState(); const oldCenterX = s.canvasWidth / 2; const oldCenterY = s.canvasHeight / 2;
      const newCenterOffsetX = cropX + cropW / 2 - oldCenterX; const newCenterOffsetY = cropY + cropH / 2 - oldCenterY;
      store.performBatch('裁剪画布', () => {
        // Part 是纯精灵数据，无位置偏移；裁剪画布不再移动 Part
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
              Object.values(pst.sprites), currentFrame, s.backgroundColor,
              s.effectTracks, undefined, undefined, false, 0.5,
              // 画布轨必须带上：SAM 编码帧要与用户所见几何一致（像素缩放/
              // 画布遮罩开启时传 undefined 会让分割画面与点选坐标错位）
              undefined, pst.canvasModifierTracks, 'low',
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
        const inpainted = inpaintPixels(selPart.data, spriteMask, editor.inpaintRadius);
        s.setPartPixels(selPart.id!, inpainted);
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
        const inpainted = inpaintPixels(selPart.data, mask, radius);
        s.setPartPixels(selPart.id!, inpainted);
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
    // 锁定期间左键不改选（空白解锁由交互层在 mouseup 统一判）
    if (lockedPuppetHit(s)) return;
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
    const hit = lockedPuppetHit(s) ?? s.findPuppetNodeAtPixel(px, py);
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
    // 自动关键帧不拦拖拽（口径见 writePuppetPoseKeyframe）

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
      origScaleX: iv?.scaleX ?? node.transform.scaleX ?? 1,
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
      scaleX: drag.origScaleX ?? 1,
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
    // 路径采样到帧
    const pathLength = path.length;
    const numSamples = Math.min(totalFrames, Math.max(2, Math.round(pathLength / 3)));
    const canvasPts: { x: number; y: number }[] = [];
    const frames: number[] = [];
    for (let i = 0; i < numSamples; i++) {
      const pathIndex = Math.min(Math.round((i * (pathLength - 1)) / (numSamples - 1)), pathLength - 1);
      canvasPts.push(path[pathIndex]!);
      frames.push(numSamples === 1 ? 0 : Math.round((i / (numSamples - 1)) * (totalFrames - 1)));
    }
    // 画布点 → 父级局部轨迹点的换算与制导生成共用同一份（lib/motion-guide）
    const points = bakeCanvasPointsToTrajectory(canvasPts, {
      baseX, baseY, baseWorld, parentWorldAngleDeg: parentWorldAngle,
    }, frames);

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

    // Correction mode：笔画目标 = 落笔命中的木偶节点，点列记精灵局部坐标
    if (s.editMode === 'correction') {
      const target = correctionTargetAt(s, px, py);
      if (target) {
        const startPt = spriteLocalPoint(target.sprite, target.wt, target.jointX, target.jointY, px, py);
        if (startPt) {
          s.pixelEditCommandRef.current = {
            commandId: crypto.randomUUID(),
            characterId: target.characterId,
            nodeId: target.nodeId,
            spriteId: target.spriteId,
            sprite: target.sprite,
            wt: target.wt,
            jointX: target.jointX,
            jointY: target.jointY,
            points: [{ x: startPt.x, y: startPt.y }],
          };
        }
      }
      s.lastPixelRef.current = { x: px, y: py };
      return;
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
    // 矫正模式先行：目标是木偶节点，不依赖 selectedPart
    if (s.editMode === 'correction') {
      if (!s.isDrawingRef.current) return;
      const rec = s.pixelEditCommandRef.current;
      if (rec) {
        const local3 = spriteLocalPoint(rec.sprite, rec.wt, rec.jointX, rec.jointY, px, py);
        if (local3) rec.points.push({ x: local3.x, y: local3.y });
      }
      s.lastPixelRef.current = { x: px, y: py };
      return;
    }
    if (!s.isDrawingRef.current || !s.selectedPart) return;
    const selPart = s.selectedPart;
    const color = s.tool === 'eraser' ? null : s.brushColor;
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
    // PixelEdit commit（矫正模式：落到目标节点的当帧逐帧修正）
    if (s.pixelEditCommandRef.current) {
      const rec = s.pixelEditCommandRef.current;
      if (rec.points.length > 0) {
        const cmd: BrushCommand = { id: rec.commandId, type: s.tool === 'eraser' ? 'erase' : 'draw', color: s.brushColor, size: s.brushSize, points: rec.points, blendMode: 'normal', brushStyle: s.brushStyle !== 'solid' ? s.brushStyle : undefined, brushStyleParams: s.brushStyle !== 'solid' ? s.brushStyleParams : undefined, ...(s.compositingMode && (s.styleAspects.length > 0 || s.strokeDrivers.length > 0) ? { styleAspects: s.styleAspects.filter(a => a.enabled), strokeDrivers: s.strokeDrivers.filter(d => d.enabled) } : {}) };
        appendFrameCorrectionCommand(rec, s.currentFrameRef.current, cmd);
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
// Split Node Tool Handler — 点中即拆（PR #54 定案）：命中点定段与 t，
// 核心变换走 store.splitUnifiedNode（lib/node-split），结果点名走 toast
// ---------------------------------------------------------------------------

export const splitNodeHandler: ToolHandler = {
  onMouseDown(s, e, px, py) {
    void e;
    const hit = s.findPuppetNodeAtPixel(px, py);
    if (!hit) {
      toast({ title: '拆分节点', description: '没点中节点——点在要拆的那一段上', variant: 'destructive' });
      return;
    }
    const { node, character } = hit;
    const project = useProjectStore.getState();
    const dir = ((character.nodes[character.rootNodeId]?.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7);
    const wt = computeWorldTransforms(character, project.currentFrame, s.canvasWidth, s.canvasHeight, undefined, undefined, undefined, undefined, geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D));
    const jointPx = (id: string): { x: number; y: number } | null => {
      const w = wt.get(id);
      if (!w) return null;
      const p = projectToView(w.worldX, w.worldY, w.worldZ, dir);
      return { x: subToPx(p.canvasX) + s.canvasWidth / 2, y: subToPx(p.canvasY) + s.canvasHeight / 2 };
    };
    const sp = jointPx(node.id);
    if (!sp) return;
    // 选段：命中点到各子段的垂距最小者（投影须落在段内）
    let childId: string | null = null;
    let t = 0.5;
    let bestDist = Infinity;
    for (const cid of node.children) {
      const cp = jointPx(cid);
      if (!cp) continue;
      const vx = cp.x - sp.x, vy = cp.y - sp.y;
      const len2 = vx * vx + vy * vy;
      if (len2 < 25) continue;
      const proj = ((px - sp.x) * vx + (py - sp.y) * vy) / len2;
      if (proj < 0.02 || proj > 1.05) continue;
      const qx = sp.x + vx * Math.max(0, Math.min(1, proj));
      const qy = sp.y + vy * Math.max(0, Math.min(1, proj));
      const dist = Math.hypot(px - qx, py - qy);
      if (dist < bestDist) { bestDist = dist; childId = cid; t = Math.max(0, Math.min(1, proj)); }
    }
    if (!childId) {
      if (node.children.length > 0) {
        toast({ title: '拆分节点', description: '点在关节附近或段外——点在段的中部', variant: 'destructive' });
        return;
      }
      // 叶子：t 按命中点距关节 / 精灵尖端长估算（lib 按真尖端长再钳制）
      const spriteId = resolveNodeSpriteId(character, node.id, dir, project.sprites);
      const spr = spriteId ? project.sprites[spriteId] : undefined;
      if (spr) {
        const plugX = spr.plug ? subToPx(spr.plug.x) : spr.width / 2;
        const plugY = spr.plug ? subToPx(spr.plug.y) : spr.height / 2;
        const end = computeSpriteEndPoint(spr.width, spr.height, plugX, plugY);
        const tipLen = Math.hypot(end.x, end.y);
        if (tipLen > 1) t = Math.max(0.05, Math.min(0.95, Math.hypot(px - sp.x, py - sp.y) / tipLen));
      }
    }
    const res = project.splitUnifiedNode(character.id, node.id, childId, t);
    if (!res.ok) {
      toast({ title: '拆分失败', description: res.error ?? '未知错误', variant: 'destructive' });
      return;
    }
    const newChar = useProjectStore.getState().unifiedCharacters[character.id];
    const midName = res.midNodeId ? newChar?.nodes[res.midNodeId]?.name : undefined;
    toast({
      title: `已拆分「${node.name}」${midName ? ` → 新关节「${midName}」` : ''}`,
      description: res.report.length > 0 ? res.report.join('；') : '完成（可撤销）',
    });
  },
};

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
    if (tool === 'mark') return markHandler;
  }

  // Node 级分发（新架构；旧画布精灵层分发已随 workspace mode 退役）
  switch (tool) {
    case 'puppet': return puppetHandler;
    case 'split_node': return splitNodeHandler;
    case 'pseudo3d_rotate': return puppetHandler; // 复用 puppet 拖拽，onMouseDown 内按工具名设伪3D标志
    case 'landmark': return landmarkHandler; // 精灵编辑模式外 no-op（handler 内 early return）
    case 'mark': return markHandler; // 同上
    case 'select': return nodeSelectHandler;
    case 'move': return nodeMoveHandler;
    case 'trajectory': return nodeTrajectoryHandler;
    case 'crop': return cropHandler; // 双语义：sprite_edit 裁精灵（resizeSprite 口径），其余裁项目画布
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
