/**
 * 관리자 심사 — 전문가 승인 · 프로그램 게시 (스키마 12-2, 5번 「관리자/정산」).
 *
 * **이 파일이 없으면 서비스가 돌아가지 않습니다.** 공급자는 `pending_review`까지만
 * 갈 수 있고(보안규칙상 `status`를 직접 못 씁니다), 게시로 넘길 방법이 여기 말고는
 * 없습니다(12-1 ②).
 *
 * 세 가지를 지킵니다.
 *  ① **감사로그를 반드시 남깁니다.** 관리자에게도 클라이언트 쓰기를 열지 않는 이유가
 *     이것입니다(6-1). 누가 언제 승인했는지가 없으면 나중에 되짚을 수 없습니다.
 *  ② **승인 시 파생 필드를 다시 계산합니다.** 특히 `publishedAt`은 신규순 정렬의
 *     기준 필드인데 승인 말고는 채우는 곳이 없습니다(5번 v13 추가).
 *  ③ **하위 `schedules`의 `programStatus`를 함께 갱신합니다.** collectionGroup
 *     보안규칙이 이 비정규화 값만 보므로, 빠뜨리면 게시해도 검색에 안 잡힙니다(6-1).
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";
import { syncProviderClaims, type ProviderClaimsPort } from "./providerClaims";
import { discardPendingEdit, latestProgramHistory } from "./programEdits";
import {
  autoPublishAwaitingPrograms,
  buildPublishPatch,
  syncScheduleStatus,
} from "./programPublish";

export type ReviewDecision = "approved" | "rejected";

/** 승인/반려 공통 입력. 반려는 사유가 필수입니다 — 없으면 재제출할 수가 없습니다. */
export interface ReviewInput {
  decision: ReviewDecision;
  note: string | null;
  /** 처리한 관리자 uid (감사로그) */
  adminUid: string;
}

export function parseReviewInput(body: unknown, adminUid: string): ReviewInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const decision = b.decision;
  if (decision !== "approved" && decision !== "rejected") {
    throw new AppError("invalid-argument", "승인 또는 반려를 선택해 주세요");
  }

  const rawNote = typeof b.note === "string" ? b.note.trim() : "";
  if (decision === "rejected" && rawNote.length === 0) {
    // 반려 사유는 공급자에게 그대로 노출됩니다(2-3). 사유가 없으면
    // 무엇을 고쳐야 할지 알 수 없어 재제출이 불가능해집니다.
    throw new AppError("invalid-argument", "반려 사유를 입력해 주세요");
  }
  if (rawNote.length > 1000) {
    throw new AppError("invalid-argument", "사유가 너무 깁니다");
  }

  return { decision, note: rawNote.length > 0 ? rawNote : null, adminUid };
}

/**
 * 전문가 자격 심사 상태 (v23에서 `reviewing` 추가).
 *
 * **`reviewing`을 왜 두는가.** 신청한 전문가에게 「접수 → 대기 → 심사 중 → 결과」를
 * 보여주려면 「담당자가 실제로 보기 시작했다」는 시점이 데이터에 있어야 합니다.
 * 없이 4칸을 그리면 3번 칸이 영원히 안 켜지고, 사용자는 그걸 고장으로 읽습니다.
 * 대신 관리자가 「심사 시작」을 한 번 눌러야 합니다.
 */
export const PROVIDER_APPROVAL_STATUSES = [
  "pending",
  "reviewing",
  "approved",
  "rejected",
] as const;

// ── 전문가 심사 ────────────────────────────────────────────────────────────

export interface ProviderReviewRow {
  uid: string;
  displayName: string | null;
  bio: string | null;
  qualificationType: string[];
  verified: boolean;
  approvalStatus: string | null;
  approvalNote: string | null;
  approvedBy: string | null;
  approvedAt: unknown;
  /** 심사용 자격증 이미지 — 관리자에게만 내려보냅니다(2-2) */
  certificateImageUrls: string[];
  /** 본인확인 완료 시각. null이면 임시 경로(15-8)로 만들어진 계정입니다 */
  identityVerifiedAt: unknown;
  userName: string | null;
  userStatus: string | null;
}

export interface ProviderListResult {
  providers: ProviderReviewRow[];
  /** 훑어본 공급자 수. limit에 닿았으면 뒤가 잘렸다는 뜻입니다 */
  scanned: number;
  truncated: boolean;
}

/**
 * 심사 대상 공급자 목록.
 *
 * **`approvalStatus`로 바로 쿼리하지 않는 이유:** 그 값은 `private/profile`
 * 하위 문서에 있어서 컬렉션그룹 쿼리(`private`)를 써야 하는데, 같은 이름의
 * `users/{uid}/private/identity`까지 같은 그룹에 섞이고 별도 인덱스도 필요합니다.
 * 공급자 수가 수백 단위인 동안에는 `users`에서 공급자를 훑어 하위 문서를 붙이는
 * 편이 단순하고, 인덱스 관리 대상도 늘지 않습니다(12-4 — 하루 수십 건 규모).
 *
 * 잘림을 숨기지 않습니다 — `truncated`로 알려주고, 늘어나면 그때 컬렉션그룹
 * 인덱스로 바꿉니다.
 */
export async function listProvidersForReview(
  db: Firestore,
  options: { status?: string; limit?: number } = {}
): Promise<ProviderListResult> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 300);
  const status = options.status ?? "pending";

  const userSnap = await db
    .collection("users")
    .where("role", "==", "provider")
    .limit(limit)
    .get();

  const rows = await Promise.all(
    userSnap.docs.map(async (userDoc) => {
      const uid = userDoc.id;
      const [publicSnap, privateSnap] = await Promise.all([
        db.doc(`providerProfiles/${uid}`).get(),
        db.doc(`providerProfiles/${uid}/private/profile`).get(),
      ]);

      const row: ProviderReviewRow = {
        uid,
        displayName: publicSnap.exists
          ? ((publicSnap.get("displayName") as string) ?? null)
          : null,
        bio: publicSnap.exists ? ((publicSnap.get("bio") as string) ?? null) : null,
        qualificationType: publicSnap.exists
          ? ((publicSnap.get("qualificationType") as string[]) ?? [])
          : [],
        verified: publicSnap.exists ? publicSnap.get("verified") === true : false,
        approvalStatus: privateSnap.exists
          ? ((privateSnap.get("approvalStatus") as string) ?? null)
          : null,
        approvalNote: privateSnap.exists
          ? ((privateSnap.get("approvalNote") as string) ?? null)
          : null,
        approvedBy: privateSnap.exists
          ? ((privateSnap.get("approvedBy") as string) ?? null)
          : null,
        approvedAt: privateSnap.exists ? (privateSnap.get("approvedAt") ?? null) : null,
        certificateImageUrls: privateSnap.exists
          ? ((privateSnap.get("certificateImageUrls") as string[]) ?? [])
          : [],
        identityVerifiedAt: userDoc.get("identityVerifiedAt") ?? null,
        userName: (userDoc.get("name") as string) ?? null,
        userStatus: (userDoc.get("status") as string) ?? null,
      };
      return row;
    })
  );

  const providers = status === "all" ? rows : rows.filter((r) => r.approvalStatus === status);

  return {
    providers,
    scanned: userSnap.size,
    truncated: userSnap.size === limit,
  };
}

/**
 * 심사 착수 (`POST /admin/providers/{id}/start-review`).
 *
 * 상태만 `pending` → `reviewing`으로 옮깁니다. 승인·반려와 달리 결과가 아니라
 * **진행 표시**이므로 `verified`는 건드리지 않습니다 — 여기서 함께 바꾸면
 * "심사 중인데 인증 배지가 붙는" 상태가 됩니다.
 */
export async function startProviderReview(
  db: Firestore,
  uid: string,
  adminUid: string
): Promise<{ uid: string; approvalStatus: string }> {
  const privateRef = db.doc(`providerProfiles/${uid}/private/profile`);
  const snap = await privateRef.get();
  if (!snap.exists) {
    throw new AppError("not-found", "공급자 프로필을 찾을 수 없습니다");
  }

  const current = (snap.get("approvalStatus") as string) ?? null;
  if (current !== "pending") {
    throw new AppError(
      "failed-precondition",
      "심사 대기(pending) 상태에서만 심사를 시작할 수 있습니다"
    );
  }

  await privateRef.update({
    approvalStatus: "reviewing",
    reviewStartedBy: adminUid,
    reviewStartedAt: FieldValue.serverTimestamp(),
  });

  return { uid, approvalStatus: "reviewing" };
}

/**
 * 승인/반려 (`POST /admin/providers/{id}/approve`).
 *
 * 승인은 문서 두 개를 함께 바꿉니다 — `private/profile.approvalStatus`와
 * 공개 프로필의 `verified`(2-2, 5번). 한쪽만 바꾸면 "심사는 통과했는데 인증
 * 배지가 안 붙는" 반쪽 상태가 됩니다. 그래서 batch로 묶습니다.
 */
export async function reviewProvider(
  db: Firestore,
  uid: string,
  input: ReviewInput,
  /**
   * 출입증의 「승인됨」 표시를 함께 맞춥니다 (2026-09-11). **없으면 넘어갑니다** —
   * 이 표시는 헤더 버튼 모양만 정하고, 다음 로그인 때 어차피 맞춰집니다.
   */
  claimsPort?: ProviderClaimsPort
): Promise<{
  uid: string;
  approvalStatus: string;
  verified: boolean;
  /** 승인과 함께 자동 게시된 프로그램 id (⑨) */
  publishedPrograms: string[];
}> {
  const publicRef = db.doc(`providerProfiles/${uid}`);
  const privateRef = db.doc(`providerProfiles/${uid}/private/profile`);

  const [publicSnap, privateSnap] = await Promise.all([publicRef.get(), privateRef.get()]);
  if (!publicSnap.exists || !privateSnap.exists) {
    throw new AppError("not-found", "공급자 프로필을 찾을 수 없습니다");
  }

  const current = (privateSnap.get("approvalStatus") as string) ?? null;
  if (current !== "pending" && current !== "reviewing") {
    // 이미 승인·반려된 계정을 다시 처리하면 진행 표시가 뒤로 돌아갑니다.
    // 재심사가 필요하면 대기 상태로 돌리는 별도 경로를 만듭니다.
    throw new AppError(
      "failed-precondition",
      "심사 대기 또는 심사 중인 계정만 처리할 수 있습니다"
    );
  }

  const approved = input.decision === "approved";

  // (참고) 15-1의 정식 절차는 휴대폰 본인확인을 전제하지만, 벤더 계약 전이라
  // `identityVerifiedAt`이 null인 계정만 존재합니다(15-8). 여기서 막으면 아무도
  // 승인할 수 없으므로 차단하지 않고, 목록에 값을 그대로 내려보내 관리자가
  // 보고 판단하게 합니다. 벤더 계약 후 이 자리에 검사를 넣습니다.
  // TODO(15-8): 본인확인 연동 후 approved 조건에 identityVerifiedAt != null 추가

  const batch = db.batch();
  batch.update(privateRef, {
    approvalStatus: approved ? "approved" : "rejected",
    approvalNote: input.note,
    approvedBy: input.adminUid,
    approvedAt: FieldValue.serverTimestamp(),
  });
  batch.update(publicRef, {
    verified: approved,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  // (⑨, 2026-09-09) 자격 승인 순간, 이 공급자가 「게시하기」를 눌러 승인을 기다리던
  // 프로그램을 자동으로 엽니다 — 승인 메일을 받고 들어와 다시 버튼을 눌러야 하면
  // 「승인됐다는데 왜 안 보이지」가 됩니다. 실패한 건은 대기 상태로 남습니다(programPublish.ts).
  const publishedPrograms = approved ? await autoPublishAwaitingPrograms(db, uid) : [];

  // 반려해도 전문가 자격 자체는 남으므로(`users.role`은 그대로) 「전문가」 표시는
  // 유지하고 「승인됨」만 뗍니다 — 그래야 헤더가 「심사 상태 보기」를 보여줍니다.
  if (claimsPort) {
    await syncProviderClaims(claimsPort, uid, {
      provider: true,
      providerApproved: approved,
    });
  }

  return {
    uid,
    approvalStatus: approved ? "approved" : "rejected",
    verified: approved,
    publishedPrograms,
  };
}

// ── 프로그램 심사 ──────────────────────────────────────────────────────────

export interface ProgramReviewRow extends Record<string, unknown> {
  id: string;
  providerDisplayName: string | null;
}

/**
 * 심사 대기 프로그램 목록.
 *
 * `orderBy`를 붙이지 않는 이유: `status` 등호 + 다른 필드 정렬은 복합 인덱스를
 * 요구합니다. 심사 대기 건수는 많아야 수십 건이라 메모리에서 정렬하는 편이
 * 인덱스를 하나 더 만드는 것보다 낫습니다(7번).
 */
export async function listProgramsForReview(
  db: Firestore,
  options: { status?: string; limit?: number } = {}
): Promise<{ programs: ProgramReviewRow[]; truncated: boolean }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const status = options.status ?? "pending_review";

  const snap = await db.collection("programs").where("status", "==", status).limit(limit).get();

  const providerIds = [...new Set(snap.docs.map((d) => d.get("providerId") as string))];
  const profiles = new Map<string, string | null>();
  await Promise.all(
    providerIds.map(async (pid) => {
      if (!pid) return;
      const p = await db.doc(`providerProfiles/${pid}`).get();
      profiles.set(pid, p.exists ? ((p.get("displayName") as string) ?? null) : null);
    })
  );

  const programs: ProgramReviewRow[] = snap.docs
    .map(
      (d): ProgramReviewRow => ({
        id: d.id,
        ...(d.data() as Record<string, unknown>),
        providerDisplayName: profiles.get(d.get("providerId") as string) ?? null,
      })
    )
    .sort((a, b) => String(a.title ?? "").localeCompare(String(b.title ?? "")));

  return { programs, truncated: snap.size === limit };
}

/**
 * 게시/반려 (`POST /admin/programs/{id}/review`).
 *
 * `pending_review` 상태에서만 처리합니다. 이미 게시된 프로그램의 내용 수정은
 * `PATCH /programs/{id}`가 재심사로 되돌리는 경로를 씁니다(2-3 v10) — 여기에
 * 게시 취소를 겸하게 만들면 "심사"와 "운영 중 조치"가 한 버튼에 섞입니다.
 */
export async function reviewProgram(
  db: Firestore,
  id: string,
  input: ReviewInput
): Promise<{ id: string; status: string }> {
  const ref = db.doc(`programs/${id}`);
  const approved = input.decision === "approved";
  const nextStatus = approved ? "published" : "hidden";

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
    if (snap.get("status") !== "pending_review") {
      throw new AppError(
        "failed-precondition",
        "심사 요청된(pending_review) 프로그램만 처리할 수 있습니다"
      );
    }

    const patch: Record<string, unknown> = {
      status: nextStatus,
      reviewedBy: input.adminUid,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewNote: input.note,
      updatedAt: FieldValue.serverTimestamp(),
    };
    // 반려는 **관리자가 내린 것**입니다(2026-09-09, 2-3 `hiddenBy`). 공급자가 스스로
    // 내린 것과 갈라야 「다시 올리기」가 반려를 심사 없이 되살리지 못합니다.
    if (!approved) {
      patch.hiddenBy = "admin";
      patch.hiddenAt = FieldValue.serverTimestamp();
      patch.pendingReason = FieldValue.delete();
    } else {
      // 파생 필드 재산출 + publishedAt 최초 1회 + hiddenBy·pendingReason 정리 —
      // 게시하기·자동 게시와 **같은 patch**를 씁니다(programPublish.ts). 세 경로가 각자
      // 계산하면 한 곳만 고쳐져 「승인으로 게시되면 지역 코드가 갱신되는데 게시하기로는
      // 안 되는」 상태가 생깁니다.
      Object.assign(patch, buildPublishPatch(snap));
    }

    tx.update(ref, patch);
  });

  // 하위 회차의 비정규화 상태값 갱신 (2-4, 6-1). collectionGroup 규칙이 이 값만
  // 보므로 빠뜨리면 게시해도 검색에 안 잡힙니다.
  await syncScheduleStatus(db, id, nextStatus);

  // 숨김(반려) 처리 시 승인 대기 중인 수정본을 버립니다(v23).
  // 남겨두면 나중에 이 프로그램을 되살릴 때 게시본과 수정본 중 어느 쪽이
  // 기준인지 알 수 없어집니다.
  if (!approved) {
    await discardPendingEdit(db, id);
  }

  // TODO(2번 검색 연동): 승인 직후 rebuildSearchIndex를 1회 호출해 검색 반영
  //   지연을 없앱니다(5번). 집계 배치가 아직 없어 지금은 호출할 대상이 없습니다.

  return { id, status: nextStatus };
}

// ── 사후 감시 (⑨, 2026-09-09) ──────────────────────────────────────────────
//
// 내용 심사를 없앴으므로 관리자의 일은 「승인」에서 「감시하다가 이상하면 숨기기」로
// 바뀝니다. 관리자는 **내용을 고치지 않습니다** — 내용의 책임은 공급자에게 있어야 하고
// (표시·광고 책임), 관리자가 손대기 시작하면 「누가 이 문구를 썼나」가 흐려집니다.

export interface HideProgramInput {
  adminUid: string;
  /** 필수. 공급자 카드에 그대로 보이는 값 — 비면 무엇을 고칠지 알 수 없어 재제출이 불가능해집니다 */
  note: string;
}

export function parseHideInput(body: unknown, adminUid: string): HideProgramInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (!note) {
    throw new AppError("invalid-argument", "숨기는 사유를 적어 주세요 — 공급자에게 그대로 보입니다");
  }
  if (note.length > 500) {
    throw new AppError("invalid-argument", "사유는 500자까지 쓸 수 있습니다");
  }
  return { adminUid, note };
}

/**
 * 관리자 숨기기 (`POST /admin/programs/{id}/hide`).
 *
 * 게시 중인 프로그램을 그 자리에서 비공개로 내립니다. `hiddenBy='admin'`이 페널티의 근거입니다 —
 * 공급자가 스스로 내린 것은 「다시 올리기」로 즉시 되살리지만, 관리자가 내린 것은 **고쳐 저장하면
 * 심사 대기(`pendingReason='admin'`)로 가고 관리자가 승인해야** 돌아옵니다(`updateProgram`).
 * 예약자는 내려간 프로그램의 상세를 계속 봅니다(`getProgram` — 내리기는 약속을 무르는 것이 아님).
 */
export async function hideProgram(
  db: Firestore,
  id: string,
  input: HideProgramInput
): Promise<{ id: string; status: "hidden" }> {
  const ref = db.doc(`programs/${id}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError("not-found", "프로그램을 찾을 수 없습니다");
    if (snap.get("status") !== "published") {
      throw new AppError("failed-precondition", "게시 중인 프로그램만 숨길 수 있습니다");
    }
    tx.update(ref, {
      status: "hidden",
      hiddenBy: "admin",
      hiddenAt: FieldValue.serverTimestamp(),
      reviewedBy: input.adminUid,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewNote: input.note,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  await syncScheduleStatus(db, id, "hidden");
  await discardPendingEdit(db, id);
  return { id, status: "hidden" };
}

export interface ActivityRow extends Record<string, unknown> {
  id: string;
  providerDisplayName: string | null;
  /** 가장 최근 변경 기록(게시 중 수정). 없으면 null — 게시 뒤 손대지 않은 프로그램 */
  lastChange: {
    changedAt: unknown;
    fields: string[];
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  } | null;
}

/**
 * 최근 게시·변경 목록 (`GET /admin/programs/activity`) — 관리자 감시 화면의 데이터.
 *
 * `updatedAt` 내림차순 하나로 읽습니다(단일 필드 자동 색인). 상태로 걸러내는 것은 메모리에서
 * 합니다 — `status` 등호 + 정렬은 복합 인덱스를 요구하고, 감시 대상은 많아야 수십 건입니다(7번).
 * 작성 중(draft)은 손님이 볼 수 없으므로 뺍니다.
 */
export async function listRecentActivity(
  db: Firestore,
  options: { limit?: number } = {}
): Promise<{ programs: ActivityRow[]; truncated: boolean }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const snap = await db.collection("programs").orderBy("updatedAt", "desc").limit(limit).get();

  const docs = snap.docs.filter((d) => d.get("status") !== "draft");
  const providerIds = [...new Set(docs.map((d) => d.get("providerId") as string))];
  const profiles = new Map<string, string | null>();
  await Promise.all(
    providerIds.map(async (pid) => {
      if (!pid) return;
      const p = await db.doc(`providerProfiles/${pid}`).get();
      profiles.set(pid, p.exists ? ((p.get("displayName") as string) ?? null) : null);
    })
  );

  const programs = await Promise.all(
    docs.map(async (d): Promise<ActivityRow> => {
      const history = await latestProgramHistory(db, d.id);
      return {
        id: d.id,
        ...(d.data() as Record<string, unknown>),
        providerDisplayName: profiles.get(d.get("providerId") as string) ?? null,
        lastChange: history
          ? {
              changedAt: history.changedAt,
              fields: history.fields,
              before: history.before,
              after: history.after,
            }
          : null,
      };
    })
  );

  return { programs, truncated: snap.size === limit };
}
