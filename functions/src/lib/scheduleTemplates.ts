/**
 * 매주 반복 회차 규칙(`scheduleTemplates`)과 회차 자동 생성 (스키마 2-4 · 5번).
 *
 * **「매주 화요일 10시」를 한 번 등록해 두면 회차가 저절로 채워집니다.** 그전에는
 * 같은 요일을 여러 줄 직접 추가하는 방법뿐이라, 매주 여는 프로그램은 1년에 50번
 * 넘게 손으로 넣어야 했습니다(그래서 등록 화면에서 「매주 반복」을 아예 빼뒀습니다).
 *
 * **채우는 범위는 오늘부터 90일입니다**(`CALENDAR_WINDOW_DAYS`). 검색 화면 캘린더가
 * 움직일 수 있는 범위와 같은 값이어야 합니다 — 캘린더가 더 먼 달을 보여주면 회차가
 * 없어서 0건이 나오는 게 정상인데 사용자는 고장으로 읽습니다(17-2).
 *
 * **규칙을 저장하는 즉시 한 번 채웁니다.** 매일 도는 배치만 두면 규칙을 등록한
 * 사람이 **다음 날까지 게시를 못 합니다**(회차 0건은 게시가 막힘). 배치는 날이
 * 갈수록 뒤로 밀려나는 90일 창을 이어서 채우는 역할만 합니다.
 *
 * **이미 만들어진 회차는 절대 덮어쓰지 않습니다.** 회차 문서에는 예약이 깎아 놓은
 * 남은 자리(`remainingSlots`)가 들어 있어서, 매일 덮어쓰면 **예약이 있는데 자리가
 * 원래대로 되살아납니다.** 그래서 회차 문서 이름을 「규칙 아이디 + 날짜」로 정해두고
 * (`{templateId}-{YYYY-MM-DD}`) 없는 것만 만듭니다 — 배치가 여러 번 돌아도 같은
 * 결과입니다.
 *
 * **한 번 만든 날짜는 다시 만들지 않습니다.** 「어디까지 채웠는지」를 규칙마다 적어두고
 * (`generatedUntil`) 그 뒤부터만 이어 붙입니다. 「없으면 만든다」로 두면 **전문가가 못
 * 가는 날을 지워도 다음 날 배치가 되살립니다** — 날짜를 닫는 방법이 「그 회차를 지우기」
 * 하나뿐이라(공휴일을 걸러내지 않음) 그러면 닫을 길이 아예 없어집니다. 규칙을 고치면
 * 이 표시를 지워 창 전체를 다시 채웁니다(규칙이 바뀌었으므로 옛 판단을 이어받지 않습니다).
 *
 * **공휴일·주말을 걸러내지 않습니다**(2-4 팀 확정). 숲 프로그램은 쉬는 날이
 * 성수기입니다. 못 가는 날은 **그 회차를 지우는** 방식으로 닫습니다 — 못 가는 날을
 * 아는 주체는 전문가 본인입니다.
 *
 * **회차 50개 상한은 이 경로에 적용하지 않습니다.** 그 상한은 오타 한 번으로 회차가
 * 무한정 생기는 것을 막으려고 **직접 등록**에 둔 값입니다. 여기서는 90일이라는 창이
 * 이미 개수를 묶고 있어(요일 규칙 7개를 다 써도 91개) 상한이 할 일이 없고, 오히려
 * 매일 여는 프로그램이 두 달 만에 막혀버립니다.
 */

import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";
import {
  CALENDAR_WINDOW_DAYS,
  kstDateString,
  kstToInstant,
  loadOwnedProgram,
  syncProgramScheduleDates,
  type ScheduleSummary,
} from "./schedules";

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * 프로그램 하나에 둘 수 있는 요일 규칙 수. **7 = 매일**이라 이보다 클 이유가 없습니다.
 * 같은 요일에 오전·오후 두 번 여는 경우는 규칙 두 개로 적습니다.
 */
export const MAX_TEMPLATES_PER_PROGRAM = 7;

const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

/** 공급자가 입력하는 반복 규칙 한 줄. 시각·날짜는 전부 KST 기준 문자열입니다. */
export interface ScheduleTemplateInput {
  /** 0(일)~6(토) */
  weekday: number;
  /** `"10:00"` — 시작 시각(KST) */
  timeOfDay: string;
  /**
   * `"12:00"` — 종료 시각(KST). 없으면 회차에 종료 시각을 적지 않습니다.
   *
   * 스키마 2-4의 표에는 시작 시각만 있었는데, 직접 등록하는 회차는 종료 시각을
   * 받고 있어 **같은 화면에서 「매주 반복」만 종료 시각이 사라지는** 모양이 됩니다.
   * 저장 구조는 그대로(회차의 `endAt`)이고 규칙에 칸이 하나 는 것뿐입니다.
   */
  endTimeOfDay: string | null;
  /** 이 규칙이 만드는 회차 한 번의 정원 */
  capacityPerOccurrence: number;
  /** `"2026-09-15"` — 이 날짜부터 회차를 만듭니다 */
  activeFrom: string;
  /** `"2026-12-31"` — 이 날짜까지. 없으면 계속 이어집니다 */
  activeUntil: string | null;
}

export interface ScheduleTemplateRow extends ScheduleTemplateInput {
  id: string;
  weekdayLabel: string;
}

function num(value: unknown, field: string, opts: { min: number; max?: number }): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < opts.min || (opts.max != null && n > opts.max)) {
    throw new AppError("invalid-argument", `${field}을(를) 다시 확인해 주세요`);
  }
  return n;
}

function time(value: unknown, field: string): string {
  if (typeof value !== "string" || !TIME_RE.test(value)) {
    throw new AppError("invalid-argument", `${field} 형식이 올바르지 않습니다`);
  }
  const [hh, mm] = value.split(":").map(Number);
  if (hh > 23 || mm > 59) {
    throw new AppError("invalid-argument", `${field} 형식이 올바르지 않습니다`);
  }
  return value;
}

function dateString(value: unknown, field: string): string {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw new AppError("invalid-argument", `${field} 형식이 올바르지 않습니다`);
  }
  // 달력에 없는 날짜(2026-02-30)를 여기서 거릅니다 — 그냥 두면 다음 달로 넘어가
  // 조용히 저장됩니다(회차 직접 등록과 같은 함정).
  kstToInstant(value, "00:00");
  return value;
}

export interface ParseTemplateOptions {
  /** 상위 프로그램의 최대 인원. 회차 정원이 이 값을 넘을 수 없습니다 */
  programCapacity: number;
  /** 테스트에서 고정하기 위한 현재 시각 */
  now?: Date;
}

/** 요청 본문 → 검증된 반복 규칙. 저장되면 조용히 틀리는 입력을 여기서 거부합니다. */
export function parseScheduleTemplateInput(
  body: unknown,
  options: ParseTemplateOptions
): ScheduleTemplateInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const now = options.now ?? new Date();

  const weekday = num(b.weekday, "요일", { min: 0, max: 6 });
  const timeOfDay = time(b.timeOfDay, "시작 시각");
  const endTimeOfDay =
    b.endTimeOfDay == null || b.endTimeOfDay === "" ? null : time(b.endTimeOfDay, "종료 시각");

  if (endTimeOfDay != null && endTimeOfDay <= timeOfDay) {
    throw new AppError("invalid-argument", "종료 시각이 시작 시각보다 앞섭니다");
  }

  const capacityPerOccurrence = num(b.capacityPerOccurrence, "회차당 정원", { min: 1 });
  if (capacityPerOccurrence > options.programCapacity) {
    throw new AppError(
      "invalid-argument",
      `회차당 정원은 프로그램 최대 인원(${options.programCapacity}명)을 넘을 수 없습니다`
    );
  }

  // 시작일을 비우면 오늘부터입니다 — 「언제부터」를 매번 묻지 않기 위해서입니다.
  const activeFrom =
    b.activeFrom == null || b.activeFrom === ""
      ? kstDateString(now)
      : dateString(b.activeFrom, "시작일");
  const activeUntil =
    b.activeUntil == null || b.activeUntil === "" ? null : dateString(b.activeUntil, "종료일");

  if (activeUntil != null && activeUntil < activeFrom) {
    throw new AppError("invalid-argument", "종료일이 시작일보다 앞섭니다");
  }

  return { weekday, timeOfDay, endTimeOfDay, capacityPerOccurrence, activeFrom, activeUntil };
}

/** KST 기준 요일(0=일). 회차 생성이 이 값으로 날짜를 고릅니다. */
export function kstWeekday(day: string): number {
  const instant = kstToInstant(day, "00:00");
  return new Date(instant.getTime() + KST_OFFSET_MS).getUTCDay();
}

/**
 * 규칙 하나가 앞으로 90일 안에 만들 날짜 목록(KST `YYYY-MM-DD`).
 *
 * 저장과 분리한 순수 함수입니다 — 날짜 계산은 조용히 틀리는 자리라(요일·시간대)
 * 테스트가 직접 부를 수 있어야 합니다.
 */
export function occurrenceDates(
  template: Pick<ScheduleTemplateInput, "weekday" | "activeFrom" | "activeUntil">,
  now: Date = new Date(),
  windowDays: number = CALENDAR_WINDOW_DAYS,
  /** 이 날짜보다 앞은 만들지 않습니다 — 이미 채운 구간을 다시 만들지 않기 위한 값 */
  notBefore?: string
): string[] {
  const today = kstDateString(now);
  // 시작일이 아직 안 왔으면 그날부터, 이미 지났으면 오늘부터 — 지난 날짜에 회차를
  // 만들면 목록에만 쌓이고 아무도 예약할 수 없습니다.
  let from = template.activeFrom > today ? template.activeFrom : today;
  if (notBefore != null && notBefore > from) from = notBefore;
  const windowEnd = kstDateString(new Date(now.getTime() + windowDays * DAY_MS));
  const end =
    template.activeUntil != null && template.activeUntil < windowEnd
      ? template.activeUntil
      : windowEnd;

  if (from > end) return [];

  const dates: string[] = [];
  let cursor = kstToInstant(from, "00:00");
  const endInstant = kstToInstant(end, "00:00");

  while (cursor.getTime() <= endInstant.getTime()) {
    const day = kstDateString(cursor);
    if (kstWeekday(day) === template.weekday) dates.push(day);
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return dates;
}

/** `"2026-09-05"` → `"2026-09-06"`. 이미 채운 날짜의 다음 날부터 이어 붙일 때 씁니다. */
function nextDay(day: string): string {
  return kstDateString(new Date(kstToInstant(day, "00:00").getTime() + DAY_MS));
}

/** 회차 문서 이름 — 같은 규칙·같은 날짜면 항상 같습니다(배치를 여러 번 돌려도 안전). */
export function occurrenceDocId(templateId: string, day: string): string {
  return `${templateId}-${day}`;
}

async function loadTemplates(
  db: Firestore,
  programId: string
): Promise<{ id: string; generatedUntil: string | null; data: ScheduleTemplateInput }[]> {
  const snap = await db.collection(`programs/${programId}/scheduleTemplates`).get();
  return snap.docs.map((d) => ({
    id: d.id,
    // 어디까지 채웠는지. 값이 없는 규칙은 아직 한 번도 안 채운 것입니다.
    generatedUntil: (d.get("generatedUntil") as string | null) ?? null,
    data: {
      weekday: d.get("weekday") as number,
      timeOfDay: d.get("timeOfDay") as string,
      endTimeOfDay: (d.get("endTimeOfDay") as string | null) ?? null,
      capacityPerOccurrence: d.get("capacityPerOccurrence") as number,
      activeFrom: d.get("activeFrom") as string,
      activeUntil: (d.get("activeUntil") as string | null) ?? null,
    },
  }));
}

/** 이 회차에 예약이 있는가. (예약 기능이 붙기 전이라 지금은 항상 0건입니다) */
async function hasBooking(db: Firestore, scheduleId: string): Promise<boolean> {
  const snap = await db
    .collection("bookings")
    .where("scheduleId", "==", scheduleId)
    .limit(1)
    .get();
  return !snap.empty;
}

/**
 * 한 프로그램의 회차를 90일 창만큼 채웁니다. **없는 것만 만들고 있는 것은 그대로
 * 둡니다** — 있는 문서를 덮으면 예약이 깎아 둔 남은 자리가 되살아납니다.
 */
export async function generateOccurrencesForProgram(
  db: Firestore,
  programId: string,
  now: Date = new Date()
): Promise<{ created: number; summary: ScheduleSummary | null }> {
  const programSnap = await db.doc(`programs/${programId}`).get();
  if (!programSnap.exists) return { created: 0, summary: null };

  // 일정 유형을 바꿨는데 옛 규칙이 남아 있는 경우 — 회차를 더 만들지 않습니다.
  if (programSnap.get("scheduleType") !== "weekly") return { created: 0, summary: null };

  const templates = await loadTemplates(db, programId);
  if (templates.length === 0) return { created: 0, summary: null };

  const col = db.collection(`programs/${programId}/schedules`);
  const existing = new Set((await col.get()).docs.map((d) => d.id));
  const programStatus = programSnap.get("status") as string;

  const batch = db.batch();
  let touched = false;
  const windowEnd = kstDateString(new Date(now.getTime() + CALENDAR_WINDOW_DAYS * DAY_MS));
  let created = 0;

  for (const { id: templateId, generatedUntil, data } of templates) {
    // 이미 채운 구간은 건너뜁니다 — 그 안에서 전문가가 지운 날짜를 되살리지
    // 않기 위해서입니다.
    const notBefore = generatedUntil == null ? undefined : nextDay(generatedUntil);

    for (const day of occurrenceDates(data, now, CALENDAR_WINDOW_DAYS, notBefore)) {
      const docId = occurrenceDocId(templateId, day);
      if (existing.has(docId)) continue;

      const startAt = kstToInstant(day, data.timeOfDay);
      // 오늘인데 시각이 이미 지났으면 만들지 않습니다 — 만들어도 예약할 수 없는
      // 회차가 목록 맨 위에 남습니다.
      if (startAt.getTime() <= now.getTime()) continue;

      const endAt = data.endTimeOfDay == null ? null : kstToInstant(day, data.endTimeOfDay);

      batch.set(col.doc(docId), {
        programId,
        programStatus,
        type: "weekly",
        recurringTemplateId: templateId,
        startAt: Timestamp.fromDate(startAt),
        endAt: endAt == null ? null : Timestamp.fromDate(endAt),
        seriesIndex: null,
        seriesTotal: null,
        totalSlots: data.capacityPerOccurrence,
        remainingSlots: data.capacityPerOccurrence,
        forceOpen: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      created += 1;
    }

    // 「여기까지 채웠다」를 적어둡니다. 만든 회차가 0건이어도 적습니다 — 그 요일이
    // 창 안에 없었을 뿐이고, 다음 배치가 같은 구간을 다시 훑을 이유가 없습니다.
    if (generatedUntil == null || generatedUntil < windowEnd) {
      batch.update(db.doc(`programs/${programId}/scheduleTemplates/${templateId}`), {
        generatedUntil: windowEnd,
        updatedAt: FieldValue.serverTimestamp(),
      });
      touched = true;
    }
  }

  if (created === 0 && !touched) return { created: 0, summary: null };

  await batch.commit();
  if (created === 0) return { created: 0, summary: null };
  const summary = await syncProgramScheduleDates(db, programId, now);
  return { created, summary };
}

/**
 * 매일 도는 배치 — 반복 규칙이 있는 프로그램 전부의 회차를 채웁니다.
 *
 * 하루가 지나면 90일 창의 끝이 하루 밀리므로, 그 하루치를 이어 붙이는 일을 합니다.
 * **규칙을 저장할 때 이미 한 번 채우므로**(위) 이 배치가 늦어도 당장 곤란한 일은
 * 생기지 않습니다 — 목록 맨 뒤 날짜가 하루 늦게 나타날 뿐입니다.
 */
export async function generateWeeklySchedules(
  db: Firestore,
  now: Date = new Date()
): Promise<{ programs: number; created: number }> {
  // 「매주 반복」 프로그램만 추립니다 — 전체를 훑으면 반복을 안 쓰는 프로그램까지
  // 매일 읽게 됩니다.
  //
  // **컬렉션그룹으로 규칙 문서를 직접 찾지 않는 이유:** 하위 컬렉션을 가로질러
  // 찾으려면 실서버에 색인을 따로 만들어 둬야 하고, 빠뜨리면 **에뮬레이터에서는
  // 돌고 실서버에서만 실패**합니다. 여기서는 프로그램 한 가지 조건으로 충분하고,
  // 그 조건은 색인이 자동으로 붙는 자리입니다.
  const snap = await db.collection("programs").where("scheduleType", "==", "weekly").get();

  let created = 0;
  for (const doc of snap.docs) {
    const result = await generateOccurrencesForProgram(db, doc.id, now);
    created += result.created;
  }
  return { programs: snap.size, created };
}

/** 소유자 확인 + 「매주 반복」 프로그램인지 확인. */
async function loadWeeklyProgram(
  db: Firestore,
  programId: string,
  uid: string
): Promise<{ status: string; capacity: number }> {
  const program = await loadOwnedProgram(db, programId, uid);
  if (program.scheduleType !== "weekly") {
    throw new AppError(
      "failed-precondition",
      "「매주 반복」으로 설정한 프로그램에서만 반복 규칙을 쓸 수 있습니다"
    );
  }
  return { status: program.status, capacity: program.capacity };
}

/** 반복 규칙 목록 — 소유자만. */
export async function listScheduleTemplates(
  db: Firestore,
  programId: string,
  uid: string
): Promise<ScheduleTemplateRow[]> {
  await loadWeeklyProgram(db, programId, uid);
  const templates = await loadTemplates(db, programId);
  return templates
    .map(({ id, data }) => ({ id, weekdayLabel: WEEKDAY_NAMES[data.weekday], ...data }))
    .sort((a, b) => a.weekday - b.weekday || a.timeOfDay.localeCompare(b.timeOfDay));
}

/** 반복 규칙 등록 — 저장하고 그 자리에서 90일치 회차를 채웁니다. */
export async function createScheduleTemplate(
  db: Firestore,
  programId: string,
  uid: string,
  body: unknown,
  now: Date = new Date()
): Promise<{ id: string; created: number }> {
  const program = await loadWeeklyProgram(db, programId, uid);
  const input = parseScheduleTemplateInput(body, { programCapacity: program.capacity, now });

  const existing = await loadTemplates(db, programId);
  if (existing.length >= MAX_TEMPLATES_PER_PROGRAM) {
    throw new AppError(
      "failed-precondition",
      `반복 규칙은 프로그램당 ${MAX_TEMPLATES_PER_PROGRAM}개까지 등록할 수 있습니다`
    );
  }
  // 같은 요일·같은 시각을 두 번 넣으면 같은 자리에 회차가 두 개 생깁니다.
  if (
    existing.some((t) => t.data.weekday === input.weekday && t.data.timeOfDay === input.timeOfDay)
  ) {
    throw new AppError(
      "invalid-argument",
      `이미 등록된 반복 규칙입니다: 매주 ${WEEKDAY_NAMES[input.weekday]}요일 ${input.timeOfDay}`
    );
  }

  const ref = db.collection(`programs/${programId}/scheduleTemplates`).doc();
  await ref.set({
    // 상위 아이디를 문서에도 적어둡니다 — 컬렉션그룹 결과에서는 경로를 되짚어야
    // 부모를 알 수 있어서, 감사·백필 스크립트가 매번 그 일을 하게 됩니다(2-4).
    programId,
    ...input,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const { created } = await generateOccurrencesForProgram(db, programId, now);
  return { id: ref.id, created };
}

/**
 * 반복 규칙 수정.
 *
 * **이미 예약이 있는 회차는 건드리지 않습니다**(2-4 캐스케이딩 정책). 시각을 바꾸면
 * 예약한 사람이 다른 시각에 오게 되고, 정원을 줄이면 이미 받은 예약이 정원을
 * 넘깁니다. 예약이 0건인 **앞으로의 회차에만** 반영합니다.
 */
export async function updateScheduleTemplate(
  db: Firestore,
  programId: string,
  templateId: string,
  uid: string,
  body: unknown,
  now: Date = new Date()
): Promise<{ updated: number; skipped: number; created: number }> {
  const program = await loadWeeklyProgram(db, programId, uid);
  const ref = db.doc(`programs/${programId}/scheduleTemplates/${templateId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError("not-found", "반복 규칙을 찾을 수 없습니다");

  const before = (await loadTemplates(db, programId)).find((t) => t.id === templateId)!.data;
  const input = parseScheduleTemplateInput(body, { programCapacity: program.capacity, now });

  // 규칙이 바뀌었으므로 「어디까지 채웠는지」를 지웁니다 — 안 지우면 요일을 바꿔도
  // 새 요일 날짜가 창 끝에서부터만 생깁니다.
  await ref.update({ ...input, generatedUntil: null, updatedAt: FieldValue.serverTimestamp() });

  // 요일이나 기간이 바뀌면 옛 요일로 만들어 둔 회차는 규칙과 어긋납니다 —
  // 예약이 없는 것만 치웁니다(예약이 있으면 약속이므로 그대로 둡니다).
  const stale =
    input.weekday !== before.weekday ||
    input.activeFrom !== before.activeFrom ||
    input.activeUntil !== before.activeUntil;

  const keep = new Set(occurrenceDates(input, now).map((d) => occurrenceDocId(templateId, d)));

  const owned = await db
    .collection(`programs/${programId}/schedules`)
    .where("recurringTemplateId", "==", templateId)
    .get();

  let updated = 0;
  let skipped = 0;

  for (const doc of owned.docs) {
    const startAt = (doc.get("startAt") as Timestamp).toDate();
    if (startAt.getTime() <= now.getTime()) continue; // 지난 회차는 기록입니다

    if (await hasBooking(db, doc.id)) {
      skipped += 1;
      continue;
    }

    if (stale && !keep.has(doc.id)) {
      await doc.ref.delete();
      updated += 1;
      continue;
    }

    const day = kstDateString(startAt);
    const newStart = kstToInstant(day, input.timeOfDay);
    const newEnd = input.endTimeOfDay == null ? null : kstToInstant(day, input.endTimeOfDay);

    await doc.ref.update({
      startAt: Timestamp.fromDate(newStart),
      endAt: newEnd == null ? null : Timestamp.fromDate(newEnd),
      // 예약이 없는 회차이므로 남은 자리는 정원과 같습니다.
      totalSlots: input.capacityPerOccurrence,
      remainingSlots: input.capacityPerOccurrence,
      updatedAt: FieldValue.serverTimestamp(),
    });
    updated += 1;
  }

  const { created } = await generateOccurrencesForProgram(db, programId, now);
  await syncProgramScheduleDates(db, programId, now);
  return { updated, skipped, created };
}

/**
 * 반복 규칙 삭제 — 앞으로의 회차 중 **예약이 없는 것**을 함께 치웁니다.
 *
 * 예약이 있는 회차는 남깁니다. 규칙이 없어졌다고 약속이 없어지는 것은 아니고,
 * 지우면 그 예약이 가리킬 문서가 사라져 환불·안내의 근거를 잃습니다(2-4).
 */
export async function deleteScheduleTemplate(
  db: Firestore,
  programId: string,
  templateId: string,
  uid: string,
  now: Date = new Date()
): Promise<{ removed: number; kept: number }> {
  await loadWeeklyProgram(db, programId, uid);
  const ref = db.doc(`programs/${programId}/scheduleTemplates/${templateId}`);
  if (!(await ref.get()).exists) {
    throw new AppError("not-found", "반복 규칙을 찾을 수 없습니다");
  }

  const owned = await db
    .collection(`programs/${programId}/schedules`)
    .where("recurringTemplateId", "==", templateId)
    .get();

  let removed = 0;
  let kept = 0;
  for (const doc of owned.docs) {
    const startAt = (doc.get("startAt") as Timestamp).toDate();
    if (startAt.getTime() <= now.getTime()) continue;
    if (await hasBooking(db, doc.id)) {
      kept += 1;
      continue;
    }
    await doc.ref.delete();
    removed += 1;
  }

  await ref.delete();
  await syncProgramScheduleDates(db, programId, now);
  return { removed, kept };
}
