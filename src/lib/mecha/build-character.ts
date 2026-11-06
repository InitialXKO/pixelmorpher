// ============================================================
// 机甲角色构建：部位精灵 → 产品真角色数据。
// 节点树用静态插座（offset3D = 子关节 − 父关节，静止位形）+
// 姿态角归零，与产品 3D 管线定案同构；精灵插头存关节点。
// 产出 { nodes, rootNodeId, costumeSet }，精灵由调用方先经
// store.addSprite + setSpritePixels 建入全局精灵表后把 id 传入。
// ============================================================
import { createDefaultNode, createDefaultCostumePiece, pxToSub } from '../unified-types';
import type { Node, CostumeSet, CostumePiece, PixelGrid, DirectionIndex } from '../unified-types';
import { generateMechaPartSet, generateMechaHull, generateMechaHullBody, generateMechaTurret, generateMechaWheelLeg, generateMechaTrackUnit, generateMechaMultiLeg, generateMechaJetpack, generateMechaWeapon, mechaFamilyArmorHex, MECHA_FAMILIES } from './parts';
import type { MechaChestVariant } from './parts';
import type { MechaFamily, MechaPartSet, MechaSpriteData } from './parts';
import type { WeaponKind } from './gear';

export type MechaPartKey = 'leg' | 'armUpper' | 'armFore' | 'torso' | 'head'
  | 'wheelLeg' | 'trackUnit' | 'jetpack' | 'pod' | 'podPylon' | 'cannon' | 'rifle';
/** 基础五件（蓝图机甲源与默认装配用） */
export const MECHA_PART_KEYS: MechaPartKey[] = ['leg', 'armUpper', 'armFore', 'torso', 'head'];
export const MECHA_PART_LABELS: Record<MechaPartKey, string> = {
  leg: '腿', armUpper: '上臂', armFore: '前臂', torso: '躯干', head: '头',
  wheelLeg: '轮足腿', trackUnit: '履带底盘', jetpack: '喷射背包', pod: '导弹荚', podPylon: '导弹荚·高架', cannon: '臂炮', rifle: '步枪',
};

/** 人形构建选项：胸型变体 / 底盘 / 挂载装备（缺省 = 基础双足无装备） */
export interface MechaBuildOptions {
  chest?: MechaChestVariant;
  chassis?: 'biped' | 'wheel' | 'tracks';
  jetpack?: boolean;
  weapon?: 'cannon' | 'rifle' | null;
  podMount?: MechaPodMount | null;
}

/** 导弹荚四挂位（据肩挂不遮头脸四式参考）：后偏/高架/外侧/低位 */
export type MechaPodMount = 'rear' | 'pylon' | 'outboard' | 'low';
export const MECHA_POD_MOUNT_LABELS: Record<MechaPodMount, string> = {
  rear: '后偏肩挂', pylon: '高架背挂', outboard: '外侧肩挂', low: '低位贴胸挂',
};
const POD_MOUNT_WIRE: Record<MechaPodMount, { dx: number; dy: number; from: 'shoulder' | 'hip'; z: number }> = {
  // 荚体原点在底部挂点（高架为撑杆足）；偏移以肩/颈锚点为参照系
  rear: { dx: -100, dy: -146, from: 'hip', z: 2 },
  pylon: { dx: -97, dy: -155, from: 'hip', z: -1 },
  outboard: { dx: 58, dy: 30, from: 'shoulder', z: 4 },
  low: { dx: 34, dy: 62, from: 'shoulder', z: 3 },
};
export const MECHA_CHASSIS_LABELS = { biped: '双足', wheel: '轮足', tracks: '履带' } as const;

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

/** 节点键 → 部位（近/远两侧共用精灵，预览合成与装配共用此表） */
export const MECHA_NODE_PARTS: Record<string, MechaPartKey> = {
  pelvis: 'torso', head: 'head',
  arm_upper_N: 'armUpper', arm_fore_N: 'armFore',
  arm_upper_F: 'armUpper', arm_fore_F: 'armFore',
  leg_N: 'leg', leg_F: 'leg',
};

export interface MechaCharacterAssembly {
  nodes: Record<string, Node>;
  rootNodeId: string;
  costumeSet: CostumeSet;
}

/** 节点键 → 部位键（按构建选项；装配与向导预览共用） */
export function mechaHumanoidNodeParts(build?: MechaBuildOptions): Record<string, string> {
  const B: MechaBuildOptions = build ?? {};
  const chassis = B.chassis ?? 'biped';
  const map: Record<string, string> = {
    pelvis: 'torso', head: 'head',
    arm_upper_N: 'armUpper', arm_fore_N: 'armFore',
    arm_upper_F: 'armUpper', arm_fore_F: 'armFore',
  };
  if (chassis === 'tracks') map.tracks = 'trackUnit';
  else { const leg = chassis === 'wheel' ? 'wheelLeg' : 'leg'; map.leg_N = leg; map.leg_F = leg; }
  if (B.jetpack) map.jetpack = 'jetpack';
  if (B.podMount) map.pod = B.podMount === 'pylon' ? 'podPylon' : 'pod';
  if (B.weapon) map.weapon = B.weapon;
  return map;
}

/** 载具节点键 → 部位键（装配与向导预览共用） */
export function mechaVehicleNodeParts(vehicle: MechaVehicleOptions): Record<string, string> {
  const map: Record<string, string> = { hull: 'hullBody' };
  const mob = vehicle.mobility;
  if (mob === 'tracks') { map.track_N = 'trackUnit'; map.track_F = 'trackUnit'; }
  else if (mob === 'legs') { map.leg_front = 'leg'; map.leg_rear = 'leg'; }
  else if (mob === 'quad') { map.quad_fN = 'multiLeg'; map.quad_fF = 'multiLeg'; map.quad_rN = 'multiLeg'; map.quad_rF = 'multiLeg'; }
  else { for (const k of ['spider_fN', 'spider_mN', 'spider_rN', 'spider_fF', 'spider_mF', 'spider_rF']) map[k] = 'multiLeg'; }
  if (vehicle.turret) map.turret = 'turret';
  return map;
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
  spriteIds: Record<string, string>;
  build?: MechaBuildOptions;
}): MechaCharacterAssembly {
  const { characterId: cid, family, canvasSize, partSet, spriteIds } = opts;
  const B: MechaBuildOptions = opts.build ?? {};
  const chassis = B.chassis ?? 'biped';
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
  if (chassis === 'tracks') mk('tracks', '履带底盘', 'pelvis');
  else { mk('leg_N', '腿·近', 'pelvis'); mk('leg_F', '腿·远', 'pelvis'); }
  if (B.jetpack) mk('jetpack', '喷射背包', 'pelvis');
  if (B.podMount) mk('pod', '导弹荚', 'pelvis');
  if (B.weapon) mk('weapon', B.weapon === 'cannon' ? '臂炮' : '步枪', 'arm_fore_N');
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
  wire('arm_upper_N', 'arm_fore_N', partSet.elbowOff);
  wire('arm_upper_F', 'arm_fore_F', partSet.elbowOff);
  if (chassis === 'tracks') wire('pelvis', 'tracks', { x: S.hip.x, y: S.hip.y + 4 });
  else {
    wire('pelvis', 'leg_N', { x: S.hip.x + 10, y: S.hip.y - 2 });
    wire('pelvis', 'leg_F', { x: S.hip.x - 24, y: S.hip.y - 4 });
  }
  if (B.jetpack) wire('pelvis', 'jetpack', { x: -72, y: -128 });
  if (B.podMount) {
    const w = POD_MOUNT_WIRE[B.podMount];
    const base = w.from === 'shoulder' ? S.shoulder : S.hip;
    wire('pelvis', 'pod', { x: base.x + w.dx, y: base.y + w.dy });
  }
  if (B.weapon) {
    // 武器对齐前臂静止方向（节点角为度）：臂炮原点在腕、步枪原点在掌
    const off = B.weapon === 'cannon' ? partSet.wristOff : partSet.palmOff;
    wire('arm_fore_N', 'weapon', off);
    const deg = Math.atan2(off.y, off.x) * 180 / Math.PI;
    nodes.weapon!.transform = { ...nodes.weapon!.transform, angle: deg };
  }
  // 根定位与绘制序（远侧在后、躯干居中、近侧在前）
  // 根定位：横向居中；纵向保证头部不被画布顶裁（角色总高约 790px，
  // 头顶在骨盆上方约 316px），矮画布上脚部溢出由用户平移/缩放解决
  const rootY = Math.max(320, Math.min(canvasSize.h * 0.42, canvasSize.h - 200));
  pelvis.transform = { ...pelvis.transform, x: SUB(canvasSize.w / 2), y: SUB(rootY) };
  pelvis.isCore = true; pelvis.zIndex = 1;
  nodes.head!.zIndex = 2;
  if (chassis === 'tracks') { nodes.tracks!.zIndex = 0; }
  else {
    nodes.leg_N!.zIndex = 4; nodes.leg_N!.side = 'L'; // 近腿压近臂（与已验合成序一致）
    nodes.leg_F!.zIndex = 0; nodes.leg_F!.side = 'R';
  }
  if (B.jetpack) nodes.jetpack!.zIndex = -1; // 背挂在躯干之后
  if (B.podMount) nodes.pod!.zIndex = POD_MOUNT_WIRE[B.podMount].z;
  if (B.weapon) nodes.weapon!.zIndex = 4;
  nodes.arm_upper_N!.zIndex = 3; nodes.arm_upper_N!.side = 'L';
  nodes.arm_fore_N!.zIndex = 3; nodes.arm_fore_N!.side = 'L';
  nodes.arm_upper_F!.zIndex = 0; nodes.arm_upper_F!.side = 'R';
  nodes.arm_fore_F!.zIndex = 0; nodes.arm_fore_F!.side = 'R';
  // 服装集：一集 = 本族全套；件按节点 id 键，精灵登记在东向（0），
  // 西向由默认镜像表回落，其余方向为单向角色的既有空缺（与装配
  // 向导的逐方向装配同状态）。
  const fill = mechaFamilyArmorHex(family);
  const pieceOf = (nodeKey: string, part: string): CostumePiece => {
    const piece = createDefaultCostumePiece(nodes[nodeKey]!.id, fill);
    piece.sprites = { 0: { spriteId: spriteIds[part] } } as typeof piece.sprites;
    return piece;
  };
  const costumeSet: CostumeSet = {
    id: `costume_${cid}_mecha`,
    name: MECHA_FAMILIES.find((f) => f.id === family)?.name ?? family,
    pieces: {},
  };
  const nodeParts = mechaHumanoidNodeParts(B);
  for (const [nodeKey, part] of Object.entries(nodeParts)) {
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

/** createMechaCharacterInStore 需要的 store 表面（与项目 store 同名同签） */
export interface MechaStoreSurface {
  canvasWidth: number;
  canvasHeight: number;
  addUnifiedCharacter: (name: string, opts?: { skipPlaceholderRoot?: boolean }) => { id: string };
  addSprite: (name: string, width: number, height: number, opts?: { plugX?: number; plugY?: number }) => { id?: string };
  setSpritePixels: (id: string, pixels: PixelGrid) => void;
  updateSprite: (id: string, updates: { origin?: { characterId: string; boneName?: string }; folder?: string }) => void;
  updateUnifiedCharacter: (id: string, updates: Record<string, unknown>) => void;
}

/**
 * 向导的生成动作（唯一实现，组件与校验共用）：建角色 → 五件精灵
 * 入全局表（带出生标签）→ 组装数据一次写入。
 */
export function createMechaCharacterInStore(
  store: MechaStoreSurface,
  opts: { name: string; family: MechaFamily; build?: MechaBuildOptions },
): { characterId: string; costumeSetId: string } {
  const B: MechaBuildOptions = opts.build ?? {};
  const chassis = B.chassis ?? 'biped';
  const partSet = generateMechaPartSet(opts.family, B.chest);
  const character = store.addUnifiedCharacter(opts.name, { skipPlaceholderRoot: true });
  const plan: { key: string; data: MechaSpriteData }[] = [
    { key: 'torso', data: partSet.torso }, { key: 'head', data: partSet.head },
    { key: 'armUpper', data: partSet.armUpper }, { key: 'armFore', data: partSet.armFore },
  ];
  if (chassis === 'biped') plan.push({ key: 'leg', data: partSet.leg });
  if (chassis === 'wheel') plan.push({ key: 'wheelLeg', data: generateMechaWheelLeg(opts.family) });
  if (chassis === 'tracks') plan.push({ key: 'trackUnit', data: generateMechaTrackUnit(opts.family) });
  if (B.jetpack) plan.push({ key: 'jetpack', data: generateMechaJetpack(opts.family) });
  if (B.weapon) plan.push({ key: B.weapon, data: generateMechaWeapon(opts.family, B.weapon) });
  if (B.podMount) { const pk = B.podMount === 'pylon' ? 'podPylon' : 'pod'; plan.push({ key: pk, data: generateMechaWeapon(opts.family, pk) }); }
  const spriteIds: Record<string, string> = {};
  for (const { key, data: s } of plan) {
    const label = MECHA_PART_LABELS[key as MechaPartKey] ?? key;
    const spr = store.addSprite(`${opts.name}_${label}`, s.width, s.height, {
      plugX: Math.round(s.plug.x), plugY: Math.round(s.plug.y),
    });
    store.setSpritePixels(spr.id!, rgbaToPixelGrid(s));
    store.updateSprite(spr.id!, { origin: { characterId: character.id, boneName: key }, folder: '方向/东' });
    spriteIds[key] = spr.id!;
  }
  const assembly = assembleMechaCharacter({
    characterId: character.id, family: opts.family,
    canvasSize: { w: store.canvasWidth, h: store.canvasHeight },
    partSet, spriteIds, build: B,
  });
  store.updateUnifiedCharacter(character.id, {
    nodes: assembly.nodes, rootNodeId: assembly.rootNodeId,
    costumeSets: [assembly.costumeSet], activeCostumeSetId: assembly.costumeSet.id,
  });
  return { characterId: character.id, costumeSetId: assembly.costumeSet.id };
}

// ============================================================
// 载具型角色：车体为根，移动件与炮塔都是真节点。
// 甲板为原点口径：hullBody 精灵插头 = 甲板，移动件挂甲板下方，
// 炮塔挂甲板上方转轴点。
// ============================================================
export interface MechaVehicleOptions {
  hull: 'walker' | 'hauler';
  mobility: 'legs' | 'tracks' | 'quad' | 'spider';
  turret: boolean;
}
export const MECHA_VEHICLE_LABELS = {
  hull: { walker: '步行载具', hauler: '运输载具' },
  mobility: { legs: '步行腿', tracks: '双履带', quad: '四足', spider: '蜘蛛六足' },
} as const;

/** 载具移动件精灵（walker 系橄榄、hauler 系白色敏捷近似 slate） */
export function generateMechaMobilitySprite(hull: 'walker' | 'hauler', mobility: MechaVehicleOptions['mobility']): MechaSpriteData {
  const fam: MechaFamily = hull === 'walker' ? 'olive' : 'agile';
  if (mobility === 'tracks') return generateMechaTrackUnit(fam);
  if (mobility === 'quad') return generateMechaMultiLeg(fam, 'quad');
  if (mobility === 'spider') return generateMechaMultiLeg(fam, 'spider');
  return generateMechaPartSet(fam).leg;
}

export function assembleMechaVehicle(opts: {
  characterId: string;
  canvasSize: { w: number; h: number };
  vehicle: MechaVehicleOptions;
  spriteIds: Record<string, string>;
}): MechaCharacterAssembly {
  const { characterId: cid, canvasSize, vehicle: V } = opts;
  const SUB = pxToSub;
  const nodes: Record<string, Node> = {};
  const mk = (key: string, name: string, parentKey?: string): Node => {
    const node = createDefaultNode(`node_${cid}_${key}`, name);
    if (parentKey) node.parentId = nodes[parentKey]!.id;
    node.transform = { ...node.transform, variantIndex: 0 as DirectionIndex };
    nodes[key] = node;
    return node;
  };
  const hull = mk('hull', V.hull === 'walker' ? '车体·步行' : '车体·运输');
  const mob = V.mobility;
  if (mob === 'tracks') { mk('track_N', '履带·近', 'hull'); mk('track_F', '履带·远', 'hull'); }
  else if (mob === 'legs') { mk('leg_front', '腿·前', 'hull'); mk('leg_rear', '腿·后', 'hull'); }
  else if (mob === 'quad') { mk('quad_fN', '四足·前近', 'hull'); mk('quad_fF', '四足·前远', 'hull'); mk('quad_rN', '四足·后近', 'hull'); mk('quad_rF', '四足·后远', 'hull'); }
  else { mk('spider_fN', '蛛腿·前近', 'hull'); mk('spider_mN', '蛛腿·中近', 'hull'); mk('spider_rN', '蛛腿·后近', 'hull'); mk('spider_fF', '蛛腿·前远', 'hull'); mk('spider_mF', '蛛腿·中远', 'hull'); mk('spider_rF', '蛛腿·后远', 'hull'); }
  if (V.turret) mk('turret', V.hull === 'walker' ? '炮塔' : '顶架', 'hull');
  for (const n of Object.values(nodes)) {
    if (n.parentId) {
      const parent = Object.values(nodes).find((p) => p.id === n.parentId)!;
      parent.children = [...parent.children, n.id];
    }
  }
  const wire = (key: string, off: { x: number; y: number }, angleDeg = 0) => {
    const parent = nodes.hull!, node = nodes[key]!;
    const sockId = `sock_hull_${key}`;
    parent.sockets = [...parent.sockets, {
      id: sockId, name: key, basePosition: { x: 0, y: 0 }, directionOffsets: {},
      offset3D: { x: SUB(off.x), y: SUB(off.y), z: 0 },
    }];
    node.attachment = { type: 'socket', parentSocketId: sockId, plug: { x: 0, y: 0 } } as Node['attachment'];
    if (angleDeg) node.transform = { ...node.transform, angle: angleDeg };
  };
  // 甲板下沿约 +110（车体底边）：移动件座/髋挂此带
  if (mob === 'tracks') { wire('track_F', { x: -14, y: 108 }); wire('track_N', { x: 14, y: 112 }); }
  else if (mob === 'legs') { wire('leg_rear', { x: -74, y: 110 }); wire('leg_front', { x: 74, y: 110 }); }
  else if (mob === 'quad') { wire('quad_fF', { x: 66, y: 104 }); wire('quad_rF', { x: -90, y: 104 }); wire('quad_fN', { x: 78, y: 110 }); wire('quad_rN', { x: -78, y: 110 }); }
  else {
    wire('spider_fF', { x: 62, y: 104 }, -17); wire('spider_mF', { x: -8, y: 108 }, 0); wire('spider_rF', { x: -86, y: 104 }, 17);
    wire('spider_fN', { x: 74, y: 112 }, -24); wire('spider_mN', { x: 0, y: 116 }, 0); wire('spider_rN', { x: -74, y: 112 }, 24);
  }
  if (V.turret) wire('turret', V.hull === 'walker' ? { x: -15, y: -18 } : { x: -16, y: -17 });
  // 根定位：纵向留移动件下探空间（蜘蛛最深约 deck+102+腿高 240）
  const depth = mob === 'spider' ? 350 : mob === 'tracks' ? 235 : 330;
  const rootY = Math.max(240, Math.min(canvasSize.h * 0.34, canvasSize.h - depth * 0.55));
  hull.transform = { ...hull.transform, x: SUB(canvasSize.w / 2), y: SUB(rootY) };
  hull.isCore = true; hull.zIndex = 1;
  const zset: Record<string, [number, 'L' | 'R' | undefined]> = {
    track_F: [0, 'R'], track_N: [2, 'L'],
    leg_rear: [0, 'R'], leg_front: [3, 'L'],
    quad_fF: [0, 'R'], quad_rF: [0, 'R'], quad_fN: [3, 'L'], quad_rN: [3, 'L'],
    spider_fF: [0, 'R'], spider_mF: [0, 'R'], spider_rF: [0, 'R'],
    spider_fN: [3, 'L'], spider_mN: [3, 'L'], spider_rN: [3, 'L'],
    turret: [2, undefined],
  };
  for (const [k, [z, side]] of Object.entries(zset)) {
    if (!nodes[k]) continue;
    nodes[k]!.zIndex = z;
    if (side) nodes[k]!.side = side;
  }
  const fill = mechaFamilyArmorHex(V.hull === 'walker' ? 'olive' : 'agile');
  const nodeParts = mechaVehicleNodeParts(V);
  const costumeSet: CostumeSet = {
    id: `costume_${cid}_vehicle`,
    name: MECHA_VEHICLE_LABELS.hull[V.hull],
    pieces: {},
  };
  for (const [nodeKey, part] of Object.entries(nodeParts)) {
    const piece = createDefaultCostumePiece(nodes[nodeKey]!.id, fill);
    piece.sprites = { 0: { spriteId: opts.spriteIds[part]! } } as typeof piece.sprites;
    nodes[nodeKey]!.slot = piece;
    costumeSet.pieces[nodes[nodeKey]!.id] = piece;
  }
  const nodesById: Record<string, Node> = {};
  for (const n of Object.values(nodes)) nodesById[n.id] = n;
  return { nodes: nodesById, rootNodeId: hull.id, costumeSet };
}

/** 向导的载具生成动作：车体 + 移动件 + 炮塔精灵入表 → 组装写入 */
export function createMechaVehicleInStore(
  store: MechaStoreSurface,
  opts: { name: string; vehicle: MechaVehicleOptions },
): { characterId: string; costumeSetId: string } {
  const V = opts.vehicle;
  const character = store.addUnifiedCharacter(opts.name, { skipPlaceholderRoot: true });
  const plan: { key: string; label: string; data: MechaSpriteData }[] = [
    { key: 'hullBody', label: '车体', data: generateMechaHullBody(V.hull) },
    { key: 'mobility', label: MECHA_VEHICLE_LABELS.mobility[V.mobility], data: generateMechaMobilitySprite(V.hull, V.mobility) },
  ];
  if (V.turret) plan.push({ key: 'turret', label: V.hull === 'walker' ? '炮塔' : '顶架', data: generateMechaTurret(V.hull) });
  const spriteIds: Record<string, string> = {};
  for (const { key, label, data: s } of plan) {
    const spr = store.addSprite(`${opts.name}_${label}`, s.width, s.height, {
      plugX: Math.round(s.plug.x), plugY: Math.round(s.plug.y),
    });
    store.setSpritePixels(spr.id!, rgbaToPixelGrid(s));
    store.updateSprite(spr.id!, { origin: { characterId: character.id, boneName: key }, folder: '方向/东' });
    spriteIds[key] = spr.id!;
  }
  // 移动件在装配里按用途键引用（trackUnit/leg/multiLeg），与计划键对齐
  spriteIds.trackUnit = spriteIds.mobility!;
  spriteIds.leg = spriteIds.mobility!;
  spriteIds.multiLeg = spriteIds.mobility!;
  const assembly = assembleMechaVehicle({
    characterId: character.id,
    canvasSize: { w: store.canvasWidth, h: store.canvasHeight },
    vehicle: V, spriteIds,
  });
  store.updateUnifiedCharacter(character.id, {
    nodes: assembly.nodes, rootNodeId: assembly.rootNodeId,
    costumeSets: [assembly.costumeSet], activeCostumeSetId: assembly.costumeSet.id,
  });
  return { characterId: character.id, costumeSetId: assembly.costumeSet.id };
}

// ---- 蓝图机甲源节点的像素供给（生成是秒级重活，按 族:部位 缓存） ----
const mechaPartSetCache = new Map<MechaFamily, MechaPartSet>();
const mechaGridCache = new Map<string, PixelGrid>();

/** 按族+部位取像素格；part 可为五件之一或 hullWalker/hullHauler */
export function getMechaPartGrid(family: string, part: string): PixelGrid | null {
  const key = family + ':' + part;
  const hit = mechaGridCache.get(key);
  if (hit) return hit;
  let data: MechaSpriteData | null = null;
  if (part === 'hullWalker') data = generateMechaHull('walker');
  else if (part === 'hullHauler') data = generateMechaHull('hauler');
  else if ((MECHA_PART_KEYS as string[]).includes(part)) {
    const fam = (MECHA_FAMILIES.some((f) => f.id === family) ? family : 'olive') as MechaFamily;
    let ps = mechaPartSetCache.get(fam);
    if (!ps) { ps = generateMechaPartSet(fam); mechaPartSetCache.set(fam, ps); }
    data = ps[part as MechaPartKey];
  }
  if (!data) return null;
  const grid = rgbaToPixelGrid(data);
  mechaGridCache.set(key, grid);
  return grid;
}
