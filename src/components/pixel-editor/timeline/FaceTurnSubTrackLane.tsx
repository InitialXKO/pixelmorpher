'use client';

import React, { useMemo } from 'react';
import { useProjectStore } from '@/lib/store';
import type { Node } from '@/lib/unified-types';
import { SUB_TRACK_HEIGHT } from './constants';

// ---- Node FaceTurn Sub-Track Lane ----
// 显示转面轨（tracks.faceTurnKeys）上的点（菱形标记），点击跳转到该帧
export const FaceTurnSubTrackLane = React.memo(function FaceTurnSubTrackLane({
  node,
  totalFrames,
  frameWidth,
}: {
  node: Node;
  totalFrames: number;
  frameWidth?: number;
}) {
  const fw = frameWidth ?? 24;
  const width = totalFrames * fw;
  const setCurrentFrame = useProjectStore((s) => s.setCurrentFrame);

  const ptsWithFaceTurn = useMemo(
    () => (node.tracks?.faceTurnKeys?.keyframes ?? []).filter(
      (pt) => Math.abs(pt.value.yaw) > 1e-6 || Math.abs(pt.value.pitch) > 1e-6,
    ),
    [node.tracks?.faceTurnKeys]
  );

  if (ptsWithFaceTurn.length === 0) return null;

  return (
    <div
      className="relative"
      style={{ width, height: SUB_TRACK_HEIGHT }}
      title="转面关键帧"
    >
      <div className="absolute left-0 top-0 bottom-0 flex items-center pl-1 pointer-events-none">
        <span className="text-[8px] text-orange-400/80">转面</span>
      </div>
      {ptsWithFaceTurn.map((pt) => {
        const x = pt.frame * fw + fw / 2;
        const yaw = pt.value.yaw.toFixed(1);
        const pitch = pt.value.pitch.toFixed(1);
        return (
          <button
            key={pt.frame}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 hover:scale-125 transition-transform"
            style={{ left: x }}
            title={`第 ${pt.frame} 帧 yaw=${yaw} pitch=${pitch}（点击跳转）`}
            onClick={() => setCurrentFrame(pt.frame)}
          >
            {/* 菱形标记 */}
            <div
              className="size-2 rotate-45 border border-orange-400 bg-orange-500/60"
            />
          </button>
        );
      })}
    </div>
  );
});
