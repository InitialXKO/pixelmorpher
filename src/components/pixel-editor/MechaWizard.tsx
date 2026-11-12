'use client';
// ============================================================
// 机甲生成向导：人形（选族/底盘/装备）或载具（车体/机动/上装），
// 按整机身高（32–512 px）设尺寸：基准高由预览装配实测（精灵
// 包围盒），scale = 输入身高 / 基准高。预览走产品渲染器同一条
// 世界变换口径（computeWorldTransforms + 投影深度画序），所见即
// 主画布所得；生成时项目画布按需只扩不缩以适应尺寸。产出是
// 真角色：三段肢链节点 + 预置 IK 链（默认禁用），主画布可摆
// 姿势/配 IK、可进运行时包。
// 部件解绑口径：族只是预设——配色 6 套整机另选；腿/臂/躯干/头/
// 车体各自可选变体与参数（主参数常驻、其余折叠进「高级」），
// 向导只把改过的字段拼成稀疏覆盖传给构建层，没改的部件与族
// 预设逐值一致。切族/车型时全部件控件回到该预设。
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useProjectStore } from '@/lib/store';
import { useEditorStore } from '@/lib/store/editor-store';
import { projectToView, subToPx, pxToSub } from '@/lib/unified-types';
import type { Character, Sprite } from '@/lib/unified-types';
import { computeWorldTransforms, renderCharacterOnionFrameFromCharacter } from '@/lib/unified-render';
import {
  generateMechaPartSet, generateMechaWheelLegParts, generateMechaMultiLegParts, generateMechaTrackUnit,
  generateMechaJetpack, generateMechaWeapon, generateMechaHullBody, generateMechaTurret,
  MECHA_FAMILIES, MECHA_CHEST_LABELS, MECHA_SCHEME_LABELS, MECHA_FAMILY_SCHEME,
  mechaLegSpecOf, mechaArmSpecOf, mechaTorsoSpecOf, mechaHeadSpecOf, mechaHullSpecOf,
  resolveProportions, MECHA_VEHICLE_PROPORTION_DEFAULTS,
  WEAPON_PRESETS, WEAPON_AXIS_OPTIONS,
} from '@/lib/mecha/parts';
import type {
  MechaFamily, MechaPartSet, MechaSpriteData, MechaSchemeName, MechaPartOverrides, MechaProportions, MechaProportionsFull, WeaponCombo, WeaponClass,
  MechaLegOverrides, MechaArmOverrides, MechaTorsoOverrides, MechaHeadOverrides, MechaHullOverrides,
} from '@/lib/mecha/parts';
import type { LegSpec, ArmSpec, TorsoSpec, TorsoProfile, HeadSpec, HullSpec, BlockShapeParams } from '@/lib/mecha/engine';
import { torsoProfileOf } from '@/lib/mecha/engine';
import {
  assembleMechaCharacter, assembleMechaVehicle, createMechaCharacterInStore, createMechaVehicleInStore,
  mechaHumanoidNodeParts, mechaVehicleNodeParts, mechaMobilityFamily, mechaVehicleScheme, vehLegMul,
  MECHA_VEHICLE_LABELS, MECHA_POD_MOUNT_LABELS,
  rgbaToPixelGrid,
} from '@/lib/mecha/build-character';
import type { MechaBuildOptions, MechaVehicleOptions, MechaPodMount } from '@/lib/mecha/build-character';
import {
  BUILTIN_ENTRIES, finishEntriesOf, libraryIndexOf, loadUserEntries, mechaDefOf, parseRefId, saveUserEntries,
  type LibraryEntry, type MechaEntryDef, type MechaGenDef,
} from '@/lib/library-entries';
import { applyComboOv, expandFinishDef } from '@/lib/mecha/entry-render';
import { finishDefOf, surfaceDefOf } from '@/lib/library-entries';
import { applySurface, type SurfaceChoice } from '@/lib/mecha/surface';
import type { MechaFinishOv } from '@/lib/mecha/parts';

type Mode = 'humanoid' | 'vehicle';
type WeaponSel = string; // 'none' 或武器预设 id（WEAPON_PRESETS）

const DEG = 180 / Math.PI;

/** 表面材质候选（工业类表面条目，第一期：武器 / 车体） */
const SURFACE_CHIPS: { ref: string; label: string }[] = [
  { ref: 'mech-pro@1', label: '精密机甲板' },
  { ref: 'vent-pro@1', label: '重型散热板' },
  { ref: 'carbon@1', label: '碳纤维' },
  { ref: 'steel@1', label: '工业钢板' },
  { ref: 'armor@1', label: '装甲钢板' },
];
const RAD = Math.PI / 180;
const r1 = (v: number) => Math.round(v * 10) / 10;
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(c: [number, number, number]): string {
  return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

// ---------- 部件控件状态（控件值 = 当前规格；与族预设的差 = 覆盖） ----------
interface LegCtl {
  footType: string; topology: string; bend: number; wScale: number; ankleShift: number;
  lift: number; coreScale: number; detail: number; wear: number; camo: boolean;
  shellMode: boolean; frameHeavy: boolean; guardOff: boolean; decalKind: string; cableTint: string; seed: number;
  kneeScale: number; calfScale: number; shinConcave: number;
  standSplay: number; standReach: number;
}
interface ArmCtl {
  hand: string; bulk: number; shell: number; upperLen: number; foreLen: number;
  upperAngDeg: number; elbowBendDeg: number; diag: number;
  formShell: string; formElbow: string; formFore: string; fingerLen: number; fingerCurl: number;
  gearCable: boolean; gearPiston: boolean; gearDevice: boolean; gearStripe: boolean;
  insKind: number; insAlong: number; insPerp: number; // 徽章模式参数（种类 −1=无 + 肩框落点），用户定
  twoTone: boolean; wear: number; camo: boolean; seed: number;
  bsCham: number; bsVarLo: number; bsVarHi: number; bsStep: number;
}
interface TorsoCtl {
  chestW: number; chestH: number; waistH: number; pelvisH: number;
  profTop: number; profFold: number; profFoldY: number; profBase: number; profDivY: number;
  intakeDx: number; intakeDy: number; intakeShareW: number; intakeShareH: number; boxDx: number; boxDy: number;
  intakeOrient: string; intakeTrim: boolean;
  keelPlate: boolean; keelReach: number; ventFuse: boolean; neckStruts: boolean;
  formChest: string; formBack: string; formGrille: string; formSkirt: string;
  gearStripe: boolean; gearInsignia: number; gearNumber: string; insX: number; insY: number; // 徽章落点（模式参数，用户定）
  twoTone: boolean; wear: number; camo: boolean; seed: number;
  bsCham: number; bsVarLo: number; bsVarHi: number; bsStep: number;
}
interface HeadCtl {
  w: number; h: number; tiltDeg: number;
  formCrown: string; formEye: string; formBrow: boolean; formJaw: string; formEar: string; formTop: string; formCheek: boolean;
  twoTone: boolean; wear: number; camo: boolean; seed: number;
  bsCham: number; bsVarLo: number; bsVarHi: number; bsStep: number;
}
interface HullCtl {
  hullW: number; hullH: number; formTurret: string; formCabin: string; formSkirt: boolean; formModules: number;
  gearInsignia: number; gearNumber: string; insX: number; insY: number; twoTone: boolean; wear: number; camo: boolean; seed: number;
  sagCables: boolean; sidePod: boolean;
  bsCham: number; bsVarLo: number; bsVarHi: number; bsStep: number;
}

function legCtlFromSpec(s: LegSpec): LegCtl {
  return {
    footType: s.footType ?? 'blocks', topology: s.topology, bend: s.bend,
    wScale: s.wScale ?? 1, ankleShift: s.ankleShift ?? 10, lift: s.lift ?? 0,
    coreScale: s.coreScale ?? 1, detail: s.detail ?? 0.65, wear: s.wear ?? 0.3,
    camo: s.camo, shellMode: s.shellMode ?? false, frameHeavy: s.frameHeavy ?? false,
    guardOff: s.guardOff ?? false, decalKind: s.decalKind ?? 'num',
    cableTint: s.cableTint ? rgbToHex(s.cableTint) : '', seed: s.seed,
    kneeScale: s.kneeScale ?? 1, calfScale: s.calfScale ?? 1, shinConcave: s.shinConcave ?? 1,
    standSplay: s.standSplay ?? 0.23, standReach: s.standReach ?? 0.93,
  };
}
function armCtlFromSpec(s: ArmSpec): ArmCtl {
  return {
    hand: s.hand, bulk: s.bulk, shell: s.shell, upperLen: s.upperLen, foreLen: s.foreLen,
    upperAngDeg: r1(s.upperAng * DEG), elbowBendDeg: r1(s.elbowBend * DEG), diag: s.diag,
    formShell: s.form.shell, formElbow: s.form.elbow, formFore: s.form.fore,
    fingerLen: s.form.fingerLen, fingerCurl: s.form.fingerCurl,
    gearCable: s.gear.cable, gearPiston: s.gear.piston, gearDevice: s.gear.device, gearStripe: s.gear.stripe,
    insKind: s.insignia?.kind ?? -1, insAlong: s.insignia?.along ?? -10, insPerp: s.insignia?.perp ?? -4,
    twoTone: s.twoTone, wear: s.wear, camo: s.camo, seed: s.seed,
    bsCham: s.blockShape?.chamFloor ?? 0.3, bsVarLo: s.blockShape?.varLo ?? 0.3, bsVarHi: s.blockShape?.varHi ?? 1.8, bsStep: s.blockShape?.stepP ?? 0.45,
  };
}
function torsoCtlFromSpec(s: TorsoSpec): TorsoCtl {
  const P = torsoProfileOf(s), r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    chestW: s.chestW, chestH: s.chestH, waistH: s.waistH, pelvisH: s.pelvisH,
    profTop: r2(P.top), profFold: r2(P.fold), profFoldY: r2(P.foldY), profBase: r2(P.base), profDivY: r2(P.divY),
    intakeDx: s.intakeDepth?.[0] ?? 0.08, intakeDy: s.intakeDepth?.[1] ?? 0.08, intakeShareW: s.intakeShare?.[0] ?? 0.92, intakeShareH: s.intakeShare?.[1] ?? 0.75,
    boxDx: s.boxDepth?.[0] ?? 0.92, boxDy: s.boxDepth?.[1] ?? 0.7,
    intakeOrient: s.intakeOrient ?? 'flat', intakeTrim: s.intakeTrim !== false,
    keelPlate: s.keelPlate !== false, keelReach: s.keelReach ?? 0.32, ventFuse: s.ventFuse !== false, neckStruts: s.neckStruts === true,
    formChest: s.form.chest, formBack: s.form.back, formGrille: s.form.grille, formSkirt: s.form.skirt,
    gearStripe: s.gear.stripe, gearInsignia: s.gear.insignia, gearNumber: s.gear.number,
    insX: r2(s.insigniaPos?.[0] ?? 0.16), insY: r2(s.insigniaPos?.[1] ?? 0.26),
    twoTone: s.twoTone, wear: s.wear, camo: s.camo, seed: s.seed,
    bsCham: s.blockShape?.chamFloor ?? 0.3, bsVarLo: s.blockShape?.varLo ?? 0.3, bsVarHi: s.blockShape?.varHi ?? 1.8, bsStep: s.blockShape?.stepP ?? 0.45,
  };
}
function headCtlFromSpec(s: HeadSpec): HeadCtl {
  return {
    w: s.w, h: s.h, tiltDeg: r1(s.tilt * DEG),
    formCrown: s.form.crown, formEye: s.form.eye, formBrow: s.form.brow, formJaw: s.form.jaw,
    formEar: s.form.ear, formTop: s.form.top, formCheek: s.form.cheekCable,
    twoTone: s.twoTone, wear: s.wear, camo: s.camo, seed: s.seed,
    bsCham: s.blockShape?.chamFloor ?? 0.3, bsVarLo: s.blockShape?.varLo ?? 0.3, bsVarHi: s.blockShape?.varHi ?? 1.8, bsStep: s.blockShape?.stepP ?? 0.45,
  };
}
function hullCtlFromSpec(s: HullSpec): HullCtl {
  return {
    hullW: s.hullW, hullH: s.hullH, formTurret: s.form.turret, formCabin: s.form.cabin,
    formSkirt: s.form.skirt, formModules: s.form.modules,
    gearInsignia: s.gear.insignia, gearNumber: s.gear.number,
    insX: Math.round((s.insigniaPos?.[0] ?? 0) * 100) / 100, insY: Math.round((s.insigniaPos?.[1] ?? 0) * 100) / 100,
    sagCables: s.sagCables === true, sidePod: s.sidePod === true,
    twoTone: s.twoTone, wear: s.wear, camo: s.camo, seed: s.seed,
    bsCham: s.blockShape?.chamFloor ?? 0.3, bsVarLo: s.blockShape?.varLo ?? 0.3, bsVarHi: s.blockShape?.varHi ?? 1.8, bsStep: s.blockShape?.stepP ?? 0.45,
  };
}

const legDefaults = (f: MechaFamily): LegCtl => legCtlFromSpec(mechaLegSpecOf(f));
const armDefaults = (f: MechaFamily): ArmCtl => armCtlFromSpec(mechaArmSpecOf(f));
const torsoDefaults = (f: MechaFamily): TorsoCtl => torsoCtlFromSpec(mechaTorsoSpecOf(f));
const headDefaults = (f: MechaFamily): HeadCtl => headCtlFromSpec(mechaHeadSpecOf(f));
const hullDefaults = (kind: 'walker' | 'hauler'): HullCtl => hullCtlFromSpec(mechaHullSpecOf(kind));

/** 条目 def 的覆盖并回规格再投影成控件值（与生成侧同一合并口径） */
const legCtlFromMerged = (f: MechaFamily, ov?: MechaLegOverrides): LegCtl =>
  legCtlFromSpec({ ...mechaLegSpecOf(f), ...(ov ?? {}) });
const armCtlFromMerged = (f: MechaFamily, ov?: MechaArmOverrides): ArmCtl => {
  const b = mechaArmSpecOf(f);
  return armCtlFromSpec({ ...b, ...(ov ?? {}), blockShape: { ...(b.blockShape ?? { chamFloor: 0.3, varLo: 0.3, varHi: 1.8, stepP: 0.45 }), ...(ov?.blockShape ?? {}) }, form: { ...b.form, ...(ov?.form ?? {}) }, gear: { ...b.gear, ...(ov?.gear ?? {}) } });
};
const torsoCtlFromMerged = (f: MechaFamily, ov?: MechaTorsoOverrides): TorsoCtl => {
  const b = mechaTorsoSpecOf(f);
  return torsoCtlFromSpec({ ...b, ...(ov ?? {}), blockShape: { ...(b.blockShape ?? { chamFloor: 0.3, varLo: 0.3, varHi: 1.8, stepP: 0.45 }), ...(ov?.blockShape ?? {}) }, form: { ...b.form, ...(ov?.form ?? {}) }, gear: { ...b.gear, ...(ov?.gear ?? {}) }, profile: { ...(b.profile ?? {}), ...(ov?.profile ?? {}) } });
};
const headCtlFromMerged = (f: MechaFamily, ov?: MechaHeadOverrides): HeadCtl => {
  const b = mechaHeadSpecOf(f);
  return headCtlFromSpec({ ...b, ...(ov ?? {}), blockShape: { ...(b.blockShape ?? { chamFloor: 0.3, varLo: 0.3, varHi: 1.8, stepP: 0.45 }), ...(ov?.blockShape ?? {}) }, form: { ...b.form, ...(ov?.form ?? {}) } });
};
const hullCtlFromMerged = (kind: 'walker' | 'hauler', ov?: MechaHullOverrides): HullCtl => {
  const b = mechaHullSpecOf(kind);
  return hullCtlFromSpec({ ...b, ...(ov ?? {}), blockShape: { ...(b.blockShape ?? { chamFloor: 0.3, varLo: 0.3, varHi: 1.8, stepP: 0.45 }), ...(ov?.blockShape ?? {}) }, form: { ...b.form, ...(ov?.form ?? {}) }, gear: { ...b.gear, ...(ov?.gear ?? {}) } });
};

/** 着色展开值 → 部件覆盖通道（只取有值的字段；与条目调用口同一口径） */
function finLegChannels(fin: MechaFinishOv): MechaLegOverrides {
  const o: Record<string, unknown> = {};
  if (fin.wear !== undefined) o.wear = fin.wear;
  if (fin.camo !== undefined) o.camo = fin.camo;
  if (fin.detail !== undefined) o.detail = fin.detail;
  if (fin.shellMode !== undefined) o.shellMode = fin.shellMode;
  if (fin.ridges !== undefined) o.ridges = fin.ridges;
  if (fin.thickRatio !== undefined) o.thickRatio = fin.thickRatio;
  if (fin.decalKind !== undefined) o.decalKind = fin.decalKind;
  if (fin.cableTint !== undefined) o.cableTint = fin.cableTint;
  return o as MechaLegOverrides;
}
function finCommonChannels(fin: MechaFinishOv): { wear?: number; camo?: boolean; twoTone?: boolean } {
  const o: { wear?: number; camo?: boolean; twoTone?: boolean } = {};
  if (fin.wear !== undefined) o.wear = fin.wear;
  if (fin.camo !== undefined) o.camo = fin.camo;
  if (fin.twoTone !== undefined) o.twoTone = fin.twoTone;
  return o;
}

function buildLegOv(def: LegCtl, cur: LegCtl): MechaLegOverrides | undefined {
  const ov: MechaLegOverrides = {};
  if (cur.footType !== def.footType) ov.footType = cur.footType as LegSpec['footType'];
  if (cur.topology !== def.topology) ov.topology = cur.topology as LegSpec['topology'];
  if (cur.bend !== def.bend) ov.bend = cur.bend;
  if (cur.wScale !== def.wScale) ov.wScale = cur.wScale;
  if (cur.ankleShift !== def.ankleShift) ov.ankleShift = cur.ankleShift;
  if (cur.lift !== def.lift) ov.lift = cur.lift;
  if (cur.coreScale !== def.coreScale) ov.coreScale = cur.coreScale;
  if (cur.detail !== def.detail) ov.detail = cur.detail;
  if (cur.wear !== def.wear) ov.wear = cur.wear;
  if (cur.camo !== def.camo) ov.camo = cur.camo;
  if (cur.shellMode !== def.shellMode) ov.shellMode = cur.shellMode;
  if (cur.frameHeavy !== def.frameHeavy) ov.frameHeavy = cur.frameHeavy;
  if (cur.guardOff !== def.guardOff) ov.guardOff = cur.guardOff;
  if (cur.decalKind !== def.decalKind) ov.decalKind = cur.decalKind as LegSpec['decalKind'];
  if (cur.cableTint !== def.cableTint && cur.cableTint) ov.cableTint = hexToRgb(cur.cableTint);
  if (cur.seed !== def.seed) ov.seed = cur.seed;
  if (cur.kneeScale !== def.kneeScale) ov.kneeScale = cur.kneeScale;
  if (cur.calfScale !== def.calfScale) ov.calfScale = cur.calfScale;
  if (cur.shinConcave !== def.shinConcave) ov.shinConcave = cur.shinConcave;
  if (cur.standSplay !== def.standSplay) ov.standSplay = cur.standSplay;
  if (cur.standReach !== def.standReach) ov.standReach = cur.standReach;
  return Object.keys(ov).length ? ov : undefined;
}
function buildArmOv(def: ArmCtl, cur: ArmCtl): MechaArmOverrides | undefined {
  const ov: MechaArmOverrides = {};
  if (cur.hand !== def.hand) ov.hand = cur.hand as ArmSpec['hand'];
  if (cur.bulk !== def.bulk) ov.bulk = cur.bulk;
  if (cur.shell !== def.shell) ov.shell = cur.shell;
  if (cur.upperLen !== def.upperLen) ov.upperLen = cur.upperLen;
  if (cur.foreLen !== def.foreLen) ov.foreLen = cur.foreLen;
  if (cur.upperAngDeg !== def.upperAngDeg) ov.upperAng = cur.upperAngDeg * RAD;
  if (cur.elbowBendDeg !== def.elbowBendDeg) ov.elbowBend = cur.elbowBendDeg * RAD;
  if (cur.diag !== def.diag) ov.diag = cur.diag;
  const form: Partial<ArmSpec['form']> = {};
  if (cur.formShell !== def.formShell) form.shell = cur.formShell as ArmSpec['form']['shell'];
  if (cur.formElbow !== def.formElbow) form.elbow = cur.formElbow as ArmSpec['form']['elbow'];
  if (cur.formFore !== def.formFore) form.fore = cur.formFore as ArmSpec['form']['fore'];
  if (cur.fingerLen !== def.fingerLen) form.fingerLen = cur.fingerLen;
  if (cur.fingerCurl !== def.fingerCurl) form.fingerCurl = cur.fingerCurl;
  if (Object.keys(form).length) ov.form = form;
  const gear: Partial<ArmSpec['gear']> = {};
  if (cur.gearCable !== def.gearCable) gear.cable = cur.gearCable;
  if (cur.gearPiston !== def.gearPiston) gear.piston = cur.gearPiston;
  if (cur.gearDevice !== def.gearDevice) gear.device = cur.gearDevice;
  if (cur.gearStripe !== def.gearStripe) gear.stripe = cur.gearStripe;
  if (Object.keys(gear).length) ov.gear = gear;
  if (cur.insKind !== def.insKind || cur.insAlong !== def.insAlong || cur.insPerp !== def.insPerp) ov.insignia = cur.insKind < 0 ? undefined : { kind: cur.insKind, along: cur.insAlong, perp: cur.insPerp };
  if (cur.twoTone !== def.twoTone) ov.twoTone = cur.twoTone;
  if (cur.wear !== def.wear) ov.wear = cur.wear;
  if (cur.camo !== def.camo) ov.camo = cur.camo;
  if (cur.seed !== def.seed) ov.seed = cur.seed;
  const bs: Partial<BlockShapeParams> = {};
  if (cur.bsCham !== def.bsCham) bs.chamFloor = cur.bsCham;
  if (cur.bsVarLo !== def.bsVarLo) bs.varLo = cur.bsVarLo;
  if (cur.bsVarHi !== def.bsVarHi) bs.varHi = cur.bsVarHi;
  if (cur.bsStep !== def.bsStep) bs.stepP = cur.bsStep;
  if (Object.keys(bs).length) ov.blockShape = bs;
  return Object.keys(ov).length ? ov : undefined;
}
function buildTorsoOv(def: TorsoCtl, cur: TorsoCtl): MechaTorsoOverrides | undefined {
  const ov: MechaTorsoOverrides = {};
  if (cur.chestW !== def.chestW) ov.chestW = cur.chestW;
  if (cur.chestH !== def.chestH) ov.chestH = cur.chestH;
  if (cur.waistH !== def.waistH) ov.waistH = cur.waistH;
  if (cur.intakeDx !== def.intakeDx || cur.intakeDy !== def.intakeDy) ov.intakeDepth = [cur.intakeDx, cur.intakeDy];
  if (cur.boxDx !== def.boxDx || cur.boxDy !== def.boxDy) ov.boxDepth = [cur.boxDx, cur.boxDy];
  if (cur.intakeShareW !== def.intakeShareW || cur.intakeShareH !== def.intakeShareH) ov.intakeShare = [cur.intakeShareW, cur.intakeShareH];
  if (cur.intakeOrient !== def.intakeOrient) ov.intakeOrient = cur.intakeOrient as 'keel' | 'flat';
  if (cur.intakeTrim !== def.intakeTrim) ov.intakeTrim = cur.intakeTrim;
  if (cur.keelPlate !== def.keelPlate) ov.keelPlate = cur.keelPlate;
  if (cur.neckStruts !== def.neckStruts) ov.neckStruts = cur.neckStruts;
  if (cur.keelReach !== def.keelReach) ov.keelReach = cur.keelReach;
  if (cur.ventFuse !== def.ventFuse) ov.ventFuse = cur.ventFuse;
  if (cur.pelvisH !== def.pelvisH) ov.pelvisH = cur.pelvisH;
  const form: Partial<TorsoSpec['form']> = {};
  if (cur.formChest !== def.formChest) form.chest = cur.formChest as TorsoSpec['form']['chest'];
  if (cur.formBack !== def.formBack) form.back = cur.formBack as TorsoSpec['form']['back'];
  if (cur.formGrille !== def.formGrille) form.grille = cur.formGrille as TorsoSpec['form']['grille'];
  if (cur.formSkirt !== def.formSkirt) form.skirt = cur.formSkirt as TorsoSpec['form']['skirt'];
  if (Object.keys(form).length) ov.form = form;
  const gear: Partial<TorsoSpec['gear']> = {};
  if (cur.gearStripe !== def.gearStripe) gear.stripe = cur.gearStripe;
  if (cur.gearInsignia !== def.gearInsignia) gear.insignia = cur.gearInsignia;
  if (cur.gearNumber !== def.gearNumber) gear.number = cur.gearNumber;
  if (Object.keys(gear).length) ov.gear = gear;
  if (cur.insX !== def.insX || cur.insY !== def.insY) ov.insigniaPos = [cur.insX, cur.insY];
  if (cur.twoTone !== def.twoTone) ov.twoTone = cur.twoTone;
  if (cur.wear !== def.wear) ov.wear = cur.wear;
  if (cur.camo !== def.camo) ov.camo = cur.camo;
  const profile: Partial<TorsoProfile> = {};
  if (cur.profTop !== def.profTop) profile.top = cur.profTop;
  if (cur.profFold !== def.profFold) profile.fold = cur.profFold;
  if (cur.profFoldY !== def.profFoldY) profile.foldY = cur.profFoldY;
  if (cur.profBase !== def.profBase) profile.base = cur.profBase;
  if (cur.profDivY !== def.profDivY) profile.divY = cur.profDivY;
  if (Object.keys(profile).length) ov.profile = profile;
  if (cur.seed !== def.seed) ov.seed = cur.seed;
  const bs: Partial<BlockShapeParams> = {};
  if (cur.bsCham !== def.bsCham) bs.chamFloor = cur.bsCham;
  if (cur.bsVarLo !== def.bsVarLo) bs.varLo = cur.bsVarLo;
  if (cur.bsVarHi !== def.bsVarHi) bs.varHi = cur.bsVarHi;
  if (cur.bsStep !== def.bsStep) bs.stepP = cur.bsStep;
  if (Object.keys(bs).length) ov.blockShape = bs;
  return Object.keys(ov).length ? ov : undefined;
}
function buildHeadOv(def: HeadCtl, cur: HeadCtl): MechaHeadOverrides | undefined {
  const ov: MechaHeadOverrides = {};
  if (cur.w !== def.w) ov.w = cur.w;
  if (cur.h !== def.h) ov.h = cur.h;
  if (cur.tiltDeg !== def.tiltDeg) ov.tilt = cur.tiltDeg * RAD;
  const form: Partial<HeadSpec['form']> = {};
  if (cur.formCrown !== def.formCrown) form.crown = cur.formCrown as HeadSpec['form']['crown'];
  if (cur.formEye !== def.formEye) form.eye = cur.formEye as HeadSpec['form']['eye'];
  if (cur.formBrow !== def.formBrow) form.brow = cur.formBrow;
  if (cur.formJaw !== def.formJaw) form.jaw = cur.formJaw as HeadSpec['form']['jaw'];
  if (cur.formEar !== def.formEar) form.ear = cur.formEar as HeadSpec['form']['ear'];
  if (cur.formTop !== def.formTop) form.top = cur.formTop as HeadSpec['form']['top'];
  if (cur.formCheek !== def.formCheek) form.cheekCable = cur.formCheek;
  if (Object.keys(form).length) ov.form = form;
  if (cur.twoTone !== def.twoTone) ov.twoTone = cur.twoTone;
  if (cur.wear !== def.wear) ov.wear = cur.wear;
  if (cur.camo !== def.camo) ov.camo = cur.camo;
  if (cur.seed !== def.seed) ov.seed = cur.seed;
  const bs: Partial<BlockShapeParams> = {};
  if (cur.bsCham !== def.bsCham) bs.chamFloor = cur.bsCham;
  if (cur.bsVarLo !== def.bsVarLo) bs.varLo = cur.bsVarLo;
  if (cur.bsVarHi !== def.bsVarHi) bs.varHi = cur.bsVarHi;
  if (cur.bsStep !== def.bsStep) bs.stepP = cur.bsStep;
  if (Object.keys(bs).length) ov.blockShape = bs;
  return Object.keys(ov).length ? ov : undefined;
}
function buildHullOv(def: HullCtl, cur: HullCtl): MechaHullOverrides | undefined {
  const ov: MechaHullOverrides = {};
  if (cur.hullW !== def.hullW) ov.hullW = cur.hullW;
  if (cur.hullH !== def.hullH) ov.hullH = cur.hullH;
  const form: Partial<HullSpec['form']> = {};
  if (cur.formTurret !== def.formTurret) form.turret = cur.formTurret as HullSpec['form']['turret'];
  if (cur.formCabin !== def.formCabin) form.cabin = cur.formCabin as HullSpec['form']['cabin'];
  if (cur.formSkirt !== def.formSkirt) form.skirt = cur.formSkirt;
  if (cur.formModules !== def.formModules) form.modules = cur.formModules;
  if (Object.keys(form).length) ov.form = form;
  const gear: Partial<HullSpec['gear']> = {};
  if (cur.gearInsignia !== def.gearInsignia) gear.insignia = cur.gearInsignia;
  if (cur.gearNumber !== def.gearNumber) gear.number = cur.gearNumber;
  if (Object.keys(gear).length) ov.gear = gear;
  if (cur.insX !== def.insX || cur.insY !== def.insY) ov.insigniaPos = [cur.insX, cur.insY];
  if (cur.sagCables !== def.sagCables) ov.sagCables = cur.sagCables;
  if (cur.sidePod !== def.sidePod) ov.sidePod = cur.sidePod;
  if (cur.twoTone !== def.twoTone) ov.twoTone = cur.twoTone;
  if (cur.wear !== def.wear) ov.wear = cur.wear;
  if (cur.camo !== def.camo) ov.camo = cur.camo;
  if (cur.seed !== def.seed) ov.seed = cur.seed;
  const bs: Partial<BlockShapeParams> = {};
  if (cur.bsCham !== def.bsCham) bs.chamFloor = cur.bsCham;
  if (cur.bsVarLo !== def.bsVarLo) bs.varLo = cur.bsVarLo;
  if (cur.bsVarHi !== def.bsVarHi) bs.varHi = cur.bsVarHi;
  if (cur.bsStep !== def.bsStep) bs.stepP = cur.bsStep;
  if (Object.keys(bs).length) ov.blockShape = bs;
  return Object.keys(ov).length ? ov : undefined;
}

function Chip(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={props.onClick}
      className={`px-2.5 py-1 rounded text-[11px] border transition-colors ${
        props.active ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
          : 'border-white/10 text-gray-400 hover:border-white/25'}`}>
      {props.children}
    </button>
  );
}

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Label className="text-xs text-gray-400 w-14 shrink-0">{props.label}</Label>
      {props.children}
    </div>
  );
}

/** 数字参数：本地文本编辑、失焦/回车才提交，避免逐键触发整套重生成 */
function NumCtl(props: { label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => { setText(String(props.value)); }, [props.value]);
  const commit = () => {
    const n = Number(text);
    if (text !== '' && Number.isFinite(n)) props.onCommit(Math.max(props.min, Math.min(props.max, n)));
    else setText(String(props.value));
  };
  return (
    <label className="flex items-center gap-1 text-[11px] text-gray-400">
      {props.label}
      <Input type="number" min={props.min} max={props.max} step={props.step} value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="h-6 w-16 px-1 text-[11px] bg-[#0d0d1a] border-[#1e1e3a] text-gray-200" />
    </label>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-t border-white/5 pt-2">
      <div className="text-[11px] font-semibold text-gray-300">{props.title}</div>
      {props.children}
    </div>
  );
}

function Adv(props: { id: string; open: Record<string, boolean>; setOpen: (o: Record<string, boolean>) => void; children: React.ReactNode }) {
  const isOpen = !!props.open[props.id];
  return (
    <>
      <button onClick={() => props.setOpen({ ...props.open, [props.id]: !isOpen })} className="text-[11px] text-cyan-300/70 hover:text-cyan-300">
        {isOpen ? '高级 ▾' : '高级 ▸ 细节 / 磨损 / 种子'}
      </button>
      {isOpen && <div className="space-y-2">{props.children}</div>}
    </>
  );
}

export default function MechaWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('humanoid');
  const [family, setFamily] = useState<MechaFamily>('olive');
  const [chassisSel, setChassisSel] = useState<'biped' | 'tracks'>('biped');
  const [jetpack, setJetpack] = useState(false);
  const [podMount, setPodMount] = useState<MechaPodMount | null>(null);
  const [weapon, setWeapon] = useState<WeaponSel>('none');
  const [weaponLen, setWeaponLen] = useState(1);
  const [weaponThick, setWeaponThick] = useState(1);
  // 武器组合覆盖（部件轴差量）：换预设时清空，部件选择只记改过的轴
  const [weaponComboOv, setWeaponComboOv] = useState<Partial<WeaponCombo>>({});
  const [podRows, setPodRows] = useState(3);
  const pickWeapon = (id: WeaponSel) => { setWeapon((w) => (w === id ? 'none' : id)); setWeaponComboOv({}); };
  const [hull, setHull] = useState<MechaVehicleOptions['hull']>('walker');
  const [mobility, setMobility] = useState<MechaVehicleOptions['mobility']>('legs');
  const [turret, setTurret] = useState(true);
  const [heightPx, setHeightPx] = useState(512);
  const [heightText, setHeightText] = useState('512');
  // 当前配置在 scale=1 时的实测总高（预览装配量得，按配置签名缓存）
  const [baseCal, setBaseCal] = useState<{ sig: string; h: number } | null>(null);
  // 载具预览离屏内容包围盒（按 sig 缓存，与 baseCal 同一次扫描产出）：
  // 贴回预览画布按它整体入框，保证整车不被画布边缘裁切
  const vehBBoxRef = useRef<{ sig: string; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [name, setName] = useState('机甲-01');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [scheme, setScheme] = useState<MechaSchemeName>('olive');
  // 模式库接线：条目（内置+我的）与着色选择（引用串，钉版）
  const [userEntries, setUserEntries] = useState<LibraryEntry[]>(() => loadUserEntries());
  const libEntries = [...BUILTIN_ENTRIES, ...userEntries];
  const [finishRef, setFinishRef] = useState('finish-olive@1');
  /** 套用条目时压住一次「切族重置」副作用（哨兵，见下方两个 effect） */
  const guardApply = useRef(false);
  const renderTick = useRef(0);
  const guardTick = useRef(-10);
  useEffect(() => { renderTick.current += 1; if (guardApply.current && renderTick.current - guardTick.current > 1) guardApply.current = false; });
  useEffect(() => { if (open) setUserEntries(loadUserEntries()); }, [open ]);
  const finOv = useMemo(() => {
    const fr = parseRefId(finishRef);
    const got = finishDefOf(libraryIndexOf(libEntries), fr.id, fr.version);
    return got ? expandFinishDef(got.def) : undefined;
  }, [finishRef, libEntries]);
  // 表面材质（全部部件）：条目引用 + 解析后的烘焙选择
  const [surfaceRef, setSurfaceRef] = useState('');
  const surfChoice: SurfaceChoice | undefined = useMemo(() => {
    if (!surfaceRef) return undefined;
    const sr = parseRefId(surfaceRef);
    const got = surfaceDefOf(libraryIndexOf(libEntries), sr.id, sr.version);
    if (!got) return undefined;
    const params: Record<string, number> = {};
    for (const p of got.def.params) params[p.key] = p.def;
    return { template: sr.id, params };
  }, [surfaceRef, libEntries]);
  const [trackLen, setTrackLen] = useState(252);
  /** 部件集贴表面材质（克隆后贴，不动 getPartSet 的缓存原件） */
  const surfacedPartSet = (ps: MechaPartSet): MechaPartSet => {
    if (!surfChoice) return ps;
    // 只克隆精灵字段贴材质；geom/rest/stand/挂点等非精灵字段原样带过
    // （此前整表 Object.entries 硬当精灵克隆，非精灵字段被塞进空 rgba、
    // 靠展开兜底才没坏数据，类型也对不上）
    const SPRITE_KEYS = ['leg', 'legThigh', 'legShin', 'legFoot', 'hipBeam', 'armUpper', 'armFore', 'armHand', 'torso', 'head'] as const;
    const out: MechaPartSet = { ...ps };
    for (const k of SPRITE_KEYS) {
      const v = ps[k];
      if (!v) continue;
      const c: MechaSpriteData = { ...v, rgba: new Uint8ClampedArray(v.rgba) };
      applySurface(c, surfChoice);
      out[k] = c;
    }
    return out;
  };
  const [advOpen, setAdvOpen] = useState<Record<string, boolean>>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const partSetCache = useRef(new Map<string, MechaPartSet>());
  const spriteCache = useRef(new Map<string, MechaSpriteData>());
  const bitmapCache = useRef(new Map<string, HTMLCanvasElement>());

  const [legBox, setLegBox] = useState(() => ({ def: legDefaults('olive'), cur: legDefaults('olive') }));
  const [armBox, setArmBox] = useState(() => ({ def: armDefaults('olive'), cur: armDefaults('olive') }));
  const [torsoBox, setTorsoBox] = useState(() => ({ def: torsoDefaults('olive'), cur: torsoDefaults('olive') }));
  const [headBox, setHeadBox] = useState(() => ({ def: headDefaults('olive'), cur: headDefaults('olive') }));
  const [hullBox, setHullBox] = useState(() => ({ def: hullDefaults('walker'), cur: hullDefaults('walker') }));
  // 整机比例（部位间比例倍率组）：默认是族据参考实测反定的值，用户改动以差量进构建选项
  const [propBox, setPropBox] = useState(() => ({ def: resolveProportions('olive'), cur: resolveProportions('olive') }));
  const [vehPropBox, setVehPropBox] = useState(() => ({ def: MECHA_VEHICLE_PROPORTION_DEFAULTS.walker, cur: { ...MECHA_VEHICLE_PROPORTION_DEFAULTS.walker } }));
  const setProp = (patch: Partial<MechaProportionsFull>) => setPropBox((b) => ({ def: b.def, cur: { ...b.cur, ...patch } }));
  const setVehProp = (patch: Partial<{ leg: number; hullH: number }>) => setVehPropBox((b) => ({ def: b.def, cur: { ...b.cur, ...patch } }));
  const legCtl = legBox.cur, armCtl = armBox.cur, torsoCtl = torsoBox.cur, headCtl = headBox.cur, hullCtl = hullBox.cur;
  const setLeg = (patch: Partial<LegCtl>) => setLegBox((b) => ({ def: b.def, cur: { ...b.cur, ...patch } }));
  const setArm = (patch: Partial<ArmCtl>) => setArmBox((b) => ({ def: b.def, cur: { ...b.cur, ...patch } }));
  const setTorso = (patch: Partial<TorsoCtl>) => setTorsoBox((b) => ({ def: b.def, cur: { ...b.cur, ...patch } }));
  const setHead = (patch: Partial<HeadCtl>) => setHeadBox((b) => ({ def: b.def, cur: { ...b.cur, ...patch } }));
  const setHullCtl = (patch: Partial<HullCtl>) => setHullBox((b) => ({ def: b.def, cur: { ...b.cur, ...patch } }));

  // 切模式/族/车型/机动时，相关控件回到对应预设
  useEffect(() => {
    if (guardApply.current) { guardApply.current = false; return; }
    setFinishRef(mode === 'humanoid' ? `finish-${family}@1` : 'finish-olive@1');
    if (mode === 'humanoid') {
      setScheme(MECHA_FAMILY_SCHEME[family]);
      const l = legDefaults(family); setLegBox({ def: l, cur: { ...l } });
      const a = armDefaults(family); setArmBox({ def: a, cur: { ...a } });
      const t = torsoDefaults(family); setTorsoBox({ def: t, cur: { ...t } });
      const h = headDefaults(family); setHeadBox({ def: h, cur: { ...h } });
      const pr = resolveProportions(family); setPropBox({ def: pr, cur: { ...pr } });
    } else {
      const hc = hullDefaults(hull); setHullBox({ def: hc, cur: { ...hc } });
      const vp = MECHA_VEHICLE_PROPORTION_DEFAULTS[hull]; setVehPropBox({ def: vp, cur: { ...vp } });
      setScheme(hull === 'walker' ? 'olive' : 'slate');
      setTurret(true);
      if (mobility === 'legs') {
        const l = legDefaults(mechaMobilityFamily(hull)); setLegBox({ def: l, cur: { ...l } });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, family, hull, mobility]);

  const buildOpts = useCallback((): MechaBuildOptions => {
    const parts: MechaPartOverrides = {};
    if (scheme !== MECHA_FAMILY_SCHEME[family]) parts.scheme = scheme;
    const lo = buildLegOv(legBox.def, legBox.cur);
    const ao = buildArmOv(armBox.def, armBox.cur);
    const to = buildTorsoOv(torsoBox.def, torsoBox.cur);
    const ho = buildHeadOv(headBox.def, headBox.cur);
    if (finOv) {
      // 着色打底（族基线之上、部件显式修改之下），与条目调用口同口径
      const legM = { ...finLegChannels(finOv), ...(lo ?? {}) };
      if (Object.keys(legM).length) parts.leg = legM;
      const armM = { ...finCommonChannels(finOv), ...(ao ?? {}) };
      if (Object.keys(armM).length) parts.arm = armM;
      const torsoM = { ...finCommonChannels(finOv), ...(to ?? {}) };
      if (Object.keys(torsoM).length) parts.torso = torsoM;
      const headM = { ...finCommonChannels(finOv), ...(ho ?? {}) };
      if (Object.keys(headM).length) parts.head = headM;
    } else {
      if (lo) parts.leg = lo;
      if (ao) parts.arm = ao;
      if (to) parts.torso = to;
      if (ho) parts.head = ho;
    }
    const propDiff: MechaProportions = {};
    for (const k of ['head', 'torsoW', 'torsoH', 'arm', 'leg', 'legSplit'] as const) if (propBox.cur[k] !== propBox.def[k]) propDiff[k] = propBox.cur[k];
    return {
      chassis: chassisSel === 'tracks' ? 'tracks' : legBox.cur.footType === 'wheel' ? 'wheel' : 'biped',
      jetpack, podMount,
      weapon: weapon === 'none' ? null : weapon,
      weaponCombo: weapon !== 'none' && Object.keys(weaponComboOv).length ? weaponComboOv : undefined,
      podCombo: podMount && podRows !== 3 ? { rows: podRows } : undefined,
      parts: Object.keys(parts).length ? parts : undefined,
      trackLen: chassisSel === 'tracks' && trackLen !== 252 ? trackLen : undefined,
      weaponSize: (weapon !== 'none' || podMount) && (weaponLen !== 1 || weaponThick !== 1) ? { x: weaponLen, y: weaponThick } : undefined,
      proportions: Object.keys(propDiff).length ? propDiff : undefined,
      surface: surfChoice,
    };
  }, [family, scheme, legBox, armBox, torsoBox, headBox, chassisSel, jetpack, podMount, weapon, weaponComboOv, podRows, trackLen, weaponLen, weaponThick, finOv, propBox, surfChoice]);

  const vehicleOpts = useCallback((): MechaVehicleOptions => {
    const vehSchemeDef: MechaSchemeName = hull === 'walker' ? 'olive' : 'slate';
    const hullOv0 = buildHullOv(hullBox.def, hullBox.cur);
    const legOv0 = mobility === 'legs' ? buildLegOv(legBox.def, legBox.cur) : undefined;
    const hullOv = finOv ? { ...finCommonChannels(finOv), ...(hullOv0 ?? {}) } : hullOv0;
    const legOv = finOv && mobility === 'legs' ? { ...finLegChannels(finOv), ...(legOv0 ?? {}) } : legOv0;
    const trackOv = mobility === 'tracks' && trackLen !== 252 ? trackLen : undefined;
    const vehProp: { leg?: number; hullH?: number } = {};
    if (vehPropBox.cur.leg !== vehPropBox.def.leg) vehProp.leg = vehPropBox.cur.leg;
    if (vehPropBox.cur.hullH !== vehPropBox.def.hullH) vehProp.hullH = vehPropBox.cur.hullH;
    const hasProp = Object.keys(vehProp).length > 0;
    const has = scheme !== vehSchemeDef || hullOv || legOv || trackOv !== undefined || hasProp;
    return {
      hull, mobility, turret, surface: surfChoice,
      parts: has ? { scheme: scheme !== vehSchemeDef ? scheme : undefined, hull: hullOv, leg: legOv, trackLen: trackOv, proportions: hasProp ? vehProp : undefined } : undefined,
    };
  }, [hull, mobility, turret, scheme, hullBox, legBox, trackLen, finOv, vehPropBox, surfChoice]);

  const sig = mode === 'humanoid' ? 'h:' + JSON.stringify(buildOpts()) : 'v:' + JSON.stringify(vehicleOpts());
  // 基准高未量得前先按自然尺寸预览，量得后按 输入身高/基准高 缩放
  const scale = baseCal && baseCal.sig === sig ? heightPx / baseCal.h : 1;

  // ---- 模式库套用：条目 def → 向导控件状态（组合递归展开） ----
  const applyGenDef = (def: MechaGenDef) => {
    if (def.finish) setFinishRef(def.finish);
    if (def.surface) setSurfaceRef(def.surface);
    switch (def.gen) {
      case 'leg': case 'arm': case 'torso': case 'head': case 'hand': {
        setMode('humanoid');
        setFamily(def.family);
        if (def.scheme) setScheme(def.scheme);
        const fam = def.family;
        if (def.gen === 'leg') setLegBox({ def: legDefaults(fam), cur: legCtlFromMerged(fam, def.overrides?.leg) });
        if (def.gen === 'arm' || def.gen === 'hand') setArmBox({ def: armDefaults(fam), cur: armCtlFromMerged(fam, def.overrides?.arm) });
        if (def.gen === 'torso') setTorsoBox({ def: torsoDefaults(fam), cur: torsoCtlFromMerged(fam, def.overrides?.torso) });
        if (def.gen === 'head') setHeadBox({ def: headDefaults(fam), cur: headCtlFromMerged(fam, def.overrides?.head) });
        break;
      }
      case 'wheel': {
        setMode('humanoid');
        setFamily(def.family);
        if (def.scheme) setScheme(def.scheme);
        const cur = legCtlFromMerged(def.family, def.overrides?.leg);
        cur.footType = 'wheel';
        setLegBox({ def: legDefaults(def.family), cur });
        setChassisSel('biped');
        break;
      }
      case 'jetpack':
        setMode('humanoid'); setFamily(def.family);
        if (def.scheme) setScheme(def.scheme);
        setJetpack(true);
        break;
      case 'weapon': {
        setMode('humanoid'); setFamily(def.family);
        if (def.scheme) setScheme(def.scheme);
        if (def.weaponKind === 'cannon' || def.weaponKind === 'rifle') setWeapon(def.weaponKind);
        else if (def.weaponKind === 'pod') setPodMount('rear');
        else if (def.weaponKind === 'podPylon') setPodMount('pylon');
        break;
      }
      case 'hull': {
        setMode('vehicle');
        const kind = def.hullKind ?? 'walker';
        setHull(kind);
        if (def.scheme) setScheme(def.scheme);
        setHullBox({ def: hullDefaults(kind), cur: hullCtlFromMerged(kind, def.hullOverrides) });
        break;
      }
      case 'multileg':
        setMode('vehicle'); setMobility(def.profile ?? 'spider');
        if (def.scheme) setScheme(def.scheme);
        break;
      case 'track':
        setMode('vehicle'); setMobility('tracks');
        if (def.scheme) setScheme(def.scheme);
        break;
    }
  };
  const applyEntryById = (id: string) => {
    const entry = libEntries.find((e) => e.id === id);
    if (!entry) return;
    const idx = libraryIndexOf(libEntries);
    const got = mechaDefOf(idx, entry.id, entry.latest);
    if (!got) return;
    guardApply.current = true;
    guardTick.current = renderTick.current;
    const walk = (def: MechaEntryDef, seen: ReadonlySet<string>) => {
      if (def.form === 'gen') { applyGenDef(def); return; }
      for (const part of def.parts) {
        const key = `${part.entry}@${part.version}`;
        if (seen.has(key)) continue;
        const child = mechaDefOf(idx, part.entry, part.version);
        if (!child) continue;
        const childDef = part.ov && child.def.form === 'gen' ? applyComboOv(child.def, part.ov) : child.def;
        walk(childDef, new Set([...seen, key]));
      }
    };
    walk(got.def, new Set([`${entry.id}@${got.version}`]));
    setNote(`已套用条目「${entry.name}」`);
  };

  // ---- 存为条目：当前控件状态 → gen 式 def（部件）/ combo（整机） ----
  const pushUserEntry = (e: LibraryEntry) => {
    setUserEntries((prev) => {
      const next = [...prev, e];
      saveUserEntries(next);
      return next;
    });
  };
  const mkMechaEntry = (entryName: string, def: MechaEntryDef): LibraryEntry => ({
    id: `user-mecha-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e5)}`,
    kind: 'mecha', name: entryName, cluster: '机甲', latest: 1, versions: { 1: def },
  });
  const currentPartDefs = (): { label: string; as: string; def: MechaGenDef }[] => {
    const schemeOv = scheme !== (mode === 'humanoid' ? MECHA_FAMILY_SCHEME[family] : hull === 'walker' ? 'olive' : 'slate') ? scheme : undefined;
    if (mode === 'humanoid') {
      const out: { label: string; as: string; def: MechaGenDef }[] = [];
      const lo = buildLegOv(legBox.def, legBox.cur);
      out.push({ label: '腿', as: 'leg', def: { kind: 'mecha', form: 'gen', gen: 'leg', family, scheme: schemeOv, finish: finishRef, surface: surfaceRef || undefined, overrides: lo ? { leg: lo } : undefined } });
      const ao = buildArmOv(armBox.def, armBox.cur);
      out.push({ label: '臂', as: 'arm', def: { kind: 'mecha', form: 'gen', gen: 'arm', family, scheme: schemeOv, finish: finishRef, surface: surfaceRef || undefined, overrides: ao ? { arm: ao } : undefined } });
      const to = buildTorsoOv(torsoBox.def, torsoBox.cur);
      out.push({ label: '躯干', as: 'torso', def: { kind: 'mecha', form: 'gen', gen: 'torso', family, scheme: schemeOv, finish: finishRef, surface: surfaceRef || undefined, overrides: to ? { torso: to } : undefined } });
      const ho = buildHeadOv(headBox.def, headBox.cur);
      out.push({ label: '头', as: 'head', def: { kind: 'mecha', form: 'gen', gen: 'head', family, scheme: schemeOv, finish: finishRef, surface: surfaceRef || undefined, overrides: ho ? { head: ho } : undefined } });
      return out;
    }
    const mobFam = mechaMobilityFamily(hull);
    const out: { label: string; as: string; def: MechaGenDef }[] = [];
    const huo = buildHullOv(hullBox.def, hullBox.cur);
    out.push({ label: '车体', as: 'hull', def: { kind: 'mecha', form: 'gen', gen: 'hull', family: 'olive', hullKind: hull, scheme: schemeOv, finish: finishRef, surface: surfaceRef || undefined, hullOverrides: huo } });
    if (mobility === 'legs') {
      const lo = buildLegOv(legBox.def, legBox.cur);
      out.push({ label: '步行腿', as: 'legs', def: { kind: 'mecha', form: 'gen', gen: 'leg', family: mobFam, scheme: schemeOv ?? mechaVehicleScheme(hull), finish: finishRef, surface: surfaceRef || undefined, overrides: lo ? { leg: lo } : undefined } });
    } else if (mobility === 'tracks') {
      out.push({ label: '履带', as: 'legs', def: { kind: 'mecha', form: 'gen', gen: 'track', family: mobFam, scheme: schemeOv ?? mechaVehicleScheme(hull), finish: finishRef, surface: surfaceRef || undefined } });
    } else {
      out.push({ label: mobility === 'spider' ? '蜘蛛腿' : '四足腿', as: 'legs', def: { kind: 'mecha', form: 'gen', gen: 'multileg', family: mobFam, profile: mobility, scheme: schemeOv ?? mechaVehicleScheme(hull), finish: finishRef, surface: surfaceRef || undefined } });
    }
    return out;
  };
  const savePartsAsEntries = () => {
    const base = name.trim() || '机甲';
    for (const pd of currentPartDefs()) pushUserEntry(mkMechaEntry(`${base}·${pd.label}`, pd.def));
    setNote('部件已存入模式库（在模式库管理里可见）');
  };
  const saveMachineAsEntry = () => {
    const base = name.trim() || '机甲';
    const parts = currentPartDefs().map((pd) => {
      const e = mkMechaEntry(`${base}·${pd.label}`, pd.def);
      pushUserEntry(e);
      return { entry: e.id, version: 1, as: pd.as };
    });
    pushUserEntry(mkMechaEntry(`${base}·整机`, { kind: 'mecha', form: 'combo', parts }));
    setNote('整机已存入模式库（组合条目 + 各部件条目）');
  };

  const getPartSet = useCallback((fam: MechaFamily, ov?: MechaPartOverrides): MechaPartSet => {
    const key = fam + ':' + JSON.stringify(ov ?? null);
    let ps = partSetCache.current.get(key);
    if (!ps) { ps = generateMechaPartSet(fam, undefined, ov); partSetCache.current.set(key, ps); }
    return ps;
  }, []);

  const gearSprite = useCallback((fam: MechaFamily, part: string, ovSig: string, ctx: { scheme?: MechaSchemeName; leg?: MechaLegOverrides; trackLen?: number; weaponSize?: { x: number; y: number }; finOv?: MechaFinishOv; surf?: SurfaceChoice }): MechaSpriteData | undefined => {
    const key = fam + ':' + part + ':' + ovSig;
    let s = spriteCache.current.get(key);
    if (s) return s;
    if (part === 'wheelThigh' || part === 'wheelShin' || part === 'wheelFoot') {
      const wp = generateMechaWheelLegParts(fam, ctx.leg, ctx.scheme);
      spriteCache.current.set(fam + ':wheelThigh:' + ovSig, wp.thigh);
      spriteCache.current.set(fam + ':wheelShin:' + ovSig, wp.shin);
      spriteCache.current.set(fam + ':wheelFoot:' + ovSig, wp.foot);
      return spriteCache.current.get(key);
    }
    if (part === 'trackUnit') s = generateMechaTrackUnit(fam, { len: ctx.trackLen, scheme: ctx.scheme, ...ctx.finOv });
    else if (part === 'jetpack') s = generateMechaJetpack(fam, ctx.scheme, ctx.finOv);
    else if (part === 'pod') s = generateMechaWeapon(fam, 'pod', ctx.scheme, ctx.weaponSize, ctx.finOv);
    else if (part === 'podPylon') s = generateMechaWeapon(fam, 'podPylon', ctx.scheme, ctx.weaponSize, ctx.finOv);
    else if (part === 'cannon') s = generateMechaWeapon(fam, 'cannon', ctx.scheme, ctx.weaponSize, ctx.finOv);
    else if (part === 'rifle') s = generateMechaWeapon(fam, 'rifle', ctx.scheme, ctx.weaponSize, ctx.finOv);
    else return undefined;
    if (ctx.surf) applySurface(s, ctx.surf);
    spriteCache.current.set(key, s);
    return s;
  }, []);

  const bitmapOf = useCallback((cacheKey: string, s: MechaSpriteData): HTMLCanvasElement => {
    let c = bitmapCache.current.get(cacheKey);
    if (!c) {
      c = document.createElement('canvas');
      c.width = s.width; c.height = s.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(s.rgba), s.width, s.height), 0, 0);
      bitmapCache.current.set(cacheKey, c);
    }
    return c;
  }, []);

  // 预览尺寸随尺寸设置走（画布适应其尺寸）
  const PW = mode === 'humanoid'
    ? Math.max(220, Math.min(660, Math.round(470 * scale)))
    : Math.max(260, Math.min(980, Math.round(800 * scale)));
  const PH = mode === 'humanoid'
    ? Math.max(220, Math.min(1000, Math.round(850 * scale)))
    : Math.max(200, Math.min(820, Math.round(580 * scale)));

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== PW) canvas.width = PW;
    if (canvas.height !== PH) canvas.height = PH;
    ctx.clearRect(0, 0, PW, PH);
    ctx.imageSmoothingEnabled = false;

    let assembly: ReturnType<typeof assembleMechaCharacter>;
    let vehicleTable: Record<string, Sprite> | null = null;
    let nodeParts: Record<string, string>;
    let spriteFor: (part: string) => MechaSpriteData | undefined;
    let spriteKeyFor: (part: string) => string;
    if (mode === 'humanoid') {
      const B = buildOpts();
      const ps = surfacedPartSet(getPartSet(family, B.parts));
      assembly = assembleMechaCharacter({
        characterId: 'preview', family, canvasSize: { w: 1000, h: 1200 },
        partSet: ps, spriteIds: {}, build: B, scale,
      });
      nodeParts = mechaHumanoidNodeParts(B);
      const gearCtx = { scheme: B.parts?.scheme, leg: B.parts?.leg, trackLen: B.trackLen, weaponSize: B.weaponSize, finOv, surf: surfChoice };
      spriteFor = (part) => {
        if (part === 'torso') return ps.torso;
        if (part === 'head') return ps.head;
        if (part === 'armUpper') return ps.armUpper;
        if (part === 'armFore') return ps.armFore;
        if (part === 'armHand') return ps.armHand;
        if (part === 'legThigh') return ps.legThigh;
        if (part === 'legShin') return ps.legShin;
        if (part === 'legFoot') return ps.legFoot;
        return gearSprite(family, part, sig, gearCtx);
      };
      spriteKeyFor = (part) => sig + ':' + part;
    } else {
      const V = vehicleOpts();
      const mobFam = mechaMobilityFamily(V.hull);
      const mps = V.mobility === 'legs' ? surfacedPartSet((() => { const k = sig + ':vehps'; let c = partSetCache.current.get(k); if (!c) { c = generateMechaPartSet(mobFam, undefined, { scheme: V.parts?.scheme ?? mechaVehicleScheme(V.hull), leg: { ...(V.parts?.leg ?? {}), hipBeam: true, wScale: V.parts?.leg?.wScale ?? 0.62 } }, { leg: vehLegMul(V) }); partSetCache.current.set(k, c); } return c; })()) : undefined;
      nodeParts = mechaVehicleNodeParts(V);
      const gearCtx = { scheme: V.parts?.scheme ?? mechaVehicleScheme(V.hull), leg: V.parts?.leg, trackLen: V.parts?.trackLen, finOv, surf: surfChoice };
      spriteFor = (part) => {
        if (part === 'hullBody') return gearSprite2(sig + ':body', () => { const d = generateMechaHullBody(V.hull, V.parts?.hull, V.parts?.scheme); if (surfChoice) applySurface(d, surfChoice); return d; });
        if (part === 'turret') return gearSprite2(sig + ':turret', () => { const d = generateMechaTurret(V.hull, V.parts?.hull, V.parts?.scheme); if (surfChoice) applySurface(d, surfChoice); return d; });
        if (part === 'trackUnit') return gearSprite(mobFam, 'trackUnit', sig, gearCtx);
        if (part === 'hipBeam') return mps?.hipBeam;
        if (part === 'legThigh') return mps?.legThigh;
        if (part === 'legShin') return mps?.legShin;
        if (part === 'legFoot') return mps?.legFoot;
        if (part === 'multiUpper' || part === 'multiMid' || part === 'multiFoot') {
          const mp = gearSprite2(sig + ':multi', () => {
            const p = generateMechaMultiLegParts(mobFam, V.mobility as 'quad' | 'spider', V.parts?.scheme ?? mechaVehicleScheme(V.hull), finOv);
            if (surfChoice) for (const d of Object.values(p)) applySurface(d as MechaSpriteData, surfChoice);
            spriteCache.current.set(sig + ':multiUpper', p.upper);
            spriteCache.current.set(sig + ':multiMid', p.mid);
            spriteCache.current.set(sig + ':multiFoot', p.foot);
            return p.upper;
          });
          return part === 'multiUpper' ? mp : spriteCache.current.get(sig + ':multi' + part.slice(5));
        }
        return undefined;
      };
      spriteKeyFor = (part) => sig + ':' + part;
      // 真渲染精灵表：部件位图 → Sprite 记录（data 网格 + 插头亚像素），
      // 装配带真 spriteIds，预览走与主画布同一渲染器（见下方载具绘制段）
      {
        const table: Record<string, Sprite> = {};
        const ids: Record<string, string> = {};
        for (const part of new Set(Object.values(nodeParts))) {
          const d = spriteFor(part);
          if (!d) continue;
          const id = 'pvw_' + part;
          const grid = rgbaToPixelGrid(d);
          table[id] = { id, name: part, width: d.width, height: d.height, plug: { x: pxToSub(d.plug.x), y: pxToSub(d.plug.y) }, data: grid };
          ids[part] = id;
        }
        vehicleTable = table;
        assembly = assembleMechaVehicle({
          characterId: 'preview', canvasSize: { w: 1000, h: 1200 }, vehicle: V, spriteIds: ids, partSet: mps, scale,
        });
      }
    }

    function gearSprite2(key: string, gen: () => MechaSpriteData): MechaSpriteData {
      let s = spriteCache.current.get(key);
      if (!s) { s = gen(); spriteCache.current.set(key, s); }
      return s;
    }

    if (mode === 'vehicle' && vehicleTable) {
      // 载具预览走产品渲染器（南向）：手拼「按 worldAngle 旋转位图」不是
      // 产品口径——帧语义下会把足底画歪（曾报：足底没贴合地面）。离屏按
      // 模型画布渲染，再以根节点锚点贴回预览画布；总高按离屏内容包围盒量。
      const character = {
        id: 'preview', name: 'preview', nodes: assembly.nodes, rootNodeId: assembly.rootNodeId,
        costumeSets: [assembly.costumeSet], activeCostumeSetId: assembly.costumeSet.id,
      } as unknown as Character;
      const OW = 1000, OH = 2400;
      const off = document.createElement('canvas');
      off.width = OW; off.height = OH;
      const octx = off.getContext('2d');
      if (!octx) return;
      renderCharacterOnionFrameFromCharacter(octx, OW, OH, character, 0, 12, undefined, undefined, vehicleTable, 6);
      if (!baseCal || baseCal.sig !== sig) {
        const img = octx.getImageData(0, 0, OW, OH).data;
        let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
        for (let i = 3; i < img.length; i += 4) {
          if (img[i]! > 0) {
            const px = i / 4, x = px % OW, y = Math.floor(px / OW);
            if (x < mnX) mnX = x; if (x > mxX) mxX = x;
            if (y < mnY) mnY = y; if (y > mxY) mxY = y;
          }
        }
        if (mxY > mnY) {
          vehBBoxRef.current = { sig, x0: mnX, y0: mnY, x1: mxX, y1: mxY };
          setBaseCal({ sig, h: mxY - mnY + 1 });
        }
      }
      // 贴回按内容包围盒整体入框：整车必须完整落在预览画布内。按根
      // 锚点固定落点时，根下方的腿随够达伸长会沉出画布下缘（实测缺省
      // 档位足已贴到最后一行、够达拉满必裁）。包围盒横向居中、纵向底
      // 对齐留 8px；放不下时等比缩小，任何参数下都不裁。
      const bb = vehBBoxRef.current;
      if (bb && bb.sig === sig) {
        const bw = bb.x1 - bb.x0 + 1, bh = bb.y1 - bb.y0 + 1, M = 8;
        const k = Math.min(1, (PW - 2 * M) / bw, (PH - 2 * M) / bh);
        const dw = Math.round(bw * k), dh = Math.round(bh * k);
        const dx = Math.round((PW - dw) / 2), dy = Math.round(PH - M - dh);
        ctx.drawImage(off, bb.x0, bb.y0, bw, bh, dx, dy, dw, dh);
      } else {
        ctx.drawImage(off, Math.round(PW / 2 - OW / 2), Math.round(PH * 0.30 - OH / 2));
      }
      return;
    }

    // 与主画布同一口径：真世界变换 + 投影（深度主序、zIndex 次序）
    const character = {
      id: 'preview', name: 'preview', nodes: assembly.nodes, rootNodeId: assembly.rootNodeId,
      costumeSets: [assembly.costumeSet], activeCostumeSetId: assembly.costumeSet.id,
    } as unknown as Character;
    const wt = computeWorldTransforms(character, 0, PW, PH, 12);
    const rootT = wt.get(assembly.rootNodeId);
    if (!rootT) return;
    const rootProj = projectToView(rootT.worldX, rootT.worldY, rootT.worldZ, 0);
    const anchorX = PW / 2, anchorY = PH * (mode === 'humanoid' ? 0.40 : 0.30);
    const items: { part: string; x: number; y: number; a: number; depth: number; z: number }[] = [];
    for (const n of Object.values(assembly.nodes)) {
      const key = n.id.replace('node_preview_', '');
      const part = nodeParts[key];
      if (!part) continue;
      const t = wt.get(n.id);
      if (!t) continue;
      const proj = projectToView(t.worldX, t.worldY, t.worldZ, 0);
      items.push({
        part,
        x: anchorX + subToPx(proj.canvasX) - subToPx(rootProj.canvasX),
        y: anchorY + subToPx(proj.canvasY) - subToPx(rootProj.canvasY),
        a: t.worldAngle, depth: proj.depth, z: n.zIndex ?? 0,
      });
    }
    items.sort((a, b) => (Math.round(a.depth) - Math.round(b.depth)) || (a.z - b.z));
    // 量整机总高：只在该配置首轮（scale=1）量一次——绘制包围盒高即
    // 基准高；小缩放下亚像素量化误差会被放大，故量得后不再覆写
    if (!baseCal || baseCal.sig !== sig) {
      let mnY = Infinity, mxY = -Infinity;
      for (const it of items) {
        const s = spriteFor(it.part);
        if (!s) continue;
        const a = (it.a * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
        for (const [ox, oy] of [[0, 0], [s.width, 0], [0, s.height], [s.width, s.height]] as const) {
          const lx = (ox - s.plug.x) * scale, ly = (oy - s.plug.y) * scale;
          const ry = it.y + lx * sin + ly * cos;
          if (ry < mnY) mnY = ry;
          if (ry > mxY) mxY = ry;
        }
      }
      if (mxY > mnY) setBaseCal({ sig, h: Math.round((mxY - mnY) / scale) });
    }
    for (const it of items) {
      const s = spriteFor(it.part);
      if (!s) continue;
      const bmp = bitmapOf(spriteKeyFor(it.part) + ':' + it.part, s);
      ctx.save();
      ctx.translate(Math.round(it.x), Math.round(it.y));
      if (it.a) ctx.rotate((it.a * Math.PI) / 180);
      ctx.drawImage(bmp, -s.plug.x * scale, -s.plug.y * scale, s.width * scale, s.height * scale);
      ctx.restore();
    }
  }, [mode, family, buildOpts, vehicleOpts, gearSprite, getPartSet, bitmapOf, PW, PH, scale, sig, baseCal]);

  const redrawRef = useRef(redraw);
  redrawRef.current = redraw;
  useEffect(() => {
    if (!open) return;
    setBusy(true);
    const t = setTimeout(() => {
      // redraw 里任何一处抛错都不能把 busy 钉死（曾报：生成中常驻、
      // 生成按钮永久灰）：错误写进提示区，busy 必须复位。
      // 定时器只挂 open/sig、绘制走 ref——redraw 身份变化不得清掉
      // 待触发的定时器（finOv 曾每渲染换新对象，把定时器活活饿死）。
      try { redrawRef.current(); }
      catch (e) { setNote('预览出错：' + (e as Error).message); }
      finally { setBusy(false); }
    }, 30);
    return () => clearTimeout(t);
  }, [open, sig, PW, PH]);

  const handleCreate = () => {
    const charName = name.trim() || '机甲';
    // 画布适应尺寸：不够大就只扩不缩，扩完再按新画布生成
    const needW = Math.ceil((mode === 'humanoid' ? 640 : Math.max(1040, hullBox.cur.hullW * 3.4)) * scale);
    const needH = Math.ceil((mode === 'humanoid' ? 920 : 780) * scale);
    const st = useProjectStore.getState();
    let grown = '';
    if (st.canvasWidth < needW || st.canvasHeight < needH) {
      const w = Math.max(st.canvasWidth, needW), h = Math.max(st.canvasHeight, needH);
      st.setCanvasSize(w, h);
      grown = `；画布已扩至 ${w}×${h} 适应尺寸`;
    }
    const store = useProjectStore.getState();
    let characterId: string;
    try {
      ({ characterId } = mode === 'humanoid'
        ? createMechaCharacterInStore(store as never, { name: charName, family, build: buildOpts(), scale })
        : createMechaVehicleInStore(store as never, { name: charName, vehicle: vehicleOpts(), scale }));
    } catch (e) {
      setNote('生成出错：' + (e as Error).message);
      return;
    }
    // 激活新角色：画布互斥显示只认当前角色，不激活则生成完看不见
    // （参考装配向导生成后同样有这一步）
    useEditorStore.getState().setActivePuppetSkeletonId(characterId);
    const created = useProjectStore.getState().unifiedCharacters[characterId];
    const nNodes = created ? Object.keys(created.nodes).length : 0;
    const nChains = created?.ikChains?.length ?? 0;
    setNote(`已生成「${charName}」：${nNodes} 个节点${nChains ? `、${nChains} 条 IK 链（默认禁用，在 IK 面板启用）` : ''}${grown}`);
    onClose();
  };

  const numRow = (items: React.ReactNode) => <Row label="参数">{items}</Row>;

  const legSection = (
    <Section title="腿">
      <Row label="足型">
        {([['blocks', '分段厚块'], ['shoe', '整楔鞋'], ['claw', '分趾爪'], ['pad', '宽掌垫'], ['wheel', '轮足']] as const).map(([v, l]) => (
          <Chip key={v} active={legCtl.footType === v} onClick={() => setLeg({ footType: v })}>{l}</Chip>
        ))}
      </Row>
      <Row label="关节">
        <Chip active={legCtl.topology === 'standard'} onClick={() => setLeg({ topology: 'standard' })}>正关节</Chip>
        <Chip active={legCtl.topology === 'reverse'} onClick={() => setLeg({ topology: 'reverse' })}>反关节</Chip>
      </Row>
      {numRow(<>
        <NumCtl label="膝弯°" value={legCtl.bend} min={0} max={45} step={1} onCommit={(v) => setLeg({ bend: v })} />
        <NumCtl label="腿宽×" value={legCtl.wScale} min={0.6} max={1.6} step={0.05} onCommit={(v) => setLeg({ wScale: v })} />
        <NumCtl label="踝移" value={legCtl.ankleShift} min={-20} max={30} step={1} onCommit={(v) => setLeg({ ankleShift: v })} />
      </>)}
      {numRow(<>
        <NumCtl label="膝盖块×" value={legCtl.kneeScale} min={0.4} max={2} step={0.05} onCommit={(v) => setLeg({ kneeScale: v })} />
        <NumCtl label="腓肠×" value={legCtl.calfScale} min={0} max={2} step={0.05} onCommit={(v) => setLeg({ calfScale: v })} />
        <NumCtl label="胫骨凹面×" value={legCtl.shinConcave} min={0} max={1.6} step={0.05} onCommit={(v) => setLeg({ shinConcave: v })} />
      </>)}
      <Adv id="leg" open={advOpen} setOpen={setAdvOpen}>
        {numRow(<>
          <NumCtl label="抬升" value={legCtl.lift} min={0} max={60} step={1} onCommit={(v) => setLeg({ lift: v })} />
          <NumCtl label="内体核×" value={legCtl.coreScale} min={0.6} max={1.5} step={0.05} onCommit={(v) => setLeg({ coreScale: v })} />
          <NumCtl label="细节" value={legCtl.detail} min={0} max={1} step={0.05} onCommit={(v) => setLeg({ detail: v })} />
          <NumCtl label="磨损" value={legCtl.wear} min={0} max={1} step={0.05} onCommit={(v) => setLeg({ wear: v })} />
          <NumCtl label="种子" value={legCtl.seed} min={0} max={999} step={1} onCommit={(v) => setLeg({ seed: v })} />
        </>)}
        <Row label="修饰">
          <Chip active={legCtl.camo} onClick={() => setLeg({ camo: !legCtl.camo })}>迷彩</Chip>
          <Chip active={legCtl.shellMode} onClick={() => setLeg({ shellMode: !legCtl.shellMode })}>壳面</Chip>
          <Chip active={legCtl.frameHeavy} onClick={() => setLeg({ frameHeavy: !legCtl.frameHeavy })}>重框架</Chip>
          <Chip active={legCtl.guardOff} onClick={() => setLeg({ guardOff: !legCtl.guardOff })}>去护板</Chip>
        </Row>
        <Row label="贴纸">
          {([['num', '编号'], ['plate', '铭牌'], ['none', '无']] as const).map(([v, l]) => (
            <Chip key={v} active={legCtl.decalKind === v} onClick={() => setLeg({ decalKind: v })}>{l}</Chip>
          ))}
        </Row>
        <Row label="缆色">
          <input type="color" value={legCtl.cableTint || '#888888'} onChange={(e) => setLeg({ cableTint: e.target.value })}
            className="h-6 w-10 rounded border border-white/10 bg-transparent" />
          {legCtl.cableTint
            ? <button onClick={() => setLeg({ cableTint: '' })} className="text-[11px] text-gray-400 hover:text-gray-200">恢复默认</button>
            : <span className="text-[11px] text-gray-500">默认（随结构色）</span>}
        </Row>
      </Adv>
    </Section>
  );

  const armSection = (
    <Section title="臂">
      <Row label="手型">
        <Chip active={armCtl.hand === 'fist'} onClick={() => setArm({ hand: 'fist' })}>拳</Chip>
        <Chip active={armCtl.hand === 'claw'} onClick={() => setArm({ hand: 'claw' })}>爪</Chip>
      </Row>
      <Row label="肩壳">
        <Chip active={armCtl.formShell === 'box'} onClick={() => setArm({ formShell: 'box' })}>盒壳</Chip>
        <Chip active={armCtl.formShell === 'cap'} onClick={() => setArm({ formShell: 'cap' })}>盖壳</Chip>
      </Row>
      <Row label="肘型">
        {([['disc', '盘肘'], ['ring', '环肘'], ['small', '小肘']] as const).map(([v, l]) => (
          <Chip key={v} active={armCtl.formElbow === v} onClick={() => setArm({ formElbow: v })}>{l}</Chip>
        ))}
      </Row>
      <Row label="前臂">
        {([['plates', '分板'], ['housing', '壳仓'], ['shell', '整壳']] as const).map(([v, l]) => (
          <Chip key={v} active={armCtl.formFore === v} onClick={() => setArm({ formFore: v })}>{l}</Chip>
        ))}
      </Row>
      {numRow(<>
        <NumCtl label="臂粗×" value={armCtl.bulk} min={0.5} max={1.5} step={0.05} onCommit={(v) => setArm({ bulk: v })} />
        <NumCtl label="上臂长" value={armCtl.upperLen} min={60} max={200} step={1} onCommit={(v) => setArm({ upperLen: v })} />
        <NumCtl label="前臂长" value={armCtl.foreLen} min={60} max={200} step={1} onCommit={(v) => setArm({ foreLen: v })} />
        <NumCtl label="指长" value={armCtl.fingerLen} min={10} max={60} step={1} onCommit={(v) => setArm({ fingerLen: v })} />
        <NumCtl label="卷曲" value={armCtl.fingerCurl} min={0} max={1} step={0.05} onCommit={(v) => setArm({ fingerCurl: v })} />
      </>)}
      <Adv id="arm" open={advOpen} setOpen={setAdvOpen}>
        <Row label="块形">
          <NumCtl label="切角下限" value={armCtl.bsCham} min={0} max={0.6} step={0.05} onCommit={(v) => setArm({ bsCham: v })} />
          <NumCtl label="分布下" value={armCtl.bsVarLo} min={0} max={1} step={0.05} onCommit={(v) => setArm({ bsVarLo: v })} />
          <NumCtl label="分布上" value={armCtl.bsVarHi} min={0.5} max={3} step={0.1} onCommit={(v) => setArm({ bsVarHi: v })} />
          <NumCtl label="台阶率" value={armCtl.bsStep} min={0} max={1} step={0.05} onCommit={(v) => setArm({ bsStep: v })} />
        </Row>
        {numRow(<>
          <NumCtl label="壳比×" value={armCtl.shell} min={0.5} max={1.5} step={0.05} onCommit={(v) => setArm({ shell: v })} />
          <NumCtl label="上臂角°" value={armCtl.upperAngDeg} min={-30} max={30} step={1} onCommit={(v) => setArm({ upperAngDeg: v })} />
          <NumCtl label="肘弯°" value={armCtl.elbowBendDeg} min={-60} max={60} step={1} onCommit={(v) => setArm({ elbowBendDeg: v })} />
          <NumCtl label="斜纹" value={armCtl.diag} min={0} max={1} step={0.05} onCommit={(v) => setArm({ diag: v })} />
          <NumCtl label="磨损" value={armCtl.wear} min={0} max={1} step={0.05} onCommit={(v) => setArm({ wear: v })} />
          <NumCtl label="种子" value={armCtl.seed} min={0} max={999} step={1} onCommit={(v) => setArm({ seed: v })} />
        </>)}
        <Row label="附件">
          <Chip active={armCtl.gearCable} onClick={() => setArm({ gearCable: !armCtl.gearCable })}>缆</Chip>
          <Chip active={armCtl.gearPiston} onClick={() => setArm({ gearPiston: !armCtl.gearPiston })}>活塞</Chip>
          <Chip active={armCtl.gearDevice} onClick={() => setArm({ gearDevice: !armCtl.gearDevice })}>装置</Chip>
          <Chip active={armCtl.gearStripe} onClick={() => setArm({ gearStripe: !armCtl.gearStripe })}>条纹</Chip>
          <NumCtl label="徽记" value={armCtl.insKind} min={-1} max={4} step={1} onCommit={(v) => setArm({ insKind: v })} />
          <NumCtl label="徽记沿" value={armCtl.insAlong} min={-60} max={60} step={1} onCommit={(v) => setArm({ insAlong: v })} />
          <NumCtl label="徽记垂" value={armCtl.insPerp} min={-60} max={60} step={1} onCommit={(v) => setArm({ insPerp: v })} />
        </Row>
        <Row label="修饰">
          <Chip active={armCtl.twoTone} onClick={() => setArm({ twoTone: !armCtl.twoTone })}>双色调</Chip>
          <Chip active={armCtl.camo} onClick={() => setArm({ camo: !armCtl.camo })}>迷彩</Chip>
        </Row>
      </Adv>
    </Section>
  );

  const torsoSection = (
    <Section title="躯干">
      <Row label="胸型">
        {Object.keys(MECHA_CHEST_LABELS).map((c) => (
          <Chip key={c} active={torsoCtl.formChest === c} onClick={() => setTorso({ formChest: c })}>{MECHA_CHEST_LABELS[c as keyof typeof MECHA_CHEST_LABELS]}</Chip>
        ))}
      </Row>
      <Row label="背部">
        {([['box', '背箱'], ['binder', '束带'], ['rack', '背架'], ['none', '无']] as const).map(([v, l]) => (
          <Chip key={v} active={torsoCtl.formBack === v} onClick={() => setTorso({ formBack: v })}>{l}</Chip>
        ))}
      </Row>
      <Row label="格栅">
        {([['side', '侧栅'], ['front', '前栅'], ['none', '无']] as const).map(([v, l]) => (
          <Chip key={v} active={torsoCtl.formGrille === v} onClick={() => setTorso({ formGrille: v })}>{l}</Chip>
        ))}
      </Row>
      <Row label="裙甲">
        {([['front', '前裙'], ['both', '双裙'], ['none', '无']] as const).map(([v, l]) => (
          <Chip key={v} active={torsoCtl.formSkirt === v} onClick={() => setTorso({ formSkirt: v })}>{l}</Chip>
        ))}
      </Row>
      {numRow(<>
        <NumCtl label="胸宽" value={torsoCtl.chestW} min={80} max={220} step={1} onCommit={(v) => setTorso({ chestW: v })} />
        <NumCtl label="胸高" value={torsoCtl.chestH} min={60} max={200} step={1} onCommit={(v) => setTorso({ chestH: v })} />
        <NumCtl label="腰高" value={torsoCtl.waistH} min={0} max={80} step={1} onCommit={(v) => setTorso({ waistH: v })} />
        <NumCtl label="口深·横" value={torsoCtl.intakeDx} min={0} max={0.5} step={0.01} onCommit={(v) => setTorso({ intakeDx: v })} />
        <NumCtl label="口深·纵" value={torsoCtl.intakeDy} min={0} max={0.5} step={0.01} onCommit={(v) => setTorso({ intakeDy: v })} />
        <NumCtl label="盒深·沿上边" value={torsoCtl.boxDx} min={0} max={1.5} step={0.01} onCommit={(v) => setTorso({ boxDx: v })} />
        <NumCtl label="盒深·沿左边" value={torsoCtl.boxDy} min={0} max={1.5} step={0.01} onCommit={(v) => setTorso({ boxDy: v })} />
        <NumCtl label="口份额·宽" value={torsoCtl.intakeShareW} min={0.3} max={1} step={0.01} onCommit={(v) => setTorso({ intakeShareW: v })} />
        <NumCtl label="口份额·高" value={torsoCtl.intakeShareH} min={0.3} max={1} step={0.01} onCommit={(v) => setTorso({ intakeShareH: v })} />
        <NumCtl label="胯高" value={torsoCtl.pelvisH} min={30} max={120} step={1} onCommit={(v) => setTorso({ pelvisH: v })} />
      </>)}
      <Row label="进气口模式">
        <Chip active={torsoCtl.intakeOrient === 'keel'} onClick={() => setTorso({ intakeOrient: 'keel' })}>龙骨定向</Chip>
        <Chip active={torsoCtl.intakeOrient === 'flat'} onClick={() => setTorso({ intakeOrient: 'flat' })}>固定框斜</Chip>
        <Chip active={torsoCtl.intakeTrim} onClick={() => setTorso({ intakeTrim: !torsoCtl.intakeTrim })}>附属件</Chip>
      </Row>
      <Row label="龙骨突组合">
        <Chip active={torsoCtl.keelPlate} onClick={() => setTorso({ keelPlate: !torsoCtl.keelPlate })}>龙骨突</Chip>
        <NumCtl label="前伸" value={torsoCtl.keelReach} min={0.1} max={0.6} step={0.01} onCommit={(v) => setTorso({ keelReach: v })} />
        <Chip active={torsoCtl.ventFuse} onClick={() => setTorso({ ventFuse: !torsoCtl.ventFuse })}>前楔并体</Chip>
        <Chip active={torsoCtl.neckStruts} onClick={() => setTorso({ neckStruts: !torsoCtl.neckStruts })}>颈部斜撑管道</Chip>
      </Row>
      <Adv id="torso" open={advOpen} setOpen={setAdvOpen}>
        <Row label="块形">
          <NumCtl label="切角下限" value={torsoCtl.bsCham} min={0} max={0.6} step={0.05} onCommit={(v) => setTorso({ bsCham: v })} />
          <NumCtl label="分布下" value={torsoCtl.bsVarLo} min={0} max={1} step={0.05} onCommit={(v) => setTorso({ bsVarLo: v })} />
          <NumCtl label="分布上" value={torsoCtl.bsVarHi} min={0.5} max={3} step={0.1} onCommit={(v) => setTorso({ bsVarHi: v })} />
          <NumCtl label="台阶率" value={torsoCtl.bsStep} min={0} max={1} step={0.05} onCommit={(v) => setTorso({ bsStep: v })} />
        </Row>
        <Row label="前缘">
          <NumCtl label="顶前" value={torsoCtl.profTop} min={0} max={0.7} step={0.01} onCommit={(v) => setTorso({ profTop: v })} />
          <NumCtl label="折点" value={torsoCtl.profFold} min={0.3} max={0.85} step={0.01} onCommit={(v) => setTorso({ profFold: v })} />
          <NumCtl label="折高" value={torsoCtl.profFoldY} min={0.2} max={0.9} step={0.01} onCommit={(v) => setTorso({ profFoldY: v })} />
          <NumCtl label="底收" value={torsoCtl.profBase} min={0.2} max={0.7} step={0.01} onCommit={(v) => setTorso({ profBase: v })} />
          <NumCtl label="主分" value={torsoCtl.profDivY} min={0.2} max={0.8} step={0.01} onCommit={(v) => setTorso({ profDivY: v })} />
        </Row>
        <Row label="标记">
          <Chip active={torsoCtl.gearStripe} onClick={() => setTorso({ gearStripe: !torsoCtl.gearStripe })}>条纹</Chip>
          <NumCtl label="徽记" value={torsoCtl.gearInsignia} min={0} max={9} step={1} onCommit={(v) => setTorso({ gearInsignia: v })} />
          <NumCtl label="徽记横" value={torsoCtl.insX} min={-0.5} max={1} step={0.01} onCommit={(v) => setTorso({ insX: v })} />
          <NumCtl label="徽记纵" value={torsoCtl.insY} min={0} max={1.1} step={0.01} onCommit={(v) => setTorso({ insY: v })} />
          <label className="flex items-center gap-1 text-[11px] text-gray-400">
            编号
            <Input value={torsoCtl.gearNumber} onChange={(e) => setTorso({ gearNumber: e.target.value })}
              className="h-6 w-20 px-1 text-[11px] bg-[#0d0d1a] border-[#1e1e3a] text-gray-200" />
          </label>
        </Row>
        <Row label="修饰">
          <Chip active={torsoCtl.twoTone} onClick={() => setTorso({ twoTone: !torsoCtl.twoTone })}>双色调</Chip>
          <Chip active={torsoCtl.camo} onClick={() => setTorso({ camo: !torsoCtl.camo })}>迷彩</Chip>
          <NumCtl label="磨损" value={torsoCtl.wear} min={0} max={1} step={0.05} onCommit={(v) => setTorso({ wear: v })} />
          <NumCtl label="种子" value={torsoCtl.seed} min={0} max={999} step={1} onCommit={(v) => setTorso({ seed: v })} />
        </Row>
      </Adv>
    </Section>
  );

  const headSection = (
    <Section title="头">
      <Row label="盔顶">
        {([['dome', '圆顶'], ['flat', '平顶'], ['angular', '棱角']] as const).map(([v, l]) => (
          <Chip key={v} active={headCtl.formCrown === v} onClick={() => setHead({ formCrown: v })}>{l}</Chip>
        ))}
      </Row>
      <Row label="眼型">
        {([['slit', '缝眼'], ['dot', '点眼'], ['visor', '面罩']] as const).map(([v, l]) => (
          <Chip key={v} active={headCtl.formEye === v} onClick={() => setHead({ formEye: v })}>{l}</Chip>
        ))}
      </Row>
      <Row label="颌部">
        {([['block', '颌块'], ['respirator', '呼吸器'], ['breather', '小呼吸器'], ['small', '小颌']] as const).map(([v, l]) => (
          <Chip key={v} active={headCtl.formJaw === v} onClick={() => setHead({ formJaw: v })}>{l}</Chip>
        ))}
      </Row>
      <Row label="耳部">
        {([['disc', '耳盘'], ['grille', '耳栅'], ['plate', '耳板'], ['sensor', '传感器'], ['plateStripe', '板+短划'], ['earcover', '圆耳罩']] as const).map(([v, l]) => (
          <Chip key={v} active={headCtl.formEar === v} onClick={() => setHead({ formEar: v })}>{l}</Chip>
        ))}
      </Row>
      <Row label="顶部">
        {([['horn', '犄角'], ['vfin', 'V翅'], ['antenna', '天线'], ['none', '无']] as const).map(([v, l]) => (
          <Chip key={v} active={headCtl.formTop === v} onClick={() => setHead({ formTop: v })}>{l}</Chip>
        ))}
        <Chip active={headCtl.formBrow} onClick={() => setHead({ formBrow: !headCtl.formBrow })}>眉檐</Chip>
        <Chip active={headCtl.formCheek} onClick={() => setHead({ formCheek: !headCtl.formCheek })}>颊缆</Chip>
      </Row>
      {numRow(<>
        <NumCtl label="头宽" value={headCtl.w} min={60} max={160} step={1} onCommit={(v) => setHead({ w: v })} />
        <NumCtl label="头高" value={headCtl.h} min={60} max={160} step={1} onCommit={(v) => setHead({ h: v })} />
        <NumCtl label="倾角°" value={headCtl.tiltDeg} min={-17} max={17} step={1} onCommit={(v) => setHead({ tiltDeg: v })} />
      </>)}
      <Adv id="head" open={advOpen} setOpen={setAdvOpen}>
        <Row label="块形">
          <NumCtl label="切角下限" value={headCtl.bsCham} min={0} max={0.6} step={0.05} onCommit={(v) => setHead({ bsCham: v })} />
          <NumCtl label="分布下" value={headCtl.bsVarLo} min={0} max={1} step={0.05} onCommit={(v) => setHead({ bsVarLo: v })} />
          <NumCtl label="分布上" value={headCtl.bsVarHi} min={0.5} max={3} step={0.1} onCommit={(v) => setHead({ bsVarHi: v })} />
          <NumCtl label="台阶率" value={headCtl.bsStep} min={0} max={1} step={0.05} onCommit={(v) => setHead({ bsStep: v })} />
        </Row>
        <Row label="修饰">
          <Chip active={headCtl.twoTone} onClick={() => setHead({ twoTone: !headCtl.twoTone })}>双色调</Chip>
          <Chip active={headCtl.camo} onClick={() => setHead({ camo: !headCtl.camo })}>迷彩</Chip>
          <NumCtl label="磨损" value={headCtl.wear} min={0} max={1} step={0.05} onCommit={(v) => setHead({ wear: v })} />
          <NumCtl label="种子" value={headCtl.seed} min={0} max={999} step={1} onCommit={(v) => setHead({ seed: v })} />
        </Row>
      </Adv>
    </Section>
  );

  const hullSection = (
    <Section title="车体参数">
      <Row label="舱位">
        <Chip active={hullCtl.formCabin === 'front'} onClick={() => setHullCtl({ formCabin: 'front' })}>前舱</Chip>
        <Chip active={hullCtl.formCabin === 'mid'} onClick={() => setHullCtl({ formCabin: 'mid' })}>中舱</Chip>
        <Chip active={hullCtl.formSkirt} onClick={() => setHullCtl({ formSkirt: !hullCtl.formSkirt })}>裙带</Chip>
        <Chip active={hullCtl.sagCables} onClick={() => setHullCtl({ sagCables: !hullCtl.sagCables })}>腹下线束</Chip>
        <Chip active={hullCtl.sidePod} onClick={() => setHullCtl({ sidePod: !hullCtl.sidePod })}>侧挂设备舱</Chip>
      </Row>
      {numRow(<>
        <NumCtl label="车宽" value={hullCtl.hullW} min={150} max={400} step={1} onCommit={(v) => setHullCtl({ hullW: v })} />
        <NumCtl label="车高" value={hullCtl.hullH} min={70} max={220} step={1} onCommit={(v) => setHullCtl({ hullH: v })} />
        <NumCtl label="模块数" value={hullCtl.formModules} min={0} max={5} step={1} onCommit={(v) => setHullCtl({ formModules: v })} />
      </>)}
      <Adv id="hull" open={advOpen} setOpen={setAdvOpen}>
        <Row label="块形">
          <NumCtl label="切角下限" value={hullCtl.bsCham} min={0} max={0.6} step={0.05} onCommit={(v) => setHullCtl({ bsCham: v })} />
          <NumCtl label="分布下" value={hullCtl.bsVarLo} min={0} max={1} step={0.05} onCommit={(v) => setHullCtl({ bsVarLo: v })} />
          <NumCtl label="分布上" value={hullCtl.bsVarHi} min={0.5} max={3} step={0.1} onCommit={(v) => setHullCtl({ bsVarHi: v })} />
          <NumCtl label="台阶率" value={hullCtl.bsStep} min={0} max={1} step={0.05} onCommit={(v) => setHullCtl({ bsStep: v })} />
        </Row>
        <Row label="标记">
          <NumCtl label="徽记" value={hullCtl.gearInsignia} min={0} max={9} step={1} onCommit={(v) => setHullCtl({ gearInsignia: v })} />
          <NumCtl label="徽记横" value={hullCtl.insX} min={-0.6} max={1} step={0.01} onCommit={(v) => setHullCtl({ insX: v })} />
          <NumCtl label="徽记纵" value={hullCtl.insY} min={0} max={1.1} step={0.01} onCommit={(v) => setHullCtl({ insY: v })} />
          <label className="flex items-center gap-1 text-[11px] text-gray-400">
            编号
            <Input value={hullCtl.gearNumber} onChange={(e) => setHullCtl({ gearNumber: e.target.value })}
              className="h-6 w-20 px-1 text-[11px] bg-[#0d0d1a] border-[#1e1e3a] text-gray-200" />
          </label>
        </Row>
        <Row label="修饰">
          <Chip active={hullCtl.twoTone} onClick={() => setHullCtl({ twoTone: !hullCtl.twoTone })}>双色调</Chip>
          <Chip active={hullCtl.camo} onClick={() => setHullCtl({ camo: !hullCtl.camo })}>迷彩</Chip>
          <NumCtl label="磨损" value={hullCtl.wear} min={0} max={1} step={0.05} onCommit={(v) => setHullCtl({ wear: v })} />
          <NumCtl label="种子" value={hullCtl.seed} min={0} max={999} step={1} onCommit={(v) => setHullCtl({ seed: v })} />
        </Row>
      </Adv>
    </Section>
  );

  const trackLenRow = (
    <Row label="履带">
      <NumCtl label="履带长" value={trackLen} min={150} max={400} step={1} onCommit={setTrackLen} />
    </Row>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={`max-h-[calc(100dvh-1.5rem)] overflow-y-auto bg-[#12122a] border-white/10 text-gray-200 ${mode === 'vehicle' ? 'max-w-[860px]' : 'max-w-[640px]'}`}>
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Bot className="size-4 text-cyan-300" /> 机甲生成
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-gray-400 shrink-0">角色名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="输入名称..."
              className="h-8 text-sm bg-[#0d0d1a] border-[#1e1e3a] text-gray-200" />
          </div>
          <Row label="类型">
            <Chip active={mode === 'humanoid'} onClick={() => setMode('humanoid')}>人形机甲</Chip>
            <Chip active={mode === 'vehicle'} onClick={() => setMode('vehicle')}>载具</Chip>
          </Row>
          <Row label="身高">
            <Input type="number" min={32} max={512} step={1} value={heightText}
              onChange={(e) => {
                setHeightText(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value !== '' && Number.isFinite(n)) setHeightPx(Math.max(32, Math.min(512, Math.round(n))));
              }}
              onBlur={() => setHeightText(String(heightPx))}
              className="h-7 w-20 text-[12px] bg-[#0d0d1a] border-[#1e1e3a] text-gray-200" />
            <span className="text-[11px] text-gray-300">px</span>
            <span className="text-[11px] text-gray-500">整机总高 32–512，预览与生成画布随之适应</span>
          </Row>
          <Row label="整机比例">
            {mode === 'humanoid' ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <NumCtl label="头部" value={propBox.cur.head} min={0.6} max={1.5} step={0.02} onCommit={(v) => setProp({ head: v })} />
                <NumCtl label="躯干宽" value={propBox.cur.torsoW} min={0.6} max={1.5} step={0.02} onCommit={(v) => setProp({ torsoW: v })} />
                <NumCtl label="躯干高" value={propBox.cur.torsoH} min={0.6} max={1.5} step={0.02} onCommit={(v) => setProp({ torsoH: v })} />
                <NumCtl label="臂长" value={propBox.cur.arm} min={0.6} max={1.5} step={0.02} onCommit={(v) => setProp({ arm: v })} />
                <NumCtl label="腿长" value={propBox.cur.leg} min={0.6} max={1.5} step={0.02} onCommit={(v) => setProp({ leg: v })} />
                <NumCtl label="小腿占比" value={propBox.cur.legSplit} min={0.35} max={0.7} step={0.01} onCommit={(v) => setProp({ legSplit: v })} />
                <span className="text-[11px] text-gray-500">部位间比例倍率，默认已按参考图实测占比定</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <NumCtl label="腿长" value={vehPropBox.cur.leg} min={0.5} max={1.4} step={0.02} onCommit={(v) => setVehProp({ leg: v })} />
                <NumCtl label="车高" value={vehPropBox.cur.hullH} min={0.6} max={1.6} step={0.02} onCommit={(v) => setVehProp({ hullH: v })} />
                <span className="text-[11px] text-gray-500">车体与腿的相对比例，默认已按参考图实测占比定</span>
              </div>
            )}
          </Row>
          <Row label="配色">
            {(Object.keys(MECHA_SCHEME_LABELS) as MechaSchemeName[]).map((s) => (
              <Chip key={s} active={scheme === s} onClick={() => setScheme(s)}>{MECHA_SCHEME_LABELS[s]}</Chip>
            ))}
          </Row>
          <Row label="模式库">
            <select value="" onChange={(e) => { if (e.target.value) applyEntryById(e.target.value); }}
              className="h-7 max-w-[220px] text-[12px] bg-[#0d0d1a] border border-[#1e1e3a] rounded text-gray-200 px-1">
              <option value="">套用条目…</option>
              {libEntries.filter((e) => e.kind === 'mecha').map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.builtin ? '' : '（我的）'}</option>
              ))}
            </select>
            <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2" onClick={savePartsAsEntries}>存部件为条目</Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2" onClick={saveMachineAsEntry}>存为整机条目</Button>
          </Row>
          <Row label="着色">
            <select value={finishRef} onChange={(e) => setFinishRef(e.target.value)}
              className="h-7 max-w-[220px] text-[12px] bg-[#0d0d1a] border border-[#1e1e3a] rounded text-gray-200 px-1">
              {(() => {
                const opts = finishEntriesOf(libEntries)
                  .map((e) => ({ v: `${e.id}@${e.latest}`, n: e.name }));
                if (!opts.some((o) => o.v === finishRef)) opts.unshift({ v: finishRef, n: finishRef });
                return opts.map((o) => <option key={o.v} value={o.v}>{o.n}</option>);
              })()}
            </select>
            <span className="text-[11px] text-gray-500">着色是独立一层：算子组合成套，整机共用一套</span>
          </Row>
          {mode === 'humanoid' ? (
            <>
              <Row label="族">
                {MECHA_FAMILIES.map((f) => (
                  <Chip key={f.id} active={family === f.id} onClick={() => setFamily(f.id)}>{f.name}</Chip>
                ))}
              </Row>
              <Row label="底盘">
                <Chip active={chassisSel === 'biped'} onClick={() => setChassisSel('biped')}>双足</Chip>
                <Chip active={chassisSel === 'tracks'} onClick={() => setChassisSel('tracks')}>履带</Chip>
                {chassisSel === 'biped' && legCtl.footType === 'wheel' && <span className="text-[11px] text-gray-500">足型选了轮足，底盘即轮足</span>}
              </Row>
              <Row label="装备">
                <Chip active={jetpack} onClick={() => setJetpack(!jetpack)}>喷射背包</Chip>
              </Row>
              {(['hot', 'scifi', 'cold'] as WeaponClass[]).map((cls) => (
                <Row key={cls} label={cls === 'hot' ? '武器·热' : cls === 'scifi' ? '武器·科幻' : '武器·冷'}>
                  {Object.entries(WEAPON_PRESETS).filter(([, p]) => p.combo.cls === cls && p.mount !== 'pod').map(([id, p]) => (
                    <Chip key={id} active={weapon === id} onClick={() => pickWeapon(id)}>{p.label}</Chip>
                  ))}
                </Row>
              ))}
              {weapon !== 'none' && (() => {
                const eff: WeaponCombo = { ...WEAPON_PRESETS[weapon]!.combo, ...weaponComboOv };
                const axisSel = (axis: 'body' | 'effector' | 'feed' | 'sight' | 'grip', label: string) => (
                  <label key={axis} className="flex items-center gap-1 text-[11px] text-gray-400">
                    {label}
                    <select value={eff[axis]} onChange={(e) => setWeaponComboOv((o) => ({ ...o, [axis]: e.target.value }))}
                      className="h-6 text-[11px] bg-[#0d0d1a] border border-[#1e1e3a] rounded text-gray-200 px-1">
                      {WEAPON_AXIS_OPTIONS[axis][eff.cls].map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
                    </select>
                  </label>
                );
                const tog = (key: 'ring' | 'rail' | 'cable' | 'lamp' | 'glow', label: string) => (
                  <Chip key={key} active={!!eff[key]} onClick={() => setWeaponComboOv((o) => ({ ...o, [key]: !eff[key] }))}>{label}</Chip>
                );
                return (
                  <>
                    <Row label="武器部件">
                      {axisSel('body', '主体')}
                      {axisSel('effector', '作用段')}
                      {axisSel('feed', '供能')}
                      {axisSel('sight', '瞄具')}
                      {axisSel('grip', '握持')}
                    </Row>
                    <Row label="武器附属">
                      {tog('ring', '色环')}
                      {tog('rail', '导轨')}
                      {tog('cable', '缆')}
                      {tog('lamp', '光点')}
                      {tog('glow', '发光')}
                      <NumCtl label="段长" value={eff.len ?? 110} min={30} max={220} step={2} onCommit={(v) => setWeaponComboOv((o) => ({ ...o, len: v }))} />
                      <NumCtl label="口径×" value={eff.bore ?? 1} min={0.6} max={1.8} step={0.05} onCommit={(v) => setWeaponComboOv((o) => ({ ...o, bore: v }))} />
                    </Row>
                  </>
                );
              })()}
              <Row label="导弹荚">
                <Chip active={podMount === null} onClick={() => setPodMount(null)}>无</Chip>
                {(Object.keys(MECHA_POD_MOUNT_LABELS) as MechaPodMount[]).map((m) => (
                  <Chip key={m} active={podMount === m} onClick={() => setPodMount(m)}>{MECHA_POD_MOUNT_LABELS[m]}</Chip>
                ))}
                {podMount && <NumCtl label="弹列" value={podRows} min={1} max={6} step={1} onCommit={setPodRows} />}
              </Row>
              {(weapon !== 'none' || podMount) && numRow(<>
                <NumCtl label="武器长×" value={weaponLen} min={0.5} max={2} step={0.05} onCommit={setWeaponLen} />
                <NumCtl label="武器粗×" value={weaponThick} min={0.5} max={2} step={0.05} onCommit={setWeaponThick} />
                <span className="text-[11px] text-gray-500">全部武器通用</span>
              </>)}
              <Row label="表面材质">
                <Chip active={surfaceRef === ''} onClick={() => setSurfaceRef('')}>无</Chip>
                {SURFACE_CHIPS.map((c) => (
                  <Chip key={c.ref} active={surfaceRef === c.ref} onClick={() => setSurfaceRef(c.ref)}>{c.label}</Chip>
                ))}
                <span className="text-[11px] text-gray-500">全部部件</span>
              </Row>
              {chassisSel === 'tracks' ? trackLenRow : legSection}
              {armSection}
              {torsoSection}
              {headSection}
              <p className="text-[11px] text-gray-400">
                族只是预设：配色与每个部件的型式、参数都能单独改（细节/磨损/种子在各部件「高级」里），没改的与族预设一致。臂与腿都是三段节点链，每条链预置一条 IK 链（默认禁用，在 IK 面板启用即可拖目标）；底盘与装备也是独立节点。精灵为侧面东向，西向自动镜像。
              </p>
            </>
          ) : (
            <>
              <Row label="车体">
                {(Object.keys(MECHA_VEHICLE_LABELS.hull) as MechaVehicleOptions['hull'][]).map((h) => (
                  <Chip key={h} active={hull === h} onClick={() => setHull(h)}>{MECHA_VEHICLE_LABELS.hull[h]}</Chip>
                ))}
              </Row>
              <Row label="表面材质">
                <Chip active={surfaceRef === ''} onClick={() => setSurfaceRef('')}>无</Chip>
                {SURFACE_CHIPS.map((c) => (
                  <Chip key={c.ref} active={surfaceRef === c.ref} onClick={() => setSurfaceRef(c.ref)}>{c.label}</Chip>
                ))}
                <span className="text-[11px] text-gray-500">全部部件</span>
              </Row>
              <Row label="机动">
                {(Object.keys(MECHA_VEHICLE_LABELS.mobility) as MechaVehicleOptions['mobility'][]).map((m) => (
                  <Chip key={m} active={mobility === m} onClick={() => setMobility(m)}>{MECHA_VEHICLE_LABELS.mobility[m]}</Chip>
                ))}
              </Row>
              <Row label="上装">
                <Chip active={!turret} onClick={() => setTurret(false)}>无</Chip>
                <Chip active={turret && hullCtl.formTurret === 'gun'} onClick={() => { setTurret(true); setHullCtl({ formTurret: 'gun' }); }}>炮塔</Chip>
                <Chip active={turret && hullCtl.formTurret === 'rack'} onClick={() => { setTurret(true); setHullCtl({ formTurret: 'rack' }); }}>顶架</Chip>
              </Row>
              {hullSection}
              {mobility === 'legs' ? legSection : mobility === 'tracks' ? trackLenRow : null}
              {mobility === 'legs' && (
                <Row label="支架腿组">
                  <NumCtl label="张开" value={legCtl.standSplay} min={0} max={0.4} step={0.01} onCommit={(v) => setLeg({ standSplay: v })} />
                  <NumCtl label="够达" value={legCtl.standReach} min={0.7} max={0.98} step={0.01} onCommit={(v) => setLeg({ standReach: v })} />
                </Row>
              )}
              <p className="text-[11px] text-gray-400">
                车体为根节点：步行腿同人形三段链带 IK（腿的型式与参数在下方「腿」里调）；蜘蛛/四足腿是两段节点（髋 + 膝下段）可摆；履带与炮塔是独立节点。改车高时移动件挂点按比例跟随。
              </p>
            </>
          )}
          <div className="relative mx-auto w-fit">
            <canvas ref={canvasRef} width={PW} height={PH}
              className="block rounded border border-white/10 bg-[#0a0a16]"
              style={{ height: mode === 'humanoid' ? 'min(430px, calc(100dvh - 400px))' : 'min(400px, calc(100dvh - 400px))', width: 'auto', maxWidth: '100%', aspectRatio: `${PW}/${PH}` }} />
            {busy && <div className="absolute inset-0 flex items-center justify-center text-xs text-cyan-300">生成中…</div>}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1" />
            <Button size="sm" className="h-7 text-[11px]" disabled={busy || !name.trim()} onClick={handleCreate}>
              生成角色
            </Button>
          </div>
          {note && <p className="text-[11px] text-emerald-300">{note}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
