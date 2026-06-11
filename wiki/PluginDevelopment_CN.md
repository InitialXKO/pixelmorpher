# 插件开发指南 (Plugin Development Guide)

PixelMorpher 是一个完全开放的平台。你可以通过 JavaScript 编写插件来添加自定义修改器、工具面板或自动化流程。

## 1. 插件结构
一个基础插件是一个导出特定接口的 JS 对象。

```javascript
export default {
  // 插件唯一标识符
  id: 'my-custom-tool',
  
  // 显示在 UI 中的名称
  name: '我的自定义工具',
  
  // 插件加载时的初始化逻辑
  onLoad: (api) => {
    console.log('插件已就绪');
  },
  
  // 当用户点击工具栏按钮时触发
  execute: (api) => {
    // 逻辑代码
  },

  // (可选) 插件卸载时的清理逻辑
  onUnload: (api) => {
    // 清理定时器或订阅
  }
};
```

## 2. API 参考 (`PixelMorpherAPI`)
`api` 对象提供了对编辑器核心的所有访问权限：

### `api.project`
*   `getParts()`: 获取所有部件。
*   `addPart(name, width, height)`: 新建部件。
*   `updatePart(id, data)`: 修改部件像素或属性。
*   `addModifier(partId, modifierConfig)`: 给指定部件添加修改器。

### `api.editor`
*   `getSelectedPartId()`: 获取当前选中的部件 ID。
*   `setZoom(level)`: 调整画布缩放。
*   `showMessage(text, type)`: 在 UI 中弹出提示信息。

### `api.io`
*   `importImage(file)`: 导入外部图像。
*   `exportGif()`: 触发 GIF 导出流程。

## 3. 示例：批量添加“旋转”效果
```javascript
export default {
  id: 'batch-rotate',
  name: '批量旋转助手',
  execute: (api) => {
    const parts = api.project.getParts();
    parts.forEach(part => {
      api.project.addModifier(part.id, {
        type: 'rotate',
        params: { angle: 10 }
      });
    });
    api.editor.showMessage('已为所有部件添加旋转修改器！');
  }
};
```

## 4. 如何调试
1.  在项目根目录的 `plugins/` 文件夹下创建你的 `.js` 文件。
2.  在编辑器中打开“插件面板” (Plugin Panel)。
3.  点击“刷新/加载本地插件”。
4.  使用浏览器的开发者工具 (F12) 查看控制台输出。

---
建议继续阅读 [技术架构详解](./Architecture_CN.md) 了解底层实现。
