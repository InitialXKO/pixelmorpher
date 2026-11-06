'use client';
// ============================================================
// 机甲生成向导：人形（选族/胸型/底盘/装备）或载具（车体/机动/
// 炮塔），按整机身高（32–512 px）设尺寸：基准高由预览装配实测
// （精灵包围盒），scale = 输入身高 / 基准高。预览走产品渲染器
// 同一条世界变换口径（computeWorldTransforms + 投影深度画序），所见即
// 主画布所得；生成时项目画布按需只扩不缩以适应尺寸。产出是
// 真角色：三段肢链节点 + 预置 IK 链（默认禁用），主画布可摆
// 姿势/配 IK、可进运行时包。
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useProjectStore } from '@/lib/store';
import { projectToView, subToPx } from '@/lib/unified-types';
import type { Character } from '@/lib/unified-types';
import { computeWorldTransforms } from '@/lib/unified-render';
import {
  generateMechaPartSet, generateMechaWheelLegParts, generateMechaMultiLegParts, generateMechaTrackUnit,
  generateMechaJetpack, generateMechaWeapon, generateMechaHullBody, generateMechaTurret,
  MECHA_FAMILIES, MECHA_CHEST_LABELS,
} from '@/lib/mecha/parts';
import type { MechaFamily, MechaPartSet, MechaSpriteData, MechaChestVariant } from '@/lib/mecha/parts';
import {
  assembleMechaCharacter, assembleMechaVehicle, createMechaCharacterInStore, createMechaVehicleInStore,
  mechaHumanoidNodeParts, mechaVehicleNodeParts, mechaMobilityFamily,
  MECHA_CHASSIS_LABELS, MECHA_VEHICLE_LABELS, MECHA_POD_MOUNT_LABELS,
} from '@/lib/mecha/build-character';
import type { MechaBuildOptions, MechaVehicleOptions, MechaPodMount } from '@/lib/mecha/build-character';

type Mode = 'humanoid' | 'vehicle';
type Chassis = NonNullable<MechaBuildOptions['chassis']>;
type WeaponSel = 'none' | 'cannon' | 'rifle';

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
  const [podMount, setPodMount] = useState<MechaPodMount | null>(null);
  const [weapon, setWeapon] = useState<WeaponSel>('none');
  const [hull, setHull] = useState<MechaVehicleOptions['hull']>('walker');
  const [mobility, setMobility] = useState<MechaVehicleOptions['mobility']>('legs');
  const [turret, setTurret] = useState(true);
  const [heightPx, setHeightPx] = useState(512);
  const [heightText, setHeightText] = useState('512');
  // 当前配置在 scale=1 时的实测总高（预览装配量得，按配置签名缓存）
  const [baseCal, setBaseCal] = useState<{ sig: string; h: number } | null>(null);
  const [name, setName] = useState('机甲-01');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const partSetCache = useRef(new Map<string, MechaPartSet>());
  const spriteCache = useRef(new Map<string, MechaSpriteData>());
  const bitmapCache = useRef(new Map<string, HTMLCanvasElement>());
  const sig = mode === 'humanoid'
    ? ['h', family, chest, chassis, jetpack, podMount ?? '-', weapon].join(':')
    : ['v', hull, mobility, turret].join(':');
  // 基准高未量得前先按自然尺寸预览，量得后按 输入身高/基准高 缩放
  const scale = baseCal && baseCal.sig === sig ? heightPx / baseCal.h : 1;

  const buildOpts = useCallback((): MechaBuildOptions => ({
    chest: chest === 'default' ? undefined : chest,
    chassis,
    jetpack,
    podMount,
    weapon: weapon === 'none' ? null : weapon,
  }), [chest, chassis, jetpack, podMount, weapon]);

  const vehicleOpts = useCallback((): MechaVehicleOptions => ({ hull, mobility, turret }), [hull, mobility, turret]);

  const getPartSet = useCallback((fam: MechaFamily, chestV?: MechaChestVariant): MechaPartSet => {
    const key = fam + ':' + (chestV ?? 'default');
    let ps = partSetCache.current.get(key);
    if (!ps) { ps = generateMechaPartSet(fam, chestV); partSetCache.current.set(key, ps); }
    return ps;
  }, []);

  const gearSprite = useCallback((fam: MechaFamily, part: string): MechaSpriteData | undefined => {
    const key = fam + ':' + part;
    let s = spriteCache.current.get(key);
    if (s) return s;
    if (part === 'wheelThigh' || part === 'wheelShin' || part === 'wheelFoot') {
      const wp = generateMechaWheelLegParts(fam);
      spriteCache.current.set(fam + ':wheelThigh', wp.thigh);
      spriteCache.current.set(fam + ':wheelShin', wp.shin);
      spriteCache.current.set(fam + ':wheelFoot', wp.foot);
      return spriteCache.current.get(key);
    }
    if (part === 'trackUnit') s = generateMechaTrackUnit(fam);
    else if (part === 'jetpack') s = generateMechaJetpack(fam);
    else if (part === 'pod') s = generateMechaWeapon(fam, 'pod');
    else if (part === 'podPylon') s = generateMechaWeapon(fam, 'podPylon');
    else if (part === 'cannon') s = generateMechaWeapon(fam, 'cannon');
    else if (part === 'rifle') s = generateMechaWeapon(fam, 'rifle');
    else return undefined;
    spriteCache.current.set(key, s);
    return s;
  }, []);

  const bitmapOf = useCallback((cacheKey: string, s: MechaSpriteData): HTMLCanvasElement => {
    let c = bitmapCache.current.get(cacheKey);
    if (!c) {
      c = document.createElement('canvas');
      c.width = s.width; c.height = s.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(s.rgba), s.width, s.height), 0, 0);
      bitmapCache.current.set(cacheKey, c);
    }
    return c;
  }, []);

  // 预览尺寸随尺寸设置走（画布适应其尺寸）
  const PW = mode === 'humanoid'
    ? Math.max(220, Math.min(660, Math.round(470 * scale)))
    : Math.max(260, Math.min(980, Math.round(800 * scale)));
  const PH = mode === 'humanoid'
    ? Math.max(220, Math.min(1000, Math.round(850 * scale)))
    : Math.max(200, Math.min(820, Math.round(580 * scale)));

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== PW) canvas.width = PW;
    if (canvas.height !== PH) canvas.height = PH;
    ctx.clearRect(0, 0, PW, PH);
    ctx.imageSmoothingEnabled = false;

    let assembly: ReturnType<typeof assembleMechaCharacter>;
    let nodeParts: Record<string, string>;
    let spriteFor: (part: string) => MechaSpriteData | undefined;
    let spriteKeyFor: (part: string) => string;
    if (mode === 'humanoid') {
      const B = buildOpts();
      const ps = getPartSet(family, B.chest);
      assembly = assembleMechaCharacter({
        characterId: 'preview', family, canvasSize: { w: 1000, h: 1200 },
        partSet: ps, spriteIds: {}, build: B, scale,
      });
      nodeParts = mechaHumanoidNodeParts(B);
      spriteFor = (part) => {
        if (part === 'torso') return ps.torso;
        if (part === 'head') return ps.head;
        if (part === 'armUpper') return ps.armUpper;
        if (part === 'armFore') return ps.armFore;
        if (part === 'armHand') return ps.armHand;
        if (part === 'legThigh') return ps.legThigh;
        if (part === 'legShin') return ps.legShin;
        if (part === 'legFoot') return ps.legFoot;
        return gearSprite(family, part);
      };
      spriteKeyFor = (part) => family + ':' + (B.chest ?? 'default') + ':' + part;
    } else {
      const V = vehicleOpts();
      const mobFam = mechaMobilityFamily(V.hull);
      const mps = V.mobility === 'legs' ? getPartSet(mobFam) : undefined;
      assembly = assembleMechaVehicle({
        characterId: 'preview', canvasSize: { w: 1000, h: 1200 }, vehicle: V, spriteIds: {}, partSet: mps, scale,
      });
      nodeParts = mechaVehicleNodeParts(V);
      spriteFor = (part) => {
        if (part === 'hullBody') return gearSprite2('veh:' + V.hull + ':body', () => generateMechaHullBody(V.hull));
        if (part === 'turret') return gearSprite2('veh:' + V.hull + ':turret', () => generateMechaTurret(V.hull));
        if (part === 'trackUnit') return gearSprite(mobFam, 'trackUnit');
        if (part === 'legThigh') return mps?.legThigh;
        if (part === 'legShin') return mps?.legShin;
        if (part === 'legFoot') return mps?.legFoot;
        if (part === 'multiUpper' || part === 'multiLower') {
          const mp = gearSprite2('veh:' + V.hull + ':' + V.mobility + ':multi', () => {
            const p = generateMechaMultiLegParts(mobFam, V.mobility as 'quad' | 'spider');
            spriteCache.current.set('veh:' + V.hull + ':' + V.mobility + ':multiUpper', p.upper);
            spriteCache.current.set('veh:' + V.hull + ':' + V.mobility + ':multiLower', p.lower);
            return p.upper;
          });
          return part === 'multiUpper' ? mp : spriteCache.current.get('veh:' + V.hull + ':' + V.mobility + ':multiLower');
        }
        return undefined;
      };
      spriteKeyFor = (part) => 'veh:' + V.hull + ':' + V.mobility + ':' + part;
    }

    function gearSprite2(key: string, gen: () => MechaSpriteData): MechaSpriteData {
      let s = spriteCache.current.get(key);
      if (!s) { s = gen(); spriteCache.current.set(key, s); }
      return s;
    }

    // 与主画布同一口径：真世界变换 + 投影（深度主序、zIndex 次序）
    const character = {
      id: 'preview', name: 'preview', nodes: assembly.nodes, rootNodeId: assembly.rootNodeId,
      costumeSets: [assembly.costumeSet], activeCostumeSetId: assembly.costumeSet.id,
    } as unknown as Character;
    const wt = computeWorldTransforms(character, 0, PW, PH, 12);
    const rootT = wt.get(assembly.rootNodeId);
    if (!rootT) return;
    const rootProj = projectToView(rootT.worldX, rootT.worldY, rootT.worldZ, 0);
    const anchorX = PW / 2, anchorY = PH * (mode === 'humanoid' ? 0.40 : 0.30);
    const items: { part: string; x: number; y: number; a: number; depth: number; z: number }[] = [];
    for (const n of Object.values(assembly.nodes)) {
      const key = n.id.replace('node_preview_', '');
      const part = nodeParts[key];
      if (!part) continue;
      const t = wt.get(n.id);
      if (!t) continue;
      const proj = projectToView(t.worldX, t.worldY, t.worldZ, 0);
      items.push({
        part,
        x: anchorX + subToPx(proj.canvasX) - subToPx(rootProj.canvasX),
        y: anchorY + subToPx(proj.canvasY) - subToPx(rootProj.canvasY),
        a: t.worldAngle, depth: proj.depth, z: n.zIndex ?? 0,
      });
    }
    items.sort((a, b) => (Math.round(a.depth) - Math.round(b.depth)) || (a.z - b.z));
    // 量整机总高：只在该配置首轮（scale=1）量一次——绘制包围盒高即
    // 基准高；小缩放下亚像素量化误差会被放大，故量得后不再覆写
    if (!baseCal || baseCal.sig !== sig) {
      let mnY = Infinity, mxY = -Infinity;
      for (const it of items) {
        const s = spriteFor(it.part);
        if (!s) continue;
        const a = (it.a * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
        for (const [ox, oy] of [[0, 0], [s.width, 0], [0, s.height], [s.width, s.height]] as const) {
          const lx = (ox - s.plug.x) * scale, ly = (oy - s.plug.y) * scale;
          const ry = it.y + lx * sin + ly * cos;
          if (ry < mnY) mnY = ry;
          if (ry > mxY) mxY = ry;
        }
      }
      if (mxY > mnY) setBaseCal({ sig, h: Math.round((mxY - mnY) / scale) });
    }
    for (const it of items) {
      const s = spriteFor(it.part);
      if (!s) continue;
      const bmp = bitmapOf(spriteKeyFor(it.part) + ':' + it.part, s);
      ctx.save();
      ctx.translate(Math.round(it.x), Math.round(it.y));
      if (it.a) ctx.rotate((it.a * Math.PI) / 180);
      ctx.drawImage(bmp, -s.plug.x * scale, -s.plug.y * scale, s.width * scale, s.height * scale);
      ctx.restore();
    }
  }, [mode, family, buildOpts, vehicleOpts, gearSprite, getPartSet, bitmapOf, PW, PH, scale, sig, baseCal]);

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    const t = setTimeout(() => { redraw(); setBusy(false); }, 30);
    return () => clearTimeout(t);
  }, [open, redraw]);

  const handleCreate = () => {
    const charName = name.trim() || '机甲';
    // 画布适应尺寸：不够大就只扩不缩，扩完再按新画布生成
    const needW = Math.ceil((mode === 'humanoid' ? 640 : 1040) * scale);
    const needH = Math.ceil((mode === 'humanoid' ? 920 : 780) * scale);
    const st = useProjectStore.getState();
    let grown = '';
    if (st.canvasWidth < needW || st.canvasHeight < needH) {
      const w = Math.max(st.canvasWidth, needW), h = Math.max(st.canvasHeight, needH);
      st.setCanvasSize(w, h);
      grown = `；画布已扩至 ${w}×${h} 适应尺寸`;
    }
    const store = useProjectStore.getState();
    const { characterId } = mode === 'humanoid'
      ? createMechaCharacterInStore(store as never, { name: charName, family, build: buildOpts(), scale })
      : createMechaVehicleInStore(store as never, { name: charName, vehicle: vehicleOpts(), scale });
    const created = useProjectStore.getState().unifiedCharacters[characterId];
    const nNodes = created ? Object.keys(created.nodes).length : 0;
    const nChains = created?.ikChains?.length ?? 0;
    setNote(`已生成「${charName}」：${nNodes} 个节点${nChains ? `、${nChains} 条 IK 链（默认禁用，在 IK 面板启用）` : ''}${grown}`);
    onClose();
  };

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
          <Row label="身高">
            <Input type="number" min={32} max={512} step={1} value={heightText}
              onChange={(e) => {
                setHeightText(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value !== '' && Number.isFinite(n)) setHeightPx(Math.max(32, Math.min(512, Math.round(n))));
              }}
              onBlur={() => setHeightText(String(heightPx))}
              className="h-7 w-20 text-[12px] bg-[#0d0d1a] border-[#1e1e3a] text-gray-200" />
            <span className="text-[11px] text-gray-300">px</span>
            <span className="text-[11px] text-gray-500">整机总高 32–512，预览与生成画布随之适应</span>
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
                <Chip active={weapon === 'cannon'} onClick={() => setWeapon(weapon === 'cannon' ? 'none' : 'cannon')}>臂炮</Chip>
                <Chip active={weapon === 'rifle'} onClick={() => setWeapon(weapon === 'rifle' ? 'none' : 'rifle')}>步枪</Chip>
              </Row>
              <Row label="导弹荚">
                <Chip active={podMount === null} onClick={() => setPodMount(null)}>无</Chip>
                {(Object.keys(MECHA_POD_MOUNT_LABELS) as MechaPodMount[]).map((m) => (
                  <Chip key={m} active={podMount === m} onClick={() => setPodMount(m)}>{MECHA_POD_MOUNT_LABELS[m]}</Chip>
                ))}
              </Row>
              <p className="text-[11px] text-gray-400">
                按模式库生成全套部位并装配成真角色：臂与腿都是三段节点链（上臂/前臂/手、大腿/小腿/足），每条链预置一条 IK 链（默认禁用，在 IK 面板启用即可拖目标）；底盘与装备也是独立节点。精灵为侧面东向，西向自动镜像。
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
                车体为根节点：步行腿同人形三段链带 IK；蜘蛛/四足腿是两段节点（髋 + 膝下段）可摆；履带与炮塔是独立节点。蜘蛛腿扇角是初始姿态，随便改。
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
