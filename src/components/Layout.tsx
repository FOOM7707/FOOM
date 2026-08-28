import { Link, Outlet, useLocation } from "react-router-dom";
import { TreePine, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import LoginDialog from "./LoginDialog";
import MobileTabBar from "./MobileTabBar";
import { useAuth } from "@/hooks/useAuth";
import { CATEGORIES } from "@/types/firestore";

/**
 * 공통 레이아웃 — 디자인 초안(docs/디자인-웹페이지-초안.html) 헤더·푸터 기준.
 *
 * **마이페이지는 로그인한 사람에게만 보입니다** — 비로그인 상태에서 눌러도
 * 「로그인이 필요합니다」만 나오므로, 메뉴에 두면 헛걸음이 됩니다.
 * **예약내역은 아직 「준비중」입니다** — 예약·결제가 없어 볼 목록이 없습니다.
 * 내역은 마이페이지 안에 자리를 만들어 두었습니다.
 */

const NAV_ITEMS: { to: string; label: string; match?: (path: string, search: string) => boolean }[] = [
  {
    to: "/search",
    label: "프로그램 찾기",
    match: (path, search) => path === "/search" && !search.includes("view=map"),
  },
  {
    to: "/search?view=map",
    label: "지도로 찾기",
    match: (path, search) => path === "/search" && search.includes("view=map"),
  },
];

const DISABLED_NAV = ["예약내역"];

function DisabledLink({ label, className }: { label: string; className?: string }) {
  return (
    <span
      aria-disabled="true"
      title="준비중"
      className={cn("cursor-not-allowed select-none", className)}
    >
      {label}
    </span>
  );
}

export default function Layout() {
  const location = useLocation();
  // 관리자에게만 메뉴를 보여줍니다(12-3). **메뉴를 숨기는 것은 보안이 아닙니다** —
  // 누구나 주소창에 /admin 을 칠 수 있고, 실제 차단은 함수 진입부와 보안규칙이 합니다.
  const { isAdmin, user } = useAuth();

  // 하단 탭바를 숨길 화면 — 상세(`/programs/:id`)·등록·수정(`/programs/new`,
  // `/programs/:id/edit`)은 하단에 「참여하기」·「저장」 고정 바가 이미 있어,
  // 탭바를 함께 띄우면 하단이 두 줄로 겹칩니다. 이 화면들만 `/programs/`로 시작합니다
  // (목록은 `/search`라 해당 없음). 탭바가 없는 화면은 본문 하단 여백도 빼야
  // 빈 공간이 남지 않습니다.
  const hideTabBar = location.pathname.startsWith("/programs/");

  return (
    <div className="flex min-h-screen flex-col">
      {/* 1. 헤더 — 로고 / 네비 / 로그인 + 전문가로 활동하기 */}
      <header className="sticky top-0 z-50 h-[60px] w-full border-b border-border bg-header/95 backdrop-blur">
        <div className="flex h-full w-full items-center justify-between gap-4 px-5 min-[769px]:px-10">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-1.5 text-[20px] font-extrabold text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            <TreePine className="h-[19px] w-[19px]" strokeWidth={1.75} aria-hidden />
            품 FOOM
          </Link>

          <nav className="hidden min-[769px]:block">
            <ul className="flex items-center gap-9">
              {NAV_ITEMS.map((item) => (
                <li key={item.label}>
                  <Link
                    to={item.to}
                    className={cn(
                      "text-[15px] font-semibold text-foreground transition-colors hover:text-primary",
                      item.match?.(location.pathname, location.search) && "text-primary"
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              {DISABLED_NAV.map((label) => (
                <li key={label}>
                  <DisabledLink
                    label={label}
                    className="text-[15px] font-semibold text-muted-foreground"
                  />
                </li>
              ))}
              {user && (
                <li>
                  <Link
                    to="/my"
                    className={cn(
                      "text-[15px] font-semibold text-foreground transition-colors hover:text-primary",
                      location.pathname === "/my" && "text-primary"
                    )}
                  >
                    마이페이지
                  </Link>
                </li>
              )}
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            {/* 좁은 화면에서 관리자·「전문가로 활동하기」는 숨깁니다 — 전문가는 하단
                탭바, 관리자는 마이페이지 탭으로 접근합니다. 헤더에는 로그인 버튼과
                (로그인 시) 마이페이지 아이콘만 남겨 로고와 한 줄에 들어가게 합니다. */}
            {isAdmin && (
              <Link
                to="/admin"
                className="hidden text-[13px] font-bold text-primary underline-offset-4 hover:underline min-[769px]:inline"
              >
                관리자
              </Link>
            )}
            <LoginDialog />
            {/* 공급자가 아닌 사용자를 등록 폼으로 바로 보내면, 폼을 다 채운 뒤에야
                권한 거부를 만나게 됩니다. 안내 화면을 거치게 합니다(15-1). */}
            <Link
              to="/provider/apply"
              className="hidden rounded-md bg-primary px-4 py-[7px] text-[13px] font-bold text-primary-foreground transition-colors hover:bg-secondary-foreground min-[769px]:inline-block"
            >
              전문가로 활동하기
            </Link>

            {/* 계정 — 좁은 화면에서만. 탐색(찾기·지도·전문가)은 하단 탭바가 맡고,
                이 사람 아이콘은 마이페이지로 바로 갑니다. 마이페이지 안에 예약내역·
                관리자 탭이 모두 있어 서랍(햄버거)을 따로 두지 않습니다.
                **로그인한 사람에게만** 보입니다 — 비로그인이 눌러 봐야 「로그인이
                필요합니다」만 나오고, 그쪽은 왼쪽 로그인 버튼이 담당합니다. */}
            {user && (
              <Link
                to="/my"
                aria-label="마이페이지"
                className={cn(
                  "-mr-1 flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-secondary min-[769px]:hidden",
                  location.pathname === "/my" && "text-primary"
                )}
              >
                <UserRound className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* 하단 탭바가 뜨는 화면(모바일)에서는 본문 마지막 내용이 탭바에 가리지 않게
          그 높이만큼 아래 여백을 둡니다. 탭바를 숨기는 화면과 데스크톱에서는 뺍니다. */}
      <main className={cn("flex-1", !hideTabBar && "pb-16 min-[769px]:pb-0")}>
        <Outlet />
      </main>

      {!hideTabBar && <MobileTabBar />}

      {/* 6. 다크 푸터 — 배경은 네이비(#05131D)가 아니라 다크 포레스트 #0E211A 계열 (스키마 9-7 ⑦) */}
      <footer className="mt-auto bg-footer px-6 pb-8 pt-16 text-white">
        <div className="mx-auto mb-12 grid w-full max-w-[1200px] grid-cols-1 gap-8 min-[901px]:grid-cols-[2fr_1fr_1fr_1fr] min-[901px]:gap-10">
          <div>
            <b className="mb-3 block text-[22px] font-extrabold tracking-tight">품 FOOM</b>
            {/* 「No.1」은 쓰지 않습니다 — 실증할 수 없는 순위 표현은 표시광고법상
                부당광고가 될 수 있습니다. 지금 사실인 것만 적습니다. */}
            <p className="text-[13px] leading-relaxed text-footer-muted">
              산림복지전문가와 이용자를 잇는 숲 프로그램 예약 플랫폼.
              <br />
              체질숲협동조합이 함께 만들어갑니다.
            </p>
          </div>

          <div>
            <h4 className="mb-5 text-[13px] font-bold text-footer-heading">
              프로그램
            </h4>
            <ul className="space-y-2.5">
              {CATEGORIES.filter((c) => c !== "전체").map((c) => (
                <li key={c}>
                  <Link
                    to={`/search?category=${encodeURIComponent(c)}`}
                    className="text-[13px] text-footer-link transition-colors hover:text-white"
                  >
                    {c}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-5 text-[13px] font-bold text-footer-heading">
              품 소개
            </h4>
            <ul className="space-y-2.5">
              <li>
                <DisabledLink label="서비스 소개" className="text-[13px] text-footer-muted" />
              </li>
              <li>
                <Link
                  to="/provider/apply"
                  className="text-[13px] text-footer-link transition-colors hover:text-white"
                >
                  전문가 가입 안내
                </Link>
              </li>
              <li>
                <DisabledLink label="공지사항" className="text-[13px] text-footer-muted" />
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-5 text-[13px] font-bold text-footer-heading">
              문의
            </h4>
            <ul className="space-y-2.5">
              {["고객센터", "1:1 문의하기", "제휴 문의"].map((label) => (
                <li key={label}>
                  <DisabledLink label={label} className="text-[13px] text-footer-muted" />
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap justify-between gap-2 border-t border-white/10 pt-6 text-[12px] text-footer-muted">
          <div>© 2026 FOOM. All rights reserved.</div>
          <div>
            <DisabledLink label="개인정보처리방침" /> · <DisabledLink label="이용약관" />
          </div>
        </div>
      </footer>
    </div>
  );
}
