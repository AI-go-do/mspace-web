# mspace-web

M-space 창작실 예약 화면(PWA). 폰 브라우저에서 열고 홈 화면에 추가해서 쓴다.

- 요구사항: [docs/requirements](https://github.com/AI-go-do/docs/blob/main/requirements/requirements.md) (FR-WEB-*, 7.6 화면 디자인 기준)
- 화면 시안: PWA 화면 시안(Design 캔버스, 18장)

## 실행

```bash
npm install
npm run dev          # http://localhost:5173, /api는 localhost:8080(core)로 넘어감
# infra compose로 core를 띄웠으면(core 포트가 안 열림) 입구 포트로 보낸다
VITE_API_TARGET=http://localhost:8411 npm run dev
```

로그인 코드는 core가 메일 대신 로그에 찍는다(`MAIL_ENABLED=false`일 때): `docker compose logs core | grep 인증번호`.

core를 안 띄웠으면 홈이 예시 데이터로 보이고 "예시" 표시가 붙는다. 일부러 예시로 보려면 `VITE_API_MOCK=true npm run dev`.

관리자 "지금" 탭(방별 CO2·온도·습도·재실)은 core API(`GET /api/admin/rooms/environment`)가 생기기 전까지 **가짜 값**으로 그린다(화면에 "가짜 값" 표시).
core API가 생기면 `VITE_ADMIN_ENV_SOURCE=api`로 빌드하면 된다. 방 이름·센서 목록·이상 기준은 `src/config/adminRooms.ts` 한 곳에서 고친다.
관리자 "방 관리"의 기간 막기는 `VITE_ADMIN_BLOCKS_SOURCE=api`로 빌드하면 core API(`/api/admin/room-blocks`, core #98)를 쓰고, 아니면 이 브라우저에만 남는 가짜 저장소를 쓴다. 개발 서버(develop)만 api다. 학생 화면의 막힌 칸·사유는 core 빈방 조회(core #103)가 준다.
학생 빈방 릴레이(기다리기·넘겨받기)는 `VITE_RELAY_SOURCE=api`로 빌드하면 core API(`/api/relay/…`, core #101)를 쓴다. 개발 서버(develop)만 api이고, 시연 서버(main)는 core main에 릴레이가 들어갈 때까지 보통 주소에서 숨긴다.
홈 방 줄의 눈 표시(비면 알려 줘요)는 `VITE_ROOM_WATCH_SOURCE=api`로 빌드하면 core 빈방 알림(`/api/room-watches`, core #109)에도 켜고 꺼서, 앱을 닫아 둬도 방이 비면 알림함으로 온다. 개발 서버(develop)만 api이고, 아니면 이 폰에만 두고 앱이 열려 있을 때 비서 카드로만 알린다.
core API가 아직 없거나 시연 서버에서 숨긴 화면(방의 사과·빈방 릴레이)은 주소 끝에 `?demo=1`을 붙여 열면 예시 데이터로 보인다(그 탭에서만, `?demo=0`으로 끔). 보통 주소로 연 학생 화면에는 나오지 않는다. 릴레이 예시는 예약된 칸을 눌러 기다리기를 걸면 20초 뒤 홈에 넘어온 칸 카드가 뜨고 5분 동안 받을 수 있다(실제 예약은 만들지 않음).
에어컨·공기청정기(창작실은 학생이 직접 켜고 끈다)도 가짜 단계다. 관리자 "지금" 탭의 방 줄·방 상세 창과 학생 홈 `?demo=1`의 "내 방 공기" 카드에서 권유(숨 막히기 N분 전·더움·추움·빈 방 끄기)와 켜기·끄기를 누를 수 있지만 이 화면 안에서만 바뀐다. core API가 생기면 `VITE_APPLIANCE_SOURCE=api`로 빌드한다(초안 `POST /api/rooms/{roomId}/appliances/{applianceId}/commands`). 기기 목록·기준 온도는 `src/config/appliances.ts`에서 고친다.

계절·한파·폭염: 켤지 말지는 방 안 센서로 정하고, 바깥 날씨는 기준 온도와 "얼마나 미리 켤지"만 바꾼다. 계절은 광주 평년 기온으로 나눈다(11–3월 겨울: 19°C 아래면 난방 20°C, 6–9월 여름: 27°C부터 냉방 26°C). 한파(최저 -12°C 이하)·폭염(최고 33°C 이상)인 날은 다음 예약 90분 전부터 미리 켠다(보통 60분). 학생이 손으로 바꾼 기기는 그 예약이 끝날 때까지 자동이 건드리지 않는다. 바깥 날씨는 기본이 평년값으로 만든 가짜 값이고, 주소에 `?weather=cold`(한파)·`?weather=hot`(폭염)·`?weather=0`(끔)을 붙이면 그 탭에서 시연 날씨로 바뀐다. `VITE_WEATHER_SOURCE=open-meteo`로 빌드하면 Open-Meteo(무료, 키 없음)에서 오늘 값을 받는다. 숫자는 `WEATHER_RULES`에서 고친다.

AI 학습(11/9): 규칙이 켤지 말지를 정하고, 학습은 방마다 "얼마나 미리, 몇 도로"만 고친다. ① 지난 가동 기록에서 방마다 1°C 바꾸는 데 걸린 분(가운데값)을 배워, 다음 예약 전 목표까지 걸릴 시간 + 10분 전에 켠다(15–120분 안, 한파·폭염은 1.3배). ② 학생이 목표 전에 손으로 끈 온도가 3번 넘게 모이면 그 가운데값으로 목표를 반 도씩 고친다(난방은 추움 기준 위·18°C 이상, 냉방은 더움 기준 아래). 기록이 3개보다 적으면 기본 규칙 그대로다. 근거는 방 상세 창 "AI 이 방에서 배운 것"과 권유 카드의 AI 줄에 그대로 보인다. 지금은 만든 기록(`api/climateLearnData.ts`)과 이 탭에서 학생이 끈 기록으로 배우고, `VITE_APPLIANCE_SOURCE=api`면 core가 기록을 주기 전까지 배우지 않는다. 숫자는 `LEARN_RULES`.

| 명령 | 하는 일 |
|---|---|
| `npm test` | 시간 계산 테스트(Vitest) |
| `npm run build` | 타입 검사 + `dist/` 빌드(service worker 포함) |
| `docker build -t mspace-web .` | nginx 이미지. `/api`는 앞단 nginx가 core로 보낸다 |

## 구조

| 폴더 | 내용 |
|---|---|
| `src/api` | core API 호출(`client.ts`, 토큰 붙이기·자동 갱신), 응답 타입, 예시 데이터 |
| `src/auth` | 토큰 보관, 로그인 상태(`AuthProvider`), 로딩 화면 |
| `src/lib` | 시간 계산(서울 기준, 30분 칸 → 막대) |
| `src/pages` | 화면. 지금은 홈(FR-WEB-004)만 있고 나머지는 자리만 |
| `src/styles/tokens.css` | 색 4+2개, 글꼴, 44px 등 디자인 기준 |

## 지금 상태

- [x] 홈: 배치도 순서(창작실 5 → 1), 오늘 0–24시 막대, 지금 빈 방 수
- [x] 로그인(FR-AUTH-001·002): 학교 메일 → 6자리 코드(처음이면 이름·학번), 자동 로그인(refresh 토큰은 HttpOnly 쿠키, 액세스 토큰은 메모리에만. 동시에 한 번만)
- [x] 예약(FR-WEB-001·006): 날짜 7칩 → 하루 48칸 → 함께 쓸 사람(학번 검색) → 처음만 수칙 동의 → 예약, 거절되면 이유·다음 행동 시트
- [x] 입실 번호(FR-WEB-005): 예약 직후·홈 '오늘 내 예약' 카드에서 열림, 대표자에게만 번호, 입실 마감 시각, 참여자에게 보내기
- [x] 홈: 오늘 내 예약 구간을 노랑으로
- [x] 내 예약(FR-WEB-002): 사용 중 카드(남은 시간·막대·퇴실), 다가오는/지난, 상세(참여자·시작 전 취소 확인), 퇴실(정리 체크·조기 퇴실 확인), 로그아웃
- [x] 이용 규칙(FR-WEB-003): 예약 규칙 6칸, 방에서 지킬 것(요구사항 3.1), 제재 단계. 로그인 없이 열림
- [x] 지금 바로 쓰기(FR-WEB-102): 지금 빈 방 → 끝 시각 칩(다음 예약 전·2시간 안) → 10분 안 입실 안내 → 입실 번호
- [x] 배치도 탭: 실제 배치 순서로 방을 크게, 지금 비었는지·언제까지, 고르면 시간 고르기로
- [ ] 알림(FR-NTF-103, v0.2 API 없음), 비서(agent 채팅 API가 develop에 들어오면)
- 이용 수칙 내용·동의 버전은 `src/content/rules.ts`에 둔다(core에 `GET /api/rules`·동의 저장 API가 생기면 바꾼다)
- 알려진 한계: `GET /api/rooms/availability`가 칸마다 "지남"과 "예약됨"을 구분하지 않아서, 지금 이전의 예약은 막대에 그리지 않는다.
