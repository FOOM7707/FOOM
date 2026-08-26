/**
 * 홈 화면 (2026-08-26 개편).
 *
 * **디자인은 참고 시안을 따르고, 기능은 우리 것을 그대로 씁니다.** 시안에 있던
 * 「전문가 찾기」·「맞춤 견적요청」처럼 **없는 기능을 약속하는 자리는 빼거나 실제로
 * 되는 것으로 바꿨습니다** — 눌렀을 때 갈 곳이 없는 메뉴를 두지 않는다는 규칙(15-9).
 *
 * 구성: 첫 화면(제목 + 통합 검색 + 카테고리 아이콘) → 인기 프로그램 → 전문가 배너
 *       → 후기.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Baby, Building, Flower2, Footprints, Leaf, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CATEGORIES } from "@/types/firestore";
import { DEFAULT_FILTERS, toSearchQuery, type SearchRow } from "@/lib/programFilter";
import { REGION_KEYS } from "@/lib/sido";
import { Select } from "@/components/ui/select";

const CONTAINER = "mx-auto w-full max-w-[1140px] px-5";

/**
 * 검색 바 안의 입력칸 — 테두리·배경·기본 여백을 걷어냅니다.
 *
 * 높이를 줄이면서 **안쪽 여백은 그대로 두면 글자 아래(받침)가 잘립니다.** `py-0`으로
 * 여백을 없애고 줄 높이(`leading`)로 자리를 잡습니다. 펼침 화살표는 공용 부품이
 * 그리므로 오른쪽 자리(`pr-7`)만 비워 둡니다.
 */
const SEARCH_CONTROL =
  "h-[26px] w-full rounded-none border-0 bg-transparent px-0 pr-7 py-0 text-[14.5px] font-semibold leading-[26px] shadow-none focus-visible:ring-0";

/**
 * 카테고리 아이콘 — `lucide-react` 한 세트로 통일합니다(2026-08-25 규칙).
 *
 * **삽화(PNG)를 쓰지 않습니다.** 넣어봤지만 다섯 칸의 그림체·여백·색이 제각각이라
 * 한 줄로 놓았을 때 정리가 안 되고, 배경을 투명하게 처리해도 화면에 따라 어둡게
 * 비치는 문제가 있었습니다. 선 아이콘은 굵기와 크기가 같아 줄이 가지런합니다.
 */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  숲해설: Leaf, // 나뭇잎
  산림치유: Flower2, // 꽃 — 시안은 명상하는 사람인데 아이콘 세트에 그 모양이 없습니다
  유아숲체험: Baby, // 아기
  숲길등산: Footprints, // 발자국 — 시안의 등산화에 가장 가까운 모양입니다
  "단체·기업": Building, // 건물(창문 격자)
};

/**
 * 첫 화면에 놓는 순서 — 시안과 같습니다.
 * (검색 화면의 카테고리 줄은 공식 목록 순서를 그대로 씁니다)
 */
const CATEGORY_LIST = ["숲해설", "산림치유", "유아숲체험", "숲길등산", "단체·기업"].filter(
  (c) => (CATEGORIES as readonly string[]).includes(c)
);

interface SearchResponse {
  programs: SearchRow[];
  total: number;
}

/** 인기 프로그램에 보여줄 장수. 한 줄(4칸)을 채웁니다 */
const FEATURED_COUNT = 4;

export default function HomePage() {
  const navigate = useNavigate();

  const [region, setRegion] = useState("");
  const [category, setCategory] = useState("");
  const [headcount, setHeadcount] = useState("");

  /** 인기 프로그램 — 판정은 서버가 합니다(검색 화면과 같은 경로) */
  const [featured, setFeatured] = useState<SearchRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    const query = toSearchQuery(DEFAULT_FILTERS, "인기순", "");
    apiFetch<SearchResponse>(`/programs/search?${query}`)
      .then((res) => {
        if (alive) setFeatured(res.programs.slice(0, FEATURED_COUNT));
      })
      // 첫 화면이 오류로 깨지지 않게 합니다 — 목록이 비면 아래에서 안내로 대체됩니다.
      .catch(() => {
        if (alive) setFeatured([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    if (category) p.set("category", category);
    if (region) p.set("region", region);
    if (headcount) p.set("headcount", headcount);
    navigate(`/search?${p.toString()}`);
  }

  return (
    <div className="bg-[#F8FAF7]">
      {/* ── 첫 화면 ───────────────────────────────────────────────────────
          시안대로 흰 바탕입니다. 아래 목록 영역과 색이 갈려 첫 화면이 도드라집니다. */}
      <section className="border-b bg-card px-5 pb-14 pt-12 text-center sm:pt-14">
        <h1 className="text-balance text-[26px] font-extrabold leading-tight tracking-tight sm:text-[32px]">
          검증된 산림복지전문가를 매칭받아보세요
        </h1>
        <p className="mt-3 text-pretty text-[15px] text-muted-foreground sm:text-base">
          숲해설가, 산림치유지도사 등 국가공인 전문가와 함께하는 맞춤형 숲 프로그램
        </p>

        {/* 통합 검색 — 고른 값은 검색 화면의 필터로 그대로 넘어갑니다(주소에 남으므로
            뒤로가기·링크 공유도 됩니다).

            **칸 높이보다 안쪽 여백이 크면 글자 아래가 잘립니다** — 「전국」의 ㄴ·ㄱ
            받침이 그렇게 잘렸습니다. 공용 입력칸의 기본 여백을 여기서는 걷어내고
            줄 높이로 자리를 잡습니다. */}
        <form
          onSubmit={submitSearch}
          className="mx-auto mt-8 flex w-full max-w-[820px] flex-col gap-1 rounded-2xl border bg-card p-3 shadow-[0_12px_28px_rgba(31,92,67,0.08)] lg:flex-row lg:items-stretch lg:gap-0 lg:rounded-full lg:p-2 lg:pl-8"
        >
          <label className="flex flex-1 flex-col justify-center border-b px-3 py-2.5 text-left lg:border-b-0 lg:border-r lg:py-1">
            <span className="mb-0.5 block text-[12px] font-bold text-primary">지역</span>
            <Select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className={SEARCH_CONTROL + (region === "" ? " font-normal text-muted-foreground" : "")}
            >
              <option value="">어느 지역을 찾으시나요?</option>
              {REGION_KEYS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-1 flex-col justify-center border-b px-3 py-2.5 text-left lg:border-b-0 lg:border-r lg:py-1">
            <span className="mb-0.5 block text-[12px] font-bold text-primary">프로그램 종류</span>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={
                SEARCH_CONTROL + (category === "" ? " font-normal text-muted-foreground" : "")
              }
            >
              <option value="">전체 카테고리</option>
              {CATEGORY_LIST.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-1 flex-col justify-center px-3 py-2.5 text-left lg:py-1">
            <span className="mb-0.5 block text-[12px] font-bold text-primary">참여 인원</span>
            <input
              type="number"
              min={1}
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value)}
              placeholder="인원 선택 (예: 4명)"
              className="h-[26px] w-full bg-transparent text-[14.5px] font-semibold leading-[26px] outline-none placeholder:font-normal placeholder:text-muted-foreground"
            />
          </label>

          <button
            type="submit"
            className="mt-1 inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-8 py-3.5 text-[15px] font-bold text-primary-foreground transition-colors hover:bg-secondary-foreground lg:mt-0"
          >
            <Search className="h-4 w-4" strokeWidth={2.25} aria-hidden />
            검색하기
          </button>
        </form>

        {/* 카테고리 — 누르면 그 종류만 걸린 검색 결과로 갑니다 */}
        <ul className="mx-auto mt-11 flex max-w-[820px] flex-wrap justify-center gap-x-8 gap-y-6 sm:gap-x-10">
          {CATEGORY_LIST.map((c) => (
            <li key={c}>
              <Link
                to={`/search?category=${encodeURIComponent(c)}`}
                className="group flex w-[88px] flex-col items-center gap-2.5 rounded-xl outline-none transition-transform hover:-translate-y-1 focus-visible:-translate-y-1"
              >
                {/* 아이콘은 32px 인라인 SVG이고 원형 배경 가운데에 놓입니다.
                    평소부터 브랜드 초록입니다 — 회색으로 깔아뒀더니 첫 화면에서 가장
                    눈에 띄어야 할 줄이 흐려 보였습니다. */}
                <span className="flex h-[68px] w-[68px] items-center justify-center rounded-full border-2 border-transparent bg-secondary text-primary transition-colors group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground group-focus-visible:border-primary group-focus-visible:bg-primary group-focus-visible:text-primary-foreground">
                  {(() => {
                    const Icon = CATEGORY_ICONS[c] ?? Leaf;
                    return <Icon className="h-8 w-8" strokeWidth={2} aria-hidden />;
                  })()}
                </span>
                <span className="text-[14.5px] font-bold transition-colors group-hover:text-primary group-focus-visible:text-primary">
                  {c}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ── 인기 프로그램 ─────────────────────────────────────────────────
          실제 등록·승인된 프로그램입니다. 순위 기준(예약 수)을 채우는 배치가 아직
          없어 서버가 「최근 게시순」으로 떨어뜨립니다 — 값이 전부 0인 채로 인기순을
          쓰면 순서가 매번 바뀌기 때문입니다. */}
      <section className={`${CONTAINER} pt-12`}>
        <div className="mb-5 flex items-end justify-between gap-4">
          <h2 className="text-[20px] font-extrabold tracking-tight sm:text-[22px]">
            지금 만나볼 수 있는 숲 프로그램
          </h2>
          <Link
            to="/search"
            className="shrink-0 text-[14px] font-bold text-primary hover:underline"
          >
            전체보기 →
          </Link>
        </div>

        {featured === null ? (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: FEATURED_COUNT }).map((_, i) => (
              <li key={i} className="overflow-hidden rounded-2xl border bg-card">
                <div className="h-[200px] animate-pulse bg-muted" />
                <div className="space-y-2 p-4">
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                </div>
              </li>
            ))}
          </ul>
        ) : featured.length === 0 ? (
          <p className="rounded-2xl border bg-card px-6 py-12 text-center text-[14px] leading-relaxed text-muted-foreground">
            아직 게시된 프로그램이 없습니다.
            <br />
            전문가가 프로그램을 올리고 심사를 통과하면 여기에 나타납니다.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/programs/${p.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border bg-card transition-all hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(31,92,67,0.10)]"
                >
                  <div className="relative h-[200px] bg-muted">
                    <span className="absolute left-3 top-3 z-[2] rounded-full bg-foreground/75 px-2.5 py-1 text-[11.5px] font-semibold text-white backdrop-blur-sm">
                      {p.category}
                    </span>
                    {/* 대표 사진은 imageUrls[0]입니다. 아직 썸네일이 없어 원본을 쓰므로
                        지연 로딩합니다 — 게시 프로그램이 늘면 목록이 가장 비싼 화면이
                        됩니다(20-6). */}
                    {p.imageUrls?.[0] ? (
                      <img
                        src={p.imageUrls[0]}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center text-sm font-bold text-muted-foreground">
                        사진 준비 중
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-4">
                    <p className="mb-1.5 truncate text-[12.5px] text-muted-foreground">
                      {p.location.address || "장소 미정"}
                    </p>
                    <p className="mb-3 line-clamp-2 min-h-[42px] text-[15px] font-bold leading-[1.4]">
                      {p.title}
                    </p>
                    <div className="mt-auto flex items-center justify-between border-t pt-2.5">
                      {/* 평점은 후기가 있을 때만 — 0.0점은 「나쁜 평가」로 읽힙니다(2-3) */}
                      <span className="text-[13px] font-bold text-cta">
                        {p.ratingCount > 0 ? `★ ${p.ratingAvg.toFixed(1)} (${p.ratingCount})` : ""}
                      </span>
                      <span className="text-[15px] font-extrabold text-primary">
                        {p.price.toLocaleString()}원~
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 전문가 배너 ───────────────────────────────────────────────────
          시안의 「1분 만에 맞춤 견적 신청」 자리입니다. 견적 요청 기능이 없어서
          지금 실제로 되는 것(전문가 가입 안내)으로 바꿨습니다. */}
      <section className={`${CONTAINER} pt-14`}>
        <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-gradient-to-br from-[#1F5C43] to-[#2D6A4F] px-8 py-10 text-white sm:px-12 lg:flex-row lg:items-center">
          <div>
            <h3 className="text-balance text-[21px] font-extrabold leading-snug sm:text-[24px]">
              숲에서 일하는 전문가이신가요?
            </h3>
            <p className="mt-2.5 text-pretty text-[15px] leading-relaxed text-white/85">
              내 프로그램을 올리고 우리 동네 주민들을 직접 만나보세요. 자격을 확인한
              전문가만 등록할 수 있습니다.
            </p>
          </div>
          <Link
            to="/provider/apply"
            className="shrink-0 rounded-xl bg-cta px-7 py-3.5 text-[15px] font-bold text-white transition-colors hover:bg-cta-hover"
          >
            전문가 가입 안내 보기
          </Link>
        </div>
      </section>

      {/* ── 후기 ──────────────────────────────────────────────────────────
          TODO(정식 오픈 전): 아래는 화면 구성 확인용 예시 후기입니다. 실제 reviews
          데이터가 0건인 상태로 정식 오픈하면 표시광고 문제가 되므로, 오픈 전에
          실제 데이터 연동 또는 섹션 숨김 처리가 반드시 필요합니다 (스키마 9-7 ④). */}
      <section className={`${CONTAINER} py-16`}>
        <h2 className="mb-6 text-balance text-[20px] font-extrabold tracking-tight sm:text-[22px]">
          숲이 준 일상의 변화, 직접 경험한 이야기
        </h2>
        <ul className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {REVIEWS.map((review) => (
            <li
              key={review.name}
              className="flex flex-col justify-between rounded-2xl border bg-card px-6 py-6"
            >
              <div>
                <div className="mb-3 text-[13px] tracking-[2px] text-cta" aria-label="별점 5점 만점에 5점">
                  ★★★★★
                </div>
                <p className="mb-6 text-pretty text-[14px] leading-[1.7]">"{review.text}"</p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-[13px] font-bold text-primary"
                  aria-hidden
                >
                  {review.initial}
                </span>
                <span className="min-w-0">
                  <b className="block text-[14px] font-bold">{review.name}</b>
                  <span className="text-[12.5px] text-muted-foreground">{review.program}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// 후기 섹션 예시 데이터 (화면 구성 확인용 — 위 TODO 참고)
const REVIEWS = [
  {
    text: "아이와 유아숲체험에 참여했는데, 전문가분이 해설을 너무 쉽고 재미있게 해주셔서 아이가 숲을 보는 눈이 달라졌어요. 주말마다 또 가고 싶어해요!",
    name: "김민지 님",
    program: "유아숲체험 참여",
    initial: "김",
  },
  {
    text: "업무 스트레스로 머리가 복잡했는데 산림치유 프로그램에 참여하고 오니 몸과 마음이 정말 가벼워졌습니다. 전문가 지도 덕분에 깊이 몰입할 수 있었어요.",
    name: "박성우 님",
    program: "산림치유 참여",
    initial: "박",
  },
  {
    text: "등산 코스를 혼자 가기 무서웠는데 전문가와 함께 안전하게 트레킹을 즐길 수 있어 좋았습니다. 내 주변 숲의 새로운 매력을 알게 되었네요.",
    name: "이수진 님",
    program: "숲길등산 참여",
    initial: "이",
  },
];
