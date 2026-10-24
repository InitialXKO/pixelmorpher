// 父级切换（抓握重挂）校验：有效父级解析 / FK 跟随 / 切換位姿守恒 /
// 环回退 / convert 世界曲线自动接上。
import assert from 'node:assert/strict';
import type { Character, UnifiedNode } from '../src/lib/unified-types';
import { pxToSub, subToPx } from '../src/lib/unified-types';
import { createDefaultCostumePiece } from '../src/lib/unified-types';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import { computeWorldTransforms, parentKeyAt } from '../src/lib/unified-render';
import { planParentSwitch } from '../src/lib/parent-switch';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';

let passed = 0;
function check(name: string, cond: boolean, extra?: string) {
  assert.ok(cond, extra ? `${name} :: ${extra}` : name);
  passed++;
  console.log('✓', name);
}

function node(
  id: string, name: string, parentId: string | undefined,
  x: number, y: number, extra?: Partial<UnifiedNode>,
): UnifiedNode {
  return {
    id, name, parentId,
    role: 'bone',
    slot: undefined,
    transform: { x: pxToSub(x), y: pxToSub(y), angle: 0, variantIndex: 6, stretch: 1 },
    attachment: { type: 'fixed' },
    sockets: [],
    tracks: {},
    modifiers: [],
    children: [],
    ...extra,
  } as unknown as UnifiedNode;
}

/** body(根) ─ belt(+10,0) ─ hilt(+2,+1)；body ─ hand(+30,0, 角度轨 0→90°) */
function fixture(withSwitch: boolean): Character {
  const belt = node('belt', '腰带', 'body', 10, 0);
  const hand = node('hand', '手', 'body', 30, 0, {
    sockets: [{ id: 'grip', name: '握', basePosition: { x: pxToSub(3), y: pxToSub(0) }, directionOffsets: {} } as never],
    tracks: {
      angle: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 12, value: 90 }] },
    },
  });
  const hilt = node('hilt', '剑柄', 'belt', 2, 1, withSwitch
    ? {
        tracks: {
          parentKeys: {
            interpolation: 'linear',
            keyframes: [{ frame: 6, value: { parentId: 'hand', socketId: 'grip' } }],
          },
        },
      }
    : {});
  const body = node('body', '身体', undefined, 0, 0);
  body.children = ['belt', 'hand'];
  belt.children = ['hilt'];
  return {
    id: 'chP', name: '重挂测试',
    nodes: { body, belt, hand, hilt },
    rootNodeId: 'body', rootNodeIds: ['body'],
    costumeSets: [], activeCostumeSetId: '', variants: {},
  } as unknown as Character;
}

const px = (v: number) => subToPx(v as never);

// ---------- A) 父级键采样 ----------
{
  const ch = fixture(true);
  const hilt = ch.nodes.hilt!;
  check('A1 切换帧前无键生效', parentKeyAt(hilt, 5) === undefined);
  check('A2 切换帧起键生效', parentKeyAt(hilt, 6)?.parentId === 'hand');
  check('A3 之后持续生效（step）', parentKeyAt(hilt, 20)?.parentId === 'hand');
}

// ---------- B) FK 跟随 ----------
{
  const ch = fixture(true);
  const t3 = computeWorldTransforms(ch, 3, 0, 0, 12);
  const hilt3 = t3.get('hilt')!;
  check('B1 切换前挂腰带：世界位 = 腰带 + 本地偏移',
    Math.abs(px(hilt3.worldX) - 12) < 0.01 && Math.abs(px(hilt3.worldY) - 1) < 0.01,
    `${px(hilt3.worldX)},${px(hilt3.worldY)}`);
  const t9 = computeWorldTransforms(ch, 9, 0, 0, 12);
  const hilt9 = t9.get('hilt')!;
  const hand9 = t9.get('hand')!;
  const dist = Math.hypot(px(hilt9.worldX) - px(hand9.worldX), px(hilt9.worldY) - px(hand9.worldY));
  check('B2 切换后挂手（插槽 grip+本地偏移）：距手距离 = |(3+2, 0+1)|',
    Math.abs(dist - Math.hypot(5, 1)) < 0.05, `dist=${dist}`);
  check('B3 切换后世界角跟随手（0→90 在第 9 帧 = 67.5°）',
    Math.abs(hilt9.worldAngle - 67.5) < 0.6, `angle=${hilt9.worldAngle}`);
  check('B4 切换前世界角 = 0', Math.abs(t3.get('hilt')!.worldAngle) < 0.01);
}

// ---------- C) 著者操作：切换帧位姿守恒 ----------
{
  const ch = fixture(false);
  const before = computeWorldTransforms(ch, 6, 0, 0, 12).get('hilt')!;
  const plan = planParentSwitch(ch, 'hilt', 6, 'hand', 'grip', 12);
  check('C1 规划生成', !!plan);
  const applied: Character = {
    ...ch,
    nodes: { ...ch.nodes, hilt: { ...ch.nodes.hilt!, tracks: plan!.tracks } },
  };
  const at6 = computeWorldTransforms(applied, 6, 0, 0, 12).get('hilt')!;
  check('C2 切换帧世界位守恒',
    Math.abs(px(at6.worldX) - px(before.worldX)) < 0.05 && Math.abs(px(at6.worldY) - px(before.worldY)) < 0.05,
    `${px(before.worldX)},${px(before.worldY)} -> ${px(at6.worldX)},${px(at6.worldY)}`);
  check('C3 切换帧世界角守恒', Math.abs(at6.worldAngle - before.worldAngle) < 0.5,
    `${before.worldAngle} -> ${at6.worldAngle}`);
  const at10 = computeWorldTransforms(applied, 10, 0, 0, 12);
  const d = Math.hypot(px(at10.get('hilt')!.worldX) - px(at10.get('hand')!.worldX), px(at10.get('hilt')!.worldY) - px(at10.get('hand')!.worldY));
  check('C4 切换后刚性跟随手（距离保持切换帧的相对量）',
    Math.abs(d - Math.hypot(px(before.worldX) - 30, px(before.worldY) - 0)) < 0.4, `d=${d}`);
  check('C5 深度残差为 0（2D 场景）', Math.abs(plan!.zResidualPx) < 0.01);
  check('C6 切到自身后代被拒绝', planParentSwitch(ch, 'belt', 6, 'hilt', null, 12) === null);
}

// ---------- D) 环回退 ----------
{
  const ch = fixture(true);
  const hand = ch.nodes.hand!;
  hand.tracks = {
    ...hand.tracks,
    parentKeys: {
      interpolation: 'linear',
      keyframes: [{ frame: 6, value: { parentId: 'hilt', socketId: null } }],
    },
  };
  const t = computeWorldTransforms(ch, 9, 0, 0, 12);
  check('D1 互挂成环不死循环且两节点都有变换', !!t.get('hilt') && !!t.get('hand'));
}

// ---------- E) convert：世界曲线自动接上 ----------
{
  const ch = fixture(true);
  const app = createDefaultParametricAppearance();
  ch.nodes.belt!.slot = { slotKey: 'belt' } as never;
  ch.nodes.hand!.slot = { slotKey: 'hand' } as never;
  ch.nodes.hilt!.slot = { slotKey: 'hilt' } as never;
  (ch as unknown as { costumeSets: unknown }).costumeSets = [{
    id: 'set1', name: '默认',
    pieces: {
      belt: { ...createDefaultCostumePiece('belt'), parametric: app },
      hand: { ...createDefaultCostumePiece('hand'), parametric: app },
      hilt: { ...createDefaultCostumePiece('hilt'), parametric: app },
    },
  }];
  (ch as unknown as { activeCostumeSetId: string }).activeCostumeSetId = 'set1';
  const clip = {
    id: 'grab', name: '抓剑', puppetCharacterId: 'chP', startFrame: 0, endFrame: 12, loop: false,
  } as never;
  const pkg = convertCharacterToRuntimePackage(ch, undefined, { frameRate: 12, clips: [clip] });
  const seg = pkg.performances.find((p) => (p as { id?: string }).id === 'clip_grab') as unknown as {
    graph: {
      nodes: Array<{
        id: string; type: string; part?: string; points?: [number, number][];
        dxFrom?: { n: string }; dyFrom?: { n: string };
      }>;
    };
  };
  check('E1 段表演生成', !!seg);
  const nodes = seg?.graph.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hiltTr = nodes.find((n) => n.type === 'transform' && n.part === 'hilt');
  const hiltCurves = [hiltTr?.dxFrom?.n, hiltTr?.dyFrom?.n]
    .map((id) => (id ? byId.get(id) : undefined))
    .filter((n) => n?.points);
  const mag = (pts: [number, number][], until: number) =>
    Math.max(0, ...pts.filter(([t]) => t <= until).map(([, v]) => Math.abs(v)));
  let early = 0, late = 0;
  for (const c of hiltCurves) {
    if (!c?.points) continue;
    early = Math.max(early, mag(c.points, 0.3));
    late = Math.max(late, Math.max(0, ...c.points.filter(([t]) => t >= 0.7).map(([, v]) => Math.abs(v))));
  }
  check('E2 剑柄曲线：切换前（窗前段）近静止', early < 0.6, `early=${early}`);
  check('E3 剑柄曲线：切换后跟随手大幅移动', late > 3, `late=${late}`);
}

console.log(`\n父级切换校验全过（${passed} 项）`);
