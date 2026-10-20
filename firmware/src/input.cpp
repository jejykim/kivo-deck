#include "input.h"
#include "config.h"

static const int8_t QDEC[16] = { 0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0 };

void Encoder::begin(uint8_t pinA, uint8_t pinB, uint8_t pinSw) {
  _a = pinA; _b = pinB; _sw = pinSw;
  pinMode(_a, INPUT_PULLUP); pinMode(_b, INPUT_PULLUP); pinMode(_sw, INPUT_PULLUP);
  _state = (digitalRead(_a) << 1) | digitalRead(_b);
  _raw = _down = digitalRead(_sw) == LOW;
  attachInterruptArg(_a, [](void *p) { static_cast<Encoder *>(p)->isr(); }, this, CHANGE);
  attachInterruptArg(_b, [](void *p) { static_cast<Encoder *>(p)->isr(); }, this, CHANGE);
}

void IRAM_ATTR Encoder::isr() {
  uint8_t s = (digitalRead(_a) << 1) | digitalRead(_b);
  _steps += QDEC[(_state << 2) | s];
  _state = s;
}

int Encoder::poll() {
  noInterrupts();
  int16_t s = _steps;
  int detents = s / ENC_STEPS_PER_DETENT;
  _steps = s - detents * ENC_STEPS_PER_DETENT;
  interrupts();
  return detents;
}

int Encoder::button() {
  bool r = digitalRead(_sw) == LOW;
  uint32_t now = millis();
  if (r != _raw) { _raw = r; _changedAt = now; }
  if (r != _down && now - _changedAt > 15) { _down = r; return r ? 1 : -1; }
  return 0;
}

void Fader::begin(uint8_t pin, bool invert) {
  _pin = pin; _invert = invert;
  analogReadResolution(12);
  analogSetPinAttenuation(_pin, ADC_11db);
}

bool Fader::poll(int &value) {
  int raw = analogRead(_pin);                       // 0..4095
  float v = raw * (1000.0f / 4095.0f);
  if (_invert) v = 1000.0f - v;
  _ema = _ema < 0 ? v : _ema + 0.15f * (v - _ema);
  int q = (int)lroundf(_ema);
  if (q < 8) q = 0; else if (q > 992) q = 1000;     // snap the ends
  if (abs(q - _reported) >= FADER_DEADBAND || ((q == 0 || q == 1000) && q != _reported)) {
    _reported = q; value = q; return true;
  }
  return false;
}
