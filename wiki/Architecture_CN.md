# 技术架构详解 (Architecture & Technical Details)

PixelMorpher 采用现代 Web 技术栈构建，旨在在浏览器中提供接近桌面应用的交互体验和渲染性能。

## 1. 核心架构图
```text
[ 用户交互 (React 19) ]
        ↓
[ 状态管理 (Zustand 5) ] ← (持久化存储 IndexedDB)
        ↓
[ 渲染引擎 (HTML5 Canvas) ]
        ↓
[ 修改器管线 (Modifier Pipeline) ]
        ↓
[ 硬件加速 (WASM / ONNX) ]
```

## 2. 状态管理 (Zustand Slice 模式)
为了管理多达 2000 行的类型定义和复杂的应用状态，我们将 `store` 拆分为多个 Slice：
*   **Project Slice**: 存储核心数据（Parts, Animations, Palettes）。
*   **Editor Slice**: 处理 UI 瞬时状态（Selection, Tool settings, Zoom）。
*   **Modifier Slice**: 负责修改器参数的插值和实时计算。
*   **Puppet Slice**: 处理木偶层级和方向变换。
*   **Asset Slice**: 资产索引与 Base64 缓存。

这种模式确保了代码的可维护性，并允许我们实现颗粒度的历史记录（Undo/Redo）。

## 3. 渲染引擎
PixelMorpher 没有使用 WebGL，而是选择了更符合像素画精准度的 **Canvas 2D API**，并结合了以下优化：
*   **层级缓存 (Layer Caching)**：未受修改器影响的部件会被缓存为静态 Canvas 对象。
*   **离屏渲染 (Offscreen Rendering)**：复杂的变形算法在离屏 Canvas 中完成，最后一次性合成。
*   **位图操作**: 对于像素级修改器（如 Dither 或 Shatter），我们直接通过 `ImageData.data` 操作 Uint8ClampedArray。

## 4. AI 模块集成
*   **Segment Anything (SAM)**: 运行在 `public/sam-worker/` 下的独立 Web Worker 中。
*   **ONNX Runtime Web**: 用于加载 `MobileSAM` 量化模型，利用浏览器的 WebAssembly 扩展（SIMD）进行加速。
*   **逻辑流**: 主线程发送像素数据 → Worker 调用 ONNX 执行推理 → 返回掩码（Mask）→ 主线程解析掩码并创建新部件。

## 5. 构建与部署
*   **Next.js App Router**: 核心 UI 布局。
*   **Bun**: 用于极速依赖安装和脚本运行。
*   **Esbuild**: 在构建时将插件 API 和 Worker 脚本打包。

---
感谢阅读！如果你有任何技术问题，欢迎在 GitHub 提交 Issue。
