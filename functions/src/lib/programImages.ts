/**
 * 프로그램 사진 등록·삭제 (스키마 18-3 · 18-4 · 18-7 · 20-3).
 *
 * **업로드는 클라이언트가 Storage로 직접 하고, 기록은 서버가 합니다(18-4).**
 * 파일을 함수로 프록시하면 본문 크기·실행 시간 제한에 걸리고 비용이 파일 크기에
 * 비례해 늘어납니다. 대신 클라이언트가 `imageUrls`를 직접 쓰게 두면 **남의 파일
 * 주소나 외부 URL을 심을 수 있으므로** 기록만 서버가 맡습니다.
 *
 * 그래서 이 파일이 하는 일은 「올라온 파일이 정말 이 프로그램의 것인지」 확인하고
 * 문서에 반영하는 것입니다. 확인이 넷입니다.
 *   ① 프로그램 소유자인지
 *   ② 경로가 `programs/{programId}/` 로 시작하는지 (남의 폴더 차단)
 *   ③ 그 파일이 버킷에 실제로 있는지 (문서에 유령 주소가 남는 것 방지)
 *   ④ 주소가 그 파일을 가리키는지 (외부 URL 삽입 차단)
 *
 * **장수 제한은 규칙으로 못 셉니다** — 파일 하나하나가 개별 요청이라 총 개수를 알
 * 수 없습니다. 그래서 여기서 셉니다(18-7).
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";
import { bucket as defaultBucket } from "./firebase";
import { pendingEditPath } from "./programEdits";

/** 대표 사진 상한 (20-3). 화면과 같은 값이어야 합니다. */
export const MAX_PROGRAM_IMAGES = 5;

/**
 * 주소가 향할 수 있는 호스트.
 *
 * 배포 환경의 다운로드 주소는 `firebasestorage.googleapis.com`이고,
 * 에뮬레이터는 로컬 주소를 씁니다 — 두 환경 모두 통과해야 하므로 환경변수를 봅니다.
 * **호스트를 확인하지 않으면 공급자가 아무 외부 URL이나 심을 수 있습니다.**
 */
function allowedHosts(): string[] {
  const hosts = ["firebasestorage.googleapis.com", "storage.googleapis.com"];
  const emulator =
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? process.env.STORAGE_EMULATOR_HOST;
  if (emulator) {
    // 값이 "127.0.0.1:9199" 또는 "http://127.0.0.1:9199" 두 형태로 옵니다.
    const bare = emulator.replace(/^https?:\/\//, "");
    hosts.push(bare.split("/")[0]);
  }
  return hosts;
}

export interface ImageInput {
  /** 버킷 안 경로 — `programs/{programId}/{fileId}` */
  path: string;
  /** 화면이 그대로 쓰는 다운로드 주소 */
  url: string;
}

function parseImageInputs(value: unknown): ImageInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError("invalid-argument", "등록할 사진이 없습니다");
  }
  return value.map((item, i) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const path = typeof row.path === "string" ? row.path.trim() : "";
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (path === "" || url === "") {
      throw new AppError("invalid-argument", `${i + 1}번째 사진 정보가 올바르지 않습니다`);
    }
    return { path, url };
  });
}

/** ② 경로가 이 프로그램의 폴더인지. 상위로 빠져나가는 경로도 막습니다. */
export function assertPathBelongsToProgram(path: string, programId: string): void {
  const prefix = `programs/${programId}/`;
  if (!path.startsWith(prefix) || path.includes("..")) {
    throw new AppError("invalid-argument", "이 프로그램의 사진 경로가 아닙니다");
  }
  // 하위 폴더를 더 파고들지 못하게 — 규칙도 `{fileId}` 한 단계만 허용합니다(18-3).
  const rest = path.slice(prefix.length);
  if (rest.length === 0 || rest.includes("/")) {
    throw new AppError("invalid-argument", "사진 경로 형식이 올바르지 않습니다");
  }
}

/** ④ 주소가 그 파일을 가리키는지. 외부 URL·남의 파일 주소를 걸러냅니다. */
export function assertUrlPointsToPath(url: string, path: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("invalid-argument", "사진 주소 형식이 올바르지 않습니다");
  }
  if (!allowedHosts().includes(parsed.host)) {
    throw new AppError("invalid-argument", "허용되지 않은 사진 주소입니다");
  }
  // 다운로드 주소에는 경로가 인코딩되어 들어갑니다.
  const encoded = encodeURIComponent(path);
  if (!url.includes(encoded) && !url.includes(path)) {
    throw new AppError("invalid-argument", "사진 주소가 파일과 맞지 않습니다");
  }
}

interface Deps {
  bucket?: ReturnType<typeof defaultBucket>;
}

interface IntroBlockRow {
  heading: string;
  body: string;
  images: Array<{ path: string; url: string }>;
}

async function loadOwnedProgram(
  db: Firestore,
  programId: string,
  uid: string
): Promise<{
  imageUrls: string[];
  imagePaths: string[];
  status: string;
  introBlocks: IntroBlockRow[];
}> {
  const snap = await db.doc(`programs/${programId}`).get();
  if (!snap.exists || snap.get("providerId") !== uid) {
    // 남의 프로그램은 존재 여부도 알리지 않습니다.
    throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
  }
  return {
    imageUrls: (snap.get("imageUrls") as string[] | undefined) ?? [],
    imagePaths: (snap.get("imagePaths") as string[] | undefined) ?? [],
    status: snap.get("status") as string,
    introBlocks: (snap.get("introBlocks") as IntroBlockRow[] | undefined) ?? [],
  };
}

/**
 * 올라온 사진을 프로그램에 반영합니다 (`POST /programs/{id}/images`).
 *
 * **`imageUrls`와 `imagePaths`를 짝으로 저장합니다.** 주소만 저장하면 나중에 파일을
 * 지울 때 어느 객체인지 되짚을 수 없습니다 — 주소에서 경로를 파싱하는 방식은
 * 주소 형식이 바뀌는 순간 조용히 깨집니다.
 */
export async function addProgramImages(
  db: Firestore,
  programId: string,
  uid: string,
  body: unknown,
  deps: Deps = {}
): Promise<{ imageUrls: string[] }> {
  const program = await loadOwnedProgram(db, programId, uid);
  const inputs = parseImageInputs((body as Record<string, unknown>)?.images);
  const bucket = deps.bucket ?? defaultBucket();

  if (program.imageUrls.length + inputs.length > MAX_PROGRAM_IMAGES) {
    throw new AppError(
      "invalid-argument",
      `사진은 ${MAX_PROGRAM_IMAGES}장까지 등록할 수 있습니다(현재 ${program.imageUrls.length}장)`
    );
  }

  for (const input of inputs) {
    assertPathBelongsToProgram(input.path, programId);
    assertUrlPointsToPath(input.url, input.path);

    // ③ 버킷에 실제로 있는지. 없으면 문서에 열리지 않는 주소가 남습니다.
    const [exists] = await bucket.file(input.path).exists();
    if (!exists) {
      throw new AppError(
        "failed-precondition",
        "업로드가 완료되지 않은 사진입니다. 다시 시도해 주세요"
      );
    }
    if (program.imagePaths.includes(input.path)) {
      throw new AppError("invalid-argument", "이미 등록된 사진입니다");
    }
  }

  const imageUrls = [...program.imageUrls, ...inputs.map((i) => i.url)];
  const imagePaths = [...program.imagePaths, ...inputs.map((i) => i.path)];

  // 사진은 심사 대상이지만(v22) 여기서는 게시본에 바로 씁니다 —
  // 수정본 경로로 보내면 사진을 올려도 화면에 아무것도 안 나타나 고장으로 읽힙니다.
  // 대신 **게시 중인 프로그램의 사진 변경은 관리자 목록에 표시**해야 합니다.
  // TODO(v25): 게시 중 프로그램의 사진 교체를 수정 승인 대기열에 함께 올리기
  await db.doc(`programs/${programId}`).update({
    imageUrls,
    imagePaths,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { imageUrls };
}

/**
 * 사진 삭제 (`DELETE /programs/{id}/images`).
 *
 * **문서에서 빼고 파일도 지웁니다.** 문서에서만 빼면 아무도 참조하지 않는 파일이
 * 계속 쌓입니다(18-7). 클라이언트에 삭제를 열지 않는 이유도 같습니다 — 화면이
 * 지운 사진과 문서에 남은 주소가 어긋납니다.
 */
export async function deleteProgramImage(
  db: Firestore,
  programId: string,
  uid: string,
  body: unknown,
  deps: Deps = {}
): Promise<{ imageUrls: string[]; detachedFrom: number }> {
  const program = await loadOwnedProgram(db, programId, uid);
  const path = typeof (body as Record<string, unknown>)?.path === "string"
    ? String((body as Record<string, unknown>).path).trim()
    : "";
  if (path === "") {
    throw new AppError("invalid-argument", "지울 사진을 지정해 주세요");
  }
  assertPathBelongsToProgram(path, programId);

  const index = program.imagePaths.indexOf(path);
  if (index < 0) {
    throw new AppError("not-found", "등록되지 않은 사진입니다");
  }

  const imagePaths = program.imagePaths.filter((_, i) => i !== index);
  const imageUrls = program.imageUrls.filter((_, i) => i !== index);

  // 소개 블록에서도 함께 뺍니다 (v29 — 연쇄 정리).
  //
  // **이걸 빼면 소개 글에 깨진 이미지가 남습니다.** v28까지는 사진 목록이 둘이고
  // 서로 같은 파일을 쓸 수 없어서 이 문제가 없었는데, 목록을 하나로 합치면서
  // 한 파일을 앨범과 소개 블록이 함께 가리키게 됐습니다(20-3).
  //
  // 사진이 빠져 글만 남은 블록은 **지우지 않습니다** — 공급자가 쓴 글을 사진을
  // 지웠다는 이유로 없애면 복구할 방법이 없습니다. 글만 있는 블록은 화면이
  // 가로 전체 문단으로 그립니다.
  const introBlocks = program.introBlocks.map((block) => ({
    ...block,
    images: (block.images ?? []).filter((im) => im.path !== path),
  }));
  const detachedFrom = program.introBlocks.filter((block, i) =>
    (block.images ?? []).length !== introBlocks[i].images.length
  ).length;

  // 문서를 먼저 고칩니다. 파일 삭제가 실패해도 화면은 맞고, 남은 파일은
  // 아무도 참조하지 않는 상태라 나중에 정리할 수 있습니다. 순서를 뒤집으면
  // 파일은 사라졌는데 문서에 주소가 남아 깨진 이미지가 보입니다.
  await db.doc(`programs/${programId}`).update({
    imageUrls,
    imagePaths,
    introBlocks,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // **승인 대기 중인 수정본에서도 함께 뺍니다.** 게시본만 정리하면 수정본이
  // 지워진 파일을 계속 가리키고, 관리자가 그 수정본을 승인하는 순간 깨진
  // 이미지가 게시본에 들어갑니다 — 파일은 아래에서 실제로 지워지기 때문입니다.
  // 게시본과 같은 규칙입니다: 사진만 빼고 글은 남깁니다.
  const editRef = db.doc(pendingEditPath(programId));
  const editSnap = await editRef.get();
  if (editSnap.exists) {
    const editBlocks = (editSnap.get("introBlocks") as IntroBlockRow[] | undefined) ?? [];
    const cleaned = editBlocks.map((block) => ({
      ...block,
      images: (block.images ?? []).filter((im) => im.path !== path),
    }));
    const changed = editBlocks.some(
      (block, i) => (block.images ?? []).length !== cleaned[i].images.length
    );
    if (changed) {
      await editRef.update({ introBlocks: cleaned });
    }
  }

  const bucket = deps.bucket ?? defaultBucket();
  await bucket
    .file(path)
    .delete()
    .catch(() => undefined);

  return { imageUrls, detachedFrom };
}

/**
 * 사진 순서 바꾸기 (`PATCH /programs/{id}/images`).
 *
 * **첫 장이 대표 사진**이라(2-3) 순서가 의미를 갖습니다. 올린 뒤에 대표를 바꾸려면
 * 지우고 다시 올리는 수밖에 없으면 안 됩니다.
 */
export async function reorderProgramImages(
  db: Firestore,
  programId: string,
  uid: string,
  body: unknown
): Promise<{ imageUrls: string[] }> {
  const program = await loadOwnedProgram(db, programId, uid);
  const order = (body as Record<string, unknown>)?.paths;
  if (!Array.isArray(order)) {
    throw new AppError("invalid-argument", "순서 정보가 올바르지 않습니다");
  }

  const paths = order.map((p) => String(p));
  // 같은 집합이어야 합니다 — 빠뜨리거나 더해서 보내면 사진이 사라지거나 늘어납니다.
  if (
    paths.length !== program.imagePaths.length ||
    new Set(paths).size !== paths.length ||
    !paths.every((p) => program.imagePaths.includes(p))
  ) {
    throw new AppError("invalid-argument", "등록된 사진 목록과 맞지 않습니다");
  }

  const imageUrls = paths.map((p) => program.imageUrls[program.imagePaths.indexOf(p)]);

  await db.doc(`programs/${programId}`).update({
    imageUrls,
    imagePaths: paths,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { imageUrls };
}
