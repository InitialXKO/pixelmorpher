// ============================================================
// 探针：六部件静态烘焙的法线口径（2026-10-25，借 3Dto2Dshape 的
// authoredNormals 思路）——原始法线经骨骼蒙皮混合保留，不再整模
// computeVertexNormals 几何重算。
// 跑法：/opt/hatch-image/bin/bun spikes/bake3d/probe-authored-normals.mts
// ============================================================

import * as THREE from 'three';
import { bakeSkinnedMesh } from '../../src/lib/bake/threejs-baker-sixpart.ts';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

// ---- 蒙皮：骨骼绕 Z 转 90°，原始法线 (1,0,0) 应随骨骼转成 (0,1,0)；
// ---- 几何法线（三角形在 XY 平面）是 (0,0,1)，两者可明确区分
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]), 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  geo.setIndex([0, 1, 2]);
  const bone = new THREE.Bone(); bone.name = 'b0';
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  bone.rotation.z = Math.PI / 2;
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();

  const baked = bakeSkinnedMesh(mesh, [bone], new Map([[bone, 0]]));
  const n = baked.geometry.getAttribute('normal') as THREE.BufferAttribute;
  check('蒙皮后产出法线属性', !!n);
  check('法线随骨骼旋转到 (0,1,0)', near(n.getX(0), 0) && near(n.getY(0), 1) && near(n.getZ(0), 0),
    `n0=(${n.getX(0).toFixed(3)},${n.getY(0).toFixed(3)},${n.getZ(0).toFixed(3)})`);
  check('不是几何重算法线 (0,0,1)', !near(n.getZ(0), 1));
  const p = baked.geometry.getAttribute('position') as THREE.BufferAttribute;
  check('位置同口径旋转：(1,0,0)→(0,1,0)', near(p.getX(1), 0) && near(p.getY(1), 1) && near(p.getZ(1), 0),
    `p1=(${p.getX(1).toFixed(3)},${p.getY(1).toFixed(3)},${p.getZ(1).toFixed(3)})`);
}

// ---- 非蒙皮：原始法线原样拷贝 ----
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]), 3));
  geo.setIndex([0, 1, 2]);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  const baked = bakeSkinnedMesh(mesh, [], new Map());
  const n = baked.geometry.getAttribute('normal') as THREE.BufferAttribute;
  check('非蒙皮法线原样保留 (1,0,0)', near(n.getX(0), 1) && near(n.getY(0), 0) && near(n.getZ(0), 0));
}

// ---- 无原始法线：不产出法线属性（由 bakeSixParts 的兜底重算接管） ----
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geo.setIndex([0, 1, 2]);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  const baked = bakeSkinnedMesh(mesh, [], new Map());
  check('无法线源几何不产出法线属性', !baked.geometry.getAttribute('normal'));
}

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
