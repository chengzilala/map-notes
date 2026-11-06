#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成扩展图标与商店素材（Edge / 360）。

做法：用 Pillow 直接画（零第三方依赖，只用本机中文字体），一条命令出全部规格：
    python3 tools/make_store_assets.py

产物：
    extension/icons/icon-16.png / icon-48.png / icon-128.png    扩展本体图标
    release/微软商店-上传/…                                      Edge 后台按槽位分好的文件夹
    release/360-素材/…                                          360 创作者中心素材

说明：
- 真实截图放 screenshots/store/store-*.png（1280x800）。有截图时，Edge 截图槽位与
  360 封面 / 推荐图会自动用真实截图裁切；没有截图时先出品牌图占位，并在终端提示。
- 图标与品牌图由 brand/logo-icon.svg 的造型重绘（不是位图放大），任意尺寸都清晰。
"""

import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "extension" / "icons"
OUT_EDGE = ROOT / "release" / "微软商店-上传"
OUT_360 = ROOT / "release" / "360-素材"
SHOT_DIR = ROOT / "screenshots" / "store"

# 品牌色（取自 brand/logo-icon.svg 与 site/assets/css/site.css）
BG_TOP = (9, 16, 28)
BG_BOTTOM = (17, 28, 44)
INK = (20, 24, 29)
BLUE_DARK = (11, 92, 255)
BLUE = (22, 119, 255)
BLUE_LIGHT = (79, 157, 255)
WHITE = (255, 255, 255)
MUTED = (168, 188, 214)
FAINT = (110, 132, 160)

FONT_PATH = "/System/Library/Fonts/Hiragino Sans GB.ttc"
if not os.path.exists(FONT_PATH):
    FONT_PATH = "/System/Library/Fonts/STHeiti Medium.ttc"


def font(size, bold=False):
    return ImageFont.truetype(FONT_PATH, size, index=2 if bold else 0)


def text_size(draw, text, fnt):
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def bezier(p0, p1, p2, p3, steps=48):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0]
        y = u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1]
        pts.append((x, y))
    return pts


def gradient_bg(w, h):
    im = Image.new("RGBA", (w, h), BG_TOP + (255,))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c + (255,))
    return im


def draw_route(im, points, width, color):
    d = ImageDraw.Draw(im)
    d.line(points, fill=color, width=max(1, int(width)), joint="curve")
    r = width / 2
    for p in (points[0], points[-1]):
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=color)


def draw_map_motif(im, seed=0):
    """低对比度的路线 + 节点，让纯色底有「地图」的暗示，不抢文字。"""
    w, h = im.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    line = (79, 157, 255, 34)
    dot = (79, 157, 255, 60)

    p1 = bezier((-w * 0.02, h * 0.72), (w * 0.24, h * 0.58),
                (w * 0.32, h * 0.98), (w * 0.56, h * 1.02))
    p2 = bezier((w * 0.36, -h * 0.05), (w * 0.52, h * 0.22),
                (w * 0.86, h * 0.14), (w * 1.04, h * 0.4))
    p3 = bezier((w * 0.58, h * 1.04), (w * 0.72, h * 0.7),
                (w * 0.9, h * 0.86), (w * 1.04, h * 0.62))
    for path in (p1, p2, p3):
        draw_route(layer, path, max(1.5, w * 0.0016), line)

    d = ImageDraw.Draw(layer)
    dots = [(0.12, 0.7), (0.3, 0.58), (0.47, 0.28), (0.68, 0.2), (0.82, 0.42), (0.72, 0.78)]
    for i, (x, y) in enumerate(dots):
        if (i + seed) % 3 == 0:
            continue
        r = max(3, w * 0.0045)
        d.ellipse([w * x - r, h * y - r, w * x + r, h * y + r], fill=dot)
    im.alpha_composite(layer)


def logo(size):
    """按 brand/logo-icon.svg 的造型重绘：深色圆角底 + 蓝色折线 + 一个亮点。"""
    s = max(size * 8, 512)
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 112 / 512), fill=INK + (255,))

    pts = [(int(s * x / 512), int(s * y / 512))
           for x, y in ((104, 292), (208, 220), (312, 292), (408, 220))]
    mask = Image.new("L", (s, s), 0)
    md = ImageDraw.Draw(mask)
    width = int(s * 46 / 512)
    md.line(pts, fill=255, width=width, joint="curve")
    for p in (pts[0], pts[-1]):
        r = width / 2
        md.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=255)

    grad = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for x in range(s):
        t = x / max(1, s - 1)
        if t < 0.55:
            k = t / 0.55
            c = tuple(int(BLUE_DARK[i] + (BLUE[i] - BLUE_DARK[i]) * k) for i in range(3))
        else:
            k = (t - 0.55) / 0.45
            c = tuple(int(BLUE[i] + (BLUE_LIGHT[i] - BLUE[i]) * k) for i in range(3))
        gd.line([(x, 0), (x, s)], fill=c + (255,))
    im.paste(grad, (0, 0), mask)

    r = int(s * 34 / 512)
    cx, cy = int(s * 312 / 512), int(s * 292 / 512)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BLUE_LIGHT + (255,))
    return im.resize((size, size), Image.LANCZOS)


def draw_note_card(im, box, scale=1.0):
    """右侧的抽象「地点备注卡」：只表达信息结构，不冒充真实界面截图。"""
    x0, y0, x1, y1 = box
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box, radius=int((x1 - x0) * 0.06),
                        fill=(19, 30, 46, 235), outline=(60, 92, 135, 200),
                        width=max(1, int(2 * scale)))
    pad = int((x1 - x0) * 0.08)
    row_h = int((y1 - y0) * 0.13)
    for i in range(4):
        top = y0 + pad + i * int(row_h * 1.18)
        r = int(6 * scale)
        cy = top + row_h // 2
        d.ellipse([x0 + pad, cy - r, x0 + pad + 2 * r, cy + r],
                  fill=(BLUE_LIGHT if i == 0 else (86, 108, 138)) + (255,))
        line_w = int((x1 - x0) * (0.5 if i != 1 else 0.62))
        d.rounded_rectangle([x0 + pad + 3 * r, cy - int(4 * scale),
                             x0 + pad + 3 * r + line_w, cy + int(4 * scale)],
                            radius=int(4 * scale), fill=(226, 238, 255, 220))
        if i == 0:
            d.rounded_rectangle([x0 + pad + 3 * r, cy + int(12 * scale),
                                 x0 + pad + 3 * r + int(line_w * 0.72), cy + int(18 * scale)],
                                radius=int(3 * scale), fill=(120, 160, 210, 200))
    im.alpha_composite(layer)


def brand_card(w, h, title, tagline, footnote, note_card=True, title_size=None):
    im = gradient_bg(w, h)
    draw_map_motif(im)
    d = ImageDraw.Draw(im)

    scale = min(w / 1400, h / 560)
    pad = int(w * 0.065)
    box = max(int(56 * scale), int(min(w, h) * 0.18))
    ts = title_size or int(box * 0.66)

    # 内容整体垂直居中，避免小尺寸磁贴出现「上挤下空」
    text_h = int(ts * 1.3 + ts * 0.46 * 1.5 + ts * 0.34 * 1.9)
    block_h = max(box, text_h)
    y0 = (h - block_h) // 2

    lg = logo(box)
    im.alpha_composite(lg, (pad, y0 + (block_h - box) // 2))

    tx = pad + box + int(w * 0.028)
    ty = y0 + max(0, (block_h - text_h) // 2)
    d.text((tx, ty), title, font=font(ts, bold=True), fill=WHITE)
    sub_y = ty + int(ts * 1.3)
    d.text((tx, sub_y), tagline, font=font(int(ts * 0.46)), fill=(222, 236, 255))
    note_y = sub_y + int(ts * 0.72)
    d.text((tx, note_y), footnote, font=font(int(ts * 0.34)), fill=FAINT)

    if note_card:
        cw = int(w * 0.26)
        ch = int(h * 0.58)
        box2 = (w - pad - cw, (h - ch) // 2, w - pad, (h - ch) // 2 + ch)
        draw_note_card(im, box2, scale=max(0.5, scale))
    return im.convert("RGB")


def promo_card(w, h, title, sub, foot):
    """360 市场推荐图：顶部品牌条 + 左下主标题 + 右侧备注卡。"""
    im = gradient_bg(w, h)
    draw_map_motif(im, seed=1)
    d = ImageDraw.Draw(im)

    pad = int(w * 0.058)
    im.alpha_composite(logo(int(h * 0.13)), (pad, int(h * 0.08)))
    d.text((pad + int(h * 0.17), int(h * 0.09)), "留个点",
           font=font(int(h * 0.056), bold=True), fill=WHITE)
    d.text((pad + int(h * 0.17), int(h * 0.155)), "地图收藏 · 地点笔记",
           font=font(int(h * 0.026)), fill=FAINT)

    d.rounded_rectangle([pad, int(h * 0.33), pad + int(w * 0.055), int(h * 0.33) + 6],
                        radius=3, fill=BLUE_LIGHT)
    d.text((pad, int(h * 0.38)), title, font=font(int(h * 0.082), bold=True), fill=WHITE)
    d.text((pad, int(h * 0.53)), sub, font=font(int(h * 0.038)), fill=(222, 236, 255))
    d.text((pad, int(h * 0.60)), foot, font=font(int(h * 0.028)), fill=FAINT)

    cw = int(w * 0.26)
    ch = int(h * 0.56)
    box2 = (w - pad - cw, int(h * 0.22), w - pad, int(h * 0.22) + ch)
    draw_note_card(im, box2, scale=max(0.6, h / 700))
    return im.convert("RGB")


def fit_image(img, size):
    tw, th = size
    if img.width / img.height > tw / th:
        nw = int(round(img.height * tw / th))
        x = (img.width - nw) // 2
        img = img.crop((x, 0, x + nw, img.height))
    else:
        nh = int(round(img.width * th / tw))
        y = (img.height - nh) // 2
        img = img.crop((0, y, img.width, y + nh))
    return img.resize((tw, th), Image.LANCZOS)


def save(im, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, optimize=True)
    print("  ✓ %-62s %dx%d" % (path.relative_to(ROOT), im.width, im.height))


def real_shots():
    if not SHOT_DIR.exists():
        return []
    return sorted(SHOT_DIR.glob("store-*.png"))[:6]


def main():
    print("扩展图标 → extension/icons/")
    for size in (16, 48, 128):
        save(logo(size), ICON_DIR / ("icon-%d.png" % size))

    shots = real_shots()

    print("Edge 素材 → release/微软商店-上传/")
    save(logo(300), OUT_EDGE / "1-扩展徽标-300x300" / "扩展徽标-300x300.png")
    save(brand_card(440, 280, "留个点", "给每个收藏留一句话", "地图收藏 · 地点笔记",
                    note_card=False),
         OUT_EDGE / "2-小促销磁贴-440x280" / "小促销磁贴-440x280.png")
    save(brand_card(1400, 560, "留个点", "给每个收藏留一句话",
                    "高德 + 百度 · 就地备注 · 按距离找附近"),
         OUT_EDGE / "3-大促销磁贴-1400x560" / "大促销磁贴-1400x560.png")

    shot_dir = OUT_EDGE / "4-屏幕截图-1280x800-最多6张"
    if shots:
        for i, src in enumerate(shots, 1):
            im = fit_image(Image.open(src).convert("RGB"), (1280, 800))
            save(im, shot_dir / ("%02d-%s-1280x800.png" % (i, src.stem)))
    else:
        print("  ⚠️ 未找到 screenshots/store/store-*.png：Edge 截图槽位为空。")
        print("     商店至少需要 1 张真实截图；按文档拍好后重跑本脚本即可自动入槽。")

    print("360 素材 → release/360-素材/")
    save(logo(192), OUT_360 / "图标-192x192.png")

    if shots:
        save(fit_image(Image.open(shots[0]).convert("RGB"), (472, 296)),
             OUT_360 / "封面图小图-472x296.png")
        for i, src in enumerate(shots[:5], 1):
            save(fit_image(Image.open(src).convert("RGB"), (1120, 700)),
                 OUT_360 / ("市场推荐图-%02d-1120x700.png" % i))
    else:
        save(brand_card(472, 296, "留个点", "给每个收藏留一句话", "地图收藏 · 地点笔记",
                        note_card=False),
             OUT_360 / "封面图小图-472x296.png")
        promos = [
            ("点开就写，停手就存", "备注跟着地点走，刷新还在"),
            ("附近，从近到远", "定位后按距离排，可筛 1 / 3 / 10 km"),
            ("高德百度，一次收齐", "两个收藏夹合并去重，来源可筛"),
            ("只在你本机", "收藏只读、只缓存，不上传、不写回地图"),
            ("一个侧栏，够用了", "搜索、备注、距离，不做导航与路线"),
        ]
        for i, (title, sub) in enumerate(promos, 1):
            save(promo_card(1120, 700, title, sub, "留个点 · 地图收藏备注"),
                 OUT_360 / ("市场推荐图-%02d-1120x700.png" % i))

    print("360 旧版效果图（560x350）→ release/360-素材/")
    for i in range(1, 6):
        src = OUT_360 / ("市场推荐图-%02d-1120x700.png" % i)
        if src.exists():
            save(fit_image(Image.open(src).convert("RGB"), (560, 350)),
                 OUT_360 / ("效果图-%02d-560x350.png" % i))

    print("完成。")
    if not shots:
        print("提醒：真实截图是商店必填项，拍好放到 screenshots/store/ 后重跑一次。")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # 素材生成失败时给出可读原因，不吞错
        print("生成失败：%s" % exc)
        sys.exit(1)
