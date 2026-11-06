// ============================================================
// 机甲装备与底盘生成器（向导扩展件）：履带底盘 / 轮足 / 蜘蛛腿 /
// 喷射背包 / 武器。构造按参考图抽取的模式组装，落笔只走引擎
// 算子（含新算子 glacis/portArray/nozzle/wing 的实装使用）。
// 每件以挂载点为本地原点出图，验收流程与部位件相同：先单独
// 出图对照参考，合格后才进角色构建。
// ============================================================
import { newCanvas, finishRender, makeLayerTools, SCHEMES } from './engine';
import type { Scheme, LegSpec, MechaCanvas, Pt, Anchors } from './engine';

export interface GearSpec {
  scheme: Scheme; seed: number; wear: number; camo: boolean; twoTone: boolean;
  /** 武器尺寸系数（长向 x / 厚向 y 分开，按族参考量比定，见 renderWeapon）；缺省 1 */
  size?: { x: number; y: number };
}

export function gearFinish(spec: GearSpec & { phase?: number }): LegSpec & { altTone?: boolean } {
  return {
    topology: 'standard', scheme: spec.scheme, seed: 11, bend: 22,
    camo: spec.camo, wear: spec.wear, detail: 0.65, altTone: spec.twoTone,
    ...(spec.phase ? { beltPhase: spec.phase } : {}),
  } as LegSpec & { altTone?: boolean };
}

type Tools = ReturnType<typeof makeLayerTools>;

// ---------- 履带底盘 ----------
// 模式（据坦克足参考×2：生成图 + 陆地战舰）：履带环带（链节分段）
// + 环内负重轮列 + 后驱动轮/前惰轮 + 分段斜面裙甲（glacis）压住
// 环顶 + 甲板与旋转座圈。原点 = 座圈顶面中心（躯干挂载点）。
export interface TrackSpec extends GearSpec { len?: number; /** 滚动相位 px（0–16 一圈）：链节沿环移、带纹移、轮盘按行程折角 */ phase?: number }

export function renderTrackUnit(cv: MechaCanvas, spec: TrackSpec, origin: Pt): Anchors {
  const T: Tools = makeLayerTools(cv, spec.seed);
  const len = spec.len ?? 252;
  const phase = spec.phase ?? 0;
  const R = 33;               // 环带半径
  const band = 15;            // 环带厚
  const cy = origin.y + 74;   // 环心高（原点下方）
  const cx = origin.x;
  const x0 = cx - len / 2 + R, x1 = cx + len / 2 - R; // 直段两端圆心
  // 履带环带：到直段线段的距离场带环；v 沿长度 → 框件条纹成链节（相位时整纹沿程移）
  T.addRaw('frame', (x, y) => {
    const dx = Math.max(x0 - x, 0, x - x1);
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d < R - band || d > R) return [false, 0, 0];
    const along = (x + phase - (cx - len / 2)) / len;
    return [true, (d - (R - band)) / band, along];
  });
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
  // 环内暗色机体（整胶囊填 frame）：轮列与驱动轮坐其上，不再悬空
  T.addRaw('frame', (x, y) => {
    const dx = Math.max(x0 - x, 0, x - x1);
    const d = Math.hypot(dx, y - cy);
    if (d > R - 3) return [false, 0, 0];
    return [true, d / R, (x + phase - (cx - len / 2)) / len];
  });
  // 负重轮列（环内贴底）+ 轮毂
  const wheels = 6;
  for (let i = 0; i < wheels; i++) {
    const wx = x0 + 6 + (x1 - x0 - 12) * (i / (wheels - 1));
    T.addDisc('disc', { x: wx, y: cy + R - band - 5 }, 13);
    T.addDisc('disc', { x: wx, y: cy + R - band - 5 }, 5.5);
  }
  // 后驱动轮（大、带毂环）与前惰轮
  T.addDisc('disc', { x: x0, y: cy }, R - 7);
  T.addDisc('disc', { x: x0, y: cy }, 10);
  T.addDisc('disc', { x: x1, y: cy }, R - 10);
  T.addDisc('disc', { x: x1, y: cy }, 7);
  // 分段斜面裙甲（glacis）：三段压住环顶，前段坡更长
  const skirtY = cy - R + 3; // 裙甲压入环顶 7px，不留悬空缝
  T.glacis(cx - len * 0.31, skirtY, len * 0.34, 17, 12);
  T.glacis(cx + len * 0.02, skirtY, len * 0.3, 17, 12);
  T.glacis(cx + len * 0.33, skirtY - 1, len * 0.28, 18, 20);
  // 甲板 + 座圈
  T.addBlock('plate', cx, origin.y + 16, len * 0.52, 14, 0, 0.25, true);
  T.addBlock('frame', cx, origin.y + 5, 46, 9, 0, 0.2);
  T.finish();
  return T.A;
}

/** 履带底盘单独渲染（验收/预览用）：返回引擎画布 */
export function trackCanvas(spec: TrackSpec): { cv: MechaCanvas; A: Anchors; origin: Pt } {
  const cv = newCanvas();
  const origin = { x: 190, y: 26 };
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
    knee: { x: 84, y: -30 }, ankle: { x: 26, y: 126 }, toe: { x: 4, y: 92 },
    w: [30, 24, 17, 13, 11, 8] as const, hipR: 16, kneeR: 10, ankleR: 8, toes: 3,
  },
  quad: {
    knee: { x: 66, y: 78 }, ankle: { x: -44, y: 52 }, toe: { x: 30, y: 96 },
    w: [34, 26, 22, 16, 13, 10] as const, hipR: 15, kneeR: 12, ankleR: 9, toes: 2,
  },
} as const;

export function renderMultiLeg(cv: MechaCanvas, spec: MultiLegSpec, hip: Pt, pts?: { knee: Pt; ankle: Pt; toe: Pt }, only?: 'upper' | 'lower'): Anchors {
  const T: Tools = makeLayerTools(cv, spec.seed);
  const P = MULTI_PROFILES[spec.profile];
  const knee = pts?.knee ?? { x: hip.x + P.knee.x, y: hip.y + P.knee.y };
  const ankle = pts?.ankle ?? { x: knee.x + P.ankle.x, y: knee.y + P.ankle.y };
  const toe = pts?.toe ?? { x: ankle.x + P.toe.x, y: ankle.y + P.toe.y };
  const seg = (a: Pt, b: Pt, wA: number, wB: number) => {
    T.segPlate(a, b, wA, wB, 0.03, 0.52, 2, 'plate');
    T.segPlate(a, b, wA * 0.94, wB, 0.55, 0.97, 2, 'plate');
  };
  if (only !== 'lower') {
    seg(hip, knee, P.w[0], P.w[1]);
    T.addBlock('frame', hip.x - 8, hip.y, 26, 32, 0, 0.3);
    T.addDisc('disc', hip, P.hipR);
    T.addDisc('disc', hip, P.hipR * 0.6);
  }
  if (only !== 'upper') {
    seg(knee, ankle, P.w[2], P.w[3]);
    seg(ankle, toe, P.w[4], P.w[5]);
    T.addDisc('disc', ankle, P.ankleR);
    // 足：小楔块扇（三趾蜘蛛/双趾四足）
    if (P.toes === 3) {
      T.addBlock('plate', toe.x, toe.y + 4, 17, 7, 0, 0.3);
      T.addBlock('plate', toe.x + 11, toe.y + 3, 12, 6, 0.5, 0.3);
      T.addBlock('plate', toe.x - 11, toe.y + 3, 12, 6, -0.5, 0.3);
    } else {
      T.addBlock('plate', toe.x + 4, toe.y + 4, 19, 8, 0.06, 0.3);
      T.addBlock('plate', toe.x - 9, toe.y + 2, 13, 7, -0.35, 0.3);
    }
  }
  T.addDisc('disc', knee, P.kneeR);
  T.finish();
  return T.A;
}

/** 多足腿几何（轮廓相对点 → 段长与静止角，供分段精灵与节点链接线） */
export function multiLegGeom(profile: 'spider' | 'quad'): { l1: number; l2: number; a1: number; a2rel: number; toeVec: Pt; a2: number } {
  const P = MULTI_PROFILES[profile];
  const p0 = { x: 0, y: 0 }, p1 = P.knee, p2 = { x: P.knee.x + P.ankle.x, y: P.knee.y + P.ankle.y };
  const toeVec = P.toe;
  const segAng = (dx: number, dy: number) => (Math.atan2(-dx, dy) * 180) / Math.PI;
  const a1 = segAng(p1.x - p0.x, p1.y - p0.y);
  const a2 = segAng(p2.x - p1.x, p2.y - p1.y);
  return { l1: Math.hypot(p1.x, p1.y), l2: Math.hypot(p2.x - p1.x, p2.y - p1.y), a1, a2rel: a2 - a1, toeVec, a2 };
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
// 模式（据生成参考）：背箱主体（分面板）+ 后缘燃料罐柱 + 底部双
// 喷口钟（nozzle，近大远小）+ 顶部后掠小翼（wing）+ 散热栅。
// 火焰不入图（动态效果，非机体本体）。原点 = 贴背挂载点（箱前
// 面中心），箱体在原点后方展开。
export type JetpackSpec = GearSpec;

export function renderJetpack(cv: MechaCanvas, spec: JetpackSpec, origin: Pt): Anchors {
  const T: Tools = makeLayerTools(cv, spec.seed);
  const ox = origin.x, oy = origin.y;
  // 远喷口先画（在后，长钟：起点埋进箱底）
  T.addBlock('frame', ox - 14, oy + 44, 20, 12, 0, 0.3);
  T.nozzle({ x: ox - 14, y: oy + 42 }, { x: ox - 16, y: oy + 64 }, 9, 16);
  // 后缘燃料罐柱 + 罐顶盖
  T.addBlock('cyl', ox - 56, oy - 2, 21, 86, 0, 0.42);
  T.addDisc('disc', { x: ox - 56, y: oy - 46 }, 10);
  // 主箱（大箱 + 上分面板 + 顶盖 + 底框）
  T.addBlock('plate', ox - 26, oy + 2, 56, 96, 0, 0.3, true);
  T.addBlock('plate', ox - 28, oy - 28, 42, 32, 0, 0.32);
  T.addBlock('frame', ox - 26, oy - 50, 50, 10, 0, 0.3);
  T.addBlock('frame', ox - 28, oy + 38, 44, 16, 0, 0.3);
  // 近喷口（主，长钟）
  T.addBlock('frame', ox - 40, oy + 44, 22, 12, 0, 0.3);
  T.nozzle({ x: ox - 40, y: oy + 42 }, { x: ox - 44, y: oy + 66 }, 10, 18);
  // 顶部后掠翼（主）+ 下稳定小翼
  T.wing(ox - 52, oy - 58, 62, 22, 8, -2.62);
  T.wing(ox - 50, oy + 26, 30, 12, 5, 2.95);
  // 散热栅 + 信号灯
  T.grille(ox - 24, oy + 12, 30, 13);
  T.A.lightPts.push({ x: ox - 6, y: oy - 38 });
  T.finish();
  return T.A;
}

/** 喷射背包单独渲染（验收/预览用） */
export function jetpackCanvas(spec: JetpackSpec): { cv: MechaCanvas; A: Anchors; origin: Pt } {
  const cv = newCanvas();
  const origin = { x: 200, y: 130 };
  const A = renderJetpack(cv, spec, origin);
  finishRender(cv, A, gearFinish(spec));
  return { cv, A, origin };
}

// ---------- 武器三件 ----------
// 模式（据生成武器组参考）：臂炮 = 前臂套筒座 + 粗炮管 + 炮口环 +
// 侧弹鼓 + 顶部肋杆；导弹荚 = 箱体 + 前脸管口阵列（portArray）；
// 步枪 = 机匣 + 长枪管 + 弹匣 + 枪托 + 瞄具。原点：臂炮/步枪 =
// 握持/套筒点，导弹荚 = 底部肩挂点。朝向 +x。
export type WeaponSpec = GearSpec;
export type WeaponKind = 'cannon' | 'pod' | 'rifle' | 'podPylon';

export function renderWeapon(cv: MechaCanvas, spec: WeaponSpec, kind: WeaponKind, origin: Pt): Anchors {
  const T: Tools = makeLayerTools(cv, spec.seed);
  const ox = origin.x, oy = origin.y;
  // 尺寸系数：长向/厚向分开（原点不动）。量比据图库参考实测——
  // 手持武器全长/身高：重机甲长炮 ≈0.75、敏捷 ≈0.37、动力服 ≈0.31
  const ux = spec.size?.x ?? 1, uy = spec.size?.y ?? 1;
  if (kind === 'cannon') {
    // 臂炮：弹鼓（座下侧）→ 套筒座 → 粗炮管 + 炮口环 → 顶肋杆
    T.addDisc('disc', { x: ox + 30 * ux, y: oy + 26 * uy }, 21 * uy);
    T.addDisc('disc', { x: ox + 30 * ux, y: oy + 26 * uy }, 12 * uy);
    T.addBlock('plate', ox + 34 * ux, oy, 80 * ux, 44 * uy, 0, 0.3, true);
    T.addBlock('frame', ox + 8 * ux, oy - 2 * uy, 20 * ux, 32 * uy, 0, 0.3);
    T.rod({ x: ox + 66 * ux, y: oy }, { x: ox + 150 * ux, y: oy }, 12 * uy);
    T.addDisc('frame', { x: ox + 152 * ux, y: oy }, 16 * uy);
    T.addDisc('frame', { x: ox + 152 * ux, y: oy }, 8 * uy);
    T.rod({ x: ox + 68 * ux, y: oy - 17 * uy }, { x: ox + 136 * ux, y: oy - 17 * uy }, 4 * uy);
    T.rod({ x: ox + 10 * ux, y: oy + 18 * uy }, { x: ox - 10 * ux, y: oy + 32 * uy }, 3 * uy); // 供弹缆示意
    T.A.lightPts.push({ x: ox + 52 * ux, y: oy - 13 * uy });
  } else if (kind === 'pod' || kind === 'podPylon') {
    // 导弹荚同为武器：尺寸系数（长/厚）与手持武器同一套用户设置
    // 荚体：外壳框 → 脸板 → portArray 2×3 管口 → 顶盖与侧深条
    const drawPodBox = (cx: number, cy: number) => {
      T.addBlock('frame', cx, cy, 74 * ux, 58 * uy, 0, 0.26, true);
      T.addBlock('plate', cx - 2 * ux, cy, 60 * ux, 46 * uy, 0, 0.28);
      T.portArray(cx - 2 * ux, cy, 46 * ux, 34 * uy, 2, 3);
      T.addBlock('frame', cx - 2 * ux, cy - 32 * uy, 56 * ux, 8 * uy, 0, 0.3);
      T.addBlock('frame', cx + 40 * ux, cy, 8 * ux, 50 * uy, 0, 0.25);
      T.A.lightPts.push({ x: cx - 28 * ux, y: cy - 22 * uy });
    };
    if (kind === 'pod') {
      drawPodBox(ox, oy - 26 * uy);
      T.addBlock('frame', ox - 8 * ux, oy + 6 * uy, 20 * ux, 10 * uy, 0, 0.3);
    } else {
      // 高架：双撑杆从原点（背挂足）斜撑到荚体底部，荚体在后上方
      T.rod({ x: ox - 4 * ux, y: oy }, { x: ox - 54 * ux, y: oy - 116 * uy }, 4.5 * uy);
      T.rod({ x: ox + 14 * ux, y: oy - 6 * uy }, { x: ox - 28 * ux, y: oy - 118 * uy }, 3.5 * uy);
      T.addBlock('frame', ox + 2 * ux, oy - 4 * uy, 22 * ux, 12 * uy, 0, 0.3);
      drawPodBox(ox - 40 * ux, oy - 148 * uy);
    }
  } else {
    // 步枪：枪托 → 机匣 → 长枪管；弹匣下斜、握把下垂、瞄具在上
    T.addBlock('plate', ox - 40 * ux, oy - 1 * uy, 38 * ux, 21 * uy, 0.1, 0.3);
    T.addBlock('plate', ox + 10 * ux, oy, 58 * ux, 25 * uy, 0, 0.28, true);
    T.rod({ x: ox + 36 * ux, y: oy - 1 * uy }, { x: ox + 138 * ux, y: oy - 1 * uy }, 5.5 * uy);
    T.addDisc('frame', { x: ox + 141 * ux, y: oy - 1 * uy }, 7 * uy);
    T.addBlock('frame', ox + 16 * ux, oy + 23 * uy, 14 * ux, 27 * uy, 0.28, 0.25); // 弹匣
    T.addBlock('frame', ox - 16 * ux, oy + 17 * uy, 11 * ux, 21 * uy, -0.2, 0.25); // 握把
    T.rod({ x: ox + 2 * ux, y: oy - 14 * uy }, { x: ox + 2 * ux, y: oy - 20 * uy }, 2.5 * uy);
    T.addBlock('plate', ox + 8 * ux, oy - 23 * uy, 30 * ux, 10 * uy, 0, 0.35); // 瞄具
    T.addDisc('disc', { x: ox + 20 * ux, y: oy - 23 * uy }, 4.5 * uy);
  }
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
