// 全局蓝图合并/拆分保真验收探针
// 覆盖：
//  基线）两部件（同名节点/同名参数/连线/字面值/followMode/带与不带 ui）
//        merge→split 往返逐字段全等；唯一已知字段新增单独钉住：
//        原本无 ui 的节点往返后多出 {x:20,y:20}（合并时按组偏移+20 落点、
//        拆分减回组偏移后的残留），不混进全等断言假装无损
//  1) 删输出节点：outputId 回落该部件第一个 transform 节点；
//     transform 删光则 outputId 置空（undefined）、其余节点保留
//  2) 某部件节点删光：split 结果里不再有该部件（编辑器保存据此写清除，
//     保存遍历口径以源码断言钉住）
//  3) 全局语境未选部件时加节点被拦（源码断言：BlueprintEditor 的
//     requireIdPrefix 门控 + GlobalBlueprintEditor 传参）
//  5) 编辑期间部件重排：按打开快照 partOrder 拆分则 ui 不漂；
//     不传快照的对照组必须漂移（证明用例可判别）
//  6) 部件 id 含 '__'：最长前缀匹配归属（'x__y' 的节点不落进 'x'）

import { readFileSync } from 'node:fs';
import { mergeBlueprints, splitBlueprints } from '../src/lib/blueprint/global';
import type { BlueprintGraph, BlueprintNode } from '../src/lib/blueprint/ir';
import type { Character } from '../src/lib/unified-types';

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗ FAIL:', msg); }
};

/** 键序无关的稳定序列化（undefined 值按 JSON 规则丢弃） */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    }
    return val;
  });

const bn = (
  id: string,
  type: string,
  opts?: { inputs?: BlueprintNode['inputs']; params?: BlueprintNode['params']; ui?: { x: number; y: number } },
): BlueprintNode => ({
  id,
  type,
  inputs: opts?.inputs ?? {},
  params: opts?.params ?? {},
  ...(opts?.ui ? { ui: opts.ui } : {}),
});

/** 基线夹具：arm(idx0) + leg(idx1)，同名节点 n1/out、同名参数 k、各自内部连线 */
function baselineCharacter(): Character {
  const armBp: BlueprintGraph = {
    version: 1,
    followMode: 'same',
    outputId: 'out',
    nodes: [
      bn('src', 'const', { params: { value: 3 }, ui: { x: 10, y: 10 } }),
      bn('n1', 'add', {
        inputs: { a: { nodeId: 'src', output: 'value' } },
        params: { k: 'shared', scale: 2 },
        ui: { x: 50, y: 60 },
      }),
      bn('out', 'transform', { inputs: { in: { nodeId: 'n1' } } }), // 无 ui
    ],
  };
  const legBp: BlueprintGraph = {
    version: 1,
    outputId: 'out',
    nodes: [
      bn('n1', 'add', { params: { k: 'shared', scale: 5 }, ui: { x: 1, y: 2 } }),
      bn('mid', 'transform', { inputs: { in: { nodeId: 'n1' } }, ui: { x: 30, y: 30 } }),
      bn('out', 'transform', { inputs: { in: { nodeId: 'mid' } }, params: { w: 'x' } }), // 无 ui
    ],
  };
  return {
    nodes: {
      arm: { id: 'arm', blueprint: armBp },
      leg: { id: 'leg', blueprint: legBp },
    },
  } as unknown as Character;
}

/**
 * 往返全等比较：原本无 ui 的节点，往返后必须恰好多出 {x:20,y:20}
 * （单独断言），摘掉这处已知新增后其余逐字段全等。
 */
function assertRoundtripEqual(orig: BlueprintGraph, rt: BlueprintGraph | undefined, label: string) {
  ok(!!rt, `${label}：拆回结果存在`);
  if (!rt) return;
  const rtClone = JSON.parse(JSON.stringify(rt)) as BlueprintGraph;
  for (const origNode of orig.nodes) {
    if (origNode.ui !== undefined) continue;
    const rtNode = rtClone.nodes.find((n) => n.id === origNode.id);
    ok(
      !!rtNode && stable(rtNode.ui) === stable({ x: 20, y: 20 }),
      `${label}：无 ui 节点 ${origNode.id} 往返后恰多出 ui {x:20,y:20}（已知字段新增，单独钉住）`,
    );
    if (rtNode) delete rtNode.ui;
  }
  ok(stable(rtClone) === stable(orig), `${label}：除已知 ui 新增外逐字段全等`);
}

// ---------- 基线往返 ----------
{
  const ch = baselineCharacter();
  const m = mergeBlueprints(ch);
  ok(stable(m.partIds) === stable(['arm', 'leg']), '基线：merge partIds = 打开时有蓝图的部件清单 [arm, leg]');
  ok(stable(m.partOrder) === stable(['arm', 'leg']), '基线：merge partOrder = 打开时部件顺序快照');
  ok(m.followMap.get('arm') === 'same' && !m.followMap.has('leg'), '基线：followMap 只记有值的部件（arm=same、leg 无）');
  const s = splitBlueprints(m.graph, ch, m.outputMap, { partOrder: m.partOrder, followMap: m.followMap });
  const armOrig = (ch.nodes as any).arm.blueprint as BlueprintGraph;
  const legOrig = (ch.nodes as any).leg.blueprint as BlueprintGraph;
  assertRoundtripEqual(armOrig, s.get('arm'), '基线 arm');
  assertRoundtripEqual(legOrig, s.get('leg'), '基线 leg');
  ok(s.get('arm')!.followMode === 'same', '基线：arm 的 followMode=same 保住');
  ok(!('followMode' in (s.get('leg') as any)), '基线：leg 往返后不被塞 followMode 键');
}

// ---------- 1) 删输出节点 ----------
{
  const ch = baselineCharacter();
  const m = mergeBlueprints(ch);
  // leg 删输出节点 out（还剩 transform 节点 mid）→ 回落 mid
  const g1: BlueprintGraph = { ...m.graph, nodes: m.graph.nodes.filter((n) => n.id !== 'leg__out') };
  const s1 = splitBlueprints(g1, ch, m.outputMap, { partOrder: m.partOrder, followMap: m.followMap });
  ok(s1.get('leg')!.outputId === 'mid', '删输出：leg 的 outputId 回落第一个 transform 节点 mid');
  ok(s1.get('leg')!.nodes.length === 2, '删输出：leg 其余节点保留');
  // arm 删输出节点 out（transform 删光）→ outputId 置空、节点保留
  const g2: BlueprintGraph = { ...m.graph, nodes: m.graph.nodes.filter((n) => n.id !== 'arm__out') };
  const s2 = splitBlueprints(g2, ch, m.outputMap, { partOrder: m.partOrder, followMap: m.followMap });
  const armRt = s2.get('arm');
  ok(!!armRt && armRt.nodes.length === 2, '删输出：arm transform 删光后图仍在、其余节点保留');
  ok(armRt!.outputId === undefined, '删输出：arm 无 transform 节点时 outputId 置空（undefined），不悬空指向已删节点');
}

// ---------- 2) 部件删光 → split 无此部件 + 编辑器保存口径（源码断言） ----------
{
  const ch = baselineCharacter();
  const m = mergeBlueprints(ch);
  const g: BlueprintGraph = { ...m.graph, nodes: m.graph.nodes.filter((n) => !n.id.startsWith('leg__')) };
  const s = splitBlueprints(g, ch, m.outputMap, { partOrder: m.partOrder, followMap: m.followMap });
  ok(!s.has('leg') && s.has('arm'), '删光部件：split 结果不再含 leg（编辑器据此对 leg 写清除）');

  const editorSrc = readFileSync(
    new URL('../src/components/pixel-editor/puppet/GlobalBlueprintEditor.tsx', import.meta.url),
    'utf8',
  );
  ok(editorSrc.includes('setOpenPartIds(result.partIds)'), '源码：打开时把合并部件清单存入快照 state');
  ok(
    /\[\.\.\.openPartIds, \.\.\.split\.keys\(\)\]/.test(editorSrc),
    '源码：保存遍历 = 打开清单 ∪ 拆回结果（删光的写清除、新建的写回）',
  );
  ok(
    /blueprint: split\.get\(puppetNodeId\)/.test(editorSrc),
    '源码：保存按 split.get 写回（清单内无拆回结果即写 undefined 清除）',
  );
  ok(
    /splitBlueprints\(mergedGraph, character, outputMap, \{\s*partOrder: openPartOrder,\s*followMap,?\s*\}\)/.test(editorSrc),
    '源码：保存时把打开快照 partOrder 与 followMap 传给 split',
  );
}

// ---------- 3) 未选部件加节点被拦（源码断言） ----------
{
  const beSrc = readFileSync(
    new URL('../src/components/pixel-editor/puppet/BlueprintEditor.tsx', import.meta.url),
    'utf8',
  );
  const geSrc = readFileSync(
    new URL('../src/components/pixel-editor/puppet/GlobalBlueprintEditor.tsx', import.meta.url),
    'utf8',
  );
  ok(beSrc.includes('requireIdPrefix?: boolean'), '源码：BlueprintEditor 有 requireIdPrefix 语境开关');
  ok(!beSrc.includes('!!idPrefix && !idPrefix'), '源码：恒假的旧 disabled 表达式已消失');
  ok(beSrc.includes('disabled={addBlocked}'), '源码：添加按钮 disabled 真正由 addBlocked 决定');
  ok(
    (beSrc.match(/if \(addBlocked\) return;/g) ?? []).length >= 2,
    '源码：addNode 与 insertChainPreset 两处入口都有 addBlocked 拦截',
  );
  ok(beSrc.includes('先选中一个部件再加节点'), '源码：未选部件时有「先选中一个部件再加节点」提示');
  ok(
    beSrc.includes('!idPrefix && !requireIdPrefix'),
    '源码：链预设行在全局语境下整体隐藏（不再只看 idPrefix）',
  );
  ok(/<BlueprintEditor[\s\S]*?requireIdPrefix/.test(geSrc), '源码：GlobalBlueprintEditor 向 BlueprintEditor 传 requireIdPrefix');
}

// ---------- 5) 重排后 ui 不漂 ----------
{
  const ch = baselineCharacter();
  const m = mergeBlueprints(ch);
  // 保存时刻的 character：部件顺序被别处重排（leg 在前、arm 在后）
  const reordered = {
    nodes: {
      leg: (ch.nodes as any).leg,
      arm: (ch.nodes as any).arm,
    },
  } as unknown as Character;
  const s = splitBlueprints(m.graph, reordered, m.outputMap, { partOrder: m.partOrder, followMap: m.followMap });
  const armN1 = s.get('arm')!.nodes.find((n) => n.id === 'n1');
  const legN1 = s.get('leg')!.nodes.find((n) => n.id === 'n1');
  ok(stable(armN1?.ui) === stable({ x: 50, y: 60 }), '重排：传打开快照时 arm.n1 的 ui 不漂（仍 {50,60}）');
  ok(stable(legN1?.ui) === stable({ x: 1, y: 2 }), '重排：传打开快照时 leg.n1 的 ui 不漂（仍 {1,2}）');
  // 对照组：不传快照、按保存时刻顺序拆 → 必须漂移（证明判别力）
  const sDrift = splitBlueprints(m.graph, reordered, m.outputMap);
  const armN1Drift = sDrift.get('arm')!.nodes.find((n) => n.id === 'n1');
  ok(stable(armN1Drift?.ui) !== stable({ x: 50, y: 60 }), '重排对照：不传快照时 arm.n1 的 ui 确实漂移（用例可判别）');
}

// ---------- 6) 部件 id 含 '__' ----------
{
  const xBp: BlueprintGraph = {
    version: 1,
    outputId: 'out',
    nodes: [
      bn('a1', 'const', { params: { v: 1 }, ui: { x: 3, y: 3 } }),
      bn('out', 'transform', { inputs: { in: { nodeId: 'a1' } }, ui: { x: 9, y: 9 } }),
    ],
  };
  const xyBp: BlueprintGraph = {
    version: 1,
    outputId: 'out',
    nodes: [
      bn('n1', 'const', { params: { v: 2 }, ui: { x: 4, y: 4 } }),
      bn('out', 'transform', { inputs: { in: { nodeId: 'n1' } }, ui: { x: 8, y: 8 } }),
    ],
  };
  const ch = {
    nodes: {
      x: { id: 'x', blueprint: xBp },
      x__y: { id: 'x__y', blueprint: xyBp },
    },
  } as unknown as Character;
  const m = mergeBlueprints(ch);
  const s = splitBlueprints(m.graph, ch, m.outputMap, { partOrder: m.partOrder, followMap: m.followMap });
  ok(
    stable(s.get('x__y')!.nodes.map((n) => n.id).sort()) === stable(['n1', 'out']),
    "含'__'：x__y 的节点按最长前缀归属回 x__y（n1/out）",
  );
  ok(
    stable(s.get('x')!.nodes.map((n) => n.id).sort()) === stable(['a1', 'out']),
    "含'__'：x 只拿回自己的节点（a1/out），没有被塞进 y__n1 一类错位 id",
  );
  ok(s.get('x__y')!.outputId === 'out' && s.get('x')!.outputId === 'out', "含'__'：两部件 outputId 各自还原");
  ok(stable(s.get('x__y')) === stable(xyBp), "含'__'：x__y 往返逐字段全等");
  ok(stable(s.get('x')) === stable(xBp), "含'__'：x 往返逐字段全等");
}

console.log(`\nverify-global-blueprint-roundtrip: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
