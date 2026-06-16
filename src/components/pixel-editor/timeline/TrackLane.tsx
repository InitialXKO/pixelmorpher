'use client';

import React, { useCallback, useRef, useMemo } from 'react';
import type { Track, Keyframe, Part } from '@/lib/types';
import type { SnapConfig } from '@/lib/v15-types';
import KeyframeMarker from './KeyframeMarker';
import { getFrameWidth, TRACK_HEIGHT, SNAP_PIXEL_THRESHOLD } from './constants';

// ---- Track Lane ----
const TrackLane = React.memo(function TrackLane({
  track,
  keyframes,
  selectedKeyframeId,
  totalFrames,
  onSelectKeyframe,
  onAddKeyframe,
  onDeleteKeyframe,
  onDuplicateKeyframe,
  onMoveKeyframeToFrame,
  onUpdateKeyframe,
  // V15: Zoom, snap, color, thumbnail, frame step
  frameWidth,
  trackColor,
  snapConfig,
  snapFrame,
  showThumbnail,
  timelineThumbnailQuality,
  part,
  frameStep,
}: {
  track: Track;
  keyframes: Keyframe[];
  selectedKeyframeId: string | null;
  totalFrames: number;
  onSelectKeyframe: (id: string) => void;
  onAddKeyframe: (partId: string, frame: number) => void;
  onDeleteKeyframe: (id: string) => void;
  onDuplicateKeyframe: (id: string) => void;
  onMoveKeyframeToFrame: (id: string) => void;
  onUpdateKeyframe: (id: string, updates: Partial<Keyframe>) => void;
  // V15
  frameWidth?: number;
  trackColor?: string;
  snapConfig?: SnapConfig;
  snapFrame?: (rawFrame: number, excludeKeyframeId?: string) => number;
  showThumbnail?: boolean;
  timelineThumbnailQuality?: 'off' | 'low' | 'medium' | 'high';
  part?: Part;
  frameStep?: number;
}) {
  const fw = frameWidth ?? 24;
  const width = totalFrames * fw;
  const color = trackColor ?? '#f59e0b';
  const trackLaneRef = useRef<HTMLDivElement>(null);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (track.locked) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let frame = Math.floor(x / fw);
      // Apply smart snapping if available
      if (snapFrame) {
        frame = snapFrame(frame);
      }
      if (frame >= 0 && frame < totalFrames) {
        onAddKeyframe(track.partId, frame);
      }
    },
    [track.partId, track.locked, totalFrames, onAddKeyframe, fw, snapFrame]
  );

  // Generate thumbnail data URL for the part
  const thumbnailUrl = useMemo(() => {
    if (!showThumbnail || !part || !timelineThumbnailQuality || timelineThumbnailQuality === 'off') return null;
    // Use stored thumbnail or generate one inline from part pixels
    if (part.thumbnail) return part.thumbnail;
    // Generate a mini thumbnail from the pixels data
    try {
      const scale = Math.max(1, Math.floor(Math.max(part.width, part.height) / 32));
      const thumbW = Math.max(1, Math.floor(part.width / scale));
      const thumbH = Math.max(1, Math.floor(part.height / scale));
      const canvas = document.createElement('canvas');
      canvas.width = thumbW;
      canvas.height = thumbH;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      for (let y = 0; y < part.height; y += scale) {
        for (let x = 0; x < part.width; x += scale) {
          const color = part.pixels[Math.min(y, part.pixels.length - 1)]?.[Math.min(x, part.pixels[0]?.length - 1)];
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(Math.floor(x / scale), Math.floor(y / scale), 1, 1);
          }
        }
      }
      return canvas.toDataURL();
    } catch {
      return null;
    }
  }, [showThumbnail, part, timelineThumbnailQuality]);

  return (
    <div
      ref={trackLaneRef}
      data-track-lane
      className="relative border-b border-[#1e1e2e]"
      style={{
        height: TRACK_HEIGHT,
        width,
        minWidth: width,
        background: track.locked ? '#0e0e20' : '#12122a',
      }}
      onDoubleClick={handleDoubleClick}
      onClick={() => onSelectKeyframe('')}
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
              transparent ${fw}px
            )
          `,
          backgroundSize: `${fw}px ${TRACK_HEIGHT}px`,
        }}
      />

      {/* Interpolation lines between consecutive keyframes */}
      {keyframes.length > 1 && (
        <svg
          width={width}
          height={TRACK_HEIGHT}
          className="absolute inset-0 pointer-events-none"
          style={{ minWidth: width }}
        >
          {keyframes.slice(0, -1).map((kf, i) => {
            const next = keyframes[i + 1];
            return (
              <line
                key={`interp-${kf.id}`}
                x1={kf.frame * fw + fw / 2}
                y1={TRACK_HEIGHT / 2}
                x2={next.frame * fw + fw / 2}
                y2={TRACK_HEIGHT / 2}
                stroke={`${color}40`}
                strokeWidth={2}
              />
            );
          })}
        </svg>
      )}

      {/* V15: Frame step indicators — show markers for which frames this track animates */}
      {frameStep && frameStep > 1 && (
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: totalFrames }, (_, i) => i % frameStep === 0 ? null : null).map((_, i) => {
            // Draw dimmed overlay on skipped frames
            if (i % frameStep === 0) return null;
            return (
              <div
                key={`skip-${i}`}
                className="absolute top-0 h-full"
                style={{
                  left: i * fw,
                  width: fw,
                  background: 'rgba(0,0,0,0.15)',
                  opacity: 0.5,
                }}
              />
            );
          })}
        </div>
      )}

      {/* V15: Thumbnail preview on the track */}
      {thumbnailUrl && fw >= 8 && (
        <div
          className="absolute left-0 top-0 bottom-0 pointer-events-none opacity-20"
          style={{
            width: Math.min(64, fw * 3),
            overflow: 'hidden',
          }}
        >
          <img
            src={thumbnailUrl}
            alt=""
            className="w-full h-full object-contain"
            draggable={false}
          />
        </div>
      )}

      {/* Keyframe markers (HTML overlays for context menu support) */}
      {keyframes.map((kf) => (
        <KeyframeMarker
          key={kf.id}
          keyframe={kf}
          isSelected={selectedKeyframeId === kf.id}
          onSelect={() => onSelectKeyframe(kf.id)}
          onDelete={() => onDeleteKeyframe(kf.id)}
          onDuplicate={() => onDuplicateKeyframe(kf.id)}
          onMoveToFrame={() => onMoveKeyframeToFrame(kf.id)}
          totalFrames={totalFrames}
          siblingKeyframes={keyframes}
          onUpdateKeyframe={onUpdateKeyframe}
          // V15 props
          frameWidth={fw}
          trackColor={color}
          snapConfig={snapConfig}
          snapFrame={snapFrame}
        />
      ))}
    </div>
  );
}, (prevProps, nextProps) => {
  if (prevProps.track.id !== nextProps.track.id) return false;
  if (prevProps.track.locked !== nextProps.track.locked) return false;
  if (prevProps.track.visible !== nextProps.track.visible) return false;
  if (prevProps.keyframes !== nextProps.keyframes) return false;
  if (prevProps.selectedKeyframeId !== nextProps.selectedKeyframeId) return false;
  if (prevProps.totalFrames !== nextProps.totalFrames) return false;
  if (prevProps.frameWidth !== nextProps.frameWidth) return false;
  if (prevProps.trackColor !== nextProps.trackColor) return false;
  if (prevProps.frameStep !== nextProps.frameStep) return false;
  return true;
});

export default TrackLane;