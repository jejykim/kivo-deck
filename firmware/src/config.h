#pragma once
#define FW_VERSION "0.1.0"

// Screen: 480 x 320 landscape, 5 x 3 keys. If the picture is upside down or mirrored after
// assembly, change DISPLAY_ROTATION (0-3) and redo the touch calibration.
#define DISPLAY_ROTATION 1
#define KEY_COLS 5
#define KEY_ROWS 3
#define KEY_COUNT (KEY_COLS * KEY_ROWS)

// Encoder: EC11 20 detents -> 4 quadrature steps per detent
#define ENC_STEPS_PER_DETENT 4
// Fader: report when the filtered value moves more than this (0-1000 scale)
#define FADER_DEADBAND 4
// Set to 1 if a fader reads 1000 at the bottom (it was soldered rotated 180 deg)
#define FADER1_INVERT 0
#define FADER2_INVERT 0
