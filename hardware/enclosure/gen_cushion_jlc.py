"""Two TPU key cushions (1 mm) joined by thin bridges to two 10 mm breakaway posts, so the part's
bounding box passes JLC FDM's 30 x 30 x 10 mm minimum. Cut the bridges after printing."""
import cadquery as cq
PX, PY = 16.704, 18.56
GW, GH, WW, WH, T = 5 * PX, 3 * PY, 13.4, 15.26, 1.0
GAP = 12.0                                   # space between the two cushions (posts live here)
def cushion(x0):
    c = cq.Workplane("XY").center(x0 + GW / 2, GH / 2).rect(GW, GH).extrude(T).edges("|Z").fillet(1.0)
    for r in range(3):
        for k in range(5):
            c = c.cut(cq.Workplane("XY").center(x0 + k * PX + PX / 2, r * PY + PY / 2).rect(WW, WH).extrude(T).edges("|Z").fillet(1.0))
    return c
part = cushion(0).union(cushion(GW + GAP))
xm = GW + GAP / 2
for y in (GH * 0.25, GH * 0.75):
    post = cq.Workplane("XY").center(xm, y).rect(5, 5).extrude(10.0)
    bridge = cq.Workplane("XY").center(xm, y).rect(GAP + 1.0, 2.0).extrude(T)   # 2 mm wide, 1 mm thick
    part = part.union(post).union(bridge)
cq.exporters.export(part, "out/P3_key_cushion_TPU_x2_JLC.stl"); cq.exporters.export(part, "out/P3_key_cushion_TPU_x2_JLC.step")
bb = part.val().BoundingBox(); print(round(bb.xlen, 1), round(bb.ylen, 1), round(bb.zlen, 1), "mm", round(part.val().Volume() / 1000, 2), "cm3")
