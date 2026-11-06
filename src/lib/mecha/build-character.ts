// ============================================================
// 机甲角色构建：部位精灵 → 产品真角色数据。
// 节点树用静态插座（offset3D = 子关节 − 父关节，静止位形）+
// 姿态角归零，与产品 3D 管线定案同构；精灵插头存关节点。
// 产出 { nodes, rootNodeId, costumeSet }，精灵由调用方先经
// store.addSprite + setSpritePixels 建入全局精灵表后把 id 传入。
// ============================================================
import { createDefaultNode, createDefaultCostumePiece, pxToSub } from '../unified-types';
import type { Node, CostumeSet, CostumePiece, PixelGrid, DirectionIndex } from '../unified-types';
import { generateMechaPartSet, mechaFamilyArmorHex, MECHA_FAMILIES } from './parts';
import type { MechaFamily, MechaPartSet, MechaSpriteData } from './parts';

export type MechaPartKey = 'leg' | 'armUpper' | 'armFore' | 'torso' | 'head';
export const MECHA_PART_KEYS: MechaPartKey[] = ['leg', 'armUpper', 'armFore', 'torso', 'head'];
export const MECHA_PART_LABELS: Record<MechaPartKey, string> = {
  leg: '腿', armUpper: '上臂', armFore: '前臂', torso: '躯干', head: '头',
};

/** 引擎 RGBA → 产品像素格（十六进制色串，透明为 null） */
export function rgbaToPixelGrid(s: MechaSpriteData): PixelGrid {
  const grid: PixelGrid = [];
  for (let y = 0; y < s.height; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < s.width; x++) {
      const i = (y * s.width + x) * 4;
      if (s.rgba[i + 3]! < 128) { row.push(null); continue; }
      const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
      row.push('#' + hex(s.rgba[i]!) + hex(s.rgba[i + 1]!) + hex(s.rgba[i + 2]!));
    }
    grid.push(row);
  }
  return grid;
}

export interface MechaCharacterAssembly {
  nodes: Record<string, Node>;
  rootNodeId: string;
  costumeSet: CostumeSet;
}

/**
 * 组装机甲角色数据（纯函数）。spriteIds = 五件精灵在全局表中的 id
 * （近/远两侧共用同一精灵，靠节点位移与绘制序区分）。
 */
export function assembleMechaCharacter(opts: {
  characterId: string;
  family: MechaFamily;
  canvasSize: { w: number; h: number };
  partSet: MechaPartSet;
  spriteIds: Record<MechaPartKey, string>;
}): MechaCharacterAssembly {
  const { characterId: cid, family, canvasSize, partSet, spriteIds } = opts;
  const SUB = pxToSub;
  const nodes: Record<string, Node> = {};
  const mk = (key: string, name: string, parentKey?: string): Node => {
    const node = createDefaultNode(`node_${cid}_${key}`, name);
    if (parentKey) node.parentId = nodes[parentKey]!.id;
    node.transform = { ...node.transform, variantIndex: 0 as DirectionIndex };
    nodes[key] = node;
    return node;
  };
  const pelvis = mk('pelvis', '骨盆');
  mk('head', '头', 'pelvis');
  mk('arm_upper_N', '上臂·近', 'pelvis');
  mk('arm_fore_N', '前臂·近', 'arm_upper_N');
  mk('arm_upper_F', '上臂·远', 'pelvis');
  mk('arm_fore_F', '前臂·远', 'arm_upper_F');
  mk('leg_N', '腿·近', 'pelvis');
  mk('leg_F', '腿·远', 'pelvis');
  for (const n of Object.values(nodes)) {
    if (n.parentId) {
      const parent = Object.values(nodes).find((p) => p.id === n.parentId)!;
      parent.children = [...parent.children, n.id];
    }
  }
  // 静态插座：offset3D 存子关节相对父关节的静止偏移（全局像素，Y-down）
  const wire = (parentKey: string, key: string, off: { x: number; y: number }) => {
    const parent = nodes[parentKey]!, node = nodes[key]!;
    const sockId = `sock_${parentKey}_${key}`;
    parent.sockets = [...parent.sockets, {
      id: sockId, name: key, basePosition: { x: 0, y: 0 }, directionOffsets: {},
      offset3D: { x: SUB(off.x), y: SUB(off.y), z: 0 },
    }];
    node.attachment = { type: 'socket', parentSocketId: sockId, plug: { x: 0, y: 0 } } as Node['attachment'];
  };
  const S = partSet.torsoSockets;
  wire('pelvis', 'head', S.neck);
  wire('pelvis', 'arm_upper_N', S.shoulder);
  wire('pelvis', 'arm_upper_F', { x: S.shoulder.x - 34, y: S.shoulder.y - 2 });
  wire('pelvis', 'leg_N', { x: S.hip.x + 10, y: S.hip.y - 2 });
  wire('pelvis', 'leg_F', { x: S.hip.x - 24, y: S.hip.y - 4 });
  wire('arm_upper_N', 'arm_fore_N', partSet.elbowOff);
  wire('arm_upper_F', 'arm_fore_F', partSet.elbowOff);
  // 根定位与绘制序（远侧在后、躯干居中、近侧在前）
  // 根定位：横向居中；纵向保证头部不被画布顶裁（角色总高约 790px，
  // 头顶在骨盆上方约 316px），矮画布上脚部溢出由用户平移/缩放解决
  const rootY = Math.max(320, Math.min(canvasSize.h * 0.42, canvasSize.h - 200));
  pelvis.transform = { ...pelvis.transform, x: SUB(canvasSize.w / 2), y: SUB(rootY) };
  pelvis.isCore = true; pelvis.zIndex = 1;
  nodes.head!.zIndex = 2;
  nodes.leg_N!.zIndex = 4; nodes.leg_N!.side = 'L'; // 近腿压近臂（与已验合成序一致）
  nodes.leg_F!.zIndex = 0; nodes.leg_F!.side = 'R';
  nodes.arm_upper_N!.zIndex = 3; nodes.arm_upper_N!.side = 'L';
  nodes.arm_fore_N!.zIndex = 3; nodes.arm_fore_N!.side = 'L';
  nodes.arm_upper_F!.zIndex = 0; nodes.arm_upper_F!.side = 'R';
  nodes.arm_fore_F!.zIndex = 0; nodes.arm_fore_F!.side = 'R';
  // 服装集：一集 = 本族全套；件按节点 id 键，精灵登记在东向（0），
  // 西向由默认镜像表回落，其余方向为单向角色的既有空缺（与装配
  // 向导的逐方向装配同状态）。
  const fill = mechaFamilyArmorHex(family);
  const pieceOf = (nodeKey: string, part: MechaPartKey): CostumePiece => {
    const piece = createDefaultCostumePiece(nodes[nodeKey]!.id, fill);
    piece.sprites = { 0: { spriteId: spriteIds[part] } } as typeof piece.sprites;
    return piece;
  };
  const costumeSet: CostumeSet = {
    id: `costume_${cid}_mecha`,
    name: MECHA_FAMILIES.find((f) => f.id === family)?.name ?? family,
    pieces: {},
  };
  const assign: Record<string, MechaPartKey> = {
    pelvis: 'torso', head: 'head',
    arm_upper_N: 'armUpper', arm_fore_N: 'armFore',
    arm_upper_F: 'armUpper', arm_fore_F: 'armFore',
    leg_N: 'leg', leg_F: 'leg',
  };
  for (const [nodeKey, part] of Object.entries(assign)) {
    const piece = pieceOf(nodeKey, part);
    nodes[nodeKey]!.slot = piece;
    costumeSet.pieces[nodes[nodeKey]!.id] = piece;
  }
  const nodesById: Record<string, Node> = {};
  for (const n of Object.values(nodes)) nodesById[n.id] = n;
  return { nodes: nodesById, rootNodeId: pelvis.id, costumeSet };
}

/** 一站式：生成部位并组装（精灵 id 由调用方预先建好并传入） */
export function buildMechaCharacter(opts: {
  characterId: string;
  family: MechaFamily;
  canvasSize: { w: number; h: number };
  spriteIds: Record<MechaPartKey, string>;
}): { partSet: MechaPartSet; assembly: MechaCharacterAssembly } {
  const partSet = generateMechaPartSet(opts.family);
  const assembly = assembleMechaCharacter({ ...opts, partSet });
  return { partSet, assembly };
}
