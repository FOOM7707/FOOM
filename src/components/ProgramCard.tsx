import { Link } from "react-router-dom";
import type { Program } from "../types/firestore";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistance } from "@/lib/geo";
import { cardImageUrl } from "@/lib/cardImage";

const SCHEDULE_LABEL: Record<Program["scheduleType"], string> = {
  single: "1회성",
  weekly: "매주 반복",
  series: "회차제",
  open: "상시모집(협의형)",
};

interface Props {
  program: Program;
  /** 현재위치가 있을 때만 전달됩니다 (없으면 거리 표시 생략) */
  distanceKm?: number | null;
}

export default function ProgramCard({ program, distanceKm }: Props) {
  const photo = cardImageUrl(program);

  return (
    <Link to={`/programs/${program.id}`}>
      <Card className="overflow-hidden py-0 transition-all hover:-translate-y-0.5 hover:shadow-md">
        {/* 대표 사진은 **첫 장**입니다(2-3). 목록에서는 그 사진의 **작은 판**을 씁니다
            (20-6, 2026-09-03) — 이 자리는 화면에서 260~280px인데 그전까지 상세용
            1600px짜리를 그대로 받았습니다. 작은 판이 없는 옛 사진은 큰 것으로
            되돌아갑니다(`cardImageUrl`).
            **지연 로딩합니다** — 목록은 카드가 여러 장이라 보이지 않는 것까지 받으면
            전송량이 가장 큰 화면이 됩니다.
            사진이 없으면 카테고리를 적습니다. 회색 빈 칸은 「깨진 화면」으로 읽힙니다. */}
        {photo ? (
          <img
            src={photo}
            alt=""
            loading="lazy"
            className="h-[120px] w-full bg-secondary object-cover"
          />
        ) : (
          <div
            className="flex h-[120px] items-center justify-center bg-secondary text-sm font-bold text-secondary-foreground"
            aria-hidden
          >
            {program.category}
          </div>
        )}
        <div className="px-4 pb-[18px] pt-3.5">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{SCHEDULE_LABEL[program.scheduleType]}</Badge>
            {program.barrierFree && (
              <Badge variant="outline" className="font-normal">
                무장애
              </Badge>
            )}
          </div>
          <h3 className="mb-1.5 text-base font-semibold">{program.title}</h3>
          <p className="mb-2 text-[13px] text-muted-foreground">
            {program.location.address}
            {typeof distanceKm === "number" && (
              <span className="ml-1.5 font-semibold text-primary">
                {formatDistance(distanceKm)}
              </span>
            )}
          </p>
          <p className="font-bold text-secondary-foreground">
            {program.price.toLocaleString()}원
          </p>
        </div>
      </Card>
    </Link>
  );
}
