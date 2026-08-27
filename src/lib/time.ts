/**
 * 시간 문자열 다루기 — 회차 입력칸(`TimeField`)이 씁니다 (2026-08-27).
 *
 * 값 형식은 저장 형식과 같은 24시간 `"HH:MM"`입니다. 화면에서만 12시간제(오전/오후)로
 * 보여주고, 서버로 나가는 값은 손대지 않습니다 — 두 형식을 오가는 지점을 이 파일
 * 하나로 몰아둡니다. 흩어지면 「화면에는 오후 2시인데 저장된 값은 오전 2시」가
 * 되는데, 에러가 나지 않고 「엉뚱한 시각」으로만 나타납니다(회차 KST 환산과 같은 함정).
 */

/** 「미정」에서 벗어날 때 쓸 최후 기본값 */
export const FALLBACK_TIME = "09:00";

export interface ParsedTime {
  /** 오후면 true */
  pm: boolean;
  /** 1~12 (12시간제) */
  hour12: number;
  /** 0~59 */
  minute: number;
}

/** `"HH:MM"` → 12시간제 조각. 빈 값이거나 형식이 아니면 null */
export function parseTime(value: string): ParsedTime | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (m == null) return null;
  const hour24 = Number(m[1]);
  const minute = Number(m[2]);
  if (hour24 > 23 || minute > 59) return null;
  return {
    pm: hour24 >= 12,
    // 24시간제의 0시와 12시가 둘 다 12시로 보이는 자리입니다 — 0시는 오전 12시,
    // 12시는 오후 12시(정오)입니다.
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute,
  };
}

/** 12시간제 조각 → `"HH:MM"` */
export function formatTime(pm: boolean, hour12: number, minute: number): string {
  const base = hour12 === 12 ? 0 : hour12;
  const hour24 = pm ? base + 12 : base;
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * `"HH:MM"`에 시간을 더합니다 — 종료 시간의 기본값(시작 + 2시간)에 씁니다.
 * **자정을 넘기지 않고 23:59에서 멈춥니다.** 다음 날로 넘기면 같은 회차가
 * 하루 밀리는데, 화면에는 시각만 보여서 알아차릴 방법이 없습니다.
 */
export function addHours(value: string, hours: number): string {
  const parsed = parseTime(value);
  if (parsed == null) return FALLBACK_TIME;
  const base = parsed.hour12 === 12 ? 0 : parsed.hour12;
  const hour24 = (parsed.pm ? base + 12 : base) + hours;
  if (hour24 > 23) return "23:59";
  if (hour24 < 0) return "00:00";
  return `${String(hour24).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;
}

/** 화면에 보여줄 「시:분」 — 오전/오후는 옆 목록이 맡습니다 */
export function formatHourMinute(parsed: ParsedTime): string {
  return `${parsed.hour12}:${String(parsed.minute).padStart(2, "0")}`;
}

/**
 * 직접 입력한 「시:분」을 읽습니다 (12시간제). 못 읽으면 null.
 *
 * **콜론 없이 치는 사람이 많습니다** — `1030`·`930`도 받습니다. 자리 수로 가릅니다:
 * 두 자리까지는 시(`10` → 10:00), 그보다 길면 뒤 두 자리가 분입니다(`1030` → 10:30).
 *
 * 12시간제라 **0시는 없습니다** — `0:30`이라고 치면 12:30으로 봅니다. 거부하면
 * 「분명히 쳤는데 안 들어가는」 칸이 되고, 무엇이 잘못됐는지 화면에 나타나지 않습니다.
 */
export function parseTypedTime(raw: string): { hour12: number; minute: number } | null {
  const cleaned = raw.replace(/[^\d:]/g, "");
  if (cleaned === "") return null;

  let hour: number;
  let minute: number;
  if (cleaned.includes(":")) {
    const [h, m = ""] = cleaned.split(":");
    if (h === "") return null;
    hour = Number(h);
    minute = m === "" ? 0 : Number(m);
  } else if (cleaned.length <= 2) {
    hour = Number(cleaned);
    minute = 0;
  } else {
    hour = Number(cleaned.slice(0, cleaned.length - 2));
    minute = Number(cleaned.slice(-2));
  }

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour === 0) hour = 12;
  if (hour > 12 || minute > 59) return null;
  return { hour12: hour, minute };
}
