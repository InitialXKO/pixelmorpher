// 方向镜像口径探针（运行时编号：0南 1东南 2东 3东北 4北 5西北 6西 7西南）：
// 镜像只为东西侧面对侧复用；北（4）与南（0）永不镜像——钉住
// 「variant===4 无条件镜像」误翻北向的回归（该行是编辑器编号
// 4=西 的规则串进运行时编号 4=北）。从模板源码抽 variantMirrored
// 本体驱动（非抄写）。
import { readFileSync } from 'node:fs';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import { createDefaultNode } from '../src/lib/unified-types';

let fails = 0;
const check = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const src = readFileSync(new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url), 'utf8');
const grab = (name: string): string => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error('缺函数 ' + name);
  let d = 0; const b0 = src.indexOf('{', i);
  for (let j = b0; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('函数未闭合 ' + name);
};
const constDecl = (name: string): string => {
  const i = src.indexOf(`const ${name} =`);
  if (i < 0) throw new Error('缺常量 ' + name);
  return src.slice(i, src.indexOf(';', i) + 1);
};
const factory = new Function(`
  ${constDecl('MIRROR_VARIANT')}
  ${constDecl('DIAGONAL_MAIN')}
  ${grab('variantMirrored')}
  return { variantMirrored };
`) as unknown as () => { variantMirrored: (part: { variants?: Record<number, unknown> }, variant: number) => boolean };
const { variantMirrored } = factory();

const bare: { variants?: Record<number, unknown> } = {};
let allFalse = true;
for (let v = 0; v < 8; v++) if (variantMirrored(bare, v)) allFalse = false;
check(allFalse, '无变体数据的部件：8 方向全不镜像（北向误翻回归钉）');

const eastData = { variants: { 2: {} } };
check(variantMirrored(eastData, 6) === true, '有东（2）数据：西（6）镜像复用');
check(variantMirrored(eastData, 4) === false, '有东（2）数据：北（4）仍不镜像');
check(variantMirrored(eastData, 0) === false, '有东（2）数据：南（0）不镜像');
check(variantMirrored(eastData, 2) === false, '东（2）本方向有数据：不镜像');

const seData = { variants: { 7: {} } };
check(variantMirrored(seData, 1) === true, '有西南（7）数据：东南（1）镜像复用（对侧对）');
check(variantMirrored(seData, 7) === false, '西南（7）本方向有数据：不镜像');

const nwData = { variants: { 5: {} } };
check(variantMirrored(nwData, 3) === true, '有西北（5）数据：东北（3）镜像复用（对侧对）');

check(!src.includes('if (variant === 4) return true'), '模板已无「variant===4 无条件镜像」行');

// ---------- B) convert 键对齐：标记键写成运行时编号，西借东真正生效 ----------
{
  const buildChar = (rootDir: number) => {
    const pelvis = createDefaultNode('pelvis', 'pelvis');
    (pelvis.transform as { variantIndex: number }).variantIndex = rootDir;
    (pelvis as { slot: unknown }).slot = { slotKey: 'pelvis' };
    const piece = { nodeId: 'pelvis', zIndex: 0, parametric: createDefaultParametricAppearance() } as never;
    return {
      id: 'c1', name: 't', nodes: { pelvis }, rootNodeId: 'pelvis', rootNodeIds: ['pelvis'],
      sprites: {}, costumeSets: [{ id: 's1', name: '默认', pieces: { pelvis: piece } }],
      activeCostumeSetId: 's1', direction: rootDir, latitude: 0, ikChains: [],
    } as never;
  };
  const conv = (rootDir: number) => convertCharacterToRuntimePackage(buildChar(rootDir), undefined,
    { frameRate: 12, totalFrames: 12, clips: [] }) as unknown as { parts: Array<{ variants?: Record<string, unknown> }> };
  const south = conv(6).parts[0];
  check(JSON.stringify(Object.keys(south?.variants ?? {})) === '["0"]', 'B1 南向根（编辑器 6）→ 包内键为运行时 0');
  let southAll = true;
  for (let v = 0; v < 8; v++) if (variantMirrored(south as never, v)) southAll = false;
  check(southAll, 'B2 南向根部件：8 方向全不镜像（正面图无对侧可借）');
  const east = conv(0).parts[0];
  check(JSON.stringify(Object.keys(east?.variants ?? {})) === '["2"]', 'B3 东向根（编辑器 0）→ 包内键为运行时 2');
  check(variantMirrored(east as never, 6) === true, 'B4 东向根部件：西（6）借东镜像生效');
  check(variantMirrored(east as never, 2) === false, 'B5 东向根部件：东（2）本向不镜像');
  check(variantMirrored(east as never, 4) === false, 'B6 东向根部件：北（4）不镜像');
}

// ---------- C) 骨架同翻：镜像时 resolvePart 的 pivot/off 横翻（与瓦片同源一旗） ----------
{
  const factory2 = new Function(`
    ${constDecl('MIRROR_VARIANT')}
    ${constDecl('DIAGONAL_MAIN')}
    ${grab('mirrorParams')}
    ${grab('resolveVariantParams')}
    ${grab('variantMirrored')}
    ${grab('resolvePart')}
    return { resolvePart, variantMirrored };
  `) as unknown as () => {
    resolvePart: (part: unknown, variant: number, costume?: unknown) => { params: { pivot: [number, number]; off: [number, number] } };
    variantMirrored: (part: never, variant: number) => boolean;
  };
  const { resolvePart } = factory2();
  const part = { base: { pivot: [30, 10], off: [5, 2] }, variants: { 2: {} }, costumeKeys: [] };
  const eastP = resolvePart(part, 2, undefined).params;
  check(eastP.pivot[0] === 30 && eastP.off[0] === 5, 'C1 东向解析：pivot/off 不翻');
  const westP = resolvePart(part, 6, undefined).params;
  check(westP.pivot[0] === -30 && westP.pivot[1] === 10 && westP.off[0] === -5 && westP.off[1] === 2,
    'C2 西借东解析：pivot/off 左右翻（骨架与精灵同翻）、纵向不变');
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);
