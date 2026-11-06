// gen-full-v1.mts — 整机完整管线：全部位同一实例流 + 全套渲染 pass（基 gen-ir-v1）
// gen-ir-v1.mts — 生成器 IR 迁移：render 经 legIR→MechaIR→renderIR 执行（v29 代码基，布局/渲染本体不变）
// 并定：画法与其他部件一样、由有厚度的块组成）。四类：①分段厚块足（主战/防空/
// 打桩机/重型）：跟+掌+趾三块厚块，段顶平、台阶下行、趾块钝厚带前端面；②整楔鞋
// 足（人形壳）：鞋身块微转 + 趾帽块压前段，两块的台阶与转角合成斜面读法，仍是块
// 不是楔板；③分趾爪足（侦察型，石板反关节）：踝下基座 + 前趾两节 + 后趾两节，趾
// 块带转角下探；④宽掌垫足（轨道炮型）：宽平基座一整块 + 前段块 + 跟块，低矮。
// v27 的单块楔就此退役：它只对壳的轮廓、且丢了块厚与段结构；本轮壳也回到块构造。
// 足型由规格 footType 指定（橄榄/沙漠/锈=blocks、壳=shoe、石板反关节=claw、轨道
// 炮=pad）。厚块足另加主战式的趾块前端面（带框端面板 + 栓点，渲染盖章）。
// 沿用：v27 趾楔的教训（孤岛/等高/塌口三错不复犯：块间叠压相接、高度分级、顶线
// 连续但靠台阶不靠斜板）、v28 扩部件剂量、v25 漏黑定版。
// v24 漏黑逐区归属（沿用记录）：包络隆起减半、板自带衬边、关节法兰、壳体块加大、
// 踝上整流罩、足包络收窄、框主导族段框梁；当时平填仍作保险，本版摘除。
// v23 内体（沿用，不动）：内体与包络脱钩——内体是独立
// 部件，有自己的几何：沿关节链的结构核，半径髋 26→膝 23→
// 踝 16（×规格 coreScale），圆头跨关节。v20/v21 把内体做成
// 包络的缩放拷贝（同 wA/wB、同隆起、×1.03/×0.85），缩放因子
// 换了、从属关系没换——内体的形状不该由包络参数派生。包络
//（剪影标记）与内体（结构件）各管各的，互不引用。
// v22 足部（沿用）：足部重做——v19 的鞋是把三趾并
// 成一根平棒（跟/掌/趾同高、顶面一平），躲开了「多节趾」却丢
// 了参考足的块构造：参考是几块大块、块顶自踝向趾逐级下行、
// 底面统一接地、趾块前上大斜面。正修：足块按底面 y=470 统
// 一标高、高度分级（跟 30/掌 26/趾 24，锈 31/27），趾块前上
// 大切角成下行台阶；壳鞋改跟鞋+趾鞋两块带高差。内体收窄
//（v21）沿用。
// v21 内体件收窄（沿用）：内体件收窄——内体轮廓必须窄于
// 部件轮廓。v20 内体宽 ×1.03 比包络还宽，轮廓被内体件的直边
// 接管，板缘台阶（v9/v12 的独立成廓）被抹平，等于把包络换个
// 身份画回来。正修：内体宽 ×0.85，退到板轮廓内侧——轮廓由板
//（≥0.9 宽+出边）定义，缝隙窗口里内体面比板缘内缩数像素成
// 凹步，边缘余量由厚度 pass 的边面接管；足底件同错（比足块
// 还宽），收进足块范围只留底边 2px 鞋底线。
// v20 正修（沿用）：黑衬底正修——内体做成部件。
// v19 修法为何不成立：漏黑像素没有部件身份——厚度/棱线/刻面
// 全部按 owner 算，它们一样都摊不上，换什么颜色都是平的；收
// 板宽又够不着漏黑大头（关节楔角/髋顶/足下按构造无板）。根
// 子是叠序缺层：剪影只是标记、框只是一条窄脊线（lineTest 半
// 径 22–30，段宽 64–110），其余全靠平填冒充内体。正修：每段
// 一件内体件（全剖面+隆起、t −0.05..1.05 跨关节、无切角无抖
// 动）垫在框脊与甲片之下，足下补足底件，框件着色加分带；包
// 络关节圆收至盖帽尺寸。无主平填只留作保险。（注：本轮曾有
// 一稿「删包络、剪影只取并集」——拿删代修，未提交已作废。）
// v19 足式（沿用）、衬层着色（留作保险）：黑衬底与足式两修。无主像素原
// 以框色 ×0.42 平填（≈(11,12,13) 纯黑板），板覆盖不足处成片
// 漏黑——改暗装甲衬层（框/甲混色 + 噪声分带），框件改枪灰；
// 板宽下限 0.84→0.9、横移抖动 ±4.5→±3.2 收漏缝。足改鞋式：
// 掌+大趾鞋块叠合成整鞋（趾帽竖缝），锈族双大块错位，删三
// 节趾排。
// v18 细节（沿用）：自查清单细节项 8–12。磨损改定
// 位（凸缘掉漆按边界偏置、锈流挂从螺栓向下、刮痕锚在螺栓旁）；
// 面板线加斜线与 T 型接头（错位网络）；波纹套移到盖帽之后绘
// 制并加粗后移（显形）；贴纸分族（数据牌/无编号/位置）与小
// 灯串（高细节族小腿三灯）；线缆分族（蓝缆、垂度按种子、端
// 头接头）。结构项 1–5（v17）沿用。
// v17 结构（沿用）：自查清单结构项 1–5（族间同质/
// 盖帽占比/踝轮化/护板串族/姿态）。规格加分族参数：宽缩放、
// 明度抬升、护板开关、细节密度、踝移位；姿态改步态位（膝前
// 顶、踝后收，逐族弯度）；盖帽缩小（髋 37/膝 35/踝 21）且偏
// 心、删毂缝圆线、壳体块改画在盖帽之后压住帽缘成簇；踝改小
// 轴、趾块加高缩短、掌下加鞋底带；护板按族开关（侦察/轨道
// 炮/壳/锈关），无护板族小腿前活塞成对露出；壳族改涂装斜条
// 纹。棱线高光（v16）沿用。
// v16 棱线高光（沿用）：棱线高光（用户补判「参考图每个
// 块还有棱线高光」）。参考每块的上缘与前缘都有一条 1px 亮线
// （棱线接光），外轮廓处亮线退到描边内侧一行；生成的块此前
// 只有 v6 的宽唇带、没有这条脆线。v16 在边面 pass 后、描边前
// 加棱线 pass：块的上边界行（邻接另一块）×1.32、外轮廓上缘
// 的内侧一行 ×1.32、前边界行 ×1.18（外轮廓前缘内侧一行同
// 理）；板件主折线（主面→前斜面）在主面一侧补 1.15 亮棱。
// 关节/脚块簇（v15）沿用。
// v15 关节与脚改块语言（沿用）：关节与脚改块语言（用户判「参考
// 图的关节也是这套画法、你发明了完全不同的关节画法」、并补
// 「还有脚部」）。此前关节是我发明的同心环轴承画法（座圈/刻
// 面环/内盘/毂环/毂心变体），脚是楔形板组；参考的关节是块
// 簇：壳体块 + 一整面分面盖帽 + 小毂块，脚是跟/掌/趾独立块。
// v15：关节 = 沿段轴的切角壳体块 + 盖帽整面按扇区平坦分面
// （删全部同心环，只留一道毂缝线）+ 盖帽中心切角方毂块；
// 脚 = 跟块/掌块/三趾块（人形壳为鞋块），全是切角块、走板件
// 同一套面式着色与厚度边面。块形（v14）沿用。
// v14 块形非四边形（沿用）：块形非四边形（用户补判「参考图
// 的块基本上没有四边形」）。参考块的轮廓是多边形：四角各自切
// 角、底端收尖、侧边带台阶、盒件切角；生成的板是长直平行边 +
// 两端小斜切的准四边形。v14：plateTest 加形状参数——四角独立
// 切角量（按板种子，0 到近半宽，切角区占板长 30%，双角大切即
// 收尖）、约 4/10 板侧边带一处台阶（中心线跳变 ±7）；小盒改
// 八点切角多边形。块厚度（v13）、块间发散（v12）沿用。
// v13 块厚度（沿用）：块厚度（用户补判「参考图的块有
// 厚度」）。参考的板是厚板：下端能看到端面（一条更暗的厚度带、
// 底行最暗）、前缘能看到侧面，板与板是像瓦一样叠压的关系；
// 生成的板此前是贴在曲面上的贴纸，边缘只有 1px 线。v13 加边
// 面 pass（描边之前）：板/护板/脚件像素向下 1–3px 出本块 →
// 端面带（×0.52/0.64/0.76）；朝前 1–2px 出本块 → 侧面带
// （×0.70/0.82）。块间发散（v12）、面式着色（v11）沿用。
// v12 块间参数发散（沿用）：块间参数发散（用户判「参考图各
// 块之间参数完全不一样、你的块是完全连续的」）。v11 之前每段
// 恒两块等分、同收分、同间隙，面式四带色调是全局常数——块与
// 块只是同一模板的连续切片。v12：每段 2–3 块不等分切分，每块
// 独立宽缩放/独立收分/独立切角/独立间隙，护板比例种子化，板
// 色调步距拉大；着色侧每块的面数（2/3/4）与四带色调改按板种
// 子在区间内取，不再全局同一组常数。面式着色（v11）、元素配
// 方（v10）、并集剪影（v9）沿用。
// v11 块面式着色（沿用）：块面式着色（用户判「参考图每个
// 块的绘制模式基本都一样、完全没有识别出来」）。逐块取样实测：
// 参考每块板被 1–3 条硬折线切成几个大多边形面、每面单一平坦
// 色调（MBT 大腿板纵剖面 120px 恒 110 不变），整块板内部没有
// 连续渐变；我方 v6 起的形态剖面是横贯整板的连续渐变场——单位
// 错了：块的单位是「面」不是像素场。v11 板件改面式：
//   横向四带（背面 0.78 / 主面 0.97 / 前斜面窄亮带 1.17 / 前缘
//   收边 0.88），折线位置按板号种子；约半数板带一条斜折面
//   （下半 ×0.9）；板端平带（上亮 1.13 / 下暗 0.8）；
//   mottle 对板件降权至 0.35（面内近似平坦，磨损另由斑层承担）
// 盘/杆/筒的元素配方（v10）与第一层并集剪影（v9）沿用。
// v10 元素绘制配方（沿用）：元素绘制配方（用户判「反复出现的
// 绘制元素没有准确复现其绘制模式」）。放大对读提取的配方逐项换：
//   关节盘：刻面环（12 面按角给平坦调）+ 内盘方向调 + 毂心三变体
//     （方头螺栓/X 十字槽/六角窝，种子选），删自创扇区刻槽+螺栓圈
//   活塞杆：五段横剖面（暗缘/肩/亮芯/肩/暗缘）；面板线：刻线双线
//     （暗线 + 下方 1px 受光唇）；描边：按件底色压暗（彩色描边）
//   通风栅：凹槽三带（槽顶影/槽底/槽下唇受光）；护板纹：三层叠
//     人字纹（AA 式，色从种子在贴纸色/强调色间选）+ 大腿双斜杠贴花
//   膝后波纹套（关节褶皱）：膝后 4 条暗肋横杆
//   迷彩：大块硬边斑（低频阈值 + 更强混合）；小腿加仪表窗（凹框
//     + 强调色窗面，scout 式）
// v9 第一层重做（沿用）：第一层重做（用户判「第一层的轮廓
// 生成器就不合格」）。v8 的剪影是预画的平滑包络（两段 silQuad +
// 三圆 + 脚四边形），部件只写 owner、在包络内填色，包络外一律
// 裁掉——轮廓每侧只是一条光滑曲线。参考的轮廓是部件并集。本轮：
//   剪影 = 包络 ∪ 全部部件（layout 末尾并集），部件可以探出包络
//   每块板独立成廓：种子角度抖动 ±1.4° + 横移 ±2px + 出边 3–8%
//   段包络改台阶剖面：两端向关节盘收腰 13%、中段接缝处 5% 台阶
//   关节盘加大（髋 46/膝 44/踝 31），在收腰处咬出轮廓
// v8 立体感第三轮（沿用）：立体感第三轮——轮廓本身。v7 复看：
// 段的剪影是直线收分的一对平行边，平板再怎么着色也是平板。本轮
// 段横截面改非对称隆起：大腿前侧股肌隆起、小腿后侧腓肠肌隆起，
// plateTest/silQuad 同步（u 按前后侧各自半宽归一，剖面不变形）。
// v7 立体感第二轮（沿用）：立体感第二轮。v6 复看残差：部件仍是
// 贴面平板——缺三样：每件四周的厚度侧壁、件与件之间拉开的明度差、
// 更长的投影尾。本轮：3px 盘缘侧壁带（上沿受光、下沿侧壁压暗、
// 前壁转暗）、板间色差拉大（0.82~1.18）、投影加强并加长尾。
// v6 立体感第一轮（沿用）：立体感专项。v5 的着色是对称中心渐变 +
// 1px 棱线 + 无投影，构造上就是贴纸。本轮换体积着色：
//   非对称形态剖面（前缘高光带/前面/转折/背侧收暗，坡道量化成色带）
//   投影：靠前部件向后下在身后部件上落影（近影 0.72、远影 0.87）
//   斜面带：横向边界上亮唇 2px + 下暗唇、纵向边界前亮后暗
//   圆盘方向体积（光自前上）+ 毂影；活塞/拉杆高光偏前、两缘收暗
//   脚下接地阴影（半透明椭圆，落在剪影外）
// v5 已销账项（沿用）：区别模式迭代第二轮。v4 复测残差：
//   对比度（std 36 vs 参考 49）与深暗部（0.22 vs 0.32）仍差 → 全局调色
//   拉伸（暗更暗、亮更亮）一次解决三项；强调色占比差 → 箭头纹加粗 +
//   大腿加饰带；人形壳子族（白甲）未覆盖 → shellMode 变体（近无缝板 +
//   色块板 + 鞋式单趾 + 光滑柱面）。
// v4 已销账项（沿用）：
//   暗部占比差一倍 → 配色与板面着色整体压暗、缝更深、板缝加宽
//   脚无分趾 → 三趾块脚；面板线只有横向 → 每板加竖向缝
//   盘面无螺栓圈 → 关节盘 8 颗环螺栓；无标志图形 → 种子标志（菱/十字/三角/横杠）
//   锈斑缺 → 磨损斑层（锈色混色，强度按配色）；掉漆只有暗啃 → 亮掉漆点
//   无轻型内框变体 → frameHeavy（板宽 0.7 倍、内框主导，侦察/轨道炮式）
//   无远侧腿 → formation 合成（远侧腿压暗去饱和垫后）
// 运行：bun spikes/mecha-part-patterns/gen-legs-v29.mts
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

// ---------- 工具 ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 974634239);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, seed: number) { // 值噪声（双层）
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const n = l(l(hash2(xi, yi, seed), hash2(xi + 1, yi, seed), s(xf)), l(hash2(xi, yi + 1, seed), hash2(xi + 1, yi + 1, seed), s(xf)), s(yf));
  return n * 0.65 + 0.35 * vnoise1(x * 2.7, y * 2.7, seed + 7);
}
function vnoise1(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(hash2(xi, yi, seed), hash2(xi + 1, yi, seed), s(xf)), l(hash2(xi, yi + 1, seed), hash2(xi + 1, yi + 1, seed), s(xf)), s(yf));
}
const crcTable = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf: Uint8Array) { let c = -1; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type: string, data: Uint8Array) {
  const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, data.length);
  const td = new Uint8Array(4 + data.length); td.set([...type].map((c) => c.charCodeAt(0))); td.set(data, 4);
  const crc = new Uint8Array(4); new DataView(crc.buffer).setUint32(0, crc32(td));
  return [len, td, crc];
}
function encodePNG(w: number, h: number, rgba: Uint8ClampedArray) {
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 4)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1); }
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  for (const c of chunk('IHDR', ihdr)) parts.push(c);
  for (const c of chunk('IDAT', deflateSync(raw))) parts.push(c);
  for (const c of chunk('IEND', new Uint8Array(0))) parts.push(c);
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

// ---------- 颜色：量化坡道 ----------
type RGB = [number, number, number];
interface Scheme { armor: RGB; armor2: RGB; frame: RGB; metal: RGB; chrome: RGB; accent: RGB; glow: RGB; decal: RGB }
const SCHEMES: Record<string, Scheme> = {
  white:  { armor: [198, 203, 214], armor2: [168, 178, 196], frame: [26, 28, 34], metal: [70, 74, 84], chrome: [205, 212, 224], accent: [64, 110, 224], glow: [150, 200, 255], decal: [42, 50, 66] },
  olive:  { armor: [86, 92, 50], armor2: [69, 76, 40], frame: [35, 37, 32], metal: [80, 82, 84], chrome: [186, 190, 192], accent: [219, 130, 40], glow: [255, 198, 94], decal: [226, 224, 205] },
  desert: { armor: [130, 113, 81], armor2: [111, 95, 66], frame: [50, 44, 36], metal: [86, 84, 80], chrome: [192, 190, 182], accent: [209, 112, 36], glow: [255, 202, 102], decal: [238, 232, 214] },
  slate:  { armor: [75, 83, 95], armor2: [60, 68, 80], frame: [32, 36, 44], metal: [76, 80, 88], chrome: [178, 186, 196], accent: [235, 128, 44], glow: [255, 178, 86], decal: [224, 228, 232] },
  rust:   { armor: [118, 94, 66], armor2: [100, 80, 58], frame: [34, 28, 24], metal: [79, 75, 73], chrome: [176, 172, 166], accent: [223, 124, 38], glow: [255, 190, 98], decal: [230, 222, 204] },
};
// 亮度因子量化到 6 档、暗部略偏冷——像素画的坡道感
function ramp(c: RGB, f: number): RGB {
  const steps = [0.3, 0.45, 0.6, 0.76, 0.9, 1.0, 1.14, 1.3];
  let q = steps[0]; for (const s of steps) if (f >= s - 0.06) q = s;
  const cool = q < 0.8 ? 0.96 : 1;
  return [Math.min(255, c[0] * q * cool), Math.min(255, c[1] * q), Math.min(255, c[2] * q * (q < 0.8 ? 1.05 : 1))];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- 画布与参数图 ----------
const W = 380, H = 540;
type Kind = 'plate' | 'disc' | 'rod' | 'cyl' | 'foot' | 'frame' | 'cable' | 'guard';
interface Inst { kind: Kind }
interface Canvas { col: Uint8ClampedArray; owner: Int16Array; u: Float32Array; v: Float32Array; sil: Uint8Array; insts: Inst[] }
function newCanvas(): Canvas {
  return { col: new Uint8ClampedArray(W * H * 4), owner: new Int16Array(W * H).fill(-1), u: new Float32Array(W * H), v: new Float32Array(W * H), sil: new Uint8Array(W * H), insts: [] };
}
type Pt = { x: number; y: number };
function fillShape(cv: Canvas, id: number, test: (x: number, y: number) => [boolean, number, number]) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [hit, u, v] = test(x + 0.5, y + 0.5);
    if (hit) { const i = y * W + x; cv.owner[i] = id; cv.u[i] = u; cv.v[i] = v; }
  }
}
function markSil(cv: Canvas, test: (x: number, y: number) => boolean) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (test(x + 0.5, y + 0.5)) cv.sil[y * W + x] = 1;
}
function segFrame(a: Pt, b: Pt) { const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy); return { ux: dx / len, uy: dy / len, px: -dy / len, py: dx / len, len }; }
// 段板：t0..t1 区间 + 缝 + 两端斜切（cutA/cutB 为端部削角量，单位 px 沿横向）
interface Bulge { f: number; b: number } // 前/后隆起幅度（d<0 为前侧）
const bumpAt = (t: number, c: number) => Math.exp(-(((t - c) / 0.3) ** 2));
type PlateShape = { cTF: number; cTB: number; cBF: number; cBB: number; step: number; stepPos: number };
function plateTest(a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap: number, cutA: number, cutB: number, bulge: Bulge = { f: 0, b: 0 }, shape?: PlateShape) {
  const f = segFrame(a, b);
  return (x: number, y: number): [boolean, number, number] => {
    const rx = x - a.x, ry = y - a.y;
    const t = (rx * f.ux + ry * f.uy) / f.len;
    if (t < t0 || t > t1) return [false, 0, 0];
    const d = rx * f.px + ry * f.py;
    const baseHW = (wA + (wB - wA) * t) / 2;
    const hwF = baseHW * (1 + bulge.f * bumpAt(t, 0.38));
    const hwB = baseHW * (1 + bulge.b * bumpAt(t, 0.34));
    const local = (t - t0) / (t1 - t0);
    const shrink = gap / f.len / (t1 - t0);
    if (local < shrink || local > 1 - shrink) return [false, 0, 0];
    // 斜切：靠近两端时，一侧可用半宽线性收窄（前后侧分别算）
    const cz = 0.16;
    let limF = hwF - gap * 0.35, limB = hwB - gap * 0.35;
    if (local < cz) { const k = 1 - local / cz; limB -= cutA * k; limF -= cutA * k * 0.25; }
    if (local > 1 - cz) { const k = 1 - (1 - local) / cz; limF -= cutB * k; limB -= cutB * k * 0.25; }
    // 块形（v14）：四角独立切角（切角区占板长 30%）+ 侧边台阶（中心线跳变）
    if (shape) {
      const cz2 = 0.3;
      if (local < cz2) { const k = 1 - local / cz2; limF -= shape.cTF * k; limB -= shape.cTB * k; }
      if (local > 1 - cz2) { const k = 1 - (1 - local) / cz2; limF -= shape.cBF * k; limB -= shape.cBB * k; }
    }
    let dC = 0;
    if (shape && shape.step !== 0) {
      const sp = shape.stepPos;
      dC = local >= sp ? shape.step : local > sp - 0.05 ? (shape.step * (local - (sp - 0.05))) / 0.05 : 0;
    }
    const dd = d - dC;
    const hit = dd < 0 ? -dd <= limF : dd <= limB;
    return [hit, dd < 0 ? dd / hwF : dd / hwB, local];
  };
}
function silQuad(a: Pt, b: Pt, wA: number, wB: number, grow = 0, bulge: Bulge = { f: 0, b: 0 }, prof?: (t: number) => number) {
  const f = segFrame(a, b);
  return (x: number, y: number) => {
    const rx = x - a.x, ry = y - a.y;
    const t = (rx * f.ux + ry * f.uy) / f.len;
    if (t < -0.02 || t > 1.02) return false;
    const d = rx * f.px + ry * f.py;
    const baseHW = ((wA + (wB - wA) * t) / 2) * (prof ? prof(Math.max(0, Math.min(1, t))) : 1);
    const hwF = baseHW * (1 + bulge.f * bumpAt(t, 0.38)) + grow;
    const hwB = baseHW * (1 + bulge.b * bumpAt(t, 0.34)) + grow;
    return d >= -hwF && d <= hwB;
  };
}
function polyTest(pts: Pt[]) { // 多边形（护板/趾块）：局部坐标取包围盒
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return (x: number, y: number): [boolean, number, number] => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return [inside, ((x - x0) / (x1 - x0)) * 2 - 1, (y - y0) / (y1 - y0)];
  };
}
function discTest(c: Pt, r: number) {
  return (x: number, y: number): [boolean, number, number] => {
    const dx = x - c.x, dy = y - c.y;
    const d = Math.hypot(dx, dy);
    // 12 边形刻面外形：平边在 0.966r、棱角在 r（scout/MBT 的盖帽不是正圆）
    const seg = ((Math.atan2(dy, dx) + Math.PI) % (Math.PI / 6));
    const fr = r * (Math.cos(Math.PI / 12) / Math.cos(seg - Math.PI / 12));
    return [d <= fr, dx / r, d / r];
  };
}
function lineTest(a: Pt, b: Pt, r: number) {
  const f = segFrame(a, b);
  return (x: number, y: number): [boolean, number, number] => {
    const rx = x - a.x, ry = y - a.y;
    const t = (rx * f.ux + ry * f.uy) / f.len;
    if (t < 0 || t > 1) return [false, 0, 0];
    const d = rx * f.px + ry * f.py;
    return [Math.abs(d) <= r, d / r, t];
  };
}
function bezier(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y };
}

// ---------- 3×5 点阵字（贴纸） ----------
const FONT: Record<string, string[]> = {
  A: ['010', '101', '111', '101', '101'], C: ['011', '100', '100', '100', '011'],
  U: ['101', '101', '101', '101', '111'], T: ['111', '010', '010', '010', '010'],
  I: ['111', '010', '010', '010', '111'], O: ['010', '101', '101', '101', '010'],
  N: ['101', '111', '111', '101', '101'], M: ['101', '111', '111', '101', '101'],
  '-': ['000', '000', '111', '000', '000'], '7': ['111', '001', '010', '010', '010'],
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '010', '010', '010', '010'],
  '2': ['110', '001', '010', '100', '111'], '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '110', '001', '110'],
  '6': ['011', '100', '110', '101', '010'], '8': ['010', '101', '010', '101', '010'],
  '9': ['010', '101', '011', '001', '110'], ' ': ['000', '000', '000', '000', '000'],
};

// ---------- 布局 ----------
interface LegSpec { topology: 'standard' | 'reverse'; scheme: Scheme; seed: number; bend: number; camo: boolean; wear?: number; frameHeavy?: boolean; shellMode?: boolean; wScale?: number; lift?: number; guardOff?: boolean; detail?: number; ankleShift?: number; cableTint?: RGB; decalKind?: 'num' | 'plate' | 'none'; coreScale?: number; footType?: 'blocks' | 'shoe' | 'claw' | 'pad' }
interface Anchors {
  plateTint: Map<number, number>; panelLines: Map<number, number[]>;
  boltPts: Pt[]; ventId: number; guardId: number; stripeId: number;
  decalPos: Pt; numPos: Pt; numText: string; lightPts: Pt[];
  discs: { id: number; c: Pt; r: number; hv: number }[];
  chevrons: [Pt, Pt][];
  seamU: Map<number, number>; insignia: { pos: Pt; kind: number };
  stripeThigh: number; blockPlates: Set<number>;
  deviceFrame: { c: Pt; ux: number; uy: number; px: number; py: number } | null; chevDecal: boolean;
  shinIds: Set<number>; stripeSegs: [Pt, Pt][];
  panelDiag: Map<number, number>; panelTee: Map<number, number>; decalKind: string; toeFace: { x0: number; y0: number; x1: number; y1: number } | null; colorRole?: Map<number, string>;
}
function layout(cv: Canvas, spec: LegSpec, pre?: { hip: Pt; knee: Pt; ankle: Pt; toeX: number }): Anchors {
  const rnd = mulberry32(spec.seed);
  const std = spec.topology === 'standard';
  const hip: Pt = pre?.hip ?? { x: 170, y: 44 };
  const knee: Pt = pre?.knee ?? (std ? { x: 236 + spec.bend, y: 248 } : { x: 112 + spec.bend, y: 244 });
  const ankle: Pt = pre?.ankle ?? { x: 178 + (std ? -1 : 1) * (spec.ankleShift ?? 10), y: 434 };
  const toeX = pre?.toeX ?? ankle.x + 100;
  const ws = spec.wScale ?? 1;
  const thigh = { a: hip, b: knee, wA: 110 * ws, wB: 84 * ws, bulge: { f: 0.16, b: 0.05 } };
  const shin = { a: knee, b: ankle, wA: 94 * ws, wB: 64 * ws, bulge: { f: 0.05, b: 0.2 } };
  // 剪影
  const segProf = (t: number) => (1 - 0.13 * Math.exp(-((t / 0.09) ** 2)) - 0.13 * Math.exp(-(((1 - t) / 0.09) ** 2))) * (t > 0.52 ? 0.95 : 1);
  for (const s of [thigh, shin]) markSil(cv, silQuad(s.a, s.b, s.wA, s.wB, 2, { f: s.bulge.f * 0.5, b: s.bulge.b * 0.5 }, segProf)); // 包络隆起减半：原隆起全量是过 claim（板面才是外表面）
  for (const [j, r] of [[hip, 36], [knee, 34], [ankle, 21]] as [Pt, number][]) markSil(cv, (x, y) => Math.hypot(x - j.x, y - j.y) <= r);
  markSil(cv, silQuad({ x: ankle.x - 8, y: 448 }, { x: toeX, y: 458 }, 38, 30, 2));
  // 切角块多边形（关节壳体/毂块/脚块共用）
  const blockPoly = (cx: number, cy: number, w: number, h: number, ang: number, cham: number): Pt[] => {
    const ca = Math.cos(ang), sa = Math.sin(ang), lx = w / 2, ly = h / 2, c = (Math.min(w, h) * cham) / 2;
    const raw: Pt[] = [
      { x: -lx + c, y: -ly }, { x: lx - c, y: -ly }, { x: lx, y: -ly + c }, { x: lx, y: ly - c },
      { x: lx - c, y: ly }, { x: -lx + c, y: ly }, { x: -lx, y: ly - c }, { x: -lx, y: -ly + c },
    ];
    return raw.map((q) => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
  };
  let id = 0;
  const A: Anchors = { plateTint: new Map(), panelLines: new Map(), boltPts: [], ventId: -1, guardId: -1, stripeId: -1, decalPos: { x: 0, y: 0 }, numPos: { x: 0, y: 0 }, numText: '', lightPts: [], discs: [], chevrons: [], seamU: new Map(), insignia: { pos: { x: 0, y: 0 }, kind: 0 }, stripeThigh: -1, blockPlates: new Set(), deviceFrame: null, chevDecal: true, shinIds: new Set(), stripeSegs: [], panelDiag: new Map(), panelTee: new Map(), decalKind: 'num', toeFace: null, colorRole: new Map() };
  const addPlate = (a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap: number, cutA: number, cutB: number, kind: Kind = 'plate', bulge: Bulge = { f: 0, b: 0 }) => {
    // 独立成廓：每块板绕自身中心微转 + 横移 + 出边，轮廓在接缝处出天然台阶
    const js = (spec.shellMode ? 0.4 : 1) * (kind === 'foot' ? 0.5 : 1);
    const jit = (rnd() - 0.5) * 6.4 * js, rot = (rnd() - 0.5) * 0.11 * js, proud = 1 + (0.02 + rnd() * 0.1) * js;
    const f0 = segFrame(a, b), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const rotPt = (p: Pt): Pt => {
      const dx = p.x - mx, dy = p.y - my;
      return { x: mx + dx * Math.cos(rot) - dy * Math.sin(rot) + f0.px * jit, y: my + dx * Math.sin(rot) + dy * Math.cos(rot) + f0.py * jit };
    };
    const a2 = rotPt(a), b2 = rotPt(b);
    // 逐块形状：四角切角量（3/10 近直角，其余大切角）+ 侧边台阶
    const hwAvg = (wA + wB) / 4, shScale = kind === 'foot' ? 0.5 : 1;
    const cham = () => (rnd() < 0.3 ? rnd() * 5 : (0.2 + rnd() * 0.8) * hwAvg * 0.9) * shScale;
    const shape: PlateShape = { cTF: cham(), cTB: cham(), cBF: cham(), cBB: cham(), step: rnd() < 0.4 ? (rnd() - 0.5) * 14 : 0, stepPos: 0.3 + rnd() * 0.4 };
    if (kind === 'plate') { // 板衬边：同形宽 ×1.05 的框垫片，属板组件
      cv.insts.push({ kind: 'frame' });
      fillShape(cv, id, plateTest(a2, b2, wA * proud * 1.05, wB * proud * 1.05, Math.max(0, t0 - 0.008), Math.min(1, t1 + 0.008), 0, cutA, cutB, bulge, shape)); id++;
    }
    cv.insts.push({ kind }); const myId = id;
    fillShape(cv, id, plateTest(a2, b2, wA * proud, wB * proud, t0, t1, gap, cutA, cutB, bulge, shape)); id++;
    A.plateTint.set(myId, [0.78, 0.9, 1.0, 1.1, 1.24][Math.floor(rnd() * 5)]);
    const lines: number[] = []; const dtl = spec.detail ?? 1;
    const n = dtl < 0.7 ? (rnd() < 0.55 ? 0 : 1) : dtl > 1.1 ? 2 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) lines.push(0.3 + rnd() * 0.45);
    A.panelLines.set(myId, lines);
    A.seamU.set(myId, -0.42 + rnd() * 0.84); // 竖向面板缝位置
    if ((spec as LegSpec).shellMode && rnd() < 0.45) A.blockPlates.add(myId); // 人形壳：色块板
    if (rnd() < 0.3) A.panelDiag.set(myId, (rnd() - 0.5) * 0.9); // 斜面板线（错位网络）
    if (rnd() < 0.35) A.panelTee.set(myId, -0.5 + rnd()); // T 型接头竖线位置
    // 铆钉点：沿板两侧缘（跟随抖动后的板框）
    const f = segFrame(a2, b2);
    for (const vv of [0.14, 0.5, 0.86]) for (const ss of [-0.8, 0.8]) {
      const t = t0 + (t1 - t0) * vv, hw = ((wA + (wB - wA) * t) / 2) * proud;
      A.boltPts.push({ x: a2.x + f.ux * f.len * t + f.px * hw * ss, y: a2.y + f.uy * f.len * t + f.py * hw * ss });
    }
    return myId;
  };
  // 1) 内框杆（垫底）：沿轴窄带 + 关节间连接杆
  // 内体：沿关节链的结构核，半径自定（髋 26→膝 23→踝 16，×coreScale），与包络参数无关
  {
    const coreR = (spec.coreScale ?? 1) * (spec.frameHeavy ? 1.12 : 1);
    const coreSegs: [Pt, Pt, number, number][] = [[hip, knee, 34, 30], [knee, ankle, 30, 21]]; // v29 等比放大（29/25.5/18），收分剖面不变
    cv.insts.push({ kind: 'frame' });
    fillShape(cv, id, (x, y) => {
      let best: [boolean, number, number] = [false, 0, 0];
      for (let si = 0; si < 2; si++) {
        const [a, b, ra, rb] = coreSegs[si];
        const ux = b.x - a.x, uy = b.y - a.y, len = Math.hypot(ux, uy) || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ux + (y - a.y) * uy) / (len * len)));
        const d = Math.hypot(x - (a.x + ux * t), y - (a.y + uy * t)), r = (ra + (rb - ra) * t) * coreR;
        if (d <= r) { const uu = d / r, vv = (si + t) / 2; if (!best[0] || uu < best[1]) best = [true, uu, vv]; }
      }
      return best;
    }); id++;
  }
  // 框梁（仅框主导族）：窄板挂在露出的框梁上，段侧缘带归框梁（按段规格定宽，与甲板同源）
  if (spec.frameHeavy) for (const sgm of [thigh, shin]) {
    cv.insts.push({ kind: 'frame' });
    fillShape(cv, id, plateTest(sgm.a, sgm.b, sgm.wA * 0.82, sgm.wB * 0.82, 0, 1, 0, 0, 0, sgm.bulge)); id++;
  }
  // （v29 删）中心脊线：髋→踝一根直杆斜穿弯曲关节，形态错误；垫底由沿关节链的分段结构核承担
  // 2) 线缆：髋后 → 膝后 → 踝后两段贝塞尔（采样点盖章）
  const backOf = (s: { a: Pt; b: Pt }, t: number, off: number): Pt => {
    const f = segFrame(s.a, s.b);
    const sgn = std ? 1 : -1;
    return { x: s.a.x + f.ux * f.len * t + f.px * off * sgn, y: s.a.y + f.uy * f.len * t + f.py * off * sgn };
  };
  const cablePts: Pt[] = [];
  const sag = (spec.seed % 4) * 3 + (spec.guardOff ? 3 : 0);
  for (let k = 0; k <= 22; k++) cablePts.push(bezier(backOf(thigh, 0.06, 40), backOf(thigh, 0.5, 52 + sag), backOf(thigh, 0.97, 36), k / 22));
  for (let k = 0; k <= 22; k++) cablePts.push(bezier(backOf(shin, 0.04, 34), backOf(shin, 0.5, 46 + sag * 0.8), backOf(shin, 0.96, 28), k / 22));
  cv.insts.push({ kind: 'cable' });
  fillShape(cv, id, (x, y) => { let m = 1e9; for (const p of cablePts) m = Math.min(m, Math.hypot(x - p.x, y - p.y)); return [m <= 5.5, 0, m / 5.5]; }); id++;
  for (const e of [cablePts[0], cablePts[cablePts.length - 1]]) { cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, discTest(e, 4.5)); id++; } // 线缆端头接头
  // 3) 段板：种子不等分 2–3 块，每块独立宽缩放/收分/切角/间隙
  const fw = spec.frameHeavy ? 0.68 : 1;
  const fg = spec.shellMode ? 1.4 : spec.frameHeavy ? 8.5 : 5;
  const segPlates = (seg: { a: Pt; b: Pt; wA: number; wB: number; bulge: Bulge }): number[] => {
    const n = spec.shellMode ? 2 : (rnd() < 0.35 ? 3 : 2);
    const cuts: number[] = [0.006];
    if (n === 2) cuts.push(0.3 + rnd() * 0.38);
    else { const c1 = 0.18 + rnd() * 0.2; cuts.push(c1, c1 + 0.24 + rnd() * 0.26); }
    cuts.push(0.996);
    const ids: number[] = [];
    for (let k = 0; k < n; k++) {
      const sA = (0.97 + rnd() * 0.28) * fw, sB = (0.97 + rnd() * 0.28) * fw; // 逐块独立宽与收分（v29 宽度分布整体上移，保形态扩）
      ids.push(addPlate(seg.a, seg.b, seg.wA * sA, seg.wB * sB, cuts[k], cuts[k + 1], fg * (0.6 + rnd() * 1.1), rnd() * 24, rnd() * 24, 'plate', seg.bulge));
    }
    return ids;
  };
  const thighIds = segPlates(thigh);
  A.stripeThigh = thighIds[0];
  A.ventId = thighIds[thighIds.length - 1];
  const shinIds = segPlates(shin);
  A.shinIds = new Set(shinIds);
  if (spec.shellMode) {
    const sf = segFrame(shin.a, shin.b); const sgn2 = std ? -1 : 1;
    const SP = (t: number, off: number): Pt => ({ x: shin.a.x + sf.ux * sf.len * t + sf.px * sgn2 * off, y: shin.a.y + sf.uy * sf.len * t + sf.py * sgn2 * off });
    A.stripeSegs = [[SP(0.08, 26), SP(0.92, -14)]];
  }
  // 5) 脚：跟块/掌块/趾块（切角块组，与全图同一套块语言）
  const footBlock = (cx: number, cy: number, w: number, h: number, ang: number, cham = 0.38, seam?: number) => {
    cv.insts.push({ kind: 'foot' }); const bid = id;
    fillShape(cv, id, polyTest(blockPoly(cx, cy, w, h, ang, cham))); id++;
    A.plateTint.set(bid, [0.9, 1.0, 1.08][Math.floor(rnd() * 3)]);
    A.panelLines.set(bid, [0.5]);
    if (seam !== undefined) A.seamU.set(bid, seam); // 趾帽竖缝
  };
  // 足（v29 四型，全由有厚度的块组成；底面标高 470，块顶分级下行、块间叠压相接）
  const ft = spec.footType ?? 'blocks';
  if (ft === 'claw') {
    // 分趾爪足：基座块 + 前趾两节 + 后趾两节（趾块带转角下探、远节贴地）
    footBlock(ankle.x, 446, 46, 24, 0.05);
    footBlock(ankle.x + 30, 452, 52, 19, 0.4);
    footBlock(ankle.x + 68, 463, 46, 14, 0.06, 0.5);
    footBlock(ankle.x - 29, 452, 46, 18, -0.4);
    footBlock(ankle.x - 60, 463, 40, 13, -0.06, 0.5);
  } else if (ft === 'pad') {
    // 宽掌垫足：宽平基座 + 前段块 + 跟块（低矮、掌面宽）
    footBlock((ankle.x + toeX) / 2 + 4, 460, toeX - ankle.x + 62, 20, 0.01, 0.3);
    footBlock(toeX - 8, 453, 56, 15, 0.02, 0.45);
    footBlock(ankle.x - 20, 455, 44, 16, 0.03);
  } else {
    { // 踝上整流罩：靴筒块（blocks/shoe 共用）
      cv.insts.push({ kind: 'plate' }); const fid = id;
      fillShape(cv, id, polyTest(blockPoly(ankle.x + 38, 427, 96, 30, 0.12, 0.35))); id++;
      A.plateTint.set(fid, 0.95); A.panelLines.set(fid, [0.5]);
    }
    { cv.insts.push({ kind: 'frame' }); fillShape(cv, id, polyTest(blockPoly((ankle.x + toeX) / 2 + 1, 466, toeX - ankle.x + 70, 12, 0, 0.3))); id++; } // 足底件：只在底部留 2px 鞋底线
    footBlock(ankle.x - 24, 455, 64, 34, 0.04); // 跟块（顶 438）
    if (ft === 'shoe') {
      footBlock(ankle.x + 34, 457, 96, 26, -0.045, 0.3); // 鞋身块：微转，顶边略斜
      footBlock(toeX + 6, 461, 62, 18, 0.01, 0.55, 0.55); // 趾帽块：压鞋身前段，前上大切角
    } else if ((spec.wScale ?? 1) >= 1.3) {
      footBlock(ankle.x + 36, 456, 76, 35, 0.03); // 前掌大块（顶 438.5）
      footBlock(toeX + 4, 458, 56, 26, 0.04, 0.5); // 趾块（顶 445，钝厚）
      A.toeFace = { x0: toeX + 18, y0: 450, x1: toeX + 29, y1: 466 };
    } else {
      footBlock(ankle.x + 30, 457, 74, 30, 0.03); // 掌块（顶 442）
      footBlock(toeX - 1, 458, 60, 24, 0.03, 0.5, 0.5); // 趾块（顶 446，钝厚，前上大切角）
      A.toeFace = { x0: toeX + 15, y0: 451, x1: toeX + 26, y1: 465 };
    }
  }
  // 6) 前护板（多边形盾形，压在小腿前方）：坐标 = (沿轴 t, 离轴距离 off)；无护板族跳过
  if (!spec.guardOff) {
    const f = segFrame(shin.a, shin.b);
    const sgn = std ? -1 : 1; // front = -perp（标准型）
    const gS = 0.92 + rnd() * 0.25; // 护板比例逐腿不同（宽窄/突出量）
    const hwAt = (t: number) => ((shin.wA + (shin.wB - shin.wA) * t) / 2) * (1 + shin.bulge.f * bumpAt(t, 0.38)) * (spec.frameHeavy ? 0.8 : 1) * gS;
    const C = (t: number, off: number): Pt => ({
      x: shin.a.x + f.ux * f.len * t + f.px * sgn * off,
      y: shin.a.y + f.uy * f.len * t + f.py * sgn * off,
    });
    const pts = [
      C(0.02, hwAt(0.02) * 0.34), C(0.03, hwAt(0.03) * 1.02), C(0.16, hwAt(0.16) * 1.2),
      C(0.42, hwAt(0.42) * 1.14), C(0.7, hwAt(0.7) * 0.88), C(0.9, hwAt(0.9) * 0.55),
      C(0.99, hwAt(0.99) * 0.3), C(0.86, hwAt(0.86) * 0.22), C(0.5, hwAt(0.5) * 0.2), C(0.12, hwAt(0.12) * 0.22),
    ];
    cv.insts.push({ kind: 'guard' }); A.guardId = id; A.stripeId = id;
    fillShape(cv, id, polyTest(pts)); id++;
    A.plateTint.set(A.guardId, 1.05);
    A.panelLines.set(A.guardId, [0.52, 0.79]);
    A.decalPos = C(0.8, hwAt(0.8) * 0.44);
    { const df = segFrame(shin.a, shin.b); const dc = C(0.72, hwAt(0.72) * 0.6); A.deviceFrame = { c: dc, ux: df.ux, uy: df.uy, px: df.px, py: df.py }; }
    A.chevDecal = rnd() < 0.55;
    A.boltPts.push(C(0.12, hwAt(0.12) * 0.72), C(0.85, hwAt(0.85) * 0.42));
    // 三层叠人字纹（AA 式）：三个 ⌄ 上下叠，(t, off) 定义、渲染盖章
    for (const t0 of [0.16, 0.32, 0.48]) {
      const apex = C(t0 + 0.07, hwAt(t0 + 0.07) * 0.88);
      A.chevrons.push([C(t0, hwAt(t0) * 0.3), apex], [apex, C(t0 + 0.14, hwAt(t0 + 0.14) * 0.3)]);
    }
  }
  // 6.5) 膝盖帽 + 杂物小盒（参考图的构件密度主要来自这类小件）
  {
    const f = segFrame(shin.a, shin.b); const sgn = std ? -1 : 1;
    const C = (along: number, off: number): Pt => ({
      x: knee.x + f.ux * along + f.px * sgn * off, y: knee.y + f.uy * along + f.py * sgn * off,
    });
    const cap = [C(-34, 22), C(-30, 44), C(2, 50), C(26, 40), C(24, 20)];
    cv.insts.push({ kind: 'plate' }); const capId = id;
    fillShape(cv, id, polyTest(cap)); id++;
    A.plateTint.set(capId, 1.06); A.panelLines.set(capId, [0.55]);
    // 大腿前小盒 + 小腿后挂盒
    const box = (cx: number, cy: number, w: number, h: number) => {
      cv.insts.push({ kind: 'plate' }); const bid = id;
      const cc = Math.min(w, h) * 0.24, x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
      fillShape(cv, id, polyTest([{ x: x0 + cc, y: y0 }, { x: x1 - cc, y: y0 }, { x: x1, y: y0 + cc }, { x: x1, y: y1 - cc }, { x: x1 - cc, y: y1 }, { x: x0 + cc, y: y1 }, { x: x0, y: y1 - cc }, { x: x0, y: y0 + cc }])); id++;
      A.plateTint.set(bid, 0.94); A.panelLines.set(bid, []);
    };
    const tf = segFrame(thigh.a, thigh.b); const tsgn = std ? -1 : 1;
    box(thigh.a.x + tf.ux * tf.len * 0.3 + tf.px * tsgn * 44, thigh.a.y + tf.uy * tf.len * 0.3 + tf.py * tsgn * 44, 26, 34);
    box(shin.a.x + f.ux * f.len * 0.62 - f.px * sgn * 40, shin.a.y + f.uy * f.len * 0.62 - f.py * sgn * 40, 20, 28);
  }
  // 6.6) 中型构件一批：裙板 / 副油缸 / 膝连杆 / 排气管 / 背导轨 / 踝护板 / 提手
  {
    const tf = segFrame(thigh.a, thigh.b);
    const P = (t: number, off: number): Pt => ({ x: thigh.a.x + tf.ux * tf.len * t + tf.px * off, y: thigh.a.y + tf.uy * tf.len * t + tf.py * off });
    // 大腿后裙板（沿后侧另挂一块，向上张开）
    addPlate(P(0.0, 13), P(0.48, 13), 68, 54, 0.02, 0.98, 2.6, 4, 12);
    // 膝连杆：膝后一根粗杆跨接两段 + 两端销盘
    const l1 = backOf(thigh, 0.8, 27), l2 = backOf(shin, 0.15, 23);
    cv.insts.push({ kind: 'frame' }); fillShape(cv, id, lineTest(l1, l2, 7)); id++;
    for (const e of [l1, l2]) { cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, discTest(e, 8)); id++; }
    // 小腿背导轨
    cv.insts.push({ kind: 'plate' }); const railId = id;
    fillShape(cv, id, lineTest(backOf(shin, 0.14, 41), backOf(shin, 0.88, 35), 4.5)); id++;
    A.plateTint.set(railId, 0.95); A.panelLines.set(railId, []);
    // 小腿排气管 ×3（膝后向上短管）
    for (let k = 0; k < 3; k++) {
      const base = backOf(shin, 0.1 + k * 0.055, 33);
      cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, lineTest(base, { x: base.x - 3, y: base.y - 32 }, 4.2)); id++;
    }
    // 踝前护板
    cv.insts.push({ kind: 'plate' }); const agId = id;
    fillShape(cv, id, polyTest([{ x: ankle.x + 16, y: 402 }, { x: ankle.x + 36, y: 412 }, { x: ankle.x + 37, y: 442 }, { x: ankle.x + 25, y: 458 }, { x: ankle.x + 13, y: 434 }])); id++;
    A.plateTint.set(agId, 1.0); A.panelLines.set(agId, [0.5]);
    // 提手：大腿下板正面 Π 形（两脚 + 横杆，金属色）
    const hf = segFrame(thigh.a, thigh.b); const hsgn = std ? -1 : 1;
    const H = (t: number, off: number): Pt => ({ x: thigh.a.x + hf.ux * hf.len * t + hf.px * hsgn * off, y: thigh.a.y + hf.uy * hf.len * t + hf.py * hsgn * off });
    const h1 = H(0.66, 47), h2 = H(0.8, 47), h1b = H(0.66, 38), h2b = H(0.8, 38);
    cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, lineTest(h1b, h1, 3)); id++;
    cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, lineTest(h2b, h2, 3)); id++;
    cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, lineTest(h1, h2, 3.4)); id++;
  }
  // 7) 活塞：大腿后侧、 小腿前侧（反关节互换）
  const piston = (a: Pt, b: Pt, rC = 10, rR = 5.5) => {
    const mid = { x: a.x + (b.x - a.x) * 0.5, y: a.y + (b.y - a.y) * 0.5 };
    cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, lineTest(a, mid, rC)); id++;
    cv.insts.push({ kind: 'rod' }); fillShape(cv, id, lineTest(mid, b, rR)); id++;
    for (const e of [a, b]) { cv.insts.push({ kind: 'cyl' }); fillShape(cv, id, discTest(e, rC * 0.9)); id++; }
  };
  piston(backOf(thigh, 0.14, 44), backOf(thigh, 0.88, 40));
  piston(backOf(thigh, 0.24, 26), backOf(thigh, 0.62, 24), 6, 3.2); // 副油缸（贴板面、更细更短）
  {
    const f = segFrame(shin.a, shin.b); const sgn = std ? -1 : 1;
    const F = (t: number, off: number): Pt => ({ x: shin.a.x + f.ux * f.len * t + f.px * sgn * off, y: shin.a.y + f.uy * f.len * t + f.py * sgn * off });
    piston(F(0.12, 13), F(0.86, 10), 8, 4.2); // 贴护板内缘走线，不抢护板正面
    if (spec.guardOff && !spec.shellMode) piston(F(0.18, 27), F(0.9, 23), 6.5, 3.4); // 无护板族：第二根前活塞成对露出（侦察式）
  }
  // 8) 关节 = 块簇：沿段轴的壳体块 + 盖帽盘 + 切角毂块
  const segAng = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);
  const ja = (q: Pt, ang: number, dist: number): Pt => ({ x: q.x + Math.cos(ang) * dist, y: q.y + Math.sin(ang) * dist });
  const jointBlock = (c: Pt, ang: number, w: number, h: number) => {
    cv.insts.push({ kind: 'plate' }); const bid = id;
    fillShape(cv, id, polyTest(blockPoly(c.x, c.y, w, h, ang, 0.4))); id++;
    A.plateTint.set(bid, [0.85, 0.95, 1.05][Math.floor(rnd() * 3)]);
    A.panelLines.set(bid, []);
  };
  for (const [j, r] of [[hip, 41], [knee, 39], [ankle, 25]] as [Pt, number][]) {
    cv.insts.push({ kind: 'frame' }); fillShape(cv, id, discTest(j, r)); id++; // 关节法兰：盖帽垫圈（v29 半径改由盖帽派生，见下方半径表）
  }
  for (const [j, r] of [[hip, 37], [knee, 35], [ankle, 21]] as [Pt, number][]) {
    const cc = { x: j.x + (rnd() * 8 - 4), y: j.y + (rnd() * 6 - 3) }; // 盖帽偏心，不再正中靶心
    cv.insts.push({ kind: 'disc' }); fillShape(cv, id, discTest(cc, r)); A.discs.push({ id, c: cc, r, hv: A.discs.length % 3 }); id++;
  }
  // 壳体块画在盖帽之后：压住帽缘、关节成簇（v15 画在帽前被帽盖住，等于没加）
  jointBlock(ja(hip, segAng(hip, knee), 30), segAng(hip, knee), 64, 46);
  jointBlock(ja(knee, segAng(knee, hip), 28), segAng(knee, hip), 62, 42);
  jointBlock(ja(knee, segAng(knee, ankle), 28), segAng(knee, ankle), 56, 40);
  jointBlock(ja(ankle, segAng(ankle, knee), 19), segAng(ankle, knee), 44, 32);
  jointBlock(ja(knee, segAng(knee, hip) + 0.55, 34), segAng(knee, hip) + 0.3, 38, 28);
  jointBlock(ja(hip, segAng(hip, knee) - 0.6, 32), segAng(hip, knee) - 0.3, 36, 26);
  jointBlock(ja(hip, segAng(hip, knee) + 0.55, 32), segAng(hip, knee) + 0.3, 36, 25); // 髋前整流块
  // 毂块：盖帽中心的切角方块（块语言，不再画同心毂环/毂心变体）
  for (const [j, r] of [[hip, 37], [knee, 35], [ankle, 21]] as [Pt, number][]) {
    cv.insts.push({ kind: 'plate' }); const hid = id;
    const dc = A.discs.find((d) => Math.abs(d.c.x - j.x) < 12 && Math.abs(d.c.y - j.y) < 12)?.c ?? j;
    fillShape(cv, id, polyTest(blockPoly(dc.x, dc.y, r * 0.62, r * 0.62, 0.3, 0.45))); id++;
    A.plateTint.set(hid, 1.1); A.panelLines.set(hid, []);
  }
  // 膝后波纹套（显形版）：画在盖帽之后、加粗后移，落在关节后凹口
  for (let k = 0; k < 5; k++) {
    const b1 = backOf(thigh, 0.94 + k * 0.015, 17 + k * 5), b2 = backOf(shin, 0.09 - k * 0.015, 17 + k * 5);
    cv.insts.push({ kind: 'frame' }); fillShape(cv, id, lineTest(b1, b2, 4.2)); id++;
  }
  // 贴纸编号锚点（大腿下板前缘）与信号灯
  {
    const f = segFrame(thigh.a, thigh.b); const sgn = std ? -1 : 1;
    A.numPos = { x: thigh.a.x + f.ux * f.len * 0.68 + f.px * sgn * 16, y: thigh.a.y + f.uy * f.len * 0.68 + f.py * sgn * 16 };
    A.decalKind = spec.decalKind ?? 'num';
    A.numText = A.decalKind === 'num' ? 'M-' + (10 + Math.floor(rnd() * 89)) : '';
    // 编号按板定位：在大腿首板（stripeThigh）的实际像素里找完整落点（整串字落在一块板内）
    if (A.numText) {
      const tw = A.numText.length * 8 - 2, th = 10;
      let found: Pt | null = null;
      for (let y = 56; y < 250 && !found; y += 2) for (let x = 96; x < 300 && !found; x += 2) {
        let ok = true;
        for (let yy = y; yy < y + th && ok; yy++) for (let xx = x; xx < x + tw && ok; xx++) if (cv.owner[yy * W + xx] !== A.stripeThigh) ok = false;
        if (ok) found = { x, y };
      }
      if (found) A.numPos = found;
    }
    A.insignia = { pos: { x: A.numPos.x + 4, y: A.numPos.y - 34 }, kind: Math.floor(rnd() * 4) };
    A.lightPts = [{ x: knee.x + (std ? 26 : -26), y: knee.y - 30 }, { x: hip.x - 30, y: hip.y + 34 }];
    if ((spec.detail ?? 1) > 1.1) { // 高细节族：小腿前三灯串（侦察式）
      const lf = segFrame(shin.a, shin.b); const lsgn = std ? -1 : 1;
      for (const lt of [0.3, 0.55, 0.8]) A.lightPts.push({ x: shin.a.x + lf.ux * lf.len * lt + lf.px * lsgn * 26, y: shin.a.y + lf.uy * lf.len * lt + lf.py * lsgn * 26 });
    }
  }
  // 剪影 = 包络 ∪ 全部部件：部件探出包络的部分同样成廓
  for (let i = 0; i < W * H; i++) if (cv.owner[i] >= 0) cv.sil[i] = 1;
  return A;
}

// 形态明暗剖面：u=-1 前缘 → +1 后缘，非对称分段（高光带偏前、背侧收暗）
function formProfile(u: number): number {
  const P: [number, number][] = [[-1, 0.72], [-0.78, 1.14], [-0.3, 1.0], [0.3, 0.85], [0.72, 0.67], [1, 0.53]];
  for (let k = 0; k < P.length - 1; k++) {
    const [x0, y0] = P[k], [x1, y1] = P[k + 1];
    if (u >= x0 && u <= x1) return y0 + (y1 - y0) * ((u - x0) / (x1 - x0));
  }
  return u < 0 ? P[0][1] : P[P.length - 1][1];
}
const quant = (f: number) => Math.round(f / 0.055) * 0.055; // 坡道量化：平坦色阶带


// ---------- IR（v1，定义见 IR.md） ----------
interface MechaIR {
  version: 1; archetype: 'humanoid' | 'walker' | 'beast';
  scheme: string; seed: number;
  style: { wear: number; camo: boolean; cableTint?: RGB; decalKind: 'num' | 'plate' | 'none'; lift: number };
  rig: { topology: 'standard' | 'reverse'; shellMode: boolean; wScale: number };
  canvas: { w: number; h: number; groundY: number };
  anchors: Record<string, Pt & { y: number }>;
  volumes: unknown[];
  parts: { id: string; pattern: string; anchors: string[]; params: Record<string, number | string | boolean> }[];
}
const FOOT_PATTERN = { blocks: 'footBlocks', shoe: 'footShoe', claw: 'footClaw', pad: 'footPad' } as const;
const FOOT_TYPE = { footBlocks: 'blocks', footShoe: 'shoe', footClaw: 'claw', footPad: 'pad' } as const;
function legIR(spec: LegSpec): MechaIR {
  const std = spec.topology === 'standard';
  const hip = { x: 170, y: 44 };
  const knee = std ? { x: 236 + spec.bend, y: 248 } : { x: 112 + spec.bend, y: 244 };
  const ankle = { x: 178 + (std ? -1 : 1) * (spec.ankleShift ?? 10), y: 434 };
  const toe = { x: ankle.x + 100, y: 470 };
  const ws = spec.wScale ?? 1;
  const schemeName = Object.entries(SCHEMES).find(([, v]) => v === spec.scheme)?.[0] ?? 'olive';
  const parts: MechaIR['parts'] = [
    { id: 'core', pattern: 'core', anchors: ['hip', 'knee', 'ankle'], params: { coreScale: spec.coreScale ?? 1 } },
  ];
  if (spec.frameHeavy) parts.push({ id: 'frameBeam', pattern: 'frameBeam', anchors: ['hip', 'knee', 'ankle'], params: {} });
  parts.push(
    { id: 'cables', pattern: 'cableRun', anchors: ['hip', 'knee', 'ankle'], params: {} },
    { id: 'thigh.plates', pattern: 'segPlates', anchors: ['hip', 'knee'], params: { wA: 110 * ws, wB: 84 * ws, bulgeF: 0.16, bulgeB: 0.05 } },
    { id: 'shin.plates', pattern: 'segPlates', anchors: ['knee', 'ankle'], params: { wA: 94 * ws, wB: 64 * ws, bulgeF: 0.05, bulgeB: 0.2 } },
    { id: 'foot', pattern: FOOT_PATTERN[spec.footType ?? 'blocks'], anchors: ['ankle', 'toe'], params: {} },
  );
  if (!spec.guardOff) parts.push({ id: 'guard', pattern: 'guard', anchors: ['knee', 'ankle'], params: {} });
  parts.push({ id: 'kneeCapBox', pattern: 'kneeCapBox', anchors: ['knee'], params: {} });
  if (spec.detail === undefined || spec.detail > 0) parts.push({ id: 'detailSet', pattern: 'detailSet', anchors: ['hip', 'knee', 'ankle'], params: { level: spec.detail ?? 1 } });
  parts.push(
    { id: 'pistons', pattern: 'pistonPair', anchors: ['hip', 'knee', 'ankle'], params: {} },
    { id: 'hip.joint', pattern: 'jointCluster', anchors: ['hip'], params: { r: 30 } },
    { id: 'knee.joint', pattern: 'jointCluster', anchors: ['knee'], params: { r: 28 } },
    { id: 'ankle.joint', pattern: 'jointCluster', anchors: ['ankle'], params: { r: 18 } },
    { id: 'bellows', pattern: 'bellows', anchors: ['knee'], params: {} },
    { id: 'decals', pattern: 'decals', anchors: [], params: { decalKind: spec.decalKind ?? 'num' } },
  );
  return {
    version: 1, archetype: 'humanoid', scheme: schemeName, seed: spec.seed,
    style: { wear: spec.wear ?? 1, camo: spec.camo, cableTint: spec.cableTint, decalKind: spec.decalKind ?? 'num', lift: spec.lift ?? 0 },
    rig: { topology: spec.topology, shellMode: spec.shellMode ?? false, wScale: ws },
    canvas: { w: W, h: H, groundY: 470 },
    anchors: { hip, knee, ankle, toe },
    volumes: [
      { kind: 'seg', a: 'hip', b: 'knee', wA: 110 * ws, wB: 84 * ws },
      { kind: 'seg', a: 'knee', b: 'ankle', wA: 94 * ws, wB: 64 * ws },
      { kind: 'disc', c: 'hip', r: 36 }, { kind: 'disc', c: 'knee', r: 34 }, { kind: 'disc', c: 'ankle', r: 21 },
    ],
    parts,
  };
}
function viewOf(ir: MechaIR): LegSpec {
  const part = (p: string) => ir.parts.find((q) => q.pattern === p);
  const foot = ir.parts.find((q) => q.id === 'foot');
  return {
    topology: ir.rig.topology, scheme: SCHEMES[ir.scheme], seed: ir.seed, bend: 0,
    camo: ir.style.camo, wear: ir.style.wear, frameHeavy: !!part('frameBeam'),
    shellMode: ir.rig.shellMode, wScale: ir.rig.wScale, lift: ir.style.lift,
    guardOff: !part('guard'), detail: (part('detailSet')?.params.level as number) ?? 0,
    cableTint: ir.style.cableTint, decalKind: ir.style.decalKind,
    coreScale: (part('core')?.params.coreScale as number) ?? 1,
    footType: FOOT_TYPE[(foot?.pattern ?? 'footBlocks') as keyof typeof FOOT_TYPE],
  };
}
function renderIR(ir: MechaIR) {
  const spec = viewOf(ir);
  const cv = newCanvas();
  const A = layout(cv, spec, { hip: ir.anchors.hip, knee: ir.anchors.knee, ankle: ir.anchors.ankle, toeX: ir.anchors.toe.x });
  return finishRender(cv, A, spec);
}

// ---------- 渲染 ----------
function render(spec: LegSpec) { return renderIR(legIR(spec)); }
function finishRender(cv: Canvas, A: Anchors, spec: LegSpec) {
  const S = spec.scheme;
  const rnd = mulberry32(spec.seed + 99);
  const set = (i: number, c: RGB) => { cv.col[i * 4] = c[0]; cv.col[i * 4 + 1] = c[1]; cv.col[i * 4 + 2] = c[2]; cv.col[i * 4 + 3] = 255; };
  const get = (i: number): RGB => [cv.col[i * 4], cv.col[i * 4 + 1], cv.col[i * 4 + 2]];
  // 基色 + 场着色（量化坡道）
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!cv.sil[i]) continue;
    const o = cv.owner[i], inst = o >= 0 ? cv.insts[o] : null;
    const u = cv.u[i], v = cv.v[i];
    if (!inst) { continue; } // 无主像素不画：透明合法、平填是缺陷（v29）
    const mottle = 0.94 + 0.11 * vnoise(x / 8, y / 8, spec.seed + 1);
    if (inst.kind === 'frame') { const band = Math.floor(v * 16) % 2 === 0 ? 1 : 0.93; set(i, ramp(mix(S.frame, S.metal, 0.28), 0.74 * mottle * band * (1.03 - 0.14 * Math.abs(u)))); } // 框件枪灰+分带
    else if (inst.kind === 'cable') set(i, ramp(spec.cableTint ? mix(S.frame, spec.cableTint, 0.55) : S.frame, (1.05 - 0.5 * v) * mottle));
    else if (inst.kind === 'plate' || inst.kind === 'guard' || inst.kind === 'foot') {
      const tint = A.plateTint.get(o) ?? 1;
      const uu = inst.kind === 'guard' ? -u : u; // 多边形护板的 u 是包围盒坐标，方向与段板相反
      // 面式着色：折线/面数/色调组全部按板种子（块间参数发散）
      const h1 = (((o * 2654435761) >>> 0) % 100) / 100, h2 = (((o * 40503 + 7) >>> 0) % 100) / 100;
      const h3 = (((o * 2246822519) >>> 0) % 100) / 100, h4 = (((o * 3266489917) >>> 0) % 100) / 100;
      const fb1 = -0.7 + h1 * 0.45, fb2 = 0.15 + h2 * 0.5;
      const tBack = h4 < 0.22 ? 0.93 + h3 * 0.07 : 0.7 + h2 * 0.16;  // 约 1/5 板背带并入主面（两面块）
      const tMain = 0.93 + h3 * 0.1, tEdge = 0.8 + h1 * 0.14;
      const bevW = h3 < 0.3 ? 0 : 0.1 + h3 * 0.14, tBev = 1.08 + h4 * 0.2; // 约 3/10 板无亮斜面（三面块）
      let fz = uu < fb1 ? tBack : uu < fb2 ? tMain : uu < fb2 + bevW ? tBev : tEdge;
      if (spec.shellMode) fz = 1 + (fz - 1) * 0.75; // 人形壳面间对比略柔
      if (h1 > 0.45 && v > 0.52 + 0.28 * uu) fz *= 0.9; // 斜折面
      if (bevW > 0 && Math.abs(uu - fb2) < 0.028) fz *= 1.15; // 主折线亮棱（主面一侧）
      let f = fz * tint * (1 + (mottle - 1) * 0.35);
      if (v < 0.045) f *= 1.13; else if (v > 0.955) f *= 0.8; // 板端平带：上亮下暗
      f = quant(f, 0.045);
      let base = o % 2 ? S.armor : S.armor2;
      if (A.blockPlates.has(o)) base = mix(base, S.accent, 0.38);
      // 大腿饰带：首板下缘双条强调色带
      if (o === A.stripeThigh && ((v > 0.8 && v < 0.845) || (v > 0.875 && v < 0.92))) { set(i, ramp(S.accent, 0.98)); continue; }
      if (inst.kind === 'foot') { base = S.armor2; f *= 0.85; }
      if (inst.kind === 'guard') { base = S.armor; f *= 1.04; } // 护板与段板分面（体积靠剖面本身）
      const cr = A.colorRole?.get(o); if (cr === 'armor2') base = S.armor2; else if (cr === 'accent') base = S.accent;
      if (spec.camo && vnoise(x / 58, y / 40, spec.seed + 3) > 0.62) base = mix(base, shade2(S.armor2, 0.8), 0.7);
      let c = ramp(base, f);
      // 面板线（横向 + 竖向缝，成网）
      const dg = A.panelDiag.get(o);
      for (const lv of A.panelLines.get(o) ?? []) {
        const lvE = dg ? lv + dg * u * 0.45 : lv;
        if (Math.abs(v - lvE) < 0.011) c = ramp(base, f * 0.58);
        else if (Math.abs(v - lvE - 0.017) < 0.008) c = ramp(base, f * 1.17); // 刻线下唇受光
      }
      const tee = A.panelTee.get(o);
      if (tee !== undefined && Math.abs(u - tee) < 0.02 && v > 0.18 && v < 0.82) c = ramp(base, f * 0.58); // T 接头
      const su = A.seamU.get(o);
      if (su !== undefined && v > 0.12 && v < 0.88) {
        if (Math.abs(u - su) < 0.02) c = ramp(base, f * 0.58);
        else if (Math.abs(u - su + 0.034) < 0.009) c = ramp(base, f * 1.15); // 竖缝前侧受光唇
      }
      // 警示纹在细节段按线段距离盖章（见下方 chevrons），此处不处理
      // 鞋底纹：脚底横向刻槽
      if (inst.kind === 'foot' && y > 470 && (x % 13) < 6) c = ramp(base, f * 0.5);
      if (inst.kind === 'foot' && v > 0.78) c = ramp(base, f * 0.68); // 鞋底带
      // 通风栅：大腿下板一块栅格
            if (o === A.ventId && u > -0.52 && u < 0.34 && v > 0.1 && v < 0.3) {
        const cyc = y % 12; // 凹槽：槽顶影 / 槽底 / 槽下唇受光
        if (cyc < 2) c = ramp(S.frame, 0.5);
        else if (cyc < 8) c = ramp(S.frame, 0.32);
        else if (cyc < 9) c = ramp(S.armor2, 1.05);
      }
      set(i, c);
    } else if (inst.kind === 'disc') {
      set(i, ramp(S.metal, 0.85 * mottle)); // 圆盘配方在调色拉伸后的专用 pass 按角度重绘
    } else if (inst.kind === 'cyl') {
      // 圆柱剖面：高光偏前（u=-0.3）、两缘收暗
      let f = 0.3 + 0.95 * Math.max(0, 1 - Math.abs(u + 0.3)) ** 1.5;
      if (v < 0.1 || (v > 0.45 && v < 0.55) || v > 0.9) f *= 0.6; // 缸筒环带
      set(i, ramp(S.metal, quant(f * mottle)));
    } else if (inst.kind === 'rod') {
      // 拉杆五段横剖面：暗缘 / 肩 / 亮芯 / 肩 / 暗缘（参考铬杆的画法）
      const rp = u < -0.82 ? 0.3 : u < -0.48 ? 0.78 : u < -0.1 ? 1.34 : u < 0.32 ? 0.72 : u < 0.72 ? 0.44 : 0.27;
      set(i, ramp(S.chrome, quant(rp * mottle)));
    }
  }
  // 全局调色拉伸：暗更暗、亮更亮（拉开 std 与深暗部，细节盖章在其后保持 crisp）
  for (let i = 0; i < W * H; i++) {
    if (!cv.sil[i] || cv.col[i * 4 + 3] === 0) continue;
    for (let ch = 0; ch < 3; ch++) cv.col[i * 4 + ch] = Math.max(0, Math.min(255, (cv.col[i * 4 + ch] - 26) * 1.24 + 10));
  }
  // 分族明度抬升（逐族对参考明度带）
  { const lift = spec.lift ?? 0; if (lift) for (let i = 0; i < W * H; i++) { if (!cv.sil[i] || cv.col[i * 4 + 3] === 0) continue; for (let ch = 0; ch < 3; ch++) cv.col[i * 4 + ch] = Math.min(255, cv.col[i * 4 + ch] + lift); } }
  // 投影：光自前上、影向后下；owner 序号大者靠前，在身后部件上落影
  {
    const CAST = new Set(['plate', 'guard', 'foot', 'disc']);
    const offs: [number, number, number][] = [[-5, 6, 0.64], [-10, 12, 0.8], [-16, 20, 0.9]];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!cv.sil[i] || cv.col[i * 4 + 3] === 0) continue;
      const o = cv.owner[i];
      for (const [dx, dy, m] of offs) {
        const sx = x - dx, sy = y - dy;
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
        const so = cv.owner[sy * W + sx];
        if (so > o && CAST.has(cv.insts[so].kind)) { set(i, ramp(get(i), m)); break; }
      }
    }
  }
  // （v10 起刻槽/螺栓圈并入下方圆盘配方 pass）
  // 关节盖帽：整面按扇区平坦分面（一块的面）+ 一道毂缝线 + 帽缘收边（无同心环）
  for (const d of A.discs) {
    const x0 = Math.max(0, Math.floor(d.c.x - d.r)), x1 = Math.min(W - 1, Math.ceil(d.c.x + d.r));
    const y0 = Math.max(0, Math.floor(d.c.y - d.r)), y1 = Math.min(H - 1, Math.ceil(d.c.y + d.r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (cv.owner[i] !== d.id) continue;
      const dx = (x - d.c.x) / d.r, dy = (y - d.c.y) / d.r;
      const rr = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      const fa = (Math.floor((ang + Math.PI) / (Math.PI / 6)) + 0.5) * (Math.PI / 6) - Math.PI;
      let c = ramp(mix(S.armor2, S.metal, 0.45), quant(0.86 + 0.42 * (0.45 * Math.cos(fa) - 0.89 * Math.sin(fa)), 0.05));
      if (rr > 0.93) c = ramp(c, 0.78); // 帽缘收边
      set(i, c);
    }
  }
  // 标志图形盖章（菱/十字/三角/横杠，种子选一）
  {
    const { pos, kind } = A.insignia;
    const cx = Math.round(pos.x), cy = Math.round(pos.y);
    const colr = ramp(S.decal, 1.0);
    const put = (px: number, py: number) => { if (px >= 0 && px < W && py >= 0 && py < H && cv.sil[py * W + px]) set(py * W + px, colr); };
    if (kind === 0) { for (let dy = -8; dy <= 8; dy++) { const wdt = 8 - Math.abs(dy); for (let dx = -wdt; dx <= wdt; dx++) if (Math.abs(dx) > wdt - 2.4) put(cx + dx, cy + dy); } }
    else if (kind === 1) { for (let d = -8; d <= 8; d++) { put(cx + d, cy); put(cx + d, cy + 1); put(cx, cy + d); put(cx + 1, cy + d); } }
    else if (kind === 2) { for (let dy = 0; dy < 10; dy++) for (let dx = -dy / 2; dx <= dy / 2; dx++) if (Math.abs(dx) > dy / 2 - 1.6 || dy > 7.6) put(cx + Math.round(dx), cy + dy - 5); }
    else { for (let r = 0; r < 3; r++) for (let dx = -8; dx <= 8; dx++) { put(cx + dx, cy - 6 + r * 6); put(cx + dx, cy - 5 + r * 6); } }
  }
  // 人形壳涂装条纹：沿小腿壳面斜扫的强调色带（只落小腿壳板）
  for (const [p1, p2] of A.stripeSegs) {
    const x0 = Math.max(0, Math.floor(Math.min(p1.x, p2.x) - 10)), x1 = Math.min(W - 1, Math.ceil(Math.max(p1.x, p2.x) + 10));
    const y0 = Math.max(0, Math.floor(Math.min(p1.y, p2.y) - 10)), y1 = Math.min(H - 1, Math.ceil(Math.max(p1.y, p2.y) + 10));
    const dxs = p2.x - p1.x, dys = p2.y - p1.y, ll = Math.hypot(dxs, dys) || 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (!A.shinIds.has(cv.owner[i])) continue;
      const tt = Math.max(0, Math.min(1, ((x - p1.x) * dxs + (y - p1.y) * dys) / (ll * ll)));
      const m = Math.hypot(x - (p1.x + dxs * tt), y - (p1.y + dys * tt));
      if (m < 6.5) set(i, ramp(S.accent, 0.95));
    }
  }
  // 仪表窗（scout 式）：小腿板面凹框 + 强调色窗面 + 高光点
  if (A.deviceFrame) {
    const { c: dc, ux, uy, px, py } = A.deviceFrame; // 锚在护板下部（C(0.72, hw*0.6)），盖章在护板面上
    for (let y = Math.floor(dc.y - 20); y <= dc.y + 20; y++) for (let x = Math.floor(dc.x - 20); x <= dc.x + 20; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const i = y * W + x;
      if (!cv.sil[i]) continue;
      const rx = x - dc.x, ry = y - dc.y;
      const du = rx * ux + ry * uy, dv = rx * px + ry * py;
      if (Math.abs(du) > 11 || Math.abs(dv) > 8) continue;
      if (Math.abs(du) > 8.5 || Math.abs(dv) > 5.5) set(i, ramp(S.frame, 1.25));
      else if (dv < -2.5) set(i, ramp(S.accent, 0.72));
      else set(i, ramp(S.accent, 1.05));
      if (Math.abs(du + 3) < 1.4 && Math.abs(dv - 1) < 1.4) set(i, ramp(S.glow, 1.3));
    }
  }
  // 大腿双斜杠贴花（编号下方，两道短斜杠）
  {
    const cx = Math.round(A.numPos.x - 2), cy = Math.round(A.numPos.y + 13);
    for (let k = 0; k < 2; k++) for (let t = 0; t < 13; t++) {
      const bx = cx + k * 11 + Math.round(t * 0.55), by = cy + t;
      for (let wdt = 0; wdt < 3; wdt++) {
        const pxx = bx + wdt, pyy = by;
        if (pxx >= 0 && pxx < W && pyy >= 0 && pyy < H && cv.sil[pyy * W + pxx]) set(pyy * W + pxx, ramp(S.accent, 0.98));
      }
    }
  }
  // 警示箭头纹盖章：只落在护板上、距线段 <4.5px 处
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (cv.owner[i] !== A.stripeId) continue;
    let m = 1e9;
    for (const [p, q] of A.chevrons) {
      const f = segFrame(p, q);
      const rx = x - p.x, ry = y - p.y;
      const t = Math.max(0, Math.min(1, (rx * f.ux + ry * f.uy) / f.len));
      m = Math.min(m, Math.hypot(x - (p.x + f.ux * f.len * t), y - (p.y + f.uy * f.len * t)));
    }
    if (m < 3.4) set(i, A.chevDecal ? ramp(S.decal, 0.98) : ramp(S.accent, 1.02));
  }
  // 贴纸文字与编号
  const drawText = (anchor: Pt, text: string, scale: number, colr: RGB, center = false, clipId = -1) => {
    const wpx = text.length * 4 * scale - scale;
    let cx0 = Math.round(anchor.x - (center ? wpx / 2 : 0)), cy0 = Math.round(anchor.y);
    for (const ch of text) {
      const g = FONT[ch] ?? FONT[' '];
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (g[gy][gx] === '1')
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
          const px = cx0 + gx * scale + sx, py = cy0 + gy * scale + sy;
          if (px >= 0 && px < W && py >= 0 && py < H && cv.sil[py * W + px] && (clipId < 0 || cv.owner[py * W + px] === clipId)) set(py * W + px, colr);
        }
      cx0 += 4 * scale;
    }
  };
  drawText(A.decalPos, 'CAUTION', 2, ramp(S.decal, 1.0), true, A.guardId);
  drawText(A.numPos, A.numText, 2, ramp(S.decal, 0.95), false, A.stripeThigh);
  // 趾块前端面（主战式）：带框端面板 + 中心栓点，只落在足块像素上
  if (A.toeFace) {
    const F = A.toeFace;
    for (let y = F.y0; y <= F.y1; y++) for (let x = F.x0; x <= F.x1; x++) {
      const i = y * W + x;
      if (cv.owner[i] < 0 || cv.insts[cv.owner[i]].kind !== 'foot') continue;
      const edge = x === F.x0 || x === F.x1 || y === F.y0 || y === F.y1;
      const dot = Math.abs(x - (F.x0 + F.x1) / 2) <= 1 && Math.abs(y - (F.y0 + F.y1) / 2) <= 1;
      const c = get(i);
      if (edge || dot) set(i, [c[0] * 0.5, c[1] * 0.5, c[2] * 0.52]);
      else set(i, [c[0] * 1.16, c[1] * 1.16, c[2] * 1.14]);
    }
  }
  // 警示三角（CAUTION 上方）
  {
    const cx = Math.round(A.decalPos.x), cy = Math.round(A.decalPos.y) - 16;
    for (let dy = 0; dy < 9; dy++) for (let dx = -dy / 2; dx <= dy / 2; dx++) {
      const px = cx + Math.round(dx), py = cy + dy;
      if (px >= 0 && px < W && py >= 0 && py < H && cv.sil[py * W + px]) set(py * W + px, ramp(S.accent, 1.0));
    }
  }
  // 铆钉：2px 暗点 + 1px 高光
  for (const p of A.boltPts) {
    const bx = Math.round(p.x), by = Math.round(p.y);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const px = bx + dx, py = by + dy;
      if (px >= 0 && px < W && py >= 0 && py < H && cv.sil[py * W + px]) set(py * W + px, ramp(S.frame, 1.35));
    }
    if (bx - 1 >= 0 && by - 1 >= 0 && cv.sil[(by - 1) * W + bx - 1]) set((by - 1) * W + bx - 1, ramp(S.chrome, 0.8));
  }
  // 信号灯：亮芯 + 光晕
  for (const p of A.lightPts) {
    const bx = Math.round(p.x), by = Math.round(p.y);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const px = bx + dx, py = by + dy, d = Math.abs(dx) + Math.abs(dy);
      if (px < 0 || px >= W || py < 0 || py >= H || !cv.sil[py * W + px]) continue;
      if (d === 0) set(py * W + px, [255, 240, 200]);
      else if (d <= 2) set(py * W + px, ramp(S.glow, 1.25));
    }
  }
  // 盘缘侧壁：每件四周 3px 厚度带——上沿受光面、下沿侧壁、前壁转暗、后壁微暗
  for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
    const i = y * W + x, o = cv.owner[i];
    if (o < 0 || !cv.sil[i]) continue;
    const k = cv.insts[o].kind;
    if (k !== 'plate' && k !== 'guard' && k !== 'foot' && k !== 'disc') continue;
    const cur = get(i);
    if (cv.owner[i + 3 * W] !== o) set(i, ramp(cur, 0.68));       // 下侧壁（最强）
    else if (cv.owner[i - 3 * W] !== o) set(i, ramp(cur, 1.13));  // 上沿受光
    else if (cv.owner[i + 3] !== o) set(i, ramp(cur, 0.8));       // 前壁
    else if (cv.owner[i - 3] !== o) set(i, ramp(cur, 0.88));      // 后壁
  }
  // 斜面带：横向边界上亮唇 + 下暗唇两行；纵向边界前亮后暗（剪影最外圈由描边收尾）
  for (let y = 2; y < H - 2; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, o = cv.owner[i];
    if (o < 0 || !cv.sil[i]) continue;
    const cur = get(i);
    if (cv.owner[i - W] !== o) set(i, ramp(cur, 1.24));
    else if (cv.owner[i + W] !== o) set(i, ramp(cur, 0.6));
    else if (cv.owner[i + W] === o && cv.owner[i + 2 * W] !== o) set(i, ramp(cur, 0.84));
    else if (cv.owner[i + 1] !== o) set(i, ramp(cur, 1.12));
    else if (cv.owner[i - 1] !== o) set(i, ramp(cur, 0.8));
  }
  // 凹陷暗影：板压板处接缝下方落影（盖过棱线提亮）、第二行余影、关节盘窝影
  for (let y = 2; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, o = cv.owner[i];
    if (o < 0) continue;
    const kindOf = (n: number) => (n >= 0 ? cv.insts[n].kind : null);
    const up = cv.owner[i - W], up2 = cv.owner[i - 2 * W];
    const nearDisc = [up, cv.owner[i + W], cv.owner[i - 1], cv.owner[i + 1]].some((n) => kindOf(n) === 'disc') && cv.insts[o].kind !== 'disc';
    if (nearDisc) { set(i, ramp(get(i), 0.72)); continue; }
    const upKind = kindOf(up);
    if (up !== o && (upKind === 'plate' || upKind === 'guard' || upKind === 'foot')) set(i, ramp(get(i), 0.78));
    else if (up2 !== o && up === o && (kindOf(up2) === 'plate' || kindOf(up2) === 'guard')) set(i, ramp(get(i), 0.92));
  }
  // 做旧一：啃边（剪影边缘高频噪声咬成内框色）
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!cv.sil[i]) continue;
    const edge = !cv.sil[i - 1] || !cv.sil[i + 1] || !cv.sil[i - W] || !cv.sil[i + W];
    if (edge && vnoise(x / 3.1, y / 3.1, spec.seed + 5) > 0.78) set(i, hash2(x, y, spec.seed + 31) > 0.45 ? ramp(mix(S.frame, S.chrome, 0.55), 1.05) : ramp(S.frame, 1.15));
  }
  // 做旧二：划痕（种子短线，只落在板上）
  for (let k = 0; k < 12; k++) {
    let px = 40 + rnd() * (W - 80), py = 40 + rnd() * (H - 120);
    const ang = rnd() * Math.PI, len = 8 + rnd() * 22;
    for (let s = 0; s < len; s++) {
      const x = Math.round(px + Math.cos(ang) * s), y = Math.round(py + Math.sin(ang) * s * 0.4);
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const i = y * W + x, o = cv.owner[i];
      if (o >= 0 && (cv.insts[o].kind === 'plate' || cv.insts[o].kind === 'guard')) set(i, ramp(mix(get(i), S.chrome, 0.45), 1.02));
    }
  }
  // 做旧二点五：磨损斑（锈色斑块 + 暗斑，强度按配色 wear）
  {
    const wear = spec.wear ?? 0;
    if (wear > 0) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!cv.sil[i]) continue;
      const n = vnoise(x / 13, y / 13, spec.seed + 21);
      if (n > 0.665) { const b = 0.55 * wear * Math.min(1, (n - 0.665) * 4); if (b > 0.02) set(i, mix(get(i), [146, 86, 48], b)); }
      else if (n < 0.3) set(i, ramp(get(i), 1 - 0.16 * wear));
    }
  }
  // 定向磨损：凸缘掉漆（边界偏置）+ 螺栓下锈流挂 + 螺栓旁刮痕
  {
    const wear = spec.wear ?? 0;
    if (wear > 0.05) {
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x, o = cv.owner[i];
        if (o < 0) continue;
        const k = cv.insts[o].kind;
        if (k !== 'plate' && k !== 'guard' && k !== 'foot' && k !== 'disc') continue;
        const edge = cv.owner[i - 1] !== o || cv.owner[i + 1] !== o || cv.owner[i - W] !== o || cv.owner[i + W] !== o;
        if (edge && hash2(x, y, spec.seed + 31) < 0.17 * wear + 0.03) set(i, mix(get(i), S.chrome, 0.5)); // 凸缘亮掉漆
      }
      const rustAmt = Math.min(1, wear * 1.2);
      for (const b of A.boltPts) { // 流挂：自螺栓向下渐淡
        const L = 6 + Math.floor(hash2(Math.round(b.x), Math.round(b.y), spec.seed + 41) * 15);
        for (let dy = 1; dy <= L; dy++) {
          const x = Math.round(b.x + (hash2(Math.round(b.x), dy, spec.seed + 43) - 0.5) * 2), y = Math.round(b.y) + dy;
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const i = y * W + x, o = cv.owner[i];
          if (o < 0 || cv.insts[o].kind !== 'plate') continue;
          set(i, mix(get(i), [146, 86, 48], 0.38 * rustAmt * (1 - dy / L)));
        }
      }
      for (const b of A.boltPts) { // 刮痕：螺栓旁短亮线
        if (hash2(Math.round(b.x), Math.round(b.y), spec.seed + 53) > 0.45) continue;
        const len = 9 + Math.floor(hash2(Math.round(b.y), Math.round(b.x), spec.seed + 59) * 8);
        for (let t = 0; t < len; t++) {
          const x = Math.round(b.x + 6 + t), y = Math.round(b.y + 3 + t * 0.3);
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const i = y * W + x, o = cv.owner[i];
          if (o < 0 || cv.insts[o].kind !== 'plate') continue;
          set(i, mix(get(i), S.chrome, 0.3));
        }
      }
    }
  }
  // 做旧三：底部积尘（越靠下越暗 + 斑驳）
  for (let y = Math.floor(H * 0.72); y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!cv.sil[i] || cv.col[i * 4 + 3] === 0) continue;
    const t = (y / H - 0.72) / 0.28;
    const f = 1 - 0.16 * t * (0.6 + 0.4 * vnoise(x / 6, y / 6, spec.seed + 9));
    set(i, ramp(get(i), f));
  }
  // （接地阴影已移除：它不是机甲的一部分，属于展示层，不进生成管线——2026-11-06 用户裁定）
  // 描边
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!cv.sil[i]) continue;
    if (!cv.sil[i - 1] || !cv.sil[i + 1] || !cv.sil[i - W] || !cv.sil[i + W]) { const c = get(i); set(i, [c[0] * 0.3, c[1] * 0.3, c[2] * 0.32]); }
  }
  // 末端清扫：中途各 pass 按剪影迭代可能给无主像素上过色，统一清回透明（只清剪影内）
  for (let i = 0; i < W * H; i++) {
    if (cv.sil[i] && cv.owner[i] < 0) cv.col[i * 4 + 3] = 0;
  }
  return cv;
}
function shade2(c: RGB, f: number): RGB { return [c[0] * f, c[1] * f, c[2] * f]; }

// ---------- 输出 ----------
mkdirSync(new URL('./out', import.meta.url).pathname, { recursive: true });
const OUT = new URL('./out/', import.meta.url).pathname;
function saveLeg(name: string, spec: LegSpec) { writeFileSync(OUT + name + '.png', encodePNG(W, H, render(spec).col)); }
saveLeg('v29-leg-olive', { topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 22, camo: true, wear: 0.3, wScale: 1.1, lift: 20, detail: 0.65, ankleShift: 12, coreScale: 1.05 });
saveLeg('v29-leg-desert', { topology: 'standard', scheme: SCHEMES.desert, seed: 23, bend: 14, camo: true, wear: 0.35, lift: 7, detail: 0.9, ankleShift: 10 });
saveLeg('v29-leg-slate-reverse', { topology: 'reverse', scheme: SCHEMES.slate, seed: 37, bend: -12, camo: false, wear: 0.2, guardOff: true, lift: 5, ankleShift: 16, footType: 'claw' });
saveLeg('v29-leg-rust', { topology: 'standard', scheme: SCHEMES.rust, seed: 41, bend: 8, camo: false, wear: 1, wScale: 1.32, lift: 13, guardOff: true, detail: 0.8, ankleShift: 8, coreScale: 1.3 });
saveLeg('v29-leg-agile-shell', { topology: 'standard', scheme: SCHEMES.white, seed: 61, bend: 16, camo: false, wear: 0.05, shellMode: true, wScale: 0.86, lift: 9, guardOff: true, detail: 0.45, ankleShift: 12, decalKind: 'none', coreScale: 0.9, footType: 'shoe' });
saveLeg('v29-leg-scout-light', { topology: 'reverse', scheme: SCHEMES.slate, seed: 53, bend: -10, camo: false, wear: 0.25, frameHeavy: true, wScale: 0.7, lift: 22, guardOff: true, detail: 1.25, ankleShift: 14, cableTint: [70, 110, 220], decalKind: 'plate', coreScale: 0.85, footType: 'pad' });
// IR 落盘 + 回读探针：JSON 里的 IR 改一处（删护板、换配色），出图必须随之变
{
  const oliveSpec: LegSpec = { topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 22, camo: true, wear: 0.3, wScale: 1.1, lift: 20, detail: 0.65, ankleShift: 12, coreScale: 1.05 };
  writeFileSync(OUT + 'ir-olive.json', JSON.stringify(legIR(oliveSpec), null, 1));
  const irp = JSON.parse(JSON.stringify(legIR(oliveSpec))) as MechaIR;
  irp.parts = irp.parts.filter((q) => q.pattern !== 'guard');
  irp.scheme = 'desert';
  writeFileSync(OUT + 'ir-probe-noguard-desert.png', encodePNG(W, H, renderIR(irp).col));
}

{
  const a = render({ topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 0, camo: true, wear: 0.3 }).col;
  const b = render({ topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 26, camo: true, wear: 0.3 }).col;
  const w2 = W * 2 - 60, buf = new Uint8ClampedArray(w2 * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4;
    if (a[s + 3]) buf.set(a.subarray(s, s + 4), (y * w2 + x) * 4);
    if (b[s + 3] && x + W - 60 < w2) buf.set(b.subarray(s, s + 4), (y * w2 + x + W - 60) * 4);
  }
  writeFileSync(OUT + 'v29-pair-olive.png', encodePNG(w2, H, buf));
}
{
  // 阵列：远侧腿（压暗 + 去饱和 + 后移）垫后，近侧腿在前，两对相位交错
  const specA: LegSpec = { topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 0, camo: true, wear: 0.3 };
  const specB: LegSpec = { topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 24, camo: true, wear: 0.3 };
  const nearA = render(specA).col, nearB = render(specB).col;
  const farOf = (src: Uint8ClampedArray) => {
    const out = new Uint8ClampedArray(src);
    for (let i = 0; i < out.length; i += 4) {
      if (!out[i + 3]) continue;
      const r = out[i], g = out[i + 1], b = out[i + 2], L = (r + g + b) / 3;
      out[i] = (r + (L - r) * 0.35) * 0.5; out[i + 1] = (g + (L - g) * 0.35) * 0.5; out[i + 2] = (b + (L - b) * 0.35) * 0.54;
    }
    return out;
  };
  const wF = W * 2 + 40, hF = H + 18, buf = new Uint8ClampedArray(wF * hF * 4);
  const blit = (src: Uint8ClampedArray, dx: number, dy: number) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4;
      if (src[s + 3] && x + dx < wF && y + dy < hF) buf.set(src.subarray(s, s + 4), ((y + dy) * wF + x + dx) * 4);
    }
  };
  blit(farOf(nearB), 6, 0); blit(farOf(nearA), W + 12, 0);
  blit(nearA, 58, 16); blit(nearB, W + 64, 16);
  writeFileSync(OUT + 'v29-formation.png', encodePNG(wF, hF, buf));
}
console.log('done v29');


// ---------- 整机（完整管线）：躯干/头/臂布局（与腿同一实例流规则、同一 Anchors 数据锚） ----------
function srandF(s: number) { let a = (s * 2654435761) >>> 0; return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; }; }
function blockPolyT(cx: number, cy: number, w: number, h: number, ang: number, cham = 0.36, seed = 0): Pt[] {
  const ca = Math.cos(ang), sa = Math.sin(ang), lx = w / 2, ly = h / 2;
  const rnd = srandF(seed * 7919 + 13);
  const base = (Math.min(w, h) * cham) / 2;
  const c = [0, 1, 2, 3].map(() => Math.min(base * (0.3 + rnd() * 1.5), Math.min(w, h) * 0.46));
  const raw: Pt[] = [{ x: -lx + c[0], y: -ly }, { x: lx - c[1], y: -ly }, { x: lx, y: -ly + c[1] }, { x: lx, y: ly - c[2] }, { x: lx - c[2], y: ly }, { x: -lx + c[3], y: ly }, { x: -lx, y: ly - c[3] }, { x: -lx, y: -ly + c[0] }];
  if (rnd() < 0.45 && w > 34 && h > 26) {
    const d = 2 + rnd() * 3, y0 = -ly + c[1] + (h - c[1] - c[2]) * (0.25 + rnd() * 0.3), len = (h - c[1] - c[2]) * 0.3;
    const pts: Pt[] = [raw[0], raw[1], raw[2], { x: lx, y: y0 }, { x: lx - d, y: y0 }, { x: lx - d, y: y0 + len }, { x: lx, y: y0 + len }, raw[3], raw[4], raw[5], raw[6], raw[7]];
    return pts.map((q) => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
  }
  return raw.map((q) => ({ x: cx + q.x * ca - q.y * sa, y: cy + q.x * sa + q.y * ca }));
}
interface LayerTools { segPlate: (a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap?: number, kind?: Kind) => number; A: Anchors; addBlock: (kind: Kind, cx: number, cy: number, w: number, h: number, ang?: number, cham?: number, bolts?: boolean) => number; addDisc: (kind: Kind, c: Pt, r: number) => number; addPoly: (pts: Pt[], bolts?: boolean) => number; addRaw: (kind: Kind, test: (x: number, y: number) => [boolean, number, number]) => number; rod: (a: Pt, b: Pt, r: number) => number; grille: (cx: number, cy: number, w: number, h: number) => void; finish: () => void }
function makeLayerTools(cv: Canvas, seed: number): LayerTools {
  const rnd = mulberry32(seed);
  let id = 0;
  const A: Anchors = { plateTint: new Map(), panelLines: new Map(), boltPts: [], ventId: -1, guardId: -1, stripeId: -1, decalPos: { x: 0, y: 0 }, numPos: { x: 0, y: 0 }, numText: '', lightPts: [], discs: [], chevrons: [], seamU: new Map(), insignia: { pos: { x: 0, y: 0 }, kind: 0 }, stripeThigh: -1, blockPlates: new Set(), deviceFrame: null, chevDecal: true, shinIds: new Set(), stripeSegs: [], panelDiag: new Map(), panelTee: new Map(), decalKind: 'num', toeFace: null, colorRole: new Map() };
  const tints = [0.78, 0.9, 1.0, 1.1, 1.24];
  const reg = (myId: number) => {
    A.plateTint.set(myId, tints[Math.floor(rnd() * 5)]);
    const lines: number[] = []; const n = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) lines.push(0.3 + rnd() * 0.45);
    A.panelLines.set(myId, lines);
    A.seamU.set(myId, 0.15 + rnd() * 0.7);
    if (rnd() < 0.3) A.panelDiag.set(myId, (rnd() - 0.5) * 0.9);
    if (rnd() < 0.35) A.panelTee.set(myId, 0.1 + rnd() * 0.8);
  };
  const addBlock = (kind: Kind, cx: number, cy: number, w: number, h: number, ang = 0, cham = 0.36, bolts = false): number => {
    cv.insts.push({ kind }); const myId = id;
    const t = polyTest(blockPolyT(cx, cy, w, h, ang, cham, myId + 2000));
    fillShape(cv, id, t); id++;
    if (kind === 'plate') reg(myId);
    if (bolts) for (const [bx, by] of [[cx - w / 2 + 6, cy - h / 2 + 6], [cx + w / 2 - 6, cy - h / 2 + 6], [cx - w / 2 + 6, cy + h / 2 - 6], [cx + w / 2 - 6, cy + h / 2 - 6]] as const) A.boltPts.push({ x: bx, y: by });
    return myId;
  };
  const addDisc = (kind: Kind, c: Pt, r: number): number => { cv.insts.push({ kind }); const myId = id; fillShape(cv, id, discTest(c, r)); id++; A.discs.push({ id: myId, c, r, hv: 0.5 }); return myId; };
  const grille = (cx: number, cy: number, w: number, h: number) => { addBlock('plate', cx, cy, w, h, 0, 0.2); for (let k = 0; k < 3; k++) addBlock('frame', cx, cy - h / 2 + 6 + k * ((h - 8) / 2), w - 4, 4.5, 0, 0.1); };
  const segPlate = (a: Pt, b: Pt, wA: number, wB: number, t0: number, t1: number, gap = 2.5, kind: Kind = 'plate'): number => {
    const jit = (rnd() - 0.5) * 6, rot = (rnd() - 0.5) * 0.1, proud = 1.03 + rnd() * 0.09;
    const f0 = segFrame(a, b), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const rp = (p: Pt): Pt => { const dx = p.x - mx, dy = p.y - my; return { x: mx + dx * Math.cos(rot) - dy * Math.sin(rot) + f0.px * jit, y: my + dx * Math.sin(rot) + dy * Math.cos(rot) + f0.py * jit }; };
    const a2 = rp(a), b2 = rp(b), hw = (wA + wB) / 4;
    const cham = () => (rnd() < 0.3 ? rnd() * 5 : (0.2 + rnd() * 0.8) * hw * 0.9);
    const shape: PlateShape = { cTF: cham(), cTB: cham(), cBF: cham(), cBB: cham(), step: rnd() < 0.4 ? (rnd() - 0.5) * 14 : 0, stepPos: 0.3 + rnd() * 0.4 };
    if (kind === 'plate') { cv.insts.push({ kind: 'frame' }); fillShape(cv, id, plateTest(a2, b2, wA * proud * 1.05, wB * proud * 1.05, Math.max(0, t0 - 0.008), Math.min(1, t1 + 0.008), 0, 0, 0, { f: 0, b: 0 }, shape)); id++; }
    cv.insts.push({ kind }); const myId = id;
    fillShape(cv, id, plateTest(a2, b2, wA * proud, wB * proud, t0, t1, gap, 0, 0, { f: 0, b: 0 }, shape)); id++;
    reg(myId);
    return myId;
  };
  const addPoly = (pts: Pt[], bolts = false): number => { cv.insts.push({ kind: 'plate' }); const myId = id; fillShape(cv, id, polyTest(pts)); id++; reg(myId); if (bolts) { const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); const x0 = Math.min(...xs) + 6, x1 = Math.max(...xs) - 6, y0 = Math.min(...ys) + 6, y1 = Math.max(...ys) - 6; for (const [bx, by] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const) A.boltPts.push({ x: bx, y: by }); } return myId; };
  const addRaw = (kind: Kind, test: (x: number, y: number) => [boolean, number, number]): number => { cv.insts.push({ kind }); const myId = id; fillShape(cv, id, test); id++; return myId; };
  const rod = (a: Pt, b: Pt, r: number): number => addRaw('cyl', lineTest(a, b, r));
  const finish = () => { for (let i = 0; i < W * H; i++) if (cv.owner[i] >= 0) cv.sil[i] = 1; };
  return { A, addBlock, addDisc, addPoly, addRaw, rod, grille, finish, segPlate };
}
function layoutTorso(cv: Canvas, tspec: LegSpec): Anchors {
  const T = makeLayerTools(cv, 999); const { A, addBlock, addDisc, grille, finish } = T;
  // 远臂
  addBlock('frame', 190, 126, 30, 70, -0.08); addBlock('plate', 196, 124, 46, 48, -0.06);
  addDisc('disc', { x: 188, y: 160 }, 11);
  T.rod({ x: 174, y: 150 }, { x: 176, y: 198 }, 3); // 前臂外露液压杆（与腿同语言）
  addBlock('plate', 184, 196, 52, 50, 0.04); addBlock('plate', 184, 240, 32, 26, 0.04);
  addBlock('plate', 176, 257, 9, 14, 0.08); addBlock('plate', 186, 259, 9, 15, 0.03); addBlock('plate', 196, 257, 9, 13, -0.02); // 分段指
  addBlock('plate', 196, 88, 78, 54, -0.02); addBlock('plate', 194, 62, 66, 22, -0.02);
  // 躯干组（背部挂载先行：橄榄族火箭舱对，舱体 + 筒口，探出肩线与背后）
  addBlock('cyl', 110, 40, 64, 26, -0.45); addBlock('cyl', 116, 78, 58, 24, -0.35);
  addDisc('disc', { x: 82, y: 27 }, 7); addDisc('disc', { x: 78, y: 41 }, 7); addDisc('disc', { x: 90, y: 66 }, 7); addDisc('disc', { x: 86, y: 79 }, 7);
  addBlock('frame', 128, 84, 56, 84, 0.06);
  addBlock('frame', 112, 104, 64, 104, 0.02);
  const chestMain = addBlock('plate', 196, 128, 156, 96, 0, 0.36, true);
  addBlock('plate', 202, 80, 138, 44, 0);
  grille(128, 140, 40, 48);
  addBlock('frame', 198, 180, 128, 15, 0, 0.2);
  addDisc('disc', { x: 234, y: 180 }, 6);
  addBlock('plate', 228, 200, 96, 38, -0.01);
  addBlock('plate', 166, 200, 60, 28, 0.02);
  addBlock('plate', 192, 240, 138, 52, 0, 0.36, true);
  addBlock('plate', 244, 238, 62, 42, 0.02);
  { // 躯干粗管线缆（heavy 级变体，与腿线缆同机制：采样点距离场 + 金属接头）
    const p0 = { x: 148, y: 166 }, p1 = { x: 168, y: 208 }, p2 = { x: 218, y: 226 };
    const pts: Pt[] = [];
    for (let s = 0; s <= 22; s++) { const t = s / 22, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t; pts.push({ x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y }); }
    T.addRaw('cable', (x, y) => { let m = 1e9; for (const p of pts) m = Math.min(m, Math.hypot(x - p.x, y - p.y)); return [m <= 7, 0, m / 7]; });
    addDisc('cyl', p0, 9); addDisc('cyl', p2, 9);
  }
  addBlock('plate', 156, 272, 76, 36, 0.06);
  addBlock('plate', 242, 274, 58, 44, 0.1);
  // 头组（对账修订：头宽 42≈0.27 倍胸宽、沉入领圈无颈柱；耳盘代侧栅；额角为橄榄变体）
  addBlock('frame', 238, 68, 46, 14, 0);
  addBlock('plate', 242, 47, 42, 34, 0.02, 0.42);
  addBlock('plate', 232, 33, 28, 14, 0.02);
  addDisc('disc', { x: 224, y: 48 }, 8);
  addBlock('plate', 254, 38, 28, 9, 0.05);
  addBlock('frame', 254, 47, 26, 9, 0.02);
  addBlock('plate', 256, 57, 24, 12, 0.1);
  addBlock('cyl', 260, 66, 21, 9, 0.5);
  addBlock('plate', 265, 74, 16, 10, 0.2);
  addBlock('plate', 261, 29, 13, 6, 0.35);
  addBlock('cyl', 228, 17, 4, 18, 0.1, 0.2);
  // 近臂
  addDisc('disc', { x: 224, y: 92 }, 13);
  addBlock('frame', 220, 126, 30, 70, 0.1);
  addBlock('plate', 228, 118, 52, 48, 0.1);
  addBlock('plate', 232, 146, 48, 40, 0.08);
  addBlock('frame', 222, 166, 16, 20, 0.05);
  addDisc('disc', { x: 234, y: 166 }, 11);
  T.rod({ x: 214, y: 150 }, { x: 216, y: 200 }, 3.5); // 前臂双液压杆（与腿同语言）
  T.rod({ x: 250, y: 152 }, { x: 248, y: 198 }, 3);
  addBlock('plate', 228, 198, 52, 54, -0.04, 0.36, true);
  addBlock('frame', 240, 192, 30, 36, -0.03);
  addDisc('disc', { x: 226, y: 228 }, 8);
  addBlock('plate', 224, 240, 34, 26, 0.04);
  addBlock('plate', 214, 258, 10, 16, 0.1); addBlock('plate', 226, 260, 10, 17, 0.05); addBlock('plate', 238, 258, 10, 15, 0); // 分段指
  addBlock('plate', 244, 246, 12, 18, 0.5); // 拇指
  addBlock('plate', 230, 84, 90, 62, -0.03, 0.36, true);
  addBlock('plate', 228, 56, 78, 24, -0.03);
  addBlock('plate', 264, 94, 30, 44, 0.08);
  // 贴花锚：编号归胸主面板、眼与胸灯走信号灯 pass、徽记归胸板
  A.stripeThigh = chestMain; A.numPos = { x: 138, y: 104 }; A.numText = 'M-46';
  A.lightPts.push({ x: 258, y: 47 }, { x: 252, y: 100 });
  A.insignia = { pos: { x: 208, y: 120 }, kind: 1 };
  finish(); // 剪影 = 部件并集（与 layout 同口径）
  return A;
}
{
  const oliveSpec: LegSpec = { topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 22, camo: true, wear: 0.3, wScale: 1.1, lift: 20, detail: 0.65, ankleShift: 12, coreScale: 1.05 };
  const farSpec: LegSpec = { topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 0, camo: true, wear: 0.3 };
  const torsoSpec: LegSpec = { topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 0, camo: true, wear: 0.3, detail: 1 };
  const farCv = render(farSpec), nearCv = render(oliveSpec);
  const tCv = newCanvas(); const tA = layoutTorso(tCv, torsoSpec); finishRender(tCv, tA, torsoSpec);
  const W2 = 380, H2 = 730;
  const fin = new Uint8ClampedArray(W2 * H2 * 4);
  const blitCv = (src: Uint8ClampedArray, ox: number, oy: number, dark: number, desat: number) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4; if (!src[si + 3]) continue;
      const tx = x + ox, ty = y + oy; if (tx < 0 || ty < 0 || tx >= W2 || ty >= H2) continue;
      const di = (ty * W2 + tx) * 4; let r = src[si], g = src[si + 1], b = src[si + 2];
      const gray = (r + g + b) / 3; r = (r + (gray - r) * desat) * dark; g = (g + (gray - g) * desat) * dark; b = (b + (gray - b) * desat) * dark;
      fin[di] = r; fin[di + 1] = g; fin[di + 2] = b; fin[di + 3] = src[si + 3];
    }
  };
  blitCv(farCv.col, 40, 196, 0.7, 0.3);
  blitCv(nearCv.col, 0, 190, 1, 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // 躯干落影（用躯干画布的 sil）
    const sx = x - 10, sy = y - 14; if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    if (tCv.sil[sy * W + sx] && fin[(y * W2 + x) * 4 + 3]) { const di = (y * W2 + x) * 4; fin[di] *= 0.62; fin[di + 1] *= 0.62; fin[di + 2] *= 0.62; }
  }
  blitCv(tCv.col, 0, 0, 1, 0);
  writeFileSync(OUT + 'mecha-full-v2.png', encodePNG(W2, H2, fin));
  console.log('full v2 done');
}

// ---------- 载具型（完整管线）：车体组布局（对账③④：英雄挂载放大、侧面模块阵列、标记系统） ----------
function layoutHull(cv: Canvas): Anchors {
  const T = makeLayerTools(cv, 1234);
  const { A, addBlock, addDisc, grille, finish } = T;
  // 主积：楔箱（前低后高、平底）
  const hull = T.addPoly([{ x: 62, y: 118 }, { x: 205, y: 108 }, { x: 308, y: 200 }, { x: 294, y: 240 }, { x: 72, y: 240 }], true);
  addBlock('plate', 168, 102, 196, 24, 0, 0.3); // 顶甲板
  addBlock('plate', 84, 96, 54, 22, 0.03); // 后甲板件
  grille(76, 165, 26, 58); // 后侧散热栅
  // 侧面模块阵列：双舱门 + 侧舱
  const bayA = addBlock('plate', 122, 184, 84, 46, 0, 0.3, true);
  addBlock('plate', 220, 188, 88, 42, 0, 0.3, true);
  addBlock('plate', 282, 192, 42, 36, 0, 0.3);
  addBlock('frame', 180, 244, 252, 13, 0, 0.15); // 底裙带
  // 英雄挂载：大炮塔 + 主炮（占顶面大半）
  addBlock('plate', 150, 78, 94, 34, 0, 0.3, true); // 塔座
  addBlock('plate', 148, 50, 78, 30, -0.02); // 塔体
  addBlock('plate', 138, 32, 46, 14, 0); // 塔顶盖
  addDisc('disc', { x: 178, y: 34 }, 9); // 传感器球
  addBlock('frame', 198, 42, 16, 12, 0); // 潜望件
  addBlock('cyl', 116, 14, 4, 26, 0.08, 0.2); // 天线
  addBlock('plate', 198, 50, 30, 26, -0.05); // 炮盾
  T.addRaw('cyl', lineTest({ x: 210, y: 50 }, { x: 350, y: 42 }, 7)); // 主炮筒
  T.addRaw('cyl', lineTest({ x: 298, y: 44 }, { x: 354, y: 41 }, 9.5)); // 炮口制退节
  // 标记系统：编号归侧舱门 A、徽记归舱门 B 区、车灯走信号灯 pass
  A.stripeThigh = bayA; A.numPos = { x: 92, y: 170 }; A.numText = 'N-37';
  A.insignia = { pos: { x: 222, y: 178 }, kind: 0 };
  A.lightPts.push({ x: 294, y: 224 }, { x: 68, y: 128 });
  finish();
  return A;
}
{
  const oliveSpec: LegSpec = { topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 22, camo: true, wear: 0.3, wScale: 1.1, lift: 20, detail: 0.65, ankleShift: 12, coreScale: 1.05 };
  const farSpec: LegSpec = { topology: 'standard', scheme: SCHEMES.olive, seed: 11, bend: 0, camo: true, wear: 0.3 };
  const hullSpec: LegSpec = { topology: 'standard', scheme: SCHEMES.olive, seed: 23, bend: 0, camo: true, wear: 0.35, detail: 1 };
  const farCv = render(farSpec), nearCv = render(oliveSpec);
  const hCv = newCanvas(); const hA = layoutHull(hCv); finishRender(hCv, hA, hullSpec);
  const W2 = 380, H2 = 730;
  const fin = new Uint8ClampedArray(W2 * H2 * 4);
  const blitCv = (src: Uint8ClampedArray, ox: number, oy: number, dark: number, desat: number) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4; if (!src[si + 3]) continue;
      const tx = x + ox, ty = y + oy; if (tx < 0 || ty < 0 || tx >= W2 || ty >= H2) continue;
      const di = (ty * W2 + tx) * 4; let r = src[si], g = src[si + 1], b = src[si + 2];
      const gray = (r + g + b) / 3; r = (r + (gray - r) * desat) * dark; g = (g + (gray - g) * desat) * dark; b = (b + (gray - b) * desat) * dark;
      fin[di] = r; fin[di + 1] = g; fin[di + 2] = b; fin[di + 3] = src[si + 3];
    }
  };
  blitCv(farCv.col, 40, 196, 0.7, 0.3);
  blitCv(nearCv.col, 0, 190, 1, 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x - 10, sy = y - 14; if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    if (hCv.sil[sy * W + sx] && fin[(y * W2 + x) * 4 + 3]) { const di = (y * W2 + x) * 4; fin[di] *= 0.62; fin[di + 1] *= 0.62; fin[di + 2] *= 0.62; }
  }
  blitCv(hCv.col, 0, 0, 1, 0);
  writeFileSync(OUT + 'walker-full-v1.png', encodePNG(W2, H2, fin));
  console.log('walker full v1 done');
}

// ---------- armIR：规格 → 锚点 → 部件列（数据） → 通用解释渲染 ----------
type ArmFrame = 'upper' | 'fore' | 'shoulder' | 'wrist';
type ArmPart =
  | { t: 'segCore'; seg: 'upper' | 'fore'; w0: number; w1: number; s0: number; s1: number }
  | { t: 'segPlate'; seg: 'upper' | 'fore'; w0: number; w1: number; s0: number; s1: number; role?: 'stripe' | 'armor2' | 'accent' }
  | { t: 'disc'; at: 'shoulder' | 'elbow' | 'wrist'; r: number }
  | { t: 'discAt'; frame: ArmFrame; along: number; perp: number; r: number }
  | { t: 'block'; frame: ArmFrame; along: number; perp: number; w: number; h: number; angOff?: number; kind?: Kind; cham?: number; bolts?: boolean }
  | { t: 'rod'; seg: 'upper' | 'fore'; perp: number; s0: number; s1: number; r: number }
  | { t: 'rodLink'; fromSeg: 'upper' | 'fore'; fromS: number; fromPerp: number; toSeg: 'upper' | 'fore'; toS: number; toPerp: number; r: number }
  | { t: 'cable'; seg: 'upper' | 'fore'; perp: number; sag: number; r: number }
  | { t: 'insignia'; frame: ArmFrame; along: number; perp: number; kind: number }
  | { t: 'light'; frame: ArmFrame; along: number; perp: number };
interface ArmSpec {
  family: string; scheme: Scheme; seed: number; wear: number; camo: boolean;
  root: Pt; upperLen: number; foreLen: number; upperAng: number; elbowBend: number;
  bulk: number; shell: number; hand: 'fist' | 'claw';
  form: { shell: 'box' | 'cap'; elbow: 'disc' | 'ring' | 'small'; fore: 'plates' | 'housing' | 'shell'; fingerLen: number; fingerCurl: number };
  gear: { cable: boolean; piston: boolean; device: boolean; stripe: boolean };
}
interface ArmIR { anchors: Record<'shoulder' | 'elbow' | 'wrist' | 'palm', Pt>; parts: ArmPart[] }
function armIR(spec: ArmSpec): ArmIR {
  const dir = (a: number): Pt => ({ x: Math.sin(a), y: Math.cos(a) });
  const shoulder = spec.root;
  const du = dir(spec.upperAng), df = dir(spec.upperAng + spec.elbowBend);
  const elbow = { x: shoulder.x + du.x * spec.upperLen, y: shoulder.y + du.y * spec.upperLen };
  const wrist = { x: elbow.x + df.x * spec.foreLen, y: elbow.y + df.y * spec.foreLen };
  const palm = { x: wrist.x + df.x * 18, y: wrist.y + df.y * 18 };
  const b = spec.bulk, parts: ArmPart[] = [];
  const plates = (seg: 'upper' | 'fore', len: number, w0: number, w1: number) => {
    const n = Math.max(2, Math.round(len / 68));
    for (let k = 0; k < n; k++) parts.push({ t: 'segPlate', seg, w0: w0 + (w1 - w0) * (k / n), w1: w0 + (w1 - w0) * ((k + 1) / n), s0: 0.04 + (0.93 * k) / n, s1: 0.04 + (0.93 * (k + 1)) / n, role: seg === 'fore' && k === 0 && spec.gear.stripe ? 'stripe' : (spec.family === 'powersuit' && seg === 'fore' && k % 2 === 1 ? 'armor2' : undefined) });
  };
  for (const [seg, w0, w1] of [['upper', 30, 26], ['fore', 26, 20]] as const)
    for (let k = 0; k < 3; k++) parts.push({ t: 'segCore', seg, w0: (w0 + (w1 - w0) * (k / 3)) * b, w1: (w0 + (w1 - w0) * ((k + 1) / 3)) * b, s0: k / 3 + 0.01, s1: (k + 1) / 3 - 0.01 });
  parts.push({ t: 'block', frame: 'shoulder', along: -4, perp: 2, w: 44 * b, h: 36 * b, angOff: 0.15, kind: 'frame' });
  parts.push({ t: 'block', frame: 'shoulder', along: 2, perp: 27 * b, w: 14 * b, h: 22 * b, kind: 'frame' }, { t: 'block', frame: 'shoulder', along: 2, perp: -27 * b, w: 14 * b, h: 22 * b, kind: 'frame' });
  parts.push({ t: 'disc', at: 'shoulder', r: 15 * b }, { t: 'disc', at: 'shoulder', r: 8.5 * b });
  plates('upper', spec.upperLen, 56 * b, 50 * b);
  if (spec.gear.cable) parts.push({ t: 'cable', seg: 'upper', perp: 29 * b, sag: 7, r: 4.5 });
  if (spec.gear.piston) { parts.push({ t: 'rodLink', fromSeg: 'upper', fromS: 0.8, fromPerp: 30 * b, toSeg: 'fore', toS: 0.2, toPerp: 28 * b, r: 5 }); parts.push({ t: 'rodLink', fromSeg: 'upper', fromS: 0.88, fromPerp: 30 * b, toSeg: 'fore', toS: 0.3, toPerp: 28 * b, r: 2.8 }); }
  if (spec.gear.cable) parts.push({ t: 'cable', seg: 'fore', perp: -27 * b, sag: 4, r: 2.5 });
  if (spec.form.elbow === 'ring') { parts.push({ t: 'block', frame: 'fore', along: 0, perp: 0, w: 23 * b, h: 23 * b, kind: 'frame' }); parts.push({ t: 'disc', at: 'elbow', r: 12.5 * b }); parts.push({ t: 'disc', at: 'elbow', r: 7 * b }); }
  else if (spec.form.elbow === 'small') parts.push({ t: 'disc', at: 'elbow', r: 8.5 * b });
  else parts.push({ t: 'disc', at: 'elbow', r: 12.5 * b }, { t: 'disc', at: 'elbow', r: 7 * b });
  parts.push({ t: 'block', frame: 'fore', along: 0, perp: 19 * b, w: 15 * b, h: 24 * b, kind: 'frame' }, { t: 'block', frame: 'fore', along: 0, perp: -19 * b, w: 15 * b, h: 24 * b, kind: 'frame' });
  if (spec.gear.piston) parts.push({ t: 'rod', seg: 'fore', perp: 30 * b, s0: 0.03, s1: 0.45, r: 5 });
  if (spec.form.fore === 'housing') {
    parts.push({ t: 'segPlate', seg: 'fore', w0: 56 * b, w1: 46 * b, s0: 0.03, s1: 0.97, role: spec.gear.stripe ? 'stripe' : undefined });
    parts.push({ t: 'block', frame: 'fore', along: spec.foreLen * 0.3, perp: -27 * b, w: 44 * b, h: 13, kind: 'frame' }); // 顶部导轨座
  } else plates('fore', spec.foreLen, 58 * b, 43 * b);
  if (spec.gear.piston) parts.push({ t: 'rod', seg: 'fore', perp: 30 * b, s0: 0.4, s1: 0.9, r: 2.8 });
  if (spec.gear.device) { parts.push({ t: 'block', frame: 'fore', along: spec.foreLen * 0.45, perp: -26 * b, w: 20, h: 26, kind: 'frame' }); parts.push({ t: 'block', frame: 'fore', along: spec.foreLen * 0.45, perp: -27 * b, w: 13, h: 18, kind: 'plate' }); parts.push({ t: 'light', frame: 'fore', along: spec.foreLen * 0.45, perp: -30 * b }); }
  parts.push({ t: 'disc', at: 'wrist', r: 8.5 * b }, { t: 'disc', at: 'wrist', r: 4.5 * b });
  parts.push({ t: 'block', frame: 'wrist', along: 16, perp: 0, w: 36 * b, h: 26 * b, kind: 'plate', bolts: true });
  parts.push({ t: 'block', frame: 'wrist', along: 13, perp: 3, w: 24 * b, h: 17 * b, kind: 'plate' }); // 掌背板
  if (spec.hand === 'fist') {
    // 指链（按 cyber/agile 参考抽取：四指位侧面取三列、每指三段渐细、关节盘、逐节累进卷曲；拇指自掌前下角出、两段前指）
    const fr = segFrame(elbow, wrist), foreAng = Math.atan2(fr.uy, fr.ux);
    const fw = 7 + 3.5 * b, L = spec.form.fingerLen, curl = spec.form.fingerCurl;
    const toFrame = (c: Pt) => ({ along: (c.x - wrist.x) * fr.ux + (c.y - wrist.y) * fr.uy, perp: (c.x - wrist.x) * fr.px + (c.y - wrist.y) * fr.py });
    parts.push({ t: 'block', frame: 'wrist', along: 29, perp: 0, w: 31 * b, h: 7, kind: 'frame' }); // 指节梁
    for (let idx = 0; idx < 3; idx++) {
      let pos = { x: wrist.x + fr.ux * 30 + fr.px * (idx - 1) * 11.5, y: wrist.y + fr.uy * 30 + fr.py * (idx - 1) * 11.5 };
      const fan = (idx - 1) * 0.04;
      for (let k = 0; k < 3; k++) {
        const lk = L * [0.42, 0.33, 0.25][k], wk = fw * [1, 0.84, 0.68][k];
        const a = foreAng + fan - curl * k;
        const cen = { x: pos.x + Math.cos(a) * (lk / 2), y: pos.y + Math.sin(a) * (lk / 2) };
        const cf = toFrame(cen), pf = toFrame(pos);
        parts.push({ t: 'discAt', frame: 'wrist', along: pf.along, perp: pf.perp, r: wk * 0.42 });
        parts.push({ t: 'block', frame: 'wrist', along: cf.along, perp: cf.perp, w: wk, h: lk, angOff: a - foreAng, kind: 'plate', cham: 0.3 });
        pos = { x: pos.x + Math.cos(a) * lk, y: pos.y + Math.sin(a) * lk };
      }
    }
    { // 拇指：基点在掌前下角，两段前指
      let pos = { x: wrist.x + fr.ux * 25 + fr.px * -19, y: wrist.y + fr.uy * 25 + fr.py * -19 };
      for (let k = 0; k < 2; k++) {
        const lk = [13, 11][k] * (0.7 + 0.3 * b), wk = [10, 8.5][k] * (0.7 + 0.3 * b);
        const a = foreAng - 0.85 - 0.3 * k;
        const cen = { x: pos.x + Math.cos(a) * (lk / 2), y: pos.y + Math.sin(a) * (lk / 2) };
        const cf = toFrame(cen), pf = toFrame(pos);
        parts.push({ t: 'discAt', frame: 'wrist', along: pf.along, perp: pf.perp, r: wk * 0.42 });
        parts.push({ t: 'block', frame: 'wrist', along: cf.along, perp: cf.perp, w: wk, h: lk, angOff: a - foreAng, kind: 'plate', cham: 0.3 });
        pos = { x: pos.x + Math.cos(a) * lk, y: pos.y + Math.sin(a) * lk };
      }
    }
  }
  else { parts.push({ t: 'block', frame: 'wrist', along: 34, perp: -12, w: 10, h: 22, angOff: 0.3, kind: 'plate' }); parts.push({ t: 'block', frame: 'wrist', along: 34, perp: 12, w: 10, h: 22, angOff: -0.3, kind: 'plate' }); }
  const sh = spec.shell;
  if (spec.form.shell === 'cap') {
    parts.push({ t: 'block', frame: 'shoulder', along: -6, perp: 0, w: 76 * sh, h: 52 * sh, angOff: -0.04, kind: 'plate', cham: 0.62, bolts: true });
    parts.push({ t: 'block', frame: 'shoulder', along: -30, perp: 0, w: 58 * sh, h: 18 * sh, angOff: -0.03, kind: 'plate', cham: 0.5 });
  } else {
    parts.push({ t: 'block', frame: 'shoulder', along: -8, perp: 0, w: 104 * sh, h: 62 * sh, angOff: -0.05, kind: 'plate', bolts: true });
    parts.push({ t: 'block', frame: 'shoulder', along: -36, perp: 0, w: 84 * sh, h: 22 * sh, angOff: -0.03, kind: 'plate' });
    parts.push({ t: 'block', frame: 'shoulder', along: 6, perp: -42 * sh, w: 28 * sh, h: 44 * sh, angOff: 0.12, kind: 'plate' });
  }
  parts.push({ t: 'insignia', frame: 'shoulder', along: -10, perp: -4, kind: 0 });
  return { anchors: { shoulder, elbow, wrist, palm }, parts };
}
function renderArmIR(cv: Canvas, ir: ArmIR, spec: ArmSpec): Anchors {
  const T = makeLayerTools(cv, spec.seed);
  const { A } = T;
  const A0 = ir.anchors;
  const segOf = (seg: 'upper' | 'fore') => seg === 'upper' ? { a: A0.shoulder, b: A0.elbow } : { a: A0.elbow, b: A0.wrist };
  const frameOf = (f: ArmFrame) => f === 'upper' || f === 'shoulder' ? { o: A0.shoulder, a: A0.shoulder, b: A0.elbow } : { o: A0.wrist, a: A0.elbow, b: A0.wrist };
  const fp = (f: ArmFrame, along: number, perp: number): Pt => { const { o, a, b } = frameOf(f); const fr = segFrame(a, b); return { x: o.x + fr.ux * along + fr.px * perp, y: o.y + fr.uy * along + fr.py * perp }; };
  const fang = (f: ArmFrame) => { const { a, b } = frameOf(f); const fr = segFrame(a, b); return Math.atan2(fr.uy, fr.ux) - Math.PI / 2; };
  for (const p of ir.parts) {
    if (p.t === 'segCore') { const { a, b } = segOf(p.seg); T.segPlate(a, b, p.w0, p.w1, p.s0, p.s1, 0, 'frame'); }
    else if (p.t === 'segPlate') { const { a, b } = segOf(p.seg); const id = T.segPlate(a, b, p.w0, p.w1, p.s0, p.s1); if (p.role === 'stripe') A.stripeThigh = id; else if (p.role) (A.colorRole ??= new Map()).set(id, p.role); }
    else if (p.t === 'disc') T.addDisc('disc', A0[p.at], p.r);
    else if (p.t === 'discAt') { const c = fp(p.frame, p.along, p.perp); T.addDisc('disc', c, p.r); }
    else if (p.t === 'block') { const c = fp(p.frame, p.along, p.perp); T.addBlock(p.kind ?? 'plate', c.x, c.y, p.w, p.h, fang(p.frame) + (p.angOff ?? 0), p.cham ?? 0.36, p.bolts ?? false); }
    else if (p.t === 'rod') { const { a, b } = segOf(p.seg); const fr = segFrame(a, b); const q = (s: number): Pt => ({ x: a.x + fr.ux * fr.len * s + fr.px * p.perp, y: a.y + fr.uy * fr.len * s + fr.py * p.perp }); T.addRaw('rod', lineTest(q(p.s0), q(p.s1), p.r)); }
    else if (p.t === 'rodLink') {
      const q = (seg: 'upper' | 'fore', s: number, perp: number): Pt => { const { a, b } = segOf(seg); const fr = segFrame(a, b); return { x: a.x + fr.ux * fr.len * s + fr.px * perp, y: a.y + fr.uy * fr.len * s + fr.py * perp }; };
      T.addRaw('rod', lineTest(q(p.fromSeg, p.fromS, p.fromPerp), q(p.toSeg, p.toS, p.toPerp), p.r));
    }
    else if (p.t === 'cable') {
      const { a, b } = segOf(p.seg); const fr = segFrame(a, b);
      const q = (s: number, d: number): Pt => ({ x: a.x + fr.ux * fr.len * s + fr.px * d, y: a.y + fr.uy * fr.len * s + fr.py * d });
      const p0 = q(0.02, p.perp), p2 = q(0.98, p.perp), p1 = q(0.5, p.perp + p.sag);
      const pts: Pt[] = [];
      for (let k = 0; k <= 40; k++) { const t = k / 40, u = 1 - t; pts.push({ x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y }); }
      T.addRaw('cable', (x, y) => { let m = 1e9; for (const q2 of pts) m = Math.min(m, Math.hypot(x - q2.x, y - q2.y)); return [m <= p.r, 0, m / p.r]; });
      T.addDisc('cyl', p0, p.r + 1); T.addDisc('cyl', p2, p.r + 1);
    }
    else if (p.t === 'insignia') A.insignia = { pos: fp(p.frame, p.along, p.perp), kind: p.kind };
    else if (p.t === 'light') A.lightPts.push(fp(p.frame, p.along, p.perp));
  }
  T.finish();
  return A;
}
{
  const psScheme: Scheme = { armor: [233, 231, 224], armor2: [219, 126, 46], frame: [72, 72, 76], metal: [120, 122, 126], accent: [233, 122, 40], chrome: [200, 202, 206], glow: [255, 205, 120], decal: [40, 40, 44] };
  const base = { wear: 0.3, camo: true, root: { x: 185, y: 66 } };
  const specs: ArmSpec[] = [
    { ...base, scheme: SCHEMES.olive, family: 'olive', seed: 7, bulk: 1.02, shell: 1.05, hand: 'fist', upperLen: 118, foreLen: 148, upperAng: 0.14, elbowBend: 0.1, gear: { cable: true, piston: true, device: true, stripe: true }, form: { shell: 'box', elbow: 'disc', fore: 'housing', fingerLen: 27, fingerCurl: 0.5 } },
    { ...base, scheme: SCHEMES.white, family: 'agile', seed: 21, bulk: 0.72, shell: 0.8, hand: 'fist', upperLen: 148, foreLen: 142, upperAng: 0.08, elbowBend: 0.16, gear: { cable: true, piston: false, device: true, stripe: false }, form: { shell: 'cap', elbow: 'ring', fore: 'plates', fingerLen: 37, fingerCurl: 0.13 } },
    { ...base, scheme: psScheme, family: 'powersuit', seed: 35, bulk: 0.86, shell: 0.9, hand: 'fist', upperLen: 126, foreLen: 118, upperAng: 0.2, elbowBend: 0.07, gear: { cable: false, piston: false, device: false, stripe: true }, form: { shell: 'cap', elbow: 'small', fore: 'shell', fingerLen: 29, fingerCurl: 0.38 } },
  ];
  for (const sp of specs) {
    const ir = armIR(sp);
    const cv = newCanvas(); const rA = renderArmIR(cv, ir, sp); finishRender(cv, rA, { topology: 'standard', scheme: sp.scheme, seed: sp.seed, bend: 0, camo: sp.camo, wear: sp.wear, detail: 1 });
    writeFileSync(OUT + `armir-${sp.family}.png`, encodePNG(W, H, cv.col));
    const js = JSON.stringify(ir, null, 1);
    writeFileSync(OUT + `armir-${sp.family}.json`, js);
    console.log(`armIR ${sp.family}: parts ${ir.parts.length}, insts ${cv.insts.length}, irLines ${js.split('\n').length}`);
  }
}
