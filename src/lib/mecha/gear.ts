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
}

export function gearFinish(spec: GearSpec): LegSpec & { altTone?: boolean } {
  return {
    topology: 'standard', scheme: spec.scheme, seed: 11, bend: 22,
    camo: spec.camo, wear: spec.wear, detail: 0.65, altTone: spec.twoTone,
  } as LegSpec & { altTone?: boolean };
}

type Tools = ReturnType<typeof makeLayerTools>;

// ---------- 履带底盘 ----------
// 模式（据坦克足参考×2：生成图 + 陆地战舰）：履带环带（链节分段）
// + 环内负重轮列 + 后驱动轮/前惰轮 + 分段斜面裙甲（glacis）压住
// 环顶 + 甲板与旋转座圈。原点 = 座圈顶面中心（躯干挂载点）。
export interface TrackSpec extends GearSpec { len?: number }

export function renderTrackUnit(cv: MechaCanvas, spec: TrackSpec, origin: Pt): Anchors {
  const T: Tools = makeLayerTools(cv, spec.seed);
  const len = spec.len ?? 252;
  const R = 33;               // 环带半径
  const band = 15;            // 环带厚
  const cy = origin.y + 74;   // 环心高（原点下方）
  const cx = origin.x;
  const x0 = cx - len / 2 + R, x1 = cx + len / 2 - R; // 直段两端圆心
  // 履带环带：到直段线段的距离场带环；v 沿长度 → 框件条纹成链节
  T.addRaw('frame', (x, y) => {
    const dx = Math.max(x0 - x, 0, x - x1);
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d < R - band || d > R) return [false, 0, 0];
    const along = (x - (cx - len / 2)) / len;
    return [true, (d - (R - band)) / band, along];
  });
  // 接地链节垫：沿底直段排小块（链节的承重面）
  const pads = Math.floor(len / 16);
  for (let i = 0; i < pads; i++) {
    const px = cx - len / 2 + 8 + i * 16;
    T.addBlock('frame', px, cy + R - 3, 13, 7, 0, 0.15);
  }
  // 环内暗色机体（整胶囊填 frame）：轮列与驱动轮坐其上，不再悬空
  T.addRaw('frame', (x, y) => {
    const dx = Math.max(x0 - x, 0, x - x1);
    const d = Math.hypot(dx, y - cy);
    if (d > R - 3) return [false, 0, 0];
    return [true, d / R, (x - (cx - len / 2)) / len];
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

export function renderMultiLeg(cv: MechaCanvas, spec: MultiLegSpec, hip: Pt): Anchors {
  const T: Tools = makeLayerTools(cv, spec.seed);
  const P = MULTI_PROFILES[spec.profile];
  const knee = { x: hip.x + P.knee.x, y: hip.y + P.knee.y };
  const ankle = { x: knee.x + P.ankle.x, y: knee.y + P.ankle.y };
  const toe = { x: ankle.x + P.toe.x, y: ankle.y + P.toe.y };
  const seg = (a: Pt, b: Pt, wA: number, wB: number) => {
    T.segPlate(a, b, wA, wB, 0.03, 0.52, 2, 'plate');
    T.segPlate(a, b, wA * 0.94, wB, 0.55, 0.97, 2, 'plate');
  };
  seg(hip, knee, P.w[0], P.w[1]);
  seg(knee, ankle, P.w[2], P.w[3]);
  seg(ankle, toe, P.w[4], P.w[5]);
  // 髋座 + 三关节盘
  T.addBlock('frame', hip.x - 8, hip.y, 26, 32, 0, 0.3);
  T.addDisc('disc', hip, P.hipR);
  T.addDisc('disc', hip, P.hipR * 0.6);
  T.addDisc('disc', knee, P.kneeR);
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
  T.finish();
  return T.A;
}

/** 多足腿单独渲染（验收/预览用） */
export function multiLegCanvas(spec: MultiLegSpec): { cv: MechaCanvas; A: Anchors; origin: Pt } {
  const cv = newCanvas();
  const origin = { x: 56, y: 64 };
  const A = renderMultiLeg(cv, spec, origin);
  finishRender(cv, A, gearFinish(spec));
  return { cv, A, origin };
}
