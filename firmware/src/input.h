#pragma once
#include <Arduino.h>

// Quadrature encoder decoded in pin-change interrupts; detents are counted in poll().
class Encoder {
public:
  void begin(uint8_t pinA, uint8_t pinB, uint8_t pinSw);
  int poll();                 // detents turned since last call (+ = clockwise)
  int button();               // +1 pressed, -1 released, 0 no change (debounced)
  bool isDown() const { return _down; }
  void isr();
private:
  uint8_t _a = 0, _b = 0, _sw = 0, _state = 0;
  volatile int16_t _steps = 0;
  bool _down = false, _raw = false;
  uint32_t _changedAt = 0;
};

// Fader on an ADC pin, filtered to 0..1000
class Fader {
public:
  void begin(uint8_t pin, bool invert);
  bool poll(int &value);      // true when the value moved past the deadband
  int value() const { return _reported; }
private:
  uint8_t _pin = 0; bool _invert = false;
  float _ema = -1; int _reported = -1000;
};
