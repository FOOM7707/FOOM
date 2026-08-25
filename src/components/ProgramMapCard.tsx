import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Star, X } from "lucide-react";
import type { Program } from "@/types/firestore";
import { formatDistance } from "@/lib/geo";
import { cn } from "@/lib/utils";

/**
 * 지도 위에 뜨는 프로그램 카드 (에어비앤비식).
 *
 * 목록형 카드(`ProgramCard`)와 따로 두는 이유는 **놓이는 자리가 다르기** 때문입니다.
 * 이 카드는 지도 위에 떠서 뒤에 있는 지도를 가리므로 폭이 좁아야 하고, 닫기 버튼과
 * 사진 넘기기가 필요합니다. 목록 카드에 그걸 넣으면 목록에서는 쓰지 않는 장치가
 * 따라다닙니다.
 *
 * **카드 자체가 `kakao.maps.CustomOverlay`의 내용물**입니다 — `ProgramMap`이 이 컴포넌트를
 * 오버레이 안으로 포털합니다. 그래서 여기서는 위치를 신경 쓰지 않고 생김새만 그립니다.
 */
interface Props {
  program: Program;
  /** 현재위치가 있을 때만 전달됩니다 */
  distanceKm?: number | null;
  onClose: () => void;
}

const SCHEDULE_LABEL: Record<Program["scheduleType"], string> = {
  single: "1회성",
  weekly: "매주 반복",
  series: "회차제",
  open: "날짜 협의",
};

export default function ProgramMapCard({ program, distanceKm, onClose }: Props) {
  const images = program.imageUrls ?? [];
  const [index, setIndex] = useState(0);

  // 사진이 아직 한 장도 없는 프로그램이 많습니다(업로드 UI 미구현 — 18번).
  // 그때는 목록 카드와 같은 자리표시자를 씁니다.
  const hasImages = images.length > 0;
  const showArrows = images.length > 1;

  function move(step: number) {
    setIndex((i) => (i + step + images.length) % images.length);
  }

  const rated = (program.ratingCount ?? 0) > 0;

  return (
    // 아래 여백은 핀 자리입니다 — 카드가 핀을 덮지 않고 그 위에 뜨게 합니다.
    <div className="w-[260px] pb-11">
      <div className="overflow-hidden rounded-2xl bg-card shadow-[0_6px_24px_rgba(0,0,0,.28)]">
        <div className="relative h-[140px] bg-secondary">
          {hasImages ? (
            <img
              src={images[index]}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm font-bold text-secondary-foreground">
              {program.category}
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-card/90 shadow-sm hover:bg-card"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          {showArrows && (
            <>
              <button
                type="button"
                onClick={() => move(-1)}
                aria-label="이전 사진"
                className="absolute left-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 shadow-sm hover:bg-card"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                aria-label="다음 사진"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 shadow-sm hover:bg-card"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1">
                {images.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full bg-white/60",
                      i === index && "bg-white"
                    )}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* 사진 아래 전체가 상세로 가는 링크입니다. 닫기·화살표는 위쪽에 있어
            링크 밖이므로, 누르다가 상세로 넘어가지 않습니다. */}
        <Link to={`/programs/${program.id}`} className="block px-3.5 py-3">
          <div className="mb-1 flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug">
              {program.title}
            </h3>
            {rated && (
              <span className="flex shrink-0 items-center gap-0.5 text-xs">
                <Star className="h-3 w-3 fill-current" />
                {program.ratingAvg?.toFixed(1)}
              </span>
            )}
          </div>

          <p className="truncate text-xs text-muted-foreground">
            {program.location.address}
            {typeof distanceKm === "number" && (
              <span className="ml-1.5 font-semibold text-primary">
                {formatDistance(distanceKm)}
              </span>
            )}
          </p>

          <p className="mt-0.5 text-xs text-muted-foreground">
            {SCHEDULE_LABEL[program.scheduleType]}
            {program.barrierFree && " · 무장애"}
          </p>

          <p className="mt-1.5 text-[13.5px]">
            <strong className="font-bold">{program.price.toLocaleString()}원</strong>
            <span className="text-muted-foreground"> / 1인</span>
          </p>
        </Link>
      </div>
    </div>
  );
}
