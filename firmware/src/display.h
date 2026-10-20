#pragma once
#define LGFX_USE_V1
#include <LovyanGFX.hpp>
#include "pins.h"

// ST7796S 320x480 panel + XPT2046 touch on the same SPI2 bus
class LGFX : public lgfx::LGFX_Device {
  lgfx::Panel_ST7796 _panel;
  lgfx::Bus_SPI _bus;
  lgfx::Touch_XPT2046 _touch;
public:
  LGFX() {
    { auto c = _bus.config();
      c.spi_host = SPI2_HOST; c.spi_mode = 0;
      c.freq_write = 40000000; c.freq_read = 16000000;
      c.spi_3wire = false; c.use_lock = true; c.dma_channel = SPI_DMA_CH_AUTO;
      c.pin_sclk = PIN_SPI_SCK; c.pin_mosi = PIN_SPI_MOSI; c.pin_miso = PIN_SPI_MISO; c.pin_dc = PIN_LCD_DC;
      _bus.config(c); _panel.setBus(&_bus); }
    { auto c = _panel.config();
      c.pin_cs = PIN_LCD_CS; c.pin_rst = PIN_LCD_RST; c.pin_busy = -1;
      c.panel_width = 320; c.panel_height = 480; c.memory_width = 320; c.memory_height = 480;
      c.offset_x = 0; c.offset_y = 0; c.offset_rotation = 0;
      c.readable = false;            // LCD SDO is not wired
      c.invert = false; c.rgb_order = false; c.dlen_16bit = false;
      c.bus_shared = true;           // touch uses the same bus
      _panel.config(c); }
    { auto c = _touch.config();
      c.x_min = 0; c.x_max = 4095; c.y_min = 0; c.y_max = 4095;
      c.pin_int = PIN_TP_IRQ; c.bus_shared = true; c.offset_rotation = 0;
      c.spi_host = SPI2_HOST; c.freq = 1000000;
      c.pin_sclk = PIN_SPI_SCK; c.pin_mosi = PIN_SPI_MOSI; c.pin_miso = PIN_SPI_MISO; c.pin_cs = PIN_TP_CS;
      _touch.config(c); _panel.setTouch(&_touch); }
    setPanel(&_panel);
  }
};
