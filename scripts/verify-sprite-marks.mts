// 精灵标记研究线探针（research/sprite-marks）：解析层 +
// 发射源 'mark' 纵切（编辑器模拟 × 运行时孪生对拍 + 进包）
import {
  normalizeSpriteMarks, findMark, markPointPx, markValue,
  markDirectionDeg, markVectorPx, resolveRegionCells,
} from '../src/lib/sprite-marks';
import { packMaskBits, defaultDynamicParams } from '../src/lib/dynamic-patterns';
import { simulateDynamicParticles } from '../src/lib/dynamic-pattern-sim';
import { createDynamicRuntime } from '../src/lib/proc-runtime/dynamic-src';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { buildRuntimeHtml } from '../src/lib/proc-runtime/runtime-template';
import { pxToSub, createDefaultCostumePiece, type Character } from '../src/lib/unified-types';

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) { console.error(`✗ ${name}`); process.exit(1); }
  passed++;
  console.log(`✓ ${name}`);
}

// ---------- 1) 解析层 ----------
const sprite = {
  width: 20, height: 10,
  data: Array.from({ length: 10 }, () => Array(20).fill('#3366aa')),
  marks: normalizeSpriteMarks([
    { id: 'a', name: '枪口', kind: 'point', x: 0.25, y: 0.5 },
    { id: 'b', name: '硬度', kind: 'value', value: 0.8 },
    { id: 'c', name: '刃向', kind: 'direction', angleDeg: 450 },
    { id: 'd', name: '冲量', kind: 'vector', x: 0.5, y: 0.5, dx: 0.3, dy: 0.4 },
    { id: 'e', name: '', kind: 'point', x: 0, y: 0 },               // 无名丢弃
    { id: 'f', name: '坏点', kind: 'point', x: 2, y: -1 },          // 钳制到 0..1
    { id: 'g', name: '垃圾', kind: 'nope', x: 0, y: 0 },            // 未知种类丢弃
  ]),
} as never;

check('1 规整：无名/未知种类丢弃、坐标钳制、角度归一圈',
  (sprite as { marks: unknown[] }).marks.length === 5
  && markDirectionDeg(sprite, '刃向') === 90
  && markPointPx(sprite, '坏点')!.x === 20 && markPointPx(sprite, '坏点')!.y === 0);
check('2 点/值解析与缺失回落 undefined',
  markPointPx(sprite, '枪口')!.x === 5 && markPointPx(sprite, '枪口')!.y === 5
  && markValue(sprite, '硬度') === 0.8
  && markValue(sprite, '不存在') === undefined
  && findMark(sprite, '枪口', 'value') === undefined);
{
  const v = markVectorPx(sprite, '冲量')!;
  check('3 矢量解析：锚点像素化、分量按宽高换算、角度/长度',
    v.x === 10 && v.y === 5 && v.dx === 6 && v.dy === 4
    && Math.abs(v.length - Math.hypot(6, 4)) < 1e-9
    && Math.abs(v.angleDeg - (Math.atan2(4, 6) * 180) / Math.PI) < 1e-9);
}

// ---------- 2) 选区四形态 ----------
{
  const grid: (string | null)[][] = Array.from({ length: 4 }, (_, y) =>
    Array.from({ length: 8 }, (_, x) => (x < 4 ? '#ff0000' : '#0000ff')));
  const mkSprite = (region: unknown) => ({
    width: 8, height: 4, data: grid,
    marks: [{ id: 'r', name: '区', kind: 'region', region }],
  }) as never;
  const count = (cells: Uint8Array | null) => (cells ? [...cells].reduce((a, b) => a + b, 0) : -1);
  const painted = new Uint8Array(32); painted[0] = 1; painted[9] = 1;
  check('4a 涂画选区：位打包对齐解析',
    count(resolveRegionCells(mkSprite({ by: 'painted', mask: { w: 8, h: 4, bits: packMaskBits(painted) } }), '区', grid)) === 2);
  check('4b 取色选区：精确色选左半、容差放宽不误选对侧',
    count(resolveRegionCells(mkSprite({ by: 'color', color: '#FF0000', tolerance: 0 }), '区', grid)) === 16
    && count(resolveRegionCells(mkSprite({ by: 'color', color: '#ff0000', tolerance: 0.3 }), '区', grid)) === 16);
  check('4c 矩形选区：右半',
    count(resolveRegionCells(mkSprite({ by: 'rect', x: 0.5, y: 0, w: 0.5, h: 1 }), '区', grid)) === 16);
  check('4d 圆形选区：中心圆含内格、不含四角',
    (() => {
      const cells = resolveRegionCells(mkSprite({ by: 'circle', cx: 0.5, cy: 0.5, r: 0.3 }), '区', grid)!;
      return cells[1 * 8 + 3] === 1 && cells[0] === 0 && count(cells) > 0;
    })());
  check('4e 无此选区标记 → null',
    resolveRegionCells(mkSprite({ by: 'rect', x: 0, y: 0, w: 1, h: 1 }), '别的名', grid) === null);
}

// ---------- 3) 发射源 'mark' 纵切：编辑器 × 运行时对拍 ----------
{
  const grid20: (string | null)[][] = Array.from({ length: 20 }, () => Array(20).fill('#3366aa'));
  const spriteM = {
    width: 20, height: 20, data: grid20,
    plug: { x: pxToSub(10), y: pxToSub(10) },
    marks: [{ id: 'm1', name: '枪口', kind: 'point', x: 0.25, y: 0.5 }],
  };
  const params = {
    ...defaultDynamicParams(),
    emitEnabled: true, source: 'mark' as const, emitMark: '枪口',
    rate: 60, life: 10, speed: 0, gravity: 0, spreadDeg: 0,
  };
  const inst = { id: 'dyn_mark_1', slot: '身体', enabled: true, params };
  // 模拟输出为相对 plug 的偏移帧：出生点 = 源点 − plug，两端同帧可逐值对拍
  const prod = simulateDynamicParticles(
    { instance: inst, origin: 'node' } as never, spriteM as never, 30, 60, false, 'back', 'part');
  const prodPlug = simulateDynamicParticles(
    { instance: { ...inst, params: { ...params, source: 'plug' as const } }, origin: 'node' } as never,
    spriteM as never, 30, 60, false, 'back', 'part');
  check('5a 编辑器：mark 源确被使用（与 plug 源结果不同且非空）',
    prod.length > 0 && JSON.stringify(prod) !== JSON.stringify(prodPlug));

  const dyn = createDynamicRuntime() as unknown as {
    dynSimulate: (inst: never, tile: never, f: number, fr: number, layer: string, seed: string) => { x: number; y: number }[];
  };
  const tileData = new Uint32Array(24 * 24).fill(0x3366aa);
  // 瓦片 = 精灵 + 边距 2：plug (10,10)→(12,12)，标记 (5,10)→(7,12)
  const tileM = { w: 24, h: 24, cx: 12, cy: 12, data: tileData, marksN: { '枪口': [7, 12] } };
  const rt = dyn.dynSimulate(
    { id: 'dyn_mark_1', slot: '身体', params } as never, tileM as never, 30, 60, 'back', 'part');
  check('5b 运行时与编辑器逐值一致（相对 plug 帧，标记位已含边距换算）',
    rt.length === prod.length && JSON.stringify(rt) === JSON.stringify(prod));

  const paramsMissing = { ...params, emitMark: '不存在' };
  const prodFb = simulateDynamicParticles(
    { instance: { ...inst, params: paramsMissing }, origin: 'node' } as never,
    spriteM as never, 30, 60, false, 'back', 'part');
  const rtFb = dyn.dynSimulate(
    { id: 'dyn_mark_1', slot: '身体', params: paramsMissing } as never, tileM as never, 30, 60, 'back', 'part');
  check('5c 标记缺失：两端同回落 plug 点（与 plug 源逐值一致）',
    JSON.stringify(prodFb) === JSON.stringify(prodPlug)
    && JSON.stringify(rtFb) === JSON.stringify(prodFb));
}

// ---------- 4) 进包透传 ----------
{
  const grid5: (string | null)[][] = Array.from({ length: 5 }, () => Array(5).fill('#aa5533'));
  const sprite5 = {
    width: 5, height: 5, data: grid5, plug: { x: pxToSub(2), y: pxToSub(4) },
    marks: [{ id: 'm1', name: '尖', kind: 'point', x: 1, y: 0 }],
  };
  const piece = createDefaultCostumePiece('torso');
  (piece.sprites as Record<number, unknown>)[2] = sprite5;
  const mkNode = (id: string) => ({
    id, name: id, role: 'bone', transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' }, sockets: [], tracks: {}, modifiers: [], children: [],
    slot: { slotKey: 'torso' },
  });
  const ch = {
    id: 'chMarks', name: '标记', nodes: { torso: mkNode('torso') }, rootNodeIds: ['torso'],
    costumeSets: [{ id: 'set1', name: '默认', pieces: { torso: piece } }],
    activeCostumeSetId: 'set1', variants: {},
  } as unknown as Character;
  const pkg = convertCharacterToRuntimePackage(ch);
  const part = pkg.parts.find((p) => p.key === 'torso');
  check('6 标记随精灵进包（part.sprite.marks 透传）',
    part?.sprite?.marks?.length === 1 && part.sprite.marks[0].name === '尖');
  const html = buildRuntimeHtml(pkg);
  check('7 导出运行时含 marksN 挂载（条目 [10] + 帧循环浅并 tile）',
    html.includes('marksN: entries[i][10]') && html.includes('marksN: a.marksN'));
}

console.log(`\n精灵标记探针全过（${passed} 项）`);
