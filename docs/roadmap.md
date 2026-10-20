# 개발 순서

## 0. 준비 (부품 도착 전)
- [x] Windows에 Git, VS Code, PlatformIO 설치 (pio는 `F:\pio_env`), Node · Rust · MSVC Build Tools
- [~] 로컬 git 저장소 만듦 — GitHub에 올리기는 남음
- [x] `firmware`를 PlatformIO로 빌드 성공 (`pio run`)

## 1. 펌웨어 1단계 — ESP32 단독 테스트 (납땜 전)
- [ ] DevKit의 USB 포트로 업로드, PC가 "Kivo Deck" 키보드 + COM 포트로 인식
- [ ] 시리얼에 `{"cmd":"hello"}` → `hello` 응답

## 2. 조립 후 입력 확인
- [ ] 화면 15칸 표시, 방향(`DISPLAY_ROTATION`)·색 확인
- [ ] 터치 보정 → 15칸 각각 누르면 F13~ 키 입력 확인
- [ ] 노브 1 볼륨/음소거, 노브 2·페이더 값이 시리얼로 찍힘 (방향·0~1000 범위)

## 3. PC 앱 기초 (Tauri)
- [~] 기기 자동 연결(VID 0x303A + `hello`) · 이벤트 모니터 화면 완료 — 트레이 아이콘은 남음
- [ ] 페이더 → 시스템 볼륨 / 앱별 볼륨(Windows), 노브 2 → 지정 동작
- [ ] 키 동작 편집 화면 (단축키, 프로그램 실행, OBS)

## 4. 세팅을 기기에 저장
- [ ] protocol에 `config.get/set` 추가, LittleFS에 JSON 저장
- [ ] 다른 PC에 꽂아도 같은 동작, 앱 없는 PC에서는 HID 기본 동작

## 5. 마무리
- [ ] 키 아이콘 이미지 전송·표시, 페이지 전환
- [ ] 상태 피드백(음소거 표시 등)
- [ ] 설치 파일(.msi / .dmg), 친구용 한 장짜리 설명서
