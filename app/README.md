# Kivo Deck PC 앱 (계획)

아직 코드는 없어요. Claude Code에서 아래 계획으로 시작하면 돼요.

## 기술
- **Tauri 2** (Rust 백엔드 + 웹 프런트엔드). Windows 먼저, Mac은 같은 코드로 나중에
- 프런트엔드: TypeScript + 가벼운 UI(바닐라 또는 React 중 편한 쪽)
- 시리얼: Rust `serialport` 크레이트. 포트 목록에서 `hello` 응답이 오는 장치를 자동으로 찾기
- 키 입력·프로그램 실행: Rust `enigo` 등. 시스템 볼륨: Windows Core Audio(`windows` 크레이트), 앱별 볼륨은 `IAudioSessionManager2`
- OBS: obs-websocket v5 (OBS 28 이상 내장)

## 처음 할 일 (Windows)
1. Node.js LTS, Rust(rustup), "Microsoft C++ Build Tools" 설치 — Tauri 공식 Prerequisites 문서 순서대로
2. `npm create tauri-app@latest` 로 이 폴더(app/)에 프로젝트 생성
3. 시리얼로 기기에 연결해 `docs/protocol.md`의 이벤트를 화면에 그대로 찍는 것부터

## 화면 구성 (초안)
- 트레이 아이콘: 연결 상태, 설정 열기, 종료
- 설정 창: 5×3 키 격자를 눌러 키마다 동작 지정, 노브 2개·페이더 2개 동작 지정, 페이지 추가
- 동작 종류: 단축키, 프로그램/웹 열기, 볼륨(시스템/앱별), 미디어 키, OBS 장면·녹화·방송, 페이지 이동
