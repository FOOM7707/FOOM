/**
 * Firebase 클라이언트 초기화.
 *
 * 개발 중에는 에뮬레이터에 붙습니다. 함수 에뮬레이터를 `--project demo-foom`으로
 * 띄우고 있으므로 **여기 projectId도 demo-foom이어야** Custom Token 검증이
 * 통과합니다(토큰의 aud/iss가 프로젝트와 대조됩니다).
 *
 * 실서버 값은 `VITE_FIREBASE_*`로 넣습니다. 전부 공개돼도 되는 값입니다 —
 * Firebase 웹 설정은 브라우저에 그대로 노출되는 것이 정상이고, 실제 차단은
 * 보안규칙과 함수 진입부에서 이루어집니다.
 */

import { initializeApp, type FirebaseOptions } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const env = import.meta.env;

/** 명시하지 않으면 개발 모드에서는 에뮬레이터를 씁니다. */
export const useEmulator =
  (env.VITE_FIREBASE_USE_EMULATOR ?? String(env.DEV)) === "true";

const emulatorConfig: FirebaseOptions = {
  // 에뮬레이터는 키를 검증하지 않습니다. 실제 값이 아닙니다.
  apiKey: "demo-key",
  projectId: "demo-foom",
  authDomain: "demo-foom.firebaseapp.com",
  // 사진 업로드에 필요합니다 — 없으면 Storage SDK가 버킷을 못 찾습니다.
  storageBucket: "demo-foom.appspot.com",
};

const productionConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
};

export const firebaseApp = initializeApp(useEmulator ? emulatorConfig : productionConfig);

export const firebaseAuth = getAuth(firebaseApp);

export const firebaseStorage = getStorage(firebaseApp);

if (useEmulator) {
  connectAuthEmulator(firebaseAuth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  // 사진 업로드는 브라우저가 Storage로 직접 합니다(18-4). 개발 중에는
  // 에뮬레이터에 붙어야 하고, **에뮬레이터를 storage까지 띄워야** 동작합니다.
  connectStorageEmulator(firebaseStorage, "127.0.0.1", 9199);
}
