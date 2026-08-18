/**
 * 날씨 조회 (스키마 16번).
 *
 * 확인하는 것: 발표본 계산이 **한국시간 기준**인가 / 캐시가 실제로 재사용되는가 /
 * 예보 범위를 넘는 날짜를 걸러내는가 / 기상청이 실패해도 화면을 막지 않는가.
 *
 * 기상청 호출부를 주입 지점으로 빼놨기 때문에 **API 키 없이 전부 검증됩니다.**
 * 키는 실제 호출 한 번을 확인할 때만 필요합니다.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  isWithinForecastRange,
  kstDateKey,
  latestBaseTime,
  summarizeDay,
  type FcstItem,
} from "../src/lib/kmaWeather";
import { getWeather, parseWeatherQuery, type KmaPort } from "../src/lib/weatherService";
import { testDb } from "./helpers";

/** 서울시청 좌표 — 격자 60,127 */
const SEOUL = { lat: 37.5665, lng: 126.978, regionLabel: "서울 중구" };

/** UTC로 표기한 시각. KST는 여기에 9시간을 더한 값입니다. */
function utc(iso: string): Date {
  return new Date(iso);
}

function item(
  category: string,
  fcstDate: string,
  fcstTime: string,
  fcstValue: string
): FcstItem {
  return { category, fcstDate, fcstTime, fcstValue };
}

describe("latestBaseTime — 한국시간 기준 발표본", () => {
  it("KST 09:30이면 08시 발표본", () => {
    // UTC 00:30 = KST 09:30
    expect(latestBaseTime(utc("2026-08-18T00:30:00Z"))).toEqual({
      baseDate: "20260818",
      baseTime: "0800",
    });
  });

  it("발표 직후 10분 안에는 이전 발표본을 쓴다", () => {
    // KST 08:05 — 08시 발표본은 아직 자료가 없습니다.
    expect(latestBaseTime(utc("2026-08-17T23:05:00Z"))).toEqual({
      baseDate: "20260818",
      baseTime: "0500",
    });
  });

  it("KST 자정~02:10은 전날 23시 발표본", () => {
    // UTC 15:30 = KST 다음날 00:30
    expect(latestBaseTime(utc("2026-08-17T15:30:00Z"))).toEqual({
      baseDate: "20260817",
      baseTime: "2300",
    });
  });

  it("서버가 UTC로 돌아도 날짜가 밀리지 않는다", () => {
    // UTC 2026-08-17 20:30 = KST 2026-08-18 05:30 → 날짜가 18일이어야 합니다.
    // 서버 시각을 그대로 쓰면 17일 발표본을 요청하게 됩니다.
    const base = latestBaseTime(utc("2026-08-17T20:30:00Z"));
    expect(base.baseDate).toBe("20260818");
    expect(base.baseTime).toBe("0500");
  });

  it("kstDateKey도 KST 기준", () => {
    expect(kstDateKey(utc("2026-08-17T15:30:00Z"))).toBe("20260818");
    expect(kstDateKey(utc("2026-08-17T14:30:00Z"))).toBe("20260817");
  });
});

describe("isWithinForecastRange — 예보가 닿는 기간 (16-2)", () => {
  const now = utc("2026-08-18T00:00:00Z"); // KST 09:00

  it("오늘은 포함", () => {
    expect(isWithinForecastRange(utc("2026-08-18T03:00:00Z"), now)).toBe(true);
  });

  it("4일 뒤까지 포함 — 실측 기준(2026-08-18 확인)", () => {
    expect(isWithinForecastRange(utc("2026-08-21T03:00:00Z"), now)).toBe(true);
    expect(isWithinForecastRange(utc("2026-08-22T03:00:00Z"), now)).toBe(true);
  });

  it("5일 뒤는 기상청을 부르지 않는다", () => {
    expect(isWithinForecastRange(utc("2026-08-23T03:00:00Z"), now)).toBe(false);
  });

  it("한 달 뒤는 제외 — 억지 예보를 붙이지 않는다", () => {
    expect(isWithinForecastRange(utc("2026-09-18T03:00:00Z"), now)).toBe(false);
  });

  it("지난 날짜도 제외", () => {
    expect(isWithinForecastRange(utc("2026-08-15T03:00:00Z"), now)).toBe(false);
  });
});

describe("summarizeDay — 코드 덩어리를 한 줄 요약으로", () => {
  it("낮 시간대(09~18시)만 본다", () => {
    const items = [
      item("TMP", "20260818", "0600", "18"), // 새벽 — 무시
      item("TMP", "20260818", "1500", "31"),
      item("TMP", "20260818", "2100", "24"), // 밤 — 무시
      item("SKY", "20260818", "1500", "1"),
    ];
    const day = summarizeDay(items, "20260818", "서울")!;
    // 새벽 기온이 섞이면 참가자에게 쓸모없는 값이 나옵니다.
    expect(day.tempC).toBe(31);
  });

  it("강수확률은 낮 시간대 최대값", () => {
    const items = [
      item("POP", "20260818", "0900", "20"),
      item("POP", "20260818", "1200", "70"),
      item("POP", "20260818", "1500", "40"),
      item("SKY", "20260818", "1200", "4"),
    ];
    expect(summarizeDay(items, "20260818", "서울")!.precipProbability).toBe(70);
  });

  it("기온도 하늘상태도 없으면 null — 표시할 게 없다", () => {
    // 강수확률만 있는 응답은 화면에 보여줄 대표값이 없습니다.
    // 실제 기상청 응답에는 TMP·SKY·PTY가 함께 오므로 정상 경로에서는 생기지 않습니다.
    const items = [item("POP", "20260818", "1200", "70")];
    expect(summarizeDay(items, "20260818", "서울")).toBeNull();
  });

  it("강수형태(PTY)가 하늘상태(SKY)보다 우선한다", () => {
    const items = [
      item("SKY", "20260818", "1200", "4"), // 흐림
      item("PTY", "20260818", "1200", "1"), // 비
      item("TMP", "20260818", "1200", "22"),
    ];
    expect(summarizeDay(items, "20260818", "서울")!.condition).toBe("비");
  });

  it("낮 동안 한 번이라도 비가 오면 비로 표시한다", () => {
    const items = [
      item("PTY", "20260818", "0900", "0"),
      item("PTY", "20260818", "1500", "3"), // 눈
      item("TMP", "20260818", "1500", "1"),
    ];
    expect(summarizeDay(items, "20260818", "서울")!.condition).toBe("눈");
  });

  it("다른 날짜 항목은 섞이지 않는다", () => {
    const items = [item("TMP", "20260819", "1500", "35")];
    expect(summarizeDay(items, "20260818", "서울")).toBeNull();
  });

  it("강수확률 60% 이상이면 준비물 안내가 붙는다", () => {
    const items = [
      item("POP", "20260818", "1200", "80"),
      item("PTY", "20260818", "1200", "1"),
      item("TMP", "20260818", "1200", "20"),
    ];
    expect(summarizeDay(items, "20260818", "서울")!.comment).toContain("우비");
  });
});

describe("getWeather — 캐시와 실패 처리", () => {
  const now = () => utc("2026-08-18T00:30:00Z"); // KST 09:30 → 08시 발표본
  const today = "20260818";

  function port(items: FcstItem[], onCall?: () => void): KmaPort {
    return {
      async fetchVilageFcst() {
        onCall?.();
        return items;
      },
    };
  }

  const sample = [
    item("TMP", today, "1500", "29"),
    item("POP", today, "1500", "10"),
    item("SKY", today, "1500", "1"),
    item("TMP", "20260819", "1500", "27"),
    item("POP", "20260819", "1500", "80"),
    item("PTY", "20260819", "1500", "1"),
  ];

  beforeEach(async () => {
    // 격자 60,127 / 08시 발표본 캐시를 지웁니다.
    await testDb.doc(`weatherCache/60_127_${today}0800`).delete();
  });

  it("첫 호출은 기상청을 부르고 캐시에 저장한다", async () => {
    let calls = 0;
    const result = await getWeather(
      { ...SEOUL, date: utc("2026-08-18T03:00:00Z") },
      { db: testDb, kmaPort: port(sample, () => (calls += 1)), now }
    );

    expect(calls).toBe(1);
    expect(result.cached).toBe(false);
    expect(result.weather).toMatchObject({
      condition: "맑음",
      tempC: 29,
      precipProbability: 10,
      regionLabel: "서울 중구",
    });

    const snap = await testDb.doc(`weatherCache/60_127_${today}0800`).get();
    expect(snap.exists).toBe(true);
  });

  it("두 번째 호출은 기상청을 부르지 않는다 (16-1의 핵심)", async () => {
    let calls = 0;
    const deps = { db: testDb, kmaPort: port(sample, () => (calls += 1)), now };

    await getWeather({ ...SEOUL, date: utc("2026-08-18T03:00:00Z") }, deps);
    const second = await getWeather({ ...SEOUL, date: utc("2026-08-18T03:00:00Z") }, deps);

    // 캐시가 없으면 호출이 방문자 수에 비례해 늘어납니다.
    expect(calls).toBe(1);
    expect(second.cached).toBe(true);
  });

  it("같은 격자의 다른 좌표도 캐시를 공유한다", async () => {
    let calls = 0;
    const deps = { db: testDb, kmaPort: port(sample, () => (calls += 1)), now };

    await getWeather({ ...SEOUL, date: utc("2026-08-18T03:00:00Z") }, deps);
    // 약 500m 떨어진 좌표 — 같은 5km 격자
    await getWeather(
      { lat: 37.5701, lng: 126.9822, regionLabel: "서울 종로", date: utc("2026-08-18T03:00:00Z") },
      deps
    );

    expect(calls).toBe(1);
  });

  it("한 발표본으로 다음 날짜까지 답한다", async () => {
    const deps = { db: testDb, kmaPort: port(sample), now };
    await getWeather({ ...SEOUL, date: utc("2026-08-18T03:00:00Z") }, deps);

    const tomorrow = await getWeather(
      { ...SEOUL, date: utc("2026-08-19T03:00:00Z") },
      deps
    );
    expect(tomorrow.cached).toBe(true);
    expect(tomorrow.weather).toMatchObject({ condition: "비", precipProbability: 80 });
  });

  it("예보 범위를 넘는 날짜는 기상청을 부르지 않는다", async () => {
    let calls = 0;
    const result = await getWeather(
      { ...SEOUL, date: utc("2026-09-18T03:00:00Z") },
      { db: testDb, kmaPort: port(sample, () => (calls += 1)), now }
    );

    expect(calls).toBe(0);
    expect(result.weather).toBeNull();
    expect(result.reason).toBe("out_of_range");
  });

  it("국외 좌표는 거른다", async () => {
    const result = await getWeather(
      { lat: 35.6812, lng: 139.7671, regionLabel: "도쿄" },
      { db: testDb, kmaPort: port(sample), now }
    );
    expect(result.reason).toBe("out_of_area");
  });

  it("기상청이 실패해도 예외를 던지지 않는다 (화면을 막지 않음)", async () => {
    const result = await getWeather(
      { ...SEOUL, date: utc("2026-08-18T03:00:00Z") },
      {
        db: testDb,
        now,
        kmaPort: {
          async fetchVilageFcst() {
            throw new Error("기상청 오류 [22] 요청 한도 초과");
          },
        },
      }
    );

    expect(result.weather).toBeNull();
    expect(result.reason).toBe("unavailable");
  });

  it("빈 응답은 캐시하지 않는다 — 3시간 동안 빈 값이 굳어버림", async () => {
    const deps = { db: testDb, kmaPort: port([]), now };
    const result = await getWeather({ ...SEOUL, date: utc("2026-08-18T03:00:00Z") }, deps);

    expect(result.reason).toBe("unavailable");
    const snap = await testDb.doc(`weatherCache/60_127_${today}0800`).get();
    expect(snap.exists).toBe(false);
  });
});

describe("parseWeatherQuery", () => {
  it("좌표가 없으면 거부", () => {
    expect(() => parseWeatherQuery({})).toThrow();
    expect(() => parseWeatherQuery({ lat: "abc", lng: "126" })).toThrow();
  });

  it("지역명이 없으면 기본값을 쓴다", () => {
    expect(parseWeatherQuery({ lat: "37.5", lng: "127.0" }).regionLabel).toBe("현재 위치");
  });

  it("잘못된 날짜 형식은 거부", () => {
    expect(() =>
      parseWeatherQuery({ lat: "37.5", lng: "127.0", date: "언젠가" })
    ).toThrow();
  });
});
