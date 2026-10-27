// 五官点位参数（借 PoseSketcher「头部参数化图元 + 比例点位」形态）：
// 点位写成相对头部框的比例，是角色级可调参数，存头部节点
// （node.faceFeatures，与 node.faceTurn 同类位置）；垫图/预览按参数
// 现算，转面 yaw/pitch 时点位按朝向压缩平移作对位参照。
// 头部框：x ∈ [0,1] 左→右，y ∈ [0,1] 顶→底。

export interface FaceFeatureParams {
  /** 眉线高（相对框高，顶=0） */
  browY: number;
  /** 眼线高 */
  eyeY: number;
  /** 眼距：两眼中心间距 / 框宽 */
  eyeSpacing: number;
  /** 眼半宽 / 框宽 */
  eyeHalfW: number;
  /** 鼻底高 */
  noseBaseY: number;
  /** 鼻半宽 / 框宽 */
  noseHalfW: number;
  /** 嘴线高 */
  mouthY: number;
  /** 嘴半宽 / 框宽 */
  mouthHalfW: number;
}

/** 标准三庭五眼缺省组 */
export const DEFAULT_FACE_FEATURES: FaceFeatureParams = {
  browY: 0.3,
  eyeY: 0.38,
  eyeSpacing: 0.4,
  eyeHalfW: 0.09,
  noseBaseY: 0.62,
  noseHalfW: 0.06,
  mouthY: 0.78,
  mouthHalfW: 0.11,
};

export interface FaceFeaturePoints {
  browL: { x: number; y: number };
  browR: { x: number; y: number };
  eyeL: { x: number; y: number };
  eyeR: { x: number; y: number };
  /** 鼻底中心（鼻翼左右端由 noseHalfW 另取） */
  noseBase: { x: number; y: number };
  mouth: { x: number; y: number };
}

/**
 * 参数 → 头部框内点位（0..1 坐标）。yaw/pitch 转面压缩：
 * yaw 横向压缩（1−0.55·|yaw|）+ 整体向转侧平移（0.18·yaw）；
 * pitch 纵向向中心收（1−0.25·|pitch|）+ 整体平移（0.06·pitch）。
 * yaw/pitch 缺省 0（正脸）。
 */
export function faceFeaturePoints(
  p: FaceFeatureParams,
  yaw = 0,
  pitch = 0,
): FaceFeaturePoints {
  const xScale = 1 - 0.55 * Math.abs(yaw);
  const xShift = 0.18 * yaw;
  const cx = (offset: number) => 0.5 + offset * xScale + xShift;
  const yT = (y: number) => 0.5 + (y - 0.5) * (1 - 0.25 * Math.abs(pitch)) + 0.06 * pitch;
  const half = p.eyeSpacing / 2;
  return {
    browL: { x: cx(-half), y: yT(p.browY) },
    browR: { x: cx(half), y: yT(p.browY) },
    eyeL: { x: cx(-half), y: yT(p.eyeY) },
    eyeR: { x: cx(half), y: yT(p.eyeY) },
    noseBase: { x: cx(0), y: yT(p.noseBaseY) },
    mouth: { x: cx(0), y: yT(p.mouthY) },
  };
}

/** 转面后的有效半宽（横向随 yaw 压缩） */
export function faceHalfWidths(p: FaceFeatureParams, yaw = 0): {
  eye: number; nose: number; mouth: number;
} {
  const s = 1 - 0.55 * Math.abs(yaw);
  return { eye: p.eyeHalfW * s, nose: p.noseHalfW * s, mouth: p.mouthHalfW * s };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 把一组参数钳回合法域（拖点/滑杆写回前用） */
export function clampFaceFeatures(p: FaceFeatureParams): FaceFeatureParams {
  return {
    browY: clamp01(p.browY),
    eyeY: clamp01(p.eyeY),
    eyeSpacing: Math.min(0.9, Math.max(0.1, p.eyeSpacing)),
    eyeHalfW: Math.min(0.25, Math.max(0.02, p.eyeHalfW)),
    noseBaseY: clamp01(p.noseBaseY),
    noseHalfW: Math.min(0.2, Math.max(0.02, p.noseHalfW)),
    mouthY: clamp01(p.mouthY),
    mouthHalfW: Math.min(0.3, Math.max(0.02, p.mouthHalfW)),
  };
}
