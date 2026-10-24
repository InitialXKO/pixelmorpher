/**
 * 父级切换（抓握/放下）的著者操作：在指定帧把节点重挂到新父级，并
 * 自动在该帧补 x/y/angle/tilt 补偿键，使切换帧的世界位姿不变——
 * 之后节点自然跟随新父级（补偿只对切换瞬间求逆，位置走父级坐标
 * 系的线性求解、角度走坐标系复合求逆，tilt=0 时与标量角口径一致）。
 * 深度（z）无轨道通道，残差单独报告（2D 场景恒为 0）。
 */
import type {
  Character, KeyframeTrack, NodeTracks, ParentKeyValue,
} from './unified-types';
import {
  subToPx, pxToSub, applyFrameRotation, mat3Mul, mat3Transpose, frameViewAngle,
} from './unified-types';
import { computeWorldTransforms, effectiveCharacterAt, socketOffsetTo3D } from './unified-render';

function upsertKey<T>(track: KeyframeTrack<T> | undefined, frame: number, value: T): KeyframeTrack<T> {
  const keyframes = [...(track?.keyframes ?? []).filter((k) => k.frame !== frame), { frame, value }]
    .sort((a, b) => a.frame - b.frame);
  return { keyframes, interpolation: track?.interpolation ?? 'linear' };
}

export interface ParentSwitchPlan {
  /** 写回 node.tracks 的完整新轨道（父级键 + 补偿键已并入） */
  tracks: NodeTracks;
  /** 深度残差（px）：无 z 轨道可补，>1 时 UI 应提示 */
  zResidualPx: number;
}

export function planParentSwitch(
  character: Character,
  nodeId: string,
  frame: number,
  newParentId: string,
  socketId: string | null | undefined,
  frameRate = 12,
): ParentSwitchPlan | null {
  const node = character.nodes[nodeId];
  if (!node || nodeId === character.rootNodeId) return null;
  const parentIdResolved = newParentId === '' ? character.rootNodeId : newParentId;
  const parentNode = character.nodes[parentIdResolved];
  if (!parentNode) return null;
  // 目标不得是自身或其静态后代（成环在源头拒绝）
  for (let p: string | undefined = parentIdResolved; p; p = character.nodes[p]?.parentId) {
    if (p === nodeId) return null;
  }

  const oldT = computeWorldTransforms(character, frame, 0, 0, frameRate).get(nodeId);
  if (!oldT) return null;

  // 先只落父级键算一遍：新父级的世界系 + 节点在新父级下未补偿的位姿
  const parentKey: ParentKeyValue = { parentId: newParentId, socketId };
  let tracks: NodeTracks = {
    ...(node.tracks ?? {}),
    parentKeys: upsertKey(node.tracks?.parentKeys, frame, parentKey),
  };
  const tentative: Character = {
    ...character,
    nodes: { ...character.nodes, [nodeId]: { ...node, tracks } },
  };
  const newT = computeWorldTransforms(tentative, frame, 0, 0, frameRate);
  const parentT = newT.get(parentIdResolved);
  const nodeAfter = newT.get(nodeId);
  if (!parentT || !nodeAfter) return null;

  // 位置求解：worldPos = parentPos + A(socket + local)，A 为父级坐标
  // 系旋转（正交），A⁻¹ = Aᵀ，用基向量探测列向量后转置求逆
  const dir = parentT.variantIndex;
  const colX = applyFrameRotation(parentT.worldFrame, 1, 0, 0, dir);
  const colY = applyFrameRotation(parentT.worldFrame, 0, 1, 0, dir);
  const colZ = applyFrameRotation(parentT.worldFrame, 0, 0, 1, dir);
  const applyInv = (vx: number, vy: number, vz: number) => ({
    x: colX.x * vx + colX.y * vy + colX.z * vz,
    y: colY.x * vx + colY.y * vy + colY.z * vz,
    z: colZ.x * vx + colZ.y * vy + colZ.z * vz,
  });
  const total = applyInv(
    subToPx(oldT.worldX) - subToPx(parentT.worldX),
    subToPx(oldT.worldY) - subToPx(parentT.worldY),
    subToPx(oldT.worldZ) - subToPx(parentT.worldZ),
  );
  // FK 实际用的连接偏移（与 tentative 的有效 attachment 同口径）
  const effNode = effectiveCharacterAt(tentative, frame).nodes[nodeId];
  let sock = { x: 0, y: 0, z: 0 };
  if (effNode?.attachment.type === 'socket' && effNode.attachment.parentSocketId) {
    const socket = parentNode.sockets?.find((s) => s.id === effNode.attachment.parentSocketId);
    if (socket) sock = socketOffsetTo3D(socket, dir);
  } else if (effNode) {
    sock = {
      x: subToPx(effNode.attachment.fixedOffset?.x ?? 0),
      y: subToPx(effNode.attachment.fixedOffset?.y ?? 0),
      z: 0,
    };
  }
  const localPx = { x: total.x - sock.x, y: total.y - sock.y, z: total.z - sock.z };
  const stretch = nodeAfter.worldStretch || 1;
  const xKey = pxToSub(localPx.x) as unknown as number;
  const yKey = pxToSub(localPx.y / stretch) as unknown as number;
  const zResidualPx = localPx.z - subToPx(node.transform.z ?? 0);

  // 角度求解：local 坐标系 = 父坐标系⁻¹ · 期望世界坐标系
  const localFrame = node.attachment.inheritRotation === false
    ? oldT.worldFrame
    : mat3Mul(mat3Transpose(parentT.worldFrame), oldT.worldFrame);
  const angleKey = frameViewAngle(localFrame);
  const tiltKey = (Math.atan2(localFrame[7]!, Math.hypot(localFrame[1]!, localFrame[4]!)) * 180) / Math.PI;

  tracks = {
    ...tracks,
    x: upsertKey(tracks.x, frame, xKey),
    y: upsertKey(tracks.y, frame, yKey),
    angle: upsertKey(tracks.angle, frame, angleKey),
    tilt: upsertKey(tracks.tilt, frame, tiltKey),
  };
  return { tracks, zResidualPx };
}
