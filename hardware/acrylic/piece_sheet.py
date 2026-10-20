import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
from matplotlib.patches import FancyBboxPatch
for f in fm.findSystemFonts():
    if "NotoSansCJK" in f: fm.fontManager.addfont(f)
plt.rcParams["font.family"]="Noto Sans CJK JP"
parts=[("① 키캡","투명 아크릴 5T",15.00,16.86,1.0,32),("② 립(받침)","투명 아크릴 2T",16.40,18.26,1.0,32)]
fig,axs=plt.subplots(1,2,figsize=(12,6.4),dpi=130)
for ax,(n,m,w,h,r,q) in zip(axs,parts):
    ax.add_patch(FancyBboxPatch((r,r),w-2*r,h-2*r,boxstyle=f"round,pad={r}",fc="#cfe6f5",ec="#c0392b",lw=1.6))
    ax.annotate("",(0,-2.2),(w,-2.2),arrowprops=dict(arrowstyle="<->",lw=1))
    ax.text(w/2,-3.6,f"외경 가로 {w:.2f} mm",ha="center",va="top",fontsize=13,fontweight="bold")
    ax.annotate("",(-2.2,0),(-2.2,h),arrowprops=dict(arrowstyle="<->",lw=1))
    ax.text(-3.4,h/2,f"외경 세로 {h:.2f} mm",ha="right",va="center",rotation=90,fontsize=13,fontweight="bold")
    ax.annotate(f"모서리 R{r:g}",(r*0.3,h-r*0.3),(w*0.55,h+3.2),fontsize=11,arrowprops=dict(arrowstyle="->",lw=0.8))
    ax.text(w/2,h/2,"구멍 없음\n(속이 꽉 찬 판)",ha="center",va="center",fontsize=11,color="#333")
    ax.set_title(f"{n}\n{m} · {q}개",fontsize=15,pad=26)
    ax.set_xlim(-12,w+4); ax.set_ylim(-9,h+6); ax.set_aspect("equal"); ax.axis("off")
fig.suptitle("Kivo Lab 스트림덱 아크릴 조각 · 단위 mm · 빨간 선 따라 외곽만 절단",fontsize=14, y=0.98)
plt.tight_layout(rect=(0,0,1,0.9)); plt.savefig("acrylic_piece_sizes.png")
