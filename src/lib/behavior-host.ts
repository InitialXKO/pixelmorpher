// ============================================================
// behavior-host — 主画布的行为宿主变量（纯函数）
// 行为图的宿主契约与运行时包一致：var 节点读
// t（秒）/ phase（步态相位，60fps 帧）/ moveX（-1..1）/
// speed01（0..1）/ grounded（1/0）。
// 输入来源 = 角色输入轨（Character.inputTracks，时间线角色级三轨），
// 缺轨取静止缺省（moveX=0、speed01=0、grounded=1）。
// phase 是输入轨的积分：从第 0 帧逐帧累加速率——任意帧的值只由
// 输入轨决定，拖动时间轴可复现。速率口径与运行时宿主一致：
// 在地面移动 4+26×speed01（满速 30/s）、静止 4/s、腾空 18/s。
// ============================================================

import type { Character, KeyframeTrack } from './unified-types';

export interface BehaviorHostVars {
  t: number;
  phase: number;
  moveX: number;
  speed01: number;
  grounded: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 采样一条输入轨：首尾外钳制端值；关键帧所在帧即取该帧值
 *  （step 在关键帧帧切换——与 interpolateTrack 在边界帧仍取旧值的
 *  怪癖不同，输入轨按字面语义）；段内按插值模式（step 保持/其余线性） */
export function sampleInputTrack(
  track: KeyframeTrack<number> | undefined,
  frame: number,
  fallback: number,
): number {
  if (!track || track.keyframes.length === 0) return fallback;
  const kfs = [...track.keyframes].sort((a, b) => a.frame - b.frame);
  if (frame <= kfs[0]!.frame) return kfs[0]!.value;
  if (frame >= kfs[kfs.length - 1]!.frame) return kfs[kfs.length - 1]!.value;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!, b = kfs[i + 1]!;
    if (frame >= a.frame && frame < b.frame) {
      const mode = b.interpolation ?? track.interpolation;
      if (mode === 'step') return a.value;
      const t = (frame - a.frame) / Math.max(1, b.frame - a.frame);
      return a.value + (b.value - a.value) * t;
    }
  }
  return fallback;
}

/** 某一帧的原始输入（未积分） */
export function behaviorInputAt(
  character: Character,
  frame: number,
): { moveX: number; speed01: number; grounded: number } {
  const it = character.inputTracks;
  return {
    moveX: clamp(sampleInputTrack(it?.moveX, frame, 0), -1, 1),
    speed01: clamp(sampleInputTrack(it?.speed01, frame, 0), 0, 1),
    grounded: sampleInputTrack(it?.grounded, frame, 1) >= 0.5 ? 1 : 0,
  };
}

/** 相位速率（相位帧/秒） */
export function behaviorPhaseRate(input: { moveX: number; speed01: number; grounded: number }): number {
  if (input.grounded < 0.5) return 18;
  const moving = Math.abs(input.moveX) > 0.05 || input.speed01 > 0.05;
  return moving ? 4 + 26 * input.speed01 : 4;
}

/** 完整宿主变量：t + 当前帧输入 + phase 积分（0→当前帧逐帧累加） */
export function behaviorHostVars(
  character: Character,
  frame: number,
  frameRate: number,
): BehaviorHostVars {
  const cur = behaviorInputAt(character, frame);
  let phase = 0;
  const steps = Math.max(0, Math.floor(frame));
  for (let f = 1; f <= steps; f++) {
    phase += behaviorPhaseRate(behaviorInputAt(character, f)) / frameRate;
  }
  return { t: frame / frameRate, phase, ...cur };
}
