'use client';

import React, { useCallback, useMemo } from 'react';
import type { Node, NodeKeyframe } from '@/lib/unified-types';
import { NodeKeyframeMarker } from './KeyframeMarker';
import { FRAME_WIDTH as STATIC_FRAME_WIDTH, TRACK_HEIGHT } from './constants';

// ---- Node Track Lane (new Character/Node model) ----
const NodeTrackLane = React.memo(function NodeTrackLane({
  node,
  nodeKeyframes,
  selectedNodeKeyframeId,
  totalFrames,
  onSelectNodeKeyframe,
  onAddNodeKeyframe,
  onDeleteNodeKeyframe,
  onMoveNodeKeyframeToFrame,
  onUpdateNodeKeyframe,
  frameWidth,
  snapConfig,
  snapFrame,
}: {
  node: Node;
  nodeKeyframes: NodeKeyframe[];
  selectedNodeKeyframeId: string | null;
  totalFrames: number;
  onSelectNodeKeyframe: (id: string) => void;
  onAddNodeKeyframe: (nodeId: string, frame: number) => void;
  onDeleteNodeKeyframe: (keyframeId: string) => void;
  onMoveNodeKeyframeToFrame: (keyframeId: string) => void;
  onUpdateNodeKeyframe: (keyframeId: string, updates: Partial<NodeKeyframe>) => void;
  frameWidth?: number;
  snapConfig?: import('@/lib/v15-types').SnapConfig;
  snapFrame?: (rawFrame: number, excludeKeyframeId?: string) => number;
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
        onAddNodeKeyframe(node.id, frame);
      }
    },
    [node.id, totalFrames, onAddNodeKeyframe, FRAME_WIDTH]
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
      onClick={() => onSelectNodeKeyframe('')}
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

      {/* Interpolation lines between consecutive keyframes */}
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
                key={`node-interp-${kf.id}`}
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

      {/* Node keyframe markers */}
      {sortedKeyframes.map((kf) => (
        <NodeKeyframeMarker
          key={kf.id}
          keyframe={kf}
          isSelected={selectedNodeKeyframeId === kf.id}
          onSelect={() => onSelectNodeKeyframe(kf.id)}
          onDelete={() => onDeleteNodeKeyframe(kf.id)}
          onMoveToFrame={() => onMoveNodeKeyframeToFrame(kf.id)}
          totalFrames={totalFrames}
          siblingKeyframes={sortedKeyframes}
          onUpdateNodeKeyframe={onUpdateNodeKeyframe}
          frameWidth={FRAME_WIDTH}
          snapConfig={snapConfig}
          snapFrame={snapFrame}
        />
      ))}
    </div>
  );
}, (prevProps, nextProps) => {
  if (prevProps.node.id !== nextProps.node.id) return false;
  if (prevProps.nodeKeyframes !== nextProps.nodeKeyframes) return false;
  if (prevProps.selectedNodeKeyframeId !== nextProps.selectedNodeKeyframeId) return false;
  if (prevProps.totalFrames !== nextProps.totalFrames) return false;
  if (prevProps.frameWidth !== nextProps.frameWidth) return false;
  return true;
});

export default NodeTrackLane;
