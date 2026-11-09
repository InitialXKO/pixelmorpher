// ============================================================
// 机甲条目调用口：模式库机甲条目（library-entries 的 MechaEntryDef）
// → 现行机甲生成器出精灵。输出按名取（与表面条目的 outputs 同理）。
// 着色是独立模式：机甲条目以 finish 钉版引用着色条目，调用时解析
// 为着色参数打底，def.overrides 的同名字段后覆写（实例选择优先）。
// 条目钉 id@版本消费走 renderMechaEntry；def 直调走 renderMechaDef。
// ============================================================

import {
  mechaDefOf, finishDefOf, surfaceDefOf, parseRefId,
  type LibraryIndex, type MechaEntryDef, type MechaGenDef, type FinishEntryDef, type FinishPass, type FinishPassParams,
} from '../library-entries';
import { applySurface, type SurfaceChoice } from './surface';
import {
  generateMechaPartSet, generateMechaHull, generateMechaHullBody, generateMechaTurret,
  generateMechaMultiLeg, generateMechaMultiLegParts, generateMechaTrackUnit,
  generateMechaWheelLeg, generateMechaWheelLegParts, generateMechaJetpack, generateMechaWeapon,
  type MechaSpriteData, type MechaFinishOv, type MechaPartOverrides,
} from './parts';

export type MechaEntryOutputs = Record<string, MechaSpriteData>;

  /** 一个着色算子（pass）+ 参数 → 扁平着色参数的对应字段 */
function applyPass(ov: MechaFinishOv, pass: FinishPass, p: FinishPassParams): void {
  switch (pass) {
    case 'ridges': if (p.enabled !== undefined) ov.ridges = p.enabled; break;
    case 'seam': if (p.enabled !== undefined) ov.seams = p.enabled; break;
    case 'thickness': if (p.ratio !== undefined) ov.thickRatio = p.ratio; break;
    case 'intake': ov.intake = { rim: p.rim, pitch: p.pitch, peak: p.peak, fall: p.fall, accentSlats: p.accentSlats, topTone: p.topTone, topGrad: p.topGrad }; break;
    case 'wear': if (p.amount !== undefined) ov.wear = p.amount; break;
    case 'camo': if (p.enabled !== undefined) ov.camo = p.enabled; break;
    case 'facets': if (p.twoTone !== undefined) ov.twoTone = p.twoTone; break;
    case 'shell': if (p.enabled !== undefined) ov.shellMode = p.enabled; break;
    case 'stamps': if (p.decalKind !== undefined) ov.decalKind = p.decalKind; break;
    case 'panel': if (p.detail !== undefined) ov.detail = p.detail; ov.wedges = 0; break;
    case 'wedges': if (p.density !== undefined) ov.wedges = p.density; break;
    case 'cables': if (p.tint !== undefined) ov.cableTint = p.tint; break;
  }
}

/** 着色条目展开：组合 → 算子条目逐个解析（组合可嵌组合，环引用止步）
 *  → 现行扁平着色参数（与动态父模式展开同一纪律，求值层零改动） */
export function expandFinishDef(
  index: LibraryIndex, def: FinishEntryDef, seen: ReadonlySet<string> = new Set(),
): MechaFinishOv {
  const ov: MechaFinishOv = {};
  if (def.form === 'pass') {
    applyPass(ov, def.pass, def.params);
    return ov;
  }
  for (const part of def.parts) {
    const key = `${part.entry}@${part.version}`;
    if (seen.has(key)) continue;
    const got = finishDefOf(index, part.entry, part.version);
    if (!got) continue;
    const sub = expandFinishDef(index, got.def, new Set([...seen, key]));
    Object.assign(ov, sub);
    // 组合侧的参数覆写盖子模式条目自带参数
    if (part.params && got.def.form === 'pass') applyPass(ov, got.def.pass, part.params);
  }
  return ov;
}

/** 按 gen 式 def 出图（finOv = 已解析的着色参数、surfChoice =
 * 已解析的表面材质，可缺省）；表面材质作用于全部 gen 的输出 */
export function renderMechaDef(def: MechaGenDef, finOv?: MechaFinishOv, surfChoice?: SurfaceChoice): MechaEntryOutputs {
  const outs = renderMechaDefRaw(def, finOv);
  if (surfChoice) for (const spr of Object.values(outs)) applySurface(spr, surfChoice);
  return outs;
}

function renderMechaDefRaw(def: MechaGenDef, finOv?: MechaFinishOv): MechaEntryOutputs {
  const scheme = def.scheme ?? def.overrides?.scheme;
  switch (def.gen) {
    case 'leg': case 'arm': case 'torso': case 'head': case 'hand': {
      const ov: MechaPartOverrides = { ...def.overrides };
      if (scheme) ov.scheme = scheme;
      if (finOv) {
        // 通面（磨损/迷彩/双色调）进每个部件覆盖；腿另有细节/壳面/
        // 高光棱/贴花/缆色的专属通道（腿的双色调走族基线、无覆盖口）。
        // 只写有值的字段：undefined 写进覆盖会把族基线冲掉。
        const pick = <T extends object>(o: T): T => Object.fromEntries(
          Object.entries(o).filter(([, v]) => v !== undefined)) as T;
        const common = pick({ wear: finOv.wear, camo: finOv.camo, twoTone: finOv.twoTone });
        ov.leg = {
          ...pick({
            wear: finOv.wear, camo: finOv.camo, detail: finOv.detail, shellMode: finOv.shellMode,
            ridges: finOv.ridges, thickRatio: finOv.thickRatio, wedges: finOv.wedges, decalKind: finOv.decalKind, cableTint: finOv.cableTint, intake: finOv.intake,
          }),
          ...ov.leg,
        };
        ov.arm = { ...common, ...ov.arm };
        ov.torso = { ...common, ...ov.torso };
        ov.head = { ...common, ...ov.head };
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
          ...(finOv.wedges !== undefined ? { wedges: finOv.wedges } : {}),
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

/** 解析 gen 式 def 的着色引用 → 扁平着色参数（引用失效退回族基线） */
function resolveFinishOv(index: LibraryIndex, def: MechaGenDef): MechaFinishOv | undefined {
  if (!def.finish) return undefined;
  const fr = parseRefId(def.finish);
  const fgot = finishDefOf(index, fr.id, fr.version);
  return fgot ? expandFinishDef(index, fgot.def) : undefined;
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
  if (def.form === 'gen') return renderMechaDef(def, resolveFinishOv(index, def), resolveSurfaceChoice(index, def));
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
