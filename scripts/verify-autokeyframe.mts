// 自动关键帧口径探针：开关只管「当前帧无关键帧时要不要自动新建」——
// 已有关键帧的通道永远可改（动画软件通例）；拖拽入口的两道闸门已拆
// （静态断言在文末）。writePuppetPoseKeyframe 是全部姿势写入口的共用通道。
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

// 预置：第 5 帧 angle 通道已有关键帧（值 10），其余通道无键
ps.updateUnifiedNode(charId, node.id, {
  tracks: { angle: { keyframes: [{ frame: 5, value: 10 }], interpolation: 'linear' } } as never,
});

// A 开关关 + 当前帧有 angle 键 → angle 改成新值；x/y 无键 → 不新建
usePuppetSessionStore.getState().setAutoKeyframe(false);
writePuppetPoseKeyframe(charId, '', node.id, 5, vals(45), 6);
let n = getNode();
ok('A1 关：已有键的 angle 被改写为 45', n.tracks.angle?.keyframes.find((k) => k.frame === 5)?.value === 45);
ok('A2 关：无键的 x 通道不新建', !n.tracks.x?.keyframes.some((k) => k.frame === 5));
ok('A3 关：无键的 y 通道不新建', !n.tracks.y?.keyframes.some((k) => k.frame === 5));

// B 开关关 + 整帧无键 → 任何通道都不新建
writePuppetPoseKeyframe(charId, '', node.id, 9, vals(90), 6);
n = getNode();
ok('B1 关+无键帧：angle 不新建', !n.tracks.angle?.keyframes.some((k) => k.frame === 9));
ok('B2 关+无键帧：x 不新建', !n.tracks.x?.keyframes.some((k) => k.frame === 9));

// C 开关开 → 照常新建
usePuppetSessionStore.getState().setAutoKeyframe(true);
writePuppetPoseKeyframe(charId, '', node.id, 9, vals(90), 6);
n = getNode();
ok('C1 开：angle 在第 9 帧新建=90', n.tracks.angle?.keyframes.find((k) => k.frame === 9)?.value === 90);
ok('C2 开：x 在第 9 帧新建=111', n.tracks.x?.keyframes.find((k) => k.frame === 9)?.value === 111);

// D forceCreate（时间轴显式添加关键帧）→ 开关关也新建
usePuppetSessionStore.getState().setAutoKeyframe(false);
writePuppetPoseKeyframe(charId, '', node.id, 12, vals(30), 6, { forceCreate: true });
n = getNode();
ok('D1 forceCreate：关着也新建 angle=30', n.tracks.angle?.keyframes.find((k) => k.frame === 12)?.value === 30);
usePuppetSessionStore.getState().setAutoKeyframe(true);

// E 静态断言：两个拖拽入口不再有 autoKeyframe 闸门
const src = readFileSync(new URL('../src/components/pixel-editor/canvas/tool-handlers.ts', import.meta.url), 'utf-8');
ok('E1 拖拽入口无 autoKeyframe 早退', !src.includes('if (!session.autoKeyframe) return') && !src.includes('if (!usePuppetSessionStore.getState().autoKeyframe)'));

console.log(`合计：${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
