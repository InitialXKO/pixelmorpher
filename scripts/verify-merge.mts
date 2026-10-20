// 验证 computeTopologyMerge：默认 Node 数应为 14（标准人形）
// 用法：npx tsx scripts/verify-merge.mts [glb路径...]
import { readFileSync } from 'node:fs';
import { Vector3, Quaternion, Matrix4 } from 'three';
import { analyzeTopology, type TopoBone } from '../src/lib/bake/bone-topology.ts';
import { computeTopologyMerge } from '../src/lib/bake/threejs-baker-twopass.ts';

const CT = { 5120: 'i8', 5121: 'u8', 5122: 'i16', 5123: 'u16', 5126: 'f32' } as const;
const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as const;

function readAccessor(gltf: any, bin: Buffer, accIdx: number) {
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
  console.log(`\n===== ${label} =====`);
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binOff = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binOff);
  const bin = buf.subarray(binOff + 8, binOff + 8 + binLen);

  const nodes: any[] = gltf.nodes ?? [];
  const n = nodes.length;
  const joints: number[] = gltf.skins?.[0]?.joints ?? [];
  const jointSet = new Set(joints);

  // 世界坐标
  const worldPos: Vector3[] = new Array(n);
  const nodeWorld = new Array<Matrix4>(n);
  const getWorld = (i: number): Matrix4 => {
    if (nodeWorld[i]) return nodeWorld[i];
    const nd = nodes[i];
    const m = new Matrix4();
    if (nd.matrix) m.fromArray(nd.matrix);
    else {
      const t = nd.translation ? new Vector3().fromArray(nd.translation) : new Vector3();
      const r = nd.rotation ? new Quaternion().fromArray(nd.rotation) : new Quaternion();
      const s = nd.scale ? new Vector3().fromArray(nd.scale) : new Vector3(1, 1, 1);
      m.compose(t, r, s);
    }
    let parent = -1;
    for (let p = 0; p < n; p++) {
      if ((nodes[p].children ?? []).includes(i)) { parent = p; break; }
    }
    nodeWorld[i] = parent >= 0 ? getWorld(parent).clone().multiply(m) : m;
    return nodeWorld[i];
  };
  for (let i = 0; i < n; i++) {
    worldPos[i] = new Vector3().setFromMatrixPosition(getWorld(i));
  }

  // 只取 joint bones，按 joints 数组顺序
  const bones = joints.map((ji, idx) => {
    // parent：在 joints 中的索引
    let pIdx: number | null = null;
    for (let p = 0; p < n; p++) {
      if ((nodes[p].children ?? []).includes(ji) && jointSet.has(p)) {
        pIdx = joints.indexOf(p);
        break;
      }
    }
    return { ji, idx, pIdx };
  });

  const topoBones: TopoBone[] = bones.map((b) => ({
    index: b.idx,
    name: nodes[b.ji].name || `bone_${b.idx}`,
    parentIndex: b.pIdx,
    worldPos: { x: worldPos[b.ji].x, y: worldPos[b.ji].y, z: worldPos[b.ji].z },
    weightSum: 1, // 验证脚本不解析权重，用 1 代替（拓扑不依赖权重做结构）
  }));

  const topology = analyzeTopology(topoBones);
  if (topology.cross === null) {
    console.log('  拓扑失败，跳过');
    return;
  }

  const merge = computeTopologyMerge(
    topology,
    topoBones.map((b) => b.name),
    topoBones.map((b) => b.parentIndex),
  );

  const effCount = new Set(merge.effectiveIndex).size;
  console.log(`  bones: ${bones.length} → 有效 Nodes: ${effCount}`);
  console.log(`  有效 bones: ${merge.effectiveBones.map((i) => nodes[joints[i]].name || i).join(', ')}`);

  // 手动拆分测试：找尾巴根（如果有）
  const tailMerged = topology.tail.filter((t) => merge.effectiveIndex[t] !== t);
  if (tailMerged.length > 0) {
    const tailRoot = topology.tail.find((t) => {
      const p = topoBones[t].parentIndex;
      return p === null || !topology.tail.includes(p);
    });
    if (tailRoot !== undefined) {
      const merge2 = computeTopologyMerge(
        topology,
        topoBones.map((b) => b.name),
        topoBones.map((b) => b.parentIndex),
        undefined,
        new Set([tailRoot]),
      );
      const eff2 = new Set(merge2.effectiveIndex).size;
      console.log(`  手动拆分尾巴根 (${nodes[joints[tailRoot]].name}): ${effCount} → ${eff2} Nodes`);
    }
  } else if (topology.tail.length > 0) {
    console.log(`  尾巴已独立，无需拆分`);
  } else {
    console.log(`  无尾巴`);
  }
}

const args = process.argv.slice(2);
const files = args.length > 0 ? args : ['/tmp/xbot.glb', '/home/hatch/workspace/user/files/Z23_0_hd02.glb'];
for (const f of files) {
  try {
    analyze(f, f.split('/').pop()!);
  } catch (e) {
    console.log(`  错误: ${e instanceof Error ? e.message : e}`);
  }
}
