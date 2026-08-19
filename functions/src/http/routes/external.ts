/**
 * 외부 연동 엔드포인트 (스키마 5번 「외부 연동」).
 *
 * `GET /external/weather` — 로그인 없이 호출됩니다. 홈과 프로그램 상세가
 * 비로그인 방문자에게도 열려 있기 때문입니다.
 *
 * **캐시가 없으면 호출이 방문자 수에 비례해 늘어납니다**(16-1). 캐시는
 * lib/weatherService.ts가 담당하고, 이 파일은 파라미터만 넘깁니다.
 *
 * `GET /external/kakao-map/search` — **이쪽은 로그인이 필요합니다.** 날씨와 달리
 * 프로그램 등록 화면에서만 쓰이고(공급자 = 로그인 상태), 캐시를 둘 수 없는 성격이라
 * (검색어가 매번 다름) 비로그인에 열어두면 우리 카카오 쿼터가 그대로 남에게 쓰입니다.
 */

import express, { type Router } from "express";
import type { Firestore } from "firebase-admin/firestore";
import {
  KAKAO_REST_API_KEY,
  KMA_SERVICE_KEY,
  requireSecret,
} from "../../config/secrets";
import { db as defaultDb } from "../../lib/firebase";
import { createKmaPort } from "../../lib/kma";
import { createKakaoLocalPort } from "../../lib/kakaoLocal";
import {
  parsePlaceQuery,
  searchPlaces,
  type KakaoLocalPort,
} from "../../lib/placeSearch";
import {
  getWeather,
  parseWeatherQuery,
  type KmaPort,
} from "../../lib/weatherService";
import { asyncHandler, authenticate } from "../middleware";

export interface ExternalRouteDeps {
  db?: Firestore;
  /** 테스트에서 기상청 호출부를 갈아끼우는 지점 */
  kmaPort?: KmaPort;
  /** 테스트에서 카카오 호출부를 갈아끼우는 지점 */
  kakaoPort?: KakaoLocalPort;
  now?: () => Date;
}

export function buildExternalRouter(overrides: ExternalRouteDeps = {}): Router {
  const router = express.Router();

  router.get(
    "/weather",
    asyncHandler(async (req, res) => {
      const query = parseWeatherQuery(req.query as Record<string, unknown>);

      const kmaPort =
        overrides.kmaPort ??
        createKmaPort({
          serviceKey: requireSecret(
            KMA_SERVICE_KEY,
            "KMA_SERVICE_KEY",
            "functions/.secret.local (로컬) 또는 Firebase 시크릿(운영)"
          ),
        });

      const result = await getWeather(query, {
        db: overrides.db ?? defaultDb(),
        kmaPort,
        now: overrides.now,
      });

      // 발표 주기가 3시간이라 그 안에서는 값이 바뀌지 않습니다.
      // 브라우저·CDN 캐시를 함께 쓰면 함수 호출 자체도 줄어듭니다.
      res.set("Cache-Control", "public, max-age=1800");
      res.json(result);
    })
  );

  // 주소·장소 → 좌표. 등록 화면이 주소를 고를 때 부릅니다.
  //
  // 좌표를 클라이언트가 계산해 보내는 구조가 아니라 **주소와 좌표를 한 쌍으로
  // 고르게** 만드는 것이 요점입니다. 주소만 손으로 적으면 좌표가 비고, 좌표가
  // 비면 그 프로그램에는 날씨가 영영 안 붙습니다(16-4).
  router.get(
    "/kakao-map/search",
    authenticate,
    asyncHandler(async (req, res) => {
      const query = parsePlaceQuery(req.query.query);

      const port =
        overrides.kakaoPort ??
        createKakaoLocalPort({
          restApiKey: requireSecret(
            KAKAO_REST_API_KEY,
            "KAKAO_REST_API_KEY",
            "functions/.secret.local (로컬) 또는 Firebase 시크릿(운영)"
          ),
        });

      const result = await searchPlaces(query, { port });
      res.json(result);
    })
  );

  return router;
}
