import ezdxf, os, zipfile
from ezdxf import units
from shapely.geometry import box
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
for f in fm.findSystemFonts():
    if "NotoSansCJK" in f or "NanumGothic" in f: fm.fontManager.addfont(f)
plt.rcParams["font.family"] = [n for n in ("Noto Sans CJK KR","NanumGothic") if n in {x.name for x in fm.fontManager.ttflist}][:1] or ["DejaVu Sans"]

KW, KH = 15.2, 17.06
PARTS = {"03_acrylic_5mm_clear_key_caps_x32.dxf": ("키캡", 5, KW-0.2, KH-0.2, 1.0),
         "04_acrylic_2mm_clear_key_lips_x32.dxf": ("키 받침(립)", 2, KW+1.2, KH+1.2, 1.0)}
COLS, ROWS, G = 8, 4, 6.0
def rr(w, h, r):
    return list(box(r, r, w-r, h-r).buffer(r, 16).exterior.coords)[:-1]
fig, axs = plt.subplots(1, 2, figsize=(16, 6.4), dpi=110)
for ax, (fn, (name, t, w, h, r)) in zip(axs, PARTS.items()):
    doc = ezdxf.new("R2010", setup=True); doc.units = units.MM
    doc.layers.add("CUT", color=1); msp = doc.modelspace()
    shape = rr(w, h, r)
    for i in range(ROWS):
        for j in range(COLS):
            dx, dy = j*(w+G), i*(h+G)
            pts = [(x+dx, y+dy) for x, y in shape]
            msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "CUT"})
            xs, ys = zip(*(pts+[pts[0]])); ax.plot(xs, ys, color="#c0392b", lw=0.9)
    doc.saveas(fn)
    tw, th = COLS*w+(COLS-1)*G, ROWS*h+(ROWS-1)*G
    # dimension one part
    ax.annotate("", (0, -3), (w, -3), arrowprops=dict(arrowstyle="<->", lw=0.8))
    ax.text(w/2, -6.5, f"{w:.2f}", ha="center", fontsize=9)
    ax.annotate("", (-3, 0), (-3, h), arrowprops=dict(arrowstyle="<->", lw=0.8))
    ax.text(-5, h/2, f"{h:.2f}", ha="right", va="center", fontsize=9, rotation=90)
    ax.text(w/2, h/2, f"R{r}", ha="center", va="center", fontsize=8, color="#555")
    ax.set_title(f"{fn}\n투명 아크릴 {t} mm · {name} 32개 (2대분 30 + 예비 2)\n"
                 f"개당 {w:.2f} × {h:.2f} mm, 모서리 R{r} · 배치 영역 {tw:.0f} × {th:.0f} mm", fontsize=11)
    ax.set_aspect("equal"); ax.axis("off"); ax.set_xlim(-14, tw+3); ax.set_ylim(-11, th+3)
    print(fn, w, h, r, round(tw,1), round(th,1))
fig.suptitle("Kivo Lab 스트림덱 · 아크릴 레이저 커팅 (단위 mm, 빨간 선 = 전체 절단)", fontsize=13)
plt.tight_layout(); plt.savefig("acrylic_cut_preview.png")
with zipfile.ZipFile("streamdeck_acrylic_keys_x2.zip", "w") as z:
    for fn in PARTS: z.write(fn)
    z.write("acrylic_cut_preview.png")
