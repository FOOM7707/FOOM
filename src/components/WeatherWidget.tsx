import { getMockWeather, weatherIcon } from "@/lib/weather";
import type { LatLng } from "@/lib/geo";
import { cn } from "@/lib/utils";

interface Props {
  point: LatLng;
  regionLabel: string;
  /** 예보 기준일 — 프로그램 상세에서는 진행일을 넘깁니다 */
  date?: Date;
  /**
   * card = 흰 배경 카드 / inline = 상세 화면 회차 옆 한 줄
   * promo = 홈 프로모 카드(다크 그린 그라디언트) 안에 얹는 형태 — 스키마 9-7 ②
   */
  variant?: "card" | "inline" | "promo";
  className?: string;
}

/**
 * 날씨 위젯 (프로토타입 — mock 데이터).
 * 와이어프레임 v2: 홈 "🌤 오늘의 날씨", 상세 "🌤 날씨 예보(진행일 기준)" 대응.
 * 데이터 출처 교체는 src/lib/weather.ts 상단 TODO 참고.
 */
export default function WeatherWidget({
  point,
  regionLabel,
  date,
  variant = "card",
  className,
}: Props) {
  const w = getMockWeather(point, regionLabel, date);

  if (variant === "inline") {
    return (
      <span
        className={cn(
          "inline-flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground",
          className
        )}
      >
        <span aria-hidden>{weatherIcon(w.condition)}</span>
        <span>
          {w.condition} {w.tempC}℃ · 강수 {w.precipProbability}%
        </span>
        {w.advisory && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11.5px] font-semibold text-destructive">
            {w.advisory}
          </span>
        )}
      </span>
    );
  }

  if (variant === "promo") {
    return (
      <div
        className={cn(
          "flex items-center gap-4 rounded-2xl bg-white/10 px-5 py-4",
          className
        )}
      >
        <span className="text-4xl leading-none" aria-hidden>
          {weatherIcon(w.condition)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-[#C3DFC2]">
              {w.regionLabel} 오늘의 날씨
            </span>
            {w.advisory && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11.5px] font-semibold text-[#FFD9C2]">
                {w.advisory}
              </span>
            )}
          </div>
          <p className="text-[17px] font-bold text-white">
            {w.condition} {w.tempC}℃
            <span className="ml-2 text-[13px] font-medium text-[#C3DFC2]">
              강수확률 {w.precipProbability}%
            </span>
          </p>
          <p className="mt-0.5 truncate text-[13px] text-[#C3DFC2]">{w.comment}</p>
        </div>
        <span className="hidden shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white sm:inline">
          참고용
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-2xl border bg-white px-5 py-4",
        className
      )}
    >
      <span className="text-4xl leading-none" aria-hidden>
        {weatherIcon(w.condition)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-muted-foreground">
            {w.regionLabel}
          </span>
          {w.advisory && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11.5px] font-semibold text-destructive">
              {w.advisory}
            </span>
          )}
        </div>
        <p className="text-[17px] font-bold text-secondary-foreground">
          {w.condition} {w.tempC}℃
          <span className="ml-2 text-[13px] font-medium text-muted-foreground">
            강수확률 {w.precipProbability}%
          </span>
        </p>
        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{w.comment}</p>
      </div>
      <span className="hidden shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground sm:inline">
        참고용
      </span>
    </div>
  );
}
