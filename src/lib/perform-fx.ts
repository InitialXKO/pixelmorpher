// ============================================================
// PixelMorpher - 表演事件消费（事件轨 → 定格/震屏）
// ============================================================
// 事件来源 = 角色事件轨（Character.cueTrack，时间线角色级单轨，
// 与输入轨同实现路子）：关键帧载荷 {hitstop 定格秒数, shake 震屏
// 幅度 px}，关键帧所在帧即触发——按字面语义采样，无插值、无
// 边沿推断（第 F 帧有键 = 第 F 帧触发；紧邻两帧各有一键 = 两记
// 事件，各自计时）。逐帧采样是纯函数，拖动时间轴结果可复现。
// 消费两头接：
//   - 发布：PixelCanvas 主渲染每帧把 cueEventsAt（全部可见角色
//     采样聚合）经 performFx.publish 写入；
//   - 消费：playback-scheduler 推进工程帧前 performFx.observe——
//     触发后定格期内不推进 currentFrame（效果/姿态/标靶同冻，
//     与 pixelfx act 的 stop 同义），PixelCanvas 平移量叠加
//     performFx.shakeOffset 的震屏偏移（60Hz 离散方波 × 衰减包络）。
// 聚合口径：全部可见角色在该帧的事件，hitstop / shake 各取最大值
// （多角色同帧命中不叠加扣时/叠幅，取最重的一记）；各记定格各自
// 计时（后一记的定格从其触发时刻起算，不与前一记叠加延长）。
// 回退/循环回绕使帧号变小视为新一遍，判别状态复位、事件可再触发。
// 发布只在与观测同帧时有效（陈旧发布按无事件处理）。
//
// 边界（与输入轨同界）：事件轨是编辑器侧数据，不进运行时包——
// 包内播放是状态机驱动的交互场景、没有工程时间轴原点，事件帧号
// 无从映射；convert 对含有效事件的角色点名（见 convert.ts）。
// 与既有机制的关系：全局修改器的 shake 是用户自编的持续抖动，
// 与本事件通道互不相干、视觉上偏移叠加；本通道的定格只停工程
// 时间推进，不冻结 UI 与渲染循环本身。

import type { Character, CueEventValue, KeyframeTrack } from './unified-types';

export interface CueEventAggregate {
  /** 定格秒数（>0 才有事件） */
  hitstop: number;
  /** 震屏幅度 px（>0 才有事件） */
  shake: number;
}

export const NO_CUE_EVENTS: CueEventAggregate = { hitstop: 0, shake: 0 };

const pos = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** 采样一条事件轨在某帧的事件：仅当该帧恰有关键帧才触发（字面语义） */
export function sampleCueTrack(
  track: KeyframeTrack<CueEventValue> | undefined,
  frame: number,
): CueEventAggregate {
  if (!track || track.keyframes.length === 0) return NO_CUE_EVENTS;
  const kf = track.keyframes.find((k) => k.frame === frame);
  if (!kf) return NO_CUE_EVENTS;
  return { hitstop: pos(kf.value?.hitstop), shake: pos(kf.value?.shake) };
}

/** 全部角色在某帧的事件聚合（hitstop/shake 各取最大值） */
export function cueEventsAt(
  characters: Record<string, Character>,
  frame: number,
): CueEventAggregate {
  let hitstop = 0;
  let shake = 0;
  for (const character of Object.values(characters)) {
    const ev = sampleCueTrack(character.cueTrack, frame);
    if (ev.hitstop > hitstop) hitstop = ev.hitstop;
    if (ev.shake > shake) shake = ev.shake;
  }
  return { hitstop, shake };
}

/** 角色事件轨是否含有效事件（任一关键帧 hitstop/shake > 0；convert 点名用） */
export function characterHasCueEvents(character: Character): boolean {
  return (character.cueTrack?.keyframes ?? []).some(
    (k) => pos(k.value?.hitstop) > 0 || pos(k.value?.shake) > 0,
  );
}

/** 震屏包络最短时长（毫秒）：shake-only 的事件没有定格时长可依，按此下限衰减 */
export const SHAKE_MIN_DURATION_MS = 250;

export class PerformFxDriver {
  private published: { frame: number; events: CueEventAggregate } | null = null;
  /** 已判别过的（遍次，帧号）：每帧只判别一次，定格期反复观测同帧不重判 */
  private processedKey = '';
  private pass = 0;
  private lastFrame = -1;
  private freezeEndMs = 0;
  private shakeStartMs = 0;
  private shakeAmp = 0;
  private shakeDurationMs = 0;

  reset(): void {
    this.published = null;
    this.processedKey = '';
    this.pass = 0;
    this.lastFrame = -1;
    this.freezeEndMs = 0;
    this.shakeStartMs = 0;
    this.shakeAmp = 0;
    this.shakeDurationMs = 0;
  }

  /** 渲染侧每帧发布该帧的采样事件（发布与观测帧号须一致才被消费） */
  publish(frame: number, events: CueEventAggregate): void {
    this.published = { frame, events };
  }

  /**
   * 播放推进前观测当前帧：该帧有事件关键帧则触发定格/震屏；
   * 返回 true 表示本 tick 处于定格期（工程帧不推进）。
   * nowMs 与 rAF 时间戳同钟。
   */
  observe(frame: number, nowMs: number): boolean {
    if (this.lastFrame >= 0 && frame < this.lastFrame) {
      // 回退/跳帧/循环回绕 = 新一遍：判别状态复位，事件可再触发
      this.pass++;
    }
    this.lastFrame = frame;
    // 只认与观测帧同号的新鲜发布，且每（遍，帧）只判别一次
    const key = `${this.pass}:${frame}`;
    if (this.published && this.published.frame === frame && this.processedKey !== key) {
      this.processedKey = key;
      const ev = this.published.events;
      if (ev.hitstop > 0) this.freezeEndMs = nowMs + ev.hitstop * 1000;
      if (ev.shake > 0) {
        this.shakeAmp = ev.shake;
        this.shakeStartMs = nowMs;
        this.shakeDurationMs = Math.max(SHAKE_MIN_DURATION_MS, ev.hitstop * 1000);
      }
    }
    return nowMs < this.freezeEndMs;
  }

  /** 当前震屏偏移（px）：60Hz 离散方波 × 二次衰减包络；y 轴错半步相位 */
  shakeOffset(nowMs: number): { x: number; y: number } {
    if (this.shakeAmp <= 0 || this.shakeDurationMs <= 0) return { x: 0, y: 0 };
    const elapsed = nowMs - this.shakeStartMs;
    if (elapsed < 0 || elapsed >= this.shakeDurationMs) return { x: 0, y: 0 };
    const k = 1 - elapsed / this.shakeDurationMs;
    const env = this.shakeAmp * k * k;
    const stepMs = 1000 / 60;
    const sx = Math.floor(elapsed / stepMs) % 2 === 0 ? 1 : -1;
    const sy = Math.floor((elapsed + stepMs / 2) / stepMs) % 2 === 0 ? 1 : -1;
    return { x: env * sx, y: env * sy };
  }
}

/** 全局单例：scheduler 消费、PixelCanvas 发布并读偏移 */
export const performFx = new PerformFxDriver();
