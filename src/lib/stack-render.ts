// ============================================================
// 精灵堆叠合成（呈现端）：按部件当帧 3D 朝向把一摞截面层图合成
// 为一张节点局部图，供 unified-render 当作该节点的精灵画布绘制。
//
// 口径（PR #46 研究定案）：
//  - 合成在节点局部空间做：入参 frame 先去掉视平面内角度
//    （worldAngle 由渲染管线自己的 rotate 施加），剩余的出平面
//    朝向（俯仰/翻滚/偏航）驱动逐层仿射——与普通精灵「只吃平面
//    角」相比，堆叠部件多吃这一段真实 3D 朝向。
//  - 俯角 ε（研究口径 45°）只作用于层图自身的倾斜与画序深度：
//    截面图是俯视切片，没有倾斜会压成扁带——ε 是堆叠产线自带
//    的视角，见 STACK_VIEW_ELEVATION_DEG。层心落位则与节点同款
//    投影（Y 不乘 cosε）：段端正好落在下一关节上，摞与摞在关节
//    处对接（此前层心也走俯角投影，每节在 Y 上缩到约 71%，
//    接头系统性错位）。
//  - 层片零厚度塌陷（验证三定案）：层轴接近视线垂直时整层投影
//    高度趋零——slab 沿轴子步扫掠补厚度 + 边沿钳制（|层轴·视线|
//    < sin25° 时把层图绕弦轴抬到 25°，位置仍按真轴）。
//  - 画序：摞内按层心深度排（后→先），不按层序——部件翻转
//    （尖端朝观众）时自动反序。
// 本模块的 computeStackOps 为纯函数（不碰 DOM），探针可验。
// ============================================================

import {
  mat3Apply,
  mat3Mul,
  rotMatD,
  subToPx,
  type Mat3,
  type Sprite,
  type SpriteStack,
} from './unified-types';

/** 堆叠合成的固定俯角（度）。研究全程在 45° 下验证（验证一~八）。 */
export const STACK_VIEW_ELEVATION_DEG = 45;

/** 边沿钳制角（度）：层轴与视线夹角小于此值时抬起层图（验证三定案 25°） */
const EDGE_CLAMP_DEG = 25;

export interface StackDrawOp {
  layer: number;
  /** 仿射 [a, b, c, d, e, f]：层图像素（左上原点）→ 合成图坐标 */
  tr: [number, number, number, number, number, number];
  /** 层心深度（越大越靠前，绘制越晚） */
  depth: number;
}

export interface StackOpsResult {
  ops: StackDrawOp[]; // 已按 depth 升序（远→近）
  width: number;
  height: number;
  /** 节点锚点（局部原点）在合成图中的位置（px） */
  pivotX: number;
  pivotY: number;
  /** 朝向量化键：供渲染端作内容哈希（朝向不变则合成图可复用） */
  key: string;
}

type V3 = { x: number; y: number; z: number };

/** Rodrigues 旋转：v 绕单位轴 k 转 θ（弧度） */
function rotAround(v: V3, k: V3, theta: number): V3 {
  const c = Math.cos(theta), s = Math.sin(theta);
  const d = k.x * v.x + k.y * v.y + k.z * v.z;
  return {
    x: v.x * c + (k.y * v.z - k.z * v.y) * s + k.x * d * (1 - c),
    y: v.y * c + (k.z * v.x - k.x * v.z) * s + k.y * d * (1 - c),
    z: v.z * c + (k.x * v.y - k.y * v.x) * s + k.z * d * (1 - c),
  };
}

/**
 * 纯函数：算逐层绘制算子。
 * @param stack 摞定义（节点局部坐标，全局像素）
 * @param layerSprites 与 stack.layerSpriteIds 同序的层精灵（取宽高/plug）
 * @param worldFrame 节点当帧世界朝向（Mat3，局部→(h,y,d) 基）
 * @param worldAngleDeg 视平面内角度（管线将另行施加的 rotate 量）
 * @param elevationDeg 堆叠俯角，默认 STACK_VIEW_ELEVATION_DEG
 */
export function computeStackOps(
  stack: SpriteStack,
  layerSprites: (Sprite | undefined)[],
  worldFrame: Mat3,
  worldAngleDeg: number,
  elevationDeg: number = STACK_VIEW_ELEVATION_DEG,
): StackOpsResult {
  // 去视平面内旋转：管线的 ctx.rotate(worldAngle) 等价于基内
  // rotMatD(worldAngle)，合成用其逆乘 frame，剩余纯出平面朝向。
  const frame = mat3Mul(rotMatD(-worldAngleDeg), worldFrame);
  const apply = (v: V3): V3 => {
    const r = mat3Apply(frame, v.x, v.y, v.z);
    return { x: r.h, y: r.y, z: r.d };
  };
  const elev = (elevationDeg * Math.PI) / 180;
  const ce = Math.cos(elev), se = Math.sin(elev);
  // (h, y, d) → 层图自身的屏幕基：x = h，y = y·cosε + d·sinε（近处更低）
  const toScreen = (p: V3): { x: number; y: number } => ({ x: p.x, y: p.y * ce + p.z * se });
  // 层心落位：与节点位置同款投影（projectToView 口径，Y 不带俯角），
  // 保证段端与下一关节重合
  const toScreenCenter = (p: V3): { x: number; y: number } => ({ x: p.x, y: p.y });
  // 朝向观众的单位向量（带俯角 ε）：深度与层轴 facing 都按它量，
  // 不是按 d 轴——ε=45° 时竖直层轴的 facing = sin45，属舒适区
  // （验证三的钳制判据在合成相机系里量，与 spike 同口径）。
  const viewToward: V3 = { x: 0, y: -se, z: ce };
  const depthOf = (p: V3) => p.x * viewToward.x + p.y * viewToward.y + p.z * viewToward.z;

  const A3 = apply(stack.axis);
  const U0 = apply(stack.uAxis);
  const V0 = apply(stack.vAxis);

  // 边沿钳制：层轴朝向视线的分量过小时，绕 (轴 × 视线)
  // 把层图基 (U, V) 抬到钳制角；轴本身（层心位置）不动。
  let U3 = U0, V3 = V0;
  {
    const facing = A3.x * viewToward.x + A3.y * viewToward.y + A3.z * viewToward.z;
    const clampRad = (EDGE_CLAMP_DEG * Math.PI) / 180;
    if (Math.abs(facing) < Math.sin(clampRad)) {
      const kx = A3.y * viewToward.z - A3.z * viewToward.y;
      const ky = A3.z * viewToward.x - A3.x * viewToward.z;
      const kz = A3.x * viewToward.y - A3.y * viewToward.x;
      const kl = Math.hypot(kx, ky, kz);
      if (kl > 1e-6) {
        const k = { x: kx / kl, y: ky / kl, z: kz / kl };
        const cur = Math.asin(Math.max(-1, Math.min(1, facing)));
        const rot = (facing >= 0 ? clampRad : -clampRad) - cur;
        U3 = rotAround(U0, k, rot);
        V3 = rotAround(V0, k, rot);
      }
    }
  }
  const Us = toScreen(U3);
  const Vs = toScreen(V3);
  // slab 扫掠沿层心连线走（与层心同一投影口径）
  const axisScreen = toScreenCenter(A3);

  const ops: StackDrawOp[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const T = stack.layerThickness;
  for (let l = 0; l < stack.layerSpriteIds.length; l++) {
    const spr = layerSprites[l];
    if (!spr || spr.width === 0 || spr.height === 0) continue;
    const dist = (l + 0.5) * T;
    const centerLocal: V3 = {
      x: stack.origin.x + stack.axis.x * dist,
      y: stack.origin.y + stack.axis.y * dist,
      z: stack.origin.z + stack.axis.z * dist,
    };
    const c3 = apply(centerLocal);
    const cs = toScreenCenter(c3);
    const plugX = spr.plug ? subToPx(spr.plug.x) : spr.width / 2;
    const plugY = spr.plug ? subToPx(spr.plug.y) : spr.height / 2;
    const a = Us.x, b = Us.y, c = Vs.x, d = Vs.y;
    const e0 = cs.x - plugX * a - plugY * c;
    const f0 = cs.y - plugX * b - plugY * d;
    // slab 扫掠：沿层轴屏幕向量子步重绘，补层厚（验证三定案）
    const axv = axisScreen.x * T, ayv = axisScreen.y * T;
    const steps = Math.max(1, Math.min(4, Math.ceil(Math.hypot(axv, ayv) / 0.75)));
    for (let k2 = 0; k2 < steps; k2++) {
      const fr = (k2 + 0.5) / steps - 0.5;
      const e = e0 + axv * fr, f = f0 + ayv * fr;
      ops.push({ layer: l, tr: [a, b, c, d, e, f], depth: depthOf(c3) });
      // 包围盒（四角）
      for (const [px, py] of [[0, 0], [spr.width, 0], [0, spr.height], [spr.width, spr.height]] as const) {
        const x = a * px + c * py + e, y = b * px + d * py + f;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  ops.sort((p, q) => p.depth - q.depth);
  if (!isFinite(minX)) {
    return { ops: [], width: 0, height: 0, pivotX: 0, pivotY: 0, key: 'stack-empty' };
  }
  const pad = 1;
  const ox = Math.floor(minX) - pad, oy = Math.floor(minY) - pad;
  const width = Math.ceil(maxX) - ox + pad;
  const height = Math.ceil(maxY) - oy + pad;
  for (const op of ops) { op.tr[4] -= ox; op.tr[5] -= oy; }
  const keyParts = frame.map((v) => Math.round(v * 64) / 64).join(',');
  return {
    ops,
    width,
    height,
    pivotX: -ox,
    pivotY: -oy,
    key: `stack:${stack.layerSpriteIds[0] ?? ''}:${stack.layerSpriteIds.length}:${keyParts}:e${elevationDeg}`,
  };
}

/**
 * 纯数据版栅格化（无 DOM）：与 rasterizeStackOps 同口径（逐算子
 * 逆仿射最近采样 + source-over 合成），供 convert 在无画布环境
 * （含探针的 node 进程）把堆叠合成成静止帧网格。layerRgba 与摞
 * 的 layerSpriteIds 同序（缺失层传 null 跳过）。
 */
export function rasterizeStackOpsData(
  res: StackOpsResult,
  layerRgba: ({ rgba: Uint8ClampedArray; width: number; height: number } | null)[],
): { width: number; height: number; rgba: Uint8ClampedArray } | null {
  if (res.ops.length === 0 || res.width === 0 || res.height === 0) return null;
  const W = res.width, H = res.height;
  const out = new Uint8ClampedArray(W * H * 4);
  for (const op of res.ops) {
    const src = layerRgba[op.layer];
    if (!src) continue;
    const [a, b, c, d, e, f] = op.tr;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-9) continue;
    // 算子包围盒（源图四角）裁剪扫描区
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const [px, py] of [[0, 0], [src.width, 0], [0, src.height], [src.width, src.height]] as const) {
      const x = a * px + c * py + e, y = b * px + d * py + f;
      if (x < mnx) mnx = x; if (x > mxx) mxx = x;
      if (y < mny) mny = y; if (y > mxy) mxy = y;
    }
    const x0 = Math.max(0, Math.floor(mnx)), x1 = Math.min(W - 1, Math.ceil(mxx));
    const y0 = Math.max(0, Math.floor(mny)), y1 = Math.min(H - 1, Math.ceil(mxy));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - e, dy = y + 0.5 - f;
        const sx = Math.floor((d * dx - c * dy) / det);
        const sy = Math.floor((-b * dx + a * dy) / det);
        if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
        const so = (sy * src.width + sx) * 4;
        const sa = src.rgba[so + 3]! / 255;
        if (sa <= 0) continue;
        const oo = (y * W + x) * 4;
        const da = out[oo + 3]! / 255;
        const oa = sa + da * (1 - sa);
        if (oa <= 0) continue;
        for (let ch = 0; ch < 3; ch++) {
          out[oo + ch] = Math.round((src.rgba[so + ch]! * sa + out[oo + ch]! * da * (1 - sa)) / oa);
        }
        out[oo + 3] = Math.round(oa * 255);
      }
    }
  }
  return { width: W, height: H, rgba: out };
}

/**
 * 把算子栅格化为画布（执行层调用）。layerCanvases 与摞的
 * layerSpriteIds 同序（缺失层传 null 跳过）。像素风口径：关闭平滑。
 */
export function rasterizeStackOps(
  res: StackOpsResult,
  layerCanvases: (HTMLCanvasElement | null)[],
): HTMLCanvasElement | null {
  if (res.ops.length === 0 || res.width === 0 || res.height === 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = res.width;
  canvas.height = res.height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (const op of res.ops) {
    const lc = layerCanvases[op.layer];
    if (!lc) continue;
    ctx.setTransform(op.tr[0], op.tr[1], op.tr[2], op.tr[3], op.tr[4], op.tr[5]);
    ctx.drawImage(lc, 0, 0);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}
