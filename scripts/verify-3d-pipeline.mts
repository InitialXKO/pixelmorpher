/**
 * 验证 3D 烘焙管线核心公式（无需 WebGL，纯数学验证）
 * 
 * 验证项：
 * 1. node.transform: joint3D差值 → SubPixel（含Y取反、全局尺度）
 * 2. sprite.plug: (jx-x0)*cameraHalf
 * 3. scaleFactor: global/part（渲染时精灵缩放方向）
 * 4. projectToView: 南向投影应为恒等（x→x, y→y）
 */

import { pxToSub, subToPx, projectToView } from '../src/lib/unified-types.ts';

let passed = 0;
let failed = 0;

function assert(name: string, actual: number, expected: number, tolerance = 0.01) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    console.log(`✓ ${name}: ${actual} ≈ ${expected}`);
    passed++;
  } else {
    console.log(`✗ ${name}: ${actual} ≠ ${expected} (差 ${diff})`);
    failed++;
  }
}

console.log('=== 1. node.transform 计算 ===');
// 模拟：hips (0,0,0) → spine (0, 0.5, 0)，W=128, globalCameraHalf=1.0
// scale = (128/2)/1.0 = 64
// transform.y = -(0.5-0)*64 = -32 (Y-up转Y-down，SubPixel: -32*16=-512)
const scale = (128 / 2) / 1.0;
const ty = pxToSub(-(0.5 - 0) * scale);
assert('transform.y (spine相对hips)', ty, pxToSub(-32));

// X: hips (0,0,0) → 左大腿 (-0.2, -0.1, 0)
const tx = pxToSub((-0.2 - 0) * scale);
assert('transform.x (左大腿相对hips)', tx, pxToSub(-12.8));

console.log('\n=== 2. sprite.plug 计算 ===');
// jx=50, x0=10, cameraHalf=0.5 → plugX = (50-10)*0.5 = 20 (像素)
// SubPixel: 20*16=320
const plugX = pxToSub((50 - 10) * 0.5);
assert('plugX', plugX, 320);

console.log('\n=== 3. scaleFactor 方向 ===');
// 小部件：partCH=0.2（相机紧，图里大）, globalCH=1.0 → 应缩小到0.2倍
const sf = 0.2 / 1.0;
assert('scaleFactor (小部件缩小)', sf, 0.2);
// 大部件：partCH=0.9, globalCH=1.0 → 缩小到0.9倍
assert('scaleFactor (大部件微调)', 0.9 / 1.0, 0.9, 0.01);

console.log('\n=== 4. projectToView 南向 ===');
// 南向 direction=6, theta=0 → canvasX=x, canvasY=y
const proj = projectToView(100, 200, 300, 6);
assert('南向 canvasX=x', proj.canvasX, 100);
assert('南向 canvasY=y', proj.canvasY, 200);

console.log('\n=== 5. projectToView 东向 ===');
// 东向 direction=0, theta=90° → canvasX=z, canvasY=y
const projE = projectToView(100, 200, 300, 0);
assert('东向 canvasX=z', projE.canvasX, 300, 1);
assert('东向 canvasY=y', projE.canvasY, 200);

console.log(`\n=== 结果：${passed} 通过，${failed} 失败 ===`);
process.exit(failed > 0 ? 1 : 0);
