/**
 * 주소·장소 검색 (스키마 5번 「외부 연동」 · 16-4).
 *
 * 확인하는 것: **위경도를 바꿔 읽지 않는가** / 못 쓰는 결과를 걸러내는가 /
 * 주소 검색이 0건일 때만 키워드 검색으로 넘어가는가 / 시도를 못 뽑는 결과를
 * 조용히 버리지 않는가.
 *
 * 첫 번째가 이 파일을 만든 이유입니다. **좌표를 뒤집어 읽어도 예외는 안 납니다** —
 * 지도에 엉뚱한 곳이 찍히고 날씨는 "옆 동네"가 나올 뿐이라 눈으로는 못 잡습니다.
 * 격자 변환(`kmaGrid.test.ts`)을 테스트로 못박아둔 것과 같은 이유입니다.
 *
 * 카카오 호출부가 주입 지점이라 **API 키 없이 전부 검증됩니다.**
 */

import { describe, expect, it, vi } from "vitest";
import {
  parsePlaceQuery,
  searchPlaces,
  toPlace,
  type KakaoLocalPort,
  type KakaoPlaceDoc,
} from "../src/lib/placeSearch";

/** 카카오 응답 문서 한 건. x=경도, y=위도입니다. */
function doc(over: Partial<KakaoPlaceDoc> = {}): KakaoPlaceDoc {
  return {
    addressName: "강원특별자치도 홍천군 서면 한서로 2137",
    roadAddressName: null,
    placeName: null,
    x: "127.7669", // 경도
    y: "37.6968", // 위도
    ...over,
  };
}

/** 주소 검색·키워드 검색 결과를 따로 지정하는 가짜 포트. 호출 여부도 셉니다. */
function fakePort(byAddress: KakaoPlaceDoc[], byKeyword: KakaoPlaceDoc[] = []) {
  return {
    searchAddress: vi.fn(async () => byAddress),
    searchKeyword: vi.fn(async () => byKeyword),
  } satisfies KakaoLocalPort;
}

describe("toPlace — 좌표 해석", () => {
  it("x는 경도, y는 위도로 읽는다", () => {
    const place = toPlace(doc({ x: "127.7669", y: "37.6968" }));
    expect(place).not.toBeNull();
    expect(place!.lat).toBeCloseTo(37.6968, 4);
    expect(place!.lng).toBeCloseTo(127.7669, 4);
  });

  it("위경도를 바꿔 읽으면 한반도 범위를 벗어나 결과에서 빠진다", () => {
    // 경도(127)를 위도 자리에 넣은 상황 — 예외는 안 나지만 지구상 엉뚱한 지점입니다.
    expect(toPlace(doc({ x: "37.6968", y: "127.7669" }))).toBeNull();
  });

  it("숫자로 읽을 수 없는 좌표는 버린다", () => {
    expect(toPlace(doc({ x: "", y: "" }))).toBeNull();
    expect(toPlace(doc({ x: "동경 127도", y: "북위 37도" }))).toBeNull();
  });

  it("국외 좌표는 버린다", () => {
    // 도쿄 — 카카오는 국내만 주지만, 범위 검증이 살아 있는지 확인합니다.
    expect(toPlace(doc({ x: "139.6917", y: "35.6895" }))).toBeNull();
  });

  it("주소에서 시도 코드를 뽑아 함께 내려보낸다", () => {
    expect(toPlace(doc())!.sido).toBe("gangwon");
    expect(toPlace(doc({ addressName: "경기 가평군 북면" }))!.sido).toBe("gyeonggi");
  });

  it("시도를 못 뽑아도 결과에서 빼지 않는다 — 화면이 이유를 알려줘야 하기 때문", () => {
    // 조용히 빼면 "검색은 되는데 결과가 안 보인다"가 되어 원인을 찾을 수 없습니다.
    const place = toPlace(doc({ addressName: "홍천군 서면" }));
    expect(place).not.toBeNull();
    expect(place!.sido).toBeNull();
  });

  it("지번 주소가 없으면 도로명 주소를 대신 쓴다", () => {
    const place = toPlace(
      doc({ addressName: "", roadAddressName: "강원특별자치도 홍천군 한서로 2137" })
    );
    expect(place!.address).toBe("강원특별자치도 홍천군 한서로 2137");
    expect(place!.sido).toBe("gangwon");
  });

  it("주소가 아예 없으면 버린다 — 좌표만으로는 프로그램을 만들 수 없다", () => {
    expect(toPlace(doc({ addressName: "", roadAddressName: null }))).toBeNull();
  });
});

describe("searchPlaces — 주소 검색 → 키워드 검색", () => {
  it("주소 검색에 결과가 있으면 키워드 검색을 부르지 않는다", async () => {
    const port = fakePort([doc()]);
    const result = await searchPlaces("강원특별자치도 홍천군 서면", { port });

    expect(result.source).toBe("address");
    expect(result.places).toHaveLength(1);
    expect(port.searchKeyword).not.toHaveBeenCalled();
  });

  it("주소 검색이 0건이면 키워드 검색으로 넘어간다", async () => {
    const port = fakePort([], [doc({ placeName: "국립산음자연휴양림" })]);
    const result = await searchPlaces("국립산음자연휴양림", { port });

    expect(port.searchKeyword).toHaveBeenCalledOnce();
    expect(result.source).toBe("keyword");
    expect(result.places[0]?.placeName).toBe("국립산음자연휴양림");
  });

  it("양쪽 다 0건이면 source가 none이다", async () => {
    const result = await searchPlaces("없는곳", { port: fakePort([], []) });
    expect(result.places).toHaveLength(0);
    expect(result.source).toBe("none");
  });

  it("같은 지점이 중복으로 오면 한 번만 내려보낸다", async () => {
    const result = await searchPlaces("홍천", { port: fakePort([doc(), doc()]) });
    expect(result.places).toHaveLength(1);
  });

  it("10건을 넘으면 잘라내되 truncated로 알린다", async () => {
    // 조용히 자르면 화면이 "이게 전부"로 읽습니다(관리자 목록의 truncated와 같은 이유).
    const many = Array.from({ length: 12 }, (_, i) =>
      doc({ addressName: `강원특별자치도 홍천군 서면 ${i}리`, x: `127.${700 + i}` })
    );
    const result = await searchPlaces("홍천", { port: fakePort(many) });

    expect(result.places).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("쓸 수 없는 결과가 섞여 있어도 나머지는 살린다", async () => {
    const port = fakePort([doc({ x: "", y: "" }), doc()]);
    const result = await searchPlaces("홍천", { port });
    expect(result.places).toHaveLength(1);
  });
});

describe("parsePlaceQuery — 입력 검증", () => {
  it("앞뒤 공백을 걷어낸다", () => {
    expect(parsePlaceQuery("  홍천군  ")).toBe("홍천군");
  });

  it("한 글자·빈 값·문자열이 아닌 값은 거부한다", () => {
    expect(() => parsePlaceQuery("홍")).toThrow();
    expect(() => parsePlaceQuery("   ")).toThrow();
    expect(() => parsePlaceQuery(undefined)).toThrow();
    expect(() => parsePlaceQuery(123)).toThrow();
  });

  it("너무 긴 검색어는 거부한다", () => {
    expect(() => parsePlaceQuery("가".repeat(101))).toThrow();
  });
});
