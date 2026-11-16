"""把 source/ 里的 ChatGPT 素材合成为网页用的 assets/。

用法（在项目根目录）：python tools/build.py

- 主图：source/master-v2.* 优先，否则 master-v1.webp，放大 2 倍到 3072×2048。
- 分区重绘：source/region-1 … region-7（png/jpg/webp 均可），有几张合几张。
  每张先用特征点对齐到当初切出去的 source/regions/region-N-*.png，
  再统一色调、羽化边缘，贴回主图对应位置。
- 素描：source/sketch-a … sketch-d，有几张导出几张。
- 原作：source/raphael.jpg（拉斐尔原作，公有领域），拉伸到同尺寸用于对照。
- 最后写 assets/manifest.js，页面据此决定显示哪些素描。
"""
import glob, json, os, sys
import cv2
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, OUT = os.path.join(ROOT, "source"), os.path.join(ROOT, "assets")
BASE_W, BASE_H, SCALE = 1536, 1024, 2

# 与当初切图完全一致的区域框（主图 1536×1024 坐标）
REGIONS = {
    1: (490, 430, 1110, 780), 2: (0, 440, 560, 760), 3: (0, 620, 640, 1024),
    4: (560, 620, 1020, 1024), 5: (980, 700, 1380, 1024),
    6: (1080, 460, 1470, 820), 7: (1340, 560, 1536, 1024),
}
# 贴回顺序：后贴的覆盖先贴的（重叠处以后者为准）
ORDER = [1, 2, 6, 3, 4, 5, 7]
EXTS = ("png", "jpg", "jpeg", "webp")


def find(stem):
    for e in EXTS:
        hit = glob.glob(os.path.join(SRC, f"{stem}.{e}"))
        if hit:
            return hit[0]


def load(path):
    return cv2.cvtColor(np.array(Image.open(path).convert("RGB")), cv2.COLOR_RGB2BGR)


def align(img, ref):
    """把 ChatGPT 返回的图对齐到参考切图的画框；失败则直接缩放。"""
    h, w = ref.shape[:2]
    sift = cv2.SIFT_create(4000)
    g1, g2 = (cv2.cvtColor(x, cv2.COLOR_BGR2GRAY) for x in (img, ref))
    k1, d1 = sift.detectAndCompute(g1, None)
    k2, d2 = sift.detectAndCompute(g2, None)
    H = None
    if d1 is not None and d2 is not None and len(k1) > 50 and len(k2) > 50:
        pairs = cv2.BFMatcher().knnMatch(d1, d2, k=2)
        good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.75 * n.distance]
        if len(good) >= 40:
            a = np.float32([k1[m.queryIdx].pt for m in good])
            b = np.float32([k2[m.trainIdx].pt for m in good])
            H, inl = cv2.findHomography(a, b, cv2.RANSAC, 4.0)
            if H is None or inl.sum() < 30:
                H = None
    if H is None:
        print("    ! 对齐失败，改为直接缩放（如果构图变了，接缝可能不齐）")
        return cv2.resize(img, (w, h), interpolation=cv2.INTER_LANCZOS4), np.ones((h, w), np.float32)
    warped = cv2.warpPerspective(img, H, (w, h), flags=cv2.INTER_LANCZOS4)
    valid = cv2.warpPerspective(np.ones(img.shape[:2], np.float32), H, (w, h))
    print(f"    对齐成功：{int(inl.sum())} 个匹配点")
    return warped, valid


def match_color(img, ref, mask):
    """在 Lab 空间按均值/方差把重绘图的色调拉回主图。"""
    a = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    b = cv2.cvtColor(ref, cv2.COLOR_BGR2LAB).astype(np.float32)
    m = mask > 0.5
    for c in range(3):
        sa, sb = a[..., c][m], b[..., c][m]
        a[..., c] = (a[..., c] - sa.mean()) / (sa.std() + 1e-6) * sb.std() + sb.mean()
    return cv2.cvtColor(np.clip(a, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def save_webp(bgr_or_pil, path, q=86):
    im = bgr_or_pil if isinstance(bgr_or_pil, Image.Image) else Image.fromarray(cv2.cvtColor(bgr_or_pil, cv2.COLOR_BGR2RGB))
    im.save(path, "WEBP", quality=q, method=6)
    print(f"  → {os.path.relpath(path, ROOT)}  {im.size[0]}×{im.size[1]}  {os.path.getsize(path) // 1024} KB")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(os.path.join(OUT, "sketches"), exist_ok=True)
    master_path = find("master-v2") or find("master-v1")
    if not master_path:
        sys.exit("找不到 source/master-v1.webp")
    print(f"主图：{os.path.basename(master_path)}")
    master = cv2.resize(load(master_path), (BASE_W, BASE_H), interpolation=cv2.INTER_AREA)
    canvas = cv2.resize(master, (BASE_W * SCALE, BASE_H * SCALE), interpolation=cv2.INTER_LANCZOS4).astype(np.float32)

    used = []
    for n in ORDER:
        path = find(f"region-{n}")
        refs = glob.glob(os.path.join(SRC, "regions", f"region-{n}-*.png"))
        if not path or not refs:
            continue
        print(f"分区 {n}：{os.path.basename(path)}")
        ref = load(refs[0])
        warped, valid = align(load(path), ref)
        warped = match_color(warped, ref, valid)
        x0, y0, x1, y1 = REGIONS[n]
        bw, bh = (x1 - x0) * SCALE, (y1 - y0) * SCALE
        patch = cv2.resize(warped, (bw, bh), interpolation=cv2.INTER_AREA).astype(np.float32)
        mask = cv2.resize(valid, (bw, bh), interpolation=cv2.INTER_AREA)
        # 只在与画面内部相接的边上羽化；贴着画面外沿的边保持实心
        f = max(8, int(min(bw, bh) * 0.06))
        mask = cv2.erode((mask > 0.99).astype(np.float32), np.ones((3, 3)), iterations=2)
        edge = np.ones((bh, bw), np.float32)
        ramp = np.linspace(0, 1, f, dtype=np.float32)
        if x0 > 0: edge[:, :f] *= ramp[None, :]
        if x1 < BASE_W: edge[:, -f:] *= ramp[::-1][None, :]
        if y0 > 0: edge[:f, :] *= ramp[:, None]
        if y1 < BASE_H: edge[-f:, :] *= ramp[::-1][:, None]
        mask = cv2.GaussianBlur(mask, (0, 0), f / 4) * edge
        roi = canvas[y0 * SCALE:y1 * SCALE, x0 * SCALE:x1 * SCALE]
        roi[:] = roi * (1 - mask[..., None]) + patch * mask[..., None]
        used.append(n)

    athens = np.clip(canvas, 0, 255).astype(np.uint8)
    print("导出：")
    save_webp(athens, os.path.join(OUT, "athens.webp"))
    save_webp(cv2.resize(athens, (768, 512), interpolation=cv2.INTER_AREA), os.path.join(OUT, "athens-preview.webp"), 70)
    cover = athens[260 * SCALE:900 * SCALE, 288 * SCALE:1248 * SCALE]  # 中央 960×640 区域做作品集封面
    save_webp(cv2.resize(cover, (1200, 800), interpolation=cv2.INTER_AREA), os.path.join(OUT, "cover.webp"), 84)

    raphael = find("raphael")
    if raphael:
        r = cv2.resize(load(raphael), (BASE_W * SCALE, BASE_H * SCALE), interpolation=cv2.INTER_AREA)
        save_webp(r, os.path.join(OUT, "raphael.webp"), 80)

    sketches = []
    for k in "abcd":
        p = find(f"sketch-{k}")
        if p:
            im = Image.open(p).convert("RGB")
            im.thumbnail((1400, 1400), Image.LANCZOS)
            save_webp(im, os.path.join(OUT, "sketches", f"sketch-{k}.webp"), 84)
            sketches.append(k)

    manifest = {"regions": used, "sketches": sketches, "raphael": bool(raphael), "master": os.path.basename(master_path)}
    with open(os.path.join(OUT, "manifest.js"), "w", encoding="utf-8") as fh:
        fh.write("window.ASSETS = " + json.dumps(manifest, ensure_ascii=False) + ";\n")
    print(f"完成：分区 {used or '无'}，素描 {sketches or '无'}，原作 {'有' if raphael else '无'}")


if __name__ == "__main__":
    main()
