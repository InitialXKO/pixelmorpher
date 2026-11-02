// IK 链进包实时求解探针：
// A) 发包——live 档 convert 出 ikChains、生成的页面含求解遍且脚本可解析
//    （依赖 convert 的 live 档；带蓝图的链回落烘焙点名、无锚定回落）。
// B) 行为——从模板源码抽出求解链本体（fbSolveChain/fbWriteChain/
//    runLiveIkPass 等，非抄写），以桩参数表驱动：静态目标两骨解算
//    与独立三角构造逐值对拍、尖端延伸、标记锚定优先、锚定失效回
//    落静态、链根随 pose 平移。
import { readFileSync } from 'node:fs';
import { buildRuntimeHtml } from '../src/lib/proc-runtime/runtime-template';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import { createDefaultNode, pxToSub, type Character, type IKChain } from '../src/lib/unified-types';
import type { BlueprintGraph } from '../src/lib/blueprint/ir';
import type { AnimationClip } from '../src/lib/types';

let fails = 0;
const check = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const nearPt = (p: [number, number], q: [number, number], eps = 1e-6) => near(p[0], q[0], eps) && near(p[1], q[1], eps);

// ---------- B) 求解遍行为（模板源码抽出） ----------
type Pt = [number, number];
{
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
  const iIk = src.indexOf('// ---- IK 链实时求解');
  const jIk = src.indexOf('// ---- 粒子实时模拟');
  check(iIk > 0 && jIk > iIk, 'B0 模板含 IK 实时求解段');
  const ikSeg = src.slice(iIk, jIk);
  check(ikSeg.includes('function runLiveIkPass'), 'B0b 求解段含 runLiveIkPass');
  const trigDecl = ikSeg.slice(ikSeg.indexOf('const IK_DIR_TRIG'), ikSeg.indexOf('function runLiveIkPass'));

  // 桩环境：三关节手臂（根→中→末，静止沿 +x）+ 一个锚点部件
  const PRMS: Record<string, { pivot: Pt; off: Pt; restRot: number }> = {
    shoulder: { pivot: [0, 0], off: [0, 0], restRot: 0 },
    elbow: { pivot: [20, 0], off: [0, 0], restRot: 0 },
    hand: { pivot: [40, 0], off: [0, 0], restRot: 0 },
    sword: { pivot: [100, 50], off: [0, 0], restRot: 0 },
  };
  const PARTS: Record<string, { key: string; sprite?: { h: number; plug: Pt }; base?: { size: [number, number] } }> = {
    shoulder: { key: 'shoulder' }, elbow: { key: 'elbow' },
    hand: { key: 'hand', sprite: { h: 16, plug: [8, 8] } },
    sword: { key: 'sword', sprite: { h: 16, plug: [8, 8] } },
  };
  const CHAR = { x: 500, variant: 6 };
  const ORIGIN_Y = 300;
  // runLiveIkPass 读模块级 IK_CHAINS——经工厂参数注入改绑
  const buildWithChains = (chains: unknown) => {
    const f = new Function('PART_BY_KEY', 'fbParamsOf', 'char', 'charOriginY', 'IK_CHAINS', `
      ${grab('anchorPointWorld')}
      ${grab('fbJointOf')}
      ${grab('fbRestTarget')}
      ${grab('fbSegSumEff')}
      ${grab('fbTipExtent')}
      ${grab('fbSolveChain')}
      ${grab('partCenter')}
      ${grab('fbWriteChain')}
      ${trigDecl}
      ${grab('runLiveIkPass')}
      return { runLiveIkPass };
    `) as (...a: unknown[]) => { runLiveIkPass: (pose: unknown, state: unknown) => void };
    return f(new Map(Object.values(PARTS).map((p) => [p.key, p])), (part: { key: string }) => PRMS[part.key], CHAR, () => ORIGIN_Y, chains);
  };
  const centerOf = (pose: Record<string, { a?: number; dx?: number; dy?: number }>, key: string): Pt => {
    const prm = PRMS[key]; const e = pose[key] || { a: 0, dy: 0 };
    const a = (e.a || 0) + prm.restRot, c = Math.cos(a), s = Math.sin(a);
    return [CHAR.x + prm.pivot[0] + prm.off[0] * c - prm.off[1] * s + (e.dx || 0),
            ORIGIN_Y + prm.pivot[1] + prm.off[0] * s + prm.off[1] * c + (e.dy || 0)];
  };
  // 独立构造：两骨解算（根→中）+ 尾段刚性旋转（中→末→尖）；
  // rootOff = 链根静止位的平移（B4 用）
  const expected = (F: Pt, tip: number, rootOff: Pt = [0, 0]) => {
    const J: Pt[] = [[rootOff[0], rootOff[1]], [20 + rootOff[0], rootOff[1]], [40 + rootOff[0], rootOff[1]]];
    const tipRest: Pt = [40 + rootOff[0] + tip, rootOff[1]];
    const L1 = 20, L2 = Math.hypot(tipRest[0] - J[1][0], tipRest[1] - J[1][1]);
    let dx = F[0] - J[0][0], dy = F[1] - J[0][1]; let d = Math.hypot(dx, dy);
    const maxD = (L1 + L2) * 0.999, minD = Math.abs(L1 - L2) * 1.001 + 1e-4;
    if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; } else if (d < minD && d > 1e-6) { dx *= minD / d; dy *= minD / d; d = minD; }
    const T: Pt = [J[0][0] + dx, J[0][1] + dy];
    const a1 = Math.atan2(dy, dx);
    const cosK = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * Math.max(d, 1e-6))));
    const restCross = (tipRest[0] - J[0][0]) * (J[1][1] - J[0][1]) - (tipRest[1] - J[0][1]) * (J[1][0] - J[0][0]);
    const ka = a1 + (restCross >= 0 ? 1 : -1) * Math.acos(cosK);
    const K: Pt = [J[0][0] + Math.cos(ka) * L1, J[0][1] + Math.sin(ka) * L1];
    const rot = Math.atan2(T[1] - K[1], T[0] - K[0]) - Math.atan2(J[2][1] - J[1][1], J[2][0] - J[1][0]);
    const end: Pt = [K[0] + (J[2][0] - J[1][0]) * Math.cos(rot) - (J[2][1] - J[1][1]) * Math.sin(rot),
                     K[1] + (J[2][0] - J[1][0]) * Math.sin(rot) + (J[2][1] - J[1][1]) * Math.cos(rot)];
    return { mid: K, end, tip: T };
  };

  // B1 静态目标 + 尖端延伸：变体 6（南，cos=1,sin=0）→ F=[tx, −ty]
  {
    const chains = [{ root: 'shoulder', end: 'hand', keys: ['shoulder', 'elbow', 'hand'], target: [30, -10, 0], solver: '2bone', tipLength: 8 }];
    const rt = buildWithChains(chains);
    const pose: Record<string, { a?: number; dx?: number; dy?: number }> = {};
    rt.runLiveIkPass(pose, null);
    const F: Pt = [30, 10];
    const exp = expected(F, 8);
    const midC = centerOf(pose, 'elbow'), endC = centerOf(pose, 'hand');
    check(nearPt([midC[0] - CHAR.x, midC[1] - ORIGIN_Y], exp.mid, 1e-4), 'B1 中关节落独立构造位');
    check(nearPt([endC[0] - CHAR.x, endC[1] - ORIGIN_Y], exp.end, 1e-4), 'B1 末关节落独立构造位（尾段刚性）');
    const tipDist = Math.hypot(F[0] - exp.end[0], F[1] - exp.end[1]);
    check(near(tipDist, 8, 1e-4), 'B1 末关节到目标距离 = tipLength（尖端落目标）');
    const rootC = centerOf(pose, 'shoulder');
    check(nearPt([rootC[0] - CHAR.x, rootC[1] - ORIGIN_Y], [0, 0], 1e-4), 'B1 根关节不动');
  }
  // B2 标记锚定优先于静态：锚点部件 sword 静止位 [100,50]，瓦片 20×20、
  //    标记在瓦片 [15,5] → 中心系 local=[5,5]，经 anchorPointWorld（rot=0）
  //    → 本地 F=[105,45]（y 项取 −gy·cos，与运行时钳制锚点同式）；
  //    静态目标另设 [0,-40,0]（F=[0,40]），末端应跟锚点不跟静态
  {
    const chains = [{ root: 'shoulder', end: 'hand', keys: ['shoulder', 'elbow', 'hand'], target: [0, -40, 0], solver: '2bone', tipLength: 0, anchor: { key: 'sword', mark: 'grip' } }];
    const rt = buildWithChains(chains);
    const pose: Record<string, { a?: number; dx?: number; dy?: number }> = {};
    const state = { map: new Map([['sword', { tile: { w: 20, h: 20 }, marksN: { grip: [15, 5] } }]]) };
    rt.runLiveIkPass(pose, state);
    const endC = centerOf(pose, 'hand');
    const endLocal: Pt = [endC[0] - CHAR.x, endC[1] - ORIGIN_Y];
    // 目标可达钳制内：|[105,55]| > (20+ (40+8-20)=48)*.999 → 尖端落在根→F 射线
    // 的最大可达处，末关节在中关节→尖端刚性尾段上；只断言末关节明显靠
    // 近锚点方向而非静态方向（静态 F=[0,40] 会把末关节拉向 +y 轴附近）
    check(endLocal[0] > 20, 'B2 末关节被锚点拉向 +x（不跟静态目标）');
    // B3 锚定失效（无此标记）→ 回落静态
    const rt3 = buildWithChains(chains);
    const pose3: Record<string, { a?: number; dx?: number; dy?: number }> = {};
    const state3 = { map: new Map([['sword', { tile: { w: 20, h: 20 }, marksN: {} }]]) };
    rt3.runLiveIkPass(pose3, state3);
    const endC3 = centerOf(pose3, 'hand');
    check(nearPt([endC3[0] - CHAR.x, endC3[1] - ORIGIN_Y], expected([0, 40], 0).end, 1e-4), 'B3 标记缺失回落静态目标（末关节落构造位）');
  }
  // B4 链根随 pose 平移：根 pose.dy=+5 → 链以平移后的根为基重新解算
  //    （目标是绝对点：尖端仍落 F，构型按新根位的独立构造）
  {
    const chains = [{ root: 'shoulder', end: 'hand', keys: ['shoulder', 'elbow', 'hand'], target: [30, -10, 0], solver: '2bone', tipLength: 8 }];
    const rt = buildWithChains(chains);
    const pose: Record<string, { a?: number; dx?: number; dy?: number }> = { shoulder: { a: 0, dy: 5 } };
    rt.runLiveIkPass(pose, null);
    const exp = expected([30, 10], 8, [0, 5]);
    const endC = centerOf(pose, 'hand');
    const endLocal: Pt = [endC[0] - CHAR.x, endC[1] - ORIGIN_Y];
    check(nearPt(endLocal, exp.end, 1e-4), 'B4 根平移后末关节落新构型构造位');
    check(near(Math.hypot(30 - endLocal[0], 10 - endLocal[1]), 8, 1e-4), 'B4 尖端仍落绝对目标 F');
    const rootC = centerOf(pose, 'shoulder');
    check(nearPt([rootC[0] - CHAR.x, rootC[1] - ORIGIN_Y], [0, 5], 1e-4), 'B4 根关节保其 pose 位');
  }
  // B5 步态让行接线（源码级）：legKeys 过滤含 liveIkKeys 排除
  check(src.includes('!liveIkKeys.has(k)') && src.includes('const IK_CHAINS = EMBEDDED.ikChains || []'), 'B5 模板接线：IK_CHAINS 读取 + 步态让行');
  const html = buildRuntimeHtml({ parts: [], performances: [] } as never);
  check(html.includes('runLiveIkPass'), 'B6 生成页含 runLiveIkPass');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let parseOk = true;
  for (const sc of scripts) { try { new Function(sc); } catch { parseOk = false; } }
  check(parseOk && scripts.length > 0, 'B7 生成页脚本可解析');
}

// ---------- A) 发包：convert 三档对照 ----------
// 链夹具：腿（静态+极向）/ 臂（标记锚定）/ 臂2（目标蓝图含 var）/
// 幽灵链（根不是部件）/ 颈（锚定节点非部件→丢锚 + 旧式无 target3D）/
// 禁用链（enabled=false）。
{
  const FR = 12, TOTAL = 24, CW = 800, CH = 600;
  const mk = (id: string, parentId?: string) => {
    const n = createDefaultNode(id, id);
    n.id = id;
    if (parentId) n.parentId = parentId;
    (n.transform as { variantIndex: number }).variantIndex = 6;
    (n as { slot: unknown }).slot = { slotKey: id };
    return n;
  };
  const sock = (id: string, x: number, y: number) => ({
    id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
  });
  const attach = (n: ReturnType<typeof mk>, sid: string) => {
    n.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } } as never;
  };
  const buildChar = (): Character => {
    const pelvis = mk('pelvis');
    const hip = mk('hip', 'pelvis'); const knee = mk('knee', 'hip'); const foot = mk('foot', 'knee');
    const shoulder = mk('shoulder', 'pelvis'); const elbow = mk('elbow', 'shoulder'); const hand = mk('hand', 'elbow');
    const shoulder2 = mk('shoulder2', 'pelvis'); const elbow2 = mk('elbow2', 'shoulder2'); const hand2 = mk('hand2', 'elbow2');
    const neck = mk('neck', 'pelvis'); const neckTip = mk('neckTip', 'neck');
    const ghostRoot = mk('ghostRoot', 'pelvis'); const ghostTip = mk('ghostTip', 'ghostRoot');
    pelvis.children = [hip.id, shoulder.id, shoulder2.id, neck.id, ghostRoot.id];
    hip.children = [knee.id]; knee.children = [foot.id];
    shoulder.children = [elbow.id]; elbow.children = [hand.id];
    shoulder2.children = [elbow2.id]; elbow2.children = [hand2.id];
    neck.children = [neckTip.id]; ghostRoot.children = [ghostTip.id];
    pelvis.sockets = [sock('s_hip', 0, 25), sock('s_sh', 35, 15), sock('s_sh2', -35, 15), sock('s_neck', 0, -10), sock('s_ghost', 60, 40)] as never;
    hip.sockets = [sock('s_knee', 0, 75)] as never; knee.sockets = [sock('s_foot', 0, 75)] as never;
    shoulder.sockets = [sock('s_el', 0, 55)] as never; elbow.sockets = [sock('s_hand', 0, 55)] as never;
    shoulder2.sockets = [sock('s_el2', 0, 55)] as never; elbow2.sockets = [sock('s_hand2', 0, 55)] as never;
    neck.sockets = [sock('s_ntip', 0, -20)] as never; ghostRoot.sockets = [sock('s_gtip', 0, 30)] as never;
    attach(hip, 's_hip'); attach(knee, 's_knee'); attach(foot, 's_foot');
    attach(shoulder, 's_sh'); attach(elbow, 's_el'); attach(hand, 's_hand');
    attach(shoulder2, 's_sh2'); attach(elbow2, 's_el2'); attach(hand2, 's_hand2');
    attach(neck, 's_neck'); attach(neckTip, 's_ntip');
    attach(ghostRoot, 's_ghost'); attach(ghostTip, 's_gtip');
    pelvis.tracks = {
      x: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: TOTAL, value: pxToSub(48) }] },
    } as never;
    const bp: BlueprintGraph = {
      version: 1,
      nodes: [
        { id: 'v1', type: 'var', inputs: {}, params: { name: 'aimX', default: 35 }, ui: { x: 0, y: 0 } } as never,
        { id: 'out', type: 'transform', inputs: { translateX: { nodeId: 'v1' } }, params: { translateX: 35, translateY: 180, translateZ: 0 }, ui: { x: 0, y: 0 } } as never,
      ],
      outputId: 'out',
    };
    const chains: IKChain[] = [
      { id: 'ch_leg', name: '腿', rootNodeId: 'hip', endNodeId: 'foot', target: { x: 400, y: 300 }, target3D: { x: 0, y: 230, z: 0 }, poleTarget3D: { x: 30, y: 120, z: 0 }, enabled: true, solver: '2bone', bendDir: 1, tipLength: 0 } as IKChain,
      { id: 'ch_arm', name: '臂', rootNodeId: 'shoulder', endNodeId: 'hand', target: { x: 400, y: 300 }, target3D: { x: 35, y: 180, z: 0 }, targetMarkAnchor: { nodeId: 'pelvis', mark: 'hold' }, enabled: true, solver: 'fabrik', bendDir: -1, tipLength: 12 } as IKChain,
      { id: 'ch_arm2', name: '臂2', rootNodeId: 'shoulder2', endNodeId: 'hand2', target: { x: 400, y: 300 }, target3D: { x: -35, y: 180, z: 0 }, targetBlueprint: bp, enabled: true, solver: '2bone', bendDir: 1, tipLength: 0 } as IKChain,
      { id: 'ch_ghost', name: '幽灵链', rootNodeId: 'ghostRoot', endNodeId: 'ghostTip', target: { x: 400, y: 300 }, target3D: { x: 60, y: 90, z: 0 }, enabled: true, solver: '2bone', bendDir: 1, tipLength: 0 } as IKChain,
      { id: 'ch_neck', name: '颈', rootNodeId: 'neck', endNodeId: 'neckTip', target: { x: 440, y: 330 }, targetMarkAnchor: { nodeId: 'ghostRoot', mark: 'hold' }, enabled: true, solver: '2bone', tipLength: 0 } as unknown as IKChain,
      { id: 'ch_off', name: '禁用链', rootNodeId: 'hip', endNodeId: 'foot', target: { x: 400, y: 300 }, target3D: { x: 5, y: 200, z: 0 }, enabled: false, solver: '2bone', bendDir: 1, tipLength: 0 } as IKChain,
    ];
    const partIds = ['pelvis', 'hip', 'knee', 'foot', 'shoulder', 'elbow', 'hand', 'shoulder2', 'elbow2', 'hand2', 'neck', 'neckTip'];
    const piece = (nodeId: string) => ({ nodeId, zIndex: 0, parametric: createDefaultParametricAppearance() }) as never;
    const nodes = { pelvis, hip, knee, foot, shoulder, elbow, hand, shoulder2, elbow2, hand2, neck, neckTip, ghostRoot, ghostTip };
    return {
      id: 'ikl1', name: 'IK实时测试',
      nodes, rootNodeId: 'pelvis', rootNodeIds: ['pelvis'],
      sprites: {},
      costumeSets: [{ id: 'set1', name: '默认', pieces: Object.fromEntries(partIds.map((id) => [id, piece(id)])) }],
      activeCostumeSetId: 'set1', direction: 6, latitude: 0,
      ikChains: chains,
    } as unknown as Character;
  };
  const clips = [{ id: 'clip1', name: '片段1', puppetCharacterId: 'ikl1', startFrame: 0, endFrame: TOTAL, loop: false }] as unknown as AnimationClip[];
  const baseOpts = { frameRate: FR, totalFrames: TOTAL, clips, projectData: { canvasWidth: CW, canvasHeight: CH } };
  type Pkg = ReturnType<typeof convertCharacterToRuntimePackage>;
  const conv = (ik: 'drop' | 'bake' | 'live'): Pkg =>
    convertCharacterToRuntimePackage(buildChar(), undefined, { ...baseOpts, bake: { ik } });
  const partSampleJson = (pkg: Pkg, part: string): string => {
    const perf = pkg.performances.find((p) => p.id === 'tracks');
    if (!perf) return 'NO-TRACKS';
    const nodes = (perf.graph as { nodes: Array<Record<string, unknown>> }).nodes;
    const tr = nodes.find((n) => n.type === 'transform' && n.part === part);
    if (!tr) return 'NO-PART';
    const refs = [tr.dxFrom, tr.dyFrom].map((r) => (r as { n?: string } | undefined)?.n).filter(Boolean);
    const curves = nodes.filter((n) => refs.includes(n.id as string));
    return JSON.stringify({ tr, curves });
  };
  const live = conv('live');
  const ikc = (live as { ikChains?: Array<Record<string, any>> }).ikChains;
  check(Array.isArray(ikc), `A1 live 档包顶层有 ikChains（${ikc?.length} 条）`);
  const byRoot = new Map((ikc ?? []).map((c) => [c.root as string, c]));
  const leg = byRoot.get('hip');
  check(!!leg && leg.end === 'foot' && JSON.stringify(leg.keys) === '["hip","knee","foot"]', 'A2 腿链 live：root/end/keys 正确');
  check(!!leg && JSON.stringify(leg.target) === '[0,230,0]' && leg.solver === '2bone' && leg.bendDir === 1, 'A3 腿链 target 原样、solver/bendDir 落字段');
  check(!!leg && !('tipLength' in leg), 'A4 腿链 tipLength=0 不落字段');
  const arm = byRoot.get('shoulder');
  check(!!arm && arm.anchor?.key === 'pelvis' && arm.anchor?.mark === 'hold', 'A5 臂链锚定映射 → anchor {key:pelvis, mark:hold}');
  check(!!arm && arm.tipLength === 12 && arm.bendDir === -1 && arm.solver === 'fabrik', 'A6 臂链 tipLength/bendDir/solver 落字段');
  check(!byRoot.has('shoulder2'), 'A7 蓝图链不进 ikChains（回落烘焙）');
  const neck = byRoot.get('neck');
  check(!!neck && !('anchor' in neck), 'A8 颈链 live 但锚定被丢弃（锚点非部件）');
  check(!!neck && JSON.stringify(neck.target) === '[40,30,0]', 'A9 颈链旧式 target 按编辑器口径换算 → [40,30,0]');
  check((ikc ?? []).length === 3, 'A10 ikChains 恰 3 条（腿/臂/颈；蓝图、幽灵、禁用不在内）');
  const w = live.warnings.join('\n');
  check(w.includes('链「臂2」') && w.includes('目标蓝图不进包'), 'A11 点名：蓝图链回落烘焙');
  check(w.includes('链「幽灵链」') && w.includes('根/末端不是包内部件'), 'A12 点名：幽灵链根非部件回落');
  check(w.includes('链「颈」') && w.includes('锚定节点不是包内部件'), 'A13 点名：颈链锚定丢弃');
  check(w.includes('链「腿」') && w.includes('极向量不进包'), 'A14 点名：腿链极向不进包（链仍 live）');
  check(!w.includes('禁用链'), 'A15 禁用链全程不点名');
  const drop = conv('drop');
  const bake = conv('bake');
  check(partSampleJson(live, 'hand') === partSampleJson(drop, 'hand'), 'A16 臂（live 链）手样本 live == drop（未被烘，防双重施加）');
  check(partSampleJson(live, 'foot') === partSampleJson(drop, 'foot'), 'A17 腿（live 链）脚样本 live == drop（未被烘）');
  check(partSampleJson(live, 'hand2') === partSampleJson(bake, 'hand2'), 'A18 臂2（回落链）手样本 live == bake（已烘）');
  check(partSampleJson(drop, 'hand') !== partSampleJson(bake, 'hand'), 'A19 对照有效性（严格）：bake 手样本与 drop 确实不同（夹具可判别）');
  check((bake as { ikChains?: unknown }).ikChains === undefined, 'A20 bake 档无 ikChains 字段');
  check((drop as { ikChains?: unknown }).ikChains === undefined, 'A21 drop 档无 ikChains 字段');
  check(!bake.warnings.join('\n').includes('已按烘焙导出') && !drop.warnings.join('\n').includes('已按烘焙导出'), 'A22 bake/drop 档无 live 筛选点名');
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);
