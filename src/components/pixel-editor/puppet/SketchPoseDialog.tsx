'use client';

// 草图捕姿（甲案：直接复用主渲染内容）：底图 = 与主画布同一条
// renderUnified 渲染（精灵/关节盘/人偶兜底/距离雾全在）+ 主画布同款
// 骨架覆盖层 + IK 手柄，笔触画在最上层。过滤开关：只显示当前角色
// 或全部角色（同编辑器视图）。解算先出预览（不写数据）：确认才落
// 帧写入，重画丢弃预览重划。换算/解算/落帧在 lib/sketch-pose。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Eraser, PencilRuler, RotateCcw } from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import {
  computeWorldTransforms, geometryDirectionFromToggle, renderUnified,
} from '@/lib/unified-render';
import {
  renderIKTargetHandles, renderPuppetSkeletonOverlay,
} from '../canvas/canvas-puppet-render';
import { projectToView, subToPx, type Character } from '@/lib/unified-types';
import { assignSketchStrokes, bakeSketchPose, chainJointIds, type SketchBakeResult } from '@/lib/sketch-pose';
import type { Pt } from '@/lib/arc-length';

interface PreviewState {
  bake: SketchBakeResult;
  report: string;
}

export default function SketchPoseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const characterId = useEditorStore((s) => s.activePuppetSkeletonId);
  const character = useProjectStore((s) => (characterId ? s.unifiedCharacters[characterId] : undefined));
  const frame = useProjectStore((s) => s.currentFrame);
  const frameRate = useProjectStore((s) => s.frameRate) || 12;
  const canvasW = useProjectStore((s) => s.canvasWidth) || 512;
  const canvasH = useProjectStore((s) => s.canvasHeight) || 512;
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const [drawing, setDrawing] = useState<Pt[] | null>(null);
  const [note, setNote] = useState('');
  const [onlyCurrent, setOnlyCurrent] = useState(true);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (open) { setStrokes([]); setDrawing(null); setNote(''); setPreview(null); }
  }, [open, characterId]);

  /** 渲染用角色：预览态用落帧后的节点表替换当前角色 */
  const renderCharacter = useMemo<Character | undefined>(() => {
    if (!character) return undefined;
    if (!preview) return character as Character;
    return { ...(character as Character), nodes: preview.bake.nodes };
  }, [character, preview]);

  /** 吸附/归属用关节点位（工程画布坐标，与底图同口径） */
  const joints = useMemo(() => {
    if (!renderCharacter) return null;
    const wt = computeWorldTransforms(renderCharacter, frame, canvasW, canvasH, frameRate);
    const canvas = new Map<string, Pt>();
    const worldZ = new Map<string, number>();
    for (const [id, t] of wt) {
      const p = projectToView(t.worldX, t.worldY, t.worldZ, (t.variantIndex ?? 6) as never);
      canvas.set(id, { x: subToPx(p.canvasX) + canvasW / 2, y: subToPx(p.canvasY) + canvasH / 2 });
    }
    for (const chain of renderCharacter.ikChains ?? []) {
      const end = wt.get(chain.endNodeId);
      if (end) worldZ.set(chain.id, subToPx(end.worldZ));
    }
    return { canvas, worldZ };
  }, [renderCharacter, frame, frameRate, canvasW, canvasH]);

  /** 底图：主渲染内容 + 骨架覆盖层 + 链关节金圈（主画布同款调用） */
  const renderBase = useCallback(() => {
    const canvas = baseRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !renderCharacter || !characterId) return;
    const pst = useProjectStore.getState();
    const est = useEditorStore.getState();
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(0, 0, canvasW, canvasH);
    const charsForRender: Record<string, Character> = onlyCurrent
      ? { [characterId]: renderCharacter }
      : { ...pst.unifiedCharacters, [characterId]: renderCharacter };
    const off = document.createElement('canvas');
    off.width = canvasW;
    off.height = canvasH;
    const offCtx = off.getContext('2d')!;
    renderUnified(
      offCtx, canvasW, canvasH, Object.values(pst.sprites), [], frame, 'transparent',
      [], [], [], false, 0,
      pst.proceduralAnimations ?? [], pst.canvasModifierTracks ?? [], frameRate, 'high',
      pst.animationVariables ?? [], pst.globalModifiers ?? [],
      charsForRender, pst.animationClips, true, pst.globalBlueprint,
      pst.sprites, est.perspectiveForeshorten, pst.activeAnimationClipId,
      geometryDirectionFromToggle(est.nodeTurn3D),
      est.showMannequinFallback,
      {
        sleeveRatio: est.mannequinSleeveRatio,
        pantsRatio: est.mannequinPantsRatio,
        fogStrength: est.depthFogStrength,
        faceGuide: est.showFaceGuide,
      },
    );
    ctx.drawImage(off, 0, 0);
    const rc = { ctx, canvasWidth: canvasW, canvasHeight: canvasH, zoom: 1, panX: 0, panY: 0, currentFrame: frame };
    renderPuppetSkeletonOverlay(rc, {
      shouldRender: true,
      characters: [renderCharacter],
      activePuppetSkeletonId: characterId,
      selectedNodeId: null,
      animationClips: pst.animationClips,
      sprites: Object.values(pst.sprites),
    });
    renderIKTargetHandles(rc, renderCharacter);
    // 链根/链尾金圈：起笔吸附点提示
    if (joints) {
      for (const chain of renderCharacter.ikChains ?? []) {
        for (const id of chainJointIds(renderCharacter, chain)) {
          const p = joints.canvas.get(id);
          if (!p) continue;
          const isEnd = id === chain.rootNodeId || id === chain.endNodeId;
          ctx.beginPath();
          ctx.arc(p.x, p.y, isEnd ? 7 : 4, 0, Math.PI * 2);
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = isEnd ? 2 : 1.25;
          ctx.stroke();
        }
      }
    }
  }, [renderCharacter, characterId, onlyCurrent, joints, frame, frameRate, canvasW, canvasH]);

  // 底图绘制：打开后先等一帧（对话框挂载时序）再画，并短间隔补画
  // 两次兜底——主渲染里精灵位图等有首次备图时机，只画一次会赶上
  // 空窗（主画布靠循环重画掩盖了这一点，对话框一次性的不行）。
  // 依赖变化（切角色/切帧/开关/预览）同样走这条。
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => renderBase());
    const t1 = setTimeout(() => renderBase(), 120);
    const t2 = setTimeout(() => renderBase(), 450);
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
  }, [renderBase, open]);

  /** 笔触层 */
  const renderStrokes = useCallback(() => {
    const canvas = strokeRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvasW, canvasH);
    const drawStroke = (pts: Pt[], color: string) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.stroke();
      const end = pts[pts.length - 1]!;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };
    for (const s of strokes) drawStroke(s, '#7dd3fc');
    if (drawing) drawStroke(drawing, '#ffffff');
  }, [strokes, drawing, canvasW, canvasH]);

  useEffect(() => { if (open) renderStrokes(); }, [renderStrokes, open]);

  const pointFromEvent = (e: React.PointerEvent): Pt => {
    const rect = strokeRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvasW,
      y: ((e.clientY - rect.top) / rect.height) * canvasH,
    };
  };

  const chainCount = character?.ikChains?.length ?? 0;

  const handleSolve = () => {
    if (!character || !joints || strokes.length === 0 || preview) return;
    const { assignments, missed } = assignSketchStrokes(
      character as Character, strokes, joints.canvas, canvasW, canvasH, joints.worldZ,
    );
    if (assignments.length === 0) {
      setNote(`没有笔触命中 IK 链（${missed} 笔未命中）：起笔要落在金圈关节附近`);
      return;
    }
    const bake = bakeSketchPose(
      character as Character, assignments, frame, frameRate, canvasW, canvasH,
      useProjectStore.getState().sprites,
    );
    const errs = bake.appliedChainIds.map((id) => {
      const chain = (character.ikChains ?? []).find((c) => c.id === id);
      return `${chain?.name ?? id} 误差 ${(bake.endError[id] ?? 0).toFixed(1)}px`;
    });
    setPreview({
      bake,
      report: `已解算到第 ${frame} 帧（时间轴播放头当前所在帧）：${errs.join('；')}${missed > 0 ? `；另有 ${missed} 笔未命中` : ''}——尚未写入，确认后才落帧`,
    });
    setStrokes([]);
    setNote('');
  };

  const handleConfirm = () => {
    if (!character || !preview) return;
    // 链目标同步到解算后姿态的尖端位：链若启用着，渲染会按链目标
    // 再解算，不同步就会把刚落帧的姿势弹回旧目标
    const targets = preview.bake.chainTargets;
    const ikChains = Object.keys(targets).length > 0
      ? (character.ikChains ?? []).map((c) => {
          const t = targets[c.id];
          return t ? { ...c, target3D: t.target3D, target: t.target } : c;
        })
      : undefined;
    useProjectStore.getState().updateUnifiedCharacter(character.id, {
      nodes: preview.bake.nodes,
      ...(ikChains ? { ikChains } : {}),
    });
    setPreview(null);
    onClose();
  };

  const handleRedraw = () => {
    setPreview(null);
    setStrokes([]);
    setNote('');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[580px] bg-[#12122a] border-white/10 text-gray-200">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <PencilRuler className="size-4 text-amber-300" /> 草图捕姿{character ? ` · ${character.name}` : ''}
          </DialogTitle>
        </DialogHeader>
        {!character ? (
          <p className="text-[12px] text-gray-400">先在木偶面板选中一个角色。</p>
        ) : chainCount === 0 ? (
          <p className="text-[12px] text-gray-400">当前角色没有 IK 链，先在骨骼面板为手臂/腿建链再用草图捕姿。</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <p className="text-[11px] text-gray-400 flex-1">
                在金圈关节（链根或链尾）附近起笔，划向末端要去的位置，一笔一条链。
                解算先出预览，确认后才落成关键帧；写入帧 = 时间轴播放头当前所在的第 {frame} 帧。
              </p>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-300 shrink-0 cursor-pointer">
                <input type="checkbox" checked={onlyCurrent} onChange={(e) => setOnlyCurrent(e.target.checked)}
                  className="accent-cyan-400" />
                只显示当前角色
              </label>
            </div>
            <div className="relative w-full rounded border border-white/10 overflow-hidden"
              style={{ aspectRatio: `${canvasW}/${canvasH}` }}>
              <canvas ref={baseRef} width={canvasW} height={canvasH} className="absolute inset-0 w-full h-full" />
              <canvas ref={strokeRef} width={canvasW} height={canvasH}
                className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
                onPointerDown={(e) => {
                  if (preview) return;
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  setDrawing([pointFromEvent(e)]);
                }}
                onPointerMove={(e) => {
                  if (!drawing) return;
                  const p = pointFromEvent(e);
                  const last = drawing[drawing.length - 1]!;
                  if (Math.hypot(p.x - last.x, p.y - last.y) >= 3) setDrawing([...drawing, p]);
                }}
                onPointerUp={() => {
                  if (drawing && drawing.length >= 2) setStrokes((prev) => [...prev, drawing]);
                  setDrawing(null);
                }}
              />
              {preview && (
                <div className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-amber-200 text-[10px]">
                  预览（未写入）
                </div>
              )}
            </div>
            {preview ? (
              <div className="space-y-2">
                <p className="text-[11px] text-amber-200">{preview.report}</p>
                <div className="flex items-center gap-2">
                  <Button size="sm" className="h-7 text-[11px]" onClick={handleConfirm}>
                    <Check className="size-3 mr-1" /> 确认写入
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-[11px] text-gray-300" onClick={handleRedraw}>
                    <RotateCcw className="size-3 mr-1" /> 重画
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-[11px] text-gray-400" onClick={() => setStrokes([])}>
                  <Eraser className="size-3 mr-1" /> 清除笔触（{strokes.length}）
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-[11px] text-gray-400"
                  onClick={() => { renderBase(); renderStrokes(); }}>
                  <RotateCcw className="size-3 mr-1" /> 重新渲染
                </Button>
                <div className="flex-1" />
                <Button size="sm" className="h-7 text-[11px]" disabled={strokes.length === 0} onClick={handleSolve}>
                  解算预览
                </Button>
              </div>
            )}
            {note && <p className="text-[11px] text-emerald-300">{note}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
