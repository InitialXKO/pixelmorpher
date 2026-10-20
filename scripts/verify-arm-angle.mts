// 计算手臂原始方向与垂下目标的夹角（验证 droopArmPart 逻辑）
// 用法：npx tsx /tmp/verify-arm-angle.mts [glb路径...]
import { readFileSync } from 'node:fs';
import { Vector3, Quaternion, Matrix4 } from 'three';
import { analyzeTopology, type TopoBone } from '../src/lib/bake/bone-topology.ts';

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
  console.log(`\n===== ${label}: ${path} =====`);
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binOff = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binOff);
  const bin = buf.subarray(binOff + 8, binOff + 8 + binLen);

  const nodes: any[] = gltf.nodes ?? [];
  const n = nodes.length;

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

  const result = analyzeTopology(bones);
  if (result.cross === null) {
    console.log('  拓扑失败，跳过');
    return;
  }

  // 找臂根（部件内 parent 不在本部件）
  const findArmRoot = (part: 'armL' | 'armR'): number | null => {
    for (let i = 0; i < n; i++) {
      if (result.boneToPart[i] !== part) continue;
      const p = bones[i].parentIndex;
      if (p === null || result.boneToPart[p] !== part) return i;
    }
    return null;
  };

  for (const ap of ['armL', 'armR'] as const) {
    const shoulderIdx = findArmRoot(ap);
    const handIdx = ap === 'armL' ? result.handL : result.handR;
    if (shoulderIdx === null || handIdx === null) {
      console.log(`  ${ap}: 找不到肩/手`);
      continue;
    }
    const s = worldPos[shoulderIdx];
    const h = worldPos[handIdx];
    const cur = new Vector3().subVectors(h, s).normalize();

    // 目标：(0,-1,0) + 外张 5°
    const tilt = 5 * Math.PI / 180;
    const target = new Vector3(0, -1, 0).applyAxisAngle(
      new Vector3(0, 0, 1), ap === 'armL' ? tilt : -tilt,
    );
    const angleDeg = cur.angleTo(target) * 180 / Math.PI;
    const skip = angleDeg < 10 ? '→ 跳过（已垂下）' : '→ 需旋转';
    console.log(`  ${ap}: 肩=${bones[shoulderIdx].name} 手=${bones[handIdx].name}`);
    console.log(`       臂方向=(${cur.x.toFixed(2)},${cur.y.toFixed(2)},${cur.z.toFixed(2)}) 夹角=${angleDeg.toFixed(1)}° ${skip}`);
  }
}

const args = process.argv.slice(2);
const files = args.length > 0 ? args : ['/tmp/xbot.glb', '/home/hatch/workspace/user/files/Z23_0_hd02.glb'];
for (const f of files) {
  try {
    analyze(f, f.split('/').pop() ?? f);
  } catch (e) {
    console.log(`  失败: ${e}`);
  }
}
