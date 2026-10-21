// 模型加载收口：ArrayBuffer 按魔数分流——PMX（'PMX ' 开头）走 PMXParser +
// buildPMXScene，其余（含 URL 字符串）走 GLTFLoader。各烘焙器统一从这里加载，
// 产出同形的 THREE 场景。pmxTextures 为 zip 导入的贴图文件表（路径→Blob）。

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PMXParser } from './pmx-parser';
import { buildPMXScene, createBlobTextureResolver } from './pmx-scene';

export function isPMXBuffer(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  const b = new Uint8Array(buf, 0, 4);
  return b[0] === 0x50 && b[1] === 0x4d && b[2] === 0x58 && b[3] === 0x20; // 'PMX '
}

export async function loadModelScene(
  input: string | ArrayBuffer,
  pmxTextures?: Map<string, Blob>,
): Promise<THREE.Object3D> {
  if (typeof input !== 'string' && isPMXBuffer(input)) {
    const data = PMXParser.parse(input);
    const resolver = pmxTextures
      ? createBlobTextureResolver(pmxTextures)
      : async () => null;
    return buildPMXScene(data, resolver);
  }
  const loader = new GLTFLoader();
  const gltf =
    typeof input === 'string' ? await loader.loadAsync(input) : await loader.parseAsync(input, '');
  return gltf.scene;
}
