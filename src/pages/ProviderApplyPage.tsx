/**
 * 전문가로 활동하기 — 안내 화면 (스키마 15-1, 15-8).
 *
 * **신청 폼이 아니라 안내입니다.** 온라인 신청을 여기서 받지 않는 이유는
 * 두 가지입니다.
 *  ① 정식 절차의 첫 단계가 휴대폰 본인확인인데 벤더(KG이니시스/포트원)가
 *     아직 계약 전이라 그 단계를 만들 수 없습니다(15-3).
 *  ② 자격증 이미지를 올릴 Storage가 아직 없습니다.
 * 그래서 지금은 절차를 정확히 알리고, 자격 부여는 운영자가 스크립트로
 * 처리합니다(15-8 — 정식 오픈 전 제거 대상).
 *
 * 이 화면이 생기기 전에는 헤더의 「전문가로 활동하기」가 `/programs/new`로
 * 바로 갔습니다. 공급자가 아닌 사용자는 폼을 다 채운 뒤에야 거부당했습니다.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useMe } from "@/hooks/useMe";

const STEPS = [
  {
    title: "휴대폰 본인확인",
    body: "정산 계좌의 예금주와 자격증의 이름이 같은 사람인지 확인합니다. 소비자에게는 요구하지 않고 전문가 등록에만 있습니다.",
  },
  {
    title: "자격증 제출",
    body: "숲해설가·유아숲지도사·산림치유지도사·숲길등산지도사 등 산림복지전문가 자격증 사본을 올립니다.",
  },
  {
    title: "관리자 심사",
    body: "제출한 자격증을 운영자가 직접 확인합니다. 자동 승인은 없습니다.",
  },
  {
    title: "프로그램 등록",
    body: "승인되면 프로그램을 등록할 수 있습니다. 등록한 프로그램도 게시 전에 한 번 더 심사를 거칩니다.",
  },
];

function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return (
    <p
      className={
        tone === "warn"
          ? "rounded-lg bg-destructive/10 px-4 py-3 text-[13px] leading-relaxed text-destructive"
          : "rounded-lg bg-secondary px-4 py-3 text-[13px] leading-relaxed text-secondary-foreground"
      }
    >
      {children}
    </p>
  );
}

/** 로그인·심사 상태에 따라 이 화면에서 할 수 있는 일이 달라집니다. */
function StatusPanel() {
  const { user, loading: authLoading } = useAuth();
  const { me, loading, error } = useMe();

  if (authLoading || loading) {
    return <Notice>상태를 확인하는 중입니다…</Notice>;
  }

  if (!user) {
    return (
      <Notice>
        먼저 로그인해 주세요. 우측 상단의 「로그인」에서 네이버 계정으로 시작할 수 있습니다.
      </Notice>
    );
  }

  if (error || !me) {
    return <Notice tone="warn">{error ?? "계정 정보를 불러오지 못했습니다"}</Notice>;
  }

  if (me.role !== "provider") {
    return (
      <div className="space-y-3">
        <Notice>
          <b>현재 온라인 신청은 준비 중입니다.</b>
          <br />
          본인확인 절차를 붙이는 중이라 신청 폼을 아직 열지 못했습니다. 전문가 등록을 원하시면
          체질숲협동조합으로 문의해 주세요 — 자격 확인 후 운영자가 직접 등록해 드립니다.
        </Notice>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          문의하실 때 아래 계정 번호를 함께 알려주시면 처리가 빠릅니다.
          <br />
          <code className="mt-1 inline-block rounded bg-muted px-2 py-1 text-[12px]">
            {me.uid}
          </code>
        </p>
      </div>
    );
  }

  // 여기부터는 공급자 계정입니다.
  return (
    <div className="space-y-3">
      {me.provider?.approvalStatus === "rejected" && (
        <Notice tone="warn">
          <b>심사가 반려되었습니다.</b>
          <br />
          {me.provider.approvalNote ?? "사유가 기록되지 않았습니다. 운영자에게 문의해 주세요."}
        </Notice>
      )}

      {me.provider?.approvalStatus === "pending" && (
        <Notice>
          <b>자격 심사 대기 중입니다.</b>
          <br />
          프로그램 등록과 심사 요청은 지금도 할 수 있습니다. 다만 자격 심사를 통과하기 전에는
          프로필에 「인증」 표시가 붙지 않습니다.
        </Notice>
      )}

      {me.provider?.approvalStatus === "approved" && (
        <Notice>
          <b>심사를 통과한 전문가 계정입니다.</b>
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/programs/new">프로그램 등록하기</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/my/programs">내 프로그램</Link>
        </Button>
      </div>
    </div>
  );
}

export default function ProviderApplyPage() {
  return (
    <div className="container mx-auto max-w-2xl px-5 py-10 pb-20">
      <h1 className="text-[26px] font-extrabold tracking-tight">전문가로 활동하기</h1>
      <p className="mt-2.5 text-[14px] leading-relaxed text-muted-foreground">
        품(FOOM)의 프로그램은 <b className="text-foreground">산림복지전문가 자격을 가진 분</b>만
        등록할 수 있습니다. 참가자 안전과 프로그램 품질이 걸린 부분이라 자격증을 운영자가 직접
        확인합니다.
      </p>

      <div className="mt-7">
        <StatusPanel />
      </div>

      <h2 className="mb-4 mt-10 text-[18px] font-bold">등록 절차</h2>
      <ol className="flex flex-col gap-3">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <Card>
              <CardContent className="flex gap-4 pt-5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold">{step.title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      <h2 className="mb-3 mt-10 text-[18px] font-bold">자주 묻는 것</h2>
      <dl className="flex flex-col gap-4 text-[13px] leading-relaxed">
        <div>
          <dt className="font-semibold">수수료는 얼마인가요?</dt>
          <dd className="text-muted-foreground">
            결제액의 10%입니다. 정산 시 사업소득 원천징수 3.3%가 함께 반영됩니다.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">등록하면 바로 노출되나요?</dt>
          <dd className="text-muted-foreground">
            아닙니다. 프로그램마다 내용·가격을 확인하는 게시 심사가 따로 있습니다. 반려되면 사유를
            보고 고쳐서 다시 요청할 수 있습니다.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">개인도 등록할 수 있나요?</dt>
          <dd className="text-muted-foreground">
            자격증을 보유하고 있다면 개인·단체 모두 가능합니다. 정산 계좌의 예금주와 자격증 이름이
            같아야 합니다.
          </dd>
        </div>
      </dl>
    </div>
  );
}
