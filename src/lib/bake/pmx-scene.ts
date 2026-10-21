// PMX → THREE 场景桥接：把 PMXParser 的解析数据构建成与 GLB 同形的
// THREE.Group（SkinnedMesh + Bone 层级 + 按材质分组），喂现有烘焙管线。
// 构建口径仿用户提供参考（SFV sfv-viewer/mmd/index.ts 的 buildThreeSkinnedMesh），
// 材质为 MeshStandardMaterial（diffuse 色 + map + DoubleSide），烘焙时由管线
// 统一转 toon（makeToonFromSource）。PMX toon 贴图另抽成纵向亮度剖面的
// DataTexture 挂 material.userData.pmxToonGradient，供「原味着色」开关选用；
// sphere 贴图挂 userData.pmxSphereMap（烘焙暂不消费）。

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

/** 从 toon 贴图抽纵向亮度剖面 → 横向 RedFormat DataTexture（作 gradientMap 用）。
 *  MMD toon 图上亮下暗；gradientMap 横轴 0=暗（NdotL 0）→1=亮，故剖面自底向上取。 */
export function toonTextureToGradient(tex: THREE.Texture): THREE.DataTexture | null {
  const img = tex.image as (HTMLImageElement | ImageBitmap) | undefined;
  if (!img || !img.width || !img.height) return null;
  const w = Math.min(img.width, 64);
  const h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
  const STEPS = 32;
  const out = new Uint8Array(STEPS);
  for (let i = 0; i < STEPS; i++) {
    // i=0（暗）取图底部行，i=STEPS-1（亮）取顶部行
    const row = Math.min(h - 1, Math.max(0, Math.round((1 - i / (STEPS - 1)) * (h - 1))));
    let sum = 0;
    for (let x = 0; x < w; x++) {
      const o = (row * w + x) * 4;
      sum += 0.2126 * data.data[o] + 0.7152 * data.data[o + 1] + 0.0722 * data.data[o + 2];
    }
    out[i] = Math.round(sum / w);
  }
  const grad = new THREE.DataTexture(out, STEPS, 1, THREE.RedFormat);
  grad.minFilter = THREE.LinearFilter;
  grad.magFilter = THREE.LinearFilter;
  grad.needsUpdate = true;
  return grad;
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
    if (!mat.toonShared && mat.toonTextureIndex >= 0 && mat.toonTextureIndex < data.textures.length) {
      const toonTex = await resolveTexture(data.textures[mat.toonTextureIndex]);
      if (toonTex) {
        const grad = toonTextureToGradient(toonTex);
        if (grad) m.userData.pmxToonGradient = grad;
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
