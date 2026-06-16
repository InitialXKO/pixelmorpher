'use client';

import React, { useCallback, useMemo } from 'react';
import type { PuppetNode, PuppetNodeKeyframe } from '@/lib/types';
import { PuppetKeyframeMarker } from './KeyframeMarker';
import { FRAME_WIDTH as STATIC_FRAME_WIDTH, TRACK_HEIGHT } from './constants';

// ---- Puppet Node Track Lane ----
const PuppetNodeTrackLane = React.memo(function PuppetNodeTrackLane({
  node,
  nodeKeyframes,
  selectedPuppetKeyframeId,
  totalFrames,
  onSelectPuppetKeyframe,
  onAddPuppetKeyframe,
  onDeletePuppetKeyframe,
  onMovePuppetKeyframeToFrame,
  onUpdatePuppetKeyframe,
  frameWidth,
}: {
  node: PuppetNode;
  nodeKeyframes: PuppetNodeKeyframe[];
  selectedPuppetKeyframeId: string | null;
  totalFrames: number;
  onSelectPuppetKeyframe: (id: string) => void;
  onAddPuppetKeyframe: (nodeId: string, frame: number) => void;
  onDeletePuppetKeyframe: (keyframeId: string) => void;
  onMovePuppetKeyframeToFrame: (keyframeId: string) => void;
  onUpdatePuppetKeyframe: (keyframeId: string, updates: Partial<PuppetNodeKeyframe>) => void;
  frameWidth?: number;
}) {
  const FRAME_WIDTH = frameWidth ?? STATIC_FRAME_WIDTH;
  const width = totalFrames * FRAME_WIDTH;
  const sortedKeyframes = useMemo(
    () => [...nodeKeyframes].sort((a, b) => a.frame - b.frame),
    [nodeKeyframes]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frame = Math.floor(x / FRAME_WIDTH);
      if (frame >= 0 && frame < totalFrames) {
        onAddPuppetKeyframe(node.id, frame);
      }
    },
    [node.id, totalFrames, onAddPuppetKeyframe]
  );

  return (
    <div
      data-track-lane
      className="relative border-b border-[#1e1e2e]"
      style={{
        height: TRACK_HEIGHT,
        width,
        minWidth: width,
        background: '#0e1028',
      }}
      onDoubleClick={handleDoubleClick}
      onClick={() => onSelectPuppetKeyframe('')}
    >
      {/* Grid lines */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            repeating-linear-gradient(
              90deg,
              rgba(30, 30, 46, 0.8) 0px,
              rgba(30, 30, 46, 0.8) 0.5px,
              transparent 0.5px,
              transparent ${FRAME_WIDTH}px
            )
          `,
          backgroundSize: `${FRAME_WIDTH}px ${TRACK_HEIGHT}px`,
        }}
      />

      {/* Interpolation lines between consecutive puppet keyframes */}
      {sortedKeyframes.length > 1 && (
        <svg
          width={width}
          height={TRACK_HEIGHT}
          className="absolute inset-0 pointer-events-none"
          style={{ minWidth: width }}
        >
          {sortedKeyframes.slice(0, -1).map((kf, i) => {
            const next = sortedKeyframes[i + 1];
            return (
              <line
                key={`puppet-interp-${kf.id}`}
                x1={kf.frame * FRAME_WIDTH + FRAME_WIDTH / 2}
                y1={TRACK_HEIGHT / 2}
                x2={next.frame * FRAME_WIDTH + FRAME_WIDTH / 2}
                y2={TRACK_HEIGHT / 2}
                stroke="#06b6d440"
                strokeWidth={2}
              />
            );
          })}
        </svg>
      )}

      {/* Puppet keyframe markers */}
      {sortedKeyframes.map((kf) => (
        <PuppetKeyframeMarker
          key={kf.id}
          keyframe={kf}
          isSelected={selectedPuppetKeyframeId === kf.id}
          onSelect={() => onSelectPuppetKeyframe(kf.id)}
          onDelete={() => onDeletePuppetKeyframe(kf.id)}
          onMoveToFrame={() => onMovePuppetKeyframeToFrame(kf.id)}
          totalFrames={totalFrames}
          siblingKeyframes={sortedKeyframes}
          onUpdatePuppetKeyframe={onUpdatePuppetKeyframe}
          frameWidth={FRAME_WIDTH}
        />
      ))}
    </div>
  );
}, (prevProps, nextProps) => {
  if (prevProps.node.id !== nextProps.node.id) return false;
  if (prevProps.nodeKeyframes !== nextProps.nodeKeyframes) return false;
  if (prevProps.selectedPuppetKeyframeId !== nextProps.selectedPuppetKeyframeId) return false;
  if (prevProps.totalFrames !== nextProps.totalFrames) return false;
  return true;
});

export default PuppetNodeTrackLane;
