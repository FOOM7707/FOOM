/**
 * 화면 위에 잠깐 떠서 알려주는 팝업 (2026-09-09, 팀 요청).
 *
 * 로그아웃 안내가 처음엔 홈 첫 화면 안에 한 줄로 끼어 있었는데, 본문에 섞이면 「화면의 일부」로
 * 읽혀 눈에 들어오지 않습니다. 화면 위에 따로 떠야 「방금 한 동작의 결과」로 읽힙니다.
 *
 * **로그아웃은 이제 이 팝업을 쓰지 않습니다** (2026-09-10) — 3초 뒤 사라지는 안내로는
 * 「제대로 된 건가」가 남아서, 손으로 확인을 눌러야 없어지는 팝업(`LogoutFlow`)으로 바꿨습니다.
 * 이 부품은 스스로 사라져도 되는 가벼운 안내에 그대로 씁니다.
 *
 * 어느 화면에서든 뜨도록 `Layout`에 하나만 두고, 화면 이동 시 `location.state.toast`로 문구를
 * 넘깁니다(수정 저장 안내 등). 받은 문구는 주소 기록에서 바로 지웁니다 — 남기면
 * 뒤로가기로 돌아올 때마다 다시 뜹니다. 3초 뒤 스스로 사라지고, 누르면 바로 닫힙니다.
 *
 * 생김새 규칙(MD/frontend/frontend.md) — 카드 라운드 16px 이하, 테두리와 넓은 그림자는
 * 둘 중 하나만(여기는 그림자). 이모지 대신 lucide 아이콘.
 */

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";

const VISIBLE_MS = 3000;

export default function Toast() {
  const location = useLocation();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const incoming = (location.state as { toast?: string } | null)?.toast;
    if (!incoming) return;
    setMessage(incoming);
    navigate(location.pathname + location.search, { replace: true, state: null });
    // 다음 프레임에 켜서 나타나는 전환이 보이게 합니다.
    const on = window.requestAnimationFrame(() => setShown(true));
    const off = window.setTimeout(() => setShown(false), VISIBLE_MS);
    const clear = window.setTimeout(() => setMessage(null), VISIBLE_MS + 300);
    return () => {
      window.cancelAnimationFrame(on);
      window.clearTimeout(off);
      window.clearTimeout(clear);
    };
    // navigate·pathname은 안내를 받은 순간의 값만 쓰면 됩니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  if (!message) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[72px] z-50 flex justify-center px-4"
      aria-live="polite"
    >
      <button
        type="button"
        role="status"
        onClick={() => {
          setShown(false);
          window.setTimeout(() => setMessage(null), 300);
        }}
        className={
          "pointer-events-auto flex max-w-[92vw] items-center gap-2.5 rounded-2xl bg-card px-5 py-3 text-left text-[14px] font-semibold text-foreground shadow-[0_12px_32px_rgba(0,0,0,0.16)] transition-all duration-300 motion-reduce:transition-none " +
          (shown ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0")
        }
      >
        <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden />
        <span>{message}</span>
      </button>
    </div>
  );
}
