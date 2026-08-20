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
import { getStorage } from "firebase-admin/storage";

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

/**
 * 파일 저장 버킷 (스키마 18-2 — 기본 버킷 하나만 씁니다).
 *
 * 버킷 이름을 코드에 적지 않습니다. 배포 환경에서는 Admin SDK가 기본 버킷을
 * 알고 있고, 에뮬레이터에서는 `STORAGE_EMULATOR_HOST`가 붙습니다 —
 * 이름을 고정하면 두 환경 중 하나가 반드시 깨집니다.
 */
export function bucket() {
  ensureApp();
  const explicit = process.env.STORAGE_BUCKET ?? process.env.FIREBASE_STORAGE_BUCKET;
  return explicit ? getStorage().bucket(explicit) : getStorage().bucket();
}
