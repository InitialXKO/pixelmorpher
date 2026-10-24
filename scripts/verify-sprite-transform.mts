// 精灵变换探针：D4 置换走真实 store；矩阵/路由/重采样走纯函数。
// 仿射像素烘焙依赖 DOM canvas，bun 无此环境——不在此探针覆盖（真机验）。
// 运行：bun scripts/verify-sprite-transform.mts
import { useProjectStore } from '../src/lib/store';
import { subToPx } from '../src/lib/unified-types';
import {
  d4MapPoint,
  d4TransformGrid,
  classifyRotate,
  classifyMirrorAxis,
  rotationMatrixAbout,
  mirrorAxisMatrixAbout,
  resampleGridAffine,
} from '../src/lib/sprite-transform';
import { applyAffine } from '../src/lib/engine/affine';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// 4×3 精灵：像素颜色编码坐标 #xy0000，heightmap = y*10+x
function seedSprite() {
  const st = useProjectStore.getState();
  const spr = st.addSprite('probe-t', 4, 3, { plugX: 1, plugY: 1 });
  const data = Array.from({ length: 3 }, (_, y) =>
    Array.from({ length: 4 }, (_, x) => `#${x}${y}0000`),
  );
  const hm = Array.from({ length: 3 }, (_, y) => Array.from({ length: 4 }, (_, x) => y * 10 + x));
  st.updateSprite(spr.id!, {
    data,
    heightmap: hm,
    landmarks: { leftEye: { x: 0, y: 0 }, nose: { x: 0.5, y: 0.5 } },
  });
  return spr.id!;
}
const get = (id: string) => useProjectStore.getState().sprites[id]!;

console.log('A store 级 D4：rot90（顺时针）');
{
  const id = seedSprite();
  useProjectStore.getState().transformSprite(id, { kind: 'd4', op: 'rot90' });
  const s = get(id);
  check('A1 尺寸 4×3 → 3×4', s.width === 3 && s.height === 4);
  check('A2 源(0,0) → 目标(2,0)（左上→右上）', s.data[0]![2] === '#000000');
  check('A3 源(3,2) → 目标(0,3)（右下→左下）', s.data[3]![0] === '#320000');
  check('A4 plug (1,1) → (2,1)', subToPx(s.plug!.x) === 2 && subToPx(s.plug!.y) === 1);
  check('A5 heightmap 同步置换：目标(2,0) = 源(0,0) = 0；目标(0,3) = 源(3,2) = 23', s.heightmap![0]![2] === 0 && s.heightmap![3]![0] === 23);
  const le = s.landmarks!.leftEye!;
  const no = s.landmarks!.nose!;
  check('A6 landmarks：leftEye (0,0)→(1,0)，nose (0.5,0.5)→(0.5,0.5)', near(le.x, 1) && near(le.y, 0) && near(no.x, 0.5) && near(no.y, 0.5));
}

console.log('B store 级：rot90 ×4 恒等（置换双射、无损往返）');
{
  const id = seedSprite();
  const before = JSON.stringify(get(id).data);
  for (let i = 0; i < 4; i++) useProjectStore.getState().transformSprite(id, { kind: 'd4', op: 'rot90' });
  const s = get(id);
  check('B1 尺寸复原 4×3', s.width === 4 && s.height === 3);
  check('B2 像素全等', JSON.stringify(s.data) === before);
  check('B3 plug 复原 (1,1)', subToPx(s.plug!.x) === 1 && subToPx(s.plug!.y) === 1);
}

console.log('C store 级路由：rotate 180 落 D4、rotate 360 恒等');
{
  const id = seedSprite();
  const orig = get(id).data;
  useProjectStore.getState().transformSprite(id, { kind: 'rotate', angleDeg: 180 });
  const expect = d4TransformGrid(orig, 'rot180', null);
  check('C1 rotate 180 == d4 rot180', JSON.stringify(get(id).data) === JSON.stringify(expect));
  const id2 = seedSprite();
  const before2 = JSON.stringify(get(id2).data);
  useProjectStore.getState().transformSprite(id2, { kind: 'rotate', angleDeg: 360 });
  check('C2 rotate 360 无变化', JSON.stringify(get(id2).data) === before2);
  const id3 = seedSprite();
  const before3 = get(id3).data;
  useProjectStore.getState().transformSprite(id3, { kind: 'mirrorAxis', axisDeg: 90 });
  const expect3 = d4TransformGrid(before3, 'flipH', null);
  check('C3 mirrorAxis 90 == d4 flipH', JSON.stringify(get(id3).data) === JSON.stringify(expect3));
}

console.log('D 路由分类（纯函数）');
{
  check('D1 rotate: 90→rot90, -90→rot270, 450→rot90, 30→null', classifyRotate(90) === 'rot90' && classifyRotate(-90) === 'rot270' && classifyRotate(450) === 'rot90' && classifyRotate(30) === null);
  check('D2 rotate: 0/360→identity', classifyRotate(0) === 'identity' && classifyRotate(360) === 'identity');
  check('D3 axis: 0→flipV, 45→transpose, 90→flipH, 135→antiTranspose, 180→flipV, 10→null',
    classifyMirrorAxis(0) === 'flipV' && classifyMirrorAxis(45) === 'transpose' && classifyMirrorAxis(90) === 'flipH' && classifyMirrorAxis(135) === 'antiTranspose' && classifyMirrorAxis(180) === 'flipV' && classifyMirrorAxis(10) === null);
}

console.log('E 矩阵构造（纯函数）');
{
  // 旋转 90° 绕 (5,5)：点 (7,5) → (5,7)（顺时针，y 下）；枢轴不动
  const rm = rotationMatrixAbout(90, 5, 5);
  const p = applyAffine(rm, 7, 5);
  const pv = applyAffine(rm, 5, 5);
  check('E1 旋转矩阵：(7,5)→(5,7)，枢轴不动', near(p.x, 5) && near(p.y, 7) && near(pv.x, 5) && near(pv.y, 5));
  // 镜像轴 0° 绕 (5,5) == flipV 连续映射（10×10）：(3,2) → (3,8)
  const mm0 = mirrorAxisMatrixAbout(0, 5, 5);
  const q0 = applyAffine(mm0, 3, 2);
  const d0 = d4MapPoint('flipV', 3, 2, 10, 10);
  check('E2 轴 0° == flipV', near(q0.x, d0.x) && near(q0.y, d0.y));
  // 镜像轴 45° 绕 (5,5) == transpose：(3,2) → (2,3)；二次镜像恒等
  const mm45 = mirrorAxisMatrixAbout(45, 5, 5);
  const q45 = applyAffine(mm45, 3, 2);
  const q45b = applyAffine(mm45, q45.x, q45.y);
  check('E3 轴 45° == transpose 且自逆', near(q45.x, 2) && near(q45.y, 3) && near(q45b.x, 3) && near(q45b.y, 2));
  // 任意轴 30°：轴上点不动（轴过 (5,5)、方向 30°：点 (5+cos30, 5+sin30)）
  const mm30 = mirrorAxisMatrixAbout(30, 5, 5);
  const onAxis = { x: 5 + Math.cos(Math.PI / 6), y: 5 + Math.sin(Math.PI / 6) };
  const qa = applyAffine(mm30, onAxis.x, onAxis.y);
  check('E4 任意轴：轴上点不动', near(qa.x, onAxis.x) && near(qa.y, onAxis.y));
}

console.log('F heightmap 仿射重采样与 D4 一致（rot90 矩阵 vs 置换）');
{
  const src = Array.from({ length: 10 }, (_, y) => Array.from({ length: 10 }, (_, x) => y * 10 + x));
  const m = rotationMatrixAbout(90, 5, 5);
  const rs = resampleGridAffine(src, m, 0, 0, 10, 10, 0);
  const d4 = d4TransformGrid(src, 'rot90', 0);
  check('F1 重采样 == D4 置换', rs !== null && JSON.stringify(rs) === JSON.stringify(d4));
}

console.log(`\n合计：${pass} 过 / ${fail} 败`);
process.exit(fail === 0 ? 0 : 1);
