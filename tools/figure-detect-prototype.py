"""插图自动检测原型：连通域 → 按字高分类 → 合并图形块 → 排除边框、横线"""
import numpy as np, sys, glob
from PIL import Image, ImageDraw
from scipy import ndimage

def detect(path):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    gray = a.mean(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    ink = (gray < 170) | ((sat > 60) & (gray < 235))
    lab, n = ndimage.label(ink, structure=np.ones((3, 3)))
    objs = ndimage.find_objects(lab)
    sizes = ndimage.sum(ink, lab, range(1, n + 1))
    boxes = []
    for i, sl in enumerate(objs):
        if sl is None or sizes[i] < 4: continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        boxes.append((x0, y0, x1, y1, int(sizes[i]), i + 1))
    hs = np.array([b[3] - b[1] for b in boxes])
    # 字高：中等大小连通域高度的中位数
    h = float(np.median(hs[(hs >= 6) & (hs <= 80)])) if len(hs) else 12
    h = max(h, 8)
    # 正常字号的字（小圆点、细碎的笔画不算）
    small = [b for b in boxes if 0.6 * h <= (b[3] - b[1]) <= 1.6 * h and (b[2] - b[0]) <= 2.5 * h]
    def inside_count(x0, y0, x1, y1):
        return sum(1 for b in small if b[0] >= x0 and b[2] <= x1 and b[1] >= y0 and b[3] <= y1)
    big = []
    for (x0, y0, x1, y1, s, idx) in boxes:
        w, hh = x1 - x0, y1 - y0
        if hh > 2.2 * h or (w > 4 * h and hh > 1.2 * h):
            area = w * hh
            density = s / area
            # 彩色底的标签、实心色块：矮、满
            if hh < 3 * h and density > 0.45:
                continue
            # 容器边框（笔记框、表格外框）：四条边都是连续的线，框内有大量文字（坐标轴只有两条边）
            m = lab[y0:y1, x0:x1] == idx
            band = max(3, int(0.6 * h))
            def cover(strip, axis):
                return strip.any(axis=axis).mean()
            sides = [cover(m[:band, :], 0), cover(m[-band:, :], 0), cover(m[:, :band], 1), cover(m[:, -band:], 1)]
            if sum(1 for v in sides if v > 0.85) >= 3 and inside_count(x0, y0, x1, y1) > 40:
                continue
            big.append([x0, y0, x1, y1])
    # 合并相互靠近的大块
    gap = 0.8 * h
    def near(a, b, g):
        return not (a[2] + g < b[0] or b[2] + g < a[0] or a[3] + g < b[1] or b[3] + g < a[1])
    changed = True
    while changed:
        changed = False
        for i in range(len(big)):
            for j in range(i + 1, len(big)):
                if near(big[i], big[j], 2 * h):
                    big[i] = [min(big[i][0], big[j][0]), min(big[i][1], big[j][1]), max(big[i][2], big[j][2]), max(big[i][3], big[j][3])]
                    big.pop(j); changed = True; break
            if changed: break
    # 吸入图中的小标注（完全落在扩大后的框内、且不是整行文字）
    out = []
    for f in big:
        fx0, fy0, fx1, fy1 = f
        for (x0, y0, x1, y1, s, idx) in boxes:
            if x0 >= fx0 - gap and x1 <= fx1 + gap and y0 >= fy0 - gap and y1 <= fy1 + gap:
                fx0, fy0, fx1, fy1 = min(fx0, x0), min(fy0, y0), max(fx1, x1), max(fy1, y1)
        w, hh = fx1 - fx0, fy1 - fy0
        if w >= 3 * h and hh >= 2.5 * h:
            region = ink[fy0:fy1, fx0:fx1]
            dens = region.mean()
            # 二维码：近似正方形、墨迹很满且碎（大量小块）
            sub, nsub = ndimage.label(region)
            if 0.75 < w / hh < 1.33 and dens > 0.3 and max(w, hh) < 10 * h and nsub > 10:
                continue
            out.append((fx0, fy0, fx1, fy1))
    return im, out, h

for path in sorted(glob.glob('/mnt/user-data/uploads/17947[56]*_image.png')):
    if '1794741' in path: continue
    im, out, h = detect(path)
    d = ImageDraw.Draw(im)
    for k, (x0, y0, x1, y1) in enumerate(out):
        d.rectangle((x0 - 3, y0 - 3, x1 + 3, y1 + 3), outline=(0, 120, 255), width=4)
        d.text((x0, max(0, y0 - 16)), f'图{k+1}', fill=(0, 120, 255))
    name = path.split('/')[-1].split('_')[0][-4:]
    im.save(f'/tmp/fig/{name}.png')
    print(name, im.size, '字高', round(h, 1), '检测到', len(out), '个')
