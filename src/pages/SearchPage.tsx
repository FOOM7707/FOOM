/**
 * 프로그램 찾기 (스키마 17번).
 *
 * **`GET /programs/search`가 걸러 내려줍니다(v28).** 예전에는 `src/mocks/`를 프론트에서
 * 걸렀는데, 판정이 화면과 서버 양쪽에 있으면 「보이는데 서버 결과에는 없는」 프로그램이
 * 생깁니다. 이제 필터·정렬·검색어는 전부 서버가 판단하고, 화면은 요청과 표시만 합니다.
 *
 * **예외가 하나 있습니다 — 「가까운거리순」.** 서버는 사용자의 현재위치를 모르므로
 * 후보를 받아 화면에서 거리로 다시 정렬합니다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
  DEFAULT_FILTERS,
  countActiveFilters,
  toSearchQuery,
  type ProgramFilters,
  type SearchRow,
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [keyword, setKeyword] = useState("");

  // 카테고리는 **다중 선택**입니다(17-3). 빈 배열이 「전체」이고 별도 값을 두지
  // 않습니다 — 「전체」를 값으로 만들면 "전체이면서 숲해설"인 상태가 생깁니다.
  // 홈에서 카테고리 카드를 눌러 들어오면 `?category=`로 한 개가 들어옵니다.
  const initialCategory = params.get("category");
  // 기간은 URL로도 들어옵니다(17-4 ⑤ — 뒤로가기·링크 공유). 형식이 어긋난 값은
  // 조용히 무시합니다 — 어차피 서버가 거부하는 값입니다.
  const initialFrom = params.get("from");
  const initialTo = params.get("to");
  const [filters, setFilters] = useState<ProgramFilters>(() => {
    const from = initialFrom && DATE_RE.test(initialFrom) ? initialFrom : null;
    const to = from && initialTo && DATE_RE.test(initialTo) ? initialTo : null;
    return {
      ...DEFAULT_FILTERS,
      categories: initialCategory ? [initialCategory] : [],
      from,
      to,
    };
  });
  const [filterOpen, setFilterOpen] = useState(false);

  const [sort, setSort] = useState<SortKey>(
    params.get("sort") === "near" ? "가까운거리순" : "인기순"
  );
  const [view, setView] = useState<"list" | "map">(
    params.get("view") === "map" ? "map" : "list"
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const search = useCallback(
    async (f: ProgramFilters, s: SortKey, q: string): Promise<SearchResponse> =>
      apiFetch<SearchResponse>(`/programs/search?${toSearchQuery(f, s, q)}`),
    []
  );

  // 검색어는 타이핑 중이라 **잠깐 기다렸다** 요청합니다. 글자마다 보내면 요청이
  // 수십 개 쌓이고, 늦게 온 응답이 먼저 온 응답을 덮어써 결과가 튑니다.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        search(filters, sort, keyword)
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
      },
      keyword.trim() === "" ? 0 : 250
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filters, sort, keyword, search]);

  /** 모달에서 값을 만질 때 개수를 다시 셉니다. 적용 전이라 목록은 그대로입니다. */
  const countDraft = useCallback(
    (draft: ProgramFilters) => {
      setDraftCount(null);
      void search(draft, sort, keyword)
        .then((res) => setDraftCount(res.total))
        .catch(() => setDraftCount(null));
    },
    [search, sort, keyword]
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

  /** URL에 남기는 것: 카테고리 1개 + 기간(17-4 ⑤ — 뒤로가기·링크 공유) */
  function writeParams(categories: string[], from: string | null, to: string | null) {
    const p: Record<string, string> = {};
    if (categories.length === 1) p.category = categories[0];
    if (from) {
      p.from = from;
      p.to = to ?? from;
    }
    setParams(p);
  }

  /** 「전체」는 배타적입니다 — 개별을 고르면 전체가 풀리고, 다 풀면 전체로 돌아옵니다 */
  function toggleCategory(c: string) {
    setFilters((f) => {
      const next = f.categories.includes(c)
        ? f.categories.filter((x) => x !== c)
        : [...f.categories, c];
      writeParams(next, f.from, f.to);
      return { ...f, categories: next };
    });
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
                  "rounded-full border bg-white px-3.5 py-1.5 text-[13px] text-muted-foreground",
                  active && "border-primary bg-primary text-primary-foreground"
                )}
                onClick={() => {
                  if (c === "전체") {
                    setFilters((f) => ({ ...f, categories: [] }));
                    writeParams([], filters.from, filters.to);
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
            className="h-9 rounded-md border border-input bg-white px-2.5 text-[13px]"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="정렬 기준"
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <div className="flex overflow-hidden rounded-full border bg-white text-[13px] font-semibold">
            <button
              className={cn(
                "px-3.5 py-1.5",
                view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
              onClick={() => setView("list")}
            >
              목록형
            </button>
            <button
              className={cn(
                "px-3.5 py-1.5",
                view === "map" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
              onClick={() => setView("map")}
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
          {filtered.map(({ program, distance }) => (
            <ProgramCard
              key={program.id}
              program={program as unknown as Program}
              distanceKm={distance}
            />
          ))}
          {!loading && filtered.length === 0 && (
            <p className="col-span-full py-10 text-muted-foreground">
              {activeFilterCount > 0 || filters.categories.length > 0 || keyword.trim() !== ""
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
          setFilters(next);
          writeParams(next.categories, next.from, next.to);
          setFilterOpen(false);
        }}
        onClose={() => setFilterOpen(false)}
      />
    </div>
  );
}
