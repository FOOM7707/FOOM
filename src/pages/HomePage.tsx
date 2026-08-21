
import { Link } from "react-router-dom";
import type { Category } from "@/types/firestore";

/**
 * 홈 화면 — docs/디자인-웹페이지-초안.html 기준 구현.
 * 확정사항은 스키마 v10 9-7 참고: 사진 카드 1장 고정(①), 날씨는 프로모 카드 편입(②),
 * Pretendard 단독(③), 지도는 홈에 배치하지 않고 "내 주변에서 찾기"로 진입(⑤).
 */

const WIDE_CONTAINER = "mx-auto w-full max-w-[1360px] px-6";

// 3. 카테고리 사진 카드 5종 — 자격유형 공식명칭 (스키마 9-7 ⑥)
//
// **이 사진은 우리가 넣는 고정 사진입니다(v29 팀 확정).** 등록된 프로그램의 사진을
// 끌어오지 않습니다 — 이 자리는 브랜드 첫인상이라 누가 무엇을 올리느냐에 따라 바뀌면
// 안 됩니다. 프로그램 사진이 쓰이는 곳은 목록 카드와 상세 페이지입니다.
//
// 파일을 넣는 방법: `public/home/`에 아래 `image` 이름으로 jpg를 넣으면 끝입니다.
// TODO(정식 오픈 전): `interimImage`의 Unsplash 외부 이미지는 시안 확인용 임시입니다.
// 자체 촬영·구매 이미지로 교체합니다 — 외부 핫링크 상태로 오픈하지 않습니다(9-7 ⑧).
const PHOTO_CARDS: {
  category: Category;
  tag: string;
  desc: [string, string];
  /** 우리가 넣는 고정 사진. `public/home/`에 이 이름으로 파일을 넣으면 바로 바뀝니다 */
  image: string;
  /** 파일을 넣기 전까지 임시로 보여줄 사진 — 오픈 전 반드시 교체 */
  interimImage: string;
}[] = [
  {
    category: "숲해설",
    tag: "🌳 숲해설",
    desc: ["숲해설가와 걷는", "자연 생태 체험"],
    image: "/home/forest-guide.jpg",
    interimImage:
      "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=800&q=80",
  },
  {
    category: "유아숲체험",
    tag: "🧒 유아숲",
    desc: ["아이와 함께하는", "창의 숲 놀이·교육"],
    image: "/home/kids-forest.jpg",
    interimImage:
      "https://images.unsplash.com/photo-1476514525535-ce74f45814d0?auto=format&fit=crop&w=800&q=80",
  },
  {
    category: "산림치유",
    tag: "🧘 치유",
    desc: ["몸과 마음을 쉬어가는", "숲 힐링 프로그램"],
    image: "/home/healing.jpg",
    interimImage:
      "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=800&q=80",
  },
  {
    category: "숲길등산",
    tag: "🥾 등산",
    desc: ["전문가와 안전하게", "걷는 트레킹 안내"],
    image: "/home/trail.jpg",
    interimImage:
      "https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&w=800&q=80",
  },
  {
    category: "단체·기업",
    tag: "🏢 단체",
    desc: ["기관 및 단체를 위한", "맞춤형 숲 프로그램"],
    image: "/home/group.jpg",
    interimImage:
      "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=800&q=80",
  },
];


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
  // 카테고리 카드 사진은 우리가 고정으로 넣습니다(v29) — 프로그램을 읽지 않습니다.
  // 날씨도 여기서 빼냈습니다(v29 팀 확정) — 아래 프로모 카드 주석 참고.
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
          {PHOTO_CARDS.map(({ category, tag, desc, image, interimImage }) => (
            <Link
              key={category}
              to={`/search?category=${encodeURIComponent(category)}`}
              className="group flex flex-col overflow-hidden rounded-[20px] border border-border bg-white shadow-[0_6px_20px_rgba(31,92,67,0.08)] transition-all duration-300 hover:-translate-y-2.5 hover:border-primary hover:shadow-[0_16px_36px_rgba(31,92,67,0.12)]"
            >
              <div className="relative max-h-[380px] w-full overflow-hidden bg-[#E2E7E3]" style={{ aspectRatio: "3 / 4" }}>
                <span className="absolute left-3.5 top-3.5 z-[2] rounded-full bg-white/95 px-3 py-[5px] text-[12px] font-extrabold text-foreground shadow-[0_4px_12px_rgba(0,0,0,0.1)] backdrop-blur-sm">
                  {tag}
                </span>
                {/* 이미지 1장 고정 — 자동 슬라이드 금지 (스키마 9-7 ①).

                    **등록된 프로그램의 사진을 쓰지 않습니다(v29 팀 확정).** 이 자리는
                    우리가 고르는 고정 사진이어야 합니다 — 프로그램 사진을 끌어오면
                    누가 무엇을 올리느냐에 따라 홈 첫 화면이 바뀌고, 통제할 수 없는
                    사진이 브랜드 첫인상이 됩니다.

                    `public/home/{파일명}.jpg`를 넣으면 그 파일이 쓰이고, 없으면 임시
                    사진으로 대체됩니다 — 파일만 넣으면 되도록 코드 수정이 필요 없게
                    해뒀습니다. */}
                <img
                  src={image}
                  onError={(e) => {
                    const el = e.currentTarget;
                    if (el.dataset.interim === "on") return;
                    el.dataset.interim = "on";
                    el.src = interimImage;
                  }}
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

      {/* 4. 프로모 2단 카드.

          **날씨를 여기서 빼냈습니다(v29 팀 확정).** 첫 화면의 날씨는 「어디 날씨인지」가
          정해지지 않습니다 — 위치를 물어보면 방문 즉시 권한 창이 뜨고, 안 물어보면
          서울 기준값이라 대부분의 방문자에게 틀립니다. **날씨가 필요한 자리는 프로그램
          상세**입니다. 거기서는 그 프로그램이 열리는 장소와 날짜가 정해져 있어 예약
          판단에 실제로 쓰입니다(16번). */}
      <section className={`${WIDE_CONTAINER} mb-[90px] grid grid-cols-1 gap-6 min-[1201px]:grid-cols-[1.8fr_1fr]`}>
        <div className="flex min-h-[220px] flex-col justify-center gap-3 rounded-[20px] bg-gradient-to-br from-[#1F5C43] to-[#163F2E] p-7 text-white min-[769px]:p-11">
          <b className="block text-[20px] font-extrabold leading-[1.35] min-[769px]:text-[24px]">
            우리 동네 숲에서 만나는
            <br />
            특별한 맞춤형 산림복지 서비스
          </b>
          <p className="text-[15px] leading-relaxed text-[#C3DFC2]">
            검증된 산림복지전문가가 직접 기획하고 운영합니다. 프로그램마다 진행 장소의
            날씨 예보를 함께 보여드립니다.
          </p>
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
