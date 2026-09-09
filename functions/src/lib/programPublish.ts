/**
 * 게시 처리의 공통 조각 (2026-09-09, 결정 대기 ⑨ — 심사 없이 즉시 게시).
 *
 * 게시로 넘어가는 길이 셋이 됐습니다 — ① 공급자가 「게시하기」를 누를 때
 * (`publishProgram`) ② 자격 승인 순간 대기 중이던 프로그램이 자동으로
 * (`autoPublishAwaitingPrograms`) ③ 관리자가 숨긴 뒤 재제출된 것을 승인할 때
 * (`reviewProgram`). 셋이 각자 파생 필드와 `publishedAt`을 계산하면 한 곳만 고쳐져
 * 「승인으로 게시되면 지역 코드가 갱신되는데 게시하기로 게시되면 안 되는」 상태가
 * 생깁니다. 그래서 patch 계산을 여기 한 곳에 둡니다.
 *
 * 이 파일은 `programs.ts`·`adminReview.ts` 양쪽이 부르므로 **그 둘을 import하지
 * 않습니다**(순환 참조 — 지금은 컴파일되지만 로드 순서가 바뀌는 순간 undefined).
 */

import { FieldValue, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";
import { deriveProgramFields } from "./programDerived";

/**
 * 「게시 대기」(`pending_review`)의 이유.
 *  - `qualification` — 공급자 자격 승인을 기다리는 중. **승인되는 순간 자동 게시.**
 *    관리자가 내용을 볼 필요는 없습니다(⑨: 내용 심사 없음).
 *  - `admin` — 관리자가 사유를 적어 숨겼거나 반려한 것을 공급자가 고쳐 재제출한 것.
 *    **관리자가 봐야 게시됩니다**(페널티).
 */
export type PendingReason = "qualification" | "admin";

/**
 * 게시로 바꾸는 patch. 파생 필드를 다시 계산하고 `publishedAt`은 **최초 1회만** 채웁니다 —
 * 신규순 정렬의 기준이라 게시할 때마다 갱신하면 옛 프로그램이 신규 맨 위에 옵니다(2-3).
 * `hiddenBy`·`pendingReason`처럼 「게시 중이 아닐 때」만 뜻이 있는 값은 지웁니다.
 */
export function buildPublishPatch(snap: DocumentSnapshot): Record<string, unknown> {
  const location = (snap.get("location") ?? {}) as Record<string, unknown>;
  let derived: Record<string, unknown>;
  try {
    derived = deriveProgramFields({
      category: (snap.get("category") as string) ?? "",
      address: (location.address as string) ?? "",
      targetAgeMin: (snap.get("targetAgeMin") as number) ?? null,
      targetAgeMax: (snap.get("targetAgeMax") as number) ?? null,
      walkingDistanceM: (snap.get("walkingDistanceM") as number) ?? null,
    }) as unknown as Record<string, unknown>;
  } catch (err) {
    throw new AppError(
      "invalid-argument",
      err instanceof Error ? err.message : "파생 필드를 계산하지 못했습니다"
    );
  }

  const patch: Record<string, unknown> = {
    ...derived,
    status: "published",
    hiddenBy: FieldValue.delete(),
    hiddenAt: FieldValue.delete(),
    pendingReason: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (snap.get("publishedAt") == null) {
    patch.publishedAt = FieldValue.serverTimestamp();
  }
  return patch;
}

/**
 * 하위 회차의 상태 사본을 맞춥니다(2-4). collectionGroup 규칙이 이 값만 보므로
 * 빠뜨리면 게시해도 날짜별 회차 검색에서 빠지고, 내렸는데 계속 잡힙니다.
 * 트랜잭션 밖에서 처리합니다 — 회차가 수십 건일 수 있고, 사본은 잠깐 늦어도 결과가 같습니다.
 */
export async function syncScheduleStatus(
  db: Firestore,
  programId: string,
  status: string
): Promise<void> {
  const schedules = await db.collection(`programs/${programId}/schedules`).get();
  if (schedules.empty) return;
  const batch = db.batch();
  schedules.docs.forEach((d) => batch.update(d.ref, { programStatus: status }));
  await batch.commit();
}

/** 공급자 자격이 승인됐는가 — `providerProfiles/{uid}/private/profile.approvalStatus`(2-2). */
export async function isProviderApproved(db: Firestore, uid: string): Promise<boolean> {
  const snap = await db.doc(`providerProfiles/${uid}/private/profile`).get();
  return snap.exists && snap.get("approvalStatus") === "approved";
}

/**
 * 자격 승인 순간, 그 공급자의 「자격 승인 대기」 프로그램을 전부 게시합니다.
 *
 * ⑨의 미확정 항목(「자격 승인 전에도 즉시 게시인가」)에 **권고안(아니오)** 으로 만든
 * 자리입니다 — 미승인 전문가는 프로그램을 다 만들어둘 수 있고, 「게시하기」를 누르면
 * 여기 대기열에 들어가 승인 순간 자동으로 열립니다. 팀장님 답이 「예」면 `publishProgram`의
 * 승인 검사 한 줄만 빼면 되고 이 함수는 빈 대기열을 만나 그냥 지나갑니다.
 *
 * 등호 조건 셋(providerId·status·pendingReason)은 단일 필드 자동 색인의 병합으로
 * 처리되므로 복합 인덱스가 필요 없습니다(7번).
 */
export async function autoPublishAwaitingPrograms(
  db: Firestore,
  providerId: string
): Promise<string[]> {
  const snap = await db
    .collection("programs")
    .where("providerId", "==", providerId)
    .where("status", "==", "pending_review")
    .where("pendingReason", "==", "qualification")
    .get();

  const published: string[] = [];
  for (const d of snap.docs) {
    try {
      await d.ref.update(buildPublishPatch(d));
      await syncScheduleStatus(db, d.id, "published");
      published.push(d.id);
    } catch (err) {
      // 한 건이 파생 필드 계산에 실패해도(예: 주소에서 시도를 못 뽑음) 나머지는 게시합니다.
      // 실패한 건은 대기 상태로 남아 목록에서 사유와 함께 보입니다.
      console.warn("[publish] auto publish skipped", {
        programId: d.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return published;
}
