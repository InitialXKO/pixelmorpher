// ============================================================
// 探针：PMX 重合加算附加层识别（2026-10-25，移植 3Dto2Dshape 口径）
// 候选 = 球面贴图 + 加算模式（sphereMode=2）；仅当候选组每个三角形都
// 在非候选组里有位置重合 + 蒙皮权重一致的孪生三角形时才剔除。
// 跑法：/opt/hatch-image/bin/bun spikes/bake3d/probe-material-overlays.mts
// ============================================================

import * as THREE from 'three';
import { findRedundantMaterialOverlayGroups, omitRedundantOverlayMaterials } from '../../src/lib/bake/material-overlays.ts';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
};

const mat = (sphereMode: number, withSphere: boolean, opacity = 1) => {
  const m = new THREE.MeshStandardMaterial({ opacity, transparent: opacity < 1, side: THREE.DoubleSide });
  if (withSphere) m.userData.pmxSphereMap = {};
  m.userData.pmxSphereMode = sphereMode;
  return m;
};

/** 两个三角形：本体组（顶点 0-2）+ 候选组（顶点 3-5，坐标可偏移、权重可改） */
function build(opts: { shift?: number; weightB?: number; baseOpacity?: number }) {
  const pos = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 0, 1, 0, 0, 0, 1, (opts.shift ?? 0),
  ]);
  const skin = new Float32Array(6 * 4);
  const wts = new Float32Array(6 * 4);
  for (let v = 0; v < 6; v++) { skin[v * 4] = 0; wts[v * 4] = v < 3 ? 1 : (opts.weightB ?? 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skin, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(wts, 4));
  geo.setIndex([0, 1, 2, 3, 4, 5]);
  geo.addGroup(0, 3, 0);
  geo.addGroup(3, 3, 1);
  const materials = [mat(0, false, opts.baseOpacity ?? 1), mat(2, true)];
  return { geo, materials };
}

// 完全重合 + 权重一致 → 剔除候选组（下标 1）
{
  const { geo, materials } = build({});
  const omitted = findRedundantMaterialOverlayGroups(geo, materials, geo.groups);
  check('完全重合的加算层被识别', omitted.has(1) && omitted.size === 1, `size=${omitted.size}`);
}
// 候选三角形微偏 → 不剔除
{
  const { geo, materials } = build({ shift: 0.01 });
  const omitted = findRedundantMaterialOverlayGroups(geo, materials, geo.groups);
  check('位置微偏不剔除', omitted.size === 0);
}
// 权重不同（动画会分离）→ 不剔除
{
  const { geo, materials } = build({ weightB: 0.5 });
  const omitted = findRedundantMaterialOverlayGroups(geo, materials, geo.groups);
  check('蒙皮权重不同不剔除', omitted.size === 0);
}
// 乘算（sphereMode=1）不是候选 → 不剔除
{
  const { geo, materials } = build({});
  (materials[1].userData as Record<string, unknown>).pmxSphereMode = 1;
  const omitted = findRedundantMaterialOverlayGroups(geo, materials, geo.groups);
  check('乘算球面层不剔除', omitted.size === 0);
}
// 本体不透明度 <1（不算可靠底）→ 不剔除
{
  const { geo, materials } = build({ baseOpacity: 0.5 });
  const omitted = findRedundantMaterialOverlayGroups(geo, materials, geo.groups);
  check('本体半透明时不剔除', omitted.size === 0);
}
// 场景级：omitRedundantOverlayMaterials 把命中材质置不可见并留名
{
  const { geo, materials } = build({});
  materials[1].name = 'highlight_add';
  const mesh = new THREE.Mesh(geo, materials);
  const omitted = omitRedundantOverlayMaterials(mesh);
  check('场景级剔除返回材质下标 1', omitted.length === 1 && omitted[0] === 1);
  check('命中材质已不可见、本体仍可见', materials[1].visible === false && materials[0].visible === true);
  check('mesh.userData 留下被剔除材质名', JSON.stringify(mesh.userData.omittedOverlayMaterials) === '["highlight_add"]');
}

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
