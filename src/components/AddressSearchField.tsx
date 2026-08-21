import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { searchPlaces, type Place, type PickedPlace } from "@/lib/places";

/**
 * 주소를 **검색해서 고르게** 하는 입력칸 (스키마 16-4).
 *
 * 직접 타이핑하게 두지 않는 이유가 둘입니다.
 *
 * ① **좌표가 안 붙습니다.** 기상청은 주소를 받지 않고 격자 좌표만 받으므로, 좌표가
 *    없는 프로그램은 상세 화면에서 영영 「예보를 제공하지 않는 지역입니다」로 뜹니다.
 *    지금까지 등록된 프로그램이 전부 그 상태입니다.
 * ② **시도를 못 뽑으면 저장이 거부됩니다.** "홍천군 서면"처럼 시도 없이 적으면
 *    `extractSido`가 실패해 등록이 막히는데, 카카오가 준 주소는 항상 시도로 시작합니다.
 *
 * 그래서 주소 문자열과 좌표를 **한 쌍으로** 고르게 만듭니다.
 */
interface Props {
  /** 수정 화면이 불러온 값은 좌표가 없을 수 있어 `PickedPlace`로 받습니다 */
  value: PickedPlace | null;
  onChange: (place: Place | null) => void;
}

export default function AddressSearchField({ value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runSearch() {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError("검색어를 두 글자 이상 입력해 주세요");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await searchPlaces(trimmed);
      setResults(result.places);
      setTruncated(result.truncated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "검색에 실패했습니다");
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  // 검색창에서 Enter를 누르면 **바깥 폼이 제출됩니다.** 주소를 고르기도 전에
  // 등록이 시도되므로 여기서 가로채 검색으로 돌립니다.
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void runSearch();
    }
  }

  function select(place: Place) {
    onChange(place);
    setResults(null);
    setError(null);
  }

  if (value) {
    return (
      <div className="rounded-lg border border-primary/40 bg-secondary px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {value.placeName && (
              <p className="text-sm font-semibold">{value.placeName}</p>
            )}
            <p className="text-sm break-keep">{value.address}</p>
            {value.roadAddress && (
              <p className="mt-0.5 text-xs text-muted-foreground break-keep">
                도로명 {value.roadAddress}
              </p>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              좌표 확인됨 · 상세 화면에 날씨가 표시됩니다
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
          >
            다시 찾기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          id="address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="예: 강원 홍천군 서면 / 국립산음자연휴양림"
        />
        {/* type="button" — 없으면 이 버튼이 폼을 제출합니다 */}
        <Button type="button" variant="outline" onClick={runSearch} disabled={busy}>
          {busy ? "검색 중…" : "검색"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        주소나 장소 이름으로 찾아 목록에서 골라주세요. 좌표가 함께 저장돼야 상세 화면에
        날씨가 표시됩니다.
      </p>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {results && results.length === 0 && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          검색 결과가 없습니다. 장소 이름이나 더 짧은 주소로 다시 찾아보세요.
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {results.map((place, i) => {
            // 시도를 못 뽑은 주소는 서버가 저장을 거부합니다(4번).
            // 목록에서 빼버리면 "검색은 되는데 결과가 없다"로 보이므로,
            // 보여주되 고를 수 없게 하고 이유를 적습니다.
            const usable = place.sido != null;
            return (
              <li key={`${place.address}-${place.lat}-${i}`}>
                <button
                  type="button"
                  disabled={!usable}
                  onClick={() => select(place)}
                  className="w-full px-3.5 py-2.5 text-left hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
                >
                  {place.placeName && (
                    <span className="block text-sm font-semibold">{place.placeName}</span>
                  )}
                  <span className="block text-sm break-keep">{place.address}</span>
                  {place.roadAddress && (
                    <span className="mt-0.5 block text-xs text-muted-foreground break-keep">
                      도로명 {place.roadAddress}
                    </span>
                  )}
                  {!usable && (
                    <span className="mt-1 block text-xs text-destructive">
                      시도를 인식할 수 없는 주소라 등록에 쓸 수 없습니다
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {truncated && (
        <p className="text-xs text-muted-foreground">
          결과가 많아 앞의 10건만 보여드립니다. 더 자세한 주소로 다시 찾아보세요.
        </p>
      )}
    </div>
  );
}
