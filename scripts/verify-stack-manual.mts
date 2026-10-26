// 手动拆分堆叠探针：合成静态网格（链式两管 + 孤立斜管）→
// prepareManualParts（纯函数）→ buildManualPartStacks → 断言：
// 链上部件轴向走枢轴延续（父→子）、叶子走入向、孤立部件走几何
// 主轴；再经 mapBonesToNodes + attachBoneStacks + 渲染计划，
// 断言两节都有 stackRender 且能光栅化出像素。
import * as THREE from 'three';
import {
  prepareManualParts, buildManualPartStacks,
  type ManualPartSpec, type PreparedManual,
} from '../src/lib/bake/threejs-baker-manual';
import { mapBonesToNodes, type ProcessedBone, type ProcessedBoneDirection } from '../src/lib/bake/skeleton-mapper';
import { attachBoneStacks } from '../src/lib/bake/stack-attach';
import { generateRenderPlan } from '../src/lib/unified-render';
import { rasterizeStackOpsData } from '../src/lib/stack-render';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

type V3 = { x: number; y: number; z: number };
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: V3): V3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

/** 圆管静态网格（世界空间，沿 P0→P1） */
function tubeMesh(
  meshIndex: number, name: string, p0: V3, p1: V3, r: number,
  pivot: V3, parentMeshIndex: number | null, color: number,
) {
  const SEG = 10;
  const a = norm(sub(p1, p0));
  const u = Math.abs(a.y) > 0.9 ? { x: 1, y: 0, z: 0 } : norm({ x: -a.y, y: a.x, z: 0 });
  const v = { x: a.y * u.z - a.z * u.y, y: a.z * u.x - a.x * u.z, z: a.x * u.y - a.y * u.x };
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let ring = 0; ring < 2; ring++) {
    const c = ring === 0 ? p0 : p1;
    for (let i = 0; i < SEG; i++) {
      const t = (i / SEG) * Math.PI * 2;
      positions.push(
        c.x + (u.x * Math.cos(t) + v.x * Math.sin(t)) * r,
        c.y + (u.y * Math.cos(t) + v.y * Math.sin(t)) * r,
        c.z + (u.z * Math.cos(t) + v.z * Math.sin(t)) * r,
      );
      uvs.push(i / SEG, ring);
    }
  }
  for (let i = 0; i < SEG; i++) {
    const j = (i + 1) % SEG;
    index.push(i, j, SEG + j, i, SEG + j, SEG + i);
  }
  return {
    info: { meshIndex, name, path: name, triCount: SEG * 2, pivot, parentMeshIndex },
    positions: Float32Array.from(positions),
    uvs: Float32Array.from(uvs),
    index: Uint32Array.from(index),
    material: new THREE.MeshBasicMaterial({ color }),
    groups: [],
  };
}

function entriesOf(prepared: PreparedManual) {
  return [
    { boneIndex: 0, jointNorm: prepared.rootJoint3D, parentIndex: null as number | null },
    ...prepared.parts.map((p, pi) => ({
      boneIndex: pi + 1,
      jointNorm: p.pivotNorm,
      parentIndex: p.parentSpecIndex >= 0 ? p.parentSpecIndex + 1 : 0,
    })),
  ];
}

// ===== 案例 1：链式两管（上节枢轴在下端、下节接其上端——模型 Y-up 向上生长）=====
{
  const statics = [
    tubeMesh(0, 'upper', { x: 0, y: 10, z: 0 }, { x: 0, y: 30, z: 0 }, 6, { x: 0, y: 10, z: 0 }, null, 0xff2020),
    tubeMesh(1, 'lower', { x: 0, y: 30, z: 0 }, { x: 0, y: 52, z: 0 }, 5, { x: 0, y: 30, z: 0 }, 0, 0x20c040),
  ];
  const specs: ManualPartSpec[] = [
    { name: '上节', meshIndices: [0] },
    { name: '下节', meshIndices: [1] },
  ];
  const prepared = prepareManualParts(statics as never, specs);
  ok(prepared.parts[1].parentSpecIndex === 0, '层级解析：下节父 = 上节');
  const stacks = buildManualPartStacks(prepared, entriesOf(prepared), { size: 128, layerThicknessPx: 4 });
  ok(stacks.size === 2, `两节都产摞（实际 ${stacks.size}）`);
  const s1 = stacks.get(1)!;
  const s2 = stacks.get(2)!;
  // 角色空间 Y 翻转：模型向上生长 → 角色空间轴向应为 (0,−1,0)
  ok(s1.sliced.axis.y < -0.95, `上节轴向走子枢轴延续（axis.y=${s1.sliced.axis.y.toFixed(2)}）`);
  ok(s2.sliced.axis.y < -0.95, `下节（叶子）轴向走入向（axis.y=${s2.sliced.axis.y.toFixed(2)}）`);
  ok(s1.sliced.layers.length >= 3 && s2.sliced.layers.length >= 3,
    `层数充足（${s1.sliced.layers.length}/${s2.sliced.layers.length}）`);
  ok(s1.sliced.filledPixels > 0 && s2.sliced.filledPixels > 0, '两摞都有填充像素');
  const ahead = dot(sub(s1.sliced.origin, s1.jointChar), s1.sliced.axis);
  ok(ahead > -1, `上节 origin（根侧端面）在枢轴处不落后（${ahead.toFixed(1)}px）`);
  // 层图颜色 = 源材质色（采样走无贴图材质色路径）
  const px = s1.sliced.layers[1].rgba;
  let found = false;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] > 0 && Math.abs(px[i] - 0xff) < 30 && px[i + 1] < 80) { found = true; break; }
  }
  ok(found, '上节层图带源材质红色');

  // ---- 导入链：mapBonesToNodes + attach + 渲染计划 ----
  const dir = (half: number): ProcessedBoneDirection => ({
    direction: 6,
    grid: Array.from({ length: 4 }, () => Array(4).fill('#888888')),
    width: 4, height: 4, cropX: 0, cropY: 0, jointX: 64, jointY: 64,
    plugX: 2, plugY: 2, cameraHalf: half, globalCameraHalf: 1.0,
  } as ProcessedBoneDirection);
  const bones = new Map<number, ProcessedBone>();
  bones.set(0, { boneIndex: 0, boneName: '根节点', parentIndex: null, directions: [], joint3D: prepared.rootJoint3D, bakeWidth: 128 });
  prepared.parts.forEach((p, pi) => {
    bones.set(pi + 1, {
      boneIndex: pi + 1, boneName: p.spec.name,
      parentIndex: p.parentSpecIndex >= 0 ? p.parentSpecIndex + 1 : 0,
      directions: [dir(p.half)], joint3D: p.pivotNorm, bakeWidth: 128,
      worldToPixels: 64 / p.half,
    });
  });
  const mapped = mapBonesToNodes(bones, 'mc', '手动测试');
  const att = attachBoneStacks(mapped.character, mapped.sprites, stacks, 'mc', '手动测试');
  ok(att.attached === 2 && att.skipped === 0, `挂载两节（attached=${att.attached}, skipped=${att.skipped}）`);
  const plan = generateRenderPlan(mapped.character, 0, 256, 256, 'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, mapped.sprites);
  const gridToRgba = (spr: { data: (string | null)[][] }) => {
    const h = spr.data.length, w = spr.data[0]?.length ?? 0;
    const rgba = new Uint8ClampedArray(w * h * 4);
    spr.data.forEach((row, y) => row.forEach((c, x) => {
      if (!c) return;
      const o = (y * w + x) * 4;
      rgba[o] = parseInt(c.slice(1, 3), 16); rgba[o + 1] = parseInt(c.slice(3, 5), 16);
      rgba[o + 2] = parseInt(c.slice(5, 7), 16); rgba[o + 3] = 255;
    }));
    return { rgba, width: w, height: h };
  };
  let stacked = 0;
  for (const ins of plan.nodeInstructions) {
    if (!ins.stackRender) continue;
    const sr = ins.stackRender;
    const layerRgba = sr.layerSpriteIds.map((id) => {
      const spr = mapped.sprites[id];
      return spr ? gridToRgba(spr as never) : null;
    });
    const ras = rasterizeStackOpsData(
      { ops: sr.ops, width: sr.width, height: sr.height, pivotX: sr.pivotX, pivotY: sr.pivotY, key: sr.key },
      layerRgba,
    );
    if (ras && ras.rgba.some((_, i) => i % 4 === 3 && ras.rgba[i] > 0)) stacked++;
  }
  ok(stacked === 2, `渲染计划两节都有可光栅化的 stackRender（实际 ${stacked}）`);
}

// ===== 案例 2：孤立斜管（无父无子）→ 几何主轴 =====
{
  const statics = [
    tubeMesh(0, 'diag', { x: -20, y: -20, z: 0 }, { x: 20, y: 20, z: 0 }, 5, { x: 0, y: 0, z: 0 }, null, 0x4040ff),
  ];
  const specs: ManualPartSpec[] = [{ name: '斜件', meshIndices: [0], pivot: { mode: 'center' } }];
  const prepared = prepareManualParts(statics as never, specs);
  const stacks = buildManualPartStacks(prepared, entriesOf(prepared), { size: 128, layerThicknessPx: 4 });
  const s = stacks.get(1);
  ok(!!s, '孤立部件产摞');
  // 模型对角 (1,1,0) → 角色空间 (1,−1,0)/√2（符号任意）
  const d = Math.abs(dot(s!.sliced.axis, norm({ x: 1, y: -1, z: 0 })));
  ok(d > 0.95, `轴向 = 几何主轴（|dot|=${d.toFixed(3)}）`);
  ok(s!.sliced.layers.length >= 4, `斜摞层数（${s!.sliced.layers.length}）`);
}

console.log(fails === 0 ? 'STACK MANUAL PROBE PASS' : `STACK MANUAL PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
