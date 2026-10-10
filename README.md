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

## 状态

重构进行中。地图瓦片模式已删除。旧版 30+ 修改器正在迁移为蓝图节点。AI 工具（SAM/Inpainting）、插件系统等旧功能状态未验证。
