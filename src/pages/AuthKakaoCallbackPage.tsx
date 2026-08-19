/**
 * 카카오 로그인 콜백 화면 (스키마 15-7).
 *
 * 네이버 콜백(`AuthNaverCallbackPage`)과 같은 일을 합니다.
 *   ① state 대조 (CSRF 방어 — 서버는 세션이 없어 여기가 실제 검증 지점입니다)
 *   ② 인가코드를 서버로 전달  ③ 받은 Custom Token으로 로그인
 *
 * **다른 점 하나:** 서버에 콜백 주소(`redirectUri`)를 함께 넘깁니다. 카카오는
 * 토큰을 바꿔줄 때 인가 때 쓴 주소와 같은지 대조하기 때문입니다.
 *
 * **프로필 값은 여기서 다루지 않습니다.** 닉네임·이메일은 서버가 카카오에 직접
 * 물어봅니다 — 브라우저를 거친 값을 저장하면 조작할 수 있습니다(2-1).
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { signInWithCustomToken } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebaseClient";
import { consumeReturnTo, consumeState, kakaoCallbackUrl } from "@/lib/kakaoAuth";

type Phase = "working" | "failed";

export default function AuthKakaoCallbackPage() {
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
            ? "카카오 로그인을 취소하셨습니다."
            : "카카오 로그인에 실패했습니다."
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

      if (!savedState || savedState !== returnedState) {
        setPhase("failed");
        setMessage(
          "로그인 요청이 확인되지 않았습니다. 보안을 위해 중단했습니다. 다시 시도해 주세요."
        );
        return;
      }

      try {
        const res = await fetch("/api/auth/social/kakao", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // 카카오는 인가 때 쓴 주소와 같은지 대조하므로 함께 넘깁니다.
          body: JSON.stringify({ code, redirectUri: kakaoCallbackUrl() }),
        });

        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setPhase("failed");
          setMessage(body?.error?.message ?? "로그인 처리 중 문제가 발생했습니다.");
          return;
        }

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
