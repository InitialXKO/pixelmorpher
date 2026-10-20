// 验证 T-pose 摆回（甲案）：臂链根角度 + 链内偏移拉直
import { mapBonesToNodes, type ProcessedBone, type ProcessedBoneDirection } from '../src/lib/bake/skeleton-mapper';
import { subToPx } from '../src/lib/unified-types';

function dir(): ProcessedBoneDirection {
  return {
    direction: 6,
    grid: [['#ff0000']],
    width: 1,
    height: 1,
    cropX: 0,
    cropY: 0,
    jointX: 64,
    jointY: 64,
    plugX: 0,
    plugY: 0,
    cameraHalf: 1,
    globalCameraHalf: 1.0,
  } as ProcessedBoneDirection;
}

function pb(
  boneIndex: number,
  name: string,
  parentIndex: number | null,
  part: string,
  joint3D: { x: number; y: number; z: number },
): ProcessedBone {
  return {
    boneIndex,
    boneName: name,
    parentIndex,
    directions: [dir()],
    joint3D,
    bakeWidth: 128,
    part: part as ProcessedBone['part'],
  };
}

const m = new Map<number, ProcessedBone>();
// 躯干链
m.set(0, pb(0, 'hips', null, 'torso', { x: 0, y: 0.9, z: 0 }));
m.set(1, pb(1, 'chest', 0, 'torso', { x: 0, y: 1.2, z: 0 }));
// 右臂链（+X 侧），垂下姿态：向下 + 略带 x/z 偏移
m.set(2, pb(2, 'shoulderR', 1, 'armR', { x: 0.2, y: 1.35, z: 0 }));
m.set(3, pb(3, 'elbowR', 2, 'armR', { x: 0.25, y: 1.0, z: 0.05 }));
m.set(4, pb(4, 'wristR', 3, 'armR', { x: 0.28, y: 0.7, z: 0.08 }));
// 左臂链（-X 侧）
m.set(5, pb(5, 'shoulderL', 1, 'armL', { x: -0.2, y: 1.35, z: 0 }));
m.set(6, pb(6, 'elbowL', 5, 'armL', { x: -0.25, y: 1.0, z: 0.05 }));

const mapped = mapBonesToNodes(m, 'test', 'T');
const nodes = mapped.character.nodes;

let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${label}: ${detail}`);
  if (!ok) fail++;
}

// 1. 右肩（+X 侧）链根角度 = -90
const shR = nodes['node_test_2'];
check('右肩角度', shR.transform.angle === -90, `angle=${shR.transform.angle}`);
// 2. 左肩（-X 侧）链根角度 = +90
const shL = nodes['node_test_5'];
check('左肩角度', shL.transform.angle === 90, `angle=${shL.transform.angle}`);
// 3. 肘节点角度保持 0（靠继承父角）
check('肘角度', nodes['node_test_3'].transform.angle === 0, `angle=${nodes['node_test_3'].transform.angle}`);

// 4. 肩→肘 socket 拉直：x=0,z=0，y=骨长（全局 px）
// diff = (0.05,-0.35,0.05)，len≈0.3571，scale=(128/2)/1=64 → 22.85 px
const chest = nodes['node_test_1'];
const shoulderNode = nodes['node_test_2'];
const sockElbow = shoulderNode.sockets.find((s) => s.name === 'elbowR');
const o3 = sockElbow?.offset3D;
const expectLenPx = Math.hypot(0.05, -0.35, 0.05) * 64;
check(
  '肘偏移拉直',
  !!o3 && o3.x === 0 && o3.z === 0 && Math.abs(subToPx(o3.y) - expectLenPx) < 0.1,
  `offset3D(px)=(${o3 ? subToPx(o3.x) : '?'}, ${o3 ? subToPx(o3.y) : '?'}, ${o3 ? subToPx(o3.z) : '?'}) 期望 y≈${expectLenPx.toFixed(2)}`,
);

// 5. 胸→肩 socket 不拉直（保留原始差值）：diff=(0.2,0.15,0) → x=12.8, y=-(0.15)*64=-9.6
const sockShoulder = chest.sockets.find((s) => s.name === 'shoulderR');
const os = sockShoulder?.offset3D;
check(
  '肩偏移原样',
  !!os && Math.abs(subToPx(os.x) - 12.8) < 0.1 && Math.abs(subToPx(os.y) - -9.6) < 0.1 && os.z === 0,
  `offset3D(px)=(${os ? subToPx(os.x) : '?'}, ${os ? subToPx(os.y) : '?'}, ${os ? subToPx(os.z) : '?'})`,
);

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
