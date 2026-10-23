// 复合仿射（像素完美旋转的 S·K 第一步）纯数学探针
// 运行：bun scripts/verify-affine-rotation.mts
import { composeLocalAffine, computeAffineFrame, applyAffine, mulAffine, IDENTITY_AFFINE } from '../src/lib/engine/affine';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function near(a: number, b: number, eps = 1e-9) { return Math.abs(a - b) <= eps; }
function ptNear(p: { x: number; y: number }, x: number, y: number, eps = 1e-9) { return near(p.x, x, eps) && near(p.y, y, eps); }

console.log('A 恒等与对角等价（与旧闭式口径对照）');
{
  const m = composeLocalAffine(1, 1, []);
  check('A1 恒等矩阵', m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0);
  const f = computeAffineFrame(10, 8, 3, 2, m);
  check('A2 恒等 frame', f.minX === 0 && f.minY === 0 && f.width === 10 && f.height === 8 && f.pivotX === 3 && f.pivotY === 2);
  // 旧对角路径闭式：stretch 1.5 → 高 12、pivotY 3、pivotX/宽不变
  const fs = computeAffineFrame(10, 8, 3, 2, composeLocalAffine(1, 1.5, []));
  check('A3 stretch 折叠与旧口径一致', near(fs.width, 10) && near(fs.height, 12) && near(fs.pivotX, 3) && near(fs.pivotY, 3));
}

console.log('B scaleX（含负值=动态镜像）');
{
  const f2 = computeAffineFrame(10, 8, 3, 2, composeLocalAffine(2, 1, []));
  check('B1 scaleX=2', near(f2.width, 20) && near(f2.height, 8) && near(f2.pivotX, 6) && near(f2.pivotY, 2));
  const fm = computeAffineFrame(10, 8, 3, 2, composeLocalAffine(-1, 1, []));
  // 静态镜像的既有口径：pivot → width − pivotX = 7
  check('B2 scaleX=-1 枢轴与镜像口径一致', near(fm.width, 10) && near(fm.pivotX, 7) && near(fm.pivotY, 2));
  const f0 = computeAffineFrame(10, 8, 3, 2, composeLocalAffine(0, 1, []));
  check('B3 scaleX=0 退化为零宽（函数侧据此返回透明）', f0.width === 0);
}

console.log('C skew（Canvas transform 约定：x\'=x+tan(skewX)·y，y\'=tan(skewY)·x+y）');
{
  const fx = computeAffineFrame(10, 8, 3, 2, composeLocalAffine(1, 1, [{ skewX: 45, skewY: 0 }]));
  check('C1 skewX 45° 包围盒', near(fx.minX, 0) && near(fx.width, 18) && near(fx.height, 8));
  check('C2 skewX 45° 枢轴', near(fx.pivotX, 5) && near(fx.pivotY, 2));
  const fy = computeAffineFrame(10, 8, 3, 2, composeLocalAffine(1, 1, [{ skewX: 0, skewY: 45 }]));
  check('C3 skewY 45°', near(fy.width, 10) && near(fy.height, 18) && near(fy.pivotX, 3) && near(fy.pivotY, 5));
}

console.log('D 复合顺序与 Canvas 后乘一致（先 skew 作用于点、scale 在其外）');
{
  // M = S(2, 1.5) · K(skewX 45)：点 (4, 2) 先经 K → (6, 2)，再经 S → (12, 3)
  const m = composeLocalAffine(2, 1.5, [{ skewX: 45, skewY: 0 }]);
  check('D1 S·K 逐点', ptNear(applyAffine(m, 4, 2), 12, 3));
  // 多个 skew 按数组顺序逐个后乘：M = S · K1 · K2，点先过 K2 再 K1
  const k1 = { skewX: 45, skewY: 0 };
  const k2 = { skewX: 0, skewY: 45 };
  const mm = composeLocalAffine(1, 1, [k1, k2]);
  const step1 = applyAffine(composeLocalAffine(1, 1, [k2]), 1, 1); // K2: (1, 2)
  const step2 = applyAffine(composeLocalAffine(1, 1, [k1]), step1.x, step1.y); // K1: (3, 2)
  check('D2 多 skew 顺序', ptNear(applyAffine(mm, 1, 1), step2.x, step2.y) && ptNear(step2, 3, 2));
}

console.log('E 「旋转殿后」恒等式：R∘A 与整链逐点一致');
{
  const A = composeLocalAffine(-1.6, 1.3, [{ skewX: 12, skewY: -8 }, { skewX: 0, skewY: 20 }]);
  const pivot = { x: 4.5, y: 3.25 };
  const Ap = applyAffine(A, pivot.x, pivot.y);
  const th = (37 * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  let ok = true;
  for (const [x, y] of [[0, 0], [11, 0], [0, 9], [11, 9], [5.5, 4.5], [2, 7]] as const) {
    // 整链：q = R·(A(p) − A(pivot)) + A(pivot)（= 原生链 T·R·S·K 以枢轴为中心）
    const ap = applyAffine(A, x, y);
    const dx = ap.x - Ap.x;
    const dy = ap.y - Ap.y;
    const q = { x: dx * cos - dy * sin + Ap.x, y: dx * sin + dy * cos + Ap.y };
    // 分解构造：中间帧枢轴相对坐标旋转（复合路径 Step1→Step2 的数学骨架）
    const rel = { x: ap.x - Ap.x, y: ap.y - Ap.y };
    const r = { x: rel.x * cos - rel.y * sin, y: rel.x * sin + rel.y * cos };
    const q2 = { x: r.x + Ap.x, y: r.y + Ap.y };
    if (!ptNear(q, q2.x, q2.y)) ok = false;
    // 与矩阵复合对照：full = T(Ap) · R · T(−Ap) · A
    const full = mulAffine(
      { a: 1, b: 0, c: 0, d: 1, e: Ap.x, f: Ap.y },
      mulAffine(
        { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 },
        mulAffine({ a: 1, b: 0, c: 0, d: 1, e: -Ap.x, f: -Ap.y }, A),
      ),
    );
    const q3 = applyAffine(full, x, y);
    if (!ptNear(q, q3.x, q3.y)) ok = false;
  }
  check('E1 含负 scaleX+双 skew+任意角，分解与整链逐点一致', ok);
  check('E2 IDENTITY 自反', mulAffine(IDENTITY_AFFINE, A).a === A.a && mulAffine(A, IDENTITY_AFFINE).d === A.d);
}

console.log(`\n合计：${pass} 过 / ${fail} 败`);
process.exit(fail === 0 ? 0 : 1);
