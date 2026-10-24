'use client';

// ============================================================
// InputTracksStrip — 时间线输入轨（角色级三轨）
// 行为图的宿主输入：移动方向 moveX / 速度 speed01 / 在地面 grounded。
// 数据存 Character.inputTracks（KeyframeTrack<number>），主画布播放
// 与拖动时由 behavior-host 逐帧采样喂行为图 var 节点。
// 交互：点轨面 = 在该帧加关键帧；点菱形 = 选中（下方编辑值/过渡/删除）；
// 拖菱形 = 改帧。横向滚动由父组件 handleTrackScroll 同步 scrollLeft。
// ============================================================

import React, { useCallback, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type { Character, KeyframePoint, KeyframeTrack } from '@/lib/unified-types';
import { LABEL_WIDTH } from './constants';

type InputLaneKey = 'moveX' | 'speed01' | 'grounded';

const LANES: { key: InputLaneKey; label: string; hint: string; color: string; defValue: number; defMode: 'step' | 'linear' }[] = [
  { key: 'moveX', label: '输入 · 移动方向', hint: '-1 左 / 0 停 / 1 右', color: '#38bdf8', defValue: 1, defMode: 'step' },
  { key: 'speed01', label: '输入 · 速度', hint: '0 静止 ~ 1 全速', color: '#fbbf24', defValue: 1, defMode: 'linear' },
  { key: 'grounded', label: '输入 · 在地面', hint: '1 在地面 / 0 腾空', color: '#34d399', defValue: 0, defMode: 'step' },
];

const LANE_H = 16;

interface Props {
  character: Character;
  totalFrames: number;
  currentFrame: number;
  frameWidth: number;
  timelineWidth: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export default function InputTracksStrip({ character, totalFrames, currentFrame, frameWidth, timelineWidth, scrollRef }: Props) {
  const [selected, setSelected] = useState<{ lane: InputLaneKey; frame: number } | null>(null);
  const dragRef = useRef<{ lane: InputLaneKey; fromFrame: number; moved: boolean } | null>(null);

  const tracks = character.inputTracks ?? {};

  const writeTracks = useCallback((next: NonNullable<Character['inputTracks']>, undoLabel: string) => {
    const store = useProjectStore.getState();
    store.pushUndo(undoLabel, 'behavior');
    store.updateUnifiedCharacter(character.id, { inputTracks: next });
  }, [character.id]);

  const setLaneKeyframes = useCallback((lane: InputLaneKey, keyframes: KeyframePoint<number>[], undoLabel: string) => {
    const def = LANES.find((l) => l.key === lane)!;
    const track: KeyframeTrack<number> = { keyframes: [...keyframes].sort((a, b) => a.frame - b.frame), interpolation: def.defMode };
    writeTracks({ ...tracks, [lane]: track }, undoLabel);
  }, [tracks, writeTracks]);

  const laneKfs = (lane: InputLaneKey) => tracks[lane]?.keyframes ?? [];

  const handleLaneMouseDown = (lane: InputLaneKey) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frame = Math.max(0, Math.min(totalFrames - 1, Math.floor((e.clientX - rect.left) / frameWidth)));
    const existing = laneKfs(lane).find((k) => k.frame === frame);
    if (existing) { setSelected({ lane, frame }); return; }
    const def = LANES.find((l) => l.key === lane)!;
    setLaneKeyframes(lane, [...laneKfs(lane), { frame, value: def.defValue }], '输入轨加关键帧');
    setSelected({ lane, frame });
  };

  const handleDiamondMouseDown = (lane: InputLaneKey, kfFrame: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected({ lane, frame: kfFrame });
    dragRef.current = { lane, fromFrame: kfFrame, moved: false };
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = Math.round((ev.clientX - startX) / frameWidth);
      if (delta === 0) return;
      const target = Math.max(0, Math.min(totalFrames - 1, d.fromFrame + delta));
      const kfs = laneKfs(d.lane);
      if (kfs.some((k) => k.frame === target && k.frame !== d.fromFrame)) return;
      setLaneKeyframes(d.lane, kfs.map((k) => (k.frame === d.fromFrame ? { ...k, frame: target } : k)), '输入轨移动关键帧');
      dragRef.current = { lane: d.lane, fromFrame: target, moved: true };
      setSelected({ lane: d.lane, frame: target });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const selKf = selected ? laneKfs(selected.lane).find((k) => k.frame === selected.frame) : undefined;
  const selLane = selected ? LANES.find((l) => l.key === selected.lane) : undefined;

  const patchSelected = (patch: Partial<KeyframePoint<number>>, undoLabel: string) => {
    if (!selected) return;
    setLaneKeyframes(selected.lane, laneKfs(selected.lane).map((k) => (k.frame === selected.frame ? { ...k, ...patch } : k)), undoLabel);
  };

  return (
    <div className="shrink-0 border-b border-[#1e1e3a] bg-[#12122a]">
      <div className="flex">
        {/* 标签列（与主时间线 LABEL_WIDTH 对齐） */}
        <div className="shrink-0 border-r border-[#1e1e3a]" style={{ width: LABEL_WIDTH }}>
          {LANES.map((lane) => (
            <div key={lane.key} className="flex items-center px-2 gap-1" style={{ height: LANE_H }} title={lane.hint}>
              <span className="size-1.5 rotate-45 shrink-0" style={{ background: lane.color }} />
              <span className="text-[10px] text-gray-400 truncate select-none">{lane.label}</span>
            </div>
          ))}
        </div>
        {/* 轨面（横向滚动由父组件同步） */}
        <div ref={scrollRef} className="flex-1 overflow-hidden relative">
          <div className="relative" style={{ width: timelineWidth }}>
            {/* 播放头 */}
            <div className="absolute top-0 bottom-0 w-px bg-red-400/50 pointer-events-none" style={{ left: currentFrame * frameWidth + frameWidth / 2 }} />
            {LANES.map((lane) => (
              <div
                key={lane.key}
                className="relative border-b border-white/5 cursor-crosshair"
                style={{ height: LANE_H }}
                onMouseDown={handleLaneMouseDown(lane.key)}
                title={`${lane.label}（${lane.hint}）点击加关键帧`}
              >
                {laneKfs(lane.key).map((kf) => {
                  const isSel = selected?.lane === lane.key && selected.frame === kf.frame;
                  return (
                    <div
                      key={kf.frame}
                      className="absolute cursor-ew-resize"
                      style={{
                        left: kf.frame * frameWidth + frameWidth / 2 - 5,
                        top: LANE_H / 2 - 5,
                        width: 10, height: 10,
                        transform: 'rotate(45deg)',
                        background: isSel ? '#fff' : lane.color,
                        border: isSel ? `2px solid ${lane.color}` : '1px solid rgba(0,0,0,0.5)',
                        zIndex: 2,
                      }}
                      title={`帧 ${kf.frame} · 值 ${kf.value}`}
                      onMouseDown={handleDiamondMouseDown(lane.key, kf.frame)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* 选中关键帧编辑条 */}
      {selected && selKf && selLane && (
        <div className="flex items-center gap-2 px-2 py-1 border-t border-white/5 text-[10px] text-gray-400">
          <span style={{ color: selLane.color }}>{selLane.label}</span>
          <span>帧 {selKf.frame}</span>
          <span className="text-gray-600">|</span>
          {selected.lane === 'moveX' && (
            <span className="flex gap-1">
              {[-1, 0, 1].map((v) => (
                <button key={v} className={`px-1.5 rounded ${selKf.value === v ? 'bg-sky-600 text-white' : 'bg-white/5 hover:bg-white/10'}`}
                  onClick={() => patchSelected({ value: v }, '输入轨改值')}>
                  {v === -1 ? '左 -1' : v === 0 ? '停 0' : '右 1'}
                </button>
              ))}
            </span>
          )}
          {selected.lane === 'speed01' && (
            <input
              type="number" min={0} max={1} step={0.05} value={selKf.value}
              onChange={(e) => patchSelected({ value: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) }, '输入轨改值')}
              className="w-16 h-5 bg-white/5 border border-white/10 rounded px-1 text-gray-200"
            />
          )}
          {selected.lane === 'grounded' && (
            <span className="flex gap-1">
              {[1, 0].map((v) => (
                <button key={v} className={`px-1.5 rounded ${selKf.value === v ? 'bg-emerald-600 text-white' : 'bg-white/5 hover:bg-white/10'}`}
                  onClick={() => patchSelected({ value: v }, '输入轨改值')}>
                  {v === 1 ? '在地面' : '腾空'}
                </button>
              ))}
            </span>
          )}
          <span className="text-gray-600">|</span>
          <span>过渡到本帧</span>
          <select
            value={selKf.interpolation ?? selLane.defMode}
            onChange={(e) => patchSelected({ interpolation: e.target.value as 'step' | 'linear' }, '输入轨改过渡')}
            className="h-5 bg-[#111128] border border-white/10 rounded text-gray-300 px-1"
          >
            <option value="step">阶梯（突变）</option>
            <option value="linear">线性（渐变）</option>
          </select>
          <button
            className="ml-auto flex items-center gap-1 px-1.5 rounded bg-white/5 hover:bg-red-500/20 text-red-300"
            onClick={() => {
              setLaneKeyframes(selected.lane, laneKfs(selected.lane).filter((k) => k.frame !== selected.frame), '输入轨删关键帧');
              setSelected(null);
            }}
          >
            <Trash2 className="size-3" /> 删除
          </button>
        </div>
      )}
    </div>
  );
}
