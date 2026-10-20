"""3D-printed version v2: FLAT body (ESP32 soldered directly) + separate 12 deg stand.
CAD frame right-handed: x left->right, y = 0 at the FRONT (user side) -> back, z up.
Layout coordinates (plate frame, y from the BACK) are converted with Y = D - y."""
import math, os
import cadquery as cq

W, D = 213.0, 91.0
T_PLATE, FLOOR, WALL, R = 3.0, 2.0, 2.5, 5.0
# vertical stack (from the table): floor 2 | ESP32 soldered under PCB 7.3 + 1.0 gap | PCB 1.6 | posts 12 (fader body 11-12) | plate 3
PCB_BOT = FLOOR + 7.3 + 1.0
PCB_TOP = PCB_BOT + 1.6
POST_H = 12.5   # fader body 11-12 + flush-cut ESP32 joints + kapton under the faders
PLATE_UNDER = PCB_TOP + POST_H
H = PLATE_UNDER                         # body wall height (plate sits on top)
TOTAL = H + T_PLATE
Y = lambda y: D - y                     # layout (from back) -> CAD (from front)
BOSSES = [(6.5, 6.5), (W - 6.5, 6.5), (6.5, D - 6.5), (W - 6.5, D - 6.5)]
BOSS_R, INSERT_D, INSERT_L = 3.0, 4.0, 6.0
OUT = "/home/claude/print/out/"; os.makedirs(OUT, exist_ok=True)

# ------------------------------------------------------------------ P1 body (print floor-down)
body = cq.Workplane("XY").rect(W, D, centered=False).extrude(H).edges("|Z").fillet(R)
body = body.cut(cq.Workplane("XY").workplane(offset=FLOOR).center(W / 2, D / 2)
                .rect(W - 2 * WALL, D - 2 * WALL).extrude(H).edges("|Z").fillet(2.5))
for (x, y) in BOSSES:
    b = cq.Workplane("XY").workplane(offset=FLOOR).center(x, y).circle(BOSS_R).extrude(H - FLOOR)
    body = body.union(b)
    body = body.cut(cq.Workplane("XY").workplane(offset=H - INSERT_L).center(x, y).circle(INSERT_D / 2).extrude(INSERT_L))
# USB-C opening in the back wall (CAD y = D side), centred; plug centre ~5.5 mm above the table
usb = cq.Workplane("XZ").center(W / 2, 5.6).slot2D(12.5, 7.0).extrude(-(WALL + 2)).translate((0, D - WALL - 1, 0))
body = body.cut(usb)
cradle = (cq.Workplane("XY").workplane(offset=FLOOR).center(W / 2, D - WALL - 12).rect(21, 24).extrude(1.0)
          .cut(cq.Workplane("XY").workplane(offset=FLOOR).center(W / 2, D - WALL - 12).rect(17, 24.5).extrude(2)))
body = body.union(cradle)
logo = (cq.Workplane("XY").text("Kivo Lab", 9.0, 0.6, kind="bold", halign="center", valign="center")
        .mirror("XZ").translate((W / 2, D / 2, 0)))
body = body.cut(logo)
cq.exporters.export(body, OUT + "P1_body.step"); cq.exporters.export(body, OUT + "P1_body.stl")

# ------------------------------------------------------------------ P2 top plate (flat; print top face down)
AX, AY, PX, PY, KW, KH = 12.0, 17.66, 16.704, 18.56, 15.2, 17.06
plate = cq.Workplane("XY").rect(W, D, centered=False).extrude(T_PLATE).edges("|Z").fillet(R)
win = None
for r in range(3):
    for c in range(5):
        w = (cq.Workplane("XY").center(AX + c * PX + PX / 2, Y(AY + r * PY + PY / 2)).rect(KW, KH)
             .extrude(T_PLATE).edges("|Z").fillet(1.0))
        win = w if win is None else win.union(w)
plate = plate.cut(win)
for (x, y) in [(128, 30), (128, 61)]:
    plate = plate.cut(cq.Workplane("XY").center(x, Y(y)).circle(3.75).extrude(T_PLATE))
for x in (164.5, 188.5):
    plate = plate.cut(cq.Workplane("XY").center(x, Y(45.5)).slot2D(67.0, 3.0, angle=90).extrude(T_PLATE))
plate = plate.faces(">Z").workplane(origin=(0, 0, T_PLATE)).pushPoints(BOSSES).cskHole(3.4, 6.6, 90)
PCB_HOLES = [(131, 9.5), (176.5, 9.5), (199.5, 9.5), (119.5, 81), (176.5, 81), (199.5, 81), (146, 52)]
for (x, y) in PCB_HOLES:                 # 12 mm posts with M3 heat-set insert holes
    p = cq.Workplane("XY").center(x, Y(y)).circle(3.3).extrude(-POST_H)
    p = p.cut(cq.Workplane("XY").workplane(offset=-POST_H).center(x, Y(y)).circle(INSERT_D / 2).extrude(INSERT_L))
    plate = plate.union(p)
# LCD guides: corner L-brackets around the 108 x 61.7 module (final height after measuring the LCD)
LX0, LX1 = 7.5 - 0.3, 115.5 + 0.3
LY0, LY1 = Y(76.37) - 0.3, Y(14.63) + 0.3
# LCD (touch version): module 5.0-5.5 mm thick. Glass top sits 3.2 mm under the plate (key lip 2 + TPU cushion 1
# + 0.2 free), so the LCD PCB bottom is ~8.45 mm under the plate. Snap hooks under the PCB edge hold it there.
G_T, G_L = 1.5, 10.0
LCD_T = 5.25
G_H = 3.2 + LCD_T                         # guide length down to the LCD PCB bottom
HOOK_IN, HOOK_H = 0.8, 1.0                # inward lip that the PCB edge snaps over
for (cx, cy, sx, sy) in [(LX0, LY0, -1, -1), (LX1, LY0, 1, -1), (LX0, LY1, -1, 1), (LX1, LY1, 1, 1)]:
    a = cq.Workplane("XY").center(cx + sx * G_T / 2, cy - sy * (G_L / 2 - G_T)).rect(G_T, G_L).extrude(-(G_H + HOOK_H))
    b = cq.Workplane("XY").center(cx - sx * (G_L / 2 - G_T), cy + sy * G_T / 2).rect(G_L, G_T).extrude(-(G_H + HOOK_H))
    # hook on the long-side leg (along x, i.e. under the 61.7 mm edges): lip pointing into the LCD
    hk = (cq.Workplane("XY").workplane(offset=-(G_H + HOOK_H))
          .center(cx - sx * (G_L / 2 - G_T), cy - sy * HOOK_IN / 2).rect(G_L - 2, HOOK_IN).extrude(HOOK_H))
    plate = plate.union(a).union(b).union(hk)
cq.exporters.export(plate, OUT + "P2_top_plate.step"); cq.exporters.export(plate, OUT + "P2_top_plate.stl")

# ------------------------------------------------------------------ P3 TPU key cushion (1 mm)
GW, GH, WW, WH = 5 * PX, 3 * PY, 13.4, 15.26
cush = cq.Workplane("XY").rect(GW, GH, centered=False).extrude(1.0).edges("|Z").fillet(1.0)
for r in range(3):
    for c in range(5):
        cush = cush.cut(cq.Workplane("XY").center(c * PX + PX / 2, r * PY + PY / 2).rect(WW, WH).extrude(1.0).edges("|Z").fillet(1.0))
cq.exporters.export(cush, OUT + "P3_key_cushion_TPU.step"); cq.exporters.export(cush, OUT + "P3_key_cushion_TPU.stl")

# ------------------------------------------------------------------ P4 stand (12 deg), U-frame with a front lip
TILT = math.radians(12); tn = math.tan(TILT)
H0, RAIL, LIP = 3.0, 12.0, 4.0
prof = cq.Workplane("YZ").polyline([(-LIP - 2, 0), (D, 0), (D, H0 + D * tn), (0, H0), (0, H0 + LIP), (-LIP - 2, H0 + LIP)]).close()
full = prof.extrude(W)                                         # solid wedge incl. lip
keep = (cq.Workplane("XY").box(W, D + LIP + 2, 40, centered=(False, False, False)).translate((0, -LIP - 2, 0))
        .cut(cq.Workplane("XY").box(W - 2 * RAIL, D - 2 * RAIL, 40, centered=(True, True, False)).translate((W / 2, D / 2, 0))))   # frame only
stand = full.intersect(keep)
try:
    stand = stand.edges("|Z").fillet(2.0)
except Exception:
    pass
cq.exporters.export(stand, OUT + "P4_stand_12deg.step"); cq.exporters.export(stand, OUT + "P4_stand_12deg.stl")

# reference assembly: body + plate, sitting on the stand
bp = cq.Assembly()
bp.add(body, name="body", color=cq.Color(0.18, 0.18, 0.2))
bp.add(plate.translate((0, 0, H)), name="top_plate", color=cq.Color(0.86, 0.86, 0.83))
on_stand = cq.Assembly().add(stand, name="stand", color=cq.Color(0.3, 0.3, 0.33))
on_stand.add(bp, name="deck", loc=cq.Location(cq.Vector(0, 0, H0), cq.Vector(1, 0, 0), 12))
on_stand.save(OUT + "P0_assembly_on_stand.step")
for n, s in (("body", body), ("plate", plate), ("cushion", cush), ("stand", stand)):
    v = s.val().Volume() / 1000; bb = s.val().BoundingBox()
    print(f"{n:8s} {bb.xlen:6.1f} x {bb.ylen:6.1f} x {bb.zlen:5.1f} mm  {v:5.1f} cm3  ~{v*1.24:4.0f} g PLA")
print("body wall height", round(H, 1), "total thickness", round(TOTAL, 1), "on stand: back", round(H0 + D * tn + TOTAL * math.cos(TILT), 1))
