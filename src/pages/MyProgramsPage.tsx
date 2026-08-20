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
  reviewNote?: string | null;
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

  const dates = p.scheduleDates ?? [];
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

                  {p.status === "hidden" && p.reviewNote && (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12.5px] leading-relaxed text-destructive">
                      반려 사유: {p.reviewNote}
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
