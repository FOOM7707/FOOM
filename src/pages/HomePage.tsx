import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import type { SearchRow } from "@/lib/programFilter";
import WeatherWidget from "../components/WeatherWidget";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { DEFAULT_CENTER } from "@/lib/geo";
import type { Category } from "@/types/firestore";

/**
 * 홈 화면 — docs/디자인-웹페이지-초안.html 기준 구현.
 * 확정사항은 스키마 v10 9-7 참고: 사진 카드 1장 고정(①), 날씨는 프로모 카드 편입(②),
 * Pretendard 단독(③), 지도는 홈에 배치하지 않고 "내 주변에서 찾기"로 진입(⑤).
 */

const WIDE_CONTAINER = "mx-auto w-full max-w-[1360px] px-6";

// 3. 카테고리 사진 카드 5종 — 자격유형 공식명칭 (스키마 9-7 ⑥)
// TODO(정식 오픈 전): fallbackImage의 Unsplash 외부 이미지는 시안 확인용 임시입니다.
// 자체 촬영·구매 이미지로 교체하고 Firebase Storage에서 서빙합니다 — 외부 핫링크
// 상태로 오픈하지 않습니다 (스키마 9-7 ⑧).
const PHOTO_CARDS: {
  category: Category;
  tag: string;
  desc: [string, string];
  fallbackImage: string;
}[] = [
  {
    category: "숲해설",
    tag: "🌳 숲해설",
    desc: ["숲해설가와 걷는", "자연 생태 체험"],
    fallbackImage:
      "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=800&q=80",
  },
  {
    category: "유아숲체험",
    tag: "🧒 유아숲",
    desc: ["아이와 함께하는", "창의 숲 놀이·교육"],
    fallbackImage:
      "https://images.unsplash.com/photo-1476514525535-ce74f45814d0?auto=format&fit=crop&w=800&q=80",
  },
  {
    category: "산림치유",
    tag: "🧘 치유",
    desc: ["몸과 마음을 쉬어가는", "숲 힐링 프로그램"],
    fallbackImage:
      "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=800&q=80",
  },
  {
    category: "숲길등산",
    tag: "🥾 등산",
    desc: ["전문가와 안전하게", "걷는 트레킹 안내"],
    fallbackImage:
      "https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&w=800&q=80",
  },
  {
    category: "단체·기업",
    tag: "🏢 단체",
    desc: ["기관 및 단체를 위한", "맞춤형 숲 프로그램"],
    fallbackImage:
      "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=800&q=80",
  },
];

/**
 * 카테고리 대표 이미지 — 그 카테고리의 **게시 중 프로그램**에서 `imageUrls[0]`을
 * 씁니다(대표 썸네일 규칙, 스키마 2-3).
 *
 * **게시된 프로그램이 없거나 사진이 없으면 준비된 사진으로 대체합니다.** 카드가
 * 비어 보이면 「고장」으로 읽히고, 홈은 첫 화면이라 그 인상이 가장 큽니다.
 * 자동 슬라이드는 채택하지 않았습니다 — 사진 1장 고정(9-7 ①).
 */
function representativeImage(
  rows: SearchRow[],
  category: Category,
  fallback: string
): string {
  const found = rows.find((p) => p.category === category && p.imageUrls?.[0]);
  return found?.imageUrls[0] ?? fallback;
}

// 5. 후기 섹션 예시 데이터 (초안 그대로 — 화면 구성 확인용)
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

export default function HomePage() {
  const { position, status, request } = useCurrentLocation();

  // 카테고리 카드의 사진을 채우기 위해 게시된 프로그램을 한 번 읽습니다.
  // **화면 렌더링을 막지 않습니다** — 사진이 늦게 와도 준비된 사진으로 먼저
  // 그려지고 값이 오면 바뀝니다(날씨 위젯과 같은 방식, 16-3).
  const [rows, setRows] = useState<SearchRow[]>([]);
  useEffect(() => {
    void apiFetch<{ programs: SearchRow[] }>("/programs/search?limit=100")
      .then((res) => setRows(res.programs))
      .catch(() => setRows([]));
  }, []);
  const weatherPoint = position ?? DEFAULT_CENTER;
  const weatherRegion = position ? "현재위치 주변" : "서울 중구";

  return (
    <div>
      {/* 2. 히어로 — 배지 + 제목 + 부제 + 버튼 2개 */}
      <section className="flex w-full flex-col items-center bg-gradient-to-b from-[#E8F0EC] to-[#F4F7F5] px-5 pb-[90px] pt-8 text-center">
        <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-primary/[0.12] px-3.5 py-[5px] text-[13px] font-bold text-primary">
          <span aria-hidden>🌲</span> 산림복지전문가 직연결 플랫폼
        </div>
        <h1 className="mb-2 text-[24px] font-extrabold leading-[1.25] tracking-[-0.8px] text-foreground min-[769px]:text-[34px] min-[1201px]:whitespace-nowrap">
          우리 동네 숲에서, 오늘 뭐 하지?
        </h1>
        <p className="mb-5 text-[15px] leading-snug text-[#4A5852] min-[1201px]:whitespace-nowrap">
          국가공인 산림복지전문가와 함께하는 맞춤형 숲 프로그램
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            to="/search"
            className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary px-[26px] py-[11px] text-[14px] font-bold text-primary-foreground transition-colors hover:bg-secondary-foreground"
          >
            프로그램 둘러보기
          </Link>
          {/* 지도는 홈에 두지 않고 검색 화면의 지도 토글로 진입 (스키마 9-7 ⑤) */}
          <Link
            to="/search?view=map&sort=near"
            className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-white px-[26px] py-[11px] text-[14px] font-bold text-primary transition-colors hover:bg-secondary"
          >
            📍 내 주변에서 찾기
          </Link>
        </div>
      </section>

      {/* 3. 사진 카드 5종 — 히어로 위로 겹쳐 올라오는 레이아웃 */}
      <section className={`${WIDE_CONTAINER} relative z-10 -mt-14 mb-20`}>
        <div className="grid grid-cols-1 gap-5 min-[481px]:grid-cols-2 min-[769px]:grid-cols-3 min-[1201px]:grid-cols-5">
          {PHOTO_CARDS.map(({ category, tag, desc, fallbackImage }) => (
            <Link
              key={category}
              to={`/search?category=${encodeURIComponent(category)}`}
              className="group flex flex-col overflow-hidden rounded-[20px] border border-border bg-white shadow-[0_6px_20px_rgba(31,92,67,0.08)] transition-all duration-300 hover:-translate-y-2.5 hover:border-primary hover:shadow-[0_16px_36px_rgba(31,92,67,0.12)]"
            >
              <div className="relative max-h-[380px] w-full overflow-hidden bg-[#E2E7E3]" style={{ aspectRatio: "3 / 4" }}>
                <span className="absolute left-3.5 top-3.5 z-[2] rounded-full bg-white/95 px-3 py-[5px] text-[12px] font-extrabold text-foreground shadow-[0_4px_12px_rgba(0,0,0,0.1)] backdrop-blur-sm">
                  {tag}
                </span>
                {/* 이미지 1장 고정 — 자동 슬라이드 금지 (스키마 9-7 ①) */}
                <img
                  src={representativeImage(rows, category, fallbackImage)}
                  alt={`${category} 프로그램`}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              </div>
              <div className="flex flex-1 flex-col bg-white px-[18px] pb-[22px] pt-[18px]">
                <div className="mb-1 flex w-full items-center justify-between">
                  <div className="text-[20px] font-extrabold tracking-[-0.4px] text-foreground">
                    {category}
                  </div>
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F4F7F5] text-[13px] text-primary transition-all group-hover:translate-x-[3px] group-hover:bg-primary group-hover:text-white"
                    aria-hidden
                  >
                    →
                  </div>
                </div>
                <div className="text-[14px] leading-[1.4] text-muted-foreground">
                  {desc[0]}
                  <br />
                  {desc[1]}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 4. 프로모 2단 카드 — 왼쪽 큰 카드에 날씨 편입 (스키마 9-7 ②) */}
      <section className={`${WIDE_CONTAINER} mb-[90px] grid grid-cols-1 gap-6 min-[1201px]:grid-cols-[1.8fr_1fr]`}>
        <div className="flex min-h-[220px] flex-col justify-between gap-7 rounded-[20px] bg-gradient-to-br from-[#1F5C43] to-[#163F2E] p-7 text-white min-[769px]:p-11">
          <div>
            <b className="mb-2 block text-[20px] font-extrabold leading-[1.35] min-[769px]:text-[24px]">
              우리 동네 숲에서 만나는
              <br />
              특별한 맞춤형 산림복지 서비스
            </b>
            <p className="text-[15px] text-[#C3DFC2]">
              검증된 산림복지전문가가 직접 기획하고 운영합니다.
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-4">
              <span className="text-[13px] font-bold text-white/90">오늘의 숲 날씨</span>
              {!position && (
                <button
                  className="shrink-0 text-[12.5px] text-[#C3DFC2] underline-offset-2 hover:text-white hover:underline disabled:opacity-60"
                  onClick={request}
                  disabled={status === "loading"}
                >
                  {status === "loading" ? "위치 확인 중…" : "내 위치로 보기"}
                </button>
              )}
            </div>
            <WeatherWidget point={weatherPoint} regionLabel={weatherRegion} variant="promo" />
            <p className="mt-2 text-[12px] leading-relaxed text-white/60">
              날씨는 예약 판단을 돕는 참고 정보입니다. 우천 시 진행 여부는 프로그램
              운영자가 결정합니다.
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start justify-between gap-6 rounded-[20px] border border-[#EFE4D6] bg-[#FAF6F0] px-7 py-9">
          <div>
            <b className="mb-1.5 block text-[19px] font-extrabold leading-[1.3] text-[#5A3E2B]">
              산림복지전문가이신가요?
            </b>
            <p className="text-[14px] text-[#8C6A53]">
              내 프로그램을 올리고 지역 주민들을 직접 만나보세요.
            </p>
          </div>
          <Link
            to="/programs/new"
            className="inline-block rounded-full bg-cta px-7 py-[13px] text-[14px] font-extrabold text-white transition-colors hover:bg-cta-hover"
          >
            전문가 가입하기
          </Link>
        </div>
      </section>

      {/* 5. 후기 섹션
          TODO(정식 오픈 전): 아래는 화면 구성 확인용 예시 후기입니다. 실제 reviews
          데이터가 0건인 상태로 정식 오픈하면 표시광고 문제가 되므로, 오픈 전에
          실제 데이터 연동 또는 섹션 숨김 처리가 반드시 필요합니다 (스키마 9-7 ④). */}
      <section className="w-full border-t border-border bg-white px-6 pb-[100px] pt-20 text-center">
        <div className="mx-auto max-w-[1200px]">
          <div
            className="mx-auto mb-4 flex h-[72px] w-[72px] items-center justify-center rounded-full border border-[#1A2421] text-center text-[9px] font-bold leading-[1.15] tracking-[0.08em] text-[#1A2421]"
            aria-hidden
          >
            FEEL THE
            <br />
            DIFFERENCE
          </div>
          <span className="mb-2 block text-[12px] font-bold uppercase tracking-[0.12em] text-[#00852E]">
            Real Experiences
          </span>
          <h2 className="mb-12 text-[24px] font-extrabold tracking-[-0.6px] text-foreground min-[769px]:text-[30px]">
            숲이 준 일상의 변화, 직접 경험한 이야기
          </h2>

          <div className="grid grid-cols-1 gap-5 text-left min-[901px]:grid-cols-3">
            {REVIEWS.map((review) => (
              <div
                key={review.name}
                className="flex flex-col justify-between rounded-xl border border-[#E1E8ED] bg-[#F0F5FA] px-6 py-7"
              >
                <div>
                  <div className="mb-3.5 text-[13px] tracking-[2px] text-[#FFB800]" aria-label="별점 5점 만점에 5점">
                    ★★★★★
                  </div>
                  <p className="mb-7 text-[14px] leading-[1.6] text-[#2A363B]">
                    "{review.text}"
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-[#A0C3E8] text-[13px] font-bold text-[#1E385B]"
                    aria-hidden
                  >
                    {review.initial}
                  </div>
                  <div>
                    <b className="block text-[14px] font-bold text-[#1E282A]">{review.name}</b>
                    <span className="text-[12px] text-[#68787E]">{review.program}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
