// ============================================================
// verify-stack-frames — 堆叠层变换逐帧烘焙进包（stackFrames）探针
// 覆盖：
//   1. 带 tilt 轨道的堆叠件：轨道表演带 stackFrames（11 帧、costume 对）
//   2. 逐像素对照：烘焙帧算子经包内同口径栅格化 == 编辑器同帧活合成
//      （第 0 帧对静止显示图、末帧对 computeStackOps 现算）
//   3. 显示图按全窗并集垫边（plug/尺寸容纳末帧剪影）
//   4. tilt 120°：首绘层序与 0° 相反（深度画序翻转进包）
//   5. 片段窗表演同样带 stackFrames（帧数 = 窗长）
//   6. 无轨道角色：无 stackFrames、警告仍是静止图口径（回落不回归）
//   7. facingAngle 偏航：烘焙帧与静止图同口径（帧 0 对照仍成立）
//   8. 模板含选帧/栅格化/图集回传接线（字符串级；GL 运行时不在此跑）
// ============================================================
import { sliceStack } from '../src/lib/bake/stack-slicer';
import { attachBoneStacks } from '../src/lib/bake/stack-attach';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { buildRuntimeHtml } from '../src/lib/proc-runtime/runtime-template';
import { computeStackOps, rasterizeStackOpsData, type StackDrawOp } from '../src/lib/stack-render';
import { computeWorldTransforms } from '../src/lib/unified-render';
import {
  createDefaultNode, createDefaultCostumePiece, pxToSub,
  type Character, type Sprite, type SpriteStack,
} from '../src/lib/unified-types';
import type { AnimationClip } from '../src/lib/types';

let fails = 0;
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${label}`);
  if (!cond) fails++;
};

// +Z 轴圆柱摞（与 verify-stack-yaw 同夹具）
const R = 7, H = 38, SEG = 14;
const positions: number[] = [], uvs: number[] = [], tris: number[] = [], triMat: number[] = [];
for (let i = 0; i < SEG; i++) {
  const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
  const base = positions.length / 3;
  const x0 = Math.cos(a0) * R, y0 = Math.sin(a0) * R, x1 = Math.cos(a1) * R, y1 = Math.sin(a1) * R;
  positions.push(x0, y0, 0, x1, y1, 0, x1, y1, H, x0, y0, H);
  uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  tris.push(base, base + 1, base + 2, base, base + 2, base + 3);
  triMat.push(0, 0);
}
const sliced = sliceStack({
  positions: Float32Array.from(positions), uvs: Float32Array.from(uvs),
  tris: Uint32Array.from(tris), triMaterial: Int32Array.from(triMat),
  sample: () => [200, 60, 60, 255],
  pivot: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, uAxis: { x: 1, y: 0, z: 0 },
  layerThickness: 4,
});

interface Built { character: Character; sprites: Record<string, Sprite>; stack: SpriteStack; midId: string }
function build(tiltEnd: number, facingAngle?: number, slicedOverride?: typeof sliced): Built {
  const charId = 'sf';
  const root = createDefaultNode('root', 'root'); root.id = `node_${charId}_0`;
  const mid = createDefaultNode('mid', 'mid'); mid.id = `node_${charId}_1`; mid.parentId = root.id;
  mid.slot = { slotKey: 'mid' } as never;
  const end = createDefaultNode('end', 'end'); end.id = `node_${charId}_2`; end.parentId = mid.id;
  end.slot = { slotKey: 'end' } as never;
  root.children = [mid.id]; mid.children = [end.id];
  root.sockets = [{ id: 'sock_m', name: 'mid', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: 0, y: 0, z: 0 } }];
  mid.sockets = [{ id: 'sock_e', name: 'end', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: 0, y: pxToSub(38), z: 0 } }];
  mid.attachment = { type: 'socket', parentSocketId: 'sock_m' } as never;
  end.attachment = { type: 'socket', parentSocketId: 'sock_e' } as never;
  for (const n of [root, mid, end]) (n.transform as unknown as { variantIndex: number }).variantIndex = 6;
  // tilt 轨道：0 帧 0° → 10 帧 tiltEnd
  (mid as unknown as { tracks: unknown }).tracks = {
    tilt: { keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: tiltEnd }], interpolation: 'linear' },
  };
  const endPiece = createDefaultCostumePiece('end');
  const endSpr: Sprite = {
    id: 'spr_end', name: 'end', width: 10, height: 10,
    data: Array.from({ length: 10 }, () => Array(10).fill('#33cc33')),
    plug: { x: pxToSub(5), y: 0 },
  } as unknown as Sprite;
  endPiece.sprites = { 6: endSpr } as never;
  const midPiece = createDefaultCostumePiece('mid');
  const character = {
    id: charId, name: '层变换测试', nodes: { [root.id]: root, [mid.id]: mid, [end.id]: end },
    rootNodeId: root.id, sprites: {},
    costumeSets: [{ id: 'cs1', name: '默认', pieces: { mid: midPiece, end: endPiece } }],
    activeCostumeSetId: 'cs1', direction: 6, latitude: 0,
    ...(facingAngle !== undefined ? { facingAngle } : {}),
  } as unknown as Character;
  const sprites: Record<string, Sprite> = { spr_end: endSpr };
  const boneStacks = new Map([[1, { rootBoneIndex: 1, rootBoneName: 'mid', jointChar: { x: 0, y: 0, z: 0 }, sliced: slicedOverride ?? sliced }]]) as never;
  attachBoneStacks(character, sprites, boneStacks, charId, '层变换测试');
  const stack = (character.costumeSets[0]!.pieces.mid as { stack: SpriteStack }).stack;
  return { character, sprites, stack, midId: mid.id };
}

function gridToRgba(spr: Sprite) {
  const rgba = new Uint8ClampedArray(spr.width * spr.height * 4);
  for (let y = 0; y < spr.height; y++) {
    const row = spr.data[y];
    for (let x = 0; x < spr.width; x++) {
      const cell = row?.[x];
      if (!cell) continue;
      const o = (y * spr.width + x) * 4;
      rgba[o] = parseInt(cell.slice(1, 3), 16);
      rgba[o + 1] = parseInt(cell.slice(3, 5), 16);
      rgba[o + 2] = parseInt(cell.slice(5, 7), 16);
      rgba[o + 3] = 255;
    }
  }
  return { rgba, width: spr.width, height: spr.height };
}

/** 烘焙帧算子（包内数组形态）→ 栅格（与播放器同一条栅格化口径） */
function rasterBaked(opsArr: number[][], layerRgba: ({ rgba: Uint8ClampedArray; width: number; height: number } | null)[], W: number, H: number) {
  const ops: StackDrawOp[] = opsArr.map((o) => ({
    layer: o[0]!, tr: [o[1]!, o[2]!, o[3]!, o[4]!, o[5]!, o[6]!], depth: 0,
  }));
  return rasterizeStackOpsData({ ops, width: W, height: H, pivotX: 0, pivotY: 0, key: '' }, layerRgba);
}

function matchRatio(
  a: { rgba: Uint8ClampedArray; width: number; height: number },
  b: { rgba: Uint8ClampedArray; width: number; height: number },
  bOffX: number, bOffY: number,
): number {
  // 以 a 为基准逐像素比：b 平移 (bOffX, bOffY) 后同坐标比对（界外=透明）
  let same = 0, total = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const ao = (y * a.width + x) * 4;
      const aA = a.rgba[ao + 3]!;
      const bx = x - bOffX, by = y - bOffY;
      let bA = 0, bR = 0, bG = 0, bB = 0;
      if (bx >= 0 && by >= 0 && bx < b.width && by < b.height) {
        const bo = (by * b.width + bx) * 4;
        bR = b.rgba[bo]!; bG = b.rgba[bo + 1]!; bB = b.rgba[bo + 2]!; bA = b.rgba[bo + 3]!;
      }
      if (aA === 0 && bA === 0) continue;
      total++;
      if (aA > 0 && bA > 0 && Math.abs(a.rgba[ao]! - bR) <= 2 && Math.abs(a.rgba[ao + 1]! - bG) <= 2 && Math.abs(a.rgba[ao + 2]! - bB) <= 2) same++;
    }
  }
  return total === 0 ? 1 : same / total;
}

interface SfEntry { costume: string; frames: number[][][] }
function tracksSf(pkg: ReturnType<typeof convertCharacterToRuntimePackage>): SfEntry | undefined {
  const perf = pkg.performances.find((p) => p.id === 'tracks') as { stackFrames?: Record<string, SfEntry> } | undefined;
  return perf?.stackFrames?.mid;
}

// ---------- 1+2+3：tilt 60 主线 ----------
{
  const { character, sprites, stack, midId } = build(60);
  const pkg = convertCharacterToRuntimePackage(character, sprites, { frameRate: 12, totalFrames: 10 });
  const sf = tracksSf(pkg);
  ok(!!sf, '轨道表演带 stackFrames.mid');
  ok(sf?.costume === 'cs1', 'stackFrames 记服装集口径（cs1）');
  ok(sf?.frames.length === 11, `帧数 = 窗长+1（实得 ${sf?.frames.length}）`);
  ok((sf?.frames[0]?.length ?? 0) > 0 && (sf?.frames[10]?.length ?? 0) > 0, '首末帧算子非空');
  ok(JSON.stringify(sf?.frames[0]) !== JSON.stringify(sf?.frames[10]), '首末帧算子不同（动画真进包）');
  ok(pkg.warnings.some((w) => w.includes('stackFrames')), '警告点名层变换已烘焙');

  const part = pkg.parts.find((p) => p.key === 'mid')!;
  const layerRgba = stack.layerSpriteIds.map((id) => (sprites[id] ? gridToRgba(sprites[id]) : null));
  // 第 0 帧：烘焙帧栅格 vs 包内静止显示图（已垫边、同画布）
  const f0 = rasterBaked(sf!.frames[0]!, layerRgba, part.sprite!.w, part.sprite!.h);
  const dispRgba = (() => {
    const g = part.sprite!;
    const rgba = new Uint8ClampedArray(g.w * g.h * 4);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const c = g.data[y]?.[x];
      if (!c) continue;
      const o = (y * g.w + x) * 4;
      rgba[o] = parseInt(c.slice(1, 3), 16); rgba[o + 1] = parseInt(c.slice(3, 5), 16); rgba[o + 2] = parseInt(c.slice(5, 7), 16); rgba[o + 3] = 255;
    }
    return { rgba, width: g.w, height: g.h };
  })();
  const r0 = f0 ? matchRatio(f0, dispRgba, 0, 0) : 0;
  console.log(`    帧0 vs 静止显示图 匹配率=${r0.toFixed(4)}`);
  ok(r0 > 0.98, '帧 0 烘焙栅格 ≈ 静止显示图（>98%）');

  // 末帧：烘焙帧栅格 vs 编辑器同帧活合成（平移到并集画布后比对）
  const wf = computeWorldTransforms(character, 10, 512, 512, 12);
  const w = wf.get(midId)!;
  const layerSprites = stack.layerSpriteIds.map((id) => sprites[id]);
  const live = computeStackOps(stack, layerSprites, w.worldFrame, w.worldAngle);
  const liveRaster = rasterizeStackOpsData(live, layerRgba);
  const fN = rasterBaked(sf!.frames[10]!, layerRgba, part.sprite!.w, part.sprite!.h);
  const rN = fN && liveRaster
    ? matchRatio(fN, liveRaster, Math.round(part.sprite!.plug[0] - live.pivotX), Math.round(part.sprite!.plug[1] - live.pivotY))
    : 0;
  console.log(`    帧10 vs 活合成 匹配率=${rN.toFixed(4)}（活合成 ${liveRaster?.width}×${liveRaster?.height}，垫后 ${part.sprite!.w}×${part.sprite!.h}）`);
  ok(rN > 0.98, '帧 10 烘焙栅格 ≈ 编辑器活合成（>98%）');
  ok(part.sprite!.w >= live.width && part.sprite!.h >= live.height, '显示图并集尺寸容纳末帧剪影');
}

// ---------- 4：画序翻转（+Y 骨骼轴摞，tilt ±60 首绘层相反） ----------
function buildY(tiltEnd: number, facingAngle?: number): Built {
  const pos: number[] = [], uv: number[] = [], tri: number[] = [], tm: number[] = [];
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const base = pos.length / 3;
    const x0 = Math.cos(a0) * R, z0 = Math.sin(a0) * R, x1 = Math.cos(a1) * R, z1 = Math.sin(a1) * R;
    pos.push(x0, 0, z0, x1, 0, z1, x1, H, z1, x0, H, z0);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    tri.push(base, base + 1, base + 2, base, base + 2, base + 3);
    tm.push(0, 0);
  }
  const slicedY = sliceStack({
    positions: Float32Array.from(pos), uvs: Float32Array.from(uv), tris: Uint32Array.from(tri), triMaterial: Int32Array.from(tm),
    sample: () => [200, 60, 60, 255],
    pivot: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 1, z: 0 }, uAxis: { x: 1, y: 0, z: 0 },
    layerThickness: 4,
  });
  return build(tiltEnd, facingAngle, slicedY);
}
{
  const firstOf = (tiltEnd: number) => {
    const { character, sprites } = buildY(tiltEnd);
    const pkg = convertCharacterToRuntimePackage(character, sprites, { frameRate: 12, totalFrames: 10 });
    const sf = tracksSf(pkg);
    return { f0: sf?.frames[0]?.[0]?.[0], fN: sf?.frames[10]?.[0]?.[0], n: sf?.frames[10]?.length };
  };
  const plus = firstOf(60);
  const minus = firstOf(-60);
  console.log(`    +Y摞：tilt+60 首绘层 帧0=${plus.f0} 帧10=${plus.fN}；tilt−60 帧10=${minus.fN}（末帧算子数 ${plus.n}）`);
  ok(plus.f0 !== undefined && plus.fN === plus.f0, 'tilt +60° 首绘层与 0° 同侧（不误翻）');
  ok(minus.fN !== undefined && minus.fN !== plus.fN, 'tilt −60° 首绘层与 +60° 相反（深度画序进包）');
}

// ---------- 5：片段窗 ----------
{
  const { character, sprites } = build(60);
  const clip = {
    id: 'clipA', name: '片段A', puppetCharacterId: 'sf', startFrame: 4, endFrame: 10, loop: false,
  } as unknown as AnimationClip;
  const pkg = convertCharacterToRuntimePackage(character, sprites, { frameRate: 12, totalFrames: 10, clips: [clip] });
  const perf = pkg.performances.find((p) => p.id === 'clip_clipA') as { stackFrames?: Record<string, SfEntry> } | undefined;
  ok(!!perf?.stackFrames?.mid, '片段表演带 stackFrames');
  ok(perf?.stackFrames?.mid.frames.length === 8, `片段帧数 = 窗长+1（与位姿曲线同采样格，实得 ${perf?.stackFrames?.mid.frames.length}）`);
}

// ---------- 6：无轨道回落 ----------
{
  const { character, sprites } = build(0);
  (character.nodes as Record<string, { tracks?: unknown }>)[Object.keys(character.nodes)[1]!]!.tracks = {};
  const pkg = convertCharacterToRuntimePackage(character, sprites, { frameRate: 12, totalFrames: 10 });
  const anySf = pkg.performances.some((p) => (p as { stackFrames?: unknown }).stackFrames);
  ok(!anySf, '无轨道：任何表演都无 stackFrames');
  ok(pkg.warnings.some((w) => w.includes('逐帧 3D 合成不在包内')), '无轨道：警告为静止图回落口径');
}

// ---------- 7：偏航口径（45° 斜向：tilt 平面斜映射、合成真变，才烘） ----------
{
  const { character, sprites } = buildY(60, 45);
  const pkg = convertCharacterToRuntimePackage(character, sprites, { frameRate: 12, totalFrames: 10 });
  const sf = tracksSf(pkg);
  const part = pkg.parts.find((p) => p.key === 'mid')!;
  const stack = (character.costumeSets[0]!.pieces.mid as { stack: SpriteStack }).stack;
  const layerRgba = stack.layerSpriteIds.map((id) => (sprites[id] ? gridToRgba(sprites[id]) : null));
  const f0 = sf ? rasterBaked(sf.frames[0]!, layerRgba, part.sprite!.w, part.sprite!.h) : null;
  const g = part.sprite!;
  const dispRgba = new Uint8ClampedArray(g.w * g.h * 4);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const c = g.data[y]?.[x];
    if (!c) continue;
    const o = (y * g.w + x) * 4;
    dispRgba[o] = parseInt(c.slice(1, 3), 16); dispRgba[o + 1] = parseInt(c.slice(3, 5), 16); dispRgba[o + 2] = parseInt(c.slice(5, 7), 16); dispRgba[o + 3] = 255;
  }
  const r = f0 ? matchRatio(f0, { rgba: dispRgba, width: g.w, height: g.h }, 0, 0) : 0;
  console.log(`    偏航45° 帧0 vs 静止图 匹配率=${r.toFixed(4)}`);
  ok(!!sf && r > 0.98, '偏航 45° 下帧 0 与（已转）静止图同口径');
}

// ---------- 8：模板接线 ----------
{
  const { character, sprites } = build(60);
  const pkg = convertCharacterToRuntimePackage(character, sprites, { frameRate: 12, totalFrames: 10 });
  const html = buildRuntimeHtml(pkg);
  ok(html.includes('stackRasterizeFrame') && html.includes('stackPick') && html.includes('stackDirty'), '模板含选帧/栅格化/图集回传接线');
  ok(html.includes('"stackFrames"'), '包内 stackFrames 序列化进 HTML');
}

// ---------- 9：发光件不再排除，场 pad 随垫图反向补偿 ----------
{
  const { createDynamicInstance, defaultDynamicParams } = await import('../src/lib/dynamic-patterns');
  const mk = (tilt: number) => {
    const { character, sprites } = build(tilt);
    const flat: Sprite = {
      id: 'midflat', name: 'midflat', width: 12, height: 38,
      data: Array.from({ length: 38 }, () => Array(12).fill('#cc3333')), plug: { x: 6, y: 19 },
    } as unknown as Sprite;
    character.costumeSets[0]!.pieces.mid!.sprites = { 6: flat } as never;
    const midNode = Object.values(character.nodes).find((n) => n.slot?.slotKey === 'mid')!;
    (midNode as unknown as { dynamicPatterns: unknown }).dynamicPatterns = [createDynamicInstance('辉光呼吸', {
      ...defaultDynamicParams(), glowEnabled: true, glowMaskSource: 'color', glowPick: '#cc3333', glowHalo: 1, emitEnabled: false,
    }, '辉光')];
    return convertCharacterToRuntimePackage(character, sprites, { frameRate: 12, totalFrames: 10 });
  };
  const A = mk(-60), B = mk(0);
  const pa = A.parts.find((p) => p.key === 'mid')!, pb = B.parts.find((p) => p.key === 'mid')!;
  ok(!!tracksSf(A), 's9 发光件也烘 stackFrames');
  ok(!!pa.glow && !!pb.glow, 's9 发光场双份都在');
  const dx = pa.sprite!.plug[0] - pb.sprite!.plug[0], dy = pa.sprite!.plug[1] - pb.sprite!.plug[1];
  ok(!!pa.glow && !!pb.glow && pa.glow.padX === pb.glow.padX - dx && pa.glow.padY === pb.glow.padY - dy,
    `s9 场 pad 按垫量反向补偿 A=(${pa.glow?.padX},${pa.glow?.padY}) B=(${pb.glow?.padX},${pb.glow?.padY}) d=(${dx},${dy})`);
}

// ---------- 10：摞 marks 不再排除，显示 marks 换算、摞本体不动 ----------
{
  const { packMaskBits, unpackMaskBits } = await import('../src/lib/sprite-marks');
  const mk = (tilt: number) => {
    const { character, sprites, stack } = build(tilt);
    const cells = new Uint8Array(5 * 4); cells[1 * 5 + 1] = 1; cells[2 * 5 + 3] = 1;
    stack.marks = [
      { id: 'm1', name: 'pt', kind: 'point', x: 0.5, y: 0.25 },
      { id: 'm2', name: 'vc', kind: 'vector', x: 0.5, y: 0.5, dx: 0.25, dy: 0.125 },
      { id: 'm3', name: 'rc', kind: 'region', region: { by: 'rect', x: 0.25, y: 0.25, w: 0.5, h: 0.5 } },
      { id: 'm4', name: 'ci', kind: 'region', region: { by: 'circle', cx: 0.5, cy: 0.5, r: 0.25 } },
      { id: 'm5', name: 'pn', kind: 'region', region: { by: 'painted', mask: { w: 5, h: 4, bits: packMaskBits(cells) } } },
      { id: 'm6', name: 'vl', kind: 'value', value: 7 },
    ] as never;
    return convertCharacterToRuntimePackage(character, sprites, { frameRate: 12, totalFrames: 10 });
  };
  const A = mk(60), B = mk(0);
  const pa = A.parts.find((p) => p.key === 'mid')!, pb = B.parts.find((p) => p.key === 'mid')!;
  ok(!!tracksSf(A), 's10 带 marks 件也烘 stackFrames');
  const Wb = pb.sprite!.w, Hb = pb.sprite!.h, Wa = pa.sprite!.w, Ha = pa.sprite!.h;
  const dx = pa.sprite!.plug[0] - pb.sprite!.plug[0], dy = pa.sprite!.plug[1] - pb.sprite!.plug[1];
  const ma = new Map((pa.sprite!.marks ?? []).map((m) => [m.name, m]));
  const pt = ma.get('pt') as unknown as { x: number; y: number };
  ok(Math.abs(pt.x - (0.5 * Wb + dx) / Wa) < 1e-9 && Math.abs(pt.y - (0.25 * Hb + dy) / Ha) < 1e-9, `s10 点标记换算 ${JSON.stringify(pt)}`);
  const vc = ma.get('vc') as unknown as { x: number; y: number; dx: number; dy: number };
  ok(Math.abs(vc.x - (0.5 * Wb + dx) / Wa) < 1e-9 && Math.abs(vc.dx - 0.25 * Wb / Wa) < 1e-9 && Math.abs(vc.dy - 0.125 * Hb / Ha) < 1e-9, `s10 矢量换算 ${JSON.stringify(vc)}`);
  const rc = (ma.get('rc') as unknown as { region: { x: number; y: number; w: number; h: number } }).region;
  ok(Math.abs(rc.x - (0.25 * Wb + dx) / Wa) < 1e-9 && Math.abs(rc.w - 0.5 * Wb / Wa) < 1e-9 && Math.abs(rc.h - 0.5 * Hb / Ha) < 1e-9, `s10 矩形选区换算 ${JSON.stringify(rc)}`);
  const ci = (ma.get('ci') as unknown as { region: { by: string; mask?: { w: number; h: number } } }).region;
  ok(ci.by === 'painted' && ci.mask?.w === Wa && ci.mask?.h === Ha, 's10 圆形选区烘成涂画（各向异性垫图保逐格一致）');
  const pn = (ma.get('pn') as unknown as { region: { mask: { w: number; h: number; bits: string } } }).region.mask;
  const pc = unpackMaskBits(pn.bits, pn.w * pn.h);
  let ones = 0; pc.forEach((v) => { if (v) ones++; });
  ok(pn.w === Wa && pn.h === Ha && ones === 2 && pc[(1 + dy) * Wa + (1 + dx)] === 1 && pc[(2 + dy) * Wa + (3 + dx)] === 1,
    `s10 涂画选区随图平移 ones=${ones} d=(${dx},${dy})`);
  ok((ma.get('vl') as unknown as { value: number }).value === 7
    && JSON.stringify(pa.stack?.marks) === JSON.stringify(pb.stack?.marks)
    && (pa.stack?.marks?.[0] as unknown as { x: number }).x === 0.5, 's10 值标记原样、摞本体 marks 不动');
}

// ---------- 11：裁剪锚件不再排除，平面常量 c 按内容位移补偿 ----------
{
  const mk = (tilt: number) => {
    const { character, sprites, midId } = build(tilt);
    const endNode = Object.values(character.nodes).find((n) => n.slot?.slotKey === 'end')!;
    (endNode as unknown as { clipPlane: unknown }).clipPlane = { anchor: midId, angleDeg: 90, offset: 3 };
    return convertCharacterToRuntimePackage(character, sprites, { frameRate: 12, totalFrames: 10 });
  };
  const A = mk(-60), B = mk(0);
  const midA = A.parts.find((p) => p.key === 'mid')!, midB = B.parts.find((p) => p.key === 'mid')!;
  const clipA = A.parts.find((p) => p.key === 'end')!.clip!, clipB = B.parts.find((p) => p.key === 'end')!.clip!;
  ok(clipB.by === 'mid' && clipB.c === -3, `s11 无垫图时 c=-offset ${JSON.stringify(clipB)}`);
  ok(!!tracksSf(A), 's11 锚件（mid）也烘 stackFrames');
  const dx = midA.sprite!.plug[0] - midB.sprite!.plug[0], dy = midA.sprite!.plug[1] - midB.sprite!.plug[1];
  const sx = dx - (midA.sprite!.w - midB.sprite!.w) / 2, sy = dy - (midA.sprite!.h - midB.sprite!.h) / 2;
  const expected = -3 - (clipA.a * sx + clipA.b * sy);
  ok(Math.abs(clipA.c - expected) < 1e-9, `s11 垫图后 c 补偿 c=${clipA.c} expected=${expected} s=(${sx},${sy})`);
}

console.log(fails === 0 ? 'STACK FRAMES PROBE PASS' : `STACK FRAMES PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
