// 钳制锚定 convert 探针：著者触发（高度）经采样进包——根节点烘焙
// 曲线在脚冻结后出现平台（反移），无锚定对照组持续下沉；scene 触发
// 不进采样且有警告点名。
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import {
  pxToSub,
  type Character, type Node as UnifiedNode,
} from '../src/lib/unified-types';

let fails = 0;
const check = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

function makeNode(id: string, name: string, slotKey: string | null, parentId?: string): UnifiedNode {
  return {
    id, name, parentId,
    role: 'bone',
    slot: slotKey ? { slotKey } : undefined,
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' },
    sockets: [],
    tracks: {},
    modifiers: [],
    children: [],
    sprite: undefined as never,
  } as unknown as UnifiedNode;
}

function build(withAnchor: boolean, sceneTrigger = false): Character {
  const torso = makeNode('torso', '躯干', 'torso');
  const leg = makeNode('leg', '腿', null, 'torso');
  torso.children = ['leg'];
  (leg.transform as { y: number }).y = pxToSub(130);
  torso.tracks = {
    y: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: pxToSub(40) }] },
  } as never;
  const ch = {
    id: 'cc1', name: '钳制转换测试',
    nodes: { torso, leg },
    rootNodeId: 'torso',
    rootNodeIds: ['torso'],
    costumeSets: [{
      id: 'set1', name: '默认',
      pieces: { torso: { nodeId: 'torso', zIndex: 0, parametric: createDefaultParametricAppearance() } },
    }],
    activeCostumeSetId: 'set1',
    variants: { '0': '东', '2': '西' },
    clampAnchors: withAnchor ? [{
      id: 'ca1', name: '脚落地', enabled: true,
      point: { kind: 'node', nodeId: 'leg' },
      trigger: sceneTrigger ? { kind: 'scene' } : { kind: 'height', y: 140, side: 'below' },
    }] : [],
  } as unknown as Character;
  return ch;
}

function rootDyEnd(pkg: ReturnType<typeof convertCharacterToRuntimePackage>): { end: number; mid: number } | null {
  const tracks = pkg.performances.find((p) => p.id === 'tracks');
  if (!tracks) return null;
  const nodes = tracks.graph.nodes as Array<Record<string, unknown>>;
  const tr = nodes.find((n) => n.type === 'transform' && n.part === 'torso') as { dyFrom?: { n: string } } | undefined;
  if (!tr?.dyFrom) return null;
  const curve = nodes.find((n) => n.id === tr.dyFrom!.n) as { points?: Array<[number, number]> } | undefined;
  if (!curve?.points || curve.points.length === 0) return null;
  const pts = curve.points;
  const mid = pts.reduce((acc, p) => (Math.abs(p[0] - 0.5) < Math.abs(acc[0] - 0.5) ? p : acc), pts[0]);
  return { end: pts[pts.length - 1][1], mid: mid[1] };
}

const pkgA = convertCharacterToRuntimePackage(build(true));
const pkgB = convertCharacterToRuntimePackage(build(false));
const dyA = rootDyEnd(pkgA);
const dyB = rootDyEnd(pkgB);
check(!!dyA && !!dyB, '前置：两包都有躯干 dy 曲线');
if (dyA && dyB) {
  // 运行时 y 向上：编辑器下沉 40 → 曲线末值约 −40（对照组）
  check(dyB.end < -35, `对照组根持续下沉（末值 ${dyB.end.toFixed(1)}）`);
  // 锚定组：脚在根下沉 10 后冻结，根烘焙位被反移顶住，末值约 −10
  check(dyA.end > dyB.end + 20, `锚定组根被反移顶住（末值 ${dyA.end.toFixed(1)} vs 对照 ${dyB.end.toFixed(1)}）`);
  check(Math.abs(dyA.end - dyA.mid) < 2.5, `锚定组后半程成平台（中点 ${dyA.mid.toFixed(1)} ≈ 末值 ${dyA.end.toFixed(1)}）`);
}
const pkgS = convertCharacterToRuntimePackage(build(true, true));
check(pkgS.warnings.some((w) => w.includes('scene 触发不进采样')), 'scene 触发有点名警告、不进采样');

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
