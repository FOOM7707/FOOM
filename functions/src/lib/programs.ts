/**
 * 프로그램 등록·조회 (스키마 5번 · 2-3).
 *
 * 클라이언트는 `programs`를 직접 만들지 못합니다(6-1 — 규칙을 명시하지 않아 기본
 * 거부). 생성을 열면 `status='published'`로 심사를 우회할 수 있기 때문입니다.
 * 따라서 이 경로가 유일한 생성 통로이고, **여기서 status와 파생 필드를 서버가
 * 정합니다.** 클라이언트가 보낸 status·파생 필드 값은 전부 무시합니다.
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";
import { deriveProgramFields } from "./programDerived";
import { getPendingEdit, savePendingEdit } from "./programEdits";
import {
  introBlockPaths,
  parseProgramContent,
  type ProgramContentInput,
} from "./programContent";
import { assertPathBelongsToProgram, assertUrlPointsToPath } from "./programImages";
import { bucket as defaultBucket } from "./firebase";
import {
  assertSchedulableForReview,
  buildScheduleDocs,
  listSchedules,
  syncProgramScheduleDates,
  writeScheduleDocs,
  type ScheduleInput,
} from "./schedules";

export const PROGRAM_CATEGORIES = [
  "숲해설",
  "유아숲체험",
  "산림치유",
  "숲길등산",
  "단체·기업",
] as const;
export type ProgramCategory = (typeof PROGRAM_CATEGORIES)[number];

export const SCHEDULE_TYPES = ["single", "weekly", "open", "series"] as const;
export const RAIN_ALTERNATIVES = ["indoor", "reschedule", "none"] as const;

export const QUALIFICATION_TYPES = [
  "forest_interpreter",
  "infant_forest_instructor",
  "mountain_trail_guide",
  "forest_healing_instructor_1",
  "forest_healing_instructor_2",
] as const;

/**
 * 공급자가 입력하는 필드만 받습니다 — 6-1 허용목록과 같은 집합입니다.
 * 여기 없는 필드는 요청 본문에 있어도 버립니다.
 *
 * **`imageUrls`는 여기 없습니다(v25).** 사진은 업로드 후 별도 경로
 * (`POST /programs/{id}/images`)로만 기록합니다 — 요청 본문으로 받으면
 * ① 남의 파일 주소나 외부 URL을 심을 수 있고(18-4) ② 수정 화면이 사진을 보내지
 * 않는 순간 **기존 사진이 전부 지워집니다**(이 함수의 결과를 그대로 덮어쓰므로).
 */
export interface ProgramDraftInput {
  title: string;
  description: string;
  category: string;
  qualificationType: string;
  location: { address: string; lat: number | null; lng: number | null };
  price: number;
  capacity: number;
  minCapacity: number;
  scheduleType: string;
  availableFrom: string | null;
  availableUntil: string | null;
  barrierFree: boolean;
  targetAgeMin: number | null;
  targetAgeMax: number | null;
  walkingDistanceM: number | null;
  rainAlternative: string;
  /**
   * 포함·불포함·준비물과 소개 블록 (20-2·20-4).
   *
   * **파생 필드가 아니라 공급자 입력값이므로 이 집합에 포함합니다.** 여기 두면
   * `changedReviewFields`가 자동으로 비교 대상에 넣어, 게시 중인 프로그램의
   * 소개 문구가 바뀌면 수정 승인 대기로 갑니다(v23) — 상세 소개는 손님이 이걸
   * 믿고 결제하는 값이라 심사를 거쳐야 합니다.
   */
  includes: ProgramContentInput["includes"];
  excludes: ProgramContentInput["excludes"];
  preparations: ProgramContentInput["preparations"];
  introBlocks: ProgramContentInput["introBlocks"];
}

function str(value: unknown, field: string, { max = 5000 } = {}): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("invalid-argument", `${field}을(를) 입력해 주세요`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new AppError("invalid-argument", `${field}이(가) 너무 깁니다`);
  }
  return trimmed;
}

function num(value: unknown, field: string, { min = 0 } = {}): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new AppError("invalid-argument", `${field}은(는) 숫자여야 합니다`);
  }
  if (parsed < min) {
    throw new AppError("invalid-argument", `${field}은(는) ${min} 이상이어야 합니다`);
  }
  return parsed;
}

function optionalNum(value: unknown, field: string, { min = 0 } = {}): number | null {
  if (value == null || value === "") return null;
  return num(value, field, { min });
}

function oneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new AppError("invalid-argument", `${field} 값이 올바르지 않습니다`);
  }
  return value;
}

/** 요청 본문 → 입력 필드. 허용목록 밖의 값은 여기서 사라집니다. */
export function parseProgramInput(body: unknown): ProgramDraftInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const location = (b.location ?? {}) as Record<string, unknown>;

  const capacity = num(b.capacity, "최대 정원", { min: 1 });
  const minCapacity = num(b.minCapacity, "최소 진행 인원", { min: 1 });
  if (minCapacity > capacity) {
    throw new AppError("invalid-argument", "최소 진행 인원이 최대 정원보다 클 수 없습니다");
  }

  const targetAgeMin = optionalNum(b.targetAgeMin, "참가 가능 연령(최소)");
  const targetAgeMax = optionalNum(b.targetAgeMax, "참가 가능 연령(최대)");
  if (targetAgeMin != null && targetAgeMax != null && targetAgeMin > targetAgeMax) {
    throw new AppError("invalid-argument", "참가 가능 연령의 최소값이 최대값보다 큽니다");
  }

  const scheduleType = oneOf(b.scheduleType, SCHEDULE_TYPES, "일정 유형");

  return {
    title: str(b.title, "제목", { max: 100 }),
    description: str(b.description, "설명"),
    category: oneOf(b.category, PROGRAM_CATEGORIES, "카테고리"),
    qualificationType: oneOf(b.qualificationType, QUALIFICATION_TYPES, "자격 유형"),
    location: {
      address: str(location.address, "주소", { max: 200 }),
      // 지오코딩(카카오맵) 연동 전이라 좌표는 선택값입니다.
      lat: optionalNum(location.lat, "위도", { min: -90 }),
      lng: optionalNum(location.lng, "경도", { min: -180 }),
    },
    price: num(b.price, "가격"),
    capacity,
    minCapacity,
    scheduleType,
    // availableFrom/Until은 open 타입 전용입니다(2-3). 다른 타입은 null로 못박습니다.
    availableFrom: scheduleType === "open" ? ((b.availableFrom as string) ?? null) : null,
    availableUntil: scheduleType === "open" ? ((b.availableUntil as string) ?? null) : null,
    barrierFree: b.barrierFree === true,
    targetAgeMin,
    targetAgeMax,
    walkingDistanceM: optionalNum(b.walkingDistanceM, "보행거리"),
    rainAlternative: oneOf(b.rainAlternative, RAIN_ALTERNATIVES, "우천 시 대체 방식"),
    ...parseProgramContent(b),
  };
}

/** 호출자가 공급자인지 확인합니다. */
async function assertProvider(db: Firestore, uid: string): Promise<void> {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) {
    throw new AppError("failed-precondition", "가입 정보를 찾을 수 없습니다");
  }
  if (snap.get("status") !== "active") {
    throw new AppError("permission-denied", "이용이 제한된 계정입니다");
  }
  if (snap.get("role") !== "provider") {
    throw new AppError(
      "permission-denied",
      "공급자만 프로그램을 등록할 수 있습니다. 공급자 등록을 먼저 진행해 주세요."
    );
  }
}

/**
 * 소개 블록에 들어 있는 사진이 정말 이 프로그램의 것인지 확인합니다.
 *
 * 대표 사진과 같은 검사입니다(18-4) — 경로가 이 프로그램 폴더 안인지, 주소가 그
 * 파일을 가리키는지, 버킷에 실제로 있는지. **검사하지 않으면 소개 블록에 자격증
 * 파일이나 외부 URL을 끼워 넣을 수 있습니다.**
 *
 * 대표 사진과 **같은 파일을 쓰지 못하게** 막습니다 — 한쪽에서 지우면 파일이
 * 사라져 다른 쪽이 깨진 이미지가 됩니다.
 */
async function assertIntroImagesBelongToProgram(
  db: Firestore,
  programId: string,
  input: ProgramDraftInput
): Promise<void> {
  const paths = introBlockPaths(input.introBlocks);
  if (paths.length === 0) return;

  if (new Set(paths).size !== paths.length) {
    throw new AppError("invalid-argument", "같은 사진을 소개 블록에 여러 번 넣을 수 없습니다");
  }

  const snap = await db.doc(`programs/${programId}`).get();
  const coverPaths = (snap.get("imagePaths") as string[] | undefined) ?? [];

  // 경로·주소 검사를 **먼저 전부** 끝냅니다. 버킷 접근보다 앞에 둬야 하는 이유:
  // ① 잘못된 경로는 버킷에 물어볼 필요가 없고 ② 버킷 준비가 안 된 환경에서
  // 검사 자체가 저장소 오류로 뒤덮여 원인이 드러나지 않습니다.
  for (const block of input.introBlocks) {
    for (const image of block.images) {
      assertPathBelongsToProgram(image.path, programId);
      assertUrlPointsToPath(image.url, image.path);
      if (coverPaths.includes(image.path)) {
        throw new AppError(
          "invalid-argument",
          "대표 사진으로 쓰고 있는 사진은 소개 블록에 넣을 수 없습니다. 따로 올려 주세요"
        );
      }
    }
  }

  const bucket = defaultBucket();
  for (const path of paths) {
    const [exists] = await bucket.file(path).exists();
    if (!exists) {
      throw new AppError(
        "failed-precondition",
        "업로드가 완료되지 않은 사진이 있습니다. 다시 시도해 주세요"
      );
    }
  }
}

/**
 * draft 생성. 회차(날짜)를 함께 받습니다.
 *
 * 회차를 별도 요청으로 분리하지 않는 이유: 등록 화면이 한 번에 저장하는 구조인데
 * 두 번 호출하면 프로그램만 저장되고 날짜가 빠진 중간 상태가 생깁니다. 그 상태는
 * 화면상 정상이라 공급자가 알아차리지 못합니다.
 */
export async function createDraftProgram(
  db: Firestore,
  providerId: string,
  input: ProgramDraftInput,
  scheduleInputs: ScheduleInput[] = []
): Promise<{ id: string }> {
  await assertProvider(db, providerId);

  let derived;
  try {
    derived = deriveProgramFields({
      category: input.category,
      address: input.location.address,
      targetAgeMin: input.targetAgeMin,
      targetAgeMax: input.targetAgeMax,
      walkingDistanceM: input.walkingDistanceM,
    });
  } catch (err) {
    // 주소에서 시도를 못 뽑은 경우 — 저장을 거부합니다(4번).
    throw new AppError("invalid-argument", err instanceof Error ? err.message : "주소 오류");
  }

  // 사진 경로에는 programId가 들어가는데(18-3) 등록 시점에는 아직 없습니다.
  // 그래서 사진이 붙은 소개 블록은 등록 단계에서 받을 수 없습니다 — 저장 후
  // 수정 화면에서 넣습니다. 화면도 같은 순서로 안내합니다.
  if (introBlockPaths(input.introBlocks).length > 0) {
    throw new AppError(
      "failed-precondition",
      "소개 블록 사진은 프로그램을 저장한 뒤에 넣을 수 있습니다"
    );
  }

  const ref = db.collection("programs").doc();
  const batch = db.batch();
  batch.set(ref, {
    providerId,
    // 포함·불포함·준비물·소개 블록도 여기 들어 있습니다 — `parseProgramInput`이
    // 요청에 없어도 빈 값으로 채우므로 필드가 빠지는 일은 없습니다.
    // (필드가 없으면 화면이 undefined를 만나 목록 렌더링에서 터집니다.)
    ...input,
    ...derived,
    status: "draft",

    // 심사 감사로그 (2-3, v10)
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,

    // 사진은 별도 경로로만 기록합니다(18-4). 빈 배열로 시작합니다.
    // `imagePaths`는 주소와 짝을 이루는 버킷 경로입니다 — 주소만 저장하면
    // 나중에 파일을 지울 때 어느 객체인지 되짚을 수 없습니다.
    imageUrls: [],
    imagePaths: [],

    // 파생 필드 초기값 — 명시적으로 넣습니다.
    // Firestore는 인덱스에 쓰인 필드가 없는 문서를 색인하지 않으므로,
    // 필드를 아예 만들지 않으면 그 프로그램이 검색에서 통째로 사라집니다(2-3).
    scheduleDates: [],
    nextScheduleAt: null,
    lastScheduleAt: null,
    publishedAt: null, // 최초 게시 시각. 신규순 정렬 기준이라 승인 시 채웁니다
    ratingAvg: 0,
    ratingCount: 0,
    bookingCount30d: 0,

    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (scheduleInputs.length > 0) {
    writeScheduleDocs(
      db,
      ref.id,
      buildScheduleDocs(scheduleInputs, {
        programId: ref.id,
        // 상위 status 사본입니다. 게시·숨김 시 서버가 하위 회차를 일괄 갱신합니다(2-4).
        programStatus: "draft",
        type: input.scheduleType,
      }),
      batch
    );
  }

  await batch.commit();

  // 날짜 요약은 회차를 저장한 뒤 이 함수로만 계산합니다 — 등록 경로가 직접
  // scheduleDates를 계산하면 추가·삭제 경로와 규칙이 갈라집니다(17-2).
  if (scheduleInputs.length > 0) {
    await syncProgramScheduleDates(db, ref.id);
  }

  return { id: ref.id };
}

export interface ProgramReadOptions {
  /** 로그인한 경우의 uid */
  uid?: string;
  isAdmin?: boolean;
}

export async function getProgram(
  db: Firestore,
  id: string,
  options: ProgramReadOptions
): Promise<Record<string, unknown>> {
  const snap = await db.doc(`programs/${id}`).get();
  if (!snap.exists) {
    throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
  }

  const data = snap.data() as Record<string, unknown>;
  const isOwner = options.uid != null && data.providerId === options.uid;

  if (data.status !== "published" && !isOwner && !options.isAdmin) {
    // 존재 여부 자체를 알려주지 않습니다 — 심사 중인 프로그램의 존재가
    // 노출되면 반려 사유(reviewNote)를 추측할 단서가 됩니다.
    throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
  }

  // 반려 사유는 소유자와 관리자에게만 내려보냅니다.
  if (!isOwner && !options.isAdmin) {
    delete data.reviewNote;
    delete data.reviewedBy;
  }

  // 회차(날짜)를 함께 내려보냅니다. 상세 화면의 날짜 선택과 공급자의 회차 관리가
  // 같은 데이터를 쓰므로, 별도 엔드포인트를 두면 두 화면이 갈라집니다.
  const schedules = await listSchedules(db, snap.id);

  // 승인 대기 중인 수정본은 소유자와 관리자에게만 보입니다 — 손님에게는 승인된
  // 게시본만 보여야 하고, 심사 전 내용이 새어 나가면 안 됩니다(v23).
  if (!isOwner && !options.isAdmin) {
    delete data.editReviewNote;
    delete data.editReviewedBy;
    return { id: snap.id, ...data, schedules };
  }

  const pendingEdit = await getPendingEdit(db, snap.id);

  return { id: snap.id, ...data, schedules, pendingEdit };
}

/**
 * 목록.
 * - `mine`이면 호출자 소유 전부 (공급자 대시보드용)
 * - 아니면 게시된 것만
 *
 * 검색·필터는 이 경로가 아니라 `GET /programs/search`입니다(17-1).
 * 여기에 필터를 붙이기 시작하면 논리합 30개 제한에 걸립니다.
 */
export async function listPrograms(
  db: Firestore,
  options: { mine?: boolean; uid?: string; limit?: number }
): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(options.limit ?? 20, 50);

  let query = db.collection("programs").limit(limit);
  if (options.mine) {
    if (!options.uid) throw new AppError("unauthenticated", "로그인이 필요합니다");
    query = db.collection("programs").where("providerId", "==", options.uid).limit(limit);
  } else {
    query = db.collection("programs").where("status", "==", "published").limit(limit);
  }

  const snap = await query.get();
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    if (!options.mine) {
      delete data.reviewNote;
      delete data.reviewedBy;
    }
    return { id: d.id, ...data };
  });
}

/**
 * 심사 요청 (`draft` → `pending_review`).
 *
 * 보안규칙상 소유자는 `status`를 직접 쓰지 못하므로 이 경로가 유일한 전환 통로입니다
 * (2-3 v5 보완). 관리자 승인/반려는 `POST /admin/programs/{id}/review`로 별도입니다.
 */
export async function submitProgramForReview(
  db: Firestore,
  id: string,
  uid: string
): Promise<void> {
  const ref = db.doc(`programs/${id}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError("not-found", "프로그램을 찾을 수 없습니다");

    // 소유자 확인이 먼저입니다. 회차 검사를 앞에 두면 남의 프로그램에 요청했을 때
    // "날짜가 없다"는 응답이 돌아가 그 프로그램의 존재와 상태가 새어 나갑니다.
    if (snap.get("providerId") !== uid) {
      throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
    }
    if (snap.get("status") !== "draft") {
      throw new AppError(
        "failed-precondition",
        "작성 중(draft) 상태에서만 심사를 요청할 수 있습니다"
      );
    }
    if (!snap.get("title") || !snap.get("description")) {
      throw new AppError("failed-precondition", "제목과 설명을 채운 뒤 요청해 주세요");
    }

    // 회차가 0건이면 게시돼도 예약할 날짜가 없습니다 — 검색에는 뜨는데 예약이
    // 안 되는 상태라 사용자는 고장으로 읽고, 공급자는 무엇이 빠졌는지 모릅니다(2-4).
    const schedules = await tx.get(ref.collection("schedules"));
    assertSchedulableForReview(snap.get("scheduleType") as string, schedules.size);

    tx.update(ref, {
      status: "pending_review",
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

// 심사 대상/즉시 반영 필드 분류는 `programEdits.ts`가 갖고 있습니다.
// 한쪽에만 두는 이유: 두 파일이 서로를 부르면(순환 참조) 지금은 컴파일되지만
// 로드 순서가 바뀌는 순간 조용히 undefined가 됩니다.
export { changedReviewFields, needsRereview, NON_REVIEW_FIELDS } from "./programEdits";

/**
 * 일정 방식 변경 가능 여부.
 *
 * 이미 등록된 날짜가 있는데 방식을 바꾸면 그 날짜들이 의미를 잃습니다 —
 * `open`(상시모집)은 회차를 쓰지 않고, `weekly`는 템플릿이 만든 회차만 씁니다.
 * 날짜 기반끼리(`single`↔`series`)는 바꿔도 회차가 그대로 유효합니다.
 */
function assertScheduleTypeChangeAllowed(
  before: string,
  after: string,
  scheduleCount: number
): void {
  if (before === after || scheduleCount === 0) return;

  const dateBased = (t: string) => t === "single" || t === "series";
  if (!dateBased(before) || !dateBased(after)) {
    throw new AppError(
      "failed-precondition",
      "등록된 날짜가 있어 운영 방식을 바꿀 수 없습니다. 날짜를 먼저 지운 뒤 바꿔 주세요"
    );
  }
  if (after === "single" && scheduleCount > 1) {
    throw new AppError(
      "failed-precondition",
      `1회성으로 바꾸려면 날짜가 하나여야 합니다(현재 ${scheduleCount}개). 남길 날짜만 두고 나머지를 지워 주세요`
    );
  }
}

export interface UpdateProgramResult {
  /** 수정 후 상태 */
  status: string;
  /** 재심사로 되돌아갔는지 — 화면이 안내 문구를 바꿉니다 */
  sentToReview: boolean;
  /** 수정본이 승인 대기로 들어갔는지 (게시 중인 프로그램) */
  pendingEdit: boolean;
  /** 승인 대기로 들어간 항목 이름 */
  changedFields: string[];
}

/**
 * 내용 수정 (`PATCH /programs/{id}`, 스키마 5번 v10 · v22 확장).
 *
 * **`draft`도 이 경로로 고칩니다(v22).** 보안규칙은 `draft`의 클라이언트 직접 수정을
 * 허용하지만, 그 길로 가면 **파생 필드가 갱신되지 않습니다** — 주소를 강원도로
 * 바꿨는데 지역 필터에서는 경기도로 남는 식입니다. 계산이 필요한 수정은 전부 서버가
 * 합니다(2-3).
 */
export async function updateProgram(
  db: Firestore,
  id: string,
  uid: string,
  input: ProgramDraftInput
): Promise<UpdateProgramResult> {
  const ref = db.doc(`programs/${id}`);
  const snap = await ref.get();

  // 남의 프로그램은 존재 여부도 알리지 않습니다.
  if (!snap.exists || snap.get("providerId") !== uid) {
    throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
  }

  const before = snap.data() as Record<string, unknown>;
  const currentStatus = before.status as string;

  const schedules = await ref.collection("schedules").get();
  assertScheduleTypeChangeAllowed(
    before.scheduleType as string,
    input.scheduleType,
    schedules.size
  );

  await assertIntroImagesBelongToProgram(db, id, input);

  let derived;
  try {
    derived = deriveProgramFields({
      category: input.category,
      address: input.location.address,
      targetAgeMin: input.targetAgeMin,
      targetAgeMax: input.targetAgeMax,
      walkingDistanceM: input.walkingDistanceM,
    });
  } catch (err) {
    throw new AppError("invalid-argument", err instanceof Error ? err.message : "주소 오류");
  }

  // 게시 중인 프로그램은 **게시본을 내리지 않습니다**(v23).
  // 심사 대상 항목은 수정본으로 보관하고 승인 시 교체합니다 — 수정하면 검색에서
  // 사라지는 구조에서는 전문가가 오타조차 고치지 않게 됩니다(programEdits.ts).
  if (currentStatus === "published") {
    const { pendingEdit, changedFields } = await savePendingEdit(
      db,
      id,
      before,
      input,
      uid
    );
    return { status: "published", sentToReview: false, pendingEdit, changedFields };
  }

  // 상태 전환 규칙 (게시 중이 아닌 경우 — 게시본이 없으니 바로 반영합니다)
  // - draft            : 아직 심사 전이라 그대로 draft
  // - hidden(반려)     : 수정 자체가 재제출이므로 항상 pending_review
  // - pending_review   : 이미 심사 대기 중이라 그대로
  let nextStatus = currentStatus;
  if (currentStatus === "hidden") {
    nextStatus = "pending_review";
  }

  const patch: Record<string, unknown> = {
    ...input,
    ...derived,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (nextStatus !== currentStatus) {
    patch.status = nextStatus;
  }

  await ref.update(patch);

  // 회차에 심어둔 상태 사본을 함께 맞춥니다 — collectionGroup 규칙이 이 값을 보므로,
  // 게시가 취소됐는데 사본이 published로 남으면 검색에 계속 잡힙니다(2-4).
  if (nextStatus !== currentStatus && !schedules.empty) {
    const batch = db.batch();
    schedules.docs.forEach((d) => batch.update(d.ref, { programStatus: nextStatus }));
    await batch.commit();
  }

  // 일정 방식이 1회성으로 바뀌면 회차 번호를 지웁니다(1회성은 번호가 없습니다).
  if (input.scheduleType === "single" && !schedules.empty) {
    const batch = db.batch();
    schedules.docs.forEach((d) =>
      batch.update(d.ref, { type: "single", seriesIndex: null, seriesTotal: null })
    );
    await batch.commit();
  } else if (input.scheduleType === "series" && !schedules.empty) {
    const ordered = schedules.docs
      .slice()
      .sort((a, b) => a.get("startAt").toMillis() - b.get("startAt").toMillis());
    const batch = db.batch();
    ordered.forEach((d, i) =>
      batch.update(d.ref, { type: "series", seriesIndex: i + 1, seriesTotal: ordered.length })
    );
    await batch.commit();
  }

  return {
    status: nextStatus,
    sentToReview: nextStatus === "pending_review" && currentStatus !== "pending_review",
    pendingEdit: false,
    changedFields: [],
  };
}
