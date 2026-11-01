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
  Crosshair,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import { resolveNodeSpriteId, geometryDirectionFromToggle } from '@/lib/unified-render';
import { generateGuidedTrajectory, type GuideAnchor } from '@/lib/motion-guide';
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

// ---------------------------------------------------------------------------
// 制导生成：选中节点 → 目标节点锚点（插头 / 精灵点标记）+ 转向参数 →
// 制导求解烘成节点轨迹。求解与烘焙在 lib/motion-guide（与手绘轨迹同一
// 条链）；写入走 pushUndo + updateUnifiedNode，一步撤销，同既有纪律。
// 非法态（未选节点/目标、参数非法、目标不可达）在下方红字明示，不静默。
// ---------------------------------------------------------------------------

function parseNumText(text: string): number | null {
  if (text.trim() === '') return null;
  const v = Number(text);
  return Number.isFinite(v) ? v : null;
}

const guideSelectClass = 'h-6 w-full text-[11px] bg-zinc-950 border border-zinc-800 rounded px-1 text-zinc-200';
const guideInputClass = 'h-6 text-[11px] bg-zinc-950 border-zinc-800';

function GuidedTrajectorySection() {
  const unifiedCharacters = useProjectStore((s) => s.unifiedCharacters) ?? {};
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const performNodeId = usePuppetSessionStore((s) => s.performNodeId);

  const [targetNodeId, setTargetNodeId] = useState('');
  const [anchorSel, setAnchorSel] = useState('plug');
  const [framesText, setFramesText] = useState('');
  const [turnText, setTurnText] = useState('15');
  const [dirText, setDirText] = useState('');
  const [twistText, setTwistText] = useState('0');
  const [cyclesText, setCyclesText] = useState('1');
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  // 被制导节点 = 当前选中木偶节点（与轨迹工具同口径：selectedNodeId ?? performNodeId）
  const guided = useMemo(() => {
    const nodeId = selectedNodeId ?? performNodeId;
    if (!nodeId) return null;
    for (const ch of Object.values(unifiedCharacters) as Array<any>) {
      const node = ch.nodes?.[nodeId];
      if (node) return { character: ch, node };
    }
    return null;
  }, [unifiedCharacters, selectedNodeId, performNodeId]);

  const targetOptions = useMemo(() => {
    if (!guided) return [] as Array<{ id: string; name: string }>;
    return (Object.values(guided.character.nodes ?? {}) as Array<any>)
      .filter((n) => n.id !== guided.node.id)
      .map((n) => ({ id: n.id as string, name: String(n.name ?? n.id) }));
  }, [guided]);

  const targetNode = guided && targetNodeId ? guided.character.nodes?.[targetNodeId] : undefined;

  // 目标节点当前精灵上的点标记（锚点选项）
  const markNames = useMemo(() => {
    if (!guided || !targetNode) return [] as string[];
    const state = useProjectStore.getState();
    const spriteId = resolveNodeSpriteId(
      guided.character as any, targetNode.id,
      (targetNode.transform?.variantIndex ?? 0) as any, state.sprites as any,
    );
    const sprite = spriteId
      ? ((state.sprites as any)?.[spriteId] ?? guided.character.sprites?.[spriteId])
      : undefined;
    return ((sprite?.marks ?? []) as Array<any>)
      .filter((m) => m.kind === 'point')
      .map((m) => String(m.name));
  }, [guided, targetNode]);

  const generate = () => {
    const fail = (text: string) => setMessage({ kind: 'error', text });
    if (!guided) return fail('先在画布或节点树中选中要制导的节点');
    if (!targetNodeId) return fail('请选择目标节点');
    if (targetNodeId === guided.node.id) return fail('目标不能是节点自身');
    const state = useProjectStore.getState();
    const totalFrames = framesText.trim() === '' ? state.totalFrames : parseNumText(framesText);
    if (totalFrames === null || !Number.isInteger(totalFrames) || totalFrames < 2) return fail('总帧数至少为 2');
    const maxTurn = parseNumText(turnText);
    if (maxTurn === null || maxTurn <= 0) return fail('转向率必须大于 0（度/帧）');
    const initialDir = dirText.trim() === '' ? undefined : parseNumText(dirText);
    if (dirText.trim() !== '' && initialDir === null) return fail('初速方向必须是数字（度）');
    const twistAmp = twistText.trim() === '' ? 0 : parseNumText(twistText);
    if (twistAmp === null || twistAmp < 0) return fail('扭转幅值不能为负（px）');
    const twistCycles = cyclesText.trim() === '' ? 1 : parseNumText(cyclesText);
    if (twistCycles === null || twistCycles < 0) return fail('扭转圈数不能为负');
    const anchor: GuideAnchor = anchorSel.startsWith('mark:')
      ? { kind: 'mark', name: anchorSel.slice('mark:'.length) }
      : { kind: 'plug' };
    const result = generateGuidedTrajectory({
      character: guided.character as any,
      nodeId: guided.node.id,
      targetNodeId,
      anchor,
      totalFrames,
      maxTurnDegPerFrame: maxTurn,
      initialDirDeg: initialDir ?? undefined,
      twistAmpPx: twistAmp,
      twistCycles,
      env: {
        frame: state.currentFrame,
        canvasWidth: state.canvasWidth,
        canvasHeight: state.canvasHeight,
        sprites: state.sprites as any,
        geometryDirection: geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D),
      },
    });
    if (!result.ok) return fail(result.error);
    state.pushUndo('制导生成轨迹');
    state.updateUnifiedNode(guided.character.id, guided.node.id, { trajectory: result.trajectory } as any);
    setMessage({
      kind: 'ok',
      text: `已生成 ${result.trajectory.length} 点轨迹，第 ${result.arrivalFrame} 帧到达目标`,
    });
  };

  return (
    <div className="rounded border border-zinc-800/60 bg-zinc-900/40 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Crosshair className="size-3.5 text-rose-400 shrink-0" />
        <span className="text-[11px] text-zinc-200">制导生成</span>
        <span className="text-[10px] text-zinc-500 truncate">
          {guided ? `${guided.character.name ?? guided.character.id} / ${guided.node.name ?? guided.node.id}` : '未选中节点'}
        </span>
      </div>
      <ParamRow label="目标" value="">
        <select
          className={guideSelectClass}
          value={targetNodeId}
          onChange={(e) => { setTargetNodeId(e.target.value); setAnchorSel('plug'); }}
        >
          <option value="">选择目标节点…</option>
          {targetOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </ParamRow>
      <ParamRow label="锚点" value={markNames.length === 0 && targetNode ? '无点标记' : ''}>
        <select className={guideSelectClass} value={anchorSel} onChange={(e) => setAnchorSel(e.target.value)}>
          <option value="plug">插头（节点枢轴）</option>
          {markNames.map((name) => (
            <option key={name} value={`mark:${name}`}>标记：{name}</option>
          ))}
        </select>
      </ParamRow>
      <ParamRow label="总帧数" value={framesText.trim() === '' ? '工程总帧' : ''}>
        <Input type="number" min={2} className={guideInputClass} value={framesText}
          placeholder="工程总帧数"
          onChange={(e) => setFramesText(e.target.value)} />
      </ParamRow>
      <ParamRow label="转向°/帧" value="">
        <Input type="number" min={0} step="any" className={guideInputClass} value={turnText}
          onChange={(e) => setTurnText(e.target.value)} />
      </ParamRow>
      <ParamRow label="初速方向°" value={dirText.trim() === '' ? '朝向目标' : ''}>
        <Input type="number" step="any" className={guideInputClass} value={dirText}
          placeholder="自动"
          onChange={(e) => setDirText(e.target.value)} />
      </ParamRow>
      <ParamRow label="扭转幅值" value="px">
        <Input type="number" min={0} step="any" className={guideInputClass} value={twistText}
          onChange={(e) => setTwistText(e.target.value)} />
      </ParamRow>
      <ParamRow label="扭转圈数" value="">
        <Input type="number" min={0} step="any" className={guideInputClass} value={cyclesText}
          onChange={(e) => setCyclesText(e.target.value)} />
      </ParamRow>
      <Button size="sm" className="w-full h-6 text-[11px]" onClick={generate}>
        生成制导轨迹
      </Button>
      {message && (
        <div className={`text-[10px] leading-snug ${message.kind === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>
          {message.text}
        </div>
      )}
      <div className="text-[10px] text-zinc-600 leading-snug">
        以当前帧位姿为起点，生成后即普通节点轨迹（可撤销、可烘焙为轨道）；已有轨迹会被替换。
      </div>
    </div>
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
          <GuidedTrajectorySection />
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
