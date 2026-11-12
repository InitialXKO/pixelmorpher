/**
 * 车体模板数据层：车体的节点图（HULL_GRAPH 步列）与部件记录
 * 数据（HULL_GEOM）全住这里。记录口径：数值对 [值, 单位]，
 * W = 车宽分数、H = 车高分数、raw = 原值。族差异（缝位/漆带/
 * 编号位）不住这里——它们是规格数据（HullSpec 的 seamX /
 * hullStripe / numberDx / insigniaPos，工厂在 parts.ts 按族给）。
 */
export type HUnit = 'W' | 'H' | 'raw';
export type HNum = [number, HUnit];

/** 部件记录（数据形态）：几何字段是带单位的数值对，其余字段原样透传 */
export interface HPart {
  t: string;
  dx?: HNum; dy?: HNum; w?: HNum; h?: HNum; r?: HNum;
  x1?: HNum; y1?: HNum; x2?: HNum; y2?: HNum;
  /** 结构缝列 [x1, y1, x2, y2]（x 为 W 分数、y 为 H 分数） */
  seams?: [number, number, number, number][];
  [k: string]: unknown;
}

export const HULL_GEOM = {
  /** 主箱（楔）：结构缝的横缝 + 纵缝纵位带（纵缝横位是规格 seamX） */
  mainBox: { dx: -0.06, dy: 0.34, w: 0.94, h: 0.62, cham: 0.42, seamH: [-0.49, 0.56, 0.38, 0.56] as [number, number, number, number], seamY0: 0.08, seamY1: 0.56, seamXStd: 0.26 },
  /** 前斜脸（长坡面：自甲板前缘斜到鼻尖） */
  frontFace: [
    { t: 'block', dx: [0.33, 'W'], dy: [0.28, 'H'], w: [0.42, 'W'], h: [0.46, 'H'], cham: 0.5 },
  ] as HPart[],
  /** 底裙带 */
  skirtBand: [
    { t: 'block', dx: [-0.02, 'W'], dy: [0.78, 'H'], w: [0.98, 'W'], h: [0.3, 'H'], cham: 0.3 },
  ] as HPart[],
  /** 后侧散热栅（裙带式落裙面 / 无裙带落主箱面） */
  grilleSkirt: [
    { t: 'grille', dx: [-0.3, 'W'], dy: [0.78, 'H'], w: [0.26, 'W'], h: [0.18, 'H'] },
  ] as HPart[],
  grillePlain: [
    { t: 'grille', dx: [-0.4, 'W'], dy: [0.44, 'H'], w: [0.24, 'W'], h: [0.2, 'H'] },
  ] as HPart[],
  /** 舱体组：舱位按 form.cabin 查表，组内三件相对舱位偏移（分数） */
  cabinDx: { front: 0.3, mid: 0.02 } as Record<string, number>,
  cabinParts: [
    { t: 'block', dx: [0, 'W'], dy: [0.3, 'H'], w: [0.3, 'W'], h: [0.36, 'H'], cham: 0.3 },
    { t: 'block', dx: [0.06, 'W'], dy: [0.22, 'H'], w: [0.2, 'W'], h: [0.1, 'H'], kind: 'frame' },
    { t: 'light', dx: [0.1, 'W'], dy: [0.22, 'H'] },
  ] as HPart[],
  /** 侧面模块阵列（个数 = form.modules） */
  modulesRun: { dx0: -0.08, step: -0.17, dy: 0.32, w: 0.14, h: 0.3, cham: 0.25 },
  /** 炮塔·炮式（座环+主体+舱盖+桅+潜望镜+炮盾座；主炮是武器模式的产物、不在此画） */
  turretGun: [
    { t: 'disc', dx: [-0.08, 'W'], dy: [-0.02, 'H'], r: [0.1, 'W'] },
    { t: 'block', dx: [-0.06, 'W'], dy: [-0.14, 'H'], w: [0.36, 'W'], h: [0.24, 'H'], cham: 0.4 },
    { t: 'block', dx: [-0.1, 'W'], dy: [-0.3, 'H'], w: [0.15, 'W'], h: [0.07, 'H'], cham: 0.4 },
    { t: 'block', dx: [-0.21, 'W'], dy: [-0.36, 'H'], w: [0.025, 'W'], h: [0.22, 'H'], cham: 0.2 },
    { t: 'block', dx: [0.05, 'W'], dy: [-0.3, 'H'], w: [0.07, 'W'], h: [0.06, 'H'], kind: 'frame' },
    { t: 'block', dx: [0.14, 'W'], dy: [-0.16, 'H'], w: [0.1, 'W'], h: [0.17, 'H'], cham: 0.3 },
  ] as HPart[],
  /** 炮塔·架式（架柱+顶架+双罐+箱） */
  turretRack: [
    { t: 'block', dx: [-0.24, 'W'], dy: [-0.02, 'H'], w: [0.08, 'W'], h: [0.14, 'H'], kind: 'frame' },
    { t: 'block', dx: [0.08, 'W'], dy: [-0.02, 'H'], w: [0.08, 'W'], h: [0.14, 'H'], kind: 'frame' },
    { t: 'block', dx: [-0.08, 'W'], dy: [-0.12, 'H'], w: [0.52, 'W'], h: [0.14, 'H'], kind: 'frame' },
    { t: 'block', dx: [-0.22, 'W'], dy: [-0.25, 'H'], w: [0.16, 'W'], h: [0.16, 'H'], kind: 'cyl', tint: 1.35 },
    { t: 'block', dx: [0, 'W'], dy: [-0.25, 'H'], w: [0.16, 'W'], h: [0.16, 'H'], kind: 'cyl', tint: 1.35 },
    { t: 'block', dx: [0.13, 'W'], dy: [-0.23, 'H'], w: [0.14, 'W'], h: [0.2, 'H'] },
  ] as HPart[],
  /** 腹线（垂缆/侧挂舱的挂载线）：裙带底沿 / 主箱底沿（H 分数） */
  bellyY: { skirt: 0.93, plain: 0.66 },
  /** 垂缆两兜（x 为 W 分数；垂幅/半径原值） */
  sagCables: [
    { x1: -0.3, x2: -0.02, sag: 26, r: 3.4 },
    { x1: 0.05, x2: 0.31, sag: 20, r: 3 },
  ],
  /** 侧挂设备舱（盒挂主面外侧 + 舱底一兜垂缆） */
  sidePod: { pw: 0.19, ph: 0.3, pdx: 0.31, pdyOff: -0.17, cableSag: 13, cableR: 2.6, cableHalf: 0.3 },
  /** 徽记落点缺省（规格 insigniaPos 优先） */
  insigniaPosStd: [-0.3, 0.5] as [number, number],
  /** 编号横位缺省（W 分数；规格 numberDx 优先） */
  numberDxStd: -0.3,
  numberDy: 0.36,
  /** 鼻灯 */
  noseLight: [
    { t: 'light', dx: [0.44, 'W'], dy: [0.44, 'H'] },
  ] as HPart[],
};

/** 图步条件（数据）：点路径对规格求值——等值/不等/真值/全合取 */
export type HullWhen =
  | { path: string; eq?: string; neq?: string; truthy?: true; falsy?: true }
  | { all: HullWhen[] };

export interface HullStep {
  op: 'parts' | 'mainBox' | 'cabinSet' | 'modulesRun' | 'sagCables' | 'sidePod' | 'insignia' | 'number';
  list?: string;
  /** 部件去向：缺省车体列，'turret' 进炮塔列（split 时分开返回） */
  to?: 'turret';
  when?: HullWhen;
}

/** 车体模板（DAG 数据）：步列序 = 画序——式与装备的选择全在 when 数据里 */
export const HULL_GRAPH: HullStep[] = [
  { op: 'mainBox' },
  { op: 'parts', list: 'frontFace' },
  { op: 'parts', list: 'skirtBand', when: { path: 'form.skirt', truthy: true } },
  { op: 'cabinSet' },
  { op: 'modulesRun' },
  { op: 'parts', list: 'grilleSkirt', when: { path: 'form.skirt', truthy: true } },
  { op: 'parts', list: 'grillePlain', when: { path: 'form.skirt', falsy: true } },
  { op: 'parts', list: 'turretGun', to: 'turret', when: { path: 'form.turret', eq: 'gun' } },
  { op: 'parts', list: 'turretRack', to: 'turret', when: { path: 'form.turret', eq: 'rack' } },
  { op: 'sagCables', when: { path: 'sagCables', truthy: true } },
  { op: 'sidePod', when: { path: 'sidePod', truthy: true } },
  { op: 'insignia' },
  { op: 'number', when: { path: 'gear.number', truthy: true } },
  { op: 'parts', list: 'noseLight' },
];
