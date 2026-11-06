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
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useProjectStore } from '@/lib/store';
import { projectToView, subToPx } from '@/lib/unified-types';
import type { Character } from '@/lib/unified-types';
import { computeWorldTransforms } from '@/lib/unified-render';
import {
  generateMechaPartSet, generateMechaWheelLegParts, generateMechaMultiLegParts, generateMechaTrackUnit,
  generateMechaJetpack, generateMechaWeapon, generateMechaHullBody, generateMechaTurret,
  MECHA_FAMILIES, MECHA_CHEST_LABELS, MECHA_SCHEME_LABELS, MECHA_FAMILY_SCHEME,
  mechaLegSpecOf, mechaArmSpecOf, mechaTorsoSpecOf, mechaHeadSpecOf, mechaHullSpecOf,
} from '@/lib/mecha/parts';
import type {
  MechaFamily, MechaPartSet, MechaSpriteData, MechaSchemeName, MechaPartOverrides,
  MechaLegOverrides, MechaArmOverrides, MechaTorsoOverrides, MechaHeadOverrides, MechaHullOverrides,
} from '@/lib/mecha/parts';
import type { LegSpec, ArmSpec, TorsoSpec, HeadSpec, HullSpec } from '@/lib/mecha/engine';
import {
  assembleMechaCharacter, assembleMechaVehicle, createMechaCharacterInStore, createMechaVehicleInStore,
  mechaHumanoidNodeParts, mechaVehicleNodeParts, mechaMobilityFamily,
  MECHA_VEHICLE_LABELS, MECHA_POD_MOUNT_LABELS,
} from '@/lib/mecha/build-character';
import type { MechaBuildOptions, MechaVehicleOptions, MechaPodMount } from '@/lib/mecha/build-character';

type Mode = 'humanoid' | 'vehicle';
type WeaponSel = 'none' | 'cannon' | 'rifle';

const DEG = 180 / Math.PI;
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
}
interface ArmCtl {
  hand: string; bulk: number; shell: number; upperLen: number; foreLen: number;
  upperAngDeg: number; elbowBendDeg: number; diag: number;
  formShell: string; formElbow: string; formFore: string; fingerLen: number; fingerCurl: number;
  gearCable: boolean; gearPiston: boolean; gearDevice: boolean; gearStripe: boolean;
  twoTone: boolean; wear: number; camo: boolean; seed: number;
}
interface TorsoCtl {
  chestW: number; chestH: number; waistH: number; pelvisH: number;
  formChest: string; formBack: string; formGrille: string; formSkirt: string;
  gearStripe: boolean; gearInsignia: number; gearNumber: string;
  twoTone: boolean; wear: number; camo: boolean; seed: number;
}
interface HeadCtl {
  w: number; h: number; tiltDeg: number;
  formCrown: string; formEye: string; formBrow: boolean; formJaw: string; formEar: string; formTop: string; formCheek: boolean;
  twoTone: boolean; wear: number; camo: boolean; seed: number;
}
interface HullCtl {
  hullW: number; hullH: number; formTurret: string; formCabin: string; formSkirt: boolean; formModules: number;
  gearInsignia: number; gearNumber: string; twoTone: boolean; wear: number; camo: boolean; seed: number;
}

function legDefaults(f: MechaFamily): LegCtl {
  const s = mechaLegSpecOf(f);
  return {
    footType: s.footType ?? 'blocks', topology: s.topology, bend: s.bend,
    wScale: s.wScale ?? 1, ankleShift: s.ankleShift ?? 10, lift: s.lift ?? 0,
    coreScale: s.coreScale ?? 1, detail: s.detail ?? 0.65, wear: s.wear ?? 0.3,
    camo: s.camo, shellMode: s.shellMode ?? false, frameHeavy: s.frameHeavy ?? false,
    guardOff: s.guardOff ?? false, decalKind: s.decalKind ?? 'num',
    cableTint: s.cableTint ? rgbToHex(s.cableTint) : '', seed: s.seed,
    kneeScale: s.kneeScale ?? 1, calfScale: s.calfScale ?? 1, shinConcave: s.shinConcave ?? 1,
  };
}
function armDefaults(f: MechaFamily): ArmCtl {
  const s = mechaArmSpecOf(f);
  return {
    hand: s.hand, bulk: s.bulk, shell: s.shell, upperLen: s.upperLen, foreLen: s.foreLen,
    upperAngDeg: r1(s.upperAng * DEG), elbowBendDeg: r1(s.elbowBend * DEG), diag: s.diag,
    formShell: s.form.shell, formElbow: s.form.elbow, formFore: s.form.fore,
    fingerLen: s.form.fingerLen, fingerCurl: s.form.fingerCurl,
    gearCable: s.gear.cable, gearPiston: s.gear.piston, gearDevice: s.gear.device, gearStripe: s.gear.stripe,
    twoTone: s.twoTone, wear: s.wear, camo: s.camo, seed: s.seed,
  };
}
function torsoDefaults(f: MechaFamily): TorsoCtl {
  const s = mechaTorsoSpecOf(f);
  return {
    chestW: s.chestW, chestH: s.chestH, waistH: s.waistH, pelvisH: s.pelvisH,
    formChest: s.form.chest, formBack: s.form.back, formGrille: s.form.grille, formSkirt: s.form.skirt,
    gearStripe: s.gear.stripe, gearInsignia: s.gear.insignia, gearNumber: s.gear.number,
    twoTone: s.twoTone, wear: s.wear, camo: s.camo, seed: s.seed,
  };
}
function headDefaults(f: MechaFamily): HeadCtl {
  const s = mechaHeadSpecOf(f);
  return {
    w: s.w, h: s.h, tiltDeg: r1(s.tilt * DEG),
    formCrown: s.form.crown, formEye: s.form.eye, formBrow: s.form.brow, formJaw: s.form.jaw,
    formEar: s.form.ear, formTop: s.form.top, formCheek: s.form.cheekCable,
    twoTone: s.twoTone, wear: s.wear, camo: s.camo, seed: s.seed,
  };
}
function hullDefaults(kind: 'walker' | 'hauler'): HullCtl {
  const s = mechaHullSpecOf(kind);
  return {
    hullW: s.hullW, hullH: s.hullH, formTurret: s.form.turret, formCabin: s.form.cabin,
    formSkirt: s.form.skirt, formModules: s.form.modules,
    gearInsignia: s.gear.insignia, gearNumber: s.gear.number,
    twoTone: s.twoTone, wear: s.wear, camo: s.camo, seed: s.seed,
  };
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
  if (cur.twoTone !== def.twoTone) ov.twoTone = cur.twoTone;
  if (cur.wear !== def.wear) ov.wear = cur.wear;
  if (cur.camo !== def.camo) ov.camo = cur.camo;
  if (cur.seed !== def.seed) ov.seed = cur.seed;
  return Object.keys(ov).length ? ov : undefined;
}
function buildTorsoOv(def: TorsoCtl, cur: TorsoCtl): MechaTorsoOverrides | undefined {
  const ov: MechaTorsoOverrides = {};
  if (cur.chestW !== def.chestW) ov.chestW = cur.chestW;
  if (cur.chestH !== def.chestH) ov.chestH = cur.chestH;
  if (cur.waistH !== def.waistH) ov.waistH = cur.waistH;
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
  if (cur.twoTone !== def.twoTone) ov.twoTone = cur.twoTone;
  if (cur.wear !== def.wear) ov.wear = cur.wear;
  if (cur.camo !== def.camo) ov.camo = cur.camo;
  if (cur.seed !== def.seed) ov.seed = cur.seed;
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
  if (cur.twoTone !== def.twoTone) ov.twoTone = cur.twoTone;
  if (cur.wear !== def.wear) ov.wear = cur.wear;
  if (cur.camo !== def.camo) ov.camo = cur.camo;
  if (cur.seed !== def.seed) ov.seed = cur.seed;
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
  const [hull, setHull] = useState<MechaVehicleOptions['hull']>('walker');
  const [mobility, setMobility] = useState<MechaVehicleOptions['mobility']>('legs');
  const [turret, setTurret] = useState(true);
  const [heightPx, setHeightPx] = useState(512);
  const [heightText, setHeightText] = useState('512');
  // 当前配置在 scale=1 时的实测总高（预览装配量得，按配置签名缓存）
  const [baseCal, setBaseCal] = useState<{ sig: string; h: number } | null>(null);
  const [name, setName] = useState('机甲-01');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [scheme, setScheme] = useState<MechaSchemeName>('olive');
  const [trackLen, setTrackLen] = useState(252);
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
  const legCtl = legBox.cur, armCtl = armBox.cur, torsoCtl = torsoBox.cur, headCtl = headBox.cur, hullCtl = hullBox.cur;
  const setLeg = (patch: Partial<LegCtl>) => setLegBox((b) => ({ def: b.def, cur: { ...b.cur, ...patch } }));
  const setArm = (patch: Partial<ArmCtl>) => setArmBox((b) => ({ def: b.def, cur: { ...b.cur, ...patch } }));
  const setTorso = (patch: Partial<TorsoCtl>) => setTorsoBox((b) => ({ def: b.def, cur: { ...b.cur, ...patch } }));
  const setHead = (patch: Partial<HeadCtl>) => setHeadBox((b) => ({ def: b.def, cur: { ...b.cur, ...patch } }));
  const setHullCtl = (patch: Partial<HullCtl>) => setHullBox((b) => ({ def: b.def, cur: { ...b.cur, ...patch } }));

  // 切模式/族/车型/机动时，相关控件回到对应预设
  useEffect(() => {
    if (mode === 'humanoid') {
      setScheme(MECHA_FAMILY_SCHEME[family]);
      const l = legDefaults(family); setLegBox({ def: l, cur: { ...l } });
      const a = armDefaults(family); setArmBox({ def: a, cur: { ...a } });
      const t = torsoDefaults(family); setTorsoBox({ def: t, cur: { ...t } });
      const h = headDefaults(family); setHeadBox({ def: h, cur: { ...h } });
    } else {
      const hc = hullDefaults(hull); setHullBox({ def: hc, cur: { ...hc } });
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
    const lo = buildLegOv(legBox.def, legBox.cur); if (lo) parts.leg = lo;
    const ao = buildArmOv(armBox.def, armBox.cur); if (ao) parts.arm = ao;
    const to = buildTorsoOv(torsoBox.def, torsoBox.cur); if (to) parts.torso = to;
    const ho = buildHeadOv(headBox.def, headBox.cur); if (ho) parts.head = ho;
    return {
      chassis: chassisSel === 'tracks' ? 'tracks' : legBox.cur.footType === 'wheel' ? 'wheel' : 'biped',
      jetpack, podMount,
      weapon: weapon === 'none' ? null : weapon,
      parts: Object.keys(parts).length ? parts : undefined,
      trackLen: chassisSel === 'tracks' && trackLen !== 252 ? trackLen : undefined,
      weaponSize: (weapon !== 'none' || podMount) && (weaponLen !== 1 || weaponThick !== 1) ? { x: weaponLen, y: weaponThick } : undefined,
    };
  }, [family, scheme, legBox, armBox, torsoBox, headBox, chassisSel, jetpack, podMount, weapon, trackLen, weaponLen, weaponThick]);

  const vehicleOpts = useCallback((): MechaVehicleOptions => {
    const vehSchemeDef: MechaSchemeName = hull === 'walker' ? 'olive' : 'slate';
    const hullOv = buildHullOv(hullBox.def, hullBox.cur);
    const legOv = mobility === 'legs' ? buildLegOv(legBox.def, legBox.cur) : undefined;
    const trackOv = mobility === 'tracks' && trackLen !== 252 ? trackLen : undefined;
    const has = scheme !== vehSchemeDef || hullOv || legOv || trackOv !== undefined;
    return {
      hull, mobility, turret,
      parts: has ? { scheme: scheme !== vehSchemeDef ? scheme : undefined, hull: hullOv, leg: legOv, trackLen: trackOv } : undefined,
    };
  }, [hull, mobility, turret, scheme, hullBox, legBox, trackLen]);

  const sig = mode === 'humanoid' ? 'h:' + JSON.stringify(buildOpts()) : 'v:' + JSON.stringify(vehicleOpts());
  // 基准高未量得前先按自然尺寸预览，量得后按 输入身高/基准高 缩放
  const scale = baseCal && baseCal.sig === sig ? heightPx / baseCal.h : 1;

  const getPartSet = useCallback((fam: MechaFamily, ov?: MechaPartOverrides): MechaPartSet => {
    const key = fam + ':' + JSON.stringify(ov ?? null);
    let ps = partSetCache.current.get(key);
    if (!ps) { ps = generateMechaPartSet(fam, undefined, ov); partSetCache.current.set(key, ps); }
    return ps;
  }, []);

  const gearSprite = useCallback((fam: MechaFamily, part: string, ovSig: string, ctx: { scheme?: MechaSchemeName; leg?: MechaLegOverrides; trackLen?: number; weaponSize?: { x: number; y: number } }): MechaSpriteData | undefined => {
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
    if (part === 'trackUnit') s = generateMechaTrackUnit(fam, { len: ctx.trackLen, scheme: ctx.scheme });
    else if (part === 'jetpack') s = generateMechaJetpack(fam, ctx.scheme);
    else if (part === 'pod') s = generateMechaWeapon(fam, 'pod', ctx.scheme, ctx.weaponSize);
    else if (part === 'podPylon') s = generateMechaWeapon(fam, 'podPylon', ctx.scheme, ctx.weaponSize);
    else if (part === 'cannon') s = generateMechaWeapon(fam, 'cannon', ctx.scheme, ctx.weaponSize);
    else if (part === 'rifle') s = generateMechaWeapon(fam, 'rifle', ctx.scheme, ctx.weaponSize);
    else return undefined;
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
    let nodeParts: Record<string, string>;
    let spriteFor: (part: string) => MechaSpriteData | undefined;
    let spriteKeyFor: (part: string) => string;
    if (mode === 'humanoid') {
      const B = buildOpts();
      const ps = getPartSet(family, B.parts);
      assembly = assembleMechaCharacter({
        characterId: 'preview', family, canvasSize: { w: 1000, h: 1200 },
        partSet: ps, spriteIds: {}, build: B, scale,
      });
      nodeParts = mechaHumanoidNodeParts(B);
      const gearCtx = { scheme: B.parts?.scheme, leg: B.parts?.leg, trackLen: B.trackLen, weaponSize: B.weaponSize };
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
      const mps = V.mobility === 'legs' ? getPartSet(mobFam, { scheme: V.parts?.scheme, leg: V.parts?.leg }) : undefined;
      assembly = assembleMechaVehicle({
        characterId: 'preview', canvasSize: { w: 1000, h: 1200 }, vehicle: V, spriteIds: {}, partSet: mps, scale,
      });
      nodeParts = mechaVehicleNodeParts(V);
      const gearCtx = { scheme: V.parts?.scheme, leg: V.parts?.leg, trackLen: V.parts?.trackLen };
      spriteFor = (part) => {
        if (part === 'hullBody') return gearSprite2(sig + ':body', () => generateMechaHullBody(V.hull, V.parts?.hull, V.parts?.scheme));
        if (part === 'turret') return gearSprite2(sig + ':turret', () => generateMechaTurret(V.hull, V.parts?.hull, V.parts?.scheme));
        if (part === 'trackUnit') return gearSprite(mobFam, 'trackUnit', sig, gearCtx);
        if (part === 'legThigh') return mps?.legThigh;
        if (part === 'legShin') return mps?.legShin;
        if (part === 'legFoot') return mps?.legFoot;
        if (part === 'multiUpper' || part === 'multiLower') {
          const mp = gearSprite2(sig + ':multi', () => {
            const p = generateMechaMultiLegParts(mobFam, V.mobility as 'quad' | 'spider', V.parts?.scheme);
            spriteCache.current.set(sig + ':multiUpper', p.upper);
            spriteCache.current.set(sig + ':multiLower', p.lower);
            return p.upper;
          });
          return part === 'multiUpper' ? mp : spriteCache.current.get(sig + ':multiLower');
        }
        return undefined;
      };
      spriteKeyFor = (part) => sig + ':' + part;
    }

    function gearSprite2(key: string, gen: () => MechaSpriteData): MechaSpriteData {
      let s = spriteCache.current.get(key);
      if (!s) { s = gen(); spriteCache.current.set(key, s); }
      return s;
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

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    const t = setTimeout(() => { redraw(); setBusy(false); }, 30);
    return () => clearTimeout(t);
  }, [open, redraw]);

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
    const { characterId } = mode === 'humanoid'
      ? createMechaCharacterInStore(store as never, { name: charName, family, build: buildOpts(), scale })
      : createMechaVehicleInStore(store as never, { name: charName, vehicle: vehicleOpts(), scale });
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
        <NumCtl label="胯高" value={torsoCtl.pelvisH} min={30} max={120} step={1} onCommit={(v) => setTorso({ pelvisH: v })} />
      </>)}
      <Adv id="torso" open={advOpen} setOpen={setAdvOpen}>
        <Row label="标记">
          <Chip active={torsoCtl.gearStripe} onClick={() => setTorso({ gearStripe: !torsoCtl.gearStripe })}>条纹</Chip>
          <NumCtl label="徽记" value={torsoCtl.gearInsignia} min={0} max={9} step={1} onCommit={(v) => setTorso({ gearInsignia: v })} />
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
        {([['block', '颌块'], ['respirator', '呼吸器'], ['small', '小颌']] as const).map(([v, l]) => (
          <Chip key={v} active={headCtl.formJaw === v} onClick={() => setHead({ formJaw: v })}>{l}</Chip>
        ))}
      </Row>
      <Row label="耳部">
        {([['disc', '耳盘'], ['grille', '耳栅'], ['plate', '耳板']] as const).map(([v, l]) => (
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
      </Row>
      {numRow(<>
        <NumCtl label="车宽" value={hullCtl.hullW} min={150} max={400} step={1} onCommit={(v) => setHullCtl({ hullW: v })} />
        <NumCtl label="车高" value={hullCtl.hullH} min={70} max={220} step={1} onCommit={(v) => setHullCtl({ hullH: v })} />
        <NumCtl label="模块数" value={hullCtl.formModules} min={0} max={5} step={1} onCommit={(v) => setHullCtl({ formModules: v })} />
      </>)}
      <Adv id="hull" open={advOpen} setOpen={setAdvOpen}>
        <Row label="标记">
          <NumCtl label="徽记" value={hullCtl.gearInsignia} min={0} max={9} step={1} onCommit={(v) => setHullCtl({ gearInsignia: v })} />
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
          <Row label="配色">
            {(Object.keys(MECHA_SCHEME_LABELS) as MechaSchemeName[]).map((s) => (
              <Chip key={s} active={scheme === s} onClick={() => setScheme(s)}>{MECHA_SCHEME_LABELS[s]}</Chip>
            ))}
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
                <Chip active={weapon === 'cannon'} onClick={() => setWeapon(weapon === 'cannon' ? 'none' : 'cannon')}>臂炮</Chip>
                <Chip active={weapon === 'rifle'} onClick={() => setWeapon(weapon === 'rifle' ? 'none' : 'rifle')}>步枪</Chip>
              </Row>
              <Row label="导弹荚">
                <Chip active={podMount === null} onClick={() => setPodMount(null)}>无</Chip>
                {(Object.keys(MECHA_POD_MOUNT_LABELS) as MechaPodMount[]).map((m) => (
                  <Chip key={m} active={podMount === m} onClick={() => setPodMount(m)}>{MECHA_POD_MOUNT_LABELS[m]}</Chip>
                ))}
              </Row>
              {(weapon !== 'none' || podMount) && numRow(<>
                <NumCtl label="武器长×" value={weaponLen} min={0.5} max={2} step={0.05} onCommit={setWeaponLen} />
                <NumCtl label="武器粗×" value={weaponThick} min={0.5} max={2} step={0.05} onCommit={setWeaponThick} />
                <span className="text-[11px] text-gray-500">臂炮/步枪/导弹荚通用</span>
              </>)}
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
