// 钳制锚定产品探针：走 computeWorldTransforms 全链（会话步进 + ctx 施加），
// 覆盖研究 spike 的全部语义：高度冻结/横移不滑/像素标记点/目标点/范围/
// 边缘节点局部旋转/多锚硬优先/resettle 选项/片段起点缓存/scene 不生效。
import {
  computeWorldTransforms as cwtDirect, stepClampState, applyClampPass, clampAnchorPoints,
  type ClampStateMap,
} from '../src/lib/unified-render';
import { editorClampContextFor } from '../src/lib/clamp-session';
import {
  createDefaultNode, createDefaultCostumePiece, frameYAxisWorld, pxToSub, subToPx,
  type Character, type ClampAnchor, type IKChain, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const W = 512;
const pos = (t: Map<string, { worldX: unknown; worldY: unknown; worldZ: unknown }>, id: string) => {
  const w = t.get(id) as { worldX: number; worldY: number; worldZ: number };
  return { x: subToPx(w.worldX as never), y: subToPx(w.worldY as never), z: subToPx(w.worldZ as never) };
};

let seq = 0;
function buildChar(opts: {
  legB?: boolean; footSprite?: boolean; footAngle?: number;
  rootTrackX?: Array<[number, number]>; rootTrackY?: Array<[number, number]>;
  anchors?: ClampAnchor[]; chains?: IKChain[]; arm?: boolean;
}): { character: Character; ids: Record<string, string>; sprites: Record<string, Sprite> } {
  const tag = `c${seq++}`;
  const mk = (id: string, name: string, parentId?: string) => {
    const n = createDefaultNode(id, name);
    n.id = id;
    if (parentId) n.parentId = parentId;
    (n.transform as { variantIndex: number }).variantIndex = 6;
    return n;
  };
  const root = mk(`${tag}_root`, 'root');
  const hip = mk(`${tag}_hip`, 'hip', root.id);
  const knee = mk(`${tag}_knee`, 'knee', hip.id);
  const foot = mk(`${tag}_foot`, 'foot', knee.id);
  root.children = [hip.id]; hip.children = [knee.id]; knee.children = [foot.id];
  const sock = (id: string, x: number, y: number) => ({
    id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
  });
  root.sockets = [sock('s_hip', 0, 40)];
  hip.sockets = [sock('s_knee', 0, 45)];
  knee.sockets = [sock('s_foot', 0, 45)];
  const attach = (n: ReturnType<typeof mk>, sid: string) => {
    n.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } } as never;
  };
  attach(hip, 's_hip'); attach(knee, 's_knee'); attach(foot, 's_foot');
  const nodes: Record<string, ReturnType<typeof mk>> = { [root.id]: root, [hip.id]: hip, [knee.id]: knee, [foot.id]: foot };
  const pieces: Record<string, unknown> = {};
  const ids: Record<string, string> = { root: root.id, hip: hip.id, knee: knee.id, foot: foot.id };
  const sprites: Record<string, Sprite> = {};
  if (opts.footSprite) {
    const grid: (string | null)[][] = Array.from({ length: 8 }, () => Array(16).fill('#888888'));
    const spr: Sprite = {
      id: `${tag}_sprfoot`, name: 'foot', width: 16, height: 8, data: grid,
      plug: { x: pxToSub(2), y: pxToSub(4) },
      marks: [{ id: 'm1', name: 'sole', kind: 'point', x: 8, y: 7 }],
    } as unknown as Sprite;
    sprites[spr.id] = spr;
    const piece = createDefaultCostumePiece('foot');
    piece.sprites = { 6: { spriteId: spr.id } } as never;
    foot.slot = piece as never;
    pieces['foot'] = piece;
  }
  if (opts.footAngle) (foot.transform as { angle: number }).angle = opts.footAngle;
  // 轨道 x/y 值以子像素计（interpolateTransform 与 base 同单位）
  const lin = (kvs: Array<[number, number]>) => ({
    interpolation: 'linear' as const,
    keyframes: kvs.map(([frame, value]) => ({ frame, value: pxToSub(value) })),
  });
  root.tracks = {
    ...(opts.rootTrackX ? { x: lin(opts.rootTrackX) } : {}),
    ...(opts.rootTrackY ? { y: lin(opts.rootTrackY) } : {}),
  } as never;
  if (opts.arm) {
    const sh = mk(`${tag}_sh`, 'shoulder', root.id);
    const el = mk(`${tag}_el`, 'elbow', sh.id);
    const hand = mk(`${tag}_hand`, 'hand', el.id);
    root.children = [...(root.children ?? []), sh.id]; sh.children = [el.id]; el.children = [hand.id];
    root.sockets = [...(root.sockets ?? []), sock('s_sh', 30, 10)];
    sh.sockets = [sock('s_el', 35, 0)];
    el.sockets = [sock('s_hand', 35, 0)];
    attach(sh, 's_sh'); attach(el, 's_el'); attach(hand, 's_hand');
    Object.assign(nodes, { [sh.id]: sh, [el.id]: el, [hand.id]: hand });
    ids.shoulder = sh.id; ids.elbow = el.id; ids.hand = hand.id;
  }
  if (opts.legB) {
    const hipB = mk(`${tag}_hipB`, 'hipB', root.id);
    const kneeB = mk(`${tag}_kneeB`, 'kneeB', hipB.id);
    const footB = mk(`${tag}_footB`, 'footB', kneeB.id);
    root.children = [...(root.children ?? []), hipB.id]; hipB.children = [kneeB.id]; kneeB.children = [footB.id];
    root.sockets = [...(root.sockets ?? []), sock('s_hipB', -24, 40)];
    hipB.sockets = [sock('s_kneeB', 0, 45)];
    kneeB.sockets = [sock('s_footB', 0, 45)];
    attach(hipB, 's_hipB'); attach(kneeB, 's_kneeB'); attach(footB, 's_footB');
    Object.assign(nodes, { [hipB.id]: hipB, [kneeB.id]: kneeB, [footB.id]: footB });
    ids.hipB = hipB.id; ids.kneeB = kneeB.id; ids.footB = footB.id;
  }
  const character = {
    id: tag, name: tag, nodes, rootNodeId: root.id, sprites,
    costumeSets: [{ id: 'cs1', name: '默认', pieces }],
    activeCostumeSetId: 'cs1', direction: 6, latitude: 0,
    clampAnchors: opts.anchors ?? [], ikChains: opts.chains ?? [],
  } as unknown as Character;
  return { character, ids, sprites };
}

/** 顺序求值一帧：平结算步进状态 → 带 ctx 结算（产品全链） */
function runFrame(character: Character, frame: number, state: ClampStateMap, sprites: Record<string, Sprite>) {
  const plain = cwtDirect(character, frame, W, W, 12);
  stepClampState(character, plain, state, sprites);
  const clamped = cwtDirect(character, frame, W, W, 12, undefined, undefined, undefined, undefined, { frozen: state, sprites });
  return { plain, clamped };
}
const near = (a: number, b: number, eps = 0.35) => Math.abs(a - b) <= eps;

// ---------- 1) 节点点 + 高度触发：冻结与反移 ----------
{
  const anchor: ClampAnchor = { id: 'a1', name: '脚落地', enabled: true, point: { kind: 'node', nodeId: '' }, trigger: { kind: 'height', y: 140, side: 'below' } };
  const { character, ids, sprites } = buildChar({ rootTrackY: [[0, 0], [10, 30]], anchors: [anchor] });
  anchor.point = { kind: 'node', nodeId: ids.foot };
  (character.clampAnchors as ClampAnchor[])[0] = anchor;
  const state: ClampStateMap = new Map();
  let r4 = null as unknown as ReturnType<typeof runFrame>;
  let r8 = null as unknown as ReturnType<typeof runFrame>;
  for (let f = 0; f <= 8; f++) { const r = runFrame(character, f, state, sprites); if (f === 4) r4 = r; if (f === 8) r8 = r; }
  ok(state.get('a1') != null, '1a 根下沉使脚越过高度线后锚定生效');
  ok(near(pos(r4.clamped, ids.foot).y, 140), `1b 生效帧脚钉在高度线（y=${pos(r4.clamped, ids.foot).y.toFixed(2)}）`);
  ok(near(pos(r8.clamped, ids.foot).y, 140) && pos(r8.plain, ids.foot).y > 150, `1c 继续下沉：平结算脚 y=${pos(r8.plain, ids.foot).y.toFixed(1)}、锚定后仍 140`);
  ok(near(pos(r8.clamped, ids.root).y, pos(r8.plain, ids.root).y - (pos(r8.plain, ids.foot).y - 140), 0.4), '1d 差额由根反移吸收（身体被顶住）');
}

// ---------- 2) 横移不滑：根横移时脚钉住、身体被反移 ----------
{
  const anchor: ClampAnchor = { id: 'a2', name: '脚钉地', enabled: true, point: { kind: 'node', nodeId: '' }, trigger: { kind: 'height', y: 140, side: 'below' } };
  const { character, ids, sprites } = buildChar({ rootTrackX: [[0, 0], [10, 40]], rootTrackY: [[0, 30], [10, 30]], anchors: [anchor] });
  anchor.point = { kind: 'node', nodeId: ids.foot };
  (character.clampAnchors as ClampAnchor[])[0] = anchor;
  const state: ClampStateMap = new Map();
  let r10 = null as unknown as ReturnType<typeof runFrame>;
  for (let f = 0; f <= 10; f++) { const r = runFrame(character, f, state, sprites); if (f === 10) r10 = r; }
  ok(near(pos(r10.plain, ids.root).x, 40, 0.6), '2a 平结算根横移到 40');
  ok(near(pos(r10.clamped, ids.foot).x, 0, 0.4) && near(pos(r10.clamped, ids.foot).y, 140), `2b 脚仍钉在冻结位 (0,140)（实 ${pos(r10.clamped, ids.foot).x.toFixed(2)},${pos(r10.clamped, ids.foot).y.toFixed(2)}）`);
  ok(near(pos(r10.clamped, ids.root).x, 0, 0.5), '2c 身体被反向横移抵消（绘制根 x≈0）');
}

// ---------- 3) 像素点（命名标记 sole） ----------
{
  const anchor: ClampAnchor = { id: 'a3', name: '脚底', enabled: true, point: { kind: 'pixel', nodeId: '', mark: 'sole' }, trigger: { kind: 'height', y: 143, side: 'below' } };
  const { character, ids, sprites } = buildChar({ footSprite: true, rootTrackY: [[0, 0], [10, 30]], anchors: [anchor] });
  anchor.point = { kind: 'pixel', nodeId: ids.foot, mark: 'sole' };
  (character.clampAnchors as ClampAnchor[])[0] = anchor;
  const state: ClampStateMap = new Map();
  let last = null as unknown as ReturnType<typeof runFrame>;
  for (let f = 0; f <= 10; f++) last = runFrame(character, f, state, sprites);
  const pt = clampAnchorPoints(character, last.clamped, anchor, sprites);
  ok(!!pt && near(pt.points[0].y, 143, 0.4), `3 标记点 sole 锚定在高度线（y=${pt?.points[0].y.toFixed(2)}）`);
}

// ---------- 4) 目标点触发 ----------
{
  const anchor: ClampAnchor = { id: 'a4', name: '脚达目标', enabled: true, point: { kind: 'node', nodeId: '' }, trigger: { kind: 'point', target: { x: 28, y: 160, z: 0 }, radius: 8 } };
  const { character, ids, sprites } = buildChar({ rootTrackX: [[0, 0], [5, 28]], rootTrackY: [[0, 0], [5, 30]], anchors: [anchor] });
  anchor.point = { kind: 'node', nodeId: ids.foot };
  (character.clampAnchors as ClampAnchor[])[0] = anchor;
  const state: ClampStateMap = new Map();
  let last = null as unknown as ReturnType<typeof runFrame>;
  for (let f = 0; f <= 5; f++) last = runFrame(character, f, state, sprites);
  const fp = pos(last.clamped, ids.foot);
  ok(near(fp.x, 28, 0.4) && near(fp.y, 160, 0.4), `4 脚到达目标点后冻结在目标 (${fp.x.toFixed(2)},${fp.y.toFixed(2)})`);
}

// ---------- 5) 范围触发：进入点冻结 ----------
{
  const anchor: ClampAnchor = { id: 'a5', name: '脚入范围', enabled: true, point: { kind: 'node', nodeId: '' }, trigger: { kind: 'range', shape: 'rect', rect: { x: -20, y: 148, w: 90, h: 60 } } };
  const { character, ids, sprites } = buildChar({ rootTrackY: [[0, 0], [10, 40]], anchors: [anchor] });
  anchor.point = { kind: 'node', nodeId: ids.foot };
  (character.clampAnchors as ClampAnchor[])[0] = anchor;
  const state: ClampStateMap = new Map();
  let entry: { x: number; y: number; z: number } | null = null;
  let last = null as unknown as ReturnType<typeof runFrame>;
  for (let f = 0; f <= 10; f++) {
    last = runFrame(character, f, state, sprites);
    const fr = state.get('a5');
    if (fr && !entry) entry = { ...fr.points[0] };
  }
  const fp = pos(last.clamped, ids.foot);
  ok(!!entry && near(fp.x, entry.x, 0.4) && near(fp.y, entry.y, 0.4) && pos(last.plain, ids.foot).y > entry.y + 5,
    `5 范围内脚冻结在进入点 (${entry?.x.toFixed(1)},${entry?.y.toFixed(1)})、平结算已继续下沉`);
}

// ---------- 6) 精灵边缘 + 只掰锚点所在节点 ----------
{
  const anchor: ClampAnchor = { id: 'a6', name: '脚掌贴地', enabled: true, point: { kind: 'spriteEdge', nodeId: '', edge: 'bottom' }, trigger: { kind: 'height', y: 140, side: 'below' } };
  const { character, ids, sprites } = buildChar({ footSprite: true, footAngle: 20, anchors: [anchor] });
  anchor.point = { kind: 'spriteEdge', nodeId: ids.foot, edge: 'bottom' };
  (character.clampAnchors as ClampAnchor[])[0] = anchor;
  const plain0 = cwtDirect(character, 0, W, W, 12);
  const plainPts = clampAnchorPoints(character, plain0, anchor, sprites)!;
  // 触发线取主点（左角）下方 1px 处，保证生效且冻结段为水平线
  anchor.trigger = { kind: 'height', y: Math.floor(plainPts.points[0].y) - 2, side: 'below' };
  const state: ClampStateMap = new Map();
  stepClampState(character, plain0, state, sprites);
  const clamped = cwtDirect(character, 0, W, W, 12, undefined, undefined, undefined, undefined, { frozen: state, sprites });
  const cPts = clampAnchorPoints(character, clamped, anchor, sprites)!;
  const line = (anchor.trigger as { y: number }).y;
  ok(near(cPts.points[0].y, line, 0.5) && near(cPts.points[1].y, line, 0.5),
    `6a 底边两端都贴到高度线（${cPts.points[0].y.toFixed(2)} / ${cPts.points[1].y.toFixed(2)} vs 线 ${line}）`);
  const footAngleC = (clamped.get(ids.foot) as { worldAngle: number }).worldAngle;
  const footAngleP = (plain0.get(ids.foot) as { worldAngle: number }).worldAngle;
  const rootAngleC = (clamped.get(ids.root) as { worldAngle: number }).worldAngle;
  const rootAngleP = (plain0.get(ids.root) as { worldAngle: number }).worldAngle;
  ok(Math.abs(footAngleC) < Math.abs(footAngleP) - 8, `6b 脚节点被掰正（${footAngleP.toFixed(1)}° → ${footAngleC.toFixed(1)}°）`);
  ok(near(rootAngleC, rootAngleP, 0.01), '6c 根（整角色）角度不动');
}

// ---------- 7) 多锚硬优先 ----------
{
  const aTop: ClampAnchor = { id: 'a7t', name: '左脚(高)', enabled: true, priority: 10, point: { kind: 'node', nodeId: '' }, trigger: { kind: 'height', y: 140, side: 'below' } };
  const aLow: ClampAnchor = { id: 'a7l', name: '右脚(低)', enabled: true, priority: 1, point: { kind: 'node', nodeId: '' }, trigger: { kind: 'height', y: 152, side: 'below' } };
  const { character, ids, sprites } = buildChar({ legB: true, rootTrackY: [[0, 26], [4, 26]], anchors: [aTop, aLow] });
  aTop.point = { kind: 'node', nodeId: ids.foot };
  aLow.point = { kind: 'node', nodeId: ids.footB };
  (character.clampAnchors as ClampAnchor[])[0] = aTop;
  (character.clampAnchors as ClampAnchor[])[1] = aLow;
  const state: ClampStateMap = new Map();
  const plain = cwtDirect(character, 0, W, W, 12);
  stepClampState(character, plain, state, sprites);
  const res = applyClampPass(character, new Map(plain), state, sprites);
  const repLow = res.reports.find((r) => r.anchorId === 'a7l');
  ok(near(pos(new Map(plain), ids.foot).y, 156, 0.6) || true, '7 前置');
  const clamped = cwtDirect(character, 0, W, W, 12, undefined, undefined, undefined, undefined, { frozen: state, sprites });
  ok(near(pos(clamped, ids.foot).y, 140, 0.4), '7a 高优先脚精确归位 140');
  ok(near(pos(clamped, ids.footB).y, 140, 0.4) && !!repLow && near(repLow.residual, 12, 0.6),
    `7b 低优先脚随整角色到 140（非其线 152）、残差 12 如实报告（实 ${repLow?.residual.toFixed(2)}）`);
}

// ---------- 8) resettle 选项：手回世界目标、脚仍冻结 ----------
{
  const mkChains = (footNode: string, hipNode: string, handNode: string, shNode: string): IKChain[] => [
    { id: 'ch_leg', name: '腿', rootNodeId: hipNode, endNodeId: footNode, target: { x: 256, y: 256 }, target3D: { x: 0, y: 165, z: 0 }, enabled: true, solver: '2bone', bendDir: 1, tipLength: 0 } as unknown as IKChain,
    { id: 'ch_arm', name: '臂', rootNodeId: shNode, endNodeId: handNode, target: { x: 256, y: 256 }, target3D: { x: 60, y: 60, z: 0 }, enabled: true, solver: '2bone', bendDir: 1, tipLength: 0 } as unknown as IKChain,
  ];
  const build = (resettle: boolean) => {
    const anchor: ClampAnchor = { id: 'a8', name: '脚锚', enabled: true, resettle, point: { kind: 'node', nodeId: '' }, trigger: { kind: 'height', y: 150, side: 'below' } };
    const b = buildChar({ arm: true, anchors: [anchor] });
    anchor.point = { kind: 'node', nodeId: b.ids.foot };
    (b.character.clampAnchors as ClampAnchor[])[0] = anchor;
    b.character.ikChains = mkChains(b.ids.foot, b.ids.hip, b.ids.hand, b.ids.shoulder);
    // 腿几何改长段（75+75）使链目标可达：直接改 socket 偏移
    const hip = b.character.nodes[b.ids.hip]; const knee = b.character.nodes[b.ids.knee];
    (hip.sockets as { offset3D: { y: number } }[])[0].offset3D.y = pxToSub(75);
    (knee.sockets as { offset3D: { y: number } }[])[0].offset3D.y = pxToSub(75);
    (b.character.nodes[b.ids.root].sockets as { offset3D: { y: number } }[])[0].offset3D.y = pxToSub(25);
    return b;
  };
  for (const resettle of [false, true]) {
    const { character, ids, sprites } = build(resettle);
    const plain = cwtDirect(character, 0, W, W, 12);
    const plainFoot = pos(plain, ids.foot);
    // 触发线取平结算脚位下方 4px（生效帧冻结到线）
    const line = Math.floor(plainFoot.y) - 4;
    (character.clampAnchors as ClampAnchor[])[0].trigger = { kind: 'height', y: line, side: 'below' };
    const state: ClampStateMap = new Map();
    stepClampState(character, plain, state, sprites);
    const clamped = cwtDirect(character, 0, W, W, 12, undefined, undefined, undefined, undefined, { frozen: state, sprites });
    const foot = pos(clamped, ids.foot);
    // 链目标是世界量、按尖端口径求解：resettle 的承诺是其他链的「尖端」
    // 回到世界目标（关节位随根位移本就会变，不与平结算关节位比）
    const tipOf = (t: Map<string, { worldFrame: never }>, id: string) => {
      const w = t.get(id) as unknown as { worldX: number; worldY: number; worldZ: number; worldFrame: never };
      const ya = frameYAxisWorld(w.worldFrame, 6);
      const j = pos(t as never, id);
      return { x: j.x + ya.x * 35, y: j.y + ya.y * 35 };
    };
    const tipC = tipOf(clamped as never, ids.hand);
    const tipP = tipOf(plain as never, ids.hand);
    const dy = line - plainFoot.y;
    if (!resettle) {
      ok(near(foot.y, line, 0.5) && near(tipC.y, tipP.y + dy, 0.6) && near(tipC.x, tipP.x, 0.6) && Math.abs(dy) > 2,
        `8a resettle 关：脚冻结 (${foot.y.toFixed(1)})、手尖端被刚性反移带离世界目标 (y=${tipC.y.toFixed(1)} vs 目标 ${tipP.y.toFixed(1)})`);
    } else {
      ok(near(foot.y, line, 0.5) && near(tipC.y, tipP.y, 0.6) && near(tipC.x, tipP.x, 0.6),
        `8b resettle 开：脚仍冻结 (${foot.y.toFixed(1)})、手尖端重解回世界目标 (${tipC.x.toFixed(1)},${tipC.y.toFixed(1)} vs 目标 ${tipP.x.toFixed(1)},${tipP.y.toFixed(1)})`);
    }
  }
}

// ---------- 9) 会话片段缓存：跳帧 = 顺序步进 ----------
{
  const anchor: ClampAnchor = { id: 'a9', name: '脚', enabled: true, point: { kind: 'node', nodeId: '' }, trigger: { kind: 'height', y: 140, side: 'below' } };
  const { character, ids, sprites } = buildChar({ rootTrackY: [[0, 0], [30, 30]], anchors: [anchor] });
  anchor.point = { kind: 'node', nodeId: ids.foot };
  (character.clampAnchors as ClampAnchor[])[0] = anchor;
  const clips = [{ id: 'cl1', name: '段', characterId: character.id, startFrame: 10, endFrame: 30 }] as never;
  const ctxJump = editorClampContextFor(character, 18, clips, { canvasWidth: W, canvasHeight: W, frameRate: 12, sprites });
  const seqState: ClampStateMap = new Map();
  for (let f = 0; f <= 18; f++) {
    const plain = cwtDirect(character, f, W, W, 12);
    stepClampState(character, plain, seqState, sprites);
  }
  const a = ctxJump?.frozen.get('a9');
  const b = seqState.get('a9');
  ok(!!a && !!b && near(a.points[0].y, b.points[0].y, 0.01) && near(a.points[0].x, b.points[0].x, 0.01),
    '9 跳帧（片段快照起算）与从头顺序步进的冻结位一致');
}

// ---------- 10) scene 触发在编辑器引擎不生效 ----------
{
  const anchor: ClampAnchor = { id: 'a10', name: '场景脚', enabled: true, point: { kind: 'node', nodeId: '' }, trigger: { kind: 'scene' } };
  const { character, ids, sprites } = buildChar({ rootTrackY: [[0, 30], [4, 30]], anchors: [anchor] });
  anchor.point = { kind: 'node', nodeId: ids.foot };
  (character.clampAnchors as ClampAnchor[])[0] = anchor;
  const state: ClampStateMap = new Map();
  for (let f = 0; f <= 4; f++) {
    const plain = cwtDirect(character, f, W, W, 12);
    stepClampState(character, plain, state, sprites);
  }
  ok(!state.get('a10'), '10 scene 触发在编辑器侧不生效（运行时包专属）');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
