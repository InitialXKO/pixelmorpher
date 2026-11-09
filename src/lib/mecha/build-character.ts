// ============================================================
// 机甲角色构建：部位精灵 → 产品真角色数据。
//
// 接线口径（与产品自家笔触建骨 stroke-build 同构，渲染器实测）：
// - 朝向统一东向（variantIndex 0）。东向投影下：模型 z = 前向
//   （画布横轴）、模型 y = 纵向、模型 x = 侧深（depth = −x：近侧
//   取负、远侧取正，深度主导画序，节点 zIndex 只作同深度次键）。
// - 结构插座（骨盆→头/肩根/髋根、挂载件）：offset3D 写
//   { x: 侧深, y: 纵, z: 前向 }。
// - 肢链（臂/腿）：笔触 2D 口径——子插座 basePosition (0, 骨长)、
//   节点角 = 骨向角（根为绝对角、余为相对父角，θ=atan2(−dx,dy)，
//   0 = 正下），精灵按规范直姿出图、插头在近端关节。
// - 每条肢链顺手配一条 2bone IK 链（默认禁用，目标=静止尖端位），
//   与笔触向导同口径，用户在 IK 面板启用/改目标即可用；导出走
//   角色 ikChains 既有通道（烘焙/实时档）。
// 产出 { nodes, rootNodeId, costumeSet, ikChains }，精灵由调用方
// 先经 store 建入全局精灵表后把 id 传入。
// ============================================================
import { createDefaultNode, createDefaultCostumePiece, pxToSub } from '../unified-types';
import type { Node, CostumeSet, CostumePiece, PixelGrid, DirectionIndex, IKChain } from '../unified-types';
import { generateMechaPartSet, generateMechaHull, generateMechaHullBody, generateMechaTurret, generateMechaTrackUnit, generateMechaTrackUnitPhases, MECHA_TRACK_DRIVE_STEP, generateMechaJetpack, generateMechaWeapon, generateMechaWheelLegParts, generateMechaWheelLegPhases, MECHA_WHEEL_DRIVE_STEP, generateMechaMultiLegParts, mechaFamilyArmorHex, MECHA_FAMILIES, MECHA_VEHICLE_PROPORTION_DEFAULTS, WEAPON_PRESETS } from './parts';

/** 武器挂载口径：预设的 mount 决定精灵槽位键与挂点（前臂套装/手握） */
const weaponMountOf = (presetId?: string | null): 'forearm' | 'hand' => (presetId ? WEAPON_PRESETS[presetId]?.mount : undefined) === 'forearm' ? 'forearm' : 'hand';
const weaponSlotKey = (presetId?: string | null): 'cannon' | 'rifle' => weaponMountOf(presetId) === 'forearm' ? 'cannon' : 'rifle';

/** 载具比例生效值（用户值 ?? 载具默认）：腿长倍率与车体覆盖（含车高倍率） */
export const vehLegMul = (V: MechaVehicleOptions): number => V.parts?.proportions?.leg ?? MECHA_VEHICLE_PROPORTION_DEFAULTS[V.hull].leg;
const vehHullOv = (V: MechaVehicleOptions): MechaHullOverrides => ({
  ...(V.parts?.hull ?? {}),
  hullHMul: (V.parts?.hull?.hullHMul ?? 1) * (V.parts?.proportions?.hullH ?? MECHA_VEHICLE_PROPORTION_DEFAULTS[V.hull].hullH),
});
import type { MechaChestVariant } from './parts';
import type { MechaFamily, MechaPartSet, MechaSpriteData, MechaPartOverrides, MechaHullOverrides, MechaLegOverrides, MechaSchemeName } from './parts';
import { applySurface, type SurfaceChoice } from './surface';

export type MechaPartKey = 'leg' | 'legThigh' | 'legShin' | 'legFoot' | 'armUpper' | 'armFore' | 'armHand' | 'torso' | 'head'
  | 'wheelThigh' | 'wheelShin' | 'wheelFoot' | 'multiUpper' | 'multiMid' | 'multiFoot' | 'trackUnit' | 'jetpack' | 'pod' | 'podPylon' | 'cannon' | 'rifle';
/** 基础五件（蓝图机甲源用） */
export const MECHA_PART_KEYS: MechaPartKey[] = ['leg', 'armUpper', 'armFore', 'torso', 'head'];
export const MECHA_PART_LABELS: Record<MechaPartKey, string> = {
  leg: '腿', legThigh: '大腿', legShin: '小腿', legFoot: '足', armUpper: '上臂', armFore: '前臂', armHand: '手', torso: '躯干', head: '头',
  wheelThigh: '轮足大腿', wheelShin: '轮足小腿', wheelFoot: '轮组足', multiUpper: '多足上段', multiMid: '多足中段', multiFoot: '多足足段',
  trackUnit: '履带底盘', jetpack: '喷射背包', pod: '导弹荚', podPylon: '导弹荚·高架', cannon: '臂炮', rifle: '步枪',
};

/** 人形构建选项：胸型变体 / 底盘 / 挂载装备（缺省 = 基础双足无装备） */
export interface MechaBuildOptions {
  chest?: MechaChestVariant;
  chassis?: 'biped' | 'wheel' | 'tracks';
  jetpack?: boolean;
  /** 手持/臂载武器预设 id（gear WEAPON_PRESETS：臂炮/步枪/光束步枪/长刀…） */
  weapon?: string | null;
  /** 武器组合覆盖（部件轴差量，覆盖所选预设的组合） */
  weaponCombo?: Partial<import('./parts').WeaponCombo>;
  podMount?: MechaPodMount | null;
  /** 导弹荚组合覆盖（弹列数等） */
  podCombo?: Partial<import('./parts').WeaponCombo>;
  /** 部件覆盖（配色/足型/拓扑/各部件变体与参数，稀疏：只写改过的） */
  parts?: MechaPartOverrides;
  /** 履带长度（底盘为履带时） */
  trackLen?: number;
  /** 武器尺寸倍率（长向 x / 厚向 y），作用于全部武器（臂炮/步枪/导弹荚）；缺省 1 */
  weaponSize?: { x: number; y: number };
  /** 整机比例（部位间比例倍率组；缺省走族默认 MECHA_PROPORTION_DEFAULTS） */
  proportions?: import('./parts').MechaProportions;
  /** 表面材质（模板 + 参数）：作用于全部部件 */
  surface?: SurfaceChoice;
}

/** 导弹荚四挂位（据肩挂不遮头脸四式参考）：后偏/高架/外侧/低位 */
export type MechaPodMount = 'rear' | 'pylon' | 'outboard' | 'low';
export const MECHA_POD_MOUNT_LABELS: Record<MechaPodMount, string> = {
  rear: '后偏肩挂', pylon: '高架背挂', outboard: '外侧肩挂', low: '低位贴胸挂',
};
/** 挂位接线（模型坐标：side 侧深 / down 纵 / fwd 前向；z = 同深度次键） */
const POD_MOUNT_WIRE: Record<MechaPodMount, { side: number; down: number; fwd: number; z: number }> = {
  rear: { side: 0, down: -146, fwd: -100, z: 2 },
  pylon: { side: 0, down: -155, fwd: -97, z: -1 },
  outboard: { side: -18, down: -161, fwd: 103, z: 4 },
  low: { side: -10, down: -129, fwd: 79, z: 3 },
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

/** 精灵最近邻缩放（尺寸设置用；插头同步缩放） */
export function scaleSpriteData(s: MechaSpriteData, scale: number): MechaSpriteData {
  if (Math.abs(scale - 1) < 1e-6) return s;
  const w = Math.max(1, Math.round(s.width * scale)), h = Math.max(1, Math.round(s.height * scale));
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(s.width - 1, Math.floor(x / scale)), sy = Math.min(s.height - 1, Math.floor(y / scale));
    rgba.set(s.rgba.subarray((sy * s.width + sx) * 4, (sy * s.width + sx) * 4 + 4), (y * w + x) * 4);
  }
  return { rgba, width: w, height: h, plug: { x: s.plug.x * scale, y: s.plug.y * scale } };
}

// ---------- 接线小工具（组装内部共用） ----------
const SUB = pxToSub;
type NodeMap = Record<string, Node>;

function mkNode(nodes: NodeMap, cid: string, key: string, name: string, parentKey?: string, angle = 0): Node {
  const node = createDefaultNode(`node_${cid}_${key}`, name);
  if (parentKey) node.parentId = nodes[parentKey]!.id;
  node.transform = { ...node.transform, variantIndex: 0 as DirectionIndex, angle };
  nodes[key] = node;
  return node;
}

function linkChildren(nodes: NodeMap): void {
  for (const n of Object.values(nodes)) {
    if (n.parentId) {
      const parent = Object.values(nodes).find((p) => p.id === n.parentId)!;
      parent.children = [...parent.children, n.id];
    }
  }
}

/** 结构插座：offset3D = { x: 侧深, y: 纵, z: 前向 }（像素，调用方已乘尺寸） */
function sock3(nodes: NodeMap, parentKey: string, childKey: string, side: number, down: number, fwd: number): void {
  const parent = nodes[parentKey]!, node = nodes[childKey]!;
  const sockId = `sock_${childKey}`;
  parent.sockets = [...parent.sockets, {
    id: sockId, name: childKey, basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: SUB(side), y: SUB(down), z: SUB(fwd) },
  }];
  node.attachment = { type: 'socket', parentSocketId: sockId, plug: { x: 0, y: 0 } } as Node['attachment'];
}

/** 肢链插座：笔触口径 basePosition (0, 骨长)，无 offset3D */
function sockLimb(nodes: NodeMap, parentKey: string, childKey: string, lenPx: number): void {
  const parent = nodes[parentKey]!, node = nodes[childKey]!;
  const sockId = `sock_${childKey}`;
  parent.sockets = [...parent.sockets, {
    id: sockId, name: childKey, basePosition: { x: 0, y: SUB(Math.max(0, lenPx)) }, directionOffsets: {},
  }];
  node.attachment = { type: 'socket', parentSocketId: sockId, plug: { x: 0, y: 0 } } as Node['attachment'];
}

/** 骨向单位向量（设计平面：f 前向 / d 纵；θ 度，0=正下） */
function dirOf(deg: number): { f: number; d: number } {
  const t = (deg * Math.PI) / 180;
  return { f: -Math.sin(t), d: Math.cos(t) };
}

export interface MechaCharacterAssembly {
  nodes: Record<string, Node>;
  rootNodeId: string;
  costumeSet: CostumeSet;
  ikChains: IKChain[];
}

function buildCostumeSet(cid: string, suffix: string, name: string, nodes: NodeMap, nodeParts: Record<string, string>, spriteIds: Record<string, string>, fill: string): CostumeSet {
  const costumeSet: CostumeSet = { id: `costume_${cid}_${suffix}`, name, pieces: {} };
  for (const [nodeKey, part] of Object.entries(nodeParts)) {
    if (!nodes[nodeKey] || !spriteIds[part]) continue;
    const piece: CostumePiece = createDefaultCostumePiece(nodes[nodeKey]!.id, fill);
    piece.sprites = { 0: { spriteId: spriteIds[part]! } } as typeof piece.sprites;
    nodes[nodeKey]!.slot = piece;
    costumeSet.pieces[nodes[nodeKey]!.id] = piece;
  }
  return costumeSet;
}

/** 人形节点→部位映射（装配与向导预览共用，随构建选项变化） */
export function mechaHumanoidNodeParts(build?: MechaBuildOptions): Record<string, string> {
  const B = build ?? {};
  const wheel = B.chassis === 'wheel';
  const map: Record<string, string> = {
    pelvis: 'torso', head: 'head',
    arm_upper_N: 'armUpper', arm_fore_N: 'armFore', arm_hand_N: 'armHand',
    arm_upper_F: 'armUpper', arm_fore_F: 'armFore', arm_hand_F: 'armHand',
  };
  if (B.chassis !== 'tracks') {
    for (const s of ['N', 'F'] as const) {
      map[`leg_thigh_${s}`] = wheel ? 'wheelThigh' : 'legThigh';
      map[`leg_shin_${s}`] = wheel ? 'wheelShin' : 'legShin';
      map[`leg_foot_${s}`] = wheel ? 'wheelFoot' : 'legFoot';
    }
  } else {
    map.tracks = 'trackUnit';
  }
  if (B.jetpack) map.jetpack = 'jetpack';
  if (B.podMount) map.pod = B.podMount === 'pylon' ? 'podPylon' : 'pod';
  if (B.weapon) map.weapon = weaponSlotKey(B.weapon);
  return map;
}
export const MECHA_NODE_PARTS: Record<string, string> = mechaHumanoidNodeParts();

const SIDE_SIGN = { N: -1, F: 1 } as const; // 近侧 x 取负（depth=−x 更大=更靠前）

/** 纯组装（精灵 id 由调用方备好后传入）：人形 */
export function assembleMechaCharacter(opts: {
  characterId: string;
  family: MechaFamily;
  canvasSize: { w: number; h: number };
  partSet: MechaPartSet;
  spriteIds: Record<string, string>;
  build?: MechaBuildOptions;
  scale?: number;
}): MechaCharacterAssembly {
  const { characterId: cid, canvasSize, partSet: ps } = opts;
  const B = opts.build ?? {};
  const sc = opts.scale ?? 1;
  const S = ps.torsoSockets;
  const G = ps.geom, R = ps.rest;
  const nodes: NodeMap = {};
  const mk = (key: string, name: string, parentKey?: string, angle = 0) => mkNode(nodes, cid, key, name, parentKey, angle);

  mk('pelvis', '骨盆·躯干');
  mk('head', '头', 'pelvis');
  for (const s of ['N', 'F'] as const) {
    const tag = s === 'N' ? '近' : '远';
    mk(`arm_upper_${s}`, `上臂·${tag}`, 'pelvis', R.armUpper);
    mk(`arm_fore_${s}`, `前臂·${tag}`, `arm_upper_${s}`, R.armFore);
    mk(`arm_hand_${s}`, `手·${tag}`, `arm_fore_${s}`, 0);
    if (B.chassis !== 'tracks') {
      mk(`leg_thigh_${s}`, `大腿·${tag}`, 'pelvis', R.legThigh);
      mk(`leg_shin_${s}`, `小腿·${tag}`, `leg_thigh_${s}`, R.legShin);
      mk(`leg_foot_${s}`, `足·${tag}`, `leg_shin_${s}`, R.legFoot);
    }
  }
  if (B.chassis === 'tracks') mk('tracks', '履带底盘', 'pelvis');
  if (B.jetpack) mk('jetpack', '喷射背包', 'pelvis');
  if (B.podMount) mk('pod', '导弹荚', 'pelvis');
  if (B.weapon) mk('weapon', WEAPON_PRESETS[B.weapon]?.label ?? '武器', weaponMountOf(B.weapon) === 'forearm' ? 'arm_fore_N' : 'arm_hand_N');
  linkChildren(nodes);

  // 结构插座（模型坐标：x 侧深 / y 纵 / z 前向，均 × 尺寸）
  sock3(nodes, 'pelvis', 'head', 0, S.neck.y * sc, S.neck.x * sc);
  for (const s of ['N', 'F'] as const) {
    const sg = SIDE_SIGN[s];
    sock3(nodes, 'pelvis', `arm_upper_${s}`, sg * 14 * sc, (S.shoulder.y + (s === 'F' ? -2 : 0)) * sc, (S.shoulder.x + (s === 'F' ? -6 : 0)) * sc);
    sockLimb(nodes, `arm_upper_${s}`, `arm_fore_${s}`, G.upperLen * sc);
    sockLimb(nodes, `arm_fore_${s}`, `arm_hand_${s}`, G.foreLen * sc);
    if (B.chassis !== 'tracks') {
      sock3(nodes, 'pelvis', `leg_thigh_${s}`, sg * 12 * sc, (S.hip.y + (s === 'N' ? -2 : -4)) * sc, (S.hip.x + (s === 'N' ? 10 : 2)) * sc);
      sockLimb(nodes, `leg_thigh_${s}`, `leg_shin_${s}`, G.thighLen * sc);
      sockLimb(nodes, `leg_shin_${s}`, `leg_foot_${s}`, G.shinLen * sc);
    }
  }
  if (B.chassis === 'tracks') sock3(nodes, 'pelvis', 'tracks', 0, 4 * sc, 0);
  if (B.jetpack) sock3(nodes, 'pelvis', 'jetpack', 0, -128 * sc, -72 * sc);
  if (B.podMount) { const w = POD_MOUNT_WIRE[B.podMount]; sock3(nodes, 'pelvis', 'pod', w.side * sc, w.down * sc, w.fwd * sc); }
  // 武器朝向铁律：武器固定在肢体坐标系里、随肢体走——臂炮与前臂
  // 同轴（套筒即前臂的一部分），步枪以固定握角挂在手上；静止垂臂
  // 时两者都顺臂朝下，抬臂时随臂抬起。禁止用抵消臂角的方式让武器
  // 脱离肢体朝向（小臂朝下而武器平举朝前是几何不成立的乱改）。
  if (B.weapon && weaponMountOf(B.weapon) === 'forearm') { sockLimb(nodes, 'arm_fore_N', 'weapon', Math.round(G.foreLen * 0.35) * sc); nodes.weapon!.transform = { ...nodes.weapon!.transform, angle: 90 }; } // 挂点在前臂中段：套筒覆住前臂后半、炮口顺臂越过拳端
  if (B.weapon && weaponMountOf(B.weapon) === 'hand') { sockLimb(nodes, 'arm_hand_N', 'weapon', 10 * sc); nodes.weapon!.transform = { ...nodes.weapon!.transform, angle: 90 }; }

  // 根定位（根 x 存画布中心口径，与既有角色一致）
  const rootY = Math.max(320, Math.min(canvasSize.h * 0.42, 800));
  const pelvis = nodes.pelvis!;
  pelvis.transform = { ...pelvis.transform, x: SUB(canvasSize.w / 2), y: SUB(rootY) };
  pelvis.isCore = true;

  // 画序次键（同深度内）：深度（侧深 x）为主键，zIndex 只作次键
  const zset: Record<string, number> = { pelvis: 1, head: 2, tracks: 0, jetpack: -1 };
  for (const s of ['N', 'F'] as const) {
    const zArm = s === 'N' ? 3 : 0, zLeg = s === 'N' ? 4 : 0;
    zset[`arm_upper_${s}`] = zArm; zset[`arm_fore_${s}`] = zArm; zset[`arm_hand_${s}`] = zArm;
    zset[`leg_thigh_${s}`] = zLeg; zset[`leg_shin_${s}`] = zLeg; zset[`leg_foot_${s}`] = zLeg;
    const sideVal = s === 'N' ? 'L' : 'R';
    for (const k of [`arm_upper_${s}`, `arm_fore_${s}`, `arm_hand_${s}`, `leg_thigh_${s}`, `leg_shin_${s}`, `leg_foot_${s}`]) {
      if (nodes[k]) nodes[k]!.side = sideVal as Node['side'];
    }
  }
  if (B.weapon) zset.weapon = 4;
  if (B.podMount) zset.pod = POD_MOUNT_WIRE[B.podMount].z;
  for (const [k, z] of Object.entries(zset)) if (nodes[k]) nodes[k]!.zIndex = z;

  // IK 链（笔触口径顺手配链：2bone、默认禁用、目标=静止尖端位）
  const ikChains: IKChain[] = [];
  const mkChain = (key: string, name: string, rootKey: string, endKey: string, tipF: number, tipD: number, sideDepth: number) => {
    ikChains.push({
      id: `ik_${cid}_${key}`, name,
      rootNodeId: nodes[rootKey]!.id, endNodeId: nodes[endKey]!.id,
      target: { x: canvasSize.w / 2 + tipF, y: rootY + tipD },
      target3D: { x: sideDepth, y: tipD, z: tipF },
      solver: '2bone', bendDir: 1, enabled: false,
    });
  };
  for (const s of ['N', 'F'] as const) {
    const tag = s === 'N' ? '近' : '远';
    const shF = (S.shoulder.x + (s === 'F' ? -6 : 0)) * sc, shD = (S.shoulder.y + (s === 'F' ? -2 : 0)) * sc;
    const d1 = dirOf(R.armUpper), d2 = dirOf(R.armUpper + R.armFore);
    const elF = shF + d1.f * G.upperLen * sc, elD = shD + d1.d * G.upperLen * sc;
    const wrF = elF + d2.f * G.foreLen * sc, wrD = elD + d2.d * G.foreLen * sc;
    mkChain(`arm_${s}`, `手臂·${tag}`, `arm_upper_${s}`, `arm_hand_${s}`, wrF + d2.f * G.foreLen * sc, wrD + d2.d * G.foreLen * sc, SIDE_SIGN[s] * 14 * sc);
    if (B.chassis !== 'tracks') {
      const hipF = (S.hip.x + (s === 'N' ? 10 : 2)) * sc, hipD = (S.hip.y + (s === 'N' ? -2 : -4)) * sc;
      const e1 = dirOf(R.legThigh), e2 = dirOf(R.legThigh + R.legShin), e3 = dirOf(R.legThigh + R.legShin + R.legFoot + R.legToeAbs); // e3 是趾向（几何方向）：足节点角是位图旋转口径，趾向须再加规范趾向
      const knF = hipF + e1.f * G.thighLen * sc, knD = hipD + e1.d * G.thighLen * sc;
      const anF = knF + e2.f * G.shinLen * sc, anD = knD + e2.d * G.shinLen * sc;
      mkChain(`leg_${s}`, `腿·${tag}`, `leg_thigh_${s}`, `leg_foot_${s}`, anF + e3.f * G.shinLen * sc, anD + e3.d * G.shinLen * sc, SIDE_SIGN[s] * 12 * sc);
    }
  }

  const costumeSet = buildCostumeSet(cid, 'main', '机甲', nodes, mechaHumanoidNodeParts(B), opts.spriteIds, mechaFamilyArmorHex(opts.family, B.parts?.scheme));
  const nodesById: Record<string, Node> = {};
  for (const n of Object.values(nodes)) nodesById[n.id] = n;
  return { nodes: nodesById, rootNodeId: pelvis.id, costumeSet, ikChains };
}

export interface MechaStoreSurface {
  canvasWidth: number;
  canvasHeight: number;
  addUnifiedCharacter: (name: string, opts?: { skipPlaceholderRoot?: boolean }) => { id: string };
  addSprite: (name: string, width: number, height: number, opts?: { plugX?: number; plugY?: number }) => { id?: string };
  setSpritePixels: (id: string, pixels: PixelGrid) => void;
  updateSprite: (id: string, updates: { origin?: { characterId: string; boneName?: string }; folder?: string; drive?: { step: number; frameSpriteIds: string[] } }) => void;
  updateUnifiedCharacter: (id: string, updates: Record<string, unknown>) => void;
}

/** 精灵像素指纹（判断相位帧与第 0 帧是否真有差异：无差异的段不挂 drive） */
function spriteFingerprint(d: MechaSpriteData): string {
  let h = 2166136261 >>> 0;
  const mix = (n: number) => { h ^= n & 0xff; h = Math.imul(h, 16777619); };
  mix(d.width); mix(d.height);
  for (let i = 0; i < d.rgba.length; i++) mix(d.rgba[i]!);
  return d.width + 'x' + d.height + ':' + (h >>> 0).toString(16);
}

/** 计划全件贴表面材质：克隆后贴（计划里的精灵可能来自调用
 * 方的缓存，原地改会污染缓存），相位帧同贴 */
function applySurfaceToPlan(
  plan: { data: MechaSpriteData; drivePhases?: MechaSpriteData[] }[],
  choice: SurfaceChoice,
): void {
  const clone = (d: MechaSpriteData): MechaSpriteData => {
    const c = { ...d, rgba: new Uint8ClampedArray(d.rgba) };
    applySurface(c, choice);
    return c;
  };
  for (const e of plan) {
    e.data = clone(e.data);
    if (e.drivePhases) e.drivePhases = e.drivePhases.map(clone);
  }
}

function registerSprites(store: MechaStoreSurface, characterId: string, name: string, plan: { key: string; data: MechaSpriteData; drivePhases?: MechaSpriteData[]; driveStep?: number }[], scale: number): Record<string, string> {
  const spriteIds: Record<string, string> = {};
  for (const { key, data, drivePhases, driveStep } of plan) {
    const s = scaleSpriteData(data, scale);
    const spr = store.addSprite(`${name}_${MECHA_PART_LABELS[key as MechaPartKey] ?? key}`, s.width, s.height, {
      plugX: Math.round(s.plug.x), plugY: Math.round(s.plug.y),
    });
    store.setSpritePixels(spr.id!, rgbaToPixelGrid(s));
    store.updateSprite(spr.id!, { origin: { characterId, boneName: key }, folder: '方向/东' });
    spriteIds[key] = spr.id!;
    // 驱动相位帧（履带滚动）：第 0 帧即本体，其余帧另注册并挂到本体
    // drive 上（帧几何随本体同批缩放，step 同步按 scale 折算）
    if (drivePhases && drivePhases.length > 1) {
      const frameIds: string[] = [];
      for (let fi = 1; fi < drivePhases.length; fi++) {
        const fd = scaleSpriteData(drivePhases[fi]!, scale);
        const fs = store.addSprite(`${name}_${MECHA_PART_LABELS[key as MechaPartKey] ?? key}·滚动${fi}`, fd.width, fd.height, {
          plugX: Math.round(fd.plug.x), plugY: Math.round(fd.plug.y),
        });
        store.setSpritePixels(fs.id!, rgbaToPixelGrid(fd));
        store.updateSprite(fs.id!, { origin: { characterId, boneName: key }, folder: '方向/东' });
        frameIds.push(fs.id!);
      }
      store.updateSprite(spr.id!, { drive: { step: Math.max(0.5, (driveStep ?? MECHA_TRACK_DRIVE_STEP) * scale), frameSpriteIds: frameIds } });
    }
  }
  return spriteIds;
}

/** 向导的生成动作：建角色 → 精灵入表 → 组装（含 IK 链）一次写入 */
export function createMechaCharacterInStore(
  store: MechaStoreSurface,
  opts: { name: string; family: MechaFamily; build?: MechaBuildOptions; scale?: number },
): { characterId: string; costumeSetId: string } {
  const B = opts.build ?? {};
  const scale = opts.scale ?? 1;
  const character = store.addUnifiedCharacter(opts.name, { skipPlaceholderRoot: true });
  const partSet = generateMechaPartSet(opts.family, B.chest, B.parts, B.proportions);
  const plan: { key: string; data: MechaSpriteData; drivePhases?: MechaSpriteData[]; driveStep?: number }[] = [
    { key: 'torso', data: partSet.torso }, { key: 'head', data: partSet.head },
    { key: 'armUpper', data: partSet.armUpper }, { key: 'armFore', data: partSet.armFore }, { key: 'armHand', data: partSet.armHand },
  ];
  if (B.chassis === 'tracks') {
    plan.push({
      key: 'trackUnit',
      data: generateMechaTrackUnit(opts.family, { len: B.trackLen, scheme: B.parts?.scheme }),
      drivePhases: generateMechaTrackUnitPhases(opts.family, { len: B.trackLen, scheme: B.parts?.scheme }),
    });
  } else if (B.chassis === 'wheel') {
    // 轮足：三相位帧组建角——逐段比对相位差异，真含滚动像素的段才挂 drive
    const triples = generateMechaWheelLegPhases(opts.family, B.parts?.leg, B.parts?.scheme);
    const segKeys = [['wheelThigh', 'thigh'], ['wheelShin', 'shin'], ['wheelFoot', 'foot']] as const;
    for (const [key, seg] of segKeys) {
      const frames = triples.map((t) => t[seg]);
      const fp0 = spriteFingerprint(frames[0]!);
      const rolls = frames.some((f) => spriteFingerprint(f) !== fp0);
      plan.push(rolls
        ? { key, data: frames[0]!, drivePhases: frames, driveStep: MECHA_WHEEL_DRIVE_STEP }
        : { key, data: frames[0]! });
    }
  } else {
    plan.push({ key: 'legThigh', data: partSet.legThigh }, { key: 'legShin', data: partSet.legShin }, { key: 'legFoot', data: partSet.legFoot });
  }
  if (B.jetpack) plan.push({ key: 'jetpack', data: generateMechaJetpack(opts.family, B.parts?.scheme) });
  if (B.podMount) { const pk = B.podMount === 'pylon' ? 'podPylon' : 'pod'; plan.push({ key: pk, data: generateMechaWeapon(opts.family, pk, B.parts?.scheme, B.weaponSize, undefined, B.podCombo) }); }
  if (B.weapon) plan.push({ key: weaponSlotKey(B.weapon), data: generateMechaWeapon(opts.family, B.weapon, B.parts?.scheme, B.weaponSize, undefined, B.weaponCombo) });
  if (B.surface) applySurfaceToPlan(plan, B.surface);
  const spriteIds = registerSprites(store, character.id, opts.name, plan, scale);
  const assembly = assembleMechaCharacter({
    characterId: character.id, family: opts.family,
    canvasSize: { w: store.canvasWidth, h: store.canvasHeight },
    partSet, spriteIds, build: B, scale,
  });
  store.updateUnifiedCharacter(character.id, {
    nodes: assembly.nodes, rootNodeId: assembly.rootNodeId, ikChains: assembly.ikChains,
    costumeSets: [assembly.costumeSet], activeCostumeSetId: assembly.costumeSet.id,
  });
  return { characterId: character.id, costumeSetId: assembly.costumeSet.id };
}

// ============================================================
// 载具型角色：车体为根。步行腿走与人形同一条肢链口径（大腿/小腿/
// 足三节点 + IK 链）；蜘蛛/四足腿两段（髋节点 + 膝下段节点）；
// 履带/炮塔为结构插座节点。甲板为原点：hullBody 插头 = 甲板。
// ============================================================
export interface MechaVehicleOptions {
  hull: 'walker' | 'hauler';
  mobility: 'legs' | 'tracks' | 'quad' | 'spider';
  turret: boolean;
  /** 表面材质（模板 + 参数）：作用于全部部件 */
  surface?: SurfaceChoice;
  /** 部件覆盖（配色/车体变体与参数/步行腿覆盖/履带长，稀疏） */
  parts?: { scheme?: MechaSchemeName; hull?: MechaHullOverrides; leg?: MechaLegOverrides; trackLen?: number; proportions?: import('./parts').MechaProportions & { hullH?: number } };
}
export const MECHA_VEHICLE_LABELS = {
  hull: { walker: '步行载具', hauler: '运输载具' },
  mobility: { legs: '步行腿', tracks: '双履带', quad: '四足', spider: '蜘蛛六足' },
} as const;

/** 载具移动件族（walker 系橄榄、hauler 系白色敏捷近似 slate） */
export function mechaMobilityFamily(hull: 'walker' | 'hauler'): MechaFamily {
  return hull === 'walker' ? 'olive' : 'agile';
}

/** 载具默认配色 = 车体本色（用户定：移动件缺省跟车体）：walker 橄榄 / hauler 石板灰；用户在向导显式改色才偏离 */
export function mechaVehicleScheme(hull: 'walker' | 'hauler'): MechaSchemeName {
  return hull === 'walker' ? 'olive' : 'slate';
}

/** 载具移动件整件精灵（兼容旧调用：预览缩略等；装配用分段件） */
export function generateMechaMobilitySprite(hull: 'walker' | 'hauler', mobility: MechaVehicleOptions['mobility']): MechaSpriteData {
  const fam = mechaMobilityFamily(hull);
  const scheme = mechaVehicleScheme(hull);
  if (mobility === 'tracks') return generateMechaTrackUnit(fam, { scheme });
  if (mobility === 'quad' || mobility === 'spider') {
    const p = generateMechaMultiLegParts(fam, mobility, scheme);
    return p.upper;
  }
  return generateMechaPartSet(fam, undefined, { scheme }).leg;
}

/** 载具节点→部位映射（装配与向导预览共用） */
export function mechaVehicleNodeParts(vehicle: MechaVehicleOptions): Record<string, string> {
  const map: Record<string, string> = { hull: 'hullBody' };
  const mob = vehicle.mobility;
  if (mob === 'tracks') { map.track_N = 'trackUnit'; map.track_F = 'trackUnit'; }
  else if (mob === 'legs') {
    for (const g of ['F', 'R'] as const) map[`hipbeam_${g}`] = 'hipBeam';
    for (const k of ['a', 'b', 'c', 'd'] as const) {
      map[`leg${k}_thigh`] = 'legThigh'; map[`leg${k}_shin`] = 'legShin'; map[`leg${k}_foot`] = 'legFoot';
    }
  } else {
    const prof = mob === 'quad' ? 'quad' : 'spider';
    const legs = prof === 'quad' ? ['fN', 'fF', 'rN', 'rF'] : ['fN', 'mN', 'rN', 'fF', 'mF', 'rF'];
    for (const lg of legs) { map[`${prof}_${lg}`] = 'multiUpper'; map[`${prof}_${lg}_shin`] = 'multiMid'; map[`${prof}_${lg}_foot`] = 'multiFoot'; }
  }
  if (vehicle.turret) map.turret = 'turret';
  return map;
}

export function assembleMechaVehicle(opts: {
  characterId: string;
  canvasSize: { w: number; h: number };
  vehicle: MechaVehicleOptions;
  spriteIds: Record<string, string>;
  partSet?: MechaPartSet;
  scale?: number;
}): MechaCharacterAssembly {
  const { characterId: cid, canvasSize, vehicle: V } = opts;
  const sc = opts.scale ?? 1;
  const mob = V.mobility;
  const mobFam = mechaMobilityFamily(V.hull);
  // 车高覆盖时，移动件/炮塔的纵向挂点按车高比同步（挂点都是甲板下沿带）
  const hR = (V.parts?.hull?.hullH ?? (V.hull === 'walker' ? 130 : 118)) / (V.hull === 'walker' ? 130 : 118);
  const nodes: NodeMap = {};
  const mk = (key: string, name: string, parentKey?: string, angle = 0) => mkNode(nodes, cid, key, name, parentKey, angle);

  mk('hull', V.hull === 'walker' ? '车体·步行' : '车体·运输');
  const ikChains: IKChain[] = [];
  // 甲板下沿约 +110（车体底边）：移动件座/髋挂此带
  if (mob === 'tracks') {
    mk('track_F', '履带·远', 'hull'); mk('track_N', '履带·近', 'hull');
    linkChildren(nodes);
    sock3(nodes, 'hull', 'track_F', 12 * sc, 108 * hR * sc, -14 * sc);
    sock3(nodes, 'hull', 'track_N', -12 * sc, 112 * hR * sc, 14 * sc);
    nodes.track_F!.side = 'R'; nodes.track_N!.side = 'L';
    nodes.track_F!.zIndex = 0; nodes.track_N!.zIndex = 3;
  } else if (mob === 'legs') {
    // 支架腿组（模式库「支架腿组」，铁巢样本定案）：车体两端各一
    // 组支架——髋梁横在车体下沿（「髋梁横轴」子模式），每组两根
    // 撑链成倒 V 张开（同组近/远侧反向斜撑），足落在挂点外侧，
    // 侧影成 M。撑链姿态不套人形静止角：按落足点双骨解算（膝向
    // 张开侧外张），张开/够达由部件集 stand 参数（条目持有）。
    const ps = opts.partSet ?? generateMechaPartSet(mobFam, undefined, { scheme: mechaVehicleScheme(V.hull), leg: { ...(V.parts?.leg ?? {}), hipBeam: true, wScale: V.parts?.leg?.wScale ?? 0.62 } }, { leg: vehLegMul(V) }); // 腿长倍率走 vehLegMul：管线里髋随倍率平移、踝恒落地面线，倍率不再拉长胫骨
    const G = ps.geom;
    const L1 = G.thighLen * sc, L2 = G.shinLen * sc, LT = L1 + L2;
    const splayPx = (ps.stand?.splay ?? 0.21) * LT;
    const reach = Math.min((ps.stand?.reach ?? 0.94) * LT, LT * 0.98);
    const drop = Math.sqrt(Math.max(100, reach * reach - splayPx * splayPx));
    const hipD = 110 * hR * sc;
    // 足的两笔账分开：节点世界角是位图旋转（静止模板下 = 0，平足），
    // 趾向是踝→趾的几何方向（节点角之和 + 规范趾向），只供 IK 目标。
    // 朝向由所在组定——前组朝前、后组朝后（用户定），不随撑链斜撑方向变
    const footRotF = ps.rest.legThigh + ps.rest.legShin + ps.rest.legFoot;
    const toeAbsF = footRotF + ps.rest.legToeAbs;
    const DEG = 180 / Math.PI;
    // 双骨解算：髋在原点、落足点 (f, d)、膝向 kneeSign 侧外张 →
    // 大腿/小腿绝对角（dirOf 口径：0 = 正下）
    const solve = (f: number, d: number, kneeSign: number) => {
      const dd = Math.hypot(f, d);
      const base = Math.atan2(-f, d) * DEG;
      const cosA = Math.max(-1, Math.min(1, (L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd)));
      const A = Math.acos(cosA) * DEG;
      let best = base + A, bestScore = -Infinity;
      for (const cand of [base + A, base - A]) {
        const e = dirOf(cand);
        const score = e.f * L1 * kneeSign; // 膝落点在张开侧越远越好
        if (score > bestScore) { bestScore = score; best = cand; }
      }
      const e1 = dirOf(best);
      const knF = e1.f * L1, knD = e1.d * L1;
      const shin = Math.atan2(-(f - knF), d - knD) * DEG;
      return { thigh: best, shin };
    };
    const struts = [
      { key: 'lega', name: '前组·前撑', gz: 74, ss: 1, side: 'N' as const },
      { key: 'legb', name: '前组·后撑', gz: 74, ss: -1, side: 'F' as const },
      { key: 'legc', name: '后组·后撑', gz: -74, ss: -1, side: 'N' as const },
      { key: 'legd', name: '后组·前撑', gz: -74, ss: 1, side: 'F' as const },
    ];
    const solved = struts.map((st) => ({ st, ...solve(st.ss * splayPx, drop, st.ss), footAbs: st.gz > 0 ? toeAbsF : -toeAbsF }));
    for (const sv of solved) {
      mk(`${sv.st.key}_thigh`, `大腿·${sv.st.name}`, 'hull', sv.thigh);
      mk(`${sv.st.key}_shin`, `小腿·${sv.st.name}`, `${sv.st.key}_thigh`, sv.shin - sv.thigh);
      // 足节点角前后组同式（footRotF − shin，位图旋转口径）；后组的「朝后」不靠节点角、靠整腿镜像（见下）
      mk(`${sv.st.key}_foot`, `足·${sv.st.name}`, `${sv.st.key}_shin`, footRotF - sv.shin);
      // 后组整腿翻转：镜像标记挂大腿根节点，子树（小腿/足）经世界镜像继承——
      // 腿是手性装配（腓肠朝后、胫骨前凹、趾朝前），后腿整体翻过来才自洽（用户定：节点级镜像，不镜像精灵像素）
      if (sv.st.gz < 0) { const th = nodes[`${sv.st.key}_thigh`]!; th.transform = { ...th.transform, mirrorX: true }; }
    }
    if (ps.hipBeam) { mk('hipbeam_F', '髋梁·前组', 'hull', 0); mk('hipbeam_R', '髋梁·后组', 'hull', 0); }
    linkChildren(nodes);
    for (const sv of solved) {
      const st = sv.st, sg = SIDE_SIGN[st.side];
      sock3(nodes, 'hull', `${st.key}_thigh`, sg * 12 * sc, hipD, st.gz * sc);
      sockLimb(nodes, `${st.key}_thigh`, `${st.key}_shin`, L1);
      sockLimb(nodes, `${st.key}_shin`, `${st.key}_foot`, L2);
      const z = st.side === 'N' ? 3 : 0;
      for (const k of [`${st.key}_thigh`, `${st.key}_shin`, `${st.key}_foot`]) {
        nodes[k]!.zIndex = z;
        nodes[k]!.side = (st.side === 'N' ? 'L' : 'R') as Node['side'];
      }
      // IK 链（目标 = 落足点，甲板坐标系）
      const footF = st.gz * sc + st.ss * splayPx, footD = hipD + drop;
      const e3 = dirOf(sv.footAbs), footReach = L2 * 0.5;
      ikChains.push({
        id: `ik_${cid}_${st.key}`, name: `腿·${st.name}`,
        rootNodeId: nodes[`${st.key}_thigh`]!.id, endNodeId: nodes[`${st.key}_foot`]!.id,
        target: { x: canvasSize.w / 2 + footF + e3.f * footReach, y: 0 },
        target3D: { x: sg * 12 * sc, y: footD + e3.d * footReach, z: footF + e3.f * footReach },
        solver: '2bone', bendDir: st.ss, enabled: false,
      });
    }
    if (ps.hipBeam) for (const [k, gz] of [['hipbeam_F', 74], ['hipbeam_R', -74]] as const) {
      sock3(nodes, 'hull', k, 0, hipD - 4 * sc, gz * sc);
      nodes[k]!.zIndex = 1;
    }
  } else {
    const prof = mob === 'quad' ? 'quad' : 'spider';
    const mp = generateMechaMultiLegParts(mobFam, prof, undefined, undefined, vehLegMul(V));
    // 蜘蛛腿吊挂式（2026-11-08 多样本提取）：每条腿在自身朝向系里
    // 同一副弓形——段一上行成拱、膝为顶点、段二陡降、段三近竖直，
    // 足落点在膝的外侧。前腿朝前、后腿朝后（back = 朝向镜像：根角
    // 取 180−a1−fan、两处相对角取负），中腿朝前直挂。fan 只在朝向
    // 系内微调上行角。髋位在车体下侧（down 约 3/4 车高），机身吊
    // 在拱下，不是顶在腿柱上。
    const legs: { key: string; name: string; side: 'N' | 'F'; fwd: number; down: number; fan: number; back?: boolean }[] = prof === 'quad'
      ? [
        { key: 'quad_fF', name: '四足·前远', side: 'F', fwd: 66, down: 104, fan: 0 },
        { key: 'quad_rF', name: '四足·后远', side: 'F', fwd: -90, down: 104, fan: 0 },
        { key: 'quad_fN', name: '四足·前近', side: 'N', fwd: 78, down: 110, fan: 0 },
        { key: 'quad_rN', name: '四足·后近', side: 'N', fwd: -78, down: 110, fan: 0 },
      ]
      : [
        { key: 'spider_fF', name: '蛛腿·前远', side: 'F', fwd: 62, down: 78, fan: -4 },
        { key: 'spider_mF', name: '蛛腿·中远', side: 'F', fwd: -8, down: 82, fan: 2 },
        { key: 'spider_rF', name: '蛛腿·后远', side: 'F', fwd: -86, down: 78, fan: -4, back: true },
        { key: 'spider_fN', name: '蛛腿·前近', side: 'N', fwd: 74, down: 86, fan: -4 },
        { key: 'spider_mN', name: '蛛腿·中近', side: 'N', fwd: 0, down: 90, fan: 2 },
        { key: 'spider_rN', name: '蛛腿·后近', side: 'N', fwd: -74, down: 86, fan: -4, back: true },
      ];
    // 逐腿三段角（角度口径 = segAng/dirOf：自竖直向下起量、前向
    // 为负）：镜像腿在该口径下整体取负（根角与两处相对角）
    const legAngles = (lg: { fan: number; back?: boolean }) => lg.back
      ? { p1: -mp.a1 - lg.fan, p2: -mp.a2rel, p3: -mp.a3rel }
      : { p1: mp.a1 + lg.fan, p2: mp.a2rel, p3: mp.a3rel };
    for (const lg of legs) {
      const { p1, p2, p3 } = legAngles(lg);
      mk(lg.key, lg.name, 'hull', p1);
      mk(`${lg.key}_shin`, `${lg.name}·中段`, lg.key, p2);
      mk(`${lg.key}_foot`, `${lg.name}·足`, `${lg.key}_shin`, p3);
    }
    linkChildren(nodes);
    for (const lg of legs) {
      sock3(nodes, 'hull', lg.key, SIDE_SIGN[lg.side] * 12 * sc, lg.down * hR * sc, lg.fwd * sc);
      sockLimb(nodes, lg.key, `${lg.key}_shin`, mp.l1 * sc);
      sockLimb(nodes, `${lg.key}_shin`, `${lg.key}_foot`, mp.l2 * sc);
      const z = lg.side === 'N' ? 3 : 0;
      for (const k of [lg.key, `${lg.key}_shin`, `${lg.key}_foot`]) {
        nodes[k]!.zIndex = z;
        nodes[k]!.side = (lg.side === 'N' ? 'L' : 'R') as Node['side'];
      }
      // IK 链（拆关节后配链：根=上段、末端=足，尖端长=段三；
      // 目标 = 静止趾尖，甲板坐标系，与步行腿同口径、默认禁用）
      const hipF = lg.fwd * sc, hipD = lg.down * hR * sc;
      const { p1, p2, p3 } = legAngles(lg);
      const e1 = dirOf(p1), e2 = dirOf(p1 + p2), e3 = dirOf(p1 + p2 + p3);
      const knF = hipF + e1.f * mp.l1 * sc, knD = hipD + e1.d * mp.l1 * sc;
      const anF = knF + e2.f * mp.l2 * sc, anD = knD + e2.d * mp.l2 * sc;
      ikChains.push({
        id: `ik_${cid}_${lg.key}`, name: lg.name,
        rootNodeId: nodes[lg.key]!.id, endNodeId: nodes[`${lg.key}_foot`]!.id,
        target: { x: canvasSize.w / 2 + anF + e3.f * mp.l3 * sc, y: 0 },
        target3D: { x: SIDE_SIGN[lg.side] * 12 * sc, y: anD + e3.d * mp.l3 * sc, z: anF + e3.f * mp.l3 * sc },
        solver: '2bone', bendDir: 1, enabled: false, tipLength: mp.l3 * sc,
      });
    }
  }
  if (V.turret) {
    const turretForm = V.parts?.hull?.form?.turret ?? (V.hull === 'walker' ? 'gun' : 'rack');
    mk('turret', turretForm === 'rack' ? '顶架' : '炮塔', 'hull');
    linkChildren(nodes);
    const t = V.hull === 'walker' ? { down: -18, fwd: -15 } : { down: -17, fwd: -16 };
    sock3(nodes, 'hull', 'turret', 0, t.down * hR * sc, t.fwd * sc);
    nodes.turret!.zIndex = 2;
  }
  // 根定位：纵向留移动件下探空间
  const depth = mob === 'spider' ? 350 : mob === 'tracks' ? 235 : 330;
  const rootY = Math.max(240, Math.min(canvasSize.h * 0.34, canvasSize.h - depth * 0.55 * sc));
  const hull = nodes.hull!;
  hull.transform = { ...hull.transform, x: SUB(canvasSize.w / 2), y: SUB(rootY) };
  hull.isCore = true;
  hull.zIndex = 1;
  // 载具步行腿 IK 链的 2D 目标 y 需根纵坐标（上面先占位 0，这里补齐）
  for (const c of ikChains) c.target.y = rootY + (c.target3D?.y ?? 0);

  const costumeSet = buildCostumeSet(cid, 'vehicle', MECHA_VEHICLE_LABELS.hull[V.hull], nodes, mechaVehicleNodeParts(V), opts.spriteIds, mechaFamilyArmorHex(mobFam, V.parts?.scheme));
  const nodesById: Record<string, Node> = {};
  for (const n of Object.values(nodes)) nodesById[n.id] = n;
  return { nodes: nodesById, rootNodeId: hull.id, costumeSet, ikChains };
}

/** 向导的载具生成动作：车体 + 移动件（分段）+ 炮塔精灵入表 → 组装写入 */
export function createMechaVehicleInStore(
  store: MechaStoreSurface,
  opts: { name: string; vehicle: MechaVehicleOptions; scale?: number },
): { characterId: string; costumeSetId: string } {
  const V = opts.vehicle;
  const scale = opts.scale ?? 1;
  const mobFam = mechaMobilityFamily(V.hull);
  const character = store.addUnifiedCharacter(opts.name, { skipPlaceholderRoot: true });
  const plan: { key: string; data: MechaSpriteData; drivePhases?: MechaSpriteData[] }[] = [
    { key: 'hullBody', data: generateMechaHullBody(V.hull, vehHullOv(V), V.parts?.scheme) },
  ];
  let partSet: MechaPartSet | undefined;
  const mobScheme = V.parts?.scheme ?? mechaVehicleScheme(V.hull); // 移动件缺省跟车体（用户定）
  if (V.mobility === 'tracks') {
    plan.push({
      key: 'trackUnit',
      data: generateMechaTrackUnit(mobFam, { len: V.parts?.trackLen, scheme: mobScheme }),
      drivePhases: generateMechaTrackUnitPhases(mobFam, { len: V.parts?.trackLen, scheme: mobScheme }),
    });
  } else if (V.mobility === 'legs') {
    partSet = generateMechaPartSet(mobFam, undefined, { scheme: mobScheme, leg: { ...(V.parts?.leg ?? {}), hipBeam: true, wScale: V.parts?.leg?.wScale ?? 0.62 } }, { ...(V.parts?.proportions ?? {}), leg: vehLegMul(V) });
    plan.push({ key: 'legThigh', data: partSet.legThigh }, { key: 'legShin', data: partSet.legShin }, { key: 'legFoot', data: partSet.legFoot });
  } else {
    const mp = generateMechaMultiLegParts(mobFam, V.mobility, mobScheme, undefined, vehLegMul(V));
    plan.push({ key: 'multiUpper', data: mp.upper }, { key: 'multiMid', data: mp.mid }, { key: 'multiFoot', data: mp.foot });
  }
  if (V.turret) plan.push({ key: 'turret', data: generateMechaTurret(V.hull, vehHullOv(V), V.parts?.scheme) });
  if (V.surface) applySurfaceToPlan(plan, V.surface);
  const spriteIds = registerSprites(store, character.id, opts.name, plan, scale);
  const assembly = assembleMechaVehicle({
    characterId: character.id,
    canvasSize: { w: store.canvasWidth, h: store.canvasHeight },
    vehicle: V, spriteIds, partSet, scale,
  });
  store.updateUnifiedCharacter(character.id, {
    nodes: assembly.nodes, rootNodeId: assembly.rootNodeId, ikChains: assembly.ikChains,
    costumeSets: [assembly.costumeSet], activeCostumeSetId: assembly.costumeSet.id,
  });
  return { characterId: character.id, costumeSetId: assembly.costumeSet.id };
}

// ---- 蓝图机甲源节点的像素供给（生成是秒级重活，按签名缓存） ----
// 与向导同权：向导能出的每一件，蓝图机甲源都能凭参数手动出——
// 部位全集（分段/轮足/多足/履带/背包/武器/车体及拆分）+ 配色 +
// 覆盖 JSON（MechaPartOverrides 形，车体件另认 hull 字段、履带
// 另认 trackLen）；或者直接钉模式库条目（entry 引用 + output
// 输出名），条目能表达的（变体/着色/组合）蓝图全能拿到。
import { allLibraryEntries, libraryIndexOf } from '../library-entries';
import { renderMechaEntry } from './entry-render';

const mechaGridCache = new Map<string, PixelGrid>();

export interface MechaSourceOptions {
  scheme?: MechaSchemeName;
  /** 表面材质模板 id（裸参数路直用模板缺省参数）：作用于车体/武器件 */
  surface?: string;
  /** 覆盖 JSON 解析后（MechaPartOverrides + hull/trackLen 附加字段） */
  overrides?: MechaPartOverrides & { hull?: MechaHullOverrides; trackLen?: number };
  /** 多足腿型面（multiUpper/multiMid/multiFoot 用） */
  profile?: 'spider' | 'quad';
}

/** 部位名 → 精灵（与向导同一批生成器、同一参数口径） */
function mechaPartSprite(family: MechaFamily, part: string, opts: MechaSourceOptions): MechaSpriteData | null {
  const raw = mechaPartSpriteRaw(family, part, opts);
  if (raw && opts.surface) applySurface(raw, { template: opts.surface });
  return raw;
}
function mechaPartSpriteRaw(family: MechaFamily, part: string, opts: MechaSourceOptions): MechaSpriteData | null {
  const { scheme, overrides: ov, profile } = opts;
  switch (part) {
    case 'hullWalker': return generateMechaHull('walker', ov?.hull, scheme);
    case 'hullHauler': return generateMechaHull('hauler', ov?.hull, scheme);
    case 'hullWalkerBody': return generateMechaHullBody('walker', ov?.hull, scheme);
    case 'hullHaulerBody': return generateMechaHullBody('hauler', ov?.hull, scheme);
    case 'hullWalkerTurret': return generateMechaTurret('walker', ov?.hull, scheme);
    case 'hullHaulerTurret': return generateMechaTurret('hauler', ov?.hull, scheme);
    case 'jetpack': return generateMechaJetpack(family, scheme);
    case 'pod': case 'podPylon': case 'cannon': case 'rifle':
      return generateMechaWeapon(family, part, scheme);
    case 'trackUnit': return generateMechaTrackUnit(family, { scheme, len: ov?.trackLen });
    case 'wheelThigh': case 'wheelShin': case 'wheelFoot': {
      const wp = generateMechaWheelLegParts(family, ov?.leg, scheme);
      return part === 'wheelThigh' ? wp.thigh : part === 'wheelShin' ? wp.shin : wp.foot;
    }
    case 'multiUpper': case 'multiMid': case 'multiFoot': {
      const mp = generateMechaMultiLegParts(family, profile ?? 'spider', scheme);
      return part === 'multiUpper' ? mp.upper : part === 'multiMid' ? mp.mid : mp.foot;
    }
    default: {
      if (!['leg', 'legThigh', 'legShin', 'legFoot', 'hipBeam', 'armUpper', 'armFore', 'armHand', 'torso', 'head'].includes(part)) return null;
      const ps = generateMechaPartSet(family, undefined, { ...ov, scheme: scheme ?? ov?.scheme });
      return ps[part as 'leg' | 'legThigh' | 'legShin' | 'legFoot' | 'armUpper' | 'armFore' | 'armHand' | 'torso' | 'head'] ?? ps.hipBeam ?? null;
    }
  }
}

/** 按族+部位取像素格（蓝图机甲源的裸参数模式） */
export function getMechaPartGrid(family: string, part: string, opts: MechaSourceOptions = {}): PixelGrid | null {
  const fam = (MECHA_FAMILIES.some((f) => f.id === family) ? family : 'olive') as MechaFamily;
  const key = `part:${fam}:${part}:${JSON.stringify(opts)}`;
  const hit = mechaGridCache.get(key);
  if (hit) return hit;
  const data = mechaPartSprite(fam, part, opts);
  if (!data) return null;
  const grid = rgbaToPixelGrid(data);
  mechaGridCache.set(key, grid);
  return grid;
}

/** 按模式库条目取像素格（entry = 'id@版本'，output = 输出名，
 *  缺省取第一个输出；组合条目的输出名形如 'leg.thigh'） */
export function getMechaEntryGrid(ref: string, output?: string): PixelGrid | null {
  const key = `entry:${ref}:${output ?? ''}`;
  const hit = mechaGridCache.get(key);
  if (hit) return hit;
  const got = renderMechaEntry(libraryIndexOf(allLibraryEntries()), ref);
  if (!got) return null;
  const data = (output ? got.outputs[output] : undefined) ?? Object.values(got.outputs)[0];
  if (!data) return null;
  const grid = rgbaToPixelGrid(data);
  mechaGridCache.set(key, grid);
  return grid;
}
