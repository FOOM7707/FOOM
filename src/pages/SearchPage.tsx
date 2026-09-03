/**
 * 프로그램 찾기 (스키마 17번).
 *
 * **`GET /programs/search`가 걸러 내려줍니다(v28).** 예전에는 `src/mocks/`를 프론트에서
 * 걸렀는데, 판정이 화면과 서버 양쪽에 있으면 「보이는데 서버 결과에는 없는」 프로그램이
 * 생깁니다. 이제 필터·정렬·검색어는 전부 서버가 판단하고, 화면은 요청과 표시만 합니다.
 *
 * **예외가 하나 있습니다 — 「가까운거리순」.** 서버는 사용자의 현재위치를 모르므로
 * 후보를 받아 화면에서 거리로 다시 정렬합니다.
 *
 * ⚠️ **조건의 원본은 주소(URL)입니다 — 화면이 따로 기억하지 않습니다**(17-4 ⑤).
 *    헤더의 「프로그램 찾기」↔「지도로 찾기」와 푸터의 카테고리 링크는 **같은 화면
 *    안에서 주소만 바꿉니다**(화면을 새로 만들지 않습니다). 조건을 화면이 기억하면
 *    그때 주소를 다시 읽지 않아, **주소와 헤더 강조는 바뀌었는데 목록은 그대로**가
 *    됩니다. 반대로 화면 안 조작이 주소에 안 남으면 링크를 공유했을 때 상대가 다른
 *    화면을 봅니다. 읽고 쓰는 규칙은 `programFilter.ts`에 있습니다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import { CATEGORIES } from "../types/firestore";
import FilterModal from "../components/FilterModal";
import ProgramCard from "../components/ProgramCard";
import ProgramMap from "../components/ProgramMap";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { distanceKm, type LatLng } from "@/lib/geo";
import { ApiError, apiFetch } from "@/lib/api";
import type { Program } from "@/types/firestore";
import {
  countActiveFilters,
  parseSearchScreenParams,
  toScreenParams,
  toSearchQuery,
  type ProgramFilters,
  type SearchRow,
  type SearchScreenState,
  type SortKey,
} from "@/lib/programFilter";

const SORTS: SortKey[] = ["인기순", "낮은가격순", "평점순", "가까운거리순"];

interface SearchResponse {
  programs: SearchRow[];
  total: number;
  truncated: boolean;
  /** 회차가 있는 날짜 합집합 — 필터 모달 달력의 점(17-4 ④) 재료입니다 */
  calendarDates: string[];
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();

  // 주소 글자를 의존성으로 씁니다. `params` 객체는 렌더마다 새로 올 수 있어서,
  // 그대로 쓰면 조건이 그대로인데도 계속 다시 계산합니다.
  const queryString = params.toString();
  const screen = useMemo(
    () => parseSearchScreenParams(new URLSearchParams(queryString)),
    [queryString]
  );
  const { filters, place, sort, view } = screen;

  /** 주소에 적힌 검색어. 타이핑 중에는 입력칸 값과 잠깐 다릅니다 */
  const urlKeyword = screen.keyword;
  const [keyword, setKeyword] = useState(urlKeyword);
  /**
   * 우리가 주소에 마지막으로 적은 검색어.
   *
   * **밖에서 주소가 바뀐 경우와 구분하려고 둡니다** — 이게 없으면 타이핑하는 중에
   * (아직 주소에 안 적힌 상태) 입력칸이 주소값으로 되돌아가 글자가 지워집니다.
   */
  const writtenKeyword = useRef(urlKeyword);

  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * 조건을 바꾸는 **유일한 통로** — 주소를 다시 씁니다.
   *
   * 바꾸지 않은 값도 함께 적습니다. 예전에는 카테고리를 누르면 주소를 통째로 새로
   * 만들어 **기간·지역 조건이 조용히 사라졌습니다.**
   *
   * 주소를 **덮어쓰는(replace)** 이유 — 필터를 여러 번 만진 뒤 뒤로가기를 누르는
   * 사람은 찾기 화면을 벗어나려는 것이지 필터를 한 칸씩 되돌리려는 것이 아닙니다
   * (마이페이지 탭에서 이미 같은 판단을 했습니다).
   */
  const apply = useCallback(
    (next: Partial<SearchScreenState>) => {
      const merged: SearchScreenState = { ...screen, keyword, ...next };
      writtenKeyword.current = merged.keyword.trim();
      setParams(toScreenParams(merged), { replace: true });
    },
    [screen, keyword, setParams]
  );

  // 밖에서 주소가 바뀌면(헤더·푸터 링크, 뒤로가기, 홈에서 넘어옴) 입력칸도 맞춥니다.
  useEffect(() => {
    if (urlKeyword === writtenKeyword.current) return;
    writtenKeyword.current = urlKeyword;
    setKeyword(urlKeyword);
  }, [urlKeyword]);

  // 타이핑이 멈추면 주소에 적습니다. 글자마다 적으면 주소가 매 글자 바뀌고 그때마다
  // 서버 요청이 나갑니다 — 늦게 온 응답이 먼저 온 것을 덮어써 결과가 튑니다.
  useEffect(() => {
    if (keyword.trim() === urlKeyword.trim()) return;
    const timer = window.setTimeout(() => apply({ keyword }), 250);
    return () => window.clearTimeout(timer);
  }, [keyword, urlKeyword, apply]);

  // 위치를 묻는 버튼은 두지 않습니다. 물어보는 시점이 두 곳뿐이라 버튼이 없어도
  // 됩니다 — ① 「가까운거리순」을 고를 때(정렬 기준이 위치라 없으면 정렬이 안 됩니다)
  // ② 지도의 📍 버튼을 누를 때.
  const { position: askedPosition, status, request } = useCurrentLocation();
  /** 지도의 📍로 받아온 위치. 목록의 거리 표시도 이 값을 함께 씁니다 */
  const [mapPosition, setMapPosition] = useState<LatLng | null>(null);
  const position = askedPosition ?? mapPosition;

  // 「가까운거리순」을 고르면 그때 위치를 물어봅니다. 버튼을 따로 누르게 하면
  // 정렬을 골라놓고 "왜 순서가 그대로지"가 됩니다.
  useEffect(() => {
    if (sort === "가까운거리순" && !position && status === "idle") request();
  }, [sort, position, status, request]);

  const [rows, setRows] = useState<SearchRow[]>([]);
  const [total, setTotal] = useState(0);
  /** 회차가 있는 날짜 — 달력 점의 재료. 검색 응답이 함께 내려줍니다 */
  const [calendarDates, setCalendarDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 모달의 「N개 결과 보기」 — 서버가 돌려준 값입니다. 세는 중이면 null */
  const [draftCount, setDraftCount] = useState<number | null>(null);

  /**
   * 서버에 보낼 쿼리.
   *
   * **주소가 아니라 이 값이 바뀔 때만 다시 부릅니다.** 「가까운거리순」은 서버에
   * 인기순으로 나가므로(화면이 거리로 다시 정렬), 주소만 바뀌고 요청은 같습니다 —
   * 주소를 의존성으로 쓰면 그때 쓸데없이 한 번 더 부릅니다.
   */
  const listQuery = useMemo(
    () => toSearchQuery(filters, sort, urlKeyword, place),
    [filters, sort, urlKeyword, place]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<SearchResponse>(`/programs/search?${listQuery}`)
      .then((res) => {
        if (cancelled) return;
        setRows(res.programs);
        setTotal(res.total);
        setCalendarDates(res.calendarDates ?? []);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "목록을 불러오지 못했습니다");
        setRows([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listQuery]);

  /** 모달에서 값을 만질 때 개수를 다시 셉니다. 적용 전이라 목록은 그대로입니다. */
  const countDraft = useCallback(
    (draft: ProgramFilters) => {
      setDraftCount(null);
      void apiFetch<SearchResponse>(
        `/programs/search?${toSearchQuery(draft, sort, urlKeyword, place)}`
      )
        .then((res) => setDraftCount(res.total))
        .catch(() => setDraftCount(null));
    },
    [sort, urlKeyword, place]
  );

  // 모달을 열 때 현재 조건의 개수를 먼저 채워둡니다 — 손대기 전에도 숫자가 보입니다.
  useEffect(() => {
    if (filterOpen) setDraftCount(total);
  }, [filterOpen, total]);

  const filtered = useMemo(() => {
    const withDistance = rows.map((r) => ({
      program: r,
      distance:
        position && r.location.lat != null && r.location.lng != null
          ? distanceKm(position, { lat: r.location.lat, lng: r.location.lng })
          : null,
    }));

    // 거리순만 화면에서 정렬합니다 — 서버는 현재위치를 모릅니다.
    if (sort === "가까운거리순") {
      withDistance.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    }
    return withDistance;
  }, [rows, sort, position]);

  const activeFilterCount = countActiveFilters(filters);

  /** 기간이 걸렸을 때 함께 표시되는 상시모집 수 — 안내 문구에 씁니다(17-2) */
  const openCount = filters.from
    ? rows.filter((r) => r.scheduleType === "open").length
    : 0;

  /** 「전체」는 배타적입니다 — 개별을 고르면 전체가 풀리고, 다 풀면 전체로 돌아옵니다 */
  function toggleCategory(c: string) {
    const next = filters.categories.includes(c)
      ? filters.categories.filter((x) => x !== c)
      : [...filters.categories, c];
    apply({ filters: { ...filters, categories: next } });
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 pb-16">
      <h1 className="mb-5 text-[22px] font-bold">프로그램 찾기</h1>

      {/* 필터바 — 와이어프레임 v2 "숨고식 필터바 + 정렬" */}
      <div className="mb-5 flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-full max-w-[320px]"
            placeholder="지역, 프로그램명으로 검색"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />

          {/* 걸린 지역을 눈에 보이게 둡니다 — 홈에서 고른 조건이 화면에 안 보이면
              「왜 결과가 적은지」를 알 수 없고, 넓히는 방법도 없습니다. */}
          {place && (
            <button
              type="button"
              onClick={() => apply({ place: null })}
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-secondary px-4 text-[14px] font-semibold text-secondary-foreground"
            >
              {place.label}
              <span aria-hidden className="text-[15px] leading-none">
                ×
              </span>
              <span className="sr-only">지역 조건 지우기</span>
            </button>
          )}
        </div>

        {status === "denied" && (
          <p className="text-[12.5px] text-destructive">
            위치 권한이 거부되어 거리순 정렬을 쓸 수 없습니다. 브라우저 주소창의 자물쇠
            아이콘에서 위치 권한을 허용해 주세요.
          </p>
        )}
        {status === "unsupported" && (
          <p className="text-[12.5px] text-destructive">
            이 브라우저는 위치 정보를 지원하지 않습니다.
          </p>
        )}

        {/* 상세 필터 + 카테고리(다중 선택) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            className="flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium hover:bg-secondary"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            필터
            {activeFilterCount > 0 && (
              <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* 상세 필터와 카테고리는 성격이 다릅니다 — 선을 그어 갈라둡니다 */}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />

          {CATEGORIES.map((c) => {
            const active =
              c === "전체"
                ? filters.categories.length === 0
                : filters.categories.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={active}
                className={cn(
                  "rounded-full border bg-card px-3.5 py-1.5 text-[13px] text-muted-foreground",
                  active && "border-primary bg-primary text-primary-foreground"
                )}
                onClick={() => {
                  if (c === "전체") {
                    apply({ filters: { ...filters, categories: [] } });
                    return;
                  }
                  toggleCategory(c);
                }}
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>

      {/* 결과 수 + 정렬 + 목록⇄지도 토글 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          {loading ? "불러오는 중…" : `${total}개 프로그램`}
        </p>

        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-input bg-card px-2.5 text-[13px]"
            value={sort}
            onChange={(e) => apply({ sort: e.target.value as SortKey })}
            aria-label="정렬 기준"
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* 이 버튼도 주소를 바꿉니다 — 안 그러면 지도를 보는 중인데 헤더는
              「프로그램 찾기」가 강조되고, 그 주소를 공유하면 목록이 열립니다. */}
          <div className="flex overflow-hidden rounded-full border bg-card text-[13px] font-semibold">
            <button
              type="button"
              className={cn(
                "px-3.5 py-1.5",
                view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
              onClick={() => apply({ view: "list" })}
            >
              목록형
            </button>
            <button
              type="button"
              className={cn(
                "px-3.5 py-1.5",
                view === "map" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
              onClick={() => apply({ view: "map" })}
            >
              지도형
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
          {error}
        </p>
      )}

      {/* 상시모집은 기간 필터의 예외로 포함됩니다(17-2). 알리지 않으면 「8월로
          검색했는데 날짜가 없는 카드가 섞여 있다」로 읽힙니다. */}
      {!loading && openCount > 0 && (
        <p className="mb-4 rounded-lg bg-secondary px-3 py-2.5 text-[13px] text-secondary-foreground">
          상시모집 {openCount}개는 날짜를 협의하는 방식이라 기간과 무관하게 함께
          표시됩니다.
        </p>
      )}

      {view === "map" ? (
        <ProgramMap
          // 지도는 좌표가 있는 것만 찍습니다 — v18 이전에 등록된 프로그램은
          // 좌표가 비어 있어 지도에 올릴 수 없습니다(19-6).
          programs={filtered
            .map((r) => r.program)
            .filter((p) => p.location.lat != null && p.location.lng != null) as unknown as Program[]}
          userLocation={position}
          onLocate={setMapPosition}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-[18px]">
          {filtered.map(({ program, distance }, i) => (
            <ProgramCard
              key={program.id}
              program={program as unknown as Program}
              distanceKm={distance}
              // 첫 줄(넉 장)은 열자마자 보이는 자리라 지연 로딩을 풉니다.
              // 그 아래는 스크롤해야 보이므로 그대로 미룹니다.
              priority={i < 4}
            />
          ))}
          {!loading && filtered.length === 0 && (
            <p className="col-span-full py-10 text-muted-foreground">
              {place
                ? `${place.label}에는 아직 등록된 프로그램이 없습니다 — 지역 조건을 지우면 전국에서 찾습니다.`
                : activeFilterCount > 0 ||
                    filters.categories.length > 0 ||
                    keyword.trim() !== ""
                  ? "선택한 조건으로는 프로그램이 없습니다 — 카테고리나 지역을 넓혀보세요."
                  : "아직 게시된 프로그램이 없습니다. 심사를 통과한 프로그램이 여기 나타납니다."}
            </p>
          )}
        </div>
      )}

      <FilterModal
        open={filterOpen}
        value={filters}
        count={draftCount}
        calendarDates={calendarDates}
        onDraftChange={countDraft}
        onApply={(next) => {
          apply({ filters: next });
          setFilterOpen(false);
        }}
        onClose={() => setFilterOpen(false)}
      />
    </div>
  );
}
