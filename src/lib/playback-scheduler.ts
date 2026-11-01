// ============================================================
// PixelMorpher - Unified Playback Scheduler (B1)
// ============================================================
// Replaces the dual requestAnimationFrame loops in Timeline.tsx
// and PixelCanvas.tsx with a single coordinated loop.
//
// Problem: Timeline's rAF drives frame advancement, PixelCanvas's
// rAF drives rendering. Without coordination, there's ~16ms delay
// between frame advancement and rendering (one full rAF tick).
//
// Solution: A single rAF loop that advances the frame AND triggers
// rendering in the same animation frame. The scheduler notifies
// registered render callbacks immediately after advancing the frame,
// eliminating the inter-rAF delay.
// ============================================================

import { useProjectStore } from './store';
import { performFx } from './perform-fx';

type RenderCallback = () => void;

/** Registered render callbacks that should be called in the same rAF tick as frame advancement */
const renderCallbacks = new Set<RenderCallback>();

/** Whether the scheduler is currently running */
let isRunning = false;

/** The current rAF handle */
let rafHandle: number | null = null;

/** Time accumulator for frame-accurate playback */
let lastTimestamp = 0;

/** Register a render callback to be called after each frame advancement */
export function registerRenderCallback(cb: RenderCallback): () => void {
  renderCallbacks.add(cb);
  return () => { renderCallbacks.delete(cb); };
}

/**
 * 播放推进一步的落帧计算（纯函数，调度器本体与探针共用同一实现）。
 * 有激活片段时按片段窗 [startFrame, endFrame] 推进：loop 在窗内
 * 回绕、非 loop 停在末帧不再前进；播放头在窗外时先纳入窗内
 * （起点取 startFrame、越尾按 loop 口径处理）。无激活片段时按
 * 工程 totalFrames 回绕（旧口径不变）。
 */
export function advancePlaybackFrame(
  currentFrame: number,
  framesToAdvance: number,
  totalFrames: number,
  clip?: { startFrame: number; endFrame: number; loop: boolean } | null,
): number {
  if (clip && clip.endFrame >= clip.startFrame) {
    const start = clip.startFrame;
    const end = clip.endFrame;
    const len = end - start + 1;
    const next = currentFrame + framesToAdvance;
    if (next > end) return clip.loop ? start + ((next - start) % len) : end;
    if (next < start) return start;
    return next;
  }
  const nextFrame = currentFrame + framesToAdvance;
  return nextFrame >= totalFrames ? nextFrame % totalFrames : nextFrame;
}

/** Start the unified playback loop */
export function startPlayback(): void {
  if (isRunning) return;
  isRunning = true;
  lastTimestamp = 0;
  performFx.reset();

  const loop = (timestamp: number) => {
    if (!isRunning) return;

    if (lastTimestamp === 0) {
      lastTimestamp = timestamp;
      rafHandle = requestAnimationFrame(loop);
      return;
    }

    // 表演事件消费（事件轨定格/震屏）：PixelCanvas 渲染时发布
    // 当前帧的采样事件，此处在推进前观测——定格期内工程时间不
    // 推进（lastTimestamp 跟随本 tick，免得解冻后把冻结时长算进
    // 推进量），但渲染回调照常触发（震屏包络逐 tick 在变）。
    if (performFx.observe(useProjectStore.getState().currentFrame, timestamp)) {
      lastTimestamp = timestamp;
      for (const cb of renderCallbacks) {
        try { cb(); } catch (_) { /* skip failing callbacks */ }
      }
      rafHandle = requestAnimationFrame(loop);
      return;
    }

    const state = useProjectStore.getState();
    const { currentFrame, totalFrames, frameRate } = state;
    const frameDuration = 1000 / frameRate;
    const elapsed = timestamp - lastTimestamp;

    if (elapsed >= frameDuration) {
      const framesToAdvance = Math.floor(elapsed / frameDuration);
      lastTimestamp += framesToAdvance * frameDuration;

      // 激活片段在场时按片段窗/loop 推进（advancePlaybackFrame）
      const activeClip = state.activeAnimationClipId
        ? state.animationClips.find((c) => c.id === state.activeAnimationClipId)
        : undefined;
      const newFrame = advancePlaybackFrame(currentFrame, framesToAdvance, totalFrames, activeClip);
      state.setCurrentFrame(newFrame);

      // B1: Notify all render callbacks in the SAME rAF tick.
      // This eliminates the ~16ms delay of the old dual-loop approach
      // where PixelCanvas could only pick up the state change in the next rAF.
      for (const cb of renderCallbacks) {
        try { cb(); } catch (_) { /* skip failing callbacks */ }
      }
    }

    rafHandle = requestAnimationFrame(loop);
  };

  rafHandle = requestAnimationFrame(loop);
}

/** Stop the unified playback loop */
export function stopPlayback(): void {
  isRunning = false;
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}

