# functions — 품(FOOM) Cloud Functions

루트 프론트엔드와 **별개의 패키지**입니다. 의존성을 섞지 않습니다(`functions/package.json`).

이번 단계는 **기반만** 있습니다. 업무 API(스키마 5번 목록)는 아직 없습니다.

## 구조

```
src/
  index.ts              함수 진입점 — export 되는 것은 api 하나뿐
  http/app.ts           Express 앱 조립, 라우트 등록
  http/middleware.ts    ★ 공통 진입부 — 인증·관리자 검사·에러 형식 (6-2 ①)
  lib/authz.ts          권한 판단 순수 함수 (네트워크와 분리 → 단위 테스트로 고정)
  lib/errors.ts         AppError + 코드→HTTP 상태 매핑
  lib/adminGrant.ts     관리자 지정/회수 로직 (13번 P0 / 12-3)
  lib/firebase.ts       Admin SDK 초기화
  config/secrets.ts     외부 키 보관 구조
  scripts/grant-admin.ts  관리자 지정 CLI
tests/                  functions 전용 테스트 (루트 tests/rules/ 와 분리)
```

## 왜 REST(onRequest + Express)인가

스키마 5번의 엔드포인트가 전부 `POST /admin/...` 형태의 REST 경로이고,
결제 웹훅(`POST /payments/webhook`)은 외부 PG가 직접 호출하므로 callable로는
받을 수 없습니다. 근거는 6-2 ①에 있습니다.

**CORS는 코드로 처리하지 않습니다.** `firebase.json`의 Hosting rewrite가
`/api/**`를 이 함수로 보내 같은 오리진이 되므로 교차 출처 요청 자체가
발생하지 않습니다. 프론트엔드는 `/api/...` 상대경로만 쓰면 됩니다.

> rewrite 순서 주의 — `/api/**`가 SPA rewrite(`**` → `/index.html`)보다
> **먼저** 와야 합니다. 뒤에 두면 API 호출이 전부 index.html을 받습니다.

라우터는 `/`와 `/api` 두 곳에 붙어 있습니다. 함수를 직접 호출할 때(에뮬레이터)는
접두사가 없고, Hosting rewrite를 거치면 `/api`가 붙은 채로 전달되기 때문입니다.

## 실행

```bash
npm install            # functions 디렉터리에서
npm run build          # tsc
npm test               # 에뮬레이터(auth+functions+firestore)에서 전체 테스트
npm run serve          # 에뮬레이터 상시 실행
```

에뮬레이터는 항상 `--project demo-foom`으로 실서버와 분리해 실행합니다.

```bash
# 상태 확인
curl http://127.0.0.1:5001/demo-foom/asia-northeast3/api/health
```

리전은 `asia-northeast3`(서울)입니다. 배포 후에는 리전을 바꾸려면 함수를 지웠다
다시 만들어야 하므로 착수 시점에 고정했습니다. Hosting rewrite에도 같은 값이
적혀 있어야 연결됩니다.

## 외부 키

| 값 | 파일 | 형태 |
|---|---|---|
| 네이버 Client **ID** (서버) | `functions/.env` | `defineString('NAVER_CLIENT_ID')` |
| 네이버 Client **ID** (프론트) | 루트 `.env` | `VITE_NAVER_CLIENT_ID` |
| 네이버 Client **Secret** | 로컬 `functions/.secret.local` / 운영 Firebase 시크릿 | `defineSecret('NAVER_CLIENT_SECRET')` |

`.env.example`과 `.secret.local.example`을 각각 복사해 값을 채우세요.
두 파일 모두 값이 비어 있는 상태로 커밋돼 있습니다.

> ⚠️ **Client Secret에 `VITE_` 접두사를 붙이지 마세요.** Vite는 `VITE_`로 시작하는
> 환경변수를 빌드 결과물에 그대로 인라인하므로 브라우저에서 누구나 읽게 됩니다.

운영 환경에는 시크릿을 이렇게 등록합니다(배포 시점에):

```bash
firebase functions:secrets:set NAVER_CLIENT_SECRET
```

키가 없으면 `requireSecret()`이 **어느 키가 어디에 없는지** 알려주며 즉시
실패합니다. 조용히 빈 값으로 진행하지 않습니다. 설정 여부만 확인하려면
`GET /api/admin/config/status` — **값은 어떤 경로로도 내보내지 않습니다.**

### 에뮬레이터 로그의 Secret Manager 오류

`.secret.local`의 값이 비어 있으면 에뮬레이터가 실제 Secret Manager를 조회하려다
`Authentication Error ...` 를 남깁니다. 동작에는 영향이 없고(테스트는 그대로
통과합니다), 값을 채우면 사라집니다.

## 관리자 지정 (13번 P0)

`users.role='admin'`과 Custom Claims `admin:true`를 **반드시 함께** 갱신합니다.
보안규칙의 `isAdmin()`은 Custom Claims만 보고 화면 메뉴는 `users.role`을 보므로,
하나만 하면 반쪽짜리 상태가 됩니다.

```bash
npm run grant-admin -- --uid <uid>            # 지정
npm run grant-admin -- --email <이메일>
npm run grant-admin -- --uid <uid> --check    # 현재 상태 점검
npm run grant-admin -- --uid <uid> --revoke   # 회수(+세션 무효화)
```

- 대상 프로젝트와 환경(에뮬레이터/실서버)을 먼저 출력하고, **실서버면 `--yes` 없이는
  실행하지 않습니다.**
- **가입을 마친 계정**(Auth 계정 + `users/{uid}` 문서)에만 부여합니다 — 12-3의
  "공용 계정 금지, 개인 계정에 권한 부여" 원칙입니다.
- 갱신 순서와 실패 시 롤백 근거는 `src/lib/adminGrant.ts` 상단 주석에 있습니다.
- 지정 후 대상자는 **재로그인하거나 `getIdToken(true)`** 로 토큰을 갱신해야
  반영됩니다(6-2 ②).

## 아직 안 한 것

- `checkRevoked=true` — P1. `http/middleware.ts`에 TODO로 표시돼 있습니다(6-2 ②)
- 업무 API 전체(5번 목록)
