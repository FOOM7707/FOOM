/**
 * 상세 페이지 상단 사진 (스키마 20-3 · 20-5).
 *
 * **넓은 화면은 3분할 그리드, 좁은 화면은 슬라이더입니다** (2026-08-25).
 * 휴대폰에서 3분할을 그대로 쓰면 사진 한 장이 손톱만 해져 무엇인지 알아볼 수
 * 없습니다. 반대로 넓은 화면에서 슬라이더만 쓰면 한 번에 한 장뿐이라, 다섯 장을
 * 올려도 손님은 첫 장만 보고 넘어갑니다.
 *
 * **자동으로 넘어가지 않습니다.** 홈 카드에 자동 슬라이드를 넣지 않기로 한 것과 같은
 * 판단이고(첫 화면 로딩 부담), 상세에서도 읽는 중에 사진이 바뀌면 방해가 됩니다.
 *
 * **사진이 한 장이면 화살표와 「1/1」을 그리지 않습니다.** 누를 데가 없는 버튼을 두지
 * 않는다는 규칙(15-9)이 여기에도 적용됩니다.
 *
 * **사진이 없으면 회색 자리 대신 카테고리를 적습니다.** 아직 사진을 올리지 않은
 * 프로그램이 「깨진 화면」으로 보이지 않게 하기 위함입니다.
 */

import { useState } from "react";
import { cardImageUrl } from "@/lib/cardImage";

interface Props {
  imageUrls: string[];
  /**
   * 목록용 작은 사진(600px). **넓은 화면의 작은 옆 칸**에만 씁니다(20-6).
   *
   * 옆 칸은 화면에서 300~400px인데 큰 사진(1600px)을 받고 있었습니다 — 상세
   * 한 번 여는 데 옆 두 장만으로 400KB가 더 나갔습니다. 큰 메인 칸과 휴대폰
   * 슬라이더는 사진이 크게 보이는 자리라 **원본 그대로** 둡니다.
   *
   * 작은 판이 없는 옛 사진은 `cardImageUrl`이 큰 사진으로 되돌립니다.
   */
  thumbUrls?: string[];
  title: string;
  category: string;
}

export default function ProgramGallery({ imageUrls, thumbUrls, title, category }: Props) {
  const [index, setIndex] = useState(0);

  if (imageUrls.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-secondary text-lg font-bold text-secondary-foreground sm:aspect-[16/7]">
        {category}
      </div>
    );
  }

  const total = imageUrls.length;
  const go = (delta: number) => setIndex((i) => (i + delta + total) % total);

  // 그리드에 놓을 사진은 최대 3장입니다. 남는 장수는 마지막 칸에 「+N」으로 알립니다 —
  // 더 있다는 사실을 감추면 넘겨볼 이유가 사라집니다.
  const tiles = imageUrls.slice(0, 3);
  const overflow = total - tiles.length;

  return (
    <>
      {/* ── 좁은 화면: 슬라이더 ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-muted md:hidden">
        <img
          src={imageUrls[index]}
          alt={`${title} 사진 ${index + 1}`}
          // 첫 장은 화면에 바로 보이므로 지연 로딩하지 않습니다 — 늦게 뜨면
          // 페이지가 비어 보입니다. 나머지는 넘길 때 받습니다.
          loading={index === 0 ? "eager" : "lazy"}
          // 이 화면에서 가장 큰 요소가 이 사진입니다(LCP). 「최우선」을 붙이면
          // 브라우저가 글꼴·스크립트보다 먼저 받기 시작합니다 — 안 붙이면 같은
          // 줄에 선 다른 요청과 순서를 다툽니다.
          fetchPriority={index === 0 ? "high" : "auto"}
          className="aspect-[4/3] w-full object-cover"
        />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/60 to-transparent" />
        <p className="absolute bottom-4 left-5 pr-24 text-lg font-extrabold tracking-tight text-white drop-shadow">
          {title}
        </p>

        {total > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="이전 사진"
              className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-lg font-bold text-white backdrop-blur-sm transition-colors hover:bg-black/60"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="다음 사진"
              className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-lg font-bold text-white backdrop-blur-sm transition-colors hover:bg-black/60"
            >
              ›
            </button>
            <span className="absolute bottom-4 right-4 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {index + 1} / {total}
            </span>
          </>
        )}
      </div>

      {/* ── 넓은 화면: 3패널 — 왼쪽 큰 세로(60%) + 오른쪽 2칸 ──────────────
          왼쪽 메인 패널이 가로 60%를 차지하며 세로로 큽니다. 오른쪽에는 같은
          높이의 두 칸을 위아래로 쌓습니다. 패널마다 둥근 모서리를 주고 사이를
          흰 간격으로 띄웁니다.
          **높이는 440px로 고정**합니다 — 정사각형으로 두면 오른쪽 40% 너비만큼
          높아져 세로가 너무 길어집니다(전 버전과 같은 높이로 맞춤).
          한 장뿐이면 나누지 않고 가로 전체를 씁니다 — 빈 칸을 회색으로 남기면
          「사진을 덜 올린 프로그램」이 고장난 것처럼 보입니다.
          **큰 메인은 원본, 오른쪽 작은 칸은 작은 판을 받습니다**(20-6). */}
      {tiles.length === 1 ? (
        <div className="relative hidden h-[440px] overflow-hidden rounded-2xl bg-muted md:block">
          <img
            src={imageUrls[0]}
            alt={`${title} 사진 1`}
            loading="eager"
            fetchPriority="high"
            className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.03]"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/60 to-transparent" />
          <p className="absolute bottom-5 left-6 pr-8 text-2xl font-extrabold tracking-tight text-white drop-shadow">
            {title}
          </p>
        </div>
      ) : (
        <div className="hidden h-[440px] grid-cols-[3fr_2fr] grid-rows-2 gap-2.5 md:grid">
          {/* 왼쪽 메인 — 두 줄을 차지해 세로로 큼 */}
          <div className="relative row-span-2 overflow-hidden rounded-2xl bg-muted">
            <img
              src={imageUrls[0]}
              alt={`${title} 사진 1`}
              loading="eager"
              fetchPriority="high"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 hover:scale-[1.03]"
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/60 to-transparent" />
            <p className="absolute bottom-5 left-6 pr-8 text-2xl font-extrabold tracking-tight text-white drop-shadow">
              {title}
            </p>
          </div>

          {/* 오른쪽 — 두 칸. 사진 2장이면 한 칸이 두 줄을 채웁니다. */}
          {tiles.slice(1, 3).map((url, k) => {
            const i = k + 1;
            return (
              <div
                key={url}
                className={
                  "relative overflow-hidden rounded-2xl bg-muted" +
                  // 2장이면 오른쪽 한 칸이 두 줄을 채웁니다. 3장 이상은 각 칸이
                  // 고정 높이의 한 줄을 차지합니다(정사각형 대신 높이 고정 — 위 주석).
                  (tiles.length === 2 ? " row-span-2" : "")
                }
              >
                <img
                  // 오른쪽 작은 칸은 작은 판을 받습니다(20-6). 없으면 큰 사진.
                  src={cardImageUrl({ imageUrls, thumbUrls }, i) ?? url}
                  alt={`${title} 사진 ${i + 1}`}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 hover:scale-[1.03]"
                />
                {/* 마지막 칸에만 남은 장수를 알립니다 */}
                {overflow > 0 && i === tiles.length - 1 && (
                  <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                    사진 {total}장
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
