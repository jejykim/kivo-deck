# Kivo Deck

Kivo Lab에서 직접 만든 DIY 스트림덱이에요. 4인치 터치 화면 위에 투명 아크릴 키 15개를 얹고, 노브 2개와 페이더 2개를 달았어요.

## 다운로드

| 파일 | 링크 |
|---|---|
| Windows 설치 파일 (.exe) | [Kivo.Deck_0.3.4_x64-setup.exe](https://github.com/jejykim/kivo-deck/releases/download/v0.3.4/Kivo.Deck_0.3.4_x64-setup.exe) |
| Mac 설치 파일 (.dmg, Intel·Apple 칩 공용) | [Kivo.Deck_0.3.4_universal.dmg](https://github.com/jejykim/kivo-deck/releases/download/v0.3.4/Kivo.Deck_0.3.4_universal.dmg) |
| 보드 펌웨어 (.bin) | [kivo-deck-firmware-0.3.4.bin](https://github.com/jejykim/kivo-deck/releases/download/v0.3.4/kivo-deck-firmware-0.3.4.bin) |

다른 버전은 [릴리스 페이지](https://github.com/jejykim/kivo-deck/releases/latest)에서 받을 수 있어요.

## 설치

**Windows**: `.exe`를 실행하세요. 설치 파일에 회사 인증서 서명이 없어서 "Windows의 PC 보호" 창이 뜰 수 있어요. 그때는 **추가 정보 → 실행**을 누르면 돼요.

**Mac**: `.dmg`를 열어 앱을 응용 프로그램 폴더로 옮기세요. 개발자 인증이 없어서 처음에는 그냥 열리지 않을 수 있어요. 그때는 앱을 **우클릭 → 열기**로 여세요. 그래도 막히면 시스템 설정 → 개인정보 보호 및 보안에서 허용하세요.

앱을 설치한 뒤에는 새 버전이 나오면 앱 상단의 아이콘으로 알려 줘요.

## 사용법

1. 보드를 USB-C로 PC에 연결해요. 앱이 보드를 자동으로 찾아요.
2. 처음 쓰는 보드라면 화면 안내대로 **노브 1을 누르고**, 화살표 끝을 차례로 눌러 터치를 보정해요.
3. 오른쪽 기능 목록에서 원하는 기능을 끌어다 키·노브·페이더에 놓아요.
4. **보드에 적용**을 누르면 설정이 보드에 저장돼요. 보드가 직접 실행하는 기능은 앱을 꺼도 동작해요.
5. 키가 잘 안 눌리거나 옆 키가 같이 눌리면 **설정 → 터치 조절**에서 압력을 보며 맞춰요. 일부 키만 어긋나면 그 안의 **키별 위치 보정**으로 키마다 위치를 재요. 값은 보드마다 따로 저장돼요.

## 할 수 있는 일

- **키**: 누르기, 길게 누르기, 두 번 누르기, 토글. 글자·이미지·GIF, 영상을 GIF로 변환, 여러 칸에 걸친 이미지
- **노브·페이더**: 볼륨(시스템·마이크·앱별)과 단축키. 노브는 누른 채 돌리기도 돼요
- **동작**: 단축키, 문자 입력, 매크로, 미디어 키, 사운드보드, 앱·파일 열기, 페이지와 폴더 이동, 소리 출력 장치 바꾸기(Windows)
- **실시간 키**: 시계, 날짜, CPU, 메모리, GPU, 스톱워치
- **프로그램별 기능**: Photoshop, Premiere Pro, Figma, OBS, Claude, ChatGPT, DeepSeek 하네스, Steam, Ollama, VS Code, Antigravity, ComfyUI
- **편의 기능**: 프로그램에 따라 페이지 자동 전환, OS별 프리셋 3칸, 프리셋 내보내기·가져오기, 화면 보호, 로그인 시 자동 실행

## 보드 펌웨어

**이미 0.3.0 이상이 들어 있는 보드**는 앱의 **설정 → 펌웨어 업데이트**에서 최신 릴리스나 내려받은 `.bin` 파일로 바로 업데이트할 수 있어요. 버튼을 누를 필요가 없고, 터치 보정 값과 키 설정도 그대로 남아요. 새 펌웨어가 정상적으로 켜지지 않으면 보드가 이전 버전으로 스스로 돌아가요.

**새 보드나 0.3.0보다 오래된 보드**는 USB로 한 번 직접 올려야 해요.

1. ESP32의 **BOOT**를 누른 채 **RST**를 눌렀다 떼고, BOOT도 떼요.
2. [PlatformIO](https://platformio.org/)를 설치한 뒤 `firmware` 폴더에서 아래 명령을 실행해요.

```powershell
pio run -t upload
```

릴리스 펌웨어는 페이더가 달려 있고 위로 올릴수록 값이 커지도록 맞춰져 있어요. 페이더가 없는 보드는 `firmware/src/config.h`의 `FADERS_INSTALLED`를 `0`으로, 방향이 반대인 보드는 `FADER1_INVERT`·`FADER2_INVERT`를 바꿔 직접 빌드해 주세요.

## 하드웨어

- ESP32-S3-DevKitC-1 N16R8
- 4인치 480×320 ST7796S 화면 + XPT2046 터치
- EC11 엔코더 2개, 60 mm 페이더 2개
- 투명 아크릴 키 15개, 뒷면 USB-C

PCB 거버, 3D 출력 파일, 아크릴 도면은 [`hardware/`](hardware/)에 있고 치수와 핀 배정은 [`docs/hardware.md`](docs/hardware.md)에 있어요.

## 직접 빌드하기

```powershell
# 앱 (Node.js, Rust 필요)
cd app
npm install
npm run tauri dev

# 펌웨어 (PlatformIO 필요)
cd firmware
pio run
```

## 폴더

- `firmware/` — ESP32-S3 펌웨어 (PlatformIO)
- `app/` — PC 앱 (Tauri 2 + React)
- `docs/` — 하드웨어, 기기↔앱 통신 규격, 개발 순서
- `hardware/` — PCB, 3D 출력, 아크릴 제작 파일
