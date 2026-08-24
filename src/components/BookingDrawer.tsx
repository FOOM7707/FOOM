/**
 * 날짜 선택 서랍 (스키마 20-5 · 2-5의 예약 첫 단계).
 *
 * 상세 페이지 하단 고정 「참여하기」가 엽니다. **날짜 선택까지만 실제로 동작**하고
 * 결제 자리에는 「준비 중」이 들어갑니다 — 회차 데이터가 실제라 여기까지는 진짜이고,
 * 예약 기능이 붙는 날 이 서랍을 그대로 씁니다(20-5).
 *
 * 상시모집(`open`)은 고를 날짜 자체가 없습니다 — 협의 안내로 대체합니다(2-4).
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DrawerSchedule {
  id: string;
  startAt: string;
  endAt: string | null;
  seriesIndex: number | null;
  totalSlots?: number;
  remainingSlots: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  price: number;
  scheduleType: string;
  availableFrom: string | null;
  availableUntil: string | null;
  /** 미래 회차만 — 상세 페이지가 걸러서 넘깁니다 */
  schedules: DrawerSchedule[];
  /** 회차 목록에서 「날짜 선택」을 눌러 열었을 때, 그 회차가 선택된 채 열립니다 */
  initialSelectedId?: string | null;
}

/** 「9월 5일 (금) 10:00~12:00」 — 상세 페이지의 회차 표기와 같은 모양입니다 */
function formatSchedule(startAt: string, endAt: string | null): string {
  const start = new Date(startAt);
  const head = start.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (!endAt) return head;
  const end = new Date(endAt).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${head} ~ ${end}`;
}

export default function BookingDrawer({
  open,
  onClose,
  price,
  scheduleType,
  availableFrom,
  availableUntil,
  schedules,
  initialSelectedId,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 열 때마다 선택을 다시 잡습니다 — 지난번에 고른 날짜가 남아 있으면
  // "내가 안 골랐는데 골라져 있다"가 됩니다.
  useEffect(() => {
    if (open) setSelectedId(initialSelectedId ?? null);
  }, [open, initialSelectedId]);

  // ESC로 닫기 + 뒤 배경 스크롤 잠그기 (FilterModal과 같은 규칙).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const isOpen = scheduleType === "open";
  const selected = schedules.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="날짜 선택">
      {/* 배경 — 누르면 닫힙니다 */}
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50"
      />

      <div className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[80vh] w-full max-w-[600px] flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-bold">{isOpen ? "일정 협의 안내" : "날짜 선택"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isOpen ? (
            <div className="rounded-2xl border px-5 py-5">
              <p className="text-[15px] font-bold">날짜를 협의해서 정합니다</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                단체·기관 맞춤 프로그램입니다. 신청 후 채팅으로 일정을 협의합니다.
                {availableFrom && availableUntil && (
                  <>
                    <br />
                    문의 가능 기간 {availableFrom} ~ {availableUntil}
                  </>
                )}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5" role="radiogroup" aria-label="진행 날짜">
              {schedules.map((s) => {
                const total = s.totalSlots ?? s.remainingSlots;
                const soldOut = s.remainingSlots <= 0;
                const active = s.id === selectedId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={soldOut}
                      onClick={() => setSelectedId(active ? null : s.id)}
                      className={cn(
                        "flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4 text-left transition-colors",
                        active && "border-primary bg-primary/5",
                        soldOut && "opacity-50",
                        !soldOut && !active && "hover:bg-secondary"
                      )}
                    >
                      <div>
                        <p className="text-[15px] font-bold">
                          {s.seriesIndex != null && (
                            <span className="mr-2 text-primary">{s.seriesIndex}회차</span>
                          )}
                          {formatSchedule(s.startAt, s.endAt)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {soldOut ? "마감되었습니다" : `남은 자리 ${s.remainingSlots}/${total}`}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "text-[13px] font-semibold",
                          active ? "text-primary" : "text-muted-foreground"
                        )}
                      >
                        {soldOut ? "마감" : active ? "선택됨 ✓" : "선택"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="shrink-0 border-t px-5 py-3.5">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {selected ? formatSchedule(selected.startAt, selected.endAt) : "1인 기준"}
            </span>
            <span className="text-lg font-extrabold">{price.toLocaleString()}원</span>
          </div>
          {/* 결제 자리입니다 — 예약·결제가 붙는 날 이 버튼이 다음 단계로 이어집니다(20-5).
              눌리는 척하는 버튼을 두지 않고, 준비 중임을 버튼 자체에 적습니다. */}
          <Button className="w-full" size="lg" disabled>
            {isOpen
              ? "문의 기능 준비 중"
              : selected
                ? "예약 기능 준비 중"
                : "날짜를 선택해 주세요"}
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {isOpen
              ? "1:1 문의가 열리면 이 자리에서 바로 협의를 시작할 수 있습니다."
              : "예약·결제 기능을 준비하고 있습니다. 열리면 이 자리에서 바로 이어집니다."}
          </p>
        </footer>
      </div>
    </div>
  );
}
