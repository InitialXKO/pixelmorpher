# 运行时完备性审计（research/runtime-completeness）

问题：编辑器能做出的东西，导出的运行时包是否都支持？
口径：五段全链（编辑器数据源 → convert 导出 → 包内字段 → 运行时消费
→ 实际渲染/行为），缺一段标「未验证」。证据为本仓行号（2026-10-26
main 299908c 基线）。承重断言（服装 surface、程序化动画、网格蒙皮、
全局修改器）已经审计者本人复读代码复核，其余为双路盘点交叉一致。

## 一、结论分级

- **完善**：动态模式全家、表演+状态机、服装集主体、标记、裁剪面、刀光。
- **已点名的近似**（导出 warnings 明示，属既定口径）：方向单图、轨道
通道子集、蓝图剪变换通道、绘制顺序、追随/IK/父级切换的烘焙化。
- **静默缺口**（不进包或进包不生效，且无任何点名——用户会以为有）：
7 项，见第三节。第 1 项是现行 bug 级（编辑器与运行时显示不一致）。
- **死字段**（进包但运行时从不读）：9 处，见第四节。

## 二、完善面（全链证据齐）

| 能力 | 导出 | 运行时消费 |
|---|---|---|
| 动态：发光/残影/弧线/置换/自转/发射/形变/表面动画 | convert dynFor/glowEntryFor 预烘 | runtime-template + dynamic-src 全组消费（params 子集逐项对齐） |
| 精灵标记 marks | displaySpriteOf 写 marks（#43） | ensureAtlas 换算 marksPx/marksDir；displaceOfRt 读 |
| 表演（作者/轨道/片段段/刀光段四源） | convert L845–1110 | 表演层合成+包络+触发键+状态机引用 |
| 状态机编排 | 作者规格直通/默认生成+失效引用降级点名 | smUpdate/smSetState/smPickResident 完整实现 |
| 服装集 | 全集打包+defaultCostume | resolvePart 覆盖+__dynamic/__glow/__sprite 逐集覆盖（surface 例外见缺口 1） |
| 裁剪面 clipPlane | 直译进包 | 帧循环合成+片元 discard |
| 行为图+节点蓝图（变换通道） | combineTransformGraphs 合并翻译 | evalRuntimeGraph 求值 angle/dx/dy |

## 三、静默缺口（按危害排序）

1. **服装集的图层程序（surface）覆盖被静默忽略**
convert 把每集每槽的完整外观（含 surface 图层程序）写入条目
（convert.ts:716），但运行时 resolvePart 对条目只读 7 个字段
（pal/size/roundness/surfaceGraph/composite/haloWidth/baseSprite），
不读 surface——换装后图层程序部件仍用默认集的程序，表面图覆盖却
生效。编辑器里换装改了图层程序，导出后不跟。无点名。
2. **程序化动画不进包**：convert 全文不读 proceduralAnimations，
包无此字段，运行时零实现；编辑器 ProceduralPanel 在页面上在用、
generateRenderPlan 会消费。导出无点名。（该数据刚在 #44 从旧
骨骼 slice 迁出保留——编辑器侧是活的，导出侧是断的。）
3. **工程级全局修改器/全局蓝图不进包**：convert 入参结构上拿不到
（签名只有 character+sprites+opts），编辑器渲染有
applyGlobalTransformWrapper，运行时无对应物。无点名。
4. **网格蒙皮运行时无**：编辑器按 socket.skinning==='mesh' 做插值
变形；运行时四源 grep skinning 零命中，部件刚性绘制。无点名。
5. **画布修改轨/特效轨/笔触不进包**：工程级与片段级均未读，
运行时无对应实现（刀光、粒子是另一路）。无点名。
6. **片段内状态切换不进包**：clip.stateKeyframes（片段窗内服装/
变体切换）convert 未读，段表演烘焙用静态服装状态。无点名。
7. **透视缩短运行时无**：编辑器有开关与应用点，运行时只有平面角。
无点名。

## 四、死字段（进包不读，徒增包体与误导）

format（版本号无人校验）、stateMachine.version、parts.drawLayer
（模板重赋 sortParts 后原版永不执行，实际只按 sortOrder）、
base.surfaceName、baseSprite.marks（只有 sprite.marks 被读）、
动态 params 的 follow 组与发光形状组本体（均已烘成 followCurve/
stamps，params 原文进包无人读）、behavior 图的 context 标记、
dynamic-src 的 dynFollowDelta（注入页面但模板无调用点）。

## 五、已点名的近似（既定口径，不算缺口，备查）

- 方向：每部件只带代表方向一张图，其余方向靠 variants 参数覆盖+
镜像/对角回落；variants 字段恒只有 rootDir 一条。
- 轨道烘焙只取 angle/x/y；tilt/stretch/scaleX/variantIndex/zIndex
通道偏离静态值时逐节点点名不进包（convert L891–907）。
- 节点蓝图/修改器只剪变换通道进包，像素链丢弃并点名（L822–827）。
- directionDrawOrders 不进包、按 zIndex 近似，warning 明示（L693）。
- 追随：运行时采样 convert 预烘的 followCurve（u=tracks 表演进度），
不实时取源部件位姿；实时公式 dynFollowDelta 已注入未接线。
- IK：无实时求解，靠作者预烘进轨道后回放；convert 采样时剥离 ikChains。
- 父级切换：无运行时换父，采样时压平进世界曲线。
- 行为树：类型注释明示不进运行时包（unified-types L1287）；包内只有
行为图。状态机引用的表演不在包内时降常驻并点名。
- heightmap/landmarks/folder/origin 不进包：folder/origin 是编辑器
组织维度（#44 口径），landmarks/heightmap 在编辑器侧的消费与运行
时无关——此三项判为「不该进包」，非缺口。

## 六、探针

scripts/verify-runtime-audit.mts 把上述分类逐项锁成断言（字段存在
性/消费点 grep 级接线 + resolvePart 覆盖字段集）：将来任何一项被
修复或恶化，探针会红，迫使本文档同步更新。

## 七、更正（2026-10-26，用户问「用户端难道不能消费吗」）

「死字段」一刀切不成立，按消费方分三类：
- **契约字段（保留）**：format 是包格式的标识/版本，播放器不读，但
  外部宿主识别包靠它——属格式表面，不删。
- **真死（可删）**：follow/发光形状的 params 本体（生效数据已烘成
  followCurve/stamps，照 params 读会与播放器不一致）、drawLayer
  （播放器实际按 sortOrder 画）、behavior 图 context 来源标记、
  dynFollowDelta（运行时内部代码，无包数据面）。
- **漏接（归缺口）**：baseSprite.marks——与 sprite.marks 同一份数据
  的另一载体，应在底图路径消费，列为缺口 8，随全修处理。
  surfaceName 为纯展示名，弱契约，保留。
