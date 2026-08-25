import { useEffect, useState } from "react";
import {
  fetchWeather,
  unavailableMessage,
  weatherIcon,
  type WeatherResult,
} from "@/lib/weather";
import type { LatLng } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { CloudSun } from "lucide-react";

interface Props {
  point: LatLng;
  regionLabel: string;
  /** 예보 기준일 — 프로그램 상세에서는 진행일을 넘깁니다 */
  date?: Date;
  /**
   * card = 흰 배경 카드 / inline = 상세 화면 회차 옆 한 줄
   *
   * `promo`(홈 프로모 카드 안에 얹는 형태)는 **v29에서 지웠습니다** — 홈에서 날씨를
   * 빼면서 쓰는 곳이 없어졌습니다. 쓰지 않는 분기를 남겨두면 나중에 고칠 때 어느
   * 화면에 영향이 가는지 확인하느라 시간을 씁니다.
   */
  variant?: "card" | "inline";
  className?: string;
}

/**
 * 날씨 위젯 (스키마 16번 — 기상청 단기예보).
 *
 * **화면 렌더링을 막지 않습니다(16-3).** 자리표시자를 먼저 그리고 값이 오면
 * 채웁니다. 예보가 없는 기간이거나 기상청이 응답하지 않으면 안내 문구로
 * 대체하고, 카드 자체가 사라지거나 오류를 띄우지는 않습니다.
 */
export default function WeatherWidget({
  point,
  regionLabel,
  date,
  variant = "card",
  className,
}: Props) {
  const [result, setResult] = useState<WeatherResult | null>(null);

  // 좌표를 소수점 2자리로 끊어 의존성으로 씁니다 — 부모가 객체를 새로 만들어도
  // 값이 같으면 다시 부르지 않습니다.
  const latKey = point.lat.toFixed(2);
  const lngKey = point.lng.toFixed(2);
  const dateKey = date?.toISOString().slice(0, 10) ?? "";

  useEffect(() => {
    let alive = true;
    setResult(null);

    void fetchWeather(point, regionLabel, date).then((next) => {
      // 화면을 벗어난 뒤 도착한 응답으로 상태를 건드리지 않습니다.
      if (alive) setResult(next);
    });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latKey, lngKey, dateKey, regionLabel]);

  const w = result?.weather ?? null;
  const loading = result === null;
  const message = loading ? "날씨를 불러오는 중…" : unavailableMessage(result.reason);

  // ── inline — 상세 화면 회차 옆 한 줄 ───────────────────────────────────
  if (variant === "inline") {
    return (
      <span
        className={cn(
          "inline-flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground",
          className
        )}
      >
        {w ? (
          <>
            {(() => {
              const Icon = weatherIcon(w.condition);
              return <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />;
            })()}
            <span>
              {w.condition} {w.tempC}℃ · 강수 {w.precipProbability}%
            </span>
            {w.advisory && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11.5px] font-semibold text-destructive">
                {w.advisory}
              </span>
            )}
          </>
        ) : (
          <span>{message}</span>
        )}
      </span>
    );
  }

  // ── card — 기본 ────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-2xl border bg-card px-5 py-4",
        className
      )}
    >
      {(() => {
        const Icon = w ? weatherIcon(w.condition) : CloudSun;
        return (
          <Icon
            className={cn("h-9 w-9 shrink-0", w ? "text-primary" : "text-muted-foreground")}
            strokeWidth={1.5}
            aria-hidden
          />
        );
      })()}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-muted-foreground">
            {regionLabel}
          </span>
          {w?.advisory && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11.5px] font-semibold text-destructive">
              {w.advisory}
            </span>
          )}
        </div>
        {w ? (
          <>
            <p className="text-[17px] font-bold text-secondary-foreground">
              {w.condition} {w.tempC}℃
              <span className="ml-2 text-[13px] font-medium text-muted-foreground">
                강수확률 {w.precipProbability}%
              </span>
            </p>
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {w.comment}
            </p>
          </>
        ) : (
          <p className="text-[15px] font-semibold text-muted-foreground">{message}</p>
        )}
      </div>
      <span className="hidden shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground sm:inline">
        참고용
      </span>
    </div>
  );
}
