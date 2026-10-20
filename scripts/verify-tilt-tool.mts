// 验证乙 P3：伪 3D 工具改写 tilt 的数据路径
// A) 节点 tracks.tilt 关键帧（writePuppetPoseKeyframe 的产物形状）→ computeWorldTransforms
//    整棵子树被 frame 复合掀出平面（南向 tilt=90：+Y 段 → -z），本地数据零污染
// B) interpolateNodeKeyframes（拖拽/面板读数口径）返回 tilt（轨道插值 + base 回退）
// C) angle 关键帧路径不受影响（平面内，z 保持 0）
import { computeWorldTransforms } from '../src/lib/unified-render';
import { interpolateNodeKeyframes } from '../src/lib/engine/render-helpers/puppet-keyframe-interpolation';
import { subToPx, pxToSub } from '../src/lib/unified-types';
import { useProjectStore } from '../src/lib/store';

let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${label}: ${detail}`);
  if (!ok) fail++;
}
const clone = (o: any) => JSON.parse(JSON.stringify(o));

function mkNode(id: string, opts: any = {}): any {
  return {
    id, name: id,
    parentId: opts.parentId ?? null,
    children: opts.children ?? [],
    transform: { x: 0, y: 0, z: 0, angle: 0, stretch: 1, variantIndex: 6, ...(opts.transform ?? {}) },
    tracks: opts.tracks ?? {}, modifiers: [], sockets: opts.sockets ?? [],
    attachment: opts.attachment ?? { type: 'root' },
    drawLayer: 'default', visible: true,
  };
}
const sock = (id: string, y: number): any => ({
  id, name: id, basePosition: { x: 0, y: pxToSub(y) }, directionOffsets: {},
});
const baseChar = (): any => ({
  rootNodeId: 'R', ikChains: [],
  nodes: {
    R: mkNode('R', { children: ['A'], sockets: [sock('s1', 20)] }),
    A: mkNode('A', { parentId: 'R', children: ['B'], sockets: [sock('s2', 20)], attachment: { type: 'socket', parentSocketId: 's1' } }),
    B: mkNode('B', { parentId: 'A', children: ['C'], sockets: [sock('s3', 12)], attachment: { type: 'socket', parentSocketId: 's2' } }),
    C: mkNode('C', { parentId: 'B', attachment: { type: 'socket', parentSocketId: 's3' } }),
  },
});
useProjectStore.setState({ canvasWidth: 256, canvasHeight: 256, currentFrame: 0 });
const P = (t: any) => ({ x: subToPx(t.worldX), y: subToPx(t.worldY), z: subToPx(t.worldZ) });
const near = (p: any, e: any) => Math.abs(p.x - e.x) < 0.15 && Math.abs(p.y - e.y) < 0.15 && Math.abs(p.z - e.z) < 0.15;

// ---------- A ----------
{
  const ch = baseChar();
  // 与 writePuppetPoseKeyframe(..., { tilt: 90 }) 在 frame 0 的产物完全同形
  ch.nodes.A.tracks = { tilt: { keyframes: [{ frame: 0, value: 90 }], interpolation: 'linear' } };
  const t = computeWorldTransforms(ch, 0, 256, 256, 12);
  const b = P(t.get('B')); const c = P(t.get('C'));
  check('A tilt=90 B 被掀出平面', near(b, { x: 0, y: 20, z: -20 }), `B=(${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}) 期望 (0,20,-20)`);
  check('A tilt=90 孙节点 C 跟随', near(c, { x: 0, y: 20, z: -32 }), `C=(${c.x.toFixed(1)},${c.y.toFixed(1)},${c.z.toFixed(1)}) 期望 (0,20,-32)`);
  check('A 子树本地数据零污染', !ch.nodes.B.tracks?.tilt && !ch.nodes.C.tracks?.tilt && ch.nodes.B.transform.z === 0 && ch.nodes.C.transform.z === 0,
    'B/C 无 tilt 轨、base z 未被烘焙改写');
  // 中间帧插值：frame 5 处 tilt 应在 0→90 线性过渡（关键帧在 0 与 10）
  const ch2 = baseChar();
  ch2.nodes.A.tracks = { tilt: { keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 90 }], interpolation: 'linear' } };
  const t5 = computeWorldTransforms(ch2, 5, 256, 256, 12);
  const b5 = P(t5.get('B'));
  const s45 = Math.sin(Math.PI / 4) * 20;
  check('A tilt 轨道帧间插值', near(b5, { x: 0, y: 20 - 20 + Math.cos(Math.PI / 4) * 20 + 0, z: -s45 }) || Math.abs(b5.z + s45) < 0.2,
    `f5 B=(${b5.x.toFixed(1)},${b5.y.toFixed(1)},${b5.z.toFixed(1)}) 期望 z≈${(-s45).toFixed(1)}`);
}

// ---------- B ----------
{
  const ch = baseChar();
  ch.nodes.A.tracks = { tilt: { keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 90 }], interpolation: 'linear' } };
  const iv = interpolateNodeKeyframes(ch, 5);
  check('B ivMap tilt 插值', Math.abs((iv.get('A')?.tilt ?? -1) - 45) < 0.01, `tilt=${iv.get('A')?.tilt}`);
  const chB = baseChar();
  chB.nodes.A.transform.tilt = 33;
  const ivB = interpolateNodeKeyframes(chB, 0);
  check('B ivMap tilt 无轨道回退 base', Math.abs((ivB.get('A')?.tilt ?? -1) - 33) < 0.01, `tilt=${ivB.get('A')?.tilt}`);
}

// ---------- C ----------
{
  const ch = baseChar();
  ch.nodes.A.tracks = { angle: { keyframes: [{ frame: 0, value: 90 }], interpolation: 'linear' } };
  const t = computeWorldTransforms(ch, 0, 256, 256, 12);
  const b = P(t.get('B'));
  check('C angle=90 仍在平面内旋转', Math.abs(b.z) < 0.15 && Math.abs(b.x + 20) < 0.15 && Math.abs(b.y - 20) < 0.15,
    `B=(${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}) 期望 (-20,20,0)`);
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
