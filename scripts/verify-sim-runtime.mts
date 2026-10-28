// ============================================================
// D6 乙路步骤 5：运行时模板模拟遍探针。
// A) 发包→页面：含 chains 的包生成的页面脚本可解析且含模拟遍/
//    玩家时钟/hardRelockTo。
// B) 行为对拍——从模板源码抽出模拟段本体（非抄写），以桩全局
//    驱动：与编辑器 stepChainSim + chainLocalAngleDeltas 在同一
//    参考关节序列下逐位对拍（坐标换算：运行时 y 向上 = 编辑器
//    y 向下取负，角增量同理取负、度→弧度）。
// 跑法：bun scripts/verify-sim-runtime.mts
// ============================================================
import { readFileSync } from 'node:fs';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { buildRuntimeHtml } from '../src/lib/proc-runtime/runtime-template';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import {
  createChainSimState, stepChainSim, chainLocalAngleDeltas, defaultChainBakeParams,
} from '../src/lib/sim/verlet-chain';
import {
  pxToSub, type Character, type Node as UnifiedNode,
} from '../src/lib/unified-types';

let fails = 0;
let total = 0;
const ok = (c: boolean, m: string) => { total++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------- A) 页面 ----------
{
  const mk = (id: string, parentId?: string, yOff = 0): UnifiedNode => ({
    id, name: id, parentId, role: 'bone', slot: { slotKey: id },
    transform: { x: 0, y: pxToSub(yOff), angle: 0, variantIndex: 6, stretch: 1 },
    attachment: { type: 'fixed' }, sockets: [], tracks: {}, modifiers: [],
    children: [], sprite: undefined as never,
  } as unknown as UnifiedNode);
  const torso = mk('torso'); const ra = mk('ra', 'torso', 20); const rb = mk('rb', 'ra', 18);
  torso.children = ['ra']; ra.children = ['rb'];
  torso.tracks = {
    x: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: pxToSub(30) }] },
  } as never;
  const piece = (nodeId: string) => ({ nodeId, zIndex: 0, parametric: createDefaultParametricAppearance() }) as never;
  const ch = {
    id: 'sr1', name: '运行时模拟页测试',
    nodes: { torso, ra, rb }, rootNodeId: 'torso', rootNodeIds: ['torso'], sprites: {},
    costumeSets: [{ id: 'set1', name: '默认', pieces: { torso: piece('torso'), ra: piece('ra'), rb: piece('rb') } }],
    activeCostumeSetId: 'set1', variants: { '0': '东', '2': '西' },
    chainSims: { ra: { chainNodeIds: ['ra', 'rb'], params: defaultChainBakeParams() } },
    chainModes: { ra: 'realtime' },
  } as unknown as Character;
  const pkg = convertCharacterToRuntimePackage(ch, undefined, { frameRate: 12, totalFrames: 10 });
  ok(!!pkg.chains && pkg.chains.length === 1, 'A0 前置：包内含一条 chains');
  const html = buildRuntimeHtml(pkg);
  ok(html.includes('runSimPass') && html.includes('simStepChain'), 'A1 生成页含模拟遍');
  ok(html.includes('window.hardRelockTo') && html.includes('__simHost') && html.includes('audioPositionMs'), 'A2 生成页含玩家时钟与宿主接口（window.hardRelockTo/window.__simHost.audioPositionMs）');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let parseOk = scripts.length > 0;
  for (const sc of scripts) { try { new Function(sc); } catch { parseOk = false; } }
  ok(parseOk, 'A3 生成页脚本可解析（语法）');
}

// ---------- B) 模拟遍对拍（落位前 pose 版） ----------
{
  const src = readFileSync(new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url), 'utf8');
  const i = src.indexOf('// ---- 链摆实时模拟（运行时');
  const j = src.indexOf('// ---- 钳制锚定（运行时');
  ok(i > 0 && j > i, 'B0 模板含模拟段');
  const seg = src.slice(i, j);
  // partCenter 本体一并抽出（遍内组装与回写复算都用它）
  const pcStart = src.indexOf('function partCenter');
  const pcEnd = src.indexOf('\n}', pcStart) + 3;
  ok(pcStart > 0 && pcEnd > pcStart, 'B0b 模板含 partCenter');
  const partCenterSrc = src.slice(pcStart, pcEnd);
  const params = defaultChainBakeParams();
  const FR = 12;
  const chains = [
    { nodeId: 'chainA', root: 'A', nodes: ['A', 'B', 'C'], params },
    { nodeId: 'chainBad', root: 'A', nodes: ['A', 'ZZ'], params },
  ];
  const PARTS = [
    { key: 'A', base: { pivot: [0, 100], off: [0, 0], restRot: 0 } },
    { key: 'B', base: { pivot: [0, 80], off: [0, 0], restRot: 0 } },
    { key: 'C', base: { pivot: [0, 62], off: [0, 0], restRot: 0 } },
  ];
  const charStub = { x: 0, y: 0, py: 0, variant: 0 };
  const rt = new Function(
    'SIM_CHAINS', 'FRAME_RATE', 'PARTS', 'COSTUMES', 'currentCostume', 'char', 'charOriginY', 'resolvePart',
    `
    ${partCenterSrc}
    ${seg}
    return { runSimPass, simStates, partCenter };
    `,
  )(chains, FR, PARTS, { '': {} }, '', charStub, () => 0,
    (part: { base: unknown }) => ({ params: part.base })) as {
    runSimPass: (pose: Record<string, { a: number; dx?: number; dy: number }>, steps: number) => void;
    simStates: Map<string, { pts: Array<{ x: number; y: number; px: number; py: number }> }>;
    partCenter: (p: { pivot: [number, number]; off: [number, number] }, an: { a: number; dx?: number; dy?: number }) => [number, number];
  };

  // pose 驱动：链根部件逐帧横摆（pose.dx），其余静止——参考关节 =
  // partCenter(pose 组装)，与旧对拍同一几何（根 [sin·12,100] 起垂链）
  const poseAt = (f: number) => ({
    A: { a: 0, dx: Math.sin(f * 0.3) * 12, dy: 0 },
    B: { a: 0, dx: 0, dy: 0 },
    C: { a: 0, dx: 0, dy: 0 },
  });
  const refAt = (f: number): [number, number][] => {
    const pose = poseAt(f);
    return PARTS.map((part) => rt.partCenter(part.base, {
      a: pose[part.key as 'A'].a + part.base.restRot, dx: pose[part.key as 'A'].dx, dy: pose[part.key as 'A'].dy,
    }));
  };
  const toCanvas = (p: [number, number]) => ({ x: p[0], y: -p[1] });

  // steps=0：不播种、不回写
  {
    const pose = poseAt(0);
    rt.runSimPass(pose, 0);
    ok(rt.simStates.size === 0 && pose.A.dx === Math.sin(0) * 12, 'B1 steps=0 时模拟遍不介入');
  }

  // 首帧播种：状态以当帧参考关节零初速现建，同帧步进为同位步进
  // （pin/段长即当帧值）→ 状态不变、pose 不变
  {
    const pose = poseAt(0);
    rt.runSimPass(pose, 1);
    const st = rt.simStates.get('chainA');
    const ref = refAt(0);
    ok(!!st && st.pts.every((p, k) => p.x === ref[k][0] && p.y === ref[k][1] && p.px === p.x && p.py === p.y),
      'B2 播种：状态以当帧参考关节零初速现建（键 = 链根 nodeId）');
    ok(pose.A.a === 0 && pose.B.a === 0 && pose.C.a === 0, 'B3 播种帧 pose 角增量为 0');
    ok(!rt.simStates.has('chainBad'), 'B4 含不存在部件的链整链跳过、不建状态');
  }

  // 顺序步进 30 帧对拍：状态逐位 + pose.a 增量 + 回写后中心落点
  {
    rt.simStates.clear();
    const ed = createChainSimState(refAt(0).map(toCanvas));
    let worstPt = 0; let worstRot = 0; let worstCtr = 0;
    for (let f = 0; f <= 30; f++) {
      const pose = poseAt(f);
      const aBefore = { A: pose.A.a, B: pose.B.a, C: pose.C.a };
      rt.runSimPass(pose, 1);
      const cref = refAt(f).map(toCanvas);
      if (f > 0) {
        const lens = cref.slice(0, -1).map((p, k) => Math.hypot(cref[k + 1].x - p.x, cref[k + 1].y - p.y));
        stepChainSim(ed, cref[0], lens, params, FR);
        const locals = chainLocalAngleDeltas(ed.pts.map((p) => ({ x: p.x, y: p.y })), cref);
        (['A', 'B', 'C'] as const).forEach((k, idx) => {
          worstRot = Math.max(worstRot, Math.abs((pose[k].a - aBefore[k]) - (-locals[idx] * Math.PI / 180)));
        });
      }
      const st = rt.simStates.get('chainA')!;
      st.pts.forEach((p, k) => {
        worstPt = Math.max(worstPt, Math.abs(p.x - ed.pts[k].x), Math.abs(p.y - (-ed.pts[k].y)),
          Math.abs(p.px - ed.pts[k].px), Math.abs(p.py - (-ed.pts[k].py)));
      });
      // 回写后：以落位同式复算中心，应恰落解出关节位
      (['A', 'B', 'C'] as const).forEach((k, idx) => {
        const part = PARTS[idx];
        const c = rt.partCenter(part.base, { a: pose[k].a + part.base.restRot, dx: pose[k].dx, dy: pose[k].dy });
        worstCtr = Math.max(worstCtr, Math.abs(c[0] - st.pts[idx].x), Math.abs(c[1] - st.pts[idx].y));
      });
    }
    console.log(`    [B5] 30 帧关节位（含速度分量）最大偏差 ${worstPt.toExponential(2)}，pose 角增量偏差 ${worstRot.toExponential(2)} rad，回写中心落点偏差 ${worstCtr.toExponential(2)}`);
    ok(worstPt < 1e-9, 'B5 模板步进器与编辑器 stepChainSim 逐位一致（含 px/py）');
    ok(worstRot < 1e-9, 'B6 pose.a 增量与 chainLocalAngleDeltas 同式一致（取负+弧度）');
    ok(worstCtr < 1e-9, 'B7 回写后 partCenter 复算中心恰落解出关节位（dx/dy 补差）');
  }
}

console.log(fails === 0 ? `\n全部 ${total} 条断言通过` : `\n${fails}/${total} 条断言失败`);
process.exit(fails === 0 ? 0 : 1);
