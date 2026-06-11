# 修改器详解 (Modifier Reference)

修改器是 PixelMorpher 的灵魂。它们可以叠加使用，形成复杂的动画管线。修改器分为两大类：**变换修改器**（Transform Modifiers）和**像素修改器**（Pixel Modifiers）。

## 1. 变换修改器 (Transform Modifiers)
这类修改器操作部件的整体矩阵，性能极高，适合基础运动。

### Translate (平移)
*   **x, y**: 偏移量。
*   **作用**: 控制部件在画布上的位置。

### Rotate (旋转)
*   **angle**: 旋转角度（度）。
*   **pivotX, pivotY**: 旋转中心点（0-1 比例，0.5 为中心）。
*   **作用**: 让部件绕指定点旋转，如手臂绕肩膀旋转。

### Uniform Scale (等比缩放)
*   **scale**: 缩放倍率。
*   **作用**: 整体放大或缩小。

### Skew (倾斜)
*   **skewX, skewY**: 倾斜角度。
*   **作用**: 模拟伪 3D 或运动拉伸感。

---

## 2. 像素级修改器 (Pixel Modifiers)
这类修改器直接操作像素网格，支持复杂的变形效果。

### Wave Deform (波浪变形)
*   **amplitude**: 振幅。
*   **frequency**: 频率。
*   **speed**: 移动速度。
*   **axis**: 'horizontal' 或 'vertical'。
*   **作用**: 模拟旗帜飘动、水波纹或角色的柔软感。

### Texture Scroll (纹理滚动)
*   **speedX, speedY**: 滚动速度。
*   **作用**: 在部件形状内循环滚动像素，常用于传送带、流动的能量管。

### Outline (轮廓线)
*   **color**: 轮廓颜色。
*   **thickness**: 厚度。
*   **作用**: 动态为部件添加边框，常用于高亮选中状态。

### Dither (抖动/减色)
*   **levels**: 阶数。
*   **作用**: 模拟复古像素画的渐变感。

### Shatter & Dissolve (破碎与瓦解)
*   **progress**: 0-1 进度。
*   **seed**: 随机种子。
*   **作用**: 将部件分解成碎片并逐渐消失，适用于死亡或传送特效。

### Breath (呼吸)
*   **speed**: 速度。
*   **intensity**: 强度。
*   **作用**: 自动让部件产生有节奏的缩放，模拟生物呼吸。

---

## 3. 修改器堆栈原理
修改器是按**自上而下**的顺序执行的。
*   例如：如果你先放 `Rotate` 后放 `Translate`，部件会先在原地旋转再平移。
*   如果你先放 `Translate` 后放 `Rotate`，部件会绕画布的原点（或者平移后的点，取决于实现逻辑）进行大半径公转。

在面板中，你可以通过拖拽来调整修改器的顺序。

## 4. 程序化与表达式
*   **Expression Modifier**: 允许你输入数学公式（如 `Math.sin(time * 2) * 10`）来驱动参数。
*   **ParamDriver**: 这是一个高级功能，可以将一个部件的参数绑定到另一个部件上，实现联动。

---
建议继续阅读 [木偶系统指南](./PuppetSystem_CN.md) 了解如何构建复杂的角色。
