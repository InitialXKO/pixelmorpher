/**
 * verify-runtime-audit.mts — 运行时完备性审计锁定探针
 *
 * 把 spikes/runtime-completeness/AUDIT.md 的分类逐项锁成断言：
 * 缺口被修复或完善面恶化时本探针变红，提示同步更新 AUDIT.md。
 * 2026-10-26 全修进度：缺口 1（服装覆盖）、缺口 2（程序化动画）已关，
 * 相应断言改为「已修」形态 + 数值对拍；其余缺口仍以「未修」形态锁定。
 */
import { readFileSync } from 'node:fs';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDynamicRuntime } from '../src/lib/proc-runtime/dynamic-src';
import { computeProceduralValue } from '../src/lib/engine/procedural';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import { createDefaultCostumePiece } from '../src/lib/unified-types';
import { createRuntimeEvaluator } from '../src/lib/proc-runtime/eval-src';

let passed = 0;
function check(name: string, ok: boolean) {
  if (!ok) { console.error('✗', name); process.exit(1); }
  passed++; console.log('✓', name);
}
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const convert = read('../src/lib/proc-runtime/convert.ts');
const template = read('../src/lib/proc-runtime/runtime-template.ts');
const dynSrc = read('../src/lib/proc-runtime/dynamic-src.ts');

// ---- 完善面（断了 = 回退）----
check('完善·状态机进包且运行时消费',
  convert.includes('stateMachine') && template.includes('smUpdate') && template.includes('smSetState'));
check('完善·动态实例进包且运行时消费',
  convert.includes('__dynamic') && template.includes('dynListFor'));
check('完善·发光场进包且运行时消费',
  convert.includes('glowEntryFor') && template.includes('glowEntryOf'));
check('完善·裁剪面进包且运行时消费',
  convert.includes('clipPlane') && template.includes('clipPlaneForPart'));
check('完善·标记进包且运行时换算',
  convert.includes('marks') && template.includes('marksDir'));

// ---- 缺口 1（已修）：服装件派生字段全量覆盖 ----
check('缺口1·已修：resolvePart 全量覆盖服装件派生字段（含 surface）',
  template.includes("'surface', 'surfaceGraph'") && template.includes('c[f] !== undefined'));

// ---- 缺口 2（已修）：程序化动画进包 + 运行时取值逐值对拍 ----
{
  const rt = createDynamicRuntime();
  const cfgs: Array<Record<string, unknown>> = [
    { type: 'noise', amplitude: 3, frequency: 0.05, octaves: 3, seed: 7, targetProperty: 'translateX' },
    { type: 'wave', amplitude: 2, frequency: 0.1, phase: 30, waveType: 'triangle', targetProperty: 'rotation' },
    { type: 'wave', amplitude: 1.5, frequency: 0.2, phase: 0, waveType: 'square', targetProperty: 'translateY' },
    { type: 'spring', stiffness: 40, damping: 2, mass: 1.5, restLength: 0.5, targetProperty: 'scale' },
    { type: 'jitter', amount: 1.2, frequency: 0.3, smooth: true, targetProperty: 'translateX' },
    { type: 'jitter', amount: 0.8, frequency: 0.7, smooth: false, targetProperty: 'translateY' },
  ];
  let parity = true;
  for (const cfg of cfgs) {
    for (const f of [0, 1, 7, 33, 120, 599]) {
      const a = computeProceduralValue(cfg as never, f);
      const b = rt.dynProceduralValue(cfg as never, f);
      if (Math.abs(a - b) > 1e-9) { parity = false; console.error('  对拍不一致', cfg.type, f, a, b); }
    }
  }
  check('缺口2·运行时程序化取值与编辑器逐值一致（6 配置 × 6 帧）', parity);

  const mkNode = (id: string, mods: unknown[]) => ({
    id, name: id, parentId: null, children: [], modifiers: mods,
    slot: { slotKey: id }, transform: {}, sockets: [], tracks: { keyframes: [] },
  });
  const ch = {
    id: 'pa1', name: 'PA测试',
    nodes: {
      withMod: mkNode('withMod', [{ id: 'm1', type: 'translate', enabled: true, params: {} }]),
      noMod: mkNode('noMod', []),
    },
    rootNodeId: 'withMod', rootNodeIds: ['withMod'],
    costumeSets: [{
      id: 's1', name: '默认',
      pieces: {
        withMod: { nodeId: 'withMod', zIndex: 0, parametric: createDefaultParametricAppearance() },
        noMod: { ...createDefaultCostumePiece('noMod'), parametric: createDefaultParametricAppearance() },
      },
    }],
    activeCostumeSetId: 's1', variants: {},
  } as never;
  const pas = [
    { id: 'p1', name: '有修改器', spriteId: '', nodeId: 'withMod', enabled: true, startFrame: 0, endFrame: 60, config: { type: 'wave', amplitude: 2, frequency: 0.1, phase: 0, waveType: 'sine', targetProperty: 'translateX' } },
    { id: 'p2', name: '无修改器', spriteId: '', nodeId: 'noMod', enabled: true, startFrame: 0, endFrame: 60, config: { type: 'wave', amplitude: 2, frequency: 0.1, phase: 0, waveType: 'sine', targetProperty: 'translateX' } },
    { id: 'p3', name: '只有精灵id', spriteId: 'spr_x', enabled: true, startFrame: 0, endFrame: 60, config: { type: 'wave', amplitude: 2, frequency: 0.1, phase: 0, waveType: 'sine', targetProperty: 'translateX' } },
  ] as never[];
  const pkg = convertCharacterToRuntimePackage(ch, undefined, { projectData: { proceduralAnimations: pas } });
  check('缺口2·有对应修改器的 PA 进包且槽位/目标正确',
    pkg.procedural?.length === 1 && pkg.procedural[0].slot === 'withMod' && pkg.procedural[0].target === 'translateX');
  check('缺口2·无修改器与 spriteId-only 的 PA 被点名不进包',
    pkg.warnings.some((w) => w.includes('无修改器') && w.includes('同样不生效'))
    && pkg.warnings.some((w) => w.includes('只有精灵id') && w.includes('亦不生效')));
  check('缺口2·运行时模板消费 PROCEDURAL', template.includes('const PROCEDURAL = EMBEDDED.procedural') && template.includes('dynProceduralValue(pa.cfg'));
}

// ---- 缺口 3（已修）：全局变换图进包 + 求值器 scale 通道 ----
{
  const ev = createRuntimeEvaluator();
  const g = {
    nodes: [
      { id: 'v', type: 'uniform_scale', params: { scale: 1.5 } },
      { id: 'tr', type: 'transform', part: '__global', units: 'runtime', scaleXFrom: { n: 'v', o: 'outScaleX' }, scaleYFrom: { n: 'v', o: 'outScaleY' } },
    ],
  };
  const rec = ev(g as never, {} as never).get('__global');
  check('缺口3·求值器 transform 记录带 scaleX/scaleY', !!rec && Math.abs(rec.scaleX - 1.5) < 1e-9 && Math.abs(rec.scaleY - 1.5) < 1e-9);

  const mkNode = (id: string) => ({
    id, name: id, parentId: null, children: [], modifiers: [],
    slot: { slotKey: id }, transform: {}, sockets: [], tracks: { keyframes: [] },
  });
  const ch = {
    id: 'g1', name: '全局测试',
    nodes: { root: mkNode('root') },
    rootNodeId: 'root', rootNodeIds: ['root'],
    costumeSets: [{
      id: 's1', name: '默认',
      pieces: { root: { nodeId: 'root', zIndex: 0, parametric: createDefaultParametricAppearance() } },
    }],
    activeCostumeSetId: 's1', variants: {},
  } as never;
  const pkg = convertCharacterToRuntimePackage(ch, undefined, {
    projectData: { globalModifiers: [{ id: 'gm1', type: 'translate', enabled: true, params: { offsetX: 5, offsetY: 0 } }] as never },
  });
  check('缺口3·全局修改器经翻译进包为 globalGraph（__global transform 节点）',
    !!pkg.globalGraph && pkg.globalGraph.nodes.some((n) => n.type === 'transform' && (n as { part?: string }).part === '__global'));
  const pkg2 = convertCharacterToRuntimePackage(ch, undefined, {
    projectData: { globalBlueprint: { version: 1, outputId: 'o', nodes: [] } as never },
  });
  check('缺口3·只有全局蓝图无修改器时同编辑器口径点名不进包',
    !pkg2.globalGraph && pkg2.warnings.some((w) => w.includes('仅在全局修改器非空时生效')));
  check('缺口3·运行时模板消费 GLOBAL_GRAPH', template.includes('const GLOBAL_GRAPH = EMBEDDED.globalGraph') && template.includes("gout.get('__global')"));
}

// ---- 缺口 8（已修）：baseSprite.marks 在底图路径消费 ----
check('缺口8·标记换算来源含 resolved.baseSprite',
  template.includes('const markSrc = spriteGrid || (resolved && resolved.baseSprite) || null'));
check('缺口8·置换方向标记来源含 base.baseSprite',
  template.includes('part.sprite || (part.base && part.base.baseSprite) || null'));

// ---- 未修缺口（关了 = 有人修了，须更新 AUDIT 分类）----
check('缺口4·运行时仍无网格蒙皮（修复后更新文档）',
  !template.includes('skinning') && !dynSrc.includes('skinning'));
check('缺口5·特效轨/笔触已进包且模板消费',
  convert.includes('fxPkg') && convert.includes('clipFxOf')
  && template.includes('fxRenderSet') && template.includes("tr.type === 'particle'")
  && template.includes('afterimage_brush'));
check('包数据面保留（用户端可消费）+ 播放器内部死代码已删（dynFollowDelta/旧画序表）',
  convert.includes('drawLayer: node.drawLayer') && convert.includes("context: 'performance'")
  && !convert.includes('DEAD_DYN_PARAMS')
  && !template.includes('dynFollowDelta') && !template.includes('DRAW_ORDER_MAIN'));
check('缺口7·透视缩短因子随轨道进包（fore 通道）且 tilt 不再点名缺失',
  convert.includes('frameYAxisWorld') && convert.includes('foreFrom')
  && !convert.includes("'tilt', 'stretch'"));
check('缺口4·网格蒙皮已进包且模板逐帧变形回传图集（还原制）',
  convert.includes('part.skin = {') && template.includes('skinWarpTile')
  && template.includes('skinDirty') && template.includes('skinJobs'));
check('缺口5·画布修改轨后处理链已接线（参数解析+六类通道+掩码+场景目标）',
  template.includes('fxResolveCanvasParams') && template.includes('fxCollectCanvasMods')
  && template.includes('fxRunPostChain') && template.includes('ensurePostSys')
  && template.includes('fxBuildMask') && template.includes('uEffect == 7'));
{
  const ch = {
    id: 'fxp', name: '特效包测试',
    nodes: { root: { id: 'root', name: 'root', parentId: null, children: [], modifiers: [], slot: { slotKey: 'root' }, transform: {}, sockets: [], tracks: { keyframes: [] } } },
    rootNodeId: 'root', rootNodeIds: ['root'],
    costumeSets: [{ id: 's1', name: '默认', pieces: { root: { nodeId: 'root', zIndex: 0, parametric: createDefaultParametricAppearance() } } }],
    activeCostumeSetId: 's1', variants: {},
  } as never;
  const pkg = convertCharacterToRuntimePackage(ch, undefined, {
    frameRate: 12, totalFrames: 48,
    projectData: {
      canvasWidth: 640, canvasHeight: 360,
      effectTracks: [{ id: 'et1', type: 'glow', name: '辉光', visible: true, keyframes: [{ id: 'k1', frame: 0, params: { radius: 3 } }] }],
      motionBlurStrokes: [{ id: 'mb1', frame: 4, spriteId: 'root', points: [{ x: 1, y: 2 }, { x: 30, y: 2 }], brushType: 'linear', intensity: 5, direction: 0 }],
    } as never,
  });
  check('缺口5·工程 fx 进包（画布尺寸/总帧/轨/笔触）',
    pkg.fx?.canvas.w === 640 && pkg.fx?.canvas.h === 360 && pkg.fx?.totalFrames === 48
    && pkg.fx?.effectTracks?.length === 1 && pkg.fx?.motionBlurStrokes?.length === 1);
}
check('缺口6·已修：段表演带 stateFx 且模板按快照累计应用/恢复',
  convert.includes('stateFxOf') && template.includes('act.perf.stateFx') && template.includes('restoreFxSnapshot'));
{
  const { defaultSlashSpec } = await import('../src/lib/slash-fan');
  const mkNode = (id: string) => ({
    id, name: id, parentId: null, children: [], modifiers: [],
    slot: { slotKey: id }, transform: {}, sockets: [], tracks: { keyframes: [] },
  });
  const ch = {
    id: 'fx1', name: '状态轨测试',
    nodes: { hand: mkNode('hand') },
    rootNodeId: 'hand', rootNodeIds: ['hand'],
    costumeSets: [
      { id: 'set1', name: '默认', pieces: { hand: { ...createDefaultCostumePiece('hand'), parametric: createDefaultParametricAppearance() } } },
      { id: 'set2', name: '二套', pieces: { hand: { ...createDefaultCostumePiece('hand'), parametric: createDefaultParametricAppearance() } } },
    ],
    activeCostumeSetId: 'set1', variants: {},
  } as never;
  const clip = {
    id: 'c1', name: '变身段', puppetCharacterId: 'fx1', startFrame: 2, endFrame: 9, loop: false,
    slashEffect: { ...defaultSlashSpec('hand'), frameCount: 4 },
    stateKeyframes: [
      { frame: 5, slotChanges: { hand: 'v2' } },
      { frame: 2, costumeSetId: 'set2' },
      { frame: 3, costumeSetId: 'nope' },
    ],
  } as never;
  const pkg = convertCharacterToRuntimePackage(ch, undefined, { frameRate: 10, clips: [clip] });
  const seg = pkg.performances.find((p) => (p as { id?: string }).id === 'clip_c1') as { stateFx?: Array<Record<string, unknown>> } | undefined;
  check('缺口6·状态键按片段本地秒换算（帧2→0、帧5→0.3@10fps）且排序',
    !!seg?.stateFx && seg.stateFx.length === 2
    && seg.stateFx[0].t === 0 && seg.stateFx[0].costume === 'set2'
    && Math.abs((seg.stateFx[1].t as number) - 0.3) < 1e-9
    && (seg.stateFx[1].slots as Record<string, string>).hand === 'v2');
  check('缺口6·指向不存在服装集的状态键被点名丢弃',
    pkg.warnings.some((w) => w.includes('指向不存在的服装集')));
}

// ---- 已点名近似（点名消失 = 口径变化，须更新文档）----
check('近似·directionDrawOrders 仍有点名 warning',
  convert.includes('directionDrawOrders') && convert.includes('未进包'));
check('近似·蓝图剪变换通道仍在',
  convert.includes('pruneToTransform'));

console.log(`\n运行时审计锁定探针全过（${passed} 项）`);
