/**
 * 내 계정 조회 (스키마 5번 · 2-1).
 *
 * 화면이 "이 사람이 공급자인가 / 심사 대기 중인가"를 알아야 하는 곳은
 * 공급자 안내 화면과 헤더 메뉴입니다. 그 판단을 클라이언트가 Firestore를
 * 직접 읽어서 하지 않는 이유는 두 가지입니다.
 *
 * ① `providerProfiles/{uid}/private/profile`은 본인만 읽을 수 있지만(6-1),
 *    화면마다 문서 2~3개를 따로 읽으면 어느 화면은 읽고 어느 화면은 빠뜨리는
 *    상태가 생깁니다. 여기서 한 번에 합쳐 내려보냅니다.
 * ② **`role`은 화면 상태로 신뢰할 값이 아닙니다.** 실제 차단은 함수 진입부와
 *    보안규칙이 합니다(12-3). 이 응답은 UX 분기용입니다.
 *
 * 민감값은 내려보내지 않습니다 — `private/identity`(실명·CI·DI)는 아예 읽지
 * 않고, 정산 계좌(`bankAccount`)도 이 응답에 넣지 않습니다.
 */

import type { Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";

export interface MeResponse {
  uid: string;
  role: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  profileImageUrl: string | null;
  status: string;
  authProvider: string | null;
  identityVerifiedAt: unknown;
  /** 공급자가 아니면 null */
  provider: {
    displayName: string | null;
    verified: boolean;
    /** pending / approved / rejected — 심사 상태 (2-2) */
    approvalStatus: string | null;
    /** 반려 사유. 본인에게는 보여줘야 재신청이 가능합니다 */
    approvalNote: string | null;
  } | null;
}

export async function getMe(db: Firestore, uid: string): Promise<MeResponse> {
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    // 소셜 로그인은 users 문서 생성까지 마치고 끝납니다(2-14). 여기 없다는 것은
    // 가입이 중간에 끊긴 상태이므로 재로그인을 유도합니다.
    throw new AppError("failed-precondition", "가입 정보를 찾을 수 없습니다. 다시 로그인해 주세요.");
  }

  const user = userSnap.data() as Record<string, unknown>;
  const role = (user.role as string) ?? "consumer";

  let provider: MeResponse["provider"] = null;
  if (role === "provider") {
    const [publicSnap, privateSnap] = await Promise.all([
      db.doc(`providerProfiles/${uid}`).get(),
      db.doc(`providerProfiles/${uid}/private/profile`).get(),
    ]);
    provider = {
      displayName: publicSnap.exists ? ((publicSnap.get("displayName") as string) ?? null) : null,
      verified: publicSnap.exists ? publicSnap.get("verified") === true : false,
      approvalStatus: privateSnap.exists
        ? ((privateSnap.get("approvalStatus") as string) ?? null)
        : null,
      approvalNote: privateSnap.exists
        ? ((privateSnap.get("approvalNote") as string) ?? null)
        : null,
    };
  }

  return {
    uid,
    role,
    name: (user.name as string) ?? null,
    email: (user.email as string) ?? null,
    phone: (user.phone as string) ?? null,
    profileImageUrl: (user.profileImageUrl as string) ?? null,
    status: (user.status as string) ?? "active",
    authProvider: (user.authProvider as string) ?? null,
    identityVerifiedAt: user.identityVerifiedAt ?? null,
    provider,
  };
}
