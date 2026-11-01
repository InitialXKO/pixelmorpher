// 组 2 页签审计修复探针（操控 / 行为 / 状态机面板接线 / 行为树）：
// - convert 表演段两处点名（残影解析不到槽位、触发名回落 KeyJ）用构造角色对拍；
// - 其余接线（操控武装同步、行为预览喂宿主变量、时间基文案、删表演点名、
//   行为树 mock 对齐）以源码级断言钉住落点与口径，防回退。
// 状态机纯函数（排序 / 禁用清单 / 校验逐目标口径）在 verify-state-machine-edit.mts。
import { readFileSync } from 'node:fs';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import type { Character as UnifiedCharacter, Node as UnifiedNode, ProcPerformance } from '../src/lib/unified-types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${extra}`); }
}
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

console.log('A) convert 表演段点名（构造对拍）');
{
  const grid = [['#ffffff', '#ffffff'], ['#ffffff', '#ffffff']];
  const mkNode = (id: string, slotKey: string | null, parentId?: string): UnifiedNode => ({
    id, name: id, parentId,
    role: 'bone',
    slot: slotKey ? { slotKey } : undefined,
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' },
    sockets: [],
    tracks: {},
    modifiers: [],
    children: [],
    sprite: undefined as never,
  } as unknown as UnifiedNode);
  const root = mkNode('root', null);
  const arm = mkNode('arm', 'arm', 'root');
  root.children = ['arm'];
  const mkPerf = (p: Partial<ProcPerformance> & { id: string; name: string; trigger: string }): ProcPerformance => ({
    duration: 0.5, envelopeIn: 0.05, envelopeOut: 0.15, mode: 'override',
    maskNodeIds: [], graphs: {}, enabled: true, ...p,
  });
  const char = {
    id: 'cb1', name: '点名测试',
    nodes: { root, arm },
    rootNodeId: 'root',
    rootNodeIds: ['root'],
    sprites: { sprA: { id: 'sprA', width: 2, height: 2, data: grid } },
    costumeSets: [{
      id: 'set1', name: '默认',
      pieces: { arm: { sprites: { 2: { spriteId: 'sprA' } } } },
    }],
    activeCostumeSetId: 'set1',
    variants: { '0': '东', '2': '西' },
    performances: [
      // 残影指向不存在的节点 → 解析不到槽位，必须点名；触发名 attack 在映射表内、不点名
      mkPerf({ id: 'p1', name: '残影悬空', trigger: 'attack', afterimageNodeId: 'ghost' }),
      // 触发名不在映射表也不是 Key[A-Z] → 回落 KeyJ，必须点名；无残影设置、不点名残影
      mkPerf({ id: 'p2', name: '怪触发名', trigger: 'super-dash' }),
      // 字面 KeyJ 直通（不是回落）→ 不点名；残影指向真实槽位节点 → 不点名且进包
      mkPerf({ id: 'p3', name: '正常', trigger: 'KeyJ', afterimageNodeId: 'arm' }),
    ],
  } as unknown as UnifiedCharacter;

  const pkg = convertCharacterToRuntimePackage(char, undefined, {});
  const perfs = (pkg as { performances?: Array<Record<string, unknown>> }).performances ?? [];
  const byId = new Map(perfs.map((p) => [p.id, p]));
  ok('残影悬空：点名解析不到槽位', pkg.warnings.some((w) => w.includes('残影悬空') && w.includes('残影') && w.includes('解析不到槽位')));
  ok('残影悬空：afterimage 不进包', byId.get('p1')?.afterimage === undefined);
  ok('怪触发名：点名回落 KeyJ 且包内 triggerKey 为 KeyJ',
    pkg.warnings.some((w) => w.includes('怪触发名') && w.includes('super-dash') && w.includes('KeyJ'))
    && byId.get('p2')?.triggerKey === 'KeyJ');
  ok('怪触发名：无残影设置不点名残影', !pkg.warnings.some((w) => w.includes('怪触发名') && w.includes('残影')));
  ok('字面 KeyJ 与真实残影：不点名、残影进包',
    !pkg.warnings.some((w) => w.includes('正常'))
    && (byId.get('p3')?.afterimage as { part?: string } | undefined)?.part === 'arm');
}

console.log('B) 操控面板：武装同步 + 实际片段可见');
{
  const panel = read('../src/components/pixel-editor/puppet/PerformPanel.tsx');
  ok('武装且角色不一致时按新角色重入 enterPerform 同步会话',
    panel.includes('performArmed && character && performCharacterId !== character.id')
    && panel.includes('enterPerform(character.id)'));
  // 口径修订（2026-11 审计 F-28 / D4-B6）：面板回落与渲染门控不一致
  // 本身就是缺陷——已按渲染侧为准摘除回落，本断言随之改判新口径。
  ok('状态条下显示实际片段名 + 不属于当前角色时明示画布不生效（无回落）',
    panel.includes('实际片段：') && panel.includes('时间线选中的片段不属于当前角色，画布上不生效')
    && !panel.includes('animationClips.find((c) => c.puppetCharacterId === performCharacterId)'));
}

console.log('C) 行为：预览喂宿主变量 + 时间基文案 + 删表演点名');
{
  const editor = read('../src/components/pixel-editor/puppet/BlueprintEditor.tsx');
  ok('BlueprintEditor 行为语境预览变量由 behaviorHostVars 补喂（宿主后盖）',
    editor.includes("from '@/lib/behavior-host'")
    && editor.includes('inBehavior && character')
    && editor.includes('...behaviorHostVars(character, frame, frameRate)'));
  ok('其它语境预览变量构成不变（previewBlueprintVars 本体未改口径）',
    editor.includes('return buildBlueprintVars(mapStoreAnimationVariables(storeVars as any), frame, drivers);'));
  const behavior = read('../src/components/pixel-editor/puppet/BehaviorPanel.tsx');
  ok('行为文案：time 输出秒数、不再称输出帧数',
    behavior.includes('time 节点输出秒数') && !behavior.includes('time 节点输出帧数'));
  ok('表演文案：t 是已播秒数、不再称按帧计',
    behavior.includes('time 节点的 t 是表演已播的秒数') && !behavior.includes('t 按帧计'));
  ok('删表演前查状态机引用并点名受影响状态',
    behavior.includes('character.stateMachine?.states') && behavior.includes('s.performanceId === perf.id')
    && behavior.includes('正被状态机的状态引用'));
}

console.log('D) 行为树：试运行 mock 与模板口径对齐');
{
  const bt = read('../src/components/pixel-editor/puppet/BehaviorTreePanel.tsx');
  ok('setVar 拒绝名单含 wall/ledge（与模板一致）',
    bt.includes("'t', 'phase', 'speed01', 'grounded', 'wall', 'ledge'"));
  ok('intent mock 按表演 id/名称/触发名匹配（与模板 intent() 一致）',
    bt.includes('p.id === name || p.name === name || p.trigger === name'));
  const tpl = read('../src/lib/proc-runtime/runtime-template.ts');
  ok('模板侧名单未被迁就改动（仍含 wall/ledge 拒绝与三键匹配）',
    tpl.includes("name === 'wall'") && tpl.includes("p.id === name || p.name === name || p.trigger === name"));
}

console.log('E) 状态机面板接线（排序按钮 / 禁用占位 / 空输入守卫 / 改名分流）');
{
  const sm = read('../src/components/pixel-editor/puppet/StateMachinePanel.tsx');
  ok('转移行有上移/下移按钮且走 moveTransitionInSpec、两端禁用',
    sm.includes('moveTransitionInSpec') && sm.includes('title="上移（顺序即优先级）"') && sm.includes('disabled={ti === 0}'));
  ok('校验传入 disabledPerfIds、引用已禁用表演有「已禁用」占位',
    sm.includes('validateStateMachineSpec(spec, validPerfIds, disabledPerfIds)') && sm.includes('已禁用：'));
  ok('条件数值框空串不提交',
    sm.includes("e.target.value.trim() === ''"));
  ok('改名空名单独报错、不与撞名混报',
    sm.includes('状态名不能为空') && sm.includes('状态 id 已存在，改名未保存'));
}

console.log(`\n组 2 页签修复探针${fail === 0 ? '全过' : '失败'}（${pass} 项，${fail} 项失败）`);
process.exit(fail === 0 ? 0 : 1);
