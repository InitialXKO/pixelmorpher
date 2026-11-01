'use client';

import React, { useMemo } from 'react';
import { useProjectStore } from '@/lib/store';
import type { Node, ModifierType, ModifierParamKeyframe } from '@/lib/unified-types';
import { MODIFIER_DEFINITIONS } from '@/lib/types';
import { SUB_TRACK_HEIGHT, CATEGORY_COLOR_MAP } from './constants';

// ---- Node Modifier-Key Sub-Track Lane ----
// 为 Node 修改器组轨（tracks.modifierKeys）显示子轨道
// 每个 modifier type 一行，显示拥有该 modifier 的轨点及其 param keyframes
export const NodeKeyframeModifierSubTrackLane = React.memo(function NodeKeyframeModifierSubTrackLane({
  node,
  totalFrames,
  frameWidth,
  onEditModifierParams,
}: {
  node: Node;
  totalFrames: number;
  frameWidth?: number;
  onEditModifierParams: (nodeId: string, frame: number, modifierId: string) => void;
}) {
  const fw = frameWidth ?? 24;
  const width = totalFrames * fw;
  const points = useMemo(
    () => [...(node.tracks?.modifierKeys?.keyframes ?? [])].sort((a, b) => a.frame - b.frame),
    [node.tracks?.modifierKeys]
  );

  // 收集所有 modifier types
  const modifierTypes = useMemo(() => {
    const types = new Set<ModifierType>();
    for (const pt of points) {
      for (const mod of pt.value ?? []) {
        types.add(mod.type);
      }
    }
    return Array.from(types);
  }, [points]);

  if (modifierTypes.length === 0) return null;

  return (
    <>
      {modifierTypes.map((modType) => {
        const def = MODIFIER_DEFINITIONS.find((d) => d.type === modType);
        const category = def?.category ?? 'transform';
        const color = CATEGORY_COLOR_MAP[category] ?? '#3b82f6';
        const label = def?.label ?? modType;

        // 拥有该 modifier 的轨点
        const ptsWithMod = points.filter((pt) =>
          (pt.value ?? []).some((m) => m.type === modType)
        );

        // 收集所有 param keyframes
        const allParamKfs: { frame: number; ptFrame: number; modId: string; pkf: ModifierParamKeyframe }[] = [];
        for (const pt of ptsWithMod) {
          const mod = pt.value!.find((m) => m.type === modType)!;
          for (const pkf of (Array.isArray(mod.paramKeyframes) ? mod.paramKeyframes : []) as ModifierParamKeyframe[]) {
            allParamKfs.push({ frame: pkf.frame, ptFrame: pt.frame, modId: mod.id, pkf });
          }
        }
        allParamKfs.sort((a, b) => a.frame - b.frame);

        return (
          <div
            key={`node-mod-${node.id}-${modType}`}
            className="relative border-b border-[#1a1a2e]"
            style={{ height: SUB_TRACK_HEIGHT, width, minWidth: width, background: '#0c0c1e' }}
            data-track-lane
          >
            {/* Modifier type label */}
            <div
              className="absolute left-1 top-1/2 -translate-y-1/2 text-[9px] px-1 rounded pointer-events-none select-none"
              style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
            >
              {label}
            </div>

            {/* Keyframe markers that have this modifier */}
            {ptsWithMod.map((pt) => {
              const mod = pt.value!.find((m) => m.type === modType)!;
              return (
                <button
                  key={`mod-kf-${pt.frame}`}
                  className="absolute top-1/2 -translate-y-1/2 size-2.5 rotate-45 rounded-[2px] hover:scale-125 transition-transform"
                  style={{
                    left: pt.frame * fw + fw / 2 - 5,
                    backgroundColor: color,
                    opacity: mod.enabled ? 1 : 0.4,
                  }}
                  title={`${label} @ 帧 ${pt.frame}（点击编辑参数）`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditModifierParams(node.id, pt.frame, mod.id);
                  }}
                />
              );
            })}

            {/* Param keyframe markers (diamonds) */}
            {allParamKfs.map(({ frame, ptFrame, modId }, idx) => (
              <div
                key={`pkf-${ptFrame}-${modId}-${idx}`}
                className="absolute top-1/2 -translate-y-1/2 size-1.5 rotate-45 pointer-events-none"
                style={{
                  left: frame * fw + fw / 2 - 3,
                  backgroundColor: '#fff',
                  border: `1px solid ${color}`,
                }}
                title={`参数关键帧 @ 帧 ${frame}`}
              />
            ))}
          </div>
        );
      })}
    </>
  );
});

// ---- Node ParamDriver Sub-Track Lane ----
// 为修改器组轨内 modifier 的 paramDrivers 显示子轨道
export const NodeParamDriverSubTrackLane = React.memo(function NodeParamDriverSubTrackLane({
  node,
  characterId,
  totalFrames,
  frameWidth,
  onEditParamDriver,
}: {
  node: Node;
  characterId: string;
  totalFrames: number;
  frameWidth?: number;
  onEditParamDriver: (nodeId: string, frame: number, modifierId: string, driverId: string) => void;
}) {
  const toggleTrackParamDriver = useProjectStore((s) => s.toggleTrackParamDriver);
  const fw = frameWidth ?? 24;
  const width = totalFrames * fw;

  // 收集所有 param drivers（定位 = 节点 + 轨点帧 + modifier）
  const driverEntries = useMemo(() => {
    const entries: { frame: number; modId: string; modType: ModifierType; driver: import('@/lib/unified-types').ParamDriver }[] = [];
    for (const pt of node.tracks?.modifierKeys?.keyframes ?? []) {
      for (const mod of pt.value ?? []) {
        for (const driver of mod.paramDrivers ?? []) {
          entries.push({ frame: pt.frame, modId: mod.id, modType: mod.type, driver });
        }
      }
    }
    return entries;
  }, [node.tracks?.modifierKeys]);

  if (driverEntries.length === 0) return null;

  return (
    <>
      {driverEntries.map(({ frame, modId, modType, driver }) => {
        const def = MODIFIER_DEFINITIONS.find((d) => d.type === modType);
        const label = def?.label ?? modType;
        return (
          <div
            key={`driver-${frame}-${driver.id}`}
            className="relative border-b border-[#1a1a2e] flex items-center"
            style={{ height: SUB_TRACK_HEIGHT, width, minWidth: width, background: '#0a0a18' }}
          >
            <div className="absolute left-1 text-[9px] px-1 rounded pointer-events-none select-none"
              style={{ backgroundColor: '#a78bfa22', color: '#a78bfa', border: '1px solid #a78bfa44' }}>
              ⚡ {label}.{driver.targetParam}
            </div>
            <button
              className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300 hover:bg-purple-800"
              onClick={(e) => {
                e.stopPropagation();
                onEditParamDriver(node.id, frame, modId, driver.id);
              }}
            >
              编辑
            </button>
            <button
              className="absolute right-12 top-1/2 -translate-y-1/2 text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
              onClick={(e) => {
                e.stopPropagation();
                toggleTrackParamDriver(characterId, node.id, frame, modId, driver.id);
              }}
              title={driver.enabled ? '禁用' : '启用'}
            >
              {driver.enabled ? 'ON' : 'OFF'}
            </button>
          </div>
        );
      })}
    </>
  );
});
