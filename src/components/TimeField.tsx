/**
 * 시간 입력 — **한 칸**입니다. 왼쪽에서 오전/오후를 고르고, 오른쪽에 시:분을 직접
 * 칩니다 (2026-08-27).
 *
 * **브라우저 기본 시간 칸(`input type="time"`)을 쓰지 않습니다.** 그 칸은 오전/오후를
 * 안쪽에 스스로 그리는데, 그 자리가 아주 좁고 오른쪽 화살표가 바꾸는 값이 「지금 초점이
 * 시에 있는지 분에 있는지」에 따라 달라져서 **오전을 오후로 바꾸는 것이 실제로
 * 어렵습니다.** 그 오전/오후를 밖으로 꺼내려면 기본 칸을 쓸 수 없습니다 — 안쪽 표시를
 * 끄는 방법이 없어서, 꺼내는 순간 「오전 오전 10:00」이 됩니다.
 *
 * 그래서 **테두리 하나 안에 목록과 입력칸을 넣어** 한 칸처럼 보이게 만들었습니다.
 * 높이 44px · 글자 15px · 모서리 10px은 공용 입력칸과 같은 값입니다.
 *
 * **콜론을 안 쳐도 됩니다** — `1030`도 10:30으로 읽습니다(`parseTypedTime`).
 *
 * 값 형식은 저장 형식과 같은 24시간 `"HH:MM"`입니다. 12시간제로 오가는 계산은
 * `src/lib/time.ts` 한 곳에 모여 있습니다 — 흩어지면 「화면은 오후 2시, 저장된 값은
 * 오전 2시」가 되고, 에러 없이 「엉뚱한 시각」으로만 나타납니다.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  FALLBACK_TIME,
  formatHourMinute,
  formatTime,
  parseTime,
  parseTypedTime,
  type ParsedTime,
} from "@/lib/time";

interface Props {
  /** 칸 id 앞자리 — 라벨은 시:분 입력칸을 가리킵니다 */
  id: string;
  label: string;
  /** 24시간 `"HH:MM"`. 빈 문자열은 「미정」 */
  value: string;
  onChange: (next: string) => void;
  /**
   * 비워둘 수 있는 칸이면 true — 목록에 「미정」이 생기고, 시:분을 지워도 됩니다.
   * 종료 시간이 그렇습니다(서버가 null을 받습니다).
   */
  allowEmpty?: boolean;
  /** 「미정」에서 벗어날 때 채울 값(`"HH:MM"`). 시작 시간 + 2시간을 넘겨 씁니다 */
  emptyDefault?: string;
  required?: boolean;
}

export default function TimeField({
  id,
  label,
  value,
  onChange,
  allowEmpty = false,
  emptyDefault,
  required = false,
}: Props) {
  const parsed = parseTime(value);
  const empty = parsed == null;

  /**
   * 타이핑 중인 글자. **읽을 수 있는 값이 되는 즉시 바깥으로 올려보냅니다** —
   * 초점을 잃을 때만 올려보내면, 시간을 치고 바로 저장을 누른 사람의 입력이
   * 사라집니다(저장은 초점이 옮겨지기 전에 시작됩니다).
   */
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (parsed ? formatHourMinute(parsed) : "");

  // 비어 있는 칸에서 오전/오후만 골랐을 때 어떤 시각으로 갈지. 이 값이 없으면
  // 고른 값이 아무 데도 들어가지 않아 「눌렀는데 안 바뀐다」가 됩니다.
  const shown: ParsedTime =
    parsed ?? parseTime(emptyDefault ?? FALLBACK_TIME) ?? (parseTime(FALLBACK_TIME) as ParsedTime);

  function changeMeridiem(next: string) {
    if (next === "") {
      setDraft(null);
      onChange("");
      return;
    }
    onChange(formatTime(next === "pm", shown.hour12, shown.minute));
  }

  function typeTime(raw: string) {
    setDraft(raw);
    if (raw.trim() === "") {
      if (allowEmpty) onChange("");
      return;
    }
    const typed = parseTypedTime(raw);
    if (typed) onChange(formatTime(shown.pm, typed.hour12, typed.minute));
  }

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${id}-time`} className="text-[12.5px]">
        {label}
      </Label>
      {/* 테두리는 이 껍데기에만 있습니다 — 안쪽 목록·입력칸은 테두리가 없어
          두 칸이 아니라 한 칸으로 보입니다. */}
      <div className="flex h-11 w-[8.75rem] items-center rounded-lg border border-input bg-card transition-colors focus-within:ring-2 focus-within:ring-ring">
        <div className="relative shrink-0">
          <select
            id={`${id}-meridiem`}
            value={empty ? "" : shown.pm ? "pm" : "am"}
            onChange={(e) => changeMeridiem(e.target.value)}
            aria-label={`${label} 오전·오후`}
            className="h-11 cursor-pointer appearance-none bg-transparent pl-3 pr-5 text-[15px] outline-none"
          >
            {empty && <option value="">—</option>}
            <option value="am">오전</option>
            <option value="pm">오후</option>
            {!empty && allowEmpty && <option value="">미정</option>}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-0.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
        <input
          id={`${id}-time`}
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => typeTime(e.target.value)}
          // 초점을 잃으면 못 읽은 글자를 버리고 저장된 값으로 되돌립니다 —
          // 「9:5」처럼 반쯤 친 글자가 화면에 남아 있으면 그게 저장된 값으로 읽힙니다.
          onBlur={() => setDraft(null)}
          placeholder={allowEmpty ? "미정" : "10:00"}
          aria-label={`${label} 시·분`}
          required={required}
          className="h-11 w-full min-w-0 bg-transparent pr-3 text-[15px] tabular-nums outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}
