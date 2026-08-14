/**
 * 네이버 로그인 콜백 화면 (스키마 15-7).
 *
 * 네이버가 인가코드를 붙여 여기로 돌려보냅니다. 이 화면이 하는 일은 셋입니다.
 *   ① state 대조 (CSRF 방어 — 이게 실제 검증 지점입니다)
 *   ② 인가코드를 서버로 전달  ③ 받은 Custom Token으로 로그인
 *
 * **프로필 값은 여기서 다루지 않습니다.** 이름·이메일·전화번호는 서버가 네이버에
 * 직접 물어봅니다. 브라우저를 거친 값을 저장하면 조작할 수 있기 때문입니다(2-1).
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { signInWithCustomToken } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebaseClient";
import { consumeReturnTo, consumeState } from "@/lib/naverAuth";

type Phase = "working" | "failed";

export default function AuthNaverCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("working");
  const [message, setMessage] = useState("로그인 중입니다…");
  // React StrictMode는 개발 중 effect를 두 번 실행합니다. 인가코드는 1회용이라
  // 두 번째 호출이 반드시 실패하므로 한 번만 돌게 막습니다.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function run() {
      const errorCode = params.get("error");
      if (errorCode) {
        // 사용자가 동의 화면에서 취소한 경우가 대부분입니다.
        setPhase("failed");
        setMessage(
          errorCode === "access_denied"
            ? "네이버 로그인을 취소하셨습니다."
            : "네이버 로그인에 실패했습니다."
        );
        return;
      }

      const code = params.get("code");
      const returnedState = params.get("state");
      const savedState = consumeState();

      if (!code || !returnedState) {
        setPhase("failed");
        setMessage("로그인 정보가 올바르지 않습니다. 다시 시도해 주세요.");
        return;
      }

      // ① state 대조 — 서버는 세션이 없어 대조할 수 없으므로 여기가 검증 지점입니다.
      if (!savedState || savedState !== returnedState) {
        setPhase("failed");
        setMessage(
          "로그인 요청이 확인되지 않았습니다. 보안을 위해 중단했습니다. 다시 시도해 주세요."
        );
        return;
      }

      try {
        // ② 서버로 넘기는 것은 인가코드와 state뿐입니다.
        const res = await fetch("/api/auth/social/naver", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state: returnedState }),
        });

        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setPhase("failed");
          setMessage(body?.error?.message ?? "로그인 처리 중 문제가 발생했습니다.");
          return;
        }

        // ③ Custom Token으로 로그인
        await signInWithCustomToken(firebaseAuth, body.customToken);
        navigate(consumeReturnTo(), { replace: true });
      } catch {
        setPhase("failed");
        setMessage("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    }

    void run();
  }, [params, navigate]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      {phase === "working" ? (
        <>
          <div
            className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">{message}</p>
        </>
      ) : (
        <>
          <p className="text-[15px] font-semibold">로그인하지 못했습니다</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
          <button
            type="button"
            onClick={() => navigate("/", { replace: true })}
            className="mt-2 h-10 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
          >
            홈으로 돌아가기
          </button>
        </>
      )}
    </div>
  );
}
