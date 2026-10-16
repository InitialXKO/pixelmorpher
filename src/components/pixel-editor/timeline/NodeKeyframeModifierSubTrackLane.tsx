'use client';

import React, { useMemo } from 'react';
import { useProjectStore } from '@/lib/store';
import type { Node, NodeKeyframe, ModifierType, ModifierInstance, ModifierParamKeyframe } from '@/lib/unified-types';
import { MODIFIER_DEFINITIONS } from '@/lib/types';
import { SUB_TRACK_HEIGHT, CATEGORY_COLOR_MAP } from './constants';

// ---- Node Keyframe Modifier Sub-Track Lane ----
// 为 Node 的 per-keyframe modifiers 显示子轨道
// 每个 modifier type 一行，显示拥有该 modifier 的关键帧及其 param keyframes
export const NodeKeyframeModifierSubTrackLane = React.memo(function NodeKeyframeModifierSubTrackLane({
  node,
  nodeKeyframes,
  totalFrames,
  frameWidth,
  onEditModifierParams,
}: {
  node: Node;
  nodeKeyframes: NodeKeyframe[];
  totalFrames: number;
  frameWidth?: number;
  onEditModifierParams: (keyframeId: string, modifierId: string) => void;
}) {
  const fw = frameWidth ?? 24;
  const width = totalFrames * fw;

  // 收集所有 modifier types
  const modifierTypes = useMemo(() => {
    const types = new Set<ModifierType>();
    for (const kf of nodeKeyframes) {
      for (const mod of kf.modifiers ?? []) {
        types.add(mod.type);
      }
    }
    return Array.from(types);
  }, [nodeKeyframes]);

  if (modifierTypes.length === 0) return null;

  return (
    <>
      {modifierTypes.map((modType) => {
        const def = MODIFIER_DEFINITIONS.find((d) => d.type === modType);
        const category = def?.category ?? 'transform';
        const color = CATEGORY_COLOR_MAP[category] ?? '#3b82f6';
        const label = def?.label ?? modType;

        // 拥有该 modifier 的关键帧
        const kfsWithMod = nodeKeyframes.filter((kf) =>
          (kf.modifiers ?? []).some((m) => m.type === modType)
        );

        // 收集所有 param keyframes
        const allParamKfs: { frame: number; kfId: string; modId: string; pkf: ModifierParamKeyframe }[] = [];
        for (const kf of kfsWithMod) {
          const mod = kf.modifiers!.find((m) => m.type === modType)!;
          for (const pkf of mod.paramKeyframes ?? []) {
            allParamKfs.push({ frame: pkf.frame, kfId: kf.id, modId: mod.id, pkf });
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
            {kfsWithMod.map((kf) => {
              const mod = kf.modifiers!.find((m) => m.type === modType)!;
              return (
                <button
                  key={`mod-kf-${kf.id}`}
                  className="absolute top-1/2 -translate-y-1/2 size-2.5 rotate-45 rounded-[2px] hover:scale-125 transition-transform"
                  style={{
                    left: kf.frame * fw + fw / 2 - 5,
                    backgroundColor: color,
                    opacity: mod.enabled ? 1 : 0.4,
                  }}
                  title={`${label} @ 帧 ${kf.frame}（点击编辑参数）`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditModifierParams(kf.id, mod.id);
                  }}
                />
              );
            })}

            {/* Param keyframe markers (diamonds) */}
            {allParamKfs.map(({ frame, kfId, modId, pkf }, idx) => (
              <div
                key={`pkf-${kfId}-${modId}-${idx}`}
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
// 为 Node modifier 的 paramDrivers 显示子轨道
export const NodeParamDriverSubTrackLane = React.memo(function NodeParamDriverSubTrackLane({
  node,
  nodeKeyframes,
  totalFrames,
  frameWidth,
  onEditParamDriver,
}: {
  node: Node;
  nodeKeyframes: NodeKeyframe[];
  totalFrames: number;
  frameWidth?: number;
  onEditParamDriver: (keyframeId: string, modifierId: string, driverId: string) => void;
}) {
  const { updateParamDriver, removeParamDriver, toggleParamDriver } = useProjectStore();
  const fw = frameWidth ?? 24;
  const width = totalFrames * fw;

  // 收集所有 param drivers
  const driverEntries = useMemo(() => {
    const entries: { kfId: string; modId: string; modType: ModifierType; driver: import('@/lib/unified-types').ParamDriver }[] = [];
    for (const kf of nodeKeyframes) {
      for (const mod of kf.modifiers ?? []) {
        for (const driver of mod.paramDrivers ?? []) {
          entries.push({ kfId: kf.id, modId: mod.id, modType: mod.type, driver });
        }
      }
    }
    return entries;
  }, [nodeKeyframes]);

  if (driverEntries.length === 0) return null;

  return (
    <>
      {driverEntries.map(({ kfId, modId, modType, driver }) => {
        const def = MODIFIER_DEFINITIONS.find((d) => d.type === modType);
        const label = def?.label ?? modType;
        return (
          <div
            key={`driver-${driver.id}`}
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
                onEditParamDriver(kfId, modId, driver.id);
              }}
            >
              编辑
            </button>
            <button
              className="absolute right-12 top-1/2 -translate-y-1/2 text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
              onClick={(e) => {
                e.stopPropagation();
                toggleParamDriver(kfId, modId, driver.id);
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
