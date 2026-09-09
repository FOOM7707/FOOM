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
import { changedFieldsAll, discardPendingEdit, recordProgramHistory } from "./programEdits";
import {
  buildPublishPatch,
  isProviderApproved,
  syncScheduleStatus,
  type PendingReason,
} from "./programPublish";
import { deleteAllProgramFiles, type Deps as ProgramImageDeps } from "./programImages";
import {
  DEFAULT_INTRO_LAYOUT,
  INTRO_LAYOUTS,
  introBlockPaths,
  parseProgramContent,
  type IntroLayout,
  type ProgramContentInput,
} from "./programContent";
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
  /**
   * 상세 소개 배치 양식 (v29). 지금은 `zigzag` 하나뿐이라 화면에 고르는 칸이 없고
   * 이 값이 항상 기본값으로 들어옵니다 — 양식 2가 생기면 그때 칸을 엽니다.
   */
  introLayout: IntroLayout;
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

function num(
  value: unknown,
  field: string,
  { min = 0, max }: { min?: number; max?: number } = {}
): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new AppError("invalid-argument", `${field}은(는) 숫자여야 합니다`);
  }
  if (parsed < min) {
    throw new AppError("invalid-argument", `${field}은(는) ${min} 이상이어야 합니다`);
  }
  if (max != null && parsed > max) {
    throw new AppError("invalid-argument", `${field}은(는) ${max} 이하여야 합니다`);
  }
  return parsed;
}

function optionalNum(
  value: unknown,
  field: string,
  { min = 0, max }: { min?: number; max?: number } = {}
): number | null {
  if (value == null || value === "") return null;
  return num(value, field, { min, max });
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
      // 좌표는 선택값입니다(v18 이전 등록분은 비어 있음). 상·하한을 함께 검사합니다 —
      // 범위 밖 좌표는 에러 없이 「엉뚱한 위치의 지도」로만 드러나기 때문입니다.
      lat: optionalNum(location.lat, "위도", { min: -90, max: 90 }),
      lng: optionalNum(location.lng, "경도", { min: -180, max: 180 }),
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
    // 화면이 보내지 않아도 기본값으로 채웁니다. 목록 밖 값은 거부합니다.
    introLayout: oneOf(b.introLayout ?? DEFAULT_INTRO_LAYOUT, INTRO_LAYOUTS, "소개 배치 양식"),
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
 * 소개 블록이 가리키는 사진을 **프로그램 사진 목록에서** 확인하고 주소를 맞춥니다.
 *
 * **v29에서 검사 방향을 뒤집었습니다.** 전에는 "대표 사진과 같은 파일이면 거부"
 * 였습니다 — 두 목록이 같은 파일을 가리키는데 한쪽에서 지우면 파일이 사라져 다른
 * 쪽이 깨진 이미지가 되기 때문이었습니다. 그래서 소개용 사진을 따로 올려야 했고,
 * **같은 사진이 앨범과 소개 글에 각각 저장**됐습니다.
 *
 * → 사진 목록을 **하나로 합쳤습니다.** 소개 블록은 올려둔 사진을 **골라 쓰기만**
 * 합니다. 깨짐은 삭제 시 연쇄 정리로 막습니다(`programImages.deleteProgramImage`).
 *
 * 그래서 검사가 이렇게 바뀝니다.
 *   ① 목록(`imagePaths`)에 없는 경로는 거부 — 남의 폴더·자격증 파일·외부 URL이
 *      한 번에 막힙니다. 경로 형식·버킷 존재 여부는 **올릴 때 이미 확인**했습니다
 *   ② 주소는 클라이언트가 보낸 값을 쓰지 않고 **목록에 있는 주소로 덮어씁니다** —
 *      한 파일에 두 주소가 저장되는 일이 없어야 앨범과 소개 글이 같은 사진을
 *      가리킵니다
 *   ③ 한 사진은 한 블록에만 — 같은 사진이 소개 글에 두 번 나오는 것은 실수입니다
 */
async function resolveIntroBlockImages(
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
  const poolPaths = (snap.get("imagePaths") as string[] | undefined) ?? [];
  const poolUrls = (snap.get("imageUrls") as string[] | undefined) ?? [];

  input.introBlocks = input.introBlocks.map((block) => ({
    ...block,
    images: block.images.map((image) => {
      const index = poolPaths.indexOf(image.path);
      if (index < 0) {
        throw new AppError(
          "invalid-argument",
          "프로그램 사진에 없는 사진입니다. 먼저 사진을 올린 뒤 골라 주세요"
        );
      }
      return { path: image.path, url: poolUrls[index] ?? image.url };
    }),
  }));
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
      "소개 블록 사진은 프로그램을 저장한 뒤 올린 사진 중에서 골라 넣습니다"
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

    // 목록 카드용 작은 사진 (2026-09-03, 20-6). 큰 사진과 **같은 자리**를 쓰는
    // 짝 목록이라 길이가 항상 같아야 합니다 — 작은 것이 없는 사진은 빈 문자열입니다.
    thumbUrls: [],
    thumbPaths: [],

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

export interface PublicProviderProfile {
  uid: string;
  displayName: string | null;
  bio: string | null;
  profileImageUrl: string | null;
  qualificationType: string[];
  /** 심사를 통과했는지 — 화면의 「인증」 배지 근거값(2-2) */
  verified: boolean;
  ratingAvg: number;
  ratingCount: number;
}

/**
 * 공개 프로필만 읽습니다.
 *
 * **`private/profile`은 절대 건드리지 않습니다** — 정산 계좌·자격증 경로·심사 사유가
 * 거기 있고, 하나라도 섞이면 상세 페이지를 통해 그대로 공개됩니다(2-2 v10에서
 * 문서를 둘로 나눈 이유가 이것입니다).
 */
async function getPublicProviderProfile(
  db: Firestore,
  providerId: string
): Promise<PublicProviderProfile | null> {
  if (!providerId) return null;
  const snap = await db.doc(`providerProfiles/${providerId}`).get();
  if (!snap.exists) return null;

  return {
    uid: providerId,
    displayName: (snap.get("displayName") as string) ?? null,
    bio: (snap.get("bio") as string) ?? null,
    profileImageUrl: (snap.get("profileImageUrl") as string) ?? null,
    qualificationType: (snap.get("qualificationType") as string[]) ?? [],
    verified: snap.get("verified") === true,
    ratingAvg: (snap.get("ratingAvg") as number) ?? 0,
    ratingCount: (snap.get("ratingCount") as number) ?? 0,
  };
}

export interface ProgramReadOptions {
  /** 로그인한 경우의 uid */
  uid?: string;
  isAdmin?: boolean;
}

/**
 * 이 사람이 이 프로그램을 예약한 적이 있는가.
 *
 * **상태를 따지지 않습니다.** 취소된 예약이든 이미 다녀온 예약이든, 「내가 무엇을
 * 예약했는지」는 나중에도 볼 수 있어야 합니다 — 분쟁이 생겼을 때 손님 쪽에 근거가
 * 남지 않으면 플랫폼 말만 믿어야 하는 구조가 됩니다.
 */
async function hasBookingForProgram(
  db: Firestore,
  programId: string,
  uid: string
): Promise<boolean> {
  const snap = await db
    .collection("bookings")
    .where("programId", "==", programId)
    .where("consumerId", "==", uid)
    .limit(1)
    .get();
  return !snap.empty;
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
    // **예약한 사람은 볼 수 있어야 합니다** (2026-09-08).
    //
    // 공급자가 게시물을 내릴 수 있게 되면서(removeProgram) `hidden`의 뜻이 하나
    // 늘었습니다 — 그전에는 「관리자가 숨김」과 「반려」뿐이라 손님이 볼 이유가
    // 없었지만, 이제는 **예약을 받아둔 채로 내려간 프로그램**이 있을 수 있습니다.
    // 그대로 막으면 **돈을 낸 사람이 자기가 무엇을 예약했는지 못 봅니다.**
    //
    // 내리기는 「새 예약을 받지 않겠다」는 뜻이지 **이미 한 약속을 무르는 것이
    // 아닙니다**(에어비앤비도 같은 구분 — unlist는 기존 예약을 그대로 둡니다).
    // 약속을 무르려면 취소 절차를 거쳐야 하고, 거기엔 환불과 페널티가 붙습니다(2-5).
    //
    // **게시 중일 때는 이 조회를 하지 않습니다.** 상세는 가장 많이 열리는 화면이라
    // 모든 방문에 읽기를 하나 더 붙이면 비용이 방문 수에 비례해 늘어납니다.
    const hasBooking =
      options.uid != null && (await hasBookingForProgram(db, id, options.uid));
    if (!hasBooking) {
      // 존재 여부 자체를 알려주지 않습니다 — 심사 중인 프로그램의 존재가
      // 노출되면 반려 사유(reviewNote)를 추측할 단서가 됩니다.
      throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
    }
  }

  // 반려 사유는 소유자와 관리자에게만 내려보냅니다.
  if (!isOwner && !options.isAdmin) {
    delete data.reviewNote;
    delete data.reviewedBy;
  }

  // 회차(날짜)를 함께 내려보냅니다. 상세 화면의 날짜 선택과 공급자의 회차 관리가
  // 같은 데이터를 쓰므로, 별도 엔드포인트를 두면 두 화면이 갈라집니다.
  const schedules = await listSchedules(db, snap.id);

  // 운영자 정보도 함께 내려보냅니다 — **공개 프로필의 값만**입니다(2-2).
  // 정산 계좌·자격증 같은 민감 필드는 `private` 하위 문서에 있어 여기 오지 않습니다.
  // 화면이 따로 조회하게 하면 두 요청 사이에 값이 갈리고, 요청도 하나 더 늘어납니다.
  const provider = await getPublicProviderProfile(db, data.providerId as string);

  // 승인 대기 중인 수정본은 소유자와 관리자에게만 보입니다 — 손님에게는 승인된
  // 게시본만 보여야 하고, 심사 전 내용이 새어 나가면 안 됩니다(v23).
  if (!isOwner && !options.isAdmin) {
    delete data.editReviewNote;
    delete data.editReviewedBy;
    return { id: snap.id, ...data, schedules, provider };
  }

  // (⑨, 2026-09-09) 수정본(v23)은 없어졌습니다 — 게시 중 수정은 바로 반영되고 변경 기록은
  // `history` 하위 문서로 남습니다. 옛 문서에 남은 수정본은 읽지 않습니다.
  return { id: snap.id, ...data, schedules, provider };
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
    if (options.mine) {
      // **「지우기」와 「내리기」 중 무엇이 일어날지 화면이 미리 알려주려면 필요합니다**
      // (2026-09-08). `status`만으로는 알 수 없습니다 — `hidden`이 「반려된 것」과
      // 「내려간 것」 두 가지를 함께 뜻하기 때문입니다(removeProgram 참고).
      // `publishedAt`을 그대로 내려보내지 않는 이유는 시각 형식이 화면마다 다르게
      // 해석될 수 있어서입니다. 필요한 것은 시각이 아니라 예/아니오 하나입니다.
      data.everPublished = data.publishedAt != null;
    }
    if (!options.mine) {
      // 상세(getProgram)와 같은 기준입니다 — 심사·수정 승인 사유와 처리한
      // 관리자 uid는 소유자·관리자 전용입니다. 수정본이 반려되면
      // editReviewNote가 게시 중인 문서에 남으므로 여기서도 걸러야 합니다.
      delete data.reviewNote;
      delete data.reviewedBy;
      delete data.editReviewNote;
      delete data.editReviewedBy;
    }
    return { id: d.id, ...data };
  });
}

export interface PublishProgramResult {
  /** `published` = 바로 공개됨 · `pending_review` = 자격 승인을 기다림(승인 순간 자동 게시) */
  status: "published" | "pending_review";
  pendingReason: PendingReason | null;
}

/**
 * 게시하기 (`POST /programs/{id}/publish`) — ⑨(2026-09-09): **내용 심사 없이 바로 게시**합니다.
 *
 * v5~v37의 「심사 요청(`draft` → `pending_review`) → 관리자 승인」을 대체합니다. 공급자
 * (산림복지전문가)는 연령층이 높고 「올렸는데 안 보인다」는 며칠이 이탈 사유라는 팀 판단
 * 입니다. 대신 관리자가 사후에 감시하고(`listRecentActivity`) 이상하면 사유를 적어 숨깁니다
 * (`hideProgram`) — 숨겨진 것을 고쳐 다시 올릴 때만 심사를 거칩니다(페널티).
 *
 * **자격 승인 전에는 바로 열지 않습니다**(권고안 — 팀장님 확인 대기). 자격 심사(전문가 본인,
 * 1회)를 통과하기 전에 만든 프로그램은 「자격 승인 대기」(`pending_review` + `qualification`)로
 * 두고, 승인 순간 `autoPublishAwaitingPrograms`가 자동으로 엽니다. 없애려는 것은 프로그램마다
 * 반복되는 기다림이고, 무자격자 프로그램이 결제까지 가는 것은 「사진이 이상한」 것과 급이
 * 다릅니다. 팀장님 답이 「예」면 아래 `isProviderApproved` 검사 한 줄만 빼면 됩니다.
 *
 * 보안규칙상 소유자는 `status`를 직접 쓰지 못하므로 이 경로가 유일한 전환 통로입니다(2-3 v5).
 */
export async function publishProgram(
  db: Firestore,
  id: string,
  uid: string
): Promise<PublishProgramResult> {
  const ref = db.doc(`programs/${id}`);
  const approvedProvider = await isProviderApproved(db, uid);

  const result = await db.runTransaction(async (tx): Promise<PublishProgramResult> => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError("not-found", "프로그램을 찾을 수 없습니다");

    // 소유자 확인이 먼저입니다. 회차 검사를 앞에 두면 남의 프로그램에 요청했을 때
    // "날짜가 없다"는 응답이 돌아가 그 프로그램의 존재와 상태가 새어 나갑니다.
    if (snap.get("providerId") !== uid) {
      throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
    }

    const status = snap.get("status") as string;
    const awaitingQualification =
      status === "pending_review" && snap.get("pendingReason") === "qualification";
    if (status !== "draft" && !awaitingQualification) {
      throw new AppError(
        "failed-precondition",
        status === "published"
          ? "이미 게시 중인 프로그램입니다"
          : status === "hidden"
            ? "내려간 프로그램은 「다시 올리기」 또는 수정 후 심사 요청으로 되살립니다"
            : "관리자 확인을 기다리는 프로그램입니다"
      );
    }
    if (!snap.get("title") || !snap.get("description")) {
      throw new AppError("failed-precondition", "제목과 설명을 채운 뒤 게시해 주세요");
    }

    // 회차가 0건이면 게시돼도 예약할 날짜가 없습니다 — 검색에는 뜨는데 예약이
    // 안 되는 상태라 사용자는 고장으로 읽고, 공급자는 무엇이 빠졌는지 모릅니다(2-4).
    const schedules = await tx.get(ref.collection("schedules"));
    assertSchedulableForReview(snap.get("scheduleType") as string, schedules.size);

    if (!approvedProvider) {
      tx.update(ref, {
        status: "pending_review",
        pendingReason: "qualification",
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { status: "pending_review", pendingReason: "qualification" };
    }

    tx.update(ref, buildPublishPatch(snap));
    return { status: "published", pendingReason: null };
  });

  await syncScheduleStatus(db, id, result.status);
  return result;
}

// 심사 대상/즉시 반영 필드 분류는 `programEdits.ts`가 갖고 있습니다.
// 한쪽에만 두는 이유: 두 파일이 서로를 부르면(순환 참조) 지금은 컴파일되지만
// 로드 순서가 바뀌는 순간 조용히 undefined가 됩니다.
export { changedReviewFields, needsRereview, NON_REVIEW_FIELDS } from "./programEdits";

/**
 * 공급자가 **스스로** 내린 프로그램인가 (2026-09-09).
 *
 * `hiddenBy`가 `provider`이거나, 값이 없는데 게시된 적은 있는 옛 문서(2026-09-09 이전에
 * 내린 것 — 그때는 관리자가 게시 중인 프로그램을 내리는 경로가 없었으므로 공급자가 내린
 * 것입니다). 반려(`publishedAt` 없음)와 관리자 숨김(`hiddenBy='admin'`)은 아닙니다.
 */
export function isSelfHidden(doc: Record<string, unknown>): boolean {
  if (doc.status !== "hidden") return false;
  if (doc.hiddenBy === "admin") return false;
  if (doc.hiddenBy === "provider") return true;
  return doc.publishedAt != null;
}

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
  /** 심사로 넘어갔는지(관리자가 숨긴 것을 고친 경우만) — 화면이 안내 문구를 바꿉니다 */
  sentToReview: boolean;
  /** 이번 저장에서 바뀐 항목 이름(게시 중 수정일 때 변경 기록에도 같은 목록이 남습니다) */
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

  await resolveIntroBlockImages(db, id, input);

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

  // 게시 중인 프로그램의 수정은 **바로 반영됩니다**(⑨, 2026-09-09 — v23의 수정본·승인
  // 방식 폐기). 대신 무엇이 바뀌었는지를 `history` 하위 문서로 남깁니다 — 관리자 감시
  // 목록이 「전 → 후」로 보여주고, 표시·광고 기록 6개월 보존(시행령 6조)과 「손님이 봤을 때
  // 가격이 얼마였나」에 답하는 근거가 됩니다. 사후 검수는 기록이 있어야 성립합니다.
  if (currentStatus === "published") {
    const changedFields = changedFieldsAll(before, input);
    if (changedFields.length > 0) {
      await recordProgramHistory(db, id, uid, before, input, changedFields);
    }
    await ref.update({ ...input, ...derived, updatedAt: FieldValue.serverTimestamp() });
    return { status: "published", sentToReview: false, changedFields };
  }

  // 상태 전환 규칙 (게시 중이 아닌 경우)
  // - draft            : 그대로 draft — 「게시하기」를 눌러야 열립니다
  // - pending_review   : 그대로(이유도 그대로)
  // - hidden           : 누가 내렸는지에 따라 갈립니다(2-3 `hiddenBy`)
  //     · 공급자가 스스로 내린 것 → **hidden 그대로.** 내용 심사가 없으므로(⑨) 무엇을
  //       고쳐도 심사로 가지 않고, 「다시 올리기」로 되살립니다
  //     · 반려·관리자 숨김 → pending_review(이유 `admin`) — 관리자가 사유를 적어 내린
  //       것은 고친 뒤 관리자가 봐야 돌아옵니다(페널티)
  let nextStatus = currentStatus;
  let pendingReason: PendingReason | null = null;
  if (currentStatus === "hidden" && !isSelfHidden(before)) {
    nextStatus = "pending_review";
    pendingReason = "admin";
  }

  const patch: Record<string, unknown> = {
    ...input,
    ...derived,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (nextStatus !== currentStatus) {
    patch.status = nextStatus;
  }
  if (pendingReason) {
    patch.pendingReason = pendingReason;
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
    changedFields: changedFieldsAll(before, input),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 프로그램 정리 — 지우기 / 내리기 (2026-09-08 신규)
 *
 * **그전에는 공급자가 자기 프로그램을 치울 방법이 전혀 없었습니다.** 화면에도
 * 버튼이 없었고 서버에도 경로가 없어서, 잘못 만든 프로그램이 영구히 남았습니다.
 *
 * **「지우기」와 「내리기」를 상태가 아니라 `publishedAt`으로 가릅니다.**
 *   · 손님에게 보인 적 없음(`publishedAt == null`) → **완전 삭제**
 *   · 한 번이라도 보인 적 있음                      → **내리기(`hidden`)**
 *
 * 상태값(`draft`/`pending_review`/`hidden`)으로 가르지 않는 이유가 있습니다.
 * `hidden`은 **반려된 것**(게시된 적 없음)과 **내려간 것**(게시됐던 것) 두 가지를
 * 함께 뜻해서, 상태만 보면 지워도 되는지 알 수 없습니다. `publishedAt`은 최초
 * 게시 때 한 번만 채워지고 이후 바뀌지 않으므로(2-3) 「손님이 볼 수 있었는가」를
 * 정확히 가릅니다.
 *
 * **게시됐던 것을 지우지 않는 이유** — 앞으로 예약·후기·정산이 그 프로그램을
 * 가리킵니다. 문서를 없애면 「이 예약이 무슨 프로그램이었는지」를 되짚을 근거가
 * 사라집니다. 회차 삭제를 「예약이 있으면 거부」로 만든 것과 같은 판단입니다(2-4).
 * ──────────────────────────────────────────────────────────────────────── */

export interface RemoveProgramResult {
  /** `deleted` = 문서까지 지움 · `hidden` = 손님에게만 안 보이게 내림 */
  action: "deleted" | "hidden";
  /** 실제로 지운 사진 파일 수 (`hidden`이면 0) */
  deletedFiles: number;
}

export async function removeProgram(
  db: Firestore,
  id: string,
  uid: string,
  deps: ProgramImageDeps = {}
): Promise<RemoveProgramResult> {
  const ref = db.doc(`programs/${id}`);
  const snap = await ref.get();

  // 남의 프로그램은 존재 여부도 알리지 않습니다.
  if (!snap.exists || snap.get("providerId") !== uid) {
    throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
  }

  const status = snap.get("status") as string;
  const everPublished = snap.get("publishedAt") != null;

  // ── 게시됐던 프로그램 — 내립니다 ──────────────────────────────────────────
  //
  // **예약이 있어도 내릴 수 있습니다.** 「더 이상 새 예약을 받지 않겠다」는 것은
  // 정당한 요구이고(은퇴·이사·건강), 예약 하나 때문에 영원히 못 내리게 하면
  // 공급자가 잠적하는 쪽을 택하게 됩니다.
  //
  // **다만 내리기는 이미 한 약속을 무르는 것이 아닙니다.** 기존 예약은 그대로
  // 살아 있고, 예약자는 상세를 계속 볼 수 있으며(getProgram), 진행일이 오면
  // 진행해야 합니다. 약속을 무르려면 취소 절차를 거쳐야 하고 거기엔 전액 환불과
  // 경고 누적이 붙습니다(2-5). 에어비앤비도 같은 구분입니다 — 비활성화는 언제든
  // 되지만 **기존 호스팅 의무를 면제하지 않고**, 삭제는 예약이 다 끝나야 됩니다.
  if (everPublished) {
    if (status === "hidden") {
      throw new AppError("failed-precondition", "이미 내려간 프로그램입니다");
    }

    // `hiddenBy` — **누가 내렸는가**(2026-09-09, 2-3). 공급자가 스스로 내린 것은
    // 「다시 올리기」로 심사 없이 되살릴 수 있고, 관리자가 내린 것은 고쳐서 심사를
    // 받아야 합니다(페널티). 이 값이 없으면 둘을 가를 수 없어 페널티가 성립하지 않습니다.
    await ref.update({
      status: "hidden",
      hiddenBy: "provider",
      hiddenAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 회차에 심어둔 상태 사본을 함께 맞춥니다. 빠뜨리면 프로그램은 내려갔는데
    // 사본이 published로 남아 **검색에 계속 잡힙니다**(2-4).
    const schedules = await ref.collection("schedules").get();
    if (!schedules.empty) {
      const batch = db.batch();
      schedules.docs.forEach((d) => batch.update(d.ref, { programStatus: "hidden" }));
      await batch.commit();
    }

    // 승인 대기 중인 수정본은 함께 버립니다 — 관리자가 숨길 때와 같은 처리입니다.
    // 남겨두면 내려간 프로그램의 수정본이 심사 대기열에 계속 떠 있게 됩니다(v23).
    await discardPendingEdit(db, id);

    return { action: "hidden", deletedFiles: 0 };
  }

  // ── 게시된 적 없는 프로그램 — 완전히 지웁니다 ────────────────────────────
  //
  // 예약 검사는 논리적으로는 필요 없습니다(게시된 적이 없으면 손님이 볼 수도
  // 없었으니 예약이 생길 수 없습니다). 그래도 확인하는 이유는, 이 전제가 언젠가
  // 깨졌을 때 **조용히 예약 기록이 사라지는 것**이 최악이기 때문입니다.
  const booked = await db
    .collection("bookings")
    .where("programId", "==", id)
    .limit(1)
    .get();
  if (!booked.empty) {
    throw new AppError(
      "failed-precondition",
      "예약이 있는 프로그램은 삭제할 수 없습니다. 문의해 주세요"
    );
  }

  const imagePaths = (snap.get("imagePaths") as string[] | undefined) ?? [];
  const thumbPaths = (snap.get("thumbPaths") as string[] | undefined) ?? [];

  // 하위 회차를 먼저 지웁니다. 부모 문서를 지워도 하위 문서는 남기 때문에
  // (Firestore는 연쇄 삭제를 하지 않습니다) 순서를 바꾸면 **주인 없는 회차**가
  // 남고, 그 회차의 `programStatus` 사본이 검색에 잡힐 수 있습니다.
  const schedules = await ref.collection("schedules").get();
  if (!schedules.empty) {
    const batch = db.batch();
    schedules.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  // 수정본(하위 문서)도 같은 이유로 먼저 지웁니다.
  await discardPendingEdit(db, id);

  await ref.delete();

  // 파일은 문서를 지운 **뒤에** 지웁니다. 반대로 하면 파일 삭제만 성공하고 문서가
  // 남았을 때 깨진 이미지가 화면에 뜹니다 — 사진 한 장 지우기와 같은 순서입니다.
  const deletedFiles = await deleteAllProgramFiles([...imagePaths, ...thumbPaths], deps);

  return { action: "deleted", deletedFiles };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 다시 올리기 (2026-09-09 신규 — 결정 대기 ⑧ 확정)
 *
 * 내려간 프로그램을 **심사 없이** 게시로 되돌립니다. 프로그램은 「틀」이고 날짜는
 * 따로 붙으므로(2-4), 같은 프로그램을 다음 시즌에 다시 여는 것이 원래 의도된
 * 사용법입니다 — 시즌마다 새 프로그램을 만들면 관리자가 같은 내용을 다시 심사하고,
 * 후기·평점이 0부터 시작하고, 사진이 두 벌 쌓입니다. 재사용이 그 셋을 전부 없앱니다.
 *
 * **되살릴 수 있는 것은 공급자가 스스로 내린 것만입니다**(`isSelfHidden`).
 *   · 반려(게시된 적 없음)         → 고쳐서 심사 요청(`PATCH` → pending_review)
 *   · 관리자가 내린 것(`hiddenBy='admin'`) → 같음. 관리자가 사유를 적어 내린 것을
 *     손도 안 대고 되살리는 핑퐁을 막는 것이 이 구분의 이유입니다(페널티).
 *
 * 내려간 채로 심사 대상 항목을 고치면 `updateProgram`이 이미 pending_review로 보냈으므로
 * 여기 도달하는 `hidden`은 「내린 뒤 날짜·즉시 반영 항목만 바뀐 것」뿐입니다 — 승인받은
 * 내용 그대로라 심사 없이 되살려도 관리자가 확인한 전제가 깨지지 않습니다.
 *
 * `publishedAt`은 **건드리지 않습니다** — 최초 게시 시각이고 신규순 정렬 기준입니다(2-3).
 * 되살릴 때마다 갱신하면 옛 프로그램이 「새로 올라온 것」으로 정렬됩니다.
 * ──────────────────────────────────────────────────────────────────────── */

export async function relistProgram(
  db: Firestore,
  id: string,
  uid: string
): Promise<{ status: "published" }> {
  const ref = db.doc(`programs/${id}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("providerId") !== uid) {
      throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
    }
    const doc = snap.data() as Record<string, unknown>;

    if (doc.status === "published") {
      throw new AppError("failed-precondition", "이미 게시 중인 프로그램입니다");
    }
    if (doc.status !== "hidden") {
      throw new AppError("failed-precondition", "내려간 프로그램만 다시 올릴 수 있습니다");
    }
    if (!isSelfHidden(doc)) {
      throw new AppError(
        "failed-precondition",
        doc.publishedAt == null
          ? "반려된 프로그램은 내용을 고친 뒤 심사를 요청해 주세요"
          : "관리자가 내린 프로그램은 내용을 고친 뒤 심사를 요청해 주세요"
      );
    }

    tx.update(ref, {
      status: "published",
      hiddenBy: FieldValue.delete(),
      hiddenAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  // 회차에 심어둔 상태 사본을 함께 맞춥니다 — 내릴 때와 반대 방향입니다. 빠뜨리면
  // 프로그램은 게시 중인데 회차가 hidden으로 남아 날짜별 회차 검색에서 빠집니다(2-4).
  const schedules = await ref.collection("schedules").get();
  if (!schedules.empty) {
    const batch = db.batch();
    schedules.docs.forEach((d) => batch.update(d.ref, { programStatus: "published" }));
    await batch.commit();
  }

  return { status: "published" };
}
