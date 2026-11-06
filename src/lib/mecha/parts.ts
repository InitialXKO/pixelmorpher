// ============================================================
// 机甲部位精灵生成：各部位在本地坐标用引擎渲染，按关节点裁剪为
// 精灵（RGBA 像素 + 插头=关节点在图内坐标）。供角色构建
// （build-character）与蓝图机甲源节点共用。族规格 = 研究线逐
// 部位验收过的规格（数字是实例参数，构造走引擎模式）。
// ============================================================
import {
  SCHEMES, MECHA_W, MECHA_H, newCanvas, layout, finishRender,
  armIR, renderArmIR, torsoIR, renderTorsoIR, headIR, renderHeadIR, hullIR, renderHullIR,
} from './engine';
import type { Scheme, LegSpec, ArmSpec, TorsoSpec, HeadSpec, HullSpec, MechaCanvas, Pt } from './engine';
import { renderMultiLeg, multiLegGeom, renderTrackUnit, renderJetpack, renderWeapon, type WeaponKind } from './gear';

export type MechaFamily = 'olive' | 'agile' | 'powersuit';
export const MECHA_FAMILIES: { id: MechaFamily; name: string }[] = [
  { id: 'olive', name: '橄榄·主战' },
  { id: 'agile', name: '白色·敏捷' },
  { id: 'powersuit', name: '动力服' },
];

const psScheme: Scheme = {
  armor: [233, 231, 224], armor2: [219, 126, 46], frame: [72, 72, 76], metal: [120, 122, 126],
  accent: [233, 122, 40], chrome: [200, 202, 206], glow: [255, 205, 120], decal: [40, 40, 44],
};
const SCHEME_OF: Record<MechaFamily, Scheme> = { olive: SCHEMES.olive, agile: SCHEMES.white, powersuit: psScheme };
const CAMO_OF: Record<MechaFamily, boolean> = { olive: true, agile: false, powersuit: false };
const TWOTONE_OF: Record<MechaFamily, boolean> = { olive: true, agile: true, powersuit: false };

/** 配色名（共 6 套：引擎 SCHEMES 五套 + 动力服一套），可整机另选、与族解绑 */
export type MechaSchemeName = 'olive' | 'white' | 'desert' | 'slate' | 'rust' | 'powersuit';
export const MECHA_SCHEME_LABELS: Record<MechaSchemeName, string> = {
  olive: '橄榄绿', white: '敏捷白', desert: '沙漠黄', slate: '石板灰', rust: '锈红', powersuit: '橙白',
};
export const MECHA_FAMILY_SCHEME: Record<MechaFamily, MechaSchemeName> = { olive: 'olive', agile: 'white', powersuit: 'powersuit' };
export function mechaSchemeByName(name: MechaSchemeName): Scheme {
  return name === 'powersuit' ? psScheme : SCHEMES[name];
}

export interface MechaSpriteData {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  /** 插头：关节点（本地原点）在图内坐标 */
  plug: Pt;
}

function cropSprite(cv: MechaCanvas, origin: Pt): MechaSpriteData {
  const W = MECHA_W, H = MECHA_H;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (cv.col[(y * W + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = ((y + y0) * W + x + x0) * 4, di = (y * w + x) * 4;
    out[di] = cv.col[si]; out[di + 1] = cv.col[si + 1]; out[di + 2] = cv.col[si + 2]; out[di + 3] = cv.col[si + 3];
  }
  return { width: w, height: h, rgba: out, plug: { x: origin.x - x0, y: origin.y - y0 } };
}

function fin(family: MechaFamily): LegSpec & { altTone?: boolean } {
  return {
    topology: 'standard', scheme: SCHEME_OF[family], seed: 11, bend: 22,
    camo: CAMO_OF[family], wear: 0.3, detail: 0.65, altTone: TWOTONE_OF[family],
  } as LegSpec & { altTone?: boolean };
}

/** 收尾规格：族基线 + 稀疏覆盖（只覆写给出的字段，无覆盖时与 fin() 逐值一致） */
function finFor(family: MechaFamily, scheme: Scheme, ov?: {
  wear?: number; camo?: boolean; seed?: number; detail?: number; shellMode?: boolean;
  cableTint?: [number, number, number]; decalKind?: LegSpec['decalKind']; twoTone?: boolean; wheelPhase?: number;
}): LegSpec & { altTone?: boolean } {
  const F = fin(family);
  F.scheme = scheme;
  if (!ov) return F;
  if (ov.wear !== undefined) F.wear = ov.wear;
  if (ov.camo !== undefined) F.camo = ov.camo;
  if (ov.seed !== undefined) F.seed = ov.seed;
  if (ov.detail !== undefined) F.detail = ov.detail;
  if (ov.wheelPhase !== undefined) F.wheelPhase = ov.wheelPhase;
  if (ov.shellMode !== undefined) F.shellMode = ov.shellMode;
  if (ov.cableTint !== undefined) F.cableTint = ov.cableTint;
  if (ov.decalKind !== undefined) F.decalKind = ov.decalKind;
  if (ov.twoTone !== undefined) F.altTone = ov.twoTone;
  return F;
}

const LEG_SPEC: Record<MechaFamily, (scheme: Scheme) => LegSpec> = {
  olive: (s) => ({ topology: 'standard', scheme: s, seed: 11, bend: 22, camo: true, wear: 0.3, wScale: 1.1, lift: 20, detail: 0.65, ankleShift: 12, coreScale: 1.05 }),
  agile: (s) => ({ topology: 'standard', scheme: s, seed: 21, bend: 18, camo: false, wear: 0.15, wScale: 0.92, lift: 20, detail: 0.65, ankleShift: 8, coreScale: 1, footType: 'shoe' }),
  powersuit: (s) => ({ topology: 'standard', scheme: s, seed: 49, bend: 16, camo: false, wear: 0.15, wScale: 0.95, lift: 20, detail: 0.65, ankleShift: 6, coreScale: 1, footType: 'pad' }),
};

const ARM_SPEC: Record<MechaFamily, (scheme: Scheme) => ArmSpec> = {
  olive: (s) => ({ scheme: s, family: 'olive', seed: 7, wear: 0.3, camo: true, diag: 0.5, root: { x: 70, y: 40 }, bulk: 1.02, shell: 1.05, upperLen: 118, foreLen: 148, upperAng: 0.06, elbowBend: 0, hand: 'fist', gear: { cable: true, piston: true, device: true, stripe: true }, form: { shell: 'box', elbow: 'disc', fore: 'housing', fingerLen: 27, fingerCurl: 0.5 }, twoTone: true }),
  agile: (s) => ({ scheme: s, family: 'agile', seed: 21, wear: 0.15, camo: false, diag: 0.4, root: { x: 70, y: 40 }, bulk: 0.85, shell: 0.8, upperLen: 148, foreLen: 142, upperAng: 0.06, elbowBend: 0, hand: 'fist', gear: { cable: true, piston: false, device: true, stripe: false }, form: { shell: 'cap', elbow: 'ring', fore: 'plates', fingerLen: 37, fingerCurl: 0.13 }, twoTone: true }),
  powersuit: (s) => ({ scheme: s, family: 'powersuit', seed: 35, wear: 0.15, camo: false, diag: 0.25, root: { x: 70, y: 40 }, bulk: 0.86, shell: 0.9, upperLen: 126, foreLen: 118, upperAng: 0.06, elbowBend: 0, hand: 'fist', gear: { cable: false, piston: false, device: false, stripe: true }, form: { shell: 'cap', elbow: 'small', fore: 'shell', fingerLen: 29, fingerCurl: 0.38 }, twoTone: false }),
};

const TORSO_SPEC: Record<MechaFamily, (scheme: Scheme) => TorsoSpec> = {
  olive: (s) => ({ family: 'olive', scheme: s, seed: 7, wear: 0.3, camo: true, twoTone: true, neck: { x: 120, y: 16 }, chestW: 150, chestH: 118, waistH: 22, pelvisH: 72, form: { chest: 'stack', back: 'box', grille: 'side', skirt: 'front' }, gear: { stripe: true, insignia: 4, number: '3' } }),
  agile: (s) => ({ family: 'agile', scheme: s, seed: 21, wear: 0.15, camo: false, twoTone: true, neck: { x: 120, y: 16 }, chestW: 128, chestH: 128, waistH: 26, pelvisH: 66, form: { chest: 'shell', back: 'binder', grille: 'front', skirt: 'both' }, gear: { stripe: false, insignia: 0, number: '' } }),
  powersuit: (s) => ({ family: 'powersuit', scheme: s, seed: 49, wear: 0.15, camo: false, twoTone: false, neck: { x: 120, y: 16 }, chestW: 118, chestH: 110, waistH: 24, pelvisH: 62, form: { chest: 'shell', back: 'rack', grille: 'none', skirt: 'front' }, gear: { stripe: false, insignia: 1, number: '' } }),
};

const HEAD_SPEC: Record<MechaFamily, (scheme: Scheme) => HeadSpec> = {
  olive: (s) => ({ family: 'olive', twoTone: true, scheme: s, seed: 7, wear: 0.3, camo: true, seat: { x: 80, y: 120 }, w: 96, h: 84, tilt: 0.03, form: { crown: 'angular', eye: 'slit', brow: true, jaw: 'respirator', ear: 'grille', top: 'horn', cheekCable: false } }),
  agile: (s) => ({ family: 'agile', twoTone: true, scheme: s, seed: 21, wear: 0.15, camo: false, seat: { x: 80, y: 120 }, w: 92, h: 92, tilt: 0.02, form: { crown: 'angular', eye: 'slit', brow: true, jaw: 'block', ear: 'plate', top: 'vfin', cheekCable: false } }),
  powersuit: (s) => ({ family: 'powersuit', twoTone: false, scheme: s, seed: 49, wear: 0.15, camo: false, seat: { x: 80, y: 120 }, w: 100, h: 88, tilt: 0, form: { crown: 'dome', eye: 'visor', brow: false, jaw: 'respirator', ear: 'plate', top: 'none', cheekCable: false } }),
};

// ---------- 部件覆盖（稀疏：只写改过的字段，其余走族预设） ----------
export interface MechaLegOverrides {
  topology?: LegSpec['topology']; footType?: LegSpec['footType'];
  bend?: number; wScale?: number; ankleShift?: number;
  lift?: number; coreScale?: number; detail?: number; wear?: number; camo?: boolean;
  shellMode?: boolean; frameHeavy?: boolean; guardOff?: boolean;
  decalKind?: LegSpec['decalKind']; cableTint?: [number, number, number]; seed?: number;
  /** 膝盖块厚度系数 / 腓肠隆起系数 / 胫骨凹面深度系数（默认 1） */
  kneeScale?: number; calfScale?: number; shinConcave?: number;
  /** 轮足滚动相位（行程 px，相位帧组内部用，用户覆盖不设） */
  wheelPhase?: number;
}
export interface MechaArmOverrides {
  hand?: ArmSpec['hand']; bulk?: number; shell?: number;
  upperLen?: number; foreLen?: number; upperAng?: number; elbowBend?: number; diag?: number;
  form?: Partial<ArmSpec['form']>; gear?: Partial<ArmSpec['gear']>;
  twoTone?: boolean; wear?: number; camo?: boolean; seed?: number;
}
export interface MechaTorsoOverrides {
  chestW?: number; chestH?: number; waistH?: number; pelvisH?: number;
  form?: Partial<TorsoSpec['form']>; gear?: Partial<TorsoSpec['gear']>;
  twoTone?: boolean; wear?: number; camo?: boolean; seed?: number;
}
export interface MechaHeadOverrides {
  w?: number; h?: number; tilt?: number;
  form?: Partial<HeadSpec['form']>;
  twoTone?: boolean; wear?: number; camo?: boolean; seed?: number;
}
export interface MechaPartOverrides {
  scheme?: MechaSchemeName;
  leg?: MechaLegOverrides; arm?: MechaArmOverrides; torso?: MechaTorsoOverrides; head?: MechaHeadOverrides;
}
/** 车体覆盖（载具） */
export interface MechaHullOverrides {
  hullW?: number; hullH?: number;
  form?: Partial<HullSpec['form']>; gear?: Partial<HullSpec['gear']>;
  twoTone?: boolean; wear?: number; camo?: boolean; seed?: number;
}
/** 族预设规格（向导控件默认值与差分基准） */
export function mechaLegSpecOf(family: MechaFamily): LegSpec { return LEG_SPEC[family](SCHEME_OF[family]); }
export function mechaArmSpecOf(family: MechaFamily): ArmSpec { return ARM_SPEC[family](SCHEME_OF[family]); }
export function mechaTorsoSpecOf(family: MechaFamily): TorsoSpec { return TORSO_SPEC[family](SCHEME_OF[family]); }
export function mechaHeadSpecOf(family: MechaFamily): HeadSpec { return HEAD_SPEC[family](SCHEME_OF[family]); }
export function mechaHullSpecOf(kind: 'walker' | 'hauler'): HullSpec { return HULL_SPEC_OF(kind); }

export interface MechaPartSet {
  leg: MechaSpriteData;
  legThigh: MechaSpriteData;
  legShin: MechaSpriteData;
  legFoot: MechaSpriteData;
  armUpper: MechaSpriteData;
  armFore: MechaSpriteData;
  armHand: MechaSpriteData;
  torso: MechaSpriteData;
  head: MechaSpriteData;
  /** 肢链几何（规范直姿渲染的段长）与静止节点角（度：链根为绝对角、其余相对父） */
  geom: { thighLen: number; shinLen: number; upperLen: number; foreLen: number };
  rest: { armUpper: number; armFore: number; legThigh: number; legShin: number; legFoot: number };
  /** 肘相对肩（前臂节点的挂载偏移） */
  elbowOff: Pt;
  /** 腕/掌相对肘（前臂精灵本地，武器挂载偏移） */
  wristOff: Pt;
  palmOff: Pt;
  /** 躯干插座（相对胯心=躯干精灵原点） */
  torsoSockets: { neck: Pt; shoulder: Pt; hip: Pt };
}

/** 骨向角（度）：与笔触建骨同口径 θ = atan2(−dx, dy)，0 = 正下 */
export function segAngDeg(a: Pt, b: Pt): number {
  return (Math.atan2(-(b.x - a.x), b.y - a.y) * 180) / Math.PI;
}

function distToSeg(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** 把一张成品画布按「像素离哪段骨最近」拆成逐段精灵（插头=各段起点）。
 * jointRadii[i] 给定时：关节 i+1 周围该半径内的像素整归下段（关节盘随下段
 * 绕自身中心转、弯曲时不裂开）。 */
export function splitCanvasBySegments(cv: MechaCanvas, joints: Pt[], jointRadii?: number[]): MechaSpriteData[] {
  const W = 380, H = 540;
  const bufs: Uint8ClampedArray[] = joints.slice(0, -1).map(() => new Uint8ClampedArray(W * H * 4));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (cv.col[i * 4 + 3]! === 0) continue;
    let best = -1;
    if (jointRadii) {
      for (let s = 1; s < joints.length - 1; s++) {
        const r = jointRadii[s - 1] ?? 0;
        if (r > 0 && Math.hypot(x - joints[s]!.x, y - joints[s]!.y) <= r) { best = s; break; }
      }
    }
    if (best < 0) {
      best = 0;
      let bd = Infinity;
      for (let s = 0; s < joints.length - 1; s++) {
        const d = distToSeg(x, y, joints[s]!, joints[s + 1]!);
        if (d < bd) { bd = d; best = s; }
      }
    }
    bufs[best]!.set(cv.col.subarray(i * 4, i * 4 + 4), i * 4);
  }
  return bufs.map((buf, s) => {
    const sub = newCanvas(); sub.col.set(buf);
    return cropSprite(sub, joints[s]!);
  });
}

/** 腿管线：规范直姿渲染一遍，再按骨段拆大腿/小腿/足（整腿图保留供蓝图库） */
function legPipeline(family: MechaFamily, footType?: LegSpec['footType'], ov?: MechaLegOverrides, schemeName?: MechaSchemeName): {
  full: MechaSpriteData; thigh: MechaSpriteData; shin: MechaSpriteData; foot: MechaSpriteData;
  geom: { thighLen: number; shinLen: number }; rest: { thigh: number; shin: number; foot: number };
} {
  const scheme = schemeName ? mechaSchemeByName(schemeName) : SCHEME_OF[family];
  const spec: LegSpec = { ...LEG_SPEC[family](scheme), ...(ov ?? {}) };
  if (footType) spec.footType = footType;
  const posed = { hip: { x: 100, y: 16 }, knee: { x: 188, y: 220 }, ankle: { x: 96, y: 406 }, toe: { x: 196, y: 442 } };
  const L1 = Math.hypot(posed.knee.x - posed.hip.x, posed.knee.y - posed.hip.y);
  const L2 = Math.hypot(posed.ankle.x - posed.knee.x, posed.ankle.y - posed.knee.y);
  const k = 390 / (L1 + L2);
  const tL = L1 * k, sL = L2 * k;
  const canon = { hip: { x: 190, y: 30 }, knee: { x: 190, y: 30 + tL }, ankle: { x: 190, y: 30 + tL + sL }, toe: { x: 290, y: 30 + tL + sL + 36 } };
  const cv = newCanvas();
  const A = layout(cv, spec, { hip: canon.hip, knee: canon.knee, ankle: canon.ankle, toeX: canon.toe.x });
  finishRender(cv, A, finFor(family, scheme, ov));
  const [thigh, shin, foot] = splitCanvasBySegments(cv, [canon.hip, canon.knee, canon.ankle, canon.toe], [37, 24]) as [MechaSpriteData, MechaSpriteData, MechaSpriteData];
  const aT = segAngDeg(posed.hip, posed.knee), aS = segAngDeg(posed.knee, posed.ankle), aF = segAngDeg(posed.ankle, posed.toe);
  return {
    full: cropSprite(cv, canon.hip), thigh, shin, foot,
    geom: { thighLen: tL, shinLen: sL },
    rest: { thigh: aT, shin: aS - aT, foot: aF - aS },
  };
}

/** 生成一族的全部位精灵（人形：腿/上臂/前臂/躯干/头） */
export type MechaChestVariant = 'stack' | 'shell' | 'slab' | 'glacis';
export const MECHA_CHEST_LABELS: Record<MechaChestVariant, string> = { stack: '叠层胸', shell: '壳形胸', slab: '重型板胸', glacis: '斜面胸' };

export function generateMechaPartSet(family: MechaFamily, chest?: MechaChestVariant, ov?: MechaPartOverrides): MechaPartSet {
  const scheme = ov?.scheme ? mechaSchemeByName(ov.scheme) : SCHEME_OF[family];
  const FArm = finFor(family, scheme, ov?.arm);
  const FTorso = finFor(family, scheme, ov?.torso);
  const FHead = finFor(family, scheme, ov?.head);
  // 腿：规范直姿渲染 + 按骨段拆三件（大腿/小腿/足，各自成节点才可动可配 IK）
  const legP = legPipeline(family, undefined, ov?.leg, ov?.scheme);
  const leg = legP.full;
  // 臂：规范直姿（角度归零）渲染——上臂按 IR 归属、前臂/手按骨段距离拆
  const armBase = ARM_SPEC[family](scheme);
  const armOv = ov?.arm;
  const armSpec: ArmSpec = {
    ...armBase, ...(armOv ?? {}),
    form: { ...armBase.form, ...(armOv?.form ?? {}) },
    gear: { ...armBase.gear, ...(armOv?.gear ?? {}) },
  };
  const ir = armIR(armSpec);
  const canonSpec = { ...armSpec, upperAng: 0, elbowBend: 0 };
  const irC = armIR(canonSpec);
  type ArmPartT = (typeof irC.parts)[number];
  const isUpper = (p: ArmPartT) => ((p.t === 'segPlate' || p.t === 'segCore' || p.t === 'cable' || p.t === 'rod') && (p as { seg?: string }).seg === 'upper') || (p.t === 'disc' && p.at === 'shoulder') || (p.t === 'block' && p.frame === 'shoulder') || (p.t === 'discAt' && p.frame === 'upper') || p.t === 'insignia';
  const cvU = newCanvas(); const AU = renderArmIR(cvU, { anchors: irC.anchors, parts: irC.parts.filter(isUpper) }, canonSpec);
  finishRender(cvU, AU, FArm);
  const armUpper = cropSprite(cvU, irC.anchors.shoulder);
  const cvF = newCanvas(); const AF = renderArmIR(cvF, { anchors: irC.anchors, parts: irC.parts.filter((p) => !isUpper(p)) }, canonSpec);
  finishRender(cvF, AF, FArm);
  const wristC = irC.anchors.wrist;
  const [armFore, armHand] = splitCanvasBySegments(cvF, [irC.anchors.elbow, wristC, { x: wristC.x, y: wristC.y + 72 }], [15]) as [MechaSpriteData, MechaSpriteData];
  const elbowOff = { x: ir.anchors.elbow.x - ir.anchors.shoulder.x, y: ir.anchors.elbow.y - ir.anchors.shoulder.y };
  const wristOff = { x: ir.anchors.wrist.x - ir.anchors.elbow.x, y: ir.anchors.wrist.y - ir.anchors.elbow.y };
  const palmOff = { x: ir.anchors.palm.x - ir.anchors.elbow.x, y: ir.anchors.palm.y - ir.anchors.elbow.y };
  // 躯干（原点=胯心）
  const torsoBase = TORSO_SPEC[family](scheme);
  const torsoOv = ov?.torso;
  const torsoSpec: TorsoSpec = {
    ...torsoBase, ...(torsoOv ?? {}),
    form: { ...torsoBase.form, ...(torsoOv?.form ?? {}) },
    gear: { ...torsoBase.gear, ...(torsoOv?.gear ?? {}) },
  };
  if (chest) torsoSpec.form = { ...torsoSpec.form, chest };
  const torsoIRv = torsoIR(torsoSpec);
  const torsoCv = newCanvas(); const TA = renderTorsoIR(torsoCv, torsoIRv, torsoSpec);
  finishRender(torsoCv, TA, FTorso);
  const torso = cropSprite(torsoCv, torsoIRv.anchors.hip);
  const rel = (p: Pt) => ({ x: p.x - torsoIRv.anchors.hip.x, y: p.y - torsoIRv.anchors.hip.y });
  const torsoSockets = { neck: rel(torsoIRv.anchors.neck), shoulder: rel(torsoIRv.anchors.shoulder), hip: rel(torsoIRv.anchors.hip) };
  // 头（原点=颈座）
  const headBase = HEAD_SPEC[family](scheme);
  const headOv = ov?.head;
  const headSpec: HeadSpec = {
    ...headBase, ...(headOv ?? {}),
    form: { ...headBase.form, ...(headOv?.form ?? {}) },
  };
  const headCv = newCanvas(); const HA = renderHeadIR(headCv, headIR(headSpec), headSpec);
  finishRender(headCv, HA, FHead);
  const head = cropSprite(headCv, headSpec.seat);
  return {
    leg, legThigh: legP.thigh, legShin: legP.shin, legFoot: legP.foot,
    armUpper, armFore, armHand, torso, head, elbowOff, wristOff, palmOff, torsoSockets,
    geom: { thighLen: legP.geom.thighLen, shinLen: legP.geom.shinLen, upperLen: armSpec.upperLen, foreLen: armSpec.foreLen },
    rest: {
      armUpper: (-armSpec.upperAng * 180) / Math.PI, armFore: (-armSpec.elbowBend * 180) / Math.PI,
      legThigh: legP.rest.thigh, legShin: legP.rest.shin, legFoot: legP.rest.foot,
    },
  };
}

/** 载具车体精灵（原点=甲板中心），供载具线后续使用 */
const HULL_SPEC_OF = (kind: 'walker' | 'hauler'): HullSpec => kind === 'walker'
  ? { family: 'walker', scheme: SCHEMES.olive, seed: 11, wear: 0.35, camo: true, twoTone: true, deck: { x: 190, y: 150 }, hullW: 250, hullH: 130, form: { turret: 'gun', cabin: 'front', skirt: true, modules: 3 }, gear: { insignia: 0, number: 'N-37' } }
  : { family: 'hauler', scheme: SCHEMES.slate, seed: 23, wear: 0.3, camo: false, twoTone: true, deck: { x: 190, y: 150 }, hullW: 260, hullH: 118, form: { turret: 'rack', cabin: 'mid', skirt: false, modules: 2 }, gear: { insignia: 1, number: 'M-7' } };

const HULL_FIN = { topology: 'standard', seed: 11, bend: 22, wear: 0.3, detail: 0.65 } as const;

function hullSpecWithOv(kind: 'walker' | 'hauler', ov?: MechaHullOverrides, schemeName?: MechaSchemeName): HullSpec {
  const base = HULL_SPEC_OF(kind);
  const spec: HullSpec = {
    ...base, ...(ov ?? {}),
    form: { ...base.form, ...(ov?.form ?? {}) },
    gear: { ...base.gear, ...(ov?.gear ?? {}) },
  };
  if (schemeName) spec.scheme = mechaSchemeByName(schemeName);
  return spec;
}
function hullFin(spec: HullSpec, ov?: MechaHullOverrides): LegSpec & { altTone?: boolean } {
  return {
    ...HULL_FIN, scheme: spec.scheme, camo: spec.camo, altTone: spec.twoTone,
    ...(ov?.wear !== undefined ? { wear: ov.wear } : {}),
    ...(ov?.seed !== undefined ? { seed: ov.seed } : {}),
  } as LegSpec & { altTone?: boolean };
}

export function generateMechaHull(kind: 'walker' | 'hauler', ov?: MechaHullOverrides, schemeName?: MechaSchemeName): MechaSpriteData {
  const spec = hullSpecWithOv(kind, ov, schemeName);
  const cv = newCanvas(); const A = renderHullIR(cv, hullIR(spec), spec);
  finishRender(cv, A, hullFin(spec, ov));
  return cropSprite(cv, spec.deck);
}

/** 车体（无炮塔）：载具根节点用，原点=甲板 */
export function generateMechaHullBody(kind: 'walker' | 'hauler', ov?: MechaHullOverrides, schemeName?: MechaSchemeName): MechaSpriteData {
  const spec: HullSpec = { ...hullSpecWithOv(kind, ov, schemeName), split: 'body' };
  const cv = newCanvas(); const A = renderHullIR(cv, hullIR(spec), spec);
  finishRender(cv, A, hullFin(spec, ov));
  return cropSprite(cv, spec.deck);
}

/** 炮塔/顶架（独立件）：载具炮塔节点用，原点=炮塔转轴 */
export function generateMechaTurret(kind: 'walker' | 'hauler', ov?: MechaHullOverrides, schemeName?: MechaSchemeName): MechaSpriteData {
  const spec: HullSpec = { ...hullSpecWithOv(kind, ov, schemeName), split: 'turret' };
  const cv = newCanvas(); const A = renderHullIR(cv, hullIR(spec), spec);
  finishRender(cv, A, hullFin(spec, ov));
  const pivot = { x: spec.deck.x - spec.hullW * 0.06, y: spec.deck.y - spec.hullH * 0.14 };
  return cropSprite(cv, pivot);
}

/** 族主甲色（十六进制，供服装件底色/关节盘生成）；配色覆盖时跟配色走 */
export function mechaFamilyArmorHex(family: MechaFamily, schemeName?: MechaSchemeName): string {
  const c = (schemeName ? mechaSchemeByName(schemeName) : SCHEME_OF[family]).armor;
  return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** 轮足腿精灵（双足腿的足型变体：同髋插座、同锚点，足部换轮组） */
export function generateMechaWheelLeg(family: MechaFamily): MechaSpriteData {
  const scheme = SCHEME_OF[family];
  const cv = newCanvas(); const hip = { x: 100, y: 16 };
  const spec = { ...LEG_SPEC[family](scheme), footType: 'wheel' as const };
  const A = layout(cv, spec, { hip, knee: { x: hip.x + 88, y: hip.y + 204 }, ankle: { x: hip.x - 4, y: hip.y + 390 }, toeX: hip.x + 96 });
  finishRender(cv, A, fin(family));
  return cropSprite(cv, hip);
}

/** 多足腿精灵（蜘蛛/四足，原点=髋插座） */
export function generateMechaMultiLeg(family: MechaFamily, profile: 'spider' | 'quad', schemeName?: MechaSchemeName): MechaSpriteData {
  const scheme = schemeName ? mechaSchemeByName(schemeName) : SCHEME_OF[family];
  const cv = newCanvas(); const hip = { x: 56, y: 64 };
  const spec = { scheme, seed: 11, wear: 0.3, camo: CAMO_OF[family], twoTone: TWOTONE_OF[family], profile };
  const A = renderMultiLeg(cv, spec, hip);
  finishRender(cv, A, finFor(family, scheme));
  return cropSprite(cv, hip);
}

/** 轮足分段件（大腿/小腿与常足共用造型、足换轮组）：底盘选轮足时用 */
export function generateMechaWheelLegParts(family: MechaFamily, ov?: MechaLegOverrides, schemeName?: MechaSchemeName): { thigh: MechaSpriteData; shin: MechaSpriteData; foot: MechaSpriteData } {
  const p = legPipeline(family, 'wheel', ov, schemeName);
  return { thigh: p.thigh, shin: p.shin, foot: p.foot };
}

/** 多足腿分段件：上段（髋→膝，髋帧直姿）/下段（膝→踝→趾，膝帧、末段保留相对弯） */
export function generateMechaMultiLegParts(family: MechaFamily, profile: 'spider' | 'quad', schemeName?: MechaSchemeName): {
  upper: MechaSpriteData; lower: MechaSpriteData; l1: number; l2: number; a1: number; a2rel: number;
} {
  const scheme = schemeName ? mechaSchemeByName(schemeName) : SCHEME_OF[family];
  const spec = { scheme, seed: 11, wear: 0.3, camo: CAMO_OF[family], twoTone: TWOTONE_OF[family], profile };
  const gm = multiLegGeom(profile);
  // 上段：髋帧，段一竖直向下
  const hipU = { x: 70, y: 46 };
  const cvU = newCanvas();
  const AU = renderMultiLeg(cvU, spec, hipU, { knee: { x: hipU.x, y: hipU.y + gm.l1 }, ankle: { x: hipU.x, y: hipU.y + gm.l1 + gm.l2 }, toe: { x: hipU.x, y: hipU.y + gm.l1 + gm.l2 + 40 } }, 'upper');
  finishRender(cvU, AU, finFor(family, scheme));
  const upper = cropSprite(cvU, hipU);
  // 下段：膝帧，段二竖直向下、趾段按相对弯旋转进来
  const kneeO = { x: 70, y: 30 };
  const ankleL = { x: kneeO.x, y: kneeO.y + gm.l2 };
  const rad = (-gm.a2 * Math.PI) / 180;
  const toeL = { x: ankleL.x + gm.toeVec.x * Math.cos(rad) - gm.toeVec.y * Math.sin(rad), y: ankleL.y + gm.toeVec.x * Math.sin(rad) + gm.toeVec.y * Math.cos(rad) };
  const cvL = newCanvas();
  const AL = renderMultiLeg(cvL, spec, kneeO, { knee: kneeO, ankle: ankleL, toe: toeL }, 'lower');
  finishRender(cvL, AL, finFor(family, scheme));
  const lower = cropSprite(cvL, kneeO);
  return { upper, lower, l1: gm.l1, l2: gm.l2, a1: gm.a1, a2rel: gm.a2rel };
}

/** 履带底盘精灵（原点=座圈顶面中心，躯干/车体挂载点） */
export function generateMechaTrackUnit(family: MechaFamily, ov?: { len?: number; scheme?: MechaSchemeName; phase?: number }): MechaSpriteData {
  const scheme = ov?.scheme ? mechaSchemeByName(ov.scheme) : SCHEME_OF[family];
  const cv = newCanvas(); const origin = { x: 190, y: 26 };
  const spec = { scheme, seed: 11, wear: 0.3, camo: CAMO_OF[family], twoTone: TWOTONE_OF[family], len: ov?.len, phase: ov?.phase };
  const A = renderTrackUnit(cv, spec, origin);
  const F = finFor(family, scheme);
  if (ov?.phase) F.beltPhase = ov.phase;
  finishRender(cv, A, F);
  return cropSprite(cv, origin);
}

/** 履带滚动相位帧组：一圈链节距 16px 内 3 帧（相位 0/16/3/32/3，步距浮点保周期整除），进包后由运行时按累计位移选帧 */
export const MECHA_TRACK_DRIVE_STEP = 16 / 3;
export function generateMechaTrackUnitPhases(family: MechaFamily, ov?: { len?: number; scheme?: MechaSchemeName }): MechaSpriteData[] {
  return [0, 16 / 3, 32 / 3].map((phase) => generateMechaTrackUnit(family, { ...ov, phase }));
}

/** 轮足滚动相位帧组：轮图样 12 扇区旋转对称，一扇区（主轮行程 ≈23px）内取 3 帧
 *  （行程 0/8/16，步距 8、周期 24），每腿三段各一份——哪段真含轮像素由建角侧比对决定挂不挂 drive */
export const MECHA_WHEEL_DRIVE_STEP = 8;
export function generateMechaWheelLegPhases(family: MechaFamily, ov?: MechaLegOverrides, schemeName?: MechaSchemeName): { thigh: MechaSpriteData; shin: MechaSpriteData; foot: MechaSpriteData }[] {
  return [0, 8, 16].map((wheelPhase) => generateMechaWheelLegParts(family, { ...(ov ?? {}), wheelPhase }, schemeName));
}

/** 喷射背包精灵（原点=贴背挂载点，箱体在原点后方） */
export function generateMechaJetpack(family: MechaFamily, schemeName?: MechaSchemeName): MechaSpriteData {
  const scheme = schemeName ? mechaSchemeByName(schemeName) : SCHEME_OF[family];
  const cv = newCanvas(); const origin = { x: 200, y: 130 };
  const spec = { scheme, seed: 21, wear: 0.25, camo: CAMO_OF[family], twoTone: TWOTONE_OF[family] };
  const A = renderJetpack(cv, spec, origin);
  finishRender(cv, A, finFor(family, scheme));
  return cropSprite(cv, origin);
}

/** 武器精灵（臂炮/导弹荚/步枪；原点语义见 gear 的 renderWeapon） */
export function generateMechaWeapon(family: MechaFamily, kind: WeaponKind, schemeName?: MechaSchemeName, sizeMul?: { x: number; y: number }): MechaSpriteData {
  const scheme = schemeName ? mechaSchemeByName(schemeName) : SCHEME_OF[family];
  const cv = newCanvas(); const origin = kind === 'pod' ? { x: 170, y: 150 } : kind === 'podPylon' ? { x: 190, y: 330 } : { x: 90, y: 130 };
  // 武器尺寸分两层：族基准（按图库参考量比定——手持武器全长/身高：
  // 重机甲长炮 ≈0.75、敏捷 ≈0.37、动力服 ≈0.31；基准构造全长臂炮
  // 181、步枪 207；导弹荚族基准为 1）× 用户倍率 sizeMul（向导
  // 「武器长/武器粗」，导弹荚同为武器、同一套设置）。
  const WEAPON_SIZE: Record<MechaFamily, Record<'cannon' | 'rifle', { x: number; y: number }>> = {
    olive: { cannon: { x: 1.88, y: 1.27 }, rifle: { x: 1.84, y: 1.36 } },
    agile: { cannon: { x: 1.55, y: 1.05 }, rifle: { x: 1.4, y: 1.12 } },
    powersuit: { cannon: { x: 1.16, y: 0.91 }, rifle: { x: 1.04, y: 0.96 } },
  };
  const base = kind === 'cannon' || kind === 'rifle' ? WEAPON_SIZE[family][kind] : { x: 1, y: 1 };
  const size = { x: base.x * (sizeMul?.x ?? 1), y: base.y * (sizeMul?.y ?? 1) };
  const spec = { scheme, seed: 31, wear: 0.3, camo: CAMO_OF[family], twoTone: TWOTONE_OF[family], size };
  const A = renderWeapon(cv, spec, kind, origin);
  finishRender(cv, A, finFor(family, scheme));
  return cropSprite(cv, origin);
}

export type { WeaponKind };
