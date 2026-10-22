import { useProjectStore } from '../src/lib/store';

const st = useProjectStore.getState();
const spr = st.addSprite('probe', 4, 3, { plugX: 1, plugY: 1 });
// 填像素：左上红、右下蓝
const data = spr.data.map((r) => r.slice());
data[0][0] = '#ff0000'; data[2][3] = '#0000ff';
const hm = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]];
st.updateSprite(spr.id!, { data, heightmap: hm, landmarks: { leftEye: { x: 0, y: 0 }, nose: { x: 0.5, y: 0.5 } } });
// 裁掉左 1 列、上 0 行，并扩右/下各 1：新尺寸 5x4，offset = (-1, 0)
useProjectStore.getState().resizeSprite(spr.id!, 5, 4, -1, 0);
const after = useProjectStore.getState().sprites[spr.id!]!;
const assert = (name: string, cond: boolean) => { console.log(cond ? '✓' : '✗ FAIL', name); if (!cond) process.exitCode = 1; };
assert('尺寸 5x4', after.width === 5 && after.height === 4);
assert('红点从 (0,0) 移到不存在（被裁）/蓝点 (3,2)->(2,2)', after.data[0][0] === null && after.data[2][2] === '#0000ff');
assert('扩边区透明', after.data[0][4] === null && after.data[3][0] === null);
const { subToPx } = await import('../src/lib/unified-types');
assert('plug (1,1) 平移到 (0,1)（钳制内）', subToPx(after.plug!.x) === 0 && subToPx(after.plug!.y) === 1);
assert('heightmap 同步裁：[0][0] = 旧[0][1] = 1', after.heightmap![0][0] === 1 && after.heightmap![3][4] === 0);
assert('landmarks 重映射：leftEye (0,0)->(贴边 0, 0)', after.landmarks!.leftEye!.x === 0 && after.landmarks!.leftEye!.y === 0);
const nose = after.landmarks!.nose!;
assert('nose (0.5,0.5)->((2-1)/5, 1.5/4)', Math.abs(nose.x - 0.2) < 1e-9 && Math.abs(nose.y - 0.375) < 1e-9);
console.log('裁切探针完');
