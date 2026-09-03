/**
 * 프로그램 사진 등록·삭제·순서 (스키마 18-3 · 18-4 · 20-3).
 *
 * 업로드 자체는 클라이언트가 Storage로 직접 하므로, 여기서 확인하는 것은
 * **「올라온 파일이 정말 이 프로그램의 것인지」** 입니다. 이 검사가 없으면 공급자가
 * 요청 본문에 남의 파일 경로나 외부 URL을 심을 수 있습니다(18-4).
 *
 * 버킷은 가짜로 끼워 넣습니다 — Storage 에뮬레이터를 함수 테스트에 함께 띄우면
 * 포트가 하나 더 늘고, 여기서 검증할 것은 「파일이 있는지 확인한다」는 판단뿐입니다.
 * 규칙 자체는 `tests/rules/storage.test.ts`가 Storage 에뮬레이터로 검증합니다.
 */

import { FieldValue } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  IMAGE_CACHE_CONTROL,
  MAX_PROGRAM_IMAGES,
  addProgramImages,
  deleteProgramImage,
  reorderProgramImages,
} from "../src/lib/programImages";
import { createDraftProgram, parseProgramInput } from "../src/lib/programs";
import { grantProvider } from "../src/lib/providerGrant";
import { testDb } from "./helpers";

let providerUid: string;
let otherUid: string;
let seq = 0;

/** 버킷 대역 — 존재하는 경로 집합과 삭제·메타데이터 기록만 갖고 있습니다. */
function fakeBucket(existing: Set<string>) {
  const deleted: string[] = [];
  const metadata = new Map<string, Record<string, unknown>>();
  return {
    deleted,
    metadata,
    bucket: {
      file(path: string) {
        return {
          exists: async () => [existing.has(path)] as [boolean],
          setMetadata: async (m: Record<string, unknown>) => {
            if (!existing.has(path)) throw new Error("없는 파일");
            metadata.set(path, { ...(metadata.get(path) ?? {}), ...m });
          },
          delete: async () => {
            if (!existing.has(path)) throw new Error("없는 파일");
            existing.delete(path);
            deleted.push(path);
          },
        };
      },
    } as never,
  };
}

async function makeUser(): Promise<string> {
  seq += 1;
  const uid = `img-provider-${Date.now()}-${seq}`;
  await testDb.doc(`users/${uid}`).set({
    role: "consumer",
    authProvider: "naver",
    name: "테스트",
    status: "active",
  });
  await grantProvider({ uid, displayName: "숲협동조합" }, { db: testDb });
  return uid;
}

function validInput() {
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
  });
}

/** 배포 환경의 다운로드 주소 형태 */
function downloadUrl(path: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/demo-foom.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=abc`;
}

let programId: string;

beforeAll(async () => {
  providerUid = await makeUser();
  otherUid = await makeUser();
});

beforeEach(async () => {
  const { id } = await createDraftProgram(testDb, providerUid, validInput());
  programId = id;
});

describe("등록 직후 상태", () => {
  it("사진 필드가 빈 배열로 시작한다", async () => {
    const snap = await testDb.doc(`programs/${programId}`).get();
    expect(snap.get("imageUrls")).toEqual([]);
    expect(snap.get("imagePaths")).toEqual([]);
  });

  it("요청 본문으로 보낸 imageUrls는 버려진다 — 사진은 별도 경로로만 기록한다", () => {
    const parsed = parseProgramInput({
      ...(validInput() as unknown as Record<string, unknown>),
      imageUrls: ["https://evil.example.com/a.jpg"],
    }) as unknown as Record<string, unknown>;
    expect(parsed.imageUrls).toBeUndefined();
  });
});

describe("addProgramImages — 올라온 파일이 이 프로그램의 것인지", () => {
  it("정상 등록", async () => {
    const path = `programs/${programId}/a1.jpg`;
    const { bucket } = fakeBucket(new Set([path]));

    const result = await addProgramImages(
      testDb,
      programId,
      providerUid,
      { images: [{ path, url: downloadUrl(path) }] },
      { bucket }
    );

    expect(result.imageUrls).toHaveLength(1);
    const snap = await testDb.doc(`programs/${programId}`).get();
    expect(snap.get("imagePaths")).toEqual([path]);
  });

  it("남의 프로그램 폴더 경로는 거부한다", async () => {
    const path = "programs/다른프로그램/a1.jpg";
    const { bucket } = fakeBucket(new Set([path]));

    await expect(
      addProgramImages(
        testDb,
        programId,
        providerUid,
        { images: [{ path, url: downloadUrl(path) }] },
        { bucket }
      )
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("자격증 폴더 경로는 거부한다 — 비공개 파일을 공개 목록에 끌어올 수 없다", async () => {
    const path = `providerCertificates/${providerUid}/cert.jpg`;
    const { bucket } = fakeBucket(new Set([path]));

    await expect(
      addProgramImages(
        testDb,
        programId,
        providerUid,
        { images: [{ path, url: downloadUrl(path) }] },
        { bucket }
      )
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("상위로 빠져나가는 경로는 거부한다", async () => {
    const path = `programs/${programId}/../../providerCertificates/x/cert.jpg`;
    const { bucket } = fakeBucket(new Set([path]));

    await expect(
      addProgramImages(
        testDb,
        programId,
        providerUid,
        { images: [{ path, url: downloadUrl(path) }] },
        { bucket }
      )
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("외부 URL은 거부한다 — 경로는 맞아도 주소가 남의 서버면 안 된다", async () => {
    const path = `programs/${programId}/a1.jpg`;
    const { bucket } = fakeBucket(new Set([path]));

    await expect(
      addProgramImages(
        testDb,
        programId,
        providerUid,
        { images: [{ path, url: `https://evil.example.com/${encodeURIComponent(path)}` }] },
        { bucket }
      )
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("주소가 다른 파일을 가리키면 거부한다", async () => {
    const path = `programs/${programId}/a1.jpg`;
    const other = `programs/${programId}/b2.jpg`;
    const { bucket } = fakeBucket(new Set([path, other]));

    await expect(
      addProgramImages(
        testDb,
        programId,
        providerUid,
        { images: [{ path, url: downloadUrl(other) }] },
        { bucket }
      )
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("버킷에 없는 파일은 거부한다 — 문서에 열리지 않는 주소가 남는다", async () => {
    const path = `programs/${programId}/a1.jpg`;
    const { bucket } = fakeBucket(new Set());

    await expect(
      addProgramImages(
        testDb,
        programId,
        providerUid,
        { images: [{ path, url: downloadUrl(path) }] },
        { bucket }
      )
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("남의 프로그램에는 등록할 수 없다 — 존재 여부도 알리지 않는다", async () => {
    const path = `programs/${programId}/a1.jpg`;
    const { bucket } = fakeBucket(new Set([path]));

    await expect(
      addProgramImages(
        testDb,
        programId,
        otherUid,
        { images: [{ path, url: downloadUrl(path) }] },
        { bucket }
      )
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("같은 파일을 두 번 등록할 수 없다", async () => {
    const path = `programs/${programId}/a1.jpg`;
    const { bucket } = fakeBucket(new Set([path]));
    const body = { images: [{ path, url: downloadUrl(path) }] };

    await addProgramImages(testDb, programId, providerUid, body, { bucket });
    await expect(
      addProgramImages(testDb, programId, providerUid, body, { bucket })
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it(`${MAX_PROGRAM_IMAGES}장을 넘기면 거부한다 — 규칙으로는 장수를 셀 수 없다`, async () => {
    const paths = Array.from(
      { length: MAX_PROGRAM_IMAGES + 1 },
      (_, i) => `programs/${programId}/p${i}.jpg`
    );
    const { bucket } = fakeBucket(new Set(paths));

    await expect(
      addProgramImages(
        testDb,
        programId,
        providerUid,
        { images: paths.map((p) => ({ path: p, url: downloadUrl(p) })) },
        { bucket }
      )
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("빈 목록은 거부한다", async () => {
    const { bucket } = fakeBucket(new Set());
    await expect(
      addProgramImages(testDb, programId, providerUid, { images: [] }, { bucket })
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});

/**
 * 사진 삭제의 연쇄 정리 (v29).
 *
 * 사진 목록을 하나로 합치면서 한 파일을 앨범과 소개 블록이 함께 가리키게 됐습니다.
 * 지울 때 소개 블록에서 빼주지 않으면 **소개 글에 깨진 이미지가 남습니다.**
 */
describe("deleteProgramImage — 소개 블록 연쇄 정리", () => {
  async function withAlbumAndIntro() {
    const a = `programs/${programId}/a.jpg`;
    const b = `programs/${programId}/b.jpg`;
    const fake = fakeBucket(new Set([a, b]));
    await addProgramImages(
      testDb,
      programId,
      providerUid,
      {
        images: [
          { path: a, url: downloadUrl(a) },
          { path: b, url: downloadUrl(b) },
        ],
      },
      { bucket: fake.bucket }
    );
    await testDb.doc(`programs/${programId}`).update({
      introBlocks: [
        { heading: "첫째", body: "설명입니다", images: [{ path: a, url: downloadUrl(a) }] },
        { heading: "둘째", body: "설명입니다", images: [{ path: b, url: downloadUrl(b) }] },
      ],
    });
    return { a, b, fake };
  }

  it("지운 사진을 쓰던 블록에서 함께 빠진다", async () => {
    const { a, b, fake } = await withAlbumAndIntro();

    const result = await deleteProgramImage(
      testDb,
      programId,
      providerUid,
      { path: a },
      { bucket: fake.bucket }
    );

    expect(result.detachedFrom).toBe(1);
    const snap = await testDb.doc(`programs/${programId}`).get();
    const blocks = snap.get("introBlocks");
    expect(blocks[0].images).toEqual([]);
    // 다른 블록은 건드리지 않습니다
    expect(blocks[1].images).toEqual([{ path: b, url: downloadUrl(b) }]);
  });

  it("사진이 빠져도 그 블록의 글은 남는다", async () => {
    const { a, fake } = await withAlbumAndIntro();
    await deleteProgramImage(testDb, programId, providerUid, { path: a }, { bucket: fake.bucket });

    const snap = await testDb.doc(`programs/${programId}`).get();
    // 공급자가 쓴 글을 사진을 지웠다는 이유로 없애면 복구할 방법이 없습니다.
    expect(snap.get("introBlocks")[0].heading).toBe("첫째");
    expect(snap.get("introBlocks")[0].body).toBe("설명입니다");
  });

  it("승인 대기 중인 수정본의 소개 블록에서도 함께 빠진다", async () => {
    const { a, b, fake } = await withAlbumAndIntro();
    // 수정본이 지워질 사진(a)을 가리키는 상태를 만듭니다 — 게시본만 정리하면
    // 이 수정본을 승인하는 순간 깨진 이미지가 게시본에 들어갑니다.
    await testDb.doc(`programs/${programId}/pendingEdit/current`).set({
      introBlocks: [
        { heading: "수정 첫째", body: "고친 설명", images: [{ path: a, url: downloadUrl(a) }] },
        { heading: "수정 둘째", body: "고친 설명", images: [{ path: b, url: downloadUrl(b) }] },
      ],
      changedFields: ["introBlocks"],
      submittedBy: providerUid,
    });

    await deleteProgramImage(testDb, programId, providerUid, { path: a }, { bucket: fake.bucket });

    const edit = await testDb.doc(`programs/${programId}/pendingEdit/current`).get();
    const blocks = edit.get("introBlocks");
    expect(blocks[0].images).toEqual([]);
    // 글은 남고, 다른 사진을 쓰는 블록은 건드리지 않습니다
    expect(blocks[0].heading).toBe("수정 첫째");
    expect(blocks[1].images).toEqual([{ path: b, url: downloadUrl(b) }]);
  });

  it("수정본이 없으면 삭제가 그대로 성공한다", async () => {
    const { a, fake } = await withAlbumAndIntro();
    const result = await deleteProgramImage(
      testDb,
      programId,
      providerUid,
      { path: a },
      { bucket: fake.bucket }
    );
    expect(result.detachedFrom).toBe(1);
  });

  it("소개 블록에 쓰지 않는 사진을 지우면 블록은 그대로다", async () => {
    const { b, fake } = await withAlbumAndIntro();
    await testDb.doc(`programs/${programId}`).update({
      introBlocks: [{ heading: "글만", body: "사진 없는 블록", images: [] }],
    });

    const result = await deleteProgramImage(
      testDb,
      programId,
      providerUid,
      { path: b },
      { bucket: fake.bucket }
    );

    expect(result.detachedFrom).toBe(0);
    const snap = await testDb.doc(`programs/${programId}`).get();
    expect(snap.get("introBlocks")).toEqual([
      { heading: "글만", body: "사진 없는 블록", images: [] },
    ]);
  });
});

describe("deleteProgramImage", () => {
  it("문서에서 빼고 파일도 지운다", async () => {
    const path = `programs/${programId}/a1.jpg`;
    const fake = fakeBucket(new Set([path]));
    await addProgramImages(
      testDb,
      programId,
      providerUid,
      { images: [{ path, url: downloadUrl(path) }] },
      { bucket: fake.bucket }
    );

    const result = await deleteProgramImage(
      testDb,
      programId,
      providerUid,
      { path },
      { bucket: fake.bucket }
    );

    expect(result.imageUrls).toEqual([]);
    expect(fake.deleted).toEqual([path]);
    const snap = await testDb.doc(`programs/${programId}`).get();
    expect(snap.get("imagePaths")).toEqual([]);
  });

  it("주소와 경로가 짝으로 함께 빠진다 — 어긋나면 깨진 이미지가 보인다", async () => {
    const a = `programs/${programId}/a.jpg`;
    const b = `programs/${programId}/b.jpg`;
    const fake = fakeBucket(new Set([a, b]));
    await addProgramImages(
      testDb,
      programId,
      providerUid,
      {
        images: [
          { path: a, url: downloadUrl(a) },
          { path: b, url: downloadUrl(b) },
        ],
      },
      { bucket: fake.bucket }
    );

    await deleteProgramImage(testDb, programId, providerUid, { path: a }, { bucket: fake.bucket });

    const snap = await testDb.doc(`programs/${programId}`).get();
    expect(snap.get("imagePaths")).toEqual([b]);
    expect(snap.get("imageUrls")).toEqual([downloadUrl(b)]);
  });

  it("등록되지 않은 사진은 not-found", async () => {
    const fake = fakeBucket(new Set());
    await expect(
      deleteProgramImage(
        testDb,
        programId,
        providerUid,
        { path: `programs/${programId}/없는파일.jpg` },
        { bucket: fake.bucket }
      )
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("남의 프로그램 사진은 지울 수 없다", async () => {
    const path = `programs/${programId}/a1.jpg`;
    const fake = fakeBucket(new Set([path]));
    await addProgramImages(
      testDb,
      programId,
      providerUid,
      { images: [{ path, url: downloadUrl(path) }] },
      { bucket: fake.bucket }
    );

    await expect(
      deleteProgramImage(testDb, programId, otherUid, { path }, { bucket: fake.bucket })
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("reorderProgramImages — 첫 장이 대표 사진", () => {
  async function withThree() {
    const paths = ["a", "b", "c"].map((n) => `programs/${programId}/${n}.jpg`);
    const fake = fakeBucket(new Set(paths));
    await addProgramImages(
      testDb,
      programId,
      providerUid,
      { images: paths.map((p) => ({ path: p, url: downloadUrl(p) })) },
      { bucket: fake.bucket }
    );
    return paths;
  }

  it("순서를 바꾸면 주소도 같은 순서로 따라온다", async () => {
    const [a, b, c] = await withThree();

    const result = await reorderProgramImages(testDb, programId, providerUid, {
      paths: [c, a, b],
    });

    expect(result.imageUrls).toEqual([downloadUrl(c), downloadUrl(a), downloadUrl(b)]);
    const snap = await testDb.doc(`programs/${programId}`).get();
    expect(snap.get("imagePaths")).toEqual([c, a, b]);
  });

  it("빠뜨리고 보내면 거부한다 — 사진이 조용히 사라진다", async () => {
    const [a, b] = await withThree();
    await expect(
      reorderProgramImages(testDb, programId, providerUid, { paths: [a, b] })
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("없는 경로를 끼워 보내면 거부한다", async () => {
    const [a, b] = await withThree();
    await expect(
      reorderProgramImages(testDb, programId, providerUid, {
        paths: [a, b, `programs/${programId}/침입.jpg`],
      })
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("중복을 보내면 거부한다", async () => {
    const [a] = await withThree();
    await expect(
      reorderProgramImages(testDb, programId, providerUid, { paths: [a, a, a] })
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 목록 카드용 작은 사진 (20-6, 2026-09-03)
 *
 * 사진 한 장을 올리면 파일이 **둘** 올라갑니다 — 상세용 큰 것과 목록용 작은 것.
 * 서버가 확인할 것은 큰 사진과 같습니다(경로 소유·주소 일치·실제 존재).
 *
 * **가장 중요한 것은 「자리가 밀리지 않는가」입니다.** 두 목록은 번호로 짝을
 * 이루는데, 작은 판이 없는 옛 사진이 섞이면 목록 길이가 달라집니다. 그대로 두면
 * 삭제·순서 변경에서 한 칸씩 밀려 **목록 카드에 엉뚱한 사진**이 뜹니다 —
 * 에러가 나지 않고 「사진이 잘못 나오는」 고장이라 알아차리기 어렵습니다.
 * ──────────────────────────────────────────────────────────────────────── */

describe("작은 사진(썸네일)", () => {
  /** 큰 것과 작은 것을 한 쌍으로 만들어 줍니다 */
  function pair(name: string) {
    const path = `programs/${programId}/${name}.jpg`;
    const thumbPath = `programs/${programId}/t_${name}.jpg`;
    return {
      path,
      thumbPath,
      input: { path, url: downloadUrl(path), thumbPath, thumbUrl: downloadUrl(thumbPath) },
    };
  }

  it("기록할 때 큰 사진·작은 사진 모두에 1년 캐시를 붙인다 — 안 붙으면 볼 때마다 다시 받는다", async () => {
    const a = pair("a1");
    const fake = fakeBucket(new Set([a.path, a.thumbPath]));

    await addProgramImages(
      testDb,
      programId,
      providerUid,
      { images: [a.input] },
      { bucket: fake.bucket }
    );

    expect(fake.metadata.get(a.path)?.cacheControl).toBe(IMAGE_CACHE_CONTROL);
    expect(fake.metadata.get(a.thumbPath)?.cacheControl).toBe(IMAGE_CACHE_CONTROL);
    expect(IMAGE_CACHE_CONTROL).toMatch(/max-age=31536000/);
  });

  it("큰 사진과 짝으로 저장된다", async () => {
    const a = pair("a1");
    const { bucket } = fakeBucket(new Set([a.path, a.thumbPath]));

    await addProgramImages(testDb, programId, providerUid, { images: [a.input] }, { bucket });

    const snap = await testDb.doc(`programs/${programId}`).get();
    expect(snap.get("imagePaths")).toEqual([a.path]);
    expect(snap.get("thumbPaths")).toEqual([a.thumbPath]);
    expect(snap.get("thumbUrls")).toEqual([downloadUrl(a.thumbPath)]);
  });

  it("작은 사진을 안 보내도 등록된다 — 예전 화면을 쓰는 사람이 갑자기 실패하면 안 된다", async () => {
    const a = pair("a1");
    const { bucket } = fakeBucket(new Set([a.path]));

    await addProgramImages(
      testDb,
      programId,
      providerUid,
      { images: [{ path: a.path, url: downloadUrl(a.path) }] },
      { bucket }
    );

    const snap = await testDb.doc(`programs/${programId}`).get();
    // 자리는 채워둡니다 — 빈 문자열이 「작은 것이 없다」는 뜻입니다.
    expect(snap.get("thumbPaths")).toEqual([""]);
    expect(snap.get("thumbUrls")).toEqual([""]);
  });

  it("경로만 보내고 주소를 빠뜨리면 거부한다", async () => {
    const a = pair("a1");
    const { bucket } = fakeBucket(new Set([a.path, a.thumbPath]));

    await expect(
      addProgramImages(
        testDb,
        programId,
        providerUid,
        { images: [{ path: a.path, url: downloadUrl(a.path), thumbPath: a.thumbPath }] },
        { bucket }
      )
    ).rejects.toThrow();
  });

  it("남의 프로그램 폴더에 있는 작은 사진은 거부한다", async () => {
    const a = pair("a1");
    const stolen = `programs/someone-else/t_a1.jpg`;
    const { bucket } = fakeBucket(new Set([a.path, stolen]));

    await expect(
      addProgramImages(
        testDb,
        programId,
        providerUid,
        {
          images: [
            { path: a.path, url: downloadUrl(a.path), thumbPath: stolen, thumbUrl: downloadUrl(stolen) },
          ],
        },
        { bucket }
      )
    ).rejects.toThrow();
  });

  it("작은 사진 주소가 외부 서버면 거부한다 — 목록은 가장 많이 보이는 자리다", async () => {
    const a = pair("a1");
    const { bucket } = fakeBucket(new Set([a.path, a.thumbPath]));

    await expect(
      addProgramImages(
        testDb,
        programId,
        providerUid,
        {
          images: [
            {
              path: a.path,
              url: downloadUrl(a.path),
              thumbPath: a.thumbPath,
              thumbUrl: "https://evil.example.com/t_a1.jpg",
            },
          ],
        },
        { bucket }
      )
    ).rejects.toThrow();
  });

  it("버킷에 없는 작은 사진은 거부한다 — 목록에 열리지 않는 주소가 남는다", async () => {
    const a = pair("a1");
    const { bucket } = fakeBucket(new Set([a.path])); // 작은 것만 빠진 상태

    await expect(
      addProgramImages(testDb, programId, providerUid, { images: [a.input] }, { bucket })
    ).rejects.toThrow();
  });

  it("사진을 지우면 작은 사진 파일도 함께 지워진다", async () => {
    const a = pair("a1");
    const fake = fakeBucket(new Set([a.path, a.thumbPath]));
    await addProgramImages(
      testDb,
      programId,
      providerUid,
      { images: [a.input] },
      { bucket: fake.bucket }
    );

    await deleteProgramImage(
      testDb,
      programId,
      providerUid,
      { path: a.path },
      { bucket: fake.bucket }
    );

    expect(fake.deleted).toContain(a.path);
    expect(fake.deleted).toContain(a.thumbPath);
    const snap = await testDb.doc(`programs/${programId}`).get();
    expect(snap.get("thumbPaths")).toEqual([]);
    expect(snap.get("thumbUrls")).toEqual([]);
  });

  it("작은 사진이 있는 것과 없는 것이 섞여도 자리가 밀리지 않는다", async () => {
    const a = pair("a1"); // 작은 것 없이 등록 (예전에 올린 사진)
    const b = pair("b1"); // 작은 것과 함께 등록
    const fake = fakeBucket(new Set([a.path, b.path, b.thumbPath]));

    await addProgramImages(
      testDb,
      programId,
      providerUid,
      { images: [{ path: a.path, url: downloadUrl(a.path) }, b.input] },
      { bucket: fake.bucket }
    );

    let snap = await testDb.doc(`programs/${programId}`).get();
    expect(snap.get("thumbPaths")).toEqual(["", b.thumbPath]);

    // 순서를 뒤집으면 작은 사진도 같이 따라와야 합니다.
    await reorderProgramImages(testDb, programId, providerUid, { paths: [b.path, a.path] });
    snap = await testDb.doc(`programs/${programId}`).get();
    expect(snap.get("imagePaths")).toEqual([b.path, a.path]);
    expect(snap.get("thumbPaths")).toEqual([b.thumbPath, ""]);

    // 앞의 것을 지워도 남은 사진의 짝이 어긋나면 안 됩니다.
    await deleteProgramImage(
      testDb,
      programId,
      providerUid,
      { path: b.path },
      { bucket: fake.bucket }
    );
    snap = await testDb.doc(`programs/${programId}`).get();
    expect(snap.get("imagePaths")).toEqual([a.path]);
    expect(snap.get("thumbPaths")).toEqual([""]);
  });

  it("작은 사진 목록이 아예 없던 옛 프로그램도 순서를 바꿀 수 있다", async () => {
    // 2026-09-03 이전에 저장된 문서에는 thumbPaths 필드 자체가 없습니다.
    const a = pair("a1");
    const b = pair("b1");
    await testDb.doc(`programs/${programId}`).update({
      imagePaths: [a.path, b.path],
      imageUrls: [downloadUrl(a.path), downloadUrl(b.path)],
      thumbPaths: FieldValue.delete(),
      thumbUrls: FieldValue.delete(),
    });

    await reorderProgramImages(testDb, programId, providerUid, { paths: [b.path, a.path] });

    const snap = await testDb.doc(`programs/${programId}`).get();
    expect(snap.get("imagePaths")).toEqual([b.path, a.path]);
    expect(snap.get("thumbPaths")).toEqual(["", ""]);
  });
});
