/**
 * 로그아웃 버튼 — 누르면 로그아웃하고 **결과 팝업**이 뜹니다 (2026-09-10, 팀 요청).
 *
 * 팝업과 그 뒤의 새로고침은 `LogoutFlow`가 맡습니다(이 버튼은 로그아웃과 함께 화면에서
 * 사라지므로 팝업을 여기 둘 수 없습니다 — 이유는 `useLogoutFlow`).
 *
 * **로그아웃 버튼은 이 부품 하나만 씁니다**(헤더 `LoginDialog`·마이페이지 두 자리). 자리마다
 * 따로 만들면 「어디서 눌렀느냐에 따라 결과가 갈리는」 버튼이 됩니다.
 *
 * 누르는 동안 잠그기만 하고 글자는 바꾸지 않습니다 — 로그아웃은 브라우저 안에서 끝나
 * 눈에 보이는 시간이 아니고, 없던 문구를 새로 만들지 않기로 했습니다.
 */

import { Button } from "@/components/ui/button";
import { useLogoutFlow } from "@/hooks/useLogoutFlow";

export default function LogoutButton({ className }: { className?: string }) {
  const { start, busy } = useLogoutFlow();

  return (
    <Button variant="outline" size="sm" className={className} onClick={start} disabled={busy}>
      로그아웃
    </Button>
  );
}
