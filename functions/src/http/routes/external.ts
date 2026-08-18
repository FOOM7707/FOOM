/**
 * 외부 연동 엔드포인트 (스키마 5번 「외부 연동」).
 *
 * `GET /external/weather` — 로그인 없이 호출됩니다. 홈과 프로그램 상세가
 * 비로그인 방문자에게도 열려 있기 때문입니다.
 *
 * **캐시가 없으면 호출이 방문자 수에 비례해 늘어납니다**(16-1). 캐시는
 * lib/weatherService.ts가 담당하고, 이 파일은 파라미터만 넘깁니다.
 */

import express, { type Router } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { KMA_SERVICE_KEY, requireSecret } from "../../config/secrets";
import { db as defaultDb } from "../../lib/firebase";
import { createKmaPort } from "../../lib/kma";
import {
  getWeather,
  parseWeatherQuery,
  type KmaPort,
} from "../../lib/weatherService";
import { asyncHandler } from "../middleware";

export interface ExternalRouteDeps {
  db?: Firestore;
  /** 테스트에서 기상청 호출부를 갈아끼우는 지점 */
  kmaPort?: KmaPort;
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

  return router;
}
