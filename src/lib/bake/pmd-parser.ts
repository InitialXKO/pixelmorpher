// PMD 解析器（MMD 旧格式，PMX 之前）——按 PMD 1.0 格式规范实现，输出与
// PMXParser 同形的 PMXParsedData，直接复用 pmx-scene.ts 的桥接与烘焙管线。
// 只解析烘焙需要的段：顶点（双骨权重）/索引/材质/骨骼；IK/表情/展示框/
// 刚体段不解析（桥接与部件归类都不消费，骨骼段之后即可停）。
// 文本为 Shift_JIS（TextDecoder('shift-jis')）；PMD 骨名为日文标准名，
// 部件归类走 assignBoneToPart 的日文映射。

import type { PMXParsedData, PMXParsedMaterial, PMXParsedBone } from './pmx-parser';

const SJIS = new TextDecoder('shift-jis');

function readFixedText(view: DataView, offset: number, length: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  let end = bytes.indexOf(0);
  if (end < 0) end = length;
  return SJIS.decode(bytes.subarray(0, end)).trim();
}

export function isPMDBuffer(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 7) return false;
  const b = new Uint8Array(buf, 0, 3);
  return b[0] === 0x50 && b[1] === 0x6d && b[2] === 0x64; // 'Pmd'
}

export function parsePMD(buffer: ArrayBuffer): PMXParsedData {
  const view = new DataView(buffer);
  if (!isPMDBuffer(buffer)) throw new Error('不是 PMD 文件（魔数应为 Pmd）');
  let off = 3;
  view.getFloat32(off, true); // 版本号（不消费）
  off += 4;
  readFixedText(view, off, 20); // 模型名（不消费）
  off += 20 + 256; // 名称 20B + 注释 256B

  // ---- 顶点（38B/个）：pos9? 实为 pos(12) normal(12) uv(8) bone0(2) bone1(2) weight(1) edge(1)
  const vertexCount = view.getUint32(off, true);
  off += 4;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Uint8Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    const base = off + i * 38;
    for (let k = 0; k < 3; k++) {
      positions[i * 3 + k] = view.getFloat32(base + k * 4, true);
      normals[i * 3 + k] = view.getFloat32(base + 12 + k * 4, true);
    }
    uvs[i * 2] = view.getFloat32(base + 24, true);
    uvs[i * 2 + 1] = view.getFloat32(base + 28, true);
    const b0 = view.getUint16(base + 32, true);
    const b1 = view.getUint16(base + 34, true);
    const w0 = view.getUint8(base + 36); // bone0 的权重 0..100
    skinIndices[i * 4] = b0;
    skinIndices[i * 4 + 1] = b1;
    skinWeights[i * 4] = Math.round((w0 / 100) * 255);
    skinWeights[i * 4 + 1] = 255 - skinWeights[i * 4];
  }
  off += vertexCount * 38;

  // ---- 索引（uint16）
  const indexCount = view.getUint32(off, true);
  off += 4;
  const indices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i++) {
    indices[i] = view.getUint16(off + i * 2, true);
  }
  off += indexCount * 2;

  // ---- 材质（70B/个）
  const materialCount = view.getUint32(off, true);
  off += 4;
  const textures: string[] = [];
  const texIndex = (path: string): number => {
    let idx = textures.indexOf(path);
    if (idx < 0) {
      idx = textures.length;
      textures.push(path);
    }
    return idx;
  };
  const materials: PMXParsedMaterial[] = [];
  for (let i = 0; i < materialCount; i++) {
    const base = off + i * 70;
    const diffuse: [number, number, number, number] = [
      view.getFloat32(base, true),
      view.getFloat32(base + 4, true),
      view.getFloat32(base + 8, true),
      view.getFloat32(base + 12, true),
    ];
    const shininess = view.getFloat32(base + 16, true);
    const specular: [number, number, number] = [
      view.getFloat32(base + 20, true),
      view.getFloat32(base + 24, true),
      view.getFloat32(base + 28, true),
    ];
    const ambient: [number, number, number] = [
      view.getFloat32(base + 32, true),
      view.getFloat32(base + 36, true),
      view.getFloat32(base + 40, true),
    ];
    const toonIndex = view.getUint8(base + 44); // 内置 toon 编号（0..9，0xFF=无）
    const edgeFlag = view.getUint8(base + 45);
    const faceVertCount = view.getUint32(base + 46, true); // 索引数（同 PMX vertexCount 语义）
    const texField = readFixedText(view, base + 50, 20);
    // 贴图字段可为 "base.png"、"base.png*sp.sph"、"*sp.sph"（* 分隔球面贴图）
    let diffuseTextureIndex = -1;
    let sphereTextureIndex = -1;
    let sphereMode = 0;
    for (const part of texField.split('*')) {
      const p = part.trim();
      if (!p) continue;
      if (/\.sph$/i.test(p)) {
        sphereTextureIndex = texIndex(p);
        sphereMode = 1; // .sph = 乘算
      } else if (/\.spa$/i.test(p)) {
        sphereTextureIndex = texIndex(p);
        sphereMode = 2; // .spa = 加算
      } else if (diffuseTextureIndex < 0) {
        diffuseTextureIndex = texIndex(p);
      }
    }
    materials.push({
      name: `mat_${i}`,
      diffuse,
      specular,
      shininess,
      ambient,
      diffuseTextureIndex,
      sphereTextureIndex,
      sphereMode,
      toonTextureIndex: toonIndex,
      toonShared: true, // PMD toon 恒为内置编号，无外置贴图
      edgeFlag,
      edgeColor: [0, 0, 0, 1],
      edgeSize: 1,
      vertexCount: faceVertCount,
    });
  }
  off += materialCount * 70;

  // ---- 骨骼（39B/个）：名称 20B + parent(2) + tail(2) + type(1) + ikParent(2) + headPos(12)
  const boneCount = view.getUint16(off, true);
  off += 2;
  const rawBones: { name: string; parent: number; pos: [number, number, number] }[] = [];
  for (let i = 0; i < boneCount; i++) {
    const base = off + i * 39;
    const name = readFixedText(view, base, 20);
    const parentRaw = view.getUint16(base + 20, true);
    const pos: [number, number, number] = [
      view.getFloat32(base + 27, true),
      view.getFloat32(base + 31, true),
      view.getFloat32(base + 35, true),
    ];
    rawBones.push({ name, parent: parentRaw === 0xffff ? -1 : parentRaw, pos });
  }
  const bones: PMXParsedBone[] = rawBones.map((b, i) => {
    const parentPos =
      b.parent >= 0 && b.parent < rawBones.length ? rawBones[b.parent].pos : ([0, 0, 0] as const);
    return {
      name: b.name,
      parentIndex: b.parent,
      bindTranslation: [
        b.pos[0] - parentPos[0],
        b.pos[1] - parentPos[1],
        b.pos[2] - parentPos[2],
      ],
      children: rawBones.flatMap((c, ci) => (c.parent === i ? [ci] : [])),
    };
  });

  // inverseBindMatrices 桥接不消费（THREE.Skeleton 自行计算），填单位阵占位
  const inverseBindMatrices = new Float32Array(boneCount * 16);
  for (let i = 0; i < boneCount; i++) {
    inverseBindMatrices[i * 16 + 0] = 1;
    inverseBindMatrices[i * 16 + 5] = 1;
    inverseBindMatrices[i * 16 + 10] = 1;
    inverseBindMatrices[i * 16 + 15] = 1;
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    skinIndices,
    skinWeights,
    textures,
    materials,
    bones,
    morphs: [],
    inverseBindMatrices,
    rigidbodies: [],
    joints: [],
  };
}
