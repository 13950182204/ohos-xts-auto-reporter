"""校验 README 截图的箭头确实指到了控件上。

标注坐标一旦算错，箭头就会指到空白处——这种错误在缩略图里很难看出来。
这里对每条箭头末端右侧取样，要求采样框里"非背景"像素占比超过阈值，
否则判定指向空白并退出码 1。

数据来源与 annotate_shots.py 一致：
- 预览图：docs/tools/measure_shot_boxes.mjs 输出的 CSS px（×2 = 截图像素）
- 平台图：像素检测出的红色必填框（镜像文件 y 463-494 / x 331-820）

用法：python3 docs/tools/verify_shots.py <preview_dir> <platform_png>
默认 preview_dir=/tmp/xts-preview、platform_png=/tmp/phase2-probe/artifacts/31-round-1.png
"""

import json
import sys
from pathlib import Path

from PIL import Image

BG = (21, 21, 23)
THRESHOLD = 0.02
PREVIEW = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/xts-preview')
PLATFORM = Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/phase2-probe/artifacts/31-round-1.png')
MEASURE = PREVIEW / 'measure.json'


def scale(value):
    return int(round(value * 2))


def content_fraction(img, x, y, w=120, h=44):
    box = img.crop((x, y - h // 2, x + w, y + h // 2)).convert('RGB')
    pixels = box.load()
    width, height = box.size
    hits = 0
    for j in range(height):
        for i in range(width):
            r, g, b = pixels[i, j]
            if abs(r - BG[0]) + abs(g - BG[1]) + abs(b - BG[2]) > 24:
                hits += 1
    return hits / (width * height)


def main():
    if not MEASURE.exists():
        print(f'缺少 {MEASURE}：先在 {PREVIEW} 里跑 measure_shot_boxes.mjs')
        return 2
    measured = json.loads(MEASURE.read_text())

    cases = []
    derived = measured['dark-derived']
    y0 = 380
    cases.append((PREVIEW / 'dark-derived.png', y0, [
        ('01 #1 设备目录输入框', scale(derived['workbook']['y']) + 34, scale(derived['workbook']['x']) - 16),
        ('01 #2 带出提示行', scale(derived['workbookHint']['y']) + 33, scale(derived['workbookHint']['x']) - 16),
        ('01 #3 预检按钮', scale(derived['preflightBtn']['y']) + 32, scale(derived['preflightBtn']['x']) - 16),
    ]))

    running = measured['dark-mirror-running']
    panel = running['panels'][0]
    y0 = panel['y'] * 2 - 90
    cases.append((PREVIEW / 'dark-mirror-running.png', y0, [
        ('02 #1 上传面板', scale(panel['y']) - y0 + 14, scale(panel['x']) - 16),
        ('02 #2 进度条', scale(running['bar']['y']) + 3 - y0, scale(running['bar']['x']) - 16),
    ]))

    drafts = measured['dark-drafts']
    panel = drafts['panels'][0]
    y0 = scale(panel['y']) - 90
    cases.append((PREVIEW / 'dark-drafts.png', y0, [
        ('03 #1 草稿面板', scale(panel['y']) - y0 + 16, scale(panel['x']) - 16),
        ('03 #2 第一条草稿', scale(drafts['rows'][0]['y']) + 29 - y0, scale(drafts['rows'][0]['x']) - 16),
        ('03 #3 续提交提示', 585 * 2 + 9 - y0, 80 * 2 - 16),
    ]))

    scan_panel = drafts['panels'][1]
    y0 = scale(drafts['scanBtn']['y']) - 70
    cases.append((PREVIEW / 'dark-drafts.png', y0, [
        ('05 #1 识别目录按钮', scale(drafts['scanBtn']['y']) + 16 - y0, scale(drafts['scanBtn']['x']) - 16),
        ('05 #2 识别结果面板', scale(scan_panel['y']) - y0 + 16, scale(scan_panel['x']) - 16),
    ]))

    failed = measured['dark-mirror-failed']['panels'][0]
    y0 = scale(failed['y']) - 90
    cases.append((PREVIEW / 'dark-mirror-failed.png', y0, [
        ('06 #1 失败面板', scale(failed['y']) - y0 + 16, scale(failed['x']) - 16),
    ]))

    platform = Image.open(PLATFORM).convert('RGB')
    cases.append((PLATFORM, 0, [
        ('04 #1 镜像文件框', 478, 331 - 300 - 4),
        ('04 #2 第 5 步', 352, 905),
    ]))

    failures = 0
    for path, y0, targets in cases:
        img = Image.open(path).convert('RGB')
        for label, y, x in targets:
            fraction = content_fraction(img, x + 8, y0 + y)
            ok = fraction > THRESHOLD
            failures += 0 if ok else 1
            print(f'{"OK  " if ok else "MISS"} {label:24s} content={fraction:.3f}')

    print('ALL_OK' if failures == 0 else f'{failures} 条箭头指向空白')
    return 0 if failures == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
