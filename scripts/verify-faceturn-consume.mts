// ============================================================
// 转面簇探针（审计 F-07/F-11 修复回归网）
//  1) F-07 主渲染消费转面轨：走 generateRenderPlan 真路径，节点带
//     faceTurnKeys（f0/f10 两键）时，中间帧指令 faceTurn 须为插值
//     值、与 node.faceTurn 静态值有差；端点帧取键值、区间外钳端点
//     （与辅助插值路径 bracketPoint 同口径）；无轨时回落静态值。
//  2) 同口径：generateRenderPlan 指令 faceTurn 与辅助路径
//     interpolateNodeKeyframes 的合并结果（轨优先）逐值一致。
//  3) F-11 进包点名：node.faceTurn 非零 / 转面轨非零 / 转面配置
//     （facingAngle 存量，含 enabled=false 情形）/ 蒙皮快照，
//     convert 各点名「只在编辑器生效，未进包」；零值/无配置/
//     无朝向角的角色不点名（正反各验）。
//  4) 源码接线断言：unified-render 指令构建处读插值函数、旧
//     TODO（当前用 node 静态值）已摘除。
//
// 还原自查：把 unified-render 指令构建处 faceTurn 的 effective
// 改回 node.faceTurn（删轨优先一行），第 1 节中间帧断言应转红；
// 把 convert 点名块删掉，第 3 节正例应转红。
// ============================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRenderPlan } from '../src/lib/unified-render';
import { getInterpolatedTrackFaceTurn, interpolateNodeKeyframes } from '../src/lib/engine/render-helpers/puppet-keyframe-interpolation';
import { createDefaultCharacter } from '../src/lib/unified-types';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const ftEq = (ft: { yaw: number; pitch: number } | undefined, yaw: number, pitch: number) =>
  !!ft && near(ft.yaw, yaw) && near(ft.pitch, pitch);

// ---------- 1) 主渲染消费转面轨（generateRenderPlan 真路径） ----------
const sp = (id: string): any => ({ id, width: 2, height: 2, data: [[id]] });
const spriteTable: Record<string, any> = { sprA: sp('sprA') };
const STATIC_FT = { yaw: 0.2, pitch: -0.2 };
const KEYS = [
  { frame: 0, value: { yaw: -0.6, pitch: 0 } },
  { frame: 10, value: { yaw: 0.6, pitch: 0.6 } },
];
function mkChar(withTrack: boolean, withStatic: boolean): any {
  return {
    id: 'char1', name: 'T', rootNodeId: 'n1',
    nodes: {
      n1: {
        id: 'n1', name: 'n1', parentId: null, children: [],
        transform: { x: 0, y: 0, z: 0, angle: 0, stretch: 1, variantIndex: 6 },
        tracks: withTrack ? { faceTurnKeys: { keyframes: KEYS, interpolation: 'linear' } } : {},
        modifiers: [], sockets: [],
        attachment: { type: 'root' },
        slot: { slotKey: 'arm' },
        ...(withStatic ? { faceTurn: { ...STATIC_FT } } : {}),
        drawLayer: 'default', visible: true,
      },
    },
    costumeSets: [
      { id: 'csA', name: 'A', pieces: { arm: { slotKey: 'arm', fillColor: '#888', sprites: { 6: { spriteId: 'sprA' } }, scaleVariants: {}, mirrorMap: {}, crossSections: [] } } },
    ],
    activeCostumeSetId: 'csA',
    directionDrawOrders: {}, latitude: 0, sprites: {},
    createdAt: 0, updatedAt: 0,
  };
}
function planFt(ch: any, frame: number) {
  const plan = generateRenderPlan(ch, frame, 256, 256, 'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, spriteTable);
  return plan.nodeInstructions.find((i: any) => i.nodeId === 'n1')?.faceTurn as
    { yaw: number; pitch: number } | undefined;
}
{
  const ch = mkChar(true, true);
  check('1a f0 取键值 {-0.6, 0}', ftEq(planFt(ch, 0), -0.6, 0), JSON.stringify(planFt(ch, 0)));
  check('1b f5 两键之间取插值 {0, 0.3}', ftEq(planFt(ch, 5), 0, 0.3), JSON.stringify(planFt(ch, 5)));
  check('1c f5 插值与静态值 {0.2,-0.2} 有差（轨已生效）', !ftEq(planFt(ch, 5), STATIC_FT.yaw, STATIC_FT.pitch));
  check('1d f10 取键值 {0.6, 0.6}', ftEq(planFt(ch, 10), 0.6, 0.6), JSON.stringify(planFt(ch, 10)));
  check('1e f20 区间外钳端点 {0.6, 0.6}（bracketPoint 同口径）', ftEq(planFt(ch, 20), 0.6, 0.6), JSON.stringify(planFt(ch, 20)));

  const noTrack = mkChar(false, true);
  check('1f 无轨 f0 回落静态值', ftEq(planFt(noTrack, 0), STATIC_FT.yaw, STATIC_FT.pitch), JSON.stringify(planFt(noTrack, 0)));
  check('1g 无轨 f5 回落静态值', ftEq(planFt(noTrack, 5), STATIC_FT.yaw, STATIC_FT.pitch), JSON.stringify(planFt(noTrack, 5)));

  const trackOnly = mkChar(true, false);
  check('1h 只有轨（无静态值）f5 取插值 {0, 0.3}', ftEq(planFt(trackOnly, 5), 0, 0.3), JSON.stringify(planFt(trackOnly, 5)));
  check('1i 插值函数直读同值（同函数复用）', ftEq(getInterpolatedTrackFaceTurn(mkChar(true, true).nodes.n1, 5), 0, 0.3));
}

// ---------- 2) 与辅助插值路径同口径 ----------
{
  const ch = mkChar(true, true);
  const aux = interpolateNodeKeyframes(ch, 5, 12).get('n1')?.faceTurn;
  const main = planFt(ch, 5);
  check('2a 辅助路径 f5 合并值 = {0, 0.3}', ftEq(aux, 0, 0.3), JSON.stringify(aux));
  check('2b 主渲染与辅助路径逐值一致', !!main && !!aux && near(main.yaw, aux.yaw) && near(main.pitch, aux.pitch),
    `main=${JSON.stringify(main)} aux=${JSON.stringify(aux)}`);
}

// ---------- 3) convert 进包点名 ----------
function warnOf(ch: any): string[] {
  return convertCharacterToRuntimePackage(ch).warnings;
}
const hasTurnWarn = (ws: string[], item: string) =>
  ws.some((w) => w.includes('未进包') && w.includes('转面数据') && w.includes(item));
{
  const a = createDefaultCharacter('a', '甲');
  a.nodes[a.rootNodeId]!.faceTurn = { yaw: 0.5, pitch: 0 };
  check('3a 节点转面非零 → 点名（节点转面）', hasTurnWarn(warnOf(a), '节点转面'), warnOf(a).join(' | '));

  const b = createDefaultCharacter('b', '乙');
  b.nodes[b.rootNodeId]!.tracks = {
    faceTurnKeys: { keyframes: [{ frame: 3, value: { yaw: 0, pitch: 0.4 } }], interpolation: 'linear' },
  } as never;
  check('3b 转面轨非零 → 点名（转面轨）', hasTurnWarn(warnOf(b), '转面轨'), warnOf(b).join(' | '));

  const c = createDefaultCharacter('c', '丙');
  c.faceTurnConfig = { enabled: false, singleImageMode: false };
  c.facingAngle = 90;
  check('3c 转面配置 enabled=false + facingAngle 存量 → 点名（转面配置）', hasTurnWarn(warnOf(c), '转面配置'), warnOf(c).join(' | '));

  const c2 = createDefaultCharacter('c2', '丙二');
  c2.faceTurnConfig = { enabled: true, singleImageMode: true };
  c2.facingAngle = 45;
  check('3d 转面配置 enabled=true + facingAngle → 点名（转面配置）', hasTurnWarn(warnOf(c2), '转面配置'), warnOf(c2).join(' | '));

  const d = createDefaultCharacter('d', '丁');
  d.nodes[d.rootNodeId]!.attachment.skinningSnapshot = { dummy: true } as never;
  check('3e 蒙皮快照 → 点名（蒙皮快照弯曲）',
    warnOf(d).some((w) => w.includes('未进包') && w.includes('蒙皮快照弯曲')), warnOf(d).join(' | '));

  const e = createDefaultCharacter('e', '戊');
  e.nodes[e.rootNodeId]!.faceTurn = { yaw: 0, pitch: 0 };
  e.faceTurnConfig = { enabled: true, singleImageMode: false };
  const eWarns = warnOf(e);
  check('3f 零值转面 + 配置无朝向角 → 不点名转面', !eWarns.some((w) => w.includes('转面数据')), eWarns.join(' | '));
  check('3g 无快照 → 不点名蒙皮快照', !eWarns.some((w) => w.includes('蒙皮快照')));

  const f = createDefaultCharacter('f', '己');
  const fWarns = warnOf(f);
  check('3h 素角色 → 转面/快照皆不点名',
    !fWarns.some((w) => w.includes('转面数据')) && !fWarns.some((w) => w.includes('蒙皮快照')), fWarns.join(' | '));
}

// ---------- 4) 源码接线断言 ----------
{
  const ur = readFileSync(join(root, 'src/lib/unified-render.ts'), 'utf8');
  check('4a unified-render 指令构建读转面轨插值', ur.includes('getInterpolatedTrackFaceTurn(node, frame)'));
  check('4b 旧 TODO（当前用 node 静态值）已摘除', !ur.includes('当前用 node 静态值'));
  const conv = readFileSync(join(root, 'src/lib/proc-runtime/convert.ts'), 'utf8');
  check('4c convert 含转面/快照点名', conv.includes('含转面数据') && conv.includes('含蒙皮快照弯曲'));
}

console.log(`\nverify-faceturn-consume: ${passed} 过 / ${failed} 败`);
if (failed > 0) process.exit(1);
