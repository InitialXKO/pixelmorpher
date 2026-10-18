// 验证骨骼拓扑分析：解析 GLB（JSON + 二进制权重），跑 analyzeTopology。
// 用法：node scripts/verify-topology.mts [glb路径...]
// 默认验证 /tmp/xbot.glb 和 ~/workspace/user/files/Z23_0_hd02.glb
import { readFileSync } from 'node:fs';
import { Vector3, Quaternion, Matrix4 } from 'three';
import { analyzeTopology, type TopoBone } from '../src/lib/bake/bone-topology.ts';

const CT = { 5120: 'i8', 5121: 'u8', 5122: 'i16', 5123: 'u16', 5126: 'f32' } as const;
const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as const;

function readAccessor(gltf: any, bin: Buffer, accIdx: number): { data: ArrayLike<number>; count: number; ncomp: number } {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const byteOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const ncomp = (COMP as any)[acc.type];
  const count = acc.count;
  const ctype = (CT as any)[acc.componentType];
  const total = count * ncomp;
  let data: ArrayLike<number>;
  if (ctype === 'f32') data = new Float32Array(bin.buffer, bin.byteOffset + byteOffset, total);
  else if (ctype === 'u8') data = new Uint8Array(bin.buffer, bin.byteOffset + byteOffset, total);
  else if (ctype === 'u16') data = new Uint16Array(bin.buffer, bin.byteOffset + byteOffset, total);
  else if (ctype === 'i16') data = new Int16Array(bin.buffer, bin.byteOffset + byteOffset, total);
  else data = new Int8Array(bin.buffer, bin.byteOffset + byteOffset, total);
  return { data, count, ncomp };
}

function analyze(path: string, label: string) {
  console.log(`\n===== ${label}: ${path} =====`);
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  // BIN chunk
  const binOff = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binOff);
  const bin = buf.subarray(binOff + 8, binOff + 8 + binLen);

  const nodes: any[] = gltf.nodes ?? [];
  const n = nodes.length;

  // ---- 世界坐标（TRS 合成） ----
  const worldPos: Vector3[] = new Array(n);
  const nodeWorld = new Array<Matrix4>(n);
  const getWorld = (i: number): Matrix4 => {
    if (nodeWorld[i]) return nodeWorld[i];
    const nd = nodes[i];
    const m = new Matrix4();
    if (nd.matrix) {
      m.fromArray(nd.matrix);
    } else {
      const t = nd.translation ? new Vector3().fromArray(nd.translation) : new Vector3();
      const r = nd.rotation ? new Quaternion().fromArray(nd.rotation) : new Quaternion();
      const s = nd.scale ? new Vector3().fromArray(nd.scale) : new Vector3(1, 1, 1);
      m.compose(t, r, s);
    }
    // 找父节点
    let parent = -1;
    for (let p = 0; p < n; p++) {
      if ((nodes[p].children ?? []).includes(i)) { parent = p; break; }
    }
    if (parent >= 0) m.premultiply(getWorld(parent));
    nodeWorld[i] = m;
    return m;
  };
  for (let i = 0; i < n; i++) {
    worldPos[i] = new Vector3().setFromMatrixPosition(getWorld(i));
  }

  // ---- 权重和 ----
  const weightSum = new Array<number>(n).fill(0);
  const skins: any[] = gltf.skins ?? [];
  const meshes: any[] = gltf.meshes ?? [];
  for (const mesh of meshes) {
    for (const prim of mesh.primitives ?? []) {
      const jAcc = prim.attributes?.JOINTS_0;
      const wAcc = prim.attributes?.WEIGHTS_0;
      if (jAcc === undefined || wAcc === undefined) continue;
      const joints = readAccessor(gltf, bin, jAcc);
      const weights = readAccessor(gltf, bin, wAcc);
      // 找到这个 primitive 用的 skin（简化：用第一个包含这些 joint 的 skin，或 skins[0]）
      const skin = skins[0];
      if (!skin) continue;
      const jointNodes: number[] = skin.joints;
      for (let v = 0; v < joints.count; v++) {
        for (let j = 0; j < 4; j++) {
          const ji = joints.data[v * 4 + j];
          const w = weights.data[v * 4 + j];
          const nodeIdx = jointNodes[ji];
          if (nodeIdx !== undefined && w > 0) weightSum[nodeIdx] += w;
        }
      }
    }
  }

  // ---- TopoBone（只取 skin joints？不：全部 nodes，weightSum=0 的会被过滤） ----
  // 为与真实管线一致，只分析 skin.joints 中的 bones？真实管线 collectBones 取所有 Bone。
  // 这里取所有 nodes 中有 skin 关联或 weight>0 的，简化：全部 nodes。
  const bones: TopoBone[] = nodes.map((nd, i) => {
    let parent: number | null = null;
    for (let p = 0; p < n; p++) {
      if ((nodes[p].children ?? []).includes(i)) { parent = p; break; }
    }
    return {
      index: i,
      name: nd.name ?? `node_${i}`,
      parentIndex: parent,
      worldPos: { x: worldPos[i].x, y: worldPos[i].y, z: worldPos[i].z },
      weightSum: weightSum[i],
    };
  });

  const t0 = Date.now();
  const result = analyzeTopology(bones);
  console.log(`耗时 ${Date.now() - t0}ms`);
  for (const note of result.notes) console.log(`  ${note}`);
  console.log(`  cross=${result.cross !== null ? bones[result.cross].name : 'null'}`);
  console.log(`  hipFork=${result.hipFork !== null ? bones[result.hipFork].name : 'null'}`);
  console.log(`  handL=${result.handL !== null ? bones[result.handL].name : 'null'} (${result.fingersL.length}指)`);
  console.log(`  handR=${result.handR !== null ? bones[result.handR].name : 'null'} (${result.fingersR.length}指)`);
  console.log(`  headRoot=${result.headRoot !== null ? bones[result.headRoot].name : 'null'}`);

  // ---- 断言 ----
  const partCount = (p: string) => result.boneToPart.filter((x) => x === p).length;
  console.log(`  部件: 头${partCount('head')} 躯干${partCount('torso')} 左臂${partCount('armL')} 右臂${partCount('armR')} 左腿${partCount('legL')} 右腿${partCount('legR')} 尾${partCount('tail')} 道具${partCount('props')}`);
  return result;
}

const args = process.argv.slice(2);
const files = args.length > 0 ? args.map((a, i) => ({ path: a, label: `模型${i + 1}` })) : [
  { path: '/tmp/xbot.glb', label: 'Xbot' },
  { path: '/home/hatch/workspace/user/files/Z23_0_hd02.glb', label: 'Z23' },
];
for (const f of files) {
  try {
    analyze(f.path, f.label);
  } catch (e) {
    console.error(`  失败: ${(e as Error).message}`);
  }
}
