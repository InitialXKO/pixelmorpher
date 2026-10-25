// ============================================================
// 动态表面（D1）：SurfaceGraph.animation 的规范化与相位计算。
// 相位口径：连续时间 → 周期内相位 0..1 → 离散到 frames 步
// （步进式）。编辑器主画布、导出运行时、探针共用本口径；
// 导出运行时模板内的 JS 副本须与此处保持一致。
// ============================================================

import type { SurfaceAnimationSpec, SurfaceGraph } from '../unified-types';

/** 规范化动画规格；非法/缺失 → undefined（静态图） */
export function normalizeSurfaceAnimation(
  anim: SurfaceAnimationSpec | undefined | null,
): SurfaceAnimationSpec | undefined {
  if (!anim) return undefined;
  const cycleSec = Number(anim.cycleSec);
  const frames = Math.round(Number(anim.frames));
  if (!Number.isFinite(cycleSec) || cycleSec <= 0 || !Number.isFinite(frames)) return undefined;
  return {
    cycleSec: Math.min(120, Math.max(0.1, cycleSec)),
    frames: Math.min(60, Math.max(2, frames)),
  };
}

/** 图的动画规格（规范化后）；无动画 → undefined */
export function surfaceAnimationOf(
  graph: SurfaceGraph | undefined | null,
): SurfaceAnimationSpec | undefined {
  return graph ? normalizeSurfaceAnimation(graph.animation) : undefined;
}

/** 时间（秒）→ 离散相位（0..1，步进 = 1/frames 的整数倍，周期闭合） */
export function surfacePhaseAt(
  anim: SurfaceAnimationSpec | undefined | null,
  timeSec: number,
): number {
  const spec = normalizeSurfaceAnimation(anim);
  if (!spec) return 0;
  const t = Number.isFinite(timeSec) ? timeSec : 0;
  const frac = ((t / spec.cycleSec) % 1 + 1) % 1;
  return Math.floor(frac * spec.frames) / spec.frames;
}

/** 任意相位值规范化到 0..1（烘焙入口用；不做步进量化） */
export function normalizeSurfacePhase(phase: number | undefined): number {
  const p = phase ?? 0;
  if (!Number.isFinite(p)) return 0;
  return ((p % 1) + 1) % 1;
}
