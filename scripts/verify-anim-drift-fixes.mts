// ============================================================
// 动画/时间线漂移批修复回归网（2026-11 审计 F-17/F-15/F-14/F-26/
// F-31 行为断言 + F-25/F-28/F-27/撤销/死代码接线断言）
//
// 行为断言测的都是真实现（两条插值链的导出函数、调度器落帧纯
// 函数、convert 真产物、store 真动作、ik-bake 真函数），不是副本。
// ============================================================

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpolateTrack as mainInterpolateTrack } from '../src/lib/unified-render';
import { interpolateTrack as auxInterpolateTrack } from '../src/lib/engine/render-helpers/puppet-keyframe-interpolation';
import { advancePlaybackFrame } from '../src/lib/playback-scheduler';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultCostumePiece } from '../src/lib/unified-types';
import { ikChainsToBlueprint } from '../src/lib/blueprint/ik-bake';
import { defaultSlashSpec } from '../src/lib/slash-fan';
import { useProjectStore } from '../src/lib/store';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗', name, detail ?? ''); }
}
const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// ---------- 1) F-17 两链逐步逐值对拍 ----------
type Kf = { frame: number; value: number; interpolation?: 'step' | 'linear' | 'bezier'; bezierCP1?: { x: number; y: number }; bezierCP2?: { x: number; y: number } };
type Trk = { keyframes: Kf[]; interpolation?: 'step' | 'linear' | 'bezier' };

function assertChainsAgree(name: string, track: Trk, frames: number[]) {
  for (const f of frames) {
    const a = mainInterpolateTrack(track as never, f, -999);
    const b = auxInterpolateTrack(track as never, f, -999);
    if (!approx(a, b)) {
      check(`${name}：帧 ${f} 两链一致`, false, `main=${a} aux=${b}`);
      return;
    }
  }
  check(`${name}：${frames.length} 帧两链逐值一致`, true);
}
const grid = [-3, -1, 0, 1, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13];

const stepTrack: Trk = { interpolation: 'step', keyframes: [{ frame: 0, value: 0 }, { frame: 4, value: 10 }, { frame: 8, value: 20 }] };
assertChainsAgree('step 轨', stepTrack, grid);
check('step 边界帧取新值（主渲染 f=4 → 10）', mainInterpolateTrack(stepTrack as never, 4, -999) === 10);
check('step 边界帧取新值（主渲染 f=8 → 20）', mainInterpolateTrack(stepTrack as never, 8, -999) === 20);
check('step 边界前一帧仍旧值（f=3 → 0）', mainInterpolateTrack(stepTrack as never, 3, -999) === 0);

const linearTrack: Trk = { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 100 }] };
assertChainsAgree('linear 轨', linearTrack, grid);
check('linear 中点（f=5 → 50）', approx(mainInterpolateTrack(linearTrack as never, 5, -999), 50));

const bezierTrack: Trk = { interpolation: 'bezier', keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 100 }] };
assertChainsAgree('bezier 轨（缺省 CP）', bezierTrack, grid);
const bezMid = mainInterpolateTrack(bezierTrack as never, 2, -999);
check('bezier 真生效：f=2 偏离线性值 20（缓动曲线）', Math.abs(bezMid - 20) > 0.5, `bez=${bezMid}`);
check('bezier 端点精确（f=0 → 0、f=10 → 100）',
  mainInterpolateTrack(bezierTrack as never, 0, -999) === 0 && mainInterpolateTrack(bezierTrack as never, 10, -999) === 100);

const bezierCpTrack: Trk = {
  interpolation: 'bezier',
  keyframes: [
    { frame: 0, value: 0, bezierCP1: { x: 0.1, y: 0.9 } },
    { frame: 10, value: 100, bezierCP2: { x: 0.9, y: 0.1 } },
  ],
};
assertChainsAgree('bezier 轨（自定义 CP）', bezierCpTrack, grid);
check('bezier CP 真被读：自定义 CP 的 f=2 与缺省 CP 不同',
  !approx(mainInterpolateTrack(bezierCpTrack as never, 2, -999), bezMid, 1e-6));

const dupLinear: Trk = { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 5, value: 10 }, { frame: 5, value: 20 }, { frame: 10, value: 30 }] };
assertChainsAgree('同帧多键 linear 轨', dupLinear, grid);
check('同帧多键：恰帧取最后一点（f=5 → 20）', mainInterpolateTrack(dupLinear as never, 5, -999) === 20
  && auxInterpolateTrack(dupLinear as never, 5, -999) === 20);
check('同帧多键：入段趋近第一点（f=4 → 8）', approx(mainInterpolateTrack(dupLinear as never, 4, -999), 8));
check('同帧多键：出段自最后一点（f=7 → 24）', approx(mainInterpolateTrack(dupLinear as never, 7, -999), 24));

const dupStep: Trk = { interpolation: 'step', keyframes: [{ frame: 0, value: 0 }, { frame: 5, value: 10 }, { frame: 5, value: 20 }, { frame: 10, value: 30 }] };
assertChainsAgree('同帧多键 step 轨', dupStep, grid);
check('同帧多键 step：f=5 → 20、f=4 → 0', mainInterpolateTrack(dupStep as never, 5, -999) === 20
  && mainInterpolateTrack(dupStep as never, 4, -999) === 0);

const pointModeTrack: Trk = {
  interpolation: 'linear',
  keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 100, interpolation: 'step' }],
};
assertChainsAgree('点级模式覆盖轨级（目标点 step）', pointModeTrack, grid);
check('点级 step：f=5 仍取旧值 0', mainInterpolateTrack(pointModeTrack as never, 5, -999) === 0
  && auxInterpolateTrack(pointModeTrack as never, 5, -999) === 0);

check('空轨/无轨回落缺省值两链一致',
  mainInterpolateTrack(undefined, 3, -999) === -999 && auxInterpolateTrack(undefined, 3, -999) === -999);

// ---------- 2) F-15 调度落帧 ----------
check('无片段：窗内前进', advancePlaybackFrame(5, 1, 24) === 6);
check('无片段：末尾回绕', advancePlaybackFrame(23, 1, 24) === 0);
check('无片段：多帧回绕', advancePlaybackFrame(22, 5, 24) === 3);
const loopClip = { startFrame: 10, endFrame: 19, loop: true };
check('片段 loop：窗内前进', advancePlaybackFrame(15, 1, 24, loopClip) === 16);
check('片段 loop：末帧回绕到窗起', advancePlaybackFrame(19, 1, 24, loopClip) === 10);
check('片段 loop：多帧回绕', advancePlaybackFrame(15, 10, 24, loopClip) === 15);
check('片段 loop：播放头在窗前 → 纳入窗起', advancePlaybackFrame(0, 1, 24, loopClip) === 10);
check('片段 loop：播放头越窗尾 → 回绕入窗', advancePlaybackFrame(23, 1, 24, loopClip) === 14);
const onceClip = { startFrame: 10, endFrame: 19, loop: false };
check('片段非 loop：末帧停住不绕圈', advancePlaybackFrame(19, 1, 24, onceClip) === 19);
check('片段非 loop：越尾钳末帧', advancePlaybackFrame(19, 5, 24, onceClip) === 19);
check('片段非 loop：窗前纳入窗起', advancePlaybackFrame(0, 1, 24, onceClip) === 10);
check('片段非 loop：窗内前进', advancePlaybackFrame(15, 3, 24, onceClip) === 18);
check('单帧片段 loop：恒在该帧', advancePlaybackFrame(7, 1, 24, { startFrame: 7, endFrame: 7, loop: true }) === 7);
check('非法窗（end<start）回落工程口径', advancePlaybackFrame(23, 1, 24, { startFrame: 19, endFrame: 10, loop: true }) === 0);

// ---------- 3) F-14 convert 双写防线 + F-27 图内悬空点名 ----------
const spr = {
  id: 'gspr', width: 2, height: 2,
  plug: { x: 0, y: 0 },
  data: [['#aabbcc', '#aabbcc'], ['#aabbcc', '#aabbcc']],
  directions: { 2: { spriteId: 'gspr', mirror: false } },
} as never;
const mkChar = (performances?: unknown[]) => ({
  id: 'chF', name: '防线测试',
  nodes: {
    arm: {
      id: 'arm', name: '手臂', role: 'bone',
      slot: { slotKey: 'arm' },
      transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
      attachment: { type: 'fixed' }, sockets: [], modifiers: [], children: [],
      tracks: { angle: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 12, value: 60 }] } },
    },
  },
  rootNodeId: 'arm',
  sprites: { gspr: spr },
  costumeSets: [{
    id: 'set1', name: '默认',
    pieces: { arm: { ...createDefaultCostumePiece('arm'), sprites: { 2: { spriteId: 'gspr', mirror: false } } } },
  }],
  activeCostumeSetId: 'set1',
  variants: {},
  ...(performances ? { performances } : {}),
}) as never;

const projFx = [{ id: 'et1', type: 'glow', name: '辉光', visible: true, keyframes: [{ frame: 0, params: { radius: 3 } }] }];
const projMb = [{ id: 'mb1', points: [{ frame: 0, x: 1, y: 2 }] }];
const projEs = [{ id: 'es1', points: [{ frame: 0, x: 3, y: 4 }] }];
const projCm = [{ id: 'cm1', type: 'bloom', name: '泛光', visible: true, enabled: true, modifiers: [], keyframes: [] }];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const clipSame = {
  id: 'cs', name: '迁移片段', puppetCharacterId: 'chF', startFrame: 2, endFrame: 8, loop: false,
  effectTracks: clone(projFx), motionBlurStrokes: clone(projMb), effectStrokes: clone(projEs),
  canvasModifierTracks: clone(projCm),
} as never;
const clipDiff = {
  id: 'cd', name: '真片段', puppetCharacterId: 'chF', startFrame: 2, endFrame: 8, loop: false,
  effectTracks: [{ id: 'etX', type: 'particle', name: '粒子', visible: true, keyframes: [{ frame: 1, params: { rate: 5 } }] }],
} as never;

const pkgF = convertCharacterToRuntimePackage(mkChar(), undefined, {
  clips: [clipSame, clipDiff],
  projectData: { effectTracks: projFx, motionBlurStrokes: projMb, effectStrokes: projEs, canvasModifierTracks: projCm },
} as never);
type PerfFx = { id?: string; fx?: { effectTracks?: unknown[]; motionBlurStrokes?: unknown[]; effectStrokes?: unknown[]; canvasTracks?: unknown[] } };
const perfSame = (pkgF.performances as PerfFx[]).find((p) => p.id === 'clip_cs');
const perfDiff = (pkgF.performances as PerfFx[]).find((p) => p.id === 'clip_cd');
check('F-14 前提：两片段都生成段表演', !!perfSame && !!perfDiff);
check('F-14 效果轨双写点名', pkgF.warnings.some((w) => w.includes('片段「迁移片段」效果轨与工程级逐项相同')));
check('F-14 运动模糊笔触双写点名', pkgF.warnings.some((w) => w.includes('运动模糊笔触与工程级逐项相同')));
check('F-14 效果笔触双写点名', pkgF.warnings.some((w) => w.includes('效果笔触与工程级逐项相同')));
check('F-14 画布轨双写点名（既有防线不回归）', pkgF.warnings.some((w) => w.includes('画布效果轨与工程级逐项相同')));
check('F-14 双写片段 fx 全抑制（不双画）', perfSame?.fx === undefined, `fx=${JSON.stringify(perfSame?.fx)}`);
check('F-14 真不同的片段效果轨照常入包', (perfDiff?.fx?.effectTracks?.length ?? 0) === 1);
check('F-14 真片段不被误点名', !pkgF.warnings.some((w) => w.includes('真片段') && w.includes('逐项相同')));

// F-27：表演图内引用形态节点悬空（字段为空）
const danglingPerf = {
  id: 'pf1', name: '悬空表演', enabled: true, trigger: 'manual', duration: 1,
  maskNodeIds: ['arm'],
  graphs: {
    arm: {
      version: 1, outputId: 'out',
      nodes: [
        { id: 'slashfx', type: 'slash_fan', inputs: {}, params: { enabled: true, __defId: 'defGONE' }, ui: { x: 0, y: 0 } },
      ],
    },
  },
} as never;
const pkgDangling = convertCharacterToRuntimePackage(mkChar([danglingPerf]));
check('F-27 图内悬空引用点名', pkgDangling.warnings.some((w) => w.includes('图内引用的共享定义（defGONE）不存在')),
  pkgDangling.warnings.join(' | '));
const okPerf = {
  id: 'pf2', name: '正常表演', enabled: true, trigger: 'manual', duration: 1,
  maskNodeIds: ['arm'],
  graphs: {
    arm: {
      version: 1, outputId: 'out',
      nodes: [
        { id: 'slashfx', type: 'slash_fan', inputs: {}, params: { enabled: true, __defId: 'defOK' }, ui: { x: 0, y: 0 } },
      ],
    },
  },
} as never;
const charWithDef = { ...(mkChar([okPerf]) as object), slashDefs: [{ id: 'defOK', name: '真定义', spec: defaultSlashSpec() }] } as never;
const pkgOk = convertCharacterToRuntimePackage(charWithDef);
check('F-27 引用存在时不误点名', !pkgOk.warnings.some((w) => w.includes('图内引用的共享定义')));
const fieldDanglingPerf = { id: 'pf3', name: '字段悬空', enabled: true, trigger: 'manual', duration: 1, maskNodeIds: [], graphs: {}, slashDefId: 'defGONE2' } as never;
const pkgField = convertCharacterToRuntimePackage(mkChar([fieldDanglingPerf]));
check('F-27 字段悬空点名（既有口径不回归）', pkgField.warnings.some((w) => w.includes('引用的共享定义（defGONE2）不存在')));

// ---------- 5) F-26 parentKeys 帧级操作（真 store） ----------
const store = () => useProjectStore.getState();
function seedNodeWithParentKey() {
  useProjectStore.setState({
    unifiedCharacters: {
      chK: {
        id: 'chK', name: 'K', rootNodeId: 'n1',
        nodes: {
          n1: {
            id: 'n1', name: '节点', transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
            attachment: { type: 'fixed' }, sockets: [], modifiers: [], children: [],
            tracks: {
              parentKeys: { interpolation: 'step', keyframes: [{ frame: 3, value: { parentId: 'rootB' } }] },
            },
          },
        },
        costumeSets: [], directionDrawOrders: {},
      },
    },
    undoStack: [], redoStack: [],
  } as never);
}
const parentFrames = () => {
  const n = store().unifiedCharacters['chK']?.nodes['n1'];
  return (n?.tracks?.parentKeys?.keyframes ?? []).map((k) => k.frame);
};
{
  seedNodeWithParentKey();
  const okCopy = store().copyNodeFrameKeys('chK', 'n1', 3, 7);
  check('F-26 只有 parentKeys 点时复制不再误判无点', okCopy === true);
  check('F-26 复制带 parentKeys（帧 [3,7]）', JSON.stringify(parentFrames()) === '[3,7]', `frames=${parentFrames()}`);
}
{
  seedNodeWithParentKey();
  const okMove = store().moveNodeFrameKeys('chK', 'n1', 3, 9);
  check('F-26 移动带 parentKeys（帧 [9]）', okMove === true && JSON.stringify(parentFrames()) === '[9]', `frames=${parentFrames()}`);
}
{
  seedNodeWithParentKey();
  store().clearNodeFrameKeys('chK', 'n1', 3);
  check('F-26 删除带 parentKeys（帧 []）', JSON.stringify(parentFrames()) === '[]', `frames=${parentFrames()}`);
}

// ---------- 8) 撤销补压（真 store） ----------
{
  seedNodeWithParentKey();
  const before = store().undoStack.length;
  store().setNodeFrameInterpolation('chK', 'n1', 3, 'step');
  check('撤销：setNodeFrameInterpolation 已压栈', store().undoStack.length === before + 1);
}
{
  useProjectStore.setState({
    animationClips: [{ id: 'cl1', name: '片段', puppetCharacterId: 'chK', startFrame: 0, endFrame: 8, loop: false, effectTracks: [], canvasModifierTracks: [], motionBlurStrokes: [], effectStrokes: [], tags: [] }],
    activeAnimationClipId: 'cl1', undoStack: [], redoStack: [],
  } as never);
  store().updateAnimationClip('cl1', { name: '改名' });
  check('撤销：updateAnimationClip 已压栈', store().undoStack.length === 1);
  store().updateAnimationClip('cl1', { name: '再改名' });
  check('撤销：updateAnimationClip 连续编辑合并一步（coalesce）', store().undoStack.length === 1);
  check('撤销：片段改名生效', store().animationClips[0]?.name === '再改名');
}

// ---------- 7) F-31 ik-bake 三维骨长 ----------
{
  const sub = (px: number) => (px * 16) as never;
  const wt = (x: number, y: number, z: number) => ({ worldX: sub(x), worldY: sub(y), worldZ: sub(z), variantIndex: 6 }) as never;
  const chIk = {
    id: 'chIk', name: 'IK',
    nodes: {
      root: { id: 'root', name: '根', transform: { x: 0, y: 0, angle: 0, variantIndex: 6, stretch: 1 }, attachment: { type: 'fixed' }, sockets: [], modifiers: [], children: ['mid'] },
      mid: { id: 'mid', name: '中', parentId: 'root', transform: { x: 0, y: 0, angle: 0, variantIndex: 6, stretch: 1 }, attachment: { type: 'fixed' }, sockets: [], modifiers: [], children: ['end'] },
      end: { id: 'end', name: '末', parentId: 'mid', transform: { x: 0, y: 0, angle: 0, variantIndex: 6, stretch: 1 }, attachment: { type: 'fixed' }, sockets: [], modifiers: [], children: [] },
    },
    rootNodeId: 'root', costumeSets: [], directionDrawOrders: {},
    ikChains: [{ id: 'chain1', rootNodeId: 'root', endNodeId: 'end', enabled: true, solver: '2bone', target3D: { x: 10, y: 10, z: 0 } }],
  } as never;
  const transforms = new Map<string, never>([
    ['root', wt(0, 0, 0)],
    ['mid', wt(10, 0, 0)],
    ['end', wt(10, 0, 6)],
  ]);
  const bp = ikChainsToBlueprint(chIk, transforms as never);
  const ikNode = bp?.nodes.find((n) => n.id === 'ik_chain1');
  check('F-31 烘焙产出 ik_2bone 节点', !!ikNode);
  check('F-31 len1 平面段 = 10', approx(Number(ikNode?.params.len1), 10, 1e-9), `len1=${ikNode?.params.len1}`);
  check('F-31 len2 含 Z 分离 = 6（旧二维量法得 0）', approx(Number(ikNode?.params.len2), 6, 1e-9), `len2=${ikNode?.params.len2}`);
}

// ---------- 4/6/9/10 接线断言（源码级） ----------
{
  const panel = readFileSync(join(root, 'src/components/pixel-editor/AnimationClipPanel.tsx'), 'utf8');
  check('F-25 复制片段带 slashEffect 深拷贝', panel.includes('slashEffect: clip.slashEffect ? structuredClone(clip.slashEffect) : undefined'));
  check('F-25 复制片段带 slashDefId 与 thumbnail', panel.includes('slashDefId: clip.slashDefId') && panel.includes('thumbnail: clip.thumbnail'));

  const perform = readFileSync(join(root, 'src/components/pixel-editor/puppet/PerformPanel.tsx'), 'utf8');
  check('F-28 面板已无片段回落分支', !perform.includes('animationClips.find((c) => c.puppetCharacterId === performCharacterId)'));
  check('F-28 面板文案改为画布口径（不生效）', perform.includes('画布上不生效') && !perform.includes('（时间线选中的片段不属于当前角色，已回落）'));

  const specs = readFileSync(join(root, 'src/lib/blueprint/specs.ts'), 'utf8');
  // 改判（slash_fan 接线消费落地，用户裁定）：F-27 当时把 specs 宣称
  // 改成「不改变任何出图/进包结果」的实况；现接线已由 convert 在
  // t=0 真消费，实况再变——断言随之改钉新实况、且旧宣称不得回潮。
  check('F-27 specs 接线覆盖宣称已改实况', specs.includes('生产消费点是 convert 进包')
    && !specs.includes('当前不改变任何出图/进包结果'));

  const types = readFileSync(join(root, 'src/lib/types.ts'), 'utf8');
  check('F-14 types 注释改为工程级唯一编辑面', types.includes('工程级效果轨/笔触（现行唯一编辑面）') && !types.includes('the active clip\'s data takes precedence'));
  const pslice = readFileSync(join(root, 'src/lib/store/project-slice.ts'), 'utf8');
  check('F-14 project-slice 空同步块已删', !pslice.includes('Sync legacy fields'));

  check('死代码：presets.ts 已删', !existsSync(join(root, 'src/lib/presets.ts')));
  check('死代码：motion-analysis.ts 已删', !existsSync(join(root, 'src/lib/motion-analysis.ts')));
  check('死代码：motionAnalysisSplit 全仓无残留', !pslice.includes('motionAnalysisSplit')
    && !readFileSync(join(root, 'src/lib/store/types.ts'), 'utf8').includes('motionAnalysisSplit'));
  const csv = readFileSync(join(root, 'src/lib/csv-waveform.ts'), 'utf8');
  check('死代码：parseCSVWaveform 已删、采样半保留', !csv.includes('export function parseCSVWaveform') && csv.includes('export function sampleWaveformAtFrame'));
  const proc = readFileSync(join(root, 'src/lib/engine/procedural.ts'), 'utf8');
  check('死代码：applyProceduralAnimations 本体已删', !proc.includes('export function applyProceduralAnimations'));
  check('死代码：engine/index 不再导出旧函数', !readFileSync(join(root, 'src/lib/engine/index.ts'), 'utf8').includes('applyProceduralAnimations'));
}

console.log(`\nverify-anim-drift-fixes: ${passed} 过 / ${failed} 败`);
if (failed > 0) process.exit(1);
assert.ok(failed === 0);
