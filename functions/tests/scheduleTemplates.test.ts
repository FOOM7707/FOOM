/**
 * 매주 반복 회차 규칙과 자동 생성 (스키마 2-4 · 5번).
 *
 * 확인하는 것: 요일·기간 계산이 한국시간 기준인지 / 배치를 여러 번 돌려도 회차가
 * 늘지 않는지 / **이미 있는 회차를 덮어써서 남은 자리를 되살리지 않는지** /
 * 예약이 있는 회차를 규칙 수정·삭제가 건드리지 않는지 / 남의 프로그램을 막는지.
 *
 * **덮어쓰기를 테스트로 못박는 이유:** 회차 문서에는 예약이 깎아 둔 남은 자리가
 * 들어 있어서, 매일 도는 배치가 덮으면 **예약이 있는데 자리가 원래대로 돌아옵니다.**
 * 에러가 나지 않고 「정원이 새는」 형태로만 나타나는 종류입니다.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createDraftProgram, parseProgramInput } from "../src/lib/programs";
import { grantProvider } from "../src/lib/providerGrant";
import { kstDateString, listSchedules } from "../src/lib/schedules";
import {
  MAX_TEMPLATES_PER_PROGRAM,
  createScheduleTemplate,
  deleteScheduleTemplate,
  generateOccurrencesForProgram,
  generateWeeklySchedules,
  kstWeekday,
  listScheduleTemplates,
  occurrenceDates,
  occurrenceDocId,
  parseScheduleTemplateInput,
  updateScheduleTemplate,
} from "../src/lib/scheduleTemplates";
import { testDb } from "./helpers";

let providerUid: string;
let otherUid: string;
let seq = 0;

async function makeProvider(): Promise<string> {
  seq += 1;
  const uid = `tpl-provider-${Date.now()}-${seq}`;
  await testDb.doc(`users/${uid}`).set({
    role: "consumer",
    authProvider: "naver",
    name: "테스트",
    status: "active",
  });
  await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb });
  return uid;
}

/** 기준시각 — 2026-09-01(화) 09:00 KST. 요일 계산이 눈에 보이도록 화요일로 잡습니다. */
const NOW = new Date("2026-09-01T00:00:00.000Z");

function programInput(overrides: Record<string, unknown> = {}) {
  return parseProgramInput({
    title: "매주 여는 숲길 걷기",
    description: "국립자연휴양림 둘레길을 매주 함께 걷습니다.",
    category: "숲길등산",
    qualificationType: "mountain_trail_guide",
    location: { address: "강원도 홍천군 서면" },
    price: 30000,
    capacity: 12,
    minCapacity: 4,
    scheduleType: "weekly",
    barrierFree: false,
    rainAlternative: "reschedule",
    walkingDistanceM: 2000,
    targetAgeMin: null,
    targetAgeMax: null,
    ...overrides,
  });
}

async function makeProgram(
  uid = providerUid,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const { id } = await createDraftProgram(testDb, uid, programInput(overrides));
  return id;
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    weekday: 2, // 화요일
    timeOfDay: "10:00",
    endTimeOfDay: "12:00",
    capacityPerOccurrence: 10,
    activeFrom: "2026-09-01",
    activeUntil: null,
    ...overrides,
  };
}

beforeAll(async () => {
  providerUid = await makeProvider();
  otherUid = await makeProvider();
});

describe("요일 계산 (한국시간)", () => {
  it("2026-09-01은 화요일이다", () => {
    expect(kstWeekday("2026-09-01")).toBe(2);
  });

  it("KST 자정을 UTC로 읽어 하루 밀리지 않는다", () => {
    // UTC로 계산하면 KST 자정은 전날 15시라 요일이 하나 앞으로 밀립니다 —
    // 에러 없이 「옆 요일에 회차가 생기는」 형태로만 나타납니다.
    expect(kstWeekday("2026-09-06")).toBe(0); // 일요일
    expect(kstWeekday("2026-09-07")).toBe(1); // 월요일
  });
});

describe("날짜 목록 만들기", () => {
  it("90일 창 안의 해당 요일만 고른다", () => {
    const dates = occurrenceDates(template(), NOW);
    expect(dates[0]).toBe("2026-09-01");
    expect(dates[1]).toBe("2026-09-08");
    expect(dates.every((d) => kstWeekday(d) === 2)).toBe(true);
    // 90일이면 13번째 화요일까지입니다(9/1 + 12주 = 11/24).
    expect(dates).toHaveLength(13);
    expect(dates[dates.length - 1]).toBe("2026-11-24");
  });

  it("종료일이 있으면 거기서 끊는다", () => {
    const dates = occurrenceDates(template({ activeUntil: "2026-09-20" }), NOW);
    expect(dates).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
  });

  it("시작일이 아직 안 왔으면 그날부터 센다", () => {
    const dates = occurrenceDates(template({ activeFrom: "2026-10-01" }), NOW);
    expect(dates[0]).toBe("2026-10-06");
  });

  it("시작일이 이미 지났으면 오늘부터 센다 — 지난 날짜에 회차를 만들지 않는다", () => {
    const dates = occurrenceDates(template({ activeFrom: "2026-01-01" }), NOW);
    expect(dates[0]).toBe("2026-09-01");
  });

  it("종료일이 이미 지났으면 만들 날짜가 없다", () => {
    const dates = occurrenceDates(
      template({ activeFrom: "2026-01-01", activeUntil: "2026-02-01" }),
      NOW
    );
    expect(dates).toEqual([]);
  });
});

describe("입력 검증", () => {
  function parse(overrides: Record<string, unknown> = {}) {
    return parseScheduleTemplateInput(template(overrides), {
      programCapacity: 12,
      now: NOW,
    });
  }

  it("정상 입력을 통과시킨다", () => {
    expect(parse().weekday).toBe(2);
  });

  it("요일 범위 밖은 거부한다", () => {
    expect(() => parse({ weekday: 7 })).toThrow();
    expect(() => parse({ weekday: -1 })).toThrow();
  });

  it("시각 형식이 어긋나면 거부한다", () => {
    expect(() => parse({ timeOfDay: "25:00" })).toThrow();
    expect(() => parse({ timeOfDay: "9:00" })).toThrow();
  });

  it("종료 시각이 시작보다 앞서면 거부한다", () => {
    expect(() => parse({ timeOfDay: "14:00", endTimeOfDay: "13:00" })).toThrow();
  });

  it("회차 정원이 프로그램 최대 인원을 넘으면 거부한다", () => {
    // 넘어가면 정원 20명짜리 회차가 열리고, 최대 12명인 프로그램에 20명이 옵니다.
    expect(() => parse({ capacityPerOccurrence: 20 })).toThrow();
  });

  it("달력에 없는 날짜는 거부한다", () => {
    expect(() => parse({ activeFrom: "2026-02-30" })).toThrow();
  });

  it("종료일이 시작일보다 앞서면 거부한다", () => {
    expect(() => parse({ activeFrom: "2026-10-01", activeUntil: "2026-09-01" })).toThrow();
  });

  it("시작일을 비우면 오늘부터로 채운다", () => {
    expect(parse({ activeFrom: null }).activeFrom).toBe(kstDateString(NOW));
  });

  it("종료 시각은 비워도 된다", () => {
    expect(parse({ endTimeOfDay: null }).endTimeOfDay).toBeNull();
  });
});

describe("규칙 등록", () => {
  it("등록하는 즉시 90일치 회차가 채워진다", async () => {
    // 배치만 기다리면 등록한 사람이 다음 날까지 게시를 못 합니다(회차 0건은 게시 막힘).
    const programId = await makeProgram();
    const { created } = await createScheduleTemplate(
      testDb,
      programId,
      providerUid,
      template(),
      NOW
    );
    expect(created).toBe(13);

    const rows = await listSchedules(testDb, programId);
    expect(rows).toHaveLength(13);
    expect(rows[0].totalSlots).toBe(10);
    expect(new Date(rows[0].startAt).toISOString()).toBe("2026-09-01T01:00:00.000Z");
    expect(new Date(rows[0].endAt!).toISOString()).toBe("2026-09-01T03:00:00.000Z");
  });

  it("프로그램의 날짜 요약이 함께 갱신된다", async () => {
    // 요약을 빠뜨리면 「달력에 점은 있는데 예약이 안 되는」 불일치가 생깁니다.
    const programId = await makeProgram();
    await createScheduleTemplate(testDb, programId, providerUid, template(), NOW);

    const snap = await testDb.doc(`programs/${programId}`).get();
    const dates = snap.get("scheduleDates") as string[];
    expect(dates.length).toBeGreaterThan(0);
    expect(dates).toContain("2026-09-08");
    expect(snap.get("nextScheduleAt")).not.toBeNull();
  });

  it("종료 시각 없이도 등록된다", async () => {
    const programId = await makeProgram();
    await createScheduleTemplate(
      testDb,
      programId,
      providerUid,
      template({ endTimeOfDay: null }),
      NOW
    );
    const rows = await listSchedules(testDb, programId);
    expect(rows[0].endAt).toBeNull();
  });

  it("같은 요일·같은 시각을 두 번 넣으면 거부한다", async () => {
    const programId = await makeProgram();
    await createScheduleTemplate(testDb, programId, providerUid, template(), NOW);
    await expect(
      createScheduleTemplate(testDb, programId, providerUid, template(), NOW)
    ).rejects.toThrow();
  });

  it("규칙은 프로그램당 7개까지다", async () => {
    const programId = await makeProgram();
    for (let weekday = 0; weekday < MAX_TEMPLATES_PER_PROGRAM; weekday += 1) {
      await createScheduleTemplate(
        testDb,
        programId,
        providerUid,
        template({ weekday }),
        NOW
      );
    }
    await expect(
      createScheduleTemplate(
        testDb,
        programId,
        providerUid,
        template({ weekday: 0, timeOfDay: "14:00" }),
        NOW
      )
    ).rejects.toThrow();
  });

  it("「매주 반복」이 아닌 프로그램은 거부한다", async () => {
    const programId = await makeProgram(providerUid, { scheduleType: "series" });
    await expect(
      createScheduleTemplate(testDb, programId, providerUid, template(), NOW)
    ).rejects.toThrow();
  });

  it("남의 프로그램은 존재 여부도 알리지 않는다", async () => {
    const programId = await makeProgram();
    await expect(
      createScheduleTemplate(testDb, programId, otherUid, template(), NOW)
    ).rejects.toThrow(/찾을 수 없습니다/);
  });

  it("목록은 요일·시각 순으로 나온다", async () => {
    const programId = await makeProgram();
    await createScheduleTemplate(testDb, programId, providerUid, template({ weekday: 5 }), NOW);
    await createScheduleTemplate(testDb, programId, providerUid, template({ weekday: 1 }), NOW);

    const rows = await listScheduleTemplates(testDb, programId, providerUid);
    expect(rows.map((r) => r.weekday)).toEqual([1, 5]);
    expect(rows[0].weekdayLabel).toBe("월");
  });
});

describe("배치로 채우기", () => {
  it("두 번 돌려도 회차가 늘지 않는다", async () => {
    const programId = await makeProgram();
    await createScheduleTemplate(testDb, programId, providerUid, template(), NOW);

    const again = await generateOccurrencesForProgram(testDb, programId, NOW);
    expect(again.created).toBe(0);
    expect(await listSchedules(testDb, programId)).toHaveLength(13);
  });

  it("이미 있는 회차의 남은 자리를 되살리지 않는다", async () => {
    // 예약이 자리를 깎아 둔 상태에서 배치가 덮어쓰면 정원이 새어나갑니다.
    const programId = await makeProgram();
    const { id: templateId } = await createScheduleTemplate(
      testDb,
      programId,
      providerUid,
      template(),
      NOW
    );

    const docId = occurrenceDocId(templateId, "2026-09-08");
    await testDb.doc(`programs/${programId}/schedules/${docId}`).update({ remainingSlots: 3 });

    await generateOccurrencesForProgram(testDb, programId, NOW);

    const snap = await testDb.doc(`programs/${programId}/schedules/${docId}`).get();
    expect(snap.get("remainingSlots")).toBe(3);
  });

  it("날이 지나면 창의 끝에 새 회차를 이어 붙인다", async () => {
    const programId = await makeProgram();
    await createScheduleTemplate(testDb, programId, providerUid, template(), NOW);

    // 일주일 뒤에 배치가 돌면 창의 끝이 밀려 화요일 하나가 더 들어옵니다.
    const week = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { created } = await generateOccurrencesForProgram(testDb, programId, week);
    expect(created).toBe(1);
  });

  it("전문가가 지운 날짜를 되살리지 않는다", async () => {
    // 못 가는 날을 닫는 방법이 「그 회차를 지우기」 하나뿐이라(공휴일을 걸러내지
    // 않음), 배치가 되살리면 닫을 길이 아예 없어집니다.
    const programId = await makeProgram();
    const { id: templateId } = await createScheduleTemplate(
      testDb,
      programId,
      providerUid,
      template(),
      NOW
    );

    const docId = occurrenceDocId(templateId, "2026-09-15");
    await testDb.doc(`programs/${programId}/schedules/${docId}`).delete();

    // 그 다음 날 배치가 돌아도 그대로 닫혀 있어야 합니다.
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    await generateOccurrencesForProgram(testDb, programId, tomorrow);

    expect((await testDb.doc(`programs/${programId}/schedules/${docId}`).get()).exists).toBe(false);
  });

  it("규칙이 없는 프로그램은 건드리지 않는다", async () => {
    const programId = await makeProgram();
    const result = await generateOccurrencesForProgram(testDb, programId, NOW);
    expect(result.created).toBe(0);
    expect(await listSchedules(testDb, programId)).toHaveLength(0);
  });

  it("규칙이 있는 프로그램을 전부 찾아 채운다", async () => {
    const programId = await makeProgram();
    await createScheduleTemplate(testDb, programId, providerUid, template(), NOW);

    const result = await generateWeeklySchedules(testDb, NOW);
    expect(result.programs).toBeGreaterThan(0);
  });
});

describe("규칙 수정", () => {
  it("시각을 바꾸면 앞으로의 회차가 함께 바뀐다", async () => {
    const programId = await makeProgram();
    const { id: templateId } = await createScheduleTemplate(
      testDb,
      programId,
      providerUid,
      template(),
      NOW
    );

    await updateScheduleTemplate(
      testDb,
      programId,
      templateId,
      providerUid,
      template({ timeOfDay: "14:00", endTimeOfDay: "16:00" }),
      NOW
    );

    const rows = await listSchedules(testDb, programId);
    expect(new Date(rows[0].startAt).toISOString()).toBe("2026-09-01T05:00:00.000Z");
  });

  it("예약이 있는 회차는 건드리지 않는다", async () => {
    // 시각을 바꾸면 예약한 사람이 다른 시각에 오게 됩니다(2-4 캐스케이딩 정책).
    const programId = await makeProgram();
    const { id: templateId } = await createScheduleTemplate(
      testDb,
      programId,
      providerUid,
      template(),
      NOW
    );

    const docId = occurrenceDocId(templateId, "2026-09-08");
    const bookingRef = testDb.collection("bookings").doc();
    await bookingRef.set({ scheduleId: docId, programId, status: "confirmed" });

    const before = await testDb.doc(`programs/${programId}/schedules/${docId}`).get();

    const result = await updateScheduleTemplate(
      testDb,
      programId,
      templateId,
      providerUid,
      template({ timeOfDay: "14:00", endTimeOfDay: "16:00" }),
      NOW
    );

    expect(result.skipped).toBe(1);
    const after = await testDb.doc(`programs/${programId}/schedules/${docId}`).get();
    expect(after.get("startAt").isEqual(before.get("startAt"))).toBe(true);

    await bookingRef.delete();
  });

  it("요일을 바꾸면 옛 요일 회차는 치우고 새 요일로 채운다", async () => {
    const programId = await makeProgram();
    const { id: templateId } = await createScheduleTemplate(
      testDb,
      programId,
      providerUid,
      template(),
      NOW
    );

    await updateScheduleTemplate(
      testDb,
      programId,
      templateId,
      providerUid,
      template({ weekday: 4 }), // 목요일
      NOW
    );

    const rows = await listSchedules(testDb, programId);
    expect(rows.every((r) => kstWeekday(kstDateString(new Date(r.startAt))) === 4)).toBe(true);
  });

  it("없는 규칙은 거부한다", async () => {
    const programId = await makeProgram();
    await expect(
      updateScheduleTemplate(testDb, programId, "없는규칙", providerUid, template(), NOW)
    ).rejects.toThrow();
  });
});

describe("규칙 삭제", () => {
  it("앞으로의 회차를 함께 치운다", async () => {
    const programId = await makeProgram();
    const { id: templateId } = await createScheduleTemplate(
      testDb,
      programId,
      providerUid,
      template(),
      NOW
    );

    const result = await deleteScheduleTemplate(testDb, programId, templateId, providerUid, NOW);
    expect(result.removed).toBe(13);
    expect(await listSchedules(testDb, programId)).toHaveLength(0);
    expect(await listScheduleTemplates(testDb, programId, providerUid)).toHaveLength(0);
  });

  it("예약이 있는 회차는 남긴다", async () => {
    // 규칙이 없어졌다고 약속이 없어지지는 않습니다 — 지우면 그 예약이 가리킬
    // 문서가 사라져 환불·안내의 근거를 잃습니다.
    const programId = await makeProgram();
    const { id: templateId } = await createScheduleTemplate(
      testDb,
      programId,
      providerUid,
      template(),
      NOW
    );

    const docId = occurrenceDocId(templateId, "2026-09-15");
    const bookingRef = testDb.collection("bookings").doc();
    await bookingRef.set({ scheduleId: docId, programId, status: "confirmed" });

    const result = await deleteScheduleTemplate(testDb, programId, templateId, providerUid, NOW);
    expect(result.kept).toBe(1);
    expect((await testDb.doc(`programs/${programId}/schedules/${docId}`).get()).exists).toBe(true);

    await bookingRef.delete();
  });

  it("남의 규칙은 지우지 못한다", async () => {
    const programId = await makeProgram();
    const { id: templateId } = await createScheduleTemplate(
      testDb,
      programId,
      providerUid,
      template(),
      NOW
    );
    await expect(
      deleteScheduleTemplate(testDb, programId, templateId, otherUid, NOW)
    ).rejects.toThrow(/찾을 수 없습니다/);
  });
});
