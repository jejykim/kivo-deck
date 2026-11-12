#pragma once
#define FW_VERSION "0.3.4"

// Screen: 480 x 320 landscape, 5 x 3 keys. If the picture is upside down or mirrored after
// assembly, change DISPLAY_ROTATION (0-3) and redo the touch calibration.
#define DISPLAY_ROTATION 1
#define KEY_COLS 5
#define KEY_ROWS 3
#define KEY_COUNT (KEY_COLS * KEY_ROWS)

// Encoder: EC11 20 detents -> 4 quadrature steps per detent
#define ENC_STEPS_PER_DETENT 4
// Set to 1 once the faders are soldered. Unconnected ADC pins float, and the random values would
// drive whatever the PC app has on the fader (system volume by default).
#define FADERS_INSTALLED 1
// Fader: report when the filtered value moves more than this (0-1000 scale)
#define FADER_DEADBAND 4
// Set to 1 if a fader reads 1000 at the bottom (it was soldered rotated 180 deg)
#define FADER1_INVERT 1
#define FADER2_INVERT 1

// Key gestures (ms)
#define LONG_PRESS_MS 500
#define DOUBLE_TAP_MS 250
// Serial: longest command line (file.data chunks and live tiles are base64)
#define RX_LINE_MAX 16384
// Firmware update: give up when the app stops sending, roll back when no app says hello to a new version
#define OTA_DATA_TIMEOUT_MS 15000
#define OTA_CONFIRM_TIMEOUT_MS 60000
// Animated GIFs played at the same time on one page
#define MAX_GIFS 6
// Folder pages that can be opened inside each other
#define PAGE_STACK 8
