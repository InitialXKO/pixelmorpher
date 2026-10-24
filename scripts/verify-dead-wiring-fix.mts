// 验证：两处死接线的修复（store 级，不经过 DOM）
// 1) toggle/update/removeTrackParamDriver：对 modifierKeys 轨点内指定驱动器生效
//    （旧 toggleParamDriver 寻址工程级旧关键帧数组，节点关键帧 id 永不命中）
// 2) recordFullPose / clearFramePose：写/清节点轨道通道点，不再写幻影字段
//    puppetNodeKeyframes（旧写端在 704286d 改名时漏改）
// 3) 静态断言：时间线驱动器「编辑」接通四参处理（不再只跳帧丢 id）
import { useProjectStore } from '../src/lib/store/index';
import { usePuppetSessionStore } from '../src/lib/puppet-session-store';
import { readFileSync } from 'node:fs';

let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) fail++;
}

const nodeBase: any = {
  id: 'n1', name: '臂', parentId: null, children: [],
  transform: { x: 0, y: 0, angle: 10, stretch: 1, scaleX: 1, variantIndex: 2 },
  tracks: {}, modifiers: [], sockets: [], attachment: { type: 'root' },
  drawLayer: 'default', visible: true, zIndex: 1,
};
const char: any = {
  id: 'c1', name: '测试角色', rootNodeId: 'n1',
  nodes: { n1: nodeBase },
  costumeSets: [], directionDrawOrders: {}, latitude: 0,
  createdAt: 0, updatedAt: 0,
};
useProjectStore.setState((s: any) => ({
  ...s,
  unifiedCharacters: { c1: char },
  currentFrame: 5,
  totalFrames: 24,
  frameRate: 12,
}));

const driver: any = { id: 'd1', targetParam: 'amplitude', waveform: 'sine', amplitude: 30, frequency: 1, phase: 0, offset: 0, enabled: true };
const mod: any = { id: 'm1', type: 'pendulum', enabled: true, params: {}, paramDrivers: [driver] };
useProjectStore.getState().setNodeModifierKey('c1', 'n1', 5, [mod]);
const getDriver = () => useProjectStore.getState().unifiedCharacters['c1'].nodes['n1'].tracks.modifierKeys.keyframes[0].value[0].paramDrivers[0];
check('前置：驱动器已写入 modifierKeys 轨点', getDriver().enabled === true);
useProjectStore.getState().toggleTrackParamDriver('c1', 'n1', 5, 'm1', 'd1');
check('toggle 生效：enabled 翻转为 false', getDriver().enabled === false);
useProjectStore.getState().toggleTrackParamDriver('c1', 'n1', 5, 'm1', 'd1');
check('toggle 可逆：再按回 true', getDriver().enabled === true);
useProjectStore.getState().updateTrackParamDriver('c1', 'n1', 5, 'm1', 'd1', { amplitude: 60, waveform: 'square' });
check('update 生效：幅值与波形被改写', getDriver().amplitude === 60 && getDriver().waveform === 'square');
useProjectStore.getState().removeTrackParamDriver('c1', 'n1', 5, 'm1', 'd1');
check('remove 生效：驱动器从修饰器上消失',
  useProjectStore.getState().unifiedCharacters['c1'].nodes['n1'].tracks.modifierKeys.keyframes[0].value[0].paramDrivers.length === 0);

useProjectStore.getState().updateUnifiedNode?.('c1', 'n1', {
  tracks: { angle: { interpolation: 'linear', keyframes: [{ frame: 0, value: 10 }] } },
} as any);
useProjectStore.setState({ currentFrame: 5 } as any);
usePuppetSessionStore.setState({ performCharacterId: 'c1' } as any);
usePuppetSessionStore.getState().recordFullPose();
const after = useProjectStore.getState().unifiedCharacters['c1'].nodes['n1'];
check('recordFullPose 写进 angle 轨（第 5 帧点存在）',
  (after.tracks.angle?.keyframes ?? []).some((k: any) => k.frame === 5));
check('recordFullPose 未写幻影字段', !('puppetNodeKeyframes' in after)
  && !JSON.stringify(useProjectStore.getState().animationClips ?? []).includes('puppetNodeKeyframes'));
usePuppetSessionStore.getState().clearFramePose();
const afterClear = useProjectStore.getState().unifiedCharacters['c1'].nodes['n1'];
check('clearFramePose 清掉第 5 帧全部轨点', !(afterClear.tracks.angle?.keyframes ?? []).some((k: any) => k.frame === 5));
check('clearFramePose 保留第 0 帧点', (afterClear.tracks.angle?.keyframes ?? []).some((k: any) => k.frame === 0));

const timeline = readFileSync(new URL('../src/components/pixel-editor/Timeline.tsx', import.meta.url), 'utf8');
check('静态：驱动器编辑接通四参处理（非仅跳帧）',
  timeline.includes('onEditParamDriver={handleEditParamDriver}')
  && timeline.includes('setEditingDriver({ nodeId, frame, modifierId, driverId })')
  && timeline.includes('updateTrackParamDriver')
  && timeline.includes('removeTrackParamDriver'));
check('静态：时间线不再调用旧工程级驱动器动作',
  !timeline.includes('toggleParamDriver(') || timeline.includes('toggleTrackParamDriver'));

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
