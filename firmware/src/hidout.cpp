#include <USB.h>
#include <USBHIDKeyboard.h>
#include <USBHIDConsumerControl.h>
#include "deck.h"

static USBHIDKeyboard Keyboard;
static USBHIDConsumerControl Consumer;

namespace hidout {

void begin() {
  Keyboard.begin();
  Consumer.begin();
}

void consumer(uint16_t code) {
  Consumer.press(code);
  Consumer.release();
}

// [modifier bits, usage]: bits 1 Ctrl, 2 Shift, 4 Alt, 8 GUI (Win / Cmd)
static void combo(JsonArrayConst c) {
  uint8_t mods = c[0] | 0, usage = c[1] | 0;
  for (int b = 0; b < 4; b++) if (mods & (1 << b)) Keyboard.pressRaw(0xE0 + b);
  if (usage) Keyboard.pressRaw(usage);
  delay(8);
  Keyboard.releaseAll();
  delay(8);
}

void run(JsonVariantConst a) {
  if (a.isNull()) return;
  if (a["k"].is<JsonArrayConst>()) {
    for (JsonArrayConst c : a["k"].as<JsonArrayConst>()) combo(c);
  } else if (a["c"].is<int>()) {
    consumer(a["c"].as<uint16_t>());
  } else if (a["t"].is<const char *>()) {
    Keyboard.print(a["t"].as<const char *>());   // ASCII only (US layout); the app types everything else
  } else if (a["d"].is<int>()) {
    delay(min(a["d"].as<int>(), 5000));
  } else if (a["s"].is<JsonArrayConst>()) {
    for (JsonVariantConst step : a["s"].as<JsonArrayConst>()) run(step);
  }
}

void defaultKey(int k, bool down) {
  uint8_t key = k < 12 ? (KEY_F13 + k) : (KEY_F13 + (k - 12));
  bool ctrl = k >= 12;
  if (down) { if (ctrl) Keyboard.press(KEY_LEFT_CTRL); Keyboard.press(key); }
  else { Keyboard.release(key); if (ctrl) Keyboard.release(KEY_LEFT_CTRL); }
}

}  // namespace hidout
