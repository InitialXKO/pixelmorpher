// verify-behavior-host — 输入轨采样 / 宿主变量 / 主画布行为求值层
// 运行: bun scripts/verify-behavior-host.mts
import { sampleInputTrack, behaviorInputAt, behaviorPhaseRate, behaviorHostVars } from '../src/lib/behavior-host';
import { generateRenderPlan, computeWorldTransforms } from '../src/lib/unified-render';
import type { Character, KeyframeTrack } from '../src/lib/unified-types';

let passed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) throw new Error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  passed++;
  console.log(`✓ ${name}`);
}
const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const stepTrack = (pts: [number, number][]): KeyframeTrack<number> => ({
  keyframes: pts.map(([frame, value]) => ({ frame, value })),
  interpolation: 'step',
});
const linTrack = (pts: [number, number][]): KeyframeTrack<number> => ({
  keyframes: pts.map(([frame, value]) => ({ frame, value })),
  interpolation: 'linear',
});

// ---- A) 采样 ----
check('A1 step 轨段内保持', sampleInputTrack(stepTrack([[0, 0], [10, 1]]), 9, -9) === 0 && sampleInputTrack(stepTrack([[0, 0], [10, 1]]), 10, -9) === 1);
check('A2 线性轨中点插值', approx(sampleInputTrack(linTrack([[0, 0], [20, 1]]), 10, -9), 0.5));
check('A3 首尾外钳制端值', sampleInputTrack(linTrack([[5, 3], [10, 4]]), 0, -9) === 3 && sampleInputTrack(linTrack([[5, 3], [10, 4]]), 99, -9) === 4);
check('A4 无轨回退缺省', sampleInputTrack(undefined, 5, 1) === 1 && sampleInputTrack({ keyframes: [], interpolation: 'step' }, 5, 0) === 0);

// ---- B) 宿主变量 ----
const bare = { inputTracks: undefined } as unknown as Character;
const hv0 = behaviorHostVars(bare, 30, 30);
check('B1 无输入轨 = 静止待机', hv0.moveX === 0 && hv0.speed01 === 0 && hv0.grounded === 1);
check('B2 待机 phase = 4/s 积分', approx(hv0.phase, 4, 1e-6), `phase=${hv0.phase}`);
check('B3 t = 帧/帧率', approx(hv0.t, 1));

const walker = {
  inputTracks: {
    moveX: stepTrack([[0, 1]]),
    speed01: linTrack([[0, 1]]),
    grounded: stepTrack([[0, 1], [31, 0], [61, 1]]),
  },
} as unknown as Character;
const hvWalk = behaviorHostVars(walker, 30, 30);
check('B4 满速在地面 phase = 30/s', approx(hvWalk.phase, 30, 1e-6), `phase=${hvWalk.phase}`);
check('B5 腾空段输入', behaviorInputAt(walker, 45).grounded === 0 && behaviorInputAt(walker, 45).moveX === 1);
check('B6 腾空速率 18/s', behaviorPhaseRate({ moveX: 1, speed01: 1, grounded: 0 }) === 18);
const hvJump = behaviorHostVars(walker, 60, 30);
check('B7 混合段 phase 积分 = 30×1s + 18×1s', approx(hvJump.phase, 48, 1e-6), `phase=${hvJump.phase}`);
check('B8 phase 拖动可复现（同帧同值）', behaviorHostVars(walker, 60, 30).phase === hvJump.phase);

// ---- C) 主画布行为求值层（generateRenderPlan） ----
function makeNode(id: string): any {
  return {
    id, name: id, parentId: undefined, children: [],
    transform: { x: 0, y: 0, angle: 0, tilt: 0, stretch: 1, scaleX: 1, variantIndex: 6 },
    socket: { x: 0, y: 0 }, visible: true, drawLayer: 'main', zIndex: 0,
    tracks: {}, modifiers: [],
  };
}
const behaviorGraph: any = {
  version: 1, outputId: 'out',
  nodes: [
    { id: 'v', type: 'var', inputs: {}, params: { name: 'moveX', default: 0 } },
    { id: 'm', type: 'mul', inputs: { a: { nodeId: 'v' }, b: { type: 'number', value: 30 } }, params: {} },
    { id: 'out', type: 'transform', inputs: { rotation: { nodeId: 'm' } }, params: {} },
  ],
};
function angleAt(ch: Character, frame: number): number {
  const plan = generateRenderPlan(ch, frame, 200, 200, 30);
  const ins = plan.nodeInstructions.find((i: any) => i.nodeId === 'n1');
  return ins ? ins.angle : NaN;
}
const spr2: any = {
  width: 2, height: 2,
  data: [['#ff0000', '#ff0000'], ['#ff0000', '#ff0000']],
  plug: { x: 16, y: 16 },
};
const pieceN1: any = {
  slotKey: 'n1',
  sprites: { 0: spr2, 1: spr2, 2: spr2, 3: spr2, 4: spr2, 5: spr2, 6: spr2, 7: spr2 },
};
const nodeN1 = makeNode('n1');
nodeN1.slot = { slotKey: 'n1' };
const chBase: any = {
  id: 'chB', name: '行为测试',
  nodes: { n1: nodeN1 },
  rootNodeId: 'n1',
  costumeSets: [{ id: 'cs1', name: '默认', pieces: { n1: pieceN1 } }],
  activeCostumeSetId: 'cs1',
  behaviorGraphs: { n1: behaviorGraph },
  variants: {},
};
check('C1 无输入轨时行为图 moveX=0 → 不转', approx(angleAt(chBase as Character, 20), 0, 1e-6), `angle=${angleAt(chBase as Character, 20)}`);
const chWalk: any = {
  ...chBase,
  inputTracks: { moveX: stepTrack([[0, 0], [10, 1]]) },
};
check('C2 输入轨 moveX 打开前行为不转', approx(angleAt(chWalk as Character, 5), 0, 1e-6), `angle=${angleAt(chWalk as Character, 5)}`);
check('C3 输入轨 moveX=1 → 行为旋转 30°', approx(angleAt(chWalk as Character, 15), 30, 1e-4), `angle=${angleAt(chWalk as Character, 15)}`);
const chNoBehavior: any = { ...chBase, behaviorGraphs: undefined, inputTracks: chWalk.inputTracks };
check('C4 无行为图时输入轨不影响姿态', approx(angleAt(chNoBehavior as Character, 15), 0, 1e-6));

// ---- D) 点选/标签路径（computeWorldTransforms 直调方）与出图同源 ----
function worldAngleAt(ch: Character, frame: number): number {
  // 与点选/枢轴/覆盖层相同的调用口径：不经 generateRenderPlan、不传蓝图变换
  const wts = computeWorldTransforms(ch, frame, 200, 200, 30);
  return wts.get('n1')?.worldAngle ?? NaN;
}
check('D1 直调世界变换含行为旋转', approx(worldAngleAt(chWalk as Character, 15), 30, 1e-4), `angle=${worldAngleAt(chWalk as Character, 15)}`);
check('D2 直调与出图同值（未双重叠加）', approx(worldAngleAt(chWalk as Character, 15), angleAt(chWalk as Character, 15), 1e-6));
check('D3 直调在输入打开前为 0', approx(worldAngleAt(chWalk as Character, 5), 0, 1e-6));

// ---- E) 跟随开关（nodeRef 读上一帧 / 同帧，由图决定） ----
// src 图：rotation = phase × 30（无输入轨时 phase 每帧 +4/30 → rotation 每帧 +4°）
// fol 图：nodeRef 读 src 的 rotation 作自身 rotation（fol 是 src 的子节点，世界角 = src + fol 本地）
{
  const srcGraph: any = {
    version: 1, outputId: 'out',
    nodes: [
      { id: 'v', type: 'var', inputs: {}, params: { name: 'phase', default: 0 } },
      { id: 'm', type: 'mul', inputs: { a: { nodeId: 'v' }, b: { type: 'number', value: 30 } }, params: {} },
      { id: 'out', type: 'transform', inputs: { rotation: { nodeId: 'm' } }, params: {} },
    ],
  };
  const folGraph = (followMode?: 'prev' | 'same'): any => ({
    version: 1, outputId: 'out', ...(followMode ? { followMode } : {}),
    nodes: [
      { id: 'r', type: 'nodeRef', inputs: {}, params: { nodeId: 'src', output: 'rotation' } },
      { id: 'out', type: 'transform', inputs: { rotation: { nodeId: 'r' } }, params: {} },
    ],
  });
  const mkChar = (followMode?: 'prev' | 'same'): any => {
    const src = makeNode('src'); src.children = ['fol'];
    const fol = makeNode('fol'); fol.parentId = 'src'; fol.attachment = { type: 'offset' };
    return {
      id: 'chE', name: '跟随测试',
      nodes: { src, fol },
      rootNodeId: 'src',
      costumeSets: [{ id: 'cs1', name: '默认', pieces: {} }],
      activeCostumeSetId: 'cs1',
      behaviorGraphs: { src: srcGraph, fol: folGraph(followMode) },
      variants: {},
    };
  };
  const worldAt = (ch: any, nodeId: string, frame: number) =>
    computeWorldTransforms(ch as Character, frame, 200, 200, 30).get(nodeId)?.worldAngle ?? NaN;
  // f=15：src 本地 = 4×15 = 60；fol 世界 = src(60) + fol 本地
  check('E1 同帧：fol 读本帧 src(60) → 世界 120', approx(worldAt(mkChar('same'), 'fol', 15), 120, 1e-4), `angle=${worldAt(mkChar('same'), 'fol', 15)}`);
  check('E2 上一帧：fol 读 f-1 的 src(56) → 世界 116', approx(worldAt(mkChar('prev'), 'fol', 15), 116, 1e-4), `angle=${worldAt(mkChar('prev'), 'fol', 15)}`);
  check('E3 缺省 = 上一帧（与运行时既有语义一致）', approx(worldAt(mkChar(undefined), 'fol', 15), 116, 1e-4), `angle=${worldAt(mkChar(undefined), 'fol', 15)}`);
  check('E4 第 0 帧无上一帧：prev 读 0 → 世界 = src(0)+0', approx(worldAt(mkChar('prev'), 'fol', 0), 0, 1e-4), `angle=${worldAt(mkChar('prev'), 'fol', 0)}`);
}

console.log(`\nverify-behavior-host: ${passed} passed, 0 failed`);
