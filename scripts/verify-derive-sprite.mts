// 派生生成（复制/镜像+压暗）与甲1 反调探针：store 级 + 纯函数。
// 仿射像素烘焙依赖 DOM canvas，不在此覆盖（真机验）。
// 运行：bun scripts/verify-derive-sprite.mts
import { useProjectStore } from '../src/lib/store';
import { subToPx } from '../src/lib/unified-types';
import { d4TransformGrid, darkenPixelGrid, counterRotateNodeOffset } from '../src/lib/sprite-transform';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

function seed() {
  const st = useProjectStore.getState();
  const spr = st.addSprite('src-arm', 4, 3, { plugX: 1, plugY: 1 });
  const data = Array.from({ length: 3 }, (_, y) =>
    Array.from({ length: 4 }, (_, x) => `#${x}${y}0000`),
  );
  const hm = Array.from({ length: 3 }, (_, y) => Array.from({ length: 4 }, (_, x) => y * 10 + x));
  st.updateSprite(spr.id!, { data, heightmap: hm });
  return spr.id!;
}
const get = (id: string) => useProjectStore.getState().sprites[id]!;

console.log('A darkenPixelGrid（纯函数）');
{
  const g = [['#804020', null, ''], ['#ffffff', '#000000', '#102030']];
  const d = darkenPixelGrid(g as any, 0.5);
  check('A1 #804020 ×0.5 = #402010', d[0]![0] === '#402010');
  check('A2 透明不动（null 与空串）', d[0]![1] === null && d[0]![2] === '');
  check('A3 #ffffff ×0.5 = #808080（四舍五入）', d[1]![0] === '#808080');
  check('A4 factor 1 原样返回', darkenPixelGrid(g as any, 1) === (g as any));
}

console.log('B counterRotateNodeOffset（纯函数，甲1 反调）');
{
  const r1 = counterRotateNodeOffset(undefined, 'n1', 90);
  check('B1 无条目时新建 {0,0,-90}', r1['n1']?.angle === -90 && r1['n1']?.x === 0);
  const r2 = counterRotateNodeOffset(r1, 'n1', -90);
  check('B2 反调归零后条目删除', !('n1' in r2));
  const r3 = counterRotateNodeOffset({ n2: { x: 3, y: -2, angle: 45 } }, 'n2', 15);
  check('B3 既有 x/y 保留、angle 45→30', r3['n2']?.x === 3 && r3['n2']?.y === -2 && r3['n2']?.angle === 30);
}

console.log('C deriveSpriteFrom：复制（烘焙式，源改不跟随）');
{
  const srcId = seed();
  const derived = useProjectStore.getState().deriveSpriteFrom(srcId, { mode: 'copy' });
  check('C1 生成新精灵且 id 不同', !!derived && derived.id !== srcId);
  check('C2 数据与源全等', JSON.stringify(derived!.data) === JSON.stringify(get(srcId).data));
  check('C3 plug 相同', subToPx(derived!.plug!.x) === 1 && subToPx(derived!.plug!.y) === 1);
  // 改源：副本不变
  const before = JSON.stringify(derived!.data);
  const changed = get(srcId).data.map((r) => r.slice());
  changed[0]![0] = '#00ff00';
  useProjectStore.getState().updateSprite(srcId, { data: changed });
  check('C4 改源后副本不变（烘焙式语义）', JSON.stringify(get(derived!.id).data) === before);
}

console.log('D deriveSpriteFrom：镜像（轴 90 = flipH 无损）+ 压暗');
{
  const srcId = seed();
  const src = get(srcId);
  const derived = useProjectStore.getState().deriveSpriteFrom(srcId, { mode: 'mirror', axisDeg: 90 });
  const expect = d4TransformGrid(src.data, 'flipH', null);
  check('D1 像素 == d4 flipH', JSON.stringify(derived!.data) === JSON.stringify(expect));
  check('D2 plug x: 1 → 4-1 = 3，y 不变', subToPx(derived!.plug!.x) === 3 && subToPx(derived!.plug!.y) === 1);
  check('D3 heightmap 同步镜像', derived!.heightmap![0]![0] === src.heightmap![0]![3]);
  const dark = useProjectStore.getState().deriveSpriteFrom(srcId, { mode: 'copy', darken: 0.5 });
  check('D4 压暗 0.5：#100000 → #080000', dark!.data[0]![1] === '#080000');
  const bad = useProjectStore.getState().deriveSpriteFrom('nonexistent-id', { mode: 'copy' });
  check('D5 源不存在返回 undefined', bad === undefined);
}

console.log(`\n合计：${pass} 过 / ${fail} 败`);
process.exit(fail === 0 ? 0 : 1);
