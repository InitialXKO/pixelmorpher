// ============================================================
// 探针：Live2D moc3 写入器移植验证（2026-10-25）
// 合成模型（2 个图元 + ParamAngleX 一族关键形）→ buildMoc3 二进制
// 结构（魔数/版本/关键形绑定数）→ buildMoc3Archive 打包结构 →
// serialize 的 exportModel/importModel 往返校验（verifyRoundtripBytes）。
// 跑法：/opt/hatch-image/bin/bun spikes/bake3d/probe-moc3-writer.mts
// ============================================================

import { buildMoc3, buildMoc3Archive } from '../../src/lib/live2d/moc3.ts';
import { exportModel, importModel, verifyRoundtripBytes, type PngCodec } from '../../src/lib/live2d/serialize.ts';
import { parseZip } from '../../src/lib/live2d/zip.ts';
import type { Live2dModel, Live2dDrawable } from '../../src/lib/live2d/model.ts';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
};

const tex = (w: number, h: number, r: number, g: number, b: number) => {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255; }
  return { width: w, height: h, rgba };
};
const quad = (
  id: string, label: string, x0: number, y0: number, x1: number, y1: number,
  renderOrder: number, texture: Live2dDrawable['texture'],
): Live2dDrawable => ({
  id, label, meshId: id, leafIds: [id],
  vertexCount: 4, triangleCount: 2,
  triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
  meshVertexIndices: new Uint32Array([0, 1, 2, 3]),
  neutralPositions: new Float32Array([x0, y0, x1, y0, x1, y1, x0, y1]),
  uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
  texture, renderOrder,
});

// 位移块：全部图元拼接（body 4 顶点 + head 4 顶点，各 xy）
const dispBlock = (headDx: number) => {
  const a = new Float32Array(16);
  for (let v = 0; v < 4; v++) { a[8 + v * 2] = headDx; }
  return a;
};

const model: Live2dModel = {
  schemaVersion: 1,
  createdAt: '2026-10-25T00:00:00.000Z',
  modelName: 'probe',
  viewport: { width: 200, height: 200 },
  params: [{ id: 'ParamAngleX', label: '角度 X', min: -30, max: 30, default: 0 }],
  drawables: [
    quad('body', '身体', 60, 80, 140, 190, 0, tex(8, 8, 200, 60, 60)),
    quad('head', '头', 80, 20, 120, 70, 1, tex(8, 8, 60, 60, 220)),
  ],
  families: {
    ParamAngleX: {
      family: 'ParamAngleX', default: 0, values: [-30, 0, 30],
      displacements: [dispBlock(-6), dispBlock(0), dispBlock(6)],
    },
  },
  depthFamilies: {},
  neutralDepths: [0.1, -0.1],
  order: ['body', 'head'],
  errorReport: { comboCount: 0, meanErrorPx: 0, maxErrorPx: 0, perCombo: [], worstDrawable: null },
  orderReport: { flips: [], samplesChecked: 0 },
};

// ---- buildMoc3 二进制结构 ----
const { moc3, keyformCounts } = buildMoc3(model);
check('moc3 魔数 MOC3', moc3[0] === 0x4d && moc3[1] === 0x4f && moc3[2] === 0x43 && moc3[3] === 0x33,
  `bytes=${Array.from(moc3.slice(0, 4)).join(',')}`);
check('moc3 版本字节 = 1（3.0.0 版式）', moc3[4] === 1, `v=${moc3[4]}`);
check('moc3 体积合理（> 数据起始 0x7C0）', moc3.length > 0x7c0, `len=${moc3.length}`);
// 注：写入器的既定口径——静止图元也会绑定 AngleX（其绘制顺序关键形要随
// 姿态排名走，否则与运动图元的顺序冲突冻死），故 body 同为 3。
check('静止图元 body 关键形数 = 3（AngleX 顺序追踪绑定）', keyformCounts[0] === 3, `counts=${keyformCounts.join(',')}`);
check('受 ParamAngleX 驱动的 head 关键形数 = 3', keyformCounts[1] === 3, `counts=${keyformCounts.join(',')}`);

// ---- 无 AngleX 的模型：静止图元不绑定（关键形数 1），运动图元绑定其族 ----
{
  const m2: Live2dModel = {
    ...model,
    params: [{ id: 'ParamBreath', label: '呼吸', min: 0, max: 1, default: 0 }],
    families: {
      ParamBreath: {
        family: 'ParamBreath', default: 0, values: [0, 0.5, 1],
        displacements: [dispBlock(0), dispBlock(1), dispBlock(2)],
      },
    },
  };
  const r2 = buildMoc3(m2);
  check('无 AngleX 时静止图元关键形数 = 1', r2.keyformCounts[0] === 1, `counts=${r2.keyformCounts.join(',')}`);
  check('无 AngleX 时运动图元关键形数 = 3', r2.keyformCounts[1] === 3, `counts=${r2.keyformCounts.join(',')}`);
}

// ---- buildMoc3Archive 打包结构 ----
const archive = buildMoc3Archive(model, (t) => t.rgba);
const files = parseZip(archive);
check('归档含 moc3', files.has('probe/model.moc3'));
check('归档含贴图', files.has('probe/texture_00.png'));
check('归档含 model3.json', files.has('probe/probe.model3.json'));
const manifest = JSON.parse(new TextDecoder().decode(files.get('probe/probe.model3.json'))) as {
  FileReferences: { Moc: string; Textures: string[] };
};
check('model3.json 引用 moc3 与贴图',
  manifest.FileReferences.Moc === 'model.moc3' && manifest.FileReferences.Textures[0] === 'texture_00.png');
const innerMoc3 = files.get('probe/model.moc3')!;
check('归档内 moc3 同样以 MOC3 开头', innerMoc3[0] === 0x4d && innerMoc3[3] === 0x33);

// ---- serialize 往返（无损存根编解码：4 字节头 w/h + rgba 原文） ----
const stubCodec: PngCodec = {
  encode: (t) => {
    const out = new Uint8Array(8 + t.rgba.length);
    new DataView(out.buffer).setUint32(0, t.width, true);
    new DataView(out.buffer).setUint32(4, t.height, true);
    out.set(t.rgba, 8);
    return out;
  },
  decode: async (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(0, true), height: dv.getUint32(4, true), rgba: bytes.slice(8) };
  },
};
const zipBytes = exportModel(model, stubCodec);
const reimported = await importModel(zipBytes, stubCodec);
const problems = verifyRoundtripBytes(model, reimported);
check('exportModel → importModel 往返零差异', problems.length === 0, problems.join(' | '));

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
