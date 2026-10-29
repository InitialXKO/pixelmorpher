'use client';

import React, { useMemo, useState } from 'react';
import {
  Wind,
  Sparkles,
  CircleDot,
  Waves,
  Ghost,
  Trash2,
  ChevronDown,
  ChevronRight,
  Route,
  Play,
  ArrowRightToLine,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type { MotionBlurStroke, EffectStroke } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

// ============================================================
// StrokePanel — 笔触与轨迹管理面板
// 列出所有手绘笔触（motionBlurStrokes / effectStrokes）与节点轨迹，
// 支持删除、改参数、点击跳转帧。
// ============================================================

const STROKE_ICONS: Record<string, React.ReactNode> = {
  motion_blur: <Wind className="size-3.5 text-sky-400" />,
  glow_brush: <Sparkles className="size-3.5 text-amber-300" />,
  particle_brush: <CircleDot className="size-3.5 text-emerald-300" />,
  afterimage_brush: <Ghost className="size-3.5 text-purple-300" />,
};

const STROKE_LABELS: Record<string, string> = {
  motion_blur: '动态模糊',
  glow_brush: '辉光',
  particle_brush: '粒子',
  afterimage_brush: '残影',
};

type UnifiedStroke =
  | { kind: 'motion_blur'; stroke: MotionBlurStroke }
  | { kind: 'effect'; stroke: EffectStroke };

function strokeTypeKey(u: UnifiedStroke): string {
  return u.kind === 'motion_blur' ? 'motion_blur' : u.stroke.type;
}

function StrokeRow({ u }: { u: UnifiedStroke }) {
  const s = u.stroke as any;
  const [expanded, setExpanded] = useState(false);
  const removeMotionBlurStroke = useProjectStore((x) => x.removeMotionBlurStroke);
  const removeEffectStroke = useProjectStore((x) => x.removeEffectStroke);
  const updateMotionBlurStroke = useProjectStore((x) => x.updateMotionBlurStroke);
  const updateEffectStroke = useProjectStore((x) => x.updateEffectStroke);
  const setCurrentFrame = useProjectStore((x) => x.setCurrentFrame);

  const key = strokeTypeKey(u);
  const pointCount = Array.isArray(s.points) ? s.points.length : 0;

  const remove = () => {
    if (u.kind === 'motion_blur') removeMotionBlurStroke(s.id);
    else removeEffectStroke(s.id);
  };
  const patch = (p: Record<string, unknown>) => {
    if (u.kind === 'motion_blur') updateMotionBlurStroke(s.id, p as any);
    else updateEffectStroke(s.id, p as any);
  };

  return (
    <div className="rounded border border-zinc-800/60 bg-zinc-900/40 overflow-hidden">
      <ContextMenu>
        <ContextMenuTrigger asChild>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-zinc-800/40"
        onClick={() => setCurrentFrame(s.frame)}
        title="点击跳转到该帧"
      >
        <button
          className="shrink-0 text-zinc-500 hover:text-zinc-300"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        {STROKE_ICONS[key] ?? <Waves className="size-3.5 text-zinc-400" />}
        <span className="text-[11px] text-zinc-200 truncate flex-1">
          {STROKE_LABELS[key] ?? key} · frame {s.frame} · {pointCount} 点
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="shrink-0 text-zinc-600 hover:text-red-400 p-0.5"
              onClick={(e) => { e.stopPropagation(); remove(); }}
            >
              <Trash2 className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-[10px]">删除笔触</TooltipContent>
        </Tooltip>
      </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-36">
          <ContextMenuItem onSelect={() => setCurrentFrame(s.frame)}>
            跳转到该帧
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setExpanded(!expanded)}>
            {expanded ? '收起参数' : '展开参数'}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-red-400 focus:text-red-300"
            onSelect={remove}
          >
            删除笔触
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {expanded && (
        <div className="px-2 pb-2 pt-1 space-y-1.5 border-t border-zinc-800/60">
          <ParamRow label="起始帧" value={s.frame}>
            <Input
              type="number"
              value={s.frame}
              onChange={(e) => patch({ frame: Number(e.target.value) })}
              className="h-6 text-[11px] bg-zinc-950 border-zinc-800"
            />
          </ParamRow>
          <ParamRow label="强度" value={Number(s.intensity ?? 1).toFixed(2)}>
            <Slider
              value={[Number(s.intensity ?? 1)]}
              min={0} max={3} step={0.05}
              onValueChange={([v]) => patch({ intensity: v })}
              className="flex-1"
            />
          </ParamRow>
          {u.kind === 'motion_blur' ? (
            <>
              <ParamRow label="方向°" value={String(s.direction ?? 180)}>
                <Slider
                  value={[Number(s.direction ?? 180)]}
                  min={0} max={360} step={1}
                  onValueChange={([v]) => patch({ direction: v })}
                  className="flex-1"
                />
              </ParamRow>
              <ParamRow label="类型" value={String(s.brushType ?? '')}>
                <Input
                  value={String(s.brushType ?? '')}
                  onChange={(e) => patch({ brushType: e.target.value })}
                  className="h-6 text-[11px] bg-zinc-950 border-zinc-800"
                />
              </ParamRow>
            </>
          ) : (
            <>
              <ParamRow label="颜色" value={String(s.color ?? '')}>
                <input
                  type="color"
                  value={String(s.color ?? '#ffffff')}
                  onChange={(e) => patch({ color: e.target.value })}
                  className="h-6 w-10 bg-zinc-950 border border-zinc-800 rounded cursor-pointer"
                />
              </ParamRow>
              <ParamRow label="半径" value={String(s.radius ?? 8)}>
                <Slider
                  value={[Number(s.radius ?? 8)]}
                  min={1} max={64} step={1}
                  onValueChange={([v]) => patch({ radius: v })}
                  className="flex-1"
                />
              </ParamRow>
              {(key === 'particle_brush' || key === 'afterimage_brush') && (
                <>
                  <ParamRow label="密度" value={String(s.density ?? 1)}>
                    <Slider
                      value={[Number(s.density ?? 1)]}
                      min={0.1} max={5} step={0.1}
                      onValueChange={([v]) => patch({ density: v })}
                      className="flex-1"
                    />
                  </ParamRow>
                  <ParamRow label="扩散" value={String(s.spread ?? 0)}>
                    <Slider
                      value={[Number(s.spread ?? 0)]}
                      min={0} max={100} step={1}
                      onValueChange={([v]) => patch({ spread: v })}
                      className="flex-1"
                    />
                  </ParamRow>
                </>
              )}
            </>
          )}
          <ParamRow label="混合" value={String(s.blendMode ?? 'lighter')}>
            <Input
              value={String(s.blendMode ?? 'lighter')}
              onChange={(e) => patch({ blendMode: e.target.value })}
              className="h-6 text-[11px] bg-zinc-950 border-zinc-800"
            />
          </ParamRow>
        </div>
      )}
    </div>
  );
}

function ParamRow({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-zinc-500 w-12 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
      <span className="text-[10px] text-zinc-400 w-10 text-right shrink-0 tabular-nums truncate">{value}</span>
    </div>
  );
}

function TrajectoryRow({ characterId, characterName, nodeId, nodeName, trajectory }: {
  characterId: string;
  characterName: string;
  nodeId: string;
  nodeName: string;
  trajectory: Array<{ frame: number; x: number; y: number }>;
}) {
  const updateUnifiedNode = useProjectStore((s) => s.updateUnifiedNode);
  const setCurrentFrame = useProjectStore((s) => s.setCurrentFrame);
  const pushUndo = useProjectStore((s) => s.pushUndo);
  const node = useProjectStore((s) => s.unifiedCharacters[characterId]?.nodes?.[nodeId]);
  const frames = trajectory.map((p) => p.frame);
  const minF = Math.min(...frames);
  const maxF = Math.max(...frames);
  // 烘焙为轨道：轨迹点与 tracks.x/y 同空间（父级局部子像素偏移），逐点采样
  // 成 x/y 两条线性轨道（同帧取最后一点），替换既有 x/y 轨道、保留其余轨道，
  // 同一步里清掉轨迹（轨迹原本就盖过轨道，烘焙 = 把胜出层落成轨道）。
  const bakeToTracks = () => {
    const byFrame = new Map<number, { frame: number; x: number; y: number }>();
    for (const p of trajectory) byFrame.set(p.frame, p);
    const uniq = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
    if (uniq.length < 2) return;
    pushUndo('轨迹烘焙为轨道');
    updateUnifiedNode(characterId, nodeId, {
      tracks: {
        ...(node?.tracks ?? {}),
        x: { interpolation: 'linear', keyframes: uniq.map((p) => ({ frame: p.frame, value: p.x })) },
        y: { interpolation: 'linear', keyframes: uniq.map((p) => ({ frame: p.frame, value: p.y })) },
      },
      trajectory: [],
    } as any);
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-zinc-800/60 bg-zinc-900/40 hover:bg-zinc-800/40">
      <Route className="size-3.5 text-cyan-400 shrink-0" />
      <button
        className="flex-1 min-w-0 text-left"
        onClick={() => setCurrentFrame(minF)}
        title="点击跳转到起始帧"
      >
        <div className="text-[11px] text-zinc-200 truncate">{characterName} / {nodeName}</div>
        <div className="text-[10px] text-zinc-500 tabular-nums">
          {trajectory.length} 点 · frame {minF}–{maxF}
        </div>
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="shrink-0 text-zinc-600 hover:text-cyan-300 p-0.5"
            onClick={bakeToTracks}
          >
            <ArrowRightToLine className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-[10px]">烘焙为轨道（写入 x/y 轨道并清除轨迹）</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="shrink-0 text-zinc-600 hover:text-red-400 p-0.5"
            onClick={() => updateUnifiedNode(characterId, nodeId, { trajectory: [] } as any)}
          >
            <Trash2 className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-[10px]">删除轨迹</TooltipContent>
      </Tooltip>
    </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-36">
        <ContextMenuItem onSelect={() => setCurrentFrame(minF)}>
          跳转到起始帧
        </ContextMenuItem>
        <ContextMenuItem onSelect={bakeToTracks}>
          烘焙为轨道
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-red-400 focus:text-red-300"
          onSelect={() => updateUnifiedNode(characterId, nodeId, { trajectory: [] } as any)}
        >
          删除轨迹
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function StrokePanel() {
  const motionBlurStrokes = useProjectStore((s) => s.motionBlurStrokes) ?? [];
  const effectStrokes = useProjectStore((s) => s.effectStrokes) ?? [];
  const unifiedCharacters = useProjectStore((s) => s.unifiedCharacters) ?? {};

  const strokes: UnifiedStroke[] = useMemo(() => {
    const list: UnifiedStroke[] = [
      ...motionBlurStrokes.map((s) => ({ kind: 'motion_blur' as const, stroke: s })),
      ...effectStrokes.map((s) => ({ kind: 'effect' as const, stroke: s })),
    ];
    return list.sort((a, b) => (a.stroke as any).frame - (b.stroke as any).frame);
  }, [motionBlurStrokes, effectStrokes]);

  const trajectories = useMemo(() => {
    const out: Array<{
      characterId: string; characterName: string;
      nodeId: string; nodeName: string;
      trajectory: Array<{ frame: number; x: number; y: number }>;
    }> = [];
    for (const ch of Object.values(unifiedCharacters) as Array<any>) {
      for (const node of Object.values(ch.nodes ?? {}) as Array<any>) {
        const traj = node.trajectory;
        if (Array.isArray(traj) && traj.length >= 2) {
          out.push({
            characterId: ch.id,
            characterName: ch.name ?? ch.id,
            nodeId: node.id,
            nodeName: node.name ?? node.id,
            trajectory: traj,
          });
        }
      }
    }
    return out;
  }, [unifiedCharacters]);

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <div className="px-2.5 py-2 border-b border-zinc-800/60 shrink-0">
        <div className="text-[11px] font-medium text-zinc-200">笔触与轨迹</div>
        <div className="text-[10px] text-zinc-500">
          {strokes.length} 笔触 · {trajectories.length} 轨迹（点击跳转帧）
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {strokes.length === 0 && trajectories.length === 0 && (
            <div className="text-[11px] text-zinc-600 text-center py-6">
              暂无笔触或轨迹<br />用特效笔 / 轨迹工具在画布上绘制
            </div>
          )}
          {strokes.map((u) => (
            <StrokeRow key={(u.stroke as any).id} u={u} />
          ))}
          {strokes.length > 0 && trajectories.length > 0 && (
            <Separator className="bg-zinc-800/60 my-2" />
          )}
          {trajectories.map((t) => (
            <TrajectoryRow key={`${t.characterId}:${t.nodeId}`} {...t} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
