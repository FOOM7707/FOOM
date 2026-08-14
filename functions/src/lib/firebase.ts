/**
 * Admin SDK 초기화 한 곳.
 *
 * 주의 — Admin SDK는 Firestore 보안규칙을 **완전히 우회**합니다(6-2).
 * 여기서 얻은 db/auth로는 규칙과 무관하게 무엇이든 읽고 쓸 수 있으므로,
 * 권한 판단은 반드시 함수 진입부(http/middleware.ts)에서 끝내야 합니다.
 */

import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

function ensureApp() {
  if (getApps().length === 0) {
    initializeApp();
  }
}

export function db(): Firestore {
  ensureApp();
  return getFirestore();
}

export function auth(): Auth {
  ensureApp();
  return getAuth();
}
