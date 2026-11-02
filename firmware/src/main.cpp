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
static bool turnedWhilePressed[2] = { false, false };
static bool swallowKnob[2] = { false, false };
static char deviceId[13];

static int keyAt(int tx, int ty) {
  if (tx < 0 || ty < 0 || tx >= lcd.width() || ty >= lcd.height()) return -1;
  return (ty * KEY_ROWS / lcd.height()) * KEY_COLS + (tx * KEY_COLS / lcd.width());
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

  // touch -> key press / release (sliding to another key = release + press)
  int32_t tx, ty;
  int k = (touchReady && lcd.getTouch(&tx, &ty)) ? keyAt(tx, ty) : -1;
  if (k != pressedKey) {
    if (pressedKey >= 0) {
      if (!swallowKey) { deck::keyUp(pressedKey); keyEvent(pressedKey, false); }
      swallowKey = false;
    }
    if (k >= 0) {
      if (deck::wakeIfSleeping()) swallowKey = true;
      else { deck::keyDown(k); keyEvent(k, true); }
    }
    pressedKey = k;
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
