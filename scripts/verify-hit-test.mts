// 验证命中复用：computeWorldTransforms + projectToView 给出的位置与主渲染一致，
// 且 T-pose 臂链（肘/腕）落在肩的水平方向（命中点 = 绘制点）
import { mapBonesToNodes, type ProcessedBone, type ProcessedBoneDirection } from '../src/lib/bake/skeleton-mapper';
import { computeWorldTransforms } from '../src/lib/unified-render';
import { projectToView, subToPx } from '../src/lib/unified-types';

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
m.set(0, pb(0, 'hips', null, 'torso', { x: 0, y: 0.9, z: 0 }));
m.set(1, pb(1, 'chest', 0, 'torso', { x: 0, y: 1.2, z: 0 }));
m.set(2, pb(2, 'shoulderR', 1, 'armR', { x: 0.2, y: 1.35, z: 0 }));
m.set(3, pb(3, 'elbowR', 2, 'armR', { x: 0.25, y: 1.0, z: 0.05 }));
m.set(4, pb(4, 'wristR', 3, 'armR', { x: 0.28, y: 0.7, z: 0.08 }));

const mapped = mapBonesToNodes(m, 'hit', 'T');
const character = mapped.character as any;

const W = 800;
const H = 600;
const wt = computeWorldTransforms(character, 0, W, H);
const rootDir = (character.nodes[character.rootNodeId]?.transform.variantIndex ?? 0) as 0|1|2|3|4|5|6|7;
const centerX = (W / 2) * 16; // SubPixel = px * 16 (pxToSub)
const centerY = (H / 2) * 16;

function screenOf(nodeId: string) {
  const t = wt.get(nodeId)!;
  const proj = projectToView(t.worldX, t.worldY, t.worldZ, rootDir);
  return { x: subToPx(proj.canvasX + centerX), y: subToPx(proj.canvasY + centerY) };
}

const sh = screenOf('node_hit_2');
const el = screenOf('node_hit_3');
const wr = screenOf('node_hit_4');

let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${label}: ${detail}`);
  if (!ok) fail++;
}

check('肘在肩右侧（T-pose 水平）', el.x > sh.x + 15, `肩x=${sh.x.toFixed(1)} 肘x=${el.x.toFixed(1)}`);
check('肘与肩同高', Math.abs(el.y - sh.y) < 3, `肩y=${sh.y.toFixed(1)} 肘y=${el.y.toFixed(1)}`);
check('腕在肘右侧', wr.x > el.x + 10, `肘x=${el.x.toFixed(1)} 腕x=${wr.x.toFixed(1)}`);
check('腕与肘同高', Math.abs(wr.y - el.y) < 3, `肘y=${el.y.toFixed(1)} 腕y=${wr.y.toFixed(1)}`);
// 命中旧逻辑（2D socket=0）下肘会塌到肩的位置；新逻辑两者明显 separated
check('肘肩不重合（旧 bug 已除）', Math.hypot(el.x - sh.x, el.y - sh.y) > 15, `距离=${Math.hypot(el.x - sh.x, el.y - sh.y).toFixed(1)}px`);

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
