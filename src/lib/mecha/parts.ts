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
  armUpper: MechaSpriteData;
  armFore: MechaSpriteData;
  torso: MechaSpriteData;
  head: MechaSpriteData;
  /** 肘相对肩（前臂节点的挂载偏移） */
  elbowOff: Pt;
  /** 躯干插座（相对胯心=躯干精灵原点） */
  torsoSockets: { neck: Pt; shoulder: Pt; hip: Pt };
}

/** 生成一族的全部位精灵（人形：腿/上臂/前臂/躯干/头） */
export function generateMechaPartSet(family: MechaFamily): MechaPartSet {
  const scheme = SCHEME_OF[family];
  const F = fin(family);
  // 腿（整腿一件，原点=胯关节，验收锚点比例）
  const legCv = newCanvas(); const hip = { x: 100, y: 16 };
  const legA = layout(legCv, LEG_SPEC[family](scheme), { hip, knee: { x: hip.x + 88, y: hip.y + 204 }, ankle: { x: hip.x - 4, y: hip.y + 390 }, toeX: hip.x + 96 });
  finishRender(legCv, legA, F);
  const leg = cropSprite(legCv, hip);
  // 臂：按 IR 部件归属拆上臂/前臂
  const armSpec = ARM_SPEC[family](scheme);
  const ir = armIR(armSpec);
  type ArmPartT = (typeof ir.parts)[number];
  const isUpper = (p: ArmPartT) => ((p.t === 'segPlate' || p.t === 'segCore' || p.t === 'cable' || p.t === 'rod') && (p as { seg?: string }).seg === 'upper') || (p.t === 'disc' && p.at === 'shoulder') || (p.t === 'block' && p.frame === 'shoulder') || (p.t === 'discAt' && p.frame === 'upper') || p.t === 'insignia';
  const cvU = newCanvas(); const AU = renderArmIR(cvU, { anchors: ir.anchors, parts: ir.parts.filter(isUpper) }, armSpec);
  finishRender(cvU, AU, F);
  const armUpper = cropSprite(cvU, ir.anchors.shoulder);
  const cvF = newCanvas(); const AF = renderArmIR(cvF, { anchors: ir.anchors, parts: ir.parts.filter((p) => !isUpper(p)) }, armSpec);
  finishRender(cvF, AF, F);
  const armFore = cropSprite(cvF, ir.anchors.elbow);
  const elbowOff = { x: ir.anchors.elbow.x - ir.anchors.shoulder.x, y: ir.anchors.elbow.y - ir.anchors.shoulder.y };
  // 躯干（原点=胯心）
  const torsoSpec = TORSO_SPEC[family](scheme);
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
  return { leg, armUpper, armFore, torso, head, elbowOff, torsoSockets };
}

/** 载具车体精灵（原点=甲板中心），供载具线后续使用 */
export function generateMechaHull(kind: 'walker' | 'hauler'): MechaSpriteData {
  const spec: HullSpec = kind === 'walker'
    ? { family: 'walker', scheme: SCHEMES.olive, seed: 11, wear: 0.35, camo: true, twoTone: true, deck: { x: 190, y: 150 }, hullW: 250, hullH: 130, form: { turret: 'gun', cabin: 'front', skirt: true, modules: 3 }, gear: { insignia: 0, number: 'N-37' } }
    : { family: 'hauler', scheme: SCHEMES.slate, seed: 23, wear: 0.3, camo: false, twoTone: true, deck: { x: 190, y: 150 }, hullW: 260, hullH: 118, form: { turret: 'rack', cabin: 'mid', skirt: false, modules: 2 }, gear: { insignia: 1, number: 'M-7' } };
  const cv = newCanvas(); const A = renderHullIR(cv, hullIR(spec), spec);
  finishRender(cv, A, { topology: 'standard', scheme: spec.scheme, seed: 11, bend: 22, camo: spec.camo, wear: 0.3, detail: 0.65, altTone: spec.twoTone } as LegSpec & { altTone?: boolean });
  return cropSprite(cv, spec.deck);
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
