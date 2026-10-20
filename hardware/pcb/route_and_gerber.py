"""Auto-route the stream deck main board and write JLCPCB-ready Gerber + Excellon files.

Copper rules (JLCPCB 2-layer standard capability is finer than this):
  signal track 0.30 mm, power (+3V3) 0.50 mm, clearance 0.20 mm,
  via 0.80 / 0.40 mm drill, pour clearance 0.30 mm, edge clearance 0.50 mm.
GND is not routed: both layers get a GND pour with thermal reliefs.
"""
import contextlib, io, math, heapq, os, zipfile, sys
import numpy as np
from scipy import ndimage
from shapely.geometry import Point, LineString, Polygon, box, MultiPolygon
from shapely.ops import unary_union
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

with contextlib.redirect_stdout(io.StringIO()):
    import gen_pcb as G

OUT = "/home/claude/pcb/gerber"
os.makedirs(OUT, exist_ok=True)

g = 0.25
CLR = 0.20
POUR_CLR = 0.30
WMAX = 0.50
TRACK_W = {"+3V3": 0.50}
DEF_W = 0.30
VIA_D, VIA_DRILL = 0.80, 0.40
EDGE_KEEP = 0.50
x0, y0, x1, y1 = G.PCB
NW = int(round((x1 - x0) / g)) + 1
NH = int(round((y1 - y0) / g)) + 1

NETS = G.NETS
NID = G.NID

# ------------------------------------------------------------------ pads (absolute)
pads = []  # dict(ref, name, x, y, shape, size, drill, net, kind)
for f in G.footprints:
    for p in f["pads"]:
        q = dict(p)
        q["ref"] = f["ref"]
        pads.append(q)


def pad_geom(p, grow=0.0):
    w, h = p["size"]
    if p["kind"] == "npth":
        return Point(p["x"], p["y"]).buffer(w / 2 + grow, 32)
    if p["shape"] == "circle":
        return Point(p["x"], p["y"]).buffer(w / 2 + grow, 32)
    if p["shape"] == "rect":
        return box(p["x"] - w / 2 - grow, p["y"] - h / 2 - grow, p["x"] + w / 2 + grow, p["y"] + h / 2 + grow)
    # oval: stadium along the longer axis
    if w >= h:
        r = h / 2 + grow
        return LineString([(p["x"] - (w - h) / 2, p["y"]), (p["x"] + (w - h) / 2, p["y"])]).buffer(r, 32)
    r = w / 2 + grow
    return LineString([(p["x"], p["y"] - (h - w) / 2), (p["x"], p["y"] + (h - w) / 2)]).buffer(r, 32)


def pad_radius(p):
    return max(p["size"]) / 2


# ------------------------------------------------------------------ occupancy grids
own = [np.zeros((NW, NH), dtype=np.int32) for _ in range(2)]   # 0 free, n owner, -1 blocked
gx = x0 + np.arange(NW) * g
gy = y0 + np.arange(NH) * g


def _apply(L, sl_i, sl_j, mask, n):
    o = own[L][sl_i, sl_j]
    if n == -1:
        o[mask] = -1
        return
    free = mask & (o == 0)
    clash = mask & (o != 0) & (o != n)
    o[free] = n
    o[clash] = -1


def mark_seg(L, ax, ay, bx, by, R, n):
    lo_x, hi_x = min(ax, bx) - R, max(ax, bx) + R
    lo_y, hi_y = min(ay, by) - R, max(ay, by) + R
    i0, i1 = max(0, int(math.floor((lo_x - x0) / g))), min(NW - 1, int(math.ceil((hi_x - x0) / g)))
    j0, j1 = max(0, int(math.floor((lo_y - y0) / g))), min(NH - 1, int(math.ceil((hi_y - y0) / g)))
    if i1 < i0 or j1 < j0:
        return
    X = gx[i0:i1 + 1][:, None]
    Y = gy[j0:j1 + 1][None, :]
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 == 0:
        d = np.hypot(X - ax, Y - ay)
    else:
        t = np.clip(((X - ax) * dx + (Y - ay) * dy) / L2, 0, 1)
        d = np.hypot(X - (ax + t * dx), Y - (ay + t * dy))
    _apply(L, slice(i0, i1 + 1), slice(j0, j1 + 1), d <= R + 1e-9, n)


def mark_disk(L, x, y, R, n):
    mark_seg(L, x, y, x, y, R, n)


# board edge keep-out for track centrelines
m = int(math.ceil((EDGE_KEEP + WMAX / 2) / g))
for L in range(2):
    own[L][:m, :] = -1
    own[L][-m:, :] = -1
    own[L][:, :m] = -1
    own[L][:, -m:] = -1

for p in pads:
    n = NID[p["net"]] if p.get("net") else -1
    if p["kind"] == "npth":
        R = pad_radius(p) + 0.3 + WMAX / 2
        n = -1
    else:
        R = pad_radius(p) + CLR + WMAX / 2
    for L in range(2):
        if p["shape"] == "oval" and p["kind"] != "npth":
            w, h = p["size"]
            r = min(w, h) / 2
            if w >= h:
                mark_seg(L, p["x"] - (w - h) / 2, p["y"], p["x"] + (w - h) / 2, p["y"], r + CLR + WMAX / 2, n)
            else:
                mark_seg(L, p["x"], p["y"] - (h - w) / 2, p["x"], p["y"] + (h - w) / 2, r + CLR + WMAX / 2, n)
        else:
            mark_disk(L, p["x"], p["y"], R, n)

# ------------------------------------------------------------------ router
DIRS = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0),
        (1, 1, 1.4142), (1, -1, 1.4142), (-1, 1, 1.4142), (-1, -1, 1.4142)]
VIA_COST = 12.0
LAYER_COST = [1.0, 1.35]       # prefer top so the bottom GND pour stays whole
tracks = []   # (layer, [(x,y),...], width, net)
vias = []     # (x, y, net)


# vias may never sit on/near any pad or hole (same net included): keeps drill-to-drill spacing for the fab
via_forbid = np.zeros_like(own[0], dtype=bool)
_ii, _jj = np.meshgrid(np.arange(own[0].shape[0]), np.arange(own[0].shape[1]), indexing="ij")
for p in pads:
    R = pad_radius(p) + VIA_D / 2 + 0.35
    via_forbid |= np.hypot(x0 + _ii * g - p["x"], y0 + _jj * g - p["y"]) <= R
def cell_of(x, y):
    return int(round((x - x0) / g)), int(round((y - y0) / g))


def route(net, sources, targets):
    """sources/targets: sets of (L,i,j). Returns list of states or None."""
    n = NID[net]
    passable = [(own[L] == 0) | (own[L] == n) for L in range(2)]
    via_ok = ndimage.binary_erosion(passable[0] & passable[1], structure=np.ones((3, 3)), border_value=0) & ~via_forbid
    tlist = list(targets)

    def h(i, j):
        best = 1e9
        for (_, ti, tj) in tlist:
            dx, dy = abs(i - ti), abs(j - tj)
            best = min(best, max(dx, dy) + 0.4142 * min(dx, dy))
        return best

    openh = []
    gcost = {}
    came = {}
    for s in sources:
        gcost[s] = 0.0
        heapq.heappush(openh, (h(s[1], s[2]), 0.0, s))
    tset = set(targets)
    while openh:
        f, c, s = heapq.heappop(openh)
        if c > gcost.get(s, 1e18) + 1e-9:
            continue
        if s in tset:
            path = [s]
            while path[-1] in came:
                path.append(came[path[-1]])
            return path[::-1]
        L, i, j = s
        for di, dj, w in DIRS:
            ni, nj = i + di, j + dj
            if not (0 <= ni < NW and 0 <= nj < NH) or not passable[L][ni, nj]:
                continue
            if di and dj and not (passable[L][i + di, j] and passable[L][i, j + dj]):
                continue
            nc = c + w * LAYER_COST[L]
            ns = (L, ni, nj)
            if nc < gcost.get(ns, 1e18) - 1e-9:
                gcost[ns] = nc
                came[ns] = s
                heapq.heappush(openh, (nc + h(ni, nj) * min(LAYER_COST), nc, ns))
        if via_ok[i, j]:
            ns = (1 - L, i, j)
            nc = c + VIA_COST
            if nc < gcost.get(ns, 1e18) - 1e-9:
                gcost[ns] = nc
                came[ns] = s
                heapq.heappush(openh, (nc + h(i, j) * min(LAYER_COST), nc, ns))
    return None


def commit(net, path, w):
    n = NID[net]
    R = w / 2 + CLR + WMAX / 2
    run = [path[0]]
    for a, b in zip(path, path[1:]):
        if a[0] != b[0]:
            if len(run) > 1:
                pts = simplify([(x0 + q[1] * g, y0 + q[2] * g) for q in run])
                tracks.append((run[0][0], pts, w, net))
            vx, vy = x0 + a[1] * g, y0 + a[2] * g
            vias.append((vx, vy, net))
            for L in range(2):
                mark_disk(L, vx, vy, VIA_D / 2 + CLR + WMAX / 2, n)
            run = [b]
        else:
            run.append(b)
    if len(run) > 1:
        pts = simplify([(x0 + q[1] * g, y0 + q[2] * g) for q in run])
        tracks.append((run[0][0], pts, w, net))
    for (L, pts, ww, nn) in tracks[-(len(tracks)):]:
        pass
    # mark all segments of this path
    for t in [t for t in tracks if t[3] == net]:
        L, pts, ww, _ = t
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            mark_seg(L, ax, ay, bx, by, R, n)


def simplify(pts):
    out = [pts[0]]
    for k in range(1, len(pts) - 1):
        ax, ay = out[-1]
        bx, by = pts[k]
        cx, cy = pts[k + 1]
        if abs((bx - ax) * (cy - by) - (by - ay) * (cx - bx)) < 1e-9:
            continue
        out.append(pts[k])
    out.append(pts[-1])
    return out


net_pads = {}
for p in pads:
    if p["kind"] == "thru" and p.get("net") and p["net"] not in ("GND",):
        net_pads.setdefault(p["net"], []).append(p)
net_pads = {k: v for k, v in net_pads.items() if len(v) >= 2}
# J1 pin2 (LCD GND) sits at the board edge between signal pads; the pour can't reach it -> route it to SW2 "C" (GND)
_j1g = next(p for f in G.footprints if f["ref"] == "J1" for p in f["pads"] if p["name"] == "2")
_s2c = next(p for f in G.footprints if f["ref"] == "SW2" for p in f["pads"] if p["name"] == "C")
net_pads["GND"] = [next(p for p in pads if p["x"] == _j1g["x"] and p["y"] == _j1g["y"]),
                   next(p for p in pads if p["x"] == _s2c["x"] and p["y"] == _s2c["y"])]


def span(ps):
    xs = [p["x"] for p in ps]; ys = [p["y"] for p in ps]
    return (max(xs) - min(xs)) + (max(ys) - min(ys))


BASE = [o.copy() for o in own]


def run_routing(order):
    global tracks, vias
    tracks, vias = [], []
    own[0][:] = BASE[0]; own[1][:] = BASE[1]
    failed, stubs = [], []
    for net in order:
        ps = net_pads[net]
        w = TRACK_W.get(net, DEF_W)
        remaining = sorted(ps, key=lambda p: (p["x"], p["y"]))
        first = remaining.pop(0)
        ci, cj = cell_of(first["x"], first["y"])
        tree = {(L, ci, cj) for L in range(2)}
        stubs.append((first, (x0 + ci * g, y0 + cj * g), w))
        while remaining:
            def dist(p):
                pi, pj = cell_of(p["x"], p["y"])
                return min(abs(pi - t[1]) + abs(pj - t[2]) for t in tree)
            remaining.sort(key=dist)
            p = remaining.pop(0)
            pi, pj = cell_of(p["x"], p["y"])
            path = route(net, tree, {(L, pi, pj) for L in range(2)})
            if path is None:
                failed.append(net)
                continue
            commit(net, path, w)
            tree |= set(path)
            stubs.append((p, (x0 + pi * g, y0 + pj * g), w))
    return failed, stubs


order = ["+3V3"] + sorted([k for k in net_pads if k != "+3V3"], key=lambda k: span(net_pads[k]))
for attempt in range(8):
    failed, pad_stubs = run_routing(order)
    print(f"attempt {attempt}: failed {sorted(set(failed))}", file=sys.stderr)
    if not failed:
        break
    order = list(dict.fromkeys(sorted(set(failed)) + [k for k in order if k not in failed]))
failed = sorted(set(failed))

# ------------------------------------------------------------------ copper geometry per layer
def track_geoms(layer):
    out = []
    for (L, pts, w, net) in tracks:
        if L != layer:
            continue
        out.append((LineString(pts).buffer(w / 2, 16), net))
    for (p, (cx, cy), w) in pad_stubs:
        if (cx, cy) != (p["x"], p["y"]):
            out.append((LineString([(p["x"], p["y"]), (cx, cy)]).buffer(w / 2, 16), p["net"]))
    return out


copper = {}
for L in range(2):
    items = [(pad_geom(p), p.get("net") or f"NC:{p['ref']}:{p['name']}") for p in pads if p["kind"] == "thru"]
    items += track_geoms(L)
    items += [(Point(vx, vy).buffer(VIA_D / 2, 24), net) for (vx, vy, net) in vias]
    copper[L] = items

# ------------------------------------------------------------------ GND pour with thermals
board = box(x0, y0, x1, y1)
pour_area = board.buffer(-EDGE_KEEP, join_style=2)
holes_np = [pad_geom(p, 0.5) for p in pads if p["kind"] == "npth"]
gnd_pads = [p for p in pads if p["kind"] == "thru" and p.get("net") == "GND"]
pours = {}
for L in range(2):
    keep_out = [geo.buffer(POUR_CLR, 16) for geo, net in copper[L] if net != "GND"] + holes_np
    pour = pour_area.difference(unary_union(keep_out))
    rings = []
    for p in gnd_pads:
        pg = pad_geom(p)
        ring = pad_geom(p, 0.35).difference(pg)
        r = pad_radius(p) + 0.8
        spokes = unary_union([box(p["x"] - r, p["y"] - 0.25, p["x"] + r, p["y"] + 0.25),
                              box(p["x"] - 0.25, p["y"] - r, p["x"] + 0.25, p["y"] + r)])
        rings.append(ring.difference(spokes))
    pour = pour.difference(unary_union(rings))
    pour = pour.buffer(-0.12).buffer(0.12).intersection(pour)   # drop slivers, never grow
    polys = list(pour.geoms) if isinstance(pour, MultiPolygon) else [pour]
    gnd_union = unary_union([pad_geom(p) for p in gnd_pads])
    polys = [q for q in polys if q.intersects(gnd_union) and q.area > 2.0]
    pours[L] = polys

# ------------------------------------------------------------------ connectivity check (union-find)
parent = {}
def find(a):
    parent.setdefault(a, a)
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a
def union(a, b):
    parent[find(a)] = find(b)

elems = []  # (key, layer or 'both', geom, net)
for k, p in enumerate(pads):
    if p["kind"] == "thru":
        elems.append((("pad", k), "both", pad_geom(p), p.get("net") or f"NC{k}"))
for k, (L, pts, w, net) in enumerate(tracks):
    elems.append((("trk", k), L, LineString(pts).buffer(w / 2, 8), net))
for k, (p, (cx, cy), w) in enumerate(pad_stubs):
    elems.append((("stub", k), "both", LineString([(p["x"], p["y"]), (cx + 1e-6, cy)]).buffer(w / 2, 8), p["net"]))
for k, (vx, vy, net) in enumerate(vias):
    elems.append((("via", k), "both", Point(vx, vy).buffer(VIA_D / 2), net))
for L in range(2):
    for k, q in enumerate(pours[L]):
        elems.append((("pour", L, k), L, q, "GND"))

def same_layer(a, b):
    return a == "both" or b == "both" or a == b

shorts = []
for a in range(len(elems)):
    ka, la, ga, na = elems[a]
    for b in range(a + 1, len(elems)):
        kb, lb, gb, nb = elems[b]
        if not same_layer(la, lb) or not ga.envelope.buffer(0.3).intersects(gb.envelope):
            continue
        if na == nb:
            if ga.buffer(0.01).intersects(gb):
                union(ka, kb)
        else:
            dmin = ga.distance(gb)
            if dmin < CLR - 0.01:
                shorts.append((ka, na, kb, nb, round(dmin, 3)))

net_ok = {}
for net in set(p.get("net") for p in pads if p["kind"] == "thru" and p.get("net")):
    keys = {find(("pad", k)) for k, p in enumerate(pads) if p["kind"] == "thru" and p.get("net") == net}
    net_ok[net] = len(keys) == 1
    if len(keys) > 1:
        from collections import Counter
        cnt = Counter(find(("pad", k)) for k, p in enumerate(pads) if p["kind"] == "thru" and p.get("net") == net)
        main = cnt.most_common(1)[0][0]
        print("ISOLATED", net, [(p.get("name"), round(p["x"],2), round(p["y"],2)) for k, p in enumerate(pads)
               if p["kind"] == "thru" and p.get("net") == net and find(("pad", k)) != main])

# ------------------------------------------------------------------ silkscreen
FONT = FontProperties(family="DejaVu Sans", weight="bold")
def text_poly(s, x, y, h=1.2, anchor="center", mirror=False, rot=0):
    tp = TextPath((0, 0), s, size=h, prop=FONT)
    shape = Polygon()
    for ring in tp.to_polygons():
        if len(ring) < 3:
            continue
        shape = shape.symmetric_difference(Polygon(ring).buffer(0))
    minx, miny, maxx, maxy = shape.bounds
    w = maxx - minx
    dx = {"center": -minx - w / 2, "left": -minx, "right": -minx - w}[anchor]
    shape = affinity.translate(shape, dx, -(miny + (maxy - miny) / 2))
    shape = affinity.scale(shape, -1 if mirror else 1, -1, origin=(0, 0))   # board y points down
    if rot:
        shape = affinity.rotate(shape, rot, origin=(0, 0))
    return affinity.translate(shape, x, y)

silk = {0: [], 1: []}   # 0 = F.SilkS, 1 = B.SilkS
def silk_rect(L, a, b, c, d):
    silk[L].append(LineString([(a, b), (c, b), (c, d), (a, d), (a, b)]).buffer(0.08, 8))

for f in G.footprints:
    L = 1 if f["silk"].startswith("B") else 0
    o = f["outline"]
    if o and o[0] == "rect" and not f["ref"].startswith("C"):
        silk_rect(L, o[1], o[2], o[3], o[4])
    if f["label"] and not f["ref"].startswith("H"):
        lx, ly = f["label"]
        silk[L].append(text_poly(f["ref"], lx, ly, 1.4 if not f["ref"].startswith("C") else 1.0, mirror=(L == 1)))
# J1 / J2 labels (full pin list is in the plan doc)
silk[0].append(text_poly("1=VCC", G.lcd_x - 1.0, G.lcd_y0 + 13 * 2.54 + 3.5, 1.0, anchor="left"))
silk[0].append(text_poly("14=T_IRQ", G.lcd_x - 1.0, G.lcd_y0 - 3.5, 1.0, anchor="left"))
# fader end notes
for fx, net in G.FADERS:
    silk[0].append(text_poly("GND/" + net[-1], fx, 45.5 - 35.75 + 2.6, 1.0))
    silk[0].append(text_poly("3V3", fx, 45.5 + 35.75 - 2.6, 1.0))
silk[1].append(text_poly("ESP32 SOCKET (BOTTOM)", 166.5, 31.5, 1.2, mirror=True))
silk[0].append(text_poly("J1 -> LCD (1:1)", 124.5, 45.5, 1.0, anchor="left"))
for k, (nm, net) in enumerate(G.USB_PINS):
    silk[0].append(text_poly(nm, G.usb_x0 + k * 2.54, G.usb_y + 2.4, 0.9))
silk[1].append(text_poly("DIY STREAMDECK v2  2026-10", 160, 47, 1.2, mirror=True))

mask_open = unary_union([pad_geom(p, 0.05) for p in pads if p["kind"] == "thru"] +
                        [pad_geom(p, 0.1) for p in pads if p["kind"] == "npth"])
for L in range(2):
    via_keep = unary_union([Point(vx, vy).buffer(VIA_D / 2 + 0.25, 16) for (vx, vy, _) in vias]) if vias else Polygon()
    s = unary_union(silk[L]).difference(mask_open.buffer(0.3)).difference(via_keep).intersection(board.buffer(-0.3))
    silk[L] = s

# ------------------------------------------------------------------ Gerber writer
def fmtc(v):
    return str(int(round(v * 1e6)))

class Gerber:
    def __init__(self, name, func):
        self.lines = ["%TF.GenerationSoftware,Claude,streamdeck-gen,1.0*%",
                      f"%TF.FileFunction,{func}*%", "%FSLAX46Y46*%", "%MOMM*%", "%LPD*%"]
        self.aps = {}
        self.body = []
        self.cur = None
        self.name = name
    def ap(self, kind, a, b=None):
        key = (kind, round(a, 4), round(b, 4) if b else None)
        if key not in self.aps:
            d = 10 + len(self.aps)
            self.aps[key] = d
            if kind == "C":
                self.lines.append(f"%ADD{d}C,{a:.4f}*%")
            else:
                self.lines.append(f"%ADD{d}{kind},{a:.4f}X{b:.4f}*%")
        return self.aps[key]
    def select(self, d):
        if self.cur != d:
            self.body.append(f"D{d}*")
            self.cur = d
    def flash(self, d, x, y):
        self.select(d)
        self.body.append(f"X{fmtc(x)}Y{fmtc(-y)}D03*")
    def line(self, d, pts):
        self.select(d)
        self.body.append(f"X{fmtc(pts[0][0])}Y{fmtc(-pts[0][1])}D02*")
        for x, y in pts[1:]:
            self.body.append(f"X{fmtc(x)}Y{fmtc(-y)}D01*")
    def region(self, coords, dark=True):
        self.body.append("%LPD*%" if dark else "%LPC*%")
        self.body.append("G36*")
        c = list(coords)
        self.body.append(f"X{fmtc(c[0][0])}Y{fmtc(-c[0][1])}D02*")
        for x, y in c[1:]:
            self.body.append(f"X{fmtc(x)}Y{fmtc(-y)}D01*")
        self.body.append("G37*")
        if not dark:
            self.body.append("%LPD*%")
    def polygon(self, poly):
        self.region(poly.exterior.coords, True)
        for hole in poly.interiors:
            self.region(hole.coords, False)
    def save(self):
        with open(os.path.join(OUT, self.name), "w") as fh:
            fh.write("\n".join(self.lines + ["G01*", "G75*"] + self.body + ["M02*"]) + "\n")


def flash_pad(gb, p, grow=0.0):
    w, h = p["size"]
    if p["shape"] == "circle" or p["kind"] == "npth":
        gb.flash(gb.ap("C", w + 2 * grow), p["x"], p["y"])
    elif p["shape"] == "rect":
        gb.flash(gb.ap("R", w + 2 * grow, h + 2 * grow), p["x"], p["y"])
    else:
        gb.flash(gb.ap("O", w + 2 * grow, h + 2 * grow), p["x"], p["y"])

for L, (fname, func) in enumerate([("streamdeck-F_Cu.gtl", "Copper,L1,Top"), ("streamdeck-B_Cu.gbl", "Copper,L2,Bot")]):
    gb = Gerber(fname, func)
    for q in sorted(pours[L], key=lambda q: -q.area):
        gb.polygon(q)
    for p in pads:
        if p["kind"] == "thru":
            flash_pad(gb, p)
    for (LL, pts, w, net) in tracks:
        if LL == L:
            gb.line(gb.ap("C", w), pts)
    for (p, (cx, cy), w) in pad_stubs:
        gb.line(gb.ap("C", w), [(p["x"], p["y"]), (cx, cy)])
    for (vx, vy, net) in vias:
        gb.flash(gb.ap("C", VIA_D), vx, vy)
    gb.save()

for L, (fname, func) in enumerate([("streamdeck-F_Mask.gts", "Soldermask,Top"), ("streamdeck-B_Mask.gbs", "Soldermask,Bot")]):
    gb = Gerber(fname, func)
    for p in pads:
        flash_pad(gb, p, 0.05 if p["kind"] == "thru" else 0.1)
    gb.save()

for L, (fname, func) in enumerate([("streamdeck-F_Silkscreen.gto", "Legend,Top"), ("streamdeck-B_Silkscreen.gbo", "Legend,Bot")]):
    gb = Gerber(fname, func)
    s = silk[L]
    for q in (list(s.geoms) if hasattr(s, "geoms") else [s]):
        if isinstance(q, Polygon) and not q.is_empty:
            gb.polygon(q)
    gb.save()

gb = Gerber("streamdeck-Edge_Cuts.gm1", "Profile,NP")
gb.line(gb.ap("C", 0.1), [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)])
gb.save()

def excellon(fname, holes, slots, plated):
    tools = {}
    for d in [h[2] for h in holes] + [s[4] for s in slots]:
        tools.setdefault(round(d, 3), len(tools) + 1)
    lines = ["M48", "; DRILL file streamdeck  " + ("PTH" if plated else "NPTH"),
             "; FORMAT={-:-/ absolute / metric / decimal}",
             f"; #@! TF.FileFunction,{'Plated' if plated else 'NonPlated'},1,2,{'PTH' if plated else 'NPTH'}",
             "FMAT,2", "METRIC"]
    for d, t in tools.items():
        lines.append(f"T{t}C{d:.3f}")
    lines += ["%", "G90", "G05"]
    for d, t in tools.items():
        lines.append(f"T{t}")
        for (x, y, dd) in holes:
            if round(dd, 3) == d:
                lines.append(f"X{x:.3f}Y{-y:.3f}")
        for (ax, ay, bx, by, dd) in slots:
            if round(dd, 3) == d:
                lines.append(f"X{ax:.3f}Y{-ay:.3f}G85X{bx:.3f}Y{-by:.3f}")
    lines.append("M30")
    open(os.path.join(OUT, fname), "w").write("\n".join(lines) + "\n")

pth, slots = [], []
for p in pads:
    if p["kind"] != "thru":
        continue
    d = p["drill"]
    if isinstance(d, tuple):            # ("oval", w, h) slot
        _, sw, sh = d
        if sw >= sh:
            slots.append((p["x"] - (sw - sh) / 2, p["y"], p["x"] + (sw - sh) / 2, p["y"], sh))
        else:
            slots.append((p["x"], p["y"] - (sh - sw) / 2, p["x"], p["y"] + (sh - sw) / 2, sw))
    else:
        pth.append((p["x"], p["y"], d))
pth += [(vx, vy, VIA_DRILL) for (vx, vy, _) in vias]
excellon("streamdeck-PTH.drl", pth, slots, True)
excellon("streamdeck-NPTH.drl", [(p["x"], p["y"], p["drill"]) for p in pads if p["kind"] == "npth"], [], False)

zpath = "/home/claude/pcb/streamdeck_gerber_jlcpcb.zip"
with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
    for fn in sorted(os.listdir(OUT)):
        z.write(os.path.join(OUT, fn), fn)

# ------------------------------------------------------------------ preview
fig, axes = plt.subplots(2, 1, figsize=(15, 11), dpi=120)
for L, ax in enumerate(axes):
    ax.add_patch(plt.Rectangle((x0, y0), x1 - x0, y1 - y0, fc="#0d3b26", ec="k"))
    for q in pours[L]:
        xs, ys = q.exterior.xy
        ax.fill(xs, ys, color="#b87333", alpha=0.35, lw=0)
        for hole in q.interiors:
            hx, hy = hole.xy
            ax.fill(hx, hy, color="#0d3b26", lw=0)
    for (LL, pts, w, net) in tracks:
        if LL == L:
            xs, ys = zip(*pts)
            ax.plot(xs, ys, color="#e8a34a" if net != "+3V3" else "#ff5544", lw=w * 4.2, solid_capstyle="round")
    for (p, (cx, cy), w) in pad_stubs:
        ax.plot([p["x"], cx], [p["y"], cy], color="#e8a34a", lw=w * 4.2)
    s = silk[L]
    for q in (list(s.geoms) if hasattr(s, "geoms") else [s]):
        if isinstance(q, Polygon) and not q.is_empty:
            from matplotlib.path import Path as _P
            from matplotlib.patches import PathPatch as _PP
            verts, codes = [], []
            for ring in [q.exterior] + list(q.interiors):
                cs = list(ring.coords)
                verts += cs; codes += [_P.MOVETO] + [_P.LINETO] * (len(cs) - 2) + [_P.CLOSEPOLY]
            ax.add_patch(_PP(_P(verts, codes), fc="white", lw=0))
    for p in pads:
        geo = pad_geom(p)
        xs, ys = geo.exterior.xy
        ax.fill(xs, ys, color="#d9d9d9" if p["kind"] == "thru" else "white", lw=0)
    for (vx, vy, _) in vias:
        ax.add_patch(plt.Circle((vx, vy), VIA_D / 2, color="#cfcfcf"))
    ax.set_xlim(x0 - 2, x1 + 2); ax.set_ylim(y1 + 2, y0 - 2); ax.set_aspect("equal")
    ax.set_title(["TOP copper + silkscreen (seen from above)", "BOTTOM copper (seen from above, through the board)"][L])
plt.tight_layout()
plt.savefig("/home/claude/pcb/routed_preview.png")

print("tracks", len(tracks), "vias", len(vias))
print("FAILED", failed)
print("SHORTS", shorts[:10], len(shorts))
print("NETS NOT CONNECTED", [n for n, ok in net_ok.items() if not ok])
print("zip", zpath)
