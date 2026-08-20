/**
 * 상세 페이지 상단 사진 슬라이더 (스키마 20-3 · 20-5).
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
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-secondary text-lg font-bold text-secondary-foreground">
        {category}
      </div>
    );
  }

  const total = imageUrls.length;
  const go = (delta: number) => setIndex((i) => (i + delta + total) % total);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-muted">
      <img
        src={imageUrls[index]}
        alt={`${title} 사진 ${index + 1}`}
        // 첫 장은 화면에 바로 보이므로 지연 로딩하지 않습니다 — 늦게 뜨면
        // 페이지가 비어 보입니다. 나머지는 넘길 때 받습니다.
        loading={index === 0 ? "eager" : "lazy"}
        className="aspect-[4/3] w-full object-cover"
      />

      {/* 사진 위에 제목을 얹습니다 — 시안의 구성입니다. 글자가 밝은 사진에서
          묻히지 않게 아래쪽에 어두운 그라디언트를 깝니다. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/60 to-transparent" />
      <p className="absolute bottom-4 left-5 pr-24 text-lg font-extrabold tracking-tight text-white drop-shadow sm:text-xl">
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
  );
}
