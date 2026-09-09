/**
 * 목록에서 하나 고르는 칸 — **지역 칸(`RegionSearchField`)과 같은 생김새**입니다 (2026-09-09).
 *
 * 홈 검색 막대의 「프로그램 종류」가 브라우저 기본 `<select>`였는데, 옆의 지역 칸은 직접 그린
 * 목록이라 **두 칸이 눌렀을 때 다르게 열렸습니다**(기본 select는 운영체제 창, 지역은 우리
 * 카드). 같은 줄에 놓인 칸은 같은 방식으로 열려야 하나로 읽힙니다.
 *
 * 열림 상태는 밖에서 넘길 수 있습니다(`open`·`onOpenChange`) — 홈은 「한 번에 하나만
 * 열림」을 화면 단위로 관리해서, 달력을 연 채 이 칸을 누르면 달력이 닫힙니다.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChoiceOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  options: ChoiceOption[];
  /** 아무것도 안 골랐을 때 보이는 글자 */
  placeholder: string;
  /** 첫 항목으로 「전체」를 둘 때 그 표시 글자. 없으면 값이 빈 항목을 만들지 않습니다 */
  allLabel?: string;
  /** 버튼(칸)에 그대로 붙는 클래스 — 홈의 검색 막대는 테두리 없는 형태를 씁니다 */
  className?: string;
  id?: string;
  /** 밖에서 열림을 관리할 때. 없으면 스스로 관리합니다 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function ChoiceDropdown({
  value,
  onChange,
  options,
  placeholder,
  allLabel,
  className,
  id,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    if (controlledOpen === undefined) setInnerOpen(next);
  };
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 다른 곳을 누르면 닫습니다 — 지역 칸과 같은 방식(blur로 닫으면 항목을 누르기 전에 닫힘).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // setOpen은 매 렌더마다 새 함수지만 내용이 같아 의존성에 넣지 않습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const all: ChoiceOption[] = allLabel ? [{ value: "", label: allLabel }, ...options] : options;
  const current = all.find((o) => o.value === value);

  return (
    <div ref={boxRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex items-center text-left",
          value === "" && "font-normal text-muted-foreground",
          className
        )}
      >
        <span className="truncate">{current && value !== "" ? current.label : placeholder}</span>
      </button>
      {/* 화살표는 지역 칸과 같은 자리·크기입니다 */}
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
        aria-label="목록 열기"
        className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"
      >
        <ChevronDown className="size-4" aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[15rem] overflow-hidden rounded-xl border bg-card text-left shadow-[0_10px_24px_rgba(0,0,0,0.10)]">
          <ul role="listbox" className="max-h-72 overflow-auto py-1.5">
            {all.map((o) => (
              <li key={o.value || "__all"}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[14.5px] hover:bg-secondary",
                    o.value === value && "font-semibold text-primary"
                  )}
                >
                  <span className="truncate">{o.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
