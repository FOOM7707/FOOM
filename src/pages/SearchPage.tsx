import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { X } from "lucide-react";
import { mockPrograms } from "../mocks/programs";
import { CATEGORIES, type Category } from "../types/firestore";
import ProgramCard from "../components/ProgramCard";
import ProgramMap from "../components/ProgramMap";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { REGIONS, distanceKm, regionOfAddress, type Region } from "@/lib/geo";

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

  const { position, status, request, clear } = useCurrentLocation();

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

  const needsLocation = sort === "가까운거리순" && !position;

  // 지도에서 고른 프로그램. **`filtered`에서 찾습니다** — 필터를 바꿔 목록에서
  // 빠지면 지도에도 핀이 없으므로, 남아 있던 카드가 저절로 사라집니다.
  const selected = filtered.find((r) => r.program.id === selectedId) ?? null;

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

          {/* 현재위치 (Geolocation) */}
          {position ? (
            <Button variant="secondary" size="default" onClick={clear}>
              📍 현재위치 사용중 · 해제
            </Button>
          ) : (
            <Button
              variant="outline"
              size="default"
              onClick={request}
              disabled={status === "loading"}
            >
              {status === "loading" ? "위치 확인 중…" : "📍 내 현재위치"}
            </Button>
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

      {needsLocation && (
        <p className="mb-4 rounded-lg bg-secondary px-3.5 py-2.5 text-[12.5px] text-secondary-foreground">
          가까운거리순으로 보려면 「📍 내 현재위치」를 눌러 위치를 허용해 주세요.
        </p>
      )}

      {view === "map" ? (
        <div className="space-y-3">
          <ProgramMap
            programs={filtered.map((r) => r.program)}
            userLocation={position}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />

          {/* 핀을 누르면 여기에 카드가 뜹니다. 목록형과 **같은 카드**를 씁니다 —
              지도에서 고른 것과 목록에서 본 것이 다르게 생기면 같은 프로그램인지
              한 번 더 확인하게 됩니다.

              선택 전에도 이 자리를 비워두고 안내 문구를 둡니다. 카드가 나타날 때
              지도가 밀려 올라가면 방금 누른 핀이 화면 밖으로 나가버립니다. */}
          {selected ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold">선택한 프로그램</span>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                  선택 해제
                </button>
              </div>
              <div className="w-full max-w-[280px]">
                <ProgramCard
                  program={selected.program}
                  distanceKm={selected.distance}
                />
              </div>
            </div>
          ) : (
            <p className="rounded-lg bg-secondary px-3.5 py-2.5 text-[12.5px] text-secondary-foreground">
              지도에서 핀을 누르면 여기에 프로그램이 표시됩니다.
            </p>
          )}
        </div>
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
