/**
 * 마이페이지 — 관리자 (스키마 12-3).
 *
 * **판단 기준은 Firestore의 `users.role`이 아니라 토큰 Custom Claims입니다** —
 * 보안규칙과 함수 진입부가 보는 값이 그쪽입니다. 권한을 방금 부여받았다면
 * 로그아웃 후 다시 로그인해야 토큰에 반영됩니다.
 *
 * **메뉴가 보이는 것 자체는 보안 장치가 아닙니다.** 누구나 주소창에 `/admin`을
 * 칠 수 있고, 실제 차단은 함수 진입부와 보안규칙이 합니다. 이 메뉴는 관리자가
 * 진입 경로를 외우지 않아도 되게 하는 UX 장치입니다.
 */

import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const TASKS = [
  { title: "전문가 심사", body: "자격 서류를 확인하고 승인·반려합니다." },
  { title: "프로그램 심사", body: "내용·가격을 확인하고 게시합니다." },
  { title: "수정 승인", body: "게시 중인 프로그램의 수정 요청을 「전 → 후」로 비교합니다." },
];

export default function AdminSection() {
  return (
    <div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        심사 화면에서 아래 세 가지를 처리합니다. 정산 관리는 예약·결제가 붙은 뒤에
        열립니다.
      </p>

      <ul className="mt-5 flex flex-col gap-2.5">
        {TASKS.map((task) => (
          <li key={task.title} className="rounded-lg bg-secondary px-4 py-3">
            <p className="text-[13.5px] font-bold text-secondary-foreground">{task.title}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {task.body}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <Button asChild size="sm">
          <Link to="/admin">심사 화면 열기</Link>
        </Button>
      </div>
    </div>
  );
}
