'use client';
// ============================================================
// 机甲生成向导：选族 → 整机预览（部位精灵按角色数据合成）→
// 生成真角色（节点树 + 服装集 + 全局精灵表，主画布可渲染/
// 操控、可进运行时包，与手工角色同路径）。
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useProjectStore } from '@/lib/store';
import { subToPx } from '@/lib/unified-types';
import { generateMechaPartSet, MECHA_FAMILIES } from '@/lib/mecha/parts';
import type { MechaFamily, MechaPartSet } from '@/lib/mecha/parts';
import { assembleMechaCharacter, createMechaCharacterInStore, MECHA_NODE_PARTS, MECHA_PART_KEYS } from '@/lib/mecha/build-character';
import type { MechaPartKey } from '@/lib/mecha/build-character';

const PW = 460, PH = 830; // 预览画布（角色本地合成空间）

export default function MechaWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [family, setFamily] = useState<MechaFamily>('olive');
  const [name, setName] = useState('机甲-01');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef(new Map<MechaFamily, MechaPartSet>());

  const partSetOf = useCallback((fam: MechaFamily): MechaPartSet => {
    let ps = cacheRef.current.get(fam);
    if (!ps) { ps = generateMechaPartSet(fam); cacheRef.current.set(fam, ps); }
    return ps;
  }, []);

  // 预览：只用将写入的角色数据（节点/插座）+ 部位精灵合成静止姿势
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, PW, PH);
    const ps = partSetOf(family);
    const dummy = Object.fromEntries(MECHA_PART_KEYS.map((k) => [k, ''])) as Record<MechaPartKey, string>;
    const A = assembleMechaCharacter({ characterId: 'preview', family, canvasSize: { w: PW, h: PH }, partSet: ps, spriteIds: dummy });
    const byId = new Map(Object.values(A.nodes).map((n) => [n.id, n]));
    const byKey = new Map(Object.values(A.nodes).map((n) => [n.id.replace('node_preview_', ''), n]));
    const world = new Map<string, { x: number; y: number }>();
    const root = byId.get(A.rootNodeId)!;
    world.set(root.id, { x: PW / 2, y: 330 });
    const place = (n: (typeof root)) => {
      const pw = world.get(n.parentId!)!;
      const parent = byId.get(n.parentId!)!;
      const sock = parent.sockets.find((s) => s.id === n.attachment.parentSocketId)!;
      world.set(n.id, { x: pw.x + subToPx(sock.offset3D!.x), y: pw.y + subToPx(sock.offset3D!.y) });
      for (const c of n.children) place(byId.get(c)!);
    };
    for (const c of root.children) place(byId.get(c)!);
    const ordered = [...byId.values()].sort((a, b) => a.zIndex - b.zIndex);
    for (const n of ordered) {
      const key = [...byKey.entries()].find(([, v]) => v === n)?.[0];
      const part = key ? MECHA_NODE_PARTS[key] : undefined;
      if (!part) continue;
      const s = ps[part];
      const off = document.createElement('canvas');
      off.width = s.width; off.height = s.height;
      off.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(s.rgba), s.width, s.height), 0, 0);
      const w0 = world.get(n.id)!;
      ctx.drawImage(off, Math.round(w0.x - s.plug.x), Math.round(w0.y - s.plug.y));
    }
  }, [family, partSetOf]);

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    const t = setTimeout(() => { redraw(); setBusy(false); }, 30);
    return () => clearTimeout(t);
  }, [open, redraw]);

  const handleCreate = () => {
    const store = useProjectStore.getState();
    const charName = name.trim() || '机甲';
    const { characterId } = createMechaCharacterInStore(store as never, { name: charName, family });
    void characterId;
    setNote(`已生成「${charName}」：8 个节点、5 张精灵、1 套服装，可直接在主画布摆姿势`);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[560px] max-h-[calc(100dvh-1.5rem)] overflow-y-auto bg-[#12122a] border-white/10 text-gray-200">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Bot className="size-4 text-cyan-300" /> 机甲生成
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-gray-400 shrink-0">角色名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="输入名称..."
              className="h-8 text-sm bg-[#0d0d1a] border-[#1e1e3a] text-gray-200" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {MECHA_FAMILIES.map((f) => (
              <button key={f.id} onClick={() => setFamily(f.id)}
                className={`px-2.5 py-1 rounded text-[11px] border transition-colors ${
                  family === f.id ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                    : 'border-white/10 text-gray-400 hover:border-white/25'}`}>
                {f.name}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400">
            按模式库生成全套部位（腿/上臂/前臂/躯干/头），装配成节点树 + 服装集的真角色；精灵为侧面东向，西向自动镜像。
          </p>
          <div className="relative mx-auto w-fit">
            <canvas ref={canvasRef} width={PW} height={PH}
              className="block rounded border border-white/10 bg-[#0a0a16]"
              style={{ height: 'min(430px, calc(100dvh - 330px))', width: 'auto', maxWidth: '100%', aspectRatio: `${PW}/${PH}` }} />
            {busy && <div className="absolute inset-0 flex items-center justify-center text-xs text-cyan-300">生成中…</div>}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1" />
            <Button size="sm" className="h-7 text-[11px]" disabled={busy || !name.trim()} onClick={handleCreate}>
              生成角色
            </Button>
          </div>
          {note && <p className="text-[11px] text-emerald-300">{note}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
