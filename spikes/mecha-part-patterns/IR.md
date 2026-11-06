# 机甲 IR 定义（v1）

IR 是组合层与生成器之间的唯一边界：一台机甲 = 一份 IR 数据。组合层（布局函数、
将来的编辑器）产出 IR；生成器只读 IR 执行，不回头问规格。

## 设计原则

1. **锚点是位置的唯一来源**。模式不算坐标，只按名读锚点。骨骼布局退化为「产出
   锚点表」的组合层函数——换姿态 = 换锚点表，模式与生成器不动。
2. **体积规格与模式分离**。volumes 只定剪影上限（标记层）；模式在规格内按自身
   参数长形态，剪影最终 = 部件并集（v9 定版），规格不是裁刀。
3. **结构参数显式、细节随机留生成器**。分界线：改了它还是不是「这一台机甲」——
   板数、块尺寸、足型、色调组是结构，进 IR；铆钉抖动、划痕走向是细节，由 seed
   在生成器内派生，不进 IR。
4. **绘制序 = 数组序**。parts 的顺序即 owner 序号序，即前后层序（投影、压叠靠它）。
5. **层是实例属性**。远侧肢体在 IR 里是同一批实例带 `layer:'far'`，压暗去饱和
   由生成器按层处理，不复制一份 IR。

## 结构

```ts
interface MechaIR {
  version: 1;
  archetype: 'humanoid' | 'walker' | 'beast';   // 原型：决定部位启用集
  scheme: string;          // 配色族名（生成器查 SCHEMES）
  seed: number;            // 全局种子：细节随机与逐件种子由此派生
  style: { wear: number; camo: boolean; cableTint?: RGB; decalKind: 'num'|'plate'|'none' };
  canvas: { w: number; h: number; groundY: number };
  anchors: Record<string, Pt>;                 // 命名锚点表
  volumes: Volume[];                            // 体积规格（只写 sil，不产像素）
  parts: PartInst[];                            // 模式实例，数组序 = 绘制序
}

type Volume =
  | { kind: 'seg'; a: string; b: string; wA: number; wB: number; bulgeF: number; bulgeB: number }
  | { kind: 'disc'; c: string; r: number }
  | { kind: 'box'; c: string; w: number; h: number; ang: number };

interface PartInst {
  id: string;              // 实例名，全 IR 唯一（如 'thigh.plates'）
  pattern: string;         // 模式名，对应 LIBRARY.md 的 L1 清单
  anchors: string[];       // 按模式接口序引用的锚点名
  params: Record<string, number | string | boolean>;
  layer?: 'far' | 'near';  // 缺省 near
}
```

模式分两类执行期：**布局期模式**产出部件实例（owner/u/v），占 parts 数组；
**渲染期模式**（贴纸系统、磨损组）不产部件，按锚点与 owner 归属在渲染 pass 里
工作，在 IR 里以 `pattern:'decals'` 等条目声明参数，不占绘制序语义（放数组尾）。

## LegSpec → IR 映射（现有六变体的无损性验证口径）

| 现字段 | 去向 |
|---|---|
| scheme / seed | 顶层 scheme / seed |
| topology + bend + ankleShift + lift | 布局函数算出的锚点坐标（hip/knee/ankle/toe 入 anchors 表，结果进 IR、过程不进） |
| wScale | volumes 的 wA/wB + segPlates 实例的段宽参数 |
| frameHeavy | parts 里有无 `frameBeam` 实例 |
| coreScale | `core` 实例 params |
| footType | 足模式选择：footBlocks / footShoe / footClaw / footPad |
| shellMode | segPlates 实例 params.shell（板独立成廓的收敛系数）+ 色调标记 |
| guardOff / detail | `guard` 实例 params / `detailSet` 实例有无 |
| wear / camo / cableTint / decalKind | 顶层 style |

## 一条腿的 parts 实例序（= 现 layout 的绘制序）

1. `core` 结构核（anchors: hip,knee,ankle）
2. `frameBeam` 框梁（可选，frameHeavy）
3. `cableRun` 线缆（hip,knee,ankle）
4. `segPlates` 大腿段（hip,knee）
5. `segPlates` 小腿段（knee,ankle）
6. `foot*` 足型（ankle,toe，toe 为锚点 {x: toeX, y: groundY}）
7. `guard` 护板（knee,ankle，可选）
8. `kneeCap` 膝盖帽 + `box` 小盒 ×2
9. `detailSet` 中型构件组：kneeLink / rail / exhaust / ankleGuard / handle
10. `pistonPair` 活塞 ×2（大腿后 / 小腿前，反关节互换）
11. `jointCluster` 关节簇 ×3（hip / knee / ankle）
12. `bellows` 膝后波纹套
13. `decals` 贴纸系统（渲染期）

volumes：seg(hip→knee, 110→84) + seg(knee→ankle, 94→64) + disc(hip,36) +
disc(knee,34) + disc(ankle,21) + seg（足， 38→30)。

## 示例：橄榄腿 IR（布局函数按 specs[0] 实算值）

```jsonc
{
  "version": 1, "archetype": "humanoid", "scheme": "olive", "seed": 11,
  "style": { "wear": 0.5, "camo": true, "decalKind": "num" },
  "canvas": { "w": 380, "h": 540, "groundY": 470 },
  "anchors": {
    "hip":   { "x": 170, "y": 44 },
    "knee":  { "x": 258, "y": 248 },
    "ankle": { "x": 166, "y": 434 },
    "toe":   { "x": 266, "y": 470 }
  },
  "volumes": [
    { "kind": "seg", "a": "hip", "b": "knee", "wA": 121, "wB": 92, "bulgeF": 0.08, "bulgeB": 0.025 },
    { "kind": "seg", "a": "knee", "b": "ankle", "wA": 103, "wB": 70, "bulgeF": 0.025, "bulgeB": 0.1 },
    { "kind": "disc", "c": "hip", "r": 36 }, { "kind": "disc", "c": "knee", "r": 34 },
    { "kind": "disc", "c": "ankle", "r": 21 }
  ],
  "parts": [
    { "id": "core", "pattern": "core", "anchors": ["hip", "knee", "ankle"], "params": { "coreScale": 1 } },
    { "id": "cables", "pattern": "cableRun", "anchors": ["hip", "knee", "ankle"], "params": {} },
    { "id": "thigh.plates", "pattern": "segPlates", "anchors": ["hip", "knee"], "params": { "wA": 121, "wB": 92, "bulgeF": 0.16, "bulgeB": 0.05 } },
    { "id": "shin.plates", "pattern": "segPlates", "anchors": ["knee", "ankle"], "params": { "wA": 103, "wB": 70, "bulgeF": 0.05, "bulgeB": 0.2 } },
    { "id": "foot", "pattern": "footBlocks", "anchors": ["ankle", "toe"], "params": { "family": "heavy" } },
    { "id": "guard", "pattern": "guard", "anchors": ["knee", "ankle"], "params": {} },
    { "id": "thigh.joint", "pattern": "jointCluster", "anchors": ["hip"], "params": { "r": 30 } },
    { "id": "knee.joint", "pattern": "jointCluster", "anchors": ["knee"], "params": { "r": 28 } },
    { "id": "ankle.joint", "pattern": "jointCluster", "anchors": ["ankle"], "params": { "r": 18 } },
    { "id": "decals", "pattern": "decals", "anchors": [], "params": { "numText": "M-46" } }
  ]
}
```

（示例为结构示意，parts 从简；迁移时以代码实产的完整实例列为准。）

## 迁移分工（下一步执行）

现 `layout()` 拆两半：前半（算锚点/体积/实例列）= 产 IR 的组合层函数；后半
（按实例序 fillShape）= 生成器执行。`render()` 的着色 pass 保持，只改数据来源
为 IR + 生成器执行产出的 Anchors 图。验收：六变体迁移前后逐像素一致。
