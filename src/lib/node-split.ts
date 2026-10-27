// ============================================================
// 节点拆分（PR #54 定案，工具走甲）：在段 S→E 中点插入新关节 M，
// 精灵资产级切两幅、堆叠按层断两摞、参数化按合成档处理。
// 全部按静止位口径：切图/层位/静态偏移都是静止量，当前帧只定位。
// 本模块是纯变换（角色 + 精灵表 → 新角色 + 新精灵 + 点名报告），
// store 动作负责一次性写回（一个撤销步）。
// ============================================================

import type {
  Character, Node, Socket, Sprite, SpriteMark, CostumePiece, CostumeSet,
  DirectionIndex, PixelGrid,
} from './unified-types';
import {
  createDefaultNode, createDefaultCostumePiece, pxToSub, subToPx,
  projectToView, computeSpriteEndPoint, applyFrameRotation, frameYAxisWorld, mat3Transpose,
} from './unified-types';
import { computeRestWorldTransforms } from './unified-render';
import type { WorldTransform } from './unified-render';
import { cropGridToContent } from './bake/skeleton-mapper';

/**
 * 切口截面宽：沿切线（⊥ 段轴）从切点向两侧数连续实心像素。
 * measureOpeningWidth 按水平行程量、只对竖骨成立，这里要的是任意
 * 轴向的截面宽（关节盘直径与拆分点钳制都按它）。切点本身不在实心
 * 上时返回 null（盘径走回落）。
 */
function measureCutWidth(data: PixelGrid, cx: number, cy: number, ux: number, uy: number): number | null {
  const px = -uy, py = ux;
  const solidAt = (x: number, y: number): boolean => {
    const gx = Math.round(x), gy = Math.round(y);
    return SOLID(data[gy]?.[gx]);
  };
  if (!solidAt(cx, cy)) return null;
  let steps = 0;
  for (const sgn of [1, -1]) {
    for (let d = 0.5; d < 512; d += 0.5) {
      if (!solidAt(cx + px * d * sgn, cy + py * d * sgn)) break;
      steps++;
    }
  }
  return Math.max(1, steps * 0.5);
}
import { packMaskBits, unpackMaskBits } from './sprite-marks';

export interface NodeSplitOutcome {
  ok: boolean;
  error?: string;
  character?: Character;
  newSprites?: Sprite[];
  midNodeId?: string;
  report: string[];
}

const MIN_END_PX = 8;          // 拆分点距段两端的最小距离（再与盘半径取大）
const MIN_LOCAL_SEG_PX = 16;   // 某向图内段长低于此 → 该向整幅留原节点
const SOLID = (c: string | null | undefined): boolean => c !== null && c !== undefined && c !== '';

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** 静止位世界变换：与 unified-render 共用同一助手（同一静止口径） */
const restTransforms = computeRestWorldTransforms;

function worldPosPx(wt: Map<string, WorldTransform>, id: string, dir: DirectionIndex): { x: number; y: number } {
  const w = wt.get(id)!;
  const p = projectToView(w.worldX, w.worldY, w.worldZ, dir);
  return { x: subToPx(p.canvasX), y: subToPx(p.canvasY) };
}

function worldPos3Px(wt: Map<string, WorldTransform>, id: string): { x: number; y: number; z: number } {
  const w = wt.get(id)!;
  return { x: subToPx(w.worldX), y: subToPx(w.worldY), z: subToPx(w.worldZ) };
}

/** 插座偏移按比例缩放（2D 各向 + 3D 一套口径同缩） */
function scaleSocket(s: Socket, f: number, keepSkinning: boolean): Socket {
  const sp = (p: { x: number; y: number }) => ({ x: Math.round(p.x * f), y: Math.round(p.y * f) });
  const out: Socket = {
    ...s,
    basePosition: sp(s.basePosition),
    directionOffsets: Object.fromEntries(
      Object.entries(s.directionOffsets).map(([k, v]) => [k, v ? sp(v) : v]),
    ) as Socket['directionOffsets'],
  };
  if (s.templateOffsets) {
    out.templateOffsets = Object.fromEntries(
      Object.entries(s.templateOffsets).map(([k, v]) => [k, v ? sp(v) : v]),
    ) as Socket['templateOffsets'];
  }
  if (s.offset3D) {
    out.offset3D = {
      x: Math.round(s.offset3D.x * f),
      y: Math.round(s.offset3D.y * f),
      z: Math.round(s.offset3D.z * f),
    };
  }
  if (!keepSkinning) {
    delete out.skinning;
    delete out.skinRadius;
    delete out.skinCurve;
  }
  return out;
}

// ---------------- 标记按切线分家 ----------------

interface CutGeom {
  plugX: number; plugY: number;   // 原图 plug（px）
  ux: number; uy: number;         // 图内段轴单位向量（plug → 子关节）
  cutDist: number;                // 切点沿轴距 plug 的距离（px）
  w: number; h: number;           // 原图尺寸
}

function sideOf(g: CutGeom, px: number, py: number): number {
  // ≤0 近段（plug 侧），>0 远段
  return (px - g.plugX) * g.ux + (py - g.plugY) * g.uy - g.cutDist;
}

function splitMarks(
  marks: SpriteMark[] | undefined,
  g: CutGeom,
  nearBox: { cropX: number; cropY: number; w: number; h: number },
  farBox: { cropX: number; cropY: number; w: number; h: number },
): { near: SpriteMark[]; far: SpriteMark[] } {
  const near: SpriteMark[] = [];
  const far: SpriteMark[] = [];
  if (!marks) return { near, far };
  const renorm = (
    m: SpriteMark, box: { cropX: number; cropY: number; w: number; h: number },
    ax: number, ay: number,
  ): { x: number; y: number } => ({
    x: Math.max(0, Math.min(1, (ax - box.cropX) / Math.max(1, box.w))),
    y: Math.max(0, Math.min(1, (ay - box.cropY) / Math.max(1, box.h))),
  });
  for (const m of marks) {
    if (m.kind === 'value' || m.kind === 'direction') {
      near.push(m); far.push(m);
      continue;
    }
    if (m.kind === 'region' && m.region.by === 'color') {
      near.push(m); far.push(m);
      continue;
    }
    if (m.kind === 'point' || m.kind === 'vector') {
      const ax = m.x * g.w, ay = m.y * g.h;
      const isNear = sideOf(g, ax, ay) <= 0;
      const box = isNear ? nearBox : farBox;
      const p = renorm(m, box, ax, ay);
      if (m.kind === 'point') {
        (isNear ? near : far).push({ ...m, x: p.x, y: p.y });
      } else {
        (isNear ? near : far).push({
          ...m, x: p.x, y: p.y,
          dx: m.dx * (g.w / Math.max(1, box.w)),
          dy: m.dy * (g.h / Math.max(1, box.h)),
        });
      }
      continue;
    }
    if (m.kind === 'region' && (m.region.by === 'rect' || m.region.by === 'circle')) {
      const r = m.region;
      const cx = (r.by === 'rect' ? (r.x + r.w / 2) : r.cx) * g.w;
      const cy = (r.by === 'rect' ? (r.y + r.h / 2) : r.cy) * g.h;
      const isNear = sideOf(g, cx, cy) <= 0;
      const box = isNear ? nearBox : farBox;
      const sx = g.w / Math.max(1, box.w), sy = g.h / Math.max(1, box.h);
      if (r.by === 'rect') {
        (isNear ? near : far).push({
          ...m,
          region: {
            by: 'rect',
            x: Math.max(0, (r.x * g.w - box.cropX) / Math.max(1, box.w)),
            y: Math.max(0, (r.y * g.h - box.cropY) / Math.max(1, box.h)),
            w: r.w * sx, h: r.h * sy,
          },
        });
      } else {
        const c = renorm(m, box, cx, cy);
        (isNear ? near : far).push({ ...m, region: { by: 'circle', cx: c.x, cy: c.y, r: r.r * sx } });
      }
      continue;
    }
    if (m.kind === 'region' && m.region.by === 'painted') {
      // 涂画掩码按切线逐格分家、按各自裁剪框重打包
      const mw = m.region.mask.w, mh = m.region.mask.h;
      const cells = unpackMaskBits(m.region.mask.bits, mw * mh);
      const kx = mw / Math.max(1, g.w), ky = mh / Math.max(1, g.h);
      for (const [box, out] of [[nearBox, near], [farBox, far]] as const) {
        const sub = new Uint8Array(box.w * box.h);
        let any = 0;
        for (let y = 0; y < box.h; y++) {
          for (let x = 0; x < box.w; x++) {
            const gx = box.cropX + x, gy = box.cropY + y;
            const mx = Math.floor(gx * kx), my = Math.floor(gy * ky);
            if (mx < 0 || my < 0 || mx >= mw || my >= mh) continue;
            if (!cells[my * mw + mx]) continue;
            if ((sideOf(g, gx + 0.5, gy + 0.5) <= 0) === (out === near)) {
              sub[y * box.w + x] = 1; any++;
            }
          }
        }
        if (any > 0) {
          out.push({ ...m, region: { by: 'painted', mask: { w: box.w, h: box.h, bits: packMaskBits(sub) } } });
        }
      }
      continue;
    }
    near.push(m);
  }
  return { near, far };
}

// ---------------- 单幅图切割 ----------------

interface CutResult {
  near?: Sprite;
  far?: Sprite;
  skipped?: 'short' | 'empty-far' | 'empty-near-moved';
  openingWidth?: number | null;
}

function cutGrid(
  src: Sprite,
  g: CutGeom,
  names: { near: string; far: string },
): CutResult {
  const W = src.width, H = src.height;
  const nearData: PixelGrid = [];
  const farData: PixelGrid = [];
  let nearSolid = 0, farSolid = 0;
  for (let y = 0; y < H; y++) {
    const nRow: (string | null)[] = [];
    const fRow: (string | null)[] = [];
    for (let x = 0; x < W; x++) {
      const c = src.data[y]?.[x] ?? null;
      if (sideOf(g, x + 0.5, y + 0.5) <= 0) {
        nRow.push(c); fRow.push(null);
        if (SOLID(c)) nearSolid++;
      } else {
        nRow.push(null); fRow.push(c);
        if (SOLID(c)) farSolid++;
      }
    }
    nearData.push(nRow); farData.push(fRow);
  }
  const openingWidth = measureCutWidth(src.data, g.plugX + g.ux * g.cutDist, g.plugY + g.uy * g.cutDist, g.ux, g.uy);
  if (farSolid === 0) return { skipped: 'empty-far', openingWidth };
  const mkSprite = (
    data: PixelGrid,
    plugAbs: { x: number; y: number },
    name: string,
  ): { sprite: Sprite; box: { cropX: number; cropY: number; w: number; h: number } } => {
    const cropped = cropGridToContent(data, 2);
    const grid = cropped.grid;
    const h = grid.length, w = grid[0]?.length ?? 0;
    const box = { cropX: cropped.cropX, cropY: cropped.cropY, w, h };
    let heightmap: number[][] | undefined;
    if (src.heightmap) {
      heightmap = [];
      for (let y = 0; y < h; y++) {
        const row: number[] = [];
        for (let x = 0; x < w; x++) row.push(src.heightmap[cropped.cropY + y]?.[cropped.cropX + x] ?? 0);
        heightmap.push(row);
      }
    }
    const sprite: Sprite = {
      ...src,
      id: newId('spr'),
      name,
      width: w,
      height: h,
      data: grid,
      plug: { x: pxToSub(plugAbs.x - cropped.cropX), y: pxToSub(plugAbs.y - cropped.cropY) },
      heightmap,
      marks: undefined, // 下面按侧填
    };
    return { sprite, box };
  };
  const cutPt = { x: g.plugX + g.ux * g.cutDist, y: g.plugY + g.uy * g.cutDist };
  if (nearSolid === 0) {
    // 近段无像素：整幅改插头归远段（S 在此条目下无图）
    const whole = mkSprite(src.data, cutPt, names.far);
    const marks = splitMarks(src.marks, g,
      { cropX: 0, cropY: 0, w: 0, h: 0 }, whole.box);
    whole.sprite.marks = marks.far.length ? marks.far : undefined;
    return { far: whole.sprite, skipped: 'empty-near-moved', openingWidth };
  }
  const nearMade = mkSprite(nearData, { x: g.plugX, y: g.plugY }, names.near);
  const farMade = mkSprite(farData, cutPt, names.far);
  const marks = splitMarks(src.marks, g, nearMade.box, farMade.box);
  nearMade.sprite.marks = marks.near.length ? marks.near : undefined;
  farMade.sprite.marks = marks.far.length ? marks.far : undefined;
  // landmarks（归一坐标）按点位侧分家
  if (src.landmarks) {
    const lmNear: NonNullable<Sprite['landmarks']> = {};
    const lmFar: NonNullable<Sprite['landmarks']> = {};
    for (const key of ['leftEye', 'rightEye', 'nose', 'mouth'] as const) {
      const p = src.landmarks[key];
      if (!p) continue;
      const ax = p.x * W, ay = p.y * H;
      const isNear = sideOf(g, ax, ay) <= 0;
      const box = isNear ? nearMade.box : farMade.box;
      (isNear ? lmNear : lmFar)[key] = {
        x: Math.max(0, Math.min(1, (ax - box.cropX) / Math.max(1, box.w))),
        y: Math.max(0, Math.min(1, (ay - box.cropY) / Math.max(1, box.h))),
      };
    }
    if (Object.keys(lmNear).length) nearMade.sprite.landmarks = lmNear;
    if (Object.keys(lmFar).length) farMade.sprite.landmarks = lmFar;
  }
  return { near: nearMade.sprite, far: farMade.sprite, openingWidth };
}

// ---------------- 主变换 ----------------

export function splitNodeSegment(args: {
  character: Character;
  sprites: Record<string, Sprite>;
  nodeId: string;
  childId: string | null;
  t: number;
  direction: DirectionIndex;
}): NodeSplitOutcome {
  const { character, sprites, nodeId, childId } = args;
  const report: string[] = [];
  const S = character.nodes[nodeId];
  if (!S) return { ok: false, error: '节点不存在', report };
  const E = childId ? character.nodes[childId] : undefined;
  if (childId && (!E || E.parentId !== S.id)) {
    return { ok: false, error: '子节点不是该节点的直属子节点', report };
  }
  const slotKeyOf = (n: Node) => n.slot?.slotKey ?? n.id;
  const sKey = slotKeyOf(S);

  // ---- 需要哪些方向的静止位（全部条目方向 + 当前方向） ----
  const dirSet = new Set<number>([args.direction]);
  const pieceOf = (set: CostumeSet) => set.pieces[sKey];
  for (const set of character.costumeSets ?? []) {
    const p = pieceOf(set);
    if (!p) continue;
    for (const d of Object.keys(p.sprites)) dirSet.add(Number(d));
    for (const sub of Object.values(p.variantSprites ?? {})) for (const d of Object.keys(sub ?? {})) dirSet.add(Number(d));
    for (const sub of Object.values(p.latitudeSprites ?? {})) for (const d of Object.keys(sub ?? {})) dirSet.add(Number(d));
    for (const sub of Object.values(p.scaleVariants ?? {})) for (const d of Object.keys(sub ?? {})) dirSet.add(Number(d));
  }
  const restCache = new Map<number, Map<string, WorldTransform>>();
  const restFor = (dir: number) => {
    let wt = restCache.get(dir);
    if (!wt) { wt = restTransforms(character, dir as DirectionIndex); restCache.set(dir, wt); }
    return wt;
  };

  // ---- 段几何（t 的空间） ----
  const eSocket = E ? S.sockets.find((sk) => sk.id === E.attachment?.parentSocketId) : undefined;
  let segLenT = 0;
  if (E) {
    if (eSocket?.offset3D) {
      segLenT = Math.hypot(subToPx(eSocket.offset3D.x), subToPx(eSocket.offset3D.y), subToPx(eSocket.offset3D.z));
    } else {
      const wt = restFor(args.direction);
      const a = worldPos3Px(wt, S.id), b = worldPos3Px(wt, E.id);
      segLenT = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
  }

  // 解析精灵条目 → 网格
  const resolveGrid = (entry: Sprite | { spriteId: string }): Sprite | undefined => {
    if ((entry as Sprite).data) return entry as Sprite;
    const id = (entry as { spriteId: string }).spriteId;
    return sprites[id] ?? character.sprites?.[id];
  };

  // 当前方向、生效集的那幅图先量开口（决定钳制与盘径）
  const activeSet = (character.costumeSets ?? []).find((s) => s.id === character.activeCostumeSetId)
    ?? (character.costumeSets ?? [])[0];
  let openingWidth: number | null = null;
  const activePiece = activeSet ? pieceOf(activeSet) : undefined;
  if (E && activePiece) {
    const entry = activePiece.sprites[args.direction as DirectionIndex]
      ?? Object.values(activePiece.sprites)[0];
    const grid = entry ? resolveGrid(entry) : undefined;
    if (grid) {
      const wt = restFor(args.direction);
      const sc = worldPosPx(wt, S.id, args.direction), ec = worldPosPx(wt, E.id, args.direction);
      const v = { x: ec.x - sc.x, y: ec.y - sc.y };
      const ll = Math.hypot(v.x, v.y);
      if (ll > 1e-6) {
        const ang = ((wt.get(S.id)?.worldAngle ?? 0) * Math.PI) / 180;
        const ux = (v.x * Math.cos(ang) + v.y * Math.sin(ang)) / ll;
        const uy = (-v.x * Math.sin(ang) + v.y * Math.cos(ang)) / ll;
        const plugX = grid.plug ? subToPx(grid.plug.x) : grid.width / 2;
        const plugY = grid.plug ? subToPx(grid.plug.y) : grid.height / 2;
        openingWidth = measureCutWidth(grid.data, plugX + ux * args.t * ll, plugY + uy * args.t * ll, ux, uy);
      }
    }
  }
  const minDist = Math.max(MIN_END_PX, openingWidth ? openingWidth / 2 : 0);

  if (E) {
    if (segLenT < 2 * minDist + 2) {
      return { ok: false, error: `段太短（${segLenT.toFixed(0)}px），拆分点放不下`, report };
    }
  } else {
    // 叶子：t 空间 = 生效方向精灵的尖端长（或摞长）
    let tipLen = 0;
    const entry = activePiece?.sprites[args.direction as DirectionIndex] ?? (activePiece ? Object.values(activePiece.sprites)[0] : undefined);
    const grid = entry ? resolveGrid(entry) : undefined;
    if (grid) {
      const plugX = grid.plug ? subToPx(grid.plug.x) : grid.width / 2;
      const plugY = grid.plug ? subToPx(grid.plug.y) : grid.height / 2;
      const end = computeSpriteEndPoint(grid.width, grid.height, plugX, plugY);
      tipLen = Math.hypot(end.x, end.y);
    }
    if (activePiece?.stack) {
      tipLen = Math.max(tipLen, activePiece.stack.layerSpriteIds.length * activePiece.stack.layerThickness);
    }
    segLenT = tipLen;
    if (segLenT < 2 * minDist + 2) {
      return { ok: false, error: '叶子精灵太短，拆分点放不下', report };
    }
  }
  const t = Math.max(minDist / segLenT, Math.min(1 - minDist / segLenT, args.t));

  // ---- 结构：新节点 M 与两只新插座 ----
  const midId = newId('node');
  let midName = `${S.name}_mid`;
  {
    const names = new Set(Object.values(character.nodes).map((n) => n.name));
    let i = 2;
    const base = midName;
    while (names.has(midName)) { midName = `${base}${i}`; i++; }
  }
  const midSlotKey = (() => {
    const used = new Set<string>();
    for (const set of character.costumeSets ?? []) for (const k of Object.keys(set.pieces)) used.add(k);
    for (const n of Object.values(character.nodes)) if (n.slot?.slotKey) used.add(n.slot.slotKey);
    let k = `${sKey}_mid`;
    let i = 2;
    const base = k;
    while (used.has(k)) { k = `${base}${i}`; i++; }
    return k;
  })();

  const socketForM: Socket = eSocket
    ? { ...scaleSocket(eSocket, t, false), id: newId('sock'), name: midName }
    : {
        id: newId('sock'), name: midName,
        basePosition: { x: 0, y: 0 }, directionOffsets: {},
      };
  if (!eSocket) {
    // 叶子：按生效方向帧 +Y 估算新关节的 3D 偏移
    const wt = restFor(args.direction);
    const w = wt.get(S.id);
    if (w) {
      const y = frameYAxisWorld(w.worldFrame, args.direction);
      socketForM.offset3D = {
        x: pxToSub(y.x * t * segLenT), y: pxToSub(y.y * t * segLenT), z: pxToSub(y.z * t * segLenT),
      };
    }
    report.push('叶子拆分：新关节位置按精灵尖端向估算');
  }
  const socketForE: Socket | undefined = eSocket
    ? { ...scaleSocket(eSocket, 1 - t, true), id: newId('sock') }
    : undefined;

  const M = createDefaultNode(midId, midName);
  M.parentId = S.id;
  M.transform = { ...M.transform, variantIndex: S.transform.variantIndex };
  M.drawLayer = S.drawLayer;
  M.zIndex = S.zIndex;
  M.sockets = socketForE ? [socketForE] : [];
  M.attachment = {
    type: 'socket',
    parentSocketId: socketForM.id,
    plug: { x: 0, y: 0 },
    jointWidth: openingWidth ?? undefined,
  };
  if (E) M.children = [E.id];

  const S2: Node = {
    ...S,
    children: E ? S.children.map((c) => (c === E.id ? midId : c)) : [...S.children, midId],
    sockets: [...S.sockets, socketForM],
  };
  const E2: Node | undefined = E && socketForE
    ? { ...E, parentId: midId, attachment: { ...E.attachment, parentSocketId: socketForE.id } }
    : undefined;

  // ---- 逐集处理件 ----
  const newSprites: Sprite[] = [];
  const cutCache = new Map<string, CutResult>();
  const newSets: CostumeSet[] = [];
  const stackFixups: { setId: string; k: number }[] = [];
  let jointWidthFromCut: number | null = null;

  const gridAxisFor = (
    grid: Sprite, dir: number,
  ): { ux: number; uy: number; segLocal: number } | null => {
    if (E) {
      const wt = restFor(dir);
      const sc = worldPosPx(wt, S.id, dir as DirectionIndex);
      const ec = worldPosPx(wt, E.id, dir as DirectionIndex);
      const v = { x: ec.x - sc.x, y: ec.y - sc.y };
      const ll = Math.hypot(v.x, v.y);
      if (ll < 1e-6) return null;
      const ang = ((wt.get(S.id)?.worldAngle ?? 0) * Math.PI) / 180;
      return {
        ux: (v.x * Math.cos(ang) + v.y * Math.sin(ang)) / ll,
        uy: (-v.x * Math.sin(ang) + v.y * Math.cos(ang)) / ll,
        segLocal: ll,
      };
    }
    const plugX = grid.plug ? subToPx(grid.plug.x) : grid.width / 2;
    const plugY = grid.plug ? subToPx(grid.plug.y) : grid.height / 2;
    const end = computeSpriteEndPoint(grid.width, grid.height, plugX, plugY);
    const ll = Math.hypot(end.x, end.y);
    if (ll < 1e-6) return null;
    return { ux: end.x / ll, uy: end.y / ll, segLocal: ll };
  };

  for (const set of character.costumeSets ?? []) {
    const pS = pieceOf(set);
    if (!pS) { newSets.push(set); continue; }
    const isActive = set === activeSet;
    const mode = pS.parametric?.composite ?? 'generate';
    const isParamGenerate = !!pS.parametric && mode === 'generate';

    const pS2: CostumePiece = { ...pS, sprites: { ...pS.sprites } };
    if (pS.variantSprites) pS2.variantSprites = Object.fromEntries(Object.entries(pS.variantSprites).map(([k, v]) => [k, { ...v }]));
    if (pS.latitudeSprites) pS2.latitudeSprites = Object.fromEntries(Object.entries(pS.latitudeSprites).map(([k, v]) => [k, { ...v }]));
    pS2.scaleVariants = Object.fromEntries(Object.entries(pS.scaleVariants ?? {}).map(([k, v]) => [k, { ...v }]));
    const pM: CostumePiece = createDefaultCostumePiece(midSlotKey, pS.fillColor);
    pM.mirrorMap = structuredClone(pS.mirrorMap);
    pM.crossSections = structuredClone(pS.crossSections ?? []);
    let mHasContent = false;

    // -- 精灵条目 --
    if (!isParamGenerate) {
      const processMap = (
        getMap: (p: CostumePiece) => Partial<Record<number, Sprite | { spriteId: string }>> | undefined,
        setMap: (p: CostumePiece, m: Partial<Record<number, Sprite | { spriteId: string }>>) => void,
      ) => {
        const srcMap = getMap(pS);
        if (!srcMap) return;
        const outS: Partial<Record<number, Sprite | { spriteId: string }>> = { ...srcMap };
        const outM: Partial<Record<number, Sprite | { spriteId: string }>> = {};
        for (const [dirKey, entry] of Object.entries(srcMap)) {
          if (!entry) continue;
          const dir = Number(dirKey);
          const grid = resolveGrid(entry as Sprite | { spriteId: string });
          if (!grid) continue;
          const axis = gridAxisFor(grid, dir);
          if (!axis || axis.segLocal < MIN_LOCAL_SEG_PX) {
            report.push(`服装集「${set.name}」方向 ${dir}：图内段长不足，整幅留原节点`);
            continue;
          }
          const plugX = grid.plug ? subToPx(grid.plug.x) : grid.width / 2;
          const plugY = grid.plug ? subToPx(grid.plug.y) : grid.height / 2;
          const cacheKey = `${(grid as Sprite).id ?? ''}|${dir}|${(grid as Sprite).name ?? ''}|${grid.width}x${grid.height}`;
          let cut = cutCache.get(cacheKey);
          if (!cut) {
            cut = cutGrid(grid, {
              plugX, plugY, ux: axis.ux, uy: axis.uy,
              cutDist: t * axis.segLocal, w: grid.width, h: grid.height,
            }, { near: `${grid.name ?? S.name}·近`, far: `${grid.name ?? S.name}·远` });
            cutCache.set(cacheKey, cut);
            if (cut.near) newSprites.push(cut.near);
            if (cut.far) newSprites.push(cut.far);
          }
          if (isActive && dir === args.direction && cut.openingWidth != null) {
            jointWidthFromCut = cut.openingWidth;
          }
          if (cut.skipped === 'empty-far') {
            report.push(`服装集「${set.name}」方向 ${dir}：图未过拆分点，整幅留原节点`);
            continue;
          }
          if (cut.skipped === 'empty-near-moved' && cut.far) {
            delete outS[dir as DirectionIndex];
            outM[dir as DirectionIndex] = { spriteId: cut.far.id! };
            mHasContent = true;
            report.push(`服装集「${set.name}」方向 ${dir}：近段无像素，整幅改挂新关节`);
            continue;
          }
          if (cut.near && cut.far) {
            outS[dir as DirectionIndex] = { spriteId: cut.near.id! };
            outM[dir as DirectionIndex] = { spriteId: cut.far.id! };
            mHasContent = true;
          }
        }
        setMap(pS2, outS);
        if (Object.keys(outM).length > 0) setMap(pM, outM);
      };
      processMap((p) => p.sprites, (p, m) => { p.sprites = m as CostumePiece['sprites']; });
      // 变体 / 纬度 / 缩放三套子图：结构同构（子键 → 方向 → 条目），逐子键走同一处理
      const processNested = (
        getNested: (p: CostumePiece) => Record<string, Partial<Record<number, Sprite | { spriteId: string }>>> | undefined,
        setNested: (p: CostumePiece, n: Record<string, Partial<Record<number, Sprite | { spriteId: string }>>>) => void,
      ) => {
        const nested = getNested(pS);
        if (!nested) return;
        const outSN: Record<string, Partial<Record<number, Sprite | { spriteId: string }>>> = {};
        const outMN: Record<string, Partial<Record<number, Sprite | { spriteId: string }>>> = {};
        for (const [subKey, subMap] of Object.entries(nested)) {
          const outS: Partial<Record<number, Sprite | { spriteId: string }>> = { ...subMap };
          const outM: Partial<Record<number, Sprite | { spriteId: string }>> = {};
          for (const [dirKey, entry] of Object.entries(subMap)) {
            if (!entry) continue;
            const dir = Number(dirKey);
            const grid = resolveGrid(entry as Sprite | { spriteId: string });
            if (!grid) continue;
            const axis = gridAxisFor(grid, dir);
            if (!axis || axis.segLocal < MIN_LOCAL_SEG_PX) {
              report.push(`服装集「${set.name}」子图 ${subKey} 方向 ${dir}：图内段长不足，整幅留原节点`);
              continue;
            }
            const plugX = grid.plug ? subToPx(grid.plug.x) : grid.width / 2;
            const plugY = grid.plug ? subToPx(grid.plug.y) : grid.height / 2;
            const cacheKey = `${(grid as Sprite).id ?? ''}|${dir}|${(grid as Sprite).name ?? ''}|${grid.width}x${grid.height}`;
            let cut = cutCache.get(cacheKey);
            if (!cut) {
              cut = cutGrid(grid, {
                plugX, plugY, ux: axis.ux, uy: axis.uy,
                cutDist: t * axis.segLocal, w: grid.width, h: grid.height,
              }, { near: `${grid.name ?? S.name}·近`, far: `${grid.name ?? S.name}·远` });
              cutCache.set(cacheKey, cut);
              if (cut.near) newSprites.push(cut.near);
              if (cut.far) newSprites.push(cut.far);
            }
            if (cut.skipped === 'empty-far') continue;
            if (cut.skipped === 'empty-near-moved' && cut.far) {
              delete outS[dir as DirectionIndex];
              outM[dir as DirectionIndex] = { spriteId: cut.far.id! };
              mHasContent = true;
              continue;
            }
            if (cut.near && cut.far) {
              outS[dir as DirectionIndex] = { spriteId: cut.near.id! };
              outM[dir as DirectionIndex] = { spriteId: cut.far.id! };
              mHasContent = true;
            }
          }
          outSN[subKey] = outS;
          if (Object.keys(outM).length > 0) outMN[subKey] = outM;
        }
        setNested(pS2, outSN);
        if (Object.keys(outMN).length > 0) setNested(pM, outMN);
      };
      processNested(
        (p) => p.variantSprites as Record<string, Partial<Record<number, Sprite | { spriteId: string }>>> | undefined,
        (p, n) => { p.variantSprites = n as CostumePiece['variantSprites']; },
      );
      processNested(
        (p) => p.latitudeSprites as unknown as Record<string, Partial<Record<number, Sprite | { spriteId: string }>>> | undefined,
        (p, n) => { p.latitudeSprites = n as unknown as CostumePiece['latitudeSprites']; },
      );
      processNested(
        (p) => p.scaleVariants as Record<string, Partial<Record<number, Sprite | { spriteId: string }>>> | undefined,
        (p, n) => { p.scaleVariants = n as CostumePiece['scaleVariants']; },
      );
    } else {
      report.push(`服装集「${set.name}」：参数化独立生成件整件留原节点`);
    }

    // -- 堆叠 --
    if (pS.stack) {
      const st = pS.stack;
      const layers = st.layerSpriteIds.length;
      if (layers >= 2) {
        const k = Math.max(1, Math.min(layers - 1, Math.round((t * segLenT) / Math.max(1e-6, st.layerThickness))));
        pS2.stack = { ...st, layerSpriteIds: st.layerSpriteIds.slice(0, k) };
        pM.stack = {
          ...st,
          layerSpriteIds: st.layerSpriteIds.slice(k),
          origin: { ...st.origin }, // 占位，下面按新角色静止帧回填
          marks: undefined,
        };
        if (st.marks?.length) report.push(`服装集「${set.name}」：摞级标记保留在原节点摞上`);
        mHasContent = true;
        stackFixups.push({ setId: set.id, k });
      } else {
        report.push(`服装集「${set.name}」：堆叠只有 1 层，整摞留原节点`);
      }
    }

    // -- 参数化（借剪影/叠加）：底图已切，定义复制给 M --
    if (pS.parametric && mode !== 'generate') {
      if (mHasContent) {
        pM.parametric = structuredClone(pS.parametric);
        report.push(`服装集「${set.name}」：参数化定义已复制给新关节（表面图案在切线处可能错位）`);
      } else {
        report.push(`服装集「${set.name}」：参数化底图未切出远段，定义留原节点`);
      }
    }
    if (pS.dynamicPatterns?.length) {
      report.push(`服装集「${set.name}」：件上动态图案保留在原节点`);
    }

    const pieces2 = { ...set.pieces, [sKey]: pS2 };
    if (mHasContent) pieces2[midSlotKey] = pM;
    newSets.push({ ...set, pieces: pieces2 });
    if (isActive) {
      if (S.slot) S2.slot = pS2;
      M.slot = mHasContent ? pM : createDefaultCostumePiece(midSlotKey, pS.fillColor);
    }
  }
  if (!M.slot) M.slot = createDefaultCostumePiece(midSlotKey);
  if (jointWidthFromCut != null) {
    M.attachment = { ...M.attachment, jointWidth: jointWidthFromCut };
  }

  // ---- 组装新角色 ----
  const newNodes: Record<string, Node> = { ...character.nodes, [S.id]: S2, [midId]: M };
  if (E && E2) newNodes[E.id] = E2;
  let newCharacter: Character = { ...character, nodes: newNodes, costumeSets: newSets };
  if (character.sprites) {
    const byId: Record<string, Sprite> = { ...character.sprites };
    for (const sp of newSprites) if (sp.id) byId[sp.id] = sp;
    newCharacter = { ...newCharacter, sprites: byId };
  }

  // ---- 摞远段原点回填（新角色静止帧下按帧轮换算） ----
  if (stackFixups.length > 0) {
    const wtOrig = restFor(args.direction);
    const wtNew = restTransforms(newCharacter, args.direction);
    const sPos = worldPos3Px(wtOrig, S.id);
    const mPos = worldPos3Px(wtNew, midId);
    const fS = wtOrig.get(S.id)?.worldFrame;
    const fM = wtNew.get(midId)?.worldFrame;
    if (fS && fM) {
      const sets3 = newCharacter.costumeSets.map((set) => {
        const fx = stackFixups.find((x) => x.setId === set.id);
        if (!fx) return set;
        const pS = (character.costumeSets ?? []).find((x) => x.id === set.id)?.pieces[sKey];
        const pM = set.pieces[midSlotKey];
        if (!pS?.stack || !pM?.stack) return set;
        const st = pS.stack;
        const local = {
          x: st.origin.x + st.axis.x * fx.k * st.layerThickness,
          y: st.origin.y + st.axis.y * fx.k * st.layerThickness,
          z: st.origin.z + st.axis.z * fx.k * st.layerThickness,
        };
        const w = applyFrameRotation(fS, local.x, local.y, local.z, args.direction);
        const rel = { x: sPos.x + w.x - mPos.x, y: sPos.y + w.y - mPos.y, z: sPos.z + w.z - mPos.z };
        const back = applyFrameRotation(mat3Transpose(fM), rel.x, rel.y, rel.z, args.direction);
        return {
          ...set,
          pieces: { ...set.pieces, [midSlotKey]: { ...pM, stack: { ...pM.stack, origin: back } } },
        };
      });
      newCharacter = { ...newCharacter, costumeSets: sets3 };
    }
  }

  // ---- IK 链段数变化点名 ----
  for (const chain of character.ikChains ?? []) {
    const path: string[] = [];
    let cur: Node | undefined = character.nodes[chain.endNodeId];
    let guard = 0;
    while (cur && guard++ < 512) {
      path.unshift(cur.id);
      if (cur.id === chain.rootNodeId) break;
      cur = cur.parentId ? character.nodes[cur.parentId] : undefined;
    }
    if (path[0] !== chain.rootNodeId) continue;
    const idx = path.indexOf(S.id);
    if (idx >= 0 && E && path[idx + 1] === E.id) {
      const before = path.length - 1;
      const after = before + 1;
      if (after >= 4) {
        report.push(`IK 链「${chain.name}」：段数 ${before}→${after}，超过 3 段解析上限，求解回落迭代`);
      } else {
        report.push(`IK 链「${chain.name}」：段数 ${before}→${after}，走 ${after} 骨解析`);
      }
    }
  }

  return { ok: true, character: newCharacter, newSprites, midNodeId: midId, report };
}

