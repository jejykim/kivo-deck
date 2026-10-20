# 하드웨어 정리

## 외형과 높이
- 본체 213 × 91 × 두께 27.4 mm (평평, 받침대 P4는 나중에)
- 아래부터: 바닥 2 → ESP32(PCB 아랫면에 납땜, 7.3) → 여유 1 → 메인 PCB 1.6 → 상판 기둥 12.5 → 상판 3
- LCD 유리 윗면 = 상판 밑면 3.2 mm 아래. 그 위로 TPU 쿠션 1 + 아크릴 립 2T, 키캡 5T가 상판 위로 약 1.8 mm 나옴
- 조립 순서: 3D 조립 가이드 https://claude.ai/artifact/2SQnJQi8n1U2Cx4S8EkvAK

## 핀 배정 (메인 PCB v2)
| 부품 | 신호 | ESP32 |
|---|---|---|
| LCD | VCC / GND | 3V3 / GND |
| LCD | CS / DC / RESET | GPIO10 / GPIO9 / GPIO8 |
| LCD | SCK / MOSI | GPIO12 / GPIO11 |
| LCD | LED (백라이트) | 3V3 직결 |
| LCD | SDO (MISO) | 연결 안 함 |
| 터치 | T_CLK / T_DIN / T_DO | GPIO12 / GPIO11 / GPIO13 (화면과 공유) |
| 터치 | T_CS / T_IRQ | GPIO16 / GPIO15 |
| 노브 1 (뒤) | A / B / 누름 | GPIO4 / GPIO5 / GPIO6 |
| 노브 2 (앞) | A / B / 누름 | GPIO17 / GPIO18 / GPIO21 |
| 노브 공통 | C핀, 누름 반대쪽 | GND |
| 페이더 1 / 2 | 가운데 핀 (와이퍼) | GPIO1 / GPIO2 (ADC1) |
| 페이더 양끝 | 끝 핀 | 3V3 / GND |
| USB-C 보드 (J2) | 5V / GND / D− / D+ | 5V / GND / GPIO19 / GPIO20 |
| 예비 | - | GPIO38, 14, 39, 40, 41, 42, 47 |

피한 핀: 35·36·37(PSRAM), 0·3·45·46(부팅), 43·44(UART0), 48(보드 RGB LED).

## J1 (LCD 선 14가닥, 1:1)
1 VCC(앞쪽 끝, 네모 패드) · 2 GND · 3 CS · 4 RESET · 5 DC · 6 SDI(MOSI) · 7 SCK · 8 LED · 9 SDO(미연결) · 10 T_CLK · 11 T_CS · 12 T_DIN · 13 T_DO · 14 T_IRQ

## 콘덴서 (선택 부품, 모두 장착 예정)
- C1~C4: 엔코더 A·B, **10nF** (내부 풀업 약 45kΩ과 τ ≈ 0.45 ms)
- C5·C6: 페이더 와이퍼, **100nF**

## 키 배치
- 화면 표시 영역 83.52 × 55.68 mm를 5×3으로 나눔 → 칸당 16.70 × 18.56 mm, 화면 픽셀 기준 칸당 96 × 106.7 px
- 상판 키 창 15.2 × 17.06, 키캡 15.00 × 16.86 (5T), 립 16.40 × 18.26 (2T), 모서리 R1

## 파일
- `hardware/pcb/`: 거버(주문 완료), KiCad 파일, 생성 스크립트, pinmap.csv
- `hardware/enclosure/`: 3D 출력 STEP/STL(주문 완료), CadQuery 스크립트
- `hardware/acrylic/`: 레이저 커팅 DXF(주문 완료), 생성 스크립트
