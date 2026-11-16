import numpy as np, cv2, glob
from PIL import Image, ImageDraw, ImageFont

def clean2(rgb):
    """只去掉纸张底色：按估计的底色逐通道归一，接近白的压成纯白，深色线条略加深；填充色、彩色保留"""
    img = rgb.astype(np.float32)
    gray = img.mean(axis=2)
    k = max(15, int(min(gray.shape) * 0.08) | 1)
    bg = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    bg = cv2.GaussianBlur(bg, (0, 0), k / 3)
    # 底色只能接近纸张亮度：大块深色填充（如磁铁）不当成底色、不被提亮
    paper = np.percentile(gray, 90)
    bg = np.clip(bg, paper * 0.88, 255)
    norm = np.clip(img / np.maximum(bg, 1)[..., None] * 250, 0, 255)
    lum = norm.mean(axis=2, keepdims=True)
    # 接近纸色（>225）渐变到纯白；深色（<120）加深 30%；中间调不动
    w = np.clip((lum - 215) / 20, 0, 1)
    out = norm * (1 - w) + 255 * w
    d = np.clip((120 - lum) / 120, 0, 1)
    out = out * (1 - 0.3 * d)
    return np.clip(out, 0, 255).astype(np.uint8)

def bicubic(img):
    big = cv2.resize(img, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    blur = cv2.GaussianBlur(big, (0, 0), 1.2)
    return np.clip(cv2.addWeighted(big, 1.6, blur, -0.6, 0), 0, 255).astype(np.uint8)

srs = {}
for name in ['FSRCNN']:
    sr = cv2.dnn_superres.DnnSuperResImpl_create()
    sr.readModel(f'{name}_x3.pb'); sr.setModel(name.lower(), 3)
    srs[name] = sr

font = ImageFont.truetype(glob.glob('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc')[0], 22)
rows = []
import time
for i in range(4):
    o = np.asarray(Image.open(f'{i}-0原图.png').convert('RGB'))
    c = clean2(o)
    outs = [('原图（直接放大）', cv2.resize(o, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)), ('清理+普通放大', bicubic(c))]
    for name, sr in srs.items():
        t = time.time()
        r = sr.upsample(cv2.cvtColor(c, cv2.COLOR_RGB2BGR))
        outs.append((f'清理+{name}', cv2.cvtColor(r, cv2.COLOR_BGR2RGB)))
        print(i, name, f'{(time.time()-t)*1000:.0f}ms', o.shape)
    for t, im in outs: Image.fromarray(im).save(f'{i}-{t}.png')
    H = 290; ims = [Image.fromarray(im) for _, im in outs]; k = H / ims[0].height
    ims = [x.resize((int(x.width * k), H)) for x in ims]
    row = Image.new('RGB', (sum(x.width for x in ims) + 60, H + 34), 'white'); x = 0; dr = ImageDraw.Draw(row)
    for (t, _), im in zip(outs, ims):
        row.paste(im, (x, 34)); dr.text((x + 4, 4), t, fill=(200, 0, 0), font=font); x += im.width + 20
    rows.append(row)
W = max(r.width for r in rows); out = Image.new('RGB', (W, sum(r.height for r in rows) + 10 * len(rows)), 'white'); y = 0
for r in rows: out.paste(r, (0, y)); y += r.height + 10
out.save('compare2.png'); print(out.size)

# 局部按原始像素对比：发电机字母标注、电路图文字
crops = [(2, (0.0, 0.0, 0.62, 0.55), '发电机（局部）'), (3, (0.22, 0.2, 0.78, 0.75), '电路图（局部）')]
rows2 = []
for i, (x0, y0, x1, y1), title in crops:
    tiles = []
    for t in ['原图（直接放大）', '清理+普通放大', '清理+FSRCNN']:
        im = Image.open(f'{i}-{t}.png').convert('RGB')
        W, H = im.size
        tiles.append((t, im.crop((int(W * x0), int(H * y0), int(W * x1), int(H * y1)))))
    w = sum(t.width for _, t in tiles) + 40
    row = Image.new('RGB', (w, tiles[0][1].height + 34), 'white'); dr = ImageDraw.Draw(row); x = 0
    for t, im in tiles:
        row.paste(im, (x, 34)); dr.text((x + 4, 4), f'{title}：{t}', fill=(200, 0, 0), font=font); x += im.width + 20
    rows2.append(row)
W = max(r.width for r in rows2); out = Image.new('RGB', (W, sum(r.height for r in rows2) + 20), 'white'); y = 0
for r in rows2: out.paste(r, (0, y)); y += r.height + 10
out.save('compare3.png'); print(out.size)
