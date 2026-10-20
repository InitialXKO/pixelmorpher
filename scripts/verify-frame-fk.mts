// 验证乙 P1：frame FK 化
// A) 合成角色（socket/fixed/混合朝向/inheritRotation=false/2D socket 回退）：
//    新 computeWorldTransforms == 旧标量 FK 独立复刻（rotateInViewPlane + 标量角相加）
// B) 真实 pxm：新实现逐帧逐节点 == 旧实现（git HEAD）捕获基线 /tmp/fk-old.json（IK 开/关）
// C) tilt 几何：出平面旋转把 +Y 轴掀向深度；frameViewAngle 派生角；蓝图/轨道 tilt 通道
// D) 透视缩短：generateRenderPlan 开关开时指令带 foreshorten，关时无
import { readFileSync } from 'fs';
import { computeWorldTransforms, generateRenderPlan, evaluateBlueprintTransforms, socketOffsetTo3D } from '../src/lib/unified-render';
import { rotateInViewPlane, pxToSub, subToPx } from '../src/lib/unified-types';
import { useProjectStore } from '../src/lib/store';

let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${label}: ${detail}`);
  if (!ok) fail++;
}
const clone = (o: any) => JSON.parse(JSON.stringify(o));

// ---------- 合成角色构造 ----------
function mkNode(id: string, opts: any = {}): any {
  return {
    id,
    name: id,
    parentId: opts.parentId ?? null,
    children: opts.children ?? [],
    transform: { x: 0, y: 0, z: 0, angle: 0, stretch: 1, variantIndex: 6, ...(opts.transform ?? {}) },
    tracks: opts.tracks ?? {},
    modifiers: [],
    sockets: opts.sockets ?? [],
    attachment: opts.attachment ?? { type: 'root' },
    blueprint: opts.blueprint,
    spriteId: opts.spriteId,
    drawLayer: 'default',
    visible: true,
  };
}
function sock(id: string, off3dPx?: { x: number; y: number; z: number }, base2d?: { x: number; y: number }): any {
  return {
    id,
    name: id,
    basePosition: base2d ? { x: pxToSub(base2d.x), y: pxToSub(base2d.y) } : { x: 0, y: 0 },
    directionOffsets: {},
    ...(off3dPx ? { offset3D: { x: pxToSub(off3dPx.x), y: pxToSub(off3dPx.y), z: pxToSub(off3dPx.z) } } : {}),
  };
}

// ---------- 旧标量 FK 独立复刻（P1 前 computeChildTransforms 逻辑） ----------
function oldFK(ch: any): Map<string, { x: number; y: number; z: number; angle: number }> {
  const out = new Map<string, any>();
  const root = ch.nodes[ch.rootNodeId];
  const rt = root.transform;
  out.set(root.id, { x: rt.x, y: rt.y, z: rt.z ?? 0, angle: rt.angle });
  const recurse = (parentNode: any, pw: any) => {
    for (const childId of parentNode.children) {
      const child = ch.nodes[childId];
      const ci = child.transform;
      let wx = 0, wy = 0, wz = 0;
      if (child.attachment.type === 'socket' && child.attachment.parentSocketId) {
        const socket = parentNode.sockets.find((s: any) => s.id === child.attachment.parentSocketId);
        const s3 = socketOffsetTo3D(socket, pw.variant);
        const total = {
          x: s3.x + subToPx(ci.x),
          y: s3.y + subToPx(ci.y) * ci.stretch,
          z: s3.z + subToPx(ci.z ?? 0),
        };
        const rot = rotateInViewPlane(total.x, total.y, total.z, pw.angle, pw.variant);
        wx = pw.x + pxToSub(rot.x); wy = pw.y + pxToSub(rot.y); wz = pw.z + pxToSub(rot.z);
      } else {
        const fixed = child.attachment.fixedOffset ?? { x: 0, y: 0 };
        const total = {
          x: subToPx(fixed.x) + subToPx(ci.x),
          y: subToPx(fixed.y) + subToPx(ci.y) * ci.stretch,
          z: subToPx(ci.z ?? 0),
        };
        const rot = rotateInViewPlane(total.x, total.y, total.z, pw.angle, pw.variant);
        wx = pw.x + pxToSub(rot.x); wy = pw.y + pxToSub(rot.y); wz = pw.z + pxToSub(rot.z);
      }
      const angle = ci.angle + (child.attachment.inheritRotation !== false ? pw.angle : 0);
      const w = { x: wx, y: wy, z: wz, angle, variant: ci.variantIndex };
      out.set(childId, w);
      recurse(child, w);
    }
  };
  recurse(root, { ...out.get(root.id), variant: rt.variantIndex });
  return out;
}

function compareFK(label: string, ch: any) {
  const old = oldFK(ch);
  const nw = computeWorldTransforms(clone(ch), 0, 256, 256, 12);
  let maxSub = 0, maxAng = 0;
  for (const [id, o] of old) {
    const n = nw.get(id)!;
    maxSub = Math.max(maxSub, Math.abs(n.worldX - o.x), Math.abs(n.worldY - o.y), Math.abs(n.worldZ - o.z));
    maxAng = Math.max(maxAng, Math.abs(n.worldAngle - o.angle));
  }
  check(label, maxSub <= 1 && maxAng < 1e-6, `最大位置差 ${maxSub} sub（≤1），最大角差 ${maxAng.toExponential(1)}°`);
}

// A1: socket 链（offset3D），带 z、混合角度，南向
{
  const ch: any = {
    rootNodeId: 'R',
    ikChains: [],
    nodes: {
      R: mkNode('R', { children: ['A'], sockets: [sock('s1', { x: 4, y: 16, z: 2 })], transform: { angle: 10, variantIndex: 6 } }),
      A: mkNode('A', { parentId: 'R', children: ['B'], sockets: [sock('s2', { x: -3, y: 30, z: -5 })], attachment: { type: 'socket', parentSocketId: 's1' }, transform: { angle: -25, x: pxToSub(2), z: pxToSub(3), variantIndex: 6 } }),
      B: mkNode('B', { parentId: 'A', attachment: { type: 'socket', parentSocketId: 's2' }, transform: { angle: 40, y: pxToSub(-4), variantIndex: 6 } }),
    },
  };
  compareFK('A1 socket 链（offset3D+z+角度）', ch);
}
// A2: 混合朝向（根南向、子东向、孙斜向）
{
  const ch: any = {
    rootNodeId: 'R',
    ikChains: [],
    nodes: {
      R: mkNode('R', { children: ['A'], sockets: [sock('s1', { x: 0, y: 20, z: 0 })], transform: { angle: 15, variantIndex: 6 } }),
      A: mkNode('A', { parentId: 'R', children: ['B'], sockets: [sock('s2', { x: 8, y: 24, z: 6 })], attachment: { type: 'socket', parentSocketId: 's1' }, transform: { angle: 30, variantIndex: 0 } }),
      B: mkNode('B', { parentId: 'A', attachment: { type: 'socket', parentSocketId: 's2' }, transform: { angle: -10, variantIndex: 3 } }),
    },
  };
  compareFK('A2 混合朝向链', ch);
}
// A3: inheritRotation=false 中间节点 + fixed 附着 + 2D socket 回退
{
  const ch: any = {
    rootNodeId: 'R',
    ikChains: [],
    nodes: {
      R: mkNode('R', { children: ['A', 'F'], sockets: [sock('s1', undefined, { x: 10, y: 12 })], transform: { angle: 20, variantIndex: 6 } }),
      A: mkNode('A', { parentId: 'R', children: ['B'], sockets: [sock('s2', { x: 0, y: 18, z: 0 })], attachment: { type: 'socket', parentSocketId: 's1', inheritRotation: false }, transform: { angle: 35, variantIndex: 6 } }),
      B: mkNode('B', { parentId: 'A', attachment: { type: 'socket', parentSocketId: 's2' }, transform: { angle: 5, variantIndex: 6 } }),
      F: mkNode('F', { parentId: 'R', attachment: { type: 'fixed', fixedOffset: { x: pxToSub(5), y: pxToSub(-7) } }, transform: { angle: -15, variantIndex: 6 } }),
    },
  };
  compareFK('A3 inheritRotation=false + fixed + 2D socket', ch);
}

// ---------- B: 真实 pxm vs 旧实现基线 ----------
{
  const raw = JSON.parse(readFileSync('/home/hatch/workspace/user/files/1_0_hzs0.pxm', 'utf-8'));
  const proj = raw.project;
  const W = proj.canvasWidth ?? 256, H = proj.canvasHeight ?? 256, frameRate = proj.frameRate ?? 12;
  useProjectStore.setState({ canvasWidth: W, canvasHeight: H, currentFrame: 0 });
  // 基线是 P1 的一次性产物（/tmp 已清）；缺失时跳过。P2 起 IK 求解按乙更换，
  // ikOn 与旧基线必然不同——只打印差异，不再断言；ikOff（纯 FK）仍须逐值一致。
  let base: any = null;
  try { base = JSON.parse(readFileSync('/tmp/fk-old.json', 'utf-8')); } catch { /* 基线不存在 */ }
  if (!base) {
    console.log('· B 跳过：/tmp/fk-old.json 不存在（P1 一次性基线）');
  }
  for (const mode of base ? (['ikOn', 'ikOff'] as const) : []) {
    const ch = clone((Object.values(proj.unifiedCharacters) as any[])[0]);
    if (mode === 'ikOff') ch.ikChains = (ch.ikChains ?? []).map((c: any) => ({ ...c, enabled: false }));
    let maxSub = 0, maxAng = 0, frameOk = true;
    for (let f = 0; f < 24; f++) {
      const t = computeWorldTransforms(ch, f, W, H, frameRate);
      for (const [id, wt] of t) {
        if (!wt.worldFrame || wt.worldFrame.length !== 9 || !wt.worldFrame.every(Number.isFinite)) frameOk = false;
        const o = base[mode][f][id];
        if (!o) continue;
        maxSub = Math.max(maxSub, Math.abs(wt.worldX - o[0]), Math.abs(wt.worldY - o[1]), Math.abs(wt.worldZ - o[2]));
        // 角度按模 360 比：旧累积角可超 ±360（如 -409°），新派生角经 atan2 归一，差整数圈等价
        const dAng = Math.abs(((wt.worldAngle - o[3] + 180) % 360 + 360) % 360 - 180);
        maxAng = Math.max(maxAng, dAng);
      }
    }
    if (mode === 'ikOff') {
      check(`B pxm ${mode} 逐帧逐节点 == 旧实现`, maxSub <= 1 && maxAng < 1e-6, `最大位置差 ${maxSub} sub，最大角差 ${maxAng.toExponential(1)}°`);
    } else {
      console.log(`· B pxm ikOn 与甲基线差异（乙预期内）：最大位置差 ${maxSub} sub，最大角差 ${maxAng.toFixed(2)}°`);
    }
    check(`B pxm ${mode} worldFrame 完整`, frameOk, '每节点 9 元有限矩阵');
  }
}

// ---------- C: tilt 几何 ----------
// 根南向原点；A 经 socket(0,16,0) 挂根，A 的 socket(0,32,0) 挂 B
function tiltChar(tiltSource: 'base' | 'track' | 'blueprint'): any {
  const bp = tiltSource === 'blueprint'
    ? { version: 1, nodes: [{ id: 'out', type: 'transform', inputs: {}, params: { tilt: 90 }, ui: { x: 0, y: 0 } }], outputId: 'out' }
    : undefined;
  return {
    rootNodeId: 'R',
    ikChains: [],
    nodes: {
      R: mkNode('R', { children: ['A'], sockets: [sock('s1', { x: 0, y: 16, z: 0 })], transform: { variantIndex: 6 } }),
      A: mkNode('A', {
        parentId: 'R', children: ['B'], sockets: [sock('s2', { x: 0, y: 32, z: 0 })],
        attachment: { type: 'socket', parentSocketId: 's1' },
        transform: { variantIndex: 6, ...(tiltSource === 'base' ? { tilt: 90 } : {}) },
        tracks: tiltSource === 'track' ? { tilt: { keyframes: [{ frame: 0, value: 90 }], interpolation: 'linear' } } : {},
        blueprint: bp,
      }),
      B: mkNode('B', { parentId: 'A', attachment: { type: 'socket', parentSocketId: 's2' }, transform: { variantIndex: 6 } }),
    },
  };
}
for (const src of ['base', 'track', 'blueprint'] as const) {
  const ch = tiltChar(src);
  // 蓝图路径与 generateRenderPlan 同口径：调用方先求值蓝图再传入 computeWorldTransforms
  const bpT = src === 'blueprint' ? evaluateBlueprintTransforms(ch, 0, 12) : undefined;
  const t = computeWorldTransforms(ch, 0, 256, 256, 12, undefined, bpT);
  const b = t.get('B')!;
  const got = { x: subToPx(b.worldX), y: subToPx(b.worldY), z: subToPx(b.worldZ) };
  check(`C tilt=90（${src}）B 被掀向深度`, Math.abs(got.x) < 0.1 && Math.abs(got.y - 16) < 0.1 && Math.abs(got.z + 32) < 0.1,
    `B=(${got.x.toFixed(1)}, ${got.y.toFixed(1)}, ${got.z.toFixed(1)})，期望 (0, 16, -32)`);
}
{
  // 派生角：根 angle=30 tilt=90 → worldAngle = atan2(sin30, cos90·cos30) = 90
  const ch: any = { rootNodeId: 'R', ikChains: [], nodes: { R: mkNode('R', { transform: { angle: 30, tilt: 90, variantIndex: 6 } }) } };
  const ang = computeWorldTransforms(ch, 0, 256, 256, 12).get('R')!.worldAngle;
  check('C frameViewAngle 派生（30°+tilt90 → 90°）', Math.abs(ang - 90) < 1e-6, `得到 ${ang}`);
  const ch2: any = { rootNodeId: 'R', ikChains: [], nodes: { R: mkNode('R', { transform: { angle: 30, variantIndex: 6 } }) } };
  const ang2 = computeWorldTransforms(ch2, 0, 256, 256, 12).get('R')!.worldAngle;
  check('C tilt=0 派生角 == 原角', Math.abs(ang2 - 30) < 1e-9, `得到 ${ang2}`);
  const bt = evaluateBlueprintTransforms(tiltChar('blueprint'), 0, 12).get('A');
  check('C 蓝图结果带 tilt', bt?.tilt === 90, `tilt=${bt?.tilt}`);
}

// ---------- D: 透视缩短（真实 pxm 角色，根节点置 tilt） ----------
{
  const raw = JSON.parse(readFileSync('/home/hatch/workspace/user/files/1_0_hzs0.pxm', 'utf-8'));
  const proj = raw.project;
  const W = proj.canvasWidth ?? 256, H = proj.canvasHeight ?? 256;
  const mk = (tilt: number) => {
    const c = clone((Object.values(proj.unifiedCharacters) as any[])[0]);
    const root = c.nodes[c.rootNodeId];
    root.transform = { ...root.transform, angle: 0, tilt, variantIndex: 0 };
    root.tracks = {};
    return c;
  };
  const args = [0, W, H, 'pixel-perfect', 12] as const;
  const gs = proj.sprites; // 服装集精灵是 SpriteRef，须传项目级精灵表（与应用内 renderUnified 同口径）
  // 根 variant=0（东向）：tilt=90 时根 +Y 轴指向世界 +X = 东向深度轴 → 投影长度 0
  const plan90 = generateRenderPlan(mk(90), ...args, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, gs, undefined, true);
  const rootIns90: any = plan90.nodeInstructions.find((i: any) => i.nodeId === (Object.values(proj.unifiedCharacters) as any[])[0].rootNodeId);
  check('D 开关开：tilt=90 根节点 foreshorten ≈ 0', rootIns90?.foreshorten !== undefined && Math.abs(rootIns90.foreshorten) < 0.01, `得到 ${rootIns90?.foreshorten}`);
  const plan0 = generateRenderPlan(mk(0), ...args, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, gs, undefined, true);
  const rootIns0: any = plan0.nodeInstructions.find((i: any) => i.nodeId === (Object.values(proj.unifiedCharacters) as any[])[0].rootNodeId);
  check('D 开关开：tilt=0 根节点 foreshorten ≈ 1', rootIns0?.foreshorten !== undefined && Math.abs(rootIns0.foreshorten - 1) < 0.01, `得到 ${rootIns0?.foreshorten}`);
  const planOff = generateRenderPlan(mk(90), ...args, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, gs);
  const rootInsOff: any = planOff.nodeInstructions.find((i: any) => i.nodeId === (Object.values(proj.unifiedCharacters) as any[])[0].rootNodeId);
  check('D 开关关：无 foreshorten', rootInsOff?.foreshorten === undefined, `得到 ${rootInsOff?.foreshorten}`);
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
