import { Link, Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import LoginDialog from "./LoginDialog";
import { useAuth } from "@/hooks/useAuth";
import { CATEGORIES } from "@/types/firestore";

/**
 * 공통 레이아웃 — 디자인 초안(docs/디자인-웹페이지-초안.html) 헤더·푸터 기준.
 * 예약내역·마이페이지는 화면이 아직 없어 disabled + "준비중" 툴팁으로 둡니다.
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

const DISABLED_NAV = ["예약내역", "마이페이지"];

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
  const { isAdmin } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      {/* 1. 헤더 — 로고 / 네비 / 로그인 + 전문가로 활동하기 */}
      <header className="sticky top-0 z-50 h-[60px] w-full border-b border-border bg-white/95 backdrop-blur">
        <div className="flex h-full w-full items-center justify-between gap-4 px-5 min-[769px]:px-10">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-1.5 text-[20px] font-extrabold text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            <span aria-hidden>🌲</span> 품 FOOM
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
                    className="text-[15px] font-semibold text-muted-foreground/60"
                  />
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            {isAdmin && (
              <Link
                to="/admin"
                className="text-[13px] font-bold text-primary underline-offset-4 hover:underline"
              >
                관리자
              </Link>
            )}
            <LoginDialog />
            {/* 공급자가 아닌 사용자를 등록 폼으로 바로 보내면, 폼을 다 채운 뒤에야
                권한 거부를 만나게 됩니다. 안내 화면을 거치게 합니다(15-1). */}
            <Link
              to="/provider/apply"
              className="rounded-md bg-primary px-4 py-[7px] text-[13px] font-bold text-primary-foreground transition-colors hover:bg-secondary-foreground"
            >
              전문가로 활동하기
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      {/* 6. 다크 푸터 — 배경은 네이비(#05131D)가 아니라 다크 포레스트 #0E211A 계열 (스키마 9-7 ⑦) */}
      <footer className="mt-auto bg-footer px-6 pb-8 pt-16 text-white">
        <div className="mx-auto mb-12 grid w-full max-w-[1200px] grid-cols-1 gap-8 min-[901px]:grid-cols-[2fr_1fr_1fr_1fr] min-[901px]:gap-10">
          <div>
            <b className="mb-3 block text-[22px] font-extrabold tracking-tight">품 FOOM</b>
            <p className="text-[13px] leading-relaxed text-footer-muted">
              산림복지전문가와 이용자를 잇는 No.1 숲 프로그램 플랫폼.
              <br />
              체질숲협동조합이 함께 만들어갑니다.
            </p>
          </div>

          <div>
            <h4 className="mb-5 text-[12px] font-bold uppercase tracking-[0.1em] text-[#4CAF6E]">
              Programs
            </h4>
            <ul className="space-y-2.5">
              {CATEGORIES.filter((c) => c !== "전체").map((c) => (
                <li key={c}>
                  <Link
                    to={`/search?category=${encodeURIComponent(c)}`}
                    className="text-[13px] text-[#C7D5CC] transition-colors hover:text-white"
                  >
                    {c}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-5 text-[12px] font-bold uppercase tracking-[0.1em] text-[#4CAF6E]">
              About FOOM
            </h4>
            <ul className="space-y-2.5">
              <li>
                <DisabledLink label="서비스 소개" className="text-[13px] text-footer-muted" />
              </li>
              <li>
                <Link
                  to="/provider/apply"
                  className="text-[13px] text-[#C7D5CC] transition-colors hover:text-white"
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
            <h4 className="mb-5 text-[12px] font-bold uppercase tracking-[0.1em] text-[#4CAF6E]">
              Contact
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
