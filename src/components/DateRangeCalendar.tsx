/**
 * 기간 선택 달력 (스키마 17-2 · 17-4 ④).
 *
 * 표시 규칙은 17-4 ④의 표를 **그대로** 따릅니다 —
 * - 지난 날짜: 빗금 + 아주 흐린 회색 + **클릭 불가**(disabled). 흐리게만 하면
 *   눌러보고 반응이 없어 고장으로 읽힙니다
 * - 선택 기간: 시작·종료일은 진한 브랜드 그린, 사이는 한 단계 밝은 그린으로
 *   **끊김 없이 이어진 하나의 띠**. 기간 내 숫자는 전부 흰색
 * - 회차 있는 날: 숫자 아래 작은 점 (재료는 검색 응답의 `calendarDates` — 17-5의
 *   집계 문서가 생기면 그쪽으로 바뀌지만 이 컴포넌트는 배열만 받으므로 그대로입니다)
 * - 오늘: 초록 테두리
 *
 * **칸 사이 좌우 여백이 0이어야 띠가 이어집니다** — 프로토타입에서 여백 2px 때문에
 * 색이 조각나 보이는 문제가 실제로 있었습니다(17-4 ④). 위아래 여백만 둡니다.
 *
 * 이동 범위는 오늘 ~ +90일(회차 요약이 담는 범위와 같은 값 — 더 먼 달을 보여주면
 * 0건이 정상인데 고장으로 읽힙니다), 연속 최대 31일(넘겨 고르면 종료일을 당기고
 * 안내를 띄웁니다). 두 값 모두 서버가 한 번 더 잘라냅니다(17-6).
 */

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** 캘린더 이동 범위(오늘 ~ +N일). 서버 `CALENDAR_WINDOW_DAYS`와 같은 값이어야 합니다. */
const WINDOW_DAYS = 90;
/** 연속 선택 상한. 서버 `PERIOD_MAX_DAYS`와 같은 값이어야 합니다. */
const MAX_SPAN_DAYS = 31;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 지난 날짜의 빗금. 클래스로는 만들 수 없어 스타일로 둡니다. */
const HATCH_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.07) 3px, rgba(0,0,0,0.07) 4px)",
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + days));
}

interface Props {
  from: string | null;
  to: string | null;
  /**
   * 시작을 고르면 `(시작, null)`, 끝까지 고르면 `(시작, 끝)`으로 알립니다.
   * 시작보다 앞 날짜를 누르면 그 날짜로 다시 시작합니다.
   */
  onChange: (from: string | null, to: string | null) => void;
  /** 회차가 있는 날 — 숫자 아래 점을 찍습니다 */
  markedDates?: string[];
}

export default function DateRangeCalendar({ from, to, onChange, markedDates }: Props) {
  const today = ymd(new Date());
  const maxDate = addDays(today, WINDOW_DAYS);
  const marked = useMemo(() => new Set(markedDates ?? []), [markedDates]);

  // 보이는 첫 달 = 오늘의 달 + offset. 두 달을 나란히 보여주고(17-4 ④),
  // 둘째 달이 +90일이 속한 달을 넘지 않는 데까지만 넘길 수 있습니다.
  const [monthOffset, setMonthOffset] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const now = new Date();
  const monthIndexOf = (date: string) => {
    const [y, m] = date.split("-").map(Number);
    return y * 12 + (m - 1);
  };
  const firstMonthIndex = now.getFullYear() * 12 + now.getMonth() + monthOffset;
  const maxOffset = Math.max(0, monthIndexOf(maxDate) - (now.getFullYear() * 12 + now.getMonth()) - 1);

  function pickDate(d: string) {
    setNotice(null);
    // 새 선택 시작: 아직 시작이 없거나, 이미 기간이 완성돼 있거나, 시작보다 앞을 눌렀을 때.
    if (!from || to || d < from) {
      onChange(d, null);
      return;
    }
    if (d === from) {
      // 시작을 다시 누르면 그 하루로 확정합니다.
      onChange(from, from);
      return;
    }
    const cap = addDays(from, MAX_SPAN_DAYS - 1);
    if (d > cap) {
      onChange(from, cap);
      setNotice(`한 번에 ${MAX_SPAN_DAYS}일까지 고를 수 있어 종료일을 ${label(cap)}로 당겼습니다.`);
      return;
    }
    onChange(from, d);
  }

  function label(date: string): string {
    const [, m, d] = date.split("-").map(Number);
    return `${m}월 ${d}일`;
  }

  function renderMonth(monthIndex: number) {
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex % 12; // 0-based
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leadingBlanks = firstDay.getDay();

    const cells: React.ReactNode[] = [];
    for (let i = 0; i < leadingBlanks; i += 1) {
      cells.push(<div key={`blank-${i}`} />);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = ymd(new Date(year, month, day));
      const isPast = date < today;
      const beyondWindow = date > maxDate;
      const disabled = isPast || beyondWindow;
      const isToday = date === today;
      const end = to ?? from; // 시작만 있으면 그 하루가 띠입니다
      const inRange = from != null && end != null && date >= from && date <= end;
      const isEdge = date === from || date === end;
      const hasDot = marked.has(date);

      cells.push(
        <button
          key={date}
          type="button"
          disabled={disabled}
          onClick={() => pickDate(date)}
          aria-pressed={inRange}
          aria-label={`${year}년 ${month + 1}월 ${day}일${hasDot ? " (진행 날짜 있음)" : ""}`}
          style={isPast ? HATCH_STYLE : undefined}
          className={cn(
            // 좌우 여백 0 — 칸을 꽉 채워야 선택 띠가 끊기지 않습니다(17-4 ④).
            "relative flex h-9 w-full items-center justify-center text-[13px]",
            disabled && "pointer-events-none text-muted-foreground/40",
            !disabled && !inRange && "rounded-md hover:bg-secondary",
            inRange && "text-primary-foreground",
            inRange && !isEdge && "bg-primary/70",
            isEdge && "bg-primary font-bold",
            date === from && "rounded-l-full",
            date === end && "rounded-r-full",
            isToday && !inRange && "rounded-full ring-1 ring-inset ring-primary font-bold"
          )}
        >
          {day}
          {hasDot && (
            <span
              aria-hidden
              className={cn(
                "absolute bottom-1 h-1 w-1 rounded-full",
                inRange ? "bg-primary-foreground" : "bg-primary"
              )}
            />
          )}
        </button>
      );
    }

    return (
      <div key={monthIndex}>
        <p className="mb-2 text-center text-[13px] font-bold">
          {year}년 {month + 1}월
        </p>
        <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
          {WEEKDAYS.map((w) => (
            <span key={w} className="py-1">
              {w}
            </span>
          ))}
        </div>
        {/* gap-x를 두지 않습니다 — 위 「띠」 주석 참고. 위아래 여백만 둡니다. */}
        <div className="grid grid-cols-7 gap-y-1">{cells}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
          disabled={monthOffset === 0}
          aria-label="이전 달"
          className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-secondary disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-xs text-muted-foreground">
          오늘부터 90일 안에서, 한 번에 {MAX_SPAN_DAYS}일까지 고를 수 있습니다
        </p>
        <button
          type="button"
          onClick={() => setMonthOffset((o) => Math.min(maxOffset, o + 1))}
          disabled={monthOffset >= maxOffset}
          aria-label="다음 달"
          className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-secondary disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {renderMonth(firstMonthIndex)}
        {renderMonth(firstMonthIndex + 1)}
      </div>

      {notice && (
        <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-xs text-secondary-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}
