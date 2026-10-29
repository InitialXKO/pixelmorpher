// 逐帧像素修正（矫正模式搬家到节点）探针：
// 1) 命令回放求值器 applyBrushCommandsToGrid：draw 涂色 / erase 清除 / fill 洪泛——与 pixel_edit 同一求值器。
// 2) 渲染计划下发：generateRenderPlan 对 frameCorrections 的门控——
//    帧对 + 精灵 id 对 → 指令带 frameCorrection；帧错/图错 → 不下发。
// 3) 逆映射往返：spriteLocalPoint 与绘制变换同链——已知局部点经正变换
//    落到画布，再逆映射应回到原点（旋转/缩放/镜像各一例）。
// 4) convert 点名：带修正的节点导出时 warnings 点名，不静默。
import { applyBrushCommandsToGrid } from '../src/lib/engine/pixel-modifiers';
import { spriteLocalPoint } from '../src/lib/node-picking';
import { generateRenderPlan } from '../src/lib/unified-render';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string) => {
  if (cond) { pass++; } else { fail++; console.log('FAIL:', name); }
};

// ---------- 1) 命令回放 ----------
const blank = Array.from({ length: 6 }, () => Array(8).fill(null));
const drawCmd = { id: 'c1', type: 'draw' as const, color: '#ff0000', size: 1, points: [{ x: 2, y: 3 }], blendMode: 'normal' as const };
const afterDraw = applyBrushCommandsToGrid(blank, [drawCmd as any], 0);
ok(afterDraw[3][2] === '#ff0000', 'draw 在 (2,3) 落红');
ok(blank[3][2] === null, '回放不污染输入网格（克隆）');
const eraseCmd = { id: 'c2', type: 'erase' as const, color: '#ff0000', size: 1, points: [{ x: 2, y: 3 }], blendMode: 'normal' as const };
const afterErase = applyBrushCommandsToGrid(afterDraw, [eraseCmd as any], 0);
ok(afterErase[3][2] === null, 'erase 清除同格');
const fillBase = Array.from({ length: 4 }, () => Array(4).fill('#00ff00'));
fillBase[1][1] = '#0000ff';
const fillCmd = { id: 'c3', type: 'fill' as const, color: '#ffffff', size: 1, points: [{ x: 0, y: 0 }], blendMode: 'normal' as const };
const afterFill = applyBrushCommandsToGrid(fillBase, [fillCmd as any], 0);
ok(afterFill[0][0] === '#ffffff' && afterFill[2][2] === '#ffffff' && afterFill[1][1] === '#0000ff', 'fill 只漫同色连通区');
ok(applyBrushCommandsToGrid(blank, [], 0) === blank, '空命令原样返回');

// ---------- 2) 计划下发门控 ----------
const sprite = {
  id: 'spr1', name: '体', width: 4, height: 4,
  data: Array.from({ length: 4 }, () => Array(4).fill('#ff88aa')),
  plug: { x: 2 * 16, y: 2 * 16 },
} as any;
const node = {
  id: 'n1', name: '体', parentId: null, children: [],
  transform: { x: 0, y: 0, z: 0, angle: 0, stretch: 1, variantIndex: 6 },
  tracks: {}, modifiers: [], sockets: [], visible: true, drawLayer: 'default', zIndex: 0,
  attachment: { type: 'root' },
  slot: { slotKey: 'body' },
  frameCorrections: {
    5: { spriteId: 'spr1', commands: [drawCmd] },
    7: { spriteId: 'other-sprite', commands: [drawCmd] },
  },
} as any;
const character = {
  id: 'ch1', name: '测', nodes: { n1: node }, rootNodeId: 'n1',
  costumeSets: [{ id: 'cs1', name: '默认', pieces: { body: { slotKey: 'body', fillColor: '#888', sprites: { 6: { spriteId: 'spr1' } }, scaleVariants: {}, mirrorMap: {}, crossSections: [] } } }],
  activeCostumeSetId: 'cs1',
  sprites: { spr1: sprite },
} as any;

function planAt(frame: number) {
  const plan = generateRenderPlan(character, frame, 200, 200, 'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    { spr1: sprite } as any);
  return plan.nodeInstructions.find((i: any) => i.nodeId === 'n1');
}
const ins5 = planAt(5);
ok(!!ins5, '帧 5 有渲染指令');
ok(!!ins5?.frameCorrection && ins5.frameCorrection.commands?.length === 1, '帧 5 + 精灵对上 → 下发修正');
const ins6 = planAt(6);
ok(!!ins6 && !ins6.frameCorrection, '帧 6 无条目 → 不下发');
const ins7 = planAt(7);
ok(!!ins7 && !ins7.frameCorrection, '帧 7 精灵 id 对不上 → 不下发（换图不误伤）');

// ---------- 3) 逆映射往返 ----------
// 正变换（与 renderNodeSprite 链同序的简化版：枢轴处旋转/缩放后平移到关节画布点）
function forward(local: { x: number; y: number }, wt: any, jointX: number, jointY: number, sprite: any) {
  const w = sprite.width, h = sprite.height;
  const pivotX = sprite.plug ? sprite.plug.x / 16 : w / 2;
  const pivotY = sprite.plug ? sprite.plug.y / 16 : h / 2;
  let lx = wt.mirror ? w - local.x : local.x;
  lx -= wt.mirror ? w - pivotX : pivotX;
  let ly = local.y - pivotY;
  lx *= (wt.scaleX || 1);
  ly *= (wt.worldStretch || 1);
  const rad = (wt.worldAngle * Math.PI) / 180;
  const ca = Math.cos(rad), sa = Math.sin(rad);
  return { x: jointX + lx * ca - ly * sa, y: jointY + lx * sa + ly * ca };
}
for (const [name, wt] of [
  ['无变换', { worldAngle: 0, scaleX: 1, worldStretch: 1, mirror: false }],
  ['旋转 40°', { worldAngle: 40, scaleX: 1, worldStretch: 1, mirror: false }],
  ['缩放+镜像', { worldAngle: -25, scaleX: 1.6, worldStretch: 0.7, mirror: true }],
] as const) {
  const canvasPt = forward({ x: 3, y: 1 }, wt as any, 100, 90, sprite);
  const back = spriteLocalPoint(sprite, wt as any, 100, 90, canvasPt.x, canvasPt.y);
  ok(!!back && Math.abs(back.x - 3) < 1e-6 && Math.abs(back.y - 1) < 1e-6, `逆映射往返：${name}`);
}

// ---------- 4) convert 烘焙 + 点名 ----------
// 无片段/轨道上下文：全部修正无窗可挂 → 全数点名
const pkg0 = convertCharacterToRuntimePackage(character, { spr1: sprite } as any, { frameRate: 12 });
ok(pkg0.warnings.some((w) => w.includes('逐帧像素修正') && w.includes('体')), 'convert 对带修正节点点名');
ok(!pkg0.performances.some((p: any) => p.spriteFrames), '无窗时不生成替代图');

// 带轨道 + 片段窗（0..15）：帧 5 修正（图对）烘进轨道表演与段表演；
// 帧 7 图不对、帧 20 窗外 → 点名 2/3
const charB = JSON.parse(JSON.stringify(character));
charB.nodes.n1.tracks = { x: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 32 }] } };
charB.nodes.n1.frameCorrections[20] = { spriteId: 'spr1', commands: [drawCmd] };
const clips = [{ id: 'clipA', name: '走', puppetCharacterId: 'ch1', startFrame: 0, endFrame: 15, loop: false }] as any;
const pkg = convertCharacterToRuntimePackage(charB, { spr1: sprite } as any, { frameRate: 12, totalFrames: 16, clips });
const clipPerf = pkg.performances.find((p: any) => p.id === 'clip_clipA') as any;
ok(!!clipPerf, '段表演已生成');
const sfGrid = clipPerf?.spriteFrames?.body?.cs1?.[5];
ok(!!sfGrid, '段表演带帧 5 替代图（本地帧 = 工程帧 − 窗起点）');
const expected = applyBrushCommandsToGrid(sprite.data, [drawCmd as any], 5);
ok(!!sfGrid && JSON.stringify(sfGrid.data) === JSON.stringify(expected), '替代图 = 编辑器同一求值器回放结果（逐格一致）');
ok(!!sfGrid && sfGrid.w === 4 && sfGrid.h === 4 && sfGrid.plug[0] === 2 && sfGrid.plug[1] === 2, '替代图尺寸/plug 与显示图一致');
ok(!clipPerf?.spriteFrames?.body?.cs1?.[7], '帧 7 图不对 → 不烘');
const tracksPerf = pkg.performances.find((p: any) => p.id === 'tracks') as any;
ok(!!tracksPerf?.spriteFrames?.body?.cs1?.[5], '轨道表演（全程窗）也带帧 5 替代图');
ok(!tracksPerf?.spriteFrames?.body?.cs1?.[20], '帧 20 在总帧窗外 → 不烘');
ok(pkg.warnings.some((w) => w.includes('逐帧像素修正') && w.includes('2/3')), '未烘 2/3 帧点名（图不对 + 窗外）');

const cleanChar = JSON.parse(JSON.stringify(character));
delete cleanChar.nodes.n1.frameCorrections;
const pkg2 = convertCharacterToRuntimePackage(cleanChar, { spr1: sprite } as any, { frameRate: 12 });
ok(!pkg2.warnings.some((w) => w.includes('逐帧像素修正')), '无修正时不点名');

// ---------- 5) 模板切图接线（结构校验，与 verify-proc-runtime 同口径） ----------
{
  const { buildRuntimeHtml } = await import('../src/lib/proc-runtime/runtime-template');
  const html = buildRuntimeHtml(pkg);
  ok(html.includes('spriteFrames') && html.includes('corrPick') && html.includes('corrFrames') && html.includes('#corr'), '运行时 HTML 含替代图打包/折叠/选帧/切图全链');
}

console.log(`frame-corrections probe: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
