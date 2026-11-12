// ============================================================
// 机甲装备与底盘生成器（向导扩展件）：履带底盘 / 轮足 / 蜘蛛腿 /
// 喷射背包 / 武器。构造按参考图抽取的模式组装，落笔只走引擎
// 算子（含新算子 glacis/portArray/nozzle/wing 的实装使用）。
// 每件以挂载点为本地原点出图，验收流程与部位件相同：先单独
// 出图对照参考，合格后才进角色构建。
// ============================================================
import { newCanvas, finishRender, makeLayerTools, SCHEMES, regSeam, capsuleBandTest, capsuleFillTest } from './engine';
import { arcPointsAt, defaultDynamicParams } from '../dynamic-patterns';
import type { Scheme, LegSpec, MechaCanvas, Pt, Anchors, BlockShapeParams } from './engine';

export interface GearSpec {
  scheme: Scheme; seed: number; wear: number; camo: boolean; twoTone: boolean;
  /** 武器尺寸系数（长向 x / 厚向 y 分开，按族参考量比定，见 renderWeapon）；缺省 1 */
  size?: { x: number; y: number };
  /** 块形（模式库「块形·非四边形」）：与躯干/头/臂/车体同口径，工厂钉标准值 */
  blockShape?: BlockShapeParams;
}

/** 椭圆截面（扫掠算子的参数） */
export interface SweepSec { x: number; y: number; rx: number; ry: number }
/** 椭圆扫掠连接面算子（形状）：相邻两截面之间连接面的覆盖与曲面
 * 参数。点在面内 ⟺ 截面族各盘的最小 q ≤ 1（粗采样 + 黄金细化逼到
 * 轮廓本身）；可见面取朝端面一侧的交点；u = sin(θ) 剖面绕轴值、
 * v = 轴向参数 w 本人。构造侧只给两截面——配方只此一份 */
export function sweepSectionTest(a: SweepSec, b: SweepSec) {
  return (x: number, y: number): [boolean, number, number] => {
    const q = (w: number) => {
      const cxw = a.x + (b.x - a.x) * w, cyw = a.y + (b.y - a.y) * w;
      const rxw = a.rx + (b.rx - a.rx) * w, ryw = a.ry + (b.ry - a.ry) * w;
      const dx = (x - cxw) / rxw, dy = (y - cyw) / ryw;
      return dx * dx + dy * dy;
    };
    let bw = 0, bq = q(0);
    for (let i = 1; i <= 12; i++) { const wi = i / 12, qi = q(wi); if (qi < bq) { bq = qi; bw = wi; } }
    {
      let lo = Math.max(0, bw - 1 / 12), hi = Math.min(1, bw + 1 / 12);
      for (let it = 0; it < 6; it++) { const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618; if (q(m1) < q(m2)) hi = m2; else lo = m1; }
      const wm = (lo + hi) / 2, qm = q(wm);
      if (qm < bq) { bq = qm; bw = wm; }
    }
    if (bq > 1.05) return [false, 0, 0];
    let w = 1;
    if (q(1) > 1) {
      let lo = bw, hi = 1;
      for (let it = 0; it < 10; it++) { const mid = (lo + hi) / 2; if (q(mid) > 1) hi = mid; else lo = mid; }
      w = (lo + hi) / 2;
    }
    const cxw = a.x + (b.x - a.x) * w, cyw = a.y + (b.y - a.y) * w;
    const rxw = a.rx + (b.rx - a.rx) * w, ryw = a.ry + (b.ry - a.ry) * w;
    const th = Math.atan2((y - cyw) / ryw, (x - cxw) / rxw);
    return [true, Math.sin(th), w];
  };
}

/** 收尾共通档（标准档）：全族共用的收尾缺省（着色算子的缺省
 * 参数面）。每族的实际取值在各族着色条目的 def.base 里（条目
 * 数据），装配路 fin() 查条目合并——族别差异只在条目，不在此表。
 * 此表是唯一一份：parts.ts 的 fin() 与本文件的 gearFinish 共用，
 * 不许再手抄第二份（gearFinish 曾手抄 seed/bend/detail 三值且漏
 * darkRim/blackGap，单独渲染的装备预览因此缺暗沿与黑隙）。 */
export const FIN_STD: Partial<LegSpec> & { altTone?: boolean; footAlt?: boolean } = {
  topology: 'standard', seed: 11, bend: 22, wear: 0.3, detail: 0.65,
  darkRim: 0.22, // 暗沿基线（模式库「暗沿」算子缺省量；条目可覆写）
  blackGap: 0.7, // 黑隙基线（模式库「黑隙」算子缺省量；条目可覆写）
  seamScale: 1, altTone: false, footAlt: false,
};

export function gearFinish(spec: GearSpec & { phase?: number }): LegSpec & { altTone?: boolean } {
  return {
    ...FIN_STD, scheme: spec.scheme, seed: spec.seed,
    camo: spec.camo, wear: spec.wear, altTone: spec.twoTone,
    ...(spec.phase ? { beltPhase: spec.phase } : {}),
  } as LegSpec & { altTone?: boolean };
}

type Tools = ReturnType<typeof makeLayerTools>;

// ---------- 履带底盘 ----------
// 模式（据坦克足参考×2：生成图 + 陆地战舰）：履带环带（链节分段）
// + 环内负重轮列 + 后驱动轮/前惰轮 + 分段斜面裙甲（glacis）压住
// 环顶 + 甲板与旋转座圈。原点 = 座圈顶面中心（躯干挂载点）。
/** 履带单元画布原点（parts 的 generateMechaTrackUnit 与此处单独画布共用一份——旧时两处各存一份手抄） */
export const TRACK_ORIGIN = { x: 190, y: 26 };
/** 座圈心在履带原点下方的距离：装配时骨盆原点对齐座圈心，挂位由此派生（build-character） */
export const TRACK_SEAT_Y = 5;
/** 喷射背包画布原点（同上，两处共用一份） */
export const JETPACK_ORIGIN = { x: 200, y: 130 };

export interface TrackSpec extends GearSpec {
  len?: number;
  /** 滚动相位 px（0–16 一圈）：链节沿环移、带纹移、轮盘按行程折角 */
  phase?: number;
  /** 环带半径（缺省 33） */ radius?: number;
  /** 环带厚（缺省 15） */ band?: number;
  /** 环心下沉：环心在原点下方的距离（缺省 74） */ drop?: number;
  /** 负重轮数（缺省 6） */ wheels?: number;
  /** 裙甲高（缺省 17，前段 +1） */ skirtH?: number;
  /** 甲板宽占全长比（缺省 0.52） */ deckW?: number;
  /** 甲板高（缺省 14) */ deckH?: number;
  /** 座圈宽×高（缺省 46×9） */ seat?: { w: number; h: number };
}

export function renderTrackUnit(cv: MechaCanvas, spec: TrackSpec, origin: Pt): Anchors {
  const T: Tools = makeLayerTools(cv, spec.seed, spec.blockShape);
  const len = spec.len ?? 252;
  const phase = spec.phase ?? 0;
  const R = spec.radius ?? 33;   // 环带半径
  const band = spec.band ?? 15;  // 环带厚
  const cy = origin.y + (spec.drop ?? 74);   // 环心高（原点下方）
  const cx = origin.x;
  const x0 = cx - len / 2 + R, x1 = cx + len / 2 - R; // 直段两端圆心
  // 履带环带：胶囊距带环（算子 capsuleBandTest）；v 沿长度 → 框件条纹成链节（相位时整纹沿程移）
  T.addRaw('frame', capsuleBandTest(x0, x1, cy, R, band, cx, len, phase));
  // 链节垫：沿整环弧长排小块（垫心在环内 3px、按切线转角），整环
  // 恒定计数——相位时整排沿环移位（底边向后、顶边向前，与带纹/轮转
  // 同向），计数恒定保证后续实例序号不随相位漂移（序号带种子细节）
  {
    const capArc = (Math.PI * R) / 2;
    const straight = x1 - x0;
    const loop = straight * 2 + capArc * 4;
    const nPads = Math.ceil(loop / 16);
    for (let k = 0; k < nPads; k++) {
      const s = (((8 + k * 16 - phase) % loop) + loop) % loop;
      let px: number, py: number, tang: number;
      if (s < capArc) { // 后轮下弧（圆心 x0，角 π→π/2）
        const phi = Math.PI - s / R;
        px = x0 + (R - 3) * Math.cos(phi); py = cy + (R - 3) * Math.sin(phi);
        tang = Math.atan2(-Math.cos(phi), Math.sin(phi));
      } else if (s < capArc + straight) { // 底直段
        px = x0 + (s - capArc); py = cy + R - 3; tang = 0;
      } else if (s < capArc * 2 + straight) { // 前轮下弧（圆心 x1，角 π/2→0）
        const phi = Math.PI / 2 - (s - capArc - straight) / R;
        px = x1 + (R - 3) * Math.cos(phi); py = cy + (R - 3) * Math.sin(phi);
        tang = Math.atan2(-Math.cos(phi), Math.sin(phi));
      } else if (s < capArc * 3 + straight) { // 前轮上弧（圆心 x1，角 0→−π/2）
        const phi = -(s - capArc * 2 - straight) / R;
        px = x1 + (R - 3) * Math.cos(phi); py = cy + (R - 3) * Math.sin(phi);
        tang = Math.atan2(-Math.cos(phi), Math.sin(phi));
      } else if (s < capArc * 3 + straight * 2) { // 顶直段（自前向后）
        px = x1 - (s - capArc * 3 - straight); py = cy - R + 3; tang = Math.PI;
      } else { // 后轮上弧（圆心 x0，角 −π/2→−π）
        const phi = -Math.PI / 2 - (s - capArc * 3 - straight * 2) / R;
        px = x0 + (R - 3) * Math.cos(phi); py = cy + (R - 3) * Math.sin(phi);
        tang = Math.atan2(-Math.cos(phi), Math.sin(phi));
      }
      T.addBlock('frame', px, py, 13, 7, tang, 0.15);
    }
  }
  // 环内暗色机体（胶囊实填，算子 capsuleFillTest）：轮列与驱动轮坐其上，不再悬空
  T.addRaw('frame', capsuleFillTest(x0, x1, cy, R - 3, R, cx, len, phase));
  // 负重轮列（环内贴底）+ 轮毂（关节盘模式：外盘+毂盘，毂比按原半径折算、出图不变）
  const wheels = spec.wheels ?? 6;
  for (let i = 0; i < wheels; i++) {
    const wx = x0 + 6 + (x1 - x0 - 12) * (i / (wheels - 1));
    T.jointDisc({ x: wx, y: cy + R - band - 5 }, 13, 5.5 / 13);
  }
  // 后驱动轮（大、带毂环）与前惰轮
  T.jointDisc({ x: x0, y: cy }, R - 7, 10 / (R - 7));
  T.jointDisc({ x: x1, y: cy }, R - 10, 7 / (R - 10));
  // 分段斜面裙甲（glacis）：三段压住环顶，前段坡更长
  const skirtY = cy - R + 3; // 裙甲压入环顶 7px，不留悬空缝
  const skH = spec.skirtH ?? 17;
  T.glacis(cx - len * 0.31, skirtY, len * 0.34, skH, 12);
  T.glacis(cx + len * 0.02, skirtY, len * 0.3, skH, 12);
  T.glacis(cx + len * 0.33, skirtY - 1, len * 0.28, skH + 1, 20);
  // 甲板 + 座圈（座圈心纵位 = TRACK_SEAT_Y，装配挂位由它派生）
  T.addBlock('plate', cx, origin.y + 16, len * (spec.deckW ?? 0.52), spec.deckH ?? 14, 0, 0.25, true);
  T.addBlock('frame', cx, origin.y + TRACK_SEAT_Y, spec.seat?.w ?? 46, spec.seat?.h ?? 9, 0, 0.2);
  T.finish();
  return T.A;
}

/** 履带底盘单独渲染（验收/预览用）：返回引擎画布 */
export function trackCanvas(spec: TrackSpec): { cv: MechaCanvas; A: Anchors; origin: Pt } {
  const cv = newCanvas();
  const origin = { ...TRACK_ORIGIN };
  const A = renderTrackUnit(cv, spec, origin);
  finishRender(cv, A, gearFinish(spec));
  return { cv, A, origin };
}

export { SCHEMES };


// ---------- 多足腿（蜘蛛/四足共用一个三段腿模式，轮廓参数分家） ----------
// 模式（据蜘蛛 boss + 四足机甲两参考）：三段腿——粗段起身、细段下探、
// 末段近竖直到小楔足；关节全用盘（髋鼓盘/膝盘/踝盘）。蜘蛛 = 膝上拱
// （膝高于髋），四足 = 反关节之字（膝前探、踝后收、末段前伸）。
export interface MultiLegSpec extends GearSpec { profile: 'spider' | 'quad' }

const MULTI_PROFILES = {
  spider: {
    // 姿态据 boss-spider 参考重读（2026-11-08 用户纠正「吊着机身」
    // 后复核）：腿是吊挂式——段一自髋上行外伸（膝为拱顶、高于
    // 髋约 1/3 段长），段二陡直下插、段三近竖直到地，机身悬在
    // 拱下。此前「段一近水平」是误读，已废。两条可完整追踪的后
    // 腿实测（参考图像素，归一到总落差 230）：段一 (+78,−54)、
    // 段二 (+23,+155)、段三 (+6,+129)；段长 ≈ 95/157/129
    knee: { x: 78, y: -54 }, ankle: { x: 23, y: 155 }, toe: { x: 6, y: 129 },
    w: [21, 20, 20, 12, 11, 10] as const, hipR: 13, kneeR: 11, ankleR: 8, toes: 3,
  },
  quad: {
    // 据 mecha-quad 前/后腿读数：段比 ≈ 1 : 0.9 : 0.5（原第三段
    // 过长、读作三节虫腿），膝盘 Ø ≈ 1.5× 小腿宽
    knee: { x: 60, y: 82 }, ankle: { x: -32, y: 86 }, toe: { x: 24, y: 34 },
    w: [30, 26, 17, 15, 12, 10] as const, hipR: 15, kneeR: 13, ankleR: 8, toes: 2,
  },
} as const;

export function renderMultiLeg(cv: MechaCanvas, spec: MultiLegSpec, hip: Pt, pts?: { knee: Pt; ankle: Pt; toe: Pt }, only?: 'upper' | 'mid' | 'foot'): Anchors {
  const T: Tools = makeLayerTools(cv, spec.seed, spec.blockShape);
  const P = MULTI_PROFILES[spec.profile];
  const knee = pts?.knee ?? { x: hip.x + P.knee.x, y: hip.y + P.knee.y };
  const ankle = pts?.ankle ?? { x: knee.x + P.ankle.x, y: knee.y + P.ankle.y };
  const toe = pts?.toe ?? { x: ankle.x + P.toe.x, y: ankle.y + P.toe.y };
  // 组合（全部用已有模式，见 LIBRARY 多足腿组合条）：段 = 段板
  // 组（单块箱体 + 两端套环板），关节 = 关节簇（壳体块 + 盖帽 +
  // 毂）+ 关节内构衬底，accent 带/短划 = 块/小盒 + accent 色角
  // 色，栅 = framedGrille（grille 工具），活塞/连杆 = 活塞对/膝
  // 连杆（rod），装置盒 = 小盒，足 = 多趾垫（垫块 + 一排趾块共
  // 地线）。段做成盘到盘连续体：板全长铺到关节点、衬底先行、
  // 盘压最上，背景不从关节与断口透出
  const angOf = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);
  const at = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const perpOf = (a: Pt, b: Pt): Pt => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: -dy / l, y: dx / l }; };
  const backing = (c: Pt, r: number, ang: number) => T.addBlock('frame', c.x, c.y, r * 2.4, r * 2.4, ang, 0.42);
  const joint = (c: Pt, r: number) => T.jointDisc(c, r); // 关节盘模式（engine 工具，外盘+毂盘）
  const accent = (id: number) => { (T.A.colorRole ??= new Map()).set(id, 'accent'); };
  // 段 = 单块箱体（参考中每段/每级是整块箱体、无横中缝，段内
  // 分界只有纵向面交界与漆带）+ 两端套环板（步级处不设套环）
  const segRun = (a: Pt, b: Pt, wA: number, wB: number, collars: [boolean, boolean] = [true, true]) => {
    T.segPlate(a, b, wA, wB, 0.02, 0.98, 0, 'plate');
    if (collars[0]) T.segPlate(a, b, wA * 1.14, wA * 1.14, 0, 0.09, 0, 'plate');
    if (collars[1]) T.segPlate(a, b, wB * 1.14, wB * 1.14, 0.91, 1, 0, 'plate');
  };
  // accent 带：3px 漆带横贯段面（块 + accent 色角色，不整板染色）
  const bandAt = (a: Pt, b: Pt, wA: number, wB: number, t: number) => {
    const p = at(a, b, t);
    accent(T.addBlock('plate', p.x, p.y, (wA + (wB - wA) * t) * 1.04, 3, angOf(a, b) + Math.PI / 2, 0.08));
  };
  if (only !== 'foot') backing(knee, P.kneeR, angOf(knee, ankle)); // 膝衬底（足件帧里 knee 点=踝，不画）
  if (spec.profile === 'spider') {
    if (only === undefined || only === 'upper') {
      segRun(hip, knee, P.w[0], P.w[1]);
      bandAt(hip, knee, P.w[0], P.w[1], 0.7);
      T.addBlock('frame', hip.x - 8, hip.y, 26, 32, 0, 0.3);
      joint(hip, P.hipR);
    }
    if (only !== 'upper') {
      if (only !== 'foot') {
        // 段二两级：粗级 → 步级（ accent 带压步级）→ 细级（约 0.7 宽）
        const mid2 = at(knee, ankle, 0.45);
        segRun(knee, mid2, P.w[2], P.w[2] * 0.95, [true, false]);
        bandAt(knee, ankle, P.w[2], P.w[3], 0.45);
        segRun(mid2, ankle, P.w[2] * 0.7, P.w[3], [false, true]);
        // 栅（荚口模式：浅三面盒——薄亮顶带＋薄暗侧带＋正面，
        // ann-pod-faces 描面定案；进深/份额为荚锚实测值，见 intake-facts）
        const gv = at(knee, ankle, 0.22);
        T.grille(gv.x, gv.y, P.w[2] * 0.6, 11, [0.08, 0.08], 0.7, 0.15, [0.91, 0.71]);
        // 卡扣框：细级朝髋一侧，四根框条拼矩形框（已有块算子组合）
        const pp = perpOf(knee, ankle);
        const hipSide = Math.sign((hip.x - mid2.x) * pp.x + (hip.y - mid2.y) * pp.y) || 1;
        const cc = at(knee, ankle, 0.68), ca = angOf(knee, ankle);
        const off = (ax: number, pr: number): Pt => ({ x: cc.x + Math.cos(ca) * ax + pp.x * hipSide * pr, y: cc.y + Math.sin(ca) * ax + pp.y * hipSide * pr });
        const cOut = (P.w[2] * 0.7) / 2 + 4;
        const b1 = off(0, cOut + 4), b2 = off(0, cOut - 4), b3 = off(-6.5, cOut), b4 = off(6.5, cOut);
        T.addBlock('frame', b1.x, b1.y, 2.4, 10.5, ca + Math.PI / 2, 0.1);
        T.addBlock('frame', b2.x, b2.y, 2.4, 10.5, ca + Math.PI / 2, 0.1);
        T.addBlock('frame', b3.x, b3.y, 2.4, 15.5, ca, 0.1);
        T.addBlock('frame', b4.x, b4.y, 2.4, 15.5, ca, 0.1);
      }
      backing(ankle, P.ankleR, angOf(ankle, toe)); // 踝衬底：中段件与足件都画（共用关节口径同膝）
      if (only !== 'mid') {
        segRun(ankle, toe, P.w[4], P.w[5]);
        bandAt(ankle, toe, P.w[4], P.w[5], 0.5);
      }
      joint(ankle, P.ankleR);
      if (only !== 'mid') {
        // 足·多趾垫：垫块 + 三趾块一排，趾底共地线
        T.addBlock('plate', toe.x + 1, toe.y + 3, 19, 9, 0.05, 0.3);
        for (const dx of [-7, 0, 7]) T.addBlock('plate', toe.x + 1 + dx, toe.y + 8, 6.5, 5.5, dx * 0.03, 0.3);
      }
    }
    // 膝：壳体块（关节簇壳体）+ 盖帽 + 毂（足件不画）
    if (only !== 'foot') {
      T.addBlock('plate', knee.x, knee.y, P.kneeR * 1.9, P.kneeR * 1.7, (angOf(hip, knee) + angOf(knee, ankle)) / 2, 0.3);
      joint(knee, P.kneeR);
    }
  } else {
    // 四足
    const frontN = (a: Pt, b: Pt): Pt => { const p = perpOf(a, b); return p.x >= 0 ? p : { x: -p.x, y: -p.y }; }; // 前 = +x 侧
    if (only === undefined || only === 'upper') {
      // 大腿：段板组三板摞 + 前脸栅 + accent 短划（小盒 + 色角色）
      T.segPlate(hip, knee, P.w[0], P.w[1], 0.02, 0.34, 1.2, 'plate');
      T.segPlate(hip, knee, P.w[0], P.w[1], 0.36, 0.67, 1.2, 'plate');
      T.segPlate(hip, knee, P.w[0], P.w[1], 0.69, 0.98, 1.2, 'plate');
      const fn = frontN(hip, knee), gp = at(hip, knee, 0.3);
      T.grille(gp.x + fn.x * P.w[0] * 0.16, gp.y + fn.y * P.w[0] * 0.16, P.w[0] * 0.6, 12, [0.08, 0.08], 0.7, 0.15, [0.91, 0.71]); // 荚口浅三面盒（同蜘蛛腿栅，ann-pod-faces）
      const dp = at(hip, knee, 0.52);
      accent(T.addBlock('plate', dp.x + fn.x * (P.w[0] * 0.31), dp.y + fn.y * (P.w[0] * 0.31), 8.5, 3, angOf(hip, knee), 0.2));
      T.addBlock('frame', hip.x - 8, hip.y, 28, 34, 0, 0.3);
      joint(hip, P.hipR);
    }
    if (only !== 'upper') {
      const fn = frontN(knee, ankle), rn = { x: -fn.x, y: -fn.y };
      const wMid = (t: number) => P.w[2] + (P.w[3] - P.w[2]) * t;
      if (only !== 'foot') {
        // 膝连杆：双杆在膝后跨关节（杆 + 销盘，膝盘压其上）
        const rodOff = (a: Pt, b: Pt, t: number, side: number, along: number): Pt => { const p = at(a, b, t); const q = perpOf(a, b); return { x: p.x + rn.x * side + q.x * along, y: p.y + rn.y * side + q.y * along }; };
        for (const s of [-4, 4]) {
          T.rod(rodOff(hip, knee, 0.88, P.w[1] / 2 - 1, s), rodOff(knee, ankle, 0.16, wMid(0.16) / 2 - 1, s), 2.6);
        }
        segRun(knee, ankle, P.w[2], P.w[3]);
        // 小腿后活塞（活塞对：粗筒 + 细杆，画在段板之后贴后缘——
        // 挂在表面上，不是藏在段后）
        const pA = at(knee, ankle, 0.12), pB = at(knee, ankle, 0.9), pM = at(knee, ankle, 0.45);
        T.rod({ x: pA.x + rn.x * (wMid(0.12) / 2 - 1), y: pA.y + rn.y * (wMid(0.12) / 2 - 1) }, { x: pB.x + rn.x * (wMid(0.9) / 2 - 1), y: pB.y + rn.y * (wMid(0.9) / 2 - 1) }, 1.9);
        T.rod({ x: pA.x + rn.x * (wMid(0.12) / 2 - 1), y: pA.y + rn.y * (wMid(0.12) / 2 - 1) }, { x: pM.x + rn.x * (wMid(0.45) / 2 - 1), y: pM.y + rn.y * (wMid(0.45) / 2 - 1) }, 3.1);
        // 装置盒（小盒）：小腿前脸
        const bp = at(knee, ankle, 0.3);
        T.addBlock('plate', bp.x + fn.x * (wMid(0.3) / 2 - 4), bp.y + fn.y * (wMid(0.3) / 2 - 4), P.w[2] * 0.55, 14, angOf(knee, ankle), 0.15);
        const dp2 = at(knee, ankle, 0.62);
        accent(T.addBlock('plate', dp2.x + fn.x * (wMid(0.62) / 2 - 1.5), dp2.y + fn.y * (wMid(0.62) / 2 - 1.5), 7.5, 3, angOf(knee, ankle), 0.2));
      }
      backing(ankle, P.ankleR, angOf(ankle, toe)); // 踝衬底：中段件与足件都画（同蜘蛛）
      if (only !== 'mid') segRun(ankle, toe, P.w[4], P.w[5]);
      joint(ankle, P.ankleR);
      if (only !== 'mid') {
        // 踝第二盘（双盘踝，前后腿样本同见）
        const a2p = at(ankle, toe, 0.3);
        T.jointDisc(a2p, 5.5, 3.2 / 5.5);
        // 足：三趾块一排共地线 + 后跟块（趾排压住末段端、不留断口）
        T.addBlock('plate', toe.x - 10, toe.y + 1, 10, 7, -0.3, 0.3);
        T.addBlock('plate', toe.x, toe.y - 2, 10, 8, angOf(ankle, toe), 0.3);
        T.addBlock('plate', toe.x + 3, toe.y + 2, 16, 8, 0.05, 0.3);
        T.addBlock('plate', toe.x - 8, toe.y + 2.5, 12, 7, -0.1, 0.3);
        T.addBlock('plate', toe.x + 11, toe.y + 2.5, 12, 7, 0.14, 0.3);
      }
    }
    // 膝：壳体块 + 盖帽 + 毂（同蜘蛛膝式，足件不画）
    if (only !== 'foot') {
      T.addBlock('plate', knee.x, knee.y, P.kneeR * 1.9, P.kneeR * 1.7, (angOf(hip, knee) + angOf(knee, ankle)) / 2, 0.3);
      joint(knee, P.kneeR);
    }
  }
  T.finish();
  return T.A;
}

/** 多足腿几何（轮廓相对点 → 段长与静止角，供分段精灵与节点链接线）。
 *  lenMul = 整机比例的腿长倍率（等比缩放轮廓点，角度不变） */
export function multiLegGeom(profile: 'spider' | 'quad', lenMul = 1): { l1: number; l2: number; l3: number; a1: number; a2rel: number; a3rel: number; toeVec: Pt; a2: number; a3: number } {
  const P0 = MULTI_PROFILES[profile];
  const P = lenMul === 1 ? P0 : { ...P0, knee: { x: P0.knee.x * lenMul, y: P0.knee.y * lenMul }, ankle: { x: P0.ankle.x * lenMul, y: P0.ankle.y * lenMul }, toe: { x: P0.toe.x * lenMul, y: P0.toe.y * lenMul } };
  const p0 = { x: 0, y: 0 }, p1 = P.knee, p2 = { x: P.knee.x + P.ankle.x, y: P.knee.y + P.ankle.y };
  const toeVec = P.toe;
  const segAng = (dx: number, dy: number) => (Math.atan2(-dx, dy) * 180) / Math.PI;
  const a1 = segAng(p1.x - p0.x, p1.y - p0.y);
  const a2 = segAng(p2.x - p1.x, p2.y - p1.y);
  const a3 = segAng(toeVec.x, toeVec.y);
  return { l1: Math.hypot(p1.x, p1.y), l2: Math.hypot(p2.x - p1.x, p2.y - p1.y), l3: Math.hypot(toeVec.x, toeVec.y), a1, a2rel: a2 - a1, a3rel: a3 - a2, toeVec, a2, a3 };
}

export { MULTI_PROFILES };

/** 多足腿单独渲染（验收/预览用） */
export function multiLegCanvas(spec: MultiLegSpec): { cv: MechaCanvas; A: Anchors; origin: Pt } {
  const cv = newCanvas();
  const origin = { x: 56, y: 64 };
  const A = renderMultiLeg(cv, spec, origin);
  finishRender(cv, A, gearFinish(spec));
  return { cv, A, origin };
}

// ---------- 喷射背包 ----------
// 模式（据参考三样本横读，2026-11-10 整机轮）：背部单元是成套的
// 大件——主箱（分面板 + 散热栅）+ 双长筒推进器（自箱底垂落、
// 筒身带箍环、底端喷口钟）+ 后掠翼组（上小鳍 + 主翼向后下扫）
// + 后缘燃料罐柱。纵向总跨按族经 size 给：敏捷参考约 46% 身高、
// 主战约 37%。旧版只有小箱 + 短喷口（约 18%），读作小背包。
// 火焰不入图（动态效果，非机体本体）。原点 = 贴背挂载点（箱前
// 面中心），箱体在原点后方展开。
export type JetpackSpec = GearSpec;

export function renderJetpack(cv: MechaCanvas, spec: JetpackSpec, origin: Pt): Anchors {
  const T: Tools = makeLayerTools(cv, spec.seed, spec.blockShape);
  const ox = origin.x, oy = origin.y;
  const W = spec.size?.x ?? 1, S = spec.size?.y ?? 1;
  // 远推进器先画（在后）：长筒自箱底垂落（装甲色板身 + 暗箍环）+ 底喷口钟
  T.addBlock('plate', ox - 62 * W, oy + 95 * S, 17 * W, 150 * S, 0, 0.45);
  T.addBlock('frame', ox - 62 * W, oy + 40 * S, 21 * W, 10 * S, 0, 0.3);
  T.addBlock('frame', ox - 62 * W, oy + 118 * S, 20 * W, 8 * S, 0, 0.3);
  T.nozzle({ x: ox - 62 * W, y: oy + 166 * S }, { x: ox - 63 * W, y: oy + 190 * S }, 8 * W, 12.5 * W);
  // 后缘燃料罐柱 + 罐顶盖
  T.addBlock('cyl', ox - 58 * W, oy - 2 * S, 21 * W, 86 * S, 0, 0.42);
  T.addDisc('disc', { x: ox - 58 * W, y: oy - 46 * S }, 10 * W);
  // 主箱（大箱 + 上分面板 + 顶盖 + 底框）
  T.addBlock('plate', ox - 26 * W, oy + 6 * S, 56 * W, 118 * S, 0, 0.3, true);
  T.addBlock('plate', ox - 28 * W, oy - 34 * S, 42 * W, 36 * S, 0, 0.32);
  T.addBlock('frame', ox - 26 * W, oy - 58 * S, 50 * W, 10 * S, 0, 0.3);
  T.addBlock('frame', ox - 28 * W, oy + 52 * S, 44 * W, 16 * S, 0, 0.3);
  // 近推进器（主）：更粗更长，喷口钟收底
  T.addBlock('plate', ox - 36 * W, oy + 105 * S, 19 * W, 165 * S, 0, 0.45);
  T.addBlock('frame', ox - 36 * W, oy + 48 * S, 23 * W, 10 * S, 0, 0.3);
  T.addBlock('frame', ox - 36 * W, oy + 128 * S, 22 * W, 8 * S, 0, 0.3);
  T.nozzle({ x: ox - 36 * W, y: oy + 182 * S }, { x: ox - 38 * W, y: oy + 206 * S }, 9 * W, 13 * W);
  // 翼组：顶部小鳍（后上掠）+ 主翼（根贴箱顶后缘、向后下约 42° 长扫）+ 下稳定翼
  T.wing(ox - 52 * W, oy - 58 * S, 62 * W, 22 * S, 8, -2.62);
  T.wing(ox - 55 * W, oy + 2 * S, 105 * W, 52 * S, 10, 2.38);
  T.wing(ox - 58 * W, oy + 66 * S, 44 * W, 14 * S, 6, 2.55);
  // 顶提手 + 散热栅 + 信号灯
  T.addBlock('frame', ox - 30 * W, oy - 68 * S, 26 * W, 7 * S, 0, 0.3);
  T.flatGrille(ox - 24 * W, oy + 14 * S, 30 * W, 15 * S); // 背箱面是平面：平口不起盒
  T.A.lightPts.push({ x: ox - 6 * W, y: oy - 44 * S });
  T.finish();
  return T.A;
}

/** 喷射背包单独渲染（验收/预览用） */
export function jetpackCanvas(spec: JetpackSpec): { cv: MechaCanvas; A: Anchors; origin: Pt } {
  const cv = newCanvas();
  const origin = { ...JETPACK_ORIGIN };
  const A = renderJetpack(cv, spec, origin);
  finishRender(cv, A, gearFinish(spec));
  return { cv, A, origin };
}

// ---------- 武器三件 ----------
// 模式（据图库参考）：臂炮 = 小机匣 + 长炮管主导 + 色环 + 炮口
// 环/膛 + 侧弹鼓 + 顶部肋杆；导弹荚 = 开放框 + 横置弹列（侧面
// 构图）；步枪 = 托匣一体细长 + 细管带尖 + 斜弹匣 + 低矮瞄具。
// 原点：臂炮/步枪 = 握持/套筒点，导弹荚 = 底部肩挂点。朝向 +x。
export type WeaponSpec = GearSpec;
export type WeaponKind = 'cannon' | 'pod' | 'rifle' | 'podPylon';

/** 武器模式（模式库「武器」条目）：构造 = 单位坐标步序数据（声明），
 *  renderWeapon 只做解释（步序 × 尺寸系数落笔）。坐标语义：x 沿长向、
 *  y 沿厚向，落笔时 x·ux / y·uy；原点语义见各 kind 注释 */
type WeaponBlockKind = 'disc' | 'plate' | 'frame';
type WeaponRole = 'armor' | 'armor2' | 'accent' | 'mark' | 'steel';
type WeaponStep =
  | { t: 'disc'; kind: WeaponBlockKind; x: number; y: number; r: number; role?: WeaponRole }
  | { t: 'ball'; x: number; y: number; r: number; role?: WeaponRole }
  | { t: 'block'; kind: WeaponBlockKind; x: number; y: number; w: number; h: number; ang?: number; cham?: number; bolts?: boolean; role?: WeaponRole }
  | { t: 'poly'; pts: [number, number][]; role?: WeaponRole; tint?: number }
  | { t: 'rod'; x0: number; y0: number; x1: number; y1: number; r: number }
  | { t: 'sweep'; secs: { x: number; y: number; rx: number; ry: number }[]; role?: WeaponRole }
  | { t: 'ports'; x: number; y: number; w: number; h: number; cols: number; rows: number }
  | { t: 'light'; x: number; y: number }
  | { t: 'arc'; x0: number; y0: number; x1: number; y1: number; seed: number }
  | { t: 'podBox'; x: number; y: number; rows?: number; open?: boolean };
/** 导弹荚体（组合制的荚主体）：侧面构图（据主战侧挂荚）——
 * 外壳框 + 开放框内横置弹列（弹体杆 + 弹头 + 尾翼）+ 顶轨。
 * 弹列数是参数（rows），3 列时与旧写死表逐项一致 */
function podBoxSteps(rows: number, open = false): WeaponStep[] {
  const H = 42 + (rows - 3) * 11;
  if (open) {
    // 全露式（z3 见证，与闭合式并列为荚的变体槽）：厚框 + 暗腔 + 弹列
    // 全露——弹身钢灰、弹尖亮钢、尖后强调色环带、尾鳍簇在框内后端。
    // 框壁厚 7（≈荚高 0.16），弹尖收在框口之内、不探出。
    const steps: WeaponStep[] = [
      { t: 'block', kind: 'plate', x: 0, y: 0, w: 86, h: H, cham: 0.22, bolts: true },
      { t: 'block', kind: 'frame', x: -2, y: 0, w: 76, h: H - 10, cham: 0.18 },
    ];
    for (let i = 0; i < rows; i++) {
      const y = (i - (rows - 1) / 2) * 11;
      steps.push(
        { t: 'poly', pts: [[-32, y - 4.2], [20, y - 4.2], [20, y + 4.2], [-32, y + 4.2]], role: 'steel', tint: 2.2 },
        { t: 'poly', pts: [[15, y - 4.2], [19, y - 4.2], [19, y + 4.2], [15, y + 4.2]], role: 'accent' },
        { t: 'poly', pts: [[20, y - 4.2], [27, y - 2.4], [34, y], [27, y + 2.4], [20, y + 4.2]], role: 'steel', tint: 2.6 },
        { t: 'poly', pts: [[-32, y - 1.5], [-24, y - 8], [-21, y - 1.5]], role: 'steel', tint: 1.5 },
        { t: 'poly', pts: [[-32, y + 1.5], [-24, y + 8], [-21, y + 1.5]], role: 'steel', tint: 1.5 },
      );
    }
    steps.push(
      { t: 'block', kind: 'plate', x: 0, y: -(H / 2 - 3.5), w: 86, h: 7, cham: 0.3, role: 'armor' },
      { t: 'block', kind: 'plate', x: 0, y: H / 2 - 3.5, w: 86, h: 7, cham: 0.3, role: 'armor' },
      { t: 'block', kind: 'plate', x: -39.5, y: 0, w: 7, h: H, cham: 0.3, role: 'armor' },
      { t: 'block', kind: 'plate', x: 39.5, y: 0, w: 7, h: H, cham: 0.3, role: 'armor' },
    );
    return steps;
  }
  const steps: WeaponStep[] = [
    { t: 'block', kind: 'plate', x: 0, y: 0, w: 86, h: 42 + (rows - 3) * 11, cham: 0.22, bolts: true },
    { t: 'block', kind: 'frame', x: -1, y: 0, w: 79, h: 35 + (rows - 3) * 11, cham: 0.2 },
  ];
  for (let i = 0; i < rows; i++) {
    const y = (i - (rows - 1) / 2) * 11;
    steps.push(
      { t: 'rod', x0: -8, y0: y, x1: 38, y1: y, r: 5.5 },
      { t: 'poly', pts: [[37, y - 5], [51, y], [37, y + 5]], role: 'steel' },
      { t: 'poly', pts: [[-13, y - 1.5], [-1, y - 9.5], [1, y - 1.5]], role: 'steel' },
      { t: 'poly', pts: [[-13, y + 1.5], [-1, y + 9.5], [1, y + 1.5]], role: 'steel' },
    );
  }
  // 侧面是闭合面板（参考三式皆然：s2 箱身+前脸探尖、主战圆柱荚、
  // 载具箱），弹身不外露——副色面板盖住弹身，只留弹颈与弹尖在
  // 箱体前缘之外探出，深色框边露在面板四周成嵌板读法
  steps.push({ t: 'block', kind: 'plate', x: -4, y: 0, w: 68, h: 31 + (rows - 3) * 11, cham: 0.2, role: 'armor2' });
  steps.push(
    { t: 'block', kind: 'frame', x: 0, y: -25 - (rows - 3) * 5.5, w: 72, h: 7, cham: 0.3 },
    { t: 'block', kind: 'plate', x: -24, y: -31 - (rows - 3) * 5.5, w: 9, h: 5, cham: 0.25 },
    { t: 'block', kind: 'plate', x: 0, y: -31 - (rows - 3) * 5.5, w: 9, h: 5, cham: 0.25 },
    { t: 'block', kind: 'plate', x: 24, y: -31 - (rows - 3) * 5.5, w: 9, h: 5, cham: 0.25 },
    { t: 'block', kind: 'frame', x: 45, y: 0, w: 7, h: 36 + (rows - 3) * 11, cham: 0.25 },
    { t: 'light', x: -30, y: -17 - (rows - 3) * 5.5 },
  );
  return steps;
}
const POD_BOX_STEPS: WeaponStep[] = podBoxSteps(3);
// ---------- 武器组合制 ----------
// 武器 = 模式组合（用户 2026-11-08 立）：类系（热兵器/科幻/
// 冷兵器）× 通用部件轴（主体/作用段/供能/瞄具/握持/附属），
// 预设只是命名的组合。组合 → 步序（weaponComboSteps）→ 同一
// 解释器落笔；旧四种（臂炮/步枪/导弹荚/高架荚）是预设组合，
// 其步序与此前写死表逐项一致（尾翼角度一处按多数行统一）。
export type WeaponClass = 'hot' | 'scifi' | 'cold';
export interface WeaponCombo {
  cls: WeaponClass;
  body: string;      // 主体：sleeve/long/short/core/ringCore/pod/none
  effector: string;  // 作用段：cannonBarrel/barrel/brakeBarrel/slimBarrel/twinBarrel/coil/emitter/beamTube/blade/curvedBlade/serrated/axe/hammer/spear/beamEdge/none
  feed: string;      // 供能：drum/mag/magBig/belt/cell/tank/none
  sight: string;     // 瞄具：low/tall/mast/ringSight/none
  grip: string;      // 握持：stockGrip/stock/handle/sleeve/shoulder/pylon/gripGuard/gripDisc/gripLong/gripEmitter/none
  rows?: number;     // 荚弹列数（body=pod）
  podOpen?: boolean; // 荚式（body=pod）：true = 全露开放框式（z3 见证）；缺省 = 闭合面板式（S 轮三式见证）——变体槽两式并存
  len?: number;      // 作用段长度（单位坐标）
  bore?: number;     // 口径/刃宽倍率
  ring?: boolean;    // 附属：强调色环
  rail?: boolean;    // 附属：导轨/肋杆
  cable?: boolean;   // 附属：供弹/供能缆
  lamp?: boolean;    // 附属：光点
  glow?: boolean;    // 科幻：发光（核/刃/瞄准环走强调色 + 光点）
}
type WLayout = { cx: number; front: number; rear: number; top: number; bot: number; y0: number };
const WBODY_LAYOUT: Record<string, WLayout> = {
  sleeve: { cx: 22, front: 50, rear: -6, top: -19, bot: 19, y0: 0 },
  long: { cx: 2, front: 29, rear: -25, top: -9.5, bot: 9.5, y0: -1 },
  short: { cx: 8, front: 26, rear: -10, top: -12, bot: 12, y0: 0 },
  core: { cx: 16, front: 39, rear: -7, top: -16, bot: 16, y0: 0 },
  chamber: { cx: 18, front: 46, rear: -10, top: -22, bot: 22, y0: 0 },
  ringCore: { cx: 15, front: 42, rear: -10, top: -13.5, bot: 13.5, y0: 0 },
  none: { cx: 0, front: 0, rear: 0, top: 0, bot: 0, y0: 0 },
};
const B = (kind: WeaponBlockKind, x: number, y: number, w: number, h: number, extra?: Partial<Extract<WeaponStep, { t: 'block' }>>): WeaponStep => ({ t: 'block', kind, x, y, w, h, ...extra });
const D = (kind: WeaponBlockKind, x: number, y: number, r: number, role?: WeaponRole): WeaponStep => ({ t: 'disc', kind, x, y, r, ...(role ? { role } : {}) });
const R = (x0: number, y0: number, x1: number, y1: number, r: number): WeaponStep => ({ t: 'rod', x0, y0, x1, y1, r });
const CY = (x0: number, y0: number, x1: number, y1: number, r: number): WeaponStep => ({ t: 'rod', x0, y0, x1, y1, r });

function wBodySteps(c: WeaponCombo, L: WLayout): WeaponStep[] {
  switch (c.body) {
    case 'sleeve': return [B('plate', 22, 0, 56, 38, { cham: 0.3, bolts: true }), B('plate', 17, -13.5, 42, 12, { cham: 0.3 }), B('plate', 0, -2, 15, 26, { cham: 0.3, role: 'armor' })];
    // 长机匣走钢色系（可读性裁定，s3 见证）：族色机匣贴身即隐，钢色与任何族甲都分得开——此式即步枪的长匣形，色随形走
    case 'long': return [B('plate', 2, 0, 54, 19, { cham: 0.28, bolts: true, role: 'steel' })];
    case 'short': return [B('plate', 8, 0, 36, 24, { cham: 0.3, bolts: true })];
    case 'core': return [B('plate', 16, 0, 46, 32, { cham: 0.3, bolts: true }), D('frame', 16, 0, 15.5), D('disc', 16, 0, 11.5, c.glow ? 'accent' : undefined)];
    case 'chamber': return [B('plate', 18, 0, 56, 44, { cham: 0.28, bolts: true }), D('frame', 14, 0, 17.5), D('disc', 14, 0, 12.5, c.glow ? 'accent' : undefined)];
    case 'ringCore': return [B('plate', 15, 0, 50, 27, { cham: 0.3 }), D('frame', 3, 0, 12), D('frame', 17, 0, 13.5, c.glow ? 'accent' : undefined), D('disc', 17, 0, 7.5), D('frame', 31, 0, 12)];
    default: return [];
  }
}
function wEffectorSteps(c: WeaponCombo, L: WLayout): WeaponStep[] {
  const len = c.len ?? 110, bore = c.bore ?? 1, f = L.front, y0 = L.y0;
  const ringStep: WeaponStep[] = c.ring && c.cls !== 'cold' ? [B('plate', f + len * 0.576, y0, 6, 26 * bore, { cham: 0.15, role: 'accent' })] : [];
  switch (c.effector) {
    case 'cannonBarrel': return [R(f - 6, y0, f + len, y0, 11 * bore), ...ringStep, B('plate', f + len * 0.865, y0, len * 0.16, 27 * bore, { cham: 0.25, role: 'armor' }), B('frame', f + len - 1, y0, 13, 26 * bore, { cham: 0.18 }), B('frame', f + len + 5.5, y0, 5, 21 * bore, { cham: 0.2 })];
    case 'barrel': return [R(f - 4, y0, f + len, y0, 6 * bore), ...ringStep, B('frame', f + len, y0, 7, 15 * bore, { cham: 0.2 })];
    case 'brakeBarrel': return [R(f - 4, y0, f + len, y0, 6.5 * bore), B('frame', f + len - 2, y0, 15, 16 * bore, { cham: 0.2 }), { t: 'ports', x: f + len - 2, y: y0, w: 12, h: 12 * bore, cols: 3, rows: 2 }];
    // 细管改管组（可读性裁定，z1 双杆见证）：主杆加粗 + 下副杆（导气管）与主杆成组，单根 5px 细线在整机图里不成读法
    case 'slimBarrel': return [B('plate', f + len * 0.10, y0, len * 0.20, 12 * bore, { cham: 0.25 }), R(f + 5, y0, f + len, y0, 4.6 * bore), R(f + len * 0.30, y0 + 5.4 * bore, f + len * 0.97, y0 + 5.4 * bore, 1.7 * bore), R(f + len, y0, f + len + 12, y0, 2.5 * bore), B('frame', f + len + 1, y0, 5, 10.5 * bore, { cham: 0.2 })];
    case 'twinBarrel': return [R(f - 2, y0 - 7 * bore, f + len, y0 - 7 * bore, 5 * bore), R(f - 2, y0 + 7 * bore, f + len, y0 + 7 * bore, 5 * bore), B('frame', f + len + 1, y0 - 7 * bore, 5, 12 * bore, { cham: 0.2 }), B('frame', f + len + 1, y0 + 7 * bore, 5, 12 * bore, { cham: 0.2 })];
    case 'coil': {
      const steps: WeaponStep[] = [R(f - 2, y0 - 7 * bore, f + len, y0 - 7 * bore, 3), R(f - 2, y0 + 7 * bore, f + len, y0 + 7 * bore, 3)];
      for (const t of [0.18, 0.42, 0.66, 0.88]) { steps.push(B('plate', f + len * t - 4.5, y0, 7.5, 26 * bore, { cham: 0.3, role: c.glow ? 'accent' : undefined })); steps.push(B('plate', f + len * t + 4.5, y0, 5, 26 * bore, { cham: 0.3, role: c.glow ? 'accent' : undefined })); }
      steps.push(D('disc', f + len + 2, y0, 5 * bore));
      if (c.glow) steps.push({ t: 'light', x: f + len + 2, y: y0 });
      return steps;
    }
    case 'emitter': return [R(f - 2, y0, f + len * 0.74, y0, 8.5 * bore), B('frame', f + len * 0.87, y0 - 10.5 * bore, len * 0.26, 10 * bore, { ang: -0.07, cham: 0.25 }), B('frame', f + len * 0.87, y0 + 10.5 * bore, len * 0.26, 10 * bore, { ang: 0.07, cham: 0.25 }), ...(c.glow ? [{ t: 'light', x: f + len * 0.88, y: y0 } as WeaponStep, { t: 'arc', x0: f + len, y0: y0 - 10 * bore, x1: f + len, y1: y0 + 10 * bore, seed: 7 } as WeaponStep] : [])];
    case 'beamTube': return [R(f - 2, y0, f + len, y0, 6.5 * bore), B('frame', f + 5, y0, 7, 17 * bore, { cham: 0.2 }), { t: 'poly', pts: [[f + len - 4, y0 - 5 * bore], [f + len + 9, y0 - 10.5 * bore], [f + len + 12, y0], [f + len + 9, y0 + 10.5 * bore], [f + len - 4, y0 + 5 * bore]] }, ...(c.glow ? [{ t: 'light', x: f + len + 3, y: y0 } as WeaponStep] : [])];
    // 刃宽定版：刃身全宽/刃长 ≈ 0.17（z4 大剑读数 0.16–0.18）；旧半宽 6.2·bore 只 0.10、细形被描边吃满几乎全黑
    case 'blade': return [{ t: 'poly', pts: [[2, -10.2 * bore], [len * 0.84, -10.2 * bore], [len, 1.5 * bore], [len * 0.94, 10.2 * bore], [2, 10.2 * bore]], role: 'steel' }, B('frame', f + len * 0.47, y0, len * 0.76, 1.7, { cham: 0.2 })];
    case 'curvedBlade': return [{ t: 'poly', pts: [[2, -10.3 * bore], [len * 0.35, -11.4 * bore], [len * 0.72, -10.4 * bore], [len, -15.8 * bore], [len * 0.9, 0.8 * bore], [len * 0.6, 10.4 * bore], [len * 0.3, 12.3 * bore], [2, 10.7 * bore]], role: 'steel' }];
    case 'serrated': {
      const steps: WeaponStep[] = [{ t: 'poly', pts: [[2, -10.2 * bore], [len * 0.8, -7 * bore], [len, 0], [len * 0.8, 7 * bore], [2, 10.2 * bore]], role: 'steel' }];
      for (const t of [0.25, 0.45, 0.65]) steps.push(B('plate', len * t, -11 * bore, 7, 3.6, { ang: 0.5, cham: 0.2 }));
      return steps;
    }
    case 'axe': return [B('frame', 7, 0, 15, 13.5, { cham: 0.25 }), { t: 'poly', pts: [[4, -5 * bore], [len * 0.5, -23 * bore], [len * 0.95, -16 * bore], [len * 1.05, 0], [len * 0.9, 13 * bore], [len * 0.45, 18 * bore], [4, 5 * bore], [len * 0.3, 0]], role: 'steel' }, { t: 'poly', pts: [[4, -6], [-14, -11], [2, 2]], role: 'steel' }];
    case 'hammer': return [B('plate', 17, 0, 32, 23 * bore, { cham: 0.18, bolts: true }), B('frame', 31, 0, 7, 26 * bore, { cham: 0.2 }), B('plate', 17, 3, 9, 9, { cham: 0.25, role: 'accent' }), R(2, 0, -15, 0, 3), ...(c.ring ? [B('plate', 17, -8 * bore, 34, 4.5, { cham: 0.2, role: 'accent' })] : [])];
    case 'spear': return [{ t: 'poly', pts: [[2, -3.5 * bore], [len * 0.3, -8.5 * bore], [len * 0.78, -5 * bore], [len, 0], [len * 0.78, 5 * bore], [len * 0.3, 8.5 * bore], [2, 3.5 * bore]], role: 'steel' }, B('frame', f + len * 0.45, y0, len * 0.7, 1.7, { cham: 0.2 }), B('frame', 4, 0, 4.5, 16, { cham: 0.2 })];
    case 'beamEdge': return [{ t: 'poly', pts: [[6, -5 * bore], [len * 0.88, -5 * bore], [len, -1.2 * bore], [len * 0.96, 3.6 * bore], [len * 0.78, 5 * bore], [6, 5 * bore]], role: 'accent' }, ...(c.glow ? [{ t: 'light', x: len * 0.5, y: 0 } as WeaponStep, { t: 'light', x: len * 0.85, y: 0 } as WeaponStep] : [])];
    default: return [];
  }
}
/** 弹鼓：椭圆扫掠画法（用户定）——先立底面椭圆（只定几何、不单独
 * 着色），再逐个立后续椭圆，相邻椭圆之间的连接面是一个表面、按桶
 * 着色；叠到最后一个椭圆，才给端面椭圆着色。全部截面是同一个椭圆
 * (0.37R, 0.91R)、只沿轴偏移——等大截面才是圆柱（沿轴收缩是锥体，
 * 一度误改已撤销）。站位据生成参考 ref-cannon 弹鼓放大读数：带界
 * 在中高处 x=−0.74R/−0.16R，即截面左弧过这两处 → 相邻截面圆心
 * −0.37/+0.21，底截面 −0.63、端面 +0.57。
 * 着色教训：桶面参数必须按曲面取（w 定段界、落点是截面椭圆弧；
 * θ 定剖面明暗）——按屏幕投影取 w 时箍是竖直直线、与横缝织成
 * 矩形格，那是着色错误、与结构无关（曾误判结构连改两版）。 */
function wDrumSteps(L: WLayout): WeaponStep[] {
  const cx = L.cx + 2, cy = L.bot + 6, r = (L.bot - L.top) * 0.62;
  const ERX = 0.37, ERY = 0.91; // 截面/端面椭圆半轴（×r），全程等大
  const sec = (s: number) => ({ x: cx + s * r, y: cy, rx: ERX * r, ry: ERY * r });
  const steps: WeaponStep[] = [
    { t: 'sweep', secs: [sec(-0.63), sec(-0.37)], role: 'steel' },
    { t: 'sweep', secs: [sec(-0.37), sec(0.21)], role: 'armor' },
    { t: 'sweep', secs: [sec(0.21), sec(0.57)], role: 'steel' },
  ];
  // 端面椭圆着色：深钢面 + 内圈 + 沿椭圆一圈栓 + 中心栓
  // （端面轮廓本来就露在外，不归「被盖住」之列——用户裁定）
  const ex = cx + 0.57 * r, ey = cy;
  const ell = (erx: number, ery: number): [number, number][] => Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return [ex + Math.cos(a) * erx * r, ey + Math.sin(a) * ery * r] as [number, number]; });
  steps.push({ t: 'poly', role: 'steel', tint: 0.55, pts: ell(ERX, ERY) });
  steps.push({ t: 'poly', role: 'steel', tint: 0.72, pts: ell(0.29, 0.78) });
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + 0.2; steps.push(D('disc', ex + Math.cos(a) * 0.33 * r, ey + Math.sin(a) * 0.845 * r, r * 0.045)); }
  steps.push(D('disc', ex, ey, r * 0.05));
  // 亮钢段与灰钢段的连接面上的栓（沿两截面左弧中点、上下各一）
  const leftArc = (s: number, y: number) => cx + s * r - ERX * r * Math.sqrt(Math.max(0, 1 - (y / (ERY * r)) ** 2));
  for (const y of [-0.45, 0.45]) {
    steps.push(D('disc', (leftArc(-0.63, y * r) + leftArc(-0.37, y * r)) / 2, cy + y * r, r * 0.05));
    steps.push(D('disc', (leftArc(0.21, y * r) + leftArc(0.57, y * r)) / 2, cy + y * r, r * 0.05));
  }
  return steps;
}
function wFeedSteps(c: WeaponCombo, L: WLayout, phase: 'pre' | 'main'): WeaponStep[] {
  if (c.feed === 'drum') return phase === 'pre' ? wDrumSteps(L) : [];
  if (phase === 'pre') return [];
  switch (c.feed) {
    case 'mag': return [B('frame', L.cx + 12, L.bot + 11, 10, 26, { ang: 0.35, cham: 0.25 }), B('plate', L.cx + 7.5, L.bot + 23.5, 11, 3.5, { ang: 0.35, cham: 0.2 })]; // 肋纹箱身 + 底板 = 弹匣读法
    case 'magBig': return [B('frame', L.cx + 10, L.bot + 15, 12.5, 36, { ang: 0.3, cham: 0.25 })];
    case 'belt': return [R(L.rear - 2, L.bot - 2, L.rear - 15, L.bot + 5, 3), B('frame', L.rear - 17, L.bot + 4, 27, 17, { cham: 0.25 })];
    case 'cell': return [B('frame', L.cx - 2, L.bot + 14, 18, 28, { cham: 0.2 }), B('plate', L.cx - 2, L.bot + 5.5, 13, 6, { cham: 0.2, role: c.glow ? 'accent' : 'armor2' }), B('plate', L.cx - 2, L.bot + 14, 13, 6, { cham: 0.2, role: c.glow ? 'accent' : 'armor2' }), B('plate', L.cx - 2, L.bot + 22.5, 13, 6, { cham: 0.2, role: c.glow ? 'accent' : 'armor2' })];
    case 'tank': {
      const steps: WeaponStep[] = [];
      for (const dx of [-13, 0, 13]) { steps.push(B('plate', L.cx + dx, L.top - 7, 8.5, 13, { cham: 0.25 })); steps.push(B('plate', L.cx + dx, L.top - 14.5, 9.5, 3.5, { cham: 0.3, role: c.glow ? 'accent' : undefined })); }
      return steps;
    }
    case 'tankTwin': return [R(L.rear + 4, L.top - 7, L.cx + 13, L.top - 7, 7), R(L.cx + 21, L.top - 7, L.front - 2, L.top - 7, 7), B('frame', L.rear + 2, L.top - 7, 5, 15, { cham: 0.2 }), B('frame', L.cx - 1, L.top - 7, 5, 15.5, { cham: 0.2 }), B('frame', L.front - 1, L.top - 7, 5, 15, { cham: 0.2 })];
    default: return [];
  }
}
function wGripSteps(c: WeaponCombo, phase: 'pre' | 'post'): WeaponStep[] {
  const L = WBODY_LAYOUT[c.body] ?? WBODY_LAYOUT.none!;
  if (phase === 'pre') {
    if (c.grip === 'stock') return [B('plate', L.rear - 8, 0, 36, 15, { ang: 0.06, cham: 0.3, role: 'armor' })];
    if (c.grip === 'stockGrip') return [B('plate', L.rear - 8, 0, 36, 15, { ang: 0.06, cham: 0.3, role: c.body === 'long' ? 'steel' : 'armor' })]; // 枪托随机匣系：长匣步枪走钢色
    if (c.grip === 'frameStock') return [R(L.rear - 2, -5, L.rear - 36, -11, 2.6), R(L.rear - 2, 7, L.rear - 36, 13, 2.6), B('plate', L.rear - 39, 1, 7, 27, { cham: 0.25 })];
    return [];
  }
  switch (c.grip) {
    case 'handle': case 'frameStock': return [B('frame', L.cx - 16, L.bot + 6, 10.5, 20, { ang: -0.25, cham: 0.25 })];
    // 枪托握把独立成形：与弹匣（frame 肋纹箱、前倾）异形——板式深色握把、更小、后倾；旧式与弹匣共用同一 frame 箱步，两件读作同形黑箱并立（z1：匣大而弯、把短而斜）。色走 frame 深色（s3 的握把读法），与钢色机匣和肋纹弹匣靠形与纹再分
    case 'stockGrip': return [B('plate', L.cx - 15, L.bot + 5, 9, 17, { ang: -0.38, cham: 0.3, role: 'frame' })];
    case 'gripGuard': return [R(-27, 0, 0, 0, 5), B('frame', -8, 0, 2.2, 11.5, { cham: 0.2 }), B('frame', -15, 0, 2.2, 11.5, { cham: 0.2 }), B('frame', -22, 0, 2.2, 11.5, { cham: 0.2 }), B('frame', 0, 0, 4.5, 27, { cham: 0.3 }), D('disc', -30, 0, 6.5)];
    case 'gripDisc': return [R(-27, 0, 0, 0, 5), B('plate', 0, 0, 6.5, 30, { cham: 0.25 }), D('disc', 0, 0, 4.5), D('disc', -30, 0, 6.5)];
    case 'gripLong': return [R(-94, 0, 0, 0, 6), B('frame', -20, 0, 5, 12.5, { cham: 0.2 }), B('plate', -48, 0, 7, 13.5, { cham: 0.3 }), B('frame', -76, 0, 5, 12.5, { cham: 0.2 }), D('disc', -97, 0, 7.5), { t: 'poly', pts: [[-101, -3.4], [-112, 0], [-101, 3.4]], role: 'steel' }];
    case 'gripEmitter': return [B('plate', -14, 0, 26, 12, { cham: 0.3, bolts: true }), B('plate', -18, 7.5, 9, 5.5, { cham: 0.2, role: 'accent' }), B('plate', -7, 7.5, 9, 5.5, { cham: 0.2, role: 'accent' }), D('disc', -29, 0, 6), B('plate', 5, 0, 7, 26, { cham: 0.25, role: c.glow ? 'accent' : undefined }), B('frame', 5, 0, 3.5, 15, { cham: 0.2 })];
    default: return [];
  }
}
function wSightSteps(c: WeaponCombo, L: WLayout): WeaponStep[] {
  switch (c.sight) {
    // 低瞄双柱贴顶：柱根扎进机匣顶内（旧单柱起于 L.top−1.5、仅靠杆径勉强搭边，渲染里读作悬空）；双柱即 z1 的双环贴顶读法。镜筒色随宿主：长匣（钢色系步枪）走 steel、套筒炮走 armor
    case 'low': return [R(L.cx + 1, L.top + 2, L.cx + 1, L.top - 5.5, 2), R(L.cx + 13, L.top + 2, L.cx + 13, L.top - 5.5, 2), B('plate', L.cx + 8, L.top - 8.5, 24, 7, { cham: 0.35, role: c.body === 'long' ? 'steel' : 'armor' }), D('disc', L.cx + 18, L.top - 8.5, 3.2)];
    case 'tall': return [R(L.cx + 2, L.top - 2, L.cx + 2, L.top - 11, 2.2), B('plate', L.cx + 9, L.top - 15, 27, 9, { cham: 0.35, role: 'armor' }), D('disc', L.cx + 20, L.top - 15, 3.6)];
    case 'mast': return [R(L.cx - 14, L.top, L.cx - 14, L.top - 29, 1.8), { t: 'ball', x: L.cx - 14, y: L.top - 32, r: 3.6, ...(c.glow ? { role: 'accent' as WeaponRole } : {}) }, ...(c.glow ? [{ t: 'light', x: L.cx - 14, y: L.top - 32 } as WeaponStep] : [])];
    case 'ringSight': return [R(L.cx + 4, L.top - 1, L.cx + 4, L.top - 6, 2), B('frame', L.cx + 4, L.top - 11, 11, 13, { cham: 0.2 }), ...(c.glow ? [B('plate', L.cx + 4, L.top - 11, 6, 7.5, { cham: 0.2, role: 'accent' }), { t: 'light', x: L.cx + 4, y: L.top - 11 } as WeaponStep] : [])];
    default: return [];
  }
}
function wRailCableSteps(c: WeaponCombo, L: WLayout): WeaponStep[] {
  const steps: WeaponStep[] = [];
  const len = c.len ?? 110;
  if (c.rail) {
    // 长/短枪身的「导轨」是护木：与机匣同体同色、只覆管程后半——旧式 armor2 浅色长板（0.66 管程）压在管下读作外来木板，参考无此物（z1 护木与机匣同色系；长匣现走钢色，护木随机匣）
    if (c.body === 'long' || c.body === 'short') steps.push(B('plate', L.front + len * 0.28, L.y0 + 6.5, len * 0.52, 5, { cham: 0.2, role: c.body === 'long' ? 'steel' : 'armor' }));
    else if (c.cls !== 'cold') {
      steps.push(R(L.front, L.top + 3, L.front + len * 0.847, L.top + 3, 1.8));
      for (let tx = L.front + 5; tx < L.front + len * 0.82; tx += 10) steps.push(B('plate', tx, L.top + 2.5, 5, 4.5, { cham: 0.2 }));
    }
  }
  if (c.cable && c.cls !== 'cold') { steps.push(R(L.rear + 10, L.bot - 3, L.rear - 8, L.bot + 10, 3)); steps.push(R(L.rear + 17, L.bot - 2, L.rear + 1, L.bot + 12, 2.2)); }
  return steps;
}
/** 组合 → 步序。荚是特殊构图：主体即荚体、握持决定挂法 */
export function weaponComboSteps(c: WeaponCombo): WeaponStep[] {
  if (c.body === 'pod') {
    const rows = c.rows ?? 3;
    if (c.grip === 'pylon') return [B('frame', 0, 2, 34, 11, { cham: 0.3 }), R(-16, -2, -52, -112, 4.5), R(16, -2, -20, -112, 4.5), D('frame', -34, -57, 6.5), D('frame', -2, -57, 6.5), { t: 'podBox', x: -36, y: -142, rows, open: c.podOpen }];
    return [{ t: 'podBox', x: 0, y: -26, rows, open: c.podOpen }, B('frame', -8, 2, 20, 12, { cham: 0.3 })];
  }
  const L = WBODY_LAYOUT[c.body] ?? WBODY_LAYOUT.none!;
  return [
    ...wFeedSteps(c, L, 'pre'), ...wGripSteps(c, 'pre'),
    ...wBodySteps(c, L),
    ...wEffectorSteps(c, L),
    ...wRailCableSteps(c, L),
    ...wFeedSteps(c, L, 'main'), ...wGripSteps(c, 'post'),
    ...wSightSteps(c, L),
    ...(c.lamp ? [{ t: 'light', x: L.cx + 18, y: L.top + 7 } as WeaponStep] : []),
  ];
}

export interface WeaponPreset { label: string; mount: 'forearm' | 'hand' | 'pod'; combo: WeaponCombo }
export const WEAPON_PRESETS: Record<string, WeaponPreset> = {
  cannon: { label: '臂炮', mount: 'forearm', combo: { cls: 'hot', body: 'sleeve', effector: 'cannonBarrel', feed: 'drum', sight: 'low', grip: 'sleeve', len: 118, bore: 1, ring: true, cable: true, lamp: true } },
  rifle: { label: '步枪', mount: 'hand', combo: { cls: 'hot', body: 'long', effector: 'slimBarrel', feed: 'mag', sight: 'low', grip: 'stockGrip', len: 113, bore: 1, rail: true } },
  pod: { label: '导弹荚', mount: 'pod', combo: { cls: 'hot', body: 'pod', effector: 'none', feed: 'none', sight: 'none', grip: 'shoulder', rows: 3 } },
  podOpen: { label: '导弹荚·全露', mount: 'pod', combo: { cls: 'hot', body: 'pod', effector: 'none', feed: 'none', sight: 'none', grip: 'shoulder', rows: 3, podOpen: true } },
  podPylon: { label: '导弹荚·高架', mount: 'pod', combo: { cls: 'hot', body: 'pod', effector: 'none', feed: 'none', sight: 'none', grip: 'pylon', rows: 3 } },
  beamRifle: { label: '光束步枪', mount: 'hand', combo: { cls: 'scifi', body: 'core', effector: 'beamTube', feed: 'cell', sight: 'ringSight', grip: 'frameStock', len: 96, bore: 1, glow: true } },
  plasmaCannon: { label: '电浆炮', mount: 'forearm', combo: { cls: 'scifi', body: 'chamber', effector: 'emitter', feed: 'tankTwin', sight: 'none', grip: 'sleeve', len: 88, bore: 1.45, glow: true, cable: true } },
  railgun: { label: '轨道炮', mount: 'hand', combo: { cls: 'scifi', body: 'ringCore', effector: 'coil', feed: 'tank', sight: 'mast', grip: 'frameStock', len: 128, bore: 1, glow: true } },
  beamBlade: { label: '光束刃', mount: 'hand', combo: { cls: 'scifi', body: 'none', effector: 'beamEdge', feed: 'none', sight: 'none', grip: 'gripEmitter', len: 118, bore: 1, glow: true } },
  longBlade: { label: '长刀', mount: 'hand', combo: { cls: 'cold', body: 'none', effector: 'blade', feed: 'none', sight: 'none', grip: 'gripGuard', len: 122, bore: 1 } },
  curvedBlade: { label: '弯刀', mount: 'hand', combo: { cls: 'cold', body: 'none', effector: 'curvedBlade', feed: 'none', sight: 'none', grip: 'gripGuard', len: 118, bore: 1 } },
  warAxe: { label: '战斧', mount: 'hand', combo: { cls: 'cold', body: 'none', effector: 'axe', feed: 'none', sight: 'none', grip: 'gripLong', len: 46, bore: 1 } },
  powerHammer: { label: '动力锤', mount: 'hand', combo: { cls: 'cold', body: 'none', effector: 'hammer', feed: 'none', sight: 'none', grip: 'gripLong', len: 30, bore: 1.1, ring: true, cable: false } },
  lance: { label: '长矛', mount: 'hand', combo: { cls: 'cold', body: 'none', effector: 'spear', feed: 'none', sight: 'none', grip: 'gripLong', len: 48, bore: 1 } },
};
/** 部件轴选项（向导用）：按类系给可选件 */
export const WEAPON_AXIS_OPTIONS: Record<'body' | 'effector' | 'feed' | 'sight' | 'grip', Record<WeaponClass, { id: string; label: string }[]>> = {
  body: {
    hot: [{ id: 'sleeve', label: '套筒机匣' }, { id: 'long', label: '长机匣' }, { id: 'short', label: '短机匣' }, { id: 'pod', label: '荚壳' }],
    scifi: [{ id: 'core', label: '核心舱' }, { id: 'chamber', label: '大舱' }, { id: 'ringCore', label: '环式核心' }, { id: 'sleeve', label: '套筒机匣' }, { id: 'long', label: '长机匣' }, { id: 'none', label: '无（握柄即主体）' }],
    cold: [{ id: 'none', label: '无（柄即主体）' }],
  },
  effector: {
    hot: [{ id: 'cannonBarrel', label: '重炮管·环口' }, { id: 'barrel', label: '标准管·平口' }, { id: 'brakeBarrel', label: '制退管' }, { id: 'slimBarrel', label: '细管·尖口' }, { id: 'twinBarrel', label: '双管' }, { id: 'none', label: '无' }],
    scifi: [{ id: 'beamTube', label: '光束发射管' }, { id: 'coil', label: '线圈列' }, { id: 'emitter', label: '分叉发射器' }, { id: 'cannonBarrel', label: '重炮管·环口' }, { id: 'beamEdge', label: '光束刃' }, { id: 'none', label: '无' }],
    cold: [{ id: 'blade', label: '直刃' }, { id: 'curvedBlade', label: '弯刃' }, { id: 'serrated', label: '锯齿刃' }, { id: 'axe', label: '斧刃' }, { id: 'hammer', label: '锤头' }, { id: 'spear', label: '矛尖' }, { id: 'beamEdge', label: '光束刃' }],
  },
  feed: {
    hot: [{ id: 'mag', label: '下弹匣' }, { id: 'magBig', label: '大弹匣' }, { id: 'drum', label: '侧弹鼓' }, { id: 'belt', label: '弹链+弹箱' }, { id: 'none', label: '无' }],
    scifi: [{ id: 'cell', label: '能量罐（竖置）' }, { id: 'tank', label: '电容柱×3' }, { id: 'tankTwin', label: '双联电容罐' }, { id: 'belt', label: '供能箱+缆' }, { id: 'none', label: '无' }],
    cold: [{ id: 'none', label: '无' }],
  },
  sight: {
    hot: [{ id: 'low', label: '低矮瞄具' }, { id: 'tall', label: '高架瞄具' }, { id: 'mast', label: '传感器桅' }, { id: 'none', label: '无' }],
    scifi: [{ id: 'ringSight', label: '瞄准环' }, { id: 'mast', label: '传感器桅' }, { id: 'low', label: '低矮瞄具' }, { id: 'none', label: '无' }],
    cold: [{ id: 'none', label: '无' }],
  },
  grip: {
    hot: [{ id: 'stockGrip', label: '枪托+握把' }, { id: 'frameStock', label: '骨架托+握把' }, { id: 'stock', label: '枪托' }, { id: 'handle', label: '握把' }, { id: 'sleeve', label: '套筒直装' }, { id: 'shoulder', label: '肩挂（荚）' }, { id: 'pylon', label: '高架撑杆（荚）' }],
    scifi: [{ id: 'stockGrip', label: '枪托+握把' }, { id: 'frameStock', label: '骨架托+握把' }, { id: 'stock', label: '枪托' }, { id: 'handle', label: '握把' }, { id: 'sleeve', label: '套筒直装' }, { id: 'gripEmitter', label: '发射握柄（刃）' }],
    cold: [{ id: 'gripGuard', label: '短柄+直格+首' }, { id: 'gripDisc', label: '短柄+圆盘格' }, { id: 'gripLong', label: '长柄' }, { id: 'gripEmitter', label: '发射握柄' }],
  },
};

export function renderWeapon(cv: MechaCanvas, spec: WeaponSpec, kind: WeaponKind, origin: Pt): Anchors {
  return renderWeaponCombo(cv, spec, WEAPON_PRESETS[kind]!.combo, origin);
}
export function renderWeaponCombo(cv: MechaCanvas, spec: WeaponSpec, combo: WeaponCombo, origin: Pt): Anchors {
  const T: Tools = makeLayerTools(cv, spec.seed, spec.blockShape);
  const ox = origin.x, oy = origin.y;
  // 尺寸系数：长向/厚向分开（原点不动）。量比据图库参考实测——
  // 手持武器全长/身高：重机甲长炮 ≈0.75、敏捷 ≈0.37、动力服 ≈0.31
  const ux = spec.size?.x ?? 1, uy = spec.size?.y ?? 1;
  const run = (steps: WeaponStep[], bx: number, by: number) => {
    for (const s of steps) {
      if (s.t === 'disc') { const id = T.addDisc(s.kind, { x: bx + s.x * ux, y: by + s.y * uy }, s.r * uy); if (s.role) (T.A.colorRole ??= new Map()).set(id, s.role); }
      else if (s.t === 'ball') { T.addDisc('disc', { x: bx + s.x * ux, y: by + s.y * uy }, s.r * uy); (T.A.balls ??= []).push({ x: bx + s.x * ux, y: by + s.y * uy, r: s.r * uy, ...(s.role ? { role: s.role } : {}) }); }
      else if (s.t === 'block') { const id = T.addBlock(s.kind, bx + s.x * ux, by + s.y * uy, s.w * ux, s.h * uy, s.ang ?? 0, s.cham ?? 0.36, s.bolts ?? false); if (s.role) (T.A.colorRole ??= new Map()).set(id, s.role); }
      else if (s.t === 'poly') { const id = T.addPoly(s.pts.map(([px, py]) => ({ x: bx + px * ux, y: by + py * uy }))); if (s.role) (T.A.colorRole ??= new Map()).set(id, s.role); if (s.tint !== undefined) T.A.plateTint.set(id, s.tint); }
      else if (s.t === 'rod') T.rod({ x: bx + s.x0 * ux, y: by + s.y0 * uy }, { x: bx + s.x1 * ux, y: by + s.y1 * uy }, s.r * uy);
      else if (s.t === 'sweep') {
        // 椭圆扫掠：相邻椭圆截面之间的连接面逐段登记成一个桶面
        // 实例（底椭圆只立几何、由连接面带出，不单独着色）。
        // 着色参数按曲面取：点在连接面上的 (θ, w)——θ 是它在截面
        // 椭圆上的绕轴角（对 w 二分截面族解出），剖面明暗随 θ 绕
        // 曲面走；不许按盘内填充取（轴向投影 + 截面内高度会把壁面
        // 压成横条纹平板、读成矩形——实测教训）
        const secs = s.secs.map((e) => ({ x: bx + e.x * ux, y: by + e.y * uy, rx: e.rx * ux, ry: e.ry * uy }));
        let prevId = -1;
        const leftArc = (e: { x: number; y: number; rx: number; ry: number }): Pt[] => {
          const arc: Pt[] = [];
          for (let j = 0; j <= 10; j++) { const th = Math.PI / 2 + (j / 10) * Math.PI; arc.push({ x: e.x + Math.cos(th) * e.rx, y: e.y + Math.sin(th) * e.ry }); }
          return arc;
        };
        for (let k = 0; k + 1 < secs.length; k++) {
          const a = secs[k]!, b = secs[k + 1]!;
          const id = T.addRaw('sweep', sweepSectionTest(a, b));
          if (s.role) (T.A.colorRole ??= new Map()).set(id, s.role);
          // 箍与纵缝登记给缝模式（regSeam：沟与沟内受光壁的
          // 高光由缝 pass 统一画、缝外无亮带）——桶面着色与解
          // 释器都不许自己画沟。箍 = 段界椭圆的可见弧（左弧）：
          // 沟在界两侧各登记一份（各画自家像素），受光侧参照
          // 线只登记在近端一段、沿轴向外偏置定侧（近端一侧的
          // 沟壁受光）；纵缝 = 板条母线，参照线在朝剖面高光峰
          // （u=−0.25）一侧的旁母线
          const ptAt = (e: { x: number; y: number; rx: number; ry: number }, th: number): Pt => ({ x: e.x + Math.cos(th) * e.rx, y: e.y + Math.sin(th) * e.ry });
          if (prevId >= 0) {
            const arc = leftArc(a);
            regSeam(T.A, prevId, arc, undefined, 1.7 * ux);
            regSeam(T.A, id, arc, arc.map((p) => ({ x: p.x + 2.7 * ux, y: p.y })), 1.7 * ux);
          }
          for (const u0 of [0, 0.5, -0.5]) {
            const a0 = Math.asin(u0), ul = u0 + (u0 > -0.25 ? -0.085 : 0.085), al = Math.asin(ul);
            for (const [t0, tl] of [[a0, al], [Math.PI - a0, Math.PI - al]] as const) {
              regSeam(T.A, id, [ptAt(a, t0), ptAt(b, t0)], [ptAt(a, tl), ptAt(b, tl)]);
            }
          }
          prevId = id;
          // 末段与端面的界：只在壁面一侧登记沟（端面一侧归端面
          // 自己的缘部处理，端面轮廓本来就露在外）
          if (k + 2 === secs.length) regSeam(T.A, id, leftArc(b), undefined, 1.7 * ux);
        }
      }
      else if (s.t === 'ports') T.portArray(bx + s.x * ux, by + s.y * uy, s.w * ux, s.h * uy, s.cols, s.rows);
      else if (s.t === 'light') T.A.lightPts.push({ x: bx + s.x * ux, y: by + s.y * uy });
      else if (s.t === 'arc') {
        // 电弧模式（dyn-arc 同一生成器）：双锚点中点置换折线，
        // 落成强调色点链——电浆叉口之间的放电弧走这里，不手画锯齿
        const p = { ...defaultDynamicParams(), arcEnabled: true, arcMode: 'arc' as const, arcLengthPx: Math.hypot(s.x1 - s.x0, s.y1 - s.y0), arcDirDeg: Math.atan2(s.y1 - s.y0, s.x1 - s.x0) * 180 / Math.PI, arcDisplace: 0.35, arcBranches: 1, arcWidthPx: 2.3, arcFlicker: 0, arcSeed: s.seed, emitEnabled: false };
        const shape = arcPointsAt(p, 0, { x: s.x1 - s.x0, y: s.y1 - s.y0 });
        const put = (pts: { x: number; y: number; w: number }[], mul: number) => { for (const q of pts) { const id = T.addDisc('disc', { x: bx + (s.x0 + q.x) * ux, y: by + (s.y0 + q.y) * uy }, Math.max(0.7, q.w * mul) * uy); (T.A.colorRole ??= new Map()).set(id, 'accent'); } };
        put(shape.main, 0.9); for (const br of shape.branches) put(br, 0.55);
      }
      else run(podBoxSteps(s.rows ?? 3, s.open), bx + s.x * ux, by + s.y * uy); // podBox 子构造
    }
  };
  run(weaponComboSteps(combo), ox, oy);
  T.finish();
  return T.A;
}

/** 武器单独渲染（验收/预览用） */
export function weaponCanvas(spec: WeaponSpec, kind: WeaponKind): { cv: MechaCanvas; A: Anchors; origin: Pt } {
  const cv = newCanvas();
  const origin = kind === 'pod' ? { x: 170, y: 150 } : kind === 'podPylon' ? { x: 190, y: 330 } : { x: 90, y: 130 };
  const A = renderWeapon(cv, spec, kind, origin);
  finishRender(cv, A, gearFinish(spec));
  return { cv, A, origin };
}
