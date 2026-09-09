/**
 * 소셜 가입·재로그인 시 `users` 문서 처리 (스키마 v14 / 2-1 / 15-4 / 2-12).
 *
 * 규칙이 여러 개라 한 곳에 모읍니다 — 흩어놓으면 카카오를 붙일 때 한두 개를
 * 빠뜨리게 되고, 빠뜨린 사실이 화면에 드러나지 않습니다.
 *
 *  1. `role`은 **문서를 새로 만들 때만** `consumer`로 씁니다. 재로그인 경로에
 *     절대 포함하지 않습니다 — merge로 매번 쓰면 관리자가 로그인할 때마다
 *     `users.role`이 consumer로 되돌아가고, Custom Claims(admin:true)만 남아
 *     "권한은 살아 있는데 관리자 목록에 안 잡히는" 상태가 됩니다.
 *  2. `name`은 절대 덮어쓰지 않습니다. 사용자가 마이페이지에서 바꾼 값이 기준.
 *  3. `email`·`profileImageUrl`은 **우리 쪽이 비어 있을 때만** 채웁니다
 *     (fill-if-empty) — 나중에 프로필 사진 제공을 켰을 때 기존 사용자도 채워져야 합니다.
 *  3-1. **전화번호는 예외입니다 — 소셜이 준 번호가 항상 이깁니다** (2026-09-09, 2-14).
 *     소셜 번호는 그 서비스가 본인 확인을 거친 값이고 마이페이지에서 잠겨 있으므로
 *     (`users.ts`), 네이버에서 번호를 바꾼 사람이 우리 쪽을 고칠 길은 **재로그인**뿐입니다.
 *     비어 있을 때만 채우면 그 사람은 잠긴 칸을 보면서 고칠 방법이 없습니다.
 *     직접 입력한 번호(`phoneSource='manual'`)도 소셜 번호가 오면 교체합니다 —
 *     인증 안 된 값보다 인증된 값이 우선입니다.
 *  4. 실명·성별·생일·연령대는 받지도 저장하지도 로그에 남기지도 않습니다.
 *  5. 전화번호는 E.164로 정규화해 저장하고 `phoneIndex`로 중복을 감지하되,
 *     **중복이어도 가입·예약을 막지 않습니다**(v14). 차단은 쿠폰 발급 시점.
 *     번호가 바뀌면 예전 번호의 선점은 풀어줍니다(우리 것일 때만).
 *  6. 탈퇴(`withdrawn`) 계정은 자동으로 되살리지 않습니다.
 *  7. 저장할 때 `phoneSource`(어디서 온 번호인가)를 함께 기록합니다 — 마이페이지가
 *     이 값으로 「잠글지 / 고칠 수 있게 할지」를 가릅니다.
 */

import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { AppError } from "./errors";
import { maskPhone, normalizePhone } from "./phone";
import type { SocialProfile } from "./naver";

export type SocialProvider = "naver" | "kakao";

/** 동의 이력에 남길 약관 버전. 약관 문구를 고치면 이 값을 올립니다(2-12). */
export const TERMS_VERSION = "2026-08-14";

export interface AuthUserPort {
  getUser(uid: string): Promise<{ uid: string } | null>;
  createUser(uid: string): Promise<void>;
}

export interface SocialUpsertDeps {
  db: Firestore;
  authUser: AuthUserPort;
}

export interface SocialUpsertInput {
  provider: SocialProvider;
  profile: SocialProfile;
  /** 마케팅 수신 동의 — 선택 항목이라 기본 false */
  marketingAgreed?: boolean;
}

export interface SocialUpsertResult {
  uid: string;
  isNew: boolean;
  /** 이미 다른 계정이 쓰는 번호였는지 (기록용, 차단하지 않음) */
  phoneDuplicated: boolean;
}

/**
 * 공급자 식별자로 Firebase uid를 만듭니다.
 * 같은 소셜 계정으로 다시 로그인하면 같은 uid가 나와야 기존 문서를 찾습니다.
 * 공급자를 접두사로 붙여 카카오·네이버 식별자가 우연히 겹치는 경우를 막습니다.
 */
export function socialUid(provider: SocialProvider, providerUserId: string): string {
  return `${provider}_${providerUserId}`;
}

/**
 * 표시 이름 결정 — ① 소셜 별명 → ② `이용자` + uid 뒤 4자리.
 *
 * **이메일 앞부분은 쓰지 않습니다.** 이 값은 리뷰 작성자명 등으로 다른 사용자에게
 * 노출되는데, 이메일 지역부를 넣으면 도메인이 소셜 공급자로 좁혀져 사실상 이메일
 * 주소가 화면에 뜹니다. `email` 자체도 null일 수 있어 폴백이 끊깁니다(2-1).
 *
 * **앞 4자리가 아니라 뒤 4자리인 이유:** uid가 `naver_...` 형태라 앞 4자리는
 * 모든 사용자가 `nave`로 같습니다. 문서 2-1의 "앞 4자리" 표현은 uid 형식이
 * 정해지기 전에 쓴 것이라 v14에서 뒤 4자리로 정정했습니다.
 */
export function resolveDisplayName(nickname: string | null, uid: string): string {
  const trimmed = nickname?.trim();
  if (trimmed) return trimmed;
  return `이용자${uid.slice(-4)}`;
}

/** 소셜에서 온 번호를 E.164로. 파싱되지 않으면 null — 가입을 막을 이유는 없습니다(15-4). */
function normalizeSocialPhone(rawPhone: string | null): string | null {
  if (!rawPhone) return null;
  const normalized = normalizePhone(rawPhone);
  if (!normalized.ok || !normalized.e164) {
    console.warn("[social] phone normalize failed", { reason: normalized.error });
    return null;
  }
  return normalized.e164;
}

interface PhoneDecision {
  /** 소셜이 준 번호(E.164). 없거나 파싱 실패면 null */
  incoming: string | null;
  /** 남이 이미 선점한 번호인가 — 기록만 하고 차단하지 않습니다(v14) */
  duplicated: boolean;
  /** 트랜잭션 쓰기 단계에서 선점 문서를 새로 만들어야 하는가 */
  needsClaim: boolean;
  /** 예전 번호의 선점 문서를 풀어야 하는가(우리 것일 때만) */
  releasePrevious: boolean;
}

/**
 * 번호에 관한 **읽기**를 한곳에서 끝냅니다 — Firestore 트랜잭션은 쓰기 뒤의 읽기를
 * 거부하므로("all reads before all writes"), 새 번호·예전 번호의 선점 문서를 여기서
 * 모두 읽어두고 쓰기는 호출자가 합니다. 마이페이지(`users.ts`)와 같은 판단입니다.
 */
async function decidePhone(
  tx: Transaction,
  db: Firestore,
  uid: string,
  rawPhone: string | null,
  storedPhone: string | null
): Promise<PhoneDecision> {
  const incoming = normalizeSocialPhone(rawPhone);
  const none: PhoneDecision = {
    incoming,
    duplicated: false,
    needsClaim: false,
    releasePrevious: false,
  };
  if (!incoming) return none;

  const newRef = db.doc(`phoneIndex/${incoming}`);
  const prevRef = storedPhone && storedPhone !== incoming ? db.doc(`phoneIndex/${storedPhone}`) : null;
  const [newSnap, prevSnap] = await Promise.all([
    tx.get(newRef),
    prevRef ? tx.get(prevRef) : Promise.resolve(null),
  ]);

  const owner = newSnap.exists ? (newSnap.get("uid") as string | undefined) : undefined;
  if (owner && owner !== uid) {
    // v14 — 감지·기록만 하고 차단하지 않습니다. 카카오 사용자는 번호가 첫 예약
    // 화면에서 들어오므로 그 시점에 막으면 되돌아갈 곳이 없어집니다.
    console.warn("[social] duplicate phone detected", { uid, phone: maskPhone(incoming) });
    return { ...none, duplicated: true };
  }

  return {
    incoming,
    duplicated: false,
    needsClaim: !newSnap.exists,
    releasePrevious: !!prevSnap?.exists && prevSnap.get("uid") === uid,
  };
}

/** 번호 결정을 실제 쓰기로 옮깁니다(선점 생성·예전 선점 해제). */
function applyPhoneClaim(
  tx: Transaction,
  db: Firestore,
  uid: string,
  decision: PhoneDecision,
  storedPhone: string | null
): void {
  if (!decision.incoming || decision.duplicated) return;
  if (decision.needsClaim) {
    tx.set(db.doc(`phoneIndex/${decision.incoming}`), {
      uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  if (decision.releasePrevious && storedPhone) {
    // 안 풀면 번호를 바꾼 사람이 되돌릴 수 없고, 그 번호를 실제로 쓰는 사람도 못 씁니다.
    tx.delete(db.doc(`phoneIndex/${storedPhone}`));
  }
}

export async function upsertSocialUser(
  input: SocialUpsertInput,
  deps: SocialUpsertDeps
): Promise<SocialUpsertResult> {
  const uid = socialUid(input.provider, input.profile.providerUserId);

  // Auth 계정 먼저. 여기서 실패하면 Firestore를 건드리지 않습니다.
  const existing = await deps.authUser.getUser(uid);
  if (!existing) {
    await deps.authUser.createUser(uid);
  }

  const userRef = deps.db.doc(`users/${uid}`);

  return deps.db.runTransaction(async (tx) => {
    // ── 읽기 먼저 (Firestore 트랜잭션 규칙) ──────────────────────────────
    const userSnap = await tx.get(userRef);
    const storedPhone = userSnap.exists
      ? ((userSnap.get("phone") as string | null | undefined) ?? null)
      : null;
    const decision = await decidePhone(tx, deps.db, uid, input.profile.phone, storedPhone);
    // 소셜이 준 번호 중 실제로 우리 것이 되는 값. 남이 선점했으면 null(2-14).
    const socialPhone = decision.incoming && !decision.duplicated ? decision.incoming : null;

    // ── 신규 가입 ───────────────────────────────────────────────────────
    if (!userSnap.exists) {
      applyPhoneClaim(tx, deps.db, uid, decision, null);
      tx.set(userRef, {
        role: "consumer", // 새 문서일 때만 씁니다
        authProvider: input.provider,
        name: resolveDisplayName(input.profile.nickname, uid),
        email: input.profile.email,
        phone: socialPhone,
        // 어디서 온 번호인지 — 마이페이지가 이 값으로 잠금 여부를 가릅니다(2-14)
        phoneSource: socialPhone ? input.provider : null,
        profileImageUrl: input.profile.profileImageUrl,
        status: "active",
        identityVerifiedAt: null, // 소비자는 항상 null (15-1)
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 약관 동의 이력 — 가입과 같은 트랜잭션에 넣습니다(2-12, 법적 증빙)
      tx.set(deps.db.collection("termsAgreements").doc(), {
        uid,
        service: true,
        privacy: true,
        marketing: input.marketingAgreed === true,
        version: TERMS_VERSION,
        agreedAt: FieldValue.serverTimestamp(),
      });

      return { uid, isNew: true, phoneDuplicated: decision.duplicated };
    }

    // ── 재로그인 ────────────────────────────────────────────────────────
    if (userSnap.get("status") === "withdrawn") {
      // 자동으로 되살리지 않습니다. 재활성화는 관리자 경로로만(5번).
      throw new AppError(
        "failed-precondition",
        "탈퇴한 계정입니다. 다시 이용하시려면 고객센터로 문의해 주세요."
      );
    }

    // fill-if-empty — 우리 쪽이 비어 있는 항목만 채웁니다.
    // role·name은 여기 절대 넣지 않습니다.
    const patch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!userSnap.get("email") && input.profile.email) {
      patch.email = input.profile.email;
    }
    if (!userSnap.get("profileImageUrl") && input.profile.profileImageUrl) {
      patch.profileImageUrl = input.profile.profileImageUrl;
    }
    // 이름이 비어 있는 옛 문서를 만나면 그때만 폴백으로 채웁니다.
    if (!userSnap.get("name")) {
      patch.name = resolveDisplayName(input.profile.nickname, uid);
    }

    // 전화번호는 fill-if-empty가 아닙니다 — 소셜 번호가 항상 이깁니다(파일 상단 3-1).
    // 남이 선점한 번호면 우리 쪽 값을 건드리지 않고 기록만 남깁니다(2-14).
    // 소셜이 번호를 안 주면(카카오 심사 전 등) 우리 쪽 값을 그대로 둡니다.
    if (socialPhone) {
      applyPhoneClaim(tx, deps.db, uid, decision, storedPhone);
      if (storedPhone !== socialPhone) {
        patch.phone = socialPhone;
      }
      // 같은 번호라도 출처가 안 적힌 옛 문서(2026-09-09 이전 가입)는 여기서 채워집니다 —
      // 그래야 마이페이지가 그 번호를 소셜 번호로 알고 잠급니다.
      if (userSnap.get("phoneSource") !== input.provider) {
        patch.phoneSource = input.provider;
      }
    }

    tx.update(userRef, patch);
    return { uid, isNew: false, phoneDuplicated: decision.duplicated };
  });
}
