# 품(FOOM) 프론트엔드 — 스캐폴드 (Sprint 1, 로그인 제외)

`FOOM_전체_스프린트_로드맵_8월~12월.md`의 착수주(8/13~8/16) 항목 중 "프론트 프로젝트 초기 셋업 + mock 데이터 구조 설계"를 반영한 초기 스캐폴드입니다. 로그인/인증 화면은 이번 단계에서 의도적으로 제외했습니다(버튼은 자리만 잡아두고 비활성화).

## 스택

- Vite + React 19 + TypeScript
- react-router-dom (클라이언트 라우팅)
- Tailwind CSS v4 + shadcn/ui 스타일 컴포넌트 (Button/Card/Input/Textarea/Label/Badge/Select)
  - 토스 디자인 시스템(TDS)은 "앱인토스" 파트너 전용 폐쇄형 라이선스라 외부 독립 서비스에는 쓸 수 없어서, 완전 무료(MIT)이고 업계에서 널리 쓰이는 shadcn/ui + Tailwind 조합으로 비슷한 톤을 구현했습니다.
  - `npx shadcn add <component>`로 새 컴포넌트를 더 추가할 수 있습니다(이 작업환경 네트워크에서는 `ui.shadcn.com` 접속이 막혀 있어 컴포넌트를 표준 소스 그대로 직접 작성해뒀습니다 — 실제로는 동일한 코드입니다. 팀원 컴퓨터에서는 정상적으로 CLI가 작동할 것입니다).

## 실행 방법

```bash
npm install
npm run dev       # 개발 서버
npm run build     # 프로덕션 빌드 (tsc 타입체크 포함)
npm run preview   # 빌드 결과 로컬 미리보기
```

## 폴더 구조

```
src/
  types/firestore.ts     # 백엔드 스키마(FOOM_백엔드_설계_스키마_20260807.md) 기준 타입 정의
  mocks/                 # 화면 개발용 mock 데이터 (programs, providers, schedules)
  lib/utils.ts           # shadcn/ui 표준 cn() 헬퍼
  components/
    ui/                  # shadcn/ui 스타일 기본 컴포넌트 (button, card, input, textarea, label, badge, select)
    Layout.tsx            # 헤더/네비/푸터
    ProgramCard.tsx       # 프로그램 카드
  pages/                 # 화면 단위
    HomePage             # 홈 (와이어프레임 v2 "1. 홈" 대응)
    SearchPage           # 프로그램 찾기 (와이어프레임 v2 "2. 프로그램 찾기" 대응)
    ProgramDetailPage    # 프로그램 상세 (와이어프레임 v2 "3. 프로그램 상세" 대응)
    ProgramRegisterPage  # 프로그램 등록 (공급자용, mock 제출만 구현)
components.json          # shadcn CLI 설정 (팀원 컴퓨터에서 `npx shadcn add`로 컴포넌트 추가 시 사용)
```

브랜드 컬러(그린 `#1F5C43` 계열)는 `src/index.css`에 shadcn/ui 표준 CSS 변수(`--primary`, `--secondary` 등)로 매핑해뒀습니다. 색을 바꾸고 싶으면 이 파일의 `:root` 블록만 수정하면 전체 컴포넌트에 반영됩니다.

## 지금 안 되는 것 (의도적으로 미구현)

- 로그인/회원가입 (카카오·네이버 소셜, 문자인증) — 헤더의 "로그인 (준비중)" 버튼은 비활성화 상태
- 예약/결제 — 상세 화면의 "예약하기 (준비중)" 버튼은 비활성화 상태
- 실제 백엔드 연동 — 모든 데이터는 `src/mocks/`의 하드코딩된 값이며, 프로그램 등록 폼 제출도 콘솔 로그만 남기고 저장되지 않음

## 백엔드 연동 시 교체 지점

1. `src/mocks/programs.ts`, `src/mocks/providers.ts` → `GET /programs`, `GET /programs/{id}` 등 실제 API 호출로 교체 (API 명세는 스키마 문서 5번 참고)
2. `ProgramRegisterPage.tsx`의 `handleSubmit` → `POST /programs` 호출로 교체
3. 로그인 연동 확정 후 `Layout.tsx`의 로그인 버튼과 라우팅에 인증 가드 추가

## Git / 협업

브랜치 전략은 `feature/영역-기능명` (예: `feature/frontend-search-page`) 형식의 GitHub Flow를 따릅니다. 자세한 내용은 스키마 문서 v6의 "9. 개발 협업 전략" 섹션 참고.
