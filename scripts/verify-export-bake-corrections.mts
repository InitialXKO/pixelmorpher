// 逐帧像素修正导出三档（bake.corrections: off / standard / extended）探针：
// ① 无节点轨道（表演驱动）角色：standard 全程窗不跑 → 全帧未烘、点名
//    3/3、无替代图；extended 全程窗单独开路烘成 + 补发载体表演（id/
//    trigger 沿「轨道」口径、空图、只带 spriteFrames）承载、点名消减；
//    off 三路全短路 → 零替代图、点名仍按全部修正帧计（3/3）。
// ② 有轨道普通角色（窗内图对一帧、图不对一帧）：standard 与现行逐项
//    一致（轨道表演 + 段表演各带图对帧、点名 1/2）；extended 与
//    standard 全等——扩围只补缺口、不惊扰已通路。
// ③ 修正帧超工程总帧数：standard 窗外未烘（点名 1/2）；extended 全程
//    窗扩围后落烘（真轨道表演带该帧、点名消失）；off 点名 2/2。
// 类 2/3/4 缺口（stack/像素链、参数化、图不对）三档都不扩：②的图
// 不对帧在 extended 下照样未烘、照样点名，即为此证。
import { applyBrushCommandsToGrid } from '../src/lib/engine/pixel-modifiers';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string) => {
  if (cond) { pass++; } else { fail++; console.log('FAIL:', name); }
};

const drawCmd = { id: 'c1', type: 'draw' as const, color: '#ff0000', size: 1, points: [{ x: 2, y: 3 }], blendMode: 'normal' as const };
const sprite = {
  id: 'spr1', name: '体', width: 4, height: 4,
  data: Array.from({ length: 4 }, () => Array(4).fill('#ff88aa')),
  plug: { x: 2 * 16, y: 2 * 16 },
} as any;
const spriteTable = { spr1: sprite } as any;

const corr = (spriteId: string) => ({ spriteId, commands: [drawCmd] });
function makeChar(corrections: Record<number, { spriteId: string; commands: unknown[] }>, extra: { node?: object; char?: object } = {}) {
  return {
    id: 'ch1', name: '测',
    nodes: {
      n1: {
        id: 'n1', name: '体', parentId: null, children: [],
        transform: { x: 0, y: 0, z: 0, angle: 0, stretch: 1, variantIndex: 6 },
        tracks: {}, modifiers: [], sockets: [], visible: true, drawLayer: 'default', zIndex: 0,
        attachment: { type: 'root' },
        slot: { slotKey: 'body' },
        frameCorrections: corrections,
        ...(extra.node ?? {}),
      },
    },
    rootNodeId: 'n1',
    costumeSets: [{ id: 'cs1', name: '默认', pieces: { body: { slotKey: 'body', fillColor: '#888', sprites: { 6: { spriteId: 'spr1' } }, scaleVariants: {}, mirrorMap: {}, crossSections: [] } } }],
    activeCostumeSetId: 'cs1',
    sprites: { spr1: sprite },
    ...(extra.char ?? {}),
  } as any;
}
// convert 可能改入参，逐跑深克隆（与 verify-frame-corrections 同口径）
const run = (char: any, opts: any) =>
  convertCharacterToRuntimePackage(JSON.parse(JSON.stringify(char)), spriteTable, opts);

const corrWarn = (pkg: any) => pkg.warnings.find((w: string) => w.includes('逐帧像素修正'));
// perfId → 该表演 spriteFrames 里 body 槽的全部本地帧（跨服装集合并）
const framesOf = (pkg: any) => {
  const out: Record<string, number[]> = {};
  for (const p of pkg.performances) {
    const byCs = (p as any).spriteFrames?.body;
    if (!byCs) continue;
    const frames: number[] = [];
    for (const byFrame of Object.values(byCs)) frames.push(...Object.keys(byFrame as object).map(Number));
    out[p.id] = frames.sort((a, b) => a - b);
  }
  return out;
};
const anySpriteFrames = (pkg: any) => pkg.performances.some((p: any) => p.spriteFrames);

// ---------- ① 无轨道（表演驱动）角色，三档分流 ----------
const perfDriven = {
  id: 'perfAct', name: '行为', enabled: true, trigger: 'KeyA', duration: 1,
  envelopeIn: 0, envelopeOut: 0, mode: 'add', maskNodeIds: [], graphs: {},
};
const charA = makeChar(
  { 2: corr('spr1'), 5: corr('spr1'), 9: corr('spr1') },
  { char: { performances: [perfDriven] } },
);
const optsA = { frameRate: 12, totalFrames: 12 };

const stdA = run(charA, optsA); // 不传 bake = 缺省 standard
ok(!anySpriteFrames(stdA), '① standard：无替代图（全程窗被总门控挡住）');
ok(corrWarn(stdA)?.includes('3/3'), '① standard：点名 3/3 全帧未烘');
ok(!stdA.performances.some((p: any) => p.id === 'tracks'), '① standard：无轨道表演、无载体');

const extA = run(charA, { ...optsA, bake: { corrections: 'extended' } });
const carrier = extA.performances.find((p: any) => p.id === 'tracks') as any;
ok(!!carrier, '① extended：载体表演已补发');
ok(carrier?.trigger === 'tracks' && carrier?.triggerKey === 'KeyT' && carrier?.mode === 'add',
  '① extended：载体 id/trigger/triggerKey/mode 沿「轨道」口径');
ok(Array.isArray(carrier?.graph?.nodes) && carrier.graph.nodes.length === 0, '① extended：载体图为空、只带 spriteFrames');
ok(carrier?.duration === 1, '① extended：载体时长 = 总帧数/帧率（12/12）');
ok(JSON.stringify(framesOf(extA)) === JSON.stringify({ tracks: [2, 5, 9] }), '① extended：三帧全程窗修正烘进载体');
const expected5 = applyBrushCommandsToGrid(sprite.data, [drawCmd as any], 5);
ok(JSON.stringify(carrier?.spriteFrames?.body?.cs1?.[5]?.data) === JSON.stringify(expected5),
  '① extended：替代图 = 编辑器同一求值器回放结果');
ok(!corrWarn(extA), '① extended：全帧已烘、未烘点名消减为无');

const offA = run(charA, { ...optsA, bake: { corrections: 'off' } });
ok(!anySpriteFrames(offA), '① off：零替代图');
ok(corrWarn(offA)?.includes('3/3'), '① off：点名按全部修正帧计（3/3）');

// ---------- ② 有轨道普通角色：standard = 现行，extended = standard ----------
const tracksNode = { tracks: { x: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 32 }] } } };
const charB = makeChar({ 5: corr('spr1'), 7: corr('other-sprite') }, { node: tracksNode });
const clips = [{ id: 'clipA', name: '走', puppetCharacterId: 'ch1', startFrame: 0, endFrame: 15, loop: false }] as any;
const optsB = { frameRate: 12, totalFrames: 16, clips };

const stdB = run(charB, optsB);
ok(JSON.stringify(framesOf(stdB)) === JSON.stringify({ tracks: [5], clip_clipA: [5] }),
  '② standard：轨道表演 + 段表演各带帧 5 替代图（与现行一致）');
ok(corrWarn(stdB)?.includes('1/2'), '② standard：图不对帧未烘、点名 1/2（与现行一致）');

const extB = run(charB, { ...optsB, bake: { corrections: 'extended' } });
ok(JSON.stringify(framesOf(extB)) === JSON.stringify(framesOf(stdB)), '② extended：替代图分布与 standard 全等');
const sfJson = (pkg: any) => JSON.stringify(pkg.performances.map((p: any) => [p.id, p.spriteFrames ?? null]));
ok(sfJson(extB) === sfJson(stdB), '② extended：替代图内容逐格与 standard 全等');
ok(corrWarn(extB) === corrWarn(stdB), '② extended：点名与 standard 逐字相同（图不对帧照样未烘、照样点名）');
const tracksB = extB.performances.find((p: any) => p.id === 'tracks') as any;
ok((tracksB?.graph?.nodes?.length ?? 0) > 0, '② extended：轨道表演是真表演（有姿态图）、非载体顶替');

// ---------- ③ 修正帧超工程总帧数：extended 扩窗 ----------
const charC = makeChar({ 5: corr('spr1'), 20: corr('spr1') }, { node: tracksNode });
const optsC = { frameRate: 12, totalFrames: 16 };

const stdC = run(charC, optsC);
ok(JSON.stringify(framesOf(stdC)) === JSON.stringify({ tracks: [5] }), '③ standard：帧 20 在总帧窗外 → 只烘帧 5');
ok(corrWarn(stdC)?.includes('1/2'), '③ standard：点名 1/2（窗外帧未烘）');

const extC = run(charC, { ...optsC, bake: { corrections: 'extended' } });
ok(JSON.stringify(framesOf(extC)) === JSON.stringify({ tracks: [5, 20] }), '③ extended：全程窗扩围、帧 20 落烘（本地帧 = 工程帧）');
ok(!corrWarn(extC), '③ extended：两帧全烘、无未烘点名');
const tracksC = extC.performances.find((p: any) => p.id === 'tracks') as any;
ok((tracksC?.graph?.nodes?.length ?? 0) > 0, '③ extended：帧 20 挂在真轨道表演上（本就有轨道、非载体）');

const offC = run(charC, { ...optsC, bake: { corrections: 'off' } });
ok(!anySpriteFrames(offC), '③ off：门内全程窗同样短路、零替代图');
ok(corrWarn(offC)?.includes('2/2'), '③ off：点名 2/2 全帧未烘');

console.log(`export-bake-corrections probe: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
