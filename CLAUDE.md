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
firmware/   PlatformIO 프로젝트 (Arduino core 3.0.7, LovyanGFX 1.2.7, ArduinoJson 7, AnimatedGIF)
app/        PC 앱 (Tauri 2 + React/TypeScript, Windows · Mac)
.github/    release.yml: v* 태그를 올리면 앱(Win·Mac)·펌웨어를 빌드해 GitHub 릴리스로 배포
docs/       hardware.md(치수·핀), protocol.md(기기↔앱 시리얼 규격), roadmap.md(개발 순서)
hardware/   PCB 거버·3D 출력·아크릴 파일과 그걸 만든 파이썬 스크립트 (이미 주문 완료, 참고용)
```

## 펌웨어
- 빌드: `cd firmware; pio run` / 업로드: `pio run -t upload` / 시리얼: `pio device monitor`
- 이 PC에서 pio는 PATH에 없고 `F:\pio_env\Scripts\pio.exe`(전용 venv). 로그를 파일로 받을 땐 `PYTHONIOENCODING=utf-8`
- platformio.ini는 pioarduino 플랫폼 `51.03.07`(= Arduino core 3.0.7). 빌드 확인됨(RAM 13% · Flash 17%)
- 구조: `main.cpp`(입력 읽기·터치 보정) → `deck.cpp`(번들 설정·페이지·화면·길게/두 번/토글·노브 동작·화면 보호) / `link.cpp`(시리얼 명령·번들 받기) / `hidout.cpp`(키보드·미디어 키). `link`는 POSIX 함수 이름과 겹쳐서 namespace는 `pc`
- 번들은 LittleFS `/b/`에 저장(파티션 이름 `spiffs`, 약 9.9 MB). 큰 버퍼(JSON·JPEG·GIF·수신 줄)는 PSRAM에 둠
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
- 실행: `cd app; npm run tauri dev` (처음 한 번 `npm install`). Rust는 `%USERPROFILE%\.cargo\bin`, MSVC Build Tools 설치됨
- 브라우저 미리보기: `npm run dev` 후 일반 브라우저로 열면 `src/devmock.ts`가 Rust 명령을 흉내 냄(기기 없이 화면 확인용). 데스크톱 앱과 같은 1420 포트라 동시에 못 띄움
- 세팅 파일: `%APPDATA%\lab.kivo.deck\store.json` + `media\`(이미지·GIF·소리)
- 데이터: OS별 프리셋 3칸(`slots`) → 페이지(폴더 포함) → 키 15 / 노브 2 / 페이더 2. 이 PC OS의 사용 칸이 비면 다른 OS의 프리셋을 빌려 쓰고, 그 OS 전용 기능은 앱과 보드 화면에 "사용 불가"로 그림 (`model.ts` `resolvePreset`)
- 프리셋은 앱에서만 고르고 고침. 보드에는 "보드에 적용"(또는 연결될 때 해시가 다르면 자동)으로 **번들**을 보냄 (`bundle.ts`, `sync.ts`)
- 기능 목록은 `src/catalog.ts` 한 곳: `hid()` = 보드가 직접 실행(앱 없어도 동작), `run()` = 앱이 실행(`src-tauri/src/actions.rs`의 `Op`). 프로그램별 기능은 `APP_PACKS`에 팩을 추가 (지금 Photoshop·OBS)
- 화면 그리기는 `render.ts` 하나로 앱 미리보기와 보드 JPEG/GIF를 똑같이 만듦. 영상 → GIF 변환·GIF 디코드는 `media.ts`(gifenc·gifuct-js)
- Rust: `device.rs`(포트 찾기·번들 전송) `runtime.rs`(act/fader → 실행, 앞 프로그램 감지로 페이지 자동 전환) `actions.rs`(enigo 키 입력·열기) `audio.rs`(Windows Core Audio / Mac osascript) `obs.rs`(obws) `store.rs` `system.rs`
- 창을 닫으면 트레이로 숨음. 로그인 시 자동 실행(`--autostart` 인자, 개발 모드에서는 등록 안 함)
- 업데이트: `tauri-plugin-updater`가 `github.com/jejykim/kivo-deck` 최신 릴리스의 `latest.json`을 확인. 서명 비밀 키는 `%USERPROFILE%\.tauri\kivo-deck.key`(비밀번호 없음, **절대 커밋 금지**), 공개 키는 tauri.conf.json. GitHub 저장소 Secrets `TAURI_SIGNING_PRIVATE_KEY`에 키 파일 내용을 넣어야 릴리스가 서명됨
- 새 버전 내기: `app/package.json`·`app/src-tauri/Cargo.toml`·`app/src-tauri/tauri.conf.json`의 version을 같이 올리고 `git tag vX.Y.Z; git push --tags`

## 기본 동작 (번들 없을 때)
- 키 1~12 → F13~F24, 키 13~15 → Ctrl+F13~F15
- 노브 1 → 시스템 볼륨 ±, 누르면 음소거

## 작업 원칙
- 기기↔앱 규격은 docs/protocol.md를 먼저 고치고 양쪽을 맞출 것. 필드 추가는 OK, 기존 필드 의미 변경은 버전 올리기
- 세팅의 원본은 PC 앱(store.json, 프리셋 6칸). 기기는 이 PC OS용으로 만든 번들만 가짐. 플래시 수명 때문에 "적용"할 때·해시가 다를 때만 기록
- 백라이트가 3V3 직결이라 밝기 조절은 불가. 화면 보호는 검은 화면
- 큰 변경 전에는 사용자에게 무엇을 바꾸는지 한두 문장으로 먼저 설명
- 개발 순서와 진행 상황은 docs/roadmap.md에 체크
