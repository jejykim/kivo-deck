"""Generate a KiCad 8 PCB (placement + nets, unrouted) for the DIY stream deck main board.

Coordinates: top-plate frame in mm. Origin = back-left corner of the 213 x 91 top plate,
x to the right, y toward the user (front). KiCad uses the same orientation (y down).
"""
import json
import uuid
import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Circle, FancyBboxPatch

U = lambda: str(uuid.uuid4())

# ---------------------------------------------------------------- nets
NETS = ["", "GND", "+3V3", "+5V",
        "LCD_CS", "LCD_DC", "LCD_RST", "SPI_MOSI", "SPI_SCK", "SPI_MISO", "TP_CS", "TP_IRQ",
        "ENC1_A", "ENC1_B", "ENC1_SW", "ENC2_A", "ENC2_B", "ENC2_SW",
        "FADER1", "FADER2", "SPARE_IO38", "USB_DP", "USB_DM"]
NID = {n: i for i, n in enumerate(NETS)}

footprints = []   # (ref, value, side_label, pads[(name, x, y, kind, size, drill, net)], outline)
preview = []      # drawing primitives for the PNG


def fp(ref, value, pads, outline=None, silk_layer="F.SilkS", label_xy=None):
    footprints.append(dict(ref=ref, value=value, pads=pads, outline=outline,
                           silk=silk_layer, label=label_xy))


def thp(name, x, y, net="", d=1.0, s=1.7, shape="circle"):
    return dict(name=name, x=x, y=y, kind="thru", shape=shape, size=(s, s), drill=d, net=net)


# ---------------------------------------------------------------- board geometry
PLATE_W, PLATE_D = 213.0, 91.0
PCB = (116.0, 6.5, 203.0, 84.5)          # x0, y0, x1, y1  (87 x 78 mm) - knobs/faders/ESP only

# ---------------------------------------------------------------- ESP32-S3 DevKitC (socketed, hangs under the PCB)
# Board face-down under the PCB, USB-C toward the left wall (x small), antenna toward x large.
# Back row (y=8.27) = right column of the board, front row (y=33.67) = left column.
ESP_X0, ESP_Y0 = 136.5, 13.0
back_row = ["GND", "TX", "RX", "1", "2", "42", "41", "40", "39", "38", "37", "36", "35", "0",
            "45", "48", "47", "21", "20", "19", "GND", "GND"]
front_row = ["3V3", "3V3", "RST", "4", "5", "6", "7", "15", "16", "17", "18", "8", "3", "46",
             "9", "10", "11", "12", "13", "14", "5V", "G"]
front_row[-1] = "GND"
GPIO_NET = {"10": "LCD_CS", "9": "LCD_DC", "8": "LCD_RST", "11": "SPI_MOSI", "12": "SPI_SCK",
            "13": "SPI_MISO", "16": "TP_CS", "15": "TP_IRQ",
            "4": "ENC1_A", "5": "ENC1_B", "6": "ENC1_SW",
            "17": "ENC2_A", "18": "ENC2_B", "21": "ENC2_SW",
            "1": "FADER1", "2": "FADER2", "38": "SPARE_IO38",
            "19": "USB_DM", "20": "USB_DP",
            "GND": "GND", "3V3": "+3V3", "5V": "+5V"}
esp_pads = []
for row, y, prefix in ((back_row, ESP_Y0 + 1.27, "R"), (front_row, ESP_Y0 + 1.27 + 25.4, "L")):
    for i, lab in enumerate(row):
        x = ESP_X0 + 1.905 + (21 - i) * 2.54          # i = 0 is the antenna end
        esp_pads.append(thp(f"{prefix}{i+1}", x, y, GPIO_NET.get(lab, ""), d=1.0, s=1.7))
fp("U1", "ESP32-S3-DevKitC N16R8 (socket, bottom)", esp_pads,
   outline=("rect", ESP_X0, ESP_Y0, ESP_X0 + 63.4, ESP_Y0 + 27.94), silk_layer="B.SilkS",
   label_xy=(ESP_X0 + 30, ESP_Y0 + 14))

# ---------------------------------------------------------------- LCD MSP4021 (rotated 180 deg, header on the right)
LCD = (7.5, 14.63, 115.5, 76.37)
LCD_PINS = ["+3V3", "GND", "LCD_CS", "LCD_RST", "LCD_DC", "SPI_MOSI", "SPI_SCK",
            "+3V3",          # 8 LED backlight -> always on
            "",              # 9 SDO (LCD MISO) not connected
            "SPI_SCK", "TP_CS", "SPI_MOSI", "SPI_MISO", "TP_IRQ"]
LCD_NAMES = ["VCC", "GND", "CS", "RESET", "DC", "SDI", "SCK", "LED", "SDO", "T_CLK", "T_CS",
             "T_DIN", "T_DO", "T_IRQ"]
lcd_x = 117.8      # J1 = wire pads, same order/orientation as the LCD header (1:1 wires)
lcd_y0 = 45.5 - 6.5 * 2.54
lcd_pads = [thp(str(i + 1), lcd_x, lcd_y0 + (13 - i) * 2.54, n, d=1.0, s=1.7,
                shape="rect" if i == 0 else "circle") for i, n in enumerate(LCD_PINS)]
fp("J1", "Wire pads to LCD MSP4021 header, 1:1 (pin1 VCC toward front)", lcd_pads,
   outline=("rect", lcd_x - 1.4, lcd_y0 - 1.4, lcd_x + 1.4, lcd_y0 + 13 * 2.54 + 1.4), label_xy=(lcd_x + 0.8, lcd_y0 - 6.2))

# ---------------------------------------------------------------- J2: wire pads to the USB-C breakout on the back wall
USB_PINS = [("5V", "+5V"), ("GND", "GND"), ("D-", "USB_DM"), ("D+", "USB_DP")]
usb_x0, usb_y = 119.0, 9.2
fp("J2", "Wire pads to USB-C breakout (back wall): 5V GND D- D+",
   [thp(nm, usb_x0 + k * 2.54, usb_y, net, d=1.0, s=1.7, shape="rect" if k == 0 else "circle")
    for k, (nm, net) in enumerate(USB_PINS)],
   outline=("rect", usb_x0 - 1.4, usb_y - 1.4, usb_x0 + 3 * 2.54 + 1.4, usb_y + 1.4), label_xy=(usb_x0 + 3.8, usb_y + 4.6))

# ---------------------------------------------------------------- EC11 rotary encoders with switch
ENC = [(128, 30), (128, 61)]   # 2 knobs, stacked (back / front)
for k, (cx, cy) in enumerate(ENC, start=1):
    pads = [thp("A", cx - 7.25, cy - 2.5, f"ENC{k}_A"),
            thp("C", cx - 7.25, cy, "GND"),
            thp("B", cx - 7.25, cy + 2.5, f"ENC{k}_B"),
            thp("S1", cx + 7.25, cy - 2.5, f"ENC{k}_SW"),
            thp("S2", cx + 7.25, cy + 2.5, "GND"),
            dict(name="MP", x=cx, y=cy - 5.7, kind="thru", shape="oval", size=(4.0, 2.4),
                 drill=("oval", 3.2, 1.5), net="GND"),
            dict(name="MP", x=cx, y=cy + 5.7, kind="thru", shape="oval", size=(4.0, 2.4),
                 drill=("oval", 3.2, 1.5), net="GND")]
    fp(f"SW{k}", "EC11 encoder w/ switch, 20mm half shaft", pads,
       outline=("rect", cx - 6, cy - 6.5, cx + 6, cy + 6.5), label_xy=(cx, cy))

# ---------------------------------------------------------------- Faders: dual B10K, 75 mm body, pins 71.5 mm apart
# Both ends get 4 pads (2.54 pitch) so the part fits whichever end carries 4 pins.
# ASSUMED gang-A pinout (verify with multimeter before ordering):
#   back end:  pad1 = track end -> GND, pad2 = wiper -> FADERn, pad3/4 = gang B (unused)
#   front end: pad6 = other track end -> +3V3, pads 5/7/8 unused
FADERS = [(164.5, "FADER1"), (188.5, "FADER2")]
for k, (fx, net) in enumerate(FADERS, start=1):
    yb, yf = 45.5 - 35.75, 45.5 + 35.75
    offs = [-3.81, -1.27, 1.27, 3.81]
    back = ["GND", net, "", ""]
    front = ["", "+3V3", "", ""]
    pads = [thp(str(i + 1), fx + o, yb, back[i], d=1.1, s=1.8) for i, o in enumerate(offs)]
    pads += [thp(str(i + 5), fx + o, yf, front[i], d=1.1, s=1.8) for i, o in enumerate(offs)]
    fp(f"RV{k}", "Slide pot dual B10K, 60mm travel, 75mm body", pads,
       outline=("rect", fx - 4.75, 8.0, fx + 4.75, 83.0), label_xy=(fx, 45.5))

# ---------------------------------------------------------------- 100 nF footprints (optional, 5.08 mm lead pitch)
caps = []
for k, (cx, cy) in enumerate(ENC, start=1):
    cy2 = cy - 11 if k == 1 else cy + 11      # caps above the back knob / below the front knob
    caps.append((f"C{2*k-1}", cx - 5.5, cy2, f"ENC{k}_A"))
    caps.append((f"C{2*k}", cx + 4.5, cy2, f"ENC{k}_B"))
caps.append(("C5", 176.5, 47.0, "FADER1"))
caps.append(("C6", 176.5, 56.0, "FADER2"))
for ref, x, y, net in caps:
    fp(ref, "100nF (optional)", [thp("1", x, y, net, d=0.8, s=1.5), thp("2", x, y + 5.08 if False else y, "GND", d=0.8, s=1.5)] if False else
       [thp("1", x - 2.54, y, net, d=0.8, s=1.5), thp("2", x + 2.54, y, "GND", d=0.8, s=1.5)],
       outline=("rect", x - 3.6, y - 1.2, x + 3.6, y + 1.2), label_xy=(x, y - 2.2))

# ---------------------------------------------------------------- mounting holes (M3 standoffs, PCB <-> top plate)
HOLES = [(131, 9.5), (176.5, 9.5), (199.5, 9.5), (119.5, 81), (176.5, 81), (199.5, 81), (146, 52)]
for k, (x, y) in enumerate(HOLES, start=1):
    fp(f"H{k}", "M3 mounting hole (standoff to top plate)",
       [dict(name="", x=x, y=y, kind="npth", shape="circle", size=(3.2, 3.2), drill=3.2, net="")],
       outline=("circle", x, y, 3.0))

# ---------------------------------------------------------------- sanity checks
all_pads = [(f["ref"], p) for f in footprints for p in f["pads"]]
x0, y0, x1, y1 = PCB
for ref, p in all_pads:
    r = max(p["size"]) / 2
    assert x0 + r - 0.01 <= p["x"] <= x1 - r + 0.01 and y0 + r - 0.01 <= p["y"] <= y1 - r + 0.01, (ref, p)
problems = []
for i in range(len(all_pads)):
    for j in range(i + 1, len(all_pads)):
        (ra, a), (rb, b) = all_pads[i], all_pads[j]
        d = math.hypot(a["x"] - b["x"], a["y"] - b["y"])
        if d < (max(a["size"]) + max(b["size"])) / 2 + 0.3:
            problems.append((ra, a["name"], rb, b["name"], round(d, 2)))
assert not problems, problems

# ---------------------------------------------------------------- write KiCad 8 board
def fmt(v):
    return f"{v:.4f}".rstrip("0").rstrip(".")


def pad_sexpr(p, fx, fy):
    lx, ly = p["x"] - fx, p["y"] - fy
    net = p["net"]
    net_s = f' (net {NID[net]} "{net}")' if net else ""
    if p["kind"] == "npth":
        return (f'(pad "" np_thru_hole circle (at {fmt(lx)} {fmt(ly)}) (size {fmt(p["size"][0])} {fmt(p["size"][1])}) '
                f'(drill {fmt(p["drill"])}) (layers "*.Cu" "*.Mask") (uuid "{U()}"))')
    d = p["drill"]
    drill = f'(drill oval {fmt(d[1])} {fmt(d[2])})' if isinstance(d, tuple) else f'(drill {fmt(d)})'
    return (f'(pad "{p["name"]}" thru_hole {p["shape"]} (at {fmt(lx)} {fmt(ly)}) '
            f'(size {fmt(p["size"][0])} {fmt(p["size"][1])}) {drill} (layers "*.Cu" "*.Mask"){net_s} (uuid "{U()}"))')


out = []
out.append('(kicad_pcb (version 20240108) (generator "pcbnew") (generator_version "8.0")')
out.append('  (general (thickness 1.6) (legacy_teardrops no))')
out.append('  (paper "A4")')
out.append('  (title_block (title "DIY Stream Deck main board") (rev "v0") (comment 1 "Unrouted: placement + nets"))')
out.append('  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (32 "B.Adhes" user "B.Adhesive") (33 "F.Adhes" user "F.Adhesive")'
           ' (34 "B.Paste" user) (35 "F.Paste" user) (36 "B.SilkS" user "B.Silkscreen") (37 "F.SilkS" user "F.Silkscreen")'
           ' (38 "B.Mask" user) (39 "F.Mask" user) (40 "Dwgs.User" user "User.Drawings") (41 "Cmts.User" user "User.Comments")'
           ' (44 "Edge.Cuts" user) (45 "Margin" user) (46 "B.CrtYd" user "B.Courtyard") (47 "F.CrtYd" user "F.Courtyard")'
           ' (48 "B.Fab" user) (49 "F.Fab" user))')
out.append('  (setup (pad_to_mask_clearance 0) (allow_soldermask_bridges_in_footprints no)'
           ' (pcbplotparams (layerselection 0x00010fc_ffffffff) (plot_on_all_layers_selection 0x0000000_00000000)'
           ' (disableapertmacros no) (usegerberextensions no) (usegerberattributes yes) (usegerberadvancedattributes yes)'
           ' (creategerberjobfile yes) (dashed_line_dash_ratio 12.000000) (dashed_line_gap_ratio 3.000000)'
           ' (svgprecision 4) (plotframeref no) (viasonmask no) (mode 1) (useauxorigin no) (hpglpennumber 1)'
           ' (hpglpenspeed 20) (hpglpendiameter 15.000000) (pdf_front_fp_property_popups yes) (pdf_back_fp_property_popups yes)'
           ' (dxfpolygonmode yes) (dxfimperialunits yes) (dxfusepcbnewfont yes) (psnegative no) (psa4output no)'
           ' (plotreference yes) (plotvalue yes) (plotfptext yes) (plotinvisibletext no) (sketchpadsonfab no)'
           ' (subtractmaskfromsilk no) (outputformat 1) (mirror no) (drillshape 1) (scaleselection 1) (outputdirectory "")))')
for i, n in enumerate(NETS):
    out.append(f'  (net {i} "{n}")')

for f in footprints:
    pads = f["pads"]
    fx = sum(p["x"] for p in pads) / len(pads)
    fy = sum(p["y"] for p in pads) / len(pads)
    lines = [f'  (footprint "streamdeck:{f["ref"]}" (layer "F.Cu") (uuid "{U()}") (at {fmt(fx)} {fmt(fy)})']
    lx, ly = (f["label"] or (fx, fy - 3))
    lines.append(f'    (property "Reference" "{f["ref"]}" (at {fmt(lx - fx)} {fmt(ly - fy)} 0) (layer "{f["silk"]}") (uuid "{U()}")'
                 f' (effects (font (size 1 1) (thickness 0.15)){" (justify mirror)" if f["silk"].startswith("B") else ""}))')
    lines.append(f'    (property "Value" "{f["value"]}" (at 0 0 0) (layer "F.Fab") (hide yes) (uuid "{U()}")'
                 f' (effects (font (size 1 1) (thickness 0.15))))')
    o = f["outline"]
    if o and o[0] == "rect":
        lines.append(f'    (fp_rect (start {fmt(o[1]-fx)} {fmt(o[2]-fy)}) (end {fmt(o[3]-fx)} {fmt(o[4]-fy)})'
                     f' (stroke (width 0.15) (type solid)) (fill none) (layer "{f["silk"]}") (uuid "{U()}"))')
    elif o and o[0] == "circle":
        lines.append(f'    (fp_circle (center {fmt(o[1]-fx)} {fmt(o[2]-fy)}) (end {fmt(o[1]-fx+o[3])} {fmt(o[2]-fy)})'
                     f' (stroke (width 0.15) (type solid)) (fill none) (layer "F.SilkS") (uuid "{U()}"))')
    for p in pads:
        lines.append("    " + pad_sexpr(p, fx, fy))
    lines.append("  )")
    out.extend(lines)

out.append(f'  (gr_rect (start {fmt(x0)} {fmt(y0)}) (end {fmt(x1)} {fmt(y1)}) (stroke (width 0.1) (type solid)) (fill none) (layer "Edge.Cuts") (uuid "{U()}"))')
out.append(f'  (gr_text "DIY STREAMDECK v2" (at 147 79 0) (layer "F.SilkS") (uuid "{U()}") (effects (font (size 1.2 1.2) (thickness 0.18))))')
out.append(f'  (gr_text "J1 pin1 = VCC (front)" (at 122 66 0) (layer "F.SilkS") (uuid "{U()}") (effects (font (size 1 1) (thickness 0.15))))')
out.append(")")
open("/home/claude/pcb/streamdeck_main.kicad_pcb", "w").write("\n".join(out) + "\n")

pro = {"meta": {"filename": "streamdeck_main.kicad_pro", "version": 1},
       "board": {"design_settings": {"defaults": {"board_outline_line_width": 0.1},
                 "rules": {"min_clearance": 0.2, "min_track_width": 0.2, "min_through_hole_diameter": 0.3}}},
       "net_settings": {"classes": [{"name": "Default", "clearance": 0.25, "track_width": 0.3, "via_diameter": 0.8, "via_drill": 0.4},
                                    {"name": "Power", "clearance": 0.25, "track_width": 0.6, "via_diameter": 0.8, "via_drill": 0.4}],
                        "netclass_patterns": [{"netclass": "Power", "pattern": "GND"}, {"netclass": "Power", "pattern": "+3V3"}]}}
json.dump(pro, open("/home/claude/pcb/streamdeck_main.kicad_pro", "w"), indent=2)

# ---------------------------------------------------------------- pin map CSV
with open("/home/claude/pcb/pinmap.csv", "w") as fh:
    fh.write("part,pin,net\n")
    for f in footprints:
        if f["ref"].startswith("H"):
            continue
        for p in f["pads"]:
            fh.write(f'{f["ref"]},{p["name"]},{p["net"] or "NC"}\n')

# ---------------------------------------------------------------- preview PNG
fig, ax = plt.subplots(figsize=(14, 6), dpi=130)
ax.add_patch(Rectangle((0, 0), PLATE_W, PLATE_D, fill=False, ls=":", lw=1, ec="#999"))
ax.add_patch(Rectangle((6, 6), PLATE_W - 12, PLATE_D - 12, fill=False, ls="--", lw=0.8, ec="#bbb"))
ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, fc="#2f6f4e", ec="#173d2a", lw=1.5, alpha=0.18))
colors = {"U1": "#1a9e77", "J": "#3b6fd6", "SW": "#555", "RV": "#d9622b", "C": "#b38f00", "H": "#666"}
for f in footprints:
    key = next(k for k in colors if f["ref"].startswith(k))
    c = colors[key]
    o = f["outline"]
    if o and o[0] == "rect":
        ax.add_patch(Rectangle((o[1], o[2]), o[3] - o[1], o[4] - o[2], fill=False, ec=c,
                               ls="--" if f["silk"].startswith("B") else "-", lw=1.3))
    for p in f["pads"]:
        if p["kind"] == "npth":
            ax.add_patch(Circle((p["x"], p["y"]), 1.6, fc="white", ec="#333", lw=1))
        else:
            ax.add_patch(Circle((p["x"], p["y"]), max(p["size"]) / 2, fc=c if p["net"] else "white", ec=c, lw=0.8))
    if f["label"]:
        ax.text(f["label"][0], f["label"][1], f["ref"], ha="center", va="center", fontsize=8, color=c, weight="bold")
ax.set_xlim(-4, PLATE_W + 4); ax.set_ylim(PLATE_D + 4, -4); ax.set_aspect("equal")
ax.set_title("Main PCB v0 (top view, mm) - solid: top side, dashed: ESP32 under board; filled pad = connected net", fontsize=10)
ax.set_xlabel("x (mm)  ->  right"); ax.set_ylabel("y (mm)  ->  front (user side)")
plt.tight_layout(); plt.savefig("/home/claude/pcb/pcb_preview.png")

print("footprints", len(footprints), "pads", len(all_pads), "nets", len(NETS) - 1)
used = {p["net"] for _, p in all_pads if p["net"]}
for n in NETS[1:]:
    cnt = sum(1 for _, p in all_pads if p["net"] == n)
    print(f"{n:12s} {cnt}")
