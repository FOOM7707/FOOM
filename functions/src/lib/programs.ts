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
  imageUrls: string[];
  barrierFree: boolean;
  targetAgeMin: number | null;
  targetAgeMax: number | null;
  walkingDistanceM: number | null;
  rainAlternative: string;
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
    imageUrls: Array.isArray(b.imageUrls)
      ? b.imageUrls.filter((u): u is string => typeof u === "string")
      : [],
    barrierFree: b.barrierFree === true,
    targetAgeMin,
    targetAgeMax,
    walkingDistanceM: optionalNum(b.walkingDistanceM, "보행거리"),
    rainAlternative: oneOf(b.rainAlternative, RAIN_ALTERNATIVES, "우천 시 대체 방식"),
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

export async function createDraftProgram(
  db: Firestore,
  providerId: string,
  input: ProgramDraftInput
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

  const ref = db.collection("programs").doc();
  await ref.set({
    providerId,
    ...input,
    ...derived,
    status: "draft",

    // 심사 감사로그 (2-3, v10)
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,

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

  return { id: snap.id, ...data };
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

    tx.update(ref, {
      status: "pending_review",
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}
