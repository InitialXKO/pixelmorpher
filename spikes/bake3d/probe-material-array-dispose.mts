// ============================================================
// 探针：PMX 多材质数组网格过 applyToonMaterials 不得抛 dispose 错
// （2026-10-25 真机报障：MMD 双遍烘焙 "t.dispose is not a function"——
// 旧实现把 mesh.material 当单个材质调 dispose，PMX 场景是材质数组）。
// 跑法：/opt/hatch-image/bin/bun spikes/bake3d/probe-material-array-dispose.mts
// ============================================================

import * as THREE from 'three';
import { applyToonMaterials } from '../../src/lib/bake/threejs-baker-twopass.ts';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
};

const gradient = new THREE.DataTexture(new Uint8Array([0, 128, 255]), 3, 1, THREE.RedFormat);
gradient.needsUpdate = true;

// ---- PMX 形态：单网格 + 材质数组（3 个材质） ----
{
  const disposed: string[] = [];
  const mk = (name: string, hex: number) => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex) });
    m.name = name;
    const orig = m.dispose.bind(m);
    m.dispose = () => { disposed.push(name); orig(); };
    return m;
  };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geo.addGroup(0, 3, 0);
  const mesh = new THREE.Mesh(geo, [mk('a', 0xff0000), mk('b', 0x00ff00), mk('c', 0x0000ff)]);
  const root = new THREE.Group(); root.add(mesh);
  let threw: Error | null = null;
  try { applyToonMaterials(root, gradient); } catch (e) { threw = e as Error; }
  check('材质数组不抛错', threw === null, threw?.message ?? '');
  check('网格换成单个卡通材质', (mesh.material as THREE.Material).type === 'MeshToonMaterial');
  check('基色取首个材质的红', (() => {
    const c = (mesh.material as THREE.MeshToonMaterial).color;
    return Math.abs(c.r - 1) < 1e-6 && c.g === 0 && c.b === 0;
  })());
  check('三个旧材质逐个释放', disposed.join(',') === 'a,b,c', disposed.join(','));
}

// ---- GLB 形态：单材质不回归 ----
{
  let disposed = 0;
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x00ff00) });
  const orig = m.dispose.bind(m);
  m.dispose = () => { disposed++; orig(); };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  const mesh = new THREE.Mesh(geo, m);
  const root = new THREE.Group(); root.add(mesh);
  applyToonMaterials(root, gradient);
  check('单材质换卡通 + 释放一次', disposed === 1 && (mesh.material as THREE.Material).type === 'MeshToonMaterial');
}

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
