/**
 * 관리자 지정/회수 (스키마 13번 P0, 12-3).
 *
 * `users.role='admin'`과 Custom Claims `admin:true`를 **반드시 함께** 갱신합니다.
 * 보안규칙의 isAdmin()은 Custom Claims만 보고, 화면의 조건부 메뉴는 users.role을
 * 보기 때문에 하나만 하면 반쪽짜리 상태가 됩니다.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 갱신 순서를 users.role → Custom Claims 로 정한 근거 (비대칭)
 * ─────────────────────────────────────────────────────────────────────────────
 * 두 갱신 중 하나만 남았을 때 생기는 결과가 서로 대칭이 아닙니다.
 *
 *   ① 클레임만 남은 경우 — 화면에는 일반 사용자로 보이는데 보안규칙과 함수
 *      진입부는 관리자로 통과시킵니다. **권한이 있는데 아무도 그 사실을
 *      모르는 상태**이고, 관리자 목록(users.role 조회)에도 잡히지 않아
 *      회수 대상에서 누락됩니다. 12-3의 "책임 추적"이 그대로 깨집니다.
 *
 *   ② role만 남은 경우 — 헤더에 관리자 메뉴는 뜨지만 함수 진입부(6-2 ①)와
 *      보안규칙 isAdmin()이 전부 막습니다. 화면 껍데기만 열리고 데이터는
 *      내려오지 않습니다. **눈에 띄고, 권한은 새지 않는 안전한 실패**입니다.
 *
 * 그래서 위험한 쪽(클레임)을 **나중에** 두고, 실패하면 앞 단계를 되돌립니다.
 * 되돌리기도 실패하면 사람이 개입해야 하므로 무엇이 어긋났는지 그대로 알립니다.
 * 마지막에 두 값을 다시 읽어 검증하는 단계까지가 한 세트입니다.
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { AppError } from "./errors";
import { auth as defaultAuth, db as defaultDb } from "./firebase";

/** 이 모듈이 Auth에서 실제로 쓰는 것만 추린 인터페이스(테스트에서 실패 주입용). */
export interface AuthPort {
  getUser(uid: string): Promise<{ uid: string; customClaims?: Record<string, unknown> }>;
  getUserByEmail(email: string): Promise<{ uid: string }>;
  setCustomUserClaims(uid: string, claims: Record<string, unknown> | null): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
}

export interface AdminGrantDeps {
  authPort: AuthPort;
  db: Firestore;
}

export function defaultDeps(): AdminGrantDeps {
  const a = defaultAuth();
  return {
    // 메서드를 그대로 넘기면 this가 끊기므로 감싸서 넘깁니다.
    authPort: {
      getUser: (uid) => a.getUser(uid),
      getUserByEmail: (email) => a.getUserByEmail(email),
      setCustomUserClaims: (uid, claims) => a.setCustomUserClaims(uid, claims),
      revokeRefreshTokens: (uid) => a.revokeRefreshTokens(uid),
    },
    db: defaultDb(),
  };
}

export interface ConsistencyReport {
  uid: string;
  /** Custom Claims의 admin === true 인지 */
  claimAdmin: boolean;
  /** users/{uid}.role 값 (문서나 필드가 없으면 null) */
  role: string | null;
  userDocExists: boolean;
  /** 두 값이 같은 방향을 가리키는지 */
  consistent: boolean;
  /** 어긋났을 때 사람이 읽을 설명 */
  problem: string | null;
}

/**
 * 두 값을 다시 읽어 짝이 맞는지 확인합니다.
 * 지정 직후 검증에도 쓰고, `--check` 모드로 단독 점검에도 씁니다.
 */
export async function verifyAdminConsistency(
  uid: string,
  deps: AdminGrantDeps = defaultDeps()
): Promise<ConsistencyReport> {
  const [user, snap] = await Promise.all([
    deps.authPort.getUser(uid),
    deps.db.doc(`users/${uid}`).get(),
  ]);

  const claimAdmin = user.customClaims?.admin === true;
  const userDocExists = snap.exists;
  const role = userDocExists ? ((snap.get("role") as string | undefined) ?? null) : null;
  const roleAdmin = role === "admin";

  let problem: string | null = null;
  if (claimAdmin && !roleAdmin) {
    problem =
      "Custom Claims에는 admin:true가 있는데 users.role은 admin이 아닙니다. " +
      "권한은 살아 있으면서 관리자 목록에는 잡히지 않는 상태입니다(추적 불가).";
  } else if (!claimAdmin && roleAdmin) {
    problem =
      "users.role은 admin인데 Custom Claims에 admin:true가 없습니다. " +
      "관리자 메뉴는 보이지만 규칙·함수가 전부 막아 화면이 동작하지 않습니다.";
  } else if (!userDocExists) {
    problem = "users/{uid} 문서가 없습니다. 가입을 먼저 마쳐야 합니다(12-3).";
  }

  return {
    uid,
    claimAdmin,
    role,
    userDocExists,
    consistent: problem === null,
    problem,
  };
}

export async function resolveUid(
  target: { uid?: string; email?: string },
  deps: AdminGrantDeps = defaultDeps()
): Promise<string> {
  if (target.uid) return target.uid;
  if (target.email) {
    const user = await deps.authPort.getUserByEmail(target.email);
    return user.uid;
  }
  throw new AppError("invalid-argument", "--uid 또는 --email 중 하나가 필요합니다");
}

export interface GrantResult {
  uid: string;
  previousRole: string | null;
  report: ConsistencyReport;
}

/**
 * 관리자 지정.
 *
 * 선행 조건으로 **Auth 계정과 users/{uid} 문서가 이미 있어야** 합니다.
 * 12-3의 "각자 개인 계정으로 가입한 뒤 그 계정에만 권한을 부여한다"를 코드로
 * 강제하는 부분입니다 — 여기서 문서를 새로 만들어 주면 가입을 거치지 않은
 * 공용 계정에도 권한이 붙을 수 있고, 그러면 누가 승인했는지 남지 않습니다.
 */
export async function grantAdmin(
  uid: string,
  deps: AdminGrantDeps = defaultDeps()
): Promise<GrantResult> {
  // ── 1. 선행 조건 ──────────────────────────────────────────────────────
  let user: { uid: string; customClaims?: Record<string, unknown> };
  try {
    user = await deps.authPort.getUser(uid);
  } catch {
    throw new AppError("not-found", `Auth에 uid=${uid} 계정이 없습니다`);
  }

  const ref = deps.db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new AppError(
      "failed-precondition",
      `users/${uid} 문서가 없습니다. 소셜 로그인으로 가입을 먼저 마친 계정에만 ` +
        `권한을 부여합니다(12-3 — 공용 계정 금지).`
    );
  }

  const previousRole = (snap.get("role") as string | undefined) ?? null;
  const previousClaims = user.customClaims ?? {};

  // ── 2. users.role 먼저 (실패해도 권한은 새지 않는 쪽) ─────────────────
  await ref.update({ role: "admin", updatedAt: FieldValue.serverTimestamp() });

  // ── 3. Custom Claims 나중 (실패 시 2를 되돌린다) ──────────────────────
  try {
    await deps.authPort.setCustomUserClaims(uid, { ...previousClaims, admin: true });
  } catch (claimError) {
    try {
      await ref.update({
        role: previousRole === null ? FieldValue.delete() : previousRole,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (rollbackError) {
      // 되돌리기까지 실패하면 role만 admin으로 남습니다(위 ②의 안전한 실패).
      // 자동으로 더 손대지 않고 사람에게 넘깁니다 — 여기서 재시도 루프를 돌리면
      // 무엇이 실제 상태인지 알 수 없게 됩니다.
      throw new AppError(
        "internal",
        `Custom Claims 설정에 실패했고 users.role 롤백도 실패했습니다. ` +
          `users/${uid}.role을 '${previousRole ?? "(없음)"}'로 직접 되돌리세요. ` +
          `원인: ${String(claimError)} / 롤백 실패: ${String(rollbackError)}`
      );
    }
    throw new AppError(
      "internal",
      `Custom Claims 설정에 실패해 users.role을 되돌렸습니다. 변경된 것은 없습니다. ` +
        `원인: ${String(claimError)}`
    );
  }

  // ── 4. 두 값을 다시 읽어 검증 ─────────────────────────────────────────
  const report = await verifyAdminConsistency(uid, deps);
  if (!report.consistent) {
    throw new AppError(
      "internal",
      `지정 후 검증에 실패했습니다: ${report.problem ?? "알 수 없는 불일치"}`
    );
  }

  return { uid, previousRole, report };
}

export interface RevokeResult {
  uid: string;
  report: ConsistencyReport;
}

/**
 * 관리자 회수.
 *
 * 순서는 지정과 반대입니다 — **위험한 쪽(클레임)을 먼저 내립니다.**
 * 회수에서는 "권한이 남아 있는 상태"가 위험한 쪽이므로, 먼저 끊고
 * 그다음에 표시용 role을 정리하는 것이 안전합니다.
 *
 * Custom Claims는 이미 발급된 ID 토큰에 소급 적용되지 않아 기본 1시간까지
 * 유효하므로, revokeRefreshTokens로 세션을 함께 끊습니다(6-2 ②).
 */
export async function revokeAdmin(
  uid: string,
  /**
   * 회수 후 돌려놓을 role. 스크립트는 이전 role을 기억하지 못하므로
   * (지정과 회수가 다른 날 실행됩니다) 기본값은 consumer이고,
   * 공급자였던 계정은 --role provider 로 명시해야 합니다.
   */
  nextRole: "consumer" | "provider" = "consumer",
  deps: AdminGrantDeps = defaultDeps()
): Promise<RevokeResult> {
  const user = await deps.authPort.getUser(uid);
  const { admin: _dropped, ...restClaims } = user.customClaims ?? {};
  void _dropped;

  await deps.authPort.setCustomUserClaims(uid, restClaims);
  await deps.authPort.revokeRefreshTokens(uid);

  const ref = deps.db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (snap.exists && snap.get("role") === "admin") {
    await ref.update({ role: nextRole, updatedAt: FieldValue.serverTimestamp() });
  }

  return { uid, report: await verifyAdminConsistency(uid, deps) };
}
