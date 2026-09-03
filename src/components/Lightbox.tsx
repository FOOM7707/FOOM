/**
 * 사진 크게 보기 (라이트박스) — 상세 페이지 갤러리에서 사진을 누르면 열립니다.
 *
 * **여기서는 큰 사진(원본)을 씁니다.** 목록·갤러리 옆 칸은 작은 판을 쓰지만(20-6),
 * 크게 보는 자리는 사진이 주인공이라 원본이 필요합니다.
 *
 * **전체 사진을 넘겨볼 수 있습니다** — 갤러리에는 3장만 보이고 나머지는 가려지는데,
 * 여기서 좌우로 넘기면 올린 사진 전부를 봅니다.
 *
 * 닫기: 바깥(어두운 배경) 누르기 · 오른쪽 위 ✕ · Esc. 넘기기: 화살표 버튼 · ←/→ 키.
 * 열려 있는 동안 뒤 배경이 스크롤되지 않게 막습니다(안 막으면 사진을 넘기다 뒤
 * 페이지가 함께 밀립니다).
 */

import { useCallback, useEffect, useState } from "react";

interface Props {
  /** 원본 주소 목록 (작은 판이 아니라 큰 사진) */
  images: string[];
  /** 처음 보여줄 사진 번호 (누른 사진) */
  startIndex: number;
  title: string;
  onClose: () => void;
}

export default function Lightbox({ images, startIndex, title, onClose }: Props) {
  const total = images.length;
  const [current, setCurrent] = useState(startIndex);

  const go = useCallback(
    (delta: number) => setCurrent((c) => (c + delta + total) % total),
    [total]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    // 뒤 배경 스크롤 잠금 — 원래 값으로 되돌려 놓습니다.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [go, onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} 사진 크게 보기`}
    >
      {/* 닫기 */}
      <button
        type="button"
        onClick={onClose}
        aria-label="닫기"
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-2xl text-white transition-colors hover:bg-white/20"
      >
        ✕
      </button>

      {/* 몇 번째인지 */}
      {total > 1 && (
        <span className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-white/10 px-3.5 py-1 text-sm font-medium text-white">
          {current + 1} / {total}
        </span>
      )}

      {/* 사진 — 배경을 누르면 닫히므로, 사진 자체를 누른 것은 닫기로 안 셉니다 */}
      <img
        src={images[current]}
        alt={`${title} 사진 ${current + 1}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-[92vw] select-none rounded-lg object-contain"
        draggable={false}
      />

      {/* 좌우 넘기기 */}
      {total > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            aria-label="이전 사진"
            className="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-3xl text-white transition-colors hover:bg-white/20 sm:left-6"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label="다음 사진"
            className="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-3xl text-white transition-colors hover:bg-white/20 sm:right-6"
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}
