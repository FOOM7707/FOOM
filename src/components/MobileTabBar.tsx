import { Link, useLocation } from "react-router-dom";
import { Map, Search, UserRoundPlus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 하단 고정 탭바 (모바일 전용, 스키마 없음 — 2026-08-28 모바일 최적화).
 *
 * **프립처럼 「앱 같은」 인상을 주는 자리입니다.** 자주 오가는 곳을 화면 맨 아래에
 * 고정해, 좁은 화면에서 햄버거를 열지 않고 한 번에 이동하게 합니다. 계정 관련
 * (마이페이지·관리자·예약내역)은 여기 넣지 않고 헤더의 축소 햄버거에 둡니다 —
 * 탭바는 「탐색」, 햄버거는 「내 계정」으로 역할을 가릅니다.
 *
 * **데스크톱(min-[769px])에서는 숨깁니다** — 그 폭에서는 헤더 가로 네비가 대신합니다.
 *
 * ⚠️ **하단에 자체 고정 바가 있는 화면(상세 「참여하기」·등록 「저장」)에서는
 *    이 탭바를 띄우지 않습니다.** 겹치면 하단이 두 줄이 됩니다 — 숨김 판단은
 *    `Layout`이 경로로 하고, 이 컴포넌트는 렌더될 때 늘 보입니다.
 *
 * 항목은 헤더 네비(`NAV_ITEMS`)와 같은 이동 규칙을 따르되, CTA인 「전문가로
 * 활동하기」를 세 번째 칸에 함께 둡니다(팀 요청, 2026-08-28).
 */

interface Tab {
  to: string;
  label: string;
  icon: typeof Search;
  /** 현재 이 탭이 활성인지 — 헤더 네비의 match 규칙과 같게 맞춥니다 */
  active: (path: string, search: string) => boolean;
}

const TABS: Tab[] = [
  {
    to: "/search",
    label: "프로그램 찾기",
    icon: Search,
    active: (path, search) => path === "/search" && !search.includes("view=map"),
  },
  {
    to: "/search?view=map",
    label: "지도로 찾기",
    icon: Map,
    active: (path, search) => path === "/search" && search.includes("view=map"),
  },
  {
    to: "/provider/apply",
    label: "전문가로 활동",
    // 헤더 계정 아이콘(UserRound)과 겹치지 않게 「사람+」을 씁니다 — 계정 보기가
    // 아니라 「활동 시작」이라는 뜻도 함께 담깁니다.
    icon: UserRoundPlus,
    active: (path) => path === "/provider/apply",
  },
];

export default function MobileTabBar() {
  const location = useLocation();

  return (
    <nav
      aria-label="하단 메뉴"
      // pb에 safe-area를 더해 아이폰 홈바에 라벨이 가리지 않게 합니다(index.html의
      // viewport-fit=cover와 짝). z-40: 상세/등록의 하단 바와 같은 층 — 그 화면에서는
      // Layout이 애초에 이 탭바를 렌더하지 않으므로 충돌하지 않습니다.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur min-[769px]:hidden"
    >
      <ul className="flex items-stretch">
        {TABS.map((tab) => {
          const active = tab.active(location.pathname, location.search);
          const Icon = tab.icon;
          return (
            <li key={tab.label} className="flex-1">
              <Link
                to={tab.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon
                  className="h-[22px] w-[22px]"
                  strokeWidth={active ? 2.25 : 1.75}
                  aria-hidden
                />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
