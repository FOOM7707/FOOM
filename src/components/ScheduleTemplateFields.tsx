/**
 * 매주 반복 규칙 입력 (2026-09-11, 스키마 2-4).
 *
 * **「매주 화요일 10시」를 한 번 정해두면 90일치 날짜가 저절로 열립니다.** 그전에는
 * 같은 요일을 여러 줄 직접 추가하는 방법뿐이라, 매주 여는 프로그램은 1년에 50번 넘게
 * 손으로 넣어야 했습니다(그래서 「매주 반복」이 선택지에서 빠져 있었습니다).
 *
 * **날짜 칸이 아니라 규칙 칸입니다.** 여기서 정하는 것은 요일·시각·정원·기간이고,
 * 실제 날짜는 서버가 만듭니다 — 화면에서 90개 날짜를 보여주고 고치게 하면 「규칙을
 * 한 번 정한다」는 이점이 사라집니다.
 *
 * **못 가는 날은 규칙이 아니라 회차를 지워서 닫습니다.** 공휴일·주말을 걸러내지
 * 않습니다 — 숲 프로그램은 쉬는 날이 성수기라 빼면 가장 잘 팔리는 날이 예약 불가가
 * 됩니다(2-4 팀 확정).
 *
 * 저장된 규칙을 지우는 것은 **즉시 반영**됩니다(저장 버튼을 기다리지 않음). 서버가
 * 예약 유무를 확인해야 하는 작업이라, 화면에서 지운 척 해두고 나중에 보내면 「지웠는데
 * 되살아나는」 상태가 생깁니다 — 저장된 회차 목록과 같은 판단입니다.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import TimeField from "@/components/TimeField";
import { addHours, formatHourMinute, parseTime } from "@/lib/time";

/** 요일 상한 — 서버(`MAX_TEMPLATES_PER_PROGRAM`)와 같은 값이어야 합니다. 7 = 매일. */
export const MAX_TEMPLATE_ROWS = 7;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export interface ScheduleTemplateRowInput {
  /** `"2"` — 0(일)~6(토). 화면 값이라 문자열로 둡니다 */
  weekday: string;
  startTime: string;
  endTime: string;
  capacity: string;
  activeFrom: string;
  activeUntil: string;
}

/** 이미 저장된 규칙 한 줄(서버 응답). */
export interface SavedScheduleTemplate {
  id: string;
  weekday: number;
  weekdayLabel: string;
  timeOfDay: string;
  endTimeOfDay: string | null;
  capacityPerOccurrence: number;
  activeFrom: string;
  activeUntil: string | null;
}

export function emptyTemplateRow(capacity: string): ScheduleTemplateRowInput {
  return {
    weekday: "",
    startTime: "10:00",
    endTime: "12:00",
    capacity,
    activeFrom: "",
    activeUntil: "",
  };
}

/** 서버로 보낼 형태. 요일을 안 고른 줄은 보내지 않습니다. */
export function toTemplatePayload(rows: ScheduleTemplateRowInput[]): Array<{
  weekday: number;
  timeOfDay: string;
  endTimeOfDay: string | null;
  capacityPerOccurrence: number;
  activeFrom: string | null;
  activeUntil: string | null;
}> {
  return rows
    .filter((r) => r.weekday !== "" && r.startTime.trim() !== "")
    .map((r) => ({
      weekday: Number(r.weekday),
      timeOfDay: r.startTime,
      endTimeOfDay: r.endTime.trim() === "" ? null : r.endTime,
      capacityPerOccurrence: Number(r.capacity),
      // 비워 두면 서버가 오늘부터로 채웁니다 — 「언제부터」를 매번 묻지 않습니다.
      activeFrom: r.activeFrom.trim() === "" ? null : r.activeFrom,
      activeUntil: r.activeUntil.trim() === "" ? null : r.activeUntil,
    }));
}

/** `"14:00"` → 「오후 2:00」. 12시간제 변환은 `lib/time.ts` 한 곳만 씁니다. */
function clock(value: string): string {
  const parsed = parseTime(value);
  if (parsed == null) return value;
  return `${parsed.pm ? "오후" : "오전"} ${formatHourMinute(parsed)}`;
}

/** 「매주 화요일 오전 10:00~오후 12:00 · 10명」 */
function describe(t: SavedScheduleTemplate): string {
  const time = t.endTimeOfDay
    ? `${clock(t.timeOfDay)}~${clock(t.endTimeOfDay)}`
    : clock(t.timeOfDay);
  return `매주 ${t.weekdayLabel}요일 ${time} · ${t.capacityPerOccurrence}명`;
}

interface Props {
  rows: ScheduleTemplateRowInput[];
  onChange: (rows: ScheduleTemplateRowInput[]) => void;
  /** 이미 저장된 규칙 — 수정 화면에서만 들어옵니다 */
  saved?: SavedScheduleTemplate[];
  onDeleteSaved?: (templateId: string) => void;
  /** 프로그램 최대 인원 — 회차 정원의 기본값이자 상한입니다 */
  programCapacity: string;
  busy?: boolean;
}

export default function ScheduleTemplateFields({
  rows,
  onChange,
  saved = [],
  onDeleteSaved,
  programCapacity,
  busy = false,
}: Props) {
  const total = saved.length + rows.length;

  function update(index: number, patch: Partial<ScheduleTemplateRowInput>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function add() {
    if (total >= MAX_TEMPLATE_ROWS) return;
    onChange([...rows, emptyTemplateRow(programCapacity || "")]);
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {saved.length > 0 && (
        <ul className="flex flex-col gap-2">
          {saved.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium">{describe(t)}</p>
                <p className="text-xs text-muted-foreground">
                  {t.activeFrom}부터
                  {t.activeUntil ? ` ${t.activeUntil}까지` : " 계속"}
                </p>
              </div>
              {onDeleteSaved && (
                <button
                  type="button"
                  onClick={() => onDeleteSaved(t.id)}
                  disabled={busy}
                  className="shrink-0 text-[12.5px] text-muted-foreground underline hover:text-destructive disabled:opacity-50"
                >
                  규칙 삭제
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {rows.map((row, i) => (
        <div key={i} className="flex flex-col gap-2.5 rounded-lg border px-3.5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-primary">반복 규칙</span>
            {(rows.length > 1 || saved.length > 0) && (
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-[12.5px] text-muted-foreground underline hover:text-destructive"
              >
                삭제
              </button>
            )}
          </div>

          {/* 요일은 목록이 아니라 칸 일곱 개입니다 — 목록으로 만들면 열어서 골라야
              하는데, 일곱 개는 한눈에 다 보이는 편이 빠릅니다. */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[12.5px]">진행 요일</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((name, day) => {
                const selected = row.weekday === String(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => update(i, { weekday: String(day) })}
                    aria-pressed={selected}
                    className={
                      "h-11 w-11 rounded-[10px] border text-[15px] transition-colors " +
                      (selected
                        ? "border-primary bg-primary text-primary-foreground font-semibold"
                        : "hover:border-primary")
                    }
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-x-4 gap-y-2.5">
            <TimeField
              id={`template-start-${i}`}
              label="시작"
              value={row.startTime}
              onChange={(next) => update(i, { startTime: next })}
              required
            />
            <TimeField
              id={`template-end-${i}`}
              label="종료"
              value={row.endTime}
              onChange={(next) => update(i, { endTime: next })}
              allowEmpty
              emptyDefault={addHours(row.startTime, 2)}
            />
            <div className="flex w-[6rem] flex-col gap-1">
              <Label htmlFor={`template-capacity-${i}`} className="text-[12.5px]">
                회차당 정원
              </Label>
              <Input
                id={`template-capacity-${i}`}
                type="number"
                min={1}
                value={row.capacity}
                onChange={(e) => update(i, { capacity: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2.5">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`template-from-${i}`} className="text-[12.5px]">
                시작일
              </Label>
              <Input
                id={`template-from-${i}`}
                type="date"
                className="max-w-[13rem]"
                value={row.activeFrom}
                onChange={(e) => update(i, { activeFrom: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`template-until-${i}`} className="text-[12.5px]">
                종료일 (비우면 계속)
              </Label>
              <Input
                id={`template-until-${i}`}
                type="date"
                className="max-w-[13rem]"
                value={row.activeUntil}
                onChange={(e) => update(i, { activeUntil: e.target.value })}
              />
            </div>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={total >= MAX_TEMPLATE_ROWS}
        >
          + 요일 추가
        </Button>
        <span className="text-xs text-muted-foreground">
          {total >= MAX_TEMPLATE_ROWS
            ? "요일은 일곱 개까지입니다(매주 매일)"
            : "같은 요일에 두 번 열면 규칙을 두 개 만듭니다"}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        저장하면 <strong className="font-semibold">앞으로 90일치</strong> 날짜가 자동으로
        열리고, 하루가 지날 때마다 뒤쪽으로 한 칸씩 이어집니다. 못 가는 날은 저장 뒤
        회차 목록에서 그 날짜만 지우면 됩니다 — 주말·공휴일도 그대로 열립니다.
      </p>
    </div>
  );
}
