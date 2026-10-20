# 기기 ↔ PC 앱 시리얼 규격 (v0)

USB CDC 시리얼(115200, 실제 속도는 무관), **한 줄에 JSON 하나**, 줄 끝은 `\n`.
키 ID 0~14는 왼쪽 위부터 오른쪽으로, 위 줄(뒤쪽)부터 아래 줄(앞쪽) 순서. 노브·페이더 ID 0 = 1번(노브는 뒤쪽, 페이더는 왼쪽).

## 기기 → 앱 (이벤트)
| ev | 필드 | 의미 |
|---|---|---|
| `hello` | `fw`, `device`(MAC 12자리), `keys`, `knobs`, `faders` | 연결 확인 응답 |
| `key` | `id`, `down` 1/0 | 화면 키 누름/뗌 |
| `knob` | `id`, `delta` (+ 시계방향, 칸 수) | 노브 회전 |
| `knobPress` | `id`, `down` 1/0 | 노브 누름/뗌 |
| `fader` | `id`, `value` 0~1000 | 페이더 위치 (데드밴드 4) |
| `state` | `faders[2]`, `knobDown[2]`, `key` | `state` 요청 응답 |
| `calibrated` | - | 터치 보정 완료 |
| `pong` | - | `ping` 응답 |
| `error` | `msg` | 알 수 없는 명령 등 |

예: `{"ev":"fader","id":1,"value":523}`

## 앱 → 기기 (명령)
| cmd | 의미 |
|---|---|
| `hello` | 기기 정보 요청 → `hello` |
| `ping` | → `pong` |
| `state` | 페이더 현재값 등 → `state` (앱이 연결 직후 볼륨을 맞출 때 사용) |
| `calibrate` | 터치 보정 화면 시작 |

예: `{"cmd":"state"}`

## 다음 버전에서 추가할 것 (계획)
- `config.get` / `config.set`: 페이지·키 동작·아이콘 세팅 JSON 읽기/쓰기 (기기 LittleFS가 원본)
- `icon.put`: 키 아이콘 이미지 전송 (청크 단위, base64)
- `page`: 페이지 전환 이벤트, `feedback`: 음소거 같은 상태를 키 화면에 표시
- 앱 연결 중에는 HID 기본 동작(F13~)을 끌지 선택하는 `hid` 명령
