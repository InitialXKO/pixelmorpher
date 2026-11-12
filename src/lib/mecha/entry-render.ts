// ============================================================
// 机甲条目调用口：模式库机甲条目（library-entries 的 MechaEntryDef）
// → 现行机甲生成器出精灵。输出按名取（与表面条目的 outputs 同理）。
// 着色是独立模式：机甲条目以 finish 钉版引用着色条目，调用时解析
// 为着色参数打底，def.overrides 的同名字段后覆写（实例选择优先）。
// 条目钉 id@版本消费走 renderMechaEntry；def 直调走 renderMechaDef。
// ============================================================

import {
  mechaDefOf, finishDefOf, faceOpDefOf, surfaceDefOf, parseRefId,
  type LibraryIndex, type MechaEntryDef, type MechaGenDef, type FinishEntryDef,
  type FaceOpEntryDef, type StepOp, type StepParams,
} from '../library-entries';
import { applySurface, type SurfaceChoice } from './surface';
import {
  generateMechaPartSet, generateMechaHull, generateMechaHullBody, generateMechaTurret,
  generateMechaMultiLeg, generateMechaMultiLegParts, generateMechaTrackUnit,
  generateMechaWheelLeg, generateMechaWheelLegParts, generateMechaJetpack, generateMechaWeapon,
  type MechaSpriteData, type MechaFinishOv, type MechaPartOverrides, type MechaHeadOverrides,
} from './parts';

export type MechaEntryOutputs = Record<string, MechaSpriteData>;

/** 步：展开产物（组合图摊成有序步列，结构保留到消费端，不再在
 * 展开终点摊成扁平包）。一步 = 一个算子 + 它的参数 */
export interface Step { op: StepOp; params: StepParams }

/** 步的折叠目标：着色覆盖 + 头部覆盖两份。算子写哪一份由算子
 * 本体决定（那是它的输出性质），步列本身不分组——任何步列
 * 模式都可以引用任何算子作叶子 */
export interface StepFold { fin: MechaFinishOv; head: MechaHeadOverrides }

/** 步算子注册表（唯一一份）：算子名 → 本体。按名分发、无
 * switch；Record 键集由类型保证与 StepOp 词表齐全，漏一个
 * 算子编译不过。算子只按本质区分（见 STEP_OP_ESSENCE），
 * 不按用途分、没有家族 */
const STEP_OPS: Record<StepOp, (ctx: StepFold, p: StepParams) => void> = {
  ridges: (ctx, p) => { if (p.enabled !== undefined) ctx.fin.ridges = p.enabled; },
  outline: (ctx, p) => { if (p.enabled !== undefined) ctx.fin.outline = p.enabled; },
  darkrim: (ctx, p) => { if (p.amount !== undefined) ctx.fin.darkRim = p.amount; },
  blackgap: (ctx, p) => { if (p.amount !== undefined) ctx.fin.blackGap = p.amount; },
  seam: (ctx, p) => { if (p.enabled !== undefined) ctx.fin.seams = p.enabled; },
  thickness: (ctx, p) => { if (p.ratio !== undefined) ctx.fin.thickRatio = p.ratio; },
  intake: (ctx, p) => { ctx.fin.intake = { rim: p.rim, pitch: p.pitch, peak: p.peak, fall: p.fall, accentSlats: p.accentSlats, topTone: p.topTone, topGrad: p.topGrad, slatTone: p.slatTone, slatBlue: p.slatBlue }; },
  wear: (ctx, p) => { if (p.amount !== undefined) ctx.fin.wear = p.amount; },
  camo: (ctx, p) => { if (p.enabled !== undefined) ctx.fin.camo = p.enabled; },
  facets: (ctx, p) => { if (p.twoTone !== undefined) ctx.fin.twoTone = p.twoTone; },
  shell: (ctx, p) => { if (p.enabled !== undefined) ctx.fin.shellMode = p.enabled; },
  stamps: (ctx, p) => { if (p.decalKind !== undefined) ctx.fin.decalKind = p.decalKind; },
  panel: (ctx, p) => { if (p.detail !== undefined) ctx.fin.detail = p.detail; },
  cables: (ctx, p) => { if (p.tint !== undefined) ctx.fin.cableTint = p.tint; },
  boltframe: (ctx, p) => { if (p.frameShape !== undefined) ctx.fin.boltFrame = p.frameShape; },
  boltcore: (ctx, p) => { if (p.coreForm !== undefined) ctx.fin.boltCore = p.coreForm; },
  hubgroove: (ctx, p) => { if (p.enabled !== undefined) ctx.fin.hubGroove = p.enabled; },
  hubframe: (ctx, p) => { if (p.hubShape !== undefined) ctx.fin.hubFrame = p.hubShape; },
  descent: (ctx, p) => { if (p.crown !== undefined) (ctx.head.form ??= {}).crown = p.crown; if (p.shellStep !== undefined) ctx.head.shellStep = p.shellStep; },
  seat: (ctx, p) => { if (p.brow !== undefined) (ctx.head.form ??= {}).brow = p.brow; if (p.browForm !== undefined) ctx.head.browForm = p.browForm; if (p.seatH !== undefined) ctx.head.seatH = p.seatH; },
  glow: (ctx, p) => { if (p.eye !== undefined) (ctx.head.form ??= {}).eye = p.eye; if (p.slitEnd !== undefined) ctx.head.slitEnd = p.slitEnd; if (p.glowPeak !== undefined) ctx.head.glowPeak = p.glowPeak; },
  lines: (ctx, p) => { if (p.shellSeams !== undefined) ctx.head.shellSeams = p.shellSeams; if (p.cheekLines !== undefined) ctx.head.cheekLines = p.cheekLines; if (p.seamScale !== undefined) ctx.head.seamScale = p.seamScale; },
  band: (ctx, p) => { if (p.crownBand !== undefined) ctx.head.crownBand = p.crownBand; if (p.faceStripe !== undefined) ctx.head.faceStripe = p.faceStripe; },
  cheek: (ctx, p) => { if (p.ear !== undefined) (ctx.head.form ??= {}).ear = p.ear; if (p.cheekCable !== undefined) (ctx.head.form ??= {}).cheekCable = p.cheekCable; if (p.temple !== undefined) ctx.head.templeDisc = p.temple === 'disc'; },
  jaw: (ctx, p) => { if (p.jaw !== undefined) (ctx.head.form ??= {}).jaw = p.jaw; if (p.tubeSeg !== undefined) ctx.head.tubeSeg = p.tubeSeg; if (p.descent !== undefined) ctx.head.faceDescent = p.descent; },
  top: (ctx, p) => { if (p.top !== undefined) (ctx.head.form ??= {}).top = p.top; if (p.topSeg !== undefined) ctx.head.topSeg = p.topSeg; if (p.finBrow !== undefined) ctx.head.finBrow = p.finBrow; },
  tip: (ctx, p) => { if (p.chinTip !== undefined) ctx.head.chinTip = p.chinTip; if (p.tipScale !== undefined) ctx.head.chinTipScale = p.tipScale; },
  facet: (ctx, p) => { if (p.twoTone !== undefined) ctx.head.twoTone = p.twoTone; if (p.altTone !== undefined) ctx.head.altTone = p.altTone; },
};

/** 步算子缺省参数（注册表一份）：模式步只引用算子并给覆写，
 * 缺省在此——与 surface-ops 的参数规格带缺省值同一形态 */
export const STEP_OP_DEFAULTS: Record<StepOp, StepParams> = {
  ridges: { enabled: true },
  outline: { enabled: true },
  darkrim: { amount: 0.22 },
  blackgap: { amount: 0.7 },
  seam: { enabled: true },
  thickness: { ratio: 0.32 },
  intake: { topTone: 1.42, topGrad: 0.12, rim: 0.1, pitch: 7, peak: 0.75, fall: 0.22, accentSlats: false },
  wear: { amount: 0.3 },
  camo: { enabled: true },
  facets: { twoTone: true },
  shell: { enabled: true },
  stamps: { decalKind: 'num' },
  panel: { detail: 0.65 },
  cables: {},
  boltframe: { frameShape: 'none' },
  boltcore: { coreForm: 'dome' },
  hubgroove: { enabled: false },
  hubframe: { hubShape: 'square' },
  descent: { crown: 'dome' },
  seat: { brow: true },
  glow: { eye: 'slit' },
  lines: { shellSeams: false, cheekLines: false },
  band: { faceStripe: false },
  cheek: { ear: 'plate' },
  jaw: { jaw: 'block' },
  top: { top: 'none' },
  tip: { chinTip: false },
  facet: { twoTone: false },
};

/** 步算子的本质分类（只活在注册表一侧、不进条目 kind）：
 * 着色管线那批与发光/平行线组/随形带/点色/刻面档是着色叶子
 * （在既有几何上作画）；降式/檐座/颊单元/颌式/顶附属是轮廓
 * 叶子（产出几何） */
export const STEP_OP_ESSENCE: Record<StepOp, 'contour' | 'shading'> = {
  ridges: 'shading', outline: 'shading', darkrim: 'shading', blackgap: 'shading',
  seam: 'shading', thickness: 'shading', intake: 'shading', wear: 'shading',
  camo: 'shading', facets: 'shading', shell: 'shading', stamps: 'shading',
  panel: 'shading', cables: 'shading', boltframe: 'shading',
  boltcore: 'shading', hubgroove: 'shading', hubframe: 'shading',
  descent: 'contour', seat: 'contour', cheek: 'contour', jaw: 'contour', top: 'contour',
  glow: 'shading', lines: 'shading', band: 'shading', tip: 'shading', facet: 'shading',
};

/** 步列模式展开为步列：每步先落注册表缺省步、再落模式的覆写步
 * （走步时同字段后写胜出，form 子对象逐字段同理）——着色模式
 * 与面部模式共用这一份展开，步可以引用词表里的任何算子 */
export function expandSteps(def: FinishEntryDef | FaceOpEntryDef): Step[] {
  const steps: Step[] = [];
  for (const s of def.steps) {
    steps.push({ op: s.op, params: STEP_OP_DEFAULTS[s.op] });
    if (s.params) steps.push({ op: s.op, params: s.params });
  }
  return steps;
}

/** 走步：按步列次序逐个调用算子本体，产出双份覆盖 */
export function applySteps(steps: readonly Step[]): StepFold {
  const ctx: StepFold = { fin: {}, head: {} };
  for (const s of steps) STEP_OPS[s.op](ctx, s.params);
  return ctx;
}

/** 展开取着色份（兼容口）：步列展开 → 走步 → 着色覆盖 */
export function expandFinishDef(def: FinishEntryDef | FaceOpEntryDef): MechaFinishOv {
  return applySteps(expandSteps(def)).fin;
}

/** 展开取头部份（兼容口）：步列展开 → 走步 → 头部覆盖 */
export function expandFaceDef(def: FinishEntryDef | FaceOpEntryDef): MechaHeadOverrides {
  return applySteps(expandSteps(def)).head;
}

/** 按 gen 式 def 出图（finOv = 已解析的着色参数、surfChoice =
 * 已解析的表面材质、faceOv = 已解析的面部覆盖，可缺省）；表面材质作用于全部 gen 的输出 */
export function renderMechaDef(def: MechaGenDef, finOv?: MechaFinishOv, surfChoice?: SurfaceChoice, faceOv?: MechaHeadOverrides): MechaEntryOutputs {
  const outs = renderMechaDefRaw(def, finOv, faceOv);
  if (surfChoice) for (const spr of Object.values(outs)) applySurface(spr, surfChoice);
  return outs;
}

function renderMechaDefRaw(def: MechaGenDef, finOv?: MechaFinishOv, faceOv?: MechaHeadOverrides): MechaEntryOutputs {
  const scheme = def.scheme ?? def.overrides?.scheme;
  switch (def.gen) {
    case 'leg': case 'arm': case 'torso': case 'head': case 'hand': {
      const ov: MechaPartOverrides = { ...def.overrides };
      if (scheme) ov.scheme = scheme;
      // 面部覆盖打底（仅头部消费）：def.overrides.head 在其上覆写，
      // form 子对象逐字段合并——面部组合给的 form 是十个算子各出一
      // 块的拼合，整体替换会把没覆到的算子字段冲掉
      if (faceOv) ov.head = { ...faceOv, ...ov.head, form: { ...faceOv.form, ...ov.head?.form } };
      if (finOv) {
        // 通面（磨损/迷彩/双色调）进每个部件覆盖；腿另有细节/壳面/
        // 高光棱/贴花/缆色的专属通道（腿的双色调走族基线、无覆盖口）。
        // 只写有值的字段：undefined 写进覆盖会把族基线冲掉。
        const pick = <T extends object>(o: T): T => Object.fromEntries(
          Object.entries(o).filter(([, v]) => v !== undefined)) as T;
        const common = pick({ wear: finOv.wear, camo: finOv.camo, twoTone: finOv.twoTone });
        const boltHub = pick({ boltFrame: finOv.boltFrame, boltCore: finOv.boltCore, hubGroove: finOv.hubGroove, hubFrame: finOv.hubFrame });
        ov.leg = {
          ...pick({
            // 迷彩不从着色组合通面进腿：全池人形腿皆净面（主战池
            // 图腿无迷彩、重型/敏捷同），迷彩进腿只会把小腿小板面
            // 整段翻成副色（M 轮反向检查实证）。腿要迷彩只能由腿
            // 自身覆盖显式开（下方 ...ov.leg 仍可给）
            wear: finOv.wear, detail: finOv.detail, shellMode: finOv.shellMode,
            ridges: finOv.ridges, thickRatio: finOv.thickRatio, decalKind: finOv.decalKind, cableTint: finOv.cableTint, intake: finOv.intake,
          }),
          ...boltHub,
          ...ov.leg,
        };
        ov.arm = { ...common, ...boltHub, ...ov.arm };
        // 胸进气口是躯干的专属着色通道（与腿同级）：着色组合的
        // intake 步参数（叶片材质等）必须达躯干 finish，否则步
        // 参数对躯干是死数据（N 轮躯干对照实证：主战叶片色走
        // 族基线 slatBlue、组合的 accentSlats 不达）
        ov.torso = { ...pick({ intake: finOv.intake }), ...common, ...boltHub, ...ov.torso };
        ov.head = { ...common, ...boltHub, ...ov.head };
      }
      const set = generateMechaPartSet(def.family, undefined, ov);
      if (def.gen === 'leg') return { leg: set.leg, thigh: set.legThigh, shin: set.legShin, foot: set.legFoot, ...(set.hipBeam ? { beam: set.hipBeam } : {}) };
      if (def.gen === 'arm') return { upper: set.armUpper, fore: set.armFore, hand: set.armHand };
      if (def.gen === 'torso') return { torso: set.torso };
      if (def.gen === 'head') return { head: set.head };
      return { hand: set.armHand };
    }
    case 'hull': {
      const kind = def.hullKind ?? 'walker';
      const hov = finOv
        ? {
          ...(finOv.wear !== undefined ? { wear: finOv.wear } : {}),
          ...(finOv.camo !== undefined ? { camo: finOv.camo } : {}),
          ...(finOv.twoTone !== undefined ? { twoTone: finOv.twoTone } : {}),
          ...def.hullOverrides,
        }
        : def.hullOverrides;
      return {
        hull: generateMechaHull(kind, hov, def.scheme),
        body: generateMechaHullBody(kind, hov, def.scheme),
        turret: generateMechaTurret(kind, hov, def.scheme),
      };
    }
    case 'multileg': {
      const profile = def.profile ?? 'spider';
      const parts = generateMechaMultiLegParts(def.family, profile, def.scheme, finOv);
      return {
        leg: generateMechaMultiLeg(def.family, profile, def.scheme, finOv),
        upper: parts.upper, mid: parts.mid, foot: parts.foot,
      };
    }
    case 'track':
      return { unit: generateMechaTrackUnit(def.family, { scheme: def.scheme, ...finOv }) };
    case 'wheel': {
      const legOv = finOv
        ? {
          ...(finOv.wear !== undefined ? { wear: finOv.wear } : {}),
          ...(finOv.camo !== undefined ? { camo: finOv.camo } : {}),
          ...(finOv.detail !== undefined ? { detail: finOv.detail } : {}),
          ...(finOv.shellMode !== undefined ? { shellMode: finOv.shellMode } : {}),
          ...(finOv.ridges !== undefined ? { ridges: finOv.ridges } : {}),
          ...(finOv.thickRatio !== undefined ? { thickRatio: finOv.thickRatio } : {}),
          ...(finOv.intake !== undefined ? { intake: finOv.intake } : {}),
          ...(finOv.decalKind !== undefined ? { decalKind: finOv.decalKind } : {}),
          ...(finOv.cableTint !== undefined ? { cableTint: finOv.cableTint } : {}),
          ...def.overrides?.leg,
        }
        : def.overrides?.leg;
      const parts = generateMechaWheelLegParts(def.family, legOv, def.scheme);
      return { leg: generateMechaWheelLeg(def.family), thigh: parts.thigh, shin: parts.shin, foot: parts.foot };
    }
    case 'jetpack':
      return { jetpack: generateMechaJetpack(def.family, def.scheme, finOv) };
    case 'weapon':
      return { weapon: generateMechaWeapon(def.family, def.weaponKind ?? 'cannon', def.scheme, undefined, finOv) };
  }
}

/** 解析 gen 式 def 的两个步列引用 → 双份折叠。步列模式的步可以
 * 引用任何算子，所以着色钉里的步也能写头部覆盖、面部钉里的步
 * 也能写着色覆盖——两份折叠都要算，合并时专用钉优先 */
function resolveStepFolds(index: LibraryIndex, def: MechaGenDef): { finFold?: StepFold; faceFold?: StepFold } {
  let finFold: StepFold | undefined;
  let faceFold: StepFold | undefined;
  if (def.finish) {
    const fr = parseRefId(def.finish);
    const got = finishDefOf(index, fr.id, fr.version);
    if (got) finFold = applySteps(expandSteps(got.def));
  }
  if (def.face) {
    const fr = parseRefId(def.face);
    const got = faceOpDefOf(index, fr.id, fr.version);
    if (got) faceFold = applySteps(expandSteps(got.def));
  }
  return { finFold, faceFold };
}

/** 解析着色覆盖：面部钉的着色份打底、着色钉的着色份覆写
 * （引用全失效时退回族基线） */
function resolveFinishOv(index: LibraryIndex, def: MechaGenDef): MechaFinishOv | undefined {
  const { finFold, faceFold } = resolveStepFolds(index, def);
  if (!finFold && !faceFold) return undefined;
  return { ...faceFold?.fin, ...finFold?.fin };
}

/** 解析头部覆盖：着色钉的头部份打底、面部钉的头部份覆写
 * （引用全失效时退回族基线） */
function resolveFaceOv(index: LibraryIndex, def: MechaGenDef): MechaHeadOverrides | undefined {
  const { finFold, faceFold } = resolveStepFolds(index, def);
  if (!finFold && !faceFold) return undefined;
  return { ...finFold?.head, ...faceFold?.head };
}

/** 解析 gen 式 def 的表面材质引用 → 烘焙选择（模板 id + 参数：
 * 条目钉版的参数缺省打底、def.surfaceParams 后覆写） */
function resolveSurfaceChoice(index: LibraryIndex, def: MechaGenDef): SurfaceChoice | undefined {
  if (!def.surface) return undefined;
  const sr = parseRefId(def.surface);
  const sgot = surfaceDefOf(index, sr.id, sr.version);
  if (!sgot) return undefined;
  const params: Record<string, number> = {};
  for (const p of sgot.def.params) params[p.key] = p.def;
  Object.assign(params, def.surfaceParams ?? {});
  return { template: sr.id, params };
}

/** 组合件的 def 覆写（派生变体）：标量字段直换，overrides 逐部件深合并 */
export function applyComboOv(def: MechaGenDef, ov: NonNullable<import('../library-entries').MechaComboPart['ov']>): MechaGenDef {
  const out: MechaGenDef = { ...def };
  if (ov.scheme !== undefined) out.scheme = ov.scheme;
  if (ov.finish !== undefined) out.finish = ov.finish;
  if (ov.face !== undefined) out.face = ov.face;
  if (ov.surface !== undefined) out.surface = ov.surface;
  if (ov.surfaceParams) out.surfaceParams = { ...def.surfaceParams, ...ov.surfaceParams };
  if (ov.hullOverrides) out.hullOverrides = { ...def.hullOverrides, ...ov.hullOverrides };
  if (ov.overrides) {
    const base = def.overrides ?? {};
    const o = ov.overrides;
    out.overrides = {
      ...base, ...o,
      leg: { ...base.leg, ...o.leg }, arm: { ...base.arm, ...o.arm },
      torso: { ...base.torso, ...o.torso }, head: { ...base.head, ...o.head },
    };
  }
  return out;
}

/** 任意机甲 def 出图：gen 式直出；combo 式逐子条目解析出图后合并
 *  （子条目可再嵌 combo；同名输出以 as 前缀区分；环引用止步） */
export function renderEntryDef(
  index: LibraryIndex, def: MechaEntryDef, seen: ReadonlySet<string> = new Set(),
): MechaEntryOutputs {
  if (def.form === 'gen') return renderMechaDef(def, resolveFinishOv(index, def), resolveSurfaceChoice(index, def), resolveFaceOv(index, def));
  const out: MechaEntryOutputs = {};
  for (const part of def.parts) {
    const key = `${part.entry}@${part.version}`;
    if (seen.has(key)) continue;
    const got = mechaDefOf(index, part.entry, part.version);
    if (!got) continue;
    const childDef = part.ov && got.def.form === 'gen' ? applyComboOv(got.def, part.ov) : got.def;
    const childOut = renderEntryDef(index, childDef, new Set([...seen, key]));
    for (const [name, sprite] of Object.entries(childOut)) {
      out[part.as ? `${part.as}.${name}` : name] = sprite;
    }
  }
  return out;
}

/** 按条目引用（'id' 或 'id@版本'）出图；条目不存在/非机甲返回 undefined */
export function renderMechaEntry(
  index: LibraryIndex, ref: string,
): { outputs: MechaEntryOutputs; version: number } | undefined {
  const { id, version } = parseRefId(ref);
  const got = mechaDefOf(index, id, version);
  if (!got) return undefined;
  return { outputs: renderEntryDef(index, got.def), version: got.version };
}
