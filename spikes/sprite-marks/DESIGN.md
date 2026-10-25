# 精灵标记（Sprite Marks）研究与设计

立项：2026-10-25（用户令：开新分支新 PR，研究在精灵上标记
特定点/选区/选择逻辑/值/方向/矢量，供后续消费端复用）
分支：research/sprite-marks（基于 main 824de7b）

## 一、问题定义

作者经常需要在精灵上标出语义信息给效果系统用：粒子从
枪口冒、弧线从剑尖起、发光只染披风内衬、某个方向是刃
口朝向、某个数是这块甲的硬度。现在这类信息没有统一的
「存在精灵上、按名引用」的家：

- 位置类：只有 `Sprite.plug`（单个无名点）与节点 socket
  （节点级、结构语义，不是精灵语义）；
- 选区类：发光的手动标记掩码存在**每个动态模式实例的
  参数里**（glowMask），换个消费端要重画一遍，不复用；
- 值/方向类：散落在各消费端的参数里（每个实例各填一份
  角度/数值），改一处要改全部引用处。

本研究的目标：一套挂在 `Sprite` 上的命名标记（marks），
五种形态——点、选区（涂画或规则）、值、方向、矢量——
消费端按**名**引用，解析口径全产品唯一。

## 二、既有盘点（2026-10-25 代码实查）

| 既有物 | 形态 | 局限 |
|---|---|---|
| `Sprite.plug` | 精灵级单点（subpixel 坐标） | 无名、只有一个 |
| `Sprite.landmarks` | 精灵级特征点（眼/鼻/嘴，归一 0..1） | 写死四个面部点位，不可扩展；是本设计的直系先例（归一坐标口径沿用它） |
| `Sprite.heightmap` | 精灵级逐像素值场 | 是「值场」先例，但无名、无标量形态 |
| 节点 `sockets` | 节点级点+方向偏移 | 结构挂载语义（插槽/offset3D），不是精灵语义，勿混用（见术语纪律：槽位专指它） |
| 发射源 `source` 枚举 | contour/contour-top/contour-bottom/inside/plug | 位置逻辑写死枚举，只有 plug 是语义点 |
| `glowMask`（实例参数） | 涂画选区（位打包）+ 取色选区（颜色+容差） | 存在实例里不复用；但其掩码打包与取色口径可直接沿用 |
| 表面层程序 mask | all/inside/edge + 档位阈值 | 是「规则选区」在另一套系统里的先例（烘焙期求值） |
| `arcTarget`/`followSource` | 按槽位键字符串引用跨部件对象 | 「按名引用 + 找不到时降级」口径的先例 |

## 三、数据模型（本 spike 落地）

`Sprite.marks?: SpriteMark[]`，每条：

```ts
{ id, name, kind: 'point',     x, y }                       // 归一 0..1，沿用 landmarks 口径
{ id, name, kind: 'region',    region: RegionSpec }         // 见下
{ id, name, kind: 'value',     value }                      // 命名标量
{ id, name, kind: 'direction', angleDeg }                   // 精灵本地角度（0=东顺时针 90=南，全产品统一口径）
{ id, name, kind: 'vector',    x, y, dx, dy }               // 锚点（归一）+ 分量（以精灵宽/高为单位）
```

RegionSpec（选区 = 涂画或逻辑，二选一存）：
- `{ by: 'painted', mask: { w, h, bits } }`——位打包与
  glowMask 同格式（packMaskBits/unpackMaskBits 沿用）；
- `{ by: 'color', color, tolerance }`——取色规则与
  glowMaskCells 的取色分支同口径（RGB 距离 ≤ 容差）；
- `{ by: 'rect', x, y, w, h }` / `{ by: 'circle', cx, cy, r }`
  ——几何规则，坐标全归一。

引用与解析口径（全 spike 的核心约定）：
1. 消费端按 **name** 引用（字符串，与 arcTarget 同形态）；
   同名多条取第一条，解析器点名警告由编辑层负责呈现，
   解析函数本身不抛错。
2. 找不到标记 / 种类不符 → 消费端走自己的缺省（发射源
   回落 plug 点），**永不崩**；「引用悬空」应由编辑器在
   引用处点名（同烘焙过期点名口径），本 spike 只保证解
   析层可判定（findMark 返回 undefined 即悬空）。
3. 坐标全归一、方向无关、存精灵级——同一精灵被多个方
   向变体/服装引用时标记一份（与 landmarks 同级）。方
   向变体图若构图不同，标记按归一位置近似对应，这是
   landmarks 已接受的同一近似。

## 四、消费端接线（本 spike 的纵切）

选粒子发射源做纵切（编辑器与导出运行时双消费端都在，
能对拍）：

- 新发射源 `'mark'` + 参数 `emitMark`（标记名）：粒子从
  命名**点标记**出生；无此标记回落 plug 点。
- 编辑器：dynamic-pattern-sim 的 sourcePoints 加 'mark'
  分支（读 sprite.marks 直接解析）。
- 导出：convert 把 sprite.marks 透传进包内 part.sprite；
  ensureAtlas 按瓦片几何算出各点标记的瓦片像素位（镜像
  时 x 翻转），挂条目元组**新下标 [10]**（见第六节的下
  标事故说明）；帧循环把 marksN 浅并入 tile 副本传给
  dynSimulate；DYNAMIC_SRC 的 dynSourcePoints 加 'mark'
  分支。两端出生点探针对拍。

其余消费端（设计已定口径、未在本 spike 接线）：弧线原
点可指定点标记（替代 plug）、发光选区来源加 'mark'
（按名读 region 标记，替代实例内 glowMask）、置换/发
射方向可绑定 direction/vector 标记——都走第三节的同
一解析层，后续逐个接。

## 五、作者端（本 spike 不做，设计留口）

标记的编辑 UI（在精灵编辑画布上加点/涂选区/拉矢量、
标记列表改名）是独立一块交互设计，不在本 spike；本
spike 只落数据模型 + 解析层 + 一条消费纵切，证明「存
得住、引得到、两端一致」。UI 落地时注意既有纪律：先
想透交互模型再写代码。

## 六、盘点中挖到的既有缺陷（2026-10-25 用户令修复，已随本 PR 修）

导出运行时图集条目的 plugN 挂错了下标：D4 落地时称
「plugN 挂 entries[6]」，但条目元组 [6] 自发光垫边工作
起就是 tileExtra（数字）（runtime-template 两处按数字
读 [6] 可证），只有 map.set 一处把 [6] 当 plugN 读。结
果：tileExtra=0（多数）时 plugN=null、弧线原点回落瓦
片中心（不是插头）；tileExtra>0（发光垫边部件）时
plugN 是数字、取 [0] 得 undefined → 弧线坐标 NaN。

修复（本 PR）：plugN 挪到空闲下标 [11]，写入值 = 瓦片
归一化插头位 [vt.cx / vt.w, vt.cy / vt.h]（y 向下存，消
费端现有公式 (1−y) 翻成 y-up 中心偏移，逐项恒等：
plugC = [cx − w/2, h/2 − cy]）；map.set 改读 [11]。
探针 verify-sprite-marks 第 8 组把守（写读下标一致 +
口径恒等）。导出弧线原点的真机观感仍在累积验证批内。
