/**
 * 头部几何数据层：一切几何（部件的位置/尺寸/角度/点列）都是数据，
 * 住在这里与规格里（HeadSpec.geom 覆盖），构造器只做缩放与装配、
 * 不存任何几何字面量；画法由算子提供（形状测试/派生算子/着色 pass）。
 *
 * 单位口径：dx 与 pts 横坐标 = 头宽 w 的分数；dy = 头高 h 的分数；
 * 尺寸字段以字段名标基准（w = w 分数、h = h 分数、r = w 分数、
 * rh = h 分数）；cham/ang/tint 为无量纲原值。
 */
/** 几何出处（防漏一号关）：每份几何记录记它的见证（样本 + 部位，
 * 如 'mecha-agile-side：颊板'）。没有出处的数据自动进嫌疑名单；
 * 共用缺省被多族共用时，出处必须覆盖每一个使用族的自家样本
 * （四号关：共用出处不顶数）。数组条目的出处记在首件上。 */
export interface GPart {
  witness?: string;
  t: 'block' | 'disc' | 'grille' | 'poly';
  dx?: number; dy?: number;
  w?: number; h?: number; r?: number; rh?: number; rm?: number;
  cham?: number; ang?: number; faceW?: number; tint?: number;
  kind?: 'cyl' | 'frame';
  role?: 'stripe' | 'armor' | 'armor2' | 'accent' | 'mark';
  bolts?: boolean; glowSeat?: boolean;
  inset?: { fw: number; fh: number };
  bars?: { groups: number[]; gap: number; role?: string };
  pts?: [number, number][];
  faceEdge?: [number, number];
  /** 宿主登记：装配时把该件登记为具名宿主（body/collar） */
  host?: 'body' | 'collar';
  /** 穹弧派生站位（h 分数）：给了则 dy 不作数——纵坐标由穹弧在
   * 本件 dx 处的弧面高度 + arcOff（相对弧面的偏移）派生。贴穹
   * 件（冠阶/壳阶/天线基座等）的站位是关系量、不许写死坐标 */
  arcOff?: number;
  /** 宿主相对站位 [w 分数, h 分数]：与图步 relHost 配套——给了
   * 则 dx/dy 不作数，站位 = 宿主中心（多边形宿主取包围盒心）+
   * rel 偏移。贴承载体的件（颊/颌/耳/太阳穴/呼吸器管）站位是
   * 关系量；tipBlock 步的 rel 例外：锚在宿主包围盒前下角 */
  rel?: [number, number];
  /** 穹底线相对站位（h 分数）：给了则 dy 不作数——中心纵坐标
   * = 穹底线 baseY + baseOff。眉的下缘贴穹底线（穹的定义量），
   * 眉是长在穹前下缘的件、不是独立坐标 */
  baseOff?: number;
}

/** 平行线组的线记录（单位分数：dx/len 走 w、dy/thick 走 h）。
 * 图步带 relHost 时 dx/dy 是相对宿主中心的偏移（关系量） */
export interface GLine { witness?: string; dx: number; dy: number; len: number; thick: number; /** 自带倾角（弧度）：给了就不读宿主角——仅当角度本身是定义量时用；随承载体派生的角不许存这里（壳缝用 arcTan） */ ang?: number; /** 角由穹弧前端站位切线派生（平行族）：走向随穹数据走，见 engine 的 domeFrontTangent */ arcTan?: boolean }

/** 翼形几何（单位分数：dx/len 以 w 计、dy/wRoot/wTip 以 h 计）。
 * 鳍只是刃身：它插在座里，根部不出檐——檐是座的前端（见 FinBaseGeom） */
export interface FinGeom { witness?: string; dx: number; /** 根纵坐标：自由值仅限有座/显式覆盖；带 arcSink 时不作数（由穹弧派生） */ dy: number; len: number; wRoot: number; wTip: number; ang: number; /** 弧站位埋深（h 分数）：根 = 穹弧在 dx 站位的弧面 + arcSink——无座鳍（角/刃型主鳍）的根贴穹弧走，穹变根跟（与天线 sink 同式） */ arcSink?: number }

/** 鳍座几何（眉鳍合一的「座」：鳍插其上、前端出檐、眼座挂其
 * 下缘）。座在头部坐标系里展开（不随鳍轴——正样侧面实读：
 * 座是额前一块高身块体，下缘近水平成眉线，只有顶上的鳍插
 * 槽随鳍）：along = 鳍根→檐尖的前伸（w 分数，须够檐尖探出
 * 脸前面）、back = 下缘自鳍根向后延的长度（w 分数）、
 * drop = 下缘在鳍根之下的深度（h 分数）；顶缘包鳍根的跨度
 * 按根宽由算子定，是画法、不入数据 */
export interface FinBaseGeom { witness?: string; along: number; back: number; drop: number; /** 穹弧站位角（弧度，穹弧参数 a：π=后、0=前）：座锚点在穹弧上的站位——座贴轮廓的唯一站位量 */ arc: number; /** 埋深（h 分数）：锚点自穹弧面向下埋入的深度（鳍根/座身沉进壳体） */ sink: number }

/** 双鳍标准档（g3 网格实读的两鳍关系：主鳍后伏（轴 −134°）、
 * 后鳍更直立（轴 −99°，即 ang 更接近 −π/2）、长约主鳍 0.35。
 * 双鳍同根：两刃从同一点扇出——有座时根同为座锚 S（wing 步
 * 派生）；无座时后鳍 dx/dy 与主鳍同点。此前「后根在座顶线后
 * 段另立站位」是把出刃点目测当根位，已废） */
export const FIN_GEOM_STD: { main: FinGeom; rear: FinGeom } = {
  // 无座时（刃型 vfin）的根走弧站位：arcSink 按动力服穹（flat
  // 0.85/apex 0.82）旧根位 (0.20, −0.78) 反解 = 0.1267——根贴穹
  // 弧、穹变跟走，dy 字段留作无 arcSink 覆盖时的回落
  main: { witness: 'mecha-agile-side：主鳍标准档', dx: 0.20, dy: -0.78, arcSink: 0.1267, len: 1.15, wRoot: 0.08, wTip: 0.010, ang: -2.20 },
  rear: { witness: 'mecha-agile-side：后鳍标准档（后长 0.60 正样纯侧面实测）', dx: 0.20, dy: -0.78, arcSink: 0.1267, len: 0.69, wRoot: 0.085, wTip: 0.012, ang: -1.75 }, // 后长 ≈ 主长 0.60：正样纯侧面实测（后尖高 ≈ 主尖高 3/4、根同点反解）；轮五的 0.35 是 g3 四分之三透视短缩读数、已被正样推翻
};
/** 鳍座站位（穹弧站位角 + 埋深）：座锚点 S 不存坐标——由穹弧
 * 派生：S = 穹弧在站位角 arc 处的点、再向下埋 sink（h 分数）。
 * 轮廓（穹）是座的承载体：穹一变（domeFlat/换穹数据）座跟着
 * 走；鳍根再由座派生（主鳍植于 S、后鳍按座顶线站位）——派生
 * 链穹→座→鳍，不许任何一环存独立坐标（FinBaseGeom.arc/sink） */
/** 前额角标准档（角走甲色不走强调色） */
export const HORN_GEOM_STD: FinGeom = { witness: 'mecha-side：顶角标准档', dx: 0.26, dy: -0.80, arcSink: 0.1123, len: 0.37, wRoot: 0.11, wTip: 0.018, ang: -0.08 }; // 根走弧站位：arcSink 按标准穹旧根位 (0.26, −0.80) 反解——角植于穹弧、根埋 0.11h
/** 粗天线标准档：杆脚贴穹弧起杆——杆底 = 穹弧在 dx 处的弧面
 * 高度向下埋 sink（h 分数）；长度与后倾是数据。旧 base（写死
 * 的起杆高度）已废：穹一变杆脚不跟，是派生顺序错 */
export const ANT_GEOM_STD = { witness: 'mecha-side：顶桅标准档', dx: -0.18, sink: 0.155, len: 0.55, lean: 0 };
/** 降式标准档（吻板站位向量） */
export interface FaceDescent { witness?: string; top: [number, number]; descent: [number, number]; under: [number, number]; inset: number; rise: number }
export const FACE_DESCENT_STD: FaceDescent = { witness: 'mecha-side：吻板降式标准档', top: [0.36, 0.02], descent: [0.12, 0.22], under: [-0.08, 0.14], inset: 0.28, rise: 0.34 };

/** 穹弧几何（数据）：圆心/半径/底边/回声带跨度与两档半径，全是单位分数 */
export interface DomeGeom {
  witness?: string;
  cx: number; cy: number; r: number;
  baseY: number; baseFront: number; baseRear: number;
  /** 穹底边斜角（弧度）：正样上壳下界是一条自后向前下行的
   * 斜边、与壳缝同属对角线族（实测 ≈0.15）——不许是水平直弦
   * （横贯全宽的假分界），也不许用水平+垂直的阶梯拼（仍是轴
   * 线）。底边以后角（baseRear, baseY）为锚、向前按此角下行 */
  botAng?: number;
  bandSpan: [number, number];
  bandWide: [number, number]; bandLine: [number, number];
  /** 主穹/回声带（线档）的色角色：双色头把分布钉在数据里——
   * 未给时收尾按画序奇偶分（结构一动就翻面，2026-11-12 裁定
   * 钉数据）；单色头不给、走底色 */
  roleMain?: 'armor' | 'armor2'; roleBand?: 'armor' | 'armor2';
}

export const HEAD_GEOM = {
  /** 头基：领圈 + 后颅 + 盔体（盔体 cham 按冠式走 bodyCham） */
  base: [
    { t: 'block', witness: 'mecha-agile-side/mecha-side/powersuit-side：盔体', host: 'collar', dx: 0, dy: -0.05, w: 0.54, h: 0.18, kind: 'frame' },
    { t: 'block', dx: -0.30, dy: -0.52, w: 0.32, h: 0.64, cham: 0.4 },
    { t: 'block', host: 'body', dx: -0.02, dy: -0.52, w: 0.92, h: 0.8, bolts: true },
  ] as GPart[],
  /** 盔体切角按冠式（数据） */
  bodyCham: { dome: 0.68, flat: 0.3, angular: 0.44 } as Record<string, number>,
  /** 颈环节距（h 分数） */
  collarSegPitch: 0.055,
  /** 后延伸板（贴穹弧后段：dy 由 arcOff 派生，−0.055 按敏捷穹校准） */
  shellStep: { t: 'block', witness: 'mecha-agile-side：壳阶', dx: -0.40, arcOff: -0.055, w: 0.34, h: 0.11, cham: 0.25 } as GPart,
  /** 盔体细缝两条（正样/h2 的壳缝都是斜扫长线、没有水平长
   * 缝）：长缝的角由穹弧前端切线派生（arcTan——原写死 0.45 已
   * 删，实测缝向 ≈0.15–0.30 rad、派生式在敏捷穹上给 0.28）；
   * 斜缝读后鳍镜像——宿主由构造器给 */
  shellSeams: [
    { witness: 'mecha-agile-side：壳缝', dx: -0.16, dy: 0.06, len: 0.52, thick: 0.018, arcTan: true },
    { dx: -0.10, dy: -0.11, len: 0.45, thick: 0.018 },
  ] as GLine[],
  /** 穹弧几何缺省（穹顶 + 等距回声带：宿主是冠弧、内偏恒定的次级轮廓读法） */
  dome: {
    cx: -0.05, cy: -0.60, r: 0.44,
    witness: 'mecha-agile-side/mecha-side/powersuit-side：穹顶', baseY: -0.58, baseFront: 0.36, baseRear: -0.46, botAng: 0.15,
    bandSpan: [0.92, 0.68], bandWide: [0.355, 0.31], bandLine: [0.348, 0.332],
  } as DomeGeom,
  /** 分段冠两级冠板（cham 按冠式走 stepCham；站位贴冠轮廓弧：
   * dy 由 arcOff 派生——冠式虽不画穹壳，冠轮廓仍由 DomeGeom 定，
   * 两级板的沉量是各自的关系量） */
  crownSteps: [
    { t: 'block', dx: -0.24, arcOff: 0.057, w: 0.46, h: 0.2, bolts: true },
    { t: 'block', dx: 0.08, arcOff: 0.150, w: 0.46, h: 0.18, ang: -0.05 },
  ] as GPart[],
  stepCham: { flat: 0.2, angular: 0.35 } as Record<string, number>,
  stepChamStd: 0.35,
  /** 呼吸器颌体压暗（着色档位，数据） */
  breatherTint: 0.36,
  /** 眉檐块（纵站位贴穹底线 baseOff −0.06：眉下缘与穹底线齐平；
   * 横站位 dx 是面部站位数据） */
  brow: { t: 'block', witness: 'mecha-side：眉块', dx: 0.30, baseOff: -0.06, w: 0.34, h: 0.11, ang: 0.12 } as GPart,
  /** 鳍座标准档（g3/h2 实读：座沿刃脚下缘斜置、前端探出成檐；
   * arc/sink 标准档按标准穹（flat 1）与标准鳍根 (0.20,−0.78) 反解：
   * 弧站位 0.965、埋深 0.182——各族以 finBaseGeom 覆盖其站位） */
  finBase: { witness: 'mecha-agile-side：鳍座标准档；ann-h2/g3：眉鳍座', along: 0.24, back: 0.17, drop: 0.24, arc: 0.965, sink: 0.182 } as FinBaseGeom,
  /** 额前冠件占位点列（规格未给 crestPts 时的同区占位形）：y 是
   * 相对穹底线 baseY 的偏移（步 anchorBaseY 平移）——冠件底缘
   * 贴穹底线，与眉同承载 */
  crestStd: [[0.08, -0.12], [0.40, -0.12], [0.40, 0.0], [0.08, 0.0]] as [number, number][],
  /** 眼座宽按眼式（w 分数）与眼座高标准档（h 分数） */
  seatW: { slit: 0.28, dot: 0.22 } as Record<string, number>,
  seatHStd: 0.11,
  /** 缝眼光带起点（座内 w 分数）与点眼光点位 */
  slitStart: 0.25, dotLightDx: 0.30,
  /** 面甲占位点列（规格未给 visorPts 时）与檐影带厚（h 分数）：
   * 点列是相对眉块中心的偏移（步 anchorHost 'brow' 平移）——
   * 面甲挂在眉下、眉移甲跟移，不存绝对点列 */
  visorStd: [[-0.28, 0.01], [0.12, 0.01], [0.12, 0.15], [-0.28, 0.15]] as [number, number][],
  visorBand: 0.035,
  /** 颊板（站位相对盔体中心 rel：前缘与盔体前缘齐、下缘近盔体底） */
  cheek: { t: 'block', witness: 'powersuit-side：颊块', rel: [0.28, 0.25], w: 0.36, h: 0.26, ang: 0.18 } as GPart,
  /** 脸侧顺边带参数（沿边带算子入参：起止沿前缘链分数 + 两端带宽 + 离边内偏，均 w 分数） */
  cheekRibbon: { witness: 'powersuit-side：脸侧橙带', from: 0, to: 1, w0: 0.07, w1: 0.052, inset: 0.05 },
  /** 眼下双横线（平行线组入参；站位相对颊板中心 rel） */
  cheekLines: [
    { dx: 0.075, dy: -0.075, len: 0.15, thick: 0.018 },
    { dx: 0.08, dy: -0.042, len: 0.15, thick: 0.018 },
  ] as GLine[],
  /** 板颌式颊板（直边楔板点列，头部坐标分数——轮廓本身即定义
   * 量）：正样颊是平板：顶边 = 眼窝下平直的颧骨沿、前缘自沿端
   * 直落、下缘斜切回后下。倒角块的圆弧边读不出这三条直边，
   * 块式颊只留给非板颌式（图步按 jaw 式选） */
  cheekPlate: { t: 'poly', witness: 'mecha-agile-side：颊板（轮十四：下缘延长——颊带占核高 0.40–0.88、颌带只占末段）', pts: [[0.02, -0.44], [0.24, -0.44], [0.24, 0.04], [0.15, 0.11], [0.02, 0.05]] } as GPart,
  /** 颊板前脸（同上点列的前段，竖缝为界）：正样颊面前脸亮一
   * 档、后脸沉一档——缝即两面的接合边（缝算子的既有读法） */
  cheekPlateF: { t: 'poly', witness: 'mecha-agile-side：颊板前脸（轮十四前缘整线：眼下即快收 0.44→0.345→0.30、其后缓收至 0.285、凹进 0.15–0.19 核高——不是台阶也不是匀斜）', pts: [[0.24, -0.44], [0.44, -0.44], [0.345, -0.30], [0.30, -0.16], [0.285, 0.05], [0.24, 0.04]], tint: 1.07 } as GPart,
  /** 颊面竖缝（平行线组入参；站位相对盔体中心 rel——缝立在颊
   * 板面上随盔体走；ang 自带竖直、不读宿主角）：正样颊面一道
   * 竖缝分前后两面 */
  cheekSeam: [
    { witness: 'mecha-agile-side：颊面竖缝（轮十四随颊带延长）', dx: 0.26, dy: 0.38, len: 0.54, thick: 0.016, ang: 1.57 },
  ] as GLine[],
  /** 颊面前脸短横凹线（平行线组入参；站位相对盔体中心 rel，同
   * cheekSeam 帧）：标准档空——只有敏捷正样前脸下段有一道、止于
   * 竖缝前（轮十三标注 S7，x1/x3/x4 三个新样本前脸均无此线），
   * 是敏捷族变体数据，由敏捷条目 geom 覆盖给出，不升格通则 */
  cheekNotch: [] as GLine[],
  /** 板颌式面甲（前置楔板点列）：正样口鼻部是颊前缘外一小块
   * 前探的阶梯板——前缘直立、下缘斜回收向颏；横槽刻在它身上，
   * 不是贴在颊面上的两条纹 */
  maskPlate: { t: 'poly', witness: 'mecha-agile-side：前置面甲（轮十四：缩成颏前短块——前缘的「返回」只发生在核高末段 0.88 以下；前点 0.47 在眉平面后）', pts: [[0.36, -0.08], [0.47, -0.06], [0.47, 0.04], [0.41, 0.10], [0.36, 0.05]] } as GPart,
  /** 面甲横槽（平行线组入参；站位相对面甲包围盒心 rel） */
  maskLines: [
    { witness: 'mecha-agile-side：面甲横槽', dx: 0, dy: -0.035, len: 0.085, thick: 0.018 },
    { dx: 0, dy: 0.02, len: 0.085, thick: 0.018 },
  ] as GLine[],
  /** 板颌式颌板（楔板点列）：上缘与颊板下缘斜切同族（平行
   * 关系）、藏在颊板下沿之后，前缘在面甲下、底收颏尖——块颌
   * 的倒角圆顶在颊板下会读成脱节的圆 lump，故板颌式走楔板 */
  jawPlate: { t: 'poly', witness: 'mecha-agile-side：颌板（轮十四：藏在长颊之下、只在末段露前缘 0.46——正样颌前缘回眉平面后一线并保持到颏收尾）', pts: [[0.08, 0.0], [0.455, 0.02], [0.46, 0.06], [0.38, 0.115], [0.12, 0.125]], tint: 0.92 } as GPart,
  /** 太阳穴栓芯式（盘 + 暗芯）与圆盘式（站位相对盔体中心 rel） */
  templeBolt: [
    { t: 'disc', witness: 'ann-h2/g3：太阳穴栓芯', rel: [0.06, -0.06], r: 0.032 },
    { t: 'disc', rel: [0.06, -0.06], r: 0.014, kind: 'frame' },
  ] as GPart[],
  templeDisc: { t: 'disc', rel: [0.06, -0.06], r: 0.03, kind: 'frame' } as GPart,
  /** 鳍根整流罩占位点列（规格未给 fairingPts 时）：点列是相对
   * 鳍锚点（座锚 S、无座时主鳍根）的关系量，由 poly 步 anchorFin
   * 平移——旧绝对坐标矩形已按标准鳍根 (0.20,−0.78) 换算 */
  fairingStd: [[-0.20, -0.04], [0.14, -0.04], [0.14, -0.14], [-0.20, -0.14]] as [number, number][],
  finSegPitch: 0.13,
  /** 鳍料厚档位（中脊式截面：脊带半宽占截面宽比/脊亮档/背侧
   * 面压暗档）：正样实读刃是带中脊的厚板——脊线亮带 + 两面异
   * 调，不是平面剪影；档位是画法、走 wingSpineParts 算子 */
  finSpine: { w: 0.13, spine: 1.28, flank: 0.80 },
  /** 座面分工档位：座前脸压暗档（座是块体：上部本体面 + 前脸
   * 深一档，正样实读的分面） */
  finBaseFacet: 0.80,
  /** 天线：杆宽（w 分数）/杆顶盘半径与轴向座位/珠节节距（h 分数）/细杆/基座块 */
  antW: 0.07, antTipR: 0.04, antTipOff: 0.005, antSegPitch: 0.19,
  antThin: { t: 'block', dx: -0.30, arcOff: -0.088, w: 0.03, h: 0.30, kind: 'cyl' } as GPart,
  antBase: { t: 'block', dx: 0.14, arcOff: 0.037, w: 0.20, h: 0.12 } as GPart,
  /** 缝眼光带终点与光体峰位标准档（规格未给 slitEnd/glowPeak 时） */
  slitEndStd: 0.361, glowPeakStd: 0.7,
  /** 鳍座眼倾角标准档（弧度，正 = 前端下沉）：正样侧面实测眼
   * 长轴向前下倾约 18°——眼随眉线斜置、不是水平条；规格可覆盖 */
  eyeAngStd: 0.32,
  /** 呼吸器吻：锚点/横管/管环节距（w 分数）/管口/颏尖点色尺寸（w,h 分数）。
   * 横管与管口站位相对吻板包围盒心 rel（吻板由降式派生、管随吻走） */
  respAnchor: [0.02, -0.44] as [number, number],
  respTube: { t: 'block', witness: 'mecha-side：横向呼吸管', rel: [0.035, 0.09], w: 0.36, h: 0.10, ang: 0.10, kind: 'cyl' } as GPart,
  respTubeSeg: 0.09,
  respMouth: { t: 'disc', witness: 'mecha-side：管口', rel: [0.22, 0.105], rm: 0.05, kind: 'cyl' } as GPart,
  respTip: [0.06, 0.055] as [number, number],
  /** 呼吸器颌：颌体占位点列（规格未给 breatherPts 时）/颏前管口/颏尖块（尺寸再乘 chinTipScale 档位）。
   * 管口站位相对颌体包围盒心 rel；颏尖块走 tipBlock 前下角锚 */
  breatherStd: [[0.05, -0.22], [0.42, -0.22], [0.42, -0.005], [0.05, -0.005]] as [number, number][],
  breatherPipe: { t: 'block', witness: 'powersuit-side：颌管口', rel: [0.125, 0.0125], w: 0.08, h: 0.07, ang: 0.2, kind: 'cyl' } as GPart,
  breatherTip: { t: 'block', witness: 'powersuit-side：颏尖橙件', rel: [-0.01, -0.08], w: 0.035, h: 0.05, role: 'accent' } as GPart,
  /** 块颌/小颌（ang 走 jawAng 规格、未给走 jawAngStd；站位相对
   * 盔体中心 rel——颌挂在盔体下前，盔体动颌跟动）与块颌颏尖点色尺寸 */
  jawBlock: { t: 'block', rel: [0.24, 0.39], w: 0.32, h: 0.17 } as GPart,
  jawSmall: { t: 'block', rel: [0.27, 0.41], w: 0.34, h: 0.13 } as GPart,
  /** 板颌颏下楔（板颌式：整板之下、偏后挂的强调色楔——正样实读
   * 蓝件在颏下偏后当护楔、不在颏尖当前坠点；斜置向下后收）。
   * 站位走 tipBlock 前下角锚：相对颌板包围盒前下角 rel */
  jawWedge: { t: 'block', witness: 'mecha-agile-side：颏下楔（轮十四：rel x 前送——颏前缘保持到收尾、不早缩）', rel: [-0.055, -0.01], w: 0.11, h: 0.13, ang: -0.30, cham: 0.25 } as GPart,
  jawAngStd: 0.14,
  blockTip: [0.065, 0.05] as [number, number],
  /** 耳六式（站位一律相对盔体中心 rel——耳是盔体侧面的件） */
  earGrille: { t: 'grille', witness: 'mecha-side：耳侧栅板', rel: [-0.12, 0.08], w: 0.18, h: 0.25 } as GPart,
  earSensor: { t: 'grille', witness: 'mecha-agile-side：耳侧暗栅', rel: [-0.095, 0.128], w: 0.085, h: 0.266, bars: { groups: [3, 3], gap: 0.020, role: 'armor2' } } as GPart,
  earPlateStripe: [
    { t: 'block', rel: [-0.10, 0.04], w: 0.32, h: 0.40, cham: 0.25 },
    { t: 'block', rel: [-0.12, -0.01], w: 0.14, h: 0.04, role: 'accent' },
    { t: 'block', rel: [-0.12, 0.08], w: 0.14, h: 0.04, role: 'accent' },
  ] as GPart[],
  earCover: [
    { t: 'block', witness: 'powersuit-side：耳盖板', rel: [-0.11, 0.06], w: 0.27, h: 0.31, cham: 0.42, inset: { fw: 0.55, fh: 0.55 } },
    { t: 'block', rel: [-0.11, 0.06], w: 0.125, h: 0.032, role: 'accent' },
  ] as GPart[],
  earDisc: [
    { t: 'disc', rel: [-0.14, 0.04], r: 0.11 },
    { t: 'disc', rel: [-0.14, 0.04], r: 0.06 },
  ] as GPart[],
  earPlate: { t: 'block', rel: [-0.06, 0.04], w: 0.30, h: 0.40, cham: 0.3 } as GPart,
  // 头部对外锚点（眼/耳/冠）不在此存数据：由 headIR 按实际零件
  // 派生（眼座心/耳组首件心/穹弧顶点）——绝对分数表与零件位置
  // 对不上、且无消费方，已删
};

/** 图步条件（数据）：对规格的纯判定——标志位/字段等值/式不等/式标志/全合取 */
export type HeadWhen =
  | { flag: string } | { notFlag: string }
  | { specEq: [string, string] } | { specNeq: [string, string] }
  | { formNeq: [string, string] } | { formFlag: string }
  | { all: HeadWhen[] };

/** 头部图步（模板数据）：一步 = 一次算子调用。group 是画序组（见
 * HEAD_DRAW_ORDER），图列序是展开（建造）序——顶附属先展开（壳缝/
 * 眼座要读它的宿主）、画序排最后；眉檐先展开、画序在眼座之后。
 * slot/form 是式选择（实例的 form 数据选步），when 是条件数据，
 * geom/pts 是数据出处（规格覆盖优先、HEAD_GEOM 缺省），provides/
 * host/target 是宿主交接（具名数据边）。 */
export interface HeadStep {
  group: string;
  slot?: 'crown' | 'eye' | 'jaw' | 'ear' | 'top';
  form?: string | string[];
  when?: HeadWhen;
  op: 'emit' | 'emitEach' | 'poly' | 'wing' | 'dome' | 'seg' | 'lines' | 'ribbon' | 'seat' | 'slitLights' | 'dotLight' | 'descent' | 'chinTip' | 'tipBlock' | 'antenna' | 'finBase' | 'spine';
  geom?: string; pts?: string; ptsStd?: string; hosts?: string[];
  role?: 'accent' | 'armor' | 'armor2'; specRole?: string; tintFrom?: string; topBandFrom?: string;
  provides?: string; host?: string; target?: string;
  paintHosts?: string[]; // ribbon：链宿主之外另加的漆承载宿主（间隙段的脸面）
  hostAny?: string[]; mirrorWhenFirst?: boolean; // lines：候选宿主列（取第一个在场），命中首选时镜像
  fin?: 'horn' | 'main' | 'rear'; angFrom?: 'jawAng';
  bodyCham?: boolean; chamByCrown?: boolean;
  followUps?: { host: string; step: { axis: 'w' | 'h'; pitchFrom: string; mode: 'ring' | 'bead'; when?: HeadWhen } }[];
  segKind?: 'block' | 'wing'; axis?: 'w' | 'h'; pitchFrom?: string; mode?: 'ring' | 'bead';
  index?: number; mirror?: boolean; sizeFrom?: string;
  /** poly 步点列锚定鳍锚点：点列存相对座锚 S（无座时主鳍根）的
   * 偏移、展开时平移到锚点——整流罩随座/鳍走，不存绝对点列 */
  anchorFin?: boolean;
  /** 宿主相对站位：本步几何的 rel 偏移以该宿主为原点（emit/
   * emitEach/lines = 宿主中心、tipBlock = 宿主包围盒前下角）。
   * 承载关系写在图步上、偏移写在几何上，两边都是数据 */
  relHost?: string;
  /** poly 步点列锚定宿主中心：点列存相对该宿主中心的偏移、
   * 展开时平移（面甲锚眉） */
  anchorHost?: string;
  /** poly 步点列锚定穹底线：点列 y 存相对 DomeGeom.baseY 的
   * 偏移、展开时平移（冠件锚穹底） */
  anchorBaseY?: boolean;
}

/** 头部模板（DAG 数据）：展开序的步列——式与条件的选择全在数据里 */
export const HEAD_GRAPH: HeadStep[] = [
  // 顶附属（先展开、画序最后）
  { group: 'top', slot: 'top', form: 'horn', op: 'wing', fin: 'horn', provides: 'rearWing' },
  { group: 'top', slot: 'top', form: 'horn', op: 'spine', target: 'rearWing' },
  { group: 'top', slot: 'top', form: 'vfin', op: 'poly', pts: 'fairingPts', ptsStd: 'fairingStd', specRole: 'fairingTone', anchorFin: true },
  { group: 'base', slot: 'top', form: 'vfin', op: 'wing', fin: 'rear', role: 'accent', provides: 'rearWing' },
  { group: 'base', slot: 'top', form: 'vfin', op: 'spine', target: 'rearWing' },
  { group: 'base', slot: 'top', form: 'vfin', op: 'seg', segKind: 'wing', target: 'rearWing', pitchFrom: 'finSegPitch', when: { flag: 'topSeg' } },
  { group: 'top', slot: 'top', form: 'vfin', op: 'wing', fin: 'main', role: 'accent', provides: 'finMain' },
  { group: 'top', slot: 'top', form: 'vfin', op: 'spine', target: 'finMain' },
  { group: 'top', slot: 'top', form: 'antenna', op: 'antenna' },
  // 头基（领圈分节是领圈件的紧随步）
  { group: 'base', op: 'emitEach', geom: 'base', bodyCham: true, followUps: [{ host: 'collar', step: { axis: 'h', pitchFrom: 'collarSegPitch', mode: 'ring', when: { flag: 'collarSeg' } } }] },
  // 壳（后延伸板 + 盔体细缝：横缝读盔体、斜缝读后鳍镜像）
  { group: 'shell', op: 'emit', geom: 'shellStep', when: { flag: 'shellStep' } },
  { group: 'shell', op: 'lines', geom: 'shellSeams', index: 0, host: 'body', relHost: 'body', when: { flag: 'shellSeams' } },
  { group: 'shell', op: 'lines', geom: 'shellSeams', index: 1, hostAny: ['rearWing', 'body'], mirrorWhenFirst: true, relHost: 'body', when: { flag: 'shellSeams' } },
  // 冠
  { group: 'crown', slot: 'crown', form: 'dome', op: 'dome' },
  { group: 'crown', slot: 'crown', form: ['flat', 'angular'], op: 'emitEach', geom: 'crownSteps', chamByCrown: true },
  // 眉（先展开：眼座读檐下缘；眉鳍合一时先立座——鳍插座上、眼座挂座前缘）
  { group: 'top', op: 'finBase', provides: 'seatHost', when: { flag: 'finBrow' } },
  { group: 'brow', op: 'poly', pts: 'crestPts', ptsStd: 'crestStd', role: 'armor2', provides: 'brow', anchorBaseY: true, when: { all: [{ notFlag: 'finBrow' }, { formFlag: 'brow' }, { specEq: ['browForm', 'crest'] }] } },
  { group: 'brow', op: 'emit', geom: 'brow', provides: 'brow', when: { all: [{ notFlag: 'finBrow' }, { formFlag: 'brow' }, { specNeq: ['browForm', 'crest'] }] } },
  // 眼（面甲整板 + 檐影 / 凹座 + 光体）
  { group: 'eye', slot: 'eye', form: 'visor', op: 'poly', pts: 'visorPts', ptsStd: 'visorStd', topBandFrom: 'visorBand', provides: 'visor', anchorHost: 'brow' },
  { group: 'eye', slot: 'eye', form: ['slit', 'dot'], op: 'seat' },
  { group: 'eye', slot: 'eye', form: 'slit', op: 'slitLights' },
  { group: 'eye', slot: 'eye', form: 'dot', op: 'dotLight' },
  // 颊（吻式自带吻板承接、不叠颊板；顺边带与眼下双横线读颊板宿主）
  { group: 'cheek', op: 'emit', geom: 'cheek', provides: 'cheek', relHost: 'body', when: { all: [{ formNeq: ['jaw', 'respirator'] }, { formNeq: ['jaw', 'plate'] }] } },
  // 板颌式的颌板归颊组先画：颊板压颌板上缘（正样颊覆颌），颏尖步在颌组读 jawPart 宿主、不受画序影响
  { group: 'cheek', slot: 'jaw', form: 'plate', op: 'emit', geom: 'jawPlate', provides: 'jawPart' },
  { group: 'cheek', slot: 'jaw', form: 'plate', op: 'emit', geom: 'cheekPlate', provides: 'cheek' },
  { group: 'cheek', slot: 'jaw', form: 'plate', op: 'emit', geom: 'cheekPlateF' },
  { group: 'cheek', slot: 'jaw', form: 'plate', op: 'lines', geom: 'cheekSeam', host: 'cheek', relHost: 'body' },
  { group: 'cheek', slot: 'jaw', form: 'plate', op: 'lines', geom: 'cheekNotch', host: 'cheek', relHost: 'body' },
  { group: 'cheek', op: 'lines', geom: 'cheekLines', host: 'cheek', relHost: 'cheek', when: { all: [{ flag: 'cheekLines' }, { formNeq: ['jaw', 'plate'] }] } },
  // 颌四式
  { group: 'jaw', slot: 'jaw', form: 'respirator', op: 'descent', provides: 'muzzle' },
  { group: 'jaw', slot: 'jaw', form: 'respirator', op: 'emit', geom: 'respTube', provides: 'tube', relHost: 'muzzle' },
  { group: 'jaw', slot: 'jaw', form: 'respirator', op: 'seg', segKind: 'block', axis: 'w', target: 'tube', pitchFrom: 'respTubeSeg', mode: 'ring', when: { flag: 'tubeSeg' } },
  { group: 'jaw', slot: 'jaw', form: 'respirator', op: 'emit', geom: 'respMouth', relHost: 'muzzle' },
  { group: 'jaw', slot: 'jaw', form: 'respirator', op: 'chinTip', host: 'muzzle', sizeFrom: 'respTip', when: { flag: 'chinTip' } },
  { group: 'jaw', slot: 'jaw', form: 'breather', op: 'poly', pts: 'breatherPts', ptsStd: 'breatherStd', tintFrom: 'breatherTint', provides: 'breather' },
  { group: 'jaw', slot: 'jaw', form: 'breather', op: 'emit', geom: 'breatherPipe', relHost: 'breather' },
  { group: 'jaw', slot: 'jaw', form: 'breather', op: 'tipBlock', geom: 'breatherTip', relHost: 'breather' },
  { group: 'jaw', slot: 'jaw', form: 'block', op: 'emit', geom: 'jawBlock', angFrom: 'jawAng', provides: 'jawPart', relHost: 'body' },
  { group: 'jaw', slot: 'jaw', form: 'block', op: 'chinTip', host: 'jawPart', sizeFrom: 'blockTip', when: { flag: 'chinTip' } },
  { group: 'jaw', slot: 'jaw', form: 'plate', op: 'emit', geom: 'maskPlate', provides: 'mask' },
  { group: 'jaw', slot: 'jaw', form: 'plate', op: 'lines', geom: 'maskLines', host: 'mask', relHost: 'mask' },
  { group: 'jaw', slot: 'jaw', form: 'plate', op: 'tipBlock', geom: 'jawWedge', relHost: 'jawPart' },
  { group: 'jaw', slot: 'jaw', form: 'small', op: 'emit', geom: 'jawSmall', angFrom: 'jawAng', relHost: 'body' },
  // 脸侧顺边带（画序归颌组：带要压过吻板；路径是面甲→颊板→吻板的前缘链）
  { group: 'jaw', op: 'ribbon', hosts: ['visor', 'cheek', 'breather'], paintHosts: ['body'], when: { flag: 'faceStripe' } },
  // 耳六式（颌轴侧件槽单占）
  { group: 'ear', slot: 'ear', form: 'grille', op: 'emit', geom: 'earGrille', relHost: 'body' },
  { group: 'ear', slot: 'ear', form: 'sensor', op: 'emit', geom: 'earSensor', relHost: 'body' },
  { group: 'ear', slot: 'ear', form: 'plateStripe', op: 'emitEach', geom: 'earPlateStripe', relHost: 'body' },
  { group: 'ear', slot: 'ear', form: 'earcover', op: 'emitEach', geom: 'earCover', relHost: 'body' },
  { group: 'ear', slot: 'ear', form: 'disc', op: 'emitEach', geom: 'earDisc', relHost: 'body' },
  { group: 'ear', slot: 'ear', form: 'plate', op: 'emit', geom: 'earPlate', relHost: 'body' },
  // 太阳穴（第二侧件位：栓芯式优先于圆盘式）
  { group: 'temple', op: 'emitEach', geom: 'templeBolt', relHost: 'body', when: { flag: 'templeBolt' } },
  { group: 'temple', op: 'emit', geom: 'templeDisc', relHost: 'body', when: { all: [{ flag: 'templeDisc' }, { notFlag: 'templeBolt' }] } },
];

/** 画序（数据）：节点列按组拼接的次序——顶附属最后画（根压进冠体） */
export const HEAD_DRAW_ORDER = ['base', 'shell', 'crown', 'eye', 'brow', 'cheek', 'jaw', 'ear', 'temple', 'top'];
