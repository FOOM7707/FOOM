/**
 * 테스트 공용 도우미.
 *
 * 반드시 `firebase emulators:exec --only auth,functions,firestore --project demo-foom`
 * 안에서 실행됩니다. 에뮬레이터 환경변수가 없으면 **실서버를 건드릴 수 있으므로**
 * 즉시 실패시킵니다.
 */

import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export const PROJECT_ID = "demo-foom";
export const FUNCTIONS_REGION = "asia-northeast3";

function assertEmulator(): void {
  const missing = [
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
  ].filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `에뮬레이터 환경이 아닙니다(${missing.join(", ")} 없음). ` +
        `npm test 로 실행하세요 — 실서버에 붙는 사고를 막기 위한 확인입니다.`
    );
  }
}

assertEmulator();

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}

export const testAuth = getAuth();
export const testDb = getFirestore();

/** adminGrant가 쓰는 AuthPort의 실제 구현(테스트에서 일부만 바꿔 끼웁니다). */
export function realAuthPort() {
  return {
    getUser: (uid: string) => testAuth.getUser(uid),
    getUserByEmail: (email: string) => testAuth.getUserByEmail(email),
    setCustomUserClaims: (uid: string, claims: Record<string, unknown> | null) =>
      testAuth.setCustomUserClaims(uid, claims),
    revokeRefreshTokens: (uid: string) => testAuth.revokeRefreshTokens(uid),
  };
}

export function testDeps() {
  return { authPort: realAuthPort(), db: testDb };
}

let seq = 0;

/** 가입까지 마친 사용자(Auth 계정 + users/{uid} 문서)를 만듭니다. */
export async function createSignedUpUser(
  role: "consumer" | "provider" = "consumer"
): Promise<string> {
  seq += 1;
  const uid = `test-user-${Date.now()}-${seq}`;
  await testAuth.createUser({ uid, email: `${uid}@example.com` });
  await testDb.doc(`users/${uid}`).set({
    role,
    authProvider: "naver",
    name: "테스트계정",
    phone: null,
    email: `${uid}@example.com`,
    profileImageUrl: null,
    status: "active",
    identityVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return uid;
}

/** Auth 에뮬레이터에서 실제 ID 토큰을 발급받습니다(커스텀 토큰 → 교환). */
export async function issueIdToken(uid: string): Promise<string> {
  const customToken = await testAuth.createCustomToken(uid);
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  if (!res.ok) {
    throw new Error(`ID 토큰 발급 실패: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { idToken?: string };
  if (!body.idToken) throw new Error("ID 토큰이 응답에 없습니다");
  return body.idToken;
}

let cachedFunctionsHost: string | null = null;

/**
 * 함수 에뮬레이터 주소.
 *
 * 포트를 하드코딩하지 않는 이유: 개발용 에뮬레이터를 띄워둔 채로 테스트를
 * 돌리려면 포트를 옮겨야 하는데(firebase.test.json), 그때마다 여기를 고치면
 * 한쪽이 반드시 어긋납니다. **에뮬레이터 허브에 물어봅니다** — `emulators:exec`가
 * 허브 주소를 환경변수로 넣어주고, 허브는 실제로 뜬 포트를 알고 있습니다.
 */
async function functionsHost(): Promise<string> {
  if (cachedFunctionsHost) return cachedFunctionsHost;

  const explicit = process.env.FUNCTIONS_EMULATOR_HOST;
  if (explicit) return (cachedFunctionsHost = explicit);

  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (hub) {
    try {
      const res = await fetch(`http://${hub}/emulators`);
      const body = (await res.json()) as Record<string, { host?: string; port?: number }>;
      const port = body.functions?.port;
      if (port) {
        // 허브는 host를 "::1"로 줄 수 있는데, 그대로 URL에 넣으면 형식이 깨집니다.
        const host = body.functions?.host;
        const safeHost = !host || host === "::1" || host === "0.0.0.0" ? "127.0.0.1" : host;
        return (cachedFunctionsHost = `${safeHost}:${port}`);
      }
    } catch {
      // 허브에 못 물어보면 아래 기본값으로 갑니다.
    }
  }

  // watch 모드로 직접 돌릴 때를 위한 firebase.json 기본 포트.
  return (cachedFunctionsHost = "127.0.0.1:5001");
}

export async function apiUrl(path: string): Promise<string> {
  return `http://${await functionsHost()}/${PROJECT_ID}/${FUNCTIONS_REGION}/api${path}`;
}

export async function callApi(
  path: string,
  options: { idToken?: string; method?: string; body?: unknown } = {}
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.idToken) headers.Authorization = `Bearer ${options.idToken}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(await apiUrl(path), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}
