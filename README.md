# PixelMorpher — 像素木偶动画编辑器

基于 Next.js 16 + React 19 + Zustand 5 的像素角色动画工具。核心是木偶（Puppet）工作流：搭建骨架、换装、做动画。

## 工作区

- **项目管理**：项目列表、创建、打开。
- **木偶模式**：唯一的编辑工作区，分三个阶段：
  - **搭建 (Rig)**：创建节点层级、Plug/Socket 连接、分配精灵。
  - **换装 (Dress)**：服饰集管理。
  - **操控 (Perform)**：时间轴关键帧 + 蓝图程序化动画。

## 蓝图（Blueprint）

声明式的程序化动画 IR。每个木偶节点可挂一个蓝图图，由节点（摆动、弹簧、波浪等）连成图，按帧求值驱动 `rotation/translate/scale`。

- 蓝图优先于旧版修改器列表：节点有蓝图时，修改器列表不生效。
- 内置模板：一键小狗（含四足奔跑蓝图）、人形、机甲、骑士、四足等。

## 渲染

`renderUnified` → 木偶经 `interpolateNodeKeyframes` 求值（关键帧插值 + 蓝图/修改器）→ 烘焙进 skeleton → `LiveAdapter` 转统一角色 → `generateRenderPlan` → `executeRenderPlan`。

## 开发

```bash
npm install
npm run dev      # http://localhost:3000
npx tsc --noEmit # 类型检查
npm run build    # 生产构建
```

### Zustand 使用规范

`useProjectStore.getState()` 返回调用时刻的**不可变快照**，不是 live 引用。禁止以下写法：

```ts
// ❌ 错误：store 是快照，后续 addXxx 的更新看不到
const store = useProjectStore.getState();
store.addSprite(...);
store.sprites[id]; // 永远是 undefined！
```

批量创建（如新建角色向导）必须遵循旧写法：**内存里拼好完整对象，一次写入，不中途回读**。

```ts
// ✅ 正确
const nodes: Record<string, Node> = {};
for (const def of template.nodes) {
  const node = createDefaultNode(id, def.name);
  Object.assign(node, { ... }); // parentId, costumePiece 等
  nodes[id] = node;
}
// 建 children、rootNodeId、服装集，全部用局部变量
useProjectStore.getState().updateUnifiedCharacter(characterId, {
  nodes, rootNodeId, costumeSets, activeCostumeSetId,
});
```

### 角色创建

`addUnifiedCharacter(name)` 默认会建一个空 `'root'` 占位节点。自建骨架的调用方（向导、示例）必须传 `{ skipPlaceholderRoot: true }`，否则 `find((n) => !n.parentId)` 会命中占位而非真正的根（如 torso），导致渲染遍历不到节点。

单节点道具（`PuppetPanel` 的"新建道具"）可直接用占位 root，无需跳过。

## 状态

重构进行中。地图瓦片模式已删除。旧版 30+ 修改器正在迁移为蓝图节点。AI 工具（SAM/Inpainting）、插件系统等旧功能状态未验证。
