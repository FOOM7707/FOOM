/**
 * 임시 공급자 지정 (⚠️ 정식 오픈 전 제거 대상).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 이것은 문서(15-1)와 다른 임시 우회로입니다
 * ─────────────────────────────────────────────────────────────────────────────
 * 15-1이 정의한 정식 공급자 등록은 **휴대폰 본인확인 필수 + 자격증 제출 → 관리자
 * 심사**입니다. 그런데 본인확인 벤더(KG이니시스/포트원, 15-3)가 아직 계약 전이라
 * 그 경로를 만들 수 없고, 공급자가 없으면 프로그램도 만들 수 없어 개발이 막힙니다.
 *
 * 그래서 관리자 지정 스크립트(13번 P0)와 같은 방식으로 **Admin SDK 스크립트로만**
 * 공급자를 지정합니다. 이 경로를 화면이나 API로 만들지 않는 이유도 같습니다 —
 * 열어두면 누구나 공급자가 되어 심사 없이 프로그램을 올릴 수 있습니다.
 *
 * **정식 오픈 전에 반드시 해야 할 일:**
 *   1. `POST /auth/provider/apply` + 본인확인 + 자격증 제출 구현
 *   2. 관리자 심사(`POST /admin/providers/{id}/approve`)로 `verified`/`approvalStatus` 전환
 *   3. 이 스크립트로 만들어진 계정의 `approvalStatus`를 재심사
 *
 * 여기서 만드는 `private/profile.approvalStatus`는 `pending`입니다. `approved`로
 * 만들지 않는 것은 의도적입니다 — 심사를 거치지 않은 계정이 승인된 것처럼 보이면
 * 나중에 어느 계정이 실제로 심사를 통과했는지 구분할 수 없게 됩니다.
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";

export interface ProviderGrantDeps {
  db: Firestore;
}

export interface ProviderGrantResult {
  uid: string;
  previousRole: string | null;
  createdProfile: boolean;
}

export interface ProviderGrantInput {
  uid: string;
  /** 화면에 노출되는 활동명 (2-2). 없으면 users.name을 씁니다 */
  displayName?: string;
  bio?: string;
  qualificationType?: string[];
}

export async function grantProvider(
  input: ProviderGrantInput,
  deps: ProviderGrantDeps
): Promise<ProviderGrantResult> {
  const { uid } = input;
  const userRef = deps.db.doc(`users/${uid}`);
  const publicRef = deps.db.doc(`providerProfiles/${uid}`);
  const privateRef = deps.db.doc(`providerProfiles/${uid}/private/profile`);

  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    // 관리자 지정과 같은 원칙 — 가입을 마친 계정에만 부여합니다(12-3).
    throw new AppError(
      "failed-precondition",
      `users/${uid} 문서가 없습니다. 소셜 로그인으로 가입을 먼저 마쳐 주세요.`
    );
  }
  if (userSnap.get("role") === "admin") {
    // 관리자를 공급자로 내리면 Custom Claims와 role이 어긋납니다(13번 P0).
    throw new AppError(
      "failed-precondition",
      "관리자 계정은 공급자로 전환하지 않습니다. 별도 계정을 쓰세요."
    );
  }

  const previousRole = (userSnap.get("role") as string | undefined) ?? null;
  const publicSnap = await publicRef.get();

  const batch = deps.db.batch();

  batch.update(userRef, { role: "provider", updatedAt: FieldValue.serverTimestamp() });

  if (!publicSnap.exists) {
    batch.set(publicRef, {
      displayName: input.displayName ?? (userSnap.get("name") as string) ?? "공급자",
      bio: input.bio ?? "",
      profileImageUrl: null,
      qualificationType: input.qualificationType ?? [],
      // 심사를 거치지 않았으므로 false입니다. 화면의 "인증" 배지 근거값(2-2).
      verified: false,
      ratingAvg: 0,
      ratingCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    batch.set(privateRef, {
      certificateImageUrls: [],
      approvalStatus: "pending", // 임시 지정이므로 approved가 아닙니다
      approvalNote: null,
      approvedBy: null,
      approvedAt: null,
      bankAccount: null,
      warningCount: 0,
      activityRestriction: null,
    });
  }

  await batch.commit();

  return { uid, previousRole, createdProfile: !publicSnap.exists };
}

export interface ProviderStatusReport {
  uid: string;
  role: string | null;
  hasPublicProfile: boolean;
  hasPrivateProfile: boolean;
  approvalStatus: string | null;
  verified: boolean;
  consistent: boolean;
  problem: string | null;
}

/** 관리자 지정과 같은 이유로 상태 점검 경로를 둡니다 — 반쪽 상태를 눈으로 확인. */
export async function verifyProviderConsistency(
  uid: string,
  deps: ProviderGrantDeps
): Promise<ProviderStatusReport> {
  const [userSnap, publicSnap, privateSnap] = await Promise.all([
    deps.db.doc(`users/${uid}`).get(),
    deps.db.doc(`providerProfiles/${uid}`).get(),
    deps.db.doc(`providerProfiles/${uid}/private/profile`).get(),
  ]);

  const role = userSnap.exists ? ((userSnap.get("role") as string) ?? null) : null;
  const isProvider = role === "provider";

  let problem: string | null = null;
  if (isProvider && !publicSnap.exists) {
    problem =
      "role은 provider인데 providerProfiles 공개 문서가 없습니다. " +
      "프로그램 상세에서 운영자 정보가 뜨지 않습니다.";
  } else if (!isProvider && publicSnap.exists) {
    problem = "providerProfiles는 있는데 role이 provider가 아닙니다. 프로그램 등록이 거부됩니다.";
  } else if (publicSnap.exists && !privateSnap.exists) {
    problem = "공개 프로필은 있는데 private/profile이 없습니다. 심사·정산 정보가 없습니다.";
  }

  return {
    uid,
    role,
    hasPublicProfile: publicSnap.exists,
    hasPrivateProfile: privateSnap.exists,
    approvalStatus: privateSnap.exists
      ? ((privateSnap.get("approvalStatus") as string) ?? null)
      : null,
    verified: publicSnap.exists ? publicSnap.get("verified") === true : false,
    consistent: problem === null,
    problem,
  };
}
