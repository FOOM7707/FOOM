/**
 * 회차(날짜) 등록·삭제와 날짜 요약 (스키마 2-4 · 17-2).
 *
 * 확인하는 것: 한국시간 환산 / 저장되면 조용히 틀리는 입력을 거부하는지 /
 * 회차를 만들거나 지울 때 프로그램의 날짜 요약이 함께 갱신되는지 /
 * 남의 프로그램은 건드리지 못하는지.
 *
 * **한국시간 환산을 테스트로 못박는 이유:** 서버는 UTC로 돌기 때문에 그냥 쓰면
 * 날짜가 하루 밀리는데, 에러가 나지 않고 "옆 날짜 회차"로만 나타납니다.
 * 날씨 연동에서 이미 같은 함정을 겪었습니다(16-4 ②).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createDraftProgram, parseProgramInput } from "../src/lib/programs";
import { grantProvider } from "../src/lib/providerGrant";
import {
  MAX_SCHEDULES_PER_PROGRAM,
  addSchedules,
  buildScheduleDocs,
  deleteSchedule,
  kstDateString,
  kstToInstant,
  listSchedules,
  parseScheduleInputs,
  summarizeSchedules,
  syncProgramScheduleDates,
} from "../src/lib/schedules";
import { testDb } from "./helpers";

let providerUid: string;
let otherUid: string;
let seq = 0;

async function makeUser(role: "consumer" | "provider"): Promise<string> {
  seq += 1;
  const uid = `sched-${role}-${Date.now()}-${seq}`;
  await testDb.doc(`users/${uid}`).set({
    role: "consumer",
    authProvider: "naver",
    name: "테스트",
    status: "active",
  });
  if (role === "provider") {
    await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb });
  }
  return uid;
}

/** 고정 기준시각 — 2026-09-01 09:00 KST (= 2026-09-01 00:00 UTC) */
const NOW = new Date("2026-09-01T00:00:00.000Z");

function row(date: string, startTime = "10:00", capacity = 12, endTime: string | null = "12:00") {
  return { date, startTime, endTime, capacity };
}

function parse(rows: unknown[], overrides: Record<string, unknown> = {}) {
  return parseScheduleInputs(rows, {
    scheduleType: "series",
    programCapacity: 12,
    now: NOW,
    ...overrides,
  });
}

function programInput(overrides: Record<string, unknown> = {}) {
  return parseProgramInput({
    title: "가을 숲길 걷기",
    description: "국립자연휴양림 둘레길을 함께 걷습니다.",
    category: "숲길등산",
    qualificationType: "mountain_trail_guide",
    location: { address: "강원도 홍천군 서면" },
    price: 30000,
    capacity: 12,
    minCapacity: 4,
    scheduleType: "series",
    barrierFree: false,
    rainAlternative: "reschedule",
    walkingDistanceM: 2000,
    targetAgeMin: null,
    targetAgeMax: null,
    ...overrides,
  });
}

/** 오늘로부터 n일 뒤의 KST 날짜 문자열 */
function daysFromNow(n: number): string {
  return kstDateString(new Date(Date.now() + n * 24 * 60 * 60 * 1000));
}

beforeAll(async () => {
  providerUid = await makeUser("provider");
  otherUid = await makeUser("provider");
});

describe("한국시간 환산", () => {
  it("KST 자정은 전날 15시(UTC)로 저장된다", () => {
    // 이 환산을 빼면 9시간이 밀려 "9월 4일 회차"가 9월 5일로 저장됩니다.
    expect(kstToInstant("2026-09-05", "00:00").toISOString()).toBe(
      "2026-09-04T15:00:00.000Z"
    );
  });

  it("KST 오전 10시는 같은 날 01시(UTC)", () => {
    expect(kstToInstant("2026-09-05", "10:00").toISOString()).toBe(
      "2026-09-05T01:00:00.000Z"
    );
  });

  it("되돌려 읽어도 같은 KST 날짜다 (자정 직후가 전날로 밀리지 않는다)", () => {
    const instant = kstToInstant("2026-09-05", "00:30");
    expect(kstDateString(instant)).toBe("2026-09-05");
  });

  it("달력에 없는 날짜는 거부한다 — 다음 달로 넘어가 조용히 저장되는 것을 막는다", () => {
    expect(() => kstToInstant("2026-02-30", "10:00")).toThrow();
    expect(() => kstToInstant("2026-13-01", "10:00")).toThrow();
  });

  it("형식이 어긋나면 거부한다", () => {
    expect(() => kstToInstant("2026-9-5", "10:00")).toThrow();
    expect(() => kstToInstant("2026-09-05", "10시")).toThrow();
    expect(() => kstToInstant("2026-09-05", "25:00")).toThrow();
  });
});

describe("parseScheduleInputs — 저장되면 조용히 틀리는 입력을 거부한다", () => {
  it("정상 입력은 날짜순으로 정렬해 돌려준다", () => {
    const parsed = parse([row("2026-09-19"), row("2026-09-05"), row("2026-09-12")]);
    expect(parsed.map((p) => p.date)).toEqual(["2026-09-05", "2026-09-12", "2026-09-19"]);
  });

  it("지난 시각은 거부한다 — 목록에는 뜨지만 아무도 예약할 수 없다", () => {
    expect(() => parse([row("2026-08-31")])).toThrow(/지난 시각/);
  });

  it("종료 시간이 시작보다 앞이거나 같으면 거부한다", () => {
    expect(() => parse([row("2026-09-05", "14:00", 12, "12:00")])).toThrow(/종료 시간/);
    expect(() => parse([row("2026-09-05", "14:00", 12, "14:00")])).toThrow(/종료 시간/);
  });

  it("종료 시간은 비워도 된다", () => {
    const parsed = parse([row("2026-09-05", "10:00", 12, null)]);
    expect(parsed[0].endTime).toBeNull();
  });

  it("날짜와 시작 시간이 겹치면 거부한다", () => {
    expect(() => parse([row("2026-09-05"), row("2026-09-05")])).toThrow(/겹칩니다/);
  });

  it("같은 날 다른 시간은 허용한다 — 오전·오후 두 타임", () => {
    const parsed = parse([
      row("2026-09-05", "10:00", 12, "12:00"),
      row("2026-09-05", "14:00", 12, "16:00"),
    ]);
    expect(parsed).toHaveLength(2);
  });

  it("정원이 프로그램 최대 인원을 넘으면 거부한다", () => {
    expect(() => parse([row("2026-09-05", "10:00", 20)])).toThrow(/최대 인원/);
  });

  it("정원이 0명 이하이거나 소수면 거부한다", () => {
    expect(() => parse([row("2026-09-05", "10:00", 0)])).toThrow(/정원/);
    expect(() => parse([row("2026-09-05", "10:00", 2.5)])).toThrow(/정원/);
  });

  it("너무 먼 날짜는 거부한다 — 오타 한 번으로 200년 뒤 회차가 생기는 것을 막는다", () => {
    expect(() => parse([row("2226-09-05")])).toThrow(/먼 날짜/);
  });

  it(`회차는 ${MAX_SCHEDULES_PER_PROGRAM}개까지만`, () => {
    const many = Array.from({ length: MAX_SCHEDULES_PER_PROGRAM + 1 }, (_, i) =>
      row("2026-09-05", `${String(i % 24).padStart(2, "0")}:00`, 12, null)
    );
    expect(() => parse(many)).toThrow(/최대/);
  });

  it("1회성은 날짜가 하나뿐이다", () => {
    expect(() =>
      parse([row("2026-09-05"), row("2026-09-12")], { scheduleType: "single" })
    ).toThrow(/1회성/);
  });

  it("상시모집은 날짜를 받지 않는다 — 예약자와 협의해 정한다", () => {
    expect(() => parse([row("2026-09-05")], { scheduleType: "open" })).toThrow(/상시모집/);
    expect(parse([], { scheduleType: "open" })).toEqual([]);
  });

  it("매주 반복은 준비 중이라 날짜를 직접 받지 않는다", () => {
    expect(() => parse([row("2026-09-05")], { scheduleType: "weekly" })).toThrow(/준비 중/);
  });

  it("공휴일·주말을 걸러내지 않는다 — 성수기라 오히려 열어야 하는 날이다", () => {
    // 2026-10-03 개천절(토), 10-09 한글날(금)
    const parsed = parse([row("2026-10-03"), row("2026-10-09")]);
    expect(parsed).toHaveLength(2);
  });
});

describe("buildScheduleDocs", () => {
  it("series는 날짜순으로 회차 번호를 매긴다", () => {
    const inputs = parse([row("2026-09-05"), row("2026-09-12"), row("2026-09-19")]);
    const docs = buildScheduleDocs(inputs, {
      programId: "p1",
      programStatus: "draft",
      type: "series",
    });
    expect(docs.map((d) => d.seriesIndex)).toEqual([1, 2, 3]);
    expect(docs.every((d) => d.seriesTotal === 3)).toBe(true);
  });

  it("1회성은 회차 번호를 붙이지 않는다", () => {
    const docs = buildScheduleDocs(parse([row("2026-09-05")], { scheduleType: "single" }), {
      programId: "p1",
      programStatus: "draft",
      type: "single",
    });
    expect(docs[0].seriesIndex).toBeNull();
    expect(docs[0].seriesTotal).toBeNull();
  });

  it("정원을 두 벌로 저장한다 — 예약이 차감해도 원래 정원을 알 수 있어야 한다", () => {
    const docs = buildScheduleDocs(parse([row("2026-09-05", "10:00", 8)]), {
      programId: "p1",
      programStatus: "draft",
      type: "series",
    });
    expect(docs[0].totalSlots).toBe(8);
    expect(docs[0].remainingSlots).toBe(8);
  });

  it("상위 status 사본을 함께 넣는다 — 없으면 게시해도 검색에 안 잡힌다", () => {
    const docs = buildScheduleDocs(parse([row("2026-09-05")]), {
      programId: "p1",
      programStatus: "published",
      type: "series",
    });
    expect(docs[0].programStatus).toBe("published");
    expect(docs[0].programId).toBe("p1");
    expect(docs[0].forceOpen).toBe(false);
  });
});

describe("summarizeSchedules — 프로그램에 저장할 날짜 요약", () => {
  it("미래 회차만 담고 이른 날짜순으로 중복 없이 정리한다", () => {
    const summary = summarizeSchedules(
      [
        new Date("2026-08-01T01:00:00Z"), // 과거
        new Date("2026-09-12T01:00:00Z"),
        new Date("2026-09-05T01:00:00Z"),
        new Date("2026-09-05T05:00:00Z"), // 같은 날 다른 시간
      ],
      NOW
    );
    expect(summary.scheduleDates).toEqual(["2026-09-05", "2026-09-12"]);
    expect(summary.nextScheduleAt!.toDate().toISOString()).toBe("2026-09-05T01:00:00.000Z");
    expect(summary.lastScheduleAt!.toDate().toISOString()).toBe("2026-09-12T01:00:00.000Z");
  });

  it("회차가 없으면 명시적 null — 필드를 지우면 검색에서 통째로 사라진다", () => {
    const summary = summarizeSchedules([], NOW);
    expect(summary.scheduleDates).toEqual([]);
    expect(summary.nextScheduleAt).toBeNull();
    expect(summary.lastScheduleAt).toBeNull();
  });

  it("90일 밖의 회차는 달력 목록에서 빠지지만 마지막 회차로는 남는다", () => {
    const far = new Date("2027-06-01T01:00:00Z");
    const summary = summarizeSchedules([new Date("2026-09-05T01:00:00Z"), far], NOW);
    expect(summary.scheduleDates).toEqual(["2026-09-05"]);
    expect(summary.lastScheduleAt!.toDate().toISOString()).toBe(far.toISOString());
  });

  it("KST 기준으로 날짜를 적는다 — UTC로 적으면 자정 회차가 전날로 밀린다", () => {
    const summary = summarizeSchedules([new Date("2026-09-04T15:30:00Z")], NOW);
    expect(summary.scheduleDates).toEqual(["2026-09-05"]);
  });
});

describe("등록 시 회차 저장", () => {
  it("프로그램과 회차를 함께 만들고 날짜 요약을 채운다", async () => {
    const dates = [daysFromNow(10), daysFromNow(17), daysFromNow(24)];
    const inputs = parseScheduleInputs(
      dates.map((d) => row(d)),
      { scheduleType: "series", programCapacity: 12 }
    );
    const { id } = await createDraftProgram(testDb, providerUid, programInput(), inputs);

    const schedules = await listSchedules(testDb, id);
    expect(schedules).toHaveLength(3);
    expect(schedules.map((s) => s.seriesIndex)).toEqual([1, 2, 3]);

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("scheduleDates")).toEqual(dates);
    expect(snap.get("nextScheduleAt")).not.toBeNull();
    expect(snap.get("lastScheduleAt")).not.toBeNull();
  });

  it("회차를 넣지 않으면 날짜 요약은 비어 있다 (draft로는 저장된다)", async () => {
    const { id } = await createDraftProgram(testDb, providerUid, programInput());
    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("scheduleDates")).toEqual([]);
    expect(snap.get("nextScheduleAt")).toBeNull();
  });

  it("회차 문서에 상위 status 사본이 draft로 들어간다", async () => {
    const inputs = parseScheduleInputs([row(daysFromNow(10))], {
      scheduleType: "series",
      programCapacity: 12,
    });
    const { id } = await createDraftProgram(testDb, providerUid, programInput(), inputs);
    const snap = await testDb.collection(`programs/${id}/schedules`).get();
    expect(snap.docs[0].get("programStatus")).toBe("draft");
  });
});

describe("회차 추가·삭제", () => {
  async function makeProgram(dayOffsets: number[]): Promise<string> {
    const inputs = parseScheduleInputs(
      dayOffsets.map((n) => row(daysFromNow(n))),
      { scheduleType: "series", programCapacity: 12 }
    );
    const { id } = await createDraftProgram(testDb, providerUid, programInput(), inputs);
    return id;
  }

  it("추가하면 회차 번호가 날짜순으로 다시 매겨진다", async () => {
    const id = await makeProgram([20, 30]);
    // 두 회차 사이에 끼워 넣습니다.
    await addSchedules(testDb, id, providerUid, {
      schedules: [row(daysFromNow(25))],
    });

    const schedules = await listSchedules(testDb, id);
    expect(schedules).toHaveLength(3);
    expect(schedules.map((s) => s.seriesIndex)).toEqual([1, 2, 3]);
    expect(schedules.every((s) => s.seriesTotal === 3)).toBe(true);
  });

  it("추가하면 프로그램의 날짜 요약도 함께 갱신된다", async () => {
    const id = await makeProgram([20]);
    await addSchedules(testDb, id, providerUid, { schedules: [row(daysFromNow(25))] });

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("scheduleDates")).toEqual([daysFromNow(20), daysFromNow(25)]);
  });

  it("이미 있는 시각과 겹치면 거부한다", async () => {
    const id = await makeProgram([20]);
    await expect(
      addSchedules(testDb, id, providerUid, { schedules: [row(daysFromNow(20))] })
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("남의 프로그램에는 추가하지 못한다 — 존재 여부도 알리지 않는다", async () => {
    const id = await makeProgram([20]);
    await expect(
      addSchedules(testDb, id, otherUid, { schedules: [row(daysFromNow(25))] })
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("삭제하면 회차가 사라지고 날짜 요약이 줄어든다", async () => {
    const id = await makeProgram([20, 30]);
    const [first] = await listSchedules(testDb, id);

    await deleteSchedule(testDb, id, first.id, providerUid);

    const remaining = await listSchedules(testDb, id);
    expect(remaining).toHaveLength(1);
    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("scheduleDates")).toEqual([daysFromNow(30)]);
  });

  it("마지막 회차를 지우면 날짜 요약이 명시적 null로 돌아간다", async () => {
    const id = await makeProgram([20]);
    const [only] = await listSchedules(testDb, id);
    await deleteSchedule(testDb, id, only.id, providerUid);

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("scheduleDates")).toEqual([]);
    expect(snap.get("nextScheduleAt")).toBeNull();
    expect(snap.get("lastScheduleAt")).toBeNull();
  });

  it("예약이 있는 회차는 지우지 못한다 — 예약이 없는 회차를 가리키게 된다", async () => {
    const id = await makeProgram([20]);
    const [only] = await listSchedules(testDb, id);
    // 예약 기능은 아직 없으므로 문서를 직접 심어 검사만 확인합니다.
    const bookingRef = testDb.collection("bookings").doc();
    await bookingRef.set({ scheduleId: only.id, programId: id, status: "confirmed" });

    await expect(
      deleteSchedule(testDb, id, only.id, providerUid)
    ).rejects.toMatchObject({ code: "failed-precondition" });

    await bookingRef.delete();
  });

  it("남의 프로그램 회차는 지우지 못한다", async () => {
    const id = await makeProgram([20]);
    const [only] = await listSchedules(testDb, id);
    await expect(
      deleteSchedule(testDb, id, only.id, otherUid)
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("없는 회차를 지우려 하면 not-found", async () => {
    const id = await makeProgram([20]);
    await expect(
      deleteSchedule(testDb, id, "존재하지않는회차", providerUid)
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("syncProgramScheduleDates", () => {
  it("회차를 직접 심어도 이 함수를 부르면 요약이 맞춰진다 (복구 경로)", async () => {
    const { id } = await createDraftProgram(testDb, providerUid, programInput());
    const date = daysFromNow(15);
    await testDb.collection(`programs/${id}/schedules`).add({
      programId: id,
      programStatus: "draft",
      type: "series",
      startAt: kstToInstant(date, "10:00"),
      endAt: null,
      seriesIndex: 1,
      seriesTotal: 1,
      totalSlots: 12,
      remainingSlots: 12,
      forceOpen: false,
    });

    const before = await testDb.doc(`programs/${id}`).get();
    expect(before.get("scheduleDates")).toEqual([]);

    await syncProgramScheduleDates(testDb, id);

    const after = await testDb.doc(`programs/${id}`).get();
    expect(after.get("scheduleDates")).toEqual([date]);
  });
});
