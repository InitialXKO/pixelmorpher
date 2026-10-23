// verify-parametric-composite.mts — 参数化外观三档合成探针（bun 运行）
// 口径：silhouette = 精灵只出剪影、着色全出调色板；overlay = 精灵作底、
// 只认 bump 亮度档位与四枚举（图案写出忽略）；无精灵回落 generate。
// 方向口径由不对称图形钉死：产品空间顶部与底部的颜色必须与层程序的
// py01 语义一致（烘焙空间翻转不得漏进产物）。
import {
  createDefaultCharacter,
  createDefaultNode,
  createDefaultCostumePiece,
  pxToSub,
  type Character,
  type DirectionIndex,
  type ParametricAppearance,
  type Sprite,
} from '../src/lib/unified-types';
import { generateRenderPlan } from '../src/lib/unified-render';
import { createSurfaceBaker } from '../src/lib/proc-runtime/bake-src';
import { buildParametricSprite } from '../src/lib/proc-runtime/main-canvas';
import { PALETTES } from '../src/lib/proc-runtime/palettes';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; console.log(`✗ ${name}`); }
}
const palHex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const SHIRT = PALETTES.shirt!;

// ---- 精灵 A：6×5 不对称（上块下杆），plug (2,2) ----
const A_DATA: (string | null)[][] = [
  [null, '#cc3333', '#cc3333', '#cc3333', null, null],
  [null, '#cc3333', '#cc3333', '#cc3333', null, null],
  [null, '#cc3333', '#cc3333', '#cc3333', '#3366cc', null],
  [null, null, '#3366cc', null, null, null],
  [null, null, '#3366cc', null, null, null],
];
const spriteA: Sprite = {
  width: 6, height: 5, data: A_DATA,
  plug: { x: pxToSub(2), y: pxToSub(2) },
} as unknown as Sprite;
const A_SOLID = A_DATA.flatMap((row) => row.map((c) => (c ? 1 : 0)));

// ---- 精灵 B：5×5 全实心灰，plug (2,2) ----
const spriteB: Sprite = {
  width: 5, height: 5,
  data: Array.from({ length: 5 }, () => Array(5).fill('#808080')),
  plug: { x: pxToSub(2), y: pxToSub(2) },
} as unknown as Sprite;

function appOf(p: Partial<ParametricAppearance>): ParametricAppearance {
  return {
    shape: { kind: 'rect', size: [4, 4], roundness: 0 },
    centerOffset: [0, 0],
    surface: [],
    palette: 'shirt',
    light: 0, outline: 0, rim: 0, glint: 0, rimI: 0, glintI: 0,
    ...p,
  } as ParametricAppearance;
}

// ---- R：栅格烘焙基础（占用=实心集、外环 254、远处 255、DAG 写出）----
{
  const baker = createSurfaceBaker();
  const raster = { w: 6, h: 5, plugX: 2, plugY: 2, solid: A_SOLID };
  const tile = baker.compileTileLayersRaster(raster, [{ mask: { m: 'all' }, slot: 2 }] as never);
  check('R 瓦片尺寸 10×9', tile.w === 10 && tile.h === 9);
  let occ = 0;
  for (let j = 0; j < tile.h; j++) for (let i = 0; i < tile.w; i++) {
    if (tile.data[(j * tile.w + i) * 4] < 128) occ++;
  }
  check('R 占用数=实心数 12', occ === 12);
  // 块顶正上方一格：源图先垂直翻入烘焙空间，产品顶部位于瓦片行 6，
  // 其外侧一格是行 7、列 4。
  check('R 外环 254', tile.data[(7 * tile.w + 4) * 4] === 254);
  check('R 远角 255', tile.data[0] === 255);
  const g = {
    nodes: [{ id: 'c', op: 'const', params: { v: 1 } }],
    writes: [{ from: 'c', slot: 5 }],
    params: {},
  };
  const tile2 = baker.compileTileDAGRaster(raster, g as never);
  check('R DAG 写出档位 5', tile2.data[(4 * tile2.w + 4) * 4] === 5);
}

// ---- S：silhouette（顶部 pal[1]、底部 pal[3]，占用集=平移后的实心集）----
{
  const app = appOf({
    composite: 'silhouette',
    surface: [
      { mask: { m: 'all' }, slot: 1 },
      { mask: { m: 'gradLt', axis: 'y', t: 0.5 }, slot: 3 },
    ] as ParametricAppearance['surface'],
  });
  const out = buildParametricSprite(app, 'nodeS', spriteA)!;
  check('S 尺寸 10×9', out.width === 10 && out.height === 9);
  check('S plug 平移 (+2,+2)', out.plug?.x === pxToSub(4) && out.plug?.y === pxToSub(4));
  check('S 顶部=pal[1]', out.data[2]?.[3] === palHex(SHIRT[1]!));
  check('S 底部=pal[3]', out.data[6]?.[4] === palHex(SHIRT[3]!));
  let occ = 0;
  for (const row of out.data) for (const c of row) if (c) occ++;
  check('S 非空像素=12（无描边）', occ === 12);
  check('S 孔洞保持透明', out.data[5]?.[5] === null);
}

// ---- O：overlay（dome 调光、图案忽略、外描边）----
const domeApp = (extra: Partial<ParametricAppearance>) => appOf({
  composite: 'overlay',
  surface: [{ bumpForm: 'dome', hi: 3, mid: 2, lo: 1 }] as ParametricAppearance['surface'],
  ...extra,
});
{
  const out = buildParametricSprite(domeApp({}), 'nodeO', spriteB)!;
  check('O 尺寸 9×9', out.width === 9 && out.height === 9);
  check('O 中心调亮 #9c9c9c', out.data[4]?.[4] === '#9c9c9c');
  check('O 近心调亮 #9c9c9c', out.data[3]?.[3] === '#9c9c9c');
  check('O 角部不变 #808080', out.data[2]?.[2] === '#808080');
}
{
  const app = appOf({
    composite: 'overlay',
    surface: [{ mask: { m: 'all' }, slot: 0 }] as ParametricAppearance['surface'],
  });
  const out = buildParametricSprite(app, 'nodeO2', spriteB)!;
  let pal0 = 0;
  for (const row of out.data) for (const c of row) if (c === palHex(SHIRT[0]!)) pal0++;
  check('O 图案写出被忽略（原色保留）', out.data[4]?.[4] === '#808080' && pal0 === 0);
}
{
  const out = buildParametricSprite(domeApp({ outline: 1 }), 'nodeO3', spriteB)!;
  check('O 外描边环=pal[0]', out.data[1]?.[4] === palHex(SHIRT[0]!));
}
{
  const a = buildParametricSprite(domeApp({}), 'nodeC', spriteB);
  const b = buildParametricSprite(domeApp({}), 'nodeC', spriteB);
  check('O 缓存同引用', a === b);
  const changed: Sprite = {
    ...spriteB,
    data: spriteB.data.map((row, y) => row.map((c, x) => (x === 2 && y === 2 ? '#ffffff' : c))),
  } as Sprite;
  const c2 = buildParametricSprite(domeApp({}), 'nodeC', changed);
  check('O 精灵改像素→重烘且用新底色', c2 !== a && c2!.data[4]?.[4] === '#ffffff');
}

// ---- I：resolveSprite 集成（有精灵走合成、无精灵回落生成、西向镜像源）----
function buildChar(pieceSprites: Partial<Record<DirectionIndex, Sprite>>, app: ParametricAppearance): Character {
  const ch = createDefaultCharacter('c', '合成测试');
  const root = ch.nodes[ch.rootNodeId]!;
  const node = createDefaultNode('N', 'N');
  (node as unknown as { parentId: string }).parentId = ch.rootNodeId;
  const piece = createDefaultCostumePiece('slotN');
  piece.parametric = app;
  for (const [d, s] of Object.entries(pieceSprites)) {
    piece.sprites[Number(d) as DirectionIndex] = s;
  }
  node.slot = piece;
  ch.nodes['N'] = node;
  root.children.push('N');
  ch.costumeSets = [{ id: 'cs', name: '默认', pieces: { slotN: piece } } as unknown as Character['costumeSets'][number]];
  ch.activeCostumeSetId = 'cs';
  return ch;
}
function instructionFor(ch: Character, dir: DirectionIndex) {
  ch.nodes[ch.rootNodeId]!.transform.variantIndex = dir;
  const plan = generateRenderPlan(
    ch, 0, 200, 200,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    {},
  );
  return plan.sortedInstructions.find((i) => i.nodeId === 'N');
}
{
  const ch = buildChar({ 6: spriteB, 0: spriteB }, domeApp({}));
  const ins = instructionFor(ch, 6);
  check('I 南向合成精灵 9×9', ins?.sprite?.width === 9 && ins?.sprite?.height === 9);
  check('I plug=(4,4)px', ins?.sprite?.plug?.x === pxToSub(4));
  check('I 中心像素已调光', ins?.sprite?.data[4]?.[4] === '#9c9c9c');
}
{
  const ch = buildChar({ 0: spriteB }, domeApp({}));
  const ins = instructionFor(ch, 4);
  check('I 西向走东向镜像源烘焙', ins?.sprite?.width === 9);
}
{
  const ch = buildChar({}, domeApp({}));
  const ins = instructionFor(ch, 6);
  check('I 无精灵回落独立生成（8×8）', ins?.sprite?.width === 8 && ins?.sprite?.height === 8);
}

console.log(`verify-parametric-composite: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
