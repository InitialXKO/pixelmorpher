// 参考垫图组探针（行为）：五官点位换算 + 比例垫图关节点位 + 脸型条目存取。
import {
  DEFAULT_FACE_FEATURES, clampFaceFeatures, faceFeaturePoints, faceHalfWidths,
} from '../src/lib/face-features';
import { PROPORTION_PRESETS, proportionJoints } from '../src/lib/proportion-guide';
import {
  BUILTIN_ENTRIES, faceDefOf, faceEntriesOf, libraryIndexOf, refsOfDef,
} from '../src/lib/library-entries';
import { faceThumbRGBA } from '../src/lib/library-thumbs';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ---- 五官点位 ----
const p0 = faceFeaturePoints(DEFAULT_FACE_FEATURES);
ok(near(p0.eyeL.x, 0.3) && near(p0.eyeR.x, 0.7), `正脸：眼中心 0.30/0.70（实际 ${p0.eyeL.x}/${p0.eyeR.x}）`);
ok(near(p0.eyeL.y, DEFAULT_FACE_FEATURES.eyeY) && near(p0.mouth.y, DEFAULT_FACE_FEATURES.mouthY), '正脸：y 不压缩');
const pYaw = faceFeaturePoints(DEFAULT_FACE_FEATURES, 1, 0);
ok(near(pYaw.eyeR.x - pYaw.eyeL.x, 0.4 * 0.45, 1e-9), `yaw=1：眼距压缩 ×0.45（实际 ${(pYaw.eyeR.x - pYaw.eyeL.x).toFixed(3)}）`);
ok(near((pYaw.eyeL.x + pYaw.eyeR.x) / 2, 0.5 + 0.18), 'yaw=1：整体平移 +0.18');
const pPitch = faceFeaturePoints(DEFAULT_FACE_FEATURES, 0, 1);
ok(pPitch.mouth.y < DEFAULT_FACE_FEATURES.mouthY && pPitch.mouth.y > 0.5, `pitch=1：嘴线向中心收（实际 ${pPitch.mouth.y.toFixed(3)}）`);
const hw = faceHalfWidths(DEFAULT_FACE_FEATURES, 1);
ok(near(hw.eye, DEFAULT_FACE_FEATURES.eyeHalfW * 0.45), 'yaw=1：半宽同步压缩');
const clamped = clampFaceFeatures({ ...DEFAULT_FACE_FEATURES, eyeY: 1.4, eyeSpacing: 2, mouthY: -1 });
ok(clamped.eyeY === 1 && clamped.eyeSpacing === 0.9 && clamped.mouthY === 0, 'clamp：越界值钳回合法域');

// ---- 比例垫图 ----
ok(PROPORTION_PRESETS.length === 3, '预设三档（写实/标准/Q版）');
const j6 = proportionJoints(6, 'front');
ok(near(j6.waist.y, 3.0, 1e-9), `标准：腰在 3.0 头高（实际 ${j6.waist.y}）`);
ok(near(j6.ankleL.y, 5.88, 1e-9), `标准：踝在 5.88（实际 ${j6.ankleL.y}）`);
ok(near(j6.headCenter.y, 0.5), '头中心 0.5');
const armLen = Math.hypot(j6.wristL.x - j6.shoulderL.x, j6.wristL.y - j6.shoulderL.y);
const elbowLen = Math.hypot(j6.elbowL.x - j6.shoulderL.x, j6.elbowL.y - j6.shoulderL.y);
ok(near(elbowLen / armLen, 0.4 / 0.84, 0.01), `肘切分比 ≈ 0.40/0.84（实际 ${(elbowLen / armLen).toFixed(3)}）`);
ok(near(armLen, 6 * 0.43 * 0.84, 0.02), `臂长（肩→腕）≈ 2.17（实际 ${armLen.toFixed(2)}）`);
const j3 = proportionJoints(3, 'front');
ok(near(j3.ankleL.y, 2.88, 1e-9) && j3.waist.y < j6.waist.y, `Q版：总高 3、躯干压缩（腰 ${j3.waist.y.toFixed(2)}）`);
const jSide = proportionJoints(6, 'side');
ok(Math.abs(jSide.shoulderL.x) < Math.abs(j6.shoulderL.x) * 0.25, '侧面：肩横偏 ×0.2 量级');
const legLen = Math.hypot(j6.ankleL.x - j6.hipL.x, j6.ankleL.y - j6.hipL.y);
ok(legLen > 2.4 && legLen < 2.9, `腿长合理（实际 ${legLen.toFixed(2)}）`);

// ---- 脸型条目 ----
const faceEntries = faceEntriesOf(BUILTIN_ENTRIES);
ok(faceEntries.length === 3 && faceEntries.every((e) => e.cluster === '脸型'), `内置脸型条目 3 个（实际 ${faceEntries.length}）`);
const idx = libraryIndexOf(BUILTIN_ENTRIES);
const got = faceDefOf(idx, 'face-standard');
ok(!!got && got.def.params.eyeY === DEFAULT_FACE_FEATURES.eyeY, 'faceDefOf：标准三庭参数往返一致');
ok(faceDefOf(idx, 'chain-heavy-ring') === undefined, 'faceDefOf：非脸型条目返回 undefined');
const stdDef = got!.def;
ok(refsOfDef(stdDef).length === 0, 'refsOfDef：脸型无引用');
const thumb = faceThumbRGBA(DEFAULT_FACE_FEATURES, 48);
let headPx = 0, darkPx = 0;
for (let i = 0; i < thumb.data.length; i += 4) {
  if (thumb.data[i + 3] === 255) headPx++;
  if (thumb.data[i] === 30 && thumb.data[i + 1] === 34) darkPx++;
}
ok(headPx > 500 && darkPx > 20, `脸型缩略图：头形 ${headPx}px、点位 ${darkPx}px`);

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
