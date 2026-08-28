import { useRef, useState } from "react";

/**
 * 홈 후기 가로 캐러셀 (2026-08-28).
 *
 * 세로로 쌓던 후기를 **옆으로 끌어 넘기는** 형태로 바꿉니다. 터치 기기는 브라우저
 * 기본 가로 스크롤에 맡기고(관성·부드러움이 이미 좋습니다), **마우스만** 직접 끌어
 * 옮기게 합니다 — 데스크톱에는 손가락 스와이프가 없어 끌기가 없으면 스크롤바로만
 * 넘겨야 합니다.
 *
 * ⚠️ 터치에서 `scrollLeft`를 손으로 만지면 브라우저 관성 스크롤과 이중으로 겹쳐
 *    끊깁니다. 그래서 `pointerType === 'mouse'`일 때만 개입합니다.
 *
 * 스냅(`snap-x`)으로 놓을 때 카드가 가지런히 멈추고, 좁은 화면에서는 다음 카드가
 * 살짝 보이게 폭을 잡아 「옆에 더 있다」를 알립니다.
 *
 * 후기 데이터는 홈이 넘겨줍니다(지금은 예시, 정식 오픈 전 실데이터 연동 — 9-7 ④).
 */

export interface HomeReview {
  text: string;
  name: string;
  program: string;
  initial: string;
}

export default function ReviewCarousel({ reviews }: { reviews: HomeReview[] }) {
  const trackRef = useRef<HTMLUListElement>(null);
  // 렌더를 유발하지 않도록 드래그 좌표는 ref에, 커서 모양만 state로 둡니다.
  const drag = useRef({ active: false, startX: 0, startScroll: 0 });
  const [grabbing, setGrabbing] = useState(false);

  function onPointerDown(e: React.PointerEvent<HTMLUListElement>) {
    // 마우스만 직접 끌기 — 터치·펜은 네이티브 가로 스크롤에 맡깁니다.
    if (e.pointerType !== "mouse") return;
    const el = trackRef.current;
    if (!el) return;
    drag.current = { active: true, startX: e.clientX, startScroll: el.scrollLeft };
    setGrabbing(true);
    el.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLUListElement>) {
    const el = trackRef.current;
    if (!el || !drag.current.active) return;
    el.scrollLeft = drag.current.startScroll - (e.clientX - drag.current.startX);
  }

  function endDrag(e: React.PointerEvent<HTMLUListElement>) {
    if (!drag.current.active) return;
    drag.current.active = false;
    setGrabbing(false);
    trackRef.current?.releasePointerCapture?.(e.pointerId);
  }

  return (
    <ul
      ref={trackRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={[
        "flex snap-x snap-mandatory gap-5 overflow-x-auto pb-2",
        // 스크롤바는 감춥니다 — 끌어서 넘기는 형태라 막대는 군더더기입니다.
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        // 끄는 동안 커서 모양과 글자 선택 방지 — 끌다가 문장이 선택되면 어색합니다.
        grabbing ? "cursor-grabbing select-none" : "cursor-grab",
      ].join(" ")}
    >
      {reviews.map((review) => (
        <li
          key={review.name}
          className="flex shrink-0 basis-[82%] snap-start flex-col justify-between rounded-2xl border bg-card px-6 py-6 sm:basis-[340px]"
        >
          <div>
            <div
              className="mb-3 text-[13px] tracking-[2px] text-cta"
              aria-label="별점 5점 만점에 5점"
            >
              ★★★★★
            </div>
            {/* 끌 때 이미지처럼 딸려가지 않게 — 텍스트 드래그 고스트 방지 */}
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
  );
}
