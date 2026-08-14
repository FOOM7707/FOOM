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

                  {p.status === "hidden" && p.reviewNote && (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12.5px] leading-relaxed text-destructive">
                      반려 사유: {p.reviewNote}
                    </p>
                  )}

                  {p.status === "draft" && (
                    <div className="mt-1">
                      <Button
                        size="sm"
                        onClick={() => requestReview(p.id)}
                        disabled={busyId === p.id}
                      >
                        심사 요청
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
