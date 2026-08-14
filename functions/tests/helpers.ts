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

function functionsHost(): string {
  // emulators:exec 가 채워주는 값. 없으면 firebase.json 의 기본 포트를 씁니다.
  return process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001";
}

export function apiUrl(path: string): string {
  return `http://${functionsHost()}/${PROJECT_ID}/${FUNCTIONS_REGION}/api${path}`;
}

export async function callApi(
  path: string,
  options: { idToken?: string } = {}
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.idToken) headers.Authorization = `Bearer ${options.idToken}`;

  const res = await fetch(apiUrl(path), { headers });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}
