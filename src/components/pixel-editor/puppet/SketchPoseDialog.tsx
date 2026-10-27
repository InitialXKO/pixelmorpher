'use client';

// 草图捕姿：对当前角色草划目标姿态（每笔自一条 IK 链的关节起笔、
// 笔尖落点 = 末端要去的位置），经既有 IK 口径解算后落成当前帧
// angle/tilt 关键帧。换算/解算/落帧全在 lib/sketch-pose。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Eraser, PencilRuler } from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import { computeWorldTransforms } from '@/lib/unified-render';
import { projectToView, subToPx, type Character } from '@/lib/unified-types';
import { assignSketchStrokes, bakeSketchPose, chainJointIds } from '@/lib/sketch-pose';
import type { Pt } from '@/lib/arc-length';

const W = 480;
const H = 480;

export default function SketchPoseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const characterId = useEditorStore((s) => s.activePuppetSkeletonId);
  const character = useProjectStore((s) => (characterId ? s.unifiedCharacters[characterId] : undefined));
  const frame = useProjectStore((s) => s.currentFrame);
  const frameRate = useProjectStore((s) => s.frameRate) || 12;
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const [drawing, setDrawing] = useState<Pt[] | null>(null);
  const [note, setNote] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { if (open) { setStrokes([]); setDrawing(null); setNote(''); } }, [open, characterId]);

  const joints = useMemo(() => {
    if (!character) return null;
    const wt = computeWorldTransforms(character as Character, frame, W, H, frameRate);
    const canvas = new Map<string, Pt>();
    const worldZ = new Map<string, number>();
    for (const [id, t] of wt) {
      const dir = t.variantIndex ?? 6;
      const p = projectToView(t.worldX, t.worldY, t.worldZ, dir as never);
      canvas.set(id, { x: subToPx(p.canvasX) + W / 2, y: subToPx(p.canvasY) + H / 2 });
    }
    for (const chain of character.ikChains ?? []) {
      const end = wt.get(chain.endNodeId);
      if (end) worldZ.set(chain.id, subToPx(end.worldZ));
    }
    return { canvas, worldZ };
  }, [character, frame, frameRate]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(0, 0, W, H);
    if (character && joints) {
      // 骨架连线（按父子）
      ctx.lineCap = 'round';
      for (const node of Object.values(character.nodes)) {
        if (!node.parentId) continue;
        const a = joints.canvas.get(node.parentId);
        const b = joints.canvas.get(node.id);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = 'rgba(148,184,255,0.5)';
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      // IK 链关节高亮（可捕姿的链）
      for (const chain of character.ikChains ?? []) {
        for (const id of chainJointIds(character as Character, chain)) {
          const p = joints.canvas.get(id);
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p.x, p.y, id === chain.rootNodeId || id === chain.endNodeId ? 6 : 4, 0, Math.PI * 2);
          ctx.fillStyle = '#fbbf24';
          ctx.fill();
        }
      }
    }
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
  }, [character, joints, strokes, drawing]);

  useEffect(() => { redraw(); }, [redraw, open]);

  const pointFromEvent = (e: React.PointerEvent): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  };

  const chainCount = character?.ikChains?.length ?? 0;

  const handleApply = () => {
    if (!character || !joints || strokes.length === 0) return;
    const { assignments, missed } = assignSketchStrokes(
      character as Character, strokes, joints.canvas, W, H, joints.worldZ,
    );
    if (assignments.length === 0) {
      setNote(`没有笔触命中 IK 链（${missed} 笔未命中）：起笔要落在金色关节点附近`);
      return;
    }
    const res = bakeSketchPose(character as Character, assignments, frame, frameRate, W, H);
    useProjectStore.getState().updateUnifiedCharacter(character.id, { nodes: res.nodes });
    const errs = res.appliedChainIds.map((id) => {
      const chain = (character.ikChains ?? []).find((c) => c.id === id);
      return `${chain?.name ?? id} 误差 ${(res.endError[id] ?? 0).toFixed(1)}px`;
    });
    setStrokes([]);
    setNote(`已在第 ${frame} 帧落姿：${errs.join('；')}${missed > 0 ? `；另有 ${missed} 笔未命中` : ''}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[540px] bg-[#12122a] border-white/10 text-gray-200">
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
            <p className="text-[11px] text-gray-400">
              在金色关节（链根或链尾）附近起笔，划向末端要去的位置，松手成一笔；一笔对应一条链。
              应用后解算结果落成第 {frame} 帧的关键帧（只写角度/出平面角两轨）。
            </p>
            <canvas ref={canvasRef} width={W} height={H}
              className="w-full rounded border border-white/10 touch-none cursor-crosshair"
              style={{ aspectRatio: '1/1' }}
              onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrawing([pointFromEvent(e)]); }}
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
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-[11px] text-gray-400" onClick={() => setStrokes([])}>
                <Eraser className="size-3 mr-1" /> 清除笔触（{strokes.length}）
              </Button>
              <div className="flex-1" />
              <Button size="sm" className="h-7 text-[11px]" disabled={strokes.length === 0} onClick={handleApply}>
                解算并落帧
              </Button>
            </div>
            {note && <p className="text-[11px] text-emerald-300">{note}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
