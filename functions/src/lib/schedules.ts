/**
 * 회차(`schedules`) 생성·삭제와 프로그램 날짜 요약 갱신 (스키마 2-4 · 17-2 · 5번).
 *
 * 회차는 **실제로 예약 가능한 단위**입니다. `bookings.scheduleId`가 이 문서를
 * 가리키므로, 회차가 없으면 예약을 만들 수 없습니다.
 *
 * 클라이언트는 `schedules`를 직접 쓰지 못합니다(6-1 `allow write: if false` —
 * 정원 조작 방지). 따라서 이 파일의 함수들이 유일한 생성·삭제 통로입니다.
 *
 * **시각은 전부 한국시간(KST) 입력을 UTC로 환산해 저장합니다.** Cloud Functions는
 * UTC로 돌기 때문에 `new Date("2026-09-05")`처럼 쓰면 KST 자정이 아니라 UTC 자정이
 * 되어 **하루가 밀립니다.** 날씨(`kmaWeather.ts`)에서 이미 같은 함정을 겪은
 * 지점이라 환산을 한 곳에 모으고 테스트로 못박습니다(16-4 ②).
 */

import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 프로그램 하나에 등록할 수 있는 회차 수 상한. 응답 크기와 배치 쓰기 한도를 감안한 값입니다. */
export const MAX_SCHEDULES_PER_PROGRAM = 50;

/**
 * 등록 가능한 가장 먼 날짜(오늘 +365일).
 * 상한이 없으면 오타 한 번으로 2226년 회차가 생기고, 그 프로그램은
 * `lastScheduleAt`이 200년 뒤가 되어 정렬·집계가 전부 이상해집니다.
 */
export const MAX_DAYS_AHEAD = 365;

/**
 * `scheduleDates`에 담는 범위(오늘 ~ +90일).
 * 검색 화면 캘린더의 이동 범위와 같은 값이어야 합니다 — 캘린더가 이 범위보다 먼
 * 달을 보여주면 결과 0건이 정상인데 사용자는 고장으로 읽습니다(17-2).
 * **더 먼 회차도 저장은 되고**, 90일 안으로 들어오면 배치가 요약에 넣습니다.
 */
export const CALENDAR_WINDOW_DAYS = 90;

/** 회차를 직접 등록하는 일정 유형. `weekly`는 템플릿, `open`은 회차 자체가 없습니다. */
const DIRECT_SCHEDULE_TYPES = new Set(["single", "series"]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** 공급자가 입력하는 회차 한 줄. 시각은 KST 기준 문자열입니다. */
export interface ScheduleInput {
  /** `"2026-09-05"` (KST) */
  date: string;
  /** `"10:00"` (KST) */
  startTime: string;
  /** `"12:00"` (KST). 없으면 종료 시각을 표시하지 않습니다 */
  endTime: string | null;
  /** 이 회차 전용 정원. 다른 회차와 공유하지 않습니다(2-4) */
  capacity: number;
}

/** KST 기준 `YYYY-MM-DD`. UTC 게터를 쓰는 것은 이미 9시간을 더했기 때문입니다. */
export function kstDateString(instant: Date): string {
  const shifted = new Date(instant.getTime() + KST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * KST 날짜·시각 문자열 → 절대시각(UTC).
 *
 * 달력에 없는 날짜(`2026-02-30`)는 여기서 걸러야 합니다 — `Date.UTC`는 다음 달로
 * 넘겨버리고 예외를 던지지 않아서, 그냥 쓰면 "3월 2일 회차"가 조용히 생깁니다.
 */
export function kstToInstant(date: string, time: string): Date {
  if (!DATE_RE.test(date)) {
    throw new AppError("invalid-argument", `날짜 형식이 올바르지 않습니다: ${date}`);
  }
  if (!TIME_RE.test(time)) {
    throw new AppError("invalid-argument", `시간 형식이 올바르지 않습니다: ${time}`);
  }

  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);

  if (hh > 23 || mm > 59) {
    throw new AppError("invalid-argument", `시간 형식이 올바르지 않습니다: ${time}`);
  }

  const utcMidnightOfKstDay = Date.UTC(y, m - 1, d, hh, mm);
  const instant = new Date(utcMidnightOfKstDay - KST_OFFSET_MS);

  // 달력에 없는 날짜 검출 — 되돌려 만든 문자열이 입력과 같아야 합니다.
  if (kstDateString(instant) !== date) {
    throw new AppError("invalid-argument", `달력에 없는 날짜입니다: ${date}`);
  }

  return instant;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError("invalid-argument", `${field}을(를) 입력해 주세요`);
  }
  return value.trim();
}

export interface ParseScheduleOptions {
  /** 상위 프로그램의 `scheduleType` */
  scheduleType: string;
  /** 상위 프로그램의 최대 인원. 회차 정원이 이 값을 넘을 수 없습니다 */
  programCapacity: number;
  /** 테스트에서 고정하기 위한 현재 시각 */
  now?: Date;
  /** 이미 등록돼 있는 회차 수(추가 등록 시 상한 계산용) */
  existingCount?: number;
}

/**
 * 요청 본문의 `schedules` 배열 → 검증된 입력 목록.
 *
 * 여기서 거부하는 것들은 전부 **저장되면 화면상 정상인데 예약이 안 되는** 종류입니다.
 * 지난 날짜는 목록에 뜨지만 아무도 예약할 수 없고, 정원이 프로그램 최대 인원을
 * 넘으면 최대 인원 검증이 무의미해집니다.
 */
export function parseScheduleInputs(
  value: unknown,
  options: ParseScheduleOptions
): ScheduleInput[] {
  const { scheduleType, programCapacity } = options;
  const now = options.now ?? new Date();
  const existingCount = options.existingCount ?? 0;

  const raw = value == null ? [] : value;
  if (!Array.isArray(raw)) {
    throw new AppError("invalid-argument", "회차 목록 형식이 올바르지 않습니다");
  }

  // 유형별로 받을 수 있는 개수가 다릅니다.
  if (!DIRECT_SCHEDULE_TYPES.has(scheduleType)) {
    if (raw.length > 0) {
      throw new AppError(
        "invalid-argument",
        scheduleType === "open"
          ? "상시모집은 날짜를 미리 등록하지 않습니다. 예약자와 협의해 정합니다"
          : "매주 반복은 아직 준비 중입니다. 「회차제」로 날짜를 직접 등록해 주세요"
      );
    }
    return [];
  }

  if (scheduleType === "single" && existingCount + raw.length > 1) {
    throw new AppError(
      "invalid-argument",
      "1회성 프로그램의 날짜는 하나입니다. 여러 날짜를 열려면 「회차제」를 선택해 주세요"
    );
  }

  if (existingCount + raw.length > MAX_SCHEDULES_PER_PROGRAM) {
    throw new AppError(
      "invalid-argument",
      `회차는 최대 ${MAX_SCHEDULES_PER_PROGRAM}개까지 등록할 수 있습니다`
    );
  }

  const latestAllowed = new Date(now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const seen = new Set<string>();

  const parsed = raw.map((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const label = `${index + 1}번째 회차`;

    const date = requireString(row.date, `${label}의 날짜`);
    const startTime = requireString(row.startTime, `${label}의 시작 시간`);
    const endTimeRaw = row.endTime;
    const endTime =
      endTimeRaw == null || String(endTimeRaw).trim() === ""
        ? null
        : String(endTimeRaw).trim();

    const startAt = kstToInstant(date, startTime);
    const endAt = endTime == null ? null : kstToInstant(date, endTime);

    if (startAt.getTime() <= now.getTime()) {
      throw new AppError(
        "invalid-argument",
        `${label}: 이미 지난 시각입니다(${date} ${startTime}). 앞으로의 날짜를 넣어 주세요`
      );
    }
    if (startAt.getTime() > latestAllowed.getTime()) {
      throw new AppError(
        "invalid-argument",
        `${label}: 너무 먼 날짜입니다. ${MAX_DAYS_AHEAD}일 안쪽으로 등록해 주세요`
      );
    }
    // 자정을 넘기는 일정은 지금 받지 않습니다 — 종료일을 따로 받지 않는 화면
    // 구조에서는 "22:00~02:00"을 저장하면 종료가 시작보다 앞선 값이 됩니다.
    if (endAt != null && endAt.getTime() <= startAt.getTime()) {
      throw new AppError(
        "invalid-argument",
        `${label}: 종료 시간이 시작 시간보다 앞이거나 같습니다`
      );
    }

    const capacityRaw = row.capacity;
    const capacity =
      typeof capacityRaw === "string" ? Number(capacityRaw) : (capacityRaw as number);
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new AppError("invalid-argument", `${label}: 정원은 1명 이상의 정수여야 합니다`);
    }
    if (capacity > programCapacity) {
      throw new AppError(
        "invalid-argument",
        `${label}: 정원(${capacity}명)이 프로그램 최대 인원(${programCapacity}명)을 넘습니다`
      );
    }

    const key = `${date} ${startTime}`;
    if (seen.has(key)) {
      throw new AppError("invalid-argument", `날짜와 시작 시간이 겹칩니다: ${key}`);
    }
    seen.add(key);

    return { date, startTime, endTime, capacity };
  });

  return parsed.sort((a, b) =>
    `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)
  );
}

export interface ScheduleDocData {
  programId: string;
  programStatus: string;
  type: string;
  recurringTemplateId: null;
  startAt: Timestamp;
  endAt: Timestamp | null;
  seriesIndex: number | null;
  seriesTotal: number | null;
  totalSlots: number;
  remainingSlots: number;
  forceOpen: boolean;
}

export interface BuildScheduleDocsOptions {
  programId: string;
  /** 상위 `programs.status` 사본. collectionGroup 규칙이 이 필드로 공개 여부를 봅니다(2-4) */
  programStatus: string;
  type: string;
  /** `series` 회차 번호를 이어 붙일 때의 시작 번호(추가 등록용) */
  startIndex?: number;
  /** `series` 전체 회차 수 */
  seriesTotal?: number;
}

/** 검증된 입력 → Firestore 문서 본문. 저장과 계산을 분리해 테스트가 쉬워집니다. */
export function buildScheduleDocs(
  inputs: ScheduleInput[],
  options: BuildScheduleDocsOptions
): ScheduleDocData[] {
  const isSeries = options.type === "series";
  const startIndex = options.startIndex ?? 1;

  return inputs.map((input, i) => {
    const startAt = kstToInstant(input.date, input.startTime);
    const endAt = input.endTime == null ? null : kstToInstant(input.date, input.endTime);

    return {
      programId: options.programId,
      programStatus: options.programStatus,
      type: options.type,
      recurringTemplateId: null,
      startAt: Timestamp.fromDate(startAt),
      endAt: endAt == null ? null : Timestamp.fromDate(endAt),
      seriesIndex: isSeries ? startIndex + i : null,
      seriesTotal: isSeries ? (options.seriesTotal ?? inputs.length) : null,
      // 정원은 두 벌로 둡니다. `remainingSlots`는 예약이 차감하는 값이라
      // 원래 정원을 알 수 없게 되고, 그러면 "남은 자리 3/12"를 표시할 수 없습니다.
      totalSlots: input.capacity,
      remainingSlots: input.capacity,
      forceOpen: false,
    };
  });
}

export interface ScheduleSummary {
  /** 오늘~+90일 사이의 예약 가능 날짜(`"2026-09-05"`), 중복 없이 오름차순 */
  scheduleDates: string[];
  nextScheduleAt: Timestamp | null;
  lastScheduleAt: Timestamp | null;
}

/** 회차 문서 목록 → 프로그램에 저장할 날짜 요약. */
export function summarizeSchedules(
  startAts: Date[],
  now: Date = new Date()
): ScheduleSummary {
  const future = startAts
    .filter((d) => d.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());

  if (future.length === 0) {
    // **명시적 null이어야 합니다.** 필드를 아예 만들지 않으면 그 필드를 쓰는
    // 인덱스에서 문서가 빠져 검색에서 통째로 사라집니다(2-3 v13).
    return { scheduleDates: [], nextScheduleAt: null, lastScheduleAt: null };
  }

  const windowEnd = now.getTime() + CALENDAR_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const dates = new Set<string>();
  for (const d of future) {
    if (d.getTime() <= windowEnd) dates.add(kstDateString(d));
  }

  return {
    scheduleDates: [...dates].sort(),
    nextScheduleAt: Timestamp.fromDate(future[0]),
    lastScheduleAt: Timestamp.fromDate(future[future.length - 1]),
  };
}

/**
 * 프로그램 문서의 `scheduleDates`·`nextScheduleAt`·`lastScheduleAt`을 다시 계산합니다.
 *
 * **회차를 만들거나 지우는 모든 경로가 이 함수만 호출합니다.** 갱신 지점이 흩어지면
 * 한 곳을 빠뜨려 "달력에 점은 있는데 예약이 안 되는" 불일치가 생깁니다(17-2).
 *
 * **집계 문서(`aggregates/*`)는 건드리지 않습니다.** 프로그램마다 집계 문서를 고치면
 * 모든 프로그램이 한 문서를 두고 다투게 되고, 재시도로 값이 부풉니다 — 집계는
 * `rebuildSearchIndex` 배치가 전체 재생성합니다(17-5).
 */
export async function syncProgramScheduleDates(
  db: Firestore,
  programId: string,
  now: Date = new Date()
): Promise<ScheduleSummary> {
  const snap = await db.collection(`programs/${programId}/schedules`).get();
  const startAts = snap.docs.map((d) => (d.get("startAt") as Timestamp).toDate());
  const summary = summarizeSchedules(startAts, now);

  await db.doc(`programs/${programId}`).update({
    ...summary,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return summary;
}

/** 등록 시점에 회차를 한꺼번에 만듭니다. 프로그램 문서와 같은 배치로 씁니다. */
export function writeScheduleDocs(
  db: Firestore,
  programId: string,
  docs: ScheduleDocData[],
  batch: ReturnType<Firestore["batch"]>
): void {
  const col = db.collection(`programs/${programId}/schedules`);
  for (const data of docs) {
    batch.set(col.doc(), {
      ...data,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

export interface ScheduleRow {
  id: string;
  startAt: string;
  endAt: string | null;
  seriesIndex: number | null;
  seriesTotal: number | null;
  totalSlots: number;
  remainingSlots: number;
  forceOpen: boolean;
}

/** 프로그램의 회차 목록(이른 날짜순). 지난 회차도 포함합니다 — 공급자가 이력을 봅니다. */
export async function listSchedules(
  db: Firestore,
  programId: string
): Promise<ScheduleRow[]> {
  const snap = await db
    .collection(`programs/${programId}/schedules`)
    .orderBy("startAt")
    .get();

  return snap.docs.map((d) => {
    const endAt = d.get("endAt") as Timestamp | null;
    return {
      id: d.id,
      startAt: (d.get("startAt") as Timestamp).toDate().toISOString(),
      endAt: endAt == null ? null : endAt.toDate().toISOString(),
      seriesIndex: (d.get("seriesIndex") as number | null) ?? null,
      seriesTotal: (d.get("seriesTotal") as number | null) ?? null,
      // v20 이전에 만든 문서에는 totalSlots가 없습니다 — 남은 자리로 대체합니다.
      totalSlots: (d.get("totalSlots") as number | undefined) ?? (d.get("remainingSlots") as number),
      remainingSlots: d.get("remainingSlots") as number,
      forceOpen: d.get("forceOpen") === true,
    };
  });
}

/** 소유자 확인 + 프로그램 정보. 남의 프로그램은 존재 여부도 알리지 않습니다. */
async function loadOwnedProgram(
  db: Firestore,
  programId: string,
  uid: string
): Promise<{ status: string; scheduleType: string; capacity: number }> {
  const snap = await db.doc(`programs/${programId}`).get();
  if (!snap.exists || snap.get("providerId") !== uid) {
    throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
  }
  return {
    status: snap.get("status") as string,
    scheduleType: snap.get("scheduleType") as string,
    capacity: snap.get("capacity") as number,
  };
}

/** 등록 뒤 회차를 추가합니다. 전문가가 날짜를 나중에 더 여는 경로입니다. */
export async function addSchedules(
  db: Firestore,
  programId: string,
  uid: string,
  body: unknown,
  now: Date = new Date()
): Promise<{ added: number; summary: ScheduleSummary }> {
  const program = await loadOwnedProgram(db, programId, uid);
  const existing = await listSchedules(db, programId);

  const inputs = parseScheduleInputs((body as Record<string, unknown>)?.schedules, {
    scheduleType: program.scheduleType,
    programCapacity: program.capacity,
    existingCount: existing.length,
    now,
  });

  if (inputs.length === 0) {
    throw new AppError("invalid-argument", "추가할 회차가 없습니다");
  }

  // 이미 있는 시각과 겹치는지 확인합니다. 비교는 절대시각(UTC) 문자열로 합니다 —
  // 날짜·시간 문자열로 비교하면 같은 순간을 다르게 적은 입력을 놓칩니다.
  const existingKeys = new Set(existing.map((row) => new Date(row.startAt).toISOString()));
  for (const input of inputs) {
    const key = kstToInstant(input.date, input.startTime).toISOString();
    if (existingKeys.has(key)) {
      throw new AppError(
        "invalid-argument",
        `이미 등록된 회차입니다: ${input.date} ${input.startTime}`
      );
    }
  }

  const docs = buildScheduleDocs(inputs, {
    programId,
    programStatus: program.status,
    type: program.scheduleType,
    startIndex: existing.length + 1,
    seriesTotal: existing.length + inputs.length,
  });

  const batch = db.batch();
  writeScheduleDocs(db, programId, docs, batch);
  await batch.commit();

  // series 회차 번호는 전체 개수가 바뀌면 같이 바뀝니다.
  if (program.scheduleType === "series") {
    await renumberSeries(db, programId);
  }

  const summary = await syncProgramScheduleDates(db, programId, now);
  return { added: docs.length, summary };
}

/** `series` 회차 번호를 날짜순으로 다시 매깁니다(1/3 · 2/3 · 3/3). */
async function renumberSeries(db: Firestore, programId: string): Promise<void> {
  const snap = await db
    .collection(`programs/${programId}/schedules`)
    .orderBy("startAt")
    .get();

  const total = snap.size;
  const batch = db.batch();
  snap.docs.forEach((d, i) => {
    batch.update(d.ref, { seriesIndex: i + 1, seriesTotal: total });
  });
  await batch.commit();
}

/**
 * 회차 삭제 — 전문가가 못 가는 날을 닫는 경로입니다.
 *
 * **예약이 한 건이라도 있으면 지우지 않습니다.** 지우면 그 예약의
 * `bookings.scheduleId`가 없는 문서를 가리켜, 환불도 안내도 근거를 잃습니다.
 * (예약 기능은 아직 없으므로 이 쿼리는 지금은 항상 0건입니다 — 기능이 붙는 날
 * 이 검사를 새로 만들지 않도록 미리 둡니다.)
 */
export async function deleteSchedule(
  db: Firestore,
  programId: string,
  scheduleId: string,
  uid: string,
  now: Date = new Date()
): Promise<{ summary: ScheduleSummary }> {
  await loadOwnedProgram(db, programId, uid);

  const ref = db.doc(`programs/${programId}/schedules/${scheduleId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new AppError("not-found", "회차를 찾을 수 없습니다");
  }

  const booked = await db
    .collection("bookings")
    .where("scheduleId", "==", scheduleId)
    .limit(1)
    .get();
  if (!booked.empty) {
    throw new AppError(
      "failed-precondition",
      "이미 예약이 있는 회차는 삭제할 수 없습니다. 취소 처리를 먼저 진행해 주세요"
    );
  }

  await ref.delete();

  const program = await db.doc(`programs/${programId}`).get();
  if (program.get("scheduleType") === "series") {
    await renumberSeries(db, programId);
  }

  const summary = await syncProgramScheduleDates(db, programId, now);
  return { summary };
}

/**
 * 심사 요청 전 회차 확인.
 *
 * 날짜가 없는 채로 게시되면 **검색에는 뜨는데 예약할 날짜가 없는 프로그램**이
 * 됩니다. 사용자는 이걸 고장으로 읽고, 공급자는 무엇이 빠졌는지 모릅니다.
 *
 * **`weekly`도 막습니다.** 반복 템플릿(`POST /programs/{id}/schedule-templates`)이
 * 아직 없어서 회차가 생길 경로가 없습니다. 통과시키면 영구히 예약 불가인
 * 프로그램이 게시됩니다. 템플릿이 생기는 날 이 분기를 지웁니다.
 * `open`(상시모집)은 회차 자체를 쓰지 않으므로 예외입니다(2-4).
 */
export function assertSchedulableForReview(scheduleType: string, count: number): void {
  if (scheduleType === "open") return;
  if (count > 0) return;

  if (scheduleType === "weekly") {
    throw new AppError(
      "failed-precondition",
      "매주 반복은 아직 준비 중입니다. 「회차제」로 날짜를 직접 등록해 주세요"
    );
  }

  throw new AppError(
    "failed-precondition",
    scheduleType === "single"
      ? "진행 날짜를 입력한 뒤 심사를 요청해 주세요"
      : "회차 날짜를 하나 이상 등록한 뒤 심사를 요청해 주세요"
  );
}
