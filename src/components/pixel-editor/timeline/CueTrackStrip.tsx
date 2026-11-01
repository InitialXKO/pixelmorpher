'use client';

// ============================================================
// CueTrackStrip — 时间线事件轨（角色级单轨）
// 一次性播放事件：定格 hitstop（秒）/ 震屏 shake（px）。
// 数据存 Character.cueTrack（KeyframeTrack<CueEventValue>），与
// 输入轨同实现路子：关键帧所在帧即触发（字面语义、无插值），
// 主画布播放时由 perform-fx 逐帧采样消费。不进运行时包。
// 交互：点轨面 = 在该帧加关键帧；点菱形 = 选中（下方编辑载荷/
// 删除）；拖菱形 = 改帧。横向滚动由父组件同步 scrollLeft。
// ============================================================

import React, { useCallback, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type { Character, CueEventValue, KeyframePoint, KeyframeTrack } from '@/lib/unified-types';
import { LABEL_WIDTH } from './constants';

const LANE_H = 16;
const COLOR = '#fb7185';
const LABEL = '事件 · 定格/震屏';
const HINT = '关键帧所在帧触发定格（秒）与震屏（px）';
const DEF_VALUE: CueEventValue = { hitstop: 0.12, shake: 6 };

interface Props {
  character: Character;
  totalFrames: number;
  currentFrame: number;
  frameWidth: number;
  timelineWidth: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export default function CueTrackStrip({ character, totalFrames, currentFrame, frameWidth, timelineWidth, scrollRef }: Props) {
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const dragRef = useRef<{ fromFrame: number; moved: boolean } | null>(null);

  const keyframes = character.cueTrack?.keyframes ?? [];

  const setKeyframes = useCallback((next: KeyframePoint<CueEventValue>[], undoLabel: string) => {
    const store = useProjectStore.getState();
    store.pushUndo(undoLabel, 'behavior');
    const track: KeyframeTrack<CueEventValue> = {
      keyframes: [...next].sort((a, b) => a.frame - b.frame),
      interpolation: 'step',
    };
    store.updateUnifiedCharacter(character.id, { cueTrack: track });
  }, [character.id]);

  const handleLaneMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frame = Math.max(0, Math.min(totalFrames - 1, Math.floor((e.clientX - rect.left) / frameWidth)));
    if (keyframes.some((k) => k.frame === frame)) { setSelectedFrame(frame); return; }
    setKeyframes([...keyframes, { frame, value: { ...DEF_VALUE } }], '事件轨加关键帧');
    setSelectedFrame(frame);
  };

  const handleDiamondMouseDown = (kfFrame: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFrame(kfFrame);
    dragRef.current = { fromFrame: kfFrame, moved: false };
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = Math.round((ev.clientX - startX) / frameWidth);
      if (delta === 0) return;
      const target = Math.max(0, Math.min(totalFrames - 1, d.fromFrame + delta));
      if (keyframes.some((k) => k.frame === target && k.frame !== d.fromFrame)) return;
      setKeyframes(keyframes.map((k) => (k.frame === d.fromFrame ? { ...k, frame: target } : k)), '事件轨移动关键帧');
      dragRef.current = { fromFrame: target, moved: true };
      setSelectedFrame(target);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const selKf = selectedFrame !== null ? keyframes.find((k) => k.frame === selectedFrame) : undefined;

  const patchSelected = (patch: Partial<CueEventValue>, undoLabel: string) => {
    if (selectedFrame === null) return;
    setKeyframes(
      keyframes.map((k) => (k.frame === selectedFrame ? { ...k, value: { ...k.value, ...patch } } : k)),
      undoLabel,
    );
  };

  return (
    <div className="shrink-0 border-b border-[#1e1e3a] bg-[#12122a]">
      <div className="flex">
        <div className="shrink-0 border-r border-[#1e1e3a]" style={{ width: LABEL_WIDTH }}>
          <div className="flex items-center px-2 gap-1" style={{ height: LANE_H }} title={HINT}>
            <span className="size-1.5 rotate-45 shrink-0" style={{ background: COLOR }} />
            <span className="text-[10px] text-gray-400 truncate select-none">{LABEL}</span>
          </div>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-hidden relative">
          <div className="relative" style={{ width: timelineWidth }}>
            <div className="absolute top-0 bottom-0 w-px bg-red-400/50 pointer-events-none" style={{ left: currentFrame * frameWidth + frameWidth / 2 }} />
            <div
              className="relative border-b border-white/5 cursor-crosshair"
              style={{ height: LANE_H }}
              onMouseDown={handleLaneMouseDown}
              title={`${LABEL}（${HINT}）点击加关键帧`}
            >
              {keyframes.map((kf) => {
                const isSel = selectedFrame === kf.frame;
                return (
                  <div
                    key={kf.frame}
                    className="absolute cursor-ew-resize"
                    style={{
                      left: kf.frame * frameWidth + frameWidth / 2 - 5,
                      top: LANE_H / 2 - 5,
                      width: 10, height: 10,
                      transform: 'rotate(45deg)',
                      background: isSel ? '#fff' : COLOR,
                      border: isSel ? `2px solid ${COLOR}` : '1px solid rgba(0,0,0,0.5)',
                      zIndex: 2,
                    }}
                    title={`帧 ${kf.frame} · 定格 ${kf.value?.hitstop ?? 0}s · 震屏 ${kf.value?.shake ?? 0}px`}
                    onMouseDown={handleDiamondMouseDown(kf.frame)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {selectedFrame !== null && selKf && (
        <div className="flex items-center gap-2 px-2 py-1 border-t border-white/5 text-[10px] text-gray-400">
          <span style={{ color: COLOR }}>{LABEL}</span>
          <span>帧 {selKf.frame}</span>
          <span className="text-gray-600">|</span>
          <span>定格（秒）</span>
          <input
            type="number" min={0} max={2} step={0.01} value={selKf.value?.hitstop ?? 0}
            onChange={(e) => patchSelected({ hitstop: Math.max(0, Math.min(2, parseFloat(e.target.value) || 0)) }, '事件轨改定格')}
            className="w-16 h-5 bg-white/5 border border-white/10 rounded px-1 text-gray-200"
          />
          <span>震屏（px）</span>
          <input
            type="number" min={0} max={40} step={1} value={selKf.value?.shake ?? 0}
            onChange={(e) => patchSelected({ shake: Math.max(0, Math.min(40, parseFloat(e.target.value) || 0)) }, '事件轨改震屏')}
            className="w-16 h-5 bg-white/5 border border-white/10 rounded px-1 text-gray-200"
          />
          <button
            className="ml-auto flex items-center gap-1 px-1.5 rounded bg-white/5 hover:bg-red-500/20 text-red-300"
            onClick={() => {
              setKeyframes(keyframes.filter((k) => k.frame !== selectedFrame), '事件轨删关键帧');
              setSelectedFrame(null);
            }}
          >
            <Trash2 className="size-3" /> 删除
          </button>
        </div>
      )}
    </div>
  );
}
