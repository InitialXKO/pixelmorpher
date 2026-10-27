// ============================================================
// 链预设探针（甲4）：
// L 组 — 库：三款内置链条目在册、def 合法、表面展开不掺链。
// I 组 — 插入：结构接线（@in/@time 哨兵落地、screen 改接段出口）；
//   插入后编辑器求值与进包像素链求值逐格一致且确实改变画面。
// K 组 — 打包：插入的段打包回来再插入，输出与原插入一致；
//   非像素节点/含范围外节点的链点名拒绝。
// M 组 — 修改器化：三款落 ring_ripple 参数（包络峰值）；
//   多像素节点链返回 undefined。
// ============================================================
import { evaluateBlueprint } from '../src/lib/blueprint/eval';
import { createPixelRuntime } from '../src/lib/proc-runtime/pixel-src';
import { extractPixelGraph } from '../src/lib/proc-runtime/graph-translate';
import {
  BUILTIN_ENTRIES, BUILTIN_INDEX, chainDefOf, chainEntriesOf, refsOfDef, surfaceLibEntriesOf,
  type ChainEntryDef,
} from '../src/lib/library-entries';
import {
  chainDefToModifierParams, chainDefUnsupportedType, insertChainSegment, packChainSegment,
} from '../src/lib/blueprint/chain-presets';

let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; return; }
  fail++; fails.push(name + (extra ? ' — ' + extra : ''));
}

function fixtureGrid(): (string | null)[][] {
  const W = 14, H = 12;
  const g: (string | null)[][] = Array.from({ length: H }, () => Array(W).fill(null));
  const cols = ['#cc3333', '#3366cc', '#33aa55', '#ddaa22'];
  for (let y = 2; y < 10; y++) {
    for (let x = 2; x < 12; x++) {
      if ((x === 2 || x === 11) && (y === 2 || y === 9)) continue;
      g[y][x] = cols[(x + y) % 4];
    }
  }
  return g;
}
function norm(g: (string | null)[][] | null | undefined): string {
  if (!g) return '<null>';
  return g.map((row) => row.map((c) => (c ? c.toLowerCase() : '.')).join(' ')).join('\n');
}

function baseGraph(withTime = true): any {
  const nodes: any[] = [];
  if (withTime) nodes.push({ id: 'time1', type: 'time', inputs: {}, params: {} });
  nodes.push({ id: 'src', type: 'sprite_source', inputs: {}, params: {} });
  nodes.push({ id: 'scr', type: 'screen', inputs: { pixels: { nodeId: 'src', output: 'pixels' } }, params: {} });
  return { version: 1, nodes, outputId: 'scr' };
}

function editorEval(graph: any, frame: number): (string | null)[][] | null {
  let captured: (string | null)[][] | null | undefined;
  evaluateBlueprint(graph as never, {
    frame, frameRate: 12, vars: {},
    spritePixels: fixtureGrid(),
    drawToScreen: (cmd: { pixels: (string | null)[][] }) => { captured = cmd.pixels; },
  } as never);
  return captured === undefined ? null : captured;
}

function twinEval(graph: any, frame: number): (string | null)[][] | null {
  const ext = extractPixelGraph(graph as never);
  if (!ext.graph) return null;
  const rt = createPixelRuntime();
  return rt.evalPixelChain(ext.graph.nodes as never, ext.graph.out, {
    pixels: fixtureGrid(), frame, frameRate: 12,
  } as never);
}

// ---------------- L 组：库 ----------------
const chains = chainEntriesOf(BUILTIN_ENTRIES);
check('L1 内置链条目恰三款', chains.length === 3, `got ${chains.length}`);
const expectIds = ['chain-heavy-ring', 'chain-shock-ring', 'chain-shield-ring'];
for (const id of expectIds) {
  const got = chainDefOf(BUILTIN_INDEX, id);
  check(`L2 ${id} 在册`, !!got);
  if (!got) continue;
  check(`L3 ${id} 类型全支持`, chainDefUnsupportedType(got.def) === undefined,
    chainDefUnsupportedType(got.def));
  const entry = got.def.nodes.find((n) => n.id === got.def.entry);
  check(`L4 ${id} 出口是 ring_ripple`, entry?.type === 'ring_ripple');
  check(`L5 ${id} 有参数口`, got.def.expose.length >= 3);
  check(`L6 ${id} 无库内引用`, refsOfDef(got.def).length === 0);
}
check('L7 表面展开不含链条目',
  surfaceLibEntriesOf(BUILTIN_ENTRIES).every((e) => !expectIds.includes(e.id.replace(/@\d+$/, ''))));

// ---------------- I 组：插入 ----------------
for (const id of expectIds) {
  const def = chainDefOf(BUILTIN_INDEX, id)!.def;
  const res = insertChainSegment(baseGraph(), def, 'pre');
  check(`I1 ${id} 插入成功`, res.ok, res.ok ? '' : res.error);
  if (!res.ok) continue;
  const g = res.graph as any;
  const scr = g.nodes.find((n: any) => n.id === 'scr');
  const ring = g.nodes.find((n: any) => n.id === 'pre_ring');
  const env = g.nodes.find((n: any) => n.id === 'pre_env');
  check(`I2 ${id} screen 改接段出口`, scr.inputs.pixels?.nodeId === 'pre_ring');
  check(`I3 ${id} 段入口接原像素源`, ring?.inputs.pixels?.nodeId === 'src');
  check(`I4 ${id} 包络接时间节点`, env?.inputs.t?.nodeId === 'time1');
  check(`I5 ${id} 振幅接包络`, ring?.inputs.amplitude?.nodeId === 'pre_env');
  for (const frame of [0, 5, 16]) {
    const a = editorEval(g, frame);
    const b = twinEval(g, frame);
    check(`I6 ${id} 编辑器/进包对拍 f${frame}`, norm(a) === norm(b));
  }
  const at0 = editorEval(g, 0);
  check(`I7 ${id} 首帧确实改变画面`, norm(at0) !== norm(fixtureGrid()));
}
// 无时间节点的图：自动补
{
  const def = chainDefOf(BUILTIN_INDEX, 'chain-shield-ring')!.def;
  const res = insertChainSegment(baseGraph(false), def, 'pre');
  check('I8 无时间节点自动补', res.ok && (res.graph as any).nodes.some((n: any) => n.type === 'time'),
    res.ok ? '' : res.error);
  if (res.ok) {
    const a = editorEval(res.graph as any, 4);
    const b = twinEval(res.graph as any, 4);
    check('I9 补时间后对拍', norm(a) === norm(b));
  }
}
// 插入失败路径
{
  const badDef: ChainEntryDef = {
    kind: 'chain', entry: 'x', expose: [],
    nodes: [{ id: 'x', type: 'texture_scroll', inputs: { pixels: { nodeId: '@in', output: 'pixels' } }, params: {} }],
  };
  const r1 = insertChainSegment(baseGraph(), badDef, 'p');
  check('I10 不支持类型点名拒绝', !r1.ok && r1.error.includes('texture_scroll'), r1.ok ? '' : r1.error);
  const noScreen: any = { version: 1, nodes: [{ id: 'src', type: 'sprite_source', inputs: {}, params: {} }], outputId: 'src' };
  const r2 = insertChainSegment(noScreen, chainDefOf(BUILTIN_INDEX, 'chain-heavy-ring')!.def, 'p');
  check('I11 无 screen 点名拒绝', !r2.ok && r2.error.includes('screen'), r2.ok ? '' : r2.error);
}

// ---------------- K 组：打包 ----------------
{
  const def = chainDefOf(BUILTIN_INDEX, 'chain-heavy-ring')!.def;
  const ins = insertChainSegment(baseGraph(), def, 'pre');
  check('K0 前置插入', ins.ok);
  if (ins.ok) {
    const packed = packChainSegment(ins.graph as never, 'pre_ring');
    check('K1 打包成功', packed.ok, packed.ok ? '' : packed.error);
    if (packed.ok) {
      check('K2 打包 def 类型合法', chainDefUnsupportedType(packed.def) === undefined);
      const head = packed.def.nodes.find((n) => n.id === 'pre_ring');
      check('K3 链头折 @in', (head?.inputs.pixels as any)?.nodeId === '@in');
      const envN = packed.def.nodes.find((n) => n.type === 'waveform');
      check('K4 时间折 @time', (envN?.inputs.t as any)?.nodeId === '@time');
      const reins = insertChainSegment(baseGraph(), packed.def, 're');
      check('K5 打包 def 可再插入', reins.ok, reins.ok ? '' : reins.error);
      if (reins.ok) {
        for (const frame of [0, 5]) {
          check(`K6 再插入输出一致 f${frame}`,
            norm(editorEval(reins.graph as any, frame)) === norm(editorEval(ins.graph as any, frame)));
        }
      }
    }
    const fromScreen = packChainSegment(ins.graph as never, 'scr');
    check('K7 从 screen 打包被拒', !fromScreen.ok);
    // 范围外节点链
    const badGraph: any = baseGraph();
    badGraph.nodes.push({ id: 'ts', type: 'texture_scroll', inputs: { pixels: { nodeId: 'src', output: 'pixels' } }, params: {} });
    badGraph.nodes.find((n: any) => n.id === 'scr').inputs.pixels = { nodeId: 'ts', output: 'pixels' };
    const badPack = packChainSegment(badGraph, 'ts');
    check('K8 范围外节点点名拒绝', !badPack.ok && badPack.error.includes('texture_scroll'),
      badPack.ok ? '' : badPack.error);
  }
}

// ---------------- M 组：修改器化 ----------------
{
  const peaks: Record<string, number> = { 'chain-heavy-ring': 6, 'chain-shock-ring': 7, 'chain-shield-ring': 2.3 };
  for (const id of expectIds) {
    const mod = chainDefToModifierParams(chainDefOf(BUILTIN_INDEX, id)!.def);
    check(`M1 ${id} 可落修改器`, !!mod && mod.type === 'ring_ripple');
    check(`M2 ${id} 振幅取包络峰值`, Math.abs(Number(mod?.params.amplitude) - peaks[id]!) < 1e-9,
      `got ${String(mod?.params.amplitude)}`);
  }
  const twoPixel: ChainEntryDef = {
    kind: 'chain', entry: 'b', expose: [],
    nodes: [
      { id: 'a', type: 'outline', inputs: { pixels: { nodeId: '@in', output: 'pixels' } }, params: {} },
      { id: 'b', type: 'ring_ripple', inputs: { pixels: { nodeId: 'a', output: 'pixels' } }, params: { amplitude: 2 } },
    ],
  };
  check('M3 多像素节点链不落修改器', chainDefToModifierParams(twoPixel) === undefined);
}

console.log(`合计：${pass} 过 / ${fail} 败`);
if (fails.length > 0) {
  console.log(fails.map((f) => '  ✗ ' + f).join('\n'));
  process.exit(1);
}
