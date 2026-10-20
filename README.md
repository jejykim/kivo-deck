# Kivo Deck

Kivo Lab의 DIY 스트림덱: 4" 터치 화면 위 투명 아크릴 키 15개, 노브 2개, 페이더 2개, ESP32-S3.

## Claude Code로 이어서 하는 방법 (Windows)
1. 이 폴더를 예를 들어 `C:\dev\kivo-deck`에 풀기
2. 이 폴더에서 Claude Code를 열고 이렇게 시작하세요:
   > CLAUDE.md랑 docs/roadmap.md 읽고, 0단계부터 같이 진행하자. GitHub 저장소 만드는 것도 도와줘.
3. 펌웨어 1단계는 ESP32만 PC에 꽂아서 할 수 있어요 (납땜 전)

## 폴더
- `firmware/` — ESP32-S3 펌웨어 (PlatformIO)
- `app/` — PC 앱 계획 (Tauri)
- `docs/` — 하드웨어 · 통신 규격 · 개발 순서
- `hardware/` — PCB · 3D 출력 · 아크릴 제작 파일 (주문 완료)
