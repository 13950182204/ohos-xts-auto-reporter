"""给 README 截图加编号圆点 + 箭头 + 按钮高亮框。

坐标不要靠眼睛量：先用 docs/tools/measure_shot_boxes.mjs 在渲染页里拿真实元素
getBoundingClientRect()（CSS px），乘以 deviceScaleFactor=2 换成截图像素，再裁剪标注。
箭头端点：tip_canvas_x = local_x + PAD - 14；local_x 是控件左缘相对裁剪框的像素。
"""

from PIL import Image, ImageDraw, ImageFont
import math, os

FONT_R = '/mnt/c/Windows/Fonts/msyh.ttc'
FONT_B = '/mnt/c/Windows/Fonts/msyhbd.ttc'
ACCENT = (65, 118, 230)
WHITE = (255, 255, 255)
BG = (21, 21, 23)
PAD = 200

def font(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT_R, size)

def arrow(d, p0, p1, width=6):
    d.line([p0, p1], fill=ACCENT, width=width)
    ang = math.atan2(p1[1]-p0[1], p1[0]-p0[0]); L, sp = 30, 14
    a = (p1[0]-L*math.cos(ang)+sp*math.sin(ang), p1[1]-L*math.sin(ang)-sp*math.cos(ang))
    b = (p1[0]-L*math.cos(ang)-sp*math.sin(ang), p1[1]-L*math.sin(ang)+sp*math.cos(ang))
    d.polygon([p1, a, b], fill=ACCENT)

def annotate(src, out, crop, targets, highlight=None, radius=34):
    img = Image.open(src).convert('RGB')
    if crop:
        img = img.crop(crop)
    w, h = img.size
    canvas = Image.new('RGB', (w + PAD, h), BG)
    canvas.paste(img, (PAD, 0))
    d = ImageDraw.Draw(canvas)
    if highlight:
        x0, y0, x1, y1 = highlight
        d.rounded_rectangle([PAD+x0, y0, PAD+x1, y1], radius=14, outline=ACCENT, width=5)
    for num, y, x in targets:
        cx = 82
        arrow(d, (cx+radius+12, y), (x+PAD-14, y))
        d.ellipse([cx-radius-8, y-radius-8, cx+radius+8, y+radius+8], fill=BG)
        d.ellipse([cx-radius, y-radius, cx+radius, y+radius], fill=ACCENT, outline=WHITE, width=3)
        f = font(36, True); tw = d.textlength(num, font=f)
        d.text((cx-tw/2, y-24), num, font=f, fill=WHITE)
    canvas.save(out)
    print('wrote', out, canvas.size)

BASE = '/tmp/xts-preview'
OUT = '/home/cx/os/ohos-xts-auto-reporter/docs/images'
os.makedirs(OUT, exist_ok=True)

annotate(f'{BASE}/dark-derived.png', f'{OUT}/01-device-dir.png',
         (60, 300, 1600, 780),
         [('1', 137, 68), ('2', 208, 60), ('3', 400, 68)],
         highlight=(66, 366, 236, 438))

annotate(f'{BASE}/dark-mirror-running.png', f'{OUT}/02-preflight-and-upload.png',
         (60, 880, 1600, 1760),
         [('1', 508, 58), ('2', 620, 58)])

annotate(f'{BASE}/dark-drafts.png', f'{OUT}/03-drafts.png',
         (60, 760, 1600, 1200),
         [('1', 60, 40), ('2', 110, 40), ('3', 380, 40)])

annotate('/tmp/phase2-probe/artifacts/31-round-1.png', f'{OUT}/04-platform-steps.png',
         None,
         [('1', 330, 700), ('2', 640, 250)])

annotate(f'{BASE}/dark-drafts.png', f'{OUT}/05-waiver-scan.png',
         (60, 1800, 1600, 2720),
         [('1', 430, 40), ('2', 600, 40)])

annotate(f'{BASE}/dark-mirror-failed.png', f'{OUT}/06-errors.png',
         (60, 880, 1600, 1650),
         [('1', 508, 58)])
