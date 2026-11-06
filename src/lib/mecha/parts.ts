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
  agile: (s) => ({ family: 'agile', scheme: s, seed: 21, wear: 0.15, camo: false, twoTone: true, neck: { x: 120, y: 16 }, chestW: 128, chestH: 128, waistH: 42, pelvisH: 66, form: { chest: 'shell', back: 'binder', grille: 'front', skirt: 'both' }, gear: { stripe: false, insignia: 0, number: '' } }),
  powersuit: (s) => ({ family: 'powersuit', scheme: s, seed: 49, wear: 0.15, camo: false, twoTone: false, neck: { x: 120, y: 16 }, chestW: 118, chestH: 110, waistH: 30, pelvisH: 62, form: { chest: 'shell', back: 'rack', grille: 'none', skirt: 'front' }, gear: { stripe: false, insignia: 1, number: '' } }),
};

const HEAD_SPEC: Record<MechaFamily, (scheme: Scheme) => HeadSpec> = {
  olive: (s) => ({ family: 'olive', twoTone: true, scheme: s, seed: 7, wear: 0.3, camo: true, seat: { x: 80, y: 120 }, w: 96, h: 84, tilt: 0.03, form: { crown: 'angular', eye: 'slit', brow: true, jaw: 'respirator', ear: 'grille', top: 'horn', cheekCable: false } }),
  agile: (s) => ({ family: 'agile', twoTone: true, scheme: s, seed: 21, wear: 0.15, camo: false, seat: { x: 80, y: 120 }, w: 92, h: 92, tilt: 0.02, form: { crown: 'angular', eye: 'slit', brow: true, jaw: 'block', ear: 'plate', top: 'vfin', cheekCable: false } }),
  powersuit: (s) => ({ family: 'powersuit', twoTone: false, scheme: s, seed: 49, wear: 0.15, camo: false, seat: { x: 80, y: 120 }, w: 100, h: 88, tilt: 0, form: { crown: 'dome', eye: 'visor', brow: false, jaw: 'respirator', ear: 'plate', top: 'none', cheekCable: false } }),
};

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
function legPipeline(family: MechaFamily, footType?: LegSpec['footType']): {
  full: MechaSpriteData; thigh: MechaSpriteData; shin: MechaSpriteData; foot: MechaSpriteData;
  geom: { thighLen: number; shinLen: number }; rest: { thigh: number; shin: number; foot: number };
} {
  const scheme = SCHEME_OF[family];
  const spec = LEG_SPEC[family](scheme);
  if (footType) spec.footType = footType;
  const posed = { hip: { x: 100, y: 16 }, knee: { x: 188, y: 220 }, ankle: { x: 96, y: 406 }, toe: { x: 196, y: 442 } };
  const L1 = Math.hypot(posed.knee.x - posed.hip.x, posed.knee.y - posed.hip.y);
  const L2 = Math.hypot(posed.ankle.x - posed.knee.x, posed.ankle.y - posed.knee.y);
  const k = 390 / (L1 + L2);
  const tL = L1 * k, sL = L2 * k;
  const canon = { hip: { x: 190, y: 30 }, knee: { x: 190, y: 30 + tL }, ankle: { x: 190, y: 30 + tL + sL }, toe: { x: 290, y: 30 + tL + sL + 36 } };
  const cv = newCanvas();
  const A = layout(cv, spec, { hip: canon.hip, knee: canon.knee, ankle: canon.ankle, toeX: canon.toe.x });
  finishRender(cv, A, fin(family));
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

export function generateMechaPartSet(family: MechaFamily, chest?: MechaChestVariant): MechaPartSet {
  const scheme = SCHEME_OF[family];
  const F = fin(family);
  // 腿：规范直姿渲染 + 按骨段拆三件（大腿/小腿/足，各自成节点才可动可配 IK）
  const legP = legPipeline(family);
  const leg = legP.full;
  // 臂：规范直姿（角度归零）渲染——上臂按 IR 归属、前臂/手按骨段距离拆
  const armSpec = ARM_SPEC[family](scheme);
  const ir = armIR(armSpec);
  const canonSpec = { ...armSpec, upperAng: 0, elbowBend: 0 };
  const irC = armIR(canonSpec);
  type ArmPartT = (typeof irC.parts)[number];
  const isUpper = (p: ArmPartT) => ((p.t === 'segPlate' || p.t === 'segCore' || p.t === 'cable' || p.t === 'rod') && (p as { seg?: string }).seg === 'upper') || (p.t === 'disc' && p.at === 'shoulder') || (p.t === 'block' && p.frame === 'shoulder') || (p.t === 'discAt' && p.frame === 'upper') || p.t === 'insignia';
  const cvU = newCanvas(); const AU = renderArmIR(cvU, { anchors: irC.anchors, parts: irC.parts.filter(isUpper) }, canonSpec);
  finishRender(cvU, AU, F);
  const armUpper = cropSprite(cvU, irC.anchors.shoulder);
  const cvF = newCanvas(); const AF = renderArmIR(cvF, { anchors: irC.anchors, parts: irC.parts.filter((p) => !isUpper(p)) }, canonSpec);
  finishRender(cvF, AF, F);
  const wristC = irC.anchors.wrist;
  const [armFore, armHand] = splitCanvasBySegments(cvF, [irC.anchors.elbow, wristC, { x: wristC.x, y: wristC.y + 72 }], [15]) as [MechaSpriteData, MechaSpriteData];
  const elbowOff = { x: ir.anchors.elbow.x - ir.anchors.shoulder.x, y: ir.anchors.elbow.y - ir.anchors.shoulder.y };
  const wristOff = { x: ir.anchors.wrist.x - ir.anchors.elbow.x, y: ir.anchors.wrist.y - ir.anchors.elbow.y };
  const palmOff = { x: ir.anchors.palm.x - ir.anchors.elbow.x, y: ir.anchors.palm.y - ir.anchors.elbow.y };
  // 躯干（原点=胯心）
  const torsoSpec = TORSO_SPEC[family](scheme);
  if (chest) torsoSpec.form = { ...torsoSpec.form, chest };
  const torsoIRv = torsoIR(torsoSpec);
  const torsoCv = newCanvas(); const TA = renderTorsoIR(torsoCv, torsoIRv, torsoSpec);
  finishRender(torsoCv, TA, F);
  const torso = cropSprite(torsoCv, torsoIRv.anchors.hip);
  const rel = (p: Pt) => ({ x: p.x - torsoIRv.anchors.hip.x, y: p.y - torsoIRv.anchors.hip.y });
  const torsoSockets = { neck: rel(torsoIRv.anchors.neck), shoulder: rel(torsoIRv.anchors.shoulder), hip: rel(torsoIRv.anchors.hip) };
  // 头（原点=颈座）
  const headSpec = HEAD_SPEC[family](scheme);
  const headCv = newCanvas(); const HA = renderHeadIR(headCv, headIR(headSpec), headSpec);
  finishRender(headCv, HA, F);
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

export function generateMechaHull(kind: 'walker' | 'hauler'): MechaSpriteData {
  const spec = HULL_SPEC_OF(kind);
  const cv = newCanvas(); const A = renderHullIR(cv, hullIR(spec), spec);
  finishRender(cv, A, { ...HULL_FIN, scheme: spec.scheme, camo: spec.camo, altTone: spec.twoTone } as LegSpec & { altTone?: boolean });
  return cropSprite(cv, spec.deck);
}

/** 车体（无炮塔）：载具根节点用，原点=甲板 */
export function generateMechaHullBody(kind: 'walker' | 'hauler'): MechaSpriteData {
  const spec: HullSpec = { ...HULL_SPEC_OF(kind), split: 'body' };
  const cv = newCanvas(); const A = renderHullIR(cv, hullIR(spec), spec);
  finishRender(cv, A, { ...HULL_FIN, scheme: spec.scheme, camo: spec.camo, altTone: spec.twoTone } as LegSpec & { altTone?: boolean });
  return cropSprite(cv, spec.deck);
}

/** 炮塔/顶架（独立件）：载具炮塔节点用，原点=炮塔转轴 */
export function generateMechaTurret(kind: 'walker' | 'hauler'): MechaSpriteData {
  const base = HULL_SPEC_OF(kind);
  const spec: HullSpec = { ...base, split: 'turret' };
  const cv = newCanvas(); const A = renderHullIR(cv, hullIR(spec), spec);
  finishRender(cv, A, { ...HULL_FIN, scheme: spec.scheme, camo: spec.camo, altTone: spec.twoTone } as LegSpec & { altTone?: boolean });
  const pivot = { x: spec.deck.x - spec.hullW * 0.06, y: spec.deck.y - spec.hullH * 0.14 };
  return cropSprite(cv, pivot);
}

/** 族主甲色（十六进制，供服装件底色/关节盘生成） */
export function mechaFamilyArmorHex(family: MechaFamily): string {
  const c = SCHEME_OF[family].armor;
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
export function generateMechaMultiLeg(family: MechaFamily, profile: 'spider' | 'quad'): MechaSpriteData {
  const scheme = SCHEME_OF[family];
  const cv = newCanvas(); const hip = { x: 56, y: 64 };
  const spec = { scheme, seed: 11, wear: 0.3, camo: CAMO_OF[family], twoTone: TWOTONE_OF[family], profile };
  const A = renderMultiLeg(cv, spec, hip);
  finishRender(cv, A, fin(family));
  return cropSprite(cv, hip);
}

/** 轮足分段件（大腿/小腿与常足共用造型、足换轮组）：底盘选轮足时用 */
export function generateMechaWheelLegParts(family: MechaFamily): { thigh: MechaSpriteData; shin: MechaSpriteData; foot: MechaSpriteData } {
  const p = legPipeline(family, 'wheel');
  return { thigh: p.thigh, shin: p.shin, foot: p.foot };
}

/** 多足腿分段件：上段（髋→膝，髋帧直姿）/下段（膝→踝→趾，膝帧、末段保留相对弯） */
export function generateMechaMultiLegParts(family: MechaFamily, profile: 'spider' | 'quad'): {
  upper: MechaSpriteData; lower: MechaSpriteData; l1: number; l2: number; a1: number; a2rel: number;
} {
  const scheme = SCHEME_OF[family];
  const spec = { scheme, seed: 11, wear: 0.3, camo: CAMO_OF[family], twoTone: TWOTONE_OF[family], profile };
  const gm = multiLegGeom(profile);
  // 上段：髋帧，段一竖直向下
  const hipU = { x: 70, y: 46 };
  const cvU = newCanvas();
  const AU = renderMultiLeg(cvU, spec, hipU, { knee: { x: hipU.x, y: hipU.y + gm.l1 }, ankle: { x: hipU.x, y: hipU.y + gm.l1 + gm.l2 }, toe: { x: hipU.x, y: hipU.y + gm.l1 + gm.l2 + 40 } }, 'upper');
  finishRender(cvU, AU, fin(family));
  const upper = cropSprite(cvU, hipU);
  // 下段：膝帧，段二竖直向下、趾段按相对弯旋转进来
  const kneeO = { x: 70, y: 30 };
  const ankleL = { x: kneeO.x, y: kneeO.y + gm.l2 };
  const rad = (-gm.a2 * Math.PI) / 180;
  const toeL = { x: ankleL.x + gm.toeVec.x * Math.cos(rad) - gm.toeVec.y * Math.sin(rad), y: ankleL.y + gm.toeVec.x * Math.sin(rad) + gm.toeVec.y * Math.cos(rad) };
  const cvL = newCanvas();
  const AL = renderMultiLeg(cvL, spec, kneeO, { knee: kneeO, ankle: ankleL, toe: toeL }, 'lower');
  finishRender(cvL, AL, fin(family));
  const lower = cropSprite(cvL, kneeO);
  return { upper, lower, l1: gm.l1, l2: gm.l2, a1: gm.a1, a2rel: gm.a2rel };
}

/** 履带底盘精灵（原点=座圈顶面中心，躯干/车体挂载点） */
export function generateMechaTrackUnit(family: MechaFamily): MechaSpriteData {
  const scheme = SCHEME_OF[family];
  const cv = newCanvas(); const origin = { x: 190, y: 26 };
  const spec = { scheme, seed: 11, wear: 0.3, camo: CAMO_OF[family], twoTone: TWOTONE_OF[family] };
  const A = renderTrackUnit(cv, spec, origin);
  finishRender(cv, A, fin(family));
  return cropSprite(cv, origin);
}

/** 喷射背包精灵（原点=贴背挂载点，箱体在原点后方） */
export function generateMechaJetpack(family: MechaFamily): MechaSpriteData {
  const scheme = SCHEME_OF[family];
  const cv = newCanvas(); const origin = { x: 200, y: 130 };
  const spec = { scheme, seed: 21, wear: 0.25, camo: CAMO_OF[family], twoTone: TWOTONE_OF[family] };
  const A = renderJetpack(cv, spec, origin);
  finishRender(cv, A, fin(family));
  return cropSprite(cv, origin);
}

/** 武器精灵（臂炮/导弹荚/步枪；原点语义见 gear 的 renderWeapon） */
export function generateMechaWeapon(family: MechaFamily, kind: WeaponKind): MechaSpriteData {
  const scheme = SCHEME_OF[family];
  const cv = newCanvas(); const origin = kind === 'pod' ? { x: 170, y: 150 } : kind === 'podPylon' ? { x: 190, y: 330 } : { x: 90, y: 130 };
  const spec = { scheme, seed: 31, wear: 0.3, camo: CAMO_OF[family], twoTone: TWOTONE_OF[family] };
  const A = renderWeapon(cv, spec, kind, origin);
  finishRender(cv, A, fin(family));
  return cropSprite(cv, origin);
}

export type { WeaponKind };
