import { Link } from "react-router-dom";
import type { Program } from "../types/firestore";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistance } from "@/lib/geo";

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
  return (
    <Link to={`/programs/${program.id}`}>
      <Card className="overflow-hidden py-0 transition-all hover:-translate-y-0.5 hover:shadow-md">
        {/* 대표 사진은 `imageUrls[0]`입니다(2-3 — 별도 썸네일 필드를 두지 않음).
            **지연 로딩합니다** — 목록은 카드가 여러 장이라 보이지 않는 것까지 받으면
            전송량이 가장 큰 화면이 됩니다(20-6).
            사진이 없으면 카테고리를 적습니다. 회색 빈 칸은 「깨진 화면」으로 읽힙니다. */}
        {program.imageUrls?.[0] ? (
          <img
            src={program.imageUrls[0]}
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
