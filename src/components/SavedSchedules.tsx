/**
 * 이미 저장된 회차 목록 — 수정 화면에서 씁니다 (스키마 2-4).
 *
 * 삭제가 **즉시 반영**됩니다(저장 버튼을 기다리지 않음). 날짜 삭제는 서버가 예약
 * 유무를 확인해야 하는 작업이라, 화면에서 지운 척 해두고 나중에 한꺼번에 보내면
 * "지웠는데 되살아나는" 상태가 생깁니다.
 *
 * 지난 회차는 지울 수 없게 합니다 — 이미 진행한 기록이고, 예약·정산이 붙으면
 * 서버가 거부할 대상입니다.
 *
 * **매주 반복이 만든 날짜도 여기에 나옵니다** (2026-09-11). 못 가는 날을 닫는 방법이
 * 「그 회차를 지우기」 하나뿐이라(공휴일을 걸러내지 않음), 목록을 감추면 닫을 길이
 * 없어집니다. 지운 날짜는 규칙이 다시 만들지 않습니다 — 같은 이름을 쓰던 자리가
 * 비었는지가 아니라 「이미 있는지」로 판단하기 때문입니다.
 */

import type { ScheduleType } from "../types/firestore";

export interface SavedSchedule {
  id: string;
  /** ISO 문자열 (서버가 절대시각으로 내려줍니다) */
  startAt: string;
  endAt: string | null;
  seriesIndex: number | null;
  seriesTotal: number | null;
  totalSlots?: number;
  remainingSlots: number;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 한국시간 기준으로 「9월 5일 (토) 10:00~12:00」 */
function formatRange(startAt: string, endAt: string | null): string {
  const start = new Date(startAt);
  const kst = (d: Date) => new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const s = kst(start);
  const time = (d: Date) =>
    `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

  const head = `${s.getUTCMonth() + 1}월 ${s.getUTCDate()}일 (${WEEKDAYS[s.getUTCDay()]}) ${time(s)}`;
  if (!endAt) return head;
  return `${head}~${time(kst(new Date(endAt)))}`;
}

interface Props {
  scheduleType: ScheduleType;
  schedules: SavedSchedule[];
  onDelete: (scheduleId: string) => void;
  busy: boolean;
}

export default function SavedSchedules({ scheduleType, schedules, onDelete, busy }: Props) {
  if (scheduleType === "open") return null;

  // **매주 반복도 여기에 보여줍니다** (2026-09-11). 규칙이 만든 날짜라도 못 가는 날은
  // 그 날짜만 지워서 닫습니다 — 목록을 감추면 닫을 방법이 없어집니다.
  if (schedules.length === 0) {
    return (
      <p className="rounded-lg bg-destructive/10 px-3.5 py-3 text-[13px] leading-relaxed text-destructive">
        {scheduleType === "weekly"
          ? "열려 있는 날짜가 없습니다. 아래에서 진행 요일을 정하면 90일치 날짜가 자동으로 열립니다."
          : "저장된 진행 날짜가 없습니다. 날짜를 하나 이상 넣어야 게시할 수 있습니다."}
      </p>
    );
  }

  const now = Date.now();

  return (
    <ul className="flex flex-col gap-2">
      {schedules.map((s) => {
        const past = new Date(s.startAt).getTime() <= now;
        const total = s.totalSlots ?? s.remainingSlots;
        return (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5"
          >
            <div className="min-w-0">
              <p className={`text-[13.5px] font-medium ${past ? "text-muted-foreground" : ""}`}>
                {s.seriesIndex != null && (
                  <span className="mr-1.5 text-primary">{s.seriesIndex}회차</span>
                )}
                {formatRange(s.startAt, s.endAt)}
              </p>
              <p className="text-xs text-muted-foreground">
                정원 {total}명
                {s.remainingSlots !== total && ` · 남은 자리 ${s.remainingSlots}명`}
                {past && " · 지난 회차"}
              </p>
            </div>
            {past ? (
              <span className="shrink-0 text-[12px] text-muted-foreground">삭제 불가</span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`${formatRange(s.startAt, s.endAt)} 회차를 지울까요?`)) {
                    onDelete(s.id);
                  }
                }}
                className="shrink-0 text-[12.5px] text-muted-foreground underline hover:text-destructive disabled:opacity-50"
              >
                삭제
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
