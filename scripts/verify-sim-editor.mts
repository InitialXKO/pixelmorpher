// ============================================================
// D6 乙路步骤 3：编辑器接线探针。走产品全链：editorSimContextFor
// 步进会话 → SimContext 注入 computeWorldTransforms → 显示出的
// 链关节世界位，应与「独立步进器读同一平结算」的解出关节位
// 重合（FK 子像素量化容差内）。另证：逐帧段长确实被取用
// （常长喂法会给出不同结果）、scrub 重演一致、烘焙模式下
// 会话不介入。
// 跑法：bun scripts/verify-sim-editor.mts
// ============================================================
import { computeWorldTransforms } from '../src/lib/unified-render';
import { editorSimContextFor, steppedSimStates } from '../src/lib/sim-session';
import {
  createChainSimState, stepChainSim, defaultChainBakeParams,
} from '../src/lib/sim/verlet-chain';
import {
  createDefaultNode, pxToSub, subToPx, type Character,
} from '../src/lib/unified-types';
import type { AnimationClip } from '../src/lib/types';

let fails = 0;
let total = 0;
const ok = (c: boolean, m: string) => { total++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const W = 512;
const FR = 12;

function buildChar(mode: 'realtime' | 'bake'): Character {
  const mk = (id: string, parentId?: string) => {
    const n = createDefaultNode(id, id);
    n.id = id;
    if (parentId) n.parentId = parentId;
    (n.transform as { variantIndex: number }).variantIndex = 6;
    return n;
  };
  const root = mk('s_root');
  const a = mk('s_a', root.id); const b = mk('s_b', a.id); const c = mk('s_c', b.id);
  root.children = [a.id]; a.children = [b.id]; b.children = [c.id];
  const sock = (id: string, x: number, y: number) => ({
    id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
  });
  root.sockets = [sock('sk_a', 10, 30)];
  a.sockets = [sock('sk_b', 0, 26)];
  b.sockets = [sock('sk_c', 0, 22)];
  const attach = (n: ReturnType<typeof mk>, sid: string) => {
    n.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } } as never;
  };
  attach(a, 'sk_a'); attach(b, 'sk_b'); attach(c, 'sk_c');
  const lin = (kvs: Array<[number, number]>) => ({
    interpolation: 'linear' as const,
    keyframes: kvs.map(([frame, value]) => ({ frame, value: pxToSub(value) })),
  });
  // 根横移驱动链根；b 的本地 x 轨道逐帧改变 a→b 段长（裁决 3 的取数证据）
  root.tracks = { x: lin([[0, 0], [30, 70], [59, 10]]) } as never;
  b.tracks = { x: lin([[0, 0], [30, 20], [59, 0]]) } as never;
  const params = defaultChainBakeParams();
  const character = {
    id: 'simchar', name: 'simchar',
    nodes: { [root.id]: root, [a.id]: a, [b.id]: b, [c.id]: c },
    rootNodeId: root.id, sprites: {}, costumeSets: [], direction: 6, latitude: 0,
    chainSims: { s_a: { chainNodeIds: ['s_a', 's_b', 's_c'], params } },
    chainModes: { s_a: mode },
  } as unknown as Character;
  return character;
}

const clips = [{ startFrame: 0, endFrame: 59 }] as unknown as AnimationClip[];
const CHAIN = ['s_a', 's_b', 's_c'];
const jointsOf = (map: Map<string, { worldX: unknown; worldY: unknown }>) =>
  CHAIN.map((id) => {
    const t = map.get(id)!;
    return { x: subToPx(t.worldX as never), y: subToPx(t.worldY as never) };
  });
const lengthsOf = (js: { x: number; y: number }[]) =>
  js.slice(0, -1).map((p, i) => Math.hypot(js[i + 1].x - p.x, js[i + 1].y - p.y));

/** 独立期望：从平结算逐帧步进（不经会话层） */
function expectedJoints(character: Character, toFrame: number) {
  const plain0 = computeWorldTransforms(character, 0, W, W, FR);
  const st = createChainSimState(jointsOf(plain0));
  for (let f = 1; f <= toFrame; f++) {
    const plain = computeWorldTransforms(character, f, W, W, FR);
    const js = jointsOf(plain);
    stepChainSim(st, js[0], lengthsOf(js), defaultChainBakeParams(), FR);
  }
  return st.pts.map((p) => ({ x: p.x, y: p.y }));
}

const maxDev = (a: { x: number; y: number }[], b: { x: number; y: number }[]) =>
  Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));

// ---------- 1) 顺序播放：显示关节位 == 独立步进解 ----------
{
  const character = buildChar('realtime');
  const opts = { canvasWidth: W, canvasHeight: W, frameRate: FR };
  let worst = 0;
  for (let f = 0; f <= 45; f++) {
    const simCtx = editorSimContextFor(character, f, clips, opts);
    if (!simCtx) { ok(false, `① 第 ${f} 帧 simCtx 缺失`); break; }
    const applied = computeWorldTransforms(
      character, f, W, W, FR, undefined, undefined, undefined, undefined, undefined, simCtx);
    worst = Math.max(worst, maxDev(jointsOf(applied), expectedJoints(character, f)));
  }
  console.log(`    [①] 0–45 帧显示关节与独立步进解最大偏差 ${worst.toFixed(3)}px`);
  ok(worst < 0.75, '① 顺序播放：经 ctx 注入的显示关节位与独立步进解重合（<0.75px）');
}

// ---------- 2) 逐帧段长取数证据：常长喂法必给出不同结果 ----------
{
  const character = buildChar('realtime');
  const plain0 = computeWorldTransforms(character, 0, W, W, FR);
  const stConst = createChainSimState(jointsOf(plain0));
  const constLens = lengthsOf(jointsOf(plain0));
  for (let f = 1; f <= 45; f++) {
    const plain = computeWorldTransforms(character, f, W, W, FR);
    stepChainSim(stConst, jointsOf(plain)[0], constLens, defaultChainBakeParams(), FR);
  }
  const expVar = expectedJoints(character, 45);
  const dev = maxDev(stConst.pts, expVar);
  const plain30 = computeWorldTransforms(character, 30, W, W, FR);
  const lenSwing = Math.abs(lengthsOf(jointsOf(plain30))[0] - constLens[0]);
  console.log(`    [②] a→b 段长在第 30 帧已变 ${lenSwing.toFixed(1)}px；常长喂法 vs 逐帧段长在第 45 帧的关节偏差 ${dev.toFixed(2)}px`);
  ok(lenSwing > 5 && dev > 1.5, '② 段长逐帧取数确实生效（段长大幅变化且常长喂法结果明显不同）');
}

// ---------- 3) scrub 重演：先跳远再跳回，结果与顺序步进一致 ----------
{
  const character = buildChar('realtime');
  const opts = { canvasWidth: W, canvasHeight: W, frameRate: FR };
  const grab = (f: number) => {
    const simCtx = editorSimContextFor(character, f, clips, opts);
    const applied = computeWorldTransforms(
      character, f, W, W, FR, undefined, undefined, undefined, undefined, undefined, simCtx);
    return jointsOf(applied);
  };
  grab(50); grab(55);
  const back = grab(20);
  const dev = maxDev(back, expectedJoints(character, 20));
  console.log(`    [③] 跳到 55 再跳回 20，偏差 ${dev.toFixed(3)}px`);
  ok(dev < 0.75, '③ scrub 重演与顺序步进一致');
}

// ---------- 4) steppedSimStates 独立入口与会话同结果 ----------
{
  const character = buildChar('realtime');
  const states = steppedSimStates(character, 0, 45, { canvasWidth: W, canvasHeight: W, frameRate: FR });
  const st = states.get('s_a');
  ok(!!st, '④ 独立入口返回链状态');
  const dev = st ? maxDev(st.pts, expectedJoints(character, 45)) : 99;
  ok(dev === 0, '④ 独立入口步进结果与手算步进逐位一致');
}

// ---------- 5) 烘焙模式：会话不介入 ----------
{
  const character = buildChar('bake');
  const ctx = editorSimContextFor(character, 10, clips, { canvasWidth: W, canvasHeight: W, frameRate: FR });
  ok(ctx === undefined, '⑤ 链根为烘焙模式时 editorSimContextFor 返回 undefined（不介入）');
}

console.log(fails === 0 ? `\n全部 ${total} 条断言通过` : `\n${fails}/${total} 条断言失败`);
process.exit(fails === 0 ? 0 : 1);
