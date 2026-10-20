// Pin map — matches the main PCB v2 (see docs/hardware.md). Signal pins can be changed here
// without a new PCB; power pins (3V3/GND/5V) cannot.
#pragma once

// LCD MSP4021 (ST7796S) + XPT2046 resistive touch share one SPI bus
#define PIN_SPI_SCK   12
#define PIN_SPI_MOSI  11
#define PIN_SPI_MISO  13   // touch T_DO only (LCD SDO is not connected)
#define PIN_LCD_CS    10
#define PIN_LCD_DC     9
#define PIN_LCD_RST    8
#define PIN_TP_CS     16
#define PIN_TP_IRQ    15   // low while touched
// LCD backlight (LED) is tied to 3V3 on the PCB: always on.

// EC11 encoders (C pin and the switch's other leg go to GND -> use internal pull-ups)
#define PIN_ENC1_A     4
#define PIN_ENC1_B     5
#define PIN_ENC1_SW    6
#define PIN_ENC2_A    17
#define PIN_ENC2_B    18
#define PIN_ENC2_SW   21

// Faders (wiper -> ADC1). Track ends: 3V3 and GND.
#define PIN_FADER1     1
#define PIN_FADER2     2

// USB D-/D+ = GPIO19/GPIO20 (native USB, wired to the rear USB-C board through J2)
// Spare: GPIO38, 14, 39, 40, 41, 42, 47
