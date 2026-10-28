// 自动关键帧口径探针：已有关键帧的通道永远可改；开关关着且当前帧
// 该通道无键 → 不在当前帧新建、改写到第 0 帧（有键更新、无键新建）；
// 开关开着照常在当前帧新建；forceCreate（时间轴显式打帧）永远新建。
// 拖拽入口的两道闸门已拆（静态断言在文末）。
import { useProjectStore } from '../src/lib/store';
import { usePuppetSessionStore } from '../src/lib/puppet-session-store';
import { writePuppetPoseKeyframe } from '../src/components/pixel-editor/canvas/tool-handlers';
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

const ps = useProjectStore.getState();
const ch0 = ps.addUnifiedCharacter('自动关键帧探针');
const charId = ch0.id;
const root = ch0.nodes[ch0.rootNodeId]!;
const node = ps.addUnifiedNode(charId, '被拖节点', { parentId: root.id });
const getNode = () => useProjectStore.getState().unifiedCharacters[charId]!.nodes[node.id]!;
const vals = (angle: number) => ({ angle, stretch: 1, scaleX: 1, x: 111, y: 222 });
const keyAt = (track: { keyframes: { frame: number; value: number }[] } | undefined, frame: number) =>
  track?.keyframes.find((k) => k.frame === frame)?.value;

// 预置：第 5 帧 angle 通道已有关键帧（值 10），其余通道无键
ps.updateUnifiedNode(charId, node.id, {
  tracks: { angle: { keyframes: [{ frame: 5, value: 10 }], interpolation: 'linear' } } as never,
});

// A 开关关 + 当前帧有 angle 键 → 改当前帧；x/y 当前帧无键 → 写到 0 帧
usePuppetSessionStore.getState().setAutoKeyframe(false);
writePuppetPoseKeyframe(charId, '', node.id, 5, vals(45), 6);
let n = getNode();
ok('A1 关：已有键的 angle@5 改写为 45', keyAt(n.tracks.angle, 5) === 45);
ok('A2 关：x 不在当前帧新建', keyAt(n.tracks.x, 5) === undefined);
ok('A3 关：x 写到 0 帧=111', keyAt(n.tracks.x, 0) === 111);
ok('A4 关：y 写到 0 帧=222', keyAt(n.tracks.y, 0) === 222);

// B 开关关 + 第 9 帧整帧无键 → 写到 0 帧（新建），原有 5 帧键不动
writePuppetPoseKeyframe(charId, '', node.id, 9, vals(90), 6);
n = getNode();
ok('B1 关+无键帧：angle 不在第 9 帧新建', keyAt(n.tracks.angle, 9) === undefined);
ok('B2 关+无键帧：angle 写到 0 帧=90', keyAt(n.tracks.angle, 0) === 90);
ok('B3 关+无键帧：angle@5 仍是 45', keyAt(n.tracks.angle, 5) === 45);

// B' 再写一次 → 更新 0 帧的键、不重复建
writePuppetPoseKeyframe(charId, '', node.id, 9, vals(33), 6);
n = getNode();
ok('B4 关：0 帧键被更新为 33', keyAt(n.tracks.angle, 0) === 33);
ok('B5 关：0 帧键恰 1 个', n.tracks.angle?.keyframes.filter((k) => k.frame === 0).length === 1);

// C 开关开 → 在当前帧新建
usePuppetSessionStore.getState().setAutoKeyframe(true);
writePuppetPoseKeyframe(charId, '', node.id, 9, vals(90), 6);
n = getNode();
ok('C1 开：angle 在第 9 帧新建=90', keyAt(n.tracks.angle, 9) === 90);
ok('C2 开：x 在第 9 帧新建=111', keyAt(n.tracks.x, 9) === 111);

// D forceCreate（时间轴显式添加关键帧）→ 开关关也在指定帧新建
usePuppetSessionStore.getState().setAutoKeyframe(false);
writePuppetPoseKeyframe(charId, '', node.id, 12, vals(30), 6, { forceCreate: true });
n = getNode();
ok('D1 forceCreate：关着也在第 12 帧新建 angle=30', keyAt(n.tracks.angle, 12) === 30);
usePuppetSessionStore.getState().setAutoKeyframe(true);

// E 静态断言：两个拖拽入口不再有 autoKeyframe 闸门
const src = readFileSync(new URL('../src/components/pixel-editor/canvas/tool-handlers.ts', import.meta.url), 'utf-8');
ok('E1 拖拽入口无 autoKeyframe 早退', !src.includes('if (!session.autoKeyframe) return') && !src.includes('if (!usePuppetSessionStore.getState().autoKeyframe)'));

console.log(`合计：${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
