/**
 * 躯干模板数据层：躯干的节点图（TORSO_GRAPH 步列）、部件记录
 * 数据（TORSO_GEOM）与格栅面线段表（faceSeg/keelUp）全住这里。
 * 记录口径：x 恒为胸宽 W 的分数；y 与纵向尺寸带单位标注
 * （CH = 胸高分数、waist = 腰心 + 腰高分数、pelvis = 胯心 +
 * 胯高分数、WH/PH = 腰/胯高分数、W = 胸宽分数、raw = 原值）。
 * 胸四式的点列在各自装配算子里（engine：chestStackParts 等，
 * 与穹顶算子同档：织法是算子、轮廓参数 P 与规格是数据）。
 */
export type TUnit = 'W' | 'CH' | 'WH' | 'PH' | 'waist' | 'pelvis' | 'raw';
export type TNum = [number, TUnit];

/** 部件记录（数据形态）：几何字段是带单位的数值对，其余字段
 * （kind/cham/role/net/faceW/faceEdges…）原样透传给 TorsoPart */
export interface TPart {
  t: string;
  dx?: TNum; dy?: TNum; w?: TNum; h?: TNum; r?: TNum;
  ax?: TNum; ay?: TNum; bx?: TNum; by?: TNum;
  /** 多边形点列：[x（W 分数）, y, y 单位] */
  pts?: [number, number, TUnit][];
  /** 盒前面点列（同 pts 口径） */
  face?: [number, number, TUnit][];
  /** 缝线列 [x1, y1, x2, y2]（x 为 W 分数、y 按 seamUnit 读） */
  seamLines?: [number, number, number, number][];
  seamUnit?: TUnit;
  /** 裙片收缩变换标记（展开时按规格 skirtShrink 收垂距） */
  shrink?: boolean;
  /** insetCorners 的规格门（值为真才带上） */
  insetCornersWhen?: string;
  [k: string]: unknown;
}

/** 面线段取值源（数据）：轮廓参数键 / 字面值 / 壳中点派生 */
export interface SegSrc { p?: string; lit?: number; off?: number; avgTF?: true; midSub?: 1 }

export const TORSO_GEOM = {
  /** 背挂三式 */
  backBox: [
    { t: 'block', dx: [-0.52, 'W'], dy: [0.4, 'CH'], w: [0.34, 'W'], h: [0.78, 'CH'], faceW: 6 },
    { t: 'grille', dx: [-0.52, 'W'], dy: [0.34, 'CH'], w: [0.26, 'W'], h: [0.4, 'CH'] },
    { t: 'block', dx: [-0.5, 'W'], dy: [0.86, 'CH'], w: [0.3, 'W'], h: [0.2, 'CH'] },
  ] as TPart[],
  backBinder: [
    { t: 'block', dx: [-0.74, 'W'], dy: [1.26, 'CH'], w: [0.52, 'W'], h: [2.6, 'CH'], ang: 0.5, cham: 0.5 },
    { t: 'block', dx: [-0.88, 'W'], dy: [1.29, 'CH'], w: [0.38, 'W'], h: [2.2, 'CH'], ang: 0.5, cham: 0.5 },
    { t: 'block', dx: [-1.32, 'W'], dy: [2.36, 'CH'], w: [0.2, 'W'], h: [0.34, 'CH'], ang: 0.5, kind: 'frame' },
    { t: 'block', dx: [-0.30, 'W'], dy: [0.14, 'CH'], w: [0.28, 'W'], h: [0.045, 'CH'], ang: 0.5, kind: 'frame' },
  ] as TPart[],
  backRack: [
    { t: 'block', dx: [-0.53, 'W'], dy: [0.28, 'CH'], w: [0.44, 'W'], h: [1.12, 'CH'], faceW: 5, role: 'armor2' },
    { t: 'grille', dx: [-0.60, 'W'], dy: [0.14, 'CH'], w: [0.3, 'W'], h: [0.3, 'CH'] },
    { t: 'block', dx: [-0.62, 'W'], dy: [0.40, 'CH'], w: [0.20, 'W'], h: [0.52, 'CH'] },
    { t: 'block', dx: [-0.58, 'W'], dy: [-0.26, 'CH'], w: [0.54, 'W'], h: [0.1, 'CH'], kind: 'frame' },
    { t: 'pipe', ax: [-0.46, 'W'], ay: [-0.24, 'CH'], bx: [-0.44, 'W'], by: [-0.62, 'CH'], r: [2.4, 'raw'], bellows: 6 },
  ] as TPart[],
  /** 颈部斜撑+管道（头颈结合部靠斜撑与管道充实） */
  neckStruts: [
    { t: 'pipe', ax: [-0.30, 'W'], ay: [-0.03, 'CH'], bx: [-0.14, 'W'], by: [0.25, 'CH'], r: [0.05, 'CH'], bellows: 8 },
    { t: 'pipe', ax: [-0.15, 'W'], ay: [-0.03, 'CH'], bx: [-0.03, 'W'], by: [0.23, 'CH'], r: [0.036, 'CH'] },
    { t: 'block', dx: [-0.02, 'W'], dy: [0.13, 'CH'], w: [0.52, 'W'], h: [0.075, 'CH'], ang: 0.40, kind: 'frame' },
  ] as TPart[],
  /** 腰框衬底（加宽至盖住线缆全程） */
  waistFrame: [
    { t: 'block', dx: [-0.04, 'W'], dy: [0, 'waist'], w: [0.86, 'W'], h: [1.6, 'WH'], kind: 'frame' },
  ] as TPart[],
  /** 敏捷腰覆片（斜带主片 + 下段副片；y = 腰心 + 值×腰高，
   * 值已含覆片高 0.78 的折算） */
  waistPlates: [
    { t: 'poly', pts: [[-0.30, -0.6864, 'waist'], [0.20, -0.4056, 'waist'], [0.24, 0.0936, 'waist'], [-0.26, -0.1092, 'waist']], role: 'armor2', tint: 0.95, seamless: true, faceW: 7, faceTone: 0.88, faceEdges: [[3, 2]] },
    { t: 'poly', pts: [[-0.22, 0.2496, 'waist'], [0.15, 0.39, 'waist'], [0.12, 0.8424, 'waist'], [-0.18, 0.7176, 'waist']], role: 'armor2', tint: 0.9, seamless: true, faceW: 7, faceTone: 0.88, faceEdges: [[3, 2]] },
  ] as TPart[],
  /** 覆片式腰的横管（从片间隙里过） */
  waistPipe: [
    { t: 'block', dx: [-0.02, 'W'], dy: [0, 'waist'], w: [0.66, 'W'], h: [7, 'raw'], kind: 'cyl' },
  ] as TPart[],
  /** 腰侧关节盘参数缺省 [下移, 半径]（腰高比；规格 waistDisc 覆盖） */
  waistDiscStd: [0, 0.42] as [number, number],
  /** 躯干衬底（肩盘座圈 + 胸后下角垫块，只在缺口露暗色） */
  backing: [
    { t: 'disc', dx: [-0.2, 'W'], dy: [0.47, 'CH'], r: [0.152, 'W'], kind: 'frame' },
    { t: 'block', dx: [-0.42, 'W'], dy: [0.97, 'CH'], w: [0.24, 'W'], h: [0.36, 'CH'], kind: 'frame' },
  ] as TPart[],
  /** 领圈 */
  collar: [
    { t: 'block', dx: [0, 'raw'], dy: [2, 'raw'], w: [0.52, 'W'], h: [16, 'raw'], kind: 'frame' },
  ] as TPart[],
  /** 肩部楔拱（楔拱算子入参：盘心/内半径（单位口径）+ 四扇区外链） */
  arch: {
    center: [-0.2, 0.47] as [number, number], ri: 0.145,
    sectors: [
      { a0: -140, a1: -40, outer: [[-0.074, 0.234], [-0.246, 0.172], [-0.418, 0.266]] },
      { a0: 140, a1: 220, outer: [[-0.418, 0.266], [-0.457, 0.484], [-0.418, 0.719]], tint: 0.96 },
      { a0: 40, a1: 140, outer: [[-0.418, 0.719], [-0.215, 0.813], [-0.028, 0.719]], tint: 0.93 },
      { a0: -40, a1: 40, outer: [[-0.028, 0.719], [0.191, 0.625], [0.113, 0.328], [-0.074, 0.234]], tint: 0.98 },
    ] as { a0: number; a1: number; outer: [number, number][]; tint?: number }[],
  },
  /** 侧栅/前栅的几何档（胸高/胸宽分数） */
  grilleSide: { dy: 0.75, w: 0.3, h: 0.24 },
  grilleFrontShell: { dx: 0.33, dy: 0.66, w: 0.36, h: 0.26, bt: [0.205, 0.3] as [number, number] },
  grilleFrontGlacis: { dy: 0.86, w: 0.28, h: 0.22 },
  grilleFrontPlain: { dy: 0.7, w: 0.28, h: 0.26 },
  /** 胸前通风线组（3 道短黑线）与条纹组的排布参数 */
  ventRun: { n: 3, dx: 0.02, dy0: 0.085, step: 0.042, w: 0.15, h: 0.02 },
  stripesRun: { dx: 0.02, dy0: 0.17, step: 0.058, w: 0.17, h: 0.036 },
  /** 装备条纹两块（胸下沿/胯前） */
  stripeChest: [
    { t: 'block', dx: [0, 'W'], dy: [0.9, 'CH'], w: [0.84, 'W'], h: [7, 'raw'], role: 'accent' },
  ] as TPart[],
  stripePelvis: [
    { t: 'block', dx: [0.05, 'W'], dy: [0.3, 'pelvis'], w: [0.8, 'W'], h: [6, 'raw'], role: 'accent' },
  ] as TPart[],
  /** 编号纵位按胸式（斜面胸避坡面中段） */
  numberDy: { glacis: 0.5, std: 0.64 },
  /** 动力服腰肋环（白-橙-白叠环，环间露暗缝即肋距） */
  rings: [
    { t: 'block', dx: [-0.04, 'W'], dy: [-0.44, 'waist'], w: [0.62, 'W'], h: [0.34, 'WH'], cham: 0.06, faceW: 3, tint: 1.02 },
    { t: 'block', dx: [-0.04, 'W'], dy: [0, 'waist'], w: [0.62, 'W'], h: [0.34, 'WH'], cham: 0.06, faceW: 3, tint: 1.02 },
    { t: 'block', dx: [-0.04, 'W'], dy: [0.44, 'waist'], w: [0.62, 'W'], h: [0.34, 'WH'], cham: 0.06, faceW: 3, tint: 1.02 },
  ] as TPart[],
  /** 动力服骨盆壳（弧底，与胸壳同曲面语言） */
  pelvisShell: [
    { t: 'poly', pts: [[-0.44, -0.49, 'pelvis'], [0.44, -0.49, 'pelvis'], [0.435, 0.05, 'pelvis'], [0.40, 0.30, 'pelvis'], [0.30, 0.45, 'pelvis'], [0.15, 0.505, 'pelvis'], [0, 0.52, 'pelvis'], [-0.15, 0.505, 'pelvis'], [-0.30, 0.45, 'pelvis'], [-0.40, 0.30, 'pelvis'], [-0.435, 0.05, 'pelvis']], faceW: 6, bolts: true },
  ] as TPart[],
  /** 髋板（下角嵌框对由 pelvisInset 规格门控） */
  pelvisBlock: [
    { t: 'block', dx: [0, 'raw'], dy: [0.02, 'pelvis'], w: [0.88, 'W'], h: [0.98, 'PH'], cham: 0.32, bolts: true, faceW: 6, insetCorners: 13, insetCornersWhen: 'pelvisInset' },
  ] as TPart[],
  /** 骨盆前覆板 + 微标（敏捷） */
  pelvisPlate: [
    { t: 'poly', pts: [[-0.32, -0.34, 'pelvis'], [0.3, 0.08, 'pelvis'], [0.3, 0.26, 'pelvis'], [-0.32, -0.16, 'pelvis']], role: 'armor2', seamless: true, seamLines: [[-0.11, -0.2, -0.11, -0.02], [0.12, -0.04, 0.12, 0.14]], seamUnit: 'pelvis' },
    { t: 'block', dx: [0.02, 'W'], dy: [-0.42, 'pelvis'], w: [9, 'raw'], h: [3.5, 'raw'], role: 'mark' },
  ] as TPart[],
  /** 裙中央暗关节 */
  skirtCenter: [
    { t: 'block', dx: [0, 'raw'], dy: [0.52, 'pelvis'], w: [0.16, 'W'], h: [0.3, 'PH'], kind: 'frame', cham: 0.2 },
  ] as TPart[],
  /** slab 裙盒（三面盒：条纹主面 + 素面 + 顶面，底缘料厚一圈） */
  skirtSlabBox: [
    { t: 'box', face: [[0.115, 0.19, 'pelvis'], [0.40, 0.19, 'pelvis'], [0.40, 0.85, 'pelvis'], [0.115, 0.85, 'pelvis']], depth: [0.33, 0.14], tone: 1.25, thickW: 6, stripes: true },
  ] as TPart[],
  /** 裙片四张（前外/前内/后外/后内；垂距按 skirtShrink 收） */
  skirtFrontOuter: [
    { t: 'poly', pts: [[0.15, -0.02, 'pelvis'], [0.47, 0.02, 'pelvis'], [0.46, 0.34, 'pelvis'], [0.42, 0.56, 'pelvis'], [0.35, 0.68, 'pelvis'], [0.19, 0.64, 'pelvis'], [0.12, 0.5, 'pelvis']], faceW: 5, faceEdge: [5, 4], seamless: true, press: true, shrink: true },
  ] as TPart[],
  skirtFrontInner: [
    { t: 'poly', pts: [[0.01, 0.05, 'pelvis'], [0.17, 0.08, 'pelvis'], [0.165, 0.3, 'pelvis'], [0.14, 0.44, 'pelvis'], [0.09, 0.52, 'pelvis'], [0.03, 0.47, 'pelvis'], [-0.01, 0.38, 'pelvis']], faceW: 5, faceEdge: [5, 4], seamless: true, press: true, shrink: true },
  ] as TPart[],
  skirtBackOuter: [
    { t: 'poly', pts: [[-0.47, 0.06, 'pelvis'], [-0.15, 0.02, 'pelvis'], [-0.125, 0.32, 'pelvis'], [-0.12, 0.52, 'pelvis'], [-0.17, 0.63, 'pelvis'], [-0.37, 0.7, 'pelvis'], [-0.44, 0.6, 'pelvis']], faceW: 5, faceEdge: [5, 4], seamless: true, press: true, shrink: true },
  ] as TPart[],
  skirtBackInner: [
    { t: 'poly', pts: [[-0.17, 0.09, 'pelvis'], [-0.01, 0.06, 'pelvis'], [-0.002, 0.27, 'pelvis'], [0.0, 0.4, 'pelvis'], [-0.04, 0.49, 'pelvis'], [-0.11, 0.55, 'pelvis'], [-0.15, 0.47, 'pelvis']], faceW: 5, faceEdge: [5, 4], seamless: true, press: true, shrink: true },
  ] as TPart[],
  /** 肩盘（最后画：盘压在楔拱/盒/胸板之上） */
  shoulderDisc: [
    { t: 'disc', dx: [-0.2, 'W'], dy: [0.47, 'CH'], r: [0.13, 'W'] },
  ] as TPart[],
  /** 格栅面线（口面即此线）：[x0, y0, x1, y1] 取值源，按胸式 */
  faceSeg: {
    slab: [{ p: 'fold' }, { p: 'divY', off: 0.03 }, { p: 'base' }, { lit: 0.99 }],
    glacis: [{ p: 'fold' }, { p: 'foldY' }, { p: 'base' }, { lit: 0.99 }],
    shell: [{ p: 'fold' }, { p: 'foldY' }, { p: 'base', off: 0.08 }, { lit: 0.85 }],
    stack: [{ p: 'fold' }, { p: 'foldY', off: 0.05 }, { p: 'base' }, { lit: 0.98 }],
  } as Record<string, SegSrc[]>,
  /** 龙骨上缘段（口的 keel 定向从它解深度向），按胸式 */
  keelUp: {
    shell: [{ avgTF: true }, { midSub: 1 }, { p: 'fold' }, { p: 'foldY' }],
    glacis: [{ p: 'top' }, { lit: 0.08 }, { p: 'fold' }, { p: 'foldY' }],
    slab: [{ p: 'top' }, { lit: 0.28 }, { p: 'fold' }, { p: 'divY' }],
    stack: [{ lit: -0.48 }, { p: 'foldY', off: 0.05 }, { p: 'fold' }, { p: 'foldY', off: 0.05 }],
  } as Record<string, SegSrc[]>,
};

/** 图步条件（数据）：点路径对规格求值——等值/不等/真值/大于/全合取 */
export type TorsoWhen =
  | { path: string; eq?: string; neq?: string; truthy?: true; gt?: number }
  | { all: TorsoWhen[] };

export interface TorsoStep {
  op: 'parts' | 'hoseRun' | 'waistDiscs' | 'chestStack' | 'chestShell' | 'chestGlacis' | 'chestSlab' | 'wedgeArch' | 'grilleSide' | 'grilleFrontShell' | 'grilleFrontGlacis' | 'grilleFrontPlain' | 'ventRun' | 'stripesRun' | 'insignia' | 'number';
  list?: string;
  when?: TorsoWhen;
}

/** 躯干模板（DAG 数据）：步列序 = 画序——式与装备的选择全在 when 数据里 */
export const TORSO_GRAPH: TorsoStep[] = [
  { op: 'parts', list: 'backBox', when: { path: 'form.back', eq: 'box' } },
  { op: 'parts', list: 'backBinder', when: { path: 'form.back', eq: 'binder' } },
  { op: 'parts', list: 'backRack', when: { path: 'form.back', eq: 'rack' } },
  { op: 'parts', list: 'neckStruts', when: { path: 'neckStruts', truthy: true } },
  { op: 'parts', list: 'waistFrame' },
  { op: 'parts', list: 'waistPlates', when: { path: 'waistForm', eq: 'plates' } },
  { op: 'hoseRun', when: { path: 'waistForm', eq: 'hose' } },
  { op: 'parts', list: 'waistPipe', when: { path: 'waistForm', eq: 'plates' } },
  { op: 'waistDiscs' },
  { op: 'parts', list: 'backing' },
  { op: 'parts', list: 'collar' },
  { op: 'chestStack', when: { path: 'form.chest', eq: 'stack' } },
  { op: 'chestShell', when: { path: 'form.chest', eq: 'shell' } },
  { op: 'chestGlacis', when: { path: 'form.chest', eq: 'glacis' } },
  { op: 'chestSlab', when: { path: 'form.chest', eq: 'slab' } },
  { op: 'wedgeArch' },
  { op: 'grilleSide', when: { path: 'form.grille', eq: 'side' } },
  { op: 'grilleFrontShell', when: { all: [{ path: 'form.grille', eq: 'front' }, { path: 'form.chest', eq: 'shell' }] } },
  { op: 'grilleFrontGlacis', when: { all: [{ path: 'form.grille', eq: 'front' }, { path: 'form.chest', eq: 'glacis' }] } },
  { op: 'grilleFrontPlain', when: { all: [{ path: 'form.grille', eq: 'front' }, { path: 'form.chest', neq: 'shell' }, { path: 'form.chest', neq: 'glacis' }] } },
  { op: 'ventRun', when: { path: 'chestVent', truthy: true } },
  { op: 'stripesRun', when: { path: 'chestStripes', truthy: true } },
  { op: 'parts', list: 'stripeChest', when: { all: [{ path: 'gear.stripe', truthy: true }, { path: 'form.chest', neq: 'slab' }] } },
  { op: 'insignia', when: { path: 'gear.insignia', gt: 0 } },
  { op: 'number', when: { path: 'gear.number', truthy: true } },
  { op: 'parts', list: 'rings', when: { path: 'waistForm', eq: 'rings' } },
  { op: 'parts', list: 'pelvisShell', when: { path: 'pelvisForm', eq: 'shell' } },
  { op: 'parts', list: 'pelvisBlock', when: { path: 'pelvisForm', neq: 'shell' } },
  { op: 'parts', list: 'pelvisPlate', when: { path: 'pelvisPlate', truthy: true } },
  { op: 'parts', list: 'stripePelvis', when: { all: [{ path: 'gear.stripe', truthy: true }, { path: 'form.chest', neq: 'slab' }] } },
  { op: 'parts', list: 'skirtCenter', when: { path: 'form.skirt', neq: 'none' } },
  { op: 'parts', list: 'skirtSlabBox', when: { all: [{ path: 'form.skirt', neq: 'none' }, { path: 'form.chest', eq: 'slab' }] } },
  { op: 'parts', list: 'skirtFrontOuter', when: { all: [{ path: 'form.skirt', neq: 'none' }, { path: 'form.chest', neq: 'slab' }] } },
  { op: 'parts', list: 'skirtFrontInner', when: { all: [{ path: 'form.skirt', neq: 'none' }, { path: 'form.chest', neq: 'slab' }] } },
  { op: 'parts', list: 'skirtBackOuter', when: { path: 'form.skirt', eq: 'both' } },
  { op: 'parts', list: 'skirtBackInner', when: { path: 'form.skirt', eq: 'both' } },
  { op: 'parts', list: 'shoulderDisc' },
];
