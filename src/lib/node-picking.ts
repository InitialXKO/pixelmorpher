// 节点命中挑选（编辑器专用，纯函数）：所见即所点——不再用「到关节
// 的距离」判命中，改成三遍形状判定，形状全部来自绘制同源数据：
//   tier 0：精灵不透明像素（按绘制变换逆映射采样）+ 关节盘圆面；
//   tier 1：细精灵（短边 ≤ 6px）与堆叠件的胶囊（关节 → 精灵末端）；
//   tier 2：无精灵节点的兜底胶囊（与人偶绘制同一份形状几何
//           computeMannequinShapes，含手脚延伸与蛋形头）。
// 三遍都没有 → 点不中（空地不选任何节点）。排序：tier 优先，tier 内
// 按贴近程度；中键循环切换按此序轮换候选。
import {
  computeWorldTransforms, computeMannequinShapes, resolveNodeSpriteId, socketOffsetTo3D,
} from './unified-render';
import {
  projectToView, pxToSub, subToPx, nodeJointDiscDiameter, computeSpriteEndPoint,
  rotateInViewPlane,
  type Character, type Node, type Sprite, type DirectionIndex,
} from './unified-types';

export interface NodePick {
  node: Node;
  character: Character;
  tier: 0 | 1 | 2;
  /** tier 内排序分（越小越优先） */
  score: number;
}

export interface PickOptions {
  sprites: Record<string, Sprite>;
  frame: number;
  canvasWidth: number;
  canvasHeight: number;
  geometryDirection?: DirectionIndex;
  /** 命中容差（画布 px）：形状边缘外扩此量，缺省 3 */
  slopPx?: number;
  /** 细精灵判定：短边 ≤ 此值（px）的精灵另走胶囊兜底，缺省 6 */
  thinMaxPx?: number;
}

function isOpaqueCell(c: string | null | undefined): boolean {
  if (!c || c === 'transparent') return false;
  if (/^#[0-9a-fA-F]{8}$/.test(c)) return !c.endsWith('00');
  if (/^#[0-9a-fA-F]{4}$/.test(c)) return !c.endsWith('0');
  return true;
}

/** 点到变半径胶囊的贴近度：dist − r(t)（≤ 0 = 在形内） */
function capsuleProximity(
  x1: number, y1: number, x2: number, y2: number, r1: number, r2: number,
  px: number, py: number,
): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 1e-9) t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const cx = x1 + dx * t, cy = y1 + dy * t;
  return Math.hypot(px - cx, py - cy) - (r1 + (r2 - r1) * t);
}

/** 精灵像素采样：点击点按绘制变换（枢轴 + 旋转 + 缩放 + 倾斜 + 镜像，
 * 与 renderNodeSprite 的 translate→rotate→scale→skew 同链）逆映射回
 * 精灵局部，落在不透明像素上算中。像素修改器/像素链改过的占据不在
 * 此列（按基础精灵图判）。 */
function spritePixelHit(
  sprite: Sprite,
  wt: { worldAngle: number; scaleX?: number; worldStretch: number; skewX?: number; skewY?: number; mirror: boolean },
  jointX: number, jointY: number,
  x: number, y: number,
): boolean {
  const w = sprite.width, h = sprite.height;
  if (!w || !h || !sprite.data) return false;
  const pivotX = sprite.plug ? subToPx(sprite.plug.x) : w / 2;
  const pivotY = sprite.plug ? subToPx(sprite.plug.y) : h / 2;
  let lx = x - jointX, ly = y - jointY;
  const rad = (-wt.worldAngle * Math.PI) / 180;
  const ca = Math.cos(rad), sa = Math.sin(rad);
  const rx = lx * ca - ly * sa, ry = lx * sa + ly * ca;
  lx = rx / (wt.scaleX || 1);
  ly = ry / (wt.worldStretch || 1);
  const tx = Math.tan(((wt.skewX ?? 0) * Math.PI) / 180), ty = Math.tan(((wt.skewY ?? 0) * Math.PI) / 180);
  if (tx !== 0 || ty !== 0) {
    const det = 1 - tx * ty;
    if (Math.abs(det) < 1e-6) return false;
    const ux = (lx - tx * ly) / det, uy = (ly - ty * lx) / det;
    lx = ux; ly = uy;
  }
  lx += wt.mirror ? w - pivotX : pivotX;
  ly += pivotY;
  const srcX = wt.mirror ? w - lx : lx;
  const cx = Math.floor(srcX), cy = Math.floor(ly);
  if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
  return isOpaqueCell(sprite.data[cy]?.[cx]);
}

export function pickNodesAt(
  characters: Character[],
  x: number, y: number,
  opts: PickOptions,
): NodePick[] {
  const slop = opts.slopPx ?? 3;
  const thinMax = opts.thinMaxPx ?? 6;
  const picks: NodePick[] = [];
  const centerX = opts.canvasWidth / 2;
  const centerY = opts.canvasHeight / 2;

  for (const character of characters) {
    const worldTransforms = computeWorldTransforms(
      character, opts.frame, opts.canvasWidth, opts.canvasHeight,
      undefined, undefined, undefined, undefined, opts.geometryDirection,
    );
    const rootNode = character.nodes[character.rootNodeId];
    const direction = (rootNode?.transform.variantIndex ?? 0) as DirectionIndex;
    const jointPx = new Map<string, { x: number; y: number; angle: number }>();
    for (const [nodeId, wt] of worldTransforms) {
      const proj = projectToView(wt.worldX, wt.worldY, wt.worldZ, direction);
      jointPx.set(nodeId, {
        x: subToPx(proj.canvasX) + centerX,
        y: subToPx(proj.canvasY) + centerY,
        angle: wt.worldAngle,
      });
    }
    const depthOf = (node: Node): number => {
      let d = 0;
      let cur: Node | undefined = node;
      const seen = new Set<string>();
      while (cur?.parentId && !seen.has(cur.id)) {
        seen.add(cur.id);
        d++;
        cur = character.nodes[cur.parentId];
      }
      return d;
    };
    const activeCs = character.costumeSets?.find((cs) => cs.id === character.activeCostumeSetId);
    const spritelessIds = new Set<string>();

    for (const node of Object.values(character.nodes)) {
      if (!node.visible) continue;
      const pos = jointPx.get(node.id);
      const wt = worldTransforms.get(node.id);
      if (!pos || !wt) continue;
      const depth = depthOf(node);
      const spriteId = resolveNodeSpriteId(character, node.id, direction, opts.sprites);
      const sprite = spriteId ? (opts.sprites[spriteId] ?? character.sprites?.[spriteId] ?? null) : null;
      if (!sprite) {
        spritelessIds.add(node.id);
        continue;
      }
      const piece = activeCs?.pieces?.[node.slot?.slotKey ?? ''] ?? node.slot;
      const hasStack = !!(piece as { stack?: unknown } | undefined)?.stack;

      if (!hasStack) {
        // tier 0 · 关节盘圆面（盘画在父 socket 处，属本节点）
        if (node.parentId && node.attachment?.type === 'socket' && node.attachment.parentSocketId
          && node.attachment.autoJointDisc !== false) {
          const parentWt = worldTransforms.get(node.parentId);
          const parentNode = character.nodes[node.parentId];
          const socket = parentNode?.sockets.find((s) => s.id === node.attachment!.parentSocketId);
          if (parentWt && parentNode && socket) {
            const s3 = socketOffsetTo3D(socket, parentWt.variantIndex);
            const rot = rotateInViewPlane(s3.x, s3.y, s3.z, parentWt.worldAngle, parentWt.variantIndex);
            const proj = projectToView(
              parentWt.worldX + pxToSub(rot.x), parentWt.worldY + pxToSub(rot.y), parentWt.worldZ + pxToSub(rot.z),
              direction,
            );
            const d = Math.hypot(x - (subToPx(proj.canvasX) + centerX), y - (subToPx(proj.canvasY) + centerY));
            const r = (nodeJointDiscDiameter(node) ?? 4) / 2;
            if (d <= r + slop) picks.push({ node, character, tier: 0, score: -depth * 1000 + d });
          }
        }
        // tier 0 · 精灵像素
        if (spritePixelHit(sprite, wt, pos.x, pos.y, x, y)) {
          picks.push({ node, character, tier: 0, score: -depth * 1000 + Math.hypot(x - pos.x, y - pos.y) * 0.01 });
        }
      }

      // tier 1 · 细精灵/堆叠胶囊（关节 → 精灵末端）
      const thin = Math.min(sprite.width, sprite.height) <= thinMax;
      if (hasStack || thin) {
        const endLocal = computeSpriteEndPoint(
          sprite.width, sprite.height,
          subToPx(sprite.plug?.x ?? 0), subToPx(sprite.plug?.y ?? 0),
        );
        const rad = (pos.angle * Math.PI) / 180;
        const endX = pos.x + endLocal.x * Math.cos(rad) - endLocal.y * Math.sin(rad);
        const endY = pos.y + endLocal.x * Math.sin(rad) + endLocal.y * Math.cos(rad);
        const discR = (nodeJointDiscDiameter(node) ?? 0) / 2;
        const halfThick = Math.max(Math.min(sprite.width, sprite.height) / 2, 1.2);
        const r1 = Math.max(discR, Math.min(halfThick, 4));
        const r2 = hasStack ? Math.max(r1 * 0.8, halfThick) : halfThick;
        const prox = capsuleProximity(pos.x, pos.y, endX, endY, r1, r2, x, y);
        if (prox <= slop) picks.push({ node, character, tier: 1, score: prox - depth * 0.001 });
      }
    }

    // tier 2 · 无精灵兜底胶囊（与绘制同一份形状；段归属与精灵属主
    // 对齐——段属起始关节的节点；joint 形状让关节点本身点中的是
    // 自己，半像素偏置压过父段在同一点的末端盖）
    if (spritelessIds.size > 0) {
      const shapes = computeMannequinShapes(
        character, worldTransforms, opts.canvasWidth, opts.canvasHeight,
        direction, spritelessIds, opts.geometryDirection,
      );
      for (const s of shapes) {
        const node = character.nodes[s.nodeId];
        if (!node) continue;
        if (s.kind === 'head' && s.head) {
          const { cx, cy, a, b, angleRad } = s.head;
          const dx = x - cx, dy = y - cy;
          const ca = Math.cos(-angleRad), sa = Math.sin(-angleRad);
          const lx = dx * ca - dy * sa, ly = dx * sa + dy * ca;
          const q = (lx / (a + slop)) ** 2 + (ly / (b + slop)) ** 2;
          if (q <= 1) picks.push({ node, character, tier: 2, score: q });
        } else {
          const prox = capsuleProximity(s.x1, s.y1, s.x2, s.y2, s.r1, s.r2, x, y);
          if (prox <= slop) picks.push({ node, character, tier: 2, score: s.kind === 'joint' ? prox - 0.5 : prox });
        }
      }
    }
  }

  picks.sort((a, b) => a.tier - b.tier || a.score - b.score);
  return picks;
}
