/**
 * 마이페이지 (스키마 2-1 · 5번).
 *
 * `GET /users/me`가 내려주는 값만 보여줍니다 — 화면이 Firestore를 직접 읽지
 * 않는 이유는 `lib/users.ts`에 적혀 있습니다(문서 2~3개를 화면마다 따로 읽으면
 * 어느 화면은 읽고 어느 화면은 빠뜨리는 상태가 생깁니다).
 *
 * **수정도 서버를 거칩니다**(`PATCH /users/me`). 보안규칙은 본인의 `users`
 * 문서 수정을 허용하지만, 연락처는 `+8210…` 한 형식으로만 저장해야 중복 감지가
 * 동작하고 그 정규화 관문이 서버에만 있습니다(15-4).
 *
 * **예약내역은 자리만 있습니다.** 예약 홀드(서버)는 만들어졌지만 결제가 없어
 * 실제로 쌓이는 예약이 없습니다 — 목록을 만들면 언제나 비어 있어 고장으로
 * 읽힙니다. 결제가 붙는 날 이 자리에 목록이 들어갑니다.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ReviewProgress from "@/components/ReviewProgress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, apiFetch } from "@/lib/api";

interface Me {
  uid: string;
  role: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  profileImageUrl: string | null;
  status: string;
  authProvider: string | null;
  provider: {
    displayName: string | null;
    verified: boolean;
    /** (v23) `reviewing` — 관리자가 심사를 시작한 상태. 진행 단계 표시에 씁니다 */
    approvalStatus: "pending" | "reviewing" | "approved" | "rejected" | null;
    approvalNote: string | null;
  } | null;
}

const PROVIDER_LABEL: Record<string, string> = {
  kakao: "카카오",
  naver: "네이버",
};

const ROLE_LABEL: Record<string, string> = {
  consumer: "일반 회원",
  provider: "산림복지전문가",
  admin: "관리자",
};

/**
 * 심사 상태별 안내 — 진행 단계 바 아래에 붙습니다.
 *
 * 칸만 보여주면 「그래서 지금 내가 뭘 할 수 있나」가 안 나옵니다. 특히
 * `pending`·`reviewing`에서도 **프로그램 등록과 심사 요청은 됩니다** — 그걸
 * 적어두지 않으면 자격 심사가 끝날 때까지 기다려야 하는 것으로 읽힙니다.
 */
const APPROVAL_NOTICE: Record<string, { title: string; body?: string }> = {
  pending: {
    title: "자격 심사를 기다리고 있습니다.",
    body: "프로그램 등록과 심사 요청은 지금도 할 수 있습니다. 다만 자격 심사를 통과하기 전에는 프로필에 「인증」 표시가 붙지 않습니다.",
  },
  reviewing: {
    title: "담당자가 자격 서류를 확인하고 있습니다.",
    body: "결과가 나오면 이 화면에 표시됩니다. 그동안에도 프로그램 등록과 심사 요청은 할 수 있습니다.",
  },
  approved: { title: "심사를 통과한 전문가 계정입니다." },
};

/** `+821012345678` → `010-1234-5678`. 저장은 E.164, 표시는 읽기 쉬운 형태입니다 */
function displayPhone(e164: string | null): string {
  if (!e164) return "";
  const digits = e164.replace(/^\+82/, "0");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b py-3 last:border-b-0">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold">{children}</span>
    </div>
  );
}

export default function MyPage() {
  const { user, loading, isAdmin, logout } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setFetching(true);
    setError(null);
    try {
      const res = await apiFetch<{ user: Me }>("/users/me", { requireAuth: true });
      setMe(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "내 정보를 불러오지 못했습니다");
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && user) void load();
    if (!loading && !user) setFetching(false);
  }, [loading, user, load]);

  function startEdit() {
    if (!me) return;
    setNameDraft(me.name ?? "");
    setPhoneDraft(displayPhone(me.phone));
    setSaveError(null);
    setEditing(true);
  }

  async function save() {
    if (!me) return;
    setSaving(true);
    setSaveError(null);
    try {
      // 바뀐 것만 보냅니다 — 서버는 「안 보낸 항목」을 건드리지 않습니다.
      // 연락처를 비운 채 보내면 서버가 거부하므로, 비었으면 아예 넣지 않습니다.
      const body: Record<string, string> = {};
      if (nameDraft.trim() !== (me.name ?? "")) body.name = nameDraft;
      const phoneChanged = phoneDraft.trim() !== displayPhone(me.phone);
      if (phoneChanged && phoneDraft.trim() !== "") body.phone = phoneDraft;

      if (Object.keys(body).length === 0) {
        setEditing(false);
        return;
      }

      const res = await apiFetch<{ user: Me }>("/users/me", {
        method: "PATCH",
        body,
        requireAuth: true,
      });
      setMe(res.user);
      setEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "저장하지 못했습니다");
    } finally {
      setSaving(false);
    }
  }

  if (loading || fetching) {
    return <div className="container mx-auto max-w-2xl px-5 py-8">불러오는 중…</div>;
  }

  if (!user) {
    return (
      <div className="container mx-auto max-w-2xl px-5 py-8">
        <h1 className="mb-5 text-[22px] font-bold">마이페이지</h1>
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
      <h1 className="mb-5 text-[22px] font-bold">마이페이지</h1>

      {error && (
        <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
          {error}
        </p>
      )}

      {me && (
        <>
          {/* ── 내 정보 ────────────────────────────────────────────── */}
          <Card className="mb-5">
            <CardContent className="pt-6">
              <div className="mb-4 flex items-center gap-3">
                {me.profileImageUrl ? (
                  <img
                    src={me.profileImageUrl}
                    alt=""
                    className="h-12 w-12 rounded-full bg-secondary object-cover"
                  />
                ) : (
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground"
                    aria-hidden
                  >
                    {(me.name ?? "품").slice(0, 2)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-base font-extrabold">{me.name ?? "이용자"}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABEL[me.role] ?? me.role}
                    {me.authProvider && ` · ${PROVIDER_LABEL[me.authProvider] ?? me.authProvider} 로그인`}
                  </p>
                </div>
              </div>

              {editing ? (
                <div className="flex flex-col gap-4">
                  <div>
                    <Label htmlFor="my-name">이름</Label>
                    <Input
                      id="my-name"
                      value={nameDraft}
                      maxLength={30}
                      onChange={(e) => setNameDraft(e.target.value)}
                      className="mt-1.5"
                    />
                    {/* 남에게 보이는 값이라는 것을 알려줍니다 — 실명을 넣을지
                        판단하는 데 필요한 정보입니다(2-1). */}
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      후기를 쓰면 이 이름이 다른 이용자에게 보입니다. 실명이 아니어도 됩니다.
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="my-phone">연락처</Label>
                    <Input
                      id="my-phone"
                      value={phoneDraft}
                      inputMode="tel"
                      placeholder="010-1234-5678"
                      onChange={(e) => setPhoneDraft(e.target.value)}
                      className="mt-1.5"
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      예약 확정·일정 변경 안내를 이 번호로 보냅니다.
                    </p>
                  </div>

                  {saveError && (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
                      {saveError}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <Button onClick={() => void save()} disabled={saving}>
                      {saving ? "저장 중…" : "저장"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setEditing(false)}
                      disabled={saving}
                    >
                      취소
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <dl>
                    <Row label="이름">{me.name ?? "-"}</Row>
                    <Row label="연락처">
                      {me.phone ? (
                        displayPhone(me.phone)
                      ) : (
                        // 비어 있는 것이 정상인 경우가 있습니다 — 카카오는 심사 전이라
                        // 번호가 오지 않고, 네이버도 계정에 번호가 없으면 빕니다(15-4).
                        <span className="font-normal text-muted-foreground">
                          아직 없습니다 — 예약 안내를 받으려면 넣어주세요
                        </span>
                      )}
                    </Row>
                    <Row label="이메일">
                      {me.email ?? (
                        <span className="font-normal text-muted-foreground">
                          제공되지 않았습니다
                        </span>
                      )}
                    </Row>
                  </dl>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={startEdit}>
                      내 정보 수정
                    </Button>
                    {saved && (
                      <span className="text-[13px] font-semibold text-primary">
                        저장했습니다
                      </span>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── 예약내역 (자리만) ──────────────────────────────────── */}
          <Card className="mb-5">
            <CardContent className="pt-6">
              <h2 className="mb-2 text-base font-extrabold">예약내역</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                예약·결제 기능을 준비하고 있습니다. 열리면 여기에서 신청한 프로그램과
                진행 날짜, 취소·환불 상태를 볼 수 있습니다.
              </p>
            </CardContent>
          </Card>

          {/* ── 전문가 영역 ────────────────────────────────────────── */}
          <Card className="mb-5">
            <CardContent className="pt-6">
              <h2 className="mb-3 text-base font-extrabold">전문가 활동</h2>

              {me.role === "provider" ? (
                <>
                  <dl className="mb-6">
                    <Row label="활동명">
                      {me.provider?.displayName ?? "-"}
                      {me.provider?.verified && (
                        <span className="ml-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                          인증
                        </span>
                      )}
                    </Row>
                  </dl>

                  {/* 자격 심사 진행 단계 — `/provider/apply`에 있던 것을 여기로
                      옮겼습니다. 「내 상태」는 내 계정 화면에서 보는 것이 맞고,
                      그 화면은 전문가를 설득하는 자리입니다.
                      **반려 사유는 이 컴포넌트가 함께 보여줍니다**(2-2 — 사유가
                      안 보이면 무엇을 고쳐야 할지 몰라 재신청이 불가능합니다). */}
                  <ReviewProgress
                    isProvider
                    approvalStatus={me.provider?.approvalStatus ?? null}
                    note={me.provider?.approvalNote ?? null}
                  />

                  {(() => {
                    const notice = APPROVAL_NOTICE[me.provider?.approvalStatus ?? ""];
                    if (!notice) return null;
                    return (
                      <div className="mt-4 rounded-lg bg-secondary px-3.5 py-3 text-[13px] leading-relaxed text-secondary-foreground">
                        <b>{notice.title}</b>
                        {notice.body && (
                          <>
                            <br />
                            {notice.body}
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {/* 반려인데 사유가 비어 있으면 재신청할 방법이 없습니다 —
                      그 사실을 알려야 문의라도 할 수 있습니다. */}
                  {me.provider?.approvalStatus === "rejected" &&
                    !me.provider.approvalNote && (
                      <div className="mt-4 rounded-lg bg-destructive/10 px-3.5 py-3 text-[13px] leading-relaxed text-destructive">
                        <b>심사가 반려되었습니다.</b>
                        <br />
                        사유가 기록되지 않았습니다. 운영자에게 문의해 주세요.
                      </div>
                    )}

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/my/programs">내 프로그램</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/programs/new">프로그램 등록</Link>
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    산림복지전문가 자격이 있으시면 프로그램을 열어 참가자를 모집할 수
                    있습니다.
                  </p>
                  <Button asChild size="sm" variant="outline" className="mt-3">
                    <Link to="/provider/apply">전문가 등록 안내 보기</Link>
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* 관리자 메뉴는 헤더에도 있지만, 여기 두면 「내 계정으로 할 수 있는
              일」이 한자리에 모입니다. 판단 기준은 토큰 클레임입니다(12-3) —
              보이는 것 자체가 보안 장치는 아니고 실제 차단은 서버가 합니다. */}
          {isAdmin && (
            <Card className="mb-5">
              <CardContent className="pt-6">
                <h2 className="mb-3 text-base font-extrabold">관리자</h2>
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin">심사 화면으로</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Button variant="outline" onClick={() => void logout()}>
        로그아웃
      </Button>
    </div>
  );
}
