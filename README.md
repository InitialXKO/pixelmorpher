# PixelMorpher — 像素动画创作软件

PixelMorpher 是一款功能强大的模块化像素动画创作工具，专为现代游戏开发者、像素艺术家和动画师设计。它打破了传统逐帧动画的限制，引入了基于“部件 + 修改器”的非线性工作流，让复杂的像素动画创作变得前所未有的简单与高效。

## 📖 项目简介

PixelMorpher 的核心理念是**“万物皆可模块化”**。通过将角色拆分为独立的部件（Parts），并为每个部件应用一系列可叠加的修改器（Modifiers），用户可以轻松实现平移、旋转、缩放、扭曲、波浪、粒子、甚至复杂的骨骼动力学效果。

- **项目定位**：专业级、模块化像素动画编辑器。
- **核心架构**：基于 Zustand 的响应式状态管理 + 多级渲染管线（Render Pipeline）。
- **适用场景**：游戏角色动画、环境特效、瓦片地图设计、程序化像素艺术。

---

## ✨ 功能特性

### 🎨 三大工作区模式
- **动画模式 (Animation Mode)**：核心工作区，支持部件管理、关键帧编辑、时间轴操作及修改器栈配置。
- **木偶模式 (Puppet Mode)**：针对角色设计的专用模式，支持节点绑定、精灵方向管理、服饰系统及关节盘渲染。
- **瓦片地图模式 (Map/Tile Mode)**：完整的工作流，从原材料到模板生成，再到自动平铺（Auto-tiling）和地图编辑。

### 🛠 强大的修改器系统 (30+)
- **变换类**：平移 (Translate)、旋转 (Rotate)、统一缩放 (Uniform Scale)、非均匀拉伸 (Non-uniform Stretch)、倾斜 (Skew)。
- **视觉类**：颜色替换、轮廓线 (Outline)、抖动 (Dither)、发光 (Glow)、残影 (Afterimage)、噪声 (Noise)。
- **物理与动力学**：简单物理、弹簧 (Spring)、抖动 (Jitter)、摆钟 (Pendulum)、呼吸 (Breath)、弹性 (Elastic)、旋转轮 (Wheel)、跳动 (Bounce)。
- **像素变形**：纹理滚动 (Texture Scroll)、波浪变形 (Wave Deform)、轮廓滚动 (Contour Scroll)、几何弯曲 (Bend)、圆柱体旋转 (Cylinder Rotate)、球体旋转 (Sphere Rotate)。
- **特效类**：粒子系统 (Particle)、破碎瓦解 (Shatter & Dissolve)、能量湮灭 (Annihilate)、瞬移 (Teleport)、CRT 关机效果 (CRT Off)。

### 🦴 骨骼与动力学
- **骨骼系统**：支持多级骨骼绑定，通过可视化面板进行管理。
- **IK 系统**：反向动力学 (Inverse Kinematics) 支持，轻松实现自然的肢体动作。
- **参数驱动**：通过 `ParamDriver` 实现参数自动化，支持基于表达式 (Expression) 的高级动画驱动。

### 🤖 AI 与智能工具
- **SAM 集成**：集成 Meta 的 Segment Anything Model (SAM)，支持智能像素选区与自动抠图。
- **像素 Inpainting**：智能修补像素内容，移除或填充指定区域，修复破损图像。
- **运动分析**：自动分析图像序列的运动轨迹，辅助进行部件拆解与关键帧生成。

### 🔌 扩展与生态
- **插件系统**：完整的 JavaScript API，允许开发者编写自定义插件扩展编辑器功能。
- **预设系统**：一键保存和加载修改器组合，快速复用复杂的动画效果。
- **DCC 管线**：支持事件帧 (Events)、帧标签 (Frame Tags)、碰撞盒 (Hitbox/Hurtbox) 定义，无缝对接游戏引擎。

### 📦 导入与导出
- **格式支持**：支持导出高质量 GIF、单帧 PNG/JPEG。
- **深度集成**：支持 Aseprite (.ase/.aseprite) 导入，支持 Spritesheet 导入导出。
- **数据驱动**：支持导入 CSV 波形数据驱动复杂的程序化动画。

---

## 📚 详细文档 (Wiki)

为了帮助你更深入地使用 PixelMorpher，我们准备了详细的分类指南：

1.  **[用户指南](./wiki/UserGuide_CN.md)**：从导入资产到导出动画的全流程操作。
2.  **[修改器详解](./wiki/ModifierReference_CN.md)**：全部 30+ 种修改器的参数说明与应用场景。
3.  **[木偶系统指南](./wiki/PuppetSystem_CN.md)**：如何构建多视角、可换装的复杂角色。
4.  **[瓦片工作流指南](./wiki/TileWorkflow_CN.md)**：自动平铺与关卡设计的高效方案。
5.  **[插件开发指南](./wiki/PluginDevelopment_CN.md)**：使用 JavaScript 扩展你自己的工具。
6.  **[技术架构详解](./wiki/Architecture_CN.md)**：深入了解渲染管线、状态管理与 AI 集成。

---

## 🏗 技术架构

### 技术栈
- **前端框架**: Next.js 16 + React 19 (采用全 Client-side Rendering 模式以优化交互性能)
- **状态管理**: Zustand 5 (深度采用 Slice 模式拆分 14 个核心业务逻辑模块)
- **UI 组件**: Radix UI + Tailwind CSS 4 + Shadcn UI
- **面板布局**: react-resizable-panels (支持高度自定义的编辑器布局)
- **图形渲染**: 高性能模块化渲染管线 + 原生 HTML5 Canvas
- **AI 运行时**: ONNX Runtime Web (支持 WebAssembly 硬件加速)
- **构建工具**: Bun / Next.js / Esbuild

### 核心目录结构
```text
src/
├── app/                # 页面入口 (page.tsx 为核心编辑器)
├── components/         # 200+ UI 组件
│   ├── pixel-editor/   # 核心编辑器面板 (Part, Modifier, Timeline, Puppet 等)
│   └── ui/             # Shadcn 基础原子组件
├── lib/
│   ├── engine/         # 核心渲染引擎 (Render Pipeline, Modifier Renderers, Skeleton, Puppet)
│   ├── store/          # 全局状态管理 (Project, Editor, Animation, Modifier, Puppet 等 Slices)
│   ├── sam.ts          # Segment Anything Model 集成逻辑
│   ├── inpainting.ts   # 像素修补算法
│   ├── plugin-api.ts   # 插件系统对外 API 定义
│   └── types.ts        # ~2000 行核心数据模型与类型定义
└── public/             # 静态资源 (SAM Worker, ONNX WASM 运行时, 模型权重)
```

### 渲染管线 (Render Pipeline)
PixelMorpher 采用多级管线架构，确保在处理复杂修改器栈时仍能保持流畅的 60FPS：
1. **基础像素解析 (Base Pixel Parsing)**：从 `Part` 数据中提取原始 RGBA 缓冲。
2. **编辑实时层 (Live Edit Layer)**：应用当前未提交的笔刷描边与编辑命令。
3. **关键帧插值 (Keyframe Interpolation)**：计算当前时间戳下的修改器参数插值。
4. **变换级渲染 (Transform Rendering)**：处理平移、旋转、缩放等矩阵变换。
5. **变形级渲染 (Deform Rendering)**：在像素格级别执行非线性扭曲、波动等算法。
6. **后期效果合成 (Post-Processing)**：叠加全局效果、洋葱皮 (Onion Skin) 及辅助线。

---

## 🚀 快速开始

### 环境要求
- **Node.js**: 18.0.0 或更高版本
- **包管理器**: 推荐使用 `bun` 以获得最快的开发体验

### 安装步骤
1. 克隆仓库：
   ```bash
   git clone https://github.com/InitialXKO/pixelmorpher.git
   cd pixelmorpher
   ```
2. 安装依赖：
   ```bash
   bun install # 或 npm install
   ```
3. 准备 SAM 运行时环境：
   ```bash
   npm run build:sam-worker  # 构建 AI 离线工作流
   npm run copy:ort-wasm     # 部署 WebAssembly 运行时
   ```
4. 启动开发服务器：
   ```bash
   npm run dev
   ```
5. 访问 `http://localhost:3000`。

### 构建生产版本
```bash
npm run build
```

---

## 🎮 操作指南

### 工作区切换
编辑器顶部居中位置提供工作区切换器：
- **动画 (Animation)**：处理部件的运动与特效。
- **木偶 (Puppet)**：定义角色的层级结构与方向表现。
- **地图 (Map)**：使用 Tile Workflow 进行关卡设计。

### 动画创作核心流程
1. **资产管理**：在“资产库”导入 PNG 或 Aseprite 文件。
2. **部件拆解**：使用“自动拆分”或 SAM 智能选区将图像拆分为可独立运动的部件。
3. **修改器配置**：
   - 选中部件，在“修改器面板”点击“添加”。
   - 示例：添加 `rotate` 修改器并调整 `pivot`（轴点）。
4. **时间轴编辑**：
   - 在时间轴上点击 `+` 记录当前状态为关键帧。
   - 调整时间指针到新位置，修改部件参数，再次记录。
5. **脚本与自动化**：使用“脚本面板”编写逻辑，或使用“表达式修改器”实现数学驱动的运动。

### 木偶系统 (Puppet System)
木偶系统允许你创建“一次绑定，多向复用”的角色：
- **节点 (Nodes)**：定义头、躯干、肢体等层级。
- **精灵分配 (Sprite Assignment)**：为 4/8 方向视图分配不同的部件。
- **服饰 (Apparel)**：定义“插槽” (Socket) 与“插件” (Plug)，实现一键换装系统。

### 瓦片地图工作流 (Tile Workflow)
1. **材料 (Material)**：导入一张 3x3 或自定义的平铺素材。
2. **模板 (Template)**：根据王字格或井字格生成瓦片模板。
3. **生成 (Generate)**：自动切割并生成所有边缘连接处的 Tile 块。
4. **绘制 (Paint)**：在地图编辑模式下使用“自动平铺笔刷”绘制地形。

### 高级笔刷系统
编辑器内置了 20 余种高级笔刷样式：
- **传统类**：像素点、方块、十字、菱形。
- **特效类**：暖光团、魔法光、火焰、灵魂火、烟雾。
- **几何类**：书法渐细笔、金属管道、波纹管、藤蔓、触手。
- **符号类**：星形、爱心、表情符号、标点符号。

---

## 🧩 插件系统

PixelMorpher 旨在成为一个可扩展的平台。通过插件，你可以访问编辑器的底层数据并添加自定义交互。

### 核心 API (`PixelMorpherAPI`)
- `api.project`: 访问和修改当前项目的所有部件、动画、剪辑。
- `api.editor`: 控制 UI 状态，如选中项、视图缩放、当前模式。
- `api.render`: 触发布帧重绘或强制管线刷新。
- `api.io`: 处理 Aseprite/GIF/PNG 的导入导出逻辑。

### 开发示例
```javascript
// my-plugin.js
export default {
  id: 'pm-auto-breathe',
  name: '自动呼吸插件',
  onLoad: (api) => {
    console.log('插件已加载');
  },
  execute: (api) => {
    const selectedId = api.editor.getSelectedPartId();
    if (selectedId) {
      api.project.addModifier(selectedId, {
        type: 'breath',
        params: { speed: 1.5, intensity: 0.1 }
      });
    }
  }
};
```

---

## 📊 数据格式与兼容性

### 项目文件 (.pixelmorpher)
项目采用开放的 JSON 结构存储，核心模型遵循 `ProjectData` 接口。你可以直接使用文本编辑器查看和编辑：
- `parts`: 包含 `Uint8ClampedArray` 的像素 Base64 数据。
- `animationClips`: 包含层级式的关键帧数据。
- `skeletons`: 存储骨骼拓扑与 IK 约束。

### 兼容性
- **Aseprite**: 完整支持层 (Layers) 与帧 (Frames) 的导入，保留原始动画结构。
- **Spritesheet**: 支持导出符合 Unity/Godot/Cocos 标准的图集。
- **GIF**: 内置高精度量化算法，确保像素颜色不丢失。

---

## 🔧 系统配置
- **多级撤销**：支持多达 100 步的历史记录回滚。
- **自动保存**：每 5 分钟执行一次本地增量备份，意外关闭可快速恢复。
- **渲染加速**：支持 OffscreenCanvas（如果浏览器支持）以减少主线程压力。
- **移动端适配**：支持基础的触屏操作与平板笔刷压感。

---

## 🧪 开发与贡献
PixelMorpher 是一个活跃开发的开源项目。欢迎通过以下方式参与：
- **提交 Issue**：报告 Bug 或提出新功能建议。
- **贡献代码**：请遵循现有的 TypeScript 风格指南。
- **编写插件**：在社区分享你的自定义修改器或工具。

## 📄 许可证
本项目采用 **MIT License**。详情请参阅 [LICENSE](LICENSE) 文件。

---
由 [PixelMorpher Team] 倾情打造。让每一颗像素都动起来！
