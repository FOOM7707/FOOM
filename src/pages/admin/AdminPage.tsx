/**
 * 관리자 페이지 (스키마 12-2 — 탭 3개 중 2개).
 *
 * 정산 탭은 아직 없습니다. 예약·결제가 없어 정산할 거래 자체가 생기지 않습니다.
 *
 * **이 화면의 라우트 가드는 보안 장치가 아닙니다(12-3).** 주소를 직접 쳐서
 * 들어와도 껍데기만 열릴 뿐 데이터는 내려오지 않습니다 — 실제 차단은
 * `/admin/*` 함수 진입부와 보안규칙 `isAdmin()`이 합니다. 여기서 클레임을
 * 확인하는 건 권한 없는 사람에게 빈 표를 보여주지 않기 위한 UX 처리입니다.
 *
 * 화면은 `React.lazy()`로 분리해 불러옵니다(App.tsx) — 보안 목적이 아니라
 * 소비자 화면의 초기 번들을 가볍게 유지하기 위한 조치입니다(12-3).
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, apiFetch } from "@/lib/api";

type Tab = "providers" | "programs";

const TABS: { key: Tab; label: string }[] = [
  { key: "providers", label: "전문가 심사" },
  { key: "programs", label: "프로그램 심사" },
];

interface ProviderRow {
  uid: string;
  displayName: string | null;
  bio: string | null;
  qualificationType: string[];
  verified: boolean;
  approvalStatus: string | null;
  approvalNote: string | null;
  certificateImageUrls: string[];
  identityVerifiedAt: unknown;
  userName: string | null;
  userStatus: string | null;
}

interface ProgramRow {
  id: string;
  title: string;
  category: string;
  price: number;
  status: string;
  difficulty: string;
  sido: string;
  providerDisplayName: string | null;
  targetAgeMin: number | null;
  targetAgeMax: number | null;
  walkingDistanceM: number | null;
  rainAlternative: string;
  capacity: number;
  minCapacity: number;
  description: string;
  imageUrls: string[];
  location?: { address?: string };
}

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "쉬움",
  normal: "보통",
  hard: "어려움",
};

const RAIN_LABEL: Record<string, string> = {
  indoor: "실내 대체",
  reschedule: "날짜 변경",
  none: "없음",
};

/** 승인/반려 버튼 한 쌍 + 반려 사유 입력. 두 탭이 같은 모양을 씁니다. */
function DecisionBox({
  busy,
  approveLabel,
  onDecide,
}: {
  busy: boolean;
  approveLabel: string;
  onDecide: (decision: "approved" | "rejected", note: string) => void;
}) {
  const [note, setNote] = useState("");

  return (
    <div className="mt-3 border-t border-border pt-3">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="반려 사유 (반려할 때는 필수 — 공급자에게 그대로 보입니다)"
        className="text-[13px]"
      />
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => onDecide("approved", note)}>
          {approveLabel}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy || note.trim().length === 0}
          title={note.trim().length === 0 ? "반려 사유를 입력해 주세요" : undefined}
          onClick={() => onDecide("rejected", note)}
        >
          반려
        </Button>
      </div>
    </div>
  );
}

function useReviewList<T>(path: string, status: string) {
  const [items, setItems] = useState<T[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<Record<string, unknown>>(`${path}?status=${status}`, {
        requireAuth: true,
      });
      // 응답 키가 목록마다 다릅니다 (providers / programs)
      const list = (res.providers ?? res.programs ?? []) as T[];
      setItems(list);
      setTruncated(res.truncated === true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "목록을 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, [path, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, truncated, loading, error, reload: load, setError };
}

function ProvidersTab() {
  const [status, setStatus] = useState("pending");
  const { items, truncated, loading, error, reload, setError } = useReviewList<ProviderRow>(
    "/admin/providers",
    status
  );
  const [busyUid, setBusyUid] = useState<string | null>(null);

  async function decide(uid: string, decision: "approved" | "rejected", note: string) {
    setBusyUid(uid);
    setError(null);
    try {
      await apiFetch(`/admin/providers/${uid}/approve`, {
        method: "POST",
        body: { decision, note },
        requireAuth: true,
      });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "처리에 실패했습니다");
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[13px] font-semibold text-muted-foreground">상태</span>
        <Select
          className="h-9 w-36"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="pending">심사 대기</option>
          <option value="approved">승인됨</option>
          <option value="rejected">반려됨</option>
          <option value="all">전체</option>
        </Select>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
          {error}
        </p>
      )}
      {truncated && (
        <p className="mb-4 rounded-lg bg-secondary px-3 py-2.5 text-[12.5px] text-secondary-foreground">
          공급자가 많아 목록이 잘렸습니다. 뒤쪽은 표시되지 않았습니다.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">해당 상태의 전문가가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((p) => (
            <li key={p.uid}>
              <Card>
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {p.displayName ?? "(활동명 없음)"}
                        {p.verified && (
                          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                            인증
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {p.userName} · {p.uid}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[12px] font-semibold text-secondary-foreground">
                      {p.approvalStatus ?? "상태 없음"}
                    </span>
                  </div>

                  {p.bio && <p className="mt-2 text-[13px]">{p.bio}</p>}

                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                    <dt className="text-muted-foreground">자격 유형</dt>
                    <dd>
                      {p.qualificationType.length > 0
                        ? p.qualificationType.join(", ")
                        : "(미입력)"}
                    </dd>
                    <dt className="text-muted-foreground">본인확인</dt>
                    <dd>
                      {p.identityVerifiedAt ? (
                        "완료"
                      ) : (
                        // 본인확인 벤더 계약 전이라 지금은 전부 여기 해당합니다(15-8).
                        <span className="text-destructive">
                          미완료 — 임시 경로로 만들어진 계정입니다
                        </span>
                      )}
                    </dd>
                    <dt className="text-muted-foreground">자격증</dt>
                    <dd>
                      {p.certificateImageUrls.length === 0 ? (
                        <span className="text-destructive">
                          제출 없음 — Storage 미설정으로 업로드 경로가 아직 없습니다
                        </span>
                      ) : (
                        p.certificateImageUrls.map((url, i) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="mr-2 text-primary underline"
                          >
                            사본 {i + 1}
                          </a>
                        ))
                      )}
                    </dd>
                  </dl>

                  {p.approvalNote && (
                    <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-[12.5px] text-secondary-foreground">
                      기록된 사유: {p.approvalNote}
                    </p>
                  )}

                  <DecisionBox
                    busy={busyUid === p.uid}
                    approveLabel="승인"
                    onDecide={(decision, note) => void decide(p.uid, decision, note)}
                  />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProgramsTab() {
  const [status, setStatus] = useState("pending_review");
  const { items, truncated, loading, error, reload, setError } = useReviewList<ProgramRow>(
    "/admin/programs",
    status
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(id: string, decision: "approved" | "rejected", note: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/admin/programs/${id}/review`, {
        method: "POST",
        body: { decision, note },
        requireAuth: true,
      });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "처리에 실패했습니다");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[13px] font-semibold text-muted-foreground">상태</span>
        <Select
          className="h-9 w-36"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="pending_review">심사 대기</option>
          <option value="published">게시 중</option>
          <option value="hidden">반려·숨김</option>
          <option value="draft">작성 중</option>
        </Select>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
          {error}
        </p>
      )}
      {truncated && (
        <p className="mb-4 rounded-lg bg-secondary px-3 py-2.5 text-[12.5px] text-secondary-foreground">
          목록이 잘렸습니다. 뒤쪽은 표시되지 않았습니다.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">해당 상태의 프로그램이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((p) => (
            <li key={p.id}>
              <Card>
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{p.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {p.providerDisplayName ?? "(공급자 프로필 없음)"} · {p.category}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[12px] font-semibold text-secondary-foreground">
                      {p.status}
                    </span>
                  </div>

                  <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">
                    {p.description}
                  </p>

                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                    <dt className="text-muted-foreground">가격</dt>
                    <dd>{p.price?.toLocaleString()}원</dd>
                    <dt className="text-muted-foreground">인원</dt>
                    <dd>
                      최소 {p.minCapacity}명 · 최대 {p.capacity}명
                    </dd>
                    <dt className="text-muted-foreground">장소</dt>
                    <dd>
                      {p.location?.address} ({p.sido})
                    </dd>
                    <dt className="text-muted-foreground">난이도</dt>
                    <dd>
                      {DIFFICULTY_LABEL[p.difficulty] ?? p.difficulty}
                      {p.walkingDistanceM != null && ` · 보행 ${p.walkingDistanceM}m`}
                    </dd>
                    <dt className="text-muted-foreground">대상 연령</dt>
                    <dd>
                      {p.targetAgeMin == null && p.targetAgeMax == null
                        ? "제한 없음"
                        : `${p.targetAgeMin ?? 0}세 ~ ${p.targetAgeMax ?? "제한 없음"}`}
                    </dd>
                    <dt className="text-muted-foreground">우천 시</dt>
                    <dd>{RAIN_LABEL[p.rainAlternative] ?? p.rainAlternative}</dd>
                    <dt className="text-muted-foreground">사진</dt>
                    <dd>
                      {p.imageUrls?.length > 0 ? (
                        `${p.imageUrls.length}장`
                      ) : (
                        <span className="text-destructive">없음 — Storage 미설정</span>
                      )}
                    </dd>
                  </dl>

                  <DecisionBox
                    busy={busyId === p.id}
                    approveLabel="게시 승인"
                    onDecide={(decision, note) => void decide(p.id, decision, note)}
                  />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdminPage() {
  const { user, isAdmin, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("providers");

  if (loading) {
    return <div className="container mx-auto max-w-3xl px-5 py-10">불러오는 중…</div>;
  }

  if (!user || !isAdmin) {
    return (
      <div className="container mx-auto max-w-3xl px-5 py-10">
        <Card className="bg-secondary">
          <CardContent className="pt-6">
            <p className="text-sm leading-relaxed">
              관리자 권한이 필요한 화면입니다.
              {!user && " 먼저 로그인해 주세요."}
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
              방금 권한을 부여받았다면 로그아웃 후 다시 로그인해 주세요 — 권한은 로그인 토큰에
              담기므로 토큰이 갱신돼야 반영됩니다.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-5 py-8 pb-20">
      <h1 className="text-[22px] font-bold">관리자</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        승인·반려는 누가 언제 처리했는지 기록으로 남습니다.
      </p>

      <div className="mb-6 mt-5 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              "-mb-px border-b-2 px-4 py-2.5 text-[14px] font-semibold transition-colors " +
              (tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </button>
        ))}
        <span
          aria-disabled="true"
          title="예약·결제가 생긴 뒤에 만듭니다"
          className="cursor-not-allowed select-none border-b-2 border-transparent px-4 py-2.5 text-[14px] font-semibold text-muted-foreground/50"
        >
          정산 관리
        </span>
      </div>

      {tab === "providers" ? <ProvidersTab /> : <ProgramsTab />}
    </div>
  );
}
