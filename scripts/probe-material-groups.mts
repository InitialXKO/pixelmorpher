// 探针：多材质网格（PMX 型）六部件路径——真机崩溃「reading 'elements'」的根因回归。
// 根因：mesh.material 是数组时被整体存进 BakedMesh.material，makeToonFromSource 的
// 'map' in 检查命中 Array.prototype.map，把函数当贴图，three 在 refreshTransformUniform
// 读 map.matrix.elements 崩溃。本探针钉：数组防御 + triMaterial 分组 + 视图按材质拆分。
// 运行：bun scripts/probe-material-groups.mts（退出码 0 = 全过）
import * as THREE from 'three';
import {
  bakeSkinnedMesh, buildPartGeometry, makeToonFromSource, makeGradientMap,
} from '../src/lib/bake/threejs-baker-sixpart';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra ?? ''); }
}

// ---- 1. makeToonFromSource 数组防御 ----
{
  const tex = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  const first = new THREE.MeshStandardMaterial({ color: new THREE.Color(1, 0, 0), map: tex });
  const arr = [first, new THREE.MeshStandardMaterial({ color: new THREE.Color(0, 0, 1) })] as unknown as THREE.Material;
  const toon = makeToonFromSource(arr, makeGradientMap()) as THREE.MeshToonMaterial;
  check('数组入参不再把 Array.prototype.map 当贴图', (toon.map as unknown) !== Array.prototype.map && typeof toon.map !== 'function');
  check('数组入参取第一个材质的贴图与颜色', toon.map === tex && toon.color.r === 1 && toon.color.b === 0,
    { map: toon.map?.constructor?.name, color: toon.color });
}

// ---- 2. bakeSkinnedMesh 的 triMaterial/materials + buildPartGeometry 按材质拆视图 ----
{
  // 两块四边形（4 三角形），前两三角形材质 0（红）、后两三角形材质 1（蓝），全骨骼 0
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, // quad A（+x）
    3, 0, 0, 4, 0, 0, 4, 1, 0, 3, 0, 0, 4, 1, 0, 3, 1, 0, // quad B（+x 远处）
  ]);
  const vCount = positions.length / 3;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vCount * 3).fill(0), 3));
  const skinIndex = new Uint16Array(vCount * 4);
  const skinWeight = new Float32Array(vCount * 4);
  for (let i = 0; i < vCount; i++) skinWeight[i * 4] = 1;
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  geo.addGroup(0, 6, 0);
  geo.addGroup(6, 6, 1);
  const matRed = new THREE.MeshStandardMaterial({ color: new THREE.Color(1, 0, 0) });
  const matBlue = new THREE.MeshStandardMaterial({ color: new THREE.Color(0, 0, 1) });
  const mesh = new THREE.SkinnedMesh(geo, [matRed, matBlue]);
  const bone = new THREE.Bone();
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  mesh.updateMatrixWorld(true);

  const bm = bakeSkinnedMesh(mesh, [bone], new Map([[bone, 0]]));
  check('triMaterial 按组分 [0,0,1,1]', Array.from(bm.triMaterial).join(',') === '0,0,1,1', Array.from(bm.triMaterial));
  check('materials 两份、material 为第一个', bm.materials.length === 2 && bm.material === matRed);

  const part = buildPartGeometry([bm], 'torso', ['torso']);
  check('部件构建成功', !!part);
  check('视图按材质拆成两个', part!.views.length === 2, part!.views.length);
  const red = part!.views.find((v) => v.material === matRed);
  const blue = part!.views.find((v) => v.material === matBlue);
  check('红/蓝视图各 2 三角形（index 6）且材质对位',
    !!red && !!blue && red.index.length === 6 && blue.index.length === 6,
    part!.views.map((v) => ({ m: (v.material as THREE.Material)?.name, n: v.index.length })));
  const redToon = makeToonFromSource(red!.material, makeGradientMap()) as THREE.MeshToonMaterial;
  const blueToon = makeToonFromSource(blue!.material, makeGradientMap()) as THREE.MeshToonMaterial;
  check('两视图 toon 颜色各随其材质（红/蓝）',
    redToon.color.r === 1 && redToon.color.b === 0 && blueToon.color.b === 1 && blueToon.color.r === 0);
}

console.log(`\nprobe-material-groups: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
