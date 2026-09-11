/**
 * 출입증(Custom Claims)의 전문가 표시 (2026-09-11).
 *
 * **헤더가 「이 사람이 전문가인가」를 서버에 묻지 않고 알게 하려고 둡니다.** 로그인한
 * 사람이 페이지를 열 때마다 `GET /users/me`를 부르면 요청이 방문 수만큼 늘고, 답이
 * 올 때까지 헤더 버튼이 **「전문가로 활동하기」로 떴다가 「프로그램 등록」으로 바뀌는**
 * 깜빡임이 매번 보입니다. 출입증은 로그인할 때 이미 손에 있으므로 둘 다 없어집니다.
 *
 * ⚠️ **이 값은 화면 표시용입니다. 권한 판단에 쓰지 마세요.**
 * 관리자 출입증(`admin`)과 쓰임이 다릅니다 — 그쪽은 보안규칙과 함수 진입부가 보는
 * 값이지만, 이 둘은 **버튼을 무엇으로 그릴지**만 정합니다. 실제 차단은 지금처럼
 * 서버가 `users.role`과 `approvalStatus`를 직접 읽어서 합니다(`assertProvider`).
 * 출입증은 최대 1시간 낡을 수 있어서(아래), 그 사이에 권한이 새면 안 됩니다.
 *
 * **출입증은 바로 바뀌지 않습니다.** 여기서 값을 적어도 이미 발급된 출입증에는
 * 소급되지 않고, 브라우저가 다음에 갱신할 때(약 1시간) 또는 다시 로그인할 때
 * 반영됩니다. 그래서 **로그인 경로에서 한 번 더 맞춥니다**(`syncProviderClaims`) —
 * 「로그아웃 후 재로그인」이 언제나 즉시 고치는 방법이 되고, 어긋난 채로 굳지
 * 않습니다.
 *
 * **바뀐 게 없으면 쓰지 않습니다.** 출입증을 쓰는 것은 공짜가 아니고, 로그인할
 * 때마다 값을 덮으면 아무 이유 없이 매번 쓰기가 생깁니다.
 */

import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

/** 출입증에 적는 전문가 표시 두 가지. */
export interface ProviderClaimState {
  /** 전문가 계정인가 (`users.role === 'provider'`) */
  provider: boolean;
  /** 자격 심사를 통과했는가 (`providerProfiles/{uid}/private/profile.approvalStatus === 'approved'`) */
  providerApproved: boolean;
}

/**
 * 출입증을 읽고 쓰는 통로. 테스트에서 갈아끼우기 위해 인터페이스로 둡니다
 * (`adminGrant.ts`의 `AuthPort`와 같은 이유).
 */
export interface ProviderClaimsPort {
  getClaims(uid: string): Promise<Record<string, unknown>>;
  setClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
}

export const NO_PROVIDER_CLAIMS: ProviderClaimState = {
  provider: false,
  providerApproved: false,
};

/** 실제 값(회원 정보)을 읽습니다 — 출입증이 아니라 이쪽이 기준입니다. */
export async function readProviderState(
  db: Firestore,
  uid: string
): Promise<ProviderClaimState> {
  const [userSnap, privateSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`providerProfiles/${uid}/private/profile`).get(),
  ]);

  const provider = userSnap.exists && userSnap.get("role") === "provider";
  // 전문가가 아닌 계정에 「승인됨」만 남는 일이 없게 합니다 — 자격이 회수되면
  // 승인 표시도 함께 사라져야 합니다.
  const providerApproved =
    provider && privateSnap.exists && privateSnap.get("approvalStatus") === "approved";

  return { provider, providerApproved };
}

/** 지금 출입증에 적힌 값. 없는 키는 false로 봅니다. */
function claimStateOf(claims: Record<string, unknown>): ProviderClaimState {
  return {
    provider: claims.provider === true,
    providerApproved: claims.providerApproved === true,
  };
}

/**
 * 출입증을 실제 값에 맞춥니다. **바뀐 것이 있을 때만 씁니다.**
 *
 * `admin` 같은 다른 표시는 그대로 둡니다 — 출입증 쓰기는 전체를 덮어쓰는 방식이라
 * 이전 값을 합치지 않으면 **관리자 권한이 조용히 사라집니다**(`adminGrant`도 같은
 * 방식으로 합칩니다).
 *
 * @returns 실제로 고쳤으면 true
 */
export async function syncProviderClaims(
  port: ProviderClaimsPort,
  uid: string,
  next: ProviderClaimState
): Promise<boolean> {
  const previous = await port.getClaims(uid);
  const current = claimStateOf(previous);

  if (current.provider === next.provider && current.providerApproved === next.providerApproved) {
    return false;
  }

  const merged: Record<string, unknown> = { ...previous };
  // 값이 false면 키를 지웁니다 — 출입증은 크기 제한이 있고, 「없음」과 「false」를
  // 굳이 구분할 이유가 없습니다.
  if (next.provider) merged.provider = true;
  else delete merged.provider;
  if (next.providerApproved) merged.providerApproved = true;
  else delete merged.providerApproved;

  await port.setClaims(uid, merged);
  return true;
}

/**
 * 회원 정보를 읽어 출입증을 맞춥니다 — 로그인 경로가 쓰는 형태.
 *
 * **실패해도 로그인을 막지 않습니다.** 출입증의 이 두 값은 버튼 모양만 정하므로,
 * 여기서 넘어져 로그인 자체가 실패하면 잃는 것이 훨씬 큽니다.
 */
export async function syncProviderClaimsFromDb(
  db: Firestore,
  port: ProviderClaimsPort,
  uid: string
): Promise<boolean> {
  try {
    return await syncProviderClaims(port, uid, await readProviderState(db, uid));
  } catch {
    return false;
  }
}

/** Admin SDK로 만든 실제 통로. 테스트는 이 자리에 가짜를 넣습니다. */
export function adminClaimsPort(auth: Auth): ProviderClaimsPort {
  return {
    async getClaims(uid) {
      const user = await auth.getUser(uid);
      return user.customClaims ?? {};
    },
    setClaims(uid, claims) {
      return auth.setCustomUserClaims(uid, claims);
    },
  };
}
