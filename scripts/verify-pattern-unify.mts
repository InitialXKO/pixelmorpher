// 图案↔蓝图统一（甲案）校验：
// 1) 实例↔dynamic_pattern 节点无损往返（含对象参数/库引用/覆盖）
// 2) syncPatternNodes 手术式（保留他人节点与本节点接线、删孤儿）
// 3) 生效图解析 ≡ 旧双挂载解析（差分）
// 4) 接线覆盖：const 接 glowStrength 生效、gate=0 本帧关闭（真求值）
// 5) 追随读蓝图：源部件靠修改器/蓝图摆动（无轨道）也能带动追随；
//    源无蓝图时无增量（与旧剥离口径差分）
// 6) 进包差分：只有列表 vs 只有图节点 → 包内 dyn 一致
import { createDefaultNode, createDefaultCostumePiece, pxToSub, type Character, type Sprite } from '../src/lib/unified-types';
import {
  patternNodeForInstance, instanceFromPatternNode, syncPatternNodes,
  effectivePatternGraph, resolveGraphPatterns, dynNodeId, DYNAMIC_PATTERN_NODE_TYPE,
} from '../src/lib/blueprint/pattern-sync';
import { defaultDynamicParams, resolveDynamicPatterns, encodeGlowMask, type DynamicPatternInstance } from '../src/lib/dynamic-patterns';
import { evaluateNodeOutput } from '../src/lib/blueprint/eval';
import { generateRenderPlan } from '../src/lib/unified-render';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';


let fails = 0;
const ok = (cond: boolean, label: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};

const kernel = encodeGlowMask([[false, true, false], [true, true, true], [false, true, false]]);
const fullInst: DynamicPatternInstance = {
  id: 'inst-abcdef-123456', slot: '环境效果', enabled: true, templateName: '辉光呼吸',
  patternRef: { id: 'lib-glow', version: 3 },
  overrides: { glowHz: 2 },
  params: {
    ...defaultDynamicParams(),
    glowEnabled: true, glowShape: 'custom', glowShapeKernel: kernel,
    glowMask: kernel, glowColor: '#7dd7ff', emitEnabled: true, rate: 12,
  },
};

// ---------- 1. 往返无损 ----------
{
  const node = patternNodeForInstance(fullInst, { mount: 'piece', setId: 'cs9' });
  const back = instanceFromPatternNode(node);
  ok(!!back && back.mount.mount === 'piece' && back.mount.setId === 'cs9', '往返：挂载口径保留');
  ok(back?.inst.id === fullInst.id && back?.inst.slot === fullInst.slot && back?.inst.templateName === '辉光呼吸', '往返：id/效果位/模板名');
  ok(back?.inst.patternRef?.id === 'lib-glow' && back?.inst.patternRef?.version === 3, '往返：库引用');
  ok((back?.inst.overrides as { glowHz?: number })?.glowHz === 2, '往返：覆盖');
  ok(JSON.stringify(back?.inst.params.glowShapeKernel) === JSON.stringify(kernel)
    && JSON.stringify(back?.inst.params.glowMask) === JSON.stringify(kernel), '往返：对象参数（自绘印章/手绘选区）无损');
  ok(back?.inst.params.glowColor === '#7dd7ff' && back?.inst.params.rate === 12, '往返：标量参数');
}

// ---------- 2. 手术式同步 ----------
{
  const handNode = { id: 'sin1', type: 'sin', inputs: { x: { nodeId: 'time1' } }, params: { amplitude: 1 } } as never;
  const graph = {
    version: 1, outputId: 'screen1',
    nodes: [
      { id: 'time1', type: 'time', inputs: {}, params: {} },
      handNode,
      { id: 'screen1', type: 'screen', inputs: {}, params: {} },
    ],
  } as never;
  const synced = syncPatternNodes(graph, [{ inst: fullInst, mount: { mount: 'node' } }]);
  const dyn = synced.nodes.find((n) => n.id === dynNodeId(fullInst.id));
  ok(!!dyn && dyn.type === DYNAMIC_PATTERN_NODE_TYPE, '同步：dyn 节点插入');
  ok(synced.nodes.find((n) => n.id === 'sin1') === (handNode as unknown), '同步：他人节点原样（同引用）');
  // 给 dyn 节点接一条线后再同步（参数变更）→ 接线与 ui 保留、params 更新
  const wired = {
    ...synced,
    nodes: synced.nodes.map((n) => n.id === dyn!.id
      ? { ...n, inputs: { glowStrength: { nodeId: 'sin1', output: 'out' } }, ui: { x: 7, y: 9 } }
      : n),
  } as never;
  const changed = { ...fullInst, params: { ...fullInst.params, rate: 99 } };
  const resynced = syncPatternNodes(wired, [{ inst: changed, mount: { mount: 'node' } }]);
  const dyn2 = resynced.nodes.find((n) => n.id === dynNodeId(fullInst.id))!;
  ok(dyn2.params.rate === 99 && (dyn2.inputs as never)['glowStrength'] !== undefined && dyn2.ui?.x === 7, '同步：更新 params、保留接线与布局');
  const removed = syncPatternNodes(resynced, []);
  ok(!removed.nodes.some((n) => n.type === DYNAMIC_PATTERN_NODE_TYPE) && removed.nodes.length === 3, '同步：实例删除 → dyn 节点删除，其余不动');
}

// ---------- 3+4. 生效图解析差分 + 接线覆盖 ----------
const spr: Sprite = {
  id: 'spr_x', name: 'x', width: 6, height: 6,
  data: Array.from({ length: 6 }, () => Array(6).fill('#cc3333')), plug: { x: 3, y: 3 },
} as unknown as Sprite;
function mkChar(): Character {
  const root = createDefaultNode('root', 'root'); root.id = 'u_root';
  const mid = createDefaultNode('mid', 'mid'); mid.id = 'u_mid'; mid.parentId = root.id;
  mid.slot = { slotKey: 'mid' } as never;
  root.children = [mid.id];
  root.sockets = [{ id: 'sock_m', name: 'mid', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: 0, y: 0, z: 0 } }];
  mid.attachment = { type: 'socket', parentSocketId: 'sock_m' } as never;
  (mid.transform as unknown as { variantIndex: number }).variantIndex = 6;
  (root.transform as unknown as { variantIndex: number }).variantIndex = 6;
  const piece = createDefaultCostumePiece('mid');
  piece.sprites = { 6: spr } as never;
  const character = {
    id: 'u', name: '统一测试', nodes: { [root.id]: root, [mid.id]: mid }, rootNodeId: root.id,
    sprites: {}, costumeSets: [{ id: 'cs1', name: '默认', pieces: { mid: piece } }],
    activeCostumeSetId: 'cs1', direction: 6, latitude: 0,
  } as unknown as Character;
  return character;
}
{
  const ch = mkChar();
  const nodeInst: DynamicPatternInstance = {
    id: 'n1', slot: '发光', enabled: true,
    params: { ...defaultDynamicParams(), glowEnabled: true, glowStrength: 1 },
  };
  const pieceInst: DynamicPatternInstance = {
    id: 'p1', slot: '环境效果', enabled: true,
    params: { ...defaultDynamicParams(), emitEnabled: true, rate: 5 },
  };
  const mid = ch.nodes['u_mid']!;
  mid.dynamicPatterns = [nodeInst];
  ch.costumeSets[0]!.pieces['mid']!.dynamicPatterns = [pieceInst];
  const legacy = resolveDynamicPatterns([nodeInst], [pieceInst]);
  const viaGraph = resolveGraphPatterns(ch, mid as never, 'cs1');
  ok(viaGraph.length === legacy.length
    && JSON.stringify(viaGraph.map((r) => r.instance.params)) === JSON.stringify(legacy.map((r) => r.instance.params)),
    '解析差分：图解析与旧双挂载解析逐参数一致');
  // 件挂载压制：件侧同效果位禁用实例 → 节点侧同位被压制
  const suppress: DynamicPatternInstance = { id: 'p2', slot: '发光', enabled: false, params: defaultDynamicParams() };
  ch.costumeSets[0]!.pieces['mid']!.dynamicPatterns = [pieceInst, suppress];
  const viaGraph2 = resolveGraphPatterns(ch, mid as never, 'cs1');
  ok(!viaGraph2.some((r) => r.instance.params.glowEnabled), '解析差分：件挂载禁用同位 → 压制节点挂载（图口径一致）');

  // 接线覆盖：图里 const(2.5) 接进 dyn.glowStrength、const(0) 接 gate
  const graph = effectivePatternGraph(ch, mid as never)!;
  const dynId = dynNodeId('n1');
  const wiredGraph = {
    ...graph,
    nodes: [
      ...graph.nodes,
      { id: 'c_gs', type: 'const', inputs: {}, params: { value: 2.5 } },
      { id: 'c_gate', type: 'const', inputs: {}, params: { value: 0 } },
    ].map((n) => n.id === dynId
      ? { ...n, inputs: { glowStrength: { nodeId: 'c_gs', output: 'out' }, gate: { nodeId: 'c_gate', output: 'out' } } }
      : n),
  } as never;
  const { extractPatternInstances } = await import('../src/lib/blueprint/pattern-sync');
  const evalCb = (srcId: string) => evaluateNodeOutput(wiredGraph as never, srcId, {
    frame: 0, frameRate: 12, vars: {}, costumes: ch.costumeSets, costumeSlot: 'mid',
  } as never) as Record<string, unknown> | null;
  const { nodeList } = extractPatternInstances(wiredGraph as never, evalCb);
  const glow = nodeList.find((i) => i.id === 'n1');
  ok(glow?.params.glowStrength === 2.5, `接线覆盖：glowStrength 被 const 驱动（实得 ${glow?.params.glowStrength}）`);
  ok(glow?.enabled === false, '接线覆盖：gate=0 → 本次提取视作关闭');
}

// ---------- 5. 追随读蓝图 ----------
{
  const buildFollow = (withPendulum: boolean) => {
    const ch = mkChar();
    const src = createDefaultNode('src', 'src'); src.id = 'u_src'; src.parentId = 'u_root';
    src.slot = { slotKey: 'src' } as never;
    (src.transform as unknown as { variantIndex: number }).variantIndex = 6;
    const fol = createDefaultNode('fol', 'fol'); fol.id = 'u_fol'; fol.parentId = 'u_root';
    fol.slot = { slotKey: 'fol' } as never;
    (fol.transform as unknown as { variantIndex: number }).variantIndex = 6;
    const root = ch.nodes['u_root']!;
    root.children = ['u_mid', 'u_src', 'u_fol'];
    root.sockets = [
      { id: 'sock_m', name: 'mid', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: 0, y: 0, z: 0 } },
      { id: 'sock_s', name: 'src', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: pxToSub(30), y: 0, z: 0 } },
      { id: 'sock_f', name: 'fol', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: pxToSub(-30), y: 0, z: 0 } },
    ];
    src.attachment = { type: 'socket', parentSocketId: 'sock_s' } as never;
    fol.attachment = { type: 'socket', parentSocketId: 'sock_f' } as never;
    ch.nodes['u_src'] = src; ch.nodes['u_fol'] = fol;
    if (withPendulum) {
      (src as unknown as { modifiers: unknown }).modifiers = [
        { id: 'm1', type: 'pendulum', enabled: true, params: { period: 2, amplitude: 40 } },
      ];
    }
    fol.dynamicPatterns = [{
      id: 'f1', slot: '形变', enabled: true,
      params: {
        ...defaultDynamicParams(), emitEnabled: false,
        followEnabled: true, followSource: 'src', followDelaySec: 0.25, followAmount: 1, followRotate: true,
      },
    }];
    const pieceSrc = createDefaultCostumePiece('src'); pieceSrc.sprites = { 6: spr } as never;
    const pieceFol = createDefaultCostumePiece('fol'); pieceFol.sprites = { 6: spr } as never;
    ch.costumeSets[0]!.pieces['src'] = pieceSrc;
    ch.costumeSets[0]!.pieces['fol'] = pieceFol;
    return ch;
  };
  const angleAt = (ch: Character, frame: number) => {
    const plan = generateRenderPlan(ch, frame, 256, 256, 'pixel-perfect', 12) as never as {
      nodeInstructions: { nodeId: string; angle: number }[];
    };
    return plan.nodeInstructions.find((i) => i.nodeId === 'u_fol')?.angle;
  };
  const withBp = angleAt(buildFollow(true), 6);
  const without = angleAt(buildFollow(false), 6);
  ok(withBp !== undefined && without !== undefined && Math.abs((withBp ?? 0) - (without ?? 0)) > 0.5,
    `追随读蓝图：蓝图摆动带动追随角（有蓝图 ${withBp?.toFixed(2)}° vs 无蓝图 ${without?.toFixed(2)}°）`);
}

// ---------- 6. 进包差分：列表 vs 图节点 ----------
{
  const inst: DynamicPatternInstance = {
    id: 'g1', slot: '发光', enabled: true,
    params: {
      ...defaultDynamicParams(), emitEnabled: false,
      glowEnabled: true, glowMaskSource: 'color', glowPick: '#cc3333', glowHalo: 1,
    },
  };
  const chList = mkChar();
  chList.nodes['u_mid']!.dynamicPatterns = [inst];
  const pkgList = convertCharacterToRuntimePackage(chList, {}, { frameRate: 12, totalFrames: 4 });
  const chGraph = mkChar();
  const midG = chGraph.nodes['u_mid']!;
  const bp = {
    version: 1, outputId: 'gscr',
    nodes: [
      { id: 'gt', type: 'time', inputs: {}, params: {} },
      { id: 'gsrc', type: 'sprite_source', inputs: {}, params: {} },
      patternNodeForInstance(inst, { mount: 'node' }),
      { id: 'gscr', type: 'screen', inputs: { pixels: { nodeId: 'gsrc', output: 'pixels' } }, params: {} },
    ],
  };
  (midG as unknown as { blueprint: unknown }).blueprint = bp;
  const pkgGraph = convertCharacterToRuntimePackage(chGraph, {}, { frameRate: 12, totalFrames: 4 });
  const dynList = pkgList.parts.find((p) => p.key === 'mid')?.dynamic;
  const dynGraph = pkgGraph.parts.find((p) => p.key === 'mid')?.dynamic;
  if (JSON.stringify(dynList) !== JSON.stringify(dynGraph)) {
    const walk = (x: unknown, y: unknown, path: string) => {
      if (JSON.stringify(x) === JSON.stringify(y)) return;
      if (x && y && typeof x === 'object' && typeof y === 'object') {
        for (const k of new Set([...Object.keys(x as object), ...Object.keys(y as object)])) walk((x as never)[k], (y as never)[k], `${path}.${k}`);
      } else console.log('  DIFF', path, 'list=', JSON.stringify(x), 'graph=', JSON.stringify(y));
    };
    walk(dynList, dynGraph, '$');
  }
  ok(!!dynList && JSON.stringify(dynList) === JSON.stringify(dynGraph), '进包差分：列表挂载与图节点挂载产出同一 dyn');
  ok(!!pkgGraph.parts.find((p) => p.key === 'mid')?.glow, '进包差分：图节点挂载的发光场照常进包');
}

console.log(fails === 0 ? 'PATTERN UNIFY PROBE PASS' : `PATTERN UNIFY PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
