'use client';

// 笔触建角向导：画一个火柴人 → 生成骨骼节点树。
// 一笔躯干（头侧起笔、腰侧收笔）+ 四笔四肢（自肩/髋起笔，可跳过，
// 跳过按比例直生）。换算口径全在 lib/stroke-build（附录 A 常数）。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eraser, PenLine, RotateCcw } from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import {
  buildSkeletonFromStrokes, strokeLimbJoints, strokeTorsoJoints, type Pt,
} from '@/lib/stroke-build';
import { polylineLength } from '@/lib/arc-length';

const W = 440;
const H = 500;

type StepKey = 'torso' | 'armL' | 'armR' | 'legL' | 'legR';
const STEPS: { key: StepKey; label: string; hint: string }[] = [
  { key: 'torso', label: '躯干', hint: '从头顶向下一笔画到腰（可弯曲）' },
  { key: 'armL', label: '左臂', hint: '从左肩（画面右侧亮点）起笔划出手臂走向，可跳过' },
  { key: 'armR', label: '右臂', hint: '从右肩（画面左侧亮点）起笔划出手臂走向，可跳过' },
  { key: 'legL', label: '左腿', hint: '从左髋（画面右侧亮点）起笔划出腿走向，可跳过' },
  { key: 'legR', label: '右腿', hint: '从右髋（画面左侧亮点）起笔划出腿走向，可跳过' },
];
const STROKE_COLORS: Record<StepKey, string> = {
  torso: '#7dd3fc', armL: '#f0abfc', armR: '#fda4af', legL: '#86efac', legR: '#fcd34d',
};

export default function StrokeBuildWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [stepIdx, setStepIdx] = useState(0);
  const [strokes, setStrokes] = useState<Partial<Record<StepKey, Pt[]>>>({});
  const [drawing, setDrawing] = useState<Pt[] | null>(null);
  const [note, setNote] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const step = STEPS[stepIdx]!;

  useEffect(() => {
    if (open) { setName(''); setStepIdx(0); setStrokes({}); setDrawing(null); setNote(''); }
  }, [open ]);

  const torsoJoints = useMemo(
    () => (strokes.torso && strokes.torso.length >= 2 ? strokeTorsoJoints(strokes.torso) : null),
    [strokes.torso],
  );

  // 预览：已推导的关节点（与建树同一套换算）
  const previewJoints = useMemo(() => {
    if (!torsoJoints || !strokes.torso) return null;
    const s = polylineLength(strokes.torso) / 3;
    const snap = 0.6 * s;
    const downOut = (sign: number): Pt => {
      const a = (55 * Math.PI) / 180;
      return { x: sign * Math.cos(a), y: Math.sin(a) };
    };
    const limb = (stroke: Pt[] | undefined, root: Pt, mr: number, er: number, dir: Pt, len: number) =>
      strokeLimbJoints(stroke, root, mr, er, dir, len, snap).pts;
    return {
      torso: torsoJoints,
      armL: limb(strokes.armL, torsoJoints.shoulderL!, 0.4, 0.84, downOut(1), 2.6 * s),
      armR: limb(strokes.armR, torsoJoints.shoulderR!, 0.4, 0.84, downOut(-1), 2.6 * s),
      legL: limb(strokes.legL, torsoJoints.hipL!, 0.4, 0.85, { x: 0.08, y: 1 }, 3.2 * s),
      legR: limb(strokes.legR, torsoJoints.hipR!, 0.4, 0.85, { x: -0.08, y: 1 }, 3.2 * s),
    };
  }, [torsoJoints, strokes]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
    ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
    ctx.stroke();
    const drawStroke = (pts: Pt[], color: string, width = 2) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    for (const k of Object.keys(strokes) as StepKey[]) {
      if (strokes[k]) drawStroke(strokes[k]!, STROKE_COLORS[k], k === step.key ? 3 : 2);
    }
    if (drawing) drawStroke(drawing, '#ffffff', 2);
    // 肩/髋热区亮点（躯干画完后）
    if (torsoJoints) {
      for (const [p, color] of [
        [torsoJoints.shoulderL, STROKE_COLORS.armL], [torsoJoints.shoulderR, STROKE_COLORS.armR],
        [torsoJoints.hipL, STROKE_COLORS.legL], [torsoJoints.hipR, STROKE_COLORS.legR],
      ] as [Pt, string][]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = color + '55';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // 预览骨架
    if (previewJoints) {
      const seg = (a: Pt, b: Pt) => {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = 'rgba(148,184,255,0.85)';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.stroke();
      };
      const tj = previewJoints;
      seg(tj.torso.neckBottom!, tj.torso.waist!);
      seg(tj.torso.neckTop!, tj.torso.neckBottom!);
      for (const key of ['armL', 'armR', 'legL', 'legR'] as const) {
        const pts = tj[key];
        for (let i = 1; i < pts.length; i++) seg(pts[i - 1]!, pts[i]!);
      }
      ctx.beginPath();
      ctx.arc(tj.torso.headCenter!.x, tj.torso.headCenter!.y, polylineLength(strokes.torso!) / 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(148,184,255,0.85)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }, [strokes, drawing, torsoJoints, previewJoints, step.key]);

  useEffect(() => { redraw(); }, [redraw, open]);

  const pointFromEvent = (e: React.PointerEvent): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  };

  const finishStroke = (pts: Pt[]) => {
    setDrawing(null);
    if (pts.length < 2 || polylineLength(pts) < 8) return;
    setStrokes((prev) => ({ ...prev, [step.key]: pts }));
    if (stepIdx < STEPS.length - 1) setStepIdx(stepIdx + 1);
  };

  const canCreate = !!strokes.torso && name.trim().length > 0;

  const handleCreate = () => {
    if (!strokes.torso) return;
    const store = useProjectStore.getState();
    const character = store.addUnifiedCharacter(name.trim(), { skipPlaceholderRoot: true });
    const built = buildSkeletonFromStrokes(
      { torso: strokes.torso, armL: strokes.armL, armR: strokes.armR, legL: strokes.legL, legR: strokes.legR },
      {
        characterId: character.id, center: { x: W / 2, y: H / 2 },
        canvasSize: { w: store.canvasWidth, h: store.canvasHeight },
      },
    );
    store.updateUnifiedCharacter(character.id, {
      nodes: built.nodes, rootNodeId: built.rootNodeId, ikChains: built.ikChains,
    });
    const snapped = Object.entries(built.snapped).filter(([, v]) => v).length;
    setNote(`已创建：15 个节点，${snapped} 条肢体起笔吸附成功`);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[520px] bg-[#12122a] border-white/10 text-gray-200">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <PenLine className="size-4 text-cyan-300" /> 画火柴人建角
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-gray-400 shrink-0">角色名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="输入角色名称..."
              className="h-8 text-sm bg-[#0d0d1a] border-[#1e1e3a] text-gray-200" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {STEPS.map((s, i) => (
              <button key={s.key} onClick={() => { if (i === 0 || strokes.torso) setStepIdx(i); }}
                className={`px-2 py-1 rounded text-[11px] border transition-colors ${
                  i === stepIdx ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                    : strokes[s.key] ? 'bg-white/5 border-white/15 text-gray-300'
                      : 'border-white/5 text-gray-500'}`}>
                {i + 1}. {s.label}{strokes[s.key] ? ' ✓' : ''}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400">{step.hint}。跳过的肢体按标准比例自动生成。</p>
          <canvas ref={canvasRef} width={W} height={H}
            className="w-full rounded border border-white/10 touch-none cursor-crosshair"
            style={{ aspectRatio: `${W}/${H}` }}
            onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrawing([pointFromEvent(e)]); }}
            onPointerMove={(e) => {
              if (!drawing) return;
              const p = pointFromEvent(e);
              const last = drawing[drawing.length - 1]!;
              if (Math.hypot(p.x - last.x, p.y - last.y) >= 3) setDrawing([...drawing, p]);
            }}
            onPointerUp={() => { if (drawing) finishStroke(drawing); }}
          />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-[11px] text-gray-400"
              onClick={() => setStrokes((prev) => { const n = { ...prev }; delete n[step.key]; return n; })}>
              <Eraser className="size-3 mr-1" /> 清除本笔
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-[11px] text-gray-400"
              onClick={() => { setStrokes({}); setStepIdx(0); }}>
              <RotateCcw className="size-3 mr-1" /> 全部重画
            </Button>
            {stepIdx < STEPS.length - 1 && step.key !== 'torso' && (
              <Button variant="ghost" size="sm" className="h-7 text-[11px] text-gray-400" onClick={() => setStepIdx(stepIdx + 1)}>
                跳过本肢
              </Button>
            )}
            <div className="flex-1" />
            <Button size="sm" className="h-7 text-[11px]" disabled={!canCreate} onClick={handleCreate}>
              生成角色
            </Button>
          </div>
          {note && <p className="text-[11px] text-emerald-300">{note}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
