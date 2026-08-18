/**
 * 기상청 단기예보 호출부 (스키마 16-3).
 *
 * 프론트에서 직접 부르지 않는 이유가 둘입니다 — **API 키가 노출되고**, 기상청
 * 서버가 CORS를 막아 요청 자체가 거부됩니다. 그래서 이 함수만이 유일한 통로입니다.
 *
 * ⚠️ **인증키는 「일반 인증키(Decoding)」를 넣으세요.**
 *    공공데이터포털은 같은 키를 Encoding/Decoding 두 형태로 보여줍니다.
 *    아래에서 `URLSearchParams`가 값을 한 번 인코딩하므로, 이미 인코딩된 키를
 *    넣으면 `%`가 `%25`로 이중 인코딩되어 **등록되지 않은 키**로 거부됩니다.
 *    이게 "키를 발급했는데 안 된다"의 대부분입니다.
 */

import type { KmaGrid } from "./kmaGrid";
import type { BaseTime, FcstItem } from "./kmaWeather";
import type { KmaPort } from "./weatherService";

const ENDPOINT =
  "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";

/** 3일치를 한 번에 받아 캐시에 넣으므로 넉넉히 요청합니다(16-1). */
const NUM_OF_ROWS = 1000;

interface KmaResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { items?: { item?: unknown[] } };
  };
}

function isFcstItem(value: unknown): value is FcstItem {
  const v = value as Record<string, unknown> | null;
  return (
    !!v &&
    typeof v.category === "string" &&
    typeof v.fcstDate === "string" &&
    typeof v.fcstTime === "string" &&
    (typeof v.fcstValue === "string" || typeof v.fcstValue === "number")
  );
}

export function createKmaPort(config: { serviceKey: string }): KmaPort {
  return {
    async fetchVilageFcst(base: BaseTime, grid: KmaGrid): Promise<FcstItem[]> {
      const params = new URLSearchParams({
        serviceKey: config.serviceKey,
        pageNo: "1",
        numOfRows: String(NUM_OF_ROWS),
        dataType: "JSON",
        base_date: base.baseDate,
        base_time: base.baseTime,
        nx: String(grid.nx),
        ny: String(grid.ny),
      });

      const res = await fetch(`${ENDPOINT}?${params.toString()}`);
      const text = await res.text();

      // 기상청은 오류일 때 JSON 대신 XML이나 HTML을 돌려주는 경우가 있습니다.
      // 그대로 JSON.parse하면 원인 불명의 예외가 되므로 본문 앞부분을 남깁니다.
      let body: KmaResponse;
      try {
        body = JSON.parse(text) as KmaResponse;
      } catch {
        throw new Error(
          `기상청 응답을 해석하지 못했습니다 (status ${res.status}): ${text.slice(0, 200)}`
        );
      }

      const code = body.response?.header?.resultCode;
      if (code !== "00") {
        const msg = body.response?.header?.resultMsg ?? "알 수 없는 오류";
        // 키 값 자체는 절대 메시지에 넣지 않습니다.
        throw new Error(`기상청 오류 [${code ?? "없음"}] ${msg}`);
      }

      const items = body.response?.body?.items?.item ?? [];
      return items.filter(isFcstItem).map((i) => ({
        category: i.category,
        fcstDate: i.fcstDate,
        fcstTime: i.fcstTime,
        fcstValue: String(i.fcstValue),
      }));
    },
  };
}
