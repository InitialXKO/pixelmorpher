// ============================================================
// 探针：PMX → Live2D 模型构建器（2026-10-25）
// 用真实 PMX（reze）+ 存根隔离渲染（纯色整视口）跑通构建全程：
// 拆分图元、中立坐标、贴图裁剪、头/身体姿态采样关键形、
// 最后 buildMoc3 出二进制（消费端真路径）。
// 跑法：/opt/hatch-image/bin/bun spikes/bake3d/probe-live2d-builder.mts
// ============================================================

import * as fs from 'node:fs';
import { loadModelScene } from '../../src/lib/bake/load-model.ts';
import { buildLive2dModel } from '../../src/lib/live2d/build-from-model.ts';
import { buildMoc3 } from '../../src/lib/live2d/moc3.ts';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
};

const buf = fs.readFileSync('/tmp/mmdtest/reze/reze.pmx');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const scene = await loadModelScene(ab, new Map());

const V = 256;
const model = buildLive2dModel(scene, {
  modelName: 'reze',
  viewportSize: V,
  renderDrawable: (req) => {
    const rgba = new Uint8Array(req.viewport.width * req.viewport.height * 4);
    for (let i = 0; i < req.viewport.width * req.viewport.height; i++) {
      rgba[i * 4] = 180; rgba[i * 4 + 1] = 120; rgba[i * 4 + 2] = 90; rgba[i * 4 + 3] = 255;
    }
    return { rgba, width: req.viewport.width, height: req.viewport.height };
  },
});

check('拆分出多个图元', model.drawables.length >= 5, `n=${model.drawables.length}`);
check('图元 id 唯一', new Set(model.drawables.map((d) => d.id)).size === model.drawables.length);
let indicesOk = true;
let positionsOk = true;
let textureOk = true;
let totalTris = 0;
for (const d of model.drawables) {
  totalTris += d.triangleCount;
  for (const t of d.triangles) if (t >= d.vertexCount) indicesOk = false;
  for (let i = 0; i < d.vertexCount; i++) {
    const x = d.neutralPositions[i * 2], y = d.neutralPositions[i * 2 + 1];
    if (!(x >= -1 && x <= V + 1 && y >= -1 && y <= V + 1)) positionsOk = false;
  }
  if (d.texture.width < 1 || d.texture.height < 1 || d.texture.rgba.length !== d.texture.width * d.texture.height * 4) textureOk = false;
  for (let i = 0; i < d.vertexCount; i++) {
    const u = d.uvs[i * 2], v = d.uvs[i * 2 + 1];
    if (!(u >= -0.01 && u <= 1.01 && v >= -0.01 && v <= 1.01)) textureOk = false;
  }
}
check('三角形索引都在紧凑顶点表内', indicesOk);
check('中立坐标都在视口内', positionsOk);
check('贴图尺寸/UV 合法', textureOk);
check('总三角形数可观（>1000）', totalTris > 1000, `tris=${totalTris}`);
check('绘制顺序 renderOrder 连续', model.drawables.every((d, i) => d.renderOrder === i));

// 参数族：头部 AngleX 应存在且真的驱动头部图元、不驱动腿部图元
const fam = model.families['ParamAngleX'];
check('ParamAngleX 族存在（3 个采样值）', !!fam && fam.values.length === 3 && fam.displacements.length === 3,
  model.params.map((p) => p.id).join(','));
if (fam) {
  const offsets: number[] = [];
  let cur = 0;
  for (const d of model.drawables) { offsets.push(cur); cur += d.vertexCount * 2; }
  const maxDispFor = (di: number, k: number) => {
    const off = offsets[di];
    const n = model.drawables[di].vertexCount * 2;
    let m = 0;
    for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(fam.displacements[k][off + i]));
    return m;
  };
  const headIdx = model.drawables.findIndex((d) => d.id.endsWith('_head'));
  const legIdx = model.drawables.findIndex((d) => d.id.endsWith('_legL') || d.id.endsWith('_legR'));
  check('头部图元在 ±30° 有明显位移', headIdx >= 0 && maxDispFor(headIdx, 0) > 1 && maxDispFor(headIdx, 2) > 1,
    headIdx >= 0 ? `head=${model.drawables[headIdx].id} d-=${maxDispFor(headIdx, 0).toFixed(1)} d+=${maxDispFor(headIdx, 2).toFixed(1)}` : 'no head drawable');
  check('头部图元在 0° 位移为零', headIdx >= 0 && maxDispFor(headIdx, 1) < 1e-4);
  check('腿部图元不被 AngleX 驱动', legIdx < 0 || maxDispFor(legIdx, 0) < 0.5,
    legIdx >= 0 ? `leg max=${maxDispFor(legIdx, 0).toFixed(2)}` : 'no leg drawable');
  // 反对称：+30 与 -30 位移大致互为相反数（头部图元 x 向）
  if (headIdx >= 0) {
    const off = offsets[headIdx];
    let sx0 = 0, sx2 = 0, n = model.drawables[headIdx].vertexCount;
    for (let v = 0; v < n; v++) { sx0 += fam.displacements[0][off + v * 2]; sx2 += fam.displacements[2][off + v * 2]; }
    check('±30° 平均 x 位移反号', (sx0 / n) * (sx2 / n) < 0, `mean-= ${(sx0 / n).toFixed(2)} mean+= ${(sx2 / n).toFixed(2)}`);
  }
}

// 消费端：buildMoc3 真出二进制
const { moc3, keyformCounts } = buildMoc3(model);
check('buildMoc3 产出 MOC3 二进制', moc3[0] === 0x4d && moc3[3] === 0x33 && moc3.length > 0x7c0, `len=${moc3.length}`);
check('每个图元至少 1 个关键形', keyformCounts.length === model.drawables.length && keyformCounts.every((c) => c >= 1));

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
