// PMX → THREE 场景桥接：把 PMXParser 的解析数据构建成与 GLB 同形的
// THREE.Group（SkinnedMesh + Bone 层级 + 按材质分组），喂现有烘焙管线。
// 构建口径仿用户提供参考（SFV sfv-viewer/mmd/index.ts 的 buildThreeSkinnedMesh），
// 材质为 MeshStandardMaterial（diffuse 色 + map + DoubleSide），烘焙时由管线
// 统一转 toon（makeToonFromSource）；「PMX 原味着色」开关打开时改走参考版
// NPR 着色（pmx-npr.ts）。sphere 贴图挂 userData.pmxSphereMap（烘焙暂不消费），
// PMX toon 贴图不单独加载（NPR 预设是参数化的，不消费 toon 图）。

import * as THREE from 'three';
import type { PMXParsedData } from './pmx-parser';

export type PMXTextureResolver = (texPath: string) => Promise<THREE.Texture | null>;

/** PMX 贴图路径归一：反斜杠→斜杠、去 ./ 与前导 /（zip 内路径匹配用） */
export function normalizePMXPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '').toLowerCase();
}

/** zip 文件表（路径→Blob）→ 贴图解析器：先全路径、后 basename 匹配 */
export function createBlobTextureResolver(files: Map<string, Blob>): PMXTextureResolver {
  const byPath = new Map<string, Blob>();
  const byBase = new Map<string, Blob>();
  for (const [path, blob] of files) {
    const n = normalizePMXPath(path);
    byPath.set(n, blob);
    const base = n.split('/').pop()!;
    if (!byBase.has(base)) byBase.set(base, blob);
  }
  const loader = new THREE.TextureLoader();
  return async (texPath: string) => {
    const n = normalizePMXPath(texPath);
    const blob = byPath.get(n) ?? byBase.get(n.split('/').pop()!);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    try {
      const tex = await loader.loadAsync(url);
      tex.flipY = false; // PMX UV 原点在左上（DirectX 约定）
      return tex;
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  };
}

export async function buildPMXScene(
  data: PMXParsedData,
  resolveTexture: PMXTextureResolver,
): Promise<THREE.Group> {
  const vertexCount = data.positions.length / 3;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  const skinIndices = new Float32Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);
  skinIndices.set(data.skinIndices);
  for (let i = 0; i < vertexCount * 4; i++) skinWeights[i] = data.skinWeights[i] / 255;
  geometry.setAttribute('skinIndex', new THREE.Float32BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  // PMX 材质的 vertexCount 实为 index 数，逐材质建 group
  let indexOffset = 0;
  for (let i = 0; i < data.materials.length; i++) {
    geometry.addGroup(indexOffset, data.materials[i].vertexCount, i);
    indexOffset += data.materials[i].vertexCount;
  }

  // 骨骼层级（bindTranslation 为父相对偏移，与参考实现一致）
  const threeBones: THREE.Bone[] = [];
  const boneRoot = new THREE.Bone();
  boneRoot.name = 'PMX_Root';
  for (let i = 0; i < data.bones.length; i++) {
    const bone = new THREE.Bone();
    bone.name = data.bones[i].name;
    bone.position.set(
      data.bones[i].bindTranslation[0],
      data.bones[i].bindTranslation[1],
      data.bones[i].bindTranslation[2],
    );
    threeBones.push(bone);
  }
  for (let i = 0; i < data.bones.length; i++) {
    const p = data.bones[i].parentIndex;
    if (p >= 0 && p < threeBones.length) threeBones[p].add(threeBones[i]);
    else boneRoot.add(threeBones[i]);
  }
  // 关键（参考实现标注）：建 Skeleton 前先刷 matrixWorld，
  // 否则 Skeleton 用 identity 算 boneInverses、蒙皮不生效
  boneRoot.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(threeBones);

  // 材质（与参考版同建法）+ 贴图解析
  const materials: THREE.Material[] = [];
  for (const mat of data.materials) {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(mat.diffuse[0], mat.diffuse[1], mat.diffuse[2]),
      transparent: mat.diffuse[3] < 1.0,
      opacity: mat.diffuse[3],
      side: THREE.DoubleSide,
    });
    m.name = mat.name;
    if (mat.diffuseTextureIndex >= 0 && mat.diffuseTextureIndex < data.textures.length) {
      const tex = await resolveTexture(data.textures[mat.diffuseTextureIndex]);
      if (tex) {
        tex.colorSpace = THREE.SRGBColorSpace;
        m.map = tex;
      }
    }
    if (mat.sphereTextureIndex >= 0 && mat.sphereTextureIndex < data.textures.length) {
      const sphereTex = await resolveTexture(data.textures[mat.sphereTextureIndex]);
      if (sphereTex) m.userData.pmxSphereMap = sphereTex;
    }
    materials.push(m);
  }

  const skinnedMesh = new THREE.SkinnedMesh(
    geometry,
    materials.length === 1 ? materials[0] : materials,
  );
  skinnedMesh.add(boneRoot);
  skinnedMesh.bind(skeleton);
  skinnedMesh.frustumCulled = false;

  const root = new THREE.Group();
  root.name = 'PMX_Model';
  root.add(skinnedMesh);
  return root;
}
