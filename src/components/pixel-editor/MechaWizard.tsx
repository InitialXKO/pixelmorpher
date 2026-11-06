'use client';
// ============================================================
// 机甲生成向导：人形（选族/胸型/底盘/装备）或载具（车体/机动/
// 炮塔）→ 整机预览（按将写入的角色数据合成，含节点角）→
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
import type { Node } from '@/lib/unified-types';
import {
  generateMechaPartSet, generateMechaWheelLeg, generateMechaTrackUnit,
  generateMechaJetpack, generateMechaWeapon, generateMechaHullBody, generateMechaTurret,
  MECHA_FAMILIES, MECHA_CHEST_LABELS,
} from '@/lib/mecha/parts';
import type { MechaFamily, MechaPartSet, MechaSpriteData, MechaChestVariant } from '@/lib/mecha/parts';
import {
  assembleMechaCharacter, assembleMechaVehicle, createMechaCharacterInStore, createMechaVehicleInStore,
  generateMechaMobilitySprite, mechaHumanoidNodeParts, mechaVehicleNodeParts,
  MECHA_CHASSIS_LABELS, MECHA_VEHICLE_LABELS,
} from '@/lib/mecha/build-character';
import type { MechaBuildOptions, MechaVehicleOptions } from '@/lib/mecha/build-character';

type Mode = 'humanoid' | 'vehicle';
type Chassis = NonNullable<MechaBuildOptions['chassis']>;
type WeaponSel = 'none' | 'cannon' | 'rifle';

const HUM_W = 460, HUM_H = 830;
const VEH_W = 780, VEH_H = 560;

function Chip(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={props.onClick}
      className={`px-2.5 py-1 rounded text-[11px] border transition-colors ${
        props.active ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
          : 'border-white/10 text-gray-400 hover:border-white/25'}`}>
      {props.children}
    </button>
  );
}

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Label className="text-xs text-gray-400 w-14 shrink-0">{props.label}</Label>
      {props.children}
    </div>
  );
}

export default function MechaWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('humanoid');
  const [family, setFamily] = useState<MechaFamily>('olive');
  const [chest, setChest] = useState<MechaChestVariant | 'default'>('default');
  const [chassis, setChassis] = useState<Chassis>('biped');
  const [jetpack, setJetpack] = useState(false);
  const [pod, setPod] = useState(false);
  const [weapon, setWeapon] = useState<WeaponSel>('none');
  const [hull, setHull] = useState<MechaVehicleOptions['hull']>('walker');
  const [mobility, setMobility] = useState<MechaVehicleOptions['mobility']>('legs');
  const [turret, setTurret] = useState(true);
  const [name, setName] = useState('机甲-01');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const partSetCache = useRef(new Map<string, MechaPartSet>());
  const spriteCache = useRef(new Map<string, MechaSpriteData>());

  const buildOpts = useCallback((): MechaBuildOptions => ({
    chest: chest === 'default' ? undefined : chest,
    chassis,
    jetpack,
    shoulderPod: pod,
    weapon: weapon === 'none' ? null : weapon,
  }), [chest, chassis, jetpack, pod, weapon]);

  const vehicleOpts = useCallback((): MechaVehicleOptions => ({ hull, mobility, turret }), [hull, mobility, turret]);

  const gearSprite = useCallback((fam: MechaFamily, part: string): MechaSpriteData => {
    const key = fam + ':' + part;
    let s = spriteCache.current.get(key);
    if (s) return s;
    if (part === 'wheelLeg') s = generateMechaWheelLeg(fam);
    else if (part === 'trackUnit') s = generateMechaTrackUnit(fam);
    else if (part === 'jetpack') s = generateMechaJetpack(fam);
    else if (part === 'pod') s = generateMechaWeapon(fam, 'pod');
    else if (part === 'cannon') s = generateMechaWeapon(fam, 'cannon');
    else if (part === 'rifle') s = generateMechaWeapon(fam, 'rifle');
    else throw new Error('unknown gear part ' + part);
    spriteCache.current.set(key, s);
    return s;
  }, []);

  // 预览：只用将写入的角色数据（节点/插座/节点角）+ 部位精灵合成静止姿势
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const PW = mode === 'humanoid' ? HUM_W : VEH_W;
    const PH = mode === 'humanoid' ? HUM_H : VEH_H;
    if (canvas.width !== PW) canvas.width = PW;
    if (canvas.height !== PH) canvas.height = PH;
    ctx.clearRect(0, 0, PW, PH);

    let assembly: ReturnType<typeof assembleMechaCharacter>;
    let nodeParts: Record<string, string>;
    let spriteFor: (part: string) => MechaSpriteData | undefined;
    if (mode === 'humanoid') {
      const B = buildOpts();
      const psKey = family + ':' + (B.chest ?? 'default');
      let ps = partSetCache.current.get(psKey);
      if (!ps) { ps = generateMechaPartSet(family, B.chest); partSetCache.current.set(psKey, ps); }
      assembly = assembleMechaCharacter({
        characterId: 'preview', family, canvasSize: { w: PW, h: PH },
        partSet: ps, spriteIds: {}, build: B,
      });
      nodeParts = mechaHumanoidNodeParts(B);
      spriteFor = (part) => {
        if (part === 'leg') return ps.leg;
        if (part === 'armUpper') return ps.armUpper;
        if (part === 'armFore') return ps.armFore;
        if (part === 'torso') return ps.torso;
        if (part === 'head') return ps.head;
        return gearSprite(family, part);
      };
    } else {
      const V = vehicleOpts();
      assembly = assembleMechaVehicle({
        characterId: 'preview', canvasSize: { w: PW, h: PH }, vehicle: V, spriteIds: {},
      });
      nodeParts = mechaVehicleNodeParts(V);
      const mobKey = 'veh:' + V.hull + ':' + V.mobility;
      const hullKey = 'veh:' + V.hull + ':body';
      const turKey = 'veh:' + V.hull + ':turret';
      spriteFor = (part) => {
        if (part === 'multiLeg' || part === 'trackUnit' || part === 'leg') {
          let s = spriteCache.current.get(mobKey);
          if (!s) { s = generateMechaMobilitySprite(V.hull, V.mobility); spriteCache.current.set(mobKey, s); }
          return s;
        }
        if (part === 'hullBody') {
          let s = spriteCache.current.get(hullKey);
          if (!s) { s = generateMechaHullBody(V.hull); spriteCache.current.set(hullKey, s); }
          return s;
        }
        if (part === 'turret') {
          let s = spriteCache.current.get(turKey);
          if (!s) { s = generateMechaTurret(V.hull); spriteCache.current.set(turKey, s); }
          return s;
        }
        return undefined;
      };
    }

    const byId = new Map(Object.values(assembly.nodes).map((n) => [n.id, n]));
    const byKey = new Map(Object.values(assembly.nodes).map((n) => [n.id.replace('node_preview_', ''), n]));
    const world = new Map<string, { x: number; y: number; a: number }>();
    const root = byId.get(assembly.rootNodeId)!;
    world.set(root.id, { x: subToPx(root.transform.x), y: subToPx(root.transform.y), a: root.transform.angle ?? 0 });
    const place = (n: Node) => {
      const pw = world.get(n.parentId!)!;
      const parent = byId.get(n.parentId!)!;
      const sock = parent.sockets.find((s) => s.id === n.attachment.parentSocketId)!;
      const ox = subToPx(sock.offset3D!.x), oy = subToPx(sock.offset3D!.y);
      const rad = pw.a * Math.PI / 180;
      world.set(n.id, {
        x: pw.x + ox * Math.cos(rad) - oy * Math.sin(rad),
        y: pw.y + ox * Math.sin(rad) + oy * Math.cos(rad),
        a: pw.a + (n.transform.angle ?? 0),
      });
      for (const c of n.children) place(byId.get(c)!);
    };
    for (const c of root.children) place(byId.get(c)!);

    const ordered = [...byId.values()].sort((a, b) => a.zIndex - b.zIndex);
    for (const n of ordered) {
      const key = [...byKey.entries()].find(([, v]) => v === n)?.[0];
      const part = key ? nodeParts[key] : undefined;
      if (!part) continue;
      const s = spriteFor(part);
      if (!s) continue;
      const off = document.createElement('canvas');
      off.width = s.width; off.height = s.height;
      off.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(s.rgba), s.width, s.height), 0, 0);
      const w0 = world.get(n.id)!;
      ctx.save();
      ctx.translate(Math.round(w0.x), Math.round(w0.y));
      if (w0.a) ctx.rotate(w0.a * Math.PI / 180);
      ctx.drawImage(off, -Math.round(s.plug.x), -Math.round(s.plug.y));
      ctx.restore();
    }
  }, [mode, family, buildOpts, vehicleOpts, gearSprite]);

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    const t = setTimeout(() => { redraw(); setBusy(false); }, 30);
    return () => clearTimeout(t);
  }, [open, redraw]);

  const handleCreate = () => {
    const store = useProjectStore.getState();
    const charName = name.trim() || '机甲';
    const { characterId } = mode === 'humanoid'
      ? createMechaCharacterInStore(store as never, { name: charName, family, build: buildOpts() })
      : createMechaVehicleInStore(store as never, { name: charName, vehicle: vehicleOpts() });
    const created = useProjectStore.getState().unifiedCharacters[characterId];
    const nNodes = created ? Object.keys(created.nodes).length : 0;
    setNote(`已生成「${charName}」：${nNodes} 个节点、1 套服装，可直接在主画布摆姿势/换装`);
    onClose();
  };

  const PW = mode === 'humanoid' ? HUM_W : VEH_W;
  const PH = mode === 'humanoid' ? HUM_H : VEH_H;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={`max-h-[calc(100dvh-1.5rem)] overflow-y-auto bg-[#12122a] border-white/10 text-gray-200 ${mode === 'vehicle' ? 'max-w-[860px]' : 'max-w-[560px]'}`}>
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
          <Row label="类型">
            <Chip active={mode === 'humanoid'} onClick={() => setMode('humanoid')}>人形机甲</Chip>
            <Chip active={mode === 'vehicle'} onClick={() => setMode('vehicle')}>载具</Chip>
          </Row>
          {mode === 'humanoid' ? (
            <>
              <Row label="族">
                {MECHA_FAMILIES.map((f) => (
                  <Chip key={f.id} active={family === f.id} onClick={() => setFamily(f.id)}>{f.name}</Chip>
                ))}
              </Row>
              <Row label="胸型">
                <Chip active={chest === 'default'} onClick={() => setChest('default')}>族默认</Chip>
                {(Object.keys(MECHA_CHEST_LABELS) as MechaChestVariant[]).map((c) => (
                  <Chip key={c} active={chest === c} onClick={() => setChest(c)}>{MECHA_CHEST_LABELS[c]}</Chip>
                ))}
              </Row>
              <Row label="底盘">
                {(Object.keys(MECHA_CHASSIS_LABELS) as Chassis[]).map((c) => (
                  <Chip key={c} active={chassis === c} onClick={() => setChassis(c)}>{MECHA_CHASSIS_LABELS[c]}</Chip>
                ))}
              </Row>
              <Row label="装备">
                <Chip active={jetpack} onClick={() => setJetpack(!jetpack)}>喷射背包</Chip>
                <Chip active={pod} onClick={() => setPod(!pod)}>导弹荚（背挂）</Chip>
                <Chip active={weapon === 'cannon'} onClick={() => setWeapon(weapon === 'cannon' ? 'none' : 'cannon')}>臂炮</Chip>
                <Chip active={weapon === 'rifle'} onClick={() => setWeapon(weapon === 'rifle' ? 'none' : 'rifle')}>步枪</Chip>
              </Row>
              <p className="text-[11px] text-gray-400">
                按模式库生成全套部位并装配成真角色；底盘与装备都是独立节点，可在主画布单独摆动/换装。精灵为侧面东向，西向自动镜像。
              </p>
            </>
          ) : (
            <>
              <Row label="车体">
                {(Object.keys(MECHA_VEHICLE_LABELS.hull) as MechaVehicleOptions['hull'][]).map((h) => (
                  <Chip key={h} active={hull === h} onClick={() => setHull(h)}>{MECHA_VEHICLE_LABELS.hull[h]}</Chip>
                ))}
              </Row>
              <Row label="机动">
                {(Object.keys(MECHA_VEHICLE_LABELS.mobility) as MechaVehicleOptions['mobility'][]).map((m) => (
                  <Chip key={m} active={mobility === m} onClick={() => setMobility(m)}>{MECHA_VEHICLE_LABELS.mobility[m]}</Chip>
                ))}
              </Row>
              <Row label="上装">
                <Chip active={turret} onClick={() => setTurret(!turret)}>{hull === 'walker' ? '炮塔' : '顶架'}</Chip>
              </Row>
              <p className="text-[11px] text-gray-400">
                车体为根节点，移动件（腿/履带/多足）与炮塔都是独立节点，可单独摆动；蜘蛛腿的扇角是初始姿态，随便改。
              </p>
            </>
          )}
          <div className="relative mx-auto w-fit">
            <canvas ref={canvasRef} width={PW} height={PH}
              className="block rounded border border-white/10 bg-[#0a0a16]"
              style={{ height: mode === 'humanoid' ? 'min(430px, calc(100dvh - 400px))' : 'min(400px, calc(100dvh - 400px))', width: 'auto', maxWidth: '100%', aspectRatio: `${PW}/${PH}` }} />
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
