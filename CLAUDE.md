# Kivo Deck — Claude Code 작업 안내

DIY 스트림덱(Kivo Lab "Kivo Deck")의 펌웨어와 PC 앱 저장소예요. 사용자는 하드웨어·임베디드 초보자예요.
**사용자에게는 항상 한국어로, 쉬운 말로 설명**하고, 명령어는 Windows(PowerShell) 기준으로 알려 주세요.

## 하드웨어 한눈에 보기 (자세한 건 docs/hardware.md)
- MCU: ESP32-S3-DevKitC-1 **N16R8** (16 MB flash, 8 MB OPI PSRAM), 메인 PCB 아랫면에 직접 납땜
- 화면: MSP4021 4.0" 480×320, ST7796S + XPT2046 저항막 터치, 같은 SPI 버스. 백라이트는 3V3 직결(항상 켜짐), LCD SDO 미연결
- 입력: 투명 아크릴 키 15개(화면 위 5×3, 터치로 인식), EC11 엔코더 2개(누름 포함), 60 mm 페이더 2개(ADC)
- USB: 뒷면 USB-C 단자 보드 → GPIO19/20(네이티브 USB). 펌웨어 업로드도 이 포트
- 핀 배정은 `firmware/src/pins.h`가 기준. **신호 핀은 바꿔도 되지만 전원(3V3/GND/5V)은 PCB에 고정**

## 저장소 구조
```
firmware/   PlatformIO 프로젝트 (Arduino core 3.0.7, LovyanGFX 1.2.7)
app/        PC 앱 (Tauri 2 + TypeScript, Windows · Mac) — 기기 자동 연결 + 이벤트 모니터까지
docs/       hardware.md(치수·핀), protocol.md(기기↔앱 시리얼 규격), roadmap.md(개발 순서)
hardware/   PCB 거버·3D 출력·아크릴 파일과 그걸 만든 파이썬 스크립트 (이미 주문 완료, 참고용)
```

## 펌웨어
- 빌드: `cd firmware; pio run` / 업로드: `pio run -t upload` / 시리얼: `pio device monitor`
- 이 PC에서 pio는 PATH에 없고 `F:\pio_env\Scripts\pio.exe`(전용 venv). 로그를 파일로 받을 땐 `PYTHONIOENCODING=utf-8`
- platformio.ini는 pioarduino 플랫폼 `51.03.07`(= Arduino core 3.0.7). **PlatformIO 빌드 성공 확인**(2026-10-20, RAM 12% · Flash 14.5%)
- 보드 파일이 `-DARDUINO_USB_MODE=1`을 기본으로 넣어서 `build_unflags`로 빼 두었음. 지우면 TinyUSB가 아니라 HW CDC 모드로 빌드돼 HID 키보드가 안 됨
- USB 모드: TinyUSB(USB-OTG)로 HID 키보드 + Consumer Control + CDC 시리얼을 동시에 씀 (`ARDUINO_USB_MODE=0`, `ARDUINO_USB_CDC_ON_BOOT=1`)
- 처음 업로드나 업로드가 안 될 때: ESP32의 BOOT 버튼을 누른 채 RST를 눌렀다 떼면 다운로드 모드. 업로드 후 COM 포트 번호가 바뀔 수 있음
- 납땜 전에는 DevKit의 "USB" 표시 포트(네이티브 USB)로 테스트할 수 있음. 화면·노브 없이도 시리얼 `{"cmd":"hello"}` 응답으로 확인 가능. 이때 페이더 핀이 떠 있어서 `fader` 이벤트가 마구 찍히는 건 정상
- 터치는 보정 전까지 꺼져 있음(첫 부팅 화면에서 노브 1을 누르면 보정 시작)

### 실물로 확인해야 하는 가정 (추측값)
- `DISPLAY_ROTATION`(config.h): 조립 후 화면이 뒤집혀 보이면 0~3 중 조정하고 터치 보정 다시
- 색이 이상하면 display.h의 `invert` / `rgb_order`를 바꿔 볼 것
- 페이더: 맨 아래가 1000으로 읽히면 `FADERn_INVERT 1`. 와이퍼가 PCB 2번 패드라고 가정
- 엔코더 방향이 반대면 input 쪽에서 부호만 뒤집기 (PCB 수정 불필요)
- 터치 보정: 두 노브를 누른 채 USB를 꽂거나 `{"cmd":"calibrate"}`. 값은 NVS(Preferences "kivo"/"tcal")에 저장

## PC 앱
- 실행: `cd app; npm run tauri dev` (처음 한 번 `npm install`). Rust는 `%USERPROFILE%\.cargo/bin`, MSVC Build Tools 설치됨
- `src-tauri/src/device.rs`: Espressif VID(0x303A) USB 포트만 골라 `hello` 핸드셰이크 → 연결 유지·자동 재연결. 이벤트는 `device-event`, 연결 상태는 `device-status`로 웹 쪽에 보냄. 명령은 `send_command`
- `src/main.ts`: 키 15칸·노브·페이더 표시와 로그, 기본 명령 버튼(모니터 화면)

## 기본 동작 (앱 없이)
- 키 1~12 → F13~F24, 키 13~15 → Ctrl+F13~F15
- 노브 1 → 시스템 볼륨 ±, 누르면 음소거. 노브 2·페이더는 시리얼로만 보고(앱이 처리)

## 작업 원칙
- 기기↔앱 규격은 docs/protocol.md를 먼저 고치고 양쪽을 맞출 것. 필드 추가는 OK, 기존 필드 의미 변경은 버전 올리기
- 세팅의 원본은 기기(플래시 LittleFS). 플래시 수명 때문에 "저장" 시점에만 기록
- 큰 변경 전에는 사용자에게 무엇을 바꾸는지 한두 문장으로 먼저 설명
- 개발 순서와 진행 상황은 docs/roadmap.md에 체크
