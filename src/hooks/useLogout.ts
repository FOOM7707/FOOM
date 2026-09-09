/**
 * 로그아웃 — 로그인 상태만 끊는 게 아니라 **홈으로 보내고 그 사실을 말해줍니다** (2026-09-09).
 *
 * 그전에는 헤더의 「로그아웃」이 「로그인」으로 바뀌는 것 말고는 아무 표시가 없었고, 마이페이지
 * 밖에서는 보던 화면이 그대로 남았습니다 — 눌렀는지 안 눌렀는지 알 수 없어 두 번 누르게
 * 됩니다. 로그아웃은 「이 자리를 떠난다」는 동작이라 홈으로 보내는 것이 자연스럽고, 안내는
 * 화면 위에 팝업으로 뜹니다(`Layout`의 `Toast`가 `location.state.toast`를 읽음 — 처음엔 홈 본문에
 * 한 줄로 넣었는데 본문에 섞이면 눈에 들어오지 않아 팝업으로 바꿨습니다).
 *
 * 헤더(`LoginDialog`)와 마이페이지의 로그아웃 버튼이 둘 다 이걸 씁니다 — 한쪽만 홈으로
 * 보내면 「어디서 눌렀느냐에 따라 다르게 동작하는」 버튼이 됩니다.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";

export const LOGOUT_NOTICE = "로그아웃했습니다. 이용해 주셔서 감사합니다.";

export function useLogout(): () => Promise<void> {
  const { logout } = useAuth();
  const navigate = useNavigate();

  return useCallback(async () => {
    await logout();
    navigate("/", { state: { toast: LOGOUT_NOTICE } });
  }, [logout, navigate]);
}
