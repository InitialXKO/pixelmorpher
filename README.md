# PixelMorpher — 像素木偶动画编辑器

基于 Next.js 16 + React 19 + Zustand 5 的像素角色动画工具。核心工作流：搭建骨架 → 换装 → 做动画。

## 功能

### 搭建 (Rig)
- **新建角色向导**：从模板一键生成完整角色（含骨架、默认精灵、服装集）。内置模板：一键小狗（四足奔跑）、人形、机甲、骑士、四足、简易等。
- **手动搭建**：创建节点层级，通过 Plug/Socket 连接关节，手动分配精灵。
- **精灵编辑器**：像素级绘制，支持洋葱皮、色键取色、关节开口切割。
- **新建道具**：单节点角色，用于背景/道具/UI 动画。

### 换装 (Dress)
- **服装集管理**：每个角色可有多套服装集，一键切换。
- **方向精灵**：8 方向（S/SE/E/NE/N/NW/W/SW）精灵分配，支持镜像映射。
- **精灵关联**：从全局精灵库为节点分配精灵。

### 操控 (Perform)
- **时间轴**：关键帧动画，支持位置/旋转/缩放/方向/层级。
- **蓝图 (Blueprint)**：声明式程序化动画 IR。每个节点可挂蓝图，由摆动、弹簧、波浪等节点连成图，按帧求值。蓝图优先于修改器列表。
- **IK**：2-bone 与 FABRIK 求解器，支持烘焙为蓝图。
- **方向盘**：8 方向 + 纬度控制角色朝向。

## 数据模型

- **Character**：`nodes`（节点表）、`rootNodeId`、`costumeSets`（服装集）、`activeCostumeSetId`
- **Node**：`transform`、`attachment`（socket/fixed）、`sockets`、`costumePiece`、`blueprint`、`children`
- **Sprite**：全局 `sprites` 表，按 ID 引用（`Character.sprites` 已废弃）
- **CostumePiece**：`slotKey`、`sprites[方向]`（SpriteRef）、`mirrorMap`

## 渲染管线

`renderUnified` → `generateRenderPlan`（世界变换 → 精灵解析 → 渲染指令）→ `executeRenderPlan`（Canvas 绘制）。

精灵解析顺序：当前服装集 → 节点自带 `costumePiece` → 节点内嵌精灵。

## 开发

```bash
npm install
npm run dev      # http://localhost:3000
npx tsc --noEmit # 类型检查
npm run build    # 生产构建
```

自动保存使用 OPFS（突破 localStorage 5MB 限制），旧数据自动迁移。

## 状态

- 旧 `puppet*` 管线已迁移至统一渲染，新旧模型通过 `LiveAdapter` 桥接。
- 蓝图为唯一渲染 IR，修改器列表为高层 UI（修改时手术式同步蓝图，不重建）。
- AI 工具（SAM/Inpainting）、插件系统等旧功能状态未验证。
