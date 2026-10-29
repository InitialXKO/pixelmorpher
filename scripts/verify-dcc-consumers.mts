// DCC 消费端校验（2026-10-29，配合右面板页签恢复）：
// A) 片段事件 → 段表演 events（本地帧、只收启用且在窗内、值透传）
// B) 片段碰撞 → 段表演 hitboxes（本地帧分桶、只收启用形状）
// C) 工程调色板 → 包 userPalettes/activeUserPaletteId
// D) 程序化动画引擎匹配门：spriteId 空串不算匹配（节点条目不串扰）、
//    nodeId 条目只命中目标节点、旧 spriteId 路径不坏
import assert from 'node:assert/strict';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultCostumePiece } from '../src/lib/unified-types';
import { applyProceduralAnimations } from '../src/lib/engine/procedural';

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log('✓', name);
}

const grid = [
  ['#aabbcc', '#aabbcc'],
  ['#aabbcc', '#aabbcc'],
] as never;
const spr = {
  id: 'gspr', width: 2, height: 2,
  plug: { x: 0 as never, y: 0 as never },
  data: grid,
  directions: { 2: { spriteId: 'gspr', mirror: false } },
} as never;

const ch = {
  id: 'chD', name: 'DCC测试',
  nodes: {
    arm: {
      id: 'arm', name: '手臂', role: 'bone',
      slot: { slotKey: 'arm' },
      transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
      attachment: { type: 'fixed' }, sockets: [], modifiers: [], children: [],
      tracks: {
        angle: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 12, value: 60 }] },
      },
    },
  },
  rootNodeId: 'arm',
  rootNodeIds: ['arm'],
  sprites: { gspr: spr },
  costumeSets: [{
    id: 'set1', name: '默认',
    pieces: { arm: { ...createDefaultCostumePiece('arm'), sprites: { 2: { spriteId: 'gspr', mirror: false } } } },
  }],
  activeCostumeSetId: 'set1',
  variants: {},
} as never;

const clipBase = {
  puppetCharacterId: 'chD', loop: false,
} as never;

const clip1 = {
  ...clipBase, id: 'c1', name: '斩击', startFrame: 2, endFrame: 8,
  events: [
    { id: 'e1', frame: 4, name: '命中', stringValue: 'L', numberValue: 3, active: true, color: '#ffffff' },
    { id: 'e2', frame: 2, name: '起手', active: true, color: '#ffffff' },
    { id: 'e3', frame: 10, name: '窗外', active: true, color: '#ffffff' },
    { id: 'e4', frame: 5, name: '禁用', active: false, color: '#ffffff' },
  ],
  hitboxMap: {
    frame_3: [
      { id: 'h1', name: '刀', shapeType: 'rect', data: { x: 1, y: 2, width: 10, height: 4 }, active: true, color: '#ff0000' },
      { id: 'h2', name: '关', shapeType: 'circle', data: { x: 0, y: 0, radius: 3 }, active: false, color: '#00ff00' },
    ],
    frame_6: [
      { id: 'h3', name: '身', shapeType: 'circle', data: { x: 0, y: 0, radius: 5 }, active: true, color: '#0000ff' },
    ],
    frame_20: [
      { id: 'h4', name: '窗外', shapeType: 'rect', data: { x: 0, y: 0, width: 1, height: 1 }, active: true, color: '#000000' },
    ],
  },
} as never;

const clip2 = { ...clipBase, id: 'c2', name: '静立', startFrame: 2, endFrame: 8 } as never;

const pkg = convertCharacterToRuntimePackage(ch, undefined, {
  clips: [clip1, clip2],
  projectData: {
    palettes: [{
      id: 'pal1', name: '队伍色',
      colors: [{ color: '#ff0000', label: '主色' }, { color: null, label: '空' }],
      swappableIndices: [0], isDefault: true,
    }],
    activePaletteId: 'pal1',
  },
} as never);

type Perf = {
  id?: string;
  events?: Array<{ frame: number; name: string; stringValue?: string; numberValue?: number }>;
  hitboxes?: Array<{ frame: number; shapes: Array<{ name: string; shapeType: string; data: Record<string, unknown> }> }>;
};
const perf1 = pkg.performances.find((p) => (p as Perf).id === 'clip_c1') as Perf | undefined;
check('A0 带轨道贡献的片段生成段表演', !!perf1);
check('A1 事件只收启用且在窗内（4 条 → 2 条）', (perf1?.events?.length ?? 0) === 2);
check('A2 事件帧转本地帧且排序（窗起 2 → [0, 2]）',
  !!perf1?.events && perf1.events[0].frame === 0 && perf1.events[1].frame === 2);
check('A3 事件名与值透传（起手 / 命中+L+3）',
  !!perf1?.events && perf1.events[0].name === '起手'
  && perf1.events[1].name === '命中' && perf1.events[1].stringValue === 'L' && perf1.events[1].numberValue === 3);

check('B1 碰撞分桶只收窗内（3 桶 → 2 桶）', (perf1?.hitboxes?.length ?? 0) === 2);
check('B2 桶帧转本地帧（[1, 4]）',
  !!perf1?.hitboxes && perf1.hitboxes[0].frame === 1 && perf1.hitboxes[1].frame === 4);
check('B3 桶内只收启用形状且数据透传（刀 rect 10×4）',
  !!perf1?.hitboxes && perf1.hitboxes[0].shapes.length === 1
  && perf1.hitboxes[0].shapes[0].name === '刀'
  && perf1.hitboxes[0].shapes[0].data.width === 10);

const perf2 = pkg.performances.find((p) => (p as Perf).id === 'clip_c2') as Perf | undefined;
check('A4 无事件/碰撞的片段字段缺省（不发空数组）',
  !!perf2 && perf2.events === undefined && perf2.hitboxes === undefined);

check('C1 userPalettes 进包（色槽 hex/null 展开、可换槽位透传）',
  !!pkg.userPalettes && pkg.userPalettes.length === 1
  && pkg.userPalettes[0].colors[0] === '#ff0000' && pkg.userPalettes[0].colors[1] === null
  && pkg.userPalettes[0].swappableIndices.join() === '0');
check('C2 activeUserPaletteId 进包', pkg.activeUserPaletteId === 'pal1');
const pkgNoPal = convertCharacterToRuntimePackage(ch);
check('C3 无工程调色板时 userPalettes 缺省', pkgNoPal.userPalettes === undefined);

// ---------- D) 程序化动画匹配门 ----------
const mkMods = () => [{ id: 'm1', type: 'rotate', enabled: true, params: { angle: 10 } }] as never;
const waveCfg = {
  type: 'wave', amplitude: 5, frequency: 0.25, phase: 0, waveType: 'sine', targetProperty: 'rotation',
} as never;
// frame 1: sin(1 * 0.25 * 2π) * 5 = sin(π/2)*5 = 5 ≠ 0
const paNode = { id: 'p1', name: '节点摆', spriteId: '', nodeId: 'n1', config: waveCfg, enabled: true, startFrame: 0, endFrame: 99 } as never;
const appliedSelf = applyProceduralAnimations(mkMods(), [paNode], '', 1, 'n1') as Array<{ params: { angle: number } }>;
check('D1 nodeId 条目命中目标节点（angle 10 → 15）', Math.abs(appliedSelf[0].params.angle - 15) < 1e-9);
const appliedOther = applyProceduralAnimations(mkMods(), [paNode], '', 1, 'n2') as Array<{ params: { angle: number } }>;
check('D2 nodeId 条目不串扰其他节点（spriteId 空串不再全命中）', appliedOther[0].params.angle === 10);
const paOrphan = { id: 'p2', name: '无主', spriteId: '', config: waveCfg, enabled: true, startFrame: 0, endFrame: 99 } as never;
const appliedOrphan = applyProceduralAnimations(mkMods(), [paOrphan], '', 1, 'n1') as Array<{ params: { angle: number } }>;
check('D3 spriteId 空串且无 nodeId 的条目不命中任何节点', appliedOrphan[0].params.angle === 10);
const paSprite = { id: 'p3', name: '精灵摆', spriteId: 'sprX', config: waveCfg, enabled: true, startFrame: 0, endFrame: 99 } as never;
const appliedSprite = applyProceduralAnimations(mkMods(), [paSprite], 'sprX', 1) as Array<{ params: { angle: number } }>;
check('D4 旧 spriteId 路径仍命中（angle 10 → 15）', Math.abs(appliedSprite[0].params.angle - 15) < 1e-9);
const appliedSpriteMiss = applyProceduralAnimations(mkMods(), [paSprite], '', 1, 'n1') as Array<{ params: { angle: number } }>;
check('D5 spriteId 条目在节点口径下不误命中', appliedSpriteMiss[0].params.angle === 10);

console.log(`\n全部通过：${passed} 项`);
