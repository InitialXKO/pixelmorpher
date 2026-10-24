// 状态机编排纯函数层探针：默认机形状、改名/删除级联、校验、可选表演清单。
import {
  addConditionToSpec,
  addStateToSpec,
  addTransitionToSpec,
  cloneSpec,
  deleteStateFromSpec,
  listOfferedPerformances,
  renameStateInSpec,
  validateStateMachineSpec,
} from '../src/lib/proc-runtime/state-machine-edit';
import { defaultStateMachine } from '../src/lib/proc-runtime/convert';
import type { AnimationClip } from '../src/lib/types';
import type { Character, StateMachineSpec } from '../src/lib/unified-types';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${extra}`); }
}

const spec: StateMachineSpec = {
  version: 1,
  initial: 'idle',
  states: [{ id: 'idle' }, { id: 'move' }, { id: 'perf:atk', performanceId: 'atk' }],
  transitions: [
    { from: 'idle', to: 'move', when: [{ var: 'speed01', op: 'gte', value: 0.05 }] },
    { from: '*', to: 'air', when: [{ var: 'grounded', op: 'eq', value: 0 }] },
  ],
};

// 默认机形状（与 convert 直通的默认机同一函数）
const def = defaultStateMachine([{ id: 'atk' }, { id: 'tracks' }] as Array<Record<string, unknown>>);
check('默认机：常驻三态 + 每表演一状态', def.states.map((s) => s.id).join(',') === 'idle,move,air,perf:atk,perf:tracks');
check('默认机：初始 idle、5 条转移', def.initial === 'idle' && def.transitions.length === 5);

// 改名级联
const renamed = renameStateInSpec(spec, 'idle', 'stand');
check('改名：状态、转移 from/to、initial 一起改',
  !!renamed && renamed.initial === 'stand' && renamed.states[0].id === 'stand'
  && renamed.transitions[0].from === 'stand');
check('改名撞名返回 null', renameStateInSpec(spec, 'idle', 'move') === null);
check('改名不改原对象', spec.states[0].id === 'idle' && cloneSpec(spec).states[0].id === 'idle');

// 删除级联
const deleted = deleteStateFromSpec(spec, 'idle');
check('删除：状态与引用它的转移一起删、initial 退回首个剩余状态',
  deleted.states.map((s) => s.id).join(',') === 'move,perf:atk'
  && deleted.transitions.length === 1 && deleted.initial === 'move');
const deletedAll = deleteStateFromSpec({ version: 1, initial: 'only', states: [{ id: 'only' }], transitions: [] }, 'only');
check('删除最后一个状态后 initial 为空', deletedAll.states.length === 0 && deletedAll.initial === '');

// 新增
const added = addTransitionToSpec(addStateToSpec(spec));
check('新增状态 id 不撞名、新增转移 from 为 *',
  added.states.some((s) => s.id === 'state1') && added.transitions.at(-1)?.from === '*');
const condAdded = addConditionToSpec(spec, 0);
check('新增条件默认 speed01>=0.05', condAdded.transitions[0].when.length === 2);

// 校验
const valid = new Set(['atk']);
check('校验：悬空表演引用预警',
  validateStateMachineSpec(spec, new Set()).some((w) => w.includes('perf:atk')));
check('校验：表演状态无入转移不算不可达',
  !validateStateMachineSpec(spec, valid).some((w) => w.includes('perf:atk') && w.includes('入转移')));
check('校验：常驻非初始状态无入转移给提示',
  validateStateMachineSpec(
    { version: 1, initial: 'idle', states: [{ id: 'idle' }, { id: 'lonely' }], transitions: [] },
    valid,
  ).some((w) => w.includes('lonely')));
check('校验：initial 不存在预警',
  validateStateMachineSpec({ ...spec, initial: 'nope' }, valid).some((w) => w.includes('初始状态')));
check('校验：* 转移算作所有状态的入转移',
  !validateStateMachineSpec(spec, valid).some((w) => w.includes('move') && w.includes('入转移')));

// 可选表演清单
const char = {
  id: 'c1',
  performances: [{ id: 'atk', name: '攻击' }],
  nodes: {
    n1: { tracks: { x: { keyframes: [{ frame: 0, value: 0 }] } } },
    n2: { tracks: { angle: { keyframes: [] } } },
  },
} as unknown as Character;
const clips = [
  { id: 'clipA', name: '挥手', puppetCharacterId: 'c1' },
  { id: 'clipB', name: '别人', puppetCharacterId: 'other' },
] as unknown as AnimationClip[];
const offered = listOfferedPerformances(char, clips);
check('可选清单：作者表演 + 轨道 + 仅绑定片段',
  offered.map((o) => o.id).join(',') === 'atk,tracks,clip_clipA');

console.log(`\n状态机编排校验${fail === 0 ? '全过' : '失败'}（${pass} 项，${fail} 项失败）`);
process.exit(fail === 0 ? 0 : 1);
