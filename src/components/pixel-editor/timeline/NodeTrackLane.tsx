'use client';

import React, { useCallback, useMemo } from 'react';
import type { Node, NodeTracks } from '@/lib/unified-types';
import { NodeKeyframeMarker } from './KeyframeMarker';
import { NodeKeyframeModifierSubTrackLane, NodeParamDriverSubTrackLane } from './NodeKeyframeModifierSubTrackLane';
import { FaceTurnSubTrackLane } from './FaceTurnSubTrackLane';
import { FRAME_WIDTH as STATIC_FRAME_WIDTH, TRACK_HEIGHT } from './constants';

/** 轨道帧键的合成 id：`${nodeId}@${frame}` */
export const trackKeyId = (nodeId: string, frame: number) => `${nodeId}@${frame}`;

const TRACK_KEYS = ['angle', 'tilt', 'x', 'y', 'stretch', 'scaleX', 'variantIndex', 'zIndex', 'modifierKeys', 'faceTurnKeys', 'parentKeys'] as const;

/** 节点全部轨道（通道+附件）上有点帧的并集，升序 */
export function trackKeyFrames(tracks: NodeTracks | undefined): number[] {
  if (!tracks) return [];
  const frames = new Set<number>();
  for (const key of TRACK_KEYS) {
    for (const pt of tracks[key]?.keyframes ?? []) frames.add(pt.frame);
  }
  return [...frames].sort((a, b) => a - b);
}

// ---- Node Track Lane (new Character/Node model) ----
// 一行 = 一个节点；菱形 = 该帧在任一轨道上有点（姿态与附件同帧同键）
const NodeTrackLane = React.memo(function NodeTrackLane({
  node,
  characterId,
  selectedNodeKeyframeId,
  totalFrames,
  clipWindow,
  onSelectNodeKeyframe,
  onAddNodeKeyframe,
  onDeleteNodeKeyframe,
  onDuplicateNodeKeyframe,
  onMoveNodeKeyframeToFrame,
  onUpdateNodeKeyframe,
  frameWidth,
  snapConfig,
  snapFrame,
  onEditModifierParams,
  onEditParamDriver,
}: {
  node: Node;
  characterId: string;
  selectedNodeKeyframeId: string | null;
  totalFrames: number;
  /** 激活片段的时间窗（可视标记；窗外半透明） */
  clipWindow?: { startFrame: number; endFrame: number } | null;
  onSelectNodeKeyframe: (id: string) => void;
  onAddNodeKeyframe: (nodeId: string, frame: number) => void;
  onDeleteNodeKeyframe: (keyId: string) => void;
  onDuplicateNodeKeyframe: (keyId: string) => void;
  onMoveNodeKeyframeToFrame: (keyId: string) => void;
  onUpdateNodeKeyframe: (keyId: string, updates: { frame?: number }) => void;
  frameWidth?: number;
  snapConfig?: import('@/lib/v15-types').SnapConfig;
  snapFrame?: (rawFrame: number, excludeKeyframeId?: string) => number;
  onEditModifierParams?: (nodeId: string, frame: number, modifierId: string) => void;
  onEditParamDriver?: (nodeId: string, frame: number, modifierId: string, driverId: string) => void;
}) {
  const FRAME_WIDTH = frameWidth ?? STATIC_FRAME_WIDTH;
  const width = totalFrames * FRAME_WIDTH;
  const keyFrames = useMemo(() => trackKeyFrames(node.tracks), [node.tracks]);
  const siblingKeyframes = useMemo(
    () => keyFrames.map((f) => ({ id: trackKeyId(node.id, f), frame: f })),
    [keyFrames, node.id]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let frame = Math.floor(x / FRAME_WIDTH);
      // 吸附
      if (snapFrame && snapConfig?.enabled) {
        frame = snapFrame(frame);
      }
      if (frame >= 0 && frame < totalFrames) {
        onAddNodeKeyframe(node.id, frame);
      }
    },
    [node.id, totalFrames, onAddNodeKeyframe, FRAME_WIDTH, snapFrame, snapConfig]
  );

  return (
    <>
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

      {/* 片段时间窗外区域压暗（窗 = 该片段在工程时间轴上的段） */}
      {clipWindow && (
        <>
          {clipWindow.startFrame > 0 && (
            <div className="absolute top-0 bottom-0 left-0 pointer-events-none" style={{ width: clipWindow.startFrame * FRAME_WIDTH, background: 'rgba(0,0,0,0.45)' }} />
          )}
          {clipWindow.endFrame < totalFrames - 1 && (
            <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: (clipWindow.endFrame + 1) * FRAME_WIDTH, right: 0, background: 'rgba(0,0,0,0.45)' }} />
          )}
        </>
      )}

      {/* Interpolation lines between consecutive keyframes */}
      {keyFrames.length > 1 && (
        <svg
          width={width}
          height={TRACK_HEIGHT}
          className="absolute inset-0 pointer-events-none"
          style={{ minWidth: width }}
        >
          {keyFrames.slice(0, -1).map((f, i) => {
            const next = keyFrames[i + 1];
            return (
              <line
                key={`node-interp-${f}`}
                x1={f * FRAME_WIDTH + FRAME_WIDTH / 2}
                y1={TRACK_HEIGHT / 2}
                x2={next * FRAME_WIDTH + FRAME_WIDTH / 2}
                y2={TRACK_HEIGHT / 2}
                stroke="#06b6d440"
                strokeWidth={2}
              />
            );
          })}
        </svg>
      )}

      {/* Node keyframe markers */}
      {siblingKeyframes.map((kf) => (
        <NodeKeyframeMarker
          key={kf.id}
          keyframe={kf}
          isSelected={selectedNodeKeyframeId === kf.id}
          onSelect={() => onSelectNodeKeyframe(kf.id)}
          onDelete={() => onDeleteNodeKeyframe(kf.id)}
          onDuplicate={() => onDuplicateNodeKeyframe(kf.id)}
          onMoveToFrame={() => onMoveNodeKeyframeToFrame(kf.id)}
          totalFrames={totalFrames}
          siblingKeyframes={siblingKeyframes}
          onUpdateNodeKeyframe={onUpdateNodeKeyframe}
          frameWidth={FRAME_WIDTH}
          snapConfig={snapConfig}
          snapFrame={snapFrame}
        />
      ))}
    </div>
    {/* Per-keyframe modifier sub-tracks */}
    <NodeKeyframeModifierSubTrackLane
      node={node}
      totalFrames={totalFrames}
      frameWidth={FRAME_WIDTH}
      onEditModifierParams={onEditModifierParams ?? (() => {})}
    />
    {/* ParamDriver sub-tracks */}
    <NodeParamDriverSubTrackLane
      node={node}
      characterId={characterId}
      totalFrames={totalFrames}
      frameWidth={FRAME_WIDTH}
      onEditParamDriver={onEditParamDriver ?? (() => {})}
    />
    {/* FaceTurn sub-track */}
    <FaceTurnSubTrackLane
      node={node}
      totalFrames={totalFrames}
      frameWidth={FRAME_WIDTH}
    />
    </>
  );
}, (prevProps, nextProps) => {
  if (prevProps.node !== nextProps.node) return false;
  if (prevProps.selectedNodeKeyframeId !== nextProps.selectedNodeKeyframeId) return false;
  if (prevProps.totalFrames !== nextProps.totalFrames) return false;
  if (prevProps.frameWidth !== nextProps.frameWidth) return false;
  if (prevProps.snapConfig !== nextProps.snapConfig) return false;
  if (prevProps.clipWindow?.startFrame !== nextProps.clipWindow?.startFrame) return false;
  if (prevProps.clipWindow?.endFrame !== nextProps.clipWindow?.endFrame) return false;
  return true;
});

export default NodeTrackLane;
