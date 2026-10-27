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
  mat3Transpose,
  rotMatD,
  MAT3_IDENTITY,
  subToPx,
  type Mat3,
  type Sprite,
  type SpriteStack,
} from './unified-types';

/** 堆叠合成的固定俯角（度）。研究全程在 45° 下验证（验证一~八）。 */
export const STACK_VIEW_ELEVATION_DEG = 45;

/** 边沿钳制角（度）：层轴与视线夹角小于此值时抬起层图（验证三定案 25°） */
const EDGE_CLAMP_DEG = 25;

/**
 * 堆叠接缝插值旋转（通用定案）：关节两侧相对静止位的相对旋转增量
 * 在关节面两侧带宽内分摊——根端层留在父侧、尖端层绕摞尖端点送向
 * 子侧；静止位增量为零、与无 bend 逐值一致。调用方给本节点与关节
 * 另一侧节点的当帧/静止位世界朝向（帧 + 视平面角），增量在本模块
 * 内按各自去视平面角的合成帧口径算（与 computeStackOps 同口径）。
 */
export interface StackBendSide {
  frame: Mat3;
  angle: number;
  restFrame: Mat3;
  restAngle: number;
}

export interface StackBend {
  /** 本节点静止位世界朝向 */
  restFrame: Mat3;
  restAngle: number;
  /** 根端关节（父节点一侧） */
  parent?: StackBendSide;
  /** 尖端关节（子节点一侧） */
  child?: StackBendSide;
  bandRootPx?: number;
  bandTipPx?: number;
}

/** 接缝弯曲带默认带宽（px，沿摞轴从关节面向摞内量） */
export const STACK_BEND_BAND_PX = 12;

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

/** 旋转矩阵 → 轴角（角 < 1e-4 rad 视为恒等，返回 null） */
function mat3AxisAngle(m: Mat3): { kx: number; ky: number; kz: number; ang: number } | null {
  const tr = m[0] + m[4] + m[8];
  const cos = Math.max(-1, Math.min(1, (tr - 1) / 2));
  const ang = Math.acos(cos);
  if (ang < 1e-4) return null;
  const sn = Math.sin(ang);
  let kx: number, ky: number, kz: number;
  if (Math.abs(sn) > 1e-3) {
    kx = (m[7] - m[5]) / (2 * sn);
    ky = (m[2] - m[6]) / (2 * sn);
    kz = (m[3] - m[1]) / (2 * sn);
  } else {
    // 角 ≈ π：R = 2kkᵀ − I，从最大对角分量反解
    const xx = (m[0] + 1) / 2, yy = (m[4] + 1) / 2, zz = (m[8] + 1) / 2;
    if (xx >= yy && xx >= zz) {
      kx = Math.sqrt(Math.max(0, xx)); ky = kx > 1e-9 ? m[1] / (2 * kx) : 0; kz = kx > 1e-9 ? m[2] / (2 * kx) : 0;
    } else if (yy >= zz) {
      ky = Math.sqrt(Math.max(0, yy)); kx = ky > 1e-9 ? m[3] / (2 * ky) : 0; kz = ky > 1e-9 ? m[5] / (2 * ky) : 0;
    } else {
      kz = Math.sqrt(Math.max(0, zz)); kx = kz > 1e-9 ? m[6] / (2 * kz) : 0; ky = kz > 1e-9 ? m[7] / (2 * kz) : 0;
    }
  }
  const kl = Math.hypot(kx, ky, kz);
  if (kl < 1e-9) return null;
  return { kx: kx / kl, ky: ky / kl, kz: kz / kl, ang };
}

function mat3FromAxisAngle(kx: number, ky: number, kz: number, ang: number): Mat3 {
  const c = Math.cos(ang), sn = Math.sin(ang), C = 1 - c;
  return [
    c + kx * kx * C, kx * ky * C - kz * sn, kx * kz * C + ky * sn,
    ky * kx * C + kz * sn, c + ky * ky * C, ky * kz * C - kx * sn,
    kz * kx * C - ky * sn, kz * ky * C + kx * sn, c + kz * kz * C,
  ];
}

/** 旋转矩阵的分数幂（沿同轴转 ang·frac） */
function mat3Pow(m: Mat3, frac: number): Mat3 {
  if (frac === 0) return MAT3_IDENTITY;
  if (frac === 1) return m;
  const aa = mat3AxisAngle(m);
  if (!aa) return MAT3_IDENTITY;
  return mat3FromAxisAngle(aa.kx, aa.ky, aa.kz, aa.ang * frac);
}

function smoothstep01(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/**
 * 纯函数：算逐层绘制算子。
 * @param stack 摞定义（节点局部坐标，全局像素）
 * @param layerSprites 与 stack.layerSpriteIds 同序的层精灵（取宽高/plug）
 * @param worldFrame 节点当帧世界朝向（Mat3，局部→(h,y,d) 基）
 * @param worldAngleDeg 视平面内角度（管线将另行施加的 rotate 量）
 * @param elevationDeg 堆叠俯角，默认 STACK_VIEW_ELEVATION_DEG
 * @param bend 接缝插值旋转（可选）：关节增量旋转在带宽内分摊到逐层帧
 */
export function computeStackOps(
  stack: SpriteStack,
  layerSprites: (Sprite | undefined)[],
  worldFrame: Mat3,
  worldAngleDeg: number,
  elevationDeg: number = STACK_VIEW_ELEVATION_DEG,
  bend?: StackBend,
): StackOpsResult {
  // 去视平面内旋转：管线的 ctx.rotate(worldAngle) 等价于基内
  // rotMatD(worldAngle)，合成用其逆乘 frame，剩余纯出平面朝向。
  const frame = mat3Mul(rotMatD(-worldAngleDeg), worldFrame);
  const applyF = (f: Mat3, v: V3): V3 => {
    const r = mat3Apply(f, v.x, v.y, v.z);
    return { x: r.h, y: r.y, z: r.d };
  };
  const apply = (v: V3): V3 => applyF(frame, v);
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

  // ---- 接缝插值旋转：增量 extra = 相对静止相对朝向的改变量
  // （rel_rest⁻¹ · rel_now，rel 按各自去视平面角的合成帧口径）。
  // 根端层帧 = 本帧 ∘ extra^(u−1)（u 为带内平滑权重，关节面 0.5、
  // 带外 1 → 指数 0 恒等）；尖端层绕摞尖端点转 extra^w（关节面
  // 0.5、带外 0）。两侧在关节面各分一半，接缝保持静止相对朝向。
  const totalLen = stack.layerSpriteIds.length * stack.layerThickness;
  const tipLocal: V3 = {
    x: stack.origin.x + stack.axis.x * totalLen,
    y: stack.origin.y + stack.axis.y * totalLen,
    z: stack.origin.z + stack.axis.z * totalLen,
  };
  let extraRoot: Mat3 | null = null;
  let extraTip: Mat3 | null = null;
  let bandRoot = 0;
  let bandTip = 0;
  let bendKey = '';
  if (bend) {
    const adj = (f: Mat3, a: number): Mat3 => mat3Mul(rotMatD(-a), f);
    const fnR = adj(bend.restFrame, bend.restAngle);
    if (bend.parent) {
      const fp = adj(bend.parent.frame, bend.parent.angle);
      const fpR = adj(bend.parent.restFrame, bend.parent.restAngle);
      const relNow = mat3Mul(mat3Transpose(fp), frame);
      const relRest = mat3Mul(mat3Transpose(fpR), fnR);
      const ex = mat3Mul(mat3Transpose(relRest), relNow);
      if (mat3AxisAngle(ex)) { extraRoot = ex; bandRoot = bend.bandRootPx ?? STACK_BEND_BAND_PX; }
    }
    if (bend.child) {
      const fc = adj(bend.child.frame, bend.child.angle);
      const fcR = adj(bend.child.restFrame, bend.child.restAngle);
      const relNow = mat3Mul(mat3Transpose(frame), fc);
      const relRest = mat3Mul(mat3Transpose(fnR), fcR);
      const ex = mat3Mul(mat3Transpose(relRest), relNow);
      if (mat3AxisAngle(ex)) { extraTip = ex; bandTip = bend.bandTipPx ?? STACK_BEND_BAND_PX; }
    }
    if (bandRoot + bandTip > totalLen && totalLen > 0) {
      const k = totalLen / (bandRoot + bandTip);
      bandRoot *= k;
      bandTip *= k;
    }
    if (extraRoot || extraTip) {
      const parts: number[] = [];
      if (extraRoot) parts.push(...extraRoot);
      if (extraTip) parts.push(...extraTip);
      bendKey = `:b${parts.map((v) => Math.round(v * 64) / 64).join(',')}:${Math.round(bandRoot)}:${Math.round(bandTip)}`;
    }
  }

  // 逐层屏幕基（给定帧）：层轴/层图基 + 边沿钳制。无弯曲时全摞
  // 共用一份（baseBasis）；带内层按各自插值帧单独算。
  const basisFor = (f: Mat3): { Us: { x: number; y: number }; Vs: { x: number; y: number }; axisScreen: { x: number; y: number } } => {
    const A3 = applyF(f, stack.axis);
    const U0 = applyF(f, stack.uAxis);
    const V0 = applyF(f, stack.vAxis);
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
    return {
      Us: toScreen(U3),
      Vs: toScreen(V3),
      // slab 扫掠沿层心连线走（与层心同一投影口径）
      axisScreen: toScreenCenter(A3),
    };
  };
  const baseBasis = basisFor(frame);

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
    // 接缝弯曲带内：本层帧 = 本帧 ∘ E根 ∘ R尖，层心另加尖端绕点
    // 偏移（根端绕本节点原点、天然含在帧里）；带外恒走共用基。
    let basis = baseBasis;
    let c3: V3;
    if (extraRoot || extraTip) {
      let E: Mat3 = MAT3_IDENTITY;
      let R: Mat3 = MAT3_IDENTITY;
      if (extraRoot && bandRoot > 0) {
        E = mat3Pow(extraRoot, smoothstep01((dist + bandRoot) / (2 * bandRoot)) - 1);
      }
      if (extraTip && bandTip > 0) {
        R = mat3Pow(extraTip, smoothstep01((dist - totalLen + bandTip) / (2 * bandTip)));
      }
      if (E !== MAT3_IDENTITY || R !== MAT3_IDENTITY) {
        const frameL = mat3Mul(mat3Mul(frame, E), R);
        basis = basisFor(frameL);
        c3 = applyF(frameL, centerLocal);
        if (R !== MAT3_IDENTITY) {
          // 尖端绕点：c → tip + R·(c − tip)，与帧合成后等价于层心
          // 再加 本帧 ∘ E ∘ (tip − R·tip) 的偏移
          const rt = mat3Apply(R, tipLocal.x, tipLocal.y, tipLocal.z);
          const dv: V3 = { x: tipLocal.x - rt.h, y: tipLocal.y - rt.y, z: tipLocal.z - rt.d };
          const eo = mat3Apply(E, dv.x, dv.y, dv.z);
          const off = apply({ x: eo.h, y: eo.y, z: eo.d });
          c3 = { x: c3.x + off.x, y: c3.y + off.y, z: c3.z + off.z };
        }
      } else {
        c3 = apply(centerLocal);
      }
    } else {
      c3 = apply(centerLocal);
    }
    const cs = toScreenCenter(c3);
    const plugX = spr.plug ? subToPx(spr.plug.x) : spr.width / 2;
    const plugY = spr.plug ? subToPx(spr.plug.y) : spr.height / 2;
    const a = basis.Us.x, b = basis.Us.y, c = basis.Vs.x, d = basis.Vs.y;
    const e0 = cs.x - plugX * a - plugY * c;
    const f0 = cs.y - plugX * b - plugY * d;
    // slab 扫掠：沿层轴屏幕向量子步重绘，补层厚（验证三定案）
    const axv = basis.axisScreen.x * T, ayv = basis.axisScreen.y * T;
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
    key: `stack:${stack.layerSpriteIds[0] ?? ''}:${stack.layerSpriteIds.length}:${keyParts}:e${elevationDeg}${bendKey}`,
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
