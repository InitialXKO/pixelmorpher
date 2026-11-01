// ============================================================
// behavior-host — 主画布的行为宿主变量（纯函数）
// 此处的「宿主」指喂输入变量的外部应用（行为宿主）；与
// host-fx 的「宿主像素」（被挂载部件自身的像素）是两个不同
// 概念，勿混。
// 行为图的宿主契约与运行时包一致：var 节点读
// t（秒）/ phase（步态相位，圈数）/ moveX（-1..1）/
// speed01（0..1）/ grounded（1/0）。
// 输入来源 = 角色输入轨（Character.inputTracks，时间线角色级三轨），
// 缺轨取静止缺省（moveX=0、speed01=0、grounded=1）。
// phase 是输入轨的积分：从第 0 帧逐帧累加速率——任意帧的值只由
// 输入轨决定，拖动时间轴可复现。速率口径与运行时宿主一致（圈/秒）：
// 在地面移动 (4+26×speed01)/60（满速 0.5 圈/秒）、静止 1/15、腾空 0.3。
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
 *  （step 在关键帧帧切换，与主渲染 interpolateTrack 同口径）；
 *  段内按插值模式（step 保持/其余线性） */
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

/** 相位速率（圈/秒）：1 圈 = 旧口径 60 相位帧 */
export function behaviorPhaseRate(input: { moveX: number; speed01: number; grounded: number }): number {
  if (input.grounded < 0.5) return 18 / 60;
  const moving = Math.abs(input.moveX) > 0.05 || input.speed01 > 0.05;
  return moving ? (4 + 26 * input.speed01) / 60 : 4 / 60;
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
