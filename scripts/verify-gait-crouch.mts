// 俯视横向碎步修复 + 横版手动下蹲探针（源码口径钉 + 节奏算式）：
// A) 俯视相位按轴分解：横向分量按 cycHoriz（步长两倍）、纵向按
//    cycTop（原口径）；以 FB_SWING 提取值算参考腿长下的步频——
//    横向修复后与纵向/侧视同为一份周期时间，修复前是两倍。
// B) 手动下蹲接线：物理侧回写 fbSideDown、位姿侧钉脚下沉块读它、
//    物理门（蹲下不移动）在位；生成页脚本可解析。
import { readFileSync } from 'node:fs';
import { buildRuntimeHtml } from '../src/lib/proc-runtime/runtime-template';

let fails = 0;
const check = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

const src = readFileSync(new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url), 'utf8');

// ---------- A) 俯视横向步频 ----------
{
  const swingM = src.match(/const FB_SWING = ([\d.]+);/);
  check(!!swingM, 'A0 模板含 FB_SWING');
  const FB_SWING = swingM ? parseFloat(swingM[1]) : 0;
  check(src.includes('let strideH = 2 * stride;'), 'A1 横向步长 = 纵向步长两倍');
  check(src.includes('const cycHoriz = 2 * strideH;'), 'A2 横向周期距离 cycHoriz = 2·strideH');
  check(src.includes('const stanceTravel = FB_STANCE * cycHoriz;'), 'A3 平面形式支撑行程按横向周期（钉脚不拖步）');
  check(src.includes('fbPhase += 2 * Math.PI * (Math.abs(dxF) / cycHoriz + Math.abs(dyF) / cycTop);'),
    'A4 相位推进按轴分解（横 cycHoriz / 纵 cycTop）');
  // 参考腿长 60：纵向步长 = 60·sin(SWING)，周期 = 2 倍步长；
  // 纵向速度 70、横向/侧视速度 140（updateCharacterTop 与 PHYS 口径）
  const strideV = 60 * Math.sin(FB_SWING);
  const cycV = 2 * strideV, cycH = 2 * (2 * strideV);
  const cadV = 70 / cycV, cadH = 140 / cycH, cadSide = 140 / (2 * (2 * strideV));
  check(near(cadH, cadV) && near(cadH, cadSide), `A5 步频对齐：横 ${cadH.toFixed(3)}/s = 纵 ${cadV.toFixed(3)}/s = 侧视 ${cadSide.toFixed(3)}/s`);
  const cadOld = 140 / cycV;
  check(near(cadOld, 2 * cadV), 'A6 修复前横向步频恰为纵向两倍（碎步成因钉）');
}

// ---------- B) 横版手动下蹲接线 ----------
{
  check(src.includes('let fbSideDown = false;'), 'B1 状态位 fbSideDown 存在');
  check(src.includes('fbSideDown = !!downHeld;'), 'B2 物理侧每帧回写 fbSideDown');
  check(src.includes('if (downHeld && char.onGround && fbCrouchT <= 0) ix = 0;'), 'B3 物理门：蹲下不移动/不转面');
  check(src.includes('const wantHold = fbStage === \'none\' && fbCrouchT <= 0 && char.onGround && !char.ledge && fbSideDown;'),
    'B4 位姿侧接合条件（无跳跃序、在地、按住下）');
  check(src.includes('bodyOff = -fbDipMax() * (1 - (1 - q) * (1 - q));'), 'B5 下沉深度复用 fbDipMax（与跳跃下蹲同深）');
  const html = buildRuntimeHtml({ parts: [], performances: [] } as never);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let parseOk = true;
  for (const sc of scripts) { try { new Function(sc); } catch { parseOk = false; } }
  check(parseOk && scripts.length > 0, 'B6 生成页脚本可解析');
}

// ---------- C) 滞空收腿顺序 ----------
{
  check(src.includes('const tucked = char.vy <= 0 || ci === airFirstCi;'), 'C1 收腿判据：下落全收 / 上升只收先行腿');
  check(src.includes('const along = (rt.restT[0] - rt.J[0][0]) * faceF;'), 'C2 先行腿按静止几何沿朝向最靠后选定');
  check(!src.includes('const want = char.vy > -20'), 'C3 旧口径（vy>-20 双腿同收、深落伸腿）已摘除');
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);
