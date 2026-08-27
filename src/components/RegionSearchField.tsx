/**
 * 지역 칸 — **목록에서 고르기와 직접 입력이 함께 됩니다** (2026-08-27, 팀 요청).
 *
 * 「사상구」만 쳐도 「부산 사상구」로 알아듣습니다. 후보는 두 곳에서 옵니다.
 *
 * ① **전국 행정구역 목록**(`src/lib/districts.ts`) — 시·도 17개와 시·군·구 228개.
 *    프로그램이 없는 지역도 나옵니다(전국 서비스가 되면 그때 채워질 자리입니다).
 * ② **프로그램이 있는 지역**(검색 응답의 `districts`) — 읍·면·동까지 내려옵니다.
 *    전국 동 이름은 3,500개라 파일로 들지 않고, 우리가 가진 곳만 서버가 알려줍니다.
 *
 * **②를 위에 올리고 개수를 함께 보여줍니다.** 프로그램이 없는 지역을 고르면 결과가
 * 0건인데, 그걸 고르기 전에 알려주는 편이 낫습니다 — 0건은 고장으로 읽힙니다.
 *
 * 목록에 없는 말(「양평」·「성산일출봉」)을 쳐도 버리지 않습니다. 홈이 그 글자를
 * **검색어로** 넘깁니다 — 조용히 버리면 왜 안 걸렸는지 알 방법이 없습니다.
 *
 * **브라우저 기본 자동완성(`<datalist>`)을 쓰지 않았습니다.** 목록이 열리는 방식이
 * 브라우저마다 다르고(파이어폭스는 눌러도 안 열립니다) 「여기 목록이 있다」는 표시가
 * 나타나지 않습니다 — 목록을 찾지 못하는 것이 이 화면에서 고치려던 문제입니다.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { DISTRICTS, SIDO_LABEL } from "@/lib/districts";
import type { PlaceFilter } from "@/lib/programFilter";
import type { Sido } from "@/types/firestore";

/** 검색 응답이 알려주는 「프로그램이 있는 지역」 */
export interface ProgramDistrict {
  sido: string;
  name: string;
  count: number;
}

interface Candidate extends PlaceFilter {
  /** 게시된 프로그램 수 — 전국 목록에서 온 후보는 없습니다 */
  count?: number;
}

/**
 * 한 번에 보여줄 후보 수. 228개를 다 그리면 목록이 화면을 덮고, 스크롤을 내려
 * 찾는 것은 「목록에서 고르기」의 이점을 없앱니다 — 더 치면 좁혀집니다.
 */
const MAX_VISIBLE = 8;

/** 공백·구분점을 떼고 비교합니다 — 「경기 수원시」와 「경기수원시」가 같은 값입니다 */
function normalize(text: string): string {
  return text.replace(/[\s·/,]/g, "");
}

interface Props {
  /** 입력칸에 보이는 글자 */
  value: string;
  onChange: (next: string) => void;
  /**
   * 목록에서 고른 지역. 글자를 다시 치면 null로 비웁니다 — 고른 뒤에 글자를 바꿨는데
   * 옛 선택이 남아 있으면 화면과 실제로 걸리는 조건이 어긋납니다.
   */
  onPick: (pick: PlaceFilter | null) => void;
  /** 검색 응답의 `districts` */
  programDistricts?: ProgramDistrict[];
  /** 입력칸에 그대로 붙는 클래스 — 홈의 검색 막대는 테두리 없는 형태를 씁니다 */
  className?: string;
  placeholder?: string;
  id?: string;
}

export default function RegionSearchField({
  value,
  onChange,
  onPick,
  programDistricts,
  className,
  placeholder = "지역을 고르거나 직접 입력",
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  /** 프로그램이 있는 지역 먼저, 그 뒤에 전국 목록. 같은 지역은 앞의 것만 남깁니다 */
  const all = useMemo<Candidate[]>(() => {
    const mine: Candidate[] = (programDistricts ?? []).map((d) => ({
      sido: d.sido,
      locality: d.name,
      label: `${SIDO_LABEL[d.sido as Sido] ?? ""} ${d.name}`.trim(),
      count: d.count,
    }));
    const nationwide: Candidate[] = DISTRICTS.map((d) => ({
      sido: d.sido,
      locality: d.name,
      label: d.label,
    }));

    const seen = new Set<string>();
    return [...mine, ...nationwide].filter((c) => {
      const key = `${c.sido}|${c.locality ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [programDistricts]);

  const matched = useMemo(() => {
    const q = normalize(value);
    if (q === "") return all;
    return all.filter(
      (c) => normalize(c.label).includes(q) || normalize(c.locality ?? "").includes(q)
    );
  }, [all, value]);

  const visible = matched.slice(0, MAX_VISIBLE);
  const hidden = matched.length - visible.length;

  // 다른 곳을 누르면 닫습니다. 입력칸의 blur로 닫으면 **목록 항목을 누르는 순간**
  // 먼저 닫혀서 선택이 안 됩니다(누르기 전에 blur가 먼저 옵니다).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function pick(c: Candidate) {
    onChange(c.label);
    onPick({ sido: c.sido, locality: c.locality, label: c.label });
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onPick(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          // 목록이 열린 채로 엔터를 누르면 검색이 함께 실행돼 「고르려고 눌렀는데
          // 검색이 됐다」가 됩니다. 첫 후보를 고르고 검색은 막습니다.
          if (e.key === "Enter" && open && value.trim() !== "" && visible.length > 0) {
            e.preventDefault();
            pick(visible[0]);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className={cn("pr-7", className)}
      />
      <button
        type="button"
        // 화살표를 눌러도 칸에 초점이 가지 않게 합니다 — 초점이 가면 onFocus가
        // 다시 열어서 닫기 버튼으로는 동작하지 않습니다.
        onPointerDown={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        aria-label="지역 목록 열기"
        className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"
      >
        <ChevronDown className="size-4" aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[15rem] overflow-hidden rounded-xl border bg-card text-left shadow-[0_10px_24px_rgba(0,0,0,0.10)]">
          <ul role="listbox" className="max-h-72 overflow-auto py-1.5">
            {visible.map((c) => (
              <li key={`${c.sido}|${c.locality ?? ""}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === c.label}
                  onClick={() => pick(c)}
                  className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[14.5px] hover:bg-secondary"
                >
                  <span className="truncate">{c.label}</span>
                  {c.count != null && (
                    <span className="shrink-0 text-[12px] font-semibold text-primary">
                      {c.count}개
                    </span>
                  )}
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-4 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
                그 이름의 지역은 목록에 없습니다. 그대로 검색하면 프로그램 이름·소개에서
                찾습니다.
              </li>
            )}
          </ul>
          {hidden > 0 && (
            <p className="border-t px-4 py-2 text-[12px] text-muted-foreground">
              {hidden}곳 더 있습니다 — 더 치면 좁혀집니다
            </p>
          )}
        </div>
      )}
    </div>
  );
}
