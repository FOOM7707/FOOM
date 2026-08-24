import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Difficulty, TargetAgeTag } from "@/types/firestore";
import DateRangeCalendar from "@/components/DateRangeCalendar";
import { REGION_KEYS, type RegionKey } from "@/lib/sido";
import {
  AGE_TAG_LABELS,
  DEFAULT_FILTERS,
  DIFFICULTY_LABELS,
  HEADCOUNT_OPTIONS,
  PRICE_MAX,
  countActiveFilters,
  type ProgramFilters,
} from "@/lib/programFilter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 상세 필터 모달 (스키마 17-3 · 17-4).
 *
 * **모달 안에서는 임시값(draft)을 만지고, 「결과 보기」를 눌러야 반영됩니다.**
 * 만질 때마다 목록이 바뀌면 뒤에서 결과가 계속 흔들려 무엇 때문에 줄었는지
 * 알 수 없습니다. 대신 **버튼에 결과 개수를 실시간으로 표시**해서, 적용하기 전에
 * 몇 건이 남는지 보이게 합니다.
 *
 * 카테고리는 이 모달에 넣지 않습니다 — 칩이 화면에 이미 나와 있어 두 곳에서
 * 같은 값을 만지게 되고, 어느 쪽이 최신인지 헷갈립니다.
 */
interface Props {
  open: boolean;
  value: ProgramFilters;
  /**
   * 「N개 결과 보기」에 쓸 개수. **서버가 돌려준 값**입니다(v28) —
   * 판정을 화면에서 다시 하면 서버 결과와 어긋나 「보이는데 없는」 프로그램이 생깁니다.
   * 아직 세는 중이면 null입니다.
   */
  count: number | null;
  /**
   * 회차가 있는 날짜 목록 — 달력의 「회차 있는 날」 점(17-4 ④)에 씁니다.
   * 검색 응답이 함께 내려줍니다. **필터와 무관한 전체 프로그램 기준**이라
   * 점이 있어도 지금 조건으로는 0건일 수 있습니다(17-5의 알려진 한계).
   */
  calendarDates?: string[];
  /** 모달 안에서 값을 만질 때마다 알려줍니다 — 개수를 다시 세기 위함입니다 */
  onDraftChange?: (draft: ProgramFilters) => void;
  onApply: (next: ProgramFilters) => void;
  onClose: () => void;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input hover:bg-secondary"
      )}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b px-5 py-5 last:border-b-0">
      <h3 className="mb-3 text-[15px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** 「8월 25일 ~ 9월 2일」 — 선택 기간 요약 */
function periodLabel(from: string, to: string | null): string {
  const fmt = (date: string) => {
    const [, m, d] = date.split("-").map(Number);
    return `${m}월 ${d}일`;
  };
  if (!to || to === from) return `${fmt(from)} 하루`;
  return `${fmt(from)} ~ ${fmt(to)}`;
}

export default function FilterModal({
  open,
  value,
  count,
  calendarDates,
  onDraftChange,
  onApply,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<ProgramFilters>(value);

  // 열 때마다 바깥의 현재 값에서 다시 시작합니다. 닫으면서 취소한 내용이
  // 다음에 열었을 때 남아 있으면 "안 고쳤는데 필터가 걸려 있다"가 됩니다.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  // ESC로 닫기 + 뒤 배경 스크롤 잠그기.
  // 잠그지 않으면 모달 위에서 휠을 굴릴 때 뒤 목록이 움직여 어지럽습니다.
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

  const activeCount = countActiveFilters(draft);

  function patch(part: Partial<ProgramFilters>) {
    setDraft((d) => {
      const next = { ...d, ...part };
      onDraftChange?.(next);
      return next;
    });
  }

  function toggleAge(tag: TargetAgeTag) {
    setDraft((d) => ({
      ...d,
      ageTags: d.ageTags.includes(tag)
        ? d.ageTags.filter((t) => t !== tag)
        : [...d.ageTags, tag],
    }));
  }

  /** 같은 값을 다시 누르면 해제 — 단일 선택에는 「전체」 버튼이 따로 필요 없습니다 */
  function pick<T>(current: T | null, next: T): T | null {
    return current === next ? null : next;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="상세 필터"
    >
      {/* 배경 — 누르면 닫힙니다 */}
      <button
        type="button"
        aria-label="필터 닫기"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50"
      />

      <div className="relative flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl bg-background shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-bold">필터</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* 기간이 맨 위입니다 — 「언제 갈 수 있는가」가 보통 가장 먼저 정해지는
              조건입니다(17-3의 항목 순서도 카테고리 다음이 기간입니다). */}
          <Section title="기간">
            <DateRangeCalendar
              from={draft.from}
              to={draft.to}
              markedDates={calendarDates}
              onChange={(from, to) => patch({ from, to })}
            />
            {draft.from && (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-secondary px-3.5 py-2.5">
                <p className="text-[13px] font-semibold text-secondary-foreground">
                  {periodLabel(draft.from, draft.to)}
                  {!draft.to && (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      — 종료일을 누르면 기간이 됩니다
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => patch({ from: null, to: null })}
                  className="text-xs font-semibold underline underline-offset-2"
                >
                  날짜 지우기
                </button>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              숫자 아래 점은 진행 날짜가 있는 날입니다. 날짜를 협의하는 상시모집
              프로그램은 기간과 무관하게 함께 보입니다.
            </p>
          </Section>

          <Section title="지역">
            <div className="flex flex-wrap gap-2">
              {REGION_KEYS.map((r) => (
                <Chip
                  key={r}
                  active={draft.region === r}
                  onClick={() => patch({ region: pick<RegionKey>(draft.region, r) })}
                >
                  {r}
                </Chip>
              ))}
            </div>
          </Section>

          <Section title="가격">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={5000}
                value={draft.priceMin}
                onChange={(e) => patch({ priceMin: Math.max(0, Number(e.target.value)) })}
                className="h-10 w-full rounded-md border border-input px-3 text-sm"
                aria-label="최저 가격"
              />
              <span className="text-muted-foreground">~</span>
              <input
                type="number"
                min={0}
                step={5000}
                max={PRICE_MAX}
                value={draft.priceMax}
                onChange={(e) =>
                  patch({ priceMax: Math.min(PRICE_MAX, Number(e.target.value)) })
                }
                className="h-10 w-full rounded-md border border-input px-3 text-sm"
                aria-label="최고 가격"
              />
            </div>
            <input
              type="range"
              min={0}
              max={PRICE_MAX}
              step={5000}
              value={draft.priceMax}
              onChange={(e) => patch({ priceMax: Number(e.target.value) })}
              className="mt-3 w-full accent-primary"
              aria-label="최고 가격 조절"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              1인 기준입니다. 최고 가격이 {PRICE_MAX.toLocaleString()}원이면 「
              {PRICE_MAX.toLocaleString()}원 이상」으로 봅니다.
            </p>
          </Section>

          <Section title="인원">
            <div className="flex flex-wrap gap-2">
              {HEADCOUNT_OPTIONS.map((n) => (
                <Chip
                  key={n}
                  active={draft.headcount === n}
                  onClick={() => patch({ headcount: pick<number>(draft.headcount, n) })}
                >
                  {n === 1 ? "혼자 (1인)" : `${n}명`}
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              그 인원을 받을 수 있고, <strong>그 인원만으로도 진행되는</strong> 프로그램만
              봅니다. 「혼자」를 고르면 최소 인원이 1명이라 <strong>인원 미달로 취소되지
              않는</strong> 프로그램만 남습니다.
            </p>
          </Section>

          <Section title="대상 연령">
            <div className="flex flex-wrap gap-2">
              {AGE_TAG_LABELS.map((a) => (
                <Chip
                  key={a.value}
                  active={draft.ageTags.includes(a.value)}
                  onClick={() => toggleAge(a.value)}
                >
                  {a.label}
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              나이 제한이 없는 프로그램은 어느 연령을 고르든 항상 함께 보입니다.
            </p>
          </Section>

          <Section title="난이도">
            <div className="flex flex-wrap gap-2">
              {DIFFICULTY_LABELS.map((d) => (
                <Chip
                  key={d.value}
                  active={draft.difficulty === d.value}
                  onClick={() =>
                    patch({ difficulty: pick<Difficulty>(draft.difficulty, d.value) })
                  }
                >
                  {d.label}
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              걷는 거리로 정해집니다 — 공급자가 임의로 고르는 값이 아닙니다.
            </p>
          </Section>

          <Section title="편의·조건">
            <label className="flex cursor-pointer items-start gap-2.5 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={draft.barrierFree}
                onChange={(e) => patch({ barrierFree: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                배리어프리(무장애) 코스
                <span className="block text-xs text-muted-foreground">
                  휠체어·유모차로 다닐 수 있게 턱과 경사를 줄인 길입니다.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={draft.rainAlternative}
                onChange={(e) => patch({ rainAlternative: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                비가 와도 진행
                <span className="block text-xs text-muted-foreground">
                  실내로 바꾸거나 다른 날로 옮겨 진행합니다. 어느 쪽인지는 상세 화면에
                  적혀 있습니다.
                </span>
              </span>
            </label>
          </Section>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-5 py-3.5">
          <button
            type="button"
            onClick={() =>
              setDraft({ ...DEFAULT_FILTERS, categories: draft.categories })
            }
            disabled={activeCount === 0}
            className="text-sm font-semibold underline underline-offset-4 disabled:text-muted-foreground disabled:no-underline"
          >
            전체 해제
          </button>
          <Button onClick={() => onApply(draft)}>
            {count == null ? "결과 보기" : `${count}개 결과 보기`}
          </Button>
        </footer>
      </div>
    </div>
  );
}
