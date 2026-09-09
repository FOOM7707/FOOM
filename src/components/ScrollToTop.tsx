/**
 * 화면을 옮기면 맨 위에서 시작하게 합니다 (2026-09-08, 디자인 검토 의견).
 *
 * 주소만 바뀌고 스크롤은 그대로 남아 있어서, 아래쪽을 보던 중에 다른 화면으로 가면
 * **내용은 바뀌었는데 화면이 그대로인 것처럼 보였습니다.** 특히 휴대폰 하단 메뉴에서
 * 눌렀을 때 「아무 일도 안 일어난다」로 읽혔습니다.
 *
 * **경로만 보면 안 됩니다.** 「프로그램 찾기」와 「지도로 찾기」는 같은 화면(`/search`)
 * 이고 주소의 조건(`view`)만 다릅니다 — 경로 변화만 보면 그 둘 사이 이동에서 동작하지
 * 않습니다.
 *
 * 반대로 **주소가 바뀔 때마다 올리면 안 됩니다.** 검색 화면은 필터·정렬·검색어를
 * 전부 주소에 넣으므로(17-4 ⑤), 목록 중간에서 조건을 만질 때마다 화면이 맨 위로
 * 튀게 됩니다. 그래서 **경로와 목록/지도 전환**만 봅니다.
 */

import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

export default function ScrollToTop() {
  const { pathname, search } = useLocation();
  const navigationType = useNavigationType();

  const view = new URLSearchParams(search).get("view") === "map" ? "map" : "list";

  useEffect(() => {
    // **뒤로·앞으로 가기는 건드리지 않습니다.** 목록을 한참 내려서 프로그램을 열었다가
    // 돌아왔을 때 맨 위로 올려버리면 보던 자리를 잃습니다 — 고치려던 것보다 나쁩니다.
    if (navigationType === "POP") return;
    // 부드러운 스크롤을 쓰지 않습니다. 화면이 이미 바뀐 뒤에 내용이 스쳐 지나가서
    // 오히려 어수선해 보입니다.
    window.scrollTo(0, 0);
  }, [pathname, view, navigationType]);

  return null;
}
