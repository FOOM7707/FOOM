/**
 * 전문가로 활동하기 — 안내 화면 (스키마 15-1 · 15-8 · 15-9).
 *
 * **신청 폼이 아니라 안내입니다.** 온라인 신청을 여기서 받지 않는 이유는 둘입니다.
 *  ① 정식 절차의 첫 단계가 휴대폰 본인확인인데 벤더(KG이니시스/포트원)가 아직
 *     계약 전이라 그 단계를 만들 수 없습니다(15-3).
 *  ② 자격증 이미지를 올릴 Storage 업로드가 아직 없습니다(18번).
 * 그래서 절차를 정확히 알리고, 자격 부여는 운영자가 스크립트로 처리합니다(15-8).
 *
 * **화면 구성을 랜딩형으로 바꿨습니다 (v20).** 이전에는 글만 있는 안내문이었는데,
 * 이 화면은 전문가를 **설득해야 하는 자리**입니다 — 절차만 나열하면 "심사가 까다로운
 * 곳"으로만 읽힙니다. 큰 사진과 지그재그 구성으로 무엇을 얻는지 먼저 보여주고,
 * 절차·수수료·현재 상태는 그 아래에 그대로 둡니다.
 *
 * 참고한 시안의 보라색 강조는 쓰지 않았습니다 — 브랜드 컬러는 `#1F5C43`(포레스트
 * 그린)이고 shadcn `--primary`에 매핑돼 있습니다(9-5).
 *
 * **크기는 시안 값을 그대로 씁니다.** 처음엔 다른 화면(`max-w-6xl`)에 맞춰 20~25%
 * 줄였는데, 그러면 시안의 매거진 같은 느낌이 사라집니다 — 이 화면은 큰 사진과 큰
 * 글자가 설득의 수단입니다. 기준값:
 *
 *   컨테이너 1440px · 좌우여백 40px
 *   히어로 제목 72px (자간 -3px) · 히어로 사진 높이 520px · 배지 120px
 *   지그재그 사진 560px · 제목 51px · 본문 20px · 라벨 17px
 *   행 간격 160px · 열 간격 80px · 사진:글 = 1.2 : 0.8
 *
 * 다른 화면보다 넓은 것은 의도한 것입니다. 좁히면 사진이 작아지고, 사진이 작아지면
 * 이 구성은 성립하지 않습니다.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useMe } from "@/hooks/useMe";
import { cn } from "@/lib/utils";

/**
 * ⚠️ TODO(사진 교체): 아래 사진은 **Unsplash 임시 이미지**입니다.
 *
 * 상업적 사용은 허용되지만 우리 브랜드 사진이 아니고, 외부 CDN이라 우리가 통제할 수
 * 없습니다(속도·차단·삭제). 정식 오픈 전에 **실제 프로그램 사진으로 교체**하고
 * Storage(18번)에 올려 우리 도메인에서 서빙해야 합니다.
 */
const PHOTOS = {
  hero: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1200&q=80",
  freedom:
    "https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1200&q=80",
  automation:
    "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?auto=format&fit=crop&w=1200&q=80",
  trust:
    "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1200&q=80",
};

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

const FEATURES = [
  {
    label: "01. 자유",
    title: "원하는 일정대로\n자유롭게 여세요",
    body: "주말 반나절 숲해설부터 정기 산림치유 프로그램까지. 날짜·정원·가격을 직접 정하고, 최소 인원도 스스로 설정합니다.",
    photo: PHOTOS.freedom,
    alt: "숲길을 걷는 사람들",
  },
  {
    label: "02. 운영",
    title: "모집과 정산은\n맡겨주세요",
    body: "참가자 모집, 결제, 환불, 당일 안내까지 시스템이 처리합니다. 복잡한 행정을 덜고 숲에서 안내하는 일에만 집중하시면 됩니다.",
    photo: PHOTOS.automation,
    alt: "휴대폰으로 예약을 확인하는 모습",
  },
  {
    label: "03. 신뢰",
    title: "자격을 확인해\n믿고 맡기게 합니다",
    body: "품은 자격증을 운영자가 직접 확인한 전문가만 등록합니다. 아무나 열 수 없는 대신, 참가자는 안심하고 신청합니다.",
    photo: PHOTOS.trust,
    alt: "숲의 나무들",
  },
];

/**
 * 화면에 들어올 때 한 번 나타나는 효과.
 *
 * **`prefers-reduced-motion`을 존중합니다** — 움직임에 어지러움을 느끼는 분들이
 * 있고, 그 설정을 켠 사용자에게는 애니메이션 없이 처음부터 보이는 게 맞습니다.
 * 한 번 나타난 뒤에는 관찰을 끊습니다(스크롤을 오르내릴 때 다시 흔들리지 않게).
 */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.2 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, shown };
}

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
        먼저 로그인해 주세요. 우측 상단의 「로그인」에서 카카오·네이버 계정으로 시작할 수
        있습니다.
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

/** 지그재그 한 줄. 홀수 줄은 사진이 왼쪽, 짝수 줄은 오른쪽입니다. */
function FeatureRow({
  feature,
  flipped,
}: {
  feature: (typeof FEATURES)[number];
  flipped: boolean;
}) {
  const { ref, shown } = useReveal<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className="grid items-center gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:gap-[80px]"
    >
      <div
        className={cn(
          "overflow-hidden rounded-[36px] shadow-[0_24px_48px_rgba(0,0,0,.08)]",
          // 사진과 글의 좌우를 번갈아 놓습니다. 모바일에서는 사진이 항상 위입니다.
          flipped && "lg:order-2"
        )}
      >
        <img
          src={feature.photo}
          alt={feature.alt}
          loading="lazy"
          className="h-[340px] w-full object-cover transition-transform duration-500 hover:scale-[1.015] md:h-[440px] lg:h-[560px]"
        />
      </div>

      <div className={cn(flipped && "lg:order-1")}>
        <p className="mb-5 text-[15px] font-black tracking-[2px] text-primary md:text-[17px]">
          {feature.label}
        </p>
        <h3
          className={cn(
            "whitespace-pre-line break-keep text-[32px] font-black leading-[1.2] tracking-[-1px] md:text-[51px] md:tracking-[-2px]",
            // 나타나는 효과 — 위 useReveal이 켜줍니다.
            "transition-all duration-700 ease-out",
            shown ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-[0.94] opacity-0"
          )}
        >
          {feature.title}
        </h3>
        <p className="mt-7 break-keep text-[17px] leading-[1.6] text-muted-foreground md:text-[20px]">
          {feature.body}
        </p>
      </div>
    </div>
  );
}

export default function ProviderApplyPage() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 pb-[120px] pt-8 md:px-10">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="grid items-center gap-12 pb-[100px] pt-[60px] lg:grid-cols-2 lg:gap-[60px]">
        <div>
          <h1 className="break-keep text-[44px] font-black leading-[1.1] tracking-[-2px] md:text-[72px] md:tracking-[-3px]">
            좋아하는 숲에서,
            <br />
            걱정 없이 하세요.
          </h1>
          <p className="mt-7 max-w-lg break-keep text-[17px] leading-relaxed text-muted-foreground md:text-[19px]">
            품(FOOM)은 산림복지전문가와 지역 주민을 잇습니다. 프로그램을 여는 일에만
            집중하시도록 모집·결제·안내를 대신 맡습니다.
          </p>

          {/* 시안의 회전 배지.
              **Tailwind의 `animate-spin`을 씁니다** — 인라인 `animation: spin`으로 쓰면
              그 이름의 keyframes가 CSS에 생성되지 않아 **조용히 안 돌아갑니다**.
              기본 1초는 너무 빨라 시선을 계속 잡아채므로 24초로 늘렸고,
              움직임을 줄이는 설정을 켠 사용자에게는 멈춥니다. */}
          <div
            className="mt-[30px] flex size-[120px] animate-spin items-center justify-center rounded-full border text-[32px] [animation-duration:24s] motion-reduce:animate-none"
            aria-hidden
          >
            🌲
          </div>
        </div>

        <div>
          <img
            src={PHOTOS.hero}
            alt="빛이 드는 숲길"
            className="h-[360px] w-full object-cover shadow-[0_20px_40px_rgba(0,0,0,.08)] md:h-[520px]"
            /* 시안의 비대칭 모서리 — 오른쪽 위만 크게 굴려 사진에 방향감을 줍니다 */
            style={{ borderRadius: "36px 140px 36px 36px" }}
          />
          <p className="mt-5 text-[20px] font-extrabold">
            당신의 산림 재능을 마음껏 펼치세요.
            <span className="mt-1.5 block text-[17px] font-normal text-muted-foreground">
              예약 관리와 정산은 품이 맡습니다.
            </span>
          </p>
        </div>
      </section>

      {/* ── 지그재그 소개 ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-[100px] border-t py-[100px] lg:gap-[160px]">
        {FEATURES.map((feature, i) => (
          <FeatureRow key={feature.label} feature={feature} flipped={i % 2 === 1} />
        ))}
      </section>

      {/* ── 등록 절차 ────────────────────────────────────────────────── */}
      <section className="border-t pt-[100px]">
        <h2 className="break-keep text-[32px] font-black tracking-[-1px] md:text-[44px] md:tracking-[-2px]">
          등록은 네 단계입니다
        </h2>
        <p className="mt-5 max-w-2xl break-keep text-[16px] leading-relaxed text-muted-foreground md:text-[18px]">
          참가자 안전과 프로그램 품질이 걸린 부분이라 자격증을 운영자가 직접 확인합니다.
          자동 승인은 없습니다.
        </p>

        <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-3xl border p-7">
              <span className="flex size-9 items-center justify-center rounded-full bg-primary text-[15px] font-bold text-primary-foreground">
                {i + 1}
              </span>
              <p className="mt-4 text-[18px] font-bold">{step.title}</p>
              <p className="mt-2 break-keep text-[14.5px] leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── 지금 할 수 있는 것 ─────────────────────────────────────────
          시안에는 「호스트 등록 시작하기」 버튼이 있었지만 **신청 폼을 열지
          않았습니다**(15-9). 누르면 아무 일도 없는 버튼은 고장으로 읽히므로,
          그 자리에 현재 상태와 문의 안내를 둡니다. */}
      <section className="mt-[100px] rounded-[36px] bg-secondary px-6 py-[60px] md:px-12">
        <h2 className="break-keep text-center text-[30px] font-black tracking-[-1px] md:text-[40px] md:tracking-[-2px]">
          시작해 보시겠어요?
        </h2>
        <div className="mx-auto mt-9 max-w-xl">
          <StatusPanel />
        </div>
      </section>

      {/* ── 자주 묻는 것 ─────────────────────────────────────────────── */}
      <section className="mt-[100px]">
        <h2 className="text-[24px] font-extrabold tracking-tight">자주 묻는 것</h2>
        <dl className="mt-7 grid gap-8 text-[15px] leading-relaxed md:grid-cols-3">
          <div>
            <dt className="text-[17px] font-bold">수수료는 얼마인가요?</dt>
            <dd className="mt-1 break-keep text-muted-foreground">
              결제액의 10%입니다. 정산 시 사업소득 원천징수 3.3%가 함께 반영됩니다.
            </dd>
          </div>
          <div>
            <dt className="text-[17px] font-bold">등록하면 바로 노출되나요?</dt>
            <dd className="mt-1 break-keep text-muted-foreground">
              아닙니다. 프로그램마다 내용·가격을 확인하는 게시 심사가 따로 있습니다. 반려되면
              사유를 보고 고쳐서 다시 요청할 수 있습니다.
            </dd>
          </div>
          <div>
            <dt className="text-[17px] font-bold">개인도 등록할 수 있나요?</dt>
            <dd className="mt-1 break-keep text-muted-foreground">
              자격증을 보유하고 있다면 개인·단체 모두 가능합니다. 정산 계좌의 예금주와 자격증
              이름이 같아야 합니다.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
