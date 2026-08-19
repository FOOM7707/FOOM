import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { mockPrograms } from "../mocks/programs";
import { CATEGORIES, type Category } from "../types/firestore";
import ProgramCard from "../components/ProgramCard";
import ProgramMap from "../components/ProgramMap";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import {
  REGIONS,
  distanceKm,
  regionOfAddress,
  type LatLng,
  type Region,
} from "@/lib/geo";

type SortKey = "인기순" | "낮은가격순" | "가까운거리순";
const SORTS: SortKey[] = ["인기순", "낮은가격순", "가까운거리순"];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initialCategory = (params.get("category") as Category) || "전체";
  const initialRegion = (params.get("region") as Region) || "전체지역";
  const [category, setCategory] = useState<Category>(initialCategory);
  const [keyword, setKeyword] = useState("");
  const [region, setRegion] = useState<Region>(initialRegion);
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

  const filtered = useMemo(() => {
    const rows = mockPrograms
      .filter((p) => {
        const matchesCategory = category === "전체" || p.category === category;
        const matchesRegion =
          region === "전체지역" || regionOfAddress(p.location.address) === region;
        const matchesKeyword =
          keyword.trim() === "" ||
          p.title.includes(keyword) ||
          p.description.includes(keyword) ||
          p.location.address.includes(keyword);
        return matchesCategory && matchesRegion && matchesKeyword;
      })
      .map((p) => ({
        program: p,
        distance: position ? distanceKm(position, p.location) : null,
      }));

    if (sort === "낮은가격순") {
      rows.sort((a, b) => a.program.price - b.program.price);
    } else if (sort === "가까운거리순") {
      // 현재위치가 없으면 정렬 기준이 없으므로 순서를 유지합니다
      rows.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    }
    return rows;
  }, [category, keyword, region, sort, position]);



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

          <select
            className="h-10 rounded-md border border-input bg-white px-3 text-sm"
            value={region}
            onChange={(e) => setRegion(e.target.value as Region)}
            aria-label="지역 선택"
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
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

        {/* 카테고리 */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={cn(
                "rounded-full border bg-white px-3.5 py-1.5 text-[13px] text-muted-foreground",
                c === category && "border-primary bg-primary text-primary-foreground"
              )}
              onClick={() => {
                setCategory(c);
                setParams(c === "전체" ? {} : { category: c });
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* 결과 수 + 정렬 + 목록⇄지도 토글 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">{filtered.length}개 프로그램</p>

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

      {view === "map" ? (
        <ProgramMap
          programs={filtered.map((r) => r.program)}
          userLocation={position}
          onLocate={setMapPosition}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-[18px]">
          {filtered.map(({ program, distance }) => (
            <ProgramCard key={program.id} program={program} distanceKm={distance} />
          ))}
          {filtered.length === 0 && (
            <p className="py-10 text-muted-foreground">조건에 맞는 프로그램이 없습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}
