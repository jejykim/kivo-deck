# Kivo Deck PC 앱

Kivo Deck 설정 앱이에요. 키·노브·페이더에 기능을 끌어다 놓고 "보드에 적용"을 누르면 보드에 저장돼요.

- 실행(개발): `npm install` 한 번, 그다음 `npm run tauri dev`
- 브라우저 미리보기: `npm run dev` 후 http://localhost:1420 (기기·Rust 없이 화면만)
- 설치 파일: GitHub에 `v*` 태그를 올리면 Actions가 만들어요 (`.github/workflows/release.yml`)

## 화면
- 왼쪽: 로그 (접혀 있음)
- 가운데: OS별 프리셋 3칸 → 페이지 → 보드 미리보기(키 15·노브 2·페이더 2) → 선택한 것의 설정
- 오른쪽: 기능 목록 (화면 표시, 페이지, 키보드, 미디어, 열기, 시간, 매크로, 앱 → 프로그램별 기능)

## 코드
| 파일 | 하는 일 |
|---|---|
| `src/model.ts` | 데이터 구조, 다른 OS 프리셋 빌려 쓰기 |
| `src/catalog.ts` | 기능 목록 전체, 프로그램별 기능 팩 (새 프로그램은 여기에 추가) |
| `src/keys.ts` | 단축키 문자열 ↔ HID 코드 |
| `src/render.ts` | 페이지 그리기 (앱 미리보기 = 보드 화면) |
| `src/bundle.ts` | 보드로 보낼 번들 + 앱이 실행할 동작 표 |
| `src/media.ts` | 이미지·GIF 불러오기, 영상 → GIF |
| `src/sync.ts` · `src/live.ts` | 보드에 적용, 실시간 키 |
| `src/components/` | 화면 |
| `src-tauri/src/` | 기기 연결·동작 실행·볼륨·OBS·저장 |
