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
- [ ] 입실 번호(FR-WEB-005), 내 예약(FR-WEB-002) …
- 이용 수칙 내용·동의 버전은 `src/content/rules.ts`에 둔다(core에 `GET /api/rules`·동의 저장 API가 생기면 바꾼다)
- 알려진 한계: `GET /api/rooms/availability`가 칸마다 "지남"과 "예약됨"을 구분하지 않아서, 지금 이전의 예약은 막대에 그리지 않는다.
