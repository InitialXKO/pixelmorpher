// 节点轨迹「烘焙为轨道」校验（2026-10-29，精灵轨迹残链退役同批）：
// 轨迹点与 tracks.x/y 同空间、轨迹插值与轨道 linear 插值同为线性——
// 烘焙前后经真实消费方 interpolateNodeKeyframes 采样应逐帧一致（±1 子像素取整差）；
// 其余轨道保留；烘焙后轨迹清空；同帧重复点取最后一点（轨迹格式自身对同帧点
// 入段/出段取法不一致，烘焙以出段口径「最后一点」为准，此处单独验出段一致）。
import assert from 'node:assert/strict';
import { interpolateNodeKeyframes } from '../src/lib/engine/render-helpers/puppet-keyframe-interpolation';

let passed = 0;
const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); passed++; };

// —— 与 StrokePanel TrajectoryRow.bakeToTracks 完全一致的变换 ——
function bake(node: any) {
  const byFrame = new Map<number, { frame: number; x: number; y: number }>();
  for (const p of node.trajectory) byFrame.set(p.frame, p);
  const uniq = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  return {
    ...node,
    tracks: {
      ...(node.tracks ?? {}),
      x: { interpolation: 'linear', keyframes: uniq.map((p: any) => ({ frame: p.frame, value: p.x })) },
      y: { interpolation: 'linear', keyframes: uniq.map((p: any) => ({ frame: p.frame, value: p.y })) },
    },
    trajectory: [],
  };
}

function sampleAll(node: any) {
  const character: any = { id: 'c1', name: '测试', nodes: { n1: node }, rootNodeId: 'n1' };
  const out: Array<{ x: number; y: number }> = [];
  for (let f = 0; f <= 20; f++) {
    const v = interpolateNodeKeyframes(character, f).get('n1');
    assert.ok(v, `frame ${f} 无采样值`);
    out.push({ x: v.x, y: v.y });
  }
  return out;
}

// 主夹具：无同帧重复
const baseNode: any = {
  id: 'n1', name: '腿', parentId: null,
  transform: { x: 0, y: 0, angle: 0, tilt: 0, scaleX: 1, scaleY: 1 },
  tracks: {
    angle: { interpolation: 'linear', keyframes: [{ frame: 0, value: 30 }, { frame: 20, value: 30 }] },
    x: { interpolation: 'linear', keyframes: [{ frame: 0, value: 9999 }] }, // 将被烘焙替换
  },
  trajectory: [
    { frame: 0, x: 0, y: 0 },
    { frame: 10, x: 160, y: 80 },
    { frame: 20, x: 320, y: 0 },
  ],
};
const before = sampleAll(baseNode);
const bakedNode = bake(baseNode);
const after = sampleAll(bakedNode);
for (let f = 0; f <= 20; f++) {
  ok(Math.abs(before[f].x - after[f].x) <= 1 && Math.abs(before[f].y - after[f].y) <= 1,
    `帧 ${f} 烘焙前后位置漂移：(${before[f].x},${before[f].y}) → (${after[f].x},${after[f].y})`);
}
ok(bakedNode.trajectory.length === 0, '烘焙后轨迹应清空');
ok(bakedNode.tracks.angle.keyframes[0].value === 30, 'angle 轨道应保留');
ok(bakedNode.tracks.x.keyframes.length === 3, '应为 3 个关键帧');

// 同帧重复夹具：frame 10 两点，烘焙取最后一点；出段（帧 ≥10）采样应与轨迹一致
const dupNode: any = {
  ...baseNode,
  tracks: {},
  trajectory: [
    { frame: 0, x: 0, y: 0 },
    { frame: 10, x: 160, y: 80 },
    { frame: 10, x: 176, y: 88 },
    { frame: 20, x: 320, y: 0 },
  ],
};
const dupBefore = sampleAll(dupNode);
const dupBaked = bake(dupNode);
const dupAfter = sampleAll(dupBaked);
ok(dupBaked.tracks.x.keyframes.length === 3, '同帧去重后应为 3 个关键帧');
ok(dupBaked.tracks.x.keyframes[1].value === 176 && dupBaked.tracks.y.keyframes[1].value === 88,
  '同帧重复点应取最后一点 (176,88)');
for (let f = 10; f <= 20; f++) {
  ok(Math.abs(dupBefore[f].x - dupAfter[f].x) <= 1 && Math.abs(dupBefore[f].y - dupAfter[f].y) <= 1,
    `同帧夹具帧 ${f} 出段漂移：(${dupBefore[f].x},${dupBefore[f].y}) → (${dupAfter[f].x},${dupAfter[f].y})`);
}
console.log(`verify-trajectory-bake: ${passed} 项全过`);
