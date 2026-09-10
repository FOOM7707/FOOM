/**
 * 로그아웃 결과 팝업 (2026-09-10, 팀 시안대로).
 *
 * **누르면 → 「로그아웃 되었습니다.」 팝업이 뜨고 → 「확인」을 누르면 홈이 새로 뜹니다.**
 *
 * 그전에는 누르는 즉시 로그아웃되고 화면 위에 안내 한 줄이 3초 떴다 사라졌습니다. 나머지
 * 화면은 그대로여서 **「눌린 건가」 싶어 다시 누르게 됩니다.** 팝업은 화면을 덮고 손으로
 * 확인을 눌러야 없어지므로 그 자리에서 결과가 분명해집니다.
 *
 * **확인을 거친 뒤 화면을 통째로 새로 불러옵니다.** 헤더가 「로그인」으로, 마이페이지 메뉴가
 * 사라진 상태로 다시 그려져 **눌린 것이 눈에 보입니다.** 덤으로 화면이 들고 있던 내 정보·내
 * 프로그램이 메모리에서 함께 사라집니다 — 화면 안 이동만 하면 그 값들이 남습니다.
 *
 * **이 부품은 `App`에 있어야 합니다**(로그아웃 버튼 안이 아니라). 이유는 `useLogoutFlow`에
 * 적어뒀습니다 — 버튼은 로그아웃과 함께 화면에서 사라지므로 팝업을 그 안에 두면 팝업도
 * 함께 사라집니다.
 *
 * **생김새·문구는 팀 시안 그대로입니다** — 최대 300px, 모서리 22px, **한 줄과 버튼만**
 * (아이콘·설명 없음). 문구는 시안의 두 개(「로그아웃 되었습니다.」·「확인」)만 씁니다 —
 * 임의로 더하지 마세요.
 *
 * ⚠️ 모서리 22px은 화면 규칙의 「카드 라운드 16px 이하」를 넘습니다(`MD/frontend/frontend.md`).
 * 시안대로 하기로 한 자리라 예외이고, 다른 카드에 이 값을 옮겨 쓰지 마세요.
 *
 * **radix Dialog를 쓰지 않고 직접 그렸습니다** — 그 부품은 배경 어둡기를 바꿀 길이 없고
 * (내부에 고정), 시안의 등장 움직임도 따로 필요합니다. 라이트박스(`Lightbox.tsx`)가 같은
 * 이유로 같은 방식입니다. 등장은 keyframes가 아니라 전환(transition)으로 냅니다 —
 * 인라인 `animation`은 keyframes가 없으면 조용히 멈춥니다(frontend.md).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { LogoutFlowContext } from "@/hooks/useLogoutFlow";

type Phase = "idle" | "working" | "done";

export default function LogoutFlow({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");

  const start = useCallback(() => {
    // 진행 중에 또 누르면 무시합니다 — 로그아웃 요청이 두 번 갑니다.
    setPhase((current) => {
      if (current !== "idle") return current;
      void (async () => {
        try {
          await logout();
          setPhase("done");
        } catch {
          // 실패했는데 「로그아웃 되었습니다.」로 알리면 로그인된 채 떠나게 됩니다.
          // 팝업을 띄우지 않고 버튼을 되살려 다시 누를 수 있게 합니다.
          setPhase("idle");
        }
      })();
      return "working";
    });
  }, [logout]);

  const value = useMemo(() => ({ start, busy: phase === "working" }), [start, phase]);

  return (
    <LogoutFlowContext.Provider value={value}>
      {children}
      {phase === "done" && <LogoutDoneModal />}
    </LogoutFlowContext.Provider>
  );
}

/** 시안 그대로의 팝업. 나가는 길은 「확인」뿐이고, Esc·바깥 누르기도 같은 곳으로 보냅니다. */
function LogoutDoneModal() {
  const [shown, setShown] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  /** 확인 — 홈을 통째로 새로 불러옵니다(화면 안 이동이 아님). */
  const goHome = useCallback(() => {
    window.location.assign("/");
  }, []);

  useEffect(() => {
    // 다음 프레임에 켜서 나타나는 움직임이 보이게 합니다.
    const on = window.requestAnimationFrame(() => setShown(true));
    confirmRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      // 이미 로그아웃된 채 옛 화면에 남아 있으면 지금 상태를 알 수 없어서,
      // Esc로 닫아도 확인과 같은 곳으로 보냅니다.
      if (e.key === "Escape") goHome();
    }
    window.addEventListener("keydown", onKey);

    // 뒤 배경 스크롤 잠금 — 원래 값으로 되돌려 놓습니다.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.cancelAnimationFrame(on);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [goHome]);

  return (
    <div
      className={
        "fixed inset-0 z-[300] flex items-center justify-center px-4 bg-black/40 transition-opacity duration-150 ease-out motion-reduce:transition-none " +
        (shown ? "opacity-100" : "opacity-0")
      }
      onClick={goHome}
      role="dialog"
      aria-modal="true"
      aria-labelledby="logout-done-title"
    >
      <div
        // 카드를 눌렀을 때 바깥 누르기로 취급되지 않게 막습니다.
        onClick={(e) => e.stopPropagation()}
        className={
          "w-[85%] max-w-[300px] rounded-[22px] bg-card px-5 pt-8 pb-5 text-center " +
          "shadow-[0_10px_25px_rgba(0,0,0,0.08)] " +
          // 시안의 등장 곡선은 끝에서 살짝 튀어오릅니다(1.2).
          "transition-all duration-150 ease-[cubic-bezier(0.175,0.885,0.32,1.2)] motion-reduce:transition-none " +
          (shown ? "scale-100 opacity-100" : "scale-[0.94] opacity-0")
        }
      >
        <h2
          id="logout-done-title"
          className="mb-6 text-[17px] font-semibold tracking-[-0.3px] text-foreground"
        >
          로그아웃 되었습니다.
        </h2>

        <button
          ref={confirmRef}
          type="button"
          onClick={goHome}
          className="h-[46px] w-full rounded-xl bg-[#1b5e20] text-[15px] font-semibold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-[#144718] active:scale-[0.97] active:bg-[#0e3311] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
        >
          확인
        </button>
      </div>
    </div>
  );
}
