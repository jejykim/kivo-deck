#include <LittleFS.h>
#include <AnimatedGIF.h>
#include <vector>
#include "config.h"
#include "display.h"
#include "deck.h"

// ------------------------------------------------------------------ memory helpers (PSRAM)
struct SpiRamAllocator : ArduinoJson::Allocator {
  void *allocate(size_t n) override { return heap_caps_malloc(n, MALLOC_CAP_SPIRAM); }
  void deallocate(void *p) override { heap_caps_free(p); }
  void *reallocate(void *p, size_t n) override { return heap_caps_realloc(p, n, MALLOC_CAP_SPIRAM); }
};
static SpiRamAllocator spiAlloc;

struct Blob {
  uint8_t *data = nullptr;
  size_t len = 0;
  void clear() { if (data) heap_caps_free(data); data = nullptr; len = 0; }
  bool set(const uint8_t *src, size_t n) {
    clear();
    data = (uint8_t *)heap_caps_malloc(n, MALLOC_CAP_SPIRAM);
    if (!data) return false;
    memcpy(data, src, n); len = n;
    return true;
  }
  bool load(const char *path) {
    clear();
    File f = LittleFS.open(path, "r");
    if (!f) return false;
    len = f.size();
    data = (uint8_t *)heap_caps_malloc(len, MALLOC_CAP_SPIRAM);
    if (!data) { f.close(); len = 0; return false; }
    f.read(data, len);
    f.close();
    return true;
  }
};

// ------------------------------------------------------------------ state
static JsonDocument cfg(&spiAlloc);
static bool loaded = false;
static String hash;
static int cur = 0;
static int stack[PAGE_STACK];
static int depth = 0;
static std::vector<uint16_t> toggles;      // per page: bit k = key k is "on"
static Blob pageJpg;
static Blob onTile[KEY_COUNT];
static Blob liveTile[KEY_COUNT];
static int liveTilePage = -1;

static int downKey = -1, pendKey = -1;
static uint32_t downAt = 0, pendAt = 0;
static bool longFired = false;

static bool saverOn = false;
static uint32_t lastInput = 0;

struct Gif {
  AnimatedGIF *g = nullptr;
  Blob file;
  int x = 0, y = 0, w = 0, h = 0;
  uint32_t nextAt = 0;
};
static Gif gifs[MAX_GIFS];
static int gifCount = 0;

// ------------------------------------------------------------------ geometry (same as app/src/render.ts)
static void keyRect(int k, int &x, int &y, int &w, int &h) {
  int c = k % KEY_COLS, r = k / KEY_COLS;
  int y0 = (int)lroundf(r * 320.0f / KEY_ROWS), y1 = (int)lroundf((r + 1) * 320.0f / KEY_ROWS);
  x = c * (480 / KEY_COLS); w = 480 / KEY_COLS; y = y0; h = y1 - y0;
}

static JsonObjectConst pageCfg(int p) { return cfg["pages"][p]; }
static JsonObjectConst keyCfg(int k) { return pageCfg(cur)["keys"][k]; }
static int pageCount() { return loaded ? cfg["pages"].size() : 0; }
static bool isOn(int p, int k) { return p < (int)toggles.size() && (toggles[p] >> k & 1); }

// ------------------------------------------------------------------ drawing
static const uint16_t TILE_COLORS[5] = { 0x2C1B, 0xD1C5, 0x3D2B, 0xE544, 0x8ABA };

static void drawDefaultKey(int k, bool down) {
  int x, y, w, h; keyRect(k, x, y, w, h);
  uint16_t col = TILE_COLORS[(k % KEY_COLS + k / KEY_COLS) % 5];
  lcd.fillRect(x, y, w, h, TFT_BLACK);
  lcd.fillRoundRect(x + 6, y + 6, w - 12, h - 12, 12, down ? TFT_WHITE : col);
  lcd.setTextColor(down ? TFT_BLACK : TFT_WHITE);
  lcd.setTextDatum(textdatum_t::middle_center);
  lcd.setTextSize(2);
  lcd.drawNumber(k + 1, x + w / 2, y + h / 2);
}

// Redraws one key from the page picture, its toggle "on" tile or the last live tile
static void drawKey(int k) {
  if (!loaded) { drawDefaultKey(k, false); return; }
  int x, y, w, h; keyRect(k, x, y, w, h);
  if (isOn(cur, k)) {
    const char *on = keyCfg(k)["on"];
    if (on && !onTile[k].data) onTile[k].load(on);
    if (onTile[k].data) { lcd.drawJpg(onTile[k].data, onTile[k].len, x, y, w, h); return; }
  }
  if (liveTilePage == cur && liveTile[k].data) { lcd.drawJpg(liveTile[k].data, liveTile[k].len, x, y, w, h); return; }
  if (pageJpg.data) lcd.drawJpg(pageJpg.data, pageJpg.len, x, y, w, h, x, y);
  else lcd.fillRect(x, y, w, h, TFT_BLACK);
}

static void drawPressed(int k) {
  if (!loaded) { drawDefaultKey(k, true); return; }
  int x, y, w, h; keyRect(k, x, y, w, h);
  for (int i = 3; i < 6; i++) lcd.drawRoundRect(x + i, y + i, w - 2 * i, h - 2 * i, 10, TFT_WHITE);
}

// AnimatedGIF draws one line at a time; pUser is our Gif (for the screen offset)
static void gifDraw(GIFDRAW *d) {
  Gif *gf = (Gif *)d->pUser;
  int y = gf->y + d->iY + d->y;
  int x = gf->x + d->iX;
  int w = min(d->iWidth, gf->w - d->iX);
  if (w <= 0 || d->iY + d->y >= gf->h) return;
  static uint16_t line[480];
  const uint8_t *src = d->pPixels;
  const uint16_t *pal = d->pPalette;
  if (d->ucHasTransparency) {
    // draw the opaque runs only
    int run = 0, start = 0;
    for (int i = 0; i < w; i++) {
      if (src[i] == d->ucTransparent) {
        if (run) lcd.pushImage(x + start, y, run, 1, (lgfx::rgb565_t *)line + start);
        run = 0; start = i + 1;
      } else { line[i] = pal[src[i]]; run++; }
    }
    if (run) lcd.pushImage(x + start, y, run, 1, (lgfx::rgb565_t *)line + start);
  } else {
    for (int i = 0; i < w; i++) line[i] = pal[src[i]];
    lcd.pushImage(x, y, w, 1, (lgfx::rgb565_t *)line);
  }
}

void deck::stopAnimations() {
  for (int i = 0; i < gifCount; i++) {
    if (gifs[i].g) gifs[i].g->close();
    gifs[i].file.clear();
  }
  gifCount = 0;
}

static void startAnimations() {
  for (JsonObjectConst g : pageCfg(cur)["gifs"].as<JsonArrayConst>()) {
    if (gifCount >= MAX_GIFS) break;
    Gif &gf = gifs[gifCount];
    if (!gf.g) {
      void *mem = heap_caps_malloc(sizeof(AnimatedGIF), MALLOC_CAP_SPIRAM);
      if (!mem) break;
      gf.g = new (mem) AnimatedGIF();
      gf.g->begin(GIF_PALETTE_RGB565_LE);
    }
    if (!gf.file.load(g["f"] | "")) continue;
    if (!gf.g->open(gf.file.data, gf.file.len, gifDraw)) { gf.file.clear(); continue; }
    gf.x = g["x"]; gf.y = g["y"]; gf.w = g["w"]; gf.h = g["h"];
    gf.nextAt = 0;
    gifCount++;
  }
}

void deck::drawPage() {
  stopAnimations();
  if (saverOn) return;
  if (!loaded) {
    lcd.fillScreen(TFT_BLACK);
    for (int k = 0; k < KEY_COUNT; k++) drawDefaultKey(k, false);
    return;
  }
  for (auto &t : onTile) t.clear();
  if (liveTilePage != cur) { for (auto &t : liveTile) t.clear(); liveTilePage = cur; }
  if (pageJpg.load(pageCfg(cur)["img"] | "")) lcd.drawJpg(pageJpg.data, pageJpg.len, 0, 0);
  else lcd.fillScreen(TFT_BLACK);
  for (int k = 0; k < KEY_COUNT; k++) if (isOn(cur, k) || liveTile[k].data) drawKey(k);
  startAnimations();
}

void deck::drawTile(int p, int k, const uint8_t *jpg, size_t len) {
  if (!loaded || p != cur || k < 0 || k >= KEY_COUNT) return;
  liveTilePage = cur;
  liveTile[k].set(jpg, len);
  if (!saverOn && !isOn(cur, k)) {
    drawKey(k);
    if (k == downKey) drawPressed(k);
  }
}

// ------------------------------------------------------------------ config
bool deck::reload() {
  stopAnimations();
  loaded = false;
  cfg.clear();
  File f = LittleFS.open("/b/config.json", "r");
  if (f) {
    DeserializationError e = deserializeJson(cfg, f);
    f.close();
    loaded = !e && cfg["pages"].size() > 0;
  }
  File h = LittleFS.open("/b/hash.txt", "r");
  hash = h ? h.readString() : "";
  if (h) h.close();
  if (!loaded) hash = "";
  toggles.assign(pageCount(), 0);
  cur = 0; depth = 0;
  pendKey = -1;
  return loaded;
}

void deck::begin() {
  if (!LittleFS.begin(true)) return;   // formats on first boot
  reload();
  lastInput = millis();
}

bool deck::hasBundle() { return loaded; }
String deck::bundleHash() { return hash; }
int deck::page() { return cur; }

// ------------------------------------------------------------------ pages
void deck::gotoPage(int n, bool fromApp) {
  if (!loaded || n < 0 || n >= pageCount()) return;
  if (n == cur) return;
  if (pageCfg(n)["folder"] | 0) {
    if (depth < PAGE_STACK) stack[depth++] = cur;
  } else {
    depth = 0;
  }
  cur = n;
  pendKey = -1;
  drawPage();
  char b[48]; snprintf(b, sizeof b, "{\"ev\":\"page\",\"n\":%d}", cur);
  pc::send(b);
  (void)fromApp;
}

// next / prev cycle through normal pages; folders are only entered from a key
static void stepPage(int dir) {
  int n = pageCount();
  int base = depth ? stack[0] : cur;
  for (int i = 1; i <= n; i++) {
    int p = ((base + dir * i) % n + n) % n;
    if (!(pageCfg(p)["folder"] | 0)) { depth = 0; deck::gotoPage(p, false); return; }
  }
}

static void back() {
  if (!depth) return;
  int p = stack[--depth];
  cur = -1;   // force redraw in gotoPage without pushing
  int keep = depth;
  deck::gotoPage(p, false);
  depth = keep;
}

// ------------------------------------------------------------------ actions
static void runAction(JsonVariantConst a, const char *src, int id, const char *kind, int n) {
  if (a.isNull()) return;
  JsonVariantConst p = a["p"];
  if (!p.isNull()) {
    if (p.is<int>()) deck::gotoPage(p.as<int>(), false);
    else if (p == "next") stepPage(1);
    else if (p == "prev") stepPage(-1);
    else if (p == "back") back();
    return;
  }
  if (a["a"].is<int>()) { pc::act(src, id, cur, kind, n); return; }
  for (int i = 0; i < min(n, 10); i++) hidout::run(a);
}

static void tap(int k) {
  JsonObjectConst kc = keyCfg(k);
  if (kc["tg"] | 0) {
    bool on = isOn(cur, k);
    bool hasOff = !kc["off"].isNull();
    // flip first so a page change by the action does not hit the wrong page's bits
    toggles[cur] ^= (1 << k);
    drawKey(k);
    runAction(on && hasOff ? kc["off"] : kc["tap"], "key", k, on && hasOff ? "off" : "tap", 1);
  } else {
    runAction(kc["tap"], "key", k, "tap", 1);
  }
}

// ------------------------------------------------------------------ inputs
void deck::touchActivity() { lastInput = millis(); }

bool deck::wakeIfSleeping() {
  lastInput = millis();
  if (!saverOn) return false;
  saverOn = false;
  drawPage();
  return true;
}

void deck::keyDown(int k) {
  downKey = k; downAt = millis(); longFired = false;
  drawPressed(k);
  if (!loaded) hidout::defaultKey(k, true);
}

void deck::keyUp(int k) {
  if (downKey == k) downKey = -1;
  if (!loaded) { hidout::defaultKey(k, false); drawDefaultKey(k, false); return; }
  drawKey(k);
  if (longFired) return;
  JsonObjectConst kc = keyCfg(k);
  if (!kc["dbl"].isNull()) {
    if (pendKey == k && millis() - pendAt <= DOUBLE_TAP_MS) {
      pendKey = -1;
      runAction(kc["dbl"], "key", k, "dbl", 1);
    } else {
      if (pendKey >= 0) tap(pendKey);
      pendKey = k; pendAt = millis();
    }
  } else {
    tap(k);
  }
}

void deck::knobTurn(int id, int d, bool pressed) {
  if (!loaded) {
    if (id == 0) for (int i = 0; i < abs(d); i++) hidout::consumer(d > 0 ? 0xE9 : 0xEA);   // volume up / down
    return;
  }
  JsonObjectConst kn = cfg["knobs"][id];
  const char *kind = pressed ? (d > 0 ? "pcw" : "pccw") : (d > 0 ? "cw" : "ccw");
  runAction(kn[kind], "knob", id, kind, abs(d));
}

void deck::knobPress(int id, bool down, bool turned) {
  if (!loaded) {
    if (id == 0 && down) hidout::consumer(0xE2);   // mute
    return;
  }
  // press runs on release, and not at all if the knob was turned while held
  if (!down && !turned) runAction(cfg["knobs"][id]["pr"], "knob", id, "pr", 1);
}

void deck::tick() {
  uint32_t now = millis();
  if (loaded && downKey >= 0 && !longFired && now - downAt >= LONG_PRESS_MS) {
    JsonVariantConst lp = keyCfg(downKey)["long"];
    if (!lp.isNull()) { longFired = true; runAction(lp, "key", downKey, "long", 1); }
  }
  if (pendKey >= 0 && now - pendAt > DOUBLE_TAP_MS) {
    int k = pendKey; pendKey = -1;
    tap(k);
  }
  int saver = loaded ? (cfg["saver"] | 0) : 0;
  if (saver > 0 && !saverOn && downKey < 0 && now - lastInput > (uint32_t)saver * 60000UL) {
    saverOn = true;
    stopAnimations();
    lcd.fillScreen(TFT_BLACK);
  }
  if (saverOn) return;
  for (int i = 0; i < gifCount; i++) {
    Gif &gf = gifs[i];
    if (now < gf.nextAt) continue;
    int delayMs = 100;
    if (gf.g->playFrame(false, &delayMs, &gf) == 0) gf.g->reset();
    gf.nextAt = now + max(delayMs, 20);
  }
  if (downKey >= 0 && gifCount) drawPressed(downKey);   // keep the border over animated keys
}
