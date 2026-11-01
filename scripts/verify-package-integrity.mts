/**
 * verify-package-integrity.mts — 审计进包批锁定探针（PR #80 域7/F-09/F-10/F-12/F-13）
 *
 * 逐项正反断言：
 * A) F-09 角色级蓝图 character.blueprint：包内无承载结构 → 点名；无蓝图/空图不点名
 * B) 域7-错7 输入轨 inputTracks：有关键帧 → 点名（与事件轨同口径）；空轨不点名
 * C) F-12 片段 frameTags：包内段表演无标签消费形态 → 逐片段点名；无标签不点名
 * D) 域4-E7 enabled:false 表演：convert 跳过时点名；启用表演不点名
 * E) 域7-错5 altSprites 跨集近似：跨集+变体同时切换 → 点名 + 替代图照常进包；
 *    只切集或只改变体不点名
 * F) F-10 状态蓝图真进包：片段窗内逐帧采样三层合成 → stateFx 条目与编辑器
 *    resolveEffectiveCostumeState 逐帧差分一致；蓝图变体进 altSprites；
 *    无蓝图时第二层走旧路不变；无片段承载且确有切换 → 点名，恒等基线不点名
 * G) F-13 逐槽「本集为空」：非生效集解析为空写显式标记（__dynamic [] /
 *    __glow null / __sprite null），模板三处按「键存在」判读的源码断言；
 *    该集有内容时不写标记；生效集不写标记
 * H) 域7-错4/错6：模板 bounce 缺省 0.45（源码断言）；convert 无片段级空循环残留
 */
import { readFileSync } from 'node:fs';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultCostumePiece } from '../src/lib/unified-types';
import { createDynamicInstance, defaultDynamicParams } from '../src/lib/dynamic-patterns';
import type { Character } from '../src/lib/unified-types';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log('✓', name); }
  else { failed++; console.error('✗', name, detail); }
}
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const template = read('../src/lib/proc-runtime/runtime-template.ts');
const convertSrc = read('../src/lib/proc-runtime/convert.ts');

function makeNode(id: string, name: string, slotKey: string | null, extra: Record<string, unknown> = {}): never {
  return {
    id, name, parentId: undefined,
    role: 'bone',
    slot: slotKey ? { slotKey } : undefined,
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' },
    sockets: [],
    tracks: {},
    modifiers: [],
    children: [],
    sprite: undefined,
    ...extra,
  } as never;
}
const gridOf = (color: string, w = 4, h = 4): (string | null)[][] =>
  Array.from({ length: h }, () => Array(w).fill(color));
const sprObj = (id: string, color: string) => ({
  id, width: 4, height: 4, plug: { x: 0, y: 0 }, data: gridOf(color),
});
const pieceWithSprite = (slotKey: string, spr: unknown, extra: Record<string, unknown> = {}) => ({
  ...createDefaultCostumePiece(slotKey),
  sprites: { 2: spr },
  ...extra,
});
const baseChar = (extra: Record<string, unknown> = {}): Character => ({
  id: 'ch', name: '测试角',
  nodes: { arm: makeNode('arm', '臂', 'arm') },
  rootNodeId: 'arm', rootNodeIds: ['arm'],
  costumeSets: [{ id: 'csA', name: '甲', pieces: {} }],
  activeCostumeSetId: 'csA',
  variants: {},
  ...extra,
} as unknown as Character);
const mkClip = (extra: Record<string, unknown> = {}): never => ({
  id: 'c1', name: '片段一', puppetCharacterId: 'ch',
  startFrame: 0, endFrame: 12, loop: false,
  effectTracks: [], canvasModifierTracks: [], motionBlurStrokes: [], effectStrokes: [],
  tags: [], createdAt: 0, updatedAt: 0,
  ...extra,
} as never);
const hasWarn = (pkg: { warnings: string[] }, s: string) => pkg.warnings.some((w) => w.includes(s));

// ---------- A) F-09 角色级蓝图点名 ----------
{
  const bp = { version: 1, outputId: 'n1', nodes: [{ id: 'n1', type: 'const', inputs: {}, params: { value: 1 } }] };
  const pkg = convertCharacterToRuntimePackage(baseChar({ blueprint: bp }));
  check('A1 角色级蓝图有点名', hasWarn(pkg, '角色级蓝图') && hasWarn(pkg, '未进包'), pkg.warnings.join('；'));
  const pkg2 = convertCharacterToRuntimePackage(baseChar());
  check('A2 无蓝图不点名', !hasWarn(pkg2, '角色级蓝图'));
  const pkg3 = convertCharacterToRuntimePackage(baseChar({ blueprint: { version: 1, outputId: '', nodes: [] } }));
  check('A3 空蓝图不点名', !hasWarn(pkg3, '角色级蓝图'));
}

// ---------- B) 输入轨点名 ----------
{
  const pkg = convertCharacterToRuntimePackage(baseChar({
    inputTracks: { moveX: { keyframes: [{ frame: 0, value: 0 }, { frame: 6, value: 1 }] } },
  }));
  check('B1 输入轨有键点名', hasWarn(pkg, '输入轨含关键帧'), pkg.warnings.join('；'));
  const pkg2 = convertCharacterToRuntimePackage(baseChar({
    inputTracks: { moveX: { keyframes: [] }, grounded: { keyframes: [] } },
  }));
  check('B2 输入轨空键不点名', !hasWarn(pkg2, '输入轨'));
}

// ---------- C) frameTags 点名 ----------
{
  const clip = mkClip({
    frameTags: [{ id: 't1', name: '起手', startFrame: 0, endFrame: 3, color: '#fff', loop: 'once', direction: 'forward' }],
  });
  const pkg = convertCharacterToRuntimePackage(baseChar(), undefined, { clips: [clip] });
  check('C1 frameTags 点名', hasWarn(pkg, '帧标签') && hasWarn(pkg, '片段一'), pkg.warnings.join('；'));
  const pkg2 = convertCharacterToRuntimePackage(baseChar(), undefined, { clips: [mkClip()] });
  check('C2 无标签不点名', !hasWarn(pkg2, '帧标签'));
}

// ---------- D) enabled:false 表演点名 ----------
{
  const perf = {
    id: 'p1', name: '禁用表演', enabled: false, trigger: 'attack', duration: 1,
    envelopeIn: 0, envelopeOut: 0, mode: 'add', maskNodeIds: [], graphs: {},
  } as never;
  const pkg = convertCharacterToRuntimePackage(baseChar({ performances: [perf] }));
  check('D1 禁用表演点名', hasWarn(pkg, '已禁用') && hasWarn(pkg, '禁用表演'), pkg.warnings.join('；'));
  check('D2 禁用表演不进包', !pkg.performances.some((p) => p.name === '禁用表演'));
  const perfOn = { ...(perf as object), enabled: true } as never;
  const pkg2 = convertCharacterToRuntimePackage(baseChar({ performances: [perfOn] }));
  check('D3 启用表演不点名禁用', !hasWarn(pkg2, '已禁用'));
}

// ---------- E) altSprites 跨集近似点名 ----------
{
  const sprBase = sprObj('sprBase', '#111111');
  const sprAlt = sprObj('sprAlt', '#222222');
  const piece = pieceWithSprite('arm', sprBase, {
    variantSprites: { vX: { 2: sprAlt } },
  });
  const ch = baseChar({
    costumeSets: [
      { id: 'csA', name: '甲', pieces: { arm: piece } },
      { id: 'csB', name: '乙', pieces: { arm: pieceWithSprite('arm', sprBase) } },
    ],
  });
  const crossClip = mkClip({ stateKeyframes: [{ frame: 2, costumeSetId: 'csB', slotChanges: { arm: 'vX' } }] });
  const pkg = convertCharacterToRuntimePackage(ch, undefined, { clips: [crossClip] });
  check('E1 跨集+变体点名', hasWarn(pkg, '变体替代精灵'), pkg.warnings.join('；'));
  const part = pkg.parts.find((p) => p.key === 'arm');
  check('E2 替代图照常进包', !!part?.altSprites?.['vX'], JSON.stringify(part?.altSprites && Object.keys(part.altSprites)));
  const setOnlyClip = mkClip({ stateKeyframes: [{ frame: 2, costumeSetId: 'csB' }] });
  const pkg2 = convertCharacterToRuntimePackage(ch, undefined, { clips: [setOnlyClip] });
  check('E3 只切集不点名', !hasWarn(pkg2, '变体替代精灵'));
  const varOnlyClip = mkClip({ stateKeyframes: [{ frame: 2, slotChanges: { arm: 'vX' } }] });
  const pkg3 = convertCharacterToRuntimePackage(ch, undefined, { clips: [varOnlyClip] });
  check('E4 只改变体不点名', !hasWarn(pkg3, '变体替代精灵'));
}

// ---------- F) 状态蓝图真进包 ----------
const gatedBp = (csParams: Record<string, unknown>) => ({
  version: 1, outputId: 'cs',
  nodes: [
    { id: 'tm', type: 'time', inputs: {}, params: {} },
    { id: 'st', type: 'step', inputs: { x: { nodeId: 'tm', output: 'out' } }, params: { edge: 0.5 } },
    { id: 'cs', type: 'costume_state', inputs: { gate: { nodeId: 'st', output: 'out' } }, params: csParams },
  ],
});
const trackNode = () => makeNode('arm', '臂', 'arm', {
  tracks: { x: { keyframes: [{ frame: 0, value: 0 }, { frame: 12, value: 160 }] } },
});
{
  // F1: 第 6 帧起（t=0.5s，fps=12）蓝图切到 csB
  const sprA = sprObj('sprA', '#111111');
  const sprB = sprObj('sprB', '#333333');
  const ch = baseChar({
    nodes: { arm: trackNode() },
    costumeSets: [
      { id: 'csA', name: '甲', pieces: { arm: pieceWithSprite('arm', sprA) } },
      { id: 'csB', name: '乙', pieces: { arm: pieceWithSprite('arm', sprB) } },
    ],
    stateBlueprint: gatedBp({ setId: 'csB' }),
  });
  const pkg = convertCharacterToRuntimePackage(ch, undefined, {
    frameRate: 12, totalFrames: 13, clips: [mkClip()],
  });
  const perf = pkg.performances.find((p) => p.id === 'clip_c1') as { stateFx?: unknown } | undefined;
  check('F1 段表演已生成', !!perf, JSON.stringify(pkg.performances.map((p) => p.id)));
  check('F1 蓝图切集折成 stateFx 条目', JSON.stringify(perf?.stateFx) === JSON.stringify([{ t: 0.5, costume: 'csB' }]),
    JSON.stringify(perf?.stateFx));
  check('F1 真进包不点名缺失', !hasWarn(pkg, '状态蓝图'), pkg.warnings.join('；'));

  // F2: 第二层 vA（帧 0）+ 第三层第 6 帧覆为 vB，变体都进 altSprites
  const sprVA = sprObj('sprVA', '#444444');
  const sprVB = sprObj('sprVB', '#555555');
  const pieceV = pieceWithSprite('arm', sprA, {
    variantSprites: { vA: { 2: sprVA }, vB: { 2: sprVB } },
  });
  const ch2 = baseChar({
    nodes: { arm: trackNode() },
    costumeSets: [
      { id: 'csA', name: '甲', pieces: { arm: pieceV } },
      { id: 'csB', name: '乙', pieces: { arm: pieceWithSprite('arm', sprB) } },
    ],
    stateBlueprint: gatedBp({ slot: 'arm', variant: 'vB' }),
  });
  const clip2 = mkClip({ stateKeyframes: [{ frame: 0, slotChanges: { arm: 'vA' } }] });
  const pkg2 = convertCharacterToRuntimePackage(ch2, undefined, {
    frameRate: 12, totalFrames: 13, clips: [clip2],
  });
  const perf2 = pkg2.performances.find((p) => p.id === 'clip_c1') as { stateFx?: unknown } | undefined;
  check('F2 三层差分条目（第二层 t=0 + 第三层 t=0.5 覆盖）',
    JSON.stringify(perf2?.stateFx) === JSON.stringify([
      { t: 0, slots: { arm: 'vA' } },
      { t: 0.5, slots: { arm: 'vB' } },
    ]), JSON.stringify(perf2?.stateFx));
  const part2 = pkg2.parts.find((p) => p.key === 'arm');
  check('F2 蓝图变体进 altSprites', !!part2?.altSprites?.['vA'] && !!part2?.altSprites?.['vB'],
    JSON.stringify(part2?.altSprites && Object.keys(part2.altSprites)));

  // F3: 无蓝图时第二层旧路不变
  const ch3 = baseChar({
    nodes: { arm: trackNode() },
    costumeSets: [
      { id: 'csA', name: '甲', pieces: { arm: pieceV } },
      { id: 'csB', name: '乙', pieces: { arm: pieceWithSprite('arm', sprB) } },
    ],
  });
  const pkg3 = convertCharacterToRuntimePackage(ch3, undefined, {
    frameRate: 12, totalFrames: 13, clips: [clip2],
  });
  const perf3 = pkg3.performances.find((p) => p.id === 'clip_c1') as { stateFx?: unknown } | undefined;
  check('F3 无蓝图第二层旧路不变',
    JSON.stringify(perf3?.stateFx) === JSON.stringify([{ t: 0, slots: { arm: 'vA' } }]),
    JSON.stringify(perf3?.stateFx));

  // F4: 无片段承载 + 蓝图确有切换 → 点名；蓝图恒等基线 → 不点名
  const chNoClip = baseChar({
    nodes: { arm: trackNode() },
    costumeSets: [
      { id: 'csA', name: '甲', pieces: { arm: pieceWithSprite('arm', sprA) } },
      { id: 'csB', name: '乙', pieces: { arm: pieceWithSprite('arm', sprB) } },
    ],
    stateBlueprint: { version: 1, outputId: 'cs', nodes: [{ id: 'cs', type: 'costume_state', inputs: {}, params: { setId: 'csB' } }] },
  });
  const pkg4 = convertCharacterToRuntimePackage(chNoClip, undefined, { totalFrames: 12 });
  check('F4 无片段承载点名', hasWarn(pkg4, '状态蓝图') && hasWarn(pkg4, '未进包'), pkg4.warnings.join('；'));
  const chSame = baseChar({
    nodes: { arm: trackNode() },
    costumeSets: [
      { id: 'csA', name: '甲', pieces: { arm: pieceWithSprite('arm', sprA) } },
      { id: 'csB', name: '乙', pieces: { arm: pieceWithSprite('arm', sprB) } },
    ],
    stateBlueprint: { version: 1, outputId: 'cs', nodes: [{ id: 'cs', type: 'costume_state', inputs: {}, params: { setId: 'csA' } }] },
  });
  const pkg5 = convertCharacterToRuntimePackage(chSame, undefined, { totalFrames: 12 });
  check('F4 蓝图恒等基线不点名', !hasWarn(pkg5, '状态蓝图'), pkg5.warnings.join('；'));
}

// ---------- G) F-13 逐槽本集为空 ----------
{
  // 精灵槽：csA 有图、csB 无件 → __sprite.arm === null；csB 有件时为图
  const sprA = sprObj('sprA', '#111111');
  const ch = baseChar({
    costumeSets: [
      { id: 'csA', name: '甲', pieces: { arm: pieceWithSprite('arm', sprA) } },
      { id: 'csB', name: '乙', pieces: {} },
      { id: 'csC', name: '丙', pieces: { arm: pieceWithSprite('arm', sprObj('sprC', '#666666')) } },
    ],
  });
  const pkg = convertCharacterToRuntimePackage(ch);
  const csB = pkg.costumes['csB'] as { __sprite?: Record<string, unknown> };
  check('G1 无件集精灵槽写 null 标记', !!csB.__sprite && 'arm' in csB.__sprite && csB.__sprite['arm'] === null,
    JSON.stringify(csB.__sprite && Object.keys(csB.__sprite)));
  const csC = pkg.costumes['csC'] as { __sprite?: Record<string, { data?: unknown } | null> };
  check('G2 有件集精灵槽为图非标记', !!csC.__sprite?.['arm'] && typeof csC.__sprite['arm'] === 'object');
  const csA = pkg.costumes['csA'] as { __sprite?: Record<string, unknown> };
  check('G3 生效集精灵槽为图非标记', !!csA.__sprite?.['arm'] && csA.__sprite['arm'] !== null);

  // 动态 + 发光：节点挂发光实例，csB 件以同效果位 enabled:false 压制
  const grid = gridOf('#2ea8ff', 4, 3);
  const sprG = { id: 'gspr', width: 4, height: 3, plug: { x: 0, y: 0 }, data: grid } as never;
  const glowInst = createDynamicInstance('辉光呼吸', {
    ...defaultDynamicParams(), glowEnabled: true, glowMaskSource: 'color', glowPick: '#2ea8ff', glowHalo: 1, emitEnabled: false,
  }, '辉光');
  const gemNode = makeNode('gem', '宝石', 'gem', { dynamicPatterns: [glowInst] });
  const gemPiece = {
    ...createDefaultCostumePiece('gem'),
    sprites: { 2: { spriteId: 'gspr', mirror: false } },
  };
  const gemPieceOff = {
    ...createDefaultCostumePiece('gem'),
    sprites: { 2: { spriteId: 'gspr', mirror: false } },
    // 同效果位「辉光」的独立禁用实例（新 id）：resolveDynamicPatterns
    // 按效果位压制节点挂载——与编辑器里件挂载禁用的实际数据形态一致
    dynamicPatterns: [{ ...createDynamicInstance('辉光呼吸', glowInst.params, '辉光'), enabled: false }],
  };
  const chG = {
    id: 'chG', name: '发光角',
    nodes: { gem: gemNode },
    rootNodeId: 'gem', rootNodeIds: ['gem'],
    sprites: { gspr: sprG },
    costumeSets: [
      { id: 'csA', name: '甲', pieces: { gem: gemPiece } },
      { id: 'csB', name: '乙', pieces: { gem: gemPieceOff } },
    ],
    activeCostumeSetId: 'csA',
    variants: {},
  } as unknown as Character;
  const pkgG = convertCharacterToRuntimePackage(chG);
  const partG = pkgG.parts.find((p) => p.key === 'gem');
  check('G4 默认集动态/发光为基线（部件自带）', (partG?.dynamic?.length ?? 0) > 0 && !!partG?.glow,
    `dyn=${partG?.dynamic?.length} glow=${!!partG?.glow}`);
  const csBG = pkgG.costumes['csB'] as { __dynamic?: Record<string, unknown[]>; __glow?: Record<string, unknown> };
  check('G5 压制集 __dynamic 写 [] 标记', Array.isArray(csBG.__dynamic?.['gem']) && csBG.__dynamic!['gem']!.length === 0,
    JSON.stringify(csBG.__dynamic));
  check('G6 压制集 __glow 写 null 标记', !!csBG.__glow && 'gem' in csBG.__glow && csBG.__glow['gem'] === null,
    JSON.stringify(csBG.__glow && Object.keys(csBG.__glow)));
  const csAG = pkgG.costumes['csA'] as { __dynamic?: Record<string, unknown[]>; __glow?: Record<string, unknown> };
  check('G7 生效集 __glow 为场非标记', !!csAG.__glow?.['gem'] && typeof csAG.__glow['gem'] === 'object');

  // 模板侧判读（源码断言）：三处按「键存在」消费标记
  check('G8 模板 glowEntryOf 按键存在判读', template.includes('if (map && part.key in map) return map[part.key];'));
  check('G9 模板 ensureAtlas 精灵回落按键存在判读', template.includes('const inSprMap = !!(sprMap && (part.key in sprMap));')
    && template.includes('spriteGrid = inSprMap ? sgrid : (sgrid || part.sprite || null);'));
  check('G10 模板 simPartParams 同口径', template.includes('(inSprMap ? sgrid : (sgrid || part.sprite || null))'));
}

// ---------- H) 错4/错6 源码锁定 ----------
check('H1 模板 bounce 缺省 0.45', template.includes('? Math.max(0, Math.min(1, params.bounce)) : 0.45;')
  && !template.includes(': 0.42;') && !template.includes('缺省 0.42'));
check('H2 convert 片段级空循环已删', !convertSrc.includes('for (const c of opts?.clips ?? []) {\n    }')
  && !convertSrc.includes('片段内的状态切换与特效数据不进包'));

console.log(`\nverify-package-integrity: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
