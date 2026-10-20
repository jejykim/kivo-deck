// Kivo Deck firmware — stage 1
//  - 15 on-screen keys (touch) -> USB keyboard F13..F24 (+ Ctrl+F13..F15 for keys 13-15)
//  - Knob 1: system volume (turn) / mute (press). Knob 2 and both faders: reported to the PC app
//  - Every input is also reported over USB serial as one JSON line (docs/protocol.md)
//  - Touch calibration: first boot asks for it (press knob 1), later hold both knobs while plugging in,
//    or send {"cmd":"calibrate"}. Touch stays off until calibrated, so a bare ESP32 sends no phantom keys.
#include <Arduino.h>
#include <USB.h>
#include <USBHIDKeyboard.h>
#include <USBHIDConsumerControl.h>
#include <Preferences.h>
#include "config.h"
#include "pins.h"
#include "display.h"
#include "input.h"

static LGFX lcd;
static USBHIDKeyboard Keyboard;
static USBHIDConsumerControl Consumer;
static Preferences prefs;
static Encoder enc[2];
static Fader fader[2];

static int pressedKey = -1;
static bool touchReady = false;
static String rxLine;
static char deviceId[13];

static const uint16_t TILE_COLORS[5] = { 0x2C1B, 0xD1C5, 0x3D2B, 0xE544, 0x8ABA };

// ------------------------------------------------------------------ serial protocol
static void send(const String &json) { Serial.println(json); }
static void sendEvent(const char *ev, int id, const char *field, int value) {
  char b[96]; snprintf(b, sizeof b, "{\"ev\":\"%s\",\"id\":%d,\"%s\":%d}", ev, id, field, value); send(b);
}
static void sendHello() {
  char b[160];
  snprintf(b, sizeof b, "{\"ev\":\"hello\",\"fw\":\"%s\",\"device\":\"%s\",\"keys\":%d,\"knobs\":2,\"faders\":2}",
           FW_VERSION, deviceId, KEY_COUNT);
  send(b);
}

// ------------------------------------------------------------------ screen
static void keyRect(int k, int &x, int &y, int &w, int &h) {
  int cw = lcd.width() / KEY_COLS, ch = lcd.height() / KEY_ROWS;
  int c = k % KEY_COLS, r = k / KEY_COLS;
  x = c * cw + 6; y = r * ch + 6; w = cw - 12; h = ch - 12;
}
static void drawKey(int k, bool down) {
  int x, y, w, h; keyRect(k, x, y, w, h);
  uint16_t col = TILE_COLORS[(k % KEY_COLS + k / KEY_COLS) % 5];
  lcd.fillRoundRect(x, y, w, h, 12, down ? TFT_WHITE : col);
  lcd.setTextColor(down ? TFT_BLACK : TFT_WHITE);
  lcd.setTextDatum(textdatum_t::middle_center);
  lcd.setTextSize(2);
  lcd.drawNumber(k + 1, x + w / 2, y + h / 2);
}
static void drawAll() {
  lcd.fillScreen(TFT_BLACK);
  for (int k = 0; k < KEY_COUNT; k++) drawKey(k, false);
}
static int keyAt(int tx, int ty) {
  if (tx < 0 || ty < 0 || tx >= lcd.width() || ty >= lcd.height()) return -1;
  return (ty * KEY_ROWS / lcd.height()) * KEY_COLS + (tx * KEY_COLS / lcd.width());
}

static void calibrate() {
  uint16_t cal[8];
  lcd.fillScreen(TFT_BLACK);
  lcd.setTextColor(TFT_WHITE); lcd.setTextDatum(textdatum_t::middle_center); lcd.setTextSize(2);
  lcd.drawString("Touch the arrow tips", lcd.width() / 2, lcd.height() / 2);
  lcd.calibrateTouch(cal, TFT_WHITE, TFT_BLACK, 20);
  prefs.putBytes("tcal", cal, sizeof cal);
  lcd.setTouchCalibrate(cal);
  touchReady = true;
  send("{\"ev\":\"calibrated\"}");
  drawAll();
}

// ------------------------------------------------------------------ default (no app) actions
static void keyHid(int k, bool down) {
  uint8_t key = k < 12 ? (KEY_F13 + k) : (KEY_F13 + (k - 12));
  bool ctrl = k >= 12;
  if (down) { if (ctrl) Keyboard.press(KEY_LEFT_CTRL); Keyboard.press(key); }
  else { Keyboard.release(key); if (ctrl) Keyboard.release(KEY_LEFT_CTRL); }
}

static void handleCommand(const String &line) {
  if (line.indexOf("\"hello\"") >= 0) sendHello();
  else if (line.indexOf("\"ping\"") >= 0) send("{\"ev\":\"pong\"}");
  else if (line.indexOf("\"calibrate\"") >= 0) calibrate();
  else if (line.indexOf("\"state\"") >= 0) {
    char b[160];
    snprintf(b, sizeof b, "{\"ev\":\"state\",\"faders\":[%d,%d],\"knobDown\":[%d,%d],\"key\":%d}",
             fader[0].value(), fader[1].value(), enc[0].isDown(), enc[1].isDown(), pressedKey);
    send(b);
  } else send("{\"ev\":\"error\",\"msg\":\"unknown command\"}");
}

void setup() {
  uint64_t mac = ESP.getEfuseMac();
  snprintf(deviceId, sizeof deviceId, "%012llX", (unsigned long long)mac);

  USB.manufacturerName("Kivo Lab");
  USB.productName("Kivo Deck");
  Keyboard.begin(); Consumer.begin();
  Serial.begin(115200);
  USB.begin();

  enc[0].begin(PIN_ENC1_A, PIN_ENC1_B, PIN_ENC1_SW);
  enc[1].begin(PIN_ENC2_A, PIN_ENC2_B, PIN_ENC2_SW);
  fader[0].begin(PIN_FADER1, FADER1_INVERT);
  fader[1].begin(PIN_FADER2, FADER2_INVERT);

  lcd.init();
  lcd.setRotation(DISPLAY_ROTATION);
  pinMode(PIN_TP_IRQ, INPUT_PULLUP);   // keeps the touch IRQ high when no LCD is attached
  prefs.begin("kivo", false);
  uint16_t cal[8];
  bool both = digitalRead(PIN_ENC1_SW) == LOW && digitalRead(PIN_ENC2_SW) == LOW;
  if (!both && prefs.getBytes("tcal", cal, sizeof cal) == sizeof cal) { lcd.setTouchCalibrate(cal); touchReady = true; drawAll(); }
  else if (both) calibrate();
  else {
    lcd.fillScreen(TFT_BLACK);
    lcd.setTextColor(TFT_WHITE); lcd.setTextDatum(textdatum_t::middle_center); lcd.setTextSize(2);
    lcd.drawString("Press knob 1 to calibrate touch", lcd.width() / 2, lcd.height() / 2);
  }
}

void loop() {
  // touch -> key press / release
  int32_t tx, ty;
  int k = (touchReady && lcd.getTouch(&tx, &ty)) ? keyAt(tx, ty) : -1;
  if (k != pressedKey) {
    if (pressedKey >= 0) { drawKey(pressedKey, false); keyHid(pressedKey, false); sendEvent("key", pressedKey, "down", 0); }
    if (k >= 0) { drawKey(k, true); keyHid(k, true); sendEvent("key", k, "down", 1); }
    pressedKey = k;
  }

  for (int i = 0; i < 2; i++) {
    int d = enc[i].poll();
    if (d) {
      sendEvent("knob", i, "delta", d);
      if (i == 0) for (int n = 0; n < abs(d); n++) Consumer.press(d > 0 ? CONSUMER_CONTROL_VOLUME_INCREMENT : CONSUMER_CONTROL_VOLUME_DECREMENT), Consumer.release();
    }
    int b = enc[i].button();
    if (b) {
      sendEvent("knobPress", i, "down", b > 0);
      if (i == 0 && b > 0) {
        if (!touchReady) calibrate();
        else { Consumer.press(CONSUMER_CONTROL_MUTE); Consumer.release(); }
      }
    }
    int v;
    if (fader[i].poll(v)) sendEvent("fader", i, "value", v);
  }

  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { rxLine.trim(); if (rxLine.length()) handleCommand(rxLine); rxLine = ""; }
    else if (rxLine.length() < 256) rxLine += c;
  }
  delay(2);
}
