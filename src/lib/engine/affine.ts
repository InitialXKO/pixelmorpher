// ============================================================
// PixelMorpher - 纯 2D 仿射助手（无 DOM 依赖，可独立探针）
//
// 坐标映射：x' = a·x + c·y + e，y' = b·x + d·y + f
// （与 Canvas2D setTransform(a, b, c, d, e, f) 同约定）。
//
// 用途：renderPixelPerfectRotation 的复合路径——节点局部变换链
// （skew → scaleX/stretch → 旋转）在连续几何上满足结合律，旋转是
// 最外层：v' = R · (S · K · v)。本模块负责 S·K 复合矩阵与它作用后的
// 包围盒/枢轴（旋转前坐标系），渲染层据此在 4× 空间烘焙 S·K、再旋转。
// ============================================================

export interface Affine2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY_AFFINE: Affine2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** 复合：返回 m1 ∘ m2（先作用 m2，再作用 m1），与 Canvas 后乘顺序一致。 */
export function mulAffine(m1: Affine2D, m2: Affine2D): Affine2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function applyAffine(m: Affine2D, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** 求逆；行列式近零（不可逆）时返回 null。 */
export function invertAffine(m: Affine2D): Affine2D | null {
  const det = m.a * m.d - m.b * m.c;
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
  const ia = m.d / det;
  const ib = -m.b / det;
  const ic = -m.c / det;
  const id = m.a / det;
  return {
    a: ia,
    b: ib,
    c: ic,
    d: id,
    e: -(ia * m.e + ic * m.f),
    f: -(ib * m.e + id * m.f),
  };
}

/**
 * 节点局部仿射 S · K1 · K2 …（旋转之外的一切）：
 * 与主渲染原生变换链的后乘顺序逐项一致——先 ctx.scale(scaleX, stretchY)，
 * 再逐个 ctx.transform(1, tan(skewY), tan(skewX), 1, 0, 0)。
 * skews 角度单位为度。
 */
export function composeLocalAffine(
  scaleX: number,
  stretchY: number,
  skews: Array<{ skewX: number; skewY: number }>,
): Affine2D {
  let m: Affine2D = { a: scaleX, b: 0, c: 0, d: stretchY, e: 0, f: 0 };
  for (const s of skews) {
    const kx: Affine2D = {
      a: 1,
      b: Math.tan((s.skewY * Math.PI) / 180),
      c: Math.tan((s.skewX * Math.PI) / 180),
      d: 1,
      e: 0,
      f: 0,
    };
    m = mulAffine(m, kx);
  }
  return m;
}

export interface AffineFrame {
  /** 仿射后包围盒左上角（源坐标系经 m 映射后的 min） */
  minX: number;
  minY: number;
  /** 仿射后包围盒尺寸（宽/高恒 ≥ 0；退化时为 0） */
  width: number;
  height: number;
  /** 枢轴在仿射后坐标系中的位置（相对包围盒左上角 min） */
  pivotX: number;
  pivotY: number;
}

/**
 * 源矩形 (0,0,sw,sh) 与枢轴经 m 映射后的包围盒与枢轴位置。
 * 负缩放（动态镜像）由角点 min/max 自然吸收，无需特判。
 */
export function computeAffineFrame(
  sw: number,
  sh: number,
  pivotX: number,
  pivotY: number,
  m: Affine2D,
): AffineFrame {
  const corners = [
    applyAffine(m, 0, 0),
    applyAffine(m, sw, 0),
    applyAffine(m, 0, sh),
    applyAffine(m, sw, sh),
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pv = applyAffine(m, pivotX, pivotY);
  return {
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
    pivotX: pv.x - minX,
    pivotY: pv.y - minY,
  };
}
