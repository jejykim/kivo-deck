// Kivo Deck firmware
//  - Reads the 15 touch keys, 2 knobs (turn / press / press+turn) and 2 faders
//  - Runs the actions of the bundle the PC app uploaded (deck.cpp); without one: F13.. keys and
//    knob 1 = volume / mute
//  - Every input is also reported over USB serial as one JSON line (docs/protocol.md, link.cpp)
//  - Touch calibration: first boot asks for it (press knob 1), later hold both knobs while plugging in,
//    or send {"cmd":"calibrate"}. Touch stays off until calibrated, so a bare ESP32 sends no phantom keys.
#include <Arduino.h>
#include <USB.h>
#include <Preferences.h>
#include <LittleFS.h>
#include "config.h"
#include "pins.h"
#include "display.h"
#include "input.h"
#include "deck.h"

LGFX lcd;
static Preferences prefs;
static Encoder enc[2];
static Fader fader[2];

static int pressedKey = -1;
static bool swallowKey = false;          // the touch that woke the screen does nothing else
static bool touchReady = false;

// Touch feel, tuned per board from the app and kept in NVS. A resistive panel reports jumpy points
// while the finger lifts, so by default a press stays on the key it started on.
struct TouchTuning {
  uint16_t pressMs = 30;     // the point must stay on one key this long before it counts
  uint16_t releaseMs = 60;   // no touch for this long before the key is released
  uint16_t minZ = 0;         // lighter touches are ignored (pressure, roughly 0..60)
  uint16_t edge = 6;         // a press cannot start this close (px) to a key border
  uint16_t slide = 0;        // 1 = moving onto another key while held switches to it
};
static TouchTuning tune;
static int candKey = -1;                 // key the touch is on, not yet pressed
static uint32_t candSince = 0, lastTouchAt = 0;
static uint32_t watchUntil = 0, lastWatchAt = 0;
static bool watchTouching = false;
static bool turnedWhilePressed[2] = { false, false };
static bool swallowKnob[2] = { false, false };
static char deviceId[13];

static int keyAt(int tx, int ty) {
  if (tx < 0 || ty < 0 || tx >= lcd.width() || ty >= lcd.height()) return -1;
  return (ty * KEY_ROWS / lcd.height()) * KEY_COLS + (tx * KEY_COLS / lcd.width());
}

// -1 when the point lies within `edge` px of a key border
static int keyInside(int tx, int ty, int edge) {
  int k = keyAt(tx, ty);
  if (k < 0 || edge <= 0) return k;
  int w = lcd.width(), h = lcd.height();
  int cx = tx * KEY_COLS % w, cy = ty * KEY_ROWS % h;   // position inside the key, scaled by cols/rows
  if (cx < edge * KEY_COLS || w - cx <= edge * KEY_COLS) return -1;
  if (cy < edge * KEY_ROWS || h - cy <= edge * KEY_ROWS) return -1;
  return k;
}

static uint16_t clampU(JsonVariantConst v, uint16_t cur, uint16_t hi) {
  if (!v.is<int>()) return cur;
  int n = v.as<int>();
  return n < 0 ? 0 : n > hi ? hi : n;
}

void touchTuningJson(char *b, size_t n) {
  snprintf(b, n, "{\"press\":%u,\"release\":%u,\"minZ\":%u,\"edge\":%u,\"slide\":%u}",
           tune.pressMs, tune.releaseMs, tune.minZ, tune.edge, tune.slide);
}

void setTouchTuning(JsonObjectConst t) {
  if (t["default"] | 0) tune = TouchTuning();
  tune.pressMs = clampU(t["press"], tune.pressMs, 300);
  tune.releaseMs = clampU(t["release"], tune.releaseMs, 500);
  tune.minZ = clampU(t["minZ"], tune.minZ, 100);
  tune.edge = clampU(t["edge"], tune.edge, 30);
  tune.slide = clampU(t["slide"], tune.slide, 1);
  prefs.putBytes("tune", &tune, sizeof tune);
  char b[160], j[120];
  touchTuningJson(j, sizeof j);
  snprintf(b, sizeof b, "{\"ev\":\"touchCfg\",\"touch\":%s}", j);
  pc::send(b);
}

// While on, every touch sample is reported (at most 20 per second) so the app can show the pressure
void watchTouch(bool on) { watchUntil = on ? millis() + 120000 : 0; }

static void reportTouch(bool touching, int x, int y, int z, int k) {
  uint32_t now = millis();
  if (!watchUntil || (int32_t)(now - watchUntil) > 0) { watchUntil = 0; return; }
  if (touching ? now - lastWatchAt < 50 : !watchTouching) return;
  lastWatchAt = now;
  watchTouching = touching;
  char b[96];
  snprintf(b, sizeof b, "{\"ev\":\"touchRaw\",\"x\":%d,\"y\":%d,\"z\":%d,\"key\":%d}", x, y, touching ? z : 0, k);
  pc::send(b);
}

void calibrateTouch() {
  uint16_t cal[8];
  deck::stopAnimations();
  lcd.fillScreen(TFT_BLACK);
  lcd.setTextColor(TFT_WHITE); lcd.setTextDatum(textdatum_t::middle_center); lcd.setTextSize(2);
  lcd.drawString("Touch the arrow tips", lcd.width() / 2, lcd.height() / 2);
  lcd.calibrateTouch(cal, TFT_WHITE, TFT_BLACK, 20);
  prefs.putBytes("tcal", cal, sizeof cal);
  lcd.setTouchCalibrate(cal);
  touchReady = true;
  pc::send("{\"ev\":\"calibrated\"}");
  deck::setNotice(nullptr);
  deck::drawPage();
}

void sendState() {
  char b[200];
  snprintf(b, sizeof b, "{\"ev\":\"state\",\"faders\":[%d,%d],\"knobDown\":[%d,%d],\"key\":%d,\"page\":%d}",
           fader[0].value(), fader[1].value(), enc[0].isDown(), enc[1].isDown(), pressedKey, deck::page());
  pc::send(b);
}

static void keyEvent(int k, bool down) {
  char b[96];
  snprintf(b, sizeof b, "{\"ev\":\"key\",\"id\":%d,\"down\":%d,\"page\":%d}", k, down, deck::page());
  pc::send(b);
}

void setup() {
  uint64_t mac = ESP.getEfuseMac();
  snprintf(deviceId, sizeof deviceId, "%012llX", (unsigned long long)mac);

  USB.manufacturerName("Kivo Lab");
  USB.productName("Kivo Deck");
  hidout::begin();
  Serial.setRxBufferSize(RX_LINE_MAX);   // a whole file.data line fits while the screen is busy
  Serial.begin(115200);
  USB.begin();

  enc[0].begin(PIN_ENC1_A, PIN_ENC1_B, PIN_ENC1_SW);
  enc[1].begin(PIN_ENC2_A, PIN_ENC2_B, PIN_ENC2_SW);
  fader[0].begin(PIN_FADER1, FADER1_INVERT);
  fader[1].begin(PIN_FADER2, FADER2_INVERT);

  lcd.init();
  lcd.setRotation(DISPLAY_ROTATION);
  pinMode(PIN_TP_IRQ, INPUT_PULLUP);   // keeps the touch IRQ high when no LCD is attached
  pc::begin(deviceId);
  deck::begin();

  prefs.begin("kivo", false);
  if (prefs.getBytes("tune", &tune, sizeof tune) != sizeof tune) tune = TouchTuning();
  uint16_t cal[8];
  bool both = digitalRead(PIN_ENC1_SW) == LOW && digitalRead(PIN_ENC2_SW) == LOW;
  if (!both && prefs.getBytes("tcal", cal, sizeof cal) == sizeof cal) {
    lcd.setTouchCalibrate(cal);
    touchReady = true;
    deck::drawPage();
  } else if (both) {
    calibrateTouch();
  } else {
    deck::setNotice("Press knob 1 to calibrate touch");   // stays up when the app sends its keys
    deck::drawPage();
  }
}

void loop() {
  if (pc::updating()) { pc::poll(); return; }

  // touch -> key press / release. A key goes down once the point stayed on it for pressMs, and up
  // after releaseMs without any touch; while held it keeps its key unless slide is on.
  uint32_t now = millis();
  lgfx::touch_point_t tp;
  bool touching = touchReady && lcd.getTouch(&tp) && tp.size >= tune.minZ;
  int k = touching ? keyInside(tp.x, tp.y, pressedKey >= 0 ? 0 : tune.edge) : -1;
  if (touchReady) reportTouch(touching, tp.x, tp.y, tp.size, touching ? keyAt(tp.x, tp.y) : -1);
  if (touching) lastTouchAt = now;

  int next = pressedKey;
  if (pressedKey >= 0 && !touching && now - lastTouchAt >= tune.releaseMs) next = -1;
  if (k != candKey) { candKey = k; candSince = now; }
  bool settled = k >= 0 && now - candSince >= tune.pressMs;
  if (settled && (pressedKey < 0 || (tune.slide && k != pressedKey))) next = k;

  if (next != pressedKey) {
    if (pressedKey >= 0) {
      if (!swallowKey) { deck::keyUp(pressedKey); keyEvent(pressedKey, false); }
      swallowKey = false;
    }
    if (next >= 0) {
      if (deck::wakeIfSleeping()) swallowKey = true;
      else { deck::keyDown(next); keyEvent(next, true); }
    }
    pressedKey = next;
  }

  for (int i = 0; i < 2; i++) {
    int b = enc[i].button();
    if (b) {
      pc::event("knobPress", i, "down", b > 0);
      if (b > 0) {
        turnedWhilePressed[i] = false;
        swallowKnob[i] = deck::wakeIfSleeping();
        if (i == 0 && !touchReady) { calibrateTouch(); swallowKnob[i] = true; }
      }
      if (!swallowKnob[i]) deck::knobPress(i, b > 0, turnedWhilePressed[i]);
    }
    int d = enc[i].poll();
    if (d) {
      pc::event("knob", i, "delta", d);
      if (enc[i].isDown()) turnedWhilePressed[i] = true;
      if (!deck::wakeIfSleeping()) deck::knobTurn(i, d, enc[i].isDown());
    }
#if FADERS_INSTALLED
    int v;
    if (fader[i].poll(v)) pc::event("fader", i, "value", v);   // faders are handled by the PC app
#endif
  }

  pc::poll();
  deck::tick();
  delay(1);
}
