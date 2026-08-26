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

interface Props {
  imageUrls: string[];
  title: string;
  category: string;
}

export default function ProgramGallery({ imageUrls, title, category }: Props) {
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

      {/* ── 넓은 화면: 3분할 그리드 ──────────────────────────────────────
          첫 장이 왼쪽 큰 칸, 나머지 두 장이 오른쪽에 위아래로 들어갑니다.
          사진이 한 장뿐이면 칸을 나누지 않고 가로 전체를 씁니다 — 빈 칸을 회색으로
          남기면 「사진을 덜 올린 프로그램」이 고장난 것처럼 보입니다. */}
      <div
        className={
          "hidden h-[440px] gap-2 overflow-hidden rounded-2xl bg-muted md:grid" +
          (tiles.length === 1
            ? " grid-cols-1"
            : tiles.length === 2
              ? " grid-cols-2"
              : " grid-cols-3 grid-rows-2")
        }
      >
        {tiles.map((url, i) => (
          <div
            key={url}
            className={
              "relative overflow-hidden bg-muted" +
              // 첫 장은 왼쪽에서 두 칸(3장일 때는 두 줄까지) 차지합니다.
              (tiles.length === 3 && i === 0 ? " col-span-2 row-span-2" : "")
            }
          >
            <img
              src={url}
              alt={`${title} 사진 ${i + 1}`}
              loading={i === 0 ? "eager" : "lazy"}
              className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.03]"
            />

            {/* 제목은 큰 칸에만 얹습니다 — 작은 칸에 겹치면 사진도 글자도 안 보입니다 */}
            {i === 0 && (
              <>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/60 to-transparent" />
                <p className="absolute bottom-5 left-6 pr-8 text-2xl font-extrabold tracking-tight text-white drop-shadow">
                  {title}
                </p>
              </>
            )}

            {/* 마지막 칸에만 남은 장수를 알립니다 */}
            {overflow > 0 && i === tiles.length - 1 && (
              <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                사진 {total}장
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
