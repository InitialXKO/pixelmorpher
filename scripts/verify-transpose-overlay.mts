// 转位克隆取位同源探针（行为）：覆盖层标签与命中都裸调
// computeWorldTransforms 取点——克隆根的 rotate 修改器必须经
// computeWorldTransforms 内部的蓝图/修改器求值兜底生效，否则
// 克隆体在覆盖层/命中里停在原位（精灵却已转过去）。
import { computeWorldTransforms } from '../src/lib/unified-render';
import { cloneSubtreeTransposed } from '../src/lib/clone-transpose';
import {
  createDefaultNode, pxToSub, subToPx, type Character,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const mkNode = (id: string, name: string, parentId?: string) => {
  const n = createDefaultNode(id, name);
  n.id = id;
  // 真实角色全节点同朝向（variantIndex 6）：frame 与偏移都在 6 号
  // 基下复合；缺了它偏移会落进 0 号基的深度轴、平面旋转不生效
  (n.transform as any).variantIndex = 6;
  if (parentId) n.parentId = parentId;
  return n;
};
const root = mkNode('tp_root', 'torso');
const arm = mkNode('tp_arm', 'upper_arm_R', root.id);
const fore = mkNode('tp_fore', 'lower_arm_R', arm.id);
root.children = [arm.id];
arm.children = [fore.id];
const sock = (id: string, x: number, y: number) => ({
  id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
});
root.sockets = [sock('tp_s_arm', -30, 0)];
arm.sockets = [sock('tp_s_fore', -35, 0)];
arm.attachment = { type: 'socket', parentSocketId: 'tp_s_arm', plug: { x: 0, y: 0 } } as never;
fore.attachment = { type: 'socket', parentSocketId: 'tp_s_fore', plug: { x: 0, y: 0 } } as never;
const character = {
  id: 'tp1', name: '转位测试', nodes: { [root.id]: root, [arm.id]: arm, [fore.id]: fore },
  rootNodeId: root.id, sprites: {}, costumeSets: [], activeCostumeSetId: undefined,
  direction: 6, latitude: 0, ikChains: [],
} as unknown as Character;

const W = 512, H = 512;
const fkSrc = computeWorldTransforms(character, 0, W, H, 12);
const armPos = fkSrc.get(arm.id)!;
const forePos = fkSrc.get(fore.id)!;
const offSrc = {
  x: subToPx(forePos.worldX) - subToPx(armPos.worldX),
  y: subToPx(forePos.worldY) - subToPx(armPos.worldY),
};
ok(Math.abs(Math.hypot(offSrc.x, offSrc.y) - 35) < 0.5, `源前臂偏移长 35（实际 ${Math.hypot(offSrc.x, offSrc.y).toFixed(1)}）`);

let seq = 0;
const res = cloneSubtreeTransposed(character, arm.id, 90, (p) => `${p}_x${seq++}`, { width: W, height: H });
ok(!!res, '转位克隆 90° 成功');
if (res) {
  const cloned = res.character;
  const cloneRootId = res.newRootId;
  const cloneForeId = cloned.nodes[cloneRootId]!.children[0]!;
  // 与覆盖层/命中完全同一条取位路径（不传 blueprintTransforms）
  const fk = computeWorldTransforms(cloned, 0, W, H, 12);
  const cRoot = fk.get(cloneRootId)!;
  const cFore = fk.get(cloneForeId)!;
  const rootSame = Math.hypot(subToPx(cRoot.worldX) - subToPx(armPos.worldX), subToPx(cRoot.worldY) - subToPx(armPos.worldY));
  ok(rootSame < 0.5, `克隆根仍在附着点（偏移 ${rootSame.toFixed(2)}px）`);
  const offC = {
    x: subToPx(cFore.worldX) - subToPx(cRoot.worldX),
    y: subToPx(cFore.worldY) - subToPx(cRoot.worldY),
  };
  const dot = (offC.x * offSrc.x + offC.y * offSrc.y) / (Math.hypot(offC.x, offC.y) * Math.hypot(offSrc.x, offSrc.y) || 1);
  ok(Math.abs(Math.hypot(offC.x, offC.y) - 35) < 1, `克隆前臂长不变（实际 ${Math.hypot(offC.x, offC.y).toFixed(1)}）`);
  ok(Math.abs(dot) < 0.05, `克隆前臂方向已转 90°（与源方向 dot ${dot.toFixed(2)} ≈ 0）`);
  const srcForeAfter = fk.get(fore.id)!;
  const srcSame = Math.hypot(subToPx(srcForeAfter.worldX) - subToPx(forePos.worldX), subToPx(srcForeAfter.worldY) - subToPx(forePos.worldY));
  ok(srcSame < 0.5, '原前臂位置不受影响');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
