/**
 * 게시된 프로그램의 「승인 대기 중인 수정본」 (스키마 2-3 v23 · 5번).
 *
 * **왜 수정본을 따로 보관하는가.** v22까지는 게시 중인 프로그램의 심사 대상 필드를
 * 고치면 상태가 `pending_review`로 내려가 **승인까지 검색에서 사라졌습니다.** 그러면
 * 전문가는 오타조차 고치지 않게 됩니다 — 고치면 손님이 끊기니까요. 결과적으로 수정
 * 기능이 있는데 아무도 쓰지 않고 정보 품질만 나빠집니다.
 *
 * → **게시본은 그대로 노출하고, 수정본을 `programs/{id}/pendingEdit/current`에
 * 보관합니다.** 손님은 승인된 내용만 보고, 승인 시점에 게시본으로 교체됩니다.
 * 게시 상태는 내려가지 않습니다.
 *
 * 오늘의집 파트너센터가 같은 문제를 「판매중 상품 항목별 승인 구분」 + 사후검수로
 * 다루고 있어 참고했습니다. 우리는 사후검수(먼저 노출하고 문제 시 복원) 대신
 * **사전 승인**을 택했습니다 — 관리자가 한 명이라 사후 모니터링을 상시로 돌릴
 * 인력이 없고, 잘못된 정보를 보고 결제한 예약은 되돌리기 어렵습니다.
 *
 * **수정본은 프로그램당 한 개뿐입니다.** 여러 개를 쌓으면 관리자가 무엇을 승인하는지
 * 알 수 없어집니다. 다시 고치면 최신 것으로 덮어씁니다.
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";
import { deriveProgramFields } from "./programDerived";
import type { ProgramDraftInput } from "./programs";

/**
 * 심사를 다시 받지 않아도 되는 필드 (v22).
 *
 * **기본은 재심사입니다.** 목록에 없는 필드가 바뀌면 게시 중이던 프로그램이
 * `pending_review`로 돌아갑니다 — 승인 후 내용을 바꿔치기하면 "관리자가 확인하고
 * 승인했다"는 전제가 무너지기 때문입니다(6-1).
 *
 * 금지목록이 아니라 **예외목록**으로 둔 이유는 보안규칙과 같습니다. 필드를 추가할 때
 * 목록에 넣는 걸 잊으면 "괜히 재심사로 돌아가는" 불편으로 드러나지, "승인받은 내용을
 * 몰래 고칠 수 있는" 사고로 드러나지 않습니다(2-3 v13).
 */
export const NON_REVIEW_FIELDS = new Set([
  "barrierFree",
  "rainAlternative",
  "walkingDistanceM",
  "availableFrom",
  "availableUntil",
  // 소개 배치 양식(v29). **보기 방식이고 내용이 아닙니다** — 사진도 글도 그대로인데
  // 좌우 배치만 바뀌는 것을 재심사로 막으면, 전문가는 배치를 손대지 않게 됩니다.
  "introLayout",
]);

/** 두 값이 같은지 (location처럼 객체인 필드도 비교합니다) */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** 바뀐 심사 대상 필드 이름 목록. 관리자 화면이 「전 → 후」로 보여줄 대상입니다. */
export function changedReviewFields(
  before: Record<string, unknown>,
  after: ProgramDraftInput
): string[] {
  return (Object.keys(after) as Array<keyof ProgramDraftInput>).filter((key) => {
    if (NON_REVIEW_FIELDS.has(key)) return false;
    return !sameValue(before[key], after[key]);
  }) as string[];
}

/** 심사 대상 필드가 바뀌었는지 */
export function needsRereview(
  before: Record<string, unknown>,
  after: ProgramDraftInput
): boolean {
  return changedReviewFields(before, after).length > 0;
}

/** 수정본 문서 경로 — 프로그램당 한 개입니다. */
export function pendingEditPath(programId: string): string {
  return `programs/${programId}/pendingEdit/current`;
}

export interface PendingEditRow extends Record<string, unknown> {
  /** 게시본과 달라진 심사 대상 필드 이름 */
  changedFields: string[];
  submittedBy: string;
  submittedAt: unknown;
}

/**
 * 즉시 반영 항목만 뽑아냅니다.
 *
 * 배리어프리·우천 대체·걷는 거리·문의 가능 기간은 **운영 정보**라 심사를 거치지
 * 않습니다. 회차(날짜)도 마찬가지인데, 그쪽은 아예 다른 경로(`schedules`)입니다 —
 * 우천으로 일정을 옮기는 일이 심사에 막히면 안 됩니다.
 */
function immediatePart(input: ProgramDraftInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input) as Array<keyof ProgramDraftInput>) {
    if (NON_REVIEW_FIELDS.has(key)) out[key] = input[key];
  }
  return out;
}

/**
 * 게시 중인 프로그램의 수정 요청을 처리합니다.
 *
 * 즉시 반영 항목은 게시본에 바로 쓰고, 심사 대상 항목은 수정본으로 보관합니다.
 * 심사 대상 변경이 없으면 수정본을 만들지 않습니다 — 되돌린 경우에는 남아 있던
 * 수정본을 지웁니다(수정본은 항상 "게시본과의 차이"를 뜻해야 합니다).
 */
export async function savePendingEdit(
  db: Firestore,
  programId: string,
  before: Record<string, unknown>,
  input: ProgramDraftInput,
  uid: string
): Promise<{ pendingEdit: boolean; changedFields: string[] }> {
  const changedFields = changedReviewFields(before, input);
  const editRef = db.doc(pendingEditPath(programId));
  const programRef = db.doc(`programs/${programId}`);

  // 즉시 반영 항목은 게시본에 바로 씁니다.
  // 난이도는 걷는 거리에서 나오므로 함께 갱신해야 하고, 지역·연령 태그는
  // 심사 대상 필드(주소·대상연령)에서 나오므로 **옛 값 기준으로 계산**합니다 —
  // 승인 전에 바뀌면 게시본과 파생값이 어긋납니다.
  const oldLocation = (before.location ?? {}) as Record<string, unknown>;
  let derived;
  try {
    derived = deriveProgramFields({
      category: (before.category as string) ?? "",
      address: (oldLocation.address as string) ?? "",
      targetAgeMin: (before.targetAgeMin as number) ?? null,
      targetAgeMax: (before.targetAgeMax as number) ?? null,
      walkingDistanceM: input.walkingDistanceM,
    });
  } catch (err) {
    throw new AppError("invalid-argument", err instanceof Error ? err.message : "주소 오류");
  }

  await programRef.update({
    ...immediatePart(input),
    ...derived,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (changedFields.length === 0) {
    // 심사 대상 변경이 없습니다. 남아 있던 수정본은 지웁니다.
    await editRef.delete().catch(() => undefined);
    return { pendingEdit: false, changedFields: [] };
  }

  await editRef.set({
    ...input,
    changedFields,
    submittedBy: uid,
    submittedAt: FieldValue.serverTimestamp(),
  });

  // 새 수정본을 냈으면 지난 반려 사유는 지웁니다 — 남겨두면 "반려됐는데 또
  // 대기 중"으로 보여 어느 쪽이 현재 상태인지 알 수 없습니다.
  await programRef.update({
    editReviewNote: null,
    editReviewedAt: null,
    editReviewedBy: null,
  });

  return { pendingEdit: true, changedFields };
}

/** 수정본 조회. 없으면 null. 소유자·관리자에게만 내려보냅니다. */
export async function getPendingEdit(
  db: Firestore,
  programId: string
): Promise<PendingEditRow | null> {
  const snap = await db.doc(pendingEditPath(programId)).get();
  if (!snap.exists) return null;
  return snap.data() as PendingEditRow;
}

/**
 * 수정본 폐기.
 *
 * 두 경로가 씁니다 — 전문가가 스스로 취소하는 경우와, 관리자가 프로그램 자체를
 * 숨김 처리하는 경우입니다. 후자에서 남겨두면 나중에 되살릴 때 게시본과 수정본
 * 중 어느 쪽이 기준인지 알 수 없어집니다.
 */
export async function discardPendingEdit(
  db: Firestore,
  programId: string
): Promise<{ discarded: boolean }> {
  const ref = db.doc(pendingEditPath(programId));
  const snap = await ref.get();
  if (!snap.exists) return { discarded: false };
  await ref.delete();
  return { discarded: true };
}

/** 전문가가 자기 수정본을 취소합니다. */
export async function cancelPendingEdit(
  db: Firestore,
  programId: string,
  uid: string
): Promise<{ discarded: boolean }> {
  const snap = await db.doc(`programs/${programId}`).get();
  if (!snap.exists || snap.get("providerId") !== uid) {
    throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
  }
  const result = await discardPendingEdit(db, programId);
  if (!result.discarded) {
    throw new AppError("not-found", "승인 대기 중인 수정 내용이 없습니다");
  }
  return result;
}

/**
 * 수정본 승인 — 게시본에 반영합니다 (`POST /admin/programs/{id}/review-edit`).
 *
 * **게시 상태는 바뀌지 않습니다.** 내려갔다 올라오는 것이 아니라 내용만 교체되므로
 * `publishedAt`도 건드리지 않습니다 — 그 값은 최초 게시 시각이고 신규순 정렬의
 * 기준입니다(2-3).
 */
export async function approvePendingEdit(
  db: Firestore,
  programId: string,
  adminUid: string
): Promise<{ id: string; applied: string[] }> {
  const programRef = db.doc(`programs/${programId}`);
  const editRef = db.doc(pendingEditPath(programId));

  const [programSnap, editSnap] = await Promise.all([programRef.get(), editRef.get()]);
  if (!programSnap.exists) throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
  if (!editSnap.exists) {
    throw new AppError("failed-precondition", "승인 대기 중인 수정 내용이 없습니다");
  }
  if (programSnap.get("status") !== "published") {
    // 게시 중이 아닌 프로그램은 수정이 게시본에 바로 반영되는 경로를 씁니다.
    throw new AppError(
      "failed-precondition",
      "게시 중인 프로그램의 수정본만 승인할 수 있습니다"
    );
  }

  const edit = editSnap.data() as Record<string, unknown>;
  const changedFields = (edit.changedFields as string[]) ?? [];
  const location = (edit.location ?? {}) as Record<string, unknown>;

  let derived;
  try {
    derived = deriveProgramFields({
      category: (edit.category as string) ?? "",
      address: (location.address as string) ?? "",
      targetAgeMin: (edit.targetAgeMin as number) ?? null,
      targetAgeMax: (edit.targetAgeMax as number) ?? null,
      walkingDistanceM: (edit.walkingDistanceM as number) ?? null,
    });
  } catch (err) {
    throw new AppError(
      "invalid-argument",
      err instanceof Error ? err.message : "파생 필드를 계산하지 못했습니다"
    );
  }

  // 수정본에 담긴 입력 필드만 옮깁니다. changedFields·submittedBy 같은 관리용
  // 값이 프로그램 문서로 새어 들어가지 않게 걸러냅니다.
  const payload: Record<string, unknown> = { ...edit };
  delete payload.changedFields;
  delete payload.submittedBy;
  delete payload.submittedAt;

  await programRef.update({
    ...payload,
    ...derived,
    editReviewedBy: adminUid,
    editReviewedAt: FieldValue.serverTimestamp(),
    editReviewNote: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await editRef.delete();

  return { id: programId, applied: changedFields };
}

/**
 * 수정본 반려 — 수정본만 버리고 **게시본은 그대로 살아 있습니다.**
 *
 * 사유는 프로그램 문서에 남겨 전문가 화면에 보여줍니다. 사유가 없으면 무엇을
 * 고쳐야 할지 알 수 없어 다시 낼 수가 없습니다(프로그램 심사 반려와 같은 이유).
 */
export async function rejectPendingEdit(
  db: Firestore,
  programId: string,
  adminUid: string,
  note: string
): Promise<{ id: string }> {
  const programRef = db.doc(`programs/${programId}`);
  const editRef = db.doc(pendingEditPath(programId));

  const [programSnap, editSnap] = await Promise.all([programRef.get(), editRef.get()]);
  if (!programSnap.exists) throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
  if (!editSnap.exists) {
    throw new AppError("failed-precondition", "승인 대기 중인 수정 내용이 없습니다");
  }

  await programRef.update({
    editReviewNote: note,
    editReviewedBy: adminUid,
    editReviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await editRef.delete();

  return { id: programId };
}

export interface PendingEditListRow {
  id: string;
  title: string;
  providerId: string;
  changedFields: string[];
  submittedAt: unknown;
  /** 게시본 값과 수정본 값을 나란히 (관리자 화면의 「전 → 후」) */
  diff: Array<{ field: string; before: unknown; after: unknown }>;
}

/**
 * 수정 승인 대기 목록 (관리자).
 *
 * **컬렉션그룹 쿼리를 쓰지 않는 이유:** 수정본은 게시 중 프로그램에만 붙고 그 수가
 * 많아야 수십 건입니다. 게시 중 프로그램을 훑어 하위 문서를 붙이는 편이 인덱스를
 * 하나 더 만드는 것보다 단순합니다(공급자 심사 목록과 같은 판단 — 12-4).
 * 잘림은 숨기지 않고 알려줍니다.
 */
export async function listPendingEdits(
  db: Firestore,
  options: { limit?: number } = {}
): Promise<{ edits: PendingEditListRow[]; truncated: boolean }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const snap = await db
    .collection("programs")
    .where("status", "==", "published")
    .limit(limit)
    .get();

  const edits: PendingEditListRow[] = [];
  await Promise.all(
    snap.docs.map(async (d) => {
      const editSnap = await d.ref.collection("pendingEdit").doc("current").get();
      if (!editSnap.exists) return;

      const edit = editSnap.data() as Record<string, unknown>;
      const before = d.data() as Record<string, unknown>;
      const changedFields = (edit.changedFields as string[]) ?? [];

      edits.push({
        id: d.id,
        title: (before.title as string) ?? "",
        providerId: (before.providerId as string) ?? "",
        changedFields,
        submittedAt: edit.submittedAt ?? null,
        diff: changedFields.map((field) => ({
          field,
          before: before[field] ?? null,
          after: edit[field] ?? null,
        })),
      });
    })
  );

  edits.sort((a, b) => a.title.localeCompare(b.title));
  return { edits, truncated: snap.size === limit };
}
