// verify-direction-trig.mts — 离散方向常量表探针（bun 运行）
// 口径：8 方向 (cosθ,sinθ) 查表。正交向（东南西北）必须精确为 0/±1——
// 浮点现算 sin(π)≈1.22e-16 曾让北向投影深度带 1e-13 量级假差；斜向与
// 旧公式只许差浮点末位。投影/socket 映射在正交向须给出精确整数。
import {
  directionTrig,
  projectToView,
  mapDragTo3D,
  worldToViewBasis,
  viewBasisToWorld,
  pxToSub,
  type DirectionIndex,
  type SubPixel,
} from '../src/lib/unified-types';
import { socketOffsetTo3D } from '../src/lib/unified-render';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; console.log(`✗ ${name}`); }
}
const CARDINALS = [0, 2, 4, 6] as const;

// ---- 表值：与旧公式对照；正交向精确 ----
for (let d = 0; d < 8; d++) {
  const dir = d as DirectionIndex;
  const theta = (((dir + 2) % 8) * Math.PI) / 4;
  const t = directionTrig(dir);
  check(`dir${dir} 与旧公式差≤1e-12`, Math.abs(t.cos - Math.cos(theta)) <= 1e-12 && Math.abs(t.sin - Math.sin(theta)) <= 1e-12);
  if ((CARDINALS as readonly number[]).includes(dir)) {
    const exact = (v: number) => v === 0 || v === 1 || v === -1;
    check(`dir${dir} 正交向精确 0/±1`, exact(t.cos) && exact(t.sin));
  }
}

// ---- 投影：正交向精确整数 ----
{
  const n = projectToView(pxToSub(24) as SubPixel, pxToSub(7) as SubPixel, 0 as SubPixel, 2);
  check('北向 depth 精确 0', n.depth === 0);
  check('北向 canvasX 精确 -384', n.canvasX === -384);
  const e = projectToView(0 as SubPixel, 0 as SubPixel, pxToSub(24) as SubPixel, 0);
  check('东向 depth 精确 0', e.depth === 0 && e.canvasX === 384);
  const s = projectToView(pxToSub(3) as SubPixel, 0 as SubPixel, pxToSub(5) as SubPixel, 6);
  check('南向直通精确', s.canvasX === 48 && s.depth === 80);
  const w = projectToView(0 as SubPixel, 0 as SubPixel, pxToSub(24) as SubPixel, 4);
  check('西向 canvasX 精确 -384', w.canvasX === -384 && w.depth === 0);
}

// ---- 投影：斜向与旧公式只差末位 ----
{
  const oldProj = (x: number, z: number, dir: number) => {
    const theta = (((dir + 2) % 8) * Math.PI) / 4;
    return { cx: x * Math.cos(theta) + z * Math.sin(theta), dep: -x * Math.sin(theta) + z * Math.cos(theta) };
  };
  for (const dir of [1, 3, 5, 7] as const) {
    const p = projectToView(321 as SubPixel, 0 as SubPixel, -157 as SubPixel, dir);
    const o = oldProj(321, -157, dir);
    check(`斜向 dir${dir} 与旧公式差≤1e-9`, Math.abs(p.canvasX - o.cx) <= 1e-9 && Math.abs(p.depth - o.dep) <= 1e-9);
  }
}

// ---- socket 2D→3D 映射：正交向精确（旧公式在东向 x 会带 ~1e-15 残留）----
{
  const sock = { basePosition: { x: pxToSub(24), y: pxToSub(3) }, directionOffsets: {} } as unknown as Parameters<typeof socketOffsetTo3D>[0];
  const n = socketOffsetTo3D(sock, 2);
  check('socket 北向 z 精确 0', n.z === 0 && n.x === -24 && n.y === 3);
  const e = socketOffsetTo3D(sock, 0);
  check('socket 东向 x 精确 0', e.x === 0 && e.z === 24);
}

// ---- 基变换往返：正交向精确、斜向末位 ----
for (let d = 0; d < 8; d++) {
  const dir = d as DirectionIndex;
  const v = worldToViewBasis(111, 55, -77, dir);
  const back = viewBasisToWorld(v.h, v.y, v.d, dir);
  const tol = (CARDINALS as readonly number[]).includes(dir) ? 0 : 1e-9;
  check(`dir${dir} 基变换往返`, Math.abs(back.x - 111) <= tol && Math.abs(back.z - -77) <= tol && back.y === 55);
}

// ---- 拖动映射：正交向精确 ----
{
  const e = mapDragTo3D(pxToSub(10) as SubPixel, pxToSub(2) as SubPixel, 0);
  check('拖动东向精确', e.dx3 === 0 && e.dz3 === 160 && e.dy3 === 32);
}

console.log(`verify-direction-trig: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
