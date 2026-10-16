# 主画布精灵渲染全链条

## 数据流向

```
Character
├── nodes: Record<nodeId, Node>
│   ├── transform: { x, y, angle, stretch, variantIndex }  // SubPixel
│   ├── attachment: { type: 'socket'|'fixed', parentSocketId, plug, fixedOffset }
│   ├── sockets: Socket[]  // basePosition: SubPixel
│   └── slot: { slotKey }  // 服装槽位定义（无 sprites）
├── costumeSets: CostumeSet[]
│   └── pieces: Record<slotKey, CostumePiece>
│       └── sprites: Record<DirectionIndex, { spriteId }>
├── activeCostumeSetId
└── rootNodeId

全局 sprites 表 (projectStore.sprites): Record<spriteId, Sprite>
Sprite { id, width, height, data: PixelGrid, plug: { x, y } }
```

## 渲染阶段

### Phase 0: 蓝图求值（可选）
`evaluateBlueprintTransforms(character, frame)` → `Map<nodeId, BlueprintTransformResult>`
- 有蓝图时：modifier 贡献走蓝图
- 无蓝图时：走旧 `resolveNodeModifiers`

### Step 1: 世界变换 `computeWorldTransforms`
`src/lib/unified-render.ts:193`

**Root**:
```
worldX = pxToSub(canvasWidth/2) + interpolate(x)
worldY = pxToSub(canvasHeight/2) + interpolate(y)
worldAngle = interpolate(angle)
```
全 SubPixel 域。

**Socket 子节点**（`computeChildTransforms:543`）：
```
socketOffset = resolveSocketOffset(socket, parent.variantIndex)  // SubPixel
rotatedSocket = rotate(socketOffset, parent.worldAngle)          // 经 subToPx→旋转→pxToSub
rotatedChild = rotate(childOffset, parent.worldAngle)
childWorld = parentWorld + rotatedSocket + rotatedChild          // 全 SubPixel，不减 plug
childAngle = parent.worldAngle + child.angle（inheritRotation 时）
```

**Fixed 子节点**：
```
totalOffset = fixedOffset + childOffset  // SubPixel
rotated = rotate(totalOffset, parent.worldAngle)
childWorld = parentWorld + rotated
```

**单位铁律**：全链 SubPixel，仅在旋转 cos/sin 前转像素，旋后转回。

### Step 2: Z 排序 `computeZOrder`
按 `zIndex` + 深度算绘制顺序，关节盘单独一层。

### Step 3: 取激活服装集
```
activeCostumeSet = costumeSets.find(cs.id === activeCostumeSetId)
```

### Step 4: 逐节点生成指令 `NodeRenderInstruction`
对每个 visible 节点：

**4a. 精灵解析 `resolveSprite`**（`unified-render.ts:970`）：
```
1. costumeSet.pieces[node.slot.slotKey].sprites[direction] → { spriteId } → sprites[spriteId]
   └─ mirrorMap[direction] 存在时取镜像源
2. node.slot.sprites[direction] → 同上（模板 fallback，正常为空）
3. node.sprite → 旧 fallback（新向导不设）
```
`direction` = root.transform.variantIndex（0=E, 1=NE, 2=N, 3=NW, 4=W, 5=SW, 6=S, 7=SE）

**4b. 旋转策略**：
- `pixel-perfect`（angle≠0 或 stretch≠1 且 scaleX=1 无 skew）：4x 超采样旋转
- 否则：Canvas2D 原生 `setTransform`

**4c. Pivot**（`unified-render.ts:1586`）：
```
pivotX = subToPx(sprite.plug.x) + modOffsetX
pivotY = subToPx(sprite.plug.y) + modOffsetY
```
精灵的 plug 点对准节点 world 坐标。

### Step 5: 执行 `executeRenderPlan`
按 Z 序逐条执行：
- pixel-perfect 路径：`drawImage(rotatedCanvas, subToPx(worldX) - resultPivotX, ...)`
- 原生路径：`ctx.setTransform(...); drawImage(canvas, -pivotX, -pivotY)`

## 三处坐标计算对照

| 位置 | 文件 | 用途 | 单位 |
|---|---|---|---|
| 主渲染 | `unified-render.ts:computeWorldTransforms` | 精灵绘制 | SubPixel |
| Overlay | `canvas-puppet-render.ts` | 关节盘/标签 | SubPixel（已统一） |
| Hit test | `use-canvas-state.ts:findPuppetNodeAtPixel` | 点击选中 | SubPixel（已统一） |

公式统一：`world = parent + rotate(socket.basePosition) + rotate(node.transform)`，不减 plug。

## 关键不变量

1. `socket.basePosition` 恒为 SubPixel（`tool-handlers.ts` 存时 `pxToSub`，`migration-adapter` 同）
2. `node.slot` 只存槽位定义，`sprites: {}` 为空；精灵只在 `costumeSet.pieces[slotKey].sprites`
3. 方向索引：E=0, NE=1, N=2, NW=3, W=4, SW=5, S=6, SE=7（`DirectionWheel` 标准）
4. 新建角色：正面精灵挂 S(6)+N(2)，侧面挂 E/W/四斜角
