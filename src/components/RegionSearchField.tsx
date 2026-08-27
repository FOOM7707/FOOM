/**
 * 지역 칸 — **목록에서 고르는 것과 직접 입력이 함께 됩니다** (2026-08-27, 팀 요청).
 *
 * 전에는 목록(`<select>`)만이었습니다. 목록은 안전하지만 **머릿속에 있는 이름을 그대로
 * 칠 수 없습니다** — 「인천」·「부산」·「양평」처럼요. 반대로 직접 입력만 두면 어떤
 * 지역을 다루는지 화면에서 사라져서, 무엇을 쳐야 하는지 모르는 사람이 멈춥니다.
 *
 * 그래서 둘 다 둡니다 — 칸을 누르면(또는 오른쪽 화살표) **7개 권역이 그대로 펼쳐지고**,
 * 글자를 치면 그에 맞춰 좁혀집니다. 목록에 없는 지명을 쳐도 버리지 않습니다: 권역으로
 * 못 맞추면 홈이 그 글자를 **검색어로** 넘깁니다(`matchRegion` 참고).
 *
 * **브라우저 기본 자동완성(`<datalist>`)을 쓰지 않았습니다.** 목록이 열리는 방식이
 * 브라우저마다 다르고(파이어폭스는 눌러도 안 열립니다) 「여기 목록이 있다」는 표시가
 * 나타나지 않습니다 — 목록을 찾지 못하는 것이 이 화면에서 고치려던 문제입니다.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { suggestRegions } from "@/lib/regionMatch";

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** 입력칸에 그대로 붙는 클래스 — 홈의 검색 막대는 테두리 없는 형태를 씁니다 */
  className?: string;
  placeholder?: string;
  id?: string;
}

export default function RegionSearchField({
  value,
  onChange,
  className,
  placeholder = "지역을 고르거나 직접 입력",
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const options = suggestRegions(value);

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

  function pick(region: string) {
    onChange(region);
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
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          // 목록이 열린 채로 엔터를 누르면 검색이 함께 실행돼 「고르려고 눌렀는데
          // 검색이 됐다」가 됩니다. 첫 항목을 고르고 검색은 막습니다.
          if (e.key === "Enter" && open && value.trim() !== "" && options.length > 0) {
            e.preventDefault();
            pick(options[0]);
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
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-64 overflow-auto rounded-xl border bg-card py-1.5 text-left shadow-[0_10px_24px_rgba(0,0,0,0.10)]"
        >
          {options.map((r) => (
            <li key={r}>
              <button
                type="button"
                role="option"
                aria-selected={value === r}
                onClick={() => pick(r)}
                className={cn(
                  "block w-full px-4 py-2.5 text-left text-[14.5px] hover:bg-secondary",
                  value === r && "font-bold text-primary"
                )}
              >
                {r}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
