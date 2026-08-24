/**
 * 마이페이지 — 사이드바(LNB) + 메인 영역 (스키마 2-1 · 5번).
 *
 * `GET /users/me`가 내려주는 값만 씁니다 — 화면이 Firestore를 직접 읽지 않는
 * 이유는 `lib/users.ts`에 적혀 있습니다(문서 2~3개를 화면마다 따로 읽으면 어느
 * 화면은 읽고 어느 화면은 빠뜨리는 상태가 생깁니다). 서버 호출은 **여기 한 곳**
 * 이고, 각 메뉴 컴포넌트는 받은 값만 그립니다.
 *
 * **메뉴는 계정에 따라 만들어집니다.** 전문가 활동은 전문가 계정에만, 관리자는
 * 토큰 클레임에 `admin`이 있을 때만 생깁니다 — 해당 없는 메뉴가 늘어나면 정작
 * 쓰는 것을 찾기 어려워집니다. **메뉴를 숨기는 것은 보안이 아닙니다**(12-3).
 *
 * **선택한 메뉴는 주소에 남깁니다**(`/my?tab=…`). 검색 필터를 URL에 두는 것과
 * 같은 이유이고(17-4 ⑤), 덕분에 다른 화면에서 특정 탭으로 바로 보낼 수 있습니다 —
 * `/provider/apply`의 「심사 상태 보기」가 그렇게 씁니다. **`replace`로 바꿔서
 * 뒤로가기가 탭 이동 기록에 갇히지 않게** 했습니다 — 탭을 세 번 누른 뒤 뒤로
 * 가려는 사람은 마이페이지를 벗어나려는 것입니다.
 */

import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useMe, type Me } from "@/hooks/useMe";
import { cn } from "@/lib/utils";
import ProfileSection from "./my/ProfileSection";
import BookingsSection from "./my/BookingsSection";
import ProviderSection from "./my/ProviderSection";
import AdminSection from "./my/AdminSection";

interface MenuItem {
  key: string;
  label: string;
  /** 메뉴 아래 한 줄 설명. 사이드바가 좁을 때는 감춥니다 */
  hint: string;
  render: (ctx: { me: Me; reload: () => void }) => React.ReactNode;
}

/**
 * 메뉴 목록. **첫 번째가 기본으로 열립니다.**
 *
 * 순서는 「누가 얼마나 자주 쓰는가」입니다 — 내 정보와 예약내역은 모든 회원이,
 * 전문가 활동과 관리자는 해당하는 사람만 씁니다.
 */
function buildMenu(me: Me, isAdmin: boolean): MenuItem[] {
  const items: MenuItem[] = [
    {
      key: "profile",
      label: "내 정보",
      hint: "이름·연락처",
      render: ({ me: m, reload }) => <ProfileSection me={m} onSaved={reload} />,
    },
    {
      key: "bookings",
      label: "예약내역",
      hint: "준비 중",
      render: () => <BookingsSection />,
    },
  ];

  if (me.role === "provider") {
    items.push({
      key: "provider",
      label: "전문가 활동",
      hint: "자격 심사·프로그램",
      render: ({ me: m }) => <ProviderSection me={m} />,
    });
  }

  if (isAdmin) {
    items.push({
      key: "admin",
      label: "관리자",
      hint: "심사 화면",
      render: () => <AdminSection />,
    });
  }

  return items;
}

export default function MyPage() {
  const { user, loading: authLoading, isAdmin, logout } = useAuth();
  const { me, loading, error, reload } = useMe();
  const [params, setParams] = useSearchParams();

  const menu = useMemo(() => (me ? buildMenu(me, isAdmin) : []), [me, isAdmin]);

  const requested = params.get("tab");
  // 주소에 없는 탭이나 이 계정에 없는 탭을 요청하면 첫 메뉴로 떨어집니다 —
  // 권한이 없어진 뒤 옛 주소를 열었을 때 빈 화면이 되지 않게 합니다.
  const active = menu.find((m) => m.key === requested) ?? menu[0];

  // 주소에 잘못된 탭이 남아 있으면 정리합니다. 화면이 보여주는 것과 주소가
  // 다르면, 그 주소를 복사해 공유했을 때 다른 화면이 열립니다.
  useEffect(() => {
    if (!active) return;
    if (requested !== null && requested !== active.key) {
      const next = new URLSearchParams(params);
      next.set("tab", active.key);
      setParams(next, { replace: true });
    }
  }, [active, requested, params, setParams]);

  function selectTab(key: string) {
    const next = new URLSearchParams(params);
    next.set("tab", key);
    setParams(next, { replace: true });
  }

  if (authLoading || loading) {
    return <div className="container mx-auto max-w-4xl px-5 py-8">불러오는 중…</div>;
  }

  if (!user) {
    return (
      <div className="container mx-auto max-w-4xl px-5 py-8">
        <h1 className="mb-5 text-[22px] font-bold">마이페이지</h1>
        <Card className="bg-secondary">
          <CardContent className="pt-6">
            <p className="text-sm">로그인이 필요합니다. 우측 상단에서 로그인해 주세요.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !me || !active) {
    return (
      <div className="container mx-auto max-w-4xl px-5 py-8">
        <h1 className="mb-5 text-[22px] font-bold">마이페이지</h1>
        <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
          {error ?? "내 정보를 불러오지 못했습니다"}
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl px-5 py-8 pb-20">
      <h1 className="mb-6 text-[22px] font-bold">마이페이지</h1>

      {/* 좁은 화면에서는 사이드바가 위쪽 가로 줄로 접힙니다 — 200px 고정 열을
          그대로 두면 휴대폰에서 본문이 손가락 두 개 너비가 됩니다. */}
      <div className="grid gap-6 md:grid-cols-[184px_1fr] md:gap-8">
        {/* ── 사이드바(LNB) ──────────────────────────────────────── */}
        <nav aria-label="마이페이지 메뉴">
          <ul
            className={cn(
              // 좁은 화면: 가로로 나열하고 넘치면 옆으로 밀립니다
              "-mx-1 flex gap-1 overflow-x-auto px-1 pb-1",
              // 넓은 화면: 세로 목록
              "md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0 md:pb-0"
            )}
          >
            {menu.map((item) => {
              const selected = item.key === active.key;
              return (
                <li key={item.key} className="shrink-0 md:shrink">
                  <button
                    type="button"
                    onClick={() => selectTab(item.key)}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "w-full whitespace-nowrap rounded-lg px-3.5 py-2.5 text-left transition-colors",
                      "md:whitespace-normal",
                      selected
                        ? "bg-secondary font-bold text-primary"
                        : "font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    )}
                  >
                    <span className="block text-[14.5px]">{item.label}</span>
                    {/* 설명은 세로 목록에서만 — 가로로 접힐 때는 줄이 두 겹이 되어
                        메뉴가 본문보다 커집니다. */}
                    <span
                      className={cn(
                        "mt-0.5 hidden text-[11.5px] font-normal md:block",
                        selected ? "text-primary/70" : "text-muted-foreground/70"
                      )}
                    >
                      {item.hint}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* 로그아웃은 메뉴가 아니라 계정 동작이라 선을 그어 갈라둡니다 */}
          <div className="mt-4 hidden border-t pt-4 md:block">
            <Button variant="outline" size="sm" onClick={() => void logout()}>
              로그아웃
            </Button>
          </div>
        </nav>

        {/* ── 메인 콘텐츠 ────────────────────────────────────────── */}
        <div className="min-w-0">
          <Card>
            <CardContent className="pt-6">
              <h2 className="mb-5 border-b pb-3 text-base font-extrabold">{active.label}</h2>
              {active.render({ me, reload })}
            </CardContent>
          </Card>

          {/* 좁은 화면에서는 사이드바 아래가 아니라 본문 끝에 둡니다 */}
          <div className="mt-6 md:hidden">
            <Button variant="outline" size="sm" onClick={() => void logout()}>
              로그아웃
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
