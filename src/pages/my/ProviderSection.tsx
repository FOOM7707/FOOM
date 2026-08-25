/**
 * 마이페이지 — 전문가 활동 (스키마 15-1 · 2-2).
 *
 * **전문가 계정에만 보입니다.** 메뉴 자체가 일반 회원에게는 만들어지지 않습니다 —
 * 「내 계정 화면」은 내가 실제로 쓰는 것만 있어야 하고, 해당 없는 칸이 늘어나면
 * 정작 쓰는 것을 찾기 어려워집니다. 전문가가 되는 길은 헤더의 「전문가로
 * 활동하기」와 푸터의 「전문가 가입 안내」에 그대로 남아 있습니다.
 *
 * **기준은 `role === 'provider'`이지 「승인 완료」가 아닙니다.** 승인된 뒤에만
 * 보여주면 진행 단계 4칸이 무용지물이 됩니다 — 본인은 「심사 대기」·「심사 중」
 * 칸을 영원히 못 보게 되고, 그 칸을 만든 이유(심사가 방치된 것처럼 보이지 않게,
 * v23)가 사라집니다. 반려도 사유를 봐야 다시 요청할 수 있으므로 보여줍니다.
 */

import { Link } from "react-router-dom";
import ReviewProgress from "@/components/ReviewProgress";
import { Button } from "@/components/ui/button";
import type { Me } from "@/hooks/useMe";

/**
 * 심사 상태별 안내 — 진행 단계 바 아래에 붙습니다.
 *
 * 칸만 보여주면 「그래서 지금 내가 뭘 할 수 있나」가 안 나옵니다. 특히
 * `pending`·`reviewing`에서도 **프로그램 등록과 심사 요청은 됩니다** — 그걸
 * 적어두지 않으면 자격 심사가 끝날 때까지 기다려야 하는 것으로 읽힙니다.
 */
const APPROVAL_NOTICE: Record<string, { title: string; body?: string }> = {
  pending: {
    title: "자격 심사를 기다리고 있습니다.",
    body: "프로그램 등록과 심사 요청은 지금도 할 수 있습니다. 다만 자격 심사를 통과하기 전에는 프로필에 「인증」 표시가 붙지 않습니다.",
  },
  reviewing: {
    title: "담당자가 자격 서류를 확인하고 있습니다.",
    body: "결과가 나오면 이 화면에 표시됩니다. 그동안에도 프로그램 등록과 심사 요청은 할 수 있습니다.",
  },
  approved: { title: "심사를 통과한 전문가 계정입니다." },
};

export default function ProviderSection({ me }: { me: Me }) {
  const status = me.provider?.approvalStatus ?? null;
  const notice = APPROVAL_NOTICE[status ?? ""];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
        <span className="text-[13px] text-muted-foreground">활동명</span>
        <span className="text-sm font-semibold">
          {me.provider?.displayName ?? "-"}
          {me.provider?.verified && (
            <span className="ml-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
              인증
            </span>
          )}
        </span>
      </div>

      <h3 className="mb-4 text-sm font-bold">자격 심사 진행 상태</h3>

      {/* 반려 사유는 이 컴포넌트가 함께 보여줍니다(2-2 — 사유가 안 보이면
          무엇을 고쳐야 할지 몰라 재신청이 불가능합니다). */}
      <ReviewProgress
        isProvider
        approvalStatus={status}
        note={me.provider?.approvalNote ?? null}
      />

      {notice && (
        <div className="mt-5 rounded-lg bg-secondary px-3.5 py-3 text-[13px] leading-relaxed text-secondary-foreground">
          <b>{notice.title}</b>
          {notice.body && (
            <>
              <br />
              {notice.body}
            </>
          )}
        </div>
      )}

      {/* 반려인데 사유가 비어 있으면 재신청할 방법이 없습니다 — 그 사실을
          알려야 문의라도 할 수 있습니다. */}
      {status === "rejected" && !me.provider?.approvalNote && (
        <div className="mt-5 rounded-lg bg-destructive/10 px-3.5 py-3 text-[13px] leading-relaxed text-destructive">
          <b>심사가 반려되었습니다.</b>
          <br />
          사유가 기록되지 않았습니다. 운영자에게 문의해 주세요.
        </div>
      )}

      {/* ⚠️ 이 버튼은 **승인 전에도 보여줍니다.** 서버가 승인 전 등록을 허용하고
          (`assertProvider`는 `role`만 봅니다), 자격 심사와 프로그램 게시 심사가
          별개이기 때문입니다 — 자격 심사를 기다리는 동안 프로그램을 써두면 승인과
          동시에 게시 심사를 요청할 수 있습니다. 감추면 첫 게시까지의 시간이 두 배가
          되고 「승인 났는데 뭘 해야 하는지 모르는」 상태가 됩니다.
          (노출 여부는 CLAUDE.md 「결정 대기 ⑥」에 팀 확인 항목으로 올려두었습니다) */}
      <div className="mt-7 flex flex-wrap gap-2 border-t pt-5">
        <Button asChild size="sm" variant="outline">
          <Link to="/my/programs">내 프로그램</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/programs/new">프로그램 등록</Link>
        </Button>
      </div>
    </div>
  );
}
