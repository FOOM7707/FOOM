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

type Tab = "providers" | "programs" | "edits";

const TABS: { key: Tab; label: string }[] = [
  { key: "providers", label: "전문가 심사" },
  { key: "programs", label: "프로그램 심사" },
  { key: "edits", label: "수정 승인" },
];

/** 항목 이름 → 사람이 읽는 이름. 서버는 필드 이름으로만 알려줍니다. */
const FIELD_LABEL: Record<string, string> = {
  title: "프로그램명",
  description: "소개",
  category: "카테고리",
  qualificationType: "자격 유형",
  location: "장소",
  price: "가격",
  capacity: "최대 인원",
  minCapacity: "최소 인원",
  scheduleType: "운영 방식",
  imageUrls: "사진",
  targetAgeMin: "참가 연령(최소)",
  targetAgeMax: "참가 연령(최대)",
  includes: "포함 사항",
  excludes: "불포함 사항",
  preparations: "준비물",
  introBlocks: "프로그램 소개",
};

/** 포함·불포함·준비물 코드 → 한국어. 서버는 코드로만 알려줍니다(20-4). */
const KEYWORD_LABEL: Record<string, string> = {
  guide: "전문가 해설",
  materials: "체험 재료",
  refreshment: "다과·차",
  admission: "입장료",
  insurance: "보험",
  souvenir: "기념품",
  photo: "사진 촬영",
  equipment: "장비 대여",
  transport: "교통비",
  parking: "주차비",
  meal: "식사",
  personal_gear: "개인 장비",
  shoes: "편한 신발",
  long_clothes: "긴 옷",
  hat: "모자",
  water: "물",
  raincoat: "우비",
  spare_clothes: "여벌 옷",
  mat: "돗자리",
  sunscreen: "자외선 차단제",
  insect_repellent: "벌레 기피제",
};

const SCHEDULE_TYPE_LABEL: Record<string, string> = {
  single: "1회성",
  weekly: "매주 반복",
  series: "회차제",
  open: "상시모집",
};

/** 「전 → 후」에 보여줄 값. 객체·배열·빈값을 그대로 찍으면 읽을 수 없습니다. */
function formatFieldValue(field: string, value: unknown): string {
  if (value == null || value === "") return "(비어 있음)";
  if (field === "location") {
    const loc = value as { address?: string };
    return loc.address ?? "(주소 없음)";
  }
  if (field === "price") return `${Number(value).toLocaleString()}원`;
  if (field === "scheduleType") return SCHEDULE_TYPE_LABEL[String(value)] ?? String(value);
  if (field === "imageUrls") {
    const urls = value as string[];
    return urls.length === 0 ? "(없음)" : `사진 ${urls.length}장`;
  }
  // 포함·불포함·준비물 — 목록에서 고른 코드와 직접 입력을 함께 보여줍니다.
  // **직접 입력이 심사의 핵심**이라 눈에 띄게 표시합니다(20-4).
  if (field === "includes" || field === "excludes" || field === "preparations") {
    const v = value as { keys?: string[]; custom?: string[] };
    const keys = (v.keys ?? []).map((k) => KEYWORD_LABEL[k] ?? k);
    const custom = (v.custom ?? []).map((c) => `${c}(직접 입력)`);
    const all = [...keys, ...custom];
    return all.length === 0 ? "(없음)" : all.join(" · ");
  }
  // 소개 블록 — 블록마다 소제목·사진 장수·설명을 한 줄로 요약합니다.
  if (field === "introBlocks") {
    const blocks = (value as Array<{ heading?: string; body?: string; images?: unknown[] }>) ?? [];
    if (blocks.length === 0) return "(없음)";
    return blocks
      .map((b, i) => {
        const photos = (b.images ?? []).length;
        const head = b.heading?.trim() || "(소제목 없음)";
        return `${i + 1}. ${head}${photos > 0 ? ` [사진 ${photos}장]` : ""} — ${b.body ?? ""}`;
      })
      .join("\n");
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

interface KeywordValue {
  keys?: string[];
  custom?: string[];
}

interface IntroBlockRow {
  heading?: string;
  body?: string;
  images?: Array<{ path: string; url: string }>;
}

/**
 * 사진 — **장수가 아니라 사진 자체를 봐야** 심사가 됩니다(v29).
 *
 * v28까지는 「3장」이라고 숫자만 보여줬습니다. 그러면 관리자는 제목·가격만 보고
 * 승인 버튼을 누르게 되고, 「무엇을 보고 승인했는가」가 남지 않습니다.
 * 누르면 원본이 새 창에서 열립니다 — 썸네일로는 초점·화질을 판단할 수 없습니다.
 */
function PhotoStrip({ urls }: { urls: string[] }) {
  if (urls.length === 0) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        사진이 없습니다 — 목록·검색 결과에서 빈 자리로 보입니다
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {urls.map((url, i) => (
        <li key={url + i} className="relative">
          <a href={url} target="_blank" rel="noreferrer" title="원본 보기">
            <img
              src={url}
              alt=""
              loading="lazy"
              className="h-20 w-28 rounded-md border object-cover"
            />
          </a>
          {/* 첫 장이 대표입니다(2-3) — 목록 카드·홈에 이 사진이 쓰입니다 */}
          <span className="absolute left-1 top-1 rounded bg-black/55 px-1 text-[10.5px] font-semibold text-white">
            {i === 0 ? "대표" : i + 1}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 포함·불포함·준비물. **직접 입력분이 심사의 핵심**이라 구별되게 표시합니다(20-4). */
function KeywordChips({ value }: { value?: KeywordValue }) {
  const keys = value?.keys ?? [];
  const custom = value?.custom ?? [];
  if (keys.length === 0 && custom.length === 0) {
    return <span className="text-[12.5px] text-muted-foreground">(없음)</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((k) => (
        <span
          key={k}
          className="rounded-full bg-secondary px-2 py-0.5 text-[12px] text-secondary-foreground"
        >
          {KEYWORD_LABEL[k] ?? k}
        </span>
      ))}
      {custom.map((c) => (
        <span
          key={c}
          className="rounded-full border border-primary bg-primary/10 px-2 py-0.5 text-[12px] font-semibold text-primary"
        >
          {c} <span className="font-normal opacity-70">직접 입력</span>
        </span>
      ))}
    </div>
  );
}

/**
 * 프로그램 소개 — 손님이 보는 순서 그대로, 사진을 붙여서 보여줍니다.
 *
 * 블록당 사진은 한 장입니다(v29). 사진 없이 글만 있는 블록도 정상입니다 —
 * 상세 화면에서 가로 전체 문단으로 그려집니다.
 */
function IntroBlocksReview({ blocks }: { blocks?: IntroBlockRow[] }) {
  const rows = blocks ?? [];
  if (rows.length === 0) {
    return <span className="text-[12.5px] text-muted-foreground">(없음)</span>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {rows.map((b, i) => (
        <li key={i} className="flex gap-3 rounded-lg border border-border/70 px-3 py-2.5">
          {b.images?.[0] ? (
            <a
              href={b.images[0].url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0"
              title="원본 보기"
            >
              <img
                src={b.images[0].url}
                alt=""
                loading="lazy"
                className="h-20 w-28 rounded-md border object-cover"
              />
            </a>
          ) : (
            <span className="flex h-20 w-28 shrink-0 items-center justify-center rounded-md border border-dashed text-[11.5px] text-muted-foreground">
              사진 없음
            </span>
          )}
          <div className="min-w-0">
            <span className="text-[11.5px] font-extrabold tracking-widest text-primary">
              {String(i + 1).padStart(2, "0")}
            </span>
            <p className="font-semibold">{b.heading?.trim() || "(소제목 없음)"}</p>
            <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-muted-foreground">
              {b.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** 글로 요약하면 무엇이 바뀌었는지 알 수 없는 항목 — 그림으로 보여줍니다 */
const VISUAL_FIELDS = new Set([
  "imageUrls",
  "introBlocks",
  "includes",
  "excludes",
  "preparations",
]);

function VisualValue({ field, value }: { field: string; value: unknown }) {
  if (field === "imageUrls") return <PhotoStrip urls={(value as string[]) ?? []} />;
  if (field === "introBlocks") return <IntroBlocksReview blocks={value as IntroBlockRow[]} />;
  return <KeywordChips value={value as KeywordValue} />;
}

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
  scheduleType?: string;
  includes?: KeywordValue;
  excludes?: KeywordValue;
  preparations?: KeywordValue;
  introBlocks?: IntroBlockRow[];
}

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "쉬움",
  normal: "보통",
  hard: "어려움",
};

/** 전문가 심사 상태 표기. `reviewing`은 v23에서 추가된 진행 표시입니다. */
const APPROVAL_LABEL: Record<string, string> = {
  pending: "심사 대기",
  reviewing: "심사 중",
  approved: "승인됨",
  rejected: "반려됨",
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

  /** 심사 착수 — 결과가 아니라 진행 표시입니다. 전문가 화면의 단계가 이걸로 움직입니다. */
  async function startReview(uid: string) {
    setBusyUid(uid);
    setError(null);
    try {
      await apiFetch(`/admin/providers/${uid}/start-review`, {
        method: "POST",
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
          <option value="reviewing">심사 중</option>
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
                      {APPROVAL_LABEL[p.approvalStatus ?? ""] ?? p.approvalStatus ?? "상태 없음"}
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

                  {/* 「심사 시작」은 결과가 아니라 진행 표시입니다(v23).
                      전문가 화면의 진행 단계가 이 값으로 3번 칸까지 올라갑니다 —
                      누르지 않으면 「심사 대기」에 머물러 방치된 것처럼 보입니다. */}
                  {p.approvalStatus === "pending" && (
                    <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyUid === p.uid}
                        onClick={() => void startReview(p.uid)}
                      >
                        심사 시작
                      </Button>
                      <span className="text-[12px] text-muted-foreground">
                        신청자 화면에 「심사 중」으로 표시됩니다
                      </span>
                    </div>
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
                    <dt className="text-muted-foreground">운영 방식</dt>
                    <dd>
                      {SCHEDULE_TYPE_LABEL[p.scheduleType ?? ""] ?? p.scheduleType ?? "-"}
                    </dd>
                  </dl>

                  {/* 심사에 필요한 것은 요약이 아니라 **손님이 볼 내용 그대로**입니다.
                      v28까지 사진은 장수만 나오고 소개·키워드는 아예 없어서, 관리자가
                      제목·가격만 보고 승인 버튼을 눌러야 했습니다(v29에서 보완). */}
                  <div className="mt-4 flex flex-col gap-3.5 border-t pt-3.5">
                    <section>
                      <p className="mb-1.5 text-[12.5px] font-semibold">사진</p>
                      <PhotoStrip urls={p.imageUrls ?? []} />
                    </section>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <section>
                        <p className="mb-1.5 text-[12.5px] font-semibold">포함 사항</p>
                        <KeywordChips value={p.includes} />
                      </section>
                      <section>
                        <p className="mb-1.5 text-[12.5px] font-semibold">불포함 사항</p>
                        <KeywordChips value={p.excludes} />
                      </section>
                      <section>
                        <p className="mb-1.5 text-[12.5px] font-semibold">준비물</p>
                        <KeywordChips value={p.preparations} />
                      </section>
                    </div>

                    <section>
                      <p className="mb-1.5 text-[12.5px] font-semibold">프로그램 소개</p>
                      <IntroBlocksReview blocks={p.introBlocks} />
                    </section>
                  </div>

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

interface PendingEditRow {
  id: string;
  title: string;
  providerId: string;
  changedFields: string[];
  diff: Array<{ field: string; before: unknown; after: unknown }>;
}

/**
 * 수정 승인 (v23).
 *
 * 게시 중인 프로그램의 수정본입니다. **게시본은 내려가 있지 않습니다** — 손님은
 * 지금도 승인된 내용을 보고 있고, 승인하면 그 자리에서 교체됩니다.
 *
 * 전체를 다시 읽게 하지 않고 **바뀐 항목만 「전 → 후」로** 보여줍니다. 프로그램
 * 설명이 수백 자인데 통째로 두 번 보여주면 무엇이 바뀌었는지 못 찾습니다.
 */
function ProgramEditsTab() {
  const [items, setItems] = useState<PendingEditRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ edits: PendingEditRow[]; truncated: boolean }>(
        "/admin/program-edits",
        { requireAuth: true }
      );
      setItems(res.edits);
      setTruncated(res.truncated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "목록을 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, decision: "approved" | "rejected", note: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/admin/programs/${id}/review-edit`, {
        method: "POST",
        body: { decision, note },
        requireAuth: true,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "처리에 실패했습니다");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;

  return (
    <div>
      <p className="mb-4 rounded-lg bg-secondary px-3.5 py-3 text-[13px] leading-relaxed text-secondary-foreground">
        게시 중인 프로그램의 수정 요청입니다. <strong>지금 손님에게는 승인된 내용이 그대로
        보이고 있습니다</strong> — 승인하면 그 자리에서 교체되고, 반려하면 수정 내용만
        버려집니다. 어느 쪽이든 게시가 중단되지는 않습니다.
      </p>

      {error && (
        <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
          {error}
        </p>
      )}

      {truncated && (
        <p className="mb-4 text-[12.5px] text-muted-foreground">
          목록이 상한에 닿아 뒤가 잘렸습니다.
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">승인 대기 중인 수정 요청이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((row) => (
            <li key={row.id}>
              <Card>
                <CardContent className="pt-5">
                  <p className="font-semibold">{row.title}</p>
                  <p className="mb-3 text-xs text-muted-foreground">
                    바뀐 항목 {row.changedFields.length}개
                  </p>

                  <ul className="flex flex-col gap-2">
                    {row.diff.map((d) => (
                      <li
                        key={d.field}
                        className="rounded-lg border border-border px-3 py-2.5 text-[13px]"
                      >
                        <p className="mb-1.5 font-semibold">
                          {FIELD_LABEL[d.field] ?? d.field}
                        </p>
                        {/* 사진·소개·키워드를 글로 요약하면 무엇이 바뀌었는지 알 수
                            없습니다 — 「사진 1장 → 사진 1장」으로 보입니다(v29). */}
                        {VISUAL_FIELDS.has(d.field) ? (
                          <div className="flex flex-col gap-2">
                            <div>
                              <p className="mb-1 text-[11.5px] font-semibold text-muted-foreground">
                                전
                              </p>
                              <div className="opacity-55">
                                <VisualValue field={d.field} value={d.before} />
                              </div>
                            </div>
                            <div>
                              <p className="mb-1 text-[11.5px] font-semibold text-primary">후</p>
                              <VisualValue field={d.field} value={d.after} />
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="whitespace-pre-line leading-relaxed text-muted-foreground line-through decoration-muted-foreground/50">
                              {formatFieldValue(d.field, d.before)}
                            </p>
                            <p className="whitespace-pre-line leading-relaxed font-medium text-primary">
                              → {formatFieldValue(d.field, d.after)}
                            </p>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>

                  <DecisionBox
                    busy={busyId === row.id}
                    approveLabel="수정 승인"
                    onDecide={(decision, note) => void decide(row.id, decision, note)}
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

      {tab === "providers" ? (
        <ProvidersTab />
      ) : tab === "programs" ? (
        <ProgramsTab />
      ) : (
        <ProgramEditsTab />
      )}
    </div>
  );
}
