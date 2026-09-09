/**
 * 내 프로그램 (공급자 대시보드 최소판).
 *
 * `GET /programs?mine=1`은 게시 여부와 무관하게 **본인 소유 전부**를 돌려줍니다.
 * 검색·필터는 이 경로가 아니라 `GET /programs/search`입니다(17-1).
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, apiFetch } from "@/lib/api";

interface ProgramRow {
  id: string;
  title: string;
  category: string;
  status: string;
  price: number;
  sido: string;
  difficulty: string;
  scheduleType?: string;
  /** 오늘~+90일 사이의 예약 가능 날짜. 서버가 회차에서 계산한 사본입니다(2-3) */
  scheduleDates?: string[];
  /** 상시모집의 문의 가능 기간 끝 */
  availableUntil?: string | null;
  /**
   * 한 번이라도 게시된 적 있는가 — **「지우기」인지 「내리기」인지를 가릅니다.**
   * `status`로는 알 수 없습니다: `hidden`이 「반려된 것」과 「내려간 것」 둘 다입니다.
   */
  everPublished?: boolean;
  reviewNote?: string | null;
  /** 수정본이 반려된 사유. 게시본은 그대로 살아 있습니다(v23) */
  editReviewNote?: string | null;
  location?: { address?: string };
}

const STATUS_LABEL: Record<string, string> = {
  draft: "작성 중",
  pending_review: "심사 중",
  published: "게시 중",
  hidden: "반려·숨김",
};

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "쉬움",
  normal: "보통",
  hard: "어려움",
};

/** "2026-09-05" → "9월 5일" */
function formatDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

/** 오늘(KST) — 서버의 만료 판정과 같은 기준을 쓰려면 한국 날짜여야 합니다. */
function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

/**
 * 진행할 날짜가 남아 있는가 — **서버 검색의 만료 판정과 같은 규칙입니다**
 * (`functions/src/lib/programSearch.ts`의 `hasBookableDate`).
 *
 * 두 곳이 갈라지면 「목록에는 정상인데 검색에는 안 나오는」 상태가 되고, 공급자는
 * 원인을 알 수 없습니다. **서버 규칙을 고치면 여기도 함께 고쳐야 합니다.**
 *
 * `scheduleDates`는 회차를 만들거나 지울 때만 다시 계산되므로 **지난 날짜가 그대로
 * 남아 있을 수 있습니다** — 비었는지가 아니라 오늘 이후가 있는지로 봅니다.
 */
function hasBookableDate(p: ProgramRow): boolean {
  const today = todayKst();
  if (p.scheduleType === "open") {
    return typeof p.availableUntil !== "string" || p.availableUntil >= today;
  }
  if (!Array.isArray(p.scheduleDates)) return true;
  return p.scheduleDates.some((d) => d >= today);
}

/**
 * 진행 날짜 한 줄 요약.
 * 날짜가 없는 1회성·회차제는 **심사 요청이 막혀 있으므로** 그 이유를 함께 적습니다 —
 * 「심사 요청」을 눌러 거부당하고 나서야 알게 되면 무엇이 빠졌는지 알 수 없습니다.
 */
function scheduleSummary(p: ProgramRow): { text: string; warn: boolean } {
  if (p.scheduleType === "open") {
    return { text: "날짜 협의 (상시모집)", warn: false };
  }
  if (p.scheduleType === "weekly") {
    return { text: "매주 반복 — 준비 중이라 날짜를 넣을 수 없습니다", warn: true };
  }

  // **지난 날짜는 빼고 셉니다.** 요약은 회차를 만들거나 지울 때만 다시 계산되므로
  // 그냥 시간이 흐르면 지난 날짜가 남아 있습니다 — 그대로 보여주면 이미 끝난
  // 날짜를 「앞으로 진행할 날짜」로 읽게 됩니다.
  const today = todayKst();
  const dates = (p.scheduleDates ?? []).filter((d) => d >= today);
  if (dates.length === 0) {
    return { text: "진행 날짜 없음 — 날짜를 넣어야 심사를 요청할 수 있습니다", warn: true };
  }

  const shown = dates.slice(0, 3).map(formatDate).join(" · ");
  const rest = dates.length > 3 ? ` 외 ${dates.length - 3}일` : "";
  return { text: `진행 날짜 ${shown}${rest} (총 ${dates.length}일)`, warn: false };
}

export default function MyProgramsPage() {
  const { user, loading } = useAuth();
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);

  const load = useCallback(async () => {
    setFetching(true);
    setError(null);
    try {
      const res = await apiFetch<{ programs: ProgramRow[] }>("/programs?mine=1", {
        requireAuth: true,
      });
      setPrograms(res.programs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "목록을 불러오지 못했습니다");
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && user) void load();
    if (!loading && !user) setFetching(false);
  }, [loading, user, load]);

  async function requestReview(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/programs/${id}/submit-for-review`, {
        method: "POST",
        requireAuth: true,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "심사 요청에 실패했습니다");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * 지우기 / 내리기 — **무엇이 일어날지 누르기 전에 말해줍니다.**
   *
   * 실제 판단은 서버가 합니다(게시된 적 있으면 내리기, 없으면 완전 삭제). 화면은
   * 같은 기준(`everPublished`)으로 문구만 맞춥니다 — 「지운다고 눌렀는데 남아
   * 있는」 상태를 화면이 설명하지 못하면 고장으로 읽힙니다.
   */
  async function removeProgram(p: ProgramRow) {
    const message = p.everPublished
      ? `「${p.title}」을(를) 내릴까요?\n\n손님에게 보이지 않게 되고, 내용과 사진은 그대로 남습니다.`
      : `「${p.title}」을(를) 삭제할까요?\n\n등록한 날짜와 사진까지 함께 지워지고 되돌릴 수 없습니다.`;
    if (!window.confirm(message)) return;

    setBusyId(p.id);
    setError(null);
    try {
      await apiFetch(`/programs/${p.id}`, { method: "DELETE", requireAuth: true });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "처리하지 못했습니다");
    } finally {
      setBusyId(null);
    }
  }

  if (loading || fetching) {
    return <div className="container mx-auto max-w-2xl px-5 py-8">불러오는 중…</div>;
  }

  if (!user) {
    return (
      <div className="container mx-auto max-w-2xl px-5 py-8">
        <Card className="bg-secondary">
          <CardContent className="pt-6">
            <p className="text-sm">로그인이 필요합니다. 우측 상단에서 로그인해 주세요.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-5 py-8 pb-20">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-[22px] font-bold">내 프로그램</h1>
        <Button asChild size="sm">
          <Link to="/programs/new">새로 등록</Link>
        </Button>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] leading-relaxed text-destructive">
          {error}
        </p>
      )}

      {programs.length === 0 ? (
        <Card className="bg-secondary">
          <CardContent className="pt-6">
            <p className="mb-3 text-sm leading-relaxed">
              아직 등록한 프로그램이 없습니다.
            </p>
            <Button asChild variant="outline">
              <Link to="/programs/new">첫 프로그램 등록하기</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {programs.map((p) => (
            <li key={p.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{p.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.category} · {p.location?.address} · 난이도{" "}
                        {DIFFICULTY_LABEL[p.difficulty] ?? p.difficulty}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[12px] font-semibold text-secondary-foreground">
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>

                  <p className="text-sm">{p.price.toLocaleString()}원</p>

                  {(() => {
                    const summary = scheduleSummary(p);
                    return (
                      <p
                        className={`text-[12.5px] leading-relaxed ${
                          summary.warn ? "font-medium text-destructive" : "text-muted-foreground"
                        }`}
                      >
                        {summary.text}
                      </p>
                    );
                  })()}

                  {/* 수정 요청이 반려된 경우 — 프로그램 자체는 게시 중입니다.
                      프로그램 반려(위)와 구분해서 보여줘야 오해가 없습니다. */}
                  {p.status === "published" && p.editReviewNote && (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12.5px] leading-relaxed text-destructive">
                      수정 요청 반려: {p.editReviewNote}
                      <br />
                      <span className="text-[12px]">게시된 내용은 그대로 유지되고 있습니다.</span>
                    </p>
                  )}

                  {p.status === "hidden" && p.reviewNote && (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12.5px] leading-relaxed text-destructive">
                      반려 사유: {p.reviewNote}
                    </p>
                  )}

                  {/* 만료 — 게시 중인데 진행할 날짜가 없으면 검색에서 빠집니다
                      (2026-09-08). **게시 상태는 그대로 두고 검색에서만 빼므로**
                      날짜를 하나 넣으면 그 자리에서 돌아옵니다. 이 안내가 없으면
                      공급자는 「게시 중」이라고 적힌 화면을 보면서 왜 손님이 못
                      찾는지 알 수 없습니다. */}
                  {p.status === "published" && !hasBookableDate(p) && (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12.5px] leading-relaxed text-destructive">
                      진행할 날짜가 지나 <b>손님에게 노출되지 않고 있습니다.</b>
                      <br />
                      <span className="text-[12px]">
                        수정 화면에서 날짜를 추가하면 다시 검색에 나옵니다. 게시 상태는
                        그대로라 심사를 다시 받지 않습니다.
                      </span>
                    </p>
                  )}

                  <div className="mt-1 flex flex-wrap gap-2">
                    {p.status === "draft" && (
                      <Button
                        size="sm"
                        onClick={() => requestReview(p.id)}
                        disabled={busyId === p.id}
                      >
                        심사 요청
                      </Button>
                    )}
                    {/* 수정은 모든 상태에서 됩니다. 게시 중인 프로그램의 심사 대상
                        항목을 고치면 서버가 다시 심사로 되돌립니다(5번 v22). */}
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/programs/${p.id}/edit`}>
                        {p.status === "hidden" ? "수정해서 다시 제출" : "수정"}
                      </Link>
                    </Button>

                    {/* 지우기 / 내리기 — 게시된 적 있으면 내리기입니다.
                        이미 내려간 것은 버튼을 두지 않습니다(서버도 거부합니다).
                        오른쪽 끝으로 밀어 「수정」과 잘못 누르지 않게 합니다. */}
                    {!(p.status === "hidden" && p.everPublished) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => removeProgram(p)}
                        disabled={busyId === p.id}
                      >
                        {p.everPublished ? "내리기" : "삭제"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
