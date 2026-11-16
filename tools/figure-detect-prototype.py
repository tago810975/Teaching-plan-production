"""插图自动检测原型 v2：先认出文字行，其余为插图材料；材料按“不隔着文字行”合并，再按竖直空白切开"""
import numpy as np, glob
from PIL import Image, ImageDraw
from scipy import ndimage

def analyze(path):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    gray = a.mean(axis=2); sat = a.max(axis=2) - a.min(axis=2)
    ink = (gray < 175) | ((sat > 60) & (gray < 235))
    lab, n = ndimage.label(ink, structure=np.ones((3, 3)))
    objs = ndimage.find_objects(lab)
    sizes = ndimage.sum(ink, lab, range(1, n + 1))
    comps = []
    for i, sl in enumerate(objs):
        if sl is None or sizes[i] < 3: continue
        comps.append(dict(x0=sl[1].start, y0=sl[0].start, x1=sl[1].stop, y1=sl[0].stop, s=int(sizes[i]), id=i + 1))
    hs = np.array([c['y1'] - c['y0'] for c in comps])
    h = max(8.0, float(np.median(hs[(hs >= 6) & (hs <= 80)])))
    H, W = ink.shape
    # 去掉容器边框（三边以上完整、框内大量正常字号的字）、彩色底标签
    chars = [c for c in comps if 0.5 * h <= c['y1'] - c['y0'] <= 1.6 * h and c['x1'] - c['x0'] <= 2.5 * h]
    remove = np.zeros(n + 1, bool)
    for c in comps:
        w, hh = c['x1'] - c['x0'], c['y1'] - c['y0']
        if w * hh == 0: continue
        dens = c['s'] / (w * hh)
        if hh < 3 * h and dens > 0.45 and w > 1.5 * h:  # 彩色底标签
            remove[c['id']] = True; continue
        if w > 6 * h and hh > 4 * h:
            m = lab[c['y0']:c['y1'], c['x0']:c['x1']] == c['id']
            band = max(3, int(0.6 * h))
            sides = [m[:band].any(0).mean(), m[-band:].any(0).mean(), m[:, :band].any(1).mean(), m[:, -band:].any(1).mean()]
            inside = sum(1 for d in chars if d['x0'] >= c['x0'] and d['x1'] <= c['x1'] and d['y0'] >= c['y0'] and d['y1'] <= c['y1'])
            if sum(v > 0.85 for v in sides) >= 3 and inside > 40:
                remove[c['id']] = True
    ink2 = ink & ~remove[lab]
    # 把一行中挨着的字连成一条
    kx, ky = max(2, int(0.6 * h)), max(1, int(0.2 * h))
    dil = ndimage.binary_dilation(ink2, structure=np.ones((2 * ky + 1, 2 * kx + 1)))
    blab, bn = ndimage.label(dil)
    bobjs = ndimage.find_objects(blab)
    keep = [c for c in comps if not remove[c['id']]]
    blobs = []
    for j, sl in enumerate(bobjs):
        if sl is None: continue
        x0, y0, x1, y1 = sl[1].start, sl[0].start, sl[1].stop, sl[0].stop
        inner = [c for c in keep if c['x0'] >= x0 and c['x1'] <= x1 and c['y0'] >= y0 and c['y1'] <= y1]
        if not inner: continue
        x0 = min(c['x0'] for c in inner); x1 = max(c['x1'] for c in inner); y0 = min(c['y0'] for c in inner); y1 = max(c['y1'] for c in inner)
        def is_char(c):
            return 0.4 * h <= c['y1'] - c['y0'] <= 1.7 * h and c['x1'] - c['x0'] <= 2.2 * h
        def is_bar(c):  # 分数线、根号上的横线
            return c['y1'] - c['y0'] <= 0.3 * h and c['x1'] - c['x0'] <= 8 * h
        def is_bracket(c):  # 括号、竖线等又细又高的笔画
            return c['x1'] - c['x0'] <= 0.7 * h and c['y1'] - c['y0'] <= 4.5 * h
        nchar = sum(1 for c in inner if is_char(c))
        big = any(((c['y1'] - c['y0']) > 1.7 * h or (c['x1'] - c['x0']) > 2.2 * h) and not is_bar(c) and not is_bracket(c) for c in inner)
        cols = ink2[y0:y1, x0:x1].any(0).mean() if x1 > x0 else 0
        hh = y1 - y0
        text = (hh <= 4.5 * h and nchar >= 3 and cols >= 0.5 and not big) or (hh <= 2.2 * h and nchar >= 7 and not big)
        # 答题括号“（　　）”：只有一两个又细又高的括号；两半离得远时各成一块，靠页面右侧
        if len(inner) <= 2 and all(is_bracket(c) and c['y1'] - c['y0'] >= 0.8 * h for c in inner) and (len(inner) == 2 or x0 > 0.7 * W):
            text = True
        blobs.append(dict(x0=x0, y0=y0, x1=x1, y1=y1, text=text, n=len(inner)))
    texts = [b for b in blobs if b['text']]
    mats = [dict(b) for b in blobs if not b['text']]
    # 材料合并：相距不远、中间没有文字行
    gx, gy = 2.5 * h, 2.8 * h
    def blocked(a, b):
        ux0, ux1 = max(min(a['x0'], b['x0']), 0), max(a['x1'], b['x1'])
        if a['y1'] <= b['y0']: gy0, gy1 = a['y1'], b['y0']
        elif b['y1'] <= a['y0']: gy0, gy1 = b['y1'], a['y0']
        else: return False
        for t in texts:
            if t['y0'] >= gy0 - 1 and t['y1'] <= gy1 + 1 and t['x1'] > ux0 and t['x0'] < ux1 and (t['x1'] - t['x0']) > 4 * h:
                return True
        return False
    changed = True
    while changed:
        changed = False
        for i in range(len(mats)):
            for j in range(i + 1, len(mats)):
                a, b = mats[i], mats[j]
                dx = max(0, max(a['x0'], b['x0']) - min(a['x1'], b['x1']))
                dy = max(0, max(a['y0'], b['y0']) - min(a['y1'], b['y1']))
                if dx <= gx and dy <= gy and not blocked(a, b):
                    mats[i] = dict(x0=min(a['x0'], b['x0']), y0=min(a['y0'], b['y0']), x1=max(a['x1'], b['x1']), y1=max(a['y1'], b['y1']), n=a['n'] + b['n'], text=False)
                    mats.pop(j); changed = True; break
            if changed: break
    # 按竖直空白切开（并排的几幅图）
    figs = []
    def split(r):
        sub = ink2[r['y0']:r['y1'], r['x0']:r['x1']]
        colink = sub.any(0)
        gaps, start = [], None
        for x, v in enumerate(colink):
            if not v and start is None: start = x
            if v and start is not None:
                if x - start >= 1.0 * h: gaps.append((start, x))
                start = None
        if not gaps: return [r]
        # 只在最宽的几处空白切开：并排的几幅图之间的空白，比图内（如一列列的 ×）之间的空白明显宽
        widest = max(g1 - g0 for g0, g1 in gaps)
        gaps = [g for g in gaps if g[1] - g[0] >= 0.7 * widest]
        out, prev = [], 0
        for g0, g1 in gaps:
            out.append(dict(r, x0=r['x0'] + prev, x1=r['x0'] + g0)); prev = g1
        out.append(dict(r, x0=r['x0'] + prev))
        # 太小的一片（如一列 ×）并回旁边空白较窄的那一片，不单独成图
        changed = True
        while changed and len(out) > 1:
            changed = False
            for k, p in enumerate(out):
                if p['x1'] - p['x0'] >= 3.5 * h: continue
                left = p['x0'] - out[k - 1]['x1'] if k > 0 else None
                right = out[k + 1]['x0'] - p['x1'] if k + 1 < len(out) else None
                j = k - 1 if right is None or (left is not None and left <= right) else k + 1
                a, b = sorted([k, j])
                out[a] = dict(r, x0=out[a]['x0'], x1=out[b]['x1'])
                out.pop(b); changed = True; break
        res = []
        for p in out:
            sub = ink2[p['y0']:p['y1'], p['x0']:p['x1']]
            ys = np.where(sub.any(1))[0]; xs = np.where(sub.any(0))[0]
            if len(ys) == 0: continue
            res.append(dict(p, y0=p['y0'] + ys[0], y1=p['y0'] + ys[-1] + 1, x0=p['x0'] + xs[0], x1=p['x0'] + xs[-1] + 1))
        return res
    for r in mats:
        for p in split(r):
            w, hh = p['x1'] - p['x0'], p['y1'] - p['y0']
            if w < 3.5 * h or hh < 3 * h: continue
            # 插图里一定有图形笔画（坐标轴、曲线、导线……）；只有字、分数线、括号的是公式
            graphic = any(c['x0'] >= p['x0'] and c['x1'] <= p['x1'] and c['y0'] >= p['y0'] and c['y1'] <= p['y1']
                          and ((c['y1'] - c['y0']) > 1.7 * h or (c['x1'] - c['x0']) > 2.2 * h)
                          and not (c['y1'] - c['y0'] <= 0.3 * h) and not (c['x1'] - c['x0'] <= 0.7 * h)
                          for c in keep)
            if not graphic: continue
            region = ink2[p['y0']:p['y1'], p['x0']:p['x1']]
            dens = region.mean(); _, nsub = ndimage.label(region)
            if 0.75 < w / hh < 1.33 and dens > 0.3 and max(w, hh) < 10 * h and nsub > 10: continue  # 二维码
            figs.append(p)
    figs.sort(key=lambda f: (round(f['y0'] / (3 * h)), f['x0']))
    return im, figs, h, texts

if __name__ == '__main__':
    for path in sorted(glob.glob('/mnt/user-data/uploads/17947[56]*_image.png')):
        im, figs, h, texts = analyze(path)
        d = ImageDraw.Draw(im)
        for k, f in enumerate(figs):
            d.rectangle((f['x0'] - 3, f['y0'] - 3, f['x1'] + 3, f['y1'] + 3), outline=(0, 120, 255), width=4)
            d.text((f['x0'], max(0, f['y0'] - 16)), f'{k+1}', fill=(255, 0, 0))
        name = path.split('/')[-1].split('_')[0][-4:]
        im.save(f'/tmp/fig/v2-{name}.png')
        print(name, '字高', round(h, 1), '检测到', len(figs), '个')
