/**
 * 카카오 로컬 API 호출부 (주소·장소 검색).
 *
 * 프론트에서 직접 부르지 않는 이유는 기상청과 같습니다 — **REST API 키가 노출되기
 * 때문**입니다. 지도 SDK가 쓰는 JavaScript 키는 도메인 제한이 걸려 있어 공개돼도
 * 괜찮지만, REST API 키에는 그런 제한이 없어서 그대로 남의 쿼터로 쓰입니다.
 * 그래서 검색은 반드시 이 서버 경로를 거칩니다.
 *
 * 응답 해석·좌표 검증은 여기 없습니다 — `placeSearch.ts`가 합니다. 이 파일은
 * HTTP만 담당해서, 키 없이도 나머지를 전부 테스트할 수 있게 갈라놨습니다.
 */

import type { KakaoLocalPort, KakaoPlaceDoc } from "./placeSearch";

const ADDRESS_ENDPOINT = "https://dapi.kakao.com/v2/local/search/address.json";
const KEYWORD_ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json";

/** 카카오 상한은 주소 30 / 키워드 15입니다. 둘 다 15로 맞춥니다(화면은 10건만 씁니다). */
const SIZE = 15;

interface KakaoAddressDoc {
  address_name?: string;
  x?: string;
  y?: string;
  /** 지번 주소 상세. 주소 검색에서 도로명으로 매칭되면 최상위 address_name이 도로명이 됩니다 */
  address?: { address_name?: string } | null;
  road_address?: { address_name?: string } | null;
}

interface KakaoKeywordDoc {
  place_name?: string;
  address_name?: string;
  road_address_name?: string;
  x?: string;
  y?: string;
}

interface KakaoResponse<T> {
  documents?: T[];
}

/**
 * 카카오는 실패해도 JSON을 주지만, 잘못된 키(401)나 쿼터 초과(429)는 본문 형식이
 * 다릅니다. 원인을 구분해 알려주되 **키 값 자체는 어떤 경우에도 메시지에 넣지 않습니다.**
 */
async function callKakao<T>(
  url: string,
  query: string,
  restApiKey: string
): Promise<T[]> {
  const params = new URLSearchParams({ query, size: String(SIZE) });

  const res = await fetch(`${url}?${params.toString()}`, {
    headers: { Authorization: `KakaoAK ${restApiKey}` },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "카카오 인증에 실패했습니다. REST API 키가 맞는지 확인하세요 " +
        "(JavaScript 키·어드민 키를 넣으면 이 오류가 납니다)."
    );
  }
  if (res.status === 429) {
    throw new Error("카카오 API 호출 한도를 초과했습니다.");
  }

  const text = await res.text();
  let body: KakaoResponse<T>;
  try {
    body = JSON.parse(text) as KakaoResponse<T>;
  } catch {
    throw new Error(
      `카카오 응답을 해석하지 못했습니다 (status ${res.status}): ${text.slice(0, 200)}`
    );
  }

  if (!res.ok) {
    throw new Error(`카카오 오류 (status ${res.status})`);
  }

  return body.documents ?? [];
}

export function createKakaoLocalPort(config: { restApiKey: string }): KakaoLocalPort {
  return {
    async searchAddress(query: string): Promise<KakaoPlaceDoc[]> {
      const docs = await callKakao<KakaoAddressDoc>(
        ADDRESS_ENDPOINT,
        query,
        config.restApiKey
      );

      return docs.map((d) => ({
        // 지번을 우선합니다 — 최상위 address_name은 도로명으로 매칭되면 도로명이 들어옵니다.
        addressName: d.address?.address_name ?? d.address_name ?? "",
        roadAddressName: d.road_address?.address_name ?? null,
        placeName: null, // 주소 검색에는 장소명이 없습니다
        x: d.x ?? "",
        y: d.y ?? "",
      }));
    },

    async searchKeyword(query: string): Promise<KakaoPlaceDoc[]> {
      const docs = await callKakao<KakaoKeywordDoc>(
        KEYWORD_ENDPOINT,
        query,
        config.restApiKey
      );

      return docs.map((d) => ({
        addressName: d.address_name ?? "",
        roadAddressName: d.road_address_name ?? null,
        placeName: d.place_name ?? null,
        x: d.x ?? "",
        y: d.y ?? "",
      }));
    },
  };
}
