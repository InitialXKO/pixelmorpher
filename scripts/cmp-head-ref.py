#!/usr/bin/env python3
"""同尺并排合成（cmp-head-ref.mts 的第二段）：读参考图、实测参考核高、
按核高同尺缩放产品头、穹顶对齐并排。参考核高实测规则与产品侧同族：
穹顶 = 头框内 x 40%..80%、y 上半区最上亮像素；颏底 = x 40%..90%、
y 下半区最下亮像素（y 窗上限取头框底 - 5px，避开框下胸顶）。"""
import json, sys
from PIL import Image, ImageDraw, ImageFont

ref_path, ref_crop, out = sys.argv[1], sys.argv[2], sys.argv[3]
x0, y0, x1, y1 = map(int, ref_crop.split(','))
prod = json.load(open('/tmp/cmp-prod.json'))
pw, ph = prod['w'], prod['h']
rgba = open('/tmp/cmp-prod.rgba', 'rb').read()
pim = Image.frombytes('RGBA', (pw, ph), rgba)

ref = Image.open(ref_path).convert('RGB')
crop = ref.crop((x0, y0, x1, y1))
px = crop.load(); cw, ch = crop.size
def bright(x, y):
    r, g, b = px[x, y]
    return r + g + b > 150
apex = min(y for x in range(int(cw * 0.4), int(cw * 0.8)) for y in range(0, ch // 2) if bright(x, y))
# 颏底 = 从穹顶向下第一个暗断带（颈部间隙）之前的最后一亮行——
# 不能取窗内最下亮像素，那会把框下胸顶当成颏（实测：敏捷头在
# 颏下有一道暗颈带，亮数从 23 跌到 1 再回升到胸）
x_lo, x_hi = int(cw * 0.4), int(cw * 0.9)
counts = [sum(1 for x in range(x_lo, x_hi) if bright(x, y)) for y in range(ch)]
thr = max(2, int((x_hi - x_lo) * 0.05))
chin = ch - 1
# 先等到头体实心段（行亮数 ≥ 窗宽 25%，穹顶尖帽的 4-6 像素窄行不算），
# 再找暗断带——否则尖帽行的抖动会被当成颈带
solid = max(thr * 5, int((x_hi - x_lo) * 0.25))
body = next((y for y in range(apex, ch) if counts[y] >= solid), apex)
for y in range(body, ch - 3):
    if counts[y] < thr and counts[y + 1] < thr and counts[y + 2] < thr:
        chin = y - 1
        break
ref_core = chin - apex
scale = ref_core / prod['core']
print(f"参考：头框 {cw}x{ch} 穹顶 y={apex} 颏底 y={chin} 核高 {ref_core}px；同尺倍率 {scale:.3f}")
print(f"尺度锚：穹顶→颏同高（参考 {ref_core}px = 产品 {prod['core']}px x {scale:.3f}）；鳍尖在头框外、不参与对尺")

pw2, ph2 = round(pw * scale), round(ph * scale)
pim2 = pim.resize((pw2, ph2), Image.NEAREST)
# 产品贴天蓝底（与平时渲染同底色），参考保持原底
bg_p = Image.new('RGBA', (pw2, ph2), (70, 140, 220, 255))
bg_p.alpha_composite(pim2)
prod_img = bg_p.convert('RGB')

label_h = 28
W = pw2 + cw + 24
# 穹顶对齐：两边穹顶落在同一行；画布顶部留足各自穹顶之上的部分（鳍尖）
apex_line = label_h + max(round(prod['apexY'] * scale), apex)
prod_top = apex_line - round(prod['apexY'] * scale)
ref_top = apex_line - apex
H = max(prod_top + ph2, ref_top + ch) + 8
cb = Image.new('RGB', (W, H), (40, 40, 40))
d = ImageDraw.Draw(cb)
try:
    font = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc', 16)
except Exception:
    font = ImageFont.load_default()
cb.paste(prod_img, (0, prod_top))
cb.paste(crop, (pw2 + 24, ref_top))
d.text((8, 6), "产品（同尺）", fill=(255, 255, 255), font=font)
d.text((pw2 + 32, 6), "参考 mecha-agile-side（同尺）", fill=(255, 255, 255), font=font)
cb.save(out)
print("出图", out, cb.size)
