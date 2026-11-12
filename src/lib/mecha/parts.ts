// ============================================================
// 机甲部位精灵生成：各部位在本地坐标用引擎渲染，按关节点裁剪为
// 精灵（RGBA 像素 + 插头=关节点在图内坐标）。供角色构建
// （build-character）与蓝图机甲源节点共用。族规格 = 研究线逐
// 部位验收过的规格（数字是实例参数，构造走引擎模式）。
// ============================================================
import {
  SCHEMES, MECHA_W, MECHA_H, newCanvas, layout, finishRender,
  armIR, renderArmIR, torsoIR, renderTorsoIR, headIR, renderHeadIR, hullIR, renderHullIR, renderHipBeam, legIR,
} from './engine';
import type { Scheme, LegSpec, ArmSpec, TorsoSpec, TorsoProfile, HeadSpec, HullSpec, MechaCanvas, Pt } from './engine';
import { renderMultiLeg, multiLegGeom, renderTrackUnit, renderJetpack, renderWeapon, renderWeaponCombo, WEAPON_PRESETS, FIN_STD, TRACK_ORIGIN, JETPACK_ORIGIN, type WeaponKind, type WeaponCombo, type TrackSpec } from './gear';
import { BUILTIN_ENTRIES, type FinishEntryDef, type MechaGenDef } from '../library-entries';

/** 族规格基线（条目数据形态）：不含 scheme（配色按名在消费处解）。
 * 基线本体住在各族的部件条目里（mecha-{leg,arm,torso,head}-{族}
 * 的 def.spec），本文件只经 baselineOf 读取——规格的唯一数据源
 * 是条目，不再有代码侧工厂表 */
export type MechaLegBaseline = Omit<LegSpec, 'scheme'>;
export type MechaArmBaseline = Omit<ArmSpec, 'scheme'>;
export type MechaTorsoBaseline = Omit<TorsoSpec, 'scheme'>;
export type MechaHeadBaseline = Omit<HeadSpec, 'scheme'>;
export interface MechaPartBaselines {
  leg?: MechaLegBaseline; arm?: MechaArmBaseline; torso?: MechaTorsoBaseline; head?: MechaHeadBaseline;
  /** 喷射背包的族尺寸基线（jetpack 条目的 def.spec） */
  jetpack?: { size: { x: number; y: number } };
}
/** 族收尾基线（着色条目的 def.base 形态）：步列展开之外的基线
 * 字段（缝宽档/足副色/进气叶面调/栓毂组合），fin() 的数据源 */
export interface MechaFinishBase {
  seamScale?: number; footAlt?: boolean;
  intake?: { slatTone?: number; slatBlue?: number };
  boltFrame?: 'square' | 'ring' | 'none'; boltCore?: 'dark' | 'dome'; hubGroove?: boolean; hubFrame?: 'square';
}

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
/** 条目基线读取：族规格与族收尾基线的唯一数据源是条目
 * （mecha-{部位}-{族} 的 def.spec / finish-{族} 的 def.base）。
 * 找不到即抛错——基线缺失是数据错误，不许静默回退缺省 */
function partBaseline<K extends 'leg' | 'arm' | 'torso' | 'head' | 'jetpack'>(gen: K, family: MechaFamily): NonNullable<MechaPartBaselines[K]> {
  const e = BUILTIN_ENTRIES.find((x) => x.id === `mecha-${gen}-${family}`);
  const def = e?.versions[e.latest] as MechaGenDef | undefined;
  const base = def?.spec?.[gen];
  if (!base) throw new Error(`条目基线缺失：mecha-${gen}-${family}.spec.${gen}`);
  return base as NonNullable<MechaPartBaselines[K]>;
}
function finishBaseOf(family: MechaFamily): MechaFinishBase {
  const e = BUILTIN_ENTRIES.find((x) => x.id === `finish-${family}`);
  const def = e?.versions[e.latest] as FinishEntryDef | undefined;
  return def?.base ?? {};
}

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

/* 收尾共通档 FIN_STD 住 gear.ts（唯一一份）：本文件的 fin() 与
 * gear.ts 的 gearFinish 共用，不在此再抄一份 */

function fin(family: MechaFamily): LegSpec & { altTone?: boolean; footAlt?: boolean } {
  // altTone 基线全族关（双色交替只由规格/条目显式开：敏捷的 twoTone 走头部规格链、不走收尾基线）
  // camo 基线全族关（同 CAMO_OF 旧值：噪点迷彩在板内翻棕是碎块源头，迷彩只由条目/覆盖开启）
  return { ...FIN_STD, scheme: SCHEME_OF[family], camo: false, ...finishBaseOf(family) } as LegSpec & { altTone?: boolean; footAlt?: boolean };
}

/** 块形标准档（DAG 数据）：各规格表与装配缺省共用一份，不在装配代码里重抄 */
const BLOCK_SHAPE_STD = { chamFloor: 0.3, varLo: 0.3, varHi: 1.8, stepP: 0.45 };

/** 着色覆盖（模式库「着色」条目解析后的参数面）：收尾规格里属着色的字段 */
export interface MechaFinishOv {
  wear?: number; camo?: boolean; detail?: number; shellMode?: boolean;
  ridges?: boolean; seams?: boolean; seamScale?: number; twoTone?: boolean; thickRatio?: number;
  outline?: boolean; darkRim?: number; blackGap?: number;
  intake?: { rim?: number; pitch?: number; peak?: number; fall?: number; accentSlats?: boolean; topTone?: number; topGrad?: number; slatTone?: number; slatBlue?: number };
  boltFrame?: 'square' | 'ring' | 'none'; boltCore?: 'dark' | 'dome'; hubGroove?: boolean; hubFrame?: 'square';
  decalKind?: 'num' | 'plate' | 'none'; cableTint?: [number, number, number];
}

/** 收尾覆盖的同名字段（接线表）：覆盖按名抄进收尾规格；
 * twoTone 是唯一改名项（着色覆盖的双色调 → 收尾规格的 altTone） */
const FIN_OV_KEYS = [
  'wear', 'camo', 'seed', 'detail', 'wheelPhase', 'ridges', 'outline', 'darkRim', 'blackGap',
  'seams', 'seamScale', 'thickRatio', 'intake', 'shellMode', 'cableTint', 'decalKind',
  'boltFrame', 'boltCore', 'hubGroove', 'hubFrame',
] as const;

/** 收尾规格：族基线 + 稀疏覆盖（只覆写给出的字段，无覆盖时与 fin() 逐值一致） */
function finFor(family: MechaFamily, scheme: Scheme, ov?: MechaFinishOv & {
  seed?: number; wheelPhase?: number;
}): LegSpec & { altTone?: boolean } {
  const F = fin(family);
  F.scheme = scheme;
  if (!ov) return F;
  const src = ov as unknown as Record<string, unknown>;
  const dst = F as unknown as Record<string, unknown>;
  for (const k of FIN_OV_KEYS) {
    if (src[k] === undefined) continue;
    // intake 是对象参数：折叠只覆写它设了的字段，族基线的叶片
    // 材质（slatTone/slatBlue）保留——整体替换会把敏捷的蓝叶
    // 掺混冲成素金属（N 轮躯干接线修复的连带项）
    if (k === 'intake' && dst[k]) {
      const merged: Record<string, unknown> = { ...(dst[k] as Record<string, unknown>) };
      for (const [ik, iv] of Object.entries(src[k] as Record<string, unknown>)) if (iv !== undefined) merged[ik] = iv;
      dst[k] = merged;
    } else dst[k] = src[k];
  }
  if (ov.twoTone !== undefined) F.altTone = ov.twoTone;
  return F;
}

// 族规格基线已入条目数据（library-entries 的 PART_SPEC → 各族部件条目的 def.spec），本文件经 partBaseline 读取

// ---------- 部件覆盖（稀疏：只写改过的字段，其余走族预设） ----------
export interface MechaLegOverrides {
  topology?: LegSpec['topology']; footType?: LegSpec['footType'];
  bend?: number; wScale?: number; shinWRatio?: number; taperThigh?: number; taperShin?: number; ankleShift?: number;
  lift?: number; coreScale?: number; detail?: number; wear?: number; camo?: boolean;
  shellMode?: boolean; frameHeavy?: boolean; guardOff?: boolean; shinPiston?: boolean;
  decalKind?: LegSpec['decalKind']; cableTint?: [number, number, number]; seed?: number;
  blockShape?: Partial<import('./engine').BlockShapeParams>;
  /** 膝盖块厚度系数 / 腓肠隆起系数 / 胫骨凹面深度系数（默认 1） */
  kneeScale?: number; calfScale?: number; shinConcave?: number;
  /** 高光棱模式开关（默认开）/ 料厚比（默认 0.16）——模式库登记项 */
  ridges?: boolean; thickRatio?: number;
  /** 轮足滚动相位（行程 px，相位帧组内部用，用户覆盖不设） */
  wheelPhase?: number;
  /** 髋梁横轴（模式库「髋梁横轴」）：部件集附带梁精灵（支架腿组装配用） */
  hipBeam?: boolean;
  /** 栓框/栓芯/毂槽/毂框（着色算子 boltframe/boltcore/hubgroove/hubframe 的参数面） */
  boltFrame?: 'square' | 'ring' | 'none'; boltCore?: 'dark' | 'dome'; hubGroove?: boolean; hubFrame?: 'square';
  /** 支架腿组参数（模式库「支架腿组」）：张开 / 够达，装配双骨解算消费 */
  standSplay?: number; standReach?: number;
}
export interface MechaArmOverrides {
  blockShape?: Partial<import('./engine').BlockShapeParams>;
  hand?: ArmSpec['hand']; bulk?: number; shell?: number;
  upperLen?: number; foreLen?: number; upperAng?: number; elbowBend?: number; diag?: number;
  form?: Partial<ArmSpec['form']>; gear?: Partial<ArmSpec['gear']>;
  foreBand?: ArmSpec['foreBand'];
  foreTipBand?: boolean; upperRootStripes?: number; shoulderDisc?: [number, number];
  shellRole?: ArmSpec['shellRole']; shoulderPanel?: ArmSpec['shoulderPanel'];
  insignia?: { kind: number; along: number; perp: number }; // 徽章模式参数（种类 + 肩框落点），用户定
  twoTone?: boolean; wear?: number; camo?: boolean; seed?: number; thickRatio?: number;
  /** 栓框/栓芯/毂槽/毂框（着色算子 boltframe/boltcore/hubgroove/hubframe 的参数面） */
  boltFrame?: 'square' | 'ring' | 'none'; boltCore?: 'dark' | 'dome'; hubGroove?: boolean; hubFrame?: 'square';
}
export interface MechaTorsoOverrides {
  blockShape?: Partial<import('./engine').BlockShapeParams>;
  intakeDepth?: [number, number];
  boxDepth?: [number, number];
  intakeShare?: [number, number];
  intakeOrient?: 'keel' | 'flat';
  intakeTrim?: boolean;
  keelPlate?: boolean;
  keelReach?: number;
  neckStruts?: boolean;
  ventFuse?: boolean;
  chestW?: number; chestH?: number; waistH?: number; pelvisH?: number;
  form?: Partial<TorsoSpec['form']>; gear?: Partial<TorsoSpec['gear']>;
  insigniaPos?: [number, number]; // 徽章模式落点，用户定
  waistForm?: 'plates' | 'rings' | 'hose'; hoseTubes?: number; hoseR?: number;
  waistDisc?: [number, number]; skirtShrink?: number; pelvisInset?: boolean;
  pelvisForm?: 'shell'; pelvisPlate?: boolean; chestStripes?: number;
  shellMid?: [number, number, number]; shellCap?: boolean; shellSeg?: boolean; chestVent?: boolean;
  profile?: Partial<TorsoProfile>;
  twoTone?: boolean; wear?: number; camo?: boolean; seed?: number;
  /** 栓框/栓芯/毂槽/毂框（着色算子 boltframe/boltcore/hubgroove/hubframe 的参数面） */
  boltFrame?: 'square' | 'ring' | 'none'; boltCore?: 'dark' | 'dome'; hubGroove?: boolean; hubFrame?: 'square';
}
export interface MechaHeadOverrides {
  blockShape?: Partial<import('./engine').BlockShapeParams>;
  intakeDepth?: [number, number];
  intakeShare?: [number, number];
  w?: number; h?: number; tilt?: number;
  form?: Partial<HeadSpec['form']>;
  twoTone?: boolean; altTone?: boolean; wear?: number; camo?: boolean; seed?: number;
  seatH?: number; slitEnd?: number; glowPeak?: number; tubeSeg?: boolean; topSeg?: boolean; seamScale?: number; templeDisc?: boolean; collarSeg?: boolean; finBrow?: boolean; templeBolt?: boolean; chinTipScale?: number; domeFlat?: number; domeApex?: number; echoSecond?: [number, number]; geom?: HeadSpec['geom']; fairingTone?: 'armor' | 'armor2'; finGeom?: HeadSpec['finGeom']; hornGeom?: HeadSpec['hornGeom']; antGeom?: HeadSpec['antGeom']; faceDescent?: { top: [number, number]; descent: [number, number]; under: [number, number]; inset: number; rise: number }; visorPts?: [number, number][]; crestPts?: [number, number][]; fairingPts?: [number, number][]; breatherPts?: [number, number][]; crownBand?: 'accent'; browForm?: 'crest';
  shellStep?: boolean; shellSeams?: boolean; cheekLines?: boolean; chinTip?: boolean;
  faceStripe?: boolean;
  /** 栓框/栓芯/毂槽/毂框（着色算子 boltframe/boltcore/hubgroove/hubframe 的参数面） */
  boltFrame?: 'square' | 'ring' | 'none'; boltCore?: 'dark' | 'dome'; hubGroove?: boolean; hubFrame?: 'square';
}
export interface MechaPartOverrides {
  scheme?: MechaSchemeName;
  leg?: MechaLegOverrides; arm?: MechaArmOverrides; torso?: MechaTorsoOverrides; head?: MechaHeadOverrides;
}

/** 整机比例（部位间比例参数组）：都是对族规格的倍率，1 = 族原
 * 规格。此前不存在这一层——各部位尺寸各自写死、拼起来是什么
 * 比例就是什么比例（三族腿长甚至完全相同）。肩宽不单列：肩锚
 * 点由胸宽按构造导出，躯干宽即肩宽的控制。 */
export interface MechaProportions {
  head?: number; torsoW?: number; torsoH?: number; arm?: number; leg?: number;
  /** 小腿占腿长（髋→踝）之比。定法是段长比（小腿/大腿）不是占高比：
   * 2026-11-10 形式语言横读实测——敏捷 1.19 → 0.543、主战 0.88 → 0.468、
   * 动力服 1.04 → 0.51。此前一轮按占高比反定（0.65/0.567/0.521）把敏捷
   * 大腿压过头（装配段长比冲到 2.0），已废。 */
  legSplit?: number;
}
export type MechaProportionsFull = Required<MechaProportions>;
/** 族默认比例：据图库参考实测的装配占比反定（2026-11-08 网格
 * 标注测量：主战 头 11.8/躯干 31.6/腿 56.6、头胸宽比 ≈0.59；
 * 敏捷 头 11.7/躯干 37.4/腿 50.9、宽比 0.57；动力服 头 10.3/
 * 躯干 36.9/腿 52.8、宽比 0.61。产品当时：橄榄 12.2/30.9/56.8
 * 宽比 0.48、敏捷 15.9/30.0/54.1 宽比 0.44、动力服 13.0/28.9/
 * 58.0 宽比 0.63——橄榄纵向已近、只修宽比；敏捷/动力服主修
 * 躯干高与腿长） */
export const MECHA_PROPORTION_DEFAULTS: Record<MechaFamily, MechaProportionsFull> = {
  olive: { head: 1.15, torsoW: 0.94, torsoH: 1, arm: 1, leg: 1, legSplit: 0.468 },
  agile: { head: 1.2, torsoW: 0.92, torsoH: 1.15, arm: 1, leg: 1.15, legSplit: 0.543 },
  powersuit: { head: 0.92, torsoW: 1, torsoH: 1.3, arm: 1, leg: 0.91, legSplit: 0.51 },
};
export function resolveProportions(family: MechaFamily, prop?: MechaProportions): MechaProportionsFull {
  return { ...MECHA_PROPORTION_DEFAULTS[family], ...(prop ?? {}) };
}
/** 载具比例默认（倍率）：walker 据主战坦克参考（车体含炮塔占
 * 总高 41%、车下腿 59%）反定——产品当时车体 30.4%/腿 69.6%，
 * 故腿 0.85、车高 1.15；hauler 无同等强度参考、维持 1 */
export const MECHA_VEHICLE_PROPORTION_DEFAULTS: Record<'walker' | 'hauler', { leg: number; hullH: number }> = {
  walker: { leg: 0.78, hullH: 1.3 },
  hauler: { leg: 1, hullH: 1 },
};
/** 车体覆盖（载具） */
export interface MechaHullOverrides {
  blockShape?: Partial<import('./engine').BlockShapeParams>;
  intakeDepth?: [number, number];
  intakeShare?: [number, number];
  hullW?: number; hullH?: number;
  /** 整机比例的车高倍率（与 hullH 绝对覆盖叠加：先覆盖后乘倍率） */
  hullHMul?: number;
  form?: Partial<HullSpec['form']>; gear?: Partial<HullSpec['gear']>;
  insigniaPos?: [number, number]; // 徽章模式落点，用户定
  /** 垂缆 / 侧挂设备舱（模式库登记项，铁巢样本） */
  sagCables?: boolean; sidePod?: boolean;
  twoTone?: boolean; wear?: number; camo?: boolean; seed?: number;
}
/** 族预设规格（向导控件默认值与差分基准） */
export function mechaLegSpecOf(family: MechaFamily): LegSpec { return { ...partBaseline('leg', family), scheme: SCHEME_OF[family] }; }
export function mechaArmSpecOf(family: MechaFamily): ArmSpec { return { ...partBaseline('arm', family), scheme: SCHEME_OF[family] }; }
export function mechaTorsoSpecOf(family: MechaFamily): TorsoSpec { return { ...partBaseline('torso', family), scheme: SCHEME_OF[family] }; }
export function mechaHeadSpecOf(family: MechaFamily): HeadSpec { return { ...partBaseline('head', family), scheme: SCHEME_OF[family] }; }
export function mechaHullSpecOf(kind: 'walker' | 'hauler'): HullSpec { return HULL_SPEC_OF(kind); }

export interface MechaPartSet {
  leg: MechaSpriteData;
  legThigh: MechaSpriteData;
  legShin: MechaSpriteData;
  legFoot: MechaSpriteData;
  /** 髋梁精灵（原点=梁心）：LegSpec.hipBeam 开时附带，支架腿组装配挂载 */
  hipBeam?: MechaSpriteData;
  /** 支架腿组装配参数（缺省 = 模式条目标准值） */
  stand: { splay: number; reach: number };
  /** 腿拓扑为反关节（装配站姿解算的膝极向须随后翻转，见 build-character legPose） */
  legReverse: boolean;
  armUpper: MechaSpriteData;
  armFore: MechaSpriteData;
  armHand: MechaSpriteData;
  torso: MechaSpriteData;
  head: MechaSpriteData;
  /** 肢链几何（规范直姿渲染的段长）与静止节点角（度：链根为绝对角、其余相对父） */
  geom: { thighLen: number; shinLen: number; upperLen: number; foreLen: number };
  rest: { armUpper: number; armFore: number; legThigh: number; legShin: number; legFoot: number; legToeAbs: number };
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

/** 双足腿静止姿模板（数据）：legPipeline 取它算静止角、轮足腿取它
 * 摆整腿——同一姿只此一份，不许各写一份。纵向总跨 390（髋→膝
 * 204 + 膝→踝 186） */
const LEG_POSE_STD = { hip: { x: 100, y: 16 }, knee: { x: 188, y: 220 }, ankle: { x: 96, y: 406 }, toe: { x: 196, y: 442 } };

/** 规范直姿的画布口径（数据）：总长归一 390；踝锚在固定地面线上
 * （地线 470、踝高 50 → 踝 y 420），趾 = 踝 + (100, 36)——足锚在
 * 地面时位置与趾向都是常量（用户定） */
const LEG_CANON = { totalLen: 390, ankleX: 190, ankleY: 420, toeDx: 100, toeDy: 36 };

/** 髋梁精灵的裁剪原点（数据：梁的髋轴挂点） */
const HIPBEAM_ORIGIN = { x: 190, y: 70 };

/** 腿管线：规范直姿渲染一遍，再按骨段拆大腿/小腿/足（整腿图保留供蓝图库） */
function legPipeline(family: MechaFamily, footType?: LegSpec['footType'], ov?: MechaLegOverrides, schemeName?: MechaSchemeName, lenMul = 1, split = MECHA_PROPORTION_DEFAULTS[family].legSplit): {
  full: MechaSpriteData; thigh: MechaSpriteData; shin: MechaSpriteData; foot: MechaSpriteData;
  geom: { thighLen: number; shinLen: number }; rest: { thigh: number; shin: number; foot: number }; toeAbs: number; reverse: boolean;
} {
  const scheme = schemeName ? mechaSchemeByName(schemeName) : SCHEME_OF[family];
  const spec: LegSpec = { ...partBaseline('leg', family), scheme, ...(ov ?? {}) };
  if (footType) spec.footType = footType;
  const posed = { hip: { ...LEG_POSE_STD.hip }, knee: { ...LEG_POSE_STD.knee }, ankle: { ...LEG_POSE_STD.ankle }, toe: { ...LEG_POSE_STD.toe } };
  // 反拓扑静止姿：膝绕髋-踝轴镜像到后侧（踝点不变）。此前 posed 与
  // 拓扑无关——反腿的静止角与标准型逐位相同，装配出人形前屈膝，与
  // 按反向装饰的段精灵（腓肠/线缆换边）互相矛盾，整条小腿连足读作
  // 翻转（2026-11-10 组合批 L1/L4 抓到）。镜像只动膝点：段长、踝
  // 点、趾向全守恒
  const reverse = spec.topology === 'reverse';
  if (reverse) {
    const axX = posed.hip.x + (posed.ankle.x - posed.hip.x) * ((posed.knee.y - posed.hip.y) / (posed.ankle.y - posed.hip.y));
    posed.knee = { x: 2 * axX - posed.knee.x, y: posed.knee.y };
  }
  // 段长：总长仍归一到 390×倍率（posed 模板只供静止角，不再供切分——
  // 切分由族 legSplit 定，见 MechaProportions.legSplit 的横读依据）
  const tL = LEG_CANON.totalLen * (1 - split) * lenMul, sL = LEG_CANON.totalLen * split * lenMul;
  // 机身（髋）随腿长平移：足构图锚在固定地面线（GY 470、踝高 D 50），踝必须落在
  // 420——倍率变时挪髋，段板一寸不拉（拉长胫骨是错法，用户定）。趾点写成踝相对：
  // 足的位置锚在地面上时，朝向（踝→趾方向）也是常量，不随倍率变。
  const hipY = LEG_CANON.ankleY - (tL + sL);
  const ankleC = { x: LEG_CANON.ankleX, y: LEG_CANON.ankleY };
  const canon = { hip: { x: LEG_CANON.ankleX, y: hipY }, knee: { x: LEG_CANON.ankleX, y: hipY + tL }, ankle: ankleC, toe: { x: ankleC.x + LEG_CANON.toeDx, y: ankleC.y + LEG_CANON.toeDy } };
  const cv = newCanvas();
  const A = layout(cv, spec, legIR(spec), { hip: canon.hip, knee: canon.knee, ankle: canon.ankle, toeX: canon.toe.x });
  finishRender(cv, A, finFor(family, scheme, ov));
  const [thigh, shin, foot] = splitCanvasBySegments(cv, [canon.hip, canon.knee, canon.ankle, canon.toe], [37, 24]) as [MechaSpriteData, MechaSpriteData, MechaSpriteData];
  const aT = segAngDeg(posed.hip, posed.knee), aS = segAngDeg(posed.knee, posed.ankle), aF = segAngDeg(posed.ankle, posed.toe);
  // 规范趾向：足位图是规范姿的轴对齐裁切，趾向（踝→趾，aFc）已经画进
  // 位图里——足节点角是「位图旋转量」不是趾向：平足时足节点世界角必须
  // 为 0，静止足角 = (目标趾向 − 规范趾向) − 小腿绝对角。此前直接拿趾向
  // 当节点角（foot: aF − aS），足被多转一个 aFc（≈−70°），只在节点转向
  // 开（世界角恒 0）时看不出来，缺省呈现下足底必然俯着。
  const aFc = segAngDeg(canon.ankle, canon.toe);
  return {
    full: cropSprite(cv, canon.hip), thigh, shin, foot,
    geom: { thighLen: tL, shinLen: sL },
    rest: { thigh: aT, shin: aS - aT, foot: (aF - aFc) - aS },
    toeAbs: aFc,
    reverse,
  };
}

/** 生成一族的全部位精灵（人形：腿/上臂/前臂/躯干/头） */
export type MechaChestVariant = 'stack' | 'shell' | 'slab' | 'glacis';
export const MECHA_CHEST_LABELS: Record<MechaChestVariant, string> = { stack: '叠层胸', shell: '壳形胸', slab: '重型板胸', glacis: '斜面胸' };

export function generateMechaPartSet(family: MechaFamily, chest?: MechaChestVariant, ov?: MechaPartOverrides, prop?: MechaProportions): MechaPartSet {
  const scheme = ov?.scheme ? mechaSchemeByName(ov.scheme) : SCHEME_OF[family];
  const P = resolveProportions(family, prop);
  const FArm = finFor(family, scheme, ov?.arm);
  const FTorso = finFor(family, scheme, ov?.torso);
  const FHead = finFor(family, scheme, ov?.head);
  // 腿：规范直姿渲染 + 按骨段拆三件（大腿/小腿/足，各自成节点才可动可配 IK）
  const legP = legPipeline(family, undefined, ov?.leg, ov?.scheme, P.leg, P.legSplit);
  const leg = legP.full;
  // 髋梁（模式库「髋梁横轴」）：腿规格开 hipBeam 时附带梁精灵
  const legSpecFull: LegSpec = { ...partBaseline('leg', family), scheme, ...(ov?.leg ?? {}) };
  let hipBeam: MechaSpriteData | undefined;
  if (legSpecFull.hipBeam) {
    const bcv = newCanvas(); const BA = renderHipBeam(bcv, legSpecFull);
    finishRender(bcv, BA, finFor(family, scheme, ov?.leg));
    hipBeam = cropSprite(bcv, HIPBEAM_ORIGIN);
  }
  // 臂：规范直姿（角度归零）渲染——上臂按 IR 归属、前臂/手按骨段距离拆
  const armBase: ArmSpec = { ...partBaseline('arm', family), scheme };
  const armOv = ov?.arm;
  const armSpec: ArmSpec = {
    ...armBase, ...(armOv ?? {}),
    blockShape: { ...(armBase.blockShape ?? { chamFloor: 0.3, varLo: 0.3, varHi: 1.8, stepP: 0.45 }), ...(armOv?.blockShape ?? {}) },
    form: { ...armBase.form, ...(armOv?.form ?? {}) },
    gear: { ...armBase.gear, ...(armOv?.gear ?? {}) },
  };
  if ((armSpec as { altTone?: boolean }).altTone !== undefined) FArm.altTone = (armSpec as { altTone?: boolean }).altTone; // 规格级双色开关（与躯干同口径：基线 altTone 压过着色组合通面 twoTone——敏捷臂基线关交替，蓝只走带与嵌板，缺此行时肩钟下挂子板被通面交替整板染蓝）
  armSpec.upperLen *= P.arm; armSpec.foreLen *= P.arm; // 比例：臂长
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
  const torsoBase: TorsoSpec = { ...partBaseline('torso', family), scheme };
  const torsoOv = ov?.torso;
  const torsoSpec: TorsoSpec = {
    ...torsoBase, ...(torsoOv ?? {}),
    blockShape: { ...(torsoBase.blockShape ?? { chamFloor: 0.3, varLo: 0.3, varHi: 1.8, stepP: 0.45 }), ...(torsoOv?.blockShape ?? {}) },
    form: { ...torsoBase.form, ...(torsoOv?.form ?? {}) },
    gear: { ...torsoBase.gear, ...(torsoOv?.gear ?? {}) },
    profile: { ...(torsoBase.profile ?? {}), ...(torsoOv?.profile ?? {}) },
  };
  torsoSpec.chestW *= P.torsoW; // 比例：躯干宽（肩锚随胸宽导出）
  torsoSpec.chestH *= P.torsoH; torsoSpec.waistH *= P.torsoH; torsoSpec.pelvisH *= P.torsoH; // 比例：躯干高
  if (torsoSpec.altTone !== undefined) FTorso.altTone = torsoSpec.altTone;
  if (chest) torsoSpec.form = { ...torsoSpec.form, chest };
  const torsoIRv = torsoIR(torsoSpec);
  const torsoCv = newCanvas(); const TA = renderTorsoIR(torsoCv, torsoIRv, torsoSpec);
  finishRender(torsoCv, TA, FTorso);
  const torso = cropSprite(torsoCv, torsoIRv.anchors.hip);
  const rel = (p: Pt) => ({ x: p.x - torsoIRv.anchors.hip.x, y: p.y - torsoIRv.anchors.hip.y });
  const torsoSockets = { neck: rel(torsoIRv.anchors.neck), shoulder: rel(torsoIRv.anchors.shoulder), hip: rel(torsoIRv.anchors.hip) };
  // 头（原点=颈座）
  const headBase: HeadSpec = { ...partBaseline('head', family), scheme };
  const headOv = ov?.head;
  const headSpec: HeadSpec = {
    ...headBase, ...(headOv ?? {}),
    blockShape: { ...(headBase.blockShape ?? BLOCK_SHAPE_STD), ...(headOv?.blockShape ?? {}) },
    form: { ...headBase.form, ...(headOv?.form ?? {}) },
  };
  headSpec.w *= P.head; headSpec.h *= P.head; // 比例：头部大小
  if (headSpec.altTone !== undefined && headOv?.twoTone === undefined) FHead.altTone = headSpec.altTone; // 规格级双色开关（与躯干同口径）；着色覆盖显式给了 twoTone 时以它为准
  if (headSpec.seamScale !== undefined) FHead.seamScale = headSpec.seamScale; // 缝宽族档位：头部规格 → 收尾规格（缝 pass 处生效）
  if (headSpec.stackSeams) FHead.stackSeams = true; // 接触缝合成：头部规格置真（数据），装配只转交——收尾时按压覆关系登记为缝
  const headCv = newCanvas(); const HA = renderHeadIR(headCv, headIR(headSpec), headSpec);
  finishRender(headCv, HA, FHead);
  const head = cropSprite(headCv, headSpec.seat);
  return {
    leg, legThigh: legP.thigh, legShin: legP.shin, legFoot: legP.foot, hipBeam,
    stand: { splay: legSpecFull.standSplay ?? 0.23, reach: legSpecFull.standReach ?? 0.93 },
    legReverse: legP.reverse,
    armUpper, armFore, armHand, torso, head, elbowOff, wristOff, palmOff, torsoSockets,
    geom: { thighLen: legP.geom.thighLen, shinLen: legP.geom.shinLen, upperLen: armSpec.upperLen, foreLen: armSpec.foreLen },
    rest: {
      armUpper: (-armSpec.upperAng * 180) / Math.PI, armFore: (-armSpec.elbowBend * 180) / Math.PI,
      legThigh: legP.rest.thigh, legShin: legP.rest.shin, legFoot: legP.rest.foot, legToeAbs: legP.toeAbs,
    },
  };
}

/** 载具车体精灵（原点=甲板中心），供载具线后续使用 */
const HULL_SPEC_OF = (kind: 'walker' | 'hauler'): HullSpec => kind === 'walker'
  ? { family: 'walker', scheme: SCHEMES.olive, seed: 11, wear: 0.35, camo: true, twoTone: true, blockShape: BLOCK_SHAPE_STD, intakeDepth: [0.08, 0.08], intakeShare: [0.92, 0.75], grilleTone: 0.78, grilleTilt: 0.12, deck: { x: 190, y: 150 }, hullW: 280, hullH: 124, form: { turret: 'gun', cabin: 'front', skirt: true, modules: 3 }, insigniaPos: [-0.3, 0.5], seamX: 0.1, numberDx: -0.3, gear: { insignia: 0, number: 'N-37' } }
  : { family: 'hauler', scheme: SCHEMES.slate, seed: 23, wear: 0.3, camo: false, twoTone: true, blockShape: BLOCK_SHAPE_STD, intakeDepth: [0.08, 0.08], intakeShare: [0.92, 0.75], grilleTone: 1, grilleTilt: 0, deck: { x: 190, y: 150 }, hullW: 260, hullH: 118, form: { turret: 'rack', cabin: 'mid', skirt: false, modules: 2 }, insigniaPos: [0.37, 0.44], seamX: 0.26, hullStripe: { y: 0.615, x0: -0.47, x1: 0.43, w: 2.2 }, numberDx: -0.25, gear: { insignia: 1, number: 'M-7' } };

/* 车体收尾不再自备一份标准档副本（旧 HULL_FIN 是 FIN_STD 的手抄，
 * 标准档添 darkRim/blackGap 后它没跟上、车体一直缺暗沿与黑隙）：
 * 与 fin()/gearFinish 共用 gear.ts 的 FIN_STD 一份 */

function hullSpecWithOv(kind: 'walker' | 'hauler', ov?: MechaHullOverrides, schemeName?: MechaSchemeName): HullSpec {
  const base = HULL_SPEC_OF(kind);
  const spec: HullSpec = {
    ...base, ...(ov ?? {}),
    blockShape: { ...(base.blockShape ?? { chamFloor: 0.3, varLo: 0.3, varHi: 1.8, stepP: 0.45 }), ...(ov?.blockShape ?? {}) },
    form: { ...base.form, ...(ov?.form ?? {}) },
    gear: { ...base.gear, ...(ov?.gear ?? {}) },
  };
  if (schemeName) spec.scheme = mechaSchemeByName(schemeName);
  if (ov?.hullHMul) spec.hullH *= ov.hullHMul;
  return spec;
}
function hullFin(spec: HullSpec, ov?: MechaHullOverrides): LegSpec & { altTone?: boolean } {
  return {
    ...FIN_STD, scheme: spec.scheme, camo: spec.camo, altTone: spec.twoTone,
    ...(ov?.wear !== undefined ? { wear: ov.wear } : {}),
    ...(ov?.seed !== undefined ? { seed: ov.seed } : {}),
  } as LegSpec & { altTone?: boolean };
}

/** 炮塔主炮 = 武器模式的臂炮：生成武器精灵、把它的套筒点对齐到
 * 炮盾座，逐像素贴合进车体画布（合成在裁剪之前、bbox 自然含炮） */
function blitTurretGun(cv: MechaCanvas, spec: HullSpec, schemeName?: MechaSchemeName): void {
  if (spec.form.turret !== 'gun') return;
  const gun = generateMechaWeapon('olive', 'cannon', schemeName, { x: 0.5, y: 0.62 });
  const mount = { x: spec.deck.x + spec.hullW * 0.1, y: spec.deck.y - spec.hullH * 0.16 };
  const gx = Math.round(mount.x - gun.plug.x), gy = Math.round(mount.y - gun.plug.y);
  for (let y = 0; y < gun.height; y++) for (let x = 0; x < gun.width; x++) {
    const si = (y * gun.width + x) * 4, a = gun.rgba[si + 3];
    if (!a) continue;
    const tx = gx + x, ty = gy + y;
    if (tx < 0 || ty < 0 || tx >= MECHA_W || ty >= MECHA_H) continue;
    const di = (ty * MECHA_W + tx) * 4, af = a / 255;
    cv.col[di] = gun.rgba[si] * af + cv.col[di] * (1 - af);
    cv.col[di + 1] = gun.rgba[si + 1] * af + cv.col[di + 1] * (1 - af);
    cv.col[di + 2] = gun.rgba[si + 2] * af + cv.col[di + 2] * (1 - af);
    cv.col[di + 3] = Math.max(cv.col[di + 3], a);
  }
}

export function generateMechaHull(kind: 'walker' | 'hauler', ov?: MechaHullOverrides, schemeName?: MechaSchemeName): MechaSpriteData {
  const spec = hullSpecWithOv(kind, ov, schemeName);
  const cv = newCanvas(); const A = renderHullIR(cv, hullIR(spec), spec);
  finishRender(cv, A, hullFin(spec, ov));
  blitTurretGun(cv, spec, schemeName);
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
  blitTurretGun(cv, spec, schemeName);
  const pivot = { x: spec.deck.x - spec.hullW * 0.06, y: spec.deck.y - spec.hullH * 0.14 };
  return cropSprite(cv, pivot);
}

/** 族主甲色（十六进制，供服装件底色/关节盘生成）；配色覆盖时跟配色走 */
export function mechaFamilyArmorHex(family: MechaFamily, schemeName?: MechaSchemeName): string {
  const c = (schemeName ? mechaSchemeByName(schemeName) : SCHEME_OF[family]).armor;
  return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** 轮足腿精灵（双足腿的足型变体：同髋插座、同锚点，足部换轮组；
 * 姿势与 legPipeline 同一份静止姿模板 LEG_POSE_STD） */
export function generateMechaWheelLeg(family: MechaFamily): MechaSpriteData {
  const scheme = SCHEME_OF[family];
  const cv = newCanvas(); const hip = { ...LEG_POSE_STD.hip };
  const spec = { ...partBaseline('leg', family), scheme, footType: 'wheel' as const };
  const A = layout(cv, spec, legIR(spec), { hip, knee: { ...LEG_POSE_STD.knee }, ankle: { ...LEG_POSE_STD.ankle }, toeX: LEG_POSE_STD.toe.x });
  finishRender(cv, A, fin(family));
  return cropSprite(cv, hip);
}

/** 多足腿规格（数据口径）：整腿与分段件共用一份，不许各写一份 */
function multiLegSpec(family: MechaFamily, profile: 'spider' | 'quad', scheme: Scheme) {
  return { scheme, seed: 11, wear: 0.3, camo: false, twoTone: partBaseline('head', family).twoTone, profile, blockShape: BLOCK_SHAPE_STD };
}

/** 多足整腿的髋插座原点（数据） */
const MULTILEG_ORIGIN = { x: 56, y: 64 };

/** 多足分段件的段帧原点（数据）：上段在髋帧、中段在膝帧、足段在踝帧 */
const MULTILEG_SEG_ORIGIN = { upper: { x: 70, y: 46 }, mid: { x: 70, y: 30 }, foot: { x: 70, y: 30 } };

/** 多足腿精灵（蜘蛛/四足，原点=髋插座） */
export function generateMechaMultiLeg(family: MechaFamily, profile: 'spider' | 'quad', schemeName?: MechaSchemeName, finOv?: MechaFinishOv): MechaSpriteData {
  const scheme = schemeName ? mechaSchemeByName(schemeName) : SCHEME_OF[family];
  const cv = newCanvas(); const hip = { ...MULTILEG_ORIGIN };
  const spec = multiLegSpec(family, profile, scheme);
  const A = renderMultiLeg(cv, spec, hip);
  finishRender(cv, A, finFor(family, scheme, finOv));
  return cropSprite(cv, hip);
}

/** 轮足分段件（大腿/小腿与常足共用造型、足换轮组）：底盘选轮足时用 */
export function generateMechaWheelLegParts(family: MechaFamily, ov?: MechaLegOverrides, schemeName?: MechaSchemeName): { thigh: MechaSpriteData; shin: MechaSpriteData; foot: MechaSpriteData } {
  const p = legPipeline(family, 'wheel', ov, schemeName);
  return { thigh: p.thigh, shin: p.shin, foot: p.foot };
}

/** 多足腿分段件：上段（髋→膝，髋帧直姿）/中段（膝→踝，膝帧直姿）/足段（踝→趾，踝帧直姿）。
 *  三段各自成节点、静止角 a1/a2rel/a3rel 串起来即原整腿姿态（拆关节配 IK 用） */
export function generateMechaMultiLegParts(family: MechaFamily, profile: 'spider' | 'quad', schemeName?: MechaSchemeName, finOv?: MechaFinishOv, lenMul = 1): {
  upper: MechaSpriteData; mid: MechaSpriteData; foot: MechaSpriteData; l1: number; l2: number; l3: number; a1: number; a2rel: number; a3rel: number;
} {
  const scheme = schemeName ? mechaSchemeByName(schemeName) : SCHEME_OF[family];
  const spec = multiLegSpec(family, profile, scheme);
  const gm = multiLegGeom(profile, lenMul);
  // 上段：髋帧，段一竖直向下
  const hipU = { ...MULTILEG_SEG_ORIGIN.upper };
  const cvU = newCanvas();
  const AU = renderMultiLeg(cvU, spec, hipU, { knee: { x: hipU.x, y: hipU.y + gm.l1 }, ankle: { x: hipU.x, y: hipU.y + gm.l1 + gm.l2 }, toe: { x: hipU.x, y: hipU.y + gm.l1 + gm.l2 + 40 } }, 'upper');
  finishRender(cvU, AU, finFor(family, scheme, finOv));
  const upper = cropSprite(cvU, hipU);
  // 中段：膝帧，段二竖直向下；趾点按相对弯 a3rel 方向放（只供踝衬底朝向）
  const kneeO = { ...MULTILEG_SEG_ORIGIN.mid };
  const ankleM = { x: kneeO.x, y: kneeO.y + gm.l2 };
  const d3 = { x: -Math.sin((gm.a3rel * Math.PI) / 180), y: Math.cos((gm.a3rel * Math.PI) / 180) };
  const toeM = { x: ankleM.x + d3.x * gm.l3, y: ankleM.y + d3.y * gm.l3 };
  const cvM = newCanvas();
  const AM = renderMultiLeg(cvM, spec, kneeO, { knee: kneeO, ankle: ankleM, toe: toeM }, 'mid');
  finishRender(cvM, AM, finFor(family, scheme, finOv));
  const mid = cropSprite(cvM, kneeO);
  // 足段：踝帧，段三竖直向下（趾垫随帧走，装配时由足节点角 a3rel 摆回静止向）
  const ankleO = { ...MULTILEG_SEG_ORIGIN.foot };
  const cvF = newCanvas();
  const AF = renderMultiLeg(cvF, spec, ankleO, { knee: ankleO, ankle: ankleO, toe: { x: ankleO.x, y: ankleO.y + gm.l3 } }, 'foot');
  finishRender(cvF, AF, finFor(family, scheme, finOv));
  const foot = cropSprite(cvF, ankleO);
  return { upper, mid, foot, l1: gm.l1, l2: gm.l2, l3: gm.l3, a1: gm.a1, a2rel: gm.a2rel, a3rel: gm.a3rel };
}

/** 履带底盘精灵（原点=座圈顶面中心，躯干/车体挂载点；原点数据在 gear 的 TRACK_ORIGIN 一份） */
export function generateMechaTrackUnit(family: MechaFamily, ov?: { scheme?: MechaSchemeName } & Pick<TrackSpec, 'len' | 'phase' | 'radius' | 'band' | 'drop' | 'wheels' | 'skirtH' | 'deckW' | 'deckH' | 'seat'> & MechaFinishOv): MechaSpriteData {
  const scheme = ov?.scheme ? mechaSchemeByName(ov.scheme) : SCHEME_OF[family];
  const cv = newCanvas(); const origin = { ...TRACK_ORIGIN };
  const spec: TrackSpec = { scheme, seed: 11, wear: 0.3, camo: false, twoTone: partBaseline('head', family).twoTone, len: ov?.len, phase: ov?.phase, radius: ov?.radius, band: ov?.band, drop: ov?.drop, wheels: ov?.wheels, skirtH: ov?.skirtH, deckW: ov?.deckW, deckH: ov?.deckH, seat: ov?.seat, blockShape: BLOCK_SHAPE_STD };
  const A = renderTrackUnit(cv, spec, origin);
  const F = finFor(family, scheme, ov);
  if (ov?.phase) F.beltPhase = ov.phase;
  finishRender(cv, A, F);
  return cropSprite(cv, origin);
}

/** 滚动相位帧模式（模式库「滚动相位帧」条目）：相位帧组 = 周期内等步距取帧，
 *  进包后由运行时按累计位移选帧（Sprite.drive）。帧数/步距/周期在此声明，
 *  生成函数只读声明、不写死字面量 */
export const MECHA_TRACK_DRIVE_PERIOD = 16; // 履带一圈链节距 px
export const MECHA_TRACK_DRIVE_FRAMES = 3;
export const MECHA_TRACK_DRIVE_STEP = MECHA_TRACK_DRIVE_PERIOD / MECHA_TRACK_DRIVE_FRAMES; // 步距浮点保周期整除
export function generateMechaTrackUnitPhases(family: MechaFamily, ov?: { len?: number; scheme?: MechaSchemeName }): MechaSpriteData[] {
  return Array.from({ length: MECHA_TRACK_DRIVE_FRAMES }, (_, k) => k * MECHA_TRACK_DRIVE_STEP).map((phase) => generateMechaTrackUnit(family, { ...ov, phase }));
}

/** 轮足：轮图样 12 扇区旋转对称，一扇区（主轮行程 ≈23px）内取帧，每腿三段
 *  各一份——哪段真含轮像素由建角侧比对决定挂不挂 drive */
export const MECHA_WHEEL_DRIVE_PERIOD = 24;
export const MECHA_WHEEL_DRIVE_FRAMES = 3;
export const MECHA_WHEEL_DRIVE_STEP = 8;
export function generateMechaWheelLegPhases(family: MechaFamily, ov?: MechaLegOverrides, schemeName?: MechaSchemeName): { thigh: MechaSpriteData; shin: MechaSpriteData; foot: MechaSpriteData }[] {
  return Array.from({ length: MECHA_WHEEL_DRIVE_FRAMES }, (_, k) => k * MECHA_WHEEL_DRIVE_STEP).map((wheelPhase) => generateMechaWheelLegParts(family, { ...(ov ?? {}), wheelPhase }, schemeName));
}

/** 喷射背包尺寸（按族参考量比：纵向总跨 敏捷约 46% 身高 / 主战约 37%） */
/** 喷射背包精灵（原点=贴背挂载点，箱体在原点后方） */
export function generateMechaJetpack(family: MechaFamily, schemeName?: MechaSchemeName, finOv?: MechaFinishOv): MechaSpriteData {
  const scheme = schemeName ? mechaSchemeByName(schemeName) : SCHEME_OF[family];
  const cv = newCanvas(); const origin = { ...JETPACK_ORIGIN };
  const spec = { scheme, seed: 21, wear: 0.25, camo: false, twoTone: partBaseline('head', family).twoTone, size: partBaseline('jetpack', family).size, blockShape: BLOCK_SHAPE_STD };
  const A = renderJetpack(cv, spec, origin);
  finishRender(cv, A, finFor(family, scheme, finOv));
  return cropSprite(cv, origin);
}

/** 武器精灵（臂炮/导弹荚/步枪；原点语义见 gear 的 renderWeapon） */
const WEAPON_SIZE: Record<MechaFamily, Record<'cannon' | 'rifle', { x: number; y: number }>> = {
  olive: { cannon: { x: 1.88, y: 1.27 }, rifle: { x: 1.84, y: 1.36 } },
  agile: { cannon: { x: 1.55, y: 1.05 }, rifle: { x: 1.4, y: 1.12 } },
  powersuit: { cannon: { x: 1.16, y: 0.91 }, rifle: { x: 1.04, y: 0.96 } },
};
/** 新预设的橄榄基准尺寸（其余族按步枪族比折算） */
const WEAPON_PRESET_SIZE: Record<string, { x: number; y: number }> = {
  beamRifle: { x: 1.75, y: 1.3 }, plasmaCannon: { x: 1.7, y: 1.35 }, railgun: { x: 2.15, y: 1.25 },
  beamBlade: { x: 1.55, y: 0.85 }, longBlade: { x: 1.6, y: 0.9 }, curvedBlade: { x: 1.55, y: 0.9 },
  warAxe: { x: 1.35, y: 1.05 }, powerHammer: { x: 1.45, y: 1.1 }, lance: { x: 1.85, y: 0.95 },
};
/** 武器精灵（组合制：kind = 预设 id，comboOv 可覆盖预设的部件轴） */
export function generateMechaWeapon(family: MechaFamily, kind: WeaponKind | string, schemeName?: MechaSchemeName, sizeMul?: { x: number; y: number }, finOv?: MechaFinishOv, comboOv?: Partial<WeaponCombo>): MechaSpriteData {
  const scheme = schemeName ? mechaSchemeByName(schemeName) : SCHEME_OF[family];
  const preset = WEAPON_PRESETS[kind] ?? WEAPON_PRESETS.cannon!;
  const combo: WeaponCombo = { ...preset.combo, ...(comboOv ?? {}) };
  const cv = newCanvas();
  const origin = preset.mount === 'pod' ? (combo.grip === 'pylon' ? { x: 190, y: 330 } : { x: 170, y: 150 }) : { x: 90, y: 130 };
  // 武器尺寸分两层：族基准（按图库参考量比定——手持武器全长/身高：
  // 重机甲长炮 ≈0.75、敏捷 ≈0.37、动力服 ≈0.31；基准构造全长臂炮
  // 181、步枪 207；导弹荚族基准为 1）× 用户倍率 sizeMul（向导
  // 「武器长/武器粗」，导弹荚同为武器、同一套设置）。
  let base: { x: number; y: number };
  if (kind === 'cannon' || kind === 'rifle') base = WEAPON_SIZE[family][kind];
  else if (WEAPON_PRESET_SIZE[kind]) {
    const f = { x: WEAPON_SIZE[family].rifle.x / WEAPON_SIZE.olive.rifle.x, y: WEAPON_SIZE[family].rifle.y / WEAPON_SIZE.olive.rifle.y };
    base = { x: WEAPON_PRESET_SIZE[kind]!.x * f.x, y: WEAPON_PRESET_SIZE[kind]!.y * f.y };
  } else base = { x: 1, y: 1 };
  const size = { x: base.x * (sizeMul?.x ?? 1), y: base.y * (sizeMul?.y ?? 1) };
  const spec = { scheme, seed: 31, wear: 0.3, camo: false, twoTone: partBaseline('head', family).twoTone, size , blockShape: BLOCK_SHAPE_STD };
  const A = renderWeaponCombo(cv, spec, combo, origin);
  finishRender(cv, A, finFor(family, scheme, finOv));
  return cropSprite(cv, origin);
}

export type { WeaponKind };
export { WEAPON_PRESETS, WEAPON_AXIS_OPTIONS, weaponComboSteps } from './gear';
export type { WeaponCombo, WeaponClass } from './gear';
