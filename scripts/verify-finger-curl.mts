import * as fs from 'node:fs';
import * as THREE from 'three';
import { detectFingers, applyFingerCurl } from '../src/lib/bake/threejs-baker-twopass.ts';

import { execSync } from 'node:child_process';
if (!fs.existsSync('/tmp/Xbot.glb')) {
  console.log('下载 Xbot.glb 到 /tmp …');
  execSync('curl -sL --max-time 120 -o /tmp/Xbot.glb https://threejs.org/examples/models/gltf/Xbot.glb');
}
const buf = fs.readFileSync('/tmp/Xbot.glb');
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const skin = gltf.skins[0];
const jointSet = new Set<number>(skin.joints);
const objs = new Map<number, THREE.Object3D>();
gltf.nodes.forEach((n: any, i: number) => {
  const o = jointSet.has(i) ? new THREE.Bone() : new THREE.Object3D();
  o.name = n.name ?? '';
  if (n.translation) o.position.fromArray(n.translation);
  if (n.rotation) o.quaternion.fromArray(n.rotation);
  if (n.scale) o.scale.fromArray(n.scale);
  objs.set(i, o);
});
gltf.nodes.forEach((n: any, i: number) => { for (const c of n.children ?? []) objs.get(i)!.add(objs.get(c)!); });
const scene = new THREE.Scene();
for (const s of gltf.scenes[gltf.scene ?? 0].nodes) scene.add(objs.get(s)!);
scene.updateMatrixWorld(true);

const allBones: THREE.Bone[] = [];
scene.traverse((o) => { if ((o as THREE.Bone).isBone) allBones.push(o as THREE.Bone); });
// 只看左手（用户重烘对象）
const leftHand = allBones.find((b) => b.name === 'mixamorig:LeftHand')!;
const inLeft = new Set<THREE.Bone>();
leftHand.traverse((o) => { if ((o as THREE.Bone).isBone) inLeft.add(o as THREE.Bone); });
const det = detectFingers(allBones.filter((b) => inLeft.has(b) || b === leftHand), {});
// 注意：真实调用是整模 bones；这里过滤只为聚焦左手，hubs 逻辑等价（LeftHand 是 hub）
const detAll = detectFingers(allBones, {});
const fingers = detAll.fingers.filter((f) => inLeft.has(f.bones[0]));
const thumb = detAll.thumb && inLeft.has(detAll.thumb.bones[0]) ? detAll.thumb : null;
console.log('左手 fingers:', fingers.map((f) => f.label).join(','), '| thumb:', thumb?.label);

const tipOf = (bones: THREE.Bone[]) => bones[bones.length - 1].getWorldPosition(new THREE.Vector3());
const mcpC = new THREE.Vector3();
fingers.forEach((f) => mcpC.add(f.bones[0].getWorldPosition(new THREE.Vector3())));
mcpC.multiplyScalar(1 / fingers.length);
// 掌法线：knuckleAxis × 中指方向；掌侧符号由拇指根所在侧定
const mcpPts = fingers.map((f) => f.bones[0].getWorldPosition(new THREE.Vector3()));
const axis = mcpPts[mcpPts.length - 1].clone().sub(mcpPts[0]).normalize();
const midDir = fingers[1].bones[1].getWorldPosition(new THREE.Vector3()).sub(fingers[1].bones[0].getWorldPosition(new THREE.Vector3())).normalize();
let n = new THREE.Vector3().crossVectors(axis, midDir).normalize();
const thumbSide = Math.sign(n.dot(thumb!.bones[0].getWorldPosition(new THREE.Vector3()).sub(mcpC)));
console.log('拇指根相对指根平面侧别 sign =', thumbSide, '（定义为掌侧）');
const handPos = leftHand.getWorldPosition(new THREE.Vector3());
const before = fingers.map((f) => tipOf(f.bones));
applyFingerCurl(scene, { fingers: detAll.fingers, thumb: detAll.thumb, fingerStatus: 'auto', thumbStatus: 'auto' }, 0.91);
scene.updateMatrixWorld(true);
let fail = 0;
fingers.forEach((f, i) => {
  const tip = tipOf(f.bones);
  const moved = tip.distanceTo(before[i]);
  const side = Math.sign(n.dot(tip.clone().sub(mcpC)));
  const p1 = f.bones[1].getWorldPosition(new THREE.Vector3());
  const p2 = f.bones[2].getWorldPosition(new THREE.Vector3());
  const palmComp = p2.sub(p1).normalize().dot(n) * thumbSide;
  const ok = moved > 0.05 && side === thumbSide && palmComp > 0;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${f.label}: 位移=${moved.toFixed(3)} 掌侧符号=${side} 第一节掌侧分量=${palmComp.toFixed(3)}`);
});
// 拇指（乙·对掌）：尖端应落在四指前方掌侧——相对 hand 的 x 为正、不深陷、且比伸直时更靠近指根中心
const handBone = allBones.find((b) => b.name === 'mixamorig:LeftHand')!;
const handPosV = handBone.getWorldPosition(new THREE.Vector3());
const mcpLeft = new THREE.Vector3();
fingers.forEach((f) => mcpLeft.add(f.bones[0].getWorldPosition(new THREE.Vector3())));
mcpLeft.multiplyScalar(1 / fingers.length);
const thumbTip1 = tipOf(detAll.thumb!.bones);
const relT = thumbTip1.clone().sub(handPosV);
const dCenter1 = thumbTip1.distanceTo(mcpLeft);
const thumbOk = relT.x > 0.03 && relT.y > -0.07 && dCenter1 < 0.075;
if (!thumbOk) fail++;
console.log(`${thumbOk ? 'PASS' : 'FAIL'} thumb 对掌落点: relHand=(${relT.toArray().map((v) => v.toFixed(3)).join(',')}) 距指根中心=${dCenter1.toFixed(3)}`);
const tt = tipOf(detAll.thumb!.bones);
const tSide = Math.sign(n.dot(tt.clone().sub(mcpC)));
if (tSide !== thumbSide) { fail++; console.log('FAIL thumb side', tSide); } else console.log('PASS thumb 掌侧');
console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
