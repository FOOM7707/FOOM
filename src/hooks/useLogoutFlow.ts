/**
 * 로그아웃 동작을 부르는 자리 (2026-09-10, 팀 요청).
 *
 * 실제 진행과 결과 팝업은 `LogoutFlow`가 들고 있고, 버튼은 이 훅으로 「시작해라」만 말합니다.
 *
 * **왜 버튼이 직접 하지 않는가** — 로그아웃이 끝나면 로그인 상태가 사라지고, 그 순간
 * **로그아웃 버튼 자신이 화면에서 없어집니다**(헤더는 「로그인」으로 바뀌고, 마이페이지는
 * 「로그인이 필요합니다」가 됩니다). 결과 팝업을 버튼 안에 두면 **팝업도 함께 사라져서**
 * 「로그아웃되었습니다」를 볼 수가 없습니다. 그래서 팝업은 로그인 상태와 무관하게 늘 떠 있는
 * 자리(`App`의 `LogoutFlow`)에 둡니다.
 *
 * 컨텍스트와 훅만 여기 두고 화면 부품은 `LogoutFlow.tsx`에 둡니다 — 한 파일에서 부품과
 * 부품 아닌 것을 함께 내보내면 lint 경고가 붙습니다(`only-export-components`).
 */

import { createContext, useContext } from "react";

export interface LogoutFlow {
  /** 로그아웃을 시작합니다. 끝나면 결과 팝업이 뜹니다. */
  start: () => void;
  /** 진행 중 — 버튼을 잠가 두 번 눌리지 않게 합니다. */
  busy: boolean;
}

export const LogoutFlowContext = createContext<LogoutFlow | null>(null);

export function useLogoutFlow(): LogoutFlow {
  const value = useContext(LogoutFlowContext);
  if (!value) {
    // 감싸는 것을 빼먹으면 「눌러도 아무 일도 안 나는 버튼」이 되어 원인을 찾기 어렵습니다.
    throw new Error("useLogoutFlow는 <LogoutFlow> 안에서만 쓸 수 있습니다");
  }
  return value;
}
