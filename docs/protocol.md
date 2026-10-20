# 기기 ↔ PC 앱 시리얼 규격 (v1)

USB CDC 시리얼(115200, 실제 속도는 무관), **한 줄에 JSON 하나**, 줄 끝은 `\n`. 한 줄은 최대 16 KB.
키 ID 0~14는 왼쪽 위부터 오른쪽으로, 위 줄(뒤쪽)부터 아래 줄(앞쪽) 순서. 노브·페이더 ID 0 = 1번(노브는 뒤쪽, 페이더는 왼쪽).
페이지 번호는 번들의 `pages` 배열 순서(0부터).

## 기기 → 앱 (이벤트)
| ev | 필드 | 의미 |
|---|---|---|
| `hello` | `fw`, `device`(MAC 12자리), `keys`, `knobs`, `faders`, `bundle`(저장된 번들 해시, 없으면 ""), `page` | 연결 확인 응답 |
| `key` | `id`, `down` 1/0, `page` | 화면 키 누름/뗌 (표시용) |
| `knob` | `id`, `delta` (+ 시계방향, 칸 수) | 노브 회전 (표시용) |
| `knobPress` | `id`, `down` 1/0 | 노브 누름/뗌 (표시용) |
| `fader` | `id`, `value` 0~1000 | 페이더 위치 (데드밴드 4). 페이더 기능은 앱이 실행 |
| `act` | `src`("key"/"knob"), `id`, `page`, `kind`, `n` | 앱이 실행해야 하는 동작(`{"a":1}`)이 눌렸음. kind: 키 `tap`/`long`/`dbl`/`off`, 노브 `cw`/`ccw`/`pr`/`pcw`/`pccw`. n = 노브 칸 수 |
| `page` | `n` | 보드 페이지가 바뀜 |
| `state` | `faders[2]`, `knobDown[2]`, `key`, `page` | `state` 요청 응답 |
| `ok` | - | 번들 전송 명령 성공 |
| `calibrated` | - | 터치 보정 완료 |
| `pong` | - | `ping` 응답 |
| `error` | `msg` | 알 수 없는 명령, 전송 실패 등 |

## 앱 → 기기 (명령)
| cmd | 필드 | 의미 |
|---|---|---|
| `hello` | | 기기 정보 요청 → `hello` |
| `ping` | | → `pong` |
| `state` | | → `state` |
| `calibrate` | | 터치 보정 화면 시작 |
| `page` | `n` | 페이지 이동 (앱의 프로그램별 자동 전환) → `page` |
| `tile` | `page`, `key`, `d`(base64 JPEG, 96×107) | 실시간 키(시계·CPU 등) 한 칸 다시 그리기. 그 페이지가 보일 때만 그림 |
| `bundle.begin` | `hash`, `size`(전체 바이트) | 번들 받기 시작: `/b/` 비움 → `ok` (공간 부족이면 `error`) |
| `file.open` | `path`(`/b/...`), `size` | 파일 쓰기 시작 → `ok` |
| `file.data` | `d`(base64, 원본 3072바이트 이하) | 이어 쓰기 → `ok` |
| `file.close` | | 크기 확인 → `ok` |
| `bundle.end` | `hash` | `/b/hash.txt` 저장, 설정 다시 읽고 첫 페이지 표시 → `ok` |

앱은 번들 명령마다 `ok`를 기다린 뒤 다음 줄을 보내요(5초 안에 없으면 실패).

## 번들 (`/b/`, 기기 LittleFS)
PC 앱이 "보드에 적용" 때 이 PC의 OS용 프리셋으로 만들어 보내요. 기기는 앱이 없어도 이것으로 동작해요.
- `config.json` — 아래 형식
- `p{n}.jpg` — 페이지 n 전체 화면 480×320 (기본 JPEG). 사용 불가 표시·제목 글자가 이미 그려져 있음
- `p{n}k{k}.jpg` — 토글 키가 켜졌을 때의 그 칸 그림
- `p{n}g{i}.gif` — 움직이는 이미지. 놓일 영역 크기 그대로, 프레임에 제목·사용 불가 표시가 그려져 있음
- `hash.txt` — 번들 해시. `hello`의 `bundle`로 알려 줘서 앱이 같은 번들을 다시 보내지 않게 함

```json
{
  "v": 1, "os": "windows", "saver": 5,
  "pages": [{
    "img": "/b/p0.jpg", "folder": 1,
    "keys": [{ "tap": 동작, "long": 동작, "dbl": 동작, "tg": 1, "off": 동작, "on": "/b/p0k3.jpg" }],
    "gifs": [{ "f": "/b/p0g0.gif", "x": 0, "y": 107, "w": 480, "h": 213 }],
    "live": [2, 3]
  }],
  "knobs": [{ "cw": 동작, "ccw": 동작, "pr": 동작, "pcw": 동작, "pccw": 동작 }]
}
```
- `saver`: 분. 입력이 없으면 화면을 검게 끔(0 = 안 함). 끈 뒤 첫 입력은 깨우기만 함
- `folder`: 폴더 페이지. 들어갈 때 이전 페이지를 기억하고 `back`으로 돌아감. `next`/`prev`는 폴더를 건너뜀
- `tg`: 토글 키. 꺼짐에서 누르면 `tap`, 켜짐에서 누르면 `off`(없으면 `tap`)
- `dbl`이 있으면 한 번 누르기는 0.25초 기다렸다 실행. `long`은 0.5초 누르고 있으면 실행(이때 떼어도 `tap` 없음)
- 노브: 누른 채 돌리면 `pcw`/`pccw`, 그때는 `pr`을 실행하지 않음. `pr`은 뗄 때 실행

### 동작 (기기가 직접 실행)
| 형식 | 의미 |
|---|---|
| `{"k":[[mods, usage], ...]}` | 키 조합을 차례로 누름. mods 비트: 1 Ctrl, 2 Shift, 4 Alt, 8 GUI(Win/Cmd). usage = HID 키보드 코드 |
| `{"c": code}` | 미디어 키(HID Consumer). 0xCD 재생, 0xB5 다음, 0xB6 이전, 0xE2 음소거, 0xE9/0xEA 볼륨 |
| `{"t": "text"}` | 영문(ASCII) 입력. 한글 등은 앱이 실행 |
| `{"s": [동작, {"d": ms}, ...]}` | 매크로: 순서대로, `d`는 기다리기 |
| `{"p": "next" / "prev" / "back" / n}` | 페이지 이동 |
| `{"a": 1}` | 앱이 실행: 기기는 `act` 이벤트만 보냄 (프로그램 실행·앱별 볼륨·OBS 등) |
| `null` | 없음 (이 OS에서 사용 불가인 기능도 null) |

## 번들이 없을 때 (기본 동작)
- 키 1~12 → F13~F24, 키 13~15 → Ctrl+F13~F15
- 노브 1 → 볼륨 ±, 누르면 음소거

## 버전 기록
- v1 (fw 0.2.0): 번들·페이지·`act`·`tile`·`page`, `hello`에 `bundle`/`page`, `key`에 `page`
- v0 (fw 0.1.0): 입력 이벤트와 hello/ping/state/calibrate
