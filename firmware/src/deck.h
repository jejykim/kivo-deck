// Pages, key gestures, knob actions and drawing, driven by the bundle the PC app uploads
// (/b/config.json + page JPEGs + GIFs, see docs/protocol.md). Without a bundle the device falls
// back to the built-in defaults (F13.. keys, knob 1 = volume).
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

class LGFX;
extern LGFX lcd;

namespace deck {
  void begin();                 // mounts LittleFS, loads the bundle if there is one
  bool reload();                // re-reads /b/config.json after an upload; false = no bundle
  bool hasBundle();
  String bundleHash();
  int page();
  void gotoPage(int n, bool fromApp);
  void drawPage();
  void setNotice(const char *text);  // shown instead of the keys until cleared with nullptr
  void stopAnimations();
  void drawTile(int page, int key, const uint8_t *jpg, size_t len);  // live key from the app

  // inputs (called from main loop)
  void keyDown(int k);
  void keyUp(int k);
  void knobTurn(int id, int detents, bool pressed);
  void knobPress(int id, bool down, bool turnedWhilePressed);
  void tick();                  // long press / double tap timers, GIF frames, screen saver

  bool wakeIfSleeping();        // true when the input only woke the screen
  void touchActivity();
}

// HID output of device actions ({"k":..}, {"c":..}, {"t":..}, {"s":[..]})
namespace hidout {
  void begin();
  void run(JsonVariantConst a);
  void defaultKey(int k, bool down);    // no bundle: F13..F24, Ctrl+F13..F15
  void consumer(uint16_t code);
}

// Serial link to the PC app (JSON lines)
namespace pc {
  void begin(const char *deviceId);
  void poll();
  bool updating();              // a firmware update is being received
  void send(const char *json);
  void event(const char *ev, int id, const char *field, int value);
  void act(const char *src, int id, int page, const char *kind, int n);
}
