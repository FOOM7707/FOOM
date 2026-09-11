/**
 * Cloud Functions 진입점.
 *
 * 함수를 하나(`api`)로 모읍니다. 엔드포인트마다 함수를 나누면 콜드 스타트가
 * 경로 수만큼 생기고 배포 단위도 늘어납니다. 5번의 REST 경로 목록은 전부
 * 이 라우터 안에 붙습니다.
 */

import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { RUNTIME_SECRETS } from "./config/secrets";
import { createApp } from "./http/app";
import { releaseExpiredHolds as releaseExpiredHoldsLib } from "./lib/bookings";
import { db } from "./lib/firebase";

// 서비스 이용자가 전부 국내이므로 서울 리전을 씁니다.
// 리전은 배포 후 바꾸려면 함수를 지웠다 다시 만들어야 하므로 지금 고정합니다.
// (firebase.json의 hosting rewrite에도 같은 리전을 적어야 연결됩니다)
setGlobalOptions({ region: "asia-northeast3", maxInstances: 10 });

export const api = onRequest({ secrets: RUNTIME_SECRETS }, createApp());

/**
 * 만료된 예약 홀드 정리 (2-5 ②). 홀드가 10분이므로 5분 주기면 최대 15분 안에
 * 자리가 돌아옵니다 — 결제 웹훅은 어차피 `expiresAt`을 직접 확인하므로(2-6 ③)
 * 이 주기가 정확성에 영향을 주지는 않고, 자리가 잠겨 있는 시간만 정합니다.
 *
 * ⚠️ 에뮬레이터는 스케줄 함수를 시계로 돌리지 않습니다 — 로컬 확인은
 * 테스트(`bookings.test.ts`)가 라이브러리 함수를 직접 부르는 방식입니다.
 */
export const releaseExpiredHolds = onSchedule("every 5 minutes", async () => {
  const released = await releaseExpiredHoldsLib(db());
  if (released > 0) {
    console.log(`만료 홀드 ${released}건을 해제하고 정원을 복구했습니다`);
  }
});
