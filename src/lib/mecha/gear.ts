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
