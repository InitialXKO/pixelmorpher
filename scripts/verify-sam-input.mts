// verify-sam-input.mts — SAM 输入侧几何探针（bun 运行）
// 覆盖：contain 映射与往返、阴影四边形的遮挡语义（线后/线前/绕端）
import {
  containFit,
  canvasToImage,
  canvasToImageClamped,
  imageToCanvas,
  shadowQuad,
  shadowQuadsForPolyline,
  pointInPolygon,
} from '../src/lib/sam-input';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; console.log(`✗ ${name}`); }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- contain 映射 ----
// 横图 200×100 进 400×400：scale=2，上下留白
{
  const f = containFit(200, 100, 400, 400);
  check('fit 横图 scale', near(f.scale, 2) && near(f.dw, 400) && near(f.dh, 200) && near(f.dx, 0) && near(f.dy, 100));
  const p = canvasToImage(f, 200, 200)!; // 画布中心 = 原图 (100,50)
  check('canvasToImage 中心', p !== null && near(p.x, 100) && near(p.y, 50));
  const back = imageToCanvas(f, p.x, p.y);
  check('映射往返', near(back.x, 200) && near(back.y, 200));
  check('矩形外为 null（上方留白）', canvasToImage(f, 200, 50) === null);
  check('矩形外为 null（图右外）', canvasToImage(f, 399, 200) !== null && canvasToImage(f, 400, 200) === null);
}
// 竖图 100×200 进 400×400：scale=2，左右留白
{
  const f = containFit(100, 200, 400, 400);
  check('fit 竖图', near(f.scale, 2) && near(f.dx, 100) && near(f.dy, 0));
  check('竖图左侧留白为 null', canvasToImage(f, 50, 200) === null);
  const c = canvasToImageClamped(f, 100, 200, -50, 999);
  check('钳制映射', c.x === 0 && c.y === 199);
}

// ---- 阴影四边形 ----
// 视点 (0,0)，竖线段 (10,-5)-(10,5)
{
  const q = shadowQuad({ x: 0, y: 0 }, { x: 10, y: -5 }, { x: 10, y: 5 }, 1000)!;
  check('阴影四边形生成', q !== null);
  check('线后像素在阴影内 (20,0)', pointInPolygon({ x: 20, y: 0 }, q));
  check('线后像素在阴影内 (20,8)', pointInPolygon({ x: 20, y: 8 }, q));
  check('线前像素不在阴影 (5,0)', !pointInPolygon({ x: 5, y: 0 }, q));
  check('绕过上端 (20,20) 不在阴影', !pointInPolygon({ x: 20, y: 20 }, q));
  check('绕过下端 (20,-20) 不在阴影', !pointInPolygon({ x: 20, y: -20 }, q));
  check('端点与视点重合退化', shadowQuad({ x: 10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, 100) === null);
}
// 折线：两段 L 形，阴影为两段四边形并集
{
  const quads = shadowQuadsForPolyline({ x: 0, y: 0 }, [{ x: 10, y: -5 }, { x: 10, y: 5 }, { x: 20, y: 5 }], 1000);
  check('折线段数', quads.length === 2);
  const inAny = (p: { x: number; y: number }) => quads.some((q) => pointInPolygon(p, q));
  check('第二段线后 (25,12) 在阴影', inAny({ x: 25, y: 12 }));
  check('折线内侧 (5,2) 不在阴影', !inAny({ x: 5, y: 2 }));
}

console.log(`verify-sam-input: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
