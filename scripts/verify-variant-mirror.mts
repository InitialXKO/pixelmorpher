// 方向镜像口径探针（运行时编号：0南 1东南 2东 3东北 4北 5西北 6西 7西南）：
// 镜像只为东西侧面对侧复用；北（4）与南（0）永不镜像——钉住
// 「variant===4 无条件镜像」误翻北向的回归（该行是编辑器编号
// 4=西 的规则串进运行时编号 4=北）。从模板源码抽 variantMirrored
// 本体驱动（非抄写）。
import { readFileSync } from 'node:fs';

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

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);
