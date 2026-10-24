// ============================================================
// 探针：烘焙三选项（2026-10-25 用户三裁定）
// 一、权重阈值可调：assignBoneVertexColors 按传入阈值决定顶点归属骨骼集
// 三-a、六部件无归属三角形：groupTrianglesByPart absorb 开关（邻近投票/孤立仍丢弃）
// 三-b、手动未分配网格：prepareManualParts absorb 开关（共享顶点投票优先于距离）
// 跑法：/opt/hatch-image/bin/bun spikes/bake3d/probe-bake-options.mts
// ============================================================

import * as THREE from 'three';
import { assignBoneVertexColors } from '../../src/lib/bake/threejs-baker-twopass.ts';
import { groupTrianglesByPart } from '../../src/lib/bake/threejs-baker-sixpart.ts';
import { prepareManualParts } from '../../src/lib/bake/threejs-baker-manual.ts';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
};

// ---------- 一、权重阈值 ----------
{
  const b0 = new THREE.Bone(); b0.name = 'b0';
  const b1 = new THREE.Bone(); b1.name = 'b1';
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0]), 3));
  // v0: bone0 0.85 / bone1 0.15；v1: 各 0.5
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array([0, 1, 0, 0, 0, 1, 0, 0]), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array([0.85, 0.15, 0, 0, 0.5, 0.5, 0, 0]), 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.add(b0); mesh.add(b1);
  mesh.bind(new THREE.Skeleton([b0, b1]));
  const indexByBone = new Map([[b0, 0], [b1, 1]]);
  const bindPos = [new THREE.Vector3(), new THREE.Vector3(1, 0, 0)];
  const byte0 = (v: number) => Math.round((geo.getAttribute('color') as THREE.BufferAttribute).getX(v) * 255);

  assignBoneVertexColors(mesh, indexByBone, bindPos, [0, 1], 0.2);
  check('阈值 0.2：v0 只归 bone0', byte0(0) === 0b01, `byte0=${byte0(0)}`);
  check('阈值 0.2：v1 双归属', byte0(1) === 0b11, `byte0=${byte0(1)}`);

  assignBoneVertexColors(mesh, indexByBone, bindPos, [0, 1], 0.1);
  check('阈值 0.1：v0 双归属（0.15>0.1）', byte0(0) === 0b11, `byte0=${byte0(0)}`);

  assignBoneVertexColors(mesh, indexByBone, bindPos, [0, 1], 0.6);
  check('阈值 0.6：v0 只归 bone0（0.85）', byte0(0) === 0b01, `byte0=${byte0(0)}`);
  check('阈值 0.6：v1 无归属', byte0(1) === 0, `byte0=${byte0(1)}`);
}

// ---------- 三-a、六部件无归属三角形归入 ----------
{
  const positions = new Float32Array(8 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex([0, 1, 2, 2, 3, 4, 5, 6, 7]);
  // tri0 (0,1,2)：v0/v1 主导 bone0（torso），v2 主导 bone1（无部件）
  // tri1 (2,3,4)：全顶点主导 bone1 → 无归属，但与 tri0 共享 v2
  // tri2 (5,6,7)：全顶点主导 bone1 且不与任何已归属三角形共享顶点 → 孤立
  const vertBone = new Int32Array([0, 0, 1, 1, 1, 1, 1, 1]);
  const baked = { geometry: geo, material: null, vertBone, vertBones: [[], [], [], [], [], [], [], []] } as never;
  const boneToPart = ['torso', null] as never;

  const off = groupTrianglesByPart(baked, boneToPart, false);
  check('六部件 absorb 关：torso 只含 tri0', off.groups.get('torso')!.tris.length === 1);
  check('六部件 absorb 关：丢弃 2', off.droppedTris === 2, `dropped=${off.droppedTris}`);
  check('六部件 absorb 关：归入 0', off.absorbedTris === 0);

  const on = groupTrianglesByPart(baked, boneToPart, true);
  const tris = on.groups.get('torso')!.tris;
  check('六部件 absorb 开：共享顶点的孤儿 tri1 归入 torso', tris.length === 2 && tris.some((t) => t[0] === 2 && t[1] === 3 && t[2] === 4), `tris=${JSON.stringify(tris)}`);
  check('六部件 absorb 开：归入 1、孤立仍丢弃 1', on.absorbedTris === 1 && on.droppedTris === 1, `absorbed=${on.absorbedTris} dropped=${on.droppedTris}`);
}

// ---------- 三-b、手动未分配网格归入 ----------
{
  const mkStatic = (meshIndex: number, pts: number[]) => ({
    info: { meshIndex, name: `m${meshIndex}`, path: '', triCount: 1, pivot: { x: 0, y: 0, z: 0 }, parentMeshIndex: null },
    positions: new Float32Array(pts),
    uvs: null,
    index: null,
    material: new THREE.MeshBasicMaterial(),
    groups: [],
  });
  const statics = [
    mkStatic(0, [0, 0, 0, 1, 0, 0, 0, 1, 0]), // 部件 A
    mkStatic(3, [10, 0, 0, 11, 0, 0, 10, 1, 0]), // 部件 B
    mkStatic(1, [1, 0, 0, 9, 0, 0, 9, 1, 0]), // 未分配：与 A 共享顶点 (1,0,0)，但位置更靠近 B
    mkStatic(2, [9.6, 0, 0, 10.4, 0.2, 0, 10, 0.8, 0]), // 未分配：无共享顶点，离 B 最近
  ] as never[];
  const specs = [
    { name: 'A', meshIndices: [0] },
    { name: 'B', meshIndices: [3] },
  ] as never[];

  const off = prepareManualParts(statics, specs, 1.25, false);
  check('手动 absorb 关：无归入记录', off.absorbedMeshes.length === 0);
  check('手动 absorb 关：部件网格数 1/1', off.parts[0].meshes.length === 1 && off.parts[1].meshes.length === 1);

  const on = prepareManualParts(statics, specs, 1.25, true);
  const rec = new Map(on.absorbedMeshes.map((a) => [a.meshIndex, a.partIndex]));
  check('手动 absorb 开：共享顶点网格 1 归 A（投票优先于距离）', rec.get(1) === 0, `rec=${JSON.stringify(on.absorbedMeshes)}`);
  check('手动 absorb 开：无共享网格 2 按最近归 B', rec.get(2) === 1);
  check('手动 absorb 开：部件网格数 2/2', on.parts[0].meshes.length === 2 && on.parts[1].meshes.length === 2);
}

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
