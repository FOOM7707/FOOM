/**
 * 진행 날짜(회차) 입력 — 프로그램 등록 화면의 일부 (스키마 2-4).
 *
 * 운영 방식에 따라 받는 것이 다릅니다.
 * - 1회성  : 날짜 한 줄
 * - 회차제 : 여러 줄(추가·삭제)
 * - 매주 반복 : **입력칸을 만들지 않습니다** — 반복 회차를 만드는 서버 경로가
 *   아직 없어서, 칸을 두면 입력해도 저장되지 않는 것처럼 보입니다
 * - 상시모집 : 날짜를 받지 않습니다(예약자와 협의). 문의 가능 기간만 받습니다
 *
 * **공휴일·주말을 걸러내지 않습니다.** 숲 프로그램은 쉬는 날이 성수기라, 빼면
 * 가장 잘 팔리는 날이 예약 불가가 됩니다. 특정 날짜를 닫아야 하면 그 회차를
 * 지우는 방식으로 처리합니다 — 못 가는 날을 아는 주체는 전문가 본인입니다.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ScheduleType } from "../types/firestore";

export interface ScheduleRowInput {
  date: string;
  startTime: string;
  endTime: string;
  capacity: string;
}

/** 회차 상한 — 서버(`MAX_SCHEDULES_PER_PROGRAM`)와 같은 값이어야 합니다. */
export const MAX_SCHEDULE_ROWS = 50;

export function emptyScheduleRow(capacity: string): ScheduleRowInput {
  return { date: "", startTime: "10:00", endTime: "12:00", capacity };
}

/** 서버로 보낼 형태. 빈 줄은 보내지 않습니다. */
export function toSchedulePayload(
  rows: ScheduleRowInput[],
  scheduleType: ScheduleType
): Array<{ date: string; startTime: string; endTime: string | null; capacity: number }> {
  if (scheduleType !== "single" && scheduleType !== "series") return [];

  return rows
    .filter((r) => r.date.trim() !== "" && r.startTime.trim() !== "")
    .map((r) => ({
      date: r.date,
      startTime: r.startTime,
      endTime: r.endTime.trim() === "" ? null : r.endTime,
      capacity: Number(r.capacity),
    }));
}

interface Props {
  scheduleType: ScheduleType | null;
  rows: ScheduleRowInput[];
  onChange: (rows: ScheduleRowInput[]) => void;
  /** 프로그램 최대 인원 — 회차 정원의 기본값이자 상한입니다 */
  programCapacity: string;
  /**
   * 줄을 더 추가할 수 있는지. 기본값은 회차제만 true입니다.
   * 수정 화면에서 이미 저장된 날짜가 있는 1회성은 false여야 합니다 — 서버가
   * "1회성의 날짜는 하나"라며 거부하므로, 버튼을 보여주면 눌러서 거부당합니다.
   */
  canAdd?: boolean;
  /** 수정 화면에서는 이미 저장된 날짜를 위에 따로 보여주므로 안내 문구를 줄입니다 */
  compact?: boolean;
}

export default function ScheduleFields({
  scheduleType,
  rows,
  onChange,
  programCapacity,
  canAdd,
  compact = false,
}: Props) {
  function update(index: number, patch: Partial<ScheduleRowInput>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function add() {
    if (rows.length >= MAX_SCHEDULE_ROWS) return;
    onChange([...rows, emptyScheduleRow(programCapacity || "")]);
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  if (scheduleType == null) {
    return (
      <p className="rounded-lg bg-secondary px-3.5 py-3 text-[13px] leading-relaxed text-secondary-foreground">
        위에서 운영 방식을 먼저 골라 주세요. 방식에 따라 받는 날짜가 다릅니다.
      </p>
    );
  }

  if (scheduleType === "weekly") {
    return (
      <p className="rounded-lg bg-muted px-3.5 py-3 text-[13px] leading-relaxed text-muted-foreground">
        <strong className="font-semibold">매주 반복은 준비 중입니다.</strong> 지금은{" "}
        <strong className="font-semibold">회차제</strong>로 날짜를 직접 넣어 주세요 — 매주
        같은 요일을 여러 줄로 추가하면 같은 결과가 됩니다.
      </p>
    );
  }

  if (scheduleType === "open") {
    return (
      <p className="rounded-lg bg-secondary px-3.5 py-3 text-[13px] leading-relaxed text-secondary-foreground">
        상시모집은 날짜를 미리 정하지 않습니다. 결제 후 예약자와 협의해 정하므로, 아래{" "}
        <strong className="font-semibold">문의 가능 기간</strong>만 입력하시면 됩니다.
      </p>
    );
  }

  const isSeries = scheduleType === "series";
  const showAdd = canAdd ?? isSeries;

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border px-3.5 py-3">
          {isSeries && (
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-primary">
                {i + 1}회차
                {rows.length > 1 && (
                  <span className="font-normal text-muted-foreground"> / 전체 {rows.length}회</span>
                )}
              </span>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="text-[12.5px] text-muted-foreground underline hover:text-destructive"
                >
                  삭제
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <div className="flex min-w-[9.5rem] flex-1 flex-col gap-1">
              <Label htmlFor={`schedule-date-${i}`} className="text-[12.5px]">
                진행 날짜
              </Label>
              <Input
                id={`schedule-date-${i}`}
                type="date"
                value={row.date}
                onChange={(e) => update(i, { date: e.target.value })}
                required
              />
            </div>
            <div className="flex w-[6.5rem] flex-col gap-1">
              <Label htmlFor={`schedule-start-${i}`} className="text-[12.5px]">
                시작
              </Label>
              <Input
                id={`schedule-start-${i}`}
                type="time"
                value={row.startTime}
                onChange={(e) => update(i, { startTime: e.target.value })}
                required
              />
            </div>
            <div className="flex w-[6.5rem] flex-col gap-1">
              <Label htmlFor={`schedule-end-${i}`} className="text-[12.5px]">
                종료
              </Label>
              <Input
                id={`schedule-end-${i}`}
                type="time"
                value={row.endTime}
                onChange={(e) => update(i, { endTime: e.target.value })}
              />
            </div>
            <div className="flex w-[6rem] flex-col gap-1">
              <Label htmlFor={`schedule-capacity-${i}`} className="text-[12.5px]">
                정원
              </Label>
              <Input
                id={`schedule-capacity-${i}`}
                type="number"
                min={1}
                value={row.capacity}
                onChange={(e) => update(i, { capacity: e.target.value })}
                required
              />
            </div>
          </div>
        </div>
      ))}

      {showAdd && (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={add}
            disabled={rows.length >= MAX_SCHEDULE_ROWS}
          >
            {rows.length === 0 ? "+ 날짜 추가" : "+ 회차 추가"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {rows.length >= MAX_SCHEDULE_ROWS
              ? `회차는 ${MAX_SCHEDULE_ROWS}개까지 등록할 수 있습니다`
              : "주말·공휴일도 그대로 등록됩니다"}
          </span>
        </div>
      )}

      {rows.length > 0 && !compact && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          정원은 회차마다 따로 셉니다. 위의 「최대 인원」이 기본값으로 들어가고, 회차별로
          줄이거나 늘릴 수 있습니다(최대 인원까지).
        </p>
      )}
    </div>
  );
}
