/**
 * Cloud Functions 진입점.
 *
 * 함수를 하나(`api`)로 모읍니다. 엔드포인트마다 함수를 나누면 콜드 스타트가
 * 경로 수만큼 생기고 배포 단위도 늘어납니다. 5번의 REST 경로 목록은 전부
 * 이 라우터 안에 붙습니다.
 */

import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { RUNTIME_SECRETS } from "./config/secrets";
import { createApp } from "./http/app";

// 서비스 이용자가 전부 국내이므로 서울 리전을 씁니다.
// 리전은 배포 후 바꾸려면 함수를 지웠다 다시 만들어야 하므로 지금 고정합니다.
// (firebase.json의 hosting rewrite에도 같은 리전을 적어야 연결됩니다)
setGlobalOptions({ region: "asia-northeast3", maxInstances: 10 });

export const api = onRequest({ secrets: RUNTIME_SECRETS }, createApp());
