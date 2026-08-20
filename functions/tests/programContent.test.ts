/**
 * 포함·불포함·준비물 키워드와 소개 블록 (스키마 20-2 · 20-4).
 *
 * 확인하는 것: 목록 밖의 값을 거부하는지 / **포함·불포함 모순을 막는지** /
 * 직접 입력 개수·길이 상한 / 소개 블록 상한과 빈 블록 거부 /
 * **소개 블록 사진이 이 프로그램의 것인지** / 게시 중인 프로그램의 소개를 고치면
 * 수정 승인으로 가는지.
 *
 * 모순 차단이 핵심입니다 — 「입장료 포함」과 「입장료 불포함」이 함께 뜨면 손님은
 * 어느 쪽을 믿어야 할지 알 수 없고, 그 상태로 결제가 일어나면 분쟁이 됩니다.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  MAX_CUSTOM_ITEMS,
  MAX_INTRO_BLOCKS,
  parseProgramContent,
} from "../src/lib/programContent";
import { createDraftProgram, parseProgramInput, updateProgram } from "../src/lib/programs";
import { getPendingEdit } from "../src/lib/programEdits";
import { parseReviewInput, reviewProgram } from "../src/lib/adminReview";
import { grantProvider } from "../src/lib/providerGrant";
import { kstDateString, parseScheduleInputs } from "../src/lib/schedules";
import { testDb } from "./helpers";

const ADMIN_UID = "content-admin";
let providerUid: string;
let seq = 0;

async function makeUser(): Promise<string> {
  seq += 1;
  const uid = `content-provider-${Date.now()}-${seq}`;
  await testDb.doc(`users/${uid}`).set({
    role: "consumer",
    authProvider: "naver",
    name: "테스트",
    status: "active",
  });
  await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb });
  return uid;
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
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
  };
}

beforeAll(async () => {
  providerUid = await makeUser();
});

describe("키워드 — 목록 선택", () => {
  it("목록에 있는 값은 통과한다", () => {
    const parsed = parseProgramContent({
      includes: { keys: ["guide", "refreshment"] },
      preparations: { keys: ["shoes", "water"] },
    });
    expect(parsed.includes.keys).toEqual(["guide", "refreshment"]);
    expect(parsed.preparations.keys).toEqual(["shoes", "water"]);
  });

  it("목록에 없는 값은 거부한다 — 표기가 제각각이 되면 필터로 쓸 수 없다", () => {
    expect(() => parseProgramContent({ includes: { keys: ["헬리콥터"] } })).toThrow();
  });

  it("불포함 목록에만 있는 값을 포함에 넣으면 거부한다", () => {
    // transport(교통비)는 불포함 목록에만 있습니다.
    expect(() => parseProgramContent({ includes: { keys: ["transport"] } })).toThrow();
  });

  it("중복은 하나로 합친다", () => {
    const parsed = parseProgramContent({ includes: { keys: ["guide", "guide"] } });
    expect(parsed.includes.keys).toEqual(["guide"]);
  });

  it("아무것도 안 보내면 빈 값이 된다 — 필드가 빠지면 화면이 터진다", () => {
    const parsed = parseProgramContent({});
    expect(parsed.includes).toEqual({ keys: [], custom: [] });
    expect(parsed.excludes).toEqual({ keys: [], custom: [] });
    expect(parsed.preparations).toEqual({ keys: [], custom: [] });
    expect(parsed.introBlocks).toEqual([]);
  });
});

describe("키워드 — 포함·불포함 모순", () => {
  it("입장료를 포함과 불포함에 함께 넣으면 거부한다", () => {
    // 「입장료 포함」과 「입장료 불포함」이 함께 뜨면 어느 쪽을 믿어야 할지 알 수 없습니다.
    expect(() =>
      parseProgramContent({
        includes: { keys: ["admission"] },
        excludes: { keys: ["admission"] },
      })
    ).toThrow(/함께 넣을 수 없습니다/);
  });

  it("직접 입력한 문구도 같은 기준으로 본다", () => {
    expect(() =>
      parseProgramContent({
        includes: { custom: ["족욕 체험"] },
        excludes: { custom: ["족욕 체험"] },
      })
    ).toThrow(/함께 넣을 수 없습니다/);
  });

  it("한쪽에만 넣으면 통과한다", () => {
    const parsed = parseProgramContent({
      includes: { keys: ["admission"] },
      excludes: { keys: ["parking"] },
    });
    expect(parsed.includes.keys).toEqual(["admission"]);
    expect(parsed.excludes.keys).toEqual(["parking"]);
  });
});

describe("키워드 — 직접 입력", () => {
  it("직접 입력을 받는다", () => {
    const parsed = parseProgramContent({
      preparations: { keys: ["shoes"], custom: ["등산 스틱"] },
    });
    expect(parsed.preparations.custom).toEqual(["등산 스틱"]);
  });

  it(`구분마다 ${MAX_CUSTOM_ITEMS}개까지만`, () => {
    expect(() =>
      parseProgramContent({
        includes: { custom: ["가", "나", "다", "라"] },
      })
    ).toThrow(/개까지/);
  });

  it("너무 긴 문구는 거부한다", () => {
    expect(() =>
      parseProgramContent({ includes: { custom: ["가".repeat(30)] } })
    ).toThrow(/너무 깁니다/);
  });

  it("빈 문자열과 공백은 버린다", () => {
    const parsed = parseProgramContent({ includes: { custom: ["", "   ", "다과"] } });
    expect(parsed.includes.custom).toEqual(["다과"]);
  });
});

describe("소개 블록", () => {
  it("소제목과 설명을 받는다", () => {
    const parsed = parseProgramContent({
      introBlocks: [{ heading: "숲으로 들어갑니다", body: "입구에서 모여 함께 걷습니다." }],
    });
    expect(parsed.introBlocks).toHaveLength(1);
    expect(parsed.introBlocks[0].heading).toBe("숲으로 들어갑니다");
  });

  it(`블록은 ${MAX_INTRO_BLOCKS}개까지만`, () => {
    const many = Array.from({ length: MAX_INTRO_BLOCKS + 1 }, (_, i) => ({
      heading: `${i}`,
      body: "설명",
    }));
    expect(() => parseProgramContent({ introBlocks: many })).toThrow(/개까지/);
  });

  it("소제목·설명 길이 상한을 넘기면 거부한다 — 넘치면 배치가 무너진다", () => {
    expect(() =>
      parseProgramContent({ introBlocks: [{ heading: "가".repeat(40), body: "설명" }] })
    ).toThrow(/소제목/);
    expect(() =>
      parseProgramContent({ introBlocks: [{ heading: "제목", body: "가".repeat(400) }] })
    ).toThrow(/설명/);
  });

  it("완전히 빈 블록은 거부한다", () => {
    expect(() => parseProgramContent({ introBlocks: [{ heading: "", body: "" }] })).toThrow(
      /비어 있습니다/
    );
  });

  it("사진만 있고 글이 없으면 거부한다 — 무슨 사진인지 알 수 없다", () => {
    expect(() =>
      parseProgramContent({
        introBlocks: [
          {
            heading: "",
            body: "",
            images: [{ path: "programs/p1/a.jpg", url: "https://x/a" }],
          },
        ],
      })
    ).toThrow(/소제목이나 설명/);
  });

  it("블록당 사진은 3장까지만", () => {
    const images = Array.from({ length: 4 }, (_, i) => ({
      path: `programs/p1/${i}.jpg`,
      url: `https://x/${i}`,
    }));
    expect(() =>
      parseProgramContent({ introBlocks: [{ heading: "제목", body: "설명", images }] })
    ).toThrow(/3장까지/);
  });
});

describe("저장 — 등록·수정", () => {
  it("등록 시 키워드와 소개 글이 함께 저장된다", async () => {
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(
        baseBody({
          includes: { keys: ["guide", "refreshment"], custom: ["숲 해설 자료집"] },
          excludes: { keys: ["parking"] },
          preparations: { keys: ["shoes", "water"] },
          introBlocks: [{ heading: "숲으로", body: "입구에서 만나 함께 걷습니다." }],
        })
      )
    );

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("includes")).toEqual({
      keys: ["guide", "refreshment"],
      custom: ["숲 해설 자료집"],
    });
    expect(snap.get("excludes")).toEqual({ keys: ["parking"], custom: [] });
    expect(snap.get("introBlocks")).toHaveLength(1);
  });

  it("아무것도 안 보내도 빈 값으로 저장된다", async () => {
    const { id } = await createDraftProgram(testDb, providerUid, parseProgramInput(baseBody()));
    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("includes")).toEqual({ keys: [], custom: [] });
    expect(snap.get("introBlocks")).toEqual([]);
  });

  it("등록 단계에서는 소개 블록 사진을 받지 않는다 — 저장 경로가 아직 없다", async () => {
    await expect(
      createDraftProgram(
        testDb,
        providerUid,
        parseProgramInput(
          baseBody({
            introBlocks: [
              {
                heading: "제목",
                body: "설명",
                images: [{ path: "programs/아무거나/a.jpg", url: "https://x/a" }],
              },
            ],
          })
        )
      )
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("수정으로 소개 글을 넣을 수 있다", async () => {
    const { id } = await createDraftProgram(testDb, providerUid, parseProgramInput(baseBody()));
    await updateProgram(
      testDb,
      id,
      providerUid,
      parseProgramInput(
        baseBody({
          introBlocks: [
            { heading: "첫 블록", body: "설명입니다." },
            { heading: "둘째 블록", body: "설명입니다." },
          ],
        })
      )
    );

    const snap = await testDb.doc(`programs/${id}`).get();
    expect(snap.get("introBlocks")).toHaveLength(2);
  });

  it("남의 프로그램 폴더 사진은 소개 블록에 넣을 수 없다", async () => {
    const { id } = await createDraftProgram(testDb, providerUid, parseProgramInput(baseBody()));
    await expect(
      updateProgram(
        testDb,
        id,
        providerUid,
        parseProgramInput(
          baseBody({
            introBlocks: [
              {
                heading: "제목",
                body: "설명",
                images: [{ path: "programs/남의프로그램/a.jpg", url: "https://x/a" }],
              },
            ],
          })
        )
      )
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("자격증 폴더 사진은 소개 블록에 넣을 수 없다", async () => {
    const { id } = await createDraftProgram(testDb, providerUid, parseProgramInput(baseBody()));
    await expect(
      updateProgram(
        testDb,
        id,
        providerUid,
        parseProgramInput(
          baseBody({
            introBlocks: [
              {
                heading: "제목",
                body: "설명",
                images: [
                  { path: `providerCertificates/${providerUid}/cert.jpg`, url: "https://x/c" },
                ],
              },
            ],
          })
        )
      )
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});

describe("게시 중인 프로그램의 소개 수정은 심사를 거친다", () => {
  async function makePublished(): Promise<string> {
    const date = kstDateString(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));
    const schedules = parseScheduleInputs(
      [{ date, startTime: "10:00", endTime: "12:00", capacity: 12 }],
      { scheduleType: "series", programCapacity: 12 }
    );
    const { id } = await createDraftProgram(
      testDb,
      providerUid,
      parseProgramInput(baseBody()),
      schedules
    );
    await testDb.doc(`programs/${id}`).update({ status: "pending_review" });
    await reviewProgram(testDb, id, parseReviewInput({ decision: "approved" }, ADMIN_UID));
    return id;
  }

  it("소개 글을 고치면 수정 승인 대기로 간다 — 손님이 이걸 믿고 결제한다", async () => {
    const id = await makePublished();
    const result = await updateProgram(
      testDb,
      id,
      providerUid,
      parseProgramInput(baseBody({ introBlocks: [{ heading: "새 소개", body: "새 설명." }] }))
    );

    expect(result.pendingEdit).toBe(true);
    expect(result.changedFields).toContain("introBlocks");
    // 게시본은 그대로입니다.
    expect((await testDb.doc(`programs/${id}`).get()).get("introBlocks")).toEqual([]);
    expect((await getPendingEdit(testDb, id))!.introBlocks).toHaveLength(1);
  });

  it("포함 사항을 고치면 수정 승인 대기로 간다", async () => {
    const id = await makePublished();
    const result = await updateProgram(
      testDb,
      id,
      providerUid,
      parseProgramInput(baseBody({ includes: { keys: ["insurance"] } }))
    );

    expect(result.pendingEdit).toBe(true);
    expect(result.changedFields).toContain("includes");
  });
});
