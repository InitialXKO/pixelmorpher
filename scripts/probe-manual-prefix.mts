/**
 * 探针：手动拆分骨骼前缀拆分的纯函数层——boneNameStem 词干、
 * prepareManualParts 的部件骨骼表（局部重映射/顶点计数/关节归一化）。
 * GL 层（ID 遍分组/两落法划分等价）在软件 GL 台另行实跑。
 */
import * as THREE from 'three';
import { prepareManualParts, boneNameStem } from '../src/lib/bake/threejs-baker-manual.ts';

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

check('词干：右親指１→右親指', boneNameStem('右親指１') === '右親指');
check('词干：Arm_2→Arm', boneNameStem('Arm_2') === 'Arm');
check('词干：左腕（无序号）不变', boneNameStem('左腕') === '左腕');
check('词干：bone.001→bone', boneNameStem('bone.001') === 'bone');
check('词干：全数字名不清空', boneNameStem('123') === '123');
check('词干：yb_0_1→yb（多段序号全剥）', boneNameStem('yb_0_1') === 'yb');
check('词干：左足首D 不动（字母尾）', boneNameStem('左足首D') === '左足首D');

// 合成静态网格：一个蒙皮网格，6 顶点分属 3 根骨骼（左手首/左親指０/左親指１）
const boneTable = [
  { name: '左手首', parentName: '左ひじ', joint: { x: 0, y: 2, z: 0 } },
  { name: '左親指０', parentName: '左手首', joint: { x: 0.5, y: 1.6, z: 0 } },
  { name: '左親指１', parentName: '左親指０', joint: { x: 0.7, y: 1.3, z: 0 } },
  { name: '左ひじ', parentName: null, joint: { x: 0, y: 3, z: 0 } },
];
const positions = new Float32Array([
  0, 2, 0, 0.2, 2, 0, 0, 2.2, 0, // 手首 ×3
  0.5, 1.6, 0, 0.7, 1.3, 0, // 親指０ / 親指１
  0.1, 2.1, 0, // 手首
]);
const vertBones = new Int32Array([0, 0, 0, 1, 2, 0]);
const statics = [{
  info: { meshIndex: 0, name: 'body', path: 'body', triCount: 2, pivot: { x: 0, y: 2, z: 0 }, parentMeshIndex: null },
  positions,
  uvs: null,
  index: null,
  material: new THREE.MeshBasicMaterial(),
  groups: [],
  vertBones,
  boneTable,
}];
const prepared = prepareManualParts(statics as any, [{ name: '手部', meshIndices: [0] }], 1.25, false);
const part = prepared.parts[0];
check('部件骨骼表 = 3 根（仅被引用的）', part.bones.length === 3, `bones=${part.bones.map((b) => b.name).join('/')}`);
check('顶点计数：手首 4 / 親指０ 1 / 親指１ 1',
  part.bones.find((b) => b.name === '左手首')?.vertexCount === 4 &&
  part.bones.find((b) => b.name === '左親指０')?.vertexCount === 1 &&
  part.bones.find((b) => b.name === '左親指１')?.vertexCount === 1);
check('网格 vertBones 已重映射到部件表', !!part.meshes[0].vertBones && part.meshes[0].vertBones![3] === part.bones.findIndex((b) => b.name === '左親指０'));
check('关节归一化：手首关节 y 在 (-1,1)', Math.abs(part.bones.find((b) => b.name === '左手首')!.jointNorm.y) < 1);
check('父名保留：親指１ 的父 = 左親指０', part.bones.find((b) => b.name === '左親指１')?.parentName === '左親指０');
// 词干分组（与烘焙内同一口径手算）：左手首 / 左親指 两组
const stems = new Set(part.bones.map((b) => boneNameStem(b.name)));
check('词干分组 = {左手首, 左親指}', stems.size === 2 && stems.has('左手首') && stems.has('左親指'), [...stems].join('/'));

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
