/**
 * 臂模板数据层：臂的节点图（ARM_GRAPH 步列）与部件记录数据
 * （ARM_GEOM）全住这里。记录是 ArmPart 的数据形态，数值是「规格
 * 单位」——scl 标注每个字段展开时乘哪个规格量（b = bulk、
 * sh = shell、foreLen/upperLen = 段长），未标注的字段原值直用。
 * 展开器（engine 的 armIR）只按图走、调算子，不存臂的装配决定。
 */
import type { ArmPart } from './engine';

export type ArmScale = 'b' | 'sh' | 'foreLen' | 'upperLen';
export type APart = ArmPart & { scl?: Record<string, ArmScale> };

export const ARM_GEOM = {
  /** 段核宽 [根, 末]（bulk 单位，coreRun 算子按 3 段插值） */
  coreW: { upper: [30, 26], fore: [26, 20] } as Record<'upper' | 'fore', [number, number]>,
  /** 段板宽 [根, 末]（bulk 单位，plateRun 算子按长度分段插值） */
  plateW: { upper: [56, 50], fore: [58, 43] } as Record<'upper' | 'fore', [number, number]>,
  /** 肩盘半径缺省 [外, 毂]（bulk 单位；规格 shoulderDisc 覆盖） */
  discStd: [15, 8.5] as [number, number],
  /** 掌锚自腕沿前臂向外推的距离 */
  palmOff: 18,
  /** 前臂整壳板（housing 式）：宽 [根, 末]（bulk 单位）+ 外鼓 */
  housingPlate: { w0: 56, w1: 46, bulge: 0.12 },
  /** 腕环带宽（bulk 单位）：整壳式略宽 */
  wristBandW: { housing: 47.5, std: 44.5 },
  /** 肩钟主块（cap 式）：色角色由规格 shellRole 数据给 */
  shellMain: { along: -4, perp: 0, w: 82, h: 64, angOff: -0.04, cham: 0.62, faceW: 5 },
  /** 肩穹散热槽列（slots 面板）：沿臂轴的偏移列 + 槽尺寸（shell 单位） */
  slotsRun: { das: [-9, 0, 9], baseAlong: 3, w: 24, h: 4 },
  /** 关节内构衬底：三处关节的段端核领（盘嵌暗内构、背面不透光） */
  collars: [
    { t: 'segCore', seg: 'upper', w0: 42, w1: 40, s0: -0.02, s1: 0.09, scl: { w0: 'b', w1: 'b' } },
    { t: 'segCore', seg: 'upper', w0: 40, w1: 44, s0: 0.9, s1: 1.0, scl: { w0: 'b', w1: 'b' } },
    { t: 'segCore', seg: 'fore', w0: 44, w1: 40, s0: -0.03, s1: 0.09, scl: { w0: 'b', w1: 'b' } },
    { t: 'segCore', seg: 'fore', w0: 38, w1: 36, s0: 0.93, s1: 1.0, scl: { w0: 'b', w1: 'b' } },
  ] as APart[],
  /** 肩框三块（盘座的框衬） */
  shoulderFrame: [
    { t: 'block', frame: 'shoulder', along: -3, perp: 2, w: 44, h: 26, angOff: 0.15, kind: 'frame', scl: { w: 'b', h: 'b' } },
    { t: 'block', frame: 'shoulder', along: 2, perp: 27, w: 14, h: 22, kind: 'frame', scl: { perp: 'b', w: 'b', h: 'b' } },
    { t: 'block', frame: 'shoulder', along: 2, perp: -27, w: 14, h: 22, kind: 'frame', scl: { perp: 'b', w: 'b', h: 'b' } },
  ] as APart[],
  /** 外环粗缆（上臂/前臂各一） */
  cableUpper: [{ t: 'cable', seg: 'upper', perp: 30, sag: 30, r: 6.5, scl: { perp: 'b' } }] as APart[],
  cableFore: [{ t: 'cable', seg: 'fore', perp: 29, sag: 20, r: 6, scl: { perp: 'b' } }] as APart[],
  /** 活塞组：套筒+铬杆只跨肘口（杆连 + 前臂内短栈 + 环节点缀盘） */
  pistonSet: [
    { t: 'rodLink', fromSeg: 'upper', fromS: 0.84, fromPerp: 24, toSeg: 'fore', toS: 0.16, toPerp: 22, r: 4.5, scl: { fromPerp: 'b', toPerp: 'b' } },
    { t: 'rodLink', fromSeg: 'upper', fromS: 0.9, fromPerp: 24, toSeg: 'fore', toS: 0.26, toPerp: 22, r: 2.4, scl: { fromPerp: 'b', toPerp: 'b' } },
    { t: 'rod', seg: 'fore', perp: 24, s0: 0.05, s1: 0.24, r: 4, scl: { perp: 'b' } },
    { t: 'rod', seg: 'fore', perp: 24, s0: 0.24, s1: 0.36, r: 2.2, scl: { perp: 'b' } },
    { t: 'discAt', frame: 'fore', along: 0.05, perp: 24, r: 5, scl: { along: 'foreLen', perp: 'b' } },
    { t: 'discAt', frame: 'fore', along: 0.24, perp: 24, r: 4.5, scl: { along: 'foreLen', perp: 'b' } },
  ] as APart[],
  /** 肘三式 */
  elbowRing: [
    { t: 'block', frame: 'fore', along: 0, perp: 0, w: 23, h: 23, kind: 'frame', scl: { w: 'b', h: 'b' } },
    { t: 'disc', at: 'elbow', r: 15.5, scl: { r: 'b' } },
    { t: 'disc', at: 'elbow', r: 9, scl: { r: 'b' } },
  ] as APart[],
  elbowSmall: [
    { t: 'disc', at: 'elbow', r: 8.5, scl: { r: 'b' } },
    { t: 'block', frame: 'fore', along: -4, perp: 0, w: 30, h: 24, kind: 'plate', cham: 0.5, scl: { w: 'b', h: 'b' } },
  ] as APart[],
  elbowDisc: [
    { t: 'disc', at: 'elbow', r: 15.5, scl: { r: 'b' } },
    { t: 'disc', at: 'elbow', r: 9, scl: { r: 'b' } },
  ] as APart[],
  /** 前臂肘口两侧框块 */
  foreSides: [
    { t: 'block', frame: 'fore', along: 0, perp: 19, w: 15, h: 24, kind: 'frame', scl: { perp: 'b', w: 'b', h: 'b' } },
    { t: 'block', frame: 'fore', along: 0, perp: -19, w: 15, h: 24, kind: 'frame', scl: { perp: 'b', w: 'b', h: 'b' } },
  ] as APart[],
  /** 前臂设备组（框 + 板 + 光点，落点沿前臂 0.45 处） */
  deviceSet: [
    { t: 'block', frame: 'fore', along: 0.45, perp: -26, w: 20, h: 26, kind: 'frame', scl: { along: 'foreLen', perp: 'b' } },
    { t: 'block', frame: 'fore', along: 0.45, perp: -27, w: 13, h: 18, kind: 'plate', scl: { along: 'foreLen', perp: 'b' } },
    { t: 'light', frame: 'fore', along: 0.45, perp: -30, scl: { along: 'foreLen', perp: 'b' } },
  ] as APart[],
  /** 腕组：暗腕层 + 腕盘 + 掌块 + 掌背板 */
  wristSet: [
    { t: 'block', frame: 'wrist', along: 5, perp: 0, w: 32, h: 13, kind: 'frame', scl: { w: 'b' } },
    { t: 'disc', at: 'wrist', r: 8.5, scl: { r: 'b' } },
    { t: 'disc', at: 'wrist', r: 4.5, scl: { r: 'b' } },
    { t: 'block', frame: 'wrist', along: 16, perp: 0, w: 44, h: 30, kind: 'plate', bolts: true, scl: { w: 'b', h: 'b' } },
    { t: 'block', frame: 'wrist', along: 13, perp: 3, w: 30, h: 20, kind: 'plate', scl: { w: 'b', h: 'b' } },
  ] as APart[],
  /** 爪手两枚 */
  clawSet: [
    { t: 'block', frame: 'wrist', along: 34, perp: -12, w: 10, h: 22, angOff: 0.3, kind: 'plate' },
    { t: 'block', frame: 'wrist', along: 34, perp: 12, w: 10, h: 22, angOff: -0.3, kind: 'plate' },
  ] as APart[],
  /** 肩钟（cap 式）主块之下的两块（后裙 + 下挂子板） */
  shellCapSides: [
    { t: 'block', frame: 'shoulder', along: -38, perp: 0, w: 68, h: 20, angOff: -0.03, kind: 'plate', cham: 0.5, faceW: 4, scl: { w: 'sh', h: 'sh' } },
    { t: 'block', frame: 'shoulder', along: 17, perp: 0, w: 56, h: 30, angOff: 0.02, kind: 'plate', cham: 0.4, faceW: 4, scl: { w: 'sh', h: 'sh' } },
  ] as APart[],
  /** 肩面凹窗（window 面板）：嵌框块 + 框内上沿单式 */
  shellWindow: [
    { t: 'block', frame: 'shoulder', along: -6, perp: -3, w: 23, h: 19, kind: 'plate', inset: { fw: 14 / 23, fh: 10 / 19 }, scl: { w: 'sh', h: 'sh' } },
    { t: 'block', frame: 'shoulder', along: -9.5, perp: -3, w: 11, h: 3, kind: 'plate', role: 'armor2', scl: { w: 'sh', h: 'sh' } },
  ] as APart[],
  /** 肩穹白面板（slots 面板）：嵌框面板 + 槽列上方橙线（槽列走 slotsRun 步） */
  shellSlotsPanel: [
    { t: 'block', frame: 'shoulder', along: -2, perp: 0, w: 46, h: 42, angOff: -0.04, kind: 'plate', cham: 0.3, role: 'armor', faceW: 4, inset: { fw: 0.8, fh: 0.8 }, scl: { w: 'sh', h: 'sh' } },
    { t: 'block', frame: 'shoulder', along: -13, perp: 0, w: 26, h: 4, kind: 'plate', role: 'accent', scl: { w: 'sh', h: 'sh' } },
  ] as APart[],
  /** 肩箱（box 式）三块 */
  shellBox: [
    { t: 'block', frame: 'shoulder', along: -8, perp: 0, w: 104, h: 62, angOff: -0.05, kind: 'plate', bolts: true, faceW: 5, scl: { w: 'sh', h: 'sh' } },
    { t: 'block', frame: 'shoulder', along: -36, perp: 0, w: 84, h: 22, angOff: -0.03, kind: 'plate', faceW: 3, scl: { w: 'sh', h: 'sh' } },
    { t: 'block', frame: 'shoulder', along: 6, perp: -42, w: 28, h: 44, angOff: 0.12, kind: 'plate', scl: { perp: 'sh', w: 'sh', h: 'sh' } },
  ] as APart[],
};

/** 图步条件（数据）：点路径对规格求值——等值/不等/真值/存在/全合取 */
export type ArmWhen =
  | { path: string; eq?: string; neq?: string; truthy?: true; present?: true }
  | { all: ArmWhen[] };

export interface ArmStep {
  op: 'coreRun' | 'plateRun' | 'parts' | 'shoulderDiscs' | 'foreHousing' | 'foreBand' | 'wristBand' | 'fist' | 'shellMain' | 'slotsRun' | 'insignia';
  seg?: 'upper' | 'fore';
  list?: string;
  when?: ArmWhen;
}

/** 臂模板（DAG 数据）：步列序 = 画序——式与装备的选择全在 when 数据里 */
export const ARM_GRAPH: ArmStep[] = [
  { op: 'coreRun' },
  { op: 'parts', list: 'collars' },
  { op: 'parts', list: 'shoulderFrame' },
  { op: 'shoulderDiscs' },
  { op: 'plateRun', seg: 'upper' },
  { op: 'parts', list: 'cableUpper', when: { path: 'gear.cable', truthy: true } },
  { op: 'parts', list: 'pistonSet', when: { path: 'gear.piston', truthy: true } },
  { op: 'parts', list: 'cableFore', when: { path: 'gear.cable', truthy: true } },
  { op: 'parts', list: 'elbowRing', when: { path: 'form.elbow', eq: 'ring' } },
  { op: 'parts', list: 'elbowSmall', when: { path: 'form.elbow', eq: 'small' } },
  { op: 'parts', list: 'elbowDisc', when: { path: 'form.elbow', eq: 'disc' } },
  { op: 'parts', list: 'foreSides' },
  { op: 'foreHousing', when: { path: 'form.fore', eq: 'housing' } },
  { op: 'plateRun', seg: 'fore', when: { path: 'form.fore', neq: 'housing' } },
  { op: 'parts', list: 'deviceSet', when: { path: 'gear.device', truthy: true } },
  { op: 'foreBand', when: { path: 'foreBand', present: true } },
  { op: 'wristBand' },
  { op: 'parts', list: 'wristSet' },
  { op: 'fist', when: { path: 'hand', eq: 'fist' } },
  { op: 'parts', list: 'clawSet', when: { path: 'hand', eq: 'claw' } },
  { op: 'shellMain', when: { path: 'form.shell', eq: 'cap' } },
  { op: 'parts', list: 'shellCapSides', when: { path: 'form.shell', eq: 'cap' } },
  { op: 'parts', list: 'shellWindow', when: { all: [{ path: 'form.shell', eq: 'cap' }, { path: 'shoulderPanel', eq: 'window' }] } },
  { op: 'parts', list: 'shellSlotsPanel', when: { all: [{ path: 'form.shell', eq: 'cap' }, { path: 'shoulderPanel', eq: 'slots' }] } },
  { op: 'slotsRun', when: { all: [{ path: 'form.shell', eq: 'cap' }, { path: 'shoulderPanel', eq: 'slots' }] } },
  { op: 'parts', list: 'shellBox', when: { path: 'form.shell', neq: 'cap' } },
  { op: 'insignia', when: { path: 'insignia', present: true } },
];
