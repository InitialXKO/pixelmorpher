// 验证：片段统一（甲案）——片段结构迁移 + 轨道附件轨插值 + 时间窗门控 + 静态清零
// A) 归属补绑（单角色/多角色/悬空/无角色）  B) 时间窗换算与幂等
// C) 主片段修饰器/转面/zIndex 迁轨（姿态值不迁）  D) 非主片段活数据不迁+计数
// E) 幻影字段清理  F) 附件轨插值（faceTurn lerp / zIndex step / 修饰器点间插值与旧规则等值）
// G) pickClipStateKeyframes 时间窗门控  H) 静态断言（nodeKeyframes/UnifiedAnimationClip 清零）
import { migrateClipStructure } from '../src/lib/clip-migration';
import { interpolateNodeKeyframes, interpolateModifierPoints, interpolateNodeKeyframeModifiers } from '../src/lib/engine/render-helpers/puppet-keyframe-interpolation';
import { pickClipStateKeyframes } from '../src/lib/unified-render';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) fail++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function mkChar(id: string, nodeIds: string[]): any {
  const nodes: Record<string, any> = {};
  for (const nid of nodeIds) {
    nodes[nid] = {
      id: nid, name: nid, parentId: null, children: [],
      transform: { x: 0, y: 0, z: 0, angle: 0, stretch: 1, scaleX: 1, variantIndex: 6 },
      tracks: {}, modifiers: [], sockets: [], attachment: { type: 'root' },
      drawLayer: 'default', visible: true, zIndex: 1,
    };
  }
  return { id, name: id, rootNodeId: nodeIds[0], nodes };
}

// ---------- A/B/C/D/E：迁移 ----------
{
  const chars = { cA: mkChar('cA', ['n1', 'n2']) };
  const pendulum: any = { id: 'm1', type: 'pendulum', enabled: true, params: { period: 16, amplitude: 30 } };
  const clips: any[] = [
    {
      id: 'clipMain', name: '主片段', frameRate: 8, totalFrames: 16, // 无归属 → 补绑唯一角色
      nodeKeyframes: [
        { id: 'k1', nodeId: 'n1', frame: 4, angle: 45, x: 99, modifiers: [pendulum], faceTurn: { yaw: 20, pitch: 5 }, zIndex: 7 },
        { id: 'k2', nodeId: 'n2', frame: 8, modifiers: [{ id: 'm2', type: 'breath', enabled: true, params: { period: 48 } }] },
        { id: 'k3', nodeId: 'ghost', frame: 2, modifiers: [{ id: 'm3', type: 'breath', enabled: true, params: {} }], zIndex: 2 },
      ],
      puppetNodeKeyframes: [{ id: 'phantom', nodeId: 'n1', frame: 0 }],
      stateKeyframes: [{ frame: 3, costumeSetId: 'set1' }],
    },
    {
      id: 'clipSub', name: '副片段', frameRate: 12, totalFrames: 24, puppetCharacterId: 'cA',
      nodeKeyframes: [
        { id: 'k9', nodeId: 'n1', frame: 6, modifiers: [{ id: 'm9', type: 'wobble', enabled: true, params: {} }] },
      ],
    },
  ];
  const { clips: out, characters: outChars, report } = migrateClipStructure(clips, chars, { projectTotalFrames: 24, activeClipId: 'clipMain' });
  const main = out.find((c) => c.id === 'clipMain')!;
  const sub = out.find((c) => c.id === 'clipSub')!;

  check('A1 无主片段补绑唯一角色', main.puppetCharacterId === 'cA', main.puppetCharacterId);
  check('A2 补绑进报告', report.boundClips.some((b) => b.clipName === '主片段' && b.characterId === 'cA'));
  check('B1 窗由 totalFrames 换算', main.startFrame === 0 && main.endFrame === 15 && main.loop === false, `${main.startFrame}-${main.endFrame}`);
  check('B2 旧字段删除', !('frameRate' in main) && !('totalFrames' in main) && !('nodeKeyframes' in main));
  check('B3 状态键保留', eq(main.stateKeyframes, [{ frame: 3, costumeSetId: 'set1' }]));

  const n1 = outChars['cA'].nodes['n1'];
  const n2 = outChars['cA'].nodes['n2'];
  check('C1 修饰器迁入 modifierKeys', n1.tracks.modifierKeys?.keyframes.length === 1 && n1.tracks.modifierKeys.keyframes[0].frame === 4
    && n1.tracks.modifierKeys.keyframes[0].value[0].type === 'pendulum');
  check('C2 转面迁入 faceTurnKeys', eq(n1.tracks.faceTurnKeys?.keyframes[0]?.value, { yaw: 20, pitch: 5 }));
  check('C3 zIndex 迁入 zIndex 轨', n1.tracks.zIndex?.keyframes[0]?.value === 7);
  check('C4 姿态值不迁（无 angle/x 点）', !n1.tracks.angle && !n1.tracks.x);
  check('C5 第二节点修饰器迁入', n2.tracks.modifierKeys?.keyframes[0]?.value[0]?.type === 'breath');
  check('C6 深拷贝（改原件不影响迁入值）', (() => { pendulum.params.amplitude = 999; return n1.tracks.modifierKeys.keyframes[0].value[0].params.amplitude === 30; })());
  check('D1 非主片段活数据不迁', !n1.tracks.modifierKeys.keyframes.some((k: any) => k.frame === 6));
  check('D2 非主片段计数进报告', report.dropped.some((d) => d.clipName === '副片段' && d.modifiers === 1), JSON.stringify(report.dropped));
  check('D3 指向不存在节点的点计数', report.dropped.some((d) => d.clipName === '主片段' && d.modifiers === 1 && d.zIndex === 1));
  check('E1 幻影字段清除+计数', !('puppetNodeKeyframes' in main) && report.phantomFieldsRemoved === 1);
  check('C7 迁轨计数', report.migratedPoints.modifierKeys === 2 && report.migratedPoints.faceTurnKeys === 1 && report.migratedPoints.zIndexKeys === 1,
    JSON.stringify(report.migratedPoints));

  // 幂等：对迁移结果再跑一遍
  const again = migrateClipStructure(out as any[], outChars, { projectTotalFrames: 24, activeClipId: 'clipMain' });
  check('B4 幂等（片段形状不变）', eq(again.clips, out));
  check('B5 幂等（轨道点不重复）', again.characters['cA'].nodes['n1'].tracks.modifierKeys.keyframes.length === 1);
  check('B6 副片段形状', sub.startFrame === 0 && sub.endFrame === 23 && sub.puppetCharacterId === 'cA');
}

// A3 多角色无主 → 第一个 + 报告；A4 悬空 → 重绑
{
  const chars = { cA: mkChar('cA', ['n1']), cB: mkChar('cB', ['m1']) };
  const clips: any[] = [
    { id: 'x1', name: '无主', totalFrames: 10, nodeKeyframes: [] },
    { id: 'x2', name: '悬空', totalFrames: 10, puppetCharacterId: 'gone', nodeKeyframes: [] },
    { id: 'x3', name: '正常', totalFrames: 10, puppetCharacterId: 'cB', nodeKeyframes: [] },
  ];
  const { clips: out, report } = migrateClipStructure(clips, chars, { projectTotalFrames: 24, activeClipId: null });
  check('A3 多角色无主绑第一个', out[0].puppetCharacterId === 'cA', out[0].puppetCharacterId);
  check('A4 悬空归属重绑', out[1].puppetCharacterId === 'cA');
  check('A5 正常归属不动且不进报告', out[2].puppetCharacterId === 'cB' && !report.boundClips.some((b) => b.clipName === '正常'));
}

// ---------- F：附件轨插值 ----------
{
  const char = mkChar('cA', ['n1']);
  const node = char.nodes['n1'];
  node.tracks = {
    faceTurnKeys: { interpolation: 'linear', keyframes: [
      { frame: 0, value: { yaw: 0, pitch: 0 } },
      { frame: 10, value: { yaw: 90, pitch: 20 } },
    ] },
    zIndex: { interpolation: 'step', keyframes: [
      { frame: 5, value: 3 },
      { frame: 10, value: 7 },
    ] },
    modifierKeys: { interpolation: 'linear', keyframes: [
      { frame: 0, value: [{ id: 'a', type: 'pendulum', enabled: true, params: { amplitude: 0, period: 16 } }] },
      { frame: 10, value: [{ id: 'a', type: 'pendulum', enabled: true, params: { amplitude: 100, period: 16 } }] },
    ] },
  };
  const at5 = interpolateNodeKeyframes(char, 5).get('n1')!;
  check('F1 faceTurn 中点 lerp', at5.faceTurn?.yaw === 45 && at5.faceTurn?.pitch === 10, JSON.stringify(at5.faceTurn));
  check('F2 faceTurn 端点', interpolateNodeKeyframes(char, 0).get('n1')!.faceTurn?.yaw === 0
    && interpolateNodeKeyframes(char, 10).get('n1')!.faceTurn?.yaw === 90);
  check('F3 zIndex 点前回落静态', interpolateNodeKeyframes(char, 4).get('n1')!.zIndex === 1);
  check('F4 zIndex step 段内', interpolateNodeKeyframes(char, 5).get('n1')!.zIndex === 3 && interpolateNodeKeyframes(char, 9).get('n1')!.zIndex === 3);
  check('F5 zIndex step 切换', interpolateNodeKeyframes(char, 10).get('n1')!.zIndex === 7);

  // 修饰器点间插值与旧规则等值（同 type 参数 lerp）
  const direct = interpolateModifierPoints(
    [{ id: 'a', type: 'pendulum', enabled: true, params: { amplitude: 0, period: 16 } } as any],
    [{ id: 'a', type: 'pendulum', enabled: true, params: { amplitude: 100, period: 16 } } as any],
    0, 10, 5,
  );
  const legacy = interpolateNodeKeyframeModifiers(
    [{ id: 'a', type: 'pendulum', enabled: true, params: { amplitude: 0, period: 16 } } as any],
    [{ id: 'a', type: 'pendulum', enabled: true, params: { amplitude: 100, period: 16 } } as any],
    0.5,
  );
  check('F6 修饰器点插值=旧规则', eq(direct, legacy) && (direct[0].params as any).amplitude === 50, JSON.stringify(direct[0]?.params));
  // 单边淡出：只在 prev 有的修饰器在 t=0.5 半强度（数值 params ×0.5）
  const fade = interpolateModifierPoints(
    [{ id: 'a', type: 'pendulum', enabled: true, params: { amplitude: 80 } } as any], null, 0, 10, 5,
  );
  check('F7 单边点外推=prev 原样', (fade[0].params as any).amplitude === 80);
  const fade2 = interpolateNodeKeyframeModifiers(
    [{ id: 'a', type: 'pendulum', enabled: true, params: { amplitude: 80 } } as any], [], 0.5,
  );
  check('F8 旧规则单边淡出半强度', (fade2[0].params as any).amplitude === 40);
}

// ---------- G：时间窗门控 ----------
{
  const stateKfs = [{ frame: 5, costumeSetId: 's1' }] as any;
  const clips = [{ id: 'w', puppetCharacterId: 'cA', startFrame: 4, endFrame: 8, stateKeyframes: stateKfs }] as any;
  check('G1 窗前无贡献', pickClipStateKeyframes(clips, 'w', 'cA', 3) === undefined);
  check('G2 窗首有贡献', pickClipStateKeyframes(clips, 'w', 'cA', 4) === stateKfs);
  check('G3 窗尾有贡献', pickClipStateKeyframes(clips, 'w', 'cA', 8) === stateKfs);
  check('G4 窗后无贡献', pickClipStateKeyframes(clips, 'w', 'cA', 9) === undefined);
  check('G5 归属不符无贡献', pickClipStateKeyframes(clips, 'w', 'cB', 6) === undefined);
  check('G6 无窗字段的旧数据不门控', pickClipStateKeyframes([{ id: 'w', puppetCharacterId: 'cA', stateKeyframes: stateKfs }] as any, 'w', 'cA', 99) === stateKfs);
}

// ---------- H：静态清零 ----------
{
  const root = join(process.cwd(), 'src');
  const offenders: string[] = [];
  let unifiedHits = 0;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      const text = readFileSync(p, 'utf8');
      if (text.includes('UnifiedAnimationClip')) unifiedHits++;
      if (p.endsWith('clip-migration.ts')) continue; // 迁移模块按设计处理旧字段名
      if (/\.nodeKeyframes/.test(text) || /c\.nodeKeyframes|clip\.nodeKeyframes/.test(text)) offenders.push(p);
    }
  };
  walk(root);
  check('H1 UnifiedAnimationClip 全仓清零', unifiedHits === 0, `${unifiedHits}`);
  check('H2 nodeKeyframes 字段访问只剩迁移模块', offenders.length === 0, offenders.join(','));
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
