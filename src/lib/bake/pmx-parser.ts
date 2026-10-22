/**
 * PMX 解析器 — 移植自用户提供的 SFV 源码（sfv-viewer/mmd/pmx-parser.ts，
 * 其自述与 reze-engine pmx-loader.ts 二进制解析逻辑一致），仅做 PMX 二进制
 * 解析输出 PMXParsedData，不依赖源项目运行时。本文件只加了 toonShared 标记
 * （区分材质 toon 索引是内置共享 toon 还是贴图表索引），其余解析逻辑未改。
 * THREE 场景构建见 pmx-scene.ts（buildPMXScene）。
 */
import * as THREE from 'three';

// ===== PMX 数据结构 (与 reze-engine 一致) =====

export interface PMXParsedBone {
  name: string;
  parentIndex: number;
  bindTranslation: [number, number, number];
  children: number[];
  appendParentIndex?: number;
  appendRatio?: number;
  appendRotate?: boolean;
  appendMove?: boolean;
  ikTargetIndex?: number;
  ikIteration?: number;
  ikLimitAngle?: number;
  ikLinks?: { boneIndex: number; hasLimit: boolean; minAngle?: [number, number, number]; maxAngle?: [number, number, number] }[];
}

export interface PMXParsedMaterial {
  name: string;
  diffuse: [number, number, number, number];
  specular: [number, number, number];
  shininess: number;
  ambient: [number, number, number];
  diffuseTextureIndex: number;
  sphereTextureIndex: number;
  sphereMode: number;
  toonTextureIndex: number;
  /** true 时 toonTextureIndex 是内置共享 toon 编号（非贴图表索引），无外置贴图 */
  toonShared?: boolean;
  edgeFlag: number;
  edgeColor: [number, number, number, number];
  edgeSize: number;
  vertexCount: number;
}

export interface PMXParsedMorph {
  name: string;
  type: number;
  vertexOffsets: { vertexIndex: number; positionOffset: [number, number, number] }[];
  groupReferences?: { morphIndex: number; ratio: number }[];
}

export interface PMXParsedRigidbody {
  name: string;
  englishName: string;
  boneIndex: number;
  group: number;
  collisionMask: number;
  shape: number;
  size: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  mass: number;
  type: number;
  linearDamping: number;
  angularDamping: number;
  restitution: number;
  friction: number;
}

export interface PMXParsedJoint {
  name: string;
  englishName: string;
  type: number;
  rigidbodyIndexA: number;
  rigidbodyIndexB: number;
  position: [number, number, number];
  rotation: [number, number, number];
  positionMin: [number, number, number];
  positionMax: [number, number, number];
  rotationMin: [number, number, number];
  rotationMax: [number, number, number];
  springPosition: [number, number, number];
  springRotation: [number, number, number];
}

export interface PMXParsedData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  skinIndices: Uint16Array;
  skinWeights: Uint8Array;
  indices: Uint32Array;
  textures: string[];
  materials: PMXParsedMaterial[];
  bones: PMXParsedBone[];
  morphs: PMXParsedMorph[];
  rigidbodies: PMXParsedRigidbody[];
  joints: PMXParsedJoint[];
  inverseBindMatrices: Float32Array;
}

// ===== PMX 解析器 (与 reze-engine pmx-loader.ts 完全一致的二进制读取) =====

export class PMXParser {
  private view: DataView;
  private offset = 0;
  private decoder!: TextDecoder;
  private encoding = 0;
  private additionalVec4Count = 0;
  private vertexIndexSize = 0;
  private textureIndexSize = 0;
  private materialIndexSize = 0;
  private boneIndexSize = 0;
  private morphIndexSize = 0;
  private rigidBodyIndexSize = 0;

  private bones: PMXParsedBone[] = [];
  private materials: PMXParsedMaterial[] = [];
  private morphs: PMXParsedMorph[] = [];
  private rigidbodies: PMXParsedRigidbody[] = [];
  private joints: PMXParsedJoint[] = [];
  private textures: string[] = [];

  private constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  static parse(buffer: ArrayBuffer): PMXParsedData {
    return new PMXParser(buffer).doParse();
  }

  private doParse(): PMXParsedData {
    this.parseHeader();
    const { positions, normals, uvs, skinIndices, skinWeights } = this.parseVertices();
    const indices = this.parseIndices();
    this.parseTextures();
    this.parseMaterials();
    this.parseBones();
    this.parseMorphs();
    this.skipDisplayFrames();
    this.parseRigidbodies();
    this.parseJoints();
    const inverseBindMatrices = this.computeInverseBind();

    return {
      positions, normals, uvs, skinIndices, skinWeights, indices,
      textures: this.textures, materials: this.materials, bones: this.bones,
      morphs: this.morphs, rigidbodies: this.rigidbodies, joints: this.joints,
      inverseBindMatrices,
    };
  }

  // ===== 以下方法与 reze-engine pmx-loader.ts 完全一致 =====

  private parseHeader(): void {
    if (this.getString(3) !== 'PMX') throw new Error('Not a PMX file');
    this.getUint8();
    const version = this.getFloat32();
    if (version < 2.0 || version > 2.2) console.warn(`PMX version ${version} may not be fully supported`);
    const globalsCount = this.getUint8();
    if (globalsCount < 8) throw new Error(`Invalid globalsCount: ${globalsCount}`);
    this.encoding = this.getUint8();
    this.additionalVec4Count = this.getUint8();
    this.vertexIndexSize = this.getUint8();
    this.textureIndexSize = this.getUint8();
    this.materialIndexSize = this.getUint8();
    this.boneIndexSize = this.getUint8();
    this.morphIndexSize = this.getUint8();
    this.rigidBodyIndexSize = this.getUint8();
    for (let i = 8; i < globalsCount; i++) this.getUint8();
    this.decoder = new TextDecoder(this.encoding === 0 ? 'utf-16le' : 'utf-8');
    this.getText(); this.getText(); this.getText(); this.getText();
  }

  private parseVertices() {
    const count = this.getInt32();
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const skinIndices = new Uint16Array(count * 4);
    const skinWeights = new Uint8Array(count * 4);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = this.getFloat32();
      positions[i * 3 + 1] = this.getFloat32();
      positions[i * 3 + 2] = this.getFloat32();
      normals[i * 3] = this.getFloat32();
      normals[i * 3 + 1] = this.getFloat32();
      normals[i * 3 + 2] = this.getFloat32();
      uvs[i * 2] = this.getFloat32();
      uvs[i * 2 + 1] = this.getFloat32();

      this.offset += this.additionalVec4Count * 16;
      const type = this.getUint8();
      const base = i * 4;
      skinIndices[base] = 0; skinIndices[base + 1] = 0; skinIndices[base + 2] = 0; skinIndices[base + 3] = 0;
      skinWeights[base] = 255; skinWeights[base + 1] = 0; skinWeights[base + 2] = 0; skinWeights[base + 3] = 0;

      if (type === 0) {
        skinIndices[base] = this.getNonVertexIndex(this.boneIndexSize);
      } else if (type === 1 || type === 3) {
        skinIndices[base] = this.getNonVertexIndex(this.boneIndexSize);
        skinIndices[base + 1] = this.getNonVertexIndex(this.boneIndexSize);
        const w0f = this.getFloat32();
        const w0 = Math.max(0, Math.min(255, Math.round(w0f * 255)));
        skinWeights[base] = w0;
        skinWeights[base + 1] = Math.max(0, Math.min(255, 255 - w0));
        if (type === 3) this.offset += 36;
      } else if (type === 2 || type === 4) {
        let sum = 0;
        for (let k = 0; k < 4; k++) skinIndices[base + k] = this.getNonVertexIndex(this.boneIndexSize);
        const wf = [this.getFloat32(), this.getFloat32(), this.getFloat32(), this.getFloat32()];
        const w8 = wf.map(x => Math.max(0, Math.min(255, Math.round(x * 255))));
        sum = w8[0] + w8[1] + w8[2] + w8[3];
        if (sum === 0) { skinWeights[base] = 255; }
        else {
          const scale = 255 / sum;
          let accum = 0;
          for (let k = 0; k < 3; k++) {
            const v = Math.max(0, Math.min(255, Math.round(w8[k] * scale)));
            skinWeights[base + k] = v;
            accum += v;
          }
          skinWeights[base + 3] = Math.max(0, Math.min(255, 255 - accum));
        }
      } else {
        throw new Error(`Invalid bone weight type: ${type}`);
      }
      this.offset += 4; // edge scale
    }
    return { positions, normals, uvs, skinIndices, skinWeights };
  }

  private parseIndices(): Uint32Array {
    const count = this.getInt32();
    const indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = this.getIndex(this.vertexIndexSize);
    return indices;
  }

  private parseTextures(): void {
    const count = this.getInt32();
    this.textures = [];
    for (let i = 0; i < count; i++) this.textures.push(this.getText());
  }

  private parseMaterials(): void {
    const count = this.getInt32();
    this.materials = [];
    for (let i = 0; i < count; i++) {
      const name = this.getText();
      this.getText();
      const diffuse = [this.getFloat32(), this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number, number];
      const specular = [this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number];
      const shininess = this.getFloat32();
      const ambient = [this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number];
      const flag = this.getUint8();
      const edgeColor = [this.getFloat32(), this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number, number];
      const edgeSize = this.getFloat32();
      const textureIndex = this.getNonVertexIndex(this.textureIndexSize);
      const sphereTextureIndex = this.getNonVertexIndex(this.textureIndexSize);
      const sphereMode = this.getUint8();
      const isSharedToon = this.getUint8() === 1;
      const toonTextureIndex = isSharedToon ? this.getUint8() : this.getNonVertexIndex(this.textureIndexSize);
      this.getText();
      const vertexCount = this.getInt32();
      this.materials.push({ name, diffuse, specular, shininess, ambient, diffuseTextureIndex: textureIndex, sphereTextureIndex, sphereMode, toonTextureIndex, toonShared: isSharedToon, edgeFlag: flag, edgeColor, edgeSize, vertexCount });
    }
  }

  private parseBones(): void {
    const count = this.getInt32();
    const abs: { name: string; parent: number; x: number; y: number; z: number; appendParent?: number; appendRatio?: number; appendRotate?: boolean; appendMove?: boolean; ikTargetIndex?: number; ikIteration?: number; ikLimitAngle?: number; ikLinks?: any[] }[] = [];

    const FLAG_TAIL_IS_BONE = 0x0001;
    const FLAG_IK = 0x0020;
    const FLAG_APPEND_ROTATE = 0x0100;
    const FLAG_APPEND_MOVE = 0x0200;
    const FLAG_AXIS_LIMIT = 0x0400;
    const FLAG_LOCAL_AXIS = 0x0800;
    const FLAG_EXTERNAL_PARENT = 0x2000;

    for (let i = 0; i < count; i++) {
      const name = this.getText();
      this.getText();
      const x = this.getFloat32(), y = this.getFloat32(), z = this.getFloat32();
      const parentIndex = this.getNonVertexIndex(this.boneIndexSize);
      this.getInt32();
      const flags = this.getUint16();

      if ((flags & FLAG_TAIL_IS_BONE) !== 0) this.getNonVertexIndex(this.boneIndexSize);
      else { this.getFloat32(); this.getFloat32(); this.getFloat32(); }

      let appendParent: number | undefined, appendRatio: number | undefined;
      let appendRotate = false, appendMove = false;
      if ((flags & (FLAG_APPEND_ROTATE | FLAG_APPEND_MOVE)) !== 0) {
        appendParent = this.getNonVertexIndex(this.boneIndexSize);
        appendRatio = this.getFloat32();
        appendRotate = (flags & FLAG_APPEND_ROTATE) !== 0;
        appendMove = (flags & FLAG_APPEND_MOVE) !== 0;
      }
      if ((flags & FLAG_AXIS_LIMIT) !== 0) { this.getFloat32(); this.getFloat32(); this.getFloat32(); }
      if ((flags & FLAG_LOCAL_AXIS) !== 0) { for (let j = 0; j < 6; j++) this.getFloat32(); }
      if ((flags & FLAG_EXTERNAL_PARENT) !== 0) this.getInt32();

      let ikTargetIndex: number | undefined, ikIteration: number | undefined, ikLimitAngle: number | undefined, ikLinks: any[] | undefined;
      if ((flags & FLAG_IK) !== 0) {
        ikTargetIndex = this.getNonVertexIndex(this.boneIndexSize);
        ikIteration = this.getInt32();
        ikLimitAngle = this.getFloat32();
        const linksCount = this.getInt32();
        ikLinks = [];
        for (let li = 0; li < linksCount; li++) {
          const linkBoneIndex = this.getNonVertexIndex(this.boneIndexSize);
          const hasLimit = this.getUint8() === 1;
          let minAngle: [number, number, number] | undefined, maxAngle: [number, number, number] | undefined;
          if (hasLimit) {
            minAngle = [this.getFloat32(), this.getFloat32(), this.getFloat32()];
            maxAngle = [this.getFloat32(), this.getFloat32(), this.getFloat32()];
          }
          ikLinks!.push({ boneIndex: linkBoneIndex, hasLimit, minAngle, maxAngle });
        }
      }
      abs.push({ name, parent: parentIndex, x, y, z, appendParent, appendRatio, appendRotate, appendMove, ikTargetIndex, ikIteration, ikLimitAngle, ikLinks });
    }

    this.bones = abs.map((a, i) => ({
      name: a.name,
      parentIndex: a.parent,
      bindTranslation: a.parent >= 0 && a.parent < count ? [a.x - abs[a.parent].x, a.y - abs[a.parent].y, a.z - abs[a.parent].z] : [a.x, a.y, a.z],
      children: [],
      appendParentIndex: a.appendParent,
      appendRatio: a.appendRatio,
      appendRotate: a.appendRotate,
      appendMove: a.appendMove,
      ikTargetIndex: a.ikTargetIndex,
      ikIteration: a.ikIteration,
      ikLimitAngle: a.ikLimitAngle,
      ikLinks: a.ikLinks,
    }));

    for (let i = 0; i < this.bones.length; i++) {
      const p = this.bones[i].parentIndex;
      if (p >= 0 && p < this.bones.length) this.bones[p].children.push(i);
    }
  }

  private parseMorphs(): void {
    if (this.offset + 4 > this.view.buffer.byteLength) { this.morphs = []; return; }
    const count = this.getInt32();
    if (count < 0 || count > 100000) { this.morphs = []; return; }
    this.morphs = [];
    for (let i = 0; i < count; i++) {
      if (this.offset >= this.view.buffer.byteLength) break;
      try {
        const name = this.getText();
        this.getText();
        this.getUint8();
        const morphType = this.getUint8();
        const offsetCount = this.getInt32();
        const morph: PMXParsedMorph = { name, type: morphType, vertexOffsets: [], groupReferences: [] };
        if (morphType === 1) {
          for (let j = 0; j < offsetCount; j++) {
            if (this.offset >= this.view.buffer.byteLength) break;
            const vi = this.getIndex(this.vertexIndexSize);
            morph.vertexOffsets.push({ vertexIndex: vi, positionOffset: [this.getFloat32(), this.getFloat32(), this.getFloat32()] });
          }
        } else if (morphType === 0) {
          for (let j = 0; j < offsetCount; j++) {
            morph.groupReferences!.push({ morphIndex: this.getNonVertexIndex(this.morphIndexSize), ratio: this.getFloat32() });
          }
        } else {
          for (let j = 0; j < offsetCount; j++) {
            if (morphType === 2) { this.getNonVertexIndex(this.boneIndexSize); for (let k = 0; k < 7; k++) this.getFloat32(); }
            else if (morphType === 3 || (morphType >= 4 && morphType <= 7)) { this.getIndex(this.vertexIndexSize); this.getFloat32(); this.getFloat32(); }
            else if (morphType === 8) { this.getNonVertexIndex(this.materialIndexSize); this.getUint8(); for (let k = 0; k < 26; k++) this.getFloat32(); }
            else break;
          }
        }
        this.morphs.push(morph);
      } catch (e) { console.warn(`Error reading morph ${i}:`, e); }
    }
  }

  private skipDisplayFrames(): void {
    if (this.offset + 4 > this.view.buffer.byteLength) return;
    const count = this.getInt32();
    if (count < 0 || count > 100000) { this.offset -= 4; return; }
    for (let i = 0; i < count; i++) {
      if (this.offset >= this.view.buffer.byteLength) return;
      this.getText(); this.getText(); this.getUint8();
      const elementCount = this.getInt32();
      for (let j = 0; j < elementCount; j++) {
        if (this.offset >= this.view.buffer.byteLength) return;
        const elementType = this.getUint8();
        if (elementType === 0) this.getNonVertexIndex(this.boneIndexSize);
        else this.getNonVertexIndex(this.morphIndexSize);
      }
    }
  }

  private parseRigidbodies(): void {
    if (this.offset + 4 > this.view.buffer.byteLength) { this.rigidbodies = []; return; }
    const count = this.getInt32();
    if (count < 0 || count > 10000) { this.rigidbodies = []; return; }
    this.rigidbodies = [];
    for (let i = 0; i < count; i++) {
      if (this.offset >= this.view.buffer.byteLength) break;
      try {
        const rbName = this.getText();
        const rbEnglishName = this.getText();
        const boneIndex = this.getNonVertexIndex(this.boneIndexSize);
        const group = this.getUint8();
        const collisionMask = this.getUint16();
        const shape = this.getUint8();
        const size = [this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number];
        const position = [this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number];
        const rotation = [this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number];
        const mass = this.getFloat32();
        const linearDamping = this.getFloat32();
        const angularDamping = this.getFloat32();
        const restitution = this.getFloat32();
        const friction = this.getFloat32();
        const type = this.getUint8();
        this.rigidbodies.push({ name: rbName, englishName: rbEnglishName, boneIndex, group, collisionMask, shape, size, position, rotation, mass, type, linearDamping, angularDamping, restitution, friction });
      } catch (e) { break; }
    }
  }

  private parseJoints(): void {
    if (this.offset + 4 > this.view.buffer.byteLength) { this.joints = []; return; }
    const count = this.getInt32();
    if (count < 0 || count > 10000) { this.joints = []; return; }
    this.joints = [];
    for (let i = 0; i < count; i++) {
      if (this.offset >= this.view.buffer.byteLength) break;
      try {
        const jName = this.getText();
        const jEnglishName = this.getText();
        const jointType = this.getUint8();
        const ra = this.getNonVertexIndex(this.rigidBodyIndexSize);
        const rb = this.getNonVertexIndex(this.rigidBodyIndexSize);
        const position = [this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number];
        const rotation = [this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number];
        const positionMin = [this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number];
        const positionMax = [this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number];
        const rotationMin = [this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number];
        const rotationMax = [this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number];
        const springPosition = [this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number];
        const springRotation = [this.getFloat32(), this.getFloat32(), this.getFloat32()] as [number, number, number];
        this.joints.push({ name: jName, englishName: jEnglishName, type: jointType, rigidbodyIndexA: ra, rigidbodyIndexB: rb, position, rotation, positionMin, positionMax, rotationMin, rotationMax, springPosition, springRotation });
      } catch (e) { break; }
    }
  }

  private computeInverseBind(): Float32Array {
    const n = this.bones.length;
    if (n === 0) return new Float32Array(0);
    const world = new Array<THREE.Matrix4 | null>(n).fill(null);
    const inv = new Float32Array(n * 16);

    const computeWorld = (i: number): THREE.Matrix4 => {
      if (world[i]) return world[i]!;
      const bone = this.bones[i];
      const local = new THREE.Matrix4().makeTranslation(bone.bindTranslation[0], bone.bindTranslation[1], bone.bindTranslation[2]);
      let w: THREE.Matrix4;
      if (bone.parentIndex >= 0 && bone.parentIndex < n) {
        w = computeWorld(bone.parentIndex).multiply(local);
      } else {
        w = local;
      }
      world[i] = w;
      return w;
    };

    for (let i = 0; i < n; i++) {
      const w = computeWorld(i);
      const invM = new THREE.Matrix4().makeTranslation(-w.elements[12], -w.elements[13], -w.elements[14]);
      inv.set(invM.elements, i * 16);
    }
    return inv;
  }

  // ===== 二进制读取工具 (与 reze-engine 一致) =====

  private getUint8(): number { return this.view.getUint8(this.offset++); }
  private getUint16(): number { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  private getInt32(): number { const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
  private getFloat32(): number { const v = this.view.getFloat32(this.offset, true); this.offset += 4; return v; }

  private getString(length: number): string {
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    let end = length;
    for (let i = 0; i < length; i++) { if (bytes[i] === 0) { end = i; break; } }
    let s = '';
    for (let i = 0; i < end; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  private getText(): string {
    const length = this.getInt32();
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return this.decoder.decode(bytes);
  }

  private getIndex(size: number): number {
    switch (size) {
      case 1: return this.getUint8();
      case 2: { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v === 0xFFFF ? -1 : v; }
      case 4: { const v = this.view.getInt32(this.offset, true); this.offset += 4; return v === -1 ? -1 : v; }
      default: return -1;
    }
  }

  private getNonVertexIndex(size: number): number {
    switch (size) {
      case 1: { const v = this.getUint8(); return v === 0xFF ? -1 : v; }
      case 2: { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v === 0xFFFF ? -1 : v; }
      case 4: { const v = this.view.getInt32(this.offset, true); this.offset += 4; return v === -1 ? -1 : v; }
      default: return -1;
    }
  }
}
