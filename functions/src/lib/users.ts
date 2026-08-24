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

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";
import { maskPhone, normalizePhone } from "./phone";

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

/** 이름 길이 상한. 화면에 그대로 놓이는 값이라 레이아웃이 깨지지 않을 선입니다. */
const MAX_NAME_LENGTH = 30;

export interface UpdateMeInput {
  /** 보내지 않으면 그대로 둡니다 — `null`과 "안 보냄"은 다릅니다 */
  name?: string;
  phone?: string;
}

/**
 * 마이페이지에서 보내는 본문 검증.
 *
 * **보안규칙은 본인의 `users` 문서 수정을 허용하지만(6-1) 화면은 이 경로를 씁니다.**
 * 이유는 전화번호입니다 — 저장은 E.164 한 형식으로만 해야 하고(2-1), 그 정규화를
 * 거치지 않은 값이 섞이면 같은 번호가 다른 문자열로 남아 **중복 감지가 통째로
 * 무력해집니다**(15-4). 규칙은 방어선으로 두고 관문은 서버 하나로 유지합니다 —
 * 프로그램 수정에서 한 것과 같은 판단입니다(v22 ③).
 */
export function parseUpdateMeInput(body: unknown): UpdateMeInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const input: UpdateMeInput = {};

  if (b.name !== undefined) {
    const name = String(b.name ?? "").trim();
    // 빈 이름을 허용하지 않습니다. 이 값은 리뷰 작성자명 등으로 **다른 사용자에게
    // 그대로 노출**되므로(2-1), 비면 화면에 빈칸이 남습니다. 가입 시점의
    // 「이용자1234」 폴백은 값이 없을 때 만드는 것이고, 일부러 비우는 길이 아닙니다.
    if (name === "") {
      throw new AppError("invalid-argument", "이름을 입력해 주세요");
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new AppError(
        "invalid-argument",
        `이름은 ${MAX_NAME_LENGTH}자까지 쓸 수 있습니다`
      );
    }
    input.name = name;
  }

  if (b.phone !== undefined) {
    const raw = String(b.phone ?? "").trim();
    if (raw === "") {
      throw new AppError("invalid-argument", "연락처를 입력해 주세요");
    }
    const normalized = normalizePhone(raw);
    if (!normalized.ok || !normalized.e164) {
      throw new AppError(
        "invalid-argument",
        "연락처를 확인해 주세요 (예: 010-1234-5678)"
      );
    }
    input.phone = normalized.e164;
  }

  if (input.name === undefined && input.phone === undefined) {
    throw new AppError("invalid-argument", "바꿀 내용이 없습니다");
  }

  return input;
}

/**
 * 내 정보 수정 (마이페이지).
 *
 * **`role`·`status`는 이 경로로도 바뀌지 않습니다** — 입력에서 아예 읽지 않습니다.
 * 권한 부여는 Admin SDK 스크립트 전용이고(12-3), 탈퇴는 별도 경로입니다.
 *
 * 전화번호는 `phoneIndex`로 선점합니다(2-14). **번호를 문서 ID로 삼아 create로
 * 선점하는 방식만이 경합을 막습니다** — 트랜잭션은 쿼리 결과를 잠그지 못하므로
 * "이 번호 쓰는 사람 있나?"를 조회하는 방식은 동시 요청에서 나란히 통과합니다.
 */
export async function updateMe(
  db: Firestore,
  uid: string,
  input: UpdateMeInput
): Promise<MeResponse> {
  await db.runTransaction(async (tx) => {
    // ⚠️ **읽기를 모두 쓰기보다 앞에 둡니다.** Firestore 트랜잭션은 쓰기 뒤의
    //    읽기를 거부합니다("all reads before all writes"). 예전 번호 조회를
    //    선점 쓰기 뒤에 두었다가 이 규칙에 걸렸습니다(테스트가 잡았습니다).
    const userRef = db.doc(`users/${uid}`);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new AppError(
        "failed-precondition",
        "가입 정보를 찾을 수 없습니다. 다시 로그인해 주세요."
      );
    }

    const previousPhone = (userSnap.get("phone") as string | null) ?? null;
    const phoneChanged = input.phone !== undefined && previousPhone !== input.phone;

    // ── 읽기 단계 ────────────────────────────────────────────────
    const indexRef = phoneChanged ? db.doc(`phoneIndex/${input.phone}`) : null;
    const previousRef =
      phoneChanged && previousPhone ? db.doc(`phoneIndex/${previousPhone}`) : null;

    const [indexSnap, previousSnap] = await Promise.all([
      indexRef ? tx.get(indexRef) : Promise.resolve(null),
      previousRef ? tx.get(previousRef) : Promise.resolve(null),
    ]);

    if (indexSnap?.exists && (indexSnap.get("uid") as string | undefined) !== uid) {
      // **여기서는 막습니다.** 2-14가 "선점 실패는 가입을 막지 않는다"고 정한
      // 근거는 「번호가 첫 예약 화면에서 들어오는 사용자가 되돌아갈 곳 없이
      // 멈춘다」인데, 마이페이지는 그 상황이 아닙니다 — 사용자가 스스로 설정을
      // 고치는 자리라 그냥 두고 나갈 수 있습니다. 반대로 조용히 저장하지 않으면
      // 「저장했다는데 안 바뀌는」 고장으로 읽힙니다.
      console.warn("[users] duplicate phone rejected on profile update", {
        uid,
        phone: maskPhone(input.phone!),
      });
      throw new AppError("failed-precondition", "이미 다른 계정에서 쓰고 있는 연락처입니다");
    }

    // ── 쓰기 단계 ────────────────────────────────────────────────
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (input.name !== undefined) patch.name = input.name;

    if (phoneChanged) {
      if (indexRef && !indexSnap?.exists) {
        tx.set(indexRef, { uid, createdAt: FieldValue.serverTimestamp() });
      }
      // 예전 번호의 선점은 풀어줍니다 — 남겨두면 번호를 바꾼 사용자가
      // 되돌릴 수 없고, 그 번호를 실제로 쓰는 사람도 못 씁니다.
      if (previousRef && previousSnap?.exists && previousSnap.get("uid") === uid) {
        tx.delete(previousRef);
      }
      patch.phone = input.phone;
    }

    tx.update(userRef, patch);
  });

  // 바뀐 값을 다시 읽어 돌려줍니다 — 화면이 저장 후 상태를 따로 조립하지
  // 않게 하려는 것입니다(조립하면 서버와 어긋날 여지가 생깁니다).
  return getMe(db, uid);
}
